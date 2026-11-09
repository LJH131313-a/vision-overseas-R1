/**
 * 远见·企业出海助手 R1 —— 第二版集成检查
 * 运行：node tests/r2-integration.test.mjs
 *
 * 覆盖：本地交付文件完整性（地图/PDF/研究页）、发布包不应包含的文件、
 *       独立 localStorage 键、雷达模块改造、研究数据完整性、政策归档哈希。
 * 注：交互级验证由 tests/dom-smoke.mjs（jsdom）承担；真实浏览器视觉验证未执行，见交付说明。
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; failures.push(name); console.log('  ✗', name, detail ? '→ ' + String(detail).slice(0, 200) : ''); }
}
function read(p) { return readFileSync(join(ROOT, p), 'utf-8'); }

console.log('== 1. 交付文件完整性 ==');
for (const f of [
  'index.html', 'favicon.svg', 'css/styles.css', 'js/app.js', 'js/engine.js',
  'modules/radar.html',
  'research/index.html', 'research/vacuum-research-models.json', 'research/中国品牌真空吸尘产品与出海研究.html',
  'policy-documents/index.html', 'policy-documents/SG/index.json', 'policy-documents/SG/README.md',
  'data/vo-data.js', 'data/news.js', 'data/research-models.js', 'data/policy-docs.js',
  'tests/engine.test.mjs', 'tests/tax-ui-regression.cjs', 'tests/dom-smoke.mjs', 'tests/static-assets.test.mjs',
  '.github/workflows/update-news.yml', '.github/workflows/deploy-pages.yml',
  'tools/collect_news.py',
]) {
  check(`存在 ${f}`, existsSync(join(ROOT, f)));
}
for (const d of ['policy-documents/SG', 'research', 'modules', 'data', 'js', 'css']) {
  check(`目录 ${d}`, statSync(join(ROOT, d)).isDirectory());
}

console.log('== 2. 发布包不应包含的文件 ==');
const banned = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.sqlite3?$|\.zip$|\.patch$|CHANGE\.patch/i.test(e.name) || e.name.startsWith('.')) {
      if (e.name !== '.gitignore' && e.name !== '.github') banned.push(p);
    }
  }
})(ROOT);
check('无 SQLite / 原始 ZIP / 补丁文件 / 密钥文件', banned.length === 0, banned.join(', '));

console.log('== 3. 独立 localStorage 键 ==');
const app = read('js/app.js');
check("LS_KEY 为 'vo-r1-workbench-v2'（不与原站冲突）", app.includes("var LS_KEY = 'vo-r1-workbench-v2';"));

console.log('== 4. 雷达模块改造 ==');
const radar = read('modules/radar.html');
check('不依赖 /api/news', !radar.includes('/api/news'));
check('不依赖 /api/refresh', !radar.includes('/api/refresh'));
check('读取 ../data/news.json（与主站同源）', radar.includes('../data/news.json'));
check('「重新读取快照」替代「立即更新」', radar.includes('重新读取快照'));
check('不宣称浏览器触发采集', !radar.includes('正在读取官方 RSS'));
check('含「加入当前项目」按钮', radar.includes('加入当前项目'));
check('postMessage radar-select', radar.includes("type:'radar-select'") || radar.includes('radar-select'));
check('动态文本 HTML 转义函数', radar.includes('const esc='));
check('链接带 noopener', radar.includes('rel="noopener"'));
check('近两年窗口', radar.includes('setFullYear(cutoff.getFullYear()-2)') || radar.includes('getFullYear()-2'));
check('每页 20 条分页', /page\)\*20|slice\(\(page-1\)\*20/.test(radar));
const appIdx = read('index.html');
check('主站嵌入 modules/radar.html iframe', appIdx.includes('modules/radar.html'));
check('主站保留原新闻视图（newsBody）', appIdx.includes('id="newsBody"'));
check('postMessage 三重校验（origin+source+URL 在快照中）', app.includes("ev.source !== frame.contentWindow") && app.includes('NEWS.items.find') && app.includes("ev.origin !== window.location.origin"));
check('用主站 newsId 写入 newsSelected', app.includes('newsId(hit)') && app.includes('p.newsSelected.push(id)'));

console.log('== 5. 研究档案数据 ==');
const models = JSON.parse(read('research/vacuum-research-models.json'));
check('16 个型号', models.length === 16, models.length);
const cats = {};
models.forEach((m) => { cats[m.cat] = (cats[m.cat] || 0) + 1; });
check('5 个结构类型全覆盖（cat2 杆式 4 款，其余各 3 款，共 16）', Object.keys(cats).length === 5 && Object.values(cats).reduce((a, b) => a + b, 0) === 16, JSON.stringify(cats));
check('型号含字段 evidence/specs/missing/interpret/hs/sources', models.every((m) => m.evidence && Array.isArray(m.specs) && m.missing && m.interpret && m.hs && Array.isArray(m.sources) && m.sources.length > 0));
check('研究页存在品牌/型号/地区搜索与类型筛选', read('research/index.html').includes('fKw') && read('research/index.html').includes('fCat'));
check('研究页保留全文入口', read('research/index.html').includes('中国品牌真空吸尘产品与出海研究.html'));
const rpage = read('research/index.html');
check('类型映射 1→C-VAC-001 … 5→C-VAC-005', rpage.includes("'C-VAC-001'") && rpage.includes("'C-VAC-005'") && rpage.includes("'C-VAC-002'") && rpage.includes("'C-VAC-003'") && rpage.includes("'C-VAC-004'"));
check('带入前确认提示（重置税费与事实）', rpage.includes('税费选择与相关事实将被重置'));
check('只载入品牌/型号/小类/地区（不猜参数）', rpage.includes('不猜测实际出口参数') && rpage.includes('充电电压不能当市电电压'));

console.log('== 6. 政策 PDF 归档 ==');
const idx = JSON.parse(read('policy-documents/SG/index.json'));
check('4 份 PDF 归档', idx.length === 4);
idx.forEach((d) => {
  const p = join(ROOT, d.path);
  const buf = readFileSync(p);
  const sha = createHash('sha256').update(buf).digest('hex');
  check(`${d.path.split('/').pop()} SHA-256 校验`, sha === d.sha256);
  check(`${d.path.split('/').pop()} 大小校验`, buf.length === d.size_bytes);
});
const pdocPage = read('policy-documents/index.html');
check('政策原文入口：可打开 PDF 与官方参考', pdocPage.includes('打开 PDF 原文') && pdocPage.includes('官方参考'));
check('归档 ≠ 已结构化/已生效 声明', pdocPage.includes('归档 ≠ 全文已结构化'));
check('首页导航含政策原文入口', appIdx.includes('policy-documents/index.html'));

console.log('== 7. 首页与第二版功能 ==');
check('首页封面标语', appIdx.includes('让每一款小家电，'));
check('开始项目 / 浏览研究 / 新闻雷达入口', appIdx.includes('btnHomeStart') && appIdx.includes('research/index.html') && appIdx.includes('btnHomeRadar'));
check('四步上手说明', appIdx.includes('四步上手说明'));
check('app.js 首页 tab 支持', app.includes("name === 'home'"));
check('researchEvidence 入 inputHash', app.includes('research: p.researchEvidence'));
check('researchEvidence 入千问任务', app.includes('产品研究档案证据（R1）'));
check('researchEvidence 入报告', app.includes('产品研究档案（R1 带入）'));
check('汇总文案统一「本模型已覆盖法定项目汇总」', app.includes('本模型已覆盖法定项目汇总') || app.includes('已覆盖法定项目汇总'));
check('工作流权限不含 administration', !read('.github/workflows/deploy-pages.yml').includes('administration'));
check('工作流 workflow_run 联动新闻采集', read('.github/workflows/deploy-pages.yml').includes('workflow_run'));
check('发布前跑 208+15+集成检查', read('.github/workflows/deploy-pages.yml').includes('engine.test.mjs') && read('.github/workflows/deploy-pages.yml').includes('tax-ui-regression.cjs') && read('.github/workflows/deploy-pages.yml').includes('r2-integration.test.mjs'));

console.log('== 8. 敏感信息 ==');
for (const f of ['index.html', 'js/app.js', 'modules/radar.html', 'research/index.html', 'policy-documents/index.html']) {
  const c = read(f);
  check(`${f} 无绝对路径`, !/[A-Za-z]:\\Users\\/.test(c) && !/\/Users\/ThinkPad/.test(c));
  check(`${f} 无硬编码密钥`, !/(api[_-]?key|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i.test(c));
}

console.log(`\n===== R1 集成检查：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (failures.length) { console.log('失败：', failures.join('；')); process.exit(1); }
console.log('全部通过 ✔');
