// 真伺服器、真 Chrome；所有資料與瀏覽器設定均在輸出資料夾隔離。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2), PORT = Number(PORT_ARG), BASE = `http://127.0.0.1:${PORT}`;
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(100); } return null; };
fs.mkdirSync(OUT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(OUT, 'celebration-')), DATA = path.join(RUN, 'data');
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER); seedCompany(DATA, PROTO);
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
write(path.join(DATA, 'ledger', 'confirmed.json'), { confirmedAt: new Date().toISOString() });
const state = path.join(DATA, 'ledger', 'state.json');
const base = { schemaVersion: 1, tasks: [], events: [], company: { name: '', initials: '', rhythm: { runCadence: 'weekly', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } }, interviews: { nextOn: '2099-01-05', applied: {} } };
let serial = 0;
const entry = (level = 3, grade = 'said', extra = {}) => ({ id: `cele-test-${++serial}`, level, kind: 'milestone', title: `測試事件${serial}`, also: [], grade, gradeName: '口頭表示', nextGradeName: '實際行動', stage: '測試站', nextStage: '', at: '2026-11-12T12:00:00', ...extra });
const seed = entries => write(state, { ...base, celebrations: { entries, kinds: {} } });
seed([]);
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
try {
  if (!await waitFor(async () => { try { return (await fetch(BASE + '/api/status')).status > 0; } catch { return false; } })) throw Error('伺服器未就緒');
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1); await usePass(BASE, chrome);
  const ev = s => chrome.ev(s), stage = () => ev("!!document.querySelector('#cz-cele-stage')"), card = () => ev("!!document.querySelector('#cz-cele-card')");
  const status = () => ev("fetch('/api/status').then(r=>r.json())");
  // 同一網址只改 hash 不會重新載入，所以要明確重載，才驗得到「重新打開」的行為
  const home = async (width = 1440, route = '#/') => { await chrome.go('about:blank', width, 50); await chrome.go(BASE + '/' + route, width, 500); await waitFor(() => ev("!!document.querySelector('#app')")); };
  const close = async () => { if (await card()) await ev("document.querySelector('#cz-cele-card button').click()"); };
  const skip = async key => { await ev(key ? "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))" : "document.dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await waitFor(card); };
  let a = entry(); seed([a]); await home(); ok('主頁播放一次', !!await waitFor(stage)); await sleep(2200); await chrome.shot(path.join(OUT, 'cele-3-mid.png')); await skip();
  const text = await ev("document.querySelector('#cz-cele-card').innerText"); ok('點擊跳過並顯示事件及詳情', text.includes(a.title) && text.includes('對方做到哪一步：') && text.includes('下一步：')); await chrome.shot(path.join(OUT, 'cele-card.png'));
  ok('已看紀錄不再回傳', !(await status()).celebrations.some(e => e.id === a.id)); await home(); await sleep(500); ok('未關閉的結果卡重新載入後仍在，動畫不重播', !await stage() && !!await waitFor(card)); await close(); await home(); await sleep(500); ok('關閉後重新載入不再出現', !await stage() && !await card());
  a = entry(); seed([a]); await home(); await waitFor(stage); await chrome.send('Page.reload'); await sleep(800); ok('動畫途中重新載入：不重播，仍留結果卡', !!await waitFor(card) && !await stage()); await close();
  a = entry(); seed([a]); await home(); await waitFor(stage); await skip(true); ok('Esc 跳過', await card() && !await stage()); await close();
  a = entry(); seed([a]); await home(); await waitFor(stage); await ev("window.dispatchEvent(new Event('scroll'))"); ok('捲動跳過', !!await waitFor(card) && !await stage()); await close();
  a = entry(); seed([a]); await home(); await waitFor(stage); ok('第 3 級自動完結', !!await waitFor(card, 7000) && !await stage()); await close();
  await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); a = entry(); seed([a]); await home(); ok('減少動態只顯示卡', !!await waitFor(card) && !await stage()); await close();
  await chrome.send('Emulation.setEmulatedMedia', { features: [] }); a = entry(); seed([a]); await home(390); ok('手機只顯示卡', !!await waitFor(card) && !await stage()); await sleep(600); await chrome.shot(path.join(OUT, 'cele-phone.png')); await close();
  a = entry(2); seed([a]); await home(); ok('第 2 級只顯示卡', !!await waitFor(card) && !await stage()); await close();
  a = entry(); seed([]); await home(); await ev("document.querySelector('#fx').click()"); seed([a]); await ev("fetch('/api/status').then(r=>r.json()).then(s=>SOS_CELEBRATE.handle(s,{allowed:()=>true,container:()=>document.querySelector('#app')}))"); ok('特效關閉只顯示卡', !!await waitFor(card) && !await stage()); await close(); await ev("document.querySelector('#fx').click()");
  a = entry(); seed([a]); await home(1440, '#/ask/missing'); await sleep(500); ok('答題頁不處理', !await stage() && (await status()).celebrations.some(e => e.id === a.id)); await ev("location.hash='#/'"); ok('返回主頁才播放', !!await waitFor(stage)); await skip(); await close();
  a = entry(); seed([a]); const claims = await ev(`Promise.all([1,2].map(()=>fetch('/api/celebrations/seen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:${JSON.stringify(a.id)}})}).then(r=>r.json())))`); ok('並行認領只有一次', claims.filter(x => x.claimed).length === 1, claims);
  const older = entry(2), newer = entry(3); seed([older, newer]); await home(); await waitFor(stage); await skip(); const combined = await ev("document.querySelector('#cz-cele-card').innerText"); ok('多筆只播最新及列出其他事件', combined.includes(newer.title) && combined.includes(older.title) && (await status()).celebrations.length === 0); await close();
  let points = []; for (const grade of ['said', 'paid']) { a = entry(3, grade); seed([a]); await home(); await waitFor(stage); await sleep(300); points.push(await ev("document.querySelector('#cz-cele-stage').style.getPropertyValue('--impact-x')")); await skip(); await close(); } ok('旗位置按對方做到哪一步變動', points[0] && points[1] && points[0] !== points[1], points);
  a = entry('top', 'said', { nextStage: '下一站測試' }); seed([a]); await home(); await waitFor(stage); await sleep(2800); await chrome.shot(path.join(OUT, 'cele-top-mid.png')); await skip(); const top = await ev("document.querySelector('#cz-cele-card').innerText"); ok('第一面旗詳情與結語', top.includes('下一站：下一站測試') && top.includes('Zero 陪你走到這裏了。下一步繼續。') && top.includes('11 月 12 日')); await sleep(500); await chrome.shot(path.join(OUT, 'cele-top-card.png')); ok('證據台階：目前一級及下一級正確', await ev("(()=>{const c=document.querySelector('#cz-cele-card');return c.querySelector('.cz-cele-step.now')?.textContent==='口頭表示'&&c.querySelector('.cz-cele-step.next')?.textContent==='實際行動'&&c.querySelectorAll('.cz-cele-step').length===5})()")); ok('結果卡的圖片載入成功', await waitFor(() => ev("(()=>{const i=document.querySelector('#cz-cele-card img');return !!i&&i.complete&&i.naturalWidth>0})()"))); await close();
  a = entry('top', 'stuck', { nextGradeName: '', nextStage: '' }); seed([a]); await home(); await waitFor(stage); await skip(); const stuck = await ev("document.querySelector('#cz-cele-card').innerText"); ok('stuck 沒有下一步', !stuck.includes('下一步：') && !stuck.includes('下一站：')); await close();
  await home(); ok('第一面旗意見提示', await waitFor(() => ev("document.querySelector('#feedback-prompt')?.dataset.prompt")) === 'firstFlag'); await ev("document.querySelector('#feedback-prompt button:last-child').click()"); await home(); ok('意見提示每裝置一次', await ev("!document.querySelector('[data-prompt=firstFlag]')"));
  a = entry(3); seed([a]); await chrome.go(BASE + '/dashboard', 1440, 500); ok('監察台播放', !!await waitFor(stage)); await skip(); await close(); await chrome.go(BASE + '/#/', 1440, 500); ok('已在監察台看過不重播', !await stage() && !await card());
  a = entry(3); seed([a]); await home(); await waitFor(stage); await skip(); await close(); await chrome.go(BASE + '/dashboard', 1440, 500); ok('首頁已看過監察台不重播', !await stage() && !await card());
  a = entry(2); seed([a]); await home(); await waitFor(card); const body = await ev("document.body.innerText"); ok('頁面文字沒有禁用詞和金額符號', !/勝利|贏|擊敗|經驗值|連擊|[$£€¥￥]/.test(body.replace(/\$crewzero:[a-z-]+/g, '')), body); /* Codex 指令寫法 $crewzero:discuss 不是金額 */
  // 舊伺服器不提供新檔案：讀不到慶祝程式時，頁面照常顯示、不播慶祝，也不可以當成斷線
  await chrome.send('Network.enable'); await chrome.send('Network.setBlockedURLs', { urls: ['*/celebration.js'] });
  a = entry(3); seed([a]); await home();
  ok('讀不到慶祝程式：首頁照常顯示，沒有慶祝', await ev('!window.SOS_CELEBRATE') && !!await waitFor(() => ev("!!document.querySelector('#quick-input')")) && !await stage() && !await card());
  await chrome.go(BASE + '/dashboard', 1440, 2500);
  ok('讀不到慶祝程式：監察台照常顯示，連線正常', await ev('!window.SOS_CELEBRATE') && !!await waitFor(() => ev("!!document.querySelector('#conn') && !document.querySelector('#conn').classList.contains('offline')"), 6000) && await sleep(3000) === undefined && await ev("!document.querySelector('#conn').classList.contains('offline')"), await ev("document.querySelector('#conn')?.outerHTML || document.body.innerText.slice(0, 300)"));
  await chrome.send('Network.setBlockedURLs', { urls: [] });
} catch (e) { ok('驗收中斷', false, String(e.stack || e)); }
ok('播放期間沒有程式錯誤', !!chrome && !chrome.errors.length, chrome?.errors);
chrome?.close(); server.kill();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + JSON.stringify(r.info ?? null)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
