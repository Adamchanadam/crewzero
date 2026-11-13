// 0.44.0 資訊模型第一期（「已代你收起」）流程驗收：開關打開（SOS_FACT_MERGE=1），直接叫 run.mjs，用假 AI 重播，不開伺服器、不開瀏覽器。
// 驗收原文：docs/evidence/info-model-2026-11-12/fable-analysis.md「驗收」第 1、2、3、5、7 項；第 5 項按創辦人決定（反饋二 a）：
// 只收起有涵蓋的題，日期已過而沒有涵蓋的日程題保持開放。第 6 項（試用資料副本）由預演工具另做；第 4、8 項屬第二期。
// 作答一律用 ask-lib 的 packHash（與作答頁同一算法）。
// 用法：node fact-flow-test.mjs <原型資料夾> <輸出資料夾> [port（不使用）]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { writeAdapters } from '../lib/adapters.mjs';
import { certifyDirect } from '../lib/testkit.mjs';

process.env.SOS_FACT_MERGE = '1';
const [PROTO_ARG, OUT] = process.argv.slice(2);
const PROTO = path.resolve(PROTO_ARG);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 900))); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
let seq = 0;

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });
const adapters = writeAdapters(path.join(OUT, 'adapters'));
const fake = read(adapters.fake);
fake.args = [path.join(HERE, '..', 'lib', 'fake-ai.mjs')];
const ADAPTER = path.join(OUT, 'adapters', 'fact-flow-fake.json');
fs.writeFileSync(ADAPTER, JSON.stringify(fake, null, 2));

// 測試世界（做法同 date-precedence-flow-test.mjs）
async function world(name) {
  const root = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name), data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, PROTO);
  const env = { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', SOS_FACT_MERGE: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
  // 升級情境：先以開關關閉建立舊問題包，再打開開關（啟動清理處理舊包）
  const setMerge = on => { env.SOS_FACT_MERGE = on ? '1' : '0'; };
  shell('--type', 'rhythm', '--trigger', 'manual');
  for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(data, d))) fs.rmSync(path.join(data, d, f), { force: true }); } catch { } }
  await certifyDirect(data, PROTO, ADAPTER);
  const stateFile = path.join(data, 'ledger', 'state.json');
  const state = () => read(stateFile);
  const save = value => fs.writeFileSync(stateFile, JSON.stringify(value, null, 2));
  const s = state();
  s.company = s.company || {}; s.company.actors = [{ id: 'pc-1', name: '陳經理', kind: 'partner', role: '採購' }];
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' }; save(s);
  process.env.SOS_DATA = data;
  const DIR = lib.dataDirs(PROTO);
  return { name, data, DIR, shell, state, save, setMerge };
}
const runsOf = W => { try { return read(path.join(W.DIR.ledger, 'status.json')).runs || []; } catch { return []; } };
const packs = W => { try { return fs.readdirSync(W.DIR.asks).filter(f => f.endsWith('.json')).map(f => read(path.join(W.DIR.asks, f))); } catch { return []; } };
const packFile = (W, id) => path.join(W.DIR.asks, id + '.json');
const inputOf = (W, ref) => (W.state().inputs || []).find(x => x.id === 'in-' + ref) || null;
const assumption = (W, id) => ((W.state().company || {}).assumptions || []).find(a => a.id === id) || {};
const answersOf = (W, id) => { try { return read(path.join(W.DIR.answers, id + '.json')).answers || {}; } catch { return {}; } };
let replaySeq = 0;
const replay = items => ({ summary: '事實合併流程第 ' + (++replaySeq) + ' 件。', grade: 'said', read: { summary: 'Zero 讀了創辦人原話，對照了現有假設、日程及下一個對外動作。', highlights: [] }, contrasts: [], items });
function submit(W, ref, { date, said, ev }) {
  fs.writeFileSync(path.join(W.data, 'replay-event.json'), JSON.stringify(ev, null, 2));
  fs.mkdirSync(W.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-event.md`), `kind: note\ntype: event\nat: ${lib.localIso()}\n\n${said}\n\n\`\`\`json\n${JSON.stringify({ date })}\n\`\`\`\n`);
  W.shell();
  const input = inputOf(W, ref), run = runsOf(W).find(r => r.ref === ref) || null;
  const pack = input && input.packId && fs.existsSync(packFile(W, input.packId)) ? read(packFile(W, input.packId)) : null;
  return { ref, input, run, pack, accepted: !!(run && run.state === 'done' && input && input.summary === ev.summary) };
}
// 只答未收起的題（作答頁本來就看不到已收起的題）；雜湊照作答頁同一算法
function answer(W, packId, pick) {
  const pack = read(packFile(W, packId));
  const answers = pack.questions.filter(q => !q.closed).map(q => ({ id: q.id, value: pick ? pick(q) : q.value, ai: q.value, changed: false }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.packHash(pack), 'batch: false', 'shownAt: ' + lib.localIso()];
  fs.mkdirSync(W.DIR.replies, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  const r = W.shell();
  return { status: r.status, run: runsOf(W).slice(-1)[0] || null };
}
const opQ = (pack, op, id) => ((pack && pack.questions) || []).filter(q => (q.options || []).some(o => o.apply && o.apply.op === op && (!id || o.apply.id === id)));
// 全部問題包內，仍開放（未收起、未答）而與某假設有關的題
const openAbout = (W, op, id) => packs(W).flatMap(p => opQ(p, op, id).filter(q => !q.closed && !answersOf(W, p.id)[q.id]).map(q => ({ pack: p.id, q: q.id })));
const closedAbout = (W, op, id) => packs(W).flatMap(p => opQ(p, op, id).filter(q => q.closed).map(q => ({ pack: p.id, q: q.id, status: q.closed.status })));
const A = (id, grade, why) => ({ kind: 'assumption', id, grade, why });
const hashAll = W => packs(W).map(p => p.id + ':' + lib.fnv(JSON.stringify(p))).sort().join('|');

try {
  /* ---------- 驗收 1、2：同一假設三份日期不同的會議紀錄 ---------- */
  const W1 = await world('three-meetings');
  const e1 = submit(W1, 'R20261103-100000-ff-e1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay([A('H1', 'said', '對方口頭表示有興趣。')]) });
  const e2 = submit(W1, 'R20261106-100000-ff-e2', { date: '2026-11-06', said: '陳經理已安排到工房試用。', ev: replay([A('H1', 'did', '對方已安排試用。')]) });
  const e3 = submit(W1, 'R20261110-100000-ff-e3', { date: '2026-11-10', said: '陳經理已付首批試用費用。', ev: replay([A('H1', 'paid', '對方已付款。')]) });
  ok('FF-1-0 場景：三件事都被外殼接受並出題', e1.accepted && e2.accepted && e3.accepted && opQ(e1.pack, 'setAssumptionGrade', 'H1').length && opQ(e3.pack, 'setAssumptionGrade', 'H1').length, { e1: e1.accepted, e2: e2.accepted, e3: e3.accepted });
  W1.shell(); // 再跑一次，令啟動清理有機會處理
  const open1 = openAbout(W1, 'setAssumptionGrade', 'H1');
  ok('FF-1-1 驗收 1：全不作答，同一假設只剩一題未答，而且在最新一份（11 月 10 日）', open1.length === 1 && e3.input && open1[0].pack === e3.input.packId, { open: open1, newest: e3.input && e3.input.packId });
  const closed1 = closedAbout(W1, 'setAssumptionGrade', 'H1');
  ok('FF-1-2 驗收 1：較舊兩份的同一題已收起（superseded）', closed1.length === 2 && closed1.every(c => c.status === 'superseded'), closed1);
  ok('FF-1-3 開關打開時，新題在建題時已合併，不需要啟動清理（沒有清理紀錄）', !W1.state().factCleanup, W1.state().factCleanup);
  if (e3.input) answer(W1, e3.input.packId);
  W1.shell();
  ok('FF-2-1 驗收 2：作答後現行值一個（H1 為已付款）', assumption(W1, 'H1').grade === 'paid', assumption(W1, 'H1'));
  ok('FF-2-2 驗收 2：同一事實零未答題', openAbout(W1, 'setAssumptionGrade', 'H1').length === 0, openAbout(W1, 'setAssumptionGrade', 'H1'));
  /* ---------- 驗收 7：重跑結果不變 ---------- */
  const before7 = hashAll(W1), clean7 = JSON.stringify(W1.state().factCleanup || null);
  W1.shell(); W1.shell();
  ok('FF-7-1 驗收 7：再跑兩次，問題包不變、清理紀錄不變', hashAll(W1) === before7 && JSON.stringify(W1.state().factCleanup || null) === clean7, { same: hashAll(W1) === before7, before: clean7, after: W1.state().factCleanup });

  /* ---------- 升級情境：開關關閉時已有三份舊題，打開後啟動清理（備份、紀錄、冪等） ---------- */
  const WU = await world('upgrade-cleanup');
  WU.setMerge(false);
  const u1 = submit(WU, 'R20261103-100000-ff-u1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay([A('H1', 'said', '對方口頭表示有興趣。')]) });
  const u2 = submit(WU, 'R20261106-100000-ff-u2', { date: '2026-11-06', said: '陳經理已安排到工房試用。', ev: replay([A('H1', 'did', '對方已安排試用。')]) });
  const u3 = submit(WU, 'R20261110-100000-ff-u3', { date: '2026-11-10', said: '陳經理已付首批試用費用。', ev: replay([A('H1', 'paid', '對方已付款。')]) });
  ok('FF-U-0 場景：開關關閉時三份都有同一假設的未答題', openAbout(WU, 'setAssumptionGrade', 'H1').length === 3, openAbout(WU, 'setAssumptionGrade', 'H1'));
  WU.setMerge(true); WU.shell('--type', 'rhythm', '--trigger', 'manual'); // 啟動清理在日常工作或有創辦人輸入時執行
  const openU = openAbout(WU, 'setAssumptionGrade', 'H1'), stU = WU.state();
  ok('FF-U-1 打開開關後：只剩最新一份的一題未答', openU.length === 1 && u3.input && openU[0].pack === u3.input.packId, { open: openU, newest: u3.input && u3.input.packId });
  ok('FF-U-2 啟動清理有備份（含 state.json 及問題包）及紀錄', !!stU.factCleanup && stU.factCleanup.closed === 2 && fs.existsSync(path.join(WU.data, stU.factCleanup.backup || '-', 'state.json')) && fs.existsSync(path.join(WU.data, stU.factCleanup.backup || '-', 'asks')), stU.factCleanup);
  const beforeU = hashAll(WU), cleanU = JSON.stringify(stU.factCleanup);
  WU.shell('--type', 'rhythm', '--trigger', 'manual'); WU.shell('--type', 'rhythm', '--trigger', 'manual');
  ok('FF-U-3 驗收 7：清理重跑兩次，問題包及清理紀錄不變', hashAll(WU) === beforeU && JSON.stringify(WU.state().factCleanup) === cleanU, { same: hashAll(WU) === beforeU, after: WU.state().factCleanup });
  WU.setMerge(false); WU.shell('--type', 'rhythm', '--trigger', 'manual');
  ok('FF-U-4 關回開關：問題包不再改動（備份保留，資料不刪）', hashAll(WU) === beforeU && fs.existsSync(path.join(WU.data, stU.factCleanup.backup, 'state.json')), { same: hashAll(WU) === beforeU });

  /* ---------- 驗收 3：名單已有某人，其他包的「加入」題自動收起（兩包在開關關閉時已建立） ---------- */
  const W3 = await world('actor-added');
  W3.setMerge(false);
  const actor = { kind: 'newActor', name: '黃小姐', org: '乙餐廳', role: '負責人', actorKind: 'customer', why: '原話提到乙餐廳的黃小姐。' };
  const a1 = submit(W3, 'R20261104-100000-ff-a1', { date: '2026-11-04', said: '乙餐廳的黃小姐來電查詢。', ev: replay([actor]) });
  const a2 = submit(W3, 'R20261105-100000-ff-a2', { date: '2026-11-05', said: '乙餐廳的黃小姐再來電。', ev: replay([actor]) });
  W3.setMerge(true);
  const addQ = p => ((p && p.questions) || []).filter(q => q.kind === 'newActor' || (q.item && q.item.kind === 'newActor') || /黃小姐/.test(String(q.ask || '')));
  ok('FF-3-0 場景：兩件事都出了「加入黃小姐」一類的題', a1.accepted && a2.accepted && addQ(a1.pack).length > 0 && addQ(a2.pack).length > 0, { a1: a1.pack && a1.pack.questions.map(q => q.ask), a2: a2.pack && a2.pack.questions.map(q => q.ask) });
  if (a1.input) answer(W3, a1.input.packId);
  W3.shell('--type', 'rhythm', '--trigger', 'manual');
  const actors3 = ((W3.state().company || {}).actors || []).filter(a => a && a.name === '黃小姐' && a.status !== 'merged');
  const p2 = a2.input ? read(packFile(W3, a2.input.packId)) : null;
  const q2 = addQ(p2)[0];
  ok('FF-3-1 驗收 3：第一包答「加入」後，名單只有一個黃小姐', actors3.length === 1, actors3);
  // 驗收 3 原文要求另一包的「加入」題自動收起；但第二方審閱裁定 F2-1：題目有「另一個對象，加入」選項就不收起。
  // 第一包加入後，另一包的題會由 rematchOpenActorQuestions 改為「是本人／另一個對象」選擇題，所以按 F2-1 不收起。
  // 這裏核對裁定下的實際行為；與驗收 3 原文的差異已報主線，由創辦人決定。
  const modes2 = ((q2 && q2.options) || []).map(o => o.apply && o.apply.mode).filter(Boolean);
  ok('FF-3-2 驗收 3（按 F2-1 裁定）：另一包的題改為「是否同一人」，建議記為別名，未收起；名單仍只有一人', !!q2 && !q2.closed && modes2.includes('alias') && modes2.includes('add') && String(q2.value || '').includes('別名') && actors3.length === 1, q2 && { ask: q2.ask, value: q2.value, modes: modes2, closed: q2.closed || null });

  /* ---------- 驗收 5（按創辦人決定）：日期已過而沒有涵蓋的日程題保持開放 ---------- */
  const W5 = await world('expired-followup');
  const f5 = submit(W5, 'R20261101-100000-ff-f5', { date: '2026-11-01', said: '陳經理答應 11 月 5 日前提供報價。', ev: replay([{ kind: 'followUp', date: '2026-11-05', action: '陳經理提供報價', why: '對方答應在該日前提供報價。', sourceQuote: '陳經理答應 11 月 5 日前提供報價' }]) });
  W5.shell();
  const fq = f5.input ? read(packFile(W5, f5.input.packId)) : null;
  const fuQ = ((fq && fq.questions) || []).filter(q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp'));
  ok('FF-5-0 場景：出了跟進日程題（日期 11 月 5 日已過）', f5.accepted && fuQ.length > 0, { accepted: f5.accepted, qs: fq && fq.questions.map(q => q.ask) });
  ok('FF-5-1 驗收 5（反饋二 a）：沒有涵蓋的過期日程題保持開放，不自動收起', fuQ.length > 0 && fuQ.every(q => !q.closed), fuQ.map(q => q.closed || null));
  ok('FF-5-2 驗收 5：未作答前不寫入日程', !(W5.state().tasks || []).some(t => /陳經理提供報價/.test(String(t.title || ''))), (W5.state().tasks || []).map(t => t.title));
} catch (e) {
  ok('事實合併流程測試中斷', false, String(e && e.stack || e));
}

console.log(`${results.filter(r => r.pass).length}/${results.length} 通過`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
