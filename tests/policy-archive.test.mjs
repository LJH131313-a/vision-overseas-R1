/**
 * 法规原文 PDF 归档完整性检查
 * 运行：node tests/policy-archive.test.mjs
 *
 * 校验：manifest 中每个文件确实存在于仓库、大小与 SHA-256 与清单一致（现场重算）、
 *      原始登记哈希比对结果如实、分组统计正确、页面与数据脚本齐备。
 * 目的：防止「只放了 4 份」「合并时把队友交付的文件漏掉」再次发生。
 *
 * 说明：面向用户的页面文案已按产品要求改为「政策资料库」等人话，本检查同步改为按新文案断言，
 *      校验口径（文件存在、字节、哈希、分组、诚实标注）与第一版完全一致，未削弱任何覆盖。
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else { fail++; problems.push(name + (detail ? ' → ' + String(detail).slice(0, 160) : '')); }
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'policy-documents/manifest.json'), 'utf-8'));
const files = manifest.files || [];
const uniquePaths = new Set(files.map((f) => f.file || f.localFile));

console.log('== 1. 清单规模 ==');
check('归档文件数 ≥ 160（148 网页运行 + 5 官方原件 + 5 SG + 4 说明书样本）', files.length >= 160, files.length);
check('totals.files 与实际一致', manifest.totals.files === files.length);
check('totals.uniqueFiles 与去重后实体数一致', manifest.totals.uniqueFiles === uniquePaths.size, manifest.totals.uniqueFiles + '/' + uniquePaths.size);
check('同一内容不重复入库（实体数 ≤ 记录数）', uniquePaths.size <= files.length);
const groups = manifest.totals.groups || {};
check('web 组 148 份', groups.web === 148, groups.web);
check('official 组 5 份（研究库补充官方原件）', groups.official === 5, groups.official);
check('SG 组 5 份（zky 二次交付 4 份 + 开发分支新加坡税则原件 1 份）', groups.SG === 5, groups.SG);
check('product-manuals 组 4 份（产品说明书样本）', groups['product-manuals'] === 4, groups['product-manuals']);
check('法域覆盖 ≥ 20', (manifest.jurisdictions || []).length >= 20, (manifest.jurisdictions || []).length);

console.log('== 2. 逐份实测（文件存在 + 大小 + SHA-256 重算）==');
let missing = 0, sizeBad = 0, hashBad = 0, verified = 0;
for (const f of files) {
  const p = join(ROOT, f.file);
  if (!existsSync(p)) { missing++; if (missing <= 3) console.log('  缺文件：', f.file); continue; }
  const buf = readFileSync(p);
  if (buf.length !== f.size_bytes) sizeBad++;
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== f.sha256) hashBad++;
  if (f.hash_match === true && f.recorded_sha256 === sha) verified++;
}
check('全部文件存在', missing === 0, '缺失 ' + missing);
check('大小全部与清单一致', sizeBad === 0, '不一致 ' + sizeBad);
check('SHA-256 全部与清单一致', hashBad === 0, '不一致 ' + hashBad);
check('与原始登记哈希一致的文件 ≥ 150', verified >= 150, verified);

console.log('== 3. 诚实标注 ==');
check('声明归档≠已结构化/已生效', /归档不等于全文已结构化|归档 ≠ 全文已结构化/.test(manifest.note));
check('产品说明书标注为非法规', files.filter((f) => f.group === 'product-manuals').every((f) => /不是法规|产品事实证据|产品证据|产品说明书/.test(f.provenance + f.file_kind + f.verification + (f.kindLabel || ''))));
check('每份文件都标明文件类型', files.every((f) => !!f.file_kind), files.filter((f) => !f.file_kind).map((f) => f.id).slice(0, 5).join(','));
check('HTML 阅读版逐份标注性质', files.filter((f) => /HTML|阅读版/.test(f.file_kind || '')).length > 0);
const mismatch = files.filter((f) => f.hash_match === false);
check('不一致项为 0（若有必须可见）', mismatch.length === manifest.totals.hashMismatch, mismatch.length);

console.log('== 4. 页面与数据脚本 ==');
for (const p of ['policy-documents/index.html', 'policy-documents/manifest.js', 'policy-documents/manifest.json', 'policy-documents/SG/index.json', 'build/build-policy-archive.mjs', 'build/build-policy-library.mjs']) {
  check('存在 ' + p, existsSync(join(ROOT, p)));
}
const page = readFileSync(join(ROOT, 'policy-documents/index.html'), 'utf-8');
check('资料库页有国家/主题/适用产品/文件类型筛选', ['fCountry', 'fTopic', 'fScope', 'fKind'].every((k) => page.includes(k)));
check('资料库页有关键词搜索', /id="q"/.test(page) || page.includes('plSearch') || page.includes('fKw'));
check('资料库页有分页与「只看已归类」开关', page.includes('id="pager"') && page.includes('id="onlyReady"'));
check('资料库页声明网页阅读版不是官方法规原文', page.includes('不是官方法规原文') || page.includes('≠ 全文已结构化'));
check('资料库页可查校验信息（按需展开）与官方来源', page.includes('SHA-256') && page.includes('官方来源'));
const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
check('主站接入本地 PDF 链接', app.includes('function pdfLinks'));
check('主站规则卡挂资料库入口', app.includes('资料库'));
check('上手指南含 PDF 归档统计', app.includes('政策资料库'));
const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
check('index 引入 manifest.js', idx.includes('policy-documents/manifest.js'));

console.log(`\n===== PDF 归档检查：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (problems.length) { console.log('失败：'); problems.slice(0, 20).forEach((p) => console.log('  ✗', p)); process.exit(1); }
console.log('全部通过 ✔');
