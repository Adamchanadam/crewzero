// Exercise the actual confirmation handlers without starting a server or spawning AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const root = new URL('../../../prototypes/proofread/', import.meta.url);
const source = fs.readFileSync(new URL('run.mjs', root), 'utf8');
const NAMES = createRequire(import.meta.url)(new URL('names.js', root).pathname.replace(/^\/(\w:)/, '$1'));
const ops = await import(new URL('ledger-ops.mjs', root).href);
const people = await import(new URL('people-ops.mjs', root).href);
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let state, sim = false;
const context = vm.createContext({ factMergeOn: () => false, NAMES, randomUUID, isSim: () => sim, stamp: () => '20261105-000000', localIso: () => '2026-11-05T00:00:00+00:00', clip: (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s,
  loadState: () => state, saveState: () => {}, finish: () => {}, ensureActive: () => {}, replySubmittedAt: () => '', founderUpdatedAfter: () => false,
  dayText: x => x, todayIso: () => '2026-11-05', writeInterviewRecord: () => {}, step: () => {}, U: { interviewTitle: '訪問', ...NAMES.ui }, mergeInPlace: ops.mergeInPlace, applyNewActor: people.applyNewActor, applyActorOp: people.applyActorOp, resolveActorId: people.resolveActorId, pnorm: people.norm, nameKeys: people.nameKeys, addDays: (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }, addEffect: ops.addEffect, applyFollowUp: ops.applyFollowUp, followUpTaskId: ops.followUpTaskId, ADVANCED: false,
  readJSON: (_f, fallback) => fallback, DIR: { company: '' }, path: { join: (...parts) => parts.join('/') }, deriveActors: () => [], loadPage: () => null,
  // 0.44.0 handleEventConfirm 寫入前按日期再判斷（keepDatedWrite）及名單重新比對：用 ledger-ops／people-ops 的真函數（與 run.mjs 匯入一致）
  recordBasis: ops.recordBasis, compareByDate: ops.compareByDate, newestEventDate: ops.newestEventDate, matchActorName: people.matchActorName, nextActorId: people.nextActorId });
vm.runInContext(part('const EV_RANK =', 'async function handleEvent('), context);
vm.runInContext(part('function handleEventConfirm(', '/* ---------- 深化站點'), context);
vm.runInContext(part('function handleInterviewAnswer(', 'function writeInterviewRecord('), context);
const fresh = () => ({ company: { assumptions: [{ id: 'a', text: '假設甲', grade: 'guess' }, { id: 'b', text: '假設乙', grade: 'guess' }] }, milestones: [{ id: 'm1', short: '第一站', state: 'active', pathStatus: 'confirmed', order: 1 }, { id: 'm2', short: '第二站', state: 'pending', pathStatus: 'confirmed', order: 2 }, { id: 'm3', short: '第三站', state: 'pending', pathStatus: 'confirmed', order: 3 }], inputs: [] });
let serial = 0;
function confirm(changes) {
  const id = 'input' + ++serial;
  state.inputs.push({ id, file: '', files: [] });
  const questions = changes.map((c, i) => ({ id: 'q' + i, options: [{ text: 'yes', apply: c }] }));
  const answers = Object.fromEntries(questions.map(q => [q.id, { value: 'yes' }]));
  context.handleEventConfirm({}, { id: 'pack' + serial, realEvent: { inputId: id, date: '2026-11-05' }, questions }, { answers });
  return state.celebrations?.entries.at(-1);
}
const grade = (id, grade) => ({ op: 'setAssumptionGrade', id, grade });
const done = id => ({ op: 'markDone', id });
state = fresh(); let e = confirm([grade('a', 'said')]);
assert.equal(e.level, 'top'); assert.equal(e.kind, 'first-external'); assert.equal(e.gradeName, NAMES.evName('said')); assert.equal(e.nextGradeName, NAMES.evName('did'));
assert.equal(confirm([grade('b', 'said')]).level, 2);
assert.equal(confirm([grade('a', 'paid')]).kind, 'first-paid'); assert.equal(confirm([grade('b', 'paid')]).level, 2);
state = fresh(); e = confirm([grade('a', 'paid')]); assert.equal(e.kind, 'first-paid'); assert.equal(state.celebrations.kinds['first-external'], true); assert.equal(state.celebrations.kinds['first-paid'], true); assert.equal(confirm([grade('b', 'said')]).level, 2);
state = fresh(); e = confirm([done('m1')]); assert.equal(e.kind, 'first-milestone'); assert.equal(e.nextStage, '第二站'); e = confirm([done('m2')]); assert.equal(e.level, 3); assert.equal(e.nextStage, '第三站');
state = fresh(); state.company.assumptions[0].grade = 'said'; confirm([grade('a', 'said'), grade('a', 'guess')]); assert.equal(state.celebrations, undefined);
state = fresh(); state.company.assumptions[0].grade = 'paid'; assert.equal(confirm([grade('b', 'paid')]).level, 2);
state = fresh(); state.demo = true; assert.equal(confirm([grade('a', 'said')]).level, 'top');
state = fresh(); sim = true; confirm([grade('a', 'said')]); assert.equal(state.celebrations, undefined); sim = false;
state = fresh(); e = confirm([grade('a', 'said'), done('m1')]); assert.equal(state.celebrations.entries.length, 1); assert.equal(e.level, 'top'); assert.equal(e.also[0], '第一站'); assert.equal(state.celebrations.kinds['first-milestone'], true);
state = fresh(); e = confirm([grade('a', 'stuck')]); assert.equal(e.kind, 'first-stuck'); assert.equal(e.nextGradeName, ''); assert.equal(Object.keys(state.celebrations.kinds).length, 3);
state = fresh(); state.interviews = { lastFor: '2026-11-05' };
const q = { id: 'q', bind: 'assume', options: [{ text: 'yes', apply: grade('a', 'said') }] };
context.handleInterviewAnswer({}, { id: 'weekly', rhythm: { on: '2026-11-05' }, questions: [q] }, { answers: { q: { value: 'yes' } } }, new Set(['q']));
assert.equal(state.celebrations.entries[0].kind, 'first-external');
state = fresh(); state.celebrations = { entries: [], kinds: { 'first-external': true, 'first-paid': true, 'first-stuck': true, 'first-milestone': true } };
for (let i = 0; i < 55; i++) { state.company.assumptions[0].grade = 'guess'; confirm([grade('a', 'said')]); }
assert.equal(state.celebrations.entries.length, 50); assert.equal(new Set(state.celebrations.entries.map(x => x.id)).size, 50);
// 0.40.0 十四日跟進題的答案：一星期內聯絡＝新增創辦人工作；暫時維持＝兩星期後再問；不再接觸＝不再接觸；對象已不是有效對象時只記錄
const keepState = state;
const contactAnswer = (idx, setup) => {
  state = fresh(); state.company.actors = [{ id: 'p1', name: '甲餐廳陳經理', kind: 'customer', status: 'active', aliases: [], fromMilestoneIds: [] }]; if (setup) setup(state); state.interviews = { lastFor: '2026-11-05' };
  const texts = [NAMES.t('contactYes', { n: '甲餐廳陳經理' }), NAMES.ui.contactSnooze, NAMES.ui.contactClose];
  const q = { id: 'contact', bind: 'contact', contact: { id: 'p1' }, options: texts.map(text => ({ text })) };
  context.handleInterviewAnswer({}, { id: 'wk', rhythm: { on: '2026-11-05' }, questions: [q] }, { answers: { contact: { value: texts[idx] } } }, new Set(['contact']));
};
contactAnswer(0);
assert.equal(state.tasks.length, 1); assert.equal(state.tasks[0].owner, 'founder'); assert.equal(state.tasks[0].dueAt, '2026-11-12'); assert.equal(state.tasks[0].prospectId, 'p1'); assert.equal(state.tasks[0].title, '聯絡甲餐廳陳經理'); assert.equal(state.company.actors[0].status, 'active');
contactAnswer(1); assert.equal(state.interviews.contactSnooze.p1, '2026-11-19'); assert.equal((state.tasks || []).length, 0);
contactAnswer(2); assert.equal(state.company.actors[0].status, 'inactive'); assert.equal((state.tasks || []).length, 0); assert.equal(state.company.actors[0].name, '甲餐廳陳經理');
contactAnswer(0, st => { st.company.actors[0].status = 'inactive'; }); assert.equal((state.tasks || []).length, 0);
contactAnswer(0, st => { st.company.actors.push({ id: 'p2', name: '乙', kind: 'customer', status: 'active', aliases: [], mergedInto: 'p1', fromMilestoneIds: [] }); st.company.actors[0].mergedInto = 'p2'; st.company.actors[0].status = 'active'; }); assert.equal((state.tasks || []).length, 0);
state = keepState;
const serverSource = fs.readFileSync(new URL('server.mjs', root), 'utf8');
let seenFile = null;
const serverContext = vm.createContext({ DIR: { ledger: 'ledger' }, path: { join: (...x) => x.join('/') }, readJSON: (file, fallback) => file.endsWith('state.json') ? state : seenFile || fallback, writeJSON: (file, value) => { seenFile = value; } });
vm.runInContext(serverSource.slice(serverSource.indexOf('const CELEBRATIONS_SEEN ='), serverSource.indexOf('function statusPayload()')), serverContext);
const id = state.celebrations.entries.at(-1).id;
assert.equal(serverContext.claimCelebration('missing')[0], 400); assert.equal(serverContext.claimCelebration(1)[0], 400);
assert.equal(serverContext.claimCelebration(id)[1].claimed, true); assert.equal(serverContext.claimCelebration(id)[1].claimed, false);
// 內部工作不是真實事件：不慶祝，也不佔用「第一個里程碑」
state = fresh(); state.milestones.find(m => m.id === 'm1').kind = 'task';
assert.equal(confirm([done('m1')]), undefined);
assert.equal(confirm([done('m2')]).kind, 'first-milestone');
console.log('PASS celebration confirmation and weekly interview cases');
