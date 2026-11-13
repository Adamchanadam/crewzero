// 交事類型切換與逐字稿講者確認（ARL 反審 2026-11-12 第二節問題 5；先寫失敗測試，修正前預期 MS-02、MS-03、MS-05 不通過）
// A：在「發生了一件事」附逐字稿 → 出現講者確認、送出鍵停用 → 轉去「請 Zero 做一件事」：送出鍵應恢復可按、字句回到一般送出。
// B：先在「請 Zero 做一件事」附逐字稿（不會檢查附件）→ 伺服器拒絕 → 轉回「發生了一件事」：應重新檢查附件並出現講者確認區。
// 用法：node cdp-minutes-switch.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const run = fs.mkdtempSync(path.join(OUT, 'minutes-switch-')), DATA = path.join(run, 'data');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
async function waitFor(fn, ms = 20000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch { } await sleep(250); } return null; }

fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
write(path.join(DATA, 'ledger', 'confirmed.json'), { confirmedAt: new Date().toISOString() });
write(path.join(DATA, 'ledger', 'state.json'), { schemaVersion: 1, tasks: [], events: [], company: { name: '測試公司', initials: '測試', rhythm: { runCadence: 'weekly', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } }, interviews: { nextOn: '2099-01-05', applied: {} } });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
const sendState = () => chrome.ev('(()=>{const b=document.getElementById("quick-send");return b?{disabled:b.disabled,text:b.innerText.trim()}:null})()');
const speakerCount = () => chrome.ev('document.querySelectorAll("#minutes-speakers select, .min-speakers select").length');
async function attach(file) {
  const dom = await chrome.send('DOM.getDocument', { depth: -1 });
  const input = await chrome.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#quick-files' });
  await chrome.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [file] });
}
async function home() {
  await chrome.go(BASE + '/#/', 1440, 1000);
  await waitFor(() => chrome.ev('!!document.getElementById("quick-event")'));
}

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  const transcript = path.join(run, '會議逐字稿.txt');
  write(transcript, ['00:00 Speaker 1', '今天確認首批供貨安排及下一步。', '', '00:12 Speaker 1', '我會先核對每月需要的數量。', '', '00:25 Speaker 2', '請把日期和負責人一併寫清楚。', '', '00:38 Speaker 1', '這次的討論要先整理成會議紀錄。', '', '00:51 Speaker 2', '下星期的安排仍要再確認。'].join('\n'));

  /* ===== A：發生了一件事 → 請 Zero 做一件事 ===== */
  await home();
  await chrome.click('#quick-event');
  await attach(transcript);
  const shown = await waitFor(speakerCount);
  const lockedA = await sendState();
  ok('MS-01 前提：「發生了一件事」附逐字稿後出現講者確認區，送出鍵停用', shown > 0 && lockedA && lockedA.disabled === true, { shown, lockedA });
  await chrome.click('#quick-adhoc');
  await sleep(400);
  const afterA = await sendState();
  ok('MS-02 轉去「請 Zero 做一件事」：送出鍵恢復可按', afterA && afterA.disabled === false, afterA);
  ok('MS-03 轉去「請 Zero 做一件事」：送出鍵字句回到「' + N.ui.tellSend + '」', afterA && afterA.text === N.ui.tellSend, afterA);

  /* ===== B：請 Zero 做一件事（附逐字稿）→ 發生了一件事 ===== */
  await home();
  await chrome.click('#quick-adhoc');
  await attach(transcript);
  await sleep(1500);
  ok('MS-04 前提：「請 Zero 做一件事」附檔不會出現講者確認區', (await speakerCount()) === 0);
  await chrome.click('#quick-event');
  const shownB = await waitFor(speakerCount, 15000);
  ok('MS-05 轉回「發生了一件事」：重新檢查附件並出現講者確認區（不用移除再選檔）', shownB > 0, { shownB, note: await chrome.ev('document.getElementById("quick-note")?.innerText||""') });
  ok('MS-06 頁面沒有錯誤', chrome.errors.length === 0, chrome.errors);
} catch (e) {
  ok('交事類型切換測試中斷', false, String(e && e.stack || e));
} finally {
  if (chrome) chrome.close();
  server.kill();
}

for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info ?? '')).slice(0, 900)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
