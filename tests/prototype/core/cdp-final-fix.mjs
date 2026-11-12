// 0.43.0 截圖批最後修正（畫面）：五項在修正前會失敗的檢查。
// ① 手機（390）卡片詳情不疊住工序列及卡片、底色不透明、「下一步」全闊一行、顯示「現在：<工序>」（已批原型第 15 個畫面）
// ② 多個延伸功能的清單頁頂按鈕打開「從範本或一句話新增」入口，頁面更新後仍停留，並可回到清單（已批原型第 18 個畫面）
// ③ 390 業績紀錄表每個金額完整可見，不被切去，也不被同一行的按鈕或其他元素遮住（主會話裁決退回③的版面修正，改為守住這一點）
// ④ 「本月收入／本月支出」只列本月紀錄
// ⑤ 已匯入批次顯示確認時間（時：分）
// 用法：node cdp-final-fix.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>（Chrome 用 port+1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { freshTestOut } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PORT = Number(PORT_TEXT), BASE = `http://127.0.0.1:${PORT}`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANK_CSV = path.join(HERE, '..', 'fixtures', 'csv', 'bank.csv');
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const waitFor = async (check, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const value = await check(); if (value) return value; } catch (_) {} await sleep(180); }
  return null;
};
const api = async (route, body) => {
  const response = await fetch(BASE + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', Origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await response.json(); } catch (_) {}
  return { code: response.status, json };
};
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const serverErrors = [];
const keepErrors = chunk => { for (const line of String(chunk).split('\n')) if (/出錯|拒收/.test(line)) serverErrors.push(line.trim().slice(0, 300)); };
const pad = n => String(n).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shiftMonth = (month, delta) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + delta, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
// 在頁面內量度：文字佔幾行（同一段文字的行框頂部位置有幾個）
const LINES_FN = `const linesOf=(root,text)=>{const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const i=n.data.indexOf(text);if(i<0)continue;const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+text.length);return new Set([...r.getClientRects()].filter(x=>x.width>0).map(x=>Math.round(x.top))).size;}return -1;};`;
const OVERLAP_FN = `const overlap=(a,b)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));`;

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });
const run = path.join(OUT, 'final-fix-run'), DATA = path.join(run, 'data');
fs.mkdirSync(DATA, { recursive: true });

// 資料：公司概覽已確認；兩個延伸功能（訂單生產進度＋存貨，均待啟用）
seedCompany(DATA, PROTO);
await certifyDirect(DATA, PROTO, ADAPTER);
const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
write(path.join(DATA, 'ledger', 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: '2026-11-01T09:00:00+08:00', order: page.path.milestones.map(m => m.id), values: {}, edits: [] });
const EX = path.join(PROTO, 'fixtures', 'ext-example', '訂單生產進度');
const EXT = path.join(DATA, '延伸功能'), ORDERS = path.join(EXT, '訂單生產進度');
fs.mkdirSync(path.join(ORDERS, 'data'), { recursive: true });
fs.copyFileSync(path.join(EX, 'extension.json'), path.join(ORDERS, 'extension.json'));
for (const f of fs.readdirSync(path.join(EX, 'rows'))) fs.copyFileSync(path.join(EX, 'rows', f), path.join(ORDERS, 'data', f));
const stockDecl = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'ext-templates', 'stock.json'), 'utf8')).decl;
fs.mkdirSync(path.join(EXT, '存貨', 'data'), { recursive: true });
write(path.join(EXT, '存貨', 'extension.json'), stockDecl);
const exRows = JSON.parse(fs.readFileSync(path.join(EX, 'rows', 't1.json'), 'utf8')).rows;
const actors = [...new Map(exRows.map(r => r.v?.f2).filter(Boolean).map(a => [a.id, a])).values()].map(a => ({ id: a.id, name: a.name, label: a.name, kind: 'customer', aliases: [], status: 'active', fromMilestoneIds: [], addedAt: '2026-11-01' }));
write(path.join(DATA, 'ledger', 'state.json'), { schemaVersion: 1, intake: { state: 'complete' }, company: { name: page.company.name, initials: '測試', actors }, tasks: [], events: [], inputs: [], milestones: [], interviews: { applied: {} } });

const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
server.stdout.on('data', keepErrors); server.stderr.on('data', keepErrors);
let chrome;
const money = async () => (await api('/api/money')).json || {};
const addMoney = async item => {
  const r = await api('/api/money', { action: 'add', currency: 'HKD', counterpartId: '', files: [], ...item });
  if (!r.json?.ok) throw new Error('入帳失敗：' + item.payer + ' ' + JSON.stringify(r.json).slice(0, 200));
  await waitFor(async () => (await money()).records?.some(rec => rec.id === r.json.id), 20000);
  return r.json.id;
};

try {
  ok('準備：伺服器啟動', await waitFor(async () => (await fetch(BASE + '/api/health')).ok, 20000));
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);

  // ② 清單頁頂按鈕
  await chrome.go(BASE + '/dashboard/ext', 1440, 2200);
  const indexShown = await waitFor(() => chrome.ev(`document.querySelectorAll('#ext-tab .cx-feature').length>=2`), 15000);
  await chrome.ev(`(()=>{window.__extGets=0;const f=window.fetch;window.fetch=function(u,o){if(String(u).includes('/api/ext')&&!(o&&String(o.method||'').toUpperCase()==='POST'))window.__extGets++;return f.apply(this,arguments);};return true;})()`);
  const headText = await chrome.ev(`(()=>{const b=document.querySelector('#ext-tab .cx-shell > .cx-head button');return b?b.textContent.trim():'';})()`);
  ok('② 清單頁頂按鈕寫「從範本或一句話新增」（原型第 18 個畫面）', indexShown && headText === '從範本或一句話新增', { indexShown: !!indexShown, headText });
  await chrome.ev(`(()=>{const b=document.querySelector('#ext-tab .cx-shell > .cx-head button');if(b)b.click();return !!b;})()`);
  const createShown = await waitFor(() => chrome.ev(`!!document.querySelector('#ext-tab [data-cx-ask]')&&document.querySelectorAll('#ext-tab [data-cx-template]').length===3`), 5000);
  ok('② 按頁頂按鈕後看到範本及「寫一句你想要甚麼」', createShown, { screen: await chrome.ev(`(document.querySelector('#ext-tab')||{}).innerText?.replace(/\\s+/g,' ').slice(0,240)||''`) });
  // 觸發一次頁面更新（新增一筆紀錄 → 外殼重讀資料 → 延伸功能分頁再讀 /api/ext）
  const firstDay = localDay();
  const todayId = await addMoney({ dir: 'in', amount: '1280.50', date: firstDay, payer: '好日子咖啡室', category: 'sales', what: '企業禮盒 10 份' });
  const polled = await waitFor(() => chrome.ev('window.__extGets>0'), 15000);
  await sleep(900);
  const stillCreate = await chrome.ev(`!!document.querySelector('#ext-tab [data-cx-ask]')`);
  ok('② 頁面更新後仍停留在新增入口', createShown && polled && stillCreate, { polled: !!polled, stillCreate });
  const back = await chrome.ev(`(()=>{const b=[...document.querySelectorAll('#ext-tab button')].find(x=>x.textContent.trim()==='全部延伸功能');if(b)b.click();return !!b;})()`);
  const backShown = await waitFor(() => chrome.ev(`document.querySelectorAll('#ext-tab .cx-feature').length>=2`), 5000);
  ok('② 新增入口有「全部延伸功能」可回到清單', back && backShown, { back, backShown: !!backShown });

  // ④ 及 ⑤ 的資料：本月及上月紀錄，再匯入 bank.csv（10 月）
  const month = (await money()).month || firstDay.slice(0, 7), prev = shiftMonth(month, -1);
  await addMoney({ dir: 'out', amount: '420.00', date: `${month}-02`, payer: '印刷房', category: 'goods', what: '包裝貼紙 500 張' });
  // ③ 用：較長的金額
  await addMoney({ dir: 'in', amount: '128000.50', date: `${month}-03`, payer: '大客戶有限公司', category: 'sales', what: '年度合約' });
  await addMoney({ dir: 'in', amount: '300.00', date: `${prev}-20`, payer: '上月客戶', category: 'sales', what: '上月訂單' });
  await addMoney({ dir: 'out', amount: '150.00', date: `${prev}-21`, payer: '上月供應商', category: 'goods', what: '上月材料' });
  const up = await api('/api/money', { action: 'importUpload', name: 'bank.csv', data: fs.readFileSync(BANK_CSV).toString('base64'), kind: 'bank' });
  const conf = await api('/api/money', { action: 'importConfirm', id: up.json?.id });
  const merged = await waitFor(async () => (await money()).records?.some(rec => rec.importBatch === up.json?.id), 20000);
  ok('準備：本月、上月紀錄及匯入批次', !!merged && up.json?.ok && conf.json?.ok, { upload: up.json?.ok, confirm: conf.json?.ok, merged: !!merged, month, prev });

  const openMoney = async w => { await chrome.go(BASE + '/dashboard/money', w, 2200); await waitFor(() => chrome.ev('!!document.querySelector("#app .mny-page .mny-table")'), 15000); await sleep(600); };
  const chip = text => chrome.ev(`(()=>{const e=[...document.querySelectorAll('.mny-chips .mny-chip')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!e)return false;e.click();return true;})()`);
  const rowDates = () => chrome.ev(`[...document.querySelectorAll('.mny-table tbody tr')].map(r=>(r.querySelector('td')||{}).textContent||'')`);
  const monthLabel = `${Number(month.slice(5))} 月`;
  await openMoney(1440);
  for (const label of ['本月收入', '本月支出']) {
    const picked = await chip(label);
    await sleep(500);
    const dates = await rowDates();
    ok(`④「${label}」只列本月紀錄`, picked && dates.length > 0 && dates.every(d => d.trim().startsWith(monthLabel)), { picked, monthLabel, dates });
  }

  // ⑤ 已匯入批次顯示時間
  await openMoney(1440);
  const batchLine = await chrome.ev(`(()=>{const b=document.querySelector(${JSON.stringify('#mny-import-undo-' + (up.json?.id || 'x'))});const row=b&&b.closest('.mny-item');return row?row.innerText.replace(/\\s+/g,' '):'';})()`);
  ok('⑤ 已匯入批次顯示確認時間（時：分）', /\d{1,2}:\d{2}/.test(batchLine), { batchLine });

  // ③ 390 闊：每個金額完整可見。逐格捲入畫面、表格回到最左，量金額文字：
  // 不超出金額格、不超出表格可見範圍及視窗；文字左、中、右三點的最上層元素都是該金額格本身（沒有被按鈕或其他元素遮住）
  await openMoney(390);
  const m3 = await chrome.ev(`(async()=>{const t=document.querySelector('.mny-table');if(!t)return null;const out=[];for(const cell of [...t.querySelectorAll('tbody td.r')]){cell.scrollIntoView({block:'center'});t.scrollLeft=0;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const range=document.createRange();range.selectNodeContents(cell);const tr=range.getBoundingClientRect(),cr=cell.getBoundingClientRect(),vb=t.getBoundingClientRect();const visRight=Math.min(vb.left+t.clientWidth,innerWidth);const y=tr.top+tr.height/2;const covered=[tr.left+1,tr.left+tr.width/2,tr.right-1].filter(x=>{const h=document.elementFromPoint(x,y);return !h||!(h===cell||cell.contains(h));}).length;out.push({text:cell.textContent,ok:tr.width>0&&tr.left>=cr.left-1&&tr.right<=cr.right+1&&tr.right<=visRight+1&&covered===0,textLeft:Math.round(tr.left),textRight:Math.round(tr.right),cellLeft:Math.round(cr.left),cellRight:Math.round(cr.right),visRight:Math.round(visRight),covered});}return out;})()`);
  ok('③ 390 闊時每個金額完整可見（不被切去，也不被按鈕或其他元素遮住）', Array.isArray(m3) && m3.length >= 5 && m3.some(c => c.text.includes('128,000.50')) && m3.every(c => c.ok), { bad: (m3 || []).filter(c => !c.ok), count: (m3 || []).length });
  await chrome.ev(`(()=>{const c=[...document.querySelectorAll('.mny-table tbody td.r')].find(x=>x.textContent.includes('128,000.50'));if(c)c.scrollIntoView({block:'center'});document.querySelector('.mny-table').scrollLeft=0;return true;})()`);
  await sleep(300);
  await chrome.shot(path.join(OUT, 'final-fix-amounts-390.png'));

  // ① 手機卡片詳情
  const en = await api('/api/ext', { action: 'enablePending', folder: '訂單生產進度' });
  const enabled = await waitFor(async () => (await api('/api/ext')).json?.items?.find(i => i.folder === '訂單生產進度' && i.state === 'enabled'), 15000);
  const extItem = (await api('/api/ext')).json?.items?.find(i => i.folder === '訂單生產進度');
  const table = extItem?.decl?.tables?.[0], stageField = table?.fields?.find(f => f.type === 'stage'), stageList = stageField?.stages || [];
  const rows = (await api(`/api/ext/rows?folder=${encodeURIComponent('訂單生產進度')}&table=${encodeURIComponent(table?.id || 't1')}`)).json?.rows || [];
  const lastStage = stageList[stageList.length - 1]?.id;
  const target = rows.find(r => !r.archived && r.v?.[stageField?.id] && r.v[stageField.id] !== lastStage);
  const stageLabel = stageList.find(s => s.id === target?.v?.[stageField?.id])?.label || '';
  await chrome.go(BASE + '/dashboard/ext', 390, 2200);
  await waitFor(() => chrome.ev(`!!document.querySelector('#ext-tab .cx-shell')`), 15000);
  if (!await chrome.ev(`!!document.querySelector('[data-cx-new]')`)) {
    await chrome.ev(`(()=>{const a=[...document.querySelectorAll('.cx-feature')].find(x=>(x.querySelector('h3')||{}).textContent?.includes('訂單生產進度'));const b=a&&[...a.querySelectorAll('button')].find(x=>x.textContent.trim()==='打開');if(b)b.click();return !!b;})()`);
  }
  const board = await waitFor(() => chrome.ev(`!!document.querySelector('[data-cx-new]')&&!!document.querySelector('.cx-stagebar')`), 10000);
  await chrome.ev(`(()=>{const c=[...document.querySelectorAll('.cx-stagebar .cx-chip')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(stageLabel)}));if(c)c.click();return !!c;})()`);
  await sleep(500);
  const clicked = await chrome.ev(`(()=>{const e=document.querySelector(${JSON.stringify(`[data-cx-card][data-cx-id="${target?.id}"]`)});if(e)e.click();return !!e;})()`);
  const sheetShown = await waitFor(() => chrome.ev(`!!document.querySelector('.cx-sheet [data-cx-next]')`), 5000);
  await sleep(700);
  ok('準備：手機看板及卡片詳情', !!en.json?.ok && !!enabled && !!board && clicked && !!sheetShown, { enable: en.json?.ok, board: !!board, target: target?.v?.[table?.title], stageLabel, clicked, sheetShown: !!sheetShown });
  const geometry = () => chrome.ev(`(()=>{${OVERLAP_FN}${LINES_FN}const s=document.querySelector('.cx-sheet'),n=s&&s.querySelector('[data-cx-next]'),bar=document.querySelector('.cx-stagebar');if(!s||!n||!bar)return null;const sr=s.getBoundingClientRect(),nr=n.getBoundingClientRect(),cs=getComputedStyle(s);const cards=[...document.querySelectorAll('[data-cx-card]')].map(c=>c.getBoundingClientRect());const hit=document.elementFromPoint(nr.left+nr.width/2,nr.top+nr.height/2);const inner=s.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);const a=(cs.backgroundColor.match(/[\\d.]+/g)||[]).map(Number);return {position:cs.position,background:cs.backgroundColor,alpha:a.length===4?a[3]:(a.length===3?1:0),overStagebar:Math.round(overlap(sr,bar.getBoundingClientRect())),overCards:Math.round(cards.reduce((t,c)=>t+overlap(sr,c),0)),nextInView:nr.top>=0&&nr.bottom<=innerHeight,nextHit:!!hit&&(hit===n||n.contains(hit)),nextWidth:Math.round(nr.width),innerWidth:Math.round(inner),nextLines:linesOf(n,n.textContent.trim()),text:s.innerText.replace(/\\s+/g,' ').slice(0,200)};})()`);
  const g1 = await geometry();
  ok('① 卡片詳情底色不透明', g1 && g1.alpha >= 0.9, g1);
  ok('① 打開卡片後「下一步」在畫面內、按得到', g1 && g1.nextInView && g1.nextHit, g1);
  ok('① 卡片詳情不疊住工序列及卡片（打開後）', g1 && g1.overStagebar === 0 && g1.overCards === 0, g1);
  ok('①「下一步」全闊、一行顯示（原型第 15 個畫面）', g1 && g1.nextWidth >= g1.innerWidth * 0.8 && g1.nextLines === 1, g1);
  ok('① 卡片詳情顯示「現在：<工序>」（原型第 15 個畫面）', g1 && stageLabel && g1.text.includes('現在：' + stageLabel), { stageLabel, text: g1?.text });
  // 把工序列捲到畫面下半部，再看一次是否被卡片詳情蓋住
  await chrome.ev(`(()=>{const b=document.querySelector('.cx-stagebar').getBoundingClientRect();window.scrollBy(0,b.top-innerHeight*0.6);return true;})()`);
  await sleep(500);
  const g2 = await geometry();
  ok('① 卡片詳情不疊住工序列及卡片（捲動後）', g2 && g2.overStagebar === 0 && g2.overCards === 0, g2);
  await chrome.ev(`document.querySelector('.cx-sheet').scrollIntoView({block:'center'})`);
  await sleep(400);
  await chrome.shot(path.join(OUT, 'final-fix-sheet-390.png'));

  // ② 放最後：由新增入口按範本，應打開該份草稿的校對畫面（之後有草稿，重新載入會先顯示草稿，所以不可放在 ① 之前）
  await chrome.go(BASE + '/dashboard/ext', 1440, 2200);
  await waitFor(() => chrome.ev(`document.querySelectorAll('#ext-tab .cx-feature').length>=2`), 15000);
  await chrome.ev(`(()=>{const b=document.querySelector('#ext-tab .cx-shell > .cx-head button');if(b)b.click();return !!b;})()`);
  const createAgain = await waitFor(() => chrome.ev(`!!document.querySelector('#ext-tab [data-cx-template="bookings"]')`), 5000);
  await chrome.ev(`(()=>{const b=document.querySelector('#ext-tab [data-cx-template="bookings"]');if(b)b.click();return !!b;})()`);
  const proofShown = await waitFor(() => chrome.ev(`!!document.querySelector('#ext-tab [data-cx-field-list]')`), 10000);
  ok('② 在新增入口按範本後看到校對畫面', createAgain && proofShown, { createAgain: !!createAgain, proofShown: !!proofShown, screen: await chrome.ev(`(document.querySelector('#ext-tab')||{}).innerText?.replace(/\\s+/g,' ').slice(0,200)||''`) });
  ok('頁面沒有程式錯誤', chrome.errors.length === 0, chrome.errors.slice(0, 5));
} catch (error) {
  ok('頁面測試程式出錯', false, String(error?.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
  if (serverErrors.length) console.log('伺服器出錯行：' + JSON.stringify(serverErrors.slice(-5)));
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
