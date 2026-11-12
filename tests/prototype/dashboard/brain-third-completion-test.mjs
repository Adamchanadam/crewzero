import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
const root = path.resolve(process.argv[2] || 'prototypes/proofread');
const { NAMES } = await import(pathToFileURL(path.join(root, 'ask-lib.mjs')));
const ops = await import(pathToFileURL(path.join(root, 'ledger-ops.mjs')));
const run = fs.readFileSync(path.join(root, 'run.mjs'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.mjs'), 'utf8');
const part = (text, start, end) => { const a = text.indexOf(start), b = text.indexOf(end, a); assert.ok(a >= 0 && b > a); return text.slice(a, b); };
const fixedNow = new Date('2026-11-06T12:00:00Z');
let state = { company: { assumptions: [
  { id: 'low1', grade: 'guess', milestoneIds: ['m1'], changedAt: '2026-11-01T12:00:00Z' },
  { id: 'low2', grade: 'guess', milestoneIds: ['m2'] },
  { id: 'higher', grade: 'said', milestoneIds: ['m1'] },
  { id: 'third', grade: 'guess', milestoneIds: ['m3'] },
  { id: 'old', grade: 'did', changedAt: '2026-10-09T11:59:59Z' },
  { id: 'boundary', changedAt: '2026-10-09T12:00:00Z' },
  { id: 'retired', status: 'retired', milestoneIds: ['m1'], changedAt: '2020-01-01' }
] }, milestones: [{ id: 'm3', order: 3, pathStatus: 'confirmed' }, { id: 'm2', order: 2, pathStatus: 'confirmed' }, { id: 'm1', order: 1, pathStatus: 'confirmed' }] };
const ctx = { ...ops, NAMES, Date, clockNow: () => fixedNow, loadState: () => state, listMatches: () => [], brainSource: () => null, DIR: {}, OPP_KINDS: ['政策','資助','時間窗','競爭空隙'] };
vm.createContext(ctx);
vm.runInContext(part(run, 'const opportunityTitle =', 'const checkupStale') + part(run, 'function brainLedger()', '// 創辦人上次對呢一項') + '\nthis.brainLedger=brainLedger; this.checkOpportunities=checkOpportunities; this.rejectedOpportunities=rejectedOpportunities;', ctx);
const hints = ctx.brainLedger().hints;
assert.deepEqual(Array.from(hints.lowestForNextStations), ['low1', 'low2']);
assert.deepEqual(Array.from(hints.unchanged28Days), ['old']);
state = { company: {}, milestones: [] };
assert.equal(ctx.brainLedger().hints.lowestForNextStations.length, 0);
assert.equal(ctx.brainLedger().hints.unchanged28Days.length, 0);

// 經收到準備要求的正式函數，讀回收件匣，再由外殼函數寫出 request.md。
const tmp = makeTestTemp('crewzero-ticket3-');
try {
  const inbox = path.join(tmp, 'inbox'), sb = path.join(tmp, 'sandbox');
  fs.mkdirSync(inbox); fs.mkdirSync(sb);
  const person = { id: 'P1', name: '名單對象', stage: 1, lastReal: '真事標記', milestones: [{ name: '站點標記', actor: '決策者' }], assumptions: [{ text: '假設標記', grade: '聽過' }], debrief: { text: '會後標記' }, review: [{ reason: '覆盤標記' }] };
  const oldCardMarkers = ['舊身份標記', '舊背景標記', '舊立場標記', '舊利益標記', '舊決策標記', '舊顧慮標記', '舊風格標記'];
  person.persona = Object.fromEntries(['identity','background','stance','interests','decision','concerns','style'].map((k,i) => [k, { text: oldCardMarkers[i] }]));
  const dirs = { inbox, data: tmp, company: tmp, ledger: tmp }; let sequence = 0;
  const x = { fs, path, DIR: dirs, ROOT: root, NOTE_TYPES: ['practice-prep'], counterpartsOf: () => [person], fileStamp: () => 'test' + (++sequence), U: NAMES.ui, localIso: () => '2026-11-06', getTask: () => null, loadState: () => ({ company: { actors: [{ id: 'P1', name: person.name }] } }), step() {}, newSandbox: () => sb, brainSource: () => null, writeConfirmedPage() {}, writeJSON: (p,v) => fs.writeFileSync(p, JSON.stringify(v)), runAIStep: async () => {}, NAMES };
  vm.createContext(x);
  vm.runInContext(part(server, 'function receiveNote(', 'function chatHost()') + part(run, 'async function handlePracticePrep(', 'async function handleDebrief(').split('async function finishPracticePrep(')[0] + '\nthis.receiveNote=receiveNote; this.handlePracticePrep=handlePracticePrep;', x);
  async function prepare(body) {
    const received = x.receiveNote({ type: 'practice-prep', ...body }); assert.equal(received.ok, true);
    const raw = fs.readFileSync(path.join(inbox, received.id + '-note-practice-prep.md'), 'utf8');
    const m = JSON.parse(raw.match(/```json\s*([\s\S]*?)\s*```/)[1]);
    await x.handlePracticePrep({}, m, body.text || '');
    return fs.readFileSync(path.join(sb, 'request.md'), 'utf8');
  }
  let request = await prepare({ counterpartId: 'P1', who: person.name });
  for (const marker of ['P1', NAMES.evName(NAMES.EV_KEYS[1]), '真事標記', '站點標記', '假設標記', '會後標記', '覆盤標記']) assert.ok(request.includes(marker), marker);
  for (const marker of oldCardMarkers) assert.ok(!request.includes(marker), marker);
  request = await prepare({ who: person.name });
  assert.ok(request.includes('- 對方：名單對象'));
  for (const marker of ['P1', '真事標記', '站點標記', '假設標記', '會後標記', '覆盤標記', ...oldCardMarkers]) assert.ok(!request.includes(marker), marker);

  await x.handlePracticePrep({}, { who: person.name }, '');
  assert.ok(fs.readFileSync(path.join(sb, 'request.md'), 'utf8').includes('真事標記')); // 舊收件資料沒有 counterpartId 時按名字。

  // 真正的問題包答覆處理器：跨掃描更換編號、沿用 previousId 及標題後備。
  const mem = {}, U = NAMES.ui;
  Object.assign(ctx, { U, DIR: { ledger: 'ledger' }, FEEDBACK: 'feedback', path, brainFile: () => 'opportunities', readJSON: (p, fallback) => mem[p] || fallback, writeJSON: (p,v) => { mem[p] = structuredClone(v); }, localIso: () => '2026-11-06', founderNote() {}, clip: x => x, finish: () => {} });
  vm.runInContext(part(run, 'function handleOpportunityAnswer(', '/* ---------- 公司概覽') + '\nthis.answer=handleOpportunityAnswer;', ctx);
  const answer = (id, title, previousId) => ctx.answer({}, { id: 'pack', questions: [{ id: 'q', opp: id, oppData: { title, ...(previousId ? { previousId } : {}) } }] }, { answers: { q: { value: U.oppLater } } });
  const item = { title: '機會 A', why: '原因', firstTest: '測試', source: '來源' };
  answer('first', item.title);
  assert.equal(mem[path.join('ledger', 'opportunity-decisions.json')].first.laterCount, 1);
  let out = ctx.checkOpportunities({ list: [{ ...item, previousId: 'first' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: [], knownOpportunityIds: ['first'] });
  assert.equal(out.ok, true); assert.equal(out.result.list[0].previousId, 'first');
  Object.assign(ctx, { plainOf: x => x, loadPage: () => ({}), offered: () => false, openRhythm: () => false, rhythmPack: (_name, pack) => pack, placePacks: (_dirs, packs) => packs, noteOffer() {}, log() {} });
  vm.runInContext(part(run, 'function offerOpportunities(', '// 外殼代你交要求') + '\nthis.offerOpportunities=offerOpportunities;', ctx);
  const offeredPack = ctx.offerOpportunities({ id: 'run' }, { updatedAt: 'now', list: [{ ...out.result.list[0], title: '改寫標題' }] });
  assert.equal(offeredPack.questions[0].oppData.previousId, 'first');
  offeredPack.questions[0].opp = 'second';
  ctx.answer({}, offeredPack, { answers: { o1: { value: U.oppLater } } });
  const decisions = mem[path.join('ledger', 'opportunity-decisions.json')];
  assert.equal(decisions.second.laterCount, 2);
  answer('second', '改寫標題', 'first'); assert.equal(mem[path.join('ledger', 'opportunity-decisions.json')].second.laterCount, 2);
  const rejected = ctx.rejectedOpportunities(decisions);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '再改寫', previousId: 'first' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejected }).ok, false);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '再改寫', previousId: ' first ' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejected }).ok, false);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, previousId: 'second' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejected }).ok, false);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '  改寫標題  ' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejected }).ok, false);
  answer('third', '  全形Ａ  '); answer('fourth', '全形A');
  assert.equal(mem[path.join('ledger', 'opportunity-decisions.json')].fourth.laterCount, 2);
  const rejectedByTitle = ctx.rejectedOpportunities(mem[path.join('ledger', 'opportunity-decisions.json')]);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: ' 全形ａ ' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejectedByTitle }).ok, false);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '其他機會' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejected }).ok, true);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '改寫標題', previousId: 'different' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: rejected }).ok, false);
  ctx.answer({}, { id: 'pack', questions: [{ id: 'q', opp: 'dropped', oppData: { title: '不能再提' } }] }, { answers: { q: { value: U.oppDrop } } });
  const allRejected = ctx.rejectedOpportunities(mem[path.join('ledger', 'opportunity-decisions.json')]);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '不能再提', previousId: 'not-a-real-id' }] }, '2026-11-06', { rejectedOpportunities: allRejected }).ok, false);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '不能再提', previousId: 'first' }] }, '2026-11-06', { rejectedOpportunities: allRejected, knownOpportunityIds: ['first'] }).ok, false);
  assert.equal(ctx.checkOpportunities({ list: [{ ...item, title: '全形Ａ', previousId: 'not-a-real-id' }] }, '2026-11-06', { rejectedOpportunities: allRejected }).ok, false);
  answer('fifth', '全形Ａ', 'not-a-real-id');
  const fifth = mem[path.join('ledger', 'opportunity-decisions.json')].fifth;
  assert.equal(fifth.laterCount, 3); assert.equal(fifth.previousId, 'fourth');
  out = ctx.checkOpportunities({ list: [{ ...item, title: '新機會', previousId: 'not-a-real-id' }] }, '2026-11-06', { knownOpportunityIds: ['first'] });
  assert.equal(out.ok, true); assert.equal(Object.hasOwn(out.result.list[0], 'previousId'), false);
  out = ctx.checkOpportunities({ list: [{ ...item, title: '新機會', previousId: 'last-result' }] }, '2026-11-06', { knownOpportunityIds: ['last-result'] });
  assert.equal(out.result.list[0].previousId, 'last-result');
} finally { assertTestOut(tmp); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('PASS 工作票 3 補完：hints、準備要求、暫不次數');
