// 監察台對齊版測試（設計稿 2026-10-28；隔離資料夾、假 AI、假觀測程式）：
// work 資料契約、觀測驗欄同遮蓋、受限、即時 5 秒讀回（唔重新載入）亮線同粒子、全部閒置零亮線零粒子、導航兩組、生意大腦總覽同六個分頁、
// 紅藍對打兩個半場同逐張展開、舊深連轉頁、未交資料＋試驗資料夾阻塞卡同來源徽章、意見紀錄深連、慶祝三級、重播、390 冇橫向溢出
// 用法：node v2-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const { openChrome } = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'cdp-lib.mjs')).href);
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
const servers = [];
async function startServer(DATA, port) {
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_OBSERVER: path.join(HERE, 'fake-observe.mjs') }, stdio: 'ignore' });
  servers.push(srv); const B = `http://127.0.0.1:${port}`;
  await usePass(B);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch { } await sleep(250); }
  return B;
}
let c = null;
try {
  const DEMO = path.join(OUT, 'demo'), FOLDER = path.join(OUT, 'company-folder');
  fs.mkdirSync(FOLDER, { recursive: true });
  seedDemo(DEMO, { reset: true });
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const SF = path.join(DEMO, 'ledger', 'state.json'), st = JSON.parse(fs.readFileSync(SF, 'utf8'));
  const quiet = JSON.parse(JSON.stringify(st)); quiet.runs.forEach(r => { if (r.state === 'running') { r.state = 'ended'; r.endedAt = '@-1m'; } });
  // 換帳本內容時保留外殼已寫入嘅觀察資料夾（observe）
  const setState = s => { let cur = {}; try { cur = JSON.parse(fs.readFileSync(SF, 'utf8')); } catch { } fs.writeFileSync(SF, JSON.stringify({ ...s, observe: cur.observe }, null, 2)); };
  // 示範逐幕出現：當作已經開咗 15 分鐘，全場辯論已完成
  { const rvf = path.join(DEMO, 'brain', 'reveal.json'), rv = JSON.parse(fs.readFileSync(rvf, 'utf8')); rv.seededAt = new Date(Date.now() - 900000).toISOString(); fs.writeFileSync(rvf, JSON.stringify(rv)); }
  const FAKE = path.join(DEMO, 'fake-observe.json');
  const now = () => new Date().toISOString();
  const S_WORK = { key: 'aaaaaaaaaaa1', host: 'claude', kind: 'interactive', state: 'working', title: '撰寫市場調查', lastActiveAt: now(), reason: '近 5 分鐘有新紀錄', subagents: { active: 2, windowMinutes: 5 }, cwd: path.join(FOLDER, 'sub'), sessionId: 'raw-session-id-123' };
  const S_IDLE = { key: 'aaaaaaaaaaa2', host: 'claude', kind: 'interactive', state: 'idle', title: '等候下一個要求', lastActiveAt: now(), reason: '等候下一個要求', subagents: { active: 0, windowMinutes: 5 }, cwd: FOLDER };
  const S_OUT = { key: 'aaaaaaaaaaa3', host: 'claude', kind: 'interactive', state: 'working', title: '其他資料夾的會話', lastActiveAt: now(), reason: '近 5 分鐘有新紀錄', subagents: { active: 3, windowMinutes: 5 }, cwd: path.join(OUT, 'other-folder') };
  const setFake = o => fs.writeFileSync(FAKE, JSON.stringify(o));
  setFake({ sessions: [S_WORK, S_IDLE, S_OUT] });
  const B = await startServer(DEMO, Number(PORT));
  const get = async p => (await fetch(B + p)).json();
  const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  const STATUS = path.join(DEMO, 'ledger', 'status.json'), runCount = () => { try { return JSON.parse(fs.readFileSync(STATUS, 'utf8')).runs.length; } catch { return 0; } };
  const DESK = path.join(DEMO, 'founder', 'desk'), obsFiles = () => fs.readdirSync(DESK).filter(f => /^observe-/.test(f));
  const pathHits = s => [FOLDER, FOLDER.replace(/\\/g, '/'), FOLDER.replace(/\\/g, '\\\\')].some(p => String(s).toLowerCase().includes(p.toLowerCase()));

  /* ---------- A. work 資料契約、觀察資料夾（只存雜湊同顯示名） ---------- */
  let d = await get('/api/dashboard');
  ok('未登記資料夾：觀測「本機 AI 對話：未登記資料夾」，只有 AI 團隊自己嘅工作', d.work.observe.state === 'unavailable' && d.work.observe.text === N.dash.observeNoFolders && d.work.sessions.every(s => s.host === 'shell'), d.work.observe);
  ok('示範運行中工作：AI 團隊會話工作中，連住任務 t3', d.work.sessions.some(s => s.host === 'shell' && s.state === 'working' && s.taskIds.includes('t3')) && d.work.tasks.some(t => t.id === 't3' && t.state === 'working'), d.work.sessions);
  const runs0 = runCount();
  let r = await post('/api/setup', { action: 'observe', op: 'add', path: FOLDER, name: 'company-folder' });
  const of1 = obsFiles();
  const f1body = of1.length ? fs.readFileSync(path.join(DESK, of1[0]), 'utf8') : '';
  ok('系統頁加入資料夾：只新增 founder/desk/observe-<時間>.json，內容只有雜湊同顯示名', r.code === 202 && of1.length === 1 && /"hash":"[a-f0-9]{64}"/.test(f1body) && /company-folder/.test(f1body) && !pathHits(f1body), { r, of1, f1body });
  r = await post('/api/setup', { action: 'observe', op: 'add', path: 'relative/folder' });
  ok('加入資料夾：相對路徑或者唔存在嘅資料夾 → 400、唔寫檔', r.code === 400 && obsFiles().length <= 1, r);
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.work.observe.state === 'ok' && x.work.sessions.some(s => s.host === 'claude') ? x : null; }, 20000);
  const SFtext = fs.readFileSync(SF, 'utf8'), stObs = JSON.parse(SFtext).observe || {};
  ok('外殼第一步寫入帳本 observe.folders（只有雜湊同顯示名）、增刪檔已歸檔', stObs.folders && stObs.folders.length === 1 && /^[a-f0-9]{64}$/.test(stObs.folders[0].hash) && stObs.folders[0].name === 'company-folder' && obsFiles().length === 0 && fs.existsSync(path.join(DEMO, "archive", "desk", of1[0])), stObs);
  ok('套用觀察資料夾唔係一次工作：工作紀錄冇新增', runCount() === runs0, { before: runs0, after: runCount() });
  ok('以路徑字串搜尋：帳本、歸檔檔、/api/dashboard 回應、觀測程式收到嘅輸入全部零命中', !pathHits(SFtext) && !pathHits(fs.readFileSync(path.join(DEMO, "archive", "desk", of1[0]), 'utf8')) && !pathHits(JSON.stringify(d)) && !pathHits(fs.readFileSync(path.join(DEMO, 'fake-observe-input.json'), 'utf8')));
  ok('觀測程式只收到雜湊清單', /^\{"folders":\[\{"hash":"[a-f0-9]{64}","name":"company-folder"\}\]\}$/.test(fs.readFileSync(path.join(DEMO, 'fake-observe-input.json'), 'utf8').trim()), fs.readFileSync(path.join(DEMO, 'fake-observe-input.json'), 'utf8'));
  ok('登記咗資料夾：觀測來源正常，列出範圍內（連子資料夾）嘅會話', d && d.work.observe.sources === 1 && d.work.observe.folders[0].name === 'company-folder' && d.work.sessions.filter(s => s.host === 'claude').length === 2, d && d.work.observe);
  ok('觀察範圍：工作資料夾雜湊唔喺清單嘅會話唔顯示、唔計數', d && !d.work.sessions.some(s => s.title === '其他資料夾的會話') && d.work.meta.activeSubagents === 2, d && d.work.meta);
  const sw = d && d.work.sessions.find(s => s.title === '撰寫市場調查');
  ok('觀測欄位逐欄驗：唔出路徑、唔出會話識別原文', sw && !('cwd' in sw) && !('sessionId' in sw) && !JSON.stringify(d.work).includes('raw-session-id') && !pathHits(JSON.stringify(d.work)), sw);
  ok('並發數＝工作中會話 2（AI 團隊＋觀測）＋子代理 2；等級 2', d && d.work.meta.workingSessions === 2 && d.work.meta.activeSubagents === 2 && d.work.meta.concurrency === 4 && d.work.meta.workLevel === 2, d && d.work.meta);
  ok('模組工作中只由工作中會話推導（AI 與系統）', d && ['working', 'blocked', 'waiting'].includes(d.activity.system) && !Object.values(d.activity).includes('fresh'), d && d.activity);
  setFake({ sessions: [{ ...S_WORK, title: 'token sk-abcdefghijklmnopqrstuvwxyz123456 ' + '長'.repeat(80) }, { key: 'zz', state: 'working', title: '無效會話' }, { ...S_IDLE, title: '<script>alert(1)</script><button>按我</button>' }] });
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.work.sessions.some(s => /已遮蓋/.test(s.title)) ? x : null; }, 15000);
  const masked = d && d.work.sessions.find(s => /已遮蓋/.test(s.title));
  ok('似金鑰字串遮蓋、標題截到 60 字、無效 key 嘅會話唔收', masked && !/sk-abcdef/.test(masked.title) && masked.title.length <= 60 && !d.work.sessions.some(s => s.title === '無效會話'), masked);
  ok('輸出含標記、腳本同偽按鈕：角括號拆走，純文字', d && d.work.sessions.some(s => /script/.test(s.title) && !/[<>]/.test(s.title)), d && d.work.sessions.map(s => s.title));
  setFake({ mode: 'garbage' });
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.work.observe.state === 'restricted' ? x : null; }, 15000);
  ok('觀測程式出亂碼：受限（restricted），講原因唔講路徑', d && /暫時讀不到/.test(d.work.observe.text) && !/[A-Z]:[\\/]/.test(d.work.observe.text), d && d.work.observe);
  ok('受限：事件流一行「觀測來源讀取受限」', d && d.work.events.some(e => e.observed && e.title === '觀測來源讀取受限'), d && d.work.events.slice(0, 4));
  setFake({ sessions: [S_WORK, S_IDLE] });
  await waitFor(async () => (await get('/api/dashboard')).work.observe.state === 'ok', 15000);
  setFake({ sessions: [{ ...S_WORK, state: 'idle', subagents: { active: 0, windowMinutes: 5 } }, S_IDLE] });
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.work.events.some(e => e.observed && /撰寫市場調查」轉為閒置/.test(e.title)) ? x : null; }, 15000);
  ok('狀態轉變寫入事件流（觀測 · 不入紀錄），唔寫帳本', d && d.work.events.find(e => e.observed).actor === 'observe' && !fs.readFileSync(SF, 'utf8').includes('轉為閒置'), d && d.work.events.slice(0, 3));
  // 逾時：觀測程式 4 秒先答 → 2.5 秒內回應、沿用上一次結果並標「觀測逾時」；答完之後下一次讀回更新
  await sleep(5200);
  setFake({ delayMs: 4000, sessions: [S_WORK, S_IDLE] });
  let t1 = Date.now(); d = await get('/api/dashboard'); const took = Date.now() - t1;
  ok('觀測逾時：最多等 2.5 秒，沿用上一次結果並標「暫時未能讀取」', took < 3500 && d.work.observe.timedOut === true && /暫時未能讀取/.test(d.work.observe.text) && d.work.sessions.some(s => s.title === '撰寫市場調查' && s.state === 'idle'), { took, observe: d.work.observe });
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.work.sessions.some(s => s.title === '撰寫市場調查' && s.state === 'working') ? x : null; }, 15000);
  ok('觀測程式答完之後：下一次讀回更新、唔再標逾時', d && !d.work.observe.timedOut, d && d.work.observe);
  setFake({ sessions: [S_WORK, S_IDLE] });
  // 關閉觀測：observed 為 null、「未接觀測來源」；再開返
  r = await post('/api/setup', { action: 'observe', op: 'off' });
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.observed === null ? x : null; }, 20000);
  ok('系統頁關閉觀測：observed 為 null、寫「未接觀測來源」、冇觀測會話、資料夾清單照列（可以移除或者再開）', r.code === 202 && d && /觀測已關閉/.test(d.work.observe.text) && d.work.observe.off === true && !d.work.sessions.some(s => s.host === 'claude') && d.work.observe.folders.length === 1 && d.work.observe.folders[0].name === 'company-folder', d && d.work.observe);
  r = await post('/api/setup', { action: 'observe', op: 'on' });
  d = await waitFor(async () => { const x = await get('/api/dashboard'); return x.observed && x.work.observe.state === 'ok' && x.work.sessions.some(s => s.host === 'claude') ? x : null; }, 20000);
  ok('再開啟觀測：會話返嚟', !!d, r);
  ok('非本機或者錯 Origin 嘅 /api/setup → 403、唔寫檔', await (async () => { const n = obsFiles().length; const x = await fetch(B + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: JSON.stringify({ action: 'observe', op: 'off' }) }); return x.status === 403 && obsFiles().length === n; })());

  /* ---------- B. 作業網：即時 5 秒讀回（唔重新載入） ---------- */
  setFake({ sessions: [S_WORK, S_IDLE] });
  await waitFor(async () => (await get('/api/dashboard')).work.meta.workingSessions === 2, 15000);
  c = await openChrome(CHROME, path.join(OUT, 'profile'), 9483);
  await usePass(B, c);
  await c.go(B + '/dashboard', 1440, 3000);
  // 運作環第三版：畫布資料屬性、工作中會話節點、立方體（.orbit.has-work）、AI 核心一行
  const flow = `(()=>{const f=document.querySelector('#flow');return {lit:+f.getAttribute('data-lit'),pts:+f.getAttribute('data-particles'),working:document.querySelectorAll('.o-node.working').length,engine:document.querySelector('#orbit').classList.contains('has-work'),ai:document.querySelector('.o-core .o-status').textContent}})()`;
  let fl = await c.ev(flow);
  ok('有工作：會話節點工作中、有亮線同粒子、AI 核心寫「2 個 AI 對話工作中，另有 2 個助手協助」', fl.working === 2 && fl.lit > 0 && fl.pts > 0 && fl.engine && /2 個 AI 對話工作中，另有 2 個助手協助/.test(fl.ai), fl);
  ok('子代理衛星：工作中會話旁有 2 粒', await waitFor(async () => (await c.ev(`+document.querySelector('#flow').dataset.sub`)) === 2 && await c.ev(`document.querySelector('[data-node="session:claude-aaaaaaaaaaa1"]').dataset.sub==='2'`), 8000));
  ok('工作中會話冇對應任務：連去「未登記的工作」', await c.ev(`!!document.querySelector('[data-node="unlinked"]')`));
  setState(quiet); setFake({ sessions: [{ ...S_WORK, state: 'idle', subagents: { active: 0, windowMinutes: 15 } }, S_IDLE] });
  const t0 = Date.now();
  fl = await waitFor(async () => { const x = await c.ev(flow); return x.working === 0 && x.lit === 0 && x.pts === 0 ? x : null; }, 15000);
  ok('全部閒置（唔重新載入）：零亮線、零粒子、立方體唔閃、冇工作中節點', fl && !fl.engine && fl.ai.includes(N.dash.noWorkPlain), fl || await c.ev(flow));
  console.log('停止用咗', Date.now() - t0, 'ms（觀測每 5 秒＋頁面每 5 秒讀回）');
  ok('全部閒置：分類索引冇一格工作中', await c.ev(`!document.querySelector('.module[data-activity="working"]')`));
  await sleep(1500);
  ok('全部閒置：畫布靜止（冇再畫粒子）', (await c.ev(flow)).pts === 0);
  setFake({ sessions: [S_WORK, S_IDLE] });
  fl = await waitFor(async () => { const x = await c.ev(flow); return x.working >= 1 && x.lit > 0 && x.pts > 0 ? x : null; }, 15000);
  ok('有會話開始工作（唔重新載入）：下一次讀回就有亮線同粒子', fl, await c.ev(flow));
  setFake({ mode: 'garbage' });
  fl = await waitFor(async () => { const x = await c.ev(`({ghost:!!document.querySelector('[data-node="session:restricted"].unknown'),lit:+document.querySelector('#flow').getAttribute('data-lit'),text:document.querySelector('[data-node="session:restricted"]').title})`); return x.ghost && x.lit === 0 ? x : null; }, 15000); // 畫布資料屬性喺下一格先更新
  ok('觀測受限：一個虛線待核實節點、零亮線、節點寫原因', fl && fl.lit === 0 && /暫時讀不到 AI 對話狀態/.test(fl.text), fl);
  setFake({ sessions: [S_WORK, S_IDLE] }); setState(st);
  await waitFor(async () => (await c.ev(flow)).working >= 1, 15000);

  /* ---------- C. 導航、公司現況三帶 ---------- */
  // 0.43.0：「公司運作」一組在「業務路徑」之後加「業績報告」「延伸功能」（已批原型 docs/evidence/results-ext-2026-11-10/prototype/build.mjs 第 40 行）
  ok('導航三組（決定二十五；0.43.0 加業績報告、延伸功能）：待決事項・真實進展・公司概覽 ｜ 公司現況・生意大腦・業務路徑・業績報告・延伸功能 ｜ 團隊・紀錄・系統', await c.ev(`[...document.querySelectorAll('nav.tabs [data-grp]')].map(g=>[...g.querySelectorAll('a')].map(a=>a.childNodes[0].textContent).join()).join('|')==='待決事項,真實進展,公司概覽|公司現況,生意大腦,業務路徑,業績報告,延伸功能|團隊,紀錄,系統' && document.querySelectorAll('nav.tabs .divider').length===2`), await c.ev(`document.querySelector('nav.tabs').textContent`));
  ok('生意大腦分頁有「等你處理」數目', await c.ev(`(document.querySelector('nav.tabs a[href="/dashboard/brain"] .cnt')||{}).textContent`) === String(d ? (await get('/api/dashboard')).brain.items.filter(x => x.status === 'waiting').length : -1));
  ok('首頁三帶（方案 B）：壓縮條＋待你處理、運作環＋事件流、分類索引＋生意大腦摘要；冇甲板、冇首頁日程', await c.ev(`!!document.querySelector('.band.strip #strip') && !!document.querySelector('.band.strip #needs') && !!document.querySelector('.band.b #arena-panel') && !!document.querySelector('.band.b #evstream') && document.querySelectorAll('#index-row .module').length===10 && !!document.querySelector('#brain-strip') && !document.querySelector('.deck') && !document.querySelector('#schedule')`));
  ok('未來兩星期日程搬咗去業務路徑頁', await (async () => { await c.go(B + '/dashboard/path', 1440, 2500); return c.ev(`!!document.querySelector('#schedule-panel #schedule')`); })());
  await c.go(B + '/dashboard', 1440, 2500);
  ok('生意大腦摘要六格直接連去各自分頁', await c.ev(`[...document.querySelectorAll('#brain-strip .bmini')].map(a=>a.getAttribute('href')).join()`) === ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'].map(x => '/dashboard/brain/' + x).join());

  /* ---------- C2. 路徑節點外環：界線係「上次離開之後」（規劃書 4.2、v1.6.2 第 3 點） ---------- */
  await c.go(B + '/dashboard', 1440, 3000);
  const msR = st.milestones.find(m => m.pathStatus === 'confirmed' && m.state !== 'done');
  ok('路徑事件之前：冇外環、冇寫出 data-touched="null"', await c.ev(`!document.querySelector('.ptouch') && !document.querySelector('[data-touched="null"]')`));
  const sR = JSON.parse(JSON.stringify(st)); sR.events = (sR.events || []).concat([{ id: 'ev-path-ring', at: new Date().toISOString(), actor: 'ai', type: 'path', title: '測試路徑事件', relatedIds: [msR.id], moduleIds: ['paths'] }]);
  setState(sR);
  const ring = await waitFor(async () => c.ev(`!!document.querySelector('.st-stage.ptouch[data-ms="${msR.id}"]')`), 15000);
  ok('路徑事件之後（唔重新載入）：受影響節點有細外環', ring, await c.ev(`[...document.querySelectorAll('.ptouch')].map(e=>e.getAttribute('data-ms'))`));
  await c.go(B + '/dashboard', 1440, 3000);
  ok('重新載入一次：外環仍在（事件喺上次打開之後）', await c.ev(`!!document.querySelector('.ptouch[data-ms="${msR.id}"]')`));
  await c.go(B + '/dashboard', 1440, 3000);
  ok('再打開一次：外環消失（上次打開已經喺事件之後）', await c.ev(`!document.querySelector('.ptouch')`));
  setState(st);

  /* ---------- D. 生意大腦：總覽 + 六個分頁 ---------- */
  await c.go(B + '/dashboard/brain', 1440, 2500);
  ok('總覽：子導航（總覽＋六項）、六格三句、等你處理最多三項、底部意見紀錄', await c.ev(`document.querySelectorAll('#bnav .bchip').length===7 && document.querySelectorAll('.btile').length===6 && [...document.querySelectorAll('.btile')].every(t=>t.querySelectorAll('dt').length===3) && document.querySelectorAll('#wait-strip li').length<=3 && document.querySelector('#fblog').compareDocumentPosition(document.querySelector('#brain-head'))&2`));
  for (const it of ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline']) {
    await c.go(B + '/dashboard/brain/' + it, 1440, 2200);
    ok('分頁 ' + it + '：自己網址、身份色、子導航標住、返回總覽', await c.ev(`!!document.querySelector('#b-${it}.item-page') && document.querySelector('.bchip.on').getAttribute('data-item')==='${it}' && /--c-${it}/.test(document.querySelector('#b-${it}').getAttribute('style')) && !!document.querySelector('.bhead a[href="/dashboard/brain"]')`));
  }
  await c.go(B + '/dashboard/brain#b-wargame', 1440, 2500);
  ok('舊深連 /dashboard/brain#b-wargame 轉去紅藍對打分頁', await c.ev(`location.pathname`) === '/dashboard/brain/wargame');

  /* ---------- E. 紅藍對打：兩個半場、逐張展開、重播 ---------- */
  ok('上半場預設：只展開「一擊倒下」嗰條', await c.ev(`document.querySelectorAll('.claim.open').length===1 && !!document.querySelector('.claim.open .c-body .wc.ver') && document.querySelector('#half-debate').getAttribute('aria-pressed')==='true'`));
  const second = await c.ev(`[...document.querySelectorAll('.claim:not(.open)')][0].getAttribute('data-claim')`);
  await c.click(`.claim[data-claim="${second}"] .c-sum`);
  ok('撳另一條：只展開嗰條', await c.ev(`document.querySelectorAll('.claim.open').length===1 && document.querySelector('.claim.open').getAttribute('data-claim')==='${second}'`));
  await c.click('#wg-all');
  ok('全部展開／逐張查看', await c.ev(`document.querySelectorAll('.claim.open').length===document.querySelectorAll('.claim').length`));
  await c.click('#wg-all');
  ok('關鍵時刻：撳一張跳去嗰條論點並展開', await (async () => { const ref = await c.ev(`[...document.querySelectorAll('.km')].map(k=>k.getAttribute('data-ref')).find(r=>document.querySelector('.claim[data-claim="'+r+'"]'))`); await c.click(`.km[data-ref="${ref}"]`); await sleep(400); return c.ev(`document.querySelector('.claim.open').getAttribute('data-claim')==='${ref}'`); })());
  await c.click('#half-strengthen');
  ok('下半場：你的回應、轉強卡一次展開一張（第一張）、修訂草案；等你採用有琥珀點', await c.ev(`!!document.querySelector('.fresp') && document.querySelectorAll('.tcard.open').length===1 && document.querySelector('.tcard.open').getAttribute('data-card')==='T1' && !!document.querySelector('#model-revision') && !!document.querySelector('#half-strengthen .dot')`));
  await c.click('.tcard[data-card="T2"] .tc-sum');
  ok('撳另一張轉強卡：只展開嗰張', await c.ev(`document.querySelectorAll('.tcard.open').length===1 && document.querySelector('.tcard.open').getAttribute('data-card')==='T2'`));
  await c.click('#half-debate');
  await c.click('#replay');
  ok('重播：全部展開再逐幕出現', await c.ev(`document.querySelectorAll('.claim.open').length===document.querySelectorAll('.claim').length && document.querySelectorAll('#b-wargame [data-act].hide').length>0`));
  await c.click('#replay-end');
  ok('跳到結果：冇隱藏', await c.ev(`!document.querySelector('#b-wargame [data-act].hide')`));
  await c.go(B + '/dashboard/brain/wargame?match=D1', 1440, 2500);
  ok('CrewZero 場次深連 ?match= 落喺紅藍對打分頁', await c.ev(`document.querySelector('#match-bar [aria-pressed="true"]').getAttribute('data-match')==='D1'`));

  /* ---------- F. 意見紀錄深連 ---------- */
  const f1 = await post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'weak-1', verdict: 'useful', text: '' });
  await waitFor(async () => (await get('/api/status')).runs.find(r => r.kind === 'note' && r.ref === f1.j.id && r.state === 'done'), 30000);
  ok('結果卡意見經 /api/intake 寫入收件匣，檔名為時間前綴加 feedback-（規劃書 4.9）', (() => { const arch = path.join(DEMO, 'archive'); return fs.readdirSync(arch).filter(d => /^\d{4}-\d{2}$/.test(d)).some(d => fs.existsSync(path.join(arch, d, f1.j.id + '-feedback-checkup.md'))); })());
  await c.go(B + '/dashboard/brain', 1440, 2500);
  ok('意見紀錄：寫明屬生意體檢、卡名、有用、已記錄', await c.ev(`(()=>{const r=document.querySelector('#fblog li[data-fb-card="weak-1"]');return !!r&&/生意體檢/.test(r.textContent)&&/是否有訂戶願意為新鮮烘焙付較高月費/.test(r.textContent)&&/有用/.test(r.textContent)&&/已記錄/.test(r.textContent)})()`), await c.ev(`(document.querySelector('#fblog')||{}).textContent`));
  await c.click('#fblog li[data-fb-card="weak-1"] .card a');
  await sleep(2600);
  ok('撳「查看這條」：去生意體檢分頁並標示嗰張卡', await c.ev(`location.pathname==='/dashboard/brain/checkup' && (()=>{const e=document.querySelector('.fb[data-card="weak-1"]').closest('.weak');const r=e.getBoundingClientRect();return e.classList.contains('fbhit') && r.top>=0 && r.bottom<=innerHeight})()`), await c.ev(`location.href`));

  /* ---------- G. 慶祝三級（只由真實轉變觸發） ---------- */
  await c.go(B + '/dashboard', 1440, 3000);
  await c.ev(`window.__cel=[];new MutationObserver(()=>{document.querySelectorAll('.celebrate').forEach(e=>{const k=e.getAttribute('data-level')+'|'+e.textContent;if(!window.__cel.includes(k))window.__cel.push(k)})}).observe(document.body,{childList:true,subtree:true})`);
  ok('首次載入唔播慶祝', (await c.ev(`window.__cel.length`)) === 0);
  const s3 = JSON.parse(JSON.stringify(st)), mA = s3.milestones.find(m => m.pathStatus === 'confirmed' && m.state !== 'done');
  mA.state = 'done'; setState(s3);
  const cel3 = await waitFor(async () => (await c.ev(`window.__cel`)).find(x => x.startsWith('3|')), 7000);
  ok('第 3 級：沒有慶祝紀錄的里程碑完成，監察台不會自行播放', !cel3, cel3);
  const s2 = JSON.parse(JSON.stringify(s3)), mW = s2.milestones.find(m => (m.watchItems || []).some(w => w.target != null && w.target !== '' && Number(w.value) < Number(w.target)));
  const wi = mW && mW.watchItems.find(w => w.target != null && w.target !== '' && Number(w.value) < Number(w.target)); if (wi) wi.value = wi.target;
  setState(s2);
  const cel2 = await waitFor(async () => (await c.ev(`window.__cel`)).find(x => x.startsWith('2|')), 15000);
  ok('第 2 級：觀察項達目標 → 橫幅「條件達成」（冇英文）', cel2 && /條件達成/.test(cel2) && !/[A-Z]{4,}/.test(cel2), cel2 || await c.ev(`window.__cel`));
  const s1 = JSON.parse(JSON.stringify(s2)), tk = s1.tasks.find(t => t.id === 't10'); tk.status = 'done'; setState(s1);
  ok('第 1 級：交付確認 → 事件流多一行、冇橫幅', await waitFor(async () => c.ev(`!!document.querySelector('#evlist li[data-delivered="t10"]')`), 15000) && !(await c.ev(`window.__cel`)).some(x => x.startsWith('1|')));
  setState(st);

  /* ---------- H. 手機闊度 ---------- */
  for (const p of ['/dashboard', '/dashboard/brain', '/dashboard/brain/wargame']) {
    await c.go(B + p, 390, 2500);
    ok('390 冇橫向溢出：' + p, await c.ev(`document.documentElement.scrollWidth<=390`), await c.ev(`document.documentElement.scrollWidth`));
  }
  ok('390：運作環改線性清單、畫布唔畫', await (async () => { await c.go(B + '/dashboard', 390, 2500); return c.ev(`getComputedStyle(document.querySelector('#arena-list')).display!=='none' && getComputedStyle(document.querySelector('#orbit')).display==='none'`); })());

  /* ---------- I. 未交資料但生意大腦讀緊試驗資料夾 ---------- */
  const TRIAL = path.join(OUT, 'trial'), BF = path.join(OUT, 'brain-folder'), BF2 = path.join(OUT, 'brain-folder-old');
  fs.mkdirSync(BF, { recursive: true }); fs.mkdirSync(BF2, { recursive: true });
  fs.writeFileSync(path.join(BF, '測試公司生意體檢.md'), '# 生意體檢\n\n## 一句話講盤生意\n\n測試內容。\n');
  fs.mkdirSync(path.join(TRIAL, 'founder', 'desk'), { recursive: true });
  // 最新一份 brain-source-<時間>.json 為準（舊一份指向另一個資料夾）
  fs.writeFileSync(path.join(TRIAL, 'founder', 'desk', 'brain-source-20261028-090000-000.json'), JSON.stringify({ dir: BF2 }));
  fs.writeFileSync(path.join(TRIAL, 'founder', 'desk', 'brain-source-20261028-100000-000.json'), JSON.stringify({ dir: BF }));
  const hashDir = dir => { const out = {}; for (const f of fs.readdirSync(dir)) out[f] = fs.readFileSync(path.join(dir, f), 'utf8'); return JSON.stringify(out); };
  const bfBefore = hashDir(BF);
  await kit.certifyDirect(TRIAL, PROTO, ADAPTER);
  const B2 = await startServer(TRIAL, Number(PORT) + 1);
  await usePass(B2, c); // 第二個伺服器用另一個資料夾：Chrome 要換成佢嘅通行證
  await c.go(B2 + '/dashboard', 1440, 2500);
  ok('未交資料＋試驗資料夾：阻塞卡新句', await c.ev(`document.querySelector('#block-title').textContent`) === N.dash.blockNoCompanyBrain, await c.ev(`(document.querySelector('#block-card')||{}).textContent`));
  ok('公司現況摘要有來源徽章', await c.ev(`/來源：試驗資料夾 · 未入公司概覽/.test(document.querySelector('#brain-strip').textContent)`));
  await c.go(B2 + '/dashboard/brain', 1440, 2500);
  ok('生意大腦總覽頁頭有來源徽章', await c.ev(`/來源：試驗資料夾 · 未入公司概覽/.test(document.querySelector('#brain-head').textContent)`));
  const dj = await (await fetch(B2 + '/api/dashboard')).text(), pageText = await c.ev(`document.body.innerText`);
  const bfHit = s => [BF, BF.replace(/\\/g, '/'), BF.replace(/\\/g, '\\\\'), 'brain-folder'].some(p => s.toLowerCase().includes(p.toLowerCase()));
  ok('試驗資料夾：最新一份設定為準、路徑唔出現喺 /api/dashboard 同畫面、讀取前後資料夾內容不變', /測試內容/.test(dj) && !bfHit(dj) && !bfHit(pageText) && hashDir(BF) === bfBefore);
  fs.writeFileSync(path.join(TRIAL, 'founder', 'desk', 'brain-source-20261028-110000-000.json'), JSON.stringify({ off: true }));
  ok('取消試驗資料夾：再新增一份 {off}，生意大腦唔再讀', !/測試內容/.test(await (await fetch(B2 + '/api/dashboard')).text()));

  /* ---------- J. 系統頁：觀察資料夾清單、移除、AI 團隊工作 15 分鐘冇新步驟轉待核實 ---------- */
  await usePass(B, c); // 返回第一個伺服器：Chrome 換返佢嘅通行證
  await c.go(B + '/dashboard/system', 1440, 2500);
  ok('系統頁：觀察資料夾只列顯示名，有移除、加入同關閉觀測', await c.ev(`(()=>{const s=document.querySelector('#sys-observe');return !!s && /company-folder/.test(s.querySelector('.obs-list').textContent) && !!s.querySelector('[data-obs-remove]') && !!s.querySelector('#obs-add') && document.querySelector('#obs-toggle').textContent==='關閉觀測'})()`), await c.ev(`(document.querySelector('#sys-observe')||{}).textContent`));
  ok('系統頁冇顯示資料夾路徑', !pathHits(await c.ev(`document.body.innerText`)));
  await c.click('#sys-observe [data-obs-remove]');
  const gone = await waitFor(async () => { const x = await get('/api/dashboard'); return x.work.observe.folders.length === 0 ? x : null; }, 20000);
  ok('系統頁按移除：外殼套用後清單清空、寫「未登記資料夾」', gone && /未登記資料夾/.test(gone.work.observe.text) && !(JSON.parse(fs.readFileSync(SF, 'utf8')).observe.folders || []).length, gone && gone.work.observe);
  const stat = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
  const old = new Date(Date.now() - 20 * 60000), iso = x => x.toISOString();
  stat.runs.unshift({ id: 'R-stale-test', kind: 'note', state: 'running', startedAt: iso(old), steps: [{ key: 'received', label: '收到要求', state: 'done', at: iso(old) }, { key: 'ai', label: 'AI 處理中', state: 'running', at: iso(old) }] });
  fs.writeFileSync(STATUS, JSON.stringify(stat, null, 1));
  fs.writeFileSync(path.join(DEMO, 'ledger', '.lock'), String(process.pid));
  d = await get('/api/dashboard');
  const stale = d.work.sessions.find(s => s.key === 'run-R-stale-test');
  ok('AI 團隊工作超過 15 分鐘冇新步驟：轉待核實、唔計工作中', stale && stale.state === 'unknown' && /15 分鐘/.test(stale.reason), stale);
  fs.rmSync(path.join(DEMO, 'ledger', '.lock'), { force: true });
  stat.runs.shift(); fs.writeFileSync(STATUS, JSON.stringify(stat, null, 1));

  ok('冇程式錯誤', !c.errors.length, c.errors);
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  if (c) c.close();
  for (const s of servers) s.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 900));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
