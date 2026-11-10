/*! 远见·企业出海助手 —— 主应用（向导主线 + 按需追问 + 实时计算）
 * 所有模块共享同一项目情景；输入变化即时重算，旧结果按输入指纹标记失效。 */
(function () {
  'use strict';

  var D = window.VO_DATA;
  var E = window.VOEngine;
  var NEWS = window.VO_NEWS || { meta: { exportedAt: '', sources: [], allFailed: false, snapshotNote: '新闻数据缺失' }, items: [] };

  /* ================= 小工具 ================= */
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) node.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function toast(msg, type) {
    var wrap = $('toastWrap');
    var t = h('div', { class: 'toast ' + (type || '') }, msg);
    wrap.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 2600);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3100);
  }
  function fmtMoney(v, currency) {
    if (v === null || v === undefined) return '—';
    return currency + ' ' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d)) return String(s).slice(0, 10);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    var d = new Date(s);
    if (isNaN(d)) return String(s);
    return fmtDate(s) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  /** 统一按北京时间（UTC+8）显示实际更新时间，不随访问者时区变化 */
  function fmtBeijing(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d)) return String(s);
    var t = new Date(d.getTime() + (480 + d.getTimezoneOffset()) * 60000);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) + ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes());
  }
  function newsUpdatedText() {
    var m = (NEWS.meta || {});
    var stamp = fmtBeijing(m.lastSuccessAtBeijing || m.updatedAtBeijing || m.exportedAt);
    var en = langKey() === 1;
    if (!stamp) return en ? 'Policy Updates | Last updated: not recorded' : '政策动态｜最近更新：未记录';
    return (en ? 'Policy Updates | Last updated: ' : '政策动态｜最近更新：') + stamp + (en ? ' (UTC+8)' : '（北京时间）');
  }
  function newsId(it) { return E.hashInputs({ u: it.url, t: it.title }); }
  var sourceMap = {};
  D.sources.forEach(function (s) { sourceMap[s.id] = s; });
  function sourceLink(id) {
    var s = sourceMap[id];
    if (!s) return h('span', { class: 'tag' }, id);
    var a = h('a', { href: s.pdfPath || s.url || '#', target: '_blank', rel: 'noopener noreferrer' }, (s.title || id) + (s.pdfPath ? ' · PDF' : /\.pdf(?:[?#]|$)/i.test(s.url || '') ? ' · 官方 PDF' : ' · 查看官方网页'));
    var related = { 'SRC-195': 'SG-CPSR-consolidated-20250701.pdf', 'SRC-199': 'SG-CPSR-consolidated-20250701.pdf', 'SRC-161': 'SG-CPSR-consolidated-20250701.pdf', 'SRC-162': 'SG-CPSR-consolidated-20250701.pdf' }[id];
    if (related) return h('span', { class: 'tag brand' }, h('a', { href: 'policy-documents/SG/' + related, target: '_blank', rel: 'noopener noreferrer' }, 'CPSR 法规 PDF（2025-07-01 版）'), ' · ', a);
    return h('span', { class: 'tag brand', title: (s.verification ? '版本：' + (s.pdfVersion || '见官方来源') + '；官方来源：' + s.url + '；' : '') + '核验日期：' + (s.checkedAt || '未记录') }, a);
  }
  function sourceLinks(ids) {
    var wrap = h('span', {});
    (ids || []).slice(0, 6).forEach(function (id, i) {
      if (i) wrap.appendChild(document.createTextNode(' '));
      wrap.appendChild(sourceLink(id));
    });
    if ((ids || []).length > 6) wrap.appendChild(h('span', { class: 'subhint' }, ' 等 ' + ids.length + ' 条来源'));
    return wrap;
  }
  function lookupField(key) {
    var f = null;
    D.fields.forEach(function (x) { if (x.key === key || x.ruleKey === key) f = x; });
    if (!f) D.ruleFields.forEach(function (x) { if (x.key === key) f = x; });
    if (!f && EXTRA_FIELDS[key]) f = EXTRA_FIELDS[key];
    return f;
  }
  function optionsOf(field) {
    var opts = String(field.options || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean);
    if (field.type === 'boolean' || (field.type === 'select' && opts[0] === 'yes' && opts.indexOf('no') >= 0)) {
      return [{ v: true, label: '是' }, { v: false, label: '否' }];
    }
    return opts.filter(function (o) { return o !== 'unknown'; }).map(function (o) {
      var label = o === 'yes' ? '是' : o === 'no' ? '否' : o;
      return { v: o === 'yes' ? true : o === 'no' ? false : o, label: label };
    });
  }
  function fieldType(field) {
    if (field.type === 'number' || field.type === 'integer') return 'number';
    if (field.type === 'date') return 'date';
    var opts = optionsOf(field);
    if (field.type === 'tri_state' || (opts.length === 2 && opts[0].v === true && opts[1].v === false)) return 'tri';
    return 'select';
  }

  // 补充字段定义：原始规则使用、但 80 项字段字典未覆盖的产品事实
  var EXTRA_FIELDS = {
    boils_water: { key: 'boils_water', name: '是否以煮沸水为主要功能', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    electrical_class: { key: 'electrical_class', name: '电气类别（防电击保护）', type: 'select', options: 'Class I|Class II|Class III|unknown', unknownAllowed: true },
    detachable_cord: { key: 'detachable_cord', name: '电源线是否可拆卸', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    power_kw: { key: 'power_kw', name: '额定输入功率', type: 'number', unit: 'kW', unknownAllowed: true },
    voltage_dc: { key: 'voltage_dc', name: '直流电压', type: 'number', unit: 'V', unknownAllowed: true },
    registration_expired: { key: 'registration_expired', name: '已有注册是否已过期（如适用）', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    modified: { key: 'modified', name: '与已注册型号相比是否经过修改', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    iot: { key: 'iot', name: '是否具备物联网/联网功能', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    complete_unit: { key: 'complete_unit', name: '是否为完整设备（非部件/散件）', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    set_goods: { key: 'set_goods', name: '是否作为成套商品申报', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    packaging_turnover: { key: 'packaging_turnover', name: '包装年营业额（如适用）', type: 'number', unit: '等值', unknownAllowed: true },
    specified_packaging: { key: 'specified_packaging', name: '包装类型是否符合目录口径', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
    special_claim: { key: 'special_claim', name: '是否作出特殊宣称（如健康/抗菌）', type: 'select', options: 'yes|no|unknown', unknownAllowed: true },
  };

  /* ================= 状态与保存 ================= */
  var LS_KEY = 'vo-r1-workbench-v2';
  var state = null;
  function defaultSettings() {
    return { region: 'cn', model: 'qwen-plus', customModel: '', apiKey: '', apiBase: '' };
  }
  function defaultProject(name) {
    var now = new Date().toISOString();
    return {
      id: 'P' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || '新项目',
      companyId: '', companyName: '',
      createdAt: now, updatedAt: now,
      scenario: { market: '', subcategoryId: '', placingOnMarketDate: '', importDate: '', role: '', facts: {}, factsUnknown: {}, factNotes: {} },
      tax: { goodsValue: '', currency: 'SGD', fxRate: '', fxSource: '', incoterm: 'FOB', priceBasis: 'FOB', freight: '', insurance: '', multipleSales: false, lsp: '', lastBuyerDeclarant: '', importRoute: 'bulk', specialValuation: 'no', remedyCheck: '', confirmedCustomsValue: '', valuationConfirmed: false, customsValueConfirmed: '', origin: 'CN', originPreference: 'none', psrSatisfied: '', docsValid: '', transportCond: '', transport: 'sea', salesState: 'VIC', quantity: '' },
      hsChoice: '',
      researchEvidence: null,
      todoState: {},
      newsSelected: [],
      qianwen: { taskText: '', taskHash: '', taskAt: '', responses: [] },
      reportSnapshots: []
    };
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { state = JSON.parse(raw); if (!state.projects || !state.projects.length) throw new Error('empty'); }
      else throw new Error('empty');
    } catch (e) {
      state = { v: 2, projects: [defaultProject('示例项目')], currentId: null, settings: defaultSettings() };
      state.currentId = state.projects[0].id;
      persist(false);
    }
    if (!state.settings) state.settings = defaultSettings();
    if (!state.currentId || !state.projects.some(function (p) { return p.id === state.currentId; })) {
      state.currentId = state.projects[0].id;
    }
  }
  var saveTimer = null;
  function persist(feedback) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      var el = $('saveHint');
      if (el) el.textContent = '已保存到本机 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
      if (feedback) toast('已保存到本机浏览器（仅本设备，非多人协作）', 'ok');
    } catch (e) {
      var el2 = $('saveHint');
      if (el2) el2.textContent = '本机保存不可用（隐私模式或存储被禁用），仅当前会话有效';
      if (feedback) toast('保存失败：' + e.message, 'err');
    }
  }
  function queueSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { persist(false); }, 400);
  }
  function proj() {
    return state.projects.find(function (p) { return p.id === state.currentId; });
  }
  function touch() { proj().updatedAt = new Date().toISOString(); queueSave(); }

  function inputHash() {
    var p = proj();
    return E.hashInputs({
      market: p.scenario.market, sub: p.scenario.subcategoryId,
      facts: p.scenario.facts, factsUnknown: p.scenario.factsUnknown,
      dates: [p.scenario.placingOnMarketDate, p.scenario.importDate], role: p.scenario.role,
      tax: p.tax, hs: p.hsChoice, news: p.newsSelected,
      research: p.researchEvidence || null
    });
  }

  /* ---------- 事实读写 ---------- */
  function setFact(key, val) {
    var p = proj().scenario;
    if (val === 'unknown') { delete p.facts[key]; p.factsUnknown[key] = true; }
    else { p.factsUnknown[key] = false; if (val === '' || val === undefined) delete p.facts[key]; else p.facts[key] = val; }
    touch();
  }
  function getFact(key) {
    var p = proj().scenario;
    if (p.factsUnknown[key]) return 'unknown';
    var v = p.facts[key];
    return v === undefined ? '' : v;
  }
  function engineFacts() {
    var p = proj().scenario;
    var out = {};
    Object.keys(p.facts).forEach(function (k) {
      var v = p.facts[k];
      if (v === '' || v === null || v === undefined) return;
      if (v === 'true') out[k] = true;
      else if (v === 'false') out[k] = false;
      else out[k] = v;
    });
    return out;
  }


  // Product group icons are decorative; category names remain the accessible labels.
  var groupIconPaths = {
    'GRP-BEV': 'M6 8h10v7a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8zm10 2h2a2 2 0 0 1 0 4h-2M8 4v2m4-2v2',
    'GRP-COOK': 'M4 10h16v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7zm-1 0h18M7 7h10M12 5v2',
    'GRP-PREP': 'M7 4h10l-1 11H8L7 4zm2 11v4m6-4v4M7 20h10M9 8h6',
    'GRP-VAC': 'M14 4l-5 10m5-10 3 2-5 10-3-2M6 17h8l2 3H4l2-3z',
    'GRP-WET': 'M12 3c-2 3-5 6-5 9a5 5 0 0 0 10 0c0-3-3-6-5-9zM9 14c.4 1 1.3 1.5 2.5 1.5',
    'GRP-MOVE': 'M12 12c-5 1-7-1-6-4s5-2 6 4zm0 0c2-5 5-5 7-3s-1 5-7 3zm0 0c3 4 2 7-1 7s-4-3 1-7z',
    'GRP-QUAL': 'M4 8h11a3 3 0 1 0-3-3M3 12h16M5 16h10a3 3 0 1 1-3 3',
    'GRP-HAIR': 'M4 7h9a4 4 0 0 1 0 8h-2l2 5H9l-2-5H4V7zm13 2h3m-3 3h4m-4 3h3',
    'GRP-GROOM': 'M9 4h6v4h2v11H7V8h2V4zm0 7h6m-3 3v3',
    'GRP-ORAL': 'M9 4h6v4H9V4zm0 4h6l-1 11a2 2 0 0 1-4 0L9 8zm2 4h2',
    'GRP-IRON': 'M4 17c1-5 5-8 11-8h3l2 8H4zm6-8V6h5a3 3 0 0 1 3 3M3 20h18',
    'GRP-FAB': 'M7 4h10a2 2 0 0 1 2 2v10a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V6a2 2 0 0 1 2-2zm2 5h6m-6 3h6m-6 3h6'
  };
  function groupIcon(id) {
    var ns = 'http://www.w3.org/2000/svg';
    var icon = document.createElementNS(ns, 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '1.7');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', groupIconPaths[id] || 'M4 4h16v16H4z');
    icon.appendChild(path);
    return icon;
  }
  var homeGroups = $('homeGroups');
  if (homeGroups) D.groups.forEach(function (g) {
    var members = D.subcategories.filter(function (s) { return s.group === g.id; });
    homeGroups.appendChild(h('button', { type: 'button', class: 'cat-card', onclick: function () {
      proj().scenario.subcategoryId = members[0].id; selectedGroup = g.id; proj().hsChoice = ''; proj().tax.hsReviewed = false; touch(); showTab('product');
    } }, h('div', { class: 'cat-card-title' }, h('span', { class: 'cat-icon' }, groupIcon(g.id)), h('h4', {}, g.name)), h('p', {}, members.length + ' 个产品小类'), h('span', { class: 'text-button' }, '选择产品 →')));
  });

  /* ================= 派生数据与覆盖判断 ================= */
  var ruleJ = {};
  D.rules.forEach(function (r) { ruleJ[r.jurisdiction] = true; });
  var JUR = {};
  D.jurisdictions.forEach(function (j) { JUR[j.code] = j; });
  var TAX_MARKETS = {};
  D.taxProfiles.forEach(function (tp) { TAX_MARKETS[tp.market] = true; });
  function chainOf(code) { return E.jurisdictionChain(D, code); }
  function marketHasRules(code) { return chainOf(code).some(function (c) { return ruleJ[c]; }); }
  function subById(id) { return D.subcategories.find(function (s) { return s.id === id; }) || null; }

  /** 轻量覆盖判断（不打全量引擎）：返回该「品类 × 目的地」实际能走到哪一步 */
  function supportOf(market, sub) {
    if (!market) return { level: '', label: '未选目的地' };
    if (!sub) return { level: '', label: '未选品类' };
    var sc = E.evaluateScenario(D, { market: market, subcategoryId: sub.id, facts: {} });
    var cov = sc.coverage;
    // 静态画像写入的 L2/L3 只有匹配到产品特定可执行规则时才算能力承诺
    var backed = cov.profileBacked !== false && (cov.backingRules || []).length > 0;
    var hasTax = (D.taxProfiles || []).some(function (t) { return t.market === market && t.product_type === sub.legacy; });
    var label;
    if (cov.level === 'L3' && hasTax && backed) label = '支持税费测算';
    else if ((cov.level === 'L2' || cov.level === 'L3') && backed) label = '支持合规初筛';
    else if (sc.pendingRegulations && sc.pendingRegulations.length) label = '支持法规查询';
    else if (cov.level !== 'L1') label = '支持法规查询';
    else label = '资料待补充';
    return { level: cov.level, label: label, hasTax: hasTax, backed: backed, indexed: (sc.pendingRegulations || []).length > 0 || cov.level !== 'L1' };
  }

  /** 服务档位：把资料成熟度（M）与覆盖能力（L）合成一句用户能执行的话 */
  function serviceTier(market, sub) {
    if (!market || !sub) return { key: 'todo', def: TIER_DEF.todo, why: '先选择目的地与品类，这里会显示该组合能做到哪一步。' };
    var sup = supportOf(market, sub);
    var jur = JUR[market] ? JUR[market].name : market;
    var idxCount = D.regulations.filter(function (r) { return chainOf(market).indexOf(r.jurisdiction) >= 0; }).length;
    if (sup.key === 'calc' || (sup.level === 'L3' && sup.hasTax && sup.backed)) return { key: 'calc', def: TIER_DEF.calc, why: jur + ' × ' + sub.name + '：有可执行规则、目的国 HS 候选与已核对的税费配置，可逐项测算（仍不等于正式归类或全部到岸成本）。' };
    if ((sup.level === 'L2' || sup.level === 'L3') && sup.backed) return { key: 'screen', def: TIER_DEF.screen, why: jur + ' 有可执行规则，可出合规清单与待办；税费能否测算取决于该品类是否有已核对配置。' };
    if (sub.evidence === 'M1') return { key: 'draft', def: TIER_DEF.draft, why: '「' + sub.name + '」的产品资料仍是草案等级（未完成两个型号的官方核对），暂时只做资料查询。' };
    if ((sup.level === 'L2' || sup.level === 'L3') && !sup.backed) return { key: 'nav', def: TIER_DEF.nav, why: jur + ' × ' + sub.name + ' 在资料库里有覆盖标记，但还没有匹配到针对这款产品的可执行条款规则，因此只输出资料查询与原文入口，不给出适用性或税额结论。' };
    if (idxCount) return { key: 'nav', def: TIER_DEF.nav, why: jur + ' 目前只有 ' + idxCount + ' 条法规索引、还没有可执行规则，因此只做资料查询。注意：卡住的是这个国家的规则资料，不是「' + sub.name + '」的产品资料（其成熟度为 ' + sub.evidence + '）。' };
    return { key: 'none', def: TIER_DEF.none, why: jur + ' 在本产品库中既无可执行规则也无可核对的法规索引，不会输出结论。' };
  }
  var TIER_DEF = {
    calc: { label: '支持税费测算', cls: 'tier-calc', hint: '有可执行规则、HS 候选与已核对税费配置，可逐项测算；不等于正式归类或全部到岸成本' },
    screen: { label: '支持合规初筛', cls: 'tier-screen', hint: '有可执行规则：可追问事实、给出适用判断与待办；税费可能因资料不足留空' },
    nav: { label: '支持法规查询', cls: 'tier-nav', hint: '只有法规索引：可查原文与缺口，不输出适用性或税额结论' },
    draft: { label: '产品资料待补充', cls: 'tier-draft', hint: '该品类资料为草案等级（M1），未完成两个型号的官方核对' },
    none: { label: '暂不覆盖', cls: 'tier-none', hint: '该目的地暂无可执行规则与法规索引' },
    todo: { label: '待选择', cls: 'tier-none', hint: '先选择目的地与品类' }
  };
  /** 服务等级代码：与能力层一致（calc=L3、screen=L2、其余=L1） */
  function tierLevelOf(tier) {
    if (tier.key === 'calc') return 'L3';
    if (tier.key === 'screen') return 'L2';
    return 'L1';
  }
  function tierBadge(tier, small) {
    return h('span', { class: 'tier ' + tier.def.cls + (small ? ' sm' : ''), title: tier.def.hint }, tier.def.label);
  }

  /* ================= 导航（侧栏向导） ================= */
  var flowSteps = ['home', 'product', 'compliance', 'tax', 'news', 'qianwen', 'report'];
  var currentTab = 'home';
  var lastFlowTab = 'product';
  function showTab(name) {
    if (name !== 'about') lastFlowTab = name;
    currentTab = name;
    document.querySelectorAll('#sideNav .nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('on', v.id === 'view-' + name); });
    window.scrollTo(0, 0);
    renderTab(name);
    updateDots();
  }
  /** 语言层：渲染完成后按当前界面语言处理文本节点（业务数据与计算不受影响） */
  function localize(host) {
    try { if (window.VOI18N) window.VOI18N.apply(host || document.body); } catch (e) { /* 语言层失败不影响业务渲染 */ }
  }
  function renderTab(name) {
    var host = document.getElementById('view-' + name);
    if (name === 'home') { localize(host); return; }
    if (name === 'about') { renderGuide(); localize(host); return; }
    if (name === 'product') { renderCompanies(); renderProduct(); }
    else if (name === 'compliance') renderCompliance();
    else if (name === 'tax') renderTax();
    else if (name === 'news') renderNews();
    else if (name === 'qianwen') renderQianwen();
    else if (name === 'report') renderReport();
    else if (name === 'about') renderAbout();
    localize(host);
  }
  /** 回答事实/修改输入后统一刷新：重渲染当前视图 + 步骤状态点 */
  var refreshing = false;
  function refreshAll() {
    if (refreshing) return;
    refreshing = true;
    try {
    var active = document.activeElement;
    var qa = active && active.closest('[data-fact]');
    var key = qa && qa.getAttribute('data-fact');
    var index = qa ? Array.from(qa.querySelectorAll('input,select,button')).indexOf(active) : -1;
    var top = qa && qa.getBoundingClientRect().top;
    var y = window.scrollY;
    renderTab(currentTab);
    if (key) {
      var next = Array.from(document.querySelectorAll('[data-fact]')).find(function (n) { return n.getAttribute('data-fact') === key; });
      if (next) {
        var control = next.querySelectorAll('input,select,button')[index];
        if (control) control.focus({ preventScroll: true });
        window.scrollTo(0, window.scrollY + next.getBoundingClientRect().top - top);
      } else window.scrollTo(0, y);
    }
    if (currentTab !== 'product' && currentTab !== 'about') updateDots();
    else { updateDots(); }
    } finally { refreshing = false; }
  }
  function updateDots() {
    var p = proj();
    var ok = { product: !!(p.scenario.market && p.scenario.subcategoryId), news: p.newsSelected.length > 0 };
    var sc = null;
    try { sc = (ok.product) ? runCompliance() : null; } catch (e) { sc = null; }
    var tax = null;
    try { tax = E.calculateTaxes(D, taxInput()); } catch (e) { tax = null; }
    var cur = inputHash();
    setDot('dot-product', ok.product ? 'done' : 'warn');
    if (sc) {
      setDot('dot-compliance', sc.applicableRules.length > 0 && sc.unknownRules.length === 0 ? 'done' : (sc.applicableRules.length ? 'warn' : 'warn'));
      setDot('dot-tax', tax && tax.complete_total !== null ? 'done' : (sc.hsCandidates.length ? 'warn' : 'warn'));
    } else { setDot('dot-compliance', 'warn'); setDot('dot-tax', 'warn'); }
    setDot('dot-news', ok.news ? 'done' : '');
    var resp = p.qianwen.responses;
    setDot('dot-qianwen', resp.length ? (resp[0].hash === cur ? 'done' : 'warn') : '');
    setDot('dot-report', p.reportSnapshots.length ? (p.reportSnapshots[0].hash === cur ? 'done' : 'warn') : '');
    var nm = $('projMiniName');
    if (nm) nm.textContent = p.name;
  }
  function setDot(id, cls) {
    var el = $(id);
    if (!el) return;
    el.className = 'dot' + (cls ? ' ' + cls : '');
  }

  /* ================= 第 1 步：企业案例带入 ================= */
  function renderCompanies() {
    var host = $('companyList');
    if (!host) return;
    clear(host);
    var grid = h('div', { class: 'grid2' });
    D.companies.forEach(function (c) {
      var card = h('div', { class: 'card', style: 'margin:0' });
      card.appendChild(h('h4', {}, c.name));
      card.appendChild(h('p', { class: 'subhint' }, c.tagline));
      var route = h('details', { class: 'box' });
      route.appendChild(h('summary', {}, c.researchRoute.title));
      route.appendChild(h('p', { class: 'banner warn' }, c.researchRoute.disclaimer));
      var ol = h('ol', { style: 'margin:6px 0 8px 20px;padding:0' });
      c.researchRoute.steps.forEach(function (s) { ol.appendChild(h('li', { style: 'font-size:13px' }, s)); });
      route.appendChild(ol);
      c.researchRoute.sources.forEach(function (s) {
        route.appendChild(h('div', { style: 'font-size:12.5px;margin:2px 0' }, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label)));
      });
      card.appendChild(route);
      c.products.forEach(function (pr) {
        var row = h('div', { class: 'qa' });
        row.appendChild(h('div', { class: 'q' }, pr.model));
        row.appendChild(h('div', { class: 'meta' }, pr.category + '｜' + pr.facts));
        row.appendChild(h('div', { class: 'why' }, '待核实：' + pr.pending));
        var srcLine = h('div', { class: 'meta' });
        pr.sources.forEach(function (s, i) {
          if (i) srcLine.appendChild(document.createTextNode(' '));
          srcLine.appendChild(h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label));
        });
        row.appendChild(srcLine);
        row.appendChild(h('button', {
          class: 'btn sm sec', style: 'margin-top:7px',
          onclick: function () { bringIn(c, pr); }
        }, '带入本项目'));
        card.appendChild(row);
      });
      var fin = h('details', { class: 'box' });
      fin.appendChild(h('summary', {}, '财报税费数据（' + c.finance.length + ' 条）'));
      c.finance.forEach(function (f) {
        fin.appendChild(h('div', { style: 'font-size:12.5px;margin:3px 0' }, f.period + '｜' + f.item + '：' + f.value + ' ',
          h('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer' }, f.src)));
      });
      fin.appendChild(h('p', { class: 'subhint' }, c.financeNote));
      card.appendChild(fin);
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function bringIn(company, product) {
    var p = proj();
    p.companyId = company.id;
    p.companyName = company.name;
    p.scenario.subcategoryId = product.subcategoryId;
    var routeMarket = company.markets[0] ? company.markets[0].code : '';
    if (!p.scenario.market) p.scenario.market = routeMarket;
    var bf = product.bringFacts || {};
    var map = {
      household: 'household', endUse: 'end_use', voltageAc: 'voltage_ac', frequencyHz: 'frequency_hz',
      capacityL: 'capacity_l', mainFunction: 'main_function', wirelessPresent: 'wireless_present',
      internetConnected: 'internet_connected', batteryPresent: 'battery_present', foodContact: 'food_contact'
    };
    Object.keys(map).forEach(function (k) {
      if (bf[k] !== undefined) {
        p.scenario.facts[map[k]] = bf[k];
        p.scenario.factsUnknown[map[k]] = false;
        p.scenario.factNotes[map[k]] = '企业档案带入（' + product.model + ' 国内/官网版参数，出口版需重核）';
      }
    });
    if (bf.powerW) {
      p.scenario.facts.power_kw = bf.powerW / 1000;
      p.scenario.factsUnknown.power_kw = false;
      p.scenario.factNotes.power_kw = '企业档案带入（' + product.model + '）；国内版功率';
    }
    p.scenario.facts.household = true;
    p.scenario.facts.end_use = 'consumer';
    p.scenario.factsUnknown.household = false;
    p.scenario.factsUnknown.end_use = false;
    p.name = company.name + ' ' + product.model.split('（')[0] + ' 项目';
    touch();
    var box = $('companyQuick');
    if (box) box.open = false;
    refreshAll();
    refreshProjSelect();
    toast('已带入「' + product.model + '」研究参数（国内/官网版，出口版需重核）', 'ok');
  }

  /* ================= 第 1 步：项目与产品 ================= */
  function renderProduct() {
    var p = proj();
    $('pName').value = p.name;
    $('pCompany').value = p.companyName || '';
    $('pPlacingDate').value = p.scenario.placingOnMarketDate || '';
    $('pImportDate').value = p.scenario.importDate || '';
    $('pRole').value = p.scenario.role || '';
    renderMarketSelect();
    renderGroupChips();
    renderSubList();
    renderBizFacts();
    renderKeyFacts();
    renderMoreFacts();
    updateStep1Summary();
  }

  function renderMarketSelect() {
    var p = proj();
    var sel = $('pMarket');
    clear(sel);
    sel.appendChild(h('option', { value: '' }, '请选择目的地'));
    var g1 = h('optgroup', { label: '部分产品支持税费测算（SG / AU）' });
    var g2 = h('optgroup', { label: '可条件初筛' });
    var g3 = h('optgroup', { label: '仅法规资料（选择后只会显示导航与缺口）' });
    D.jurisdictions.forEach(function (j) {
      var opt = h('option', { value: j.code }, j.name + '（' + j.code + '）');
      if (TAX_MARKETS[j.code]) g1.appendChild(opt);
      else if (marketHasRules(j.code)) g2.appendChild(opt);
      else g3.appendChild(opt);
    });
    sel.appendChild(g1); sel.appendChild(g2); sel.appendChild(g3);
    sel.value = p.scenario.market || '';
    $('marketNote').textContent = marketNoteText(p.scenario.market);
  }
  function marketNoteText(code) {
    if (!code) return '选择实际销售的目的地。不同地方适用要求不同，选完品类后会显示这里能做到哪一步。';
    var j = JUR[code];
    if (!j) return '';
    var inherits = (j.inherits || []).map(function (c) { return JUR[c] ? JUR[c].name : c; }).join('、');
    var tier = TAX_MARKETS[code] ? '这里的部分产品已有核对过的税费配置，可测算；其余看所选产品的标签。' : marketHasRules(code) ? '这里可出合规清单；税费能否测算按产品显示。' : '这里目前只能查法规资料，不会生成初筛结论或税额。';
    return (j.note || '') + (inherits ? '；继承：' + inherits + '。' : '') + ' ' + tier;
  }

  var selectedGroup = '';
  function renderGroupChips() {
    var host = $('groupChips');
    clear(host);
    var p = proj();
    var sub = subById(p.scenario.subcategoryId);
    if (sub && !selectedGroup) selectedGroup = sub.group;
    D.groups.forEach(function (g) {
      var count = D.subcategories.filter(function (s) { return s.group === g.id; }).length;
      var btn = h('button', {
        type: 'button', class: selectedGroup === g.id ? 'on' : '',
        onclick: function () { selectedGroup = g.id; renderGroupChips(); renderSubList(); }
      }, g.name, h('em', {}, String(count)));
      host.appendChild(btn);
    });
  }
  function renderSubList() {
    var host = $('subList');
    clear(host);
    var p = proj();
    if (!selectedGroup) { host.appendChild(h('p', { class: 'subhint' }, '选择上方产品组后显示品类卡片。')); return; }
    var market = p.scenario.market;
    var subs = D.subcategories.filter(function (s) { return s.group === selectedGroup; })
      .sort(function (a, b) {
        var ra = supportOf(market, a), rb = supportOf(market, b);
        var order = { L3: 0, L2: 1, L1: 2, '': 3 };
        return (order[ra.level] === undefined ? 3 : order[ra.level]) - (order[rb.level] === undefined ? 3 : order[rb.level]);
      });
    subs.forEach(function (s) {
      var sup = supportOf(market, s);
      var on = p.scenario.subcategoryId === s.id;
      var item = h('div', {
        class: 'sub-item' + (on ? ' on' : '') + (s.evidence === 'M1' ? ' m1' : ''),
        onclick: function () {
          proj().scenario.subcategoryId = s.id; proj().hsChoice = ''; proj().tax.hsReviewed = false;
          touch();
          refreshAll();
        }
      });
      item.appendChild(h('div', { class: 's-name' }, s.name));
      var badges = h('div', { class: 's-badges' });
      var tier = serviceTier(market, s);
      badges.appendChild(tierBadge(tier, true));
      badges.appendChild(h('span', { class: 'tag', title: '产品资料成熟度与目的地无关：M1 草案 / M2 官方系列页多型号 / M3 官方多型号且说明书已核对' },
        (langKey() === 1 ? 'Evidence ' : '产品资料 ') + s.evidence));
      if (market) {
        badges.appendChild(h('span', { class: 'tag', title: '该目的地的服务等级；由可执行规则、HS 候选与税费配置共同判定' },
          (langKey() === 1 ? 'Service ' : '市场服务 ') + tierLevelOf(tier, market, s)));
        var probe = window.VOCapability.evaluate(D, E, {
          market: market, subcategoryId: s.id,
          facts: window.VOCapability.factsFromMap(D, s.id), placingOnMarketDate: p.scenario.placingOnMarketDate || ''
        });
        [['税率可查', 'Tariff rate', probe.tax.rate], ['税额可算', 'Duty calc', probe.tax.amount], ['汇总可用', 'Subtotal', probe.tax.subtotal]].forEach(function (t) {
          badges.appendChild(h('span', { class: 'tag ' + (t[2] === 'ok' ? 'ok' : (t[2] === 'not_supported' ? '' : 'warn')) }, langKey() === 1 ? t[1] : t[0]));
        });
      }
      item.appendChild(badges);
      item.appendChild(h('div', { class: 'meta', style: 'font-size:12px;color:var(--faint);margin-top:5px' }, s.core + '｜' + s.keyParams));
      host.appendChild(item);
    });
    var sub = subById(p.scenario.subcategoryId);
    $('subNote').textContent = sub
      ? '已选：' + sub.name + '。可变配置：' + sub.variable + '。HS 相关特征：' + sub.hsFeatures + '。'
      : '选择产品后查看适用要求。产品参数帮助合规判断与归类，税率还取决于目的地、原产地及进口日期。';
  }

  var BIZ_FACTS = [
    { key: 'consumer_product', label: '是否面向消费者的产品' },
    { key: 'offered_online', label: '是否在线向目的地消费者展示销售要约' }
  ];
  function renderBizFacts() {
    var host = $('bizFacts');
    clear(host);
    var p = proj();
    var codes = chainOf(p.scenario.market);
    var list = BIZ_FACTS.slice();
    if (codes.indexOf('EU') >= 0) list.push({ key: 'eu_established_economic_operator', label: '是否已有欧盟境内责任经济运营者' });
    if (codes.indexOf('EU') >= 0 || codes.indexOf('UK_GB') >= 0) list.push({ key: 'packaging_present', label: '投放市场时是否带包装' });
    list.forEach(function (f) { host.appendChild(triControl(f.label, f.key)); });
  }
  function triControl(label, key, whyText) {
    var val = getFact(key);
    var wrap = h('div', { 'data-fact': key, class: 'qa' + (val !== '' && val !== 'unknown' ? ' answered' : '') });
    wrap.appendChild(h('div', { class: 'q' }, label));
    if (val === 'unknown') wrap.appendChild(h('div', { class: 'why' }, '已标记不确定：相关判断保持「待确认」，不按否处理。'));
    else if (whyText) wrap.appendChild(h('div', { class: 'meta' }, whyText));
    var notes = proj().scenario.factNotes[key];
    if (notes) wrap.appendChild(h('div', { class: 'meta' }, '来源：' + notes));
    var tri = h('div', { class: 'tri' });
    [['true', '是'], ['false', '否'], ['unknown', '不确定']].forEach(function (pair) {
      var on = (pair[0] === 'unknown') ? val === 'unknown' : (val === true && pair[0] === 'true') || (val === false && pair[0] === 'false');
      tri.appendChild(h('button', {
        type: 'button', class: (pair[0] === 'unknown' ? 'unknown ' : '') + (on ? 'on' : ''),
        onclick: function () { setFact(key, pair[0] === 'unknown' ? 'unknown' : (pair[0] === 'true')); refreshAll(); }
      }, pair[1]));
    });
    wrap.appendChild(tri);
    return wrap;
  }

  function dynQuestions() {
    var sub = proj().scenario.subcategoryId;
    if (!sub) return [];
    return D.dynamicMap.filter(function (m) { return m.sub === sub; })
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (m) {
        var f = null;
        D.fields.forEach(function (x) { if (x.id === m.field) f = x; });
        if (!f) return null;
        return { map: m, field: f };
      }).filter(Boolean);
  }
  /** 按需：当前目的地 + 品类下，引擎判定「缺了就无法下结论」的字段 */
  function keyQuestionFields() {
    var sc = runCompliance();
    if (!sc) return [];
    return sc.questions;
  }
  var questionSession = { context: '', questions: [] };
  function displayedKeyQuestions() {
    var p = proj();
    var context = p.id + ':' + p.scenario.market + ':' + p.scenario.subcategoryId;
    if (questionSession.context !== context) questionSession = { context: context, questions: [] };
    keyQuestionFields().forEach(function (q) {
      if (!questionSession.questions.some(function (old) { return old.field.key === q.field.key; })) questionSession.questions.push(q);
    });
    return questionSession.questions;
  }
  function renderKeyFacts() {
    var host = $('keyFacts');
    var hint = $('keyFactsHint');
    clear(host);
    var p = proj();
    if (!p.scenario.market || !p.scenario.subcategoryId) {
      hint.textContent = '';
      host.appendChild(h('p', { class: 'subhint' }, '选定目的地与品类后，这里只显示影响判断的问题。'));
      return;
    }
    var ks = displayedKeyQuestions();
    hint.textContent = '当前 ' + keyQuestionFields().length + ' 项待答；已填写内容保留在原位';
    if (!ks.length) {
      host.appendChild(h('div', { class: 'banner ok' }, '影响当前判断的关键事实已齐备，可进入合规初筛。'));
      return;
    }
    ks.forEach(function (q) {
      var why = '不回答则无法判断：' + (q.affectedRules || []).join('、');
      host.appendChild(questionControl(q.field, { businessUse: q.field.businessUse || '' }, why));
    });
  }
  function renderMoreFacts() {
    var host = $('moreFacts');
    clear(host);
    var p = proj().scenario;
    var qs = dynQuestions();
    if (!qs.length) { host.appendChild(h('p', { class: 'subhint' }, '该品类暂无更多已发布参数。')); return; }
    var keySet = {};
    displayedKeyQuestions().forEach(function (q) { keySet[q.field.key] = true; });
    var rest = qs.filter(function (q) { return !keySet[q.field.key]; });
    host.appendChild(h('p', { class: 'subhint' }, '共 ' + rest.length + ' 项；这些参数不会改变当前目的地的初筛、HS 或税费结论，仅在你想补充资料时填写。'));
    rest.forEach(function (q) { host.appendChild(questionControl(q.field, q.map, '')); });
  }
  function questionControl(field, map, whyText) {
    var val = getFact(field.key);
    var wrap = h('div', { 'data-fact': field.key, class: 'qa' + (val !== '' && val !== 'unknown' ? ' answered' : '') });
    wrap.appendChild(h('div', { class: 'q' }, field.name + (field.unit ? '（' + field.unit + '）' : '')));
    var judgments = (map && map.judgments || []).map(function (j) {
      var jn = D.judgments.find(function (x) { return x.id === j; });
      return jn ? jn.name : j;
    });
    var noteBits = [];
    if (map && map.businessUse) noteBits.push(map.businessUse);
    if (judgments.length) noteBits.push('影响判断：' + judgments.join('、'));
    if (whyText) noteBits.push(whyText);
    var notes = proj().scenario.factNotes[field.key];
    if (notes) noteBits.push('来源：' + notes);
    if (noteBits.length) wrap.appendChild(h('div', { class: 'meta' }, noteBits.join('；')));
    if (val === 'unknown') wrap.appendChild(h('div', { class: 'why' }, '已标记不确定：对应判断保持「待确认」。'));
    var t = fieldType(field);
    if (t === 'tri') {
      var tri = h('div', { class: 'tri' });
      [['true', '是'], ['false', '否'], ['unknown', '不确定']].forEach(function (pair) {
        var on = (pair[0] === 'unknown') ? val === 'unknown' : (val === true && pair[0] === 'true') || (val === false && pair[0] === 'false');
        tri.appendChild(h('button', {
          type: 'button', class: (pair[0] === 'unknown' ? 'unknown ' : '') + (on ? 'on' : ''),
          onclick: function () { setFact(field.key, pair[0] === 'unknown' ? 'unknown' : (pair[0] === 'true')); refreshAll(); }
        }, pair[1]));
      });
      wrap.appendChild(tri);
    } else if (t === 'number') {
      var row = h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px' });
      var inp = h('input', { type: 'number', step: 'any', min: '0', value: val === 'unknown' || val === '' ? '' : String(val), style: 'border:1px solid var(--line);border-radius:8px;padding:7px 10px;width:150px' });
      inp.addEventListener('change', function () {
        if (inp.value === '') setFact(field.key, 'unknown');
        else setFact(field.key, Number(inp.value));
        refreshAll();
      });
      row.appendChild(inp);
      var ub = h('button', { type: 'button', class: 'btn sm sec' + (val === 'unknown' ? ' on' : ''), onclick: function () { setFact(field.key, 'unknown'); refreshAll(); } }, '不确定');
      row.appendChild(ub);
      wrap.appendChild(row);
    } else if (t === 'date') {
      var inp2 = h('input', { type: 'date', value: val === 'unknown' ? '' : String(val || ''), style: 'border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin-top:6px' });
      inp2.addEventListener('change', function () { setFact(field.key, inp2.value || 'unknown'); refreshAll(); });
      wrap.appendChild(inp2);
    } else {
      var sel = h('select', { style: 'border:1px solid var(--line);border-radius:8px;padding:7px 10px;margin-top:6px;max-width:330px' });
      sel.appendChild(h('option', { value: '' }, '请选择 / 暂不确定'));
      optionsOf(field).forEach(function (o) { sel.appendChild(h('option', { value: typeof o.v === 'boolean' ? String(o.v) : o.v }, o.label)); });
      sel.value = val === 'unknown' ? '' : String(val === true ? 'true' : val === false ? 'false' : (val || ''));
      sel.addEventListener('change', function () { setFact(field.key, sel.value === '' ? 'unknown' : sel.value); refreshAll(); });
      wrap.appendChild(sel);
    }
    return wrap;
  }

  function updateStep1Summary() {
    var p = proj();
    var sub = subById(p.scenario.subcategoryId);
    var bits = [];
    bits.push(p.scenario.market ? '目的地：' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market) : '未选目的地');
    bits.push(sub ? '品类：' + sub.name : '未选品类');
    if (p.scenario.market && sub) {
      var sup = supportOf(p.scenario.market, sub);
      bits.push('能做到：' + serviceTier(p.scenario.market, sub).def.label);
      var ks = keyQuestionFields();
      bits.push('关键事实待答 ' + ks.length + ' 项');
    }
    var lead = $('heroLead');
    if (lead) {
      lead.textContent = sub && p.scenario.market
        ? '已登记：' + sub.name + ' × ' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market) + '（' + supportOf(p.scenario.market, sub).label + '）。'
        : '先选好「产品 × 目的地」，系统只追问影响当前判断的关键事实；案例与研究资料可一键带入。';
    }
    var hs = $('heroStatus');
    if (hs) {
      clear(hs);
      var sc = runCompliance();
      var tax = sc ? null : null;
      hs.appendChild(hstat('可能适用规则', sc ? String(sc.applicableRules.length) : '—', sc ? '待补 ' + sc.unknownRules.length + ' 项' : '完成登记后实时计算'));
      hs.appendChild(hstat('关键事实待答', sc ? String(keyQuestionFields().length) : '—', '答完即自动重算'));
      if (sc && sc.hsCandidates.length) hs.appendChild(hstat('HS 候选', String(sc.hsCandidates.length), '第 3 步可选用'));
      else hs.appendChild(hstat('HS 候选', '—', '该组合暂无目的国候选（缺口）'));
    }
    $('step1Summary').textContent = bits.join('　·　');
    renderProjectStatus();
  }
  function hstat(label, value, note) {
    return h('div', { class: 'hstat' },
      h('span', {}, h('small', {}, label), h('div', {}, h('b', {}, value))),
      h('span', { class: 'subhint', style: 'text-align:right;max-width:150px' }, note));
  }

  /* ================= 当前项目功能状态与动态缺口面板 ================= */
  var FEATURE_TEXT = {
    reg_lookup: ['法规查询', 'Regulation lookup'],
    screening: ['合规初筛', 'Compliance screening'],
    hs_candidates: ['HS 候选', 'HS candidates'],
    tax_calc: ['税费测算', 'Duty & tax'],
    report: ['出海报告', 'Export report']
  };
  var STATE_TEXT = {
    ok: ['可用', 'Available'],
    partial: ['部分支持', 'Partially available'],
    needs_input: ['待补信息', 'Needs your input'],
    needs_review: ['需专业复核', 'Needs professional review'],
    not_supported: ['暂不支持', 'Not available yet'],
    pending: ['待确认', 'To be confirmed']
  };
  var REASON_TEXT = {
    user_input: ['当前项目还缺少这些填写项：', 'These inputs are still missing: '],
    product_fact: ['影响判断的产品事实还没确认：', 'The product facts that drive this decision are not confirmed yet: '],
    hs_review: ['存在多个可能的归类方向，尚未确认选哪一条：', 'More than one classification direction is possible and none has been confirmed: '],
    regulation_data: ['该市场已收录法规资料，但还没有针对这款产品可执行的条款规则：', 'Regulation material exists for this market, but there is no executable clause rule for this product yet: '],
    tax_profile_missing: ['该产品与目的地组合还没有经核验的税费画像：', 'No verified duty profile exists for this product and destination: '],
    scenario_unsupported: ['当前交易或进口路径不在计算范围内：', 'This transaction or import route is outside the calculation engine: '],
    date_out_of_range: ['所选日期不在现有配置的适用区间内：', 'The selected date falls outside the effective range of the current configuration: '],
    evidence_pending: ['官方证据尚未完成核验，结果保持保守：', 'Official evidence is not fully verified, so results stay conservative: ']
  };
  var NEED_TEXT = {
    user_input: ['补齐上述字段即可继续。', 'Complete the fields above to continue.'],
    product_fact: ['确认供电方式、主要功能、电池或加热等影响判断的技术特征。', 'Confirm the technical features that affect the decision (power supply, primary function, battery, heating).'],
    hs_review: ['回答区分问题并选定一条 HS 候选方向；候选不等于海关最终归类。', 'Answer the distinguishing questions and pick one HS candidate; a candidate is not a customs decision.'],
    regulation_data: ['平台需补充该产品的条款规则与官方依据。', 'The platform still needs clause-level rules and official references for this product.'],
    tax_profile_missing: ['平台需补充税目、税率、税基与适用条件的官方依据。', 'The platform still needs the tariff line, rate, valuation basis and conditions verified against official sources.'],
    scenario_unsupported: ['平台需补充该路径的估价与税费规则。', 'The platform still needs valuation and duty rules for this route.'],
    date_out_of_range: ['需要覆盖所选日期的有效规则或税率配置。', 'A configuration covering the selected date is required.'],
    evidence_pending: ['完成归类或措施复核并确认剩余条件。', 'Complete the classification or measures review and confirm the remaining conditions.']
  };
  var OWNER_TEXT = {
    user: ['你可以补充', 'You can resolve this'],
    platform: ['平台待补充', 'Platform data gap'],
    expert: ['需专业复核', 'Professional review required']
  };
  var ACTION_TEXT = {
    product: ['去产品与市场登记', 'Go to Product & Market'],
    compliance: ['查看合规初筛结果', 'Open Compliance Screening'],
    tax: ['前往税费测算', 'Go to Duty & Tax'],
    policy: ['到政策资料库核对原文', 'Check the source in the Policy Library'],
    report: ['查看出海报告', 'Open Export Report']
  };
  var ACTION_TAB = { product: 'product', compliance: 'compliance', tax: 'tax', policy: 'policy', report: 'report' };
  var statusOpen = {};

  function langKey() { return (window.VOI18N && window.VOI18N.get() === 'en') ? 1 : 0; }
  function pick(pair) { return pair ? pair[langKey()] : ''; }

  function fieldLabel(key) {
    var f = null;
    (D.fields || []).forEach(function (x) { if (x.key === key || x.ruleKey === key) f = x; });
    var en = {
      goods_value: 'goods value', freight: 'international freight', insurance: 'insurance', origin: 'country of origin',
      import_date: 'import date', currency: 'currency', fx_rate: 'exchange-rate record', incoterm: 'Incoterms basis',
      hs_candidate: 'HS candidate', market: 'destination', subcategoryId: 'product subcategory',
      placing_on_market_date: 'date placed on market'
    };
    if (f) return langKey() === 1 ? (f.nameEn || f.name || key) : (f.name || key);
    return langKey() === 1 ? (en[key] || key) : key;
  }

  function capabilityInput() {
    var p = proj();
    return {
      market: p.scenario.market, subcategoryId: p.scenario.subcategoryId,
      facts: p.scenario.facts || {}, placingOnMarketDate: p.scenario.placingOnMarketDate,
      hsChoice: p.hsChoice || '', tax: p.tax || {}, name: p.name
    };
  }

  function renderProjectStatus() {
    var host = $('projectStatus');
    if (!host) return;
    var p = proj();
    clear(host);
    var cap = window.VOCapability.evaluate(D, E, capabilityInput());
    var sub = subById(p.scenario.subcategoryId);
    var head = h('div', { class: 'ps-head' });
    head.appendChild(h('h3', {}, langKey() === 1 ? 'Current project' : '当前项目'));
    var title = sub && p.scenario.market
      ? (langKey() === 1 ? sub.nameEn + ' × ' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market)
        : sub.name + ' × ' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market))
      : (langKey() === 1 ? 'Select a product and destination' : '还没有选完产品与目的地');
    head.appendChild(h('div', { class: 'ps-title' }, title));
    var badges = h('div', { class: 'ps-badges' });
    if (sub) {
      badges.appendChild(h('span', { class: 'lvl m' }, (langKey() === 1 ? 'Product evidence ' : '产品资料 ') + cap.evidence.code));
      badges.appendChild(h('span', { class: 'lvl l' }, (langKey() === 1 ? 'Market service ' : '市场服务 ') + cap.service.code));
    }
    head.appendChild(badges);
    host.appendChild(head);

    var row = h('div', { class: 'ps-features' });
    cap.features.forEach(function (f) {
      var chip = h('div', { class: 'ps-chip' });
      var btn = h('button', {
        class: 'ps-tag state-' + f.state, type: 'button',
        'aria-expanded': statusOpen[f.key] ? 'true' : 'false', 'aria-controls': 'psPanel-' + f.key
      });
      btn.appendChild(h('span', { class: 'ps-fn' }, pick(FEATURE_TEXT[f.key])));
      btn.appendChild(h('span', { class: 'ps-st' }, pick(STATE_TEXT[f.state] || ['未知', 'Unknown'])));
      btn.appendChild(h('span', { class: 'ps-ico', 'aria-hidden': 'true' }, statusOpen[f.key] ? '−' : 'i'));
      var panel = h('div', { class: 'ps-panel', id: 'psPanel-' + f.key });
      panel.hidden = !statusOpen[f.key];
      if (statusOpen[f.key]) {
        if (f.state === 'ok') {
          panel.appendChild(h('p', {}, langKey() === 1
            ? 'This function is available with the current inputs. No additional material is required.'
            : '当前输入已满足该功能，无需额外补充。'));
        } else {
          var miss = (f.missing || []).map(fieldLabel).join(langKey() === 1 ? ', ' : '、');
          panel.appendChild(h('p', {}, h('b', {}, langKey() === 1 ? 'Why: ' : '原因：'), (pick(REASON_TEXT[f.reason]) || (langKey() === 1 ? 'This function is not available with the current inputs. ' : '当前输入下该功能还不能完成。')) + (miss || (langKey() === 1 ? 'no additional fields required' : '不涉及额外填写项'))));
          panel.appendChild(h('p', {}, h('b', {}, langKey() === 1 ? 'What is needed: ' : '需要补充：'), pick(NEED_TEXT[f.reason] || ['见上方原因。', 'See the reason above.'])));
          var nextLine = h('p', {}, h('b', {}, langKey() === 1 ? 'Next action: ' : '下一步：'), pick(OWNER_TEXT[f.owner] || '') + ' · ');
          var jump = h('button', { class: 'btn sm', type: 'button' }, pick(ACTION_TEXT[f.action] || ['前往', 'Go']));
          jump.onclick = function () {
            if (f.action === 'policy') { window.open('policy-documents/index.html', '_blank', 'noopener'); return; }
            showTab(ACTION_TAB[f.action] || 'product');
          };
          nextLine.appendChild(jump);
          panel.appendChild(nextLine);
        }
      }
      btn.onclick = function () { statusOpen[f.key] = !statusOpen[f.key]; renderProjectStatus(); };
      chip.appendChild(btn);
      chip.appendChild(panel);
      row.appendChild(chip);
    });
    host.appendChild(row);
    var note = h('p', { class: 'subhint' });
    note.textContent = langKey() === 1
      ? 'Status, reasons and required inputs are derived from the current project data and the same capability check used by the coverage matrix; they are not fixed per product.'
      : '状态、原因与所需资料由当前项目数据与统一能力判断生成，与税费覆盖矩阵一致，不针对具体产品固定。';
    host.appendChild(note);
  }

  /* ---------- 第 1 步事件 ---------- */
  $('pName').addEventListener('change', function () { proj().name = $('pName').value || '未命名项目'; touch(); refreshProjSelect(); });
  $('pCompany').addEventListener('change', function () { proj().companyName = $('pCompany').value; touch(); });
  $('pPlacingDate').addEventListener('change', function () { proj().scenario.placingOnMarketDate = $('pPlacingDate').value; touch(); refreshAll(); });
  $('pImportDate').addEventListener('change', function () { proj().scenario.importDate = $('pImportDate').value; touch(); });
  $('pRole').addEventListener('change', function () { proj().scenario.role = $('pRole').value; touch(); });
  $('pMarket').addEventListener('change', function () { proj().scenario.market = $('pMarket').value; proj().hsChoice = ''; proj().tax.hsReviewed = false; touch(); refreshAll(); });
  $('btnNext1').addEventListener('click', function () { showTab('compliance'); });

  /* ---------- 政策资料库链接：本地已归档 PDF → 官方 PDF → 官方网页 ---------- */
  var POLICY = window.VO_POLICY_LIBRARY || { files: [] };
  var policyById = {};
  (POLICY.files || []).forEach(function (f) { if (f.id && policyById[f.id] === undefined) policyById[f.id] = f; });
  function pdfLinks(ids, shownUrls) {
    var seen = {};
    (shownUrls || []).forEach(function (u) { seen[String(u).split('#')[0]] = 1; });
    var hitsList = (ids || []).map(function (id) { return policyById[id]; }).filter(Boolean);
    var local = hitsList.filter(function (f) { return f.localFile; });
    var online = hitsList.filter(function (f) { return !f.localFile && f.officialUrl && !seen[f.officialUrl.split('#')[0]]; });
    if (!local.length && !online.length) return null;
    var wrap = h('span', { class: 'pdf-link' });
    local.slice(0, 2).forEach(function (f) {
      wrap.appendChild(h('a', {
        href: f.localFile, target: '_blank', rel: 'noopener noreferrer',
        title: f.kindLabel + '｜' + f.countryName + '｜版本：' + (f.version || '待核实') + '｜' + f.id
      }, (f.kind === 'reading' ? '网页阅读版 PDF' : '原文 PDF') + (f.pages ? '（' + f.pages + ' 页）' : '')));
      wrap.appendChild(document.createTextNode(' '));
    });
    online.slice(0, 1).forEach(function (f) {
      wrap.appendChild(h('a', {
        href: f.officialUrl, target: '_blank', rel: 'noopener noreferrer',
        title: (f.kindLabel) + '｜' + f.countryName + '｜' + f.id
      }, f.officialKind === 'pdf' ? '官方 PDF ↗' : '官方网页 ↗'));
      wrap.appendChild(document.createTextNode(' '));
    });
    if (hitsList.length > 2) {
      wrap.appendChild(h('a', { href: 'policy-documents/index.html?q=' + encodeURIComponent((ids || [''])[0]), target: '_blank', rel: 'noopener noreferrer' }, '资料库查看 ' + hitsList.length + ' 份 ↗'));
    }
    return wrap;
  }

  /* ================= 第 2 步：合规初筛（实时） ================= */
  function runCompliance() {
    var p = proj();
    if (!p.scenario.market || !p.scenario.subcategoryId) return null;
    return E.evaluateScenario(D, {
      market: p.scenario.market,
      subcategoryId: p.scenario.subcategoryId,
      facts: engineFacts(),
      placingOnMarketDate: p.scenario.placingOnMarketDate || ''
    });
  }
  function ruleCard(r, sc) {
    var card = h('div', { class: 'rule-item state-' + (r.state === 'applicable' ? 'applicable' : r.state === 'review_required' ? 'review' : r.state === 'unknown' ? 'unknown' : 'not') });
    var head = h('div', { class: 'head' });
    head.appendChild(h('b', {}, r.name || r.id));
    head.appendChild(h('span', { class: 'tag' }, r.id));
    head.appendChild(h('span', { class: 'tag brand' }, (JUR[r.jurisdiction] ? JUR[r.jurisdiction].name : r.jurisdiction)));
    var tp = D.topics.find(function (t) { return t.id === r.topic; });
    if (tp) head.appendChild(h('span', { class: 'tag' }, tp.name));
    if (r.state === 'review_required' || r.humanReview) head.appendChild(h('span', { class: 'tag info' }, '需人工复核'));
    if (r.origin === 'task3_verified_rule') head.appendChild(h('span', { class: 'tag ok' }, '条款级核验规则'));
    card.appendChild(head);
    var body = h('div', { class: 'body' });
    if (r.state === 'unknown') {
      var miss = (r.missingFields || []).map(function (k) { var f = lookupField(k); return f ? f.name : k; });
      body.appendChild(h('div', {}, '待补事实：', miss.join('、') || '（见上方关键事实）'));
    } else if (r.state === 'not_applicable') {
      var why = [];
      if (r.dateActive === false) why.push(r.dateReason);
      if (r.notApplicable) why.push(r.notApplicable);
      if (!why.length) why.push('条件明确不满足（当前产品/经营事实未命中该规则的适用条件，或命中排除项）。');
      body.appendChild(h('div', {}, why.join('；')));
    } else {
      if (r.obligation) body.appendChild(h('div', {}, r.obligation));
      if (r.exceptions) body.appendChild(h('div', { class: 'subhint' }, '例外与提示：' + r.exceptions));
      if (r.effectiveFrom || r.effectiveTo) body.appendChild(h('div', { class: 'subhint' }, '适用期：' + (r.effectiveFrom || '不限') + ' 至 ' + (r.effectiveTo || '不限') + '；按投放日期 ' + (sc ? sc.asOf : '') + ' 选版本。'));
    }
    card.appendChild(body);
    if (r.locator || (r.sourceIds && r.sourceIds.length)) {
      var src = h('div', { class: 'src' });
      if (r.locator) src.appendChild(document.createTextNode('条款定位：' + r.locator + '　'));
      if (r.sourceIds && r.sourceIds.length) {
        src.appendChild(sourceLinks(r.sourceIds));
        var pl = pdfLinks(r.sourceIds, (r.sourceIds || []).map(function (id) { return (sourceMap[id] || {}).url; }));
        if (pl) { src.appendChild(document.createTextNode('　')); src.appendChild(pl); }
      }
      card.appendChild(src);
    }
    return card;
  }
  function renderCompliance() {
    var host = $('complianceResult');
    clear(host);
    var p = proj();
    if (!p.scenario.market || !p.scenario.subcategoryId) {
      host.appendChild(h('div', { class: 'banner warn' }, '尚未完成第 1 步的目的地与品类登记，无法初筛。'));
      $('btnBack1').focus();
      return;
    }
    var sc = runCompliance();
    $('complianceRunInfo').textContent = '实时计算：可能适用 ' + sc.applicableRules.length + ' 条 · 待补事实 ' + sc.unknownRules.length + ' 条 · 不适用 ' + sc.excludedRules.length + ' 条（资料版本 ' + E.SNAPSHOT_DATE + '，适用法规范围 ' + sc.jurisdictionChain.map(function (c) { return JUR[c] ? JUR[c].name : c; }).join('、') + '）';

    var tierNow = serviceTier(p.scenario.market, subById(p.scenario.subcategoryId));
    var covBanner = h('div', { class: 'banner ' + (tierNow.key === 'calc' || tierNow.key === 'screen' ? 'info' : 'warn') });
    covBanner.appendChild(tierBadge(tierNow));
    covBanner.appendChild(document.createTextNode(' ' + tierNow.why));
    host.appendChild(covBanner);
    var covMore = h('details', { class: 'box' });
    covMore.appendChild(h('summary', {}, '这个判断怎么来的（资料成熟度与覆盖能力）'));
    var subNow = subById(p.scenario.subcategoryId);
    covMore.appendChild(h('p', { class: 'subhint' }, '产品资料成熟度 ' + (subNow ? subNow.evidence : '—') + '（M1 草案 / M2 官方系列页多型号 / M3 官方多型号且说明书已核对）；该组合覆盖能力 ' + sc.coverage.level + '（L1 仅法规索引 / L2 有可执行规则 / L3 另有 HS 候选与税费配置）。'));
    covMore.appendChild(h('p', { class: 'subhint' }, '税费汇总口径是「本模型已覆盖法定项目汇总」，不是全部到岸成本；HS 是候选方向，最终以目的国税则与个案裁定为准。'));
    host.appendChild(covMore);
    sc.gaps.forEach(function (g) { host.appendChild(h('div', { class: 'banner bad' }, '覆盖缺口：' + g)); });

    // 待补事实置顶（有则优先处理）
    if (sc.questions.length) {
      var gq = h('div', { class: 'card group-state' });
      gq.appendChild(h('h3', {}, h('span', { class: 'count-badge warn' }, String(sc.unknownRules.length)), '待补事实（回答后自动重算）'));
      sc.questions.forEach(function (q) {
        gq.appendChild(questionControl(q.field, { businessUse: q.field.businessUse || '' }, '影响规则：' + (q.affectedRules || []).join('、')));
      });
      host.appendChild(gq);
    }

    var g1 = h('div', { class: 'card group-state' });
    g1.appendChild(h('h3', {}, h('span', { class: 'count-badge' }, String(sc.applicableRules.length)), '可能适用'));
    if (!sc.applicableRules.length) g1.appendChild(h('p', { class: 'subhint' }, '当前输入下没有明确适用的规则；请处理上方待补事实，并查看待规则核验清单。'));
    sc.applicableRules.forEach(function (r) { g1.appendChild(ruleCard(r, sc)); });
    host.appendChild(g1);

    var g2 = h('div', { class: 'card group-state' });
    g2.appendChild(h('h3', {}, '单条规则不适用（' + sc.excludedRules.length + '）· 待规则核验（' + sc.pendingRegulations.length + '）'));
    var d2 = h('details', { class: 'box' });
    d2.appendChild(h('summary', {}, '不适用规则（每条有原因）'));
    sc.excludedRules.forEach(function (r) { d2.appendChild(ruleCard(r, sc)); });
    g2.appendChild(d2);
    if (sc.pendingRegulations.length) {
      var d3 = h('details', { class: 'box' });
      d3.appendChild(h('summary', {}, '待规则核验：已有来源索引、暂无可执行条款规则（' + sc.pendingRegulations.length + ' 条）'));
      d3.appendChild(h('p', { class: 'subhint' }, '这些法规不会生成义务结论，必须人工核对原文后再判断。'));
      sc.pendingRegulations.forEach(function (reg) {
        var it = h('div', { style: 'font-size:13px;margin:5px 0' },
          '· ' + reg.name + '（' + reg.id + '，核验 ' + reg.checkedAt + '）',
          h('span', { class: 'tag warn' }, reg.maturity === 'verified_index_only' ? '索引级' : reg.maturity),
          reg.officialUrl ? h('a', { href: reg.pdfPath || reg.officialUrl, target: '_blank', rel: 'noopener noreferrer', style: 'margin-left:6px' }, reg.pdfPath ? '查看 PDF' : '查看官方网页') : null);
        d3.appendChild(it);
      });
      g2.appendChild(d3);
    }
    host.appendChild(g2);

    var g4 = h('div', { class: 'card group-state' });
    g4.appendChild(h('h3', {}, '办理行动与材料（来自可能适用规则）'));
    g4.appendChild(h('p', { class: 'subhint' }, '勾选状态仅保存在本机，用于团队跟踪，不等同于合规完成证明。'));
    if (!sc.actionList.length) g4.appendChild(h('p', { class: 'subhint' }, '当前没有适用规则，因此没有生成的行动与材料——这不代表无需办理任何手续，请查看缺口与待核验清单。'));
    sc.actionList.forEach(function (a) {
      var done = !!(proj().todoState[a.id] && proj().todoState[a.id].done);
      var row = h('div', { class: 'todo-row' + (done ? ' done' : '') });
      var cb = h('input', { type: 'checkbox' });
      cb.checked = done;
      cb.addEventListener('change', function () {
        proj().todoState[a.id] = { done: cb.checked, at: new Date().toISOString() };
        row.classList.toggle('done', cb.checked);
        touch(); updateDots();
      });
      var body = h('div', { class: 't-body' });
      body.appendChild(h('div', { class: 't-title' }, a.name, ' ', h('span', { class: 'tag' }, a.id)));
      body.appendChild(h('div', { class: 't-text' }, a.text));
      body.appendChild(h('div', { class: 't-meta' }, '责任建议：' + (a.responsibility || '—') + '；完成节点：' + (a.due || '—') + '；性质：' + (a.nature || '—')));
      if (a.locator) body.appendChild(h('div', { class: 't-meta' }, '条款定位：' + a.locator));
      if (a.materialIds && a.materialIds.length) {
        var mats = a.materialIds.map(function (mid) {
          var m = D.materials.find(function (x) { return x.id === mid; });
          return m ? m.name : mid;
        });
        body.appendChild(h('div', { class: 't-meta' }, '涉及材料：' + mats.join('；')));
      }
      if (a.sourceIds && a.sourceIds.length) body.appendChild(h('div', { class: 't-meta' }, sourceLinks(a.sourceIds)));
      row.appendChild(cb); row.appendChild(body);
      g4.appendChild(row);
    });
    if (sc.materialList.length) {
      var mt = h('table', { class: 't' });
      mt.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '材料'), h('th', {}, '企业准备状态'), h('th', {}, '专业复核'))));
      var tb = h('tbody', {});
      sc.materialList.forEach(function (m) {
        tb.appendChild(h('tr', {}, h('td', {}, m.name), h('td', {}, m.prep || '未提供'), h('td', {}, m.review || '未复核')));
      });
      mt.appendChild(tb);
      g4.appendChild(h('div', { class: 'tbl-wrap' }, mt));
    }
    host.appendChild(g4);
  }
  $('btnBack1').addEventListener('click', function () { showTab('product'); });
  $('btnNext2').addEventListener('click', function () { showTab('tax'); });

  /* ================= 第 3 步：HS 与税费 ================= */
  // 市场切换后币种残留修复：仅当「币种所记录的市场」与当前市场不一致、
  // 且币种为空或为另一市场本币（旧默认/残留）时，自动回到当前市场本币；
  // 用户显式选择的币种（含 USD/CNY 等外币）不受影响。
  function syncTaxCurrency() {
    var p = proj();
    var t = p.tax;
    var nativeCur = p.scenario.market === 'SG' ? 'SGD' : (p.scenario.market === 'AU' ? 'AUD' : '');
    if (nativeCur && t.currencyMarket !== p.scenario.market) {
      if (!t.currency || t.currency === 'SGD' || t.currency === 'AUD') {
        t.currency = nativeCur;
        t.fxRate = '';
        t.fxSource = '';
      }
      t.currencyMarket = p.scenario.market;
    }
  }
  function taxInput() {
    var p = proj();
    var t = p.tax;
    syncTaxCurrency();
    var input = {
      market: p.scenario.market,
      product_type: (subById(p.scenario.subcategoryId) || {}).legacy || '',
      subcategory_id: p.scenario.subcategoryId,
      hs_candidate: p.hsChoice || '',
      hs_reviewed: t.hsReviewed === true,
      origin: t.origin || '',
      import_date: p.scenario.importDate || '',
      goods_value: t.goodsValue === '' ? null : Number(t.goodsValue),
      currency: t.currency || '',
      incoterm: t.incoterm || '',
      price_basis: t.priceBasis || '',
      freight: t.freight === '' ? null : Number(t.freight),
      insurance: t.insurance === '' ? null : Number(t.insurance),
      multiple_sales: t.multipleSales === true || t.multipleSales === 'true',
      lsp: t.lsp === '' ? null : Number(t.lsp),
      last_buyer_is_declarant: t.lastBuyerDeclarant === true || t.lastBuyerDeclarant === 'true',
      import_route: t.importRoute || 'bulk',
      special_valuation: t.specialValuation === 'yes' ? true : t.specialValuation === 'unknown' ? 'unknown' : false,
      remedy_check: t.remedyCheck || '',
      confirmed_customs_value: t.confirmedCustomsValue === '' ? null : Number(t.confirmedCustomsValue),
      valuation_professionally_confirmed: t.valuationConfirmed === true || t.valuationConfirmed === 'true',
      customs_value_confirmed: t.customsValueConfirmed === '' ? null : Number(t.customsValueConfirmed),
      origin_preference: t.originPreference || 'none',
      origin_psr_satisfied: t.psrSatisfied === true || t.psrSatisfied === 'true' ? true : (t.psrSatisfied === 'unknown' ? 'unknown' : null),
      origin_documents_valid: t.docsValid === true || t.docsValid === 'true' ? true : null,
      transport_conditions_satisfied: t.transportCond === true || t.transportCond === 'true' ? true : null,
      transport: t.transport || '',
      sales_state: t.salesState || '',
      quantity: t.quantity === '' ? null : Number(t.quantity)
    };
    var native = p.scenario.market === 'SG' ? 'SGD' : (p.scenario.market === 'AU' ? 'AUD' : '');
    if (native && t.currency && t.currency !== native) {
      input.fx_record = { rate: t.fxRate === '' ? null : Number(t.fxRate), source: t.fxSource || '' };
    }
    return input;
  }
  function renderTax() {
    var host = $('taxBody');
    clear(host);
    var p = proj();
    if (!p.scenario.market || !p.scenario.subcategoryId) {
      host.appendChild(h('div', { class: 'banner warn' }, '请先完成第 1 步的目的地与品类登记。'));
      return;
    }
    var sub = subById(p.scenario.subcategoryId);
    var sc = runCompliance();
    var market = p.scenario.market;
    syncTaxCurrency(); // 市场切换币种残留纠正（表单构建前，保证标签与选项正确）

    /* A. HS 候选 */
    host.appendChild(h('div', { class: 'banner warn' }, '普通进口测算：请填写进口日期、HS 候选、价格及运保费。最后核验日为 ' + E.SNAPSHOT_DATE + '。进口日期按规则有效期匹配；晚于核验日仍可测算，并提示复核后续政策变动。'));
    var hsCard = h('div', { class: 'card' });
    hsCard.appendChild(h('h3', {}, '目的国 HS 候选方向'));
    var cands = sc ? sc.hsCandidates : [];
    if (!cands.length) {
      hsCard.appendChild(h('div', { class: 'banner bad' }, '当前「' + sub.name + ' × ' + (JUR[market] ? JUR[market].name : market) + '」组合尚无经来源关联的目的国 HS 候选。这是数据包的明确缺口：不冒充归类结论，也不按零税率处理。'));
    } else {
      hsCard.appendChild(h('div', { class: 'banner warn' }, 'HS 候选只是归类研究方向，不是海关最终归类；最终编码以目的国税则与个案裁定为准。'));
      cands.forEach(function (c) {
        var on = p.hsChoice === c.id;
        var item = h('div', { class: 'rule-item' + (on ? ' state-applicable' : '') });
        var head = h('div', { class: 'head' });
        var radio = h('input', { type: 'radio', name: 'hsChoice', value: c.id });
        radio.checked = on;
        radio.addEventListener('change', function () { proj().hsChoice = c.id; proj().tax.hsReviewed = false; touch(); renderTax(); updateDots(); });
        head.appendChild(radio);
        head.appendChild(h('b', {}, c.code));
        head.appendChild(h('span', { class: 'tag' }, c.market));
        head.appendChild(h('span', { class: 'tag warn' }, '候选方向'));
        if (c.origin === 'task3_verified') head.appendChild(h('span', { class: 'tag ok' }, '已有来源依据'));
        item.appendChild(head);
        item.appendChild(h('div', { class: 'body' }, (c.desc || '') + (c.support ? '。依据：' + c.support : '')));
        if (c.questions) item.appendChild(h('div', { class: 'subhint' }, '区分问题：' + c.questions));
        var meta = h('div', { class: 'src' }, (c.gri ? '归类规则：' + c.gri + '；' : '') + (c.tariffVersion ? '税则版本：' + c.tariffVersion + '；' : '') + '复核状态：' + (c.review || '—') + '；');
        if (c.sourceIds && c.sourceIds.length) meta.appendChild(sourceLinks(c.sourceIds));
        item.appendChild(meta);
        hsCard.appendChild(item);
      });
    }
    var review = h('input', { type: 'checkbox', id: 'hsReviewed' });
    review.checked = p.tax.hsReviewed === true;
    review.addEventListener('change', function () { p.tax.hsReviewed = review.checked; touch(); renderTax(); });
    hsCard.appendChild(h('label', {}, review, ' 已复核所选候选与实际商品一致，并确认属于普通非应税小家电（新加坡扩展品类汇总必需）'));
    host.appendChild(hsCard);

    /* B. 税费计算器（SG/AU）或变量计算式模板（其他市场） */
    var opts = D.formOptions || {};
    if (market === 'SG' || market === 'AU') {
      var card = h('div', { class: 'card' });
      card.appendChild(h('h3', {}, '税费阶段测算（' + (market === 'SG' ? '新加坡' : '澳大利亚') + '：按已核公式实时复算）'));
      var f = p.tax;
      var native = market === 'SG' ? 'SGD' : 'AUD';
      function numField(label, key) {
        var lab = h('label', { class: 'f' }, label);
        var inp = h('input', { type: 'number', step: 'any', min: '0', value: f[key] === '' || f[key] === null || f[key] === undefined ? '' : String(f[key]) });
        inp.addEventListener('change', function () { f[key] = inp.value; touch(); recomputeTax(result); });
        lab.appendChild(inp);
        return lab;
      }
      function selField(label, key, optList, note) {
        var lab = h('label', { class: 'f' }, label);
        var s = h('select', {});
        optList.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); });
        s.value = f[key] === true ? 'true' : (f[key] || '');
        s.addEventListener('change', function () {
          f[key] = s.value; touch();
          if (key === 'currency') f.currencyMarket = p.scenario.market; // 用户显式选币种：记录当前市场，防市场切换误纠正
          if (['currency', 'incoterm', 'originPreference', 'multipleSales'].indexOf(key) >= 0) { renderTax(); updateDots(); }
          else recomputeTax(result);
        });
        lab.appendChild(s);
        if (note) lab.appendChild(h('span', { class: 'subhint' }, note));
        return lab;
      }
      var incoterms = (opts.incoterms || []).map(function (o) { return [o.value, o.label]; });
      if (!incoterms.length) incoterms = [['FOB', 'FOB'], ['CIF', 'CIF'], ['DDP', 'DDP'], ['other', '其他']];
      var currencies = (opts.currencies || []).map(function (o) { return [o.value, o.label]; });
      if (!currencies.length) currencies = [[native, native]];
      if (!currencies.some(function (c) { return c[0] === f.currency; })) f.currency = native;
      var origins = (opts.origins || []).map(function (o) { return [o.value, o.label]; });
      if (!origins.length) origins = [['CN', '中国 CN'], ['other', '其他/未确认']];
      var fields = h('div', {});
      fields.appendChild(h('div', { class: 'fields' },
        numField('货值（' + (f.currency || native) + '）', 'goodsValue'),
        selField('计价币种', 'currency', currencies, '非' + native + '计价需法定汇率记录'),
        numField('国际运费', 'freight'),
        numField('国际保险费', 'insurance'),
        numField('数量（台/套）', 'quantity'),
        selField('贸易术语', 'incoterm', incoterms, '承担划分见下方矩阵；EXW/FCA 等按另加运保路径核税基'),
        selField('原产地', 'origin', origins),
        selField('特殊估价（需专业结论）', 'specialValuation', [['no', '否——按常规估价'], ['yes', '是'], ['unknown', '不确定']])
      ));
      if (f.currency && f.currency !== native) {
        fields.appendChild(h('div', { class: 'fields' },
          numField('汇率（1 外币 = ? ' + native + '）', 'fxRate'),
          h('label', { class: 'f' }, '汇率来源及日期（法定汇率记录）', (function () {
            var inp = h('input', { type: 'text', value: f.fxSource || '', placeholder: '例如：MAS 当周均价 / 央行中间价及日期' });
            inp.addEventListener('change', function () { f.fxSource = inp.value; touch(); recomputeTax(result); });
            return inp;
          })())
        ));
      }
      if (f.incoterm === 'DDP') {
        fields.appendChild(h('div', { class: 'banner warn' }, 'DDP 含税总价不能倒算税基：需提供经专业确认的海关价值与费用拆分。合同费用承担与法定税率是两回事。'));
        fields.appendChild(h('div', { class: 'fields' },
          numField('经专业确认的海关价值', 'confirmedCustomsValue'),
          selField('是否经专业确认', 'valuationConfirmed', [['', '未确认'], ['true', '已确认']])
        ));
      }
      if (market === 'SG') {
        var routes = (opts.importRoutes || []).map(function (o) { return [o.value, o.label]; });
        if (!routes.some(function (r) { return r[0] === 'bulk'; })) routes = [['bulk', '一般贸易批量进口'], ['low_value', '低值路线'], ['postal', '空邮/邮寄']];
        fields.appendChild(h('div', { class: 'fields' },
          selField('进口路线', 'importRoute', routes),
          selField('进口前多次销售', 'multipleSales', [['', '否'], ['true', '是——需最后买方申报价']]),
          numField('最后买方申报价（如多次销售）', 'lsp'),
          selField('最后买方是否为付款许可申报方（多次销售时确认）', 'lastBuyerDeclarant', [['', '未确认'], ['true', '是'], ['false', '否——需复核计税路径']])
        ));
      }
      if (market === 'AU') {
        var modes = (opts.transportModes || []).map(function (o) { return [o.value, o.label]; });
        if (!modes.some(function (m) { return m[0] === 'sea'; })) modes = [['sea', '海运'], ['air', '空运']];
        fields.appendChild(h('div', { class: 'fields' },
          numField('海关价值 CV（经确认，AUD）', 'customsValueConfirmed'),
          selField('运输方式（生物安全费按空/海区分）', 'transport', modes, '非空运/海运时生物安全费阻断并说明'),
          selField('销售州（电气安全提示用）', 'salesState', [['VIC', '维州 VIC'], ['other', '其他州/未指定']]),
          selField('ChAFTA 优惠情景', 'originPreference', [['none', '不申请优惠'], ['conditional', '拟申请——条件未复核'], ['reviewed', '已复核——需三项声明']])
        ));
        if (f.originPreference === 'reviewed') {
          fields.appendChild(h('div', { class: 'banner warn' }, 'ChAFTA 零关税需「PSR 满足 + 原产证明有效 + 运输条件满足」同时成立；数据包未运行 HS 特定 PSR 自动判断，以下声明由用户负责并留痕。'));
          fields.appendChild(h('div', { class: 'fields' },
            selField('PSR 已满足', 'psrSatisfied', [['', '未确认'], ['true', '已满足'], ['unknown', '不确定']]),
            selField('原产证明有效', 'docsValid', [['', '未确认'], ['true', '有效']]),
            selField('运输条件满足（直接运输）', 'transportCond', [['', '未确认'], ['true', '满足']])
          ));
        }
      }
      fields.appendChild(h('div', { class: 'fields' },
        selField('贸易救济/附加措施核查', 'remedyCheck', [['', '尚未核查'], ['confirmed_clear', '已核查：无适用措施'], ['measures_found', '发现适用措施——需另行计入']])
      ));
      card.appendChild(fields);
      var result = h('div', {});
      card.appendChild(result);
      host.appendChild(card);
      recomputeTax(result);
    } else {
      var tpl = (D.taxTemplates || []).find(function (t) { return t.market === market; });
      var tc = h('div', { class: 'card' });
      tc.appendChild(h('h3', {}, '税费计算式（' + (JUR[market] ? JUR[market].name : market) + '）'));
      if (tpl) {
        tc.appendChild(h('div', { class: 'banner warn' }, '该市场暂无可复算的税费画像。以下为研究保留的变量计算式：税率未核实前不代入数值，不按零处理。'));
        tc.appendChild(h('p', { class: 'subhint' }, tpl.label + '｜' + tpl.scenario));
        var ul = h('ul', { style: 'margin:6px 0 10px 20px;font-size:13.5px' });
        tpl.lines.forEach(function (ln) { ul.appendChild(h('li', {}, ln)); });
        tc.appendChild(ul);
        tc.appendChild(h('h4', { style: 'font-size:14px;margin:10px 0 4px' }, '代入数值前必须确认'));
        tpl.mustConfirm.forEach(function (m) { tc.appendChild(h('div', { style: 'font-size:13px;margin:3px 0' }, '· ' + m)); });
        tc.appendChild(h('div', { style: 'margin-top:6px' }, '依据：', (function () {
          var sw = h('span', {});
          tpl.sources.forEach(function (s) { sw.appendChild(h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', style: 'margin-right:8px' }, s.label)); });
          return sw;
        })()));
        tc.appendChild(h('p', { class: 'subhint' }, tpl.note));
      } else {
        tc.appendChild(h('div', { class: 'banner bad' }, '当前目的地（' + (JUR[market] ? JUR[market].name : market) + '）既无已核税费规则，也无可展示的变量计算式模板：不输出任何金额结论。可在下方知识库查看通用税种与公式。'));
      }
      host.appendChild(tc);
    }

    /* C. 税则知识库 */
    var kb = h('div', { class: 'card' });
    kb.appendChild(h('h3', {}, '税则知识库（已核一般规则与公式）'));
    kb.appendChild(h('p', { class: 'subhint' }, '这里列出各税种的计税基础与公式。已核对的是通用规则，你这一票是否适用仍要结合产品、原产地、日期与措施核查；资料缺失的项目保持留空，不会按 0 计算。'));
    var rows = (D.taxRules || []).filter(function (r) { return r.market === market || r.market === 'ALL'; });
    if (!rows.length) kb.appendChild(h('p', { class: 'subhint' }, '该市场暂无税种公式记录（缺口）。'));
    else {
      var kt = h('table', { class: 't' });
      kt.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '税种/项目'), h('th', {}, '类别'), h('th', { class: 'num' }, '税率/金额'), h('th', {}, '税基'), h('th', {}, '公式'), h('th', {}, '适用前提'), h('th', {}, '使用提醒'), h('th', {}, '依据'))));
      var kbBody = h('tbody', {});
      rows.forEach(function (r) {
        var rateTxt = r.rate === null ? '待核' : (r.rateUnit === '比例' ? (r.rate * 100).toFixed(r.rate * 100 % 1 === 0 ? 0 : 1) + '%' : r.rate + '（' + r.rateUnit + '）');
        kbBody.appendChild(h('tr', {},
          h('td', {}, h('b', {}, r.type), h('div', { class: 'subhint' }, r.id)),
          h('td', {}, r.classification || '—'),
          h('td', { class: 'num' }, rateTxt),
          h('td', {}, r.base || '—'),
          h('td', {}, h('code', { class: 'inline' }, r.formula || '—')),
          h('td', {}, r.conditions || '—'),
          h('td', {}, taxStatusNote(r)),
          h('td', {}, (r.locator ? h('div', { class: 'subhint' }, r.locator) : h('span', {})), sourceLinks(r.sourceIds))));
      });
      kt.appendChild(kbBody);
      kb.appendChild(h('div', { class: 'tbl-wrap' }, kt));
    }
    host.appendChild(kb);

    /* D. 贸易术语承担矩阵 */
    var im = h('div', { class: 'card' });
    im.appendChild(h('h3', {}, '贸易术语与费用承担矩阵'));
    im.appendChild(h('p', { class: 'subhint' }, '合同费用承担 ≠ 法定税率：Incoterms 决定谁付钱，不改变税基构成与法定税率；估价仍按目的国规则。'));
    var it = h('table', { class: 't' });
    it.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '术语'), h('th', {}, '适用运输'), h('th', {}, '卖方承担'), h('th', {}, '买方承担'), h('th', {}, '税率影响'), h('th', {}, '税基/估价注意'), h('th', {}, '依据'))));
    var ib = h('tbody', {});
    (D.incotermMatrix || []).forEach(function (r) {
      ib.appendChild(h('tr', {}, h('td', {}, h('b', {}, r.term)), h('td', {}, r.mode), h('td', {}, r.seller), h('td', {}, r.buyer),
        h('td', {}, r.dutyRateEffect), h('td', {}, r.valuation), h('td', {}, sourceLinks(r.sourceIds))));
    });
    it.appendChild(ib);
    im.appendChild(h('div', { class: 'tbl-wrap' }, it));
    host.appendChild(im);

    /* E. 易漏项提示 */
    var feeNote = h('div', { class: 'card' });
    feeNote.appendChild(h('h3', {}, '容易漏项：行政收费、抵扣与贸易救济'));
    feeNote.appendChild(h('p', { class: 'subhint' }, '· SG 新品注册费 SGD 180/新型号、CoC 续期 SGD 50/次（TX-SG-REG/TX-SG-REN）：属合规行政收费，不计入每票进口税，但要进成本测算。'));
    feeNote.appendChild(h('p', { class: 'subhint' }, '· GST 抵扣/递延（TX-RECOVER）：仅 GST 注册不足以证明全额抵扣，须业务用途、进口主体和凭证；递延须批准。'));
    feeNote.appendChild(h('p', { class: 'subhint' }, '· 贸易救济/附加措施（TX-REMEDY）：未查到 ≠ 0；SG 需当日复核反倾销登记。'));
    host.appendChild(feeNote);
  }

  function recomputeTax(host) {
    try { renderTaxResult(host, E.calculateTaxes(D, taxInput())); }
    catch (e) { clear(host); host.appendChild(h('div', { class: 'banner bad' }, '计算失败：' + e.message)); }
    updateDots();
  }
  function renderTaxResult(host, tax) {
    clear(host);
    if (tax.capabilities) host.appendChild(h('p', { class: 'subhint' },
      '税率查询：' + (tax.capabilities.rates ? '有适用依据' : '待核验') + ' · 税额测算：' + (tax.capabilities.amounts ? '可用' : '待补条件') + ' · 已覆盖项目汇总：' + (tax.capabilities.summary ? '可用' : '待确认')));
    if (tax.lines && tax.lines.length) {
      var t = h('table', { class: 't' });
      t.appendChild(h('thead', {}, h('tr', {},
        h('th', {}, '分项'), h('th', {}, '性质'), h('th', { class: 'num' }, '税率'), h('th', { class: 'num' }, '税基/基础'), h('th', { class: 'num' }, '金额（' + tax.currency + '）'), h('th', {}, '承担方（合同视角）'), h('th', {}, '状态'))));
      var tb = h('tbody', {});
      tax.lines.forEach(function (l) {
        tb.appendChild(h('tr', {},
          h('td', {}, l.label, h('div', { class: 'subhint' }, sourceLinks(l.sourceIds))),
          h('td', {}, l.classification),
          h('td', { class: 'num' }, l.rate === null || l.rate === undefined ? '—' : (l.rate * 100).toFixed(l.rate * 100 % 1 === 0 ? 0 : 1) + '%'),
          h('td', { class: 'num' }, typeof l.base === 'number' ? l.base.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : (l.base || '—')),
          h('td', { class: 'num' }, l.amount === null || l.amount === undefined ? '—（被阻断）' : Number(l.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
          h('td', {}, l.payer || '—'),
          h('td', {}, l.status === 'indicative' ? h('span', { class: 'tag warn' }, '指示性') : l.status === 'blocked' ? h('span', { class: 'tag bad' }, '阻断') : h('span', { class: 'tag ok' }, '已算'))));
      });
      t.appendChild(tb);
      host.appendChild(h('div', { class: 'tbl-wrap' }, t));
      host.appendChild(h('p', {}, '已知法定分项小计：', h('b', {}, tax.known_statutory_subtotal === null ? '不可用（存在被阻断分项）' : fmtMoney(tax.known_statutory_subtotal, tax.currency)),
        '；本模型已覆盖法定项目汇总：', h('b', { style: tax.complete_total === null ? 'color:var(--red)' : 'color:var(--ok)' }, tax.complete_total === null ? '不可用' : fmtMoney(tax.complete_total, tax.currency))));
      if (tax.conditional_preferential_scenario) host.appendChild(h('p', { class: 'subhint' }, '优惠情景说明：' + tax.conditional_preferential_scenario));
      if (tax.preferential_duty_saving !== null && tax.preferential_duty_saving !== undefined && tax.preferential_duty_saving > 0) host.appendChild(h('p', { class: 'subhint' }, '如优惠成立，可节省关税约：' + fmtMoney(tax.preferential_duty_saving, tax.currency)));
    } else {
      host.appendChild(h('div', { class: 'banner bad' }, (tax.blockers && tax.blockers[0]) || '无法计算。'));
    }
    if (tax.blockers && tax.blockers.length) {
      var b = h('div', { class: 'banner bad' });
      b.appendChild(h('b', {}, '完整总额保持为空的原因（不按零处理）：'));
      var ul = h('ul', { style: 'margin:6px 0 0 18px' });
      tax.blockers.forEach(function (x) { ul.appendChild(h('li', {}, x)); });
      b.appendChild(ul);
      host.appendChild(b);
    }
    (tax.warnings || []).forEach(function (w) { host.appendChild(h('div', { class: 'banner warn' }, '提示：' + w)); });
    (tax.assumptions || []).forEach(function (a) { host.appendChild(h('div', { class: 'subhint' }, '测算假设：' + a)); });
    host.appendChild(h('div', { class: 'subhint', style: 'margin-top:6px' }, '计算依据快照：' + tax.snapshotDate + '；金额可由同一组输入复算。'));
  }
  $('btnBack2').addEventListener('click', function () { showTab('compliance'); });
  $('btnNext3').addEventListener('click', function () { showTab('news'); });

  /* ================= 第 4 步：新闻雷达 ================= */
  var newsFilter = { market: '', category: '', kw: '', projectOnly: false };
  function renderNews() {
    var host = $('newsBody');
    clear(host);
    var p = proj();
    var meta = NEWS.meta || {};
    var enLang = langKey() === 1;
    host.appendChild(h('div', { class: 'banner info' },
      h('b', {}, newsUpdatedText()),
      document.createTextNode(enLang ? '  Sources: official government and regulatory announcements. Scheduled snapshot, not real-time monitoring.' : '　来源：政府及监管机构公开公告；定时更新的公告快照，不是实时监控。')));

    if (!NEWS.items.length) {
      host.appendChild(h('div', { class: 'banner bad' }, '新闻快照为空或未加载（data/news.js 缺失）。请运行采集程序或检查部署文件。'));
      return;
    }
    var status = h('details', { class: 'box' });
    status.appendChild(h('summary', {}, (enLang ? 'Snapshot status (' + NEWS.items.length + ' items)' : '快照状态：共 ' + NEWS.items.length + ' 条')));
    status.appendChild(h('p', { class: 'subhint' }, enLang
      ? 'Collected on a schedule (about 09:17 and 17:17 Beijing time). An official announcement is not evidence that a regulation is already in force; effective dates follow the regulation text. Social-media and non-official sources are out of scope.'
      : '按计划定时采集（北京时间约 09:17 与 17:17）。官方公告不自动等于已生效法规，生效日期以法规原文为准；不覆盖全网舆情或社交平台。'));
    if (meta.allFailed) status.appendChild(h('div', { class: 'banner bad' }, '最近一次采集全部来源失败：已保留最后成功快照与时间。'));
    var st = h('table', { class: 't' });
    st.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '来源'), h('th', {}, '市场'), h('th', {}, '状态'))));
    var tb = h('tbody', {});
    (meta.sources || []).forEach(function (s) {
      tb.appendChild(h('tr', {}, h('td', {}, s.name), h('td', {}, s.market),
        h('td', {}, s.status === 'ok' ? h('span', { class: 'tag ok' }, '成功 ' + (s.count || '')) : s.status === 'error' ? h('span', { class: 'tag bad' }, '失败：' + (s.error || '').slice(0, 60)) : h('span', { class: 'tag' }, '待首次采集'))));
    });
    st.appendChild(tb);
    status.appendChild(h('div', { class: 'tbl-wrap' }, st));
    host.appendChild(status);

    var fc = h('div', { class: 'card' });
    fc.appendChild(h('h3', {}, '筛选'));
    var markets = [...new Set(NEWS.items.map(function (i) { return i.market; }))];
    var cats = [...new Set(NEWS.items.map(function (i) { return i.category; }))];
    var fs = h('div', { class: 'fields' });
    var mSel = h('select', {});
    mSel.appendChild(h('option', { value: '' }, '全部市场'));
    if (p.scenario.market) mSel.appendChild(h('option', { value: '__project__' }, '当前项目目的地（' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market) + '）'));
    markets.forEach(function (m) { mSel.appendChild(h('option', { value: m }, m)); });
    mSel.value = newsFilter.market;
    mSel.addEventListener('change', function () { newsFilter.market = mSel.value; renderNews(); });
    var cSel = h('select', {});
    cSel.appendChild(h('option', { value: '' }, '全部主题'));
    cats.forEach(function (c) { cSel.appendChild(h('option', { value: c }, c)); });
    cSel.value = newsFilter.category;
    cSel.addEventListener('change', function () { newsFilter.category = cSel.value; renderNews(); });
    var kwInp = h('input', { type: 'search', value: newsFilter.kw, placeholder: '标题/摘要关键词' });
    kwInp.addEventListener('change', function () { newsFilter.kw = kwInp.value.trim(); renderNews(); });
    fs.appendChild(h('label', { class: 'f' }, '市场', mSel));
    fs.appendChild(h('label', { class: 'f' }, '主题分类', cSel));
    fs.appendChild(h('label', { class: 'f' }, '关键词', kwInp));
    var poLabel = h('label', { class: 'f', style: 'flex-direction:row;align-items:center;gap:6px' });
    var poCb = h('input', { type: 'checkbox' });
    poCb.checked = newsFilter.projectOnly;
    poCb.addEventListener('change', function () { newsFilter.projectOnly = poCb.checked; renderNews(); });
    poLabel.appendChild(poCb); poLabel.appendChild(document.createTextNode(' 仅当前项目目的地'));
    fs.appendChild(poLabel);
    fc.appendChild(fs);
    if (p.newsSelected.length) fc.appendChild(h('div', { class: 'banner ok' }, '已选 ' + p.newsSelected.length + ' 条进入建议任务与综合报告。'));
    host.appendChild(fc);

    var projMarketNames = p.scenario.market ? chainOf(p.scenario.market).map(function (c) { return JUR[c] ? JUR[c].name : c; }) : [];
    var items = NEWS.items.filter(function (it) {
      if (newsFilter.projectOnly || newsFilter.market === '__project__') {
        if (projMarketNames.indexOf(it.market) < 0) return false;
      } else if (newsFilter.market && it.market !== newsFilter.market) return false;
      if (newsFilter.category && it.category !== newsFilter.category) return false;
      if (newsFilter.kw) {
        var kw = newsFilter.kw.toLowerCase();
        if (((it.title || '') + ' ' + (it.summary || '')).toLowerCase().indexOf(kw) < 0) return false;
      }
      return true;
    }).slice(0, 200);

    var list = h('div', { class: 'card' });
    list.appendChild(h('h3', {}, '新闻列表（' + items.length + ' 条）'));
    items.forEach(function (it) {
      var id = newsId(it);
      var sel = p.newsSelected.indexOf(id) >= 0;
      var row = h('div', { class: 'news-item' });
      var cb = h('input', { type: 'checkbox', 'aria-label': '选择新闻' });
      cb.checked = sel;
      cb.addEventListener('change', function () {
        if (cb.checked) { if (p.newsSelected.indexOf(id) < 0) p.newsSelected.push(id); }
        else p.newsSelected = p.newsSelected.filter(function (x) { return x !== id; });
        touch(); renderNews(); updateDots();
      });
      var body = h('div', { class: 'n-body' });
      body.appendChild(h('div', { class: 'n-title' }, h('a', { href: it.url || '#', target: '_blank', rel: 'noopener noreferrer' }, it.title || '（无标题）')));
      body.appendChild(h('div', { class: 'n-meta' }, '发布：' + fmtDate(it.date) + '｜来源：' + (it.source || '—') + '｜市场：' + (it.market || '—') + '｜快照：' + fmtDateTime(meta.exportedAt)));
      body.appendChild(h('div', {}, h('span', { class: 'tag' }, it.category || '未分类'), h('span', { class: 'tag ' + (it.level === '高' ? 'bad' : it.level === '中' ? 'warn' : '') }, '影响级别：' + (it.level || '中')), h('span', { class: 'tag warn' }, '核验：' + (it.verified || '待核验'))));
      if (it.summary) body.appendChild(h('div', { class: 'n-sum' }, it.summary));
      if (it.impact) body.appendChild(h('div', { class: 'n-impact' }, '规则提示（本地引擎，非千问分析）：' + it.impact));
      row.appendChild(cb); row.appendChild(body);
      list.appendChild(row);
    });
    if (!items.length) list.appendChild(h('div', { class: 'banner warn' }, '没有符合筛选条件的新闻。'));
    host.appendChild(list);
  }
  $('btnBack3').addEventListener('click', function () { showTab('tax'); });
  $('btnNext4').addEventListener('click', function () { showTab('qianwen'); });

  /* ================= 第 5 步：千问辅助建议 ================= */
  var API_SYSTEM_PROMPT = '你是一名面向中国企业小家电出海业务的合规与供应链顾问。请严格按用户任务中「要求的输出结构」作答，使用中文；每条结论附引用依据（法规编号/条款/官方链接）；对缺失信息明确列为待补资料，不得假设企业已取得认证、已确定进口商或已满足准入条件；未知税率与贸易救济不得按零处理；覆盖不足的产品与市场组合要明确说明缺口。';
  var API_SYSTEM_PROMPT_EN = 'You are a compliance and supply-chain adviser for Chinese small-home-appliance exporters. Answer strictly in the output structure requested in the task, in English. Attach a citation (regulation ID, clause or official link) to every conclusion. List missing information explicitly as required material; never assume the company is certified, has an importer of record, or meets market-entry conditions. Never treat unknown rates or trade remedies as zero. State the gap plainly for product × destination combinations that are not covered.';
  function apiSettings() { return state.settings; }
  function activeModel() {
    var st = state.settings;
    return (st.customModel || '').trim() || st.model || 'qwen-plus';
  }
  function apiEndpoint(region, base) {
    if (base && base.trim()) return base.trim().replace(/\/+$/, '') + '/chat/completions';
    return region === 'intl'
      ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions'
      : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  }
  function apiSystemPrompt() { return langKey() === 1 ? API_SYSTEM_PROMPT_EN : API_SYSTEM_PROMPT; }

  /** 报告第 0 节：功能状态与缺口摘要（与当前项目标签、税费覆盖矩阵同源） */
  function reportCapabilityCard() {
    var cap = window.VOCapability.evaluate(D, E, capabilityInput());
    var en = langKey() === 1;
    var card = h('div', { class: 'card' });
    card.appendChild(h('h3', {}, en ? '0. Capability and gaps' : '0. 功能状态与缺口摘要'));
    var tbl = h('table', { class: 't' });
    tbl.appendChild(h('thead', {}, h('tr', {},
      h('th', {}, en ? 'Function' : '功能'), h('th', {}, en ? 'Status' : '当前状态'),
      h('th', {}, en ? 'Why and what is needed' : '原因与所需资料'), h('th', {}, en ? 'Owner' : '责任方'))));
    var tb = h('tbody', {});
    cap.features.forEach(function (f) {
      var why = f.state === 'ok'
        ? (en ? 'Available with the current inputs.' : '当前输入下可用。')
        : ((REASON_TEXT[f.reason] || ['没有更多说明。', 'No further note.'])[en ? 1 : 0]
          + ((f.missing || []).map(fieldLabel).join(en ? ', ' : '、') || (en ? 'nothing further to fill in' : '无需额外填写项')));
      tb.appendChild(h('tr', {},
        h('td', {}, pick(FEATURE_TEXT[f.key])),
        h('td', {}, h('span', { class: 'tag ' + (f.state === 'ok' ? 'ok' : (f.state === 'not_supported' ? 'bad' : 'warn')) }, pick(STATE_TEXT[f.state] || ['—', '—']))),
        h('td', {}, why),
        h('td', {}, pick(OWNER_TEXT[f.owner] || ['—', '—']))));
    });
    tbl.appendChild(tb);
    card.appendChild(h('div', { class: 'tbl-wrap' }, tbl));
    card.appendChild(h('p', { class: 'subhint' }, en
      ? 'This summary uses the same capability check as the project status tags and the coverage matrix; switching language changes no value or conclusion.'
      : '本摘要与「当前项目」功能标签、税费覆盖矩阵使用同一套判断；切换语言不改变任何数值或结论。'));
    return card;
  }

  function buildApiRequest(task) {
    var st = state.settings;
    return {
      url: apiEndpoint(st.region, st.apiBase),
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + st.apiKey },
        body: JSON.stringify({
          model: activeModel(), temperature: 0.2, stream: false,
          messages: [{ role: 'system', content: apiSystemPrompt() }, { role: 'user', content: task }]
        })
      }
    };
  }
  function parseApiResponse(data) {
    if (data && Array.isArray(data.choices) && data.choices.length && data.choices[0].message && typeof data.choices[0].message.content === 'string') {
      return { ok: true, text: data.choices[0].message.content, model: data.model || data.choices[0].model || '' };
    }
    var msg = (data && (data.message || (data.error && data.error.message))) || '响应格式异常（未找到回复内容）';
    return { ok: false, error: msg };
  }
  var apiAbort = null;
  function callQianwenApi(task, cb) {
    var st = state.settings;
    if (!st.apiKey) { cb({ ok: false, error: '尚未填写 API Key：请展开下方「首次使用：配置 API Key」填写并保存。' }); return; }
    var req = buildApiRequest(task);
    apiAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (apiAbort) apiAbort.abort(); }, 180000);
    var startedAt = Date.now();
    var opts = req.init;
    if (apiAbort) opts.signal = apiAbort.signal;
    fetch(req.url, opts).then(function (res) {
      clearTimeout(timer);
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var detail = (data && (data.message || (data.error && data.error.message))) || '';
          var msg;
          if (res.status === 401) msg = 'API Key 无效或未授权。' + detail;
          else if (res.status === 403) msg = '无权访问该模型或资源。' + detail;
          else if (res.status === 404) msg = '模型名或接口地址不存在。' + detail;
          else if (res.status === 429) msg = '请求限流，请稍后重试。' + detail;
          else msg = 'HTTP ' + res.status + '：' + (detail || '服务端错误');
          cb({ ok: false, error: msg });
          return;
        }
        var parsed = parseApiResponse(data);
        if (!parsed.ok) { cb({ ok: false, error: parsed.error }); return; }
        cb({ ok: true, text: parsed.text, model: parsed.model || activeModel(), elapsed: Date.now() - startedAt });
      });
    }).catch(function (err) {
      clearTimeout(timer);
      var msg = (err && err.name === 'AbortError') ? '已取消或请求超时（180 秒）。'
        : '网络或跨域请求失败：' + ((err && err.message) || '未知错误') + '。可改用国际站端点、自建代理地址，或使用下方手动分析。';
      cb({ ok: false, error: msg });
    });
  }
  function saveQianwenResponse(text, extra) {
    var p = proj();
    p.qianwen.responses.unshift(Object.assign({
      id: 'R' + Date.now().toString(36), at: new Date().toISOString(), hash: inputHash(), text: String(text || '')
    }, extra || {}));
    if (p.qianwen.responses.length > 20) p.qianwen.responses.pop();
    touch();
  }
  function responseBadge(r) {
    if (r.via === 'api') return h('span', { class: 'tag brand' }, '千问回复（API 调用' + (r.model ? ' · ' + r.model : '') + '）');
    return h('span', { class: 'tag brand' }, '千问回复（人工导入）');
  }
  var apiState = { running: false, started: 0, note: '' };

  function buildTaskText() {
    var p = proj();
    var sc = runCompliance();
    var sub = subById(p.scenario.subcategoryId);
    var marketName = JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market;
    var lines = [];
    lines.push('# 小家电出海分析任务（远见·企业出海助手 生成）');
    lines.push('');
    lines.push('生成时间：' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '｜输入版本：' + inputHash() + '｜数据快照：' + E.SNAPSHOT_DATE);
    lines.push('');
    lines.push('请以合规顾问视角分析以下出海情景。要求：只基于「已知事实」与「引用依据」推理；对缺失信息明确列为「待补资料」，不要假设已取得认证或已确定进口商。');
    lines.push('');
    lines.push('## 一、项目情景');
    lines.push('- 项目：' + p.name + '；企业：' + (p.companyName || '未填写'));
    lines.push('- 产品小类：' + (sub ? sub.name + '（' + sub.id + '，证据等级 ' + sub.evidence + '）' : '未选') + '；主要功能：' + (sub ? sub.core : '—'));
    lines.push('- 目的地：' + marketName + '（法域链：' + (sc ? sc.jurisdictionChain.join(' → ') : '—') + '）');
    lines.push('- 投放市场日期：' + (p.scenario.placingOnMarketDate || '未填') + '；进口/申报日期：' + (p.scenario.importDate || '未填') + '；企业角色：' + (p.scenario.role || '未填'));
    lines.push('');
    lines.push('## 二、已知产品/经营事实');
    var facts = engineFacts();
    var keys = Object.keys(facts);
    if (!keys.length) lines.push('（暂无已登记事实）');
    keys.sort().forEach(function (k) {
      var f = lookupField(k);
      var v = facts[k];
      var vs = v === true ? '是' : v === false ? '否' : String(v);
      lines.push('- ' + (f ? f.name : k) + '（' + k + '）：' + vs + (p.scenario.factNotes[k] ? '〔' + p.scenario.factNotes[k] + '〕' : ''));
    });
    var unk = Object.keys(p.scenario.factsUnknown).filter(function (k) { return p.scenario.factsUnknown[k]; });
    if (unk.length) {
      lines.push('');
      lines.push('## 三、明确不确定的事实（不得按“否”推断）');
      unk.forEach(function (k) { var f = lookupField(k); lines.push('- ' + (f ? f.name : k) + '（' + k + '）'); });
    }
    if (sc) {
      lines.push('');
      lines.push('## 四、本地规则引擎初筛结果（规则提示，非千问输出）');
      lines.push('- 覆盖等级：' + sc.coverage.level + '（' + sc.coverage.label + '）');
      lines.push('- 可能适用规则 ' + sc.applicableRules.length + ' 条：' + (sc.applicableRules.map(function (r) { return r.id + ' ' + r.name; }).join('；') || '无'));
      lines.push('- 待补事实规则 ' + sc.unknownRules.length + ' 条；缺失字段：' + (sc.missingFields.join('、') || '无'));
      lines.push('- 不适用规则 ' + sc.excludedRules.length + ' 条；待规则核验法规 ' + sc.pendingRegulations.length + ' 条');
      sc.gaps.forEach(function (g) { lines.push('- 覆盖缺口：' + g); });
    }
    var tax = E.calculateTaxes(D, taxInput());
    lines.push('');
    lines.push('## 五、税费阶段测算与缺口');
    if (tax.lines && tax.lines.length) {
      lines.push('- 币种：' + tax.currency + '；已知法定分项小计：' + (tax.known_statutory_subtotal === null ? '不可用' : tax.known_statutory_subtotal) + '；完整总额：' + (tax.complete_total === null ? '不可用' : tax.complete_total));
      tax.lines.forEach(function (l) { lines.push('  - ' + l.label + '：税率 ' + (l.rate === null ? '—' : (l.rate * 100) + '%') + '，金额 ' + (l.amount === null ? '被阻断' : l.amount) + '（' + l.classification + '）'); });
    } else {
      lines.push('- 当前目的地没有已核税费规则：' + (tax.blockers[0] || ''));
    }
    (tax.blockers || []).forEach(function (b) { lines.push('- 阻断原因：' + b); });
    if (p.newsSelected.length) {
      lines.push('');
      lines.push('## 六、所选政策新闻线索');
      NEWS.items.filter(function (it) { return p.newsSelected.indexOf(newsId(it)) >= 0; }).forEach(function (it) {
        lines.push('- [' + fmtDate(it.date) + '][' + it.market + '][' + it.category + '] ' + it.title + '（来源：' + it.source + '；核验状态：' + (it.verified || '待核验') + '）');
        if (it.summary) lines.push('  摘要：' + String(it.summary).slice(0, 200));
        lines.push('  原文：' + it.url);
      });
      lines.push('提示：官方新闻不自动等于已生效法规；请核对适用日期与产品范围。');
    }
    lines.push('');
    lines.push('## 七、要求的输出结构');
    lines.push('请严格按以下结构输出，并在每项结论后标注引用依据（法规编号/条款/官方链接）：');
    lines.push('1. 已知事实清单（区分企业档案带入值与出口版需重核值）；');
    lines.push('2. 适用前提（每条结论成立所依赖的事实与日期条件）；');
    lines.push('3. 待补资料清单（按优先级排序，注明向谁索取）；');
    lines.push('4. 优先行动（含建议责任角色：合规/产品/质量/物流/销售）；');
    lines.push('5. 引用依据汇总；');
    lines.push('6. 三组建议：**立即办理** ／ **补证后判断** ／ **持续关注**。');
    lines.push('');
    lines.push('约束：不要虚构认证状态、进口商、税率或生效日期；未知税率与贸易救济不得按零处理；对覆盖不足的产品与市场组合明确说明缺口。');
    return lines.join('\n');
  }

  function renderQianwen() {
    var host = $('qianwenBody');
    clear(host);
    var p = proj();
    var cur = inputHash();
    var st = apiSettings();

    /* 主卡：在线分析 */
    var main = h('div', { class: 'card' });
    main.appendChild(h('h3', {}, '在线分析：一键调用千问 API'));
    main.appendChild(h('p', { class: 'subhint' }, '任务自动根据当前项目生成（含合规结果、税费缺口与所选新闻），回复自动保存并合并进综合报告。'));
    var runBtn = h('button', { class: 'btn' }, st.apiKey ? '调用千问 API 生成建议' : '调用千问 API（先配置密钥）');
    var stopBtn = h('button', { class: 'btn danger', style: 'display:none' }, '取消');
    var status = h('p', { class: 'subhint' });
    function refreshStatus() {
      if (apiState.running) status.textContent = '正在调用千问 API（' + activeModel() + '）…已用时 ' + Math.round((Date.now() - apiState.started) / 1000) + ' 秒。';
      else status.textContent = apiState.err ? ('上次调用失败：' + apiState.err) : (st.apiKey ? ('将使用：' + activeModel() + ' · ' + (st.region === 'intl' ? '国际站' : '中国大陆')) : '首次使用请在下方配置 API Key。');
    }
    refreshStatus();
    runBtn.addEventListener('click', function () {
      if (apiState.running) return;
      if (!apiSettings().apiKey) { toast('请先展开「首次使用：配置 API Key」填写并保存', 'err'); return; }
      if (!proj().scenario.market || !proj().scenario.subcategoryId) { toast('请先在第 1 步完成目的地与品类登记', 'err'); return; }
      var task = buildTaskText();
      apiState.running = true; apiState.started = Date.now(); apiState.err = '';
      runBtn.disabled = true; runBtn.innerHTML = '';
      runBtn.appendChild(h('span', { class: 'spin' })); runBtn.appendChild(document.createTextNode('调用中'));
      stopBtn.style.display = '';
      var tick = setInterval(refreshStatus, 1000);
      callQianwenApi(task, function (r) {
        clearInterval(tick);
        apiState.running = false; runBtn.disabled = false;
        runBtn.textContent = '重新调用千问 API';
        stopBtn.style.display = 'none';
        if (r.ok) {
          saveQianwenResponse(r.text, { via: 'api', model: r.model, elapsed: r.elapsed });
          toast('千问回复已保存（API 调用 · ' + r.model + '，' + (r.elapsed / 1000).toFixed(1) + ' 秒）', 'ok');
          renderQianwen(); updateDots();
        } else {
          apiState.err = r.error; refreshStatus();
          toast('调用失败：' + r.error, 'err');
        }
      });
    });
    stopBtn.addEventListener('click', function () { if (apiAbort) apiAbort.abort(); });
    main.appendChild(h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, runBtn, stopBtn));
    main.appendChild(status);

    /* 内嵌折叠设置 */
    var setBox = h('details', { class: 'box' });
    setBox.appendChild(h('summary', {}, st.apiKey ? '已配置：' + (st.region === 'intl' ? '国际站' : '中国大陆') + ' · ' + activeModel() + ' · 密钥存本机（点击修改）' : '首次使用：配置 API Key（仅存本机浏览器）'));
    setBox.appendChild(h('div', { class: 'banner info' }, '直连阿里云百炼（DashScope）OpenAI 兼容接口。需要你自己的 DashScope API Key；密钥仅保存在本机浏览器 localStorage，不进入页面代码、仓库或导出文件；调用费用由你的阿里云账户承担。公共电脑上请用后点「清除密钥」。'));
    var sf = h('div', { class: 'fields' });
    var regionSel = h('select', {});
    regionSel.appendChild(h('option', { value: 'cn' }, '中国大陆（dashscope.aliyuncs.com）'));
    regionSel.appendChild(h('option', { value: 'intl' }, '国际站（dashscope-intl.aliyuncs.com）'));
    regionSel.value = st.region || 'cn';
    var modelSel = h('select', {});
    ['qwen-plus', 'qwen-turbo', 'qwen-max'].forEach(function (m) {
      modelSel.appendChild(h('option', { value: m }, m + (m === 'qwen-plus' ? '（默认，均衡）' : m === 'qwen-turbo' ? '（最快最省）' : '（能力最强）')));
    });
    modelSel.value = st.model || 'qwen-plus';
    var keyInp = h('input', { type: 'password', placeholder: 'sk-…', autocomplete: 'off' });
    keyInp.value = st.apiKey || '';
    var customInp = h('input', { type: 'text', value: st.customModel || '', placeholder: '自定义模型名（留空用上方）' });
    var baseInp = h('input', { type: 'text', value: st.apiBase || '', placeholder: '自定义接口地址（网络受限时填代理网关）' });
    sf.appendChild(h('label', { class: 'f' }, '服务区域', regionSel));
    sf.appendChild(h('label', { class: 'f' }, '模型', modelSel));
    sf.appendChild(h('label', { class: 'f' }, 'API Key', keyInp));
    sf.appendChild(h('label', { class: 'f' }, '自定义模型（可选）', customInp));
    sf.appendChild(h('label', { class: 'f' }, '自定义接口地址（可选）', baseInp));
    setBox.appendChild(sf);
    var sbRow = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px' });
    var saveBtn = h('button', { class: 'btn sm' }, '保存设置');
    var testBtn = h('button', { class: 'btn sec sm' }, '测试连通');
    var clearBtn = h('button', { class: 'btn danger sm' }, '清除密钥');
    sbRow.appendChild(saveBtn); sbRow.appendChild(testBtn); sbRow.appendChild(clearBtn);
    setBox.appendChild(sbRow);
    function collectInputs() {
      Object.assign(state.settings, { region: regionSel.value, model: modelSel.value, customModel: customInp.value, apiKey: keyInp.value.trim(), apiBase: baseInp.value.trim() });
      persist(false);
    }
    saveBtn.addEventListener('click', function () {
      collectInputs(); apiState.note = ''; toast('API 设置已保存到本机（密钥不上传）', 'ok'); renderQianwen();
    });
    testBtn.addEventListener('click', function () {
      collectInputs();
      if (!state.settings.apiKey) { toast('请先填写 API Key', 'err'); return; }
      testBtn.disabled = true; testBtn.textContent = '测试中…';
      callQianwenApi('连通性测试：请只回复两个字符：OK', function (r) {
        testBtn.disabled = false; testBtn.textContent = '测试连通';
        if (r.ok) { apiState.note = '连通成功（' + r.model + '，' + (r.elapsed / 1000).toFixed(1) + 's）'; toast('连通测试成功', 'ok'); }
        else { apiState.note = '失败：' + r.error; toast('测试失败：' + r.error, 'err'); }
        renderQianwen();
      });
    });
    clearBtn.addEventListener('click', function () {
      if (!window.confirm('确定清除本机保存的 API Key？')) return;
      state.settings.apiKey = ''; keyInp.value = ''; persist(false); toast('密钥已清除', 'ok'); renderQianwen();
    });
    main.appendChild(setBox);

    /* 内嵌手动闭环 */
    var mBox = h('details', { class: 'box' });
    mBox.appendChild(h('summary', {}, '不用 API？手动分析：生成任务 → 复制交给千问办公 → 粘贴回复保存'));
    var genBtn = h('button', { class: 'btn sec sm' }, '生成分析任务');
    var copyBtn = h('button', { class: 'btn sec sm' }, '复制任务');
    var ta = h('textarea', { class: 'task', spellcheck: 'false', readonly: 'readonly', 'aria-label': '分析任务文本' });
    ta.value = p.qianwen.taskText || '';
    function updateTaskMeta() {
      meta.textContent = !p.qianwen.taskText ? '尚未生成任务。'
        : '生成于 ' + fmtDateTime(p.qianwen.taskAt) + '；指纹 ' + p.qianwen.taskHash + (p.qianwen.taskHash === cur ? '（与当前输入一致）' : '（当前输入已变化，建议重新生成）');
    }
    var meta = h('p', { class: 'subhint' });
    genBtn.addEventListener('click', function () {
      genBtn.disabled = true; genBtn.textContent = '生成中…';
      setTimeout(function () {
        try {
          p.qianwen.taskText = buildTaskText();
          p.qianwen.taskHash = inputHash();
          p.qianwen.taskAt = new Date().toISOString();
          ta.value = p.qianwen.taskText;
          updateTaskMeta(); touch();
          toast('任务已生成', 'ok');
        } catch (e) { toast('生成失败：' + e.message, 'err'); }
        genBtn.disabled = false; genBtn.textContent = '重新生成分析任务';
      }, 120);
    });
    copyBtn.addEventListener('click', function () {
      if (!ta.value) { toast('请先生成任务', 'err'); return; }
      var done = function () { toast('已复制，请粘贴给千问办公', 'ok'); };
      var fail = function () {
        ta.removeAttribute('readonly'); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败：请手动全选复制', 'err'); }
        window.getSelection && window.getSelection().removeAllRanges();
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fail);
      else fail();
    });
    var pasteArea = h('textarea', { class: 'task', style: 'min-height:120px', placeholder: '粘贴千问办公的真实回复……' });
    var pasteSave = h('button', { class: 'btn sec sm', style: 'margin-top:6px' }, '保存粘贴的回复');
    pasteSave.addEventListener('click', function () {
      if (!pasteArea.value.trim()) { toast('回复内容为空', 'err'); return; }
      saveQianwenResponse(pasteArea.value.trim(), { via: 'manual' });
      toast('回复已保存（人工导入）', 'ok');
      renderQianwen(); updateDots();
    });
    mBox.appendChild(h('div', { style: 'display:flex;gap:8px;margin:6px 0' }, genBtn, copyBtn));
    mBox.appendChild(ta);
    updateTaskMeta();
    mBox.appendChild(meta);
    mBox.appendChild(pasteArea);
    mBox.appendChild(pasteSave);
    main.appendChild(mBox);
    host.appendChild(main);

    /* 回复列表 */
    var lc = h('div', { class: 'card' });
    lc.appendChild(h('h3', {}, '千问回复（' + p.qianwen.responses.length + '）· 与本地规则提示严格区分'));
    if (!p.qianwen.responses.length) lc.appendChild(h('p', { class: 'subhint' }, '还没有回复。上方一键调用或手动粘贴均可。'));
    p.qianwen.responses.forEach(function (r) {
      var same = r.hash === cur;
      var item = h('div', { class: 'rule-item ' + (same ? 'state-applicable' : 'state-unknown') });
      var head = h('div', { class: 'head' });
      head.appendChild(responseBadge(r));
      head.appendChild(h('span', { class: 'tag' }, '保存于 ' + fmtDateTime(r.at)));
      head.appendChild(same ? h('span', { class: 'tag ok' }, '与当前输入一致') : h('span', { class: 'tag bad' }, '需要重新分析（输入已变化）'));
      item.appendChild(head);
      item.appendChild(h('div', { class: 'body', style: 'white-space:pre-wrap;font-size:13.5px' }, r.text));
      var del = h('button', { class: 'btn sm danger', style: 'margin-top:6px' }, '删除该回复');
      del.addEventListener('click', function () {
        proj().qianwen.responses = proj().qianwen.responses.filter(function (x) { return x.id !== r.id; });
        touch(); renderQianwen(); updateDots();
      });
      item.appendChild(del);
      lc.appendChild(item);
    });
    host.appendChild(lc);
  }
  $('btnBack4').addEventListener('click', function () { showTab('news'); });
  $('btnNext5').addEventListener('click', function () { showTab('report'); });

  /* ================= 第 6 步：综合报告 ================= */
  function reportData() {
    var p = proj();
    var sc = runCompliance();
    var tax = E.calculateTaxes(D, taxInput());
    var sub = subById(p.scenario.subcategoryId);
    var selectedNews = NEWS.items.filter(function (it) { return p.newsSelected.indexOf(newsId(it)) >= 0; });
    return { p: p, sc: sc, tax: tax, sub: sub, selectedNews: selectedNews, hash: inputHash() };
  }
  function renderReport() {
    var host = $('reportBody');
    clear(host);
    var p = proj();
    var R = reportData();

    var head = h('div', { class: 'card' });
    head.appendChild(h('h2', {}, '远见 · 企业出海综合报告'));
    head.appendChild(h('p', { class: 'subhint' }, '项目：' + p.name + '｜生成时间：' + fmtDateTime(new Date().toISOString()) + '｜输入版本：' + R.hash + '｜数据快照：' + E.SNAPSHOT_DATE));
    if (p.reportSnapshots.length) {
      var latest = p.reportSnapshots[0];
      head.appendChild(latest.hash === R.hash
        ? h('div', { class: 'fresh' }, '最新报告快照（' + fmtDateTime(latest.at) + '）与当前输入一致。')
        : h('div', { class: 'stale' }, '注意：当前输入与最近快照（' + fmtDateTime(latest.at) + '）不一致——快照为历史结果，以下内容由当前输入实时重算。'));
    } else {
      head.appendChild(h('div', { class: 'banner info' }, '尚未保存报告快照；每次评审前建议点击右上「保存报告快照」。'));
    }
    head.appendChild(h('p', { class: 'subhint' }, '本机保存说明：项目数据保存在本机浏览器，属单人本机使用，非多人协作。'));
    host.appendChild(head);
    host.appendChild(reportCapabilityCard());

    var s1 = h('div', { class: 'card' });
    s1.appendChild(h('h3', {}, '1. 企业与项目'));
    var kv = h('dl', { class: 'kv' });
    function kvr(k, v) { kv.appendChild(h('dt', {}, k)); kv.appendChild(h('dd', {}, v === '' || v === undefined ? '—' : v)); }
    kvr('企业', p.companyName || '未填写');
    kvr('项目', p.name);
    kvr('目的地', p.scenario.market ? (JUR[p.scenario.market] ? JUR[p.scenario.market].name + '（' + p.scenario.market + '）' : p.scenario.market) : '未选');
    kvr('产品小类', R.sub ? R.sub.name + '（' + R.sub.id + '，证据 ' + R.sub.evidence + '）' : '未选');
    kvr('投放市场日期', p.scenario.placingOnMarketDate || '未填');
    kvr('进口/申报日期', p.scenario.importDate || '未填');
    kvr('企业角色', p.scenario.role || '未填');
    s1.appendChild(kv);
    host.appendChild(s1);

    var s2 = h('div', { class: 'card' });
    s2.setAttribute('id', 'repFactsCard');
    s2.appendChild(h('h3', {}, '2. 关键产品与经营事实'));
    var facts = engineFacts();
    var fkeys = Object.keys(facts);
    var ukeys = Object.keys(p.scenario.factsUnknown).filter(function (k) { return p.scenario.factsUnknown[k]; });
    if (fkeys.length || ukeys.length) {
      var ft = h('table', { class: 't' });
      ft.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '事实'), h('th', {}, '值'), h('th', {}, '来源/说明'))));
      var fb = h('tbody', {});
      fkeys.sort().forEach(function (k) {
        var f = lookupField(k);
        var v = facts[k];
        fb.appendChild(h('tr', {}, h('td', {}, f ? f.name : k), h('td', {}, v === true ? '是' : v === false ? '否' : String(v)), h('td', {}, p.scenario.factNotes[k] || '')));
      });
      ukeys.forEach(function (k) {
        var f = lookupField(k);
        fb.appendChild(h('tr', {}, h('td', {}, f ? f.name : k), h('td', {}, h('span', { class: 'tag warn' }, '不确定')), h('td', {}, '对应判断保持待确认，不按「否」处理')));
      });
      ft.appendChild(fb);
      s2.appendChild(h('div', { class: 'tbl-wrap' }, ft));
    } else s2.appendChild(h('p', { class: 'subhint' }, '未登记产品事实。'));
    host.appendChild(s2);

    var s3 = h('div', { class: 'card' });
    s3.appendChild(h('h3', {}, '3. 法规与合规初筛结论'));
    if (!R.sc) s3.appendChild(h('p', { class: 'subhint' }, '未完成登记，无法评估。'));
    else {
      var sc = R.sc;
      s3.appendChild(h('p', {}, '覆盖等级：', h('b', {}, sc.coverage.level + '（' + sc.coverage.label + '）'), '；法域链：' + sc.jurisdictionChain.join(' → ') + '；基准日期：' + sc.asOf));
      sc.gaps.forEach(function (g) { s3.appendChild(h('div', { class: 'banner bad' }, '覆盖缺口：' + g)); });
      var rt = h('table', { class: 't' });
      rt.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '规则'), h('th', {}, '结论'), h('th', {}, '义务/原因'), h('th', {}, '依据'))));
      var rb = h('tbody', {});
      function ruleRow(r, stateLabel, cls) {
        rb.appendChild(h('tr', {},
          h('td', {}, h('b', {}, r.name), h('div', { class: 'subhint' }, r.id + '｜' + (JUR[r.jurisdiction] ? JUR[r.jurisdiction].name : r.jurisdiction))),
          h('td', {}, h('span', { class: 'tag ' + cls }, stateLabel)),
          h('td', {}, r.state === 'unknown' ? ('待补：' + (r.missingFields || []).map(function (k) { var f = lookupField(k); return f ? f.name : k; }).join('、')) : (r.state === 'not_applicable' ? ((r.dateActive === false ? r.dateReason + '；' : '') + (r.notApplicable || '条件不满足')) : (r.obligation || ''))),
          h('td', {}, h('div', { class: 'subhint' }, r.locator || ''), sourceLinks(r.sourceIds))));
      }
      sc.applicableRules.forEach(function (r) { ruleRow(r, r.state === 'review_required' ? '需人工复核' : '可能适用', r.state === 'review_required' ? 'info' : 'ok'); });
      sc.unknownRules.forEach(function (r) { ruleRow(r, '待补事实', 'warn'); });
      sc.excludedRules.forEach(function (r) { ruleRow(r, '不适用', ''); });
      rt.appendChild(rb);
      s3.appendChild(h('div', { class: 'tbl-wrap' }, rt));
      if (sc.pendingRegulations.length) {
        var pd = h('details', { class: 'box' });
        pd.appendChild(h('summary', {}, '待规则核验法规（' + sc.pendingRegulations.length + ' 条，仅索引级）'));
        sc.pendingRegulations.forEach(function (reg) {
          pd.appendChild(h('div', {}, '· ' + reg.name + '（' + reg.id + '，核验 ' + reg.checkedAt + '）', reg.officialUrl ? h('a', { href: reg.pdfPath || reg.officialUrl, target: '_blank', rel: 'noopener noreferrer', style: 'margin-left:6px' }, reg.pdfPath ? '查看 PDF' : '查看官方网页') : null));
        });
        s3.appendChild(pd);
      }
    }
    host.appendChild(s3);

    var s4 = h('div', { class: 'card' });
    s4.appendChild(h('h3', {}, '4. 行动清单与材料（含完成状态）'));
    if (R.sc && R.sc.actionList.length) {
      var at = h('table', { class: 't' });
      at.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '行动'), h('th', {}, '责任建议'), h('th', {}, '节点'), h('th', {}, '状态'))));
      var ab = h('tbody', {});
      R.sc.actionList.forEach(function (a) {
        var done = !!(p.todoState[a.id] && p.todoState[a.id].done);
        ab.appendChild(h('tr', {},
          h('td', {}, h('b', {}, a.name), h('div', { class: 'subhint' }, a.text + (a.locator ? '｜' + a.locator : ''))),
          h('td', {}, a.responsibility || '—'),
          h('td', {}, a.due || '—'),
          h('td', {}, done ? h('span', { class: 'tag ok' }, '已勾选完成') : h('span', { class: 'tag' }, '未完成'))));
      });
      at.appendChild(ab);
      s4.appendChild(h('div', { class: 'tbl-wrap' }, at));
      s4.appendChild(h('p', {}, '涉及材料：', R.sc.materialList.map(function (m) { return m.name + (m.prep ? '（' + m.prep + '）' : ''); }).join('；') || '—'));
    } else s4.appendChild(h('p', { class: 'subhint' }, '当前没有适用规则生成的行动与材料；不代表无需办理手续，请查看缺口与待核验清单。'));
    host.appendChild(s4);

    var s5 = h('div', { class: 'card' });
    s5.appendChild(h('h3', {}, '5. HS 候选与税费阶段测算'));
    var kbRows = (D.taxRules || []).filter(function (r) { return r.market === p.scenario.market || r.market === 'ALL'; });
    if (kbRows.length) s5.appendChild(h('p', { class: 'subhint' }, '引用税则知识库条目：' + kbRows.map(function (r) { return r.id; }).join('、') + '（核对日期 ' + (kbRows[0].verifiedAsOf || '—') + '；通用规则已核对，本票是否适用仍需确认）。'));
    var tplUsed = (D.taxTemplates || []).find(function (t) { return t.market === p.scenario.market; });
    if (tplUsed && !(R.tax.lines && R.tax.lines.length)) s5.appendChild(h('p', { class: 'subhint' }, '该市场按研究变量计算式模板展示：' + tplUsed.label + '；税率未核实不代入数值。'));

    if (p.hsChoice) {
      var c = D.hsCandidates.find(function (x) { return x.id === p.hsChoice; });
      if (c) s5.appendChild(h('p', {}, '选定 HS 候选：', h('b', {}, c.code), '（候选方向，非海关最终归类；复核状态：' + (c.review || '—') + '）'));
    } else s5.appendChild(h('p', { class: 'subhint' }, '未选择 HS 候选。'));
    if (R.tax.lines && R.tax.lines.length) {
      var tt = h('table', { class: 't' });
      tt.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '分项'), h('th', { class: 'num' }, '税率'), h('th', { class: 'num' }, '税基'), h('th', { class: 'num' }, '金额（' + R.tax.currency + '）'), h('th', {}, '承担方'), h('th', {}, '依据'))));
      var tb2 = h('tbody', {});
      R.tax.lines.forEach(function (l) {
        tb2.appendChild(h('tr', {}, h('td', {}, l.label),
          h('td', { class: 'num' }, l.rate === null || l.rate === undefined ? '—' : (l.rate * 100).toFixed(l.rate * 100 % 1 === 0 ? 0 : 1) + '%'),
          h('td', { class: 'num' }, typeof l.base === 'number' ? l.base.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : (l.base || '—')),
          h('td', { class: 'num' }, l.amount === null || l.amount === undefined ? '—（被阻断）' : Number(l.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })),
          h('td', {}, l.payer || '—'),
          h('td', {}, sourceLinks(l.sourceIds))));
      });
      tt.appendChild(tb2);
      s5.appendChild(h('div', { class: 'tbl-wrap' }, tt));
      s5.appendChild(h('p', {}, '已知法定分项小计：', h('b', {}, R.tax.known_statutory_subtotal === null ? '不可用' : fmtMoney(R.tax.known_statutory_subtotal, R.tax.currency)),
        '；完整总额：', h('b', { style: R.tax.complete_total === null ? 'color:var(--red)' : 'color:var(--ok)' }, R.tax.complete_total === null ? '不可用' : fmtMoney(R.tax.complete_total, R.tax.currency))));
      (R.tax.blockers || []).forEach(function (b) { s5.appendChild(h('div', { class: 'banner bad' }, '阻断：' + b)); });
    } else {
      (R.tax.blockers || ['当前目的地无已核税费规则。']).forEach(function (b) { s5.appendChild(h('div', { class: 'banner bad' }, '税费缺口：' + b)); });
    }
    host.appendChild(s5);

    var s6 = h('div', { class: 'card' });
    s6.appendChild(h('h3', {}, '6. 所选政策新闻（' + R.selectedNews.length + ' 条）'));
    s6.appendChild(h('p', { class: 'subhint' }, '官方新闻不自动等于已生效法规；快照时间 ' + fmtDateTime(NEWS.meta && NEWS.meta.exportedAt) + '。'));
    R.selectedNews.forEach(function (it) {
      s6.appendChild(h('div', {}, '· [' + fmtDate(it.date) + '][' + it.market + '] ',
        h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, it.title),
        '（' + it.source + '，核验：' + (it.verified || '待核验') + '）'));
    });
    if (!R.selectedNews.length) s6.appendChild(h('p', { class: 'subhint' }, '未选择新闻。'));
    host.appendChild(s6);

    var s7 = h('div', { class: 'card' });
    s7.appendChild(h('h3', {}, '7. 千问辅助建议（' + p.qianwen.responses.length + ' 份）'));
    s7.appendChild(h('p', { class: 'subhint' }, '第 3 节规则结论来自本地引擎（规则提示）；以下为千问回复（API 调用或人工导入），页面不虚构任何模型输出。'));
    if (p.qianwen.responses.length) {
      p.qianwen.responses.forEach(function (r) {
        var same = r.hash === R.hash;
        s7.appendChild(h('div', { class: 'rule-item ' + (same ? 'state-applicable' : 'state-unknown') },
          h('div', { class: 'head' },
            responseBadge(r),
            h('span', { class: 'tag' }, fmtDateTime(r.at)),
            same ? h('span', { class: 'tag ok' }, '与当前输入一致') : h('span', { class: 'tag bad' }, '需要重新分析（输入已变化）')),
          h('div', { class: 'body', style: 'white-space:pre-wrap;font-size:13.5px' }, r.text)));
      });
    } else {
      s7.appendChild(h('div', { class: 'banner info' }, '尚无千问回复。请到第 5 步生成。'));
    }
    host.appendChild(s7);

    var s8 = h('div', { class: 'card' });
    s8.appendChild(h('h3', {}, '8. 结论追溯与免责'));
    s8.appendChild(h('p', { class: 'subhint' }, '每条规则结论含规则 ID、法域、条款定位与来源链接；税费分项含税率、税基、币种、承担方与来源 ID；新闻含发布时间、来源与核验状态；千问回复含保存时间、来源方式与输入指纹。'));
    s8.appendChild(h('p', { class: 'subhint' }, '本报告为合规准备与资料组织工具输出：不构成正式合规、认证、法律、税务、原产资格或海关归类结论；数据快照 ' + E.SNAPSHOT_DATE + '。'));
    host.appendChild(s8);

    $('reportHint').textContent = '历史快照 ' + p.reportSnapshots.length + ' 份' + (p.reportSnapshots[0] ? '（最新 ' + fmtDateTime(p.reportSnapshots[0].at) + '）' : '');
  }
  $('btnPrint').addEventListener('click', function () { window.print(); });
  function exportJson() {
    var p = proj();
    var R = reportData();
    var payload = {
      exportedAt: new Date().toISOString(), app: D.meta.app, version: D.meta.version,
      snapshot: E.SNAPSHOT_DATE, inputHash: R.hash, project: p,
      computed: {
        coverage: R.sc ? R.sc.coverage : null,
        applicableRules: R.sc ? R.sc.applicableRules.map(function (r) { return { id: r.id, name: r.name, obligation: r.obligation, locator: r.locator, sourceIds: r.sourceIds }; }) : [],
        unknownRules: R.sc ? R.sc.unknownRules.map(function (r) { return { id: r.id, missingFields: r.missingFields }; }) : [],
        gaps: R.sc ? R.sc.gaps : [],
        tax: { currency: R.tax.currency, known_statutory_subtotal: R.tax.known_statutory_subtotal, complete_total: R.tax.complete_total, blockers: R.tax.blockers, lines: R.tax.lines },
        selectedNews: R.selectedNews
      },
      note: '项目导出文件（单人本机使用），不含任何 API 密钥。'
    };
    var blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '远见出海项目-' + (p.name || '未命名') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('项目 JSON 已导出（不含密钥）', 'ok');
  }
  $('btnExportJson').addEventListener('click', exportJson);
  $('btnExportJsonMini').addEventListener('click', exportJson);
  $('btnSaveSnapshot').addEventListener('click', function () {
    var p = proj();
    var R = reportData();
    p.reportSnapshots.unshift({ at: new Date().toISOString(), hash: R.hash, name: p.name, note: '适用 ' + (R.sc ? R.sc.applicableRules.length : 0) + ' 条；税费完整总额 ' + (R.tax.complete_total === null ? '不可用' : R.tax.complete_total) });
    if (p.reportSnapshots.length > 10) p.reportSnapshots.pop();
    touch();
    toast('报告快照已保存（指纹 ' + R.hash + '）', 'ok');
    renderReport(); updateDots();
  });


  /** 把数据层的核验状态转成用户能执行的提醒（不丢含义，也不夸大） */
  function taxStatusNote(r) {
    var bits = [];
    if (/企业个案资格未核/.test(r.status || '')) bits.push('优惠资格需按你这一票单独确认');
    else if (/已核/.test(r.status || '')) bits.push('通用规则已核对，本票适用仍需按交易确认');
    if (/不得把未查到当 ?0|不得按 ?0/.test((r.status || '') + (r.missingBehavior || ''))) bits.push('查不到不等于 0');
    if (/当日复核/.test(r.locator || '')) bits.push('措施需在申报当日复核');
    return bits.join('；') || '使用前请核对适用范围与日期';
  }

  /* ================= 上手指南（原「数据说明」） ================= */
  function renderGuide() {
    var host = $('aboutBody');
    if (!host) return;
    var p = proj();
    var sub = subById(p.scenario.subcategoryId);
    var tierNow = serviceTier(p.scenario.market, sub);
    clear(host);

    var intro = h('div', { class: 'card' });
    intro.appendChild(h('h3', {}, '这个工作台帮你做什么'));
    intro.appendChild(h('p', { class: 'lead', style: 'font-size:14px' }, '把产品资料、目的地要求、税费测算、政策动态和你的判断记录放在同一条流程里，最后生成一份能追溯的出海准备报告。它帮助你组织资料和待办，不替代海关归类结论、认证机构、律师或税务顾问的专业意见。'));
    var flow = h('div', { class: 'guide-flow', role: 'list', 'aria-label': '使用流程' });
    var steps = [
      { k: '产品', t: '选品类与型号', d: '12 组 / 57 类；研究档案可带入品牌、型号、小类与地区' },
      { k: '目的地', t: '选国家或地区', d: '决定适用哪套规则；欧盟成员国继承欧盟框架' },
      { k: '关键事实', t: '只答影响判断的问题', d: '不确定就选不确定，相关结论保持待补' },
      { k: '合规初筛', t: '看四类结果与待办', d: '可能适用 / 待补事实 / 不适用 / 待规则核验' },
      { k: 'HS 与税费', t: '选候选并测算', d: '有画像的市场逐行出分项；缺条件时留空' },
      { k: '政策资料', t: '查法规与新闻', d: '资料库按国家、主题、产品、类型筛选' },
      { k: '千问建议', t: '按需生成分析', d: 'API 直连或手动粘贴，来源分别标注' },
      { k: '出海报告', t: '汇总与导出', d: '每条结论可回到来源与输入' }
    ];
    steps.forEach(function (st, i) {
      var c = document.createElement('div');
      c.className = 'gstep';
      c.setAttribute('role', 'listitem');
      c.innerHTML = '<span class="gstep-n">' + (i + 1) + '</span><div><b>' + st.t + '</b><span>' + st.d + '</span></div>';
      if (i < steps.length - 1) c.appendChild(Object.assign(document.createElement('i'), { className: 'gstep-arrow', 'aria-hidden': 'true' }));
      flow.appendChild(c);
    });
    intro.appendChild(flow);
    host.appendChild(intro);

    var cur = h('div', { class: 'card' });
    cur.appendChild(h('h3', {}, '你现在的位置'));
    cur.appendChild(h('p', { class: 'subhint' }, p.scenario.market && sub
      ? '当前项目：' + p.name + '｜' + sub.name + ' × ' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market) + '｜' + tierNow.def.label + '。' + tierNow.why
      : '还没有选完目的地与品类。完成第 1 步后，这里会显示当前能做到哪一步以及缺少什么。'));
    var missing = [];
    if (!p.scenario.market) missing.push('目的地');
    if (!p.scenario.subcategoryId) missing.push('产品品类');
    if (!p.scenario.placingOnMarketDate) missing.push('投放市场日期');
    if (p.scenario.market && sub && !p.hsChoice) missing.push('HS 候选（如该组合有候选）');
    cur.appendChild(h('p', { class: 'subhint' }, missing.length ? ('下一步建议补充：' + missing.join('、') + '。') : '关键输入已齐，可生成报告。'));
    var goBtn = h('button', { class: 'btn sm', type: 'button' }, '去第 1 步补齐');
    goBtn.onclick = function () { showTab('product'); };
    cur.appendChild(goBtn);
    host.appendChild(cur);

    var affect = h('div', { class: 'card' });
    affect.appendChild(h('h3', {}, '哪些资料会影响哪些结果'));
    affect.innerHTML += '<table class="t"><thead><tr><th>你提供的内容</th><th>影响什么</th><th>缺失时怎样</th></tr></thead><tbody>' +
      '<tr><td>产品品类与技术事实（功率、电压、电池、无线、材料等）</td><td>适用哪些合规规则、需要办什么、HS 候选方向</td><td>相关判断显示「待补事实」，不会按「否」处理</td></tr>' +
      '<tr><td>目的地与投放日期</td><td>加载哪套法规、按哪个版本判断</td><td>无法初筛，页面提示先完成登记</td></tr>' +
      '<tr><td>交易要素（货值、运保、币种、原产地、贸易术语、措施核查）</td><td>税基、税率、税额与已覆盖项目汇总</td><td>缺关键条件时分项留空，不按 0 计</td></tr>' +
      '<tr><td>勾选的政策新闻与研究档案</td><td>千问任务的证据范围、报告内容</td><td>不勾选则不进入任务；旧建议按输入指纹标记需重新分析</td></tr></tbody></table>';
    affect.appendChild(h('p', { class: 'subhint', style: 'margin-top:8px' }, '政策资料如何回到结论：合规规则、税种公式和 HS 候选都带来源编号，点击可跳到政策资料库或官方来源；资料库里的文件类型（官方法规 PDF / 网页阅读版 / 核验记录 / 产品说明书）标明它能证明什么。'));
    host.appendChild(affect);

    var map = h('div', { class: 'card' });
    map.appendChild(h('h3', {}, langKey() === 1 ? 'Capability map (M / L)' : '能力与等级图谱'));
    map.appendChild(h('p', { class: 'subhint' }, langKey() === 1
      ? 'M answers “what evidence do we have for this product”; L answers “what can this product do in this market”. Both are computed from live data, not fixed per product.'
      : 'M 回答「这款产品有哪些资料可以查」；L 回答「这款产品出口到该市场能用哪些功能」。两者都由实际数据计算，不针对具体产品固定。'));
    map.appendChild(renderCapabilityMap());
    host.appendChild(map);

    var limits = h('div', { class: 'card' });
    limits.appendChild(h('h3', {}, langKey() === 1 ? 'Reading the numbers' : '看结果时要注意'));
    limits.innerHTML += '<ul class="guide-list">' +
      (langKey() === 1
        ? '<li>The subtotal is the sum of statutory items covered by this model, not the full landed cost.</li>' +
          '<li>HS entries are candidate directions; the final code depends on the destination tariff and case facts.</li>' +
          '<li>Official news is not evidence that a regulation is already in force.</li>' +
          '<li>Unknown conditions are never treated as zero; partial results stay visible, the total stays empty.</li>'
        : '<li>汇总口径是「本模型已覆盖法定项目汇总」，不等于全部到岸成本；检测、标签、渠道等费用需自行分摊。</li>' +
          '<li>HS 是候选方向，最终归类以目的国税则与个案事实为准。</li>' +
          '<li>官方新闻不等于法规已生效。</li>' +
          '<li>条件不足时未知项不按 0 计：可靠分项继续显示，完整总额保持为空。</li>') +
      '</ul>';
    host.appendChild(limits);

    var refs = h('div', { class: 'card' });
    refs.appendChild(h('h3', {}, langKey() === 1 ? 'Reference material' : '资料查询'));
    var links2 = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });
    [['research/index.html', '产品研究档案', 'Product research files'],
    ['policy-documents/index.html', '政策资料库', 'Policy Library'],
    ['tax-matrix/index.html', '税费覆盖矩阵', 'Duty & Tax Coverage Matrix']].forEach(function (l) {
      links2.appendChild(h('a', { class: 'btn sec sm', href: l[0], target: '_blank', rel: 'noopener noreferrer' }, (langKey() === 1 ? l[2] : l[1]) + ' ↗'));
    });
    refs.appendChild(links2);
    host.appendChild(refs);
  }

  /* ================= 能力等级图谱（M/L，按实际数据生成） ================= */
  var mapCache = null;
  var mapOpen = {};
  function capabilityIndex() {
    if (!mapCache) mapCache = window.VOCapability.levelIndex(D, E, { date: '2026-11-08' });
    return mapCache;
  }
  function renderCapabilityMap() {
    var wrap = h('div', {});
    var idx = capabilityIndex();
    var en = langKey() === 1;
    var grid = h('div', { class: 'lvl-grid' });

    [['M1', en ? 'Basic product data: category and key features' : '基础产品资料：可查类别与关键特征', 'mGroups'],
    ['M2', en ? 'Multi-model parameters from official pages' : '多型号参数：可查看多个型号的官方参数', 'mGroups'],
    ['M3', en ? 'Manual-verified evidence for multiple models' : '说明书核验：多型号参数加说明书证据', 'mGroups']].forEach(function (row) {
      var code = row[0];
      var ids = idx.mGroups[code] || [];
      grid.appendChild(levelCard('M', code, row[1], ids, function (id) {
        var s = subById(id);
        return s ? (en ? (s.nameEn || s.name) : s.name) : id;
      }, function (id) {
        selectedGroup = (subById(id) || {}).group || selectedGroup;
        var p = proj(); p.scenario.subcategoryId = id; touch(); showTab('product');
      }));
    });

    var marketSel = h('select', { class: 'sel', id: 'mapMarket', 'aria-label': en ? 'Filter L combinations by market' : '按市场筛选 L 等级组合' });
    var markets = (D.jurisdictions || []).map(function (j) { return j.code; });
    var withRows = {};
    idx.rows.forEach(function (r) { withRows[r.market] = (withRows[r.market] || 0) + 1; });
    var mkOptions = markets.filter(function (m) { return withRows[m]; });
    mkOptions = ['SG'].concat(mkOptions.filter(function (m) { return m !== 'SG'; }));
    mkOptions.forEach(function (m) { marketSel.appendChild(h('option', { value: m }, (JUR[m] ? JUR[m].name : m) + '（' + withRows[m] + '）')); });
    marketSel.value = mapOpen.market || 'SG';
    marketSel.onchange = function () { mapOpen.market = marketSel.value; refreshTabHost(); };

    [['L1', en ? 'Look up regulations and official sources' : '查法规：查询法规与官方来源', 'L1'],
    ['L2', en ? 'Run compliance screening and build a checklist' : '做初筛：判断合规要求并生成准备清单', 'L2'],
    ['L3', en ? 'Calculate applicable duties and subtotals' : '算税费：测算适用税费并生成分项汇总', 'L3']].forEach(function (row) {
      var code = row[2];
      var list = idx.rows.filter(function (r) { return r.l === code && r.market === marketSel.value; });
      var all = idx.rows.filter(function (r) { return r.l === code; });
      grid.appendChild(levelCard('L', code, row[1], list.length ? list : all, function (r) {
        var s = subById(r.sub);
        var pn = s ? (en ? (s.nameEn || s.name) : s.name) : r.sub;
        return pn + ' × ' + (JUR[r.market] ? JUR[r.market].name : r.market);
      }, function (r) {
        var p = proj(); p.scenario.subcategoryId = r.sub; p.scenario.market = r.market; p.hsChoice = ''; touch();
        selectedGroup = (subById(r.sub) || {}).group || selectedGroup;
        showTab('product');
      }, en));
    });

    wrap.appendChild(marketSel);
    wrap.appendChild(grid);
    return wrap;
  }
  function levelCard(series, code, desc, items, labelOf, onPick, en) {
    var card = h('div', { class: 'lvl-card' });
    card.appendChild(h('h4', {}, code + ' · ' + (series === 'M' ? (en ? 'Product evidence' : '产品资料') : (en ? 'Market service' : '市场服务'))));
    card.appendChild(h('p', { class: 'lv-sub' }, desc));
    card.appendChild(h('p', { class: 'lv-num' }, (en ? 'Covers ' : '覆盖 ') + items.length + (series === 'M' ? (en ? ' subcategories' : ' 个小类') : (en ? ' combinations' : ' 个组合'))));
    var preview = h('div', { class: 'lvl-list' });
    items.slice(0, 3).forEach(function (it) {
      var b = h('button', { type: 'button' }, labelOf(it));
      b.onclick = function () { onPick(it); };
      preview.appendChild(b);
    });
    card.appendChild(preview);
    if (items.length > 3) {
      var key = series + code;
      var more = h('button', { class: 'lvl-more', type: 'button', 'aria-expanded': mapOpen[key] ? 'true' : 'false' });
      more.textContent = mapOpen[key] ? (en ? 'Collapse' : '收起') : (en ? 'View all (' + items.length + ')' : '查看全部（' + items.length + '）');
      more.onclick = function () { mapOpen[key] = !mapOpen[key]; refreshTabHost(); };
      card.appendChild(more);
      if (mapOpen[key]) {
        var full = h('div', { class: 'lvl-list' });
        items.forEach(function (it) {
          var b = h('button', { type: 'button' }, labelOf(it));
          b.onclick = function () { onPick(it); };
          full.appendChild(b);
        });
        card.appendChild(full);
      }
    }
    return card;
  }
  /** 局部重绘当前视图（等级图谱展开/筛选时避免整页跳回顶部） */
  function refreshTabHost() {
    var y = window.scrollY;
    renderTab(currentTab);
    window.scrollTo(0, y);
  }

  /* ================= 数据说明（保留给追溯明细，入口已改为上手指南） ================= */
  function renderAbout() {
    var host = $('aboutBody');
    clear(host);
    var c = h('div', { class: 'card' });
    c.appendChild(h('h3', {}, '数据来源与快照'));
    c.appendChild(h('p', { class: 'subhint' }, '整合构建：' + D.meta.builtAt + '；原始数据快照：' + D.meta.dataAsOf + '。'));
    D.meta.dataSources.forEach(function (s) { c.appendChild(h('p', { style: 'margin:4px 0;font-size:13.5px' }, '· ' + s)); });
    c.appendChild(h('p', { class: 'subhint' }, '范围：' + D.meta.scope));
    host.appendChild(c);

    var n = h('div', { class: 'card' });
    n.appendChild(h('h3', {}, '数据规模与覆盖等级'));
    n.appendChild(h('div', { class: 'legend' },
      h('span', { class: 'tag brand' }, '法规索引 ' + D.regulations.length),
      h('span', { class: 'tag brand' }, '来源记录 ' + D.sources.length),
      h('span', { class: 'tag brand' }, '条件规则 ' + D.rules.length),
      h('span', { class: 'tag brand' }, '产品小类 ' + D.subcategories.length),
      h('span', { class: 'tag brand' }, '动态映射 ' + D.dynamicMap.length),
      h('span', { class: 'tag brand' }, '行动 ' + D.actions.length),
      h('span', { class: 'tag brand' }, '材料 ' + D.materials.length),
      h('span', { class: 'tag brand' }, 'HS 候选 ' + D.hsCandidates.length),
      h('span', { class: 'tag brand' }, '税费规则 ' + D.taxProfiles.length)));
    Object.keys(D.meta.levels).forEach(function (k) {
      n.appendChild(h('p', { style: 'margin:4px 0;font-size:13.5px' }, h('span', { class: 'tag brand' }, k), ' ' + D.meta.levels[k]));
    });
    host.appendChild(n);

    var g = h('div', { class: 'card' });
    g.appendChild(h('h3', {}, '未完成事项与缺口'));
    g.appendChild(h('p', { class: 'subhint' }, D.gapsSummary.note));
    var glist = h('table', { class: 't' });
    glist.appendChild(h('thead', {}, h('tr', {}, h('th', {}, '审计项'), h('th', {}, '严重度'), h('th', {}, '发现'), h('th', {}, '处理方向'))));
    var gb = h('tbody', {});
    D.hsTaxAudit.forEach(function (a) {
      gb.appendChild(h('tr', {}, h('td', {}, a.id), h('td', {}, h('span', { class: 'tag ' + (a.severity === 'critical' ? 'bad' : 'warn') }, a.severity)), h('td', {}, a.finding), h('td', {}, a.resolution)));
    });
    glist.appendChild(gb);
    g.appendChild(h('div', { class: 'tbl-wrap' }, glist));
    g.appendChild(h('p', { class: 'subhint' }, '覆盖矩阵缺口合计 ' + D.gapsSummary.total + ' 条（法域 × 主题空白、成员国实施缺口与来源访问问题的合计）。'));
    host.appendChild(g);

    var nw = h('div', { class: 'card' });
    nw.appendChild(h('h3', {}, '新闻更新机制与千问 API 边界'));
    nw.appendChild(h('p', { class: 'subhint' }, 'GitHub Actions 定时采集（北京时间约 09:17 / 17:17，可手动运行）→ 合并去重 → 输出快照与来源状态 → 自动重新发布。定时快照，不是实时监控；来源为政府官方公告，不含全网舆情监测。'));
    nw.appendChild(h('p', { class: 'subhint' }, '千问 API 直连为可选功能：由用户自带阿里云百炼 API Key，密钥仅存本机浏览器；真实计费调用效果以用户自检为准。'));
    host.appendChild(nw);

    var d = h('div', { class: 'card' });
    d.appendChild(h('h3', {}, '免责声明'));
    d.appendChild(h('p', { class: 'subhint' }, '本工具用于初步合规辅助和资料组织。任何材料勾选、规则匹配、HS 候选或税费结果都不自动构成正式合规、认证、法律、税务、原产资格或海关归类结论。关键事实不完整时，系统显示已知分项与明确缺口，完整结论保持为空。'));
    host.appendChild(d);
  }
  $('lnkAbout').addEventListener('click', function () { showTab('about'); });
  $('btnBackAbout').addEventListener('click', function () { showTab(lastFlowTab); });

  /* ================= 项目管理 ================= */
  function refreshProjSelect() {
    var sel = $('projSelect');
    clear(sel);
    state.projects.forEach(function (p) {
      sel.appendChild(h('option', { value: p.id }, p.name + (p.scenario.market ? '（' + (JUR[p.scenario.market] ? JUR[p.scenario.market].name : p.scenario.market) + '）' : '')));
    });
    sel.value = state.currentId;
  }
  $('projSelect').addEventListener('change', function () {
    state.currentId = $('projSelect').value;
    selectedGroup = '';
    persist(false);
    showTab(currentTab === 'about' ? 'product' : currentTab);
    toast('已切换项目：' + proj().name, 'ok');
  });
  $('btnNewProj').addEventListener('click', function () {
    var name = window.prompt('新项目名称：', '新项目');
    if (name === null) return;
    var p = defaultProject(name.trim() || '新项目');
    state.projects.unshift(p);
    state.currentId = p.id;
    selectedGroup = '';
    persist(false);
    refreshProjSelect();
    showTab('product');
    toast('已创建项目：' + p.name, 'ok');
  });
  $('btnRenameProj').addEventListener('click', function () {
    var name = window.prompt('重命名项目：', proj().name);
    if (name === null) return;
    proj().name = name.trim() || proj().name;
    touch(); refreshProjSelect(); updateDots();
  });
  $('btnDelProj').addEventListener('click', function () {
    if (state.projects.length <= 1) { toast('至少保留一个项目', 'err'); return; }
    if (!window.confirm('确定删除项目「' + proj().name + '」？本机数据将被移除。')) return;
    var id = proj().id;
    state.projects = state.projects.filter(function (p) { return p.id !== id; });
    state.currentId = state.projects[0].id;
    selectedGroup = '';
    persist(false);
    refreshProjSelect();
    showTab('product');
    toast('项目已从本机存储删除', 'ok');
  });

  /* ================= 启动 ================= */
  document.querySelectorAll('#sideNav .nav-item').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  /* ================= 界面语言（中英双语） ================= */
  function syncLangButtons() {
    var en = window.VOI18N && window.VOI18N.get() === 'en';
    [['langZh', !en], ['langEn', !!en]].forEach(function (pair) {
      var b = $(pair[0]);
      if (b) { b.classList.toggle('on', pair[1]); b.setAttribute('aria-pressed', pair[1] ? 'true' : 'false'); }
    });
  }
  function setLang(next) {
    if (!window.VOI18N) return;
    window.VOI18N.set(next);
    syncLangButtons();
    // 重新渲染当前视图：业务数据与计算结果不变，只换说明语言
    refreshProjSelect();
    renderTab(currentTab);
    updateDots();
    localize(document.querySelector('.topbar'));
    localize(document.querySelector('.sidebar'));
  }
  if (window.VOI18N) {
    window.VOI18N.init(window.VO_DATA);
    if (window.VOI18N.get() === 'en') { localize(document.body); setTimeout(function () { localize(document.body); }, 0); }
  }
  ['langZh', 'langEn'].forEach(function (id) {
    var b = $(id);
    if (b) b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); });
  });
  syncLangButtons();

  loadState();
  var firstSub = subById(proj().scenario.subcategoryId);
  if (firstSub) selectedGroup = firstSub.group;
  refreshProjSelect();
  var startTab = new URLSearchParams(location.search).get('tab');
  showTab(['home','product','compliance','tax','news','qianwen','report','about'].indexOf(startTab) >= 0 ? startTab : 'home');
  persist(false);

  /* ================= R1 第二版：首页、雷达视图、研究档案带入 ================= */

  /* ---------- 首页入口 ---------- */
  var btnHomeStart = $('btnHomeStart');
  if (btnHomeStart) btnHomeStart.addEventListener('click', function () { showTab('product'); });
  var btnHomeExamples = $('btnHomeExamples');
  if (btnHomeExamples) btnHomeExamples.addEventListener('click', function () { showTab('product'); $('companyQuick').open = true; $('companyQuick').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  var btnHomeRadar = $('btnHomeRadar');
  if (btnHomeRadar) btnHomeRadar.addEventListener('click', function () { showTab('news'); });
  document.querySelectorAll('[data-goto]').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-goto')); });
  });

  /* ---------- 新闻页：地图雷达视图切换 ---------- */
  var radarShown = false;
  var btnRadarView = $('btnRadarView');
  if (btnRadarView) {
    btnRadarView.addEventListener('click', function () {
      radarShown = !radarShown;
      var wrap = $('radarFrameWrap');
      wrap.style.display = radarShown ? '' : 'none';
      btnRadarView.textContent = radarShown ? '切换回列表视图' : '切换地图雷达视图';
      $('newsBody').style.display = radarShown ? 'none' : '';
    });
  }

  /* ---------- 雷达子页 postMessage：加入当前项目 ----------
     安全三查：消息来自 iframe.contentWindow、事件来源同源、URL 确实在主站 NEWS.items 中。 */
  window.addEventListener('message', function (ev) {
    if (ev.origin !== window.location.origin) return;
    var frame = $('radarFrame');
    if (!frame || ev.source !== frame.contentWindow) return;
    var d = ev.data;
    if (!d || d.type !== 'radar-select' || typeof d.url !== 'string') return;
    if (!/^https?:\/\//i.test(d.url)) return;
    var hit = NEWS.items.find(function (it) { return it.url === d.url; });
    if (!hit) { toast('该新闻不在当前快照中，未加入', 'err'); return; }
    var id = newsId(hit);
    var p = proj();
    if (p.newsSelected.indexOf(id) < 0) {
      p.newsSelected.push(id);
      touch();
      toast('已加入当前项目：' + String(hit.title || '').slice(0, 40), 'ok');
      updateDots();
    } else {
      toast('该新闻已在项目中', 'ok');
    }
  });

  /* ---------- 研究档案带入（子页 postMessage 或 URL 参数回跳） ---------- */
  function applyResearchBringIn(d) {
    var p = proj();
    if (!d || !d.sub) { toast('研究档案数据不完整', 'err'); return; }
    // 重置当前情景：税费选择、相关事实（同小类换型号也走这条路径，由调用前确认保证）
    p.hsChoice = '';
    p.scenario.facts = {};
    p.scenario.factsUnknown = {};
    p.scenario.factNotes = {};
    p.scenario.subcategoryId = d.sub;
    p.companyName = d.brand || p.companyName;
    if (d.jurs && d.jurs.length && !p.scenario.market) p.scenario.market = d.jurs[0];
    p.researchEvidence = {
      modelId: d.modelId, brand: d.brand, name: d.name, region: d.region,
      catName: d.catName, sub: d.sub, jurs: d.jurs || [],
      evidence: d.evidence || '', hs: d.hs || '', missing: d.missing || '',
      interpret: d.interpret || '', checkedAt: d.checkedAt || '',
      sources: d.sources || [], specs: d.specs || [],
      broughtAt: new Date().toISOString(),
      note: '研究档案只载入品牌/型号/小类/地区；技术参数不自动代入（充电电压≠市电电压，吸力Pa≠功率W）；归类方向为研究候选，非海关结论。'
    };
    p.name = (d.brand || '研究') + ' ' + (d.name || '型号') + ' 项目';
    touch();
    refreshProjSelect();
    showTab('product');
    toast('已带入研究档案「' + (d.brand || '') + ' ' + (d.name || '') + '」：请逐项登记出口版技术事实', 'ok');
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== window.location.origin) return;
    var d = ev.data;
    if (!d || d.type !== 'research-bring-in') return;
    applyResearchBringIn(d);
  });
  // 子页独立打开（无 iframe 父页）时的回跳通道
  if (window.location.search.indexOf('bring=research') >= 0) {
    try {
      var raw = localStorage.getItem('vo-r1-research-bring');
      if (raw) {
        localStorage.removeItem('vo-r1-research-bring');
        applyResearchBringIn(JSON.parse(raw));
      }
    } catch (e) { }
    try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { }
  }

  /* ---------- 千问任务注入研究证据 ---------- */
  var _buildTaskTextBase = buildTaskText;
  buildTaskText = function () {
    var text = _buildTaskTextBase();
    var re = proj().researchEvidence;
    if (re) {
      var lines = [
        '',
        '## 附：产品研究档案证据',
        '- 型号：' + re.brand + ' ' + re.name + '（' + re.modelId + '）；结构类型：' + re.catName + '（' + re.sub + '）；证据地区：' + re.region + (re.jurs && re.jurs.length ? '（法域 ' + re.jurs.join('/') + '）' : ''),
        '- 地区证据：' + re.evidence,
        '- 研究解释：' + re.interpret,
        '- 候选归类方向（研究候选，非海关结论）：' + re.hs,
        '- 待补项：' + re.missing,
        '- 研究核验日：' + re.checkedAt,
        '- 注意：以上为研究档案，出口版技术参数须逐项重新登记，不得把研究参数当作申报参数。'
      ];
      var anchor = '## 三、明确不确定的事实';
      var idx = text.indexOf(anchor);
      if (idx < 0) idx = text.indexOf('## 二、已知产品/经营事实');
      text = idx >= 0 ? (text.slice(0, idx) + lines.join('\n') + '\n\n' + text.slice(idx)) : (text + '\n' + lines.join('\n'));
    }
    return text;
  };

  /* ---------- 报告注入研究证据 ---------- */
  var _renderReportBase = renderReport;
  renderReport = function () {
    _renderReportBase();
    var re = proj().researchEvidence;
    if (!re) return;
    var host = $('reportBody');
    if (!host) return;
    var s2 = host.querySelector('#repFactsCard');
    var card = document.createElement('div');
    card.className = 'card';
    var html = '<h3>1b. 产品研究档案（已带入型号证据）</h3>';
    html += '<p class="subhint">来源：研究档案页（核验 ' + re.checkedAt + '）；只载入了品牌/型号/小类/地区，技术参数需在第 1 步逐项登记。</p>';
    html += '<dl class="kv">';
    html += '<dt>型号</dt><dd>' + re.brand + ' ' + re.name + '（' + re.modelId + '）</dd>';
    html += '<dt>结构类型</dt><dd>' + re.catName + '（' + re.sub + '）</dd>';
    html += '<dt>证据地区</dt><dd>' + re.region + (re.jurs && re.jurs.length ? '（法域 ' + re.jurs.join('/') + '）' : '') + '</dd>';
    html += '<dt>地区证据</dt><dd>' + re.evidence + '</dd>';
    html += '<dt>候选归类方向</dt><dd>' + re.hs + '（研究候选，非海关确定结论）</dd>';
    html += '<dt>待补项</dt><dd>' + re.missing + '</dd>';
    html += '</dl>';
    html += '<div class="src-list" style="font-size:12px;color:var(--muted);display:grid;gap:3px">' + (re.sources || []).map(function (s) {
      return '<a href="' + String(s.url).replace(/[\"<>&']/g, '') + '" target="_blank" rel="noopener noreferrer">' + String(s.title || s.url).replace(/[<>&]/g, '') + ' ↗</a>';
    }).join('') + '</div>';
    card.innerHTML = html;
    if (s2 && s2.nextSibling) host.insertBefore(card, s2.nextSibling);
    else host.appendChild(card);
  };

  /* 测试钩子：仅暴露当前项目读写与 API 构造，不含敏感信息 */
  window.__VO_TEST__ = {
    current: function () { return proj(); },
    mutate: function (fn) { fn(proj()); touch(); },
    reloadAll: function () { loadState(); refreshProjSelect(); showTab(currentTab); },
    apiSettings: function () { return state.settings; },
    setApiSettings: function (patch) { Object.assign(state.settings, patch || {}); persist(false); },
    buildApiRequest: buildApiRequest,
    parseApiResponse: parseApiResponse,
    saveQianwenResponse: saveQianwenResponse
  };
})();
