// 節奏三檔、按檔保險絲、衝刺期限、積壓保護、兩次失敗停止、校對計數、對外判定（0.41.0，設計稿；唯一定義處）。
// 純函數：只收狀態與日期，回判定或新狀態；不讀寫檔、不讀時鐘。定稿決定（proposal-v2.md 文末）第 3、4 點；狀態表 Z27–Z49。
import { ownerKind } from './people-ops.mjs';

const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const dayMs = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
export const diffDays = (a, b) => (isDay(String(a).slice(0, 10)) && isDay(String(b).slice(0, 10))) ? Math.round((dayMs(a) - dayMs(b)) / 86400000) : null;
export const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---------- 三檔（唯一定義處）：件數上限、保險絲（每日 AI 啟動上限）、排程器逾時 ---------- */
export const PACES = {
  standard: { itemsPerDay: 1, fuse: 40, timeoutMinutes: 45 },
  fast: { itemsPerDay: 3, fuse: 50, timeoutMinutes: 90 },
  sprint: { itemsPerDay: 10, fuse: 80, timeoutMinutes: 240 }
};
export const PACE_KEYS = Object.keys(PACES);
export const SPRINT_MAX_DAYS = 14;
export const BACKLOG_MAX = 10;        // 未看產出超過此數即暫停衝刺
export const NO_REPLY_DAYS = 2;       // 創辦人連續兩日沒有回覆任何題目
export const TOOL_FAIL_LIMIT = 2;     // AI 工具連續兩次失敗
export const ARTIFACTS_MAX = 2;       // 每次最多收兩份產出
// 系統頁顯示：每檔估計每日 AI 次數（典型／最差）。每件最差 6 次：做、用字改寫、校對、校對重寫、用字改寫、再校對；典型約 2.1 次（做 1＋用字改寫 0.3＋對外一半 × (校 1＋三分之一 × 2)）；加恆常典型 1
export const STARTS_PER_ITEM = { worst: 6, typical: 2.1, internalWorst: 2 };
export const PACE_ESTIMATE = { standard: { typical: 3, worst: 6 }, fast: { typical: 7, worst: 18 }, sprint: { typical: 22, worst: 60 } };

export const paceKey = state => { const p = state && state.company && state.company.rhythm && state.company.rhythm.pace; return PACE_KEYS.includes(p) ? p : 'standard'; };
export const paceOf = state => PACES[paceKey(state)];
export const fuseOf = state => paceOf(state).fuse;
export const itemsCapOf = state => paceOf(state).itemsPerDay;
export const timeoutOf = state => paceOf(state).timeoutMinutes;

/* ---------- 衝刺期限（定稿第 4 點）：預設到紀錄內最近的真實日期（下一個對外動作日、目前目標日、有日期的創辦人行動），最長 14 日 ---------- */
export function sprintDefaultUntil(state, today) {
  if (!isDay(today)) return '';
  const s = state || {}, cands = [];
  const na = (s.company || {}).nextExternalAction; if (na && isDay(na.date)) cands.push(na.date);
  for (const m of s.milestones || []) if (m && m.pathStatus !== 'retired' && ['active', 'waiting', 'blocked', 'next'].includes(m.state) && isDay(m.targetDate)) cands.push(m.targetDate);
  for (const t of s.tasks || []) if (t && t.owner === 'founder' && !['done', 'cancelled'].includes(t.status) && isDay(String(t.dueAt || '').slice(0, 10))) cands.push(String(t.dueAt).slice(0, 10));
  const max = addDays(today, SPRINT_MAX_DAYS);
  const future = cands.filter(d => d > today && d <= max).sort();
  return future[0] || max;
}
// 改檔（Z35）：pace 寫入；轉衝刺時沒有 sprintUntil 就用預設；超過 14 日即截到 14 日
export function setPace(state, { pace, sprintUntil = '', today = '' } = {}) {
  if (!PACE_KEYS.includes(pace)) return state;
  const s = clone(state || {}); s.company = s.company || {}; s.company.rhythm = s.company.rhythm || {};
  const r = s.company.rhythm; r.pace = pace;
  const wasSprint = !!(state && state.company && state.company.rhythm && state.company.rhythm.pace === 'sprint');
  if (pace === 'sprint') {
    const max = isDay(today) ? addDays(today, SPRINT_MAX_DAYS) : '';
    let u = isDay(sprintUntil) ? sprintUntil : sprintDefaultUntil(s, today);
    if (max && u > max) u = max;
    if (isDay(today) && u <= today) u = max;
    r.sprintUntil = u; delete r.sprintEndedOn;
    if (isDay(today) && !wasSprint) r.sprintStartedOn = today;   // 衝刺開始日（衝刺中改期限不重設）
  }
  if (!(pace === 'sprint' && wasSprint)) delete r.sprintPause;   // 衝刺中只改期限：積壓暫停照留（覆核建議 e）
  return s;
}
// 到期（Z48）：sprintUntil 過後首次開工，pace 寫回 standard，sprintUntil 保留、記 sprintEndedOn
export function expireSprint(state, today) {
  const s0 = state || {}, r0 = (s0.company || {}).rhythm || {};
  if (r0.pace !== 'sprint' || !isDay(r0.sprintUntil) || !isDay(today) || today <= r0.sprintUntil) return state;
  const s = clone(s0); const r = s.company.rhythm; r.pace = 'standard'; r.sprintEndedOn = today; delete r.sprintPause;
  return s;
}
export const sprintExpired = (state, today) => { const r = ((state || {}).company || {}).rhythm || {}; return r.pace === 'sprint' && isDay(r.sprintUntil) && isDay(today) && today > r.sprintUntil; };

/* ---------- 工作日（必修 3）：開工時鎖定日期，件數及保險絲按該工作日全部工作計，跨午夜不歸零 ---------- */
export const workDayOf = startedAt => String(startedAt || '').slice(0, 10);
/* ---------- 啟動計數（Z36）：解析 ai-starts.log 每行「時間\t類別\t沙盒名」（run.mjs 第 501 行格式）。
   類別：proofread（統籌校對）、qa-rewrite（校對發回的重寫）計入「其中校對」；現有 rewrite（用字改寫）屬 work，不算校對。
   runIds：屬該工作日的全部 run 編號（runs[].workDay === day）；沙盒名以 run 編號開頭的行即使跨午夜仍計入該工作日。 ---------- */
export const START_KINDS = { proofread: 'proofread', 'qa-rewrite': 'qaRewrite', roles: 'roles', 'roles-repair': 'roles', work: 'work', rhythm: 'work', rewrite: 'work' };
export function countStarts(lines, day, { runIds = [] } = {}) {
  const out = { total: 0, work: 0, proofread: 0, qaRewrite: 0, roles: 0, other: 0 };
  const ids = (runIds || []).filter(Boolean);
  for (const l of (Array.isArray(lines) ? lines : String(lines || '').split('\n'))) {
    if (!l) continue;
    const cols = String(l).split('\t'), sb = cols[2] || '';
    if (!String(l).startsWith(day) && !ids.some(id => sb.startsWith(id))) continue;
    out.total++; const k = START_KINDS[cols[1] || ''] || 'other'; out[k]++;
  }
  return out;
}
export const proofreadStarts = c => (c.proofread || 0) + (c.qaRewrite || 0);
export const runIdsOfDay = (state, day) => ((state || {}).runs || []).filter(r => r && (r.workDay || workDayOf(r.startedAt)) === day).map(r => r.id);
export const fuseLeft = (state, counts) => fuseOf(state) - (counts ? counts.total : 0);
// 系統頁一句的數字：{ used, fuse, proofread }
export const usageView = (state, counts) => ({ used: counts ? counts.total : 0, fuse: fuseOf(state), proofread: counts ? proofreadStarts(counts) : 0 });

/* ---------- 閱讀積壓（J3）、兩日沒有回覆（J4） ---------- */
// 未看產出（必修 4，取代先前 J3 定義）：仍未作答的驗收題數。只有需要創辦人驗收的產出才出驗收題（對外產出、啟用任務）；內部產出不出題、不計。
// packs：待決事項內的問題包（{ id, open, todoType, acceptance? }），由呼叫者讀入；驗收題以 todoType 'acceptance' 識別（現有團隊頁入口同一類）。
export const isAcceptancePack = p => !!p && p.open !== false && (p.todoType === 'acceptance' || !!p.acceptance);
export const unreadCount = (packs) => (Array.isArray(packs) ? packs : []).filter(isAcceptancePack).length;
// 一件收尾後要不要出驗收題：對外產出或啟用任務 → 出；內部產出 → 不出（Z54）
export const needsAcceptance = ({ external = false, activation = false, ending = 'artifact' } = {}) => ending === 'artifact' && (external || activation);
// 有未答題目而最後一次創辦人輸入距今 ≥ 2 個日曆日 → 回日數；否則 0
export function noReplyDays(state, { today = '', openPacks = 0 } = {}) {
  if (!openPacks || !isDay(today)) return 0;
  const last = String(((state || {}).health || {}).lastInputAt || '').slice(0, 10);
  if (!isDay(last)) return 0;
  const d = diffDays(today, last);
  return d >= NO_REPLY_DAYS ? d : 0;
}

/* ---------- 當日連續工作的停止判定（Z39–Z47）：每件做完叫一次；回 { stop: boolean, reason } ----------
   ctx：{ pace, itemsDone, canDo（餘下可以做的件數）, blockedByQuestions（餘下全受未答題影響）, counts（countStarts）, unread, noReply（noReplyDays 回值）, toolFails（連續失敗次數）, pausedRoles（今日被停的崗位數）, timedOut, briefFails } */
export const STOP_REASONS = ['itemsCap', 'nothingToDo', 'waitingFounder', 'backlog', 'noReply', 'toolFailed', 'fuse', 'timeout', 'rolesPaused', 'briefFailed', 'expired', 'paceChanged', 'paused'];
// 每件之間（必修 3）：重讀帳本後核對——創辦人暫停／自動停、改回標準或加速、程序內總時限（按開工時的檔）。回 { stop, reason }
export function betweenItems(reloaded, { startedPace, startedAt, now } = {}) {
  const h = (reloaded || {}).health || {};
  if (h.pausedByFounder || h.autoStopped) return { stop: true, reason: 'paused' };
  const cur = paceKey(reloaded);
  if (startedPace && cur !== startedPace && PACES[cur].itemsPerDay < PACES[startedPace].itemsPerDay) return { stop: true, reason: 'paceChanged' };
  if (startedAt && now) { const min = (Date.parse(now) - Date.parse(startedAt)) / 60000; if (min >= PACES[startedPace || cur].timeoutMinutes) return { stop: true, reason: 'timeout' }; }
  return { stop: false, reason: '' };
}
export function nextStop(state, ctx = {}) {
  const pace = PACES[ctx.pace || paceKey(state)], sprint = (ctx.pace || paceKey(state)) === 'sprint';
  const total = ctx.counts ? ctx.counts.total : 0;
  if (ctx.timedOut) return { stop: true, reason: 'timeout' };
  if (ctx.paused) return { stop: true, reason: 'paused' };
  if (ctx.paceChanged) return { stop: true, reason: 'paceChanged' };
  if (total >= pace.fuse) return { stop: true, reason: 'fuse' };
  if ((ctx.toolFails || 0) >= TOOL_FAIL_LIMIT) return { stop: true, reason: 'toolFailed' };
  if ((ctx.pausedRoles || 0) >= 2) return { stop: true, reason: 'rolesPaused' };
  if (ctx.briefFails) return { stop: true, reason: 'briefFailed' };
  if (sprint && (ctx.unread || 0) > BACKLOG_MAX) return { stop: true, reason: 'backlog' };
  if (sprint && (ctx.noReply || 0) >= NO_REPLY_DAYS) return { stop: true, reason: 'noReply' };
  if ((ctx.itemsDone || 0) >= pace.itemsPerDay) return { stop: true, reason: 'itemsCap' };
  if ((ctx.canDo || 0) <= 0) return { stop: true, reason: ctx.blockedByQuestions ? 'waitingFounder' : 'nothingToDo' };
  if (ctx.blockedByQuestions) return { stop: true, reason: 'waitingFounder' };
  return { stop: false, reason: '' };
}
// 衝刺暫停狀態（Z42、Z43）：寫入／清除 rhythm.sprintPause；不改 pace。回新狀態（沒改動原樣）
export function applySprintPause(state, { unread = 0, noReply = 0, today = '' } = {}) {
  const s0 = state || {}, r0 = (s0.company || {}).rhythm || {};
  if (r0.pace !== 'sprint') return r0.sprintPause ? (() => { const s = clone(s0); delete s.company.rhythm.sprintPause; return s; })() : state;
  const reason = unread > BACKLOG_MAX ? 'backlog' : noReply >= NO_REPLY_DAYS ? 'noReply' : '';
  if (!reason) { if (!r0.sprintPause) return state; const s = clone(s0); delete s.company.rhythm.sprintPause; return s; }
  if (r0.sprintPause && r0.sprintPause.reason === reason) return state;
  const s = clone(s0); s.company.rhythm.sprintPause = { reason, since: today }; return s;
}
// 工具連續失敗（Z44）：results 為當日逐件結果 [{ ok, failKind }]；只計啟動失敗、逾時、拒收（failKind 非空），blocked 不算
export const toolFailStreak = results => { let n = 0; for (const r of results || []) { if (r && r.failKind) n++; else n = 0; } return n; };
// 防空轉按日（Z49）：當日所有件都沒有創辦人輸入亦沒有經核實進展 → 日終 +1；達 2 自動停。items：[{ hadInput, advanced }]
export function dailyStreak(prev, items) {
  const any = (items || []).some(i => i && (i.hadInput || i.advanced));
  const streak = any ? 0 : (Number(prev) || 0) + 1;
  return { streak, autoStop: streak >= 2 };
}

/* ---------- 每日多件的計劃（Z37、Z38）：按檔決定今日最多做幾件；恆常任務不佔 ---------- */
export const itemsLeftToday = (state, itemsDone) => Math.max(0, itemsCapOf(state) - (itemsDone || 0));

/* ---------- 對外判定（Z27、Z28；state-table-041.md「對外判定規則及例子」）。artifact：{ type, title, text }；selfReport：Zero 自報 'external'|'internal'；actors：名單。回 { external, rules: [...] }
   收窄（覆核建議 a）：收件人規則只認稱呼句式（致／給／您好），不認標題或內文提到對象名；內部準備類型（questions／checklist／research／plan／list）只有含金額才按規則 4 判對外，
   日期、數量、「研究顯示」一類句式在內部類型不算（站名「三間餐廳」、內部時間表「兩星期內」、給創辦人的研究摘要都不對外）。 ---------- */
export const DELIVERABLE_TYPES = ['message', 'quote', 'proposal', 'intro', 'reply', 'questions', 'checklist', 'research', 'plan', 'list'];
export const EXTERNAL_TYPES = ['message', 'quote', 'proposal', 'intro', 'reply'];
const MONEY = /(US\$|HK\$|\$|港幣|港元)\s*\d|\d\s*(元|港幣|港元)(?![素件])/;
const DATE_PROMISE = /(\d{1,2}\s*月\s*\d{1,2}\s*日(前|之前|內)|[兩二三四五六七八九十\d]+\s*(星期|週|周|日|個月)內)/;
const QTY_PROMISE = /每\s*(週|周|星期|月|日|年)\s*[\d一二三四五六七八九十]+\s*(次|間|份|件|個)/;
const CLAIM = /(據[^，。]{1,12}(顯示|指出|統計|報道|報導)|研究顯示|數據顯示|調查顯示|現時有\s*[\d一二三四五六七八九十百千萬]+\s*(間|個|名|位|家))/;
const RECIPIENT = /^(致|給|敬啟者|尊敬的|親愛的)|(您好|你好)[，：]/m;
export function isExternal(artifact, { selfReport = '', actors = [] } = {}) {
  const a = artifact || {}, text = String(a.text || ''), body = text.replace(/^#[^\n]*\n/, ''), head = body.trim().slice(0, 60), rules = [];
  const internalType = DELIVERABLE_TYPES.includes(a.type) && !EXTERNAL_TYPES.includes(a.type);
  if (EXTERNAL_TYPES.includes(a.type)) rules.push('type');
  if (text.slice(0, 40).includes('草稿，未發送')) rules.push('draft');
  if (RECIPIENT.test(head)) rules.push('recipient');
  const money = MONEY.test(text), other = DATE_PROMISE.test(text) || QTY_PROMISE.test(text) || CLAIM.test(text);
  if (money || (!internalType && other)) rules.push('claims');
  if (selfReport === 'external') rules.push('self');
  return { external: rules.length > 0, rules };
}

/* ---------- 校對結果核對（Z29–Z32）：proofread.json { verdict, checks[6], line, issues[] } ---------- */
export const CHECK_ITEMS = ['facts', 'numbersDates', 'names', 'sources', 'deliverable', 'externalWording'];
export const VERDICTS = ['pass', 'return', 'pass_with_notes'];
export function checkProofreadResult(raw, { styleIssues = () => [] } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return { ok: false, verdict: 'return', errors: ['校對結果不可解析'] };
  if (!VERDICTS.includes(raw.verdict)) errors.push('verdict 須為 pass、return 或 pass_with_notes');
  const checks = Array.isArray(raw.checks) ? raw.checks : [];
  const have = new Set(checks.map(c => c && c.item));
  for (const k of CHECK_ITEMS) if (!have.has(k)) errors.push('六項檢查缺「' + k + '」');
  if (checks.some(c => !c || typeof c.ok !== 'boolean')) errors.push('每項檢查須有 ok（true／false）');
  const line = typeof raw.line === 'string' ? raw.line.trim() : '';
  if (!line || line.length > 40) errors.push('結果一句 line 須為 1 至 40 字');
  else if (styleIssues(line).length) errors.push('結果一句有內部用語、編號或口語');
  const issues = (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 5).map(i => i && typeof i === 'object' ? { where: String(i.where || '').slice(0, 60), what: String(i.what || '').slice(0, 120), fix: String(i.fix || '').slice(0, 120) } : null).filter(Boolean);
  if (raw.verdict === 'return' && !issues.length) errors.push('發回時須列出問題 issues');
  if (errors.length) return { ok: false, verdict: 'return', errors, issues };
  return { ok: true, verdict: raw.verdict, line, issues, errors: [] };
}
// 校對流程（每份產出最多兩次校對、一次重寫）。qa：收據現值；verdict：本次校對結果。回新的 qa 及下一步 next：'deliver'|'rewrite'|'deliverFlagged'
export function applyProofread(qa, { verdict, line = '', issues = [] } = {}) {
  const q = { audience: 'external', verdict: 'pending', rounds: 0, line: '', issues: [], ...(qa || {}) };
  const rounds = (q.rounds || 0) + 1;
  if (rounds > 2) return { qa: q, next: 'deliverFlagged' };
  if (verdict === 'pass' || verdict === 'pass_with_notes') return { qa: { ...q, verdict, line, issues: verdict === 'pass_with_notes' ? issues : [], rounds }, next: 'deliver' };
  if (rounds === 1) return { qa: { ...q, verdict: 'pending', line, issues, rounds }, next: 'rewrite' };
  return { qa: { ...q, verdict: 'flagged', line, issues, rounds }, next: 'deliverFlagged' };
}
// 每件最差啟動次數：對外 6（做、用字改寫、校對、校對重寫、用字改寫、再校對）；內部 2（做、用字改寫）
export const startsPerItem = external => external ? STARTS_PER_ITEM.worst : STARTS_PER_ITEM.internalWorst;
// 收據只收前兩份（Z33）：回 { kept, dropped }
export const keepArtifacts = arts => { const a = Array.isArray(arts) ? arts : []; return { kept: a.slice(0, ARTIFACTS_MAX), dropped: Math.max(0, a.length - ARTIFACTS_MAX) }; };

/* ---------- 每日多件的工作循環（必修 1）：外殼自己排「可以做」清單並逐件派工，每件收尾寫明工作狀態，當日已做或已卡住的件排除 ----------
   次序照 ai-rhythm.md 的揀選次序：1 缺少的資料（firstBatch）→ 2 下一個對外動作的準備（prepFor 有日期的創辦人行動、或屬下一個對外動作所在站，日期由近至遠）
   → 3 進行中的站（state active／waiting／blocked）按路線次序 → 4 其餘按路線次序，再按建立次序。只收 AI 負責、未完成、不在等待的工作。 ---------- */
const openAI = t => t && ownerKind(t.owner) === 'ai' && !['done', 'cancelled', 'waiting', 'blocked'].includes(t.status);
export function orderCanDo(state, { today = '', doneToday = [] } = {}) {
  const s = state || {}, ms = (s.milestones || []).filter(Boolean), by = Object.fromEntries((s.tasks || []).filter(Boolean).map(t => [t.id, t]));
  const ord = id => { const m = ms.find(x => x.id === id); return m ? (Number(m.order) || Number(m.orderConfirmed) || 99) : 99; };
  const na = (s.company || {}).nextExternalAction || {}, naMs = na.milestoneId || '';
  const skip = new Set(doneToday || []);
  const rank = t => {
    if (t.firstBatch) return [0, '', ord(t.milestoneId)];
    const due = [].concat(t.prepFor || []).map(id => by[id]).filter(a => a && a.dueAt && !['done', 'cancelled'].includes(a.status)).map(a => String(a.dueAt).slice(0, 10)).sort()[0];
    if (due) return [1, due, ord(t.milestoneId)];
    if (naMs && t.milestoneId === naMs) return [1, String(na.date || '9999'), ord(t.milestoneId)];
    const m = ms.find(x => x.id === t.milestoneId);
    if (m && ['active', 'waiting', 'blocked'].includes(m.state)) return [2, '', ord(t.milestoneId)];
    return [3, '', ord(t.milestoneId)];
  };
  return (s.tasks || []).filter(t => openAI(t) && !skip.has(t.id) && t.failedOn !== today && t.blockedOn !== today && t.cadence !== 'standing')
    .map((t, i) => ({ t, r: rank(t), i })).sort((a, b) => a.r[0] - b.r[0] || String(a.r[1]).localeCompare(String(b.r[1])) || a.r[2] - b.r[2] || a.i - b.i).map(x => x.t);
}
// 一件收尾後的工作狀態（Z53）：artifact → done（要驗收的標 needsAcceptance，驗收前不算已接受）；
// blocked → 只記 blockedOn（卡住的工作日）及 waitingFor，**狀態不變**（0.40 沒有任何程式會解除 status: blocked，一改就永遠不做）——只在同一工作日內排除，翌日自動可再做；
// failed（工具失敗）→ 只記 failedOn，當日不再派
export function applyItemEnding(state, { taskId, ending, waitingFor = '', today = '', now = '', needsAcceptance: acc = false, artifactTitle = '' } = {}) {
  const s = clone(state || {}); const t = (s.tasks || []).find(x => x && x.id === taskId);
  if (!t || !['artifact', 'blocked', 'failed'].includes(ending)) return state;
  if (ending === 'artifact') { t.status = 'done'; t.doneOn = today; delete t.blockedOn; if (acc) { t.needsAcceptance = true; delete t.acceptedBy; } if (artifactTitle) t.artifactTitle = artifactTitle; }
  else if (ending === 'blocked') { t.waitingFor = String(waitingFor || '').slice(0, 80); t.blockedOn = today; }
  else t.failedOn = today;
  if (now) t.updatedAt = now;
  return s;
}
// 創辦人輸入到達（回覆、告訴 Zero、驗收；外殼 noteFounderInput 處呼叫）：解除當日卡住的工作，同日可再做。milestoneIds 給了就只解除那些站的工作，沒有就全部
export function releaseBlocked(state, { milestoneIds = null, today = '' } = {}) {
  const s = clone(state || {}); let changed = false;
  for (const t of s.tasks || []) {
    if (!t || !t.blockedOn) continue;
    if (Array.isArray(milestoneIds) && !milestoneIds.includes(t.milestoneId)) continue;
    delete t.blockedOn; changed = true;
  }
  return changed ? s : state;
}
// 當日已做的件（排除用）：runs[].items 內 workDay 等於今日的 taskId
export const doneTodayIds = (state, day) => ((state || {}).runs || []).filter(r => r && (r.workDay || workDayOf(r.startedAt)) === day).flatMap(r => (r.items || []).map(i => i && i.taskId).filter(Boolean));

/* ---------- 創辦人操作隊列（Z58）：「暫停 Zero」及改節奏經現有 founder-ops 隊列傳遞（伺服器寫 ledger/founder-ops.json，外殼每件之間 mergeFounderOps 合併），
   衝刺程序持鎖時亦能在下一件前生效；回覆檔路徑只在開工前套用，持鎖時處理不到。ops：[{ op, value, at }]；不認識的 op 原樣略過（由 run.mjs applyFounderOps 處理其他） ---------- */
export const PACE_OPS = ['setPace', 'pauseZero', 'resumeZero'];
export function applyPaceOps(state, ops, { today = '' } = {}) {
  let s = state;
  for (const op of ops || []) {
    if (!op || !PACE_OPS.includes(op.op)) continue;
    const day = today || String(op.at || '').slice(0, 10);
    if (op.op === 'setPace') s = setPace(s, { pace: op.value && op.value.pace, sprintUntil: (op.value && op.value.sprintUntil) || '', today: day });
    else if (op.op === 'pauseZero') { const n = clone(s || {}); n.health = { ...(n.health || {}), pausedByFounder: true, pausedByFounderAt: op.at || '' }; s = n; }
    else if (op.op === 'resumeZero') { const n = clone(s || {}); n.health = { ...(n.health || {}) }; delete n.health.pausedByFounder; delete n.health.pausedByFounderAt; s = n; }
  }
  return s;
}
