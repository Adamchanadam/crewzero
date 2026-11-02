// 全程旅程（瀏覽器，假 AI）：零終端命令
// 用法：node journey.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port> <main|errors>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT, MODE] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 真 AI：JOURNEY_HOST=claude、JOURNEY_SLOW=8（等候時間乘大）、adapter 參數寫 none
const HOST = process.env.JOURNEY_HOST || 'test', SLOW = Number(process.env.JOURNEY_SLOW || 1), REAL = HOST !== 'test';
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
const BASE = `http://127.0.0.1:${PORT}/`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, ...(ADAPTER !== 'none' ? { SOS_ADAPTER: ADAPTER } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
await usePass(BASE);
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + 'api/status')).ok) break; } catch { } await sleep(250); }
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');

const cport = 9361 + (MODE === 'errors' ? 1 : 0);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
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
const text = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
const has = sel => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
async function click(sel) {
  await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(150);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(350);
}
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(500); } return null; }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); }
async function typeInto(sel, value) {
  await ev(`document.querySelector(${JSON.stringify(sel)}).focus()`);
  await send('Input.insertText', { text: value });
  await sleep(80);
}
async function fillIntake() {
  // 虛構公司「從田間到餐桌」（規劃書附錄 C）
  if (!await ev(`document.querySelector('input[name="biz-type"][value="other"]').checked`)) {
    await ev(`document.querySelector('input[name="biz-type"][value="other"]').click()`);
    await waitFor(() => ev(`document.querySelector('input[name="biz-type"][value="other"]').checked`), 4000);
  }
  const vals = ['「從田間到餐桌」把本地小農的當季蔬菜直送餐廳；客戶是注重食材來源的中小型餐廳。',
    '向農場按批採購，向餐廳按週收費，餐廳每週下一次或兩次單。',
    '已認識兩位農場主（甲、乙），口頭有興趣（有人講過），未簽。餐廳未接觸。牌照保險未查。',
    '約第三位農場主（丙）見面。',
    '送貨我自己做；農場我自己談；餐廳我自己 pitch；合規與保險未有人。'];
  for (let i = 0; i < 5; i++) await typeInto('#q' + (i + 1), vals[i]);
}
async function attach(files) {
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#intake-files' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
  await sleep(400);
}
async function setupTest() {
  await click('#go-setup');
  await waitFor(() => has('#certify-go'), 8000);
  await click(`[data-host="${HOST}"]`);
  await click('#certify-go');
  return waitFor(async () => (await has('#setup-done')) || /未通過/.test(await text('#certify h3')), 30000 * SLOW);
}

await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
const f1 = path.join(OUT, '商業模式.md'); fs.writeFileSync(f1, '# 從田間到餐桌：商業模式（創辦人原文，2026-10-01）\n\n「從田間到餐桌」把本地小農的當季蔬菜直送餐廳。客戶是注重食材來源的中小型餐廳。向農場按批採購，向餐廳按週收費，餐廳每週下一次或兩次單。我自己送貨起步，之後再請人。已認識兩位農場主（甲、乙），口頭有興趣，未簽任何東西。餐廳未接觸過。牌照和保險未查。\n');
const f2 = path.join(OUT, '會議紀錄.txt'); fs.writeFileSync(f2, '測試會議：農場主甲有興趣。\n');
const bad = path.join(OUT, '程式.exe'); fs.writeFileSync(bad, 'x');

try {
  await send('Page.navigate', { url: BASE }); await sleep(1800);
  ok('第一次打開：直接去交資料頁', (await ev('location.hash')) === '#/intake', await ev('location.hash'));
  ok('第一次打開：置頂「AI 未設定」', /AI 未設定/.test(await text('#ai-block')));
  ok('交資料頁：有共用頁頭同導航', (await has('.desk-nav')) && /交資料/.test(await text('.eyebrow')));
  ok('交資料頁：5 條必填、選填收埋', (await ev(`document.querySelectorAll('#intake-form .iq-sec + .iq, #intake-form > .iq').length`)) >= 5 && (await has('details.iq-opt')));
  ok('必填未齊：主掣停用', await ev(`document.querySelector('#intake-go').disabled`));
  await shot('j1-intake-first.png');

  if (MODE === 'main') {
    // 設定 AI → 交資料 → 公司概覽 → 確認 → AI 跟進
    const okSetup = await setupTest();
    ok('系統設定：認證通過', okSetup && (await has('#setup-done')), await text('#certify'));
    const certRows = await ev(`(()=>{const all=document.querySelectorAll('#certify .tr-steps > li').length,done=document.querySelectorAll('#certify .tr-ic.done').length;return {all,done}})()`);
    ok('系統設定：逐項顯示通過', certRows && certRows.all >= 8 && certRows.done === certRows.all, { certRows, text: await text('#certify') });
    await shot('j2-setup-passed.png');
    await click('#setup-done');
    await waitFor(async () => (await ev('location.hash')) === '#/intake', 6000);
    ok('設定好之後：阻塞卡消失', !(await has('#ai-block')));
    await fillIntake();
    await attach([f1, f2, bad]);
    ok('文件：收兩份、拒收 .exe 並講原因', (await ev(`document.querySelectorAll('.file-row').length`)) === 2 && /未被接納/.test(await text('#intake-err')), await text('#intake-err'));
    ok('必填齊：主掣可以撳', !(await ev(`document.querySelector('#intake-go').disabled`)));
    await shot('j3-intake-filled.png');
    await click('#intake-go');
    ok('回覆盒：列出答案同文件', /商業模式\.md/.test(await text('.modal')) && /1\./.test(await text('.modal')));
    await click('#intake-confirm');
    const moved = await waitFor(async () => (await ev('location.pathname')) === '/proofread.html', 40000 * SLOW);
    ok('AI 擬好公司概覽：自動轉去公司概覽', !!moved, await ev('location.href'));
    await sleep(1500);
    ok('公司概覽：顯示 AI 擬嘅公司', /從田間到餐桌/.test(await text('h1')), await text('h1'));
    ok('公司概覽：有共用頁頭導航', await has('.desk-nav'));
    await shot('j4-company.png');
    await click('#go-main');
    await click('#do-confirm');
    const fin = await waitFor(async () => /✓ 完成|未完成/.test(await text('#track')), 40000 * SLOW);
    ok('成頁確認：AI 跟進完成', fin && /✓ 完成/.test(await text('#track')), await text('#track'));
    ok('AI 跟進：有新問題包' + (REAL ? '（真 AI 只記錄）' : ''), REAL || /AI 追問/.test(await text('#track')), await text('#track'));
    await shot('j5-followup.png');
    await send('Page.navigate', { url: BASE }); await sleep(1500);
    ok('待決事項：AI 問題包排第一' + (REAL ? '（真 AI 只記錄）' : ''), (await ev('location.hash')) !== '#/intake' && (REAL || (await text('.desk-count')) === String(1 + (fs.readdirSync(path.join(DATA, 'asks')).filter(f => { try { return !!JSON.parse(fs.readFileSync(path.join(DATA, 'asks', f), 'utf8')).depth; } catch { return false; } }).length))), await text('.desk-count'));
    ok('交資料檔已整理（收件匣清空）', fs.readdirSync(path.join(DATA, 'founder', 'inbox')).length === 0);
  } else {
    // 出錯出口：AI 未設定（先交資料後設定）→ 自動續做；AI 失敗 → 重試；AI 超時 → 重試
    await fillIntake();
    await attach([f1]);
    await click('#intake-go');
    await click('#intake-confirm');
    const w = await waitFor(async () => /AI 未設定/.test(await text('#track h3')), 20000);
    ok('AI 未設定：交資料記低、等 AI 設定', !!w, await text('#track'));
    ok('AI 未設定：有「前往設定」', /前往設定/.test(await text('#track')));
    await shot('e1-waiting.png');
    await send('Page.navigate', { url: BASE + '#/setup' }); await sleep(1500);
    await click('[data-host="test"]');
    await click('#certify-go');
    await waitFor(() => has('#setup-done'), 30000);
    await send('Page.navigate', { url: BASE + '#/intake' }); await sleep(800);
    const cont = await waitFor(async () => (await ev('location.pathname')) === '/proofread.html', 40000);
    ok('設定好之後自動續做：轉去公司概覽', !!cont, await ev('location.href') + ' ' + await text('#track'));

    // AI 失敗 → 重試
    mode('intake:fail');
    await send('Page.navigate', { url: BASE + '#/intake' }); await sleep(1200);
    await click('#reintake');
    await fillIntake();
    await click('#intake-go'); await click('#intake-confirm');
    const failed = await waitFor(async () => (await has('#intake-retry')), 30000);
    ok('AI 失敗：顯示原因同重試', failed && /原因/.test(await text('#track')), await text('#track'));
    await shot('e2-failed.png');
    ok('AI 失敗：原因係中文、有下一步（重試、重新認證），冇「未知」', /AI 工具未能完成這項工作/.test(await text('#track')) && /重新認證/.test(await text('#track')) && !/未知/.test(await text('#track')), await text('#track'));
    // 按「重試」時連唔到電腦上嘅 CrewZero：要喺畫面講原因，唔可以撳咗冇反應
    await ev(`(()=>{window.__rf=window.fetch;window.fetch=function(u){return String(u).indexOf('/api/retry')>=0?Promise.reject(new TypeError('Failed to fetch')):window.__rf.apply(this,arguments)};return 1})()`);
    await click('#intake-retry');
    const retryToast = await ev(`(()=>{const e=document.getElementById('toast');return e&&!e.hidden?e.textContent:''})()`);
    ok('重試失敗：畫面顯示中文原因同做法，冇英文', /未能重試/.test(retryToast) && /未能連上/.test(retryToast) && !/Failed to fetch/.test(retryToast), retryToast);
    await ev('window.fetch=window.__rf;1');
    await click('#intake-retry');
    const re = await waitFor(async () => (await ev('location.pathname')) === '/proofread.html', 40000);
    ok('重試：完成並轉去公司概覽', !!re);

    // AI 超時 → 重試（測試 AI 限時 1 分鐘）
    mode('intake:timeout');
    await send('Page.navigate', { url: BASE + '#/intake' }); await sleep(1200);
    await click('#reintake');
    await fillIntake();
    await click('#intake-go'); await click('#intake-confirm');
    const to = await waitFor(async () => (await has('#intake-retry')), 100000);
    ok('AI 超時：顯示原因同重試', to && /處理時間過長/.test(await text('#track')), await text('#track'));
    await click('#intake-retry');
    const re2 = await waitFor(async () => (await ev('location.pathname')) === '/proofread.html', 40000);
    ok('超時重試：完成', !!re2);
  }
  ok('頁面冇程式錯誤', errors.length === 0, errors.slice(0, 5));
  // 剛轉頁時 body 可能未建好：等到有 body 先讀
  await waitFor(async () => await ev('!!document.body'), 10000);
  ok('頁面冇「null／undefined」字', !/\bnull\b|undefined|\[object/.test(await ev('document.body.innerText')));
} catch (e) {
  ok('測試中斷', false, String(e && e.stack || e));
} finally {
  try { await send('Browser.close'); } catch { }
  setTimeout(() => { try { chrome.kill(); } catch { } srv.kill(); }, 300);
}
fs.writeFileSync(path.join(OUT, 'server-log.txt'), srvLog);
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
setTimeout(() => process.exit(0), 900);
