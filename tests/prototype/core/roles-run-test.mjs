// 0.41.0 Zero 團隊分工：外殼接線測試（第 1 線）。假 AI 是自帶的 lib/roles-fake-ai.mjs（按 fake-plan.json 逐次指定），不開瀏覽器、不起伺服器、不連外網。
// 逐段對應 docs/evidence/zero-roles-2026-11-08/state-table-041.md：
//  A 多件日工作循環（Z23、Z34–Z49、Z53、Z56–Z58）　B 擬崗位→確認→啟用→暫停（Z1–Z13、Z24–Z26）　C 統籌校對鏈（Z27–Z32、Z54、Z55）
//  D 中途加站及加崗位（Z14–Z22）　E 三格權限、成員離開（Z51、Z52）　F 收尾三項（Z33、新對象自訂答案、不再建議）
// 用法：node roles-run-test.mjs <原型資料夾> <輸出資料夾> <port（不使用）>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeAdapters } from '../lib/adapters.mjs';
import { certifyDirect } from '../lib/testkit.mjs';
const [PROTO, OUT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = f => import(pathToFileURL(path.join(PROTO, f)).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await imp('ask-lib.mjs'), P = await imp('people-ops.mjs'), R = await imp('roles-ops.mjs'), PACE = await imp('pace-lib.mjs'), brain = await imp('brain-lib.mjs');
const results = []; const ok = (n, p, i) => { results.push({ name: n, pass: !!p, info: i }); console.log((p ? 'PASS ' : 'FAIL ') + n + (p ? '' : '  ' + JSON.stringify(i ?? '').slice(0, 300))); };
const attempt = async (name, fn) => { try { await fn(); } catch (e) { ok(name + '（執行出錯）', false, String(e && e.stack || e).slice(0, 500)); } };
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });

// 測試 AI 設定：用共用的 fake adapter 形狀，換成自帶假 AI
const AD = writeAdapters(path.join(OUT, 'adapters'));
const adapter = JSON.parse(fs.readFileSync(AD.fake, 'utf8'));
adapter.args = [path.resolve(HERE, '..', 'lib', 'roles-fake-ai.mjs')];
const ADAPTER = path.join(OUT, 'adapters', 'adapter-roles.json'); fs.writeFileSync(ADAPTER, JSON.stringify(adapter, null, 2));

const jr = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const TODAY = lib.localIso().slice(0, 10);
const ymd = (off = 0) => lib.localIso(new Date(Date.now() + off * 86400000)).slice(0, 10);
let seq = 0;
// 一個獨立世界：舊安裝公司（已確認概覽）→ 同步帳本 → 認證假 AI → 基線狀態（名單已整理、生意體檢已做、訪問日在遠方；是否已擬崗位由 roles 選項定）
async function world(name, { roles = false, mutate = null } = {}) {
  const W = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name), DATA = path.join(W, 'data');
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  oldInstall(DATA, PROTO);
  const env = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
  const STATE = path.join(DATA, 'ledger', 'state.json');
  const state = () => jr(STATE);
  const put = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  shell('--type', 'rhythm', '--trigger', 'manual');   // 未認證 → 只同步帳本，不開工
  // 第一次開工（未認證）已放上深化站點、每週訪問題：清走，免得干擾停止原因
  for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(DATA, d))) fs.rmSync(path.join(DATA, d, f), { force: true }); } catch { } }
  await certifyDirect(DATA, PROTO, ADAPTER);
  const s = state();
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: P.peopleSyncKey(s) }; s.depthPackFor = s.ledgerFrom;
  if (!roles) s.rolesSync = { for: R.rolesKey(s) };
  // 同步帳本時外殼自己建的「補資料」首批工作：標為已完成，免得排在測試工作之前
  const keep = (s.tasks || []).filter(x => x.firstBatch).map(x => ({ ...x, status: 'done', doneOn: ymd(-3) }));
  s.tasks = []; s.runs = [];
  if (mutate) mutate(s);
  s.tasks = (s.tasks || []).concat(keep.filter(k => !(s.tasks || []).some(x => x.id === k.id)));
  put(s);
  process.env.SOS_DATA = DATA;
  const DIR = lib.dataDirs(PROTO);
  fs.mkdirSync(path.dirname(brain.brainFile(DIR, 'checkup')), { recursive: true });
  fs.writeFileSync(brain.brainFile(DIR, 'checkup'), JSON.stringify({ updatedAt: lib.localIso(), weak: [], unseen: [], notNow: [], summary: '測試', industryCheck: [] }));
  const W2 = {
    DATA, DIR, state, put, shell, env,
    plan: o => { const f = path.join(DATA, 'fake-plan.json'); let p = {}; try { p = jr(f); } catch { } for (const [k, v] of Object.entries(o)) p[k] = (p[k] || []).concat(v); fs.writeFileSync(f, JSON.stringify(p)); },
    calls: () => { try { return fs.readFileSync(path.join(DATA, 'fake-calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } },
    callTypes: () => W2.calls().map(c => c.type),
    starts: () => { try { return fs.readFileSync(path.join(DATA, 'ledger', 'ai-starts.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } },
    setStarts: (n, kind = 'rhythm') => fs.writeFileSync(path.join(DATA, 'ledger', 'ai-starts.log'), Array.from({ length: n }, (_, i) => lib.localIso() + '\t' + kind + '\tZZ' + i).join('\n') + '\n'),
    ops: list => { const f = path.join(DATA, 'ledger', 'founder-ops.json'); let cur = []; try { cur = jr(f); } catch { } fs.writeFileSync(f, JSON.stringify(cur.concat(list.map((o, i) => ({ id: 'op-' + Date.now() + '-' + (seq++) + '-' + i, at: lib.localIso(), ...o }))))); },
    packs: () => { try { return fs.readdirSync(path.join(DATA, 'asks')).filter(f => f.endsWith('.json')).map(f => jr(path.join(DATA, 'asks', f))); } catch { return []; } },
    answers: id => { try { return jr(path.join(DATA, 'ledger', 'answers', id + '.json')).answers; } catch { return {}; } },
    openPacks: () => W2.packs().filter(p => p.questions.some(q => (q.effect === 'now' || (p.acceptance && q.id === 'accept')) && !W2.answers(p.id)[q.id])),
    packOf: pred => W2.packs().filter(pred).sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt))),
    rhythm: (...a) => { const r = shell('--type', 'rhythm', '--trigger', 'manual', ...a); return r; },
    lastRun: () => { const rs = state().runs.filter(r => r.type === 'rhythm'); return rs[rs.length - 1]; },
    // 作答：pick(q) 回答案（undefined＝不答這題）；直接寫回覆檔，再叫外殼處理
    answer: (pack, pick) => {
      pack = jr(path.join(DATA, 'asks', pack.id + '.json'));
      const done = W2.answers(pack.id);
      const list = pack.questions.filter(q => !done[q.id]).map(q => ({ q, v: pick(q) })).filter(x => x.v !== undefined).map(({ q, v }) => ({ id: q.id, value: v, ai: q.value, changed: v !== q.value }));
      const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
      const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: ' + (list.length < pack.questions.length), 'shownAt: ' + lib.localIso()];
      fs.mkdirSync(DIR.replies, { recursive: true });
      fs.writeFileSync(path.join(DIR.replies, lib.localIso().replace(/\D/g, '') + '-ask-answer-' + pack.id + '-' + (seq++) + '.md'), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
      return shell();
    }
  };
  return W2;
}
const aiTask = (id, title, extra = {}) => ({ id, title, owner: 'ai', status: 'planned', milestoneId: 'm1', next: '整理一份清單', updatedAt: lib.localIso(), ...extra });
const msTasks = (n, ms = 'm1') => Array.from({ length: n }, (_, i) => aiTask('t' + (i + 1), '測試工作' + (i + 1), { milestoneId: ms }));
const log = r => (r.stdout || '') + (r.stderr || '');
const plantPack = (W, id, o = {}) => { fs.mkdirSync(W.DIR.asks, { recursive: true }); fs.writeFileSync(path.join(W.DIR.asks, id + '.json'), JSON.stringify({ format: 'startup-os.ask/0.1', id, title: o.title || '測試題', context: '測試', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: null, ...(o.pack || {}), questions: [{ id: 'q1', priority: 1, ask: '測試：是否可以？', kind: 'choice', effect: 'now', options: [{ text: '可以', rec: true }, { text: '不可以' }], value: '可以', why: '測試' }] }, null, 2)); };
const setRhythm = (s, o) => { s.company = s.company || {}; s.company.rhythm = { ...(s.company.rhythm || {}), ...o }; };
const itemsOf = r => (r && r.items) || [];
const SPRINT = { pace: 'sprint', sprintUntil: ymd(5), sprintStartedOn: TODAY };

/* =====================================================================
   A　多件日工作循環
===================================================================== */
await attempt('A1', async () => {
  const W = await world('a1-standard', { mutate: s => { s.tasks = msTasks(3); } });
  const r = W.rhythm(); const run = W.lastRun(), s = W.state();
  ok('A1 標準日（舊資料沒有新欄）：只做 1 件、不重做同一件（Z37、Z53）', W.callTypes().filter(t => t === 'rhythm').length === 1 && itemsOf(run).length === 1 && s.tasks.find(t => t.id === 't1').status === 'done' && s.tasks.find(t => t.id === 't1').doneOn === TODAY && s.tasks.find(t => t.id === 't2').status === 'planned', { calls: W.callTypes(), items: itemsOf(run), out: log(r).slice(-300) });
  ok('A1 工作日鎖定、runs[].workDay、收尾寫 items（taskId、ending、workId）（Z57）', run.workDay === TODAY && itemsOf(run)[0].taskId === 't1' && itemsOf(run)[0].ending === 'artifact' && fs.existsSync(path.join(W.DATA, 'work', itemsOf(run)[0].workId, 'receipt.json')), run);
  ok('A1 標準日 ending 與 0.40.2 相同（artifact）、不加停止原因', run.ending === 'artifact' && !run.stopReason && run.state === 'ended' && run.artifacts === 1, run);
  const task = W.calls().find(c => c.type === 'rhythm').task;
  ok('A1 工作說明：八段齊、只含這一件（Z24）', /## 一、目標/.test(task) && /## 八、停止及回報條件/.test(task) && /測試工作1/.test(task) && !/測試工作2/.test(task), task.slice(0, 300));
  W.rhythm();
  ok('A1 同日再手動開工：標準已做滿 1 件，不再開 AI（手動不多出一輪）', W.callTypes().filter(t => t === 'rhythm').length === 1 && W.lastRun().ending === 'checked', { calls: W.callTypes(), run: W.lastRun() });
  ok('A18 防空轉按日：同日兩次開工只加一次（Z49）', W.state().health.noProgressStreak === 1 && !W.state().health.autoStopped, W.state().health);
  ok('Z56 啟動計數：ai-starts 每次一行、類別 rhythm，計入工作類', W.starts().length === 1 && PACE.countStarts(W.starts(), TODAY, { runIds: [run.id] }).work === 1, W.starts());
});
await attempt('A2', async () => {
  const W = await world('a2-fast', { mutate: s => { s.tasks = msTasks(5); setRhythm(s, { pace: 'fast' }); } });
  W.rhythm(); const run = W.lastRun(), s = W.state();
  ok('A2 加速日：做 3 件、每件獨立收據及資料夾（Z38）', itemsOf(run).length === 3 && W.callTypes().filter(t => t === 'rhythm').length === 3 && [run.id, run.id + '-i2', run.id + '-i3'].every(id => fs.existsSync(path.join(W.DATA, 'work', id, 'receipt.json'))), { items: itemsOf(run), calls: W.callTypes() });
  ok('A2 加速日停止原因 itemsCap、三件按次序完成', run.stopReason === 'itemsCap' && ['t1', 't2', 't3'].every(id => s.tasks.find(t => t.id === id).status === 'done') && s.tasks.find(t => t.id === 't4').status === 'planned', run);
  ok('A2 每件說明只含自己那一件，第四段列出今日已做的件（Z24）', (() => { const cs = W.calls().filter(c => c.type === 'rhythm'); return /測試工作2/.test(cs[1].task) && /今日已做的件/.test(cs[1].task) && /測試工作1/.test(cs[1].task.split('今日已做的件')[1] || '') && !/今日已做的件/.test(cs[0].task); })());
});
await attempt('A3', async () => {
  const W = await world('a3-sprint', { mutate: s => { s.tasks = msTasks(12); setRhythm(s, SPRINT); } });
  W.rhythm(); const run = W.lastRun();
  ok('A3 衝刺日：當日件數達 10 即停，stopReason itemsCap，餘下 2 件留明日（Z39）', itemsOf(run).length === 10 && run.stopReason === 'itemsCap' && W.state().tasks.filter(t => /^t[0-9]+$/.test(t.id) && t.status === 'done').length === 10, { n: itemsOf(run).length, stop: run.stopReason });
  ok('A3 衝刺 10 件的啟動次數不超過衝刺保險絲 80（Z36）', W.starts().length === 10 && PACE.fuseOf(W.state()) === 80);
});
await attempt('A4', async () => {
  const W = await world('a4-nothing', { mutate: s => { s.tasks = msTasks(3); setRhythm(s, SPRINT); } });
  W.rhythm(); const run = W.lastRun();
  ok('A4 衝刺：可以做的做完 → nothingToDo，不為湊數多開 AI（Z40）', itemsOf(run).length === 3 && run.stopReason === 'nothingToDo' && W.callTypes().length === 3, { stop: run.stopReason, calls: W.callTypes() });
});
await attempt('A4b', async () => {
  const W = await world('a4b-free-brief', { mutate: s => { s.tasks = []; } });
  W.rhythm();
  const call = W.calls().find(c => c.type === 'rhythm');
  ok('A4b 沒有工作可做的第一件，同樣附八段工作說明（覆核建議 1）', !!call && ['一、目標', '二、範圍與排除', '三、必要來源位置', '四、輸入與進度', '五、權限', '六、第一步', '七、交付與驗收', '八、停止及回報條件'].every(h => call.task.includes('## ' + h)), call && call.task.slice(0, 500));
});
await attempt('A5', async () => {
  const W = await world('a5-waiting', { mutate: s => { s.tasks = msTasks(1).concat([aiTask('tw', '等你決定的工作', { status: 'waiting', waitingFor: '等你決定', milestoneId: 'm2' })]); setRhythm(s, SPRINT); } });
  plantPack(W, 'ask-test-open');
  W.rhythm(); const run = W.lastRun();
  ok('A5 衝刺：餘下工作停在未答題目 → waitingFounder，摘要寫等候題數（Z41）', itemsOf(run).length === 1 && run.stopReason === 'waitingFounder' && run.summary.length > 0, run);
});
await attempt('A6', async () => {
  const W = await world('a6-blocked', { mutate: s => { s.tasks = msTasks(2); setRhythm(s, { pace: 'fast' }); } });
  W.plan({ rhythm: [{ blocked: true, blockedOn: '等回覆' }] });
  W.rhythm(); let s = W.state(); const t1 = s.tasks.find(t => t.id === 't1');
  ok('A6 卡住只記 blockedOn（當日）及等候事項，狀態不變（Z53）', t1.blockedOn === TODAY && t1.status === 'planned' && t1.waitingFor === '等回覆' && itemsOf(W.lastRun())[0].ending === 'blocked', t1);
  ok('A6 同日不重做卡住的件；第二件照做', s.tasks.find(t => t.id === 't2').status === 'done' && W.callTypes().length === 2, W.callTypes());
  W.rhythm();
  ok('A6 同日再開工：卡住的件不派、無事可做不開 AI', W.callTypes().length === 2 && W.lastRun().ending === 'checked', { calls: W.callTypes(), run: W.lastRun() });
  plantPack(W, 'ask-test-rel', { pack: { milestoneId: 'm1' } }); W.answer({ id: 'ask-test-rel' }, q => q.value);
  s = W.state();
  ok('A6 與該站有關的創辦人輸入到達：blockedOn 解除（releaseBlocked）', !s.tasks.find(t => t.id === 't1').blockedOn, s.tasks.find(t => t.id === 't1'));
  W.rhythm();
  ok('A6 解除後同日可再做那一件', W.callTypes().filter(t => t === 'rhythm').length === 3 && W.state().tasks.find(t => t.id === 't1').status === 'done', W.callTypes());
  const W2 = await world('a6b-nextday', { mutate: s2 => { s2.tasks = msTasks(1); s2.tasks[0].blockedOn = ymd(-1); s2.tasks[0].waitingFor = '舊事'; } });
  W2.rhythm();
  ok('A6 昨日卡住的件，今日自動可再做（Z53）', W2.state().tasks[0].status === 'done', W2.state().tasks[0]);
});
await attempt('A6b', async () => {
  const blocked = s => { s.tasks = [aiTask('t1', '農場甲報價', { milestoneId: 'm1', blockedOn: TODAY }), aiTask('t2', '餐廳乙試單', { milestoneId: 'm2', blockedOn: TODAY })]; };
  const W = await world('a6b-related-input', { mutate: blocked });
  plantPack(W, 'ask-test-m1', { pack: { milestoneId: 'm1' } }); W.answer({ id: 'ask-test-m1' }, q => q.value);
  let s = W.state();
  ok('A6b 相關站的答案只解除該站卡住工作，不相關站維持卡住（覆核建議 2）', !s.tasks.find(t => t.id === 't1').blockedOn && s.tasks.find(t => t.id === 't2').blockedOn === TODAY, s.tasks);
  const W2 = await world('a6b-fromrun-input', { mutate: s2 => { blocked(s2); s2.runs = [{ id: 'R-source', items: [{ taskId: 't1' }] }]; } });
  plantPack(W2, 'ask-test-fromrun', { pack: { fromRun: 'R-source' } }); W2.answer({ id: 'ask-test-fromrun' }, q => q.value);
  s = W2.state();
  ok('A6b 問題包沒有站但可由來源工作得出時，只解除來源工作所在站', !s.tasks.find(t => t.id === 't1').blockedOn && s.tasks.find(t => t.id === 't2').blockedOn === TODAY, s.tasks);
  const W3 = await world('a6b-no-station', { mutate: blocked });
  plantPack(W3, 'ask-test-no-station'); W3.answer({ id: 'ask-test-no-station' }, q => q.value);
  s = W3.state();
  ok('A6b 只有題包答案而與任何站無關時，一件都不解除（覆核重現 r5）', ['t1', 't2'].every(id => s.tasks.find(t => t.id === id).blockedOn === TODAY), s.tasks.filter(t => ['t1', 't2'].includes(t.id)));
  const W4 = await world('a6b-note-input', { mutate: blocked });
  fs.mkdirSync(W4.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(W4.DIR.inbox, 'R20261109-100000-1-note-event.md'), 'kind: note\ntype: event\nref: R20261109-100000-1\n\n收到供應商回覆\n\n```json\n{"date":"2026-11-09"}\n```\n');  // 0.44.0：正常使用時事件筆記帶日期
  W4.shell(); s = W4.state();
  ok('A6b 不經題包的輸入（筆記）可能與任何工作有關，解除全部卡住工作', ['t1', 't2'].every(id => !s.tasks.find(t => t.id === id).blockedOn), s.tasks.filter(t => ['t1', 't2'].includes(t.id)));
});
await attempt('A7', async () => {
  let W = await world('a7-fuse40', { mutate: s => { s.tasks = msTasks(2); } });
  W.setStarts(40); W.rhythm();
  ok('A7 標準保險絲 40：今日已啟動 40 次 → 跳過「budgetExhausted」、不開 AI（Z36）', W.lastRun().state === 'skipped' && W.lastRun().skipReason === 'budgetExhausted' && W.callTypes().length === 0, W.lastRun());
  W = await world('a7-fast50', { mutate: s => { s.tasks = msTasks(5); setRhythm(s, { pace: 'fast' }); } });
  W.setStarts(40); W.rhythm();
  ok('A7 加速保險絲 50：已 40 次仍可開工，做滿 3 件', itemsOf(W.lastRun()).length === 3, W.lastRun());
  W = await world('a7-oldfield', { mutate: s => { s.tasks = msTasks(2); setRhythm(s, { aiStartsPerDay: 0 }); } });
  W.rhythm();
  ok('A7 舊欄 aiStartsPerDay 不再讀取（J6）：設 0 仍照常開工，保險絲由節奏檔決定', W.lastRun().state === 'ended' && itemsOf(W.lastRun()).length === 1, W.lastRun());
  W = await world('a8-fusemid', { mutate: s => { s.tasks = msTasks(3); setRhythm(s, SPRINT); } });
  W.setStarts(79); W.rhythm();
  ok('A8 衝刺保險絲 80：做完第 1 件用盡 → stopReason fuse（Z45）', itemsOf(W.lastRun()).length === 1 && W.lastRun().stopReason === 'fuse', W.lastRun());
});
await attempt('A9', async () => {
  const W = await world('a9-toolfail', { mutate: s => { s.tasks = msTasks(4); setRhythm(s, SPRINT); } });
  W.plan({ rhythm: [{ fail: true }, { fail: true }] });
  W.rhythm(); const run = W.lastRun(), s = W.state();
  ok('A9 AI 工具連續兩次失敗 → 停當日、不反覆重試（Z44）', itemsOf(run).length === 2 && itemsOf(run).every(i => i.ending === 'failed') && run.stopReason === 'toolFailed' && W.callTypes().length === 2, { items: itemsOf(run), stop: run.stopReason });
  ok('A9 失敗的件只記 failedOn（當日不再派），狀態不變', s.tasks.find(t => t.id === 't1').failedOn === TODAY && s.tasks.find(t => t.id === 't1').status === 'planned' && run.rejected === true, s.tasks.slice(0, 2));
});
await attempt('A11', async () => {
  const W = await world('a11-ops', { mutate: s => { s.tasks = msTasks(2); } });
  W.ops([{ op: 'setPace', target: 'company', value: { pace: 'sprint', sprintUntil: ymd(4) } }]);
  W.rhythm(); let s = W.state();
  ok('A11 setPace 經創辦人操作隊列套用：衝刺、期限、開始日（Z35、Z58）', s.company.rhythm.pace === 'sprint' && s.company.rhythm.sprintUntil === ymd(4) && s.company.rhythm.sprintStartedOn === TODAY && s.events.some(e => e.type === 'founder-op' && e.title === N.t('founderPaceChanged', { p: N.t('pace_sprint') })), s.company.rhythm);
  ok('A11 衝刺日把兩件都做完（nothingToDo）', itemsOf(W.lastRun()).length === 2 && W.lastRun().stopReason === 'nothingToDo', W.lastRun());
  W.ops([{ op: 'pauseZero', target: 'company', value: {} }]); W.rhythm(); s = W.state();
  ok('A11 pauseZero：health.pausedByFounder，開工跳過「已暫停」（Z58）', s.health.pausedByFounder === true && W.lastRun().skipReason === 'pausedByFounder', W.lastRun());
  W.ops([{ op: 'resumeZero', target: 'company', value: {} }]); W.rhythm(); s = W.state();
  ok('A11 resumeZero：恢復後不再暫停', !s.health.pausedByFounder && W.lastRun().skipReason !== 'pausedByFounder', W.lastRun());
});
await attempt('A12', async () => {
  const hook = (op, id) => ({ hook: { file: 'ledger/founder-ops.json', data: [{ id, op, target: 'company', value: op === 'setPace' ? { pace: 'standard' } : {}, at: lib.localIso() }] } });
  let W = await world('a12-midpause', { mutate: s => { s.tasks = msTasks(4); setRhythm(s, SPRINT); } });
  W.plan({ rhythm: [hook('pauseZero', 'mid-1')] }); W.rhythm();
  ok('A12 衝刺途中按「暫停 Zero」：下一件前生效，stopReason paused（Z57、Z58）', itemsOf(W.lastRun()).length === 1 && W.lastRun().stopReason === 'paused' && W.state().health.pausedByFounder === true, W.lastRun());
  W = await world('a12-midpace', { mutate: s => { s.tasks = msTasks(4); setRhythm(s, { pace: 'fast' }); } });
  W.plan({ rhythm: [hook('setPace', 'mid-2')] }); W.rhythm();
  ok('A12 加速途中改回標準：下一件前停，stopReason paceChanged（Z57）', itemsOf(W.lastRun()).length === 1 && W.lastRun().stopReason === 'paceChanged' && PACE.paceKey(W.state()) === 'standard', W.lastRun());
});
await attempt('A14', async () => {
  const W = await world('a14-expire', { mutate: s => { s.tasks = msTasks(4); setRhythm(s, { pace: 'sprint', sprintUntil: ymd(-1), sprintStartedOn: ymd(-8) }); } });
  W.rhythm(); const s = W.state();
  ok('A14 衝刺到期：回到標準、記 sprintEndedOn、sprintUntil 保留，當日只做 1 件（Z48）', s.company.rhythm.pace === 'standard' && s.company.rhythm.sprintEndedOn === TODAY && s.company.rhythm.sprintUntil === ymd(-1) && itemsOf(W.lastRun()).length === 1, s.company.rhythm);
});
await attempt('A15', async () => {
  let W = await world('a15-backlog', { mutate: s => { s.tasks = msTasks(3); setRhythm(s, SPRINT); } });
  for (let i = 0; i < 11; i++) plantPack(W, 'ask-acc-' + i, { pack: { todoType: 'acceptance', acceptance: { taskId: 'x' + i } } });
  W.rhythm();
  ok('A15 衝刺：未答驗收題超過 10 → backlog 暫停，不改 pace、不開 AI（Z42）', W.lastRun().stopReason === 'backlog' && itemsOf(W.lastRun()).length === 0 && W.state().company.rhythm.sprintPause.reason === 'backlog' && W.state().company.rhythm.pace === 'sprint', { run: W.lastRun(), rh: W.state().company.rhythm });
  W = await world('a16-noreply', { mutate: s => { s.tasks = msTasks(3); setRhythm(s, SPRINT); s.health = { ...(s.health || {}), lastInputAt: ymd(-3) + 'T10:00:00' }; } });
  plantPack(W, 'ask-open-1'); W.rhythm();
  ok('A16 衝刺：有未答題目且兩日沒有回覆 → noReply 暫停（Z43）', W.lastRun().stopReason === 'noReply' && W.state().company.rhythm.sprintPause.reason === 'noReply', W.lastRun());
});
await attempt('A17', async () => {
  const W = await world('a17-free', {});
  W.rhythm(); const run = W.lastRun();
  ok('A17 沒有工作可做的第一件：Zero 自行準備（0.40.2 行為），標準日只做這一件', W.callTypes().filter(t => t === 'rhythm').length === 1 && itemsOf(run).length === 1 && itemsOf(run)[0].taskId === '' && ['artifact', 'blocked'].includes(run.ending), run);
});

/* =====================================================================
   B　擬崗位 → 確認 → 啟用 → 暫停
===================================================================== */
const mkCard = (over = {}) => ({ id: 'tm-x', title: '社區拓展經理', name: '社區拓展經理', mission: '負責農場簽約。', milestoneIds: ['m1'], supports: [], targets: ['customer'], how: ['整理資料'], strategy: '先把農場簽約做穩。', sources: ['confirmedPage'], deliverables: ['message'], knowledge: [], bounds: { tellAfter: [], askFirst: [] }, lifecycle: 'enabled', activation: { taskId: 'act-x', acceptedAt: lib.localIso() }, activationTaskId: '', activationReturns: 0, avatarKind: 'outreach', createdAt: lib.localIso(), ...over });
const shownOf = P0 => [P0.title, P0.context, P0.afterConfirm, ...P0.questions.flatMap(q => [q.ask, q.judge, q.why, q.inputHint, ...(q.options || []).map(o => o.text), ...(q.roleCard ? [q.roleCard.title, q.roleCard.mission, q.roleCard.activation, ...q.roleCard.stations, ...q.roleCard.supports, ...q.roleCard.askFirst] : [])])].filter(Boolean);
const styleHits = texts => texts.flatMap(t => N.styleIssues(String(t || '')).map(h => h.term || h));
const rolePacks = W => W.packOf(p => p.rolesSync);
const cardKeys = q => q.roleCard && ['id', 'title', 'avatarKind', 'mission', 'stations', 'supports', 'askFirst', 'activation'].every(k => k in q.roleCard) && typeof q.roleCard.title === 'string' && Array.isArray(q.roleCard.stations) && Array.isArray(q.roleCard.supports) && Array.isArray(q.roleCard.askFirst);
let B = null;   // B1 建好的世界，後面幾段接著用
await attempt('B1', async () => {
  const W = await world('b1-roles', { roles: true, mutate: s => { s.tasks = []; } });
  W.plan({ roles: [{ cards: 4 }] });
  W.rhythm(); B = W;
  const s = W.state(), ps = rolePacks(W);
  ok('B1 概覽已確認、此版未擬過 → 日常工作先擬崗位（Z1；次序：擬崗位在日常工作之前）', W.callTypes()[0] === 'roles' && W.callTypes().includes('rhythm') && W.callTypes().indexOf('roles') < W.callTypes().indexOf('rhythm'), W.callTypes());
  const roleCall = W.calls().find(c => c.type === 'roles');
  ok('B1 擬崗位工作說明有八段，第三段列 ai-roles.md；材料 roles-input.json 由外殼備好', ['一、目標', '二、範圍與排除', '三、必要來源位置', '四、輸入與進度', '五、權限', '六、第一步', '七、交付與驗收', '八、停止及回報條件'].every(h => roleCall.task.includes('## ' + h)) && roleCall.task.includes('ai-roles.md') && fs.existsSync(path.join(W.DATA, 'sandbox', roleCall.sandbox, 'roles-input.json')) && fs.existsSync(path.join(W.DATA, 'sandbox', roleCall.sandbox, 'ai-roles.md')), roleCall.sandbox);
  ok('B1 出一包確認題：最多 3 題、第 4 張留擱置；followAll、rolesSync（Z3）', ps.length === 1 && ps[0].questions.length === 3 && ps[0].followAll === true && ps[0].todoType === 'decision' && (s.rolesSync.pending || []).length === 1 && s.rolesSync.packId === ps[0].id, { n: ps.length, qs: ps[0] && ps[0].questions.length, pending: (s.rolesSync || {}).pending });
  const q = ps[0].questions[0];
  ok('B1 每條角色題都有契約欄位的題層 q.roleCard（id、title、avatarKind、mission、stations、supports、askFirst、activation）', ps[0].questions.every(cardKeys), ps[0].questions.map(x => Object.keys(x.roleCard || {})));
  ok('B1 每題三個選項（由 Zero 承擔／改名／不要這個崗位），建議預選；改名帶 input、題帶 inputHint（Z3）', q.options.map(o => o.text).join('|') === [N.t('role_optAccept'), N.t('role_optRename'), N.t('role_optDecline')].join('|') && q.options[0].rec === true && q.options[1].input === true && !!q.inputHint && q.value === q.options[0].text && ['roleAccept', 'roleRename', 'roleDecline'].join() === q.options.map(o => o.apply.op).join() && q.options.every(o => o.apply.card && o.apply.card.title), q);
  ok('B1 題的 roleCard：稱號、頭像類別、使命、站名、支援、先問、啟用任務（可直接顯示的字串）', q.roleCard && q.roleCard.title === '社區拓展經理' && q.roleCard.avatarKind && q.roleCard.mission && q.roleCard.stations.length === 1 && q.roleCard.stations[0] === '工房簽約' && Array.isArray(q.roleCard.supports) && q.roleCard.askFirst.length > 0 && /問題清單/.test(q.roleCard.activation), q.roleCard);
  ok('B1 確認題的題目是任務一句，不重複使命句（崗位卡已顯示使命）', ps[0].questions.every(x => x.ask === '這個崗位由 Zero 承擔？' && !x.ask.includes(x.roleCard.mission)), ps[0].questions.map(x => x.ask));
  ok('B1 畫面文字零內部術語、零編號', !styleHits(shownOf(ps[0])).length, styleHits(shownOf(ps[0])));
  ok('B1 狀態：for、at、unassigned（餘下站由統籌承擔）、stationsAt；確認前不寫 teammates（Z2）', s.rolesSync.for === R.rolesKey(s) && s.rolesSync.unassigned.length === 1 && s.rolesSync.unassigned[0].milestoneId === 'm5' && s.rolesSync.stationsAt.length === 5 && !(s.teammates || []).length, s.rolesSync);
  W.rhythm();
  ok('B1 重複觸發：已有未答的題 → 不再擬、不開第二包（Z1）', rolePacks(W).length === 1 && W.callTypes().filter(t => t === 'roles').length === 1, W.callTypes());
});
await attempt('B2', async () => {
  const bad = { summary: 'x', cards: [{ title: '採購伙伴', mission: '採購。', milestoneIds: ['m1'], how: ['做'], strategy: '好', deliverables: ['list'], knowledge: [], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '做', deliverable: '一份', milestoneId: 'm1' } }], unassigned: [] };
  const W = await world('b2-repair', { roles: true });
  W.plan({ roles: [{ roles: bad }], 'roles-repair': [{ cards: 2 }] });
  W.rhythm();
  ok('B2 核對不合格（稱號用了「伙伴」）→ 退回修正一次，修正後收卡（Z2）', W.callTypes().slice(0, 2).join() === 'roles,roles-repair' && (W.state().rolesSync.pending || []).length + (rolePacks(W)[0] ? rolePacks(W)[0].questions.length : 0) === 2, { calls: W.callTypes(), rs: W.state().rolesSync });
  const rep = W.calls().find(c => c.type === 'roles-repair');
  ok('B2 修正說明列出問題原因', /伙伴/.test(rep.task), rep.task.slice(0, 200));
  ok('B2 修正說明同樣有八段，並以正式書面語列出修正要求', ['一、目標', '二、範圍與排除', '三、必要來源位置', '四、輸入與進度', '五、權限', '六、第一步', '七、交付與驗收', '八、停止及回報條件'].every(h => rep.task.includes('## ' + h)) && !/嘅|啱|唔|喺|嚟/.test(rep.task.replace(/^> 本次[^\n]*\n/gm, '').split('## 寫給創辦人看的文字')[0]), rep.task.slice(0, 500));
  const W2 = await world('b2b-nofix', { roles: true });
  W2.plan({ roles: [{ raw: 'not json' }], 'roles-repair': [{ raw: 'still not json' }] });
  W2.rhythm();
  ok('B2 修正後仍不可解析 → 失敗：記 lastTry、不出題、清 requested（Z1 失敗）', !rolePacks(W2).length && W2.state().rolesSync.lastTry && W2.state().rolesSync.lastTry.day === TODAY && !W2.state().rolesSync.requested, W2.state().rolesSync);
});
await attempt('B3', async () => {
  const W = await world('b3-fail', { roles: true, mutate: s => { s.tasks = msTasks(1); setRhythm(s, { pace: 'fast' }); } });
  W.plan({ roles: [{ fail: true }] });
  W.rhythm(); const n1 = W.callTypes().filter(t => t === 'roles').length;
  W.rhythm();
  ok('B3 擬崗位失敗（AI 工具失敗）：當日不再自動重試、日常工作照做', n1 === 1 && W.callTypes().filter(t => t === 'roles').length === 1 && W.callTypes().includes('rhythm') && W.state().rolesSync.lastTry.day === TODAY, W.callTypes());
  W.ops([{ op: 'rolesSync', target: 'roles', value: {} }]);
  W.plan({ roles: [{ cards: 2 }] }); W.rhythm();
  ok('B3 創辦人按「請 Zero 重新擬崗位」（rolesSync op）→ 即使當日失敗過也再試一次（manual）', W.callTypes().filter(t => t === 'roles').length === 2 && rolePacks(W).length === 1, W.callTypes());
});
await attempt('B4', async () => {
  const W = B; if (!W) throw new Error('B1 未建世界');
  const P1 = rolePacks(W)[0], renameText = N.t('role_optRename');
  W.answer(P1, q => q.id === 'q1' ? q.options[0].text : q.id === 'q2' ? '農場採購主任' : N.t('role_optDecline'));
  const s = W.state(), id1 = R.nextCardId(P1.id, 'q1'), id2 = R.nextCardId(P1.id, 'q2');
  const c1 = (s.teammates || []).find(t => t.id === id1), c2 = (s.teammates || []).find(t => t.id === id2);
  ok('B4 「由 Zero 承擔」：寫入待啟用卡（lifecycle planned、title＋name 鏡射、avatarKind、bounds 併入預設）＋啟用任務（Z4）', c1 && c1.lifecycle === 'planned' && c1.title === '社區拓展經理' && c1.name === c1.title && c1.avatarKind && c1.bounds.askFirst.length >= R.PERMISSIONS_DEFAULT.askFirst.length && c1.activationTaskId === 'act-' + id1, c1);
  const tk = (s.tasks || []).find(t => t.id === 'act-' + id1);
  ok('B4 啟用任務：cadence activation、屬該崗位、needsAcceptance、站正確', tk && tk.cadence === 'activation' && tk.teammateId === id1 && tk.needsAcceptance === true && tk.milestoneId === 'm1' && tk.owner === 'ai', tk);
  ok('B4 「改名」（輸入自訂稱號）：以新名寫卡（Z5）', c2 && c2.title === '農場採購主任' && c2.name === '農場採購主任', c2);
  ok('B4 「不要這個崗位」：不寫卡；declined 記稱號及站（Z6）', (s.teammates || []).length === 2 && s.rolesSync.declined['title:' + P.norm('牌照保險主任')] === 1 && s.rolesSync.declined['station:m3'] >= 1, s.rolesSync.declined);
  const next = rolePacks(W).filter(p => p.id !== P1.id);
  ok('B4 答齊後仍有擱置卡 → 放下一包（batch，不開 AI）（Z3）', next.length === 1 && next[0].questions.length === 1 && W.callTypes().filter(t => t === 'roles').length === 1 && (s.rolesSync.pending || []).length === 0, { n: next.length, calls: W.callTypes() });
  const nT = (s.teammates || []).length; W.rhythm();
  ok('B4 冪等：再開工不重複加卡', (W.state().teammates || []).length === nT && W.state().tasks.filter(t => t.id === 'act-' + id1).length === 1);
  const evs = s.events.map(e => e.title);
  ok('B4 事件記「已確認崗位」', evs.some(t => t === N.t('roleAccepted', { t: '社區拓展經理' }) || t.includes('社區拓展經理')), evs.slice(-4));
  B.card1 = id1; B.card2 = id2;
});
await attempt('B5', async () => {
  const W = await world('b5-renamebad', { roles: true });
  W.plan({ roles: [{ cards: 1 }] }); W.rhythm();
  const P1 = rolePacks(W)[0];
  W.answer(P1, q => 'Zero經理');
  const s = W.state(), c = (s.teammates || [])[0];
  ok('B5 改名不合規（含 Zero）→ 以 Zero 的名寫卡，回饋「名稱未能採用」（Z5）', c && c.title === '社區拓展經理' && Object.keys(s.rolesSync.renameRejected || {}).length === 1 && W.packs().length >= 1 && s.events.some(e => e.title.startsWith(N.t('role_renameRejected', { why: '' }).slice(0, 5))), { c: c && c.title, rr: s.rolesSync.renameRejected });
  const W2 = await world('b5b-renameempty', { roles: true });
  W2.plan({ roles: [{ cards: 1 }] }); W2.rhythm();
  W2.answer(rolePacks(W2)[0], q => N.t('role_optRename'));
  ok('B5 只選「改名」沒有填 → 當空，退回 Zero 的名並提示（Z5）', (W2.state().teammates || [])[0] && W2.state().teammates[0].title === '社區拓展經理' && Object.keys(W2.state().rolesSync.renameRejected || {}).length === 1, W2.state().rolesSync);
});
await attempt('B6', async () => {
  const W = await world('b6-activation', { roles: true, mutate: s => { s.tasks = []; setRhythm(s, { pace: 'fast' }); } });
  W.plan({ roles: [{ cards: 2 }] }); W.rhythm();
  const P1 = rolePacks(W)[0];
  W.answer(P1, q => q.options[0].text);
  const id1 = R.nextCardId(P1.id, 'q1'), id2 = R.nextCardId(P1.id, 'q2');
  W.rhythm();
  const rc = W.calls().filter(c => c.type === 'rhythm');
  ok('B6 待啟用卡的啟用任務由該崗位做（派工 teammateId）；工作說明寫明崗位稱號（Z23、Z24）', rc.some(c => c.teammateId === id1 && c.taskId === 'act-' + id1 && /社區拓展經理/.test(c.task) && /準備工房簽約的問題清單/.test(c.task)), rc.map(c => [c.teammateId, c.taskId]));
  let s = W.state();
  const accOf = id => W.packOf(p => p.acceptance && p.acceptance.teammateId === id)[0];
  const acc = accOf(id1);
  ok('B6 啟用任務交付 → 驗收題「接受即啟用〈崗位〉」：pack.acceptance 帶崗位及產出；選項 接受／退回重做／接受但改方向（Z7、Z54）', acc && acc.acceptance.activation === true && acc.acceptance.roleTitle === '社區拓展經理' && acc.acceptance.artifact && acc.acceptance.artifact.text && acc.todoType === 'acceptance' && acc.title === N.t('role_activationAsk', { t: '「社區拓展經理」' }) && acc.questions[0].options.map(o => o.text).join('|') === ['接受', N.t('role_optReturn'), N.t('role_optAcceptRedirect')].join('|'), acc && [acc.title, acc.acceptance]);
  ok('B6 交付後卡仍待啟用；工作待驗收（done＋needsAcceptance）；沒有開校對（內部類型）', s.teammates.find(t => t.id === id1).lifecycle === 'planned' && s.tasks.find(t => t.id === 'act-' + id1).status === 'done' && s.tasks.find(t => t.id === 'act-' + id1).needsAcceptance === true && !W.callTypes().includes('proofread'), s.tasks.find(t => t.id === 'act-' + id1));
  const it1 = itemsOf(W.lastRun()).find(i => i.teammateId === id1);
  const rcpt = jr(path.join(W.DATA, 'work', it1.workId, 'receipt.json'));
  ok('B6 收據帶 teammateId、taskId 及 qa（內部：none）；runs 帶 taskIds（資料約定第 3 節）', rcpt.teammateId === id1 && rcpt.taskId === 'act-' + id1 && rcpt.qa.audience === 'internal' && rcpt.qa.verdict === 'none' && W.lastRun().taskIds.includes('act-' + id1), { rcpt, ids: W.lastRun().taskIds });
  W.answer(acc, q => q.id === 'accept' ? '接受' : undefined);
  s = W.state(); const c1 = s.teammates.find(t => t.id === id1);
  ok('B6 驗收「接受」→ 已啟用、activation 記錄、bounds 鎖定、工作 acceptedBy founder（Z8、Z55）', c1.lifecycle === 'enabled' && c1.activation && c1.activation.taskId === 'act-' + id1 && c1.bounds.lockedAt && s.tasks.find(t => t.id === 'act-' + id1).acceptedBy === 'founder' && !W.openPacks().some(p => p.id === acc.id), c1);
  const acc2 = accOf(id2);
  if (acc2) W.answer(acc2, q => q.id === 'accept' ? N.t('role_optAcceptRedirect') : undefined);
  s = W.state();
  ok('B6 「接受，但我想改方向」同樣啟用，另記事件（Z8）', acc2 && s.teammates.find(t => t.id === id2).lifecycle === 'enabled' && s.teammates.find(t => t.id === id2).redirectAsked && s.events.some(e => e.title === N.t('roleRedirect', { t: '原料採購專員' })), { acc2: !!acc2, ev: s.events.slice(-3).map(e => e.title) });
});
await attempt('B7', async () => {
  const W = await world('b7-return', { roles: true, mutate: s => { s.tasks = []; setRhythm(s, { pace: 'fast' }); } });
  W.plan({ roles: [{ cards: 1 }] }); W.rhythm();
  const P1 = rolePacks(W)[0]; W.answer(P1, q => q.options[0].text);
  const id = R.nextCardId(P1.id, 'q1'), aid = 'act-' + id;
  W.rhythm();
  let acc = W.packOf(p => p.acceptance)[0];
  W.answer(acc, q => q.id === 'accept' ? N.t('role_optReturn') : q.id === 'reason' ? '請加上價錢範圍' : undefined);
  let s = W.state();
  ok('B7 退回重做：工作重開（active）、activationReturns +1、保留退回原因、卡仍待啟用（Z9）', s.tasks.find(t => t.id === aid).status === 'active' && s.teammates[0].activationReturns === 1 && s.teammates[0].lifecycle === 'planned' && /價錢範圍/.test(s.tasks.find(t => t.id === aid).returnNote), { t: s.tasks.find(t => t.id === aid), c: s.teammates[0].activationReturns });
  // 翌日：把今日那一件算作昨日，才可再派
  s = W.state(); s.runs.forEach(r => { r.workDay = ymd(-1); r.items = (r.items || []).map(i => i); }); W.put(s);
  W.rhythm();
  const lastCall = W.calls().filter(c => c.type === 'rhythm').pop();
  ok('B7 重做的說明附上退回原因（第四段「上次校對發回的問題」位置，逐條改正）', /請加上價錢範圍/.test(lastCall.task), lastCall.task.slice(0, 200));
  acc = W.packOf(p => p.acceptance).pop();
  W.answer(acc, q => q.id === 'accept' ? N.t('role_optReturn') : undefined);
  s = W.state(); const rp = rolePacks(W).filter(p => p.rolesSync.kind === 'recard');
  ok('B7 退回達 2 次 → 出「改卡或取消」題；工作不再自動重開（waiting）（Z10）', s.teammates[0].activationReturns === 2 && rp.length === 1 && rp[0].questions[0].ask === N.t('role_returnTwice') && rp[0].questions[0].options.map(o => o.text).join('|') === [N.t('role_optRecard'), N.t('role_optCancel')].join('|') && s.tasks.find(t => t.id === aid).status === 'waiting', { c: s.teammates[0].activationReturns, rp: rp.length });
  // 重擬
  W.answer(rp[0], q => N.t('role_optRecard'));
  ok('B7 「改卡或取消」題也有 q.roleCard', cardKeys(rp[0].questions[0]), rp[0].questions[0].roleCard);
  ok('B7 答「改崗位卡」→ 記 recard、要求重擬', W.state().rolesSync.recard && W.state().rolesSync.recard[0] === id, W.state().rolesSync);
  W.plan({ roles: [{ cards: 1 }] }); W.rhythm();
  s = W.state();
  ok('B7 重擬：Zero 以 recard 模式重擬、經核對換卡、退回次數歸零、舊啟用任務取消、新啟用任務（Z10）', W.calls().some(c => c.type === 'roles' && c.mode === 'recard') && s.teammates[0].activationReturns === 0 && s.tasks.find(t => t.id === aid).status === 'cancelled' && s.teammates[0].activationTaskId !== aid && s.tasks.some(t => t.id === s.teammates[0].activationTaskId && ['planned', 'done'].includes(t.status)), { calls: W.calls().map(c => c.type + ':' + c.mode), c: s.teammates[0] });
  // 取消
  const W2 = await world('b7b-cancel', { roles: true, mutate: s => { s.tasks = []; setRhythm(s, { pace: 'fast' }); } });
  W2.plan({ roles: [{ cards: 1 }] }); W2.rhythm();
  const Q1 = rolePacks(W2)[0]; W2.answer(Q1, q => q.options[0].text);
  const id2 = R.nextCardId(Q1.id, 'q1'), a2 = 'act-' + id2;
  let st = W2.state(); st.teammates[0].activationReturns = 2; st.tasks.find(t => t.id === a2).status = 'waiting'; W2.put(st);
  const rpk = placeRecard(W2, id2);
  W2.answer(rpk, q => N.t('role_optCancel'));
  st = W2.state();
  ok('B7 答「取消這個崗位」：retired＋原因、啟用任務取消、其站回統籌、不佔軟上限（Z10）', st.teammates[0].lifecycle === 'retired' && st.teammates[0].retiredReason && st.tasks.find(t => t.id === a2).status === 'cancelled' && R.countedCards(st).length === 0, st.teammates[0]);
});
function placeRecard(W, id) {   // 測試捷徑：外殼在第二次退回時放的題，這裏直接用同一個函數形狀造一包
  const s = W.state(), card = s.teammates.find(t => t.id === id);
  const yes = { text: N.t('role_optRecard'), rec: true, apply: { op: 'roleRecard', teammateId: id } }, no = { text: N.t('role_optCancel'), apply: { op: 'roleCancel', teammateId: id } };
  const pack = { format: 'startup-os.ask/0.1', id: 'ask-test-recard', title: N.t('role_confirmTitle'), context: 'x', afterConfirm: 'x', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: null, todoType: 'decision', rolesSync: { key: s.rolesSync.for, kind: 'recard', teammateId: id }, questions: [{ id: 'q1', priority: 1, ask: N.t('role_returnTwice'), kind: 'choice', effect: 'now', options: [yes, no], value: yes.text, why: 'x', roleCard: { title: card.title } }] };
  fs.writeFileSync(path.join(W.DIR.asks, pack.id + '.json'), JSON.stringify(pack)); return pack;
}
await attempt('B8', async () => {
  const W = await world('b8-pause', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = [aiTask('t1', '農場簽約準備', { teammateId: 'tm-x' }), aiTask('t2', '另一件', { teammateId: 'tm-x' })]; } });
  W.ops([{ op: 'rolePause', target: 'tm-x', value: { reason: '先放一放' } }]); W.rhythm();
  let s = W.state();
  ok('B8 創辦人暫停崗位：lifecycle paused、pausedReason、其未完成工作改由統籌（teammateId 清空）（Z11）', s.teammates[0].lifecycle === 'paused' && s.teammates[0].pausedReason === '先放一放' && s.events.some(e => e.type === 'founder-op' && e.title === N.t('founderRolePaused', { t: '社區拓展經理' })), s.teammates[0]);
  const call = W.calls().find(c => c.type === 'rhythm');
  ok('B8 暫停期間該站工作由統籌做（派工 teammateId 空）', call && call.teammateId === '', call);
  W.ops([{ op: 'roleResume', target: 'tm-x', value: {} }]); W.rhythm(); s = W.state();
  ok('B8 恢復：回到暫停前的狀態（enabled）、刪原因（Z12）', s.teammates[0].lifecycle === 'enabled' && !s.teammates[0].pausedReason, s.teammates[0]);
});
await attempt('B9', async () => {
  const W = await world('b9-auto', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = msTasks(3); setRhythm(s, { pace: 'fast' }); } });
  W.plan({ rhythm: [{ blocked: true, blockedOn: '等農場甲回覆' }, { blocked: true, blockedOn: '等農場甲回覆' }] });
  W.rhythm(); const s = W.state(), run = W.lastRun();
  ok('B9 派工：已啟用的崗位負責其站的工作（Z23）', W.calls().filter(c => c.type === 'rhythm').slice(0, 2).every(c => c.teammateId === 'tm-x') && itemsOf(run)[0].teammateId === 'tm-x', itemsOf(run));
  ok('B9 同一崗位當日連續兩件卡住 → pausedAuto、pausedOn、pausedReason「等候：…」；lifecycle 不變（Z13）', s.teammates[0].pausedAuto === true && s.teammates[0].pausedOn === TODAY && /^等候：等農場甲回覆/.test(s.teammates[0].pausedReason) && s.teammates[0].lifecycle === 'enabled', s.teammates[0]);
  ok('B9 自動暫停後第三件改派統籌', itemsOf(run).length === 3 && itemsOf(run)[2].teammateId === '', itemsOf(run).map(i => i.teammateId));
});
await attempt('B10', async () => {
  let W = await world('b10-planned', { mutate: s => { s.teammates = [mkCard({ id: 'tm-p', lifecycle: 'planned', activation: undefined, activationTaskId: 'act-p' })]; s.tasks = [aiTask('t1', '一般工作', { milestoneId: 'm1' })]; } });
  W.rhythm();
  ok('B10 待啟用的崗位：非啟用任務改派統籌（J8、Z23）', W.calls().find(c => c.type === 'rhythm').teammateId === '', W.calls().filter(c => c.type === 'rhythm').map(c => c.teammateId));
  W = await world('b10-brief', { mutate: s => { s.teammates = [mkCard({ id: 'tm-b', title: '照舊推廣專員', name: '照舊推廣專員' })]; s.tasks = msTasks(3, 'm1'); setRhythm(s, { pace: 'fast' }); } });
  W.rhythm();
  const rc = W.calls().filter(c => c.type === 'rhythm');
  ok('B10 工作說明核對不合格（崗位名稱含禁用字眼「照舊」，崗位名稱不包引號）→ 改用通用說明，不出八段（Z25、Z26）', rc.length >= 1 && !/## 一、目標/.test(rc[0].task) && /做外殼交給你的這一件日常工作/.test(rc[0].task), rc[0] && rc[0].task.slice(0, 100));
  ok('B10 多件日連續兩件說明不合格 → 停當日（briefFailed）（Z26）', itemsOf(W.lastRun()).length === 2 && W.lastRun().stopReason === 'briefFailed', { n: itemsOf(W.lastRun()).length, stop: W.lastRun().stopReason });
});

/* =====================================================================
   C　統籌校對鏈
===================================================================== */
const MSG = { title: '給農場甲的訊息', type: 'message', audience: 'external', text: '草稿，未發送\n\n陳經理您好，想約你下星期見面談供應。\n\n依據：公司概覽\n' };
const cWorld = async (name, extra = {}) => world(name, { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = [aiTask('t1', '給農場甲的跟進訊息', { teammateId: 'tm-x' })]; if (extra.fast) setRhythm(s, { pace: 'fast' }); } });
const qaOf = W => jr(path.join(W.DATA, 'work', itemsOf(W.lastRun())[0].workId, 'receipt.json')).qa;
await attempt('C1', async () => {
  const W = await cWorld('c1-pass');
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ verdict: 'pass' }] });
  W.rhythm(); const qa = qaOf(W), s = W.state();
  ok('C1 對外產出（訊息草稿）→ 統籌校對一次（Z27）', W.callTypes().join() === 'rhythm,proofread', W.callTypes());
  ok('C1 校對 pass：收據 qa { external, pass, rounds 1, line }（Z29）；runs[].items 帶 qa', qa.audience === 'external' && qa.verdict === 'pass' && qa.rounds === 1 && qa.line === '核對無誤。' && itemsOf(W.lastRun())[0].qa.verdict === 'pass', qa);
  const pf = W.calls().find(c => c.type === 'proofread');
  ok('C1 校對說明：校對 AI 只讀、不可上網，八段齊，列出 ai-proofread.md、要校對的稿及來源', /## 八、停止及回報條件/.test(pf.task) && /draft-1\.md/.test(pf.task) && /ai-proofread\.md/.test(pf.task) && fs.existsSync(path.join(W.DATA, 'sandbox', pf.sandbox, 'ai-proofread.md')) && /不可上網/.test(pf.task), pf.task.slice(0, 300));
  const acc = W.packOf(p => p.acceptance)[0];
  ok('C1 對外產出出驗收題：pack.acceptance 帶全文、校對結果、崗位；非啟用任務（Z54）', acc && acc.acceptance.teammateId === 'tm-x' && acc.acceptance.activation === false && acc.acceptance.qaVerdict === 'pass' && /陳經理您好/.test(acc.acceptance.artifact.text) && s.tasks.find(t => t.id === 't1').needsAcceptance === true && PACE.unreadCount(W.openPacks()) === 1, acc && acc.acceptance);
  ok('C1 啟動計數：校對計入保險絲並分開顯示（Z36、Z56）', (c => c.work === 1 && c.proofread === 1 && PACE.usageView(s, c).proofread === 1)(PACE.countStarts(W.starts(), TODAY, { runIds: [W.lastRun().id] })), W.starts());
  // Z55 接受
  W.answer(acc, q => q.id === 'accept' ? '接受' : undefined);
  ok('C1 驗收「接受」：工作 acceptedBy founder，未看數下降（Z55）', W.state().tasks.find(t => t.id === 't1').acceptedBy === 'founder' && PACE.unreadCount(W.openPacks()) === 0, W.state().tasks.find(t => t.id === 't1'));
});
await attempt('C2', async () => {
  const W = await cWorld('c2-rewrite');
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ verdict: 'return' }, { verdict: 'pass' }] });
  W.rhythm(); const qa = qaOf(W);
  ok('C2 第一次發回 → 同一崗位重寫一次（qa-rewrite）→ 第二次校對（Z30）', W.callTypes().join() === 'rhythm,proofread,qa-rewrite,proofread', W.callTypes());
  ok('C2 第二次通過：verdict pass、rounds 2；重寫後的稿才交創辦人', qa.verdict === 'pass' && qa.rounds === 2 && /已按校對意見改正/.test(W.packOf(p => p.acceptance)[0].acceptance.artifact.text), qa);
  const calls = W.calls();
  ok('C2 重寫說明附問題清單；第二次校對說明附上次問題', /價錢沒有來源/.test(calls[2].task) && /價錢沒有來源/.test(calls[3].task), [calls[2].task.slice(-200)]);
  const c = PACE.countStarts(W.starts(), TODAY, { runIds: [W.lastRun().id] });
  ok('C2 其中校對 = 校對 2 + 重寫 1（qa-rewrite 計入校對）；用字改寫不算', c.proofread === 2 && c.qaRewrite === 1 && PACE.proofreadStarts(c) === 3 && c.total === 4, c);
});
await attempt('C3', async () => {
  const W = await cWorld('c3-flag');
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ verdict: 'return' }, { verdict: 'return' }] });
  W.rhythm(); const qa = qaOf(W), acc = W.packOf(p => p.acceptance)[0];
  ok('C3 第二次仍發回：不開第三次校對、不再重寫，照交並標 flagged（Z31）', W.callTypes().join() === 'rhythm,proofread,qa-rewrite,proofread' && qa.verdict === 'flagged' && qa.rounds === 2 && qa.issues.length >= 1, { calls: W.callTypes(), qa });
  ok('C3 驗收題帶 issueCount（仍有 N 處要留意）', acc && acc.acceptance.qaVerdict === 'flagged' && acc.acceptance.issueCount === qa.issues.length, acc && acc.acceptance);
});
await attempt('C4', async () => {
  const W = await cWorld('c4-unreadable');
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ raw: 'not json' }, { verdict: 'pass' }] });
  W.rhythm();
  ok('C4 校對結果不可解析 → 當發回處理（有問題清單供重寫），第二次通過（Z32）', W.callTypes().join() === 'rhythm,proofread,qa-rewrite,proofread' && qaOf(W).verdict === 'pass', { calls: W.callTypes(), qa: qaOf(W) });
});
await attempt('C5', async () => {
  const W = await cWorld('c5-internal');
  W.plan({ rhythm: [{ artifacts: [{ title: '見農場甲前的問題清單', type: 'research', audience: 'internal', text: '# 見農場甲前的問題清單\n\n1. 每週可供貨量？\n\n依據：公司概覽\n' }] }] });
  W.rhythm(); const qa = qaOf(W);
  ok('C5 內部產出：不開校對、qa { internal, none }、不出驗收題、未看數不計（Z28、Z54）', W.callTypes().join() === 'rhythm' && qa.audience === 'internal' && qa.verdict === 'none' && !W.packOf(p => p.acceptance).length && W.state().tasks.find(t => t.id === 't1').needsAcceptance !== true, { calls: W.callTypes(), qa });
});
await attempt('C6', async () => {
  let W = await cWorld('c6-content');
  W.plan({ rhythm: [{ artifacts: [{ title: '試食安排', type: 'plan', audience: 'internal', text: '# 試食安排\n\n致餐廳乙黃小姐：試食安排如下。\n\n依據：公司概覽\n' }] }], proofread: [{ verdict: 'pass' }] });
  W.rhythm();
  ok('C6 內容像給對象的稱呼（致…）→ 即使自報內部、類型是計劃，也當對外校對（取較嚴）（Z27）', W.callTypes().join() === 'rhythm,proofread' && qaOf(W).audience === 'external', W.callTypes());
  W = await cWorld('c6b-selfreport');
  W.plan({ rhythm: [{ artifacts: [{ title: '核對清單', type: 'checklist', audience: 'external', text: '# 核對清單\n\n1. 項目\n\n依據：公司概覽\n' }] }], proofread: [{ verdict: 'pass_with_notes' }] });
  W.rhythm();
  ok('C6 Zero 自報對外 → 對外；pass_with_notes 照交（Z27、Z29）', W.callTypes().join() === 'rhythm,proofread' && qaOf(W).verdict === 'pass_with_notes', qaOf(W));
});
await attempt('C8', async () => {
  const W = await cWorld('c8-pffail');
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ fail: true }] });
  W.rhythm(); const qa = qaOf(W), acc = W.packOf(p => p.acceptance)[0];
  ok('C8 校對沒有做成（工具失敗）：不留 pending——照交並標 flagged，只有一項「統籌校對未能完成」；仍出驗收題（Z54）', W.callTypes().join() === 'rhythm,proofread' && qa.verdict === 'flagged' && qa.line === N.t('qa_unfinished') && qa.issues.length === 1 && qa.issues[0].what === N.t('qa_unfinishedWhat') && !!acc && acc.acceptance.qaVerdict === 'flagged' && acc.acceptance.issueCount === 1 && acc.acceptance.qaLine === N.t('qa_unfinished'), { calls: W.callTypes(), qa });
  ok('C8 收據及 runs 都沒有 pending', !JSON.stringify(W.state().runs).includes('"pending"') && qaOf(W).verdict !== 'pending');
  const W2 = await world('c8b-streak', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = [1, 2, 3].map(i => aiTask('t' + i, '給農場的訊息' + i, { teammateId: 'tm-x' })); setRhythm(s, SPRINT); } });
  W2.plan({ rhythm: [{ artifacts: [MSG] }, { artifacts: [{ ...MSG, title: '給農場乙的訊息', text: MSG.text + '乙' }] }, { artifacts: [{ ...MSG, title: '給農場丙的訊息', text: MSG.text + '丙' }] }], proofread: [{ fail: true }, { fail: true }] });
  W2.rhythm();
  ok('C8 校對連續兩次工具失敗計入連續失敗 → 停當日 toolFailed，不開第三件（Z44）', itemsOf(W2.lastRun()).length === 2 && W2.lastRun().stopReason === 'toolFailed' && itemsOf(W2.lastRun()).every(i => i.qa.verdict === 'flagged'), { n: itemsOf(W2.lastRun()).length, stop: W2.lastRun().stopReason });
});
await attempt('C11', async () => {
  const W = await cWorld('c11-return', { fast: true });
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ verdict: 'pass' }] });
  W.rhythm();
  const acc = W.packOf(p => p.acceptance)[0];
  ok('C11 前提：驗收題 pack 層帶 workId；兩條題都有題層 q.acceptance（契約欄位）', acc && acc.acceptance.workId && acc.questions.every(q => q.acceptance && ['taskId', 'teammateId', 'roleTitle', 'avatarKind', 'artifactTitle', 'artifactFile', 'qaVerdict', 'qaLine', 'activation'].every(k => k in q.acceptance)) && acc.questions[0].acceptance.qaLine === '核對無誤。' && acc.questions[0].acceptance.qaVerdict === 'pass' && acc.questions[0].acceptance.roleTitle === '社區拓展經理' && acc.questions[0].acceptance.artifactFile === '01-x.md', acc && acc.questions[0].acceptance);
  W.answer(acc, q => q.id === 'accept' ? N.t('role_optReturn') : q.id === 'reason' ? '價錢要寫清楚每公斤多少' : undefined);
  let s = W.state(); const t1 = s.tasks.find(t => t.id === 't1');
  ok('C11 非啟用任務退回：不走通用 ask-continue；工作重開（active）、記退回原因及上一版工作資料夾；不開 AI（自足重派）', !W.callTypes().includes('ask-continue') && t1.status === 'active' && t1.needsAcceptance === false && /每公斤/.test(t1.returnNote) && t1.lastWorkId && W.callTypes().join() === 'rhythm,proofread', { t1, calls: W.callTypes() });
  const nrun = W.callTypes().length;
  W.plan({ rhythm: [{ artifacts: [{ ...MSG, text: MSG.text + '（價錢：每公斤 38 元）' }] }], proofread: [{ verdict: 'pass' }] });
  W.rhythm();
  const redo = W.calls().filter(c => c.type === 'rhythm')[1];
  ok('C11 下一件日常工作由 dailyLoop 用八段說明派回同一件：第四段寫明退回原因，上一版放進資料夾並列在第三段', redo && redo.taskId === 't1' && /## 四、輸入與進度/.test(redo.task) && /創辦人退回了上一版，原因：價錢要寫清楚每公斤多少/.test(redo.task) && /previous-1.md/.test(redo.task) && fs.existsSync(path.join(W.DATA, 'sandbox', redo.sandbox, 'previous-1.md')) && /## 八、停止及回報條件/.test(redo.task), redo && redo.task.slice(0, 200));
  ok('C11 重做交付後清除退回原因、再出驗收題', W.state().tasks.find(t => t.id === 't1').returnNote === undefined && W.packOf(p => p.acceptance).length === 2, W.state().tasks.find(t => t.id === 't1'));
});
await attempt('C10', async () => {
  const W = await world('c10-coordinator', { mutate: s => { s.tasks = msTasks(1, 'm5'); } });
  W.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ verdict: 'pass' }] });
  W.rhythm();
  const rc = jr(path.join(W.DATA, 'work', itemsOf(W.lastRun())[0].workId, 'receipt.json'));
  ok('C10 統籌自己做的對外產出同樣校對；收據沒有 teammateId（顯示「Zero」）', W.callTypes().join() === 'rhythm,proofread' && rc.teammateId === undefined && rc.qa.verdict === 'pass', rc);
});

/* =====================================================================
   D　中途加站及加崗位、合併、路線改變、主動建議
===================================================================== */
const stationRole = (over = {}) => ({ summary: '測試', unassigned: [], cards: [{ title: '物流配送專員', mission: '安排送貨。', milestoneIds: [], supports: [], targets: [], how: ['排送貨路線'], strategy: '送貨要準時。', sources: [], deliverables: ['plan'], knowledge: [{ text: '送貨安排見公司概覽。', source: 'confirmedPage' }], bounds: { tellAfter: [], askFirst: [] },
  station: { short: '送貨安排', event: '每週固定時間送貨給三間餐廳。', witness: '餐廳負責人', evidence: '簽收紀錄', deliveryCondition: '連續兩次準時送達', ...(over.station || {}) }, activation: { title: '送貨路線安排表', deliverable: '一份送貨路線與時間表。', milestoneId: '' } }] });
await attempt('D1', async () => {
  const W = await world('d1-addstation', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = []; } });
  // 創辦人用「想改計劃」提出加崗位 → handleNote 記下要求（wantsRole）
  ok('D1 wantsRole：「加一個崗位負責送貨」「多一個人負責物流」認得；一般句子不認得', R.wantsRole('我想加一個崗位負責送貨') && R.wantsRole('多一個人負責物流') && !R.wantsRole('請改一下見面日期'));
  fs.mkdirSync(W.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.inbox, 'R20261108-100000-1-note-order.md'), 'kind: note\nref: R20261108-100000-1\n\n我想加一個崗位負責送貨\n');
  W.shell();
  let s = W.state();
  ok('D1 「想改計劃」提到加崗位：記 rolesSync.wantRole、要求重擬（Z14）', s.rolesSync.wantRole && s.rolesSync.wantRole.kind === 'add' && /送貨/.test(s.rolesSync.wantRole.text) && s.rolesSync.requested === true, s.rolesSync);
  W.plan({ roles: [{ roles: stationRole() }] });
  W.rhythm(); s = W.state();
  const pk = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'addRole')[0];
  ok('D1 路線沒有對應站 → 同包兩題：加站＋加崗位；加站選項的 apply 是 { order, add }（Z14）', pk && pk.questions.length === 2 && W.calls().some(c => c.type === 'roles' && c.mode === 'add') && pk.questions[0].options[0].apply.order.slice(-1)[0] === 'new' && pk.questions[0].options[0].apply.add.witness === '餐廳負責人' && pk.questions[0].options[0].apply.add.short === '送貨安排' && pk.questions[1].options[0].apply.op === 'roleAccept', pk && pk.questions.map(q => q.ask));
  ok('D1 加站題、加崗位題都有題層 q.roleCard', pk && pk.questions.every(cardKeys), pk && pk.questions.map(x => x.roleCard));
  ok('D1 加站題 ask 用「加一站「…」？」；加崗位題 ask 用「加崗位「…」？」', pk && pk.questions[0].ask === N.t('role_addStationAsk', { s: '送貨安排' }) && pk.questions[1].ask === N.t('role_addRoleAsk', { t: '物流配送專員' }), pk && pk.questions.map(q => q.ask));
  ok('D1 確認前路線不變（5 站）、不寫卡', s.milestones.filter(m => m.pathStatus === 'confirmed').length === 5 && s.teammates.length === 1);
  const pageBefore = jr(path.join(W.DATA, 'company', 'page.json'));
  W.answer(pk, q => q.options[0].text);
  s = W.state(); const page = jr(path.join(W.DATA, 'company', 'page.json')), conf = jr(path.join(W.DATA, 'ledger', 'confirmed.json'));
  const nm = page.path.milestones.find(m => m.short === '送貨安排'), lm = s.milestones.find(m => m.short === '送貨安排');
  ok('D1 兩題都確認：先套加站——page.json 新站帶見證、證據、完成條件（真實公司路徑不再丟失）（Z16、9B）', page.path.milestones.length === pageBefore.path.milestones.length + 1 && nm && nm.witness.value === '餐廳負責人' && nm.proof.value === '簽收紀錄' && nm.deliver.value === '連續兩次準時送達' && nm.event.value === '每週固定時間送貨給三間餐廳。', nm);
  ok('D1 confirmed.json values 同步、order 含新站；帳本由 syncLedger 帶出 witness／evidence／deliveryCondition', conf.order.includes(nm.id) && conf.values[nm.id + '-w'] === '餐廳負責人' && conf.values[nm.id + '-d'] === '連續兩次準時送達' && lm && lm.witness === '餐廳負責人' && lm.evidence === '簽收紀錄' && lm.deliveryCondition === '連續兩次準時送達', lm);
  const card = s.teammates.find(t => t.title === '物流配送專員');
  ok('D1 再讀回路線取新站編號，新卡指向該站、附啟用任務（待啟用）（Z16）', card && card.milestoneIds.join() === nm.id && card.lifecycle === 'planned' && s.tasks.some(t => t.id === card.activationTaskId && t.milestoneId === nm.id), card);
  ok('D1 回饋寫出已更新路線；加站事件', s.events.some(e => /送貨安排/.test(e.title)));
});
await attempt('D1b', async () => {
  const W = await world('d1b-route-changed', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = []; s.rolesSync = { for: R.rolesKey(s), requested: true, wantRole: { kind: 'add', text: '加一個崗位負責送貨' } }; } });
  W.plan({ roles: [{ roles: stationRole() }] }); W.rhythm();
  const pk = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'addRole')[0];
  // 模擬出題後路線已變：題包內記下的路線少了一站（與現時路線不一致）
  const pf = path.join(W.DIR.asks, pk.id + '.json'), stale = JSON.parse(fs.readFileSync(pf, 'utf8'));
  for (const q of stale.questions) for (const o of q.options || []) if (o.apply && Array.isArray(o.apply.order)) o.apply.order = o.apply.order.filter(x => x !== 'm1');
  fs.writeFileSync(pf, JSON.stringify(stale, null, 2));
  const routeBefore = W.state().milestones.filter(m => m.pathStatus === 'confirmed').length;
  W.answer(pk, q => q.options[0].text);
  W.rhythm();
  const next = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'addRole' && p.id !== pk.id);
  const s = W.state();
  // 獨立驗收必修 2：重問的題按目前路線重建次序，再答「接受」就能落實，不會反覆退回
  if (next[0]) W.answer(next[0], q => q.options[0].text);
  const s3 = W.state();
  ok('D1b 重問後再答接受：加站及加崗位成功落實，路線多一站，沒有再次退回', !!next[0] && (s3.teammates || []).some(t => t.title === '物流配送專員') && s3.milestones.filter(m => m.pathStatus === 'confirmed').length === routeBefore + 1 && s3.events.filter(e => e.title === N.t('role_routeChangedAskAgain')).length === 1, { teammates: (s3.teammates || []).map(t => t.title), route: s3.milestones.filter(m => m.pathStatus === 'confirmed').length, routeBefore });
  ok('D1b 出題後路線已有變動：崗位卡放回待處理、再出同類確認題，並記錄會再問一次（覆核建議 5）', next.length === 1 && s.events.some(e => e.title === N.t('role_routeChangedAskAgain')) && !(s.teammates || []).some(t => t.title === '物流配送專員'), { next: next.map(p => p.id), pending: (s.rolesSync || {}).pending, events: s.events.slice(-3) });
});
await attempt('D2', async () => {
  const W = await world('d2-stationno', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = []; s.rolesSync = { for: R.rolesKey(s), requested: true, wantRole: { kind: 'add', text: '加一個崗位負責送貨' } }; } });
  W.plan({ roles: [{ roles: stationRole() }] }); W.rhythm();
  const pk = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'addRole')[0];
  W.answer(pk, q => q.id === 'q1' ? q.options[1].text : q.options[0].text);
  const s = W.state();
  ok('D2 加站題否決 → 加崗位題因不加站而不成立，不寫卡，路線不變；不算拒絕崗位本身（Z15）', s.teammates.length === 1 && s.milestones.filter(m => m.pathStatus === 'confirmed').length === 5 && s.rolesSync.voided && !Object.keys(s.rolesSync.declined || {}).some(k => k.startsWith('station:')) && s.events.some(e => e.title === N.t('role_addRoleVoid')), s.rolesSync);
});
await attempt('D3', async () => {
  const W = await world('d3-existing', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x' })]; s.tasks = []; s.rolesSync = { for: R.rolesKey(s), requested: true, wantRole: { kind: 'add', text: '多一個人負責餐廳試單' } }; } });
  W.plan({ roles: [{ roles: { summary: 'x', unassigned: [], cards: [{ title: '餐廳試單主任', mission: '跟進餐廳試單。', milestoneIds: ['m2'], supports: [], targets: ['customer'], how: ['跟進'], strategy: '試單是關鍵。', sources: [], deliverables: ['message'], knowledge: [], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '試單跟進訊息', deliverable: '一份訊息草稿', milestoneId: 'm2' } }] } }] });
  W.rhythm();
  const pk = W.packOf(p => p.rolesSync)[0];
  ok('D3 路線已有對應站（未有崗位）→ 只出加崗位一題，不改路線（Z17）', pk && pk.rolesSync.kind === 'confirm' && pk.questions.length === 1 && !pk.questions[0].options.some(o => o.apply.order), pk && pk.rolesSync);
});
await attempt('D4', async () => {
  const six = Array.from({ length: 6 }, (_, i) => mkCard({ id: 'tm-' + i, title: ['甲拓展專員', '乙採購專員', '丙牌照主任', '丁內容專員', '戊財務專員', '己營運專員'][i], name: ['甲拓展專員', '乙採購專員', '丙牌照主任', '丁內容專員', '戊財務專員', '己營運專員'][i], milestoneIds: ['m' + Math.min(i + 1, 5)], lifecycle: i < 3 ? 'enabled' : 'planned' }));
  const extra = { title: '庚推廣專員', mission: '推廣。', milestoneIds: [], supports: [], targets: [], how: ['做'], strategy: '好', sources: ['confirmedPage'], deliverables: ['plan'], knowledge: [], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '推廣計劃', deliverable: '一份計劃', milestoneId: '' }, avatarKind: 'marketing' };
  const mk = () => world('d4-cap', { mutate: s => { s.teammates = JSON.parse(JSON.stringify(six)); s.tasks = []; s.rolesSync = { for: R.rolesKey(s), pending: [extra] }; } });
  let W = await mk();
  ok('D4 前提：已啟用＋待啟用達 6 張 → overCap', R.overCap(W.state()));
  W.shell();
  const mp = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'merge')[0];
  ok('D4 再有新卡先出「合併」題：「先把「A」併入「B」？」；新卡仍擱置、合併未答前不加（Z19）', mp && mp.questions[0].ask.startsWith('崗位已有六個') && mp.questions[0].options.map(o => o.text).join('|') === [N.t('role_optMergeYes'), N.t('role_optMergeNo')].join('|') && W.state().rolesSync.pending.length === 1 && !W.packOf(p => p.rolesSync && p.rolesSync.kind === 'confirm').length, mp && mp.questions[0].ask);
  ok('D4 合併題有 q.roleCard', cardKeys(mp.questions[0]), mp.questions[0].roleCard);
  W.answer(mp, q => N.t('role_optMergeNo'));
  let s = W.state();
  ok('D4 「不合併，照加」→ 放出新卡確認題；團隊頁可標超過建議數目', s.rolesSync.capOk === true && W.packOf(p => p.rolesSync && p.rolesSync.kind === 'confirm').length === 1, s.rolesSync);
  W = await mk(); W.shell();
  const mp2 = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'merge')[0], ap = mp2.questions[0].options[0].apply;
  W.answer(mp2, q => q.options[0].text); s = W.state();
  const from = s.teammates.find(t => t.id === ap.fromId), into = s.teammates.find(t => t.id === ap.intoId);
  ok('D4 合併確認：被併卡 merged＋mergedInto、其站併入目標卡，目標狀態不變（Z21）', from.lifecycle === 'merged' && from.mergedInto === into.id && from.milestoneIds.every(m => into.milestoneIds.includes(m)) && !R.overCap(s) && s.events.some(e => e.title === N.t('roleMerged', { a: R.titleOf(from), b: R.titleOf(into) })), { from: from.lifecycle, into: into.milestoneIds });
});
await attempt('D5', async () => {
  let W = await world('d5-route', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x', milestoneIds: ['m1'] })]; s.tasks = []; s.rolesSync = { for: R.rolesKey(s), stationsAt: ['m1', 'm2', 'm3', 'm4', 'm5'], unassigned: [{ milestoneId: 'm2', why: 'x' }, { milestoneId: 'm3', why: 'x' }, { milestoneId: 'm4', why: 'x' }, { milestoneId: 'm5', why: 'x' }] }; const m1 = s.milestones.find(m => m.id === 'm1'); m1.pathStatus = 'retired'; m1.retiredDecisionId = 'dx'; } });
  W.rhythm(); let s = W.state();
  ok('D5 路線改變令卡的站全被撤 → 卡暫停「負責的站已撤回」，milestoneIds 保留作紀錄（Z22）', s.teammates[0].lifecycle === 'paused' && s.teammates[0].pausedReason === '負責的站已撤回' && s.teammates[0].milestoneIds.join() === 'm1', s.teammates[0]);
  const orphan = (un) => world('d5-orphan' + un.length, { mutate: s => { s.teammates = [mkCard({ id: 'tm-x', milestoneIds: ['m1'] })]; s.tasks = []; s.milestones.push({ id: 'm6', title: '新站', short: '新站', pathStatus: 'confirmed', state: 'not_started', order: 6, trial: { adoptedAt: TODAY, until: ymd(10) }, addedBy: 'founder' }); s.rolesSync = { for: R.rolesKey(s), stationsAt: ['m1', 'm2', 'm3', 'm4', 'm5'], unassigned: ['m2', 'm3', 'm4', 'm5', ...un].map(id => ({ milestoneId: id, why: 'x' })) }; } });
  W = await orphan([]); W.rhythm();
  ok('D5 上次擬崗位後新增的已確認站而沒有崗位 → 標記重擬，下一次日常工作重擬（Z22）', W.calls().some(c => c.type === 'roles'), W.callTypes());
  W = await orphan(['m6']); W.rhythm();
  ok('D5 該站已在「由統籌承擔」清單 → 不觸發重擬（必修 5）', !W.callTypes().includes('roles'), W.callTypes());
});
await attempt('D6', async () => {
  const W = await world('d6-suggest', { mutate: s => {
    s.teammates = [mkCard({ id: 'tm-x', milestoneIds: ['m1'] })];
        s.tasks = [1, 2, 3].map(i => aiTask('d' + i, '餐廳跟進' + i, { milestoneId: 'm2', status: 'done', doneOn: TODAY, teammateId: '', actorKind: '餐廳' }));
    s.rolesSync = { for: R.rolesKey(s), stationsAt: ['m1', 'm2', 'm3', 'm4', 'm5'], unassigned: ['m2', 'm3', 'm4', 'm5'].map(id => ({ milestoneId: id, why: 'x' })) }; } });
  ok('D6 前提：14 日內 3 件由統籌完成、站無崗位、對象相同 → 有訊號', R.suggestSignals(W.state(), { today: TODAY }).length === 1);
  W.plan({ roles: [{ roles: { summary: 'x', unassigned: [], cards: [{ title: '餐廳跟進主任', mission: '跟進餐廳。', milestoneIds: ['m2'], supports: [], targets: ['customer'], how: ['跟進'], strategy: '一直由統籌做，值得設崗位。', sources: [], deliverables: ['message'], knowledge: [], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '餐廳跟進訊息', deliverable: '一份訊息草稿', milestoneId: 'm2' } }] } }] });
  W.rhythm(); const s = W.state(), pk = W.packOf(p => p.rolesSync)[0];
  ok('D6 Zero 主動建議（Z18）：suggest 模式擬一張卡、suggestedFor 記今日、題目問句用「Zero 建議加一個崗位…」', W.calls().some(c => c.type === 'roles' && c.mode === 'suggest') && s.rolesSync.suggestedFor['kind:餐廳'] === TODAY && pk && pk.questions.length === 1 && pk.questions[0].ask === N.t('role_suggestAsk', { t: '餐廳跟進主任', s: '訂戶試訂' }), { ask: pk && pk.questions[0].ask, sf: s.rolesSync.suggestedFor });
  W.answer(pk, q => N.t('role_optDecline'));
  W.rhythm();
  ok('D6 答「不要」→ 記 declined，同一訊號不再建議（Z18）', W.callTypes().filter(t => t === 'roles').length === 1 && Object.keys(W.state().rolesSync.declined).some(k => k.startsWith('title:')), W.callTypes());
});

await attempt('D7', async () => {
  const W = await world('d7-split', { mutate: s => {
    s.teammates = [mkCard({ id: 'tm-x', milestoneIds: ['m1', 'm2', 'm3'] })]; s.tasks = [];
    s.rolesSync = { for: R.rolesKey(s), stationsAt: ['m1', 'm2', 'm3', 'm4', 'm5'], unassigned: ['m4', 'm5'].map(id => ({ milestoneId: id, why: 'x' })) };
    for (const id of ['m1', 'm2', 'm3']) s.milestones.find(m => m.id === id).state = 'active'; } });
  // 三個進行中的站面對兩類對象：把要點頭的人寫進公司概覽（帳本由概覽同步）
  const pf = path.join(W.DATA, 'company', 'page.json'), cf = path.join(W.DATA, 'ledger', 'confirmed.json'), page = jr(pf), conf = jr(cf);
  page.path.milestones.forEach((m, i) => { if (i < 3) { m.actor = { id: m.id + '-actor', plan: 'milestone.actor', label: '決策者', kind: 'text', value: i < 1 ? '農場甲' : '餐廳乙', origin: 'ai' }; conf.values[m.id + '-actor'] = m.actor.value; } });
  fs.writeFileSync(pf, JSON.stringify(page, null, 2)); fs.writeFileSync(cf, JSON.stringify(conf, null, 2));
  W.rhythm();
  const pk = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'split')[0];
  ok('D7 拆分訊號：一卡負責 ≥ 3 個進行中的站而要點頭的人不同 → 擬拆出的新卡、出拆分題「…負責的事太多，拆成…」（Z20）', W.calls().some(c => c.type === 'roles' && c.mode === 'split') && pk && pk.questions.length === 1 && pk.questions[0].ask === N.t('role_splitAsk', { t: '社區拓展經理', a: '社區拓展經理', b: pk.questions[0].roleCard.title }), { calls: W.calls().map(c => c.type + ':' + c.mode), pk: pk && pk.questions[0].ask });
  ok('D7 拆分題有 q.roleCard', cardKeys(pk.questions[0]), pk.questions[0].roleCard);
  W.answer(pk, q => q.options[0].text);
  const s = W.state(), from = s.teammates.find(t => t.id === 'tm-x'), nu = s.teammates.find(t => t.id !== 'tm-x');
  ok('D7 確認後：原卡只留一組站、splitInto；新卡 planned 附啟用任務、帶拆出的站（Z20）', from.milestoneIds.join() === 'm1' && from.splitInto && from.splitInto[0] === nu.id && nu.lifecycle === 'planned' && nu.milestoneIds.join() === 'm2,m3' && s.tasks.some(t => t.id === nu.activationTaskId), { from: from.milestoneIds, nu: nu && nu.milestoneIds });
  W.rhythm();
  ok('D7 同一張卡不再重複拆（splitAsked）', W.callTypes().filter(t => t === 'roles').length === 1, W.callTypes());
});

/* =====================================================================
   E　三格權限直接存檔、成員離開　　F　收尾三項
===================================================================== */
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
await attempt('E1', async () => {
  const W = await world('e1-perms', { mutate: s => { s.tasks = msTasks(1); } });
  const pf = path.join(W.DATA, 'company', 'page.json'), cf = path.join(W.DATA, 'ledger', 'confirmed.json');
  const before = { p: sha(pf), c: sha(cf) }, hashBefore = lib.proofreadHash(jr(pf));
  ok('E1 前提：已確認的舊公司沒有 permissions', !W.state().company.permissions);
  W.rhythm(); const s = W.state();
  ok('E1 舊公司補寫三格權限預設（source default），不經 syncLedger 比較欄也寫得入（Z51）', s.company.permissions && s.company.permissions.source === 'default' && JSON.stringify(s.company.permissions.askFirst) === JSON.stringify(R.PERMISSIONS_DEFAULT.askFirst) && s.company.permissions.self.length === R.PERMISSIONS_DEFAULT.self.length, s.company.permissions);
  ok('E1 不改 page.json／confirmed.json、proofreadHash 不變（不要求再確認）', sha(pf) === before.p && sha(cf) === before.c && lib.proofreadHash(jr(pf)) === hashBefore);
  ok('E1 這一步 0 次 AI 啟動（只有日常工作 1 件）', W.starts().length === 1 && W.callTypes().join() === 'rhythm', W.callTypes());
  const W2 = await world('e1b-keep', { mutate: s => { s.tasks = msTasks(1); s.company.permissions = { self: ['a'], tellAfter: ['b'], askFirst: ['c'], source: 'founder' }; } });
  W2.rhythm();
  ok('E1 已有 permissions（創辦人收窄過）→ 原樣，不覆寫', JSON.stringify(W2.state().company.permissions.askFirst) === '["c"]' && W2.state().company.permissions.source === 'founder', W2.state().company.permissions);
});
await attempt('E3', async () => {
  const actors = st => [{ id: 'pc-t1', name: '陳小明', label: '陳小明', kind: 'team', role: '送貨', status: 'active', aliases: [], team: { type: 'fulltime', state: st } }];
  const W = await world('e3-left', { mutate: s => { s.company.actors = actors('left'); s.teammates = [mkCard({ id: 'tm-x', supports: ['pc-t1'] })]; s.tasks = msTasks(1); } });
  ok('E3 前提：supportsReview 認得已離開的成員', R.supportsReview(W.state()).ask.length === 1, R.supportsReview(W.state()));
  W.rhythm();
  const pk = W.packOf(p => p.rolesSync && p.rolesSync.kind === 'left')[0];
  ok('E3 成員離開題有 q.roleCard', pk && cardKeys(pk.questions[0]), pk && pk.questions[0].roleCard);
  ok('E3 成員離開：supports 含他的卡 → 出確認題「〈姓名〉已離開團隊。「〈稱號〉」改為支援你？」（Z52）', pk && pk.questions.length === 1 && pk.questions[0].ask === N.t('role_leftAsk', { n: '陳小明', t: '社區拓展經理' }), pk && pk.questions[0].ask);
  W.rhythm();
  ok('E3 每個（卡，成員）只問一次', W.packOf(p => p.rolesSync && p.rolesSync.kind === 'left').length === 1);
  W.answer(pk, q => q.options[0].text);
  ok('E3 確認後 supports 移除該成員；名單不刪對象', W.state().teammates[0].supports.length === 0 && W.state().company.actors.some(a => a.id === 'pc-t1'), W.state().teammates[0]);
  const W2 = await world('e3b-paused', { mutate: s => { s.company.actors = actors('paused'); s.teammates = [mkCard({ id: 'tm-x', supports: ['pc-t1'] })]; s.tasks = msTasks(1); } });
  W2.rhythm();
  ok('E3 成員暫停：不出題、不改 supports（團隊頁顯示「暫停期間支援你」）（Z52）', !W2.packOf(p => p.rolesSync).length && W2.state().teammates[0].supports.join() === 'pc-t1' && R.supportsReview(W2.state()).paused.length === 1);
});
await attempt('F1', async () => {
  const W = await world('f1-twofiles', { mutate: s => { s.tasks = msTasks(1); } });
  const a = i => ({ title: '產出' + i, type: 'research', audience: 'internal', text: '# 產出' + i + '\n\n內容' + i + '\n\n依據：公司概覽\n' });
  W.plan({ rhythm: [{ artifacts: [a(1), a(2), a(3)] }] });
  W.rhythm(); const run = W.lastRun(), id = itemsOf(run)[0].workId, rc = jr(path.join(W.DATA, 'work', id, 'receipt.json'));
  ok('F1 收據只收前兩份（Z33）：runs 計 2 份新產出，摘要註明「Zero 交了 3 份，只收兩份」', run.artifacts === 2 && /交了 3 份，只收兩份/.test(run.summary + JSON.stringify(rc.summary)) || (run.artifacts === 2 && run.summary.includes(N.t('receipt_tooMany', { n: 3 }))), { artifacts: run.artifacts, summary: run.summary });
});
await attempt('F2', async () => {
  const W = await world('f2-custom', { mutate: s => { s.tasks = msTasks(1); s.inputs = [{ id: 'in-evt1', via: 'event', title: '發生了一件事（11 月 8 日）：見了王伯', eventDate: TODAY, receivedAt: lib.localIso(), status: 'awaitingFounder', files: [], effects: [] }]; } });
  const item = { name: '王伯', role: '農務顧問', actorKind: 'advisor' };
  const pack = { format: 'startup-os.ask/0.1', id: 'ask-test-evt', title: '確認這件事', context: 'x', afterConfirm: 'x', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: null, todoType: 'decision', realEvent: { inputId: 'in-evt1', date: TODAY },
    questions: [{ id: 'q1', priority: 1, about: '王伯', ask: '這件事提到王伯（農務顧問）：加入名單？', kind: 'choice', effect: 'now', options: [{ text: '加入名單', rec: true, apply: { op: 'addActor', mode: 'add', item } }, { text: N.ui.newActorNo, apply: { op: 'keep' } }], value: '加入名單', why: '測試' }] };
  fs.mkdirSync(W.DIR.asks, { recursive: true }); fs.writeFileSync(path.join(W.DIR.asks, pack.id + '.json'), JSON.stringify(pack));
  W.answer(pack, q => '先不決定，我再想想');
  let s = W.state(); const key = P.norm('王伯');
  ok('F2 事件確認題的新對象：自訂答案不當「不加入」——declined 不加、記原話、留待再問一次（reasked 1）', !((s.peopleSync || {}).declined || {})[key] && s.peopleSync.reasked[key] === 1 && (s.peopleSync.pending || []).some(x => x.name === '王伯') && !s.company.actors.some(a => a.name === '王伯'), s.peopleSync);
  ok('F2 回饋一句：已記下你的答覆', s.events.some(e => e.title === N.t('peopleCustomAsked', { n: '王伯', s: '先不決定，我再想想' })), s.events.slice(-2).map(e => e.title));
  W.shell();
  const sp = W.packOf(p => p.peopleSync)[0];
  ok('F2 下一次放出「整理名單」包再問一次', sp && sp.questions.length === 1 && /王伯/.test(sp.questions[0].ask), sp && sp.questions[0].ask);
  W.answer(sp, q => '還是先不要');
  s = W.state();
  // 0.44.0：第二次自訂答案只結束這一題，名稱不再以 reasked === 2 永久封鎖（名稱鍵不留）
  ok('F2 第二次仍是自訂答案：記原話（peopleCustomClosed）、這一題結束（沒有新包、不在擱置清單）、名稱不留封鎖', !((s.peopleSync.reasked || {})[key]) && !(s.peopleSync.pending || []).length && W.packOf(p => p.peopleSync).length === 1 && !((s.peopleSync.declined || {})[key]) && s.events.some(e => e.title === N.t('peopleCustomClosed', { n: '王伯', s: '還是先不要' })), { ps: s.peopleSync, packs: W.packOf(p => p.peopleSync).length, ev: s.events.slice(-2).map(e => e.title) });
  // 0.44.0：舊帳本的名稱封鎖鍵（reasked === 2）不再令整理名單丟棄該名稱；改類別鍵（kind:編號:類別）仍照舊
  const raw = { items: [{ kind: 'newActor', name: '王伯', role: '農務顧問', actorKind: 'advisor', why: '概覽提到。' }, { kind: 'newActor', name: '李叔', role: '顧問', actorKind: 'advisor', why: '概覽提到。' }] };
  const chk = P.checkPeopleSync(raw, { actors: [], texts: ['王伯', '李叔'], reasked: { [key]: 2 } });
  ok('F3 整理名單可再建議曾以自訂答案答兩次的名稱（單元，舊格式 reasked 2 亦不丟棄）', chk.ok && chk.items.map(x => x.name).sort().join() === ['王伯', '李叔'].sort().join() && !chk.dropped.some(d => d.reason === 'reasked'), chk);
  ok('F3 reasked 為 1 的仍可建議（只問過一次）', P.checkPeopleSync(raw, { actors: [], texts: ['王伯', '李叔'], reasked: { [key]: 1 } }).items.length === 2);
  // 整合（0.44.0）：擱置清單再有同名對象時照常放出再問，不因先前兩次自訂答案而濾掉
  const t = W.state(); t.peopleSync.pending = [{ kind: 'newActor', ...item, why: 'x' }]; W.put(t);
  W.shell();
  const sp3 = W.packOf(p => p.peopleSync);
  ok('F3 擱置項目再有「王伯」：照常放出新一包再問', sp3.length === 2 && sp3.some(p => p.id !== sp.id && /王伯/.test(p.questions[0].ask)) && (W.state().peopleSync.pending || []).length === 0, sp3.map(p => p.id + ':' + p.questions.map(q => q.ask).join('|')));
});

await attempt('E2', async () => {
  // 創辦人再次確認公司概覽（handleProofread）：三格權限預設直接存檔，不改 page／confirmed、proofreadHash 不變、不要求再確認
  const confirmOnce = async (name, mutate) => {
    const W = await world(name, { mutate });
    const pf = path.join(W.DATA, 'company', 'page.json'), page = jr(pf), order = page.path.milestones.map(m => m.id);
    const machine = { format: 'startup-os.proofread-reply/0.1', page: page.page.id, company: page.company.name, confirmedAt: '2026-11-08T10:00:00+08:00', confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: {}, kindsChanged: [] };
    const head = ['kind: proofread', 'ref: ' + page.page.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.proofreadHash(page), 'batch: false', 'shownAt: ' + lib.localIso()];
    fs.mkdirSync(W.DIR.replies, { recursive: true });
    fs.writeFileSync(path.join(W.DIR.replies, '20261108-100000-proofread-fixed.md'), head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
    const hashBefore = lib.proofreadHash(page), pageSha = sha(pf);
    const r = W.shell();
    return { W, r, hashBefore, pageSha, pf, cf: path.join(W.DATA, 'ledger', 'confirmed.json') };
  };
  const A = await confirmOnce('e2-missing', s => { s.tasks = []; });
  const B2 = await confirmOnce('e2-present', s => { s.tasks = []; s.company.permissions = { ...R.PERMISSIONS_DEFAULT, source: 'default' }; });
  const sA = A.W.state();
  ok('E2 前提：再次確認成功（confirmed.json 寫入、回覆已處理）', fs.existsSync(A.cf) && jr(A.cf).replyFile === '20261108-100000-proofread-fixed.md' && !fs.readdirSync(A.W.DIR.replies).some(f => f.endsWith('.md')), log(A.r).slice(-300));
  ok('E2 概覽確認後：三格權限預設直接存檔（source default），0 次 AI', sA.company.permissions && sA.company.permissions.source === 'default' && JSON.stringify(sA.company.permissions.askFirst) === JSON.stringify(R.PERMISSIONS_DEFAULT.askFirst) && A.W.callTypes().length === 0, { perm: !!sA.company.permissions, calls: A.W.callTypes() });
  ok('E2 page.json 不變、proofreadHash 結果不變', sha(A.pf) === A.pageSha && lib.proofreadHash(jr(A.pf)) === A.hashBefore);
  ok('E2 confirmed.json 與「沒有存權限這一步」（權限本來就有）的結果逐字相同——權限存檔沒有碰它', sha(A.cf) === sha(B2.cf), [sha(A.cf), sha(B2.cf)]);
  ok('E2 不要求再確認：同一個版本雜湊仍被接受、沒有新的校對題或概覽待確認、日常工作不因此跳過', lib.proofreadHashMatches(jr(A.pf), A.hashBefore) && !A.W.packs().some(p => p.proofread || p.todoType === 'proofread') && (() => { A.W.plan({}); A.W.rhythm(); return A.W.lastRun().skipReason !== 'overviewPending' && A.W.lastRun().skipReason !== 'intakeNotComplete'; })(), A.W.lastRun());
});

/* =====================================================================
   G　覆核後修正（0.41.0 獨立覆核 M1–M5 及示範實例）
===================================================================== */
await attempt('G1', async () => {
  // M1：創辦人一句普通答案（「照舊」）不令說明核對不合格
  const W = await world('g1-answer-phrase', { mutate: s => { s.tasks = msTasks(3); setRhythm(s, { pace: 'fast' }); } });
  lib.appendLog(W.DIR, [{ at: lib.localIso(), source: 'ask', packId: 'ask-x', packTitle: '送貨', qid: 'q1', question: '每週送貨時間要改嗎？', ai: '維持', answer: '照舊', changed: true, effect: 'now', runId: 'R-x' }]);
  W.rhythm(); const run = W.lastRun(), cs = W.calls().filter(c => c.type === 'rhythm');
  ok('G1 答案「照舊」仍在最近問答內：加速日 3 件照做、不因說明不合格而停、三件都是八段說明（覆核 M1）', itemsOf(run).length === 3 && run.stopReason === 'itemsCap' && cs.length === 3 && cs.every(c => /## 一、目標/.test(c.task)), { items: itemsOf(run).length, stop: run.stopReason, eight: cs.map(c => /## 一、目標/.test(c.task)) });
  ok('G1 答案原文仍寫入第四段（引述）', cs.every(c => c.task.includes('照舊')), cs[0] && cs[0].task.slice(0, 200));
});
await attempt('G2', async () => {
  // M1：退回原因含「同上」仍進八段說明；說明因其他原因不合格而改用通用說明時，退回原因也不丟失
  const W = await world('g2-return-reason', { mutate: s => { s.tasks = [aiTask('t1', '餐廳乙報價', { status: 'active', returnNote: '同上，價錢要改為每公斤三十八元' })]; } });
  W.rhythm();
  const c = W.calls().find(x => x.type === 'rhythm'), ledger = fs.readFileSync(path.join(W.DATA, 'sandbox', c.sandbox, 'ledger.json'), 'utf8');
  ok('G2 退回原因含「同上」：八段說明仍用，原因在說明內（覆核 M1）', /## 一、目標/.test(c.task) && c.task.includes('三十八元') && !W.lastRun().warnings, { eight: /## 一、目標/.test(c.task), warnings: W.lastRun().warnings });
  const W2 = await world('g2b-fallback-keeps-reason', { mutate: s => { s.teammates = [mkCard({ id: 'tm-b', title: '照舊推廣專員', name: '照舊推廣專員' })]; s.tasks = [aiTask('t1', '照舊報價', { status: 'active', returnNote: '價錢要改為每公斤三十八元', teammateId: 'tm-b' })]; } });
  W2.rhythm();
  const c2 = W2.calls().find(x => x.type === 'rhythm');
  ok('G2 外殼自己的句子不合格 → 改用通用說明，但退回原因照樣交給 AI（覆核 M1）', !/## 一、目標/.test(c2.task) && c2.task.includes('三十八元') && c2.task.includes('必須處理的意見'), c2.task.slice(-300));
  const W3 = await world('g2c-rewrite-fallback', { mutate: s => { s.teammates = [mkCard({ id: 'tm-x', title: '照舊推廣專員', name: '照舊推廣專員' })]; s.tasks = [aiTask('t1', '照舊跟進訊息', { teammateId: 'tm-x' })]; } });
  W3.plan({ rhythm: [{ artifacts: [MSG] }], proofread: [{ verdict: 'return' }, { verdict: 'pass' }] });
  W3.rhythm();
  const rw = W3.calls().find(x => x.type === 'qa-rewrite');
  ok('G2 校對發回重寫的說明不合格 → 通用說明仍附校對問題及上一版檔名，要求按問題改寫（窄覆核 N2）', rw && !/## 一、目標/.test(rw.task) && /價錢沒有來源/.test(rw.task) && /previous-1\.md/.test(rw.task) && /逐份改寫/.test(rw.task), rw && rw.task.slice(-500));
});
await attempt('G3', async () => {
  // M2：前一工作日的 run（23:50 開工）在午夜後的啟動，不再因日期前綴計入今日
  const prevId = 'R' + ymd(-1).replace(/-/g, '') + '-235000-123';
  const W = await world('g3-midnight', { mutate: s => { s.tasks = msTasks(2); s.runs = [{ id: prevId, type: 'rhythm', trigger: 'schedule', slot: ymd(-1), startedAt: ymd(-1) + 'T23:50:00+08:00', workDay: ymd(-1), state: 'ended', ending: 'artifact', aiStarted: true, items: [] }]; } });
  fs.writeFileSync(path.join(W.DATA, 'ledger', 'ai-starts.log'), Array.from({ length: 45 }, (_, i) => lib.localIso() + '\trhythm\t' + prevId + '-i' + (i + 1)).join('\n') + '\n');
  W.rhythm(); const run = W.lastRun();
  ok('G3 昨日 run 在午夜後寫了 45 行啟動（日期前綴是今日）：今日標準保險絲 40 不被它用盡，今日照常開工（覆核 M2）', run.state === 'ended' && run.skipReason !== 'budgetExhausted' && W.callTypes().includes('rhythm'), { run, calls: W.callTypes() });
  ok('G3 那 45 行仍計入昨日（按 run 編號），今日只算今日自己的啟動', PACE.countStarts(W.starts().slice(0, 45), ymd(-1), { runIds: [prevId] }).total === 45, W.starts().length);
});
await attempt('G4', async () => {
  // M3：「恢復 Zero」經操作隊列合併後，暫停期間排隊（等候：已暫停）的工作排回重做
  const W = await world('g4-resume-retry', { mutate: s => { s.health = { ...(s.health || {}), pausedByFounder: true, pausedByFounderAt: lib.localIso() }; } });
  const STATUS = path.join(W.DIR.ledger, 'status.json'), st = fs.existsSync(STATUS) ? jr(STATUS) : { runs: [] };
  st.runs = (st.runs || []).concat([{ id: 'R20261108-100000-001', kind: 'note', ref: 'x', state: 'waiting', waitingFor: 'paused', startedAt: lib.localIso(), steps: [], replyFiles: [] }]);
  fs.writeFileSync(STATUS, JSON.stringify(st));
  W.ops([{ op: 'resumeZero', target: 'company', value: {} }]);
  W.shell();
  const run = jr(STATUS).runs.find(r => r.id === 'R20261108-100000-001');
  ok('G4 經操作隊列恢復 Zero：暫停已解除，等候中的工作改為 resumed、retry 單已被處理（覆核 M3）', !(W.state().health || {}).pausedByFounder && run && run.state === 'resumed' && !fs.existsSync(path.join(W.DIR.ledger, 'retry-requested')), { run, health: W.state().health });
});
await attempt('G5', async () => {
  // M4：啟用任務退回兩次當刻有別的崗位題包開著 → 之後該包答完，「改卡或取消」題補放，且只問一次
  const card = { id: 'tm-x', title: '社區拓展經理', name: '社區拓展經理', lifecycle: 'planned', milestoneIds: ['m1'], activationTaskId: 'act-x', activationReturns: 1, mission: '負責首站。', bounds: { tellAfter: [], askFirst: [] } };
  const W = await world('g5-recard-late', { mutate: s => { s.teammates = [card]; s.tasks = [{ id: 'act-x', title: '首站問題清單', owner: 'ai', status: 'done', milestoneId: 'm1', teammateId: 'tm-x', cadence: 'activation', needsAcceptance: true, updatedAt: lib.localIso() }]; } });
  const put = p => { fs.mkdirSync(W.DIR.asks, { recursive: true }); fs.writeFileSync(path.join(W.DIR.asks, p.id + '.json'), JSON.stringify(p)); return p; };
  const acc = put({ format: 'startup-os.ask/0.1', id: 'ask-acc-x', title: '接受即啟用', context: 'x', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: 'R-x', todoType: 'acceptance',
    acceptance: { taskId: 'act-x', teammateId: 'tm-x', activation: true, workId: 'R-x', roleTitle: card.title }, questions: [{ id: 'accept', priority: 1, ask: '接受？', kind: 'choice', effect: 'now', options: [{ text: '接受', rec: true }, { text: N.t('role_optReturn') }], value: '接受' }, { id: 'reason', priority: 2, ask: '要改甚麼？', kind: 'text', effect: 'tentative', value: '不用改' }] });
  const rp = put({ format: 'startup-os.ask/0.1', id: 'ask-roles-2', title: N.t('role_confirmTitle'), context: 'x', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: null, todoType: 'decision', rolesSync: { key: '', kind: 'confirm' }, questions: [{ id: 'q1', priority: 1, ask: '採購？', kind: 'choice', effect: 'now', options: [{ text: N.t('role_optAccept'), rec: true, apply: { op: 'roleAccept', card: { title: '原料採購專員', milestoneIds: ['m2'], activation: { title: 'a', deliverable: 'b', milestoneId: 'm2' } } } }, { text: N.t('role_optDecline'), apply: { op: 'roleDecline', card: { title: '原料採購專員', milestoneIds: ['m2'] } } }], value: N.t('role_optAccept') }] });
  W.answer(acc, q => q.id === 'accept' ? N.t('role_optReturn') : '要更具體');
  const recards = () => W.packs().filter(p => p.rolesSync && p.rolesSync.kind === 'recard');
  ok('G5 前提：退回兩次、另一包崗位題未答 → 當刻放不出「改卡或取消」題', W.state().teammates[0].activationReturns === 2 && recards().length === 0, W.state().teammates[0]);
  W.answer(rp, () => N.t('role_optDecline'));
  W.rhythm();
  ok('G5 另一包答完後再開工 → 補放「改卡或取消」題（覆核 M4）', recards().length === 1 && recards()[0].rolesSync.teammateId === 'tm-x' && W.state().rolesSync.recardAsked['tm-x'] === 'act-x', { n: recards().length, asked: (W.state().rolesSync || {}).recardAsked });
  W.rhythm(); W.rhythm();
  ok('G5 再開工幾次也不重複放題', recards().length === 1, recards().length);
});
await attempt('G6', async () => {
  // M5：待啟用崗位暫停後才答啟用驗收（接受／退回）；恢復後狀態正確
  const mk = () => ({ id: 'tm-x', title: '社區拓展經理', name: '社區拓展經理', lifecycle: 'paused', lifecycleBefore: 'planned', milestoneIds: ['m1'], activationTaskId: 'act-x', activationReturns: 0, mission: '負責首站。', bounds: { tellAfter: [], askFirst: [] } });
  const card = mk();
  const build = async name => {
    const W = await world(name, { mutate: s => { s.teammates = [mk()]; s.tasks = [{ id: 'act-x', title: '首站問題清單', owner: 'ai', status: 'done', milestoneId: 'm1', teammateId: 'tm-x', cadence: 'activation', needsAcceptance: true, updatedAt: lib.localIso() }]; } });
    fs.mkdirSync(W.DIR.asks, { recursive: true });
    const acc = { format: 'startup-os.ask/0.1', id: 'ask-acc-x', title: '接受即啟用', context: 'x', next: null, askedBy: 'AI', askedAt: lib.localIso(), fromRun: 'R-x', todoType: 'acceptance',
      acceptance: { taskId: 'act-x', teammateId: 'tm-x', activation: true, workId: 'R-x', roleTitle: card.title }, questions: [{ id: 'accept', priority: 1, ask: '接受？', kind: 'choice', effect: 'now', options: [{ text: '接受', rec: true }, { text: N.t('role_optReturn') }], value: '接受' }, { id: 'reason', priority: 2, ask: '要改甚麼？', kind: 'text', effect: 'tentative', value: '不用改' }] };
    fs.writeFileSync(path.join(W.DIR.asks, acc.id + '.json'), JSON.stringify(acc));
    return { W, acc };
  };
  const A = await build('g6-accept');
  A.W.answer(A.acc, q => q.id === 'accept' ? '接受' : undefined);
  const ca = A.W.state().teammates[0];
  ok('G6 暫停的待啟用卡答「接受」：activation 與 bounds 鎖定已寫入，啟用任務 done，卡仍暫停（覆核 M5）', ca.lifecycle === 'paused' && ca.lifecycleBefore === 'enabled' && !!ca.activation && !!(ca.bounds || {}).lockedAt && A.W.state().tasks.find(t => t.id === 'act-x').status === 'done', ca);
  A.W.ops([{ op: 'roleResume', target: 'tm-x' }]); A.W.shell();
  ok('G6 之後恢復 → 崗位是已啟用', A.W.state().teammates[0].lifecycle === 'enabled', A.W.state().teammates[0]);
  const B2 = await build('g6-return');
  B2.W.answer(B2.acc, q => q.id === 'accept' ? N.t('role_optReturn') : '要更具體');
  const cb = B2.W.state().teammates[0], tb = B2.W.state().tasks.find(t => t.id === 'act-x');
  ok('G6 暫停的待啟用卡答「退回」：退回次數加一、啟用任務重開並帶退回原因（覆核 M5）', cb.activationReturns === 1 && tb.status === 'active' && tb.returnNote === '要更具體', { cb, tb });
  B2.W.ops([{ op: 'roleResume', target: 'tm-x' }]); B2.W.shell();
  ok('G6 之後恢復 → 崗位回到待啟用', B2.W.state().teammates[0].lifecycle === 'planned', B2.W.state().teammates[0]);
});
await attempt('G7', async () => {
  // 示範實例：所有驗收題只記錄答案，不改工作、不改崗位卡、不開 AI
  const { seedDemo } = await imp('demo-seed.mjs');
  for (const [mode, packId] of [['accept', 'ask-demo-activation'], ['return', 'ask-demo-activation'], ['return', 'ask-demo-accept']]) {
    const DATA = path.join(OUT, 'g7-demo-' + mode); fs.rmSync(DATA, { recursive: true, force: true });
    seedDemo(DATA, { reset: true });
    const pk = jr(path.join(DATA, 'asks', packId + '.json'));
    const before = jr(path.join(DATA, 'ledger', 'state.json'));
    const pickVal = mode === 'return' ? ((pk.questions[0].options.find(o => o.text !== '接受' && !/方向/.test(o.text)) || {}).text) : '接受';
    const list = pk.questions.map(q => ({ q, v: q.id === 'accept' ? pickVal : q.id === 'reason' ? '價錢要改' : undefined })).filter(x => x.v !== undefined).map(({ q, v }) => ({ id: q.id, value: v, ai: q.value, changed: v !== q.value }));
    const machine = { format: 'startup-os.ask-reply/0.1', pack: pk.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
    const head = ['kind: ask-answer', 'ref: ' + pk.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pk) : lib.fnv(JSON.stringify(pk))), 'batch: false', 'shownAt: ' + lib.localIso()];
    fs.writeFileSync(path.join(DATA, 'founder', 'replies', lib.localIso().replace(/\D/g, '') + '-ask-answer-' + pk.id + '-0.md'), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
    const r = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, encoding: 'utf8', timeout: 60000 });
    const after = jr(path.join(DATA, 'ledger', 'state.json'));
    ok('G7 示範實例 ' + packId + '（' + mode + '）：只記錄——工作、崗位卡不變，沒有開 AI（覆核建議 3）', JSON.stringify(before.tasks) === JSON.stringify(after.tasks) && JSON.stringify(before.teammates) === JSON.stringify(after.teammates) && !fs.existsSync(path.join(DATA, 'ledger', 'ai-starts.log')), { status: r.status, tail: ((r.stdout || '') + (r.stderr || '')).slice(-200) });
  }
});

await attempt('G8', async () => {
  // 窄覆核 N1：創辦人答「改崗位卡」後 Zero 重擬失敗，下一次日常工作要再問「改卡或取消」，卡不可永遠停在待啟用
  const mk = { id: 'tm-x', title: '社區拓展經理', name: '社區拓展經理', lifecycle: 'planned', milestoneIds: ['m1'], activationTaskId: 'act-x', activationReturns: 2, mission: '負責首站。', bounds: { tellAfter: [], askFirst: [] } };
  const W = await world('g8-recard-fail', { mutate: s => { s.teammates = [{ ...mk }]; s.tasks = [{ id: 'act-x', title: '首站問題清單', owner: 'ai', status: 'waiting', waitingFor: 'x', milestoneId: 'm1', teammateId: 'tm-x', cadence: 'activation', needsAcceptance: false, returnNote: '要更具體', updatedAt: lib.localIso() }]; } });
  const recardPacks = () => W.packs().filter(p => p.rolesSync && p.rolesSync.kind === 'recard');
  W.rhythm();
  const p1 = recardPacks();
  W.plan({ roles: [{ fail: true }, { fail: true }, { fail: true }] });
  W.answer(p1[0], () => N.t('role_optRecard'));
  W.rhythm(); W.rhythm();
  const open = recardPacks().filter(p => !W.answers(p.id).q1);
  ok('G8 改卡重擬失敗後再問「改卡或取消」（窄覆核 N1）', p1.length === 1 && open.length >= 1, { first: p1.length, open: open.length, recardAsked: (W.state().rolesSync || {}).recardAsked });
});

const pass = results.filter(r => r.pass).length;
console.log('\n' + pass + '/' + results.length + ' 通過');
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
process.exit(pass === results.length ? 0 : 1);
