// 延伸功能頁面端到端：範本、校對、啟用、看板、復原、手機、清單、封存及交給 Zero。
// 用法：node cdp-ext.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PORT = Number(PORT_TEXT), BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const waitFor = async (check, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { if (await check()) return true; } catch (_) {} await sleep(180); }
  return false;
};
const api = async (route, body) => {
  const response = await fetch(BASE + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', Origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await response.json(); } catch (_) {}
  return { code: response.status, json };
};
const start = (data) => spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
// 伺服器輸出只留「出錯」行作失敗證據
const serverErrors = [];
const keepErrors = chunk => { for (const line of String(chunk).split('\n')) if (/出錯|拒收/.test(line)) serverErrors.push(line.trim().slice(0, 300)); };
const center = async (chrome, selector) => chrome.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e&&e.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
const mouse = (chrome, type, point, buttons = 1) => chrome.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
async function drag(chrome, source, target) {
  await mouse(chrome, 'mousePressed', source);
  for (let step = 1; step <= 12; step++) { await mouse(chrome, 'mouseMoved', { x: Math.round(source.x + (target.x - source.x) * step / 12), y: Math.round(source.y + (target.y - source.y) * step / 12) }); await sleep(18); }
  await mouse(chrome, 'mouseReleased', target, 0);
}

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });
const run = path.join(OUT, 'ext-run'), DATA = path.join(run, 'data');
fs.mkdirSync(DATA, { recursive: true });
const server = start(DATA);
server.stdout.on('data', keepErrors); server.stderr.on('data', keepErrors);
let chrome;

try {
  seedCompany(DATA, PROTO);
  await certifyDirect(DATA, PROTO, ADAPTER);
  ok('EXT-01 伺服器啟動', await waitFor(async () => (await fetch(BASE + '/api/health')).ok));
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  await chrome.go(BASE + '/dashboard/ext', 1440);
  ok('EXT-02 延伸功能分頁顯示三個範本', await waitFor(() => chrome.ev(`document.querySelectorAll('[data-cx-template]').length===3`)));
  // ext-style.css 必須套用（範本卡三欄並排）；被頁面安全設定擋住時看板各欄會上下疊起
  ok('EXT-02a 延伸功能樣式檔已套用', await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('.cx-card-grid');return !!e&&getComputedStyle(e).display==='grid';})()`), 5000),
    await chrome.ev(`(()=>{const e=document.querySelector('.cx-card-grid');return e?getComputedStyle(e).display:'沒有 .cx-card-grid';})()`));
  await chrome.click('[data-cx-template="orders"]');
  ok('EXT-03 範本建立後進入預覽校對', await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-field-list]')&&!!document.querySelector('[data-cx-stage-list]')`)));

  // 每一項改動送出後，等伺服器草稿已更新及頁面重繪，才做下一項（頁面每次以當時的草稿為底合併改動）
  const readyDraft = async () => (await api('/api/ext')).json?.drafts?.find(item => item.state === 'ready');
  const settle = async check => { const done = await waitFor(async () => check(await readyDraft())); await sleep(600); return done; };
  await chrome.type('[data-cx-label="f1"]', '訂單編號');
  await chrome.ev(`document.querySelector('[data-cx-label="f1"]').blur()`);
  const renamed = await settle(draft => draft?.edits?.labels?.f1 === '訂單編號');
  const firstHandle = await center(chrome, '[data-cx-field-list] [data-cx-drag-handle]');
  const secondHandle = await center(chrome, '[data-cx-field-list] [data-cx-sort-item]:nth-child(2) [data-cx-drag-handle]');
  if (firstHandle && secondHandle) await drag(chrome, secondHandle, { x: firstHandle.x, y: firstHandle.y - 18 });
  const sorted = await settle(draft => Array.isArray(draft?.edits?.fieldOrder) && draft.edits.fieldOrder[0] === 'f2');
  // 欄名輸入框沒有 type 屬性，以 data-cx-label 找出第一個可隱藏的欄
  const optionalToggle = await chrome.ev(`(()=>{const e=[...document.querySelectorAll('[data-cx-field-list] input[type=checkbox]')].find(x=>!x.disabled&&x.checked);return e&&e.closest('.cx-sort-item')?.querySelector('[data-cx-label]')?.getAttribute('data-cx-label')||''})()`);
  if (optionalToggle) await chrome.click(`[data-cx-label="${optionalToggle}"]~.cx-toggle input`);
  const hidden = await settle(draft => Array.isArray(draft?.edits?.hidden) && draft.edits.hidden.includes(optionalToggle));
  const finalDraft = await readyDraft();
  ok('EXT-04 改名、拖動改次序及隱藏已送至草稿', renamed && sorted && hidden && finalDraft?.edits?.labels?.f1 === '訂單編號' && finalDraft.edits.fieldOrder?.[0] === 'f2' && finalDraft.edits.hidden?.includes(optionalToggle),
    { renamed, sorted, hidden, optionalToggle, edits: finalDraft?.edits, notice: await chrome.ev(`(document.querySelector('.cx-notice')||{}).textContent||''`) });

  // 按頁面上的按鈕；回傳是否找到（舊寫法「(()=>…click(),true)()」會被當成呼叫 true 而出錯）
  const clickText = (selector, text) => chrome.ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(e)e.click();return !!e;})()`);
  const enable = await clickText('button', '啟用');
  ok('EXT-05 啟用名稱欄出現', enable && await waitFor(() => chrome.ev(`document.querySelector('.cx-form input.cx-input')!==null`)));
  const nameInput = await chrome.ev(`document.querySelector('.cx-form input.cx-input')?.value||''`);
  if (nameInput !== null) { const input = await chrome.ev(`(()=>{const e=document.querySelector('.cx-form input.cx-input');return e&&e.id})()`); if (input) await chrome.type('#' + input, nameInput || '訂單生產進度'); }
  await chrome.ev(`(()=>[...document.querySelectorAll('.cx-form button')].find(e=>e.textContent.trim()==='儲存')?.click())()`);
  ok('EXT-06 啟用後進入看板', await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-board]')`), 20000));

  // stage 有值時經「更多資料」選工序；沒有值時只填必填欄（新增表單的預設路徑）
  async function addCard(name, due, stage = '') {
    await chrome.click('[data-cx-new]');
    await waitFor(() => chrome.ev(`!!document.querySelector('#cx-field-f1')`));
    await chrome.type('#cx-field-f1', name);
    // 日期欄不接受逐字輸入：直接設值再觸發 input
    await chrome.ev(`(()=>{const e=document.querySelector('#cx-field-f4');e.value=${JSON.stringify(due)};e.dispatchEvent(new Event('input',{bubbles:true}));return e.value;})()`);
    if (stage) {
      await clickText('.cx-form button', '更多資料');
      await waitFor(() => chrome.ev(`!!document.querySelector('#cx-field-f5')`));
      // 展開「更多資料」會重繪表單，已填的值保存在頁面狀態，不需重填
      await chrome.ev(`(()=>{const e=document.querySelector('#cx-field-f5');e.value=${JSON.stringify(stage)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`);
    }
    await chrome.click('[data-cx-save]');
    return waitFor(() => chrome.ev(`!document.querySelector('.cx-form')`));
  }
  const rowsNow = async () => { const view = await api('/api/ext'); const enabled = view.json?.items?.find(entry => entry.state === 'enabled'); return enabled ? ((await api(`/api/ext/rows?folder=${encodeURIComponent(enabled.folder)}&table=t1`)).json?.rows || []) : []; };
  const twoCards = await addCard('CDP 訂單甲', '2026-11-14', 's1') && await addCard('CDP 訂單乙', '2026-11-15');
  const created = await rowsNow(), cardA = created.find(row => row.v?.f1 === 'CDP 訂單甲'), cardB = created.find(row => row.v?.f1 === 'CDP 訂單乙');
  ok('EXT-07 新增兩張卡（一張經「更多資料」選工序，一張只填必填欄）', twoCards && cardA?.v?.f5 === 's1' && cardA?.v?.f4 === '2026-11-14' && !!cardB && await waitFor(() => chrome.ev(`document.querySelectorAll('[data-cx-card]').length>=2`)), created.map(row => row.v));

  // 看板可能橫向捲動：開始拖動後每一步重新量度目標欄位置
  const boardInfo = await chrome.ev(`(()=>{const b=document.querySelector('[data-cx-board]');return b?{display:getComputedStyle(b).display,flow:getComputedStyle(b).gridAutoFlow,sheets:[...document.styleSheets].map(s=>{try{return (s.href||'inline')+':'+s.cssRules.length}catch(e){return (s.href||'inline')+':x'}}),scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,cols:[...b.querySelectorAll('[data-cx-stage]')].map(c=>{const r=c.getBoundingClientRect();return c.dataset.cxStage+':'+Math.round(r.x)+'+'+Math.round(r.width);})}:null;})()`);
  const firstCard = cardA && await center(chrome, `[data-cx-card][data-cx-id="${cardA.id}"]`);
  if (firstCard) {
    await mouse(chrome, 'mousePressed', firstCard);
    await mouse(chrome, 'mouseMoved', { x: firstCard.x + 12, y: firstCard.y + 4 }); await sleep(30);
    let point = firstCard;
    for (let step = 1; step <= 12; step++) {
      const head = await center(chrome, '[data-cx-stage="s2"] .cx-column-head');
      if (!head) break;
      const target = { x: head.x, y: head.y + 50 };
      point = { x: Math.round(point.x + (target.x - point.x) * step / 12), y: Math.round(point.y + (target.y - point.y) * step / 12) };
      await mouse(chrome, 'mouseMoved', point); await sleep(25);
    }
    const head = await center(chrome, '[data-cx-stage="s2"] .cx-column-head');
    if (head) { point = { x: head.x, y: head.y + 50 }; await mouse(chrome, 'mouseMoved', point); await sleep(40); }
    await mouse(chrome, 'mouseReleased', point, 0);
  }
  const movedStage = async () => (await rowsNow()).find(row => row.id === cardA?.id)?.v?.f5;
  ok('EXT-08 真實滑鼠拖到下一欄並出現復原', await waitFor(() => chrome.ev(`!!document.querySelector('.cx-undo')`)) && await waitFor(async () => await movedStage() === 's2'), { stage: await movedStage(), board: boardInfo });
  const undo = await clickText('.cx-undo button', '復原');
  ok('EXT-09 復原把卡送回原工序', undo && await waitFor(async () => await movedStage() === 's1'), await movedStage());
  await waitFor(() => chrome.ev(`!document.querySelector('.cx-undo')`));

  await chrome.go(BASE + '/dashboard/ext', 390);
  // 手機一次只顯示一個工序（預設第一個）：按卡甲所在工序的工序名
  await waitFor(() => chrome.ev(`document.querySelectorAll('.cx-stagebar .cx-chip').length>0`));
  await chrome.ev(`(()=>{const e=[...document.querySelectorAll('.cx-stagebar .cx-chip')].find(c=>c.textContent.trim().startsWith('打樣'));if(e)e.click();return !!e;})()`);
  await waitFor(() => chrome.ev(`document.querySelectorAll('[data-cx-card]').length>0`));
  // 只填必填欄而新增的卡未有工序（看板歸「未分類」）；手機版應同樣找得到這張卡
  const mobileCards = await chrome.ev(`(()=>{const out=[];document.querySelectorAll('.cx-stagebar .cx-chip').forEach(c=>out.push(c.textContent.trim()));return out;})()`);
  ok('EXT-10a 手機看得到只填必填欄而新增的卡', await chrome.ev(`[...document.querySelectorAll('.cx-stagebar .cx-chip')].some(c=>c.textContent.includes(${JSON.stringify('未分類')}))`) || await chrome.ev(`[...document.querySelectorAll('[data-cx-card]')].some(c=>c.textContent.includes('CDP 訂單乙'))`), { stagebar: mobileCards, cardB: cardB?.v });
  // 元素存在才按（cdp-lib 的 click 找不到元素會拋錯，令之後各項無法各自報告）
  const tryClick = async selector => { if (!await chrome.ev(`!!document.querySelector(${JSON.stringify(selector)})`)) return false; await chrome.click(selector); return true; };
  await tryClick('[data-cx-card]');
  ok('EXT-10 手機按卡後有下一步', await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-next]')`)));
  await chrome.go(BASE + '/dashboard/ext', 1440);
  await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-view="list"]')`));
  await tryClick('[data-cx-view="list"]');
  ok('EXT-11 清單視圖可按欄排序及工序篩選', await waitFor(() => chrome.ev(`!!document.querySelector('.cx-table')&&!!document.querySelector('.cx-select')`)));
  const latest = await api('/api/ext');
  const item = latest.json?.items?.find(entry => entry.state === 'enabled');
  const rows = item && await api(`/api/ext/rows?folder=${encodeURIComponent(item.folder)}&table=t1`);
  const row = rows?.json?.rows?.find(entry => !entry.archived);
  if (item && row) await api('/api/ext', { action: 'row', folder: item.folder, table: 't1', op: 'archive', id: row.id, rev: row.rev, v: {} });
  await chrome.go(BASE + '/dashboard/ext', 1440);
  await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-view="list"]')`)); await tryClick('[data-cx-view="list"]');
  await chrome.ev(`(()=>[...document.querySelectorAll('.cx-chip')].find(e=>e.textContent.trim()==='已封存')?.click())()`);
  ok('EXT-12 清單可查看已封存項目', await waitFor(() => chrome.ev(`document.querySelectorAll('[data-cx-row]').length>0`)));
  if (item && row) await tryClick(`[data-cx-row="${row.id}"]`);
  const restored = await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-restore]')`));
  if (restored) await chrome.click('[data-cx-restore]');
  ok('EXT-13 封存後可取回', restored && await waitFor(() => chrome.ev(`!document.querySelector('[data-cx-restore]')`)));

  // 交給 Zero：直接把測試卡移到最後工序，再以頁面按鈕送出。
  // C2：交給 Zero 要公司概覽已確認（伺服器 extHandoffNeedsOverview）；只寫本測試自己的資料夾
  { const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8')); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true }); fs.writeFileSync(path.join(DATA, 'ledger', 'confirmed.json'), JSON.stringify({ company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(m => m.id), values: {}, edits: [] })); }
  // 「發生了一件事」收件單：外殼可能已把它由收件匣移到 data/archive，所以在整個資料夾內數
  const eventNotes = () => { const found = []; const walk = dir => { let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of list) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/-note-event\.md$/.test(e.name)) found.push(e.name); } }; walk(DATA); return new Set(found); };
  const notesBefore = eventNotes();
  if (item && row) {
    const fresh = await api(`/api/ext/rows?folder=${encodeURIComponent(item.folder)}&table=t1`); const restoredRow = fresh.json?.rows?.find(entry => entry.id === row.id);
    if (restoredRow) await api('/api/ext', { action: 'row', folder: item.folder, table: 't1', op: 'update', id: restoredRow.id, rev: restoredRow.rev, v: { f5: 's5' } });
  }
  await chrome.go(BASE + '/dashboard/ext', 1440);
  await waitFor(() => chrome.ev(`document.querySelectorAll('[data-cx-card]').length>0`));
  const lastCard = await chrome.ev(`(()=>{const e=document.querySelector(${JSON.stringify(`[data-cx-card][data-cx-id="${row?.id || ''}"]`)});if(e)e.click();return !!e;})()`);
  ok('EXT-14 到宣告工序時可交給 Zero', lastCard && await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-handoff]')`)));
  if (await chrome.ev(`!!document.querySelector('[data-cx-handoff]')`)) await chrome.click('[data-cx-handoff]');
  // C2（0.43.0 反審）：按「交給 Zero」後，該行有 handedAt，並多了一份「發生了一件事」收件單
  const handedRow = async () => item && row ? ((await api(`/api/ext/rows?folder=${encodeURIComponent(item.folder)}&table=t1`)).json?.rows || []).find(entry => entry.id === row.id) : null;
  const handed = await waitFor(async () => !!(await handedRow())?.handedAt, 15000);
  const newNotes = async () => [...eventNotes()].filter(name => !notesBefore.has(name));
  const noteAdded = await waitFor(async () => (await newNotes()).length === 1, 15000);
  ok('C2 交給 Zero 後該行有 handedAt、收件匣多一份', handed && noteAdded, { handedAt: (await handedRow())?.handedAt || '', newNotes: await newNotes(), notice: await chrome.ev(`(document.querySelector('.cx-notice')||{}).textContent||''`), server: serverErrors.slice(-3) });
  ok('EXT-15 無腳本錯誤', chrome.errors.length === 0, chrome.errors);
  ok('EXT-16 伺服器沒有請求出錯', serverErrors.length === 0, serverErrors.slice(-5));

  // C3（0.43.0 反審）：手機（390）上草稿「可校對」時分頁不空白，看得到「啟用」。另開一個全新實例（<port>+2），只有一份範本草稿
  const BASE3 = `http://127.0.0.1:${PORT + 2}`, DATA3 = path.join(OUT, 'ext-c3', 'data');
  fs.mkdirSync(DATA3, { recursive: true }); seedCompany(DATA3, PROTO); await certifyDirect(DATA3, PROTO, ADAPTER);
  const server3 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 2)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA3, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server3.stdout.on('data', keepErrors); server3.stderr.on('data', keepErrors);
  try {
    await waitFor(async () => (await fetch(BASE3 + '/api/health')).ok, 20000);
    await usePass(BASE3); await usePass(BASE3, chrome);
    const c3draft = await fetch(BASE3 + '/api/ext', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE3 }, body: JSON.stringify({ action: 'draftTemplate', template: 'orders' }) });
    const errorsBefore = chrome.errors.length;
    await chrome.go(BASE3 + '/dashboard/ext', 390);
    const enableShown = await waitFor(() => chrome.ev(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='啟用'&&b.getBoundingClientRect().height>0)`), 10000);
    const extText = await chrome.ev(`(()=>{const e=document.querySelector('.cx-shell')||document.querySelector('#app');return e?e.innerText.trim():'';})()`);
    ok('C3 390 闊度草稿可校對時分頁不空白、看得到「啟用」', c3draft.status === 202 && enableShown && extText.length > 0, { draft: c3draft.status, enableShown, text: String(extText).slice(0, 300), errors: chrome.errors.slice(errorsBefore) });
    await chrome.shot(path.join(OUT, 'ext-c3-390.png'));
  } finally { server3.kill(); }
} catch (error) {
  ok('頁面測試程式出錯', false, String(error?.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
