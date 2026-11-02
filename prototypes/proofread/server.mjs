// CrewZero Founder Desk：本機伺服器。由 AI 對話打開 Founder Desk（Claude Code /crewzero:desk、Codex $crewzero:desk、Antigravity /desk，即 ask.mjs --desk）或者 AI 出題時自動喺背景起，創辦人唔使理；「開始.cmd」只係技術後備。
// 只聽 127.0.0.1；只接受本頁送出嘅回覆（公司概覽、問題包），寫入 data/founder/replies/；收到即排隊叫外殼（run.mjs）。
// 伺服器唔直接開 AI；AI 一律由外殼（run.mjs、certify.mjs）按已認證嘅 AI 工具設定開。AI 寫唔到 founder 資料夾，所以叫唔醒自己。
// 裝置通行證（設計 2026-10-31 第 3 節）：所有讀公司資料同寫入嘅路由都要「通行證」cookie（HttpOnly、SameSite=Strict）；
// 通行證只會經伺服器自己打開嘅一次性連結進入創辦人嘅瀏覽器，AI 對話見唔到；伺服器任何檔案只存通行證嘅雜湊。
// 路由分三類：公開（/api/health、/api/probe、頁面殼同共用檔、/pass/<一次性>）；AI 可以叫嘅（POST /api/pass/open：只限回環位址、冇 Origin，
// 由 ask.mjs 叫，回應唔含連結）；其餘全部只限創辦人（要通行證），冇就 403 {error:'pass'}，乜都唔寫。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hosts, version, certified, cleanEnv, resolveCommand, preparedAdapter, restrictions } from './host-lib.mjs';
import { rhythmOf, dueSlot, nextRunAt, ymd } from './rhythm-lib.mjs';
import { provenanceOf, provenanceLine, unconfirmed, loadPrefills } from './prefill-lib.mjs';
import { NAMES, localIso, clockNow, isSim, writeJSON, readJSON, dataDirs, listPacks, loadPack, loadAnswers, readLog, rootId, legacyRootId, ownsServerPort as ownsPort, serverOwnership, INTAKE_QUESTIONS, BIZ_TYPES, intakeQuestions, bizTypeLabel, SERVER_VERSION, BASE_PORT as DEFAULT_PORT, parseFounderReply } from './ask-lib.mjs';
import { dashboardState, touchLastSeen, pendingTodo, guideCard, companyLogo, LOGO_EXTS } from './dash-lib.mjs';
import { listScenarios, loadScenario, listSessions, loadSession, startSession, say as practiceSay, undo as practiceUndo, finish as practiceFinish, stopAll as practiceStop } from './practice-lib.mjs';
import { TOPIC_TYPES, SEATS, LEVELS, formatFor, passesFor, listMatches, loadMatch, summaryOf, pendingMatches } from './debate-lib.mjs';
import { brainSource } from './brain-lib.mjs';
import { folderHash } from './folder-hash.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 模擬／測試資料夾一定要同預設 data/ 係兩個實體位置。path.resolve() 睇唔到 Windows
// 大小寫同 junction；realpath 失敗就唔開測試鉤，模擬模式更要拒絕啟動。
const DEFAULT_DATA = path.resolve(ROOT, 'data');
// 未存在嘅路徑：由最近一個已存在嘅上層取實體位置（解開 junction／大小寫），再接返其餘部分；唔會建任何資料夾
function physicalPath(value) {
  let p = path.resolve(String(value)); const rest = [];
  for (;;) {
    try {
      const real = path.join(fs.realpathSync.native(p), ...rest);
      return process.platform === 'win32' ? real.toLocaleLowerCase('en-US') : real;
    } catch {
      const up = path.dirname(p); if (up === p) return '';
      rest.unshift(path.basename(p)); p = up;
    }
  }
}
function samePhysicalPath(a, b) {
  const left = physicalPath(a), right = physicalPath(b);
  return left && right ? left === right : null;
}
const suppliedData = process.env.SOS_DATA ? path.resolve(process.env.SOS_DATA) : '';
const suppliedVsDefault = () => samePhysicalPath(suppliedData, DEFAULT_DATA);
const suppliedIsDefault = suppliedData ? suppliedVsDefault() : null;
if (process.env.SOS_SIM === '1' && (!suppliedData || suppliedIsDefault !== false)) { console.log('[CrewZero] 模擬實例一定要用可確認、獨立嘅資料夾，已停止'); process.exit(1); }
const DIR = dataDirs(ROOT);
// 預設由 4380 開始；撞埠就自動試下一個（最多十個），創辦人唔使理
const argPort = process.argv.indexOf('--port');
const BASE_PORT = argPort > 0 ? Number(process.argv[argPort + 1]) : DEFAULT_PORT;
let PORT = BASE_PORT;
const home = () => `http://127.0.0.1:${PORT}/`;
const ROOT_ID = rootId(DIR.data);
// 模擬實例：時間按模擬時鐘，排程由本伺服器嘅計時器按模擬時鐘觸發
const SIM = isSim();
const DESK_DIR = path.join(DIR.data, 'founder', 'desk');
// 認證屬邊一種：模擬用假 AI（SOS_ADAPTER 指住嘅設定）係假 AI，其餘係真 AI
const aiMode = c => c && (c.host === 'test' || (process.env.SOS_ADAPTER && path.resolve(String(c.host)) === path.resolve(process.env.SOS_ADAPTER))) ? 'fake' : 'real';
const SIM_FILE = path.join(DESK_DIR, 'sim.json'), CLOCK_FILE = path.join(DESK_DIR, 'sim-clock.json'), CERT_FILE = path.join(DIR.ledger, 'adapter-cert.json');
// 每次開伺服器都唔同：頁面用嚟知道「伺服器重新開過，頁面可能過時」
const INSTANCE = `${process.pid}-${Date.now()}`;
// 唔係創辦人真資料嘅實例（模擬、示範、測試）：SOS_DATA 指向獨立資料夾先算。正實例永遠唔會設 SOS_DATA。
// 只有呢類實例 POST /api/pass/open 先會喺回應附上一次性連結（畀零費用測試兌換）；正實例永不回傳。
const TEST_INSTANCE = SIM || (!!suppliedData && suppliedIsDefault === false);

/* ---------- 裝置通行證：只存雜湊 ----------
   正實例存喺用戶設定資料夾（Windows %LOCALAPPDATA%\startup-os\<rootId>\passes.json；macOS／Linux ~/.config/startup-os/<rootId>/passes.json；改名後位置不變，唔使重新配對），
   唔喺 data/ 入面；模擬／示範／測試實例存喺自己嘅 founder/desk/passes.json（唔污染用戶設定資料夾）。整個檔只有 SHA-256 雜湊、名稱同日期，
   讀得到硬碟嘅 AI 讀到都偽造唔到；通行證本身只喺創辦人瀏覽器嘅 HttpOnly cookie。30 日到期；系統設定頁可以撤銷。 */
// cookie 名帶資料夾識別碼：瀏覽器嘅 cookie 唔分埠，正實例、示範、模擬同時開都唔會互相蓋過對方嘅通行證
const PASS_DAYS = 30;
const PASS_COOKIE = 'sos_pass_' + crypto.createHash('sha256').update(physicalPath(DIR.data) || path.resolve(DIR.data)).digest('hex').slice(0, 32);
const PASS_FILE = TEST_INSTANCE ? path.join(DESK_DIR, 'passes.json')
  : path.join(process.platform === 'win32' ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')) : path.join(os.homedir(), '.config'), 'startup-os', ROOT_ID, 'passes.json');
const passHash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const realIso = () => localIso(new Date());
function loadPasses() {
  const j = readJSON(PASS_FILE, null);
  const now = Date.now();
  return (Array.isArray(j && j.passes) ? j.passes : []).filter(p => p && /^[a-f0-9]{64}$/.test(String(p.hash || '')) && new Date(p.expiresAt).getTime() > now && (!p.pendingExpiresAt || new Date(p.pendingExpiresAt).getTime() > now));
}
function savePasses(list) { fs.mkdirSync(path.dirname(PASS_FILE), { recursive: true }); writeJSON(PASS_FILE, { format: 'startup-os.passes/0.1', passes: list }); }
// 瀏覽器名（由 User-Agent 粗分，只作系統設定頁顯示）
function browserName(ua) {
  ua = String(ua || '');
  const b = /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Google Chrome' : /Safari\//.test(ua) ? 'Safari' : NAMES.ui.deviceBrowser;
  const o = /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b}（${o}）` : b;
}
// 發一張新通行證：回傳通行證本身（只會放入 Set-Cookie），檔案只記雜湊
function issuePass(req, kind = 'browser', state = 'paired') {
  const secret = crypto.randomBytes(32).toString('hex'), hash = passHash(secret), now = realIso();
  const list = loadPasses();
  const pass = { id: hash.slice(0, 8), kind, hash, name: browserName(req.headers['user-agent']), state, createdAt: now, lastUsedAt: now, expiresAt: new Date(Date.now() + PASS_DAYS * 86400000).toISOString() };
  if (state === 'pending') { pass.pendingExpiresAt = new Date(Date.now() + 5 * 60000).toISOString(); pass.confirmationCode = String(parseInt(hash.slice(0, 8), 16) % 10000).padStart(4, '0'); }
  list.push(pass);
  savePasses(list);
  return { secret, pass };
}
const passTouched = new Map();
// 請求有冇有效通行證：cookie 雜湊命中、已配對、未到期；最後使用時間最多每分鐘寫一次
function passFromCookie(req) {
  const m = new RegExp(`(?:^|;\\s*)${PASS_COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '');
  if (!m) return null;
  const hash = passHash(m[1]), list = loadPasses(), p = list.find(x => x.hash === hash && x.state === 'paired');
  return p ? { p, hash, list } : null;
}
function passOf(req) {
  const found = passFromCookie(req);
  if (!found) return null;
  const { p, hash, list } = found;
  if (!p) return null;
  if (Date.now() - (passTouched.get(hash) || 0) > 60000) { passTouched.set(hash, Date.now()); p.lastUsedAt = realIso(); try { savePasses(list); } catch { } }
  return p;
}
function pendingOf(req) {
  const m = new RegExp(`(?:^|;\\s*)${PASS_COOKIE}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie || '');
  if (!m) return null;
  const hash = passHash(m[1]);
  return loadPasses().find(x => x.hash === hash && x.state === 'pending') || null;
}
const deviceList = pass => loadPasses().map(p => ({ id: p.id, kind: p.kind, name: p.name, state: p.state, confirmationCode: p.state === 'pending' ? p.confirmationCode : undefined, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, expiresAt: p.expiresAt, pendingExpiresAt: p.pendingExpiresAt || '', current: !!pass && p.hash === pass.hash }));
function revokePass(id) {
  if (!/^[a-f0-9]{8}$/.test(String(id || ''))) return [400, { error: 'invalid' }];
  const list = loadPasses(), left = list.filter(p => p.id !== id);
  if (left.length === list.length) return [404, { error: 'not found', message: NAMES.ui.deviceGone }];
  savePasses(left); passTouched.clear();
  return [200, { ok: true }];
}
// 一次性連結：伺服器自己程序內產生，60 秒、只可用一次；由伺服器自己交畀系統預設瀏覽器，唔會回傳畀叫佢嘅程式（測試實例除外）
const openTokens = new Map();
const PAGE_OK = /^(?:desk|dashboard|ask\/[\w-]{1,80})$/;
const pageUrl = page => page === 'dashboard' ? '/dashboard' : page.startsWith('ask/') ? '/#/' + page : '/';
function mintToken(page) {
  for (const [t, v] of openTokens) if (v.exp < Date.now()) openTokens.delete(t);
  const t = crypto.randomBytes(32).toString('hex');
  openTokens.set(t, { page, exp: Date.now() + 60000 });
  return t;
}
// 交畀系統預設瀏覽器；測試同無畫面環境（SOS_NO_OPEN）唔開
function launch(url) {
  if (process.env.SOS_NO_OPEN) return false;
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch { return false; }
}
let lastLaunchAt = 0;
// 打開一頁（由 /api/pass/open 同 --open 共用）：10 秒內最多開一次瀏覽器
function openPage(page, { noOpen = false } = {}) {
  const t = mintToken(page);
  let opened = false;
  if (!noOpen) {
    if (Date.now() - lastLaunchAt < 10000) { openTokens.delete(t); return [429, { error: 'busy', message: NAMES.ui.openTooSoon }]; }
    lastLaunchAt = Date.now();
    opened = launch(`${home()}pass/${t}`);
  }
  return [200, { ok: true, opened, ...(TEST_INSTANCE ? { link: '/pass/' + t } : {}) }];
}
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const privateIPv4 = a => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(String(a || '').replace(/^::ffff:/, ''));
const lanAddress = () => Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && privateIPv4(i.address))?.address || '';
let lanServer = null;
let phoneMode = null;
let phoneGeneration = 0;
const pairAttempts = new Map();
const lanSockets = new Set();
function phoneInfo() {
  if (!phoneMode) return { enabled: false };
  return { enabled: true, address: phoneMode.address, expiresAt: new Date(phoneMode.exp).toISOString(), pending: deviceList(null).filter(p => p.kind === 'phone' && p.state === 'pending'), paired: deviceList(null).filter(p => p.kind === 'phone' && p.state === 'paired') };
}
function pairAllowed(req) {
  const source = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const now = Date.now(), keep = (pairAttempts.get(source) || []).filter(t => now - t < 5 * 60000);
  if (keep.length >= 5) return false;
  keep.push(now); pairAttempts.set(source, keep); return true;
}
async function openPhoneMode() {
  const address = lanAddress();
  if (!address) return [409, { error: 'network', message: NAMES.ui.phoneNoPrivateNetwork }];
  if (lanServer && phoneMode && phoneMode.address === address) {
    // 未用、未過期嘅配對碼先沿用；用過（已清空）或過期就發新嘅
    const secret = phoneMode.secret && phoneMode.exp > Date.now() ? phoneMode.secret : crypto.randomBytes(32).toString('hex');
    // 沿用同一個秘密時，原本五分鐘到期不可被重開視窗延後。
    const exp = secret === phoneMode.secret ? phoneMode.exp : Date.now() + 5 * 60000;
    phoneMode = { ...phoneMode, secret, exp };
    return [200, { ok: true, ...phoneInfo(), pairUrl: `http://${address}:${PORT}/pair#${secret}` }];
  }
  if (lanServer) await new Promise(resolve => lanServer.close(resolve));
  phoneMode = { address, secret: crypto.randomBytes(32).toString('hex'), exp: Date.now() + 5 * 60000, generation: ++phoneGeneration };
  lanServer = http.createServer(handler);
  lanServer.on('connection', socket => { lanSockets.add(socket); socket.on('close', () => lanSockets.delete(socket)); });
  try {
    await new Promise((resolve, reject) => { lanServer.once('error', reject); lanServer.listen(PORT, address, resolve); });
  } catch (e) { try { lanServer.close(); } catch { } lanServer = null; phoneMode = null; return [500, { error: 'network', message: NAMES.ui.phoneOpenFailed }]; }
  return [200, { ok: true, ...phoneInfo(), pairUrl: `http://${address}:${PORT}/pair#${phoneMode.secret}` }];
}
async function closePhoneMode() {
  // 先即時撤銷權限，再有界地關閉 LAN 連線；半截 request 不可拖延撤銷。
  const closing = lanServer;
  lanServer = null; phoneMode = null; phoneGeneration++; pairAttempts.clear();
  savePasses(loadPasses().filter(p => p.kind !== 'phone')); passTouched.clear();
  if (closing) await new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(() => { for (const socket of lanSockets) try { socket.destroy(); } catch { } finish(); }, 1000);
    try { closing.close(finish); } catch { finish(); }
  });
  return [200, { ok: true, enabled: false }];
}
function decidePhone(id, accept) {
  if (!/^[a-f0-9]{8}$/.test(String(id || ''))) return [400, { error: 'invalid' }];
  const list = loadPasses(), pass = list.find(p => p.id === id && p.kind === 'phone' && p.state === 'pending');
  if (!pass) return [404, { error: 'not found', message: NAMES.ui.phoneGone }];
  if (accept) { pass.state = 'paired'; delete pass.pendingExpiresAt; delete pass.confirmationCode; pass.lastUsedAt = realIso(); savePasses(list); return [200, { ok: true }]; }
  savePasses(list.filter(p => p.id !== id)); return [200, { ok: true }];
}
// 403（通行證或來源）：網址帶認證探測 token（?t=）就記一行「<token> refused <方法> <路徑>」入 probe-hits.log，等認證程式知道 AI 試過而被拒
function refuse(req, res, url, why) {
  const t = url.searchParams.get('t') || '';
  // 認證只需要分辨讀／寫探測；其他被拒路徑一律用固定標識，尤其不能把一次性連結寫入日誌。
  const route = url.pathname === '/api/asks' || url.pathname === '/api/submit' ? url.pathname : /^\/pass\/[a-f0-9]{64}$/.test(url.pathname) ? '/pass/:token' : '/restricted';
  if (/^[a-f0-9]{36}$/.test(t)) { try { fs.mkdirSync(DESK_DIR, { recursive: true }); fs.appendFileSync(path.join(DESK_DIR, 'probe-hits.log'), `${t} refused ${req.method} ${route}\n`); } catch { } }
  return send(res, 403, { error: why });
}
// Founder Desk（首頁等你決定、問題包、決定紀錄）係 ask.html；公司概覽係 proofread.html
// 頁面同共用檔（名稱、版面、Markdown）：只准呢幾個檔，加共用檔就加入 SHARED
const SHARED = ['md.js', 'names.js', 'desk.js', 'orbit.js', 'pair.js'];
const FILES = { '/': 'ask.html', '/ask.html': 'ask.html', '/proofread.html': 'proofread.html', ...Object.fromEntries(SHARED.map(f => ['/' + f, f])) };
// 營運監察台：/dashboard（公司現況）、/dashboard/<分頁> 同 /dashboard/brain/<項目>，同一個頁面檔
const DASH_TABS = ['path', 'brain', 'inputs', 'team', 'log', 'system'];
const BRAIN_PAGES = ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'];
let lastSeenPrev = null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const KINDS = ['proofread', 'ask-answer'];

const pad = n => String(n).padStart(2, '0');
const fileStamp = (d = clockNow()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const say = msg => console.log(`[CrewZero ${new Date().toTimeString().slice(0, 8)}] ${msg}`);

/* ---------- AI 工具有冇裝 ---------- */
function onPath(cmd) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of ['', ...exts]) {
      try { if (dir && fs.statSync(path.join(dir, cmd + ext)).isFile()) return true; } catch { }
    }
  }
  return false;
}
let certChild = null, certStartedAt = '';
// 認證狀態：認證程式運行緊時只報今次嘅結果（舊結果當未開始），免得頁面一撳就見到上次嘅失敗
function certifyState() {
  const c = readJSON(path.join(DIR.ledger, 'certify-status.json'), null);
  if (!certChild) return c;
  if (c && String(c.startedAt || '') >= certStartedAt) return { ...c, state: 'running' };
  return { host: null, startedAt: certStartedAt, state: 'running', items: [] };
}
// AI 工具清單同版本：版本快取一分鐘。登入探測可能要網絡，絕不可在 HTTP 請求內 spawnSync；先交回上次結果／未知，再背景更新。
let hostCache = null;
const loginCache = new Map();
function loginState(h) {
  const lp = h.loginProbe;
  if (!lp || !Array.isArray(lp.args)) return null;
  const key = h.file || h.id, prior = loginCache.get(key), fresh = prior && Date.now() - prior.at < 60000;
  if (fresh || prior?.running) return prior?.value ?? null;
  const c = resolveCommand(h.command);
  if (c.why || !restrictions(h)) return null;
  const rec = { at: Date.now(), value: prior?.value ?? null, running: true };
  loginCache.set(key, rec);
  let child;
  const prepared = preparedAdapter(h);
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { cleaned = true; prepared.cleanup(); } };
  if (!prepared.handoff.ok) { cleanup(); loginCache.set(key, { at: Date.now(), value: false, running: false }); return false; }
  try {
    child = spawn(c.command, [...c.prefix, ...lp.args.map(String)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: prepared.env });
  } catch { cleanup(); loginCache.set(key, { at: Date.now(), value: false, running: false }); return false; }
  const timer = setTimeout(() => { try { child.kill(); } catch { } }, 15000);
  child.on('error', () => { clearTimeout(timer); cleanup(); loginCache.set(key, { at: Date.now(), value: false, running: false }); });
  child.on('close', code => { clearTimeout(timer); cleanup(); loginCache.set(key, { at: Date.now(), value: code === (Number.isInteger(lp.okExit) ? lp.okExit : 0), running: false }); });
  return rec.value;
}
function hostList() {
  const list = hostCache && Date.now() - hostCache.at < 60000 ? hostCache.list : hosts(ROOT).map(h => ({ h, version: version(h) }));
  if (!hostCache || list !== hostCache.list) hostCache = { at: Date.now(), list };
  return list.map(({ h, version: v }) => {
    const loggedIn = v ? loginState(h) : null;
    return { id: h.id, label: h.label || h.name || h.id, installed: !!v, version: v, loggedIn, why: v ? (loggedIn === false ? NAMES.ui.hostNotLoggedIn : '') : resolveCommand(h.command).why || '' };
  });
}
const certInfo = () => { const c = readJSON(path.join(DIR.ledger, 'adapter-cert.json'), null); return c ? { host: c.host, label: c.label, certifiedAt: c.certifiedAt } : null; };

/* ---------- 排隊：去抖、一次一個、做完見仲有就再做 ---------- */
let child = null, again = false, timer = null;
function schedule(ms = 1500) { clearTimeout(timer); timer = setTimeout(() => kick(), ms); }
// args：排程 run 嘅類型同觸發（模擬計時器用）；你送出後嘅 run 唔帶參數。一次只准一個外殼程序
function kick(args) {
  if (child) { again = true; return; }
  say(args ? '排定時間到，交外殼做日常工作' : '有新內容，交外殼處理');
  child = spawn(process.execPath, [path.join(ROOT, 'run.mjs'), ...(args || [])], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  child.on('exit', () => {
    child = null; simFiring = '';
    const last = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] }).runs[0];
    if (last) say(`處理完：${last.state === 'done' ? '完成' : last.state === 'failed' ? '失敗 - ' + (last.error || '') : last.state}`);
    if (again || pendingFiles().length || fs.existsSync(path.join(DIR.ledger, 'retry-requested')) || pendingMatches(DIR).length) { again = false; schedule(300); }
  });
}
// 模擬計時器：每 5 秒睇一次模擬時鐘；到咗排定時間（6 小時內）而嗰日未有排程 run 就叫外殼。你嘅回覆永遠排先
let simFiring = '';
function simTick() {
  if (!SIM || child || pendingFiles().length || fs.existsSync(path.join(DIR.ledger, 'retry-requested')) || pendingMatches(DIR).length) return;
  const s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}, slot = dueSlot(rhythmOf(s), clockNow());
  if (!slot) return;
  const day = ymd(slot);
  if (simFiring === day || (s.runs || []).some(r => r.trigger === 'schedule' && r.slot === day)) return;
  simFiring = day;
  kick(['--type', 'auto', '--trigger', 'schedule', '--slot', day]);
}
if (SIM) setInterval(simTick, 5000);
function simInfo() {
  if (!SIM) return null;
  const sim = readJSON(SIM_FILE, {}) || {}, c = readJSON(CERT_FILE, null), s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  const next = nextRunAt(rhythmOf(s), clockNow()), last = (s.runs || []).filter(r => r.trigger === 'schedule').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).pop();
  return { on: true, clock: localIso(clockNow()), offsetDays: Math.round(((readJSON(CLOCK_FILE, {}) || {}).offsetMs || 0) / 86400000 * 10) / 10,
    ai: c ? aiMode(c) : sim.ai || 'fake', aiReady: !!c, persona: sim.persona || null, nextRunAt: next ? localIso(next) : '', lastScheduleAt: last ? last.startedAt : '' };
}
// 推前一日：時鐘推到下一次排定開工時間後三分鐘（每日一次即剛好一日），由計時器觸發嗰次排程
function simAdvance() {
  if (child) return [409, { error: 'busy', message: 'AI 工作進行中，完成後再推前。' }];
  const now = clockNow(), next = nextRunAt(rhythmOf(readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}), now);
  if (!next) return [400, { error: 'invalid' }];
  fs.mkdirSync(DESK_DIR, { recursive: true });
  const off = Number((readJSON(CLOCK_FILE, {}) || {}).offsetMs) || 0;
  writeJSON(CLOCK_FILE, { offsetMs: off + (next.getTime() + 3 * 60000 - now.getTime()), at: new Date().toISOString() });
  return [200, { ok: true, clock: localIso(new Date(next.getTime() + 3 * 60000)) }];
}
// 模擬用 AI：假 AI（零費用）同真 AI 各自保存一份認證；切換只係換用邊份，冇就要喺系統設定頁認證一次
function simSetAI(mode) {
  if (!['fake', 'real'].includes(mode)) return [400, { error: 'invalid' }];
  if (child || certChild) return [409, { error: 'busy', message: 'AI 工作進行中，完成後再切換。' }];
  fs.mkdirSync(DESK_DIR, { recursive: true });
  const cur = readJSON(CERT_FILE, null);
  if (cur) fs.copyFileSync(CERT_FILE, path.join(DESK_DIR, 'sim-cert-' + aiMode(cur) + '.json'));
  const want = path.join(DESK_DIR, 'sim-cert-' + mode + '.json');
  if (fs.existsSync(want)) fs.copyFileSync(want, CERT_FILE); else fs.rmSync(CERT_FILE, { force: true });
  writeJSON(SIM_FILE, { ...(readJSON(SIM_FILE, {}) || {}), ai: mode });
  hostCache = null;
  return [200, { ok: true, ai: mode, ready: fs.existsSync(CERT_FILE) }];
}
const pendingFiles = () => [...fs.readdirSync(DIR.replies).filter(f => f.endsWith('.md')), ...fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md') || f.endsWith('-prefill.md') || /-note-(?:order|adhoc|help|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc)\.md$/.test(f))].sort();
const EXTS = ['md', 'txt', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg'];
const limits = { files: 20, fileMB: 10, totalMB: 50, exts: EXTS };
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
// 附件核對（交資料、真實事件證明共用）：回 { files } 或 { error }
function takeFiles(list) {
  if (list.length > 20) return { error: '附件最多 20 份，請移除部分文件後再送出。' };
  const files = []; let total = 0;
  for (const f of list) {
    const who = f && typeof f.name === 'string' && f.name ? '「' + f.name.slice(0, 80) + '」' : '其中一份附件';
    if (!f || typeof f.name !== 'string' || typeof f.data !== 'string' || !f.name || !B64.test(f.data)) return { error: who + '無法讀取，可能已損壞，請重新選擇。' };
    const ext = path.extname(f.name).slice(1).toLowerCase();
    if (!EXTS.includes(ext)) return { error: who + '的檔案類型未能接收，請另存為 PDF 或 Word 文件後再加入。' };
    const bytes = Buffer.from(f.data, 'base64'); total += bytes.length;
    if (bytes.length > 10 * 1024 * 1024) return { error: who + '太大，每份須在 10MB 以內。請改選較小的檔案，或把文件分拆後再加入。' };
    if (total > 50 * 1024 * 1024) return { error: '附件合共太大，須在 50MB 以內。請移除部分文件後再送出。' };
    files.push({ name: f.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 80), bytes });
  }
  return { files };
}

function receiveIntake(body) {
  const fail = message => ({ error: 'invalid', message });
  if (!body || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || !Array.isArray(body.files)) return fail('請填寫資料並檢查附件。');
  const bizType = typeof body.bizType === 'string' ? body.bizType : '';
  if (!bizType) return fail('請先選擇你的生意類別。');
  if (!BIZ_TYPES[bizType]) return fail('請選擇有效的生意類別。');
  const bizOther = typeof body.bizOther === 'string' ? body.bizOther.trim() : '';
  if (body.bizOther != null && typeof body.bizOther !== 'string') return fail('其他類別的說明必須是文字。');
  if (bizOther.length > 60) return fail('其他類別的說明不可超過 60 字。');
  const fields = {};
  for (const q of INTAKE_QUESTIONS) {
    const value = body.fields['q' + q.n] ?? '';
    if (typeof value !== 'string' || value.length > 4000 || (q.required && !value.trim())) return fail('請填寫首五條問題，每欄最多 4000 字。');
    fields['q' + q.n] = value;
  }
  if (Object.keys(body.fields).some(k => !/^q(?:[1-9]|1[0-2])$/.test(k)) || Buffer.byteLength(Object.values(fields).join(''), 'utf8') > 32 * 1024) return fail('填寫的文字太長，請把較長的內容改為文件附上，再送出。');
  const got = takeFiles(body.files);
  if (got.error) return fail(got.error);
  const files = got.files;
  const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
  const records = files.map((f, i) => ({ name: f.name, stored: `${id}-intake-${pad(i + 1)}-${f.name}`, bytes: f.bytes.length }));
  // 由文件預填（規劃書 3.1）：只喺答案同已核對嘅預填逐字一樣先記「你確認的文件原句」；同預填一樣嘅答案永遠唔記成「你寫的」
  const prefillId = /^[\w-]{1,40}$/.test(String(body.prefillId || '')) ? body.prefillId : '';
  const prefill = prefillId ? readJSON(path.join(DIR.ledger, 'prefill', prefillId + '.json'), null) : null;
  const provenance = provenanceOf(fields, body.provenance, loadPrefills(path.join(DIR.ledger, 'prefill'), prefillId));
  if (unconfirmed(provenance, body.provenance).length) return fail(NAMES.ui.prefillUnconfirmed);
  for (const q of Object.keys(provenance)) if (provenance[q].kind !== 'founder' && !provenance[q].moved) provenance[q].confirmed = true;
  const machine = { format: 'startup-os.intake/0.1', id, bizType, bizOther: bizType === 'other' ? bizOther : '', fields, files: records, ...(prefill ? { prefillId } : {}), provenance };
  const text = '# 交資料\n\n生意類別：' + bizTypeLabel(bizType, bizOther) + '\n\n' + intakeQuestions(bizType).map(q => `## ${q.n}. ${q.ask}\n\n${fields['q' + q.n]}\n${fields['q' + q.n].trim() ? '\n' + provenanceLine(provenance['q' + q.n]) + '\n' : ''}`).join('\n') + '\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n';
  const created = [];
  try {
    files.forEach((f, i) => { const p = path.join(DIR.inbox, records[i].stored); fs.writeFileSync(p, f.bytes, { flag: 'wx' }); created.push(p); });
    const p = path.join(DIR.inbox, `${id}-intake.md`); fs.writeFileSync(p, text, { flag: 'wx' }); created.push(p);
    writeJSON(path.join(DIR.company, 'biz.json'), { type: bizType, other: bizType === 'other' ? bizOther : '' });
  } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
  return { ok: true, id, receivedAt: localIso() };
}

/* ---------- 由文件預填（規劃書 3.1）：只有附件，唔含答案；AI 只讀文件交返五條預填，唔擬公司概覽、唔建任何紀錄 ---------- */
function receivePrefill(body) {
  const fail = message => ({ error: 'invalid', message });
  if (!Array.isArray(body.files) || !body.files.length) return fail('請先加入文件。');
  const got = takeFiles(body.files);
  if (got.error) return fail(got.error);
  const bizType = typeof body.bizType === 'string' && BIZ_TYPES[body.bizType] ? body.bizType : '';
  const bizOther = typeof body.bizOther === 'string' ? body.bizOther.trim().slice(0, 60) : '';
  const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
  const records = got.files.map((f, i) => ({ name: f.name, stored: `${id}-prefill-${pad(i + 1)}-${f.name}`, bytes: f.bytes.length }));
  const machine = { format: 'startup-os.prefill/0.1', id, files: records, ...(bizType ? { bizType, bizOther: bizType === 'other' ? bizOther : '' } : {}) };
  const created = [];
  try {
    got.files.forEach((f, i) => { const p = path.join(DIR.inbox, records[i].stored); fs.writeFileSync(p, f.bytes, { flag: 'wx' }); created.push(p); });
    const p = path.join(DIR.inbox, `${id}-prefill.md`); fs.writeFileSync(p, '# 由文件預填（只讀文件，不含答案）\n\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n', { flag: 'wx' }); created.push(p);
  } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
  return { ok: true, id, receivedAt: localIso() };
}
// 預填進度：外殼核對好嘅結果喺 ledger/prefill/<id>.json；未有就睇嗰次 AI 工作嘅狀態
function prefillStatus(id) {
  if (!/^[\w-]{1,40}$/.test(String(id || ''))) return null;
  const done = readJSON(path.join(DIR.ledger, 'prefill', id + '.json'), null);
  if (done) return { state: 'done', prefill: done };
  const run = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] }).runs.find(r => r.kind === 'prefill' && r.ref === id);
  if (fs.existsSync(path.join(DIR.inbox, id + '-prefill.md')) || (run && run.state === 'running')) return { state: 'running' };
  if (run) return { state: run.state === 'waiting' ? 'waiting' : 'failed', error: run.error || '' };
  return null;
}

/* ---------- 創辦人交要求（「我想改次序／加一站」「交一件臨時工作」）：寫入收件匣，交外殼叫 AI 擬成問題包 ---------- */
// 同交資料一樣只新增檔案，AI 寫唔到 founder 資料夾，所以 AI 冒充唔到創辦人嘅要求；真正改路線或開工要等創辦人答咗問題包先生效。
const NOTE_TYPES = ['order', 'adhoc', 'help', 'feedback', 'brain-decide', 'practice-prep', 'debrief', 'debate-start', 'debate-action', 'event', 'doc'];
const BRAIN_ITEMS = ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'];
const DEBATE_ACTIONS = ['respond', 'adopt', 'reattack2', 'rerun'];
function receiveNote(body) {
  const fail = message => ({ error: 'invalid', message });
  if (!NOTE_TYPES.includes(body.type)) return fail('要求類型不正確。');
  // 紅藍對打：開一場辯論（題目、席位、力度）；場次操作（回應、採用、再攻第二輪、重跑）。外殼按規則做，AI 唔可以自己開場
  if (body.type === 'debate-start' || body.type === 'debate-action') {
    let m;
    if (body.type === 'debate-start') {
      if (!TOPIC_TYPES.includes(body.topicType)) return fail('請選擇題目類型。');
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 120) return fail('請用一句寫題目（最多 120 字）。');
      const seats = Array.isArray(body.seats) ? [...new Set(body.seats.filter(s => typeof s === 'string').map(s => s.trim()).filter(s => s && s.length <= 20))] : [];
      if (seats.length < 2 || seats.length > 6) return fail('紅方席位須為二至六席。');
      m = { topicType: body.topicType, title, seats, level: LEVELS[body.level] ? body.level : 'normal', targetId: /^[\w-]{1,40}$/.test(String(body.targetId || '')) ? body.targetId : '' };
    } else {
      if (!/^[\w-]{1,40}$/.test(String(body.matchId || '')) || !DEBATE_ACTIONS.includes(body.action)) return fail('找不到此場辯論或操作。');
      m = { matchId: body.matchId, action: body.action };
    }
    const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
    fs.writeFileSync(path.join(DIR.inbox, `${id}-note-${body.type}.md`), `kind: note\ntype: ${body.type}\nat: ${localIso()}\n\n${m.title || m.action}\n\n\`\`\`json\n${JSON.stringify(m)}\n\`\`\`\n`, { flag: 'wx' });
    return { ok: true, id, receivedAt: localIso() };
  }
  // 生意大腦：結果卡意見（有用／沒有用／要修改）同「放上 Founder Desk 作答」；唔使公司概覽
  // 情景演練：為一個你要做嘅行動準備場景；會後紀錄（對方真係講咗乜、有冇承諾、跟進日期）
  if (body.type === 'practice-prep' || body.type === 'debrief') {
    const m = { taskId: /^[\w-]{1,60}$/.test(String(body.taskId || '')) ? body.taskId : '', scenarioId: /^[\w-]{1,60}$/.test(String(body.scenarioId || '')) ? body.scenarioId : '', sessionId: /^[\w-]{1,60}$/.test(String(body.sessionId || '')) ? body.sessionId : '' };
    const say = typeof body.text === 'string' ? body.text.trim() : '';
    if (say.length > 4000) return fail('最多 4000 字。');
    if (body.type === 'practice-prep') { m.who = typeof body.who === 'string' ? body.who.trim().slice(0, 200) : ''; if (!m.taskId && !say && !m.who) return fail('請說明要練習哪一個會面。'); }
    else { if (!say) return fail('請記錄對方實際說了甚麼。'); m.commitment = ['yes', 'partly', 'no'].includes(body.commitment) ? body.commitment : 'no'; m.followUp = /^\d{4}-\d{2}-\d{2}$/.test(String(body.followUp || '')) ? body.followUp : ''; }
    const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
    fs.writeFileSync(path.join(DIR.inbox, `${id}-note-${body.type}.md`), `kind: note\ntype: ${body.type}\nat: ${localIso()}\n\n${say || '（沒有補充）'}\n\n\`\`\`json\n${JSON.stringify(m)}\n\`\`\`\n`, { flag: 'wx' });
    return { ok: true, id, receivedAt: localIso() };
  }
  if (body.type === 'feedback' || body.type === 'brain-decide') {
    if (!/^[\w-]{1,60}$/.test(String(body.cardId || '')) || !BRAIN_ITEMS.includes(body.item)) return fail('找不到此張卡。');
    if (body.type === 'feedback' && !['useful', 'useless', 'revise'].includes(body.verdict)) return fail('意見類型不正確。');
    const say = typeof body.text === 'string' ? body.text.trim() : '';
    if (say.length > 500) return fail('意見最多 500 字。');
    if (body.type === 'feedback' && body.verdict === 'revise' && !say) return fail('要修改請寫一句改甚麼。');
    const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
    const machine = { cardId: body.cardId, item: body.item, verdict: body.verdict || '', text: say };
    // 規劃書 4.9：結果卡意見檔名為時間前綴加 feedback-（項目），決定沿用 note-
    const fname = body.type === 'feedback' ? `${id}-feedback-${body.item}.md` : `${id}-note-${body.type}.md`;
    fs.writeFileSync(path.join(DIR.inbox, fname), `kind: note\ntype: ${body.type}\nat: ${localIso()}\n\n${say || '（沒有填寫意見）'}\n\n\`\`\`json\n${JSON.stringify(machine)}\n\`\`\`\n`, { flag: 'wx' });
    return { ok: true, id, receivedAt: localIso() };
  }
  if (body.type === 'doc') {
    if (!readJSON(path.join(DIR.ledger, 'confirmed.json'), null)) return fail(NAMES.ui.docNeedOverview);
    if (!Array.isArray(body.files) || !body.files.length) return fail('請先加入文件。');
    const say = typeof body.text === 'string' ? body.text.trim() : '';
    if (say.length > 4000) return fail('最多 4000 字。');
    const got = takeFiles(body.files);
    if (got.error) return fail(got.error);
    const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0'), date = localIso().slice(0, 10);
    const records = got.files.map((f, i) => ({ name: f.name, stored: `${id}-note-doc-file-${pad(i + 1)}-${f.name}` }));
    const created = [];
    try {
      got.files.forEach((f, i) => { const p = path.join(DIR.inbox, records[i].stored); fs.writeFileSync(p, f.bytes, { flag: 'wx' }); created.push(p); });
      fs.writeFileSync(path.join(DIR.inbox, `${id}-note-doc.md`), `kind: note\ntype: doc\nat: ${localIso()}\n\n${say || '（沒有補充）'}\n\n\`\`\`json\n${JSON.stringify({ date, files: records })}\n\`\`\`\n`, { flag: 'wx' });
    } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
    return { ok: true, id, receivedAt: localIso() };
  }
  if (body.type === 'help') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return fail('請用一句話寫下你卡住的地方。');
    if (text.length > 2000) return fail('內容最多 2000 字。');
    const context = {};
    const source = body.context && typeof body.context === 'object' && !Array.isArray(body.context) ? body.context : {};
    if (/^[\w-]{1,30}$/.test(String(source.page || ''))) context.page = String(source.page);
    if (/^[\w-]{1,80}$/.test(String(source.packId || ''))) context.packId = String(source.packId);
    if (/^[\w-]{1,80}$/.test(String(source.runRef || ''))) context.runRef = String(source.runRef);
    if (typeof source.packTitle === 'string' && source.packTitle.trim().length <= 300) context.packTitle = source.packTitle.trim();
    if (typeof source.ask === 'string' && source.ask.trim().length <= 300) context.ask = source.ask.trim();
    const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
    const file = id + '-note-help.md';
    const content = ['kind: note', 'type: help', 'at: ' + localIso(), '', text, '', '```json', JSON.stringify({ context }), '```', ''].join('\n');
    fs.writeFileSync(path.join(DIR.inbox, file), content, { flag: 'wx' });
    return { ok: true, id, receivedAt: localIso() };
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 4000) return fail(body.type === 'event' ? '請寫下發生了甚麼事（最多 4000 字）。' : '請用一兩句寫下你的要求（最多 4000 字）。');
  if (!readJSON(path.join(DIR.company, 'page.json'), null)) return fail('尚未有公司概覽：請先提交資料，AI 擬定公司概覽後才可提交要求。');
  const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
  // 記錄真實事件（規劃書 3.10）：事件日期由你填（唔係提交時間）；證明文件同筆記一齊入收件匣，由外殼登記
  if (body.type === 'event') {
    if (!readJSON(path.join(DIR.ledger, 'confirmed.json'), null)) return fail(NAMES.ui.eventNeedOverview);
    const date = String(body.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T00:00:00'))) return fail('請選擇事件日期。');
    const got = takeFiles(Array.isArray(body.files) ? body.files : []);
    if (got.error) return fail(got.error);
    const records = got.files.map((f, i) => ({ name: f.name, stored: `${id}-note-event-file-${pad(i + 1)}-${f.name}` }));
    const created = [];
    try {
      got.files.forEach((f, i) => { const p = path.join(DIR.inbox, records[i].stored); fs.writeFileSync(p, f.bytes, { flag: 'wx' }); created.push(p); });
      fs.writeFileSync(path.join(DIR.inbox, `${id}-note-event.md`), `kind: note\ntype: event\nat: ${localIso()}\n\n${text}\n\n\`\`\`json\n${JSON.stringify({ date, files: records })}\n\`\`\`\n`, { flag: 'wx' });
    } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
    return { ok: true, id, receivedAt: localIso() };
  }
  fs.writeFileSync(path.join(DIR.inbox, `${id}-note-${body.type}.md`), `kind: note\ntype: ${body.type}\nat: ${localIso()}\n\n${text}\n`, { flag: 'wx' });
  return { ok: true, id, receivedAt: localIso() };
}

/* ---------- 情景演練：AI 扮對方（原型試行：伺服器開已認證嘅 AI 工具，冇工具、冇寫檔權） ---------- */
function chatHost() { const c = certified(ROOT, DIR.ledger); return c.host && c.host.chat ? c.host : null; }
function preparingPractice() { return fs.readdirSync(DIR.inbox).filter(f => /-note-practice-prep\.md$/.test(f)).length + (readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] }).runs.some(r => r.kind === 'note' && r.noteType === 'practice-prep' && r.state === 'running') ? 1 : 0); }
const busySessions = new Set();
async function practiceAction(body) {
  const host = chatHost();
  if (body.action === 'start') {
    const sc = loadScenario(DIR, body.scenarioId);
    if (!sc) return [404, { error: 'not found', message: '找不到此場景。' }];
    if (!host) return [409, { error: 'ai', message: 'AI 尚未設定，練習需要 AI 扮演對方。' }];
    const edits = body.edits && typeof body.edits === 'object' ? body.edits : {};
    return [200, { ok: true, session: startSession(DIR, host, sc, body.level, edits) }];
  }
  const s = loadSession(DIR, body.sessionId);
  if (!s) return [404, { error: 'not found', message: '找不到此次練習，可能是舊分頁。' }];
  const sc = loadScenario(DIR, s.scenarioId);
  if (!sc) return [404, { error: 'not found', message: '找不到此場景。' }];
  if (busySessions.has(s.id)) return [409, { error: 'busy', message: '對方仍在思考，請稍候。' }];
  busySessions.add(s.id);
  let keep = null;
  try {
    if (body.action === 'undo') { const r = practiceUndo(DIR, s); return r.error ? [400, { error: 'invalid', message: r.error }] : [200, { ok: true, session: r.session }]; }
    if (!host) return [409, { error: 'ai', message: 'AI 尚未設定，練習需要 AI 扮演對方。' }];
    // 對方講完就回覆；建議講法補完先解鎖（期間再送會叫你等）
    if (body.action === 'say') { const r = await practiceSay(DIR, host, s, sc, typeof body.text === 'string' ? body.text : ''); if (r.error) return [502, { error: 'reply', message: r.error }]; keep = r.done; return [200, { ok: true, session: r.session }]; }
    if (body.action === 'end') { const r = await practiceFinish(DIR, host, s, sc); return [200, { ok: true, session: r.session }]; }
    return [400, { error: 'invalid' }];
  } finally { if (keep) keep.finally(() => busySessions.delete(s.id)); else busySessions.delete(s.id); }
}
process.on('exit', () => practiceStop());

/* ---------- HTTP ---------- */
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, {
    'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const okHost = h => h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}` || !!phoneMode && h === `${phoneMode.address}:${PORT}`;
const loopbackOrigin = o => o === `http://127.0.0.1:${PORT}` || o === `http://localhost:${PORT}`;
const okOrigin = o => loopbackOrigin(o) || !!phoneMode && o === `http://${phoneMode.address}:${PORT}`;
function readBody(req, max, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false; const chunks = [];
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    let timer;
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => { try { req.destroy(); } catch { } finish(new Error('body timeout')); }, timeoutMs); };
    idle();
    // 超過上限：唔再收，但唔即刻斷線（斷咗頁面就收唔到「內容太多」嘅原因，只會以為連唔到）；餘下資料照讀照丟
    req.on('data', c => { idle(); size += c.length; if (size > max) { chunks.length = 0; finish(new Error('too large')); if (size > max + 8 * 1024 * 1024) { try { req.destroy(); } catch { } } } else if (!done) chunks.push(c); });
    req.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    req.on('aborted', () => finish(new Error('request aborted')));
    req.on('error', e => finish(e));
  });
}
function collectLocalOnlyFields(value, out = new Map()) {
  if (!value || typeof value !== 'object') return out;
  if (typeof value.id === 'string' && ['G7', 'G8'].includes(String(value.plan || ''))) out.set(value.id, { plan: value.plan, value: value.value });
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectLocalOnlyFields(item, out);
  return out;
}
function changesLocalOnly(body, reply) {
  const machine = reply.machine;
  if (body.kind === 'proofread') {
    const page = readJSON(path.join(DIR.company, 'page.json'), null);
    const fields = collectLocalOnlyFields(page);
    return (Array.isArray(machine.edits) ? machine.edits : []).some(edit => {
      const field = fields.get(String(edit && edit.id || ''));
      return !!field && String(edit.value ?? '') !== String(field.value ?? '');
    });
  }
  if (body.kind === 'ask-answer') {
    const pack = loadPack(DIR, body.ref);
    const qs = new Map((pack?.questions || []).map(q => [q.id, q]));
    return (Array.isArray(machine.answers) ? machine.answers : []).some(answer => {
      const q = qs.get(answer && answer.id);
      if (!q) return false;
      const sensitive = collectLocalOnlyFields(q).size > 0 || /^(permissions|rhythm)$/i.test(String(q.id || ''));
      return sensitive && JSON.stringify(answer.value) !== JSON.stringify(q.value);
    });
  }
  return false;
}
function currentPhonePass(req, gate) {
  if (!gate || !phoneMode || phoneMode.generation !== gate.generation) return false;
  const found = passFromCookie(req);
  return !!found && found.hash === gate.hash && found.p.kind === 'phone' && found.p.state === 'paired';
}
// 客戶端不得決定回覆來源：只處理標頭區，保留正文內的同名文字。
function serverVia(text, via) {
  const lines = String(text || '').split(/\r?\n/);
  let end = lines.findIndex(line => !line.trim());
  if (end < 0) end = lines.length;
  const header = lines.slice(0, end).filter(line => !/^via\s*:/i.test(line));
  const kind = header.findIndex(line => /^kind\s*:/i.test(line));
  header.splice(kind >= 0 ? kind + 1 : 0, 0, 'via: ' + via);
  return header.concat(lines.slice(end)).join('\n');
}
function helpInFlight(status = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] })) {
  const found = [], add = (packId, ref) => {
    const pack = /^[\w-]{1,80}$/.test(String(packId || '')) ? String(packId) : '';
    const runRef = /^[\w-]{1,80}$/.test(String(ref || '')) ? String(ref) : '';
    if ((pack || runRef) && !found.some(x => x.packId === pack && x.ref === runRef)) found.push({ packId: pack, ref: runRef });
  };
  for (const file of fs.readdirSync(DIR.inbox).filter(f => /-note-help\.md$/.test(f))) {
    try {
      const parsed = parseFounderReply(fs.readFileSync(path.join(DIR.inbox, file), 'utf8'));
      const context = (parsed.machine || {}).context || {};
      add(context.packId, context.runRef);
    } catch { }
  }
  for (const run of (status.runs || [])) if (run && run.kind === 'note' && run.noteType === 'help' && ['running', 'waiting', 'resumed'].includes(run.state)) add(run.helpForPackId, run.helpForRunRef);
  return found;
}

function statusPayload() {
  const st = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
  const packs = listPacks(DIR);
  const failedByRef = (st.runs || []).filter(r => r && r.state === 'failed' && r.ref).reduce((all, r) => ({ ...all, [r.ref]: (all[r.ref] || 0) + 1 }), {});
  const runs = (st.runs || []).slice(0, 5).map(r => r && r.state === 'failed' && r.ref && failedByRef[r.ref] >= 2 ? { ...r, repeatFailed: true } : r);
  return {
    ok: true, version: SERVER_VERSION, root: ROOT_ID, sim: simInfo(), today: localIso().slice(0, 10), instance: INSTANCE, pid: process.pid, ai: (() => { const c = certInfo(); return { name: c ? c.label : 'AI', ready: !!c }; })(), busy: !!child,
    cert: certInfo(), certify: (() => { const c = certifyState(); return c ? { state: c.state } : null; })(), pending: pendingFiles(), runs, openAsks: packs.filter(p => p.open).length, company: companyStatus(), helpInFlight: helpInFlight(st), intake: (() => { const r = st.runs.find(r => r.kind === 'intake'); const f = fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md')).sort().at(-1); if (f && (!r || f.slice(0, -10) > r.ref)) return { id: f.slice(0, -10), state: 'pending', runId: null }; return r ? { id: r.ref, state: r.state, runId: r.id } : null; })()
  };
}
// 公司標誌（創辦人喺頁頭自己上載）：只收 PNG、JPG、WebP，1MB 以內，按檔頭認格式（唔信檔名或者頁面講嘅類型；SVG 一律唔收）。
// 存喺 data/company/logo.<格式>：先寫暫存檔再改名，之後刪走其他格式嘅舊標誌。移除就三個格式都刪。
const LOGO_MAX = 1024 * 1024;
const logoKind = b => b.length >= 12 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'png'
  : b.length >= 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg'
  : b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null;
function saveLogo(body) {
  const drop = keep => { for (const e of LOGO_EXTS) if (e !== keep) fs.rmSync(path.join(DIR.company, 'logo.' + e), { force: true }); };
  if (body.action === 'remove') { drop(null); say('公司標誌已移除'); return [200, { ok: true, logo: 0 }]; }
  if (body.action !== 'set' || typeof body.data !== 'string' || !B64.test(body.data)) return [400, { error: 'invalid', message: NAMES.ui.logoBad }];
  const bytes = Buffer.from(body.data, 'base64'), ext = logoKind(bytes);
  if (bytes.length > LOGO_MAX) return [400, { error: 'large', message: NAMES.ui.logoLarge }];
  if (!ext) return [400, { error: 'type', message: NAMES.ui.logoBad }];
  fs.mkdirSync(DIR.company, { recursive: true });
  const tmp = path.join(DIR.company, `.logo-${process.pid}.tmp`);
  fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, path.join(DIR.company, 'logo.' + ext));
  drop(ext); say(`公司標誌已更換（${ext.toUpperCase()}，${Math.ceil(bytes.length / 1024)}KB）`);
  return [200, { ok: true, logo: companyLogo(DIR).v }];
}
function companyStatus() {
  const c = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const page = readJSON(path.join(DIR.company, 'page.json'), null), co = page?.company || {};
  const biz = readJSON(path.join(DIR.company, 'biz.json'), null);
  return { name: co.name || '', initials: co.initials || '', logo: (companyLogo(DIR) || {}).v || 0, oneLiner: co.oneLiner || '', ready: !!page, confirmed: !!c, confirmedAt: c ? c.confirmedAt : null,
    ...(biz && BIZ_TYPES[biz.type] ? { bizType: biz.type } : {}) };
}
/* ---------- 觀測來源（規劃書 4.12、4.9；設計稿 2026-10-28 第 3 節）：轉接層嘅唯讀觀測程式 ----------
   觀察範圍只限帳本 observe.folders[]（只存雜湊同顯示名，唔存路徑；系統頁經 /api/setup 增刪，外殼下次第一步寫入）。
   伺服器只將雜湊清單交入觀測程式；觀測程式自己列出宿主會話、按同一算法計工作資料夾雜湊再篩。
   按需要先觀測：監察台每次讀 /api/dashboard 先叫（最多每 5 秒一次、單飛）；2.5 秒未有結果就沿用上一次並標「觀測逾時」，
   觀測程式照跑完再更新（硬上限 12 秒）。結果只放記憶體同 /api/dashboard，唔寫帳本、唔寫日誌、唔寫任何檔。
   伺服器唔讀任何宿主檔案，只逐欄驗觀測程式交返嚟嘅固定欄位、遮蓋似金鑰字串、截斷。 */
// 觀測程式由轉接層提供（adapters/<宿主>/observe.mjs）：伺服器唔寫死任何宿主名，宿主名由觀測程式自己報（只收細楷英文字）。
// 測試用：SOS_OBSERVER 指向一個假觀測程式（同 SOS_ADAPTER 一樣只喺測試設定）
function observers() {
  if (process.env.SOS_OBSERVER) return [process.env.SOS_OBSERVER];
  const base = path.join(ROOT, 'adapters');
  return fs.readdirSync(base).map(d => path.join('adapters', d, 'observe.mjs')).filter(f => fs.existsSync(path.join(ROOT, f)));
}
const hostName = h => NAMES.dash['host_' + h] || h;
const KEYISH = /\b(sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}|\b[A-Za-z0-9+/_-]{32,}={0,2}/g;
const clean = (v, n) => String(v || '').replace(KEYISH, '〔已遮蓋〕').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);
// 帳本 observe：{ folders: [{ hash, name }], off? }；外殼未套用嘅增刪檔（founder/desk/observe-<時間>.json）另計「等待套用」
const DESK = path.join(DIR.data, 'founder', 'desk');
function observeCfg() {
  const o = (readJSON(path.join(DIR.ledger, 'state.json'), null) || {}).observe || {};
  const folders = (Array.isArray(o.folders) ? o.folders : []).filter(f => f && /^[a-f0-9]{64}$/.test(String(f.hash || ''))).map(f => ({ hash: f.hash, name: clean(f.name, 40) || NAMES.dash.folderUnnamed }));
  let pending = 0; try { pending = fs.readdirSync(DESK).filter(f => /^observe-[\w-]+\.json$/.test(f)).length; } catch { }
  return { off: o.off === true, folders, pending };
}
let observed = { state: 'unavailable', problems: [], sessions: [], readAt: '' }, obsEvents = [], obsPrev = null, obsRun = null, obsStartedAt = 0, obsTimedOut = false;
function checkSession(s, host) {
  if (!/^[a-z]{2,12}$/.test(String(host || ''))) return null;
  if (!s || typeof s !== 'object' || !/^[a-f0-9]{8,32}$/.test(String(s.key || ''))) return null;
  const iso = x => /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(String(x || '')) ? x : '';
  const v = { key: host + '-' + s.key, host, kind: ['interactive', 'background'].includes(s.kind) ? s.kind : 'interactive', state: ['working', 'idle', 'stopped', 'unknown'].includes(s.state) ? s.state : 'unknown',
    title: typeof s.title === 'string' && s.title.length <= 2000 ? clean(s.title, 60) : '', latestRequest: typeof s.latestRequest === 'string' && s.latestRequest.length <= 4000 ? clean(s.latestRequest, 120) : '',
    lastActiveAt: iso(s.lastActiveAt), reportedAt: iso(s.reportedAt), reason: clean(s.reason, 40), child: s.child === true, isRun: s.isRun === true,
    taskIds: Array.isArray(s.taskIds) ? s.taskIds.filter(t => typeof t === 'string' && /^[\w-]{1,40}$/.test(t)).slice(0, 6) : [] };
  if (s.subagents && Number.isInteger(s.subagents.active) && s.subagents.active >= 0) v.subagents = { active: Math.min(99, s.subagents.active), windowMinutes: Math.min(60, Number(s.subagents.windowMinutes) || 5) };
  return v;
}
function runObserver(file, folders) {
  return new Promise(resolve => {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CLAUDECODE|CLAUDE_CODE/i.test(k)) env[k] = v;
    let out = '', done = false;
    const c = spawn(process.execPath, [path.resolve(ROOT, file)], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const finish = r => { if (done) return; done = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { c.kill(); } catch { } finish({ timeout: true }); }, 12000);
    c.stdout.on('data', d => { out += d; if (out.length > 1e6) { try { c.kill(); } catch { } finish({ timeout: true }); } });
    c.on('error', () => finish(null));
    c.on('close', () => { try { finish(JSON.parse(out)); } catch { finish(null); } });
    // 只交雜湊同顯示名：路徑唔經本套任何檔或者程序參數
    c.stdin.end(JSON.stringify({ folders: folders.map(f => ({ hash: f.hash, name: f.name })) }));
  });
}
function noteObserved(prev, next, state) {
  const at = localIso(), name = s => hostName(s.host) + ' 會話「' + (s.title || NAMES.dash.sessionUnnamed) + '」';
  if (state === 'restricted' && observed.state !== 'restricted') obsEvents.unshift({ at, title: NAMES.dash.observeRestrictedEvent });
  if (prev) {
    const was = Object.fromEntries(prev.map(s => [s.key, s]));
    for (const s of next) {
      const p = was[s.key];
      if (!p) { if (s.state === 'working') obsEvents.unshift({ at, title: name(s) + '開始工作' }); continue; }
      if (p.state !== s.state) obsEvents.unshift({ at, title: name(s) + ({ working: '開始工作', idle: '轉為閒置', stopped: '已停止', unknown: '待核實' }[s.state] || '') });
      const a = p.subagents ? p.subagents.active : 0, b = s.subagents ? s.subagents.active : 0;
      if (a !== b && s.state === 'working') obsEvents.unshift({ at, title: name(s) + '：子代理 ' + b + ' 個' });
      delete was[s.key];
    }
    for (const s of Object.values(was)) obsEvents.unshift({ at, title: name(s) + '已結束' });
  }
  const from = Date.now() - 15 * 60000;
  obsEvents = obsEvents.filter(e => new Date(e.at).getTime() >= from).slice(0, 20);
}
async function observeTick(folders) {
  const res = await Promise.all(observers().map(f => runObserver(f, folders).then(r => ({ host: r && typeof r.host === 'string' ? r.host : path.basename(path.dirname(f)), r }))));
  const sessions = [], problems = [];
  let any = false, timedOut = false;
  for (const { host, r } of res) {
    if (r && r.unavailable) continue;
    any = true;
    if (r && r.timeout) { timedOut = true; continue; }
    if (!r || !r.ok || !Array.isArray(r.sessions)) { problems.push(hostName(host) + '：' + NAMES.dash.observeRestricted); continue; }
    for (const x of r.sessions.slice(0, 40)) { const v = checkSession(x, host); if (v) sessions.push(v); }
    for (const p of (r.problems || []).slice(0, 3)) problems.push(hostName(host) + '：' + clean(p, 30));
  }
  // 硬上限都逾時：沿用上一次結果，標「觀測逾時」
  if (timedOut && !sessions.length && !problems.length) { obsTimedOut = true; return; }
  const state = !any ? 'unavailable' : problems.length ? 'restricted' : 'ok';
  noteObserved(obsPrev, sessions, state);
  obsPrev = sessions;
  obsTimedOut = false;
  observed = { state, problems, sessions, readAt: localIso() };
}
// 監察台讀回時叫：最多每 5 秒開一次觀測、單飛；最多等 2.5 秒
async function observeNow() {
  const cfg = observeCfg();
  if (cfg.off) { obsPrev = null; return null; }
  if (!cfg.folders.length) { obsPrev = null; observed = { state: 'unavailable', problems: [], sessions: [], readAt: localIso() }; return observedView(cfg); }
  if (!obsRun && Date.now() - obsStartedAt >= 5000) {
    obsStartedAt = Date.now();
    obsRun = observeTick(cfg.folders).catch(() => { }).finally(() => { obsRun = null; });
  }
  if (obsRun) {
    const left = 2500 - (Date.now() - obsStartedAt);
    const done = left > 0 && await Promise.race([obsRun.then(() => true), new Promise(r => setTimeout(() => r(false), left))]);
    if (!done) obsTimedOut = true;
  }
  return observedView(cfg);
}
function observedView(cfg) {
  return { ...observed, timedOut: obsTimedOut, folders: cfg.folders.map(f => ({ hash: f.hash.slice(0, 12), name: f.name })), pending: cfg.pending, events: obsEvents };
}
// 外殼工作：持鎖而且程序仍在先算工作中（設計稿第 3 節；包括唔係由伺服器叫起嘅外殼，例如 node run.mjs --plain）
// 作業系統排程讀回（MVP 規格第 2 節第 3 項）：有登記標記先讀；喺背景行 install-schedule.mjs --status（唯讀），最多每 10 分鐘一次，結果附喺系統頁
const schedCache = { at: 0, data: null, running: false, mark: '' };
function schedReadback() {
  const mark = path.join(DIR.ledger, 'schedule.json');
  let m = ''; try { m = fs.statSync(mark).mtimeMs + ''; } catch { schedCache.data = null; return null; }
  if (schedCache.running || (schedCache.mark === m && Date.now() - schedCache.at < 600000)) return schedCache.mark === m ? schedCache.data : null;
  schedCache.running = true;
  let o = '';
  try {
    const c = spawn(process.execPath, [path.join(ROOT, 'adapters', 'scheduler', 'install-schedule.mjs'), '--status', '--data', DIR.data], { cwd: ROOT, env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    c.stdout.on('data', d => { o += d; });
    c.on('exit', () => { try { schedCache.data = JSON.parse(o.split(/\r?\n/)[0]); } catch { schedCache.data = null; } schedCache.at = Date.now(); schedCache.mark = m; schedCache.running = false; });
    c.on('error', () => { schedCache.at = Date.now(); schedCache.mark = m; schedCache.running = false; });
  } catch { schedCache.running = false; }
  return schedCache.mark === m ? schedCache.data : null;
}
function shellAlive() {
  if (child) return true;
  try { const pid = Number(fs.readFileSync(path.join(DIR.ledger, '.lock'), 'utf8')); if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; }
}
// 系統頁增刪觀察資料夾、開關觀測（4.9 /api/setup）：頁面交入嘅路徑只喺今次請求入面用嚟計雜湊同顯示名，唔寫入任何檔
function observeSetup(body) {
  let rec;
  if (body.op === 'add') {
    const dir = typeof body.path === 'string' ? body.path.trim() : '';
    if (!dir || dir.length > 1000 || !path.isAbsolute(dir)) return [400, { error: 'invalid', message: NAMES.dash.observePathInvalid }];
    let isDir = false; try { isDir = fs.statSync(dir).isDirectory(); } catch { }
    if (!isDir) return [400, { error: 'invalid', message: NAMES.dash.observePathMissing }];
    const name = clean(typeof body.name === 'string' && body.name.trim() ? body.name : path.basename(path.resolve(dir)), 40) || NAMES.dash.folderUnnamed;
    rec = { op: 'add', hash: folderHash(dir), name };
  } else if (body.op === 'remove') {
    const full = observeCfg().folders.find(f => typeof body.hash === 'string' && /^[a-f0-9]{12,64}$/.test(body.hash) && f.hash.startsWith(body.hash));
    if (!full) return [404, { error: 'not found', message: NAMES.dash.observeFolderGone }];
    rec = { op: 'remove', hash: full.hash };
  } else if (body.op === 'off' || body.op === 'on') rec = { op: body.op };
  else return [400, { error: 'invalid' }];
  fs.mkdirSync(DESK, { recursive: true });
  let name = 'observe-' + fileStamp() + '.json', n = 1;
  while (fs.existsSync(path.join(DESK, name))) name = 'observe-' + fileStamp() + '-' + (++n) + '.json';
  fs.writeFileSync(path.join(DESK, name), JSON.stringify({ ...rec, at: localIso() }) + '\n', { flag: 'wx' });
  schedule(200);
  return [202, { ok: true, pending: true }];
}

// AI 做咗乜：讀 data/work/<run>/（永久保留）
function runResult(id) {
  if (!/^R[\w-]{1,40}$/.test(String(id || ''))) return null;
  const dir = path.join(DIR.work, id);
  const receipt = readJSON(path.join(dir, 'receipt.json'), null);
  if (!receipt) return null;
  const meta = readJSON(path.join(dir, 'run.json'), {});
  const artifacts = (receipt.artifacts || []).slice(0, 5).filter(a => /^[\w.-]+\.md$/.test(String(a.file || ''))).map(a => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, a.file), 'utf8').slice(0, 100000); } catch { }
    return { title: String(a.title || a.file), text };
  });
  return { id, label: meta.label || '', summary: String(receipt.summary || ''), artifacts, founderNext: Array.isArray(receipt.founderNext) ? receipt.founderNext.map(String) : [] };
}

const handler = async (req, res) => {
  try {
    if (!okHost(req.headers.host)) return send(res, 403, { error: 'host' });
    const url = new URL(req.url, home());
    const p = url.pathname;
    /* ---- 公開（不含公司資料）：認身份、認證探測、一次性連結 ---- */
    // 認身份：ask.mjs 搵開緊嘅伺服器、開機時同一資料夾檢查；只有版本、資料夾識別碼、實例、程序、忙碌
    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: SERVER_VERSION, root: ROOT_ID, instance: INSTANCE, pid: process.pid, busy: !!child });
    if (req.method === 'GET' && p === '/api/probe') {
      const token = url.searchParams.get('t') || '';
      if (!/^[a-f0-9]{36}$/.test(token)) return send(res, 400, 'invalid', 'text/plain');
      fs.mkdirSync(DESK_DIR, { recursive: true });
      fs.appendFileSync(path.join(DESK_DIR, 'probe-hits.log'), token + '\n'); return send(res, 200, 'ok', 'text/plain');
    }
    // 手機配對頁沒有公司資料：秘密只在網址片段，伺服器永遠看不到；/api/pair 只可經私人網段的額外監聽連入。
    if (req.method === 'GET' && p === '/pair') {
      if (!phoneMode || req.socket.localAddress?.replace(/^::ffff:/, '') !== phoneMode.address) return send(res, 404, { error: 'not found' });
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'pair.html')), TYPES['.html']);
    }
    if (req.method === 'POST' && p === '/api/pair') {
      const source = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (!phoneMode || req.socket.localAddress?.replace(/^::ffff:/, '') !== phoneMode.address || !privateIPv4(source)) return send(res, 403, { error: 'origin' });
      if (!pairAllowed(req)) return send(res, 429, { error: 'rate', message: NAMES.ui.phoneRateLimited });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'type' });
      const body = JSON.parse(await readBody(req, 4096) || '{}'), secret = String(body.secret || '');
      const valid = /^[a-f0-9]{64}$/.test(secret) && phoneMode.exp >= Date.now() && phoneMode.secret && crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(phoneMode.secret));
      if (!valid) return send(res, 403, { error: 'pair', message: NAMES.ui.phonePairExpired });
      phoneMode.secret = ''; // 一次性：接受前也不能以同一秘密再換另一張通行證
      const issued = issuePass(req, 'phone', 'pending');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `${PASS_COOKIE}=${issued.secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PASS_DAYS * 86400}` });
      return res.end(JSON.stringify({ ok: true, code: issued.pass.confirmationCode, expiresAt: issued.pass.pendingExpiresAt }));
    }
    // AI 可以叫嘅：請伺服器打開一頁（由 ask.mjs 叫）。只限回環位址、冇 Origin 標頭（瀏覽器一定會帶）；回應唔含連結，所以叫嘅一方攞唔到通行證
    if (req.method === 'POST' && p === '/api/pass/open') {
      if (!LOOPBACK.includes(req.socket.remoteAddress) || req.headers.origin !== undefined) return refuse(req, res, url, 'origin');
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'type' });
      const body = JSON.parse(await readBody(req, 4096) || '{}');
      if (!PAGE_OK.test(String(body.page || ''))) return send(res, 400, { error: 'invalid' });
      return send(res, ...openPage(body.page, { noOpen: body.noOpen === true }));
    }
    // 兌換一次性連結：命中即作廢；呢個瀏覽器未有通行證先發新嘅（有就沿用，唔會每次開頁都多一部裝置）；之後 302 去目標頁
    const pm = /^\/pass\/([a-f0-9]{64})$/.exec(p);
    if (req.method === 'GET' && pm) {
      const v = openTokens.get(pm[1]); openTokens.delete(pm[1]);
      const headers = { Location: v && v.exp >= Date.now() ? pageUrl(v.page) : '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
      if (v && v.exp >= Date.now() && !passOf(req)) headers['Set-Cookie'] = `${PASS_COOKIE}=${issuePass(req).secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${PASS_DAYS * 86400}`;
      res.writeHead(302, headers); return res.end();
    }
    /* ---- 頁面殼同共用檔（唔含公司資料）：冇通行證都可以載入，頁面讀回收到 403 就顯示配對指引 ---- */
    const dm = /^\/dashboard\/([a-z]+)(?:\/([a-z]+))?$/.exec(p), dashTab = p === '/dashboard' ? 'overview' : dm && (!dm[2] || (dm[1] === 'brain' && BRAIN_PAGES.includes(dm[2]))) ? dm[1] : null;
    if ((req.method === 'GET' || req.method === 'HEAD') && dashTab && (dashTab === 'overview' || DASH_TABS.includes(dashTab))) {
      // 打開監察台公司現況：記低今次時間（「自上次查看以來」用上一次嘅時間）；只有已配對嘅瀏覽器先算「查看過」
      if (dashTab === 'overview' && req.method === 'GET' && passOf(req)) lastSeenPrev = touchLastSeen(DIR, SERVER_VERSION);
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'dashboard.html')), TYPES['.html']);
    }
    // 品牌角色 AI 團隊圖（品牌角色規格）：只送 assets/ 入面 crew-*.webp，冇就 404
    const am = /^\/assets\/(crew-[a-z0-9-]+\.webp)$/.exec(p);
    if ((req.method === 'GET' || req.method === 'HEAD') && am) {
      const f = path.join(ROOT, 'assets', am[1]);
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), TYPES['.webp']) : send(res, 404, { error: 'not found' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && FILES[p]) {
      const f = path.join(ROOT, FILES[p]);
      return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)]);
    }
    /* ---- 由此起全部只限創辦人：要有效通行證，否則 403 {error:'pass'}，乜都唔寫 ---- */
    const pass = passOf(req);
    if (!pass) return refuse(req, res, url, pendingOf(req) ? 'pending' : 'pass');
    if ((req.method === 'GET' || req.method === 'HEAD') && p === '/company-logo') { const l = companyLogo(DIR); return l ? send(res, 200, fs.readFileSync(l.file), TYPES['.' + l.ext]) : send(res, 404, { error: 'not found' }); }
    if ((req.method === 'GET' || req.method === 'HEAD') && p === '/company-page.js') { const page = readJSON(path.join(DIR.company, 'page.json'), null); return page ? send(res, 200, 'window.STARTUP_OS_PAGE = ' + JSON.stringify(page).replace(/</g, '\\u003c') + ';', TYPES['.js']) : send(res, 404, { error: 'not found' }); }
    if (req.method === 'GET') {
      if (p === '/api/intake') return send(res, 200, { ok: true, questions: INTAKE_QUESTIONS, questionsByBizType: Object.fromEntries(Object.keys(BIZ_TYPES).map(type => [type, intakeQuestions(type)])), bizTypes: Object.entries(BIZ_TYPES).map(([id, x]) => ({ id, label: x.label, example: x.example })), limits });
      if (p === '/api/prefill') { const r = prefillStatus(url.searchParams.get('id')); return r ? send(res, 200, { ok: true, ...r }) : send(res, 404, { error: 'not found' }); }
       if (p === '/api/setup') return send(res, 200, { ok: true, hosts: hostList(), cert: certInfo(), certify: certifyState(), devices: deviceList(pass), phone: phoneInfo() });
      if (p === '/api/status') return send(res, 200, statusPayload());
      if (p === '/api/sim' && SIM) return send(res, 200, { ok: true, sim: simInfo() });
       if (p === '/api/dashboard') { const observedLive = await observeNow(), oc = observeCfg(); return send(res, 200, { ...dashboardState(DIR, { cert: certInfo(), busy: shellAlive(), scheduler: SIM ? 'sim' : 'none', schedStatus: SIM ? null : schedReadback(), sim: simInfo(), lastSeen: lastSeenPrev, observed: observedLive, observeFolders: oc.folders.map(f => ({ hash: f.hash.slice(0, 12), name: f.name })), observePending: oc.pending }), observed: observedLive, devices: deviceList(pass), phone: phoneInfo(), version: SERVER_VERSION, instance: INSTANCE }); }
      // Founder Desk 待決事項頁：「今日要做的事」卡同「上次離開之後」；頁面第一次載入（seen=1）先記低今次時間，輪詢唔算
      // 一個殼嘅頁頭（決定二十五）：公司、三個業務指標、生意大腦等你處理數目；唔觀測、唔寫檔（Founder Desk 畫面每 5 秒讀一次）
      if (p === '/api/shell') { const ds = dashboardState(DIR, { cert: certInfo(), sim: simInfo() }); return send(res, 200, { ok: true, company: ds.company, metrics: ds.metrics, brain: { items: ((ds.brain || {}).items || []).map(x => ({ id: x.id, status: x.status })) }, tele: ds.tele, freshness: ds.deck && ds.deck.freshness, sample: ds.sample, version: SERVER_VERSION, instance: INSTANCE }); }
      if (p === '/api/home') {
        if (url.searchParams.get('seen') === '1' && fs.existsSync(path.join(DIR.company, 'page.json'))) lastSeenPrev = touchLastSeen(DIR, SERVER_VERSION);
        const ds = dashboardState(DIR, { cert: certInfo(), lastSeen: lastSeenPrev });
        let fw = ''; try { fw = fs.readFileSync(path.join(ROOT, 'FIRST-WEEK.md'), 'utf8'); } catch { }
        const card = guideCard(fw, ds);
        const fallback = (ds.todo || [])[0] || null;
        const fallbackHref = fallback ? (fallback.kind === 'overview' ? '/proofread.html' : fallback.kind === 'schedule' ? fallback.href : '#/ask/' + fallback.id) : '';
        const back = ds.since && ds.since.awayDays >= 3 ? card && card.today ? { text: card.today, href: card.href, button: card.button } : fallback ? { text: fallback.text, href: fallbackHref, button: NAMES.ui.goAnswer } : null : null;
        return send(res, 200, { ok: true, guide: ds.guide, card, firstWeekDone: ds.firstWeekDone, since: ds.since ? { ...ds.since, back } : null });
      }
      if (p === '/api/asks') return send(res, 200, { ok: true, packs: listPacks(DIR), company: companyStatus(), todo: pendingTodo(DIR), helpInFlight: helpInFlight() });
      if (p === '/api/ask') {
        const pack = loadPack(DIR, url.searchParams.get('id'));
        return pack ? send(res, 200, { ok: true, pack, answers: loadAnswers(DIR, pack.id).answers }) : send(res, 404, { error: 'not found' });
      }
      if (p === '/api/log') return send(res, 200, { ok: true, entries: readLog(DIR, 500) });
      // 情景演練：場景、練習紀錄、可以練嘅現實行動
      if (p === '/api/practice') {
        const st = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
        const actions = (st.tasks || []).filter(t => t.owner === 'founder' && t.status !== 'done' && t.status !== 'cancelled').map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt || '', scenarioId: t.scenarioId || '' }));
        return send(res, 200, { ok: true, scenarios: listScenarios(DIR).map(s => ({ id: s.id, title: s.title, counterpart: s.counterpart, date: s.date || '', forTaskId: s.forTaskId || '' })), sessions: listSessions(DIR), actions, ai: !!certified(ROOT, DIR.ledger).host, preparing: preparingPractice() });
      }
      // 紅藍對打：開一場要嘅選項、全部場次；一場嘅舞台資料（同監察台同一套計法）
      if (p === '/api/debate' || p === '/api/debate/match') {
        const src = brainSource(DIR), reveal = src && src.kind === 'demo' ? readJSON(path.join(src.dir, 'reveal.json'), null) : null;
        const all = listMatches(DIR, src, { reveal });
        if (p === '/api/debate/match') { const v = all.find(x => x.id === url.searchParams.get('id')); return v ? send(res, 200, { ok: true, match: { ...v, matches: all.map(summaryOf) } }) : send(res, 404, { error: 'not found' }); }
        const st = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
        const routes = [...new Map(all.filter(v => v.synthesis).flatMap(v => v.synthesis.routes).map(r => [r.id, { id: r.id, name: r.name }])).values()];
        const starting = fs.readdirSync(DIR.inbox).filter(f => /-note-debate-start\.md$/.test(f)).length;
        return send(res, 200, { ok: true, types: TOPIC_TYPES.map(t => ({ id: t, seats: SEATS[t], format: formatFor(t), passes: passesFor(formatFor(t)).length })), levels: LEVELS,
          matches: all.map(summaryOf), routes, milestones: (st.milestones || []).filter(m => m.pathStatus === 'confirmed').sort((a, b) => (a.order || 0) - (b.order || 0)).map(m => ({ id: m.id, name: m.short || m.title })),
          ai: !!certified(ROOT, DIR.ledger).host, company: companyStatus(), starting });
      }
      if (p === '/api/practice/scenario') { const s = loadScenario(DIR, url.searchParams.get('id')); return s ? send(res, 200, { ok: true, scenario: s }) : send(res, 404, { error: 'not found' }); }
      if (p === '/api/practice/session') { const s = loadSession(DIR, url.searchParams.get('id')); return s ? send(res, 200, { ok: true, session: s, scenario: loadScenario(DIR, s.scenarioId) }) : send(res, 404, { error: 'not found' }); }
      if (p === '/api/run') { const r = runResult(url.searchParams.get('id')); return r ? send(res, 200, { ok: true, run: r }) : send(res, 404, { error: 'not found' }); }
    }
    if (req.method === 'POST' && (p === '/api/submit' || p === '/api/retry' || p === '/api/setup' || p === '/api/intake' || p === '/api/practice' || p === '/api/logo' || (p === '/api/sim' && SIM))) {
      // 本機專用操作不能靠 LAN Origin 或手機通行證升格：三個條件缺一不可。
      const loopback = pass.kind === 'browser' && LOOPBACK.includes(req.socket.remoteAddress) && loopbackOrigin(req.headers.origin);
      const phone = pass.kind === 'phone' && !!phoneMode && privateIPv4(req.socket.remoteAddress) && req.socket.localAddress?.replace(/^::ffff:/, '') === phoneMode.address && okOrigin(req.headers.origin);
      if (!loopback && !phone) return refuse(req, res, url, 'origin');
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'type' });
      const phoneGate = phone ? { hash: passFromCookie(req)?.hash || '', generation: phoneMode?.generation } : null;
      const body = JSON.parse(await readBody(req, (p === '/api/intake' ? 75 * 1024 * 1024 : p === '/api/logo' ? 1.5 * 1024 * 1024 : 32 * 1024)) || '{}');
      // 半截手機請求在讀 body 期間可被撤銷；讀完後、套用任何動作前必須以同一代手機模式重驗。
      if (phone && !currentPhonePass(req, phoneGate)) return send(res, 403, { error: 'pass' });
      if (phone && (p === '/api/setup' || p === '/api/retry' || p === '/api/sim')) return send(res, 403, { error: 'local' });
      if (p === '/api/practice') return send(res, ...await practiceAction(body));
      if (p === '/api/logo') return send(res, ...saveLogo(body));
      if (p === '/api/sim') return send(res, ...(body.action === 'advance' ? simAdvance() : body.action === 'ai' ? simSetAI(body.mode) : [400, { error: 'invalid' }]));
      if (p === '/api/intake') { const result = body.kind === 'note' ? receiveNote(body) : body.kind === 'prefill' ? receivePrefill(body) : receiveIntake(body); if (!result.ok) return send(res, 400, result); schedule(); return send(res, 202, result); }
      if (p === '/api/setup') {
        if (body.action === 'observe') return send(res, ...observeSetup(body));
        if (body.action === 'phone-open') return send(res, ...await openPhoneMode());
        if (body.action === 'phone-close') return send(res, ...await closePhoneMode());
        if (body.action === 'phone-accept') return send(res, ...decidePhone(body.id, true));
        if (body.action === 'phone-reject') return send(res, ...decidePhone(body.id, false));
        // 撤銷一部已配對裝置（只限已配對嘅本機瀏覽器可按；撤銷自己嗰部之後，呢個瀏覽器下一次讀回就會見到配對指引）
        if (body.action === 'revoke') return send(res, ...revokePass(body.id));
        if (body.action === 'openFolder' || body.action === 'runNow') {
          if (Object.keys(body).some(k => k !== 'action')) return send(res, 400, { error: 'invalid' });
          if (body.action === 'openFolder') {
            // 只開固定嘅收件匣；測試同無畫面環境（SOS_NO_OPEN）唔開
            if (process.env.SOS_NO_OPEN) return send(res, 200, { ok: true, opened: false });
            const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            try { spawn(cmd, [DIR.inbox], { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch { return send(res, 500, { error: 'open' }); }
            return send(res, 200, { ok: true, opened: true });
          }
          const hl = (readJSON(path.join(DIR.ledger, 'state.json'), null) || {}).health || {};
          if (hl.pausedByFounder || hl.autoStopped) return send(res, 409, { error: 'stopped', message: hl.pausedByFounder ? NAMES.ui.skip_pausedByFounder : NAMES.ui.skip_autoStopped });
          if (child) return send(res, 409, { error: 'busy', message: NAMES.ui.runNowBusy });
          kick(['--type', 'on-demand', '--trigger', 'manual']);
          return send(res, 202, { ok: true });
        }
        if (body.action !== 'certify' || !hosts(ROOT).some(h => h.id === body.host)) return send(res, 400, { error: 'invalid' });
        if (certChild) return send(res, 409, { error: 'busy' });
        certStartedAt = localIso();
        certChild = spawn(process.execPath, [path.join(ROOT, 'certify.mjs'), body.host, String(PORT)], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
        certChild.on('error', () => { certChild = null; });
        certChild.on('exit', () => {
          certChild = null;
          const c = readJSON(path.join(DIR.ledger, 'certify-status.json'), null);
          if (c?.state !== 'passed') return;
          const st = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
          const ids = st.runs.filter(r => r.state === 'waiting' && r.waitingFor === 'ai-setup').map(r => r.id);
          if (ids.length) { fs.writeFileSync(path.join(DIR.ledger, 'retry-requested'), JSON.stringify({ runIds: ids, at: localIso() })); schedule(200); }
        });
        return send(res, 202, { ok: true });
      }
      if (p === '/api/retry') {
        fs.writeFileSync(path.join(DIR.ledger, 'retry-requested'), JSON.stringify({ runId: /^R[\w-]{1,40}$/.test(String(body.runId || '')) ? body.runId : null, at: localIso() }));
        schedule(200);
        return send(res, 200, { ok: true });
      }
      const reply = typeof body.text === 'string' ? parseFounderReply(body.text) : null;
      if (!KINDS.includes(body.kind) || !/^[\w-]{1,80}$/.test(String(body.ref || '')) || !reply?.ok ||
        reply.head.kind !== body.kind || reply.head.ref !== body.ref) return send(res, 400, { error: 'invalid' });
      // 手機可以採用預設，但不得藉一般回覆改寫 G7 權限或 G8 經營節奏。
      if (phone && changesLocalOnly(body, reply)) return send(res, 403, { error: 'local' });
      // 收之前先核對：問題包要喺呢度（舊分頁、測試分頁送嚟嘅唔收，免得收咗先失敗）
      if (body.kind === 'ask-answer' && !loadPack(DIR, body.ref)) return send(res, 404, { error: 'pack-not-here', message: '此問題包已不在此處，可能是舊分頁。請返回 Founder Desk 查看最新問題。' });
      let name = `${fileStamp()}-${body.kind}-${body.ref}.md`, n = 1;
      while (fs.existsSync(path.join(DIR.replies, name))) name = `${fileStamp()}-${body.kind}-${body.ref}-${++n}.md`;
       const via = pass.kind === 'phone' ? `device:${pass.id}` : `browser:${pass.id.slice(0, 6)}`;
       const text = serverVia(body.text, via);
       fs.writeFileSync(path.join(DIR.replies, name), text, { flag: 'wx' });
      say(`收到創辦人${body.kind === 'proofread' ? '確認' : '答案'}：${name}`);
      schedule();
      return send(res, 200, { ok: true, file: name, receivedAt: localIso() });
    }
    if (p.startsWith('/api/')) return send(res, 405, { error: 'method' });
    send(res, 404, { error: 'not found' });
  } catch (e) {
    // 總攔截：畫面只收固定代號同中文原因；錯誤原文（可能有英文同路徑）只寫入伺服器自己嘅紀錄
    const raw = String(e && e.message || e);
    const [code, status, key] = raw === 'too large' ? ['too-large', 413, 'err_tooLarge']
      : e instanceof SyntaxError ? ['bad-body', 400, 'err_badBody']
      : raw === 'body timeout' || raw === 'request aborted' ? ['cut', 400, 'err_cut']
      : ['server', 500, 'err_server'];
    say(`請求出錯（${req.method} ${String(req.url || '').split('?')[0].slice(0, 80)}）：${raw.slice(0, 300)}`);
    if (res.headersSent) { try { res.end(); } catch { } return; }
    if (code === 'too-large') res.setHeader('Connection', 'close');
    send(res, status, { error: code, message: NAMES.ui[key] });
  }
};
const server = http.createServer(handler);

// 「開始.cmd」（server.mjs --open）：自己開緊就經一次性連結開 Founder Desk；沿用緊另一個伺服器就請嗰個伺服器開（同 ask.mjs 一樣嘅叫法）
async function openBrowser() {
  if (!process.argv.includes('--open')) return;
  if (server.listening) { openPage('desk'); return; }
  try { await fetch(`${home()}api/pass/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk' }), signal: AbortSignal.timeout(3000) }); } catch { }
}

server.on('error', e => {
  if (e.code !== 'EADDRINUSE') { say('無法啟動：' + e.message); process.exit(1); }
  if (PORT - BASE_PORT < 9) { PORT++; server.listen(PORT, '127.0.0.1'); return; }
  say('找不到可用的連接埠，請關閉其他程式後再試');
  process.exit(1);
});

// 開機先睇附近嘅埠：同一個資料夾只可以有一個伺服器處理回覆。
// 同版已經開緊就沿用；舊版就閂咗佢再開新版；舊版做緊嘢（或者閂唔到）就今次照用佢，唔好兩個一齊處理。
async function sameFolderServers() {
  const found = [];
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    try {
      const response = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) });
      const j = response.ok ? await response.json() : null;
      if (j && (j.root === ROOT_ID || j.root === legacyRootId(DIR.data) && serverOwnership(p, Number(j.pid), ROOT) !== 'other')) { found.push({ port: p, j, legacy: false }); continue; }
    } catch { }
    // 0.32 只有公開 /api/status；絕不可因為它沒有 health 而略過，否則會留下未受通行證保護的舊入口。
    try {
      const response = await fetch(`http://127.0.0.1:${p}/api/status`, { signal: AbortSignal.timeout(800) });
      const j = response.ok ? await response.json() : null;
      if (j && Number(j.pid) > 0 && (j.root === ROOT_ID || j.root === legacyRootId(DIR.data) && serverOwnership(p, Number(j.pid), ROOT) !== 'other')) found.push({ port: p, j, legacy: true });
    } catch { }
  }
  return found;
}
// 舊協定的 HTTP 回覆不可證明 PID 身份：由作業系統核對該埠擁有者同命令列（共用 ask-lib.mjs）
const ownsServerPort = (port, pid) => ownsPort(port, pid, ROOT);
// 開機排隊：兩個同時開（例如 AI 同創辦人一齊開）會互相睇唔到，所以一次只准一個做開機檢查；
// 後嚟嗰個等前面嗰個開好，再檢查就會見到佢而沿用。排隊嗰個程序死咗就當冇人排緊。
async function startupLock() {
  const LOCK = path.join(DIR.ledger, 'server-start.lock');
  for (let i = 0; i < 75; i++) {
    try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return () => { try { fs.unlinkSync(LOCK); } catch { } }; }
    catch {
      let pid = 0; try { pid = Number(fs.readFileSync(LOCK, 'utf8')); } catch { continue; }
      let alive = false; try { process.kill(pid, 0); alive = true; } catch { }
      if (!alive) { try { fs.unlinkSync(LOCK); } catch { } continue; }
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return () => { };
}
async function start() {
  const release = await startupLock();
  let killed = false;
  for (const { port, j, legacy } of await sameFolderServers()) {
    const wantsReplace = (legacy || j.version !== SERVER_VERSION) && !j.busy && Number(j.pid) > 0;
    const canKill = wantsReplace && ownsServerPort(port, Number(j.pid));
    if (!canKill) {
      PORT = port;
      say(!legacy && j.version === SERVER_VERSION ? '已在運行，直接開啟頁面'
        : j.busy ? (legacy ? '沒有通行證功能的舊版正在處理工作；為保護資料，完成後再打開 Founder Desk 便會更換為新版' : '舊版正在處理工作，今次繼續使用；完成後再打開 Founder Desk 便會更換為新版')
          : wantsReplace ? '無法獨立核對舊版程序身份，已停止換版，沒有終止任何程序。' : '有舊版正在運行但無法關閉，今次繼續使用');
      release(); await openBrowser(); setTimeout(() => process.exit(0), 500); return;
    }
    try { process.kill(Number(j.pid)); killed = true; say(`發現${legacy ? '沒有通行證功能的' : ''}舊版正在運行（${port}），已關閉並改用新版`); } catch { }
  }
  if (killed) await new Promise(r => setTimeout(r, 800));
  server.listen(PORT, '127.0.0.1', () => {
    release();
    say(`Founder Desk 已開：${home()}`);
    if (SIM) say('模擬實例：模擬資料，不是生意證據；時間按模擬時鐘');
    const ai = certified(ROOT, DIR.ledger); say(ai.host ? `AI 工具：${ai.label}（已認證）` : 'AI 工具未設定');
    say('使用頁面期間請勿關閉此視窗；關閉後便會停止。');
    if (pendingFiles().length || pendingMatches(DIR).length) { say('有上次未處理的回覆或辯論回合，現在補做'); schedule(500); }
    openBrowser();
  });
}
start();
