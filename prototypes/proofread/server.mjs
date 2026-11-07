// CrewZero：本機伺服器。由 AI 對話打開 CrewZero（Claude Code /crewzero:dashboard、Codex $crewzero:dashboard、Antigravity /dashboard，即 ask.mjs --dashboard）或者 AI 出題時自動喺背景起，創辦人唔使理；「開始.cmd」只係技術後備。
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { receiveAttachments, collectLinks, rereadLink } from './inbound-lib.mjs';
import { applyActorOp, ACTOR_OPS, ownerKind } from './people-ops.mjs';
import { parseGoogleLink } from './link-fetch.mjs';
import { hosts,version, clearCliTrust, certified, certCurrent, cleanEnv, resolveCommand, preparedAdapter, restrictions } from './host-lib.mjs';
import { rhythmOf, nextRunAt, ymd, scheduleEligibility } from './rhythm-lib.mjs';
import { provenanceOf, provenanceLine, unconfirmed, loadPrefills } from './prefill-lib.mjs';
import { confirmedDigest, confirmedSnapshot, NAMES, localIso, clockNow, isSim, writeJSON, readJSON, dataDirs, listPacks, loadPack, loadAnswers, readLog, rootId, legacyRootId, ownsServerPort as ownsPort, serverOwnership, INTAKE_QUESTIONS, BIZ_TYPES, intakeQuestions, bizTypeLabel, SERVER_VERSION, BASE_PORT as DEFAULT_PORT, parseFounderReply, validateAskReply } from './ask-lib.mjs';
import { dashboardState, touchLastSeen, pendingTodo, pendingSnoozed, guideCard, companyLogo, LOGO_EXTS, workStatus, pendingFounderOps, applyFounderOps, overviewIsCurrent, inputList, inputView, runNowPreview, resolveDataFile } from './dash-lib.mjs';
import { listScenarios, loadScenario, listSessions, loadSession, startSession, say as practiceSay, undo as practiceUndo, finish as practiceFinish, stopAll as practiceStop } from './practice-lib.mjs';
import { TOPIC_TYPES, SEATS, LEVELS, formatFor, passesFor, listMatches, loadMatch, summaryOf, pendingMatches } from './debate-lib.mjs';
import { brainSource, counterpartsOf } from './brain-lib.mjs';
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
const FOUNDER_OPS = path.join(DIR.ledger, 'founder-ops.json');
const FOUNDER_OPS_LOCK = path.join(DIR.ledger, '.founder-ops.lock');
// 認證屬邊一種：模擬用假 AI（SOS_ADAPTER 指住嘅設定）係假 AI，其餘係真 AI
const aiMode = c => c && (c.host === 'test' || (process.env.SOS_ADAPTER && path.resolve(String(c.host)) === path.resolve(process.env.SOS_ADAPTER))) ? 'fake' : 'real';
const SIM_FILE = path.join(DESK_DIR, 'sim.json'), CLOCK_FILE = path.join(DESK_DIR, 'sim-clock.json'), CERT_FILE = path.join(DIR.ledger, 'adapter-cert.json');
// 每次開伺服器都唔同：頁面用嚟知道「伺服器重新開過，頁面可能過時」
const INSTANCE = `${process.pid}-${Date.now()}`;
// 唔係創辦人真資料嘅實例（模擬、示範、測試）：SOS_DATA 指向獨立資料夾先算。正實例永遠唔會設 SOS_DATA。
// 只有呢類實例 POST /api/pass/open 先會喺回應附上一次性連結（畀零費用測試兌換）；正實例永不回傳。
const TEST_INSTANCE = SIM || (!!suppliedData && suppliedIsDefault === false);
// 取回 Google 連結用的 fetch：正實例永遠是系統的 fetch；測試實例可用 SOS_FETCH_MODULE 換成本機假的（測試不連外網）
let FETCH_IMPL = globalThis.fetch;
if (TEST_INSTANCE && process.env.SOS_FETCH_MODULE) { try { FETCH_IMPL = (await import(pathToFileURL(path.resolve(process.env.SOS_FETCH_MODULE)).href)).default; } catch { } }

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
  // 測試只記低「會開」：唔碰系統瀏覽器，亦唔改正式開頁行為。
  if (TEST_INSTANCE && process.env.SOS_TEST_OPEN_LOG) { try { fs.appendFileSync(process.env.SOS_TEST_OPEN_LOG, url + '\n'); return true; } catch { return false; } }
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
const SHARED = ['md.js', 'names.js', 'desk.js', 'orbit.js', 'pair.js', 'celebration.js'];
const FILES = { '/': 'ask.html', '/ask.html': 'ask.html', '/proofread.html': 'proofread.html', '/startup-background-template.md': 'startup-background-template.md', ...Object.fromEntries(SHARED.map(f => ['/' + f, f])) };
// 營運監察台：/dashboard（公司現況）、/dashboard/<分頁> 同 /dashboard/brain/<項目>，同一個頁面檔
const DASH_TABS = ['path', 'brain', 'inputs', 'team', 'log', 'system'];
const BRAIN_PAGES = ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'];
let lastSeenPrev = null;
const TYPES = { '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
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
let certChild = null, certStartedAt = '', kickArgsAfterCert = null;
// 自動同手動共用一條認證流程；通過先續做等候工作。
function startCertification(hostId) {
  if (certChild) return false;
  certStartedAt = localIso();
  try { certChild = spawn(process.execPath, [path.join(ROOT, 'certify.mjs'), hostId, String(PORT)], { cwd: ROOT, stdio: 'ignore', windowsHide: true }); }
  catch { certChild = null; return false; }
  // 開唔到認證程式只會出 error、唔會出 exit：兩條路共用一次收尾，已提交嘅工作唔會卡住
  let ended = false;
  const finishCert = spawnFailed => {
    if (ended) return;
    ended = true;
    certChild = null;
    if (spawnFailed) try { writeJSON(path.join(DIR.ledger, 'certify-status.json'), { host: hostId, startedAt: certStartedAt, state: 'failed', items: [] }); } catch { }
    const c = readJSON(path.join(DIR.ledger, 'certify-status.json'), null);
    const st = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
    const ids = c?.state === 'passed' ? st.runs.filter(r => r.state === 'waiting' && r.waitingFor === 'ai-setup').map(r => r.id) : [];
    if (ids.length) fs.writeFileSync(path.join(DIR.ledger, 'retry-requested'), JSON.stringify({ runIds: ids, at: localIso() }));
    // 認證未通過都要交外殼：已提交嘅工作會顯示等候 AI 設定，唔會無聲卡住
    const queued = kickArgsAfterCert;
    kickArgsAfterCert = null;
    if (queued) { again = false; kick(queued); }
    else if (ids.length || again || pendingFiles().length || pendingMatches(DIR).length) { again = false; schedule(200); }
  };
  certChild.on('error', () => finishCert(true));
  certChild.on('exit', () => finishCert(false));
  return true;
}
let recertCheckedAt = 0, recertSlot = '';
function maybeRecertify(force = false) {
  if (certChild || child || isDemoInstance() || (!force && Date.now() - recertCheckedAt < 10 * 60000)) return false;
  recertCheckedAt = Date.now();
  const c = certified(ROOT, DIR.ledger);
  if (!c.versionOnly) return false;
  const file = path.join(DIR.ledger, 'recert-attempt.json'), prior = readJSON(file, null);
  if (prior?.host === c.hostId && prior.version === c.version) return false;
  // 先記低再啟動，失敗或中斷都唔會無限再試。
  try { writeJSON(file, { host: c.hostId, version: c.version, at: localIso() }); } catch { return false; }
  return startCertification(c.hostId);
}
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
  clearCliTrust(h);
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
// 只有仍然有效的認證才算已設定：設定變更後舊紀錄不再當作通過
const certInfo = () => { const c = readJSON(path.join(DIR.ledger, 'adapter-cert.json'), null); return c && certCurrent(ROOT, DIR.ledger) ? { host: c.host, label: c.label, certifiedAt: c.certifiedAt } : null; };
const certStale = () => !!readJSON(path.join(DIR.ledger, 'adapter-cert.json'), null) && !certCurrent(ROOT, DIR.ledger);
const WELCOME_FILE = path.join(ROOT, 'welcome.html'), WELCOME_SEEN = path.join(DESK_DIR, 'welcome-seen.json');
let welcomeSeenInMemory = false, demoOpeningAt = 0;
function isDemoInstance() {
  if (SIM || samePhysicalPath(DIR.data, path.join(ROOT, 'demo-data')) === true) return true;
  return (readJSON(path.join(DIR.ledger, 'state.json'), null) || {}).demo === true;
}
function welcomeSeen() {
  if (welcomeSeenInMemory) return true;
  try { return fs.existsSync(WELCOME_SEEN); } catch { return false; }
}
function markWelcomeSeen() {
  welcomeSeenInMemory = true;
  try { fs.mkdirSync(DESK_DIR, { recursive: true }); writeJSON(WELCOME_SEEN, { at: localIso() }); } catch { }
}
function hasCompanyData() {
  return companyStatus().ready || fs.existsSync(path.join(DIR.company, 'biz.json'));
}
function shouldShowWelcome() {
  return !certInfo() && !hasCompanyData() && !welcomeSeen() && !isDemoInstance() && process.env.CZ_NO_WELCOME !== '1';
}
function openDemo() {
  if (isDemoInstance()) return [409, { error: 'demo' }];
  if (Date.now() - demoOpeningAt < 10000) return [429, { error: 'busy', message: NAMES.ui.openTooSoon }];
  const env = cleanEnv();
  delete env.SOS_DATA; delete env.SOS_SIM; delete env.SOS_PORT;
  try {
    demoOpeningAt = Date.now();
    const c = spawn(process.execPath, [path.join(ROOT, 'ask.mjs'), '--dashboard', '--demo'], { cwd: ROOT, env, detached: true, stdio: 'ignore', windowsHide: true });
    c.on('error', () => { demoOpeningAt = 0; say('未能打開示範'); });
    c.unref();
    return [202, { ok: true }];
  } catch { return [500, { error: 'open' }]; }
}

/* ---------- 排隊：去抖、一次一個、做完見仲有就再做 ---------- */
let child = null, again = false, timer = null;
function schedule(ms = 1500) { clearTimeout(timer); timer = setTimeout(() => kick(), ms); }
// args：排程 run 嘅類型同觸發（模擬計時器用）；你送出後嘅 run 唔帶參數。一次只准一個外殼程序
function kick(args) {
  maybeRecertify();
  // 認證期間按「立即開工」：保留參數，認證完先照做，唔會變成無參數嘅工作
  if (certChild) { if (args) kickArgsAfterCert = args; again = true; return false; }
  if (child) { again = true; return false; }
  say(args ? '排定時間到，交外殼做日常工作' : '有新內容，交外殼處理');
  child = spawn(process.execPath, [path.join(ROOT, 'run.mjs'), ...(args || [])], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  // 開唔到外殼會出 error 而唔係 exit：同樣清走 child，計時器先可以重試；冇 listener 成個伺服器會死
  let ended = false;
  child.on('error', () => { say('未能啟動外殼，稍後再試'); onEnd(); });
  child.on('exit', onEnd);
  function onEnd() {
    if (ended) return; ended = true;
    child = null;
    const last = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] }).runs[0];
    if (last) say(`處理完：${last.state === 'done' ? '完成' : last.state === 'failed' ? '失敗 - ' + (last.error || '') : last.state}`);
    if (again || pendingFiles().length || fs.existsSync(path.join(DIR.ledger, 'retry-requested')) || pendingMatches(DIR).length) { again = false; schedule(300); }
  }
  return true;
}
// 排程計時器：模擬每 5 秒、真實實例每 30 秒。未經批准（冇 mode:server 標記）唔會開 AI；你嘅回覆永遠排先。
let firedDay = null;
function overviewCurrent() { return overviewIsCurrent(readJSON(path.join(DIR.company, 'page.json'), null), readJSON(path.join(DIR.ledger, 'confirmed.json'), null)); }
function rhythmTick() {
  maybeRecertify();
  if (certChild) return;
  if (child || pendingFiles().length || fs.existsSync(path.join(DIR.ledger, 'retry-requested')) || pendingMatches(DIR).length) return;
  const s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  if (s.demo === true) return;
  const mark = readJSON(path.join(DIR.ledger, 'schedule.json'), null);
  // 模擬實例沿用原本嘅 5 秒試走；真實資料先必須有創辦人嘅 server 授權。
  if (!SIM && (!mark || mark.mode !== 'server')) return;
  // 節奏剛由系統頁提交時，先叫外殼合併；唔可以用舊設定喺中間開工。
  if (pendingFounderOps(DIR, s).some(op => op && op.op === 'setRhythm')) { kick(); return; }
  const rhythm = rhythmOf(s), slot = scheduleEligibility(rhythm, clockNow(), { approvedAt: !SIM ? mark?.approvedAt : '', updatedAt: !SIM ? rhythm.updatedAt : '' }).slot;
  if (!slot) return;
  const day = ymd(slot), recorded = (s.runs || []).some(r => r.trigger === 'schedule' && r.slot === day);
  if (recorded) { if (firedDay && firedDay.day === day) firedDay = null; return; }
  if (recertSlot !== day) { recertSlot = day; maybeRecertify(true); }
  if (certChild) return;
  if (firedDay && firedDay.day === day) {
    if (Date.now() - firedDay.at > 120000) firedDay = null;
    else return;
  }
  if (kick(['--type', 'auto', '--trigger', 'schedule', '--slot', day])) firedDay = { day, at: Date.now() };
}
const rhythmTimer = setInterval(rhythmTick, SIM ? 5000 : 30000);
if (!SIM) rhythmTimer.unref();
function simInfo() {
  if (!SIM) return null;
  const sim = readJSON(SIM_FILE, {}) || {}, c = readJSON(CERT_FILE, null), s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  const now = clockNow(), ranToday = (s.runs || []).some(r => r.trigger === 'schedule' && r.slot === ymd(now));
  const next = nextRunAt(rhythmOf(s), now, { ranToday }), last = (s.runs || []).filter(r => r.trigger === 'schedule').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).pop();
  return { on: true, clock: localIso(clockNow()), offsetDays: Math.round(((readJSON(CLOCK_FILE, {}) || {}).offsetMs || 0) / 86400000 * 10) / 10,
    ai: c ? aiMode(c) : sim.ai || 'fake', aiReady: !!c, persona: sim.persona || null, nextRunAt: next ? localIso(next) : '', lastScheduleAt: last ? last.startedAt : '' };
}
// 推前一日：時鐘推到下一次排定開工時間後三分鐘（每日一次即剛好一日），由計時器觸發嗰次排程
function simAdvance() {
  if (child) return [409, { error: 'busy', message: 'Zero 工作進行中，完成後再推前。' }];
  const now = clockNow(), s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}, ranToday = (s.runs || []).some(r => r.trigger === 'schedule' && r.slot === ymd(now));
  const next = nextRunAt(rhythmOf(s), now, { ranToday });
  if (!next) return [400, { error: 'invalid' }];
  fs.mkdirSync(DESK_DIR, { recursive: true });
  const off = Number((readJSON(CLOCK_FILE, {}) || {}).offsetMs) || 0;
  writeJSON(CLOCK_FILE, { offsetMs: off + (next.getTime() + 3 * 60000 - now.getTime()), at: new Date().toISOString() });
  return [200, { ok: true, clock: localIso(new Date(next.getTime() + 3 * 60000)) }];
}
// 模擬用 AI：假 AI（零費用）同真 AI 各自保存一份認證；切換只係換用邊份，冇就要喺系統設定頁認證一次
function simSetAI(mode) {
  if (!['fake', 'real'].includes(mode)) return [400, { error: 'invalid' }];
  if (child || certChild) return [409, { error: 'busy', message: 'Zero 工作進行中，完成後再切換。' }];
  fs.mkdirSync(DESK_DIR, { recursive: true });
  const cur = readJSON(CERT_FILE, null);
  if (cur) fs.copyFileSync(CERT_FILE, path.join(DESK_DIR, 'sim-cert-' + aiMode(cur) + '.json'));
  const want = path.join(DESK_DIR, 'sim-cert-' + mode + '.json');
  if (fs.existsSync(want)) fs.copyFileSync(want, CERT_FILE); else fs.rmSync(CERT_FILE, { force: true });
  writeJSON(SIM_FILE, { ...(readJSON(SIM_FILE, {}) || {}), ai: mode });
  hostCache = null;
  return [200, { ok: true, ai: mode, ready: fs.existsSync(CERT_FILE) }];
}
const pendingFiles = () => [...fs.readdirSync(DIR.replies).filter(f => f.endsWith('.md')), ...fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md') || f.endsWith('-prefill.md') || /-note-(?:order|adhoc|help|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc|ideate)\.md$/.test(f))].sort();
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

async function receiveIntake(body) {
  const fail = message => ({ error: 'invalid', message });
  if (!body || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || !Array.isArray(body.files)) return fail('請填寫資料並檢查附件。');
  const bizType = typeof body.bizType === 'string' ? body.bizType : '';
  if (body.bizType != null && body.bizType !== '' && (typeof body.bizType !== 'string' || !BIZ_TYPES[body.bizType])) return fail('請選擇有效的生意類別。');
  const bizOther = typeof body.bizOther === 'string' ? body.bizOther.trim() : '';
  if (body.bizOther != null && typeof body.bizOther !== 'string') return fail('其他類別的說明必須是文字。');
  if (bizOther.length > 60) return fail('其他類別的說明不可超過 60 字。');
  const fields = {};
  for (const q of INTAKE_QUESTIONS) {
    const value = body.fields['q' + q.n] ?? '';
    if (typeof value !== 'string' || value.length > 4000 || (q.required && !value.trim())) return fail('請填寫第 1 條問題，每欄最多 4000 字。');
    fields['q' + q.n] = value;
  }
  if (Object.keys(body.fields).some(k => !/^q[1-8]$/.test(k)) || Buffer.byteLength(Object.values(fields).join(''), 'utf8') > 32 * 1024) return fail('填寫的文字太長，請把較長的內容改為文件附上，再送出。');
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
  const machine = { format: 'startup-os.intake/0.1', id, ...(bizType ? { bizType, bizOther: bizType === 'other' ? bizOther : '' } : {}), fields, files: records, ...(prefill ? { prefillId } : {}), provenance };
  const text = '# ' + NAMES.ui.intake + '\n\n' + (bizType ? '生意類別：' + bizTypeLabel(bizType, bizOther) + '\n\n' : '') + intakeQuestions(bizType).map(q => `## ${q.n}. ${q.ask}\n\n${fields['q' + q.n]}\n${fields['q' + q.n].trim() ? '\n' + provenanceLine(provenance['q' + q.n]) + '\n' : ''}`).join('\n') + '\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n';
  const created = [];
  try {
    await receiveAttachments({ id, type: 'intake', base: `${id}-intake-`, metaName: `${id}-meta-intake.json`, attachments: files, text: Object.values(fields).join('\n'), links: Array.isArray(body.links) ? body.links.filter(u => typeof u === 'string' && u.length <= 2048).slice(0, 10) : [], inboxDir: DIR.inbox, fetchImpl: FETCH_IMPL, created });
    const p = path.join(DIR.inbox, `${id}-intake.md`); fs.writeFileSync(p, text, { flag: 'wx' }); created.push(p);
    if (bizType && !fs.existsSync(path.join(DIR.company, 'biz.json'))) writeJSON(path.join(DIR.company, 'biz.json'), { type: bizType, other: bizType === 'other' ? bizOther : '' });
    const ideate = readJSON(path.join(DIR.ledger, 'ideate.json'), null);
    if (ideate) writeJSON(path.join(DIR.ledger, 'ideate.json'), { ...ideate, state: 'closed', reason: '', updatedAt: localIso() });
  } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
  return { ok: true, id, receivedAt: localIso() };
}

/* ---------- 由文件預填（規劃書 3.1）：只有附件，唔含答案；AI 只讀文件交返八條預填，唔擬公司概覽、唔建任何紀錄 ---------- */
async function receivePrefill(body) {
  const fail = message => ({ error: 'invalid', message });
  const links = Array.isArray(body.links) ? body.links.filter(u => typeof u === 'string' && u.length <= 2048).slice(0, 10) : [];
  if (!Array.isArray(body.files) || (!body.files.length && !collectLinks('', links).length)) return fail('請先加入文件。');
  const got = takeFiles(body.files);
  if (got.error) return fail(got.error);
  const bizType = typeof body.bizType === 'string' ? body.bizType : '';
  if (body.bizType != null && body.bizType !== '' && (typeof body.bizType !== 'string' || !BIZ_TYPES[body.bizType])) return fail('請選擇有效的生意類別。');
  const bizOther = typeof body.bizOther === 'string' ? body.bizOther.trim().slice(0, 60) : '';
  const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
  const records = got.files.map((f, i) => ({ name: f.name, stored: `${id}-prefill-${pad(i + 1)}-${f.name}`, bytes: f.bytes.length }));
  const machine = { format: 'startup-os.prefill/0.1', id, files: records, ...(bizType ? { bizType, bizOther: bizType === 'other' ? bizOther : '' } : {}) };
  const created = [];
  try {
    await receiveAttachments({ id, type: 'prefill', base: `${id}-prefill-`, metaName: `${id}-meta-prefill.json`, attachments: got.files, text: '', links, inboxDir: DIR.inbox, fetchImpl: FETCH_IMPL, created });
    const p = path.join(DIR.inbox, `${id}-prefill.md`); fs.writeFileSync(p, '# 由文件預填（只讀文件，不含答案）\n\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n', { flag: 'wx' }); created.push(p);
  } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
  return { ok: true, id, receivedAt: localIso() };
}
// 預填進度：外殼核對好嘅結果喺 ledger/prefill/<id>.json；未有就睇嗰次 AI 工作嘅狀態
function ideateStatus() {
  const s = readJSON(path.join(DIR.ledger, 'ideate.json'), null);
  if (!s) return null;
  return { state: s.state, round: s.round, packId: ((s.rounds || []).find(r => r.round === s.round) || {}).packId || '', prefillId: s.prefillId || '', reason: s.reason || '' };
}
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
const NOTE_TYPES = ['order', 'adhoc', 'help', 'feedback', 'brain-decide', 'practice-prep', 'debrief', 'debate-start', 'debate-action', 'event', 'doc', 'ideate'];
const BRAIN_ITEMS = ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'];
const DEBATE_ACTIONS = ['respond', 'adopt', 'reattack2', 'rerun'];
async function receiveNote(body, opts = {}) {
  const fail = message => ({ error: 'invalid', message });
  if (!NOTE_TYPES.includes(body.type)) return fail('要求類型不正確。');
  if (body.type === 'ideate') {
    if (body.text != null && typeof body.text !== 'string') return fail(NAMES.ui.ideateTooLong);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (text.length > 1000) return fail(NAMES.ui.ideateTooLong);
    if (companyStatus().ready) return fail(NAMES.ui.ideateHasOverview);
    const stateFile = path.join(DIR.ledger, 'ideate.json'), prev = readJSON(stateFile, null);
    // 重複按鈕不新增工作；失敗才由原進度續行。
    if (prev && ['running', 'asking', 'ready'].includes(prev.state)) return { ok: true, id: prev.id, receivedAt: prev.updatedAt };
    const checked = certified(ROOT, DIR.ledger);
    if (!checked.host) return { error: 'ai', message: NAMES.ui.err_ai };
    const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
    const session = prev && prev.state === 'failed' ? prev : { id, round: 1, say: text, rounds: [], prefillId: '' };
    const file = path.join(DIR.inbox, `${id}-note-ideate.md`);
    fs.writeFileSync(file, `kind: note\ntype: ideate\nat: ${localIso()}\n\n${text}\n`, { flag: 'wx' });
    try { writeJSON(stateFile, { ...session, state: 'running', reason: '', updatedAt: localIso() }); }
    catch (e) { fs.unlinkSync(file); throw e; }
    return { ok: true, id, receivedAt: localIso() };
  }
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
    if (body.type === 'practice-prep') { m.who = typeof body.who === 'string' ? body.who.trim().slice(0, 200) : ''; m.counterpartId = /^[\w-]{1,60}$/.test(String(body.counterpartId || '')) ? body.counterpartId : ''; if (m.counterpartId && !counterpartsOf(DIR).some(p => p.id === m.counterpartId)) return fail('請重新選擇對方。'); if (!m.taskId && !say && !m.who && !m.counterpartId) return fail('請說明要練習哪一個會面。'); }
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
    const machine = { cardId: body.cardId, item: body.item, verdict: body.verdict || '', text: say,
      ...(body.type === 'brain-decide' && /^[\w-]{1,40}$/.test(String(body.matchId || '')) ? { matchId: body.matchId } : {}) };
    // 規劃書 4.9：結果卡意見檔名為時間前綴加 feedback-（項目），決定沿用 note-
    const fname = body.type === 'feedback' ? `${id}-feedback-${body.item}.md` : `${id}-note-${body.type}.md`;
    fs.writeFileSync(path.join(DIR.inbox, fname), `kind: note\ntype: ${body.type}\nat: ${localIso()}\n\n${say || '（沒有填寫意見）'}\n\n\`\`\`json\n${JSON.stringify(machine)}\n\`\`\`\n`, { flag: 'wx' });
    return { ok: true, id, receivedAt: localIso() };
  }
  if (body.type === 'doc') return receiveWork(body, opts);
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
  return receiveWork(body, opts);
}
// 發生了一件事（含只附文件）、請 Zero 做一件事、想改計劃：三類同一道門檻（公司概覽已確認）、同一套附件處理（Office 轉文字、Google 連結取回、說明檔）。
// opts.source 只供 /api/tell（與 Zero 的討論）傳入 'chat'；網頁送出的 body.source 一律不理。
async function receiveWork(body, opts = {}) {
  const fail = message => ({ error: 'invalid', message });
  const type = body.type;
  if (!readJSON(path.join(DIR.ledger, 'confirmed.json'), null)) return fail(NAMES.ui.needOverviewAll);
  const rawText = body.text == null ? '' : body.text;
  if (typeof rawText !== 'string') return fail('內容必須是文字。');
  const text = rawText.trim();
  if (text.length > 4000) return fail('最多 4000 字。');
  const list = body.files == null ? [] : body.files;
  if (!Array.isArray(list)) return fail('附件格式不正確，請重新選擇。');
  const links = body.links == null ? [] : body.links;
  if (!Array.isArray(links) || links.length > 10 || links.some(u => typeof u !== 'string' || u.length > 2048)) return fail('連結格式不正確。');
  const hasLink = collectLinks(text, links).length > 0;
  if (type === 'doc' ? !list.length && !hasLink : type === 'event' ? !text && !list.length && !hasLink : !text) return fail(type === 'doc' ? '請先加入文件。' : type === 'event' ? '請寫下發生了甚麼事，或加入文件。' : '請用一兩句寫下你的要求（最多 4000 字）。');
  // 事件日期由創辦人在頁面填（唔係提交時間）；只有與 Zero 的討論（chat）可以不寫，當日算
  if (type === 'event' && opts.source !== 'chat' && !body.date) return fail('請選擇事件日期。');
  if (body.date != null && body.date !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date)) || isNaN(new Date(body.date + 'T00:00:00')))) return fail('請選擇事件日期。');
  const date = body.date ? String(body.date) : localIso().slice(0, 10);
  const got = takeFiles(list);
  if (got.error) return fail(got.error);
  const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
  const created = [];
  try {
    const { records, meta } = await receiveAttachments({ id, type, attachments: got.files, text, links, inboxDir: DIR.inbox, fetchImpl: FETCH_IMPL, created, source: opts.source });
    // 只貼連結、沒有寫字也沒有附件，而連結全部讀不到：沒有東西可交給 Zero，清掉說明檔並告訴創辦人怎樣做
    if (!text && !records.length) { for (const p of created) try { fs.unlinkSync(p); } catch { } return fail(NAMES.ui.linkNotShared); }
    const body2 = type === 'event' || type === 'doc' ? `${text || '（沒有補充）'}\n\n\`\`\`json\n${JSON.stringify({ date, files: records })}\n\`\`\`\n` : `${text}\n`;
    const p = path.join(DIR.inbox, `${id}-note-${type}.md`);
    fs.writeFileSync(p, `kind: note\ntype: ${type}\nat: ${localIso()}\n\n${body2}`, { flag: 'wx' }); created.push(p);
    return { ok: true, id, receivedAt: localIso(), ...(meta.linkErrors.length ? { linkErrors: meta.linkErrors } : {}) };
  } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch { } throw e; }
}
// 重新讀取一件已收輸入中的 Google 連結：取回新快照存進同一封存資料夾（舊快照保留），再把「換用新快照」交給外殼寫入帳本（伺服器不直接寫帳本）。
// 只限已配對頁面（呼叫處已驗通行證）；每條連結每分鐘一次；失敗時不留任何新檔、不排任何帳本改動（舊快照與讀取日期不變）；不自動重做 AI 工作。
const rereadAt = new Map(), REREAD_DIR = path.join(DIR.ledger, 'rereads');
async function rereadInput(body) {
  const id = String(body && body.id || ''), n = Number(body && body.n);
  if (!/^[\w-]{1,80}$/.test(id) || !Number.isInteger(n) || n < 0 || n > 60) return [400, { error: 'invalid', message: NAMES.ui.rereadFailed }];
  const state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  const input = (state.inputs || []).find(i => i && i.id === id);
  const info = input && Array.isArray(input.files) && input.files[n] ? (input.fileInfo || []).find(x => x && x.file === input.files[n] && x.url) : null;
  if (!info || !parseGoogleLink(info.url)) return [404, { error: 'not found', message: NAMES.ui.rereadFailed }];
  const key = id + ':' + n;
  if (Date.now() - (rereadAt.get(key) || 0) < 60000) return [429, { error: 'rate', message: NAMES.ui.rereadBusy }];
  rereadAt.set(key, Date.now());
  const abs = path.resolve(DIR.data, info.file), dir = path.dirname(abs);
  let inside = false;
  try { const root = fs.realpathSync(DIR.archive); const real = fs.realpathSync(dir); inside = real === root || real.startsWith(root + path.sep); } catch { }
  if (!inside || !fs.existsSync(abs)) return [404, { error: 'not found', message: NAMES.ui.rereadFailed }];
  const base = path.basename(abs, path.extname(abs)).replace(/-r\d{8}-\d{6}$/, '');
  const r = await rereadLink({ url: info.url, dir, baseName: base, fetchImpl: FETCH_IMPL });
  if (!r.ok) return [422, { error: 'reread', reason: r.reason, message: NAMES.ui.rereadFailed }];
  const rel = f => path.relative(DIR.data, path.join(dir, f)).replace(/\\/g, '/');
  const fresh = { file: rel(r.fresh.file), ...(r.fresh.text ? { text: rel(r.fresh.text) } : {}), readOn: r.fresh.readOn };
  try {
    fs.mkdirSync(REREAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(REREAD_DIR, `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}.json`), JSON.stringify({ inputId: id, n, fresh }), { flag: 'wx' });
  } catch { for (const p of r.created) try { fs.unlinkSync(p); } catch { } return [500, { error: 'reread', message: NAMES.ui.rereadFailed }]; }
  schedule(200);
  return [202, { ok: true, readOn: fresh.readOn, message: NAMES.ui.rereadOk }];
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
    if (!host) return [409, { error: 'ai', message: 'AI 工具尚未設定，練習需要 Zero 扮演對方。' }];
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
    if (!host) return [409, { error: 'ai', message: 'AI 工具尚未設定，練習需要 Zero 扮演對方。' }];
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
  const found = [], add = (packId, ref, noteId) => {
    const pack = /^[\w-]{1,80}$/.test(String(packId || '')) ? String(packId) : '';
    const runRef = /^[\w-]{1,80}$/.test(String(ref || '')) ? String(ref) : '';
    if ((pack || runRef) && !found.some(x => x.packId === pack && x.ref === runRef)) found.push({ packId: pack, ref: runRef, noteId: String(noteId || '') });
  };
  for (const file of fs.readdirSync(DIR.inbox).filter(f => /-note-help\.md$/.test(f))) {
    try {
      const parsed = parseFounderReply(fs.readFileSync(path.join(DIR.inbox, file), 'utf8'));
      const context = (parsed.machine || {}).context || {};
      add(context.packId, context.runRef, file.replace(/-note-help\.md$/, ''));
    } catch { }
  }
  for (const run of (status.runs || [])) if (run && run.kind === 'note' && run.noteType === 'help' && ['running', 'waiting'].includes(run.state)) add(run.helpForPackId, run.helpForRunRef, run.ref);
  return found;
}

const CELEBRATIONS_SEEN = path.join(DIR.ledger, 'celebrations-seen.json');
function celebrationState() {
  const entries = ((readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}).celebrations || {}).entries || [];
  const seen = new Set((readJSON(CELEBRATIONS_SEEN, {}) || {}).seen || []);
  return { entries, seen };
}
function claimCelebration(id) {
  const { entries, seen } = celebrationState();
  if (typeof id !== 'string' || !entries.some(entry => entry.id === id)) return [400, { error: 'invalid' }];
  if (seen.has(id)) return [200, { ok: true, claimed: false }];
  seen.add(id);
  writeJSON(CELEBRATIONS_SEEN, { seen: [...seen] });
  return [200, { ok: true, claimed: true }];
}
function statusPayload() {
  const st = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
  const todo = pendingTodo(DIR);
  const work = workStatus(DIR, { outerAlive: shellAlive(), pending: pendingFiles(), status: st });
  const failedByRef = (st.runs || []).filter(r => r && r.state === 'failed' && r.ref).reduce((all, r) => ({ ...all, [r.ref]: (all[r.ref] || 0) + 1 }), {});
  const runs = (st.runs || []).slice(0, 5).map(r => r && r.state === 'failed' && r.ref && failedByRef[r.ref] >= 2 ? { ...r, repeatFailed: true } : r);
  // 最近一次公司概覽工作（kind 為 proofread）已跌出最近五項時另外附上：校對頁靠它認得出「送出後頁面關閉、之後才套用失敗」的那一份回覆。
  // 不帶 result（只為認出回覆檔與失敗步，避免每次輪詢都傳大段內容）；status.json 只保留 20 項工作，超過就沒有
  const lastOverview = (st.runs || []).find(r => r && r.kind === 'proofread');
  const lastOverviewRun = lastOverview && !runs.some(r => r && r.id === lastOverview.id) ? (({ result, ...rest }) => rest)(lastOverview) : null;
  return {
    ok: true, version: SERVER_VERSION, root: ROOT_ID, sim: simInfo(), sample: (readJSON(path.join(DIR.ledger, 'state.json'), null) || {}).demo === true, today: localIso().slice(0, 10), instance: INSTANCE, pid: process.pid, celebrations: (() => { const { entries, seen } = celebrationState(); return entries.filter(e => !seen.has(e.id)).slice(-5).reverse(); })(), ai: (() => { const c = certInfo(); return { name: c ? c.label : 'AI 工具', ready: !!c }; })(), busy: !!child,
    cert: certInfo(), aiStale: certStale(), certify: (() => { const c = certifyState(); return c ? { state: c.state } : null; })(), pending: pendingFiles(), runs, lastOverviewRun, work, openAsks: todo.filter(t => t.kind === 'ask').length, company: { ...companyStatus(), confirmedSnapshot: confirmedSnapshotNow() }, helpInFlight: helpInFlight(st), intake: (() => { const r = st.runs.find(r => r.kind === 'intake'); const f = fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md')).sort().at(-1); if (f && (!r || f.slice(0, -10) > r.ref)) return { id: f.slice(0, -10), state: 'pending', runId: null }; return r ? { id: r.ref, state: r.state, runId: r.id } : null; })()
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
// 校對頁用：目前這一頁已確認的內容（值、次序、類別、摘要）；只放在受通行證保護的 /api/status，不放進其他入口用的 companyStatus()
function confirmedSnapshotNow() {
  return confirmedSnapshot(readJSON(path.join(DIR.ledger, 'confirmed.json'), null), readJSON(path.join(DIR.company, 'page.json'), null));
}
function companyStatus() {
  const c = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const page = readJSON(path.join(DIR.company, 'page.json'), null), co = page?.company || {};
  const biz = readJSON(path.join(DIR.company, 'biz.json'), null);
  const { entries, seen } = celebrationState();
  return { name: co.name || '', initials: co.initials || '', logo: (companyLogo(DIR) || {}).v || 0, oneLiner: co.oneLiner || '', ready: !!page, pageId: page?.page?.id || '', confirmed: !!c, confirmedPageId: c?.pageId || '', confirmedDigest: c ? confirmedDigest(c, page) : '', confirmedAt: c ? c.confirmedAt : null, firstConfirmedAt: c ? (c.firstConfirmedAt || c.confirmedAt) : null, firstFlagSeen: entries.some(e => e.level === 'top' && seen.has(e.id)),
    ...(biz && BIZ_TYPES[biz.type] ? { bizType: biz.type } : {}) };
}
const isDay = value => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};
function founderOpsLockCanRecover() {
  try {
    const age = Date.now() - fs.statSync(FOUNDER_OPS_LOCK).mtimeMs;
    const pid = Number(String(fs.readFileSync(FOUNDER_OPS_LOCK, 'utf8')).trim());
    let ownerGone = false;
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (error) { ownerGone = !!(error && error.code === 'ESRCH'); }
    }
    return ownerGone || age > 60000;
  } catch { return false; }
}
function withFounderOpsLock(fn) {
  const until = Date.now() + 2000;
  let recovered = false;
  for (;;) {
    try { fs.writeFileSync(FOUNDER_OPS_LOCK, String(process.pid), { flag: 'wx' }); break; }
    catch {
      if (!recovered && founderOpsLockCanRecover()) {
        recovered = true;
        try { fs.rmSync(FOUNDER_OPS_LOCK, { force: true }); } catch { }
        continue;
      }
      if (Date.now() >= until) return null;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12);
    }
  }
  try { return fn(); } finally { fs.rmSync(FOUNDER_OPS_LOCK, { force: true }); }
}
function appendFounderOp(op) {
  return withFounderOpsLock(() => {
    const prior = readJSON(FOUNDER_OPS, []);
    const list = Array.isArray(prior) ? prior : [];
    list.push(op);
    writeJSON(FOUNDER_OPS, list);
    return true;
  });
}
// 更正公司概覽「Zero 依據」的來源連結（創辦人試用：Zero 抄錯網址而 404）。只改 page.json 該項來源的 url；第一次更正時舊值存 urlBefore，另記 fixedOn。
// 不改任何題目答案、不改 confirmed.json、不開 Zero 工作；帳本事件經創辦人操作隊列記錄（外殼合併時寫入 events）。
function fixSourceUrl(body) {
  const bad = { ok: false, error: 'invalid', message: NAMES.ui.srcUrlBad };
  const pageFile = path.join(DIR.company, 'page.json'), page = readJSON(pageFile, null);
  if (!page || !Array.isArray(page.sources)) return bad;
  const n = body && body.n, raw = body && typeof body.url === 'string' ? body.url.trim() : '';
  if (!Number.isInteger(n) || n < 0 || n >= page.sources.length || !raw || raw.length > 300) return bad;
  let u; try { u = new URL(raw); } catch { return bad; }
  const host = u.hostname.toLowerCase();
  // 只收 https 公開網址：不收帳密、本機名稱、私人網段、IPv6 位址
  if (u.protocol !== 'https:' || u.username || u.password || !host.includes('.') || host.startsWith('[') || host === 'localhost' || /(?:^|\.)(?:localhost|local|internal|lan|home)$/.test(host) || /^127\./.test(host) || /^0\./.test(host) || /^169\.254\./.test(host) || privateIPv4(host)) return bad;
  const s = page.sources[n];
  if (!s || typeof s !== 'object') return bad;
  if (s.url && !s.urlBefore) s.urlBefore = s.url;
  s.url = u.href; s.fixedOn = localIso().slice(0, 10);
  writeJSON(pageFile, page);
  const op = { id: 'fo-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), at: localIso(), op: 'setSourceUrl', target: 'source-' + n, value: { title: String(s.title || '').slice(0, 80) } };
  appendFounderOp(op);
  schedule(200);
  return { ok: true, n, url: s.url, fixedOn: s.fixedOn, message: NAMES.ui.srcUrlSaved };
}
function founderOp(body) {
  const state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  if (state.demo === true) return { ok: false, error: 'demo', message: NAMES.ui.founderDemoDenied };
  if (!body || typeof body !== 'object' || !['reschedule', 'cancelNext', 'setNext', 'snooze', 'unsnooze', 'setTarget', 'setTaskDue', ...ACTOR_OPS].includes(body.op) || typeof body.target !== 'string' || body.target.length > 120) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  const ds = dashboardState(DIR), all = ([]).concat(ds.todo || [], ds.brainTodo || [], ds.snoozed || []), byId = Object.fromEntries(all.map(item => [item.id, item]));
  const value = body.value && typeof body.value === 'object' && !Array.isArray(body.value) ? body.value : {};
  const keys = { reschedule: ['date'], cancelNext: [], setNext: ['text', 'date', 'milestoneId'], snooze: ['until'], unsnooze: [], setTarget: ['date'], setTaskDue: ['date'], actorRename: ['name'], actorKind: ['kind'], actorMerge: ['into'], actorStatus: ['status'], actorTeam: ['team'], taskOwner: ['owner'] }[body.op];
  if (Object.keys(value).some(key => keys.indexOf(key) < 0) || Object.values(value).some(value => typeof value === 'string' && value.length > 200)) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  if (body.op === 'reschedule') {
    if (body.target !== 'nextAction' || !ds.nextAction?.text || ds.nextAction.cancelledAt || !isDay(value.date)) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  } else if (body.op === 'cancelNext') {
    if (body.target !== 'nextAction' || !ds.nextAction?.text || ds.nextAction.cancelledAt) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  } else if (body.op === 'setNext') {
    if (body.target !== 'nextAction' || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 200 || (value.date != null && !isDay(value.date)) || (value.milestoneId && !(ds.milestones || []).some(m => m.id === value.milestoneId))) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  } else if (body.op === 'snooze') {
    if (!byId[body.target] || !isDay(value.until)) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  } else if (body.op === 'unsnooze' && !(ds.snoozed || []).some(item => item.id === body.target)) return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  else if (body.op === 'setTarget') {
    const m = (ds.milestones || []).find(item => item.id === body.target);
    if (!isDay(value.date) || value.date < localIso().slice(0, 10) || !m || m.state === 'done' || m.pathStatus === 'retired') return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  } else if (body.op === 'setTaskDue') {
    const task = (Array.isArray(state.tasks) ? state.tasks : []).find(item => item && item.id === body.target);
    if (!isDay(value.date) || value.date < localIso().slice(0, 10) || !task || ownerKind(task.owner) === 'ai' || task.status === 'done' || task.status === 'cancelled' || task.column === 'done' || task.column === 'cancelled') return { ok: false, error: 'invalid', message: NAMES.ui.founderOpInvalid };
  }
  // 名單改正（改名、類別、合併、不再接觸、成員狀態、工作負責人）：欄位白名單已在上面核對；這裏在「已疊加未合併操作」的帳本上試套一次，
  // 找不到對象、重名、聯絡方式（電郵／長串數字）、已合併、非在職成員等一律拒絕，不入隊列。隊列內只存整理過的欄位。
  let opValue = value;
  if (ACTOR_OPS.includes(body.op)) {
    const eff = applyFounderOps(state, pendingFounderOps(DIR, state));
    const trial = applyActorOp({ company: eff.company || {}, tasks: eff.tasks || [], milestones: eff.milestones || [] }, body.op, { ...value, id: body.target, from: body.target });
    if (!trial.ok) return { ok: false, error: 'invalid', message: NAMES.ui['pbErr_' + trial.error] || NAMES.ui.founderOpInvalid };
    if (body.op === 'actorTeam') { const t = value.team && typeof value.team === 'object' ? value.team : {}; opValue = { team: Object.fromEntries(['type', 'state', 'owns'].filter(k => k in t).map(k => [k, t[k]])) }; }
  }
  const op = { id: 'fo-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), at: localIso(), op: body.op, target: body.target, value: opValue };
  if (!appendFounderOp(op)) return { ok: false, error: 'busy', message: NAMES.ui.founderOpBusy };
  schedule(200);
  return { ok: true, op: { id: op.id, at: op.at, op: op.op, target: op.target }, message: NAMES.ui.founderOpSaved };
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

// 自動開工設定：節奏只經 founder-ops 交畀外殼合併；開關才由排程安裝程式處理標記同開機時自動打開。
function rhythmSetup(body) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['action', 'value'].includes(k))) return [400, { error: 'invalid', message: NAMES.ui.rhythmInvalid }];
  if (isDemoInstance()) return [409, { error: 'demo', message: NAMES.ui.rhythmDemoDenied }];
  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['runCadence', 'runTime', 'interviewWeekday'].includes(k)) || !['daily', 'weekdays', 'weekly'].includes(value.runCadence) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.runTime || '')) || !Number.isInteger(value.interviewWeekday) || value.interviewWeekday < 1 || value.interviewWeekday > 7) return [400, { error: 'invalid', message: NAMES.ui.rhythmInvalid }];
  const state = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  if (!state.company || !state.company.rhythm) return [409, { error: 'overview', message: NAMES.ui.rhythmNeedOverview }];
  const mark = readJSON(path.join(DIR.ledger, 'schedule.json'), null);
  if (mark && !mark.mode) return [409, { error: 'legacy', message: NAMES.ui.rhythmLegacy }];
  const op = { id: 'fo-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex'), at: localIso(), op: 'setRhythm', value: { runCadence: value.runCadence, runTime: value.runTime, interviewWeekday: value.interviewWeekday } };
  if (!appendFounderOp(op)) return [409, { error: 'busy', message: NAMES.ui.rhythmBusy }];
  schedule(200);
  return [202, { ok: true, message: NAMES.ui.rhythmSaved }];
}

let scheduleChild = null;
function scheduleSetup(body) {
  if (!body || typeof body !== 'object' || Object.keys(body).some(k => !['action', 'op'].includes(k)) || !['on', 'off'].includes(body.op)) return Promise.resolve([400, { error: 'invalid', message: NAMES.ui.rhythmInvalid }]);
  if (isDemoInstance()) return Promise.resolve([409, { error: 'demo', message: NAMES.ui.rhythmDemoDenied }]);
  const state = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  if (body.op === 'on' && (!state.company || !state.company.rhythm || !overviewCurrent())) return Promise.resolve([409, { error: 'overview', message: NAMES.ui.overviewPending }]);
  if (scheduleChild) return Promise.resolve([409, { error: 'busy', message: NAMES.ui.rhythmBusy }]);
  const script = path.join(ROOT, 'adapters', 'scheduler', 'install-schedule.mjs');
  if (!fs.existsSync(script)) { say(NAMES.ui.rhythmSchedulerMissing); return Promise.resolve([500, { error: 'scheduler', message: NAMES.ui.rhythmSchedulerMissing }]); }
  return new Promise(resolve => {
    let out = '', err = '', done = false, scheduleTimeout = null;
    const finish = (code, failed = false) => {
      if (done) return; done = true; if (scheduleTimeout) clearTimeout(scheduleTimeout); scheduleChild = null;
      // 安裝程式嘅句子係寫畀 AI 對話；頁面上要叫人再按掣，唔係再講一句
      out = out.trim().replace(/再說一次「移除排程」/g, '再按一次移除').replace(/再說「重新登記排程」/g, '再按一次「更新自動開工設定」').replace(/重新開機/g, '重新開啟電腦'); err = err.trim();
      // 頁面只收安裝程式嘅 stdout；stderr 只留喺伺服器診斷，避免把系統細節送到瀏覽器。
      if (failed || code !== 0) { say(NAMES.ui.rhythmScheduleFailed); return resolve([200, { ok: false, message: out || NAMES.ui.rhythmScheduleFailed }]); }
      return resolve([200, { ok: true, message: out }]);
    };
    try {
      scheduleChild = spawn(process.execPath, [script, body.op === 'on' ? '--register' : '--remove', '--data', DIR.data], { cwd: ROOT, env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      scheduleChild.stdout.on('data', d => { out += String(d); });
      scheduleChild.stderr.on('data', d => { err += String(d); });
      scheduleChild.on('error', () => finish(-1, true));
      scheduleChild.on('close', code => finish(code));
    } catch { return finish(-1, true); }
    scheduleTimeout = setTimeout(() => { try { scheduleChild.kill(); } catch { } finish(-1, true); }, 60000);
  });
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
    // 與 Zero 的討論（ask.mjs --tell）：AI 對話交來的一件事。與上面開頁一樣只限回環位址、沒有 Origin（瀏覽器一定會帶）、JSON；
    // 只收三類（發生了一件事／請 Zero 做一件事／想改計劃）及固定四個欄位，來源固定記為 chat；之後的驗證與處理和網頁送出完全同一條路（receiveNote），
    // 所以同樣要公司概覽已確認、同樣的字數與附件規則，同樣只是放入收件匣，等 Zero 擬確認題、創辦人確認後才改紀錄。
    if (req.method === 'POST' && p === '/api/tell') {
      if (!LOOPBACK.includes(req.socket.remoteAddress) || req.headers.origin !== undefined) return refuse(req, res, url, 'origin');
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'type' });
      const body = JSON.parse(await readBody(req, 75 * 1024 * 1024) || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['type', 'text', 'date', 'files'].includes(k)) || !['event', 'adhoc', 'order'].includes(body.type)) return send(res, 400, { error: 'invalid', message: '要求類型或欄位不正確。' });
      const result = await receiveNote(body, { source: 'chat' });
      if (!result.ok) return send(res, 400, result);
      schedule(); return send(res, 202, result);
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
    // 新用戶第一次由首頁入：只限已配對、未設定、未有公司資料先帶去入門頁；其他入口一律唔郁。
    if (req.method === 'GET' && p === '/') {
      if (passOf(req) && shouldShowWelcome()) { res.writeHead(302, { Location: '/welcome', 'Cache-Control': 'no-store' }); return res.end(); }
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'ask.html')), TYPES['.html']);
    }
    // 入門頁同監察台一樣先送頁殼；未配對就由頁面讀回後顯示配對指引，亦唔會留低已看紀錄。
    if ((req.method === 'GET' || req.method === 'HEAD') && p === '/welcome') {
      if (req.method === 'GET' && passOf(req)) markWelcomeSeen();
      return send(res, 200, fs.readFileSync(WELCOME_FILE), TYPES['.html']);
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
      if (p === '/api/intake') return send(res, 200, { ok: true, questions: INTAKE_QUESTIONS, questionsByBizType: Object.fromEntries(Object.keys(BIZ_TYPES).map(type => [type, intakeQuestions(type)])), bizTypes: Object.entries(BIZ_TYPES).map(([id, x]) => ({ id, label: x.label, example: x.example })), limits, ideate: ideateStatus() });
      if (p === '/api/prefill') { const r = prefillStatus(url.searchParams.get('id')); return r ? send(res, 200, { ok: true, ...r }) : send(res, 404, { error: 'not found' }); }
       if (p === '/api/setup') return send(res, 200, { ok: true, hosts: hostList(), cert: certInfo(), aiStale: certStale(), certify: certifyState(), devices: deviceList(pass), phone: phoneInfo() });
      if (p === '/api/status') return send(res, 200, statusPayload());
      if (p === '/api/sim' && SIM) return send(res, 200, { ok: true, sim: simInfo() });
      if (p === '/api/dashboard') { const observedLive = await observeNow(), oc = observeCfg(), work = workStatus(DIR, { outerAlive: shellAlive(), pending: pendingFiles() }); return send(res, 200, { ...dashboardState(DIR, { cert: certInfo(), busy: !!work.running, scheduler: SIM ? 'sim' : 'none', schedStatus: SIM ? null : schedReadback(), sim: simInfo(), lastSeen: lastSeenPrev, observed: observedLive, observeFolders: oc.folders.map(f => ({ hash: f.hash.slice(0, 12), name: f.name })), observePending: oc.pending }), workStatus: work, observed: observedLive, devices: deviceList(pass), phone: phoneInfo(), localOnly: pass.kind === 'phone', version: SERVER_VERSION, instance: INSTANCE }); }
      // Founder Desk 待決事項頁：「今日要做的事」卡同「上次離開之後」；頁面第一次載入（seen=1）先記低今次時間，輪詢唔算
      // 一個殼嘅頁頭（決定二十五）：公司、三個業務指標、生意大腦等你處理數目；唔觀測、唔寫檔（Founder Desk 畫面每 5 秒讀一次）
      if (p === '/api/shell') { const ds = dashboardState(DIR, { cert: certInfo(), sim: simInfo() }), work = workStatus(DIR, { outerAlive: shellAlive(), pending: pendingFiles() }); return send(res, 200, { ok: true, company: ds.company, metrics: ds.metrics, brain: { items: ((ds.brain || {}).items || []).map(x => ({ id: x.id, status: x.status })) }, tele: ds.tele, freshness: ds.deck && ds.deck.freshness, sample: ds.sample, work, version: SERVER_VERSION, instance: INSTANCE }); }
      if (p === '/api/home') {
        if (url.searchParams.get('seen') === '1' && fs.existsSync(path.join(DIR.company, 'page.json'))) lastSeenPrev = touchLastSeen(DIR, SERVER_VERSION);
        const ds = dashboardState(DIR, { cert: certInfo(), lastSeen: lastSeenPrev });
        let fw = ''; try { fw = fs.readFileSync(path.join(ROOT, 'FIRST-WEEK.md'), 'utf8'); } catch { }
        const card = guideCard(fw, ds);
        const fallback = (ds.todo || [])[0] || null;
        const fallbackHref = fallback ? (fallback.kind === 'overview' ? '/proofread.html' : fallback.kind === 'schedule' ? fallback.href : '#/ask/' + fallback.id) : '';
        const back = ds.since && ds.since.awayDays >= 3 ? card && card.today ? { text: card.today, href: card.href, button: card.button } : fallback ? { text: fallback.text, href: fallbackHref, button: NAMES.ui.goAnswer } : null : null;
        // 0.40.0：最近交給 Zero 的事（最多 5 件，狀態由 dash-lib 的 inputStatus 算）、「現在開工」會做甚麼（只讀預覽）
        const hl = (readJSON(path.join(DIR.ledger, 'state.json'), null) || {}).health || {};
        const stopped = hl.pausedByFounder ? NAMES.ui.skip_pausedByFounder : hl.autoStopped ? NAMES.ui.skip_autoStopped : '';
        return send(res, 200, { ok: true, guide: ds.guide, card, nextAction: ds.nextAction || null, firstWeekDone: ds.firstWeekDone, since: ds.since ? { ...ds.since, back } : null,
          inputs: (ds.inputs.all || []).slice(0, 5), inputsTotal: (ds.inputs.all || []).length, runNow: runNowPreview(ds, { busy: !!child, stopped }) });
      }
      // 回饋卡：一件交給 Zero 的事的完整視圖（原話、問題及答案、改動前後）；只讀
      if (p === '/api/input') {
        const id = String(url.searchParams.get('id') || '');
        const st = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}, input = (st.inputs || []).find(i => i && i.id === id);
        if (!input || !/^[\w-]{1,80}$/.test(id)) return send(res, 404, { error: 'not found' });
        return send(res, 200, { ok: true, input: inputView(DIR, input, { packs: listPacks(DIR), runs: (readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] }) || {}).runs || [], loadPack, loadAnswers }, { detail: true }) });
      }
      // 讀附件：只讀該筆輸入登記的檔（輸入編號＋序號，不收路徑）；解析後必須仍在 data 內且不是連結。PDF、圖片在瀏覽器開啟，其他類型下載
      if (p === '/api/input-file' || p === '/api/source-file') {
        const n = Number(url.searchParams.get('n'));
        let rel = '';
        if (p === '/api/input-file') {
          const st = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}, input = (st.inputs || []).find(i => i && i.id === String(url.searchParams.get('id') || ''));
          const f = input && Number.isInteger(n) && n >= 0 ? (input.files || [])[n] : '';
          const fi = input && Array.isArray(input.fileInfo) ? input.fileInfo.find(x => x && x.file === f) : null;
          rel = url.searchParams.get('text') === '1' ? (fi && fi.text) || '' : f || '';
        } else {
          const page = readJSON(path.join(DIR.company, 'page.json'), null), s = page && Number.isInteger(n) && n >= 0 ? (page.sources || [])[n] : null;
          rel = s && s.file || '';
        }
        let file = typeof rel === 'string' && rel ? resolveDataFile(DIR.data, rel) : null;
        // 公司概覽來源存檔只可以是封存資料夾內的普通檔（雙重防線：即使頁面上的 file 被寫成出界路徑，也不會讀到帳本或公司資料）
        if (file && p === '/api/source-file') { try { if (!fs.realpathSync(file).startsWith(fs.realpathSync(DIR.archive) + path.sep)) file = null; } catch { file = null; } }
        if (!file) return send(res, 404, { error: 'not found' });
        const ext = path.extname(file).slice(1).toLowerCase();
        const inline = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] || (url.searchParams.get('text') === '1' ? 'text/plain; charset=utf-8' : '');
        const type = inline || { md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8' }[ext] || 'application/octet-stream';
        const name = path.basename(file).replace(/^[\d-]+-(?:note-[a-z]+-file|intake|prefill)-\d+-/, '');
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer',
          'Content-Disposition': (inline ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(name) };
        if (!/^(application\/pdf)$/.test(type)) headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
        res.writeHead(200, headers);
        return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
      }
      if (p === '/api/asks') { const ds = dashboardState(DIR); return send(res, 200, { ok: true, packs: listPacks(DIR), company: companyStatus(), todo: pendingTodo(DIR), snoozed: pendingSnoozed(DIR), brainPending: (ds.brainTodo || []).length, helpInFlight: helpInFlight() }); }
      if (p === '/api/ask') {
        const pack = loadPack(DIR, url.searchParams.get('id'));
        return pack ? send(res, 200, { ok: true, pack, answers: loadAnswers(DIR, pack.id).answers }) : send(res, 404, { error: 'not found' });
      }
      if (p === '/api/log') return send(res, 200, { ok: true, entries: readLog(DIR, 500) });
      // 情景演練：場景、練習紀錄、可以練嘅現實行動
      if (p === '/api/practice') {
        const st = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
        const actions = (st.tasks || []).filter(t => ownerKind(t.owner) === 'founder' && t.status !== 'done' && t.status !== 'cancelled').map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt || '', scenarioId: t.scenarioId || '' }));
        return send(res, 200, { ok: true, counterparts: counterpartsOf(DIR).map(p => ({ id: p.id, name: p.name, reviewKeys: [...new Set(p.review.map(w => w.personaKey).filter(Boolean))] })), scenarios: listScenarios(DIR).map(s => ({ id: s.id, title: s.title, counterpart: s.counterpart, date: s.date || '', forTaskId: s.forTaskId || '' })), sessions: listSessions(DIR), actions, ai: !!certified(ROOT, DIR.ledger).host, preparing: preparingPractice() });
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
          matches: all.map(summaryOf), suggestedSeat: [...all].reverse().find(m => m.suggestedSeat)?.suggestedSeat || null, routes, milestones: (st.milestones || []).filter(m => m.pathStatus === 'confirmed').sort((a, b) => (a.order || 0) - (b.order || 0)).map(m => ({ id: m.id, name: m.short || m.title })),
          ai: !!certified(ROOT, DIR.ledger).host, company: companyStatus(), starting });
      }
      if (p === '/api/practice/scenario') { const s = loadScenario(DIR, url.searchParams.get('id')); return s ? send(res, 200, { ok: true, scenario: s }) : send(res, 404, { error: 'not found' }); }
      if (p === '/api/practice/session') { const s = loadSession(DIR, url.searchParams.get('id')); return s ? send(res, 200, { ok: true, session: s, scenario: loadScenario(DIR, s.scenarioId) }) : send(res, 404, { error: 'not found' }); }
      if (p === '/api/run') { const r = runResult(url.searchParams.get('id')); return r ? send(res, 200, { ok: true, run: r }) : send(res, 404, { error: 'not found' }); }
    }
    if (req.method === 'POST' && (p === '/api/submit' || p === '/api/retry' || p === '/api/setup' || p === '/api/intake' || p === '/api/input-reread' || p === '/api/practice' || p === '/api/logo' || p === '/api/founder-op' || p === '/api/source-url' || p === '/api/celebrations/seen' || (p === '/api/sim' && SIM))) {
      // 本機專用操作不能靠 LAN Origin 或手機通行證升格：三個條件缺一不可。
      const loopback = pass.kind === 'browser' && LOOPBACK.includes(req.socket.remoteAddress) && loopbackOrigin(req.headers.origin);
      const phone = pass.kind === 'phone' && !!phoneMode && privateIPv4(req.socket.remoteAddress) && req.socket.localAddress?.replace(/^::ffff:/, '') === phoneMode.address && okOrigin(req.headers.origin);
      if (!loopback && !phone) return refuse(req, res, url, 'origin');
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'type' });
      const phoneGate = phone ? { hash: passFromCookie(req)?.hash || '', generation: phoneMode?.generation } : null;
      const body = JSON.parse(await readBody(req, (p === '/api/intake' ? 75 * 1024 * 1024 : p === '/api/logo' ? 1.5 * 1024 * 1024 : 32 * 1024)) || '{}');
      // 半截手機請求在讀 body 期間可被撤銷；讀完後、套用任何動作前必須以同一代手機模式重驗。
      if (phone && !currentPhonePass(req, phoneGate)) return send(res, 403, { error: 'pass' });
      if (p === '/api/celebrations/seen') return send(res, ...claimCelebration(body.id));
      if (phone && (p === '/api/setup' || p === '/api/retry' || p === '/api/sim')) return send(res, 403, { error: 'local' });
      if (p === '/api/source-url') { if (phone) return send(res, 403, { error: 'local' }); const result = fixSourceUrl(body); return send(res, result.ok ? 200 : 400, result); }
      if (p === '/api/founder-op') { const result = founderOp(body); return send(res, result.ok ? 202 : result.error === 'busy' ? 409 : 400, result); }
      if (p === '/api/input-reread') return send(res, ...await rereadInput(body));
      if (p === '/api/practice') return send(res, ...await practiceAction(body));
      if (p === '/api/logo') return send(res, ...saveLogo(body));
      if (p === '/api/sim') return send(res, ...(body.action === 'advance' ? simAdvance() : body.action === 'ai' ? simSetAI(body.mode) : [400, { error: 'invalid' }]));
      if (p === '/api/intake') { const result = body.kind === 'note' ? await receiveNote(body) :body.kind === 'prefill' ? await receivePrefill(body) : await receiveIntake(body); if (!result.ok) return send(res, 400, result); schedule(); return send(res, 202, result); }
      if (p === '/api/setup') {
        if (body.action === 'observe') return send(res, ...observeSetup(body));
        if (body.action === 'rhythm') return send(res, ...rhythmSetup(body));
        if (body.action === 'schedule') return send(res, ...await scheduleSetup(body));
        if (body.action === 'phone-open') return send(res, ...await openPhoneMode());
        if (body.action === 'phone-close') return send(res, ...await closePhoneMode());
        if (body.action === 'phone-accept') return send(res, ...decidePhone(body.id, true));
        if (body.action === 'phone-reject') return send(res, ...decidePhone(body.id, false));
        // 撤銷一部已配對裝置（只限已配對嘅本機瀏覽器可按；撤銷自己嗰部之後，呢個瀏覽器下一次讀回就會見到配對指引）
        if (body.action === 'revoke') return send(res, ...revokePass(body.id));
        if (body.action === 'openDemo') {
          if (Object.keys(body).some(k => k !== 'action')) return send(res, 400, { error: 'invalid' });
          return send(res, ...openDemo());
        }
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
        if (!startCertification(body.host)) return send(res, 500, { error: 'start', message: NAMES.ui.errGeneric });
        return send(res, 202, { ok: true });
      }
      if (p === '/api/retry') {
        fs.writeFileSync(path.join(DIR.ledger, 'retry-requested'), JSON.stringify({ runId: /^R[\w-]{1,40}$/.test(String(body.runId || '')) ? body.runId : null, at: localIso() }));
        schedule(200);
        return send(res, 200, { ok: true });
      }
      const reply = typeof body.text === 'string' ? parseFounderReply(body.text) : null;
      if (body.kind === 'ask-answer' && (!reply?.ok || reply.head.kind !== body.kind || reply.head.ref !== body.ref)) { say('拒收問題包答案：header-or-format'); return send(res, 400, { error: 'answer-identity', message: NAMES.ui.errAnswerIdentity }); }
      if (!KINDS.includes(body.kind) || !/^[\w-]{1,80}$/.test(String(body.ref || '')) || !reply?.ok ||
        reply.head.kind !== body.kind || reply.head.ref !== body.ref) return send(res, 400, { error: 'invalid' });
      // 手機可以採用預設，但不得藉一般回覆改寫 G7 權限或 G8 經營節奏。
      if (phone && changesLocalOnly(body, reply)) return send(res, 403, { error: 'local' });
      // 收之前先核對：問題包要喺呢度（舊分頁、測試分頁送嚟嘅唔收，免得收咗先失敗）
      if (body.kind === 'ask-answer' && !loadPack(DIR, body.ref)) return send(res, 404, { error: 'pack-not-here', message: '此問題包已不在此處，可能是舊分頁。請返回待決事項查看最新問題。' });
      if (body.kind === 'ask-answer') { const v = validateAskReply(reply, loadPack(DIR, body.ref)); if (!v.ok) { say('拒收問題包答案：' + v.reason); return send(res, 400, { error: 'answer-identity', message: NAMES.ui.errAnswerIdentity }); } }
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

// 「開始.cmd」（server.mjs --open）：自己開緊就經一次性連結開 CrewZero；沿用緊另一個伺服器就請嗰個伺服器開（同 ask.mjs 一樣嘅叫法）
async function openBrowser() {
  if (!process.argv.includes('--open') || process.argv.includes('--no-open')) return;
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
        : j.busy ? (legacy ? '沒有通行證功能的舊版正在處理工作；為保護資料，完成後再打開 CrewZero 便會更換為新版' : '舊版正在處理工作，今次繼續使用；完成後再打開 CrewZero 便會更換為新版')
          : wantsReplace ? '無法獨立核對舊版程序身份，已停止換版，沒有終止任何程序。' : '有舊版正在運行但無法關閉，今次繼續使用');
      release(); await openBrowser(); setTimeout(() => process.exit(0), 500); return;
    }
    try { process.kill(Number(j.pid)); killed = true; say(`發現${legacy ? '沒有通行證功能的' : ''}舊版正在運行（${port}），已關閉並改用新版`); } catch { }
  }
  if (killed) await new Promise(r => setTimeout(r, 800));
  server.listen(PORT, '127.0.0.1', () => {
    release();
    say(`CrewZero 已開：${home()}`);
    if (SIM) say('模擬實例：模擬資料，不是生意證據；時間按模擬時鐘');
    const ai = certified(ROOT, DIR.ledger); say(ai.host ? `AI 工具：${ai.label}（已認證）` : 'AI 工具未設定');
    say('使用頁面期間請勿關閉此視窗；關閉後便會停止。');
    if (pendingFiles().length || pendingMatches(DIR).length) { say('有上次未處理的回覆或辯論回合，現在補做'); schedule(500); }
    openBrowser();
  });
}
start();
