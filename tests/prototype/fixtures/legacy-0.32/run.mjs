// startup-os 校對原型：外殼。每次由本機伺服器叫起，創辦人唔使理。
// 次序：登記新回覆 → 機械套用（唔使 AI）→ 寫紀錄 → 有 AI 工作先開 AI → 核對收據 → AI 出嘅新問題包核對後放上 Founder Desk → 寫狀態。
// 一次處理一組回覆（公司概覽嘅全部回覆，或者一份問題包回覆）；做完伺服器見仲有就再叫。
// AI 只喺 data/sandbox/<run> 入面工作；套用、核對、搬檔、紀錄全部由呢個程式做。
// 開 AI 之前一定核對 AI 工具認證（host-lib.mjs）；未認證就只做機械套用，run 等緊 AI 設定，設定好之後自動續做。
import fs from 'node:fs';
import path from 'node:path';
import { certified, execute, roleModel, readsWeb } from './host-lib.mjs';
import { checkCompanyPage, normalizePage, ROW_PLANS, RULE_PLANS, CELLS } from './company-page-check.mjs';
import { scanOutput, fixOutput } from './style-check.mjs';
import { loadBrain, cardText, brainSource, brainFile, pipelineOf, ledgerAssumptions } from './brain-lib.mjs';
import { folderHash } from './folder-hash.mjs';
import { MACHINE, ORIGINAL, sha, scanJSON, scanText, sameShape, headings, mergeRewriteJSON, mergeRewriteMd, deCodeInfo, deCodeJSONInfo, folderAssumptions, displayDir, displayPath, displayIndex } from './plain-lib.mjs';
import { formatFor, passesFor, LEVELS, HARD_CAP, ADOPT_OPTS, SEATS, listMatches, readMatchFile, matchDir, isLegacy, pendingMatches, checkBlue, checkRed, checkRebuttal, checkJudge, checkRejudge, checkStrengthen, checkReattackRed, checkReattackJudge, responsePack, adoptionPacks, evidencePack } from './debate-lib.mjs';
import { fileURLToPath } from 'node:url';
import { pad, localIso, stamp, readJSON, writeJSON, fnv, dataDirs, appendLog, preparePacks, placePacks, loadPack, loadAnswers, listPacks, openUnknowns, sameThing, UNKNOWN_DAYS, MAX_PER_PACK, clockNow, INTAKE_QUESTIONS, NAMES } from './ask-lib.mjs';
import { rhythmOf, rhythmFromText, addDays, nextWeekday, isWeekday } from './rhythm-lib.mjs';
import { PREFILL_Q, docTexts, checkPrefill } from './prefill-lib.mjs';
import { milestonesFromPage, assumptionsFromPage, depthOf } from './dash-lib.mjs';
const U = NAMES.ui;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = dataDirs(ROOT);
const STATUS = path.join(DIR.ledger, 'status.json');
const CONFIRMED = path.join(DIR.ledger, 'confirmed.json');
const LOCK = path.join(DIR.ledger, '.lock');
const RETRY = path.join(DIR.ledger, 'retry-requested');
const LOG = path.join(DIR.ledger, 'runs.log');
// 帳本（原型）：監察台讀嘅工作同事件；冇就新建（只記工作同事件，其餘欄位唔理）
const STATE = path.join(DIR.ledger, 'state.json');

const log = msg => fs.appendFileSync(LOG, `[${localIso()}] ${msg}\n`);
// 公司概覽清單區段：舊資料寫成 { title, items } 都照讀（新資料由 company-page-check 規整）
const listOf = x => Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : x && typeof x === 'object' && (x.title || x.label || x.id) ? [x] : [];
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/* ---------- 一次只准一個 run ---------- */
function takeLock() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age > 20 * 60 * 1000) { fs.rmSync(LOCK, { force: true }); return takeLock(); }
    return false;
  }
}
const dropLock = () => fs.rmSync(LOCK, { force: true });

/* ---------- 狀態（頁面讀呢個） ---------- */
function saveRun(run) {
  const st = readJSON(STATUS, { runs: [] });
  const i = st.runs.findIndex(r => r.id === run.id);
  if (i >= 0) st.runs[i] = run; else st.runs.unshift(run);
  st.runs = st.runs.slice(0, 20);
  st.updatedAt = localIso();
  writeJSON(STATUS, st);
}
function step(run, key, label, state, detail) {
  let s = run.steps.find(x => x.key === key);
  if (!s) { s = { key }; run.steps.push(s); }
  Object.assign(s, { label, state, at: localIso(), detail: detail || '' });
  saveRun(run);
}
function finish(run, state, error) {
  run.state = state; run.endedAt = localIso();
  if (error) run.error = error;
  saveRun(run);
  log(`${run.id} ${state}${error ? ' - ' + error : ''}`);
}
function archive(files) {
  const now = clockNow(), month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  fs.mkdirSync(path.join(DIR.archive, month), { recursive: true });
  for (const f of files) fs.renameSync(path.join(DIR.replies, f), path.join(DIR.archive, month, f));
}

/* ---------- 帳本（原型）：工作、事件 ---------- */
function loadState() { return readJSON(STATE, null) || { schemaVersion: 1, tasks: [], events: [] }; }
function saveState(s) { s.revision = (s.revision || 0) + 1; s.updatedAt = localIso(); s.updatedBy = 'shell'; writeJSON(STATE, s); }
function upsertTask(t) {
  const s = loadState(); s.tasks = s.tasks || [];
  const i = s.tasks.findIndex(x => x.id === t.id);
  if (i >= 0) s.tasks[i] = { ...s.tasks[i], ...t, updatedAt: localIso() }; else s.tasks.push({ ...t, updatedAt: localIso() });
  saveState(s);
}
function getTask(id) { return (loadState().tasks || []).find(t => t.id === id) || null; }
function addEvent(e) { const s = loadState(); s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), relatedIds: [], ...e }); saveState(s); }
/* ---------- 帳本種子（規劃書 3.1 成頁確認、附錄 A）：里程碑同假設清單由已確認公司概覽寫入帳本，之後每次確認只更新文字同次序 ----------
   進度（state、doneAt、doneEvidence）同假設級別（grade、status、sourceId）只由你確認真實事件時寫入，同步永遠唔覆寫。
   舊安裝（已確認公司概覽但帳本未有里程碑）喺下一次工作開始時自動補種子。換咗新公司概覽：同名嘅站同假設先保留進度。 */
const MS_KEEP = ['state', 'doneAt', 'doneEvidence', 'doneInputId', 'watchItems', 'trial', 'retiredReason', 'retiredDecisionId', 'supersededBy', 'parallelConfirmedAt'];
const AS_KEEP = ['grade', 'status', 'sourceId', 'changedAt'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
function syncLedger() {
  const page = loadPage(), c = readJSON(CONFIRMED, null);
  if (!page || !c || c.pageId !== page.page.id) return false;
  const s = loadState(), same = s.ledgerFrom === page.page.id;
  // 唔係由公司概覽同步嚟嘅帳本（例如示範帳本，有試行、已撤、觀察項）唔郁
  if (s.demo === true || ((s.milestones || []).length && !s.ledgerFrom)) return false;
  const oldMs = Object.fromEntries((s.milestones || []).map(m => [m.id, m]));
  const keepOf = m => { const o = oldMs[m.id]; return o && (same || o.short === m.short) ? o : null; };
  // 你答過嘅深化答案（founderText）保留，深度按規則重算（3.3）；真事／工作以你成頁確認時嘅判斷為準
  const founder = {};
  for (const pm of page.path.milestones) { const o = keepOf(pm); if (o) founder[pm.id] = (o.depthAnswers || []).map(a => a && typeof a === 'object' ? { text: a.founderText || '', adopted: !!a.adopted } : { text: '' }); }
  const kinds = c.kinds || {};
  const before = JSON.stringify([s.milestones || [], (s.company || {}).assumptions || [], s.intake || {}, s.tasks || [], (s.company || {}).nextExternalAction || null]);
  const ms = milestonesFromPage(page, c, { founder }).map(m => { const o = keepOf(m), kind = kinds[m.id] || m.kind || 'real'; return o ? { ...m, kind, ...pick(o, MS_KEEP) } : { ...m, kind }; });
  // 經試行採用、唔喺公司概覽嘅站（3.12）：同步時照留
  for (const o of s.milestones || []) if (o.trial && !ms.some(m => m.id === o.id)) ms.push(o);
  // 你喺訪問確認撤回嘅站、改咗嘅目標日：同步時照留
  for (const m of ms) { const o = keepOf(m); if (o && o.pathStatus === 'retired' && o.retiredDecisionId) m.pathStatus = 'retired'; if ((s.targetOverride || {})[m.id]) m.targetDate = s.targetOverride[m.id]; }
  const oldAs = (s.company && s.company.assumptions) || [];
  // 生意體檢寫嘅最便宜測試：公司概覽冇寫測試就照留（公司概覽有就以公司概覽為準）
  const as = assumptionsFromPage(page).map(a => { const o = oldAs.find(x => same ? x.pageRef === a.pageRef : x.text === a.text); return !o ? a : { ...a, ...pick(o, AS_KEEP), ...(o.cheapestTestBy === 'checkup' && !String(a.cheapestTest || '').trim() ? pick(o, ['cheapestTest', 'cheapestTestBy', 'cheapestTestAt']) : {}) }; });
  const reg = registry(page), vals = c.values || {}, edited = new Set((c.edits || []).map(e => e.id));
  const v = f => String(vals[f.id] ?? f.value ?? '');
  // 「目前去到哪裏」（G4）推導站點起始狀態：某項連住一站、已發生，而且有文件出處或者由你改過 → 嗰站完成（證明＝交資料嘅封存文件）
  s.events = s.events || [];
  const status = listOf(page.glance && page.glance.status && page.glance.status.items);
  for (const it of status) {
    const m = it.milestone && ms.find(x => x.id === it.milestone), g = v(it);
    if (!m || m.state === 'done' || !g || g === 'none' || !(it.origin === 'doc' || edited.has(it.id))) continue;
    const ev = intakeArchive(page.page.id);
    Object.assign(m, { state: 'done', doneAt: String(c.confirmedAt || localIso()).slice(0, 10), doneEvidence: ev ? [ev] : [], doneInputId: 'overview:' + (c.replyFile || '') });
    s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'milestone', title: '站點已完成（目前進展）：' + m.short, relatedIds: [m.id], moduleIds: ['now', 'paths'] });
  }
  // 開局答案（3.1、附錄 A intake.answers）：每欄嘅值、來源同暫定標記；未答齊嘅欄列入 missing
  const answers = {}, fieldsByPlan = {};
  for (const f of Object.values(reg)) if (/^G(?:10|[1-9])$/.test(String(f.plan || '')) && f.kind !== 'grade') { fieldsByPlan[f.plan] = f; answers[f.plan] = { value: v(f), origin: edited.has(f.id) ? 'founder' : f.origin, ...(f.tentative && !edited.has(f.id) ? { tentative: f.tentative } : {}) }; }
  const rules = listOf(page.detail && page.detail.rules);
  if (!fieldsByPlan.G7) { const r = rules.find(x => x.boxes); if (r) fieldsByPlan.G7 = r; }
  // 你喺每週訪問答「照用再暫定」嘅暫定值：到期日延後（3.9）
  for (const [p, until] of Object.entries(s.tentOverride || {})) if (answers[p] && answers[p].tentative) answers[p].tentative = { ...answers[p].tentative, until };
  answers.G4 = status.map(it => ({ text: it.label, happened: !!v(it) && v(it) !== 'none', ...(v(it) && v(it) !== 'none' ? { grade: v(it) } : {}), ...(it.milestone ? { milestoneId: it.milestone } : {}) }));
  const missing = ROW_PLANS.concat(RULE_PLANS).filter(p => { const f = fieldsByPlan[p]; return !f || (!v(f).trim() && !(p === 'G7' && f.boxes)); });
  if (!status.length) missing.push('G4');
  // 缺少的細節＝首批工作（3.1）：每個未答齊嘅欄、每個四格未齊嘅站、每項缺少嘅資料各一項；補齊咗就完成
  const want = [];
  for (const p of missing) if (p !== 'G4') want.push({ id: 'md-' + p, l: NAMES.field[p] });
  for (const pm of page.path.milestones) {
    const lack = CELLS.filter(([k]) => !(pm[k] && v(pm[k]).trim())).map(([, plan]) => NAMES.field[plan]), m = ms.find(x => x.id === pm.id);
    if (lack.length && m && m.state !== 'done' && !pm.beyondGoal) want.push({ id: 'md-' + pm.id, l: pm.short + '的' + lack.join('、'), milestoneId: pm.id });
  }
  for (const it of listOf(page.detail && page.detail.missing)) { const f = it.edit || reg[it.ref]; if (it.id && !(f && v(f).trim())) want.push({ id: 'md-' + it.id, l: it.title || (f && f.label) || '', next: it.how }); }
  const tasks = s.tasks = s.tasks || [];
  for (const w of want) if (!tasks.some(t => t.id === w.id)) tasks.push({ id: w.id, title: clip(NAMES.t('firstTask', { l: w.l }), 40), owner: 'ai', status: 'planned', firstBatch: true, milestoneId: w.milestoneId || '', deliverable: { kind: 'question-set' }, next: clip(w.next || '向你或對方查明後，經問題包寫回', 60), updatedAt: localIso() });
  for (const t of tasks) if (t.firstBatch && t.status !== 'done' && !want.some(w => w.id === t.id)) { t.status = 'done'; t.updatedAt = localIso(); }
  // 下一個對外動作（G5）：公司概覽嘅值有改先同步（真實事件確認改過嘅唔會被舊值蓋走）
  const g5f = fieldsByPlan.G5, g5 = g5f ? { text: v(g5f), milestoneId: c.nextActionMilestone || g5f.flagTo || '' } : null;
  s.company = { ...(s.company || {}), assumptions: as };
  if (g5 && JSON.stringify(g5) !== JSON.stringify(s.ledgerG5 || null)) { s.company.nextExternalAction = g5; s.ledgerG5 = g5; }
  // 經營節奏（附錄 A rhythm）：開局確認時按「經營節奏」答案寫入一次，之後只經系統頁改；第一次訪問日＝之後第一個訪問星期
  let seeded = false;
  if (!s.company.rhythm) { s.company.rhythm = { ...rhythmFromText((answers.G8 || {}).value), from: 'G8' }; seeded = true; }
  if (!s.interviews || !s.interviews.nextOn) { s.interviews = { ...(s.interviews || {}), nextOn: nextWeekday(todayIso(), s.company.rhythm.interviewWeekday) }; seeded = true; }
  ensureActive(ms);
  s.milestones = ms;
  s.intake = { ...(s.intake || {}), state: missing.length ? 'incomplete' : 'complete', confirmedAt: c.confirmedAt, answers, missing };
  s.ledgerFrom = page.page.id;
  if (before === JSON.stringify([ms, as, s.intake, tasks, s.company.nextExternalAction || null]) && same && !seeded) return false;
  saveState(s);
  log(`帳本已按公司概覽同步：${ms.length} 個站、${as.length} 條假設、未答齊 ${missing.length} 欄`);
  return true;
}
// 交資料嘅封存資料夾（站點由「目前進展」推導完成時作證明）
function intakeArchive(pageId) {
  const name = String(pageId || '');
  try { for (const mo of fs.readdirSync(DIR.archive)) if (fs.existsSync(path.join(DIR.archive, mo, name))) return path.relative(DIR.data, path.join(DIR.archive, mo, name)).replace(/\\/g, '/'); } catch { }
  return '';
}
// 舊公司概覽（未有就緒清單、四格空欄、真事／工作）遷移到新格式；舊版放入歷史。示範唔郁。
function migrateOverview() {
  const page = loadPage();
  if (!page || (page.page && page.page.schema === 2)) return false;
  const st = readJSON(STATE, null);
  if (st && st.demo === true) return false;
  const hist = path.join(DIR.company, 'history'); fs.mkdirSync(hist, { recursive: true });
  fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(hist, `page-${stamp()}-before-migrate.json`));
  const chk = checkCompanyPage(page, {});
  if (!chk.ok) { log('公司概覽遷移未完成（格式唔完整，保留舊版）：' + chk.errors.join('；')); return false; }
  writeJSON(path.join(DIR.company, 'page.json'), chk.page);
  log('公司概覽已遷移到新格式：' + (chk.warnings.join('；') || '冇缺欄'));
  return true;
}
// 而家嘅路線（AI 擬次序用）：帳本有就用帳本，冇就用公司概覽同成頁確認嘅次序
function currentRoute() {
  const s = readJSON(STATE, null);
  if (s && Array.isArray(s.milestones) && s.milestones.length) return s.milestones.filter(m => m.pathStatus === 'confirmed').sort((a, b) => (a.order || 0) - (b.order || 0)).map(m => ({ id: m.id, name: m.short || m.title, event: m.event || '', targetDate: m.targetDate || '' }));
  const page = loadPage(); if (!page) return [];
  const c = readJSON(CONFIRMED, null), reg = registry(page);
  const order = c && Array.isArray(c.order) ? c.order : page.path.milestones.map(m => m.id);
  const byId = Object.fromEntries(page.path.milestones.map(m => [m.id, m]));
  return order.filter(id => byId[id]).map(id => { const m = byId[id], v = f => (f && f.id ? String((c && c.values && c.values[f.id]) ?? (reg[f.id] || {}).value ?? '') : ''); return { id, name: m.short, event: v(m.event), targetDate: v(m.target) }; });
}

/* ---------- 公司概覽資料 ---------- */
function loadPage() {
  return readJSON(path.join(DIR.company, 'page.json'), null);
}
function registry(page) {
  const reg = {};
  (function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && 'value' in o && 'label' in o) reg[o.id] = o;
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
  })(page);
  return reg;
}
// 證據級：答案存機器值（none／said／did／paid），顯示時換成五級名稱（names.js evName）
const show = (e, v) => e && e.kind === 'grade' ? NAMES.evName(v) : v;
const showAns = (q, v) => Array.isArray(v) ? v.join('、') : String(v ?? '');

function parseReply(text) {
  const head = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) break;
    const m = /^([A-Za-z]+):\s?(.*)$/.exec(line);
    if (m) head[m[1]] = m[2];
  }
  const m = /```json\s*([\s\S]*?)```/.exec(text);
  let machine = null;
  try { machine = m ? JSON.parse(m[1]) : null; } catch { machine = null; }
  return { head, machine };
}

/* ---------- 俾 AI 睇嘅確認版公司概覽（通用，唔分邊間公司） ---------- */
function confirmedMarkdown(page, reg, values, c) {
  const v = id => values[id] ?? '';
  const L = [];
  L.push(`# ${page.company.name} 公司概覽（創辦人 ${String(c.confirmedAt || '').slice(0, 10)} 確認）`, '');
  if (page.company.oneLiner) L.push(`一句話：${page.company.oneLiner}`, '');
  L.push('## 目標及下一步');
  for (const r of page.glance.rows) {
    L.push(`- ${r.label}：${v(r.id)}` + (r.due ? `（期限 ${v(r.due.id)}）` : '') + (r.flagTo ? '　← 下一個對外動作' : ''));
  }
  if (page.glance.status) {
    L.push('', `## ${page.glance.status.title || '而家去到邊'}`);
    if (page.glance.status.prepared) L.push(`- ${page.glance.status.prepared}`);
    for (const it of page.glance.status.items || []) L.push(`- ${it.label}：${show(it, v(it.id))}`);
  }
  const ms = Object.fromEntries(page.path.milestones.map(m => [m.id, m]));
  L.push('', '## ' + U.route + '（創辦人確認的次序）');
  (c.order || page.path.milestones.map(m => m.id)).forEach((mid, i) => {
    const m = ms[mid]; if (!m) return;
    L.push('', `### 第 ${i + 1} 站：${m.short}${c.nextActionMilestone === mid ? '（下一個對外動作屬於呢站）' : ''}${m.beyondGoal ? '（本季目標之後）' : ''}${(c.kinds || {})[mid] === 'task' ? '（創辦人判斷：工作，唔係真事）' : ''}`);
    for (const [k, label] of [['event', '真事'], ['actor', '邊個要點頭'], ['witness', '邊個見證'], ['proof', '用乜證明'], ['deliver', '點先算做到'], ['owner', '邊個負責'], ['target', '目標日期']]) {
      if (m[k]) L.push(`- ${label}：${v(m[k].id) || '要確認'}`);
    }
    const qs = ['對方點解會點頭', '對方點樣決定、要幾耐', '要先有乜', '最常見點樣失敗', '點解係呢個日子／數字'];
    (m.depth || []).forEach((d, k) => L.push(`- 為甚麼 ${k + 1}（${qs[k] || ''}）：${v(d.id) || '答唔到，要問'}`));
  });
  const dt = page.detail || {};
  if (listOf(dt.missing).length) {
    L.push('', '## 缺少嘅資料');
    for (const it of listOf(dt.missing)) L.push(`- ${it.title}：${v(it.ref || it.edit?.id) || '未知'}${it.how ? `（點樣搵答案：${it.how}）` : ''}`);
  }
  if (listOf(dt.assumptions).length) {
    L.push('', '## AI 假設（未證實）');
    for (const a of listOf(dt.assumptions)) L.push(`- ${v(a.id)}${a.test ? `（成本最低的測試：${a.test}）` : ''}`);
  }
  for (const r of listOf(dt.rules)) {
    L.push('', `## ${r.label}`, `- ${v(r.id)}`);
    if (r.boxes) {
      L.push(`- AI 自己做：${(r.boxes.auto || []).join('、')}`);
      L.push(`- 做完先話創辦人知：${(r.boxes.tellAfter || []).join('、')}`);
      L.push(`- 必須先問創辦人：${(r.boxes.askFirst || []).join('、')}`);
    }
  }
  const st = readJSON(STATE, null), first = ((st && st.tasks) || []).filter(t => t.firstBatch && t.status !== 'done');
  if (first.length) { L.push('', '## 首批工作：缺少的資料（你要先處理：自己查得到就查；要問創辦人就出問題，附「不知道／稍後提供」選項）'); for (const t of first) L.push(`- ${t.title}（${t.next}）`); }
  if (c.note) L.push('', '## 創辦人備註', c.note);
  return L.join('\n') + '\n';
}
function writeConfirmedPage(sb) {
  const c = readJSON(CONFIRMED, null);
  if (!c || !loadPage()) return;
  const page = loadPage();
  fs.writeFileSync(path.join(sb, 'confirmed-page.md'), confirmedMarkdown(page, registry(page), c.values, c));
}

/* ---------- 開 AI（經已認證嘅 AI 工具，唔綁定邊個 AI） ---------- */
// opts.role：紅藍對打角色（換模型）；AI 做緊期間每分鐘更新鎖，免得長回合被當成過期
function runAI(sandbox, opts) {
  const checked = certified(ROOT, DIR.ledger);
  if (!checked.host) return Promise.resolve({ ok: false, waiting: true, reason: checked.reason });
  // 每份 AI 工作都加「寫給創辦人看的文字」規矩（唯一出處 ai-plain.md）
  try { const tf = path.join(sandbox, 'task.md'), rules = fs.readFileSync(path.join(ROOT, 'ai-plain.md'), 'utf8'); if (fs.existsSync(tf) && !fs.readFileSync(tf, 'utf8').includes('## 寫給創辦人看的文字')) fs.appendFileSync(tf, '\n' + rules); } catch { }
  // 創辦人答咗「不知道／稍後提供」嘅事：每份工作都列出，到期前唔好再問（規劃書 3.1、4.10）
  try { const tf = path.join(sandbox, 'task.md'), unk = openUnknowns(DIR), H = '## 創辦人已答「' + U.unknownLater + '」的事項';
    if (unk.length && fs.existsSync(tf) && !fs.readFileSync(tf, 'utf8').includes(H)) fs.appendFileSync(tf, `\n${H}\n\n到期前不要再問，亦不要換個講法再問；要用到時照「未知」處理，並在產出寫明仍欠這項資料。\n\n` + unk.map(u => `- ${u.question}（${u.until} 到期）`).join('\n') + '\n'); } catch { }
  if (budgetLeft() <= 0) return Promise.resolve({ ok: false, reason: U.skip_budgetExhausted });
  try { fs.appendFileSync(STARTS, `${localIso()}\t${(readJSON(path.join(sandbox, 'job.json'), {}) || {}).type || 'ai'}\t${path.basename(sandbox)}\n`); } catch { }
  const beat = setInterval(() => { try { const n = new Date(); fs.utimesSync(LOCK, n, n); } catch { } }, 60000);
  return execute(checked.host, sandbox, undefined, opts || {}).finally(() => clearInterval(beat));
}

function checkReceipt(outDir, allowEmpty) {
  const r = readJSON(path.join(outDir, 'receipt.json'), null);
  if (!r || typeof r.summary !== 'string' || !Array.isArray(r.artifacts) || (!r.artifacts.length && !allowEmpty)) return { ok: false, reason: 'AI 已完成，但未有交妥工作收據' };
  const artifacts = [];
  for (const a of r.artifacts.slice(0, 5)) {
    const file = String(a && a.file || '');
    // 收據列咗唔係文件嘅項目（例如問題包）就略過，唔當格式錯
    if (!/^[\w.-]+\.md$/.test(file)) { log(`收據略過一項：${clip(JSON.stringify(a), 60)}`); continue; }
    const f = path.join(outDir, file);
    if (!fs.existsSync(f)) return { ok: false, reason: 'AI 交出的資料不齊全，請重試' };
    if (fs.statSync(f).size > 200 * 1024) return { ok: false, reason: 'AI 交出的資料過大，請重試' };
    artifacts.push({ file, title: String(a.title || file), text: fs.readFileSync(f, 'utf8') });
    if (NAMES.isColloquial(a.title)) log(`AI 產出標題有口語字：${a.title}`);
  }
  const list = x => Array.isArray(x) ? x.map(String).slice(0, 5) : [];
  if (!artifacts.length && !allowEmpty) return { ok: false, reason: 'AI 已完成，但未有交妥工作收據' };
  return { ok: true, receipt: { summary: r.summary.slice(0, 600), artifacts, founderNext: list(r.founderNext) } };
}
// AI 出嘅新問題包：過外殼核對（格式、每包最多 12 條、即刻生效要有選項、答過唔再問）先放上 Founder Desk
function takeAIQuestions(sb, run) {
  const f = path.join(sb, 'out', 'ask.json');
  if (!fs.existsSync(f)) return;
  const raw = readJSON(f, null);
  const prep = preparePacks(raw, { dirs: DIR, askedBy: 'AI', fromRun: run.id, strictTitle: false });
  if (!prep.ok) { run.result.askRejected = prep.errors.slice(0, 3); log(`${run.id} AI 問題包退回：${prep.errors.join('；')}`); return; }
  if (isRequest(run)) markRequest(run, raw, prep.packs);
  run.result.asks = placePacks(DIR, prep.packs);
  if (run.kind === 'note' && run.noteType === 'adhoc' && run.result.asks.length) upsertTask({ id: 'a-' + run.ref, status: 'waiting', waitingFor: '等你確認交付內容及期限', packId: run.result.asks[0].id });
  if (prep.warnings.length) { run.result.askWarnings = prep.warnings; log(`${run.id} AI 問題包警告：${prep.warnings.join('；')}`); }
  if (prep.dropped.length) run.result.askDropped = prep.dropped.length;
}

// 創辦人要求擬成嘅問題包：記低屬邊個要求；改次序嘅選項只保留核對得過嘅套用內容（id 要齊、每個一次）
function markRequest(run, raw, packs) {
  const ids = currentRoute().map(r => r.id);
  const okText = (x, n) => typeof x === 'string' && x.trim() && x.length <= n;
  for (const p of packs) {
    p.request = { type: run.noteType, noteId: run.ref };
    p.todoType = run.noteType === 'order' ? 'order' : 'question';
    if (run.noteType === 'adhoc') p.taskId = 'a-' + run.ref;
    for (const q of p.questions) for (const o of q.options || []) {
      if (!o.apply) continue;
      const a = o.apply;
      if (run.noteType !== 'order') { delete o.apply; continue; }
      if (a.keep === true) { o.apply = { keep: true }; continue; }
      const order = Array.isArray(a.order) ? a.order.map(String) : [];
      const hasNew = order.includes('new');
      const good = order.length === ids.length + (hasNew ? 1 : 0) && ids.every(id => order.filter(x => x === id).length === 1) && order.filter(x => x === 'new').length === (hasNew ? 1 : 0)
        && (!hasNew || (a.add && okText(a.add.short, 12) && okText(a.add.event, 120)));
      if (!good) { log(`${run.id} AI 嘅次序選項核對唔到，只記錄答案唔套用：${o.text}`); delete o.apply; o.note = (o.note ? o.note + '；' : '') + '此選項只記錄，不會自動改路線'; continue; }
      const add = hasNew ? Object.fromEntries(['short', 'event', 'witness', 'evidence', 'deliveryCondition', 'targetDate'].filter(k => okText(a.add[k], k === 'short' ? 12 : 120)).map(k => [k, a.add[k].trim()])) : null;
      if (add && add.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(add.targetDate)) delete add.targetDate;
      o.apply = add ? { order, add } : { order };
    }
  }
  if (run.noteType === 'adhoc' && typeof raw.taskTitle === 'string' && raw.taskTitle.trim()) upsertTask({ id: 'a-' + run.ref, title: clip(raw.taskTitle.trim(), 30) });
}
// 改次序／加一站、臨時工作：AI 要擬問題包；生意大腦意見嘅修改唔使
const isRequest = run => run.kind === 'note' && (run.noteType === 'order' || run.noteType === 'adhoc' || run.noteType === 'debrief');
async function runAIStep(run, sb, label, allowEmpty) {
  if (pausedNow() && run.kind !== 'intake') { run.waitingFor = 'paused'; step(run, 'ai', label, 'waiting', U.skip_pausedByFounder); return finish(run, 'waiting'); }
  const ad = certified(ROOT, DIR.ledger);
  step(run, 'ai', label, 'running', `由 ${ad.label || 'AI'} 處理中，一般需時 1–3 分鐘；你可繼續查看，或關閉此頁稍後再查看`);
  log(`${run.id} AI start`);
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (r.waiting) { run.waitingFor = 'ai-setup'; step(run, 'ai', label, 'waiting', r.reason); return finish(run, 'waiting'); }
  if (r.ok && run.noteType === 'practice-prep') return finishPracticePrep(run, sb, label);
  if (!r.ok) { if (run.taskId) upsertTask({ id: run.taskId, status: 'blocked', waitingFor: 'AI 工作未完成，可在 Founder Desk 按「重試」' }); step(run, 'ai', label, 'failed', r.reason); return finish(run, 'failed', r.reason); }
  if (run.kind === 'intake') return finishIntake(run, sb, label);
  if (run.kind === 'prefill') return finishPrefill(run, sb, label);
  const styleWarnings = await rewriteOnce(sb, run);
  if (run.noteType === 'event' || run.noteType === 'doc') return finishEvent(run, sb, label, styleWarnings);
  const chk = checkReceipt(path.join(sb, 'out'), allowEmpty);
  if (!chk.ok) { step(run, 'ai', label, 'failed', chk.reason); return finish(run, 'failed', chk.reason); }
  fs.cpSync(path.join(sb, 'out'), path.join(DIR.work, run.id), { recursive: true });
  writeJSON(path.join(DIR.work, run.id, 'run.json'), { id: run.id, kind: run.kind, ref: run.ref, label, startedAt: run.startedAt, aiCost: run.aiCost || null });
  run.result = chk.receipt;
  run.result.styleWarnings = styleWarnings;
  takeAIQuestions(sb, run);
  if (isRequest(run) && !(run.result.asks || []).length && run.result.askDropped) {
    // AI 擬嘅問題之前答過：唔再問，講清楚；臨時工作就收起
    if (run.noteType === 'adhoc') upsertTask({ id: 'a-' + run.ref, status: 'cancelled' });
    run.result.summary = '此要求與你先前回答過的問題相同，因此不再重複提問；如需再改，請寫清新做法後再提交。';
    step(run, 'ai', label, 'done', '先前已回答，不再重複提問'); return finish(run, 'done');
  }
  if (isRequest(run) && !(run.result.asks || []).length) { if (run.noteType === 'adhoc') upsertTask({ id: 'a-' + run.ref, status: 'blocked', waitingFor: 'AI 未能擬定範圍，可在 Founder Desk 按「重試」' }); const why = 'AI 未能擬定問題，請按「重試」'; step(run, 'ai', label, 'failed', why); return finish(run, 'failed', why); }
  if (run.taskId) taskDone(run);
  const more = run.result.asks && run.result.asks.length ? `；另有 ${run.result.asks.reduce((n, a) => n + a.count, 0)} 條問題等你回答` : '';
  step(run, 'ai', label, 'done', isRequest(run) ? `已擬定 ${run.result.asks.reduce((n, a) => n + a.count, 0)} 條問題，等你確認` : `已完成 ${chk.receipt.artifacts.length} 份產出${more}`);
  finish(run, 'done');
}
/* ---------- 臨時工作：AI 交貨後由外殼出驗收包（接受／退回），唔使 AI ---------- */
function taskDone(run) {
  const t = getTask(run.taskId);
  if (!t) return;
  const art = (run.result.artifacts || [])[0];
  const pack = {
    format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-acc', title: clip('驗收：' + t.title, 60),
    context: 'AI 已完成你交的臨時工作' + (art ? '：「' + art.title + '」' : '') + '。', afterConfirm: '接受即完成；退回 AI 會按你的原因再改。',
    next: null, askedBy: 'AI', askedAt: localIso(), fromRun: run.id, todoType: 'acceptance', acceptance: { taskId: t.id },
    questions: [
      { id: 'accept', priority: 1, ask: '這份產出可以用嗎？', kind: 'choice', effect: 'now', options: [{ text: '接受', rec: true }, { text: '退回修改' }], value: '接受', why: '已按你確認的交付內容完成；可在「最近 AI 工作」打開查看。' },
      { id: 'reason', priority: 2, ask: '如果退回，要改甚麼？', kind: 'text', effect: 'tentative', value: '不用改', why: '接受就毋須填寫。' }
    ]
  };
  const placed = placePacks(DIR, [pack]);
  run.result.asks = (run.result.asks || []).concat(placed);
  upsertTask({ id: t.id, status: 'done', needsAcceptance: true, acceptedBy: null, artifactTitle: art ? art.title : '', packId: placed[0].id, waitingFor: '' });
  addEvent({ actor: 'ai', type: 'run', title: 'AI 完成臨時工作：' + t.title + '，待你驗收', relatedIds: [t.id, run.id], moduleIds: ['ai-week', 'artifacts'] });
}
/* ---------- 改次序／加一站：創辦人答咗先由外殼機械套用（帳本有就改帳本；冇就改公司概覽同成頁確認） ---------- */
function applyOrder(pack, store, run) {
  const q = pack.questions.find(x => (x.options || []).some(o => o.apply));
  if (!q) return '';
  const a = store.answers[q.id]; const val = a ? a.value : q.value;
  const opt = (q.options || []).find(o => o.text === val);
  if (!opt) return '你的答案已記錄；路線沒有自動更改';
  if (!opt.apply || opt.apply.keep) return '路線維持不變';
  const { order, add } = opt.apply;
  const route = currentRoute().map(r => r.id);
  if (order.filter(x => x !== 'new').length !== route.length || !route.every(id => order.includes(id))) return '路線已有變動，今次未有套用；請重新提交要求';
  const s = readJSON(STATE, null);
  let names = [];
  // 帳本里程碑由公司概覽同步（ledgerFrom）：改公司概覽同成頁確認，再同步入帳本，兩邊唔會分岔；示範帳本就直接改帳本
  if (s && Array.isArray(s.milestones) && s.milestones.length && !s.ledgerFrom) {
    let newId = '';
    if (add) { let n = s.milestones.length + 1; while (s.milestones.some(m => m.id === 'm' + n)) n++; newId = 'm' + n;
      s.milestones.push({ id: newId, title: add.short, short: add.short, lineId: 'main', event: add.event, witness: add.witness || '', evidence: add.evidence || '', deliveryCondition: add.deliveryCondition || '', targetDate: add.targetDate || '', state: 'not_started', pathStatus: 'confirmed', depth: 'shallow', addedBy: 'founder', watchItems: [] }); }
    const ids = order.map(x => x === 'new' ? newId : x);
    const old = Object.fromEntries(s.milestones.map(m => [m.id, m.order]));
    ids.forEach((id, i) => { const m = s.milestones.find(z => z.id === id); m.order = i + 1; });
    // 已撤嘅站留喺原本位置附近（跟住佢前一站）
    for (const m of s.milestones.filter(z => z.pathStatus === 'retired')) { const prev = s.milestones.filter(z => z.pathStatus === 'confirmed' && old[z.id] != null && old[z.id] < (old[m.id] || 0)).sort((x, y) => old[y.id] - old[x.id])[0]; m.order = prev ? prev.order + 0.5 : 0.5; }
    names = ids.map(id => (s.milestones.find(m => m.id === id) || {}).short);
    s.events = s.events || []; s.events.push({ id: 'e' + stamp(), at: localIso(), actor: 'founder', type: 'path', title: (add ? '新增一站：' + add.short + '；' : '') + '路線次序已更新', relatedIds: ids, moduleIds: ['paths', 'now'] });
    saveState(s);
  } else {
    const page = loadPage(), c = readJSON(CONFIRMED, null);
    const hist = path.join(DIR.company, 'history'); fs.mkdirSync(hist, { recursive: true });
    fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(hist, `page-${stamp()}.json`));
    let newId = '';
    if (add) { let n = page.path.milestones.length + 1; while (page.path.milestones.some(m => m.id === 'm' + n)) n++; newId = 'm' + n;
      page.path.milestones.push({ id: newId, short: add.short, why: '創辦人要求加入', event: { id: newId + '-e', label: '真事', value: add.event, origin: 'founder' }, ...(add.targetDate ? { target: { id: newId + '-t', label: '目標日期', kind: 'date', value: add.targetDate, origin: 'founder' } } : {}) }); }
    const ids = order.map(x => x === 'new' ? newId : x);
    if (c) { c.order = ids; if (add) { c.values = c.values || {}; c.values[newId + '-e'] = add.event; if (add.targetDate) c.values[newId + '-t'] = add.targetDate; } writeJSON(CONFIRMED, c); }
    else { const byId = Object.fromEntries(page.path.milestones.map(m => [m.id, m])); page.path.milestones = ids.map(id => byId[id]).filter(Boolean); }
    writeJSON(path.join(DIR.company, 'page.json'), page);
    names = ids.map(id => (page.path.milestones.find(m => m.id === id) || {}).short);
    syncLedger();
    addEvent({ actor: 'founder', type: 'path', title: (add ? '新增一站：' + add.short + '；' : '') + '路線次序已更新', relatedIds: ids, moduleIds: ['paths', 'now'] });
  }
  appendLog(DIR, [{ at: localIso(), source: 'ask', packId: pack.id, packTitle: pack.title, qid: 'apply', question: '套用：' + U.routeOrder, ai: '', answer: names.join(' → '), changed: true, effect: 'now', runId: run.id }]);
  return '已按你的選擇更新路線：' + names.join(' → ');
}
/* ---------- 免除 AI 腔同內部術語：掃畫面會見到嘅字，命中就叫 AI 改寫一次，仲有就照放並標提示 ---------- */
const OUT_FILES = ['receipt.json', 'ask.json', 'company-page.json', 'event.json'];
function snapshotOut(out) {
  const snap = {};
  for (const f of fs.readdirSync(out)) if (f.endsWith('.md') || OUT_FILES.includes(f)) snap[f] = fs.readFileSync(path.join(out, f), 'utf8');
  return snap;
}
function restoreOut(out, snap) { for (const [f, text] of Object.entries(snap)) fs.writeFileSync(path.join(out, f), text); }
function jsonStillOk(out) {
  for (const f of OUT_FILES) {
    const p = path.join(out, f);
    if (!fs.existsSync(p)) continue;
    try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return false; }
  }
  return true;
}
async function rewriteOnce(sb, run) {
  const out = path.join(sb, 'out');
  const hits = scanOutput(out);
  if (!hits.length) return [];
  log(`${run.id} 用字命中 ${hits.length} 處，叫 AI 改寫一次`);
  const snap = snapshotOut(out);
  writeJSON(path.join(sb, 'job.json'), { type: 'rewrite', hits: hits.map(h => ({ file: h.file, term: h.term, context: h.context })) });
  const L = ['# 你今次嘅工作：改寫用字', '',
    '你啱啱交出嘅內容有以下用字唔啱：有內部工程術語（例如 G 編號、run、檔案路徑、id），或者有 AI 腔（客套開場、收尾總結、主動提議、空泛形容詞、口號）。', '',
    '規矩：', '1. 只改下面列出嘅位，意思唔變；術語改用日常白話講，客套同口號直接刪走。',
    '2. 只可以改 `out/` 入面嘅檔；JSON 檔要保持有效 JSON 同原本結構，只改字串內容。', '3. 唔好改其他內容，唔好加新內容。', '', '## 要改嘅位', ''];
  hits.forEach((h, i) => L.push(`${i + 1}. \`out/${h.file}\`：「${h.term.trim()}」，前後文：「${h.context.replace(/\s+/g, ' ').trim()}」`));
  fs.writeFileSync(path.join(sb, 'task.md'), L.join('\n') + '\n');
  const r = await runAI(sb);
  if (r.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r.meta.total_cost_usd || 0);
  if (!r.ok || !jsonStillOk(out)) restoreOut(out, snap);
  // 改寫句逐段機械核對（4.10）：長度、新數字或日期、聲稱字句；唔過嘅段落或欄位用返原文；JSON 以原檔結構同機器欄位為準，Markdown 標題結構唔同就成份用返原文
  const st0 = loadState(), rctx = { tasks: Object.fromEntries((st0.tasks || []).map(t => [t.id, t.title])), milestones: Object.fromEntries((st0.milestones || []).map(m => [m.id, m.short || m.title])) };
  if (r.ok && jsonStillOk(out)) for (const [f, orig] of Object.entries(snap)) {
    const p = path.join(out, f);
    let now; try { now = fs.readFileSync(p, 'utf8'); } catch { continue; }
    if (now === orig) continue;
    if (f.endsWith('.md')) fs.writeFileSync(p, headings(now) === headings(orig) ? mergeRewriteMd(orig, now, rctx).text : orig);
    else { try { const a = JSON.parse(orig), b = JSON.parse(now); fs.writeFileSync(p, JSON.stringify(mergeRewriteJSON(a, b, rctx).value, null, 2)); } catch { fs.writeFileSync(p, orig); } }
  }
  const left = scanOutput(out);
  if (!left.length) return [];
  // 規劃書 4.10 (2)(3)：查得到嘅編號同級數機械換成名稱；查唔到嘅照放並加「含內部用語」標記，記 health.warnings
  const fix = fixOutput(out, rctx);
  log(`${run.id} 改寫後仍有 ${left.length} 處，已機械替換；${fix.marked.length} 處照放並標「含內部用語」`);
  plainWarn(clip(String(run.label || ({ intake: '公司概覽草稿', note: '你的要求' })[run.kind] || '一次 AI 工作'), 30), fix.marked.length > 0, fix.colloquial > 0);
  return scanOutput(out).map(h => ({ where: h.where, term: h.term.trim() }));
}

/* ---------- 交資料：AI 擬公司概覽，外殼核對、修正一次、安裝 ---------- */
// 工作說明第一行寫今日日期（模擬實例按模擬時鐘），AI 先判斷到文件入面「本週」「下星期」一類字眼係咪已經過去（規劃者第 161 點）
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function datedTask(sb, src) {
  const t = todayIso(), wd = WEEK[new Date(t + 'T12:00:00').getDay()];
  fs.writeFileSync(path.join(sb, 'task.md'), `> 今日日期：${t}（星期${wd}）\n\n` + fs.readFileSync(path.join(ROOT, src), 'utf8'));
}
function intakeTask(sb) {
  datedTask(sb, 'ai-intake.md');
  fs.copyFileSync(path.join(ROOT, 'company-page-format.md'), path.join(sb, 'company-page-format.md'));
  fs.copyFileSync(path.join(ROOT, 'fixtures', 'example-company-page-full.json'), path.join(sb, 'example-company-page.json'));
  writeJSON(path.join(sb, 'job.json'), { type: 'intake', today: todayIso() });
}
function checkDraft(out, run, ready) {
  const page = readJSON(path.join(out, 'company-page.json'), null);
  if (!page) return { ok: false, errors: ['AI 未有交出公司概覽，或內容無法讀取'], warnings: [] };
  const revision = fs.existsSync(path.join(DIR.company, 'history')) ? fs.readdirSync(path.join(DIR.company, 'history')).filter(f => f.startsWith('page-')).length + 2 : (fs.existsSync(path.join(DIR.company, 'page.json')) ? 2 : 1);
  return checkCompanyPage(page, { id: 'intake-' + run.ref, revision, preparedAt: localIso().slice(0, 10), ready: !!ready });
}
function installPage(page) {
  const hist = path.join(DIR.company, 'history');
  fs.mkdirSync(hist, { recursive: true });
  const cur = path.join(DIR.company, 'page.json');
  if (fs.existsSync(cur)) fs.renameSync(cur, path.join(hist, `page-${stamp()}.json`));
  // 新公司概覽要重新校對：舊確認搬入歷史
  if (fs.existsSync(CONFIRMED)) fs.renameSync(CONFIRMED, path.join(hist, `confirmed-${stamp()}.json`));
  writeJSON(cur, page);
}
async function finishIntake(run, sb, label) {
  const out = path.join(sb, 'out');
  let chk = checkDraft(out, run, true);
  if (!chk.ok) {
    log(`${run.id} 公司概覽格式唔完整：${chk.errors.join('；')}；叫 AI 修正一次`);
    writeJSON(path.join(sb, 'job.json'), { type: 'intake-repair', errors: chk.errors });
    fs.writeFileSync(path.join(sb, 'task.md'), ['# 你今次嘅工作：修正公司概覽', '',
      '你啱啱寫嘅 `out/company-page.json` 有以下問題，請照 `company-page-format.md` 改好（可以參考 `example-company-page.json`），其他內容唔好改：', '',
      ...chk.errors.map((e, i) => `${i + 1}. ${e}`), '', '改完覆寫 `out/company-page.json`。只可以寫 `out/`。'].join('\n') + '\n');
    const r = await runAI(sb);
    if (r.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r.meta.total_cost_usd || 0);
    chk = r.ok ? checkDraft(out, run, true) : chk;
  }
  // 就緒清單或者四格修正後仍缺：唔阻你校對，加空欄（未知）同首批工作，校對頁列出「尚未問齊」
  if (!chk.ok) { const loose = checkDraft(out, run, false); if (loose.ok) { log(`${run.id} 修正後仍未齊：${chk.errors.join('；')}；已加空欄`); chk = loose; } }
  if (!chk.ok) {
    const why = 'AI 擬定的公司概覽格式不完整，請按「重試」';
    step(run, 'ai', label, 'failed', why);
    return finish(run, 'failed', why);
  }
  writeJSON(path.join(out, 'company-page.json'), chk.page);
  const styleWarnings = await rewriteOnce(sb, run);
  // 改寫之後再核對一次；改壞咗就用返改寫前嗰版
  let page = chk.page;
  const again = checkDraft(out, run);
  if (again.ok) page = again.page; else log(`${run.id} 改寫後格式唔啱，用返改寫前嘅公司概覽`);
  installPage(page);
  const receipt = readJSON(path.join(out, 'receipt.json'), {}) || {};
  fs.cpSync(out, path.join(DIR.work, run.id), { recursive: true });
  writeJSON(path.join(DIR.work, run.id, 'run.json'), { id: run.id, kind: run.kind, ref: run.ref, label, startedAt: run.startedAt, aiCost: run.aiCost || null });
  run.result = { summary: String(receipt.summary || '公司概覽已擬好，等你校對。').slice(0, 600), artifacts: [], founderNext: [], companyReady: true, warnings: chk.warnings, styleWarnings };
  step(run, 'ai', label, 'done', '公司概覽已擬好');
  step(run, 'ready', U.stepIntakeReady, 'done', chk.warnings.length ? `有 ${chk.warnings.length} 項已自動修正` : '');
  finish(run, 'done');
}
/* ---------- 創辦人交要求：登記後叫 AI 擬成問題包（未答之前乜都唔改） ---------- */
async function handleNote(run, file) {
  const m = /^(.*)-note-(order|adhoc|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc)\.md$/.exec(file) || /^(.*)-(feedback)-[a-z]+\.md$/.exec(file);
  run.kind = 'note'; run.ref = m[1]; run.noteType = m[2]; run.replyFiles = [file];
  const raw = fs.readFileSync(path.join(DIR.inbox, file), 'utf8');
  step(run, 'received', U.stepReqReceived, 'done', { order: U.reqOrder, adhoc: U.reqAdhoc, feedback: U.brainFeedback, 'brain-decide': U.brainDecide, 'practice-prep': U.practicePrep, debrief: U.practiceDebrief, 'debate-start': U.debateReq, 'debate-action': U.debateActionReq, event: U.reqEvent, doc: U.reqDoc }[run.noteType]);
  const text = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim();
  const dest = path.join(DIR.archive, `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(path.join(DIR.inbox, file), path.join(dest, file));
  if (run.noteType === 'event' || run.noteType === 'doc') return handleEvent(run, raw, text.replace(/```json[\s\S]*$/, '').trim(), dest);
  if (run.noteType === 'feedback') return handleFeedback(run, parseReply(raw).machine || {});
  if (run.noteType === 'brain-decide') return handleBrainDecide(run, parseReply(raw).machine || {});
  if (run.noteType === 'practice-prep') return handlePracticePrep(run, parseReply(raw).machine || {}, text.replace(/```json[\s\S]*$/, '').trim());
  if (run.noteType === 'debrief') return handleDebrief(run, parseReply(raw).machine || {}, text.replace(/```json[\s\S]*$/, '').trim());
  if (run.noteType === 'debate-action') return handleDebateAction(run, parseReply(raw).machine || {});
  if (run.noteType === 'debate-start') { if (!loadPage()) { const why = '未有公司概覽，請先交資料'; step(run, 'applied', U.stepReqRegistered, 'failed', why); return finish(run, 'failed', why); } return handleDebateStart(run, parseReply(raw).machine || {}); }
  if (!loadPage()) { const why = '未有公司概覽，請先交資料'; step(run, 'applied', U.stepReqRegistered, 'failed', why); return finish(run, 'failed', why); }
  if (run.noteType === 'adhoc') {
    upsertTask({ id: 'a-' + run.ref, title: clip(text.replace(/\s+/g, ' '), 30), adhoc: true, status: 'planned', waitingFor: 'AI 正在擬定範圍', noteId: run.ref });
    addEvent({ actor: 'founder', type: 'input', title: '提交臨時工作：' + clip(text.replace(/\s+/g, ' '), 30), relatedIds: ['a-' + run.ref], moduleIds: ['inputs', 'decisions'] });
  } else addEvent({ actor: 'founder', type: 'input', title: '要求改路線：' + clip(text.replace(/\s+/g, ' '), 30), relatedIds: [], moduleIds: ['inputs', 'paths'] });
  step(run, 'applied', U.stepReqRegistered, 'done', '');
  const sb = newSandbox(run);
  noteTask(sb, run.noteType, text);
  await runAIStep(run, sb, U.stepReqAI, true);
}
/* ---------- 生意大腦：結果卡意見（有用／沒有用照記；要修改就叫 AI 按意見改）同「要你決定」放上 Founder Desk ---------- */
const FEEDBACK = path.join(DIR.ledger, 'brain-feedback.json');
const VERDICT = { useful: '有用', useless: '沒有用', revise: '要修改' };
async function handleFeedback(run, m) {
  const all = readJSON(FEEDBACK, {}) || {};
  const card = cardText(DIR, m.cardId) || '';
  const title = (card.split('\n')[0] || '').replace(/^#\s*/, '') || '生意大腦結果卡';
  all[m.cardId] = { item: m.item, verdict: m.verdict, text: m.text || '', at: localIso() };
  writeJSON(FEEDBACK, all);
  addEvent({ actor: 'founder', type: 'input', title: '你對「' + clip(title, 30) + '」的意見：' + (VERDICT[m.verdict] || ''), relatedIds: [m.cardId], moduleIds: ['inputs'] });
  step(run, 'applied', U.stepReqRegistered, 'done', VERDICT[m.verdict] || '');
  if (m.verdict !== 'revise' || !card) { run.result = { summary: '已記錄你的意見' + (m.verdict === 'revise' ? '；找不到此張卡的內容，AI 未能修改。' : '。'), artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  all[m.cardId].runId = run.id; writeJSON(FEEDBACK, all);
  const sb = newSandbox(run);
  reviseTask(sb, card, m.text);
  await runAIStep(run, sb, U.brainRevise + '：' + clip(title, 30), false);
}
function reviseTask(sb, card, say) {
  fs.writeFileSync(path.join(sb, 'card.md'), card);
  fs.writeFileSync(path.join(sb, 'note.md'), '# 創辦人的意見\n\n' + (say || '') + '\n');
  writeConfirmedPage(sb);
  fs.copyFileSync(path.join(ROOT, 'ai-revise.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'revise' });
}
// 紅藍對打嘅「需要你決定」：外殼照裁判寫嘅選項機械出問題包（唔使 AI），放上 Founder Desk
function handleBrainDecide(run, m) {
  const w = (loadBrain(DIR).items.find(x => x.id === 'wargame') || {}).detail;
  const ds = w && w.synthesis ? w.synthesis.founderDecisions : [];
  if (!ds.length) { const why = '紅藍對打未整合好，未有要你決定的事'; step(run, 'applied', U.stepReqRegistered, 'failed', why); return finish(run, 'failed', why); }
  const raw = { format: 'startup-os.ask/0.1', title: '紅藍對打：需要你決定的事', context: '裁判整合紅藍對打之後，有以下事情要你拍板；紅隊結果不算證據。', afterConfirm: '答案會記入決定紀錄。',
    questions: ds.slice(0, 3).map((d, i) => { const opts = (d.options || []).slice(0, 3).map(o => String(o)); const rec = opts.find(o => o === d.recommend || o.startsWith(String(d.recommend || '') + ' ')) || opts[0];
      return { id: 'd' + (i + 1), priority: i + 1, ask: String(d.question), kind: 'choice', effect: 'now', options: opts.map(o => ({ text: o, rec: o === rec })), value: rec, why: String(d.why || '裁判建議') }; }) };
  const prep = preparePacks(raw, { dirs: DIR, askedBy: 'AI', fromRun: null, strictTitle: false });
  if (!prep.ok || !prep.packs.length) { const why = prep.ok ? '這幾條先前已經回答' : '裁判提供的選項格式不正確，未能放上 Founder Desk'; step(run, 'applied', U.stepReqRegistered, prep.ok ? 'done' : 'failed', why); if (prep.ok) { run.result = { summary: why, artifacts: [], founderNext: [] }; return finish(run, 'done'); } return finish(run, 'failed', why); }
  for (const p of prep.packs) { p.todoType = 'decision'; p.brainItem = 'wargame'; }
  const placed = placePacks(DIR, prep.packs);
  const map = readJSON(path.join(DIR.ledger, 'brain-decisions.json'), {}) || {}; map[m.cardId] = placed[0].id; writeJSON(path.join(DIR.ledger, 'brain-decisions.json'), map);
  step(run, 'applied', U.stepReqRegistered, 'done', '已放上 Founder Desk');
  run.result = { summary: '已放上 Founder Desk：' + placed[0].title, artifacts: [], founderNext: [], asks: placed };
  return finish(run, 'done');
}
/* ---------- 情景演練：準備場景（AI 由準備文件同你嘅行動擬人物卡）、會後紀錄（AI 擬跟進問題） ---------- */
const PRACTICE_DIR = path.join(DIR.data, 'practice', 'scenarios');
async function handlePracticePrep(run, m, say) {
  const task = m.taskId ? getTask(m.taskId) : null;
  run.practiceTaskId = m.taskId || '';
  step(run, 'applied', U.stepReqRegistered, 'done', task ? task.title : '');
  const sb = newSandbox(run);
  fs.writeFileSync(path.join(sb, 'request.md'), ['# 想練習嘅會面', '', task ? `- 現實行動：${task.title}` : '', task && task.dueAt ? `- 日期：${task.dueAt}` : '', m.who ? `- 對方：${m.who}` : '', say ? `- 創辦人補充：${say}` : ''].filter(Boolean).join('\n') + '\n');
  // 準備文件：生意大腦指定嘅本機資料夾入面同會面有關嘅文件（只複製入工作資料夾）
  const src = brainSource(DIR);
  if (src && src.kind === 'folder') {
    fs.mkdirSync(path.join(sb, 'docs'), { recursive: true });
    for (const f of fs.readdirSync(src.dir).filter(f => /\.md$/.test(f) && /預演|演練|會面|訪談|準備/.test(f))) fs.copyFileSync(path.join(src.dir, f), path.join(sb, 'docs', f));
  }
  writeConfirmedPage(sb);
  if (!fs.existsSync(path.join(sb, 'confirmed-page.md')) && fs.existsSync(path.join(DIR.company, 'page.json'))) fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(sb, 'company-page.json'));
  fs.copyFileSync(path.join(ROOT, 'fixtures', 'demo-farm', 'practice', 'farm-c.json'), path.join(sb, 'example-scenario.json'));
  fs.copyFileSync(path.join(ROOT, 'ai-practice-prep.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'practice-prep' });
  await runAIStep(run, sb, U.practicePrepAI, true);
}
function finishPracticePrep(run, sb, label) {
  const sc = readJSON(path.join(sb, 'out', 'scenario.json'), null);
  const txt = (x, n) => typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : '';
  const okSc = sc && sc.counterpart && txt(sc.counterpart.name, 60) && sc.persona && ['identity', 'stance', 'interests'].every(k => sc.persona[k] && txt(sc.persona[k].text, 400)) && sc.goal && txt(sc.goal.text, 200) && Array.isArray(sc.questions) && sc.questions.length && Array.isArray(sc.objections) && sc.objections.length;
  if (!okSc) { const why = 'AI 準備的場景不完整，請按「重試」'; step(run, 'ai', label, 'failed', why); return finish(run, 'failed', why); }
  const task = run.practiceTaskId ? getTask(run.practiceTaskId) : null;
  const id = 'S' + stamp();
  const clean = { id, title: txt(sc.title, 60) || '練習：' + txt(sc.counterpart.name, 30), forTaskId: task ? task.id : '', date: task && task.dueAt || '', counterpart: { name: txt(sc.counterpart.name, 60), role: txt(sc.counterpart.role, 120) },
    persona: Object.fromEntries(['identity', 'background', 'stance', 'interests', 'decision', 'concerns', 'style'].filter(k => sc.persona[k] && txt(sc.persona[k].text, 400)).map(k => [k, { text: txt(sc.persona[k].text, 400), source: txt(sc.persona[k].source, 60) || 'AI 解讀' }])),
    hidden: (sc.hidden || []).slice(0, 3).map((h, i) => ({ id: 'H' + (i + 1), text: txt(h.text, 300) })).filter(h => h.text),
    goal: { text: txt(sc.goal.text, 200), fallback: txt(sc.goal.fallback, 200) },
    questions: sc.questions.slice(0, 8).map((q, i) => ({ id: 'Q' + (i + 1), text: txt(q.text || q, 200) })).filter(q => q.text),
    objections: sc.objections.slice(0, 7).map((o, i) => ({ id: 'O' + (i + 1), text: txt(o.text || o, 200), response: txt(o.response, 200) })).filter(o => o.text),
    opening: txt(sc.opening, 200) || '你好，坐低傾吓。', openers: (sc.openers || []).slice(0, 3).map(x => txt(x, 160)).filter(Boolean),
    sources: (sc.sources || []).slice(0, 8).map((s, i) => ({ n: Number(s.n) || i + 1, title: txt(s.title, 120), url: /^https?:\/\//.test(String(s.url || '')) ? txt(s.url, 300) : '', readOn: /^\d{4}-\d{2}-\d{2}$/.test(String(s.readOn || '')) ? s.readOn : /^https?:\/\//.test(String(s.url || '')) ? localIso().slice(0, 10) : '' })).filter(s => s.title), practiceOnly: true, preparedAt: localIso(), fromRun: run.id };
  fs.mkdirSync(PRACTICE_DIR, { recursive: true });
  writeJSON(path.join(PRACTICE_DIR, id + '.json'), clean);
  if (task) upsertTask({ id: task.id, scenarioId: id });
  run.result = { summary: '練習場景準備好：' + clean.title, artifacts: [], founderNext: [], scenarioId: id };
  step(run, 'ai', label, 'done', clean.counterpart.name);
  return finish(run, 'done');
}
async function handleDebrief(run, m, say) {
  const sc = m.scenarioId ? readJSON(path.join(PRACTICE_DIR, m.scenarioId + '.json'), null) : null;
  const CM = { yes: '有承諾', partly: '有部分承諾', no: '冇承諾' };
  const log = readJSON(path.join(DIR.ledger, 'practice-debriefs.json'), []) || [];
  log.push({ at: localIso(), scenarioId: m.scenarioId || '', sessionId: m.sessionId || '', commitment: m.commitment, followUp: m.followUp || '', text: say, runId: run.id });
  writeJSON(path.join(DIR.ledger, 'practice-debriefs.json'), log);
  addEvent({ actor: 'founder', type: 'input', title: '會後紀錄：' + (sc ? sc.counterpart.name : '真實會面') + '（' + (CM[m.commitment] || '') + '）', relatedIds: [m.scenarioId || ''], moduleIds: ['inputs', 'evidence'] });
  step(run, 'applied', U.stepReqRegistered, 'done', CM[m.commitment] || '');
  const sb = newSandbox(run);
  fs.writeFileSync(path.join(sb, 'debrief.md'), ['# 會後紀錄（真實會面）', '', `- 對方：${sc ? sc.counterpart.name : '（未有場景）'}`, `- 有冇承諾：${CM[m.commitment] || ''}`, m.followUp ? `- 跟進日期：${m.followUp}` : '', '', '## 對方真係講咗乜', '', say].filter(x => x !== '').join('\n') + '\n');
  if (sc) writeJSON(path.join(sb, 'scenario.json'), sc);
  writeConfirmedPage(sb);
  fs.copyFileSync(path.join(ROOT, 'ai-debrief.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'debrief' });
  await runAIStep(run, sb, U.practiceDebriefAI, true);
}
function noteTask(sb, type, text) {
  fs.writeFileSync(path.join(sb, 'note.md'), `# 創辦人的要求（${type === 'order' ? '改次序或加一站' : '臨時工作'}）\n\n${text}\n`);
  writeJSON(path.join(sb, 'route.json'), currentRoute());
  writeConfirmedPage(sb);
  if (!fs.existsSync(path.join(sb, 'confirmed-page.md'))) fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(sb, 'company-page.json'));
  fs.writeFileSync(path.join(sb, 'task.md'), fs.readFileSync(path.join(ROOT, 'ai-note.md'), 'utf8') + `\n## 今次嘅要求類型\n\n${type === 'order' ? '類型一：改次序／加一站' : '類型二：臨時工作'}\n`);
  writeJSON(path.join(sb, 'job.json'), { type: 'note', noteType: type });
}
/* ---------- 記錄真實事件（規劃書 3.10 (2)(3)、3.3、3.7）：登記輸入 → AI 擬確認問題（證據級、站點進度）→ 你逐項確認 → 外殼套用 ----------
   AI 唔可以自己改級或者標站點完成：佢只交建議（out/event.json），問題包由外殼按建議機械生成，選項帶套用內容；
   未答嘅唔套用，答咗嘅即時寫入帳本（假設級別、站點進度、該筆輸入嘅收據、事件）。事件日期由你填，唔係提交時間。 */
const dayText = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[2]} 月 ${+m[3]} 日` : String(d || ''); };
const EV_RANK = g => Math.max(0, NAMES.EV_KEYS.indexOf(g));
async function handleEvent(run, raw, text, dest) {
  const mac = parseReply(raw).machine || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(mac.date || '')) ? mac.date : localIso().slice(0, 10);
  // 證明文件同筆記一齊封存（永不刪除）
  // 放入文件（doc）同真實事件同一條路；文件名前綴唔同
  const isDoc = run.noteType === 'doc', pre = run.ref + '-note-' + (isDoc ? 'doc' : 'event') + '-file-';
  const files = fs.readdirSync(DIR.inbox).filter(f => f.startsWith(pre)).sort();
  for (const f of files) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
  const rel = f => path.relative(DIR.data, path.join(dest, f)).replace(/\\/g, '/');
  syncLedger();
  const s = loadState(), inputId = 'in-' + run.ref;
  s.inputs = (s.inputs || []).filter(i => i.id !== inputId);
  const names = files.map(f => f.slice(pre.length).replace(/^\d+-/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '')).join('、');
  s.inputs.push({ id: inputId, kind: 'inbox', via: isDoc ? 'doc' : 'event', title: clip(isDoc ? '文件（' + dayText(date) + '）：' + names : '真實事件（' + dayText(date) + '）：' + text.replace(/\s+/g, ' '), 50), file: rel(run.replyFiles[0]), files: files.map(rel), eventDate: date, receivedAt: localIso(), status: 'unprocessed', effects: [] });
  s.events = s.events || [];
  s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'input', title: isDoc ? '放入文件：' + clip(names, 30) : '記錄真實事件（' + dayText(date) + '）：' + clip(text.replace(/\s+/g, ' '), 30), relatedIds: [inputId], moduleIds: ['inputs', 'evidence'] });
  saveState(s);
  step(run, 'applied', U.stepReqRegistered, 'done', files.length ? `連同 ${files.length} 份證明文件` : '');
  if (!(s.milestones || []).length && !((s.company || {}).assumptions || []).length) { step(run, 'ai', U.stepEventAI, 'failed', U.eventNeedOverview); return finish(run, 'failed', U.eventNeedOverview); }
  const sb = newSandbox(run);
  eventTask(sb, s, { text, date, files: files.map(f => path.join(dest, f)), ref: run.ref, pre, ...(isDoc ? { heading: '# 創辦人放入的文件（只按文件寫明、公司以外已發生的事擬確認題；文件沒有寫的不要推斷）' } : {}) });
  await runAIStep(run, sb, U.stepEventAI, true);
}
function eventTask(sb, s, ev) {
  fs.writeFileSync(path.join(sb, 'event.md'), [ev.heading || '# 創辦人記錄的真實事件', '', `- 事件日期：${ev.date}`, `- 證明文件：${ev.files.length ? ev.files.length + ' 份（在 files/）' : '沒有'}`, '', '## 創辦人原話', '', ev.text].join('\n') + '\n');
  if (ev.files.length) { fs.mkdirSync(path.join(sb, 'files'), { recursive: true }); for (const f of ev.files) fs.copyFileSync(f, path.join(sb, 'files', path.basename(f).slice((ev.pre || ev.ref + '-note-event-file-').length).replace(/^\d+-/, ''))); }
  writeJSON(path.join(sb, 'ledger.json'), {
    milestones: (s.milestones || []).filter(m => m.pathStatus !== 'retired').sort((a, b) => (a.order || 0) - (b.order || 0)).map(m => ({ id: m.id, name: m.short, event: m.event || '', witness: m.witness || '', proof: m.evidence || '', deliveryCondition: m.deliveryCondition || '', done: m.state === 'done' })),
    assumptions: ((s.company || {}).assumptions || []).map(a => ({ id: a.id, text: a.text, grade: a.grade || 'guess', cheapestTest: a.cheapestTest || '' })),
    nextExternalAction: (s.company || {}).nextExternalAction || null
  });
  writeConfirmedPage(sb);
  fs.copyFileSync(path.join(ROOT, 'ai-event.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'event' });
}
// out/event.json 核對：每項只可指向帳本已有嘅假設（級別要變）或者未完成嘅站；最多三項（即時生效題每包最多三條）
function checkEvent(out) {
  const ev = readJSON(path.join(out, 'event.json'), null), s = loadState(), errors = [];
  if (!ev || typeof ev !== 'object') return { ok: false, errors: ['未有交出 out/event.json，或內容無法讀取'] };
  const txt = (x, n) => typeof x === 'string' && x.trim() && x.length <= n;
  if (!txt(ev.summary, 300)) errors.push('summary 必須是一句（最多 300 字）');
  if (ev.grade != null && !NAMES.EV_KEYS.includes(ev.grade)) errors.push('grade 必須是 guess、said、did、paid、stuck 之一');
  if (!Array.isArray(ev.items)) errors.push('items 必須是清單（沒有影響就寫空清單）');
  const items = [], seen = new Set();
  (Array.isArray(ev.items) ? ev.items : []).forEach((it, i) => {
    const at = `items 第 ${i + 1} 項`;
    if (!it || typeof it !== 'object') return errors.push(at + '格式不正確');
    if (!txt(it.why, 200)) return errors.push(at + '缺少理由 why（一句，最多 200 字）');
    if (seen.has(it.kind + ':' + it.id)) return;
    if (it.kind === 'assumption') {
      const a = ((s.company || {}).assumptions || []).find(x => x.id === it.id);
      if (!a) return errors.push(at + '：找不到假設 ' + it.id);
      if (!NAMES.EV_KEYS.includes(it.grade)) return errors.push(at + '：grade 必須是 guess、said、did、paid、stuck 之一');
      if ((a.grade || 'guess') === it.grade) return; // 級別冇變：唔使問
    } else if (it.kind === 'milestone') {
      const m = (s.milestones || []).find(x => x.id === it.id);
      if (!m) return errors.push(at + '：找不到站 ' + it.id);
      if (it.done !== true) return errors.push(at + '：站的建議只可以是 done: true');
      if (m.state === 'done') return;
    } else if (it.kind === 'nextAction') {
      if (!txt(it.text, 120)) return errors.push(at + '：下一個對外動作 text 必須是一句（最多 120 字）');
      if (it.milestoneId && !(s.milestones || []).some(x => x.id === it.milestoneId)) return errors.push(at + '：找不到站 ' + it.milestoneId);
      if (((s.company || {}).nextExternalAction || {}).text === it.text.trim()) return;
    } else return errors.push(at + '：kind 必須是 assumption、milestone 或 nextAction');
    seen.add(it.kind + ':' + it.id); items.push(it);
  });
  if (errors.length) return { ok: false, errors };
  if (items.length > 3) log(`真實事件建議多過三項，只問頭三項：${items.slice(3).map(x => x.kind + ':' + x.id).join('、')}`);
  return { ok: true, ev, items: items.slice(0, 3) };
}
function eventPack(run, s, input, items) {
  const qs = items.map((it, i) => {
    if (it.kind === 'assumption') {
      const a = s.company.assumptions.find(x => x.id === it.id), from = a.grade || 'guess';
      const yes = U.evChange + '「' + NAMES.evName(it.grade) + '」', keep = U.evKeep + '「' + NAMES.evName(from) + '」';
      return { id: 'q' + (i + 1), priority: i + 1, about: a.text, ask: '「' + a.text + '」現在到了哪個程度？', judge: U.evJudge, kind: 'choice', effect: 'now',
        options: [{ text: yes, rec: true, apply: { op: 'setAssumptionGrade', id: a.id, grade: it.grade } }, { text: keep, apply: { op: 'keep', id: a.id } }], value: yes, why: it.why };
    }
    if (it.kind === 'nextAction') {
      const cur = ((s.company || {}).nextExternalAction || {}).text || '';
      return { id: 'q' + (i + 1), priority: i + 1, about: U.nextActionAsk, ask: U.nextActionAsk, kind: 'choice', effect: 'now',
        options: [{ text: clip(it.text.trim(), 120), rec: true, apply: { op: 'setNextExternalAction', text: clip(it.text.trim(), 120), milestoneId: it.milestoneId || '' } }].concat(cur ? [{ text: clip(NAMES.t('nextActionKeep', { t: clip(cur, 60) }), 100), apply: { op: 'keep' } }] : []), value: clip(it.text.trim(), 120), why: it.why };
    }
    const m = s.milestones.find(x => x.id === it.id);
    return { id: 'q' + (i + 1), priority: i + 1, about: m.short, ask: '「' + m.short + '」這一站是否已經完成？', judge: NAMES.t('msJudge', { c: String(m.deliveryCondition || m.event || m.short).trim().replace(/[。.]+$/, '') }), kind: 'choice', effect: 'now',
      options: [{ text: U.msDoneYes, rec: true, apply: { op: 'markDone', id: m.id } }, { text: U.msDoneNo, apply: { op: 'keep', id: m.id } }], value: U.msDoneYes, why: it.why };
  });
  const iv = input.kind === 'interview';
  return { format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-ev', title: (iv ? U.interviewConfirm : U.eventConfirm) + '（' + dayText(input.eventDate) + '）',
    context: iv ? NAMES.t('interviewSaid', { d: dayText(input.eventDate), t: clip(input.title.replace(/^[^：]*：/, ''), 80) }) : '你記錄了 ' + dayText(input.eventDate) + ' 的真實事件：「' + clip(input.title.replace(/^真實事件（[^）]*）：/, ''), 80) + '」。AI 據此擬定以下更新，每項經你確認後才會生效。',
    afterConfirm: '確認的項目即時更新公司紀錄及營運監察台', next: null, askedBy: 'AI', askedAt: localIso(), fromRun: run.id, todoType: 'decision', realEvent: { inputId: input.id, date: input.eventDate }, questions: qs };
}
async function finishEvent(run, sb, label, styleWarnings) {
  const out = path.join(sb, 'out');
  let chk = checkEvent(out);
  if (!chk.ok) {
    log(`${run.id} 真實事件建議格式唔啱：${chk.errors.join('；')}；叫 AI 修正一次`);
    writeJSON(path.join(sb, 'job.json'), { type: 'event-repair', errors: chk.errors });
    fs.writeFileSync(path.join(sb, 'task.md'), ['# 你今次嘅工作：修正真實事件建議', '', '你啱啱寫嘅 `out/event.json` 有以下問題，請照 `ai-event.md` 嘅格式改好，其他內容唔好改：', '',
      ...chk.errors.map((e, i) => `${i + 1}. ${e}`), '', '可以用嘅假設同站喺 `ledger.json`。改完覆寫 `out/event.json`。只可以寫 `out/`。'].join('\n') + '\n');
    fs.copyFileSync(path.join(ROOT, 'ai-event.md'), path.join(sb, 'ai-event.md'));
    const r = await runAI(sb);
    if (r.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r.meta.total_cost_usd || 0);
    chk = r.ok ? checkEvent(out) : chk;
  }
  const s = loadState(), input = (s.inputs || []).find(i => i.id === 'in-' + run.ref);
  if (!chk.ok || !input) { step(run, 'ai', label, 'failed', U.eventFailed); return finish(run, 'failed', U.eventFailed); }
  fs.cpSync(out, path.join(DIR.work, run.id), { recursive: true });
  writeJSON(path.join(DIR.work, run.id, 'run.json'), { id: run.id, kind: run.kind, ref: run.ref, label, startedAt: run.startedAt, aiCost: run.aiCost || null });
  input.summary = clip(chk.ev.summary.trim(), 300);
  if (chk.ev.grade) input.grade = chk.ev.grade;
  if (!chk.items.length) {
    input.status = 'processed'; input.processedAt = localIso(); saveState(s);
    run.result = { summary: input.summary + ' ' + U.eventNoChange, artifacts: [], founderNext: [], styleWarnings };
    step(run, 'ai', label, 'done', U.eventNoChange); return finish(run, 'done');
  }
  const placed = placePacks(DIR, [eventPack(run, s, input, chk.items)]);
  input.status = 'awaitingFounder'; input.awaitingFounderText = U.eventAwaiting; input.packId = placed[0].id;
  saveState(s);
  run.result = { summary: input.summary, artifacts: [], founderNext: [], asks: placed, styleWarnings };
  step(run, 'ai', label, 'done', `已擬定 ${placed[0].count} 條確認問題，等你確認`);
  finish(run, 'done');
}
// 你確認真實事件：只套用答咗嘅即時生效題（未答嘅留低等你）；同一題唔會套用兩次
function handleEventConfirm(run, pack, store) {
  const s = loadState(), input = (s.inputs || []).find(i => i.id === pack.realEvent.inputId);
  if (!input) { run.result = { summary: '已記錄你的答案；找不到這件事的紀錄。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const applied = new Set(input.appliedQids || []), date = pack.realEvent.date, said = [], doneIds = [];
  let nextSet = false;
  input.effects = input.effects || []; s.events = s.events || [];
  const ev = (type, title, relatedIds, moduleIds) => s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type, title, relatedIds, moduleIds });
  for (const q of pack.questions) {
    const a = store.answers[q.id];
    if (!a || applied.has(q.id)) continue;
    applied.add(q.id);
    const opts = q.options || [], opt = opts.find(o => o.text === a.value);
    let ap = opt ? opt.apply : null;
    // 自訂答案：證據級題寫咗一個級別名稱就照套用；其餘只記錄
    if (!opt && opts[0] && opts[0].apply.op === 'setAssumptionGrade') { const k = NAMES.evKey(String(a.value).replace(/^(?:改為|維持)/, '').replace(/[「」\s]/g, '')); ap = k ? { op: 'setAssumptionGrade', id: opts[0].apply.id, grade: k } : null; }
    if (ap && ap.op === 'setAssumptionGrade') {
      const as = ((s.company || {}).assumptions || []).find(x => x.id === ap.id);
      if (!as) continue;
      const from = as.grade || 'guess';
      if (from === ap.grade) { input.effects.push({ targetKind: 'assumption', targetId: as.id, change: '「' + clip(as.text, 30) + '」維持「' + NAMES.evName(from) + '」' }); continue; }
      as.grade = ap.grade; as.sourceId = input.id; as.changedAt = date; ADVANCED = true;
      as.status = EV_RANK(ap.grade) < EV_RANK(from) ? 'weakened' : EV_RANK(ap.grade) >= 2 ? 'supported' : 'open';
      const t = '「' + clip(as.text, 30) + '」由「' + NAMES.evName(from) + '」改為「' + NAMES.evName(ap.grade) + '」';
      input.effects.push({ targetKind: 'assumption', targetId: as.id, change: t });
      ev('input', '證據級更新：' + t, [as.id, input.id], ['evidence', 'inputs']); said.push(t);
    } else if (ap && ap.op === 'markDone') {
      const m = (s.milestones || []).find(x => x.id === ap.id);
      if (!m || m.state === 'done') continue;
      m.state = 'done'; m.doneAt = date; m.doneEvidence = [input.file, ...(input.files || [])].filter(Boolean); m.doneInputId = input.id; doneIds.push(m.id); ADVANCED = true;
      const t = '站點「' + m.short + '」已完成（' + dayText(date) + '，經你確認）';
      input.effects.push({ targetKind: 'decision', targetId: pack.id, change: t });
      ev('milestone', '站點完成：' + m.short + '（' + dayText(date) + '）', [m.id, input.id], ['now', 'paths', 'evidence']); said.push(t);
    } else if (ap && ap.op === 'setNextExternalAction') {
      s.company = s.company || {};
      s.company.nextExternalAction = { text: ap.text, milestoneId: ap.milestoneId || '' }; nextSet = true;
      const t = '下一個對外動作改為：' + clip(ap.text, 40);
      input.effects.push({ targetKind: 'decision', targetId: pack.id, change: t });
      ev('decision', t, [input.id].concat(ap.milestoneId ? [ap.milestoneId] : []), ['now', 'paths']); said.push(t);
    } else input.effects.push({ targetKind: 'decision', targetId: pack.id, change: '「' + clip(q.about || q.ask, 30) + '」維持不變' });
  }
  // 站點完成後（3.3，唯一定義處）：下一站自動進行中；小旗掛喺完成咗嘅站，就喺同一份確認加一題「下一個對外動作」，你答咗小旗先移，未答標「待更新」
  if (doneIds.length) {
    ensureActive(s.milestones);
    const nea = (s.company || {}).nextExternalAction;
    const askedNext = pack.questions.some(q => q.id === 'nad' || ((q.options || []).some(o => o.apply && o.apply.op === 'setNextExternalAction') && !store.answers[q.id]));
    if (nea && doneIds.includes(nea.milestoneId) && !nextSet && !askedNext) {
      const conf = s.milestones.filter(m => m.pathStatus === 'confirmed' && m.state !== 'done').sort((a, b) => (a.order || 0) - (b.order || 0));
      const nx = conf.find(m => m.state === 'active') || conf[0], m0 = s.milestones.find(m => m.id === nea.milestoneId);
      const sug = nx ? clip(String(nx.event || nx.short).trim(), 100) : '';
      pack.questions.push({ id: 'nad', priority: pack.questions.length + 1, about: U.nextActionAsk, ask: NAMES.t('nextAfterDone', { s: m0.short }), kind: 'choice', effect: 'now',
        options: (sug ? [{ text: sug, rec: true, apply: { op: 'setNextExternalAction', text: sug, milestoneId: nx.id } }] : []).concat([{ text: U.unknownLater, ...(sug ? {} : { rec: true }), apply: { op: 'keep' } }]),
        value: sug || U.unknownLater, why: U.nextAfterDoneWhy + (sug ? '建議按「' + nx.short + '」這一站要發生的事填寫。' : '') });
      writeJSON(path.join(DIR.asks, pack.id + '.json'), pack);
      s.company.nextExternalAction = { ...nea, pendingUpdate: true };
      said.push('下一站「' + (nx ? nx.short : '') + '」已開始；下一個對外動作待你確認');
    }
  }
  input.appliedQids = [...applied];
  const left = pack.questions.filter(q => !store.answers[q.id]).length;
  input.status = left ? 'awaitingFounder' : 'processed';
  if (!left) { input.processedAt = localIso(); delete input.awaitingFounderText; }
  saveState(s);
  run.result = { summary: said.length ? '已更新：' + said.join('；') + '。' : '已記錄；證據級及站點進度維持不變。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
/* ---------- 深化站點（規劃書 3.3 深度檢查五問；7.4「先待深化、經追問轉已深化」）----------
   外殼按帳本機械出題：路線上第一個待深化、未完成、屬真事、喺本季目標之內嘅站；先問未有答案嘅項，假設多過三項就再問假設項，最多三題。
   你寫嘅答案存入 founderText（你原話），照 AI 推斷唔算來源；答齊一包就出下一個站。 */
function placeDepthPack(run) {
  const s = loadState();
  if (s.demo === true) return null;
  if (listPacks(DIR).some(p => p.open && (loadPack(DIR, p.id) || {}).depth)) return null;
  const unk = openUnknowns(DIR), Q = (m, k) => ({ about: m.short + '：' + U['depthQ' + (k + 1)], ask: '「' + m.short + '」：' + U['depthQ' + (k + 1)] });
  const askable = m => { const a = (m.depthAnswers || []).map(x => x && typeof x === 'object' ? x : { text: String(x || ''), answered: !!x, assumed: false }); while (a.length < 5) a.push({ text: '', answered: false, assumed: false });
    let ks = a.map((x, k) => k).filter(k => !a[k].answered); if (a.filter(x => x.assumed).length > 3) ks = ks.concat(a.map((x, k) => k).filter(k => a[k].assumed));
    return ks.filter(k => !unk.some(u => sameThing(Q(m, k), u))); };
  const m = (s.milestones || []).filter(x => x.pathStatus === 'confirmed' && x.state !== 'done' && x.kind !== 'task' && !x.beyondGoal && x.depth === 'shallow').sort((a, b) => (a.order || 0) - (b.order || 0)).find(x => askable(x).length);
  if (!m) { if (s.ledgerFrom && s.depthPackFor !== s.ledgerFrom) { s.depthPackFor = s.ledgerFrom; saveState(s); } return null; }
  const ans = (m.depthAnswers || []).map(a => a && typeof a === 'object' ? a : { text: String(a || ''), answered: !!a, assumed: false });
  while (ans.length < 5) ans.push({ text: '', answered: false, assumed: false });
  const ks = askable(m);
  const qs = ks.slice(0, 3).map((k, i) => {
    const ask = '「' + m.short + '」：' + U['depthQ' + (k + 1)], about = m.short + '：' + U['depthQ' + (k + 1)];
    return ans[k].answered ? { id: 'd' + (k + 1), priority: i + 1, about, ask, kind: 'text', value: ans[k].text, why: U.depthWhyAI, effect: 'tentative' }
      : { id: 'd' + (k + 1), priority: i + 1, about, ask, kind: 'choice', options: [{ text: U.unknownLater, rec: true }], value: U.unknownLater, why: U.depthWhyNone, effect: 'tentative' };
  });
  s.depthPackFor = s.ledgerFrom; saveState(s);
  const pack = { format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-dp', title: clip(NAMES.t('depthTitle', { s: m.short }), 60), context: NAMES.t('depthContext', { s: m.short }), afterConfirm: '答案寫入這一站的深度檢查',
    next: null, askedBy: 'AI', askedAt: localIso(), fromRun: run ? run.id : null, todoType: 'question', depth: { milestoneId: m.id }, questions: qs };
  return placePacks(DIR, [pack])[0];
}
function handleDepthAnswer(run, pack, store) {
  const s = loadState(), m = (s.milestones || []).find(x => x.id === pack.depth.milestoneId);
  if (!m) { run.result = { summary: '已記錄你的答案；找不到這一站。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const before = m.depth;
  const ans = [0, 1, 2, 3, 4].map(k => { const a = (m.depthAnswers || [])[k]; return a && typeof a === 'object' ? { ...a } : { text: String(a || ''), answered: !!a, assumed: false }; });
  let n = 0;
  for (const q of pack.questions) {
    const a = store.answers[q.id], k = Number(String(q.id).slice(1)) - 1, val = String(a && a.value != null ? a.value : '').trim();
    if (!a || !val || val === U.unknownLater || !(k >= 0 && k < 5)) continue;
    if (!a.changed && val === String(q.value) && ans[k].text) ans[k].adopted = true; else ans[k].founderText = clip(val, 400);
    n++;
  }
  const dp = depthOf(ans.map(a => ({ text: a.text, origin: a.assumed ? 'ai' : a.answered ? 'doc' : 'missing', founderText: a.founderText, adopted: a.adopted })));
  m.depth = dp.depth; m.depthAnswers = dp.answers;
  s.events = s.events || [];
  if (before === 'shallow' && m.depth === 'ok') s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'milestone', title: NAMES.t('msDeepened', { s: m.short }), relatedIds: [m.id], moduleIds: ['now', 'paths'] });
  saveState(s);
  const left = pack.questions.filter(q => !store.answers[q.id]).length;
  const next = left ? null : placeDepthPack(run);
  run.result = { summary: (n ? '已記錄你的 ' + n + ' 項答案' : '已記錄') + '；「' + m.short + '」' + (m.depth === 'ok' ? '已深化。' : '仍待深化。') + (next ? '下一站的深化問題已放上待決事項。' : ''), artifacts: [], founderNext: [], asks: next ? [next] : [] };
  return finish(run, 'done');
}
// 答「不知道／稍後提供」：記入帳本缺少的細節（規劃書附錄 A intake.missingDetails），一星期內唔再問；之後答咗真答案就清走同一件事
function markUnknowns(pack, answers, at) {
  const qs = Object.fromEntries(pack.questions.map(q => [q.id, q]));
  const got = answers.filter(a => qs[a.id] && qs[a.id].effect !== 'now');
  if (!got.length) return;
  const s = loadState(); s.intake = s.intake || {};
  const list = s.intake.missingDetails = s.intake.missingDetails || [];
  const until = localIso(new Date(clockNow().getTime() + UNKNOWN_DAYS * 86400000)).slice(0, 10);
  let changed = false;
  for (const a of got) {
    const q = qs[a.id], open = list.filter(m => !m.answeredAt && sameThing(q, m));
    if (a.value === U.unknownLater) { if (!open.length) { list.push({ question: q.ask, about: q.about || '', packId: pack.id, qid: q.id, at, until }); changed = true; } }
    else if (open.length) { for (const m of open) m.answeredAt = at; changed = true; }
  }
  if (changed) saveState(s);
}
function intakeFiles(id) { return fs.readdirSync(DIR.inbox).filter(f => f.startsWith(id + '-intake-')).sort(); }
async function handleIntake(run, file) {
  run.kind = 'intake';
  const id = file.replace(/-intake\.md$/, '');
  run.ref = id; run.replyFiles = [file];
  step(run, 'received', U.stepIntakeReceived, 'done', '');
  const sb = newSandbox(run);
  const files = intakeFiles(id);
  fs.copyFileSync(path.join(DIR.inbox, file), path.join(sb, 'intake.md'));
  fs.mkdirSync(path.join(sb, 'files'), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(DIR.inbox, f), path.join(sb, 'files', f.slice((id + '-intake-').length).replace(/^\d+-/, '')));
  // 收件匣唔可以越積越亂：登記完即搬去封存
  const now = clockNow(), dest = path.join(DIR.archive, `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, 'intake-' + id);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of [file, ...files]) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
  step(run, 'applied', U.stepIntakeRegistered, 'done', files.length ? `${files.length} 份文件` : '沒有附件');
  intakeTask(sb);
  await runAIStep(run, sb, U.stepIntakeAI, true);
}

/* ---------- 由文件預填（規劃書 3.1）：AI 只讀文件交返五條預填；外殼逐字核對原句、寫入 ledger/prefill/<id>.json；唔擬公司概覽、唔建任何紀錄 ---------- */
async function handlePrefill(run, file) {
  run.kind = 'prefill';
  const id = file.replace(/-prefill\.md$/, '');
  run.ref = id; run.replyFiles = [file];
  step(run, 'received', U.stepPrefillReceived, 'done', '');
  const sb = newSandbox(run), files = fs.readdirSync(DIR.inbox).filter(f => f.startsWith(id + '-prefill-')).sort();
  fs.mkdirSync(path.join(sb, 'files'), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(DIR.inbox, f), path.join(sb, 'files', f.slice((id + '-prefill-').length).replace(/^\d+-/, '')));
  // 收件匣唔可以越積越亂：登記完即搬去封存（掃描工具之後照呢份文件核對）
  const now = clockNow(), dest = path.join(DIR.archive, `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, 'prefill-' + id);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of [file, ...files]) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
  writeJSON(path.join(sb, 'questions.json'), INTAKE_QUESTIONS.filter(q => q.required).map(q => ({ id: 'q' + q.n, ask: q.ask, hint: q.hint })));
  datedTask(sb, 'ai-prefill.md');
  writeJSON(path.join(sb, 'job.json'), { type: 'prefill', today: todayIso() });
  step(run, 'applied', U.stepPrefillRegistered, 'done', files.length + ' 份文件');
  await runAIStep(run, sb, U.stepPrefillAI, true);
}
function finishPrefill(run, sb, label) {
  const raw = readJSON(path.join(sb, 'out', 'prefill.json'), null);
  const chk = checkPrefill(raw, docTexts(path.join(sb, 'files')));
  if (!chk.ok) { step(run, 'ai', label, 'failed', U.prefillBad); return finish(run, 'failed', U.prefillBad); }
  for (const w of chk.warnings) log(`${run.id} 預填：${w}`);
  const rec = { id: run.ref, at: localIso(), files: fs.readdirSync(path.join(sb, 'files')), answers: chk.answers, missing: PREFILL_Q.filter(q => !chk.answers[q]), runId: run.id };
  fs.mkdirSync(path.join(DIR.ledger, 'prefill'), { recursive: true });
  writeJSON(path.join(DIR.ledger, 'prefill', run.ref + '.json'), rec);
  const n = k => Object.values(chk.answers).filter(a => a.label === k).length;
  run.result = { summary: NAMES.t('prefillDoneSum', { n: Object.keys(chk.answers).length, a: n('quote'), b: n('inferred'), c: n('unverified'), d: rec.missing.length }), artifacts: [], founderNext: [] };
  step(run, 'ai', label, 'done', run.result.summary);
  return finish(run, 'done');
}
function newSandbox(run) {
  const sb = path.join(DIR.sandbox, run.id);
  fs.mkdirSync(path.join(sb, 'out'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'ask-format.md'), path.join(sb, 'ask-format.md'));
  return sb;
}

/* ---------- 生意大腦：生意體檢（規劃書 4.6 供料與觸發表；結果只係 AI 解讀或建議，唔改任何級別） ----------
   公司概覽成頁確認嗰次工作做第一次；每月覆核（距上次 28 日或以上）再做。同一次工作入面做，唔會令自動停多計一次。
   供料：已確認公司概覽、帳本假設清單同里程碑、創辦人上次對結果卡嘅意見。 */
const BRAIN_JOBS = { checkup: { task: 'ai-checkup.md', out: 'checkup.json', check: (raw, L, at) => checkCheckup(raw, L, at) }, opportunities: { task: 'ai-opportunities.md', out: 'opportunities.json', check: (raw, L, at) => checkOpportunities(raw, at) } };
// 商機掃描：已確認、已有生意體檢、距上次 6 日或以上，而且係訪問日前一日或訪問日
function opportunitiesDue(s, today) {
  const o = readJSON(brainFile(DIR, 'opportunities'), null), nextOn = s.interviews && s.interviews.nextOn;
  return !!(readJSON(CONFIRMED, null) && fs.existsSync(brainFile(DIR, 'checkup')) && nextOn && today >= addDays(nextOn, -1) && (!o || !o.updatedAt || (clockNow() - new Date(o.updatedAt)) / 86400000 >= 6));
}
const OPP_KINDS = ['政策', '資助', '時間窗', '競爭空隙'];
function checkOpportunities(raw, at) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return { ok: false, reason: '商機掃描的格式不正確' };
  const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n), tag = at.replace(/\D/g, '').slice(0, 12);
  // 外部事實一定要有出處（標題同查閱日期）；網址另放，畫面以連結顯示
  // as：AI 建議做成臨時工作（task）定係路徑選項（path，會改到已確認嘅站）；兩樣都要你決定先做
  const list = raw.list.slice(0, 5).map((o, i) => ({ id: 'opp-' + tag + '-' + (i + 1), kind: OPP_KINDS.includes(o && o.kind) ? o.kind : '時間窗', as: o && o.as === 'path' ? 'path' : 'task', title: txt(o && o.title, 80), why: txt(o && o.why, 300), firstTest: txt(o && o.firstTest, 200), window: txt(o && o.window, 60), source: txt(o && o.source, 160), url: /^https:\/\/[^\s]{4,300}$/.test(String(o && o.url || '')) ? String(o.url) : '' })).filter(o => o.title && o.why && o.firstTest && o.source);
  if (!list.length) return { ok: false, reason: '商機掃描未有寫出附出處的機會' };
  return { ok: true, result: { status: 'done', updatedAt: at, summary: txt(raw.summary, 120) || NAMES.dash.brainDone_opportunities, list } };
}
const checkupStale = () => { const c = readJSON(brainFile(DIR, 'checkup'), null); return !c || !c.updatedAt || (clockNow() - new Date(c.updatedAt)) / 86400000 >= 28; };
function brainLedger() {
  const s = loadState();
  return { assumptions: ((s.company || {}).assumptions || []).filter(a => a.status !== 'retired').map(a => ({ id: a.id, text: a.text, grade: a.grade || 'guess', cheapestTest: a.cheapestTest || '' })),
    // 已確認值（規劃書出題規則第 8 條）：路線次序、邊站已確認、進度、本季目標，AI 建議唔可以同佢哋矛盾
    milestones: (s.milestones || []).filter(m => m.pathStatus !== 'retired').sort((a, b) => (a.order || 0) - (b.order || 0)).map((m, i) => ({ id: m.id, order: i + 1, name: m.short, event: m.event || '', actor: m.actorName || '', confirmed: m.pathStatus === 'confirmed', state: m.state || 'not_started', done: m.state === 'done' })),
    quarterGoal: (s.goals && s.goals.quarter && s.goals.quarter.text) || ((s.intake && s.intake.answers && s.intake.answers.G1) || {}).value || '',
    nextExternalAction: (s.company || {}).nextExternalAction || null };
}
// 創辦人上次對呢一項結果卡嘅意見（有用／沒有用／要修改＋一句）：寫入下一次工作說明
function feedbackFor(item, prev) {
  const all = readJSON(path.join(DIR.ledger, 'brain-feedback.json'), {}) || {};
  const cards = prev ? [...(prev.weak || []), ...(prev.list || []), ...(prev.unseen || []).map(u => ({ id: u.id, title: u.text })), ...(prev.notNow || []).map(u => ({ id: u.id, title: u.text }))] : [];
  const title = id => ((cards.find(c => c.id === id) || {}).title) || ({ unseen: '你可能未想到', notnow: '目前不建議做' }[id] || '');
  return Object.entries(all).filter(([, f]) => f && f.item === item).map(([id, f]) => ({ card: title(id) || f.title || '一張結果卡', verdict: VERDICT[f.verdict] || f.verdict, text: f.text || '' }));
}
function checkCheckup(raw, L, at) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.weak)) return { ok: false, reason: '生意體檢的格式不正確' };
  const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
  const byId = Object.fromEntries(L.assumptions.map(a => [a.id, a])), tag = at.replace(/\D/g, '').slice(0, 12);
  // 證據級由帳本假設讀，唔係 AI 寫
  const weak = raw.weak.slice(0, 3).map((w, i) => { const a = byId[w && w.assumptionId]; return { id: 'weak-' + tag + '-' + (i + 1), title: txt(w && w.title, 80), assumptionId: a ? a.id : '', evidence: a ? Math.max(0, NAMES.EV_KEYS.indexOf(a.grade)) : 0, source: 'AI 解讀', why: txt(w && w.why, 300), cheapestTest: txt(w && w.cheapestTest, 200), stop: txt(w && w.stop, 200) }; }).filter(w => w.title && w.why && w.cheapestTest);
  if (!weak.length) return { ok: false, reason: '生意體檢未有寫出最弱的環節' };
  const unseen = (Array.isArray(raw.unseen) ? raw.unseen : []).slice(0, 3).map((u, i) => ({ id: 'unseen-' + tag + '-' + (i + 1), text: txt(u && (u.text || u), 200), source: 'AI 解讀' })).filter(u => u.text);
  const notNow = (Array.isArray(raw.notNow) ? raw.notNow : []).slice(0, 3).map((u, i) => ({ id: 'notnow-' + tag + '-' + (i + 1), text: txt(u && (u.text || u), 200), why: txt(u && u.why, 200) })).filter(u => u.text);
  return { ok: true, result: { status: 'done', updatedAt: at, summary: txt(raw.summary, 120) || NAMES.dash.brainDone_checkup, weak, unseen, notNow } };
}
// 一次工作入面加一步生意大腦工作（唔結束成次工作）；成功回 true
async function brainStep(run, item, opts = {}) {
  const key = 'brain-' + item, label = U['brainJob_' + item], job = BRAIN_JOBS[item];
  if (pausedNow()) return false; // 暫停中：唔開 AI，下次再做
  const ad = certified(ROOT, DIR.ledger);
  if (!ad.host) return false;
  const sb = path.join(DIR.sandbox, run.id + '-' + item);
  fs.mkdirSync(path.join(sb, 'out'), { recursive: true });
  writeConfirmedPage(sb);
  const L = brainLedger(), prev = readJSON(brainFile(DIR, item), null), fb = feedbackFor(item, prev);
  writeJSON(path.join(sb, 'ledger.json'), L);
  if (prev) writeJSON(path.join(sb, 'previous.json'), prev);
  fs.writeFileSync(path.join(sb, 'feedback.md'), '# 創辦人上次對結果卡的意見\n\n' + (fb.length ? fb.map(f => `- 「${f.card}」：${f.verdict}${f.text ? '——' + f.text : ''}`).join('\n') : '（沒有）') + '\n');
  datedTask(sb, job.task);
  writeJSON(path.join(sb, 'job.json'), { type: item, today: todayIso(), feedback: fb.length });
  step(run, key, label, 'running', `由 ${ad.label || 'AI'} 處理中`);
  const r = await runAI(sb, opts.timeoutMinutes ? { timeoutMinutes: opts.timeoutMinutes } : undefined);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (!r.ok || r.waiting) { step(run, key, label, 'failed', r.reason || 'AI 未能完成'); return false; }
  const chk = job.check(readJSON(path.join(sb, 'out', job.out), null), L, localIso());
  if (!chk.ok) { step(run, key, label, 'failed', chk.reason); return false; }
  chk.result.feedbackUsed = fb.length;
  fs.mkdirSync(path.dirname(brainFile(DIR, item)), { recursive: true });
  writeJSON(brainFile(DIR, item), chk.result);
  if (item !== 'checkup') { addEvent({ actor: 'ai', type: 'brain', title: NAMES.dash['brainDone_' + item] + '：' + clip((chk.result.list[0] || {}).title || '', 30), relatedIds: [], moduleIds: ['ai-week'] }); step(run, key, label, 'done', chk.result.summary); offerOpportunities(run, chk.result); return true; }
  // 弱位寫成假設清單嘅最便宜測試（規劃書 4.6）：未有測試、或者上次由生意體檢寫嘅，用今次嘅；其他來源寫嘅（例如創辦人自己寫）唔郁；唔改級別
  const s = loadState(); let filled = 0;
  for (const w of chk.result.weak) { const a = ((s.company || {}).assumptions || []).find(x => x.id === w.assumptionId); if (a && (!String(a.cheapestTest || '').trim() || a.cheapestTestBy === 'checkup') && a.cheapestTest !== w.cheapestTest) { a.cheapestTest = w.cheapestTest; a.cheapestTestBy = 'checkup'; a.cheapestTestAt = chk.result.updatedAt; filled++; } }
  if (filled) saveState(s);
  offerDebate(run, chk.result);
  addEvent({ actor: 'ai', type: 'brain', title: NAMES.dash.brainDone_checkup + '：' + clip(chk.result.weak[0].title, 30), relatedIds: chk.result.weak.map(w => w.assumptionId).filter(Boolean), moduleIds: ['ai-week'] });
  step(run, key, label, 'done', chk.result.summary);
  return true;
}
// 生意大腦放上 Founder Desk 嘅建議（每份結果最多一包）：ledger/brain-offers.json 記低邊份結果出過、問題包編號
const OFFERS = path.join(DIR.ledger, 'brain-offers.json');
const offered = (k, at) => { const o = (readJSON(OFFERS, {}) || {})[k]; return !!(o && o.resultAt === at); };
function noteOffer(k, at, packId) { const all = readJSON(OFFERS, {}) || {}; all[k] = { resultAt: at, packId, at: localIso() }; writeJSON(OFFERS, all); }
// AI 寫嘅句子放上 Founder Desk 之前：假設編號換成假設內容（同生意大腦頁一樣嘅最後保險）
const plainOf = s => deCodeInfo(String(s || ''), { assumptions: ledgerAssumptions(DIR) }).text;
// 有一場辯論做緊或者等你（未採用轉強卡、未失敗）就唔再建議；失敗咗嘅唔擋（你仍然可以喺 Founder Desk 重跑嗰場）
const debateBusy = () => { const last = listMatches(DIR, brainSource(DIR)).pop(); return pendingMatches(DIR).length > 0 || !!(last && !['adopted', 'failed'].includes(last.phase)); };
// 生意體檢之後：AI 按最弱嘅環節建議開一場紅藍對打（確認類待決定，規劃書 4.6）。外殼唔會自己開場：你答「開始」先開。
// 已經有一場做緊或者等你、或者已有一包未答，就唔再建議
function offerDebate(run, ck) {
  const w = (ck.weak || [])[0];
  if (!w || !loadPage() || offered('debate', ck.updatedAt) || openRhythm('debate') || debateBusy()) return null;
  const wt = plainOf(w.title), title = clip(NAMES.t('debateOfferTopic', { t: wt }), 120);
  const placed = placePacks(DIR, [rhythmPack('db', { title: U.debateOfferTitle, context: U.debateOfferContext, afterConfirm: U.debateOfferAfter, todoType: 'decision', brainItem: 'wargame', fromRun: run.id,
    rhythm: { kind: 'debate', topicType: 'business', title, targetId: /^[\w-]{1,40}$/.test(String(w.assumptionId || '')) ? w.assumptionId : '', checkupAt: ck.updatedAt },
    questions: [{ id: 'open', priority: 1, ask: NAMES.t('debateOfferAsk', { t: clip(wt, 60) }), kind: 'choice', effect: 'now', options: [{ text: U.debateOfferYes, rec: true }, { text: U.debateOfferNo }], value: U.debateOfferYes, why: clip(plainOf(w.why), 140) || U.debateOfferWhy }] })])[0];
  if (placed) { noteOffer('debate', ck.updatedAt, placed.id); log(`${run.id} 生意體檢之後建議開一場辯論：${placed.id}`); }
  return placed;
}
function handleDebateOfferAnswer(run, pack, store) {
  const a = store.answers.open, d = pack.rhythm;
  if (!a || a.value !== U.debateOfferYes) { run.result = { summary: U.debateOfferNoted, artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  if (debateBusy()) { run.result = { summary: U.debateOfferBusy, artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const { id, format } = openMatch({ topicType: d.topicType, title: d.title, seats: SEATS[d.topicType], level: 'normal', targetId: d.targetId }, { offerPackId: pack.id });
  run.result = { summary: '已開一場辯論：' + clip(d.title, 40) + '（' + format + '）', artifacts: [], founderNext: [], matchId: id };
  return finish(run, 'done');
}
// 商機掃描之後（規劃書 4.6）：機會寫成臨時工作建議或路徑選項，一律經你決定。最多三個，每個一條「要跟進嗎？」；
// 上一包未答就唔再放（你未決定上星期嘅機會）。答咗「做成臨時工作」「考慮因此改路線」，外殼代你交一份要求，行返臨時工作或改路線嘅流程（AI 先擬範圍或選項再問你）
function offerOpportunities(run, res) {
  const list = (res.list || []).slice(0, 3).map(o => ({ ...o, title: plainOf(o.title), why: plainOf(o.why), firstTest: plainOf(o.firstTest), source: plainOf(o.source) }));
  if (!list.length || !loadPage() || offered('opportunities', res.updatedAt) || openRhythm('opportunity')) return null;
  const placed = placePacks(DIR, [rhythmPack('op', { title: U.oppOfferTitle, context: U.oppOfferContext, afterConfirm: U.oppOfferAfter, todoType: 'decision', brainItem: 'opportunities', fromRun: run.id,
    rhythm: { kind: 'opportunity', resultAt: res.updatedAt, ids: list.map(o => o.id) },
    questions: list.map((o, i) => { const rec = o.as === 'path' ? U.oppRoute : U.oppTask;
      return { id: 'o' + (i + 1), priority: i + 1, opp: o.id, oppData: { title: o.title, why: o.why, firstTest: o.firstTest, source: o.source }, ask: NAMES.t('oppAsk', { t: clip(o.title, 60) }), kind: 'choice', effect: 'now', options: [U.oppTask, U.oppRoute, U.oppLater, U.oppDrop].map(t => ({ text: t, ...(t === rec ? { rec: true } : {}) })), value: rec, why: clip(NAMES.t('oppWhy', { w: o.why + (/[。！？.!?]$/.test(o.why) ? '' : '。'), f: o.firstTest }), 300) }; }) })])[0];
  if (placed) { noteOffer('opportunities', res.updatedAt, placed.id); log(`${run.id} 商機放上待決事項：${placed.id}`); }
  return placed;
}
// 外殼代你交要求（同監察台「交要求」一樣嘅格式同檔名；你喺問題包揀咗先會交）；檔頭多一行出處（AI 只讀內文）
function founderNote(type, text, from) {
  const d = clockNow(), at = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  let n = Date.now() % 1000, f;
  while (fs.existsSync(f = path.join(DIR.inbox, `${at}-${String(n).padStart(3, '0')}-note-${type}.md`))) n = (n + 1) % 1000;
  fs.writeFileSync(f, `kind: note\ntype: ${type}\nat: ${localIso()}\nfrom: ${from}\n\n${text.replace(/\s+/g, ' ').trim()}\n`, { flag: 'wx' });
  return path.basename(f);
}
// 機會內容喺問題包入面（之後再掃描、結果檔換咗都照用得）
function handleOpportunityAnswer(run, pack, store) {
  const said = [], fb = readJSON(FEEDBACK, {}) || {};
  for (const q of pack.questions) {
    const a = store.answers[q.id], o = q.oppData && { id: q.opp, ...q.oppData };
    if (!a || !o) continue; // 必須先問：未答唔做
    const from = 'opportunity ' + pack.id + ' ' + o.id;
    if (a.value === U.oppTask) { founderNote('adhoc', NAMES.t('oppNoteTask', { t: o.title, f: o.firstTest, s: o.source }), from); said.push('「' + clip(o.title, 20) + '」' + U.oppTask); }
    else if (a.value === U.oppRoute) { founderNote('order', NAMES.t('oppNoteRoute', { t: o.title, w: o.why, f: o.firstTest, s: o.source }), from); said.push('「' + clip(o.title, 20) + '」' + U.oppRoute); }
    else if (a.value === U.oppDrop) { fb[o.id] = { item: 'opportunities', verdict: 'useless', text: U.oppDropNote, title: o.title, at: localIso(), packId: pack.id }; said.push('「' + clip(o.title, 20) + '」' + U.oppDrop); }
  }
  if (said.some(t => t.endsWith(U.oppDrop))) writeJSON(FEEDBACK, fb);
  run.result = { summary: said.length ? '已記錄：' + said.join('；') + '。' : '已記錄：暫不跟進這些機會。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}

/* ---------- 公司概覽 ---------- */
async function aiAfterProofread(run) {
  // 公司概覽成頁確認後嘅首次工作：先做生意體檢（規劃書 4.6），再準備下一步；體檢唔成功都照準備下一步
  if (!fs.existsSync(brainFile(DIR, 'checkup'))) await brainStep(run, 'checkup');
  const page = loadPage(), reg = registry(page), c = readJSON(CONFIRMED, null);
  const flag = Object.values(reg).find(e => e.flagTo);
  const next = flag ? c.values[flag.id] : '';
  const sb = newSandbox(run);
  writeConfirmedPage(sb);
  fs.copyFileSync(path.join(ROOT, 'ai-next-step.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'proofread-next' });
  await runAIStep(run, sb, next ? `${U.aiNext}：${next}` : U.aiNext, false);
}
async function handleProofread(run, files) {
  run.kind = 'proofread';
  const page = loadPage();
  if (!page) { step(run, 'applied', U.stepApplyConfirm, 'failed', '未有公司概覽'); return finish(run, 'failed', '未有公司概覽'); }
  const reg = registry(page), hash = fnv(JSON.stringify(page));
  run.ref = page.page.id;
  step(run, 'received', U.stepReceivedConfirm, 'done', `${files.length} 份回覆`);
  const latest = files[files.length - 1];
  const { head, machine } = parseReply(fs.readFileSync(path.join(DIR.replies, latest), 'utf8'));
  let why = '';
  if (head.kind !== 'proofread' || !machine) why = '回覆格式不正確，無法套用';
  else if (head.ref !== page.page.id) why = '回覆與目前的公司概覽不相符';
  else if (head.hash !== hash) why = '你確認時所見的版本已經更改，請重新開啟頁面再確認';
  if (why) { archive(files); step(run, 'applied', U.stepApplyConfirm, 'failed', why); return finish(run, 'failed', why); }
  const values = {};
  for (const [id, e] of Object.entries(reg)) values[id] = String(e.value ?? '');
  for (const ed of machine.edits || []) if (reg[ed.id]) values[ed.id] = String(ed.value ?? '');
  const c = {
    company: page.company.name, pageId: page.page.id, confirmedAt: machine.confirmedAt, replyFile: latest,
    order: machine.order, orderChanged: !!machine.orderChanged, nextActionMilestone: machine.nextActionMilestone,
    edits: machine.edits || [], stillMissing: machine.stillMissing || [], note: machine.note || '', values,
    kinds: Object.fromEntries(page.path.milestones.map(m => [m.id, (machine.kinds || {})[m.id] === 'task' || (!(machine.kinds || {})[m.id] && m.kind === 'task') ? 'task' : 'real'])), kindsChanged: Array.isArray(machine.kindsChanged) ? machine.kindsChanged.filter(id => page.path.milestones.some(m => m.id === id)) : []
  };
  const prev = readJSON(CONFIRMED, null);
  writeJSON(CONFIRMED, c);
  archive(files);
  syncLedger();
  // 紀錄：你改咗嘅每項、你答咗嘅「要你決定」、次序、其餘一句
  const at = localIso(), base = { at, source: 'proofread', packId: page.page.id, packTitle: U.company, reply: latest, runId: run.id };
  const effectIds = new Set(listOf(page.detail && page.detail.rules).filter(r => r.effect).map(r => r.id));
  const entries = c.edits.map(e => ({ ...base, qid: e.id, question: e.label, ai: e.ai, answer: e.founder, changed: true, effect: effectIds.has(e.id) ? 'now' : 'tentative' }));
  const editedIds = new Set(c.edits.map(e => e.id));
  for (const d of machine.decided || []) {
    if (!d.answered || editedIds.has(d.id) || !reg[d.id]) continue;
    entries.push({ ...base, qid: d.id, question: reg[d.id].ask || reg[d.id].label, ai: show(reg[d.id], reg[d.id].value), answer: show(reg[d.id], reg[d.id].value), changed: false, effect: 'tentative' });
  }
  const ms = Object.fromEntries(page.path.milestones.map(m => [m.id, m.short]));
  if (Array.isArray(machine.order)) entries.push({ ...base, qid: 'order', question: U.routeOrder, ai: (machine.orderProposed || []).map(i => ms[i]).join(' → '), answer: machine.order.map(i => ms[i]).join(' → '), changed: c.orderChanged, effect: 'now' });
  const kindName = k => k === 'task' ? U.kindTask : U.kindReal;
  for (const m of page.path.milestones) entries.push({ ...base, qid: 'kind-' + m.id, question: '「' + m.short + '」是' + U.kindReal + '還是' + U.kindTask + '？', ai: kindName(m.kind), answer: kindName(c.kinds[m.id]), changed: c.kindsChanged.includes(m.id), effect: 'tentative' });
  entries.push({ ...base, qid: 'rest', question: U.restAI, ai: '', answer: U.restAdopted, changed: false, effect: 'tentative' });
  appendLog(DIR, entries);
  const n = c.edits.length;
  step(run, 'applied', U.stepAppliedConfirm, 'done', `${n ? '修改了 ' + n + ' 項' : '全部按 AI 建議'}；次序${c.orderChanged ? '由你調整' : '按 AI 建議'}`);
  // 再次確認：只有首次確認，或者改動影響下一步（下一個對外動作、佢屬邊一站、路線次序）先開 AI 準備下一步，免得改一個程度都重做
  const flag = Object.values(reg).find(e => e.flagTo);
  const affectsNext = !prev || prev.pageId !== c.pageId || prev.nextActionMilestone !== c.nextActionMilestone
    || JSON.stringify(prev.order || []) !== JSON.stringify(c.order || []) || (flag && String((prev.values || {})[flag.id] ?? '') !== String(c.values[flag.id] ?? ''));
  if (!prev || prev.pageId !== c.pageId) placeDepthPack(run);
  if (!affectsNext) {
    // 唔使重新準備下一步；但未做過生意體檢就照做（例如升級前已確認嘅公司）
    if (!fs.existsSync(brainFile(DIR, 'checkup'))) await brainStep(run, 'checkup');
    run.result = { summary: U.aiNextSkip, artifacts: [], founderNext: [] }; return finish(run, 'done');
  }
  await aiAfterProofread(run);
}

/* ---------- 問題包 ---------- */
function answersMarkdown(pack, ans) {
  const L = [`# ${pack.title}：而家嘅答案`, ''];
  for (const q of pack.questions) {
    const a = ans[q.id];
    L.push(`## ${q.ask}`);
    if (a && a.value === U.unknownLater) L.push(`- 答案：${U.unknownLater}`, '- 狀態：創辦人而家答唔到，稍後提供；一星期內唔好再問，用到時當未知處理');
    else if (a) L.push(`- 答案：${showAns(q, a.value)}`, `- 狀態：創辦人答咗（${a.changed ? '改咗 AI 建議' : '照 AI 建議'}）`);
    else L.push(`- 答案：${showAns(q, q.value)}`, '- 狀態：先咁計住（AI 建議，創辦人未答）');
    L.push('');
  }
  return L.join('\n');
}
async function aiAfterAsk(run, pack) {
  const ans = loadAnswers(DIR, pack.id).answers;
  const sb = newSandbox(run);
  writeJSON(path.join(sb, 'job.json'), { type: 'ask-continue' });
  writeJSON(path.join(sb, 'pack.json'), pack);
  fs.writeFileSync(path.join(sb, 'answers.md'), answersMarkdown(pack, ans));
  writeConfirmedPage(sb);
  // AI 自己出嘅問題包：將出題嗰一步嘅產出放入 previous/，等 AI 喺上面改，唔使由零開始
  const prev = /^R[\w-]{1,40}$/.test(String(pack.fromRun || '')) ? path.join(DIR.work, pack.fromRun) : null;
  if (prev && fs.existsSync(prev)) {
    fs.mkdirSync(path.join(sb, 'previous'), { recursive: true });
    for (const f of fs.readdirSync(prev).filter(f => f.endsWith('.md'))) fs.copyFileSync(path.join(prev, f), path.join(sb, 'previous', f));
  }
  fs.writeFileSync(path.join(sb, 'task.md'), fs.readFileSync(path.join(ROOT, 'ai-continue.md'), 'utf8') + '\n\n## 今次要做嘅工作\n\n' + pack.next.task + '\n');
  await runAIStep(run, sb, pack.afterConfirm ? U.aiFollow + '：' + clip(pack.afterConfirm, 50) : U.aiFollowAns, true);
}
async function handleAsk(run, file) {
  run.kind = 'ask';
  const { head, machine } = parseReply(fs.readFileSync(path.join(DIR.replies, file), 'utf8'));
  const pack = loadPack(DIR, head.ref);
  run.ref = head.ref;
  step(run, 'received', U.stepReceivedAns, 'done', pack ? pack.title : '');
  let why = '';
  if (head.kind !== 'ask-answer' || !machine) why = '回覆格式不正確，無法套用';
  else if (!pack) why = '找不到此問題包';
  else if (head.hash !== fnv(JSON.stringify(pack))) why = '問題包已經更改，請重新開啟頁面再作答';
  if (why) { archive([file]); step(run, 'applied', U.stepApplyAns, 'failed', why); return finish(run, 'failed', why); }
  const store = loadAnswers(DIR, pack.id);
  const qs = Object.fromEntries(pack.questions.map(q => [q.id, q]));
  const at = localIso(), entries = [];
  for (const a of machine.answers || []) {
    const q = qs[a.id];
    if (!q) continue;
    store.answers[a.id] = { value: a.value, changed: !!a.changed, at, reply: file, runId: run.id, ...(machine.allSame && !a.changed ? { confirmedSame: true } : {}) };
    entries.push({ at, source: 'ask', packId: pack.id, packTitle: pack.title, qid: q.id, question: q.ask, ai: showAns(q, q.value), answer: showAns(q, a.value), changed: !!a.changed, effect: q.effect || 'tentative', reply: file, runId: run.id, ...(a.value === U.unknownLater ? { unknown: true } : {}), ...(machine.allSame && !a.changed ? { confirmedSame: true } : {}) });
  }
  writeJSON(path.join(DIR.answers, pack.id + '.json'), store);
  archive([file]);
  appendLog(DIR, entries);
  markUnknowns(pack, machine.answers || [], at);
  const left = pack.questions.filter(q => !store.answers[q.id]).length;
  const applied = pack.request && pack.request.type === 'order' ? applyOrder(pack, store, run) : '';
  step(run, 'applied', U.stepAppliedAns, 'done', `今次回答了 ${entries.length} 條` + (left ? `；另有 ${left} 條暫按 AI 建議` : '；此問題包已全部回答') + (applied ? '；' + applied : ''));
  if (pack.rhythm) { const fresh = new Set((machine.answers || []).map(a => a.id)), k = pack.rhythm.kind;
    if (k === 'interview') return handleInterviewAnswer(run, pack, store, fresh);
    if (k === 'monthly') return handleMonthlyAnswer(run, pack, store);
    if (k === 'trial') return handleTrialAnswer(run, pack, store);
    if (k === 'second') return handleSecondAnswer(run, pack, store);
    if (k === 'debate') return handleDebateOfferAnswer(run, pack, store);
    if (k === 'opportunity') return handleOpportunityAnswer(run, pack, store);
    if (k === 'autoStop' || k === 'paused') return handleStopAnswer(run, pack, store);
    if (k === 'retire') return handleRetireAnswer(run, pack, store); }
  if (pack.realEvent) return handleEventConfirm(run, pack, store);
  if (pack.depth) return handleDepthAnswer(run, pack, store);
  if (pack.acceptance) return handleAcceptance(run, pack, store);
  if (pack.actionConfirm) return handleActionConfirm(run, pack, store);
  if (pack.debate) return handleDebateAnswer(run, pack, store);
  if (pack.taskId && pack.next && pack.next.task) { run.taskId = pack.taskId; upsertTask({ id: pack.taskId, status: 'active', waitingFor: '', next: clip(pack.next.task, 60) }); }
  if (pack.next && pack.next.task) return aiAfterAsk(run, pack);
  if (applied) { run.result = { summary: applied, artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  run.result = { summary: '已記錄你的答案；此問題包沒有需要 AI 即時跟進的工作。', artifacts: [], founderNext: [] };
  finish(run, 'done');
}

// 你嘅現實行動（見客、打電話、線下交付）：只有你喺 Founder Desk 確認先算完成，AI 冇得標
function handleActionConfirm(run, pack, store) {
  const t = getTask(pack.actionConfirm.taskId);
  const a = Object.values(store.answers)[0];
  const done = !a || a.value === '已完成';
  if (t) {
    if (done) { upsertTask({ id: t.id, status: 'done', confirmedBy: 'founder', waitingFor: '' }); addEvent({ actor: 'founder', type: 'input', title: '你已完成：' + t.title, relatedIds: [t.id], moduleIds: ['now', 'evidence'] }); }
    else upsertTask({ id: t.id, status: 'planned', confirmedBy: null, packId: '', next: '你話未完成，要改期' });
  }
  run.result = { summary: t ? (done ? '已記錄：你已完成「' + t.title + '」。' : '已記錄：「' + t.title + '」未完成，需要改期。') : '已記錄你的答案。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
async function handleAcceptance(run, pack, store) {
  const t = getTask(pack.acceptance.taskId);
  const a = store.answers.accept, ok = !a || a.value === '接受';
  if (!t) { run.result = { summary: '已記錄驗收結果。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  if (ok) {
    upsertTask({ id: t.id, status: 'done', acceptedBy: 'founder', waitingFor: '' });
    addEvent({ actor: 'founder', type: 'decision', title: '接受：' + t.title, relatedIds: [t.id], moduleIds: ['decisions', 'ai-week'] });
    run.result = { summary: '已接受「' + t.title + '」。', artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  const reason = String((store.answers.reason || {}).value || '').trim();
  upsertTask({ id: t.id, status: 'active', acceptedBy: null, waitingFor: '', next: '按退回原因修改' });
  addEvent({ actor: 'founder', type: 'decision', title: '退回：' + t.title, relatedIds: [t.id], moduleIds: ['decisions', 'ai-week'] });
  run.taskId = t.id;
  return aiAfterAsk(run, { ...pack, next: { task: `創辦人退回「${t.title}」，原因：${reason && reason !== '不用改' ? reason : '未有寫明，請按題目答案同上一版判斷'}。按原因改好上一版產出，用返同一個檔名交出。` } });
}

/* ---------- 紅藍對打：開場、每回合一次 AI（藍 → 紅 →（反駁）→ 裁判；重判；轉強；再攻）、回應、採用 ---------- */
// 每個回合係一次獨立 run：做完寫低 match.next，伺服器見到就再叫外殼，中間創辦人嘅回覆照樣先處理。
// AI 只喺沙盒工作；核對格式、搬檔、問題包、你要做嘅行動全部由呢度做。辯論結果唔算證據，唔郁任何證據級。
const PASS_ROLE = { blue: 'blue', red: 'red', rebuttal: 'blue', judge: 'judge', rejudge: 'judge', strengthen: 'blue', 'reattack-red': 'red', 'reattack-judge': 'judge' };
const PASS_OUT = { blue: 'blue.json', red: 'red.json', rebuttal: 'rebuttal.json', judge: 'judge.json', rejudge: 'rejudge.json', strengthen: 'strengthen.json', 'reattack-red': 'reattack-red.json', 'reattack-judge': 'reattack-judge.json' };
const NONE = s => !String(s || '').trim() || /^(沒有|冇|無|没有|不用|唔使|暫時沒有)[。.]?$/.test(String(s).trim());
const mFile = id => path.join(matchDir(DIR, id), 'match.json');
const readMatch = id => readJSON(mFile(id), null);
function saveMatch(m) { fs.mkdirSync(matchDir(DIR, m.id), { recursive: true }); m.updatedAt = localIso(); writeJSON(mFile(m.id), m); }
const viewOf = id => listMatches(DIR, brainSource(DIR)).find(v => v.id === id) || null;
// 舊場（試驗資料夾或者示範）第一次有回應：開疊加資料夾，抄場次紀錄；舊場檔案唔郁
function ensureMatch(id) {
  const m = readMatch(id);
  if (m) return m;
  const src = brainSource(DIR);
  if (!isLegacy(src, id)) return null;
  const base = readMatchFile(DIR, src, id, 'match.json') || {};
  const v = viewOf(id);
  const n = { id, topic: base.topic || { type: 'business', title: '', targetId: '' }, startedAt: base.startedAt || (v && v.startedAt) || '', status: 'done', format: base.format || (v && v.format) || '快打', level: base.level || 'normal',
    roles: base.roles || null, budget: { aiStarts: 0, hardCap: HARD_CAP, reruns: 0, rejudged: 0, reattackRounds: 0, ...(base.budget || {}) }, founder: base.founder || null, packs: base.packs || {}, warnings: base.warnings || [], label: 'AI 建議 · 未確認', next: '', legacy: true };
  saveMatch(n);
  return n;
}
// 角色模型：同一服務商三個模型（宿主檔 roles）；只顯示甲乙丙，唔顯示廠商名
function roleSetup() {
  const c = certified(ROOT, DIR.ledger), h = c.host || {};
  const ms = ['blue', 'red', 'judge'].map(r => roleModel(h, r) || 'default');
  const web = readsWeb(h);
  const label = {}; let k = 0;
  for (const m of ms) if (!(m in label)) label[m] = '甲乙丙'[k++] || '丁';
  const warnings = ms[0] === ms[2] ? ['三方同一模型，獨立性低'] : ms[0] === ms[1] ? ['紅方與藍方為同一模型'] : [];
  return { roles: { blue: { model: label[ms[0]], adapter: 'same', ok: null }, red: { model: label[ms[1]], adapter: 'same', ok: null }, judge: { model: label[ms[2]], adapter: 'same', ok: null, sameAsBlue: ms[0] === ms[2] } }, warnings, web };
}
// 開一場辯論（創辦人按「開一場辯論」，或者答「開始」回應生意體檢之後嘅建議）：只係排好第一回合，外殼之後逐回合做
function openMatch(m, from) {
  const id = 'D' + stamp();
  const src = brainSource(DIR);
  const prev = listMatches(DIR, src).filter(v => v.score && v.topic.type === m.topicType).pop();
  const format = formatFor(m.topicType);
  const rs = roleSetup();
  rs.roles.red.personas = m.seats;
  const match = { id, topic: { type: m.topicType, title: m.title, targetId: m.targetId || '' }, startedAt: localIso(), endedAt: '', status: 'preparing', format, level: m.level, web: rs.web,
    roles: rs.roles, budget: { aiStarts: 0, hardCap: HARD_CAP, reruns: 0, rejudged: 0, reattackRounds: 0 }, files: {}, founder: null, packs: {}, warnings: rs.warnings, label: 'AI 建議 · 未確認',
    previousMatchId: prev ? prev.id : '', next: 'blue', queuedAt: localIso(), ...from };
  saveMatch(match);
  addEvent({ actor: 'founder', type: 'input', title: '開始一場辯論：' + clip(m.title, 30), relatedIds: [id].concat(from.offerPackId ? [from.offerPackId] : []), moduleIds: ['inputs'] });
  return { id, format };
}
function handleDebateStart(run, m) {
  const { id, format } = openMatch(m, { noteId: run.ref });
  step(run, 'applied', U.stepReqRegistered, 'done', passesFor(format).map(p => U['dp_' + p]).join(' → '));
  run.result = { summary: '已開一場辯論：' + clip(m.title, 40) + '（' + format + '）', artifacts: [], founderNext: [], matchId: id };
  return finish(run, 'done');
}
function handleDebateAction(run, a) {
  const m = ensureMatch(a.matchId);
  const done = (summary, ok = true) => { step(run, 'applied', U.stepReqRegistered, ok ? 'done' : 'failed', summary); run.result = { summary, artifacts: [], founderNext: [], matchId: a.matchId }; return finish(run, ok ? 'done' : 'failed', ok ? undefined : summary); };
  if (!m) return done('找不到此場辯論', false);
  const v = viewOf(m.id);
  if (a.action === 'rerun') {
    if (!m.failed) return done('此場沒有未完成的回合');
    if (!m.failed.waitingAI && (m.budget.reruns || 0) >= 1) return done('每場只可以重跑一次；想再試請再打一場', false);
    if (!m.failed.waitingAI) m.budget.reruns = (m.budget.reruns || 0) + 1;
    m.next = m.failed.pass; m.failed = null; m.queuedAt = localIso(); saveMatch(m);
    return done('已排好重跑：' + U['dp_' + m.next]);
  }
  if (a.action === 'reattack2') {
    if (!v || !v.strengthen || v.strengthen.rounds !== 1) return done('要先有第一輪再攻，先可以再攻第二輪', false);
    if (m.status === 'adopted' || (m.budget.aiStarts || 0) + 2 > HARD_CAP) return done('此場已採用，或已達 AI 啟動上限', false);
    m.round = 2; m.next = 'reattack-red'; m.status = 'reattack'; m.queuedAt = localIso(); saveMatch(m);
    return done('已排好紅方再攻第二輪');
  }
  if (a.action === 'respond') {
    if (!v || !v.synthesis) return done('裁判未整合好，未可以回應', false);
    if (m.packs.response && loadPack(DIR, m.packs.response)) return done('回應問題已在待決事項');
    const placed = placeDebatePacks([responsePack(v)]);
    m.packs.response = placed[0] ? placed[0].id : ''; saveMatch(m);
    run.result = { summary: '已放上 Founder Desk：回應這場', artifacts: [], founderNext: [], asks: placed, matchId: m.id };
    step(run, 'applied', U.stepReqRegistered, 'done', '已放上 Founder Desk'); return finish(run, 'done');
  }
  if (a.action === 'adopt') {
    if (!v || !v.strengthen) return done('未有轉強卡', false);
    const open = [].concat(m.packs.adoption || []).filter(id => loadPack(DIR, id));
    if (open.length) return done('採用問題已在待決事項');
    const placed = placeDebatePacks(adoptionPacks(v));
    m.packs.adoption = placed.map(p => p.id); saveMatch(m);
    run.result = { summary: placed.length ? '已放上 Founder Desk：採用轉強' : '沒有未決定的轉強卡', artifacts: [], founderNext: [], asks: placed, matchId: m.id };
    step(run, 'applied', U.stepReqRegistered, 'done', run.result.summary); return finish(run, 'done');
  }
  return done('操作不正確', false);
}
// 外殼機械出嘅問題包：唔使 AI；每場題目唔同，唔做「答過唔再問」
function placeDebatePacks(raws) {
  const out = [];
  for (const raw of raws) {
    const prep = preparePacks(raw, { dirs: null, askedBy: 'AI', fromRun: null, strictTitle: false });
    if (!prep.ok) { log('辯論問題包格式不正確：' + prep.errors.join('；')); continue; }
    for (const p of prep.packs) { p.debate = raw.debate; p.todoType = 'decision'; }
    out.push(...placePacks(DIR, prep.packs));
  }
  return out;
}
// 回合嘅沙盒：題目、公司概覽、文件、上一場、前面回合嘅產出、格式同例子
function debateSandbox(run, m, pass) {
  const sb = newSandbox(run);
  const src = brainSource(DIR);
  const seats = (m.roles && m.roles.red && m.roles.red.personas) || [];
  fs.writeFileSync(path.join(sb, 'topic.md'), ['# 今次辯論', '', `- 題目：${m.topic.title}`, `- 題目類型：${NAMES.dash['tp_' + m.topic.type] || m.topic.type}`, m.topic.targetId ? `- 對象編號：${m.topic.targetId}` : '',
    `- 紅方席位：${seats.join('、')}`, `- 紅方力度：${LEVELS[m.level] || '一般'}`, `- 回合：${m.format}（${passesFor(m.format).map(p => U['dp_' + p]).join(' → ')}）`, `- 今日：${localIso().slice(0, 10)}`].filter(Boolean).join('\n') + '\n');
  writeConfirmedPage(sb);
  if (!fs.existsSync(path.join(sb, 'confirmed-page.md')) && fs.existsSync(path.join(DIR.company, 'page.json'))) fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(sb, 'company-page.json'));
  { const ck = readJSON(brainFile(DIR, 'checkup'), null); if (ck) writeJSON(path.join(sb, 'checkup.json'), ck); }
  if (src && src.kind === 'folder') {
    fs.mkdirSync(path.join(sb, 'docs'), { recursive: true });
    for (const f of fs.readdirSync(src.dir).filter(f => /\.md$/.test(f) && /體檢|假設|模式|商業/.test(f))) fs.copyFileSync(path.join(src.dir, f), path.join(sb, 'docs', f));
  }
  if (m.previousMatchId && (pass === 'blue')) {
    fs.mkdirSync(path.join(sb, 'previous'), { recursive: true });
    const pj = readMatchFile(DIR, src, m.previousMatchId, 'judge.json'), ps = readMatchFile(DIR, src, m.previousMatchId, 'strengthen.json');
    if (pj) writeJSON(path.join(sb, 'previous', 'judge.json'), pj);
    if (ps) writeJSON(path.join(sb, 'previous', 'strengthen-adopted.json'), { cards: (ps.cards || []).filter(c => c.status === '已採用' || c.status === '已改處理'), modelRevision: ps.modelRevision || null });
  }
  for (const n of ['blue.json', 'red.json', 'rebuttal.json', 'judge.json', 'strengthen.json']) { const j = readMatchFile(DIR, src, m.id, n); if (j) writeJSON(path.join(sb, n), j); }
  if (pass === 'reattack-judge') { const r = readJSON(path.join(matchDir(DIR, m.id), `reattack-red-${m.round || 1}.json`), null); if (r) writeJSON(path.join(sb, 'reattack-red.json'), r); }
  if (pass === 'rejudge') {
    const ch = (m.founder && m.founder.challenges) || [];
    fs.writeFileSync(path.join(sb, 'challenge.md'), ['# 創辦人挑戰裁判', '', '## 要重判嘅論點', '', ...(ch.some(c => c.claimId) ? ch.filter(c => c.claimId).map(c => `- ${c.claimId}`) : ['- 冇指定：由創辦人原話揀最多三條']), '', '## 創辦人原話（你原話）', '', ...ch.map(c => '> ' + c.note)].join('\n') + '\n');
  }
  if (pass === 'strengthen') {
    const f = m.founder || {}, v = viewOf(m.id), km = new Map(((v && v.keyMoments) || []).map(k => [k.ref, k]));
    fs.writeFileSync(path.join(sb, 'response.md'), ['# 創辦人對辯論嘅回應', '', '## 對關鍵時刻表態', '', ...(f.votes || []).map(x => `- ${x.agree ? '同意裁判' : '不同意裁判'}：${km.get(x.ref) ? km.get(x.ref).kind + '「' + km.get(x.ref).text + '」' : x.ref}（${x.ref}）`),
      '', '## 真實證據（創辦人原話，未確認前唔改證據級）', '', ...((f.evidence || []).length ? f.evidence.map(e => `- ${e.text}（${NAMES.evName(e.grade)}）`) : ['- 冇']), '', '## 挑戰裁判', '', ...((f.challenges || []).length ? f.challenges.map(c => `- ${c.claimId || '未指定'}：${c.note}${c.rejudged ? '（已重判）' : ''}`) : ['- 冇'])].join('\n') + '\n');
  }
  fs.copyFileSync(path.join(ROOT, 'debate-format.md'), path.join(sb, 'format.md'));
  const ex = path.join(ROOT, 'fixtures', 'demo-farm', 'brain', 'wargame');
  fs.mkdirSync(path.join(sb, 'example'), { recursive: true });
  for (const n of ['blue.json', 'red.json', 'rebuttal.json', 'judge.json', 'strengthen.json']) fs.copyFileSync(path.join(ex, n), path.join(sb, 'example', n));
  const all = fs.readFileSync(path.join(ROOT, 'ai-debate.md'), 'utf8');
  const head = all.split(/\r?\n## 回合：/)[0], sec = all.split(/\r?\n## 回合：/).find(s => s.split(/\r?\n/)[0].trim() === pass) || '';
  fs.writeFileSync(path.join(sb, 'task.md'), head + '\n## 今次回合：' + sec + '\n');
  writeJSON(path.join(sb, 'job.json'), { type: 'debate-' + pass, matchId: m.id, seats, level: m.level, round: m.round || 1, format: m.format });
  return sb;
}
function nextAfter(m, pass, v) {
  if (pass === 'blue') return 'red';
  if (pass === 'red') return m.format === '全場' && v && v.rows.some(r => r.attacks.some(a => a.severity === '高')) ? 'rebuttal' : 'judge';
  if (pass === 'rebuttal') return 'judge';
  if (pass === 'rejudge') return readMatchFile(DIR, brainSource(DIR), m.id, 'strengthen.json') ? 'reattack-red' : 'strengthen';
  if (pass === 'strengthen') return 'reattack-red';
  if (pass === 'reattack-red') return 'reattack-judge';
  return '';
}
async function runDebatePass(run, m) {
  const pass = m.next;
  run.kind = 'debate'; run.ref = m.id; run.debatePass = pass;
  const label = U.debateAI + '：' + (U['dp_' + pass] || pass) + (m.round > 1 && pass.startsWith('reattack') ? '（第 ' + m.round + ' 輪）' : '') + '（' + clip(m.topic.title, 20) + '）';
  step(run, 'received', U.debateAI, 'done', (U['dp_' + pass] || pass));
  const fail = (why, waiting) => {
    m.failed = { pass, reason: why, at: localIso(), ...(waiting ? { waitingAI: true } : {}) };
    m.next = '';
    if (m.roles && m.roles[PASS_ROLE[pass]]) m.roles[PASS_ROLE[pass]].ok = false;
    saveMatch(m);
    if (waiting) { run.waitingFor = 'ai-setup'; step(run, 'ai', label, 'waiting', why); return finish(run, 'waiting'); }
    step(run, 'ai', label, 'failed', why); return finish(run, 'failed', why);
  };
  if (!PASS_OUT[pass]) { m.next = ''; return fail('未知的回合'); }
  if ((m.budget.aiStarts || 0) >= HARD_CAP) { m.next = ''; return fail('一場最多 ' + HARD_CAP + ' 次 AI 啟動，已到上限'); }
  const sb = debateSandbox(run, m, pass);
  const role = PASS_ROLE[pass], t0 = Date.now();
  step(run, 'ai', label, 'running', 'AI 處理中，一般需時數分鐘；完成後會在營運監察台「生意大腦」逐幕出現');
  log(`${run.id} 辯論 ${m.id} ${pass} start`);
  const r = await runAI(sb, { role });
  if (r.meta) run.aiCost = { usd: r.meta.total_cost_usd, ms: r.meta.duration_ms };
  if (r.waiting) return fail(r.reason, true);
  m.budget.aiStarts = (m.budget.aiStarts || 0) + 1;
  m.budget.usd = Math.round(((m.budget.usd || 0) + (r.meta && r.meta.total_cost_usd || 0)) * 10000) / 10000;
  if (!r.ok) return fail(r.reason || 'AI 未做完');
  const out = readJSON(path.join(sb, 'out', PASS_OUT[pass]), null);
  const src = brainSource(DIR), dir = matchDir(DIR, m.id);
  fs.mkdirSync(dir, { recursive: true });
  const blue = readMatchFile(DIR, src, m.id, 'blue.json'), red = readMatchFile(DIR, src, m.id, 'red.json');
  let chk;
  if (pass === 'blue') chk = checkBlue(out);
  else if (pass === 'red') chk = checkRed(out, blue, (m.roles && m.roles.red && m.roles.red.personas) || []);
  else if (pass === 'rebuttal') chk = checkRebuttal(out, red);
  else if (pass === 'judge') chk = checkJudge(out, blue, red);
  else if (pass === 'rejudge') chk = checkRejudge(out, ((m.founder && m.founder.challenges) || []).some(c => c.claimId) ? m.founder.challenges.map(c => c.claimId).filter(Boolean) : (blue.claims || []).map(c => c.id));
  else if (pass === 'strengthen') chk = checkStrengthen(out, viewOf(m.id), { matchId: m.id });
  else if (pass === 'reattack-red') chk = checkReattackRed(out, (readMatchFile(DIR, src, m.id, 'strengthen.json') || {}).cards || []);
  else chk = checkReattackJudge(out, (readJSON(path.join(dir, `reattack-red-${m.round || 1}.json`), null) || {}).attacks || []);
  m.warnings = [...new Set([...(m.warnings || []), ...chk.warnings])].slice(0, 12);
  if (!chk.ok) return fail(chk.errors.join('；'));
  const minutes = Math.max(1, Math.round((Date.now() - t0) / 60000));
  if (m.roles && m.roles[role]) Object.assign(m.roles[role], { ok: true, minutes: (m.roles[role].minutes || 0) + minutes, startedAt: m.roles[role].startedAt || localIso() });
  // 寫入場次資料夾（舊場寫疊加資料夾；試驗資料夾永不寫）
  if (['blue', 'red', 'rebuttal', 'judge'].includes(pass)) writeJSON(path.join(dir, PASS_OUT[pass]), chk.data);
  if (pass === 'rejudge') {
    const j = readMatchFile(DIR, src, m.id, 'judge.json');
    if (!fs.existsSync(path.join(dir, 'judge-original.json'))) writeJSON(path.join(dir, 'judge-original.json'), j);
    for (const nv of chk.data.verdicts) { const i = j.verdicts.findIndex(x => x.claimId === nv.claimId); const row = { ...nv, reason: '重判：' + nv.reason.replace(/^重判：/, ''), rejudged: true }; if (i >= 0) j.verdicts[i] = row; }
    writeJSON(path.join(dir, 'judge.json'), j);
    const picked = chk.data.verdicts.map(x => x.claimId);
    m.founder.challenges = m.founder.challenges.some(c => c.claimId) ? m.founder.challenges.map(c => ({ ...c, rejudged: picked.includes(c.claimId) })) : picked.map(id => ({ claimId: id, note: m.founder.challenges[0].note, rejudged: true }));
    m.budget.rejudged = 1;
  }
  if (pass === 'strengthen') {
    writeJSON(path.join(dir, 'strengthen.json'), chk.data);
    if (fs.existsSync(path.join(sb, 'out', '04-轉強.md'))) fs.copyFileSync(path.join(sb, 'out', '04-轉強.md'), path.join(dir, '04-轉強.md'));
    m.round = 1;
  }
  if (pass === 'reattack-red') writeJSON(path.join(dir, `reattack-red-${m.round || 1}.json`), chk.data);
  if (pass === 'reattack-judge') {
    const str = readMatchFile(DIR, src, m.id, 'strengthen.json');
    const atk = new Map(((readJSON(path.join(dir, `reattack-red-${m.round || 1}.json`), null) || {}).attacks || []).map(a => [a.cardId, a]));
    const round = m.round || 1;
    for (const c of str.cards) {
      const a = atk.get(c.id), jv = chk.data.verdicts.find(x => x.cardId === c.id);
      if (!a || !jv) continue;
      c.reattacks = (c.reattacks || []).filter(x => x.round !== round).concat([{ round, persona: a.persona, attack: a.attack, severity: a.severity, verdict: jv.verdict, reason: jv.reason }]);
      // 兩輪後仍然倒下：處理方式改為先驗證（AI 唔可以再改）
      if (round >= 2 && jv.verdict === '倒下' && c.status === '擬議') { c.handling = '先驗證'; c.whyThis = (c.whyThis ? c.whyThis + '；' : '') + '兩輪再攻後仍然倒下：未企得住，先測'; }
    }
    writeJSON(path.join(dir, 'strengthen.json'), str);
    m.budget.reattackRounds = round;
  }
  // 顯示用白話：今個回合寫好嘅檔（原檔唔郁）
  await plainMatchFiles(run, m, pass === 'rejudge' ? ['judge.json'] : pass === 'reattack-red' ? [] : pass === 'reattack-judge' ? ['strengthen.json'] : [PASS_OUT[pass]]);
  m.next = nextAfter(m, pass, viewOf(m.id));
  m.status = m.next ? ({ red: 'red', rebuttal: 'rebuttal', judge: 'judge', strengthen: 'strengthening', 'reattack-red': 'reattack', 'reattack-judge': 'reattack' }[m.next] || m.status) : pass === 'judge' ? 'done' : pass === 'reattack-judge' ? 'reattack' : m.status;
  m.queuedAt = localIso();
  let summary = (U['dp_' + pass] || pass) + '完成';
  // 完場：外殼出「辯論回應」問題包；第一輪再攻完：出「轉強採用」問題包（放好包先寫場次狀態，畫面唔會見到「等你」而冇入口）
  if (pass === 'judge') {
    m.endedAt = localIso();
    const placed = placeDebatePacks([responsePack(viewOf(m.id))]);
    m.packs.response = placed[0] ? placed[0].id : '';
    run.result = { summary: '辯論完結：等待你回應三個關鍵時刻', artifacts: [], founderNext: [], asks: placed, matchId: m.id };
    addEvent({ actor: 'ai', type: 'run', title: '辯論完結：' + clip(m.topic.title, 30) + '，等待你回應', relatedIds: [m.id, run.id], moduleIds: ['ai-week', 'decisions'] });
    summary = '辯論完結，已放上 Founder Desk';
  } else if (pass === 'reattack-judge' && (m.round || 1) === 1) {
    const placed = placeDebatePacks(adoptionPacks(viewOf(m.id)));
    m.packs.adoption = placed.map(p => p.id);
    run.result = { summary: '轉強卡已完成一輪再攻，等待你採用', artifacts: [], founderNext: [], asks: placed, matchId: m.id };
    addEvent({ actor: 'ai', type: 'run', title: '轉強卡等待你採用：' + clip(m.topic.title, 30), relatedIds: [m.id, run.id], moduleIds: ['ai-week', 'decisions'] });
  } else run.result = { summary: label + '：完成', artifacts: [], founderNext: [], matchId: m.id };
  saveMatch(m);
  step(run, 'ai', label, 'done', summary);
  return finish(run, 'done');
}
// 創辦人答咗辯論問題包：回應（表態、證據、挑戰）→ 重判／轉強；採用 → 卡狀態、你要做；證據 → 記錄
function handleDebateAnswer(run, pack, store) {
  const m = ensureMatch(pack.debate.matchId);
  if (!m) { run.result = { summary: '已記錄；找不到此場辯論。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const val = id => { const a = store.answers[id], q = pack.questions.find(x => x.id === id); return a ? a.value : q ? q.value : ''; };
  const k = pack.debate.kind;
  if (k === 'response') {
    if (m.founder && m.founder.respondedAt) { run.result = { summary: '已記錄；此場已開始轉強，今次答案只作紀錄。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
    const v = viewOf(m.id);
    const votes = Object.entries(pack.debate.refs || {}).map(([qid, ref]) => ({ ref, agree: val(qid) !== '不同意' }));
    const f = { respondedAt: localIso(), votes, evidence: [], challenges: [], adoptedCardIds: [], rejectedCardIds: [] };
    const ev = String(val('ev') || '').trim(), ch = String(val('ch') || '').trim();
    if (!NONE(ev)) {
      // 證據級：記錄機器值（said／did／paid；規劃書 3.3），選項顯示五級名稱；舊字眼、舊名稱照收
      const g0 = NAMES.evKey(val('evg')), grade = ['said', 'did', 'paid'].includes(g0) ? g0 : 'said';
      const placed = placeDebatePacks([evidencePack(v, ev, grade)]);
      f.evidence.push({ text: clip(ev, 300), grade, packId: placed[0] ? placed[0].id : '', confirmed: false });
    }
    const targets = votes.filter(x => !x.agree && /^B\d/.test(x.ref)).map(x => x.ref).slice(0, 3);
    if (targets.length) f.challenges = targets.map(t => ({ claimId: t, note: NONE(ch) ? '你不同意裁判' : clip(ch, 300), rejudged: false }));
    else if (!NONE(ch)) f.challenges = [{ claimId: '', note: clip(ch, 300), rejudged: false }];
    m.founder = f;
    const hasStr = !!readMatchFile(DIR, brainSource(DIR), m.id, 'strengthen.json');
    m.next = f.challenges.length && (m.budget.rejudged || 0) < 1 ? 'rejudge' : hasStr ? (v.strengthen && v.strengthen.rounds ? '' : 'reattack-red') : 'strengthen';
    if (!m.next && hasStr) { const placed = placeDebatePacks(adoptionPacks(viewOf(m.id))); m.packs.adoption = placed.map(p => p.id); }
    m.status = m.next === 'rejudge' ? 'judge' : m.next ? 'strengthening' : 'reattack'; m.round = m.round || 1; m.queuedAt = localIso();
    saveMatch(m);
    addEvent({ actor: 'founder', type: 'decision', title: '回應辯論：' + clip(m.topic.title, 24) + '（' + votes.filter(x => x.agree).length + ' 同意 · ' + votes.filter(x => !x.agree).length + ' 不同意）', relatedIds: [m.id], moduleIds: ['decisions'] });
    run.result = { summary: '已記錄你的回應；' + (m.next === 'rejudge' ? '先請裁判重判，之後開始轉強。' : m.next ? 'AI 開始轉強。' : '轉強卡等你採用。'), artifacts: [], founderNext: [], matchId: m.id };
    return finish(run, 'done');
  }
  if (k === 'evidence') {
    const ok = val('confirm') === '確認記錄';
    for (const e of (m.founder && m.founder.evidence) || []) if (e.packId === pack.id) e.confirmed = ok;
    saveMatch(m);
    if (ok) addEvent({ actor: 'founder', type: 'input', title: '你確認真實證據：' + clip(pack.debate.text, 30) + '（' + NAMES.evName(pack.debate.grade) + '）', relatedIds: [m.id], moduleIds: ['inputs', 'evidence'] });
    run.result = { summary: ok ? '已記錄為真實證據；證據級須由你在假設清單更改後才生效。' : '已記錄：暫不記錄為證據。', artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  if (k === 'adopt') return applyAdoption(run, m, pack, store);
  run.result = { summary: '已記錄你的答案。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
function applyAdoption(run, m, pack, store) {
  const src = brainSource(DIR), dir = matchDir(DIR, m.id);
  const str = readMatchFile(DIR, src, m.id, 'strengthen.json');
  if (!str) { run.result = { summary: '已記錄；找不到轉強卡。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const state = loadState(), msIds = new Set((state.milestones || []).map(x => x.id));
  const changed = [];
  for (const cid of pack.debate.cards || []) {
    const qid = 'c-' + cid, q = pack.questions.find(x => x.id === qid), a = store.answers[qid];
    const c = str.cards.find(x => x.id === cid);
    if (!q || !c || c.status !== '擬議') continue;
    if (!a && q.effect === 'now') continue; // 必須先問：未答唔套用
    const value = a ? a.value : q.value;
    if (value === ADOPT_OPTS.adopt) c.status = '已採用';
    else if (value === ADOPT_OPTS.test) { c.status = '已改處理'; c.handling = '先驗證'; }
    else if (value === ADOPT_OPTS.reject) c.status = '唔採用';
    else { c.founderNote = clip(String(value), 300); continue; }
    c.label = c.status === '唔採用' ? 'AI 建議 · 未確認' : 'AI 建議 · 你已認同';
    changed.push(c);
    if (c.status === '唔採用') continue;
    // 採用：測試同你要做嘅行動（有日期）；為測邊條假設寫明，入「風險大」排序
    const as = (c.assumptionChanges || [])[0], msId = ((c.routeImpact || []).find(r => msIds.has(r.milestoneId)) || {}).milestoneId || '';
    // 測試由邊個做（規劃書 3.15）：AI 已經查咗就唔再開工作；要你批准嘅寫明「批准」；要你做嘅有準備工作
    const by = c.test.testBy || '', checked = (c.test.aiChecked || []).length > 0;
    const fa = c.test.founderAction && by !== 'ai' ? 'df-' + m.id + '-' + c.id : '';
    if (fa) upsertTask({ id: fa, title: clip((by === 'approval' ? '批准：' : '') + c.test.founderAction, 40), owner: 'founder', status: 'planned', dueAt: c.test.by, milestoneId: msId, next: '為測「' + clip(as ? as.text : c.critique, 30) + '」', debate: { matchId: m.id, cardId: c.id } });
    if (!(by === 'ai' && checked)) upsertTask({ id: 'dt-' + m.id + '-' + c.id, title: clip((by === 'ai' ? '補查：' : c.handling === '接受並監察' ? '觀察：' : '測試：') + c.test.what, 40), status: 'planned', milestoneId: msId, riskTest: clip(as ? as.text : c.critique, 40),
      next: '成功：' + clip(c.test.success, 40) + '；停止：' + clip(c.test.stop, 40), ...(fa ? { prepFor: fa } : {}), debate: { matchId: m.id, cardId: c.id } });
  }
  writeJSON(path.join(dir, 'strengthen.json'), str);
  m.founder = m.founder || { votes: [], evidence: [], challenges: [] };
  m.founder.adoptedCardIds = str.cards.filter(c => c.status === '已採用' || c.status === '已改處理').map(c => c.id);
  m.founder.rejectedCardIds = str.cards.filter(c => c.status === '唔採用').map(c => c.id);
  if (str.cards.every(c => c.status !== '擬議')) m.status = 'adopted';
  saveMatch(m);
  const nAdopt = changed.filter(c => c.status !== '唔採用').length;
  if (changed.length) addEvent({ actor: 'founder', type: 'decision', title: '採用轉強卡 ' + nAdopt + ' 張' + (changed.length - nAdopt ? '、不採用 ' + (changed.length - nAdopt) + ' 張' : '') + '：' + clip(m.topic.title, 20), relatedIds: [m.id], moduleIds: ['decisions', 'now'] });
  run.result = { summary: changed.length ? `已記錄：採用 ${nAdopt} 張，生成有日期的測試${changed.some(c => c.test && c.test.founderAction && c.status !== '唔採用') ? '及你要做的行動' : ''}。` : '已記錄；必須先問的卡須逐張回答後才會套用。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}

/* ---------- 顯示用白話版本（plain-lib.mjs；規劃書 3.1、4.10）：AI 輸出原檔唔郁；有問題就叫 AI 改寫一份顯示用版本，
   改寫句逐段機械核對（長度、新數字或日期、聲稱字句），唔過嘅段落用返原文；仍然命中就機械替換查得到嘅編號同級數，
   查唔到嘅原樣保留並加「含內部用語」標記，記 health.warnings（系統頁顯示）。同一步驟可以重跑：原檔冇改過就略過。 */
function plainCtx(files, srcDir) {
  const blue = files.blue || {}, judge = files.judge || {}, str = files.strengthen || {}, red = files.red || {};
  const st = loadState();
  return { claims: Object.fromEntries((blue.claims || []).map(c => [c.id, c.claim])),
    routes: Object.fromEntries((blue.strategies || []).map(s => [s.id, s.name]).concat((judge.routes || []).map(r => [r.id, r.name]))),
    cards: Object.fromEntries((str.cards || []).map((c, i) => [c.id, { n: i + 1, title: c.critique || '' }])),
    attacks: Object.fromEntries((red.attacks || []).map(a => [a.id, a.attack])),
    assumptions: srcDir ? folderAssumptions(srcDir) : {},
    tasks: Object.fromEntries((st.tasks || []).map(t => [t.id, t.title])), milestones: Object.fromEntries((st.milestones || []).map(m => [m.id, m.short || m.title])) };
}
function plainTask(sb, name, isJSON, hits, refs) {
  const L = ['# 你今次的工作：把文字改寫成創辦人看得明的版本（只供畫面顯示）', '',
    `\`in/${name}\` 是一份已完成的 AI 輸出，創辦人看不明當中的內部代號、級數數字或口語。請把它複製到 \`out/${name}\`，只改寫創辦人看得到的文字，令它符合本文件最後「寫給創辦人看的文字」的規矩。`, '',
    '規矩：',
    isJSON ? `1. JSON 的結構、所有鍵、陣列長度與次序完全不變；以下機器欄位一個字都不可以改：${[...MACHINE, ...ORIGINAL].join('、')}。只改其他字串欄位的文字；檔案必須仍是有效 JSON。`
      : '1. 以 # 開頭的標題行，數目、層級與次序完全不變（可以改寫標題文字）；正文可以改寫。標「你原話」的內容一字不改。',
    '2. 意思不變，不加入新事實、不刪除內容。遇到編號就換成內容或名稱（可參考 `ref/` 入面的文件與下面的對照）；證據級只寫名稱。',
    '3. 每段改寫後的長度不可多於原文一倍半；不可加入原文沒有的數字或日期；不可加入「已簽」「已批准」「已完成」「已確認」「已付」「已同意」「已採用」一類原文沒有的字句。不合格的段落會被退回原文。',
    '4. 人名或機構名第一次出現時，按 `ref/` 文件已有的資料補上身份（例如「陳經理（送貨伙伴負責人）」）；文件沒有交代的，寫成「一位……」的描述，不要自行猜測。',
    '5. `source` 欄位開頭的來源標籤（你原話、AI 建議 · 未確認、AI 建議 · 你已認同、AI 解讀、外部事實 [數字]）要原樣保留，只改標籤後面的文字。Markdown 正文內的出處只寫來源標籤，例如「你原話：「……」」，不寫檔名或章節符號；如要說明出處，寫文件的中文名稱（例如「經營方向文件」）。「你原話」引號內的原話一字不改。',
    '5a. 改寫某個標題時，文中引用該標題的地方（例如「見下文『……』」）要一併改成新標題。證據級只寫五級名稱，舊名稱（有人講過、有人做過等）要改為五級名稱。日期寫完整（例如「10 月 29 日」）。',
    '5b. 口語字一律改為商用書面語，包括「盤生意」（寫「這門生意」）、「最平」（寫「成本最低」）、「連住」、「揀」、「諗」、「個位」、作連接詞的「同」（寫「及」「與」「和」）。',
    '6. 只寫 `out/` 一個檔；不要寫其他檔，不要上網。', '', '## 外殼找到要處理的位置', ''];
  hits.slice(0, 120).forEach((h, i) => L.push(`${i + 1}. ${h.path ? '`' + h.path + '`：' : ''}「${h.term}」${h.text ? '，原文：「' + clip(h.text.replace(/\s+/g, ' '), 120) + '」' : ''}`));
  if (refs.codes.length) { L.push('', '## 編號對照（只供你理解；不可以把編號寫進文字）', ''); refs.codes.forEach(c => L.push('- ' + c)); }
  fs.writeFileSync(path.join(sb, 'task.md'), L.join('\n') + '\n');
}
// health.warnings：同一份文件只留最新一句（「AI 文字含內部用語／口語字：<名稱>」）
const warnTags = (docName, marked, colloquial) => (marked ? [NAMES.dash.warnCode.replace('{name}', docName)] : []).concat(colloquial ? [NAMES.dash.warnColloquial.replace('{name}', docName)] : []);
function plainWarn(docName, marked, colloquial) {
  const st = loadState(), h = st.health || {};
  const tags = [NAMES.dash.warnCode, NAMES.dash.warnColloquial].map(t => t.replace('{name}', docName));
  const keep = (h.warnings || []).filter(w => !tags.includes(w));
  const next = keep.concat(marked ? [tags[0]] : [], colloquial ? [tags[1]] : []);
  if (JSON.stringify(next) === JSON.stringify(h.warnings || [])) return;
  st.health = { ...h, warnings: next };
  saveState(st);
}
function docNameOf(key, text) {
  const base = key.split('/').pop();
  const wg = { 'blue.json': 'docBlue', 'red.json': 'docRed', 'rebuttal.json': 'docRebuttal', 'judge.json': 'docJudge', 'strengthen.json': 'docStrengthen' }[base];
  if (wg) return NAMES.dash[wg];
  if (/生意體檢/.test(base)) return NAMES.dash.brain_checkup;
  if (/預演|演練/.test(base)) return NAMES.dash.brain_scenario;
  const h1 = String(text || '').split(/\r?\n/).find(l => /^# /.test(l));
  return clip(deCodeInfo((h1 ? h1.replace(/^#\s*/, '') : base.replace(/\.md$/, '').replace(/^\d+-/, '')).trim()).text.split(' 〔').shift(), 30);
}
// 規則版本：改咗核對或者替換規則就加一，舊顯示用版本會用返沙盒入面嘅 AI 改寫結果重新核對（唔再叫 AI）
const PLAIN_RULE = 8;
// node run.mjs --plain --fresh：唔用沙盒入面上次嘅 AI 改寫結果，重新叫 AI 改寫（改寫規矩改咗之後用）
const PLAIN_FRESH = process.argv.includes('--fresh');
function findPlainSandbox(name, srcSha) {
  try {
    return fs.readdirSync(DIR.sandbox).filter(d => /-plain-\d+$/.test(d)).sort().reverse().find(d => {
      try { return sha(fs.readFileSync(path.join(DIR.sandbox, d, 'in', name), 'utf8')) === srcSha && fs.existsSync(path.join(DIR.sandbox, d, 'out', name)); } catch { return false; }
    }) || '';
  } catch { return ''; }
}
async function plainOne(run, key, srcFile, n, extraRefs = {}) {
  let text; try { text = fs.readFileSync(srcFile, 'utf8'); } catch { return null; }
  const idx = displayIndex(DIR);
  if (idx[key] && idx[key].sha === sha(text) && idx[key].rule === PLAIN_RULE) return idx[key];
  const name = path.basename(srcFile), isJSON = name.endsWith('.json');
  let obj = null;
  if (isJSON) { try { obj = JSON.parse(text); } catch { return null; } }
  const scan = s => isJSON ? scanJSON(typeof s === 'string' ? JSON.parse(s) : s) : scanText(s);
  const hits = scan(isJSON ? obj : text);
  const rec = { sha: sha(text), rule: PLAIN_RULE, at: localIso(), before: hits.length, after: hits.length, rejected: 0, marked: 0, mode: 'clean' };
  if (hits.length) {
    // 上一次 AI 改寫結果仲喺沙盒（同一原檔）就照用，唔再叫 AI（規則更新後重套機械步）
    const prevSb = !PLAIN_FRESH && idx[key] && idx[key].sha === rec.sha ? (idx[key].sandbox || findPlainSandbox(name, rec.sha)) : '';
    let out = null, sbName = '';
    if (prevSb && fs.existsSync(path.join(DIR.sandbox, prevSb, 'out', name))) { out = fs.readFileSync(path.join(DIR.sandbox, prevSb, 'out', name), 'utf8'); sbName = prevSb; log(`${run.id} 顯示用白話：${key} 沿用上次 AI 改寫結果，重新核對`); }
    else {
      sbName = run.id + '-plain-' + n;
      const sb = path.join(DIR.sandbox, sbName);
      fs.mkdirSync(path.join(sb, 'out'), { recursive: true }); fs.mkdirSync(path.join(sb, 'in'), { recursive: true }); fs.mkdirSync(path.join(sb, 'ref'), { recursive: true });
      fs.writeFileSync(path.join(sb, 'in', name), text);
      for (const [f, body] of Object.entries(extraRefs.files || {})) fs.writeFileSync(path.join(sb, 'ref', f), body);
      plainTask(sb, name, isJSON, hits, { codes: extraRefs.codes || [] });
      writeJSON(path.join(sb, 'job.json'), { type: 'plain', file: name });
      log(`${run.id} 顯示用白話：${key} 命中 ${hits.length} 處，叫 AI 改寫`);
      // 單獨嘅改寫工作（node run.mjs --plain）：真係叫咗 AI 先記 AI 步驟（監察台按呢步算一次 AI 工作）
      if (run.kind === 'plain') step(run, 'ai', U.plainJob, 'running', key.split('/').pop());
      const r = await runAI(sb);
      if (run.kind === 'plain') step(run, 'ai', U.plainJob, 'done', key.split('/').pop());
      if (r.meta) run.aiCost = { usd: Math.round(((run.aiCost && run.aiCost.usd) || 0) * 10000 + (r.meta.total_cost_usd || 0) * 10000) / 10000, ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
      try { out = r.ok ? fs.readFileSync(path.join(sb, 'out', name), 'utf8') : null; } catch { out = null; }
    }
    rec.sandbox = sbName;
    let changes = [];
    // (1) JSON 以原檔結構同機器欄位為準、Markdown 標題結構要一樣；再逐欄或逐段核對改寫句，唔過嘅用返原文
    let result = text, ok = false;
    if (out != null) {
      try {
        if (isJSON) { const m = mergeRewriteJSON(obj, JSON.parse(out), extraRefs.ctx || {}); result = JSON.stringify(m.value, null, 2); rec.rejected = m.rejected; ok = true; }
        else if (headings(out) === headings(text)) { const m = mergeRewriteMd(text, out, extraRefs.ctx || {}); result = m.text; rec.rejected = m.rejected; ok = true; }
      } catch { ok = false; }
    }
    rec.mode = ok ? 'ai' : 'fallback';
    if (!ok) log(`${run.id} 顯示用白話：${key} AI 改寫${out == null ? '未交出' : '結構不符'}，用原文加機械替換`);
    else if (rec.rejected) log(`${run.id} 顯示用白話：${key} 有 ${rec.rejected} 段改寫未過核對（長度、新數字或聲稱字句），該段用返原文`);
    // (2)(3) 仍然命中：機械替換查得到嘅編號同級數；查唔到嘅保留並加「含內部用語」標記
    const left = scan(result);
    if (left.length) {
      // 每處機械替換記低「原文 → 替換後」（顯示用版本旁邊嘅 .changes.json），供人手覆核有冇改錯意思
      const tctx = { ...(extraRefs.ctx || {}), trace: [] };
      if (isJSON) { const d = deCodeJSONInfo(JSON.parse(result), tctx); result = JSON.stringify(d.value, null, 2); rec.marked = d.marked; }
      else { const d = deCodeInfo(result, tctx); result = d.text; rec.marked = d.marked; }
      rec.changes = tctx.trace.length;
      changes = tctx.trace;
      rec.mode = ok ? 'ai+fallback' : 'fallback';
      log(`${run.id} 警告：${key} 改寫後仍有 ${left.length} 處（${[...new Set(left.map(h => h.kind))].join('、')}），已機械替換；${rec.marked} 處查不到對象，照放並標記`);
    }
    const remain = scan(result);
    rec.after = remain.length;
    const colloquial = remain.filter(h => h.kind === 'colloquial').length;
    rec.warnTags = warnTags(docNameOf(key, text), rec.marked > 0, colloquial > 0);
    if (run.kind !== 'plain') plainWarn(docNameOf(key, text), rec.marked > 0, colloquial > 0);
    const p = displayPath(DIR, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, result);
    writeJSON(p + '.changes.json', changes);
  } else { rec.warnTags = []; if (run.kind !== 'plain') plainWarn(docNameOf(key, text), false, false); }
  const idx2 = displayIndex(DIR); idx2[key] = rec;
  fs.mkdirSync(displayDir(DIR), { recursive: true });
  writeJSON(path.join(displayDir(DIR), 'index.json'), idx2);
  return rec;
}
// 參考資料：試驗資料夾嘅 Markdown（假設清單、決定等），等 AI 換編號時有內容可依
function plainRefs(srcDir, files) {
  const refs = {};
  if (srcDir) for (const f of fs.readdirSync(srcDir).filter(f => f.endsWith('.md'))) { try { refs[f] = fs.readFileSync(path.join(srcDir, f), 'utf8'); } catch { } }
  const ctx = plainCtx(files, srcDir);
  const codes = Object.entries(ctx.claims).map(([k, v]) => `${k}：論點「${clip(v, 50)}」`).concat(Object.entries(ctx.routes).map(([k, v]) => `${k}：路線「${v}」`),
    Object.entries(ctx.cards).map(([k, v]) => `${k}：第 ${v.n} 張轉強卡「${clip(v.title, 30)}」`), Object.entries(ctx.attacks).map(([k, v]) => `${k}：紅方攻擊「${clip(v, 40)}」`),
    Object.entries(ctx.assumptions).map(([k, v]) => `${k}：假設「${clip(v, 50)}」`));
  return { files: refs, codes, ctx };
}
// 新場次：每個回合寫好嘅檔即刻出顯示用版本
async function plainMatchFiles(run, m, names) {
  const dir = matchDir(DIR, m.id), src = brainSource(DIR);
  const files = { blue: readMatchFile(DIR, src, m.id, 'blue.json'), red: readMatchFile(DIR, src, m.id, 'red.json'), judge: readMatchFile(DIR, src, m.id, 'judge.json'), strengthen: readMatchFile(DIR, src, m.id, 'strengthen.json') };
  const refs = plainRefs(src && src.kind === 'folder' ? src.dir : null, files);
  let n = 0;
  for (const name of names) if (fs.existsSync(path.join(dir, name))) await plainOne(run, 'debates/' + m.id + '/' + name, path.join(dir, name), ++n, refs);
}
// 現有輸出（試驗資料夾）：生意大腦讀嘅 Markdown 同紅藍對打檔；node run.mjs --plain
async function plainAll() {
  const src = brainSource(DIR);
  const run = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), startedAt: localIso(), state: 'running', kind: 'plain', label: U.plainJob, replyFiles: [], steps: [] };
  step(run, 'received', U.plainJob, 'done', '');
  if (!src || src.kind !== 'folder') { step(run, 'plain', U.plainJob, 'done', '沒有試驗資料夾，毋須處理'); return finish(run, 'done'); }
  const wg = path.join(src.dir, 'wargame');
  const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(wg, f), 'utf8')); } catch { return null; } };
  const refs = plainRefs(src.dir, { blue: rd('blue.json'), red: rd('red.json'), judge: rd('judge.json'), strengthen: rd('strengthen.json') });
  const targets = fs.readdirSync(src.dir).filter(f => /生意體檢|預演|演練/.test(f) && f.endsWith('.md')).map(f => ['source/' + f, path.join(src.dir, f)])
    .concat(fs.existsSync(wg) ? fs.readdirSync(wg).filter(f => /^(blue|red|rebuttal|judge|strengthen)\.json$/.test(f)).map(f => ['source/wargame/' + f, path.join(wg, f)]) : []);
  step(run, 'plain', U.plainJob, 'running', `共 ${targets.length} 份文件`);
  let n = 0;
  const done = [];
  for (const [key, f] of targets) { const r = await plainOne(run, key, f, ++n, refs); if (r) done.push(docNameOf(key, fs.readFileSync(f, 'utf8')) + '：' + ({ clean: '毋須改寫', ai: 'AI 已改寫', 'ai+fallback': 'AI 已改寫（另有機械替換）', fallback: '機械替換' }[r.mode] || r.mode) + (r.marked ? `，${r.marked} 處含內部用語` : '')); }
  const idxW = displayIndex(DIR), prevW = idxW._plainWarnings, nowW = targets.flatMap(([key]) => (idxW[key] && idxW[key].warnTags) || []);
  const st = loadState(), hw = (st.health || {}).warnings || [];
  const old = w => Array.isArray(prevW) ? prevW.includes(w) : /^AI 文字含(內部用語|口語字)：/.test(w);
  st.health = { ...(st.health || {}), warnings: hw.filter(w => !old(w)).concat(nowW.filter(w => !hw.filter(x => !old(x)).includes(w))) };
  saveState(st);
  idxW._plainWarnings = nowW; writeJSON(path.join(displayDir(DIR), 'index.json'), idxW);
  run.result = { summary: done.join('；') || '沒有文件', artifacts: [], founderNext: [] };
  step(run, 'plain', U.plainJob, 'done', `共 ${targets.length} 份文件`);
  finish(run, 'done');
}

/* ---------- 主流程 ---------- */
/* ---------- 觀察資料夾（規劃書 4.12、附錄 A observe）：第一步套用系統頁交嚟嘅增刪檔 ----------
   founder/desk/observe-<時間>.json 只有雜湊同顯示名（或者開關）；外殼寫入帳本 observe 後歸檔。唔係 inputs[]、唔開 AI、唔算一次工作。
   舊版設定檔 founder/desk/observe.json 存咗路徑：轉做雜湊同顯示名之後刪走（路徑唔可以留喺任何檔）。 */
function applyObserve() {
  const desk = path.join(DIR.data, 'founder', 'desk'), legacy = path.join(desk, 'observe.json');
  let files = []; try { files = fs.readdirSync(desk).filter(f => /^observe-[\w-]+\.json$/.test(f)).sort(); } catch { }
  const hasLegacy = fs.existsSync(legacy);
  if (!files.length && !hasLegacy) return;
  const st = loadState(), old = st.observe || {};
  const ob = { folders: (Array.isArray(old.folders) ? old.folders : []).filter(f => f && /^[a-f0-9]{64}$/.test(String(f.hash || ''))) };
  if (old.off === true) ob.off = true;
  const add = (hash, name) => { if (!ob.folders.some(f => f.hash === hash)) ob.folders.push({ hash, name: clip(String(name || '').trim() || NAMES.dash.folderUnnamed, 40) }); };
  if (hasLegacy) {
    const c = readJSON(legacy, null);
    for (const f of (c && Array.isArray(c.folders) ? c.folders : [])) if (f && typeof f.dir === 'string' && path.isAbsolute(f.dir)) add(folderHash(f.dir), f.name || path.basename(f.dir));
    fs.rmSync(legacy, { force: true });
  }
  const arch = path.join(DIR.archive, 'desk');
  fs.mkdirSync(arch, { recursive: true });
  for (const f of files) {
    const r = readJSON(path.join(desk, f), null) || {};
    if (r.op === 'add' && /^[a-f0-9]{64}$/.test(String(r.hash || ''))) add(r.hash, r.name);
    else if (r.op === 'remove') ob.folders = ob.folders.filter(x => x.hash !== r.hash);
    else if (r.op === 'off') ob.off = true;
    else if (r.op === 'on') delete ob.off;
    fs.renameSync(path.join(desk, f), path.join(arch, f));
  }
  st.observe = ob;
  saveState(st);
  log(`觀察資料夾：已套用 ${files.length + (hasLegacy ? 1 : 0)} 項更改（共 ${ob.folders.length} 個資料夾${ob.off ? '，觀測已關閉' : ''}）`);
}

/* ---------- 經營節奏（規劃書 3.6 四類 run 與跳過規則、3.8 自動停、3.9 每週訪問與每月覆核、3.12 試行到期、3.14 開第二站）----------
   排程（轉接層嘅作業系統排程，或者模擬實例嘅計時器）叫：run.mjs --type auto|rhythm|interview|on-demand --trigger schedule|manual [--slot 日期]
   伺服器（你送出後）照舊唔帶參數，記成「處理收件／你送出後」。每次 run 都記入帳本 runs[]（附錄 A），頁面只讀。
   要你決定嘅事（自動停、試行到期、開第二站、訪問、每月覆核）全部由外殼按帳本機械出題；答咗由外殼套用，AI 冇得改。 */
const ARG = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? String(process.argv[i + 1] || '') : ''; };
const RUN_TYPE = ['auto', 'rhythm', 'interview', 'on-demand'].includes(ARG('type')) ? ARG('type') : '';
const RUN_TRIGGER = ['schedule', 'manual'].includes(ARG('trigger')) ? ARG('trigger') : 'server';
const RUN_SLOT = /^\d{4}-\d{2}-\d{2}$/.test(ARG('slot')) ? ARG('slot') : '';
const todayIso = () => localIso().slice(0, 10);
// 今次有經核實嘅進展（3.6 第三步）：你確認嘅站點完成、證據級改變、觀察項由你嘅答案改變
let ADVANCED = false;
const HEALTH0 = { autoStopped: false, pausedByFounder: false, noProgressStreak: 0, warnings: [] };
const STOP_WARN = [U.skip_autoStopped, U.skip_pausedByFounder];
function healthOf(s) { s.health = { ...HEALTH0, ...(s.health || {}) }; s.health.warnings = (s.health.warnings || []).filter(w => !STOP_WARN.includes(w)); return s.health; }
function stopWarnings(h) { if (h.autoStopped) h.warnings.push(U.skip_autoStopped); if (h.pausedByFounder) h.warnings.push(U.skip_pausedByFounder); }
function recordRun(r) {
  const s = loadState(); s.runs = Array.isArray(s.runs) ? s.runs : [];
  const i = s.runs.findIndex(x => x.id === r.id);
  if (i >= 0) s.runs[i] = { ...s.runs[i], ...r }; else s.runs.push(r);
  s.runs = s.runs.slice(-200);
  saveState(s);
}
const openRhythm = kind => listPacks(DIR).filter(p => p.open).map(p => loadPack(DIR, p.id)).find(p => p && p.rhythm && (Array.isArray(kind) ? kind.includes(p.rhythm.kind) : p.rhythm.kind === kind)) || null;
const rhythmPack = (suffix, o) => ({ format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-' + suffix, next: null, askedBy: 'AI', askedAt: localIso(), fromRun: null, ...o });
// 你嘅輸入（回覆、交資料、要求、記錄真實事件）：解除自動停、重設計數（3.8）；「暫停」嘅持續暫停唔會因此解除
function noteFounderInput() {
  const s = loadState(), h = healthOf(s), was = h.autoStopped;
  h.autoStopped = false; delete h.autoStopReason; h.noProgressStreak = 0; h.lastInputAt = localIso();
  stopWarnings(h);
  if (was) { s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'shell', type: 'health', title: 'AI 已恢復工作：收到你的輸入', relatedIds: [], moduleIds: ['system'] }); }
  saveState(s);
}
// 停機門檻（3.8）：唔係跳過嘅 run，冇你嘅輸入亦冇經核實進展就加一；達二即自動停，並出「要繼續嗎？」
function countStreak(hadInput) {
  const s = loadState(), h = healthOf(s);
  h.noProgressStreak = hadInput || ADVANCED ? 0 : (h.noProgressStreak || 0) + 1;
  h.lastValidatedAt = localIso();
  const stop = !h.autoStopped && h.noProgressStreak >= 2;
  if (stop) { h.autoStopped = true; h.autoStopReason = U.skip_autoStopped; s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'shell', type: 'health', title: U.autoStopTitle.replace('：要繼續嗎？', ''), relatedIds: [], moduleIds: ['system', 'decisions'] }); }
  stopWarnings(h);
  saveState(s);
  if (stop) placeStopPack('autoStop');
}
function placeStopPack(kind) {
  if (openRhythm(['autoStop', 'paused'])) return null;
  const paused = kind === 'paused';
  return placePacks(DIR, [rhythmPack('as', { title: U.autoStopTitle, context: paused ? U.pausedWhy : U.autoStopWhy, afterConfirm: '答案即時生效', todoType: 'autoStop', rhythm: { kind },
    questions: [{ id: 'go', priority: 1, ask: paused ? U.pausedAsk : U.autoStopAsk, kind: 'choice', effect: 'now',
      options: [{ text: U.autoStopGo, rec: true }, { text: paused ? '維持暫停' : U.autoStopPause }], value: U.autoStopGo, why: paused ? U.pausedWhy : U.autoStopRec }] })])[0];
}
// 啟動預算（3.6）：每次開 AI 先記一行；以今日（本機日曆日）計
const STARTS = path.join(DIR.ledger, 'ai-starts.log');
function startsToday() { try { const d = todayIso(); return fs.readFileSync(STARTS, 'utf8').split('\n').filter(l => l.startsWith(d)).length; } catch { return 0; } }
const budgetLeft = () => rhythmOf(loadState()).aiStartsPerDay - startsToday();

// 下一個對外動作句入面嘅日期（「10 月 29 日」或者 2026-10-29）；冇就 null
function actionDay(text, today) {
  const t = String(text || '');
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return { day: m[0], raw: m[0], iso: true };
  m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(t);
  if (!m) return null;
  const y = Number(today.slice(0, 4));
  let day = `${y}-${pad(+m[1])}-${pad(+m[2])}`;
  if (day > addDays(today, 183)) day = `${y - 1}-${pad(+m[1])}-${pad(+m[2])}`;
  return { day, raw: m[0], iso: false };
}
const withDay = (text, ad, day) => String(text).replace(ad.raw, ad.iso ? day : dayText(day));
const nameWords = text => String(text || '').match(/[A-Za-z][A-Za-z.&-]{2,}/g) || [];
// AI 建議要有出處：公司紀錄喺某日之後有冇提到同一個名或者同一站嘅輸入；冇就建議稍後提供
function relatedInput(s, since, words) {
  const ws = words.filter(w => w && String(w).length >= 2);
  return (s.inputs || []).filter(i => String(i.eventDate || i.receivedAt || '').slice(0, 10) >= since)
    .find(i => ws.some(w => (String(i.title || '') + String(i.summary || '')).includes(w))) || null;
}
const recOpts = (texts, rec) => texts.map(t => t === rec ? { text: t, rec: true } : { text: t });
const replyArchived = file => { const now = clockNow(); return path.relative(DIR.data, path.join(DIR.archive, `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, file)).replace(/\\/g, '/'); };

/* ---------- 每週訪問（3.9）：訪問日前兩天內第一次 run 由外殼按帳本出題 ----------
   選項題預填公司紀錄現值（AI 建議）；文字題預設「沒有」（標「預設」，唔係 AI 推斷）。
   下一個對外動作嘅日期已過 → 改問「發生了嗎？」；已過目標日仍然進行中嘅站 → 問「完成了嗎？」（每次最多一條）。
   兩條都按公司紀錄有冇相關輸入建議，冇就建議稍後提供；揀咗之後要補嘅（結果、新日期、新動作、新目標日）由外殼加題入同一份訪問。 */
function placeInterviewIfDue() {
  const s = loadState(), iv = s.interviews;
  if (s.demo === true || !iv || !iv.nextOn || !(s.intake && s.intake.confirmedAt)) return null;
  if (todayIso() < addDays(iv.nextOn, -2) || iv.packFor === iv.nextOn || openRhythm('interview')) return null;
  const today = todayIso(), qs = [], nea = (s.company || {}).nextExternalAction;
  const ad = nea && nea.text ? actionDay(nea.text, today) : null;
  if (ad && ad.day < today) {
    const hit = relatedInput(s, ad.day, nameWords(nea.text).concat(((s.milestones || []).find(m => m.id === nea.milestoneId) || {}).short || ''));
    const rec = hit ? U.staleHeld : U.unknownLater;
    qs.push({ id: 'stale', bind: 'stale', about: '下一個對外動作', ask: NAMES.t('staleAsk', { t: clip(nea.text, 40), d: dayText(ad.day) }), kind: 'choice',
      options: recOpts([U.staleHeld, U.staleMoved, U.staleCancelled, U.unknownLater], rec), value: rec, effect: 'tentative',
      why: hit ? NAMES.t('staleWhyLedger', { d: dayText(String(hit.eventDate || hit.receivedAt).slice(0, 10)), t: clip(hit.title, 30) }) : U.staleWhyNone });
  } else if (nea && nea.text) qs.push({ id: 'next', bind: 'next', noChange: true, about: '下一個對外動作', ask: NAMES.t('interviewNext', { t: clip(nea.text, 40) }), kind: 'choice', options: [{ text: U.interviewSame, rec: true }], value: U.interviewSame, why: U.interviewWhyNow, effect: 'tentative' });
  const od = (s.milestones || []).filter(m => m.pathStatus === 'confirmed' && INPROG.includes(m.state) && /^\d{4}-\d{2}-\d{2}$/.test(m.targetDate || '') && m.targetDate < today).sort((a, b) => (a.order || 0) - (b.order || 0))[0];
  if (od) {
    const hit = relatedInput(s, od.targetDate, [od.short].concat(nameWords(od.event)));
    const rec = hit ? U.overdueDone : U.unknownLater;
    qs.push({ id: 'od', bind: 'overdue', overdue: { milestoneId: od.id }, about: od.short, ask: NAMES.t('overdueAsk', { s: od.short, d: dayText(od.targetDate) }), kind: 'choice',
      options: recOpts([U.overdueDone, U.overdueMove, U.overdueDrop, U.unknownLater], rec), value: rec, effect: 'tentative',
      why: hit ? NAMES.t('overdueWhyLedger', { d: dayText(String(hit.eventDate || hit.receivedAt).slice(0, 10)), t: clip(hit.title, 30) }) : U.overdueWhyNone });
  }
  const free = (id, ask) => ({ id, bind: 'none', preset: true, noChange: true, ask, kind: 'choice', options: [{ text: U.interviewNone, rec: true }], value: U.interviewNone, why: U.interviewWhyNone, effect: 'tentative' });
  qs.push(free('f1', U.interviewF1));
  const ms = (s.milestones || []).filter(m => m.pathStatus === 'confirmed' && m.state !== 'done').sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 2);
  const structured = [];
  for (const m of ms) for (const w of m.watchItems || []) structured.push({ id: 'w-' + w.id, bind: 'watch', noChange: true, watch: { milestoneId: m.id, id: w.id }, about: m.short + '：' + w.label, ask: '「' + w.label + '」仍然是 ' + w.value + (w.target != null ? '／' + w.target : '') + ' 嗎？', kind: 'choice', options: [{ text: U.interviewSame, rec: true }], value: U.interviewSame, why: U.interviewWhyNow, effect: 'tentative' });
  const soon = addDays(today, 2), ans = (s.intake && s.intake.answers) || {};
  for (const [plan, a] of Object.entries(ans)) {
    const until = a && a.tentative && a.tentative.until;
    if (!until || until > soon || !NAMES.field[plan]) continue;
    structured.push({ id: 't-' + plan, bind: 'tent', noChange: true, tent: { plan }, about: NAMES.field[plan], ask: NAMES.t('interviewTent', { l: NAMES.field[plan], v: clip(a.value, 40) }), kind: 'choice', options: [{ text: U.interviewTentKeep, rec: true }], value: U.interviewTentKeep, why: '暫定值到期；照用就再暫定四星期，有變化就寫新值。', effect: 'tentative' });
  }
  const weak = ((s.company || {}).assumptions || []).filter(a => EV_RANK(a.grade || 'guess') < 2).slice(0, 3);
  for (const a of weak) {
    const g = a.grade || 'guess', up = NAMES.EV_KEYS[EV_RANK(g) + 1];
    structured.push({ id: 'a-' + a.id, bind: 'assume', noChange: true, about: clip(a.text, 30), ask: NAMES.t('interviewAssume', { a: clip(a.text, 40) }), kind: 'choice',
      options: [{ text: '維持「' + NAMES.evName(g) + '」', rec: true, apply: { op: 'setAssumptionGrade', id: a.id, grade: g } }].concat(up ? [{ text: '改為「' + NAMES.evName(up) + '」', apply: { op: 'setAssumptionGrade', id: a.id, grade: up } }] : []),
      value: '維持「' + NAMES.evName(g) + '」', why: U.interviewWhyNow, effect: 'tentative' });
  }
  const frees = ['F2', 'F3', 'F4', 'F5'].map(k => free(k.toLowerCase(), U['interview' + k]));
  // 待你確認嘅事（唔計暫停、訪問呢類經營節奏題）
  const waiting = listPacks(DIR).filter(p => p.open && !(loadPack(DIR, p.id) || {}).rhythm).map(p => p.title).slice(0, 3);
  if (waiting.length) frees.push(free('f6', U.interviewF6 + '（' + waiting.map(t => '「' + clip(t, 20) + '」').join('、') + '）'));
  // 合共最多 12 條：文字題同下一個對外動作一定問，結構化題超出嘅留到下次
  const room = Math.max(0, MAX_PER_PACK - qs.length - frees.length);
  const all = qs.concat(structured.slice(0, room), frees).map((q, i) => ({ ...q, priority: i + 1 }));
  const pack = rhythmPack('iv', { title: NAMES.t('interviewTitle', { d: dayText(iv.nextOn) }), context: U.interviewContext, afterConfirm: '選項答案即時記入公司紀錄；寫了文字答案就交 AI 擬確認問題，經你確認才生效',
    todoType: 'interview', due: iv.nextOn, rhythm: { kind: 'interview', on: iv.nextOn }, questions: all });
  const placed = placePacks(DIR, [pack])[0];
  const s2 = loadState(); s2.interviews = { ...s2.interviews, packFor: iv.nextOn, packId: placed.id }; saveState(s2);
  log(`每週訪問已出題：${placed.id}（${all.length} 條）`);
  return placed;
}
function handleInterviewAnswer(run, pack, store, fresh) {
  const s = loadState(), iv = s.interviews = s.interviews || {}, today = todayIso(), said = [], texts = [], extra = [], placedNow = [];
  iv.applied = iv.applied || {};
  const done = new Set(iv.applied[pack.id] || []);
  let structuredSeen = false;
  s.events = s.events || [];
  const ev = (type, title, ids) => s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type, title, relatedIds: ids, moduleIds: ['now', 'inputs'] });
  const has = id => pack.questions.some(q => q.id === id) || extra.some(q => q.id === id);
  const addQ = q => { if (!has(q.id)) extra.push({ effect: 'tentative', ...q }); };
  const neaNow = () => (s.company || {}).nextExternalAction || {};
  const activeMs = () => (s.milestones || []).filter(m => m.pathStatus === 'confirmed' && m.state === 'active').sort((x, y) => (x.order || 0) - (y.order || 0))[0];
  const setNext = (text, milestoneId, t) => { s.company = s.company || {}; s.company.nextExternalAction = { text: clip(text, 120), milestoneId: milestoneId || '' }; said.push(t || '下一個對外動作改為：' + clip(text, 40)); ev('decision', t || '下一個對外動作改為：' + clip(text, 40), [pack.id]); };
  const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  for (const q of pack.questions) {
    const a = store.answers[q.id];
    if (!a || done.has(q.id) || !fresh.has(q.id)) continue;
    done.add(q.id);
    const val = String(a.value ?? '').trim(), opt = (q.options || []).find(o => o.text === val), unknown = !val || val === U.unknownLater;
    if (q.bind === 'none' || q.bind === 'held') { if (!unknown && val !== U.interviewNone) texts.push(q.id); continue; }
    structuredSeen = true;
    if (q.bind === 'next') {
      if (unknown || val === U.interviewSame) continue;
      // 小旗原本掛喺已完成嘅站：改掛進行中嘅站
      const old = neaNow(), oldM = (s.milestones || []).find(m => m.id === old.milestoneId), act = activeMs();
      setNext(val, (old.pendingUpdate || (oldM && oldM.state === 'done')) && act ? act.id : old.milestoneId);
    } else if (q.bind === 'stale') {
      const nea = neaNow();
      if (val === U.staleHeld) addQ({ id: 'held', bind: 'held', preset: true, about: '下一個對外動作的結果', ask: NAMES.t('heldAsk', { t: clip(nea.text, 40) }), kind: 'choice', options: [{ text: U.unknownLater, rec: true }], value: U.unknownLater, why: U.heldWhy });
      else if (val === U.staleMoved) addQ({ id: 'newDate', bind: 'newDate', about: '下一個對外動作的日期', ask: NAMES.t('newDateAsk', { t: clip(nea.text, 40) }), kind: 'date', value: addDays(today, 7), why: U.newDateWhy });
      else if (val === U.staleCancelled) {
        const act = activeMs(), sug = act ? clip(String(act.event || act.short).trim(), 100) : '';
        s.company.nextExternalAction = { ...nea, pendingUpdate: true };
        addQ({ id: 'next2', bind: 'next2', about: '下一個對外動作', ask: NAMES.t('next2Ask', { t: clip(nea.text, 40) }), kind: 'choice',
          options: (sug ? [{ text: sug, rec: true, apply: { op: 'setNextExternalAction', text: sug, milestoneId: act.id } }] : []).concat([{ text: U.unknownLater, ...(sug ? {} : { rec: true }) }]),
          value: sug || U.unknownLater, why: act ? NAMES.t('next2Why', { s: act.short }) : U.staleWhyNone });
        said.push('「' + clip(nea.text, 30) + '」取消了；下一個對外動作待你確認');
      } else if (!opt && !unknown) texts.push(q.id);
    } else if (q.bind === 'newDate') {
      const nea = neaNow(), ad = actionDay(nea.text, today);
      if (isDay(val) && ad) setNext(withDay(nea.text, ad, val), nea.milestoneId, '下一個對外動作改期至 ' + dayText(val));
    } else if (q.bind === 'next2') {
      if (unknown) continue;
      const ap = opt && opt.apply, act = activeMs();
      setNext(ap ? ap.text : val, ap ? ap.milestoneId : act ? act.id : '');
    } else if (q.bind === 'overdue') {
      const m = (s.milestones || []).find(x => x.id === q.overdue.milestoneId);
      if (!m) continue;
      if (val === U.overdueDone) {
        // 接站點完成確認（3.3）：同記錄真實事件一樣嘅確認包，你確認先生效；證明＝你今次嘅訪問回覆
        const ref = 'iv-' + stamp() + '-od', input = { id: 'in-' + ref, kind: 'interview', title: clip(NAMES.t('interviewTitle', { d: dayText(pack.rhythm.on) }) + '：「' + m.short + '」已完成', 50), file: replyArchived(store.answers[q.id].reply || ''), files: [], eventDate: today, receivedAt: localIso(), status: 'awaitingFounder', effects: [], fromPackId: pack.id };
        s.inputs = s.inputs || []; s.inputs.push(input);
        const cp = eventPack(run, s, input, [{ kind: 'milestone', id: m.id, done: true, why: '你在每週訪問答「已完成」；確認後這一站標為完成，以你今次的答案作紀錄。' }]);
        placedNow.push(cp); input.packId = cp.id; input.awaitingFounderText = U.eventAwaiting;
        said.push('「' + m.short + '」完成確認已放上待決事項');
      } else if (val === U.overdueMove) addQ({ id: 'odDate', bind: 'odDate', overdue: { milestoneId: m.id }, about: m.short + '的目標日', ask: NAMES.t('overdueDateAsk', { s: m.short }), kind: 'date', value: addDays(today, 14), why: U.overdueDateWhy });
      else if (val === U.overdueDrop) {
        placedNow.push(rhythmPack('rt', { title: NAMES.t('retireTitle', { s: m.short }), context: U.retireWhy, afterConfirm: '答案即時生效', todoType: 'path', milestoneId: m.id, rhythm: { kind: 'retire', milestoneId: m.id }, fromRun: run.id,
          questions: [{ id: 'retire', priority: 1, ask: NAMES.t('retireAsk', { s: m.short }), kind: 'choice', effect: 'now', options: [{ text: U.retireYes, rec: true }, { text: U.retireNo }], value: U.retireYes, why: U.retireWhy }] }));
        said.push('「' + m.short + '」撤回確認已放上待決事項');
      } else if (!opt && !unknown) texts.push(q.id);
    } else if (q.bind === 'odDate') {
      const m = (s.milestones || []).find(x => x.id === q.overdue.milestoneId);
      if (m && isDay(val)) { s.targetOverride = { ...(s.targetOverride || {}), [m.id]: val }; m.targetDate = val; said.push('「' + m.short + '」目標日改為 ' + dayText(val)); ev('path', '目標日更新：' + m.short + '（' + dayText(val) + '）', [m.id, pack.id]); }
    } else if (q.bind === 'assume') {
      let ap = opt ? opt.apply : null;
      if (!opt) { const k = NAMES.evKey(val.replace(/^(?:改為|維持)/, '').replace(/[「」\s]/g, '')); const id = (((q.options || [])[0] || {}).apply || {}).id; ap = k && id ? { op: 'setAssumptionGrade', id, grade: k } : null; }
      const as = ap && ((s.company || {}).assumptions || []).find(x => x.id === ap.id);
      if (!as || (as.grade || 'guess') === ap.grade) continue;
      const from = as.grade || 'guess';
      as.grade = ap.grade; as.sourceId = pack.id; as.changedAt = today;
      as.status = EV_RANK(ap.grade) < EV_RANK(from) ? 'weakened' : EV_RANK(ap.grade) >= 2 ? 'supported' : 'open';
      const t = '「' + clip(as.text, 30) + '」由「' + NAMES.evName(from) + '」改為「' + NAMES.evName(ap.grade) + '」'; said.push(t); ev('input', '證據級更新（每週訪問）：' + t, [as.id, pack.id]);
    } else if (q.bind === 'tent') {
      if (val === U.interviewTentKeep) { s.tentOverride = { ...(s.tentOverride || {}), [q.tent.plan]: addDays(today, 28) }; said.push('「' + NAMES.field[q.tent.plan] + '」照用，再暫定四星期'); }
      else if (!unknown) texts.push(q.id);
    } else if (q.bind === 'watch') {
      const m = (s.milestones || []).find(x => x.id === q.watch.milestoneId), w = m && (m.watchItems || []).find(x => x.id === q.watch.id);
      const n = Number(val);
      if (!w || val === U.interviewSame || !Number.isFinite(n)) { if (w && (w.history || []).length === 0 && val === U.interviewSame) { w.history = [{ at: today, value: w.value, by: 'founder' }]; } continue; }
      if (n !== Number(w.value)) { w.history = (w.history || []).concat({ at: today, value: n, by: 'founder' }); const t = '「' + w.label + '」由 ' + w.value + ' 改為 ' + n; w.value = n; ADVANCED = true; said.push(t); ev('input', t, [m.id, pack.id]); }
    }
  }
  iv.applied[pack.id] = [...done];
  // 要補嘅題目加入同一份訪問（下次打開就見到）
  if (extra.length) { const n = pack.questions.length; pack.questions.push(...extra.map((q, i) => ({ ...q, priority: n + i + 1 }))); writeJSON(path.join(DIR.asks, pack.id + '.json'), pack); }
  let monthly = null;
  // 同一份訪問收到至少一題選項答案（包括「無變化」）先算做咗：更新上次、下次（3.9 (3)）
  if (structuredSeen && iv.lastFor !== pack.rhythm.on) {
    const r = rhythmOf(s);
    let next = addDays(pack.rhythm.on, 7);
    if (next <= today) next = nextWeekday(today, r.interviewWeekday);
    Object.assign(iv, { lastOn: today, lastFor: pack.rhythm.on, nextOn: next, count: (iv.count || 0) + 1, lastSummary: said.length ? said.slice(0, 5) : ['沒有變化'], changed: said.join('；') });
    ev('input', '每週訪問已作答（' + dayText(pack.rhythm.on) + '）', [pack.id]);
    if (iv.count % 4 === 0) monthly = true;
  }
  saveState(s);
  const asks = placedNow.length ? placePacks(DIR, placedNow) : [];
  if (asks.length) {
    // 完成確認包嘅 id 寫返入嗰筆輸入
    const s4 = loadState();
    for (const p of placedNow) if (p.realEvent) { const inp = (s4.inputs || []).find(i => i.id === p.realEvent.inputId); if (inp) inp.packId = p.id; }
    saveState(s4);
  }
  if (monthly) monthly = placeMonthly(run);
  writeInterviewRecord(pack, store, said);
  const summary = (said.length ? '已更新：' + said.join('；') + '。' : '已記錄你的答案；公司紀錄沒有變化。') + (extra.length ? '另有 ' + extra.length + ' 條補充題已加入這份訪問。' : '') + (structuredSeen ? '下次訪問：' + dayText(iv.nextOn) + '。' : '') + (monthly ? '每月覆核已放上待決事項。' : '');
  step(run, 'interview', U.interviewTitle.replace('（{d}）', ''), 'done', summary);
  run.result = { summary, artifacts: [], founderNext: [], asks: asks.concat(monthly ? [monthly] : []) };
  if (!texts.length) return finish(run, 'done');
  // 文字答案：同「記錄真實事件」同一條路（3.9 (3)、3.10）— AI 只可以建議，經你確認先改站點、證據級同下一個對外動作
  const text = texts.map(id => { const q = pack.questions.find(x => x.id === id); return '- 問：' + q.ask + '\n  答：' + String(store.answers[id].value).trim(); }).join('\n');
  const ref = 'iv-' + stamp(), first = String(store.answers[texts[0]].value).replace(/\s+/g, ' ');
  const s3 = loadState(); s3.inputs = s3.inputs || [];
  s3.inputs.push({ id: 'in-' + ref, kind: 'interview', title: clip(U.interviewTitle.replace('{d}', dayText(pack.rhythm.on)) + '：' + first, 50), file: replyArchived(store.answers[texts[0]].reply || ''), files: [], eventDate: today, receivedAt: localIso(), status: 'unprocessed', effects: [], fromPackId: pack.id });
  saveState(s3);
  run.kind = 'note'; run.noteType = 'event'; run.ref = ref;
  const sb = newSandbox(run);
  eventTask(sb, loadState(), { text, date: today, files: [], ref, heading: '# 創辦人在每週訪問的文字答案' });
  return runAIStep(run, sb, U.stepEventAI, true);
}
// 撤回一站（你喺訪問答「不再做」之後確認）：站留喺紀錄、標已撤；最前未完成嘅站接上
function handleRetireAnswer(run, pack, store) {
  const s = loadState(), a = store.answers.retire, m = (s.milestones || []).find(x => x.id === pack.rhythm.milestoneId);
  if (!a || a.value !== U.retireYes || !m || m.state === 'done') { run.result = { summary: '已記錄：保留' + (m ? '「' + m.short + '」' : '這一站') + '。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  Object.assign(m, { pathStatus: 'retired', state: 'not_started', retiredReason: '你在每週訪問答「不再做」', retiredDecisionId: pack.id });
  ensureActive(s.milestones);
  const nea = (s.company || {}).nextExternalAction;
  if (nea && nea.milestoneId === m.id) s.company.nextExternalAction = { ...nea, pendingUpdate: true };
  s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'path', title: '撤回一站：' + m.short, relatedIds: [m.id, pack.id], moduleIds: ['paths', 'now'] });
  saveState(s);
  run.result = { summary: '已撤回「' + m.short + '」；路線由下一站接上。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
// 訪問紀錄（3.9 (3)）：問、答、因此改了甚麼、仍等你回覆的事；每次送出都重寫，以最新為準
function writeInterviewRecord(pack, store, said) {
  const dir = path.join(DIR.work, 'interviews'); fs.mkdirSync(dir, { recursive: true });
  const L = ['# ' + pack.title, ''];
  for (const q of pack.questions) { const a = store.answers[q.id]; L.push('## ' + q.ask, '', a ? '- 答：' + String(a.value) + '（' + (a.confirmedSame ? U.confirmedSame : a.changed ? '你改寫' : q.preset ? '預設' : '照建議') + '）' : '- 未答'); L.push(''); }
  if (said.length) L.push('## 因此更新', '', ...said.map(t => '- ' + t), '');
  fs.writeFileSync(path.join(dir, pack.rhythm.on + '.md'), L.join('\n'));
}
// 每月覆核（3.9 (4)）：每第四次訪問另出一包；兩題都即時生效
function placeMonthly() {
  if (openRhythm('monthly')) return null;
  const s = loadState(), g = (s.goals && s.goals.quarter && s.goals.quarter.text) || ((s.intake && s.intake.answers && s.intake.answers.G1) || {}).value || '';
  const qs = [{ id: 'perm', priority: 1, ask: U.monthlyPerm, kind: 'choice', effect: 'now', options: [{ text: U.monthlyPermKeep, rec: true }, { text: U.monthlyPermNarrow }], value: U.monthlyPermKeep, why: U.monthlyWhy }];
  if (g) qs.push({ id: 'goal', priority: 2, ask: NAMES.t('monthlyGoal', { t: clip(g, 50) }), kind: 'choice', effect: 'now', options: [{ text: U.monthlyGoalKeep, rec: true }], value: U.monthlyGoalKeep, why: U.monthlyGoalWhy });
  return placePacks(DIR, [rhythmPack('mr', { title: NAMES.t('monthlyTitle', { d: dayText(todayIso()) }), context: '每月一次覆核：AI 可自行處理的事同本季目標。', afterConfirm: '答案即時生效', todoType: 'decision', rhythm: { kind: 'monthly' }, questions: qs })])[0];
}
async function handleMonthlyAnswer(run, pack, store) {
  const s = loadState(), said = [], today = todayIso(); let narrow = false;
  s.events = s.events || [];
  const p = store.answers.perm, gq = store.answers.goal;
  if (p) { if (p.value === U.monthlyPermNarrow) { narrow = true; said.push('你要求收窄 AI 可自行處理的事'); } else { s.company = s.company || {}; s.company.permissionsReviewedAt = today; said.push('AI 可自行處理的事照舊'); } }
  if (gq && String(gq.value).trim() && gq.value !== U.monthlyGoalKeep && gq.value !== U.unknownLater) {
    const old = (s.goals && s.goals.quarter) || {};
    s.goals = { ...(s.goals || {}), quarter: { ...old, text: clip(String(gq.value).trim(), 120), setAt: today, by: 'founder' } };
    said.push('本季目標改為：' + clip(gq.value, 40));
  } else if (gq) said.push('本季目標不變');
  for (const t of said) s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'decision', title: '每月覆核：' + t, relatedIds: [pack.id], moduleIds: ['decisions'] });
  saveState(s);
  run.result = { summary: '已記錄：' + said.join('；') + '。', artifacts: [], founderNext: [] };
  if (checkupStale() && readJSON(CONFIRMED, null)) await brainStep(run, 'checkup');
  if (narrow) return aiAfterAsk(run, { ...pack, next: { task: '創辦人要求收窄 AI 可自行處理的事：按公司概覽「AI 可自行處理的事」三格，擬一個收窄方案，寫成問題包讓創辦人逐項確認（每項附建議同一句理由）；唔好自己改任何權限。' } });
  return finish(run, 'done');
}

/* ---------- 試行到期（3.12）：過咗到期日或者觸及停止訊號 → 站轉「等你決定」，外殼出題（轉正／延長一次／撤回） ---------- */
function checkTrials() {
  const s = loadState(), today = todayIso(), out = [];
  if (s.demo === true) return out;
  for (const m of s.milestones || []) {
    const t = m.trial;
    if (!t || t.verdict || t.decisionPackId || !t.startedAt || t.startedAt > today || m.pathStatus === 'retired') continue;
    const stop = !!(t.stopSignal && t.stopSignal.met), win = !!(t.successSignal && t.successSignal.met);
    if (!(stop || (t.until && t.until < today))) continue;
    m.state = 'waiting';
    const rec = win ? U.trialPromote : stop || t.extendedOnce ? U.trialRetire : U.trialExtend;
    const sig = s2 => s2 ? '「' + clip(s2.text, 30) + '」' + (s2.target != null ? '（' + (s2.value ?? 0) + '／' + s2.target + '）' : '') + (s2.met ? '已達到' : '未達到') : '';
    const why = (stop ? '停止訊號' + sig(t.stopSignal) : '試行已於 ' + dayText(t.until) + ' 到期') + (t.successSignal ? '；成功訊號' + sig(t.successSignal) : '') + '。' + (win ? '成功訊號已達到，建議轉正。' : stop ? '建議撤回。' : t.extendedOnce ? '已經延長過一次，建議撤回或轉正。' : '未有定論，建議延長一次再看。');
    const opts = [{ text: U.trialPromote }, ...(t.extendedOnce ? [] : [{ text: U.trialExtend }]), { text: U.trialRetire }].map(o => o.text === rec ? { ...o, rec: true } : o);
    const placed = placePacks(DIR, [rhythmPack('tr', { title: NAMES.t('trialTitle', { s: m.short }), context: U.trialWhy, afterConfirm: '答案即時生效', todoType: 'trial', milestoneId: m.id, due: t.until || today, rhythm: { kind: 'trial', milestoneId: m.id },
      questions: [{ id: 'verdict', priority: 1, ask: NAMES.t('trialAsk', { s: m.short }), kind: 'choice', effect: 'now', options: opts, value: rec, why }] })])[0];
    t.decisionPackId = placed.id;
    s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'shell', type: 'path', title: '試行到期，等你決定：' + m.short, relatedIds: [m.id, placed.id], moduleIds: ['paths', 'decisions'] });
    out.push(placed);
  }
  if (out.length) saveState(s);
  return out;
}
function handleTrialAnswer(run, pack, store) {
  const s = loadState(), m = (s.milestones || []).find(x => x.id === pack.rhythm.milestoneId), a = store.answers.verdict;
  if (!m || !m.trial || !a) { run.result = { summary: '已記錄你的答案。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const t = m.trial, today = todayIso(); let said = '';
  if (a.value === U.trialPromote) {
    const max = Math.max(0, ...(s.milestones || []).filter(x => x.pathStatus === 'confirmed' && (x.lineId || 'main') === (m.lineId || 'main')).map(x => x.order || 0));
    Object.assign(m, { pathStatus: 'confirmed', order: max + 1, state: 'not_started' }); t.verdict = 'promoted'; t.decidedAt = today; said = '「' + m.short + '」轉正，排在路線最後';
  } else if (a.value === U.trialExtend && !t.extendedOnce) {
    t.until = addDays(t.until || today, 28); t.extendedOnce = true; delete t.decisionPackId; m.state = 'active'; said = '「' + m.short + '」延長試行至 ' + dayText(t.until);
  } else if (a.value === U.trialRetire) {
    Object.assign(m, { pathStatus: 'retired', state: 'not_started', retiredReason: '試行到期，經你決定撤回', retiredDecisionId: pack.id }); t.verdict = 'retired'; t.decidedAt = today; said = '「' + m.short + '」撤回';
  } else { run.result = { summary: '已記錄你的答案；試行狀態未有更改，請在三個選項中選一個。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  ensureActive(s.milestones);
  s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'path', title: '試行決定：' + said, relatedIds: [m.id, pack.id], moduleIds: ['paths', 'now'] });
  saveState(s);
  run.result = { summary: '已更新：' + said + '。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}

/* ---------- 站點進度（3.14 第 4 點）：最前未完成嘅已確認站自動進行中；第二站要你確認一次（openSecond）；試行另計 ---------- */
const INPROG = ['active', 'waiting', 'blocked'];
function ensureActive(ms) {
  let changed = false;
  for (const ln of [...new Set((ms || []).map(m => m.lineId || 'main'))]) {
    const conf = ms.filter(m => (m.lineId || 'main') === ln && m.pathStatus === 'confirmed').sort((a, b) => (a.order || 0) - (b.order || 0));
    const first = conf.find(m => m.state !== 'done');
    if (!first || INPROG.includes(first.state) || conf.filter(m => INPROG.includes(m.state)).length >= 2) continue;
    first.state = 'active'; changed = true;
  }
  return changed;
}
function secondProblem(s, id) {
  const m = (s.milestones || []).find(x => x.id === id);
  if (!m) return '找不到這一站';
  if (m.pathStatus !== 'confirmed') return '這一站未經你確認';
  if (m.state === 'done' || INPROG.includes(m.state)) return '這一站已經開始或完成';
  if ((m.dependsOn || []).some(d => ((s.milestones || []).find(x => x.id === d) || {}).state !== 'done')) return '這一站要等前面的站完成';
  if ((s.milestones || []).filter(x => (x.lineId || 'main') === (m.lineId || 'main') && x.pathStatus === 'confirmed' && INPROG.includes(x.state)).length !== 1) return '同一條路線要剛好一站進行中';
  return '';
}
// AI 建議開第二站（out/decisions.json）：外殼核對條件後先出題，AI 冇得自己開
function takeOpenSecond(sb, run) {
  const raw = readJSON(path.join(sb, 'out', 'decisions.json'), null);
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.decisions) ? raw.decisions : [];
  const d = list.find(x => x && x.type === 'openSecond');
  if (!d) return null;
  const s = loadState(), why = secondProblem(s, String(d.milestoneId || ''));
  if (why) { log(`${run.id} AI 建議開第二站，外殼核對不通過：${why}`); return null; }
  if (openRhythm('second')) return null;
  const m = s.milestones.find(x => x.id === d.milestoneId);
  return placePacks(DIR, [rhythmPack('s2', { title: NAMES.t('secondTitle', { s: m.short }), context: '路線上一次最多兩站同時進行；第二站要你確認一次。', afterConfirm: '答案即時生效', todoType: 'decision', milestoneId: m.id, rhythm: { kind: 'second', milestoneId: m.id }, fromRun: run.id,
    questions: [{ id: 'open', priority: 1, ask: NAMES.t('secondAsk', { s: m.short }), kind: 'choice', effect: 'now', options: [{ text: U.secondYes, rec: true }, { text: U.secondNo }], value: U.secondYes, why: clip(String(d.why || ''), 140) || '兩站互不依賴，可以同時推進。' }] })])[0];
}
function handleSecondAnswer(run, pack, store) {
  const s = loadState(), a = store.answers.open, id = pack.rhythm.milestoneId, m = (s.milestones || []).find(x => x.id === id);
  if (!a || a.value !== U.secondYes || !m) { run.result = { summary: '已記錄：暫不開始第二站。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const why = secondProblem(s, id);
  if (why) { run.result = { summary: '已記錄你的答案；未能開始「' + m.short + '」：' + why + '。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  m.state = 'active'; m.parallelConfirmedAt = localIso();
  s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'path', title: '兩站並行：開始「' + m.short + '」', relatedIds: [m.id, pack.id], moduleIds: ['paths', 'now'] });
  saveState(s);
  run.result = { summary: '已開始「' + m.short + '」，兩站並行。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
function handleStopAnswer(run, pack, store) {
  const s = loadState(), h = healthOf(s), a = store.answers.go, go = !a || a.value === U.autoStopGo;
  // 呢份回覆本身係你嘅輸入：自動停已經喺開頭解除；揀「暫停」就寫持續暫停，另出「要繼續嗎？」
  let said;
  if (go) { const was = h.pausedByFounder; h.pausedByFounder = false; said = 'AI 會在下一次排定時間繼續工作'; if (was) resumePaused(); }
  else { h.pausedByFounder = true; said = 'AI 已暫停；要恢復時在待決事項按「繼續」'; }
  stopWarnings(h);
  s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'health', title: go ? '你選擇讓 AI 繼續工作' : '你選擇暫停 AI', relatedIds: [pack.id], moduleIds: ['system'] });
  saveState(s);
  const next = go ? null : placeStopPack('paused');
  run.result = { summary: said + '。', artifacts: [], founderNext: [], asks: next ? [next] : [] };
  return finish(run, 'done');
}
// 暫停期間等住嘅 AI 工作：你按「繼續」之後交返伺服器續做
function resumePaused() {
  const ids = readJSON(STATUS, { runs: [] }).runs.filter(r => r.state === 'waiting' && r.waitingFor === 'paused').map(r => r.id);
  if (ids.length) writeJSON(RETRY, { runIds: ids, at: localIso() });
}
const pausedNow = () => !!(loadState().health || {}).pausedByFounder;

/* ---------- 排程 run（3.6）：第一步機械工作 → 跳過規則 → AI 日常工作 → 外殼判定收尾 ---------- */
function rhythmLedger(type) {
  const s = loadState(), today = todayIso();
  const ms = (s.milestones || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99));
  const canDo = (s.tasks || []).filter(t => t.owner !== 'founder' && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'waiting').map(t => ({ title: t.title, next: t.next || '', firstBatch: !!t.firstBatch, milestoneId: t.milestoneId || '' }));
  const open = listPacks(DIR).filter(p => p.open).map(p => { const f = loadPack(DIR, p.id) || {}; return { title: p.title, questions: (f.questions || []).map(q => q.ask) }; });
  const second = ms.find(m => !secondProblem(s, m.id));
  return {
    today, runType: type, missingAnswers: ((s.intake || {}).missing || []).map(p => NAMES.field[p] || p),
    milestones: ms.filter(m => m.pathStatus !== 'retired').map(m => ({ id: m.id, short: m.short, state: m.state, pathStatus: m.pathStatus, kind: m.kind, event: m.event, depth: m.depth, targetDate: m.targetDate || '', trial: m.trial ? { until: m.trial.until, verdict: m.trial.verdict || '' } : undefined })),
    nextExternalAction: (s.company || {}).nextExternalAction || null,
    assumptions: ((s.company || {}).assumptions || []).map(a => ({ text: a.text, grade: NAMES.evName(a.grade || 'guess') })),
    canDo, openQuestions: open, notYetKnown: openUnknowns(DIR).map(u => ({ question: u.question, until: u.until })),
    interviews: s.interviews ? { nextOn: s.interviews.nextOn, lastOn: s.interviews.lastOn || '', lastSummary: s.interviews.lastSummary || [] } : null,
    recentInputs: (s.inputs || []).filter(i => i.status === 'processed').slice(-5).map(i => ({ title: i.title, effects: (i.effects || []).map(e => e.change) })),
    previousRuns: (s.runs || []).filter(r => r.state === 'ended').slice(-3).map(r => ({ date: String(r.startedAt).slice(0, 10), label: r.label, ending: r.ending, blockedOn: r.blockedOn || '' })),
    secondStationAllowed: second ? { id: second.id, short: second.short } : null,
    // 客戶推進（規劃書 4.6）：每個對象嘅推進位置（只按你確認嘅事件）同目前下一步；AI 建議每個對象嘅下一步
    prospects: pipelineOf(DIR).prospects.map(p => ({ id: p.id, name: p.name, kind: p.kind, stage: p.stage ? NAMES.evName(NAMES.EV_KEYS[p.stage]) : '未接觸', lastReal: p.lastReal, next: p.next }))
  };
}
// AI 建議每個對象嘅下一步（out/prospects.json）：外殼核對對象存在，每個對象一項工作（3.14），有就改寫、冇就新增；格位唔郁
function takeProspects(sb, run) {
  const raw = readJSON(path.join(sb, 'out', 'prospects.json'), null);
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.prospects) ? raw.prospects : [];
  const byId = Object.fromEntries(pipelineOf(DIR).prospects.map(p => [p.id, p])), seen = new Set(), done = [];
  for (const x of list) {
    const p = byId[x && x.prospectId], next = String((x && x.next) || '').replace(/\s+/g, ' ').trim();
    if (!p || !next || seen.has(p.id)) continue;
    seen.add(p.id);
    // 畫面會見到嘅一句：有內部用語就唔收（保留上次嘅下一步），記警告
    const hits = NAMES.styleIssues(next);
    if (hits.length) { log(`${run.id} 對象「${p.name}」嘅下一步有內部用語，唔收：${hits.map(h => h.term || h).join('、')}`); continue; }
    const open = (loadState().tasks || []).find(t => t.prospectId === p.id && !['done', 'cancelled'].includes(t.status));
    const id = open ? open.id : 'pn-' + p.id + '-' + stamp();
    if (open && open.title === clip(next, 40)) continue;
    upsertTask({ id, title: clip(next, 40), owner: 'ai', status: open ? open.status : 'planned', prospectId: p.id, next: clip(String(x.why || '').trim() || NAMES.t('prospectWhy', { n: p.name }), 60), fromRun: run.id });
    done.push(p.name);
  }
  if (done.length) { addEvent({ actor: 'ai', type: 'run', title: NAMES.t('prospectEvent', { n: done.length }), relatedIds: [run.id], moduleIds: ['ai-week'] }); log(`${run.id} 每個對象嘅下一步：${done.join('、')}`); }
  return done.length;
}
async function rhythmRun() {
  // 第一步：同步帳本、機械工作（唔使 AI）；所有排程 run 都記入帳本，跳過都記
  if (!fs.readdirSync(DIR.replies).some(f => f.endsWith('.md'))) migrateOverview();
  syncLedger();
  const s0 = loadState(), today = todayIso(), r = rhythmOf(s0);
  const type = RUN_TYPE === 'auto' ? (isWeekday(today, r.interviewWeekday) ? 'interview' : 'rhythm') : RUN_TYPE;
  const lr = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), type, trigger: RUN_TRIGGER, slot: RUN_SLOT || today, startedAt: localIso(), capMinutes: r.runCapMinutes, aiStarted: false, state: 'running', label: U['runType_' + type], moduleIds: ['ai-week', 'system'] };
  recordRun(lr);
  const intakeOk = !!(s0.intake && s0.intake.confirmedAt && s0.ledgerFrom);
  const mech = [];
  if (intakeOk) { mech.push(...checkTrials()); const iv = placeInterviewIfDue(); if (iv) mech.push(iv); if (s0.ledgerFrom && s0.depthPackFor !== s0.ledgerFrom) { const dp = placeDepthPack(null); if (dp) mech.push(dp); } }
  const h = { ...HEALTH0, ...(loadState().health || {}) };
  // 排程器「錯過即補跑」加正常時段，可能令同一日叫兩次：同一日已有排程工作做完，補跑嗰次照記錄但唔再開 AI
  const ranToday = RUN_TRIGGER === 'schedule' && (s0.runs || []).some(x => x.trigger === 'schedule' && x.slot === (RUN_SLOT || today) && x.state === 'ended');
  const skip = ranToday ? 'alreadyRan' : !intakeOk ? 'intakeNotComplete' : h.pausedByFounder ? 'pausedByFounder' : h.autoStopped ? 'autoStopped' : budgetLeft() <= 0 ? 'budgetExhausted' : !certified(ROOT, DIR.ledger).host ? 'adapterNotCertified' : '';
  if (skip) {
    recordRun({ ...lr, state: 'skipped', skipReason: skip, endedAt: localIso(), summary: U['skip_' + skip] + (mech.length ? '；已放上 ' + mech.length + ' 項待你處理' : ''), placed: mech.map(p => p.id) });
    log(`${lr.id} 排程 run 跳過：${skip}`);
    return;
  }
  // AI 日常工作：只喺沙盒做；收尾由外殼判定
  const run = { id: lr.id, kind: 'rhythm', ref: type, startedAt: lr.startedAt, state: 'running', replyFiles: [], steps: [], trigger: RUN_TRIGGER };
  step(run, 'received', U['runType_' + type], 'done', U['trig_' + RUN_TRIGGER]);
  // 已確認但未做過生意體檢（升級前已確認嘅公司）：日常工作先補做
  if (!fs.existsSync(brainFile(DIR, 'checkup')) && readJSON(CONFIRMED, null)) await brainStep(run, 'checkup');
  if (opportunitiesDue(s0, today)) await brainStep(run, 'opportunities', { timeoutMinutes: Math.max(3, Math.floor((r.runCapMinutes || 30) / 3)) });
  const sb = newSandbox(run);
  writeConfirmedPage(sb);
  writeJSON(path.join(sb, 'ledger.json'), rhythmLedger(type));
  fs.copyFileSync(path.join(ROOT, 'ai-rhythm.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'rhythm', runType: type });
  recordRun({ ...lr, aiStarted: true });
  await runAIStep(run, sb, U['runType_' + type], true);
  const placed = run.state === 'done' ? takeOpenSecond(sb, run) : null;
  if (run.state === 'done') takeProspects(sb, run);
  const rc = readJSON(path.join(DIR.work, run.id, 'receipt.json'), {}) || {};
  const arts = (run.result && run.result.artifacts) || [];
  const s = loadState(); s.artifactHashes = Array.isArray(s.artifactHashes) ? s.artifactHashes : [];
  const fresh = arts.filter(a => !s.artifactHashes.includes(fnv(a.text)));
  s.artifactHashes = s.artifactHashes.concat(fresh.map(a => fnv(a.text))).slice(-300);
  saveState(s);
  const ending = run.state !== 'done' ? 'blocked' : fresh.length ? 'artifact' : 'blocked';
  const blockedOn = ending === 'blocked' ? clip(String(rc.blockedOn || (run.state !== 'done' ? run.error || '' : '')), 80) : '';
  const prev = (loadState().runs || []).filter(x => x.state === 'ended' && x.id !== lr.id).pop();
  recordRun({ ...lr, aiStarted: true, state: 'ended', endedAt: localIso(), ending, ...(ending === 'blocked' ? { blockedOn, repeat: !!(prev && prev.ending === 'blocked' && prev.blockedOn === blockedOn) } : {}),
    ...(run.state !== 'done' ? { rejected: true, rejectReason: run.error || '' } : {}), summary: run.result ? run.result.summary : run.error || '', artifacts: fresh.length,
    placed: mech.map(p => p.id).concat(placed ? [placed.id] : [], (run.result && run.result.asks || []).map(a => a.id)), aiCost: run.aiCost || null,
    for: rc.for && typeof rc.for === 'object' ? { milestoneId: String(rc.for.milestoneId || ''), text: clip(String(rc.for.text || ''), 60) } : undefined });
  countStreak(false);
}
// 伺服器觸發嘅 run（你送出後）同排程時間見到未登記回覆嘅 run：一樣記入帳本 runs[]
function recordInboxRun(run, hadInput) {
  const ai = (run.steps || []).find(x => x.key === 'ai');
  const aiStarted = !!ai && ai.state !== 'waiting';
  const appliedOnly = run.state === 'done' && !aiStarted && !ADVANCED;
  recordRun({ id: run.id, type: 'inbox', trigger: RUN_TRIGGER, ...(RUN_TYPE ? { slot: RUN_SLOT || todayIso() } : {}), startedAt: run.startedAt, endedAt: run.endedAt || localIso(), capMinutes: rhythmOf(loadState()).runCapMinutes, aiStarted,
    state: run.state === 'waiting' || appliedOnly ? 'skipped' : 'ended', ...(run.state === 'waiting' ? { skipReason: run.waitingFor === 'paused' ? 'pausedByFounder' : 'adapterNotCertified' } : appliedOnly ? { skipReason: 'appliedOnly' } : { ending: ADVANCED ? 'advanced' : (run.kind === 'intake' && run.state === 'done') || (run.result && (run.result.artifacts || []).length) ? 'artifact' : 'blocked' }),
    ...(run.state === 'failed' ? { rejected: true, rejectReason: run.error || '' } : {}), label: (ai && ai.label) || ((run.steps || [])[0] || {}).label || U.runType_inbox, summary: (run.result && run.result.summary) || run.error || '', artifacts: (run.result && (run.result.artifacts || []).length) || 0, moduleIds: ['inputs', 'ai-week'] });
  if (hadInput && run.state !== 'waiting' && !appliedOnly) countStreak(true);
}

async function main() {
  if (!takeLock()) { log('另一個 run 做緊，今次唔做'); return; }
  let run = null, hadInput = false;
  try {
    applyObserve();
    if (process.argv.includes('--plain')) { await plainAll(); return; }
    const replies = fs.readdirSync(DIR.replies).filter(f => f.endsWith('.md')).sort();
    const intakes = fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-intake.md')).sort();
    const prefills = fs.readdirSync(DIR.inbox).filter(f => f.endsWith('-prefill.md')).sort();
    const notes = fs.readdirSync(DIR.inbox).filter(f => /-note-(?:order|adhoc|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc)\.md$/.test(f) || /-feedback-[a-z]+\.md$/.test(f)).sort();
    const retry = readJSON(RETRY, null);
    // 辯論回合排最後：創辦人嘅回覆同要求先處理
    const debates = pendingMatches(DIR);
    const founderFiles = replies.length + intakes.length + notes.length + prefills.length;
    // 排程 run：冇你嘅新回覆就做日常工作；有就先處理回覆（記成處理收件，3.6）
    if (RUN_TYPE && !founderFiles) { await rhythmRun(); return; }
    if (!founderFiles && !retry && !debates.length) return;
    // 由文件預填：只讀文件交返預填，唔遷移、唔同步公司紀錄、唔出任何題（規劃書 3.1）
    if (prefills.length) { run = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), startedAt: localIso(), state: 'running', replyFiles: [], steps: [] }; hadInput = true; noteFounderInput(); await handlePrefill(run, prefills[0]); return; }
    // 舊安裝：公司概覽先遷移到新格式；已確認公司概覽但帳本未有里程碑同假設清單，喺有工作時先補種子（冇改動就唔寫）
    if (!replies.some(f => parseReply(fs.readFileSync(path.join(DIR.replies, f), 'utf8')).head.kind === 'proofread')) migrateOverview();
    syncLedger();
    { const sl = readJSON(STATE, null); if (sl && sl.ledgerFrom && sl.depthPackFor !== sl.ledgerFrom && !sl.demo) placeDepthPack(null); }
    placeInterviewIfDue();
    run = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), startedAt: localIso(), state: 'running', replyFiles: [], steps: [] };
    if (founderFiles) { hadInput = true; noteFounderInput(); }
    if (intakes.length) {
      // 公司概覽要先有，所以交資料排先
      await handleIntake(run, intakes[0]);
    } else if (notes.length && !replies.length) {
      await handleNote(run, notes[0]);
    } else if (replies.length) {
      // 按時間先後：最早嗰份屬公司概覽就一次過處理晒公司概覽嘅回覆（以最新為準）；屬問題包就淨處理嗰份
      const kindOf = f => parseReply(fs.readFileSync(path.join(DIR.replies, f), 'utf8')).head.kind;
      const first = replies[0];
      if (kindOf(first) === 'ask-answer') { run.replyFiles = [first]; await handleAsk(run, first); }
      else { const group = replies.filter(f => kindOf(f) !== 'ask-answer'); run.replyFiles = group; await handleProofread(run, group); }
    } else if (retry) {
      const ids = Array.isArray(retry.runIds) ? retry.runIds.slice() : [];
      const requested = ids.shift() || retry.runId;
      if (ids.length) writeJSON(RETRY, { ...retry, runIds: ids }); else fs.rmSync(RETRY, { force: true });
      const prev = readJSON(STATUS, { runs: [] }).runs.find(r => r.id === requested) || (!requested && readJSON(STATUS, { runs: [] }).runs.find(r => r.state === 'failed' || r.state === 'waiting'));
      if (prev && prev.state === 'waiting') { prev.state = 'resumed'; delete prev.waitingFor; saveRun(prev); }
      if (!prev) return;
      run.retryOf = prev.id;
      run.replyFiles = prev.replyFiles || [];
      if (prev.kind === 'intake') {
        // 交資料重做：用返上次登記好嘅資料（喺上次嘅工作資料夾），唔再登記
        run.kind = 'intake'; run.ref = prev.ref;
        step(run, 'received', U.stepIntakeReceived, 'done', '重試上一次');
        step(run, 'applied', U.stepIntakeRegistered, 'done', '沿用上一次');
        const old = path.join(DIR.sandbox, prev.id), sb = newSandbox(run);
        if (!fs.existsSync(path.join(old, 'intake.md'))) { finish(run, 'failed', '找不到上次提交的資料，請重新提交資料'); return; }
        fs.copyFileSync(path.join(old, 'intake.md'), path.join(sb, 'intake.md'));
        if (fs.existsSync(path.join(old, 'files'))) fs.cpSync(path.join(old, 'files'), path.join(sb, 'files'), { recursive: true });
        intakeTask(sb);
        await runAIStep(run, sb, U.stepIntakeAI, true);
        return;
      }
      if (prev.kind === 'debate') {
        // 辯論回合重跑：AI 設定好之後續做唔計次數；真係失敗嘅每場只可以重跑一次
        const m = readMatch(prev.ref);
        if (!m || !m.failed) { finish(run, 'failed', '此場辯論沒有未完成的回合'); return; }
        if (!m.failed.waitingAI) { if ((m.budget.reruns || 0) >= 1) { finish(run, 'failed', '每場只可以重跑一次；想再試請再打一場'); return; } m.budget.reruns = (m.budget.reruns || 0) + 1; }
        m.next = m.failed.pass; m.failed = null; saveMatch(m);
        await runDebatePass(run, m);
        return;
      }
      if (prev.kind === 'note' && prev.noteType === 'feedback') {
        run.kind = 'note'; run.ref = prev.ref; run.noteType = 'feedback';
        step(run, 'received', U.stepReqReceived, 'done', '重試上一次');
        const old = path.join(DIR.sandbox, prev.id);
        if (!fs.existsSync(path.join(old, 'card.md'))) { finish(run, 'failed', '找不到上次的卡，請在監察台再按一次「要修改」'); return; }
        const sb = newSandbox(run);
        reviseTask(sb, fs.readFileSync(path.join(old, 'card.md'), 'utf8'), fs.readFileSync(path.join(old, 'note.md'), 'utf8').split(/\r?\n\r?\n/).slice(1).join('\n\n').trim());
        await runAIStep(run, sb, U.brainRevise, false);
        return;
      }
      if (prev.kind === 'note') {
        // 要求重做：用返上次登記好嘅要求（喺上次嘅工作資料夾）
        if (prev.noteType === 'practice-prep' || prev.noteType === 'debrief') {
          // 準備場景／會後紀錄重做：用返上次工作資料夾嘅資料
          run.kind = 'note'; run.ref = prev.ref; run.noteType = prev.noteType; run.practiceTaskId = prev.practiceTaskId || '';
          const old = path.join(DIR.sandbox, prev.id), sb = newSandbox(run);
          for (const f of fs.readdirSync(old).filter(f => f !== 'out' && !f.endsWith('.txt'))) fs.cpSync(path.join(old, f), path.join(sb, f), { recursive: true });
          step(run, 'received', U.stepReqReceived, 'done', '重試上一次');
          await runAIStep(run, sb, prev.noteType === 'debrief' ? U.practiceDebriefAI : U.practicePrepAI, true);
          return;
        }
        if (prev.noteType === 'event' || prev.noteType === 'doc') {
          // 真實事件（同放入文件）重做：用返上次登記好嘅事件同證明文件，帳本假設同站用而家嘅
          run.kind = 'note'; run.ref = prev.ref; run.noteType = prev.noteType;
          step(run, 'received', U.stepReqReceived, 'done', '重試上一次');
          step(run, 'applied', U.stepReqRegistered, 'done', '沿用上一次');
          const old = path.join(DIR.sandbox, prev.id, 'event.md'), s = loadState(), input = (s.inputs || []).find(i => i.id === 'in-' + prev.ref);
          if (!input || !fs.existsSync(old)) { finish(run, 'failed', '找不到上次記錄的事件，請重新記錄'); return; }
          const sb = newSandbox(run);
          eventTask(sb, s, { text: fs.readFileSync(old, 'utf8').split('## 創辦人原話').pop().trim(), date: input.eventDate, files: (input.files || []).map(f => path.join(DIR.data, f)), ref: prev.ref, pre: prev.ref + '-note-' + prev.noteType + '-file-', ...(prev.noteType === 'doc' ? { heading: fs.readFileSync(old, 'utf8').split(/\r?\n/)[0] } : {}) });
          await runAIStep(run, sb, U.stepEventAI, true);
          return;
        }
        if (!['order', 'adhoc'].includes(prev.noteType)) { finish(run, 'failed', '請在營運監察台再按一次'); return; }
        run.kind = 'note'; run.ref = prev.ref; run.noteType = prev.noteType;
        step(run, 'received', U.stepReqReceived, 'done', '重試上一次');
        step(run, 'applied', U.stepReqRegistered, 'done', '沿用上一次');
        const old = path.join(DIR.sandbox, prev.id, 'note.md');
        if (!fs.existsSync(old)) { finish(run, 'failed', '找不到上次提交的要求，請重新提交'); return; }
        const sb = newSandbox(run);
        noteTask(sb, run.noteType, fs.readFileSync(old, 'utf8').split(/\r?\n\r?\n/).slice(1).join('\n\n').trim());
        await runAIStep(run, sb, U.stepReqAI, true);
        return;
      }
      step(run, 'received', U.stepReceivedConfirm, 'done', '重試上一次');
      step(run, 'applied', U.stepAppliedAns, 'done', '沿用上一次');
      if (prev.kind === 'ask') { const pack = loadPack(DIR, prev.ref); run.kind = 'ask'; run.ref = prev.ref; if (prev.taskId) run.taskId = prev.taskId; if (pack && pack.next) await aiAfterAsk(run, pack); else finish(run, 'done'); }
      else { run.kind = 'proofread'; run.ref = prev.ref; if (readJSON(CONFIRMED, null)) await aiAfterProofread(run); else finish(run, 'failed', '找不到先前確認的內容，請重新確認'); }
    } else await runDebatePass(run, debates[0]);
  } catch (e) {
    log('外殼出錯：' + (e && e.stack || e));
    // 辯論回合出錯：標未完成，免得伺服器不停再叫
    if (run && run.kind === 'debate' && run.ref) { const m = readMatch(run.ref); if (m && m.next && !m.failed) { m.failed = { pass: m.next, reason: '系統出錯', at: localIso() }; m.next = ''; saveMatch(m); } }
    if (run && run.state === 'running') finish(run, 'failed', '系統出錯，工作未完成；請按「重試」再做一次');
  } finally {
    if (run && run.state !== 'running') try { recordInboxRun(run, hadInput); } catch (e) { log('記錄 run 出錯：' + (e && e.message || e)); }
    dropLock();
  }
}
main();
