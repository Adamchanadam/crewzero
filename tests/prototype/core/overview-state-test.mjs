// 公司概覽「確認後狀態」罕見情況（0.40.0）：
//   1 送出後頁面已關閉、重開時套用失敗已跌出 /api/status 最近五項（伺服器另附最近一次公司概覽工作 lastOverviewRun）
//   2 工作中途中斷（沒有「套用確認」步）：不當作已在 Zero，不提供「重試」
//   3 套用失敗而送出的內容＝Zero 原值：失敗跌出清單後仍不被伺服器舊確認覆蓋；離線確認原值維持採用
//   4 「清除我的修改」提示如實；公司概覽已就緒時「和 Zero 一起想」的回覆指向「和 Zero 討論」
//   5 「目前有誰做了甚麼？」按「照此確認（Zero 建議）」後重新載入仍已答
// 真實伺服器（隔離資料夾、假 AI）＋無頭 Chrome；status.json 由測試直接寫。零費用，不碰任何真實 data/。
// 用法：node overview-state-test.mjs <chrome.exe> <輸出資料夾> <原型資料夾> <假 adapter> <起始埠>
// 埠：只用起始埠起的兩個（伺服器、Chrome 除錯埠）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass, forgetPass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT0] = process.argv.slice(2);
const PORT = Number(PORT0);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const results = []; const ok = (n, p, i) => { results.push({ name: n, pass: !!p, info: i }); };
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const loadFixture = f => { const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(PROTO, 'fixtures', f), 'utf8'), c); return c.window.STARTUP_OS_PAGE; };
const KEY = 'sos-proofread:goal-dates-repro-structured-2026-11-06:1:33f1547a';
const plain = s => String(s || '').replaceAll('2026 年 ', '').replace(/\s+/g, ' ');
const tfetch = (u, o = {}) => fetch(u, { signal: AbortSignal.timeout(20000), ...o });

const DATA = path.join(OUT, 'data'), BASE = `http://127.0.0.1:${PORT}`, PAGE = BASE + '/proofread.html';
const STATUS = path.join(DATA, 'ledger', 'status.json'), CONF = path.join(DATA, 'ledger', 'confirmed.json');
const pg = loadFixture('goal-dates-repro-structured.js');
const reg = {}; (function w(o) { if (Array.isArray(o)) return o.forEach(w); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'value' in o && 'label' in o) reg[o.id] = o; for (const k in o) if (o[k] && typeof o[k] === 'object') w(o[k]); })(pg);
const ids = pg.path.milestones.map(m => m.id), defKind = m => m.kind === 'task' ? 'task' : 'real';
const NA_X = '十四輪測試：這部瀏覽器剛送出的下一步，改為先約見綠野物流的負責人';
const NA_Y = '十四輪測試：伺服器上較早的確認，下一步為先約何師傅';
const NA_Z = '十四輪測試：清除前這部瀏覽器上未送出的修改';
const confObj = edits => {
  const values = {}; for (const [id, e] of Object.entries(reg)) values[id] = String(e.value ?? '');
  Object.assign(values, edits);
  return { company: pg.company.name, pageId: pg.page.id, confirmedAt: '2026-11-06T10:00:00+08:00', replyFile: 'r-y.md', orderChanged: false, nextActionMilestone: null,
    edits: Object.entries(edits).map(([id, v]) => ({ id, value: v, label: reg[id].label })), autoEdits: [], stillMissing: [], note: '', values, kindsChanged: [], order: ids,
    kinds: Object.fromEntries(pg.path.milestones.map(m => [m.id, defKind(m)])) };
};
const putConf = edits => fs.writeFileSync(CONF, JSON.stringify(confObj(edits), null, 2));
const dgOf = edits => lib.confirmedDigest(confObj(edits), pg);
// 這部瀏覽器已送出 name 這份回覆（內容 edits）的草稿
const DRAFT = (name, edits, confirmedExtra = {}, sentObj = true) => ({ edits, order: ids, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name, sent: true, digest: dgOf(edits), ...confirmedExtra }, sent: sentObj ? { name, at: '2026-11-07T10:00:00+08:00' } : null, ok: {}, kinds: {} });
const STEPS = (...ks) => ks.map(([key, state]) => ({ key, label: key, state, at: '', detail: '' }));
const run = (id, kind, state, files, steps, extra = {}) => ({ id, kind, ref: pg.page.id, startedAt: '2026-11-07T10:00:00+08:00', state, replyFiles: files, steps, ...extra });
const note = i => run('n' + i, 'note', 'done', [], []);
const notes5 = [1, 2, 3, 4, 5].map(note);
const putRuns = runs => fs.writeFileSync(STATUS, JSON.stringify({ runs }));

let srv = null, c = null;
try {
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'company', 'page.json'), JSON.stringify(pg, null, 2));
  putRuns([]);
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  forgetPass(BASE); await usePass(BASE);
  let up = false; for (let i = 0; i < 60 && !up; i++) { try { up = !!(await (await tfetch(BASE + '/api/status')).json()).ok; } catch { } if (!up) await sleep(300); }
  ok('伺服器在預期的埠啟動', up, BASE);
  const status = async () => (await tfetch(BASE + '/api/status')).json();

  /* ---------- 一：伺服器 lastOverviewRun ---------- */
  const failedX = run('R-fx', 'proofread', 'failed', ['r-x.md'], STEPS(['received', 'done'], ['applied', 'failed']), { error: '這次答案未能記錄：答案來源重複。請按「重新載入」，再確認一次。', result: { summary: '不應出現', artifacts: [{ title: 't', text: 'x'.repeat(2000) }] } });
  putRuns([...notes5, failedX, run('R-old', 'proofread', 'done', ['r-old.md'], STEPS(['received', 'done'], ['applied', 'done']))]);
  let s = await status();
  ok('一：最近一次公司概覽工作已跌出最近五項：附在 lastOverviewRun，認得出回覆檔及失敗步', s.runs.length === 5 && s.lastOverviewRun && s.lastOverviewRun.id === 'R-fx' && s.lastOverviewRun.replyFiles[0] === 'r-x.md' && s.lastOverviewRun.steps.some(x => x.key === 'applied' && x.state === 'failed'), s.lastOverviewRun);
  ok('一：附上的工作不帶 result（不重複傳大段內容）', s.lastOverviewRun && !('result' in s.lastOverviewRun), Object.keys(s.lastOverviewRun || {}));
  putRuns([run('R-new', 'proofread', 'done', ['r-new.md'], STEPS(['received', 'done'], ['applied', 'done'])), ...notes5]);
  s = await status();
  ok('一：最近一次公司概覽工作仍在最近五項內：不重複附上', s.lastOverviewRun === null && s.runs[0].id === 'R-new', s.lastOverviewRun);
  putRuns(notes5);
  s = await status();
  ok('一：從沒有公司概覽工作：lastOverviewRun 為 null', s.lastOverviewRun === null, s.lastOverviewRun);

  /* ---------- 頁面 ---------- */
  c = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);
  await usePass(BASE, c);
  const { ev, go, click } = c;
  const load = async (w = 2600) => { await go(PAGE, 1440, w); };
  const shown = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`).then(plain);
  const main = () => ev(`(()=>{const e=document.querySelector('#go-main');return e?{tag:e.tagName,text:e.textContent.trim()}:null})()`);
  const isLink = m => !!m && m.tag === 'A', isRe = m => !!m && m.tag === 'BUTTON' && m.text === '再確認一次';
  const bodyHas = t => ev(`document.body.innerText.includes(${JSON.stringify(t)})`);
  const plant = d => ev(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(d))})`);
  const draft = () => ev(`(()=>{const v=localStorage.getItem(${JSON.stringify(KEY)});return v?JSON.parse(v):null})()`);
  const openRest = async () => { if (!(await ev(`!!document.querySelector('[data-row="next-action"]')`))) { await click('#rest-toggle'); await sleep(350); } };
  const mineNA = async () => { await openRest(); return shown('[data-row="next-action"] .ed-val'); };
  const trackBad = () => ev(`[...document.querySelectorAll('#track .track.bad h3')].some(x => x.textContent === ${JSON.stringify(N.ui.trackFailed)})`);
  const trackBtns = () => ev(`[...document.querySelectorAll('#track button')].map(b => b.textContent.trim())`);
  const wait = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; };
  const fresh = async () => { await load(1200); await ev('localStorage.clear()'); await load(); };
  const RELOAD = '重新載入頁面，再確認一次';

  /* ---------- 二：建議 1（M7）：送出後頁面已關閉，重開時失敗已跌出最近五項 ---------- */
  putConf({ 'next-action': NA_Y });
  putRuns([...notes5, failedX]);
  await load(1200); await ev('localStorage.clear()'); await plant(DRAFT('r-x.md', { 'next-action': NA_X })); await load();
  await wait(async () => isRe(await main()));
  ok('二：頁面關閉期間才套用失敗、失敗已跌出最近五項：保留送出的內容（下一個對外動作仍是 X），不被伺服器的 Y 覆蓋', (await mineNA()).includes(NA_X) && !(await mineNA()).includes(NA_Y), await mineNA());
  ok('二：「再確認一次」，並顯示失敗進度卡（伺服器附上的那一份）', isRe(await main()) && await trackBad(), [await main(), await trackBad()]);
  const d2 = await draft();
  ok('二：草稿標記為未套用（unapplied），sent 不變', !!d2 && d2.confirmed.unapplied === true && d2.confirmed.sent === true && (d2.edits || {})['next-action'] === NA_X, d2 && d2.confirmed);
  ok('二：沒有顯示「只下載了回覆檔」', !(await bodyHas('只下載了回覆檔')));
  await fresh();
  const other = await wait(async () => isLink(await main()));
  ok('二：另一部瀏覽器（沒有送出紀錄）：照常採用伺服器的 Y，不顯示過時的失敗進度卡', !!other && (await mineNA()).includes(NA_Y) && !(await trackBad()), [await main(), await trackBad()]);

  /* ---------- 三：建議 2（M4）：工作中途中斷，沒有「套用確認」步 ---------- */
  const interrupted = run('R-int', 'proofread', 'failed', ['r-x.md'], STEPS(['received', 'done']), { error: '工作中途中斷，未有完成。請按「重試」；如再次中斷，請在 AI 對話輸入 /crewzero:dashboard（或說「打開 CrewZero」）重新開啟後再試。' });
  putConf({ 'next-action': NA_Y });
  putRuns([interrupted, ...notes5.slice(0, 4)]);
  await load(1200); await ev('localStorage.clear()'); await plant(DRAFT('r-x.md', { 'next-action': NA_X })); await load();
  await wait(async () => isRe(await main()));
  ok('三：工作中途中斷：不當作已在 Zero，保留送出的內容（X），不被伺服器的 Y 覆蓋', (await mineNA()).includes(NA_X) && !(await mineNA()).includes(NA_Y) && isRe(await main()), [await mineNA(), await main()]);
  ok('三：失敗進度卡寫明「處理中途中斷」，不提供「重試」，只有「重新載入頁面，再確認一次」', await trackBad() && (await shown('#track')).includes(N.ui.interruptedNoApply) && !(await trackBtns()).includes(N.ui.retry) && (await trackBtns()).includes(RELOAD), [await shown('#track'), await trackBtns()]);
  ok('三：進度卡不再寫「請按重試」', !(await shown('#track')).includes('請按「重試」'), await shown('#track'));
  const d3 = await draft();
  ok('三：草稿標記為未套用', !!d3 && d3.confirmed.unapplied === true, d3 && d3.confirmed);
  await fresh();
  const o3 = await wait(async () => isLink(await main()));
  ok('三：另一部瀏覽器：採用 Y，也不顯示別人的中斷失敗卡', !!o3 && !(await trackBad()), [await main(), await trackBad()]);
  // 對照：AI 步失敗（套用已完成）→ 仍可重試，不要求重新確認；已交付
  const aiFail = run('R-ai', 'proofread', 'failed', ['r-x.md'], STEPS(['received', 'done'], ['applied', 'done'], ['ai', 'failed']), { error: 'AI 這次沒有完成' });
  putConf({ 'next-action': NA_X });
  putRuns([aiFail, ...notes5.slice(0, 4)]);
  await load(1200); await ev('localStorage.clear()'); await plant(DRAFT('r-x.md', { 'next-action': NA_X })); await load();
  await wait(async () => isLink(await main()) && await trackBad());
  ok('三：對照：AI 步失敗（套用已完成、伺服器已是 X）：已交付（連結），失敗卡提供「重試」，沒有「重新載入再確認」', isLink(await main()) && await trackBad() && (await trackBtns()).includes(N.ui.retry) && !(await trackBtns()).includes(RELOAD), [await main(), await trackBtns()]);

  /* ---------- 四：建議 3（M6）：unapplied 而送出的內容＝Zero 原值 ---------- */
  putConf({ 'next-action': NA_Y });
  putRuns(notes5);   // 失敗紀錄已跌出清單，伺服器也沒有附加
  const ORIG_NA = String(reg['next-action'].value);
  await load(1200); await ev('localStorage.clear()'); await plant(DRAFT('r-x.md', {}, { unapplied: true })); await load();
  await sleep(1500);
  ok('四：撤回全部修改並送出、套用失敗、失敗已跌出清單：保留送出的內容（Zero 原值），不採用伺服器的 Y', !(await mineNA()).includes(NA_Y) && (await mineNA()).includes(plain(ORIG_NA).slice(0, 12)), await mineNA());
  ok('四：「再確認一次」，不是連結', isRe(await main()), await main());
  ok('四：草稿仍有 unapplied 標記', (await draft()).confirmed.unapplied === true);
  // 對照：同樣的草稿沒有 unapplied（送出的內容已在 Zero）→ 伺服器其後的 Y 照常採用
  await load(1200); await ev('localStorage.clear()'); await plant(DRAFT('r-x.md', {})); await load();
  const ctl = await wait(async () => isLink(await main()));
  ok('四：對照：沒有 unapplied（送出的內容已在 Zero）：伺服器其後的 Y 照常採用', !!ctl && (await mineNA()).includes(NA_Y), [await main(), await mineNA()]);
  // 離線確認原值（沒有 sent）：維持採用
  await load(1200); await ev('localStorage.clear()');
  await plant({ edits: {}, order: ids, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name: 'dl.md', digest: dgOf({}) }, sent: null, ok: {}, kinds: {} }); await load();
  const off = await wait(async () => isLink(await main()));
  ok('四：離線確認原值（沒有 sent）：維持現狀，採用伺服器的 Y', !!off && (await mineNA()).includes(NA_Y), [await main(), await mineNA()]);

  /* ---------- 五：「清除我的修改」提示如實 ---------- */
  const toastText = () => ev(`(()=>{const e=document.querySelector('#toast');return e&&!e.hidden?e.textContent:''})()`);
  const clearMine = async () => { await click('.foot-tools .btn.small'); await sleep(200); await click('.foot-tools .btn.small'); };
  putConf({ 'next-action': NA_Y });
  putRuns(notes5);
  await load(1200); await ev('localStorage.clear()');
  await plant({ ...DRAFT('r-y.md', { 'next-action': NA_Y }), edits: { 'next-action': NA_Z } }); await load();   // 基線是 Y（已與 Zero 同步），本機另改成 Z
  await wait(async () => (await ev(`!!document.querySelector('.foot-tools .btn.small')`)));
  ok('五：前提：伺服器有確認，這部瀏覽器有未送出的修改（Z）：保護、有「清除我的修改」', (await mineNA()).includes(NA_Z) && await ev(`!!document.querySelector('.foot-tools .btn.small')`), await mineNA());
  await clearMine();
  const t1 = await toastText();
  ok('五：伺服器對本頁有確認：清除後提示寫「改回 Zero 已確認的內容」，不寫「恢復 Zero 建議」', t1 === N.ui.clearedToConfirmed && !t1.includes('恢復 Zero 建議'), t1);
  const adopted = await wait(async () => isLink(await main()) && (await mineNA()).includes(NA_Y));
  ok('五：清除後頁面確實改採用伺服器已確認的內容（Y）', !!adopted, [await main(), await mineNA()]);
  fs.rmSync(CONF, { force: true });
  await load(1200); await ev('localStorage.clear()'); await plant({ edits: { 'next-action': NA_Z }, order: ids, openedPath: false, note: '', confirmed: null, sent: null, ok: {}, kinds: {} }); await load();
  await wait(async () => (await ev(`!!document.querySelector('.foot-tools .btn.small')`)));
  await clearMine();
  const t2 = await toastText();
  ok('五：伺服器對本頁沒有確認：清除後提示維持「恢復 Zero 建議」，並確實回到 Zero 原值', t2 === N.ui.clearedToZero && !(await mineNA()).includes(NA_Z), [t2, await mineNA()]);

  /* ---------- 六：@status 按「照此確認（Zero 建議）」後重新載入仍已答 ---------- */
  // Zero 預填有一項已發生（不是全部「未發生」）時，按鈕才是「照此確認（Zero 建議）」：改用一份有一項已說過的公司概覽
  const pgS = JSON.parse(JSON.stringify(pg)); pgS.glance.status.items[0].value = 'said';
  fs.writeFileSync(path.join(DATA, 'company', 'page.json'), JSON.stringify(pgS, null, 2));
  fs.rmSync(CONF, { force: true });
  await fresh();
  const hasBtn = await ev(`!!document.querySelector('#dq-status .q-ok')`);
  const btnText = await shown('#dq-status .q-ok');
  ok('六：前提：未答時有「照此確認（Zero 建議）」', hasBtn && btnText.includes(plain(N.ui.allAsShown)), btnText);
  await click('#dq-status .q-ok');
  ok('六：按下後：已答、按鈕消失', !(await ev(`!!document.querySelector('#dq-status .q-ok')`)) && await ev(`document.querySelector('#dq-status').classList.contains('done')`));
  await load();
  ok('六：重新載入後仍已答、沒有該按鈕', !(await ev(`!!document.querySelector('#dq-status .q-ok')`)) && await ev(`document.querySelector('#dq-status').classList.contains('done')`), await shown('#dq-status'));
  const dq = await ev(`(()=>{const k=Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0];return k?JSON.parse(localStorage.getItem(k)):null})()`);
  ok('六：草稿帶有 @status 已答標記', !!dq && dq.ok && dq.ok['@status'] === true, dq && dq.ok);

  /* ---------- 七：「和 Zero 一起想」在公司概覽已就緒時的回覆 ---------- */
  const t = N.ui.ideateHasOverview;
  ok('七：回覆指向「和 Zero 討論」：三種打法（Claude Code、Codex、Antigravity）及說法俱全', t.includes('/crewzero:discuss') && t.includes('$crewzero:discuss') && t.includes('/discuss') && t.includes('和 Zero 討論') && t.includes(N.ui.discussAll), t);
  ok('七：不再只叫人「請先查看公司概覽」', !t.includes('請先查看公司概覽'), t);
  ok('七：用字檢查零命中', N.styleIssues(t + N.ui.clearedToZero + N.ui.clearedToConfirmed + N.ui.interruptedNoApply).length === 0, N.styleIssues(t));
  const r = await tfetch(BASE + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ kind: 'note', type: 'ideate', text: '' }) });
  const rj = await r.json().catch(() => ({}));
  ok('七：公司概覽已就緒時，伺服器拒收「和 Zero 一起想」並回傳上述字句', r.status === 400 && rj.message === t, [r.status, rj]);
  const askSrc = fs.readFileSync(path.join(PROTO, 'ask.html'), 'utf8');
  ok('七：要求頁按目前認證的工具只顯示一種打法（沿用「和 Zero 討論」的 discussCmd）', /String\(why\(e\)\)\.split\(N\.ui\.discussAll\)\.join\(discussCmd\(V\.status\)\)/.test(askSrc));
  const errs = c.errors || [];
  ok('頁面沒有未預期的錯誤', errs.length === 0, errs);
} catch (e) { ok('測試中斷', false, String(e && e.stack || e)); }
finally { if (c) c.close(); if (srv) srv.kill(); }

for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + (x.pass ? '' : '\n      ' + String(JSON.stringify(x.info)).slice(0, 900)));
const pass = results.filter(x => x.pass).length;
console.log(`\n${pass}/${results.length} passed`);
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 500);
