// startup-os 問題包共用工具：外殼（run.mjs）、伺服器（server.mjs）、命令（ask.mjs）都用呢度，規則只寫一次。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
export const rootId = root => Buffer.from(String(root).toLowerCase()).toString('base64url').slice(-24);
export const SERVER_VERSION = 'proofread-chain-0.32';
// 預設由 4380 開始；SOS_PORT 可以改（測試用，唔會撞到創辦人開緊嘅伺服器）
export const BASE_PORT = Number(process.env.SOS_PORT) || 4380;

export const INTAKE_QUESTIONS = [
  { n: 1, ask: '你提供甚麼產品或服務？對象是誰？', hint: '以一句說明：你提供甚麼產品或服務，主要客戶是哪類人士或機構。', example: '我們為社區診所整理預約流程，客戶是 5 至 20 人規模的私家診所。', required: true },
  { n: 2, ask: '如何收費？', hint: '由誰付款、大致如何收費（每次、每月、每年或按項目）。尚未定價可寫「未定」。非牟利機構請寫明資金來源（資助、捐款）。', example: '診所每月繳付月費，價錢未定；計劃首三個月免費試用。', required: true },
  { n: 3, ask: '目前進展如何？', hint: '公司以外已發生的事。每項寫明對象及其行動，再選擇一個程度：口頭表示、實際行動、付出成本。尚未有進展可寫「未有」。', example: '兩間診所的負責人表示有興趣（口頭表示）；一間已試用兩星期（實際行動）；尚未有人付款。', required: true },
  { n: 4, ask: '下一步要與誰會面、做甚麼？', hint: '你的下一個對外行動：約見誰、商談甚麼、希望對方答覆甚麼。', example: '下星期約見第三間診所的負責人，邀請對方試用一個月。', required: true },
  { n: 5, ask: '有誰參與協助？', hint: '有哪些人士或機構參與（合夥人、顧問、合作夥伴、供應商、兼職人員）。每項寫明：已確定、商討中、未接洽。', example: '表哥負責編寫程式（已確定）；一間醫療用品公司或可協助轉介客戶（商討中）。', required: true },
  { n: 6, ask: '希望在何時之前達到甚麼成果？', hint: 'AI 將按你的文件建議一個目標，並標示為「暫定」', example: '年底前有三間診所付款', required: false },
  { n: 7, ask: '產品或服務有哪些必須做到的要求或特別之處？', hint: 'AI 將從文件摘錄，供你校對', example: '', required: false },
  { n: 8, ask: '有哪些事情 AI 絕不可自行處理？', hint: '預設：對外聯絡、支出、作出承諾及刪除檔案，均須先徵求你的同意', example: '', required: false },
  { n: 9, ask: '希望 AI 多久工作一次？每星期哪一天向你了解近況？', hint: '預設：每日晚上 9 時工作一次；逢星期一了解近況；每次最多 30 分鐘', example: '', required: false },
  { n: 10, ask: '是否經營兩項互不相干的業務（客戶及收入來源均不同）？', hint: '預設：視為同一項業務處理', example: '', required: false },
  { n: 11, ask: '你最擔心甚麼？', hint: 'AI 將從文件列出估計，供你校對', example: '', required: false },
  { n: 12, ask: '現有文件清單（名稱、日期、是否最新版本）', hint: 'AI 將閱讀你提交的全部文件，以最新日期為準', example: '', required: false }
];

// 測試用 SOS_DATA 指定另一個資料夾，唔會郁到創辦人用緊嘅 data/
export function dataDirs(root) {
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
  for (const [k, v] of Object.entries(d)) if (k !== 'data') fs.mkdirSync(v, { recursive: true });
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
export function preparePacks(raw, { dirs, askedBy = 'AI', fromRun = null, strictTitle = true } = {}) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['內容不是問題包'] };
  if (raw.format !== 'startup-os.ask/0.1') errors.push('問題包格式版本不正確');
  const title = String(raw.title || '').trim();
  if (!title) errors.push('缺少標題');
  else if (title.length > 60) errors.push('標題超過 60 字');
  else if (NAMES.isColloquial(title)) (strictTitle ? errors : warnings).push(`標題須使用書面語（含口語字：${[...new Set(NAMES.colloquial(title))].join('、')}）`);
  const qs = Array.isArray(raw.questions) ? raw.questions : [];
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
    if (v == null || (!Array.isArray(v) && !String(v).trim()) || (Array.isArray(v) && !v.length && kind !== 'multi')) errors.push(at + '缺少 AI 建議答案');
    if (kind === 'multi' && !Array.isArray(v)) errors.push(at + '多選題的建議答案格式不正確');
    if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors.push(at + '日期格式不正確（須包含年、月、日）');
    if (!String(q.why || '').trim()) errors.push(at + '缺少建議理由');
    const eff = q.effect || 'tentative';
    if (!['tentative', 'now'].includes(eff)) errors.push(at + '效力設定不正確');
    if (eff === 'now' && kind !== 'date' && !opts.length) errors.push(at + '即時生效的題目必須提供選項');
  });
  // 即刻生效嘅題目要逐條問，一定入第一批，所以一個包最多 3 條
  if (qs.filter(q => q && q.effect === 'now').length > 3) errors.push('每個問題包最多只可有 3 條即時生效的題目');
  // 規劃書 4.10：畫面會顯示嘅字（說明、題目、判斷句、理由、選項、建議值）命中內部術語、AI 腔、自足檢查或口語字：
  // 命令入口交嘅包即退回（對話中嘅 AI 可以即時改）；AI 流程入面只記警告（外殼另有改寫一次同機械替換）。標「你原話」嘅行唔掃。
  const shown = [['說明', raw.context]].concat(qs.flatMap((q, i) => !q || typeof q !== 'object' ? [] : [[`第 ${i + 1} 條`, q.ask], [`第 ${i + 1} 條`, q.judge], [`第 ${i + 1} 條理由`, q.why]]
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
    questions: part
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
    return { id: p.id, title: p.title, askedBy: p.askedBy, askedAt: p.askedAt, total: p.questions.length, answered, open: p.questions.length - answered, fromRun: p.fromRun || null };
  }).filter(Boolean).sort((x, y) => String(y.askedAt).localeCompare(String(x.askedAt)));
}
