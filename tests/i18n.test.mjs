/**
 * 中英双语检查
 * 运行：node tests/i18n.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const catalog = JSON.parse(readFileSync(join(ROOT, 'data/i18n-en.json'), 'utf8'));
const D = require(join(ROOT, 'data/vo-data.json'));
const entries = catalog.entries || {};
const keys = Object.keys(entries);
const appSrc = readFileSync(join(ROOT, 'js/app.js'), 'utf8');

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else { fail++; problems.push(name + (detail ? ' → ' + String(detail).slice(0, 220) : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('== 1. 词条与术语 ==');
check('词条数量 ≥ 250', keys.length >= 250, keys.length);
check('词条值非空', keys.every((k) => typeof entries[k] === 'string' && entries[k].trim().length > 0));
check('没有把中文原样当作英文词条', keys.filter((k) => entries[k] === k && /[\u4e00-\u9fff]/.test(k)).length === 0);
const joined = keys.map((k) => entries[k]).join(' | ');
['HS Code', 'Customs Value', 'Import Duty', 'Goods and Services Tax', 'Incoterms', 'Country of Origin',
  'Trade Remedies', 'Compliance Screening', 'Preferential'].forEach((term) => check('术语覆盖：' + term, joined.includes(term), term));

console.log('== 2. 数据层英文名覆盖 ==');
check('全部产品小类有 nameEn', D.subcategories.every((s) => !!s.nameEn), D.subcategories.filter((s) => !s.nameEn).map((s) => s.id).join(','));
check('全部字段有 nameEn', D.fields.every((f) => !!f.nameEn), D.fields.filter((f) => !f.nameEn).length + ' 个');
check('全部产品组有 nameEn', D.groups.every((g) => !!g.nameEn));
check('全部产品大类有 nameEn', D.categories.every((c) => !!c.nameEn));
const jurMissing = D.jurisdictions.filter((j) => !j.nameEn && !entries[j.name]);
check('法域名称都有英文（数据或词条）', jurMissing.length === 0, jurMissing.map((j) => j.code + ':' + j.name).join(','));

console.log('== 3. 界面切换与业务结果不变 ==');
const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'), {
  url: 'https://vision-overseas.test/index.html', runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;
const { document } = window;
window.scrollTo = () => {};
if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:mock';
for (const s of ['data/vo-data.js', 'data/news.js', 'data/i18n-en.js', 'policy-documents/manifest.js',
  'js/engine.js', 'js/capability.js', 'js/i18n.js', 'js/app.js']) {
  window.eval(readFileSync(join(ROOT, s), 'utf8'));
}
await wait(80);
check('默认中文', window.VOI18N.get() === 'zh');
check('顶部有中英切换按钮', !!document.getElementById('langZh') && !!document.getElementById('langEn'));
check('html lang 初始 zh-CN', document.documentElement.getAttribute('lang') === 'zh-CN');

window.__VO_TEST__.mutate((p) => {
  p.scenario.market = 'SG';
  p.scenario.subcategoryId = 'C-VAC-002';
  p.scenario.placingOnMarketDate = '2026-11-08';
  p.scenario.facts = { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, motor_power_w: 500, dust_receptacle_l: 0.8, charger_included: true };
  p.hsChoice = 'HS-SG-C-VAC-002-850811';
  p.tax = Object.assign(p.tax, { goodsValue: '10000', freight: '800', insurance: '100', origin: 'CN', importDate: '2026-11-08', currency: 'SGD', incoterm: 'FOB', priceBasis: 'FOB', importRoute: 'bulk', specialValuation: 'no', remedyCheck: 'confirmed_clear', hsReviewed: true });
});
const capZh = window.VOCapability.evaluate(D, window.VOEngine, {
  market: 'SG', subcategoryId: 'C-VAC-002', facts: window.__VO_TEST__.current().scenario.facts,
  placingOnMarketDate: '2026-11-08', hsChoice: window.__VO_TEST__.current().hsChoice, tax: window.__VO_TEST__.current().tax
});

[...document.querySelectorAll('#sideNav .nav-item')].find((b) => b.getAttribute('data-tab') === 'product').click();
await wait(140);
document.getElementById('langEn').click();
await wait(140);
check('切换后 html lang 为 en', document.documentElement.getAttribute('lang') === 'en');
check('语言选择写入本机', window.localStorage.getItem('vo-lang') === 'en');
check('导航标签已英文', /Product & Market|Compliance Screening/.test(document.getElementById('sideNav').textContent),
  document.getElementById('sideNav').textContent.trim().slice(0, 90));
check('功能状态标签已英文', /Regulation lookup|HS candidates|Export report/.test(document.getElementById('projectStatus').textContent),
  document.getElementById('projectStatus').textContent.slice(0, 120));
(document.querySelector('#projectStatus .ps-tag') || { click: () => {} }).click();
await wait(120);
check('缺口面板显示英文说明', /Why:|available with|What is needed|Next action/i.test((document.querySelector('#projectStatus .ps-panel') || { textContent: '' }).textContent),
  (document.querySelector('#projectStatus .ps-panel') || { textContent: '' }).textContent.slice(0, 90));

const capEn = window.VOCapability.evaluate(D, window.VOEngine, {
  market: 'SG', subcategoryId: 'C-VAC-002', facts: window.__VO_TEST__.current().scenario.facts,
  placingOnMarketDate: '2026-11-08', hsChoice: window.__VO_TEST__.current().hsChoice, tax: window.__VO_TEST__.current().tax
});
check('切换语言不改变能力状态与缺口', JSON.stringify(capZh.features.map((f) => [f.key, f.state, f.reason])) === JSON.stringify(capEn.features.map((f) => [f.key, f.state, f.reason])));
check('切换语言不改变项目数据', window.__VO_TEST__.current().hsChoice === 'HS-SG-C-VAC-002-850811' && window.__VO_TEST__.current().scenario.market === 'SG');
const taxEn = window.VOEngine.calculateTaxes(D, window.VOCapability.buildTaxInput(D, {
  market: 'SG', tax: window.__VO_TEST__.current().tax, hsChoice: window.__VO_TEST__.current().hsChoice
}, { legacy: 'vacuum' }));
check('英文界面下税额数值仍为 981.9', Number(taxEn.known_statutory_subtotal) === 981.9, taxEn.known_statutory_subtotal);

document.getElementById('langZh').click();
await wait(140);
check('切回中文后界面恢复中文', /合规初筛|产品市场/.test(document.getElementById('sideNav').textContent), document.getElementById('sideNav').textContent.trim().slice(0, 60));

console.log('== 4. 子页接入与业务层无语言分支 ==');
['policy-documents/index.html', 'research/index.html', 'modules/radar.html', 'tax-matrix/index.html'].forEach((f) => {
  const s = readFileSync(join(ROOT, f), 'utf8');
  check('子页接入双语层：' + f, s.includes('js/i18n.js') && s.includes('data/i18n-en.js'));
});
check('计算引擎不含语言分支', !/VOI18N|langKey|=== 'en'/.test(readFileSync(join(ROOT, 'js/engine.js'), 'utf8')));
check('能力层不含语言分支', !/VOI18N|langKey/.test(readFileSync(join(ROOT, 'js/capability.js'), 'utf8')));
const enPrompt = (appSrc.match(/API_SYSTEM_PROMPT_EN = '([^']+)'/) || [])[1] || '';
check('英文系统提示词保留证据与不按零处理约束', /never assume/i.test(enPrompt) && /trade remedies/i.test(enPrompt) && /zero/i.test(enPrompt), enPrompt.slice(0, 90));
check('中文系统提示词仍要求中文作答', /使用中文/.test((appSrc.match(/API_SYSTEM_PROMPT = '([^']+)'/) || [])[1] || ''));

console.log(`\n===== 双语检查：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (problems.length) { console.log('失败：'); problems.slice(0, 20).forEach((p) => console.log('  ✗', p)); process.exit(1); }
console.log('全部通过 ✔');
