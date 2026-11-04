// 首頁業務主線：創辦人操作不經 AI 即時生效，外殼下一次開工才合併。
// 用法：node founder-op-test.mjs <原型資料夾> <輸出資料夾> <port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass, pair } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT] = process.argv.slice(2);
const DATA = path.join(OUT, 'data');
const BASE = `http://127.0.0.1:${PORT}`;
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.rmSync(OUT, { recursive: true, force: true });
process.env.SOS_DATA = DATA;
const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const DIR = ask.dataDirs(PROTO);
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const stateFile = path.join(DIR.ledger, 'state.json');
write(stateFile, {
  company: { nextExternalAction: { text: '聯絡客戶安排會面', milestoneId: 'M1' } },
  intake: { state: 'complete' },
  milestones: [{ id: 'M1', short: '取得首個客戶', event: '聯絡客戶安排會面', state: 'active', pathStatus: 'confirmed', order: 1 }],
  events: []
});
write(path.join(DIR.asks, 'ask-main.json'), { id: 'ask-main', title: '確認會面安排', askedBy: 'AI', askedAt: ask.localIso(), todoType: 'decision', questions: [{ id: 'q1', ask: '確認會面安排嗎？', kind: 'choice', value: '確認', why: '需要你的決定', options: [{ text: '確認', rec: true }] }] });

let srv = null;
const start = () => spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const post = async (pathName, body) => {
  const res = await fetch(BASE + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { }
  return { code: res.status, json };
};
const get = async pathName => (await fetch(BASE + pathName)).json();
const runShell = () => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, encoding: 'utf8', timeout: 30000 });
const readState = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const writeInterviewReply = (pack, answers, file) => {
  write(path.join(DIR.asks, pack.id + '.json'), pack);
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: '2026-11-03T10:00:00+00:00', batch: answers.map(answer => answer.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + ask.fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: 2026-11-03T10:00:00+00:00'];
  fs.writeFileSync(path.join(DIR.replies, file), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
};
async function ready() {
  for (let i = 0; i < 80; i++) {
    try { if ((await get('/api/health')).ok) return true; } catch { }
    await sleep(100);
  }
  return false;
}

try {
  srv = start();
  ok('伺服器就緒', await ready());
  await usePass(BASE);
  const changed = await post('/api/founder-op', { op: 'reschedule', target: 'nextAction', value: { date: '2030-02-04' } });
  ok('改期操作獲接收', changed.code === 202 && changed.json && changed.json.ok, changed);
  let dash = await get('/api/dashboard');
  ok('改期無須等待外殼即時讀回', dash.nextAction && dash.nextAction.date === '2030-02-04', dash.nextAction);
  const snooze = await post('/api/founder-op', { op: 'snooze', target: 'ask-main', value: { until: '2030-02-11' } });
  dash = await get('/api/dashboard');
  ok('暫緩即時移出主線', snooze.code === 202 && !dash.todo.some(t => t.id === 'ask-main') && dash.snoozed.some(t => t.id === 'ask-main'), { snooze, todo: dash.todo, snoozed: dash.snoozed });
  const cancel = await post('/api/founder-op', { op: 'cancelNext', target: 'nextAction', value: {} });
  dash = await get('/api/dashboard');
  ok('取消後顯示待設定狀態及建議', cancel.code === 202 && dash.nextAction.stale && dash.nextAction.suggestion && dash.nextAction.suggestion.milestoneId === 'M1', dash.nextAction);
  const reset = await post('/api/founder-op', { op: 'setNext', target: 'nextAction', value: { text: '安排下一次客戶會面', date: '2030-02-08', milestoneId: 'M1' } });
  ok('採用新動作即時讀回', reset.code === 202 && (await get('/api/dashboard')).nextAction.text === '安排下一次客戶會面', reset);
  srv.kill(); srv = null;
  const merged = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, encoding: 'utf8', timeout: 30000 });
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  ok('下一次外殼開工合併操作', merged.status === 0 && state.company.nextExternalAction.text === '安排下一次客戶會面' && !fs.existsSync(path.join(DIR.ledger, 'founder-ops.json')), { status: merged.status, stderr: String(merged.stderr || '').slice(0, 300), next: state.company.nextExternalAction });
  ok('外殼合併後留下創辦人操作事件', (state.events || []).filter(event => event.type === 'founder-op').length >= 4, state.events);
  // 中斷後留下的批次先處理；已儲存的操作重播時不可再套用或再記錄事件。
  const recovered = { id: 'fo-recovered', at: '2030-02-09T10:00:00+00:00', op: 'reschedule', target: 'nextAction', value: { date: '2030-02-09' } };
  write(path.join(DIR.ledger, '.founder-ops-100-1000.json'), [recovered]);
  const firstRecovery = runShell(), recoveredState = readState(), eventsAfterRecovery = recoveredState.events.length;
  ok('中斷批次會在較新操作之前恢復', firstRecovery.status === 0 && recoveredState.company.nextExternalAction.date === '2030-02-09' && recoveredState.founderOpsDone.includes(recovered.id) && !fs.existsSync(path.join(DIR.ledger, '.founder-ops-100-1000.json')), { status: firstRecovery.status, next: recoveredState.company.nextExternalAction, done: recoveredState.founderOpsDone });
  const later = { id: 'fo-later', at: '2030-02-09T10:01:00+00:00', op: 'setNext', target: 'nextAction', value: { text: '批次後的新安排', milestoneId: 'M1' } };
  write(path.join(DIR.ledger, '.founder-ops-101-2000.json'), [recovered, later]);
  const repeatedRecovery = runShell(), repeatedState = readState();
  ok('已合併批次不會重複套用或重複記錄', repeatedRecovery.status === 0 && repeatedState.company.nextExternalAction.text === '批次後的新安排' && repeatedState.events.length === eventsAfterRecovery + 1 && repeatedState.founderOpsDone.includes(later.id), { status: repeatedRecovery.status, events: repeatedState.events.slice(-3), done: repeatedState.founderOpsDone });

  // 201 個操作先寫帳本、後刪批次時若中斷，重試不可因為只保留最後 200 個而倒退。
  const retryBatch = Array.from({ length: 201 }, (_, i) => ({ id: 'fo-batch-' + i, at: '2030-02-10T10:' + String(i % 60).padStart(2, '0') + ':00+00:00', op: 'reschedule', target: 'nextAction', value: { date: '2030-03-' + String((i % 28) + 1).padStart(2, '0') } }));
  write(path.join(DIR.ledger, '.founder-ops-202-3000.json'), retryBatch);
  const batchFirst = runShell(), afterBatch = readState(), batchDate = afterBatch.company.nextExternalAction.date, batchEvents = afterBatch.events.length;
  write(path.join(DIR.ledger, '.founder-ops-203-3001.json'), retryBatch);
  const batchRetry = runShell(), afterRetry = readState();
  ok('201 個批次保存後重試不倒退，所有本批 id 都留在完成紀錄', batchFirst.status === 0 && batchRetry.status === 0 && afterRetry.company.nextExternalAction.date === batchDate && afterRetry.events.length === batchEvents && retryBatch.every(op => afterRetry.founderOpsDone.includes(op.id)), { batchDate, done: afterRetry.founderOpsDone.length, events: afterRetry.events.length });

  // 兩個入口均須回收失效鎖，但不得奪走仍由本程序持有的有效鎖。
  const founderLock = path.join(DIR.ledger, '.founder-ops.lock');
  const runnerStale = { id: 'fo-runner-stale-lock', at: '2030-02-09T10:02:00+00:00', op: 'setNext', target: 'nextAction', value: { text: '外殼鎖恢復後的安排', milestoneId: 'M1' } };
  write(path.join(DIR.ledger, 'founder-ops.json'), [runnerStale]); fs.writeFileSync(founderLock, '2147483647'); fs.utimesSync(founderLock, new Date('2020-01-01'), new Date('2020-01-01'));
  const staleRunner = runShell(), staleRunnerState = readState();
  ok('外殼會回收失效的創辦人操作鎖', staleRunner.status === 0 && staleRunnerState.company.nextExternalAction.text === '外殼鎖恢復後的安排' && !fs.existsSync(founderLock), { status: staleRunner.status, next: staleRunnerState.company.nextExternalAction });
  const runnerHeld = { id: 'fo-runner-held-lock', at: '2030-02-09T10:03:00+00:00', op: 'setNext', target: 'nextAction', value: { text: '不應套用的有效鎖安排', milestoneId: 'M1' } };
  write(path.join(DIR.ledger, 'founder-ops.json'), [runnerHeld]); fs.writeFileSync(founderLock, String(process.pid));
  const heldRunner = runShell(), heldRunnerState = readState();
  ok('外殼不會奪走有效的創辦人操作鎖', heldRunner.status === 0 && fs.existsSync(founderLock) && fs.existsSync(path.join(DIR.ledger, 'founder-ops.json')) && heldRunnerState.company.nextExternalAction.text === '外殼鎖恢復後的安排', { status: heldRunner.status, next: heldRunnerState.company.nextExternalAction });
  fs.rmSync(founderLock, { force: true }); fs.rmSync(path.join(DIR.ledger, 'founder-ops.json'), { force: true });
  srv = start();
  ok('伺服器重新就緒', await ready());
  await usePass(BASE);
  fs.writeFileSync(founderLock, '2147483647'); fs.utimesSync(founderLock, new Date('2020-01-01'), new Date('2020-01-01'));
  const staleServer = await post('/api/founder-op', { op: 'reschedule', target: 'nextAction', value: { date: '2030-02-10' } });
  ok('伺服器會回收失效的創辦人操作鎖', staleServer.code === 202 && !fs.existsSync(founderLock), staleServer);
  fs.writeFileSync(founderLock, String(process.pid));
  const heldServer = await post('/api/founder-op', { op: 'reschedule', target: 'nextAction', value: { date: '2030-02-11' } });
  ok('伺服器不會奪走有效的創辦人操作鎖', heldServer.code === 409 && fs.existsSync(founderLock), heldServer);
  fs.rmSync(founderLock, { force: true }); srv.kill(); srv = null;

  // 回覆檔名是伺服器收件時間；較舊的回覆不可覆蓋首頁較新的安排。
  fs.rmSync(DATA, { recursive: true, force: true }); ask.dataDirs(PROTO);
  write(stateFile, { company: { nextExternalAction: { text: '原有安排', milestoneId: 'M1' } }, intake: { state: 'complete' }, interviews: { applied: {} }, milestones: [{ id: 'M1', short: '首個客戶', event: '聯絡客戶', state: 'active', pathStatus: 'confirmed', order: 1 }], events: [] });
  const oldInterview = { id: 'iv-older', title: '較舊每週訪問', rhythm: { kind: 'interview', on: '2026-11-03' }, questions: [{ id: 'next', bind: 'next', kind: 'text', ask: '下一個對外動作？' }] };
  write(path.join(DIR.ledger, 'founder-ops.json'), [{ id: 'fo-newer-home', at: '2026-11-03T11:00:00+00:00', op: 'setNext', target: 'nextAction', value: { text: '週三與乙公司會面', milestoneId: 'M1' } }]);
  writeInterviewReply(oldInterview, [{ id: 'next', value: '週一與甲公司會面', changed: true }], '2026-11-03-100000-ask-answer-iv-older.md');
  const oldReplyRun = runShell(), oldReplyState = readState();
  ok('較舊回覆不會覆蓋較新的首頁安排', oldReplyRun.status === 0 && oldReplyState.company.nextExternalAction.text === '週三與乙公司會面' && /你其後已在首頁更新，這項改動沒有套用/.test((((ask.readJSON(path.join(DIR.ledger, 'status.json'), {}) || {}).runs || [])[0] || {}).result?.summary || ''), { status: oldReplyRun.status, next: oldReplyState.company.nextExternalAction });

  // 獨立日期改期必須保留動作文字和所屬站點。
  fs.rmSync(DATA, { recursive: true, force: true }); ask.dataDirs(PROTO);
  write(stateFile, { company: { nextExternalAction: { text: '約見客戶', date: '2026-11-01', milestoneId: 'M1' } }, intake: { state: 'complete' }, interviews: { applied: {} }, milestones: [{ id: 'M1', short: '首個客戶', event: '約見客戶', state: 'active', pathStatus: 'confirmed', order: 1 }], events: [] });
  const dateInterview = { id: 'iv-date', title: '改期每週訪問', rhythm: { kind: 'interview', on: '2026-11-03' }, questions: [{ id: 'newDate', bind: 'newDate', kind: 'date', ask: '改到哪一天？' }] };
  writeInterviewReply(dateInterview, [{ id: 'newDate', value: '2026-11-10', changed: true }], '2026-11-03-100000-ask-answer-iv-date.md');
  const dateReplyRun = runShell(), dateReplyState = readState();
  ok('每週訪問改期會保留獨立日期及既有欄位', dateReplyRun.status === 0 && dateReplyState.company.nextExternalAction.text === '約見客戶' && dateReplyState.company.nextExternalAction.date === '2026-11-10' && dateReplyState.company.nextExternalAction.milestoneId === 'M1', { status: dateReplyRun.status, next: dateReplyState.company.nextExternalAction });

  // 已提交但較舊的 odDate 回覆不可蓋過其後在首頁改過的目標日。
  fs.rmSync(DATA, { recursive: true, force: true }); ask.dataDirs(PROTO);
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }, intake: { state: 'complete', confirmedAt: '2026-11-03T09:00:00+00:00' }, ledgerFrom: 'legacy', interviews: { applied: {} }, targetOverride: { M1: '2026-12-18' }, targetOverrideBase: { M1: '2026-12-01' }, targetOverrideAt: { M1: '2026-11-03T11:00:00+00:00' }, milestones: [{ id: 'M1', short: '首個客戶', targetDate: '2026-12-18', state: 'active', pathStatus: 'confirmed', order: 1 }], events: [] });
  const olderTargetInterview = { id: 'iv-older-target', title: '較舊目標日回覆', rhythm: { kind: 'interview', on: '2026-11-03' }, questions: [{ id: 'odDate', bind: 'odDate', overdue: { milestoneId: 'M1' }, kind: 'date', ask: '改目標日？' }] };
  writeInterviewReply(olderTargetInterview, [{ id: 'odDate', value: '2026-12-08', changed: true }], '2026-11-03-100000-ask-answer-iv-older-target.md');
  const olderTargetRun = runShell(), olderTargetState = readState();
  const olderTargetSummary = (((ask.readJSON(path.join(DIR.ledger, 'status.json'), {}) || {}).runs || [])[0] || {}).result?.summary || '';
  ok('較舊 odDate 回覆保留較新的目標日，並寫明結果', olderTargetRun.status === 0 && olderTargetState.milestones.find(m => m.id === 'M1').targetDate === '2026-12-18' && /較新的更改保留/.test(olderTargetSummary), { status: olderTargetRun.status, target: olderTargetState.milestones.find(m => m.id === 'M1').targetDate, olderTargetSummary });

  // 同一秒分唔到先後：保留已生效嘅日期。
  fs.rmSync(DATA, { recursive: true, force: true }); ask.dataDirs(PROTO);
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }, intake: { state: 'complete', confirmedAt: '2026-11-03T09:00:00+00:00' }, ledgerFrom: 'legacy', interviews: { applied: {} }, targetOverride: { M1: '2026-12-18' }, targetOverrideBase: { M1: '2026-12-01' }, targetOverrideAt: { M1: '2026-11-03T10:00:00' }, milestones: [{ id: 'M1', short: '首個客戶', targetDate: '2026-12-18', state: 'active', pathStatus: 'confirmed', order: 1 }], events: [] });
  const sameSecondInterview = { id: 'iv-same-second', title: '較舊目標日回覆', rhythm: { kind: 'interview', on: '2026-11-03' }, questions: [{ id: 'odDate', bind: 'odDate', overdue: { milestoneId: 'M1' }, kind: 'date', ask: '改目標日？' }] };
  writeInterviewReply(sameSecondInterview, [{ id: 'odDate', value: '2026-12-08', changed: true }], '2026-11-03-100000-ask-answer-iv-same-second.md');
  const sameSecondRun = runShell(), sameSecondState = readState();
  const sameSecondSummary = (((ask.readJSON(path.join(DIR.ledger, 'status.json'), {}) || {}).runs || [])[0] || {}).result?.summary || '';
  ok('同一秒的 odDate 回覆不會蓋走已生效的目標日', sameSecondRun.status === 0 && sameSecondState.milestones.find(m => m.id === 'M1').targetDate === '2026-12-18' && /較新的更改保留/.test(sameSecondSummary), { status: sameSecondRun.status, target: sameSecondState.milestones.find(m => m.id === 'M1').targetDate, sameSecondSummary });

  // 公司概覽本身改日子時，只有確認時間較覆蓋時間新才可以蓋回；舊確認要保留創辦人的較新日期。
  fs.rmSync(DATA, { recursive: true, force: true }); ask.dataDirs(PROTO);
  const overview = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'example-company-page.json'), 'utf8'));
  overview.path.milestones[0].target = { id: 'test-target-m1', label: '目標日', value: '2026-12-08' };
  write(path.join(DIR.company, 'page.json'), overview);
  const confirmation = { pageId: overview.page.id, confirmedAt: '2026-11-03T10:00:00+00:00', values: {}, order: overview.path.milestones.map(m => m.id) };
  write(path.join(DIR.ledger, 'confirmed.json'), confirmation);
  write(stateFile, { company: {}, intake: { state: 'complete', confirmedAt: '2026-11-03T09:00:00+00:00' }, ledgerFrom: overview.page.id, milestones: [{ id: 'm1', short: overview.path.milestones[0].short, targetDate: '2026-12-18', pathStatus: 'confirmed', state: 'active' }], targetOverride: { m1: '2026-12-18' }, targetOverrideBase: { m1: '2026-12-01' }, targetOverrideAt: { m1: '2026-11-03T11:00:00+00:00' }, events: [], tasks: [] });
  const syncShell = () => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'rhythm', '--trigger', 'manual'], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, encoding: 'utf8', timeout: 30000 });
  const olderConfirmed = syncShell(), keptOverride = readState();
  confirmation.confirmedAt = '2026-11-03T12:00:00+00:00'; write(path.join(DIR.ledger, 'confirmed.json'), confirmation);
  const newerConfirmed = syncShell(), replacedOverride = readState();
  ok('公司概覽確認較舊時保留覆蓋、較新時才套用概覽日期', olderConfirmed.status === 0 && newerConfirmed.status === 0 && keptOverride.milestones.find(m => m.id === 'm1').targetDate === '2026-12-18' && replacedOverride.milestones.find(m => m.id === 'm1').targetDate === '2026-12-08' && !replacedOverride.targetOverride?.m1, { kept: keptOverride.milestones.find(m => m.id === 'm1').targetDate, replaced: replacedOverride.milestones.find(m => m.id === 'm1').targetDate });

  fs.rmSync(DATA, { recursive: true, force: true }); ask.dataDirs(PROTO);
  write(stateFile, { demo: true, company: { nextExternalAction: { text: '示範動作', milestoneId: 'M1' } }, milestones: [{ id: 'M1', short: '示範站', state: 'active', pathStatus: 'confirmed' }] });
  srv = start();
  await ready();
  // 資料夾已清空，舊通行證失效，要重新配對
  const fresh = await pair(BASE);
  const demoRes = await fetch(BASE + '/api/founder-op', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, cookie: fresh.name + '=' + fresh.value }, body: JSON.stringify({ op: 'cancelNext', target: 'nextAction', value: {} }) });
  const demo = { code: demoRes.status, json: await demoRes.json() };
  ok('示範資料拒絕創辦人操作', demo.code === 400 && demo.json && demo.json.error === 'demo', demo);
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (srv) srv.kill();
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
