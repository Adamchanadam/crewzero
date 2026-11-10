// 階段 B 頁面測試（瀏覽器，假 AI）：今日要做的事卡、上次離開之後、待決事項次序／圖示／逾期、確認掣字眼同外殼一致、真實進展頁只看紀錄、首頁告訴 Zero 附文件、現在開工
// 用法：node cdp-desk-b.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const { seedCompany } = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const { oldInstall } = await import(new URL('../fixtures/old-install.mjs', import.meta.url).href);
const lib = await import(new URL('file:///' + path.join(PROTO, 'ask-lib.mjs').replace(/\\/g, '/')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true }); // 重試時上一次嘅 Chrome 可能未放手
// 兩個資料夾：A 未確認公司概覽；B 已確認（舊安裝夾具）
const DA = path.join(OUT, 'data-a'), DB = path.join(OUT, 'data-b');
fs.mkdirSync(DA, { recursive: true }); seedCompany(DA, PROTO);
fs.mkdirSync(DB, { recursive: true }); oldInstall(DB, PROTO);
const PA = Number(PORT), PB = Number(PORT) + 2;
const logs = {};
function server(DATA, port) {
  const s = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  logs[port] = ''; s.stdout.on('data', d => { logs[port] += d; }); s.stderr.on('data', d => { logs[port] += d; });
  return s;
}
const srvA = server(DA, PA), srvB = server(DB, PB);
const api = (port, p, body) => fetch(`http://127.0.0.1:${port}${p}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` }, body: JSON.stringify(body) } : {}).then(async r => { let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; });
for (const port of [PA, PB]) await usePass(`http://127.0.0.1:${port}`);
for (const port of [PA, PB]) for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/status`)).ok) break; } catch { } await sleep(250); }
async function certify(port) { await api(port, '/api/setup', { action: 'certify', host: 'test' }); for (let i = 0; i < 120; i++) { const s = (await api(port, '/api/setup')).j; if (s.certify && s.certify.state !== 'running') return s.certify.state; await sleep(500); } }

const cport = Number(PORT) + 5;
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
async function waitFor(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(500); } return null; }
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); }
const go = async url => { await send('Page.navigate', { url }); await sleep(1800); };
const seenAt = DATA => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'founder', 'desk', 'last-seen.json'), 'utf8')).at; } catch { return ''; } };
const scanText = async sels => { const t = await ev(`[${sels.map(s => JSON.stringify(s)).join(',')}].map(s=>[...document.querySelectorAll(s)].map(e=>e.innerText).join('\\n')).join('\\n')`); return N.styleIssues(t); };
// 按日曆日加減
const now = new Date(), shift = d => { const x = new Date(now); x.setDate(x.getDate() + d); return x; };
const ago = d => lib.localIso(shift(-d)), day = d => lib.localIso(shift(d)).slice(0, 10);
const pack = (DATA, id, extra, askedAt) => fs.writeFileSync(path.join(DATA, 'asks', id + '.json'), JSON.stringify({ id, title: '測試：' + id.replace(/^ask-/, ''), askedBy: 'AI', askedAt, questions: [{ id: 'a', ask: '這一項照建議處理嗎？', kind: 'choice', options: [{ text: '照建議', rec: true }, { text: '暫緩' }], value: '照建議', effect: 'tentative', priority: 1 }], ...extra }));

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  ok('假 AI 認證（兩個資料夾）', (await certify(PA)) === 'passed' && (await certify(PB)) === 'passed');

  /* A：未確認公司概覽 → 今日要做的事＝校對；第一次打開冇「上次離開之後」；沒有內容時不顯示該行；輪詢唔算打開 */
  const A = `http://127.0.0.1:${PA}/`;
  await usePass(A, { send });
  await go(A);
  ok('今日要做的事卡：待校對公司概覽，入口去校對', (await ev(`(document.querySelector('#today-card')||{}).dataset.key`)) === 'proofread' && (await ev(`document.querySelector('#today-go').getAttribute('href')`)) === '/proofread.html', await text('#today-card'));
  ok('今日要做的事卡：一句要做的事、一句不會自動發生，文字來自 FIRST-WEEK.md', /檢視 Zero 擬定的公司概覽/.test(await text('#today-do')) && (await text('#today-not')).startsWith(N.ui.todayNotAuto), await text('#today-card'));
  ok('第一次打開冇「上次離開之後」', !(await has('#since')));
  const at1 = seenAt(DA);
  ok('打開待決事項：記低今次時間', !!at1, at1);
  await sleep(9500); // 首頁輪詢最少一次
  ok('輪詢唔算打開：時間冇變', seenAt(DA) === at1, { at1, now: seenAt(DA) });
  await send('Page.reload', { ignoreCache: true }); await sleep(1800);
  ok('再打開：仍記低上次打開時間，「上次離開之後」只放 Zero 開工卡內', seenAt(DA) !== at1 && await has('#run-strip') && !(await has('#since')) && !(await has('#back-after')), { at1, now: seenAt(DA), runStrip: await text('#run-strip') });
  ok('沒有新事項時不顯示「上次離開之後」或「沒有新事項」', !(await text('#run-strip')).includes(N.dash.since) && !(await text('#run-strip')).includes('沒有新事項'), await text('#run-strip'));
  await shot('b1-hub-proofread.png');

  /* B：已確認 → 次序、圖示、逾期；未有首次訪問日期先等待 */
  pack(DB, 'ask-old', { todoType: 'decision' }, ago(10));
  pack(DB, 'ask-trial', { todoType: 'trial', due: day(-2) }, ago(1));
  pack(DB, 'ask-q', { todoType: 'question' }, ago(2));
  pack(DB, 'ask-next', { todoType: 'question', next: { task: '按創辦人答案整理一份測試清單。' }, afterConfirm: 'AI 會按答案整理清單' }, ago(3));
  pack(DB, 'ask-plain', { todoType: 'question', next: null }, ago(4));
  const B = `http://127.0.0.1:${PB}/`;
  await usePass(B, { send });
  await go(B + '#/');
  const asks = (await api(PB, '/api/asks')).j;
  const want = asks.todo.map(t => t.id);
  ok('伺服器次序：逾期決定 > 試行到期 > 其餘（逾期日數先）', want[0] === 'ask-old' && want[1] === 'ask-trial', want);
  const firstRow = '#next-list [data-todo]';
  ok('「接下來」首項＝次序第一個問題包，標類型同逾期', /測試：old/.test(await text(firstRow)) && (await text(firstRow)).includes(N.dash.ty_decision) && /已逾期 3 日/.test(await text(firstRow)), await text(firstRow));
  const rows = await ev(`[...document.querySelectorAll('#next-list [data-todo], #other-pending [data-todo]')].map(r=>({id:r.dataset.todo,type:r.dataset.type,ic:(r.querySelector('.ic')||{}).textContent,t:r.textContent}))`);
  ok('其他待決事項：同伺服器次序一致', JSON.stringify(rows.map(r => r.id)) === JSON.stringify(want), { rows: rows.map(r => r.id), want });
  ok('每項有類型圖示同類型名稱', rows.every(r => r.ic === N.TODO_ICON[r.type] && r.t.includes(N.dash['ty_' + r.type])), rows);
  ok('試行到期：標「已逾期 2 日」', /已逾期 2 日/.test((rows.find(r => r.id === 'ask-trial') || {}).t || ''), rows.find(r => r.id === 'ask-trial'));
  const otherSummary = await ev(`(()=>{const d=document.querySelector('#other-pending'),s=d&&d.querySelector('summary .sum-line'),names=d?[...d.querySelectorAll('[data-todo] .t')].map(x=>{const c=x.cloneNode(true),i=c.querySelector('.ic');if(i)i.remove();return c.textContent.trim()}):[];return {text:s&&s.textContent,names}})()`);
  ok('其他待決事項的摺疊標題列出收起各項名稱', otherSummary && otherSummary.names.length > 0 && otherSummary.names.every(n => otherSummary.text.includes(n)), otherSummary);
  // 首次訪問未到但有待決事項：今日主線是作答，首張待決事項就是主卡，不另放今日卡
  const sfB = path.join(DB, 'ledger', 'state.json');
  const home = (await api(PB, '/api/home')).j;
  ok('有待決事項而首次訪問未到：指引改為處理待決事項並連到首項，頁面不另放今日卡', home.card.key === 'daily' && home.card.href === '#/ask/' + want[0] && !(await ev(`!!document.querySelector('#today-card')`)), { card: home.card });
  fs.mkdirSync(path.dirname(sfB), { recursive: true }); const stateB = fs.existsSync(sfB) ? JSON.parse(fs.readFileSync(sfB, 'utf8')) : {}; stateB.interviews = { ...(stateB.interviews || {}), nextOn: '2099-01-05' }; fs.writeFileSync(sfB, JSON.stringify(stateB, null, 2));
  pack(DB, 'ask-first-interview', { todoType: 'interview', due: '2099-01-05' }, ago(1));
  await send('Page.reload'); await sleep(1800);
  const firstInterviewRow = await ev(`(()=>{const r=document.querySelector('[data-todo="ask-first-interview"]'),a=r&&r.querySelector('a[href="#/ask/ask-first-interview"]');return r&&a?{text:r.innerText,href:a.getAttribute('href'),today:!!document.querySelector('#today-card')}:null})()`);
  ok('有首次訪問問題包和日期時，今日指引併入該列而不另開卡', firstInterviewRow && firstInterviewRow.text.includes('1 月 5 日') && firstInterviewRow.href === '#/ask/ask-first-interview' && !firstInterviewRow.today, firstInterviewRow);
  ok('畫面文字（待決列、上次離開之後、其他待決事項）：用字檢查零命中', !(await scanText(['#since', '#other-pending', '#next-list', '#next-action'])).length, await scanText(['#since', '#other-pending', '#next-list', '#next-action']));
  await shot('b2-hub-sorted.png');

  /* 確認掣字眼：有 AI 跟進先寫「確認並交 AI 處理」，冇就「確認」；送出後外殼有冇開 AI 要一致 */
  async function answer(id) {
    await go(B + '#/ask/' + id);
    await click('#go-main');
    const label = (await text('#do-confirm')).replace(/^★\s*/, '');
    await click('#do-confirm');
    const run = await waitFor(async () => (await api(PB, '/api/status')).j.runs.find(r => r.kind === 'ask' && r.ref === id && (r.state === 'done' || r.state === 'failed')));
    return { label, run, ai: !!(run && (run.steps || []).some(s => s.key === 'ai')) };
  }
  const withNext = await answer('ask-next');
  ok('有 AI 跟進嘅包：掣寫「確認並交 AI 處理」，外殼真係開咗 AI', withNext.label === N.ui.submit && withNext.ai, withNext);
  const noNext = await answer('ask-plain');
  ok('冇 AI 跟進嘅包：掣只寫「確認」，外殼冇開 AI', noNext.label === N.ui.submitApply && noNext.label === '確認' && !noNext.ai, noNext);

  /* 0.40.0 入口重整：文件與固定動作搬到首頁「告訴 Zero 一件事」及「Zero 近期工作」；真實進展頁只看紀錄 */
  await go(B + 'dashboard/inputs');
  ok('真實進展頁：交給 Zero 的事、Zero 的工作、每週訪問三個區塊，只看紀錄', await ev(`(()=>{const g=document.querySelector('.grid-in');return !!g&&!!g.querySelector('#in-inbox')&&!!g.querySelector('#in-work')&&!!g.querySelector('#in-interview')})()`), await ev(`[...document.querySelectorAll('.panel')].map(c=>c.id)`));
  ok('真實進展頁已移走上載、現在開工，開啟資料夾只在頁頭「更多」（只有一個「告訴 Zero 一件事」連結）', !(await has('#doc-drop')) && !(await has('#doc-files')) && !(await has('#in-inbox #open-folder, #in-work #open-folder, #in-interview #open-folder')) && !(await has('#run-now')) && (await text('#tell-go')) === N.dash.tellGo && (await ev(`document.querySelector('#tell-go').getAttribute('href')`)) === '/#quick-input', { go: await text('#tell-go'), href: await ev(`document.querySelector('#tell-go').getAttribute('href')`), n: await ev(`document.querySelectorAll('#tell-go').length`), has: [await has('#doc-drop'), await has('#doc-files'), await has('#in-inbox #open-folder'), await has('#run-now')] });
  await go(B + '#/');
  ok('首頁告訴 Zero 一件事：三個選項，選了才展開表格', (await ev(`[...document.querySelectorAll('#tell-intents .intent')].map(b=>b.id).join(',')`)) === 'quick-event,quick-adhoc,quick-order' && (await ev(`document.querySelector('#tell-form').hidden`)), await text('#tell-intents'));
  const f1 = path.join(OUT, '會議紀錄.md'); fs.writeFileSync(f1, '# 會議紀錄\n\n農場甲表示下星期可以試送一次。\n');
  await click('#quick-event');
  ok('選「發生了一件事」後展開表格，有日期欄及附件', !(await ev(`document.querySelector('#tell-form').hidden`)) && !(await ev(`document.querySelector('#quick-event-fields').hidden`)) && (await has('#quick-files')), await text('#tell-form'));
  const doc = await send('DOM.getDocument', { depth: -1 });
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#quick-files' });
  await send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [f1] }); await sleep(500);
  ok('加入文件：列出文件名', (await text('#tell-file-list')).includes('會議紀錄.md'), await text('#tell-file-list'));
  await click('#quick-send');
  const docRun = await waitFor(async () => (await api(PB, '/api/status')).j.runs.find(r => r.kind === 'note' && r.noteType === 'doc' && (r.state === 'done' || r.state === 'failed')));
  ok('只附文件送出：外殼登記並交 AI 讀（同事件同一條路）', docRun && docRun.state === 'done' && (docRun.steps || []).some(s => s.key === 'ai'), docRun);
  ok('送出後有可見的下一步：已收到，並有「查看回饋」連結', (await text('#quick-note')).includes(N.ui.tellReceived) && (await ev(`(document.querySelector('#quick-track')||{}).getAttribute&&document.querySelector('#quick-track').getAttribute('href')`)).startsWith('#/feedback/in-'), await text('#quick-note'));
  const stB = JSON.parse(fs.readFileSync(path.join(DB, 'ledger', 'state.json'), 'utf8'));
  const inp = (stB.inputs || []).find(i => i.via === 'doc');
  ok('只附文件：記成一份輸入（標題寫文件名、唔顯示副檔名），文件封存', inp && /文件（.*）：會議紀錄$/.test(inp.title) && inp.files.length === 1 && fs.existsSync(path.join(DB, inp.files[0])) && !fs.readdirSync(path.join(DB, 'founder', 'inbox')).some(f => f.includes('-note-doc')), inp);
  await go(B + '#/');
  const recentInputs = await waitFor(async () => await ev(`(()=>{const d=document.querySelector('#recent-inputs'),item=d&&d.querySelector('[data-input="${inp.id}"]');return d&&item?{details:d.tagName==='DETAILS',open:d.open,rows:d.querySelectorAll('#recent-list li').length,feedback:!!item.querySelector('[data-feedback]'),answer:!!item.querySelector('[data-answer]')}:null})()`));
  ok('首頁「最近交給 Zero 的事」收起、最多 3 行；列出剛送出的文件且只可查看回饋', recentInputs && recentInputs.details && !recentInputs.open && recentInputs.rows <= 3 && recentInputs.feedback && !recentInputs.answer, recentInputs);
  ok('頁腳有情景演練與紅藍對打連結，已移除的功能卡不再存在', await ev(`(()=>{const p=document.querySelector('#foot-practice'),d=document.querySelector('#foot-debate');return !!p&&p.getAttribute('href')==='#/practice'&&!!d&&d.getAttribute('href')==='#/debate'&&!document.querySelector('#practice-card,#debate-card,#brain-line,#tell-help')})()`));
  await go(B + 'dashboard/inputs');
  ok('真實進展頁「交給 Zero 的事」也列出文件類（按月摺疊）', (await has('#in-inbox details.mo-month')) && (await ev(`!!document.querySelector('#in-inbox [data-input="${inp.id}"]')`)), await text('#in-inbox'));
  await ev(`document.querySelector('#tool-more').open=true`);
  await click('#open-folder');
  await waitFor(async () => (await text('#toast')).includes(N.ui.openFolderNoWin), 8000); // 頁面忙於輪詢時，提示要稍後才出現
  ok('「開啟資料夾」在頁頭「更多」：只開固定收件匣（測試環境唔開視窗）', (await text('#toast')).includes(N.ui.openFolderNoWin), await text('#toast'));
  ok('本機固定動作唔接受參數', (await api(PB, '/api/setup', { action: 'openFolder', path: 'C:/' })).code === 400 && (await api(PB, '/api/setup', { action: 'runNow', type: 'x' })).code === 400);
  await waitFor(async () => !(await api(PB, '/api/dashboard')).j.ai.busy, 30000);
  await go(B + '#/');
  ok('首頁「Zero 開工」卡有「現在開工」及兩行說明', (await has('#run-strip')) && (await has('#run-now')) && (await text('#run-now')) === N.ui.runNow && (await ev(`document.querySelectorAll('#run-preview li').length`)) >= 1, await text('#run-strip'));
  await click('#run-now');
  ok('「現在開工」：開始一次手動工作', (await text('#toast')).includes(N.ui.runNowSent), await text('#toast'));
  const manual = await waitFor(async () => ((await api(PB, '/api/dashboard')).j.runs || []).find(r => r.trigger === 'manual'), 40000);
  ok('手動工作記錄為「手動」觸發', !!manual, ((await api(PB, '/api/dashboard')).j.runs || []).map(r => r.trigger));
  await waitFor(async () => !(await api(PB, '/api/dashboard')).j.ai.busy, 30000);
  const sp = path.join(DB, 'ledger', 'state.json'), s2 = JSON.parse(fs.readFileSync(sp, 'utf8'));
  s2.health = { ...(s2.health || {}), pausedByFounder: true }; fs.writeFileSync(sp, JSON.stringify(s2, null, 2));
  const stop = await api(PB, '/api/setup', { action: 'runNow' });
  ok('持續暫停：「現在開工」只講原因、唔開 AI', stop.code === 409 && stop.j.message === N.ui.skip_pausedByFounder, stop);
  await go(B + '#/');
  // 剛完成的工作收尾期間會先顯示「工作進行中」：等到顯示暫停原因才核對
  await waitFor(async () => (await text('#run-now-note')) === N.ui.skip_pausedByFounder, 30000);
  ok('持續暫停：掣停用並顯示原因', (await ev(`document.querySelector('#run-now').disabled`)) && (await text('#run-now-note')) === N.ui.skip_pausedByFounder, await text('#run-now-note'));
  ok('首頁告訴 Zero、近期工作畫面文字：用字檢查零命中', !(await scanText(['#quick-input', '#run-preview'])).length, await scanText(['#quick-input', '#run-preview']));
  await go(B + 'dashboard/inputs');
  // 附件清單顯示的是創辦人自己的檔案名（例如「會議紀錄.md」），不是產品文字，檢查時略去
  const scanNoAttach = async sel => N.styleIssues(await ev(`(()=>{const c=document.querySelector(${JSON.stringify(sel)}).cloneNode(true);c.querySelectorAll('.attach-list').forEach(e=>e.remove());return c.innerText||c.textContent})()`));
  ok('真實進展頁畫面文字（略去創辦人自己的附件檔名）：用字檢查零命中', !(await scanNoAttach('.grid-in')).length, await scanNoAttach('.grid-in'));
  await shot('b3-inputs.png');
  ok('頁面冇程式錯誤', !errors.length, errors);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  try { ws.close(); } catch { } chrome.kill(); srvA.kill(); srvB.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  for (const p of Object.keys(logs)) fs.writeFileSync(path.join(OUT, 'server-' + p + '.log'), logs[p]);
  process.exit(pass === results.length ? 0 : 1);
}
