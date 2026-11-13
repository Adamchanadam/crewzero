// 帳本寫入純函數（0.40.0 後台，唯一定義處）：輸入「舊狀態＋事件」，輸出「新狀態」，不碰檔案、不讀時鐘（時間由呼叫者傳入），
// 所以每一行都可以單獨測；run.mjs／server.mjs 只負責讀檔、呼叫、存檔。對照表見 docs/evidence/v0400-ui-2026-11-07/backend-state-table.md。
// 規矩：不改傳入的 state（先複製）；同一事件做兩次，結果與做一次相同（冪等）；失敗或拒絕時回傳原樣（內容相同）。

import { PACE_KEYS, SPRINT_MAX_DAYS, applyPaceOps, addDays as paceAddDays } from './pace-lib.mjs';
import { cardById, pauseCard, resumeCard, rolesKey } from './roles-ops.mjs';

const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const isDay = v => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};
export const dayText = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[2]} 月 ${+m[3]} 日` : String(d || ''); };
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// 日期先後只接受實在的曆日，避免 2 月 30 日或收件時間混入依據日期。
const realDay = value => isDay(value) ? String(value) : '';

// 只比較日期，不比較說法內容；呼叫者已先排除內容相同的項目。
export function compareByDate({ basisDate, basisAssumed, hasCurrent, currentDate, currentAssumed, newestDate } = {}) {
  const basis = realDay(basisDate);
  const current = currentAssumed === true ? '' : realDay(currentDate);
  const newest = realDay(newestDate);
  const assumed = basisAssumed === true || !basis;
  if (assumed) return { result: 'unknown', why: 'basisAssumed', basisDate: basis, currentDate: current };
  if (!hasCurrent) return basis && newest && basis < newest
    ? { result: 'olderMissing', why: '', basisDate: basis, currentDate: current }
    : { result: 'newer', why: 'noCurrent', basisDate: basis, currentDate: current };
  if (!current) return { result: 'unknown', why: 'currentUndated', basisDate: basis, currentDate: '' };
  const result = basis > current ? 'newer' : basis < current ? 'olderDiffers' : 'sameDay';
  return { result, why: '', basisDate: basis, currentDate: current };
}

// 個別說法的日期必須可由事件日期或引句支持，才可取代事件本身的日期。
export function checkAsOf(asOf, { eventDate, dateAssumed, quote, why } = {}) {
  const day = realDay(asOf);
  if (!day || String(why || '').includes('換算')) return '';
  const eventDay = realDay(eventDate);
  if (eventDay && dateAssumed !== true) return day <= eventDay ? day : '';
  if (dateAssumed !== true) return day;
  const [year, monthText, dayText] = day.split('-');
  const month = String(Number(monthText)), date = String(Number(dayText));
  const text = String(quote || '');
  const dateOnly = new RegExp('(?:^|[^\\d])' + month + '\\s*月\\s*' + date + '\\s*日(?!\\d)');
  const fullChinese = new RegExp('(?:^|[^\\d])' + year + '\\s*年\\s*' + month + '\\s*月\\s*' + date + '\\s*日(?!\\d)');
  return dateOnly.test(text) || fullChinese.test(text) || text.includes(day) ? day : '';
}

const inputDate = input => input && input.dateAssumed !== true ? realDay(input.eventDate) : '';

// 讀取現有項目的依據日期；updatedAt 只是寫入時間，絕不可作日程依據。
export function recordBasis(state, ref = {}) {
  const company = (state && state.company) || {};
  if (ref.kind === 'assumption') {
    const assumption = (Array.isArray(company.assumptions) ? company.assumptions : []).find(row => row && row.id === ref.id);
    return assumption ? { has: true, date: realDay(assumption.changedAt), assumed: assumption.changedAtAssumed === true } : { has: false, date: '', assumed: false };
  }
  if (ref.kind === 'nextAction') {
    const action = company.nextExternalAction || {};
    if (!action.text && !action.cancelledAt) return { has: false, date: '', assumed: false };
    // 創辦人其後親自更新亦是現值依據；兩者同日以創辦人更新為準（不是假定日期）。
    const basis = realDay(action.basisDate), founder = realDay(String(action.founderUpdatedAt || '').slice(0, 10));
    if (founder && founder >= basis) return { has: true, date: founder, assumed: false };
    return { has: true, date: basis, assumed: action.basisAssumed === true };
  }
  if (ref.kind === 'task') {
    const task = (Array.isArray(state && state.tasks) ? state.tasks : []).find(row => row && row.id === ref.id);
    if (!task) return { has: false, date: '', assumed: false };
    if (task.basisDate != null && task.basisDate !== '') return { has: true, date: realDay(task.basisDate), assumed: task.basisAssumed === true };
    const inputs = Array.isArray(state && state.inputs) ? state.inputs : [];
    const minutesId = task.minutesSource && task.minutesSource.id;
    const minutesInput = minutesId && inputs.find(row => row && row.minutes && row.minutes.id === minutesId);
    const minutesDate = inputDate(minutesInput);
    if (minutesDate) return { has: true, date: minutesDate, assumed: false };
    const fromDate = inputDate(inputs.find(row => row && row.id === task.fromInput));
    return { has: true, date: fromDate, assumed: false };
  }
  return { has: false, date: '', assumed: false };
}

// 只看已完成處理、日期明確的其他事件；未確認或假定日期不能壓過今次資料。
export function newestEventDate(state, excludeInputId) {
  let newest = '';
  for (const input of (Array.isArray(state && state.inputs) ? state.inputs : [])) {
    const day = inputDate(input);
    if (input && input.id !== excludeInputId && input.status === 'processed' && (input.via === 'event' || input.via === 'doc') && day && day > newest) newest = day;
  }
  return newest;
}

const datedTarget = item => {
  if (item.kind === 'assumption') return { kind: 'assumption', id: item.id };
  if (item.kind === 'nextAction') return { kind: 'nextAction' };
  return { kind: 'task', id: item.sameAsTask };
};

const recordedValue = (state, target) => {
  const company = (state && state.company) || {};
  if (target.kind === 'assumption') {
    const assumption = (Array.isArray(company.assumptions) ? company.assumptions : []).find(row => row && row.id === target.id);
    return assumption ? assumption.grade : '';
  }
  if (target.kind === 'nextAction') return (company.nextExternalAction || {}).text || '';
  const task = (Array.isArray(state && state.tasks) ? state.tasks : []).find(row => row && row.id === target.id);
  return task ? { title: task.title, dueAt: task.dueAt } : { title: '', dueAt: '' };
};

const saidValue = item => item.kind === 'assumption' ? item.grade : item.kind === 'nextAction' ? item.text : { title: item.action, dueAt: item.date };
const sourceOfInput = input => input && input.minutes ? 'meeting' : input && input.via === 'doc' ? 'doc' : 'event';

// 為事件建議加上日期裁決；不改 state 或原有項目，讓外殼可安全重試。
export function dateGate(state, input = {}, items = []) {
  const kept = [], notes = [], dropped = [];
  const newestDate = newestEventDate(state, input.id);
  // 修改版會議紀錄：上一版（及同一份紀錄的其他版本）寫入的現有資料不作日期比較，否則同日修訂會被當作「同日另一個說法」
  const revisedInputs = new Set();
  if (input.minutes) {
    if (input.minutes.revisionOf) revisedInputs.add(String(input.minutes.revisionOf));
    for (const row of (Array.isArray(state && state.inputs) ? state.inputs : [])) if (row && row.id !== input.id && row.minutes && input.minutes.id && row.minutes.id === input.minutes.id) revisedInputs.add(row.id);
  }
  for (const item of (Array.isArray(items) ? items : [])) {
    // 沒有日期的事件：由相對日期換算的跟進一律丟棄，不論是否對應現有日程（DPF-7）
    if (item && input.dateAssumed === true && item.kind === 'followUp' && String(item.why || '').includes('換算')) { dropped.push({ item, reason: 'relative' }); continue; }
    const dated = item && (item.kind === 'assumption' || item.kind === 'nextAction' || (item.kind === 'followUp' && item.sameAsTask));
    if (!dated) { kept.push(item); continue; }
    const task = item.kind === 'followUp' ? (Array.isArray(state && state.tasks) ? state.tasks : []).find(row => row && row.id === item.sameAsTask) : null;
    const company = (state && state.company) || {};
    const currentFrom = item.kind === 'assumption' ? String(((company.assumptions || []).find(row => row && row.id === item.id) || {}).sourceId || '')
      : item.kind === 'nextAction' ? String((company.nextExternalAction || {}).basisFrom || '') : '';
    const exempt = item.revisionOfTaskId || item.revisionFrom || item.revisionAmbiguity || (item.kind === 'followUp' && input.minutes && input.minutes.id && task && task.minutesSource && task.minutesSource.id === input.minutes.id) || (!!currentFrom && revisedInputs.has(currentFrom));
    if (exempt) { kept.push(item); continue; }
    const suppliedAsOf = item.asOf != null && String(item.asOf).trim() !== '';
    const asOf = checkAsOf(item.asOf, { eventDate: input.eventDate, dateAssumed: input.dateAssumed, quote: item.sourceQuote || item.sourceLine || item.why, why: item.why });
    if (suppliedAsOf && !asOf) dropped.push({ item, reason: 'asOf' });
    const basisDate = asOf || input.eventDate;
    // 文件未載日期是逐項假定；不能令同一件文件內有日期的其他項目失去可比較的日期。
    const assumedWhy = typeof item.basisAssumedWhy === 'string' && item.basisAssumedWhy ? item.basisAssumedWhy : '';
    const basisAssumed = asOf ? false : !!assumedWhy || input.dateAssumed === true || !isDay(basisDate);
    const target = datedTarget(item);
    const current = recordBasis(state, target);
    const compared = compareByDate({ basisDate, basisAssumed, hasCurrent: current.has, currentDate: current.date, currentAssumed: current.assumed, newestDate });
    if (compared.result === 'olderDiffers') {
      notes.push({ item, kind: item.kind, targetId: target.id || 'nextAction', said: saidValue(item), now: recordedValue(state, target), basisDate: compared.basisDate, currentDate: compared.currentDate, source: sourceOfInput(input) });
      continue;
    }
    kept.push({ ...item, dated: { result: compared.result, why: assumedWhy || compared.why, basisDate: compared.basisDate, basisAssumed, currentDate: compared.currentDate } });
  }
  return { items: kept, notes, dropped };
}

// 把純函數回傳的新狀態合回呼叫者手上的同一份狀態物件（原地更新，物件身份不變：呼叫者手上的 input、假設、站等參照仍然有效）。
export function mergeInPlace(target, source) {
  const reuse = (old, v) => (old && v && typeof old === 'object' && typeof v === 'object' && Array.isArray(old) === Array.isArray(v)) ? mergeInPlace(old, v) : v;
  if (Array.isArray(target)) { target.length = source.length; source.forEach((v, i) => { target[i] = reuse(target[i], v); }); return target; }
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const k of Object.keys(source)) target[k] = reuse(target[k], source[k]);
  return target;
}

export const CONVERT_REASONS = ['ok', 'legacy', 'encrypted', 'too-big', 'corrupt', 'empty'];
export const LINK_KINDS = ['google-doc', 'google-sheet', 'google-slides'];
export const LINK_REASONS = ['not-shared', 'not-found', 'too-big', 'timeout', 'blocked-redirect', 'network'];
const relJoin = (dir, name) => (dir ? dir.replace(/\\/g, '/').replace(/\/+$/, '') + '/' : '') + name;

// 收件說明檔（inbox/<ref>-note-<類型>-meta.json）核對成乾淨的 meta；任何不合規欄位直接丟掉（說明檔來自本機伺服器，但仍不信任其內容格式）
export function cleanMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const str = (v, n) => (typeof v === 'string' && v.length <= n ? v : '');
  const fileInfo = (Array.isArray(m.fileInfo) ? m.fileInfo : []).slice(0, 60).map(x => {
    if (!x || typeof x !== 'object' || !str(x.name, 200)) return null;
    const o = { name: x.name };
    if (str(x.text, 220)) o.text = x.text;
    if (str(x.url, 300) && /^https:\/\//.test(x.url)) o.url = x.url;
    if (isDay(x.readOn)) o.readOn = x.readOn;
    if (LINK_KINDS.includes(x.kind)) o.kind = x.kind;
    if (CONVERT_REASONS.includes(x.convert)) o.convert = x.convert;
    return o;
  }).filter(Boolean);
  const linkErrors = (Array.isArray(m.linkErrors) ? m.linkErrors : []).slice(0, 10).map(x => x && typeof x === 'object' && str(x.url, 300) && LINK_KINDS.includes(x.kind) && LINK_REASONS.includes(x.reason) ? { url: x.url, kind: x.kind, reason: x.reason } : null).filter(Boolean);
  return { ...(m.source === 'chat' ? { source: 'chat' } : {}), fileInfo, linkErrors };
}

// 登記一件輸入（收件後、封存時）。ev：{ id, via, title, file, dir（封存資料夾，相對 data/）, names（封存了的檔名，含文字版）, eventDate?, receivedAt, meta? }
// 規則：文字版（被 meta.fileInfo[].text 指到的檔）一併封存但不列入 files[]；fileInfo 的路徑改成封存後相對 data/ 的路徑；同編號舊紀錄先移除（重新登記不重複）。
export function registerInput(state, ev) {
  const s = clone(state) || {};
  const meta = cleanMeta(ev.meta);
  const names = Array.isArray(ev.names) ? ev.names.slice() : [];
  const have = new Set(names);
  const sidecars = new Set(meta.fileInfo.map(x => x.text).filter(t => t && have.has(t)));
  const files = names.filter(n => !sidecars.has(n)).sort().map(n => relJoin(ev.dir, n));
  const fileInfo = meta.fileInfo.filter(x => have.has(x.name) && !sidecars.has(x.name)).map(x => {
    const o = { file: relJoin(ev.dir, x.name) };
    if (x.text && have.has(x.text)) o.text = relJoin(ev.dir, x.text);
    for (const k of ['url', 'readOn', 'kind', 'convert']) if (x[k]) o[k] = x[k];
    return o;
  });
  const input = { id: ev.id, kind: 'inbox', via: ev.via, title: ev.title, file: ev.file || '', files, ...(ev.eventDate ? { eventDate: ev.eventDate } : {}), ...(ev.dateAssumed === true ? { dateAssumed: true } : {}), receivedAt: ev.receivedAt, status: 'unprocessed', effects: [],
    ...(meta.source ? { source: meta.source } : {}), ...(fileInfo.length ? { fileInfo } : {}), ...(meta.linkErrors.length ? { linkErrors: meta.linkErrors } : {}) };
  s.inputs = (Array.isArray(s.inputs) ? s.inputs : []).filter(i => i && i.id !== ev.id);
  s.inputs.push(input);
  return s;
}

// Zero 交回「讀了甚麼」：summary、read（文件重點）、reason（沒有影響的原因）、grade、unreadable。找不到輸入就原樣返回。
export function recordReading(state, inputId, r) {
  const s = clone(state) || {};
  const input = (s.inputs || []).find(i => i && i.id === inputId);
  if (!input) return s;
  if (r.summary) input.summary = clip(r.summary.trim(), 300);
  if (r.grade) input.grade = r.grade;
  if (r.unreadable && r.unreadable.length) input.unreadable = r.unreadable; else delete input.unreadable;
  if (r.read) input.read = r.read; else delete input.read;
  if (r.reason) input.reason = r.reason; else delete input.reason;
  return s;
}

// 加一項「確認後改變了甚麼」。before／after 是創辦人看得懂的狀態名；同一項（種類、對象、內容相同）不重複加。
export function addEffect(state, inputId, eff) {
  const s = clone(state) || {};
  const input = (s.inputs || []).find(i => i && i.id === inputId);
  if (!input) return s;
  input.effects = Array.isArray(input.effects) ? input.effects : [];
  if (input.effects.some(e => e && e.targetKind === eff.targetKind && e.targetId === eff.targetId && e.change === eff.change)) return s;
  const e = { targetKind: eff.targetKind, targetId: eff.targetId, change: eff.change };
  if (eff.before) e.before = String(eff.before);
  if (eff.after) e.after = String(eff.after);
  if (eff.dueAt) e.dueAt = eff.dueAt;
  input.effects.push(e);
  return s;
}

export const followUpTaskId = (inputId, qid) => 'fu-' + inputId + '-' + qid;

// 創辦人答了「跟進日期」確認題。answer：'accept' 加入日程；其他（reject／keep）不寫任何行動，只記「不加入」。
// item：{ date, action, station?, why, basisDate?, basisAssumed?, basisFrom? }；today 只用來看是否已過期（過期仍可加入，由日程顯示逾期）。冪等：同一題（輸入＋題號）只加一次。
export function applyFollowUp(state, { inputId, qid, answer, item, now }) {
  const s = clone(state) || {};
  const input = (s.inputs || []).find(i => i && i.id === inputId);
  if (!input || !item || !isDay(item.date) || !item.action) return s;
  const taskId = followUpTaskId(inputId, qid);
  const label = clip(String(item.action).replace(/\s+/g, ' ').trim(), 40);
  if (answer !== 'accept') return addEffect(s, inputId, { targetKind: 'decision', targetId: taskId, change: '「' + label + '」沒有加入日程' });
  s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
  if (!s.tasks.some(t => t && t.id === taskId)) {
    const station = item.station && (s.milestones || []).some(m => m.id === item.station) ? item.station : '';
    s.tasks.push({ id: taskId, title: label, owner: 'founder', status: 'planned', dueAt: item.date, ...(station ? { milestoneId: station } : {}), next: clip(item.why || '', 60), fromInput: inputId, ...(isDay(item.basisDate) ? { basisDate: item.basisDate } : {}), ...(item.basisAssumed === true ? { basisAssumed: true } : {}), ...(typeof item.basisFrom === 'string' && item.basisFrom ? { basisFrom: item.basisFrom } : {}), updatedAt: now || '' });
  }
  return addEffect(s, inputId, { targetKind: 'followUp', targetId: taskId, change: '已加入日程：' + dayText(item.date) + '　' + label, before: '未排入日程', after: dayText(item.date), dueAt: item.date });
}

// 重新讀取 Google 連結：fresh 是新快照 { file, text?, readOn }（相對 data/ 的路徑）；舊快照記入 previous 保留；fresh 為空（讀取失敗）就原樣返回。
// n 是 files[] 的序號。
export function refreshSnapshot(state, { inputId, n, fresh }) {
  const s = clone(state) || {};
  if (!fresh || !fresh.file || !isDay(fresh.readOn)) return s;
  const input = (s.inputs || []).find(i => i && i.id === inputId);
  if (!input || !Array.isArray(input.files) || !input.files[n]) return s;
  const info = (input.fileInfo || []).find(x => x && x.file === input.files[n] && x.url);
  if (!info || info.file === fresh.file) return s;
  info.previous = (Array.isArray(info.previous) ? info.previous : []).concat([{ file: info.file, ...(info.text ? { text: info.text } : {}), ...(info.readOn ? { readOn: info.readOn } : {}) }]).slice(-20);
  input.files[n] = fresh.file;
  info.file = fresh.file;
  if (fresh.text) info.text = fresh.text; else delete info.text;
  info.readOn = fresh.readOn;
  return s;
}

/* ---------- out/event.json 新欄位核對（回傳錯誤清單；通過時一併回傳整理後的內容） ---------- */

// read：{ summary, highlights: [{ text, page?, file? }] }；styleIssues 是 NAMES.styleIssues（創辦人看得到的字句要過口語／術語／編號檢查）
export function checkRead(read, { delivered = [], styleIssues = () => [] } = {}) {
  if (read == null) return { ok: true, read: null, errors: [] };
  const errors = [];
  if (!read || typeof read !== 'object' || Array.isArray(read)) return { ok: false, read: null, errors: ['read 必須是 { summary, highlights }'] };
  const t = (x, n) => typeof x === 'string' && x.trim() && x.length <= n;
  if (!t(read.summary, 200)) errors.push('read.summary 必須是一兩句（最多 200 字）：Zero 讀了甚麼、對照了甚麼');
  const hl = Array.isArray(read.highlights) ? read.highlights : [];
  if (!Array.isArray(read.highlights)) errors.push('read.highlights 必須是清單（沒有文件重點就寫空清單）');
  const highlights = [];
  hl.slice(0, 8).forEach((h, i) => {
    const at = `read.highlights 第 ${i + 1} 項`;
    if (!h || typeof h !== 'object' || !t(h.text, 120)) return errors.push(at + '必須有 text（一句，最多 120 字）');
    const o = { text: h.text.trim() };
    if (h.page != null) { if (Number.isInteger(h.page) && h.page > 0 && h.page < 10000) o.page = h.page; else return errors.push(at + '的 page 必須是頁碼數字'); }
    if (h.file != null) { const f = typeof h.file === 'string' ? delivered.find(d => d === h.file || d === h.file.replace(/^files\//, '')) : null; if (f) o.file = f; else return errors.push(at + '的 file 必須是今次附件的檔名'); }
    highlights.push(o);
  });
  const texts = [read.summary, ...highlights.map(h => h.text)].filter(x => typeof x === 'string');
  for (const x of texts) { const hits = styleIssues(x); if (hits.length) { errors.push('read 內的字句有內部用語、編號或口語：「' + x.slice(0, 30) + '」，請改為商用書面語、不寫編號'); break; } }
  if (errors.length) return { ok: false, read: null, errors };
  return { ok: true, read: { summary: read.summary.trim(), highlights }, errors };
}

export function checkReason(reason, { styleIssues = () => [] } = {}) {
  if (reason == null) return { ok: true, reason: '', errors: [] };
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 400) return { ok: false, reason: '', errors: ['reason 必須是一句（最多 120 字）'] };
  // 稍長（121–400 字）不退回修正：外殼在 120 字內最後一個句號處截斷，沒有句號就截至 119 字加「…」（0.44.0 真實 AI 一批 R4）
  let text = reason.trim();
  if (text.length > 120) {
    const head = text.slice(0, 120), stop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('；'));
    text = stop >= 20 ? head.slice(0, stop + 1) : text.slice(0, 119) + '…';
  }
  if (styleIssues(text).length) return { ok: false, reason: '', errors: ['reason 有內部用語、編號或口語，請改為商用書面語、不寫編號'] };
  return { ok: true, reason: text, errors: [] };
}

// followUp 項：{ kind: 'followUp', date, action, station?, why }；日期必須合規且不早於事件日；站點必須存在；字數有上限
export function checkFollowUpItem(it, at, { eventDate, milestones = [], styleIssues = () => [] } = {}) {
  const errors = [];
  if (!isDay(it.date)) errors.push(at + '：followUp 的 date 必須是 YYYY-MM-DD 的真實日期');
  else if (eventDate && it.date < eventDate) errors.push(at + '：followUp 的 date 不可早於事件日期');
  if (typeof it.action !== 'string' || !it.action.trim() || it.action.length > 80) errors.push(at + '：followUp 的 action 必須是一句（最多 80 字）：要做甚麼');
  if (it.station != null && it.station !== '' && !milestones.some(m => m.id === it.station)) errors.push(at + '：找不到站 ' + it.station);
  if (typeof it.action === 'string' && styleIssues(it.action).length) errors.push(at + '：followUp 的 action 有內部用語、編號或口語');
  return errors;
}

/* ---------- 來源網址逐字核對（創辦人答案／附件原文內必須出現） ---------- */

// 來源 sources[]：{ title, url?, from?: 'answer'|'file', ... }。凡 from 為 answer／file 而有 url 的，url 必須逐字出現在 corpus（創辦人答案＋附件文字版原文）內。
// 回傳 { ok, bad: [{ index, url }] }。純函數。
export function checkSourceUrls(sources, corpus) {
  const bad = [];
  (Array.isArray(sources) ? sources : []).forEach((x, index) => {
    if (!x || typeof x !== 'object' || !x.url || (x.from !== 'answer' && x.from !== 'file')) return;
    if (!String(corpus || '').includes(String(x.url))) bad.push({ index, url: String(x.url) });
  });
  return { ok: !bad.length, bad };
}
// 退回修正後仍不符：把 url 留空並加註（note 由呼叫者傳入，字句放 names.js）
export function blankBadSourceUrls(sources, corpus, note) {
  const out = clone(sources) || [];
  for (const b of checkSourceUrls(out, corpus).bad) { delete out[b.index].url; out[b.index].note = [out[b.index].note, note].filter(Boolean).join('；'); }
  return out;
}

// 外部連結試開結果（link-check.mjs 的 Map：網址 → { state }）：明確打不開（broken）的出處在 field 加註 text；不刪網址；unknown 不標；同一句不重複加。純函數。
export function annotateBrokenLinks(entries, results, field, text) {
  return (Array.isArray(entries) ? entries : []).map(e => {
    if (!e || typeof e !== 'object' || !e.url) return e;
    const r = results && typeof results.get === 'function' ? results.get(e.url) : null;
    if (!r || r.state !== 'broken') return e;
    const base = String(e[field] || '');
    if (base.includes(text)) return e;
    return { ...e, [field]: field === 'note' ? [base, text].filter(Boolean).join('；') : base + '（' + text + '）' };
  });
}

// 出處自報有沒有讀過全文：缺欄或 false 一律標「（只經搜尋摘要）」。回傳要加在出處後的字尾（可能為空）
export function fullTextSuffix(entry, suffix) {
  if (!entry || !entry.url) return '';
  return entry.fullText === true ? '' : suffix;
}

/* ---------- 0.41.0 創辦人操作（節奏、暫停 Zero、崗位暫停／恢復、重新擬崗位）的伺服器核對 ----------
   凍結表見 docs/evidence/zero-roles-2026-11-08/impl-contract.md 第 2 節。純函數：只收操作、帳本狀態、待套用操作及今日日期。
   「已暫停才接受」之類的狀態核對，先把尚未合併的同類操作按次序重播到帳本上再判斷，所以同一批連按（暫停兩次、暫停後再暫停同一卡）不會重複接受。 */
export const ROLES_OPS = { setPace: ['pace', 'sprintUntil'], pauseZero: [], resumeZero: [], rolePause: ['reason'], roleResume: [], rolesSync: [] };
export const ROLES_OP_NAMES = Object.keys(ROLES_OPS);
export function replayRolesOps(state, ops) {
  let s = state || {};
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object' || !ROLES_OP_NAMES.includes(op.op)) continue;
    const v = op.value && typeof op.value === 'object' ? op.value : {};
    if (op.op === 'setPace' || op.op === 'pauseZero' || op.op === 'resumeZero') s = applyPaceOps(s, [op], {});
    else if (op.op === 'rolePause') s = pauseCard(s, { teammateId: op.target, reason: v.reason || '', now: op.at || '' });
    else if (op.op === 'roleResume') s = resumeCard(s, { teammateId: op.target, now: op.at || '' });
    else s = { ...s, rolesSync: { ...(s.rolesSync || {}), requested: true } };
  }
  return s;
}
// 回 { ok: true, value }（value 是要存進隊列的整理後欄位）或 { ok: false }。rolesPackOpen：已有未答完的崗位確認題包（由伺服器讀題目包得出）
export function checkRolesOp(op, target, value, state, { pending = [], today = '', rolesPackOpen = false } = {}) {
  const bad = { ok: false };
  if (!ROLES_OP_NAMES.includes(op) || typeof target !== 'string') return bad;
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (Object.keys(v).some(k => !ROLES_OPS[op].includes(k))) return bad;
  const eff = replayRolesOps(state, pending);
  const paused = !!(eff.health && eff.health.pausedByFounder);
  if (op === 'setPace') {
    if (target !== 'company' || !PACE_KEYS.includes(v.pace)) return bad;
    const until = v.sprintUntil == null || v.sprintUntil === '' ? '' : v.sprintUntil;
    if (until) {
      // 期限只屬於衝刺；不早於今日、不遲於今日＋14 日
      if (v.pace !== 'sprint' || typeof until !== 'string' || !isDay(until) || !isDay(today) || until < today || until > paceAddDays(today, SPRINT_MAX_DAYS)) return bad;
    }
    return { ok: true, value: { pace: v.pace, ...(until ? { sprintUntil: until } : {}) } };
  }
  if (op === 'pauseZero') return target === 'company' && !paused ? { ok: true, value: {} } : bad;
  if (op === 'resumeZero') return target === 'company' && paused ? { ok: true, value: {} } : bad;
  if (op === 'rolesSync') {
    const rs = eff.rolesSync || {};
    // 概覽已確認（此版有擬崗位依據）、沒有未答的崗位題、未在擬崗位中（已要求、或還有排隊未出的卡）
    if (target !== 'roles' || !rolesKey(eff) || eff.demo === true || rolesPackOpen || rs.requested || (Array.isArray(rs.pending) && rs.pending.length)) return bad;
    return { ok: true, value: {} };
  }
  // rolePause／roleResume：target 是崗位卡編號，卡必須存在
  const card = target ? cardById(eff, target) : null;
  if (!card) return bad;
  if (op === 'rolePause') {
    if (!['planned', 'enabled'].includes(card.lifecycle || 'planned')) return bad;
    let reason = '';
    if (v.reason != null) {
      if (typeof v.reason !== 'string') return bad;
      reason = v.reason.trim();
      if (reason.length > 80) return bad;
    }
    return { ok: true, value: reason ? { reason } : {} };
  }
  return card.lifecycle === 'paused' ? { ok: true, value: {} } : bad;
}
