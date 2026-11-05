// 完整鏈驗收：起本機伺服器 → 開頁 → 改一項 → 成頁確認並交畀 AI → 等 AI 跟進 → 核對頁面同檔案
// 用法：node cdp-chain.mjs <chrome> <輸出資料夾> <原型資料夾> <adapter 檔或 default> <port> <ok|missing> <最長等幾多秒>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { seedCompany, certify, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT, MODE, WAIT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });

// 乾淨開始：清走上次測試留低嘅執行資料
const DATA = path.join(OUT, 'data');
const env = { ...process.env, SOS_DATA: DATA };
if (ADAPTER !== 'default') env.SOS_ADAPTER = ADAPTER;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; });
const BASE = `http://127.0.0.1:${PORT}/`;
await usePass(BASE);
for (let i = 0; i < 40; i++) { try { const r = await fetch(BASE + 'api/status'); if (r.ok) break; } catch { } await sleep(250); }
seedCompany(DATA, PROTO);
if (MODE !== 'missing') await certify(BASE);

const cport = 9351 + (MODE === 'missing' ? 1 : 0);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
async function json(u) { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { } await sleep(250); } throw new Error('devtools'); }
const pageT = (await json(`http://127.0.0.1:${cport}/json/list`)).find(t => t.type === 'page');
const ws = new WebSocket(pageT.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let seq = 0; const pend = new Map(); const errors = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); return; }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errors.push(d.params.entry.text);
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await usePass(BASE, { send });
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(expr + ' -> ' + r.exceptionDetails.exception?.description); return r.result.value; };
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
async function click(sel) {
  await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(120);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(250);
}
const track = () => ev(`document.querySelector('#track')?.innerText||''`);

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + 'proofread.html' }); await sleep(700);
  await ev('localStorage.clear()');
  await send('Page.navigate', { url: BASE + 'proofread.html' }); await sleep(1500);
  const t0 = await track();
  if (MODE === 'missing') ok('AI 未設定：確認前已經提示並有「前往設定」', t0.includes(N.ui.aiNotSet) && t0.includes('前往設定'), t0);
  else { const hero = await ev(`document.querySelector('.hero')?.innerText||''`); ok('首屏顯示 Zero 的公司概覽，沒有連線或批次系統字眼', hero.includes('Zero 已整理好你的公司概覽') && !/已連接|本批|Claude Code/.test(hero), hero); }
  await shot('c1-connected.png');
  // 改一項：本季目標揀第二個選項
  await click('#dq-goal-quarter > .opt:nth-of-type(2)');
  const edited = await ev(`document.querySelector('#dq-goal-quarter > .opt.cur').textContent`);
  // 成頁確認 → 交畀 AI
  await click('.cbar .btn.primary');
  ok('回覆盒主掣係「確認並交畀 AI」', (await ev(`document.querySelector('#do-confirm').textContent`)).includes(N.ui.submit));
  await shot('c2-modal.png');
  await click('#do-confirm');
  await sleep(600);
  const t1 = await track();
  ok('撳完即刻見到「已收到」', t1.includes('已收到確認'), t1.slice(0, 120));
  await shot('c3-received.png');
  // 等 AI 跟進
  const until = Date.now() + Number(WAIT) * 1000;
  let t2 = '', sawRunning = false;
  while (Date.now() < until) {
    t2 = await track();
    if (t2.includes('處理中') || t2.includes('做緊')) sawRunning = true;
    if (t2.includes('✓ 完成') || t2.includes('未完成') || (MODE === 'missing' && t2.includes('前往設定') && t2.includes('已記錄修改與次序'))) break;
    await sleep(1500);
  }
  await shot('c4-final.png');
  if (MODE === 'missing') {
    ok('AI 未設定：顯示等緊 AI 設定同原因', t2.includes(N.ui.aiNotSet) && t2.includes('自動繼續'), t2.slice(0, 300));
    ok('AI 未設定：有「前往設定」', await ev(`[...document.querySelectorAll('#track a')].some(b=>b.textContent.includes('前往設定'))`));
    ok('AI 未設定：套用照樣完成（唔使 AI）', t2.includes('已記錄修改與次序'));
  } else {
    ok('中途顯示 AI 跟進緊', sawRunning);
    ok('AI 跟進好，頁面顯示成果', t2.includes('✓ 完成'), t2.slice(0, 300));
    ok('頁面列出 AI 做咗嘅嘢（≥3 份）', (await ev(`document.querySelectorAll('#track details').length`)) >= 3);
    ok('寫明全部係草稿、冇對外發送', t2.includes('全部為草稿') && t2.includes('未有對外發送'));
    const data = DATA;
    const conf = JSON.parse(fs.readFileSync(path.join(data, 'ledger', 'confirmed.json'), 'utf8'));
    ok('你嘅修改已機械套用入確認版', String(edited).includes(conf.values['goal-quarter'].slice(0, 8)), conf.values['goal-quarter']);
    ok('回覆檔已歸檔、回覆資料夾清空', fs.readdirSync(path.join(data, 'founder', 'replies')).length === 0);
    const runs = fs.readdirSync(path.join(data, 'work'));
    ok('AI 產出已放入工作資料夾', runs.length === 1 && fs.readdirSync(path.join(data, 'work', runs[0])).length >= 4, runs);
    // 重開頁面：成果仲喺度
    await send('Page.navigate', { url: BASE + 'proofread.html' }); await sleep(1500);
    ok('重開頁面成果仲喺度', (await track()).includes('✓ 完成'));
    await shot('c5-reopen.png');
  }
  ok('頁面冇出現「null／undefined」程式字', !/null|undefined|\[object/.test(await ev(`document.body.innerText`)));
  ok('冇頁面錯誤', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  ok('測試中斷', false, String(e && e.stack || e));
} finally {
  try { await send('Browser.close'); } catch { }
  setTimeout(() => { chrome.kill(); srv.kill(); }, 300);
}
fs.writeFileSync(path.join(OUT, 'server-log.txt'), srvLog);
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
setTimeout(() => process.exit(0), 900);
