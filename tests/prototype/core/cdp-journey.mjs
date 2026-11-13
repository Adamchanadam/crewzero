// 開局旅程頁面驗收（接口文件第 5 節；派工單 brief-c.md 第 5 節 cdp-journey 項目 1–5；已批原型 entry-journey-2026-11-10/journey.html）。
// 用真實點擊、假 AI 及獨立暫存資料，1440 及 390 闊各走一次五步全程，另驗再提三個、上一步（第 13 行）、再開、失敗再試、舊草稿、舊格式。
// 用法：node cdp-journey.mjs <Chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
//
// 選擇器假設（畫面正在按原型重做，盡量只靠 names.js 字句、aria 及幾何位置）：
//   - 按鈕一律按 names.js 字句找（jrPathThinkGo、jrPick、jrNext、jrCellZero 等），只限看得見、未停用的 button／a／[role=button]／[role=radio]。
//   - 一句構思輸入框：#jr-say，沒有就用第一個看得見的 textarea。
//   - 頂部步驟條：任何一個 ol／ul，剛好五項，依次含 jrS1–jrS5 字句；1440 闊時五項同一橫行。
//   - 縮小生意模式圖：[aria-label=names.js jrMiniLabel]，裏面九格，頁面另有「已填 n / 9 格」（jrMiniCap）。
//   - 卡片：以卡上標題（對象名稱或組合名稱）找出各自最大的祖先元素（不含其他卡標題）；1440 闊三張同一 top，390 闊三張所在的一行可左右捲動。
//   - 底部操作列：含「第 n 步，共 5 步」（jrBarStep）的元素，其祖先 position 為 fixed 或 sticky，貼近視窗底部。
//   - 第 5 步九格沿用 canvas.js 的 .cv-cell 及 .cv-<area>（area 代號取自 canvas-lib CELLS，接口文件第 2 節）。
//   - 「決定」的數法（原型 index.html 每個畫面的決定清單）：可按元素中，同一字句、同一父元素、或同一個非通用 class 的歸作一個決定；
//     上一步、下一步、跟 Zero 建議、再試一次及「模式說明」展開不計；只計旅程容器 #jr-journey 內（沒有就用含步驟條及底部操作列的最小祖先）
//     步驟條以下的內容及底部操作列，頁腳等全頁工具不計。
//   - 第 2 步手機版：原型 @media 把對象卡改為上下排，只有第 3 步組合卡左右掃（journey.html 第 205、208 行）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PORT = Number(PORT_TEXT), results = [];
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const MC = await import(pathToFileURL(path.join(PROTO, 'model-cards-lib.mjs')).href);
const LIB = MC.loadModelCards(PROTO);
const EN = [...new Set(LIB.cards.concat(LIB.extras).flatMap(card => card.en ? [card.en, ...card.en.split(/[／/]/)] : []).map(s => s.trim()).filter(s => s.length >= 4))];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info: pass ? '' : info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const J = JSON.stringify;
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { let v = null; try { v = await fn(); } catch { } if (v) return v; await sleep(250); } return null; }
const SAY = '把本地小型烘焙工房的新鮮咖啡豆，賣給愛喝咖啡的上班族。';
const OWN = '咖啡豆、包裝及寄送成本，待我向工房報價。';
const EXCLUDE = [N.ui.jrPrev, N.ui.jrNext, N.ui.jrFollowZero, N.ui.jrCellZero, N.ui.ideateRetry, N.ui.cvModelNotes];
const GENERIC = ['btn', 'primary', 'small', 'big', 'link', 'zero', 'go', 'main', 'on', 'cur', 'rec', 'picked', 'accent', 'ok'];

// 頁面內共用的小工具（每次 evaluate 前置）
const H = `const vis=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
const txt=e=>(e.textContent||'').replace(/\\s+/g,' ').trim();
const clickables=root=>[...(root||document).querySelectorAll('button,a[href],[role=button],[role=radio],summary')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');
const mark=e=>{const id='cz'+Math.random().toString(36).slice(2);e.setAttribute('data-czt',id);return '[data-czt="'+id+'"]';};
const STEPS=${J(['jrS1', 'jrS2', 'jrS3', 'jrS4', 'jrS5'].map(k => N.ui[k]))};
const track=()=>[...document.querySelectorAll('ol,ul')].find(l=>vis(l)&&l.children.length===5&&[...l.children].every((li,i)=>txt(li).includes(STEPS[i])));
const docTop=e=>e.getBoundingClientRect().top+scrollY;`;
const inPage = body => `(()=>{${H}\n${body}})()`;

freshTestOut(OUT);
const RUN = makeTestTemp('crewzero-cdp-journey-');
const servers = [];
async function world(name, port) {
  const data = path.join(RUN, name);
  fs.mkdirSync(data, { recursive: true });
  await certifyDirect(data, PROTO, ADAPTER);
  const child = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore', windowsHide: true });
  servers.push(child);
  const base = `http://127.0.0.1:${port}`;
  if (!await waitFor(async () => (await fetch(base + '/api/health')).ok, 20000)) throw new Error(name + ' 伺服器未起');
  return { name, data, base, api: async () => (await (await fetch(base + '/api/intake')).json()).ideate, file: () => read(path.join(data, 'ledger', 'ideate.json')), mode: m => fs.writeFileSync(path.join(data, 'fake-mode.txt'), m + '\n'), starts: () => { try { return fs.readFileSync(path.join(data, 'ledger', 'ai-starts.log'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } } };
}

let chrome;
try {
  const A = await world('walk-1440', PORT), B = await world('walk-390', PORT + 2), S = await world('scenes', PORT + 3);
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1);
  for (const w of [A, B, S]) await usePass(w.base, chrome);
  const ev = e => chrome.ev(e);
  // 先到空白頁再開，確保每次都是重新載入（同一網址只改 hash 不會重載）
  const open = async (w, width) => { await chrome.send('Page.navigate', { url: 'about:blank' }); await sleep(300); await chrome.go(w.base + '/#/intake', width, 1200); await waitFor(() => ev('document.body.innerText.length>0')); };
  const shown = t => ev(inPage(`return document.body.innerText.includes(${J(t)});`));
  const waitShown = (t, ms = 30000) => waitFor(() => shown(t), ms);
  async function clickText(label, { nth = 0, within = '' } = {}) {
    const sel = await ev(inPage(`const root=${within ? `document.querySelector(${J(within)})` : 'document'};if(!root)return null;const list=clickables(root).filter(e=>txt(e)===${J(label)});const e=list[${nth}];return e?mark(e):null;`));
    if (!sel) return false;
    await chrome.click(sel); return true;
  }
  const waitApi = (w, pred, ms = 45000) => waitFor(async () => { const s = await w.api(); return s && pred(s) ? s : null; }, ms);
  // 頂部步驟條、縮小生意模式圖、底部操作列、橫向捲動、卡號、英文名、決定數
  const layout = n => ev(inPage(`const t=track(),items=t?[...t.children].map(li=>Math.round(li.getBoundingClientRect().top)):[];
    const mini=document.querySelector('[aria-label=${J(N.ui.jrMiniLabel)}]');
    const cap=(document.body.innerText.match(/已填\\s*\\d+\\s*\\/\\s*9\\s*格/)||[''])[0];
    const barLabel=${J(N.t('jrBarStep', { n }))};
    const holders=[...document.querySelectorAll('body *')].filter(e=>vis(e)&&txt(e).includes(barLabel)&&txt(e).length<200);const holder=holders[0]||null;
    let fixed=null;for(const hd of holders){for(let e=hd;e&&e!==document.body;e=e.parentElement){const p=getComputedStyle(e).position;if(p==='fixed'||p==='sticky'){fixed=e;break;}}if(fixed)break;}
    const fr=fixed&&fixed.getBoundingClientRect();
    return {track:!!t,trackTops:items,mini:!!mini,miniCells:mini?mini.children.length:0,miniTop:mini?Math.round(mini.getBoundingClientRect().top):null,trackTop:t?Math.round(t.getBoundingClientRect().top):null,caption:cap,
      bar:!!holder,barFixed:!!fixed,barGap:fr?Math.round(innerHeight-fr.bottom):null,
      hscroll:document.documentElement.scrollWidth>innerWidth,cardIds:(document.body.innerText.match(/\\b[CS]\\d{2}\\b/g)||[]),
      english:${J(EN)}.filter(x=>document.body.innerText.includes(x))};`));
  const decisions = n => ev(inPage(`const t=track(),line=t?docTop(t)+t.getBoundingClientRect().height:0,barLabel=${J(N.t('jrBarStep', { n }))};
    const ex=${J(EXCLUDE)},gen=${J(GENERIC)};
    const fx=e=>{for(let p=e;p&&p!==document.body;p=p.parentElement){const s=getComputedStyle(p).position;if(s==='fixed'||s==='sticky')return p;}return null;};
    const root=document.querySelector('#jr-journey')||(()=>{let r=t;const bar=[...document.querySelectorAll('body *')].find(e=>vis(e)&&txt(e).includes(barLabel)&&txt(e).length<200);while(r&&bar&&!r.contains(bar))r=r.parentElement;return r||document.body;})();
    const list=clickables(root).filter(e=>{if(ex.includes(txt(e)))return false;const f=fx(e);return f?txt(f).includes(barLabel):docTop(e)>=line;});
    const parent=list.map((e,i)=>i);const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));const join=(a,b)=>{parent[find(a)]=find(b);};
    const cls=e=>[...e.classList].filter(c=>!gen.includes(c)).sort().join('.');
    for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j];if(txt(a)===txt(b)||a.parentElement===b.parentElement||(cls(a)&&cls(a)===cls(b)))join(i,j);}
    const groups={};list.forEach((e,i)=>{(groups[find(i)]=groups[find(i)]||[]).push(txt(e).slice(0,20));});
    return Object.values(groups).map(g=>[...new Set(g)].join('／'));`));
  // 卡片：以標題找出各自的卡，回傳位置及所在一行能否左右捲動
  const cards = titles => ev(inPage(`const titles=${J(titles)};
    const boxes=titles.map(t=>{const h=[...document.querySelectorAll('h2,h3,h4,b,strong,span,p,div')].find(e=>vis(e)&&e.children.length===0&&txt(e)===t);if(!h)return null;let card=h;
      for(let p=h.parentElement;p&&p!==document.body;p=p.parentElement){const s=txt(p);if(titles.some(o=>o!==t&&s.includes(o)))break;card=p;}return card;});
    if(boxes.some(b=>!b))return {found:boxes.map(Boolean)};
    let row=boxes[0].parentElement;while(row&&!boxes.every(b=>row.contains(b)))row=row.parentElement;
    const r=boxes.map(b=>b.getBoundingClientRect());
    return {found:boxes.map(Boolean),tops:r.map(x=>Math.round(x.top)),lefts:r.map(x=>Math.round(x.left)),widths:r.map(x=>Math.round(x.width)),rowScroll:row?row.scrollWidth-row.clientWidth:0,rowOverflow:row?getComputedStyle(row).overflowX:''};`));
  const sideBySide = (c, width) => c && c.tops && (width >= 1000 ? Math.max(...c.tops) - Math.min(...c.tops) <= 4 && new Set(c.lefts).size === 3 : c.rowScroll > 20 && ['auto', 'scroll'].includes(c.rowOverflow));
  const textareaSel = async () => (await ev(`!!document.querySelector('#jr-say')`)) ? '#jr-say' : ev(inPage(`const t=[...document.querySelectorAll('textarea')].find(vis);return t?mark(t):null;`));

  /* ---------- 五步全程 ---------- */
  async function walk(w, width) {
    const tag = '（' + width + '）';
    await open(w, width);
    // 第 1 步：起點
    const l1 = await layout(1), d1 = await decisions(1);
    const s1 = { textarea: !!await textareaSel(), think: await shown(N.ui.jrPathThinkGo), fill: await shown(N.ui.jrPathFillGo), head: await shown(N.ui.jrStartHead) };
    ok('JRY-1-1 起點' + tag + '：一句構思、兩條路、步驟條五步、縮小生意模式圖九格及「已填 n / 9 格」', s1.textarea && s1.think && s1.fill && s1.head && l1.track && l1.mini && l1.miniCells === 9 && /已填\s*0\s*\/\s*9\s*格/.test(l1.caption), { s1, l1 });
    if (width >= 1000) ok('JRY-1-2 起點' + tag + '：步驟條橫向（五項同一橫行），縮小生意模式圖在頁頂', l1.trackTops.length === 5 && Math.max(...l1.trackTops) - Math.min(...l1.trackTops) <= 4 && l1.miniTop !== null && Math.abs(l1.miniTop - l1.trackTop) < 300, l1);
    ok('JRY-1-3 起點' + tag + '：決定不多於三個，無橫向捲動，零卡號', d1.length <= 3 && !l1.hscroll && !l1.cardIds.length, { decisions: d1, l1 });
    // 主線全面審查 02#A2：起點「附上文件」後要即時列出已加入的檔案及拒收原因，不清走已寫的構思
    if (width >= 1000) {
      const draftSay = '測試構思（附件前）';
      await chrome.type(await textareaSel(), draftSay);
      const goodFile = path.join(RUN, '構思補充.md'), badFile = path.join(RUN, '程式.exe');
      fs.writeFileSync(goodFile, '# 補充\n上班族每月訂咖啡豆。\n'); fs.writeFileSync(badFile, 'x');
      const setFiles = async files => { const dom = await chrome.send('DOM.getDocument', { depth: -1 }); const node = await chrome.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#jr-files' }); await chrome.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files }); };
      await setFiles([goodFile]); await sleep(500);
      const listed = await ev(`(()=>{const l=document.querySelector('#jr-file-list');return {list:l?l.innerText:'',say:(document.querySelector('#jr-say')||{}).value||''}})()`);
      ok('JRY-1-4 起點附上文件：檔案即時列出，已寫的構思仍在', listed.list.includes('構思補充.md') && listed.say === draftSay, listed);
      await setFiles([badFile]); await sleep(500);
      const err = await ev(`(()=>{const s=document.querySelector('.jr-start-body');return s?s.innerText:''})()`);
      ok('JRY-1-5 起點附上不接受的檔案：顯示拒收原因', err.includes('程式.exe') && err.includes('未被接納'), err.slice(0, 400));
      await ev(`(()=>{[...document.querySelectorAll('#jr-file-list button')].forEach(b=>b.click());return true})()`); await sleep(500);
      const cleared = await ev(`(()=>{const l=document.querySelector('#jr-file-list');return {n:l?l.querySelectorAll('button').length:-1,say:(document.querySelector('#jr-say')||{}).value||''}})()`);
      ok('JRY-1-6 起點移除檔案：清單即時更新，已寫的構思仍在', cleared.n === 0 && cleared.say === draftSay, cleared);
      await ev(`(()=>{const t=document.querySelector('#jr-say');if(t){t.value='';t.dispatchEvent(new Event('input',{bubbles:true}));}return true})()`);
    }
    await chrome.type(await textareaSel(), SAY);
    await clickText(N.ui.jrPathThinkGo);
    const who = await waitApi(w, s => s.state === 'choose' && s.step === 'who');
    await waitShown(N.ui.jrWhoHead, 15000);
    // 第 2 步：對象
    const titles2 = who ? who.who.options.map(o => o.who) : [];
    const c2 = await cards(titles2), l2 = await layout(2), d2 = await decisions(2);
    ok('JRY-2-1 對象' + tag + '：三張卡' + (width >= 1000 ? '並排（同一 top）' : '全部看得見（原型手機版上下排）'), !!who && (width >= 1000 ? sideBySide(c2, width) : c2.found && c2.found.every(Boolean)), { c2, titles2 });
    ok('JRY-2-2 對象' + tag + '：頂部步驟條、縮小生意模式圖及說明、底部操作列（第 2 步）', l2.track && l2.mini && l2.miniCells === 9 && !!l2.caption && l2.bar && l2.barFixed && l2.barGap !== null && l2.barGap <= 40, l2);
    ok('JRY-2-3 對象' + tag + '：決定不多於三個（另加跟 Zero 建議），無橫向捲動，零卡號', d2.length <= 3 && !l2.hscroll && !l2.cardIds.length, { decisions: d2, l2 });
    if (!await clickText(N.ui.jrPick)) await clickText(N.ui.jrFollowZero);
    if (!await waitApi(w, s => s.step !== 'who' || s.state !== 'choose', 4000)) await clickText(N.ui.jrNext);
    const model = await waitApi(w, s => s.state === 'choose' && s.step === 'model');
    await waitShown(N.ui.jrModelHead, 15000);
    // 第 3 步：生意模式
    const titles3 = model ? model.model.options.map(o => o.name) : [];
    const c3 = await cards(titles3), l3 = await layout(3), d3 = await decisions(3);
    ok('JRY-3-1 生意模式' + tag + '：三張組合卡' + (width >= 1000 ? '並排' : '可左右掃'), !!model && sideBySide(c3, width), { c3, titles3 });
    ok('JRY-3-2 生意模式' + tag + '：底部操作列（第 3 步），決定不多於三個，無橫向捲動，零卡號', l3.bar && l3.barFixed && d3.length <= 3 && !l3.hscroll && !l3.cardIds.length, { decisions: d3, l3 });
    const closed = await ev(inPage(`return {details:[...document.querySelectorAll('details')].filter(d=>vis(d)&&txt(d.querySelector('summary')||d).startsWith(${J(N.ui.cvModelNotes)})).length,open:[...document.querySelectorAll('details[open]')].length};`));
    ok('JRY-3-3 生意模式' + tag + '：每張組合卡有收起的「模式說明」，收起時零英文模式名稱', closed.details >= titles3.length && closed.open === 0 && !l3.english.length, { closed, english: l3.english });
    await ev(inPage(`document.querySelectorAll('details').forEach(d=>{d.open=true;});return true;`));
    const wantEn = model ? model.model.options.flatMap(o => Object.values(o.faces || {}).filter(Array.isArray).flat()).map(p => LIB.byId[p.card]).filter(c => c && c.en).map(c => N.t('cvModelNameEn', { name: c.name, en: c.en })) : [];
    const openText = await ev('document.body.innerText');
    ok('JRY-3-4 生意模式' + tag + '：展開「模式說明」後顯示「中文名（英文名）」', wantEn.length > 0 && wantEn.every(x => openText.includes(x)), { want: [...new Set(wantEn)], missing: wantEn.filter(x => !openText.includes(x)) });
    await ev(inPage(`document.querySelectorAll('details').forEach(d=>{d.open=false;});return true;`));
    if (width >= 1000) {
      // 請 Zero 再提出三個
      await clickText(N.ui.jrMoreModelsBtn);
      const more = await waitApi(w, s => s.state === 'choose' && s.step === 'model' && Number(s.model.asked) === 2);
      const newNames = more ? more.model.options.map(o => o.name) : [];
      await waitFor(() => shown(newNames[0] || '§'), 15000);
      ok('JRY-3-5 請 Zero 再提出三個：畫面換上三個新組合', !!more && newNames.length >= 2 && newNames.every(n => !titles3.includes(n)) && await shown(newNames[0]), { newNames, before: titles3 });
      const pickedTags = await ev(inPage(`return [...document.querySelectorAll('body *')].filter(e=>vis(e)&&e.children.length===0&&txt(e)===${J(N.ui.jrPicked)}).length;`));
      ok('OPUS-1p 再提三個後：新組合未選前，沒有卡標「已選」', pickedTags === 0, { pickedTags, pick: w.file()?.model?.pick });
      // 關閉頁面後再開，回到同一步
      await open(w, width);
      await waitShown(N.ui.jrModelHead, 15000);
      ok('JRY-3-6 關閉後再開：回到同一步（生意模式）及同一批組合', await shown(N.ui.jrModelHead) && newNames.length > 0 && await shown(newNames[0]), { head: await shown(N.ui.jrModelHead) });
    }
    if (!await clickText(N.ui.jrPick)) await clickText(N.ui.jrFollowZero);
    if (!await waitApi(w, s => s.step !== 'model', 4000)) await clickText(N.ui.jrNext);
    const goal = await waitApi(w, s => s.state === 'choose' && s.step === 'goal', 20000);
    await waitShown(N.ui.jrGoalHead, 15000);
    // 第 4 步：目標及第一個驗證
    const l4 = await layout(4), d4 = await decisions(4);
    const goalsShown = await ev(inPage(`return ${J(['fast', 'steady', 'scale', 'raise', 'open'].map(k => N.ui['goal_' + k]))}.filter(t=>document.body.innerText.includes(t)).length;`));
    ok('JRY-4-1 目標及第一個驗證' + tag + '：五個目標、第一個驗證、底部操作列（第 4 步）', !!goal && goalsShown === 5 && await shown(N.ui.jrTestQ) && await ev(inPage(`const w=${J(String(goal?.test?.text || '§'))};return document.body.innerText.includes(w)||[...document.querySelectorAll('textarea,input')].some(e=>vis(e)&&e.value===w);`)) && l4.bar && l4.barFixed, { goalsShown, l4, test: goal && goal.test });
    ok('JRY-4-2 目標及第一個驗證' + tag + '：決定不多於三個，無橫向捲動，零卡號', d4.length <= 3 && !l4.hscroll && !l4.cardIds.length, { decisions: d4, l4 });
    await clickText(N.ui.goal_steady);
    if (!await waitApi(w, s => s.step !== 'goal', 2500)) await clickText(N.ui.jrAdoptTest);
    if (!await waitApi(w, s => s.step !== 'goal', 2500)) await clickText(N.ui.jrNext);
    const cv = await waitApi(w, s => s.state === 'choose' && s.step === 'canvas');
    await waitFor(() => ev(`document.querySelectorAll('.cv-cell').length>=9`), 15000);
    // 第 5 步：生意模式圖
    const l5 = await layout(5), d5 = await decisions(5);
    const cells5 = await ev(inPage(`const c=[...document.querySelectorAll('.cv-cell')].filter(vis);const one=a=>{const e=document.querySelector('.cv-'+a);return e?{zero:clickables(e).some(b=>txt(b)===${J(N.ui.jrCellZero)}),own:clickables(e).some(b=>txt(b)===${J(N.ui.jrCellOwn)})}:null;};return {cells:c.length,cr:one('cr'),co:one('co')};`));
    ok('JRY-5-1 生意模式圖' + tag + '：九格，兩個未定格各有「跟 Zero 建議」及「自己寫」', !!cv && cells5.cells === 9 && cells5.cr?.zero && cells5.cr?.own && cells5.co?.zero && cells5.co?.own, cells5);
    ok('JRY-5-2 生意模式圖' + tag + '：決定不多於三個，底部操作列，無橫向捲動，零卡號', d5.length <= 3 && l5.bar && !l5.hscroll && !l5.cardIds.length, { decisions: d5, l5 });
    await clickText(N.ui.jrCellZero, { within: '.cv-cr' });
    const zeroed = await waitApi(w, s => s.canvas?.cells?.relationship?.tag === 'zero', 10000);
    ok('JRY-5-3 未定格按「跟 Zero 建議」' + tag + '：填入建議，標 Zero 建議', !!zeroed && await waitFor(() => shown(String(zeroed.canvas.cells.relationship.text || '§')), 10000), zeroed && zeroed.canvas.cells.relationship);
    // 主線全面審查（九格丟失輸入）：「自己寫」編輯框有上限（伺服器 setCell 收 1000 字）；伺服器拒絕時編輯框不關、內容仍在
    if (width >= 1000) {
      await clickText(N.ui.jrCellOwn, { within: '.cv-co' }); await sleep(500);
      const ownBox = await ev(`(()=>{const t=document.querySelector('.cv-co textarea');return t?{maxLength:t.maxLength}:null})()`);
      ok('JRY-5-7 「自己寫」編輯框最多 1000 字（與伺服器一致）', ownBox && ownBox.maxLength === 1000, ownBox);
      const KEEP = '測試：伺服器拒絕時這段自己寫的字要保留。';
      await ev(`(()=>{window.__jrFetch=window.fetch;window.fetch=function(u,o){if(String(u).includes('/api/ideate')&&o&&String(o.body||'').includes('"setCell"'))return Promise.resolve(new Response(JSON.stringify({ok:false,error:'invalid',message:'測試拒絕'}),{status:400,headers:{'Content-Type':'application/json'}}));return window.__jrFetch.apply(this,arguments)};const t=document.querySelector('.cv-co textarea');if(t){t.value=${J(KEEP)};}return true})()`);
      await clickText(N.ui.jrCellSave, { within: '.cv-co' }); await sleep(900);
      const kept = await ev(`(()=>{const t=document.querySelector('.cv-co textarea');return {open:!!t,value:t?t.value:null}})()`);
      ok('JRY-5-8 「自己寫」伺服器拒絕：編輯框不關、內容仍在', kept.open && kept.value === KEEP, kept);
      await ev(`(()=>{if(window.__jrFetch)window.fetch=window.__jrFetch;return true})()`);
    }
    await ev(`window.prompt=function(){return ${J(OWN)}};true`);
    await clickText(N.ui.jrCellOwn, { within: '.cv-co' });
    await sleep(600);
    const inline = await ev(inPage(`const e=document.querySelector('.cv-co');const t=e&&[...e.querySelectorAll('textarea,input[type=text],input:not([type])')].find(vis);return t?mark(t):null;`));
    if (inline) { await chrome.type(inline, OWN); await clickText(N.ui.jrCellSave, { within: '.cv-co' }); }
    const owned = await waitApi(w, s => s.canvas?.cells?.cost?.tag === 'mine' && s.canvas.cells.cost.text === OWN, 10000);
    ok('JRY-5-4 未定格「自己寫」' + tag + '：寫入自己的字，標你的原話', !!owned && await waitFor(() => shown(OWN), 10000), { inline: !!inline, cost: (await w.api())?.canvas?.cells?.cost });
    if (width >= 1000) {
      // 第 13 行：上一步保留之後各步；選擇不變再前進，不叫 AI，自己寫的格仍在
      const before = w.starts();
      await clickText(N.ui.jrPrev);
      const back = await waitApi(w, s => s.state === 'choose' && s.step === 'goal', 10000);
      await waitShown(N.ui.jrGoalHead, 10000);
      if (!await clickText(N.ui.jrNext)) await clickText(N.ui.jrAdoptTest);
      const fwd = await waitApi(w, s => s.state === 'choose' && s.step === 'canvas', 4000);
      await waitFor(() => ev(`document.querySelectorAll('.cv-cell').length>=9`), 10000);
      ok('JRY-13 上一步再按下一步（選擇不變）：不叫 AI，直接回到生意模式圖，自己寫的格仍在', !!back && !!fwd && w.starts() === before && fwd.canvas?.cells?.cost?.text === OWN && await shown(OWN), { back: !!back, fwd: fwd && fwd.canvas?.cells?.cost, aiStarts: [before, w.starts()] });
    }
    // 交出
    await clickText(N.ui.jrSubmit);
    const ready = await waitApi(w, s => s.state === 'ready', 15000);
    const waiting = await waitFor(() => ev(`!!document.querySelector('#track')||location.pathname==='/proofread.html'`), 20000);
    ok('JRY-5-5 交 Zero 擬公司概覽' + tag + '：旅程 ready，畫面回到等候公司概覽', !!ready && !!waiting, { ready: !!ready, url: await ev('location.href'), track: await ev(`!!document.querySelector('#track')`) });
  }
  for (const [w, width] of [[A, 1440], [B, 390]]) {
    try { await walk(w, width); } catch (error) { ok('JRY-全程（' + width + '）中斷', false, String(error.stack || error)); }
  }

  /* ---------- 失敗再試、已有八題草稿、舊格式 ---------- */
  try {
    S.mode('journey-who:fail');
    await open(S, 1440);
    await chrome.type(await textareaSel(), SAY);
    await clickText(N.ui.jrPathThinkGo);
    const failed = await waitApi(S, s => s.state === 'failed', 40000);
    await waitShown(N.ui.ideateRetry, 15000);
    ok('JRY-F1 journey-fail：失敗後顯示原因及「再試一次」', !!failed && await shown(N.ui.ideateRetry) && (!failed.reason || await shown(failed.reason)), failed && { step: failed.step, reason: failed.reason });
    await clickText(N.ui.ideateRetry);
    const back = await waitApi(S, s => s.state === 'choose' && s.step === 'who', 40000);
    ok('JRY-F2 按「再試一次」後完成同一步（對象）', !!back && !!await waitShown(N.ui.jrWhoHead, 15000), back && [back.state, back.step]);
  } catch (error) { ok('JRY-失敗再試中斷', false, String(error.stack || error)); }
  try {
    await ev(`localStorage.setItem('startup-os-intake-draft-v2',JSON.stringify({q1:'已有草稿'}));true`);
    await open(S, 1440);
    await waitFor(() => ev(`!!document.querySelector('#q1')`), 10000);
    const draft = await ev(inPage(`return {q1:document.querySelector('#q1')?.value,start:clickables().some(e=>txt(e)===${J(N.ui.jrPathThinkGo)})};`));
    ok('JRY-D1 已有八題草稿：直接顯示八題表格（舊行為不變）', draft.q1 === '已有草稿' && !draft.start, draft);
    await ev(`localStorage.removeItem('startup-os-intake-draft-v2');true`);
    fs.writeFileSync(path.join(S.data, 'ledger', 'ideate.json'), JSON.stringify({ id: 'old', state: 'running', say: '舊構思', rounds: [] }));
    await open(S, 1440);
    await waitShown(N.ui.jrUpgraded, 10000);
    const legacy = await ev(inPage(`const t=document.querySelector('#jr-say')||[...document.querySelectorAll('textarea')].find(vis);return {upgraded:document.body.innerText.includes(${J(N.ui.jrUpgraded)}),say:t?t.value:null};`));
    ok('JRY-D2 舊格式 ideate.json：顯示 jrUpgraded 並預填舊構思', legacy.upgraded && legacy.say === '舊構思', legacy);
  } catch (error) { ok('JRY-草稿及舊格式中斷', false, String(error.stack || error)); }
  /* ---------- Opus 覆核：第 4 項畫面零卡號、第 9 項舊預填、第 15 項等候逾時 ---------- */
  try {
    const sPost = (body) => fetch(S.base + '/api/ideate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S.base }, body: JSON.stringify(body) }).then(r => r.json().catch(() => null));
    const cur = S.file();
    if (cur) fs.writeFileSync(path.join(S.data, 'ledger', 'ideate.json'), JSON.stringify({ ...cur, state: 'closed' }));
    S.mode('journey-who:journey-cardids\njourney-model:journey-cardids\njourney-canvas:journey-cardids');
    await sPost({ action: 'start', text: SAY, files: [] });
    const hits = {};
    const seeStep = async (step, head) => { await open(S, 1440); await waitShown(head, 15000); hits[step] = await ev(inPage(`return (document.body.innerText.match(/\\b[CS]\\d{2}\\b/g)||[]);`)); };
    if (await waitApi(S, s => s.state === 'choose' && s.step === 'who')) await seeStep('who', N.ui.jrWhoHead);
    await sPost({ action: 'pickWho', pick: 0 });
    if (await waitApi(S, s => s.state === 'choose' && s.step === 'model')) await seeStep('model', N.ui.jrModelHead);
    await sPost({ action: 'pickModel', pick: 0 });
    const g = await waitApi(S, s => s.state === 'choose' && s.step === 'goal', 15000);
    await sPost({ action: 'setGoal', goal: g?.goal || 'open', test: { text: g?.test?.text || '' } });
    if (await waitApi(S, s => s.state === 'choose' && s.step === 'canvas')) { await open(S, 1440); await waitFor(() => ev(`document.querySelectorAll('.cv-cell').length>=9`), 15000); hits.canvas = await ev(inPage(`return (document.body.innerText.match(/\\b[CS]\\d{2}\\b/g)||[]);`)); }
    ok('OPUS-4p AI 三步輸出夾帶卡號：對象、組合、九格畫面零卡號', ['who', 'model', 'canvas'].every(k => Array.isArray(hits[k]) && hits[k].length === 0), hits);
  } catch (error) { ok('OPUS-4p 中斷', false, String(error.stack || error)); }
  try {
    const pfText = '舊預填第一題：把本地烘焙咖啡豆賣給上班族。';
    fs.mkdirSync(path.join(S.data, 'ledger', 'prefill'), { recursive: true });
    fs.writeFileSync(path.join(S.data, 'ledger', 'prefill', 'pf-legacy.json'), JSON.stringify({ id: 'pf-legacy', at: new Date().toISOString(), from: 'ideate', files: [], answers: { q1: { text: pfText, label: 'inferred', source: '與 Zero 的討論', at: '' } }, missing: ['q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'] }));
    fs.writeFileSync(path.join(S.data, 'ledger', 'ideate.json'), JSON.stringify({ id: 'legacy-ready', state: 'ready', say: '舊構思', prefillId: 'pf-legacy', round: 3, rounds: [] }));
    await ev(`localStorage.removeItem('startup-os-intake-draft-v2');true`);
    await open(S, 1440);
    await waitFor(() => ev(`!!document.querySelector('#q1')`), 10000);
    await waitFor(() => ev(inPage(`return document.body.innerText.includes(${J(pfText)})||document.querySelector('#q1')?.value===${J(pfText)};`)), 10000);
    const pf = await ev(inPage(`return {q1:document.querySelector('#q1')?.value||null,shown:document.body.innerText.includes(${J(pfText)}),start:clickables().some(e=>txt(e)===${J(N.ui.jrPathThinkGo)})};`));
    ok('OPUS-9 舊格式 ready 而有 prefillId：直接顯示八題表格並帶出舊預填', pf.q1 !== null && !pf.start && (pf.q1 === pfText || pf.shown), pf);
  } catch (error) { ok('OPUS-9 中斷', false, String(error.stack || error)); }
  try {
    const old = new Date(Date.now() - 30 * 60000).toISOString();
    fs.writeFileSync(path.join(S.data, 'ledger', 'ideate.json'), JSON.stringify({ v: 2, id: 'opus-stale', state: 'running', step: 'model', reason: '', updatedAt: old, say: SAY, files: [], who: { said: '', value: '', options: [{ who: '在家沖咖啡的上班族', pain: '沒有時間找新鮮豆。', now: '在超市買豆。', rec: true }], pick: 0, own: '' }, model: { said: '', options: [], pick: -1, asked: 1, exclude: [], goal: { suggest: 'open', why: '' } }, goal: 'open', goalBy: 'pick', test: { text: '', watch: '', counts: '', trap: '', edited: false }, canvas: { cells: {}, said: '' }, intakeId: '' }));
    // 上一項（OPUS-9）打開八題表格時已存八題草稿；按設計有草稿就直接顯示表格，所以先清走，才看得到旅程
    await ev(`localStorage.removeItem('startup-os-intake-draft-v2');localStorage.removeItem('startup-os-intake-draft');true`);
    await open(S, 1440);
    await waitShown(N.ui.ideateRetry, 10000);
    const stale = await ev(inPage(`return {retry:clickables().some(e=>txt(e)===${J(N.ui.ideateRetry)}),waiting:document.body.innerText.includes(${J(N.ui.jrWaitModel)})};`));
    ok('OPUS-15p 等候逾 20 分鐘而沒有進行中工作：畫面顯示「再試一次」，不再停在等候', stale.retry && !stale.waiting, stale);
  } catch (error) { ok('OPUS-15p 中斷', false, String(error.stack || error)); }
  /* ---------- 第二輪覆核第 2 項：組合未選時（pick < 0），底部操作列不可送出 pick -1 ---------- */
  try {
    const sPost = body => fetch(S.base + '/api/ideate', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S.base }, body: JSON.stringify(body) }).then(async r => ({ code: r.status, json: await r.json().catch(() => null) }));
    const cur = S.file();
    if (cur) fs.writeFileSync(path.join(S.data, 'ledger', 'ideate.json'), JSON.stringify({ ...cur, v: 2, state: 'closed' }));
    await sPost({ action: 'start', text: SAY, files: [] });
    await waitApi(S, s => s.state === 'choose' && s.step === 'who');
    await sPost({ action: 'pickWho', pick: 0 });
    const m = await waitApi(S, s => s.state === 'choose' && s.step === 'model');
    await open(S, 1440);
    await waitShown(N.ui.jrModelHead, 15000);
    const emptyPicked = N.t('jrBarPicked', { name: '' }).trim();
    const bar = await ev(inPage(`const lab=${J(N.t('jrBarStep', { n: 3 }))};const hs=[...document.querySelectorAll('body *')].filter(e=>vis(e)&&txt(e).includes(lab)&&txt(e).length<300);let f=null;for(const hd of hs){for(let e=hd;e&&e!==document.body;e=e.parentElement){const p=getComputedStyle(e).position;if(p==='fixed'||p==='sticky'){f=e;break;}}if(f)break;}const next=f&&[...f.querySelectorAll('button')].find(b=>txt(b)===${J(N.ui.jrNext)});return {text:f?txt(f):'',next:!!next,disabled:!!(next&&(next.disabled||next.getAttribute('aria-disabled')==='true'))};`));
    const emptyLabel = new RegExp(emptyPicked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(' + N.ui.jrPrev + '|' + N.ui.jrNext + '|' + N.ui.jrFollowZero + '|$)').test(bar.text);
    ok('R2-2a 組合未選時：底部操作列不顯示空白的「已選：」', !!m && m.model.pick < 0 && !!bar.text && !emptyLabel, { pick: m && m.model.pick, bar });
    let sent = null;
    if (bar.next && !bar.disabled) { const before = S.file()?.updatedAt; await clickText(N.ui.jrNext); await sleep(1500); sent = { step: S.file()?.step, state: S.file()?.state, changed: S.file()?.updatedAt !== before }; }
    ok('R2-2b 組合未選時：「下一步」停用，或按下後按 Zero 推薦選一個並前進（不會送出 pick -1 而出錯）', bar.next && (bar.disabled || (sent && sent.step === 'goal')), { bar, sent });
  } catch (error) { ok('R2-2 中斷', false, String(error.stack || error)); }
  ok('JRY-99 頁面沒有程式錯誤', !chrome.errors.length, chrome.errors);
} catch (error) { ok('JRY-驗收中斷', false, String(error.stack || error)); }
chrome?.close();
for (const s of servers) s.kill();
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n  實際：' + JSON.stringify(result.info).slice(0, 1500)));
console.log(`${results.filter(result => result.pass).length}/${results.length} 通過`);
process.exitCode = results.every(result => result.pass) ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 300);
