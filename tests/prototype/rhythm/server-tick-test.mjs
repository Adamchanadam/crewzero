// 真實時鐘伺服器定時：每 30 秒檢查一次，用隔離 SOS_DATA 和假 AI，唔會花費。
// 用法：node server-tick-test.mjs <原型> <輸出> <埠> <假AI>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [PROTO, OUT, PORT, FAKE] = process.argv.slice(2);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const data = path.join(OUT, 'data'), ledger = path.join(data, 'ledger'), stateFile = path.join(ledger, 'state.json'), markFile = path.join(ledger, 'schedule.json');
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SOS_/.test(key)));
const openLog = path.join(OUT, 'opened.log');
const env = { ...clean, SOS_DATA: data, SOS_ADAPTER: FAKE, SOS_TEST_OPEN_LOG: openLog };
let server = null;
function runs() { return (read(stateFile) || {}).runs || []; }
function clockRunTime() {
  const d = new Date(Date.now() - 60000);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function state(extra = {}) {
  fs.mkdirSync(ledger, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ schemaVersion: 1, runs: [], company: { rhythm: { runCadence: 'daily', runTime: clockRunTime(), timezone: 'Europe/London', interviewWeekday: 1, runCapMinutes: 30, triggeredRunsPerHour: 6, aiStartsPerDay: 40 } }, ...extra }, null, 2));
}
async function waitFor(fn, timeout = 40000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return true; await sleep(350); }
  return false;
}
try {
  freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
  // 跨午夜時 slot 容易變成前一日；依規格等到 00:03 才繼續。
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() < 3) await sleep((3 - now.getMinutes()) * 60000);
  state();
  server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT), '--open', '--no-open'], { cwd: PROTO, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + PORT;
  const online = await waitFor(async () => { try { return (await fetch(base + '/api/health')).ok; } catch { return false; } }, 12000);
  ok('伺服器以 --no-open 啟動可用，沒有彈瀏覽器', online && !fs.existsSync(openLog), { online, opened: fs.existsSync(openLog) });
  const passOpen = await fetch(base + '/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk' }) });
  await sleep(200);
  ok('--no-open 只限本次開機，之後 API 開頁仍會生效', passOpen.ok && fs.existsSync(openLog), { status: passOpen.status, opened: fs.existsSync(openLog) });

  await sleep(32000);
  ok('沒有 server 授權標記時，到期也不開工', !runs().some(x => x.trigger === 'schedule'), runs());

  const serverMark = approvedAt => JSON.stringify({ mode: 'server', cadence: 'daily', runTime: clockRunTime(), timezone: 'Europe/London', interviewWeekday: 1, limitMinutes: 45, approvedAt, autostart: { enabled: false, os: 'windows', name: 'crewzero-test' } }, null, 2);
  fs.writeFileSync(markFile, serverMark(new Date().toISOString()));
  await sleep(32000);
  ok('排定時間之後先批准：唔會即刻開工', !runs().some(x => x.trigger === 'schedule'), runs());

  state(); fs.writeFileSync(markFile, serverMark(new Date(Date.now() - 10 * 60000).toISOString()));
  const first = await waitFor(() => runs().filter(x => x.trigger === 'schedule').length === 1);
  ok('有 server 授權且時間剛過：40 秒內只記一次排程 run', first, runs());
  await sleep(32000);
  ok('下一個 tick 不會重複開工', runs().filter(x => x.trigger === 'schedule').length === 1, runs());

  state(); fs.writeFileSync(markFile, JSON.stringify({ os: 'windows', name: 'crewzero-old', runTime: clockRunTime() }, null, 2));
  await sleep(32000);
  ok('舊格式標記不會觸發伺服器開工', !runs().some(x => x.trigger === 'schedule'), runs());

  state({ demo: true }); fs.writeFileSync(markFile, JSON.stringify({ mode: 'server', cadence: 'daily', runTime: clockRunTime(), timezone: 'Europe/London', interviewWeekday: 1, limitMinutes: 45, approvedAt: new Date().toISOString(), autostart: { enabled: false, os: 'windows', name: 'crewzero-test' } }, null, 2));
  await sleep(32000);
  ok('示範資料即使有標記也不會開工', !runs().some(x => x.trigger === 'schedule'), runs());

  fs.rmSync(markFile, { force: true });
  state({ intake: { confirmedAt: new Date().toISOString() }, ledgerFrom: 'test-ledger' });
  fs.writeFileSync(path.join(ledger, 'adapter-cert.json'), JSON.stringify({ host: 'test', argsHash: 'changed', version: 'changed' }, null, 2));
  const certRun = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'auto', '--trigger', 'schedule'], { cwd: PROTO, encoding: 'utf8', env });
  const changed = runs().at(-1) || {};
  const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href + '?tick=' + Date.now());
  const dirs = { data, ledger, company: path.join(data, 'company'), asks: path.join(data, 'asks'), inbox: path.join(data, 'founder', 'inbox'), replies: path.join(data, 'founder', 'replies'), archive: path.join(data, 'archive'), work: path.join(data, 'work'), sandbox: path.join(data, 'sandbox') };
  const view = dash.dashboardState(dirs, { now: new Date() });
  ok('AI 工具版本變更會跳過、記正確原因並顯示重新認證卡', certRun.status === 0 && changed.skipReason === 'adapterVersionChanged' && view.todo.some(x => x.id === 'schedule-recertify' && x.type === 'order' && x.href === '/dashboard/system'), { out: certRun.stdout + certRun.stderr, changed, todo: view.todo });
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  try { server && server.kill(); } catch { }
}
const passed = results.filter(x => x.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info).slice(0, 1200)));
console.log('\n' + passed + '/' + results.length + ' passed');
process.exit(passed === results.length ? 0 : 1);
