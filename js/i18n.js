/*! 远见·企业出海助手 —— 中英双语层
 *
 * 设计：
 *  - 业务数据与计算逻辑与语言无关；本层只负责把「语言无关的结构化结果」渲染成中文或英文；
 *  - 词条来源三处：data/i18n-en.json（界面与术语词条）、数据包自带的 nameEn 字段（产品小类与字段）、
 *    能力层的结构化代码（state/reason/owner 映射到词条）；
 *  - 未收录词条的长句（多为法规条目正文）保留原文并标注原文语言，不虚构官方英文版本；
 *  - 语言选择保存在本机（vo-lang），页面跳转与刷新后保持，且不影响项目数据与计算结果。
 */
(function (global) {
  'use strict';

  var LANG_KEY = 'vo-lang';
  var dict = (global.VO_I18N_EN && global.VO_I18N_EN.entries) || {};
  var nameMap = {};
  var sortedKeys = [];
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

  /** 用数据包里的 nameEn 建立「中文名 → 英文名」映射（产品小类、字段、法规主题等） */
  function buildNameMap(data) {
    if (data) {
      (data.subcategories || []).forEach(function (s) { if (s.nameEn) nameMap[s.name] = s.nameEn; });
      (data.fields || []).forEach(function (f) { if (f.nameEn && f.name) nameMap[f.name] = f.nameEn; });
      (data.groups || []).forEach(function (g) { if (g.nameEn && g.name) nameMap[g.name] = g.nameEn; });
      (data.categories || []).forEach(function (c) { if (c.nameEn && c.name) nameMap[c.name] = c.nameEn; });
      (data.jurisdictions || []).forEach(function (j) { if (j.nameEn && j.name) nameMap[j.name] = j.nameEn; });
    }
    sortedKeys = Object.keys(dict).concat(Object.keys(nameMap)).sort(function (a, b) { return b.length - a.length; });
  }

  function isChinese(s) { return /[\u4e00-\u9fff]/.test(s || ''); }

  /** 词条查询：先精确匹配，再按长短语逐级替换 */
  function lookup(text) {
    if (dict[text]) return dict[text];
    if (nameMap[text]) return nameMap[text];
    return null;
  }

  /** 前缀式标签：'适用产品：' + 值 —— 只翻译标签，保留数据值 */
  function prefixTranslate(text) {
    var best = null;
    for (var i = 0; i < sortedKeys.length; i++) {
      var k = sortedKeys[i];
      if (!/[：:]\s*$/.test(k)) continue;
      if (text.indexOf(k) !== 0) continue;
      if (!best || k.length > best.length) best = k;
    }
    if (!best) return null;
    var label = dict[best] || nameMap[best];
    if (!label) return null;
    return label + text.slice(best.length);
  }

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
    return out;
  }

  /** 参数化词条：t('tax.rate.label', {v: 9}) —— 词条内用 {v} 占位 */
  function t(key, params) {
    var s = (lang === 'en' ? (dict[key] || key) : key);
    if (params) Object.keys(params).forEach(function (k) { s = s.split('{' + k + '}').join(params[k]); });
    return s;
  }

  /** 单句翻译（供 JS 直接调用） */
  function tr(zh) {
    if (lang !== 'en' || !zh) return zh;
    var exact = lookup(String(zh).trim());
    if (exact) return exact;
    var out = phraseReplace(String(zh));
    return isChinese(out) ? zh : out;
  }

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1 };

  /** DOM 层翻译：只处理文本节点，保留原始中文以便切回；不改动数值与代码 */
  function apply(root) {
    root = root || global.document.body;
    if (!root || lang !== 'en') { restore(root); return; }
    var w = global.document.createTreeWalker(root, 4 /* SHOW_TEXT */, function (n) {
      var p = n.parentNode;
      return p && !SKIP[p.tagName] ? 1 : 2;
    }, false);
    var node, changes = 0;
    while ((node = w.nextNode())) {
      var raw = node.nodeValue;
      if (!isChinese(raw)) continue;
      if (node._voZh === undefined) node._voZh = raw;
      var base = node._voZh || raw;
      var out = lookup(base.trim());
      var keepValue = false;
      if (!out) {
        out = prefixTranslate(base.trim());
        keepValue = !!out;
      }
      if (!out) out = phraseReplace(base);
      // 只接受「整句英文」或「英文标签 + 原数据值」的结果；其余保留原文，避免中英混排
      if (out && out !== base && (keepValue || !isChinese(out))) { node.nodeValue = out; changes++; }
    }
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
    t: t, tr: tr, apply: apply, restore: restore, buildNameMap: buildNameMap,
    /** 英文模式下仍未收录中文长句的统计（用于如实说明覆盖范围） */
    coverage: function (root) {
      var w = global.document.createTreeWalker(root || global.document.body, 4, null, false);
      var node, total = 0, zh = 0;
      while ((node = w.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        total++;
        if (isChinese(node.nodeValue)) zh++;
      }
      return { textNodes: total, chineseNodes: zh };
    }
  };

  global.VOI18N = api;
})(typeof window !== 'undefined' ? window : globalThis);
