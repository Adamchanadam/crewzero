// 收件時處理附件與 Google 連結（0.40.0，唯一定義處）：Office 轉文字旁放 .md、Google 連結取回成附件、寫收件說明檔。
// 由 server.mjs 的 receiveNote 呼叫；重新讀取（reread）亦用同一套存檔規則。純 Node，不連外網除非呼叫者傳入 fetchImpl。
// 所有寫入的路徑都記入呼叫者給的 created[]，出錯時由呼叫者整批清掉（不留半寫入）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { officeKind, writeTextSidecar } from './office-text.mjs';
import { parseGoogleLink, findGoogleLinks, fetchGoogleLink } from './link-fetch.mjs';

const KIND_OF = { doc: 'google-doc', sheet: 'google-sheet', slides: 'google-slides' };
const pad = n => String(n).padStart(2, '0');

// Office 轉文字（0.40.2）：在工作緒內做，不阻塞伺服器的其他請求；全程式同時最多 MAX_CONVERT 份，其餘排隊。
// 同一個檔案（本模組）既是主程式用的函式庫，也是工作緒的入口：工作緒只做一件事——轉一個檔、把結果（不含全文）傳回。
// 失敗（工作緒出錯、逾時）一律當「未能轉換」（corrupt），並刪掉可能寫了一半的文字版，不讓 AI 讀到半個檔。
const MAX_CONVERT = 2, CONVERT_TIMEOUT_MS = 60000;
if (!isMainThread && workerData && workerData.crewzeroOfficeJob) {
  const r = writeTextSidecar(workerData.file);
  parentPort.postMessage(r.ok ? { ok: true, kind: r.kind, sidecar: r.sidecar } : { ok: false, kind: r.kind, reason: r.reason });
}
export const convertStats = { max: 0, total: 0 };   // 測試用：同時轉換的最高份數、累計份數
let converting = 0;
const convertQueue = [];
function runConvertJob(file, timeoutMs) {
  return new Promise(resolve => {
    let done = false, w = null, timer = null;
    const finish = r => {
      if (done) return; done = true;
      clearTimeout(timer);
      // 失敗時先等工作緒真正停下，才刪文字版並回報：避免工作緒收尾時又把半個檔寫出來
      const after = () => { if (!r.ok) { try { fs.rmSync(file + '.md', { force: true }); } catch { } } resolve(r); };
      let t = null;
      if (w) { try { t = w.terminate(); } catch { } }
      if (r.ok) after(); else Promise.resolve(t).then(after, after);
    };
    try {
      w = new Worker(fileURLToPath(import.meta.url), { workerData: { crewzeroOfficeJob: true, file }, resourceLimits: { maxOldGenerationSizeMb: 768 } });
    } catch {
      // 開不到工作緒（極少見）：退回同步轉換，結果相同
      let r; try { r = writeTextSidecar(file); } catch { r = { ok: false, reason: 'corrupt' }; }
      return finish(r.ok ? { ok: true, kind: r.kind, sidecar: r.sidecar } : { ok: false, kind: r.kind, reason: r.reason || 'corrupt' });
    }
    timer = setTimeout(() => finish({ ok: false, reason: 'corrupt' }), timeoutMs);
    w.once('message', m => finish(m && m.ok ? m : { ok: false, kind: m && m.kind, reason: (m && m.reason) || 'corrupt' }));
    w.once('error', () => finish({ ok: false, reason: 'corrupt' }));
    w.once('exit', () => setTimeout(() => finish({ ok: false, reason: 'corrupt' }), 100));
  });
}
function pumpConvert() {
  while (converting < MAX_CONVERT && convertQueue.length) {
    const job = convertQueue.shift();
    converting++; convertStats.total++; convertStats.max = Math.max(convertStats.max, converting);
    runConvertJob(job.file, job.timeoutMs).then(r => { converting--; job.resolve(r); pumpConvert(); });
  }
}
// 轉換一個 Office 檔：回傳 { ok: true, sidecar } 或 { ok: false, reason }（與 writeTextSidecar 同一組 reason）。永不丟例外。
export function convertOffice(file, { timeoutMs = CONVERT_TIMEOUT_MS } = {}) {
  return new Promise(resolve => { convertQueue.push({ file, timeoutMs, resolve }); pumpConvert(); });
}

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
export async function storeGoogle(res, { dir, storedFor, created }) {
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
    const r = await convertOffice(full);
    if (r.ok) { created.push(r.sidecar); return { stored, text: path.basename(r.sidecar), convert: 'ok' }; }
    return { stored, convert: r.reason };
  }
  return { stored };
}

// 收件處理：attachments 是 takeFiles 核對過的 [{ name, bytes }]；回傳 { records, meta }。
// records：[{ name, stored }]（上載的附件及取回的 Google 原件；文字版不在內）；meta：寫入說明檔的內容（可能是空的）。
// 不擋送出：Google 取回失敗只記入 meta.linkErrors。
export async function receiveAttachments({ id, type, base, metaName, attachments, text, links, inboxDir, fetchImpl, now = () => new Date(), created, source, maxFiles = 20, maxTotal = 50 * 1024 * 1024, perFile = 10 * 1024 * 1024 }) {
  const records = [], fileInfo = [], linkErrors = [], jobs = [];
  const prefix = n => (base ? base : `${id}-note-${type}-file-`) + `${pad(n)}-`;
  let total = 0;
  for (const f of attachments) {
    const stored = prefix(records.length + 1) + f.name, full = path.join(inboxDir, stored);
    fs.writeFileSync(full, f.bytes, { flag: 'wx' }); created.push(full);
    total += f.bytes.length;
    records.push({ name: f.name, stored, bytes: f.bytes.length });
    if (['docx', 'pptx', 'xlsx'].includes(officeKind(f.name))) jobs.push({ stored, full });
  }
  // 全部排隊轉換（同時最多 MAX_CONVERT 份，不阻塞伺服器）；等全部完成才繼續，所以呼叫者寫筆記檔時文字版一定已完整或已記為未能轉換
  const settled = await Promise.all(jobs.map(j => convertOffice(j.full)));
  jobs.forEach((j, i) => {
    const r = settled[i];
    if (r.ok) { created.push(r.sidecar); fileInfo.push({ name: j.stored, text: path.basename(r.sidecar), convert: 'ok' }); }
    else fileInfo.push({ name: j.stored, convert: r.reason });
  });
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
      const s = await storeGoogle(res, { dir: inboxDir, created, storedFor: nm => prefix(n) + nm });
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
      const s = await storeGoogle(res, { dir, created, storedFor: nm => baseName + tail + path.extname(nm) });
      return { ok: true, fresh: { file: s.stored, ...(s.text ? { text: s.text } : {}), readOn: res.readOn }, created };
    } catch {
      for (const p of created) { try { fs.rmSync(p, { force: true }); } catch { } }
      return { ok: false, reason: 'network' };
    }
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { } }
}
