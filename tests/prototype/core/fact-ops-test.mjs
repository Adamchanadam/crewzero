// 0.44.0 F1：事實鍵、合併器與一次性清理的純函數測試。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROTO, OUT] = process.argv.slice(2);
if (!PROTO || !OUT) {
  console.log('用法：node fact-ops-test.mjs <原型資料夾> <輸出資料夾>');
  process.exit(2);
}

const {
  factKey, openByFact, mergeProposal, closeQuestion, planCleanup, applyClosures
} = await import(pathToFileURL(path.resolve(PROTO, 'fact-ops.mjs')).href);
const { FACT_MERGE_DEFAULT, factMergeOn } = await import(pathToFileURL(path.resolve(PROTO, 'features.mjs')).href);
const { requiresFounder } = await import(pathToFileURL(path.resolve(PROTO, 'ask-lib.mjs')).href);

const results = [];
const ok = (name, pass, info = null) => {
  results.push({ name, pass: !!pass, ...(pass ? {} : { info }) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' ' + JSON.stringify(info)));
};
const state = (more = {}) => ({
  company: { assumptions: [{ id: 'a1', text: '假設甲', grade: 'guess' }, { id: 'a2', text: '假設乙', grade: 'guess' }, { id: 'a3', text: '假設丙', grade: 'guess' }], actors: [], nextExternalAction: { text: '原有動作' } },
  milestones: [{ id: 'm1', short: '第一站', state: 'open' }, { id: 'm2', short: '第二站', state: 'open' }], tasks: [],
  ...more
});
const q = (id, apply, more = {}) => ({ id, kind: 'choice', ask: more.ask || id, options: [{ text: '確認', apply }], ...more });
const pack = (id, date, questions, more = {}) => ({ id, askedAt: date + 'T09:00:00+00:00', realEvent: { inputId: 'in-' + id, date }, questions, ...more });
const assumption = (id, target, grade) => q(id, { op: 'setAssumptionGrade', id: target, grade });
const nextAction = (id, value, more = {}) => q(id, { op: 'setNextExternalAction', text: value }, more);
const actor = (id, name, more = {}) => q(id, { op: 'addActor', mode: 'add', item: { name, actorKind: 'advisor', ...(more.org ? { org: more.org } : {}) } }, more);
const followUp = (id, date, action, more = {}) => q(id, { op: 'addFollowUp', date, action, ...more });
const milestone = (id, target) => q(id, { op: 'markDone', id: target });

try {
  const oldMerge = process.env.SOS_FACT_MERGE;
  delete process.env.SOS_FACT_MERGE;
  ok('SW1 預設打開（發佈版，創辦人選 A）', FACT_MERGE_DEFAULT === true && factMergeOn() === true);
  process.env.SOS_FACT_MERGE = '1'; ok('SW2 環境值 1 開啟', factMergeOn() === true);
  process.env.SOS_FACT_MERGE = '0'; ok('SW3 環境值 0 關閉', factMergeOn() === false);
  if (oldMerge === undefined) delete process.env.SOS_FACT_MERGE; else process.env.SOS_FACT_MERGE = oldMerge;

  const keyedState = state({ company: { assumptions: [], actors: [{ id: 'p1', name: '陳經理', aliases: [] }], nextExternalAction: {} } });
  ok('FK1 假設鍵', factKey({ kind: 'assumption', id: 'a1', grade: 'said' }, keyedState) === 'assumption:a1');
  ok('FK2 下一個對外動作鍵', factKey(nextAction('q-next', '聯絡客戶'), keyedState) === 'nextAction');
  ok('FK3 已對上的日程修訂鍵', factKey({ kind: 'followUp', revisionOfTaskId: 't1', date: '2026-12-01', action: '跟進' }, keyedState) === 'task:t1');
  ok('FK4 一般日程鍵會正規化事項', factKey({ kind: 'followUp', date: '2026-12-01', action: ' 跟進，報價。 ' }, keyedState) === 'followUp:2026-12-01:跟進報價');
  ok('FK5 已對上名單的新對象鍵', factKey({ kind: 'newActor', name: '陳經理' }, keyedState) === 'actor:p1');
  ok('FK6 未對上名單的新對象鍵', factKey({ kind: 'newActor', name: '李小姐' }, keyedState) === 'actorName:李小姐');
  ok('FK7 站點完成鍵', factKey(milestone('q-m', 'm1'), keyedState) === 'milestone:m1');
  ok('FK8 收據入帳不合併', factKey({ kind: 'money', money: { amountCents: 100 } }, keyedState) === null);

  let packs = [pack('p1', '2026-11-01', [assumption('q1', 'a1', 'said')])];
  let open = openByFact(packs, {}, state());
  const two = { kind: 'assumption', id: 'a1', grade: 'did', inputId: 'in-p2' };
  const r2 = mergeProposal(two, open.get('assumption:a1'), state(), { eventDate: '2026-11-03', dateAssumed: false });
  ok('M1 較新的第二份假設建議取代第一題', r2.action === 'replace' && r2.closes.length === 1 && r2.closes[0].qId === 'q1', r2);
  packs = applyClosures(packs, r2.closes);
  packs.push(pack('p2', '2026-11-03', [assumption('q2', 'a1', 'did')]));
  open = openByFact(packs, {}, state());
  const three = { kind: 'assumption', id: 'a1', grade: 'paid', inputId: 'in-p3' };
  const r3 = mergeProposal(three, open.get('assumption:a1'), state(), { eventDate: '2026-11-05', dateAssumed: false });
  packs = applyClosures(packs, r3.closes);
  packs.push(pack('p3', '2026-11-05', [assumption('q3', 'a1', 'paid')]));
  const finalOpen = openByFact(packs, {}, state()).get('assumption:a1') || [];
  ok('M2 三份連續建議最後只留最新一題', r3.action === 'replace' && finalOpen.length === 1 && finalOpen[0].qId === 'q3' && packs.filter(item => item.questions[0].closed).length === 2, { r3, finalOpen });
  const older = mergeProposal({ kind: 'assumption', id: 'a1', grade: 'guess', inputId: 'in-old' }, finalOpen, state(), { eventDate: '2026-11-01', dateAssumed: true });
  ok('M3 假定日期不可取代實際日期的未答題', older.action === 'older' && older.note.reason.includes('假定日期'), older);
  const same = mergeProposal({ kind: 'assumption', id: 'a1', grade: 'paid', inputId: 'in-copy' }, finalOpen, state(), { eventDate: '2026-11-06', dateAssumed: false });
  ok('M4 相同內容只補記來源', same.action === 'sameAsOpen' && same.keep.qId === 'q3' && same.addSource === 'in-copy', same);
  const sameDay = mergeProposal({ kind: 'assumption', id: 'a1', grade: 'did', inputId: 'in-same-day' }, finalOpen, state(), { eventDate: '2026-11-05', dateAssumed: false });
  ok('M5 同日而建議不同時兩題並存', sameDay.action === 'replace' && sameDay.closes.length === 0, sameDay);

  const original = pack('closed', '2026-11-01', [nextAction('q-close', '聯絡客戶', { ask: '確認下一步' })]);
  const closed = closeQuestion(original, 'q-close', { status: 'superseded', reason: '較新題', by: { packId: 'new', qId: 'q-new' }, at: '2026-11-02' });
  ok('CQ1 收起不改寫題目內容', original.questions[0].closed === undefined && closed.questions[0].ask === '確認下一步' && closed !== original);
  ok('CQ2 已收起題不重複加狀態', closeQuestion(closed, 'q-close', { status: 'expired', reason: '不應覆蓋' }) === closed);

  const actorPack = pack('actor-pack', '2026-11-01', [actor('q-actor', '陳經理')]);
  const actorPlan = planCleanup({ packs: [actorPack], answers: {}, state: state({ company: { assumptions: [], actors: [{ id: 'p1', name: '陳經理', aliases: [] }], nextExternalAction: {} } }), today: '2026-11-12' });
  ok('PC1 名單已有對象的加入題標為已生效', actorPlan.closures.length === 1 && actorPlan.closures[0].status === 'applied' && actorPlan.closures[0].by.from === 'state', actorPlan);
  const fourActorPacks = ['a', 'b', 'c', 'd'].map((id, index) => pack('actor-' + id, '2026-11-0' + (index + 1), [actor('actor-' + id + '-q', '陳經理')]));
  const fourActorPlan = planCleanup({ packs: fourActorPacks, answers: {}, state: state({ company: { assumptions: [], actors: [{ id: 'p1', name: '陳經理', aliases: [] }], nextExternalAction: {} } }), today: '2026-11-12' });
  ok('PC1b 同一人四條加入題全數有涵蓋而收起', fourActorPlan.closures.length === 4 && fourActorPlan.closures.filter(row => row.status === 'superseded').length === 3 && fourActorPlan.closures.filter(row => row.status === 'applied').length === 1, fourActorPlan);

  const expiredPack = pack('expired-pack', '2026-11-01', [followUp('q-expired', '2026-11-10', '提交報價')]);
  const expiredPlan = planCleanup({ packs: [expiredPack], answers: {}, state: state(), today: '2026-11-12' });
  ok('PC2 沒有涵蓋的過期日程題保持開放', expiredPlan.closures.length === 0, expiredPlan);

  const sameDayPacks = [pack('same-a', '2026-11-10', [assumption('same-a-q', 'a1', 'said')]), pack('same-b', '2026-11-10', [assumption('same-b-q', 'a1', 'did')])];
  const sameDayPlan = planCleanup({ packs: sameDayPacks, answers: {}, state: state(), today: '2026-11-12' });
  ok('PC2b 同日不同建議清理時仍並存', sameDayPlan.closures.length === 0, sameDayPlan);

  const tonyState = state({ company: { assumptions: [], actors: [{ id: 'tony', name: 'Tony', aliases: [] }], nextExternalAction: {} } });
  const tonyPlan = planCleanup({ packs: [pack('tony-pack', '2026-11-01', [actor('tony-ho', 'Tony Ho')])], answers: {}, state: tonyState, today: '2026-11-12' });
  ok('PC2c 名單有 Tony 時 Tony Ho 不收起', tonyPlan.closures.length === 0, tonyPlan);
  const orgPacks = [pack('org-a', '2026-11-01', [actor('org-a-q', '陳先生', { org: '甲公司' })]), pack('org-b', '2026-11-02', [actor('org-b-q', '陳先生', { org: '乙公司' })])];
  const orgPlan = planCleanup({ packs: orgPacks, answers: {}, state: state(), today: '2026-11-12' });
  ok('PC2d 不同機構同名對象不互相取代', orgPlan.closures.length === 0, orgPlan);
  const alternateActor = { id: 'actor-alternate', kind: 'choice', ask: '陳經理是否同一人？', options: [{ text: '同一人', apply: { op: 'addActor', mode: 'alias', aliasOf: 'p1', item: { name: '陳經理' } } }, { text: '另一個對象，加入', apply: { op: 'addActor', mode: 'add', item: { name: '陳經理', actorKind: 'advisor' } } }] };
  const alternatePlan = planCleanup({ packs: [pack('alternate', '2026-11-01', [alternateActor])], answers: {}, state: keyedState, today: '2026-11-12' });
  ok('PC2e 有另一個對象選項的名單題不自動收起', alternatePlan.closures.length === 0, alternatePlan);

  const interview = pack('interview', '2026-11-01', [{ id: 'free', effect: 'tentative', bind: 'none' }, { id: 'now', effect: 'now', bind: 'overdue' }], { rhythm: { kind: 'interview' } });
  ok('RF1 每週訪問暫按 Zero 建議不屬必答', requiresFounder(interview, interview.questions[0]) === false);
  ok('RF2 即時生效題屬必答', requiresFounder(interview, interview.questions[1]) === true);
  const oldInterview = pack('iv-old', '2026-11-01', [q('iv-overdue-old', null, { bind: 'overdue', overdue: { milestoneId: 'm1' } }), q('iv-watch-old', null, { bind: 'watch', watch: { id: 'm1', milestoneId: 'm1' } })], { rhythm: { kind: 'interview', on: '2026-11-01' } });
  const newInterview = pack('iv-new', '2026-11-08', [q('iv-overdue-new', null, { bind: 'overdue', overdue: { milestoneId: 'm1' } })], { rhythm: { kind: 'interview', on: '2026-11-08' } });
  const interviewPlan = planCleanup({ packs: [oldInterview, newInterview], answers: {}, state: state(), today: '2026-11-12' });
  ok('PC2f 每週訪問只收起同題型同對象的舊題', interviewPlan.closures.length === 1 && interviewPlan.closures[0].qId === 'iv-overdue-old' && interviewPlan.closures[0].reasonKey === 'interview', interviewPlan);

  const scalePacks = [
    pack('s1', '2026-11-01', [assumption('s-q1', 'a1', 'said')]),
    pack('s2', '2026-11-02', [assumption('s-q2', 'a1', 'did')]),
    pack('s3', '2026-11-03', [assumption('s-q3', 'a1', 'paid')]),
    pack('s4', '2026-11-01', [nextAction('s-q4', '聯絡客戶')]),
    pack('s5', '2026-11-02', [nextAction('s-q5', '安排示範')]),
    pack('s6', '2026-11-01', [actor('s-q6', '陳經理')]),
    pack('s7', '2026-11-02', [actor('s-q7', '陳經理')]),
    pack('s8', '2026-11-01', [milestone('s-q8', 'm1')]),
    pack('s9', '2026-11-02', [milestone('s-q9', 'm1')]),
    pack('s10', '2026-11-01', [followUp('s-q10', '2026-12-01', '寄出報價')]),
    pack('s11', '2026-11-02', [followUp('s-q11', '2026-12-01', '寄出報價')]),
    pack('s12', '2026-11-03', [assumption('s-q12', 'a2', 'said')]),
    pack('s13', '2026-11-03', [milestone('s-q13', 'm2')]),
    pack('s14', '2026-11-03', [followUp('s-q14', '2026-12-02', '安排會議')]),
    pack('s15', '2026-11-03', [assumption('s-q15', 'a3', 'said')]),
    pack('general', '2026-11-03', [{ id: 'q-general', kind: 'text', ask: '一般選擇題', options: [], value: '答案' }])
  ];
  const scaleState = state({ company: { assumptions: [{ id: 'a1', grade: 'paid' }, { id: 'a2', grade: 'guess' }, { id: 'a3', grade: 'guess' }], actors: [{ id: 'p1', name: '陳經理', aliases: [] }], nextExternalAction: { text: '原有動作' } } });
  const scalePlan = planCleanup({ packs: scalePacks, answers: {}, state: scaleState, today: '2026-11-12' });
  const cleaned = applyClosures(scalePacks, scalePlan.closures);
  const remaining = planCleanup({ packs: cleaned, answers: {}, state: scaleState, today: '2026-11-12' });
  const remainingEvents = remaining.summary.mergeableEventQuestions;
  const general = cleaned.find(item => item.id === 'general').questions[0];
  ok('PC3 試用規模清理後事件題不多於八條', remainingEvents <= 8, { remainingEvents, summary: scalePlan.summary });
  ok('PC4 每條收起均有涵蓋指向', scalePlan.closures.every(row => row.by), scalePlan.closures);
  ok('PC5 其他類別題目一條不少', !general.closed && general.ask === '一般選擇題');
  ok('PC6 套用清理後重算為空', remaining.closures.length === 0, remaining);
} catch (error) {
  ok('程式本身沒有拋錯', false, String(error && error.stack || error));
}

const passed = results.filter(row => row.pass).length;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'fact-ops-results.json'), JSON.stringify({ passed, total: results.length, results }, null, 2) + '\n');
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
