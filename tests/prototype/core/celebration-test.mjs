// Exercise the actual confirmation handlers without starting a server or spawning AI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const root = new URL('../../../prototypes/proofread/', import.meta.url);
const source = fs.readFileSync(new URL('run.mjs', root), 'utf8');
const NAMES = createRequire(import.meta.url)(new URL('names.js', root).pathname.replace(/^\/(\w:)/, '$1'));
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
let state, sim = false;
const context = vm.createContext({ NAMES, randomUUID, isSim: () => sim, stamp: () => '20261105-000000', localIso: () => '2026-11-05T00:00:00+00:00', clip: (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s,
  loadState: () => state, saveState: () => {}, finish: () => {}, ensureActive: () => {}, replySubmittedAt: () => '', founderUpdatedAfter: () => false,
  dayText: x => x, todayIso: () => '2026-11-05', writeInterviewRecord: () => {}, step: () => {}, U: { interviewTitle: '訪問' }, ADVANCED: false });
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
