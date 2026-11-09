/*! 远见·企业出海助手 —— 统一能力判断层（语言无关）
 *
 * 目的：让「当前项目功能标签」「缺口说明面板」「M/L 等级图谱」「税费覆盖矩阵」
 *       「产品选择页」「报告能力与缺口摘要」使用同一套判断结果，避免各页面各自维护状态。
 *
 * 原则：
 *  - 状态与原因由实际数据与引擎结果推导，不针对具体产品、市场或案例硬编码；
 *  - 静态画像写入的 L2/L3 只有在确实匹配到产品特定可执行规则时才作为「能力承诺」输出；
 *  - 未知条件不按 0 处理；缺条件时保留可靠分项，完整总额保持为空；
 *  - 输出为结构化代码（state / reason / owner / action），界面层再按语言渲染文案。
 */
(function (global) {
  'use strict';

  var STATE = {
    OK: 'ok',                 // 现在就能用
    PARTIAL: 'partial',       // 部分能用（有可靠结果，另有待办）
    NEEDS_INPUT: 'needs_input',   // 平台具备能力，缺用户填写
    NEEDS_REVIEW: 'needs_review', // 需要专业复核才能继续
    NOT_SUPPORTED: 'not_supported', // 平台尚未覆盖
    PENDING: 'pending'        // 待确认（如归类分支未选定）
  };

  var REASON = {
    USER_INPUT: 'user_input',                    // 用户输入不足
    PRODUCT_FACT: 'product_fact',                // 产品事实不足
    HS_REVIEW: 'hs_review',                      // HS 归类待确认
    REGULATION_DATA: 'regulation_data',          // 法规资料不足
    TAX_PROFILE_MISSING: 'tax_profile_missing',  // 税费画像缺失
    SCENARIO_UNSUPPORTED: 'scenario_unsupported',// 业务情景不支持
    DATE_OUT_OF_RANGE: 'date_out_of_range',      // 日期不在适用区间
    EVIDENCE_PENDING: 'evidence_pending'         // 官方证据待复核
  };

  var OWNER = { USER: 'user', PLATFORM: 'platform', EXPERT: 'expert' };

  var FIELD_LABEL_FALLBACK = {
    goods_value: 'goods_value', freight: 'freight', insurance: 'insurance',
    origin: 'origin', import_date: 'import_date', currency: 'currency',
    incoterm: 'incoterm', fx_rate: 'fx_rate'
  };

  function findSub(data, subId) {
    var out = null;
    (data.subcategories || []).forEach(function (s) { if (s.id === subId) out = s; });
    return out;
  }

  /** 产品资料成熟度 M1／M2／M3：取自小类实际证据字段，与目的地无关 */
  function evidenceLevel(sub) {
    var code = sub && /M[123]/.test(sub.evidence || '') ? sub.evidence : null;
    return {
      code: code || 'unknown',
      sources: sub && sub.sourceIds ? sub.sourceIds.length : 0,
      keyParams: sub && sub.keyParams ? sub.keyParams.split('|').filter(Boolean).length : 0
    };
  }

  /** 市场服务等级 L：静态画像 + 是否真的匹配到产品特定可执行规则 */
  function serviceLevel(sc, market, sub) {
    if (!market || !sub) return { code: 'todo', profileBacked: false, backingRules: [] };
    var cov = sc.coverage || { level: 'L1', profileBacked: false, backingRules: [] };
    var level = cov.level || 'L1';
    if (level !== 'L1' && cov.profileBacked === false) level = 'L1';
    return { code: level, profileBacked: cov.profileBacked !== false, backingRules: cov.backingRules || [], label: cov.label || '', staticLevel: cov.level };
  }

  /** HS 候选能力：数量、是否需要区分、是否已选定 */
  function hsCapability(data, sc, input) {
    var list = sc.hsCandidates || [];
    if (!list.length) {
      return { state: STATE.NOT_SUPPORTED, reason: REASON.REGULATION_DATA, count: 0, candidates: [], missingFacts: [], owner: OWNER.PLATFORM, action: 'policy' };
    }
    var chosen = input.hsChoice || '';
    var missingFacts = [];
    list.forEach(function (h) {
      (h.questions || '').split(/[？?；;|]/).forEach(function (q) {
        var m = q.match(/(功率|容积|集尘|容量|电压|表面|功能|原理|加热)/);
        if (m) missingFacts.push(m[0]);
      });
    });
    if (list.length > 1 && !chosen) {
      return { state: STATE.PENDING, reason: REASON.HS_REVIEW, count: list.length, candidates: list.map(function (h) { return h.id; }), missingFacts: unique(missingFacts).slice(0, 4), owner: OWNER.USER, action: 'tax' };
    }
    if (list.length === 1 && !chosen) {
      return { state: STATE.OK, reason: null, count: 1, candidates: [list[0].id], missingFacts: [], owner: OWNER.USER, action: 'tax' };
    }
    return { state: STATE.OK, reason: null, count: list.length, candidates: list.map(function (h) { return h.id; }), missingFacts: [], owner: OWNER.USER, action: 'tax' };
  }

  /** 税费三项独立能力：税率可查 / 税额可算 / 汇总可用 */
  function taxCapability(data, engine, input, sc) {
    var out = {
      rate: STATE.NOT_SUPPORTED, amount: STATE.NOT_SUPPORTED, subtotal: STATE.NOT_SUPPORTED,
      profiles: 0, blockers: [], missing: [], reviewNeeded: false, reason: REASON.TAX_PROFILE_MISSING,
      owner: OWNER.PLATFORM, action: 'tax', candidates: 0
    };
    if (!input.market) { out.reason = REASON.USER_INPUT; out.owner = OWNER.USER; return out; }
    var legacy = (sc && sc.legacy) || '';
    var cands = (sc && sc.hsCandidates) || [];
    out.candidates = cands.length;
    var profiles = (data.taxProfiles || []).filter(function (p) {
      if (p.market !== input.market) return false;
      if (!legacy) return true;
      return p.product_type === legacy;
    });
    out.profiles = profiles.length;
    if (!profiles.length) {
      out.reason = REASON.TAX_PROFILE_MISSING;
      out.owner = OWNER.PLATFORM;
      return out;
    }
    // 税率可查：存在画像且日期落在适用区间
    var date = (input.tax && input.tax.importDate) || input.importDate || input.placingOnMarketDate || '';
    var inRange = profiles.filter(function (p) {
      return (!p.effective_from || !date || date >= p.effective_from) && (!p.effective_to || !date || date <= p.effective_to);
    });
    if (!inRange.length) {
      out.rate = STATE.NOT_SUPPORTED;
      out.reason = REASON.DATE_OUT_OF_RANGE;
      out.owner = OWNER.PLATFORM;
      out.dateRange = profiles.map(function (p) { return [p.effective_from, p.effective_to]; });
      out.amount = STATE.NOT_SUPPORTED;
      out.subtotal = STATE.NOT_SUPPORTED;
      return out;
    }
    out.rate = STATE.OK;
    out.reviewNeeded = inRange.some(function (p) { return p.requiresReview === true; });

    var taxInput = buildTaxInput(data, input, sc);
    out.missing = [];
    if (!taxInput.goods_value) out.missing.push('goods_value');
    if (!isSet(taxInput.freight)) out.missing.push('freight');
    if (!isSet(taxInput.insurance)) out.missing.push('insurance');
    if (!taxInput.origin) out.missing.push('origin');
    if (!taxInput.import_date) out.missing.push('import_date');
    if (!taxInput.incoterm) out.missing.push('incoterm');
    if (taxInput.currency && taxInput.currency !== (input.market === 'SG' ? 'SGD' : (input.market === 'AU' ? 'AUD' : taxInput.currency)) && !(taxInput.fx_record && taxInput.fx_record.rate)) out.missing.push('fx_rate');

    // 有多个候选税目但未选定：归类方向待确认，先不承诺税额
    if (!taxInput.hs_candidate && cands.length > 1) {
      out.amount = STATE.PENDING;
      out.subtotal = STATE.PENDING;
      out.reason = REASON.HS_REVIEW;
      out.owner = OWNER.USER;
      out.missing = out.missing.concat(['hs_candidate']);
      return out;
    }

    var res = null;
    try { res = engine.calculateTaxes(data, taxInput); } catch (e) { res = null; }
    if (!res) {
      out.amount = STATE.NOT_SUPPORTED;
      out.subtotal = STATE.NOT_SUPPORTED;
      out.reason = REASON.SCENARIO_UNSUPPORTED;
      out.owner = OWNER.PLATFORM;
      return out;
    }
    out.blockers = res.blockers || [];
    var engineMissing = missingFromBlockers(out.blockers, taxInput);
    out.missing = unique(out.missing.concat(engineMissing));
    var hasLines = (res.lines || []).some(function (l) {
      return l && l.status === 'calculated' && Number.isFinite(l.amount) && Number.isFinite(l.base);
    });
    var partialTotal = res.known_statutory_subtotal !== null && res.known_statutory_subtotal !== undefined;

    if (out.missing.length && !hasLines && !partialTotal) {
      out.amount = STATE.NEEDS_INPUT;
      out.subtotal = STATE.NEEDS_INPUT;
      out.reason = REASON.USER_INPUT;
      out.owner = OWNER.USER;
      return out;
    }
    out.subtotal = res.complete_total !== null && res.complete_total !== undefined ? STATE.OK : (out.missing.length ? STATE.NEEDS_INPUT : STATE.NEEDS_REVIEW);
    out.amount = partialTotal || hasLines ? (out.blockers.length ? STATE.PARTIAL : STATE.OK) : STATE.NEEDS_INPUT;
    if (out.subtotal === STATE.OK) {
      out.reason = null;
      out.owner = OWNER.USER;
    } else if (out.missing.length) {
      out.reason = REASON.USER_INPUT;
      out.owner = OWNER.USER;
    } else if (out.reviewNeeded || out.blockers.length) {
      out.reason = REASON.EVIDENCE_PENDING;
      out.owner = OWNER.EXPERT;
    }
    return out;
  }

  function buildTaxInput(data, input, sc) {
    var t = input.tax || {};
    var yes = function (v) { return v === true || v === 'true'; };
    return {
      market: input.market,
      product_type: (sc && sc.legacy) || t.product_type || '',
      hs_candidate: input.hsChoice || '',
      hs_reviewed: yes(t.hsReviewed),
      origin: t.origin || '',
      import_date: t.importDate || input.placingOnMarketDate || '',
      goods_value: numOrNull(t.goodsValue),
      currency: t.currency || '',
      incoterm: t.incoterm || '',
      price_basis: t.priceBasis || '',
      freight: numOrNull(t.freight),
      insurance: numOrNull(t.insurance),
      multiple_sales: yes(t.multipleSales),
      lsp: numOrNull(t.lsp),
      last_buyer_is_declarant: yes(t.lastBuyerDeclarant),
      import_route: t.importRoute || 'bulk',
      special_valuation: t.specialValuation === 'yes' ? true : (t.specialValuation === 'unknown' ? 'unknown' : false),
      remedy_check: t.remedyCheck || '',
      confirmed_customs_value: numOrNull(t.confirmedCustomsValue),
      valuation_professionally_confirmed: yes(t.valuationConfirmed),
      customs_value_confirmed: numOrNull(t.customsValueConfirmed),
      origin_preference: t.originPreference || 'none',
      origin_psr_satisfied: yes(t.psrSatisfied) ? true : (t.psrSatisfied === 'unknown' ? 'unknown' : null),
      origin_documents_valid: yes(t.docsValid) ? true : null,
      transport_conditions_satisfied: yes(t.transportCond) ? true : null,
      transport: t.transport || '',
      sales_state: t.salesState || '',
      quantity: numOrNull(t.quantity),
      fx_record: t.fxRate ? { rate: Number(t.fxRate), source: t.fxSource || '' } : null
    };
  }

  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function missingFromBlockers(blockers, taxInput) {
    var miss = [];
    var text = (blockers || []).join(' ');
    if (/货值|海关价值/.test(text) && !isSet(taxInput.goods_value)) miss.push('goods_value');
    if (/运费/.test(text) && !isSet(taxInput.freight)) miss.push('freight');
    if (/保险/.test(text) && !isSet(taxInput.insurance)) miss.push('insurance');
    if (/原产地/.test(text) && !taxInput.origin) miss.push('origin');
    if (/进口日期/.test(text) && !taxInput.import_date) miss.push('import_date');
    if (/汇率/.test(text)) miss.push('fx_rate');
    if (/贸易术语|FOB\/CIF|incoterm/i.test(text) && !taxInput.incoterm) miss.push('incoterm');
    if (/HS 候选|归类/.test(text) && !taxInput.hs_candidate) miss.push('hs_candidate');
    return unique(miss);
  }
  function isSet(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
  function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

  /** 法规查询：法域链内与该小类相关的法规与已归档资料 */
  function regLookup(data, sc, input) {
    var chain = sc.jurisdictionChain || [];
    var regs = (data.regulations || []).filter(function (r) { return chain.indexOf(r.jurisdiction) >= 0; });
    var indexed = (sc.pendingRegulations || []).length;
    var executable = (sc.results || []).filter(function (r) { return r.regulationId; }).length;
    if (!input.market) return { state: STATE.NEEDS_INPUT, reason: REASON.USER_INPUT, count: 0, indexedOnly: 0, owner: OWNER.USER, action: 'product' };
    if (!regs.length) return { state: STATE.NOT_SUPPORTED, reason: REASON.REGULATION_DATA, count: 0, indexedOnly: 0, owner: OWNER.PLATFORM, action: 'policy' };
    return {
      state: executable ? STATE.OK : (indexed ? STATE.PARTIAL : STATE.OK),
      reason: executable ? null : REASON.REGULATION_DATA,
      count: regs.length, indexedOnly: indexed, ruleBacked: executable,
      owner: indexed ? OWNER.PLATFORM : OWNER.USER, action: 'policy'
    };
  }

  /** 合规初筛：必须有产品特定可执行规则才算可用 */
  function screeningCapability(sc, input, evidenceGate) {
    if (!input.market || !input.subcategoryId) return { state: STATE.NEEDS_INPUT, reason: REASON.USER_INPUT, missing: ['market', 'subcategoryId'], owner: OWNER.USER, action: 'product' };
    var results = sc.results || [];
    var backed = (sc.coverage && sc.coverage.profileBacked !== false) && (sc.coverage.backingRules || []).length > 0;
    var unknown = (sc.unknownRules || []).length;
    var applicable = (sc.applicableRules || []).length;
    if (!backed) {
      if (evidenceGate) {
        return {
          state: STATE.NOT_SUPPORTED, reason: REASON.PRODUCT_FACT, applicable: applicable, unknown: unknown,
          missing: [], owner: OWNER.PLATFORM, action: 'policy', rules: [],
          note: '该小类产品资料等级为 M1，尚未达到初筛所需的型号参数或说明书证据；市场侧规则已存在但未与本产品证据建立可执行关联。'
        };
      }
      return { state: STATE.NOT_SUPPORTED, reason: REASON.REGULATION_DATA, applicable: applicable, unknown: unknown, missing: [], owner: OWNER.PLATFORM, action: 'policy', rules: [] };
    }
    var missing = sc.missingFields || [];
    if (!applicable && unknown && missing.length) {
      return { state: STATE.NEEDS_INPUT, reason: REASON.PRODUCT_FACT, applicable: applicable, unknown: unknown, missing: missing, owner: OWNER.USER, action: 'compliance' };
    }
    if (unknown && missing.length) return { state: STATE.PARTIAL, reason: REASON.PRODUCT_FACT, applicable: applicable, unknown: unknown, missing: missing, owner: OWNER.USER, action: 'compliance' };
    return { state: STATE.OK, reason: null, applicable: applicable, unknown: unknown, missing: [], owner: OWNER.USER, action: 'compliance' };
  }

  /** 出海报告：至少有一条可追溯结论或可靠税费分项才能生成 */
  function reportCapability(caps, sc, input) {
    if (!input.name && !input.subcategoryId) return { state: STATE.NEEDS_INPUT, reason: REASON.USER_INPUT, missing: ['subcategoryId'], owner: OWNER.USER, action: 'product' };
    var screen = caps.screening.state;
    var tax = caps.tax.amount;
    var okCount = (sc.applicableRules || []).length;
    if (screen === STATE.NOT_SUPPORTED && tax === STATE.NOT_SUPPORTED && !okCount) {
      return { state: STATE.NEEDS_INPUT, reason: REASON.USER_INPUT, missing: unique(['market', 'subcategoryId'].concat(input.placingOnMarketDate ? [] : ['placingOnMarketDate'])), owner: OWNER.USER, action: 'product' };
    }
    var pending = (sc.pendingRegulations || []).length;
    return { state: pending || screen === STATE.PARTIAL || tax === STATE.PARTIAL ? STATE.PARTIAL : STATE.OK, reason: pending ? REASON.REGULATION_DATA : null, owner: pending ? OWNER.PLATFORM : OWNER.USER, action: 'report' };
  }

  /** 主入口：一次评估，输出全部功能状态与结构化缺口 */
  function evaluate(data, engine, input) {
    input = input || {};
    var sub = findSub(data, input.subcategoryId);
    var sc = engine.evaluateScenario(data, {
      market: input.market || '',
      subcategoryId: input.subcategoryId || '',
      facts: input.facts || {},
      placingOnMarketDate: input.placingOnMarketDate || ''
    });
    var staticProf = null;
    (data.coverageProfiles || []).forEach(function (c) {
      if (c.market !== input.market) return;
      if (c.sub ? c.sub === input.subcategoryId : (c.legacy && c.legacy === sc.legacy)) staticProf = c;
    });
    var evidenceGate = !!(staticProf && sc.coverage && sc.coverage.level === 'L1' && sub && sub.evidence === 'M1');
    var caps = {
      evidence: evidenceLevel(sub),
      service: serviceLevel(sc, input.market, sub),
      evidenceGate: evidenceGate,
      reg: regLookup(data, sc, input),
      screening: screeningCapability(sc, input, evidenceGate),
      hs: hsCapability(data, sc, input),
      tax: taxCapability(data, engine, input, sc),
      report: null
    };
    caps.report = reportCapability(caps, sc, input);
    var order = ['reg', 'screening', 'hs', 'tax', 'report'];
    var keys = { reg: 'reg_lookup', screening: 'screening', hs: 'hs_candidates', tax: 'tax_calc', report: 'report' };
    caps.features = order.map(function (k) {
      var c = caps[k];
      var state = c.state;
      if (k === 'tax') {
        // 税费功能整体状态：汇总可用 > 归类待确认 > 分项可算 > 仅税率可查 > 不支持
        if (c.subtotal === STATE.OK) state = STATE.OK;
        else if (c.amount === STATE.PENDING || c.subtotal === STATE.PENDING) state = STATE.PENDING;
        else if (c.amount === STATE.OK || c.amount === STATE.PARTIAL) state = STATE.PARTIAL;
        else if (c.rate === STATE.OK) state = STATE.NEEDS_INPUT;
        else state = c.rate === STATE.NOT_SUPPORTED ? STATE.NOT_SUPPORTED : STATE.NEEDS_REVIEW;
      }
      return {
        key: keys[k], state: state, reason: c.reason || null,
        missing: c.missing || [], count: c.count !== undefined ? c.count : (c.applicable !== undefined ? c.applicable : null),
        owner: c.owner || OWNER.PLATFORM, action: c.action || 'product',
        detail: c
      };
    });
    caps.gaps = caps.features.filter(function (f) { return f.state !== STATE.OK; }).map(function (f) {
      return { feature: f.key, state: f.state, reason: f.reason, missing: f.missing, owner: f.owner, action: f.action };
    });
    caps.scenario = sc;
    return caps;
  }

  /** 等级图谱：按实际数据枚举产品小类（M）与产品×市场组合（L） */
  function levelIndex(data, engine, opts) {
    opts = opts || {};
    var markets = opts.markets || (data.jurisdictions || []).map(function (j) { return j.code; });
    var subs = opts.subs || data.subcategories || [];
    var mGroups = { M1: [], M2: [], M3: [], unknown: [] };
    subs.forEach(function (s) { mGroups[/M[123]/.test(s.evidence || '') ? s.evidence : 'unknown'].push(s.id); });
    var lGroups = { L1: [], L2: [], L3: [] };
    var rows = [];
    subs.forEach(function (s) {
      markets.forEach(function (mk) {
        var caps = evaluate(data, engine, { market: mk, subcategoryId: s.id, facts: factsFromMap(data, s.id), placingOnMarketDate: opts.date || '' });
        var row = {
          market: mk, sub: s.id, subName: s.name, nameEn: s.nameEn || '', group: s.group,
          m: caps.evidence.code, l: caps.service.code, staticL: caps.service.staticLevel,
          reg: caps.reg.state, screen: caps.screening.state, hs: caps.hs.state, hsCount: caps.hs.count,
          taxRate: caps.tax.rate, taxAmount: caps.tax.amount, taxSubtotal: caps.tax.subtotal,
          report: caps.report.state, gaps: caps.gaps
        };
        rows.push(row);
        if (/^L[123]$/.test(caps.service.code)) lGroups[caps.service.code].push(s.id + '@' + mk);
      });
    });
    return { mGroups: mGroups, lGroups: lGroups, rows: rows };
  }

  /** 用动态映射里的小类默认事实（未知）构造最小输入，用于批量枚举能力 */
  function factsFromMap(data, subId) {
    var facts = {};
    (data.dynamicMap || []).forEach(function (m) {
      if (m.sub !== subId) return;
      var f = null;
      (data.fields || []).forEach(function (x) { if (x.id === m.field) f = x; });
      if (!f || !f.key) return;
      if (facts[f.key] !== undefined) return;
      facts[f.key] = null;
    });
    return facts;
  }

  var api = {
    STATE: STATE, REASON: REASON, OWNER: OWNER,
    evaluate: evaluate, levelIndex: levelIndex, evidenceLevel: evidenceLevel,
    serviceLevel: serviceLevel, taxCapability: taxCapability, buildTaxInput: buildTaxInput,
    factsFromMap: factsFromMap, findSub: findSub
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.VOCapability = api;
})(typeof window !== 'undefined' ? window : globalThis);
