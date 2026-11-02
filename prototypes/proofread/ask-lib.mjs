// CrewZero 問題包共用工具：外殼（run.mjs）、伺服器（server.mjs）、命令（ask.mjs）都用呢度，規則只寫一次。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const pad = n => String(n).padStart(2, '0');
// 模擬實例（設計稿第 8 節）：SOS_SIM=1 而且有獨立資料夾（SOS_DATA）先生效；時間 = 真時間 + founder/desk/sim-clock.json 嘅偏移。
// 伺服器、外殼、監察台讀同一個值；真實實例永遠用真時間。
export const isSim = () => process.env.SOS_SIM === '1' && !!process.env.SOS_DATA;
let simCache = { at: 0, off: 0 };
export function clockNow() {
  if (!isSim()) return new Date();
  const t = Date.now();
  if (t - simCache.at > 500) { let off = 0; try { off = Number(JSON.parse(fs.readFileSync(path.join(process.env.SOS_DATA, 'founder', 'desk', 'sim-clock.json'), 'utf8')).offsetMs) || 0; } catch { } simCache = { at: t, off }; }
  return new Date(t + simCache.off);
}
export function localIso(d = clockNow()) {
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
export const stamp = (d = clockNow()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
export const readJSON = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
// Founder 回覆由入口及外殼共用同一套解析規則：標頭不可重複，且只能有一個 JSON 區塊。
// 否則入口與下游可能各自取到不同內容，令保護檢查失效。
export function parseFounderReply(text) {
  const source = String(text || ''), lines = source.split(/\r?\n/), head = {}, seen = new Set(), duplicates = new Set();
  let end = lines.findIndex(line => !line.trim());
  if (end < 0) end = lines.length;
  for (const line of lines.slice(0, end)) {
    const m = /^([A-Za-z][A-Za-z0-9-]*):[ \t]?(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    if (seen.has(key)) duplicates.add(key);
    seen.add(key); head[key] = m[2].trim();
  }
  const blocks = [...source.matchAll(/```json[ \t]*\r?\n([\s\S]*?)```/gi)];
  let machine = null;
  try { machine = blocks.length === 1 ? JSON.parse(blocks[0][1]) : null; } catch { machine = null; }
  const duplicateFields = [...duplicates];
  return {
    head, machine, duplicateFields, duplicateVia: duplicates.has('via'),
    ok: duplicateFields.length === 0 && blocks.length === 1 && !!machine && typeof machine === 'object' && !Array.isArray(machine)
  };
}
// Windows：另一個程序啱啱讀緊同一個檔時，改名覆蓋會暫時被拒（EPERM／EBUSY），等一陣再試
export function writeJSON(f, obj) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, f); return; }
    catch (e) { if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
  }
}
export function fnv(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return ('0000000' + x.toString(16)).slice(-8);
}

// 伺服器用嚟認返自己（同一個資料夾）；ask.mjs 用嚟搵返開緊嘅伺服器
// 資料夾識別碼：完整路徑嘅雜湊（舊算法只取路徑尾段，唔同項目資料夾名尾幾個字相同就會撞）
export const rootId = root => crypto.createHash('sha256').update(String(root).toLowerCase()).digest('hex').slice(0, 24);
// 0.33 或更舊版本嘅算法：只用嚟認出仲開緊嘅舊伺服器（要同時核對到程序屬同一資料夾先算）
export const legacyRootId = root => Buffer.from(String(root).toLowerCase()).toString('base64url').slice(-24);
// 由作業系統核對開緊嘅伺服器屬唔屬 <programRoot>：回傳 'same'（同一程式資料夾）、'other'（確定係其他程序或程式資料夾）、'unknown'（核對唔到，例如冇 lsof）
// Windows：netstat 本機位址＝127.0.0.1:<埠> 嘅任何一行（部分版本監聽行狀態欄唔可靠或唔列出）＋Win32_Process；macOS／Linux：lsof＋ps
export function serverOwnership(port, reportedPid, programRoot) {
  const pid = Number(reportedPid);
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
  const run = (cmd, args, timeout) => { const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout }); return r.error || r.status === null ? null : String(r.stdout || ''); };
  let owners, command;
  if (process.platform === 'win32') {
    const netstat = run('netstat.exe', ['-ano', '-p', 'tcp'], 5000);
    if (netstat === null) return 'unknown';
    owners = new Set(netstat.split(/\r?\n/).map(s => s.trim().split(/\s+/)).filter(c => c[0] === 'TCP' && c[1] === `127.0.0.1:${Number(port)}`).map(c => Number(c[c.length - 1])));
    if (!owners.size) return 'unknown';
    if (!owners.has(pid)) return 'other';
    command = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}").CommandLine`], 10000);
  } else {
    const lsof = run('lsof', ['-nP', `-iTCP@127.0.0.1:${Number(port)}`, '-sTCP:LISTEN', '-Fp'], 5000);
    if (lsof === null) return 'unknown';
    owners = new Set(lsof.split(/\r?\n/).filter(l => /^p\d+$/.test(l)).map(l => Number(l.slice(1))));
    if (!owners.size) return 'unknown';
    if (!owners.has(pid)) return 'other';
    command = run('ps', ['-o', 'command=', '-p', String(pid)], 5000);
  }
  if (!command || !command.trim()) return 'unknown';
  const norm = s => process.platform === 'win32' ? String(s).replaceAll('/', '\\').toLocaleLowerCase('en-US') : String(s);
  return norm(command).includes(norm(path.join(programRoot, 'server.mjs'))) ? 'same' : 'other';
}
export const ownsServerPort = (port, reportedPid, programRoot) => serverOwnership(port, reportedPid, programRoot) === 'same';export const SERVER_VERSION = 'proofread-chain-0.34.1';
// 預設由 4380 開始；SOS_PORT 可以改（測試用，唔會撞到創辦人開緊嘅伺服器）
export const BASE_PORT = Number(process.env.SOS_PORT) || 4380;

export const BIZ_TYPES = Object.assign(Object.create(null), {
  service: { label: '服務', example: '上門照顧、顧問、維修' },
  goods: { label: '實體貨品', example: '手作、零售、食品' },
  online: { label: '網上或內容', example: '網店、課程、訂閱' },
  nonprofit: { label: '非牟利或社企', example: '社區計劃、資助項目' },
  other: { label: '其他', example: '請用一句說明' }
});

const PROGRESS_HINT = '程度說明：口頭表示是對方說有興趣；實際行動是對方試用、預訂或參與；付出成本是對方付款或投入資源。';

export const INTAKE_QUESTIONS = [
  { n: 1, ask: '你提供甚麼？對象是誰？', hint: '以一句說明你正在做的事，以及主要面向哪類人士或機構。', example: '我們協助小型機構整理日常預約和聯絡安排。', required: true },
  { n: 2, ask: '如何收取款項或得到資金支持？', hint: '說明由誰付款或支持，以及大致方式；尚未決定可寫「未定」。', example: '目前正考慮按月收費，價錢未定。', required: true },
  { n: 3, ask: '目前有哪些實際進展？', hint: '只寫公司以外已發生的事，並說明對象及行動。' + PROGRESS_HINT + '尚未有進展可寫「未有」。', example: '兩個機構表示有興趣（口頭表示）；其中一個已安排試用（實際行動）。', required: true },
  { n: 4, ask: '下一步打算做甚麼？會接觸誰？', hint: '寫出下一個行動、接觸對象及希望得到的答覆。', example: '下星期聯絡一個合作機構，了解是否可安排試行。', required: true },
  { n: 5, ask: '誰會參與或協助？', hint: '列出參與人士或機構，並說明目前情況。每項寫明：已確定、商討中或未接洽。', example: '一位兼職人員協助整理資料（已確定）；一個合作單位正商討參與方式（商討中）。', required: true },
  { n: 6, ask: '希望在何時之前達到甚麼成果？', hint: 'AI 將按你的文件建議一個目標，並標示為「暫定」', example: '年底前完成三次試行', required: false },
  { n: 7, ask: '這項工作有哪些必須做到的要求或特別之處？', hint: 'AI 將從文件摘錄，供你校對', example: '', required: false },
  { n: 8, ask: '有哪些事情 AI 絕不可自行處理？', hint: '預設：對外聯絡、支出、作出承諾及刪除檔案，均須先徵求你的同意', example: '', required: false },
  { n: 9, ask: '希望 AI 多久工作一次？每星期哪一天向你了解近況？', hint: '預設：每日晚上 9 時工作一次；逢星期一了解近況；每次最多 30 分鐘', example: '', required: false },
  { n: 10, ask: '是否同時進行兩項彼此獨立的工作（對象、資金或做法均不同）？', hint: '預設：視為同一項工作處理', example: '', required: false },
  { n: 11, ask: '你最擔心甚麼？', hint: 'AI 將從文件列出估計，供你校對', example: '', required: false },
  { n: 12, ask: '現有文件清單（名稱、日期、是否最新版本）', hint: 'AI 將閱讀你提交的全部文件，以最新日期為準', example: '', required: false }
];

const TYPE_OVERRIDES = {
  service: {
    1: { ask: '你提供甚麼服務？服務誰？', hint: '以一句說明服務內容及服務對象。', example: '我們為長者家庭提供上門電腦設定服務。' },
    2: { ask: '如何收費？', hint: '說明按次、按月或按項目的收費方式；尚未定價可寫「未定」。', example: '每次上門服務收費 300 元，長期支援按月收費。' },
    3: { ask: '已有誰試用服務或付款嗎？', hint: '只寫服務對象已經做過的事。' + PROGRESS_HINT, example: '兩個家庭查詢服務（口頭表示）；一個家庭已預約（實際行動）；一個家庭已付款（付出成本）。' },
    4: { ask: '下一步要見誰？談甚麼？', hint: '寫出下一次接觸的服務對象或合作方，以及希望談妥的事。', example: '下星期約見社區中心主任，商談是否安排試用服務。' },
    5: { ask: '誰參與協助服務？', hint: '列出參與服務的人士或機構，並說明目前情況。每項寫明：已確定、商討中或未接洽。', example: '一位兼職導師已協助服務（已確定）；一名顧問表示願意提供意見（商討中）。' },
    7: { ask: '服務有哪些要求或特別之處？', hint: '例如服務範圍、回應時間、保密安排或必須具備的資格。', example: '每次服務後提供簡短紀錄，涉及個人資料時不得外傳。' }
  },
  goods: {
    1: { ask: '你賣甚麼貨品？賣給誰？', hint: '以一句說明貨品及主要購買者。', example: '我們製作低糖果醬，主要賣給附近家庭和小型咖啡店。' },
    2: { ask: '定價多少？每件成本約多少？', hint: '寫出售價、每件成本或尚未確定的部分。', example: '每瓶售 68 元，每瓶材料和包裝成本約 24 元。' },
    3: { ask: '已賣出多少？有人預訂嗎？', hint: '只寫購買者已經做過的事。' + PROGRESS_HINT, example: '五人查詢（口頭表示）；兩人預訂共六瓶（實際行動）；其中一人已付款（付出成本）。' },
    4: { ask: '下一步要做甚麼？', hint: '例如擺檔、上架或聯絡供應商，並說明希望得到的結果。', example: '下星期在市集擺檔，並向兩間包裝供應商索取報價。' },
    5: { ask: '誰參與？', hint: '列出供應商、工匠、代賣點或協助者，並說明目前情況。每項寫明：已確定、商討中或未接洽。', example: '一位工匠已完成首批貨品（已確定）；一間選物店表示願意代賣（商討中）。' },
    7: { ask: '貨品規格、每月可做多少、在哪裏賣？', hint: '寫出貨品規格、產量、保存要求及銷售地點。', example: '每月可製作 120 瓶，冷藏保存，在市集和網店出售。' }
  },
  online: {
    1: { ask: '你提供甚麼內容或網上服務？對象是誰？', hint: '以一句說明內容或服務，以及主要使用者或觀眾。', example: '我們提供給初學者的家居烘焙短片課程。' },
    2: { ask: '如何收費？', hint: '說明訂閱、單次收費、廣告或其他方式；尚未定價可寫「未定」。', example: '首三課免費，其後按月訂閱，每月 48 元。' },
    3: { ask: '已有多少人使用？有人付款嗎？', hint: '只寫使用者或觀眾已經做過的事。' + PROGRESS_HINT, example: '二十人觀看試看片段（實際行動）；三人表示願意訂閱（口頭表示）；一人已付款（付出成本）。' },
    4: { ask: '下一步要推出甚麼？接觸誰？', hint: '寫出下一項內容、功能或合作接觸，以及希望得到的結果。', example: '下星期推出首個完整單元，並聯絡一個內容平台商談合作。' },
    5: { ask: '誰參與？', hint: '列出製作、技術或合作平台，並說明目前情況。每項寫明：已確定、商討中或未接洽。', example: '一位剪輯師已完成試看片段（已確定）；一個平台表示可安排推介（商討中）。' },
    7: { ask: '平台或內容有哪些規格？', hint: '例如發布平台、內容長度、更新頻率、存取安排或技術要求。', example: '每節課不超過 12 分鐘，每兩星期更新一次，支援手機觀看。' }
  },
  nonprofit: {
    1: { ask: '計劃做甚麼？服務對象是誰？', hint: '以一句說明計劃內容及服務對象。', example: '我們為獨居長者安排社區飯聚和電話關懷。' },
    2: { ask: '資金來自哪裏？', hint: '說明資助、捐款、收費或其他資金來源；尚未確定可寫「未定」。', example: '正申請社區資助，同時接受小額捐款。' },
    3: { ask: '已服務多少人？已申請或取得哪些資助？', hint: '只寫服務對象、資助方或捐款方已經做過的事。' + PROGRESS_HINT, example: '十名長者參加過活動（實際行動）；一個基金表示有興趣（口頭表示）；已收到一筆捐款（付出成本）。' },
    4: { ask: '下一步要接觸誰？', hint: '例如基金、合作機構或服務對象，並說明希望談妥的事。', example: '下星期聯絡一間社區中心，商談轉介服務對象。' },
    5: { ask: '誰參與？', hint: '列出核心成員、義工或合作機構，並說明目前情況。每項寫明：已確定、商討中或未接洽。', example: '兩名義工已協助活動（已確定）；一間機構表示願意借出場地（商討中）。' },
    7: { ask: '計劃有甚麼法規或受資助條件？', hint: '例如服務資格、申請條件、保密要求或報告責任。', example: '服務對象須由合作機構轉介，每季提交活動和資金使用紀錄。' }
  }
};

export function intakeQuestions(type) {
  const changes = TYPE_OVERRIDES[type] || {};
  return INTAKE_QUESTIONS.map(q => ({ ...q, ...(changes[q.n] || {}) }));
}

export function bizTypeLabel(type, other = '') {
  const label = BIZ_TYPES[type] && BIZ_TYPES[type].label;
  return type === 'other' && String(other).trim() ? `${label}：${String(other).trim()}` : label || '';
}

// 測試用 SOS_DATA 指定另一個資料夾，唔會郁到創辦人用緊嘅 data/
export function dataDirs(root, options = {}) {
  const data = process.env.SOS_DATA || path.join(root, 'data');
  const d = {
    data,
    replies: path.join(data, 'founder', 'replies'),
    inbox: path.join(data, 'founder', 'inbox'),
    company: path.join(data, 'company'),
    archive: path.join(data, 'archive'),
    ledger: path.join(data, 'ledger'),
    answers: path.join(data, 'ledger', 'answers'),
    asks: path.join(data, 'asks'),
    sandbox: path.join(data, 'sandbox'),
    work: path.join(data, 'work')
  };
  if (options.create !== false) for (const [k, v] of Object.entries(d)) if (k !== 'data') fs.mkdirSync(v, { recursive: true });
  return d;
}

/* ---------- 紀錄：每條答案一行（公司概覽同問題包共用） ---------- */
const logFile = dirs => path.join(dirs.ledger, 'decisions.jsonl');
export function appendLog(dirs, entries) {
  if (!entries.length) return;
  fs.appendFileSync(logFile(dirs), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
}
export function readLog(dirs, limit = 500) {
  let t = '';
  try { t = fs.readFileSync(logFile(dirs), 'utf8'); } catch { return []; }
  return t.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse().slice(0, limit);
}
const norm = s => String(s || '').replace(/[\s，。、？?！!：:；;「」『』（）()\-—…·.,]/g, '').toLowerCase();
function askedBefore(dirs) {
  const seen = new Set();
  // 公司概覽同問題包嘅答案都計：答過嘅唔再問（答「不知道」嘅另計：到期前唔問，到期可以再問）
  for (const e of readLog(dirs, 100000)) if (e.question && e.qid !== 'rest' && !e.unknown) seen.add(norm(e.question));
  return seen;
}
/* ---------- 「不知道／稍後提供」（規劃書 3.1 未有細節、4.10）：答咗不知道嘅事記入帳本 intake.missingDetails，到期前唔再問 ---------- */
export const UNKNOWN_DAYS = 7;
export function openUnknowns(dirs, now = clockNow()) {
  const s = readJSON(path.join(dirs.ledger, 'state.json'), null);
  const list = s && s.intake && Array.isArray(s.intake.missingDetails) ? s.intake.missingDetails : [];
  const today = localIso(now).slice(0, 10);
  return list.filter(m => m && m.question && !m.answeredAt && (!m.until || m.until >= today));
}
// 同一件事：AI 填嘅 about 相同，或者問題字面相近（去掉常見問法後雙字詞重疊 ≥ 0.45；2026-10-28 試走嘅重複題同不同事項之間分得開）
const ASK_FILLER = /是甚麼|是什麼|是幾點|是誰|請直接寫出|請寫一兩句|請寫出|請直接|直接|實際|具體|甚麼|什麼|哪裏|如何|多少|以及|的|與|和|及|或|在|中/g;
const grams = s => { const b = new Set(); for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2)); return b; };
export function sameThing(a, b) {
  if (a.about && b.about && norm(a.about) === norm(b.about)) return true;
  const x = grams(norm(a.ask || a.question).replace(ASK_FILLER, '')), y = grams(norm(b.ask || b.question).replace(ASK_FILLER, ''));
  if (!x.size || !y.size) return false;
  let n = 0; for (const g of x) if (y.has(g)) n++;
  return 2 * n / (x.size + y.size) >= 0.45;
}
// AI 建議係提示句（「要你提供」「請填寫……」）：改為「不知道／稍後提供」選項並作建議；原句留作自訂答案框嘅提示
function unknownOption(q) {
  const kind = q.kind || 'choice';
  if (kind !== 'choice' && kind !== 'text') return q;
  const all = Array.isArray(q.options) ? q.options : [], opts = all.filter(o => o && !NAMES.isPlaceholder(o.text));
  const bad = NAMES.isPlaceholder(q.value), U = NAMES.ui.unknownLater;
  if (!bad && opts.length === all.length) return q;
  // 建議本身係真答案、只係有個選項係「我自己填」：建議照用，嗰個選項換成「不知道／稍後提供」
  if (!bad) return { ...q, options: opts.slice(0, 2).concat([{ text: U }]) };
  return { ...q, kind: 'choice', hint: String(q.value), value: U, options: opts.map(o => ({ ...o, rec: false })).slice(0, 2).concat([{ text: U, rec: true }]) };
}

/* ---------- 問題包：核對、答過唔再問、按優先拆包 ---------- */
const KINDS = ['choice', 'multi', 'date', 'text'];
export const MAX_PER_PACK = 12;
// 所有畫面名稱（書面語）；問題包標題要過同一條口語字檢查
export const NAMES = createRequire(import.meta.url)('./names.js');
// strictTitle：命令入口（AI 可以即刻改）用 true，標題有口語字就退回；AI 流程入面用 false，只記警告照樣放上去，免得創辦人睇唔到問題
export function preparePacks(raw, { dirs, askedBy = 'AI', fromRun = null, strictTitle = true, system = false } = {}) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['內容不是問題包'] };
  if (raw.format !== 'startup-os.ask/0.1') errors.push('問題包格式版本不正確');
  const title = String(raw.title || '').trim();
  if (!title) errors.push('缺少標題');
  else if (title.length > 60) errors.push('標題超過 60 字');
  else if (NAMES.isColloquial(title)) (strictTitle ? errors : warnings).push(`標題須使用書面語（含口語字：${[...new Set(NAMES.colloquial(title))].join('、')}）`);
  const actionConfirm = raw.actionConfirm && /^[\w-]{1,80}$/.test(String(raw.actionConfirm.taskId || '')) ? { taskId: String(raw.actionConfirm.taskId) } : null;
  if (raw.actionConfirm && !actionConfirm) errors.push('本人行動題的工作編號不正確');
  const sourceQs = Array.isArray(raw.questions) ? raw.questions : [];
  const qs = actionConfirm ? sourceQs.map(q => ({ id: q && q.id, priority: q && q.priority, about: q && q.about, ask: q && q.ask, judge: q && q.judge, kind: 'choice', effect: 'now',
    options: [{ text: NAMES.ui.actionDone }, { text: NAMES.ui.actionNotDone }, { text: NAMES.ui.actionReschedule }], ...(q && q.conflict ? { conflict: q.conflict } : {}) })) : sourceQs;
  if (!qs.length) errors.push('缺少題目');
  const ids = new Set();
  qs.forEach((q, i) => {
    const at = `第 ${i + 1} 條`;
    if (!q || typeof q !== 'object') { errors.push(at + '格式不正確'); return; }
    if (!/^[\w-]{1,40}$/.test(String(q.id || ''))) errors.push(at + '編號不正確');
    else if (ids.has(q.id)) errors.push(at + '編號重複');
    else ids.add(q.id);
    if (!String(q.ask || '').trim()) errors.push(at + '缺少問題內容');
    const kind = q.kind || 'choice';
    if (!KINDS.includes(kind)) errors.push(at + '題目類型不正確');
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length > 3) errors.push(at + '選項超過三個');
    if (kind === 'multi' && opts.length < 2) errors.push(at + '多選題須至少有兩個選項');
    if (kind === 'choice' && opts.length === 1) errors.push(at + '只有一個選項');
    const v = q.value;
    if (!actionConfirm && (v == null || (!Array.isArray(v) && !String(v).trim()) || (Array.isArray(v) && !v.length && kind !== 'multi'))) errors.push(at + '缺少 AI 建議答案');
    if (!actionConfirm && kind === 'multi' && !Array.isArray(v)) errors.push(at + '多選題的建議答案格式不正確');
    if (!actionConfirm && kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push(at + '日期格式不正確（須包含年、月、日）');
    if (!actionConfirm && !String(q.why || '').trim()) errors.push(at + '缺少建議理由');
    const eff = q.effect || 'tentative';
    if (!['tentative', 'now'].includes(eff)) errors.push(at + '效力設定不正確');
    if (eff === 'now' && kind !== 'date' && !opts.length) errors.push(at + '即時生效的題目必須提供選項');
    for (const key of ['risk', 'conflict']) if (q[key] != null && (typeof q[key] !== 'string' || q[key].trim().length > 120)) errors.push(at + key + '須為 120 字以內的文字');
    if (eff === 'now' && !system && !actionConfirm && !String(q.risk || '').trim()) errors.push(at + '不合規格：即時生效的題目必須說明風險');
  });
  // 即刻生效嘅題目要逐條問，一定入第一批，所以一個包最多 3 條
  if (qs.filter(q => q && q.effect === 'now').length > 3) errors.push('每個問題包最多只可有 3 條即時生效的題目');
  // 規劃書 4.10：畫面會顯示嘅字（說明、題目、判斷句、理由、選項、建議值）命中內部術語、AI 腔、自足檢查或口語字：
  // 命令入口交嘅包即退回（對話中嘅 AI 可以即時改）；AI 流程入面只記警告（外殼另有改寫一次同機械替換）。標「你原話」嘅行唔掃。
  const shown = [['說明', raw.context]].concat(qs.flatMap((q, i) => !q || typeof q !== 'object' ? [] : [[`第 ${i + 1} 條`, q.ask], [`第 ${i + 1} 條`, q.judge], [`第 ${i + 1} 條理由`, q.why], [`第 ${i + 1} 條風險`, q.risk], [`第 ${i + 1} 條差異`, q.conflict]]
    .concat((Array.isArray(q.options) ? q.options : []).map(o => [`第 ${i + 1} 條選項`, o && o.text]), q.kind === 'date' ? [] : [[`第 ${i + 1} 條建議`, Array.isArray(q.value) ? q.value.join('、') : q.value]])));
  const titleHits = NAMES.styleIssues(title).filter(h => h.kind !== 'colloquial');
  if (titleHits.length) shown.unshift(['標題', title]);
  for (const [where, s] of shown) {
    if (typeof s !== 'string') continue;
    const hits = s.split(/\r?\n/).filter(l => !/你原話/.test(l)).flatMap(l => NAMES.styleIssues(l)).filter(h => !(where === '標題' && h.kind === 'colloquial'));
    if (hits.length) (strictTitle ? errors : warnings).push(`${where}須使用自足的商用書面語（含：${[...new Set(hits.map(h => h.term.trim()))].slice(0, 5).join('、')}）`);
  }
  if (errors.length) return { ok: false, errors };
  const seen = dirs ? askedBefore(dirs) : new Set(), unknowns = dirs ? openUnknowns(dirs) : [];
  const dropped = [], keep = [];
  qs.forEach((q, i) => {
    if (seen.has(norm(q.ask))) { dropped.push(q.ask); return; }
    if (q.effect !== 'now' && unknowns.some(u => sameThing(q, u))) { dropped.push(q.ask); warnings.push('你已答「' + NAMES.ui.unknownLater + '」的事項，到期前不再詢問：' + q.ask); return; }
    const fixed = q.effect === 'now' ? q : unknownOption(q);
    if (fixed !== q) warnings.push('AI 建議只是提示句，已改為「' + NAMES.ui.unknownLater + '」：' + q.ask);
    keep.push({ ...fixed, kind: fixed.kind || 'choice', effect: q.effect || 'tentative', priority: Number(q.priority) || i + 1 });
  });
  if (!keep.length) return { ok: true, packs: [], dropped, warnings };
  keep.sort((a, b) => a.priority - b.priority);
  const chunks = [];
  for (let i = 0; i < keep.length; i += MAX_PER_PACK) chunks.push(keep.slice(i, i + MAX_PER_PACK));
  const base = 'ask-' + stamp();
  const packs = chunks.map((part, i) => ({
    format: raw.format,
    id: base + (chunks.length > 1 ? '-' + (i + 1) : ''),
    title: chunks.length > 1 ? `${title}（${i + 1}／${chunks.length}）` : title,
    context: raw.context ? String(raw.context) : '',
    afterConfirm: raw.afterConfirm ? String(raw.afterConfirm) : '',
    next: raw.next && raw.next.task ? { task: String(raw.next.task) } : null,
    askedBy, askedAt: localIso(), fromRun,
    questions: part,
    ...(actionConfirm ? { actionConfirm } : {})
  }));
  return { ok: true, packs, dropped, warnings };
}
export function placePacks(dirs, packs) {
  const placed = [];
  for (const p of packs) {
    let id = p.id, n = 1;
    while (fs.existsSync(path.join(dirs.asks, id + '.json'))) id = p.id + '-' + String.fromCharCode(97 + n++);
    p.id = id;
    writeJSON(path.join(dirs.asks, id + '.json'), p);
    placed.push({ id, title: p.title, count: p.questions.length });
  }
  return placed;
}
export function loadPack(dirs, id) {
  if (!/^[\w-]{1,80}$/.test(String(id || ''))) return null;
  return readJSON(path.join(dirs.asks, id + '.json'), null);
}
export function loadAnswers(dirs, id) { return readJSON(path.join(dirs.answers, id + '.json'), { answers: {} }); }
export function listPacks(dirs) {
  return fs.readdirSync(dirs.asks).filter(f => f.endsWith('.json')).map(f => {
    const p = readJSON(path.join(dirs.asks, f), null);
    if (!p || !Array.isArray(p.questions)) return null;
    const a = loadAnswers(dirs, p.id).answers;
    const answered = p.questions.filter(q => a[q.id]).length;
    return { id: p.id, title: p.title, askedBy: p.askedBy, askedAt: p.askedAt, total: p.questions.length, answered, open: p.questions.length - answered, fromRun: p.fromRun || null, helpForPackId: p.help && p.help.packId || '' };
  }).filter(Boolean).sort((x, y) => String(y.askedAt).localeCompare(String(x.askedAt)));
}
