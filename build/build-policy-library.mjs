#!/usr/bin/env node
/**
 * 政策资料库重建（接手开发分支用）
 *
 * 做三件事：
 *  1. 从用户本机资料库按原字节复制法规/说明书 PDF 到 policy-documents/files/（路径与 main 归档一致，便于日后合并去重）；
 *     原件只读，不修改、不重命名、不覆盖 policy-documents/SG/ 下已提交的 5 份。
 *  2. 逐份实测 SHA-256 与字节，建立重复内容映射（同哈希不同来源 ID 视为同一文件）。
 *  3. 用仓库中已有资料为每份文件生成用户可用的分类字段：国家/地区、政策主题、适用产品、
 *     文件类型、版本或日期、可用链接（本地 PDF → 官方 PDF → 官方网页）。
 *     没有资料支持的主题与适用范围一律标「待归类 / 待核实」，不虚构。
 *
 * 运行：node build/build-policy-library.mjs <用户资料根目录>
 * 输出：policy-documents/manifest.json、policy-documents/manifest.js、docs/POLICY-LIBRARY-BUILD.md
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SRC = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, '..', '..');
const OUT = join(ROOT, 'policy-documents', 'files');
const J = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const log = (...a) => console.log('[policy-library]', ...a);

/* ---------- 仓库数据 ---------- */
const D = J(join(ROOT, 'data/vo-data.json'));
const jurName = {};
D.jurisdictions.forEach((j) => { jurName[j.code] = j.name; });
const topicName = {};
D.topics.forEach((t) => { topicName[t.id] = t.name; });
const subName = {};
D.subcategories.forEach((s) => { subName[s.id] = s.name; });
const srcInfo = {};
D.sources.forEach((s) => { srcInfo[s.id] = s; });

/* source → 法规（主题、适用产品族、版本日期）：法规索引来源字段 + 原始交付的法规-来源关联表 */
const regsBySource = {};
const regById = {};
D.regulations.forEach((r) => { regById[r.id] = r; });
D.regulations.forEach((reg) => {
  (reg.sourceIds || []).forEach((sid) => {
    if (!(regsBySource[sid] || []).some((r) => r.id === reg.id)) (regsBySource[sid] = regsBySource[sid] || []).push(reg);
  });
});
(D.regSourceLinks || []).forEach((l) => {
  const reg = regById[l.regulation];
  if (!reg) return;
  (regsBySource[l.source] = regsBySource[l.source] || []);
  if (!regsBySource[l.source].some((r) => r.id === reg.id)) regsBySource[l.source].push(reg);
});
/* source → 规则 → 关联小类（适用产品的真实依据） */
const subsByRule = {};
D.productRuleLinks.forEach((l) => { (subsByRule[l.ruleId] = subsByRule[l.ruleId] || []).push(l.sub); });
const subsBySource = {};
D.rules.forEach((r) => {
  const subs = subsByRule[r.id] || [];
  (r.sourceIds || []).forEach((sid) => {
    const set = (subsBySource[sid] = subsBySource[sid] || new Set());
    subs.forEach((s) => set.add(s));
  });
});
(D.regSourceLinks || []).forEach((l) => {
  if (!l.rule) return;
  const subs = subsByRule[l.rule] || [];
  if (!subs.length) return;
  const set = (subsBySource[l.source] = subsBySource[l.source] || new Set());
  subs.forEach((s) => set.add(s));
});
/* source → 法规适用产品族（原始交付「法规与产品经营关联」真实字段） */
const familiesBySource = {};
(D.sourceScopeLinks || []).forEach((l) => {
  if (!l.family) return;
  (familiesBySource[l.source] = familiesBySource[l.source] || new Set()).add(l.family);
});

/* ---------- 资料索引 CSV（125 份）---------- */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
const invPath = join(ROOT, 'docs/policy-batches-inventory.csv');
const invBySha = {};
if (existsSync(invPath)) {
  const rows = parseCsv(readFileSync(invPath, 'utf8').replace(/^\uFEFF/, ''));
  const hdr = rows[0];
  const idx = (kw) => hdr.findIndex((h) => h.includes(kw));
  const iPath = idx('原始路径'), iBytes = idx('字节'), iCountry = idx('国家'), iTopic = idx('主题'),
    iSha = idx('SHA'), iFmt = idx('格式'), iOff = idx('官方来源'), iBatch = idx('压缩包');
  rows.slice(1).forEach((r) => {
    const sha = String(r[iSha] || '').trim().toLowerCase();
    if (!sha) return;
    invBySha[sha] = {
      batch: r[iBatch], sourcePath: r[iPath], bytes: Number(r[iBytes]), country: r[iCountry],
      topicLabel: r[iTopic], format: r[iFmt], official: r[iOff]
    };
  });
}
log('资料索引载入:', Object.keys(invBySha).length, '条');

/* ---------- 文件类型（用户语言，基于真实记录）---------- */
function userKind(rec, inv) {
  const raw = [rec && rec.pdfKind, rec && rec.file_kind, inv && inv.format].filter(Boolean).join(' ');
  if (/产品说明书|制造商/.test(raw)) return { key: 'manual', label: '产品说明书（产品资料，非法规）' };
  if (/核验卡/.test(raw)) return { key: 'card', label: '核验记录（非法规原文）' };
  if (/HTML|抽取|阅读版|打印/.test(raw)) return { key: 'reading', label: '网页阅读版（非官方原文 PDF）' };
  if (/官方托管原始/.test(raw)) return { key: 'hosted', label: '官方托管的原始 PDF' };
  if (/官方原始|原始 ?PDF|用户上传/.test(raw)) return { key: 'official', label: '官方法规 PDF' };
  return { key: 'unknown', label: '文件类型待核实' };
}

/* ---------- 收集与复制 ---------- */
mkdirSync(OUT, { recursive: true });
const entries = [];
const QW = join(SRC, '千问', '千问');

function register(absPath, opts) {
  if (!existsSync(absPath)) { log('缺文件：', absPath); return null; }
  const buf = readFileSync(absPath);
  const sha = createHash('sha256').update(buf).digest('hex');
  const sid = opts.sourceId || basename(absPath, '.pdf');
  const rec = srcInfo[sid] || {};
  const inv = invBySha[sha] || null;
  const jur = opts.jurisdiction || rec.jurisdiction || (inv && inv.country) || 'MISC';
  const destRel = join('files', opts.group, jur, opts.filename || basename(absPath));
  const dest = join(ROOT, 'policy-documents', destRel);
  if (!existsSync(dest)) { mkdirSync(dirname(dest), { recursive: true }); copyFileSync(absPath, dest); }
  const regs = regsBySource[sid] || [];
  const topics = [...new Set(regs.flatMap((r) => r.topics || []))].map((t) => topicName[t] || t);
  const scopeSubs = [...(subsBySource[sid] || [])].map((s) => subName[s] || s);
  const families = [...(familiesBySource[sid] || [])].concat([...new Set(regs.map((r) => r.productFamily).filter(Boolean))]).slice(0, 4);
  const kind = userKind(rec, inv);
  const officialUrl = (rec.url || (inv && inv.official) || (regs[0] && regs[0].officialUrl) || '').trim();
  const isPdfLink = /\.pdf(\?|$)/i.test(officialUrl);
  const version = [regs.map((r) => r.applicableDate || r.effectiveDate).filter((v) => v && !/待/.test(v))[0],
  inv && /Effective|生效/.test(inv.topicLabel || '') ? '' : '',
  rec.versionMarker, rec.effective_date, (regs[0] && regs[0].legalStatus) ? '' : '']
    .filter(Boolean)[0] || '';
  const e = {
    id: sid,
    name: opts.title || rec.title || (regs[0] && regs[0].name) || basename(absPath),
    country: jur,
    countryName: jurName[jur] || (jur === 'PRODUCT' ? '产品资料' : jur === 'MISC' ? '待确认' : jur),
    topics: topics.length ? topics : [],
    topicState: topics.length ? 'ok' : '待归类',
    productScope: scopeSubs.slice(0, 8),
    productScopeMore: Math.max(0, scopeSubs.length - 8),
    scopeByFamily: families,
    scopeState: scopeSubs.length ? 'rules' : (families.length ? 'family' : '待核实'),
    kind: kind.key,
    kindLabel: kind.label,
    version: version || '待核实',
    officialUrl,
    officialKind: isPdfLink ? 'pdf' : (officialUrl ? 'page' : 'none'),
    localFile: 'policy-documents/' + destRel.split('\\').join('/'),
    sha256: sha,
    sizeBytes: buf.length,
    pages: rec.pdf_pages || (opts.pages || null),
    checkedAt: rec.checkedAt || '',
    verification: rec.verification || '',
    regulations: regs.map((r) => r.id),
    batch: inv ? inv.batch : null,
    internal: {
      recordedSha: rec.pdf_sha256 || null,
      inventoryMatch: !!inv,
      probe: rec.probe || '',
      provenance: opts.provenance || ''
    }
  };
  entries.push(e);
  return e;
}

/* 1) 正式项目网页运行目录（148） */
const webDir = join(QW, 'small-appliance-compliance/documents/regulations');
let webCount = 0;
if (existsSync(webDir)) {
  readdirSync(webDir).filter((f) => /\.pdf$/i.test(f)).forEach((f) => {
    const p = register(join(webDir, f), { group: 'sources', sourceId: basename(f, '.pdf'), filename: f, provenance: '正式项目 documents/regulations' });
    if (p) webCount++;
  });
}
/* 2) 研究库官方原件（5） */
const offDir = join(QW, 'regulatory-sourcing-database/sources/official_pdf');
if (existsSync(offDir)) readdirSync(offDir).filter((f) => /\.pdf$/i.test(f)).forEach((f) => register(join(offDir, f), { group: 'official', sourceId: basename(f, '.pdf'), filename: f, provenance: '任务三研究库官方原件' }));
/* 3) 产品说明书样本（4） */
const manDir = join(QW, 'sourcing-tool-evaluation/samples/products');
if (existsSync(manDir)) readdirSync(manDir).filter((f) => /\.pdf$/i.test(f)).forEach((f) => {
  const e = register(join(manDir, f), { group: 'product-docs', jurisdiction: 'PRODUCT', filename: f, title: f, provenance: '产品说明书样本' });
  if (e) { e.kind = 'manual'; e.kindLabel = '产品说明书（产品资料，非法规）'; e.topicState = '不适用'; e.scopeState = '不适用'; }
});
/* 4) 已提交的 SG 法规原件（5，保留原路径不重复复制） */
const sgIdxPath = join(ROOT, 'policy-documents/SG/index.json');
if (existsSync(sgIdxPath)) {
  J(sgIdxPath).forEach((d) => {
    const abs = resolve(ROOT, d.path);
    if (!existsSync(abs)) return;
    const buf = readFileSync(abs);
    const sha = createHash('sha256').update(buf).digest('hex');
    const inv = invBySha[sha] || null;
    const sid = inv ? basename(inv.sourcePath, '.pdf') : basename(d.path, '.pdf');
    const rec = srcInfo[sid] || {};
    const regs = regsBySource[sid] || [];
    const topics = [...new Set(regs.flatMap((r) => r.topics || []))].map((t) => topicName[t] || t);
    const scopeSubs = [...(subsBySource[sid] || [])].map((s) => subName[s] || s);
    const officialUrl = (rec.url || d.official_reference || '').trim();
    entries.push({
      id: sid,
      name: d.title || rec.title || basename(d.path),
      country: 'SG', countryName: '新加坡',
      topics: topics, topicState: topics.length ? 'ok' : '待归类',
      productScope: scopeSubs.slice(0, 8), productScopeMore: Math.max(0, scopeSubs.length - 8),
      scopeByFamily: [...(familiesBySource[sid] || [])].concat([...new Set(regs.map((r) => r.productFamily).filter(Boolean))]).slice(0, 4),
      scopeState: scopeSubs.length ? 'rules' : '待核实',
      kind: 'official', kindLabel: '官方法规 PDF',
      version: d.version_marker || '待核实',
      officialUrl, officialKind: /\.pdf$/i.test(officialUrl) ? 'pdf' : 'page',
      localFile: d.path, sha256: sha, sizeBytes: buf.length,
      pages: rec.pdf_pages || null, checkedAt: rec.checkedAt || '', verification: rec.verification || '',
      regulations: regs.map((r) => r.id), batch: inv ? inv.batch : null,
      internal: { recordedSha: d.sha256, inventoryMatch: !!inv, probe: rec.probe || '', provenance: '本分支已提交（SG 目录，原字节保留）' }
    });
  });
}

/* ---------- 去重映射（同哈希不同记录）---------- */
const bySha = {};
entries.forEach((e) => { (bySha[e.sha256] = bySha[e.sha256] || []).push(e.id); });
const dupGroups = Object.entries(bySha).filter(([, ids]) => ids.length > 1).map(([sha, ids]) => ({ sha256: sha, ids }));
dupGroups.forEach((g) => {
  const primary = g.ids[0];
  entries.filter((e) => g.sha256 === e.sha256).forEach((e) => { e.internal.sameContentAs = primary === e.id ? null : primary; });
});

/* ---------- 汇总 ---------- */
const countries = {};
const kinds = {};
const topics = new Set();
entries.forEach((e) => {
  countries[e.country] = (countries[e.country] || 0) + 1;
  kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  e.topics.forEach((t) => topics.add(t));
});
const manifest = {
  schema: '2.0',
  builtAt: new Date().toISOString(),
  counts: {
    files: entries.length,
    bytes: entries.reduce((a, e) => a + e.sizeBytes, 0),
    byKind: kinds,
    countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: jurName[code] || code, files: n })),
    topics: [...topics].sort(),
    duplicateGroups: dupGroups.length
  },
  gaps: {
    unclassifiedTopics: entries.filter((e) => e.topicState === '待归类').length,
    unverifiedScope: entries.filter((e) => e.scopeState === '待核实').length,
    unknownKind: entries.filter((e) => e.kind === 'unknown').length,
    noOfficialLink: entries.filter((e) => e.officialKind === 'none').length,
    unreadBatches: ['SRC-131.zip（单文件超过 32 MiB 传输上限，未读取）']
  },
  files: entries
};
writeFileSync(join(ROOT, 'policy-documents/manifest.json'), JSON.stringify(manifest, null, 1), 'utf-8');
writeFileSync(join(ROOT, 'policy-documents/manifest.js'),
  '/*! 政策资料库清单（build/build-policy-library.mjs 生成） */\nwindow.VO_POLICY_LIBRARY = ' + JSON.stringify(manifest) + ';\n', 'utf-8');
log(`完成：${entries.length} 条记录，${(manifest.counts.bytes / 1048576).toFixed(1)} MB；类型 ${JSON.stringify(kinds)}`);
log('重复内容组:', dupGroups.length, '| 待归类主题:', manifest.gaps.unclassifiedTopics, '| 适用范围待核实:', manifest.gaps.unverifiedScope, '| 无官方链接:', manifest.gaps.noOfficialLink);

/* 开发文档：构建与校验记录 */
const md = [
  '# 政策资料库构建与校验记录（开发文档）',
  '',
  `生成：${manifest.builtAt}｜脚本：build/build-policy-library.mjs`,
  '',
  `- 记录 ${entries.length} 条，${(manifest.counts.bytes / 1048576).toFixed(1)} MB；逐份 SHA-256 与字节实测。`,
  `- 文件类型分布：${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join('；')}。`,
  `- 重复内容组 ${dupGroups.length} 个（同哈希不同来源 ID，已记 sameContentAs，不删除任何原件）。`,
  `- 与 docs/policy-batches-inventory.csv 匹配：${entries.filter((e) => e.internal.inventoryMatch).length} / 125 条索引命中。`,
  `- 主题待归类 ${manifest.gaps.unclassifiedTopics} 条；产品适用范围待核实 ${manifest.gaps.unverifiedScope} 条；无官方链接 ${manifest.gaps.noOfficialLink} 条。`,
  '',
  '## 缺口',
  '',
  '- SRC-131.zip：单文件超过 32 MiB 传输上限，未读取；需分包或其他授权方式。',
  '- 125 份分包索引不是资料库总数，仍有未知文件。',
  '- 网页运行目录中相当比例为官方 HTML 正文抽取阅读版，不是官方法规 PDF；页面已按类型区分。',
  '',
  '## 分类字段依据（不虚构）',
  '',
  '- 国家/地区：来源记录 jurisdiction，缺失时取资料索引国家列。',
  '- 政策主题：该来源被哪些法规引用（法规来源关联）→ 法规监管主题（13 项主题表）。',
  '- 适用产品：引用该来源的规则 → 产品小类路由（productRuleLinks）；无规则时退回法规「适用产品族」并标注来源类型。',
  '- 版本：法规索引适用/生效日期或 SG 目录版本标记；缺失记「待核实」。',
  '- 链接优先级：本地已归档 PDF → 官方 PDF 直链（URL 以 .pdf 结尾）→ 官方网页（标注「查看官方网页」）。',
  ''
].join('\n');
writeFileSync(join(ROOT, 'docs/POLICY-LIBRARY-BUILD.md'), md, 'utf-8');
log('开发文档已写 docs/POLICY-LIBRARY-BUILD.md');
