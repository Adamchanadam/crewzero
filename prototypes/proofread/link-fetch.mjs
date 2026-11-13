// Google 連結取回（純 Node 模組）：創辦人貼「知道連結的任何人可檢視」的 Google 文件／試算表／簡報連結，
// 由 CrewZero 本機程式（不是 AI 工具）經 Google 的匯出網址取回一份快照，存成附件，之後與一般附件同一條路。
// 本模組只負責：辨認網址 → 取回 → 存檔 → 回報結果。接入伺服器、試算表 XLSX 轉文字不在此處。
// 安全邊界：只組出 docs.google.com 的三類匯出網址（不照抄使用者網址）；轉址手動處理、最多 3 次、只准轉到 *.googleusercontent.com；
// 不帶 cookie 或任何登入資料；取回內容只核對檔頭，不執行、不解析；檔案只寫入 destDir 之內。
import fs from 'node:fs';
import path from 'node:path';
import { FILE_MAX_BYTES } from './limits.mjs';

const HOST = 'docs.google.com';
const ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;
const stdUrl = (seg, id, key) => 'https://' + HOST + '/' + seg + '/d/' + id + '/edit' + (key ? '?resourcekey=' + key : '');
const MAX_LINKS = 5;
const MAX_REDIRECTS = 3;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SEG_OF = { doc: 'document', sheet: 'spreadsheets', slides: 'presentation' };
const KIND_OF = { document: 'doc', spreadsheets: 'sheet', presentation: 'slides' };
const DEFAULT_TITLE = { doc: 'Google 文件', sheet: 'Google 試算表', slides: 'Google 簡報' };
// 匯出檔名常見的副檔名（顯示名去掉它們；不用通用規則，免得把「預算 v1.2」的 .2 當副檔名）
const EXPORT_EXTS = /\.(?:md|pdf|xlsx|txt|docx|pptx|csv|html|odt|ods|odp)$/i;
// Windows 保留裝置名：以它們作檔名會寫入裝置而不是檔案
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// ---------- 辨認網址 ----------

// 只接受 https://docs.google.com 的 document／spreadsheets／presentation 三類（可帶 /u/N/ 段、查詢字串、#gid）。
// 其他網域、http、帶帳號密碼、IP、不同連接埠、短 id、一般 Drive 檔（drive.google.com）一律回 null。
// url 回傳整理後的標準網址（不帶查詢字串及 #gid），用於顯示及記錄「原連結」。
export function parseGoogleLink(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (!s || s.length > 2048 || /[\s\x00-\x1f]/.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== HOST || u.username || u.password || u.port) return null;
  const m = /^\/(?:u\/\d+\/)?(document|spreadsheets|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  const kind = KIND_OF[m[1]], id = m[2];
  const rk = u.searchParams.get('resourcekey'); // 舊版連結的資源金鑰：值只限 [A-Za-z0-9_-]，其他查詢參數一律丟棄
  const resourceKey = rk && KEY_RE.test(rk) ? rk : '';
  return { kind, id, resourceKey, url: stdUrl(m[1], id, resourceKey) };
}

// 在一段文字內找出全部合規的 Google 連結（去重，最多 5 條）。
// 先抓「像網址」的連續字元（遇到中文、空白、引號等即斷開），去掉句尾標點，再逐條交給 parseGoogleLink 把關。
const URL_TOKEN = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
export function findGoogleLinks(text) {
  if (typeof text !== 'string') return [];
  const out = [], seen = new Set();
  for (const m of text.matchAll(URL_TOKEN)) {
    const link = parseGoogleLink(m[0].replace(/[.,;:!?)\]']+$/, ''));
    if (!link) continue;
    const key = link.kind + ':' + link.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(link);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

// ---------- 取回 ----------

class Fail extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

const isUserContent = host => host.endsWith('.googleusercontent.com') && host.length > '.googleusercontent.com'.length;
const textOk = ct => ct.startsWith('text/') && ct !== 'text/html';

// 每種類型要取的匯出：role original = 原件，text = 文字版；accept 核對內容類型，magic 核對檔頭
function plansOf(kind, id, key) {
  const base = 'https://' + HOST + '/' + SEG_OF[kind] + '/d/' + id;
  const q = fmt => base + '/export?format=' + fmt + (key ? '&resourcekey=' + key : ''); // 有資源金鑰就帶上
  const k = key ? '?resourcekey=' + key : '';
  if (kind === 'doc') return [
    { ext: 'md', role: 'text', url: q('md'), accept: textOk, magic: null },
    { ext: 'pdf', role: 'original', url: q('pdf'), accept: ct => ct === 'application/pdf', magic: '%PDF' },
  ];
  if (kind === 'sheet') return [
    { ext: 'xlsx', role: 'original', url: q('xlsx'), accept: ct => ct === XLSX_MIME || ct === 'application/octet-stream', magic: 'PK' },
  ];
  return [
    { ext: 'pdf', role: 'original', url: base + '/export/pdf' + k, accept: ct => ct === 'application/pdf', magic: '%PDF' },
    { ext: 'txt', role: 'text', url: base + '/export/txt' + k, accept: textOk, magic: null },
  ];
}

const header = (res, name) => {
  try { return (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null) || ''; } catch { return ''; }
};
const drop = async res => { try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch { } };

// 讀取回應內容，累計位元組，超過上限即中止（不寫任何檔，所以不會留下殘檔）
async function readCapped(res, maxBytes, guard) {
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader(), chunks = [];
    let total = 0;
    try {
      for (; ;) {
        const { done, value } = await guard(reader.read());
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Fail('too-big');
        chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      }
    } catch (e) {
      try { reader.cancel().catch(() => { }); } catch { }
      throw e;
    }
    return Buffer.concat(chunks);
  }
  if (typeof res.arrayBuffer !== 'function') return Buffer.alloc(0);
  const buf = Buffer.from(await guard(res.arrayBuffer()));
  if (buf.length > maxBytes) throw new Fail('too-big');
  return buf;
}

// 取回一個匯出網址：手動跟轉址，逐跳核對網域；總時限涵蓋連線及讀取內容
async function fetchExport(plan, o) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), o.timeoutMs);
  const aborted = new Promise((_, reject) => ac.signal.addEventListener('abort', () => reject(new Fail('timeout')), { once: true }));
  aborted.catch(() => { });
  const guard = p => Promise.race([p, aborted]);
  try {
    let target = new URL(plan.url);
    for (let hop = 0; ; hop++) {
      let res;
      try {
        res = await guard(o.fetchImpl(target.href, { method: 'GET', redirect: 'manual', credentials: 'omit', headers: { 'User-Agent': 'CrewZero' }, signal: ac.signal }));
      } catch (e) {
        if (e instanceof Fail) throw e;
        throw new Fail(ac.signal.aborted ? 'timeout' : 'network');
      }
      const st = Number(res.status);
      if (st >= 300 && st < 400) {
        await drop(res);
        const loc = header(res, 'location');
        if (!loc) throw new Fail('network');
        let next;
        try { next = new URL(loc, target); } catch { throw new Fail('blocked-redirect'); }
        if (next.protocol === 'https:' && next.hostname === 'accounts.google.com') throw new Fail('not-shared'); // 轉去登入頁＝未開放連結分享
        if (hop >= MAX_REDIRECTS) throw new Fail('blocked-redirect');
        if (next.protocol !== 'https:' || next.username || next.password || next.port || !isUserContent(next.hostname)) throw new Fail('blocked-redirect');
        target = next;
        continue;
      }
      if (st === 401 || st === 403) { await drop(res); throw new Fail('not-shared'); }
      if (st === 404) { await drop(res); throw new Fail('not-found'); }
      if (st !== 200) { await drop(res); throw new Fail('network'); }
      const cl = header(res, 'content-length').trim();
      if (/^\d+$/.test(cl) && Number(cl) > o.maxBytes) { await drop(res); throw new Fail('too-big'); }
      const ct = header(res, 'content-type').split(';')[0].trim().toLowerCase();
      if (!plan.accept(ct)) { await drop(res); throw new Fail('not-shared'); } // text/html（登入頁或錯誤頁）及其他不符的類型
      let buf;
      try { buf = await readCapped(res, o.maxBytes, guard); } catch (e) {
        if (e instanceof Fail) throw e;
        throw new Fail(ac.signal.aborted ? 'timeout' : 'network');
      }
      if (plan.magic && buf.subarray(0, plan.magic.length).toString('latin1') !== plan.magic) throw new Fail('not-shared');
      return { buf, disposition: header(res, 'content-disposition') };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 檔名及顯示名 ----------

// 取 Content-Disposition 的檔名：優先 filename*=UTF-8''…（百分比編碼），其次 filename="…"
function dispositionName(h) {
  if (!h) return '';
  let m = /(?:^|;)\s*filename\*\s*=\s*([^';]*)'[^';]*'([^;]+)/i.exec(h);
  if (m && /^utf-?8$/i.test(m[1].trim())) {
    try { return decodeURIComponent(m[2].trim().replace(/^"|"$/g, '')); } catch { /* 解碼失敗改用普通 filename */ }
  }
  m = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(h);
  if (!m) return '';
  let name = (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]).trim();
  // fetch 以 latin1 讀標頭：若實際是 UTF-8 位元組，還原一次（還原後沒有替代字元才採用）
  if (/[\x80-\xff]/.test(name) && !/[^\x00-\xff]/.test(name)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('�')) name = fixed;
  }
  return name;
}

// 顯示名：去掉副檔名、控制字元及 Unicode 格式字元（如 U+202E 文字方向反轉、U+200B 零寬空格），空白收攏
function displayTitle(h) {
  const t = dispositionName(h).replace(EXPORT_EXTS, '').replace(/[\x00-\x1f\x7f]|\p{Cf}/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, 120).join('');
}

// 存檔基本名：與伺服器附件清洗同規則（只留字母、數字、. _ -，其餘轉 _），另去掉開頭及結尾的點、避開 Windows 保留名，上限 70 字
function fileBase(title) {
  let b = title.replace(/\p{Cf}/gu, '').replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '').replace(/\.+$/, '');
  b = Array.from(b).slice(0, 70).join('');
  if (!b) b = 'Google';
  if (RESERVED.test(b)) b = '_' + b;
  return b;
}

// 只在 destDir 內建檔；同名加 -2、-3。寫前核對結果仍在 destDir 之內
function writeUnique(dir, base, ext, buf) {
  const root = path.resolve(dir);
  for (let n = 1; n < 1000; n++) {
    const name = base + (n > 1 ? '-' + n : '') + '.' + ext;
    const full = path.resolve(root, name);
    if (path.dirname(full) !== root) throw new Error('檔案路徑超出存放資料夾');
    try {
      fs.writeFileSync(full, buf, { flag: 'wx' });
      return { name, path: full };
    } catch (e) {
      if (e && e.code === 'EEXIST') continue;
      throw e;
    }
  }
  throw new Error('同名檔案過多');
}

const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// 取回一條 Google 連結（link 為 parseGoogleLink 的結果）。
// 成功 { ok: true, kind, url, readOn, title, files: [{ name, path, bytes, role }] }；
// 失敗 { ok: false, kind, url, reason }，reason 只會是 not-shared／not-found／too-big／timeout／blocked-redirect／network。
// 同一連結的多個格式只要有一個成功即算成功；全部失敗則回報最先遇到的原因。
// 內容先讀入記憶體（每份不超過 maxBytes）並核對通過後才寫檔，所以失敗不會留下殘檔。
export async function fetchGoogleLink(link, opts = {}) {
  const { destDir, fetchImpl = globalThis.fetch, maxBytes = FILE_MAX_BYTES, timeoutMs = 30000, now = () => new Date() } = opts;
  if (!destDir || typeof destDir !== 'string') throw new TypeError('fetchGoogleLink 需要 destDir');
  const kind = link && link.kind, id = link && link.id;
  if (!SEG_OF[kind] || typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, kind: kind || null, url: (link && link.url) || '', reason: 'not-found' };
  const key = typeof link.resourceKey === 'string' && KEY_RE.test(link.resourceKey) ? link.resourceKey : ''; // 不信任傳入值，重新核對
  const url = stdUrl(SEG_OF[kind], id, key);
  if (typeof fetchImpl !== 'function') return { ok: false, kind, url, reason: 'network' };
  const o = { fetchImpl, maxBytes, timeoutMs };

  const got = [];
  let firstReason = '';
  for (const plan of plansOf(kind, id, key)) {
    try {
      const r = await fetchExport(plan, o);
      got.push({ plan, buf: r.buf, name: displayTitle(r.disposition) });
    } catch (e) {
      if (!firstReason) firstReason = e instanceof Fail ? e.reason : 'network';
    }
  }
  if (!got.length) return { ok: false, kind, url, reason: firstReason || 'network' };

  const title = (got.find(g => g.name) || {}).name || DEFAULT_TITLE[kind];
  const base = fileBase(title);
  const files = [];
  try {
    fs.mkdirSync(destDir, { recursive: true });
    for (const g of got) {
      const w = writeUnique(destDir, base, g.plan.ext, g.buf);
      files.push({ name: w.name, path: w.path, bytes: g.buf.length, role: g.plan.role });
    }
  } catch {
    for (const f of files) { try { fs.rmSync(f.path, { force: true }); } catch { } } // 寫到一半失敗：清掉本次已寫的檔
    return { ok: false, kind, url, reason: 'network' };
  }
  return { ok: true, kind, url, readOn: ymd(now()), title, files };
}
