const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../js/engine.js');
const D = JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../data/vo-data.json')));
const base={market:'SG',origin:'CN',import_date:'2026-11-08',goods_value:10000,currency:'SGD',incoterm:'FOB',freight:800,insurance:100,special_valuation:false,remedy_check:'confirmed_clear',hs_reviewed:true};
let n=0;
for(const p of D.taxProfiles.filter(p=>p.requiresReview)) {
 const i={...base,product_type:p.product_type,hs_candidate:p.candidateId};
 const t=E.calculateTaxes(D,i);assert.equal(t.import_gst,981);assert.equal(t.complete_total,981.9);
 assert.equal(E.calculateTaxes(D,{...i,hs_reviewed:false}).complete_total,null);
 for(const changes of [{freight:null},{insurance:null},{currency:'USD'},{special_valuation:'unknown'},{hs_candidate:'BAD'},{import_date:'2027-01-01'},{remedy_check:''},{origin:''},{import_date:''},{incoterm:''}]) assert.equal(E.calculateTaxes(D,{...i,...changes}).complete_total,null);
 assert.equal(E.taxProfileFor(D,{...i,product_type:'unrelated'}),null);
 n++;
}
assert.equal(D.subcategories.filter(s=>s.group==='GRP-WET').length,5);
for(const s of D.subcategories.filter(s=>s.group==='GRP-WET')) assert.equal(E.calculateTaxes(D,{...base,product_type:s.legacy}).complete_total,null);
const au=E.calculateTaxes(D,{...base,market:'AU',currency:'AUD',product_type:'unmapped',hs_candidate:'BAD',origin_preference:'reviewed',origin_psr_satisfied:true,origin_documents_valid:true,transport_conditions_satisfied:true});assert.equal(au.ordinary_duty,null);
console.log(`${n} 新增画像：公式、复核门槛、缺失条件、日期及候选错配通过；未知 AU 产品不得取得优惠零税率。`);
