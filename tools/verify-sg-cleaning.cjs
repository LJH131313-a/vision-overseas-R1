/* 新加坡 10 类清洁电器逐项验收（能力层 + 引擎实际输出） */
const D = require('../data/vo-data.json');
const engine = require('../js/engine.js');
const cap = require('../js/capability.js');

const subs = ['C-VAC-001', 'C-VAC-002', 'C-VAC-003', 'C-VAC-004', 'C-VAC-005', 'C-WET-001', 'C-WET-002', 'C-WET-003', 'C-WET-004', 'C-WET-005'];
const FACTS = {
  'C-VAC-001': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, motor_power_w: 800, dust_receptacle_l: 2, vacuum_mode: 'dry_only' },
  'C-VAC-002': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, motor_power_w: 500, dust_receptacle_l: 0.8, battery_present: true, charger_included: true },
  'C-VAC-003': { household: true, voltage_ac: 220, portable: true, handheld: true, suction_cleaning: true, motor_power_w: 150, dust_receptacle_l: 0.5, charger_included: true },
  'C-VAC-004': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, vacuum_mode: 'wet_and_dry', motor_power_w: 1200, dust_receptacle_l: 15 },
  'C-VAC-005': { household: true, voltage_ac: 230, portable: true, suction_cleaning: true, mains_dock: true, dock_dust_removal: true, charger_included: true, wireless_present: true, battery_present: true },
  'C-WET-001': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, floor_washing: true, water_tank_l: 0.8, steam_function: false },
  'C-WET-002': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, steam_function: true, steam_output_g_min: 30, floor_washing: true },
  'C-WET-003': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, steam_function: true, steam_output_g_min: 60 },
  'C-WET-004': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, carpet_extraction: true, primary_surface: ['carpet'], water_tank_l: 4 },
  'C-WET-005': { household: true, voltage_ac: 230, portable: true, suction_cleaning: false, polishing_function: true, primary_surface: ['hard_floor'] }
};
const TAX = {
  goodsValue: '10000', freight: '800', insurance: '100', origin: 'CN', importDate: '2026-11-08',
  currency: 'SGD', incoterm: 'FOB', priceBasis: 'FOB', importRoute: 'bulk', specialValuation: 'no',
  remedyCheck: 'confirmed_clear', hsReviewed: true, multipleSales: false, confirmedCustomsValue: '', valuationConfirmed: false
};

const rows = [];
for (const id of subs) {
  const facts = FACTS[id];
  const pre = cap.evaluate(D, engine, { market: 'SG', subcategoryId: id, facts, placingOnMarketDate: '2026-11-08', tax: TAX });
  const firstHs = ((pre.scenario.hsCandidates) || [])[0];
  const base = cap.evaluate(D, engine, { market: 'SG', subcategoryId: id, facts, placingOnMarketDate: '2026-11-08', hsChoice: firstHs ? firstHs.id : '', tax: TAX });
  const sc = base.scenario;
  const hsIds = (sc.hsCandidates || []).map((h) => h.id);
  // 选定 HS 后重新评估税费能力
  const withHs = cap.evaluate(D, engine, { market: 'SG', subcategoryId: id, facts, placingOnMarketDate: '2026-11-08', hsChoice: hsIds[0] || '', tax: TAX });
  const taxRes = hsIds[0] ? engine.calculateTaxes(D, cap.buildTaxInput(D, { market: 'SG', tax: TAX, hsChoice: hsIds[0], placingOnMarketDate: '2026-11-08' }, sc)) : null;
  rows.push({
    id, name: D.subcategories.find((s) => s.id === id).name,
    m: base.evidence.code, l: base.service.code, staticL: base.service.staticL || base.service.staticLevel, backed: base.service.profileBacked,
    screen: base.screening.state, screenApplicable: base.screening.applicable, screenUnknown: base.screening.unknown,
    rules: (sc.applicableRules || []).map((r) => r.id).join('+') || (base.screening.rules || []).join('+'),
    hs: hsIds.join(',') || '-', hsState: withHs.hs.state,
    taxRate: withHs.tax.rate, taxAmount: withHs.tax.amount, taxSubtotal: withHs.tax.subtotal,
    subtotalValue: taxRes ? taxRes.known_statutory_subtotal : null,
    complete: taxRes ? taxRes.complete_total : null,
    blockers: taxRes ? (taxRes.blockers || []).slice(0, 2) : [],
    report: base.report.state,
    gaps: base.gaps.map((g) => g.feature + ':' + g.state + ':' + (g.reason || '')).join(' ')
  });
}
const L = [];
L.push('| 产品小类 | M | L(实际) | L(静态) | 画像有规则支撑 | 合规初筛 | 命中规则 | HS 候选 | 税率查询 | 税额测算 | 汇总 | 汇总值 | 尚缺/原因 |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
rows.forEach((r) => L.push(`| ${r.id} ${r.name} | ${r.m} | ${r.l} | ${r.staticL} | ${r.backed ? '是' : '否'} | ${r.screen}(适用${r.screenApplicable}/待补${r.screenUnknown}) | ${r.rules} | ${r.hs} | ${r.taxRate} | ${r.taxAmount} | ${r.taxSubtotal} | ${r.subtotalValue} / 完整 ${r.complete} | ${r.gaps} |`));
L.push('');
rows.forEach((r) => { if (r.blockers.length) L.push(`${r.id} 阻断：` + JSON.stringify(r.blockers)); });
require('fs').writeFileSync(require('path').join(__dirname,'..','docs','SG-CLEANING-ACCEPTANCE.md'), L.join('\n'));
console.log(L.join('\n'));
