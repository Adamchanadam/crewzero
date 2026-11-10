// 生意大腦瀏覽器測試＋截圖（假 AI、示範資料）：六項總覽、紅藍對打逐步亮起、重播、結果卡意見、放上 CrewZero、手機闊度
// 用法：node cdp-brain.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port> [截圖資料夾]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT, SHOTS] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(OUT, 'data');
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
seedDemo(DATA, { reset: true });
await kit.certifyDirect(DATA, PROTO, ADAPTER);
const shift = sec => { const f = path.join(DATA, 'brain', 'reveal.json'); const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.seededAt = new Date(Date.now() - sec * 1000).toISOString(); fs.writeFileSync(f, JSON.stringify(r)); };
shift(0);
const BASE = `http://127.0.0.1:${PORT}/`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
await usePass(BASE);
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + 'api/status')).ok) break; } catch { } await sleep(250); }
const cport = 9451;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
async function json(u) { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { } await sleep(250); } throw new Error('devtools'); }
const pg = (await json(`http://127.0.0.1:${cport}/json/list`)).find(t => t.type === 'page');
const ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
let seq = 0; const pend = new Map(); const errors = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await usePass(BASE, { send });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(e + ' -> ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
const has = sel => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
async function click(sel) {
  await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(150);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
}
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
let W = 1440;
async function go(u, w = 1440) { W = w; await send('Emulation.setDeviceMetricsOverride', { width: w, height: w === 390 ? 844 : w === 1024 ? 768 : 900, deviceScaleFactor: 1, mobile: w < 600 }); await send('Page.navigate', { url: BASE + u }); await sleep(1600); }
// 截圖：scroll 到某個元素，影畫面；full 就影整頁
async function shot(name, sel, full) {
  if (!SHOTS) return;
  const hgt = W === 390 ? 844 : W === 1024 ? 768 : 900;
  if (full) { const H = await ev('Math.min(document.documentElement.scrollHeight, 7000)'); await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 }); await sleep(500); }
  else if (!sel) { await ev('window.scrollTo(0,0)'); await sleep(300); }
  else if (sel) { await ev(`(document.querySelector(${JSON.stringify(sel)})||document.body).scrollIntoView({block:'start'})`); await ev('window.scrollBy(0,-12)'); await sleep(400); }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full });
  fs.writeFileSync(path.join(SHOTS, `${name}-${W}.png`), Buffer.from(r.data, 'base64'));
  if (full) { await send('Emulation.setDeviceMetricsOverride', { width: W, height: hgt, deviceScaleFactor: 1, mobile: W < 600 }); await sleep(300); }
}
await send('Page.enable'); await send('Runtime.enable');
try {
  // 公司現況第一屏：生意大腦摘要（新版：六個小格直接連去各自分頁）
  await go('dashboard');
  ok('公司現況有生意大腦摘要（六項）', await ev(`document.querySelectorAll('#brain-strip .bmini').length===6`));
  // 生意大腦總覽（新版：/dashboard/brain 係總覽，六項各有分頁）
  await go('dashboard/brain');
  ok('分頁有六項總覽、四種狀態', await ev(`(()=>{const s=[...document.querySelectorAll('.btile')].map(b=>b.dataset.s);return s.length===6&&['done','running','waiting','not_started'].every(x=>s.includes(x))})()`));
  ok('演練及紅隊結果唔算證據有寫明', (await text('#brain-head')).includes('不算證據'));
  // 紅藍對打分頁：開頭（藍隊寫好）→ 等紅隊第一條攻擊出現，會亮一下
  await go('dashboard/brain/wargame');
  ok('紅藍對打階段：藍隊完成、紅隊進行中', await ev(`(()=>{const c=[...document.querySelectorAll('#wg-stages .stg')].map(x=>x.className);return c.length>1&&c[0].includes('done')&&c[1].includes('on')})()`), await ev(`[...document.querySelectorAll('#wg-stages .stg')].map(x=>x.className+':'+x.textContent).join(' | ')`));
  const lit = await waitFor(() => has('#b-wargame .lit'), 25000);
  ok('真時間推進：紅隊新攻擊出現時亮起', lit);
  // 截圖：推進中（紅隊攻擊）
  for (const w of [1440, 1024, 390]) { shift(26); await go('dashboard/brain/wargame', w); await shot('b02-wargame-red', '#b-wargame'); await go('dashboard/brain', w); await shot('b01-overview', null); }
  for (const w of [1440, 1024, 390]) { shift(80); await go('dashboard/brain/wargame', w); await shot('b03-wargame-judging', '#b-wargame'); }
  // 重播（新版：全部展開，再逐幕出現，出現嗰下亮起）
  await go('dashboard/brain/wargame');
  const rp = await ev(`(()=>{const b=document.querySelector('#replay');if(!b)return 'no-button';b.click();return document.querySelectorAll('#b-wargame [data-act].hide').length})()`);
  ok('重播推進：已出現嘅項目逐步再亮', rp > 0 && await waitFor(() => ev(`!!document.querySelector('#b-wargame [data-act].lit')`), 4000), rp);
  // 整合完成
  shift(170);
  await go('dashboard/brain/wargame');
  ok('整合完成：最大風險、推薦路線、需要你決定', (await text('#b-wargame')).includes('最大風險') && await has('#wg-decide-put'), await text('#b-wargame'));
  for (const w of [1440, 1024, 390]) { await go('dashboard/brain/wargame', w); await shot('b04-wargame-done', '#b-wargame'); }
  await go('dashboard/brain/wargame');
  await click('#wg-decide-put');
  ok('放上 CrewZero：之後變成作答入口', await waitFor(async () => { await sleep(1500); return ev(`(document.querySelector('#wg-decide-go')||{}).getAttribute&&/^\\/#\\/ask\\//.test(document.querySelector('#wg-decide-go').getAttribute('href'))`); }, 20000));
  // 結果卡意見：要修改（生意體檢分頁）
  await go('dashboard/brain/checkup');
  await click('[data-card="weak-2"] [data-fb="revise"]');
  ok('撳要修改：出一句意見嘅輸入', await has('#fb-text'));
  await ev(`document.querySelector('#fb-text').focus()`); await send('Input.insertText', { text: '加埋請兼職司機嘅成本' });
  for (const w of [1440]) await shot('b05-feedback-typing', '#b-checkup');
  await click('#fb-send');
  ok('要修改：卡上顯示已交 AI，AI 改好有修改版', await waitFor(async () => (await text('[data-card="weak-2"]')).includes('修改版'), 25000), await text('[data-card="weak-2"]'));
  await click('[data-card="weak-2"] .btn.primary');
  ok('修改版打得開', await waitFor(async () => (await text('#modal')).includes('兼職司機')));
  await click('#modal-close');
  for (const w of [1440, 1024, 390]) { await go('dashboard/brain/checkup', w); await shot('b06-feedback-done', '#b-checkup'); }
  // 有用（商機掃描分頁）
  await go('dashboard/brain/opportunities');
  ok('時間軸及卡片一致，日期與一般留意提示各自正確', await ev(`(()=>{const a=[...document.querySelectorAll('#opp-axis span')].map(x=>x.innerText.replace(/^\\d+\\s*/,''));const c=[...document.querySelectorAll('#b-opportunities .opp .pos')].map(x=>x.innerText.replace(/^\\d+\\s*·\\s*/,''));return a.length===4&&a.every((x,i)=>x===c[i]&&!/\\d{4}-\\d{2}-\\d{2}|★/.test(x))&&a.slice(0,2).every(x=>/\\d+ 月 \\d+ 日/.test(x))&&a[2].includes('留意最新申請期')&&a[3].includes('留意有關公布')&&a[0].includes('兩星期內')})()`));
  await click('[data-card="opp-1"] [data-fb="useful"]');
  await click('#fb-send');
  ok('有用：卡上顯示你的意見', await waitFor(async () => (await text('[data-card="opp-1"]')).includes('你的意見：有用')));
  await go('dashboard/brain/scenario');
  ok('情景演練等你：一按去 CrewZero 練習', await ev(`[...document.querySelectorAll('#b-scenario a')].some(a=>a.getAttribute('href')==='/#/practice/roaster-c')`));
  ok('監察台冇回覆盒（只有意見一句）', await ev(`!document.querySelector('textarea')`));
  for (const w of [1440, 1024, 390]) { await go('dashboard/brain', w); await shot('b07-brain-full', null, true); }
  for (const w of [1440, 1024, 390]) { await go('dashboard', w); await shot('b08-overview-strip', '#brain-strip'); }
  for (const p of ['dashboard/brain', 'dashboard/brain/wargame', 'dashboard/brain/checkup']) {
    await go(p, 390);
    const over = await ev(`(()=>{const o=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>391&&r.width>0&&!e.closest('.tabs,.bnav,.bg'))o.push(String(e.className).slice(0,20))});return o.slice(0,4)})()`);
    ok('手機闊度：生意大腦冇橫向溢出：' + p, over.length === 0, over);
  }
  ok('冇頁面程式錯誤', errors.length === 0, errors);
} catch (e) {
  ok('測試冇出錯', false, String(e.stack || e));
} finally {
  try { await send('Browser.close'); } catch { }
  chrome.kill(); srv.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
