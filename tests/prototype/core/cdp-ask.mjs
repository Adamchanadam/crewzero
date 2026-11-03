// 問題包全鏈驗收（測試用 AI）：命令放 14 條 → 拆兩包 → 首頁 → 答 3 條 → AI 繼續 → 再答 3 條 → AI 用到之前嘅答案
// → 紀錄 → 公司一頁確認後 AI 自己出題 → 答過唔再問 → 手機
// 用法：node cdp-ask.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <示範 14 條問題包>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { seedCompany, certify, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, DEMO] = process.argv.slice(2);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const DATA = path.join(OUT, 'data');
process.env.SOS_DATA = DATA;
fs.rmSync(DATA, { recursive: true, force: true });

const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs')], { cwd: PROTO, env: { ...process.env, SOS_ADAPTER: ADAPTER, SOS_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
let BASE = null;
for (let i = 0; i < 40 && !BASE; i++) {
  await sleep(250);
  const m = /已開：(http:\/\/127\.0\.0\.1:\d+\/)/.exec(srvLog);
  if (m) BASE = m[1];
}
ok('伺服器起到', !!BASE, srvLog.slice(0, 200));
await usePass(BASE);
seedCompany(DATA, PROTO);
await certify(BASE);

// 命令入口：14 條 → 自動拆成 12＋2
const cli = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), DEMO, '--no-open'], { cwd: PROTO, encoding: 'utf8', env: { ...process.env, SOS_DATA: DATA } });
ok('命令入口：14 條自動拆成兩包', /（1／2）（共 12 條/.test(cli.stdout) && /（2／2）（共 2 條/.test(cli.stdout), cli.stdout.trim());
ok('命令入口：印出答題網址', /Founder Desk：http/.test(cli.stdout));
const bad = path.join(OUT, 'bad.json');
fs.writeFileSync(bad, JSON.stringify({ format: 'startup-os.ask/0.1', title: '壞', questions: [{ id: 'x', ask: '？', kind: 'text', value: '', why: '' }] }));
const cli2 = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), bad, '--no-open'], { cwd: PROTO, encoding: 'utf8', env: { ...process.env, SOS_DATA: DATA } });
ok('命令入口：唔合規格就退回並講原因', cli2.status === 1 && /不符合規格/.test(cli2.stdout) && /缺少 AI 建議答案/.test(cli2.stdout), cli2.stdout.trim());

const cport = 9371;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
async function json(u) { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { } await sleep(250); } throw new Error('devtools'); }
const pg = (await json(`http://127.0.0.1:${cport}/json/list`)).find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl);
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
const shot = async (name, full) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
async function click(sel) {
  const ok1 = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.scrollIntoView({block:'center'}); return true;})()`);
  if (!ok1) throw new Error('搵唔到 ' + sel);
  await sleep(120);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
}
const text = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText||''`);
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { if (await fn()) return true; await sleep(700); } return false; }
async function go(u) { await send('Page.navigate', { url: u }); await sleep(1200); }

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  // 首頁
  await go(BASE);
  ok('首頁：導航顯示 2 個待決事項', (await text('.desk-count')) === '2', await text('.desk-count'));
  await shot('h1-hub.png');
  // 第一包：答 3 條
  await click('#next-list a[href^="#/ask/"]');
  await sleep(800);
  ok('答題頁：只出 3 張卡', (await ev(`document.querySelectorAll('.dq').length`)) === 3);
  ok('即刻生效嘅題目排第一批', (await ev(`[...document.querySelectorAll('.dq')].some(c=>c.innerText.includes('確認後即時生效'))`)));
  ok('其餘 9 條列出「問題 → AI 建議」', (await ev(`document.querySelectorAll('#rest .rest-line').length`)) === 9);
  await shot('h2-pack.png');
  const firstIds = await ev(`[...document.querySelectorAll('.dq')].map(c=>c.id).join(',')`);
  await click('.dq:nth-of-type(1) .opt:nth-of-type(2)');
  ok('揀選項即算答咗', (await text('.prog-n')) === '本批已答 1／3');
  await click('#go-main');
  ok('預覽：即刻生效嘅單獨列', (await text('.modal')).includes('確認後即時生效'));
  await shot('h3-modal.png');
  await click('#do-confirm');
  ok('送出後即見進度', (await waitFor(async () => (await text('#track')).includes('已收到答案'), 5000)));
  ok('AI 跟住做完', await waitFor(async () => (await text('#track')).includes('✓ 完成'), 30000), await text('#track'));
  ok('見到 AI 做咗乜', (await ev(`document.querySelectorAll('#track details.art').length`)) >= 1);
  ok('有「繼續作答（3 題）（尚有 9 題）」', (await text('#more')).includes('尚有 9 題'), await text('#more'));
  await shot('h4-done.png');
  // 再答 3 條
  await click('#more');
  await sleep(1000);
  const secondIds = await ev(`[...document.querySelectorAll('.dq')].map(c=>c.id).join(',')`);
  ok('第二批係另外 3 條', secondIds.split(',').length === 3 && !secondIds.split(',').some(i => firstIds.includes(i)), firstIds + ' / ' + secondIds);
  ok('見到「已作答（3 題）」', (await text('details.layer summary')).includes('已作答（3 題）'));
  await click('#go-main');
  await click('#do-confirm');
  ok('第二批 AI 都做完', await waitFor(async () => (await text('#track')).includes('✓ 完成'), 30000));
  // 第二批嘅 AI 有冇用到第一批答案
  const sb = fs.readdirSync(path.join(DATA, 'sandbox')).filter(n => n.startsWith('R')).sort();
  const latestAns = fs.readFileSync(path.join(DATA, 'sandbox', sb[sb.length - 1], 'answers.md'), 'utf8');
  ok('第二批 AI 收到第一批 + 第二批答案（6 條創辦人答咗）', (latestAns.match(/創辦人答咗/g) || []).length === 6, (latestAns.match(/創辦人答咗/g) || []).length);
  // 紀錄
  await go(BASE + '#/log');
  ok('紀錄：分兩次回覆、每次 3 條', (await ev(`document.querySelectorAll('.log-item').length`)) === 2);
  ok('紀錄：記低你改咗嗰條（AI 原建議）', (await text('#app')).includes('AI 原建議'));
  await click('.log-item .foot .btn');
  ok('紀錄：撳得出 AI 跟住做咗乜', await waitFor(async () => (await ev(`document.querySelectorAll('.log-item details.art').length`)) >= 1, 5000));
  await click('.tabs .btn:nth-of-type(2)');
  ok('紀錄：淨係你改咗嘅得 1 條', (await ev(`document.querySelectorAll('.qa li').length`)) === 1);
  await shot('h5-log.png', true);
  // 公司一頁確認 → AI 自己出題 → 首頁出現
  await go(BASE + 'proofread.html');
  await ev('localStorage.clear()');
  await go(BASE + 'proofread.html');
  await click('#go-main');
  await click('#do-confirm');
  ok('公司一頁：AI 跟進完出咗新問題包', await waitFor(async () => (await text('#track')).includes('AI 追問'), 30000), await text('#track'));
  await go(BASE);
  // 另加：深化問題包、生意體檢之後嘅「建議開辯論」（規劃書 4.6）
  ok('首頁：AI 出嘅問題包出現（3 個；缺口 5 後另加深化問題包；建議開辯論留在生意大腦）', (await text('.desk-count')) === String(3 + (fs.readdirSync(path.join(DATA, 'asks')).filter(f => { try { const p = JSON.parse(fs.readFileSync(path.join(DATA, 'asks', f), 'utf8')); return !!p.depth; } catch { return false; } }).length)), await text('.desk-count'));
  // 答過唔再問：再放一個包，有一條同之前一樣
  const dup = path.join(OUT, 'dup.json');
  fs.writeFileSync(dup, JSON.stringify({ format: 'startup-os.ask/0.1', title: '重複測試', questions: [
    { id: 'a', ask: '先推廣哪類餐廳？', options: [{ text: '甲', rec: true }, { text: '乙' }], value: '甲', why: '測試' },
    { id: 'b', ask: '全新問題？', options: [{ text: '甲', rec: true }, { text: '乙' }], value: '甲', why: '測試' }] }));
  const cli3 = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), dup, '--no-open'], { cwd: PROTO, encoding: 'utf8', env: { ...process.env, SOS_DATA: DATA } });
  ok('答過嘅題目自動拎走', /有 1 條題目先前已回答/.test(cli3.stdout) && /重複測試（共 1 條/.test(cli3.stdout), cli3.stdout.trim());
  // 手機
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(BASE);
  ok('手機首頁：冇橫向捲動', await ev(`document.documentElement.scrollWidth <= innerWidth`));
  await shot('m1-hub.png');
  await click('#next-list a[href^="#/ask/"]');
  await sleep(800);
  ok('手機答題：冇橫向捲動', await ev(`document.documentElement.scrollWidth <= innerWidth`));
  ok('手機答題：底部大掣夠高', (await ev(`document.querySelector('.cbar .btn.primary').getBoundingClientRect().height`)) >= 44);
  await shot('m2-pack.png');
  ok('頁面冇「null／undefined」程式字', !/null|undefined|\[object/.test(await ev(`document.body.innerText`)));
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
