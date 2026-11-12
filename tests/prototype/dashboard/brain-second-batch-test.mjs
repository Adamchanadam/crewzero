// 無伺服器反例：直接核對實際驗證器，假 AI 缺陷模式在整合測試可重用。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(process.argv[2] || 'prototypes/proofread');
const d = await import(pathToFileURL(path.join(root, 'debate-lib.mjs')));
const { webAccess } = await import(pathToFileURL(path.join(root, 'host-lib.mjs')));
const { NAMES } = await import(pathToFileURL(path.join(root, 'ask-lib.mjs')));
const ops = await import(pathToFileURL(path.join(root, 'ledger-ops.mjs')));
const ledger = { assumptions: [{ id: 'H1', grade: 'guess' }] };
const blueRaw = { thesis: '主張', claims: [{ id: 'B1', claim: '甲', evidence: 3, assumptionIds: ['H1'] }, { id: 'B2', claim: '乙' }], sources: [{ n: 1, title: '來源', url: 'https://example.com/', readOn: '2026-11-06' }], aiChecked: [{ finding: '發現', label: 'fact', sources: [{ title: '來源', url: 'https://example.com/', readOn: '2026-11-06' }] }] };
let r = d.checkBlue(blueRaw, { ledger });
assert.equal(r.data.claims[0].evidence, 0); assert.ok(r.warnings.length);
const missing = d.checkBlue({ ...blueRaw, claims: [{ id: 'B1', claim: '甲', evidence: 2, assumptionIds: ['H99'] }] }, { ledger });
assert.deepEqual(missing.data.claims[0].assumptionIds, []); assert.equal(missing.data.claims[0].evidence, 0); assert.ok(missing.warnings.length >= 2);
r = d.checkBlue(blueRaw, { ledger, access: 'none' });
assert.equal(r.data.sources[0].url, ''); assert.equal(r.data.aiChecked[0].label, 'observation');
const blue = r.data;
const redRaw = { blindAttacks: ['未被考慮的風險'], attacks: [{ id: 'R1', claimId: 'B1', persona: '甲', attack: '攻擊' }], seats: [{ persona: '甲', interests: '利益', fears: '失去', criteria: '準則', changeMind: '轉變', source: '網上' }] };
r = d.checkRed(redRaw, blue, ['甲']); assert.equal(r.ok, false); assert.match(r.warnings.join(), /未被攻擊/);
r = d.checkRed(redRaw, blue, ['甲'], [], { allowIncomplete: true }); assert.equal(r.ok, true); assert.equal(r.data.seats[0].source, 'Zero 解讀');
assert.equal(d.checkRed({ ...redRaw, blindAttacks: [] }, blue, ['甲'], [], { allowIncomplete: true }).ok, false);
const extraRed = d.checkRed({ ...redRaw, blindAttacks: ['一', '二', '三', '四'], suggestedSeat: { name: '甲'.repeat(80), why: '乙'.repeat(80) } }, blue, ['甲'], [], { allowIncomplete: true });
assert.equal(extraRed.data.blindAttacks.length, 3); assert.equal(extraRed.data.suggestedSeat.name.length, 40); assert.equal(extraRed.data.suggestedSeat.why.length, 40);
const judge = { verdicts: blue.claims.map(c => ({ claimId: c.id, verdict: '受傷', reason: '外部 [2]' })), attackVerdicts: [], topRisks: [{ risk: '風險' }], factChecks: [{ n: 1, ok: true }] };
r = d.checkJudge(judge, blue, r.data, { ledger, access: 'search' }); assert.ok(r.data.factChecks.some(f => f.n === 2 && !f.ok)); assert.ok(r.data.factChecks.every(f => !f.ok && f.note === '只經搜尋摘要'));
const text = fs.readFileSync(path.join(root, 'run.mjs'), 'utf8');
const part = (a,b) => text.slice(text.indexOf(a), text.indexOf(b));
// 實際回合控制：格式錯誤不退回；覆蓋不足最多退回一次，兩次啟動均計入上限。
async function redPass(outputs, starts = 0, alreadyRetried = false, costs = []) {
  let calls = 0, current;
  const match = { id: 'D', next: 'red', topic: { title: '測試' }, roles: { red: { personas: ['甲'] } }, budget: { aiStarts: starts, ...(alreadyRetried ? { redCoverageRetry: 1 } : {}) }, warnings: [], webAccess: 'search+read' };
  const ctx = { fs: { mkdirSync() {}, writeFileSync() {} }, path, HARD_CAP: d.HARD_CAP, PASS_OUT: { red: 'red.json' }, PASS_ROLE: { red: 'red' }, U: {}, DIR: {},
    step() {}, log() {}, clip: x => x, localIso: () => 'now', saveMatch() {}, finish: (_run, state, reason) => ({ state, reason }),
    debateSandbox: () => 'sb', runAI: async (_sb, options) => { if (!options.onStart()) return { ok: false }; current = outputs[calls]; const cost = costs[calls++]; return { ok: true, webAccess: 'search+read', ...(cost === undefined ? {} : { meta: { total_cost_usd: cost, duration_ms: 100 } }) }; },
    readJSON: p => p.endsWith('ledger.json') ? ledger : current, brainSource: () => ({}), matchDir: () => 'match',
    readMatchFile: (_dir, _src, _id, name) => name === 'blue.json' ? blue : null, loadState: () => ({ company: {} }), checkRed: d.checkRed,
    writeJSON: p => { if (p.endsWith('red.json')) throw new Error('accepted'); } };
  ctx.markBrokenLinks = async e => e; vm.createContext(ctx); vm.runInContext(part('async function runDebatePass(', 'function handleDebateAnswer(') + '\nthis.runDebatePass = runDebatePass;', ctx);
  const run = {}; let result; try { result = await ctx.runDebatePass(run, match); } catch (e) { if (e.message !== 'accepted') throw e; result = { state: 'accepted' }; }
  return { calls, match, result, run };
}
const malformed = await redPass([{}]);
assert.equal(malformed.calls, 1); assert.equal(malformed.result.state, 'failed'); assert.equal(malformed.match.next, '');
const incomplete = await redPass([redRaw, redRaw]);
assert.equal(incomplete.calls, 2); assert.equal(incomplete.match.budget.aiStarts, 2); assert.equal(incomplete.result.state, 'accepted');
assert.equal(incomplete.match.budget.redCoverageRetry, 1);
const costed = await redPass([redRaw, redRaw], 0, false, [0.25, 0.50]);
assert.equal(costed.match.budget.usd, 0.75); assert.equal(costed.run.aiCost.usd, 0.75); assert.equal(costed.run.aiCost.ms, 200); assert.equal(costed.match.budget.aiStarts, 2);
const rerun = await redPass([redRaw], 2, true);
assert.equal(rerun.calls, 1); assert.equal(rerun.match.budget.aiStarts, 3); assert.equal(rerun.result.state, 'failed');
const cap = await redPass([redRaw], d.HARD_CAP - 1);
assert.equal(cap.calls, 1); assert.equal(cap.match.budget.aiStarts, d.HARD_CAP); assert.equal(cap.result.state, 'failed');
// 以真實 runAI 及 runDebatePass 串接記憶體宿主，檢查寫出的裁判結果。
async function judgePass(opening, host) {
  const saved = {};
  const match = { id: 'D', next: 'judge', topic: { title: '測試' }, roles: { judge: {} }, budget: { aiStarts: 0 }, warnings: [], ...opening };
  const ctx = { fs: { existsSync: () => false, readFileSync: () => '', mkdirSync() {}, writeFileSync() {}, appendFileSync() {}, utimesSync() {} }, path,
    ROOT: 'root', DIR: { ledger: 'ledger' }, LOCK: 'lock', STARTS: 'starts', certified: () => ({ host }), webAccess,
    execute: async (actual, _sb, _unused, options) => { assert.equal(actual, host); assert.equal(options.onStart({}), true); return { ok: true }; },
    budgetLeft: () => 1, setInterval, clearInterval, openUnknowns: () => [], HARD_CAP: d.HARD_CAP, PASS_OUT: { judge: 'judge.json' }, PASS_ROLE: { judge: 'judge' }, U: {},
    step() {}, log() {}, clip: x => x, localIso: () => 'now', saveMatch() {}, finish: () => ({}), debateSandbox: () => 'sb',
    readJSON: p => p.endsWith('ledger.json') ? ledger : judge, brainSource: () => ({}), matchDir: () => 'match',
    readMatchFile: (_dir, _src, _id, name) => name === 'blue.json' ? blue : { attacks: [] }, checkJudge: d.checkJudge,
    writeJSON: (p, value) => { if (p.endsWith('judge.json')) { saved.judge = value; throw new Error('saved'); } } };
  ctx.markBrokenLinks = async e => e; vm.createContext(ctx);
  vm.runInContext(part('function runAI(', 'function checkReceipt(') + part('async function runDebatePass(', 'function handleDebateAnswer(') + '\nthis.runDebatePass = runDebatePass;', ctx);
  try { await ctx.runDebatePass({}, match); } catch (e) { if (e.message !== 'saved') throw e; }
  return saved.judge.factChecks.find(f => f.n === 1).ok;
}
assert.equal(await judgePass({ webAccess: 'search' }, { id: 'codex', args: ['web_search="live"'] }), false);
assert.equal(await judgePass({ webAccess: 'search+read' }, { id: 'agy', webAccess: 'search' }), false);
assert.equal(await judgePass({ web: true }, { id: 'agy', webAccess: 'search' }), false);
assert.equal(await judgePass({ webAccess: 'search+read' }, { id: 'codex', args: ['web_search="live"'] }), true);
const checkedFact = blueRaw.aiChecked[0];
for (const sources of [[null], [{ url: 'https://example.com/' }], [42, { title: '無網址' }]]) {
  const j = d.checkJudge({ ...judge, sources, aiChecked: [checkedFact], topRisks: [{ risk: '風險', aiChecked: [checkedFact] }] }, blue, { attacks: [] });
  assert.equal(j.data.sources.length, 0); assert.equal(j.data.aiChecked[0].label, 'observation'); assert.equal(j.data.topRisks[0].aiChecked[0].label, 'observation');
  const cards = d.checkStrengthen({ sources, cards: [{ id: 'T1', from: { claimIds: ['B1'] }, handling: '先驗證', test: { what: '測試', stop: '停止', aiChecked: [checkedFact] } }] }, { rows: [{ claim: { id: 'B1' }, attacks: [], verdict: { verdict: '受傷' } }] });
  assert.equal(cards.ok, true); assert.equal(cards.data.cards[0].test.aiChecked[0].label, 'observation');
}
const c = { ...ops, NAMES, Date, OPP_KINDS: ['政策','資助','時間窗','競爭空隙'] }; vm.createContext(c);
vm.runInContext(part('const opportunityTitle =', 'const checkupStale') + part('function checkCheckup(', '// 一次工作入面加一步') + '\nthis.checkOpportunities=checkOpportunities; this.checkCheckup=checkCheckup;', c);
assert.equal(c.checkCheckup({ weak: [{ assumptionId: 'H99' }] }, ledger, '2026-11-06').invalidAssumption, true);
const industry = { text: '反審', source: '來源', url: 'https://example.com/a', readOn: '2026-11-06' };
const checkRaw = { weak: [{ assumptionId: 'H1', title: '弱位', why: '原因', cheapestTest: '測試' }], industryCheck: [industry, { ...industry, url: 'http://example.com/' }] };
assert.equal(c.checkCheckup(checkRaw, { ...ledger, webAccess: 'none' }, '2026-11-06').result.industryCheck.length, 0);
assert.equal(c.checkCheckup(checkRaw, { ...ledger, webAccess: 'search' }, '2026-11-06').result.industryCheck.length, 1);
assert.match(c.checkCheckup(checkRaw, { ...ledger, webAccess: 'search' }, '2026-11-06').result.industryCheck[0].source, /只經搜尋摘要/);
const item = { title: '機會', why: '理由', firstTest: '測試', source: '資料', windowDate: '2026-11-05' };
assert.equal(c.checkOpportunities({ list: [{ ...item, windowDate: '', previousId: 'old' }] }, '2026-11-06', { counterparts: [], rejectedOpportunities: [{ id: 'old', title: '舊機會' }] }).ok, false);
assert.equal(c.checkOpportunities({ list: [item] }, '2026-11-06', { counterparts: [] }).ok, false);
assert.equal(c.checkOpportunities({ list: [{ ...item, windowDate: '2026-11-07', counterpartId: 'a' }] }, '2026-11-06', { counterparts: [{ id: 'a' }] }).result.list[0].counterpartId, 'a');
const tmp = makeTestTemp('crewzero-second-batch-');
try {
  fs.mkdirSync(path.join(tmp, 'out')); fs.mkdirSync(path.join(tmp, 'example'));
  for (const name of ['blue.json', 'red.json', 'judge.json', 'rebuttal.json', 'strengthen.json']) fs.copyFileSync(path.join(root, 'fixtures/demo-shop/brain/wargame', name), path.join(tmp, 'example', name));
  fs.copyFileSync(path.join(root, 'fixtures/demo-shop/practice/roaster-c.json'), path.join(tmp, 'example-scenario.json'));
  fs.writeFileSync(path.join(tmp, 'task.md'), '測試\n'); fs.writeFileSync(path.join(tmp, 'topic.md'), '題目：測試\n'); fs.writeFileSync(path.join(tmp, 'request.md'), '對方：測試\n');
  fs.writeFileSync(path.join(tmp, 'ledger.json'), JSON.stringify({ ...ledger, counterparts: [] }));
  const fake = fileURLToPath(new URL('../lib/fake-ai.mjs', import.meta.url));
  const generate = (type, mode, file) => {
    fs.writeFileSync(path.join(tmp, 'job.json'), JSON.stringify({ type, seats: ['甲'], today: '2026-11-06' }));
    fs.writeFileSync(path.join(tmp, 'fake-mode.txt'), type + ':' + mode + '\n');
    const p = spawnSync(process.execPath, [fake], { cwd: tmp, env: { ...process.env, SOS_DATA: tmp }, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr); assert.equal(fs.existsSync(path.join(tmp, 'fake-mode.txt')), false);
    return JSON.parse(fs.readFileSync(path.join(tmp, 'out', file), 'utf8'));
  };
  const exampleBlue = JSON.parse(fs.readFileSync(path.join(tmp, 'example', 'blue.json'), 'utf8'));
  const matchingLedger = { assumptions: exampleBlue.claims.slice(0, 4).map((claim, i) => ({ id: 'H' + (i + 1), text: claim.claim, grade: ['said', 'did', 'did', 'guess'][i] })) };
  fs.writeFileSync(path.join(tmp, 'ledger.json'), JSON.stringify(matchingLedger));
  const normalBlue = generate('debate-blue', 'normal', 'blue.json');
  assert.deepEqual(normalBlue.claims.slice(0, 4).map(c => c.assumptionIds[0]), ['H1', 'H2', 'H3', 'H4']);
  assert.deepEqual(d.checkBlue(normalBlue, { ledger: matchingLedger }).data.claims.map(c => c.evidence), normalBlue.claims.map(c => c.evidence));
  fs.writeFileSync(path.join(tmp, 'ledger.json'), JSON.stringify(ledger));
  let b = generate('debate-blue', 'evidence-high', 'blue.json'); assert.equal(d.checkBlue(b, { ledger }).data.claims[0].evidence, 0);
  b = generate('debate-blue', 'fact-offline', 'blue.json'); r = d.checkBlue(b, { ledger, access: 'none' }); assert.equal(r.data.sources[0].url, ''); assert.equal(r.data.aiChecked[0].label, 'observation');
  fs.writeFileSync(path.join(tmp, 'blue.json'), JSON.stringify(b));
  const skip = generate('debate-red', 'skip-half', 'red.json'); assert.equal(d.checkRed(skip, b, ['甲']).ok, false); assert.ok(d.checkRed(skip, b, ['甲'], [], { allowIncomplete: true }).warnings.some(x => x.includes('未被攻擊')));
  const red = generate('debate-red', 'seat-source-bad', 'red.json'); assert.equal(d.checkRed(red, b, ['甲'], [], { allowIncomplete: true }).data.seats[0].source, 'Zero 解讀');
  const j = generate('debate-judge', 'uncited-fact', 'judge.json'); assert.ok(d.checkJudge(j, b, red, { access: 'search' }).data.factChecks.some(f => f.n === 99 && f.ok === false));
  const ck = generate('checkup', 'bad-assumption', 'checkup.json'); assert.equal(c.checkCheckup(ck, ledger, '2026-11-06').invalidAssumption, true);
  const opp = generate('opportunities', 'past-window', 'opportunities.json'); assert.ok(c.checkOpportunities(opp, '2026-11-06', { counterparts: [] }).result.list.every(o => o.windowDate !== '2000-01-01'));
  const sc = generate('practice-prep', 'source-bad', 'scenario.json'); assert.equal(sc.persona.stance.source, '我估');
  const pc = { fs, path, NAMES, PRACTICE_DIR: path.join(tmp, 'scenarios'), readJSON: p => JSON.parse(fs.readFileSync(p, 'utf8')), writeJSON: (p, v) => fs.writeFileSync(p, JSON.stringify(v)), stamp: () => 'test', localIso: () => '2026-11-06', getTask: () => null, upsertTask() {}, step() {}, finish() {} };
  pc.markBrokenLinks = async e => e; pc.markSource = (t, e, access) => t + (access === 'search' ? NAMES.ui.sourceSearchOnly : ops.fullTextSuffix(e, NAMES.ui.sourceSearchOnly)); vm.createContext(pc); vm.runInContext(part('async function finishPracticePrep(', 'async function handleDebrief(') + '\nthis.finishPracticePrep=finishPracticePrep;', pc);
  const practiceRun = {}; await pc.finishPracticePrep(practiceRun, tmp, '測試');
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'scenarios', 'Stest.json'))).persona.stance.source, 'Zero 解讀'); assert.ok(practiceRun.result.warnings.length);
} finally { assertTestOut(tmp); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('PASS 第二批無伺服器機械核對反例');
