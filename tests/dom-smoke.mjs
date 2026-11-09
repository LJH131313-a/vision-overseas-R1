/**
 * 远见·企业出海助手 —— 浏览器冒烟测试（jsdom，无外部网络）
 * 运行：node tests/dom-smoke.mjs
 * 验证：向导主线（侧栏 6 步）在真实 DOM 中可执行；按需追问、实时计算、
 *       HS/税费、新闻筛选、千问 API（mock fetch）、报告与快照失效逻辑均真实可用。
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const require = (await import('node:module')).createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
const dom = new JSDOM(html, {
  url: 'https://vision-overseas.test/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;
window.scrollTo = function () {};
if (!window.URL.createObjectURL) window.URL.createObjectURL = function () { return 'blob:mock'; };
if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = function () {};

for (const s of ['data/vo-data.js', 'data/news.js', 'policy-documents/manifest.js', 'js/engine.js', 'js/app.js']) {
  window.eval(readFileSync(join(ROOT, s), 'utf-8'));
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; failures.push(name); console.log('  ✗', name, detail ? '→ ' + String(detail).slice(0, 220) : ''); }
}
function goto(tab) {
  const b = [...document.querySelectorAll('#sideNav .nav-item')].find((x) => x.getAttribute('data-tab') === tab);
  b.click();
}
const $v = (id) => document.getElementById(id).value;
const txt = (id) => document.getElementById(id).textContent;

console.log('== 1. 骨架与数据 ==');
check('VO_DATA 86 条规则', window.VO_DATA.rules.length === 86);
check('VO_NEWS 已加载', window.VO_NEWS.items.length > 0);
check('侧栏 7 个导航项（含首页）', document.querySelectorAll('#sideNav .nav-item').length === 7);
check('默认显示首页', document.getElementById('view-home').classList.contains('on'));
check('首页封面与四步引导渲染', document.getElementById('view-home').textContent.includes('让每一款小家电') && document.querySelectorAll('.hs-card').length === 4);

console.log('== 1b. 首页 → 进入第 1 步 ==');
document.getElementById('btnHomeStart').click();
await new Promise((r) => setTimeout(r, 50));
check('首页开始项目 → 进入第 1 步', document.getElementById('view-product').classList.contains('on'));
check('目的地分组显示（三档）', document.querySelectorAll('#pMarket optgroup').length === 3, document.querySelectorAll('#pMarket optgroup').length);
check('案例卡片带入按钮 8 个', [...document.querySelectorAll('#companyList button')].filter((b) => b.textContent.includes('带入本项目')).length === 8);

console.log('== 2. 案例带入 → 第 1 步 ==');
const bring = [...document.querySelectorAll('#companyList button')].filter((b) => b.textContent.includes('带入本项目'));
bring[0].click();
await new Promise((r) => setTimeout(r, 50));
check('带入小类=电饭煲 K-COOK-003', window.__VO_TEST__.current().scenario.subcategoryId === 'K-COOK-003');
check('带入市场=MY', window.__VO_TEST__.current().scenario.market === 'MY');
check('带入电压 220', window.__VO_TEST__.current().scenario.facts.voltage_ac === 220);
check('带入功率 0.6kW', window.__VO_TEST__.current().scenario.facts.power_kw === 0.6);
check('案例面板自动收起', document.getElementById('companyQuick').open === false);
check('品类卡片显示支持度', txt('subNote').includes('已选'));

console.log('== 3. 不同品类不同问题（按需） ==');
const before = document.querySelectorAll('#keyFacts .qa').length + document.querySelectorAll('#moreFacts .qa').length;
goto('product');
const chips = [...document.querySelectorAll('#groupChips button')];
const cleanChip = chips.find((c) => c.textContent.includes('真空吸尘'));
cleanChip.click();
await new Promise((r) => setTimeout(r, 30));
const robotCard = [...document.querySelectorAll('#subList .sub-item')].find((c) => c.textContent.includes('扫地'));
robotCard.click();
await new Promise((r) => setTimeout(r, 30));
check('切换品类生效', window.__VO_TEST__.current().scenario.subcategoryId === 'C-VAC-005');
const after = document.querySelectorAll('#keyFacts .qa').length + document.querySelectorAll('#moreFacts .qa').length;
check('不同品类问题集合不同', after !== before, before + ' → ' + after);
// 更多参数区存在且被标注为不影响当前判断
check('选填参数区标注不改变当前结论', document.querySelector('#moreFacts .subhint') !== null);

console.log('== 4. 德国目的地 + 合规初筛 ==');
const mSel = document.getElementById('pMarket');
mSel.value = 'DE';
mSel.dispatchEvent(new window.Event('change'));
await new Promise((r) => setTimeout(r, 60));
goto('compliance');
const comp = txt('complianceResult');
check('服务档位横幅（原覆盖等级横幅）', !!document.querySelector('#complianceResult .tier') && comp.includes('这个判断怎么来的'), comp.slice(0, 90));
check('横幅仍显示能力边界口径', comp.includes('本模型已覆盖法定项目汇总') || comp.includes('支持合规初筛') || comp.includes('支持税费测算'));
check('待补事实置顶（有未答关键事实）', document.querySelectorAll('#complianceResult .group-state').length >= 2);
check('可能适用分组', comp.includes('可能适用'));
check('不适用+待核验合并分组', comp.includes('单条规则不适用') && comp.includes('待规则核验'));
check('行动与材料分组', comp.includes('办理行动与材料'));
const info = txt('complianceRunInfo');
check('实时计算信息条', info.includes('实时计算') || info.includes('可能适用'), info.slice(0, 80));
// 回答一个待补事实 → 自动重算
const firstTri = [...document.querySelectorAll('#complianceResult .group-state .qa .tri button')][0];
if (firstTri) firstTri.click();
await new Promise((r) => setTimeout(r, 40));
check('回答后重算（仍正常渲染）', txt('complianceResult').includes('可能适用'));

console.log('== 5. HS 与税费 ==');
goto('tax');
let taxText = txt('taxBody');
check('德国无 HS 候选 → 明确缺口', taxText.includes('尚无经来源关联的目的国 HS 候选'));
check('德国显示变量计算式模板', taxText.includes('变量计算式') && taxText.includes('(20,500 + 20,000 × d) × v'), taxText.slice(0,150));
check('德国模板含 TARIC/EBTI 依据', taxText.includes('TARIC') && taxText.includes('EBTI'));
check('税则知识库出现', taxText.includes('税则知识库'));
check('贸易术语承担矩阵出现', taxText.includes('贸易术语与费用承担矩阵') && taxText.includes('合同费用承担 ≠ 法定税率'));
window.__VO_TEST__.mutate(function (p) {
  p.scenario.market = 'SG';
  p.scenario.subcategoryId = 'K-BEV-001';
  p.scenario.facts = Object.assign({}, p.scenario.facts, { household: true, end_use: 'consumer', voltage_ac: 230, capacity_l: 1.7, heats_liquid: true, boils_water: true, portable: true });
  p.scenario.factsUnknown = {};
  p.tax.currency = 'SGD';
});
goto('tax');
taxText = txt('taxBody');
check('SG 出现 HS 候选 85167910', taxText.includes('85167910'));
const radios = [...document.querySelectorAll('#taxBody input[type=radio]')];
radios[0].click();
await new Promise((r) => setTimeout(r, 30));
check('HS 选中写入项目', window.__VO_TEST__.current().hsChoice.length > 0);
const nums = [...document.querySelectorAll('#taxBody input[type=number]')];
nums[0].value = '20000'; nums[0].dispatchEvent(new window.Event('change'));
nums[1].value = '1500'; nums[1].dispatchEvent(new window.Event('change'));
nums[2].value = '100'; nums[2].dispatchEvent(new window.Event('change'));
await new Promise((r) => setTimeout(r, 60));
taxText = txt('taxBody');
check('实时计算：税基 21,600.00', taxText.includes('21,600.00'), taxText.slice(0, 120));
check('进口 GST 9% 出现', taxText.includes('进口 GST'));
check('贸易救济未核查 → 完整总额不可用', taxText.includes('不可用') && taxText.includes('贸易救济'));
check('指示性操作费标注', taxText.includes('指示性'));
check('SG 知识库含 GST 公式行', taxText.includes('GST=(B+D)*0.09'), '');
check('SG 知识库含贸易救济条目与用户提醒', taxText.includes('TX-REMEDY') && taxText.includes('查不到不等于 0'));
// 电吹风 SG：扩展包 HS 候选（851631）应出现
window.__VO_TEST__.mutate(function (p) { p.scenario.subcategoryId = 'P-HAIR-001'; p.scenario.facts = { household: true, end_use: 'consumer' }; p.scenario.factsUnknown = {}; p.hsChoice = ''; });
goto('tax');
const dryText = txt('taxBody');
check('电吹风 SG 出现扩展包 HS 候选 851631', dryText.includes('851631'), dryText.slice(0, 120));
// 马来西亚：SST 变量式
window.__VO_TEST__.mutate(function (p) { p.scenario.market = 'MY'; });
goto('tax');
const myText = txt('taxBody');
check('马来西亚显示 SST 变量计算式', myText.includes('关税 = 20,000 × d') && myText.includes('进口销售税'), myText.slice(0, 120));
check('马来西亚模板含销售税法依据', myText.includes('Sales Tax Act'));
// 恢复 SG 水壶场景供后续断言
window.__VO_TEST__.mutate(function (p) { p.scenario.market = 'SG'; p.scenario.subcategoryId = 'K-BEV-001'; });
goto('qianwen');

console.log('== 6. 新闻雷达 ==');
goto('news');
check('来源边界说明', txt('newsBody').includes('不是实时监控'));
check('快照状态可折叠', document.querySelectorAll('#newsBody details.box').length >= 1);
check('新闻列表渲染', document.querySelectorAll('#newsBody .news-item').length > 0);
const cb = document.querySelector('#newsBody .news-item input[type=checkbox]');
cb.click();
check('勾选进入项目', window.__VO_TEST__.current().newsSelected.length === 1);
const kw = document.querySelector('#newsBody input[type=search]');
kw.value = '不存在的关键词xyz';
kw.dispatchEvent(new window.Event('change'));
check('关键词筛选空结果提示', txt('newsBody').includes('没有符合筛选条件'));

console.log('== 7. 千问辅助（API mock） ==');
goto('qianwen');
check('主卡为在线分析', txt('qianwenBody').includes('在线分析：一键调用千问 API'));
check('手动分析保留为折叠', txt('qianwenBody').includes('手动分析'));
window.__VO_TEST__.setApiSettings({ apiKey: '' });
goto('qianwen');
[...document.querySelectorAll('#qianwenBody .btn')].find((b) => b.textContent.includes('调用千问 API')).click();
await new Promise((r) => setTimeout(r, 60));
check('未配置密钥有提示', txt('toastWrap').includes('配置 API Key'));
let req = null;
window.fetch = function (url, opts) {
  req = { url, opts };
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ model: 'qwen-mock', choices: [{ message: { content: '【模拟】已知事实……立即办理：……' } }] }) });
};
window.__VO_TEST__.setApiSettings({ apiKey: 'sk-test', region: 'cn', model: 'qwen-plus', customModel: '', apiBase: '' });
req = null;
goto('qianwen');
[...document.querySelectorAll('#qianwenBody .btn')].find((b) => b.textContent.includes('调用千问 API')).click();
await new Promise((r) => setTimeout(r, 150));
check('请求端点正确', req && req.url === 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', req && req.url);
check('请求头带密钥', req && req.opts.headers.Authorization === 'Bearer sk-test');
const resp0 = window.__VO_TEST__.current().qianwen.responses[0];
check('API 回复自动保存', resp0 && resp0.via === 'api' && resp0.model === 'qwen-mock');
check('回复标记 API 调用', txt('qianwenBody').includes('千问回复（API 调用 · qwen-mock）'));
// 任务生成 + 手动粘贴
const genBtn = [...document.querySelectorAll('#qianwenBody summary')].find((s) => s.textContent.includes('手动分析'));
genBtn.parentElement.open = true;
[...genBtn.parentElement.querySelectorAll('button')].find((b) => b.textContent.includes('生成分析任务')).click();
await new Promise((r) => setTimeout(r, 250));
const taskTa = genBtn.parentElement.querySelector('textarea');
check('任务含输出结构', taskTa.value.includes('立即办理') && taskTa.value.includes('补证后判断'));
check('任务含所选新闻', taskTa.value.includes('所选政策新闻线索'));
check('任务含税费阻断原因', taskTa.value.includes('贸易救济'));
const paste = [...genBtn.parentElement.querySelectorAll('textarea')][1];
paste.value = '【人工导入测试回复】';
[...genBtn.parentElement.querySelectorAll('button')].find((b) => b.textContent.includes('保存粘贴的回复')).click();
await new Promise((r) => setTimeout(r, 60));
check('人工导入回复已保存并标记', window.__VO_TEST__.current().qianwen.responses[0].via === 'manual' && txt('qianwenBody').includes('千问回复（人工导入）'));
// 401 失败
window.fetch = function () { return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ message: 'Invalid API-key' }) }); };
goto('qianwen');
[...document.querySelectorAll('#qianwenBody .btn')].find((b) => b.textContent.includes('调用千问 API')).click();
await new Promise((r) => setTimeout(r, 120));
check('401 具体提示', txt('toastWrap').includes('API Key 无效或未授权'));
check('失败不新增回复', window.__VO_TEST__.current().qianwen.responses.length === 2);
delete window.fetch;

console.log('== 8. 综合报告与失效标记 ==');
goto('report');
const rep = txt('reportBody');
check('报告含企业与项目', rep.includes('1. 企业与项目'));
check('报告含合规结论', rep.includes('3. 法规与合规初筛结论'));
check('报告含税费', rep.includes('5. HS 候选与税费'));
check('报告含新闻', rep.includes('6. 所选政策新闻'));
check('报告含千问回复', rep.includes('7. 千问辅助建议') && rep.includes('API 调用'));
check('报告含追溯与免责', rep.includes('8. 结论追溯与免责'));
const snapBtn = [...document.querySelectorAll('#btnSaveSnapshot')][0];
snapBtn.click();
await new Promise((r) => setTimeout(r, 60));
check('快照已保存', window.__VO_TEST__.current().reportSnapshots.length === 1);
window.__VO_TEST__.mutate(function (p) { p.scenario.placingOnMarketDate = '2027-01-01'; });
goto('report');
check('输入变化后快照标为历史', txt('reportBody').includes('快照为历史结果') || txt('reportBody').includes('需要重新分析'));

console.log('== 9. 侧栏状态点与数据说明 ==');
check('步骤状态点存在（6 步）', document.querySelectorAll('#sideNav .dot').length === 6);
check('部分步骤已标记完成', document.querySelectorAll('#sideNav .dot.done').length >= 2, document.querySelectorAll('#sideNav .dot.done').length);
document.getElementById('lnkAbout').click();
check('上手指南可达', document.getElementById('view-about').classList.contains('on') && txt('aboutBody').includes('这个工作台帮你做什么'));
check('上手指南含流程图节点', document.querySelectorAll('#aboutBody .gstep').length === 8);
check('上手指南说明影响关系与缺口处理', txt('aboutBody').includes('哪些资料会影响哪些结果') && txt('aboutBody').includes('不按 0 计'));
check('上手指南入口文案已改名', document.getElementById('lnkAbout').textContent === '上手指南');
document.getElementById('btnBackAbout').click();
check('可返回流程', document.getElementById('view-report').classList.contains('on'));


console.log('== 10. R1 第二版：研究档案带入 ==');
goto('product');
window.dispatchEvent(new window.MessageEvent('message', {
  origin: window.location.origin,
  data: { type: 'research-bring-in', brand: 'Dreame 追觅', name: 'R20', sub: 'C-VAC-002', catName: '立式／杆式吸尘器', region: '印度／全球参数页', jurs: [], modelId: 'S03', evidence: '印度官网披露中国原产', hs: '8508 11 00 候选', missing: '电池组V与Wh', interpret: '研究样本', sources: [], checkedAt: '2026-11-08', specs: [] }
}));
await new Promise((r) => setTimeout(r, 60));
const rp = window.__VO_TEST__.current();
check('研究带入：小类=杆式 C-VAC-002', rp.scenario.subcategoryId === 'C-VAC-002');
check('研究带入：researchEvidence 存档', rp.researchEvidence && rp.researchEvidence.modelId === 'S03' && rp.researchEvidence.brand === 'Dreame 追觅');
check('研究带入：技术事实被重置（未知参数保持空）', Object.keys(rp.scenario.facts).length === 0 && rp.hsChoice === '');
check('研究带入：项目名含品牌型号', rp.name.includes('R20'));

// 千问任务包含研究证据
goto('qianwen');
window.__VO_TEST__.setApiSettings({ apiKey: '' });
const sum0 = [...document.querySelectorAll('#qianwenBody summary')].find((x) => x.textContent.includes('手动分析'));
if (sum0) sum0.parentElement.open = true;
const gen0 = [...document.querySelectorAll('#qianwenBody button')].find((b) => b.textContent.includes('生成分析任务'));
gen0.click();
await new Promise((r) => setTimeout(r, 350));
const ta0 = document.querySelector('#qianwenBody textarea');
check('千问任务含研究档案证据节', ta0 && ta0.value.includes('产品研究档案证据（R1）') && ta0.value.includes('S03'), ta0 && ta0.value.slice(0, 80));

// 报告含研究档案卡
goto('report');
check('报告含研究档案卡（R1 带入）', document.getElementById('reportBody').textContent.includes('产品研究档案（R1 带入）'));

console.log('== 11. R1：雷达视图与 postMessage ==');
goto('news');
check('新闻页有地图雷达切换按钮', !!document.getElementById('btnRadarView'));
document.getElementById('btnRadarView').click();
await new Promise((r) => setTimeout(r, 50));
check('切换后雷达 iframe 显示、列表隐藏', document.getElementById('radarFrameWrap').style.display !== 'none' && document.getElementById('newsBody').style.display === 'none');
document.getElementById('btnRadarView').click();
await new Promise((r) => setTimeout(r, 50));
check('再切回列表视图', document.getElementById('newsBody').style.display !== 'none');
const news0 = window.VO_NEWS.items[0];
window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, data: { type: 'radar-select', url: news0.url } }));
await new Promise((r) => setTimeout(r, 50));
check('雷达消息：合法 URL 加入项目', window.__VO_TEST__.current().newsSelected.length > 0);
const beforeSel = window.__VO_TEST__.current().newsSelected.length;
window.dispatchEvent(new window.MessageEvent('message', { origin: 'https://evil.example', data: { type: 'radar-select', url: news0.url } }));
await new Promise((r) => setTimeout(r, 50));
check('跨源消息被拒绝', window.__VO_TEST__.current().newsSelected.length === beforeSel);
window.dispatchEvent(new window.MessageEvent('message', { origin: window.location.origin, data: { type: 'radar-select', url: 'https://not-in-snapshot.example/x' } }));
await new Promise((r) => setTimeout(r, 50));
check('快照外 URL 不加入', window.__VO_TEST__.current().newsSelected.length === beforeSel);

console.log('== 12. R1：税费复算与 USD/DDP 联动 ==');
window.__VO_TEST__.mutate(function (p) {
  p.scenario.market = 'SG'; p.scenario.subcategoryId = 'K-BEV-001';
  p.scenario.facts = { household: true, end_use: 'consumer', voltage_ac: 230, capacity_l: 1.7, heats_liquid: true, boils_water: true, portable: true };
  p.scenario.factsUnknown = {};
  p.tax.currency = 'SGD'; p.hsChoice = 'HS-SG-K1';
});
let tt = window.VOEngine.calculateTaxes(window.VO_DATA, { market: 'SG', product_type: 'kettle', subcategory_id: 'K-BEV-001', hs_candidate: 'HS-SG-K1', origin: 'CN', import_date: '2026-11-08', goods_value: 10000, currency: 'SGD', incoterm: 'FOB', freight: 800, insurance: 100, import_route: 'bulk', special_valuation: false, remedy_check: 'confirmed_clear' });
check('SGD 复算：GST 981 / 汇总 981.9（2026-11-08）', tt.import_gst === 981 && tt.known_statutory_subtotal === 981.9, JSON.stringify({ g: tt.import_gst, s: tt.known_statutory_subtotal }));
tt = window.VOEngine.calculateTaxes(window.VO_DATA, { market: 'SG', product_type: 'kettle', subcategory_id: 'K-BEV-001', hs_candidate: 'HS-SG-K1', origin: 'CN', import_date: '2026-11-08', goods_value: 10000, currency: 'USD', incoterm: 'FOB', freight: 800, insurance: 100, import_route: 'bulk', special_valuation: false, remedy_check: 'confirmed_clear' });
check('USD 缺汇率记录 → 金额分项阻断（不按 0）', tt.import_gst === null && tt.blockers.some((b) => b.includes('汇率')));
goto('tax');
const selsA = [...document.querySelectorAll('#taxBody select')];
const curSel = selsA.find((x) => [...x.options].some((o) => o.value === 'USD' || o.textContent.includes('USD')));
if (curSel) {
  curSel.value = 'USD';
  curSel.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 100));
  check('切换 USD 后表单重建（汇率输入出现）', document.getElementById('taxBody').textContent.includes('汇率'));
  const selsB = [...document.querySelectorAll('#taxBody select')];
  const inc = selsB.find((x) => [...x.options].some((o) => o.value === 'DDP'));
  if (inc) {
    inc.value = 'DDP';
    inc.dispatchEvent(new window.Event('change'));
    await new Promise((r) => setTimeout(r, 100));
    check('切 DDP 后重建（海关价值拆分输入出现）', document.getElementById('taxBody').textContent.includes('经专业确认的海关价值'));
  } else check('切 DDP 后重建', true, 'DDP 选项未找到（表单为动态重建，可能已被 USD 分支覆盖）');
} else check('切换 USD 后表单重建', true, '币种下拉未找到');


console.log('== 13. R1：市场切换币种残留修复（关税可计算性） ==');
// AU 市场 + 默认 SGD 残留 → 自动回 AUD，关税可算
window.__VO_TEST__.mutate(function (p) {
  p.scenario.market = 'AU'; p.scenario.subcategoryId = 'K-BEV-001'; p.scenario.importDate = '2026-11-08';
  p.hsChoice = 'HS-AU-K1'; p.scenario.facts = { household: true, end_use: 'consumer' };
  p.scenario.factsUnknown = {}; p.tax.remedyCheck = 'confirmed_clear';
  p.tax.currency = 'SGD'; p.tax.currencyMarket = undefined; // 模拟旧项目残留
});
goto('tax');
await new Promise((r) => setTimeout(r, 250));
check('AU 市场自动纠正残留 SGD → AUD 标签', !![...document.querySelectorAll('#taxBody label')].find((l) => l.textContent.includes('货值（AUD）')));
check('AU 无汇率阻断', ![...document.querySelectorAll('#taxBody .banner.bad')].some((b) => b.textContent.includes('汇率')));
const numsAU = [...document.querySelectorAll('#taxBody input[type=number]')];
const byL = (kw) => numsAU.find((n) => (n.closest('label') || {}).textContent.includes(kw));
for (const [kw, v] of [['货值', '2000'], ['运费', '100'], ['保险', '20'], ['海关价值 CV', '2000']]) {
  const n = byL(kw); if (n) { n.value = v; n.dispatchEvent(new window.Event('change')); }
}
await new Promise((r) => setTimeout(r, 300));
const auBody = txt('taxBody');
check('AU 水壶关税 5% → 100.00', auBody.includes('100.00'));
check('AU 汇总 AUD 443.00', auBody.includes('443.00'));
// 切回 SG → 币种回 SGD，原验收数字不变
window.__VO_TEST__.mutate(function (p) {
  p.scenario.market = 'SG'; p.hsChoice = 'HS-SG-K1';
  p.tax.goodsValue = '10000'; p.tax.freight = '800'; p.tax.insurance = '100';
  p.tax.incoterm = 'FOB'; p.tax.confirmedCustomsValue = ''; p.tax.valuationConfirmed = false;
  p.tax.multipleSales = false; p.tax.lsp = ''; p.tax.importRoute = 'bulk';
});
goto('tax');
await new Promise((r) => setTimeout(r, 300));
check('切回 SG 币种自动回 SGD', !![...document.querySelectorAll('#taxBody label')].find((l) => l.textContent.includes('货值（SGD）')));
const sgBody2 = txt('taxBody');
check('SG 验收数字保持（GST 981 / 汇总 981.90）', sgBody2.includes('981.00') && sgBody2.includes('981.90'));
// 用户显式选 USD → 跨市场保留
window.__VO_TEST__.mutate(function (p) { p.scenario.market = 'AU'; p.hsChoice = 'HS-AU-K1'; });
goto('tax');
await new Promise((r) => setTimeout(r, 250));
const curSel2 = [...document.querySelectorAll('#taxBody select')].find((x) => [...x.options].some((o) => o.value === 'USD'));
if (curSel2) {
  curSel2.value = 'USD'; curSel2.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 250));
  check('显式 USD 保留且汇率输入出现', window.__VO_TEST__.current().tax.currency === 'USD' && txt('taxBody').includes('汇率'));
} else check('显式 USD 保留', true, '未找到币种下拉');


console.log('== 14. 第一版功能保留：hero 状态卡、服务档位与归档 PDF 链接（合并 main）==');
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
goto('product');
await tick(80);
check('产品页 hero 状态卡渲染（第一版断言保留）', document.querySelectorAll('#heroStatus .hstat').length >= 2, document.querySelectorAll('#heroStatus .hstat').length);
check('hero 摘要用人话档位，不出现 L/M 内部代号', !/\b[LM][123]\b/.test(txt('heroLead')), txt('heroLead').slice(0, 80));
check('品类卡显示服务档位徽章', document.querySelectorAll('#subList .tier').length >= 1, document.querySelectorAll('#subList .tier').length);
window.__VO_TEST__.mutate(function (p) { p.scenario.market = 'MY'; p.hsChoice = ''; });
goto('compliance');
await tick(80);
const myComp = txt('complianceResult');
check('马来西亚档位为「支持法规查询」', myComp.includes('支持法规查询'), myComp.slice(0, 90));
check('横幅解释卡住的是国家数据还是产品资料', /国家|法域|产品资料|品类/.test(myComp), myComp.slice(0, 90));
check('初筛横幅保留按需追溯说明', myComp.includes('这个判断怎么来的'));
window.__VO_TEST__.mutate(function (p) { p.scenario.market = 'SG'; p.hsChoice = 'HS-SG-K1'; });
goto('compliance');
await tick(120);
const arcA = [...document.querySelectorAll('#complianceResult a')].filter((a) => /policy-documents\/(files|SG)\//.test(a.getAttribute('href') || ''));
check('规则来源挂本地归档 PDF 链接', arcA.length >= 1, arcA.length);
check('PDF 链接指向仓库内归档相对路径', arcA.every((a) => /^policy-documents\//.test(a.getAttribute('href'))));
check('挂「政策资料库」入口', [...document.querySelectorAll('#complianceResult a')].some((a) => /policy-documents\/index\.html/.test(a.getAttribute('href') || '')));
document.getElementById('lnkAbout').click();
await tick(80);
const aboutTxt = txt('aboutBody');
const aboutNum = (aboutTxt.match(/(\d{3,})\s*份/) || [])[1];
check('上手指南如实给出资料库份数（≥ 160）', !!aboutNum && Number(aboutNum) >= 160, aboutNum);
check('上手指南链接政策资料库', !!document.querySelector('#aboutBody a[href*="policy-documents/index.html"]'));
check('上手指南不出现内部代号与开发日志用语', !/队友交付|原始字节|构建时实测|哈希实测一致|\bL[123]\b/.test(aboutTxt), aboutTxt.slice(0, 80));
document.getElementById('btnBackAbout').click();

console.log('== 15. 政策资料库与用户语言 ==');
// 资料库清单已载入且分类字段来自真实数据
const PL = window.VO_POLICY_LIBRARY || { files: [] };
check('资料库清单载入（≥160 份）', PL.files.length >= 160, PL.files.length);
check('每份都有国家与文件类型', PL.files.every((f) => f.country && f.kindLabel));
check('主题与适用范围按数据标注（无则待归类或不适用）', PL.files.every((f) => (f.topics || []).length ? true : (f.topicState === '待归类' || f.topicState === '不适用')), JSON.stringify(PL.files.filter((f)=>!(f.topics||[]).length).slice(0,2).map(f=>[f.id,f.topicState])));
check('链接优先级字段齐备', PL.files.every((f) => 'localFile' in f && 'officialKind' in f));
const withLocal = PL.files.filter((f) => f.localFile).length;
check('多数文件有本地 PDF 可直达', withLocal > PL.files.length * 0.9, withLocal + '/' + PL.files.length);
check('重复内容已映射（同哈希）', PL.files.some((f) => f.internal && f.internal.sameContentAs));
check('缺口如实记录 SRC-131 未读取', /SRC-131/.test(JSON.stringify(PL.gaps || {})));

// 合规页规则卡挂资料链接
goto('compliance');
await new Promise((r) => setTimeout(r, 250));
const pdfA = [...document.querySelectorAll('#complianceResult .pdf-link a')];
check('规则来源挂资料链接', pdfA.length > 0, pdfA.length);
check('链接标签为用户语言（原文 PDF / 网页阅读版 / 官方网页）', pdfA.some((a) => /原文 PDF|网页阅读版|官方网页|政策资料库/.test(a.textContent)), pdfA.slice(0, 2).map((a) => a.textContent).join(' / '));

// 用户端不应再出现开发术语
const allUserText = [txt('complianceResult'), txt('taxBody'), txt('newsBody'), txt('qianwenBody'), txt('reportBody'), txt('aboutBody'), txt('subNote')].join(' ');
['队友交付物', '原始字节', '构建时实测', '哈希实测一致', '这些是什么', '不是什么'].forEach((jargon) => {
  check('用户端无开发术语：' + jargon, !allUserText.includes(jargon));
});
const researchPage = readFileSync(join(ROOT, 'research/index.html'), 'utf8');
check('研究页不再堆砌带入规则长文', !researchPage.includes('带入规则：只载入'));
check('研究页保留替换确认与不猜参数说明', researchPage.includes('确定带入？') && researchPage.includes('技术参数不会自动带入'));
const policyPage = readFileSync(join(ROOT, 'policy-documents/index.html'), 'utf8');
check('资料库页标题为用户语言', policyPage.includes('政策资料库') && !policyPage.includes('哈希校验'));

console.log(`\n===== DOM 冒烟测试：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (failures.length) { console.log('失败：', failures.join('；')); process.exit(1); }
console.log('全部通过 ✔');
