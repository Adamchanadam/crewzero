// 階段 D＋E 驗收（設計文件 2026-10-28 第 7 節 D、E 兩行；規劃書 4.1、4.7、決定二十五、二十六；視覺規格第 2、3、5 節）：
// 一個殼（九個分頁三組、兩道門、紀錄三個篩選、設定歸系統、回覆盒只一處、典型一日點擊）、
// 運作環第三版（閒置零亮線零粒子、真實工作亮線粒子、強度三級、子代理、未登記工作、範圍模式、會話詳情）、
// 真實轉變脈衝、慶祝三級、計數跳動、卡片外框平時靜止（內容改變轉兩週即停）、同頁讀回就地更新、進場只播一次、
// 「AI 團隊」標籤唔疊字、首屏 1440×900、1024、390、暫停與減少動態、字級變數、冇「示意」字。
// 隔離資料夾、虛構示範公司、假 AI、假觀測程式（同真會話同一條伺服器資料鏈）。
// 用法：node shell-de-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), D = N.dash, U = N.ui;
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const { openChrome } = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'cdp-lib.mjs')).href);
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
let srv = null, c = null;
try {
  const DEMO = path.join(OUT, 'demo');
  seedDemo(DEMO, { reset: true });
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const SF = path.join(DEMO, 'ledger', 'state.json'), FAKE = path.join(DEMO, 'fake-observe.json');
  const norm = p => { const s = path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? s.toLowerCase() : s; };
  const st0 = JSON.parse(fs.readFileSync(SF, 'utf8'));
  st0.observe = { folders: [{ hash: crypto.createHash('sha256').update(norm(DEMO)).digest('hex'), name: '公司工作資料夾' }] };
  const readSt = () => JSON.parse(fs.readFileSync(SF, 'utf8'));
  const writeSt = s => fs.writeFileSync(SF, JSON.stringify(s, null, 2));
  const setRun = running => { const s = readSt(); s.runs.forEach(r => { if (r.id === 'R-demo-run') r.state = running ? 'running' : 'ended'; }); writeSt(s); };
  writeSt(st0); setRun(false);
  const now = () => new Date().toISOString();
  const S = (k, state, title, sub) => ({ key: k, host: 'claude', kind: 'interactive', state, title, lastActiveAt: now(), reason: state === 'working' ? '近 5 分鐘有新紀錄' : '等候下一個要求', subagents: { active: sub || 0, windowMinutes: 5 } });
  const setFake = list => fs.writeFileSync(FAKE, JSON.stringify({ sessions: list }));
  setFake([S('de0000000002', 'idle', '整理餐廳回饋', 0)]);
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DEMO, SOS_ADAPTER: ADAPTER, SOS_OBSERVER: path.join(HERE, 'fake-observe.mjs') }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${PORT}`;
  await usePass(B);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch { } await sleep(250); }
  const api = async p => (await fetch(B + p)).json();
  c = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
  await usePass(B, c);
  const orb = () => c.ev(`(()=>{const f=document.querySelector('.o-canvas');const o=document.querySelector('#orbit');return f?{lit:+f.dataset.lit,pts:+f.dataset.particles,moving:+f.dataset.moving,sub:+f.dataset.sub,twoHop:+f.dataset.twoHop,level:+(o.dataset.level||0),last:f.dataset.lastPulse,hp:f.dataset.humanPulse,working:document.querySelectorAll('.o-node.working').length}:null})()`);
  const shot = n => c.shot(path.join(OUT, n));

  /* ---------- A. 一個殼：九個分頁三組、兩道門、每頁同一個頁頭 ---------- */
  const TABS = ['pending', 'inputs', 'company', 'overview', 'brain', 'path', 'team', 'log', 'system'];
  const NAME = t => t === 'pending' || t === 'company' ? U[t] : D[t];
  const PAGES = [['/', 'pending'], ['/#/intake', 'company'], ['/#/setup', 'system'], ['/#/log', 'log'], ['/#/request/event', 'inputs'], ['/#/debate', 'brain'], ['/proofread.html', 'company'], ['/dashboard', 'overview'], ['/dashboard/brain', 'brain'], ['/dashboard/path', 'path'], ['/dashboard/inputs', 'inputs'], ['/dashboard/team', 'team'], ['/dashboard/log', 'log'], ['/dashboard/system', 'system']];
  const navOf = `(()=>{const n=document.querySelector('nav.tabs');if(!n)return null;return {groups:[...n.querySelectorAll('[data-grp]')].map(g=>({name:g.getAttribute('data-name'),tabs:[...g.querySelectorAll('a[data-tab]')].map(a=>[a.getAttribute('data-tab'),a.childNodes[0].textContent,a.getAttribute('href')])})),dividers:n.querySelectorAll('.divider').length,cur:[...n.querySelectorAll('a[aria-current="page"]')].map(a=>a.getAttribute('data-tab')),more:/更多/.test(n.textContent),metrics:[...document.querySelectorAll('.metric')].map(m=>m.getAttribute('data-metric')),mark:(document.querySelector('.dtop .mark')||{}).textContent}})()`;
  const navBad = [];
  for (const [p, want] of PAGES) {
    await c.go(B + p, 1440, 2600);
    const nv = await c.ev(navOf);
    const good = nv && nv.groups.length === 3 && nv.groups.map(g => g.name).join('|') === [D.navDo, D.navRun, D.navRef].join('|') && nv.dividers === 2 && !nv.more
      && nv.groups.flatMap(g => g.tabs.map(t => t[0])).join(',') === TABS.join(',') && nv.groups.flatMap(g => g.tabs.map(t => t[1])).join(',') === TABS.map(NAME).join(',')
      && nv.cur.length === 1 && nv.cur[0] === want && nv.metrics.join(',') === 'quarter,pending,inputs' && nv.mark === '田桌';
    if (!good) navBad.push({ p, want, nv });
  }
  ok('一個殼：十四個畫面（三個頁面檔）都係同一列導航——九個分頁三組（你要做／公司運作／參考）、兩條分隔線、冇「更多」選單、名稱由名稱表、只標一個所屬分頁；頁頭同一個標誌同三個業務指標', !navBad.length, navBad.slice(0, 2));
  // 九個分頁連結各自開到對應分頁
  const hrefBad = [];
  await c.go(B + '/dashboard', 1440, 2600);
  const hrefs = (await c.ev(navOf)).groups.flatMap(g => g.tabs);
  for (const [t, , h] of hrefs) { await c.go(B + h, 1440, 2200); const cur = (await c.ev(navOf) || {}).cur; if (!cur || cur[0] !== t) hrefBad.push([t, h, cur]); }
  ok('九個分頁連結：每個都開到該分頁並標示', !hrefBad.length, hrefBad);
  ok('兩道門：/ 開到待決事項、/dashboard 開到公司現況', hrefs.find(x => x[0] === 'pending')[2] === '/' && hrefs.find(x => x[0] === 'overview')[2] === '/dashboard');
  const shellM = await api('/api/shell');
  await c.go(B + '/', 1440, 3500);
  const mDesk = await c.ev(`[...document.querySelectorAll('[data-odo]')].map(e=>e.getAttribute('aria-label')).join('|')`);
  await c.go(B + '/dashboard', 1440, 3500);
  const mDash = await c.ev(`[...document.querySelectorAll('[data-odo]')].map(e=>e.getAttribute('aria-label')).join('|')`);
  const mt = shellM.metrics;
  ok('頁頭三個指標：Founder Desk 同監察台一樣、同伺服器數值一致', mDesk === mDash && mDash === [mt.quarter.done + '／' + mt.quarter.total, String(mt.pending), String(mt.inbox)].join('|'), { mDesk, mDash, mt });
  // 紀錄三個篩選
  const lf = async p => { await c.go(B + p, 1440, 2600); return c.ev(`(()=>{const b=document.querySelector('#log-filters');return b?{on:(b.querySelector('a.on')||{}).getAttribute&&b.querySelector('a.on').getAttribute('data-logf'),links:[...b.querySelectorAll('a')].map(a=>a.getAttribute('data-logf')+'>'+a.getAttribute('href')+'>'+a.textContent).join('|')}:null})()`); };
  const l1 = await lf('/#/log'), l2 = await lf('/dashboard/log'), l3 = await lf('/dashboard/log?f=work');
  ok('紀錄三個篩選：決定（決定紀錄）／全部事件／全部工作；三處都係同一組、各自標示', l1 && l2 && l3 && l1.on === 'decisions' && l2.on === 'events' && l3.on === 'work' && l1.links === l2.links && l2.links === ['decisions>/#/log>' + D.logDecisions, 'events>/dashboard/log>' + D.logAll, 'work>/dashboard/log?f=work>' + D.logWork].join('|'), { l1, l2, l3 });
  ok('紀錄「全部工作」：列工作、每頁最多 8 項', await c.ev(`document.querySelectorAll('#log-rows .row-item').length`) <= 8 && await c.ev(`document.querySelectorAll('#log-rows .row-item').length`) > 0);
  await c.go(B + '/dashboard/system', 1440, 2600);
  ok('設定歸系統分頁：系統頁有 AI 工具設定入口，開到嘅設定畫面導航標「系統」', await c.ev(`document.querySelector('#sys-setup').getAttribute('href')==='/#/setup'`) && await (async () => { await c.go(B + '/#/setup', 1440, 2600); return (await c.ev(navOf)).cur[0] === 'system'; })());
  await c.go(B + '/dashboard/inputs', 1440, 2600);
  ok('輸入分頁：訪問、真實事件、文件與筆記、交要求嘅入口都喺度', await c.ev(`!!document.querySelector('#in-event')&&!!document.querySelector('#doc-drop')&&!!document.querySelector('#open-folder')&&!!document.querySelector('a[href="/#/request/order"],a[href="/#/request/adhoc"]')`));
  const dashSrc = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8'), askSrc = fs.readFileSync(path.join(PROTO, 'ask.html'), 'utf8');
  ok('回覆盒只有一處：監察台檔案冇送出回覆（/api/submit）；答題畫面（ask.html）有', !dashSrc.includes('/api/submit') && askSrc.includes('/api/submit'));
  // 深連：/dashboard#<里程碑> 預選壓縮條嗰站
  const mId = st0.milestones.find(m => m.pathStatus === 'confirmed' && m.state !== 'done').id;
  await c.go(B + '/dashboard#' + mId, 1440, 3000);
  ok('深連 /dashboard#<里程碑>：壓縮條預選嗰站、運作環出里程碑卡', await c.ev(`document.querySelector('.st-stage[data-scope="${mId}"]').getAttribute('aria-pressed')==='true' && !!document.querySelector('.o-ms')`));
  await c.click('.st-stage[data-scope="all"]'); await sleep(800);
  ok('範圍「全部」還原：冇里程碑卡、網址冇 #', await c.ev(`!document.querySelector('.o-ms') && !location.hash && document.querySelector('.st-stage[data-scope="all"]').getAttribute('aria-pressed')==='true'`));

  /* ---------- B. 運作環：閒置、一個、兩個、繁忙（真實資料鏈） ---------- */
  await c.go(B + '/dashboard', 1440, 4000);
  let o = await orb();
  ok('閒置：零亮線、零粒子、零移動、強度 0、冇工作中會話', o && o.lit === 0 && o.pts === 0 && o.moving === 0 && o.level === 0 && o.working === 0, o);
  ok('閒置：顯示閒置說明（唔講「靜止」）、運作環卡外框靜止', await c.ev(`(()=>{const n=document.querySelector('.o-gauge .idle-note');return !!n&&getComputedStyle(n).display!=='none'&&n.textContent===${JSON.stringify(D.idleNote)}&&!document.querySelector('#arena-panel').classList.contains('flow')})()`));
  await shot('idle-1440.png');
  setRun(true);
  o = await waitFor(async () => { const x = await orb(); return x && x.working === 1 && x.lit >= 1 ? x : null; }, 15000);
  ok('一個會話（AI 團隊嗰次工作）：唔重新載入、亮線同粒子出現、強度 1、經任務連線（兩段光流）', o && o.level === 1 && o.pts > 0 && o.twoHop >= 1, o || await orb());
  ok('有工作：運作環卡流動邊框只喺 AI 真實工作期間轉', await c.ev(`(()=>{const p=document.querySelector('#arena-panel');return p.classList.contains('flow')&&p.classList.contains('running')})()`));
  setFake([S('de0000000001', 'working', '核對牌照要求', 2), S('de0000000002', 'idle', '整理餐廳回饋', 0)]);
  o = await waitFor(async () => { const x = await orb(); return x && x.working === 2 && x.sub === 2 ? x : null; }, 15000);
  ok('兩個會話：子代理衛星數＝回報嘅活躍子代理數（2）、強度跟並發數', o && o.sub === 2 && o.level === 2, o || await orb());
  ok('觀測會話工作中但冇對應任務：連去「未登記的工作」卡', await c.ev(`!!document.querySelector('[data-node="unlinked"]')`));
  ok('會話標籤：宿主短名＋序號、會話標題、狀態', await c.ev(`(()=>{const n=document.querySelector('[data-node="session:claude-de0000000001"] .o-lb');return !!n&&/Claude #\\d/.test(n.textContent)&&/核對牌照要求/.test(n.textContent)&&n.textContent.includes(${JSON.stringify(D.act_working)})})()`));
  await shot('two-1440.png');
  setFake([S('de0000000001', 'working', '核對牌照要求', 3), S('de0000000003', 'working', '比較保險報價', 3), S('de0000000002', 'idle', '治理設置與路徑覆核', 0)]);
  // 畫布讀數遲畫面一格：等埋亮線同衛星（機器忙時讀得太早會見到上一格）
  o = await waitFor(async () => { const x = await orb(); return x && x.working === 3 && x.lit === 3 && x.sub === 6 ? x : null; }, 15000);
  ok('繁忙（3 會話、6 子代理）：強度 3、亮線 3、衛星 6、粒子 ≤ 120', o && o.level === 3 && o.lit === 3 && o.sub === 6 && o.pts > 0 && o.pts <= 120, o || await orb());
  ok('繁忙：工作強度表 3／3、會話數字同伺服器一致', await c.ev(`(()=>{const g=document.querySelector('.o-gauge');return g.querySelectorAll('.gbars i.on').length===3&&/3 \\/ 3/.test(g.textContent)})()`) && (await api('/api/dashboard')).work.meta.workingSessions === 3);
  const fps = await c.ev(`new Promise(r=>{let n=0;const f=document.querySelector('.o-canvas');const t0=performance.now();const ob=new MutationObserver(()=>n++);ob.observe(f,{attributes:true,attributeFilter:['data-particles','data-lit']});setTimeout(()=>{ob.disconnect();r(n)},2000)})`);
  ok('畫布約 30fps 節流（資料屬性兩秒內最多更新約 60 次）', fps <= 70, fps);
  await shot('busy-1440.png');
  await c.click('[data-node="session:claude-de0000000001"]'); await sleep(500);
  ok('點會話開詳情：名稱、最新請求、最後活動、狀態、子代理數、對應任務六行', await c.ev(`(()=>{const m=document.querySelector('#modal');if(!m)return false;const dt=[...m.querySelectorAll('dt')].map(x=>x.textContent);return ${JSON.stringify([D.nameL, D.latestReqL, D.lastActiveL, D.stateL, D.subCountL, D.linkedTaskL])}.every(k=>dt.includes(k))})()`));
  await c.click('#modal-close');
  // 會話停止：同一輪讀回轉閒置
  setFake([S('de0000000002', 'idle', '整理餐廳回饋', 0)]); setRun(false);
  // 停低嗰下可能有真實事件脈衝喺途中（例如會話轉閒置嘅觀測行）；播完就要零粒子、零移動
  o = await waitFor(async () => { const x = await orb(); return x && x.working === 0 && x.lit === 0 && x.pts === 0 && x.moving === 0 ? x : null; }, 20000);
  ok('全部停止（唔重新載入）：零亮線、零粒子、運作環卡外框停', o && o.pts === 0 && o.moving === 0 && !(await c.ev(`document.querySelector('#arena-panel').classList.contains('running')`)), o || await orb());

  /* ---------- C. 就地更新、外框靜止、進場只播一次 ---------- */
  await c.go(B + '/dashboard', 1440, 4000);
  await c.ev(`window.__mut=0;window.__panels=[...document.querySelectorAll('#app .panel')];new MutationObserver(ms=>{ms.forEach(m=>{const t=m.target.nodeType===1?m.target:m.target.parentElement;if(t&&t.closest('[data-hb],.phtele,.o-stage,.o-fxa,.o-canvas,.cd,[data-wait]'))return;window.__mut+=m.addedNodes.length+m.removedNodes.length})}).observe(document.querySelector('#app'),{childList:true,subtree:true,characterData:true})`);
  await sleep(11500);
  ok('同頁讀回（兩次以上，資料冇變）：#app 冇增刪節點、全部卡仍係同一個元素', await c.ev(`window.__mut===0 && window.__panels.every(p=>p.isConnected)`), await c.ev(`window.__mut`));
  ok('進場只播一次：讀回之後冇卡重播進場動畫', await c.ev(`document.body.classList.contains('settled') && document.getAnimations().filter(a=>a.animationName==='cardin').length===0`));
  ok('外框平時靜止：冇任何卡嘅外框（流動邊框、待命微光）喺度轉', await c.ev(`!document.querySelector('#app .panel.flow') && document.getAnimations().filter(a=>a.animationName==='ring').length===0`));
  // 示範帳本嘅相對時間每分鐘重新推算：跨過一分鐘，舊事件都唔可以當新事件（冇新行、冇脈衝）
  await c.ev(`window.__fr=0;window.__lp=document.querySelector('.o-canvas').dataset.lastPulse;new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.classList&&n.classList.contains('fresh'))window.__fr++}))).observe(document.querySelector('#evlist'),{childList:true})`);
  await sleep(60000 - (Date.now() % 60000) + 7000);
  ok('示範資料跨過一分鐘：舊事件唔會當新事件（冇新行、冇脈衝）', await c.ev(`window.__fr===0 && document.querySelector('.o-canvas').dataset.lastPulse===window.__lp`), await c.ev(`({fr:window.__fr,lp:document.querySelector('.o-canvas').dataset.lastPulse,was:window.__lp})`));
  // 新事件：只多一行，舊行唔郁；事件流卡閃一下、轉兩週即停
  const before = await c.ev(`(window.__evs=[...document.querySelectorAll('#evlist li')]).length`);
  { const s = readSt(); s.events = s.events || []; s.events.unshift({ id: 'e-de-1', at: '@-0m', actor: 'ai', type: 'run', title: 'AI 完成工作：整理餐廳回饋表', moduleIds: ['ai-week'] }); writeSt(s); }
  const fresh = await waitFor(async () => c.ev(`document.querySelector('#evlist li.fresh')?{n:document.querySelectorAll('#evlist li').length,kept:window.__evs.filter(li=>li.isConnected).length,t:document.querySelector('#evlist li.fresh').textContent}:null`), 15000);
  ok('事件流新行：右滑入一行（.fresh），其他行係原本嗰啲元素', fresh && /整理餐廳回饋表/.test(fresh.t) && fresh.kept >= Math.min(before, 13), { fresh, before });
  ok('事件流卡：內容改變先閃一下、流動邊框（轉兩週）', await c.ev(`document.querySelector('#evstream').classList.contains('flow')`));
  ok('…約 5 秒後外框回到靜止', !!(await waitFor(async () => c.ev(`!document.querySelector('#evstream').classList.contains('flow')`), 8000)));
  ok('冇沿外框流動嘅光點、冇常開嘅外框動畫（ring 只得有限次數）', await c.ev(`[...document.styleSheets].every(sh=>{try{return [...sh.cssRules].every(r=>!(r.selectorText&&/\\.panel/.test(r.selectorText)&&r.style&&/ring/.test(r.style.animationName||'')&&r.style.animationIterationCount==='infinite'))}catch(e){return true}})`));

  /* ---------- D. 真實轉變脈衝、計數跳動 ---------- */
  await c.go(B + '/dashboard', 1440, 4000);
  ok('首次載入唔補播脈衝', (await orb()).last === 'none', await orb());
  // 新待決：AI → 人類核心；頁頭數字滾動、待你處理卡閃一下
  const pend0 = (await api('/api/shell')).metrics.pending;
  const pk = JSON.parse(fs.readFileSync(path.join(DEMO, 'asks', 'ask-demo-accept.json'), 'utf8'));
  fs.writeFileSync(path.join(DEMO, 'asks', 'ask-de-new.json'), JSON.stringify({ ...pk, id: 'ask-de-new', title: '驗收：餐廳回饋表', askedAt: new Date().toISOString() }));
  const np = await waitFor(async () => { const x = await orb(); return x && x.last === 'ai-to-human' ? x : null; }, 15000);
  ok('新待決：脈衝方向 AI → 人類核心（data-last-pulse＝ai-to-human）', !!np, await orb());
  ok('計數跳動：頁頭「待決事項」數字就地滾到新值、指標底線掃一下', await c.ev(`(()=>{const o=document.querySelector('[data-odo="pending"]');return o.getAttribute('aria-label')===${JSON.stringify(String(pend0 + 1))}})()`), await c.ev(`document.querySelector('[data-odo="pending"]').getAttribute('aria-label')`));
  ok('待你處理卡：三個數更新、卡閃一下', await c.ev(`document.querySelector('#needs .needn[data-need="decision"] .num').textContent===${JSON.stringify(String(pend0 + 1))}`));
  // 待決轉已答：人類核心 → AI、人類核心改字 1.5 秒
  fs.mkdirSync(path.join(DEMO, 'ledger', 'answers'), { recursive: true });
  fs.writeFileSync(path.join(DEMO, 'ledger', 'answers', 'ask-de-new.json'), JSON.stringify({ answers: { accept: { value: '接受', at: new Date().toISOString() } } }));
  const hp = await waitFor(async () => { const x = await orb(); return x && x.last === 'human-to-ai' ? x : null; }, 15000);
  ok('待決轉已答：脈衝方向人類核心 → AI（human-to-ai）、人類核心一行改為「已收到你的決定」', !!hp && await c.ev(`document.querySelector('.o-human .o-text').textContent===${JSON.stringify(D.humanHandoff)}`), await orb());
  await shot('event-1440.png');

  /* ---------- E. 慶祝三級（只由創辦人確認過嘅真實轉變；首次載入唔播） ---------- */
  await c.go(B + '/dashboard', 1440, 3500);
  await c.ev(`window.__cel=[];window.__fx=[];new MutationObserver(()=>{document.querySelectorAll('.celebrate').forEach(e=>{const k=e.getAttribute('data-level')+'|'+e.textContent;if(!window.__cel.includes(k))window.__cel.push(k)});['o-bn2','o-bn3','fxf'].forEach(k=>{if(document.querySelector('.'+k)&&!window.__fx.includes(k))window.__fx.push(k)})}).observe(document.body,{childList:true,subtree:true})`);
  ok('首次載入唔播慶祝', (await c.ev(`window.__cel.length`)) === 0);
  const s3 = readSt(), mA = s3.milestones.find(m => m.pathStatus === 'confirmed' && m.state !== 'done' && (m.watchItems || []).length === 0) || s3.milestones.find(m => m.pathStatus === 'confirmed' && m.state !== 'done');
  mA.state = 'done'; writeSt(s3);
  const c3 = await waitFor(async () => (await c.ev(`window.__cel`)).find(x => x.startsWith('3|')), 15000);
  ok('三級：里程碑完成 → 運作環內暗角橫幅「里程碑達成」並寫明下一站', c3 && /里程碑達成/.test(c3) && /下一站/.test(c3) && (await c.ev(`window.__fx`)).includes('o-bn3'), { c3, fx: await c.ev(`window.__fx`) });
  await sleep(1300); await shot('cele3-1440.png'); await sleep(2500);
  const s2 = readSt(), mW = s2.milestones.find(m => (m.watchItems || []).some(w => w.target != null && w.target !== '' && Number(w.value) < Number(w.target)));
  const wi = mW.watchItems.find(w => w.target != null && w.target !== '' && Number(w.value) < Number(w.target)); wi.value = wi.target; writeSt(s2);
  const c2 = await waitFor(async () => (await c.ev(`window.__cel`)).find(x => x.startsWith('2|')), 15000);
  ok('二級：觀察項達目標 → 運作環內橫幅「條件達成」、壓縮條該站量尺充能', c2 && /條件達成/.test(c2) && (await c.ev(`window.__fx`)).includes('o-bn2'), { c2, fx: await c.ev(`window.__fx`) });
  await sleep(2600);
  const s1 = readSt(), tk = s1.tasks.find(t => t.status === 'active' && t.owner !== 'founder') || s1.tasks.find(t => t.status !== 'done' && t.owner !== 'founder');
  tk.status = 'done'; writeSt(s1);
  ok('一級：任務交付 → 事件流多一行「任務交付」、冇橫幅', await waitFor(async () => c.ev(`!!document.querySelector('#evlist li[data-delivered="${tk.id}"]')`), 15000) && !(await c.ev(`window.__cel`)).some(x => x.startsWith('1|')));
  writeSt({ ...st0, observe: readSt().observe }); setRun(false);

  /* ---------- F. 「AI 團隊」標籤唔疊字、首屏、1024、390 ---------- */
  await c.go(B + '/dashboard', 1440, 4000);
  const lab = await c.ev(`[...document.querySelectorAll('#evlist li')].map(li=>{const w=li.querySelector('.who'),t=li.querySelector('.tt');const a=w.getBoundingClientRect(),b=t.getBoundingClientRect();return {who:w.textContent,ok:a.right<=b.left+0.5&&w.scrollWidth<=w.clientWidth+1}}).filter(x=>!x.ok)`);
  ok('即時事件流：「AI 團隊」等角色標籤唔會闊過欄、唔會疊住後面文字', lab.length === 0 && await c.ev(`[...document.querySelectorAll('#evlist .who')].some(w=>w.textContent===${JSON.stringify(D.hostShell)})`), lab);
  const fold = await c.ev(`(()=>{const b=document.querySelector('.band.b').getBoundingClientRect().bottom+scrollY;const ban=[...document.querySelectorAll('.desk-head .banner')].reduce((a,e)=>a+e.getBoundingClientRect().height+8,0);return {b:Math.round(b),ban:Math.round(ban)}})()`);
  ok('首屏 1440×900：頁頭、導航、上次離開之後、壓縮條、運作環與事件流合計 ≤ 900px（唔計示範徽章）', fold.b - fold.ban <= 900, fold);
  ok('運作環 480px', await c.ev(`Math.round(document.querySelector('#orbit').getBoundingClientRect().height)`) === 480);
  setRun(true);
  await c.go(B + '/dashboard', 1024, 4000);
  o = await orb();
  ok('1024 闊：冇橫向溢出、運作環照畫（有亮線）', await c.ev(`document.documentElement.scrollWidth<=1024`) && o && o.lit >= 1, { sw: await c.ev(`document.documentElement.scrollWidth`), o });
  await shot('busy-1024.png');
  const narrowBad = [];
  for (const p of ['/', '/proofread.html', '/dashboard', '/dashboard/brain', '/dashboard/path', '/dashboard/inputs', '/dashboard/team', '/dashboard/log', '/dashboard/system', '/#/log']) { await c.go(B + p, 390, 2600); const sw = await c.ev(`document.documentElement.scrollWidth`); if (sw > 390) narrowBad.push([p, sw]); }
  ok('390 闊：全部分頁冇橫向溢出', !narrowBad.length, narrowBad);
  await c.go(B + '/dashboard', 390, 3000);
  ok('390：運作環唔畫畫布、改線性清單（兩核心、三個數、會話、任務）、事件流最多六行、分類索引兩欄、導航一列橫向捲動', await c.ev(`getComputedStyle(document.querySelector('#orbit')).display==='none' && getComputedStyle(document.querySelector('#arena-list')).display!=='none' && document.querySelectorAll('#arena-list li.hub').length===2 && [...document.querySelectorAll('#evlist li')].filter(li=>getComputedStyle(li).display!=='none').length<=6 && getComputedStyle(document.querySelector('#index-row')).gridTemplateColumns.split(' ').length===2 && getComputedStyle(document.querySelector('nav.tabs')).overflowX==='auto'`));
  await shot('busy-390.png');

  /* ---------- G. 暫停動效、減少動態、特效開關 ---------- */
  await c.go(B + '/dashboard', 1440, 3500);
  await c.click('#pause'); await sleep(900);
  o = await orb();
  ok('暫停動效：body.paused、零粒子、零移動（靜態線保留）', await c.ev(`document.body.classList.contains('paused')`) && o.pts === 0 && o.moving === 0 && o.lit >= 1, o);
  await c.click('#pause'); await sleep(900);
  ok('恢復動效：粒子返嚟', (await waitFor(async () => { const x = await orb(); return x.pts > 0 ? x : null; }, 5000)) != null);
  await c.click('#fx'); await sleep(400);
  ok('特效開關：記住喺本機、按鈕字改「特效 關」', await c.ev(`document.querySelector('#fx').textContent===${JSON.stringify(D.fxOff)} && localStorage.getItem('sos-fx')==='0'`));
  await c.click('#fx');
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await c.go(B + '/dashboard', 1440, 3500);
  o = await orb();
  ok('系統減少動態：零粒子、零移動', o.pts === 0 && o.moving === 0, o);
  await c.send('Emulation.setEmulatedMedia', { features: [] });
  setRun(false);

  /* ---------- H. 字級變數、冇「示意」、讀回心跳、倒數、走勢、典型一日 ---------- */
  const px = ['dashboard.html', 'ask.html', 'proofread.html', 'desk.js', 'orbit.js'].map(f => [f, (fs.readFileSync(path.join(PROTO, f), 'utf8').match(/font-size:\s*\d+(\.\d+)?px|font:[^;"'}\n]*\b\d+(\.\d+)?px(?!\s*\/)/g) || []).filter(x => !/\/\d/.test(x))]).filter(x => x[1].length);
  ok('字級：三個頁面檔同共用程式全部由八個字級變數取值（冇寫死像素字級）', !px.length, px);
  await c.go(B + '/dashboard', 1440, 3500);
  ok('冇「示意」字、冇示意徽章（正式版只由真實資料驅動）', !(await c.ev(`document.body.innerText.includes('示意')`)) && !(await c.ev(`!!document.querySelector('.o-simban')`)));
  const hb1 = await c.ev(`document.querySelector('[data-hb]').textContent`); await sleep(2100); const hb2 = await c.ev(`document.querySelector('[data-hb]').textContent`);
  ok('讀回心跳：「讀回 n 秒前」每秒用本機時鐘更新、每次讀回連線徽章擴散一下', hb1 !== hb2 && /讀回 \d+ 秒前/.test(hb2) && !!(await waitFor(async () => c.ev(`document.querySelector('#conn').classList.contains('live-pulse')`), 7000)), { hb1, hb2 });
  ok('近 24 小時事件走勢：事件流卡底有走勢線', await c.ev(`!!document.querySelector('#ev-spark svg polyline')`));
  await c.go(B + '/', 1440, 4000);
  const cd1 = await c.ev(`(document.querySelector('[data-tele] [data-cd]')||{}).textContent`); await sleep(1600); const cd2 = await c.ev(`(document.querySelector('[data-tele] [data-cd]')||{}).textContent`);
  ok('AI 近期工作：下次 AI 開工倒數每秒走、今日 AI 啟動／用時一行（真數據）', /^\d{2}:\d{2}:\d{2}$/.test(cd2 || '') && cd1 !== cd2 && await c.ev(`/今日 AI 啟動 \\d+／\\d+/.test(document.querySelector('[data-tele]').textContent)`), { cd1, cd2 });
  // 典型一日（設計文件第 4 節方案 A）：開 → 作答 → 確認 → 公司現況 → 輸入 → 記錄真實事件 → 交給 AI；點擊 ≤ 7、零跨產品
  let clicks = 0; const tap = async sel => { await c.click(sel); clicks++; await sleep(900); };
  await c.go(B + '/', 1440, 3500);
  await tap('.hero a.btn.primary');
  await tap('#go-main');
  await tap('#do-confirm');
  await sleep(1500);
  await tap('nav.tabs a[data-tab="overview"]'); await sleep(1500);
  const onDash = await c.ev(`location.pathname==='/dashboard'`);
  await tap('nav.tabs a[data-tab="inputs"]'); await sleep(1200);
  await tap('#in-event'); await sleep(1500);
  await c.type('#req-text', '農場丙今日來電，答應下星期一簽供應協議。');
  await tap('#req-send');
  const sent = await waitFor(async () => c.ev(`/已收到|已記錄|處理中|完成/.test((document.querySelector('#req-track')||{}).textContent||'')`), 15000);
  ok('典型一日：開 → 作答 → 確認 → 公司現況 → 輸入 → 記錄真實事件 → 交給 AI，點擊 ≤ 7、全程同一列導航（零跨產品）', clicks <= 7 && onDash && !!sent, { clicks, onDash, sent });
  ok('全程冇程式錯誤', !c.errors.length, c.errors);
} catch (e) {
  ok('測試出錯', false, String(e && e.stack || e));
} finally {
  try { c && c.close(); } catch { }
  try { srv && srv.kill(); } catch { }
}
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '  ' + String(JSON.stringify(r.info)).slice(0, 600)));
console.log(`${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
