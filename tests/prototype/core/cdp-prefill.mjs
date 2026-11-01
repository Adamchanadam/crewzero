// 交資料「由文件預填」頁面測試（瀏覽器，假 AI）：逐條確認、改寫即變你寫的、未確認唔可以送出、重開頁面保留狀態
// 用法：node cdp-prefill.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true }); // 重試時上一次嘅 Chrome 可能未放手
const DATA = path.join(OUT, 'data');
const BASE = `http://127.0.0.1:${PORT}/`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; });
await usePass(BASE);
for (let i = 0; i < 240; i++) { try { if ((await fetch(BASE + 'api/status')).ok) break; } catch { } await sleep(250); }

const cport = Number(PORT) + 1;
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
const val = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).value||''`);
async function click(sel) {
  await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`); await sleep(150);
  const r = await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(350);
}
async function waitFor(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(500); } return null; }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); }
async function typeEnd(sel, value) { await ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});t.focus();t.setSelectionRange(t.value.length,t.value.length)})()`); await send('Input.insertText', { text: value }); await sleep(120); }
async function attach(files) {
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#intake-files' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
  await sleep(400);
}
const PLAN = '# 計劃書\n\n我們替社區洗衣店收集和配送衣物。\n\n客戶按月付款，每月最少收集四次。\n';
const f1 = path.join(OUT, '計劃書.md'); fs.writeFileSync(f1, PLAN);
const f2 = path.join(OUT, '會議紀錄.txt'); fs.writeFileSync(f2, '與兩間洗衣店店主會面，兩間都願意試用一個月。\n');

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const c0 = await fetch(BASE + 'api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE.slice(0, -1) }, body: JSON.stringify({ action: 'certify', host: 'test' }) });
  ok('假 AI 認證開始', c0.status === 202, c0.status);
  await waitFor(async () => { const s = await (await fetch(BASE + 'api/setup')).json(); return s.certify && s.certify.state !== 'running'; });
  await send('Page.navigate', { url: BASE + '#/intake' }); await sleep(1800);
  ok('交資料頁：文件區排喺題目之前，有「由文件預填」掣', await ev(`(()=>{const b=document.querySelector('#pf-go'),q=document.querySelector('#q1');return !!b&&!!q&&!!(b.compareDocumentPosition(q)&Node.DOCUMENT_POSITION_FOLLOWING)})()`));
  ok('未加文件：「由文件預填」停用', await ev(`document.querySelector('#pf-go').disabled`));
  // 創辦人已經寫咗第 2 題：預填唔可以覆蓋
  const mine2 = '我們按月收費。';
  await typeEnd('#q2', mine2);
  await attach([f1, f2]);
  ok('加入文件之後可以按', !(await ev(`document.querySelector('#pf-go').disabled`)));
  await click('#pf-go');
  ok('按咗之後：顯示 AI 讀緊文件', (await text('#pf-state')).includes(N.ui.prefillRunning) || (await text('#pf-state')).includes('已按文件預填'), await text('#pf-state'));
  const done = await waitFor(async () => /已按文件預填/.test(await text('#pf-state')), 60000);
  ok('預填完成：講明預填咗幾多條', !!done, await text('#pf-state'));
  const rec = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'prefill', fs.readdirSync(path.join(DATA, 'ledger', 'prefill'))[0]), 'utf8')).answers;
  await shot('pf1-filled.png');
  ok('空格填入預填：第 1、3、5 題', (await val('#q1')) === rec.q1.text && (await val('#q3')) === rec.q3.text && (await val('#q5')) === rec.q5.text, { q1: await val('#q1'), q3: await val('#q3') });
  ok('已經寫咗嘅第 2 題唔覆蓋，只顯示「用這句」建議', (await val('#q2')) === mine2 && (await has('[data-pf-use="q2"]')) && (await text('#pf-q2')).includes(rec.q2.text.slice(0, 10)), await text('#pf-q2'));
  // 硬規矩：每條預填都標「AI 按文件預填」連出處
  const rows = {}; for (const q of ['q1', 'q2', 'q3', 'q5']) rows[q] = await text('#pf-' + q);
  ok('每條預填都標「AI 按文件預填」連文件出處', Object.values(rows).every(t => t.includes('AI 按文件預填') && t.includes('出自《')), rows);
  ok('原句標「待確認」；推斷標「不是原句」（第 3 題 AI 扮原句都照標推斷）', rows.q1.split('\n')[0] === N.ui.prefillTagQuote && rows.q3.split('\n')[0] === N.ui.prefillTagInferred && rows.q2.includes(N.ui.prefillTagInferred), rows);
  ok('文件冇講嘅第 4 題：叫你自行填寫', (await text('#pf-q4')).includes(N.ui.prefillNone), await text('#pf-q4'));
  ok('未確認之前畫面冇「你原話」', !(await text('#intake-form')).includes('你原話'));
  ok('送出條：講明幾多條未確認，主掣停用', (await text('#pf-wait')) === N.t('prefillPending', { n: 3 }) && (await ev(`document.querySelector('#intake-go').disabled`)), await text('#cbar'));
  // 預填嘅提示同標籤（文件清單係創辦人自己嘅檔名，唔喺呢度掃）
  const hits = N.styleIssues(await ev(`[...document.querySelectorAll('#pf-box, .pf-row')].map(e => e.innerText).join('\\n')`));
  ok('預填畫面文字：用字檢查零命中', !hits.length, hits);
  // 逐條處理
  await click('[data-pf-confirm="q1"]');
  const docOf = f => f.replace(/\.\w+$/, '');
  ok('確認第 1 題：先變「你原話 · 出自《文件》」', (await text('#pf-q1')).includes(N.t('srcYouDoc', { f: docOf(rec.q1.source) })), await text('#pf-q1'));
  await click('[data-pf-use="q2"]');
  ok('第 2 題「用這句」：換成預填，標「AI 建議 · 你已認同」，唔係你原話', (await val('#q2')) === rec.q2.text && (await text('#pf-q2')).includes(N.ui.srcAdopted) && !(await text('#pf-q2')).includes('你原話'), await text('#pf-q2'));
  await typeEnd('#q3', '（按實際情況改寫）');
  ok('改寫第 3 題：變你自己寫，預填只留作建議', (await has('[data-pf-use="q3"]')) && !(await has('[data-pf-confirm="q3"]')), await text('#pf-q3'));
  await typeEnd('#q4', '社區洗衣店店主。');
  await click('[data-pf-confirm="q5"]');
  ok('全部處理好：主掣可以按', !(await has('#pf-wait')) && !(await ev(`document.querySelector('#intake-go').disabled`)), await text('#cbar'));
  await shot('pf2-confirmed.png');
  // 重開頁面：狀態留喺草稿
  await send('Page.reload', { ignoreCache: true }); await sleep(1800);
  await waitFor(async () => /已按文件預填/.test(await text('#pf-state')), 15000);
  ok('重開頁面：確認狀態同改寫都保留', (await text('#pf-q1')).includes('你原話') && (await text('#pf-q2')).includes(N.ui.srcAdopted) && (await has('[data-pf-use="q3"]')) && !(await ev(`document.querySelector('#intake-go').disabled`)), { q1: await text('#pf-q1'), q3: await text('#pf-q3') });
  await click('#intake-go');
  const modal = await text('.modal');
  await shot('pf3-modal.png');
  const li = await ev(`[...document.querySelectorAll('.modal .m-sum li')].map(l=>l.innerText)`);
  ok('確認框：每條答案標來源（文件原句／AI 建議／你原話）', li[0].includes(N.t('srcYouDoc', { f: docOf(rec.q1.source) })) && li[1].includes(N.ui.srcAdopted) && li[2].endsWith(N.ui.srcYou) && li[3].endsWith(N.ui.srcYou) && li[4].includes('你原話 · 出自《'), li);
  await click('#intake-confirm');
  const it = await waitFor(async () => { const s = await (await fetch(BASE + 'api/status')).json(); return s.intake && (s.intake.state === 'done' || s.intake.state === 'failed') ? s.intake : null; });
  ok('送出：交 AI 擬公司概覽完成', it && it.state === 'done', it);
  const mdFile = fs.readdirSync(path.join(DATA, 'archive'), { recursive: true }).map(String).find(f => f.endsWith('-intake.md'));
  const mc = JSON.parse((fs.readFileSync(path.join(DATA, 'archive', mdFile), 'utf8').match(/```json\s*([\s\S]*?)```\s*$/) || [, '{}'])[1]);
  const pv = mc.provenance || {};
  ok('伺服器記低嘅來源同畫面一致', pv.q1.kind === 'quote' && pv.q2.kind === 'adopted' && pv.q3.kind === 'founder' && pv.q4.kind === 'founder' && pv.q5.kind === 'quote', pv);
  const sc = spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'prefill-scan.mjs'), DATA], { encoding: 'utf8' });
  ok('掃描：「你原話」標籤零違規', sc.status === 0, sc.stdout + sc.stderr);
  ok('頁面冇程式錯誤', !errors.length, errors);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  try { ws.close(); } catch { } chrome.kill(); srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), srvLog);
  process.exit(pass === results.length ? 0 : 1);
}
