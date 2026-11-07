// 收件時處理附件與 Google 連結（0.40.0，唯一定義處）：Office 轉文字旁放 .md、Google 連結取回成附件、寫收件說明檔。
// 由 server.mjs 的 receiveNote 呼叫；重新讀取（reread）亦用同一套存檔規則。純 Node，不連外網除非呼叫者傳入 fetchImpl。
// 所有寫入的路徑都記入呼叫者給的 created[]，出錯時由呼叫者整批清掉（不留半寫入）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { officeKind, writeTextSidecar } from './office-text.mjs';
import { parseGoogleLink, findGoogleLinks, fetchGoogleLink } from './link-fetch.mjs';

const KIND_OF = { doc: 'google-doc', sheet: 'google-sheet', slides: 'google-slides' };
const pad = n => String(n).padStart(2, '0');

// 表單的連結欄（links）加文字內的 Google 連結，去重，最多 5 條；一般網頁連結不取回
export function collectLinks(text, extra) {
  const out = findGoogleLinks(String(text || ''));
  for (const u of Array.isArray(extra) ? extra : []) {
    const l = parseGoogleLink(typeof u === 'string' ? u : '');
    if (l && !out.some(x => x.kind === l.kind && x.id === l.id)) out.push(l);
  }
  return out.slice(0, 5);
}

function safeCopy(from, to, created) {
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
  created.push(to);
}

// 把取回結果（fetchGoogleLink 成功的 res）存進 dir：storedFor(取回的檔名) 給存檔名。回傳 { stored, text?, convert? }。
// 原件＋文字版：文字版存成 <原件>.md；試算表（只有 xlsx）經轉文字旁放 .md；只拿到文字版就把它當附件。
export function storeGoogle(res, { dir, storedFor, created }) {
  const original = res.files.find(f => f.role === 'original'), textFile = res.files.find(f => f.role === 'text');
  if (!original) {
    const f = textFile, stored = storedFor(f.name);
    safeCopy(f.path, path.join(dir, stored), created);
    return { stored };
  }
  const stored = storedFor(original.name), full = path.join(dir, stored);
  safeCopy(original.path, full, created);
  if (textFile) { const t = stored + '.md'; safeCopy(textFile.path, path.join(dir, t), created); return { stored, text: t }; }
  if (officeKind(stored)) {
    const r = writeTextSidecar(full);
    if (r.ok) { created.push(r.sidecar); return { stored, text: path.basename(r.sidecar), convert: 'ok' }; }
    return { stored, convert: r.reason };
  }
  return { stored };
}

// 收件處理：attachments 是 takeFiles 核對過的 [{ name, bytes }]；回傳 { records, meta }。
// records：[{ name, stored }]（上載的附件及取回的 Google 原件；文字版不在內）；meta：寫入說明檔的內容（可能是空的）。
// 不擋送出：Google 取回失敗只記入 meta.linkErrors。
export async function receiveAttachments({ id, type, base, metaName, attachments, text, links, inboxDir, fetchImpl, now = () => new Date(), created, source, maxFiles = 20, maxTotal = 50 * 1024 * 1024, perFile = 10 * 1024 * 1024 }) {
  const records = [], fileInfo = [], linkErrors = [];
  const prefix = n => (base ? base : `${id}-note-${type}-file-`) + `${pad(n)}-`;
  let total = 0;
  for (const f of attachments) {
    const stored = prefix(records.length + 1) + f.name, full = path.join(inboxDir, stored);
    fs.writeFileSync(full, f.bytes, { flag: 'wx' }); created.push(full);
    total += f.bytes.length;
    records.push({ name: f.name, stored, bytes: f.bytes.length });
    if (['docx', 'pptx', 'xlsx'].includes(officeKind(f.name))) {
      const r = writeTextSidecar(full);
      if (r.ok) { created.push(r.sidecar); fileInfo.push({ name: stored, text: path.basename(r.sidecar), convert: 'ok' }); }
      else fileInfo.push({ name: stored, convert: r.reason });
    }
  }
  const found = collectLinks(text, links);
  const results = await Promise.all(found.map(async link => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crewzero-g-'));
    try { return { link, res: await fetchGoogleLink(link, { destDir: tmp, fetchImpl, maxBytes: perFile, timeoutMs: 15000, now }), tmp }; }
    catch { return { link, res: { ok: false, kind: link.kind, url: link.url, reason: 'network' }, tmp }; }
  }));
  try {
    for (const { link, res } of results) {
      if (!res.ok) { linkErrors.push({ url: link.url, kind: KIND_OF[link.kind], reason: res.reason }); continue; }
      const bytes = res.files.reduce((n, f) => n + f.bytes, 0);
      if (records.length + 1 > maxFiles || total + bytes > maxTotal) { linkErrors.push({ url: link.url, kind: KIND_OF[link.kind], reason: 'too-big' }); continue; }
      total += bytes;
      const n = records.length + 1;
      const s = storeGoogle(res, { dir: inboxDir, created, storedFor: nm => prefix(n) + nm });
      records.push({ name: s.stored.slice(prefix(n).length), stored: s.stored, bytes });
      fileInfo.push({ name: s.stored, ...(s.text ? { text: s.text } : {}), url: res.url, readOn: res.readOn, kind: KIND_OF[link.kind], ...(s.convert ? { convert: s.convert } : {}) });
    }
  } finally {
    for (const r of results) { try { fs.rmSync(r.tmp, { recursive: true, force: true }); } catch { } }
  }
  const meta = { ...(source ? { source } : {}), fileInfo, linkErrors };
  if (source || fileInfo.length || linkErrors.length) {
    const p = path.join(inboxDir, metaName || `${id}-note-${type}-meta.json`);
    fs.writeFileSync(p, JSON.stringify(meta, null, 2), { flag: 'wx' }); created.push(p);
  }
  return { records, meta };
}

// 重新讀取一條 Google 連結：取回到暫存、存進 dir（與原快照同一資料夾，檔名加時間尾，舊快照保留）。
// 成功回 { ok: true, fresh: { file（只檔名）, text?（只檔名）, readOn }, created }；失敗回 { ok: false, reason } 且不留任何新檔。
export async function rereadLink({ url, dir, baseName, fetchImpl, now = () => new Date() }) {
  const link = parseGoogleLink(url);
  if (!link) return { ok: false, reason: 'not-found' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crewzero-g-')), created = [];
  try {
    const res = await fetchGoogleLink(link, { destDir: tmp, fetchImpl, maxBytes: 10 * 1024 * 1024, timeoutMs: 15000, now });
    if (!res.ok) return { ok: false, reason: res.reason };
    const d = now(), tail = `-r${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    try {
      const s = storeGoogle(res, { dir, created, storedFor: nm => baseName + tail + path.extname(nm) });
      return { ok: true, fresh: { file: s.stored, ...(s.text ? { text: s.text } : {}), readOn: res.readOn }, created };
    } catch {
      for (const p of created) { try { fs.rmSync(p, { force: true }); } catch { } }
      return { ok: false, reason: 'network' };
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } }
}
