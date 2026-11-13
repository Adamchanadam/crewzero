// CrewZero 營運監察台：畫面資料（唯一計算處）。伺服器 GET /api/dashboard 回傳呢個函數嘅結果，頁面只負責畫。
// 兩個來源合併，頁面唔分「示範」定「真實」：
//   (a) ledger/state.json（帳本；有就用，欄位逐項合併，冇嘅欄位當空）
//   (b) 原型現有檔：company/page.json（公司概覽）、ledger/confirmed.json（成頁確認）、asks/（問題包）、ledger/status.json（AI 工作）、adapter-cert.json（AI 設定）
// 示範帳本（state.demo = true）嘅時間寫成相對值（例如 "@-3d"、"@+5d 21:00"、"@wed"），讀嘅時候按今日推算，示範資料唔會過期。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hosts, modelCandidates, modelName } from './host-lib.mjs';
import { isInboxAttachment, NAMES, BIZ_TYPES, readJSON, listPacks, loadPack, loadAnswers, localIso, pad, clockNow } from './ask-lib.mjs';
import { loadBrain } from './brain-lib.mjs';
import { applyActorOp, ACTOR_OPS, ownerKind, ownerView, peopleView, ownershipOf, actorsMentioned, GAP_DAYS, peopleSyncKey, resolveActorId } from './people-ops.mjs';
import { applyTermOp } from './terms-ops.mjs';
import { rhythmOf, nextRunAt, nextWeekday, isRunDay, scheduleEligibility } from './rhythm-lib.mjs';
import { titleOf, liveCards, cardById, resolveCardId, avatarKindOf, AVATAR_KINDS, AVATAR_LEAD, isPausedToday, supportsLines, pauseCard, resumeCard, rolesKey, pausedCardsToday, overCap, permissionsOf, LIFECYCLES } from './roles-ops.mjs';
import { PACES, PACE_KEYS, PACE_ESTIMATE, PACE_OPS, paceKey, fuseOf, itemsCapOf, countStarts, runIdsOfDay, proofreadStarts, applyPaceOps, addDays, SPRINT_MAX_DAYS, sprintDefaultUntil, unreadCount } from './pace-lib.mjs';
import { readMoney, listImportBatches } from './money-store.mjs';
import { samePeriodMetrics, compareMonths, cashRunway, goalProgress, trend as moneyTrend, topUnlistedPayers, payerStats, monthMetrics, liveRecords, hasEvidence } from './money-lib.mjs';
import { readCanvas } from './canvas-store.mjs';
import { factMergeOn } from './features.mjs';

// 公司標誌：創辦人自己上載嘅 data/company/logo.<png|jpg|webp>（伺服器先寫得入）；有幾個就用最新嗰個。
// v 係修改時間，頁面用嚟分辨換咗新圖；冇就 null。
export const LOGO_EXTS = ['png', 'jpg', 'webp'];
export function companyLogo(DIR) {
  let best = null;
  for (const ext of LOGO_EXTS) {
    const file = path.join(DIR.company, 'logo.' + ext);
    try { const s = fs.statSync(file); if (s.isFile() && (!best || s.mtimeMs > best.v)) best = { file, ext, v: Math.round(s.mtimeMs) }; } catch { }
  }
  return best;
}

// 頁頭同各畫面共用：只在外殼程序仍然存在時，才把 status.json 的 running
// 記錄顯示為真正工作中；遺留的狀態檔不能自己變成「進行中」。
export function workStatus(DIR, { outerAlive = false, pending = [], status = null } = {}) {
  const shell = status || readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] }) || { runs: [] };
  const running = outerAlive ? (shell.runs || []).find(r => r && r.state === 'running') : null;
  const activeFiles = new Set(running && Array.isArray(running.replyFiles) ? running.replyFiles : []);
  const files = Array.isArray(pending) ? pending : [];
  const step = running && (running.steps || []).find(s => s && s.key === 'ai');
  return {
    running: running ? { label: String((step && step.label) || running.label || ''), startedAt: running.startedAt || '', kind: running.kind || '', ref: running.ref || '' } : null,
    queued: files.filter(file => !activeFiles.has(file)).length
  };
}

const DAY = 86400000;
// 作業系統排程（MVP 規格第 2 節第 3 項）：登記標記 ledger/schedule.json；登記時嘅節奏同帳本而家嘅節奏唔同＝須重新登記
export const scheduleMark = DIR => readJSON(path.join(DIR.ledger, 'schedule.json'), null);
export const scheduleStale = (mark, r) => !!(mark && !mark.mode && r && (mark.runTime !== r.runTime || (mark.cadence || 'daily') !== (r.runCadence || 'daily')));
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);
const isDay = s => { const d = parseDay(s); return !!d && ymd(d) === String(s || ''); };
// 待決事項標題截短（F2-8 用到；以前未定義，開關打開時 /api/home、/api/asks 回 500）
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const snoozeDays = (s, now) => {
  if (!s || !isDay(s.until) || !s.startedAt) return 0;
  const start = parseDay(String(s.startedAt).slice(0, 10)), end = parseDay(s.until);
  if (!start || !end) return 0;
  return Math.max(0, daysBetween(start, new Date(Math.min(dayStart(now).getTime(), end.getTime()))));
};

// 創辦人操作覆蓋：伺服器只追加 founder-ops.json；畫面立即套用，外殼下一次開工才合併入 state.json。
// 外殼中斷留下的批次同樣要顯示，已寫入帳本的操作則不可重播。
const founderOpsBatchTime = file => Number((/\.founder-ops-\d+-(\d+)\.json$/.exec(file) || [])[1]) || 0;
const founderOpsFiles = DIR => {
  let batches = [];
  try {
    batches = fs.readdirSync(DIR.ledger).filter(file => /^\.founder-ops-\d+-\d+\.json$/.test(file))
      .sort((a, b) => founderOpsBatchTime(a) - founderOpsBatchTime(b) || a.localeCompare(b)).map(file => path.join(DIR.ledger, file));
  } catch { }
  return batches;
};
// 隊列原貌（未按 state 去重）。讀取次序固定：founder-ops.json 先、再列批次檔，呼叫者須在其後才讀 state.json。
// 外殼合併是「改名 → 套用 → 存檔 → 刪批次檔」，所以此次序下，剛排隊的操作不是仍在隊列檔／批次檔，就是已寫入稍後才讀的 state.founderOpsDone。
export const readFounderOpsQueue = DIR => {
  const seen = new Set(), list = [], take = file => {
    const ops = readJSON(file, []);
    if (!Array.isArray(ops)) return;
    for (const op of ops) {
      if (!op || typeof op !== 'object' || op.id && seen.has(op.id)) continue;
      list.push(op);
      if (op.id) seen.add(op.id);
    }
  };
  take(path.join(DIR.ledger, 'founder-ops.json'));
  for (const file of founderOpsFiles(DIR)) take(file);
  return list;
};
// 現時公司概覽係咪已確認：重新交資料會搬走確認檔；舊確認檔冇 pageId 當有效
export const overviewIsCurrent = (page, confirmed) => !page?.page?.id || !!(confirmed && (!confirmed.pageId || confirmed.pageId === page.page.id));
export const filterFounderOps = (queue, state) => {
  const done = new Set(Array.isArray(state && state.founderOpsDone) ? state.founderOpsDone : []);
  return queue.filter(op => !(op.id && done.has(op.id)));
};
export const pendingFounderOps = (DIR, state) => filterFounderOps(readFounderOpsQueue(DIR), state);
// 伺服器核對用：隊列先讀、state.json 最後讀，兩者互相一致
export const readFounderOpsSnapshot = DIR => {
  const queue = readFounderOpsQueue(DIR), state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  return { state, pending: filterFounderOps(queue, state) };
};
// 所有新欄可缺，舊資料沒有覆蓋檔時保持原有行為。
export function applyFounderOps(state, ops = []) {
  if (!Array.isArray(ops) || !ops.length) return state || {};
  let out = { ...(state || {}), founderSnoozes: { ...((state && state.founderSnoozes) || {}) }, founderSnoozeDays: { ...((state && state.founderSnoozeDays) || {}) }, targetOverride: { ...((state && state.targetOverride) || {}) }, targetOverrideBase: { ...((state && state.targetOverrideBase) || {}) }, targetOverrideAt: { ...((state && state.targetOverrideAt) || {}) }, goals: { ...((state && state.goals) || {}) } };
  if (out.goals.quarter && typeof out.goals.quarter === 'object') out.goals.quarter = { ...out.goals.quarter, ...(out.goals.quarter.target ? { target: { ...out.goals.quarter.target } } : {}) };
  if (state && state.company) out.company = { ...state.company };
  if (state && state.interviews) out.interviews = { ...state.interviews };
  if (Array.isArray(state && state.milestones)) out.milestones = state.milestones.map(m => ({ ...m }));
  if (Array.isArray(state && state.tasks)) out.tasks = state.tasks.map(t => ({ ...t }));
  for (const item of ops) {
    if (!item || typeof item !== 'object') continue;
    const value = item.value && typeof item.value === 'object' ? item.value : {};
    const current = out.company && out.company.nextExternalAction && typeof out.company.nextExternalAction === 'object' ? out.company.nextExternalAction : null;
    if (item.op === 'reschedule' && current && isDay(value.date)) out.company.nextExternalAction = { ...current, date: value.date, pendingUpdate: false, founderUpdatedAt: item.at || localIso() };
    else if (item.op === 'cancelNext' && current) out.company.nextExternalAction = { ...current, cancelledAt: item.at || localIso(), founderUpdatedAt: item.at || localIso() };
    else if (item.op === 'setNext' && typeof value.text === 'string' && value.text.trim()) {
      out.company = out.company || {}, out.company.nextExternalAction = { text: value.text.trim().slice(0, 200), milestoneId: typeof value.milestoneId === 'string' ? value.milestoneId : '', ...(isDay(value.date) ? { date: value.date } : {}), founderUpdatedAt: item.at || localIso() };
    } else if (item.op === 'snooze' && typeof item.target === 'string' && isDay(value.until)) {
      out.founderSnoozes[item.target] = { until: value.until, startedAt: item.at || localIso() };
    } else if (item.op === 'unsnooze' && typeof item.target === 'string') {
      const prior = out.founderSnoozes[item.target];
      if (prior) out.founderSnoozeDays[item.target] = Number(out.founderSnoozeDays[item.target] || 0) + snoozeDays(prior, new Date(item.at || Date.now()));
      delete out.founderSnoozes[item.target];
    } else if (item.op === 'setRhythm' && ['daily', 'weekdays', 'weekly'].includes(value.runCadence) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.runTime || '')) && Number.isInteger(value.interviewWeekday) && value.interviewWeekday >= 1 && value.interviewWeekday <= 7) {
      const before = (out.company && out.company.rhythm) || {};
      const changedDay = Number(before.interviewWeekday) !== value.interviewWeekday;
      out.company = out.company || {};
      out.company.rhythm = { ...before, runCadence: value.runCadence, runTime: value.runTime, interviewWeekday: value.interviewWeekday, updatedAt: item.at, from: 'system' };
      if (changedDay) {
        const day = /^\d{4}-\d{2}-\d{2}/.test(String(item.at || '')) ? String(item.at).slice(0, 10) : ymd(new Date());
        out.interviews = { ...(out.interviews || {}), nextOn: nextWeekday(day, value.interviewWeekday) };
      }
    } else if (item.op === 'setTarget' && typeof item.target === 'string' && isDay(value.date)) {
      const milestone = (out.milestones || []).find(m => m && m.id === item.target);
      // 同一個操作重播時，基準只可以記第一次見到嘅公司概覽日期。
      if (!Object.prototype.hasOwnProperty.call(out.targetOverride, item.target)) {
        if (milestone && milestone.targetDate !== undefined) out.targetOverrideBase[item.target] = isDay(milestone.targetDate) ? milestone.targetDate : '';
        else delete out.targetOverrideBase[item.target];
      }
      out.targetOverride[item.target] = value.date;
      out.targetOverrideAt[item.target] = item.at || localIso();
      if (milestone) { milestone.targetDate = value.date; delete milestone.targetDateTentative; }
    } else if (item.op === 'setTaskDue' && typeof item.target === 'string' && isDay(value.date)) {
      const task = (out.tasks || []).find(t => t && t.id === item.target);
      if (task) {
        const time = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(String(task.dueAt || ''));
        task.dueAt = value.date + (time ? time[0] : '');
      }
    } else if (item.op === 'setGoalNumber' && ['income', 'net', 'payers'].includes(value.metric)) {
      const at = /^\d{4}-\d{2}-\d{2}/.test(String(item.at || '')) ? String(item.at).slice(0, 10) : '';
      if (!at) continue;
      const prior = out.goals && out.goals.quarter && out.goals.quarter.target;
      const metric = value.metric;
      const amountText = typeof value.amount === 'string' ? value.amount : '';
      const amountCents = Number.isSafeInteger(value.amountCents) ? value.amountCents
        : /^\d+$/.test(amountText) ? Number(amountText)
          : /^\d+\.\d{1,2}$/.test(amountText) ? Number(amountText.split('.')[0]) * 100 + Number((amountText.split('.')[1] + '00').slice(0, 2)) : null;
      const count = Number(value.count);
      const valid = metric === 'payers' ? Number.isSafeInteger(count) && count > 0 : Number.isSafeInteger(amountCents) && amountCents > 0;
      if (!valid) continue;
      const quarter = out.goals.quarter && typeof out.goals.quarter === 'object' ? out.goals.quarter : {};
      const target = {
        metric,
        ...(metric === 'payers' ? { count } : { amountCents, currency: typeof value.currency === 'string' ? value.currency : (prior && prior.currency) || '' }),
        from: prior && prior.metric === metric && isDay(prior.from) ? prior.from : at,
        setAt: item.at || '', by: 'founder'
      };
      out.goals = { ...out.goals, quarter: { ...quarter, target } };
    } else if (PACE_OPS.includes(item.op)) {
      // 節奏及暫停 Zero：交 pace-lib.applyPaceOps（只傳它會讀寫的欄），預覽與外殼套用同一套邏輯
      out = paceOverlay(out, item);
    } else if (item.op === 'rolePause' && typeof item.target === 'string') {
      out = roleOverlay(out, pauseCard, { teammateId: item.target, reason: typeof value.reason === 'string' ? value.reason : '', now: item.at || localIso() });
    } else if (item.op === 'roleResume' && typeof item.target === 'string') {
      out = roleOverlay(out, resumeCard, { teammateId: item.target, now: item.at || localIso() });
    } else if (item.op === 'rolesSync') {
      // 請 Zero 重新擬崗位：只記「已要求」，外殼下一次先做（roles-ops rolesDue）
      out.rolesSync = { ...(out.rolesSync || {}), requested: true, requestedAt: item.at || localIso() };
    } else if (item.op === 'peopleSync') {
      // 請 Zero 整理名單：只記「已要求」，外殼下一次先做（people-ops peopleSyncDue）
      out.peopleSync = { ...(out.peopleSync || {}), requested: true, requestedAt: item.at || localIso() };
    } else if (ACTOR_OPS.includes(item.op) && typeof item.target === 'string') {
      // 名單改正（改名、類別、合併、不再接觸、成員狀態、工作負責人）：純函數在 people-ops.mjs；失敗（找不到、重名、已合併）時原樣不動
      const r = applyActorOp({ company: out.company || {}, tasks: out.tasks || [] }, item.op, { ...value, id: item.target, from: item.target, at: item.at || '' });
      if (r.ok) { out.company = r.state.company; out.tasks = r.state.tasks; }
    } else if (['termAdd', 'termRename', 'termRemove'].includes(item.op) && typeof item.target === 'string') {
      // 常用名稱表同樣只疊加純函數結果；重播相同操作不會新增第二筆名稱。
      const at = /^\d{4}-\d{2}-\d{2}/.test(String(item.at || '')) ? String(item.at).slice(0, 10) : localIso().slice(0, 10);
      const r = applyTermOp({ company: out.company || {}, termSync: out.termSync || {} }, item.op, { ...value, id: item.target }, { today: at, opId: item.id || '' });
      if (r.ok) { out.company = r.state.company; out.termSync = r.state.termSync; }
    }
  }
  return out;
}

function moneyWithResolvedActors(saved, actors) {
  const list = Array.isArray(actors) ? actors : [];
  const resolvedId = id => resolveActorId(list, id) || id;
  return {
    ...saved,
    records: saved.records.map(record => record?.counterpartId ? { ...record, counterpartId: resolvedId(record.counterpartId) } : record),
    links: Object.fromEntries(Object.entries(saved.links || {}).map(([key, id]) => [key, resolvedId(id)]))
  };
}

// 業績頁與頁頂共用同一個只讀投影；金額與指標一律交由 money-lib 計算。
export function moneyView(DIR, { today, full = false } = {}) {
  const at = isDay(today) ? today : ymd(clockNow());
  const saved = readMoney(DIR);
  const state0 = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  const state = state0.demo === true ? state0 : applyFounderOps(state0, pendingFounderOps(DIR, state0));
  const money = moneyWithResolvedActors(saved, state.company?.actors);
  const period = samePeriodMetrics(money.records, at, money.mainCurrency, money.links);
  const page = readJSON(path.join(DIR.company, 'page.json'), null);
  const confirmed = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const values = page ? registryValues(page, confirmed) : {};
  const goalRow = page && page.glance && (page.glance.rows || []).find(row => row.plan === 'G1');
  const pageEnds = goalRow && goalRow.due ? String(values[goalRow.due.id] ?? goalRow.due.value ?? '') : '';
  const quarter = state.goals && state.goals.quarter || {};
  const target = quarter.target && typeof quarter.target === 'object' ? quarter.target : null;
  const goal = target && isDay(quarter.endsOn || pageEnds) ? goalProgress(target, money.records, quarter.endsOn || pageEnds, money.mainCurrency, money.links) : null;
  const live = liveRecords(money.records);
  let waiting = 0, packs = [];
  try { packs = listPacks(DIR); } catch { }
  for (const item of packs) {
    const pack = loadPack(DIR, item.id), answers = loadAnswers(DIR, item.id).answers || {};
    if (pack && Array.isArray(pack.questions)) waiting += pack.questions.filter(question => question && question.kind === 'money' && !answers[question.id]).length;
  }
  const base = {
    has: live.length > 0,
    mainCurrency: money.mainCurrency,
    today: at,
    month: period.month,
    cur: period.cur,
    prev: period.prev,
    cutoff: period.cutoff,
    cmp: {
      income: compareMonths(period.cur.income, period.prev.income),
      net: compareMonths(period.cur.net, period.prev.net),
      payers: compareMonths(period.cur.payers, period.prev.payers)
    },
    runway: cashRunway(money.balance, money.records, at, money.mainCurrency),
    goal,
    waiting,
    noEvidence: live.filter(record => !hasEvidence(record)).length
  };
  if (!full) return base;
  const categoryTotals = new Map();
  for (const record of live) {
    if (record.currency !== money.mainCurrency || record.dir !== 'out' || String(record.date || '').slice(0, 7) !== period.month) continue;
    categoryTotals.set(record.category, (categoryTotals.get(record.category) || 0) + (record.refund ? -record.amountCents : record.amountCents));
  }
  const currentCanvas = readCanvas(DIR).view;
  const valueOfPlan = key => String(currentCanvas?.cells?.[key]?.text || '');
  return {
    ...base,
    records: money.records,
    trend: moneyTrend(money.records, period.month, 6, money.mainCurrency, money.links),
    top: topUnlistedPayers(money.records, money.mainCurrency, money.links),
    categories: [...categoryTotals.entries()].map(([category, totalCents]) => ({ category, totalCents })).sort((left, right) => right.totalCents - left.totalCents || left.category.localeCompare(right.category)),
    batches: listImportBatches(DIR).batches.map(batch => {
      const total = Array.isArray(batch.rows) ? batch.rows.filter(row => row?.include === true && ['ok', 'dup'].includes(row.status)).length : 0;
      return { id: batch.id, state: batch.state, file: batch.file?.name ? { name: path.basename(batch.file.name) } : null, summary: { ...(batch.summary || {}), total }, confirmedAt: batch.confirmedAt || '', createdAt: batch.createdAt || '' };
    }),
    plan: { income: valueOfPlan('revenue'), expense: valueOfPlan('cost') }
  };
}

function termsView(state) {
  const terms = Array.isArray(state?.company?.terms) ? state.company.terms : [];
  const dayText = value => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return m ? Number(m[2]) + ' 月 ' + Number(m[3]) + ' 日' : '';
  };
  return terms.slice().sort((a, b) => String(b?.addedAt || '').localeCompare(String(a?.addedAt || ''))).map(term => {
    const kind = ['product', 'campaign', 'other'].includes(term?.kind) ? term.kind : 'other';
    const from = ['event', 'doc', 'chat', 'manual'].includes(term?.addedFrom) ? term.addedFrom : 'manual';
    const addedAt = typeof term?.addedAt === 'string' ? term.addedAt : '';
    const addedAtText = dayText(addedAt);
    return { id: String(term?.id || ''), name: String(term?.name || ''), kind, kindText: N_('term_kind_' + kind), aliases: Array.isArray(term?.aliases) ? term.aliases.filter(alias => typeof alias === 'string' && alias) : [], addedAt, addedAtText, from, fromText: N_('term_from_' + from, { d: addedAtText }) };
  }).filter(term => term.id && term.name);
}

// 預覽覆蓋用的兩個包裝：只把純函數會讀寫的欄傳入，結果寫回；純函數認為無效（找不到卡、已是該狀態）時原樣回傳
function paceOverlay(out, item) {
  const slice = { company: out.company || {}, health: out.health || {}, milestones: out.milestones || [], tasks: out.tasks || [] };
  const today = String(item.at || localIso()).slice(0, 10);
  const next = applyPaceOps(slice, [{ ...item, value: item.value && typeof item.value === 'object' ? item.value : {} }], { today });
  return next === slice ? out : { ...out, company: next.company, health: next.health };
}
function roleOverlay(out, fn, args) {
  const slice = { teammates: out.teammates || [], tasks: out.tasks || [] };
  const next = fn(slice, args);
  return next === slice ? out : { ...out, teammates: next.teammates, tasks: next.tasks };
}
// Zero 整理名單的狀態（團隊頁及推進板入口用）：none（未確認概覽／示範）、requested（已要求，Zero 下一次先做）、asked（已擬好題，packId 指向待決事項）、done（此版概覽已整理）、idle（可以要求）
export function peopleSyncView(DIR, state) {
  const s = state || {}, ps = s.peopleSync || {}, key = peopleSyncKey(s);
  if (!key || s.demo === true) return { state: 'none' };
  const open = ps.packId && (listPacks(DIR).find(p => p.id === ps.packId && p.open) || null);
  if (open) return { state: 'asked', packId: open.id, count: open.open };
  if (ps.requested) return { state: 'requested' };
  if (Array.isArray(ps.pending) && ps.pending.length) return { state: 'requested', pending: ps.pending.length };
  const failed = ps.lastTry && ps.lastTry.key === key && ps.lastTry.reason ? { failed: ps.lastTry.reason } : {};
  if (ps.for === key) return { state: 'done', at: ps.at || '', ...failed };
  return { state: 'idle', ...failed };
}

// Zero 重新擬崗位的狀態（團隊頁入口用，照 peopleSyncView）：none（未確認概覽／示範）、requested（已要求，Zero 下次先做）、asked（已擬好題，packId 指向待決事項）、done（此版概覽已擬過）、idle（可以要求）
export function rolesSyncView(DIR, state) {
  const s = state || {}, rs = s.rolesSync || {}, key = rolesKey(s);
  if (!key || s.demo === true) return { state: 'none' };
  const open = rs.packId && (listPacks(DIR).find(p => p.id === rs.packId && p.open) || null);
  if (open) return { state: 'asked', packId: open.id, count: open.open };
  if (rs.requested) return { state: 'requested' };
  if (Array.isArray(rs.pending) && rs.pending.length) return { state: 'requested', pending: rs.pending.length };
  const failed = rs.lastTry && rs.lastTry.key === key && rs.lastTry.reason ? { failed: rs.lastTry.reason } : {};
  if (rs.for === key) return { state: 'done', at: rs.at || '', ...failed };
  return { state: 'idle', ...failed };
}

/* ---------- 0.41.0 Zero 團隊分工：看板畫面資料（全部是純函數，頁面只畫、不推斷） ---------- */
// 崗位色環：對應頭像胸章（avatars/README.md 色板欄）；統籌用琥珀
export const ROLE_COLORS = { lead: '#e88d4f', outreach: '#e0474c', content: '#3a9a4a', partner: '#cf2fb8', procurement: '#5a5ee6', compliance: '#5b6577', marketing: '#14958f', finance: '#8c5a34', operations: '#8f8f1f' };
export const roleAvatar = kind => '/assets/crew-role-' + kind + '.webp';
// 舊資料沒有 avatarKind：由稱號（沒有 title 就用舊 name）即時推算，推不出用 operations
export const avatarKindFor = card => AVATAR_KINDS.includes(card && card.avatarKind) ? card.avatarKind : avatarKindOf(titleOf(card));
export const lifecycleOf = card => LIFECYCLES.includes(card && card.lifecycle) ? card.lifecycle : 'planned';
const N_ = (key, v) => NAMES.t(key, v);
const stripAuto = r => String(r || '').replace(/^等候：/, '');
// 知識背景的出處：confirmedPage＝已確認的公司概覽；https 網址＝網站名；其他＝創辦人交過的文件（找不到標題就用泛稱）
export function sourceView(src, state) {
  const v = String(src || '');
  if (v === 'confirmedPage') return { label: N_('tm_srcPage'), href: '' };
  if (/^https:\/\//i.test(v)) { let host = ''; try { host = new URL(v).hostname.replace(/^www\./, ''); } catch { } return { label: host || N_('tm_srcWeb'), href: host ? v : '' }; }
  const inp = ((state || {}).inputs || []).find(i => i && i.id === v);
  return { label: inp && inp.title ? inp.title : N_('tm_srcInput'), href: '' };
}
// 必須先問你：卡內自己加的條目優先（寫入時已併入公司預設，全列會太長）；沒有自己加的才列全部
export function askFirstView(card, state) {
  const mine = ((card.bounds || {}).askFirst || []).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  const base = new Set((permissionsOf(state).askFirst || []).map(x => String(x).trim()));
  const extra = mine.filter(x => !base.has(x));
  return (extra.length ? extra : mine).slice(0, 4);
}
// 團隊頁資料。ctx：{ today, msTitle(id), tasks（畫面工作列，需含 teammateId、column、packId、title、owner）, working（工作中的工作編號集合）, counts（countStarts 結果或 null）, actors }
export function teamView(state, ctx = {}) {
  const s = state || {}, today = ctx.today || '', tasks = ctx.tasks || [], working = ctx.working || new Set(), msTitle = ctx.msTitle || (id => id);
  const actors = ctx.actors || ((s.company || {}).actors) || [];
  const cardTitle = id => { const c = cardById(s, resolveCardId(s, id) || id); return c ? titleOf(c) : ''; };
  const aiTasks = id => tasks.filter(x => x.owner !== 'founder' && (x.teammateId || '') === id);
  const activityOf = (id, lc) => lc === 'planned' ? 'not_started' : lc === 'paused' ? 'waiting' : aiTasks(id).some(x => working.has(x.id)) ? 'working' : aiTasks(id).some(x => x.column === 'doing') ? 'doing' : aiTasks(id).some(x => x.column === 'waiting' || x.column === 'review') ? 'waiting' : 'idle';
  const roles = liveCards(s).map(t => {
    const lc = lifecycleOf(t), kind = avatarKindFor(t), autoToday = lc !== 'paused' && t.pausedAuto === true && (!today || t.pausedOn === today);
    const actTask = t.activationTaskId ? tasks.find(x => x.id === t.activationTaskId) : null;
    const activated = t.activation && typeof t.activation === 'object' ? t.activation : null;
    const actDone = activated && activated.taskId ? (s.tasks || []).find(x => x && x.id === activated.taskId) : null;
    return {
      id: t.id, title: titleOf(t), hasTitle: !!t.title, avatarKind: kind, avatar: roleAvatar(kind), color: ROLE_COLORS[kind] || ROLE_COLORS.operations,
      lifecycle: lc, lifecycleText: N_('role_lifecycle_' + lc), state: lc === 'paused' || autoToday ? 'paused' : lc, pausedAutoToday: autoToday,
      pausedNote: lc === 'paused' ? (t.pausedReason ? N_('tm_pausedWhy', { r: t.pausedReason }) : '') : autoToday ? N_('role_pausedAuto', { w: stripAuto(t.pausedReason) || N_('tm_pausedWaitDefault') }) : '',
      activity: activityOf(t.id, lc), mission: t.mission || '', strategy: t.strategy || '', how: (t.how || []).slice(0, 3),
      stations: (t.milestoneIds || []).map(msTitle).filter(Boolean), supports: supportsLines(t, actors).map(l => l.paused ? N_('role_supportsPaused', { n: l.name }) : l.role ? N_('role_supports', { n: l.name, r: l.role }) : N_('tm_supportsNoRole', { n: l.name })),
      askFirst: askFirstView(t, s), knowledge: (t.knowledge || []).slice(0, 6).filter(k => k && k.text).map(k => ({ text: k.text, ...sourceView(k.source, s) })),
      activation: lc === 'planned' ? (actTask ? { taskId: actTask.id, title: actTask.title, column: actTask.column, packId: actTask.column === 'review' && actTask.packId ? actTask.packId : '' } : { none: true }) : null,
      activatedAt: lc !== 'planned' && activated ? String(activated.acceptedAt || '').slice(0, 10) : '', activatedTask: actDone ? actDone.title : '',
      canPause: lc === 'planned' || lc === 'enabled', canResume: lc === 'paused', returns: t.activationReturns || 0
    };
  });
  const history = (s.teammates || []).filter(t => t && (t.lifecycle === 'merged' || t.lifecycle === 'retired')).map(t => ({
    id: t.id, title: titleOf(t), lifecycle: t.lifecycle, lifecycleText: N_('role_lifecycle_' + t.lifecycle),
    note: t.lifecycle === 'merged' ? (cardTitle(t.mergedInto) ? N_('tm_mergedInto', { t: cardTitle(t.mergedInto) }) : '') : t.retiredReason || ''
  }));
  const leadTasks = aiTasks('');
  return {
    lead: { title: N_('role_coordinator'), desc: N_('role_coordinatorDesc'), avatar: roleAvatar(AVATAR_LEAD), color: ROLE_COLORS.lead, activity: leadTasks.some(x => working.has(x.id)) ? 'working' : 'idle', proofreadToday: ctx.counts ? proofreadStarts(ctx.counts) : 0, lifecycleText: N_('role_lifecycle_enabled') },
    roles, history, over: overCap(s), overText: overCap(s) ? N_('role_overCap') : ''
  };
}

/* ---------- 節奏三檔、用量、衝刺提示（系統頁 R5） ----------
   ctx：{ today, counts（countStarts 結果；沒有紀錄檔時 null）, tele（teleOf：starts、minutes、usd）, unread（未看產出數） } */
export function paceView(state, ctx = {}) {
  const s = state || {}, r = (s.company || {}).rhythm || {}, key = paceKey(s), today = ctx.today || '', tele = ctx.tele || {};
  const used = ctx.counts ? ctx.counts.total : (tele.starts || 0), fuse = fuseOf(s), proofread = ctx.counts ? proofreadStarts(ctx.counts) : 0;
  const unread = ctx.unread || 0;
  const pause = key === 'sprint' && r.sprintPause && r.sprintPause.reason ? { reason: r.sprintPause.reason, since: r.sprintPause.since || '', text: r.sprintPause.reason === 'backlog' ? N_('pace_sprintPausedBacklog', { n: unread }) : N_('pace_sprintPausedNoReply') } : null;
  const h = s.health || {};
  return {
    current: key,
    options: PACE_KEYS.map(k => ({ key: k, text: NAMES.ui['pace_' + k] || k, estimate: N_('pace_estimate', { a: PACE_ESTIMATE[k].typical, b: PACE_ESTIMATE[k].worst }), fuse: PACES[k].fuse, fuseText: N_('pace_fuseOf', { n: PACES[k].fuse }), itemsPerDay: PACES[k].itemsPerDay, current: k === key })),
    sprint: { until: key === 'sprint' && isDay(r.sprintUntil) ? r.sprintUntil : '', defaultUntil: today ? sprintDefaultUntil(s, today) : '', min: isDay(today) ? addDays(today, 1) : '', max: isDay(today) ? addDays(today, SPRINT_MAX_DAYS) : '',
      startedOn: key === 'sprint' ? r.sprintStartedOn || '' : '', endedOn: key !== 'sprint' && isDay(r.sprintEndedOn) ? r.sprintEndedOn : '', endedText: key !== 'sprint' && isDay(r.sprintEndedOn) ? N_('pace_sprintEnded', { d: r.sprintEndedOn }) : '', pause },
    usage: { used, fuse, proofread, line: N_('pace_usage', { a: used, b: fuse, n: proofread }), pct: fuse ? Math.min(100, Math.round(used / fuse * 1000) / 10) : 0, minutes: tele.minutes || 0, usd: tele.usd == null ? null : tele.usd, fuses: PACE_KEYS.map(k => ({ key: k, fuse: PACES[k].fuse })) },
    zero: { paused: !!h.pausedByFounder, autoStopped: !!h.autoStopped, pausedAt: h.pausedByFounderAt || '' },
    unread
  };
}

/* ---------- 回饋卡（R4／R6）及今日交付一覽（R7） ---------- */
// 〈崗位〉交付 · 統籌已校對／已核對／仍有 N 處要留意（只有 flagged；pass_with_notes 同 pass，Z29）。qa 缺（舊資料）＝已核對；teammateId 缺＝統籌
export function qaLine(roleTitle, qa) {
  const t = roleTitle || N_('role_coordinator'), q = qa && typeof qa === 'object' ? qa : {};
  const issues = (Array.isArray(q.issues) ? q.issues : []).slice(0, 5).map(i => ({ where: String((i && i.where) || ''), what: String((i && i.what) || ''), fix: String((i && i.fix) || '') }));
  const verdict = ['pass', 'pass_with_notes', 'flagged', 'pending'].includes(q.verdict) ? q.verdict : 'none';
  const n = Math.max(1, issues.length);
  const out = { verdict, audience: q.audience === 'external' ? 'external' : 'internal', line: String(q.line || ''), rounds: Number(q.rounds) || 0, issues };
  if (verdict === 'pass' || verdict === 'pass_with_notes') return { ...out, tone: 'ok', tag: 'proofread', text: N_('qa_delivered', { t }) };
  if (verdict === 'flagged') return { ...out, tone: 'wait', tag: 'notes', n, text: N_('qa_flagged', { t, n }) };
  if (verdict === 'pending') return { ...out, tone: 'wait', tag: 'pending', text: N_('qa_pendingLine', { t }) };
  return { ...out, tone: 'plain', tag: 'checked', text: N_('qa_checked', { t }) };
}
// ctx：{ today, tasks（帳本原始 tasks）, msTitle(id), readReceipt(runId)→收據或 null, todo（畫面待決清單）, pace（paceView）, openTodo（要你決定的題數）, counts }
export function deliveriesView(state, ctx = {}) {
  const s = state || {}, today = ctx.today || '', raw = s.tasks || [], taskBy = id => raw.find(t => t && t.id === id) || null;
  const msTitle = ctx.msTitle || (() => ''), readReceipt = ctx.readReceipt || (() => null), todo = ctx.todo || [];
  const roleOf = id => { const c = id ? cardById(s, resolveCardId(s, id) || id) : null; return c ? { id: c.id, title: titleOf(c), kind: avatarKindFor(c) } : { id: '', title: '', kind: AVATAR_LEAD }; };
  const openPack = id => !!id && todo.some(x => x.id === id);
  const mk = (run, item, rc) => {
    const task = taskBy(item.taskId), role = roleOf(item.teammateId != null ? item.teammateId : task && task.teammateId);
    const art = rc && Array.isArray(rc.artifacts) && rc.artifacts[0] ? rc.artifacts[0].title : '';
    const milestoneId = task ? task.milestoneId || '' : '';
    const packId = task && task.packId ? task.packId : '';
    return { key: run.id + ':' + (item.taskId || ''), runId: run.id, taskId: item.taskId || '', at: item.endedAt || run.endedAt || run.startedAt || '', ending: item.ending || 'artifact',
      title: (task && task.artifactTitle) || art || (task && task.title) || run.label || '', roleId: role.id, roleTitle: role.title || N_('role_coordinator'), avatar: roleAvatar(role.kind), color: ROLE_COLORS[role.kind] || ROLE_COLORS.operations,
      station: msTitle(milestoneId), standing: !milestoneId || (task && task.cadence === 'standing'), packId: openPack(packId) ? packId : '', qa: qaLine(role.title, item.qa) };
  };
  const runs = (Array.isArray(s.runs) ? s.runs : []).filter(r => r && r.id).slice().sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const dayOf = r => String(r.workDay || r.startedAt || '').slice(0, 10);
  let receipts = 0;
  const entries = [];
  for (const run of runs) {
    if (Array.isArray(run.items) && run.items.length) { for (const it of run.items) if (it) entries.push({ run, d: mk(run, it, null), multi: true }); }
    else if (run.state === 'ended' && run.aiStarted !== false && (run.ending === 'artifact' || run.artifacts > 0) && receipts++ < 12) {
      const rc = readReceipt(run.id) || {};
      entries.push({ run, d: mk(run, { taskId: (run.taskIds || [])[0] || rc.taskId || '', teammateId: rc.teammateId != null ? rc.teammateId : run.teammateId, qa: rc.qa || run.qa, ending: 'artifact' }, rc), multi: false });
    }
  }
  const delivered = entries.filter(e => e.d.ending === 'artifact');
  const todayEntries = entries.filter(e => dayOf(e.run) === today);
  const accFirst = (a, b) => (b.packId ? 1 : 0) - (a.packId ? 1 : 0);   // 等你驗收的排前（R7 按優先排列）；同級保持交付先後
  const todayDone = todayEntries.filter(e => e.d.ending === 'artifact').map(e => e.d).sort((a, b) => String(a.at).localeCompare(String(b.at))).sort(accFirst);
  const multi = todayEntries.some(e => e.multi) && todayEntries.length >= 2;
  const todayRuns = runs.filter(r => dayOf(r) === today && Array.isArray(r.items));
  const stopRun = todayRuns.find(r => r.stopReason) || null, pace = ctx.pace || null, key = pace ? pace.current : paceKey(s);
  // 上限跟那一次工作的節奏（run.pace），不跟現在的節奏；舊紀錄沒有 pace 才退回目前節奏
  const runPace = stopRun && PACES[stopRun.pace] ? PACES[stopRun.pace].itemsPerDay : null, capNow = runPace != null ? runPace : itemsCapOf(s);
  const stopN = { itemsCap: runPace != null && stopRun.stopReason === 'itemsCap' && Array.isArray(stopRun.items) && stopRun.items.length ? stopRun.items.length : capNow, waitingFounder: ctx.openTodo || 0, backlog: (pace && pace.unread) || 0 };
  const stopKey = stopRun ? 'stop_' + stopRun.stopReason : '';
  const stopText = stopRun && NAMES.ui[stopKey] ? N_(stopKey, { n: stopN[stopRun.stopReason] || 0 }) : '';
  const decisions = todo.filter(x => x.type === 'acceptance').map(x => { const d = todayDone.concat(delivered.map(e => e.d)).find(z => z.packId === x.id); return { id: x.id, text: x.text, href: x.href, line: d ? d.qa.text : '' }; });
  const paused = pausedCardsToday(s, today).filter(t => t.pausedAuto === true).map(t => ({ id: t.id, title: titleOf(t), reason: stripAuto(t.pausedReason) }));
  const notDone = todayEntries.filter(e => e.d.ending !== 'artifact').map(e => e.d);
  return {
    recent: delivered.filter(e => !(multi && dayOf(e.run) === today)).slice(0, 6).map(e => e.d),
    today: { day: today, multi, items: todayDone, count: todayEntries.length, cap: capNow, pace: key, sprintUntil: key === 'sprint' && pace ? pace.sprint.until : '', usageLine: pace ? pace.usage.line : '', stopReason: stopRun ? stopRun.stopReason : '', stopText, decisions, pausedRoles: paused, notDoneCount: notDone.length }
  };
}

// 月曆只帶每日歸納，不能把完整帳本 runs 送到畫面。未完成比完成重，完成比跳過重。
export function calendarRunDays(runs, from, to, today = null) {
  const currentDay = today instanceof Date ? today : parseDay(today);
  const byDay = {}, todayKey = currentDay ? ymd(currentDay) : '', rank = { skipped: 1, completed: 2, running: 3, unfinished: 4 };
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run !== 'object') continue;
    const scheduledSlot = String(run.slot || '').slice(0, 10);
    const source = run.trigger === 'schedule' && isDay(scheduledSlot) ? scheduledSlot : String(run.startedAt || '').slice(0, 10);
    const day = parseDay(source);
    if (!day || day < from || day > to) continue;
    const state = run.state === 'skipped' ? 'skipped'
      : run.state === 'running' ? (ymd(day) === todayKey ? 'running' : 'unfinished')
        : run.rejected || run.state === 'failed' || run.state === 'interrupted' || (run.state === 'ended' && run.ending === 'blocked') ? 'unfinished'
        : run.state === 'ended' || run.state === 'done' || run.state === 'completed' ? 'completed' : null;
    if (!state) continue;
    const reason = state === 'skipped' ? NAMES.ui['skip_' + run.skipReason] || run.summary || NAMES.ui.runSkipped
      : run.rejectReason || run.summary || (state === 'running' ? NAMES.ui.runWorking : state === 'unfinished' ? NAMES.ui.runUnfinished || '未完成' : '');
    const key = ymd(day), candidate = { state, reason: String(reason || ''), runId: String(run.id || '') };
    if (!byDay[key] || rank[candidate.state] > rank[byDay[key].state]) byDay[key] = candidate;
  }
  return byDay;
}
const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/* ---------- 示範帳本：相對時間 ---------- */
function resolveToken(s, now) {
  let m = /^@(sun|mon|tue|wed|thu|fri|sat)(?:([+-]\d+))?$/.exec(s);
  if (m) {
    const d = dayStart(now); d.setDate(d.getDate() + ((WEEKDAY[m[1]] - d.getDay() + 7) % 7) + Number(m[2] || 0));
    return ymd(d);
  }
  m = /^@([+-]\d+)([dhm])(?: (\d{2}):(\d{2}))?$/.exec(s);
  if (!m) return s;
  const n = Number(m[1]);
  if (m[2] === 'd' && !m[3]) { const d = dayStart(now); d.setDate(d.getDate() + n); return ymd(d); }
  const d = new Date(now.getTime());
  if (m[2] === 'd') { d.setDate(d.getDate() + n); d.setHours(Number(m[3]), Number(m[4]), 0, 0); }
  // 對齊到分鐘：同一分鐘內讀幾多次都一樣，監察台唔會因為秒數變而每次重畫
  else { d.setTime(d.getTime() + n * (m[2] === 'h' ? 3600000 : 60000)); d.setSeconds(0, 0); }
  return localIso(d);
}
export function resolveTimes(o, now) {
  if (typeof o === 'string') return o.startsWith('@') ? resolveToken(o, now) : o;
  if (Array.isArray(o)) return o.map(x => resolveTimes(x, now));
  if (o && typeof o === 'object') { const r = {}; for (const k in o) r[k] = resolveTimes(o[k], now); return r; }
  return o;
}

/* ---------- 公司概覽 → 里程碑（未有帳本時用） ---------- */
function registryValues(page, confirmed) {
  const v = {};
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && 'value' in o && 'label' in o) v[o.id] = o.value;
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
  })(page);
  return confirmed && confirmed.values ? { ...v, ...confirmed.values } : v;
}
// 外殼喺成頁確認時亦用呢個函數為帳本種子（run.mjs syncLedger），欄位對應只寫一次
// extra.founder：{ 站 id: [你嘅深化答案 × 5] }（外殼同步時帶入，重算深度）
export function milestonesFromPage(page, confirmed, extra = {}) {
  if (!page || !page.path || !Array.isArray(page.path.milestones)) return [];
  const v = registryValues(page, confirmed);
  const val = f => (f && f.id ? String(v[f.id] ?? f.value ?? '') : '');
  const order = confirmed && Array.isArray(confirmed.order) ? confirmed.order : page.path.milestones.map(m => m.id);
  const byId = Object.fromEntries(page.path.milestones.map(m => [m.id, m]));
  const list = order.filter(id => byId[id]).concat(page.path.milestones.map(m => m.id).filter(id => !order.includes(id)));
  return list.map((id, i) => {
    const m = byId[id];
    const target = val(m.target);
    const ft = (extra.founder || {})[id] || [];
    const dp = depthOf([0, 1, 2, 3, 4].map(k => { const d = (m.depth || [])[k], f = ft[k] && typeof ft[k] === 'object' ? ft[k] : { text: ft[k] || '' }; return { text: val(d), origin: d ? d.origin : 'missing', founderText: f.text || '', adopted: !!f.adopted }; }));
    return {
      id, title: m.short, short: m.short, lineId: 'main', order: i + 1,
      pathStatus: confirmed ? 'confirmed' : 'proposed', state: 'not_started',
      event: val(m.event), actorName: val(m.actor), witness: val(m.witness), evidence: val(m.proof), deliveryCondition: val(m.deliver),
      ownerName: val(m.owner), targetDate: /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : '', targetText: /^\d{4}-\d{2}-\d{2}$/.test(target) ? '' : target,
      depth: dp.depth, depthAnswers: dp.answers, depthRefs: (m.depth || []).map(d => d && d.id || ''),
      beyondGoal: !!m.beyondGoal, kind: m.kind === 'task' ? 'task' : m.kind === 'real' ? 'real' : '', fourCells: [m.event, m.actor, m.witness, m.proof].map(f => !!val(f).trim()), watchItems: []
    };
  });
}
// 深度檢查（規劃書 3.3，唯一計算處）：五條「為甚麼」都有答案、而且只靠假設（AI 推斷、未有文件或你的答案作來源）的不多於三條＝已深化；
// 否則待深化。你答過嘅（founderText）同文件寫明嘅算有來源；冇五條就當未答齊。
export function depthOf(items) {
  const answers = [0, 1, 2, 3, 4].map(k => {
    const it = items[k] || {}, text = String(it.text || '').trim(), founderText = it.founderText ? String(it.founderText) : '', adopted = !!it.adopted && !!text;
    const answered = !!founderText || (!!text && it.origin !== 'missing' && !/答唔到|要問/.test(text));
    return { text, assumed: answered && !founderText && !adopted && it.origin === 'ai', answered, ...(founderText ? { founderText } : {}), ...(adopted ? { adopted: true } : {}) };
  });
  const ok = answers.every(a => a.answered) && answers.filter(a => a.assumed).length <= 3;
  return { depth: ok ? 'ok' : 'shallow', answers };
}
// 假設清單（規劃書 3.2、附錄 A company.assumptions[]）：公司概覽「尚待驗證的假設」每條一項，起始級一律「假設」
export function assumptionsFromPage(page) {
  const dt = page && page.detail || {};
  const x = dt.assumptions, list = Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : [];
  const validCell = new Set(['partners', 'activities', 'resources', 'value', 'relationship', 'channel', 'customer', 'cost', 'revenue', 'problem', 'alternatives']);
  return list.filter(a => a && (a.label || a.value)).map((a, i) => ({
    id: 'H' + (i + 1), pageRef: a.id || '', text: String(a.label || a.value),
    cheapestTest: String((a.tentative && a.tentative.test) || a.test || ''), grade: 'guess', status: 'open',
    ...(validCell.has(a.cell) ? { cell: a.cell } : {}),
    milestoneIds: Array.isArray(a.milestoneIds) ? [...new Set(a.milestoneIds.filter(id => typeof id === 'string' && id))] : []
  }));
}

/* ---------- 主函數 ---------- */
function modelDisplay(DIR, cert) {
  const host = cert && hosts(path.dirname(fileURLToPath(import.meta.url))).find(h => h.id === cert.host || h.file === cert.host);
  if (!host?.models) return {};
  const seen = readJSON(path.join(DIR.ledger, 'model-seen.json'), {}), selected = {};
  for (const role of ['everyday', 'blue', 'red', 'judge']) {
    const candidates = modelCandidates(host, role);
    const candidate = candidates.find(c => c.model === seen[role]?.requested) || candidates[0];
    if (!candidate) return {};
    const actual = seen[role]?.requested === candidate.model ? seen[role].actual : '';
    selected[role] = { candidate, name: modelName(actual, candidate.label || candidate.model) + (candidate.effort === 'high' ? NAMES.ui.aiDeepThinking : '') };
  }
  const teams = selected.blue.name === selected.red.name ? NAMES.t('aiModelTeams', { model: selected.blue.name }) : NAMES.t('aiModelSplit', { blue: selected.blue.name, red: selected.red.name });
  const fallback = [...new Set(Object.entries(selected).filter(([role, s]) => seen[role]?.fallback && s.candidate.model === seen[role].requested).map(([, s]) => NAMES.t('aiModelFallback', { model: s.name })))];
  return { models: NAMES.t('aiModelsLine', { everyday: selected.everyday.name, teams, judge: selected.judge.name }), modelWarnings: fallback, modelNotice: readJSON(path.join(DIR.ledger, 'model-notice.json'), null) };
}
export function dashboardState(DIR, extra = {}) {
  const now = extra.now || clockNow();
  const today = dayStart(now);
  let state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  const sample = state.demo === true;
  if (sample) state = resolveTimes(state, now);
  else state = applyFounderOps(state, pendingFounderOps(DIR, state));
  const page = readJSON(path.join(DIR.company, 'page.json'), null);
  const confirmed = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const status = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
  const cert = extra.cert || null;

  /* 公司 */
  const co = { ...(page && page.company || {}), ...(state.company || {}) };
  const biz = readJSON(path.join(DIR.company, 'biz.json'), null);
  const overviewCurrent = overviewIsCurrent(page, confirmed);
  const overviewPending = !!page?.page?.id && !overviewCurrent;
  const company = { name: co.name || '', initials: co.initials || '', logo: (companyLogo(DIR) || {}).v || 0, oneLiner: co.oneLiner || '', ready: !!(page || state.company), confirmed: overviewCurrent && !!(confirmed || (state.intake && state.intake.state === 'complete')),
    ...(biz && BIZ_TYPES[biz.type] ? { bizType: biz.type } : {}) };
  const values = page ? registryValues(page, confirmed) : {};
  const goalRow = page && page.glance && (page.glance.rows || []).find(r => r.plan === 'G1');
  const nextRow = page && page.glance && (page.glance.rows || []).find(r => r.plan === 'G5');
  const pageQuarter = goalRow ? { text: String(values[goalRow.id] ?? goalRow.value), endsOn: goalRow.due ? String(values[goalRow.due.id] ?? goalRow.due.value ?? '') : '' } : null;
  // 逐欄合併：帳本的目標（例如每月覆核改寫的文字）沒有期限時，期限回落到已確認的公司概覽
  const goals = state.goals ? { ...state.goals, quarter: state.goals.quarter ? { ...state.goals.quarter, endsOn: state.goals.quarter.endsOn || (pageQuarter ? pageQuarter.endsOn : '') } : pageQuarter } : { quarter: pageQuarter };
  const money = moneyView(DIR, { today: ymd(today), full: false });
  const storedNextAction = (state.company && state.company.nextExternalAction) || (nextRow ? { text: String(values[nextRow.id] ?? nextRow.value), milestoneId: confirmed && confirmed.nextActionMilestone || nextRow.flagTo || '' } : null);

  /* 里程碑 */
  let milestones = Array.isArray(state.milestones) && state.milestones.length ? state.milestones.map(m => ({ ...m })) : milestonesFromPage(page, confirmed);
  const lines = Array.isArray(state.lines) && state.lines.length ? state.lines : [{ id: 'main', name: '主線' }];
  // 進度：已確認次序上第一個未完成嘅里程碑係「進行中」（帳本有就照帳本）
  for (const ln of lines) {
    const confirmedOnLine = milestones.filter(m => (m.lineId || 'main') === ln.id && m.pathStatus === 'confirmed').sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!confirmedOnLine.some(m => m.state && m.state !== 'not_started' && m.state !== 'done')) {
      const first = confirmedOnLine.find(m => m.state !== 'done');
      if (first) first.state = 'active';
    }
  }
  // 假設清單：帳本有就照帳本（級別只由你確認改），冇就由公司概覽列出（全部「假設」級）
  const asList = state.company && Array.isArray(state.company.assumptions) ? state.company.assumptions : assumptionsFromPage(page);
  const ACTED = ['did', 'paid', 'stuck'];
  const assumptions = { list: asList.map(a => ({ id: a.id, text: a.text, grade: a.grade || 'guess', status: a.status || 'open', changedAt: a.changedAt || '' })), guess: asList.filter(a => (a.grade || 'guess') === 'guess').length, acted: asList.filter(a => ACTED.includes(a.grade)).length };
  const orderUnconfirmed = lines.filter(ln => !milestones.some(m => (m.lineId || 'main') === ln.id && m.pathStatus === 'confirmed') && milestones.some(m => (m.lineId || 'main') === ln.id)).map(ln => ln.id);
  for (const m of milestones) {
    m.lineId = m.lineId || 'main';
    m.short = m.short || m.title;
    if (m.trial) {
      const until = parseDay(m.trial.until), started = parseDay(m.trial.startedAt);
      m.trial.daysLeft = until ? daysBetween(today, until) : null;
      m.trial.notStarted = !started || started > today;
      m.trial.overdue = !!(until && until < today && !m.trial.verdict) || !!(m.trial.stopSignal && m.trial.stopSignal.met);
    }
    for (const w of m.watchItems || []) {
      const h = w.history || [];
      w.unconfirmed = !h.length;
      w.lastChange = h.length ? h[h.length - 1].at : null;
      w.trend = h.length >= 2 ? Math.sign(Number(h[h.length - 1].value) - Number(h[h.length - 2].value)) || 0 : null;
    }
  }

  // 下一個對外動作：只有明確日期才作逾期判定；舊資料沒有日期時維持原有顯示。
  const activeMilestones = milestones.filter(m => m.pathStatus === 'confirmed' && m.state !== 'done').sort((a, b) => (a.state === 'active' ? -1 : 0) - (b.state === 'active' ? -1 : 0) || (a.order || 0) - (b.order || 0));
  const linkedMilestone = storedNextAction && milestones.find(m => m.id === storedNextAction.milestoneId);
  const actionText = String(storedNextAction && storedNextAction.text || '').trim();
  const actionDate = isDay(storedNextAction && storedNextAction.date) ? storedNextAction.date : '';
  const cancelled = !!(storedNextAction && storedNextAction.cancelledAt);
  const missingAction = !actionText || cancelled;
  const completedLink = !!(linkedMilestone && linkedMilestone.state === 'done');
  const staleDate = !!(actionDate && parseDay(actionDate) < today);
  const suggestedMilestone = activeMilestones[0] || null;
  const suggestion = (missingAction || completedLink) && suggestedMilestone && String(suggestedMilestone.event || suggestedMilestone.short || '').trim()
    ? { text: String(suggestedMilestone.event || suggestedMilestone.short).trim(), milestoneId: suggestedMilestone.id, milestone: suggestedMilestone.short || suggestedMilestone.title || '' } : null;
  const nextAction = {
    ...(storedNextAction || {}), text: actionText, date: actionDate, milestone: linkedMilestone ? linkedMilestone.short || linkedMilestone.title || '' : '',
    stale: missingAction || !!(storedNextAction && storedNextAction.pendingUpdate) || completedLink || staleDate,
    missing: missingAction, completedLink, staleDate, suggestion
  };

  /* 問題包 → 待你處理（同 Founder Desk 待決事項同一份清單） */
  const packs = listPacks(DIR).filter(p => p.open > 0);
  const decisions = Array.isArray(state.decisions) ? state.decisions : [];
  const msTitle = id => (milestones.find(m => m.id === id) || {}).short || '';
  const allTodo = buildTodo(DIR, { state, milestones, company, page, now });
  const todo = allTodo.filter(t => t.lane !== 'brain');
  const brainTodo = allTodo.filter(t => t.lane === 'brain');
  const snoozed = snoozedTodo(DIR, { state, milestones, company, page, now }).filter(t => t.lane !== 'brain');

  /* 工作（看板） */
  const COL = { planned: 'todo', active: 'doing', waiting: 'waiting', blocked: 'blocked', review: 'review', done: 'done', cancelled: null };
  const rawTasks = Array.isArray(state.tasks) ? state.tasks : [];
  const byTask = Object.fromEntries(rawTasks.map(t => [t.id, t]));
  const openPackIds = new Set(packs.map(p => p.id));
  // 負責人（約定）：owner 為 'founder'／'ai'／成員編號。「由人處理」＝創辦人或成員；成員離開後工作歸創辦人名下顯示，owner 不改寫
  const actorsList = ((state.company || {}).actors) || [], human = t => ownerKind(t.owner) !== 'ai';
  const founderDone = t => t.status === 'done' && (!human(t) || t.confirmedBy === 'founder');
  const msOrder = id => { const m = milestones.find(x => x.id === id); return m ? (m.order || ((milestones.find(x => x.id === m.branchFrom) || {}).order || 50) + 0.5) : 99; };
  // 等候乜：另一項工作、你一個決定、你一個現實行動、外部回覆（可附預計日期）；做咗／答咗／收到就唔再等
  function waitOf(t) {
    const w = t.waitFor;
    if (!w) return (t.status === 'waiting' || t.status === 'blocked') && t.waitingFor ? { kind: 'other', text: t.waitingFor, done: false } : null;
    if (w.kind === 'task') { const o = byTask[w.id] || {}; return { kind: 'task', text: '工作「' + (o.title || '另一項工作') + '」完成', done: !!byTask[w.id] && founderDone(o) }; }
    if (w.kind === 'action') { const o = byTask[w.id] || {}; return { kind: 'action', text: '你先「' + (o.title || '一個行動') + '」' + (o.dueAt ? '（' + o.dueAt.slice(5, 10).replace('-', '/') + '）' : ''), done: !!byTask[w.id] && founderDone(o) }; }
    if (w.kind === 'decision') { const p = packs.find(x => x.id === w.packId); return { kind: 'decision', text: '你決定「' + (p ? p.title : w.text || '一個決定') + '」', done: !openPackIds.has(w.packId) }; }
    if (w.kind === 'external') return { kind: 'external', text: (w.who || '對方') + '回覆' + (w.text ? '：' + w.text : ''), eta: w.eta || '', done: !!w.received };
    return null;
  }
  // 點解排先（固定規則，由上至下）：1 日期迫近（你嘅行動之前要準備好）；2 等得耐（對方要幾個星期先決定）；3 風險大（測試關鍵假設）；4 其餘照次序
  function whyOf(t) {
    if (founderDone(t) || t.status === 'cancelled') return null;
    if (t.firstBatch) return { rule: 0, key: String(t.updatedAt || ''), text: '缺少的資料：首批工作，排最前' };
    const soon = [];
    if (human(t) && t.dueAt) soon.push({ at: t.dueAt, title: t.title, self: true });
    for (const id of [].concat(t.prepFor || [])) { const a = byTask[id]; if (a && a.dueAt && !founderDone(a)) soon.push({ at: a.dueAt, title: a.title }); }
    const s = soon.sort((a, b) => String(a.at).localeCompare(String(b.at)))[0];
    if (s) { const n = daysBetween(today, parseDay(s.at) || today); if (n <= 14) return { rule: 1, key: String(s.at), text: s.self ? (n <= 0 ? '已到期，完成後需你確認' : n + ' 日後到期') : (n <= 0 ? '今日' : n + ' 日後') + '你需要「' + s.title + '」，之前要準備好' }; }
    if (t.longWait && t.longWait.weeks) return { rule: 2, key: String(99 - t.longWait.weeks).padStart(3, '0'), text: (t.longWait.who || '對方') + '通常需要約 ' + t.longWait.weeks + ' 星期才作決定，須及早開始' };
    if (t.riskTest) return { rule: 3, key: '', text: '測試關鍵假設「' + t.riskTest + '」：假設不成立則整個生意模式不成立' };
    const ord = msOrder(t.milestoneId);
    return { rule: 4, key: String(Math.round(ord * 10)).padStart(4, '0') + String(t.updatedAt || ''), text: t.milestoneId ? '按路線次序（' + (msTitle(t.milestoneId) || '') + '）' : t.capabilityId ? '能力建設，按次序' : '臨時工作，按提交先後' };
  }
  const tasks = rawTasks.map(t => {
    let col = COL[t.status];
    if (t.status === 'done' && t.needsAcceptance && !t.acceptedBy) col = 'review';
    // 你嘅現實行動：AI 唔可以標完成；未經你確認嘅「完成」一律當待你確認
    if (human(t) && t.status === 'done' && t.confirmedBy !== 'founder') col = 'review';
    const wait = waitOf(t), why = whyOf(t), ov = human(t) ? ownerView(t, actorsList) : null;
    return { id: t.id, title: t.title, status: t.status, column: col, milestoneId: t.milestoneId || '', milestone: msTitle(t.milestoneId), adhoc: t.adhoc === true || (!t.milestoneId && !t.capabilityId && !human(t)), capability: !!t.capabilityId,
      owner: human(t) ? 'founder' : 'ai', teammateId: human(t) ? '' : t.teammateId || '', ...(ov && ov.kind === 'team' ? { assigneeId: ov.actorId, assignee: ov.name, ...(ov.paused ? { assigneePaused: true } : {}) } : {}), ...(ov && ov.left ? { ownerLeft: true, formerOwner: ov.name } : {}), dueAt: t.dueAt || '', scenarioId: t.scenarioId || '', prepFor: [].concat(t.prepFor || []).map(id => (byTask[id] || {}).title).filter(Boolean),
      wait: wait && !wait.done ? wait : null, ready: !(wait && !wait.done) && !founderDone(t) && col !== 'review', why,
      teammate: human(t) ? (ov && ov.kind === 'team' ? ov.name : '你') : titleOf((state.teammates || []).find(x => x.id === t.teammateId)), next: t.next || '', updatedAt: t.updatedAt || '', packId: t.packId || '', waitingFor: t.waitingFor || '', artifact: t.artifactTitle || '' };
  }).filter(t => t.column).sort((a, b) => ((a.why ? a.why.rule : 9) - (b.why ? b.why.rule : 9)) || String(a.why ? a.why.key : '').localeCompare(String(b.why ? b.why.key : '')));

  /* 兩站並行：最多兩站同時進行（試行另計），第二站要你確認 */
  const inProgress = milestones.filter(m => m.pathStatus === 'confirmed' && ['active', 'waiting', 'blocked'].includes(m.state)).sort((a, b) => (a.order || 0) - (b.order || 0));
  const second = inProgress[1];
  const parallel = { count: inProgress.length, max: 2, ids: inProgress.map(m => m.id), confirmedAt: second ? second.parallelConfirmedAt || '' : '', confirmed: !second || !!second.parallelConfirmedAt, over: inProgress.length > 2 };

  /* AI 工作紀錄：帳本 runs + 原型外殼嘅 status.json */
  // 呢次工作屬邊項生意大腦：由外殼狀態檔真實記錄讀出（體檢／商機掃描嘅進行中步驟、紅藍對打、情景演練）；冇對應就留空
  const brainItemOf = r => { const st = (r.steps || []).find(s => String(s.key || '').startsWith('brain-') && s.state === 'running'); return st ? String(st.key).slice(6) : r.kind === 'debate' ? 'wargame' : r.noteType === 'practice-prep' || r.noteType === 'debrief' ? 'scenario' : ''; };
  const shellRuns = (status.runs || []).map(r => ({ id: r.id, type: r.kind === 'intake' ? 'inbox' : r.kind === 'note' ? 'inbox' : 'inbox', label: (r.steps || []).find(s => s.key === 'ai')?.label || r.label || String((r.steps || []).find(s => s.key === 'received')?.detail || ''), state: r.state === 'running' ? 'running' : r.state === 'done' ? 'ended' : r.state === 'failed' ? 'failed' : r.state === 'waiting' ? 'waiting' : 'ended',
    startedAt: r.startedAt, endedAt: r.endedAt || '', lastAt: (r.steps || []).map(x => String(x.at || '')).concat(String(r.startedAt || '')).sort().pop(), summary: r.result && r.result.summary || r.error || '', artifacts: (r.result && r.result.artifacts || []).length, moduleIds: ['ai-week', 'artifacts'], aiStarted: !!(r.steps || []).find(s => s.key === 'ai'), kindRaw: r.kind || '', brainItem: brainItemOf(r) }));
  // 同一次 run 兩邊都有（排程 run、你送出後嘅 run 都記入帳本）：照用外殼狀態嗰份（名稱、狀態、產出），加上帳本嘅觸發來源同收尾；只喺帳本有嘅（例如跳過嘅排程 run）照帳本
  const ledgerById = Object.fromEntries((Array.isArray(state.runs) ? state.runs : []).map(r => [r.id, r])), shellIds = new Set(shellRuns.map(r => r.id));
  const runs = [...shellRuns.map(r => { const l = ledgerById[r.id]; return l ? { ...r, type: l.type || r.type, trigger: l.trigger, ending: l.ending, slot: l.slot } : r; }), ...(Array.isArray(state.runs) ? state.runs : []).filter(r => !shellIds.has(r.id))].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  const running = runs.find(r => r.state === 'running');

  /* 事件 */
  const brain = { ...loadBrain(DIR, { now, runs: status.runs || [], packs, state }), pending: brainTodo.length };
  const actorIds = ((state.company || {}).actors) || [], moneyForPeople = moneyWithResolvedActors(readMoney(DIR), actorIds);
  const enrichProspects = detail => {
    if (!detail || !Array.isArray(detail.prospects)) return detail;
    return { ...detail, prospects: detail.prospects.map(prospect => {
      const id = resolveActorId(actorIds, prospect && prospect.id);
      if (!id) return prospect;
      const paid = payerStats(moneyForPeople.records, id, moneyForPeople.links, moneyForPeople.mainCurrency);
      const needsEvidence = liveRecords(moneyForPeople.records).some(record => {
        const linked = record.counterpartId || moneyForPeople.links[record.payerKey];
        return record.dir === 'in' && !record.refund && record.category !== 'funding' && !hasEvidence(record) && linked === id;
      });
      return { ...prospect, money: { ...paid, needsEvidence } };
    }) };
  };
  if (Array.isArray(brain.items)) brain.items = brain.items.map(item => item && item.id === 'pipeline' ? { ...item, detail: enrichProspects(item.detail) } : item);
  // 結果卡意見事件：標題用現時顯示版嘅卡名（帳本原文唔改；卡名改寫過都一致）
  const fbTitle = e => { const f = e.type === 'input' && /^你對「.*」的意見：/.test(String(e.title || '')) && brain && brain.feedback && brain.feedback[(e.relatedIds || [])[0]];
    return f && f.title ? { ...e, title: '你對「' + (f.itemName ? f.itemName + '：' : '') + f.title + '」的意見：' + String(e.title).replace(/^你對「.*」的意見：/, '') } : e; };
  const events = (Array.isArray(state.events) ? state.events : []).map(fbTitle).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // 只記錄（冇開 AI）嘅外殼工作唔算 AI 事件：佢哋已經記咗做創辦人輸入
  for (const r of shellRuns) if ((r.state === 'ended' || r.state === 'failed') && r.aiStarted) events.push({ id: 'ev-' + r.id, at: r.endedAt || r.startedAt, actor: 'ai', type: 'run', title: (r.state === 'failed' ? 'Zero 工作未完成：' : 'Zero 完成工作：') + (r.label || ''), relatedIds: [r.id], moduleIds: ['ai-week', 'artifacts'] });
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const businessEvents = events.filter(e => !['run', 'health', 'capability'].includes(e.type));

  /* 輸入同訪問 */
  const inputs = Array.isArray(state.inputs) ? state.inputs : [];
  const inboxFiles = fs.existsSync(DIR.inbox) ? fs.readdirSync(DIR.inbox).filter(f => !f.startsWith('.')) : [];
  const unprocessed = inputs.filter(i => i.status === 'unprocessed').map(i => ({ id: i.id, title: i.title || '', at: i.receivedAt }));
  // 預填同放入文件嘅附件跟住說明檔，唔另計
  for (const f of inboxFiles) if (!/-(?:prefill|note-doc-file)-\d+-/.test(f) && !(isInboxAttachment(f) && !/-intake-\d+-/.test(f)) && !unprocessed.some(u => u.title === f)) unprocessed.push({ id: f, title: /-intake(\.md|-)/.test(f) ? '公司資料（' + NAMES.ui.intake + '）' : /-prefill\.md$/.test(f) ? '由文件預填（Zero 正在讀）' : /-note-doc\.md$/.test(f) ? '文件（等 Zero 閱讀）' : /-note-/.test(f) ? '你的要求（等 Zero 處理）' : /-feedback-/.test(f) ? '你對生意大腦的意見' : '文件', at: '' });
  const awaiting = inputs.filter(i => i.status === 'awaitingFounder').map(i => ({ id: i.id, title: i.title || '', question: i.awaitingFounderText || '', packId: i.packId || '', at: i.receivedAt }));
  const recentInputs = inputs.filter(i => i.status === 'processed').sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 3).map(i => ({ id: i.id, title: i.title || '', at: i.receivedAt, effects: (i.effects || []).map(e => e.change).filter(Boolean) }));
  // 輸入頁「真實事件」欄：最近記錄嘅真實事件（任何狀態）同各自收據
  const eventInputs = inputs.filter(i => i.eventDate).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 4).map(i => ({ id: i.id, title: i.title || '', at: i.receivedAt, date: i.eventDate, status: i.status, packId: i.packId || '', effects: (i.effects || []).map(e => e.change).filter(Boolean), unreadable: Array.isArray(i.unreadable) ? i.unreadable.map(u => ({ file: String(u.file || ''), reason: String(u.reason || '') })) : [] }));
  const interviews = state.interviews || null;
  const rhythm = state.company && state.company.rhythm || null;
  // 排程狀態（系統頁）：邊個負責按時叫 AI 開工、上次實際觸發、下次開工；作業系統排程未安裝就冇「下次」
  const schedMark = sample ? null : scheduleMark(DIR);
  const scheduler = sample ? 'demo' : extra.scheduler === 'sim' ? 'sim' : schedMark && schedMark.mode === 'server' ? 'server' : schedMark && schedMark.mode !== 'stopped' ? 'os' : 'none';
  const lastSched = (Array.isArray(state.runs) ? state.runs : []).filter(r => r.trigger === 'schedule').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).pop() || null;
  const st = extra.schedStatus || null;
  // 舊式工作冇讀回實際排程，唔講下次時間；存在與否只影響文字
  const legacyLive = !!(st && st.ok && st.registered);
  const ranToday = (Array.isArray(state.runs) ? state.runs : []).some(r => r && r.trigger === 'schedule' && r.slot === ymd(now));
  const nextAt = scheduler !== 'none' && scheduler !== 'os' ? nextRunAt(rhythmOf(state), now, { ranToday }) : null;
  const osSched = scheduler === 'os' ? { legacy: !schedMark.mode, confirmed: legacyLive, name: schedMark.name || '', cadence: schedMark.cadence || 'daily', runTime: schedMark.runTime || '', registeredAt: schedMark.registeredAt || '', startWhenAvailable: st && st.registered ? !!st.startWhenAvailable : !!schedMark.startWhenAvailable,
    stale: scheduleStale(schedMark, rhythmOf(state)), osNext: (st && st.next) || schedMark.nextRunAt || '', osLast: (st && st.last) || '', osLastResult: st && st.last ? st.lastResult : null, missing: !!(st && st.ok && !st.registered) } : null;
  const cleanupPending = !!(schedMark && schedMark.mode === 'stopped');
  const schedulePaused = !!(state.health && (state.health.pausedByFounder || state.health.autoStopped));
  const due = scheduleEligibility(rhythmOf(state), now, { enabled: scheduler === 'server', sample, aiReady: !!cert, paused: schedulePaused || overviewPending, recorded: day => (Array.isArray(state.runs) ? state.runs : []).some(r => r && r.trigger === 'schedule' && r.slot === day), approvedAt: scheduler === 'server' ? schedMark.approvedAt : '', updatedAt: scheduler === 'server' ? rhythm?.updatedAt : '' });
  const rhythmInfo = { scheduler, os: osSched, autostart: scheduler === 'server' ? { enabled: !!(schedMark.autostart && schedMark.autostart.enabled) && !(st && st.ok && st.autostart && !st.autostart.registered), registered: !!(st && st.autostart && st.autostart.registered) } : { enabled: false, registered: cleanupPending ? null : false }, cleanupPending, overviewPending, ranToday, catchUp: due.catchUp, catchUpAt: due.catchUp ? localIso(due.slot) : '', nextRunAt: nextAt ? localIso(nextAt) : '', lastScheduleAt: lastSched ? lastSched.startedAt : '', lastSchedule: lastSched ? { state: lastSched.state, skipReason: lastSched.skipReason || '', ending: lastSched.ending || '', rejected: !!lastSched.rejected, rejectReason: lastSched.rejectReason || '', label: lastSched.label || '' } : null };

  /* 日程：14 日清單與月曆共用同一個資料入口。 */
  const actionHref = '/#next-action';
  const rhythmHref = '/dashboard/system?editRhythm=1#sys-rhythm';
  const pathHref = id => '/dashboard/path#' + encodeURIComponent(id);
  const changeTargetHref = id => '/#/change/target/' + encodeURIComponent(id);
  const changeTaskHref = id => '/#/change/task/' + encodeURIComponent(id);
  const calendarFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const calendarTo = new Date(today.getFullYear(), today.getMonth() + 3, 0);
  const calendarItems = (from, to, includeExternal = false) => {
    const list = [];
    const add = (date, kind, text, extra2) => {
      const d = parseDay(date); if (!d || d < from || d > to) return;
      list.push({ date: ymd(d), kind, text, overdue: d < today, ...(extra2 || {}) });
    };
    const interviewTodo = todo.find(t => t.type === 'interview');
    if (interviews && interviews.nextOn) {
      add(interviews.nextOn, 'interview', NAMES.d('calInterview'), { href: interviewTodo?.href || rhythmHref, action: interviewTodo ? NAMES.d('calGoAnswer') : NAMES.d('calChangeVisit') });
      const first = parseDay(interviews.nextOn);
      if (first) for (let d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7); d <= to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7)) if (d >= from && d >= today) add(ymd(d), 'interview', NAMES.d('calInterview'), { href: rhythmHref, action: NAMES.d('calChangeVisit'), planned: true });
    }
    if (interviews && interviews.lastOn) add(interviews.lastOn, 'interview', NAMES.d('calInterviewDone'), { href: '/dashboard/overview', action: NAMES.d('toOverview'), completed: true });
    for (const m of milestones) {
      if (m.pathStatus === 'retired' || m.state === 'done') continue;
      if (m.trial && m.trial.until && !m.trial.verdict) add(m.trial.until, 'trial', NAMES.d('calTrial', { t: m.short }), { milestoneId: m.id, href: pathHref(m.id), action: NAMES.d('calViewPath') });
      if (m.targetDate && m.pathStatus !== 'proposed') add(m.targetDate, 'target', NAMES.d('calTarget', { t: m.short }) + (m.targetDateTentative ? '（' + NAMES.d('tentative') + '）' : ''), { milestoneId: m.id, href: changeTargetHref(m.id), action: NAMES.d('calChangeDate') });
    }
    if (goals && goals.month && goals.month.endsOn) add(goals.month.endsOn, 'target', NAMES.d('calMonthCheck', { t: goals.month.text }), { href: '/dashboard/overview', action: NAMES.d('toOverview') });
    // 你嘅現實行動（有日子嘅）
    for (const t of tasks) if (t.owner === 'founder' && t.dueAt && t.column !== 'done' && t.column !== 'review') add(t.dueAt, 'action', t.title + (/T\d{2}:\d{2}/.test(t.dueAt) ? ' ' + t.dueAt.slice(11, 16) : ''), { taskId: t.id, milestoneId: t.milestoneId, href: changeTaskHref(t.id), action: NAMES.d('calChangeDate'), who: t.assignee ? { kind: 'member', name: t.assignee } : t.ownerLeft ? { kind: 'left', name: t.formerOwner } : { kind: 'me', name: '' } });
    for (const t of todo) if (t.due) add(t.due, 'decision', NAMES.d('calDecision', { t: t.text }), { href: t.href || '/', action: NAMES.d('calGoAnswer') });
    if (includeExternal && actionDate && !cancelled) add(actionDate, 'external', NAMES.d('calExternal', { t: actionText }), { href: actionHref, action: NAMES.d('calExternalAction') });
    return list.sort((a, b) => (b.overdue - a.overdue) || a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  };
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
  // 清單保留所有逾期項目；已作答同之後每週推算只上月曆
  const sched = calendarItems(new Date(0), horizon).filter(item => !item.planned && !item.completed);
  if (rhythm && rhythm.runTime && scheduler !== 'none' && (scheduler !== 'os' || legacyLive)) {
    const shown = scheduler === 'os' ? { ...rhythmOf(state), runCadence: schedMark.cadence || 'daily', runTime: schedMark.runTime || rhythm.runTime, interviewWeekday: schedMark.interviewWeekday || rhythmOf(state).interviewWeekday } : rhythmOf(state);
    const next = nextRunAt(shown, now, { ranToday });
    if (next) sched.push({ date: ymd(next), kind: 'ai', text: NAMES.d('calAiWork', { t: shown.runTime }), overdue: false, href: rhythmHref, action: NAMES.d('calChangeTime'), planned: true });
  }
  sched.sort((a, b) => (b.overdue - a.overdue) || a.date.localeCompare(b.date));

  /* 作業網（設計稿 2026-10-28 第 3 節）：「工作中」、亮線同粒子只由真正運行中嘅會話、子代理或者外殼自己嘅 AI 工作觸發；冇新鮮度窗 */
  const work = workOf({ shellRuns, ledgerRuns: Array.isArray(state.runs) ? state.runs : [], sample, busy: !!extra.busy, observed: extra.observed, observeFolders: extra.observeFolders, observePending: extra.observePending, tasks, events, now });
  const hot = new Set();
  for (const s of work.sessions.filter(s => s.state === 'working')) {
    hot.add('system');
    for (const id of s.moduleIds) hot.add(id);
    if (s.taskIds.length) { hot.add('ai-week'); hot.add('now'); }
  }
  const active = milestones.find(m => m.state === 'active' || m.state === 'waiting' || m.state === 'blocked') || null;
  const trials = milestones.filter(m => m.pathStatus === 'trial');
  const options = (Array.isArray(state.pathOptions) ? state.pathOptions : []).filter(o => o.status === 'open');
  const teammates = Array.isArray(state.teammates) ? state.teammates : [];
  const health = { ...(state.health || {}), warnings: [...((state.health || {}).warnings || [])] };
  if (parallel.over) health.warnings.push('有 ' + parallel.count + ' 站同時進行，超過兩站上限。請到待決事項決定先暫停哪一站。');
  else if (!parallel.confirmed) health.warnings.push('第二站「' + second.short + '」未經你確認已經開始');
  const pausedCalendar = !!(health.pausedByFounder || health.autoStopped);
  const calendarRhythm = scheduler === 'os' ? { ...rhythmOf(state), runCadence: schedMark.cadence || 'daily', runTime: schedMark.runTime || rhythm?.runTime, interviewWeekday: schedMark.interviewWeekday || rhythmOf(state).interviewWeekday } : rhythmOf(state);
  const canPlanCalendar = !!(rhythm && rhythm.runTime && scheduler !== 'none' && (scheduler !== 'os' || legacyLive));
  const plannedRunDays = [], pausedDays = [];
  // 過去只看帳本；未來從同一個「下次開工」判斷開始推算（包括 ranToday）。
  const nextCalendarRun = canPlanCalendar ? nextRunAt(calendarRhythm, now, { ranToday }) : null;
  const firstPlannedDay = nextCalendarRun ? dayStart(nextCalendarRun) : null;
  for (let d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); d <= calendarTo; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    // 今日只有未到開工時間又未開過工先算推算
    if (d.getTime() === today.getTime() && !due.catchUp && !(firstPlannedDay && firstPlannedDay.getTime() === today.getTime())) continue;
    if (!isRunDay(calendarRhythm, d)) continue;
    if (pausedCalendar) pausedDays.push(ymd(d));
    else if ((due.catchUp && d.getTime() === today.getTime()) || (firstPlannedDay && d >= firstPlannedDay)) plannedRunDays.push(ymd(d));
  }
  const calendar = {
    from: ymd(calendarFrom), to: ymd(calendarTo),
    runDays: calendarRunDays(state.runs, calendarFrom, calendarTo, today),
    plannedRunDays, paused: pausedCalendar, pausedDays,
    items: calendarItems(calendarFrom, calendarTo, true),
    rhythm: rhythm ? { runCadence: calendarRhythm.runCadence, runTime: calendarRhythm.runTime, interviewWeekday: calendarRhythm.interviewWeekday, scheduler } : null,
    quarter: goals && goals.quarter ? { text: goals.quarter.text || '', endsOn: goals.quarter.endsOn || '', target: goals.quarter.target || null } : null,
    ready: company.ready && company.confirmed
  };
  // 模組狀態：等待、受阻由帳本事實推導（靜態色）；工作中只由作業網入面工作中嘅會話推導
  const pick = (...c) => ['unknown', 'blocked', 'waiting', 'working'].find(s => c.includes(s)) || 'idle';
  const lit = id => hot.has(id) ? 'working' : '';
  const workingTasks = new Set(work.tasks.filter(t => t.state === 'working').map(t => t.id));
  if (tasks.some(t => workingTasks.has(t.id) && t.teammate && t.owner !== 'founder')) hot.add('team');
  const activity = {
    now: pick(active && active.state === 'blocked' ? 'blocked' : '', active && active.state === 'waiting' ? 'waiting' : '', lit('now')),
    evidence: pick(lit('evidence')),
    decisions: pick(todo.some(t => t.state === 'overdue') ? 'blocked' : '', todo.length ? 'waiting' : '', lit('decisions')),
    paths: pick(trials.some(m => m.trial && m.trial.overdue) ? 'blocked' : '', options.length ? 'waiting' : '', lit('paths')),
    'ai-week': pick(tasks.some(t => t.column === 'blocked') ? 'blocked' : '', tasks.some(t => t.column === 'waiting') ? 'waiting' : '', lit('ai-week')),
    inputs: pick(awaiting.length ? 'waiting' : '', work.inbox.processing ? 'working' : ''),
    team: pick(teammates.some(t => t.lifecycle === 'planned' && t.activationTaskId) ? 'waiting' : '', lit('team')),
    recent: 'idle',
    artifacts: pick(lit('artifacts')),
    system: pick(!cert || health.autoStopped ? 'blocked' : '', (health.warnings || []).length ? 'waiting' : '', lit('system'))
  };

  /* 頁首指標 */
  const counted = milestones.filter(m => m.pathStatus === 'confirmed' || m.pathStatus === 'trial');
  const metrics = {
    quarter: { done: counted.filter(m => m.state === 'done').length, total: counted.length, text: goals && goals.quarter ? goals.quarter.text : '', endsOn: goals && goals.quarter ? goals.quarter.endsOn : '', target: goals && goals.quarter ? goals.quarter.target || null : null },
    pending: todo.length,
    inbox: unprocessed.length,
    nextInterview: interviews && interviews.nextOn || '',
    repliesWaiting: fs.existsSync(DIR.replies) ? fs.readdirSync(DIR.replies).filter(f => f.endsWith('.md')).length : 0
  };

  /* 你上次嚟之後 */
  // 路徑事件之後受影響節點保留細外環，直到創辦人下次打開公司現況頁（同「上次離開之後」同一界線，規劃書 4.2）；第一次打開冇外環
  let since = null, pathTouched = [];
  const last = extra.lastSeen;
  if (last && last.at) {
    const t = new Date(last.at).getTime();
    const after = runs.filter(r => new Date(r.startedAt).getTime() > t && r.aiStarted !== false && r.state !== 'skipped');
    const msIds = new Set((state.milestones || []).map(m => m.id));
    pathTouched = [...new Set(events.filter(e => (e.type === 'path' || e.type === 'milestone') && new Date(e.at).getTime() > t).flatMap(e => (e.relatedIds || []).filter(id => msIds.has(id))))];
    since = { at: last.at, awayDays: Number.isFinite(t) ? Math.max(0, daysBetween(new Date(last.at), now)) : 0, runs: after.length, withOutput: after.filter(r => r.artifacts > 0 || (r.ending === 'artifact')).length, waiting: todo.length, latest: (businessEvents.find(e => new Date(e.at).getTime() > t) || {}).title || '' };
  }

  /* 甲板 */
  const lastRun = runs.find(r => r.state !== 'running' && r.aiStarted !== false);
  const deck = {
    nextDecision: todo.find(t => ['trial', 'order', 'autoStop', 'path', 'blocking', 'decision'].includes(t.type)) || todo[0] || null,
    recentChanges: events.filter(e => e.type === 'path' || e.type === 'milestone').slice(0, 3),
    freshness: { ledgerAt: state.updatedAt || (status.updatedAt || ''), lastRunAt: lastRun ? (lastRun.endedAt || lastRun.startedAt) : '' }
  };

  /* 指引：而家最要緊嗰一步（阻塞卡） */
  const ivDone = !!(interviews && interviews.lastOn), firstAccept = todo.find(t => t.type === 'acceptance') && !(state.tasks || []).some(t => t.acceptedBy === 'founder');
  const hasInterview = !!(interviews && interviews.nextOn) && todo.some(t => t.type === 'interview');
  const guide = !cert ? 'noAI' : !company.ready ? 'noCompany' : !company.confirmed ? 'proofread' : firstAccept ? 'accept' : !ivDone ? (hasInterview ? 'firstInterview' : 'waitInterview') : 'daily';

  /* 0.41.0 Zero 團隊分工：團隊頁（R2）、節奏及用量（R5）、回饋卡及今日交付（R4、R6、R7）；舊資料沒有新欄時照資料約定「舊資料沒有時」 */
  let startLines = [];
  try { startLines = fs.readFileSync(path.join(DIR.ledger, 'ai-starts.log'), 'utf8').split('\n').filter(Boolean); } catch { }
  const dayKey = ymd(today);
  const startCounts = startLines.length ? countStarts(startLines, dayKey, { runIds: runIdsOfDay(state, dayKey) }) : null;
  const teleNow = teleOf(runs, rhythm, rhythmInfo, now, state);
  const unreadN = todo.filter(t => t.type === 'acceptance').length;
  const pace = paceView(state, { today: dayKey, counts: startCounts, tele: teleNow, unread: unreadN });
  const team = teamView(state, { today: dayKey, msTitle, tasks, working: workingTasks, counts: startCounts, actors: actorsList });
  const readReceipt = id => /^R[\w-]{1,40}$/.test(String(id || '')) && DIR.work ? readJSON(path.join(DIR.work, id, 'receipt.json'), null) : null;
  const deliveries = deliveriesView(state, { today: dayKey, msTitle, readReceipt, todo, pace, openTodo: todo.filter(t => ['decision', 'blocking', 'path', 'autoStop', 'acceptance'].includes(t.type)).length });

  return {
    ok: true, sample, now: localIso(now), today: ymd(today), guide, firstWeekDone: ivDone,
    company, goals, nextAction, metrics, money, ext: extra.ext || null, since, pathTouched,
    ai: { ready: !!cert, label: cert ? cert.label : '', certifiedAt: cert ? cert.certifiedAt : '', ...modelDisplay(DIR, cert), busy: !!extra.busy || !!running, running: running ? { label: running.label, startedAt: running.startedAt } : null },
    lines, orderUnconfirmed, milestones, assumptions, options, todo, brainTodo, snoozed, schedule: sched, calendar, tasks, parallel,
    brain, people: { ...(() => { const v = peopleView(state, { today: ymd(today) }); return { external: v.external, closed: v.closed, team: v.team }; })(), terms: termsView(state), ownership: ownershipOf(state), gapDays: GAP_DAYS, sync: peopleSyncView(DIR, state) },
    teammates: teammates.map(t => { const v = team.roles.find(r => r.id === t.id); return { ...t, name: titleOf(t), title: titleOf(t), avatarKind: avatarKindFor(t), lifecycle: lifecycleOf(t), milestones: (t.milestoneIds || []).map(msTitle).filter(Boolean), activity: v ? v.activity : 'idle' }; }),
    team, pace, deliveries, rolesSync: rolesSyncView(DIR, state),
    capabilities: Array.isArray(state.capabilities) ? state.capabilities : [],
    events: events.slice(0, 400), recent: businessEvents.slice(0, 8),
    inputs: { unprocessed, awaiting, recent: recentInputs, events: eventInputs, all: inputList(DIR, state, { packs: listPacks(DIR), runs: status.runs || [] }) },
    interviews, rhythm, rhythmInfo, tele: teleOf(runs, rhythm, rhythmInfo, now, state), sim: extra.sim || null, runs: runs.slice(0, 20), health, activity, deck, work,
    artifacts: (Array.isArray(state.artifacts) ? state.artifacts : []).concat(shellRuns.filter(r => r.artifacts).map(r => ({ title: r.label, runId: r.id, at: r.endedAt || r.startedAt, milestoneId: '' }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6)
  };
}

/* ---------- 即時微動畫用嘅真數據（規劃書 4.7 (3)）：下次排程 AI 工作、今日 AI 啟動次數、今日用時同費用 ----------
   頁面每秒用本機時鐘重算倒數，唔打網路；冇費用紀錄就唔寫費用。 */
function teleOf(runs, rhythm, rhythmInfo, now, state = null) {
  const day = localIso(now).slice(0, 10);
  const today = runs.filter(r => String(r.startedAt || '').slice(0, 10) === day && r.aiStarted !== false && r.state !== 'skipped');
  const minutes = Math.round(today.reduce((a, r) => a + Math.max(0, (new Date(r.endedAt || now).getTime() - new Date(r.startedAt).getTime()) / 60000), 0));
  const costed = today.filter(r => r.aiCost && typeof r.aiCost.usd === 'number');
  return { nextRunAt: (rhythmInfo && rhythmInfo.nextRunAt) || '', starts: today.length, cap: fuseOf(state || { company: { rhythm } }), minutes, usd: costed.length ? Math.round(costed.reduce((a, r) => a + r.aiCost.usd, 0) * 100) / 100 : null };
}

/* ---------- 作業網資料（設計稿 2026-10-28 第 3 節；唯一定義處）：頁面只畫、唔推斷 ----------
   會話有兩種來源：
   (1) 外殼自己嘅 AI 工作：status.json 運行中（外殼程序仍在 → 工作中；程序唔喺 → 待核實）；示範帳本 runs[] 運行中照計（虛構）
   (2) 觀測來源：監察台讀回時伺服器叫轉接層觀測程式（最多每 5 秒一次），只觀察帳本 observe.folders[] 登記嘅公司工作資料夾（已驗欄位、遮蓋、截斷）
   工作中嘅 run 超過 15 分鐘冇新步驟 → 待核實、唔再亮線（4.8）；觀測會話由轉接層按同一口徑判定。
   並發數 = 工作中會話 + 佢哋進行中嘅子代理 + 收件匣處理中（1）；並發 0 → 冇亮線、冇粒子。 */
/* ---------- 待你處理（規劃書 4.3，唯一定義處）：營運監察台同 Founder Desk 待決事項共用同一份清單同次序 ----------
   排序：先按逾期日數由大至小（決定＝提出後超過七日未答；試行到期、訪問按其日期；你的行動按 dueOn）；
   同級按類型：試行到期 > 次序確認 > 自動停 > 路徑決定 > 其他阻塞決定 > 驗收 > 收件回覆 > 訪問 > 問題 > 不阻塞決定 > 你的行動；再按提出時間先後。 */
const plusDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const TODO_RANK = { trial: 0, order: 1, autoStop: 2, path: 3, blocking: 4, acceptance: 5, inbox: 6, interview: 7, question: 8, decision: 9, action: 10 };
const DECIDES = ['decision', 'blocking', 'path', 'autoStop'];
const brainLane = full => {
  const debate = full && full.debate && full.debate.kind;
  return debate === 'response' || debate === 'adopt' || full && full.brainItem && full.rhythm ? 'brain' : 'main';
};
function buildTodoLists(DIR, { state, milestones, company, page, now }) {
  const today = dayStart(now);
  // 求助回覆有固定入口，不屬待決事項，也不應影響待決數目或等候提示。
  const packs = listPacks(DIR).filter(p => p.open > 0 && !p.isHelp);
  const decisions = Array.isArray(state.decisions) ? state.decisions : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const msTitle = id => ((milestones || []).find(m => m.id === id) || {}).short || '';
  const todo = [], snoozed = [];
  const holds = state.founderSnoozes || {}, pausedBefore = state.founderSnoozeDays || {};
  const add = item => {
    const hold = holds[item.id] || (isDay(item.snoozedUntil) ? { until: item.snoozedUntil, startedAt: '' } : null);
    const paused = Number(pausedBefore[item.id] || 0) + snoozeDays(hold, now);
    item.overdueDays = Math.max(0, Number(item.overdueDays || 0) - paused);
    item.state = item.overdueDays > 0 ? 'overdue' : 'open';
    if (hold && isDay(hold.until) && parseDay(hold.until) > today) snoozed.push({ ...item, snoozedUntil: hold.until });
    else todo.push(item);
  };
  for (const p of packs) {
    const full = readJSON(path.join(DIR.asks, p.id + '.json'), {}) || {};
    const d = decisions.find(x => x.packId === p.id) || {};
    const type = full.todoType || d.todoType || (full.actionConfirm ? 'action' : d.kind === 'path' ? 'path' : d.kind === 'trial' ? 'trial' : d.kind ? (d.blocking ? 'blocking' : 'decision') : 'question');
    const askedAt = d.askedAt || full.askedAt || p.askedAt || '';
    const waited = askedAt ? daysBetween(new Date(askedAt), now) : 0;
    const task = full.actionConfirm ? tasks.find(t => t.id === full.actionConfirm.taskId) : null;
    const due = String(d.due || full.due || (task && (task.dueOn || task.dueAt)) || (DECIDES.includes(type) && askedAt ? ymd(plusDays(new Date(askedAt), 7)) : '')).slice(0, 10);
    const overdueDays = due && parseDay(due) < today ? daysBetween(parseDay(due), today) : 0;
    const q0 = (full.questions || [])[0] || {};
    const rec = full.rec || (q0.options || []).find(o => o.rec)?.text || (q0.value != null && !Array.isArray(q0.value) ? String(q0.value) : '');
    const lane = brainLane(full);
    const input = full.realEvent && (state.inputs || []).find(row => row && row.id === full.realEvent.inputId);
    const baseText = full.todoText || d.title || p.title;
    const inputTitle = input && String(input.title || '').replace(/^[^：]*：/, '').trim();
    const todoText = factMergeOn() && inputTitle ? clip(baseText + '：' + clip(inputTitle, 48), 90) : baseText;
    add({ id: p.id, type, text: todoText, milestoneId: full.milestoneId || d.milestoneId || '', milestone: msTitle(full.milestoneId || d.milestoneId), rec, due, askedAt, waited, overdueDays, ...(askedAt ? { staleDays: Math.max(0, waited) } : {}), lane, brain: full.brainItem || (lane === 'brain' ? 'wargame' : ''), forNextAction: full.forNextAction === true, inputReceivedAt: input && (input.receivedAt || input.createdAt || ''),
      state: overdueDays > 0 ? 'overdue' : 'open', count: p.open, href: '/#/ask/' + p.id, kind: 'ask' });
  }
  // 排程節奏改咗（交資料第 9 題或者系統頁）：放一張「重新登記排程」提示卡，按下去系統頁（或者喺對話輸入「重新登記排程」）
  const sm = state.demo === true ? null : scheduleMark(DIR);
  if (sm && !sm.mode && !state.demo) add({ id: 'schedule-legacy', type: 'order', text: NAMES.ui.schedLegacyTodo, milestoneId: '', milestone: '', rec: NAMES.ui.schedReRegister, due: '', askedAt: '', waited: 0, overdueDays: 0, lane: 'main', state: 'open', href: '/dashboard/system', kind: 'schedule' });
  else if (scheduleStale(sm, rhythmOf(state))) { const r = rhythmOf(state); add({ id: 'schedule-stale', type: 'order', text: NAMES.t('schedStaleTodo', { t: r.runTime }), milestoneId: '', milestone: '', rec: NAMES.ui.schedReRegister, due: '', askedAt: '', waited: 0, overdueDays: 0, lane: 'main', state: 'open', href: '/dashboard/system', kind: 'schedule' }); }
  if (sm && sm.mode === 'stopped' && !state.demo) add({ id: 'schedule-cleanup', type: 'order', text: NAMES.ui.schedCleanupTodo, milestoneId: '', milestone: '', rec: NAMES.ui.schedRemoveAgain, due: '', askedAt: sm.stoppedAt || '', waited: 0, overdueDays: 0, lane: 'main', state: 'open', href: '/dashboard/system', kind: 'schedule' });
  const lastSchedule = (Array.isArray(state.runs) ? state.runs : []).filter(r => r.trigger === 'schedule').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).pop();
  const certAt = (readJSON(path.join(DIR.ledger, 'adapter-cert.json'), null) || {}).certifiedAt || '';
  if (lastSchedule && lastSchedule.skipReason === 'adapterVersionChanged' && !(certAt && new Date(certAt) > new Date(lastSchedule.startedAt))) add({ id: 'schedule-recertify', type: 'order', text: NAMES.ui.schedRecertifyTodo, milestoneId: '', milestone: '', rec: NAMES.ui.schedRecertify, due: '', askedAt: lastSchedule.startedAt || '', waited: 0, overdueDays: 0, lane: 'main', state: 'open', href: '/dashboard/system', kind: 'schedule' });
  if (company.ready && !company.confirmed) { const at = page && page.page && page.page.preparedAt || ''; add({ id: 'overview', type: 'order', text: '公司概覽及里程碑次序待確認', milestoneId: '', milestone: '', rec: '按 Zero 建議次序', due: '', askedAt: at, waited: at ? daysBetween(parseDay(at) || today, today) : 0, overdueDays: 0, lane: 'main', state: 'open', href: '/proofread.html', kind: 'overview' }); }
  const at = t => { const v = new Date(t.askedAt).getTime(); return Number.isFinite(v) ? v : Infinity; };
  const rankOf = t => t.forNextAction ? 7.5 : (TODO_RANK[t.type] ?? 9);
  const sort = (a, b) => (b.overdueDays - a.overdueDays) || (rankOf(a) - rankOf(b)) || (at(a) - at(b));
  const sameTitles = factMergeOn() ? new Set(todo.filter(item => item.kind === 'ask' && item.inputReceivedAt && todo.some(other => other !== item && other.text === item.text)).map(item => item.text)) : new Set();
  for (const item of todo) if (sameTitles.has(item.text)) item.text = NAMES.t('pendingSameTitle', { t: item.text, d: String(item.inputReceivedAt).slice(0, 16).replace('T', ' ') });
  return { todo: todo.sort(sort), snoozed: snoozed.sort(sort) };
}
export function buildTodo(DIR, args) {
  return buildTodoLists(DIR, args).todo;
}
export function snoozedTodo(DIR, args) {
  return buildTodoLists(DIR, args).snoozed;
}
// Founder Desk 待決事項用（唔使計成個監察台）
export function pendingTodo(DIR, now = clockNow()) {
  let state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  if (state.demo === true) state = resolveTimes(state, now);
  else state = applyFounderOps(state, pendingFounderOps(DIR, state));
  const page = readJSON(path.join(DIR.company, 'page.json'), null), confirmed = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const milestones = Array.isArray(state.milestones) && state.milestones.length ? state.milestones : milestonesFromPage(page, confirmed);
  const company = { ready: !!(page || state.company), confirmed: !!(confirmed || (state.intake && state.intake.state === 'complete')) };
  return buildTodo(DIR, { state, milestones, company, page, now }).filter(t => t.lane !== 'brain');
}
export function pendingSnoozed(DIR, now = clockNow()) {
  let state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  if (state.demo === true) state = resolveTimes(state, now);
  else state = applyFounderOps(state, pendingFounderOps(DIR, state));
  const page = readJSON(path.join(DIR.company, 'page.json'), null), confirmed = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const milestones = Array.isArray(state.milestones) && state.milestones.length ? state.milestones : milestonesFromPage(page, confirmed);
  const company = { ready: !!(page || state.company), confirmed: !!(confirmed || (state.intake && state.intake.state === 'complete')) };
  return snoozedTodo(DIR, { state, milestones, company, page, now }).filter(t => t.lane !== 'brain');
}

/* ---------- 「今日要做的事」卡（規劃書 4.1）：文字全部由 FIRST-WEEK.md 供應，伺服器只揀段同入口 ---------- */
const GUIDE_HEAD = { 'AI 未設定': 'noAI', 'AI 工具未設定': 'noAI', '未交資料': 'noCompany', '尚未告訴 Zero': 'noCompany', '待校對公司概覽': 'proofread', '待驗收首份產出': 'accept', '首次訪問未到': 'waitInterview', '待首次訪問': 'firstInterview', '日常': 'daily' };
export function guideCard(text, ds) {
  const sec = {};
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const hd = /^##\s+(.+?)\s*$/.exec(line);
    if (hd) { cur = GUIDE_HEAD[hd[1]] || null; if (cur) sec[cur] = {}; continue; }
    const m = cur && /^-\s*(今日要做的事|入口|不會自動發生)：(.+)$/.exec(line.trim());
    if (m) sec[cur][{ 今日要做的事: 'today', 入口: 'button', 不會自動發生: 'notAuto' }[m[1]]] = m[2].trim();
  }
  // 首次訪問未到但已有待決事項：今日主線係作答，唔係等訪問
  const guide = ds.guide === 'waitInterview' && (ds.todo || []).length ? 'daily' : ds.guide;
  const s = sec[guide];
  if (!s || !s.today) return null;
  const first = type => (ds.todo || []).find(t => t.type === type);
  const mainFirst = (ds.todo || [])[0];
  const dailyHref = mainFirst ? (mainFirst.kind === 'overview' ? '/proofread.html' : mainFirst.kind === 'schedule' ? mainFirst.href : '#/ask/' + mainFirst.id) : '';
  const href = { noAI: '#/setup', noCompany: '#/intake', proofread: '/proofread.html', accept: first('acceptance') ? '#/ask/' + first('acceptance').id : '', waitInterview: '#/request/event', firstInterview: first('interview') ? '#/ask/' + first('interview').id : '', daily: dailyHref }[guide];
  const date = (ds.interviews && ds.interviews.nextOn) || '';
  return { key: guide, today: String(s.today).replace(/\{date\}/g, /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(5, 7)) + ' 月 ' + Number(date.slice(8)) + ' 日' : '稍後'), button: s.button || '', notAuto: s.notAuto || '', href, date };
}

const INBOX_KINDS = ['intake', 'note', 'ask', 'proofread'];
const STALE_MS = 15 * 60000;
function workOf({ shellRuns, ledgerRuns, sample, busy, observed, observeFolders, observePending, tasks, events, now }) {
  const off = observed === null;
  const ob = observed || { state: 'unavailable', sessions: [], problems: [], folders: observeFolders || [], pending: observePending || 0, events: [] };
  const sessions = [];
  for (const r of shellRuns.filter(r => r.state === 'running')) {
    const stale = now.getTime() - new Date(r.lastAt || r.startedAt).getTime() > STALE_MS;
    sessions.push({ key: 'run-' + r.id, host: 'shell', kind: 'run', state: busy && !stale ? 'working' : 'unknown', title: r.label || 'Zero 團隊工作', latestRequest: '',
      lastActiveAt: r.lastAt || r.startedAt, reason: !busy ? 'Zero 團隊程序已停止，等待收尾' : stale ? '15 分鐘內沒有新進度' : 'Zero 團隊正在處理', taskIds: [], moduleIds: r.moduleIds || [], runKind: r.type, brainItem: r.brainItem || '' });
  }
  // 帳本嘅運行中 run：示範照計（虛構）；真資料要外殼程序仍在先算工作中，同一次 run 唔重複計
  for (const r of ledgerRuns.filter(r => r.state === 'running' && (sample || busy) && !sessions.some(x => x.key === 'run-' + r.id))) {
    sessions.push({ key: 'run-' + r.id, host: 'shell', kind: 'run', state: 'working', title: r.label || 'Zero 團隊工作', latestRequest: '', lastActiveAt: r.startedAt || '',
      reason: 'Zero 團隊正在處理', taskIds: Array.isArray(r.taskIds) ? r.taskIds : [], moduleIds: r.moduleIds || [] });
  }
  for (const s of ob.sessions || []) sessions.push({ ...s, moduleIds: [] });
  const proc = shellRuns.find(r => r.state === 'running' && busy && INBOX_KINDS.includes(r.kindRaw) && sessions.some(x => x.key === 'run-' + r.id && x.state === 'working'));
  const inbox = proc ? { processing: true, elapsedSeconds: Math.max(0, Math.round((now.getTime() - new Date(proc.startedAt).getTime()) / 1000)), runId: proc.id } : { processing: false, elapsedSeconds: 0 };
  const linked = new Set(sessions.filter(s => s.state === 'working').flatMap(s => s.taskIds));
  const wtasks = tasks.filter(t => t.column === 'doing' && t.owner !== 'founder').map(t => ({ id: t.id, title: t.title, milestoneId: t.milestoneId, milestone: t.milestone || '', state: linked.has(t.id) ? 'working' : 'idle' }));
  const working = sessions.filter(s => s.state === 'working');
  const subs = working.reduce((a, s) => a + (s.subagents ? s.subagents.active : 0), 0);
  const concurrency = working.length + subs + (inbox.processing ? 1 : 0);
  const who = { founder: 'you', ai: 'ai', shell: 'shell' };
  const evs = events.slice(0, 14).map(e => ({ id: e.id || '', at: e.at, actor: who[e.actor] || 'ai', title: e.title, taskId: (e.relatedIds || []).find(id => tasks.some(t => t.id === id)) || '', observed: false }))
    .concat((ob.events || []).map(e => ({ at: e.at, actor: 'observe', title: e.title, observed: true })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 34);
  const D = NAMES.dash;
  const text = off ? D.observeOffText : ob.state === 'unavailable' ? ((ob.folders || []).length ? D.observeNoneText : D.observeNoFolders)
    : ob.state === 'restricted' ? D.observeRestrictedText
      : D.observeOkText.replace('{n}', (ob.folders || []).length);
  return {
    observe: { state: ob.state, off, text: text + (ob.timedOut ? '（' + D.observeTimedOut + '）' : ''), timedOut: !!ob.timedOut, sources: (ob.folders || []).length, folders: ob.folders || [], pending: ob.pending || 0, readAt: ob.readAt || '' },
    sessions, inbox, tasks: wtasks, events: evs,
    meta: { workingSessions: working.length, activeSubagents: subs, processingCount: inbox.processing ? 1 : 0, concurrency, workLevel: concurrency === 0 ? 0 : concurrency <= 2 ? 1 : concurrency <= 5 ? 2 : 3 }
  };
}

/* ---------- 「你上次嚟之後」：伺服器喺本機打開監察台首頁時寫（唯一覆寫） ---------- */
export function touchLastSeen(DIR, version) {
  const f = path.join(DIR.data, 'founder', 'desk', 'last-seen.json');
  const prev = readJSON(f, null);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ at: localIso(), version }));
  return prev;
}

/* ---------- 交給 Zero 的事（0.40.0）：狀態判斷只在 inputStatus（唯一定義處）；首頁、回饋卡、真實進展頁全部只用它的結果 ----------
   狀態表見 docs/evidence/v0400-ui-2026-11-07/status-table.md；情境驗證見 tests/prototype/core/input-status-test.mjs。
   inputStatus(input, { pack, answers, runs, said })：純函數，不讀檔、不看時間。
   pack ＝這件事的問題包（沒有或已被取代＝null）；answers ＝該包的答案紀錄；runs ＝ status.json 的工作紀錄（最新在前）；said ＝你的原話。
   回傳 { code, tag, button, steps, open, total, answered, packGone, applying, failed, legacy, textless, source }。 */
export const INPUT_VIA = ['event', 'doc', 'debrief', 'adhoc', 'order'];
const hasDetail = i => !!(i.read || i.reason || (Array.isArray(i.effects) && i.effects.some(e => e && (e.before || e.after || e.dueAt))));
export function inputStatus(input, { pack = null, answers = {}, runs = [], said = '' } = {}) {
  const i = input || {}, ref = String(i.id || '').replace(/^in-/, '');
  const mine = (Array.isArray(runs) ? runs : []).filter(r => r && r.kind === 'note' && r.ref === ref);
  const last = mine[0] || null;
  const effects = Array.isArray(i.effects) ? i.effects.filter(Boolean) : [];
  const total = pack && Array.isArray(pack.questions) ? pack.questions.length : 0;
  const answered = pack && total ? pack.questions.filter(q => answers && answers[q.id]).length : 0;
  const open = Math.max(0, total - answered);
  const base = { open, total, answered, packGone: false, applying: false, failed: false, aiWaiting: false, source: i.source === 'chat' ? 'chat' : 'web', textless: !String(said || '').trim() };
  const out = (code, extra) => {
    const tag = { working: 'inStWorking', failed: 'inStFailed', awaiting: 'inStAwaiting', updated: 'inStUpdated', noeffect: 'inStNoEffect' }[code];
    const steps = { working: ['received', 'read'], failed: ['received', 'read'], awaiting: ['received', 'read', 'confirm'], updated: ['received', 'read', 'confirm', 'changed'], noeffect: ['received', 'read', 'why'] }[code];
    const button = { working: 'feedback', failed: 'retry', awaiting: 'answer', updated: 'feedback', noeffect: 'feedback' }[code];
    return { ...base, code, tag, button, steps, legacy: i.status === 'processed' && !hasDetail(i), ...extra };
  };
  if (i.status === 'processed') return out(effects.length ? 'updated' : 'noeffect', effects.length && effects.every(effect => effect.targetKind === 'dated' || effect.targetKind === 'overview') ? { tag: 'inStKeptNewer' } : !effects.length && Number(i.moneyNotRecorded) > 0 ? { tag: 'inStMoneyNotRecorded', moneyNotRecorded: true } : {});
  if (i.status === 'awaitingFounder') {
    if (pack && open > 0) return out('awaiting');
    // 問題包不見了（被取代或移除）或已全部作答但仍在套用：不可叫人作答，狀態回到「Zero 處理中」並寫明原因
    return out('working', pack ? { applying: true } : { packGone: true });
  }
  // 未處理：最新一次工作失敗＝未能處理（可重試）；等 AI 設定＝處理中但標明；其餘處理中
  if (last && last.state === 'failed') return out('failed', { failed: true, runId: last.id || '', error: last.error || '' });
  return out('working', { aiWaiting: !!(last && last.state === 'waiting') });
}
// 只認 data 資料夾內的普通檔：解析後仍在內、本身不是連結、真實路徑也在真實 data 內（不跟隨連結）
const inside = (base, rel) => { try { const r = path.resolve(base, String(rel || '')), rb = path.resolve(base), lst = fs.lstatSync(r); return !lst.isSymbolicLink() && lst.isFile() && r.startsWith(rb + path.sep) && fs.realpathSync(r).startsWith(fs.realpathSync(rb) + path.sep) ? r : null; } catch { return null; } };
export const resolveDataFile = inside;
const fileLabel = f => path.basename(String(f || '')).replace(/^[\d-]+-(?:note-[a-z]+-file|intake|prefill)-\d+-/, '');
// 原話：由已封存的筆記檔讀（檔頭之後、機器欄位之前）；讀不到就回空字串
export function noteText(DIR, input) {
  const f = input && input.file ? inside(DIR.data, input.file) : null;
  if (!f) return '';
  const t = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const body = t.replace(/^kind:[^\n]*\n(?:[a-z]+:[^\n]*\n)*\n?/, '').split(/\n```json/)[0].trim();
  return /^（沒有補充）$/.test(body) ? '' : body.slice(0, 4000);
}
export function inputFiles(DIR, input) {
  const info = Array.isArray(input.fileInfo) ? input.fileInfo : [];
  return (Array.isArray(input.files) ? input.files : []).map((f, n) => {
    const fi = info.find(x => x && x.file === f) || {};
    return { n, name: fileLabel(f), openable: !!inside(DIR.data, f), hasText: !!(fi.text && inside(DIR.data, fi.text)), url: fi.url || '', readOn: fi.readOn || '', gkind: fi.kind || '', convert: fi.convert || '' };
  });
}
const effectView = e => ({ text: String(e.change || ''), before: e.before || '', after: e.after || '', targetKind: e.targetKind || '', targetId: e.targetId || '', dueAt: e.dueAt || '',
  href: e.targetKind === 'assumption' && e.targetId ? '/dashboard/path' : (e.targetKind === 'milestone' || e.targetKind === 'station') && e.targetId ? '/dashboard/path#station-' + e.targetId : '' });
// 單件視圖：detail＝回饋卡（含原話、問題及答案）；否則列表（首頁、真實進展頁）
// ctx：{ packs（listPacks 結果）, runs（status.json runs）, loadPack, loadAnswers }
export function inputView(DIR, input, ctx = {}, { detail = false } = {}) {
  const lp = input.packId ? (ctx.packs || []).find(p => p.id === input.packId) : null;
  const full = detail && input.packId && ctx.loadPack ? ctx.loadPack(DIR, input.packId) : null;
  const answers = detail && input.packId && ctx.loadAnswers ? (ctx.loadAnswers(DIR, input.packId).answers || {}) : {};
  const pack = detail ? full : lp ? { questions: Array.from({ length: lp.total }, (_, k) => ({ id: 'q' + k })) } : null;
  const ans = detail ? answers : lp ? Object.fromEntries(Array.from({ length: lp.answered }, (_, k) => ['q' + k, true])) : {};
  const said = detail ? noteText(DIR, input) : (input.via === 'doc' ? '' : 'x');
  const status = inputStatus(input, { pack, answers: ans, runs: ctx.runs, said });
  const effects = (Array.isArray(input.effects) ? input.effects : []).filter(Boolean).map(effectView);
  const v = { id: input.id, via: input.via || '', source: status.source, receivedAt: input.receivedAt || '', date: input.eventDate || '', title: input.title || '', summary: input.summary || '', packId: input.packId || '',
    status, files: inputFiles(DIR, input), effects, linkErrors: Array.isArray(input.linkErrors) ? input.linkErrors.map(x => ({ url: String(x.url || ''), kind: String(x.kind || ''), reason: String(x.reason || '') })) : [],
    unreadable: Array.isArray(input.unreadable) ? input.unreadable.map(u => ({ file: String(u.file || ''), reason: String(u.reason || '') })) : [],
    read: input.read && typeof input.read === 'object' ? { summary: String(input.read.summary || ''), highlights: (Array.isArray(input.read.highlights) ? input.read.highlights : []).map(h => ({ text: String(h.text || ''), page: h.page == null ? '' : h.page, file: String(h.file || '') })) } : null,
    reason: input.reason || '', moneyNotRecorded: Number(input.moneyNotRecorded) > 0 };
  if (detail) {
    const qa = full && Array.isArray(full.questions) ? full.questions.map(q => { const a = answers[q.id]; return { ask: String(q.ask || q.about || ''), answer: a ? String(Array.isArray(a.value) ? a.value.join('、') : a.value) : '', at: a ? a.at || '' : '', suggest: String(q.value || '') }; }) : [];
    v.said = said; v.qa = qa; v.confirmedAt = qa.map(x => x.at).filter(Boolean).sort().pop() || ''; v.packTitle = full ? full.title || '' : '';
    v.compare = (Array.isArray(input.compare) ? input.compare : []).slice(0, 3).map(item => {
      const row = item && typeof item === 'object' ? item : {}, past = Array.isArray(row.past) ? row.past : [];
      return { now: String(row.now == null ? '' : row.now), past: past.slice(0, 3).map(old => {
        const source = old && typeof old === 'object' ? old : {};
        return { quote: String(source.quote == null ? '' : source.quote), from: String(source.from == null ? '' : source.from) };
      }), note: String(row.note == null ? '' : row.note) };
    });
    // 回饋卡第二步「提到的對象」：原話、標題及 Zero 摘要內出現的名單對象（完整名稱或別名；最長名稱優先；已合併者不單獨列）
    try { const actors = (((readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}).company || {}).actors) || []; v.mentioned = actorsMentioned(actors, [said, input.title, input.summary].filter(Boolean).join(' ')).map(a => ({ name: a.name, org: a.org || '' })).slice(0, 6); } catch { v.mentioned = []; }
  }
  return v;
}
export const inputList = (DIR, state, ctx = {}) => (Array.isArray(state.inputs) ? state.inputs : []).filter(i => i && INPUT_VIA.includes(i.via))
  .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).map(i => inputView(DIR, i, ctx));
// 「現在開工」會做甚麼（首頁 Zero 近期工作卡）：未讀件數＋下一個對外動作；伺服器只讀算出
export function runNowPreview(ds, { busy = false, stopped = '' } = {}) {
  // 只計「最近交給 Zero 的事」清單會顯示的輸入（每週訪問的文字答案等不在清單內，不計入）
  const listed = new Set(((ds.inputs && ds.inputs.all) || []).map(x => x && x.id));
  const unread = ((ds.inputs && ds.inputs.unprocessed) || []).filter(x => listed.has(x.id)).length;
  const na = ds.nextAction, next = na && na.text && !na.missing && !na.cancelledAt ? String(na.text) : '';
  return { unread, next, canRun: !!(ds.ai && ds.ai.ready) && !busy && !stopped, busy: !!busy, noAI: !(ds.ai && ds.ai.ready), stopped: String(stopped || '') };
}
