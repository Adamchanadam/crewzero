// 測試共用：放公司概覽樣本、用測試 AI 做認證
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Cookie 不按埠分隔；名稱必須由完整實體資料路徑得出，Windows 大小寫或 junction 都會歸到同一實例。
export function passCookieName(dataPath) {
  let real = path.resolve(String(dataPath));
  try { real = fs.realpathSync.native(real); } catch { }
  if (process.platform === 'win32') real = real.toLocaleLowerCase('en-US');
  return 'sos_pass_' + crypto.createHash('sha256').update(real).digest('hex').slice(0, 32);
}

// 用 fixtures 嘅樣本做公司概覽（等同 AI 已經擬好）
export function seedCompany(DATA, PROTO, file = 'sample-company-page.js') {
  const t = fs.readFileSync(path.join(PROTO, 'fixtures', file), 'utf8').replace(/^﻿/, '').trim()
    .replace(/^window\.STARTUP_OS_PAGE\s*=\s*/, '').replace(/;\s*$/, '');
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'company', 'page.json'), JSON.stringify(JSON.parse(t), null, 2));
}

// 經系統設定介面認證測試 AI；回傳最後狀態
export async function certify(BASE, host = 'test') {
  const origin = BASE.replace(/\/$/, '');
  const r = await fetch(origin + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ action: 'certify', host }) });
  if (r.status !== 202) throw new Error('certify start ' + r.status);
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const s = await (await fetch(origin + '/api/setup')).json();
    if (s.certify && s.certify.state !== 'running') return s;
  }
  throw new Error('certify timeout');
}

// 直接寫認證紀錄（同認證程式一樣嘅雜湊同版本），開機補做測試唔使先起伺服器
export async function certifyDirect(DATA, PROTO, adapterPath) {
  const { pathToFileURL } = await import('node:url');
  const lib = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
  const h = { ...JSON.parse(fs.readFileSync(adapterPath, 'utf8')), file: path.resolve(adapterPath) };
  h.id = h.id || 'test';
  fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'ledger', 'adapter-cert.json'), JSON.stringify({ host: h.file, label: h.label || h.name, certifiedAt: new Date().toISOString(), version: lib.version(h), argsHash: lib.hashHost(h), results: [] }));
}

/* ---------- 裝置通行證（設計 2026-10-31 第 3 節）：測試用兌換 ----------
   伺服器只喺測試／模擬／示範實例（SOS_DATA 指向獨立資料夾）先會喺 POST /api/pass/open 回應附上一次性連結；正實例永不回傳。
   pair(BASE)：等伺服器起到（/api/health），取連結、兌換，回傳 cookie 值（只喺測試程序記憶體）。
   usePass(BASE, cdp?)：配對一次（同一個伺服器重複叫會沿用），之後呢個測試程序所有去 BASE 嘅 fetch 自動帶 cookie；
   有傳 CDP 工具（openChrome 回傳嘅物件或者任何有 send 嘅物件）就同時將 cookie 放入無頭 Chrome。 */
const passes = new Map();
const originOf = b => String(b).replace(/\/+$/, '');
export async function pair(BASE) {
  const origin = originOf(BASE);
  let up = false;
  for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1000) })).ok; } catch { } if (!up) await sleep(250); }
  if (!up) throw new Error('伺服器未起：' + origin);
  const r = await fetch(origin + '/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk', noOpen: true }) });
  const j = await r.json();
  if (!r.ok || !j.link) throw new Error('測試實例未回傳一次性連結：' + r.status + ' ' + JSON.stringify(j));
  const x = await fetch(origin + j.link, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36 startup-os-test' } });
  const m = /^(sos_pass_[a-f0-9]{32})=([a-f0-9]{64})/.exec(x.headers.get('set-cookie') || '');
  if (x.status !== 302 || !m) throw new Error('兌換失敗：' + x.status);
  return { name: m[1], value: m[2] };
}
let patched = false;
function patchFetch() {
  if (patched) return; patched = true;
  const real = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    const m = /^(https?:\/\/[^/]+)/.exec(url);
    const v = m && passes.get(m[1]);
    if (v) {
      init = { ...(init || {}) };
      const h = new Headers(init.headers || (input && input.headers) || undefined);
      if (!h.has('cookie')) h.set('cookie', v.name + '=' + v.value);
      init.headers = h;
    }
    return real.call(globalThis, input, init);
  };
}
export async function usePass(BASE, cdp) {
  const origin = originOf(BASE);
  if (!passes.has(origin)) passes.set(origin, await pair(origin));
  patchFetch();
  if (cdp && typeof cdp.send === 'function') {
    try { await cdp.send('Network.enable'); } catch { }
    const v = passes.get(origin);
    await cdp.send('Network.setCookie', { name: v.name, value: v.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' });
  }
  return passes.get(origin).value;
}
export const passCookie = BASE => { const v = passes.get(originOf(BASE)); return v ? v.name + '=' + v.value : ''; };

/* ---------- 正實例（安裝測試：由安裝好嘅 ask.mjs 開、用自己嘅 data/）：冇測試鉤，測試自己扮「已配對嘅瀏覽器」 ----------
   做法同伺服器發證一模一樣：喺伺服器讀嘅通行證檔（用戶設定資料夾，按 rootId）寫入一個雜湊；通行證本身只喺測試程序記憶體。
   產品冇任何改動、冇任何旁路——能寫到呢個檔嘅人本來就能自己配對。只限一小時、測試完畢即刪。回傳清理函式。 */
// 本測試程序新建過嘅通行證檔／資料夾：多次 installPass 交錯清理時，最後一個清空嘅負責刪走
const testMadeFiles = new Set(), testMadeDirs = new Set();
export async function installPass(rootIdValue, BASE, dataPath) {
  const os = await import('node:os');
  const home = process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) : path.join(os.homedir(), '.config');
  const dir = path.join(home, 'startup-os', rootIdValue), file = path.join(dir, 'passes.json');
  const dirExisted = fs.existsSync(dir), fileExisted = fs.existsSync(file);
  const secret = crypto.randomBytes(32).toString('hex'), hash = crypto.createHash('sha256').update(secret).digest('hex'), now = new Date().toISOString();
  let j = null; try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
  if (!j || !Array.isArray(j.passes)) j = { format: 'startup-os.passes/0.1', passes: [] };
  j.passes.push({ id: hash.slice(0, 8), kind: 'browser', hash, name: '測試工具', state: 'paired', createdAt: now, lastUsedAt: now, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  if (!dirExisted) testMadeDirs.add(dir); if (!fileExisted) testMadeFiles.add(file);
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(j, null, 2));
  if (BASE) { passes.set(originOf(BASE), { name: passCookieName(dataPath || rootIdValue), value: secret }); patchFetch(); }
  // 只撤走本次加入的 hash；其他既有或並行新增的裝置一律保留。只有本次新建且清空才刪檔／資料夾。
  return () => {
    try {
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!current || !Array.isArray(current.passes)) return;
      const kept = current.passes.filter(p => p && p.hash !== hash);
      if (kept.length === current.passes.length) return;
      if (kept.length === 0 && testMadeFiles.has(file)) {
        fs.unlinkSync(file);
        if (testMadeDirs.has(dir) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } else fs.writeFileSync(file, JSON.stringify({ ...current, passes: kept }, null, 2));
    } catch { }
  };
}
