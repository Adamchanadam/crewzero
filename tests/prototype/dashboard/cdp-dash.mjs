// 營運監察台瀏覽器測試（假 AI、示範資料）：深連、對話框、時間線、看板篩選、兩個產品互相入口、達成特效、Founder Desk 交要求全程、手機闊度
// 用法：node cdp-dash.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
seedDemo(DATA, { reset: true });
await kit.certifyDirect(DATA, PROTO, ADAPTER);
const BASE = `http://127.0.0.1:${PORT}/`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
await usePass(BASE);
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + 'api/status')).ok) break; } catch { } await sleep(250); }
const cport = 9441;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
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
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
async function go(u, w = 1440, h = 900) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }); await send('Page.navigate', { url: BASE + u }); await sleep(1600); }
await send('Page.enable'); await send('Runtime.enable');
try {
  await go('dashboard');
  // 一個殼（決定二十五）：Founder Desk 同監察台同一列導航，待決事項分頁就係去 Founder Desk 嘅入口
  ok('公司現況：導航有待決事項分頁（Founder Desk）', await ev(`document.querySelector('nav.tabs a[data-tab="pending"]').getAttribute('href')==='/'`));
  ok('示範標記顯示', (await text('#sample')).includes('示範資料'));
  // 第三版公司現況：完整路徑圖喺業務路徑頁（方案 B），公司現況係壓縮條
  await go('dashboard/path');
  ok('路徑圖（業務路徑頁）：已確認、試行、AI 建議、已撤都有', await ev(`document.querySelectorAll('#pmap .pnode').length>=7 && !!document.querySelector('#pmap .pbadge') && !!document.querySelector('#pmap .pcap') && !!document.querySelector('#pmap .plab.retired')`));
  await go('dashboard');
  ok('壓縮條：全部、每站一格、其他工作；有下一個對外動作小旗', await ev(`document.querySelector('.st-stage[data-scope="all"]')&&document.querySelector('.st-stage[data-scope="other"]')&&document.querySelectorAll('.stages .st-stage').length>=4&&!!document.querySelector('.strip-cap .flag')`));
  // 新版首頁（設計稿 2026-10-28）：待你處理只列三個數同首項，首項得一個主入口去 Founder Desk
  ok('待你處理：三個數、首項一個入口去 Founder Desk', await ev(`(()=>{const a=[...document.querySelectorAll('#needs #todo a')];return document.querySelectorAll('#needs .needn').length===3 && a.length===1 && /^\\/#\\/ask\\//.test(a[0].getAttribute('href'))})()`), await text('#needs'));
  ok('監察台冇作答框', await ev(`!document.querySelector('textarea,input[type=radio],form')`));
  // 示範今日唯一一項係 21:00 AI 開工；過咗 21:00 會變明日；未來兩星期日程已搬去業務路徑頁
  await go('dashboard/path');
  ok('未來兩星期（業務路徑頁）：有逾期同今日（21:00 後係明日）', (await text('#schedule-panel #schedule')).includes('已逾期') && /今日|明日/.test(await text('#schedule-panel #schedule')));
  await go('dashboard');
  ok('十格模組齊、有工作中', await ev(`document.querySelectorAll('.module').length===10 && !!document.querySelector('.module[data-activity="working"]')`));
  await go('dashboard/path');
  await click('#pmap .pnode[aria-label^="1："]');
  ok('點路徑圖節點：開里程碑詳情', (await text('#modal')).includes('完成標準') && (await text('#modal')).includes('深度五問'));
  await click('#modal-close');
  await click('#pmap .pcap button');
  ok('比較：路線比較八欄', await ev(`document.querySelectorAll('#modal .cmp tbody tr').length===8`) && (await text('#modal')).includes('採用後會'));
  await click('#modal-close');
  await go('dashboard');
  // 分類索引嘅格係掣：先開模組對話框，再撳入面第一份產出
  await click('.module[data-mod="artifacts"]');
  await click('#modal .mb a');
  ok('產出物件：打開 AI 產出（Markdown 排版）', await waitFor(async () => (await text('#modal')).includes('農場合作簡介')));
  await click('#modal-close');
  await click('.stages .st-stage:nth-of-type(2)');
  ok('範圍（壓縮條）：揀一站後只顯示呢站', (await ev('location.hash')).length > 1 && await ev(`document.querySelector('.st-stage[aria-pressed="true"]').getAttribute('data-scope')!=='all'`));
  // 深連 #里程碑 預選範圍
  await go('dashboard#m4');
  await click('.module[data-mod="now"]');
  ok('深連 #m4 預選牌照保險', await ev(`document.querySelector('.st-stage[aria-pressed="true"] b').textContent==='牌照保險'`) && (await text('#modal')).includes('牌照保險'), await text('#modal'));
  await click('#modal-close');
  // 業務路徑：時間線
  await go('dashboard/path');
  ok('業務路徑：有兩個入口去 Founder Desk 交要求', await ev(`[...document.querySelectorAll('#reqbar a')].map(a=>a.getAttribute('href')).join()==='/#/request/order,/#/request/adhoc'`));
  await click('#view-timeline');
  ok('時間線：有今日線、試行期、目標日、決定期限、訪問日', await ev(`!!document.querySelector('.tl-today') && !!document.querySelector('.tl-bar') && document.querySelectorAll('.tl-dia').length>=4 && !!document.querySelector('.tl-dl.od') && document.querySelectorAll('.tl-iv').length>=4`));
  ok('時間線：冇日子嘅站放「未定日期」', (await text('#undated')).includes('首條送貨路線'));
  // 團隊：看板
  await go('dashboard/team');
  ok('看板七欄（六個狀態＋里程碑以外）', await ev(`document.querySelectorAll('#kanban .kcol').length===7 && !!document.querySelector('#kanban .kcol[data-col="adhoc"]')`));
  ok('看板唯讀：冇拖拉', await ev(`!document.querySelector('[draggable="true"]')`));
  const allCards = await ev(`document.querySelectorAll('#kanban .kcol:not([data-col="adhoc"]) .kcard').length`);
  await ev(`(()=>{const s=document.querySelector('#kb-ms');s.value='m1';s.dispatchEvent(new Event('change'))})()`); await sleep(500);
  const m1Cards = await ev(`document.querySelectorAll('#kanban .kcol:not([data-col="adhoc"]) .kcard').length`);
  ok('看板按里程碑篩選', m1Cards > 0 && m1Cards < allCards, { allCards, m1Cards });
  ok('里程碑以外唔受篩選影響', await ev(`document.querySelectorAll('#kanban .kcol[data-col="adhoc"] .kcard').length===3`));
  await ev(`(()=>{const s=document.querySelector('#kb-ms');s.value='all';s.dispatchEvent(new Event('change'))})()`); await sleep(500);
  const f1 = await text('.kcard[data-task="f1"]');
  ok('工作卡：你要做、等候中、等候乜、優先原因、完成需你確認', ['你要做', '等候中', '等候：工作「農場丙簽約前資料包」完成', '優先：4 日後到期', '完成需你確認'].every(s => f1.includes(s)), f1);
  ok('外部回覆附預計日期', (await text('.kcard[data-task="t4"]')).includes('農場丙回覆：可否增加供應量（預計'));
  ok('可進行嘅卡有標', (await text('.kcard[data-task="t3"]')).includes('可進行'));
  await ev(`(()=>{const s=document.querySelector('#kb-owner');s.value='founder';s.dispatchEvent(new Event('change'))})()`); await sleep(500);
  ok('篩「你要做」：只剩你嘅現實行動', await ev(`(()=>{const c=[...document.querySelectorAll('#kanban .kcard')];return c.length===4&&c.every(x=>x.classList.contains('mine'))})()`));
  await go('dashboard/path');
  ok('路徑圖（業務路徑頁）：兩站並行有標（經你確認）', (await text('#parallel-band')).includes('並行 2／2') && (await text('#parallel-band')).includes('經你確認'));
  await go('dashboard');
  await click('.module[data-mod="now"]');
  ok('目前工作：顯示你下一個行動', (await text('#modal')).includes('你下一個行動'), await text('#modal'));
  await click('#modal-close');
  await go('dashboard/path');
  ok('日程（業務路徑頁）：你要做嘅行動有日子', (await text('#schedule')).includes('你要做') && (await text('#schedule')).includes('見農場丙簽供應協議'));
  await go('dashboard/path'); await click('#view-timeline');
  ok('時間線：兩站進行期間重疊、你的行動有標', await ev(`document.querySelectorAll('.tl-act').length===2 && document.querySelectorAll('.tl-you').length>=2`));
  // 紀錄、系統
  await go('dashboard/log');
  ok('紀錄：事件清單（每頁 8 項）同搜尋', await ev(`document.querySelectorAll('#log-rows .row-item').length===8 && !!document.querySelector('input[type=search]')`));
  await go('dashboard/system');
  ok('系統：AI 工具同前往設定', await ev(`document.querySelector('#sys-setup').getAttribute('href')==='/#/setup'`));
  // 達成特效：兩次讀回之間里程碑轉已完成先播
  await go('dashboard');
  const st = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
  st.milestones.find(m => m.id === 'm1').state = 'done';
  fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify(st, null, 2));
  ok('里程碑完成：下次讀回播一次達成特效', await waitFor(() => has('.celebrate'), 9000));
  await go('dashboard');
  ok('重新載入唔重播', !(await has('.celebrate')));
  // Founder Desk：頁頭去監察台；交一件臨時工作全程
  await go('');
  ok('Founder Desk 同一列導航有公司現況分頁（營運監察台）', await ev(`document.querySelector('nav.tabs a[data-tab="overview"]').getAttribute('href')==='/dashboard'`));
  ok('Founder Desk 首頁「寫下新情況」有改路線及要 AI 做一件事', await has('#quick-order') && await has('#quick-adhoc'));
  await ev(`location.hash='#/request/adhoc'`); await sleep(1500);
  ok('交要求頁：有說明同文字框', await has('#req-text') && (await text('#req-form')).includes('只計產出'));
  await ev(`document.querySelector('#req-text').focus()`); await send('Input.insertText', { text: '幫我擬一張聖誕節餐廳推廣單張，下星期五前要。' });
  await click('#req-send');
  ok('交咗：顯示進度，AI 擬好問題有作答入口', await waitFor(() => has('#req-answer'), 20000));
  await click('#req-answer');
  ok('一按就去作答該問題包', await waitFor(async () => (await ev('location.hash')).startsWith('#/ask/') && (await ev('document.body.innerText')).includes('測試單張')));
  // 監察台即時見到臨時工作
  await go('dashboard/team');
  ok('監察台看板：里程碑以外見到新臨時工作', (await text('#kanban .kcol[data-col="adhoc"]')).includes('測試推廣單張'));
  // 手機闊度
  for (const t of ['dashboard', 'dashboard/path', 'dashboard/team']) {
    await go(t, 390, 844);
    const over = await ev(`(()=>{const o=[];document.querySelectorAll('body *').forEach(e=>{const r=e.getBoundingClientRect();if(r.right>391&&r.width>0&&!e.closest('.pmap,.tl,.kb,.tabs,.bg'))o.push(e.className)});return o.slice(0,3)})()`);
    ok('手機闊度冇橫向溢出：' + t, over.length === 0, over);
  }
  await go('dashboard', 390, 844);
  // 新版：模組格只有編號、標題、狀態（細節喺對話框）；作業網畫布唔畫、改線性清單
  ok('手機闊度：模組只列標題同一句狀態、冇光流', await ev(`!document.querySelector('.module .mb') && [...document.querySelectorAll('.module')].every(m=>m.querySelector('.mt')&&m.querySelector('.st')) && getComputedStyle(document.querySelector('#orbit')).display==='none' && getComputedStyle(document.querySelector('#arena-list')).display!=='none'`));
  await go('dashboard/path', 390, 844);
  ok('手機闊度：路徑圖（業務路徑頁）變直排清單', await has('#plist'));
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
