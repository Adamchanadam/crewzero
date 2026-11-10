// 會議紀錄頁面：非示範資料 → 講者確認 → 草稿 → 本機衝突 → 標示確認 → 回饋卡。
// 用法：node cdp-minutes.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const run = fs.mkdtempSync(path.join(OUT, 'minutes-')), DATA = path.join(run, 'data');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
async function waitFor(fn, ms = 45000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch { } await sleep(250); } return null; }

fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
write(path.join(DATA, 'ledger', 'confirmed.json'), { confirmedAt: new Date().toISOString() });
write(path.join(DATA, 'ledger', 'state.json'), { schemaVersion: 1, tasks: [], events: [], company: { name: '測試公司', initials: '測試', rhythm: { runCadence: 'weekly', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } }, interviews: { nextOn: '2099-01-05', applied: {} } });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  const transcript = path.join(run, '會議逐字稿.txt');
  write(transcript, ['00:00 Speaker 1', '今天確認首批供貨安排及下一步。', '', '00:12 Speaker 1', '我會先核對每月需要的數量。', '', '00:25 Speaker 1', '請把日期和負責人一併寫清楚。', '', '00:38 Speaker 1', '這次的討論要先整理成會議紀錄。', '', '00:51 Speaker 1', '下星期的安排仍要再確認。'].join('\n'));
  await chrome.go(BASE + '/#/', 1440, 1000);
  await waitFor(() => chrome.ev('!!document.getElementById("quick-event")'));
  await chrome.click('#quick-event');
  const dom = await chrome.send('DOM.getDocument', { depth: -1 });
  const input = await chrome.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#quick-files' });
  await chrome.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [transcript] });
  const speakers = await waitFor(() => chrome.ev('document.querySelectorAll("#minutes-speakers select").length'));
  ok('附逐字稿後出現講者確認區', speakers > 0, speakers);
  ok('未確認前不能整理草稿', await chrome.ev('document.getElementById("quick-send").disabled && document.getElementById("quick-note").innerText.includes(' + JSON.stringify(N.t('minConfirmFirst')) + ')'));
  await waitFor(() => chrome.ev('[...document.querySelectorAll("#minutes-speakers select")].every(s=>s.value!=="")'));
  ok('Zero 建議到後已預選講者', await chrome.ev('[...document.querySelectorAll("#minutes-speakers select")].every(s=>s.value!=="")'));
  await chrome.ev('[...document.querySelectorAll("#minutes-speakers select")].forEach(s=>{if(!s.value){s.value="founder";s.dispatchEvent(new Event("change",{bubbles:true}));}})');
  ok('確認後可以整理草稿', await chrome.ev('!document.getElementById("quick-send").disabled'));
  await chrome.click('#quick-send');
  const ready = await waitFor(() => chrome.ev('!!document.getElementById("minutes-ready")'));
  ok('草稿頁顯示標示數目、下一處及儲存', !!ready && await chrome.ev('document.querySelectorAll("#minutes-ready .min-count span").length===2 && !!document.getElementById("minutes-save") && !!document.querySelector(".min-mark .btn")'));
  ok('1440 闊度沒有橫向捲動', await chrome.ev('document.documentElement.scrollWidth<=innerWidth'));
  await chrome.shot(path.join(OUT, 'minutes-ready-1440.png'), '#app');
  const liveMarks = await chrome.ev(`(()=>{const e=document.querySelector('#minutes-text'),number=t=>Number((String(t).match(/(\\d+)/)||[])[1]),old=e.value,before=number(document.querySelectorAll('#minutes-ready .min-count span')[0].innerText),sideBefore=document.querySelectorAll('.min-mark').length;e.value=old.replace(/^⚠️（[^）]*）[^\\n]*(?:\\n|$)/m,'');e.dispatchEvent(new Event('input',{bubbles:true}));const after=number(document.querySelectorAll('#minutes-ready .min-count span')[0].innerText),sideAfter=document.querySelectorAll('.min-mark').length;e.value=old;e.dispatchEvent(new Event('input',{bubbles:true}));return {before,after,sideBefore,sideAfter};})()`);
  ok('刪去一處不肯定標示後立即重算數目及清單', liveMarks.before === 1 && liveMarks.after === 0 && liveMarks.sideAfter === liveMarks.sideBefore - 1, liveMarks);
  // 在原文末尾加字（cdp-lib 的 type 會先清空輸入框，會把整份草稿換掉）
  const append = (sel, t) => chrome.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value+=${JSON.stringify(t)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await append('#minutes-text', '\n補充：已由創辦人核對。');
  await chrome.click('#minutes-save');
  const mid = await chrome.ev('location.hash.split("/").pop()');
  const saved = await waitFor(async () => { const r = await get('/api/minutes?id=' + encodeURIComponent(mid)); return r.j && /創辦人核對/.test(r.j.text || '') ? r.j : null; });
  ok('全文編輯可儲存：加字後原有內容及標示保留', !!saved && (saved.marks || {}).warn === 1 && (saved.marks || {}).fill === 1 && /## 參加者/.test(saved.text || ''), saved && { hash: saved.hash, marks: saved.marks && { warn: saved.marks.warn, fill: saved.marks.fill } });
  const external = await post('/api/minutes', { action: 'save', id: mid, text: (saved.text || '') + '\n本機修改。', hash: saved.hash });
  ok('測試先模擬本機已改過草稿', external.code === 200, external.code);
  await append('#minutes-text', '\n網頁舊版本。');
  await chrome.click('#minutes-save');
  const changed = await waitFor(() => chrome.ev('document.getElementById("minutes-note")?.innerText||""'));
  ok('本機已改過時顯示重新載入提示', String(changed || '').includes(N.ui.minChangedLocally));
  await chrome.click('#minutes-reload');
  // 重新載入會重畫整頁：等舊提示消失、新的編輯框載入本機修改後才按，免得按到即將被換走的舊按鈕
  await waitFor(() => chrome.ev('!!document.getElementById("minutes-submit") && !(document.getElementById("minutes-note")?.innerText||"").includes(' + JSON.stringify(N.ui.minChangedLocally) + ') && (document.getElementById("minutes-text")?.value||"").includes("本機修改。")'));
  const beforeSubmit = (await get('/api/minutes?id=' + encodeURIComponent(mid))).j || {};
  await append('#minutes-text', '\n補充：未儲存也要一併交出。');
  await chrome.click('#minutes-submit');
  const confirm = await waitFor(() => chrome.ev('document.getElementById("minutes-confirm-title")?.innerText||""'), 15000);
  const afterSubmit = (await get('/api/minutes?id=' + encodeURIComponent(mid))).j || {};
  ok('仍有標示時先顯示交出提醒', /仍有/.test(String(confirm || '')) && /未處理/.test(String(confirm || '')), { confirm, before: { state: beforeSubmit.state, marks: beforeSubmit.marks && { warn: beforeSubmit.marks.warn, fill: beforeSubmit.marks.fill, n: (beforeSubmit.marks.items || []).length }, tail: String(beforeSubmit.text || '').slice(-80) }, after: { state: afterSubmit.state }, app: await chrome.ev('(document.getElementById("app")?.innerText||"").slice(0,200)') });
  await chrome.click('#modal-root .m-foot .btn:not(.primary)');
  const submitted = await waitFor(() => chrome.ev('!!document.getElementById("minutes-submitted")'));
  ok('確認後交給 Zero，顯示已交狀態', !!submitted);
  const submittedText = await waitFor(async () => { const r = await get('/api/minutes?id=' + encodeURIComponent(mid)); return r.j && /未儲存也要一併交出/.test(r.j.text || '') ? r.j : null; });
  ok('未儲存的全文編輯會先儲存再交出', !!submittedText, submittedText && { hash: submittedText.hash, tail: String(submittedText.text || '').slice(-80) });
  await chrome.go(BASE + '/#/', 1440, 1000);
  await waitFor(() => chrome.ev('!!document.getElementById("quick-input")'));
  ok('交出後「接下來」不再列出該會議', await chrome.ev('!document.querySelector("[data-minutes]")'));
  const final = await get('/api/minutes?id=' + encodeURIComponent(mid));
  if (final.j && final.j.inputId) {
    // 等外殼登記這件事後才開回饋卡（重新整理頁面後沒有「已送出」暫存，未登記前會顯示找不到）
    await waitFor(async () => (await get('/api/input?id=' + encodeURIComponent(final.j.inputId))).code === 200, 45000);
    await chrome.go(BASE + '/#/feedback/' + final.j.inputId, 1440, 1000);
    const feedback = await waitFor(() => chrome.ev('document.getElementById("fb-minutes")?.innerText||""'));
    const inputNow = (await get('/api/input?id=' + encodeURIComponent(final.j.inputId))).j;
    ok('回饋卡有會議紀錄及修改入口', String(feedback || '').includes('會議紀錄') && await chrome.ev('!!document.querySelector("#fb-minutes button")'), { feedback, app: await chrome.ev('(document.getElementById("app")?.innerText||"").slice(0,400)'), errors: chrome.errors, input: inputNow && inputNow.input && { files: (inputNow.input.files || []).map(f => f.name), minutes: inputNow.input.minutes } });
  } else ok('回饋卡有會議紀錄及修改入口', false, 'minutes response missing inputId');
  await chrome.go(BASE + '/#/minutes/' + mid, 390, 844);
  await waitFor(() => chrome.ev('!!document.getElementById("minutes-submitted")'));
  ok('390 闊度沒有橫向捲動', await chrome.ev('document.documentElement.scrollWidth<=innerWidth'));
  await chrome.shot(path.join(OUT, 'minutes-submitted-390.png'), '#app');
  ok('會議紀錄新字句通過用字檢查', ['minSpeakerTitle', 'minMakeDraft', 'minDraftReady', 'minChangedLocally', 'minSubmit', 'minSubmitted', 'minFeedbackVersion'].every(k => N.styleIssues(N.t(k, { n: 2 })).length === 0));
  ok('頁面沒有錯誤', chrome.errors.length === 0, chrome.errors);
} catch (e) {
  ok('會議紀錄測試中斷', false, String(e && e.stack || e));
} finally {
  if (chrome) chrome.close();
  server.kill();
}

for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info ?? '')).slice(0, 900)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
