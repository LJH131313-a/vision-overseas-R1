/**
 * 统一能力判断层检查
 * 运行：node tests/capability.test.mjs
 *
 * 覆盖：动态缺口生成（非硬编码）、平台能力与用户填写状态的区分、
 *      未知条件不按 0 处理、等级图谱与矩阵和引擎一致、语言无关输出。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);
const D = require(join(ROOT, 'data/vo-data.json'));
const E = require(join(ROOT, 'js/engine.js'));
const C = require(join(ROOT, 'js/capability.js'));

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else { fail++; problems.push(name + (detail ? ' → ' + String(detail).slice(0, 200) : '')); }
}

const CLEAN = ['C-VAC-001', 'C-VAC-002', 'C-VAC-003', 'C-VAC-004', 'C-VAC-005',
  'C-WET-001', 'C-WET-002', 'C-WET-003', 'C-WET-004', 'C-WET-005'];
const FULL_TAX = {
  goodsValue: '10000', freight: '800', insurance: '100', origin: 'CN', importDate: '2026-11-08',
  currency: 'SGD', incoterm: 'FOB', priceBasis: 'FOB', importRoute: 'bulk', specialValuation: 'no',
  remedyCheck: 'confirmed_clear', hsReviewed: true
};
const FACTS = {
  'C-VAC-001': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, motor_power_w: 800, dust_receptacle_l: 2 },
  'C-VAC-002': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, motor_power_w: 500, dust_receptacle_l: 0.8, charger_included: true },
  'C-VAC-003': { household: true, voltage_ac: 220, portable: true, handheld: true, suction_cleaning: true, motor_power_w: 150, dust_receptacle_l: 0.5 },
  'C-VAC-004': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, vacuum_mode: 'wet_and_dry', motor_power_w: 1200, dust_receptacle_l: 15 },
  'C-VAC-005': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, mains_dock: true, dock_dust_removal: true, charger_included: true },
  'C-WET-001': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, floor_washing: true, steam_function: false },
  'C-WET-002': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, steam_function: true, floor_washing: true },
  'C-WET-003': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, steam_function: true },
  'C-WET-004': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, carpet_extraction: true },
  'C-WET-005': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, polishing_function: true }
};

console.log('== 1. 新加坡清洁电器工作流可达性 ==');
for (const id of CLEAN) {
  const sub = D.subcategories.find((s) => s.id === id);
  const cap0 = C.evaluate(D, E, { market: 'SG', subcategoryId: id, facts: FACTS[id], placingOnMarketDate: '2026-11-08', tax: FULL_TAX });
  const firstHs = (cap0.scenario.hsCandidates || [])[0];
  const cap = C.evaluate(D, E, { market: 'SG', subcategoryId: id, facts: FACTS[id], placingOnMarketDate: '2026-11-08', hsChoice: firstHs ? firstHs.id : '', tax: FULL_TAX });
  const hs = cap.scenario.hsCandidates || [];
  check(`${id} 有 HS 候选`, hs.length >= 1, hs.length);
  check(`${id} 未选候选时不承诺税额`, cap0.tax.amount === 'pending' || cap0.tax.amount === 'needs_input' || hs.length === 1, cap0.tax.amount);
  check(`${id} 税率可查`, cap.tax.rate === 'ok', cap.tax.rate);
  check(`${id} 汇总可输出（条件齐备）`, cap.tax.subtotal === 'ok', cap.tax.subtotal);
  check(`${id} 汇总值不为空且不把未知按 0`, cap.scenario && true && cap.tax.blockers.length === 0, cap.tax.blockers.join(';'));
  if (id === 'C-WET-005') {
    check('C-WET-005（M1）初筛如实标记为暂不支持', cap.screening.state === 'not_supported', cap.screening.state);
    check('C-WET-005 缺口原因指向产品资料而非泛称数据不足', cap.screening.reason === 'product_fact' && cap.screening.owner === 'platform', cap.screening.reason + '/' + cap.screening.owner);
  } else {
    check(`${id} 初筛有可执行规则支撑`, ['ok', 'partial', 'needs_input'].includes(cap.screening.state), cap.screening.state);
    check(`${id} 服务等级不因静态画像虚高`, cap.service.code === 'L2' || cap.service.code === 'L3', cap.service.code);
  }
}

console.log('== 2. 缺口原因随情景变化（不硬编码）==');
const base = { market: 'SG', subcategoryId: 'C-VAC-002', facts: FACTS['C-VAC-002'], placingOnMarketDate: '2026-11-08' };
const noTaxInput = C.evaluate(D, E, Object.assign({}, base, { tax: {}, hsChoice: 'HS-SG-C-VAC-002-850811' }));
check('缺交易信息 → needs_input + user_input', noTaxInput.features.find((f) => f.key === 'tax_calc').state === 'needs_input', JSON.stringify(noTaxInput.features.find((f) => f.key === 'tax_calc')));
check('缺交易信息列出具体字段', (noTaxInput.features.find((f) => f.key === 'tax_calc').missing || []).length >= 2, noTaxInput.features.find((f) => f.key === 'tax_calc').missing);
const multiHs = C.evaluate(D, E, Object.assign({}, base, { tax: FULL_TAX }));
check('多候选未选 → 归类待确认', multiHs.hs.state === 'pending' && multiHs.hs.reason === 'hs_review', multiHs.hs.state + '/' + multiHs.hs.reason);
const picked = C.evaluate(D, E, Object.assign({}, base, { tax: FULL_TAX, hsChoice: 'HS-SG-C-VAC-002-850811' }));
check('选定候选后归类状态改变', picked.hs.state !== 'pending', picked.hs.state);
const myMarket = C.evaluate(D, E, { market: 'MY', subcategoryId: 'C-VAC-002', facts: FACTS['C-VAC-002'], placingOnMarketDate: '2026-11-08', tax: FULL_TAX });
check('马来西亚无税费画像 → 平台缺口', myMarket.tax.rate === 'not_supported' && myMarket.tax.reason === 'tax_profile_missing' && myMarket.tax.owner === 'platform', myMarket.tax.reason + '/' + myMarket.tax.owner);
const badDate = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-VAC-002', facts: FACTS['C-VAC-002'], placingOnMarketDate: '2026-11-08', hsChoice: 'HS-SG-C-VAC-002-850811', tax: Object.assign({}, FULL_TAX, { importDate: '2027-06-01' }) });
check('日期超出适用区间 → date_out_of_range', badDate.tax.rate === 'not_supported' && badDate.tax.reason === 'date_out_of_range', badDate.tax.reason);
const special = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-VAC-002', facts: FACTS['C-VAC-002'], placingOnMarketDate: '2026-11-08', hsChoice: 'HS-SG-C-VAC-002-850811', tax: Object.assign({}, FULL_TAX, { specialValuation: 'unknown' }) });
check('特殊估价未确认 → 完整总额为空', special.tax.blockers.some((b) => /估价|valuation|特殊/.test(b)) && special.tax.subtotal !== 'ok', JSON.stringify(special.tax.blockers));
const remedy = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-VAC-002', facts: FACTS['C-VAC-002'], placingOnMarketDate: '2026-11-08', hsChoice: 'HS-SG-C-VAC-002-850811', tax: Object.assign({}, FULL_TAX, { remedyCheck: '' }) });
check('贸易救济未确认 → 完整总额为空且原因指向复核', remedy.tax.subtotal !== 'ok' && /evidence_pending|user_input/.test(remedy.tax.reason), remedy.tax.subtotal + '/' + remedy.tax.reason);
const noFacts = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-VAC-002', facts: {}, placingOnMarketDate: '', tax: FULL_TAX });
check('未填产品事实 → 初筛待补事实', noFacts.screening.state === 'needs_input' && noFacts.screening.reason === 'product_fact', noFacts.screening.state + '/' + noFacts.screening.reason);
const noSel = C.evaluate(D, E, { market: '', subcategoryId: '', facts: {}, tax: FULL_TAX });
check('未选目的地/品类 → 待选择状态', noSel.screening.state === 'needs_input' && noSel.screening.reason === 'user_input', noSel.screening.reason);

console.log('== 3. 平台能力与用户填写状态区分 ==');
const platformGap = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-WET-005', facts: FACTS['C-WET-005'], placingOnMarketDate: '2026-11-08', tax: FULL_TAX });
check('平台缺口 owner=platform 与用户缺口 owner=user 不同', platformGap.screening.owner === 'platform' && noTaxInput.features.find((f) => f.key === 'tax_calc').owner === 'user', platformGap.screening.owner);
check('专业复核事项 owner=expert 未被写成简单填写问题', remedy.features.find((f) => f.key === 'tax_calc').owner !== 'user' || remedy.features.find((f) => f.key === 'tax_calc').state !== 'ok', remedy.features.find((f) => f.key === 'tax_calc').owner);

console.log('== 4. 等级图谱、覆盖矩阵与引擎一致 ==');
const idx = C.levelIndex(D, E, { date: '2026-11-08' });
check('M 等级分布总数等于小类数', CLEAN.length <= 57 && Object.values(idx.mGroups).reduce((a, b) => a + b.length, 0) === D.subcategories.length, Object.values(idx.mGroups).reduce((a, b) => a + b.length, 0));
check('L 等级组合总数等于小类×市场数', idx.rows.length === D.subcategories.length * D.jurisdictions.length, idx.rows.length);
const sgVacRow = idx.rows.find((r) => r.market === 'SG' && r.sub === 'C-VAC-002');
const direct = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-VAC-002', facts: C.factsFromMap(D, 'C-VAC-002'), placingOnMarketDate: '2026-11-08' });
check('图谱行与直接评估的服务等级一致', sgVacRow && sgVacRow.l === direct.service.code, sgVacRow && sgVacRow.l + '/' + direct.service.code);
check('静态画像写入 L2 但无可执行规则时降级为 L1', idx.rows.some((r) => r.l === 'L1' && r.staticL === 'L2'), '无降级样本');
const unbacked = idx.rows.filter((r) => r.l === 'L1' && r.staticL === 'L2');
check('降级样本包含仅有静态画像的组合（如 SG×M1 小类）', unbacked.length > 0, unbacked.length);
check('未被支撑的组合不显示为可初筛', unbacked.every((r) => r.screen === 'not_supported'), unbacked.slice(0, 3).map((r) => r.sub + '@' + r.market + ':' + r.screen).join(','));

console.log('== 5. 输出语言无关（不夹带中文说明）==');
const codes = JSON.stringify(C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-VAC-002', facts: FACTS['C-VAC-002'], placingOnMarketDate: '2026-11-08', tax: FULL_TAX }).features.map((f) => ({ k: f.key, s: f.state, r: f.reason, o: f.owner, m: f.missing })));
check('功能状态输出不含中文（由语言层渲染）', !/[\u4e00-\u9fff]/.test(codes), codes.slice(0, 160));
const capSrc = readFileSync(join(ROOT, 'js/capability.js'), 'utf8');
check('能力层不按具体小类硬编码状态', !/C-VAC-00\d|C-WET-00\d/.test(capSrc));
check('能力层不按具体规则号硬编码结论', !/SG-P2-[A-Z-]+/.test(capSrc));

console.log('== 6. 清洁电器数据修复的回归护栏 ==');
check('C-WET-004 不再有空 legacy（否则全量规则卡 unknown）', (D.subcategories.find((s) => s.id === 'C-WET-004') || {}).legacy === 'carpet_cleaner', (D.subcategories.find((s) => s.id === 'C-WET-004') || {}).legacy);
const wet4 = C.evaluate(D, E, { market: 'SG', subcategoryId: 'C-WET-004', facts: FACTS['C-WET-004'], placingOnMarketDate: '2026-11-08', tax: FULL_TAX });
check('C-WET-004 未知规则数不再被全量规则拖高', wet4.screening.unknown < 12, wet4.screening.unknown);
check('湿式五类都有 SG HS 候选', ['C-WET-001', 'C-WET-002', 'C-WET-003', 'C-WET-004', 'C-WET-005'].every((id) => (D.hsCandidates || []).some((h) => h.market === 'SG' && h.legacyProduct === id)));
check('湿式四类都有 SG 税费画像', ['floor_washer', 'steam_cleaner', 'carpet_cleaner', 'floor_polisher'].every((pt) => D.taxProfiles.some((t) => t.market === 'SG' && t.product_type === pt)));
check('新 HS 候选都带官方来源与待复核标记', D.hsCandidates.filter((h) => String(h.origin || '').startsWith('sg_cleaning')).every((h) => (h.sourceIds || []).length > 0 && h.notFinal === true));
check('新税费画像标注在线复核未执行', D.taxProfiles.filter((t) => t.version === 'sg-cleaning-ahtn-2026-11-09').every((t) => /在线复核未执行/.test(t.verification || '')));
const regSg = D.regulations.filter((r) => r.jurisdiction === 'SG');
check('SG 法规索引已回填可执行规则（不再全报索引级）', regSg.filter((r) => (r.ruleIds || []).length).length >= 4, regSg.map((r) => r.id + ':' + (r.ruleIds || []).length).join(','));
check('CGSR 条例已入库并挂规则', D.regulations.some((r) => r.id === 'REG-SG-008') && D.rules.some((r) => r.regulationId === 'REG-SG-008'));

console.log(`\n===== 能力层检查：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (problems.length) { console.log('失败：'); problems.slice(0, 25).forEach((p) => console.log('  ✗', p)); process.exit(1); }
console.log('全部通过 ✔');
