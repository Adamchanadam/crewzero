// 未登記入全套，等甲實作後才登記。
// 甲、計數及關包規則的先失敗測試（docs/evidence/pending-truth-2026-11-12/fable-analysis.md 第 2.1 節；第 4 節「新增的驗收劇本」第 1、2、6 項）。
//   劇本 1：答完一個包內所有必答題，x 即時減 1；餘下不用答的題不再令這個包出現在待決事項。
//   劇本 2：每週訪問答完必答題後，下一期訪問如期出現。
//   劇本 6：全頁各處的數字相同、單位相同（導航、首頁指標、分頁標題、待決清單、作答後提示句）。
// x 的意思（甲）：仍有「必須由你答」的未答題的問題包數目（求助回覆不計）。必答題判斷：有 ask-lib 的 requiresFounder 就用它；未有就用 run.mjs 現有後台定義的副本。
// 做法：先直接叫外殼（模擬時鐘、未認證 AI、零次 AI）令每週訪問由 placeInterviewIfDue 出題；另放一個有三條即時生效題的決定包（夾具，令「包數」與「題數」不同，單位錯了才看得出）。
//   之後起伺服器（SOS_SIM），經 /api/submit 作答、/api/sim 推前時鐘。整個流程只經伺服器，不與外殼直接搶同一份資料。
// 數字來源（只核對介面資料及字句範本，不是畫面像素）：
//   導航＝/api/status 的 openAsks（desk.js 頁頭 pending）；首頁指標＝dash-lib dashboardState 的 metrics.pending；
//   分頁標題及待決清單＝/api/asks 的 todo（ask.html 第 854、908 行一帶：去掉公司概覽項後的長度）；
//   作答後提示句＝desk.js 的 SOS_DESK.nextStep(openAsks).line（在 node 沙盒載入 desk.js，計時器全部不執行）。
// 單位：提示句若寫「條問題」，數字必須等於仍要你答的必答題數；不硬寫甲之後的新字句。
// 用法：node tests/prototype/pending/jia-count-test.mjs [原型資料夾] [輸出資料夾] [埠（預設 16950）]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { writeAdapters } from '../lib/adapters.mjs';
import { usePass } from '../lib/testkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pad = n => String(n).padStart(2, '0'), now0 = new Date();
const PROTO = path.resolve(process.argv[2] || path.join(HERE, '..', '..', '..', 'prototypes', 'proofread'));
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'crewzero-tests', `jia-${now0.getFullYear()}${pad(now0.getMonth() + 1)}${pad(now0.getDate())}-${pad(now0.getHours())}${pad(now0.getMinutes())}${pad(now0.getSeconds())}`));
const PORT = Number(process.argv[4] || 16950);
const BASE = 'http://127.0.0.1:' + PORT;
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
const NAMES = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 900))); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const requiresFounder = typeof lib.requiresFounder === 'function' ? (pack, q) => !!lib.requiresFounder(pack, q)
  : (pack, q) => !!(q && (pack.ideate || q.effect === 'now' || q.conflict || q.bind === 'results' || pack.actionConfirm || pack.acceptance && q.id === 'accept'));
const hasValue = a => !!a && String(a.value ?? '').trim() !== '';
const START = '2026-11-02T12:00:00';
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

// desk.js 是瀏覽器腳本：在沙盒載入，只取 nextStep（作答後提示句的唯一定義）
const DESK = (() => {
  const stub = () => new Proxy(function () { }, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : stub(), apply: () => stub(), construct: () => stub(), set: () => true });
  const noop = () => 0;
  const ctx = { SOS_NAMES: NAMES, console, document: stub(), window: stub(), localStorage: stub(), sessionStorage: stub(), matchMedia: () => ({ matches: false, addEventListener() { } }), setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop, location: { pathname: '/', hash: '', search: '' }, navigator: { userAgent: '' } };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(PROTO, 'desk.js'), 'utf8'), ctx);
  return ctx.SOS_DESK;
})();

freshTestOut(OUT);
const AD = writeAdapters(path.join(OUT, 'adapters'));
const DATA = path.join(OUT, 'data');
oldInstall(DATA, PROTO);
fs.mkdirSync(path.join(DATA, 'founder', 'desk'), { recursive: true });
const clock = iso => fs.writeFileSync(path.join(DATA, 'founder', 'desk', 'sim-clock.json'), JSON.stringify({ offsetMs: Date.parse(iso) - Date.now(), at: new Date().toISOString() }));
clock(START);
process.env.SOS_SIM = '1'; process.env.SOS_DATA = DATA;
const DIR = lib.dataDirs(PROTO);
const env = { ...process.env, SOS_SIM: '1', SOS_DATA: DATA, SOS_ADAPTER: AD.fake, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
const rhythm = () => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'rhythm', '--trigger', 'manual'], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
const state = () => read(path.join(DIR.ledger, 'state.json'));
const allPacks = () => { try { return fs.readdirSync(DIR.asks).filter(f => f.endsWith('.json')).map(f => read(path.join(DIR.asks, f))); } catch { return []; } };
const answersOf = id => { try { return read(path.join(DIR.answers, id + '.json')).answers || {}; } catch { return {}; } };
const requiredLeft = p => (p.questions || []).filter(q => requiresFounder(p, q) && !hasValue(answersOf(p.id)[q.id]));
const interviews = () => allPacks().filter(p => p.rhythm && p.rhythm.kind === 'interview');

const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function idle(ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const s = await get('/api/status'); if (!s.busy && !(s.pending || []).length) { await sleep(500); const s2 = await get('/api/status'); if (!s2.busy && !(s2.pending || []).length) return true; } await sleep(300); } return false; }
async function submit(pack, pick) {
  const done = answersOf(pack.id);
  const list = pack.questions.filter(q => !done[q.id]).map(q => { const v = pick(q); return v === undefined ? null : { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; }).filter(Boolean);
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: false', 'shownAt: ' + lib.localIso()];
  const r = await post('/api/submit', { kind: 'ask-answer', ref: pack.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  await sleep(400); await idle();
  return r;
}
// 各處數字一次讀齊
async function snapshot() {
  const st = await get('/api/status'), asks = await get('/api/asks');
  const todo = (asks.todo || []).filter(t => t.kind !== 'overview');
  const metric = (dash.dashboardState(DIR, {}).metrics || {}).pending;
  const next = DESK.nextStep(st.openAsks);
  const open = allPacks().filter(p => !p.help && requiredLeft(p).length > 0);
  return {
    nav: st.openAsks, metric, tab: todo.length, list: todo.filter(t => t.kind === 'ask').length, hintN: next.n, hintLine: next.line,
    x: open.length, requiredQ: open.reduce((k, p) => k + requiredLeft(p).length, 0), todoIds: todo.map(t => t.id), xIds: open.map(p => p.id)
  };
}
function sameEverywhere(tag, s) {
  ok(tag + '：導航、首頁指標、分頁標題、待決清單、作答後提示句的數字相同，並等於要你決定的事（x）', [s.nav, s.metric, s.tab, s.list, s.hintN].every(n => n === s.x), s);
  ok(tag + '：作答後提示句的單位與數字相符（寫「條問題」就要等於仍要你答的題數）', s.hintN === 0 || !s.hintLine.includes('條問題') || s.hintN === s.requiredQ, { line: s.hintLine, n: s.hintN, requiredQuestions: s.requiredQ, x: s.x });
}

let srv = null;
try {
  /* ---------- 準備：外殼出第一期每週訪問；另放一個有三條即時生效題的決定（夾具） ---------- */
  rhythm();
  const iv0 = state().interviews || {};
  clock(addDays(iv0.nextOn, -1) + 'T12:00:00');
  rhythm();
  const iv = interviews()[0];
  ok('準備：第一期每週訪問由外殼按帳本出題', !!iv && iv.rhythm.on === iv0.nextOn && state().interviews.packId === iv.id, { interviews: state().interviews });
  if (!iv) throw new Error('第一期未出，無法續測');
  const fixture = { format: 'startup-os.ask/0.1', id: 'ask-' + iv0.nextOn.replace(/-/g, '') + '-jia-fx', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: null, title: '送貨安排（測試夾具）', context: '測試夾具：三條即時生效的決定。', afterConfirm: '答案即時生效', todoType: 'blocking',
    questions: [
      { id: 'd1', priority: 1, ask: '首批送貨改由表哥負責嗎？（測試）', kind: 'choice', effect: 'now', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', why: '測試夾具' },
      { id: 'd2', priority: 2, ask: '送貨日定在星期三嗎？（測試）', kind: 'choice', effect: 'now', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', why: '測試夾具' },
      { id: 'd3', priority: 3, ask: '首批只送兩間餐廳嗎？（測試）', kind: 'choice', effect: 'now', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', why: '測試夾具' }] };
  lib.placePacks(DIR, [fixture]);
  ok('準備：夾具包有三條必答題（令包數與題數不同）', requiredLeft(fixture).length === 3, requiredLeft(fixture).map(q => q.id));

  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env, stdio: 'ignore' });
  await usePass(BASE);
  let up = false;
  for (let i = 0; i < 200 && !up; i++) { try { up = !!(await get('/api/status')).ok; } catch { } if (!up) await sleep(300); }
  if (!up) throw new Error('伺服器 60 秒內未起好');
  await idle();

  /* ---------- 劇本 6：開始時各處數字 ---------- */
  const s0 = await snapshot();
  sameEverywhere('劇本 6（開始）', s0);

  /* ---------- 劇本 1：每週訪問只答必答題 → x 即時減 1、這個包不再出現 ---------- */
  const req = iv.questions.filter(q => requiresFounder(iv, q));
  ok('劇本 1 前提：每週訪問有必答題，亦有不用你答的題', req.length > 0 && req.length < iv.questions.length, req.map(q => q.id));
  await submit(iv, q => requiresFounder(iv, q) ? (q.bind === 'results' ? '本週完成三次送貨（測試）' : q.value) : undefined);
  const s1 = await snapshot();
  ok('劇本 1 前提：每週訪問的必答題已全部答，餘題未答', requiredLeft(iv).length === 0 && iv.questions.some(q => !answersOf(iv.id)[q.id]), { requiredLeft: requiredLeft(iv).map(q => q.id) });
  ok('劇本 1：答完包內所有必答題 → 導航數字即時減 1', s1.nav === s0.nav - 1, { before: s0.nav, after: s1.nav });
  ok('劇本 1：餘下不用答的題不再令這個包出現在待決事項', !s1.todoIds.includes(iv.id), { todo: s1.todoIds, pack: iv.id });
  sameEverywhere('劇本 6（答完每週訪問必答題後）', s1);

  /* ---------- 對照：決定包全部答完 → x 減 1（現行程式已成立，證明流程正確） ---------- */
  await submit(fixture, q => q.value);
  const s2 = await snapshot();
  ok('對照：全部答完的包 → 導航數字減 1、包不再出現', s2.nav === s1.nav - 1 && !s2.todoIds.includes(fixture.id), { before: s1.nav, after: s2.nav, todo: s2.todoIds });

  /* ---------- 劇本 2：每週訪問答完必答題後，下一期如期出現 ---------- */
  const next = state().interviews.nextOn;
  ok('劇本 2 前提：帳本已把第一期記為完成、下次訪問日已推後', state().interviews.lastFor === iv.rhythm.on && next > iv.rhythm.on, state().interviews);
  let second = null;
  for (let i = 0; i < 10 && !second; i++) {
    const before = (state().runs || []).filter(r => r.trigger === 'schedule').length;
    const r = await post('/api/sim', { action: 'advance' });
    if (r.code !== 200) { await idle(); continue; }
    const t = Date.now();
    while (Date.now() - t < 60000) { const sr = (state().runs || []).filter(x => x.trigger === 'schedule'); if (sr.length > before && sr[sr.length - 1].state !== 'running' && await idle(20000)) break; await sleep(400); }
    second = interviews().find(p => p.id !== iv.id && p.rhythm.on === next) || null;
    if ((await get('/api/status')).today > next) break;
  }
  const slots = (state().runs || []).filter(r => r.trigger === 'schedule' && r.slot >= addDays(next, -2) && r.slot <= next).map(r => r.slot);
  ok('劇本 2 前提：排程已在下一期訪問日前兩天內開工（外殼有機會出題）', slots.length > 0, { next, slots });
  ok('劇本 2：每週訪問答完必答題後，下一期訪問如期出現', !!second, { next, today: (await get('/api/status')).today, packs: interviews().map(p => [p.id, p.rhythm.on]) });
  sameEverywhere('劇本 6（推前到下一期之後）', await snapshot());
  ok('全程沒有開 AI', (state().runs || []).every(r => !r.aiStarted), (state().runs || []).filter(r => r.aiStarted).map(r => r.id));
} catch (e) {
  ok('測試出錯', false, String(e && e.stack || e));
} finally {
  if (srv) srv.kill();
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} 通過（輸出：${OUT}）`);
  try { fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1)); } catch { }
  process.exit(pass === results.length ? 0 : 1);
}
