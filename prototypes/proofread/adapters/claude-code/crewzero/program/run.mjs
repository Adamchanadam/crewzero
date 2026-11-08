// CrewZero 校對原型：外殼。每次由本機伺服器叫起，創辦人唔使理。
// 次序：登記新回覆 → 機械套用（唔使 AI）→ 寫紀錄 → 有 AI 工作先開 AI → 核對收據 → AI 出嘅新問題包核對後放上待決事項 → 寫狀態。
// 一次處理一組回覆（公司概覽嘅全部回覆，或者一份問題包回覆）；做完伺服器見仲有就再叫。
// AI 只喺 data/sandbox/<run> 入面工作；套用、核對、搬檔、紀錄全部由呢個程式做。
// 開 AI 之前一定核對 AI 工具認證（host-lib.mjs）；未認證就只做機械套用，run 等緊 AI 設定，設定好之後自動續做。
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { certified, execute, modelCandidates, webAccess } from './host-lib.mjs';
import { checkCompanyPage, normalizePage, validDay, openingFields, ROW_PLANS, RULE_PLANS, CELLS } from './company-page-check.mjs';
import { scanOutput, fixOutput } from './style-check.mjs';
import { loadBrain, cardText, brainSource, brainFile, pipelineOf, ledgerAssumptions, deriveActors, counterpartsOf, contactDueOf } from './brain-lib.mjs';
import { folderHash } from './folder-hash.mjs';
import { MACHINE, ORIGINAL, sha, scanJSON, scanText, sameShape, headings, mergeRewriteJSON, mergeRewriteMd, deCodeInfo, deCodeJSONInfo, folderAssumptions, displayDir, displayPath, displayIndex } from './plain-lib.mjs';
import { formatFor, passesFor, LEVELS, HARD_CAP, ADOPT_OPTS, SEATS, listMatches, readMatchFile, matchDir, isLegacy, pendingMatches, checkBlue, checkRed, checkRebuttal, checkJudge, checkRejudge, checkStrengthen, checkReattackRed, checkReattackJudge, responsePack, adoptionPacks, evidencePack } from './debate-lib.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkLinks } from './link-check.mjs';
import { ownerKind, checkNewActorItem, applyNewActor, orderEventItems, ownershipOf, applyActorOp, nameKeys, norm as pnorm, resolveActorId, kindOf, founderNamesIn, checkPeopleSync, applyKindFix, peopleSyncDue, nextActorId, duplicateActor, mixSpace } from './people-ops.mjs';
import { pad, localIso, stamp, readJSON, writeJSON, fnv, proofreadHash, proofreadHashMatches, isInboxNote, isInboxIntake, isInboxPrefill, dataDirs, appendLog, preparePacks, placePacks, loadPack, loadAnswers, listPacks, readLog, openUnknowns, sameThing, UNKNOWN_DAYS, MAX_PER_PACK, clockNow, isSim, INTAKE_QUESTIONS, BIZ_TYPES, intakeQuestions, NAMES, parseFounderReply, validateAskReply } from './ask-lib.mjs';
import { rhythmOf, rhythmFromText, addDays, nextWeekday, isWeekday } from './rhythm-lib.mjs';
import { listScenarios } from './practice-lib.mjs';
import { PREFILL_Q, docTexts, checkPrefill, matchDelivered } from './prefill-lib.mjs';
import { milestonesFromPage, assumptionsFromPage, depthOf, dashboardState, guideCard, applyFounderOps, overviewIsCurrent } from './dash-lib.mjs';
import { registerInput, recordReading, addEffect, applyFollowUp, refreshSnapshot, mergeInPlace, followUpTaskId, checkRead, checkReason, checkFollowUpItem, cleanMeta, checkSourceUrls, blankBadSourceUrls, fullTextSuffix, annotateBrokenLinks, dayText as opsDayText } from './ledger-ops.mjs';
import * as PACE from './pace-lib.mjs';
import * as ROLES from './roles-ops.mjs';
import { buildBrief, buildProofreadBrief, checkBrief, briefFailStreak } from './brief-lib.mjs';
const U = NAMES.ui;
const parseReply = parseFounderReply;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = dataDirs(ROOT);
const STATUS = path.join(DIR.ledger, 'status.json');
const CONFIRMED = path.join(DIR.ledger, 'confirmed.json');
const IDEATE = path.join(DIR.ledger, 'ideate.json');
const LOCK = path.join(DIR.ledger, '.lock');
const RETRY = path.join(DIR.ledger, 'retry-requested');
const LOG = path.join(DIR.ledger, 'runs.log');
// 帳本（原型）：監察台讀嘅工作同事件；冇就新建（只記工作同事件，其餘欄位唔理）
const STATE = path.join(DIR.ledger, 'state.json');
const FOUNDER_OPS = path.join(DIR.ledger, 'founder-ops.json');
const FOUNDER_OPS_LOCK = path.join(DIR.ledger, '.founder-ops.lock');

const log = msg => fs.appendFileSync(LOG, `[${localIso()}] ${msg}\n`);
// 公司概覽清單區段：舊資料寫成 { title, items } 都照讀（新資料由 company-page-check 規整）
const listOf = x => Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : x && typeof x === 'object' && (x.title || x.label || x.id) ? [x] : [];
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// 外部連結試開（link-check.mjs）：Zero 寫進產出的外部網址，寫入前試開一次；明確打不開的在出處加註「連結未能開啟」，不刪網址。
// 測試實例（有 SOS_DATA）預設不連外網；要測試時用 SOS_LINKCHECK_MODULE 換成假的 fetch／lookup。
let LINK_OPTS = null;
async function linkOpts() {
  if (LINK_OPTS) return LINK_OPTS;
  LINK_OPTS = {};
  if (process.env.SOS_LINKCHECK_MODULE) { try { const m = await import(pathToFileURL(path.resolve(process.env.SOS_LINKCHECK_MODULE)).href); LINK_OPTS = { fetchImpl: m.fetchImpl, lookup: m.lookup }; } catch { } }
  return LINK_OPTS;
}
async function markBrokenLinks(entries, field) {
  const list = Array.isArray(entries) ? entries : [];
  const urls = list.map(e => e && e.url).filter(u => typeof u === 'string' && /^https:\/\//.test(u));
  if (!urls.length || (process.env.SOS_DATA && !process.env.SOS_LINKCHECK_MODULE)) return list;
  try { return annotateBrokenLinks(list, await checkLinks(urls, await linkOpts()), field, NAMES.ui.linkBroken); } catch { return list; }
}
// 只有外部已實際行動或已付出代價，才可由證據級推導為站點完成；口頭表示仍是進展，不是完成。
const gradeCompletes = grade => grade === 'did' || grade === 'paid';

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
  if (run.ideateId && (state === 'failed' || state === 'waiting')) {
    const s = readJSON(IDEATE, null);
    if (s && s.id === run.ideateId) updateIdeate(s, { state: 'failed', reason: error || (run.steps.find(x => x.key === 'ai') || {}).detail || U.ideateFailed });
  }
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
function addEvent(e, state = null) { const s = state || loadState(); s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), relatedIds: [], ...e }); if (!state) saveState(s); }

// CrewZero 只會追加操作；run 以 rename 取走整批，先讀回成功寫入 state 才清理。
// 短鎖只保護「追加」同「取批」兩個檔案動作，唔會同 AI 工作互相等待。
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
function founderEventTitle(op, st = null) {
  const v = op && op.value || {};
  // 名單改正的標題要帶名稱：從套用前的帳本查（查不到就用較短的句）
  const actors = ((st && st.company) || {}).actors || [], who = id => (actors.find(a => a && a.id === id) || {}).name || '', taskTitle = id => ((st && st.tasks) || []).find(t => t && t.id === id)?.title || '';
  if (op.op === 'reschedule') return NAMES.t('founderRescheduled', { d: v.date || '' });
  if (op.op === 'cancelNext') return U.founderCancelled;
  if (op.op === 'setNext') return NAMES.t('founderSetNext', { t: clip(v.text, 60) });
  if (op.op === 'setTarget') return NAMES.t('founderTargetChanged', { d: v.date || '' });
  if (op.op === 'setTaskDue') return NAMES.t('founderTaskDueChanged', { d: v.date || '' });
  if (op.op === 'snooze') return U.founderSnoozed;
  if (op.op === 'setRhythm') return U.rhythmSaved;
  if (op.op === 'setSourceUrl') return NAMES.t('sourceUrlFixed', { t: clip(v.title, 40) });
  if (op.op === 'actorRename') return NAMES.t('actorRenamed', { a: clip(who(op.target), 20), b: clip(v.name, 20) });
  if (op.op === 'actorKind') return mixSpace(NAMES.t('actorKinded', { n: clip(who(op.target), 20), k: NAMES.dash['ppl_kind_' + v.kind] || '' }));
  if (op.op === 'actorMerge') return NAMES.t('actorMerged', { a: clip(who(op.target), 20), b: clip(who(v.into), 20) });
  if (op.op === 'actorStatus') return NAMES.t(v.status === 'active' ? 'actorReopened' : 'actorClosed', { n: clip(who(op.target), 20) });
  if (op.op === 'actorTeam') return NAMES.t('actorTeamed', { n: clip(who(op.target), 20) });
  if (op.op === 'taskOwner') return NAMES.t('taskOwnerChanged', { t: clip(taskTitle(op.target), 20), n: v.owner === 'founder' ? NAMES.ui.chgOwnerMe : who(v.owner) });
  if (op.op === 'peopleSync') return U.peopleSyncRequested;
  // 0.41.0 新 op：節奏、暫停、崗位（字句鍵見進度檔「要加的鍵」；其中 pace_*、skip_pausedByFounder 為現有或資料約定第 11 節的鍵）
  if (op.op === 'setPace') return NAMES.t('founderPaceChanged', { p: NAMES.t('pace_' + (PACE.PACE_KEYS.includes(v.pace) ? v.pace : 'standard')) });
  if (op.op === 'pauseZero') return U.skip_pausedByFounder;
  if (op.op === 'resumeZero') return NAMES.t('founderZeroResumed');
  if (op.op === 'rolePause') return NAMES.t('founderRolePaused', { t: clip(ROLES.titleOf(ROLES.cardById(st || {}, op.target)), 20) });
  if (op.op === 'roleResume') return NAMES.t('founderRoleResumed', { t: clip(ROLES.titleOf(ROLES.cardById(st || {}, op.target)), 20) });
  if (op.op === 'rolesSync') return NAMES.t('founderRolesRequested');
  return U.founderUnsnoozed;
}
const founderOpsBatchTime = file => Number((/\.founder-ops-\d+-(\d+)\.json$/.exec(file) || [])[1]) || 0;
function founderOpsBatches() {
  try {
    return fs.readdirSync(DIR.ledger).filter(file => /^\.founder-ops-\d+-\d+\.json$/.test(file))
      .sort((a, b) => founderOpsBatchTime(a) - founderOpsBatchTime(b) || a.localeCompare(b)).map(file => path.join(DIR.ledger, file));
  } catch { return []; }
}
// 0.41.0 創辦人操作的外殼套用（節奏、暫停 Zero、崗位暫停／恢復、重新擬崗位）；純函數在 pace-lib／roles-ops。dash-lib 的 applyFounderOps 不認識這些 op（原樣略過），所以在其後套用。同一操作做兩次結果相同。
function applyShellOps(state, ops, original = state) {
  let s = PACE.applyPaceOps(state, ops, { today: todayIso() });
  if (!((s.health || {}).pausedByFounder) && ((original || {}).health || {}).pausedByFounder) resumePaused();
  for (const op of ops || []) {
    if (!op || typeof op !== 'object') continue;
    const at = op.at || localIso();
    if (op.op === 'rolePause') s = ROLES.pauseCard(s, { teammateId: op.target, reason: (op.value || {}).reason || '', now: at });
    else if (op.op === 'roleResume') s = ROLES.resumeCard(s, { teammateId: op.target, now: at });
    else if (op.op === 'rolesSync' && s.demo !== true) s = { ...s, rolesSync: { ...(s.rolesSync || {}), requested: true, requestedAt: at } };
  }
  return s;
}
function mergeFounderOpsBatch(batch) {
  const ops = readJSON(batch, []), before = loadState();
  if (before.demo === true || !Array.isArray(ops)) return false;
  const done = Array.isArray(before.founderOpsDone) ? before.founderOpsDone.filter(id => typeof id === 'string') : [];
  const doneSet = new Set(done), pending = ops.filter(op => op && typeof op === 'object' && (!op.id || !doneSet.has(op.id)));
  const next = applyShellOps(applyFounderOps(before, pending), pending, before);
  next.events = Array.isArray(next.events) ? next.events : [];
  for (const op of pending) {
    if (!op.op) continue;
    next.events.push({ id: 'e' + stamp() + '-' + next.events.length, at: op.at || localIso(), actor: 'founder', type: 'founder-op', title: founderEventTitle(op, before), relatedIds: [], moduleIds: ['now', 'inputs'] });
  }
  next.founderOpsDone = [...new Set(done.concat(pending.map(op => typeof op.id === 'string' ? op.id : '').filter(Boolean)))].slice(-Math.max(200, ops.length));
  saveState(next);
  fs.rmSync(batch, { force: true });
  if (pending.length) log(`已合併 ${pending.length} 個創辦人操作`);
  return true;
}
function mergeFounderOps() {
  let merged = false;
  for (const batch of founderOpsBatches()) { mergeFounderOpsBatch(batch); merged = true; }
  let staged = '';
  const moved = withFounderOpsLock(() => {
    if (!fs.existsSync(FOUNDER_OPS)) return false;
    staged = path.join(DIR.ledger, `.founder-ops-${process.pid}-${Date.now()}.json`);
    fs.renameSync(FOUNDER_OPS, staged);
    return true;
  });
  if (!moved || !staged) return merged;
  mergeFounderOpsBatch(staged);
  return true;
}

// 重新讀取的新快照：伺服器已把檔案存好並在 ledger/rereads/ 留一張單，外殼在這裏換進帳本（舊快照保留在 previous）。
// 單據處理後才刪；同一張單做兩次結果相同（refreshSnapshot 冪等）。
function mergeRereads() {
  const dir = path.join(DIR.ledger, 'rereads');
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => /^[\w-]+\.json$/.test(f)).sort(); } catch { return false; }
  for (const f of names) {
    const rec = readJSON(path.join(dir, f), null);
    if (rec && typeof rec.inputId === 'string' && Number.isInteger(rec.n) && rec.fresh && typeof rec.fresh.file === 'string') {
      const s = loadState();
      if (s.demo !== true) {
        const next = refreshSnapshot(s, { inputId: rec.inputId, n: rec.n, fresh: rec.fresh });
        if (JSON.stringify(next) !== JSON.stringify(s)) { saveState(next); log(`已換用新快照：${rec.inputId}`); }
      }
    }
    fs.rmSync(path.join(dir, f), { force: true });
  }
  return names.length > 0;
}

function bizInfo(biz) { return biz && BIZ_TYPES[biz.type] ? { type: biz.type, other: typeof biz.other === 'string' ? biz.other : '', label: BIZ_TYPES[biz.type].label } : null; }
function businessType() { return bizInfo(readJSON(path.join(DIR.company, 'biz.json'), null)); }
function bizWords(biz) {
  const rows = {
    service: [['服務', '服務'], ['客戶', '服務對象'], ['收入', '收費或收到的款項']],
    goods: [['產品', '貨品'], ['客戶', '購買者'], ['銷量', '賣出件數']],
    online: [['產品', '產品或網上服務'], ['客戶', '使用者或客戶'], ['收入', '訂閱、單次收費或其他收入']],
    platform: [['產品', '平台或配對服務'], ['客戶', '買方及賣方'], ['收入', '佣金或收費']],
    nonprofit: [['產品', '計劃'], ['客戶', '服務對象'], ['收入', '資金來源'], ['收入金額', '資助或捐款']],
    other: [['客戶', '對方'], ['產品', '你的工作'], ['收入', '款項或資金來源']]
  };
  return (rows[biz.type] || rows.other).map(x => `| ${x[0]} | ${x[1]} |`).join('\n');
}
function writeBizContext(sb, selected = null) {
  const biz = selected || businessType();
  if (!biz) return;
  const other = biz.type === 'other' && biz.other ? `\n- 補充：${biz.other}` : '';
  fs.writeFileSync(path.join(sb, 'biz.md'), `# 生意類別\n\n- 類別：${biz.label}${other}\n\n## 用字對照\n\n| 如要表達 | 請寫 |\n| --- | --- |\n${bizWords(biz)}\n\n按以上用字寫作；不要把未有的貨品、客戶、收入或季度安排當作事實。\n`);
}
/* ---------- 帳本種子（規劃書 3.1 成頁確認、附錄 A）：里程碑同假設清單由已確認公司概覽寫入帳本，之後每次確認只更新文字同次序 ----------
   進度（state、doneAt、doneEvidence）同假設級別（grade、status、sourceId）只由你確認真實事件時寫入，同步永遠唔覆寫。
   舊安裝（已確認公司概覽但帳本未有里程碑）喺下一次工作開始時自動補種子。換咗新公司概覽：同名嘅站同假設先保留進度。 */
const MS_KEEP = ['state', 'doneAt', 'doneEvidence', 'doneInputId', 'doneCounterpartIds', 'watchItems', 'trial', 'retiredReason', 'retiredDecisionId', 'supersededBy', 'parallelConfirmedAt'];
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
  const before = JSON.stringify([s.milestones || [], (s.company || {}).assumptions || [], (s.company || {}).actors || [], s.intake || {}, s.tasks || [], (s.company || {}).nextExternalAction || null, s.targetOverride || {}, s.targetOverrideBase || {}, s.targetOverrideAt || {}]);
  const ms = milestonesFromPage(page, c, { founder }).map(m => { const o = keepOf(m), kind = kinds[m.id] || m.kind || 'real'; return o ? { ...m, kind, ...pick(o, MS_KEEP) } : { ...m, kind }; });
  // 經試行採用、唔喺公司概覽嘅站（3.12）：同步時照留
  for (const o of s.milestones || []) if (o.trial && !ms.some(m => m.id === o.id)) ms.push(o);
  // 你喺訪問確認撤回嘅站、改咗嘅目標日：同步時照留；但公司概覽其後真的改過同一日子，就以公司概覽為準。
  s.targetOverride = { ...(s.targetOverride || {}) }; s.targetOverrideBase = { ...(s.targetOverrideBase || {}) }; s.targetOverrideAt = { ...(s.targetOverrideAt || {}) };
  for (const m of ms) {
    const o = keepOf(m); if (o && o.pathStatus === 'retired' && o.retiredDecisionId) m.pathStatus = 'retired';
    if (!Object.prototype.hasOwnProperty.call(s.targetOverride, m.id)) continue;
    if (!Object.prototype.hasOwnProperty.call(s.targetOverrideBase, m.id)) { s.targetOverrideBase[m.id] = m.targetDate || ''; m.targetDate = s.targetOverride[m.id]; continue; }
    if ((m.targetDate || '') !== s.targetOverrideBase[m.id]) {
      const overrideAt = s.targetOverrideAt[m.id], confirmedAt = Date.parse(String(c.confirmedAt || '')),
        overrideTime = Date.parse(String(overrideAt || ''));
      // 舊資料冇記覆蓋時間，沿用原有行為；只有確認真係較新先蓋回公司概覽日期。
      if (!overrideAt || (Number.isFinite(confirmedAt) && Number.isFinite(overrideTime) && confirmedAt > overrideTime)) {
        delete s.targetOverride[m.id]; delete s.targetOverrideBase[m.id]; delete s.targetOverrideAt[m.id]; continue;
      }
    }
    m.targetDate = s.targetOverride[m.id];
  }
  const oldAs = (s.company && s.company.assumptions) || [];
  // 生意體檢寫嘅最便宜測試：公司概覽冇寫測試就照留（公司概覽有就以公司概覽為準）
  const as = assumptionsFromPage(page).map(a => { const o = oldAs.find(x => same ? x.pageRef === a.pageRef : x.text === a.text); return !o ? a : { ...a, ...pick(o, AS_KEEP), ...(o.cheapestTestBy === 'checkup' && !String(a.cheapestTest || '').trim() ? pick(o, ['cheapestTest', 'cheapestTestBy', 'cheapestTestAt', 'cheapestTestPartial']) : {}) }; });
  const reg = registry(page), vals = c.values || {}, edited = new Set((c.edits || []).map(e => e.id));
  const v = f => String(vals[f.id] ?? f.value ?? '');
  // 暫定值的覆核日不遲於目前目標期限（創辦人改過的值或 Zero 原值，即 G1 列的 due）；只在確認公司概覽時收窄
  const g1Row = listOf(page.glance && page.glance.rows).find(r => r && r.plan === 'G1'), g1Due = g1Row && g1Row.due ? v(g1Row.due) : '';
  const capUntil = t => validDay(g1Due) && t && validDay(t.until) && g1Due < String(t.until) ? { ...t, until: g1Due } : t;
  // 「目前去到哪裏」（G4）推導站點起始狀態：某項連住一站、已實際發生，而且有文件出處或者由你改過 → 嗰站完成（證明＝交資料嘅封存文件）
  s.events = s.events || [];
  const status = listOf(page.glance && page.glance.status && page.glance.status.items);
  for (const it of status) {
    const m = it.milestone && ms.find(x => x.id === it.milestone), g = v(it);
    if (!m || m.state === 'done' || !gradeCompletes(g) || !(it.origin === 'doc' || edited.has(it.id))) continue;
    const ev = intakeArchive(page.page.id);
    Object.assign(m, { state: 'done', doneAt: String(c.confirmedAt || localIso()).slice(0, 10), doneEvidence: ev ? [ev] : [], doneInputId: 'overview:' + (c.replyFile || '') });
    s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'milestone', title: '站點已完成（目前進展）：' + m.short, relatedIds: [m.id], moduleIds: ['now', 'paths'] });
  }
  // 開局答案（3.1、附錄 A intake.answers）：每欄嘅值、來源同暫定標記；未答齊嘅欄列入 missing
  const answers = {}, fieldsByPlan = {};
  // 每個計劃只取一個開局答案欄（概覽內的欄優先，各站的同計劃欄位不是開局答案；與校對頁 isRecheck() 同一規則）
  for (const [plan, f] of Object.entries(openingFields(page))) { fieldsByPlan[plan] = f; answers[plan] = { value: v(f), origin: edited.has(f.id) ? 'founder' : f.origin, ...(f.tentative && !edited.has(f.id) ? { tentative: capUntil(f.tentative) } : {}) }; }
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
  const oldActors = (s.company || {}).actors || [];
  s.company = { ...(s.company || {}), assumptions: as, actors: deriveActors(page, ms, oldActors, { today: todayIso() }) };
  for (const m of ms) if (m.state === 'done' && oldMs[m.id]?.state !== 'done') m.doneCounterpartIds = s.company.actors.filter(a => (a.fromMilestoneIds || []).includes(m.id)).map(a => a.id);
  const founderNext = (s.company || {}).nextExternalAction;
  if (g5 && !founderNext?.founderUpdatedAt && JSON.stringify(g5) !== JSON.stringify(s.ledgerG5 || null)) { s.company.nextExternalAction = g5; s.ledgerG5 = g5; }
  // 經營節奏（附錄 A rhythm）：開局確認時按「經營節奏」答案寫入一次，之後只經系統頁改；第一次訪問日＝之後第一個訪問星期
  let seeded = false;
  if (!s.company.rhythm) { s.company.rhythm = { ...rhythmFromText((answers.G8 || {}).value), from: 'G8' }; seeded = true; }
  if (!s.interviews || !s.interviews.nextOn) { s.interviews = { ...(s.interviews || {}), nextOn: nextWeekday(todayIso(), s.company.rhythm.interviewWeekday) }; seeded = true; }
  ensureActive(ms);
  s.milestones = ms;
  s.intake = { ...(s.intake || {}), state: missing.length ? 'incomplete' : 'complete', confirmedAt: c.confirmedAt, answers, missing };
  s.ledgerFrom = page.page.id;
  if (before === JSON.stringify([ms, as, s.company.actors, s.intake, tasks, s.company.nextExternalAction || null, s.targetOverride || {}, s.targetOverrideBase || {}, s.targetOverrideAt || {}]) && same && !seeded) return false;
  saveState(s);
  log(`帳本已按公司概覽同步：${ms.length} 個站、${as.length} 條假設、未答齊 ${missing.length} 欄`);
  return true;
}
// 交資料嘅封存資料夾（站點由「目前進展」推導完成時作證明）
// 公司概覽 sources[].file：Zero 寫的是附件檔名，頁面要用封存後相對 data/ 的路徑才打得開；對不上就留空（不留一個打不開的連結）
function keepArchived(file) {
  try {
    const r = path.resolve(DIR.data, String(file).replace(/\\/g, '/')), root = fs.realpathSync(DIR.archive), lst = fs.lstatSync(r);
    if (lst.isSymbolicLink() || !lst.isFile() || !fs.realpathSync(r).startsWith(root + path.sep) || !r.startsWith(path.resolve(DIR.archive) + path.sep)) return '';
    return path.relative(DIR.data, r).replace(/\\/g, '/');
  } catch { return ''; }
}
function fixSourceFiles(page, runRef) {
  if (!page || !Array.isArray(page.sources)) return;
  const dirRel = intakeArchive('intake-' + runRef);
  let names = []; try { if (dirRel) names = fs.readdirSync(path.join(DIR.data, dirRel)).filter(f => /-intake-\d+-/.test(f)); } catch { }
  const bare = f => f.replace(/^.*?-intake-\d+-/, '');
  for (const x of page.sources) {
    if (!x || typeof x !== 'object' || x.file == null || x.file === '') continue;
    const want = String(x.file).replace(/\\/g, '/').replace(/^files\//i, '').toLowerCase();
    // 已是封存路徑：解析後的真實路徑必須在封存資料夾內，是普通檔、不是連結（Zero 寫 archive/../ledger/… 這類出界路徑一律不保留）
    const kept = keepArchived(x.file);
    if (kept) { x.file = kept; continue; }
    const hit = names.find(f => bare(f).toLowerCase() === want);
    if (hit) x.file = dirRel + '/' + hit; else delete x.file;
  }
}
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

// 由伺服器填入；舊終端回覆沒有此欄仍按終端處理，避免把任意文字寫入決定紀錄。
const replyVia = v => /^browser:[a-f0-9]{6}$/i.test(String(v || '')) || /^device:[a-f0-9]{8}$/i.test(String(v || '')) ? String(v) : 'terminal';

/* ---------- 俾 AI 睇嘅確認版公司概覽（通用，唔分邊間公司） ---------- */
// G6「已有人負責的事」：名單內有在職團隊成員時，給 Zero 的背景改由名單生成（公司概覽原文不改寫）
function ownershipText() {
  const own = ownershipOf(loadState());
  if (!own) return '';
  const parts = own.lines.map(l => NAMES.t('pbOwnLine', { n: l.name, r: l.role || NAMES.dash.ppl_kind_team, w: [...l.stations, ...l.tasks, ...(l.moreTasks ? ['另有 ' + l.moreTasks + ' 項工作'] : [])].join('、') || '分工未定' }) + (l.state === 'paused' ? '（' + U.pbOwnPaused + '）' : ''));
  for (const u of own.unowned) parts.push(NAMES.t('pbOwnNone', { s: u.station }));
  return parts.join('；');
}
function confirmedMarkdown(page, reg, values, c) {
  const v = id => values[id] ?? '';
  const L = [];
  L.push(`# ${page.company.name} 公司概覽（創辦人 ${String(c.confirmedAt || '').slice(0, 10)} 確認）`, '');
  if (page.company.oneLiner) L.push(`一句話：${page.company.oneLiner}`, '');
  L.push('## 目標及下一步');
  const ownTxt = ownershipText();
  for (const r of page.glance.rows) {
    L.push(`- ${r.label}：${r.plan === 'G6' && ownTxt ? ownTxt : v(r.id)}` + (r.due ? `（期限 ${v(r.due.id)}）` : '') + (r.flagTo ? '　← 下一個對外動作' : ''));
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
    L.push('', `### 第 ${i + 1} 站：${m.short}${c.nextActionMilestone === mid ? '（下一個對外動作屬於呢站）' : ''}${m.beyondGoal ? '（目前目標之後）' : ''}${(c.kinds || {})[mid] === 'task' ? '（創辦人判斷：工作，唔係真事）' : ''}`);
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
    L.push('', '## Zero 假設（未證實）');
    for (const a of listOf(dt.assumptions)) L.push(`- ${v(a.id)}${a.test ? `（成本最低的測試：${a.test}）` : ''}`);
  }
  for (const r of listOf(dt.rules)) {
    L.push('', `## ${r.label}`, `- ${v(r.id)}`);
    if (r.boxes) {
      L.push(`- Zero 自己做：${(r.boxes.auto || []).join('、')}`);
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
  const actualAccess = webAccess(checked.host);
  const webNotice = { 'search+read': '本次可以上網搜尋及讀網頁；引用任何網址之前，必須先開啟該頁讀過全文；每個有網址的出處都要自報 fullText（true＝讀過全文，false＝只見過搜尋摘要）', search: '本次只可以網上搜尋，不能開啟網頁全文；每個有網址的出處都要自報 fullText: false，外殼會標「（只經搜尋摘要）」', none: '本次不可上網；外部事實一律寫「查唔到」，不得寫網址' }[actualAccess];
  const taskFile = path.join(sandbox, 'task.md');
  if (fs.existsSync(taskFile)) { const task = fs.readFileSync(taskFile, 'utf8').replace(/^> 本次(?:可以上網搜尋及讀網頁[^\r\n]*|只可以網上搜尋[^\r\n]*|不可上網[^\r\n]*)\r?\n/gm, ''); fs.writeFileSync(taskFile, /^> 今日日期：[^\r\n]*\r?\n/.test(task) ? task.replace(/^(> 今日日期：[^\r\n]*\r?\n)/, '$1> ' + webNotice + '\n') : '> ' + webNotice + '\n' + task); }
  // 每份 AI 工作都加「寫給創辦人看的文字」規矩（唯一出處 ai-plain.md）
  try { const tf = path.join(sandbox, 'task.md'), rules = fs.readFileSync(path.join(ROOT, 'ai-plain.md'), 'utf8'); if (fs.existsSync(tf) && !fs.readFileSync(tf, 'utf8').includes('## 寫給創辦人看的文字')) fs.appendFileSync(tf, '\n' + rules); } catch { }
  // 創辦人答咗「不知道／稍後提供」嘅事：每份工作都列出，到期前唔好再問（規劃書 3.1、4.10）
  try { const tf = path.join(sandbox, 'task.md'), unk = openUnknowns(DIR), H = '## 創辦人已答「' + U.unknownLater + '」的事項';
    if (unk.length && fs.existsSync(tf) && !fs.readFileSync(tf, 'utf8').includes(H)) fs.appendFileSync(tf, `\n${H}\n\n到期前不要再問，亦不要換個講法再問；要用到時照「未知」處理，並在產出寫明仍欠這項資料。\n\n` + unk.map(u => `- ${u.question}（${u.until} 到期）`).join('\n') + '\n'); } catch { }
  if (budgetLeft() <= 0) return Promise.resolve({ ok: false, reason: U.skip_budgetExhausted });
  const beat = setInterval(() => { try { const n = new Date(); fs.utimesSync(LOCK, n, n); } catch { } }, 60000);
  return execute(checked.host, sandbox, undefined, { ...opts, onStart: info => {
    if (budgetLeft() <= 0 || opts?.onStart?.(info) === false) return false;
    try { fs.appendFileSync(STARTS, `${localIso()}\t${(readJSON(path.join(sandbox, 'job.json'), {}) || {}).type || 'ai'}\t${path.basename(sandbox)}\n`); } catch { }
    return true;
  } }).then(result => ({ ...result, webAccess: actualAccess })).finally(() => clearInterval(beat));
}

function checkReceipt(outDir, allowEmpty) {
  const r = readJSON(path.join(outDir, 'receipt.json'), null);
  if (!r || typeof r.summary !== 'string' || !Array.isArray(r.artifacts) || (!r.artifacts.length && !allowEmpty)) return { ok: false, reason: 'Zero 已完成，但未有交出成果，系統未有採用。請按「重試」。' };
  const artifacts = [];
  let tooMany = 0;
  for (const a of r.artifacts) {
    const file = String(a && a.file || '');
    // 收據列咗唔係文件嘅項目（例如問題包）就略過，唔當格式錯
    if (!/^[\w.-]+\.md$/.test(file)) { log(`收據略過一項：${clip(JSON.stringify(a), 60)}`); continue; }
    // 只收前兩份（Z33）：第三份起不收並記警告，收據摘要註明
    if (artifacts.length >= PACE.ARTIFACTS_MAX) { tooMany++; log(`收據第 ${artifacts.length + tooMany} 份起不收：${file}`); continue; }
    const f = path.join(outDir, file);
    if (!fs.existsSync(f)) return { ok: false, reason: 'Zero 交出的資料不齊全，請重試' };
    if (fs.statSync(f).size > 200 * 1024) return { ok: false, reason: 'Zero 交出的資料過大，請重試' };
    artifacts.push({ file, title: String(a.title || file), text: fs.readFileSync(f, 'utf8'), ...(PACE.DELIVERABLE_TYPES.includes(a.type) ? { type: a.type } : {}), ...(['external', 'internal'].includes(a.audience) ? { audience: a.audience } : {}) });
    if (NAMES.isColloquial(a.title)) log(`AI 產出標題有口語字：${a.title}`);
  }
  const list = x => Array.isArray(x) ? x.map(String).slice(0, 5) : [];
  if (!artifacts.length && !allowEmpty) return { ok: false, reason: 'Zero 已完成，但未有交出成果，系統未有採用。請按「重試」。' };
  return { ok: true, receipt: { summary: r.summary.slice(0, 600) + (tooMany ? ' ' + NAMES.t('receipt_tooMany', { n: artifacts.length + tooMany }) : ''), artifacts, founderNext: list(r.founderNext), ...(['external', 'internal'].includes(r.audience) ? { audience: r.audience } : {}) } };
}
// AI 出嘅新問題包：過外殼核對（格式、每包最多 12 條、即刻生效要有選項、答過唔再問）先放上待決事項
function takeAIQuestions(sb, run, fromId = run.id) {
  const f = path.join(sb, 'out', 'ask.json');
  if (!fs.existsSync(f)) return;
  const raw = readJSON(f, null);
  const prep = preparePacks(raw, { dirs: DIR, askedBy: 'AI', fromRun: fromId, strictTitle: false, noDedupe: run.kind === 'note' && run.noteType === 'help' });
  if (!prep.ok) { run.result.askRejected = prep.errors.slice(0, 3); log(`${run.id} AI 問題包退回：${prep.errors.join('；')}`); return; }
  const job = readJSON(path.join(sb, 'job.json'), null);
  if (job && job.type === 'proofread-next') for (const pack of prep.packs) pack.forNextAction = true;
  if (isRequest(run)) markRequest(run, raw, prep.packs);
  run.result.asks = placePacks(DIR, prep.packs);
  if (run.kind === 'note' && (run.noteType === 'adhoc' || run.noteType === 'order') && run.result.asks.length) setRequestInput(run.ref, { status: 'awaitingFounder', packId: run.result.asks[0].id, awaitingFounderText: U.reqAwaiting });
  if (run.kind === 'note' && run.noteType === 'adhoc' && run.result.asks.length) upsertTask({ id: 'a-' + run.ref, status: 'waiting', waitingFor: '等你確認交付內容及期限', packId: run.result.asks[0].id });
  if (prep.warnings.length) { run.result.askWarnings = prep.warnings; log(`${run.id} AI 問題包警告：${prep.warnings.join('；')}`); }
  if (prep.dropped.length) run.result.askDropped = prep.dropped.length;
}

// 請 Zero 做一件事／想改計劃的輸入紀錄（inputs[]）：擬好問題包就「等你確認」，全部答完就「已處理」
function setRequestInput(ref, patch) {
  const s = loadState(), i = (s.inputs || []).find(x => x.id === 'in-' + ref);
  if (!i) return;
  Object.assign(i, patch);
  if (patch.status === 'processed') { delete i.awaitingFounderText; i.processedAt = localIso(); }
  saveState(s);
}
// 創辦人要求擬成嘅問題包：記低屬邊個要求；改次序嘅選項只保留核對得過嘅套用內容（id 要齊、每個一次）
function markRequest(run, raw, packs) {
  const ids = currentRoute().map(r => r.id);
  const okText = (x, n) => typeof x === 'string' && x.trim() && x.length <= n;
  for (const p of packs) {
    p.request = { type: run.noteType, noteId: run.ref };
    p.todoType = run.noteType === 'order' ? 'order' : 'question';
    if (run.noteType === 'adhoc') p.taskId = 'a-' + run.ref;
    if (run.noteType === 'help') {
      p.help = { noteId: run.ref, ...(run.helpForPackId ? { packId: run.helpForPackId } : {}) };
      if (run.helpRetries) p.helpRetries = run.helpRetries;
      // 求助回覆的建議只可提出下一步，不能把創辦人尚未確認的事情寫成既成事實。
      for (const q of p.questions || []) {
        const options = Array.isArray(q.options) ? q.options : [];
        const rec = options.find(o => o && o.rec);
        if (!rec || !/^(?:我已|已經|已與|已有)/.test(String(rec.text || '').trim())) continue;
        const safe = options.find(o => o && !/^(?:我已|已經|已與|已有)/.test(String(o.text || '').trim()) && String(o.text || '') !== U.helpStill)
          || options.find(o => o && String(o.text || '') === U.helpStill);
        if (!safe) continue;
        for (const o of options) o.rec = o === safe;
        q.value = safe.text;
      }
    }
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
const isRequest = run => run.kind === 'note' && (run.noteType === 'order' || run.noteType === 'adhoc' || run.noteType === 'help');
async function runAIStep(run, sb, label, allowEmpty) {
  if (pausedNow() && run.kind !== 'intake') { run.waitingFor = 'paused'; step(run, 'ai', label, 'waiting', U.skip_pausedByFounder); return finish(run, 'waiting'); }
  const ad = certified(ROOT, DIR.ledger);
  step(run, 'ai', label, 'running', 'Zero 處理中，一般需時 1–3 分鐘；你可繼續查看，或關閉此頁稍後再查看');
  log(`${run.id} AI start`);
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (r.waiting) { run.waitingFor = 'ai-setup'; step(run, 'ai', label, 'waiting', r.reason); return finish(run, 'waiting'); }
  if (r.ok && run.noteType === 'practice-prep') return finishPracticePrep(run, sb, label);
  if (!r.ok) { if (run.taskId) upsertTask({ id: run.taskId, status: 'blocked', waitingFor: 'Zero 工作未完成，可在 CrewZero 按「重試」' }); step(run, 'ai', label, 'failed', r.reason); return finish(run, 'failed', r.reason); }
  if (run.kind === 'intake') return finishIntake(run, sb, label);
  if (run.kind === 'prefill') return finishPrefill(run, sb, label);
  if (run.ideateId) {
    const s = readJSON(IDEATE, null);
    if (!s || s.id !== run.ideateId || s.state === 'closed') return finish(run, 'done');
  }
  const styleWarnings = await rewriteOnce(sb, run);
  if (run.ideateId) return finishIdeate(run, sb, label, styleWarnings);
  if (run.noteType === 'event' || run.noteType === 'doc' || run.noteType === 'debrief') return finishEvent(run, sb, label, styleWarnings);
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
  if (isRequest(run) && !(run.result.asks || []).length) { if (run.noteType === 'adhoc') upsertTask({ id: 'a-' + run.ref, status: 'blocked', waitingFor: 'Zero 未能擬定範圍，可在 CrewZero 按「重試」' }); const why = 'Zero 這次未能擬定問題，系統未有採用。請按「重試」，Zero 會重新擬定。'; step(run, 'ai', label, 'failed', why); return finish(run, 'failed', why); }
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
    context: 'Zero 已完成你交的臨時工作' + (art ? '：「' + art.title + '」' : '') + '。', afterConfirm: '接受即完成；退回 Zero 會按你的原因再改。',
    next: null, askedBy: 'AI', askedAt: localIso(), fromRun: run.id, todoType: 'acceptance', acceptance: { taskId: t.id, artifact: art ? { title: art.title, text: art.text } : null },
    questions: [
      { id: 'accept', priority: 1, ask: '這份產出可以用嗎？', kind: 'choice', effect: 'now', options: [{ text: '接受' }, { text: '退回修改' }] },
      { id: 'reason', priority: 2, ask: '如果退回，要改甚麼？', kind: 'text', effect: 'tentative', value: '不用改', why: '接受就毋須填寫。' }
    ]
  };
  const placed = placePacks(DIR, [pack]);
  run.result.asks = (run.result.asks || []).concat(placed);
  upsertTask({ id: t.id, status: 'done', needsAcceptance: true, acceptedBy: null, artifactTitle: art ? art.title : '', packId: placed[0].id, waitingFor: '' });
  addEvent({ actor: 'ai', type: 'run', title: 'Zero 完成臨時工作：' + t.title + '，待你驗收', relatedIds: [t.id, run.id], moduleIds: ['ai-week', 'artifacts'] });
}
/* ---------- 改次序／加一站：創辦人答咗先由外殼機械套用（帳本有就改帳本；冇就改公司概覽同成頁確認） ---------- */
function applyOrder(pack, store, run) {
  const q = pack.questions.find(x => (x.options || []).some(o => o.apply && (o.apply.order || o.apply.keep)));
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
      page.path.milestones.push({ id: newId, short: add.short, why: '創辦人要求加入', event: { id: newId + '-e', label: '真事', value: add.event, origin: 'founder' },
        // 見證、證據、完成條件一併寫入（milestonesFromPage 讀 witness、proof、deliver），不再丟失（資料約定 9B）
        ...Object.fromEntries([['witness', 'w', 'milestone.witness', add.witness], ['proof', 'p', 'milestone.evidence', add.evidence], ['deliver', 'd', 'milestone.deliveryCondition', add.deliveryCondition]].filter(x => x[3]).map(([k, sfx, plan, v]) => [k, { id: newId + '-' + sfx, plan, label: NAMES.field[plan] || plan, kind: 'text', value: v, origin: 'founder' }])), ...(add.targetDate ? { target: { id: newId + '-t', label: '目標日期', kind: 'date', value: add.targetDate, origin: 'founder' } } : {}) }); }
    const ids = order.map(x => x === 'new' ? newId : x);
    if (c) { c.order = ids; if (add) { c.values = c.values || {}; c.values[newId + '-e'] = add.event; for (const [sfx, v] of [['w', add.witness], ['p', add.evidence], ['d', add.deliveryCondition]]) if (v) c.values[newId + '-' + sfx] = v; if (add.targetDate) c.values[newId + '-t'] = add.targetDate; } writeJSON(CONFIRMED, c); }
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
  plainWarn(clip(String(run.label || ({ intake: '公司概覽草稿', note: '你的要求' })[run.kind] || '一次 Zero 工作'), 30), fix.marked.length > 0, fix.colloquial > 0);
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
  if (!page) return { ok: false, errors: ['Zero 未有交出公司概覽，或內容無法讀取'], warnings: [] };
  const revision = fs.existsSync(path.join(DIR.company, 'history')) ? fs.readdirSync(path.join(DIR.company, 'history')).filter(f => f.startsWith('page-')).length + 2 : (fs.existsSync(path.join(DIR.company, 'page.json')) ? 2 : 1);
  return checkCompanyPage(page, { id: 'intake-' + run.ref, revision, preparedAt: localIso().slice(0, 10), ready: !!ready, newDraft: true });
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
// 來源網址必須逐字出現在創辦人答案或附件文字版原文：corpus 是答案加可讀附件（純文字或轉出的文字版）；讀不到文字的附件（例如 PDF）不核對
function intakeSourceCheck(sb, page) {
  let corpus = '';
  try { corpus += fs.readFileSync(path.join(sb, 'intake.md'), 'utf8') + '\n'; } catch { }
  const textNames = new Set();
  try { for (const f of fs.readdirSync(path.join(sb, 'files'))) if (/\.(md|txt|csv)$/i.test(f)) { textNames.add(f.replace(/\.md$/i, '')); textNames.add(f); try { corpus += fs.readFileSync(path.join(sb, 'files', f), 'utf8') + '\n'; } catch { } } } catch { }
  const sources = Array.isArray(page && page.sources) ? page.sources : [];
  const eff = sources.map(x => x && x.from === 'file' && !textNames.has(String(x.file || '')) ? { ...x, from: '' } : x);
  return { corpus, bad: checkSourceUrls(eff, corpus).bad };
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
    const why = 'Zero 這次擬定的公司概覽內容不完整，系統未有採用。請按「重試」，Zero 會重新擬定。';
    step(run, 'ai', label, 'failed', why);
    return finish(run, 'failed', why);
  }
  // 來自創辦人答案或附件的來源網址要逐字核對：不符先退回 Zero 修正一次，仍不符就把網址留空並加註
  let urlCheck = intakeSourceCheck(sb, chk.page);
  if (urlCheck.bad.length) {
    log(`${run.id} 來源網址不在原文內：${urlCheck.bad.map(b => b.url).join('、')}；叫 AI 修正一次`);
    writeJSON(path.join(sb, 'job.json'), { type: 'intake-repair', errors: urlCheck.bad.map(b => b.url) });
    fs.writeFileSync(path.join(sb, 'task.md'), ['# 你今次嘅工作：修正來源網址', '',
      '你啱啱寫嘅 `out/company-page.json` 有以下來源網址，並沒有逐字出現在創辦人答案（`intake.md`）或附件文字版：', '',
      ...urlCheck.bad.map((b, i) => `${i + 1}. 來源第 ${b.index + 1} 項：${b.url}`), '', '網址必須由原文逐字抄貼，一個字元都不可以改。找不到原文就把該來源的 `url` 刪去（連同 `from`），其他內容唔好改。改完覆寫 `out/company-page.json`。只可以寫 `out/`。'].join('\n') + '\n');
    const r = await runAI(sb);
    if (r.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r.meta.total_cost_usd || 0);
    const again0 = r.ok ? checkDraft(out, run, true) : null;
    if (again0 && again0.ok) { chk = again0; urlCheck = intakeSourceCheck(sb, chk.page); }
  }
  if (urlCheck.bad.length) {
    chk.page.sources = chk.page.sources.map((x, i) => urlCheck.bad.some(b => b.index === i) ? (({ url, ...rest }) => ({ ...rest, note: [rest.note, U.sourceUrlUnverified].filter(Boolean).join('；') }))(x) : x);
    log(`${run.id} 來源網址仍未能核對，已留空：${urlCheck.bad.map(b => b.url).join('、')}`);
  }
  if (Array.isArray(chk.page.sources)) chk.page.sources = await markBrokenLinks(chk.page.sources, 'note');
  writeJSON(path.join(out, 'company-page.json'), chk.page);
  const styleWarnings = await rewriteOnce(sb, run);
  // 改寫之後再核對一次；改壞咗就用返改寫前嗰版
  let page = chk.page;
  const again = checkDraft(out, run);
  if (again.ok) page = again.page; else log(`${run.id} 改寫後格式唔啱，用返改寫前嘅公司概覽`);
  fixSourceFiles(page, run.ref);
  installPage(page);
  const bizFile = path.join(DIR.company, 'biz.json');
  const inferred = (page.detail.reading || []).find(f => f.plan === 'biz.type');
  const type = inferred && Object.keys(BIZ_TYPES).find(id => BIZ_TYPES[id].label === inferred.value);
  if (type && !fs.existsSync(bizFile)) writeJSON(bizFile, { type, other: '', source: 'ai' });
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
  const m = /^(.*)-note-(order|adhoc|help|feedback|brain-decide|practice-prep|debrief|debate-start|debate-action|event|doc|ideate)\.md$/.exec(file) || /^(.*)-(feedback)-[a-z]+\.md$/.exec(file);
  run.kind = 'note'; run.ref = m[1]; run.noteType = m[2]; run.replyFiles = [file];
  if (run.noteType === 'ideate') run.ideateId = (readJSON(IDEATE, null) || {}).id;
  const raw = fs.readFileSync(path.join(DIR.inbox, file), 'utf8');
  const parsed = parseReply(raw), machine = parsed.machine || {};
  const retry = /^help\s+[\w-]+\s+([12])$/.exec(String(parsed.head.from || ''));
  run.helpRetries = retry ? Number(retry[1]) : 0;
  run.helpForPackId = run.noteType === 'help' && /^[\w-]{1,80}$/.test(String((machine.context || {}).packId || '')) ? String(machine.context.packId) : '';
  run.helpForRunRef = run.noteType === 'help' && /^[\w-]{1,80}$/.test(String((machine.context || {}).runRef || '')) ? String(machine.context.runRef) : '';
  step(run, 'received', U.stepReqReceived, 'done', { order: U.reqOrder, adhoc: U.reqAdhoc, help: U.reqHelp, feedback: U.brainFeedback, 'brain-decide': U.brainDecide, 'practice-prep': U.practicePrep, debrief: U.practiceDebrief, 'debate-start': U.debateReq, 'debate-action': U.debateActionReq, event: U.reqEvent, doc: U.reqDoc, ideate: U.zeroThink }[run.noteType]);
  const text = raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').trim();
  const said = text.replace(/\x60\x60\x60json[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
  const dest = path.join(DIR.archive, `${new Date().getFullYear()}-${pad(new Date().getMonth() + 1)}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(path.join(DIR.inbox, file), path.join(dest, file));
  // 收件說明檔（來源、文字版、Google 讀取、連結失敗）：一併封存，內容核對後才用；沒有就當舊格式
  let meta = null;
  const metaName = run.ref + '-note-' + run.noteType + '-meta.json';
  if (['event', 'doc', 'adhoc', 'order'].includes(run.noteType) && fs.existsSync(path.join(DIR.inbox, metaName))) {
    meta = cleanMeta(readJSON(path.join(DIR.inbox, metaName), null));
    fs.renameSync(path.join(DIR.inbox, metaName), path.join(dest, metaName));
  }
  if (run.noteType === 'ideate') return handleIdeate(run);
  if (run.noteType === 'event' || run.noteType === 'doc') return handleEvent(run, raw, text.replace(/```json[\s\S]*$/, '').trim(), dest, meta);
  if (run.noteType === 'feedback') return handleFeedback(run, parseReply(raw).machine || {});
  if (run.noteType === 'brain-decide') return handleBrainDecide(run, parseReply(raw).machine || {});
  if (run.noteType === 'practice-prep') return handlePracticePrep(run, parseReply(raw).machine || {}, text.replace(/```json[\s\S]*$/, '').trim());
  if (run.noteType === 'debrief') return handleDebrief(run, parseReply(raw).machine || {}, text.replace(/```json[\s\S]*$/, '').trim());
  if (run.noteType === 'debate-action') return handleDebateAction(run, parseReply(raw).machine || {});
  if (run.noteType === 'debate-start') { if (!loadPage()) { const why = '未有公司概覽，請先告訴 Zero'; step(run, 'applied', U.stepReqRegistered, 'failed', why); return finish(run, 'failed', why); } return handleDebateStart(run, parseReply(raw).machine || {}); }
  if (run.noteType !== 'help' && !loadPage()) { const why = '未有公司概覽，請先告訴 Zero'; step(run, 'applied', U.stepReqRegistered, 'failed', why); return finish(run, 'failed', why); }
  // 請 Zero 做一件事／想改計劃：也登記成「交給 Zero 的事」（帳本 inputs[]，帶來源、附件、文字版）；沒有附件、不是討論來的也照登記
  let reqFiles = [];
  if (run.noteType === 'adhoc' || run.noteType === 'order') {
    const pre = run.ref + '-note-' + run.noteType + '-file-';
    const names = fs.readdirSync(DIR.inbox).filter(f => f.startsWith(pre)).sort();
    for (const f of names) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
    const s0 = loadState();
    const s1 = registerInput(s0, { id: 'in-' + run.ref, via: run.noteType, title: clip((run.noteType === 'adhoc' ? U.reqAdhoc : U.reqOrder) + '：' + said, 50), file: path.relative(DIR.data, path.join(dest, file)).replace(/\\/g, '/'), dir: path.relative(DIR.data, dest).replace(/\\/g, '/'), names, receivedAt: localIso(), meta });
    saveState(s1);
    const reg = s1.inputs.find(i => i.id === 'in-' + run.ref);
    reqFiles = attachmentRows(reg);
  }
  if (run.noteType === 'adhoc') {
    upsertTask({ id: 'a-' + run.ref, title: clip(text.replace(/\s+/g, ' '), 30), adhoc: true, status: 'planned', waitingFor: 'Zero 正在擬定範圍', noteId: run.ref, ...(meta && meta.source ? { source: meta.source } : {}) });
    addEvent({ actor: 'founder', type: 'input', title: '提交臨時工作：' + clip(said, 30), relatedIds: ['a-' + run.ref], moduleIds: ['inputs', 'decisions'] });
  } else if (run.noteType === 'help') addEvent({ actor: 'founder', type: 'input', title: '提出求助：' + clip(said, 30), moduleIds: ['inputs'] });
  else addEvent({ actor: 'founder', type: 'input', title: '要求改路線：' + clip(said, 30), relatedIds: [], moduleIds: ['inputs', 'paths'] });
  step(run, 'applied', U.stepReqRegistered, 'done', '');
  if ((run.noteType === 'order' || run.noteType === 'adhoc') && ROLES.wantsRole(said)) noteWantRole(run, said);
  const sb = newSandbox(run);
  if (run.noteType === 'help') helpNoteTask(sb, text.replace(/\x60\x60\x60json[\s\S]*$/, '').trim(), machine.context || {});
  else noteTask(sb, run.noteType, text, reqFiles);
  await runAIStep(run, sb, run.noteType === 'help' ? U.helpReply : U.requestFollowUp, true);
}
/* ---------- 生意大腦：結果卡意見（有用／沒有用照記；要修改就叫 AI 按意見改）同「要你決定」放上待決事項 ---------- */
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
  if (m.verdict !== 'revise' || !card) { run.result = { summary: '已記錄你的意見' + (m.verdict === 'revise' ? '；找不到此張卡的內容，Zero 未能修改。' : '。'), artifacts: [], founderNext: [] }; return finish(run, 'done'); }
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
// 紅藍對打嘅「需要你決定」：外殼照裁判寫嘅選項機械出問題包（唔使 AI），放上待決事項
function placeFounderDecisions(key, ds, matchId = '') {
  if (!key || !ds || !ds.length) return { ok: false, reason: U.debateDecisionMissing };
  const file = path.join(DIR.ledger, 'brain-decisions.json'), map = readJSON(file, {}) || {};
  if (map[key]) return { ok: true, placed: [], packId: map[key], existing: true };
  const raw = { format: 'startup-os.ask/0.1', title: U.debateDecisionTitle, context: U.debateDecisionContext, afterConfirm: U.debateDecisionAfter,
    questions: ds.slice(0, 3).map((d, i) => { const opts = (d.options || []).slice(0, 3).map(o => String(o)); const rec = opts.find(o => o === d.recommend || o.startsWith(String(d.recommend || '') + ' ')) || opts[0];
      return { id: 'd' + (i + 1), priority: i + 1, ask: String(d.question), kind: 'choice', effect: 'now', options: opts.map(o => ({ text: o, rec: o === rec })), value: rec, why: String(d.why || U.debateDecisionWhy), ...(String(d.risk || '').trim() ? { risk: clip(String(d.risk), 120) } : {}), ...(String(d.conflict || '').trim() ? { conflict: clip(String(d.conflict), 120) } : {}) }; }) };
  const prep = preparePacks(raw, { dirs: DIR, askedBy: 'AI', fromRun: null, strictTitle: false, system: true });
  if (!prep.ok || !prep.packs.length) return { ok: false, reason: prep.ok ? U.debateDecisionAnswered : U.debateDecisionInvalid };
  for (const p of prep.packs) { p.todoType = 'decision'; p.brainItem = 'wargame'; if (matchId && viewOf(matchId)) p.debate = { matchId, kind: 'decision' }; }
  const placed = placePacks(DIR, prep.packs);
  map[key] = placed[0].id;
  writeJSON(file, map);
  return { ok: true, placed, packId: placed[0].id, existing: false };
}
function handleBrainDecide(run, m) {
  const view = /^[\w-]{1,40}$/.test(String(m.matchId || '')) ? viewOf(m.matchId) : null;
  const w = view || (loadBrain(DIR).items.find(x => x.id === 'wargame') || {}).detail;
  if (view && m.cardId) {
    const file = path.join(DIR.ledger, 'brain-decisions.json'), map = readJSON(file, {}) || {};
    if (Object.hasOwn(map, m.cardId) && map[m.cardId] && !Object.hasOwn(map, m.matchId)) { map[m.matchId] = map[m.cardId]; writeJSON(file, map); }
  }
  const result = placeFounderDecisions(view ? m.matchId : m.cardId, w && w.synthesis ? w.synthesis.founderDecisions : [], view ? m.matchId : '');
  if (!result.ok && result.reason === U.debateDecisionAnswered) {
    step(run, 'applied', U.stepReqRegistered, 'done', result.reason);
    run.result = { summary: result.reason, artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  if (!result.ok) { step(run, 'applied', U.stepReqRegistered, 'failed', result.reason); return finish(run, 'failed', result.reason); }
  const said = result.existing ? U.debateDecisionAlready : U.debateDecisionPlaced;
  step(run, 'applied', U.stepReqRegistered, 'done', said);
  run.result = { summary: said, artifacts: [], founderNext: [], ...(result.placed.length ? { asks: result.placed } : {}) };
  return finish(run, 'done');
}
function writeCounterparts(sb) {
  const rows = counterpartsOf(DIR), lines = ['# 公司以外的對象紀錄', ''];
  for (const p of rows) {
    lines.push('## ' + p.name, '- 對象編號：' + p.id, '- 類別：' + p.kind, '- 推進位置：' + (NAMES.evName(NAMES.EV_KEYS[p.stage]) || ''), '- 最近真事：' + (p.lastReal || '沒有紀錄'));
    for (const m of p.milestones) lines.push('- 所屬站點：' + m.name + '；' + m.actor);
    for (const a of p.assumptions) lines.push('- 假設：' + a.text + '（' + a.grade + '）');
    if (p.debrief) lines.push('- 上次會後紀錄：' + (p.debrief.text || '') + '；' + (p.debrief.commitment || ''));
    for (const why of p.review) lines.push('- 練習覆盤：' + (why.text || why.reason || ''));
    for (const care of p.seats) lines.push('- 辯論席位關注：' + care);
    lines.push('');
  }
  if (!rows.length) lines.push('（沒有對象紀錄）');
  fs.writeFileSync(path.join(sb, 'counterparts.md'), lines.join('\n') + '\n');
}
/* ---------- 情景演練：準備場景（AI 由準備文件同你嘅行動擬人物卡）、會後紀錄（AI 擬跟進問題） ---------- */
const PRACTICE_DIR = path.join(DIR.data, 'practice', 'scenarios');
async function handlePracticePrep(run, m, say) {
  const task = m.taskId ? getTask(m.taskId) : null;
  run.practiceTaskId = m.taskId || '';
  const actors = (loadState().company || {}).actors || [];
  run.practiceCounterpartId = ((m.counterpartId ? actors.find(a => a.id === m.counterpartId) : !Object.hasOwn(m, 'counterpartId') ? actors.find(a => a.name === String(m.who || '').trim()) : null) || {}).id || '';
  step(run, 'applied', U.stepReqRegistered, 'done', task ? task.title : '');
  const sb = newSandbox(run);
  const counterpart = counterpartsOf(DIR).find(p => p.id === run.practiceCounterpartId);
  const excerpt = counterpart ? ['## ' + counterpart.name, '- 對象編號：' + counterpart.id, '- 推進位置：' + (NAMES.evName(NAMES.EV_KEYS[counterpart.stage]) || ''), '- 最近真事：' + (counterpart.lastReal || '沒有紀錄'), ...counterpart.milestones.map(x => '- 所屬站點：' + x.name + '；' + x.actor), ...counterpart.assumptions.map(x => '- 相關假設：' + x.text + '（' + x.grade + '）'), ...(counterpart.debrief ? ['- 上次會後紀錄：' + (counterpart.debrief.text || '')] : []), ...counterpart.review.map(x => '- 覆盤重點：' + (x.reason || x.text || ''))] : [];
  fs.writeFileSync(path.join(sb, 'counterparts.md'), '# 對方紀錄\n\n' + excerpt.join('\n') + '\n');
  fs.writeFileSync(path.join(sb, 'request.md'), ['# 想練習嘅會面', '', task ? `- 現實行動：${task.title}` : '', task && task.dueAt ? `- 日期：${task.dueAt}` : '', (counterpart || m.who) ? `- 對方：${counterpart ? counterpart.name : m.who}` : '', say ? `- 創辦人補充：${say}` : '', ...excerpt].filter(Boolean).join('\n') + '\n');
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
async function finishPracticePrep(run, sb, label) {
  const sc = readJSON(path.join(sb, 'out', 'scenario.json'), null);
  const txt = (x, n) => typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : '';
  const okSc = sc && sc.counterpart && txt(sc.counterpart.name, 60) && sc.persona && ['identity', 'stance', 'interests'].every(k => sc.persona[k] && txt(sc.persona[k].text, 400)) && sc.goal && txt(sc.goal.text, 200) && Array.isArray(sc.questions) && sc.questions.length && Array.isArray(sc.objections) && sc.objections.length;
  if (!okSc) { const why = 'Zero 這次準備的場景內容不完整，系統未有採用。請按「重試」，Zero 會重新準備。'; step(run, 'ai', label, 'failed', why); return finish(run, 'failed', why); }
  const task = run.practiceTaskId ? getTask(run.practiceTaskId) : null;
  const personaWarnings = [];
  const counterpartText = fs.existsSync(path.join(sb, 'counterparts.md')) ? fs.readFileSync(path.join(sb, 'counterparts.md'), 'utf8') : '';
  const hasDebrief = !!run.practiceCounterpartId && counterpartText.split(/\r?\n## /).some(block => block.includes('- 對象編號：' + run.practiceCounterpartId + '\n') && block.includes('- 上次會後紀錄：'));
  const personaSource = (source, key) => { const s = txt(source, 60); if (/^(你原話|Zero 解讀|外部事實 \[\d+\]|你上次會面紀錄)$/.test(s) && (s !== '你上次會面紀錄' || hasDebrief)) return s; personaWarnings.push(NAMES.dash.warnPersonaSource.replace('{id}', key)); return 'Zero 解讀'; };
  const id = 'S' + stamp();
  const clean = { id, ...(run.practiceCounterpartId ? { counterpartId: run.practiceCounterpartId } : {}), title: txt(sc.title, 60) || '練習：' + txt(sc.counterpart.name, 30), forTaskId: task ? task.id : '', date: task && task.dueAt || '', counterpart: { name: txt(sc.counterpart.name, 60), role: txt(sc.counterpart.role, 120) },
    persona: Object.fromEntries(['identity', 'background', 'stance', 'interests', 'decision', 'concerns', 'style'].filter(k => sc.persona[k] && txt(sc.persona[k].text, 400)).map(k => [k, { text: txt(sc.persona[k].text, 400), source: personaSource(sc.persona[k].source, k) }])),
    hidden: (sc.hidden || []).slice(0, 3).map((h, i) => ({ id: 'H' + (i + 1), text: txt(h.text, 300) })).filter(h => h.text),
    goal: { text: txt(sc.goal.text, 200), fallback: txt(sc.goal.fallback, 200) },
    questions: sc.questions.slice(0, 8).map((q, i) => ({ id: 'Q' + (i + 1), text: txt(q.text || q, 200) })).filter(q => q.text),
    objections: sc.objections.slice(0, 7).map((o, i) => ({ id: 'O' + (i + 1), text: txt(o.text || o, 200), response: txt(o.response, 200) })).filter(o => o.text),
    opening: txt(sc.opening, 200) || '你好，坐低傾吓。', openers: (sc.openers || []).slice(0, 3).map(x => txt(x, 160)).filter(Boolean),
    sources: (sc.sources || []).slice(0, 8).map((s, i) => ({ n: Number(s.n) || i + 1, title: markSource(txt(s.title, 120), /^https?:\/\//.test(String(s.url || '')) ? s : {}, ''), ...(/^https?:\/\//.test(String(s.url || '')) ? { fullText: s.fullText === true } : {}), url: /^https?:\/\//.test(String(s.url || '')) ? txt(s.url, 300) : '', readOn: /^\d{4}-\d{2}-\d{2}$/.test(String(s.readOn || '')) ? s.readOn : /^https?:\/\//.test(String(s.url || '')) ? localIso().slice(0, 10) : '' })).filter(s => s.title), practiceOnly: true, preparedAt: localIso(), fromRun: run.id };
  clean.sources = await markBrokenLinks(clean.sources, 'title');
  fs.mkdirSync(PRACTICE_DIR, { recursive: true });
  writeJSON(path.join(PRACTICE_DIR, id + '.json'), clean);
  if (task) upsertTask({ id: task.id, scenarioId: id });
  run.result = { summary: '練習場景準備好：' + clean.title, artifacts: [], founderNext: [], scenarioId: id, warnings: personaWarnings };
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
  writeCounterparts(sb);
  fs.writeFileSync(path.join(sb, 'debrief.md'), ['# 會後紀錄（真實會面）', '', `- 對方：${sc ? sc.counterpart.name : '（未有場景）'}`, `- 有冇承諾：${CM[m.commitment] || ''}`, m.followUp ? `- 跟進日期：${m.followUp}` : '', '', '## 對方真係講咗乜', '', say].filter(x => x !== '').join('\n') + '\n');
  if (sc) writeJSON(path.join(sb, 'scenario.json'), sc);
  const s = loadState(), date = localIso().slice(0, 10), inputId = 'in-' + run.ref;
  s.inputs = (s.inputs || []).filter(i => i.id !== inputId);
  s.inputs.push({ id: inputId, kind: 'inbox', via: 'debrief', title: '會後紀錄：' + (sc ? sc.counterpart.name : '真實會面') + '：' + clip(say, 50), file: '', files: [], eventDate: date, receivedAt: localIso(), status: 'unprocessed', effects: [], ...(m.followUp ? { followUpHint: { date: m.followUp, who: sc ? sc.counterpart.name : '' } } : {}) });
  saveState(s);
  eventTask(sb, s, { text: say, date, files: [], ref: run.ref });
  fs.copyFileSync(path.join(ROOT, 'ai-debrief.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'debrief' });
  await runAIStep(run, sb, U.practiceDebriefAI, true);
}
function noteTask(sb, type, text, rows = []) {
  const listing = writeAttachments(sb, rows);
  fs.writeFileSync(path.join(sb, 'note.md'), `# 創辦人的要求（${type === 'order' ? '改次序或加一站' : '臨時工作'}）\n\n${text}\n` + (listing.length ? `\n## 附件（在 files/）\n\n${listing.join('\n')}\n` : ''));
  writeJSON(path.join(sb, 'route.json'), currentRoute());
  writeConfirmedPage(sb);
  if (!fs.existsSync(path.join(sb, 'confirmed-page.md'))) fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(sb, 'company-page.json'));
  fs.writeFileSync(path.join(sb, 'task.md'), fs.readFileSync(path.join(ROOT, 'ai-note.md'), 'utf8') + `\n## 今次嘅要求類型\n\n${type === 'order' ? '類型一：改次序／加一站' : '類型二：臨時工作'}\n`);
  writeJSON(path.join(sb, 'job.json'), { type: 'note', noteType: type });
}
function writeHelpState(sb, firstWeek = '') {
  const checked = certified(ROOT, DIR.ledger);
  const card = guideCard(firstWeek, dashboardState(DIR, { cert: checked && checked.host ? checked : null })) || {};
  const runs = readJSON(STATUS, { runs: [] }).runs || [];
  const timeOf = r => new Date(r.endedAt || r.startedAt || 0).getTime() || 0;
  const newest = runs.slice().sort((a, b) => timeOf(b) - timeOf(a));
  const failed = newest.find(r => r.state === 'failed' && (r === newest[0] || !newest.some(s => s.state === 'done' && s.ref && s.ref === r.ref && timeOf(s) > timeOf(r))));
  const waiting = listPacks(DIR).filter(p => p.open).slice(0, 8).map(p => `- ${clip(p.title, 80)}（尚有 ${p.open} 條未答）`);
  const state = loadState();
  const events = (state.events || []).slice(-5).reverse().map(e => '- ' + clip(e.title, 80));
  const answers = readLog(DIR, 500).filter(e => e && e.question && e.answer).slice(0, 5).map(e => `- 題目：${clip(e.question, 80)}；答案：${clip(e.answer, 80)}`);
  fs.writeFileSync(path.join(sb, 'state.md'), ['# 目前狀態', '', '## 目前階段', '', card.today || '目前沒有可顯示的安排。', '', '## 待決事項', '', waiting.length ? waiting.join('\n') : '沒有。', '', '## 最近紀錄', '', '### 事件', '', events.length ? events.join('\n') : '沒有。', '', '### 已記錄答案', '', answers.length ? answers.join('\n') : '沒有。', '', '## 最近一次未完成的原因', '', failed && failed.error ? failed.error : '沒有。', '', '## AI 工具是否已設定', '', checked && checked.host ? '已設定。' : '未設定。'].join('\n') + '\n');
}
function helpNoteTask(sb, text, context = {}) {
  const extra = context && typeof context === 'object' ? [context.page ? '- 目前頁面：' + context.page : '', context.packTitle ? '- 題目包：' + context.packTitle : ''].filter(Boolean) : [];
  const pack = context && /^[\w-]{1,80}$/.test(String(context.packId || '')) ? loadPack(DIR, context.packId) : null;
  const q = pack && (pack.questions || []).find(x => x.id === context.ask || x.ask === context.ask);
  if (q) {
    extra.push('- 題目：' + q.ask, '- 原因：' + (q.why || '沒有。'), '- 風險：' + (q.risk || '沒有。'));
    for (const o of q.options || []) extra.push('- 選項：' + o.text);
  } else if (context && context.ask) extra.push('- 題目：' + context.ask);
  fs.writeFileSync(path.join(sb, 'note.md'), '# 創辦人的求助\n\n' + text + '\n' + (extra.length ? '\n## 頁面或題目資料\n\n' + extra.join('\n') + '\n' : ''));
  writeJSON(path.join(sb, 'route.json'), currentRoute());
  writeConfirmedPage(sb);
  if (!fs.existsSync(path.join(sb, 'confirmed-page.md')) && fs.existsSync(path.join(DIR.company, 'page.json'))) fs.copyFileSync(path.join(DIR.company, 'page.json'), path.join(sb, 'company-page.json'));
  let firstWeek = ''; try { firstWeek = fs.readFileSync(path.join(ROOT, 'FIRST-WEEK.md'), 'utf8'); } catch {}
  writeHelpState(sb, firstWeek);
  fs.writeFileSync(path.join(sb, 'task.md'), fs.readFileSync(path.join(ROOT, 'ai-note.md'), 'utf8') + '\n## 今次嘅要求類型\n\n類型三：求助\n');
  writeJSON(path.join(sb, 'job.json'), { type: 'note', noteType: 'help' });
}
/* ---------- 記錄真實事件（規劃書 3.10 (2)(3)、3.3、3.7）：登記輸入 → AI 擬確認問題（證據級、站點進度）→ 你逐項確認 → 外殼套用 ----------
   AI 唔可以自己改級或者標站點完成：佢只交建議（out/event.json），問題包由外殼按建議機械生成，選項帶套用內容；
   未答嘅唔套用，答咗嘅即時寫入帳本（假設級別、站點進度、該筆輸入嘅收據、事件）。事件日期由你填，唔係提交時間。 */
const dayText = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[2]} 月 ${+m[3]} 日` : String(d || ''); };
function replySubmittedAt(run, answer) {
  const files = [].concat(run && Array.isArray(run.replyFiles) ? run.replyFiles : [], answer && answer.reply ? [answer.reply] : []);
  for (const file of files) {
    const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(String(file || ''));
    if (m) return localIso(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  }
  return String((answer && answer.at) || '');
}
function founderUpdatedAfter(action, replyAt) {
  const replyTime = Date.parse(String(replyAt || '')), founderTime = Date.parse(String(action && action.founderUpdatedAt || ''));
  return Number.isFinite(replyTime) && Number.isFinite(founderTime) && replyTime < founderTime;
}
const EV_RANK = g => Math.max(0, NAMES.EV_KEYS.indexOf(g));
// Called before each mutation so old companies do not replay historical firsts.
function noteCelebration(s, change) {
  // 示範資料照常慶祝（試玩時最應該看到）；模擬時光及內部工作不慶祝
  if (isSim() || (change.milestone && change.milestone.kind === 'task')) return;
  const c = s.celebrations = s.celebrations || { entries: [], kinds: {} };
  c.entries = c.entries || []; c.kinds = c.kinds || {};
  const assumptions = (s.company || {}).assumptions || [], first = [];
  if (change.assumption) {
    const rank = EV_RANK(change.grade);
    if (change.from === 'guess' && rank > 0 && !assumptions.some(a => EV_RANK(a.grade || 'guess') > 0)) first.push('first-external');
    if (rank >= EV_RANK('paid') && !assumptions.some(a => EV_RANK(a.grade || 'guess') >= EV_RANK('paid'))) first.push('first-paid');
    if (rank >= EV_RANK('stuck') && !assumptions.some(a => EV_RANK(a.grade || 'guess') >= EV_RANK('stuck'))) first.push('first-stuck');
  } else if (!(s.milestones || []).some(m => m.state === 'done' && m.kind !== 'task')) first.push('first-milestone');
  const fresh = first.filter(k => !c.kinds[k]);
  for (const kind of fresh) c.kinds[kind] = true;
  const priority = ['first-stuck', 'first-paid', 'first-external', 'first-milestone'];
  const kind = priority.find(k => fresh.includes(k)) || (change.assumption ? 'grade' : 'milestone');
  change.batch.push({ level: fresh.length ? 'top' : change.assumption ? 2 : 3, kind, title: change.assumption ? clip(change.assumption.text, 60) : change.milestone.short, milestone: change.milestone });
}
function finishCelebration(s, batch) {
  if (!batch.length) return;
  const score = item => item.level === 'top' ? 4 : item.level;
  const priority = ['first-stuck', 'first-paid', 'first-external', 'first-milestone'];
  const winner = batch.reduce((a, b) => score(b) > score(a) || (score(b) === 4 && score(a) === 4 && priority.indexOf(b.kind) < priority.indexOf(a.kind)) ? b : a);
  const rank = ((s.company || {}).assumptions || []).reduce ( (n, a) => Math.max(n, EV_RANK(a.grade || 'guess')), 0);
  const grade = NAMES.EV_KEYS[rank], m = winner.milestone;
  const next = m && (s.milestones || []).filter(x => x.pathStatus === 'confirmed' && x.state !== 'done').sort((a, b) => (a.order || 0) - (b.order || 0))[0];
  const also = batch.filter(x => x !== winner).map(x => x.title).slice(0, 3);
  s.celebrations.entries.push({ id: 'cele-' + stamp() + '-' + randomUUID(), level: winner.level, kind: winner.kind, title: winner.title, grade, gradeName: NAMES.evName(grade), nextGradeName: NAMES.EV_KEYS[rank + 1] ? NAMES.evName(NAMES.EV_KEYS[rank + 1]) : '', stage: m ? m.short : '', nextStage: next ? next.short : '', at: localIso(), ...(also.length ? { also } : {}) });
  s.celebrations.entries = s.celebrations.entries.slice(-50);
}
async function handleEvent(run, raw, text, dest, meta = null) {
  const mac = parseReply(raw).machine || {};
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(mac.date || '')) ? mac.date : localIso().slice(0, 10);
  // 證明文件同筆記一齊封存（永不刪除）；文字版（.md）一併封存但不算附件，由 registerInput 分開
  // 放入文件（doc）同真實事件同一條路；文件名前綴唔同
  const isDoc = run.noteType === 'doc', pre = run.ref + '-note-' + (isDoc ? 'doc' : 'event') + '-file-';
  const allNames = fs.readdirSync(DIR.inbox).filter(f => f.startsWith(pre)).sort();
  for (const f of allNames) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
  const rel = f => path.relative(DIR.data, path.join(dest, f)).replace(/\\/g, '/');
  syncLedger();
  const inputId = 'in-' + run.ref;
  const sidecars = new Set(((meta && meta.fileInfo) || []).map(x => x.text).filter(Boolean));
  const files = allNames.filter(f => !sidecars.has(f));
  const names = files.map(f => f.slice(pre.length).replace(/^\d+-/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '')).join('、');
  const said0 = text.replace(/\s+/g, ' '), label = said0 && said0 !== '（沒有補充）' ? said0 : names;
  const title = clip(isDoc ? '文件（' + dayText(date) + '）：' + names : U.reqEvent + '（' + dayText(date) + '）：' + label, 50);
  const s = registerInput(loadState(), { id: inputId, via: isDoc ? 'doc' : 'event', title, file: rel(run.replyFiles[0]), dir: path.relative(DIR.data, dest).replace(/\\/g, '/'), names: allNames, eventDate: date, receivedAt: localIso(), meta });
  s.events = s.events || [];
  s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'input', title: isDoc ? '放入文件：' + clip(names, 30) : '記錄真實事件（' + dayText(date) + '）：' + clip(label, 30), relatedIds: [inputId], moduleIds: ['inputs', 'evidence'] });
  saveState(s);
  step(run, 'applied', U.stepReqRegistered, 'done', files.length ? `連同 ${files.length} 份證明文件` : '');
  if (!(s.milestones || []).length && !((s.company || {}).assumptions || []).length) { step(run, 'ai', U.stepEventAI, 'failed', U.eventNeedOverview); return finish(run, 'failed', U.eventNeedOverview); }
  const sb = newSandbox(run);
  const rows = attachmentRows(s.inputs.find(i => i.id === inputId));
  eventTask(sb, s, { text: text || '（沒有補充）', date, files: rows.map(r => r.abs), rows, ref: run.ref, pre, ...(isDoc ? { heading: '# 創辦人放入的文件（只按文件寫明、公司以外已發生的事擬確認題；文件沒有寫的不要推斷）' } : {}) });
  await runAIStep(run, sb, U.stepEventAI, true);
}
// 附件檔名清單：逐份列出（不能列資料夾的 AI 工具，例如 Antigravity，不用再猜檔名）
const fileListLines = names => names.map(n => `  - files/${n}`);
// 附件的顯示檔名：去掉收件時加的「編號-note-類型-file-序號-」前綴
const attachName = rel => path.basename(String(rel)).replace(/^.*?-note-(?:event|doc|adhoc|order)-file-\d+-/, '');
// 一件輸入的附件列表（路徑已轉絕對）：原檔、文字版（Office 轉文字或 Google 匯出）、Google 原連結及讀取日期
function attachmentRows(input) {
  const info = new Map(((input && input.fileInfo) || []).map(x => [x.file, x]));
  return ((input && input.files) || []).map(rel => {
    const x = info.get(rel) || {};
    return { name: attachName(rel), abs: path.join(DIR.data, rel), ...(x.text ? { textName: attachName(x.text), textAbs: path.join(DIR.data, x.text) } : {}), ...(x.url ? { url: x.url, readOn: x.readOn || '' } : {}) };
  });
}
// 複製進工作資料夾 files/，並回傳給 AI 的附件清單行（有文字版的註明，Google 附件註明原連結及讀取日期）
function writeAttachments(sb, rows) {
  if (!rows.length) return [];
  fs.mkdirSync(path.join(sb, 'files'), { recursive: true });
  const lines = [];
  for (const r of rows) {
    fs.copyFileSync(r.abs, path.join(sb, 'files', r.name));
    lines.push(`  - files/${r.name}`);
    if (r.textName && fs.existsSync(r.textAbs)) { fs.copyFileSync(r.textAbs, path.join(sb, 'files', r.textName)); lines.push('    - ' + NAMES.t('textSidecarNote', { f: 'files/' + r.textName })); }
    if (r.url) lines.push('    - ' + NAMES.t('googleNote', { u: r.url, d: dayText(r.readOn) }));
  }
  return lines;
}
function eventTask(sb, s, ev) {
  const rows = ev.rows || ev.files.map(f => ({ name: path.basename(f).slice((ev.pre || ev.ref + '-note-event-file-').length).replace(/^\d+-/, ''), abs: f }));
  const listing = writeAttachments(sb, rows);
  fs.writeFileSync(path.join(sb, 'event.md'), [ev.heading || '# 創辦人記錄的真實事件', '', `- 事件日期：${ev.date}`, `- 證明文件：${rows.length ? rows.length + ' 份（在 files/）' : '沒有'}`, ...listing, '', '## 創辦人原話', '', ev.text].join('\n') + '\n');
  writeJSON(path.join(sb, 'ledger.json'), {
    milestones: (s.milestones || []).filter(m => m.pathStatus !== 'retired').sort((a, b) => (a.order || 0) - (b.order || 0)).map(m => ({ id: m.id, name: m.short, event: m.event || '', witness: m.witness || '', proof: m.evidence || '', deliveryCondition: m.deliveryCondition || '', done: m.state === 'done' })),
    assumptions: ((s.company || {}).assumptions || []).map(a => ({ id: a.id, text: a.text, grade: a.grade || 'guess', cheapestTest: a.cheapestTest || '' })),
    nextExternalAction: (s.company || {}).nextExternalAction || null,
    // 人物及機構名單（只給名稱、別名、類別、機構、角色，用來避免重複建議；不含編號及任何聯絡方式）
    actors: (((s.company || {}).actors) || []).filter(x => x && !x.mergedInto).slice(0, 80).map(x => ({ name: x.name, aliases: x.aliases || [], kind: x.kind || '', ...(x.org ? { org: x.org } : {}), ...(x.role ? { role: x.role } : {}), status: x.status || 'active' }))
  });
  writeConfirmedPage(sb);
  fs.copyFileSync(path.join(ROOT, 'ai-event.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'event' });
}
// out/event.json 核對：每項只可指向帳本已有嘅假設（級別要變）或者未完成嘅站；最多三項（即時生效題每包最多三條）
function checkEvent(out, input = null, lenient = false) {
  const ev = readJSON(path.join(out, 'event.json'), null), s = loadState(), errors = [];
  // 新對象的名稱必須逐字出現在創辦人原話或附件文字版（event.md 的原話段、files/ 內的 md／txt／csv，含轉出的文字版）
  const sbDir = path.join(out, '..');
  let said0 = ''; try { said0 = fs.readFileSync(path.join(sbDir, 'event.md'), 'utf8').split('## 創辦人原話').pop(); } catch { }
  const fileTexts = []; try { for (const f of fs.readdirSync(path.join(sbDir, 'files'))) if (/\.(md|txt|csv)$/i.test(f)) fileTexts.push(fs.readFileSync(path.join(sbDir, 'files', f), 'utf8')); } catch { }
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
    if (it.kind === 'newActor') {
      if ((((s.peopleSync || {}).reasked) || {})[pnorm(it.name)] >= 2) { log(`真實事件建議的新對象已丟棄（已再問兩次）：${clip(it.name, 20)}`); return; }
      // 已答「不加入」兩次的名稱及創辦人本人（公司概覽「我自己（X）」）一律丟棄（設計狀態表第 5 行）
      const r = checkNewActorItem(it, { actors: (s.company || {}).actors || [], texts: [said0, ...fileTexts], at, declined: ((s.peopleSync || {}).declined) || {}, founderNames: founderNamesIn(peopleSyncG6(loadPage(), readJSON(CONFIRMED, null), s)) });
      if (r.status === 'drop') { log(`真實事件建議的新對象已丟棄（${({ full: '名單已滿', declined: '創辦人已答不加入', founder: '創辦人本人' })[r.reason] || '名稱已在名單內'}）：${clip(it.name, 20)}`); return; }
      // 新對象退回修正一次後仍不合格：只丟棄這一項，不令整件事失敗（lenient＝修正後的第二次核對）
      if (r.status === 'error') { if (lenient) { log(`真實事件建議的新對象修正後仍不合格，已丟棄：${clip(it.name, 20)}（${r.errors[0]}）`); return; } return errors.push(...r.errors); }
      const key = 'newActor:' + pnorm(r.item.name);
      if (seen.has(key)) return;
      seen.add(key); items.push({ ...r.item, id: key, ...(pnorm(said0).includes(pnorm(r.item.name)) ? {} : { fromDoc: true }) });
      return;
    }
    if (it.kind === 'followUp') {
      const key = 'followUp:' + it.date + ':' + String(it.action || '').trim();
      if (seen.has(key)) return;
      const bad = checkFollowUpItem(it, at, { eventDate: input && input.eventDate, milestones: s.milestones || [], styleIssues: NAMES.styleIssues });
      if (bad.length) return errors.push(...bad);
      if (!txt(it.why, 200)) return errors.push(at + '缺少理由 why（一句，最多 200 字）');
      seen.add(key); items.push({ kind: 'followUp', id: key, date: it.date, action: it.action.trim(), ...(it.station ? { station: it.station } : {}), why: it.why });
      return;
    }
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
    } else return errors.push(at + '：kind 必須是 assumption、milestone、nextAction、followUp 或 newActor');
    seen.add(it.kind + ':' + it.id); items.push(it);
  });
  // 未能讀取的附件：結構化清單（檔名必須是這次附件的檔名），摘要不再兼顧逐份列出
  let unreadable = [];
  if (ev.unreadable != null) {
    const delivered = (() => { try { return fs.readdirSync(path.join(out, '..', 'files')); } catch { return []; } })();
    if (!Array.isArray(ev.unreadable)) errors.push('unreadable 必須是清單（沒有未能讀取的附件就省略或寫空清單）');
    else ev.unreadable.forEach((x, i) => {
      const at = `unreadable 第 ${i + 1} 項`;
      if (!x || typeof x !== 'object' || typeof x.file !== 'string' || !x.file.trim()) return errors.push(at + '格式不正確（需要 file 檔名及 reason 原因）');
      const actual = matchDelivered(x.file, delivered);
      if (!actual) return errors.push(at + '：「' + x.file.slice(0, 60) + '」不是這次附件的檔名（file 只寫附件的檔名，不加 files/，也不可自行編造）');
      // 原因只保存作紀錄（畫面不顯示），與預填一致：太長就截斷並記警告，不因此判整份事件不合格
      if (x.reason != null && typeof x.reason !== 'string') return errors.push(at + '的 reason 必須是一句文字（最多 80 字）');
      const reason = String(x.reason || '').trim();
      if (reason.length > 80) log('真實事件的未能讀取原因超過 80 字，已截斷：' + actual.slice(0, 40));
      if (!unreadable.some(u => u.file === actual)) unreadable.push({ file: actual, reason: reason.slice(0, 80) });
    });
  }
  // 讀了甚麼（文件重點）、沒有確認題時的原因：創辦人看得到，要過口語／術語／編號檢查
  const delivered = (() => { try { return fs.readdirSync(path.join(out, '..', 'files')); } catch { return []; } })();
  const rd = checkRead(ev.read, { delivered, styleIssues: NAMES.styleIssues });
  errors.push(...rd.errors);
  const rs = checkReason(ev.reason, { styleIssues: NAMES.styleIssues });
  errors.push(...rs.errors);
  if (!items.length && !rs.reason && !rs.errors.length && !lenient) errors.push('沒有任何確認項目時，reason 必須填寫：一句講清楚為甚麼這件事沒有影響（最多 120 字）');
  if (errors.length) return { ok: false, errors };
  // 次序：假設 ＞ 站點 ＞ 新對象 ＞ 跟進日期 ＞ 下一個對外動作；每件事最多一個新對象；先排序再截三項
  const kept = orderEventItems(items);
  if (items.length > kept.length) log(`真實事件建議多過三項（或多於一個新對象），不問：${items.filter(x => !kept.includes(x)).map(x => x.kind + ':' + x.id).join('、')}`);

  return { ok: true, ev, items: kept, unreadable: unreadList(unreadable), read: rd.read, reason: rs.reason };
}
// 新對象確認題（真實事件及 Zero 整理名單共用）：二選項，或疑似變體時三選項；askKey 決定問句（這件事提到／公司概覽提到）
function newActorQuestion(s, it, i, askKey) {
  const kn = NAMES.dash['ppl_kind_' + it.actorKind], who = (it.org || '') + it.name + (it.role ? '（' + it.role + '）' : ''), me = pnorm(it.name);
  const sim = it.similarTo ? (((s.company || {}).actors) || []).find(a => a.id === it.similarTo) : null;
  const item = { name: it.name, ...(it.org ? { org: it.org } : {}), ...(it.role ? { role: it.role } : {}), actorKind: it.actorKind, ...(it.teamType ? { teamType: it.teamType } : {}), ...(it.fromDoc ? { fromDoc: true } : {}) };
  const add = { text: NAMES.t('newActorYes', { k: kn }), apply: { op: 'addActor', mode: 'add', item } }, no = { text: U.newActorNo, apply: { op: 'keep' } };
  let options;
  if (sim) {
    const alias = { text: NAMES.t('newActorAlias', { n: sim.name }), apply: { op: 'addActor', mode: 'alias', aliasOf: sim.id, item } }, other = { text: NAMES.t('newActorOther', { k: kn }), apply: { op: 'addActor', mode: 'add', item } };
    (nameKeys(sim).some(x => x !== me && (x.includes(me) || me.includes(x))) ? alias : other).rec = true;
    options = [alias, other, no];
  } else { add.rec = true; options = [add, no]; }
  return { id: 'q' + (i + 1), priority: i + 1, about: clip(it.name, 30), ask: mixSpace(NAMES.t(askKey, { who })), judge: NAMES.t('newActorSug', { k: kn }) + '。' + U.newActorSugNote + U.newActorJudge, kind: 'choice', effect: 'now', options, value: options.find(o => o.rec).text, why: clip(it.why, 200) };
}
// 名單類別名稱表（套用時寫入效果及事件用）
const kindTexts = () => ({ kind: Object.fromEntries(['customer', 'partner', 'investor', 'advisor', 'team'].map(k => [k, NAMES.dash['ppl_kind_' + k]])), added: U.peopleAdded, aliased: U.peopleAliased, skipped: U.peopleSkipped });

/* ---------- Zero 整理名單（people-sync）：讀已確認公司概覽及現有名單，建議加入團隊成員、顧問等及改舊類別；題目放待決事項，每包最多 3 題；
   狀態家 state.peopleSync（純函數在 people-ops.mjs；設計及狀態表見 docs/evidence/people-fix-2026-11-07/chain.md）。 ---------- */
const PEOPLE_SYNC_MAX = 3;
const openPeopleSync = () => listPacks(DIR).filter(p => p.open).map(p => loadPack(DIR, p.id)).find(p => p && p.peopleSync) || null;
// 已確認概覽的原文（逐字核對用）：confirmed.json 全部欄值、頁面每個項目的 label／value、里程碑決策者
function peopleSyncTexts(page, c, s) {
  const out = [];
  for (const v of Object.values((c && c.values) || {})) if (typeof v === 'string') out.push(v);
  (function walk(o) { if (!o || typeof o !== 'object') return; if (Array.isArray(o)) return o.forEach(walk); if (typeof o.label === 'string') out.push(o.label); if (typeof o.value === 'string') out.push(o.value); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); })(page);
  for (const m of (s && s.milestones) || []) if (m && m.actorName) out.push(String(m.actorName));
  for (const a of Object.values(((s && s.intake) || {}).answers || {})) if (a && typeof a.value === 'string') out.push(a.value);
  return out;
}
function peopleSyncG6(page, c, s) {
  const row = listOf(page && page.glance && page.glance.rows).find(r => r && r.plan === 'G6');
  const fromAns = (((s && s.intake) || {}).answers || {}).G6;
  return String(row ? ((c && c.values || {})[row.id] ?? row.value ?? '') : (fromAns && fromAns.value) || '').trim();
}
function placePeopleSyncBatch(s) {
  const ps = s.peopleSync || {}, actors = ((s.company || {}).actors || []).filter(Boolean), declined = ps.declined || {};
  // 擱置項目放出前重新核對：名字已在名單（含別名、已合併、不再接觸）或已答「不加入」的不再問；改類別對象已不在、類別已相同或已答「維持」的不再問
  const live = (ps.pending || []).filter(it => {
    if (!it) return false;
    const re = ps.reasked || {};
    if (it.kind === 'newActor') return !duplicateActor(actors, it.name) && !declined[pnorm(it.name)] && re[pnorm(it.name)] !== 2;
    const a = actors.find(x => x.id === it.id && !x.mergedInto); return !!a && kindOf(a) !== it.actorKind && !declined['kind:' + it.id + ':' + it.actorKind] && re['kind:' + it.id + ':' + it.actorKind] !== 2;
  });
  const items = live.slice(0, PEOPLE_SYNC_MAX), rest = live.slice(PEOPLE_SYNC_MAX);
  if (!items.length) { if ((ps.pending || []).length) { const s0 = loadState(); s0.peopleSync = { ...(s0.peopleSync || {}), pending: [] }; saveState(s0); } return null; }
  const kn = k => NAMES.dash['ppl_kind_' + k] || '';
  const qs = items.map((it, i) => {
    if (it.kind === 'newActor') return newActorQuestion(s, it, i, 'peopleSyncAsk');
    const yes = { text: NAMES.t('peopleSyncKindYes', { b: kn(it.actorKind) }), rec: true, apply: { op: 'fixKind', id: it.id, kind: it.actorKind, ...(it.role ? { role: it.role } : {}) } };
    return { id: 'q' + (i + 1), priority: i + 1, about: clip(it.name, 30), ask: mixSpace(NAMES.t('peopleSyncKindAsk', { n: it.name, a: kn(it.from), b: kn(it.actorKind) })), judge: U.peopleSyncKindJudge, kind: 'choice', effect: 'now',
      options: [yes, { text: NAMES.t('peopleSyncKindNo', { a: kn(it.from) }), apply: { op: 'keep' } }], value: yes.text, why: clip(it.why, 200) };
  });
  const placed = placePacks(DIR, [rhythmPack('ps', { title: U.peopleSyncTitle, context: U.peopleSyncContext, afterConfirm: U.peopleSyncAfter, todoType: 'decision', peopleSync: { key: ps.for || '' }, questions: qs })])[0];
  const s2 = loadState(); s2.peopleSync = { ...(s2.peopleSync || {}), pending: rest, packId: placed.id };
  s2.events = s2.events || []; s2.events.push({ id: 'e' + stamp() + '-' + s2.events.length, at: localIso(), actor: 'ai', type: 'brain', title: NAMES.t('peopleSyncDone', { n: qs.length }), relatedIds: [placed.id], moduleIds: ['ai-week', 'now'] });
  saveState(s2);
  log(`Zero 整理名單已出題：${placed.id}（${qs.length} 條，擱置 ${rest.length} 項）`);
  return placed;
}
// key：日常工作內用 'people'（同一 run 另有日常 AI 步驟）；創辦人按鍵觸發的獨立 run 用 'ai'（recordInboxRun 以 'ai' 步驟判斷 Zero 有沒有開工）
// 任何失敗：清 requested（畫面恢復按鈕並寫一句原因）、記 lastTry（同一概覽版本當日不再自動重試）；不留下一直重開 AI 的狀態
function peopleSyncFail(run, key, label, due, reason) {
  // 團隊頁的按鈕叫「請 Zero 整理名單」，AI 工具的通用原因句叫人按「重試」：換成本頁的按鈕名
  const why = clip(String(reason || U.peopleSyncFailed).replace(/\s+/g, ' ').replace(/再按一次「重試」/g, '再按「' + NAMES.dash.ppl_syncBtn + '」'), 80);
  const s = loadState(); s.peopleSync = { ...(s.peopleSync || {}), requested: false, lastTry: { key: due.key, day: todayIso(), reason: why } }; saveState(s);
  step(run, key, label, 'failed', why);
  log(`${run.id} Zero 整理名單未能完成：${why}`);
  return false;
}
async function peopleSyncStep(run, due, key = 'people') {
  const label = U.brainJob_people;
  if (due.due === 'batch') {
    const p = placePeopleSyncBatch(loadState());
    if (p) { step(run, key, label, 'done', NAMES.t('peopleSyncDone', { n: p.count })); run.result = { summary: NAMES.t('peopleSyncDone', { n: p.count }), artifacts: [], founderNext: [], asks: [p] }; return true; }
    // 擱置項目放出前全部失效（名字其間已在名單、已答不加入等）：名單沒有缺口，照「已核對」收尾，不是失敗
    log(`${run.id} 整理名單：擱置項目已全部失效，名單沒有缺口`);
    step(run, key, label, 'done', U.peopleSyncNone); run.result = { summary: U.peopleSyncNone, artifacts: [], founderNext: [] }; return true;
  }
  const cert = certified(ROOT, DIR.ledger);
  if (pausedNow()) return peopleSyncFail(run, key, label, due, U.skip_pausedByFounder);
  if (!cert.host) return peopleSyncFail(run, key, label, due, cert.reason);
  if (budgetLeft() <= 0) return peopleSyncFail(run, key, label, due, U.skip_budgetExhausted);
  let s = loadState();
  const page = loadPage(), c = readJSON(CONFIRMED, null);
  if (!page || !c) return peopleSyncFail(run, key, label, due, U.peopleSyncFailed);
  const sb = path.join(DIR.sandbox, run.id + '-people');
  fs.mkdirSync(path.join(sb, 'out'), { recursive: true });
  writeConfirmedPage(sb);
  const actors = ((s.company || {}).actors || []).filter(x => x && !x.mergedInto), ps = s.peopleSync || {}, declined = ps.declined || {};
  const g6 = peopleSyncG6(page, c, s), founderNames = founderNamesIn(g6);
  const decisionMakers = listOf(page.detail && page.detail.actors && page.detail.actors.items).map(it => `- ${it.label}：${String(((c.values || {})[it.id] ?? it.value) || '')}`);
  fs.writeFileSync(path.join(sb, 'people.md'), ['# 整理名單的材料', '', '## 已有人負責的事（公司概覽 G6 原文）', '', g6 || '（沒有填寫）', '', '## 公司以外的決策者（公司概覽原文）', '', ...(decisionMakers.length ? decisionMakers : ['（沒有）']), '',
    '## 各站要點頭的人（公司概覽原文）', '', ...((s.milestones || []).filter(m => m && m.actorName).map(m => `- ${m.short}：${m.actorName}`) || []), '',
    '## 現有名單', '', ...(actors.length ? actors.map(a => `- ${a.name}（${NAMES.dash['ppl_kind_' + kindOf(a)] || ''}${a.org ? '；' + a.org : ''}${a.role ? '；' + a.role : ''}${a.addedFrom ? '' : '；類別未經核對'}）`) : ['（沒有）']), '',
    '## 創辦人已答「不加入」的名稱（不要再建議）', '', ...(Object.keys(declined).filter(k => !k.startsWith('kind:')).length ? Object.keys(declined).filter(k => !k.startsWith('kind:')).map(k => '- ' + k) : ['（沒有）']), ''].join('\n'));
  writeJSON(path.join(sb, 'ledger.json'), { actors: actors.slice(0, 80).map(x => ({ name: x.name, aliases: x.aliases || [], kind: kindOf(x), ...(x.org ? { org: x.org } : {}), ...(x.role ? { role: x.role } : {}), unverifiedKind: !x.addedFrom })),
    milestones: (s.milestones || []).filter(m => m && m.pathStatus !== 'retired').map(m => ({ id: m.id, name: m.short, actor: m.actorName || '' })) });
  fs.copyFileSync(path.join(ROOT, 'ai-people.md'), path.join(sb, 'task.md'));
  writeJSON(path.join(sb, 'job.json'), { type: 'people-sync' });
  step(run, key, label, 'running', 'Zero 處理中');
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (!r.ok || r.waiting) return peopleSyncFail(run, key, label, due, r.reason || U.peopleSyncFailed);
  const texts = peopleSyncTexts(page, c, s), opts = { actors: (s.company || {}).actors || [], texts, declined, founderNames, reasked: ps.reasked || {} };
  let chk = checkPeopleSync(readJSON(path.join(sb, 'out', 'people.json'), null), opts);
  if (!chk.ok) {
    log(`${run.id} 整理名單建議格式唔啱：${chk.errors.join('；')}；叫 AI 修正一次`);
    writeJSON(path.join(sb, 'job.json'), { type: 'people-sync-repair', errors: chk.errors });
    fs.writeFileSync(path.join(sb, 'task.md'), ['# 你今次嘅工作：修正整理名單建議', '', '你啱啱寫嘅 `out/people.json` 有以下問題，請照 `ai-people.md` 嘅格式改好，其他項目唔好改：', '', ...chk.errors.map((e, i) => `${i + 1}. ${e}`), '', '改完覆寫 `out/people.json`。只可以寫 `out/`。'].join('\n') + '\n');
    fs.copyFileSync(path.join(ROOT, 'ai-people.md'), path.join(sb, 'ai-people.md'));
    const r2 = await runAI(sb);
    if (r2.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r2.meta.total_cost_usd || 0);
    chk = checkPeopleSync(readJSON(path.join(sb, 'out', 'people.json'), null), { ...opts, lenient: true });
  }
  if (!chk.ok) return peopleSyncFail(run, key, label, due, U.peopleSyncFailed);
  for (const d of chk.dropped) log(`${run.id} 整理名單建議已丟棄（${d.reason}）：${clip(d.name, 20)}`);
  s = loadState();
  { const { lastTry, ...rest } = s.peopleSync || {}; s.peopleSync = { ...rest, for: due.key, at: localIso(), requested: false, pending: chk.items, declined: rest.declined || {} }; }
  if (!chk.items.length) {
    s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'ai', type: 'brain', title: U.peopleSyncNone, relatedIds: [], moduleIds: ['ai-week'] });
    saveState(s); step(run, key, label, 'done', U.peopleSyncNone); run.result = { summary: U.peopleSyncNone, artifacts: [], founderNext: [] }; return true;
  }
  saveState(s);
  const placed = placePeopleSyncBatch(loadState());
  step(run, key, label, 'done', NAMES.t('peopleSyncDone', { n: placed.count }));
  run.result = { summary: NAMES.t('peopleSyncDone', { n: placed.count }), artifacts: [], founderNext: [], asks: [placed] };
  return true;
}
// 自訂答案（答案不在選項內）：不算「不加入」／「維持」。同一項第一次：記下原話、放回擱置清單，下一批再問一次；第二次仍是自訂答案：記下原話，不再問。回傳要顯示的一句。
function customAnswered(s, ps, key, item, name, words) {
  ps.reasked = ps.reasked || {};
  const w = clip(String(words == null ? '' : words).replace(/\s+/g, ' ').trim(), 40);
  if (ps.reasked[key] || !item) { ps.reasked[key] = 2; return mixSpace(NAMES.t('peopleCustomClosed', { n: clip(name, 20), s: w })); }
  ps.reasked[key] = 1;
  ps.pending = Array.isArray(ps.pending) ? ps.pending : [];
  if (!ps.pending.some(x => x && (item.kind === 'newActor' ? x.kind === 'newActor' && pnorm(x.name) === key : x.kind === 'actorKind' && ('kind:' + x.id + ':' + x.actorKind) === key))) ps.pending.push(item);
  return mixSpace(NAMES.t('peopleCustomAsked', { n: clip(name, 20), s: w }));
}
// 你回答整理名單的題：加入名單／記為別名才寫；「不加入」記入 declined（之後不再建議同名）；改類別答「改為」才改；同一題不套用兩次；答齊而仍有擱置項目就放下一包
function handlePeopleSyncAnswer(run, pack, store) {
  const s = loadState(); s.peopleSync = s.peopleSync || {}; const ps = s.peopleSync; ps.applied = ps.applied || {}; ps.declined = ps.declined || {};
  const done = new Set(ps.applied[pack.id] || []), said = [], tx = kindTexts();
  s.events = s.events || [];
  const ev = (title, ids) => s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'decision', title, relatedIds: ids, moduleIds: ['now', 'inputs'] });
  for (const q of pack.questions) {
    const a = store.answers[q.id];
    if (!a || done.has(q.id)) continue;
    done.add(q.id);
    const opts = q.options || [], opt = opts.find(o => o.text === a.value), ap = opt ? opt.apply : null;
    const na = opts.find(o => o.apply && o.apply.op === 'addActor');
    if (na) {
      const sel = ap && ap.op === 'addActor' ? ap : null, it = { kind: 'newActor', ...na.apply.item };
      const before = JSON.stringify((s.company || {}).actors || []);
      mergeInPlace(s, applyNewActor(s, { inputId: pack.id, qid: q.id, item: it, answer: sel ? sel.mode : 'skip', aliasOf: sel && sel.aliasOf, today: todayIso(), now: localIso(), addedFrom: 'overview', t: tx }));
      if (!sel && !opt) { // 自訂答案（不在選項內）不是拒絕：記下原話，這一項留待下一批再問（只問一次）
        const sim = opts.find(o => o.apply && o.apply.op === 'addActor' && o.apply.mode === 'alias');
        const t = customAnswered(s, ps, pnorm(it.name), { ...it, why: q.why, ...(sim ? { similarTo: sim.apply.aliasOf } : {}) }, it.name, a.value);
        ev(t, [pack.id]); said.push(t); continue;
      }
      if (!sel) { ps.declined[pnorm(it.name)] = (ps.declined[pnorm(it.name)] || 0) + 1; said.push(mixSpace(NAMES.t('peopleSkipped', { n: it.name }))); continue; }
      // 名字其間已在名單（答題前另一條路加入了）：純函數原樣返回，不寫「已加入名單」事件
      if (before === JSON.stringify((s.company || {}).actors || [])) { log(`${run.id} 整理名單：「${clip(it.name, 20)}」已在名單，沒有再加入`); continue; }
      const t = mixSpace(sel.mode === 'alias' ? NAMES.t('peopleAliased', { n: ((s.company.actors || []).find(x => x.id === sel.aliasOf) || {}).name || '' }) : NAMES.t('peopleAdded', { n: it.name, k: tx.kind[it.actorKind] }));
      // 事件只連問題包，不連對象編號：加入名單或改類別不是與他的「接觸」（peopleView 以創辦人事件的 relatedIds 計最近接觸）
      ev(t, [pack.id]); said.push(t);
      continue;
    }
    const kf = opts.find(o => o.apply && o.apply.op === 'fixKind');
    if (!kf) continue;
    if (ap && ap.op === 'fixKind') {
      const next = applyKindFix(s, ap);
      if (next !== s) { mergeInPlace(s, next); const t = mixSpace(NAMES.t('actorKinded', { n: clip(q.about, 20), k: tx.kind[ap.kind] })); ev(t, [pack.id]); said.push(t); }
    } else if (!opt) { // 自訂答案：不算「維持」，記下原話，留待下一批再問一次
      const act = ((s.company || {}).actors || []).find(x => x && x.id === kf.apply.id);
      const t = customAnswered(s, ps, 'kind:' + kf.apply.id + ':' + kf.apply.kind, act ? { kind: 'actorKind', id: act.id, name: act.name, from: kindOf(act), actorKind: kf.apply.kind, ...(kf.apply.role ? { role: kf.apply.role } : {}), why: q.why } : null, q.about, a.value);
      ev(t, [pack.id]); said.push(t);
    } else { ps.declined['kind:' + kf.apply.id + ':' + kf.apply.kind] = 1; said.push(NAMES.t('peopleKindKept', { n: clip(q.about, 20) })); }
  }
  ps.applied[pack.id] = [...done];
  const allAnswered = pack.questions.every(q => store.answers[q.id]);
  if (allAnswered && ps.packId === pack.id) ps.packId = '';
  saveState(s);
  let placed = null;
  if (allAnswered && (ps.pending || []).length) placed = placePeopleSyncBatch(loadState());
  run.result = { summary: said.join('；') || U.peopleSyncNoted, artifacts: [], founderNext: [], ...(placed ? { asks: [placed] } : {}) };
  step(run, 'applied', U.stepAppliedAns, 'done', said.join('；') || U.peopleSyncNoted);
  return finish(run, 'done');
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
    if (it.kind === 'newActor') return newActorQuestion(s, it, i, 'newActorAsk');
    if (it.kind === 'followUp') {
      return { id: 'q' + (i + 1), priority: i + 1, about: clip(it.action, 40), ask: NAMES.t('followUpAsk', { d: dayText(it.date), a: it.action }), judge: U.followUpJudge, kind: 'choice', effect: 'now',
        options: [{ text: U.followUpYes, rec: true, apply: { op: 'addFollowUp', date: it.date, action: it.action, station: it.station || '' } }, { text: U.followUpNo, apply: { op: 'keep' } }], value: U.followUpYes, why: it.why };
    }
    const m = s.milestones.find(x => x.id === it.id);
    return { id: 'q' + (i + 1), priority: i + 1, about: m.short, ask: '「' + m.short + '」這一站是否已經完成？', judge: NAMES.t('msJudge', { c: String(m.deliveryCondition || m.event || m.short).trim().replace(/[。.]+$/, '') }), kind: 'choice', effect: 'now',
      options: [{ text: U.msDoneYes, rec: true, apply: { op: 'markDone', id: m.id } }, { text: U.msDoneNo, apply: { op: 'keep', id: m.id } }], value: U.msDoneYes, why: it.why };
  });
  const iv = input.kind === 'interview';
  return { format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-ev', title: (iv ? U.interviewConfirm : U.eventConfirm) + '（' + dayText(input.eventDate) + '）',
    context: iv ? NAMES.t('interviewSaid', { d: dayText(input.eventDate), t: clip(input.title.replace(/^[^：]*：/, ''), 80) }) : '你記錄了 ' + dayText(input.eventDate) + ' 發生的一件事：「' + clip(input.title.replace(/^(?:真實事件|發生了一件事)（[^）]*）：/, ''), 80) + '」。Zero 據此擬定以下更新，每項經你確認後才會生效。',
    afterConfirm: '確認的項目即時更新公司紀錄及 CrewZero', next: null, askedBy: 'AI', askedAt: localIso(), fromRun: run.id, todoType: 'decision', realEvent: { inputId: input.id, date: input.eventDate }, questions: qs };
}
async function finishEvent(run, sb, label, styleWarnings) {
  const out = path.join(sb, 'out');
  const input0 = (loadState().inputs || []).find(i => i.id === 'in-' + run.ref) || null;
  let chk = checkEvent(out, input0);
  if (!chk.ok) {
    log(`${run.id} 真實事件建議格式唔啱：${chk.errors.join('；')}；叫 AI 修正一次`);
    writeJSON(path.join(sb, 'job.json'), { type: 'event-repair', errors: chk.errors });
    fs.writeFileSync(path.join(sb, 'task.md'), ['# 你今次嘅工作：修正真實事件建議', '', '你啱啱寫嘅 `out/event.json` 有以下問題，請照 `ai-event.md` 嘅格式改好，其他內容唔好改：', '',
      ...chk.errors.map((e, i) => `${i + 1}. ${e}`), '', '可以用嘅假設同站喺 `ledger.json`。改完覆寫 `out/event.json`。只可以寫 `out/`。'].join('\n') + '\n');
    fs.copyFileSync(path.join(ROOT, 'ai-event.md'), path.join(sb, 'ai-event.md'));
    const r = await runAI(sb);
    if (r.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r.meta.total_cost_usd || 0);
    chk = r.ok ? checkEvent(out, input0, true) : chk;
  }
  let s = loadState();
  let input = (s.inputs || []).find(i => i.id === 'in-' + run.ref);
  if (!chk.ok || !input) { step(run, 'ai', label, 'failed', U.eventFailed); return finish(run, 'failed', U.eventFailed); }
  if (Object.hasOwn(chk.ev, 'personaUpdate')) { delete chk.ev.personaUpdate; writeJSON(path.join(out, 'event.json'), chk.ev); }
  fs.cpSync(out, path.join(DIR.work, run.id), { recursive: true });
  writeJSON(path.join(DIR.work, run.id, 'run.json'), { id: run.id, kind: run.kind, ref: run.ref, label, startedAt: run.startedAt, aiCost: run.aiCost || null });
  // 讀了甚麼、文件重點、沒有影響的原因：由 Zero 交回、外殼核對後存入這件輸入（recordReading 純函數）
  s = recordReading(s, input.id, { summary: chk.ev.summary, grade: chk.ev.grade, unreadable: chk.unreadable, read: chk.read, reason: chk.reason });
  input = s.inputs.find(i => i.id === 'in-' + run.ref);
  const unread = chk.unreadable.length ? { unreadable: chk.unreadable } : {};
  // 會後紀錄的跟進日期走同一條路：創辦人寫了日期而 Zero 沒有同日的跟進建議，外殼補一條跟進題（仍要創辦人確認才入日程）
  const hint = input.followUpHint;
  let items = chk.items;
  if (hint && /^\d{4}-\d{2}-\d{2}$/.test(String(hint.date || '')) && (!input.eventDate || hint.date >= input.eventDate)) {
    const act = NAMES.t('followUpDebrief', { n: hint.who || '對方' });
    items = orderEventItems(items.filter(x => x.kind !== 'followUp' || x.date !== hint.date).concat([{ kind: 'followUp', id: 'followUp:' + hint.date + ':' + act, date: hint.date, action: act, why: U.followUpDebriefWhy }]));
  }
  if (!items.length) {
    input.status = 'processed'; input.processedAt = localIso(); saveState(s);
    run.result = { summary: input.summary + ' ' + U.eventNoChange, artifacts: [], founderNext: [], styleWarnings, ...unread };
    step(run, 'ai', label, 'done', U.eventNoChange); return finish(run, 'done');
  }
  const pack = eventPack(run, s, input, items);
  const placed = placePacks(DIR, [pack]);
  input.status = 'awaitingFounder'; input.awaitingFounderText = U.eventAwaiting; input.packId = placed[0].id;
  saveState(s);
  run.result = { summary: input.summary, artifacts: [], founderNext: [], asks: placed, styleWarnings, ...unread };
  step(run, 'ai', label, 'done', `已擬定 ${placed[0].count} 條確認問題，等你確認`);
  finish(run, 'done');
}
// 你確認真實事件：只套用答咗嘅即時生效題（未答嘅留低等你）；同一題唔會套用兩次
function handleEventConfirm(run, pack, store) {
  const s = loadState();
  let input = (s.inputs || []).find(i => i.id === pack.realEvent.inputId);
  // 帳本寫入走 ledger-ops 的純函數（回傳新狀態），這裏把結果放回 s 並重新取得 input
  const sync = next => { mergeInPlace(s, next); input = (s.inputs || []).find(i => i.id === pack.realEvent.inputId); };
  if (!input) { run.result = { summary: '已記錄你的答案；找不到這件事的紀錄。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const applied = new Set(input.appliedQids || []), date = pack.realEvent.date, said = [], doneIds = [], celebrations = [];
  const replyAt = replySubmittedAt(run, Object.values(store.answers || {})[0]);
  let keptNewerFounderAction = false;
  const keepNewerFounderAction = action => {
    if (!founderUpdatedAfter(action, replyAt)) return false;
    if (!keptNewerFounderAction) said.push(U.founderNewerNext);
    keptNewerFounderAction = true;
    return true;
  };
  let nextSet = false;
  input.effects = input.effects || []; s.events = s.events || [];
  const ev = (type, title, relatedIds, moduleIds) => s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type, title, relatedIds, moduleIds });
  for (const q of pack.questions) {
    const a = store.answers[q.id];
    if (!a || applied.has(q.id)) continue;
    applied.add(q.id);
    const opts = q.options || [], opt = opts.find(o => o.text === a.value);
    let ap = opt ? opt.apply : null;
    const naOpt = opts.find(o => o.apply && o.apply.op === 'addActor');
    if (naOpt) {
      // 新對象題：加入名單／記為別名才寫；其他答案（不加入、自訂）只記「沒有加入名單」。同一題做兩次不重複（編號由輸入＋題號決定）
      const sel = opt && opt.apply && opt.apply.op === 'addActor' ? opt.apply : null, it = { kind: 'newActor', ...naOpt.apply.item };
      const tx = { kind: Object.fromEntries(['customer', 'partner', 'investor', 'advisor', 'team'].map(k => [k, NAMES.dash['ppl_kind_' + k]])), added: U.peopleAdded, aliased: U.peopleAliased, skipped: U.peopleSkipped };
      sync(applyNewActor(s, { inputId: input.id, qid: q.id, item: it, answer: sel ? sel.mode : 'skip', aliasOf: sel && sel.aliasOf, today: todayIso(), now: localIso(), addedFrom: input.source === 'chat' ? 'chat' : it.fromDoc ? 'doc' : 'event', t: tx }));
      // 答「不加入」：計一次（同一名稱兩次後不再建議；整理名單一次即止）
      // 自訂答案（不在選項內）不是「不加入」：照整理名單同一做法，記下原話並留待再問一次（只問一次）
      if (!sel && !opt) { s.peopleSync = s.peopleSync || {}; const sim = opts.find(o => o.apply && o.apply.op === 'addActor' && o.apply.mode === 'alias'); const t = customAnswered(s, s.peopleSync, pnorm(it.name), { ...it, why: q.why, ...(sim ? { similarTo: sim.apply.aliasOf } : {}) }, it.name, a.value); ev('input', t, [input.id], ['now', 'inputs']); said.push(t); continue; }
      if (!sel) { s.peopleSync = s.peopleSync || {}; s.peopleSync.declined = { ...(s.peopleSync.declined || {}) }; s.peopleSync.declined[pnorm(it.name)] = (s.peopleSync.declined[pnorm(it.name)] || 0) + 1; }
      if (sel) { const t = mixSpace(sel.mode === 'alias' ? NAMES.t('peopleAliased', { n: ((s.company.actors || []).find(a => a.id === sel.aliasOf) || {}).name || '' }) : NAMES.t('peopleAdded', { n: it.name, k: tx.kind[it.actorKind] })); ev('input', t, [input.id], ['now', 'inputs']); said.push(t); }
      continue;
    }
    const fuOpt = opts.find(o => o.apply && o.apply.op === 'addFollowUp');
    if (fuOpt) {
      // 跟進日期題：答「加入日程」才寫一項創辦人行動（日程清單及月曆自動顯示）；其他答案只記「沒有加入」。同一題做兩次不重複（任務編號固定）
      const accepted = !!opt && opt === fuOpt;
      sync(applyFollowUp(s, { inputId: input.id, qid: q.id, answer: accepted ? 'accept' : 'reject', item: { date: fuOpt.apply.date, action: fuOpt.apply.action, station: fuOpt.apply.station, why: q.why }, now: localIso() }));
      if (accepted) { const t = '已加入日程：' + dayText(fuOpt.apply.date) + '　' + clip(fuOpt.apply.action, 40); ev('input', t, [followUpTaskId(input.id, q.id), input.id], ['now', 'inputs']); said.push(t); }
      continue;
    }
    // 自訂答案：證據級題寫咗一個級別名稱就照套用；其餘只記錄
    if (!opt && opts[0] && opts[0].apply.op === 'setAssumptionGrade') { const k = NAMES.evKey(String(a.value).replace(/^(?:改為|維持)/, '').replace(/[「」\s]/g, '')); ap = k ? { op: 'setAssumptionGrade', id: opts[0].apply.id, grade: k } : null; }
    if (ap && ap.op === 'setAssumptionGrade') {
      const as = ((s.company || {}).assumptions || []).find(x => x.id === ap.id);
      if (!as) continue;
      const from = as.grade || 'guess';
      if (from === ap.grade) { sync(addEffect(s, input.id, { targetKind: 'assumption', targetId: as.id, change: '「' + clip(as.text, 30) + '」維持「' + NAMES.evName(from) + '」' })); continue; }
      if (EV_RANK(ap.grade) > EV_RANK(from)) noteCelebration(s, { assumption: as, from, grade: ap.grade, batch: celebrations });
      as.grade = ap.grade; as.sourceId = input.id; as.changedAt = date; ADVANCED = true;
      as.status = EV_RANK(ap.grade) < EV_RANK(from) ? 'weakened' : EV_RANK(ap.grade) >= 2 ? 'supported' : 'open';
      const t = '「' + clip(as.text, 30) + '」由「' + NAMES.evName(from) + '」改為「' + NAMES.evName(ap.grade) + '」';
      sync(addEffect(s, input.id, { targetKind: 'assumption', targetId: as.id, change: t, before: NAMES.evName(from), after: NAMES.evName(ap.grade) }));
      ev('input', '證據級更新：' + t, [as.id, input.id], ['evidence', 'inputs']); said.push(t);
    } else if (ap && ap.op === 'markDone') {
      const m = (s.milestones || []).find(x => x.id === ap.id);
      if (!m || m.state === 'done') continue;
      noteCelebration(s, { milestone: m, batch: celebrations });
      m.state = 'done'; m.doneAt = date; m.doneEvidence = [input.file, ...(input.files || [])].filter(Boolean); m.doneInputId = input.id; m.doneCounterpartIds = deriveActors(loadPage(), s.milestones || [], (s.company || {}).actors || []).filter(a => (a.fromMilestoneIds || []).includes(m.id)).map(a => a.id); doneIds.push(m.id); ADVANCED = true;
      const t = '站點「' + m.short + '」已完成（' + dayText(date) + '，經你確認）';
      sync(addEffect(s, input.id, { targetKind: 'decision', targetId: pack.id, change: t, before: U.fxMsBefore, after: NAMES.t('fxMsAfter', { d: dayText(date) }) }));
      ev('milestone', '站點完成：' + m.short + '（' + dayText(date) + '）', [m.id, input.id], ['now', 'paths', 'evidence']); said.push(t);
    } else if (ap && ap.op === 'setNextExternalAction') {
      if (keepNewerFounderAction((s.company || {}).nextExternalAction)) { nextSet = true; continue; }
      s.company = s.company || {};
      const prevNext = (s.company.nextExternalAction || {}).text;
      s.company.nextExternalAction = { text: ap.text, milestoneId: ap.milestoneId || '' }; nextSet = true;
      const t = '下一個對外動作改為：' + clip(ap.text, 40);
      sync(addEffect(s, input.id, { targetKind: 'decision', targetId: pack.id, change: t, before: prevNext ? clip(prevNext, 60) : U.fxNextNone, after: clip(ap.text, 60) }));
      ev('decision', t, [input.id].concat(ap.milestoneId ? [ap.milestoneId] : []), ['now', 'paths']); said.push(t);
    } else input.effects.push({ targetKind: 'decision', targetId: pack.id, change: '「' + clip(q.about || q.ask, 30) + '」維持不變' });
  }
  // 站點完成後（3.3，唯一定義處）：下一站自動進行中；小旗掛喺完成咗嘅站，就喺同一份確認加一題「下一個對外動作」，你答咗小旗先移，未答標「待更新」
  if (doneIds.length) {
    ensureActive(s.milestones);
    const nea = (s.company || {}).nextExternalAction;
    const askedNext = pack.questions.some(q => q.id === 'nad' || ((q.options || []).some(o => o.apply && o.apply.op === 'setNextExternalAction') && !store.answers[q.id]));
    if (nea && doneIds.includes(nea.milestoneId) && !nextSet && !askedNext && !keepNewerFounderAction(nea)) {
      const conf = s.milestones.filter(m => m.pathStatus === 'confirmed' && m.state !== 'done').sort((a, b) => (a.order || 0) - (b.order || 0));
      const nx = conf.find(m => m.state === 'active') || conf[0], m0 = s.milestones.find(m => m.id === nea.milestoneId);
      const sug = nx ? clip(String(nx.event || nx.short).trim(), 100) : '';
      const nextQuestion = { id: 'nad', priority: pack.questions.length + 1, about: U.nextActionAsk, ask: NAMES.t('nextAfterDone', { s: m0.short }), kind: 'choice', effect: 'now',
        options: (sug ? [{ text: sug, rec: true, apply: { op: 'setNextExternalAction', text: sug, milestoneId: nx.id } }] : []).concat([{ text: U.unknownLater, ...(sug ? {} : { rec: true }), apply: { op: 'keep' } }]),
        value: sug || U.unknownLater, why: U.nextAfterDoneWhy + (sug ? '建議按「' + nx.short + '」這一站要發生的事填寫。' : '') };
      if (pack.questions.length < 3) { pack.questions.push(nextQuestion); writeJSON(path.join(DIR.asks, pack.id + '.json'), pack); }
      else input.pendingNextQuestion = nextQuestion;
      s.company.nextExternalAction = { ...nea, pendingUpdate: true };
      said.push('下一站「' + (nx ? nx.short : '') + '」已開始；下一個對外動作待你確認');
    }
  }
  input.appliedQids = [...applied];
  const left = pack.questions.filter(q => !store.answers[q.id]).length;
  input.status = left ? 'awaitingFounder' : 'processed';
  if (!left) {
    input.processedAt = localIso(); delete input.awaitingFounderText;
    if (input.pendingNextQuestion) {
      const next = eventPack(run, s, input, []);
      next.questions.push(input.pendingNextQuestion); delete input.pendingNextQuestion;
      const placed = placePacks(DIR, [next]);
      input.status = 'awaitingFounder'; input.packId = placed[0].id; input.awaitingFounderText = U.eventAwaiting; delete input.processedAt;
    }
  }
  finishCelebration(s, celebrations);
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
// 告訴 Zero／由文件預填的收件說明檔（<編號>-meta-intake.json／-meta-prefill.json）：沒有就當舊格式
function takeMeta(id, kind) {
  const name = `${id}-meta-${kind}.json`;
  return fs.existsSync(path.join(DIR.inbox, name)) ? { name, meta: cleanMeta(readJSON(path.join(DIR.inbox, name), null)) } : { name, meta: null };
}
// files.md 的清單行：文字版不單獨列出，附在原檔下一行；Google 附件註明原連結及讀取日期
function storedFileLines(files, pre, meta) {
  const side = new Set(((meta && meta.fileInfo) || []).map(x => x.text).filter(Boolean)), info = new Map(((meta && meta.fileInfo) || []).map(x => [x.name, x]));
  const bare = f => f.slice(pre.length).replace(/^\d+-/, '');
  return files.filter(f => !side.has(f)).flatMap(f => {
    const x = info.get(f) || {}, out = [`  - files/${bare(f)}`];
    if (x.text) out.push('    - ' + NAMES.t('textSidecarNote', { f: 'files/' + bare(x.text) }));
    if (x.url) out.push('    - ' + NAMES.t('googleNote', { u: x.url, d: dayText(x.readOn) }));
    return out;
  });
}
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
  const mi = takeMeta(id, 'intake');
  if (files.length) fs.writeFileSync(path.join(sb, 'files.md'), ['# 文件清單（在 files/）', '', ...storedFileLines(files, id + '-intake-', mi.meta)].join('\n') + '\n');
  // 收件匣唔可以越積越亂：登記完即搬去封存
  const now = clockNow(), dest = path.join(DIR.archive, `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, 'intake-' + id);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of [file, ...files, ...(mi.meta ? [mi.name] : [])]) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
  step(run, 'applied', U.stepIntakeRegistered, 'done', files.length ? `${files.length} 份文件` : '沒有附件');
  intakeTask(sb);
  await runAIStep(run, sb, U.stepIntakeAI, true);
}

/* ---------- 由文件預填（規劃書 3.1）：AI 只讀文件交返八條預填；外殼逐字核對原句、寫入 ledger/prefill/<id>.json；唔擬公司概覽、唔建任何紀錄 ---------- */
async function handlePrefill(run, file) {
  run.kind = 'prefill';
  const id = file.replace(/-prefill\.md$/, '');
  run.ref = id; run.replyFiles = [file];
  step(run, 'received', U.stepPrefillReceived, 'done', '');
  const prefill = parseFounderReply(fs.readFileSync(path.join(DIR.inbox, file), 'utf8')).machine || {};
  const selectedBiz = bizInfo({ type: prefill.bizType, other: prefill.bizOther }) || businessType();
  const sb = newSandbox(run, selectedBiz), files = fs.readdirSync(DIR.inbox).filter(f => f.startsWith(id + '-prefill-')).sort();
  fs.mkdirSync(path.join(sb, 'files'), { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(DIR.inbox, f), path.join(sb, 'files', f.slice((id + '-prefill-').length).replace(/^\d+-/, '')));
  const mp = takeMeta(id, 'prefill');
  if (files.length) fs.writeFileSync(path.join(sb, 'files.md'), ['# 文件清單（在 files/）', '', ...storedFileLines(files, id + '-prefill-', mp.meta)].join('\n') + '\n');
  // 收件匣唔可以越積越亂：登記完即搬去封存（掃描工具之後照呢份文件核對）
  const now = clockNow(), dest = path.join(DIR.archive, `${now.getFullYear()}-${pad(now.getMonth() + 1)}`, 'prefill-' + id);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of [file, ...files, ...(mp.meta ? [mp.name] : [])]) fs.renameSync(path.join(DIR.inbox, f), path.join(dest, f));
  writeJSON(path.join(sb, 'questions.json'), intakeQuestions((selectedBiz || {}).type).map(q => ({ id: 'q' + q.n, ask: q.ask, hint: q.hint })));
  datedTask(sb, 'ai-prefill.md');
  writeJSON(path.join(sb, 'job.json'), { type: 'prefill', today: todayIso() });
  step(run, 'applied', U.stepPrefillRegistered, 'done', files.length + ' 份文件');
  await runAIStep(run, sb, U.stepPrefillAI, true);
}
// 未能讀取的檔案清單：沒有寫原因的補上預設原因（用字在 names.js）
const unreadList = xs => (xs || []).map(x => ({ file: x.file, reason: x.reason || NAMES.unreadReason(x.file) }));
function finishPrefill(run, sb, label) {
  const raw = readJSON(path.join(sb, 'out', 'prefill.json'), null);
  const chk = checkPrefill(raw, docTexts(path.join(sb, 'files')));
  if (!chk.ok) { step(run, 'ai', label, 'failed', U.prefillBad); return finish(run, 'failed', U.prefillBad); }
  for (const w of chk.warnings) log(`${run.id} 預填：${w}`);
  // 未能讀取的檔案（例如 Word、PowerPoint、Excel）：單獨記錄，不算「文件未有」；全部文件都讀不到時不採用任何預填答案
  const files = fs.readdirSync(path.join(sb, 'files')), unreadable = unreadList(chk.unreadable);
  const allUnread = files.length > 0 && files.every(f => unreadable.some(u => u.file === f));
  if (allUnread && Object.keys(chk.answers).length) { log(`${run.id} 預填：所有文件都未能讀取，丟棄 ${Object.keys(chk.answers).length} 條不可能出自文件的答案`); chk.answers = {}; }
  const rec = { id: run.ref, at: localIso(), files, answers: chk.answers, missing: PREFILL_Q.filter(q => !chk.answers[q]), runId: run.id, ...(unreadable.length ? { unreadable } : {}), ...(allUnread ? { allUnread: true } : {}) };
  fs.mkdirSync(path.join(DIR.ledger, 'prefill'), { recursive: true });
  writeJSON(path.join(DIR.ledger, 'prefill', run.ref + '.json'), rec);
  const n = k => Object.values(chk.answers).filter(a => a.label === k).length, sumArgs = { n: Object.keys(chk.answers).length, a: n('quote'), b: n('inferred'), c: n('unverified'), d: rec.missing.length, u: unreadable.length };
  run.result = { summary: allUnread ? U.prefillAllUnread : unreadable.length ? NAMES.t('prefillDoneUnreadSum', sumArgs) : NAMES.t('prefillDoneSum', sumArgs), artifacts: [], founderNext: [], ...(unreadable.length ? { unreadable } : {}) };
  step(run, 'ai', label, 'done', run.result.summary);
  return finish(run, 'done');
}
/* ---------- 陪創辦人想：三份問題包，然後沿用八題預填 ---------- */
// 每次讀回才更新，避免 AI 等候期間交資料已把流程關閉，卻被舊結果重開。
function updateIdeate(s, patch, recordClosed = false) {
  const current = readJSON(IDEATE, null);
  if (!current || current.id !== s.id || current.state === 'closed' && !recordClosed) return null;
  const next = { ...current, ...patch, ...(current.state === 'closed' ? { state: 'closed' } : {}), updatedAt: localIso() };
  writeJSON(IDEATE, next);
  return next;
}
async function handleIdeate(run) {
  const s = readJSON(IDEATE, null);
  if (!s || s.state === 'closed' || run.ideateId && run.ideateId !== s.id) return finish(run, 'done');
  run.ideateId = s.id; run.kind = 'note'; run.noteType = 'ideate';
  if (s.state === 'ready') return finish(run, 'done');
  let round = 1;
  while (round <= 3) {
    const r = s.rounds.find(x => x.round === round), pack = r && loadPack(DIR, r.packId);
    if (!r || !pack || r.qa.length < pack.questions.length) break;
    round++;
  }
  const previous = s.rounds.find(r => r.round === round);
  if (previous && loadPack(DIR, previous.packId)) {
    updateIdeate(s, { state: 'asking', round, reason: '' });
    return finish(run, 'done');
  }
  const current = updateIdeate(s, { state: 'running', round, reason: '' });
  if (!current) return finish(run, 'done');
  run.ideateRound = round;
  const sb = newSandbox(run);
  writeJSON(path.join(sb, 'ideate.json'), current);
  datedTask(sb, 'ai-ideate.md');
  fs.appendFileSync(path.join(sb, 'task.md'), round <= 3 ? `\n\n## 今次是第 ${round} 步\n` : '\n\n## 今次是收尾\n');
  writeJSON(path.join(sb, 'job.json'), { type: round <= 3 ? 'ideate-ask' : 'ideate-final', round, today: todayIso() });
  return runAIStep(run, sb, round <= 3 ? NAMES.t('ideateStep', { n: round }) : U.ideateFinal, true);
}
function finishIdeate(run, sb, label, styleWarnings) {
  const s = readJSON(IDEATE, null);
  if (!s || s.id !== run.ideateId || s.state === 'closed') return finish(run, 'done');
  const fail = reason => { step(run, 'ai', label, 'failed', reason); return finish(run, 'failed', reason); };
  const receipt = checkReceipt(path.join(sb, 'out'), true);
  if (!receipt.ok) return fail(receipt.reason);
  run.result = { ...receipt.receipt, styleWarnings };
  const round = run.ideateRound;
  if (round <= 3) {
    const raw = readJSON(path.join(sb, 'out', 'ask.json'), null);
    if (!raw || !Array.isArray(raw.questions)) return fail(U.ideateBadAsk);
    // 先限至最重要三題，再沿用格式、去重及放包核對；不接受 AI 自行開其他工作。
    const questions = raw.questions.map((q, i) => ({ q, p: Number(q && q.priority) || i + 1 })).sort((a, b) => a.p - b.p).slice(0, 3).map(x => x.q);
    const prep = preparePacks({ format: raw.format, title: raw.title, context: raw.context, questions }, { dirs: DIR, askedBy: 'AI', fromRun: run.id, strictTitle: false });
    if (!prep.ok || prep.packs.length !== 1) return fail(U.ideateBadAsk);
    const pack = prep.packs[0];
    pack.ideate = { id: s.id, round }; pack.todoType = 'question';
    pack.afterConfirm = round === 3 ? U.ideateFinalNext : U.ideateNext;
    const placed = placePacks(DIR, [pack]);
    run.result.asks = placed;
    updateIdeate(s, { state: 'asking', round, rounds: [...s.rounds.filter(r => r.round !== round), { round, packId: placed[0].id, qa: [] }], reason: '' });
  } else {
    const raw = readJSON(path.join(sb, 'out', 'prefill.json'), null);
    if (raw && raw.answers && typeof raw.answers === 'object') for (const q of PREFILL_Q) {
      const a = raw.answers[q];
      if (a && typeof a === 'object') { a.quote = false; a.source = U.ideateSource; }
    }
    const chk = checkPrefill(raw, []);
    if (!chk.ok || !chk.answers.q1) return fail(U.ideateBadPrefill);
    for (const a of Object.values(chk.answers)) a.source = U.ideateSource;
    const rec = { id: run.ref, at: localIso(), files: [], answers: chk.answers, missing: PREFILL_Q.filter(q => !chk.answers[q]), runId: run.id, from: 'ideate' };
    fs.mkdirSync(path.join(DIR.ledger, 'prefill'), { recursive: true });
    writeJSON(path.join(DIR.ledger, 'prefill', run.ref + '.json'), rec);
    updateIdeate(s, { state: 'ready', prefillId: run.ref, reason: '' });
    run.result.summary = U.ideateReady;
  }
  step(run, 'ai', label, 'done', run.result.summary);
  return finish(run, 'done');
}
async function handleIdeateAnswer(run, pack, store) {
  const s = readJSON(IDEATE, null);
  if (!s || s.id !== pack.ideate.id) return finish(run, 'done');
  const qa = pack.questions.filter(q => hasAnswer(store.answers[q.id])).map(q => {
    const a = store.answers[q.id];
    return { ask: q.ask, answer: showAns(q, a.value), by: a.changed || JSON.stringify(a.value) !== JSON.stringify(q.value) ? 'founder' : 'zero' };
  });
  const rounds = s.rounds.map(r => r.round === pack.ideate.round && r.packId === pack.id ? { ...r, qa } : r);
  updateIdeate(s, { rounds }, true);
  // 舊包的遲來答案只記錄；未知也算已答，不會重問。
  if (s.state === 'closed' || s.state === 'ready' || s.round !== pack.ideate.round || qa.length < pack.questions.length) return finish(run, 'done');
  run.ideateId = s.id;
  return handleIdeate(run);
}
function newSandbox(run, selectedBiz = null, name = '') {
  const sb = path.join(DIR.sandbox, name || run.id);
  fs.mkdirSync(path.join(sb, 'out'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'ask-format.md'), path.join(sb, 'ask-format.md'));
  writeBizContext(sb, selectedBiz);
  return sb;
}

/* ---------- 生意大腦：生意體檢（規劃書 4.6 供料與觸發表；結果只係 AI 解讀或建議，唔改任何級別） ----------
   公司概覽成頁確認嗰次工作做第一次；每月覆核（距上次 28 日或以上）再做。同一次工作入面做，唔會令自動停多計一次。
   供料：已確認公司概覽、帳本假設清單同里程碑、創辦人上次對結果卡嘅意見。 */
const BRAIN_JOBS = { checkup: { task: 'ai-checkup.md', out: 'checkup.json', check: (raw, L, at) => checkCheckup(raw, L, at) }, opportunities: { task: 'ai-opportunities.md', out: 'opportunities.json', check: (raw, L, at) => checkOpportunities(raw, at, L) } };
// 商機掃描：已確認、已有生意體檢、距上次 6 日或以上，而且係訪問日前一日或訪問日
function opportunitiesDue(s, today) {
  const o = readJSON(brainFile(DIR, 'opportunities'), null), nextOn = s.interviews && s.interviews.nextOn;
  return !!(readJSON(CONFIRMED, null) && fs.existsSync(brainFile(DIR, 'checkup')) && nextOn && today >= addDays(nextOn, -1) && (!o || !o.updatedAt || (clockNow() - new Date(o.updatedAt)) / 86400000 >= 6));
}
const OPP_KINDS = ['政策', '資助', '時間窗', '競爭空隙'];
// 只可按編號或正規化標題攔截；AI 改寫標題後的同一機會無法機械辨認，須依靠 AI 指示。
const opportunityTitle = title => String(title || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const opportunityMatch = (id, title, priorId, prior) => !!((id && id === priorId) || (opportunityTitle(title) && opportunityTitle(title) === opportunityTitle(prior.title)));
function rejectedOpportunities(decisions) {
  const rejected = new Map();
  for (const [id, d] of Object.entries(decisions)) {
    if (d.answer !== U.oppDrop && (Number(d.laterCount) || (d.answer === U.oppLater ? 1 : 0)) < 2) continue;
    let current = id;
    const visited = new Set();
    while (current && decisions[current] && !visited.has(current)) {
      visited.add(current);
      const entry = decisions[current];
      rejected.set(current, { id: current, title: entry.title });
      current = entry.previousId;
    }
  }
  return [...rejected.values()];
}
// 出處標註：Zero 自報有沒有讀過全文（fullText）；缺欄、false，或本次只能搜尋（不能開啟網頁），一律標「（只經搜尋摘要）」
const markSource = (text, entry, access) => { text = String(text || ''); if (!text || text.includes('只經搜尋摘要')) return text; return text + ((access === 'search' ? NAMES.ui.sourceSearchOnly : '') || fullTextSuffix(entry, NAMES.ui.sourceSearchOnly)); };
function checkOpportunities(raw, at, L) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.list)) return { ok: false, reason: '商機掃描的格式不正確' };
  const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n), tag = at.replace(/\D/g, '').slice(0, 12);
  // 外部事實一定要有出處（標題同查閱日期）；網址另放，畫面以連結顯示
  // as：AI 建議做成臨時工作（task）定係路徑選項（path，會改到已確認嘅站）；兩樣都要你決定先做
  const rejected = (L.rejectedOpportunities || []);
  const knownIds = new Set([...(L.knownOpportunityIds || []), ...rejected.map(x => x.id)]);
  const previousId = o => { const id = txt(o?.previousId, 100); return knownIds.has(id) ? id : ''; };
  const list = raw.list.filter(o => !rejected.some(x => opportunityMatch(previousId(o), txt(o?.title, 80), x.id, x))).slice(0, 5).map((o, i) => ({ id: 'opp-' + tag + '-' + (i + 1), ...(previousId(o) ? { previousId: previousId(o) } : {}), kind: OPP_KINDS.includes(o && o.kind) ? o.kind : '時間窗', as: o && o.as === 'path' ? 'path' : 'task', title: txt(o && o.title, 80), why: txt(o && o.why, 300), firstTest: txt(o && o.firstTest, 200), window: txt(o && o.window, 60), windowDate: txt(o && o.windowDate, 10), counterpartId: ((L.counterparts || []).some(a => a.id === o?.counterpartId) ? o.counterpartId : ''), source: txt(o && o.source, 160), url: /^https:\/\/[^\s]{4,300}$/.test(String(o && o.url || '')) ? String(o.url) : '', fullText: !!o && o.fullText === true && L.webAccess !== 'search' })).map(o => ({ ...o, source: o.url ? markSource(o.source, o, L.webAccess) : o.source })).filter(o => { if (o.windowDate && (!/^\d{4}-\d{2}-\d{2}$/.test(o.windowDate) || Number.isNaN(Date.parse(o.windowDate)) || new Date(o.windowDate).toISOString().slice(0, 10) !== o.windowDate || o.windowDate < at.slice(0, 10))) return false; return o.title && o.why && o.firstTest && o.source; });
  if (!list.length) return { ok: false, reason: '商機掃描未有寫出附出處的機會' };
  return { ok: true, result: { status: 'done', updatedAt: at, summary: txt(raw.summary, 120) || NAMES.dash.brainDone_opportunities, partial: raw.partial === true, list } };
}
const checkupStale = () => { const c = readJSON(brainFile(DIR, 'checkup'), null); return !c || !c.updatedAt || (clockNow() - new Date(c.updatedAt)) / 86400000 >= (c.partial === true ? 7 : 28); };
function brainLedger() {
  const s = loadState();
  const active = ((s.company || {}).assumptions || []).filter(a => a.status !== 'retired');
  const nextStations = (s.milestones || []).filter(m => m.pathStatus === 'confirmed' && m.state !== 'done').sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 2);
  const relevant = active.filter(a => (a.milestoneIds || []).some(id => nextStations.some(m => m.id === id)));
  const minGrade = relevant.length ? Math.min(...relevant.map(a => Math.max(0, NAMES.EV_KEYS.indexOf(a.grade || 'guess')))) : -1;
  const hints = { lowestForNextStations: relevant.filter(a => Math.max(0, NAMES.EV_KEYS.indexOf(a.grade || 'guess')) === minGrade).map(a => a.id), unchanged28Days: active.filter(a => a.changedAt && (clockNow() - new Date(a.changedAt)) / 86400000 > 28).map(a => a.id) };
  const adopted = listMatches(DIR, brainSource(DIR)).flatMap(m => (m.strengthen?.cards || []).filter(c => c.status === '已採用' || c.status === '已改處理').map(c => ({ title: c.test?.what || c.critique || '', matchId: m.id })).filter(c => c.title));
  const existingTests = { assumptions: active.filter(a => a.cheapestTest).map(a => ({ assumptionId: a.id, test: a.cheapestTest })), adopted };
  return { assumptions: ((s.company || {}).assumptions || []).filter(a => a.status !== 'retired').map(a => ({ id: a.id, text: a.text, grade: a.grade || 'guess', cheapestTest: a.cheapestTest || '', ...(a.cheapestTestPartial ? { cheapestTestSource: '生意體檢部分完成，只覆蓋已交出的項目' } : {}) })),
    hints, existingTests,
    // 已確認值（規劃書出題規則第 8 條）：路線次序、邊站已確認、進度、本季目標，AI 建議唔可以同佢哋矛盾
    milestones: (s.milestones || []).filter(m => m.pathStatus !== 'retired').sort((a, b) => (a.order || 0) - (b.order || 0)).map((m, i) => ({ id: m.id, order: i + 1, name: m.short, event: m.event || '', actor: m.actorName || '', confirmed: m.pathStatus === 'confirmed', state: m.state || 'not_started', done: m.state === 'done' })),
    quarterGoal: (s.goals && s.goals.quarter && s.goals.quarter.text) || ((s.intake && s.intake.answers && s.intake.answers.G1) || {}).value || '',
    nextExternalAction: (s.company || {}).nextExternalAction || null, counterparts: ((s.company || {}).actors || []).map(a => ({ id: a.id, name: a.name })) };
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
  if (raw.weak.slice(0, 3).some(w => !w || !byId[w.assumptionId])) return { ok: false, invalidAssumption: true, reason: '弱位指向不存在的假設' };
  // 證據級由帳本假設讀，唔係 AI 寫
  const weak = raw.weak.slice(0, 3).map((w, i) => { const a = byId[w && w.assumptionId]; return { id: 'weak-' + tag + '-' + (i + 1), title: txt(w && w.title, 80), assumptionId: a ? a.id : '', evidence: a ? Math.max(0, NAMES.EV_KEYS.indexOf(a.grade)) : 0, source: 'Zero 解讀', why: txt(w && w.why, 300), cheapestTest: txt(w && w.cheapestTest, 200), stop: txt(w && w.stop, 200) }; }).filter(w => w.title && w.why && w.cheapestTest);
  const unseen = (Array.isArray(raw.unseen) ? raw.unseen : []).slice(0, 3).map((u, i) => ({ id: 'unseen-' + tag + '-' + (i + 1), text: txt(u && (u.text || u), 200), source: 'Zero 解讀' })).filter(u => u.text);
  const notNow = (Array.isArray(raw.notNow) ? raw.notNow : []).slice(0, 3).map((u, i) => ({ id: 'notnow-' + tag + '-' + (i + 1), text: txt(u && (u.text || u), 200), why: txt(u && u.why, 200) })).filter(u => u.text);
  const industryCheck = L.webAccess === 'none' ? [] : (Array.isArray(raw.industryCheck) ? raw.industryCheck : []).slice(0, 5).map(x => ({ text: txt(x?.text, 300), source: txt(x?.source, 160), url: /^https:\/\/[^\s]{4,300}$/.test(String(x?.url || '')) ? String(x.url) : '', readOn: /^\d{4}-\d{2}-\d{2}$/.test(String(x?.readOn || '')) ? x.readOn : '', fullText: !!x && x.fullText === true && L.webAccess !== 'search' })).filter(x => x.text && x.source && x.url && x.readOn).map(x => ({ ...x, source: markSource(x.source, x, L.webAccess) }));
  if (!weak.length && !(raw.partial === true && (unseen.length || notNow.length))) return { ok: false, reason: '生意體檢未有寫出可用的環節' };
  return { ok: true, result: { status: 'done', updatedAt: at, summary: txt(raw.summary, 120) || NAMES.dash.brainDone_checkup, partial: raw.partial === true, weak, unseen, notNow, industryCheck } };
}
// 一次工作入面加一步生意大腦工作（唔結束成次工作）；成功回 true
async function brainStep(run, item, opts = {}) {
  const key = 'brain-' + item, label = U['brainJob_' + item], job = BRAIN_JOBS[item];
  if (pausedNow()) return false; // 暫停中：唔開 AI，下次再做
  const ad = certified(ROOT, DIR.ledger);
  if (!ad.host) return false;
  const sb = path.join(DIR.sandbox, run.id + '-' + item);
  fs.mkdirSync(path.join(sb, 'out'), { recursive: true });
  writeCounterparts(sb);
  writeBizContext(sb);
  writeConfirmedPage(sb);
  const L = brainLedger(), prev = readJSON(brainFile(DIR, item), null), fb = feedbackFor(item, prev);
  L.webAccess = webAccess(ad.host);
  const decisions = readJSON(path.join(DIR.ledger, 'opportunity-decisions.json'), {}) || {};
  for (const [id, f] of Object.entries(readJSON(path.join(DIR.ledger, 'brain-feedback.json'), {}) || {})) if (!decisions[id] && f?.item === 'opportunities' && f.verdict === 'useless' && f.text === U.oppDropNote) decisions[id] = { title: f.title || '', answer: U.oppDrop, at: f.at || '' };
  if (item === 'opportunities') L.rejectedOpportunities = rejectedOpportunities(decisions);
  writeJSON(path.join(sb, 'ledger.json'), L);
  if (item === 'opportunities') L.knownOpportunityIds = [...Object.keys(decisions), ...(prev?.list || []).map(o => o.id)];
  if (prev) writeJSON(path.join(sb, 'previous.json'), item === 'opportunities' ? { ...prev, list: (prev.list || []).map(o => ({ ...o, answer: decisions[o.id]?.answer || '' })) } : prev);
  fs.writeFileSync(path.join(sb, 'feedback.md'), '# 創辦人上次對結果卡的意見\n\n' + (fb.length ? fb.map(f => `- 「${f.card}」：${f.verdict}${f.text ? '——' + f.text : ''}`).join('\n') : '（沒有）') + '\n');
  datedTask(sb, job.task);
  writeJSON(path.join(sb, 'job.json'), { type: item, today: todayIso(), feedback: fb.length, ...(opts.timeoutMinutes ? { timeoutMinutes: opts.timeoutMinutes } : {}) });
  step(run, key, label, 'running', 'Zero 處理中');
  const r = await runAI(sb, opts.timeoutMinutes ? { timeoutMinutes: opts.timeoutMinutes } : undefined);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  const interrupted = !r.waiting && !r.childError && (r.timedOut === true || r.budgetExceeded === true) && !(r.meta?.permission_denials || []).length && !/(permission.denied|access.denied|unauthori[sz]ed|not permitted|\bdenied\b|"permission_denials"\s*:\s*\[\s*(?!\])|"state"\s*:\s*"(?:denied|rejected)"|安全|權限)/i.test(String(r.reason || '') + ' ' + String(r.stderr || '') + ' ' + String(r.safetyOutput || ''));
  if ((!r.ok || r.waiting) && !interrupted) { step(run, key, label, 'failed', r.reason || 'Zero 未能完成'); return false; }
  if (item === 'checkup' && !interrupted) await rewriteOnce(sb, run);
  let raw = readJSON(path.join(sb, 'out', job.out), null);
  let chk = job.check(interrupted && raw && typeof raw === 'object' ? { ...raw, partial: true } : raw, L, localIso());
  if (item === 'checkup' && chk.invalidAssumption && !interrupted) {
    fs.writeFileSync(path.join(sb, 'task.md'), '# 修正生意體檢\n\n每個弱位必須指向以下假設，修正後覆寫 out/checkup.json：\n' + L.assumptions.map(a => '- ' + a.id + '：' + a.text).join('\n') + '\n');
    writeJSON(path.join(sb, 'job.json'), { type: 'checkup', repair: true });
    const retry = await runAI(sb, opts.timeoutMinutes ? { timeoutMinutes: opts.timeoutMinutes } : undefined);
    if (retry.ok) { await rewriteOnce(sb, run); raw = readJSON(path.join(sb, 'out', job.out), null); chk = job.check(raw, L, localIso()); }
  }
  if (!chk.ok) { step(run, key, label, interrupted || raw?.partial ? 'skipped' : 'failed', interrupted || raw?.partial ? '未完成，未有可用內容' : chk.reason); return false; }
  if (chk.result.partial) { chk.result.status = 'partial'; chk.result.summary = '部分完成，只覆蓋已交出的項目。' + (chk.result.summary || ''); }
  chk.result.feedbackUsed = fb.length;
  if (item === 'checkup') chk.result.industryCheck = await markBrokenLinks(chk.result.industryCheck, 'source');
  if (item === 'opportunities') chk.result.list = await markBrokenLinks(chk.result.list, 'source');
  fs.mkdirSync(path.dirname(brainFile(DIR, item)), { recursive: true });
  writeJSON(brainFile(DIR, item), chk.result);
  if (item !== 'checkup') { addEvent({ actor: 'ai', type: 'brain', title: (chk.result.partial ? '商機掃描部分完成' : NAMES.dash['brainDone_' + item]) + '：' + clip((chk.result.list[0] || {}).title || '', 30), relatedIds: [], moduleIds: ['ai-week'] }); step(run, key, label, chk.result.partial ? 'partial' : 'done', chk.result.summary); if (!chk.result.partial) offerOpportunities(run, chk.result); return true; }
  // 弱位寫成假設清單嘅最便宜測試（規劃書 4.6）：未有測試、或者上次由生意體檢寫嘅，用今次嘅；其他來源寫嘅（例如創辦人自己寫）唔郁；唔改級別
  const s = loadState(); let filled = 0;
  for (const w of chk.result.weak) { const a = ((s.company || {}).assumptions || []).find(x => x.id === w.assumptionId); if (a && (!String(a.cheapestTest || '').trim() || a.cheapestTestBy === 'checkup') && (a.cheapestTest !== w.cheapestTest || !!a.cheapestTestPartial !== !!chk.result.partial)) { a.cheapestTest = w.cheapestTest; a.cheapestTestBy = 'checkup'; a.cheapestTestPartial = !!chk.result.partial; a.cheapestTestAt = chk.result.updatedAt; filled++; } }
  if (filled) saveState(s);
  if (!chk.result.partial) offerDebate(run, chk.result);
  addEvent({ actor: 'ai', type: 'brain', title: (chk.result.partial ? '生意體檢部分完成' : NAMES.dash.brainDone_checkup) + '：' + clip(chk.result.weak[0]?.title || chk.result.unseen[0]?.text || chk.result.notNow[0]?.text || '', 30), relatedIds: chk.result.weak.map(w => w.assumptionId).filter(Boolean), moduleIds: ['ai-week'] });
  step(run, key, label, chk.result.partial ? 'partial' : 'done', chk.result.summary);
  return true;
}
// 生意大腦放上待決事項 嘅建議（每份結果最多一包）：ledger/brain-offers.json 記低邊份結果出過、問題包編號
const OFFERS = path.join(DIR.ledger, 'brain-offers.json');
const offered = (k, at) => { const o = (readJSON(OFFERS, {}) || {})[k]; return !!(o && o.resultAt === at); };
function noteOffer(k, at, packId) { const all = readJSON(OFFERS, {}) || {}; all[k] = { resultAt: at, packId, at: localIso() }; writeJSON(OFFERS, all); }
// AI 寫嘅句子放上待決事項 之前：假設編號換成假設內容（同生意大腦頁一樣嘅最後保險）
const plainOf = s => deCodeInfo(String(s || ''), { assumptions: ledgerAssumptions(DIR) }).text;
// 有一場辯論做緊或者等你（未採用轉強卡、未失敗）就唔再建議；失敗咗嘅唔擋（你仍然可以喺 CrewZero 重跑嗰場）
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
      return { id: 'o' + (i + 1), priority: i + 1, opp: o.id, oppData: { title: o.title, why: o.why, firstTest: o.firstTest, source: o.source, ...(o.previousId ? { previousId: o.previousId } : {}) }, ask: NAMES.t('oppAsk', { t: clip(o.title, 60) }), kind: 'choice', effect: 'now', options: [U.oppTask, U.oppRoute, U.oppLater, U.oppDrop].map(t => ({ text: t, ...(t === rec ? { rec: true } : {}) })), value: rec, why: clip(NAMES.t('oppWhy', { w: o.why + (/[。！？.!?]$/.test(o.why) ? '' : '。'), f: o.firstTest }), 300) }; }) })])[0];
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
async function handleHelpAnswer(run, pack, store) {
  const q = pack.questions[0], answer = q && store.answers[q.id];
  if (!answer) {
    run.result = { summary: '尚待你選擇求助回覆的做法。', artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  if (answer.value !== U.helpStill) {
    if (pack.next && pack.next.task) {
      return aiAfterAsk(run, pack);
    }
    run.result = { summary: U.helpAnswerRecorded, artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  const retries = Math.max(0, Number(pack.helpRetries) || 0);
  if (retries >= 2) {
    run.result = { summary: U.helpRepeatLimit, artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  founderNote('help', [String(pack.context || '').trim(), '創辦人表示仍然不明白，請換一個完全不同的方式解釋', q && q.ask ? '原來的問題：' + q.ask : ''].filter(Boolean).join('\n\n'), 'help ' + pack.id + ' ' + String(retries + 1));
  run.result = { summary: U.helpAgain, artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
// 機會內容喺問題包入面（之後再掃描、結果檔換咗都照用得）
function handleOpportunityAnswer(run, pack, store) {
  const said = [], fb = readJSON(FEEDBACK, {}) || {};
  const decisionsFile = path.join(DIR.ledger, 'opportunity-decisions.json'), decisions = readJSON(decisionsFile, {}) || {};
  const previousResult = readJSON(brainFile(DIR, 'opportunities'), null);
  for (const q of pack.questions) {
    const a = store.answers[q.id], o = q.oppData && { id: q.opp, ...q.oppData };
    if (!a || !o) continue; // 必須先問：未答唔做
    if ([U.oppTask, U.oppRoute, U.oppLater, U.oppDrop].includes(a.value)) {
      const validPreviousId = o.previousId && (Object.hasOwn(decisions, o.previousId) || (previousResult?.list || []).some(item => item.id === o.previousId)) ? o.previousId : '';
      const prior = Object.entries(decisions).filter(([id, d]) => id !== o.id && opportunityMatch(validPreviousId, o.title, id, d));
      const earlier = Math.max(0, ...prior.map(([, d]) => Number(d.laterCount) || (d.answer === U.oppLater ? 1 : 0)));
      const existing = decisions[o.id];
      const previousId = validPreviousId || prior.sort((a, b) => (Number(b[1].laterCount) || 0) - (Number(a[1].laterCount) || 0))[0]?.[0] || '';
      const laterCount = existing ? Number(existing.laterCount) || (existing.answer === U.oppLater ? 1 : 0) : earlier + (a.value === U.oppLater ? 1 : 0);
      decisions[o.id] = { title: o.title, answer: a.value, at: localIso(), laterCount, ...(previousId ? { previousId } : {}) };
    }
    const from = 'opportunity ' + pack.id + ' ' + o.id;
    if (a.value === U.oppTask) { founderNote('adhoc', NAMES.t('oppNoteTask', { t: o.title, f: o.firstTest, s: o.source }), from); said.push('「' + clip(o.title, 20) + '」' + U.oppTask); }
    else if (a.value === U.oppRoute) { founderNote('order', NAMES.t('oppNoteRoute', { t: o.title, w: o.why, f: o.firstTest, s: o.source }), from); said.push('「' + clip(o.title, 20) + '」' + U.oppRoute); }
    else if (a.value === U.oppDrop) { fb[o.id] = { item: 'opportunities', verdict: 'useless', text: U.oppDropNote, title: o.title, at: localIso(), packId: pack.id }; said.push('「' + clip(o.title, 20) + '」' + U.oppDrop); }
  }
  if (said.some(t => t.endsWith(U.oppDrop))) writeJSON(FEEDBACK, fb);
  writeJSON(decisionsFile, decisions);
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
  const reg = registry(page), hash = proofreadHash(page);
  run.ref = page.page.id;
  step(run, 'received', U.stepReceivedConfirm, 'done', `${files.length} 份回覆`);
  const latest = files[files.length - 1];
  const parsed = parseFounderReply(fs.readFileSync(path.join(DIR.replies, latest), 'utf8'));
  const { head, machine, duplicateVia } = parsed;
  const via = replyVia(head.via);
  let why = '';
  if (!parsed.ok && duplicateVia) why = '這次答案未能記錄：答案來源重複。請按「重新載入」，再確認一次。';
  else if (!parsed.ok) why = '這次答案未能記錄：頁面內容與最新紀錄不一致。請按「重新載入」，再確認一次。';
  else if (head.kind !== 'proofread' || !machine) why = '這次答案未能記錄：頁面內容與最新紀錄不一致。請按「重新載入」，再確認一次。';
  else if (head.ref !== page.page.id) why = '回覆與目前的公司概覽不相符';
  else if (!proofreadHashMatches(page, head.hash)) why = '你確認時所見的版本已經更改，請重新開啟頁面再確認';
  if (why) { archive(files); step(run, 'applied', U.stepApplyConfirm, 'failed', why); return finish(run, 'failed', why); }
  const values = {};
  for (const [id, e] of Object.entries(reg)) values[id] = String(e.value ?? '');
  const allEdits = Array.isArray(machine.edits) ? machine.edits : [];
  for (const ed of allEdits) if (ed && reg[ed.id]) values[ed.id] = String(ed.value ?? '');
  // 回覆檔內 auto:true 的項目是頁面按目前目標期限自動調整的日期，不是創辦人的答案：另記，不計入創辦人修改
  const c = {
    company: page.company.name, pageId: page.page.id, confirmedAt: machine.confirmedAt, replyFile: latest,
    order: machine.order, orderChanged: !!machine.orderChanged, nextActionMilestone: machine.nextActionMilestone,
    edits: allEdits.filter(e => !(e && e.auto === true)), autoEdits: allEdits.filter(e => e && e.auto === true && reg[e.id]), stillMissing: machine.stillMissing || [], note: machine.note || '', values,
    kinds: Object.fromEntries(page.path.milestones.map(m => [m.id, (machine.kinds || {})[m.id] === 'task' || (!(machine.kinds || {})[m.id] && m.kind === 'task') ? 'task' : 'real'])), kindsChanged: Array.isArray(machine.kindsChanged) ? machine.kindsChanged.filter(id => page.path.milestones.some(m => m.id === id)) : []
  };
  const prev = readJSON(CONFIRMED, null);
  c.firstConfirmedAt = prev && (prev.firstConfirmedAt || prev.confirmedAt) || c.confirmedAt;
  writeJSON(CONFIRMED, c);
  const bizField = Object.values(reg).find(f => f.plan === 'biz.type');
  const bizType = bizField && Object.keys(BIZ_TYPES).find(id => BIZ_TYPES[id].label === values[bizField.id]);
  if (bizType) writeJSON(path.join(DIR.company, 'biz.json'), { type: bizType, other: '', source: 'founder' });
  archive(files);
  syncLedger();
  savePermissionsIfMissing('proofread');   // 三格權限預設直接存檔，不經 syncLedger 的比較欄，不改 page／confirmed（Z51）
  // 紀錄：你改咗嘅每項、你答咗嘅「要你決定」、次序、其餘一句
  const at = localIso(), base = { at, source: 'proofread', via, packId: page.page.id, packTitle: U.company, reply: latest, runId: run.id };
  const effectIds = new Set(listOf(page.detail && page.detail.rules).filter(r => r.effect).map(r => r.id));
  const entries = c.edits.map(e => ({ ...base, qid: e.id, question: e.label, ai: e.ai, answer: e.founder, changed: true, effect: effectIds.has(e.id) ? 'now' : 'tentative' }));
  for (const e of c.autoEdits) entries.push({ ...base, qid: e.id, question: e.label + '（' + NAMES.ui.autoAdjusted + '）', ai: e.ai, answer: e.founder, changed: true, auto: true, effect: 'tentative' });
  const editedIds = new Set(c.edits.map(e => e.id).concat(c.autoEdits.map(e => e.id)));
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
  step(run, 'applied', U.stepAppliedConfirm, 'done', `${n ? '修改了 ' + n + ' 項' : '全部按 Zero 建議'}${c.autoEdits.length ? '；另有 ' + c.autoEdits.length + ' 項' + NAMES.ui.autoAdjusted : ''}；次序${c.orderChanged ? '由你調整' : '按 Zero 建議'}`);
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
const requiresFounderAnswer = (pack, q) => !!(q && (pack.ideate || q.effect === 'now' || q.conflict || q.bind === 'results' || pack.actionConfirm || pack.acceptance && q.id === 'accept'));
const hasAnswer = answer => !!(answer && String(answer.value == null ? '' : answer.value).trim());
function requiredLeft(pack, store) {
  const answers = store && store.answers || {};
  return (pack.questions || []).filter(q => requiresFounderAnswer(pack, q) && !hasAnswer(answers[q.id]));
}
function answersMarkdown(pack, ans) {
  const L = [`# ${pack.title}：而家嘅答案`, ''];
  for (const q of pack.questions) {
    const a = ans[q.id];
    L.push(`## ${q.ask}`);
    if (a && a.value === U.unknownLater) L.push(`- 答案：${U.unknownLater}`, '- 狀態：創辦人而家答唔到，稍後提供；一星期內唔好再問，用到時當未知處理');
    else if (a) L.push(`- 答案：${showAns(q, a.value)}`, `- 狀態：創辦人答咗（${a.changed ? '改咗 Zero 建議' : '照 Zero 建議'}）`);
    else if (requiresFounderAnswer(pack, q)) L.push('- 答案：尚未回答', '- 狀態：創辦人尚未確認，不能作為 Zero 的後續依據。');
    else L.push(`- 答案：${showAns(q, q.value)}`, '- 狀態：先咁計住（Zero 建議，創辦人未答）');
    L.push('');
  }
  return L.join('\n');
}
async function aiAfterAsk(run, pack) {
  const store = loadAnswers(DIR, pack.id), ans = store.answers;
  const left = requiredLeft(pack, store);
  if (left.length) {
    run.result = { summary: `尚有 ${left.length} 條必須由你逐項確認的問題未回答，Zero 尚未開始後續工作。`, artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  if (pack.taskId) { run.taskId = pack.taskId; upsertTask({ id: pack.taskId, status: 'active', waitingFor: '', next: clip(pack.next.task, 60) }); }
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
  const parsed = parseFounderReply(fs.readFileSync(path.join(DIR.replies, file), 'utf8'));
  const { head, machine, duplicateVia } = parsed;
  const via = replyVia(head.via);
  const pack = loadPack(DIR, head.ref);
  run.ref = head.ref;
  step(run, 'received', U.stepReceivedAns, 'done', pack ? pack.title : '');
  let why = '';
  if (!parsed.ok && duplicateVia) why = '這次答案未能記錄：答案來源重複。請按「重新載入」，再確認一次。';
  else if (!parsed.ok) why = '這次答案未能記錄：頁面內容與最新紀錄不一致。請按「重新載入」，再確認一次。';
  else if (head.kind !== 'ask-answer' || !machine) why = '這次答案未能記錄：頁面內容與最新紀錄不一致。請按「重新載入」，再確認一次。';
  else if (!pack) why = '找不到此問題包';
  else if (!validateAskReply(parsed, pack).ok) { log('拒收問題包答案：' + validateAskReply(parsed, pack).reason); why = U.errAnswerIdentity; }
  else if (head.hash !== fnv(JSON.stringify(pack))) why = '問題包已經更改，請重新開啟頁面再作答';
  if (why) { archive([file]); step(run, 'applied', U.stepApplyAns, 'failed', why); return finish(run, 'failed', why); }
  if (!pack.debate) {
    const mapping = readJSON(path.join(DIR.ledger, 'brain-decisions.json'), {}) || {};
    const matchId = Object.keys(mapping).find(id => {
      if (mapping[id] !== pack.id || !/^[\w-]{1,40}$/.test(id)) return false;
      const decisions = viewOf(id)?.synthesis?.founderDecisions;
      return Array.isArray(decisions) && pack.questions.length > 0 && pack.questions.every((q, i) => q.ask === String(decisions[i]?.question || '') && JSON.stringify((q.options || []).map(o => o.text)) === JSON.stringify((decisions[i]?.options || []).slice(0, 3).map(String)));
    });
    if (matchId) pack.debate = { matchId, kind: 'decision' };
  }
  const store = loadAnswers(DIR, pack.id);
  const qs = Object.fromEntries(pack.questions.map(q => [q.id, q]));
  const at = localIso(), entries = [], acceptedAnswers = [];
  for (const a of machine.answers || []) {
    const q = qs[a.id];
    if (!q) continue;
    if (requiresFounderAnswer(pack, q) && !hasAnswer({ value: a.value })) continue;
    acceptedAnswers.push(a);
    store.answers[a.id] = { value: a.value, changed: !!a.changed, at, reply: file, runId: run.id, ...(machine.allSame && !a.changed ? { confirmedSame: true } : {}) };
    entries.push({ at, source: 'ask', via, packId: pack.id, packTitle: pack.title, qid: q.id, question: q.ask, ai: showAns(q, q.value), answer: showAns(q, a.value), changed: !!a.changed, effect: q.effect || 'tentative', reply: file, runId: run.id, ...(a.value === U.unknownLater ? { unknown: true } : {}), ...(machine.allSame && !a.changed ? { confirmedSame: true } : {}) });
  }
  writeJSON(path.join(DIR.answers, pack.id + '.json'), store);
  archive([file]);
  appendLog(DIR, entries);
  markUnknowns(pack, acceptedAnswers, at);
  if (pack.help) {
    step(run, 'applied', U.stepAppliedAns, 'done', '已記錄求助答案');
    return handleHelpAnswer(run, pack, store);
  }
  const left = pack.questions.filter(q => !store.answers[q.id] || requiresFounderAnswer(pack, q) && !hasAnswer(store.answers[q.id])).length;
  const unanswered = requiredLeft(pack, store);
  const applied = pack.request && pack.request.type === 'order' ? applyOrder(pack, store, run) : '';
  if (pack.request && (pack.request.type === 'adhoc' || pack.request.type === 'order') && pack.questions.every(q => store.answers[q.id])) setRequestInput(pack.request.noteId, { status: 'processed' });
  step(run, 'applied', U.stepAppliedAns, 'done', `今次回答了 ${entries.length} 條` + (left ? (unanswered.length ? `；尚有 ${left} 條未回答` : `；另有 ${left} 條暫按 Zero 建議`) : '；此問題包已全部回答') + (applied ? '；' + applied : ''));
  if (pack.ideate) return handleIdeateAnswer(run, pack, store);
  if (pack.rhythm) { const fresh = new Set((machine.answers || []).map(a => a.id)), k = pack.rhythm.kind;
    if (k === 'interview') return handleInterviewAnswer(run, pack, store, fresh);
    if (k === 'monthly') return handleMonthlyAnswer(run, pack, store);
    if (k === 'trial') return handleTrialAnswer(run, pack, store);
    if (k === 'second') return handleSecondAnswer(run, pack, store);
    if (k === 'debate') return handleDebateOfferAnswer(run, pack, store);
    if (k === 'opportunity') return handleOpportunityAnswer(run, pack, store);
    if (k === 'autoStop' || k === 'paused') return handleStopAnswer(run, pack, store);
    if (k === 'retire') return handleRetireAnswer(run, pack, store); }
  if (pack.peopleSync) return handlePeopleSyncAnswer(run, pack, store);
  if (pack.rolesSync) return handleRolesAnswer(run, pack, store);
  if (pack.realEvent) return handleEventConfirm(run, pack, store);
  if (pack.depth) return handleDepthAnswer(run, pack, store);
  if (pack.acceptance) return handleAcceptance(run, pack, store);
  if (pack.actionConfirm) return handleActionConfirm(run, pack, store);
  if (pack.debate) return handleDebateAnswer(run, pack, store);
  if (pack.next && pack.next.task) return aiAfterAsk(run, pack);
  if (applied) { run.result = { summary: applied, artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  run.result = { summary: '已記錄你的答案；此問題包沒有需要 Zero 即時跟進的工作。', artifacts: [], founderNext: [] };
  finish(run, 'done');
}

// 你嘅現實行動（見客、打電話、線下交付）：只有你喺 CrewZero 確認先算完成，AI 冇得標
function handleActionConfirm(run, pack, store) {
  const t = getTask(pack.actionConfirm.taskId);
  const answers = pack.questions.map(q => store.answers[q.id]);
  const allAnswered = answers.every(Boolean);
  const done = allAnswered && answers.every(a => a.value === U.actionDone);
  const hasReschedule = answers.some(a => a && a.value === U.actionReschedule);
  if (t) {
    if (done) { upsertTask({ id: t.id, status: 'done', confirmedBy: 'founder', waitingFor: '' }); addEvent({ actor: 'founder', type: 'input', title: '你已完成：' + t.title, relatedIds: [t.id], moduleIds: ['now', 'evidence'] }); }
    else upsertTask({ id: t.id, status: 'waiting', confirmedBy: null, packId: allAnswered ? '' : t.packId || '', waitingFor: !allAnswered ? '等待你確認是否完成' : hasReschedule ? '等待你改期' : '等待你完成', next: allAnswered ? '你表示尚未完成，需要改期' : t.next || '' });
  }
  run.result = { summary: t ? (done ? '已記錄：你已完成「' + t.title + '」。' : !allAnswered ? '尚待你確認「' + t.title + '」是否完成。' : hasReschedule ? '已記錄：「' + t.title + '」需要改期。' : '已記錄：「' + t.title + '」尚未完成。') : '已記錄你的答案。', artifacts: [], founderNext: [] };
  return finish(run, 'done');
}
async function handleAcceptance(run, pack, store) {
  const t = getTask(pack.acceptance.taskId);
  // 示範實例：崗位啟用驗收只記錄答案（答案檔已由問題包存好），不改工作、不改崗位卡、不開 AI（資料約定第 12 節）；
  // 臨時工作的驗收照 0.40.2 示範行為（接受／退回流程可在示範試用）
  const roleActivation = !!(pack.acceptance.activation || (t && t.cadence === 'activation'));
  if (loadState().demo === true && roleActivation) { run.result = { summary: '已記錄驗收結果。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  const redirectText = NAMES.t('role_optAcceptRedirect');
  const a = store.answers.accept, ok = !!a && (a.value === '接受' || a.value === redirectText), redirect = !!a && a.value === redirectText;
  if (!t) { run.result = { summary: '已記錄驗收結果。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  if (!a) { run.result = { summary: '尚待你確認「' + t.title + '」的驗收結果。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
  if (ok) {
    upsertTask({ id: t.id, status: 'done', acceptedBy: 'founder', waitingFor: '' });
    if (pack.acceptance.teammateId && pack.acceptance.activation) activateCard(pack, store, redirect ? 'acceptRedirect' : 'accept');
    addEvent({ actor: 'founder', type: 'decision', title: '接受：' + t.title, relatedIds: [t.id], moduleIds: ['decisions', 'ai-week'] });
    run.result = { summary: '已接受「' + t.title + '」。', artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
  const reason = String((store.answers.reason || {}).value || '').trim();
  if (pack.acceptance.teammateId && pack.acceptance.activation) return returnActivation(run, pack, t, reason);
  if (pack.acceptance.workId) {
    // 日常工作交的產出被退回：重開工作，不走通用 ask-continue；下一件日常工作由 dailyLoop 用八段說明派（退回原因、上一版放進第三、四段），說明自足
    upsertTask({ id: t.id, status: 'active', acceptedBy: null, needsAcceptance: false, waitingFor: '', returnNote: reason && reason !== '不用改' ? reason : '創辦人退回，未寫明原因', lastWorkId: pack.acceptance.workId });
    addEvent({ actor: 'founder', type: 'decision', title: '退回：' + t.title, relatedIds: [t.id], moduleIds: ['decisions', 'ai-week'] });
    run.result = { summary: '已退回「' + t.title + '」，Zero 會按你的原因重做。', artifacts: [], founderNext: [] };
    return finish(run, 'done');
  }
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
    roles: base.roles || null, budget: { aiStarts: 0, hardCap: HARD_CAP, reruns: 0, rejudged: 0, reattackRounds: 0, ...(base.budget || {}) }, founder: base.founder || null, packs: base.packs || {}, warnings: base.warnings || [], label: 'Zero 建議 · 未確認', next: '', legacy: true };
  saveMatch(n);
  return n;
}
// 角色模型只顯示甲乙丙；思考程度唔代表不同模型。
function roleSetup() {
  const c = certified(ROOT, DIR.ledger), h = c.host || {};
  const ms = ['blue', 'red', 'judge'].map(r => { const m = modelCandidates(h, r)[0]; return m?.label || m?.model || 'default'; });
  const access = webAccess(h), web = access !== 'none';
  const label = {}; let k = 0;
  for (const m of ms) if (!(m in label)) label[m] = '甲乙丙'[k++] || '丁';
  const warnings = ms[0] === ms[2] ? ['三方同一模型，獨立性低'] : [];
  return { roles: { blue: { model: label[ms[0]], adapter: 'same', ok: null }, red: { model: label[ms[1]], adapter: 'same', ok: null }, judge: { model: label[ms[2]], adapter: 'same', ok: null, sameAsBlue: ms[0] === ms[2] } }, warnings, web, access };
}
// 開一場辯論（創辦人按「開一場辯論」，或者答「開始」回應生意體檢之後嘅建議）：只係排好第一回合，外殼之後逐回合做
function openMatch(m, from) {
  const id = 'D' + stamp();
  const src = brainSource(DIR);
  const prev = listMatches(DIR, src).filter(v => v.score && v.topic.type === m.topicType).pop();
  const format = formatFor(m.topicType);
  const rs = roleSetup();
  rs.roles.red.personas = m.seats;
  const match = { id, topic: { type: m.topicType, title: m.title, targetId: m.targetId || '' }, startedAt: localIso(), endedAt: '', status: 'preparing', format, level: m.level, web: rs.web, webAccess: rs.access,
    roles: rs.roles, budget: { aiStarts: 0, hardCap: HARD_CAP, reruns: 0, rejudged: 0, reattackRounds: 0 }, files: {}, founder: null, packs: {}, warnings: rs.warnings, label: 'Zero 建議 · 未確認',
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
    if (m.status === 'adopted' || (m.budget.aiStarts || 0) + 2 > HARD_CAP) return done('此場已採用，或已達 Zero 工作次數上限', false);
    m.round = 2; m.next = 'reattack-red'; m.status = 'reattack'; m.queuedAt = localIso(); saveMatch(m);
    return done('已排好紅方再攻第二輪');
  }
  if (a.action === 'respond') {
    if (!v || !v.synthesis) return done('裁判未整合好，未可以回應', false);
    if (m.packs.response && loadPack(DIR, m.packs.response)) return done('回應問題已在待決事項');
    const placed = placeDebatePacks([responsePack(v)]);
    m.packs.response = placed[0] ? placed[0].id : ''; saveMatch(m);
    run.result = { summary: '已放上待決事項：回應這場', artifacts: [], founderNext: [], asks: placed, matchId: m.id };
    step(run, 'applied', U.stepReqRegistered, 'done', '已放上待決事項'); return finish(run, 'done');
  }
  if (a.action === 'adopt') {
    if (!v || !v.strengthen) return done('未有轉強卡', false);
    const open = [].concat(m.packs.adoption || []).filter(id => loadPack(DIR, id));
    if (open.length) return done('採用問題已在待決事項');
    const placed = placeDebatePacks(adoptionPacks(v));
    m.packs.adoption = placed.map(p => p.id); saveMatch(m);
    run.result = { summary: placed.length ? '已放上待決事項：採用轉強' : '沒有未決定的轉強卡', artifacts: [], founderNext: [], asks: placed, matchId: m.id };
    step(run, 'applied', U.stepReqRegistered, 'done', run.result.summary); return finish(run, 'done');
  }
  return done('操作不正確', false);
}
// 外殼機械出嘅問題包：唔使 AI；每場題目唔同，唔做「答過唔再問」
function placeDebatePacks(raws) {
  const out = [];
  for (const raw of raws) {
    const prep = preparePacks(raw, { dirs: null, askedBy: 'AI', fromRun: null, strictTitle: false, system: true });
    if (!prep.ok) { log('辯論問題包格式不正確：' + prep.errors.join('；')); continue; }
    for (const p of prep.packs) { p.debate = raw.debate; p.todoType = 'decision'; if (raw.debate && ['response', 'adopt'].includes(raw.debate.kind)) p.brainItem = 'wargame'; }
    out.push(...placePacks(DIR, prep.packs));
  }
  return out;
}
// 回合嘅沙盒：題目、公司概覽、文件、上一場、前面回合嘅產出、格式同例子
function debateSandbox(run, m, pass) {
  const sb = newSandbox(run);
  writeCounterparts(sb);
  writeJSON(path.join(sb, 'ledger.json'), brainLedger());
  const src = brainSource(DIR);
  const seats = (m.roles && m.roles.red && m.roles.red.personas) || [];
  fs.writeFileSync(path.join(sb, 'topic.md'), ['# 今次辯論', '', `- 題目：${m.topic.title}`, `- 題目類型：${NAMES.dash['tp_' + m.topic.type] || m.topic.type}`, m.topic.targetId ? `- 對象編號：${m.topic.targetId}` : '',
    `- 上網能力：${m.webAccess || (m.web === false ? 'none' : 'search+read')}`, `- 紅方席位：${seats.join('、')}`, `- 紅方力度：${LEVELS[m.level] || '一般'}`, `- 回合：${m.format}（${passesFor(m.format).map(p => U['dp_' + p]).join(' → ')}）`, `- 今日：${localIso().slice(0, 10)}`].filter(Boolean).join('\n') + '\n');
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
  if ((m.budget.aiStarts || 0) >= HARD_CAP) { m.next = ''; return fail('一場最多 ' + HARD_CAP + ' 次 Zero 工作，已到上限'); }
  const sb = debateSandbox(run, m, pass);
  const role = PASS_ROLE[pass], t0 = Date.now();
  step(run, 'ai', label, 'running', 'Zero 處理中，一般需時數分鐘；完成後會在 CrewZero「生意大腦」逐幕出現');
  log(`${run.id} 辯論 ${m.id} ${pass} start`);
  const r = await runAI(sb, { role, onStart: () => {
    if ((m.budget.aiStarts || 0) >= HARD_CAP) return false;
    m.budget.aiStarts = (m.budget.aiStarts || 0) + 1;
    saveMatch(m);
    return true;
  } });
  if (r.meta) run.aiCost = { usd: r.meta.total_cost_usd, ms: r.meta.duration_ms };
  if (r.waiting) return fail(r.reason, true);
  m.budget.usd = Math.round(((m.budget.usd || 0) + (r.meta && r.meta.total_cost_usd || 0)) * 10000) / 10000;
  if (!r.ok) return fail(r.reason || 'Zero 未做完');
  let out = readJSON(path.join(sb, 'out', PASS_OUT[pass]), null);
  const src = brainSource(DIR), dir = matchDir(DIR, m.id);
  fs.mkdirSync(dir, { recursive: true });
  const blue = readMatchFile(DIR, src, m.id, 'blue.json'), red = readMatchFile(DIR, src, m.id, 'red.json');
  let chk;
  const ledger = readJSON(path.join(sb, 'ledger.json'), { assumptions: [] });
  const levels = ['none', 'search', 'search+read'];
  const effectiveAccess = actual => {
    const host = levels.includes(actual) ? actual : 'none';
    const opening = m.webAccess === undefined ? host : levels.includes(m.webAccess) ? m.webAccess : 'none';
    return levels[Math.min(levels.indexOf(host), levels.indexOf(opening))];
  };
  let access = effectiveAccess(r.webAccess);
  if (pass === 'blue') chk = checkBlue(out, { ledger, access });
  else if (pass === 'red') {
    const seats = (m.roles && m.roles.red && m.roles.red.personas) || [], actors = ((loadState().company || {}).actors || []).map(a => a.id);
    chk = checkRed(out, blue, seats, actors, { access });
    if (chk.errors.length === 1 && chk.errors[0] === '紅方攻擊覆蓋不足' && !m.budget.redCoverageRetry && (m.budget.aiStarts || 0) < HARD_CAP) {
      m.budget.redCoverageRetry = 1; saveMatch(m);
      fs.writeFileSync(path.join(sb, 'task.md'), '# 修正紅方攻擊\n\n請補足每條藍方論點的攻擊，保留所有席位卡，覆寫 out/red.json。\n');
      writeJSON(path.join(sb, 'job.json'), { type: 'debate-red', seats, repair: true });
      const retry = await runAI(sb, { role, onStart: () => { if ((m.budget.aiStarts || 0) >= HARD_CAP) return false; m.budget.aiStarts++; saveMatch(m); return true; } });
      if (retry.meta) {
        m.budget.usd = Math.round(((m.budget.usd || 0) + (retry.meta.total_cost_usd || 0)) * 10000) / 10000;
        run.aiCost = { usd: Math.round(((run.aiCost?.usd || 0) + (retry.meta.total_cost_usd || 0)) * 10000) / 10000, ms: (run.aiCost?.ms || 0) + (retry.meta.duration_ms || 0) };
      }
      if (!retry.ok) return fail(retry.reason || '紅方修正未完成');
      access = effectiveAccess(retry.webAccess);
      out = readJSON(path.join(sb, 'out', PASS_OUT[pass]), null); chk = checkRed(out, blue, seats, actors, { access, allowIncomplete: true });
    }
  }
  else if (pass === 'rebuttal') chk = checkRebuttal(out, red);
  else if (pass === 'judge') chk = checkJudge(out, blue, red, { ledger, access });
  else if (pass === 'rejudge') chk = checkRejudge(out, ((m.founder && m.founder.challenges) || []).some(c => c.claimId) ? m.founder.challenges.map(c => c.claimId).filter(Boolean) : (blue.claims || []).map(c => c.id));
  else if (pass === 'strengthen') chk = checkStrengthen(out, viewOf(m.id), { matchId: m.id, ledger, access });
  else if (pass === 'reattack-red') chk = checkReattackRed(out, (readMatchFile(DIR, src, m.id, 'strengthen.json') || {}).cards || []);
  else chk = checkReattackJudge(out, (readJSON(path.join(dir, `reattack-red-${m.round || 1}.json`), null) || {}).attacks || []);
  m.warnings = [...new Set([...(m.warnings || []), ...chk.warnings])].slice(0, 12);
  if (!chk.ok) return fail(chk.errors.join('；'));
  const minutes = Math.max(1, Math.round((Date.now() - t0) / 60000));
  if (m.roles && m.roles[role]) Object.assign(m.roles[role], { ok: true, minutes: (m.roles[role].minutes || 0) + minutes, startedAt: m.roles[role].startedAt || localIso() });
  // 寫入場次資料夾（舊場寫疊加資料夾；試驗資料夾永不寫）
  if (chk.data && Array.isArray(chk.data.sources)) chk.data.sources = await markBrokenLinks(chk.data.sources, 'title');
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
    const synth = (viewOf(m.id) || {}).synthesis;
    const decisions = placeFounderDecisions(m.id, synth ? synth.founderDecisions : [], m.id);
    if (decisions.ok && decisions.packId) m.packs.decisions = decisions.packId;
    const asks = placed.concat(decisions.ok ? decisions.placed : []);
    run.result = { summary: '辯論完結：等待你回應三個關鍵時刻', artifacts: [], founderNext: [], asks, matchId: m.id };
    addEvent({ actor: 'ai', type: 'run', title: '辯論完結：' + clip(m.topic.title, 30) + '，等待你回應', relatedIds: [m.id, run.id], moduleIds: ['ai-week', 'decisions'] });
    summary = '辯論完結，已放上待決事項';
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
  if (k === 'decision') {
    m.founder = m.founder || {};
    m.founder.decisions = m.founder.decisions || [];
    const view = viewOf(m.id), routes = view && view.synthesis ? view.synthesis.routes : [];
    for (const q of pack.questions) {
      const answer = store.answers[q.id];
      if (!answer) continue;
      const option = (q.options || []).find(o => o.text === answer.value);
      const index = (q.options || []).indexOf(option);
      const value = index >= 0 ? String.fromCharCode(65 + index) : String(answer.value || '');
      const decision = { questionId: q.id, question: q.ask, value, answer: answer.value, at: answer.at };
      const old = m.founder.decisions.findIndex(d => d.questionId === q.id);
      if (old >= 0) m.founder.decisions[old] = decision; else m.founder.decisions.push(decision);
      const matching = routes.filter(r => option && (option.text === r.name || option.text.replace(/^[A-C][.、：:\s]+/, '').trim() === r.name));
      if (matching.length === 1) { m.chosenRouteId = matching[0].id; m.chosenRouteDecisionId = q.id; }
      else if (m.chosenRouteDecisionId === q.id) { delete m.chosenRouteId; delete m.chosenRouteDecisionId; }
    }
    saveMatch(m);
    run.result = { summary: NAMES.dash.debateDecisionRecorded, artifacts: [], founderNext: [], matchId: m.id };
    return finish(run, 'done');
  }
  if (k === 'response') {
    if (m.founder && m.founder.respondedAt) { run.result = { summary: '已記錄；此場已開始轉強，今次答案只作紀錄。', artifacts: [], founderNext: [] }; return finish(run, 'done'); }
    const v = viewOf(m.id);
    const votes = Object.entries(pack.debate.refs || {}).map(([qid, ref]) => ({ ref, agree: val(qid) !== '不同意' }));
    const f = { ...(m.founder || {}), respondedAt: localIso(), votes, evidence: [], challenges: [], adoptedCardIds: [], rejectedCardIds: [] };
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
    run.result = { summary: '已記錄你的回應；' + (m.next === 'rejudge' ? '先請裁判重判，之後開始轉強。' : m.next ? 'Zero 開始轉強。' : '轉強卡等你採用。'), artifacts: [], founderNext: [], matchId: m.id };
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
    c.label = c.status === '唔採用' ? 'Zero 建議 · 未確認' : 'Zero 建議 · 你已認同';
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
    '5. `source` 欄位開頭的來源標籤（你原話、Zero 建議 · 未確認、Zero 建議 · 你已認同、Zero 解讀、外部事實 [數字]）要原樣保留，只改標籤後面的文字。Markdown 正文內的出處只寫來源標籤，例如「你原話：「……」」，不寫檔名或章節符號；如要說明出處，寫文件的中文名稱（例如「經營方向文件」）。「你原話」引號內的原話一字不改。',
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
      fs.mkdirSync(path.join(sb, 'out'), { recursive: true }); fs.mkdirSync(path.join(sb, 'in'), { recursive: true }); fs.mkdirSync(path.join(sb, 'ref'), { recursive: true }); writeBizContext(sb);
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
  for (const [key, f] of targets) { const r = await plainOne(run, key, f, ++n, refs); if (r) done.push(docNameOf(key, fs.readFileSync(f, 'utf8')) + '：' + ({ clean: '毋須改寫', ai: 'Zero 已改寫', 'ai+fallback': 'Zero 已改寫（另有機械替換）', fallback: '機械替換' }[r.mode] || r.mode) + (r.marked ? `，${r.marked} 處含內部用語` : '')); }
  const idxW = displayIndex(DIR), prevW = idxW._plainWarnings, nowW = targets.flatMap(([key]) => (idxW[key] && idxW[key].warnTags) || []);
  const st = loadState(), hw = (st.health || {}).warnings || [];
  const old = w => Array.isArray(prevW) ? prevW.includes(w) : /^(?:AI|Zero) 文字含(內部用語|口語字)：/.test(w);
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
const rhythmPack = (suffix, o) => ({ format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-' + suffix, next: null, askedBy: 'AI', askedAt: localIso(), fromRun: null, ...o,
  questions: o.questions || [] });
// 你嘅輸入（回覆、交資料、要求、記錄真實事件）：解除自動停、重設計數（3.8）；「暫停」嘅持續暫停唔會因此解除
function noteFounderInput(milestoneIds = null) {
  const s = loadState(), h = healthOf(s), was = h.autoStopped;
  h.autoStopped = false; delete h.autoStopReason; h.noProgressStreak = 0; h.lastInputAt = localIso();
  stopWarnings(h);
  if (was) { s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'shell', type: 'health', title: 'Zero 已恢復工作：收到你的輸入', relatedIds: [], moduleIds: ['system'] }); }
  // 當日卡住的工作（blockedOn）：創辦人輸入到達即解除，同日可再做（輸入關聯到站時只解除該站，否則全部；pace-lib.releaseBlocked）
  saveState(PACE.releaseBlocked(s, { milestoneIds }));
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
// 0.41.0：保險絲按節奏檔（標準 40、加速 50、衝刺 80；舊欄 aiStartsPerDay 不再讀取），啟動次數按「工作日」計——日常工作開工時鎖定工作日（跨午夜不歸零），其他工作用今日。
// 沙盒名以 run 編號開頭的行即使跨午夜仍計入該工作日（pace-lib.countStarts）。
let WORKDAY = '';
const workDayNow = () => WORKDAY || todayIso();
function startCounts() {
  let lines = []; try { lines = fs.readFileSync(STARTS, 'utf8').split('\n'); } catch { }
  const day = workDayNow(), st = loadState();
  // M2：沙盒名屬另一個工作日 run 的行（例如前一日 23:50 開工的衝刺在午夜後的啟動）只計入那一日，不因日期前綴再計入今日
  const mine = PACE.runIdsOfDay(st, day), others = ((st || {}).runs || []).filter(r => r && r.id && (r.workDay || PACE.workDayOf(r.startedAt)) !== day).map(r => r.id);
  if (others.length) lines = lines.filter(l => { const sb = String(l).split('\t')[2] || ''; return !others.some(id => sb.startsWith(id)) || mine.some(id => sb.startsWith(id)); });
  return PACE.countStarts(lines, day, { runIds: mine });
}
const startsToday = () => startCounts().total;
const budgetLeft = () => PACE.fuseOf(loadState()) - startCounts().total;

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
function nextActionDay(action, today) {
  if (action && /^\d{4}-\d{2}-\d{2}$/.test(String(action.date || ''))) return { day: action.date, raw: action.date, iso: true };
  return actionDay(action && action.text, today);
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
  const today = todayIso(), biz = businessType(), resultAsk = {
    service: '這星期完成了多少次服務？收到多少款項？',
    goods: '這星期賣出多少件？收到多少款項？',
    online: '這星期有多少人使用？收到多少款項？',
    platform: '這星期撮合了多少單？收到多少款項？',
    nonprofit: '這星期服務了多少人？取得多少資助或捐款？'
  }[(biz || {}).type] || '這星期有甚麼實際成果？（有數字請寫數字）', qs = [{ id: 'results', bind: 'results', ask: resultAsk, kind: 'text', effect: 'tentative' }], nea = (s.company || {}).nextExternalAction;
  const ad = nea && nea.text ? nextActionDay(nea, today) : null;
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
  // 公司以外的對象超過十四日沒有接觸：只問沒有接觸最久的一個（接觸以輸入及事件並集計；暫時維持的對象到期前不再問）
  for (const p of contactDueOf(DIR, { state: s, today, limit: 1 })) {
    const lc = p.lastContact, week = NAMES.t('contactYes', { n: p.name });
    qs.push({ id: 'contact', bind: 'contact', contact: { id: p.id }, about: p.name, ask: NAMES.t('contactAsk', { n: p.name, d: p.gapDays }), kind: 'choice',
      options: recOpts([week, U.contactSnooze, U.contactClose], week), value: week, effect: 'tentative',
      why: lc ? NAMES.t('contactWhy', { d: dayText(lc.date), t: clip(lc.text, 40) }) : NAMES.t('contactWhyNone', { d: dayText(p.addedAt) }) });
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
  const pack = rhythmPack('iv', { title: NAMES.t('interviewTitle', { d: dayText(iv.nextOn) }), context: U.interviewContext, afterConfirm: '選項答案即時記入公司紀錄；寫了文字答案就交 Zero 擬確認問題，經你確認才生效',
    todoType: 'interview', due: iv.nextOn, rhythm: { kind: 'interview', on: iv.nextOn }, questions: all });
  const placed = placePacks(DIR, [pack])[0];
  const s2 = loadState(); s2.interviews = { ...s2.interviews, packFor: iv.nextOn, packId: placed.id }; saveState(s2);
  log(`每週訪問已出題：${placed.id}（${all.length} 條）`);
  return placed;
}
function handleInterviewAnswer(run, pack, store, fresh) {
  const s = loadState(), iv = s.interviews = s.interviews || {}, today = todayIso(), said = [], texts = [], extra = [], placedNow = [], celebrations = [];
  const resultsPending = pack.questions.some(q => q.bind === 'results' && !String((store.answers[q.id] || {}).value || '').trim());
  iv.applied = iv.applied || {};
  const done = new Set(iv.applied[pack.id] || []);
  let structuredSeen = false;
  s.events = s.events || [];
  const ev = (type, title, ids) => s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type, title, relatedIds: ids, moduleIds: ['now', 'inputs'] });
  const has = id => pack.questions.some(q => q.id === id) || extra.some(q => q.id === id);
  const addQ = q => { if (!has(q.id)) extra.push({ effect: 'tentative', ...q }); };
  const neaNow = () => (s.company || {}).nextExternalAction || {};
  const activeMs = () => (s.milestones || []).filter(m => m.pathStatus === 'confirmed' && m.state === 'active').sort((x, y) => (x.order || 0) - (y.order || 0))[0];
  const replyAt = replySubmittedAt(run, Object.values(store.answers || {})[0]);
  let keptNewerFounderAction = false;
  const keepNewerFounderAction = action => {
    if (!founderUpdatedAfter(action, replyAt)) return false;
    if (!keptNewerFounderAction) said.push(U.founderNewerNext);
    keptNewerFounderAction = true;
    return true;
  };
  const setNext = (text, milestoneId, t, fields = {}) => {
    if (keepNewerFounderAction(neaNow())) return false;
    const title = t || '下一個對外動作改為：' + clip(text, 40);
    s.company = s.company || {}; s.company.nextExternalAction = { text: clip(text, 120), milestoneId: milestoneId || '', ...fields };
    said.push(title); ev('decision', title, [pack.id]);
    return true;
  };
  const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  for (const q of pack.questions) {
    const a = store.answers[q.id];
    if (!a || done.has(q.id) || !fresh.has(q.id)) continue;
    done.add(q.id);
    const val = String(a.value ?? '').trim(), opt = (q.options || []).find(o => o.text === val), unknown = !val || val === U.unknownLater;
    if (q.bind === 'results') {
      if (!val) continue;
      structuredSeen = true;
      const title = '本週成果：' + clip(val, 80);
      said.push(title);
      addEvent({ actor: 'founder', type: 'input', title, relatedIds: [pack.id], moduleIds: ['now', 'inputs'] }, s);
      continue;
    }
    if (q.bind === 'none' || q.bind === 'held') { if (!unknown && val !== U.interviewNone) texts.push(q.id); continue; }
    structuredSeen = true;
    if (q.bind === 'contact') {
      // 十四日跟進題：答題時對象已不是有效對象（被併走、不再接觸）就只記錄不寫入；選項次序固定（一星期內聯絡／暫時維持／不再接觸）
      const actors = (s.company || {}).actors || [], aid = resolveActorId(actors, q.contact && q.contact.id), a = actors.find(x => x.id === aid);
      if (!a || a.status === 'inactive' || a.mergedInto) continue;
      const idx = (q.options || []).findIndex(o => o.text === val);
      if (idx === 0) {
        const tid = 'ct-' + pack.id + '-' + aid;
        s.tasks = s.tasks || [];
        if (!s.tasks.some(t => t.id === tid)) s.tasks.push({ id: tid, title: NAMES.t('contactTaskTitle', { n: a.name }), owner: 'founder', status: 'planned', dueAt: addDays(today, 7), prospectId: aid, updatedAt: localIso() });
        said.push(NAMES.t('contactTaskTitle', { n: a.name })); ev('decision', NAMES.t('contactTaskTitle', { n: a.name }), [aid, pack.id]);
      } else if (idx === 1) {
        iv.contactSnooze = { ...(iv.contactSnooze || {}), [aid]: addDays(today, 14) };
        said.push(a.name + '：' + U.contactSnooze);
      } else if (idx === 2) {
        const r = applyActorOp(s, 'actorStatus', { id: aid, status: 'inactive' });
        if (r.ok) { mergeInPlace(s, r.state); said.push(a.name + '：' + U.contactClose); ev('decision', a.name + '：' + U.contactClose, [aid, pack.id]); }
      }
      continue;
    }
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
        if (keepNewerFounderAction(nea)) continue;
        const act = activeMs(), sug = act ? clip(String(act.event || act.short).trim(), 100) : '';
        s.company.nextExternalAction = { ...nea, pendingUpdate: true };
        addQ({ id: 'next2', bind: 'next2', about: '下一個對外動作', ask: NAMES.t('next2Ask', { t: clip(nea.text, 40) }), kind: 'choice',
          options: (sug ? [{ text: sug, rec: true, apply: { op: 'setNextExternalAction', text: sug, milestoneId: act.id } }] : []).concat([{ text: U.unknownLater, ...(sug ? {} : { rec: true }) }]),
          value: sug || U.unknownLater, why: act ? NAMES.t('next2Why', { s: act.short }) : U.staleWhyNone });
        said.push('「' + clip(nea.text, 30) + '」取消了；下一個對外動作待你確認');
      } else if (!opt && !unknown) texts.push(q.id);
    } else if (q.bind === 'newDate') {
      const nea = neaNow(), ad = nextActionDay(nea, today);
      if (isDay(val) && ad) {
        const explicitDate = isDay(nea.date);
        setNext(explicitDate ? nea.text : withDay(nea.text, ad, val), nea.milestoneId, '下一個對外動作改期至 ' + dayText(val), explicitDate ? { date: val } : {});
      }
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
      if (m && isDay(val)) {
        const replyAt = replySubmittedAt(run, a), overrideAt = (s.targetOverrideAt || {})[m.id];
        // 時間只記到秒；同一秒分唔到先後，保留已生效嘅日期，唔可以俾舊答案蓋走
        const replyTime = Date.parse(String(replyAt || '')), overrideTime = Date.parse(String(overrideAt || ''));
        if (Number.isFinite(replyTime) && Number.isFinite(overrideTime) && replyTime <= overrideTime) {
          said.push(NAMES.t('founderTargetNewer', { s: m.short, d: dayText(m.targetDate) }));
          continue;
        }
        const prior = s.targetOverride || {};
        s.targetOverride = { ...prior, [m.id]: val };
        s.targetOverrideBase = { ...(s.targetOverrideBase || {}), ...(Object.prototype.hasOwnProperty.call(prior, m.id) ? {} : { [m.id]: m.targetDate || '' }) };
        s.targetOverrideAt = { ...(s.targetOverrideAt || {}), [m.id]: replyAt || localIso() };
        m.targetDate = val; delete m.targetDateTentative;
        said.push('「' + m.short + '」目標日改為 ' + dayText(val)); ev('path', '目標日更新：' + m.short + '（' + dayText(val) + '）', [m.id, pack.id]);
      }
    } else if (q.bind === 'assume') {
      let ap = opt ? opt.apply : null;
      if (!opt) { const k = NAMES.evKey(val.replace(/^(?:改為|維持)/, '').replace(/[「」\s]/g, '')); const id = (((q.options || [])[0] || {}).apply || {}).id; ap = k && id ? { op: 'setAssumptionGrade', id, grade: k } : null; }
      const as = ap && ((s.company || {}).assumptions || []).find(x => x.id === ap.id);
      if (!as || (as.grade || 'guess') === ap.grade) continue;
      const from = as.grade || 'guess';
      if (EV_RANK(ap.grade) > EV_RANK(from)) noteCelebration(s, { assumption: as, from, grade: ap.grade, batch: celebrations });
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
  if (structuredSeen && !resultsPending && iv.lastFor !== pack.rhythm.on) {
    const r = rhythmOf(s);
    let next = addDays(pack.rhythm.on, 7);
    if (next <= today || !isWeekday(next, r.interviewWeekday)) next = nextWeekday(pack.rhythm.on > today ? pack.rhythm.on : today, r.interviewWeekday);
    Object.assign(iv, { lastOn: today, lastFor: pack.rhythm.on, nextOn: next, count: (iv.count || 0) + 1, lastSummary: said.length ? said.slice(0, 5) : ['沒有變化'], changed: said.join('；') });
    ev('input', '每週訪問已作答（' + dayText(pack.rhythm.on) + '）', [pack.id]);
    if (iv.count % 4 === 0) monthly = true;
  }
  finishCelebration(s, celebrations);
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
  const summary = (resultsPending ? '已記錄你的答案；本週成果尚未填寫。' : said.length ? '已更新：' + said.join('；') + '。' : '已記錄你的答案；公司紀錄沒有變化。') + (extra.length ? '另有 ' + extra.length + ' 條補充題已加入這份訪問。' : '') + (structuredSeen && !resultsPending ? '下次訪問：' + dayText(iv.nextOn) + '。' : '') + (monthly ? '每月覆核已放上待決事項。' : '');
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
  const keptNewerFounderAction = nea && nea.milestoneId === m.id && founderUpdatedAfter(nea, replySubmittedAt(run, a));
  if (nea && nea.milestoneId === m.id && !keptNewerFounderAction) s.company.nextExternalAction = { ...nea, pendingUpdate: true };
  s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'path', title: '撤回一站：' + m.short, relatedIds: [m.id, pack.id], moduleIds: ['paths', 'now'] });
  saveState(s);
  run.result = { summary: '已撤回「' + m.short + '」；路線由下一站接上' + (keptNewerFounderAction ? '；' + U.founderNewerNext : '') + '。', artifacts: [], founderNext: [] };
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
  return placePacks(DIR, [rhythmPack('mr', { title: NAMES.t('monthlyTitle', { d: dayText(todayIso()) }), context: '每月覆核一次：Zero 可自行處理的事及目前目標。', afterConfirm: '答案即時生效', todoType: 'decision', rhythm: { kind: 'monthly' }, questions: qs })])[0];
}
async function handleMonthlyAnswer(run, pack, store) {
  const s = loadState(), said = [], today = todayIso(); let narrow = false;
  s.events = s.events || [];
  const p = store.answers.perm, gq = store.answers.goal;
  if (p) { if (p.value === U.monthlyPermNarrow) { narrow = true; said.push('你要求收窄 Zero 可自行處理的事'); } else { s.company = s.company || {}; s.company.permissionsReviewedAt = today; said.push('Zero 可自行處理的事照舊'); } }
  if (gq && String(gq.value).trim() && gq.value !== U.monthlyGoalKeep && gq.value !== U.unknownLater) {
    const old = (s.goals && s.goals.quarter) || {};
    s.goals = { ...(s.goals || {}), quarter: { ...old, text: clip(String(gq.value).trim(), 120), setAt: today, by: 'founder' } };
    said.push('目前目標改為：' + clip(gq.value, 40));
  } else if (gq) said.push('目前目標不變');
  for (const t of said) s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'decision', title: '每月覆核：' + t, relatedIds: [pack.id], moduleIds: ['decisions'] });
  saveState(s);
  run.result = { summary: '已記錄：' + said.join('；') + '。', artifacts: [], founderNext: [] };
  if (checkupStale() && readJSON(CONFIRMED, null)) await brainStep(run, 'checkup');
  if (narrow) return aiAfterAsk(run, { ...pack, next: { task: '創辦人要求收窄 Zero 可自行處理的事：按公司概覽「Zero 可自行處理的事」三格，擬一個收窄方案，寫成問題包讓創辦人逐項確認（每項附建議同一句理由）；唔好自己改任何權限。' } });
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
  if (go) { const was = h.pausedByFounder; h.pausedByFounder = false; said = 'Zero 會在下一次排定時間繼續工作'; if (was) resumePaused(); }
  else { h.pausedByFounder = true; said = 'Zero 已暫停；要恢復時在待決事項按「繼續」'; }
  stopWarnings(h);
  s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'founder', type: 'health', title: go ? '你選擇讓 Zero 繼續工作' : '你選擇暫停 Zero', relatedIds: [pack.id], moduleIds: ['system'] });
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
// only：外殼多件日循環每次只交一件（陣列，可以是空＝讓 Zero 自行準備下一個對外動作）；沒有傳＝0.40.2 的整份清單
function rhythmLedger(type, only = null) {
  const s = loadState(), today = todayIso();
  const ms = (s.milestones || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99));
  const canDoOf = t => ({ title: t.title, next: t.next || '', firstBatch: !!t.firstBatch, milestoneId: t.milestoneId || '' });
  const canDo = Array.isArray(only) ? only.map(canDoOf) : (s.tasks || []).filter(t => ownerKind(t.owner) === 'ai' && t.status !== 'done' && t.status !== 'cancelled' && t.status !== 'waiting').map(canDoOf);
  // 創辦人有明確日子的行動亦是 AI 下一次安排的事實；改日期後由已合併帳本直接讀入。
  const founderActions = (s.tasks || []).filter(t => ownerKind(t.owner) !== 'ai' && t.dueAt && t.status !== 'done' && t.status !== 'cancelled' && t.column !== 'done' && t.column !== 'cancelled').map(t => ({ title: t.title, dueAt: t.dueAt, milestoneId: t.milestoneId || '' }));
  const open = listPacks(DIR).filter(p => p.open).map(p => { const f = loadPack(DIR, p.id) || {}; return { title: p.title, questions: (f.questions || []).map(q => q.ask) }; });
  const second = ms.find(m => !secondProblem(s, m.id));
  return {
    today, runType: type, missingAnswers: ((s.intake || {}).missing || []).map(p => NAMES.field[p] || p),
    milestones: ms.filter(m => m.pathStatus !== 'retired').map(m => ({ id: m.id, short: m.short, state: m.state, pathStatus: m.pathStatus, kind: m.kind, event: m.event, depth: m.depth, targetDate: m.targetDate || '', trial: m.trial ? { until: m.trial.until, verdict: m.trial.verdict || '' } : undefined })),
    nextExternalAction: (s.company || {}).nextExternalAction || null,
    assumptions: ((s.company || {}).assumptions || []).map(a => ({ text: a.text, grade: NAMES.evName(a.grade || 'guess') })),
    canDo, founderActions, openQuestions: open, notYetKnown: openUnknowns(DIR).map(u => ({ question: u.question, until: u.until })),
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
/* ---------- 統籌校對鏈（0.41.0；狀態表 Z27–Z32、Z54）----------
   對外產出（pace-lib.isExternal，取較嚴）交出後先由統籌校對一次（校對 AI 只讀、只寫 out/proofread.json）；發回則同一崗位重寫一次，再校對一次；
   第二次仍發回：照交創辦人並標「仍有 N 處要留意」。每份產出最多 2 次校對＋1 次重寫。內部產出只做程式核對，不開校對。 */
const issueLine = i => [i.where, i.what, i.fix ? '改法：' + i.fix : ''].filter(Boolean).join('——');
// 校對一次：回 { failed, verdict, line, issues }；failed＝校對沒有做成（工具失敗、拒絕開啟、說明不合格）
async function proofreadOnce(run, id, st, sel, card, task, arts, round, lastIssues) {
  const sb = newSandbox(run, null, id + '-pf' + round);
  writeConfirmedPage(sb);
  writeJSON(path.join(sb, 'ledger.json'), rhythmLedger('rhythm', []));
  const files = [{ name: 'confirmed-page.md', about: '創辦人已確認的公司概覽' }, { name: 'ledger.json', about: '公司紀錄摘要：路線、假設、名單' }, { name: 'ai-proofread.md', about: '校對的六項檢查及 out/proofread.json 格式' }];
  fs.copyFileSync(path.join(ROOT, 'ai-proofread.md'), path.join(sb, 'ai-proofread.md'));
  arts.forEach((a, k) => { const name = 'draft-' + (k + 1) + '.md'; fs.writeFileSync(path.join(sb, name), a.text); files.push({ name, about: '要校對的產出：' + clip(a.title, 30) }); });
  const ms = task ? (st.milestones || []).find(m => m && m.id === task.milestoneId) : null, roleTitle = card ? ROLES.titleOf(card) : 'Zero 統籌';
  const glossary = [{ term: roleTitle, meaning: card ? clip(card.mission || '', 80) : '派工、校對，並承擔不屬任何崗位的工作' }]; if (ms && ms.short) glossary.push({ term: ms.short, meaning: clip(ms.event || '公司路線上的一站', 80) });
  const brief = buildProofreadBrief({ artifactTitle: arts.map(a => a.title).join('、'), roleTitle, station: ms ? ms.short : '公司整體', doneWhen: ms ? ms.deliveryCondition : '', files, round, lastIssues: (lastIssues || []).map(issueLine), glossary });
  const ck = checkBrief(brief, { files: [...files.map(f => f.name), 'task.md'], names: glossary.map(g => g.term) });
  if (!ck.ok) { log(`${id} 校對說明核對不合格：${ck.errors.map(e => e.text).join('；')}`); return { failed: true, reason: 'brief' }; }
  fs.writeFileSync(path.join(sb, 'task.md'), brief);
  writeJSON(path.join(sb, 'job.json'), { type: 'proofread', round });
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (!r.ok || r.waiting) return { failed: true, reason: r.reason || '' };
  // 不可解析或六項不齊：當發回處理（Z32），並補一項讓重寫有依據
  const chk = PACE.checkProofreadResult(readJSON(path.join(sb, 'out', 'proofread.json'), null), { styleIssues: NAMES.styleIssues });
  if (chk.ok) return { failed: false, verdict: chk.verdict, line: chk.line, issues: chk.issues };
  log(`${id} 校對結果不合格，當發回：${(chk.errors || []).join('；')}`);
  return { failed: false, verdict: 'return', line: NAMES.t('qa_unreadable'), issues: chk.issues && chk.issues.length ? chk.issues : [{ where: NAMES.t('qa_unreadableWhere'), what: NAMES.t('qa_unreadableWhat'), fix: NAMES.t('qa_unreadableFix') }] };
}
// 校對發回後同一崗位重寫一次（類別 qa-rewrite）；重寫後同樣過用字改寫。回 { ok, artifacts }
async function qaRewrite(run, id, st, sel, card, task, arts, issues, ctx) {
  const sb = newSandbox(run, null, id + '-rw');
  writeConfirmedPage(sb);
  writeJSON(path.join(sb, 'ledger.json'), rhythmLedger('rhythm', task ? [task] : []));
  const prev = arts.map((a, k) => { const name = 'previous-' + (k + 1) + '.md'; fs.writeFileSync(path.join(sb, name), a.text); return { name, about: '上次交出、需要改正的產出：' + clip(a.title, 30) }; });
  const b = itemBrief(st, { ...sel, rewriteIssues: issues.map(issueLine) }, sb, ctx.workDay, prev);
  let text = fs.readFileSync(path.join(ROOT, 'ai-rhythm.md'), 'utf8');
  const briefFailed = !b.ok;   // 說明核對不合格：改用通用說明＋校對問題清單，並計入當日連續不合格（M1）
  if (b.ok) text += '\n\n---\n\n' + b.text;
  else { text += fallbackNotes(task, issues.map(issueLine)); log(`${id} 重寫說明核對不合格，改用通用說明：${b.errors.map(e => e.text).join('；')}`); run.warnings = [...(run.warnings || []), NAMES.t('brief_fallback')]; }
  fs.writeFileSync(path.join(sb, 'task.md'), text);
  writeJSON(path.join(sb, 'job.json'), { type: 'qa-rewrite', ...(task ? { taskId: task.id } : {}) });
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (!r.ok || r.waiting) return { ok: false, briefFailed };
  await rewriteOnce(sb, run);
  const chk = checkReceipt(path.join(sb, 'out'), false);
  if (!chk.ok) return { ok: false, briefFailed };
  // 重寫後的產出取代原產出（工作資料夾內的檔一併換掉），收據換成重寫的收據
  const dir = path.join(DIR.work, id);
  for (const a of arts) fs.rmSync(path.join(dir, a.file), { force: true });
  fs.cpSync(path.join(sb, 'out'), dir, { recursive: true, force: true });
  const s = loadState(); s.artifactHashes = (Array.isArray(s.artifactHashes) ? s.artifactHashes : []).concat(chk.receipt.artifacts.map(a => fnv(a.text))).slice(-300); saveState(s);
  return { ok: true, briefFailed, artifacts: chk.receipt.artifacts, receipt: chk.receipt };
}
// 交出之後的校對鏈。回 { qa, artifacts, external, activation, needsAcceptance }
async function qaChain(run, id, st, sel, card, task, fresh, rc, ctx) {
  const activation = !!(card && task && task.id === card.activationTaskId);
  const actors = ((st.company || {}).actors || []);
  const external = fresh.some(a => PACE.isExternal({ type: a.type, title: a.title, text: a.text }, { selfReport: a.audience || rc.audience || '', actors }).external);
  let qa = { audience: external ? 'external' : 'internal', verdict: external ? 'pending' : 'none', line: '', rounds: 0, issues: [] }, arts = fresh, toolFail = false, briefFailed = false;
  if (external) {
    for (let round = 1; round <= 2; round++) {
      const pf = await proofreadOnce(run, id, st, sel, card, task, arts, round, qa.issues);
      if (pf.failed) {
        // 校對沒有做成（工具失敗、說明不合格、次數用盡）：不留 pending——照交並標 flagged，只有一項「統籌校對未能完成」；工具失敗計入連續失敗
        toolFail = pf.reason !== 'brief' && pf.reason !== U.skip_budgetExhausted;
        qa = { ...qa, verdict: 'flagged', line: NAMES.t('qa_unfinished'), issues: [{ where: NAMES.t('qa_unreadableWhere'), what: NAMES.t('qa_unfinishedWhat'), fix: NAMES.t('qa_unfinishedFix') }] }; break;
      }
      const ap = PACE.applyProofread(qa, { verdict: pf.verdict, line: pf.line, issues: pf.issues });
      qa = ap.qa;
      if (ap.next === 'rewrite') {
        const rw = await qaRewrite(run, id, st, sel, card, task, arts, qa.issues, ctx);
        if (rw.briefFailed) briefFailed = true;
        if (!rw.ok) { toolFail = true; qa = { ...qa, verdict: 'flagged', rounds: 2 }; break; }   // 重寫沒有做成：照交原稿並標仍有問題
        arts = rw.artifacts.map(a => ({ ...a, audience: a.audience || 'external' })); continue;
      }
      break;
    }
  }
  return { qa, artifacts: arts, external, activation, toolFail, briefFailed, needsAcceptance: PACE.needsAcceptance({ external, activation, ending: 'artifact' }) };
}
// 驗收題（R3；Z54）：對外產出及啟用任務交出後放一包；沿用 todoType: 'acceptance'
function placeAcceptance(run, workId, sel, card, task, arts, qa, activation) {
  const art = arts[0] || {}, roleTitle = card ? ROLES.titleOf(card) : '';
  const options = [{ text: '接受', rec: true }, { text: NAMES.t('role_optReturn') }].concat(activation ? [{ text: NAMES.t('role_optAcceptRedirect') }] : []);
  const qaText = qa.audience === 'external' ? (qa.verdict === 'pass' || qa.verdict === 'pass_with_notes' ? NAMES.t('qa_delivered', { t: roleTitle || 'Zero' }) : qa.verdict === 'flagged' ? NAMES.t('qa_flagged', { t: roleTitle || 'Zero', n: (qa.issues || []).length }) : NAMES.t('qa_pending')) : NAMES.t('qa_checked', { t: roleTitle || 'Zero' });
  // 題層 q.acceptance（畫面讀 QA 句）；pack 層另帶全文、issueCount、workId
  const qacc = { taskId: task.id, teammateId: card ? card.id : '', roleTitle, avatarKind: card ? card.avatarKind || ROLES.avatarKindOf(roleTitle) : 'lead', artifactTitle: art.title || '', artifactFile: art.file || '', qaVerdict: qa.verdict, qaLine: qa.line || '', activation: !!activation };
  const pack = { format: 'startup-os.ask/0.1', id: 'ask-' + stamp() + '-acc', title: activation ? NAMES.t('role_activationAsk', { t: '「' + roleTitle + '」' }) : clip('驗收：' + task.title, 60),
    context: (roleTitle ? '「' + roleTitle + '」' : 'Zero ') + '已交出「' + (art.title || task.title) + '」。' + qaText, afterConfirm: '接受即完成；退回 Zero 會按你的原因再改。', next: null, askedBy: 'AI', askedAt: localIso(), fromRun: workId, todoType: 'acceptance',
    acceptance: { ...qacc, workId, ...(qa.verdict === 'flagged' ? { issueCount: (qa.issues || []).length } : {}), artifact: art.file ? { title: art.title, text: art.text } : null },
    questions: [
      { id: 'accept', priority: 1, ask: activation ? NAMES.t('role_activationAsk', { t: '「' + roleTitle + '」' }) : '這份產出可以用嗎？', kind: 'choice', effect: 'now', options, value: options[0].text, acceptance: qacc },
      { id: 'reason', priority: 2, ask: '如果退回，要改甚麼？', kind: 'text', effect: 'tentative', value: '不用改', why: '接受就毋須填寫。', acceptance: qacc }
    ] };
  return placePacks(DIR, [pack])[0];
}

/* ---------- Zero 擬崗位（0.41.0；狀態表 Z1–Z22）：讀已確認公司概覽、路線及名單，擬崗位卡，題目放待決事項（每包最多 3 題）。
   狀態家 state.rolesSync（純函數在 roles-ops.mjs，形狀照 peopleSync）。AI 只擬卡；核對、確認、寫入、啟用全部由外殼做。 ---------- */
const openRolesPack = () => listPacks(DIR).filter(p => p.open).map(p => loadPack(DIR, p.id)).find(p => p && p.rolesSync) || null;
const stationName = (s, id) => ((s.milestones || []).find(m => m && m.id === id) || {}).short || '';
// 給畫面直接顯示的崗位卡摘要（全部是可顯示的字串）
function roleCardView(s, card, extra = {}) {
  const actors = ((s.company || {}).actors || []).filter(Boolean), title = ROLES.titleOf(card);
  const own = ((card.bounds || {}).askFirst || []).filter(x => !ROLES.PERMISSIONS_DEFAULT.askFirst.includes(x));
  return { id: card.id || '', title, avatarKind: card.avatarKind || ROLES.avatarKindOf(title), mission: card.mission || '',
    stations: (card.milestoneIds || []).map(id => stationName(s, id)).filter(Boolean).concat(card.station && card.station.short ? [card.station.short] : []),
    supports: ROLES.supportsLines(card, actors).map(l => mixSpace(l.name + '（' + (l.role || NAMES.dash.ppl_kind_team) + '）')),
    askFirst: own.length ? own : ROLES.PERMISSIONS_DEFAULT.askFirst.slice(0, 3), activation: (card.activation && card.activation.title) || ((s.tasks || []).find(x => x && card.activationTaskId && x.id === card.activationTaskId) || {}).title || '', ...extra };
}
function roleOptions(card, extra = {}) {
  const mk = (key, op, more = {}) => ({ text: NAMES.t(key), apply: { op, card, ...extra }, ...more });
  return [mk('role_optAccept', 'roleAccept', { rec: true }), mk('role_optRename', 'roleRename', { input: true }), mk('role_optDecline', 'roleDecline')];
}
// 崗位確認題的題目：任務一句（崗位卡已顯示使命），不把使命句重複一次（names.js 日後可改用 role_confirmAsk 鍵）
const ROLE_CONFIRM_ASK = NAMES.t('role_confirmAsk');
function roleQuestion(s, card, i, askText = '') {
  const options = roleOptions(card), title = ROLES.titleOf(card);
  return { id: 'q' + (i + 1), priority: i + 1, about: clip(title, 30), ask: mixSpace(askText || ROLE_CONFIRM_ASK), judge: clip(card.strategy || '', 120), kind: 'choice', effect: 'now', options, value: options[0].text,
    why: clip(card.strategy || card.mission || title, 200), inputHint: NAMES.t('role_renameHint'), roleCard: roleCardView(s, card) };
}
function sameStationTaken(s, card) { return (card.milestoneIds || []).some(m => ROLES.ownerOfStation(s, m)); }
// 最少事務的一張卡併入最相關的一張（超過軟上限時的合併題）
function mergeCandidates(s) {
  const live = ROLES.countedCards(s); if (live.length < 2) return null;
  const from = live.slice().sort((a, b) => (a.milestoneIds || []).length - (b.milestoneIds || []).length || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
  const rest = live.filter(c => c.id !== from.id);
  const into = rest.find(c => (c.targets || []).some(k => (from.targets || []).includes(k))) || rest.sort((a, b) => (b.milestoneIds || []).length - (a.milestoneIds || []).length)[0];
  return { from, into };
}
function placeMergePack(s) {
  const m = mergeCandidates(s); if (!m) return null;
  const yes = { text: NAMES.t('role_optMergeYes'), rec: true, apply: { op: 'roleMerge', fromId: m.from.id, intoId: m.into.id } }, no = { text: NAMES.t('role_optMergeNo'), apply: { op: 'roleKeep' } };
  const q = { id: 'q1', priority: 1, about: clip(ROLES.titleOf(m.from), 30), ask: mixSpace(NAMES.t('role_mergeAsk', { a: ROLES.titleOf(m.from), b: ROLES.titleOf(m.into) })), judge: NAMES.t('role_overCap'), kind: 'choice', effect: 'now', options: [yes, no], value: yes.text, why: NAMES.t('role_overCap'), roleCard: roleCardView(s, m.from) };
  return placePacks(DIR, [rhythmPack('rm', { title: NAMES.t('role_confirmTitle'), context: NAMES.t('role_confirmContext'), afterConfirm: NAMES.t('role_confirmAfter'), todoType: 'decision', rolesSync: { key: (s.rolesSync || {}).for || '', kind: 'merge' }, questions: [q] })])[0];
}
function placeRolesBatch(s) {
  const rs = s.rolesSync || {}, declined = rs.declined || {};
  // 擱置卡放出前重新核對：站已被另一張卡佔用（同批先答的題或路線已變）的丟棄；已拒絕的稱號不再問
  const pending = (rs.pending || []).filter(c => c && (c.splitFrom || !sameStationTaken(s, c)));
  const { items, rest } = ROLES.nextRoleBatch(pending, declined);
  if (!items.length) { if ((rs.pending || []).length) { const s0 = loadState(); s0.rolesSync = { ...(s0.rolesSync || {}), pending: [] }; saveState(s0); } return null; }
  // 已啟用＋待啟用達 6 張：先問合併（Z19）；創辦人答「不合併，照加」才放出新卡
  if (ROLES.overCap(s) && !rs.capOk && !openRolesPack()) { const mp = placeMergePack(s); if (mp) return mp; }
  const placeAs = items[0].splitFrom ? 'split' : items[0].needsStation && items[0].stationReq ? 'addRole' : 'confirm';
  const batch = placeAs === 'addRole' || placeAs === 'split' ? [items[0]] : items.filter(c => !c.needsStation && !c.splitFrom);
  const restAll = pending.filter(c => !batch.includes(c));
  if (!batch.length) { const s0 = loadState(); s0.rolesSync = { ...(s0.rolesSync || {}), pending: restAll.filter(c => !c.needsStation) }; saveState(s0); return null; }
  let pack;
  if (placeAs === 'split') {
    const c = batch[0], from = ROLES.cardById(s, c.splitFrom);
    if (!from) { const s0 = loadState(); s0.rolesSync = { ...(s0.rolesSync || {}), pending: restAll }; saveState(s0); return null; }
    pack = rhythmPack('rs', { title: NAMES.t('role_confirmTitle'), context: NAMES.t('role_confirmContext'), afterConfirm: NAMES.t('role_confirmAfter'), todoType: 'decision', rolesSync: { key: rs.for || '', kind: 'split', teammateId: from.id }, questions: [roleQuestion(s, c, 0, mixSpace(NAMES.t('role_splitAsk', { t: ROLES.titleOf(from), a: ROLES.titleOf(from), b: ROLES.titleOf(c) })))] });
  } else if (placeAs === 'addRole') {
    const c = batch[0], req = c.stationReq, short = req.add.short;
    const yes = { text: NAMES.t('role_optAccept'), rec: true, apply: { ...req } }, no = { text: NAMES.t('role_optDecline'), apply: { keep: true } };
    const q1 = { id: 'q1', priority: 1, about: clip(short, 30), ask: mixSpace(NAMES.t('role_addStationAsk', { s: short })), judge: clip(req.add.event, 120), kind: 'choice', effect: 'now', options: [{ ...yes, text: NAMES.t('role_addStationYes') }, { ...no, text: NAMES.t('role_addStationNo') }], value: NAMES.t('role_addStationYes'),
      why: clip(req.add.event, 200), roleCard: { id: '', title: short, avatarKind: 'operations', mission: req.add.event, stations: [short], supports: [], askFirst: [], activation: '' } };
    const q2 = roleQuestion(s, c, 1, mixSpace(NAMES.t('role_addRoleAsk', { t: ROLES.titleOf(c) })));
    pack = rhythmPack('rl', { title: NAMES.t('role_confirmTitle'), context: NAMES.t('role_confirmContext'), afterConfirm: NAMES.t('role_confirmAfter'), todoType: 'decision', rolesSync: { key: rs.for || '', kind: 'addRole' }, questions: [q1, q2] });
  } else {
    const qs = batch.map((c, i) => roleQuestion(s, c, i, c.suggestFor ? mixSpace(NAMES.t('role_suggestAsk', { t: ROLES.titleOf(c), s: c.suggestFor })) : ''));
    pack = rhythmPack('rl', { title: NAMES.t('role_confirmTitle'), context: NAMES.t('role_confirmContext'), afterConfirm: NAMES.t('role_confirmAfter'), todoType: 'decision', rolesSync: { key: rs.for || '', kind: 'confirm' }, followAll: true, questions: qs });
  }
  const placed = placePacks(DIR, [pack])[0];
  const s2 = loadState(); s2.rolesSync = { ...(s2.rolesSync || {}), pending: restAll, packId: placed.id };
  s2.events = s2.events || []; s2.events.push({ id: 'e' + stamp() + '-' + s2.events.length, at: localIso(), actor: 'ai', type: 'brain', title: NAMES.t('rolesDraftDone', { n: pack.questions.length }), relatedIds: [placed.id], moduleIds: ['ai-week', 'now'] });
  saveState(s2);
  log(`Zero 擬崗位已出題：${placed.id}（${pack.questions.length} 條，擱置 ${restAll.length} 張）`);
  return placed;
}
function rolesFail(run, key, label, due, reason) {
  const why = clip(String(reason || NAMES.t('rolesSyncFailed')).replace(/\s+/g, ' '), 80);
  const s = ROLES.markRolesFailed(loadState(), { key: due.key, today: todayIso(), reason: why });
  // 重擬崗位卡失敗：清走該卡的「已問改卡」記錄，下一次日常工作會再問創辦人改卡或取消（否則卡永遠停在待啟用）
  if (s.rolesSync) { if (s.rolesSync.recardAsked) for (const id of s.rolesSync.recard || []) delete s.rolesSync.recardAsked[id]; delete s.rolesSync.wantRole; delete s.rolesSync.recard; }
  saveState(s);
  step(run, key, label, 'failed', why);
  log(`${run.id} Zero 擬崗位未能完成：${why}`);
  return false;
}
// 擬崗位材料（roles-input.json，欄位照 ai-roles.md）
function rolesInput(s, maxCards) {
  const rs = s.rolesSync || {}, actors = ((s.company || {}).actors || []).filter(a => a && !a.mergedInto);
  return { maxCards,
    stations: (s.milestones || []).filter(m => m && m.pathStatus !== 'retired').sort((a, b) => (a.order || 99) - (b.order || 99)).map(m => ({ id: m.id, short: m.short || m.title || '', event: m.event || '', deliveryCondition: m.deliveryCondition || '', witness: m.witness || '', pathStatus: m.pathStatus || 'confirmed', state: m.state || 'not_started', actorName: m.actorName || '' })),
    people: actors.slice(0, 80).map(a => ({ id: a.id, name: a.name, kind: kindOf(a), role: a.role || '', ...(kindOf(a) === 'team' ? { team: { type: (a.team || {}).type || '', state: (a.team || {}).state || 'active' } } : {}) })),
    existingCards: ROLES.liveCards(s).map(t => ({ title: ROLES.titleOf(t), milestoneIds: t.milestoneIds || [] })),
    declined: Object.keys(rs.declined || {}).filter(k => /^(title|station):/.test(k)),
    inputs: (s.inputs || []).filter(i => i && i.id).slice(-20).map(i => ({ id: i.id, title: clip(i.title || '', 60) })),
    permissions: ROLES.permissionsOf(s) };
}
const NEW_STATION = '__new';
// 核對 out/roles.json：加崗位模式的卡可帶 station（路線沒有合適的站），用暫時的站編號通過核對後還原，另存 stationReq（roles-ops.stationRequest）
function checkRolesOut(raw, s, mode, lenient) {
  const rs = s.rolesSync || {}, pendingNew = ((s.peopleSync || {}).pending || []).filter(x => x && x.kind === 'newActor').map(x => x.name);
  const isNew = c => mode === 'add' && c && typeof c === 'object' && c.station && typeof c.station === 'object';
  let r = raw, reqs = new Map();
  let st = s;
  if (mode === 'add' && raw && Array.isArray(raw.cards)) {
    st = { ...s, milestones: [...(s.milestones || []), { id: NEW_STATION, short: '', pathStatus: 'confirmed' }] };
    r = { ...raw, cards: raw.cards.map(c => {
      if (!isNew(c)) return c;
      const req = ROLES.stationRequest(s, c.station); if (!req) return { ...c, title: c.title, milestoneIds: [] };   // 四格不齊：下面核對會丟棄
      reqs.set(String(c.title || '').trim(), req);
      return { ...c, milestoneIds: [...new Set([...(c.milestoneIds || []), NEW_STATION])], activation: { ...(c.activation || {}), milestoneId: NEW_STATION } };
    }) };
  }
  const ctx = { state: st, actors: ((s.company || {}).actors || []), extraNames: pendingNew, styleIssues: NAMES.styleIssues, inputIds: (s.inputs || []).map(i => i && i.id).filter(Boolean), first: mode === 'first' && !ROLES.liveCards(s).length, lenient: lenient || mode !== 'first' };
  const chk = ROLES.checkRoleCards(r, ctx);
  chk.cards = chk.cards.map(c => {
    const req = reqs.get(c.title);
    if (!req) return c;
    return { ...c, milestoneIds: c.milestoneIds.filter(x => x !== NEW_STATION), activation: { ...c.activation, milestoneId: '' }, needsStation: true, stationReq: req };
  });
  if (mode === 'add') chk.cards = chk.cards.filter(c => c.needsStation || (c.milestoneIds || []).length);
  return chk;
}
const ROLES_MODE_NOTE = {
  add: '\n\n## 這次的特別要求\n\n創辦人要求增加一個崗位（原話在 `roles-input.json` 的 `request`）。這次最多擬一張卡。如果路線上已有合適、而且還沒有崗位的站，`milestoneIds` 就寫那一站；如果路線上沒有合適的站，`milestoneIds` 寫空清單 `[]`、啟用任務的 `milestoneId` 寫空字串，並在卡內加 `station`：`{ "short": "站名，12 字內", "event": "這一站要發生的事，120 字內", "witness": "要點頭的人", "evidence": "真實證據的形式", "deliveryCondition": "完成條件", "targetDate": "YYYY-MM-DD（可省略）" }`，四格都要寫。`unassigned` 寫空清單。\n',
  suggest: '\n\n## 這次的特別要求\n\nZero 發現有一類工作一直由統籌承擔，值得設一個崗位（資料在 `roles-input.json` 的 `request`）。這次最多擬一張卡，負責 `request` 指出的站。`unassigned` 寫空清單。\n',
  split: '\n\n## 這次的特別要求\n\n某個崗位負責的事太多，創辦人需要把其中幾個站拆給新崗位（資料在 `roles-input.json` 的 `request`：`moveStations` 是要拆出的站）。這次只擬一張新卡，`milestoneIds` 就是 `moveStations` 的站，稱號要與原崗位不同。`unassigned` 寫空清單。\n',
  recard: '\n\n## 這次的特別要求\n\n某個崗位的啟用任務已被創辦人退回兩次。請為它重擬一張卡（資料在 `roles-input.json` 的 `request`，內有退回原因），負責同樣的站，稱號可以不同，啟用任務要換成更貼近創辦人期望的題目。這次只擬一張卡。`unassigned` 寫空清單。\n'
};
async function rolesStep(run, due, key = 'roles') {
  const label = NAMES.t('brainJob_roles');
  if (due.due === 'batch') {
    const p = placeRolesBatch(loadState());
    if (p) { step(run, key, label, 'done', NAMES.t('rolesDraftDone', { n: p.count })); run.result = { summary: NAMES.t('rolesDraftDone', { n: p.count }), artifacts: [], founderNext: [], asks: [p] }; return true; }
    log(`${run.id} 擬崗位：擱置的卡已全部失效`);
    step(run, key, label, 'done', NAMES.t('rolesDraftNone')); run.result = { summary: NAMES.t('rolesDraftNone'), artifacts: [], founderNext: [] }; return true;
  }
  const cert = certified(ROOT, DIR.ledger);
  if (pausedNow()) return rolesFail(run, key, label, due, U.skip_pausedByFounder);
  if (!cert.host) return rolesFail(run, key, label, due, cert.reason);
  if (budgetLeft() <= 0) return rolesFail(run, key, label, due, U.skip_budgetExhausted);
  let s = loadState();
  const page = loadPage(), c = readJSON(CONFIRMED, null);
  if (!page || !c) return rolesFail(run, key, label, due, NAMES.t('rolesSyncFailed'));
  const rs = s.rolesSync || {};
  const mode = Array.isArray(rs.recard) && rs.recard.length ? 'recard' : rs.wantRole ? (['suggest', 'split'].includes(rs.wantRole.kind) ? rs.wantRole.kind : 'add') : 'first';
  const recardId = mode === 'recard' ? rs.recard[0] : '';
  // 重擬卡：暫時把舊卡當作已取消，它原本負責的站才不會被當成「已有負責崗位」
  let ctxState = s;
  if (mode === 'recard') { ctxState = { ...s, teammates: (s.teammates || []).map(t => t && t.id === recardId ? { ...t, lifecycle: 'retired' } : t) }; }
  // 拆分：原卡暫時只留保留的站，拆出的站才算沒有負責崗位
  if (mode === 'split') ctxState = { ...s, teammates: (s.teammates || []).map(t => t && t.id === rs.wantRole.teammateId ? { ...t, milestoneIds: rs.wantRole.keepIds } : t) };
  const sb = path.join(DIR.sandbox, run.id + '-roles' + (run.rolesN ? '-' + run.rolesN : '')); run.rolesN = (run.rolesN || 0) + 1;
  fs.mkdirSync(path.join(sb, 'out'), { recursive: true });
  writeConfirmedPage(sb);
  const input = rolesInput(ctxState, mode === 'first' ? ROLES.FIRST_MAX : 1);
  if (mode === 'add') input.request = clip(rs.wantRole.text || '', 200);
  if (mode === 'suggest') input.request = { stations: (rs.wantRole.milestoneIds || []).map(id => ({ id, short: stationName(s, id) })), why: rs.wantRole.why || '' };
  if (mode === 'split') { const old = ROLES.cardById(s, rs.wantRole.teammateId); input.request = { title: ROLES.titleOf(old), keepStations: rs.wantRole.keepIds.map(id => ({ id, short: stationName(s, id) })), moveStations: rs.wantRole.moveIds.map(id => ({ id, short: stationName(s, id) })) }; }
  if (mode === 'recard') { const old = ROLES.cardById(s, recardId); const t = (s.tasks || []).find(x => x && old && x.id === old.activationTaskId); input.request = { title: ROLES.titleOf(old), milestoneIds: old.milestoneIds, returnedBecause: clip((t && t.returnNote) || '', 200) }; }
  writeJSON(path.join(sb, 'roles-input.json'), input);
  fs.writeFileSync(path.join(sb, 'task.md'), fs.readFileSync(path.join(ROOT, 'ai-roles.md'), 'utf8') + (ROLES_MODE_NOTE[mode] || ''));
  writeJSON(path.join(sb, 'job.json'), { type: 'roles', mode });
  step(run, key, label, 'running', 'Zero 處理中');
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (!r.ok || r.waiting) return rolesFail(run, key, label, due, r.reason || NAMES.t('rolesSyncFailed'));
  let chk = checkRolesOut(readJSON(path.join(sb, 'out', 'roles.json'), null), ctxState, mode, false);
  if (!chk.ok) {
    log(`${run.id} 崗位卡格式唔啱：${chk.errors.join('；')}；叫 AI 修正一次`);
    writeJSON(path.join(sb, 'job.json'), { type: 'roles-repair', mode, errors: chk.errors });
    fs.writeFileSync(path.join(sb, 'task.md'), ['# 今次的工作：修正崗位卡', '', '你剛才寫的 `out/roles.json` 有以下問題，請按 `ai-roles.md` 的格式改好，其他內容不要更改：', '', ...chk.errors.map((e, i) => `${i + 1}. ${e}`), '', '改完後覆寫 `out/roles.json`。只可以寫入 `out/`。'].join('\n') + '\n');
    fs.copyFileSync(path.join(ROOT, 'ai-roles.md'), path.join(sb, 'ai-roles.md'));
    const r2 = await runAI(sb);
    if (r2.meta && run.aiCost) run.aiCost.usd = (run.aiCost.usd || 0) + (r2.meta.total_cost_usd || 0);
    chk = checkRolesOut(readJSON(path.join(sb, 'out', 'roles.json'), null), ctxState, mode, true);
  }
  if (!chk.ok) return rolesFail(run, key, label, due, NAMES.t('rolesSyncFailed'));
  for (const d of chk.dropped || []) log(`${run.id} 崗位卡已丟棄（${d.reason}）：${clip(d.title, 20)}`);
  s = loadState();
  const now = localIso();
  if (mode === 'first') {
    const cards = chk.cards.filter(c2 => !sameStationTaken(s, c2));
    s = ROLES.markRolesDrafted(s, { key: due.key, now, pending: cards, unassigned: chk.unassigned });
  } else {
    s.rolesSync = { ...(s.rolesSync || {}), requested: false }; delete s.rolesSync.wantRole;
    if (mode === 'recard') {
      const left = (s.rolesSync.recard || []).filter(x => x !== recardId); s.rolesSync.recard = left;
      const card = chk.cards[0];
      const next = card ? ROLES.applyRecard(s, { teammateId: recardId, answer: 'recard', card, now }) : s;
      if (next === s) { if (s.rolesSync.recardAsked) delete s.rolesSync.recardAsked[recardId]; saveState(s); return rolesFail(run, key, label, due, NAMES.t('rolesSyncFailed')); }
      s = next;
    } else {
      const wr = rs.wantRole || {};
      s.rolesSync.pending = [...(s.rolesSync.pending || []), ...(mode === 'split' ? chk.cards.slice(0, 1).map(c2 => ({ ...c2, splitFrom: wr.teammateId, keepIds: wr.keepIds })) : chk.cards.map(c2 => mode === 'suggest' ? { ...c2, suggestFor: (wr.milestoneIds || []).map(id => stationName(s, id)).filter(Boolean).join('、') } : c2))];
    }
  }
  if (mode === 'recard') { saveState(s); step(run, key, label, 'done', NAMES.t('rolesRecarded')); run.result = { summary: NAMES.t('rolesRecarded'), artifacts: [], founderNext: [] }; return true; }
  if (!(s.rolesSync.pending || []).length) {
    s.events = s.events || []; s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: localIso(), actor: 'ai', type: 'brain', title: NAMES.t('rolesDraftNone'), relatedIds: [], moduleIds: ['ai-week'] });
    saveState(s); step(run, key, label, 'done', NAMES.t('rolesDraftNone')); run.result = { summary: NAMES.t('rolesDraftNone'), artifacts: [], founderNext: [] }; return true;
  }
  saveState(s);
  const placed = placeRolesBatch(loadState());
  if (!placed) { step(run, key, label, 'done', NAMES.t('rolesDraftNone')); run.result = { summary: NAMES.t('rolesDraftNone'), artifacts: [], founderNext: [] }; return true; }
  step(run, key, label, 'done', NAMES.t('rolesDraftDone', { n: placed.count }));
  run.result = { summary: NAMES.t('rolesDraftDone', { n: placed.count }), artifacts: [], founderNext: [], asks: [placed] };
  return true;
}
// 你回答崗位題（所有 rolesSync 包）：確認／改名／不要；加站＋加崗位同包；合併；改卡或取消；成員離開
function handleRolesAnswer(run, pack, store) {
  const kind = (pack.rolesSync || {}).kind || 'confirm';
  let s = loadState();
  if (s.demo === true) { run.result = { summary: U.peopleSyncNoted, artifacts: [], founderNext: [] }; step(run, 'applied', U.stepAppliedAns, 'done', U.peopleSyncNoted); return finish(run, 'done'); }
  s.rolesSync = s.rolesSync || {};
  s.rolesSync.applied = s.rolesSync.applied || {};
  const done = new Set(s.rolesSync.applied[pack.id] || []), said = [], now = localIso(), today = todayIso();
  s.events = s.events || [];
  const ev = (title, ids) => s.events.push({ id: 'e' + stamp() + '-' + s.events.length, at: now, actor: 'founder', type: 'decision', title, relatedIds: ids, moduleIds: ['now', 'ai-week'] });
  const extraNames = ((s.peopleSync || {}).pending || []).filter(x => x && x.kind === 'newActor').map(x => x.name);
  const renameText = NAMES.t('role_optRename');
  const roleFrom = (q, a) => {
    const opts = q.options || [], acc = opts.find(o => o.apply && o.apply.op === 'roleAccept'); if (!acc) return null;
    const opt = opts.find(o => o.text === a.value), v = String(a.value == null ? '' : a.value).trim();
    const answer = opt ? (opt.apply.op === 'roleAccept' ? 'accept' : opt.apply.op === 'roleDecline' ? 'decline' : 'rename') : 'rename';
    return { card: acc.apply.card, answer, newTitle: answer === 'rename' && v !== renameText ? v : '' };
  };
  const applyRole = (q, a, ex = {}) => {
    const rf = roleFrom(q, a); if (!rf) return;
    const before = s;
    const next = ex.station ? ROLES.applyRoleWithStation(s, { packId: pack.id, qid: q.id, stationAnswer: ex.station.answer, newStationId: ex.station.id, card: rf.card, roleAnswer: rf.answer, newTitle: rf.newTitle, now, today, styleIssues: NAMES.styleIssues })
      : ROLES.applyRoleAnswer(s, { packId: pack.id, qid: q.id, card: rf.card, answer: rf.answer, newTitle: rf.newTitle, now, today, actors: (s.company || {}).actors || [], styleIssues: NAMES.styleIssues, extraNames });
    if (next === before) { if (ex.station && ex.station.answer !== 'accept') { done.add(q.id); } return; }
    s = next; done.add(q.id);
    const id = ROLES.nextCardId(pack.id, q.id), card = ROLES.cardById(s, id);
    if (rf.answer === 'decline') { const t = mixSpace(NAMES.t('role_declinedNote') + '：' + ROLES.titleOf(rf.card)); ev(t, [pack.id]); said.push(t); }
    else if (card) {
      const t = mixSpace(NAMES.t('roleAccepted', { t: ROLES.titleOf(card) })); ev(t, [pack.id, id]); said.push(t);
      const rej = ((s.rolesSync || {}).renameRejected || {})[id]; if (rej) { const t2 = NAMES.t('role_renameRejected', { why: rej }); ev(t2, [pack.id, id]); said.push(t2); }
    } else if (ex.station && ex.station.answer !== 'accept') { const t = NAMES.t('role_addRoleVoid'); ev(t, [pack.id]); said.push(t); }
  };
  if (kind === 'confirm') {
    for (const q of pack.questions) { const a = store.answers[q.id]; if (!a || done.has(q.id)) continue; applyRole(q, a); done.add(q.id); }
  } else if (kind === 'addRole') {
    const q1 = pack.questions[0], q2 = pack.questions[1], a1 = store.answers[q1.id], a2 = store.answers[q2.id];
    const yes = (q1.options || [])[0], accepted = !!a1 && yes && a1.value === yes.text;
    if (a1 && a2 && !done.has(q2.id)) {
      let newId = '';
      if (accepted) {
        const before = currentRoute().map(r => r.id);
        const msg = applyOrder({ ...pack, questions: [q1] }, { answers: { [q1.id]: a1 } }, run);
        if (msg) said.push(msg);
        s = loadState(); s.rolesSync = s.rolesSync || {}; s.rolesSync.applied = s.rolesSync.applied || {}; s.events = s.events || [];
        newId = currentRoute().map(r => r.id).find(id => !before.includes(id)) || '';
      }
      applyRole(q2, a2, { station: { answer: accepted ? 'accept' : 'decline', id: newId } });
      done.add(q1.id);
    }
  } else if (kind === 'split') {
    const q = pack.questions[0], a = store.answers[q.id], tid = pack.rolesSync.teammateId;
    if (a && !done.has(q.id)) {
      done.add(q.id);
      const acc = (q.options || []).find(o => o.apply && o.apply.op === 'roleAccept');
      if (acc && a.value === acc.text) {
        const card = acc.apply.card, next = ROLES.splitCard(s, { teammateId: tid, keepIds: card.keepIds || ROLES.cardById(s, tid).milestoneIds.filter(id => !(card.milestoneIds || []).includes(id)), newCard: card, packId: pack.id, qid: q.id, now, today });
        if (next !== s) { s = next; const t = mixSpace(NAMES.t('roleSplit', { a: ROLES.titleOf(ROLES.cardById(s, tid)), b: ROLES.titleOf(card) })); ev(t, [pack.id, tid]); said.push(t); }
      } else { const t = NAMES.t('roleSplitKept'); ev(t, [pack.id, tid]); said.push(t); }
    }
  } else if (kind === 'merge') {
    const q = pack.questions[0], a = store.answers[q.id];
    if (a && !done.has(q.id)) {
      done.add(q.id);
      const yes = (q.options || []).find(o => o.apply && o.apply.op === 'roleMerge');
      if (yes && a.value === yes.text) { const next = ROLES.mergeCards(s, { fromId: yes.apply.fromId, intoId: yes.apply.intoId, now }); if (next !== s) { s = next; const t = mixSpace(NAMES.t('roleMerged', { a: ROLES.titleOf(ROLES.cardById(s, yes.apply.fromId)), b: ROLES.titleOf(ROLES.cardById(s, yes.apply.intoId)) })); ev(t, [pack.id]); said.push(t); } }
      else { s.rolesSync.capOk = true; const t = NAMES.t('roleOverCapKept'); ev(t, [pack.id]); said.push(t); }
    }
  } else if (kind === 'recard') {
    const q = pack.questions[0], a = store.answers[q.id], tid = pack.rolesSync.teammateId;
    if (a && !done.has(q.id)) {
      done.add(q.id);
      if (a.value === NAMES.t('role_optCancel')) { const next = ROLES.applyRecard(s, { teammateId: tid, answer: 'cancel', now }); if (next !== s) { s = next; const t = mixSpace(NAMES.t('roleCancelled', { t: ROLES.titleOf(ROLES.cardById(s, tid)) })); ev(t, [pack.id, tid]); said.push(t); } }
      else { s.rolesSync.recard = [...new Set([...(s.rolesSync.recard || []), tid])]; s.rolesSync.requested = true; const t = mixSpace(NAMES.t('roleRecardAsked', { t: ROLES.titleOf(ROLES.cardById(s, tid)) })); ev(t, [pack.id, tid]); said.push(t); }
    }
  } else if (kind === 'left') {
    for (const q of pack.questions) {
      const a = store.answers[q.id]; if (!a || done.has(q.id)) continue; done.add(q.id);
      const yes = (q.options || []).find(o => o.apply && o.apply.op === 'roleSupportsLeft');
      if (yes && a.value === yes.text) { const next = ROLES.applySupportsLeft(s, { teammateId: yes.apply.teammateId, actorId: yes.apply.actorId, now }); if (next !== s) { s = next; const t = mixSpace(NAMES.t('roleSupportsDropped', { t: ROLES.titleOf(ROLES.cardById(s, yes.apply.teammateId)) })); ev(t, [pack.id]); said.push(t); } }
      else { s.rolesSync.leftKept = { ...(s.rolesSync.leftKept || {}), [q.about]: 1 }; }
    }
  }
  s.rolesSync.applied[pack.id] = [...done];
  const allAnswered = pack.questions.every(q => store.answers[q.id]);
  if (allAnswered && s.rolesSync.packId === pack.id) s.rolesSync.packId = '';
  saveState(s);
  let placed = null;
  if (allAnswered && (s.rolesSync.pending || []).length && !openRolesPack()) placed = placeRolesBatch(loadState());
  run.result = { summary: said.join('；') || U.peopleSyncNoted, artifacts: [], founderNext: [], ...(placed ? { asks: [placed] } : {}) };
  step(run, 'applied', U.stepAppliedAns, 'done', said.join('；') || U.peopleSyncNoted);
  return finish(run, 'done');
}
// 成員離開（Z52）：supports 含已離開成員的卡 → 出確認題「改為支援你？」，每個（卡，成員）只問一次
function placeSupportsLeft(s) {
  const rv = ROLES.supportsReview(s), rs = s.rolesSync || {}, asked = rs.leftAsked || {};
  const todo = rv.ask.filter(x => !asked[x.teammateId + ':' + x.actorId]);
  if (!todo.length || openRolesPack()) return null;
  const qs = todo.slice(0, ROLES.PACK_MAX).map((x, i) => { const card = ROLES.cardById(s, x.teammateId); const yes = { text: NAMES.t('role_optLeftYes'), rec: true, apply: { op: 'roleSupportsLeft', teammateId: x.teammateId, actorId: x.actorId } }, no = { text: NAMES.t('role_optLeftNo'), apply: { op: 'roleKeep' } };
    return { id: 'q' + (i + 1), priority: i + 1, about: clip(x.name || ROLES.titleOf(card), 30), ask: mixSpace(NAMES.t('role_leftAsk', { n: x.name || '', t: ROLES.titleOf(card) })), judge: clip(card.mission || '', 120), kind: 'choice', effect: 'now', options: [yes, no], value: yes.text, why: clip(card.mission || ROLES.titleOf(card), 200), roleCard: roleCardView(s, card) }; });
  const placed = placePacks(DIR, [rhythmPack('rv', { title: NAMES.t('role_confirmTitle'), context: NAMES.t('role_leftContext'), afterConfirm: NAMES.t('role_confirmAfter'), todoType: 'decision', rolesSync: { key: rs.for || '', kind: 'left' }, questions: qs })])[0];
  const s2 = loadState(); s2.rolesSync = { ...(s2.rolesSync || {}), leftAsked: { ...((s2.rolesSync || {}).leftAsked || {}), ...Object.fromEntries(todo.slice(0, ROLES.PACK_MAX).map(x => [x.teammateId + ':' + x.actorId, placed.id])) } };
  saveState(s2);
  return placed;
}

/* ---------- 崗位相關的外殼小件（0.41.0） ---------- */
// 三格權限預設直接存檔（Z51）：loadState → ensurePermissions → saveState，不經 syncLedger 的比較欄；只寫 state.json，不碰 page／confirmed（proofreadHash 結果不變）。0 次 AI。
function savePermissionsIfMissing(from = '') {
  const s = loadState(); if (s.demo === true) return false;
  if (from === 'rhythm' && !(readJSON(CONFIRMED, null) && s.ledgerFrom)) return false;
  const n = ROLES.ensurePermissions(s);
  if (n === s) return false;
  saveState(n); log(`三格權限預設已寫入（${from}）`);
  return true;
}
// 日常工作內的崗位步驟：路線改變重擬標記（Z22）、成員離開題（Z52）、Zero 主動建議（Z18）、擬崗位（Z1）
async function rolesPhase(run, today) {
  let s = loadState(); if (s.demo === true || !s.ledgerFrom) return;
  { const n = ROLES.recardAfterRoute(s, { now: localIso() }); if (n !== s) { saveState(n); s = n; } }
  placeSupportsLeft(loadState());
  placeRecardsLeft(loadState());
  s = loadState();
  const rs = s.rolesSync || {};
  if (ROLES.liveCards(s).length && !rs.requested && !rs.wantRole && !(rs.pending || []).length && !openRolesPack()) {
    const sig = ROLES.suggestSignals(s, { today });
    if (sig.length) { let n = ROLES.markSuggested(s, { key: sig[0].key, today }); n.rolesSync = { ...n.rolesSync, requested: true, wantRole: { kind: 'suggest', milestoneIds: sig[0].milestoneIds, why: sig[0].key } }; saveState(n); }
  }
  s = loadState();
  { const r2 = s.rolesSync || {};
    if (!r2.requested && !r2.wantRole && !(r2.pending || []).length && !openRolesPack()) {
      for (const c of ROLES.liveCards(s).filter(x => x.lifecycle === 'enabled')) {
        if ((r2.splitAsked || {})[c.id]) continue;
        const sg = ROLES.splitSignal(s, c.id); if (!sg.split || sg.why !== 'stations') continue;
        const kindOf2 = id => { const m = (s.milestones || []).find(x => x && x.id === id) || {}; return m.actorKind || m.actorName || ''; };
        const first = kindOf2(c.milestoneIds[0]), keepIds = c.milestoneIds.filter(id => kindOf2(id) === first), moveIds = c.milestoneIds.filter(id => !keepIds.includes(id));
        if (!keepIds.length || !moveIds.length) continue;
        const n = { ...s, rolesSync: { ...r2, requested: true, wantRole: { kind: 'split', teammateId: c.id, keepIds, moveIds }, splitAsked: { ...(r2.splitAsked || {}), [c.id]: today } } };
        saveState(n); break;
      }
    }
  }
  const due = ROLES.rolesDue(loadState(), { packOpen: !!openRolesPack(), today });
  if (due.due) await rolesStep(run, due);
}
// 創辦人在「想改計劃」等輸入提出加崗位：記下要求，下一步由擬崗位步驟（加崗位模式）處理
function noteWantRole(run, said) {
  const s = loadState(); if (s.demo === true) return;
  s.rolesSync = { ...(s.rolesSync || {}), requested: true, wantRole: { kind: 'add', text: clip(said, 200), noteId: run.ref } };
  saveState(s); log(`${run.id} 創辦人要求加崗位，已記下`);
}
// 啟用任務驗收「接受」（Z8）：崗位轉已啟用、鎖定 bounds；「接受，但我想改方向」另記一筆事件
function activateCard(pack, store, answer) {
  const s = loadState(), tid = pack.acceptance.teammateId, card = ROLES.cardById(s, tid); if (!card || s.demo === true) return;
  const hash = fnv(JSON.stringify({ t: ROLES.titleOf(card), m: card.mission, ms: card.milestoneIds, h: card.how, d: card.deliverables, b: card.bounds }));
  const next = ROLES.applyActivation(s, { teammateId: tid, answer, now: localIso(), replyFile: (store.answers.accept || {}).reply || '', cardHash: hash });
  if (next === s) return;
  next.events = next.events || [];
  next.events.push({ id: 'e' + stamp() + '-' + next.events.length, at: localIso(), actor: 'founder', type: 'decision', title: NAMES.t('roleActivated', { t: ROLES.titleOf(card) }), relatedIds: [tid, pack.id], moduleIds: ['decisions', 'ai-week'] });
  if (answer === 'acceptRedirect') { const c2 = ROLES.cardById(next, tid); c2.redirectAsked = localIso(); next.events.push({ id: 'e' + stamp() + '-' + next.events.length, at: localIso(), actor: 'founder', type: 'decision', title: NAMES.t('roleRedirect', { t: ROLES.titleOf(card) }), relatedIds: [tid, pack.id], moduleIds: ['decisions', 'ai-week'] }); }
  saveState(next);
}
// 啟用任務退回（Z9、Z10）：未達 2 次工作重開；達 2 次出「改卡或取消」題，工作不再自動重開
function returnActivation(run, pack, t, reason) {
  const s = loadState(), tid = pack.acceptance.teammateId, card0 = ROLES.cardById(s, tid);
  const next = ROLES.applyActivation(s, { teammateId: tid, answer: 'return', now: localIso() });
  const tk = (next.tasks || []).find(x => x && x.id === t.id);
  if (tk) { tk.needsAcceptance = false; tk.returnNote = reason && reason !== '不用改' ? reason : '創辦人退回，未寫明原因'; }
  next.events = next.events || [];
  next.events.push({ id: 'e' + stamp() + '-' + next.events.length, at: localIso(), actor: 'founder', type: 'decision', title: '退回：' + t.title, relatedIds: [t.id, pack.id], moduleIds: ['decisions', 'ai-week'] });
  saveState(next);
  const card = ROLES.cardById(next, tid);
  let placed = null;
  if (card && ROLES.needsRecard(card) && !openRolesPack()) placed = placeRecardPack(next, card);
  run.result = { summary: '已退回「' + t.title + '」。' + (placed ? '' : ''), artifacts: [], founderNext: [], ...(placed ? { asks: [placed] } : {}) };
  return finish(run, 'done');
}
function placeRecardPack(s, card) {
  const yes = { text: NAMES.t('role_optRecard'), rec: true, apply: { op: 'roleRecard', teammateId: card.id } }, no = { text: NAMES.t('role_optCancel'), apply: { op: 'roleCancel', teammateId: card.id } };
  const q = { id: 'q1', priority: 1, about: clip(ROLES.titleOf(card), 30), ask: NAMES.t('role_returnTwice'), judge: clip(card.mission || '', 120), kind: 'choice', effect: 'now', options: [yes, no], value: yes.text, why: clip(card.strategy || card.mission || '', 200), roleCard: roleCardView(s, card) };
  const placed = placePacks(DIR, [rhythmPack('rr', { title: NAMES.t('role_confirmTitle'), context: NAMES.t('role_confirmContext'), afterConfirm: NAMES.t('role_confirmAfter'), todoType: 'decision', rolesSync: { key: (s.rolesSync || {}).for || '', kind: 'recard', teammateId: card.id }, questions: [q] })])[0];
  // M4：記下這張卡（這個啟用任務）已問過，補放步驟不會重複放題；改卡後會有新的啟用任務，之後再退回兩次才會再問
  const s2 = loadState(); s2.rolesSync = { ...(s2.rolesSync || {}), recardAsked: { ...((s2.rolesSync || {}).recardAsked || {}), [card.id]: card.activationTaskId || '' } }; saveState(s2);
  return placed;
}
// M4：啟用任務退回兩次當刻若有別的崗位題包開著，「改卡或取消」題放不出；之後沒有崗位題包開著時補放（每張卡每個啟用任務只問一次）
function placeRecardsLeft(s) {
  if (openRolesPack()) return null;
  const asked = (s.rolesSync || {}).recardAsked || {};
  const card = (s.teammates || []).find(c => c && ROLES.needsRecard(c) && asked[c.id] !== (c.activationTaskId || ''));
  return card ? placeRecardPack(s, card) : null;
}

/* ---------- 日常工作的多件日循環（0.41.0；資料約定 9A、狀態表 Z23／Z53–Z58） ----------
   外殼主持：每件之前合併創辦人操作、重讀帳本 → 停止判定 → 排「可以做」→ 派工 → 工作說明（八段）→ 開 AI（一次一件）→ 收尾寫回工作狀態、
   記入 runs[].items（每件之後立刻記，程序中途死掉同日重啟不重做）。標準＝每日 1 件，與 0.40.2 相同；沒有工作可做的第一件由 Zero 自行準備（0.40.2 行為）。 */
const itemsOfDay = (s, day) => ((s || {}).runs || []).filter(r => r && (r.workDay || PACE.workDayOf(r.startedAt)) === day).flatMap(r => (r.items || []).filter(Boolean));
const DELIVERABLE_LABEL = { message: '訊息草稿', quote: '報價或價目', proposal: '合作建議書', intro: '給對象看的簡介或簡報', reply: '給對象的回覆或文件', questions: '問題清單', checklist: '核對清單', research: '研究摘要', plan: '計劃', list: '名單' };
const RECEIPT_FORMAT = 'out/receipt.json（summary、artifacts〔每份寫 file、title、type；type 只可是 ' + PACE.DELIVERABLE_TYPES.join('、') + ' 之一〕、audience〔對外 external 或內部 internal〕、founderNext、for、blockedOn）';
// 開放中的問題包（完整內容）及未答題數
// 仍要創辦人作答的問題包（必須逐項確認的題未答；驗收題只算 accept 一題，選填的原因題不算）
function openPackList() { return listPacks(DIR).filter(p => p.open > 0).map(p => loadPack(DIR, p.id)).filter(pk => pk && requiredLeft(pk, loadAnswers(DIR, pk.id)).length > 0); }
const openQuestionCount = () => openPackList().reduce((n, pk) => n + requiredLeft(pk, loadAnswers(DIR, pk.id)).length, 0);
// 這一件的八段工作說明：從公司紀錄機械填入，AI 不填任何一段。回 { text, fileNames, ok, errors }
function itemBrief(st, sel, sb, workDay, extraFiles = []) {
  const task = sel.task, card = sel.teammateId ? ROLES.cardById(st, sel.teammateId) : null;
  const ms = task ? (st.milestones || []).find(m => m && m.id === task.milestoneId) : null;
  const actors = ((st.company || {}).actors || []).filter(Boolean);
  const perm = ROLES.permissionsOf(st);
  const titleOfTask = id => ((st.tasks || []).find(t => t && t.id === id) || {}).title || '';
  const files = [{ name: 'confirmed-page.md', about: '創辦人已確認的公司概覽' }, { name: 'ledger.json', about: '公司紀錄摘要：路線、假設，以及今次要做的這一件' }];
  // 崗位的來源範圍：創辦人交過的文件（inputs[].id）放進資料夾 files/，最多 3 份、每份 200 KB 內
  if (card) {
    let n = 0;
    for (const sid of card.sources || []) {
      if (sid === 'confirmedPage' || sid === 'web') continue;
      const input = (st.inputs || []).find(i => i && i.id === sid); if (!input) continue;
      for (const row of attachmentRows(input)) {
        const src = row.textAbs && fs.existsSync(row.textAbs) ? row.textAbs : row.abs, name = row.textName && row.textAbs === src ? row.textName : row.name;
        try { if (n >= 3 || !fs.existsSync(src) || fs.statSync(src).size > 200 * 1024) continue; fs.mkdirSync(path.join(sb, 'files'), { recursive: true }); fs.copyFileSync(src, path.join(sb, 'files', name)); files.push({ name: 'files/' + name, about: clip(input.title || name, 40) }); n++; } catch { }
      }
    }
  }
  files.push(...extraFiles);
  // 被創辦人退回的工作：上一版放進資料夾 previous-N.md，列在第三段（說明自足，不指向「上次」）
  if (task && task.returnNote && task.lastWorkId && !extraFiles.length) {
    try {
      const rc0 = readJSON(path.join(DIR.work, task.lastWorkId, 'receipt.json'), {}) || {};
      (Array.isArray(rc0.artifacts) ? rc0.artifacts : []).slice(0, PACE.ARTIFACTS_MAX).forEach((a, k) => {
        const f = path.join(DIR.work, task.lastWorkId, String(a && a.file || '')); if (!/^[\w.-]+\.md$/.test(String(a && a.file || '')) || !fs.existsSync(f)) return;
        const name = 'previous-' + (k + 1) + '.md'; fs.copyFileSync(f, path.join(sb, name)); files.push({ name, about: '上一版，被創辦人退回：' + clip(String(a.title || ''), 30) });
      });
    } catch { }
  }
  const web = !card || (card.sources || []).includes('web');
  const roleTitle = card ? ROLES.titleOf(card) : '';
  const extra = k => ((card && card.bounds && card.bounds[k]) || []).filter(x => !(perm[k] || []).includes(x));
  const recent = readLog(DIR, 60).filter(e => e && e.source === 'ask' && e.question && e.answer).slice(0, 5).map(e => clip(e.question, 40) + '：' + clip(e.answer, 40));
  const glossary = [];
  if (ms && ms.short) glossary.push({ term: ms.short, meaning: clip(ms.event || '公司路線上的一站', 80) });
  if (roleTitle) glossary.push({ term: roleTitle, meaning: clip(card.mission || '負責這一站的崗位', 80) });
  const brief = buildBrief({
    kind: 'work',
    station: { short: ms ? ms.short : '公司整體', event: ms ? ms.event || ms.short : '公司往下一步推進', doneWhen: ms ? ms.deliveryCondition : '' },
    task: { title: task ? task.title : '準備下一個對外動作，或說明在等甚麼', next: task ? task.next : '' },
    role: { title: roleTitle, bounds: { tellAfter: extra('tellAfter'), askFirst: extra('askFirst') } },
    files, web: { allowed: web },
    progress: {
      before: (st.tasks || []).filter(t => t && task && t.id !== task.id && t.milestoneId === task.milestoneId && t.status === 'done').slice(-5).map(t => clip(t.title, 40)),
      answered: (task && task.returnNote ? ['創辦人退回了上一版，原因：' + clip(task.returnNote, 200) + '（逐條改正，不要重複同樣的問題）'] : []).concat(recent), unknown: openUnknowns(DIR).slice(0, 5).map(u => clip(u.question, 50)),
      todayDone: itemsOfDay(st, workDay).filter(i => i.ending === 'artifact').map(i => clip(titleOfTask(i.taskId), 40)).filter(Boolean),
      rewriteIssues: sel.rewriteIssues || []
    },
    permissions: perm,
    firstStep: task && task.next ? '按「' + clip(task.next, 60) + '」做這件工作。' : '',
    deliver: { types: card && (card.deliverables || []).length ? card.deliverables.map(t => DELIVERABLE_LABEL[t] || t) : ['草稿', '清單', '摘要'], max: PACE.ARTIFACTS_MAX, proofread: card ? (card.deliverables || []).some(t => PACE.EXTERNAL_TYPES.includes(t)) : true, receiptFormat: RECEIPT_FORMAT, acceptance: task && task.next ? clip(task.next, 80) : '' },
    glossary
  });
  const fileNames = [...files.map(f => f.name), 'task.md'];
  const chk = checkBrief(brief, { files: fileNames, names: glossary.map(g => g.term) });
  return { text: brief, fileNames, ok: chk.ok, errors: chk.errors };
}
// 工作說明核對不合格而改用通用說明時，退回原因及校對發回的問題仍要交給 AI（M1：不可靜靜丟失）
function fallbackNotes(task, issues = []) {
  const l = [];
  if (task && task.returnNote) l.push('創辦人退回了上一版，原因：' + clip(task.returnNote, 200) + '（逐條改正，不要重複同樣的問題）');
  for (const i of issues || []) if (i) l.push('校對發回的問題：' + clip(i, 200));
  return l.length ? '\n\n---\n\n## 必須處理的意見\n\n' + l.map(x => '- ' + x).join('\n') + '\n' : '';
}
// 單件日常工作：開一次 AI → 用字改寫 → 核對收據 → 存收據 → 問題包／第二站／對象下一步 → 判定收尾。回 { ending, failKind, fresh, ... }
async function workItem(run, lr, st, sel, n, ctx) {
  const { workDay, type } = ctx;
  const id = n === 1 ? run.id : run.id + '-i' + n, key = n === 1 ? 'ai' : 'ai' + n, label = U['runType_' + type];
  const task = sel.task, card = sel.teammateId ? ROLES.cardById(st, sel.teammateId) : null;
  const res = { ending: 'blocked', failKind: '', fresh: 0, blockedOn: '', summary: '', briefFailed: false, asks: [], placed: null, waiting: false, skipped: false, qa: null, receiptDir: id, artifacts: [], aiStarted: false };
  const startedAt = localIso(); res.startedAt = startedAt;
  const sb = newSandbox(run, null, id);
  writeConfirmedPage(sb);
  writeJSON(path.join(sb, 'ledger.json'), rhythmLedger(type, task ? [task] : []));
  const rhythmMd = fs.readFileSync(path.join(ROOT, 'ai-rhythm.md'), 'utf8');
  let taskText = rhythmMd;
  if (task) {
    const b = itemBrief(st, sel, sb, workDay);
    if (b.ok) taskText = rhythmMd + '\n\n---\n\n' + b.text;
    else { taskText = rhythmMd + fallbackNotes(task); res.briefFailed = true; log(`${id} 工作說明核對不合格，改用通用說明：${b.errors.map(e => e.text).join('；')}`); run.warnings = [...(run.warnings || []), NAMES.t('brief_fallback')]; }
  }
  fs.writeFileSync(path.join(sb, 'task.md'), taskText);
  writeJSON(path.join(sb, 'job.json'), { type: 'rhythm', runType: type, ...(task ? { taskId: task.id } : {}), ...(card ? { teammateId: card.id } : {}) });
  step(run, key, label, 'running', 'Zero 處理中，一般需時 1–3 分鐘；你可繼續查看，或關閉此頁稍後再查看');
  log(`${id} AI start`);
  const r = await runAI(sb);
  if (r.meta) run.aiCost = { usd: ((run.aiCost && run.aiCost.usd) || 0) + (r.meta.total_cost_usd || 0), ms: ((run.aiCost && run.aiCost.ms) || 0) + (r.meta.duration_ms || 0) };
  if (r.waiting) { run.waitingFor = 'ai-setup'; step(run, key, label, 'waiting', r.reason); res.waiting = true; res.reason = r.reason; return res; }
  if (!r.ok && r.reason === U.skip_budgetExhausted) { step(run, key, label, 'skipped', r.reason); res.skipped = true; return res; }
  res.aiStarted = true;
  const fail = (kind, reason) => { step(run, key, label, 'failed', reason); Object.assign(res, { ending: 'failed', failKind: kind, reason }); return res; };
  if (!r.ok) return fail(r.timedOut ? 'timeout' : 'start', r.reason);
  const styleWarnings = await rewriteOnce(sb, run);
  const chk = checkReceipt(path.join(sb, 'out'), true);
  if (!chk.ok) return fail('rejected', chk.reason);
  fs.cpSync(path.join(sb, 'out'), path.join(DIR.work, id), { recursive: true });
  const meta = { id, kind: 'rhythm', ref: type, label, startedAt, aiCost: run.aiCost || null, ...(task ? { taskId: task.id } : {}) };
  writeJSON(path.join(DIR.work, id, 'run.json'), meta);
  run.result = { ...chk.receipt, styleWarnings };
  takeAIQuestions(sb, run, id);
  res.asks = (run.result.asks || []).slice();
  res.placed = takeOpenSecond(sb, run);
  takeProspects(sb, run);
  const rc = readJSON(path.join(DIR.work, id, 'receipt.json'), {}) || {};
  const arts = chk.receipt.artifacts;
  const s = loadState(); s.artifactHashes = Array.isArray(s.artifactHashes) ? s.artifactHashes : [];
  const fresh = arts.filter(a => !s.artifactHashes.includes(fnv(a.text)));
  s.artifactHashes = s.artifactHashes.concat(fresh.map(a => fnv(a.text))).slice(-300);
  saveState(s);
  res.fresh = fresh.length; res.artifacts = fresh; res.summary = chk.receipt.summary || '';
  res.ending = fresh.length ? 'artifact' : 'blocked';
  res.blockedOn = res.ending === 'blocked' ? clip(String(rc.blockedOn || ''), 80) : '';
  res.forInfo = rc.for && typeof rc.for === 'object' ? { milestoneId: String(rc.for.milestoneId || ''), text: clip(String(rc.for.text || ''), 60) } : undefined;
  res.rc = rc;
  if (res.ending === 'artifact') {
    const ch = await qaChain(run, id, st, sel, card, task, fresh, rc, { workDay });
    res.qa = ch.qa; res.artifacts = ch.artifacts; res.needsAcceptance = !!task && ch.needsAcceptance; res.proofFail = !!ch.toolFail; if (ch.briefFailed) res.briefFailed = true;
    if (res.needsAcceptance) { const pk = placeAcceptance(run, id, sel, card, task, res.artifacts, res.qa, ch.activation); res.accept = pk; res.asks.push(pk); }
  }
  // 收據補上外殼寫的欄（AI 不填）：交付崗位及校對結果
  { const rf = path.join(DIR.work, id, 'receipt.json'), rw = readJSON(rf, {}) || {}; rw.qa = res.qa || { audience: 'internal', verdict: 'none' }; if (sel.teammateId) rw.teammateId = sel.teammateId; else delete rw.teammateId; if (task) rw.taskId = task.id; else delete rw.taskId; writeJSON(rf, rw); }
  step(run, key, label, 'done', `已完成 ${chk.receipt.artifacts.length} 份產出` + (res.asks.length ? `；另有 ${res.asks.reduce((k, a) => k + a.count, 0)} 條問題等你回答` : ''));
  return res;
}
async function dailyLoop(run, lr, type) {
  const workDay = WORKDAY, startedPace = PACE.paceKey(loadState());
  const agg = { pace: startedPace, items: [], fresh: 0, asks: [], placed: [], stopReason: '', summaries: [], blockedOn: '', forInfo: undefined, rejected: false, rejectReason: '', waiting: false, last: null, aiStarted: false };
  const fails = [], briefFails = [];
  for (let guard = 0; guard < 40; guard++) {
    // 每件之前：合併創辦人操作（暫停、改節奏、回覆後的狀態）、重讀帳本，再判定要不要停
    mergeFounderOps(); mergeRereads();
    const st = loadState();
    const bt = PACE.betweenItems(st, { startedPace, startedAt: lr.startedAt, now: localIso() });
    if (bt.stop) { agg.stopReason = bt.reason; break; }
    const today = itemsOfDay(st, workDay);
    const list = PACE.orderCanDo(st, { today: workDay, doneToday: [] });
    const openPk = openPackList(), openQ = openQuestionCount();
    const unread = PACE.unreadCount(openPk), noReply = PACE.noReplyDays(st, { today: workDay, openPacks: openPk.length });
    const sp = PACE.applySprintPause(st, { unread, noReply, today: workDay }); if (sp !== st) saveState(sp);
    const free = !list.length && !today.length;   // 沒有工作可做的第一件：Zero 自行準備下一個對外動作，或交代在等甚麼（0.40.2 行為）
    const stop = PACE.nextStop(st, { pace: startedPace, itemsDone: today.length, canDo: list.length || (free ? 1 : 0), blockedByQuestions: !list.length && !free && openQ > 0 && (st.tasks || []).some(x => x && ownerKind(x.owner) === 'ai' && ['waiting', 'blocked'].includes(x.status)), counts: startCounts(), unread, noReply, toolFails: PACE.toolFailStreak(fails), pausedRoles: ROLES.pausedCardsToday(st, workDay).length, briefFails: briefFailStreak(briefFails) });
    if (stop.stop) { agg.stopReason = stop.reason; agg.openQ = openQ; agg.unread = unread; break; }
    const sel = free ? { task: null, teammateId: '', reason: 'free' } : ROLES.pickAssignment(st, list, { today: workDay });
    const n = agg.items.length + 1;
    const res = await workItem(run, lr, st, sel, n, { workDay, type, startedPace });
    if (res.waiting) { agg.waiting = true; agg.rejected = true; agg.rejectReason = res.reason || ''; break; }
    if (res.skipped) { agg.stopReason = 'fuse'; break; }
    agg.aiStarted = true; agg.last = res;
    fails.push({ failKind: res.failKind || (res.proofFail ? 'proofread' : '') }); briefFails.push(res.briefFailed);
    const item = { taskId: sel.task ? sel.task.id : '', teammateId: sel.teammateId || '', ending: res.ending, startedAt: res.startedAt || lr.startedAt, endedAt: localIso(), workId: res.receiptDir, ...(res.blockedOn ? { waitingFor: res.blockedOn } : {}), ...(res.qa ? { qa: res.qa } : {}) };
    agg.items.push(item);
    recordRun({ ...lr, aiStarted: true, items: agg.items, taskIds: agg.items.map(i => i.taskId).filter(Boolean) });
    // 工作狀態：交付→done（對外或啟用任務標待驗收）；卡住→只記 blockedOn；工具失敗→failedOn
    let s2 = loadState();
    if (sel.task) s2 = PACE.applyItemEnding(s2, { taskId: sel.task.id, ending: res.ending, waitingFor: res.blockedOn, today: workDay, now: localIso(), needsAcceptance: !!res.needsAcceptance, artifactTitle: (res.artifacts[0] || {}).title || '' });
    if (sel.task) { const tk = (s2.tasks || []).find(x => x && x.id === sel.task.id); if (tk) { tk.teammateId = sel.teammateId || ''; tk.cadence = tk.cadence || 'daily'; if (res.accept) tk.packId = res.accept.id; tk.lastWorkId = res.receiptDir; if (res.ending === 'artifact') delete tk.returnNote; } }
    s2 = ROLES.autoPauseCards(s2, { items: itemsOfDay(s2, workDay), today: workDay });
    saveState(s2);
    agg.fresh += res.fresh; agg.asks.push(...res.asks); if (res.placed) agg.placed.push(...res.placed);
    if (res.summary) agg.summaries.push(res.summary);
    if (res.ending === 'failed') { agg.rejected = true; agg.rejectReason = res.reason || ''; }
    if (res.ending === 'blocked') agg.blockedOn = res.blockedOn;
    if (res.forInfo) agg.forInfo = res.forInfo;
  }
  return agg;
}
async function rhythmRun() {
  // 第一步：同步帳本、機械工作（唔使 AI）；所有排程 run 都記入帳本，跳過都記
  if (!fs.readdirSync(DIR.replies).some(f => f.endsWith('.md'))) migrateOverview();
  syncLedger();
  // 衝刺到期（Z48）：sprintUntil 過後首次開工，pace 寫回標準（sprintUntil 保留作紀錄）
  { const e0 = loadState(), e1 = PACE.expireSprint(e0, todayIso()); if (e1 !== e0) { saveState(e1); log('衝刺已到期，節奏回到標準'); } }
  const s0 = loadState(), today = todayIso(), r = rhythmOf(s0);
  const type = RUN_TYPE === 'auto' ? (isWeekday(today, r.interviewWeekday) ? 'interview' : 'rhythm') : RUN_TYPE;
  const startedAt = localIso();
  WORKDAY = PACE.workDayOf(startedAt);   // 開工時鎖定工作日：件數、保險絲、當日已做都按它計，跨午夜不歸零（Z57）
  const lr = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), type, trigger: RUN_TRIGGER, slot: RUN_SLOT || today, startedAt, workDay: WORKDAY, capMinutes: r.runCapMinutes, aiStarted: false, state: 'running', label: U['runType_' + type], moduleIds: ['ai-week', 'system'] };
  recordRun(lr);
  const page = loadPage(), confirmed = readJSON(CONFIRMED, null);
  // 新交資料會換走 confirmed.json；有新頁時一定要確認同一個 pageId，舊帳本先唔可以開工。
  const overviewCurrent = overviewIsCurrent(page, confirmed);
  const intakeReady = !!(s0.intake && s0.intake.confirmedAt && s0.ledgerFrom);
  const intakeOk = intakeReady && overviewCurrent;
  const mech = [];
  if (intakeOk) { mech.push(...checkTrials()); const iv = placeInterviewIfDue(); if (iv) mech.push(iv); if (s0.ledgerFrom && s0.depthPackFor !== s0.ledgerFrom) { const dp = placeDepthPack(null); if (dp) mech.push(dp); } }
  const h = { ...HEALTH0, ...(loadState().health || {}) };
  // 排程器「錯過即補跑」加正常時段，可能令同一日叫兩次：同一日已有排程工作做完，補跑嗰次照記錄但唔再開 AI
  const ranToday = RUN_TRIGGER === 'schedule' && (s0.runs || []).some(x => x.trigger === 'schedule' && x.slot === (RUN_SLOT || today) && x.state === 'ended');
  const certification = certified(ROOT, DIR.ledger);
  const skip = ranToday ? 'alreadyRan' : !intakeOk ? (!overviewCurrent && intakeReady ? 'overviewPending' : 'intakeNotComplete') : h.pausedByFounder ? 'pausedByFounder' : h.autoStopped ? 'autoStopped' : budgetLeft() <= 0 ? 'budgetExhausted' : !certification.host ? (certification.code === 'changed' ? 'adapterVersionChanged' : 'adapterNotCertified') : '';
  if (skip) {
    recordRun({ ...lr, state: 'skipped', skipReason: skip, endedAt: localIso(), summary: U['skip_' + skip] + (mech.length ? '；已放上 ' + mech.length + ' 項待你處理' : ''), placed: mech.map(p => p.id) });
    log(`${lr.id} 排程 run 跳過：${skip}`);
    return;
  }
  // AI 日常工作：只喺沙盒做；收尾由外殼判定
  const run = { id: lr.id, kind: 'rhythm', ref: type, startedAt: lr.startedAt, state: 'running', replyFiles: [], steps: [], trigger: RUN_TRIGGER };
  step(run, 'received', U['runType_' + type], 'done', U['trig_' + RUN_TRIGGER]);
  const c0 = startCounts().total;
  // Zero 整理名單：此版概覽未整理過而名單有缺口（升級前已確認嘅公司沒有成員、或有舊對象）、或創辦人要求：日常工作先補做一次
  savePermissionsIfMissing('rhythm');   // 三格權限補寫（舊公司；0 次 AI）
  { const due = peopleSyncDue(loadState(), { packOpen: !!openPeopleSync(), today }); if (due.due) await peopleSyncStep(run, due); }
  await rolesPhase(run, today);   // 擬崗位（整理名單之後、生意體檢之前；資料約定第 8 節）
  // 已確認但未做過生意體檢（升級前已確認嘅公司）：日常工作先補做
  if (readJSON(CONFIRMED, null) && (!fs.existsSync(brainFile(DIR, 'checkup')) || ((readJSON(brainFile(DIR, 'checkup'), null) || {}).partial === true && checkupStale()))) await brainStep(run, 'checkup');
  if (opportunitiesDue(s0, today)) await brainStep(run, 'opportunities', { timeoutMinutes: Math.max(3, Math.floor((r.runCapMinutes || 30) / 3)) });
  recordRun({ ...lr, aiStarted: true });
  const agg = await dailyLoop(run, lr, type);
  if (agg.waiting) finish(run, 'waiting');
  else finish(run, agg.items.length && agg.items.every(i => i.ending === 'failed') ? 'failed' : 'done', agg.items.length && agg.items.every(i => i.ending === 'failed') ? agg.rejectReason : '');
  const fresh = agg.fresh;
  const ending = agg.waiting ? 'blocked' : agg.items.length ? (fresh ? 'artifact' : 'blocked') : 'checked';
  const prev = (loadState().runs || []).filter(x => x.state === 'ended' && x.id !== lr.id).pop();
  const blockedOn = ending === 'blocked' ? agg.blockedOn || '' : '';
  const rejected = agg.waiting || (agg.items.length > 0 && agg.items.every(i => i.ending === 'failed'));
  const stopReason = agg.stopReason && !(agg.pace === 'standard' && ['itemsCap', 'nothingToDo'].includes(agg.stopReason)) ? agg.stopReason : '';
  const stopN = agg.stopReason === 'itemsCap' ? PACE.PACES[agg.pace].itemsPerDay : agg.stopReason === 'waitingFounder' ? agg.openQ : agg.unread;
  recordRun({ ...lr, aiStarted: agg.aiStarted || startCounts().total > c0, state: 'ended', endedAt: localIso(), ending, ...(ending === 'blocked' ? { blockedOn, repeat: !!(prev && prev.ending === 'blocked' && prev.blockedOn === blockedOn) } : {}),
    ...(rejected ? { rejected: true, rejectReason: agg.rejectReason || run.error || '' } : {}), summary: agg.items.length ? (agg.summaries.length > 1 ? agg.summaries.length + ' 件：' + agg.summaries.map(x => clip(x, 60)).join('；') : (agg.summaries[0] || (rejected ? agg.rejectReason : ''))) : (agg.stopReason ? NAMES.t('stop_' + agg.stopReason, { n: stopN }) : ''),
    artifacts: fresh, placed: mech.map(p => p.id).concat(agg.placed.map(p => p.id), agg.asks.map(a => a.id)), aiCost: run.aiCost || null,
    ...(agg.forInfo ? { for: agg.forInfo } : {}), workDay: WORKDAY, pace: agg.pace, items: agg.items, taskIds: agg.items.map(i => i.taskId).filter(Boolean), ...(stopReason ? { stopReason } : {}) });
  // 防空轉按日（Z49）：日內多件／多次開工只加一次
  { const sd = loadState(); const hh = healthOf(sd); if (hh.streakCountedOn !== WORKDAY) { hh.streakCountedOn = WORKDAY; saveState(sd); countStreak(false); } }
}
// 伺服器觸發嘅 run（你送出後）同排程時間見到未登記回覆嘅 run：一樣記入帳本 runs[]
function recordInboxRun(run, hadInput) {
  const ai = (run.steps || []).find(x => x.key === 'ai');
  const aiStarted = !!ai && ai.state !== 'waiting';
  const appliedOnly = run.state === 'done' && !aiStarted && !ADVANCED;
  recordRun({ id: run.id, type: 'inbox', trigger: RUN_TRIGGER, ...(RUN_TYPE ? { slot: RUN_SLOT || todayIso() } : {}), startedAt: run.startedAt, endedAt: run.endedAt || localIso(), capMinutes: rhythmOf(loadState()).runCapMinutes, aiStarted,
    state: run.state === 'waiting' || appliedOnly ? 'skipped' : 'ended', ...(run.state === 'waiting' ? { skipReason: run.waitingFor === 'paused' ? 'pausedByFounder' : 'adapterNotCertified' } : appliedOnly ? { skipReason: 'appliedOnly' } : { ending: ADVANCED ? 'advanced' : (run.kind === 'intake' && run.state === 'done') || (run.result && (run.result.artifacts || []).length) ? 'artifact' : run.state === 'done' && run.result && (run.result.asks || []).length && (['event', 'doc', 'debrief', 'adhoc', 'order'].includes(run.noteType) || run.kind === 'people' || run.kind === 'roles') ? 'asked' : run.state === 'done' && run.kind === 'people' ? 'checked' : 'blocked' }),
    ...(run.state === 'failed' ? { rejected: true, rejectReason: run.error || '' } : {}), label: (ai && ai.label) || ((run.steps || [])[0] || {}).label || U.runType_inbox, summary: (run.result && run.result.summary) || run.error || '', artifacts: (run.result && (run.result.artifacts || []).length) || 0, moduleIds: ['inputs', 'ai-week'] });
  if (hadInput && run.state !== 'waiting' && !appliedOnly) countStreak(true);
}

async function main() {
  if (!takeLock()) { log('另一個 run 做緊，今次唔做'); return; }
  let run = null, hadInput = false;
  try {
    mergeFounderOps();
    mergeRereads();
    applyObserve();
    if (process.argv.includes('--plain')) { await plainAll(); return; }
    const replies = fs.readdirSync(DIR.replies).filter(f => f.endsWith('.md')).sort();
    const intakes = fs.readdirSync(DIR.inbox).filter(isInboxIntake).sort();
    const prefills = fs.readdirSync(DIR.inbox).filter(isInboxPrefill).sort();
    const notes = fs.readdirSync(DIR.inbox).filter(isInboxNote).sort();
    const retry = readJSON(RETRY, null);
    // 辯論回合排最後：創辦人嘅回覆同要求先處理
    const debates = pendingMatches(DIR);
    const founderFiles = replies.length + intakes.length + notes.length + prefills.length;
    // 排程 run：冇你嘅新回覆就做日常工作；有就先處理回覆（記成處理收件，3.6）
    if (RUN_TYPE && !founderFiles) { await rhythmRun(); return; }
    if (!founderFiles && !retry && !debates.length) {
      // 創辦人按「請 Zero 整理名單」（或上一包答齊仍有擱置項目）：伺服器按鍵後即叫外殼，這裏先做，不等下一次日常工作
      const due = peopleSyncDue(loadState(), { packOpen: !!openPeopleSync(), today: todayIso() });
      if (due.due === 'manual' || due.due === 'batch') { run = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), kind: 'people', startedAt: localIso(), state: 'running', replyFiles: [], steps: [] }; const okRun = await peopleSyncStep(run, due, 'ai'); if (run.state === 'running') finish(run, okRun ? 'done' : 'failed', okRun ? '' : (((loadState().peopleSync || {}).lastTry || {}).reason || U.peopleSyncFailed)); }
      if (!run) {
        const rd = ROLES.rolesDue(loadState(), { packOpen: !!openRolesPack(), today: todayIso() });
        if (rd.due === 'manual' || rd.due === 'batch') { run = { id: 'R' + stamp() + '-' + String(process.pid).slice(-3), kind: 'roles', startedAt: localIso(), state: 'running', replyFiles: [], steps: [] }; const okRun = await rolesStep(run, rd, 'ai'); if (run.state === 'running') finish(run, okRun ? 'done' : 'failed', okRun ? '' : (((loadState().rolesSync || {}).lastTry || {}).reason || NAMES.t('rolesSyncFailed'))); }
      }
      return;
    }
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
      // 辯論每一步之間，創辦人剛提出的求助先處理；其餘收件次序不變。
      await handleNote(run, notes.find(f => /-note-help\.md$/.test(f)) || notes[0]);
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
      if (prev.ideateId) { run.ideateId = prev.ideateId; run.ref = prev.ref; return await handleIdeate(run); }
      if (prev.kind === 'intake') {
        // 交資料重做：用返上次登記好嘅資料（喺上次嘅工作資料夾），唔再登記
        run.kind = 'intake'; run.ref = prev.ref;
        step(run, 'received', U.stepIntakeReceived, 'done', '重試上一次');
        step(run, 'applied', U.stepIntakeRegistered, 'done', '沿用上一次');
        const old = path.join(DIR.sandbox, prev.id), sb = newSandbox(run);
        if (!fs.existsSync(path.join(old, 'intake.md'))) { finish(run, 'failed', '找不到上次提交的資料，請重新提交資料'); return; }
        fs.copyFileSync(path.join(old, 'intake.md'), path.join(sb, 'intake.md'));
        if (fs.existsSync(path.join(old, 'files'))) fs.cpSync(path.join(old, 'files'), path.join(sb, 'files'), { recursive: true });
        if (fs.existsSync(path.join(old, 'files.md'))) fs.copyFileSync(path.join(old, 'files.md'), path.join(sb, 'files.md'));
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
          run.kind = 'note'; run.ref = prev.ref; run.noteType = prev.noteType; run.practiceTaskId = prev.practiceTaskId || ''; run.practiceCounterpartId = prev.practiceCounterpartId || '';
          const old = path.join(DIR.sandbox, prev.id), sb = newSandbox(run);
          for (const f of fs.readdirSync(old).filter(f => f !== 'out' && f !== 'biz.md' && !f.endsWith('.txt'))) fs.cpSync(path.join(old, f), path.join(sb, f), { recursive: true });
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
          eventTask(sb, s, { text: fs.readFileSync(old, 'utf8').split('## 創辦人原話').pop().trim(), date: input.eventDate, files: (input.files || []).map(f => path.join(DIR.data, f)), rows: attachmentRows(input), ref: prev.ref, pre: prev.ref + '-note-' + prev.noteType + '-file-', ...(prev.noteType === 'doc' ? { heading: fs.readFileSync(old, 'utf8').split(/\r?\n/)[0] } : {}) });
          await runAIStep(run, sb, U.stepEventAI, true);
          return;
        }
        if (!['order', 'adhoc', 'help'].includes(prev.noteType)) { finish(run, 'failed', '這項工作不能直接重試，請回到原本的頁面重新提交一次。'); return; }
        run.kind = 'note'; run.ref = prev.ref; run.noteType = prev.noteType; run.helpRetries = prev.helpRetries || 0; run.helpForPackId = prev.helpForPackId || ''; run.helpForRunRef = prev.helpForRunRef || '';
        step(run, 'received', U.stepReqReceived, 'done', '重試上一次');
        step(run, 'applied', U.stepReqRegistered, 'done', '沿用上一次');
        const sb = newSandbox(run);
        const oldDir = path.join(DIR.sandbox, prev.id);
        if (run.noteType === 'help' && fs.existsSync(oldDir)) {
          fs.cpSync(oldDir, sb, { recursive: true, filter: source => source === oldDir || (path.basename(source) !== 'out' && path.basename(source) !== 'biz.md' && !source.endsWith('.txt')) });
          let firstWeek = ''; try { firstWeek = fs.readFileSync(path.join(ROOT, 'FIRST-WEEK.md'), 'utf8'); } catch {}
          writeHelpState(sb, firstWeek);
        } else if (run.noteType === 'help') {
          const archive = fs.readdirSync(DIR.archive, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => path.join(DIR.archive, x.name));
          const old = archive.map(d => path.join(d, prev.ref + '-note-help.md')).find(f => fs.existsSync(f));
          if (!old) { finish(run, 'failed', '找不到上次提交的求助，請重新提交'); return; }
          const raw = fs.readFileSync(old, 'utf8'), parsed = parseReply(raw);
          helpNoteTask(sb, raw.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/```json[\s\S]*$/, '').trim(), (parsed.machine || {}).context || {});
        } else {
          const old = path.join(oldDir, 'note.md');
          if (!fs.existsSync(old)) { finish(run, 'failed', '找不到上次提交的要求，請重新提交'); return; }
          { const inp = (loadState().inputs || []).find(i => i.id === 'in-' + prev.ref); noteTask(sb, run.noteType, fs.readFileSync(old, 'utf8').split(/\r?\n\r?\n/).slice(1).join('\n\n').split(/\r?\n\r?\n## 附件（在 files\/）/)[0].trim(), attachmentRows(inp)); }
        }
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
    if (run && run.kind === 'debate' && run.ref) { const m = readMatch(run.ref); if (m && m.next && !m.failed) { m.failed = { pass: m.next, reason: '工作中途中斷', at: localIso() }; m.next = ''; saveMatch(m); } }
    if (run && run.state === 'running') finish(run, 'failed', '工作中途中斷，未有完成。請按「重試」；如再次中斷，請在 AI 對話輸入 /crewzero:dashboard（或說「打開 CrewZero」）重新開啟後再試。');
  } finally {
    if (run && run.state !== 'running') try { recordInboxRun(run, hadInput); } catch (e) { log('記錄 run 出錯：' + (e && e.message || e)); }
    dropLock();
  }
}
main();
