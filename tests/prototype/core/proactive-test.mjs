// 主動提示與決策可信度：先核對不開子程序的資料規則，再以 Founder Desk 驗證可見行為。
// 用法：node proactive-test.mjs <chrome> <輸出> <原型> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';

const [CHROME, OUT, PROTO, a, b] = process.argv.slice(2);
const ADAPTER = b ? a : process.env.SOS_TEST_FAKE || '';
const PORT = Number(b || a);
if (!CHROME || !OUT || !PROTO || !ADAPTER || !Number.isInteger(PORT)) throw new Error('缺少 Chrome、輸出、原型、假 adapter 或連接埠');

const DATA = path.join(OUT, 'data');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
process.env.SOS_DATA = DATA;

const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
const debate = await import(pathToFileURL(path.join(PROTO, 'debate-lib.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const readJson = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const ago = days => new Date(Date.now() - days * 86400000).toISOString();
const normalQuestion = () => ({ id: 'q', ask: '是否確認這項安排？', kind: 'choice', options: [{ text: '確認' }, { text: '暫不確認' }], value: '確認', why: '測試原因。', effect: 'tentative' });
const normalPack = (id, askedAt, extra = {}) => ({ format: 'startup-os.ask/0.1', id, title: '測試待決事項', askedBy: 'AI', askedAt, questions: [normalQuestion()], ...extra });
const coreDirs = lib.dataDirs(PROTO);

/* ---------- 不開子程序：資料規則 ---------- */
const nowRisk = { format: 'startup-os.ask/0.1', title: '風險檢查', questions: [{ id: 'q', ask: '是否作出承諾？', kind: 'choice', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', why: '創辦人已提出此安排。', effect: 'now' }] };
const missingRisk = lib.preparePacks(nowRisk, { dirs: coreDirs });
ok('AI 問題包的即時生效題目沒有風險說明會被拒絕', !missingRisk.ok && missingRisk.errors.some(x => x.includes('不合規格')), missingRisk.errors);

const systemRisk = lib.preparePacks(nowRisk, { dirs: coreDirs, system: true });
ok('系統自動產生的即時生效題目可沒有風險說明', systemRisk.ok, systemRisk.errors);

const withRisk = lib.preparePacks({ format: 'startup-os.ask/0.1', title: '風險及差異檢查', questions: [{ id: 'q', ask: '是否作出承諾？', kind: 'choice', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', why: '創辦人已提出此安排。', effect: 'now', risk: '最壞情況是承諾未能履行；可在確認前撤回。', conflict: '你提交資料時表示暫不作出承諾。' }] }, { dirs: coreDirs });
ok('AI 提供的風險與差異會保留在新問題包', withRisk.ok && withRisk.packs[0].questions[0].risk && withRisk.packs[0].questions[0].conflict, withRisk.ok && withRisk.packs[0].questions[0]);

  const judge = debate.checkJudge({ topRisks: [{ risk: '訂金可能無法退回。', cheapestTest: '先查閱退款條款。', stop: '條款不清楚便停止。' }], founderDecisions: [{ question: '是否支付二萬元訂金？', options: ['支付訂金', '暫不支付'], recommend: '暫不支付', why: '先核對退款條款。', risk: '訂金可能無法退回。', conflict: '先前決定暫不付款。' }] }, { claims: [] }, { attacks: [] });
  const judgeDecision = judge.data && judge.data.founderDecisions[0];
  ok('裁判決策轉成待決事項前保留風險及既有差異', !!judgeDecision && judgeDecision.risk === '訂金可能無法退回。' && judgeDecision.conflict === '先前決定暫不付款。', judgeDecision);

const action = lib.preparePacks({ format: 'startup-os.ask/0.1', title: '本人行動確認', actionConfirm: { taskId: 'task-1' }, questions: [{ id: 'done', ask: '是否已完成？', kind: 'choice', options: [{ text: '任意選項', rec: true }], value: '任意答案', why: '任意理由。', effect: 'now' }] }, { dirs: coreDirs });
const actionQ = action.ok && action.packs[0].questions[0];
ok('本人行動題沒有 AI 預設、理由或通用風險句，並固定三個選項', action.ok && !('value' in actionQ) && !('why' in actionQ) && !('risk' in actionQ) && actionQ.options.map(x => x.text).join('|') === [N.ui.actionDone, N.ui.actionNotDone, N.ui.actionReschedule].join('|'), actionQ);

  const multiAction = lib.preparePacks({ format: 'startup-os.ask/0.1', title: '本人行動確認', actionConfirm: { taskId: 'task-1' }, questions: [{ id: 'done', ask: '是否已送出？' }, { id: 'receipt', ask: '是否已取得確認？' }] }, { dirs: coreDirs });
  ok('新的本人行動問題包只可有一題', !multiAction.ok && multiAction.errors.some(x => x.includes('只可有一條')), multiAction.errors);

writeJson(path.join(coreDirs.asks, 'legacy.json'), normalPack('legacy', ago(1), { questions: [{ id: 'old', ask: '舊題仍可讀取？', kind: 'choice', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', why: '舊資料沒有風險欄位。', effect: 'now' }] }));
ok('舊問題包沒有風險欄位仍可讀取', !!lib.loadPack(coreDirs, 'legacy'), lib.loadPack(coreDirs, 'legacy'));

writeJson(path.join(coreDirs.asks, 'stale.json'), normalPack('stale', ago(3.2)));
writeJson(path.join(coreDirs.asks, 'help-stale.json'), normalPack('help-stale', ago(0.1), { help: { noteId: 'n-1', packId: 'stale' } }));
const coreTodos = dash.pendingTodo(coreDirs, new Date());
const coreStale = coreTodos.find(x => x.id === 'stale');
const listedHelp = lib.listPacks(coreDirs).find(x => x.id === 'help-stale');
ok('三日未答的待決事項會標示逾期，求助包會標示來源問題包', coreStale && coreStale.staleDays >= 3 && listedHelp && listedHelp.helpForPackId === 'stale', { stale: coreStale, help: listedHelp });

writeJson(path.join(coreDirs.company, 'page.json'), { company: { name: '測試公司' } });
const first = dash.dashboardState(coreDirs, { now: new Date(), lastSeen: null });
const back = dash.dashboardState(coreDirs, { now: new Date(), lastSeen: { at: ago(3.1) } });
ok('首次使用不顯示離開提示，三日後保留離開日數', first.since === null && back.since && back.since.awayDays >= 3, { first: first.since, back: back.since });

/* ---------- 瀏覽器：Founder Desk 真實流程 ---------- */
fs.rmSync(DATA, { recursive: true, force: true });
const DIR = lib.dataDirs(PROTO);
seedCompany(DATA, PROTO);
const BASE = 'http://127.0.0.1:' + PORT;
const statusFile = path.join(DIR.ledger, 'status.json');
const stateFile = path.join(DIR.ledger, 'state.json');
const lastSeenFile = path.join(DATA, 'founder', 'desk', 'last-seen.json');
const writePack = pack => writeJson(path.join(DIR.asks, pack.id + '.json'), pack);
  const submitAsk = async (pack, answers) => {
    const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
    const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + lib.localIso()];
    return fetch(BASE + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ kind: 'ask-answer', ref: pack.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' }) });
  };
const clearPacks = () => {
  if (!fs.existsSync(DIR.asks)) return;
  for (const file of fs.readdirSync(DIR.asks)) if (file.endsWith('.json')) fs.unlinkSync(path.join(DIR.asks, file));
};
const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await sleep(200);
  }
  return null;
};
const statusRun = (id, ref, reason) => ({ id, kind: 'intake', ref, state: 'failed', label: '測試工作', error: reason, startedAt: new Date().toISOString(), steps: [] });
const actionPack = (id, taskId, question) => ({ format: 'startup-os.ask/0.1', id, title: '本人行動確認', askedBy: 'AI', askedAt: new Date().toISOString(), actionConfirm: { taskId }, questions: [{ id: 'done', priority: 1, ask: question, kind: 'choice', effect: 'now', options: [{ text: N.ui.actionDone }, { text: N.ui.actionNotDone }, { text: N.ui.actionReschedule }] }] });
const acceptancePack = (id, taskId, artifact) => ({ format: 'startup-os.ask/0.1', id, title: '驗收：測試產出', askedBy: 'AI', askedAt: new Date().toISOString(), acceptance: { taskId, artifact }, questions: [{ id: 'accept', priority: 1, ask: '這份產出可以使用嗎？', kind: 'choice', effect: 'now', options: [{ text: '接受' }, { text: '退回修改' }] }, { id: 'reason', priority: 2, ask: '如要退回，請說明需要修改的內容。', kind: 'text', effect: 'tentative', value: '不用修改', why: '接受時毋須填寫。' }] });

let srv = null;
let cdp = null;
let serverLog = '';
try {
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], {
    cwd: PROTO,
    env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  srv.stdout.on('data', data => { serverLog += data; });
  srv.stderr.on('data', data => { serverLog += data; });
  await usePass(BASE);
  const started = await waitFor(async () => (await fetch(BASE + '/api/status')).ok, 15000);
  ok('主動提示測試伺服器已啟動', !!started, serverLog.slice(0, 300));

  cdp = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 5);
  await usePass(BASE, cdp);

  const failReason = '測試的具體失敗原因';
  writeJson(statusFile, { runs: [statusRun('R-once', 'same-ref', failReason)] });
  await cdp.go(BASE + '/?failure=one#/intake');
  if (await cdp.ev('!!document.querySelector("#intake-anyway")')) await cdp.click('#intake-anyway');
  ok('同一參照只失敗一次時，重新打開頁面仍見失敗卡，但不顯示查找原因按鈕', await cdp.ev('!!document.querySelector("#track.bad") && !document.querySelector(".help-cause")'), await cdp.ev('document.body.innerText'));

  writeJson(statusFile, { runs: [statusRun('R-twice-b', 'same-ref', failReason), statusRun('R-twice-a', 'same-ref', failReason)] });
  await cdp.go(BASE + '/?failure=two#/intake');
  if (await cdp.ev('!!document.querySelector("#intake-anyway")')) await cdp.click('#intake-anyway');
  const causeButton = await cdp.ev('(()=>{const b=document.querySelector(".help-cause button");return b?{text:b.textContent,disabled:b.disabled}:null})()');
  ok('同一參照失敗兩次時，顯示查找原因按鈕', causeButton && causeButton.text === N.ui.helpFindCause && !causeButton.disabled, causeButton);
  await cdp.click('.help-cause button');
  const causeNote = await waitFor(() => {
    const files = fs.existsSync(DIR.inbox) ? fs.readdirSync(DIR.inbox).filter(name => name.endsWith('-note-help.md')) : [];
    const file = files[0] && path.join(DIR.inbox, files[0]);
    return file && fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(failReason) ? file : null;
  }, 1200);
  const causeDisabled = await cdp.ev('(()=>{const b=document.querySelector(".help-cause button");return b?b.disabled:false})()');
  ok('按下查找原因後，收件匣有附上失敗原因的求助內容，按鈕不可再次按下', !!causeNote && causeDisabled, { note: causeNote, disabled: causeDisabled });

  clearPacks();
  const stale = normalPack('ask-stale', ago(2));
  stale.title = '兩日待決事項';
  writePack(stale);
  await cdp.go(BASE + '/?stale=two');
  ok('兩日未答的待決事項不顯示求助按鈕', !(await cdp.ev('!!document.querySelector(".q-help-line button")')), await cdp.ev('document.body.innerText'));

  stale.askedAt = ago(4);
  stale.title = '四日待決事項';
  writePack(stale);
  await cdp.go(BASE + '/?stale=four');
  const staleButton = await cdp.ev('(()=>{const b=document.querySelector(".q-help-line button");return b?{text:b.textContent,disabled:b.disabled}:null})()');
  ok('四日未答的待決事項顯示「不明白這項？」', staleButton && staleButton.text === N.ui.helpStale && !staleButton.disabled, staleButton);

  writePack(normalPack('ask-stale-help', new Date().toISOString(), { help: { noteId: 'n-stale', packId: 'ask-stale' } }));
  await cdp.go(BASE + '/?stale=help');
  ok('已有同一待決事項的未答求助包時，不重複顯示求助按鈕', !(await cdp.ev('!!document.querySelector(".q-help-line button")')), await cdp.ev('document.body.innerText'));

  fs.unlinkSync(path.join(DIR.asks, 'ask-stale-help.json'));
  fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), 'timeout\n');
  await cdp.go(BASE + '/?stale=click');
  await cdp.click('.q-help-line button');
  const staleDisabled = await cdp.ev('(()=>{const b=document.querySelector(".q-help-line button");return b?b.disabled:false})()');
  ok('送出待決事項求助後，按鈕不可再次按下', staleDisabled, staleDisabled);
  const helpWaiting = await waitFor(async () => {
    const s = await (await fetch(BASE + '/api/status')).json();
    return (s.helpInFlight || []).find(h => h.packId === 'ask-stale') || null;
  }, 5000);
  await cdp.go(BASE + '/?stale=refresh');
  ok('處理中的待決事項求助在刷新後仍顯示等待，不能重複送出', !!helpWaiting && !(await cdp.ev('!!document.querySelector(".q-help-line button")')), helpWaiting);

  writeJson(lastSeenFile, { at: ago(4), version: 'test' });
  await cdp.go(BASE + '/?away=old');
  const backAfter = await cdp.ev('(()=>{const e=document.getElementById("back-after");return e?e.innerText:""})()');
  ok('四日未打開 Founder Desk 時，顯示「今天只需要做這一件」', backAfter.includes('今天只需要做這一件'), backAfter);
  fs.unlinkSync(lastSeenFile);
  await cdp.go(BASE + '/?away=none');
  ok('沒有上次查看紀錄時，不顯示離開提示', !(await cdp.ev('!!document.getElementById("back-after")')), await cdp.ev('document.body.innerText'));

  clearPacks();
  writePack({ format: 'startup-os.ask/0.1', id: 'ask-risk-conflict', title: '風險及差異確認', askedBy: 'AI', askedAt: new Date().toISOString(), questions: [{ id: 'decision', priority: 1, ask: '是否作出這項承諾？', kind: 'choice', effect: 'now', options: [{ text: '作出承諾', rec: true }, { text: '暫不作出承諾' }], value: '作出承諾', why: '創辦人已提出此安排。', risk: '最壞情況是承諾未能履行；可在確認前撤回。', conflict: '你提交資料時表示暫不作出承諾。' }] });
  await cdp.go(BASE + '/#/ask/ask-risk-conflict');
  const riskConflict = await cdp.ev('(()=>{const q=document.querySelector("#q-decision");return q?{risk:!!q.querySelector(".risk"),conflict:!!q.querySelector(".conflict")}:null})()');
  ok('風險及差異題目會在畫面顯示風險和差異', riskConflict && riskConflict.risk && riskConflict.conflict, riskConflict);
  await cdp.click('#go-main');
  const heldRisk = await cdp.ev('(()=>({modal:!!document.querySelector("#modal-root .modal"),focus:(document.activeElement||{}).closest?((document.activeElement.closest(".dq")||{}).id||""):"",notice:(document.getElementById("live")||{}).textContent||""}))()');
  ok('按採用 AI 建議時，風險及差異題目不會被略過，畫面定位題目並提示', !heldRisk.modal && heldRisk.focus === 'q-decision' && heldRisk.notice.includes('請先逐題作答'), heldRisk);

  await certifyDirect(DATA, PROTO, ADAPTER);
  clearPacks();
  writeJson(stateFile, { company: { name: '測試公司' }, tasks: [
    { id: 'task-action-done', title: '確認實地行動', owner: 'founder', status: 'waiting' },
    { id: 'task-action-reschedule', title: '改期實地行動', owner: 'founder', status: 'waiting' },
    { id: 'task-action-mixed', title: '送出並取得確認', owner: 'founder', status: 'waiting' },
    { id: 'task-accept', title: '驗收測試產出', owner: 'ai', status: 'review', needsAcceptance: true }
  ] });
  writePack(actionPack('ask-action-done', 'task-action-done', '是否已完成實地行動？'));
  await cdp.go(BASE + '/#/ask/ask-action-done');
  const actionView = await cdp.ev('(()=>{const q=document.querySelector("#q-done");return q?{ai:q.querySelectorAll(".badge-ai").length,why:q.querySelectorAll(".why").length,options:[...q.querySelectorAll(".opt")].map(b=>({text:b.innerText,on:b.getAttribute("aria-pressed")}))}:null})()');
  ok('本人行動題沒有 AI 建議或理由，只有三個本人選項且沒有預設', actionView && actionView.ai === 0 && actionView.why === 0 && actionView.options.map(x => x.text).join('|') === [N.ui.actionDone, N.ui.actionNotDone, N.ui.actionReschedule].join('|') && actionView.options.every(x => x.on === 'false'), actionView);
  await cdp.click('#go-main');
  const blockedAction = await cdp.ev('(()=>({modal:!!document.querySelector("#modal-root .modal"),focus:(document.activeElement.closest(".dq")||{}).id||"",notice:(document.getElementById("live")||{}).textContent||""}))()');
  ok('本人行動題未作答不能送出', !blockedAction.modal && blockedAction.focus === 'q-done' && blockedAction.notice.includes('請先逐題作答'), blockedAction);
  await cdp.click('#q-done .opt');
  await cdp.click('#go-main');
  await cdp.click('#do-confirm');
  const actionDone = await waitFor(() => {
    const task = (readJson(stateFile, {}).tasks || []).find(x => x.id === 'task-action-done');
    return task && task.status === 'done' ? task : null;
  }, 10000);
  ok('本人選擇「已完成」後，工作才轉為已完成', !!actionDone, actionDone);

  writePack(actionPack('ask-action-reschedule', 'task-action-reschedule', '是否需要為實地行動改期？'));
  await cdp.go(BASE + '/#/ask/ask-action-reschedule');
  await cdp.click('#q-done .opt:nth-of-type(3)');
  await cdp.click('#go-main');
  await cdp.click('#do-confirm');
  const rescheduled = await waitFor(() => {
    const task = (readJson(stateFile, {}).tasks || []).find(x => x.id === 'task-action-reschedule');
    return task && task.status === 'waiting' && String(task.waitingFor || '').includes('改期') ? task : null;
  }, 10000);
  ok('本人選擇「需要改期」後，工作維持等待', !!rescheduled, rescheduled);

  const mixed = { ...actionPack('ask-action-mixed', 'task-action-mixed', '是否已送出申請？'), questions: [{ id: 'sent', priority: 1, ask: '是否已送出申請？', kind: 'choice', effect: 'now', options: [{ text: N.ui.actionDone }, { text: N.ui.actionNotDone }, { text: N.ui.actionReschedule }] }, { id: 'receipt', priority: 2, ask: '是否已取得收件確認？', kind: 'choice', effect: 'now', options: [{ text: N.ui.actionDone }, { text: N.ui.actionNotDone }, { text: N.ui.actionReschedule }] }] };
  writePack(mixed);
  const mixedReply = await submitAsk(mixed, [{ id: 'sent', value: N.ui.actionDone, ai: '', changed: true }, { id: 'receipt', value: N.ui.actionNotDone, ai: '', changed: true }]);
  const mixedWaiting = await waitFor(() => {
    const task = (readJson(stateFile, {}).tasks || []).find(x => x.id === 'task-action-mixed');
    return task && task.status === 'waiting' ? task : null;
  }, 10000);
  ok('舊的兩題本人行動包混合答案時，整項工作維持等待', mixedReply.status === 200 && !!mixedWaiting && mixedWaiting.confirmedBy !== 'founder', { status: mixedReply.status, task: mixedWaiting });

  writePack(acceptancePack('ask-accept', 'task-accept', { title: '測試產出全文', text: '第一段產出內容。\n\n第二段產出內容。' }));
  await cdp.go(BASE + '/#/ask/ask-accept');
  const acceptanceView = await cdp.ev('(()=>{const q=document.querySelector("#q-accept"),art=document.querySelector("details.art");return q?{artifact:art?art.innerText:"",selected:[...q.querySelectorAll(".opt")].filter(b=>b.getAttribute("aria-pressed")==="true").length,ai:q.querySelectorAll(".badge-ai").length}:null})()');
  ok('驗收題顯示產出全文，沒有 AI 預設選項', acceptanceView && acceptanceView.artifact.includes('第一段產出內容。') && acceptanceView.artifact.includes('第二段產出內容。') && acceptanceView.selected === 0 && acceptanceView.ai === 0, acceptanceView);
  await cdp.click('#go-main');
  const blockedAcceptance = await cdp.ev('(()=>({modal:!!document.querySelector("#modal-root .modal"),focus:(document.activeElement.closest(".dq")||{}).id||"",notice:(document.getElementById("live")||{}).textContent||""}))()');
  ok('驗收題未作答不能送出，工作不會轉為已完成', !blockedAcceptance.modal && blockedAcceptance.focus === 'q-accept' && blockedAcceptance.notice.includes('請先逐題作答') && (readJson(stateFile, {}).tasks || []).find(x => x.id === 'task-accept').status !== 'done', blockedAcceptance);
  await cdp.click('#q-accept .opt');
  await cdp.click('#go-main');
  await cdp.click('#do-confirm');
  const accepted = await waitFor(() => {
    const task = (readJson(stateFile, {}).tasks || []).find(x => x.id === 'task-accept');
    return task && task.status === 'done' ? task : null;
  }, 10000);
  ok('本人選擇「接受」後，驗收工作才轉為已完成', !!accepted, accepted);

  writePack(acceptancePack('ask-accept-missing', 'task-accept', null));
  await cdp.go(BASE + '/#/ask/ask-accept-missing');
  const missingArtifact = await cdp.ev('(()=>{const q=document.querySelector("#q-accept");return {text:document.body.innerText,selected:q?[...q.querySelectorAll(".opt")].some(b=>b.getAttribute("aria-pressed")==="true"):true}})()');
  ok('驗收題沒有產出內容時顯示指定提示，仍沒有預設選項', missingArtifact.text.includes(N.ui.acceptanceMissing) && !missingArtifact.selected, missingArtifact);

  clearPacks();
  writePack({ format: 'startup-os.ask/0.1', id: 'ask-legacy-visible', title: '舊問題包', askedBy: 'AI', askedAt: ago(1), questions: [{ id: 'old', ask: '舊題是否仍可查看？', kind: 'choice', effect: 'now', options: [{ text: '可以', rec: true }, { text: '不可以' }], value: '可以', why: '這是舊資料。' }] });
  await cdp.go(BASE + '/#/ask/ask-legacy-visible');
  const legacyVisible = await cdp.ev('document.body.innerText.includes("舊題是否仍可查看？")');
  ok('舊磁碟問題包沒有風險欄位仍可在 Founder Desk 顯示', legacyVisible, legacyVisible);
  ok('頁面沒有程式錯誤', !cdp.errors.length, cdp.errors);
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  try { cdp && cdp.close(); } catch {}
  try { srv && srv.kill(); } catch {}
  fs.writeFileSync(path.join(OUT, 'server-log.txt'), serverLog);
}

for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info || null).slice(0, 1000)));
console.log('\nPASS ' + results.filter(result => result.pass).length + ' / ' + results.length);
if (results.some(result => !result.pass)) process.exitCode = 1;
