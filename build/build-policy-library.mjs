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
/** 区域/协定代码的可读名称（无映射时保留代码，不猜测含义） */
const REGION_NAME = { UK: '英国（GB/NI 适用细分为待核实）', CN_AU: '中国—澳大利亚（协定项下）', CN_RCEP: '中国—RCEP（协定项下）', RCEP: 'RCEP 成员国', EAEU: '欧亚经济联盟', GCC: '海湾合作委员会', INT: '国际组织', PRODUCT: '产品资料', MISC: '待确认' };
const regionName = (code) => jurName[code] || REGION_NAME[code] || code;
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

/* ---------- 已入库归档索引：内容相同一律复用既有规范路径，不重复复制 ---------- */
/** 规范路径分档名与 main 归档一致：web / official / product-manuals / SG */
const GROUP_ALIAS = { sources: 'web', 'product-docs': 'product-manuals' };
const ARCHIVE_ROOT = join(ROOT, 'policy-documents');
const oldManifestPath = join(ARCHIVE_ROOT, 'manifest.json');
const oldFiles = existsSync(oldManifestPath) ? (J(oldManifestPath).files || []) : [];
const oldByPath = new Map(oldFiles.map((f) => [f.file || f.localFile, f]));
const archiveBySha = new Map();
(function indexArchive() {
  const walk = (dir, group) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p, group); continue; }
      if (!/\.pdf$/i.test(e.name)) continue;
      const rel = p.slice(ARCHIVE_ROOT.length + 1).split('\\').join('/');
      const buf = readFileSync(p);
      const sha = createHash('sha256').update(buf).digest('hex');
      if (!archiveBySha.has(sha)) {
        const old = oldByPath.get('policy-documents/' + rel) || oldByPath.get(rel) || {};
        archiveBySha.set(sha, { rel, group, size: buf.length, old });
      }
    }
  };
  walk(join(ARCHIVE_ROOT, 'files', 'web'), 'web');
  walk(join(ARCHIVE_ROOT, 'files', 'official'), 'official');
  walk(join(ARCHIVE_ROOT, 'files', 'product-manuals'), 'product-manuals');
  walk(join(ARCHIVE_ROOT, 'SG'), 'SG');
})();
log('已入库归档：', archiveBySha.size, '份唯一内容，继承核验字段', oldFiles.length, '条');

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

/** 版本字段清洗：内部占位与不可执行文本一律记「待核实」 */
function cleanVersion(v) {
  var t = String(v || '').trim();
  if (!t || /null|待核|未知|逐条见本版规则|未逐条/i.test(t)) return '待核实';
  return t.length > 120 ? t.slice(0, 118) + '…' : t;
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
  const fname = opts.filename || basename(absPath);
  const hit = archiveBySha.get(sha);
  const group = hit ? hit.group : (GROUP_ALIAS[opts.group] || opts.group);
  const rel = hit ? hit.rel : join('files', group, jur, fname).split('\\').join('/');
  if (!hit) {
    const dest = join(ROOT, 'policy-documents', rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (!existsSync(dest) || statSync(dest).size !== buf.length) copyFileSync(absPath, dest);
  }
  const old = (hit && hit.old) || {};
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
    countryName: regionName(jur),
    topics: topics.length ? topics : [],
    topicState: topics.length ? 'ok' : '待归类',
    productScope: scopeSubs.slice(0, 8),
    productScopeMore: Math.max(0, scopeSubs.length - 8),
    scopeByFamily: families,
    scopeState: scopeSubs.length ? 'rules' : (families.length ? 'family' : '待核实'),
    kind: kind.key,
    kindLabel: kind.label,
    version: cleanVersion(version),
    officialUrl,
    officialKind: isPdfLink ? 'pdf' : (officialUrl ? 'page' : 'none'),
    localFile: 'policy-documents/' + rel,
    sha256: sha,
    sizeBytes: buf.length,
    pages: rec.pdf_pages || (opts.pages || null),
    checkedAt: rec.checkedAt || old.checked_at || '',
    verification: rec.verification || old.verification || '',
    regulations: regs.length ? regs.map((r) => r.id) : (old.regulations || []),
    batch: inv ? inv.batch : null,
    internal: {
      recordedSha: old.recorded_sha256 || rec.pdf_sha256 || null,
      inventoryMatch: !!inv,
      probe: rec.probe || '',
      provenance: old.provenance || opts.provenance || ''
    }
  };
  const recordedSha = old.recorded_sha256 || rec.pdf_sha256 || null;
  Object.assign(e, {
    file: e.localFile,
    filename: basename(rel),
    group,
    jurisdiction: jur,
    title: old.title || e.name,
    official_url: old.official_url || officialUrl,
    file_kind: old.file_kind || [rec.pdfKind, rec.file_kind, inv && inv.format].filter(Boolean).join(' ') || '文件类型待核实',
    pages: old.pages != null ? old.pages : e.pages,
    size_bytes: e.sizeBytes,
    recorded_sha256: recordedSha,
    hash_match: recordedSha ? String(recordedSha).toLowerCase() === sha : null,
    published_date: old.published_date || '',
    effective_date: old.effective_date || '',
    provenance: e.internal.provenance
  });
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
      id: basename(d.path, '.pdf'),
      sourceId: sid,
      name: d.title || rec.title || basename(d.path),
      country: 'SG', countryName: '新加坡',
      topics: topics, topicState: topics.length ? 'ok' : '待归类',
      productScope: scopeSubs.slice(0, 8), productScopeMore: Math.max(0, scopeSubs.length - 8),
      scopeByFamily: [...(familiesBySource[sid] || [])].concat([...new Set(regs.map((r) => r.productFamily).filter(Boolean))]).slice(0, 4),
      scopeState: scopeSubs.length ? 'rules' : '待核实',
      kind: 'official', kindLabel: '官方法规 PDF',
      version: cleanVersion(d.version_marker),
      officialUrl, officialKind: /\.pdf$/i.test(officialUrl) ? 'pdf' : 'page',
      localFile: d.path, sha256: sha, sizeBytes: buf.length,
      pages: rec.pdf_pages || null, checkedAt: rec.checkedAt || '', verification: rec.verification || '',
      regulations: regs.length ? regs.map((r) => r.id) : ((oldByPath.get(d.path) || {}).regulations || []),
      batch: inv ? inv.batch : null,
      internal: { recordedSha: d.sha256, inventoryMatch: !!inv, probe: rec.probe || '', provenance: (oldByPath.get(d.path) || {}).provenance || '本分支已提交（SG 目录，原字节保留）' },
      file: d.path,
      filename: basename(d.path),
      group: 'SG',
      jurisdiction: 'SG',
      title: d.title || rec.title || basename(d.path),
      official_url: officialUrl,
      file_kind: (oldByPath.get(d.path) || {}).file_kind || '官方原始 PDF（SG 目录）',
      pages: rec.pdf_pages || null,
      size_bytes: buf.length,
      recorded_sha256: d.sha256 || null,
      hash_match: d.sha256 ? String(d.sha256).toLowerCase() === sha : null,
      published_date: (oldByPath.get(d.path) || {}).published_date || '',
      effective_date: d.version_marker || '',
      provenance: (oldByPath.get(d.path) || {}).provenance || 'SG 目录已提交原件'
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
const groups = {};
const uniquePaths = new Set();
const hashMismatch = entries.filter((e) => e.hash_match === false).length;
entries.forEach((e) => {
  groups[e.group] = (groups[e.group] || 0) + 1;
  uniquePaths.add(e.localFile);
});
const totalBytes = entries.reduce((a, e) => a + e.sizeBytes, 0);
const manifest = {
  schema: '2.1',
  builtAt: new Date().toISOString(),
  note: '每条记录对应资料库中的一个来源编号；同一文件内容（SHA-256 相同）只保留一份实体，多个来源编号共享同一路径。recorded_sha256 来自原始交付记录，hash_match=false 表示与记录不一致（需人工复核），null 表示原始未登记哈希。产品说明书属产品事实证据，不是法规原文。网页阅读版是官方网页正文的打印或抽取结果，不是官方法规原文。归档不等于全文已结构化，也不等于规则已接入或法规现行有效。',
  totals: {
    files: entries.length,
    uniqueFiles: uniquePaths.size,
    bytes: totalBytes,
    groups,
    hashMismatch,
    hashVerified: entries.filter((e) => e.hash_match !== null).length
  },
  jurisdictions: Object.entries(countries).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: regionName(code), files: n })),
  counts: {
    files: entries.length,
    uniqueFiles: uniquePaths.size,
    bytes: totalBytes,
    byKind: kinds,
    countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: regionName(code), files: n })),
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
