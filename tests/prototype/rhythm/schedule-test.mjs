// 排程一按批准測試（MVP 規格 2026-10-29 第 2 節第 3 項）：用假登記程式（SOS_SCHED_CMD，只記錄參數），唔郁電腦上任何排程。
// 核對：印定義唔登記；登記參數含登記名、每日時間、啟動檔絕對路徑、錯過即補跑同執行時限；兩個安裝唔撞名；標記欄位；
// 系統頁三態（未登記／已登記／節奏已改須重新登記）各出現一次，節奏改咗待決事項有「重新登記排程」提示卡；移除後標記消失、頁面返去未登記；
// 直接執行排程啟動檔一次（等同排程器會跑嘅命令）有排程紀錄；同一日已做過排程工作，補跑唔再開 AI。
// 用法：node schedule-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { usePass, installPass } from '../lib/testkit.mjs';
let unpair = () => { };
const [CHROME, OUT, PROTO, FAKE, PORT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), U = N.ui;
const { openChrome } = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'cdp-lib.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const LOG = path.join(OUT, 'sched-calls.jsonl');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k))), SOS_SCHED_CMD: path.join(HERE, '..', 'lib', 'fake-schtasks.mjs'), SOS_SCHED_LOG: LOG, SOS_ADAPTER: FAKE, SOS_NO_OPEN: '1' };
const calls = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const install = dir => { fs.mkdirSync(dir, { recursive: true }); return spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), dir], { encoding: 'utf8', env }); };
let srv = null, c = null;
try {
  const PROJ = path.join(OUT, 'proj'), T = path.join(PROJ, 'crewzero'), S = path.join(T, 'adapters', 'scheduler', 'install-schedule.mjs');
  ok('先安裝（全新空資料夾）', install(PROJ).status === 0);
  const sched = (...a) => spawnSync(process.execPath, [S, ...a], { encoding: 'utf8', env, cwd: T });
  const MARK = path.join(T, 'data', 'ledger', 'schedule.json'), CMD = path.join(T, 'run-schedule.cmd');

  /* 印定義：唔登記 */
  const p0 = sched();
  const name = (p0.stderr.match(/crewzero-[0-9a-f]{8}/) || [])[0];
  ok('印定義：創辦人輸出只說明未登記、每日時間與補跑；登記名、啟動檔和命令全文只在技術細節；冇叫排程器、冇標記', p0.status === 0 && /未登記/.test(p0.stdout) && /每日 21:00/.test(p0.stdout) && !!name && p0.stderr.includes(CMD) && /-StartWhenAvailable/.test(p0.stderr) && !p0.stdout.includes(name) && !p0.stdout.includes(CMD) && !calls().length && !fs.existsSync(MARK), { out: p0.stdout, err: p0.stderr });
  const mac = spawnSync(process.execPath, [S, '--os', 'mac'], { encoding: 'utf8', env });
  ok('非 Windows：創辦人只見不支援說明，原有 launchd 定義只在技術細節', mac.status === 0 && /目前只支援在 Windows/.test(mac.stdout) && !/launchd|Label|執行環境/.test(mac.stdout) && /macOS launchd/.test(mac.stderr) && /Label/.test(mac.stderr) && /執行環境/.test(mac.stderr), { out: mac.stdout, err: mac.stderr });
  const P2 = path.join(OUT, 'proj2'); install(P2);
  const n2 = (spawnSync(process.execPath, [path.join(P2, 'crewzero', 'adapters', 'scheduler', 'install-schedule.mjs')], { encoding: 'utf8', env }).stderr.match(/crewzero-[0-9a-f]{8}/) || [])[0];
  ok('登記名含安裝資料夾識別：兩個安裝唔撞名', name && n2 && name !== n2, { name, n2 });
  // 改名前登記嘅排程叫 startup-os-<識別>：安裝資料夾仲叫 startup-os/（舊版原位更新），或者登記標記寫住舊名，就沿用舊名（排程狀態、移除、重新登記都對準同一個）
  const P3 = path.join(OUT, 'proj3'); install(P3); fs.renameSync(path.join(P3, 'crewzero'), path.join(P3, 'startup-os'));
  const n3 = spawnSync(process.execPath, [path.join(P3, 'startup-os', 'adapters', 'scheduler', 'install-schedule.mjs')], { encoding: 'utf8', env }).stderr;
  ok('舊版 startup-os/ 安裝：登記名沿用 startup-os-<識別>', /startup-os-[0-9a-f]{8}/.test(n3) && !/crewzero-[0-9a-f]{8}/.test(n3), n3.slice(0, 300));
  const P4 = path.join(OUT, 'proj4'); install(P4); const S4 = path.join(P4, 'crewzero', 'adapters', 'scheduler', 'install-schedule.mjs');
  const n4 = (spawnSync(process.execPath, [S4], { encoding: 'utf8', env }).stderr.match(/crewzero-([0-9a-f]{8})/) || [])[1];
  fs.mkdirSync(path.join(P4, 'crewzero', 'data', 'ledger'), { recursive: true }); fs.writeFileSync(path.join(P4, 'crewzero', 'data', 'ledger', 'schedule.json'), JSON.stringify({ name: 'startup-os-' + n4 }));
  const st4 = spawnSync(process.execPath, [S4, '--status'], { encoding: 'utf8', env: { ...env, SOS_SCHED_LOG: path.join(OUT, 'sched-calls-p4.jsonl') } }).stdout, jt4 = (() => { try { return JSON.parse(st4.split(/\r?\n/)[0]); } catch { return {}; } })();
  ok('登記標記寫住舊名：排程狀態用返舊名 startup-os-<識別>', !!n4 && jt4.name === 'startup-os-' + n4, st4.slice(0, 300));

  /* 伺服器（新安裝自己嘅 data/）：未登記 */
  srv = spawn(process.execPath, [path.join(T, 'server.mjs'), '--port', String(PORT)], { cwd: T, env, stdio: 'ignore' });
  const B = `http://127.0.0.1:${PORT}`;
  // 正實例（安裝好嘅副本用自己嘅 data/）冇測試鉤：測試自己扮已配對瀏覽器（寫雜湊入用戶設定資料夾，完畢即刪）
  unpair = await installPass(lib.rootId(path.join(T, 'data')), B, path.join(T, 'data'));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch { } await sleep(250); }
  c = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
  await usePass(B, c);
  const sys = async () => { await c.go(B + '/dashboard/system', 1440, 2600); return c.ev(`(()=>{const d=document.querySelector('#sys-sched');return d?{state:d.dataset.state,text:d.innerText,next:(document.querySelector('#sys-next')||{}).innerText||'',last:(document.querySelector('#sys-last')||{}).innerText||''}:null})()`); };
  const s0 = await sys();
  ok('系統頁（公司概覽未確認都顯示排程）：未登記，下一步「在對話輸入『安裝排程』」', s0 && s0.state === 'none' && s0.text === U.schedOff && /安裝排程/.test(s0.text), s0);
  const obsN = await c.ev(`(document.body.innerText.match(new RegExp(${JSON.stringify(N.dash.observeNoFolders)},'g'))||[]).length`);
  ok('系統頁：「未登記觀察資料夾」只出現一次（之前重複兩行）', obsN === 1, obsN);
  await c.shot(path.join(OUT, 'sys-none.png'));

  /* 登記（假登記程式） */
  const r1 = sched('--register');
  const reg = calls().map(a => a[a.length - 1]).find(s => /Register-ScheduledTask/.test(s) && !/Unregister/.test(s)) || '';
  ok('登記：成功並讀回下次執行時間同補跑設定；技術命令不在創辦人輸出', r1.status === 0 && /每日排程已登記/.test(r1.stdout) && /盡快補做/.test(r1.stdout) && r1.stderr.includes(name) && r1.stderr.includes(CMD) && !r1.stdout.includes(name) && !r1.stdout.includes(CMD) && !r1.stdout.includes('程式檔'), r1.stdout + r1.stderr);
  ok('登記參數：登記名、每日 21:00、啟動檔絕對路徑、錯過即補跑、執行時限（節奏上限加 15 分鐘）、唔准重疊；用完整排程介面（PowerShell）', reg.includes(`-TaskName '${name}'`) && /-Daily -At '21:00'/.test(reg) && reg.includes(`-Execute '${CMD}'`) && /-StartWhenAvailable/.test(reg) && /New-TimeSpan -Minutes 45/.test(reg) && /-MultipleInstances IgnoreNew/.test(reg) && calls()[0][0] === 'powershell.exe', reg.slice(0, 500));
  const m = readJ(MARK);
  ok('標記 ledger/schedule.json：登記名、節奏、登記時間、下次執行、命令全文、補跑', m && m.name === name && m.cadence === 'daily' && m.runTime === '21:00' && m.registeredAt && m.nextRunAt && m.startWhenAvailable === true && m.command.includes(CMD) && m.command.includes('Register-ScheduledTask'), m);
  const st1 = sched('--status'), j1 = (() => { try { return JSON.parse(st1.stdout.split(/\r?\n/)[0]); } catch { return null; } })();
  ok('讀回（--status）：已登記、下次執行、補跑開啟', j1 && j1.registered && j1.next && j1.startWhenAvailable && j1.name === name, st1.stdout);
  const s1 = await sys();
  ok('系統頁：已登記 · 每日 21:00，寫明錯過即補跑，有下次開工時間', s1 && s1.state === 'on' && s1.text.includes(N.t('schedOs', { c: U.cad_daily, t: '21:00' })) && s1.text.includes(U.schedCatchUpOn) && /21:00/.test(s1.next), s1);
  await c.shot(path.join(OUT, 'sys-on.png'));

  /* 節奏改咗：須重新登記 + 待決事項提示卡 */
  const SF = path.join(T, 'data', 'ledger', 'state.json');
  fs.writeFileSync(SF, JSON.stringify({ schemaVersion: 1, tasks: [], events: [], runs: [], company: { rhythm: { runCadence: 'daily', runTime: '08:00', timezone: 'Europe/London', interviewWeekday: 1, runCapMinutes: 30, triggeredRunsPerHour: 6, aiStartsPerDay: 40 } } }, null, 2));
  const s2 = await sys();
  ok('系統頁：節奏已改須重新登記（登記時 21:00、現時 08:00，講明在對話輸入「重新登記排程」）；下次開工照實際登記嘅 21:00', s2 && s2.state === 'stale' && s2.text.includes('重新登記排程') && /21:00/.test(s2.next) && !/08:00/.test(s2.next), s2);
  await c.shot(path.join(OUT, 'sys-stale.png'));
  const todo = (await (await fetch(B + '/api/asks')).json()).todo || [];
  const card = todo.find(t => t.id === 'schedule-stale');
  ok('待決事項有「重新登記排程」提示卡，入口去系統頁', card && card.kind === 'schedule' && card.href === '/dashboard/system' && card.text === N.t('schedStaleTodo', { t: '08:00' }), todo);
  // 未交資料時 Founder Desk 首頁係交資料頁；同一份待決清單喺公司現況「待你處理」見到（真實情況係交資料之後先會改節奏）
  await c.go(B + '/dashboard', 1440, 4000);
  const row = await c.ev(`(()=>{const p=document.querySelector('#needs')||document.body;const a=[...p.querySelectorAll('a')].find(x=>x.getAttribute('href')==='/dashboard/system'&&x.innerText.includes(${JSON.stringify(U.schedGoSystem)}));return a?{href:a.getAttribute('href'),text:p.innerText}:null})()`);
  ok('公司現況「待你處理」見到提示卡，掣去系統頁', row && row.text.includes('重新登記排程'), row || await c.ev(`(document.querySelector('#needs')||{}).innerText||''`));
  await c.shot(path.join(OUT, 'overview-stale-card.png'));

  /* 移除 */
  const r3 = sched('--remove');
  ok('移除：成功、叫排程器刪除同一個登記名、標記消失', r3.status === 0 && fs.existsSync(MARK) === false && calls().some(a => /Unregister-ScheduledTask -TaskName '/.test(a[a.length - 1]) && a[a.length - 1].includes(name)), r3.stdout);
  const s3 = await sys();
  ok('移除後系統頁返去未登記', s3 && s3.state === 'none', s3);
  ok('移除後提示卡消失', !((await (await fetch(B + '/api/asks')).json()).todo || []).some(t => t.id === 'schedule-stale'));
  srv.kill(); srv = null; await sleep(500);

  /* 直接執行排程啟動檔一次：有一筆排程紀錄（未交資料，所以照規則跳過） */
  fs.writeFileSync(SF, JSON.stringify({ schemaVersion: 1, tasks: [], events: [], runs: [] }, null, 2));
  const run1 = process.platform === 'win32' ? spawnSync('cmd.exe', ['/d', '/c', CMD], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k))), timeout: 60000 }) : { status: 0 };
  const runs1 = (readJ(SF) || {}).runs || [];
  const today = runs1.length ? runs1[runs1.length - 1].slot : '';
  ok('直接執行排程啟動檔（等同排程器嘅命令，唔靠環境變數）：帳本有一筆排程紀錄，未交資料照規則跳過、冇開 AI', run1.status === 0 && runs1.length === 1 && runs1[0].trigger === 'schedule' && runs1[0].state === 'skipped' && runs1[0].skipReason === 'intakeNotComplete' && runs1[0].aiStarted === false, { status: run1.status, out: run1.stdout, runs1 });

  /* 同一日已做過排程工作：補跑唔再開 AI */
  const s4 = readJ(SF); s4.runs.push({ id: 'R-earlier', type: 'rhythm', trigger: 'schedule', slot: today, startedAt: new Date().toISOString(), state: 'ended', aiStarted: true, ending: 'artifact' }); fs.writeFileSync(SF, JSON.stringify(s4, null, 2));
  spawnSync(process.execPath, [path.join(T, 'run.mjs'), '--type', 'auto', '--trigger', 'schedule'], { cwd: T, encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k))) });
  const last = ((readJ(SF) || {}).runs || []).slice(-1)[0] || {};
  ok('同一日已有排程工作做完：補跑記錄為跳過（今日已做過），唔再開 AI', last.trigger === 'schedule' && last.state === 'skipped' && last.skipReason === 'alreadyRan' && last.aiStarted === false && /已經做過/.test(last.summary || ''), last);
  ok('頁面冇程式錯誤', !(c.errors || []).length, c.errors);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  unpair();
  try { c && c.close(); } catch { } try { srv && srv.kill(); } catch { }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
