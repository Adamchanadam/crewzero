// 新版面驗收（直接開 file://）：一個大掣、三張決定卡、其餘收埋、全文仍可改、預覽四行、手機、換公司
// 用法：node cdp-test2.mjs <chrome.exe> <輸出資料夾> <proofread.html file URL> <第二間公司資料 file URL>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [CHROME, OUT, PAGE, ALT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(path.dirname(fileURLToPath(new URL(PAGE))), 'names.js'));
const DL = path.join(OUT, 'downloads');
freshTestOut(OUT);
fs.mkdirSync(DL, { recursive: true });
const port = 9361;
const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
async function json(u) { for (let i = 0; i < 60; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { } await sleep(250); } throw new Error('devtools'); }
const pageT = (await json(`http://127.0.0.1:${port}/json/list`)).find(t => t.type === 'page');
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
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
try { await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }); } catch { await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL }); }
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(expr + ' -> ' + r.exceptionDetails.exception?.description); return r.result.value; };
const shot = async (name, full = false) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
async function metrics(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}
async function nav(u) { await send('Page.navigate', { url: u }); await sleep(900); }
async function fresh(u) { await nav(u); await ev('localStorage.clear()'); await nav(u); }
const rect = sel => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,top:r.top,h:r.height};})()`);
async function center(sel) {
  const ok1 = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return false; e.scrollIntoView({block:'center'}); return true;})()`);
  if (!ok1) throw new Error('搵唔到 ' + sel);
  await sleep(120); return rect(sel);
}
async function click(sel) {
  const r = await center(sel);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(220);
}
async function tap(sel) {
  const r = await center(sel);
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}
async function scrollTo(sel) { await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start'})`); await sleep(200); }
async function drag(handleSel, targetSel, touch) {
  await ev(`(()=>{document.querySelector(${JSON.stringify(targetSel)}).scrollIntoView({block:'start'}); window.scrollBy(0,-90);})()`);
  await sleep(200);
  // 拖柄由上端起拖（新字級令卡同拖柄變高；正中可能被底部固定列遮住，真人會按露出嚟嗰段）
  const a = await rect(handleSel), b = await rect(targetSel);
  a.y = Math.min(a.y, a.top + 24);
  const toY = b.top + 8, steps = 24;
  if (touch) await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 }); }
  for (let i = 1; i <= steps; i++) {
    const y = a.y + (toY - a.y) * i / steps;
    if (touch) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x, y }] });
    else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y, button: 'left', buttons: 1 });
    await sleep(25);
  }
  if (touch) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: toY, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(400);
}
const text = sel => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText||''`);
const order = () => ev(`[...document.querySelectorAll('#stations > li')].map(l=>l.dataset.mid).join(',')`);
const prog = () => text('.prog-n');
const downloads = () => fs.readdirSync(DL).filter(f => f.endsWith('.md'));

try {
  /* ---------- 桌面 ---------- */
  await metrics(1440, 900, false);
  await fresh(PAGE);
  ok('載入公司名（虛構樣本）', (await text('h1')) === '月月鮮烘');
  ok('頂部大掣「採用 AI 建議並開始」', (await text('#go-main')) === N.ui.adoptStart);
  ok('只有 3 張「要你決定」卡', (await ev(`document.querySelectorAll('.dq').length`)) === 3);
  ok('三張卡係規劃書 3.1 嘅三條（而家去到邊、下一步、本季目標）', await ev(`['dq-status','dq-next-action','dq-goal-quarter'].every(i=>document.getElementById(i))`));
  ok('進度：要你決定：已答 0／3', (await prog()) === '請你先決定：已答 0／3', await prog());
  ok('「未答」標記只得 3 個', (await ev(`document.querySelectorAll('.tag.qn').length`)) === 3);
  ok('全文預設收埋（第一眼唔見細項）', !(await ev(`!!document.getElementById('layer1')`)));
  ok('收埋區直接見到五站路線', (await ev(`document.querySelectorAll('#rest .route .stop').length`)) === 5);
  ok('收埋區見到 AI 權限「確認後即刻生效」', (await text('#rest')).includes('確認後即時生效'));
  ok('冇「撳開睇」空標題', !(await ev(`document.body.innerText`)).includes('撳開睇'));
  ok('冇每項「啱，照用」掣', (await ev(`document.querySelectorAll('.q-ok').length`)) <= 1);
  await shot('d1-top.png');
  await shot('d1-full.png', true);
  await click('.prog-top .btn.small');
  ok('「下一條」跳去第一張未答卡', (await ev(`document.activeElement?.id`)) === 'dq-status', await ev(`document.activeElement?.id`));
  // 卡 2：下一步揀第二個
  await click('#dq-next-action > .opt:nth-of-type(2)');
  ok('揀選項即算答咗', (await prog()) === '請你先決定：已答 1／3');
  ok('頂部說明跟住下一步改', (await text('.hero-p')).includes('完成網上收款及寄送設定'));
  ok('大掣變「其餘採用 AI 建議並開始」', (await text('#go-main')) === N.ui.adoptRestStart);
  // 卡 1：而家去到邊，撳一項再揀程度
  await click('#dq-status .chip');
  ok('撳咗嘅項目出程度選擇', (await ev(`document.querySelectorAll('#dq-status .grade-row').length`)) === 1);
  await click('#dq-status .grade-row .seg:nth-of-type(2)');
  ok('程度改為「實際行動」（以前叫有人做過）', (await text('#dq-status .grade-row .seg.on')) === '實際行動');
  ok('而家去到邊算答咗', (await prog()) === '請你先決定：已答 2／3');
  // 卡 3：期限用快捷鍵改，再揀 AI 建議目標
  await click('#dq-goal-quarter [data-k="q~goal-quarter-due"]');
  ok('期限有日曆欄', await ev(`!!document.querySelector('#dq-goal-quarter .panel input[type=date]')`));
  await click('#dq-goal-quarter .panel .opt:nth-of-type(3)');
  await click('#dq-goal-quarter > .opt:nth-of-type(1)');
  ok('三條都答咗', (await prog()) === '✓ 要你先決定的事已全部作答', await prog());
  ok('大掣變「確認並開始」', (await text('#go-main')) === '確認並開始');
  // 自己寫
  await click('#dq-next-action .dq-foot .btn.small');
  await click('#dq-next-action textarea');
  await send('Input.insertText', { text: '先完成收款及寄送設定，再安排工房丙試供' });
  await click('#dq-next-action .p-foot .btn.primary');
  ok('自己寫嘅答案顯示出嚟', (await text('#dq-next-action .dq-custom')).includes('先完成收款及寄送設定'));
  await scrollTo('.decide'); await shot('d2-answered.png');
  // 打開全文
  await click('#rest-toggle');
  ok('撳「睇或者改」見到全文三部分', await ev(`['layer1','layer2','layer3'].every(i=>document.getElementById(i))`));
  await click('#layer2 .layer-toggle');
  ok('全文：五站', (await order()).split(',').length === 5);
  await drag('[data-h="m4"]', '[data-mid="m2"]', false);
  ok('滑鼠拖排：第 4 站上咗第 2', (await order()) === 'm1,m4,m2,m3,m5', await order());
  ok('拖完記低（第二層顯示已調整）', (await text('#layer2 .lt-sum')).includes('已調整'));
  await click('[data-mid="m1"] .st-main > .btn.small');
  await click('[data-k="w~m1-d2"]');
  await click('.panel textarea');
  await send('Input.insertText', { text: '教育業務經理拍板，大約一個月' });
  await click('.panel .p-foot .btn.primary');
  ok('補答後第 1 站唔再待深化', !(await text('[data-mid="m1"] .st-badges')).includes('待深化'));
  await click('[data-k="m~m1-target"]');
  await ev(`document.querySelector('.panel .p-date input').value='2026-11-30'`);
  await click('.panel .p-date .btn.primary');
  ok('日曆揀日：顯示 11 月 30 日（一）', (await text('[data-k="m~m1-target"]')).includes('11 月 30 日（一）'));
  await click('#layer3 .layer-toggle');
  ok('第三層缺少資料清單', (await ev(`document.querySelectorAll('#missing .miss-item').length`)) >= 1);
  // 預覽
  await click('#go-main');
  const sum = await text('.m-sum');
  ok('預覽四行：下一步、目標、路線、AI 權限', ['下一步', N.field.G1, '路線'].every(x => sum.includes(x)) && sum.includes(N.field.G7), sum);
  ok('預覽講明 AI 權限一定先問你', sum.includes('必須先詢問你'));
  ok('離線時預覽講明未連上 AI', (await text('.modal .warn')).includes('未連接 CrewZero'));
  const pre = await ev(`document.querySelector('pre.file').textContent`);
  ok('回覆檔：kind proofread、記低次序改動同日子', pre.startsWith('kind: proofread') && pre.includes('"orderChanged": true') && pre.includes('"value": "2026-11-30"'));
  await shot('d3-modal.png');
  await click('#do-confirm');
  await sleep(1200);
  ok('離線下載咗回覆檔', downloads().length === 1, downloads());
  ok('確認後提示（離線，AI 未收到）', (await text('.notice')).includes('Zero 尚未收到'));
  await nav(PAGE);
  ok('重開保留答案', (await prog()) === '✓ 要你先決定的事已全部作答');

  /* ---------- 手機 ---------- */
  await metrics(390, 844, true);
  await fresh(PAGE);
  ok('手機：冇橫向捲動', await ev(`document.documentElement.scrollWidth <= innerWidth`));
  ok('手機：底部大掣夠高', (await ev(`document.querySelector('.cbar .btn.primary').getBoundingClientRect().height`)) >= 44);
  ok('手機：頂部唔重複出大掣', (await ev(`document.getElementById('go-main').getBoundingClientRect().height`)) === 0);
  await shot('m1-top.png');
  await tap('#dq-next-action > .opt:nth-of-type(1)');
  await tap('#dq-status .chip');
  ok('手機：撳卡即答', (await prog()) === '請你先決定：已答 2／3');
  await scrollTo('#dq-status'); await shot('m2-cards.png');
  await tap('#rest-toggle');
  await tap('#layer2 .layer-toggle');
  await drag('[data-h="m2"]', '[data-mid="m1"]', true);
  ok('手機：手指拖排', (await order()) === 'm2,m1,m3,m4,m5', await order());
  ok('手機：打開全文後都冇橫向捲動', await ev(`document.documentElement.scrollWidth <= innerWidth`));
  await tap('.cbar .btn.primary');
  ok('手機：預覽全屏', (await ev(`document.querySelector('.modal').getBoundingClientRect().width`)) >= 389);
  await shot('m3-modal.png');
  await tap('#do-confirm');
  await sleep(1200);
  ok('手機：下載咗回覆檔', downloads().length === 2);

  /* ---------- 換公司（冇 decide 設定，靠通用規則） ---------- */
  await metrics(1440, 900, false);
  await fresh(PAGE.split('?')[0] + '?data=' + encodeURIComponent(ALT));
  ok('換公司：顯示從田間到餐桌', (await text('h1')) === '從田間到餐桌');
  ok('換公司：自動揀出 3 張卡（而家去到邊、下一步、本季目標）', await ev(`['dq-status','dq-g5','dq-g1'].every(i=>document.getElementById(i))`));
  await click('#rest-toggle');
  await click('#layer3 .layer-toggle');
  ok('換公司：冇「null／undefined」程式字', !/null|undefined|\[object/.test(await ev(`document.body.innerText`)));
  await shot('a1-other.png');
  ok('冇頁面錯誤', errors.length === 0, errors.slice(0, 5));
} catch (e) {
  ok('測試中斷', false, String(e && e.stack || e));
} finally {
  try { await send('Browser.close'); } catch { }
  setTimeout(() => proc.kill(), 500);
}
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
setTimeout(() => process.exit(0), 800);
