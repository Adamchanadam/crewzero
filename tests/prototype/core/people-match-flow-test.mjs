// 0.44.0 名單比對流程測試（N 線）：直接叫 run.mjs，用假 AI 重播（<SOS_DATA>/replay-event.json），不開伺服器、不開瀏覽器。
// 依據：docs/evidence/people-team-2026-11-12/fable-analysis.md「回歸測試」第 1、2、4、6、9 項；
// 派工書 docs/evidence/journey-0440/dispatch/brief-n1.md 第 3.2、3.3 節。
// 檢查分兩類：「場景」＝證明測試世界造得正確；其餘為功能檢查。
// 用法：node people-match-flow-test.mjs <原型資料夾> <輸出資料夾> [port（不使用）]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { writeAdapters } from '../lib/adapters.mjs';
import { certifyDirect } from '../lib/testkit.mjs';

const [PROTO_ARG, OUT] = process.argv.slice(2);
const PROTO = path.resolve(PROTO_ARG);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = file => import(pathToFileURL(path.join(PROTO, file)).href);
const lib = await imp('ask-lib.mjs');
const P = await imp('people-ops.mjs');
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const U = N.ui, T = (key, values) => N.t(key, values);
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 900))); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
let seq = 0;

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });
const adapters = writeAdapters(path.join(OUT, 'adapters'));
const fake = read(adapters.fake);
fake.args = [path.join(HERE, '..', 'lib', 'fake-ai.mjs')];
const ADAPTER = path.join(OUT, 'adapters', 'people-match-fake.json');
fs.writeFileSync(ADAPTER, JSON.stringify(fake, null, 2));

const A = (id, name, kind = 'customer', extra = {}) => ({ id, name, label: name, kind, aliases: [], status: 'active', addedFrom: 'event', fromMilestoneIds: [], ...extra });

/* ---------- 測試世界（做法同 date-precedence-flow-test.mjs 的 world()） ---------- */
// actors 一律帶 addedFrom（不是舊對象），peopleSync.for 設為真實版本鍵，日常工作不會自動整理名單
async function world(name, actors = [], mutate = null) {
  const root = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name), data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, PROTO);
  const env = { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
  shell('--type', 'rhythm', '--trigger', 'manual');
  for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(data, d))) fs.rmSync(path.join(data, d, f), { force: true }); } catch { } }
  await certifyDirect(data, PROTO, ADAPTER);
  const stateFile = path.join(data, 'ledger', 'state.json');
  const state = () => read(stateFile);
  const save = value => fs.writeFileSync(stateFile, JSON.stringify(value, null, 2));
  const s = state();
  s.company = s.company || {}; s.company.actors = actors;
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: P.peopleSyncKey(s) }; s.rolesSync = { for: 'test' };
  if (mutate) mutate(s, data);
  save(s);
  process.env.SOS_DATA = data;
  const DIR = lib.dataDirs(PROTO);
  return { name, data, DIR, shell, state, save };
}
const packs = W => { try { return fs.readdirSync(W.DIR.asks).filter(f => f.endsWith('.json')).map(f => read(path.join(W.DIR.asks, f))); } catch { return []; } };
const packFile = (W, id) => path.join(W.DIR.asks, id + '.json');
const loadPack = (W, id) => (id && fs.existsSync(packFile(W, id)) ? read(packFile(W, id)) : null);
const inputOf = (W, ref) => (W.state().inputs || []).find(x => x.id === 'in-' + ref) || null;
const actorsOf = W => ((W.state().company || {}).actors || []);
// 新對象題：按 apply.op 找，不寫死題號
const actorQ = pack => ((pack && pack.questions) || []).find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addActor')) || null;
const actorQs = pack => ((pack && pack.questions) || []).filter(q => (q.options || []).some(o => o.apply && o.apply.op === 'addActor'));
const optMode = (q, mode) => ((q && q.options) || []).find(o => o.apply && o.apply.op === 'addActor' && o.apply.mode === mode) || null;
const keepOpt = q => ((q && q.options) || []).find(o => o.apply && o.apply.op === 'keep') || null;
const view = q => q && { id: q.id, ask: q.ask, value: q.value, options: q.options.map(o => ({ text: o.text, rec: !!o.rec, mode: o.apply && o.apply.mode, aliasOf: o.apply && o.apply.aliasOf })) };

let replaySeq = 0;
function replay(items) {
  return { summary: '名單比對測試第 ' + (++replaySeq) + ' 件。', grade: 'said', read: { summary: 'Zero 讀了創辦人原話，對照了現有名單。', highlights: [] }, contrasts: [], items, ...(items.length ? {} : { reason: '這件事沒有改變名單或其他紀錄。' }) };
}
const NA = (name, extra = {}) => ({ kind: 'newActor', name, actorKind: 'customer', why: '原話提到' + name + '，之後可能成為合作對象。', ...extra });
// 送出一件事：先寫 replay-event.json，再寫收件匣筆記（機讀區帶日期），然後跑一次外殼
function submit(W, ref, { date, said, ev }) {
  fs.writeFileSync(path.join(W.data, 'replay-event.json'), JSON.stringify(ev, null, 2));
  fs.mkdirSync(W.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-event.md`), `kind: note\ntype: event\nat: ${lib.localIso()}\n\n${said}\n\n\`\`\`json\n${JSON.stringify({ date })}\n\`\`\`\n`);
  const r = W.shell();
  const input = inputOf(W, ref);
  return { ref, input, pack: input ? loadPack(W, input.packId) : null, accepted: !!(input && input.summary === ev.summary), log: (r.stdout || '') + (r.stderr || '') };
}
// 作答：pick 回傳字串；回傳 undefined 的題不答。答案按磁碟上最新一版問題包計雜湊。
function answer(W, pack, pick) {
  const answers = pack.questions.map(q => ({ q, v: pick ? pick(q) : q.value })).filter(x => x.v !== undefined).map(({ q, v }) => ({ id: q.id, value: v, ai: q.value, changed: v !== q.value }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: ' + (answers.length < pack.questions.length), 'shownAt: ' + lib.localIso()];
  fs.mkdirSync(W.DIR.replies, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  return W.shell();
}
const answerPick = (target, value) => q => (q.id === target.id ? value : q.value);

try {
  /* ---------- 回歸第 1 項：名單有「何志明」，事件建議「何志明校長」→ 三選項題，推薦記為別名 ---------- */
  {
    const W = await world('r1-alias', [A('pc-feng', '何志明')]);
    const e = submit(W, 'R20261110-100000-pm1', { date: '2026-11-10', said: '今日與何志明校長見面，他同意安排試用。', ev: replay([NA('何志明校長')]) });
    const q = actorQ(e.pack), alias = optMode(q, 'alias');
    ok('PM-1-0 場景：重播被接受並出新對象題', e.accepted && !!q, { accepted: e.accepted, pack: e.pack && e.pack.questions.map(x => x.ask), log: e.log.slice(-400) });
    ok('PM-1-1 三選項（記為別名／另一個對象，加入／不加入），第一個為別名並推薦，value 等於別名一項', !!q && q.options.length === 3 && q.options[0] === alias && alias.rec === true && alias.apply.aliasOf === 'pc-feng' && q.value === alias.text && alias.text === T('newActorAlias', { n: '何志明' }) && !!optMode(q, 'add') && !!keepOpt(q), view(q));
    if (e.pack) answer(W, e.pack);
    const ac = actorsOf(W);
    ok('PM-1-2 照推薦答：「何志明校長」記為何志明的別名，名單仍只有一個對象', ac.length === 1 && (ac[0].aliases || []).includes('何志明校長'), ac);
  }
  // 兩者同批出現（名單原本沒有此人）：只出一題（註：orderEventItems 每件事本來只留一個新對象，這一項亦受其保證）
  {
    const W = await world('r1-same-batch', []);
    const e = submit(W, 'R20261110-100000-pm1b', { date: '2026-11-10', said: '今日見了何志明，即是何志明校長，他同意安排試用。', ev: replay([NA('何志明'), NA('何志明校長')]) });
    const pending = ((e.input && e.input.pendingEventItems) || []).filter(x => x && x.kind === 'newActor');
    ok('PM-1-3 同一件事同批建議「何志明」及「何志明校長」：只出一題新對象題，沒有擱置第二題', e.accepted && actorQs(e.pack).length === 1 && !pending.length, { accepted: e.accepted, qs: e.pack && e.pack.questions.map(x => x.ask), pending });
  }
  // Zero 整理名單同一批：「何志明」與「何志明校長」互相包含，只出一題（派工書 3.2 第 2 點「同批去重」）
  {
    const pure = P.checkPeopleSync({ items: [NA('何志明', { actorKind: 'team', teamType: 'fulltime', role: '校務聯絡' }), NA('何志明校長', { actorKind: 'advisor', role: '顧問' })] }, { actors: [], texts: ['校務聯絡：何志明（已答應加入）及何志明校長（顧問）'] });
    ok('PM-1-4 整理名單核對（純函數）：同批「何志明」及「何志明校長」只保留一項', pure.ok && pure.items.filter(x => x.kind === 'newActor').length === 1, { items: pure.items.map(x => x.name), dropped: pure.dropped });
    const G6 = '校務聯絡：何志明（已答應加入）及何志明校長（顧問）';
    const W = await world('r1-people-sync', [], (s, data) => {
      const pf = path.join(data, 'company', 'page.json'), cf = path.join(data, 'ledger', 'confirmed.json');
      const page = read(pf), conf = read(cf);
      page.glance.rows.push({ id: 'g6', plan: 'G6', label: '已有人負責的事', kind: 'text', value: G6, origin: 'ai' });
      conf.values = conf.values || {}; conf.values.g6 = G6;
      fs.writeFileSync(pf, JSON.stringify(page, null, 2)); fs.writeFileSync(cf, JSON.stringify(conf, null, 2));
      s.peopleSync.requested = true;
    });
    W.shell();
    const sp = packs(W).filter(p => p.peopleSync);
    ok('PM-1-5 場景：創辦人要求整理名單，Zero 交回後出一包整理名單題', sp.length === 1, { n: sp.length, ps: W.state().peopleSync });
    ok('PM-1-6 整理名單端到端：同批「何志明」及「何志明校長」只出一題', sp.length === 1 && actorQs(sp[0]).length === 1, sp[0] && sp[0].questions.map(x => x.ask));
  }

  /* ---------- 回歸第 2 項：兩個未答包各有同一人的不同寫法 ---------- */
  {
    const W = await world('r2-two-packs', []);
    const e1 = submit(W, 'R20261110-100000-pm2a', { date: '2026-11-10', said: '今日與何志明通電話，他想了解價錢。', ev: replay([NA('何志明')]) });
    const e2 = submit(W, 'R20261111-100000-pm2b', { date: '2026-11-11', said: '何志明校長來信，表示學校有興趣試用。', ev: replay([NA('何志明校長')]) });
    const q1 = actorQ(e1.pack), q2 = actorQ(e2.pack);
    ok('PM-2-0 場景：兩件事各自出二選一「加入名單？」題，兩包同時未答', e1.accepted && e2.accepted && q1 && q1.options.length === 2 && q2 && q2.options.length === 2 && e1.pack.id !== e2.pack.id, { q1: view(q1), q2: view(q2) });
    const before2 = q2 && JSON.parse(JSON.stringify(q2));
    if (e1.pack) answer(W, e1.pack);
    const added = actorsOf(W).find(a => a.name === '何志明');
    ok('PM-2-1 先答第一包「加入」：何志明加入名單', actorsOf(W).length === 1 && !!added, actorsOf(W));
    const p2 = loadPack(W, e2.pack && e2.pack.id), r2 = p2 && p2.questions.find(x => before2 && x.id === before2.id), alias2 = optMode(r2, 'alias');
    ok('PM-2-2 另一包未答的二選一題已轉為三選項題：同一題號，推薦「記為別名」指向剛加入的何志明', !!r2 && r2.options.length === 3 && !!alias2 && alias2.rec === true && alias2.apply.aliasOf === (added && added.id) && r2.value === alias2.text && !!optMode(r2, 'add') && !!keepOpt(r2), view(r2));
    ok('PM-2-3 轉題時保留原題欄位（題號、次序、理由、即時生效）', !!r2 && !!before2 && r2.id === before2.id && r2.priority === before2.priority && r2.why === before2.why && r2.effect === before2.effect && Object.keys(before2).every(k => k in r2), { before: before2 && Object.keys(before2), after: r2 && Object.keys(r2) });
    if (p2) answer(W, p2);
    const ac = actorsOf(W);
    ok('PM-2-4 再答另一包（照推薦）：名單仍只有一個對象，「何志明校長」成為別名', ac.length === 1 && (ac[0].aliases || []).includes('何志明校長'), ac);
  }
  // 作答套用時重新比對：二選一題出題後，同一人經其他途徑已在名單；答「加入」不直接加入，改出三選項題（派工書 3.2 第 3 點）
  {
    const W = await world('r2-apply-time', []);
    const e = submit(W, 'R20261110-100000-pm2c', { date: '2026-11-10', said: '何志明校長來電，想預約參觀。', ev: replay([NA('何志明校長')]) });
    const q = actorQ(e.pack);
    ok('PM-2-5 場景：出二選一「加入名單？」題', e.accepted && !!q && q.options.length === 2, view(q));
    { const s = W.state(); s.company.actors = [A('pc-feng', '何志明')]; W.save(s); }
    if (e.pack) answer(W, e.pack, answerPick(q, optMode(q, 'add') && optMode(q, 'add').text));
    const input = inputOf(W, 'R20261110-100000-pm2c'), next = input && input.packId !== e.pack.id ? loadPack(W, input.packId) : null, nq = actorQ(next), alias = optMode(nq, 'alias');
    ok('PM-2-6 答「加入」時發現唯一疑似對象：沒有直接加入（名單仍只有何志明）', actorsOf(W).length === 1 && !actorsOf(W).some(a => a.name === '何志明校長'), actorsOf(W));
    ok('PM-2-7 改出三選項題（新一包），推薦「記為別名」指向何志明', !!nq && nq.options.length === 3 && !!alias && alias.rec === true && alias.apply.aliasOf === 'pc-feng' && nq.value === alias.text, { packId: input && input.packId, status: input && input.status, q: view(nq) });
    if (next) answer(W, next);
    ok('PM-2-8 照推薦答：記為別名，名單仍只有一個對象', actorsOf(W).length === 1 && (actorsOf(W)[0].aliases || []).includes('何志明校長'), actorsOf(W));
  }

  /* ---------- 回歸第 4 項：答「另一個對象，加入」確實新增第二個對象 ---------- */
  {
    const W = await world('r4-other', [A('pc-feng', '何志明')]);
    const e = submit(W, 'R20261110-100000-pm4', { date: '2026-11-10', said: '今日與何志明校長見面，他是另一間學校的校長。', ev: replay([NA('何志明校長')]) });
    const q = actorQ(e.pack), other = optMode(q, 'add');
    ok('PM-4-0 場景：出三選項題，有「另一個對象，加入」', e.accepted && !!q && q.options.length === 3 && !!other && other.text === T('newActorOther', { k: N.dash.ppl_kind_customer }), view(q));
    if (e.pack && other) answer(W, e.pack, answerPick(q, other.text));
    const ac = actorsOf(W), nu = ac.find(a => a.name === '何志明校長'), old = ac.find(a => a.id === 'pc-feng');
    ok('PM-4-1 答「另一個對象，加入」：名單新增第二個對象「何志明校長」', ac.length === 2 && !!nu && nu.kind === 'customer' && nu.id !== 'pc-feng', ac);
    ok('PM-4-2 原有「何志明」不變（沒有加別名）', !!old && old.name === '何志明' && !(old.aliases || []).length, old);
    const again = submit(W, 'R20261112-100000-pm4b', { date: '2026-11-12', said: '何志明校長再來電確認日期。', ev: replay([NA('何志明校長')]) });
    ok('PM-4-3 之後再建議「何志明校長」：已在名單，不再出題', again.accepted && !actorQ(again.pack), again.pack && again.pack.questions.map(x => x.ask));
  }

  /* ---------- 回歸第 6 項：自訂答案兩次之後，其後事件再提到同一名稱，仍會出題 ---------- */
  {
    const W = await world('r6-custom', []);
    const key = P.norm('王伯');
    const e1 = submit(W, 'R20261110-100000-pm6a', { date: '2026-11-10', said: '今日與王伯見面，他是本地農務前輩。', ev: replay([NA('王伯', { actorKind: 'advisor', role: '農務顧問' })]) });
    const q1 = actorQ(e1.pack);
    ok('PM-6-0 場景：事件出「王伯」新對象題', e1.accepted && !!q1, view(q1));
    if (e1.pack) answer(W, e1.pack, answerPick(q1, '先不決定，我再想想'));
    let ps = W.state().peopleSync || {};
    ok('PM-6-1 第一次自訂答案：不算拒絕、不加入；記下原話；放回擱置清單再問一次', !(ps.declined || {})[key] && (ps.reasked || {})[key] === 1 && (ps.pending || []).some(x => x && x.name === '王伯') && !actorsOf(W).some(a => a.name === '王伯'), ps);
    W.shell();
    const sp1 = packs(W).filter(p => p.peopleSync);
    ok('PM-6-2 下一次外殼放出整理名單包，再問「王伯」一次', sp1.length === 1 && /王伯/.test((actorQ(sp1[0]) || {}).ask || ''), sp1.map(p => p.questions.map(x => x.ask)));
    if (sp1[0]) answer(W, sp1[0], q => (actorQ(sp1[0]) === q ? '還是先不要' : q.value));
    const s2 = W.state(); ps = s2.peopleSync || {};
    const sp2 = packs(W).filter(p => p.peopleSync);
    // 0.44.0：第二次自訂答案只結束這一題，不再永久封鎖名稱；名稱鍵不留在 reasked
    ok('PM-6-3 第二次自訂答案：這一題結束（沒有新包、擱置清空、packId 清空），仍不算拒絕', sp2.length === 1 && !(ps.pending || []).length && !ps.packId && !(ps.declined || {})[key], { packs: sp2.length, pending: ps.pending, packId: ps.packId, reasked: ps.reasked });
    ok('PM-6-4 第二次自訂答案的回饋句為 peopleCustomClosed', (s2.events || []).some(e => e.title === T('peopleCustomClosed', { n: '王伯', s: '還是先不要' })), (s2.events || []).slice(-3).map(e => e.title));
    ok('PM-6-5 名稱沒有留下永久封鎖（reasked 沒有「王伯」）', !(ps.reasked || {})[key], ps.reasked);
    const e3 = submit(W, 'R20261112-100000-pm6b', { date: '2026-11-12', said: '王伯今日再來電，願意擔任顧問。', ev: replay([NA('王伯', { actorKind: 'advisor', role: '農務顧問' })]) });
    ok('PM-6-6 其後事件再提到「王伯」：仍會出新對象題', e3.accepted && !!actorQ(e3.pack), { accepted: e3.accepted, qs: e3.pack && e3.pack.questions.map(x => x.ask), log: e3.log.slice(-300) });
  }

  /* ---------- 回歸第 9 項：舊資料已封鎖的名稱，升級後解除封鎖 ---------- */
  {
    const W = await world('r9-legacy', [A('pc-1', '陳經理', 'partner')]);
    // 0.44.0 前的舊格式（run.mjs customAnswered 舊寫法）：新對象以正規化名稱為鍵、改類別以 kind:編號:類別 為鍵，值 2 = 已再問兩次、永久不再建議
    const legacy = { [P.norm('王伯')]: 2, 'kind:pc-1:advisor': 2 };
    { const s = W.state(); s.peopleSync = { ...s.peopleSync, reasked: legacy, declined: { [P.norm('李叔')]: 1 }, applied: { 'ask-old': ['q1'] } }; W.save(s); }
    const before = W.state().peopleSync;
    W.shell('--type', 'rhythm', '--trigger', 'manual');
    const after = W.state().peopleSync || {};
    ok('PM-9-1 升級後（跑一次日常工作）：名稱封鎖鍵清走', !Object.hasOwn(after.reasked || {}, P.norm('王伯')), after.reasked);
    ok('PM-9-2 改類別鍵及 peopleSync 其餘紀錄（for、declined、applied）原樣保留', (after.reasked || {})['kind:pc-1:advisor'] === 2 && after.for === before.for && JSON.stringify(after.declined) === JSON.stringify(before.declined) && JSON.stringify(after.applied) === JSON.stringify(before.applied), { before, after });
    W.shell('--type', 'rhythm', '--trigger', 'manual');
    const again = W.state().peopleSync || {};
    ok('PM-9-3 冪等：再跑一次，peopleSync 紀錄不變', JSON.stringify({ r: again.reasked, d: again.declined, a: again.applied, f: again.for }) === JSON.stringify({ r: after.reasked, d: after.declined, a: after.applied, f: after.for }), { after, again });
    const e = submit(W, 'R20261112-100000-pm9', { date: '2026-11-12', said: '王伯今日來電，願意擔任農務顧問。', ev: replay([NA('王伯', { actorKind: 'advisor', role: '農務顧問' })]) });
    ok('PM-9-4 解除封鎖後，事件提到「王伯」會出新對象題', e.accepted && !!actorQ(e.pack), { accepted: e.accepted, qs: e.pack && e.pack.questions.map(x => x.ask), log: e.log.slice(-300) });
  }
} catch (error) {
  ok('PM-X 測試程式出錯', false, String(error && error.stack || error));
}

const pass = results.filter(result => result.pass).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
