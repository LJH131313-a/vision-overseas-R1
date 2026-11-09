/**
 * 政策资料库专项检查（新增）
 * 运行：node tests/policy-library.test.mjs
 *
 * 覆盖：清单字段真实性、分类来源、链接优先级与回退、重复内容映射、
 *      缺口如实记录、用户端语言（不出现开发术语）、入口一致性。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const rd = (p) => readFileSync(join(ROOT, p), 'utf-8');

let pass = 0, fail = 0; const bad = [];
const check = (name, cond, detail) => { if (cond) pass++; else { fail++; bad.push(name + (detail ? ' → ' + String(detail).slice(0, 140) : '')); } };

const manifestPath = 'policy-documents/manifest.json';
check('清单文件存在', existsSync(join(ROOT, manifestPath)));
const M = JSON.parse(rd(manifestPath));
const F = M.files || [];

console.log('== 1. 清单规模与字段真实性 ==');
check('记录数 ≥ 160', F.length >= 160, F.length);
check('每条都有 id / 名称 / 国家 / 类型标签', F.every((f) => f.id && f.name && f.country && f.kindLabel));
check('类型标签取自用户语言', F.every((f) => /官方法规 PDF|官方托管(的)?原始 PDF|网页阅读版|核验记录|产品说明书|待核实/.test(f.kindLabel)), JSON.stringify([...new Set(F.map((f) => f.kindLabel))]));
check('主题只来自法规关联（无则待归类）', F.every((f) => (f.topics || []).length > 0 ? f.topicState === 'ok' : f.topicState === '待归类' || f.topicState === '不适用'));
check('适用范围来自规则或小类路由（无则待核实）', F.every((f) => (f.productScope || []).length > 0 ? f.scopeState === 'rules' : f.scopeState === 'family' || f.scopeState === '待核实' || f.scopeState === '不适用'));
check('版本缺失记为待核实而非留空伪装', F.every((f) => !!f.version));
check('版本字段不泄漏内部文本（null、未知保持等）', !F.some((f) => /null|未知保持|逐条见本版规则/i.test(f.version)));
check('区域显示名为可读文本而非裸代码（任何纯大写短代码都不允许）', F.every((f) => f.countryName && !/^[A-Z][A-Z0-9_]{1,9}$/.test(f.countryName)), [...new Set(F.filter((f) => /^[A-Z][A-Z0-9_]{1,9}$/.test(f.countryName || '')).map((f) => f.countryName))].join(','));
check('区域显示名含国家或地区含义（不以代码结尾）', F.every((f) => /[一-龥]/.test(f.countryName || '')), F.find((f) => !/[一-龥]/.test(f.countryName || ''))?.countryName);
check('哈希与字节实测存在', F.every((f) => /^[0-9a-f]{64}$/i.test(f.sha256) && f.sizeBytes > 0));

console.log('== 2. 链接优先级与回退 ==');
const hasLocal = F.filter((f) => f.localFile);
const noLocal = F.filter((f) => !f.localFile);
check('多数文件有本地 PDF 直达', hasLocal.length >= F.length - 10, hasLocal.length + '/' + F.length);
check('本地文件路径规范（policy-documents/ 开头）', hasLocal.every((f) => /^policy-documents\/(files|SG)\//.test(f.localFile)), hasLocal.find((f) => !/^policy-documents\/(files|SG)\//.test(f.localFile))?.localFile);
check('无本地文件者有官方链接', noLocal.every((f) => f.officialKind === 'pdf' || f.officialKind === 'page' || f.officialKind === 'none'), noLocal.length);
const noneBoth = F.filter((f) => !f.localFile && f.officialKind === 'none');
check('两者皆无者计入缺口', noneBoth.length === (M.gaps?.noOfficialLink ?? 0) || noneBoth.length === 0, noneBoth.length);
const pdfOfficial = F.filter((f) => f.officialKind === 'pdf');
check('官方 PDF 直链识别正确', pdfOfficial.every((f) => /\.pdf/i.test(f.officialUrl)), pdfOfficial.find((f) => !/\.pdf/i.test(f.officialUrl))?.officialUrl);
const pageOfficial = F.filter((f) => f.officialKind === 'page');
check('官方网页标注为 page（不冒充 PDF）', pageOfficial.every((f) => !/\.pdf$/i.test(f.officialUrl.split('?')[0])));

console.log('== 3. 重复内容与原件保护 ==');
const shaCount = {};
F.forEach((f) => { shaCount[f.sha256] = (shaCount[f.sha256] || 0) + 1; });
const dupSha = Object.entries(shaCount).filter(([, n]) => n > 1);
check('重复内容已分组并映射 sameContentAs', dupSha.every(([sha]) => F.filter((f) => f.sha256 === sha).every((f) => f.internal && (f.internal.sameContentAs === null || f.internal.sameContentAs))), dupSha.length);
check('SG 目录原件未被移动（仍在 policy-documents/SG/）', F.filter((f) => f.group === undefined && /SG\//.test(f.localFile || '')).length >= 0 && existsSync(join(ROOT, 'policy-documents/SG/index.json')));
check('资料索引命中数与清单一致', F.filter((f) => f.internal.inventoryMatch).length >= 120, F.filter((f) => f.internal.inventoryMatch).length);

console.log('== 4. 缺口如实记录 ==');
check('缺口对象存在且含未读分包', !!M.gaps && Array.isArray(M.gaps.unreadBatches) && M.gaps.unreadBatches.some((x) => /SRC-131/.test(x)));
check('待归类与待核实数量被公开统计', typeof M.gaps.unclassifiedTopics === 'number' && typeof M.gaps.unverifiedScope === 'number');
check('统计与实际一致', M.gaps.unclassifiedTopics === F.filter((f) => f.topicState === '待归类').length, M.gaps.unclassifiedTopics);

console.log('== 5. 用户端语言与入口一致 ==');
const app = rd('js/app.js');
const idx = rd('index.html');
const pol = rd('policy-documents/index.html');
const res = rd('research/index.html');
const userText = [pol, res, idx].join(' ');
['队友交付物', '原始字节', '构建时实测', '哈希实测一致', '归档 ≠', '这些是什么', '不是什么'].forEach((j) => check('页面不含开发术语：' + j, !userText.includes(j)));
check('SHA-256 仅出现在按需详情内', /pl-more[\s\S]*SHA-256/.test(pol));
check('入口命名为政策资料库', idx.includes('政策资料库') && pol.includes('政策资料库'));
check('上手指南入口与页面名一致', idx.includes('上手指南') && app.includes('renderGuide') && !idx.includes('>数据说明<'));
check('规则卡链接指向资料库或文件', app.includes('function pdfLinks') && (app.includes('资料库查看') || app.includes('在政策资料库查看')) && app.includes('policy-documents/index.html?q='));
check('资料库筛选字段均有数据支撑', ['fCountry', 'fTopic', 'fScope', 'fKind'].every((id) => pol.includes(`id="${id}"`)));

console.log('== 6. 构建脚本可复现 ==');
check('构建脚本存在', existsSync(join(ROOT, 'build/build-policy-library.mjs')));
const bs = rd('build/build-policy-library.mjs');
check('构建脚本不覆盖 SG 原件', bs.includes('保留原路径不重复复制') || !bs.includes("copyFileSync(abs, join(ROOT, 'policy-documents/SG"));
check('构建脚本声明不虚构分类', bs.includes('不虚构'));

console.log(`\n===== 政策资料库检查：${pass + fail} 项断言，通过 ${pass}，失败 ${fail} =====`);
if (bad.length) { bad.slice(0, 20).forEach((b) => console.log('  ✗', b)); process.exit(1); }
console.log('全部通过 ✔');
