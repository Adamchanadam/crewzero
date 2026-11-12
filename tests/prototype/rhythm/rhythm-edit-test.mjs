// 系統頁自動開工設定：真時鐘、隔離資料夾、假 AI、假排程命令；唔碰真資料同真 AI。
// 用法：node rhythm-edit-test.mjs <Chrome> <輸出> <原型> <假AI> <埠>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass, passCookie } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, FAKE, PORT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 500))); };
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const stateFile = path.join(OUT, 'data', 'ledger', 'state.json');
const markFile = path.join(OUT, 'data', 'ledger', 'schedule.json');
const founderOps = path.join(OUT, 'data', 'ledger', 'founder-ops.json');
const BASE = 'http://127.0.0.1:' + PORT;
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SOS_/.test(key)));
let server = null, chrome = null;
const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
const minute = n => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + n); return { value: hhmm(d), at: d }; };
const sleepTo = async d => sleep(Math.max(0, Math.min(210000, d.getTime() - Date.now() + 35000)));
const state = () => read(stateFile) || {};
const writeState = s => fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
const scheduleRuns = () => (state().runs || []).filter(r => r.trigger === 'schedule');
async function waitFor(fn, timeout = 70000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return true; await sleep(250); } return false; }
async function post(body, headers = {}) {
  const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: passCookie(BASE), ...headers }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, j };
}
function seed(extra = {}) {
  const r = minute(-1).value;
  writeState({ schemaVersion: 1, company: { name: '節奏測試', rhythm: { runCadence: 'daily', runTime: r, timezone: 'Europe/London', interviewWeekday: 1, runCapMinutes: 30, triggeredRunsPerHour: 6, aiStartsPerDay: 40 } }, interviews: { nextOn: '2099-01-05', applied: {} }, runs: [], tasks: [], events: [], inputs: [], milestones: [], ...extra });
}

try {
  freshTestOut(OUT);
  for (const dir of ['ledger', 'company', 'asks', 'founder/inbox', 'founder/replies', 'archive', 'work', 'sandbox', 'founder/desk']) fs.mkdirSync(path.join(OUT, 'data', dir), { recursive: true });
  seed();
  const rules = await import(new URL('../../../prototypes/proofread/bundle-rules.mjs', import.meta.url).href);
  ok('安裝與插件打包清單包含排程安裝程式', rules.programFiles(PROTO).includes('adapters/scheduler/install-schedule.mjs') && fs.existsSync(path.join(PROTO, 'adapters', 'claude-code', 'crewzero', 'program', 'adapters', 'scheduler', 'install-schedule.mjs')));
  const rhythmLib = await import(new URL('../../../prototypes/proofread/rhythm-lib.mjs', import.meta.url).href);
  const edge = new Date(); edge.setSeconds(0, 0);
  const edgeRhythm = { runCadence: 'daily', runTime: hhmm(edge), interviewWeekday: 1 };
  const sameSecond = rhythmLib.scheduleEligibility(edgeRhythm, new Date(edge.getTime() + 60 * 1000), { updatedAt: edge.toISOString() });
  const changedLate = rhythmLib.scheduleEligibility(edgeRhythm, new Date(edge.getTime() + 60 * 1000), { updatedAt: new Date(edge.getTime() + 1000).toISOString(), aiReady: true });
  const catchUp = rhythmLib.scheduleEligibility(edgeRhythm, new Date(edge.getTime() + 60 * 1000), { approvedAt: new Date(edge.getTime() - 60 * 1000).toISOString(), aiReady: true });
  ok('slot 與 updatedAt 同一秒不開工；改時間後不顯示補做；合資格時才補做', sameSecond.slot === null && !changedLate.catchUp && catchUp.catchUp, { sameSecond, changedLate, catchUp });
  server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...clean, SOS_DATA: path.join(OUT, 'data'), SOS_ADAPTER: FAKE, SOS_SCHED_CMD: path.join(HERE, '..', 'lib', 'fake-schtasks.mjs'), SOS_SCHED_LOG: path.join(OUT, 'schedule-calls.jsonl'), SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  const online = await waitFor(async () => { try { return (await fetch(BASE + '/api/health')).ok; } catch { return false; } }, 15000);
  ok('隔離伺服器已啟動', online);
  await usePass(BASE);

  const beforeOps = () => Array.isArray(read(founderOps)) ? read(founderOps).length : 0;
  const bad = [{ runCadence: 'daily', runTime: '24:00', interviewWeekday: 1 }, { runCadence: 'daily', runTime: '9:00', interviewWeekday: 1 }, { runCadence: 'daily', runTime: 'abc', interviewWeekday: 1 }, { runCadence: 'monthly', runTime: '09:00', interviewWeekday: 1 }, { runCadence: 'daily', runTime: '09:00', interviewWeekday: 0 }, { runCadence: 'daily', runTime: '09:00', interviewWeekday: 8 }, { runCadence: 'daily', runTime: '09:00', interviewWeekday: 1.5 }, { runCadence: 'daily', runTime: '09:00', interviewWeekday: 1, extra: true }];
  const n0 = beforeOps();
  const badRes = [];
  for (const value of bad) badRes.push(await post({ action: 'rhythm', value }));
  badRes.push(await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: '09:00', interviewWeekday: 1 }, extra: true }));
  badRes.push(await post({ action: 'schedule', op: 'on', extra: true }));
  ok('節奏與排程接口嚴格拒絕壞時間、頻率、星期與未知鍵，而且不寫操作', badRes.every(x => x.status === 400) && beforeOps() === n0, badRes.map(x => x.status));

  const past = minute(-60);
  const turnedOn = await post({ action: 'schedule', op: 'on' });
  const mark = read(markFile);
  ok('開啟自動開工只寫新標記，已過時段不會補做', turnedOn.status === 200 && turnedOn.j && turnedOn.j.ok === true && mark && mark.mode === 'server' && !!mark.approvedAt);
  const changedPast = await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: past.value, interviewWeekday: 3 } });
  const mergedPast = await waitFor(() => state().company?.rhythm?.runTime === past.value && state().company?.rhythm?.interviewWeekday === 3, 15000);
  const firstNext = state().interviews?.nextOn;
  await sleep(65000);
  ok('時間改到一小時前後，等過兩次 tick 也不會開工', changedPast.status === 202 && mergedPast && scheduleRuns().length === 0, { changedPast, runs: scheduleRuns() });

  const sameDay = await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: past.value, interviewWeekday: 3 } });
  await waitFor(() => state().company?.rhythm?.updatedAt && !fs.existsSync(founderOps), 15000);
  ok('同一訪問日再次儲存不會重算下次訪問', sameDay.status === 202 && state().interviews?.nextOn === firstNext, state().interviews);

  const future = minute(2);
  const changedFuture = await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: future.value, interviewWeekday: 5 } });
  const due = await waitFor(() => state().company?.rhythm?.runTime === future.value, 15000);
  await sleepTo(future.at);
  const oneRun = await waitFor(() => scheduleRuns().length === 1, 70000);
  const triggeredRun = scheduleRuns()[0] || {};
  ok('改到即將到達的時間：只確認計時器觸發一次', changedFuture.status === 202 && due && oneRun && typeof triggeredRun.state === 'string' && (triggeredRun.state !== 'skipped' || typeof triggeredRun.skipReason === 'string'), triggeredRun);

  const later = minute(2);
  await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: later.value, interviewWeekday: 5 } });
  await waitFor(() => state().company?.rhythm?.runTime === later.value, 15000);
  await waitFor(() => !fs.existsSync(founderOps), 15000);
  const dash = await (await fetch(BASE + '/api/dashboard', { headers: { Cookie: passCookie(BASE) } })).json();
  await sleepTo(later.at);
  ok('今日已開工後改到今日稍後：不會第二次開工，預覽下次是之後日子', scheduleRuns().length === 1 && dash.rhythmInfo?.ranToday === true && String(dash.rhythmInfo?.nextRunAt || '').slice(0, 10) > String(dash.today || ''), dash.rhythmInfo);

  const off = await post({ action: 'schedule', op: 'off' });
  ok('停止自動開工會移除標記而保留公司節奏', off.status === 200 && off.j && off.j.ok === true && !fs.existsSync(markFile) && state().company?.rhythm?.runTime === later.value, { off, rhythm: state().company?.rhythm });
  fs.writeFileSync(markFile, JSON.stringify({ name: 'crewzero-old', runTime: '09:00', cadence: 'daily' }, null, 2));
  const legacy = await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: '10:00', interviewWeekday: 1 } });
  ok('舊式標記不能直接改時間', legacy.status === 409 && beforeOps() === 0, legacy);
  const migrate = await post({ action: 'schedule', op: 'on' });
  ok('舊式排程可更新自動開工設定', migrate.status === 200 && migrate.j && migrate.j.ok === true && read(markFile)?.mode === 'server', migrate);

  writeState({ ...state(), demo: true });
  const demo = await post({ action: 'rhythm', value: { runCadence: 'daily', runTime: '10:00', interviewWeekday: 1 } });
  writeState({ ...state(), demo: false });
  const noOverviewState = state(); delete noOverviewState.company.rhythm; writeState(noOverviewState);
  const noOverview = await post({ action: 'schedule', op: 'on' });
  ok('示範及未確認公司概覽分別拒絕設定', demo.status === 409 && noOverview.status === 409, { demo, noOverview });
  seed({ intake: { state: 'complete', confirmedAt: '2026-11-03T09:00:00+00:00' } });
  const page = read(path.join(PROTO, 'fixtures', 'example-company-page.json'));
  writeState({ ...state(), ledgerFrom: page.page.id });
  fs.writeFileSync(path.join(OUT, 'data', 'company', 'page.json'), JSON.stringify(page, null, 2));
  fs.writeFileSync(path.join(OUT, 'data', 'ledger', 'confirmed.json'), JSON.stringify({ pageId: 'old-page', confirmedAt: new Date().toISOString() }, null, 2));
  const pendingOn = await post({ action: 'schedule', op: 'on' }), pendingOff = await post({ action: 'schedule', op: 'off' });
  const staleRun = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'auto', '--trigger', 'schedule', '--slot', '2026-11-03'], { cwd: PROTO, env: { ...clean, SOS_DATA: path.join(OUT, 'data'), SOS_ADAPTER: FAKE, CZ_NO_WELCOME: '1' }, encoding: 'utf8', timeout: 30000 });
  const staleRecord = scheduleRuns().at(-1) || {};
  fs.writeFileSync(path.join(OUT, 'data', 'ledger', 'confirmed.json'), JSON.stringify({ pageId: page.page.id, confirmedAt: new Date().toISOString() }, null, 2));
  const confirmedRun = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'auto', '--trigger', 'schedule', '--slot', '2026-11-04'], { cwd: PROTO, env: { ...clean, SOS_DATA: path.join(OUT, 'data'), SOS_ADAPTER: FAKE, CZ_NO_WELCOME: '1' }, encoding: 'utf8', timeout: 30000 });
  const confirmedRecord = scheduleRuns().at(-1) || {};
  const restoredOn = await post({ action: 'schedule', op: 'on' });
  ok('新概覽未確認時排程跳過且未叫 AI，開啟回 409、停止仍可用；確認後舊用戶不再被概覽門檻攔住', pendingOn.status === 409 && pendingOff.status === 200 && staleRun.status === 0 && staleRecord.skipReason === 'overviewPending' && staleRecord.aiStarted === false && confirmedRun.status === 0 && confirmedRecord.skipReason !== 'overviewPending' && restoredOn.status === 200 && restoredOn.j?.ok === true, { pendingOn, pendingOff, staleRecord, confirmedRecord, restoredOn });
  await post({ action: 'schedule', op: 'off' });

  const opened = await post({ action: 'phone-open' });
  if (opened.status !== 200 || !(opened.j && opened.j.pairUrl)) console.log('未實測 手機配對 ' + opened.status);
  else {
    const pairUrl = opened.j && opened.j.pairUrl, pairBase = new URL(pairUrl).origin, secret = pairUrl.slice(pairUrl.indexOf('#') + 1);
    const paired = await fetch(pairBase + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
    const cm = /^(sos_pass_[a-f0-9]{32})=([a-f0-9]{64})/.exec(paired.headers.get('set-cookie') || '');
    const setup = await (await fetch(BASE + '/api/setup', { headers: { Cookie: passCookie(BASE) } })).json(), device = (setup.devices || []).find(x => x.kind === 'phone' && x.state === 'pending');
    await post({ action: 'phone-accept', id: device && device.id });
    const phoneHeaders = { Origin: pairBase, Cookie: cm && cm[1] + '=' + cm[2] };
    const phoneRhythm = await fetch(pairBase + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...phoneHeaders }, body: JSON.stringify({ action: 'rhythm', value: { runCadence: 'daily', runTime: '10:00', interviewWeekday: 1 } }) });
    const phoneSchedule = await fetch(pairBase + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...phoneHeaders }, body: JSON.stringify({ action: 'schedule', op: 'off' }) });
    ok('手機配對請求對兩個新動作都回 403', phoneRhythm.status === 403 && phoneSchedule.status === 403, { rhythm: phoneRhythm.status, schedule: phoneSchedule.status });
    await post({ action: 'phone-close' });
  }

  chrome = await openChrome(CHROME, path.join(OUT, 'chrome-profile'), Number(PORT) + 3000);
  await usePass(BASE, chrome);
  await chrome.go(BASE + '/dashboard/system', 390, 2200);
  await chrome.click('#rh-change');
  // 時間欄唔接受 insertText：按瀏覽器填好時間後嘅行為設值同發 input
  await chrome.ev(`(()=>{const e=document.querySelector('#rh-time');e.focus();e.value='15:00';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(6200);
  const editor = await chrome.ev(`({value:(document.querySelector('#rh-time')||{}).value,focus:document.activeElement===document.querySelector('#rh-time')})`);
  await chrome.click('#rh-save'); await sleep(1600);
  const panel = await chrome.ev(`(document.querySelector('#sys-rhythm')||{}).innerText||''`), width = await chrome.ev(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`);
  ok('Chrome：編輯器跨監察台重畫保留輸入及焦點，儲存後顯示新時間，390 闊無橫向捲動', editor.value === '15:00' && editor.focus && panel.includes('15:00') && width && !chrome.errors.length, { editor, width, errors: chrome.errors });
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  if (server) try { server.kill(); } catch { }
}
const passed = results.filter(x => x.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
