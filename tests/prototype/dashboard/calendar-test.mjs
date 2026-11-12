// 月曆與改日期：隔離資料、假 AI；同時覆蓋資料歸納、Founder 操作及 Chrome 流程。
// 用法：node calendar-test.mjs <Chrome> <輸出> <原型> <假AI> <埠>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass, passCookie } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, FAKE, PORT] = process.argv.slice(2);
process.env.TZ = 'Europe/London';
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT;
const results = [], ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' ' + JSON.stringify(info).slice(0, 500))); };
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SOS_/.test(key)));
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const add = (day, n) => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const stateFile = path.join(DATA, 'ledger', 'state.json'), opsFile = path.join(DATA, 'ledger', 'founder-ops.json');
const get = async pathName => (await fetch(BASE + pathName, { headers: { Cookie: passCookie(BASE) } })).json();
const post = async body => { const r = await fetch(BASE + '/api/founder-op', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: passCookie(BASE) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, json: j }; };
const waitFor = async (fn, ms = 12000) => { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return true; await sleep(150); } return false; };
let server = null, chrome = null;

try {
  // 重試用同一個輸出資料夾：夾具要由頭開始
  freshTestOut(DATA);
  process.env.SOS_DATA = DATA;
  const lib = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
  const feb28 = new Date(2028, 1, 1), feb29 = new Date(2028, 1, 29);
  const collapsed = lib.calendarRunDays([{ id: 'skip', trigger: 'schedule', slot: '2028-02-29', state: 'skipped', skipReason: 'pausedByFounder' }, { id: 'done', startedAt: '2028-02-29T10:00:00', state: 'ended' }, { id: 'bad', startedAt: '2028-02-29T11:00:00', state: 'ended', ending: 'blocked' }], feb28, feb29);
  ok('同日多筆 run 以未完成為最重', collapsed['2028-02-29']?.state === 'unfinished' && collapsed['2028-02-29']?.runId === 'bad', collapsed);
  const runDays = lib.calendarRunDays([{ id: 'today-running', trigger: 'schedule', slot: '2028-02-29', state: 'running' }, { id: 'past-running', trigger: 'schedule', slot: '2028-02-28', state: 'running' }], feb28, feb29, new Date(2028, 1, 29));
  ok('今日進行中標為工作中，過往進行中仍算未完成', runDays['2028-02-29']?.state === 'running' && runDays['2028-02-28']?.state === 'unfinished', runDays);
  const changed = lib.applyFounderOps({ milestones: [{ id: 'M1', targetDate: '2030-02-01', targetDateTentative: true }], tasks: [{ id: 'T1', owner: 'founder', dueAt: '2030-02-01T15:00' }] }, [{ id: 'x', op: 'setTarget', target: 'M1', value: { date: '2030-02-04' } }, { id: 'y', op: 'setTaskDue', target: 'T1', value: { date: '2030-02-05' } }]);
  ok('純函數：改目標日記基準、清暫定；改工作日保留時間', changed.targetOverrideBase.M1 === '2030-02-01' && !changed.milestones[0].targetDateTentative && changed.tasks[0].dueAt === '2030-02-05T15:00', changed);

  const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href); ask.dataDirs(PROTO);
  for (const dir of ['ledger', 'company', 'asks', 'founder/inbox', 'founder/replies', 'founder/desk', 'work', 'sandbox', 'archive']) fs.mkdirSync(path.join(DATA, dir), { recursive: true });
  write(path.join(DATA, 'ledger', 'state.json'), { company: { rhythm: { runCadence: 'daily', runTime: '15:00', interviewWeekday: 1 } }, intake: { state: 'complete' }, interviews: { nextOn: '2026-03-23' }, runs: [], tasks: [], milestones: [], events: [] });
  write(path.join(DATA, 'ledger', 'schedule.json'), { mode: 'server', approvedAt: '2026-03-01T10:00:00+00:00', autostart: { enabled: false } });
  const dst = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2026, 2, 29, 10, 0, 0), cert: { host: 'fake' } });
  const plannedVisits = dst.calendar.items.filter(item => item.kind === 'interview' && item.planned);
  ok('Europe/London 夏令時間：每日與每週推算不移位、不重複、月尾不漏，亦不補畫過去訪問', new Set(dst.calendar.plannedRunDays).size === dst.calendar.plannedRunDays.length && dst.calendar.plannedRunDays.includes('2026-03-29') && dst.calendar.plannedRunDays.includes('2026-03-31') && plannedVisits.every(item => item.date >= '2026-03-29') && new Set(plannedVisits.map(item => item.date)).size === plannedVisits.length, { runDays: dst.calendar.plannedRunDays.slice(0, 4), plannedVisits: plannedVisits.slice(0, 3) });
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '09:00', interviewWeekday: 1 } }, intake: { state: 'complete' }, interviews: { nextOn: '2026-03-30' }, runs: [], tasks: [], milestones: [], events: [] });
  write(path.join(DATA, 'ledger', 'schedule.json'), { mode: 'server', approvedAt: '2026-03-28T08:00:00+00:00' });
  const catchUp = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2026, 2, 29, 10, 0, 0), cert: { host: 'fake' } });
  ok('合資格的當日錯過時段會顯示補做，並只畫一次今日預計日', catchUp.rhythmInfo.catchUp === true && catchUp.calendar.plannedRunDays.filter(day => day === '2026-03-29').length === 1, catchUp.rhythmInfo);
  // 跨午夜：補做係尋日嘅時段，一樣要講
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }, intake: { state: 'complete' }, runs: [], tasks: [], milestones: [], events: [] });
  write(path.join(DATA, 'ledger', 'schedule.json'), { mode: 'server', approvedAt: '2026-05-01T08:00:00+00:00' });
  const overnight = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2026, 5, 11, 1, 0, 0), cert: { host: 'fake' } });
  ok('跨午夜補做同樣預告，並講明係尋日嘅時段', overnight.rhythmInfo.catchUp === true && overnight.rhythmInfo.catchUpAt.startsWith('2026-06-10T21:00'), overnight.rhythmInfo);
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }, intake: { state: 'complete' }, runs: [{ id: 'R-night', trigger: 'schedule', slot: '2026-06-10', startedAt: '2026-06-10T21:00:00', state: 'ended' }], tasks: [], milestones: [], events: [] });
  const overnightDone = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2026, 5, 11, 1, 0, 0), cert: { host: 'fake' } });
  ok('尋晚已開過工：跨午夜不再預告補做', overnightDone.rhythmInfo.catchUp === false && overnightDone.rhythmInfo.catchUpAt === '', overnightDone.rhythmInfo);
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }, intake: { state: 'complete' }, runs: [], tasks: [], milestones: [], events: [] });
  // 新公司概覽未確認：計時器唔會開工，唔可以預告補做
  const pendingPage = read(path.join(PROTO, 'fixtures', 'example-company-page.json'));
  write(path.join(DATA, 'company', 'page.json'), pendingPage);
  const pendingView = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2026, 5, 10, 22, 0, 0), cert: { host: 'fake' } });
  ok('未確認新概覽：不預告補做', pendingView.rhythmInfo.overviewPending === true && pendingView.rhythmInfo.catchUp === false && !pendingView.calendar.plannedRunDays.includes('2026-06-10'), pendingView.rhythmInfo);
  fs.rmSync(path.join(DATA, 'company', 'page.json'), { force: true });
  // 夏令時間：要跨過撥鐘日先捉到固定毫秒嘅舊缺陷
  write(stateFile, { company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }, intake: { state: 'complete' }, interviews: { nextOn: '2026-10-12' }, runs: [], tasks: [], milestones: [], events: [] });
  const autumn = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2026, 9, 20, 10, 0, 0), cert: { host: 'fake' } });
  const autumnVisits = autumn.calendar.items.filter(item => item.kind === 'interview' && item.planned).map(item => item.date);
  ok('撥慢一小時後，每週訪問仍在星期一', autumnVisits.includes('2026-10-26') && autumnVisits.includes('2026-11-02') && autumnVisits.every(day => new Date(day + 'T12:00:00').getDay() === 1), autumnVisits);
  ok('撥慢一小時後，逐日推算不重複', new Set(autumn.calendar.plannedRunDays).size === autumn.calendar.plannedRunDays.length, autumn.calendar.plannedRunDays.slice(0, 12));
  const spring = lib.dashboardState(ask.dataDirs(PROTO), { now: new Date(2027, 0, 20, 10, 0, 0), cert: { host: 'fake' } });
  ok('撥快一小時後，月尾不漏', spring.calendar.to === '2027-03-31' && spring.calendar.plannedRunDays.includes('2027-03-31'), { to: spring.calendar.to, last: spring.calendar.plannedRunDays.slice(-2) });
  fs.rmSync(path.join(DATA, 'ledger', 'schedule.json'), { force: true });
  const today = iso(new Date()), target = add(today, 8), due = add(today, 9);
  write(stateFile, { company: { name: '月曆測試', rhythm: { runCadence: 'daily', runTime: '15:00', interviewWeekday: 3 } }, intake: { state: 'complete', confirmedAt: new Date().toISOString() }, interviews: { nextOn: add(today, 2), lastOn: add(today, -5) }, milestones: [{ id: 'M1', short: '首個客戶', targetDate: target, pathStatus: 'confirmed', state: 'active', order: 1 }], tasks: [{ id: 'T1', title: '致電客戶', owner: 'founder', status: 'planned', dueAt: due + 'T15:00', milestoneId: 'M1' }], runs: Array.from({ length: 25 }, (_, i) => ({ id: 'R' + i, trigger: 'schedule', slot: add(today, -i - 1), startedAt: add(today, -i - 1) + 'T15:00:00', state: i === 24 ? 'skipped' : 'ended', ...(i === 24 ? { skipReason: 'alreadyRan' } : {}) })), events: [] });
  server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...clean, SOS_DATA: DATA, SOS_ADAPTER: FAKE, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  ok('隔離伺服器就緒', await waitFor(async () => { try { return (await fetch(BASE + '/api/health')).ok; } catch { return false; } }));
  await usePass(BASE);
  let dash = await get('/api/dashboard');
  ok('月曆帶視窗、200 筆歸納、所有事項都有去處', dash.calendar && dash.calendar.from < today && dash.calendar.to > today && dash.calendar.runDays[add(today, -25)] && dash.calendar.items.every(item => item.href), { calendar: dash.calendar });
  ok('未開啟排程不推算，舊記錄仍可見', dash.calendar.plannedRunDays.length === 0 && Object.keys(dash.calendar.runDays).length >= 20, dash.calendar);
  let state = read(stateFile); state.health = { pausedByFounder: true }; write(stateFile, state); dash = await get('/api/dashboard');
  ok('暫停時未來改標暫停、過去記錄保留', dash.calendar.paused && dash.calendar.pausedDays.length > 0 && Object.keys(dash.calendar.runDays).length >= 20, dash.calendar);
  state = read(stateFile); delete state.health; write(stateFile, state);
  const n0 = fs.existsSync(opsFile) ? read(opsFile).length : 0;
  const bad = [];
  for (const body of [{ op: 'setTarget', target: 'M1', value: { date: add(today, -1) } }, { op: 'setTarget', target: 'missing', value: { date: target } }, { op: 'setTaskDue', target: 'T1', value: { date: 'bad' } }, { op: 'setTaskDue', target: 'missing', value: { date: due } }, { op: 'setTaskDue', target: 'T1', value: { date: due, extra: true } }, { op: 'unknown', target: 'M1', value: { date: target } }]) bad.push(await post(body));
  ok('壞日期、過去、不存在、未知鍵均拒絕且不寫操作', bad.every(r => r.status === 400) && (fs.existsSync(opsFile) ? read(opsFile).length : 0) === n0, bad);
  const targetSet = await post({ op: 'setTarget', target: 'M1', value: { date: add(today, 12) } });
  const taskSet = await post({ op: 'setTaskDue', target: 'T1', value: { date: add(today, 13) } });
  dash = await get('/api/dashboard');
  ok('儲存後監察台在外殼合併前已顯示新日期', targetSet.status === 202 && taskSet.status === 202 && dash.milestones.find(m => m.id === 'M1').targetDate === add(today, 12) && dash.tasks.find(t => t.id === 'T1').dueAt === add(today, 13) + 'T15:00', { targetSet, taskSet });
  server.kill(); server = null;
  const merged = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...clean, SOS_DATA: DATA, SOS_ADAPTER: FAKE, CZ_NO_WELCOME: '1' }, encoding: 'utf8', timeout: 30000 });
  state = read(stateFile);
  ok('外殼合併後不丟失日期與時間', merged.status === 0 && state.milestones.find(m => m.id === 'M1').targetDate === add(today, 12) && state.tasks.find(t => t.id === 'T1').dueAt === add(today, 13) + 'T15:00', { status: merged.status, state });

  // 流暢度夾具：200 筆工作紀錄、每日兩項事項、已開啟自動開工
  state = read(stateFile);
  state.runs = Array.from({ length: 200 }, (_, i) => ({ id: 'R' + i, trigger: 'schedule', slot: add(today, -i - 1), startedAt: add(today, -i - 1) + 'T15:00:00', state: i % 9 === 0 ? 'skipped' : i % 7 === 0 ? 'failed' : 'ended', ...(i % 9 === 0 ? { skipReason: 'alreadyRan' } : {}), label: '日常工作', summary: '夾具工作 ' + i })).reverse();
  for (let i = 1; i <= 90; i++) for (const n of [1, 2]) state.tasks.push({ id: 'F' + i + '-' + n, title: '夾具事項 ' + i + '-' + n, owner: 'founder', status: 'planned', dueAt: add(today, i) + 'T10:00', milestoneId: 'M1' });
  state.company.nextExternalAction = { text: '約客戶見面', milestoneId: 'M1', date: add(today, 3) };
  write(stateFile, state);
  write(path.join(DATA, 'ledger', 'schedule.json'), { mode: 'server', cadence: 'daily', runTime: '15:00', interviewWeekday: 3, approvedAt: new Date().toISOString(), autostart: { enabled: false } });
  server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...clean, SOS_DATA: DATA, SOS_ADAPTER: FAKE, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await waitFor(async () => { try { return (await fetch(BASE + '/api/health')).ok; } catch { return false; } }); await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(OUT, 'chrome-profile-' + process.pid), Number(PORT) + 3000); await usePass(BASE, chrome);
  const SHOTS = path.join(OUT, 'shots');
  const openCalendar = async (width, base = BASE) => { await chrome.go(base + '/dashboard/path', width, 2200); if (!await chrome.ev(`!!document.querySelector('#calendar-view')`)) { await chrome.click('#schedule-panel .seg button:last-child'); await sleep(300); } };
  const heading = () => chrome.ev(`document.querySelector('#calendar-view .cal-top h3').textContent`);
  const navBtn = i => `document.querySelectorAll('#calendar-view .cal-top .r button')[${i}]`;
  const monthOf = day => { const [y, m] = day.split('-').map(Number); return y + ' 年 ' + m + ' 月'; };
  const goMonth = async day => { await chrome.ev(`${navBtn(1)}.click()`); await sleep(60); for (let i = 0; i < 4 && await heading() !== monthOf(day); i++) { await chrome.ev(`${navBtn(day.slice(0, 7) < iso(new Date()).slice(0, 7) ? 0 : 2)}.click()`); await sleep(60); } };
  const pickDay = async day => { await goMonth(day); await chrome.ev(`document.querySelectorAll('.cal-day:not(.other)')[${Number(day.slice(8)) - 1}].click()`); await sleep(60); };
  // 量程式要幾耐：做動作再強制排版。等畫面幀嘅時間由瀏覽器節流決定（無頭模式空等兩幀都可以幾百毫秒），唔計入，另外記低
  const paint = action => chrome.ev(`(()=>{const t=performance.now();${action};void document.documentElement.offsetHeight;return performance.now()-t;})()`);
  const idleFrames = () => chrome.ev(`new Promise(done=>{const t=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>done(performance.now()-t)));})`);
  const detail = () => chrome.ev(`(document.querySelector('#calendar-day')||{}).innerText||''`);
  const noOverflow = () => chrome.ev(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`);

  await openCalendar(1440);
  const plannedCell = await chrome.ev(`(()=>{const e=document.querySelector('.cal-mark.planned');return e?{font:getComputedStyle(e).fontSize,h:e.getBoundingClientRect().height}:null;})()`);
  ok('預計日只有小標記，不重複文字', plannedCell && plannedCell.font === '0px', plannedCell);
  // 視窗內每個月：每日都畫出一次，由一號連到月尾
  await chrome.ev(`${navBtn(1)}.click()`); await sleep(60);
  await chrome.ev(`${navBtn(0)}.click()`); await sleep(60);
  const months = [];
  for (let i = 0; i < 4; i++) {
    months.push(await chrome.ev(`(()=>{const h=document.querySelector('#calendar-view .cal-top h3').textContent,m=/(\\d+) 年 (\\d+) 月/.exec(h),n=new Date(+m[1],+m[2],0).getDate(),all=[...document.querySelectorAll('.cal-day:not(.other) .cal-num')].map(e=>+e.textContent),cells=document.querySelectorAll('.cal-day').length;return {h,n,count:all.length,ok:all.length===n&&all.every((d,i)=>d===i+1),rows:cells%7===0,first:(new Date(+m[1],+m[2]-1,1).getDay()+6)%7,firstCell:[...document.querySelectorAll('.cal-day')].findIndex(e=>!e.classList.contains('other'))};})()`));
    await chrome.ev(`${navBtn(2)}.click()`); await sleep(60);
  }
  ok('視窗內每個月由一號到月尾都畫出，星期一起對齊', months.length === 4 && months.every(m => m.ok && m.rows && m.first === m.firstCell), months);

  // 流暢度：200 筆紀錄、滿月事項下切換、切月、點日子
  await chrome.ev(`${navBtn(1)}.click()`); await sleep(60);
  const speed = [];
  for (let i = 0; i < 4; i++) { speed.push(await paint(`${navBtn(2)}.click()`)); speed.push(await paint(`${navBtn(0)}.click()`)); speed.push(await paint(`document.querySelectorAll('.cal-day:not(.other)')[${i + 3}].click()`)); }
  const viewSwitch = [await paint(`document.querySelector('#schedule-panel .seg button:first-child').click()`), await paint(`document.querySelector('#schedule-panel .seg button:last-child').click()`)];
  console.log('量度 空等兩幀（瀏覽器節流，只供參考）' + Math.round(await idleFrames()) + ' 毫秒');
  ok('流暢度：切月、點日子、切換視圖每次少於 200 毫秒', Math.max(...speed, ...viewSwitch) < 200, { max: Math.round(Math.max(...speed)), viewSwitch: viewSwitch.map(Math.round) });
  console.log('量度 切月與點日子最長 ' + Math.round(Math.max(...speed)) + ' 毫秒；切換視圖 ' + viewSwitch.map(Math.round).join('／') + ' 毫秒');

  // 定時重畫不丟失所選日子同捲動位置
  await pickDay(add(today, 3));
  const pressed = () => chrome.ev(`(document.querySelector('.cal-day[aria-pressed="true"] .cal-num')||{}).textContent`);
  const before = { day: await pressed(), month: await heading() };
  await chrome.ev(`window.scrollTo(0,320);window.__calNode=document.querySelector('#calendar-view')`); await sleep(100);
  const y0 = await chrome.ev('window.scrollY');
  await sleep(6500);
  const after = { day: await pressed(), month: await heading(), y: await chrome.ev('window.scrollY'), same: await chrome.ev(`window.__calNode===document.querySelector('#calendar-view')`) };
  ok('定時更新後所選日子、月份和捲動位置不變，月曆不閃動', after.day === before.day && after.month === before.month && Math.abs(after.y - y0) <= 2 && after.same, { before, after, y0 });
  await chrome.shot(path.join(SHOTS, 'calendar-1440.png'), '#schedule-panel');

  // 由當日清單改目標日：去、存、回到原本月份和日子
  const oldTarget = add(today, 12), newTarget = add(today, 16);
  await pickDay(oldTarget);
  const rowLink = href => `[...document.querySelectorAll('#calendar-day a.btn')].find(a=>a.getAttribute('href')===${JSON.stringify(href)})`;
  ok('當日清單的目標日有「改日期」', await chrome.ev(`(${rowLink('/#/change/target/M1')}||{}).textContent==='改日期'`), await detail());
  await chrome.ev(`${rowLink('/#/change/target/M1')}.click()`);
  const landed = await waitFor(() => chrome.ev(`!!document.querySelector('#change-date-page')`), 8000);
  await chrome.shot(path.join(SHOTS, 'change-date-1440.png'));
  await chrome.ev(`(()=>{const e=document.querySelector('#change-date');e.value=${JSON.stringify(newTarget)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const t0 = Date.now();
  await chrome.ev(`document.querySelector('#change-save').click()`);
  const back = await waitFor(() => chrome.ev(`!!document.querySelector('#calendar-view')`), 8000);
  const saveMs = Date.now() - t0;
  const backMonth = await heading(), backDay = await pressed();
  ok('改目標日：去到改日期頁，儲存後回到原本月份和日子', landed && back && backMonth === monthOf(oldTarget) && Number(backDay) === Number(oldTarget.slice(8)), { landed, back, backMonth, backDay, oldTarget });
  ok('流暢度：儲存到畫面更新少於 1.5 秒', saveMs < 1500, saveMs);
  console.log('量度 儲存到回到月曆 ' + saveMs + ' 毫秒');
  const oldGone = !/首個客戶/.test(await detail());
  await pickDay(newTarget);
  ok('改目標日：舊日子已沒有，新日子有', oldGone && /首個客戶/.test(await detail()), await detail());
  const pathText = await (async () => { const d = await get('/api/dashboard'); return d.milestones.find(m => m.id === 'M1').targetDate; })();
  ok('改目標日：業務路徑資料一致', pathText === newTarget, pathText);

  // 取消：回到原位，不改資料
  const taskDay = add(today, 1);
  await pickDay(taskDay);
  await chrome.ev(`${rowLink('/#/change/task/F1-1')}.click()`);
  await waitFor(() => chrome.ev(`!!document.querySelector('#change-date-page')`), 8000);
  await chrome.ev(`document.querySelector('#change-cancel').click()`);
  await waitFor(() => chrome.ev(`!!document.querySelector('#calendar-view')`), 8000);
  const cancelled = (await get('/api/dashboard')).tasks.find(t => t.id === 'F1-1').dueAt;
  ok('取消改日期：回到月曆，日期不變', cancelled === taskDay + 'T10:00' && Number(await pressed()) === Number(taskDay.slice(8)), { cancelled, pressed: await pressed() });

  // 瀏覽器上一頁：由改日期頁返回月曆
  await chrome.ev(`${rowLink('/#/change/task/F1-1')}.click()`);
  await waitFor(() => chrome.ev(`!!document.querySelector('#change-date-page')`), 8000);
  await chrome.ev('history.back()');
  ok('瀏覽器上一頁可由改日期頁回到月曆', await waitFor(() => chrome.ev(`!!document.querySelector('#calendar-view')`), 8000));

  // 找不到項目：有人話和返回
  await chrome.go(BASE + '/#/change/target/nothing', 1440, 1500);
  ok('改日期頁：項目不存在時有說明和返回', await waitFor(() => chrome.ev(`!!document.querySelector('#change-missing .btn')`), 6000));

  // 每個去處都真的到位
  // CrewZero 首頁要有公司概覽先會顯示，否則會轉去交資料
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); { const pg = read(path.join(PROTO, 'fixtures', 'example-company-page.json')); write(path.join(DATA, 'company', 'page.json'), pg); state = read(stateFile); state.ledgerFrom = pg.page.id; write(stateFile, state); write(path.join(DATA, 'ledger', 'confirmed.json'), { pageId: pg.page.id, confirmedAt: new Date().toISOString(), values: {}, order: [] }); }
  await chrome.go(BASE + '/#next-action', 1440, 2200);
  const nextAtTop = await chrome.ev(`(()=>{const e=document.querySelector('#next-action');if(!e)return {missing:true,hash:location.hash,app:document.querySelector('#app').innerText.slice(0,160)};const r=e.getBoundingClientRect();return {top:r.top,h:innerHeight,y:scrollY};})()`);
  ok('「改期或取消」落點：對外動作卡在畫面內', !nextAtTop.missing && nextAtTop.top > -5 && nextAtTop.top < nextAtTop.h, nextAtTop);
  await chrome.go(BASE + '/#quick-input', 1440, 800);
  await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('#quick-input');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=-5&&r.top<innerHeight;})()`), 6000);
  const quickAtTop = await chrome.ev(`(()=>{const e=document.querySelector('#quick-input');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=-5&&r.top<innerHeight;})()`);
  ok('「寫下新情況」落點：快速輸入在畫面內', quickAtTop);
  await chrome.go(BASE + '/dashboard/system?editRhythm=1#sys-rhythm', 1440, 2200);
  ok('「改時間」落點：系統頁編輯器已打開', await chrome.ev(`!!document.querySelector('#rh-editor')`));
  await chrome.go(BASE + '/dashboard/system?run=R25#sys-runs', 1440, 2200);
  ok('「看紀錄」落點：超出最近 20 筆的舊紀錄也看得到', await chrome.ev(`(document.querySelector('#sys-runs')||{}).innerText.includes('夾具工作 25')`), await chrome.ev(`(document.querySelector('#sys-runs')||{}).innerText.slice(0,200)`));
  await chrome.go(BASE + '/dashboard/path#M1', 1440, 2200);
  ok('「看業務路徑」落點：該站在畫面內', await chrome.ev(`(()=>{const e=document.getElementById('M1');if(!e)return false;const r=e.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;})()`));
  const items = (await get('/api/dashboard')).calendar.items;
  ok('所有事項都有文字按鈕和去處', items.length > 0 && items.every(item => item.href && item.action), items.filter(item => !item.href || !item.action).slice(0, 3));

  // 1024、390
  await openCalendar(1024); await pickDay(add(today, 3));
  ok('1024 闊：沒有橫向捲動', await noOverflow());
  await chrome.shot(path.join(SHOTS, 'calendar-1024.png'), '#schedule-panel');
  await openCalendar(390); await pickDay(add(today, 3));
  const mobile = await chrome.ev(`({width:document.documentElement.scrollWidth<=document.documentElement.clientWidth,cells:document.querySelectorAll('.cal-day').length,minH:Math.min(...[...document.querySelectorAll('.cal-day')].map(e=>e.getBoundingClientRect().height)),actions:[...document.querySelectorAll('#calendar-day a.btn')].every(a=>{const r=a.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})})`);
  ok('390 闊：無橫向溢出、格子夠大可按、當日按鈕完整', mobile.width && mobile.cells >= 28 && mobile.minH >= 44 && mobile.actions, mobile);
  await chrome.shot(path.join(SHOTS, 'calendar-390.png'), '#schedule-panel');
  await chrome.go(BASE + '/#/change/target/M1', 390, 1800);
  await waitFor(() => chrome.ev(`!!document.querySelector('#change-date-page')`), 6000);
  ok('390 闊：改日期頁無橫向溢出', await noOverflow());
  await chrome.shot(path.join(SHOTS, 'change-date-390.png'));
  ok('全程控制台沒有錯誤', !chrome.errors.length, chrome.errors);
  // 閏年：用模擬時鐘開到當時嘅月份
  if (chrome) { chrome.close(); chrome = null; }
  server.kill(); server = null; await sleep(400);
  for (const [clock, month, days] of [['2028-02-10T10:00:00', '2028 年 2 月', 29], ['2027-02-10T10:00:00', '2027 年 2 月', 28]]) {
    const simData = path.join(OUT, 'data-sim-' + days);
    fs.mkdirSync(path.join(simData, 'founder', 'desk'), { recursive: true }); fs.mkdirSync(path.join(simData, 'ledger'), { recursive: true });
    write(path.join(simData, 'founder', 'desk', 'sim-clock.json'), { offsetMs: Date.parse(clock) - Date.now(), at: new Date().toISOString() });
    write(path.join(simData, 'ledger', 'state.json'), { company: { name: '閏年', rhythm: { runCadence: 'daily', runTime: '15:00', interviewWeekday: 3 } }, intake: { state: 'complete' }, milestones: [], tasks: [], runs: [], events: [] });
    const simPort = String(Number(PORT) + days), simBase = 'http://127.0.0.1:' + simPort;
    server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', simPort], { cwd: PROTO, env: { ...clean, SOS_SIM: '1', SOS_DATA: simData, SOS_ADAPTER: FAKE, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
    await waitFor(async () => { try { return (await fetch(simBase + '/api/health')).ok; } catch { return false; } }); await usePass(simBase);
    chrome = await openChrome(CHROME, path.join(OUT, 'chrome-sim-' + days), Number(simPort) + 3000); await usePass(simBase, chrome);
    await openCalendar(1440, simBase);
    const seen = await chrome.ev(`({h:document.querySelector('#calendar-view .cal-top h3').textContent,n:document.querySelectorAll('.cal-day:not(.other)').length,cells:document.querySelectorAll('.cal-day').length})`);
    ok(month + '：畫出 ' + days + ' 日', seen.h === month && seen.n === days && seen.cells === (days === 29 ? 35 : 28), seen);
    chrome.close(); chrome = null; server.kill(); server = null; await sleep(400);
  }
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  if (server) try { server.kill(); } catch { }
}
const pass = results.filter(result => result.pass).length;
console.log(`\n${pass}/${results.length} passed`);
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
process.exit(pass === results.length ? 0 : 1);
