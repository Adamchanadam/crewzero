// CrewZero 問題包共用工具：外殼（run.mjs）、伺服器（server.mjs）、命令（ask.mjs）都用呢度，規則只寫一次。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { factMergeOn } from './features.mjs';

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
// 先讀後整份寫回的清單檔（例如 founder-ops.json）用：檔案不存在才回空清單；暫時讀不到會短暫重試；
// 仍讀不到或內容不是清單就回 null，呼叫者不可寫回（否則會蓋掉未處理的項目；主線全面審查 2026-11-12 06-architecture 第 1 項）。
// 問題包版本雜湊：保留全部題目，只去掉 closed／reopened 標記，所以收起或取回題目不會令創辦人已開着的作答頁失效；
// 已收起的題逐題不套用（factClosedStale），其餘答案照常。開關打開時作答頁看到的問題包已濾走已收起的題，
// 所以由伺服器 /api/ask 以磁碟上的完整問題包計好交給作答頁（hash 欄），作答頁照送。
// 沒有這兩種標記的問題包，結果與 0.43.0 的 fnv(JSON.stringify(pack)) 相同。ask.html 的 packHash（後備）必須用同一算法。
export function packHash(pack) {
  const qs = pack && Array.isArray(pack.questions) ? pack.questions : null;
  if (!qs || !qs.some(q => q && typeof q === 'object' && ('closed' in q || 'reopened' in q))) return fnv(JSON.stringify(pack));
  return fnv(JSON.stringify({ ...pack, questions: qs.map(q => { if (!q || typeof q !== 'object') return q; const { closed, reopened, ...rest } = q; return rest; }) }));
}
export function readListStrict(f) {
  for (let i = 0; i < 10; i++) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); }
    catch (e) { if (e && e.code === 'ENOENT') return []; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); continue; }
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
  }
  return null;
}
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
export function validateAskReply(parsed, pack) {
  if (!parsed?.ok || !pack || parsed.head.kind !== 'ask-answer' || parsed.machine.format !== 'startup-os.ask-reply/0.1' || parsed.head.ref !== pack.id || parsed.machine.pack !== pack.id || !Array.isArray(parsed.machine.answers) || !Array.isArray(pack.questions)) return { ok: false, reason: 'identity-or-format' };
  const ids = new Set(pack.questions.map(q => String(q.id))), seen = new Set();
  if (ids.size !== pack.questions.length) return { ok: false, reason: 'unknown-or-duplicate-question' };
  for (const a of parsed.machine.answers) {
    if (!a || !['string', 'number'].includes(typeof a.id) || !ids.has(String(a.id)) || seen.has(String(a.id))) return { ok: false, reason: 'unknown-or-duplicate-question' };
    const q = pack.questions.find(item => String(item.id) === String(a.id));
    if (q && q.kind === 'money') {
      const allowed = [NAMES.ui.mnyConfirm, NAMES.ui.mnyConfirmEdit, NAMES.ui.mnyReject];
      if (!allowed.includes(a.value)) return { ok: false, reason: 'invalid-money-answer' };
      const hasEdit = Object.hasOwn(a, 'edit');
      if (hasEdit !== (a.value === NAMES.ui.mnyConfirmEdit)) return { ok: false, reason: 'invalid-money-edit' };
      if (hasEdit) {
        if (!a.edit || typeof a.edit !== 'object' || Array.isArray(a.edit)) return { ok: false, reason: 'invalid-money-edit' };
        const keys = Object.keys(a.edit), allowedKeys = ['amount', 'date', 'category', 'what', 'payer'];
        if (!keys.length || keys.some(key => !allowedKeys.includes(key))) return { ok: false, reason: 'invalid-money-edit' };
      }
    }
    seen.add(String(a.id));
  }
  return { ok: true };
}
// Windows：另一個程序啱啱讀緊同一個檔時，改名覆蓋會暫時被拒（EPERM／EBUSY），等一陣再試
export function writeJSON(f, obj) {
  const tmp = `${f}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
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

// 公司概覽版本雜湊（校對頁載入時算一次，確認回覆帶回；外殼用同一算法核對）。來源連結可以在同一頁更正（伺服器改 page.json），
// 所以雜湊略去 sources[] 的 url、urlBefore、fixedOn；沒有這三欄的舊頁面雜湊與 0.39.1 的算法結果相同。proofread.html 的 hashView() 必須同一算法。
export function proofreadHash(page) {
  const view = page && Array.isArray(page.sources) ? { ...page, sources: page.sources.map(s => { if (!s || typeof s !== 'object') return s; const { url, urlBefore, fixedOn, ...rest } = s; return rest; }) } : page;
  return fnv(JSON.stringify(view));
}
// 收件匣檔案分類（唯一定義處）：附件存檔名是「<編號>-note-<類型>-file-NN-<原名>」「<編號>-intake-NN-<原名>」「<編號>-prefill-NN-<原名>」，原名可以是任何字（例如以 -note-event.md、-intake.md 結尾），
// 所以「看結尾認筆記」不可靠：先排除附件（舊檔同樣適用，不用改檔名），餘下才按筆記命名規則認。
// 0.42.0：minutes-speakers（建議講者）、minutes-draft（整理會議紀錄草稿）由伺服器寫入收件匣，外殼 run.mjs handleNote 處理
const NOTE_TYPES_RE = 'order|adhoc|help|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc|ideate|minutes-speakers|minutes-draft|ext-draft';
export const isInboxAttachment = f => /-note-(?:order|adhoc|event|doc)-file-\d+-/.test(String(f)) || /-(?:intake|prefill)-\d+-/.test(String(f));
export const isInboxNote = f => !isInboxAttachment(f) && (new RegExp('-note-(?:' + NOTE_TYPES_RE + ')\\.md$').test(String(f)) || /-feedback-[a-z]+\.md$/.test(String(f)));
export const isInboxNoteOf = (f, type) => !isInboxAttachment(f) && String(f).endsWith('-note-' + type + '.md');
export const isInboxIntake = f => !isInboxAttachment(f) && String(f).endsWith('-intake.md');
export const isInboxPrefill = f => !isInboxAttachment(f) && String(f).endsWith('-prefill.md');
// 0.39.1 及以前的算法（整頁不略去任何欄）：升級前已載入的校對頁帶回這個值。只供「確認流程的版本比對」兼收，不用於新頁面。
export function proofreadHashLegacy(page) { return fnv(JSON.stringify(page)); }
export function proofreadHashMatches(page, hash) { return typeof hash === 'string' && (hash === proofreadHash(page) || hash === proofreadHashLegacy(page)); }

// 公司概覽「最近一次確認內容」的摘要值（唯一定義處之一；proofread.html 的 digestOf() 用同一算法）：
// 以 { 全部欄位 id 排序後的 [id, 值]、路線次序、各站真事／工作 } 串起後取 fnv。
// 校對頁以目前有效內容算同一個值，與伺服器確認內容的摘要值相同才算「已交付」。
const digestOf = (values, order, kinds) => fnv(JSON.stringify([
  Object.keys(values).sort().map(id => [id, String(values[id] ?? '')]),
  order.map(String),
  Object.keys(kinds).sort().map(id => [id, kinds[id] === 'task' ? 'task' : 'real'])]));
// 公司概覽資料裡的全部欄位（id → 值）：與外殼 run.mjs 的 registry() 同一走法
function pageFieldValues(page) {
  const out = {};
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && 'value' in o && 'label' in o) out[o.id] = String(o.value ?? '');
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
  })(page);
  return out;
}
// 伺服器已確認的內容（值、路線次序、各站真事／工作類別、摘要值）。給了公司概覽資料（page）就按該頁補齊：
// 欄位缺的用 Zero 原值、類別缺的用該站原本的類別、次序缺的用原次序（例如示範資料的確認紀錄沒有 kinds），
// 令校對頁用同一算法算出的摘要值一致。confirmed.json 沒有版次欄位：確認只可能屬於目前這一頁（新頁安裝時舊確認會被移走），
// 這裡再核對 pageId；不屬本頁就沒有快照。
export function confirmedSnapshot(c, page) {
  if (!c || typeof c !== 'object' || !c.values || typeof c.values !== 'object') return null;
  if (page) {
    if (!page.page || !page.page.id || c.pageId !== page.page.id) return null;
    const ms = Array.isArray(page.path && page.path.milestones) ? page.path.milestones : [];
    const base = pageFieldValues(page), values = {};
    for (const id of Object.keys(base)) values[id] = String(c.values[id] ?? base[id]);
    const ck = c.kinds && typeof c.kinds === 'object' ? c.kinds : {}, kinds = {};
    for (const m of ms) kinds[m.id] = (ck[m.id] ?? m.kind) === 'task' ? 'task' : 'real';
    const order = Array.isArray(c.order) ? c.order.map(String) : ms.map(m => String(m.id));
    return { pageId: c.pageId, revision: page.page.revision || 0, digest: digestOf(values, order, kinds), values, order, kinds, autoIds: (Array.isArray(c.autoEdits) ? c.autoEdits : []).map(e => e && e.id).filter(id => typeof id === 'string' && id in values), confirmedAt: c.confirmedAt || '', replyFile: c.replyFile || '' };
  }
  const values = {}; for (const id of Object.keys(c.values)) values[id] = String(c.values[id] ?? '');
  const kinds = c.kinds && typeof c.kinds === 'object' ? c.kinds : {};
  return { pageId: c.pageId, revision: null, digest: digestOf(values, Array.isArray(c.order) ? c.order : [], kinds), values, order: Array.isArray(c.order) ? c.order.map(String) : [], kinds, autoIds: [], confirmedAt: c.confirmedAt || '', replyFile: c.replyFile || '' };
}
export function confirmedDigest(c, page) {
  const s = confirmedSnapshot(c, page);
  return s ? s.digest : '';
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
export const ownsServerPort = (port, reportedPid, programRoot) => serverOwnership(port, reportedPid, programRoot) === 'same';export const SERVER_VERSION = 'proofread-chain-0.44.1';
// 預設由 4380 開始；SOS_PORT 可以改（測試用，唔會撞到創辦人開緊嘅伺服器）
export const BASE_PORT = Number(process.env.SOS_PORT) || 4380;

export const BIZ_TYPES = Object.assign(Object.create(null), {
  service: { label: '服務', example: '上門照顧、顧問、維修' },
  goods: { label: '實體貨品', example: '手作、零售、食品' },
  online: { label: '軟件、網上服務或內容', example: '網上工具、訂閱、課程' },
  platform: { label: '平台或配對', example: '連接買方與賣方' },
  nonprofit: { label: '非牟利或社企', example: '社區計劃、資助項目' },
  other: { label: '其他', example: '請用一句說明' }
});

export const INTAKE_QUESTIONS = [
  { n: 1, ask: '你在做甚麼，或打算做甚麼？', hint: '一句即可；初步想法亦可。', example: '為咖啡店供應低糖果醬', required: true },
  { n: 2, ask: '主要是給誰的？', hint: '使用者、購買者或服務對象皆可。', example: '五至二十人的私家診所', required: false },
  { n: 3, ask: '對方為甚麼需要？', hint: '對方現時的麻煩，或為甚麼選你；不清楚可留空。', example: '家長一改時段，主任便要全部重排', required: false },
  { n: 4, ask: '如何收取款項或得到資金？', hint: '有數字就寫，未定可留空。', example: '每瓶 78 元，成本約 30 元；每月訂閱；佣金 15%；正申請資助', required: false },
  { n: 5, ask: '到目前為止，有誰已經試用、付款或答應合作？', hint: '只寫已發生的事；沒有也可留空。', example: '兩人查詢、一間已試用、三間已付款', required: false },
  { n: 6, ask: '下一步打算做甚麼？', hint: '未想好可留空。', example: '下星期約見第三間診所', required: false },
  { n: 7, ask: '有誰一起做或協助？', hint: '只有你一人可留空；也可以寫你自己的相關經驗或人脈。', example: '一名兼職幫手；兩間合作機構；我做過八年餐飲採購', required: false },
  { n: 8, ask: '你最擔心甚麼？', hint: '想到甚麼寫甚麼。', example: '', required: false }
];

export function intakeQuestions(type) {
  return INTAKE_QUESTIONS.map(q => ({ ...q }));
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
export function preparePacks(raw, { dirs, askedBy = 'AI', fromRun = null, strictTitle = true, system = false, noDedupe = false } = {}) {
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
  if (actionConfirm && sourceQs.length > 1) errors.push('本人行動問題包只可有一條題目');
  if (noDedupe && sourceQs.length > 1) errors.push('求助問題包只可有一條題目');
  const qs = actionConfirm ? sourceQs.map(q => ({ id: q && q.id, priority: q && q.priority, about: q && q.about, ask: q && q.ask, judge: q && q.judge, kind: 'choice', effect: 'now',
    options: [{ text: NAMES.ui.actionDone }, { text: NAMES.ui.actionNotDone }, { text: NAMES.ui.actionReschedule }], ...(q && q.conflict ? { conflict: q.conflict } : {}) })) : sourceQs;
  if (!qs.length) errors.push('缺少題目');
  const ids = new Set();
  qs.forEach((q, i) => {
    const at = `第 ${i + 1} 條`;
    if (!q || typeof q !== 'object') { errors.push(at + '格式不正確'); return; }
    if (!/^[\w-]{1,40}$/.test(String(q.id || ''))) errors.push(at + '編號不正確');
    else if (ids.has(String(q.id))) errors.push(at + '編號重複');
    else ids.add(String(q.id));
    if (!String(q.ask || '').trim()) errors.push(at + '缺少問題內容');
    const kind = q.kind || 'choice';
    if (!KINDS.includes(kind)) errors.push(at + '題目類型不正確');
    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length > 3) errors.push(at + '選項超過三個');
    if (kind === 'multi' && opts.length < 2) errors.push(at + '多選題須至少有兩個選項');
    if (kind === 'choice' && opts.length === 1) errors.push(at + '只有一個選項');
    const v = q.value;
    if (!actionConfirm && (v == null || (!Array.isArray(v) && !String(v).trim()) || (Array.isArray(v) && !v.length && kind !== 'multi'))) errors.push(at + '缺少 Zero 建議答案');
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
    if (!noDedupe && seen.has(norm(q.ask))) { dropped.push(q.ask); return; }
    if (q.effect !== 'now' && unknowns.some(u => sameThing(q, u))) { dropped.push(q.ask); warnings.push('你已答「' + NAMES.ui.unknownLater + '」的事項，到期前不再詢問：' + q.ask); return; }
    const fixed = q.effect === 'now' ? q : unknownOption(q);
    if (fixed !== q) warnings.push('Zero 建議只是提示句，已改為「' + NAMES.ui.unknownLater + '」：' + q.ask);
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
// 每週訪問續行判斷的共用定義；其餘既有流程暫時維持自己的既定判斷。
export function requiresFounder(pack, q) {
  return !!(q && (pack && pack.ideate || q.effect === 'now' || q.conflict || q.bind === 'results' || pack && pack.actionConfirm || pack && pack.acceptance && q.id === 'accept'));
}
export function listPacks(dirs) {
  return fs.readdirSync(dirs.asks).filter(f => f.endsWith('.json')).map(f => {
    const p = readJSON(path.join(dirs.asks, f), null);
    if (!p || !Array.isArray(p.questions)) return null;
    const a = loadAnswers(dirs, p.id).answers;
    const merge = factMergeOn(), visible = q => !a[q.id] && (!merge || !q.closed);
    const answered = p.questions.filter(q => a[q.id]).length;
    const closed = merge ? p.questions.filter(q => q && q.closed) : [];
    return { id: p.id, title: p.title, askedBy: p.askedBy, askedAt: p.askedAt, total: p.questions.length, answered, open: p.questions.filter(visible).length, urgent: p.questions.some(q => visible(q) && (q.effect === 'now' || q.conflict)), fromRun: p.fromRun || null, helpForPackId: p.help && p.help.packId || '', isHelp: !!p.help, ...(merge && closed.length ? { closed } : {}) };
  }).filter(Boolean).sort((x, y) => String(y.askedAt).localeCompare(String(x.askedAt)));
}
