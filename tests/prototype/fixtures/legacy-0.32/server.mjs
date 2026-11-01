// startup-os Founder Desk：本機伺服器。由 /startup-os:desk（ask.mjs --desk）或者 AI 出題時自動喺背景起，創辦人唔使理；「開始.cmd」只係技術後備。
// 只聽 127.0.0.1；只接受本頁送出嘅回覆（公司概覽、問題包），寫入 data/founder/replies/；收到即排隊叫外殼（run.mjs）。
// 伺服器唔直接開 AI；AI 一律由外殼（run.mjs、certify.mjs）按已認證嘅 AI 工具設定開。AI 寫唔到 founder 資料夾，所以叫唔醒自己。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hosts, version, certified, cleanEnv, resolveCommand } from './host-lib.mjs';
import { rhythmOf, dueSlot, nextRunAt, ymd } from './rhythm-lib.mjs';
import { provenanceOf, provenanceLine, unconfirmed, loadPrefills } from './prefill-lib.mjs';
import { NAMES, localIso, clockNow, isSim, writeJSON, readJSON, dataDirs, listPacks, loadPack, loadAnswers, readLog, rootId, INTAKE_QUESTIONS, SERVER_VERSION, BASE_PORT as DEFAULT_PORT } from './ask-lib.mjs';
import { dashboardState, touchLastSeen, pendingTodo, guideCard } from './dash-lib.mjs';
import { listScenarios, loadScenario, listSessions, loadSession, startSession, say as practiceSay, undo as practiceUndo, finish as practiceFinish, stopAll as practiceStop } from './practice-lib.mjs';
import { TOPIC_TYPES, SEATS, LEVELS, formatFor, passesFor, listMatches, loadMatch, summaryOf, pendingMatches } from './debate-lib.mjs';
import { brainSource } from './brain-lib.mjs';
import { folderHash } from './folder-hash.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// 模擬實例（設計稿第 8 節）：一定要用獨立資料夾，唔可以指向創辦人真資料；喺建立任何資料夾之前核對
if (process.env.SOS_SIM === '1' && (!process.env.SOS_DATA || path.resolve(process.env.SOS_DATA) === path.resolve(ROOT, 'data'))) { console.log('[startup-os] 模擬實例一定要用獨立資料夾，已停止'); process.exit(1); }
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
// Founder Desk（首頁等你決定、問題包、決定紀錄）係 ask.html；公司概覽係 proofread.html
// 頁面同共用檔（名稱、版面、Markdown）：只准呢幾個檔，加共用檔就加入 SHARED
const SHARED = ['md.js', 'names.js', 'desk.js', 'orbit.js'];
const FILES = { '/': 'ask.html', '/ask.html': 'ask.html', '/proofread.html': 'proofread.html', ...Object.fromEntries(SHARED.map(f => ['/' + f, f])) };
// 營運監察台：/dashboard（公司現況）、/dashboard/<分頁> 同 /dashboard/brain/<項目>，同一個頁面檔
const DASH_TABS = ['path', 'brain', 'inputs', 'team', 'log', 'system'];
const BRAIN_PAGES = ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'];
let lastSeenPrev = null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp' };
const KINDS = ['proofread', 'ask-answer'];

const pad = n => String(n).padStart(2, '0');
const fileStamp = (d = clockNow()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const say = msg => console.log(`[startup-os ${new Date().toTimeString().slice(0, 8)}] ${msg}`);

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
// AI 工具清單同版本：讀版本要開一次工具，所以快取一分鐘（系統設定頁會不停讀）
let hostCache = null;
function hostList() {
  if (hostCache && Date.now() - hostCache.at < 60000) return hostCache.list;
  const list = hosts(ROOT).map(h => { const v = version(h); return { id: h.id, label: h.label || h.name || h.id, installed: !!v, version: v, why: v ? '' : resolveCommand(h.command).why || '' }; });
  hostCache = { at: Date.now(), list };
  return list;
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
const pendingFiles = () => [...fs.readdirSync(DIR.replies).filter(f => f.endsWith('.md')), ...fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md') || f.endsWith('-prefill.md') || /-note-(?:order|adhoc|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc)\.md$/.test(f))].sort();
const EXTS = ['md', 'txt', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg'];
const limits = { files: 20, fileMB: 10, totalMB: 50, exts: EXTS };
// 附件核對（交資料、真實事件證明共用）：回 { files } 或 { error }
function takeFiles(list) {
  if (list.length > 20) return { error: '附件最多 20 份。' };
  const files = []; let total = 0;
  for (const f of list) {
    if (!f || typeof f.name !== 'string' || typeof f.data !== 'string' || !f.name || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data)) return { error: '附件內容無法讀取。' };
    const ext = path.extname(f.name).slice(1).toLowerCase();
    if (!EXTS.includes(ext)) return { error: '附件格式不支援。' };
    const bytes = Buffer.from(f.data, 'base64'); total += bytes.length;
    if (bytes.length > 10 * 1024 * 1024 || total > 50 * 1024 * 1024) return { error: '附件太大，請縮小後再提交。' };
    files.push({ name: f.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 80), bytes });
  }
  return { files };
}

function receiveIntake(body) {
  const fail = message => ({ error: 'invalid', message });
  if (!body || !body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || !Array.isArray(body.files)) return fail('請填寫資料並檢查附件。');
  const fields = {};
  for (const q of INTAKE_QUESTIONS) {
    const value = body.fields['q' + q.n] ?? '';
    if (typeof value !== 'string' || value.length > 4000 || (q.required && !value.trim())) return fail('請填寫首五條問題，每欄最多 4000 字。');
    fields['q' + q.n] = value;
  }
  if (Object.keys(body.fields).some(k => !/^q(?:[1-9]|1[0-2])$/.test(k)) || Buffer.byteLength(Object.values(fields).join(''), 'utf8') > 32 * 1024) return fail('文字資料過多或包含不支援的欄位。');
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
  const machine = { format: 'startup-os.intake/0.1', id, fields, files: records, ...(prefill ? { prefillId } : {}), provenance };
  const text = INTAKE_QUESTIONS.map(q => `## ${q.n}. ${q.ask}\n\n${fields['q' + q.n]}\n${fields['q' + q.n].trim() ? '\n' + provenanceLine(provenance['q' + q.n]) + '\n' : ''}`).join('\n') + '\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n';
  const created = [];
  try {
    files.forEach((f, i) => { const p = path.join(DIR.inbox, records[i].stored); fs.writeFileSync(p, f.bytes, { flag: 'wx' }); created.push(p); });
    const p = path.join(DIR.inbox, `${id}-intake.md`); fs.writeFileSync(p, text, { flag: 'wx' }); created.push(p);
  } catch (e) { for (const p of created) try { fs.unlinkSync(p); } catch {} throw e; }
  return { ok: true, id, receivedAt: localIso() };
}

/* ---------- 由文件預填（規劃書 3.1）：只有附件，唔含答案；AI 只讀文件交返五條預填，唔擬公司概覽、唔建任何紀錄 ---------- */
function receivePrefill(body) {
  const fail = message => ({ error: 'invalid', message });
  if (!Array.isArray(body.files) || !body.files.length) return fail('請先加入文件。');
  const got = takeFiles(body.files);
  if (got.error) return fail(got.error);
  const id = fileStamp() + '-' + String(Date.now() % 1000).padStart(3, '0');
  const records = got.files.map((f, i) => ({ name: f.name, stored: `${id}-prefill-${pad(i + 1)}-${f.name}`, bytes: f.bytes.length }));
  const machine = { format: 'startup-os.prefill/0.1', id, files: records };
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
const NOTE_TYPES = ['order', 'adhoc', 'feedback', 'brain-decide', 'practice-prep', 'debrief', 'debate-start', 'debate-action', 'event', 'doc'];
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
const okHost = h => h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
const okOrigin = o => o === `http://127.0.0.1:${PORT}` || o === `http://localhost:${PORT}`;
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > max) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function statusPayload() {
  const st = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
  const packs = listPacks(DIR);
  return {
    ok: true, version: SERVER_VERSION, root: ROOT_ID, sim: simInfo(), today: localIso().slice(0, 10), instance: INSTANCE, pid: process.pid, ai: (() => { const c = certInfo(); return { name: c ? c.label : 'AI', ready: !!c }; })(), busy: !!child,
    cert: certInfo(), certify: (() => { const c = certifyState(); return c ? { state: c.state } : null; })(), pending: pendingFiles(), runs: st.runs.slice(0, 5), openAsks: packs.filter(p => p.open).length, company: companyStatus(), intake: (() => { const r = st.runs.find(r => r.kind === 'intake'); const f = fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md')).sort().at(-1); if (f && (!r || f.slice(0, -10) > r.ref)) return { id: f.slice(0, -10), state: 'pending', runId: null }; return r ? { id: r.ref, state: r.state, runId: r.id } : null; })()
  };
}
function companyStatus() {
  const c = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const page = readJSON(path.join(DIR.company, 'page.json'), null), co = page?.company || {};
  return { name: co.name || '', initials: co.initials || '', oneLiner: co.oneLiner || '', ready: !!page, confirmed: !!c, confirmedAt: c ? c.confirmedAt : null };
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

const server = http.createServer(async (req, res) => {
  try {
    if (!okHost(req.headers.host)) return send(res, 403, { error: 'host' });
    const url = new URL(req.url, home());
    const p = url.pathname;
    if ((req.method === 'GET' || req.method === 'HEAD') && p === '/company-page.js') { const page = readJSON(path.join(DIR.company, 'page.json'), null); return page ? send(res, 200, 'window.STARTUP_OS_PAGE = ' + JSON.stringify(page).replace(/</g, '\\u003c') + ';', TYPES['.js']) : send(res, 404, { error: 'not found' }); }
    const dm = /^\/dashboard\/([a-z]+)(?:\/([a-z]+))?$/.exec(p), dashTab = p === '/dashboard' ? 'overview' : dm && (!dm[2] || (dm[1] === 'brain' && BRAIN_PAGES.includes(dm[2]))) ? dm[1] : null;
    if ((req.method === 'GET' || req.method === 'HEAD') && dashTab && (dashTab === 'overview' || DASH_TABS.includes(dashTab))) {
      // 打開監察台公司現況：記低今次時間（「自上次查看以來」用上一次嘅時間）
      if (dashTab === 'overview' && req.method === 'GET') lastSeenPrev = touchLastSeen(DIR, SERVER_VERSION);
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'dashboard.html')), TYPES['.html']);
    }
    // 陶土 AI 團隊圖（品牌角色規格）：只送 assets/ 入面 clay-*.webp，冇就 404
    const am = /^\/assets\/(clay-[a-z0-9-]+\.webp)$/.exec(p);
    if ((req.method === 'GET' || req.method === 'HEAD') && am) {
      const f = path.join(ROOT, 'assets', am[1]);
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), TYPES['.webp']) : send(res, 404, { error: 'not found' });
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && FILES[p]) {
      const f = path.join(ROOT, FILES[p]);
      return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)]);
    }
    if (req.method === 'GET') {
      if (p === '/api/intake') return send(res, 200, { ok: true, questions: INTAKE_QUESTIONS, limits });
      if (p === '/api/prefill') { const r = prefillStatus(url.searchParams.get('id')); return r ? send(res, 200, { ok: true, ...r }) : send(res, 404, { error: 'not found' }); }
      if (p === '/api/setup') return send(res, 200, { ok: true, hosts: hostList(), cert: certInfo(), certify: certifyState() });
      if (p === '/api/probe') {
        const token = url.searchParams.get('t') || '';
        if (!/^[a-f0-9]{36}$/.test(token)) return send(res, 400, 'invalid', 'text/plain');
        const dir = path.join(DIR.data, 'founder', 'desk'); fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'probe-hits.log'), token + '\n'); return send(res, 200, 'ok', 'text/plain');
      }
      if (p === '/api/status') return send(res, 200, statusPayload());
      if (p === '/api/sim' && SIM) return send(res, 200, { ok: true, sim: simInfo() });
      if (p === '/api/dashboard') { const observedLive = await observeNow(), oc = observeCfg(); return send(res, 200, { ...dashboardState(DIR, { cert: certInfo(), busy: shellAlive(), scheduler: SIM ? 'sim' : 'none', schedStatus: SIM ? null : schedReadback(), sim: simInfo(), lastSeen: lastSeenPrev, observed: observedLive, observeFolders: oc.folders.map(f => ({ hash: f.hash.slice(0, 12), name: f.name })), observePending: oc.pending }), observed: observedLive, version: SERVER_VERSION, instance: INSTANCE }); }
      // Founder Desk 待決事項頁：「今日要做的事」卡同「上次離開之後」；頁面第一次載入（seen=1）先記低今次時間，輪詢唔算
      // 一個殼嘅頁頭（決定二十五）：公司、三個業務指標、生意大腦等你處理數目；唔觀測、唔寫檔（Founder Desk 畫面每 5 秒讀一次）
      if (p === '/api/shell') { const ds = dashboardState(DIR, { cert: certInfo(), sim: simInfo() }); return send(res, 200, { ok: true, company: ds.company, metrics: ds.metrics, brain: { items: ((ds.brain || {}).items || []).map(x => ({ id: x.id, status: x.status })) }, tele: ds.tele, freshness: ds.deck && ds.deck.freshness, sample: ds.sample, version: SERVER_VERSION, instance: INSTANCE }); }
      if (p === '/api/home') { if (url.searchParams.get('seen') === '1' && fs.existsSync(path.join(DIR.company, 'page.json'))) lastSeenPrev = touchLastSeen(DIR, SERVER_VERSION); const ds = dashboardState(DIR, { cert: certInfo(), lastSeen: lastSeenPrev }); let fw = ''; try { fw = fs.readFileSync(path.join(ROOT, 'FIRST-WEEK.md'), 'utf8'); } catch { } return send(res, 200, { ok: true, guide: ds.guide, card: guideCard(fw, ds), firstWeekDone: ds.firstWeekDone, since: ds.since }); }
      if (p === '/api/asks') return send(res, 200, { ok: true, packs: listPacks(DIR), company: companyStatus(), todo: pendingTodo(DIR) });
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
    if (req.method === 'POST' && (p === '/api/submit' || p === '/api/retry' || p === '/api/setup' || p === '/api/intake' || p === '/api/practice' || (p === '/api/sim' && SIM))) {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !okOrigin(req.headers.origin)) return send(res, 403, { error: 'origin' });
      if (!/^application\/json/.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'type' });
      const body = JSON.parse(await readBody(req, (p === '/api/intake' ? 75 * 1024 * 1024 : 32 * 1024)) || '{}');
      if (p === '/api/practice') return send(res, ...await practiceAction(body));
      if (p === '/api/sim') return send(res, ...(body.action === 'advance' ? simAdvance() : body.action === 'ai' ? simSetAI(body.mode) : [400, { error: 'invalid' }]));
      if (p === '/api/intake') { const result = body.kind === 'note' ? receiveNote(body) : body.kind === 'prefill' ? receivePrefill(body) : receiveIntake(body); if (!result.ok) return send(res, 400, result); schedule(); return send(res, 202, result); }
      if (p === '/api/setup') {
        if (body.action === 'observe') return send(res, ...observeSetup(body));
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
      if (!KINDS.includes(body.kind) || !/^[\w-]{1,80}$/.test(String(body.ref || '')) ||
        typeof body.text !== 'string' || !body.text.startsWith('kind: ' + body.kind)) return send(res, 400, { error: 'invalid' });
      // 收之前先核對：問題包要喺呢度（舊分頁、測試分頁送嚟嘅唔收，免得收咗先失敗）
      if (body.kind === 'ask-answer' && !loadPack(DIR, body.ref)) return send(res, 404, { error: 'pack-not-here', message: '此問題包已不在此處，可能是舊分頁。請返回 Founder Desk 查看最新問題。' });
      let name = `${fileStamp()}-${body.kind}-${body.ref}.md`, n = 1;
      while (fs.existsSync(path.join(DIR.replies, name))) name = `${fileStamp()}-${body.kind}-${body.ref}-${++n}.md`;
      fs.writeFileSync(path.join(DIR.replies, name), body.text, { flag: 'wx' });
      say(`收到創辦人${body.kind === 'proofread' ? '確認' : '答案'}：${name}`);
      schedule();
      return send(res, 200, { ok: true, file: name, receivedAt: localIso() });
    }
    if (p.startsWith('/api/')) return send(res, 405, { error: 'method' });
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 400, { error: String(e.message || e) });
  }
});

function openBrowser() {
  if (!process.argv.includes('--open')) return;
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', home()], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [home()], { detached: true, stdio: 'ignore' }).unref();
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
      const j = await (await fetch(`http://127.0.0.1:${p}/api/status`, { signal: AbortSignal.timeout(800) })).json();
      if (j && j.root === ROOT_ID) found.push({ port: p, j });
    } catch { }
  }
  return found;
}
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
  for (const { port, j } of await sameFolderServers()) {
    const canKill = j.version !== SERVER_VERSION && !j.busy && Number(j.pid) > 0;
    if (!canKill) {
      PORT = port;
      say(j.version === SERVER_VERSION ? '已在運行，直接開啟頁面'
        : j.busy ? '舊版正在處理工作，今次繼續使用；完成後再打開 Founder Desk 便會更換為新版'
          : '有舊版正在運行但無法關閉，今次繼續使用');
      release(); openBrowser(); setTimeout(() => process.exit(0), 500); return;
    }
    try { process.kill(Number(j.pid)); killed = true; say(`發現舊版正在運行（${port}），已關閉並改用新版`); } catch { }
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
