import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const artifacts = process.env.REVIEW_DIR || '/tmp/r1-review'; mkdirSync(artifacts,{recursive:true});
const base=process.env.PREVIEW_URL || 'http://127.0.0.1:8000';
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(base);await p.screenshot({path:artifacts+'/after-home.png',fullPage:true});
const groups=await p.locator('#homeGroups button').count();assert.equal(groups,await p.evaluate(()=>VO_DATA.groups.length));
await p.locator('#homeGroups button').filter({hasText:'台式烹饪'}).click();await p.selectOption('#pMarket','SG');
await p.locator('.sub-item').filter({hasText:'微波炉'}).click();
await p.screenshot({path:artifacts+'/after-product.png',fullPage:true});
const input=p.locator('[data-fact] input[type=number]').first();
if(await input.count()) {await input.scrollIntoViewIfNeeded();await input.focus();const key=await input.evaluate(n=>n.closest('[data-fact]').dataset.fact);const top=await input.evaluate(n=>n.closest('[data-fact]').getBoundingClientRect().top);await input.fill('1200');await input.dispatchEvent('change');await p.waitForTimeout(100);const a=await p.evaluate(k=>({key:document.activeElement.closest('[data-fact]')?.dataset.fact,top:[...document.querySelectorAll('[data-fact]')].find(n=>n.dataset.fact===k).getBoundingClientRect().top}),key);assert.equal(a.key,key);assert.ok(Math.abs(a.top-top)<3);console.log('连续输入：焦点及字段视口位置保持');}else throw Error('no numeric fact tested');
await p.locator('#sideNav [data-tab=tax]').click();await p.locator('input[name=hsChoice]').first().check();await p.locator('#hsReviewed').check();assert.ok((await p.locator('#taxBody').innerText()).includes('税率查询：有适用依据'));await p.screenshot({path:artifacts+'/after-tax.png',fullPage:true});
await p.goto(base+'/policy-documents/index.html');const links=await p.locator('a[href$=".pdf"]').evaluateAll(a=>a.map(x=>x.href));assert.equal(links.length,4);for(const u of links){const r=await p.request.get(u);assert.equal(r.status(),200);assert.ok((await r.body()).subarray(0,5).toString()==='%PDF-');}
await p.setViewportSize({width:390,height:844});await p.goto(base);await p.screenshot({path:artifacts+'/after-mobile.png',fullPage:true});assert.equal(errors.length,0,errors.join('\n'));console.log('分类入口、微波炉税率查询、4 个 PDF 与页面脚本检查通过');await b.close();
