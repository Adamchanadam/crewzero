// startup-os 營運監察台：畫面資料（唯一計算處）。伺服器 GET /api/dashboard 回傳呢個函數嘅結果，頁面只負責畫。
// 兩個來源合併，頁面唔分「示範」定「真實」：
//   (a) ledger/state.json（帳本；有就用，欄位逐項合併，冇嘅欄位當空）
//   (b) 原型現有檔：company/page.json（公司概覽）、ledger/confirmed.json（成頁確認）、asks/（問題包）、ledger/status.json（AI 工作）、adapter-cert.json（AI 設定）
// 示範帳本（state.demo = true）嘅時間寫成相對值（例如 "@-3d"、"@+5d 21:00"、"@wed"），讀嘅時候按今日推算，示範資料唔會過期。
import fs from 'node:fs';
import path from 'node:path';
import { NAMES, readJSON, listPacks, loadAnswers, localIso, pad, clockNow } from './ask-lib.mjs';
import { loadBrain } from './brain-lib.mjs';
import { rhythmOf, nextRunAt } from './rhythm-lib.mjs';

const DAY = 86400000;
// 作業系統排程（MVP 規格第 2 節第 3 項）：登記標記 ledger/schedule.json；登記時嘅節奏同帳本而家嘅節奏唔同＝須重新登記
export const scheduleMark = DIR => readJSON(path.join(DIR.ledger, 'schedule.json'), null);
export const scheduleStale = (mark, r) => !!(mark && r && (mark.runTime !== r.runTime || (mark.cadence || 'daily') !== (r.runCadence || 'daily')));
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / DAY);
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
  return list.filter(a => a && (a.label || a.value)).map((a, i) => ({ id: 'H' + (i + 1), pageRef: a.id || '', text: String(a.label || a.value), cheapestTest: String((a.tentative && a.tentative.test) || a.test || ''), grade: 'guess', status: 'open', milestoneIds: [] }));
}

/* ---------- 主函數 ---------- */
export function dashboardState(DIR, extra = {}) {
  const now = extra.now || clockNow();
  const today = dayStart(now);
  let state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  const sample = state.demo === true;
  if (sample) state = resolveTimes(state, now);
  const page = readJSON(path.join(DIR.company, 'page.json'), null);
  const confirmed = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const status = readJSON(path.join(DIR.ledger, 'status.json'), { runs: [] });
  const cert = extra.cert || null;

  /* 公司 */
  const co = { ...(page && page.company || {}), ...(state.company || {}) };
  const company = { name: co.name || '', initials: co.initials || '', oneLiner: co.oneLiner || '', ready: !!(page || state.company), confirmed: !!(confirmed || (state.intake && state.intake.state === 'complete')) };
  const values = page ? registryValues(page, confirmed) : {};
  const goalRow = page && page.glance && (page.glance.rows || []).find(r => r.plan === 'G1');
  const nextRow = page && page.glance && (page.glance.rows || []).find(r => r.plan === 'G5');
  const goals = state.goals || { quarter: goalRow ? { text: String(values[goalRow.id] ?? goalRow.value), endsOn: goalRow.due ? String(values[goalRow.due.id] ?? goalRow.due.value ?? '') : '' } : null };
  const nextAction = (state.company && state.company.nextExternalAction) || (nextRow ? { text: String(values[nextRow.id] ?? nextRow.value), milestoneId: confirmed && confirmed.nextActionMilestone || nextRow.flagTo || '' } : null);

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

  /* 問題包 → 待你處理（同 Founder Desk 待決事項同一份清單） */
  const packs = listPacks(DIR).filter(p => p.open > 0);
  const decisions = Array.isArray(state.decisions) ? state.decisions : [];
  const msTitle = id => (milestones.find(m => m.id === id) || {}).short || '';
  const todo = buildTodo(DIR, { state, milestones, company, page, now });

  /* 工作（看板） */
  const COL = { planned: 'todo', active: 'doing', waiting: 'waiting', blocked: 'blocked', review: 'review', done: 'done', cancelled: null };
  const rawTasks = Array.isArray(state.tasks) ? state.tasks : [];
  const byTask = Object.fromEntries(rawTasks.map(t => [t.id, t]));
  const openPackIds = new Set(packs.map(p => p.id));
  const founderDone = t => t.status === 'done' && (t.owner !== 'founder' || t.confirmedBy === 'founder');
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
    if (t.owner === 'founder' && t.dueAt) soon.push({ at: t.dueAt, title: t.title, self: true });
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
    if (t.owner === 'founder' && t.status === 'done' && t.confirmedBy !== 'founder') col = 'review';
    const wait = waitOf(t), why = whyOf(t);
    return { id: t.id, title: t.title, status: t.status, column: col, milestoneId: t.milestoneId || '', milestone: msTitle(t.milestoneId), adhoc: t.adhoc === true || (!t.milestoneId && !t.capabilityId && t.owner !== 'founder'), capability: !!t.capabilityId,
      owner: t.owner === 'founder' ? 'founder' : 'ai', dueAt: t.dueAt || '', scenarioId: t.scenarioId || '', prepFor: [].concat(t.prepFor || []).map(id => (byTask[id] || {}).title).filter(Boolean),
      wait: wait && !wait.done ? wait : null, ready: !(wait && !wait.done) && !founderDone(t) && col !== 'review', why,
      teammate: t.owner === 'founder' ? '你' : ((state.teammates || []).find(x => x.id === t.teammateId) || {}).name || '', next: t.next || '', updatedAt: t.updatedAt || '', packId: t.packId || '', waitingFor: t.waitingFor || '', artifact: t.artifactTitle || '' };
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
  const brain = loadBrain(DIR, { now, runs: status.runs || [], packs });
  // 結果卡意見事件：標題用現時顯示版嘅卡名（帳本原文唔改；卡名改寫過都一致）
  const fbTitle = e => { const f = e.type === 'input' && /^你對「.*」的意見：/.test(String(e.title || '')) && brain && brain.feedback && brain.feedback[(e.relatedIds || [])[0]];
    return f && f.title ? { ...e, title: '你對「' + (f.itemName ? f.itemName + '：' : '') + f.title + '」的意見：' + String(e.title).replace(/^你對「.*」的意見：/, '') } : e; };
  const events = (Array.isArray(state.events) ? state.events : []).map(fbTitle).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  // 只記錄（冇開 AI）嘅外殼工作唔算 AI 事件：佢哋已經記咗做創辦人輸入
  for (const r of shellRuns) if ((r.state === 'ended' || r.state === 'failed') && r.aiStarted) events.push({ id: 'ev-' + r.id, at: r.endedAt || r.startedAt, actor: 'ai', type: 'run', title: (r.state === 'failed' ? 'AI 工作未完成：' : 'AI 完成工作：') + (r.label || ''), relatedIds: [r.id], moduleIds: ['ai-week', 'artifacts'] });
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const businessEvents = events.filter(e => !['run', 'health', 'capability'].includes(e.type));

  /* 輸入同訪問 */
  const inputs = Array.isArray(state.inputs) ? state.inputs : [];
  const inboxFiles = fs.existsSync(DIR.inbox) ? fs.readdirSync(DIR.inbox).filter(f => !f.startsWith('.')) : [];
  const unprocessed = inputs.filter(i => i.status === 'unprocessed').map(i => ({ id: i.id, title: i.title || '', at: i.receivedAt }));
  // 預填同放入文件嘅附件跟住說明檔，唔另計
  for (const f of inboxFiles) if (!/-(?:prefill|note-doc-file)-\d+-/.test(f) && !unprocessed.some(u => u.title === f)) unprocessed.push({ id: f, title: /-intake(\.md|-)/.test(f) ? '公司資料（交資料）' : /-prefill\.md$/.test(f) ? '由文件預填（AI 正在讀）' : /-note-doc\.md$/.test(f) ? '文件（等 AI 閱讀）' : /-note-/.test(f) ? '你的要求（等 AI 處理）' : /-feedback-/.test(f) ? '你對生意大腦的意見' : '文件', at: '' });
  const awaiting = inputs.filter(i => i.status === 'awaitingFounder').map(i => ({ id: i.id, title: i.title || '', question: i.awaitingFounderText || '', packId: i.packId || '', at: i.receivedAt }));
  const recentInputs = inputs.filter(i => i.status === 'processed').sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 3).map(i => ({ id: i.id, title: i.title || '', at: i.receivedAt, effects: (i.effects || []).map(e => e.change).filter(Boolean) }));
  // 輸入頁「真實事件」欄：最近記錄嘅真實事件（任何狀態）同各自收據
  const eventInputs = inputs.filter(i => i.eventDate && i.via !== 'doc').sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 4).map(i => ({ id: i.id, title: i.title || '', at: i.receivedAt, date: i.eventDate, status: i.status, packId: i.packId || '', effects: (i.effects || []).map(e => e.change).filter(Boolean) }));
  const interviews = state.interviews || null;
  const rhythm = state.company && state.company.rhythm || null;
  // 排程狀態（系統頁）：邊個負責按時叫 AI 開工、上次實際觸發、下次開工；作業系統排程未安裝就冇「下次」
  const schedMark = sample ? null : scheduleMark(DIR);
  const scheduler = sample ? 'demo' : extra.scheduler === 'sim' ? 'sim' : schedMark ? 'os' : 'none';
  const lastSched = (Array.isArray(state.runs) ? state.runs : []).filter(r => r.trigger === 'schedule').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).pop() || null;
  const nextAt = scheduler !== 'none' ? nextRunAt(rhythmOf(state), now) : null;
  const st = extra.schedStatus || null;
  const osSched = scheduler === 'os' ? { name: schedMark.name || '', cadence: schedMark.cadence || 'daily', runTime: schedMark.runTime || '', registeredAt: schedMark.registeredAt || '', startWhenAvailable: st && st.registered ? !!st.startWhenAvailable : !!schedMark.startWhenAvailable,
    stale: scheduleStale(schedMark, rhythmOf(state)), osNext: (st && st.next) || schedMark.nextRunAt || '', osLast: (st && st.last) || '', osLastResult: st && st.last ? st.lastResult : null, missing: !!(st && st.ok && !st.registered) } : null;
  // 節奏改咗但未重新登記：作業系統仍然按舊時間叫，「下次開工」照排程器讀回（或者登記時）嘅時間
  const osNextAt = osSched && osSched.stale && osSched.osNext ? new Date(osSched.osNext) : null;
  const rhythmInfo = { scheduler, os: osSched, nextRunAt: osNextAt && !isNaN(osNextAt) ? localIso(osNextAt) : nextAt ? localIso(nextAt) : '', lastScheduleAt: lastSched ? lastSched.startedAt : '', lastSchedule: lastSched ? { state: lastSched.state, skipReason: lastSched.skipReason || '', ending: lastSched.ending || '', label: lastSched.label || '' } : null };

  /* 未來兩星期日程 */
  const horizon = new Date(today.getTime() + 14 * DAY);
  const sched = [];
  const add = (date, kind, text, extra2) => { const d = parseDay(date); if (!d) return; if (d > horizon) return; sched.push({ date: ymd(d), kind, text, overdue: d < today, ...(extra2 || {}) }); };
  if (interviews && interviews.nextOn) add(interviews.nextOn, 'interview', '每週訪問', { href: todo.find(t => t.type === 'interview')?.href || '' });
  for (const m of milestones) {
    if (m.pathStatus === 'retired' || m.state === 'done') continue;
    if (m.trial && m.trial.until && !m.trial.verdict) add(m.trial.until, 'trial', '試行到期：' + m.short, { milestoneId: m.id });
    if (m.targetDate && m.pathStatus !== 'proposed') add(m.targetDate, 'target', '目標日：' + m.short + (m.targetDateTentative ? '（暫定）' : ''), { milestoneId: m.id });
  }
  if (goals && goals.month && goals.month.endsOn) add(goals.month.endsOn, 'target', '短期目標檢查：' + goals.month.text);
  // 你嘅現實行動（有日子嘅）
  for (const t of tasks) if (t.owner === 'founder' && t.dueAt && t.column !== 'done' && t.column !== 'review') add(t.dueAt, 'action', t.title + (/T\d{2}:\d{2}/.test(t.dueAt) ? ' ' + t.dueAt.slice(11, 16) : ''), { milestoneId: t.milestoneId });
  for (const t of todo) if (t.due) add(t.due, 'decision', '決定期限：' + t.text, { href: t.href });
  if (rhythm && rhythm.runTime && scheduler !== 'none') {
    const [hh, mm] = rhythm.runTime.split(':').map(Number);
    const next = new Date(now.getTime()); next.setHours(hh, mm, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    sched.push({ date: ymd(next), kind: 'ai', text: `AI 按節奏開工 ${rhythm.runTime}`, overdue: false });
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
  if (parallel.over) health.warnings.push('有 ' + parallel.count + ' 站同時進行，超過兩站上限');
  else if (!parallel.confirmed) health.warnings.push('第二站「' + second.short + '」未經你確認已經開始');
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
    quarter: { done: counted.filter(m => m.state === 'done').length, total: counted.length, text: goals && goals.quarter ? goals.quarter.text : '', endsOn: goals && goals.quarter ? goals.quarter.endsOn : '' },
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
    since = { at: last.at, runs: after.length, withOutput: after.filter(r => r.artifacts > 0 || (r.ending === 'artifact')).length, waiting: todo.length, latest: (businessEvents.find(e => new Date(e.at).getTime() > t) || {}).title || '' };
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
  const guide = !cert ? 'noAI' : !company.ready ? 'noCompany' : !company.confirmed ? 'proofread' : firstAccept ? 'accept' : !ivDone ? 'firstInterview' : 'daily';

  return {
    ok: true, sample, now: localIso(now), today: ymd(today), guide, firstWeekDone: ivDone,
    company, goals, nextAction, metrics, since, pathTouched,
    ai: { ready: !!cert, label: cert ? cert.label : '', certifiedAt: cert ? cert.certifiedAt : '', busy: !!extra.busy || !!running, running: running ? { label: running.label, startedAt: running.startedAt } : null },
    lines, orderUnconfirmed, milestones, assumptions, options, todo, schedule: sched, tasks, parallel,
    brain,
    teammates: teammates.map(t => ({ ...t, milestones: (t.milestoneIds || []).map(msTitle).filter(Boolean), activity: t.lifecycle === 'planned' ? 'not_started' : tasks.some(x => x.teammate === t.name && workingTasks.has(x.id)) ? 'working' : tasks.some(x => x.teammate === t.name && x.column === 'doing') ? 'doing' : tasks.some(x => x.teammate === t.name && (x.column === 'waiting' || x.column === 'review')) ? 'waiting' : 'idle' })),
    capabilities: Array.isArray(state.capabilities) ? state.capabilities : [],
    events: events.slice(0, 400), recent: businessEvents.slice(0, 8),
    inputs: { unprocessed, awaiting, recent: recentInputs, events: eventInputs },
    interviews, rhythm, rhythmInfo, tele: teleOf(runs, rhythm, rhythmInfo, now), sim: extra.sim || null, runs: runs.slice(0, 20), health, activity, deck, work,
    artifacts: (Array.isArray(state.artifacts) ? state.artifacts : []).concat(shellRuns.filter(r => r.artifacts).map(r => ({ title: r.label, runId: r.id, at: r.endedAt || r.startedAt, milestoneId: '' }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6)
  };
}

/* ---------- 即時微動畫用嘅真數據（規劃書 4.7 (3)）：下次排程 AI 工作、今日 AI 啟動次數、今日用時同費用 ----------
   頁面每秒用本機時鐘重算倒數，唔打網路；冇費用紀錄就唔寫費用。 */
function teleOf(runs, rhythm, rhythmInfo, now) {
  const day = localIso(now).slice(0, 10);
  const today = runs.filter(r => String(r.startedAt || '').slice(0, 10) === day && r.aiStarted !== false && r.state !== 'skipped');
  const minutes = Math.round(today.reduce((a, r) => a + Math.max(0, (new Date(r.endedAt || now).getTime() - new Date(r.startedAt).getTime()) / 60000), 0));
  const costed = today.filter(r => r.aiCost && typeof r.aiCost.usd === 'number');
  return { nextRunAt: (rhythmInfo && rhythmInfo.nextRunAt) || '', starts: today.length, cap: (rhythm && rhythm.aiStartsPerDay) || 0, minutes, usd: costed.length ? Math.round(costed.reduce((a, r) => a + r.aiCost.usd, 0) * 100) / 100 : null };
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
export function buildTodo(DIR, { state, milestones, company, page, now }) {
  const today = dayStart(now);
  const packs = listPacks(DIR).filter(p => p.open > 0);
  const decisions = Array.isArray(state.decisions) ? state.decisions : [];
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const msTitle = id => ((milestones || []).find(m => m.id === id) || {}).short || '';
  const todo = [];
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
    const brain = full.brainItem || (full.debate ? 'wargame' : '');
    todo.push({ id: p.id, type, text: full.todoText || d.title || p.title, milestoneId: full.milestoneId || d.milestoneId || '', milestone: msTitle(full.milestoneId || d.milestoneId), rec, due, askedAt, waited, overdueDays, ...(brain ? { brain } : {}),
      state: overdueDays > 0 ? 'overdue' : 'open', count: p.open, href: '/#/ask/' + p.id, kind: 'ask' });
  }
  // 排程節奏改咗（交資料第 9 題或者系統頁）：放一張「重新登記排程」提示卡，按下去系統頁（或者喺對話輸入「重新登記排程」）
  const sm = state.demo === true ? null : scheduleMark(DIR);
  if (scheduleStale(sm, rhythmOf(state))) { const r = rhythmOf(state); todo.push({ id: 'schedule-stale', type: 'order', text: NAMES.t('schedStaleTodo', { t: r.runTime }), milestoneId: '', milestone: '', rec: NAMES.ui.schedReRegister, due: '', askedAt: '', waited: 0, overdueDays: 0, state: 'open', href: '/dashboard/system', kind: 'schedule' }); }
  if (company.ready && !company.confirmed) { const at = page && page.page && page.page.preparedAt || ''; todo.push({ id: 'overview', type: 'order', text: '公司概覽及里程碑次序待確認', milestoneId: '', milestone: '', rec: '按 AI 建議次序', due: '', askedAt: at, waited: at ? daysBetween(parseDay(at) || today, today) : 0, overdueDays: 0, state: 'open', href: '/proofread.html', kind: 'overview' }); }
  const at = t => { const v = new Date(t.askedAt).getTime(); return Number.isFinite(v) ? v : Infinity; };
  return todo.sort((a, b) => (b.overdueDays - a.overdueDays) || ((TODO_RANK[a.type] ?? 9) - (TODO_RANK[b.type] ?? 9)) || (at(a) - at(b)));
}
// Founder Desk 待決事項用（唔使計成個監察台）
export function pendingTodo(DIR, now = clockNow()) {
  let state = readJSON(path.join(DIR.ledger, 'state.json'), null) || {};
  if (state.demo === true) state = resolveTimes(state, now);
  const page = readJSON(path.join(DIR.company, 'page.json'), null), confirmed = readJSON(path.join(DIR.ledger, 'confirmed.json'), null);
  const milestones = Array.isArray(state.milestones) && state.milestones.length ? state.milestones : milestonesFromPage(page, confirmed);
  const company = { ready: !!(page || state.company), confirmed: !!(confirmed || (state.intake && state.intake.state === 'complete')) };
  return buildTodo(DIR, { state, milestones, company, page, now });
}

/* ---------- 「今日要做的事」卡（規劃書 4.1）：文字全部由 FIRST-WEEK.md 供應，伺服器只揀段同入口 ---------- */
const GUIDE_HEAD = { 'AI 未設定': 'noAI', '未交資料': 'noCompany', '待校對公司概覽': 'proofread', '待驗收首份產出': 'accept', '待首次訪問': 'firstInterview', '日常': 'daily' };
export function guideCard(text, ds) {
  const sec = {};
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const hd = /^##\s+(.+?)\s*$/.exec(line);
    if (hd) { cur = GUIDE_HEAD[hd[1]] || null; if (cur) sec[cur] = {}; continue; }
    const m = cur && /^-\s*(今日要做的事|入口|不會自動發生)：(.+)$/.exec(line.trim());
    if (m) sec[cur][{ 今日要做的事: 'today', 入口: 'button', 不會自動發生: 'notAuto' }[m[1]]] = m[2].trim();
  }
  const s = sec[ds.guide];
  if (!s || !s.today) return null;
  const first = type => (ds.todo || []).find(t => t.type === type);
  const href = { noAI: '#/setup', noCompany: '#/intake', proofread: '/proofread.html', accept: first('acceptance') ? '#/ask/' + first('acceptance').id : '', firstInterview: first('interview') ? '#/ask/' + first('interview').id : '', daily: (ds.todo || [])[0] ? (ds.todo[0].kind === 'overview' ? '/proofread.html' : '#/ask/' + ds.todo[0].id) : '' }[ds.guide];
  return { key: ds.guide, today: s.today, button: s.button || '', notAuto: s.notAuto || '', href, date: (ds.interviews && ds.interviews.nextOn) || '' };
}

const INBOX_KINDS = ['intake', 'note', 'ask', 'proofread'];
const STALE_MS = 15 * 60000;
function workOf({ shellRuns, ledgerRuns, sample, busy, observed, observeFolders, observePending, tasks, events, now }) {
  const off = observed === null;
  const ob = observed || { state: 'unavailable', sessions: [], problems: [], folders: observeFolders || [], pending: observePending || 0, events: [] };
  const sessions = [];
  for (const r of shellRuns.filter(r => r.state === 'running')) {
    const stale = now.getTime() - new Date(r.lastAt || r.startedAt).getTime() > STALE_MS;
    sessions.push({ key: 'run-' + r.id, host: 'shell', kind: 'run', state: busy && !stale ? 'working' : 'unknown', title: r.label || 'AI 團隊工作', latestRequest: '',
      lastActiveAt: r.lastAt || r.startedAt, reason: !busy ? 'AI 團隊程序已停止，等待收尾' : stale ? '15 分鐘內沒有新進度' : 'AI 團隊正在處理', taskIds: [], moduleIds: r.moduleIds || [], runKind: r.type, brainItem: r.brainItem || '' });
  }
  // 帳本嘅運行中 run：示範照計（虛構）；真資料要外殼程序仍在先算工作中，同一次 run 唔重複計
  for (const r of ledgerRuns.filter(r => r.state === 'running' && (sample || busy) && !sessions.some(x => x.key === 'run-' + r.id))) {
    sessions.push({ key: 'run-' + r.id, host: 'shell', kind: 'run', state: 'working', title: r.label || 'AI 團隊工作', latestRequest: '', lastActiveAt: r.startedAt || '',
      reason: 'AI 團隊正在處理', taskIds: Array.isArray(r.taskIds) ? r.taskIds : [], moduleIds: r.moduleIds || [] });
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
    : ob.state === 'restricted' ? D.observeRestrictedText + (ob.problems || []).join('；')
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
