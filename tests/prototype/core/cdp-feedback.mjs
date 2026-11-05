// 真實瀏覽器驗收「給意見」：真伺服器、真狀態資料、真 localStorage。
// 絕不打開表單或支持頁：只讀 href；模擬送出時先在 document 攔截點擊。
// node cdp-feedback.mjs <chrome> <輸出> <原型> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), results = [];
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), f = N.feedback;
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); return !!pass; };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
async function waitFor(fn, ms = 15000) { const until = Date.now() + ms; while (Date.now() < until) { const v = await fn(); if (v) return v; await sleep(150); } return null; }

fs.mkdirSync(OUT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(OUT, 'feedback-')), DATA = path.join(RUN, 'data'), BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
const COMPANY = read(path.join(DATA, 'company', 'page.json')).company;
const confirm = days => write(path.join(DATA, 'ledger', 'confirmed.json'), { confirmedAt: new Date(Date.now() - days * 86400000).toISOString() });
const state = extra => write(path.join(DATA, 'ledger', 'state.json'), { schemaVersion: 1, tasks: [], events: [], company: { name: '', initials: '', rhythm: { runCadence: 'weekly', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } }, interviews: { nextOn: '2099-01-05', applied: {} }, ...extra });
confirm(0); state({});
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
const prompt = () => chrome.ev(`document.querySelector('#feedback-prompt')?.getAttribute('data-prompt')||null`);
const homeReady = () => waitFor(() => chrome.ev(`!!document.querySelector('#open-feedback')`));
async function home(clear) {
  if (clear) await chrome.ev(`Object.keys(localStorage).filter(k=>k.startsWith('crewzero-feedback-')).forEach(k=>localStorage.removeItem(k))`);
  await chrome.send('Page.reload'); await sleep(1200);
  await homeReady(); await sleep(400);
}
try {
  await waitFor(async () => { try { return (await fetch(BASE + '/api/status')).status > 0; } catch { return false; } });
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  await chrome.go(BASE + '/#/', 1440);
  await homeReady(); await sleep(400);

  ok('意見表階段名稱與核准字樣一致', f.stages.join('|') === '尚未開始|已告訴 Zero|公司概覽已確認|示範資料', f.stages);
  ok('公司概覽確認後，待決事項頁顯示第一個提示', await waitFor(prompt) === 'overview', await chrome.ev(`document.body.innerText.slice(0,400)`));
  await chrome.shot(path.join(OUT, 'fb-prompt.png'), '#feedback-prompt');

  await chrome.ev(`document.querySelector('#tool-more').open=true`); await sleep(200);
  const support = await chrome.ev(`(()=>{const a=document.querySelector('#open-support');return a&&{href:a.href,target:a.target,rel:a.rel,text:a.textContent}})()`);
  ok('更多選單有給意見及支持連結，支持連結在新分頁打開且不帶來源', support?.href === f.support && support.target === '_blank' && /noopener/.test(support.rel) && /noreferrer/.test(support.rel), support);
  await chrome.shot(path.join(OUT, 'fb-menu.png'));
  await chrome.ev(`document.querySelector('#tool-more').open=false`);

  // 由提示卡打開；按「給意見」亦算處理過
  await chrome.ev(`[...document.querySelectorAll('#feedback-prompt button')].find(b=>b.textContent===${JSON.stringify(f.open)}).click()`);
  await waitFor(() => chrome.ev(`!!document.querySelector('#feedback-modal')`));
  await sleep(500);
  ok('未填內容不可送出，並說明要填甚麼', await chrome.ev(`(()=>{const a=document.querySelector('#feedback-send');return !a.hasAttribute('href')&&a.getAttribute('aria-disabled')==='true'})()`) && (await chrome.ev(`document.querySelector('#feedback-required').textContent`)) === f.required);
  await chrome.shot(path.join(OUT, 'fb-empty.png'));

  await chrome.ev(`[...document.querySelectorAll('#feedback-modal button')].find(b=>b.textContent===${JSON.stringify(f.ratings[0])}).click()`);
  await sleep(150);
  const href1 = await chrome.ev(`document.querySelector('#feedback-send').href`), u1 = new URL(href1);
  ok('揀評分後即可送出，參數及表單選項逐字正確', u1.origin + u1.pathname === f.response && u1.searchParams.get(f.fields.rating) === f.ratings[0] && u1.searchParams.get('submit') === 'Submit' && !u1.searchParams.has(f.fields.text) && !u1.searchParams.has(f.fields.quote) && !u1.searchParams.has(f.fields.email), href1);
  const usage = u1.searchParams.get(f.fields.usage) || '';
  ok('使用情況來自真實狀態：三段、顯示公司概覽已確認及正式版本號', /^階段：公司概覽已確認；版本：[0-9]+\.[0-9]+\.[0-9]+；工具：.+$/.test(usage), usage);
  const secrets = [COMPANY.name, COMPANY.oneLiner, DATA, RUN, 'proofread-chain'].filter(Boolean);
  ok('連結及預覽沒有公司名、生意描述、路徑或內部版本名稱', !secrets.some(s => decodeURIComponent(href1).includes(s)) && !secrets.some(s => usage.includes(s)), { usage, secrets });

  await chrome.type('#feedback-text', '等候時不知道要等多久 + 想看預計時間');
  await chrome.type('#feedback-email', 'founder@example.test');
  await chrome.ev(`document.querySelector('#feedback-quote').click()`);
  await sleep(150);
  const u2 = new URL(await chrome.ev(`document.querySelector('#feedback-send').href`)), preview = await chrome.ev(`document.querySelector('#feedback-preview').innerText`);
  ok('文字、電郵及引用正確放入連結，符號不會變形', u2.searchParams.get(f.fields.text) === '等候時不知道要等多久 + 想看預計時間' && u2.searchParams.get(f.fields.email) === 'founder@example.test' && u2.searchParams.get(f.fields.quote) === f.quoteYes, [...u2.searchParams]);
  ok('預覽列出連結內所有內容', [...u2.searchParams].filter(([k]) => k !== 'submit').every(([, v]) => preview.includes(v)), preview);
  await chrome.ev(`document.querySelector('#feedback-quote').click()`); await sleep(100);
  ok('取消勾選後引用改為不可以', new URL(await chrome.ev(`document.querySelector('#feedback-send').href`)).searchParams.get(f.fields.quote) === f.quoteNo);
  await chrome.shot(path.join(OUT, 'fb-filled.png'));

  await chrome.ev(`[...document.querySelectorAll('#feedback-modal button')].find(b=>b.textContent===${JSON.stringify(f.close)}).click()`); await sleep(150);
  // 手機闊度：對話框不可超出畫面，送出掣要碰得到
  await chrome.go(BASE + '/#/', 390); await homeReady(); await sleep(300);
  await chrome.ev(`window.SOS_DESK.feedbackDialog()`); await sleep(500);
  const phone = await chrome.ev(`(()=>{const m=document.querySelector('#feedback-modal'),c=m.querySelector('section'),r=c.getBoundingClientRect(),s=document.querySelector('#feedback-send');s.scrollIntoView({block:'center'});const b=s.getBoundingClientRect();return {left:r.left,right:r.right,vw:innerWidth,vh:innerHeight,top:b.top,bottom:b.bottom,overflow:getComputedStyle(m).overflowY,card:getComputedStyle(c).overflowY}})()`);
  ok('手機闊度：對話框在畫面內，送出掣可捲到', phone.left >= 0 && phone.right <= phone.vw && phone.top >= 0 && phone.bottom <= phone.vh, phone);
  await chrome.shot(path.join(OUT, 'fb-phone.png'));
  await chrome.ev(`document.querySelector('#feedback-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(150);
  ok('Escape 可以關閉對話框', await chrome.ev(`!document.querySelector('#feedback-modal')`));

  // 送出：攔截新分頁，只驗畫面轉為完成
  await chrome.go(BASE + '/#/', 1440); await homeReady(); await sleep(300);
  await chrome.ev(`document.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('#feedback-send'))e.preventDefault()},true)`);
  await chrome.ev(`window.SOS_DESK.feedbackDialog()`); await sleep(500);
  await chrome.ev(`[...document.querySelectorAll('#feedback-modal button')].find(b=>b.textContent===${JSON.stringify(f.ratings[1])}).click()`);
  await chrome.ev(`document.querySelector('#feedback-send').click()`); await sleep(200);
  ok('按送出後顯示已送出及關閉', (await chrome.ev(`document.querySelector('#feedback-modal').innerText`)).includes(f.sent));
  await chrome.shot(path.join(OUT, 'fb-sent.png'));
  await chrome.ev(`[...document.querySelectorAll('#feedback-modal button')].find(b=>b.textContent===${JSON.stringify(f.close)}).click()`); await sleep(150);
  ok('關閉後對話框消失', await chrome.ev(`!document.querySelector('#feedback-modal')`));

  // 提示只出現一次，重新載入仍然記得
  await home(false);
  ok('按過給意見的提示，重新載入後不再出現', (await prompt()) === null);
  await home(true);
  ok('清除紀錄後提示再出現', (await waitFor(prompt)) === 'overview');
  await chrome.ev(`[...document.querySelectorAll('#feedback-prompt button')].find(b=>b.textContent===${JSON.stringify(f.dismiss)}).click()`); await sleep(150);
  ok('按不用了後提示即時消失', (await prompt()) === null);
  await home(false);
  ok('按不用了後重新載入不再出現', (await prompt()) === null);

  // 滿兩星期：只顯示較新的提示，較舊的一併當處理過
  confirm(15); await home(true);
  ok('確認滿 14 天只顯示用了兩星期', (await waitFor(prompt)) === 'fortnight');
  ok('較舊的提示同時標記為已處理', (await chrome.ev(`localStorage.getItem('crewzero-feedback-overview')`)) === '1');

  // 重新確認概覽不會令兩星期重新計算
  write(path.join(DATA, 'ledger', 'confirmed.json'), { confirmedAt: new Date().toISOString(), firstConfirmedAt: new Date(Date.now() - 15 * 86400000).toISOString() });
  await home(true);
  ok('再次確認仍以首次確認時間計算', (await waitFor(prompt)) === 'fortnight');

  // 有要立即處理的問題：不搶注意力
  write(path.join(DATA, 'asks', 'ask-fb-urgent.json'), { id: 'ask-fb-urgent', title: '要立即決定', askedBy: 'AI', askedAt: new Date().toISOString(), questions: [{ id: 'x', ask: '現在要決定嗎？', kind: 'text', effect: 'now' }] });
  await home(true);
  ok('有 effect: now 問題時不顯示提示', (await prompt()) === null, await chrome.ev(`document.body.innerText.slice(0,300)`));
  fs.rmSync(path.join(DATA, 'asks', 'ask-fb-urgent.json'), { force: true });

  // 示範資料：不提示，但仍可主動給意見
  state({ demo: true });
  await home(true);
  ok('示範資料不顯示提示', (await prompt()) === null);
  ok('示範資料仍有給意見入口', await chrome.ev(`!!document.querySelector('#open-feedback')`));
  await chrome.ev(`window.SOS_DESK.feedbackDialog()`); await sleep(500);
  await chrome.ev(`[...document.querySelectorAll('#feedback-modal button')].find(b=>b.textContent===${JSON.stringify(f.ratings[0])}).click()`); await sleep(100);
  const demoUsage = new URL(await chrome.ev(`document.querySelector('#feedback-send').href`)).searchParams.get(f.fields.usage);
  ok('示範資料的階段如實寫示範資料', /^階段：示範資料；/.test(demoUsage), demoUsage);

  // 正式安裝的認證紀錄以工具代號記錄：要顯示工具名稱，不顯示代號或路徑。測試實例只認假工具，所以在頁面模擬正式狀態資料
  state({});
  await home(true);
  await chrome.ev(`(()=>{const f=window.fetch;window.fetch=(u,o)=>f(u,o).then(r=>String(u).includes('/api/status')?r.clone().json().then(j=>{j.cert={host:'claude',label:'Claude Code'};j.ai={...j.ai,ready:true};return new Response(JSON.stringify(j),{headers:{'Content-Type':'application/json'}})}):r)})()`);
  await chrome.ev(`window.SOS_DESK.feedbackDialog()`); await sleep(500);
  await chrome.ev(`[...document.querySelectorAll('#feedback-modal button')].find(b=>b.textContent===${JSON.stringify(f.ratings[0])}).click()`); await sleep(100);
  const realUsage = new URL(await chrome.ev(`document.querySelector('#feedback-send').href`)).searchParams.get(f.fields.usage);
  ok('已認證工具顯示名稱', realUsage.endsWith('工具：Claude Code'), realUsage);
  const mail = await chrome.ev(`(()=>{const s=getComputedStyle(document.querySelector('#feedback-email'));return {bg:s.backgroundColor,color:s.color}})()`);
  ok('電郵欄跟隨深色介面', !/255, 255, 255/.test(mail.bg) && !/239, 239, 239/.test(mail.bg), mail);

  // 營運監察台共用同一選單
  await chrome.go(BASE + '/dashboard', 1440); await waitFor(() => chrome.ev(`!!document.querySelector('#open-feedback')`));
  await chrome.ev(`document.querySelector('#open-feedback').click()`); await sleep(500);
  ok('營運監察台也可以打開給意見', await chrome.ev(`!!document.querySelector('#feedback-modal')&&!!document.querySelector('#feedback-preview')`));
  await chrome.shot(path.join(OUT, 'fb-dashboard.png'));
} catch (error) { ok('驗收中斷', false, String(error.stack || error)); }
ok('瀏覽器沒有程式錯誤', !!chrome && !chrome.errors.length, chrome?.errors);
chrome?.close();
server.kill();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + JSON.stringify(r.info ?? null)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
