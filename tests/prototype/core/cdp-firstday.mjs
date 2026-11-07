// 第一日體驗：真伺服器及 Chrome，資料與瀏覽器設定均放在獨立資料夾。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const PORT = Number(PORT_ARG), BASE = `http://127.0.0.1:${PORT}`, results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info: pass ? undefined : info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
async function waitFor(fn, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200); } return null; }
fs.mkdirSync(OUT, { recursive: true });
const RUN = fs.mkdtempSync(path.join(OUT, 'firstday-')), DATA = path.join(RUN, 'data');
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
const statusFile = path.join(DATA, 'ledger', 'status.json');
const startedAt = new Date(Date.now() - 75000).toISOString();
const run = state => ({ runs: [{ id: 'R-firstday', ref: 'firstday', kind: 'intake', state, startedAt, steps: [] }] });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
try {
  if (!await waitFor(async () => { try { return (await fetch(BASE + '/api/status')).status > 0; } catch { return false; } })) throw new Error('server did not start');
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  const ev = expression => chrome.ev(expression);
  const go = async (url, width = 1440) => { await chrome.go(BASE + url, width); await waitFor(() => ev(`!!document.querySelector('#first-steps, .desk-nav')`)); await sleep(500); };
  const shot = name => chrome.shot(path.join(OUT, name));
  await go('/#/intake');
  // 升級前未送出的草稿：按舊題意帶入新題，舊紀錄保留
  await ev(`localStorage.removeItem('startup-os-intake-draft-v2');localStorage.setItem('startup-os-intake-draft',JSON.stringify({q1:'舊第一題',q2:'舊收費',q3:'舊進展',q5:'舊協助',q11:'舊擔心'}))`);
  await chrome.send('Page.reload'); await sleep(900); await waitFor(() => ev(`!!document.querySelector('#q1')`));
  const oldDraft = await ev(`({q1:document.querySelector('#q1')?.value,q4:document.querySelector('#q4')?.value,q5:document.querySelector('#q5')?.value,q7:document.querySelector('#q7')?.value,q8:document.querySelector('#q8')?.value,old:!!localStorage.getItem('startup-os-intake-draft-backup'),gone:!localStorage.getItem('startup-os-intake-draft')})`);
  ok('舊草稿按題意帶入新題，舊紀錄保留', oldDraft.q1 === '舊第一題' && oldDraft.q4 === '舊收費' && oldDraft.q5 === '舊進展' && oldDraft.q7 === '舊協助' && oldDraft.q8 === '舊擔心' && oldDraft.old && oldDraft.gone, oldDraft);
  // 送出或清除後，舊草稿不可再回來
  await ev(`localStorage.removeItem('startup-os-intake-draft-v2')`);
  await chrome.send('Page.reload'); await sleep(900); await waitFor(() => ev(`!!document.querySelector('#q1')`));
  ok('清除後舊草稿不會再出現', (await ev(`document.querySelector('#q1').value`)) === '');
  // 由舊預填而來的答案不帶入，否則伺服器會拒收又沒有確認按鈕
  await ev(`localStorage.removeItem('startup-os-intake-draft-v2');localStorage.setItem('startup-os-intake-draft',JSON.stringify({q1:'舊預填句',q2:'我自己寫的收費',_prefill:{id:'x',st:{q1:{s:'pending'}}}}))`);
  await chrome.send('Page.reload'); await sleep(900); await waitFor(() => ev(`!!document.querySelector('#q1')`));
  const oldPf = await ev(`({q1:document.querySelector('#q1').value,q4:document.querySelector('#q4').value})`);
  ok('舊預填的答案不帶入，自己寫的照帶入', oldPf.q1 === '' && oldPf.q4 === '我自己寫的收費', oldPf);
  await ev(`localStorage.removeItem('startup-os-intake-draft-v2');localStorage.removeItem('startup-os-intake-draft-backup')`);
  await chrome.send('Page.reload'); await sleep(900); await go('/#/intake');
  const fresh = await ev(`(()=>{const s=document.querySelector('#first-steps');return {metrics:document.querySelectorAll('.metric').length,nav:!!document.querySelector('.desk-nav'),steps:[...s.children].filter(x=>x.getAttribute('aria-hidden')!=='true').map(x=>x.textContent),current:s.querySelector('[aria-current=step]')?.textContent,href:s.querySelector('[aria-current=step]')?.getAttribute('href'),start:s.lastElementChild.tagName,help:!!document.querySelector('#open-help'),system:!!document.querySelector('#tool-more a[href="/dashboard/system"]')}})()`);
  ok('全新：三步、目前告訴 Zero、系統和求助入口', fresh.metrics === 0 && !fresh.nav && fresh.steps.join('|') === '告訴 Zero|校對|開工' && fresh.current === '告訴 Zero' && fresh.href === '/#/intake' && fresh.start === 'SPAN' && fresh.help && fresh.system, fresh);
  const intakeLabels = await ev(`({ breadcrumb:document.querySelector('#desk-head .eyebrow')?.textContent, eyebrow:document.querySelector('#intake-form .eyebrow')?.textContent, title:document.querySelector('#intake-form .layer-title')?.textContent })`);
  ok('第一步、麵包屑和表格標題一致', fresh.current === N.ui.intake && intakeLabels.breadcrumb?.endsWith(N.ui.intake) && intakeLabels.eyebrow === N.ui.intake && intakeLabels.title === N.ui.intake, intakeLabels);
  await ev(`document.querySelector('#open-help').click()`);
  ok('需要幫助可打開', await ev(`!!document.querySelector('[role=dialog]')`));
  await go('/#/intake'); await shot('fd-new.png');
  await go('/dashboard');
  ok('監察台第一天的進度回到 CrewZero', await ev(`document.querySelector('#first-steps [aria-current=step]')?.getAttribute('href')===' /#/intake'.trim() && !document.querySelector('.desk-nav')`));

  write(statusFile, run('running'));
  await go('/#/intake');
  await waitFor(() => ev(`!!document.querySelector('#track [data-since]')`)); await sleep(1200);
  const waiting = await ev(`(()=>{const e=document.querySelector('#track');return {text:document.body.innerText,track:e?.innerText,bg:e?.querySelector('.scene-bg')?.getAttribute('style'),elapsed:e?.querySelector('[data-since]')?.textContent}})()`);
  ok('擬稿中：背景、預計時間及真實已用時間', /crew-scene-rhythm\.webp/.test(waiting.bg || '') && waiting.track.includes('通常約 2 至 5 分鐘') && /已用 1:\d\d/.test(waiting.elapsed || '') && !/Claude Code|Codex|Antigravity/.test(waiting.text), waiting);
  await shot('fd-waiting.png');

  // 隱藏分頁狀態，讓完成通知留在分頁標題；資料狀態由伺服器實際讀取。
  await ev(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true})`);
  seedCompany(DATA, PROTO); write(statusFile, run('done'));
  const companyFile = path.join(DATA, 'company', 'page.json');
  const legacyPage = JSON.parse(fs.readFileSync(companyFile, 'utf8'));
  const legacyGoal = legacyPage.glance.rows.find(row => row.plan === 'G1');
  if (!legacyGoal) throw new Error('測試資料沒有 G1');
  legacyGoal.label = '本季目標'; delete legacyGoal.ask; write(companyFile, legacyPage);
  const legacyBytes = fs.readFileSync(companyFile, 'utf8');
  const readyTitle = await waitFor(() => ev(`document.title.includes('Zero 已擬好')`), 10000);
  ok('擬好後分頁標題提示', readyTitle, await ev('document.title'));
  await go('/proofread.html');
  const proof = await ev(`(()=>{const s=document.querySelector('#first-steps'),h=document.querySelector('.hero');return {current:s?.querySelector('[aria-current=step]')?.textContent,done:s?.querySelector('.done')?.textContent,href:s?.querySelector('[aria-current=step]')?.getAttribute('href'),title:h?.querySelector('.hero-t')?.textContent,count:document.querySelectorAll('.decide > .dq').length,text:h?.innerText,bg:getComputedStyle(h.querySelector('.scene-bg')).backgroundImage,tab:document.title}})()`);
  const goalLabel = await ev(`document.querySelector('#dq-goal-quarter .dq-q')?.textContent`);
  ok('舊 G1 名稱按 plan 顯示新名稱，存檔不變', goalLabel === N.field.G1 && fs.readFileSync(companyFile, 'utf8') === legacyBytes, goalLabel);
  const expectedHero = proof.count ? `Zero 已整理好你的公司概覽，先請你看 ${proof.count} 件事` : 'Zero 已整理好你的公司概覽，請你看一次';
  ok('未確認：校對進度、實際題數及背景', proof.current === '校對' && proof.done === '告訴 Zero' && proof.href === '/proofread.html' && proof.title === expectedHero && /crew-scene-handover\.webp/.test(proof.bg || '') && !/已連接|本批|Claude Code|Codex|Antigravity/.test(proof.text || ''), proof);
  ok('打開公司概覽後還原分頁提示', !proof.tab.startsWith('Zero 已擬好'), proof.tab);
  await shot('fd-proof.png');
  await go('/#/log', 390);
  const phone = await ev(`({hash:location.hash,overflow:document.documentElement.scrollWidth>innerWidth,steps:!!document.querySelector('#first-steps')})`);
  ok('390 闊度無橫向捲動，直接網址可用', phone.hash === '#/log' && !phone.overflow && phone.steps, phone);
  await shot('fd-phone.png');
  write(path.join(DATA, 'ledger', 'confirmed.json'), { confirmedAt: new Date().toISOString() });
  await chrome.send('Page.reload'); await sleep(800); await go('/#/log');
  ok('確認後恢復三個指標及九個分頁', await ev(`!document.querySelector('#first-steps') && document.querySelectorAll('.metric').length===3 && document.querySelectorAll('.desk-nav a[data-tab]').length===9`));
  // 升級後設定改變：舊認證不再算通過，頁面如實顯示並提供入口
  const certFile = path.join(DATA, 'ledger', 'adapter-cert.json'), certKeep = fs.readFileSync(certFile, 'utf8');
  fs.writeFileSync(certFile, JSON.stringify({ ...JSON.parse(certKeep), argsHash: 'old-config' }));
  await chrome.send('Page.reload'); await sleep(1200); await go('/#/');
  const stale = await ev(`fetch('/api/status').then(r=>r.json()).then(s=>({cert:s.cert,ready:s.ai.ready,stale:s.aiStale,text:document.querySelector('#ai-block')?.innerText||'',link:document.querySelector('#go-setup')?.getAttribute('href')}))`);
  ok('舊認證失效：頁面如實顯示要重新檢查，並有設定入口', stale.cert === null && stale.ready === false && stale.stale === true && stale.text.includes('重新檢查') && stale.link === '#/setup', stale);
  write(path.join(DATA, 'ledger', 'certify-status.json'), { state: 'passed', items: [] });
  await go('/#/setup');
  const staleSetup = await ev(`({done:!!document.querySelector('#setup-done'), title:document.querySelector('#certify h3')?.textContent || '', text:document.querySelector('#certify')?.innerText || ''})`);
  ok('舊 passed 結果不顯示成功標題或返回按鈕', !staleSetup.done && !staleSetup.title.includes('AI 工具已設定') && !staleSetup.text.includes('AI 工具已設定'), staleSetup);
  fs.writeFileSync(certFile, certKeep);
  await chrome.send('Page.reload'); await sleep(800);
  // 示範資料即使未確認也保留完整介面。
  fs.rmSync(path.join(DATA, 'ledger', 'confirmed.json'));
  write(path.join(DATA, 'ledger', 'state.json'), { demo: true, tasks: [], events: [], company: {}, interviews: {} });
  await go('/#/intake');
  ok('示範資料保留完整介面', await ev(`!document.querySelector('#first-steps') && document.querySelectorAll('.metric').length===3 && document.querySelectorAll('.desk-nav a[data-tab]').length===9`));
} catch (error) { ok('驗收中斷', false, String(error.stack || error)); }
ok('瀏覽器沒有程式錯誤', !!chrome && !chrome.errors.length, chrome?.errors);
chrome?.close(); server.kill();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + JSON.stringify(r.info ?? null)));
process.exitCode = results.every(r => r.pass) ? 0 : 1;
