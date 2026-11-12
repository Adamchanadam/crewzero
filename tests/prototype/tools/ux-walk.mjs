// 流暢度實測：自動開工面板嘅真實操作，隔離資料夾、假 AI、假系統命令，唔開真 AI、唔碰真排程。
// 月曆同改日期嘅流暢度喺 dashboard/calendar-test.mjs；呢度走其餘：打字、處理中、失敗、外殼佔用、手機、伺服器中斷。
// 用法：node ux-walk.mjs <Chrome> <輸出> <原型> <假AI> <埠>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass, passCookie } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, FAKE, PORT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT, SHOTS = path.join(OUT, 'shots');
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k)));
const results = [], notes = [];
const ok = (name, pass, info = '') => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' ' + JSON.stringify(info).slice(0, 500))); };
const note = text => { notes.push(text); console.log('量度 ' + text); };
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const pad = n => String(n).padStart(2, '0');
const clockAt = mins => { const d = new Date(Date.now() + mins * 60000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await fn()) return true; } catch { } await sleep(120); } return false; };
const stateFile = path.join(DATA, 'ledger', 'state.json'), markFile = path.join(DATA, 'ledger', 'schedule.json'), lockFile = path.join(DATA, 'ledger', '.lock');
let server = null, chrome = null;

function seed(extra = {}) {
  const pg = read(path.join(PROTO, 'fixtures', 'example-company-page.json'));
  write(path.join(DATA, 'company', 'page.json'), pg);
  write(path.join(DATA, 'ledger', 'confirmed.json'), { pageId: pg.page.id, confirmedAt: new Date().toISOString(), values: {}, order: [] });
  write(stateFile, { schemaVersion: 1, ledgerFrom: pg.page.id, company: { name: '流暢度測試', rhythm: { runCadence: 'daily', runTime: clockAt(180), interviewWeekday: 1, runCapMinutes: 30, aiStartsPerDay: 40 } }, intake: { state: 'complete', confirmedAt: new Date().toISOString() }, interviews: { nextOn: '2099-01-05' }, milestones: [], tasks: [], runs: [{ id: 'R1', trigger: 'schedule', slot: '2026-01-01', startedAt: '2026-01-01T21:00:00', state: 'ended', ending: 'advanced', label: '日常工作' }], events: [], ...extra });
}
async function start(env = {}, port = PORT) {
  const s = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', port], { cwd: PROTO, env: { ...clean, SOS_DATA: DATA, SOS_ADAPTER: FAKE, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', SOS_SCHED_CMD: path.join(HERE, '..', 'lib', 'fake-schtasks.mjs'), SOS_SCHED_LOG: path.join(OUT, 'sched.log'), ...env }, stdio: 'ignore' });
  await waitFor(async () => (await fetch('http://127.0.0.1:' + port + '/api/health')).ok, 15000);
  return s;
}
async function stop() { if (server) { server.kill(); server = null; await sleep(500); } }
const panel = () => chrome.ev(`(document.querySelector('#sys-rhythm')||{}).innerText||''`);
const has = sel => chrome.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const clickNow = sel => chrome.ev(`(()=>{const b=document.querySelector(${JSON.stringify(sel)});const t=performance.now();b.click();return {ms:performance.now()-t,disabled:b.disabled,text:b.textContent};})()`);
const noOverflow = () => chrome.ev(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`);
const system = async (w = 1440, base = BASE) => { await chrome.go(base + '/dashboard/system', w, 1800); await waitFor(() => has('#sys-rhythm')); };

try {
  freshTestOut(DATA);
  for (const dir of ['ledger', 'company', 'asks', 'founder/inbox', 'founder/replies', 'founder/desk', 'archive', 'work', 'sandbox']) fs.mkdirSync(path.join(DATA, dir), { recursive: true });
  seed(); write(markFile, { mode: 'server', cadence: 'daily', runTime: clockAt(180), approvedAt: new Date().toISOString(), autostart: { enabled: false } });
  server = await start(); await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(OUT, 'chrome-' + process.pid), Number(PORT) + 3000); await usePass(BASE, chrome);

  /* 流程一：改時間，真鍵盤逐格打字 */
  await system();
  ok('已開啟但 AI 未設定：面板講明到時間也不會開工並提供設定連結', /AI 工具未設定：到時間也不會開工。/.test(await panel()) && await has('#sys-rhythm a[href="/#/setup"]'), await panel());
  await chrome.shot(path.join(SHOTS, 'panel-on-1440.png'), '#sys-rhythm');
  const openMs = (await clickNow('#rh-change')).ms; await sleep(100);
  ok('流程一：按「更改時間」即時打開編輯器', await has('#rh-editor') && openMs < 100, openMs);
  note('按更改時間 ' + Math.round(openMs) + ' 毫秒');
  await chrome.ev(`document.querySelector('#rh-time').focus()`);
  for (const key of ['1', '6', '3', '0']) { await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', text: key, key, unmodifiedText: key }); await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key }); await sleep(120); }
  const typed = await chrome.ev(`({value:document.querySelector('#rh-time').value,focus:document.activeElement.id,preview:document.querySelector('#rh-preview').textContent})`);
  ok('流程一：逐格打字時間欄不跳走，預覽同步', typed.focus === 'rh-time' && /16:30/.test(typed.value + typed.preview), typed);
  await sleep(6000);
  const kept = await chrome.ev(`({value:document.querySelector('#rh-time').value,focus:document.activeElement.id})`);
  ok('流程一：等過定時更新，輸入和焦點都在', kept.value === typed.value && kept.focus === 'rh-time', kept);
  await chrome.shot(path.join(SHOTS, 'panel-edit-1440.png'), '#sys-rhythm');

  /* 清空時間欄：唔可以儲存舊值 */
  await chrome.ev(`(()=>{const e=document.querySelector('#rh-time');e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const emptied = await chrome.ev(`({save:document.querySelector('#rh-save').disabled,preview:document.querySelector('#rh-preview').textContent})`);
  ok('清空時間：儲存鍵停用並提示', emptied.save && /請選擇/.test(emptied.preview), emptied);
  await chrome.ev(`(()=>{const e=document.querySelector('#rh-time');e.value='16:30';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);

  /* 流程二：改到剛過時段 */
  const past = clockAt(-60);
  await chrome.ev(`(()=>{const e=document.querySelector('#rh-time');e.value=${JSON.stringify(past)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const previewPast = await chrome.ev(`document.querySelector('#rh-preview').textContent`);
  ok('流程二：預覽講明已過、不會立刻開工', /已過/.test(previewPast) && /不會立刻開工/.test(previewPast), previewPast);
  const t0 = Date.now(); const saving = await clickNow('#rh-save');
  ok('流程二：按儲存 0.1 秒內有變化', saving.ms < 100 && saving.disabled, saving);
  const appeared = await waitFor(async () => (await panel()).includes(past) && await has('#rh-note'), 5000);
  const saveMs = Date.now() - t0;
  ok('流程二：1.5 秒內見到新時間和結果句', appeared && saveMs < 1500, { saveMs, panel: await panel() });
  note('儲存時間到畫面更新 ' + saveMs + ' 毫秒');
  await chrome.shot(path.join(SHOTS, 'panel-after-save-1440.png'), '#sys-rhythm');
  // 真的不開工由 rhythm/rhythm-edit-test.mjs 等過兩次定時檢查去驗，呢度唔重複等

  /* 流程三：外殼佔用時儲存，唔丟失 */
  fs.writeFileSync(lockFile, 'test');
  await system();
  await clickNow('#rh-change'); await sleep(100);
  const later = clockAt(240);
  await chrome.ev(`(()=>{const e=document.querySelector('#rh-time');e.value=${JSON.stringify(later)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickNow('#rh-save');
  const shown = await waitFor(async () => (await panel()).includes(later), 5000);
  const before = read(stateFile).company.rhythm.runTime;
  ok('流程三：另一個工作佔用時可儲存，畫面已顯示新時間', shown && before !== later, { before, later });
  fs.rmSync(lockFile, { force: true });
  const merged = await waitFor(() => read(stateFile).company.rhythm.runTime === later, 70000);
  ok('流程三：工作結束後新時間自動併入，沒有丟失', merged, read(stateFile).company.rhythm);

  /* 流程四：開關 */
  await system();
  const stopClick = await clickNow('#rh-stop');
  ok('流程四：按停止即時顯示處理中', stopClick.disabled && /處理中/.test(stopClick.text), stopClick);
  const t1 = Date.now();
  const stopped = await waitFor(async () => (await panel()).includes('未開啟'), 6000);
  ok('流程四：停止後 5 秒內變未開啟，標記已移除', stopped && Date.now() - t1 < 5000 && !fs.existsSync(markFile), { ms: Date.now() - t1 });
  note('停止自動開工 ' + (Date.now() - t1) + ' 毫秒');
  await chrome.shot(path.join(SHOTS, 'panel-off-1440.png'), '#sys-rhythm');
  await clickNow('#rh-on'); await sleep(150);
  ok('流程四：開啟前有確認，講明用量', /用量/.test(await panel()) && await has('#rh-on-ok'), await panel());
  await chrome.shot(path.join(SHOTS, 'panel-confirm-1440.png'), '#sys-rhythm');
  const t2 = Date.now(); await clickNow('#rh-on-ok');
  const started = await waitFor(async () => (await panel()).includes('已開啟'), 6000);
  ok('流程四：確認後 5 秒內變已開啟', started && Date.now() - t2 < 5000 && read(markFile)?.mode === 'server', { ms: Date.now() - t2 });
  note('開啟自動開工 ' + (Date.now() - t2) + ' 毫秒');

  /* 三個闊度 */
  await system(1024);
  ok('1024 闊：面板無橫向捲動', await noOverflow());
  await chrome.shot(path.join(SHOTS, 'panel-on-1024.png'), '#sys-rhythm');
  await system(390);
  await clickNow('#rh-change'); await sleep(150);
  ok('390 闊：編輯器無橫向捲動', await noOverflow());
  await chrome.shot(path.join(SHOTS, 'panel-edit-390.png'), '#sys-rhythm');

  /* 流程十一：伺服器中斷再恢復 */
  await system();
  await clickNow('#rh-change'); await sleep(100);
  await stop();
  const offSave = await clickNow('#rh-save');
  const offNote = await waitFor(() => has('#rh-note'), 8000);
  const offText = offNote ? await chrome.ev(`document.querySelector('#rh-note').textContent`) : '';
  ok('流程十一：伺服器停了按儲存，有說明，不假裝成功', offNote && !/已儲存/.test(offText), { offSave, offText });
  const reEnabled = await chrome.ev(`[...document.querySelectorAll('#sys-rhythm button')].every(b=>!b.disabled)`);
  ok('流程十一：失敗後按鈕恢復可按', reEnabled);
  await chrome.shot(path.join(SHOTS, 'panel-offline-1440.png'), '#sys-rhythm');
  server = await start();
  const back = await waitFor(() => chrome.ev(`fetch('/api/dashboard').then(r=>r.ok).catch(()=>false)`), 15000) && await waitFor(async () => /即時更新中/.test(await chrome.ev('document.body.innerText')), 20000);
  ok('流程十一：伺服器重開後頁面自動恢復，不用手動清理', back, await chrome.ev(`document.body.innerText.slice(0,200)`));

  /* 失敗路徑：舊式換新方式失敗 */
  await stop();
  write(markFile, { name: 'crewzero-old', os: 'windows', cadence: 'daily', runTime: '21:00' });
  server = await start({ SOS_SCHED_FAIL: '1' });
  await system();
  await chrome.shot(path.join(SHOTS, 'panel-legacy-1440.png'), '#sys-rhythm');
  if (await has('#rh-migrate')) {
    await clickNow('#rh-migrate');
    const failed = await waitFor(() => has('#rh-note'), 8000);
    const failText = failed ? await chrome.ev(`document.querySelector('#rh-note').textContent`) : '';
    ok('失敗路徑：系統命令失敗時講明，原設定保留', failed && failText.length > 0 && !/已換|已生效/.test(failText) && read(markFile)?.name === 'crewzero-old', { failText, mark: read(markFile) });
    ok('失敗路徑：失敗後可再按', await chrome.ev(`!document.querySelector('#rh-migrate').disabled`));
    await chrome.shot(path.join(SHOTS, 'panel-legacy-failed-1440.png'), '#sys-rhythm');
  } else ok('失敗路徑：舊式狀態有換新方式按鈕', false, await panel());
  await stop();
  fs.rmSync(markFile, { force: true });

  /* 流程十：手機配對只看不改，事先講明 */
  server = await start();
  await usePass(BASE);
  const post = async body => { const r = await fetch(BASE + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: passCookie(BASE) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, j }; };
  const opened = await post({ action: 'phone-open' });
  if (opened.status === 200 && opened.j?.pairUrl) {
    const pairUrl = opened.j.pairUrl, pairBase = new URL(pairUrl).origin, secret = pairUrl.slice(pairUrl.indexOf('#') + 1);
    const paired = await fetch(pairBase + '/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
    const cm = /^(sos_pass_[a-f0-9]{32})=([a-f0-9]{64})/.exec(paired.headers.get('set-cookie') || '');
    const setup = await (await fetch(BASE + '/api/setup', { headers: { Cookie: passCookie(BASE) } })).json(), device = (setup.devices || []).find(x => x.kind === 'phone' && x.state === 'pending');
    await post({ action: 'phone-accept', id: device && device.id });
    await chrome.send('Network.setCookie', { name: cm[1], value: cm[2], domain: new URL(pairBase).hostname, path: '/', httpOnly: true, sameSite: 'Strict' });
    await system(390, pairBase);
    const phone = await chrome.ev(`({text:(document.querySelector('#sys-rhythm')||{}).innerText||'',buttons:document.querySelectorAll('#sys-rhythm button').length})`);
    ok('流程十：手機只看不改，事先講明，沒有會報錯的按鈕', /只可在執行 CrewZero 的電腦/.test(phone.text) && phone.buttons === 0, phone);
    await chrome.shot(path.join(SHOTS, 'panel-phone-390.png'), '#sys-rhythm');
    await post({ action: 'phone-close' });
  } else { notes.push('手機配對：這部電腦開不到手機模式，未實測頁面（' + opened.status + '）'); console.log('未實測 手機頁面 ' + opened.status); }
  await stop();

  /* 未確認公司概覽：有去處 */
  write(stateFile, { schemaVersion: 1, runs: [], tasks: [], milestones: [], events: [] });
  fs.rmSync(path.join(DATA, 'ledger', 'confirmed.json'), { force: true });
  write(markFile, { mode: 'server', approvedAt: new Date().toISOString(), autostart: { enabled: false } });
  server = await start();
  await usePass(BASE); await usePass(BASE, chrome);
  await system();
  const fresh = await chrome.ev(`({text:(document.querySelector('#sys-rhythm')||{}).innerText||'',go:(document.querySelector('#rh-overview')||{}).getAttribute&&document.querySelector('#rh-overview').getAttribute('href'),stop:!!document.querySelector('#rh-stop')})`);
  ok('已開啟但未確認公司概覽：講明原因，有前往公司概覽和停止鍵', /已開啟/.test(fresh.text) && /確認公司概覽後/.test(fresh.text) && fresh.go === '/proofread.html' && fresh.stop, fresh);
  await chrome.shot(path.join(SHOTS, 'panel-new-1440.png'), '#sys-rhythm');
  // 冇節奏資料都要顯示已有排程狀態同合法入口
  await stop();
  write(markFile, { name: 'crewzero-old', os: 'windows', cadence: 'daily', runTime: '21:00' });
  server = await start(); await usePass(BASE); await usePass(BASE, chrome); await system();
  ok('未有節奏資料的舊式排程：先帶去公司概覽，沒有必定被拒的按鈕', await has('#rh-overview') && !await has('#rh-migrate'), await panel());
  await stop();
  write(markFile, { mode: 'stopped', autostart: { enabled: true, os: 'windows', name: 'crewzero-old' }, stoppedAt: new Date().toISOString() });
  server = await start(); await usePass(BASE); await usePass(BASE, chrome); await system();
  ok('未有節奏資料的待清理：仍有再次移除入口', await has('#rh-remove-again'), await panel());
  ok('全程控制台沒有錯誤', !chrome.errors.length, chrome.errors);
} catch (error) {
  ok('實測程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  await stop();
}
const pass = results.filter(r => r.pass).length;
write(path.join(OUT, 'ux-results.json'), { results, notes });
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
