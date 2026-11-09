/**
 * 法规原文 PDF 归档完整性检查
 * 运行：node tests/policy-archive.test.mjs
 *
 * 校验：manifest 中每个文件确实存在于仓库、大小与 SHA-256 与清单一致（现场重算）、
 *      原始登记哈希比对结果如实、分组统计正确、页面与数据脚本齐备。
 * 目的：防止「只放了 4 份」「合并时把队友交付的文件漏掉」再次发生。
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

console.log('== 1. 清单规模 ==');
check('归档文件数 ≥ 160（148 网页运行 + 5 官方原件 + 4 SG + 4 说明书样本）', files.length >= 160, files.length);
check('totals.files 与实际一致', manifest.totals.files === files.length);
const groups = manifest.totals.groups || {};
check('web 组 148 份', groups.web === 148, groups.web);
check('official 组 5 份（研究库补充官方原件）', groups.official === 5, groups.official);
check('SG 组 4 份（zky 二次交付）', groups.SG === 4, groups.SG);
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
check('产品说明书标注为非法规', files.filter((f) => f.group === 'product-manuals').every((f) => /不是法规|产品事实证据|产品证据/.test(f.provenance + f.file_kind + f.verification)));
check('HTML 阅读版逐份标注性质', files.filter((f) => /HTML/.test(f.file_kind || '')).length > 0 && files.every((f) => !!f.file_kind));
const mismatch = files.filter((f) => f.hash_match === false);
check('不一致项为 0（若有必须可见）', mismatch.length === manifest.totals.hashMismatch, mismatch.length);

console.log('== 4. 页面与数据脚本 ==');
for (const p of ['policy-documents/index.html', 'policy-documents/manifest.js', 'policy-documents/manifest.json', 'policy-documents/SG/index.json', 'build/build-policy-archive.mjs']) {
  check('存在 ' + p, existsSync(join(ROOT, p)));
}
const page = readFileSync(join(ROOT, 'policy-documents/index.html'), 'utf-8');
check('归档页有法域/来源组/文件性质筛选', page.includes('fJur') && page.includes('fGroup') && page.includes('fKind'));
check('归档页有搜索与分页', page.includes('fKw') && page.includes('PAGE'));
check('归档页声明“归档≠已结构化≠已生效”', page.includes('≠ 全文已结构化'));
check('归档页展示哈希与官方来源', page.includes('SHA-256') && page.includes('官方来源'));
const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
check('主站接入本地 PDF 链接', app.includes('function pdfLinks') && app.includes('归档库'));
check('数据说明含 PDF 统计卡', app.includes('法规原文 PDF 归档'));
const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
check('index 引入 manifest.js', idx.includes('policy-documents/manifest.js'));

console.log(`\n===== PDF 归档检查：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (problems.length) { console.log('失败：'); problems.slice(0, 20).forEach((p) => console.log('  ✗', p)); process.exit(1); }
console.log('全部通过 ✔');
