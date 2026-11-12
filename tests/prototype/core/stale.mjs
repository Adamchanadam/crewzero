// 舊分頁／舊伺服器測試：舊版自動閂、同版沿用、伺服器重開提示、問題包唔喺度就拒收
// 用法：node stale.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const DATA = path.join(OUT, 'data'); process.env.SOS_DATA = DATA;
const env = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER };
const BASE = `http://127.0.0.1:${PORT}/`;
const status = async () => { try { return await (await fetch(BASE + 'api/status', { signal: AbortSignal.timeout(1000) })).json(); } catch { return null; } };
function startServer(dir) {
  const p = spawn(process.execPath, [path.join(dir, 'server.mjs'), '--port', PORT], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', d => { p.log += d; }); p.stderr.on('data', d => { p.log += d; });
  p.exited = false; p.on('exit', () => { p.exited = true; });
  return p;
}
async function waitFor(fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(200); } return null; }

// 1. 整一個「舊版」原型（只改版本號），用同一個資料夾開
const OLD = path.join(OUT, 'old-proto'); fs.mkdirSync(OLD);
fs.cpSync(PROTO, OLD, { recursive: true, filter: src => path.relative(PROTO, src).split(path.sep)[0] !== 'data' });
const libOld = path.join(OLD, 'ask-lib.mjs');
fs.writeFileSync(libOld, fs.readFileSync(libOld, 'utf8').replace(/SERVER_VERSION = '[^']+'/, "SERVER_VERSION = 'proofread-chain-old'"));
const old = startServer(OLD);
await usePass(BASE);
const s1 = await waitFor(async () => { const s = await status(); return s && s.version === 'proofread-chain-old' ? s : null; });
ok('舊版伺服器起到', !!s1, old.log.slice(0, 200));

// 2. 放一個問題包
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const DIR = lib.dataDirs(PROTO);
const prep = lib.preparePacks({
  format: 'startup-os.ask/0.1', title: '測試：舊分頁', questions: [
    { id: 'a', ask: '第一條？', kind: 'choice', options: [{ text: '甲', rec: true }, { text: '乙' }], value: '甲', why: '測試' },
    { id: 'b', ask: '第二條？', kind: 'date', value: '2026-11-02', why: '測試' }]
}, { dirs: DIR, askedBy: 'AI' });
const placed = lib.placePacks(DIR, prep.packs); const PACK = placed[0].id;
ok('問題包放到', prep.ok && PACK, PACK);

// 3. Chrome 打開舊版伺服器嘅答題頁
const cport = 9391;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
async function json(u) { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { } await sleep(250); } throw new Error('devtools'); }
const pg = (await json(`http://127.0.0.1:${cport}/json/list`)).find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let seq = 0; const pend = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await usePass(BASE, { send });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
async function click(sel) {
  // 搵唔到元素就講明（唔好成個測試靜靜地死咗、冇結果）
  if (!(await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.scrollIntoView({block:'center'});return true})()`))) throw new Error('搵唔到 ' + sel + '；頁面：' + String(await ev('document.body.innerText')).slice(0, 200));
  await sleep(150);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
}
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
let neu = null, again = null;
try {
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `${BASE}#/ask/${PACK}` }); await sleep(1500);
ok('舊版頁面打開到問題包', /第一條/.test(await ev('document.body.innerText')));

// 4. 開新版：應該自動閂舊版、用返同一個埠
// 真實換版係原地：同一個程式資料夾換入新版檔，再開新版（新版只會關同一資料夾、經作業系統核對到嘅舊程序）
fs.copyFileSync(path.join(PROTO, 'ask-lib.mjs'), libOld);
neu = startServer(OLD);
const s2 = await waitFor(async () => { const s = await status(); return s && s.version === lib.SERVER_VERSION ? s : null; }, 15000);
ok('新版接手同一個埠', !!s2 && s2.pid === neu.pid, neu.log);
ok('新版話已經閂咗舊版', /發現舊版正在運行/.test(neu.log), neu.log);
ok('舊版程序真係停咗', await waitFor(async () => old.exited, 5000));

// 5. 返嚟舊分頁：提示伺服器重新開過
await ev(`window.dispatchEvent(new Event('focus'))`); await sleep(800);
ok('舊分頁出「重新載入」提示', await ev(`!!document.querySelector('#stale') && /重新載入/.test(document.querySelector('#stale').innerText)`));
await shot('stale-banner.png');

// 6. 問題包唔喺呢度（例如測試分頁）：拒收、唔寫檔、出返首頁
await send('Page.reload'); await sleep(1500);
fs.rmSync(path.join(DIR.asks, PACK + '.json'));
await click('#go-main'); await click('#do-confirm'); await sleep(800);
const body = await ev('document.body.innerText');
ok('送出被拒並講可能係舊分頁', /舊分頁/.test(body), body.slice(0, 300));
ok('有「返 Founder Desk 睇最新」', await ev(`[...document.querySelectorAll('a')].some(a => /返回待決事項/.test(a.innerText) && a.getAttribute('href') === '/#/')`));
ok('冇寫入任何回覆', fs.readdirSync(DIR.replies).length === 0, fs.readdirSync(DIR.replies));
await shot('pack-not-here.png');

// 7. 再雙擊「開始」（同版）：沿用而家嗰個，唔會開第二個
again = startServer(OLD);
await waitFor(async () => again.exited, 8000);
ok('同版再開會沿用', again.exited && /已在運行/.test(again.log), again.log);
const s3 = await status();
ok('原本嗰個仲喺度', s3 && s3.pid === neu.pid);

} catch (e) {
  ok('測試中斷', false, String(e && e.stack || e));
}
try { await send('Browser.close'); } catch { }
for (const p of [old, neu, again]) try { p.kill(); } catch { }
setTimeout(() => { try { chrome.kill(); } catch { } }, 300);
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
setTimeout(() => process.exit(0), 800);
