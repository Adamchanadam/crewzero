// 生意模式圖三處畫面驗收（接口文件第 2、2a、4、6 節；派工單 brief-c.md 第 5 節 cdp-canvas 項目 1–5 及 4a；已批原型 entry-journey-2026-11-10/after.html 畫面 6、7）。
// 用法：node cdp-canvas.mjs <Chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
//
// 選擇器假設（畫面正在按原型重做，盡量只靠 names.js 字句及幾何位置）：
//   - 公司現況小卡容器：#canvas-mini（在 #needs「待決事項」下面）；公司概覽九格容器：#canvas-confirmed（接口文件第 6 節、brief-c2 第 1 節第 3 點）。
//   - 九格：canvas.js 的 .cv-cell 及 .cv-<area>（area 代號取自 canvas-lib CELLS：pa ac re va cr ch cu co rv）；修改一格按該格內的按鈕（.cv-edit，沒有就按該格）。
//   - 證據級顏色：不靠 class，比較小卡九格的背景色（至少兩種）。
//   - 按鈕一律按 names.js 字句找（cvSeeAll、cvAdopt、cvReject、cvOwnEdit、cvPrevVer、cvBackNow、cvModelNotes）。
//   - window.prompt 由測試換成固定回覆（無頭 Chrome 不能答對話框）；如畫面改用頁內輸入框，測試會在格內找輸入框填寫後按「保存」。
// 每個需要乾淨資料的核對（採用、不採用、自己改、確認前、舊資料）都先重寫測試資料。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PORT = Number(PORT_TEXT), BASE = `http://127.0.0.1:${PORT}`, results = [];
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const MC = await import(pathToFileURL(path.join(PROTO, 'model-cards-lib.mjs')).href);
const LIB = MC.loadModelCards(PROTO);
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info: pass ? '' : info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const J = JSON.stringify;
async function waitFor(fn, ms = 20000) { const until = Date.now() + ms; while (Date.now() < until) { let v = null; try { v = await fn(); } catch { } if (v) return v; await sleep(250); } return null; }
const H = `const vis=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
const txt=e=>(e.textContent||'').replace(/\\s+/g,' ').trim();
const clickables=root=>[...(root||document).querySelectorAll('button,a[href],[role=button],summary')].filter(e=>vis(e)&&!e.disabled);
const mark=e=>{const id='cz'+Math.random().toString(36).slice(2);e.setAttribute('data-czt',id);return '[data-czt="'+id+'"]';};`;
const inPage = body => `(()=>{${H}\n${body}})()`;
const EN = [...new Set(LIB.cards.concat(LIB.extras).flatMap(card => card.en ? [card.en, ...card.en.split(/[／/]/)] : []).map(s => s.trim()).filter(s => s.length >= 4))];

freshTestOut(OUT);
const RUN = makeTestTemp('crewzero-cdp-canvas-'), DATA = path.join(RUN, 'data');
seedCompany(DATA, PROTO);
await certifyDirect(DATA, PROTO, ADAPTER);
const pageFile = path.join(DATA, 'company', 'page.json'), BASE_PAGE = JSON.parse(fs.readFileSync(pageFile, 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const pickPlan = (page, plan) => (page.detail.reading || []).find(item => item.plan === plan) || null;
const S01 = LIB.byId.S01, C13 = LIB.byId.C13, C26 = LIB.byId.C26;
// 已選組合：照接口文件第 1、3 節，清理後每張卡帶中文名 name；收錢面向用沒有英文名的補充模式 S01，供「模式說明」核對
const MODEL = {
  name: '每月鮮豆訂閱', payer: '上班族按月付訂閱費，每月收到一包新鮮烘焙的咖啡豆。',
  faces: { charge: [{ card: 'S01', quote: String(S01.when).slice(0, 12), src: { q: 1 }, name: S01.name }], form: [{ card: 'C13', quote: C13.fit[0], src: { q: 1 }, name: C13.name }], scale: [{ card: 'C26', quote: C26.fit[0], src: { q: 1 }, name: C26.name }] },
  why: '喝咖啡是每天重複的需要。', trap: { card: 'C13', text: C13.traps[0] }, firstTest: { card: 'C13', text: C13.firstTest, watch: '付款人數', counts: '只計付款', zero: true },
  altCharge: { text: '按備考階段收固定套餐費。', why: '需求只集中在某段時間。' }
};
const OLD_REVENUE = '原有收費方法：按次收費。', SUG_TEXT = '改為三個月預付，先收一季訂閱費。', OWN_TEXT = '按月訂閱，首月半價試飲。', EDIT_VALUE = '新鮮烘焙咖啡豆每月送到府上。';
// 測試資料：opts.model／goal（公司概覽有 detail.model 及 biz.goal）、canvas（有 canvas.json）、linked（假設連到格）、confirmed（已確認）
function seed({ model = true, goal = true, canvas = true, linked = true, confirmed = true, sugCell = 'revenue' } = {}) {
  const page = clone(BASE_PAGE);
  if (goal && !pickPlan(page, 'biz.goal')) {
    const at = page.detail.reading.findIndex(item => item.plan === 'biz.type') + 1;
    page.detail.reading.splice(at, 0, { id: 'biz-goal', plan: 'biz.goal', label: N.ui.goalLabel, kind: 'choice', value: N.ui.goal_steady, origin: 'ai', picked: true, why: N.ui.goalWhy, options: ['fast', 'steady', 'scale', 'raise', 'open'].map(k => ({ text: N.ui['goal_' + k], ...(k === 'steady' ? { rec: true } : {}) })) });
  }
  if (model) page.detail.model = clone(MODEL);
  write(pageFile, page);
  for (const f of ['founder-ops.json', 'canvas.json', 'confirmed.json']) fs.rmSync(path.join(DATA, 'ledger', f), { force: true });
  const values = {};
  (function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'label' in o && 'value' in o) values[o.id] = String(o.value ?? ''); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); })(page);
  if (confirmed) write(path.join(DATA, 'ledger', 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(m => m.id), values, edits: [], stillMissing: [], note: '' });
  const as = linked ? [{ id: 'a1', text: '首批訂戶已付首月訂閱費。', grade: 'paid', cell: 'revenue', milestoneIds: [] }, { id: 'a2', text: '工房已按約定供貨。', grade: 'did', cell: 'partners', milestoneIds: [] }, { id: 'a3', text: '上班族表示需要新鮮豆。', grade: 'said', cell: 'customer', milestoneIds: [] }]
    : [{ id: 'a1', text: '舊假設，未連到任何格。', grade: 'guess' }];
  write(path.join(DATA, 'ledger', 'state.json'), { company: { assumptions: as }, tasks: [], events: [], inputs: [], founderOpsDone: [] });
  if (canvas) {
    const cell = (key, tag) => ({ text: key === 'relationship' ? '' : String((pickPlan(page, 'canvas.' + key) || {}).value || ''), tag: key === 'relationship' ? 'open' : tag });
    const tags = { partners: 'mine', activities: 'zero', resources: 'zero', value: 'zero', relationship: 'open', channel: 'pick', customer: 'pick', cost: 'zero', revenue: 'zero' };
    const cells = Object.fromEntries(Object.entries(tags).map(([k, t]) => [k, cell(k, t)]));
    cells.customer.sub = { problem: { text: String((pickPlan(page, 'canvas.problem') || {}).value || ''), tag: 'pick' }, alternatives: { text: String((pickPlan(page, 'canvas.alternatives') || {}).value || ''), tag: 'pick' } };
    const old = clone(cells); old.revenue = { text: OLD_REVENUE, tag: 'zero' };
    write(path.join(DATA, 'ledger', 'canvas.json'), { pageId: page.page.id, rev: 1, at: new Date().toISOString(), cells, history: [{ rev: 0, at: new Date(Date.now() - 86400000).toISOString(), cells: old, why: '測試上一版' }],
      suggestions: [{ id: 'sug-rv', cell: sugCell, now: sugCell === 'problem' ? cells.customer.sub.problem.text : cells[sugCell].text, text: SUG_TEXT, why: '測試長期付款意願。', from: 'checkup', at: new Date().toISOString(), state: 'open', packId: '' }] });
  }
  return page;
}

const servers = [];
const startServer = (data, port) => { const child = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore', windowsHide: true }); servers.push(child); return child; };
let chrome;
try {
  const page = seed();
  startServer(DATA, PORT);
  if (!await waitFor(async () => (await fetch(BASE + '/api/health')).ok)) throw new Error('伺服器未起');
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  const ev = e => chrome.ev(e);
  const open = async (base, url, width) => { await chrome.send('Page.navigate', { url: 'about:blank' }); await sleep(300); await chrome.go(base + url, width, 1300); await waitFor(() => ev('document.body.innerText.length>0')); };
  const api = async () => (await fetch(BASE + '/api/canvas')).json();
  async function clickText(label, within = '') {
    const sel = await ev(inPage(`const root=${within ? `document.querySelector(${J(within)})` : 'document'};if(!root)return null;const e=clickables(root).find(e=>txt(e)===${J(label)});return e?mark(e):null;`));
    if (!sel) return false; await chrome.click(sel); return true;
  }
  const stubPrompt = value => ev(`window.prompt=function(){return ${J(value)}};true`);
  // 修改一格：先按格內按鈕；畫面若改用頁內輸入框，就在格內填寫後按保存
  async function editCell(area, value, root) {
    await stubPrompt(value);
    const sel = await ev(inPage(`const c=document.querySelector(${J(root + ' .cv-' + area)});if(!c)return null;const b=c.querySelector('.cv-edit')||clickables(c).find(x=>!/採用|不採用|自己改|跟 Zero|自己寫/.test(txt(x)))||c;return mark(b);`));
    if (!sel) return false;
    await chrome.click(sel); await sleep(500);
    const input = await ev(inPage(`const c=document.querySelector(${J(root + ' .cv-' + area)});const t=c&&[...c.querySelectorAll('textarea,input[type=text],input:not([type])')].find(vis);return t?mark(t):null;`));
    if (input) { await chrome.type(input, value); for (const label of [N.ui.jrCellSave, N.ui.save, '保存', '儲存']) if (label && await clickText(label, root + ' .cv-' + area)) break; }
    return true;
  }
  const view = (root) => ev(inPage(`const r=document.querySelector(${J(root)});if(!r)return {found:false,cells:0,text:'',overlap:0,bgs:0,buttons:[],hscroll:document.documentElement.scrollWidth>innerWidth,english:[],cardIds:[]};
    const cells=[...r.querySelectorAll('.cv-cell')].filter(vis);const rects=cells.map(c=>c.getBoundingClientRect());
    let overlap=0;for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];const w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);if(w>2&&h>2)overlap++;}
    const bgs=[...new Set(cells.map(c=>getComputedStyle(c).backgroundColor))];
    return {found:true,cells:cells.length,text:r.innerText,overlap,bgs:bgs.length,top:Math.round(r.getBoundingClientRect().top+scrollY),left:Math.round(r.getBoundingClientRect().left),
      buttons:clickables(r).map(txt),hscroll:document.documentElement.scrollWidth>innerWidth,english:${J(EN)}.filter(x=>r.innerText.includes(x)),cardIds:(r.innerText.match(/\\b[CS]\\d{2}\\b/g)||[])};`));
  const faceNames = [S01.name, C13.name, C26.name];

  /* ---------- Opus 覆核第 11 項：過時版本號的修改回 409 ---------- */
  const postCanvas = body => fetch(BASE + '/api/canvas', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: J(body) });
  const revNow = (await api()).view?.rev;
  const staleEdit = await postCanvas({ action: 'edit', cell: 'value', text: EDIT_VALUE, forRev: Number(revNow) - 1 });
  const freshEdit = await postCanvas({ action: 'edit', cell: 'value', text: EDIT_VALUE, forRev: revNow });
  ok('OPUS-11 送出過時版本號（forRev）的修改回 409；現行版本號照常接受', staleEdit.status === 409 && freshEdit.status === 202, { rev: revNow, stale: staleEdit.status, fresh: freshEdit.status });
  seed();
  // 第二輪覆核第 1 項：公司概覽已換新（已確認的是舊一份）時，修改九格回 409，不可回 202 再在合併時靜默丟棄
  { const changed = clone(JSON.parse(fs.readFileSync(pageFile, 'utf8'))); changed.page.id = changed.page.id + '-new'; write(pageFile, changed);
    const r1 = await postCanvas({ action: 'edit', cell: 'value', text: EDIT_VALUE, forRev: (await api()).view?.rev ?? 1 });
    const r1s = await postCanvas({ action: 'suggestion', id: 'sug-rv', choice: 'adopt', text: '' });
    ok('R2-1a 公司概覽不是已確認的那一份：修改九格及回應建議都回 409', r1.status === 409 && r1s.status === 409, { edit: r1.status, suggestion: r1s.status });
    seed(); }

  /* ---------- 1. 公司現況小卡（測試公司） ---------- */
  await open(BASE, '/dashboard', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-mini .cv-cell').length===9`));
  const mini = await view('#canvas-mini');
  // 0.44.0 主線決定：小卡在「業務路徑／待決事項」之下獨佔一行（放右欄會令左欄留大片空白），左邊與業務路徑對齊
  const pos = await ev(inPage(`const n=document.querySelector('#needs'),s=document.querySelector('#strip'),m=document.querySelector('#canvas-mini');if(!n||!s||!m)return null;const a=n.getBoundingClientRect(),c=s.getBoundingClientRect(),b=m.getBoundingClientRect();return {needsBottom:Math.round(a.bottom),stripBottom:Math.round(c.bottom),miniTop:Math.round(b.top),stripLeft:Math.round(c.left),miniLeft:Math.round(b.left)};`));
  ok('CV-1-1 公司現況小卡：在「業務路徑／待決事項」之下獨佔一行，九格、證據級顏色（至少兩種底色）', mini.found && mini.cells === 9 && mini.bgs >= 2 && !!pos && pos.miniTop >= Math.max(pos.needsBottom, pos.stripBottom) - 2 && Math.abs(pos.miniLeft - pos.stripLeft) <= 24, { mini: { ...mini, text: mini.text && mini.text.slice(0, 300) }, pos });
  ok('CV-1-2 公司現況小卡：最弱一句、面向標籤（中文名）、「看全圖」，零卡號、零英文名', mini.found && mini.text.includes('最弱') && faceNames.every(n => mini.text.includes(n)) && mini.buttons.includes(N.ui.cvSeeAll) && !mini.cardIds.length && !mini.english.length, { text: mini.text, buttons: mini.buttons, english: mini.english });
  await clickText(N.ui.cvSeeAll, '#canvas-mini');
  const went = await waitFor(() => ev(`location.pathname==='/proofread.html'`), 10000);
  ok('CV-1-3 按「看全圖」去公司概覽的九格全圖', !!went && !!await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`), 15000), await ev('location.href'));

  /* ---------- 2. 公司概覽九格全圖 ---------- */
  await open(BASE, '/proofread.html', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
  const full = await view('#canvas-confirmed');
  const origins = ['origin_mine', 'origin_pick', 'origin_zero', 'origin_open'].map(k => N.ui[k]);
  ok('CV-2-1 公司概覽九格全圖：九格、四種出處標籤、證據級及依據、來源一行', full.found && full.cells === 9 && origins.every(o => full.text.includes(o)) && full.text.includes('首批訂戶已付首月訂閱費') && full.text.includes(N.ui.cvCredit), { cells: full.cells, origins: origins.filter(o => !full.text.includes(o)), text: full.text && full.text.slice(0, 600) });
  ok('CV-2-2 修改建議並排：現在的寫法、Zero 建議的寫法、採用／不採用／自己改', full.text.includes(N.ui.cvNowText) && full.text.includes(N.ui.cvNewText) && full.text.includes(SUG_TEXT) && [N.ui.cvAdopt, N.ui.cvReject, N.ui.cvOwnEdit].every(b => full.buttons.includes(b)), { buttons: full.buttons });
  ok('CV-2-3 面向標籤只用中文名，收起時零英文名、零卡號', faceNames.every(n => full.text.includes(n)) && !full.english.length && !full.cardIds.length, { english: full.english, cardIds: full.cardIds });
  // 4a 模式說明
  const notes = await ev(inPage(`const d=[...document.querySelectorAll('#canvas-confirmed details')].find(x=>txt(x.querySelector('summary')||x).startsWith(${J(N.ui.cvModelNotes)}));if(!d)return {found:false};d.open=true;return {found:true,text:d.innerText};`));
  const enLine = N.t('cvModelNameEn', { name: C13.name, en: C13.en });
  ok('CV-4a 模式說明展開：有英文名的卡寫「中文名（英文名）」，沒有英文名的只寫中文名', notes.found && notes.text.includes(enLine) && notes.text.includes(S01.name) && !notes.text.includes(S01.name + '（'), { notes, want: enLine, noEn: S01.name });
  // 上一版
  await clickText(N.ui.cvPrevVer, '#canvas-confirmed') || await clickText(N.ui.cvPrevVer);
  await sleep(800);
  const prev = await view('#canvas-confirmed');
  ok('CV-2-4 查看上一版：顯示上一版的收入格，並可返回現在的版本', prev.text.includes(OLD_REVENUE) && (prev.buttons.includes(N.ui.cvBackNow) || (await view('body')).buttons.includes(N.ui.cvBackNow)), { text: prev.text && prev.text.slice(0, 500), buttons: prev.buttons });
  ok('OPUS-14a 查看上一版：畫面沒有文字「null」', !!prev.found && !/null/.test(prev.text), { found: prev.found, text: prev.text && prev.text.slice(0, 400) });
  // 修改一格後重讀
  await open(BASE, '/proofread.html', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
  const rev0 = (await api()).view?.rev;
  await editCell('va', EDIT_VALUE, '#canvas-confirmed');
  const edited = await waitFor(async () => (await api()).view?.cells?.value?.text === EDIT_VALUE, 10000);
  await open(BASE, '/proofread.html', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
  const afterEdit = await view('#canvas-confirmed');
  ok('CV-2-5 修改一格後重讀頁面：顯示新值', !!edited && afterEdit.text.includes(EDIT_VALUE), { rev0, api: (await api()).view?.cells?.value, shown: afterEdit.text && afterEdit.text.includes(EDIT_VALUE) });
  // 主線全面審查 2026-11-12 第一項：格內編輯不可丟失輸入（伺服器只收 300 字；先寫失敗測試）
  {
    seed();
    await open(BASE, '/proofread.html', 1440);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
    const editSel = await ev(inPage(`const c=document.querySelector('#canvas-confirmed .cv-va');const b=c&&c.querySelector('.cv-edit');return b?mark(b):null;`));
    if (editSel) { await chrome.click(editSel); await sleep(400); }
    const box = await ev(`(()=>{const t=document.querySelector('#canvas-confirmed .cv-va textarea');return t?{maxLength:t.maxLength}:null})()`);
    ok('CV-2-7 九格格內編輯框最多 300 字（與伺服器上限一致）', box && box.maxLength === 300, box);
    const KEEP = '測試：伺服器拒絕時這段文字要保留。';
    await ev(`(()=>{const f=window.fetch;window.fetch=function(u,o){if(String(u).includes('/api/canvas')&&o&&String(o.body||'').includes('"action":"edit"'))return Promise.resolve(new Response(JSON.stringify({ok:false,error:'invalid',message:${J(N.ui.errGeneric)}}),{status:400,headers:{'Content-Type':'application/json'}}));return f.apply(this,arguments)};const t=document.querySelector('#canvas-confirmed .cv-va textarea');if(t){t.value=${J(KEEP)};t.dispatchEvent(new Event('input',{bubbles:true}));}return true})()`);
    await clickText(N.ui.jrCellSave, '#canvas-confirmed .cv-va');
    await sleep(900);
    const kept = await ev(`(()=>{const t=document.querySelector('#canvas-confirmed .cv-va textarea'),s=document.querySelector('#toast');return {open:!!t,value:t?t.value:null,toast:s&&!s.hidden?s.textContent.trim():''}})()`);
    ok('CV-2-8 伺服器拒絕：編輯框不關、內容仍在，並顯示原因', kept.open && kept.value === KEEP && !!kept.toast, kept);
    // 修改建議「自己改」：同樣有 300 字上限，伺服器拒絕時不丟失輸入
    seed();
    await open(BASE, '/proofread.html', 1440);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
    await clickText(N.ui.cvOwnEdit, '#canvas-confirmed .cv-rv'); await sleep(400);
    const sugBox = await ev(`(()=>{const t=document.querySelector('#canvas-confirmed .cv-rv textarea');return t?{maxLength:t.maxLength}:null})()`);
    ok('CV-2-9 修改建議「自己改」編輯框最多 300 字', sugBox && sugBox.maxLength === 300, sugBox);
    await ev(`(()=>{const f=window.fetch;window.fetch=function(u,o){if(String(u).includes('/api/canvas')&&o&&String(o.body||'').includes('"action":"suggestion"'))return Promise.resolve(new Response(JSON.stringify({ok:false,error:'invalid',message:${J(N.ui.errGeneric)}}),{status:400,headers:{'Content-Type':'application/json'}}));return f.apply(this,arguments)};const t=document.querySelector('#canvas-confirmed .cv-rv textarea');if(t){t.value=${J(KEEP)};}return true})()`);
    await clickText(N.ui.jrCellSave, '#canvas-confirmed .cv-rv');
    await sleep(900);
    const keptSug = await ev(`(()=>{const t=document.querySelector('#canvas-confirmed .cv-rv textarea'),s=document.querySelector('#toast');return {open:!!t,value:t?t.value:null,toast:s&&!s.hidden?s.textContent.trim():''}})()`);
    ok('CV-2-10 修改建議「自己改」伺服器拒絕：編輯框不關、內容仍在，並顯示原因', keptSug.open && keptSug.value === KEEP && !!keptSug.toast, keptSug);
  }
  // 修改建議三種回應，每次用新的測試資料
  for (const [label, choice, want] of [[N.ui.cvAdopt, 'adopted', SUG_TEXT], [N.ui.cvReject, 'rejected', null], [N.ui.cvOwnEdit, 'edited', OWN_TEXT]]) {
    seed();
    await open(BASE, '/proofread.html', 1440);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
    const before = (await api()).view?.cells?.revenue?.text;
    await stubPrompt(OWN_TEXT);
    const clicked = await clickText(label, '#canvas-confirmed');
    await sleep(600);
    const input = await ev(inPage(`const r=document.querySelector('#canvas-confirmed .cv-rv');const t=r&&[...r.querySelectorAll('textarea,input[type=text],input:not([type])')].find(vis);return t?mark(t):null;`));
    if (input) { await chrome.type(input, OWN_TEXT); for (const l of [N.ui.jrCellSave, N.ui.save, '保存']) if (l && await clickText(l, '#canvas-confirmed')) break; }
    const result = await waitFor(async () => { const v = (await api()).view; const s = (v?.suggestions || []).find(x => x.id === 'sug-rv'); return s && s.state !== 'open' ? v : null; }, 10000);
    const s = result && result.suggestions.find(x => x.id === 'sug-rv');
    const revenue = result && result.cells?.revenue?.text;
    await open(BASE, '/proofread.html', 1440);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`));
    const shown = (await view('#canvas-confirmed')).text || '';
    ok('CV-2-6 修改建議「' + label + '」（新資料）：建議改為 ' + choice + '，收入格' + (want ? '更新並保留上一版' : '不變'), clicked && s?.state === choice && revenue === (want || before) && shown.includes(want || before) && (!want || (result.history || []).length === 2), { clicked, state: s && s.state, revenue, before, history: result && (result.history || []).length });
  }

  /* ---------- Opus 覆核第 14 項：建議對準「對方的問題」時，「現在的寫法」顯示問題原文 ---------- */
  seed({ sugCell: 'problem' });
  await open(BASE, '/proofread.html', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`), 15000);
  const probText = String((pickPlan(page, 'canvas.problem') || {}).value || ''), custText = String((pickPlan(page, 'canvas.customer') || {}).value || '');
  const nowBox = await ev(inPage(`const r=document.querySelector('#canvas-confirmed');if(!r)return null;const lab=[...r.querySelectorAll('*')].find(e=>vis(e)&&e.children.length===0&&txt(e)===${J(N.ui.cvNowText)});if(!lab)return null;let b=lab.parentElement;while(b&&b!==r&&txt(b)===txt(lab))b=b.parentElement;return txt(b);`));
  ok('OPUS-14b 建議對準對方的問題：「現在的寫法」顯示問題原文，不是客戶格文字', !!nowBox && nowBox.includes(probText) && !nowBox.includes(custText), { nowBox, problem: probText, customer: custText });
  seed();

  /* ---------- 3. 確認前的公司概覽 ---------- */
  seed({ canvas: false, confirmed: false });
  await open(BASE, '/proofread.html', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`), 15000);
  const pre = await view('#canvas-confirmed');
  const preRv = await ev(inPage(`const r=document.querySelector('#canvas-confirmed .cv-rv');return r?r.innerText:'';`));
  const revenueNow = String((pickPlan(page, 'canvas.revenue') || {}).value || '');
  ok('CV-3-1 確認前：九格全圖（沒有證據級及修改建議），收入格並排「Zero 建議」的另一種收錢方法，原定做法不變', pre.found && pre.cells === 9 && !pre.buttons.includes(N.ui.cvAdopt) && preRv.includes(MODEL.altCharge.text) && preRv.includes(revenueNow) && (preRv.includes(N.ui.cvAltCharge) || preRv.includes(N.ui.origin_zero)), { cells: pre.cells, revenueCell: preRv, buttons: pre.buttons });
  ok('OPUS-14c 確認前收入格的另一種收錢方法有「Zero 建議」標籤', preRv.includes(MODEL.altCharge.text) && preRv.includes(N.ui.origin_zero), { revenueCell: preRv });
  await editCell('va', EDIT_VALUE, '#canvas-confirmed');
  await sleep(500);
  const preEdited = (await view('#canvas-confirmed')).text.includes(EDIT_VALUE);
  await chrome.send('Page.reload'); await sleep(1500);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`), 15000);
  const preKept = (await view('#canvas-confirmed')).text.includes(EDIT_VALUE);
  ok('CV-3-2 確認前：九格可用現有逐欄修改改動，重讀頁面後保留', preEdited && preKept, { preEdited, preKept });
  // Opus 覆核第 7 項：確認前可改生意類型及想做成哪種生意（沿用 ed() 逐欄修改，data-k 為「r~欄位 id」）
  const typeId = (pickPlan(page, 'biz.type') || {}).id;
  const editors = await ev(inPage(`return {type:!![...document.querySelectorAll('[data-k$="~'+${J(typeId)}+'"]')].find(vis),goal:!![...document.querySelectorAll('[data-k$="~biz-goal"]')].find(vis)};`));
  const goalSel = await ev(inPage(`const e=[...document.querySelectorAll('[data-k$="~biz-goal"]')].find(vis);return e?mark(e):null;`));
  if (goalSel) { await chrome.click(goalSel); await sleep(500); await clickText(N.ui.goal_fast); await sleep(500); }
  const goalShown = await ev(inPage(`const e=[...document.querySelectorAll('[data-k$="~biz-goal"]')].find(vis);return e?txt(e):'';`));
  ok('OPUS-7 確認前公司概覽可改生意類型及想做成哪種生意', editors.type && editors.goal && goalShown.includes(N.ui.goal_fast), { editors, goalShown, typeId });

  /* ---------- 4. 舊資料：沒有 biz.goal、detail.model、canvas.json；假設全部沒有 cell ---------- */
  seed({ model: false, goal: false, canvas: false, linked: false });
  const errorsBefore = chrome.errors.length;
  await open(BASE, '/dashboard', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-mini .cv-cell').length===9`), 15000);
  const oldMini = await view('#canvas-mini');
  await open(BASE, '/proofread.html', 1440);
  await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`), 15000);
  const oldFull = await view('#canvas-confirmed');
  const oldApi = await api();
  ok('CV-4-1 舊資料：公司現況小卡及公司概覽照常顯示九格，GET /api/canvas 有九格，沒有程式錯誤', oldMini.cells === 9 && oldFull.cells === 9 && !!oldApi.view && chrome.errors.length === errorsBefore, { mini: oldMini.cells, full: oldFull.cells, api: !!oldApi.view, errors: chrome.errors.slice(errorsBefore) });
  ok('CV-4-2 舊資料（假設沒有 cell）：不顯示證據級顏色及「最弱」一句，改顯示 cvLevelsHidden', oldMini.bgs <= 1 && !oldMini.text.includes('最弱') && oldMini.text.includes(N.ui.cvLevelsHidden) && !oldFull.text.includes('最弱') && oldFull.text.includes(N.ui.cvLevelsHidden), { miniBgs: oldMini.bgs, mini: oldMini.text, full: oldFull.text && oldFull.text.slice(0, 400) });

  /* ---------- 5. 1440 及 390：沒有橫向捲動、九格不互相遮蓋 ---------- */
  seed();
  for (const width of [1440, 390]) {
    await open(BASE, '/proofread.html', width);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-confirmed .cv-cell').length===9`), 15000);
    const f = await view('#canvas-confirmed');
    await open(BASE, '/dashboard', width);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-mini .cv-cell').length===9`), 15000);
    const m = await view('#canvas-mini');
    const order = width < 600 ? await ev(inPage(`const n=document.querySelector('#needs'),m=document.querySelector('#canvas-mini');return n&&m?Math.round(m.getBoundingClientRect().top-n.getBoundingClientRect().bottom):null;`)) : 0;
    ok('CV-5 ' + width + ' 闊：公司概覽及公司現況沒有橫向捲動，九格不互相遮蓋' + (width < 600 ? '，手機小卡排在待決事項之後' : ''), f.cells === 9 && !f.hscroll && f.overlap === 0 && m.cells === 9 && !m.hscroll && m.overlap === 0 && (width >= 600 || (order !== null && order >= -2)), { full: { cells: f.cells, hscroll: f.hscroll, overlap: f.overlap }, mini: { cells: m.cells, hscroll: m.hscroll, overlap: m.overlap }, order });
  }

  /* ---------- 6. 示範公司的小卡 ---------- */
  const DEMO = path.join(RUN, 'demo');
  seedDemo(DEMO, { reset: true });
  await certifyDirect(DEMO, PROTO, ADAPTER);
  startServer(DEMO, PORT + 2);
  const DB = `http://127.0.0.1:${PORT + 2}`;
  if (await waitFor(async () => (await fetch(DB + '/api/health')).ok)) {
    await usePass(DB, chrome);
    await open(DB, '/dashboard', 1440);
    await waitFor(() => ev(`document.querySelectorAll('#canvas-mini .cv-cell').length===9`), 15000);
    const dm = await view('#canvas-mini');
    ok('CV-1-4 示範公司：公司現況小卡九格、證據級顏色、最弱一句、看全圖', dm.cells === 9 && dm.bgs >= 2 && dm.text.includes('最弱') && dm.buttons.includes(N.ui.cvSeeAll) && !dm.cardIds.length, { cells: dm.cells, bgs: dm.bgs, text: dm.text && dm.text.slice(0, 300), buttons: dm.buttons });
  } else ok('CV-1-4 示範公司伺服器未起', false, DB);
  ok('CV-99 頁面沒有程式錯誤', !chrome.errors.length, chrome.errors);
} catch (error) { ok('CV-驗收中斷', false, String(error.stack || error)); }
chrome?.close();
for (const s of servers) s.kill();
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n  實際：' + JSON.stringify(result.info).slice(0, 1500)));
console.log(`${results.filter(result => result.pass).length}/${results.length} 通過`);
process.exitCode = results.every(result => result.pass) ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 300);
