/**
 * 第一版超集门禁 —— 防止“第二次合并把第一版覆盖掉”
 * 运行：node tests/v1-superset.test.mjs
 *
 * 规则：基线 commit 81604dc 中的每个文件必须存在于本仓库；
 * 每个文件的功能标记（函数名 / 元素 id / 选择器 / class / 文档标题 / JSON 键 / 工作流键）
 * 必须全部保留。第二版只允许在第一版基础上做加法。
 * 例外需在 EXCEPTIONS 中写明理由，且不得删除断言本身。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const base = JSON.parse(readFileSync(join(ROOT, 'tests/v1-baseline-markers.json'), 'utf-8'));

/* 明确豁免（每项必须写理由；仅允许“重命名后由新标记替代”，不允许功能消失） */
const EXCEPTIONS = {
  'index.html': {
    classes: {
      // 第一版静态写死 active 在第 1 步；第二版默认页为首页，active 由 JS 赋予，功能等价
      'active': '第二版默认显示首页，active 类由 showTab 动态添加（功能未消失）'
    }
  }
};

function markers(p, c) {
  const ext = extname(p), out = {};
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    out.functions = [...new Set([...c.matchAll(/function ([A-Za-z_][\w]*)\s*\(/g)].map((m) => m[1]))];
    out.ids = [...new Set([...c.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
    out.selectors = [...new Set([...c.matchAll(/querySelector(?:All)?\('([^']+)'\)/g)].map((m) => m[1]))];
  } else if (ext === '.html') {
    out.ids = [...new Set([...c.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))];
    out.classes = [...new Set([...c.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean))];
  } else if (ext === '.md') {
    out.headings = [...new Set([...c.matchAll(/^#{1,4} (.+)$/gm)].map((m) => m[1].trim()))];
  } else if (ext === '.json') {
    try { out.keys = Object.keys(JSON.parse(c)); } catch (e) { out.keys = []; }
  } else if (ext === '.yml') {
    out.keys = [...new Set([...c.matchAll(/^\s*([a-z_-]+):/gm)].map((m) => m[1]))];
  }
  return out;
}

let pass = 0, fail = 0, skipped = 0;
const problems = [];
function ok(name) { pass++; }
function bad(name, detail) { fail++; problems.push(name + ' → ' + detail); }

for (const [file, baseMarks] of Object.entries(base.files)) {
  const p = join(ROOT, file);
  if (!existsSync(p)) { bad('文件缺失 ' + file, '第一版有该文件'); continue; }
  ok('文件存在 ' + file);
  const cur = markers(file, readFileSync(p, 'utf-8'));
  const exc = EXCEPTIONS[file] || {};
  for (const [kind, list] of Object.entries(baseMarks)) {
    if (!list || !list.length) continue;
    const curSet = new Set(cur[kind] || []);
    const missing = list.filter((x) => !curSet.has(x));
    const allowed = (exc[kind] || {});
    const real = missing.filter((x) => !allowed[x]);
    const waived = missing.filter((x) => allowed[x]);
    skipped += waived.length;
    if (real.length) bad(`${file} [${kind}]`, '丢失 ' + real.slice(0, 10).join(', ') + (real.length > 10 ? ' …共' + real.length : ''));
    else ok(`${file} [${kind}] ${list.length} 项标记保留`);
  }
}

console.log(`\n===== 第一版超集门禁：通过 ${pass}，失败 ${fail}，豁免 ${skipped} =====`);
if (problems.length) {
  console.log('回归明细（第二版不得覆盖第一版功能）：');
  problems.slice(0, 30).forEach((p) => console.log('  ✗', p));
  process.exit(1);
}
console.log('第一版全部文件与功能标记在本仓库中保留 ✔');
