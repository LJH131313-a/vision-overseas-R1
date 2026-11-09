#!/usr/bin/env node
/**
 * 远见·企业出海助手 R1 —— 法规原文 PDF 全量归档构建
 *
 * 只读扫描原始交付物，把全部法规/说明书 PDF 原字节复制进 policy-documents/，
 * 并对每个文件实测 SHA-256 与大小，与原始记录值比对（不信任记录，实测为准）。
 *
 * 来源分组：
 *   web/<JUR>/SRC-xxx.pdf         正式项目 documents/regulations（148 份，含 HTML 阅读版与官方原件）
 *   official/<JUR>/SRC-xxx.pdf    任务三研究库补充的官方原始 PDF（5 份，原网页运行目录未收录）
 *   product-manuals/*.pdf         产品说明书样本（4 份，属产品证据，不是法规）
 *   SG/*.pdf                      zky 二次交付上传的新加坡法规原件（4 份，保留原路径与 index.json）
 *
 * 输出：policy-documents/files/<组>/<法域>/<文件名>
 *       policy-documents/manifest.json + manifest.js（window.VO_POLICY_FILES）
 * 运行：node build/build-policy-archive.mjs [原始交付根目录]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const INPUT_ROOT = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, '..', '..');
const QW = join(INPUT_ROOT, '千问', '千问');
const ZKY = join(INPUT_ROOT, '二次提交', 'zky');
const OUT = join(ROOT, 'policy-documents', 'files');
const log = (...a) => console.log('[pdf-archive]', ...a);

const J = (p) => JSON.parse(readFileSync(p, 'utf-8'));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

if (!existsSync(QW)) { console.error('未找到原始交付：' + QW); process.exit(1); }
mkdirSync(OUT, { recursive: true });

/* ---------- 元数据 ---------- */
const ds = J(join(QW, 'small-appliance-compliance/data/dataset.json'));
const wb = J(join(QW, 'small-appliance-compliance/data/task4/regulatory_web_bundle.json'));
const srcInfo = new Map();
wb.sources.forEach((s) => srcInfo.set(s.source_id, s));
ds.tables['来源状态全索引'].forEach((s) => {
  const cur = srcInfo.get(s.source_id) || {};
  srcInfo.set(s.source_id, Object.assign({}, cur, {
    source_id: s.source_id,
    jurisdiction: cur.jurisdiction || s.market || '',
    title: s.title || cur.title,
    url: cur.current_url || cur.original_url || s.url || '',
    pdf_kind: s.pdf_kind || cur.local_pdf_kind || '',
    verification_status: cur.verification_status || s.verification || '',
    checked_at: cur.checked_at || '',
    acquisition_status: s.acquisition_status || cur.url_probe_status || '',
    published_date: s.published_date || '', effective_date: s.effective_date || '',
  }));
});
const pdfMeta = new Map();
ds.tables['PDF文件关联'].forEach((r) => pdfMeta.set(r.source_id, r));
// 法规关联（source → regulations）
const regBySource = new Map();
ds.tables['法规来源关联_合并'].forEach((r) => {
  if (!regBySource.has(r.source_id)) regBySource.set(r.source_id, new Set());
  regBySource.get(r.source_id).add(r.regulation_id);
});
(wb.rules || []).forEach(() => {});

/* ---------- 收集与复制 ---------- */
const entries = [];
let copied = 0, bytes = 0;

function addFile(absPath, group, jur, filename, provenance, extra) {
  const buf = readFileSync(absPath);
  const sha = sha256(buf);
  const dest = join(OUT, group, jur || 'MISC', filename);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(absPath, dest);
  copied++; bytes += buf.length;
  const info = srcInfo.get(extra && extra.source_id) || {};
  const pm = pdfMeta.get(extra && extra.source_id);
  const rel = `policy-documents/files/${group}/${jur || 'MISC'}/${filename}`;
  const recorded = (pm && pm.pdf_sha256) || info.pdf_sha256 || '';
  entries.push({
    id: (extra && extra.source_id) || filename,
    file: rel,
    filename,
    group,                                  // web | official | product-manuals | SG
    jurisdiction: jur || info.jurisdiction || '',
    title: (extra && extra.title) || info.title || filename,
    official_url: (extra && extra.url) || info.url || '',
    file_kind: (extra && extra.file_kind) || info.pdf_kind || (pm && pm.pdf_type) || '未标注文件性质',
    pages: (extra && extra.pages) || (pm ? pm.pages : info.pdf_pages) || null,
    sha256: sha,
    size_bytes: buf.length,
    recorded_sha256: recorded || null,
    hash_match: recorded ? recorded === sha : null,   // null = 原始记录无哈希可比
    verification: info.verification_status || (extra && extra.verification) || '',
    checked_at: info.checked_at || '',
    published_date: info.published_date || '',
    effective_date: info.effective_date || '',
    regulations: extra && extra.source_id && regBySource.has(extra.source_id) ? [...regBySource.get(extra.source_id)] : [],
    provenance,
  });
}

/* 1) 正式项目 documents/regulations（148） */
const webDir = join(QW, 'small-appliance-compliance/documents/regulations');
readdirSync(webDir).filter((f) => /\.pdf$/i.test(f)).forEach((f) => {
  const sid = f.replace(/\.pdf$/i, '');
  const info = srcInfo.get(sid) || {};
  const pm = pdfMeta.get(sid);
  addFile(join(webDir, f), 'web', info.jurisdiction || 'MISC', f,
    '正式项目网页运行目录（documents/regulations）',
    { source_id: sid, pages: pm ? pm.pages : null });
});
log('web 组完成：', entries.length, '个');

/* 2) 任务三研究库官方原件（5） */
const offDir = join(QW, 'regulatory-sourcing-database/sources/official_pdf');
if (existsSync(offDir)) {
  readdirSync(offDir).filter((f) => /\.pdf$/i.test(f)).forEach((f) => {
    const sid = f.replace(/\.pdf$/i, '');
    const info = srcInfo.get(sid) || {};
    addFile(join(offDir, f), 'official', info.jurisdiction || 'MISC', f,
      '任务三研究库官方原始 PDF（原网页运行目录未收录，本次补入）', { source_id: sid });
  });
}

/* 3) 产品说明书样本（4，属产品证据非法规） */
const manDir = join(QW, 'sourcing-tool-evaluation/samples/products');
if (existsSync(manDir)) {
  readdirSync(manDir).filter((f) => /\.pdf$/i.test(f)).forEach((f) => {
    addFile(join(manDir, f), 'product-manuals', 'PRODUCT', f,
      '产品说明书样本（产品事实证据，不是法规原文）',
      { title: f, file_kind: '制造商官方说明书/宣传页（产品证据）', verification: '产品事实已核；不用于生成法定义务' });
  });
}

/* 4) zky 二次交付 SG 原件（4）：优先读已入库副本，其次读二次提交解压目录 */
const sgIdxCandidates = [join(ROOT, 'policy-documents/SG/index.json'), join(ZKY, 'policy-documents/SG/index.json')];
const sgIdxPath = sgIdxCandidates.find((p) => existsSync(p));
const sgBase = sgIdxPath ? dirname(sgIdxPath) : null;
const zkyIdx = sgIdxPath ? J(sgIdxPath) : [];
zkyIdx.forEach((d) => {
  const abs = resolve(sgBase, d.path.replace(/^policy-documents\/SG\//, ''));
  if (!existsSync(abs)) { log('缺文件', d.path); return; }
  const buf = readFileSync(abs);
  const sha = sha256(buf);
  entries.push({
    id: basename(d.path).replace(/\.pdf$/i, ''),
    file: d.path,                              // zky 已放在 policy-documents/SG/
    filename: basename(d.path),
    group: 'SG',
    jurisdiction: 'SG',
    title: d.title,
    official_url: d.official_reference,
    file_kind: '官方原始 PDF（用户上传，原字节保留）',
    pages: null,
    sha256: sha,
    size_bytes: buf.length,
    recorded_sha256: d.sha256,
    hash_match: d.sha256 === sha,
    verification: d.verification,
    checked_at: '', published_date: '', effective_date: d.version_marker,
    regulations: [],
    provenance: 'zky 二次交付（2026-11-08 上传）：' + d.provenance,
  });
});

/* ---------- 输出清单 ---------- */
const jurCount = {};
entries.forEach((e) => { jurCount[e.jurisdiction] = (jurCount[e.jurisdiction] || 0) + 1; });
const manifest = {
  schema: '1.0',
  builtAt: new Date().toISOString(),
  note: '全部文件为原字节复制；SHA-256 与大小为本次构建实测。recorded_sha256 来自原始交付记录，hash_match=false 表示与记录不一致（需人工复核），null 表示原始未登记哈希。产品说明书属产品事实证据，不是法规原文。归档不等于全文已结构化，也不等于规则已接入或法规现行有效。',
  totals: {
    files: entries.length,
    bytes,
    groups: entries.reduce((a, e) => { a[e.group] = (a[e.group] || 0) + 1; return a; }, {}),
    hashMismatch: entries.filter((e) => e.hash_match === false).length,
    hashVerified: entries.filter((e) => e.hash_match === true).length,
  },
  jurisdictions: Object.entries(jurCount).sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: (wb.jurisdictions.find((j) => j.jurisdiction_code === code) || {}).name_zh || code, files: n })),
  files: entries,
};
writeFileSync(join(ROOT, 'policy-documents/manifest.json'), JSON.stringify(manifest, null, 1), 'utf-8');
writeFileSync(join(ROOT, 'policy-documents/manifest.js'),
  '/*! 法规原文 PDF 全量清单（build/build-policy-archive.mjs 生成，SHA-256 为构建时实测） */\nwindow.VO_POLICY_FILES = ' + JSON.stringify(manifest) + ';\n', 'utf-8');
log(`完成：${entries.length} 个文件，${(bytes / 1048576).toFixed(1)} MB；哈希与记录一致 ${manifest.totals.hashVerified}，不一致 ${manifest.totals.hashMismatch}`);
if (manifest.totals.hashMismatch) {
  entries.filter((e) => e.hash_match === false).slice(0, 10).forEach((e) => log('  不一致：', e.id, e.filename));
}
