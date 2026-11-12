// 業績頁面：非示範資料的入帳、結餘、匯入撤銷、作廢及手機頁頂驗收。
// 用法：node cdp-money.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { freshTestOut } from '../lib/out-guard.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
// 測試樣本按本檔位置找（原型資料夾可由 --proto 指到別處）
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
// 輸出資料夾先經守門函數準備（只限系統暫存資料夾內、帶標記）
freshTestOut(OUT);
const run = fs.mkdtempSync(path.join(OUT, 'money-')), DATA = path.join(run, 'data');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch {} await sleep(250); } return null; }

fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
write(path.join(DATA, 'ledger', 'confirmed.json'), { pageId: page.page.id, confirmedAt: '2026-11-11T09:00:00+00:00', values: {}, order: [] });
write(path.join(DATA, 'ledger', 'state.json'), { schemaVersion: 1, intake: { state: 'complete' }, company: { name: '測試公司', initials: '測試', actors: [] }, tasks: [], events: [], inputs: [], milestones: [], interviews: { applied: {} } });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
// 伺服器輸出只留「出錯／拒收」行作失敗證據
const serverErrors = [];
const keepErrors = chunk => { for (const line of String(chunk).split('\n')) if (/出錯|拒收/.test(line)) serverErrors.push(line.trim().slice(0, 300)); };
server.stdout.on('data', keepErrors); server.stderr.on('data', keepErrors);
let chrome;

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);

  // 元素存在才按（cdp-lib 的 click 找不到元素會拋錯，令之後各項無法各自報告）
  const tryClick = async selector => { if (!await chrome.ev(`!!document.querySelector(${JSON.stringify(selector)})`)) return false; await chrome.click(selector); return true; };
  const setValue = (selector, value) => chrome.ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const toastText = () => chrome.ev(`(()=>{const e=document.querySelector('#toast');return e&&!e.hidden?e.textContent:'';})()`);
  const quickRecord = async () => ((await get('/api/money')).j?.records || []).find(row => row.source === 'quick' && row.payer === '業績測試客戶');
  async function addOnPage() {
    await chrome.go(BASE + '/dashboard/money', 1440);
    await waitFor(() => chrome.ev('!!document.querySelector("#app .mny-page")'));
    // 記下頁面送出的內容，失敗時作證據
    await chrome.ev(`(()=>{if(window.__sent)return true;window.__sent=[];const f=window.fetch;window.fetch=function(u,o){if(o&&o.body&&/\\/api\\/money/.test(String(u)))window.__sent.push(String(o.body).slice(0,400));return f.apply(this,arguments);};return true;})()`);
    await tryClick('#mny-add-open');
    await chrome.type('#mny-amount', '1280.50');
    await chrome.type('#mny-payer', '業績測試客戶');
    await setValue('#mny-date', '2026-11-11');
    await tryClick('#mny-add-submit');
    const toast = await waitFor(toastText, 5000);
    return { record: await waitFor(quickRecord, 10000), toast, sent: await chrome.ev('window.__sent||[]') };
  }

  // 未有任何紀錄（未定主要貨幣）時，第一筆「記一筆」：規劃書第 138、171 行「第一次入帳時設定一種主要貨幣」「幣別（預設主要貨幣）」
  const first = await addOnPage();
  ok('MN-01 未有主要貨幣時，第一筆「記一筆」可以入帳', !!first.record, { toast: first.toast, sent: first.sent, server: serverErrors.slice(-3) });
  if (!first.record) {
    // 第一筆入不到帳時，先以已定主要貨幣的帳本繼續其餘各項（只寫本測試自己的資料夾）
    write(path.join(DATA, 'ledger', 'money.json'), { schema: 1, mainCurrency: 'HKD', records: [], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null });
  }
  const added = first.record ? first : await addOnPage();
  ok('MN-02 已有主要貨幣時，頁面「記一筆」可以入帳（只填金額、日期、對方，類別用預設）', !!added.record, { toast: added.toast, sent: added.sent, server: serverErrors.slice(-3) });
  if (!added.record) {
    // 頁面入不到帳時，經端點補上同一筆，令之後的結餘、匯入、撤銷、作廢各項仍可各自核對
    const viaApi = await fetch(BASE + '/api/money', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ action: 'add', dir: 'in', amount: '1280.50', currency: 'HKD', date: '2026-11-11', payer: '業績測試客戶', counterpartId: '', category: 'sales', what: '', files: [] }) });
    added.record = viaApi.status === 202 ? await waitFor(quickRecord, 10000) : null;
    await chrome.go(BASE + '/dashboard/money', 1440);
  }
  const recorded = added.record ? await waitFor(async () => { const r = await get('/api/money'); return r.j && r.j.cur && r.j.cur.income === 128050 ? r.j : null; }) : null;
  ok('MN-03 入帳後業績頁顯示本月收入', !!recorded && !!await waitFor(() => chrome.ev('(document.querySelector(".mny-kpis")||{}).innerText?.includes("1,280.50")||false'), 10000), { income: recorded?.cur?.income });
  ok('記一筆後頁頂數字更新', !!recorded && await chrome.ev('document.querySelectorAll(".metrics .metric.money").length===3 && document.querySelector(".metrics").innerText.includes("1,280.50")'));
  await chrome.shot(path.join(OUT, 'money-recorded-1440.png'), '#app');

  await tryClick('#mny-balance-open');
  await waitFor(() => chrome.ev('!!document.querySelector("#mny-balance-amount")'), 5000);
  if (await chrome.ev('!!document.querySelector("#mny-balance-amount")')) await chrome.type('#mny-balance-amount', '5000');
  await setValue('#mny-balance-date', '2026-11-11');
  await tryClick('#mny-balance-submit');
  const runway = await waitFor(async () => { const r = (await get('/api/money')).j?.runway; return r && r.state !== 'unset' && r.balanceCents === 500000 ? r : null; }, 10000);
  ok('設定結餘後顯示可撐多久', !!runway && !!await waitFor(() => chrome.ev('document.querySelector(".mny-runway")?.innerText||""')), { runway: runway?.state, toast: await toastText() });

  await tryClick('#mny-import-open');
  await waitFor(() => chrome.ev('!!document.querySelector("#mny-import-file")'), 5000);
  const dom = await chrome.send('DOM.getDocument', { depth: -1 });
  const input = await chrome.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#mny-import-file' });
  if (input.nodeId) await chrome.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [path.join(FIXTURES, 'csv', 'bank.csv')] });
  await waitFor(() => chrome.ev('!!document.querySelector("[data-mny-map]")'));
  await tryClick('#mny-import-confirm');
  const imported = await waitFor(async () => { const r = await get('/api/money'); return r.j && (r.j.records || []).some(row => row.source === 'import') ? r.j : null; });
  ok('匯入後數字更新', !!imported, { toast: await toastText(), server: serverErrors.slice(-3) });
  const batch = (imported && imported.batches || []).find(item => item.state === 'confirmed');
  if (batch) { await chrome.go(BASE + '/dashboard/money', 1440); await waitFor(() => chrome.ev(`!!document.querySelector(${JSON.stringify('#mny-import-undo-' + batch.id)})`)); await tryClick('#mny-import-undo-' + batch.id); }
  ok('可撤銷這次匯入', !!batch && !!await waitFor(async () => { const r = await get('/api/money'); return r.j && !(r.j.records || []).some(row => row.importBatch === batch.id && row.status === 'confirmed'); }), { batch: batch?.id, toast: await toastText() });

  // 390 闊度檢查放在作廢之前：作廢最後一筆有效紀錄後，頁頭正確地轉為「未有紀錄」一格
  await chrome.go(BASE + '/dashboard', 390);
  await waitFor(() => chrome.ev('document.querySelectorAll(".metrics .metric.money").length===3'));
  ok('390 闊度頁頂保留三格業績且沒有橫向捲動', await chrome.ev('document.querySelectorAll(".metrics .metric.money").length===3&&document.documentElement.scrollWidth<=innerWidth'));

  const firstId = added.record?.id;
  // 作廢要填原因（空白原因會被伺服器拒絕）。第五輪 P5 起原因改用頁內輸入欄及「確認」，不再用瀏覽器的輸入框
  if (firstId) {
    await chrome.go(BASE + '/dashboard/money', 1440);
    await waitFor(() => chrome.ev(`!!document.querySelector(${JSON.stringify('#mny-void-' + firstId)})`));
    await tryClick('#mny-void-' + firstId);
    await waitFor(() => chrome.ev(`!!document.querySelector(${JSON.stringify('#mny-void-reason-' + firstId)})`));
    await chrome.ev(`(()=>{const e=document.querySelector(${JSON.stringify('#mny-void-reason-' + firstId)});e.value='測試作廢';e.dispatchEvent(new Event('input',{bubbles:true}));const b=e.closest('.mny-actions').querySelector('.btn.primary');b.click();return true;})()`);
  }
  ok('可作廢一筆紀錄', !!firstId && !!await waitFor(async () => { const r = await get('/api/money'); return r.j && (r.j.records || []).some(row => row.id === firstId && row.status === 'void'); }), { firstId, toast: await toastText() });

  await chrome.shot(path.join(OUT, 'money-overview-390.png'));
  ok('頁面沒有錯誤', chrome.errors.length === 0, chrome.errors);
  ok('伺服器沒有請求出錯', serverErrors.length === 0, serverErrors.slice(-5));

  // C4、C5（0.43.0 反審）：另開一個全新實例（<port>+2）：沒有 money.json、未有主要貨幣
  const BASE2 = 'http://127.0.0.1:' + (PORT + 2), run2 = fs.mkdtempSync(path.join(OUT, 'money-new-')), DATA2 = path.join(run2, 'data');
  fs.mkdirSync(DATA2, { recursive: true });
  await certifyDirect(DATA2, PROTO, ADAPTER);
  seedCompany(DATA2, PROTO);
  write(path.join(DATA2, 'ledger', 'confirmed.json'), { pageId: page.page.id, confirmedAt: '2026-11-11T09:00:00+00:00', values: {}, order: [] });
  write(path.join(DATA2, 'ledger', 'state.json'), { schemaVersion: 1, intake: { state: 'complete' }, company: { name: '測試公司', initials: '測試', actors: [] }, tasks: [], events: [], inputs: [], milestones: [], interviews: { applied: {} } });
  const server2 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 2)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA2, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server2.stdout.on('data', keepErrors); server2.stderr.on('data', keepErrors);
  const get2 = async p => { const r = await fetch(BASE2 + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
  try {
    await waitFor(async () => (await get2('/api/status')).code === 200, 15000);
    await usePass(BASE2); await usePass(BASE2, chrome);
    const noMoneyFile = !fs.existsSync(path.join(DATA2, 'ledger', 'money.json'));
    await chrome.go(BASE2 + '/dashboard/money', 1440);
    await waitFor(() => chrome.ev('!!document.querySelector("#app .mny-page")'));
    const balanceOpen = await tryClick('#mny-balance-open');
    await waitFor(() => chrome.ev('!!document.querySelector("#mny-balance-amount")'), 5000);
    if (await chrome.ev('!!document.querySelector("#mny-balance-amount")')) await chrome.type('#mny-balance-amount', '5000');
    await setValue('#mny-balance-date', new Date().toLocaleDateString('sv-SE'));
    await tryClick('#mny-balance-submit');
    const opsFile = path.join(DATA2, 'ledger', 'founder-ops.json');
    const balanced = await waitFor(async () => { const r = (await get2('/api/money')).j?.runway; if (r && r.balanceCents === 500000) return 'runway'; try { return /"moneyBalance"/.test(fs.readFileSync(opsFile, 'utf8')) ? 'ops' : null; } catch { return null; } }, 15000);
    ok('C4 沒有 money.json、未有主要貨幣時，頁面直接設定現金結餘成功', noMoneyFile && balanceOpen && !!balanced, { noMoneyFile, balanceOpen, balanced, toast: await toastText(), server: serverErrors.slice(-3) });

    // C5：匯入時選「收款平台」上載 payment.csv，退款那行（第 3 行）是收入方向
    await chrome.go(BASE2 + '/dashboard/money', 1440);
    await waitFor(() => chrome.ev('!!document.querySelector("#app .mny-page")'));
    await tryClick('#mny-import-open');
    await waitFor(() => chrome.ev('!!document.querySelector("#mny-import-file")'), 5000);
    const picked = await chrome.ev(`(()=>{const want='收款平台';const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.textContent.trim()===want));if(s){s.value=[...s.options].find(o=>o.textContent.trim()===want).value;s.dispatchEvent(new Event('change',{bubbles:true}));return 'select:'+s.value;}const e=[...document.querySelectorAll('label,button,[role=radio],input[type=radio]')].find(x=>(x.textContent||'').trim()===want);if(e){e.click();return e.tagName;}return '';})()`);
    await chrome.ev(`(()=>{window.__sent2=[];const f=window.fetch;window.fetch=function(u,o){if(o&&o.body&&/\\/api\\/money/.test(String(u))){try{const b=JSON.parse(String(o.body));window.__sent2.push(JSON.stringify({action:b.action,kind:b.kind,name:b.name}));}catch(e){window.__sent2.push(String(o.body).slice(0,120));}}return f.apply(this,arguments);};return true;})()`);
    const dom2 = await chrome.send('DOM.getDocument', { depth: -1 });
    const input2 = await chrome.send('DOM.querySelector', { nodeId: dom2.root.nodeId, selector: '#mny-import-file' });
    if (input2.nodeId) await chrome.send('DOM.setFileInputFiles', { nodeId: input2.nodeId, files: [path.join(FIXTURES, 'csv', 'payment.csv')] });
    const importsDir = path.join(DATA2, 'ledger', 'money', 'imports');
    const paymentBatch = await waitFor(() => { try { return fs.readdirSync(importsDir).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(importsDir, n), 'utf8'))).find(b => b.file?.name === 'payment.csv') || null; } catch { return null; } }, 10000);
    const refundRow = (paymentBatch?.rows || []).find(row => row.line === 3);
    const sent2 = await chrome.ev('window.__sent2||[]');
    ok('C5 匯入選「收款平台」：送出 kind payment，退款那行是收入方向', !!picked && paymentBatch?.kind === 'payment' && refundRow?.draft?.refund === true && refundRow?.draft?.dir === 'in' && sent2.some(body => /"kind":"payment"/.test(body)),
      { picked, kind: paymentBatch?.kind, refund: refundRow?.draft, sent: sent2 });

    // C5：業績報告頁有「把收據交給 Zero」，按下通往首頁「告訴 Zero」入口
    await chrome.go(BASE2 + '/dashboard/money', 1440);
    await waitFor(() => chrome.ev('!!document.querySelector("#app .mny-page")'));
    const giveLabel = '把收據交給 Zero';
    const gave = await chrome.ev(`(()=>{const e=[...document.querySelectorAll('#app a,#app button')].find(x=>x.textContent.trim()===${JSON.stringify(giveLabel)});if(!e)return false;e.setAttribute('data-c5-give','1');return true;})()`);
    if (gave) await chrome.click('[data-c5-give]');
    const landed = gave && await waitFor(() => chrome.ev(`location.pathname==='/'&&!!document.querySelector('#quick-input')&&document.querySelector('#quick-input').innerText.includes('告訴 Zero')`), 10000);
    ok('C5 業績報告頁有「把收據交給 Zero」，按下通往「告訴 Zero」入口', gave && landed, { gave, href: await chrome.ev('location.href'), quickInput: await chrome.ev(`(document.querySelector('#quick-input')||{}).innerText?.slice(0,200)||''`) });
    await chrome.shot(path.join(OUT, 'money-c5-tell.png'));
  } finally { server2.kill(); }
} catch (error) {
  ok('業績頁面測試中斷', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
}

for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + String(JSON.stringify(result.info ?? '')).slice(0, 900)));
console.log(`${results.filter(result => result.pass).length}/${results.length} passed`);
process.exitCode = results.every(result => result.pass) ? 0 : 1;
