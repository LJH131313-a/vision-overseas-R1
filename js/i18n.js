/*! 远见·企业出海助手 —— 中英双语层
 *
 * 设计：
 *  - 业务数据与计算逻辑与语言无关；本层只负责把「语言无关的结构化结果」渲染成中文或英文；
 *  - 词条来源：data/i18n-en.json（界面与术语词条）+ 数据包自带的 nameEn/labelEn 字段
 *    + i18n-en.json 的 byId 段（规则/行动/材料/主题/新闻来源等业务数据的英文对照）；
 *  - 文本、下拉选项、输入值、placeholder/title/aria-label 全部覆盖；
 *  - 尾缀数字（如「德国（57）」→「Germany (57)」）与序号（①②③）自动迁移；
 *  - 未收录词条的长句保留原文，不虚构官方英文版本；
 *  - 语言选择保存在本机（vo-lang），页面跳转与刷新后保持，且不影响项目数据与计算结果。
 */
(function (global) {
  'use strict';

  var LANG_KEY = 'vo-lang';
  var dict = {};
  var byId = {};
  var nameMap = {};
  var sortedKeys = [];
  var labelSorted = [];
  var lang = 'zh';

  function readStored() {
    try {
      var q = new URLSearchParams(global.location.search).get('lang');
      if (q === 'en' || q === 'zh') return q;
      var v = global.localStorage && global.localStorage.getItem(LANG_KEY);
      return v === 'en' ? 'en' : 'zh';
    } catch (e) { return 'zh'; }
  }

  function store() {
    try { global.localStorage && global.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* 隐私模式下忽略 */ }
  }

  /** 用数据包里的 nameEn/labelEn 建立映射，并读入词条与按 ID 的业务对照 */
  function buildNameMap(data) {
    var pack = (global.VO_I18N_EN || {});
    dict = pack.entries || {};
    byId = pack.byId || {};
    nameMap = {};
    if (data) {
      (data.subcategories || []).forEach(function (s) { if (s.nameEn) nameMap[s.name] = s.nameEn; });
      (data.fields || []).forEach(function (f) { if (f.nameEn && f.name) nameMap[f.name] = f.nameEn; });
      (data.groups || []).forEach(function (g) { if (g.nameEn && g.name) nameMap[g.name] = g.nameEn; });
      (data.categories || []).forEach(function (c) { if (c.nameEn && c.name) nameMap[c.name] = c.nameEn; });
      (data.jurisdictions || []).forEach(function (j) { if (j.nameEn && j.name) nameMap[j.name] = j.nameEn; });
      (data.topics || []).forEach(function (tp) { var e = byId.topics && byId.topics[tp.id]; if (e) nameMap[tp.name] = e; });
      (data.actions || []).forEach(function (a) { var e = byId.actions && byId.actions[a.id]; if (e) nameMap[a.name] = e; });
      (data.materials || []).forEach(function (mt) { var e = byId.materials && byId.materials[mt.id]; if (e) nameMap[mt.name] = e; });
      (data.rules || []).forEach(function (r) { var e = byId.rules && byId.rules[r.id]; if (e) nameMap[r.name] = e; });
      // formOptions 的下拉标签
      var fo = data.formOptions || {};
      Object.keys(fo).forEach(function (k) {
        (fo[k] || []).forEach(function (o) { var e = byId.formOptions && byId.formOptions[k] && byId.formOptions[k][o.value]; if (e) nameMap[o.label] = e; });
      });
      // 新闻来源名称
      (data.sources || []).forEach(function (s) { var e = byId.sources && byId.sources[s.id]; if (e) nameMap[s.title] = e; });
    }
    // 新闻源 meta 里的名称与市场（按字面）
    (byId.literal || []).forEach(function (pair) { nameMap[pair[0]] = pair[1]; });
    sortedKeys = Object.keys(dict).concat(Object.keys(nameMap)).sort(function (a, b) { return b.length - a.length; });
    labelSorted = sortedKeys.filter(function (k) { return /[：:]\s*$/.test(k); })
      .concat(Object.keys(dict).filter(function (k) { return /[：:]\s*$/.test(k); }))
      .sort(function (a, b) { return b.length - a.length; });
  }

  function isChinese(s) { return /[\u4e00-\u9fff]/.test(s || ''); }

  /** 词条查询 */
  function lookup(text) {
    if (dict[text] !== undefined) return dict[text];
    if (nameMap[text]) return nameMap[text];
    return null;
  }

  var CIRCLED = { '①': '(1)', '②': '(2)', '③': '(3)', '④': '(4)', '⑤': '(5)', '⑥': '(6)', '⑦': '(7)', '⑧': '(8)', '↻': '⟳', '←': '←', '◈': '◈', '·': '·', '｜': ' | ', '→': '→' };

  /** 尾缀括号内数字/代号保留：'德国（57）' → 'Germany (57)'；'澳大利亚（AU）' → 'Australia (AU)' */
  function suffixTranslate(text) {
    var m = text.match(/^([\s\S]*?)[（(]([^（）()]*[\dA-Za-z_／/·][^（）()]*)[）)]$/);
    if (!m) return null;
    var head = m[1].trim();
    var tail = m[2];
    var headEn = lookup(head);
    if (!headEn) return null;
    return headEn + ' (' + tail + ')';
  }

  /** 前缀式标签：'适用产品：' + 值 —— 只翻译标签，保留数据值 */
  function prefixTranslate(text) {
    var best = null;
    for (var i = 0; i < labelSorted.length; i++) {
      var k = labelSorted[i];
      if (text.indexOf(k) !== 0) continue;
      if (!best || k.length > best.length) best = k;
    }
    if (!best) return null;
    var label = dict[best] || nameMap[best];
    if (!label) return null;
    return label + text.slice(best.length);
  }

  /** 模板式句：'查看全部（12）'、'N 个产品小类' 等带数字的动态文案 */
  function patternTranslate(text) {
    var m;
    // 「查看全部（N）」「第 a / b 页」类
    if ((m = text.match(/^查看全部（(\d+)）$/))) return 'View all (' + m[1] + ')';
    if ((m = text.match(/^(\d+) 个产品小类$/))) return m[1] + ' subcategories';
    if ((m = text.match(/^覆盖 (\d+) 个小类$/))) return 'Covers ' + m[1] + ' subcategories';
    if ((m = text.match(/^覆盖 (\d+) 个组合$/))) return 'Covers ' + m[1] + ' combinations';
    if ((m = text.match(/^已保存到本机 ([\d:]+)$/))) return 'Saved on this device ' + m[1];
    if ((m = text.match(/^快照状态：共 (\d+) 条$/))) return 'Snapshot: ' + m[1] + ' items';
    if ((m = text.match(/^新闻列表（(\d+) 条）$/))) return 'News list (' + m[1] + ' items)';
    if ((m = text.match(/^历史快照 (\d+) 份$/))) return m[1] + ' report snapshots';
    if ((m = text.match(/^成功 (\d+)$/))) return 'OK ' + m[1];
    if ((m = text.match(/^显示 (\d+) \/ (\d+) 款$/))) return 'Showing ' + m[1] + ' / ' + m[2] + ' models';
    if ((m = text.match(/^第 (\d+) \/ (\d+) 页 · (\d+) 条（近两年）$/))) return 'Page ' + m[1] + ' / ' + m[2] + ' · ' + m[3] + ' items (last 2 years)';
    if ((m = text.match(/^找到 (\d+) 份资料（库内 (\d+) 条记录，同一文件的不同来源已合并显示）$/))) return 'Found ' + m[1] + ' files (' + m[2] + ' records; same-file sources merged)';
    if ((m = text.match(/^(\d+) 组 \/ (\d+) 类；/))) return m[1] + ' groups / ' + m[2] + ' subcategories; ';
    if ((m = text.match(/^第 (\d+) \/ (\d+) 页$/))) return 'Page ' + m[1] + ' of ' + m[2];
    // 政策资料库技术字段
    if ((m = text.match(/^页数：([\d,]+)$/))) return 'Pages: ' + m[1];
    // 组合式：'规则提示（本地引擎，非千问分析）：X关注建议：BODY' 逐层拆解，避免枚举所有组合
    if ((m = text.match(/^规则提示（本地引擎，非千问分析）：([\s\S]+)$/))) {
      var inner = translateZh(m[1].trim());
      if (inner) return 'Rule hints (local engine, not AI analysis): ' + inner;
    }
    // 新闻卡：'X关注建议：BODY'（市场前缀 + 复用正文）
    if ((m = text.match(/^([\u4e00-\u9fff]{2,4})关注建议：([\s\S]+)$/))) {
      var mkEn = lookup(m[1]);
      var body = m[2].trim();
      var bodyEn = lookup(body) || lookup(body.replace(/。$/, '')) || null;
      if (mkEn && bodyEn) return mkEn + ': ' + bodyEn.replace(/\.$/, '') + '.';
    }
    if ((m = text.match(/^官方新闻不自动等于已生效法规；快照时间 ([\d: -]+)。$/))) {
      return 'Official news is not automatically an in-force regulation; snapshot ' + m[1] + '.';
    }
    if ((m = text.match(/^快照状态：共 (\d+) 条$/))) return 'Snapshot: ' + m[1] + ' items';
    if ((m = text.match(/^快照 · (\d+) 条；由 GitHub Actions 定时采集后重新发布$/))) return 'Snapshot · ' + m[1] + ' items; collected and republished on a schedule by GitHub Actions';
    if ((m = text.match(/^第 (\d+) \/ (\d+) 页 · (\d+) 条（近两年）$/))) return 'Page ' + m[1] + ' / ' + m[2] + ' · ' + m[3] + ' items (last 2 years)';
    if ((m = text.match(/^大小：([\d,]+) 字节$/))) return 'Size: ' + m[1] + ' bytes';
    if ((m = text.match(/^来源编号：(\S+)$/))) return 'Source ID: ' + m[1];
    if ((m = text.match(/^文件校验码（SHA-256）：([0-9a-fA-F]{64})$/))) return 'File checksum (SHA-256): ' + m[1];
    if ((m = text.match(/^与 (SRC[-\w]+) 内容相同（同一文件的不同来源地址）$/))) return 'Same content as ' + m[1] + ' (different source URL for the same file)';
    if ((m = text.match(/^(.{4,}?) 等 (\d+) 类$/))) {
      var segs = m[1].split('、');
      var done = segs.every(function (it) { var e = lookup(it.trim()); return e || !isChinese(it); });
      if (done) return segs.map(function (it) { return lookup(it.trim()) || it; }).join(', ') + ' — ' + m[2] + ' subcategories in total';
    }
    if ((m = text.match(/^项目：([\s\S]*?)｜生成时间：([\d: -]+)｜输入版本：([0-9a-f]+)｜数据快照：([\d-]+)$/))) {
      return 'Project: ' + (lookup(m[1]) || m[1]) + ' | Generated: ' + m[2] + ' | Input version: ' + m[3] + ' | Data snapshot: ' + m[4];
    }
    // 新闻元数据行：'发布：D｜来源：S｜市场：M｜快照：T'（可能首段已译）
    if ((m = text.match(/^(?:发布：|Published: )([\d-]+)[｜|]\s*(?:来源：|Sources?: )([\s\S]*?)[｜|]\s*(?:市场：|Market: )([\s\S]*?)(?:[｜|]\s*(?:快照：|Snapshot: )([\s\S]*))?$/))) {
      var srcEn = lookup(m[2]) || m[2];
      var mktEn = lookup(m[3]) || m[3];
      var out = 'Published: ' + m[1] + ' | Source: ' + srcEn + ' | Market: ' + mktEn;
      if (m[4]) out += ' | Snapshot: ' + m[4];
      if (!isChinese(srcEn) && !isChinese(mktEn)) return out;
    }
    // '政策动态｜最近更新：T（北京时间）' 已半译情形
    if ((m = text.match(/^Policy Updates \| Last updated: ([\d: -]+)（北京时间）$/))) return 'Policy Updates | Last updated: ' + m[1] + ' (Beijing time)';
    // 'Project: 示例项目｜生成时间：…' 报告头（值已英文，标签未译）
    if ((m = text.match(/^Project: ([\s\S]*?)｜生成时间：([\d: -]+)｜输入版本：(\w+)｜数据快照：([\d-]+)$/))) {
      return 'Project: ' + (lookup(m[1]) || m[1]) + ' | Generated: ' + m[2] + ' | Input version: ' + m[3] + ' | Data snapshot: ' + m[4];
    }
    // 'These inputs are still missing: 无需额外填写项' 类「英文标签 + 中文值」
    if ((m = text.match(/^([A-Za-z][\w ,:;''\"()&/-]{0,40}: )([\u4e00-\u9fff][\s\S]*)$/))) {
      var tailEn = lookup(m[2].trim()) || translateZh(m[2].trim());
      if (tailEn) return m[1] + tailEn;
    }
    // 'Suggested next inputs: 目的地、产品品类、投放市场日期。'
    if ((m = text.match(/^Suggested next inputs: ([\u4e00-\u9fff][\s\S]*)$/))) {
      var items = m[1].split(/[、,，]/).map(function (it) { return lookup(it.trim()) || it.trim(); });
      if (items.every(function (it) { return !isChinese(it); })) return 'Suggested next inputs: ' + items.join(', ');
    }
    // '小类 × 市场' 组合（小类名已译、市场未译，或反之）
    if ((m = text.match(/^([\s\S]*?) × ([\u4e00-\u9fff][\s\S]*)$/))) {
      var mkt = lookup(m[2].trim());
      if (mkt) return m[1] + ' × ' + mkt;
    }
    // ①②③ 序号开头的节名：'① 项目与目的地'
    if (/^[①-⑧]/.test(text)) {
      var rest = text.slice(1).trim();
      var restEn = lookup(rest);
      if (restEn) return CIRCARED_MAP[text[0]] + restEn;
      var restOut = translateZh(rest);
      if (restOut) return CIRCARED_MAP[text[0]] + restOut;
    }
    return null;
  }
  var CIRCARED_MAP = { '①': '(1) ', '②': '(2) ', '③': '(3) ', '④': '(4) ', '⑤': '(5) ', '⑥': '(6) ', '⑦': '(7) ', '⑧': '(8) ' };
  /** 递归用：不进 pattern（避免死循环） */
  function translateZh(text) {
    var exact = lookup(text);
    if (exact) return exact;
    var mk = text.match(/^([\u4e00-\u9fff]{2,4})关注建议：([\s\S]+)$/);
    if (mk) {
      var mkEn = lookup(mk[1]);
      var body = mk[2].trim();
      var bodyEn = lookup(body) || lookup(body.replace(/。$/, ''));
      if (mkEn && bodyEn) return mkEn + ': ' + bodyEn.replace(/\.$/, '') + '.';
    }
    var suf = suffixTranslate(text);
    if (suf) return suf;
    var ph = phraseReplace(text);
    return (ph !== text && !isChinese(ph)) ? ph : null;
  }

  /** 逐词短语替换 */
  function phraseReplace(text) {
    var out = text;
    for (var i = 0; i < sortedKeys.length; i++) {
      var k = sortedKeys[i];
      if (k.length < 2 || out.indexOf(k) < 0) continue;
      var v = dict[k] || nameMap[k];
      if (!v) continue;
      out = out.split(k).join(v);
      if (!isChinese(out)) break;
    }
    // 序号替换
    out = out.replace(/[①②③④⑤⑥⑦⑧]/g, function (c) { return CIRCARED_MAP[c] || c; });
    return out;
  }

  /** 核心翻译：文本 → 英文；不可完整翻译时返回 null */
  function translate(text) {
    if (!isChinese(text)) return text;
    var t = String(text).replace(/\s+/g, ' ').trim();
    var exact = lookup(t);
    if (exact) return exact;
    // 尾带 ↗ 的链接文本：剥标记再查
    var arrow = t.match(/^([\s\S]*?)\s*↗$/);
    if (arrow) {
      var inner = lookup(arrow[1]) || patternTranslate(arrow[1]);
      if (inner && !isChinese(inner)) return inner + ' ↗';
    }
    var pat = patternTranslate(t);
    if (pat !== null) return pat;
    var suf = suffixTranslate(t);
    if (suf) return suf;
    var pre = prefixTranslate(t);
    if (pre && !isChinese(pre)) return pre;
    var ph = phraseReplace(t);
    if (ph !== t && !isChinese(ph)) return ph;
    // 结果仍含中文时一律保留原文，不产出中英混排
    return null;
  }

  /** 参数化词条 */
  function t(key, params) {
    var s = (lang === 'en' ? (dict[key] || key) : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split('{' + k + '}').join(params[k]); });
    return s;
  }

  /** 单句翻译（供 JS 直接调用） */
  function tr(zh) {
    if (lang !== 'en' || !zh) return zh;
    var out = translate(String(zh));
    return out === null ? zh : out;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };

  /** DOM 层翻译：文本节点 + 选项 + 输入值 + 属性 */
  function apply(root) {
    root = root || global.document.body;
    if (!root || lang !== 'en') { restore(root); return 0; }
    var changes = 0;

    // 0) 文档标题与描述（浏览器标签页与搜索结果可见）
    try {
      if (global.document.title && isChinese(global.document.title)) {
        if (global.document._voTitle === undefined) global.document._voTitle = global.document.title;
        var tt = translate(global.document._voTitle);
        if (tt !== null) global.document.title = tt;
      }
      var metas = global.document.querySelectorAll('meta[name="description"], meta[property="og:title"], meta[property="og:description"]');
      metas.forEach(function (me) {
        var v = me.getAttribute('content');
        if (!v || !isChinese(v)) return;
        if (me._voZhContent === undefined) me._voZhContent = v;
        var o = translate(me._voZhContent);
        if (o !== null) me.setAttribute('content', o);
      });
    } catch (e) { /* 无权限或非 HTML 环境时忽略 */ }

    // 1) 文本节点
    var w = global.document.createTreeWalker(root, 4 /* SHOW_TEXT */, function (n) {
      var p = n.parentNode;
      if (!p) return 2;
      if (SKIP[p.tagName]) return 2;
      if (p.tagName === 'OPTION') return 2; // 选项单独处理
      return 1;
    }, false);
    var node;
    while ((node = w.nextNode())) {
      var raw = node.nodeValue;
      if (!isChinese(raw)) continue;
      if (node._voZh === undefined) node._voZh = raw;
      var base = node._voZh || raw;
      var out = translate(base.replace(/\s+/g, ' ').trim());
      if (out !== null) {
        var styled = base.replace(/^\s+|\s+$/g, '');
        var lead = base.match(/^\s*/)[0], trail = base.match(/\s*$/)[0];
        node.nodeValue = lead + out + trail;
        changes++;
      }
    }

    // 2) 下拉选项（option 文本）
    (root.querySelectorAll ? root.querySelectorAll('option') : []).forEach(function (op) {
      var v = op.textContent;
      if (!isChinese(v)) return;
      if (op._voZh === undefined) op._voZh = v;
      var o = translate(op._voZh.trim());
      if (o !== null) { op.textContent = o; changes++; }
    });

    // 3) 输入值（text/search input 的可见值；不改 select 值本身）
    (root.querySelectorAll ? root.querySelectorAll('input[type=text], input[type=search], input:not([type])') : []).forEach(function (inp) {
      var v = inp.value;
      if (!isChinese(v)) return;
      if (inp._voZh === undefined) inp._voZh = v;
      var o = translate(v.trim());
      if (o !== null) { inp.value = o; changes++; }
    });

    // 4) 属性：placeholder / title / aria-label / alt
    (root.querySelectorAll ? root.querySelectorAll('[placeholder],[title],[aria-label],[alt]') : []).forEach(function (el) {
      ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (a) {
        var v = el.getAttribute && el.getAttribute(a);
        if (!v || !isChinese(v)) return;
        var key = '_voZhAttr_' + a;
        if (el[key] === undefined) el[key] = v;
        var o = translate(el[key].trim());
        if (o !== null && el.setAttribute) { el.setAttribute(a, o); changes++; }
      });
    });

    return changes;
  }

  function restore(root) {
    root = root || global.document.body;
    if (!root) return 0;
    var w = global.document.createTreeWalker(root, 4, null, false);
    var node, n = 0;
    while ((node = w.nextNode())) {
      if (node._voZh !== undefined && node.nodeValue !== node._voZh) { node.nodeValue = node._voZh; n++; }
    }
    (root.querySelectorAll ? root.querySelectorAll('option,input,[placeholder],[title],[aria-label]') : []).forEach(function (el) {
      if (el._voZh !== undefined && el.tagName === 'OPTION' && el.textContent !== el._voZh) { el.textContent = el._voZh; n++; }
      if (el._voZh !== undefined && el.tagName === 'INPUT' && el.value !== el._voZh) { el.value = el._voZh; n++; }
      ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (a) {
        var key = '_voZhAttr_' + a;
        if (el[key] !== undefined && el.getAttribute && el.getAttribute(a) !== el[key]) { el.setAttribute(a, el[key]); n++; }
      });
    });
    return n;
  }

  function setHtmlLang() {
    try { global.document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN'); } catch (e) { /* noop */ }
  }

  function set(next) {
    lang = next === 'en' ? 'en' : 'zh';
    store();
    setHtmlLang();
    return lang;
  }

  function toggle() { return set(lang === 'en' ? 'zh' : 'en'); }

  var api = {
    init: function (data) { lang = readStored(); buildNameMap(data); setHtmlLang(); return lang; },
    set: set, toggle: toggle, get: function () { return lang; }, isEn: function () { return lang === 'en'; },
    t: t, tr: tr, apply: apply, restore: restore, buildNameMap: buildNameMap, translate: function (s) { return translate(String(s)); },
    coverage: function (root) {
      var w = global.document.createTreeWalker(root || global.document.body, 4, null, false);
      var node, total = 0, zh = 0;
      while ((node = w.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        total++;
        if (isChinese(node.nodeValue)) zh++;
      }
      var opts = (root || global.document.body).querySelectorAll ? (root || global.document.body).querySelectorAll('option') : [];
      var optZh = 0, optTotal = 0;
      opts.forEach(function (o) { optTotal++; if (isChinese(o.textContent)) optZh++; });
      return { textNodes: total, chineseNodes: zh, options: optTotal, chineseOptions: optZh };
    }
  };

  global.VOI18N = api;
})(typeof window !== 'undefined' ? window : globalThis);
