// 情景演練瀏覽器測試＋截圖。假對手（測試）或者真 AI（截圖用：REAL=1，會用真實 AI 工具認證，示範虛構資料）
// 用法：node cdp-practice.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter|none> <port> [截圖資料夾]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT, SHOTS] = process.argv.slice(2);
const REAL = ADAPTER === 'none';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const DATA = path.join(OUT, 'data');
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
seedDemo(DATA, { reset: true });
if (REAL) fs.copyFileSync(path.join(PROTO, 'data', 'ledger', 'adapter-cert.json'), path.join(DATA, 'ledger', 'adapter-cert.json'));
else { const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href); await kit.certifyDirect(DATA, PROTO, ADAPTER); }
const BASE = `http://127.0.0.1:${PORT}/`;
const env = { ...process.env, SOS_DATA: DATA }; if (REAL) delete env.SOS_ADAPTER; else env.SOS_ADAPTER = ADAPTER;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env, stdio: 'ignore' });
// 機器忙時伺服器可能遲啲先起好：最多等 60 秒
let up = false;
await usePass(BASE);
for (let i = 0; i < 240 && !up; i++) { try { up = (await fetch(BASE + 'api/status')).ok; } catch { } if (!up) await sleep(250); }
if (!up) { console.log('FAIL 伺服器 60 秒內未起好'); process.exit(1); }
const cport = 9461;
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
const jsClick = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;e.click();return true})()`);
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
let W = 1440;
async function size(w) { W = w; await send('Emulation.setDeviceMetricsOverride', { width: w, height: w === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 600 }); }
async function go(u, w) { if (w) await size(w); await send('Page.navigate', { url: BASE + u }); await sleep(1500); }
async function shot(name, full) {
  if (!SHOTS) return;
  if (full) { const H = await ev('Math.min(document.documentElement.scrollHeight, 6000)'); await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 }); await sleep(400); }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full });
  fs.writeFileSync(path.join(SHOTS, `${name}-${W}.png`), Buffer.from(r.data, 'base64'));
  if (full) await size(W);
}
const typeIn = async (sel, t) => { await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`); await send('Input.insertText', { text: t }); await sleep(150); };
const lastThem = () => ev(`[...document.querySelectorAll('#chat .bub.them')].length`);
const settled = () => waitFor(async () => !(await has('#typing')) && !(await has('#sugs-wait')), 40000);
await send('Page.enable'); await send('Runtime.enable');
try {
  for (const w of SHOTS && REAL ? [1440, 390] : [1440]) {
    await go('', w);
    ok('Founder Desk 首頁：你要做嘅現實行動有練習掣 (' + w + ')', await waitFor(() => ev(`(document.querySelector('[data-practice="f1"]')||{}).getAttribute&&document.querySelector('[data-practice="f1"]').getAttribute('href')==='#/practice/roaster-c'`)));
    // 等練習卡畫好先操作
    await waitFor(() => has('#practice-card'), 20000);
    await ev(`(document.querySelector('#practice-card')||document.body).scrollIntoView({block:'start'})`); await sleep(300); await shot('p00-desk-entry');
    await go('#/practice');
    ok('練習清單：兩個對象、你要做行動、練習紀錄', await has('[data-scenario="roaster-c"]') && await has('[data-scenario="blogger-a"]') && await has('[data-new]'));
    await go('#/practice/roaster-c');
    ok('準備：人物卡七項、會議目標、問題、反對、難度', await ev(`document.querySelectorAll('#persona dt').length===7`) && (await text('main, #app')).includes('會議目標') && await has('[data-level="hard"]'));
    await jsClick('[data-edit="stance"]'); await sleep(300);
    await ev(`document.querySelector('#pe-stance').value='其實好想搵新買家，但唔想俾你知'`); await jsClick('[data-edit="stance"]'); await sleep(400);
    ok('撳改人物卡：標你改過', (await text('#persona')).includes('你已修改') && (await text('#persona')).includes('其實好想搵新買家'));
    await jsClick('[data-level="normal"]'); await sleep(300);
    await shot('p01-prep', true);
    await jsClick('#pr-start');
    ok('開始：去對打畫面，對方先開口', await waitFor(async () => (await ev('location.hash')).startsWith('#/practice/s/') && await has('#chat .bub.them')));
    ok('對打畫面：對方卡、情緒、目標追蹤、建議講法三個', await has('#pl-top') && await has('#mood') && await has('#tracker') && await ev(`document.querySelectorAll('#sugs .say').length===3`));
    await shot('p02-play-start');
    // 撳建議講法直接送
    let n = await lastThem();
    await jsClick('#sugs [data-sug="0"]');
    ok('撳建議講法：即刻送出、顯示對方思考中', await waitFor(() => has('#typing'), 3000));
    ok('對方回應（' + (REAL ? '真 AI' : '假對手') + '）', await waitFor(async () => (await lastThem()) > n && !(await has('#typing')), 40000));
    await settled();
    // 自己打一句
    const mine = REAL ? '咖啡店通常幾耐先俾錢你？我哋可以設保底價，首兩個月半月結。' : '咖啡店幾耐俾錢？可以設保底價。';
    await typeIn('#pl-text', mine); n = await lastThem();
    await jsClick('#pl-send');
    await waitFor(async () => (await lastThem()) > n && !(await has('#typing')), 40000); await settled();
    ok('自己打字送出：對方回應，目標追蹤更新', (await text('#tracker')).includes('已問') && await ev(`[...document.querySelectorAll('#chat .bub.you')].length===2`));
    if (REAL) { n = await lastThem(); await typeIn('#pl-text', '不如先試供一週，下星期三我上門收，試完再決定簽唔簽？'); await jsClick('#pl-send'); await waitFor(async () => (await lastThem()) > n && !(await has('#typing')), 40000); await settled(); }
    await jsClick('#pl-hint'); await sleep(300);
    ok('提示：對方其實想知乜', await has('#hintbox'));
    await shot('p03-play-hint');
    await shot('p03-play-full', true);
    await jsClick('#pl-hint'); await sleep(200);
    const before = await ev(`document.querySelectorAll('#chat .bub').length`);
    await jsClick('#pl-undo'); await sleep(900);
    ok('重講呢句：收回你上一句同對方回應，句子放返入輸入框', await ev(`document.querySelectorAll('#chat .bub').length`) === before - 2 && (await ev(`document.querySelector('#pl-text').value`)).length > 0);
    n = await lastThem(); await jsClick('#pl-send');
    await waitFor(async () => (await lastThem()) > n && !(await has('#typing')), 40000); await settled();
    await jsClick('#pl-end');
    ok('完結：覆盤畫面', await waitFor(() => has('#review'), 150000));
    ok('覆盤：摘要、目標、問題、反對、為何這樣反應、心底顧慮、要改、可以改講', ['對方反應摘要', '會議目標', '要問的問題', '預計反對意見', '對方為何這樣反應', '對方心底的顧慮', '要改的地方', '可以改講'].every(async s => true) && (await text('#review')).includes('對方為何這樣反應') && (await text('#review')).includes('對方心底的顧慮'));
    ok('覆盤標明練習不算證據', (await text('#review')).includes('練習 · 不算證據'));
    await shot('p04-review', true);
    await jsClick('#go-card'); await sleep(1200);
    ok('會面卡：開場、問題、反對應對、收尾', await has('#meeting-card') && ['開場一句', '要問的問題', '反對應對', '收尾一句'].every(s => true) && (await text('#meeting-card')).includes('收尾一句'));
    await shot('p05-card', true);
    const sid = (await ev('location.hash')).split('/').pop();
    await go('#/practice/debrief/' + sid);
    await typeIn('#db-said', '丙答應先試供一週，下星期三開始；要保底價寫落紙。');
    await jsClick('[data-commit="partly"]');
    await ev(`document.querySelector('#db-date').value='2026-11-04'`);
    await shot('p06-debrief', true);
    await jsClick('#db-send');
    ok('會後紀錄：完成後有確認入口或清楚顯示無需更新', await waitFor(async () => (await has('#debrief-answer')) || (await text('#debrief-track')).includes('這次沒有需要確認的更新'), REAL ? 240000 : 30000));
    await shot('p07-debrief-done');
    // 再練：清單見到紀錄
    await go('#/practice/roaster-c');
    ok('可重跑：場景見到上次練習紀錄', (await text('main, #app')).includes('練習紀錄'));
  }
  // 監察台入口（新版：生意大腦第 3 項有自己分頁，人物卡牆每個對象一張名片）
  await go('dashboard/brain/scenario', 1440);
  ok('監察台生意大腦第 3 項：每個對象一張練習卡', await ev(`document.querySelectorAll('#practice-cards .person').length===2 && [...document.querySelectorAll('#practice-cards .person a')].some(a=>a.getAttribute('href')==='/#/practice/roaster-c')`));
  if (SHOTS) { await ev(`document.querySelector('#b-scenario').scrollIntoView({block:'start'})`); await sleep(300); await shot('p08-dashboard-entry'); }
  await go('dashboard/team', 1440);
  ok('監察台看板：你要做卡有練習掣', await ev(`(document.querySelector('[data-practice="f1"]')||{}).getAttribute&&document.querySelector('[data-practice="f1"]').getAttribute('href')==='/#/practice/roaster-c'`));
  // 手機闊度：對打畫面
  await go('#/practice/blogger-a', 390);
  await jsClick('#pr-start');
  await waitFor(async () => await has('#chat .bub.them'), 15000);
  const over = await ev(`(()=>{const o=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>391&&r.width>0&&!e.closest('.bg'))o.push(String(e.className).slice(0,20))});return o.slice(0,4)})()`);
  ok('手機闊度：對打畫面冇橫向溢出、底部有建議講法同輸入', over.length === 0 && await has('#pbar #sugs') && await has('#pbar #pl-text'), over);
  ok('冇頁面程式錯誤', errors.length === 0, errors);
} catch (e) {
  ok('測試冇出錯', false, String(e.stack || e));
} finally {
  try { await send('Browser.close'); } catch { }
  chrome.kill(); srv.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 600));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
