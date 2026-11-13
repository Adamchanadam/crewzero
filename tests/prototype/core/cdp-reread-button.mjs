// 附件「重新讀取」按鈕要真的叫伺服器（主線全面審查 2026-11-12：字句照實，去掉假承諾）。
// 頁面內直接用 SOS_DESK.attachList 畫一份 Google 連結附件，攔截 fetch：按下後必須 POST /api/input-reread {id, n}，並照伺服器回覆顯示成功或失敗。
// 修正前預期 RB-01、RB-02、RB-03 不通過（按鈕只顯示「已記下要重新讀取這個連結」，沒有呼叫伺服器）。
// 用法：node cdp-reread-button.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { freshTestOut } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const run = fs.mkdtempSync(path.join(OUT, 'reread-')), DATA = path.join(run, 'data');
async function waitFor(fn, ms = 15000) { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(250); } return null; }
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
const J = JSON.stringify;
// 畫一份附件清單，攔截 fetch；reply 是伺服器回覆（status 及 body）
const mount = reply => `(()=>{window.__rr=[];const f=window.fetch;window.fetch=function(u,o){if(String(u).includes('/api/input-reread')){window.__rr.push({u:String(u),m:o&&o.method,b:o&&o.body});return Promise.resolve(new Response(JSON.stringify(${J(reply.body)}),{status:${reply.status},headers:{'Content-Type':'application/json'}}));}return f.apply(this,arguments)};
  const old=document.getElementById('rr-test');if(old)old.remove();const box=document.createElement('div');box.id='rr-test';document.body.append(box);
  box.append(SOS_DESK.attachList({id:'in-test-1',files:[{n:2,name:'報價.pdf',url:'https://docs.google.com/document/d/abc/edit',gkind:'google-doc',readOn:'2026-11-10',openable:true}],linkErrors:[]},{reread:true}));
  const b=box.querySelector('[data-reread]');return !!b})()`;
const press = () => chrome.ev(`(()=>{const b=document.querySelector('#rr-test [data-reread]');b.click();return true})()`);
const toastText = () => chrome.ev(`(()=>{const e=document.getElementById('toast');return e&&!e.hidden?e.textContent.trim():''})()`);

try {
  await waitFor(async () => (await fetch(BASE + '/api/status')).ok);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  await chrome.go(BASE + '/#/', 1440, 1000);
  await waitFor(() => chrome.ev('!!window.SOS_DESK && typeof SOS_DESK.attachList==="function"'));

  // 成功
  ok('RB-00 前提：附件清單有「重新讀取」按鈕', await chrome.ev(mount({ status: 202, body: { ok: true, readOn: '2026-11-12', message: N.ui.rereadOk } })));
  await press();
  const sent = await waitFor(() => chrome.ev('window.__rr.length?window.__rr[0]:null'), 4000);
  let body = null; try { body = JSON.parse(sent && sent.b || 'null'); } catch { }
  ok('RB-01 按「重新讀取」：POST /api/input-reread，帶輸入編號及附件序號', sent && sent.m === 'POST' && body && body.id === 'in-test-1' && body.n === 2, sent);
  const okToast = await waitFor(toastText, 4000);
  ok('RB-02 成功：照伺服器回覆顯示「' + N.ui.rereadOk + '」，不再顯示「' + N.ui.attRereadAsked + '」', okToast === N.ui.rereadOk, okToast);

  // 失敗
  await chrome.ev(mount({ status: 422, body: { error: 'reread', message: N.ui.rereadFailed } }));
  await press();
  await sleep(600);
  const failToast = await toastText();
  ok('RB-03 失敗：照實顯示「' + N.ui.rereadFailed + '」', failToast === N.ui.rereadFailed, failToast);
  ok('RB-04 頁面沒有錯誤', chrome.errors.length === 0, chrome.errors);
} catch (e) {
  ok('重新讀取按鈕測試中斷', false, String(e && e.stack || e));
} finally {
  if (chrome) chrome.close();
  server.kill();
}
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info ?? '')).slice(0, 600)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
