// 外部連結試開（純 Node 模組）：Zero 寫進產出（生意體檢、商機、紅藍對打、公司概覽等）的外部網址，
// 由 CrewZero 本機程式先試開一次；明確打不開（404／410／查無此主機）才標「連結未能開啟」，其餘一律不誤報。
// 本模組只負責：檢查網址 → 試開 → 回報 ok／broken／unknown。接入 run.mjs 及改寫產出文字不在此處。
// 安全邊界：只准 https；不收帳密；本機名稱、IP 直寫、DNS 解析結果任何一個屬私人／本機／保留網段都不發請求（每次轉址同樣重查）；
// 轉址手動處理、最多 3 次、不轉去 http；不帶 cookie；永不拋出例外。
// 已知限制：DNS 先查後連，fetch 自己會再解析一次，無法防範「兩次解析結果不同」的 DNS 重綁定；風險只限於多發一次 HEAD／GET，不讀取也不回傳內容。
import dns from 'node:dns';
import net from 'node:net';

const MAX_REDIRECTS = 3;
const MAX_LINKS = 20;
const CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_MS = 20000;
const UA = 'CrewZero';

const defaultLookup = (host, o) => dns.promises.lookup(host, o);

// 內部用：帶著最終結果的中止訊號（逾時、被擋、網絡錯誤等）
class Stop extends Error {
  constructor(result) { super('stop'); this.result = result; }
}
const TIMEOUT = { state: 'unknown', reason: 'timeout' };
const NOT_CHECKED = { state: 'unknown', reason: 'not-checked' };

// ---------- 私人／本機／保留網段 ----------
// server.mjs 的 privateIPv4 是檔內私有函式（且匯入 server.mjs 會啟動伺服器），不能 import，故在此自寫並涵蓋更多網段。

function blockedV4(o) {
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true; // 本網、私人、本機、多播及保留（含 255.255.255.255）
  if (a === 100 && b >= 64 && b <= 127) return true; // 共享位址空間 100.64.0.0/10
  if (a === 169 && b === 254) return true; // 鏈路本地（含雲端中繼資料 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return true;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true; // 測試用、基準測試網段
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

// 把 IPv6 文字轉成 8 個 16 位元組；格式不明回 null
function parseV6(text) {
  let s = String(text).toLowerCase();
  const z = s.indexOf('%');
  if (z >= 0) s = s.slice(0, z);
  const m = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (m) {
    const v = m.slice(1, 5).map(Number);
    if (v.some(n => n > 255)) return null;
    s = s.slice(0, m.index) + ((v[0] << 8) | v[1]).toString(16) + ':' + ((v[2] << 8) | v[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = part => (part === '' ? [] : part.split(':').map(h => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array(fill).fill(0), ...rest];
}

const v4Of = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

function blockedV6(g) {
  // IPv4 映射 ::ffff:a.b.c.d：看內嵌的 IPv4
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) return blockedV4(v4Of(g[6], g[7]));
  // NAT64 64:ff9b::/96：看內嵌的 IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) return blockedV4(v4Of(g[6], g[7]));
  // 其餘只放行全球單播 2000::/3；::、::1、fc00::/7、fe80::/10、ff00::/8 等都在此被擋
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2002) return blockedV4(v4Of(g[1], g[2])); // 6to4：看內嵌的 IPv4
  if (g[0] === 0x2001 && (g[1] < 0x200 || g[1] === 0xdb8)) return true; // Teredo、ORCHID、基準測試、文件用
  if (g[0] === 0x3fff && g[1] < 0x1000) return true; // 文件用
  return false;
}

// 位址是否屬私人／本機／保留（無法辨認一律當作是，寧可不查）
export function isBlockedAddress(addr) {
  const s = String(addr == null ? '' : addr).trim();
  if (net.isIPv4(s)) return blockedV4(s.split('.').map(Number));
  if (net.isIPv6(s)) {
    const g = parseV6(s);
    return g ? blockedV6(g) : true;
  }
  return true;
}

const LOCAL_SUFFIX = /(?:^|\.)(?:localhost|local|internal|lan|home|home\.arpa|localdomain)$/;

// 主機名（URL 解析後、已轉小寫）是否不該查：本機名稱、無點主機名、IP 直寫且屬私人網段
function hostBlocked(host) {
  const h = host.replace(/\.$/, '');
  if (!h) return true;
  if (h.startsWith('[')) return isBlockedAddress(h.slice(1, -1));
  if (net.isIPv4(h)) return isBlockedAddress(h);
  if (!h.includes('.')) return true;
  return LOCAL_SUFFIX.test(h);
}

const isLiteral = host => host.startsWith('[') || net.isIPv4(host.replace(/\.$/, ''));

// ---------- 小工具 ----------

const header = (res, name) => {
  try { return (res.headers && typeof res.headers.get === 'function' ? res.headers.get(name) : null) || ''; } catch { return ''; }
};
// 不等待讀完：直接放棄內容（連線即中止）
const drop = res => { try { if (res && res.body && typeof res.body.cancel === 'function') Promise.resolve(res.body.cancel()).catch(() => { }); } catch { } };
const errCode = e => String((e && (e.code || (e.cause && e.cause.code))) || '');
const TLS_CODE = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|HOSTNAME_MISMATCH/i;

function classify(status) {
  if ((status >= 200 && status < 300) || status === 304) return { state: 'ok', code: status };
  if (status === 404) return { state: 'broken', code: status, reason: 'not-found' };
  if (status === 410) return { state: 'broken', code: status, reason: 'gone' };
  return { state: 'unknown', code: status, reason: 'http-' + status };
}

// ---------- 檢查單條連結 ----------

// 回 { url, state: 'ok'|'broken'|'unknown', code?, reason? }；永不拋出例外。
// opts：fetchImpl、lookup（dns.lookup 的 all:true 形式）、timeoutMs（每條連結含全部轉址的總時限）。
export async function checkLink(url, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const shown = typeof url === 'string' ? url : '';
  const out = r => ({ url: shown, ...r });
  try {
    const fetchImpl = o.fetchImpl === undefined ? globalThis.fetch : o.fetchImpl;
    const lookup = o.lookup === undefined ? defaultLookup : o.lookup;
    if (typeof url !== 'string' || typeof fetchImpl !== 'function' || typeof lookup !== 'function') return out(NOT_CHECKED);
    let timeoutMs = Number.isFinite(o.timeoutMs) ? o.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (Number.isFinite(o.deadlineAt)) timeoutMs = Math.min(timeoutMs, o.deadlineAt - Date.now()); // checkLinks 的總時限
    let target;
    try { target = new URL(url.trim()); } catch { return out(NOT_CHECKED); }
    if (timeoutMs <= 0) return out(TIMEOUT);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const aborted = new Promise((_, reject) => ac.signal.addEventListener('abort', () => reject(new Stop(TIMEOUT)), { once: true }));
    aborted.catch(() => { });
    const guard = p => Promise.race([p, aborted]);

    // 每一跳（含起點）都要過：協定、帳密、主機名、DNS 解析結果。回 null＝可以請求。
    const gate = async (u, hop) => {
      if (u.protocol !== 'https:' || u.username || u.password) return hop ? { state: 'unknown', reason: 'blocked-redirect' } : NOT_CHECKED;
      const host = u.hostname.toLowerCase();
      if (hostBlocked(host)) return hop ? { state: 'unknown', reason: 'blocked-redirect' } : NOT_CHECKED;
      if (isLiteral(host)) return null;
      let found;
      try {
        found = await guard((async () => lookup(host.replace(/\.$/, ''), { all: true }))());
      } catch (e) {
        if (e instanceof Stop) throw e;
        if (ac.signal.aborted) throw new Stop(TIMEOUT);
        if (errCode(e) === 'ENOTFOUND') return { state: 'broken', reason: 'dns' };
        return { state: 'unknown', reason: 'dns' };
      }
      const addrs = (Array.isArray(found) ? found : [found]).map(a => (a && typeof a === 'object' ? a.address : a));
      if (!addrs.length) return { state: 'unknown', reason: 'dns' };
      if (addrs.some(isBlockedAddress)) return hop ? { state: 'unknown', reason: 'blocked-redirect' } : NOT_CHECKED;
      return null;
    };

    // 發一次請求；網絡錯誤以 { err } 回報，逾時則中止整條連結
    const send = async (u, method) => {
      try {
        const init = { method, redirect: 'manual', credentials: 'omit', headers: { 'User-Agent': UA }, signal: ac.signal };
        return { res: await guard((async () => fetchImpl(u.href, init))()) };
      } catch (e) {
        if (e instanceof Stop) throw e;
        if (ac.signal.aborted) throw new Stop(TIMEOUT);
        return { err: e };
      }
    };
    const netFail = e => (errCode(e) === 'ENOTFOUND' ? { state: 'broken', reason: 'dns' } : { state: 'unknown', reason: TLS_CODE.test(errCode(e)) ? 'tls' : 'network' });

    try {
      for (let hop = 0; ; hop++) {
        const blocked = await gate(target, hop);
        if (blocked) return out(blocked);

        let r = await send(target, 'HEAD');
        let useGet = false;
        if (r.err) {
          if (errCode(r.err) === 'ENOTFOUND') return out(netFail(r.err));
          useGet = true;
        } else {
          const st = Number(r.res.status);
          if (st === 405 || st === 501 || st === 403) { drop(r.res); useGet = true; }
        }
        if (useGet) {
          r = await send(target, 'GET');
          if (r.err) return out(netFail(r.err));
        }

        const res = r.res, st = Number(res.status);
        drop(res); // GET 只取狀態，內容不讀（連線即中止）
        if (st >= 300 && st < 400 && st !== 304) {
          const loc = header(res, 'location');
          if (!loc) return out({ state: 'unknown', code: st, reason: 'bad-redirect' });
          if (hop >= MAX_REDIRECTS) return out({ state: 'unknown', code: st, reason: 'too-many-redirects' });
          let next;
          try { next = new URL(loc, target); } catch { return out({ state: 'unknown', code: st, reason: 'blocked-redirect' }); }
          target = next;
          continue;
        }
        return out(classify(st));
      }
    } catch (e) {
      if (e instanceof Stop) return out(e.result);
      return out({ state: 'unknown', reason: 'network' });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return out({ state: 'unknown', reason: 'network' });
  }
}

// ---------- 檢查多條連結 ----------

// urls：字串陣列。去重後最多查 20 條（其餘回 unknown／over-limit）、同時最多 4 條、全部合計不超過 opts.totalMs（預設 20 秒）。
// 回 Map(url → 結果)，鍵順序同輸入；永不拋出例外。
export async function checkLinks(urls, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  try {
    const totalMs = Number.isFinite(o.totalMs) ? o.totalMs : DEFAULT_TOTAL_MS;
    const deadlineAt = Date.now() + totalMs;
    const list = [], seen = new Set();
    for (const u of Array.isArray(urls) ? urls : []) {
      if (typeof u !== 'string' || seen.has(u)) continue;
      seen.add(u);
      list.push(u);
    }
    const todo = list.slice(0, MAX_LINKS);
    const done = new Map();
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const u = todo[next++];
        done.set(u, await checkLink(u, { ...o, deadlineAt }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    return new Map(list.map(u => [u, done.get(u) || { url: u, state: 'unknown', reason: 'over-limit' }]));
  } catch {
    return new Map();
  }
}
