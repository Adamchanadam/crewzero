// 0.44.0 按日期逐項判斷（P 線）流程測試：直接叫 run.mjs，用假 AI 重播（<SOS_DATA>/replay-event.json），不開伺服器、不開瀏覽器。
// 規格：docs/evidence/event-date-precedence-2026-11-12/fable-analysis.md；裁決及驗收清單：docs/evidence/journey-0440/dispatch/p-plan.md（「協調會話裁決」一節優先）。
// 檢查分兩類：「場景」＝現況已成立、實作後仍成立，證明場景造得正確；其餘為功能檢查，未實作前應失敗。
// 每次送出都寫明日期（機讀區 date）；date 為 null 才是「沒有提供日期」的事件。
// 用法：node date-precedence-flow-test.mjs <原型資料夾> <輸出資料夾> [port（不使用）]
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
const minutes = await imp('minutes-lib.mjs');
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const U = N.ui, T = (key, values) => N.t(key, values);
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 900))); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readText = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const dayText = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[2]} 月 ${+m[3]} 日` : ''; };
const isoDay = date => date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
const plusDays = n => isoDay(new Date(Date.now() + n * 86400000));
// 放入文件第 3 種情況：創辦人原話寫明是現行資料時，Zero 交回原話引句的欄名。ai-event.md 由 P2 定稿；欄名不同時只改這一行。
const DOC_CURRENT_FIELD = 'currentQuote';
let seq = 0;

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });
const adapters = writeAdapters(path.join(OUT, 'adapters'));
const fake = read(adapters.fake);
fake.args = [path.join(HERE, '..', 'lib', 'fake-ai.mjs')];
const ADAPTER = path.join(OUT, 'adapters', 'date-precedence-fake.json');
fs.writeFileSync(ADAPTER, JSON.stringify(fake, null, 2));

/* ---------- 測試世界（做法同 minutes-run-test.mjs 的 world()） ---------- */
async function world(name) {
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
  s.company = s.company || {}; s.company.actors = [{ id: 'pc-1', name: '陳經理', kind: 'partner', role: '採購' }];
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' }; save(s);
  process.env.SOS_DATA = data;
  const DIR = lib.dataDirs(PROTO);
  return { name, data, DIR, shell, state, save, mode: text => fs.writeFileSync(path.join(data, 'fake-mode.txt'), text + '\n') };
}
const runsOf = W => { try { return read(path.join(W.DIR.ledger, 'status.json')).runs || []; } catch { return []; } };
const packs = W => { try { return fs.readdirSync(W.DIR.asks).filter(f => f.endsWith('.json')).map(f => read(path.join(W.DIR.asks, f))); } catch { return []; } };
const packFile = (W, id) => path.join(W.DIR.asks, id + '.json');
const inputOf = (W, ref) => (W.state().inputs || []).find(x => x.id === 'in-' + ref) || null;
const assumption = (W, id) => ((W.state().company || {}).assumptions || []).find(a => a.id === id) || {};

// 重播用的 event.json：summary 每次唯一，用來證明今次交回的內容已被外殼接受（recordReading 寫入 input.summary）
// tag 只作程式內辨認；summary 只用序號（「m1」「H1」一類字樣會被外殼改寫為站名，不能放入 summary）
let replaySeq = 0;
function replay(tag, items, extra = {}) {
  return { summary: '測試重播第 ' + (++replaySeq) + ' 件。', grade: 'said', read: { summary: 'Zero 讀了創辦人原話及附件，對照了現有假設、日程及下一個對外動作。', highlights: [] }, contrasts: [], items, ...(items.length ? {} : { reason: '這件事只是確認既有安排，沒有改變任何假設、站點或下一個對外動作。' }), ...extra };
}
// 會議紀錄正文：有標示說明行及「參加者」（陳經理），外殼才當作 CrewZero 會議紀錄並寫 context.md
function minuteBody(title, date, { facts = [], says = [], decide = [], todos = [] } = {}) {
  const or = rows => rows.length ? rows : ['- 沒有。'];
  return ['# 會議紀錄：' + title + '（' + date + '）', '> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 0 處）', '', '## 參加者', '', '創辦人、陳經理。', '',
    '## 已發生的事實', '', ...or(facts), '', '## 對方的說法及承諾', '', ...or(says), '', '## 雙方決定', '', ...or(decide), '', '## 待辦', '', ...or(todos), '', '## 未定事項', '', '- 仍待確認。', ''].join('\n');
}
// 送出一件事：先重寫 replay-event.json，再寫收件匣筆記（機讀區 date 必須寫明；null＝沒有提供日期），然後跑一次外殼
function submit(W, ref, { date, dateAssumed = false, said = '記錄一件事。', type = 'event', minute = null, meta = null, doc = null, ev }) {
  if (date === undefined) throw new Error('submit 必須寫明 date（沒有日期用 null）：' + ref);
  const replayFile = path.join(W.data, 'replay-event.json');
  if (ev) fs.writeFileSync(replayFile, JSON.stringify(ev, null, 2)); else fs.rmSync(replayFile, { force: true });
  const machine = { ...(date ? { date } : {}), ...(dateAssumed ? { dateAssumed: true } : {}), ...(meta ? { minutes: meta } : {}) };
  fs.mkdirSync(W.DIR.inbox, { recursive: true });
  const body = said + (Object.keys(machine).length ? '\n\n```json\n' + JSON.stringify(machine) + '\n```\n' : '\n');
  fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-${type}.md`), `kind: note\ntype: ${type}\nat: ${lib.localIso()}\n\n${body}`);
  if (minute) fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-${type}-file-1-會議紀錄.md`), minute);
  if (doc) fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-${type}-file-1-${doc.name}`), doc.text);
  W.shell();
  const input = inputOf(W, ref), run = runsOf(W).find(r => r.ref === ref) || null;
  const pack = input && input.packId && fs.existsSync(packFile(W, input.packId)) ? read(packFile(W, input.packId)) : null;
  const sandbox = run ? path.join(W.DIR.sandbox, run.id) : '';
  return { ref, input, run, pack, sandbox, accepted: !!(run && run.state === 'done' && input && ev && input.summary === ev.summary) };
}
function answer(W, pack, pick) {
  const answers = pack.questions.map(q => ({ id: q.id, value: pick ? pick(q) : q.value, ai: q.value, changed: false }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: false', 'shownAt: ' + lib.localIso()];
  fs.mkdirSync(W.DIR.replies, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  return W.shell();
}
// 「逐字不變」快照：欄位照 p-plan.md「逐字不變」一節
function snap(W) {
  const s = W.state(), c = (() => { try { return read(path.join(W.DIR.ledger, 'confirmed.json')); } catch { return {}; } })();
  return JSON.stringify({
    assumptions: ((s.company || {}).assumptions || []).map(a => ({ id: a.id, grade: a.grade, status: a.status, changedAt: a.changedAt, changedAtAssumed: a.changedAtAssumed, sourceId: a.sourceId })),
    nextExternalAction: (s.company || {}).nextExternalAction ?? null,
    tasks: (s.tasks || []).map(t => ({ id: t.id, title: t.title, dueAt: t.dueAt, basisDate: t.basisDate, milestoneId: t.milestoneId, status: t.status, updatedAt: t.updatedAt, minutesSource: t.minutesSource })),
    values: c.values,
    actors: (((s.company || {}).actors) || []).map(a => ({ name: a.name, role: a.role }))
  });
}
const qOp = (pack, op, id) => ((pack && pack.questions) || []).find(q => (q.options || []).some(o => o.apply && o.apply.op === op && (!id || o.apply.id === id || o.apply.revisionOfTaskId === id))) || null;
const optOp = (q, op) => ((q && q.options) || []).find(o => o.apply && o.apply.op === op) || null;
const datedEffects = input => ((input && input.effects) || []).filter(e => e && e.targetKind === 'dated');
const judgeHas = (q, text) => !!(q && typeof q.judge === 'string' && q.judge.includes(text));
const section = (text, title) => { const at = text.indexOf('## ' + title); if (at < 0) return ''; const next = text.indexOf('\n## ', at + 1); return text.slice(at, next < 0 ? undefined : next); };
const pairLabels = q => q && q.pair ? { old: q.pair.oldLabel, now: q.pair.nowLabel } : null;
const A = (id, grade, why, extra = {}) => ({ kind: 'assumption', id, grade, why, ...extra });

try {
  /* ---------- 第 1 項：較新的事件照常出題，依據行附兩個日期 ---------- */
  const W1 = await world('newer');
  const e1 = submit(W1, 'R20261103-100000-dp1-e1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay('dp1-e1', [A('H1', 'said', '對方口頭表示有興趣。')]) });
  if (e1.pack) answer(W1, e1.pack);
  ok('DPF-1-1 場景：E1（11 月 3 日）照建議確認後，假設級別為口頭表示，changedAt 為 2026-11-03', e1.accepted && assumption(W1, 'H1').grade === 'said' && assumption(W1, 'H1').changedAt === '2026-11-03', { accepted: e1.accepted, H1: assumption(W1, 'H1') });
  const e2 = submit(W1, 'R20261110-100000-dp1-e2', { date: '2026-11-10', said: '陳經理已安排到工房試用。', ev: replay('dp1-e2', [A('H1', 'did', '對方已安排試用。')]) });
  const q12 = qOp(e2.pack, 'setAssumptionGrade', 'H1');
  ok('DPF-1-2 場景：E2（11 月 10 日）出題，第一個選項為建議（改為實際行動）', e2.accepted && q12 && q12.options[0].rec === true && q12.options[0].apply.grade === 'did', { accepted: e2.accepted, q: q12 });
  const basis1 = T('dpBasisNewer', { d: '11 月 10 日', src: U.dpSrcEvent, c: '11 月 3 日' });
  ok('DPF-1-3 依據行寫入 q.judge：「' + basis1 + '」', judgeHas(q12, basis1), { judge: q12 && q12.judge, want: basis1 });
  ok('DPF-1-4 q.pair 並列新舊說法：舊標籤 dpPairOldDated（11 月 3 日）、新標籤 dpPairNow（11 月 10 日的事件紀錄）', JSON.stringify(pairLabels(q12)) === JSON.stringify({ old: T('dpPairOldDated', { c: '11 月 3 日' }), now: T('dpPairNow', { d: '11 月 10 日', src: U.dpSrcEvent }) }), pairLabels(q12));
  ok('DPF-1-5 建議選項帶 apply.basisDate = 2026-11-10', !!q12 && q12.options[0].apply.basisDate === '2026-11-10', q12 && q12.options[0].apply);
  if (e2.pack) answer(W1, e2.pack);
  ok('DPF-1-6 確認後 changedAt 為 2026-11-10', assumption(W1, 'H1').grade === 'did' && assumption(W1, 'H1').changedAt === '2026-11-10', assumption(W1, 'H1'));
  const W1m = await world('newer-meeting');
  const e1m = submit(W1m, 'R20261103-100000-dp1m-e1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay('dp1m-e1', [A('H1', 'said', '對方口頭表示有興趣。')]) });
  if (e1m.pack) answer(W1m, e1m.pack);
  const m1m = submit(W1m, 'R20261110-100000-dp1m-m', { date: '2026-11-10', said: '交出會議紀錄。', meta: { id: 'm-dp1m-new', version: 1 }, minute: minuteBody('試用安排', '2026 年 11 月 10 日', { facts: ['- 陳經理已安排到工房試用。'] }),
    ev: replay('dp1m-m', [A('H1', 'did', '對方已安排試用。', { sourceQuote: '陳經理已安排到工房試用' })]) });
  const q1m = qOp(m1m.pack, 'setAssumptionGrade', 'H1');
  const basis1m = T('dpBasisNewer', { d: '11 月 10 日', src: U.dpSrcMeeting, c: '11 月 3 日' });
  ok('DPF-1-7 場景：會議紀錄版本（11 月 10 日會議）出題且建議改級', e1m.accepted && m1m.accepted && q1m && q1m.options[0].rec === true, { e1: e1m.accepted, m: m1m.accepted, q: q1m });
  ok('DPF-1-8 會議紀錄版本依據行：「' + basis1m + '」', judgeHas(q1m, basis1m), q1m && q1m.judge);
  ok('DPF-1-9 會議紀錄版本 q.pair 新標籤為「11 月 10 日的會議」', !!q1m && !!q1m.pair && q1m.pair.nowLabel === T('dpPairNow', { d: '11 月 10 日', src: U.dpSrcMeeting }), pairLabels(q1m));

  /* ---------- 第 2 項：較舊而不同 → 不出題、帳本逐字不變、記「當日說法」 ---------- */
  const W2 = await world('older-different');
  const m1Body = minuteBody('首次合作', '2026 年 11 月 5 日', { facts: ['- 陳經理已到工房試飲並確認合作意向。'], says: ['- 陳經理要求先寄出試用樣本。'], todos: ['- 陳經理在 2026 年 11 月 25 日前提供報價。'] });
  const ACTION_A = '向陳經理寄出試用樣本', ACTION_B = '先約陳經理再次見面';
  const m1 = submit(W2, 'R20261105-100000-dp2-m1', { date: '2026-11-05', said: '交出會議紀錄。', meta: { id: 'm-dp2-m1', version: 1 }, minute: m1Body, ev: replay('dp2-m1', [
    A('H1', 'did', '對方已到工房試飲並確認合作意向。', { sourceQuote: '陳經理已到工房試飲並確認合作意向' }),
    { kind: 'followUp', date: '2026-11-25', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 25 日前提供報價' },
    { kind: 'nextAction', text: ACTION_A, why: '會上定下先寄樣本。', sourceQuote: '陳經理要求先寄出試用樣本' }]) });
  if (m1.pack) answer(W2, m1.pack);
  const s2 = W2.state(), t1 = (s2.tasks || []).find(t => t && t.dueAt === '2026-11-25' && t.minutesSource && t.minutesSource.id === 'm-dp2-m1');
  ok('DPF-2-1 場景：M1（11 月 5 日會議）照建議確認：假設為實際行動（changedAt 2026-11-05）、下一個對外動作為 A、日程 11 月 25 日', m1.accepted && assumption(W2, 'H1').grade === 'did' && assumption(W2, 'H1').changedAt === '2026-11-05' && ((s2.company || {}).nextExternalAction || {}).text === ACTION_A && !!t1, { accepted: m1.accepted, H1: assumption(W2, 'H1'), nea: (s2.company || {}).nextExternalAction, task: t1 });
  const stableA = snap(W2); W2.shell(); const stableB = snap(W2);
  ok('DPF-2-0 場景：快照在閒置跑一次外殼後逐字相同（快照欄位穩定）', stableA === stableB, { before: stableA, after: stableB });
  const before2 = snap(W2);
  const m2 = submit(W2, 'R20261020-100000-dp2-m2', { date: '2026-10-20', said: '補交舊會議紀錄。', meta: { id: 'm-dp2-m2', version: 1 },
    minute: minuteBody('初次見面', '2026 年 10 月 20 日', { says: ['- 陳經理表示有興趣合作。', '- 陳經理在 2026 年 11 月 18 日前提供報價。'], decide: ['- 雙方同意先再約見面一次。'] }),
    ev: replay('dp2-m2', [
      A('H1', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' }),
      { kind: 'followUp', date: '2026-11-18', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 18 日前提供報價', sameAsTask: t1 ? t1.id : 'missing' },
      { kind: 'nextAction', text: ACTION_B, why: '會上同意再見面。', sourceQuote: '雙方同意先再約見面一次' }]) });
  const ctx2 = readText(path.join(m2.sandbox, 'context.md'));
  ok('DPF-2-2 場景：M2（10 月 20 日會議）重播被接受，沙盒 context.md 列出 M1 的日程（sameAsTask 可用）', m2.accepted && !!t1 && ctx2.includes('[日程 ' + t1.id), { accepted: m2.accepted, run: m2.run && m2.run.state, context: ctx2.slice(0, 600) });
  ok('DPF-2-3 M2 不出問題包，輸入標為已處理', m2.accepted && !m2.pack && m2.input && m2.input.status === 'processed', { pack: m2.pack && m2.pack.questions.map(q => q.ask), status: m2.input && m2.input.status });
  if (m2.pack) answer(W2, m2.pack);
  ok('DPF-2-4 快照逐字不變（如有題目，已照建議作答）', m2.accepted && snap(W2) === before2, { before: before2, after: snap(W2) });
  const m2Input = inputOf(W2, 'R20261020-100000-dp2-m2'), dated2 = datedEffects(m2Input);
  ok('DPF-2-5 三項「當日說法」記入改動（targetKind dated），每句含「10 月 20 日會上」及「11 月 5 日」', dated2.length === 3 && dated2.every(e => String(e.change).includes('10 月 20 日' + U.dpWhereMeeting) && String(e.change).includes('11 月 5 日')), { effects: m2Input && m2Input.effects });
  ok('DPF-2-6 沒有確認題的原因為 dpAllOlderReason', !!m2Input && m2Input.reason === U.dpAllOlderReason, m2Input && m2Input.reason);

  // 兩包同時待答：共用日程 T 預先存在，M1、M2 都出 sameAsTask 題；先答 M1，再照建議答 M2，套用時要再判斷
  const W2b = await world('two-pending');
  { const s = W2b.state(); s.tasks = [...(s.tasks || []), { id: 'fu-dp-shared', title: '陳經理提供報價', dueAt: '2026-11-20', status: 'open', owner: 'founder', updatedAt: '2026-10-15T10:00:00+00:00' }]; W2b.save(s); }
  const p1 = submit(W2b, 'R20261105-100000-dp2b-m1', { date: '2026-11-05', said: '交出會議紀錄。', meta: { id: 'm-dp2b-m1', version: 1 }, minute: m1Body, ev: replay('dp2b-m1', [
    A('H1', 'did', '對方已到工房試飲並確認合作意向。', { sourceQuote: '陳經理已到工房試飲並確認合作意向' }),
    { kind: 'followUp', date: '2026-11-25', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 25 日前提供報價', sameAsTask: 'fu-dp-shared' },
    { kind: 'nextAction', text: ACTION_A, why: '會上定下先寄樣本。', sourceQuote: '陳經理要求先寄出試用樣本' }]) });
  const p2 = submit(W2b, 'R20261020-100000-dp2b-m2', { date: '2026-10-20', said: '補交舊會議紀錄。', meta: { id: 'm-dp2b-m2', version: 1 },
    minute: minuteBody('初次見面', '2026 年 10 月 20 日', { says: ['- 陳經理表示有興趣合作。', '- 陳經理在 2026 年 11 月 18 日前提供報價。'], decide: ['- 雙方同意先再約見面一次。'] }),
    ev: replay('dp2b-m2', [
      A('H1', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' }),
      { kind: 'followUp', date: '2026-11-18', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 18 日前提供報價', sameAsTask: 'fu-dp-shared' },
      { kind: 'nextAction', text: ACTION_B, why: '會上同意再見面。', sourceQuote: '雙方同意先再約見面一次' }]) });
  const sameOpt = pack => { const q = qOp(pack, 'addFollowUp', 'fu-dp-shared'); return !!q && q.options.length === 3; };
  // 「已代你收起」開關打開時，較舊的 M2 三項與未答的 M1 同一事實，建題前已合併為「當日說法」，不另出題（brief-f2 4.1）
  const MERGE = process.env.SOS_FACT_MERGE !== '0'; // 發佈版預設打開，只有明確設 0 才關閉
  ok('DPF-2-7 場景：M1、M2 都未答時' + (MERGE ? '（開關打開）M1 出題、M2 同一事實不另出題' : '各自出題，兩包都有「更新原有一項」的日程題'), p1.accepted && p2.accepted && sameOpt(p1.pack) && (MERGE ? !p2.pack || !qOp(p2.pack, 'addFollowUp', 'fu-dp-shared') : sameOpt(p2.pack)), { p1: p1.accepted, p2: p2.accepted, q1: p1.pack && p1.pack.questions.map(q => q.ask), q2: p2.pack && p2.pack.questions.map(q => q.ask) });
  if (p1.pack) answer(W2b, p1.pack);
  const afterM1 = snap(W2b), sharedAfterM1 = (W2b.state().tasks || []).find(t => t.id === 'fu-dp-shared');
  ok('DPF-2-8 場景：答 M1 後共用日程改為 11 月 25 日、假設為實際行動', !!sharedAfterM1 && sharedAfterM1.dueAt === '2026-11-25' && assumption(W2b, 'H1').grade === 'did', { task: sharedAfterM1, H1: assumption(W2b, 'H1') });
  if (p2.pack) answer(W2b, p2.pack);
  ok('DPF-2-9 ' + (MERGE ? '（開關打開）M2 沒有同一事實的題' : '照建議答 M2 後') + '，快照等於只答 M1 的結果（套用時再判斷，日程、假設、下一個對外動作都不倒退）', (MERGE || !!p2.pack) && snap(W2b) === afterM1, { onlyM1: afterM1, after: snap(W2b) });
  const p2Input = inputOf(W2b, 'R20261020-100000-dp2b-m2');
  ok('DPF-2-10 M2 的改動有「當日說法」（targetKind dated，含 10 月 20 日）', datedEffects(p2Input).length > 0 && datedEffects(p2Input).every(e => String(e.change).includes('10 月 20 日')), p2Input && p2Input.effects);

  /* ---------- 第 3 項：較舊而缺項 → 補記題 ---------- */
  const W3 = await world('older-missing');
  const e31 = submit(W3, 'R20261110-100000-dp3-e1', { date: '2026-11-10', said: '農場表示可以每週出貨。', ev: replay('dp3-e1', [A('H2', 'said', '對方口頭表示可以每週出貨。')]) });
  if (e31.pack) answer(W3, e31.pack);
  { const s = W3.state(); s.company.nextExternalAction = null; W3.save(s); }
  const ACTION_C = '向陳經理寄出新一季價目表';
  const e32 = submit(W3, 'R20261020-100000-dp3-e2', { date: '2026-10-20', said: '陳經理當日要求寄出新一季價目表。', ev: replay('dp3-e2', [{ kind: 'nextAction', text: ACTION_C, why: '原話寫明對方要求寄出價目表。' }]) });
  const sbLedger3 = (() => { try { return read(path.join(e32.sandbox, 'ledger.json')); } catch { return {}; } })();
  ok('DPF-3-1 場景：E1（11 月 10 日）確認後 changedAt 2026-11-10；下一個對外動作設為空，E2 沙盒 ledger.json 亦為 null；E2 重播被接受', e31.accepted && assumption(W3, 'H2').changedAt === '2026-11-10' && e32.accepted && Object.hasOwn(sbLedger3, 'nextExternalAction') && sbLedger3.nextExternalAction === null, { H2: assumption(W3, 'H2'), accepted: e32.accepted, sandboxNext: sbLedger3.nextExternalAction });
  const q3 = qOp(e32.pack, 'setNextExternalAction');
  const ask3 = T('dpMissingAsk', { d: '10 月 20 日', x: ACTION_C });
  ok('DPF-3-2 題目為「' + ask3 + '」', !!q3 && q3.ask === ask3, q3 && q3.ask);
  ok('DPF-3-3 選項為 dpMissingYes（建議，預設）及 dpMissingNo', !!q3 && JSON.stringify(q3.options.map(o => o.text)) === JSON.stringify([T('dpMissingYes', { d: '10 月 20 日' }), U.dpMissingNo]) && q3.options[0].rec === true && q3.value === q3.options[0].text, q3 && { options: q3.options, value: q3.value });
  if (e32.pack) answer(W3, e32.pack);
  const nea3 = (W3.state().company || {}).nextExternalAction || {};
  ok('DPF-3-4 場景：確認後下一個對外動作為 C', nea3.text === ACTION_C, nea3);
  ok('DPF-3-5 確認後 basisDate 為 2026-10-20', nea3.basisDate === '2026-10-20', nea3);
  ok('DPF-3-7 確認後 basisFrom 為該件輸入編號', nea3.basisFrom === 'in-R20261020-100000-dp3-e2', nea3);
  const done3 = T('dpMissingDone', { d: '10 月 20 日', t: '' });
  ok('DPF-3-6 改動含「' + done3 + '」', ((inputOf(W3, 'R20261020-100000-dp3-e2') || {}).effects || []).some(e => String(e.change || '').includes(done3)), (inputOf(W3, 'R20261020-100000-dp3-e2') || {}).effects);

  /* ---------- 第 4 項：同日 → 照常出題、沒有預設建議 ---------- */
  const W4 = await world('same-day');
  const s4a = submit(W4, 'R20261110-100000-dp4-a', { date: '2026-11-10', said: '交出會議紀錄（甲）。', meta: { id: 'm-dp4-a', version: 1 }, minute: minuteBody('上午會議', '2026 年 11 月 10 日', { says: ['- 陳經理表示有興趣合作。'] }),
    ev: replay('dp4-a', [A('H1', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' })]) });
  if (s4a.pack) answer(W4, s4a.pack);
  const s4b = submit(W4, 'R20261110-100000-dp4-b', { date: '2026-11-10', said: '交出會議紀錄（乙）。', meta: { id: 'm-dp4-b', version: 1 }, minute: minuteBody('下午會議', '2026 年 11 月 10 日', { facts: ['- 陳經理已到工房試飲並落實試用。'] }),
    ev: replay('dp4-b', [A('H1', 'did', '對方已落實試用。', { sourceQuote: '陳經理已到工房試飲並落實試用' })]) });
  const q4 = qOp(s4b.pack, 'setAssumptionGrade', 'H1');
  ok('DPF-4-1 場景：甲確認後 changedAt 2026-11-10；乙出題', s4a.accepted && assumption(W4, 'H1').grade === 'said' && assumption(W4, 'H1').changedAt === '2026-11-10' && s4b.accepted && !!q4, { H1: assumption(W4, 'H1'), accepted: s4b.accepted, q: q4 });
  ok('DPF-4-2 所有選項都沒有建議（rec 全為 false）', !!q4 && q4.options.every(o => !o.rec), q4 && q4.options);
  ok('DPF-4-3 預設答案為空（value 為空字串）', !!q4 && q4.value === '', q4 && q4.value);
  const basis4 = T('dpBasisSameDay', { d: '11 月 10 日', src: U.dpSrcMeeting, c: '11 月 10 日' });
  ok('DPF-4-4 q.judge 含「' + basis4 + '」', judgeHas(q4, basis4), q4 && q4.judge);
  ok('DPF-4-5 q.pair 並列兩個說法：現有紀錄（11 月 10 日）及 11 月 10 日的會議', JSON.stringify(pairLabels(q4)) === JSON.stringify({ old: T('dpPairOldDated', { c: '11 月 10 日' }), now: T('dpPairNow', { d: '11 月 10 日', src: U.dpSrcMeeting }) }), pairLabels(q4));

  /* ---------- 第 5 項：現有資料沒有日期 → 照常出題並註明 ---------- */
  const W5 = await world('undated');
  { const s = W5.state(); s.tasks = [...(s.tasks || []), { id: 'fu-dp-undated', title: '陳經理提供報價', dueAt: '2026-11-18', status: 'open', owner: 'founder', updatedAt: '2026-10-15T10:00:00+00:00' }]; W5.save(s); }
  const e5 = submit(W5, 'R20261020-100000-dp5', { date: '2026-10-20', said: '交出會議紀錄。', meta: { id: 'm-dp5', version: 1 }, minute: minuteBody('初次見面', '2026 年 10 月 20 日', { says: ['- 陳經理表示有興趣合作。', '- 陳經理在 2026 年 11 月 25 日前提供報價。'] }),
    ev: replay('dp5', [A('H1', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' }), { kind: 'followUp', date: '2026-11-25', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 25 日前提供報價', sameAsTask: 'fu-dp-undated' }]) });
  const task5 = (W5.state().tasks || []).find(t => t.id === 'fu-dp-undated') || {}, ctx5 = readText(path.join(e5.sandbox, 'context.md'));
  ok('DPF-5-1 場景：假設沒有 changedAt；日程沒有 basisDate 及 fromInput；context.md 列出該日程；重播被接受', !assumption(W5, 'H1').changedAt && !task5.basisDate && !task5.fromInput && ctx5.includes('[日程 fu-dp-undated') && e5.accepted, { H1: assumption(W5, 'H1'), task: task5, accepted: e5.accepted });
  const q5a = qOp(e5.pack, 'setAssumptionGrade', 'H1'), q5f = qOp(e5.pack, 'addFollowUp', 'fu-dp-undated');
  ok('DPF-5-2 場景：兩題都出現（假設題、更新原有日程的三選項題），建議照舊（第一個選項）', !!q5a && !!q5f && q5f.options.length === 3 && q5a.options[0].rec === true && q5f.options[0].rec === true, { pack: e5.pack && e5.pack.questions.map(q => ({ ask: q.ask, rec: q.options.map(o => !!o.rec) })) });
  const basis5 = T('dpBasisUndated', { d: '10 月 20 日', src: U.dpSrcMeeting });
  ok('DPF-5-3 兩題 q.judge 均含「' + basis5 + '」', judgeHas(q5a, basis5) && judgeHas(q5f, basis5), { a: q5a && q5a.judge, f: q5f && q5f.judge });
  ok('DPF-5-4 沒有「當日說法」（沒有 dated 改動）', !!e5.input && datedEffects(e5.input).length === 0 && !(Array.isArray(e5.input.dated) && e5.input.dated.length), e5.input && e5.input.effects);

  /* ---------- 第 6 項（a）：沒有日期的事件不得覆寫（兩種寫法各一個世界） ---------- */
  for (const [tag, opts, n] of [['甲：機讀區不帶 date', { date: null }, 1], ['乙：帶 dateAssumed: true', { date: isoDay(new Date()), dateAssumed: true }, 2]]) {
    const W6 = await world('assumed-' + n);
    const e61 = submit(W6, `R20261105-100000-dp6${n}-e1`, { date: '2026-11-05', said: '陳經理表示對試用有興趣。', ev: replay(`dp6${n}-e1`, [A('H1', 'said', '對方口頭表示有興趣。')]) });
    if (e61.pack) answer(W6, e61.pack);
    const before6 = snap(W6);
    const e62 = submit(W6, `R20261112-100000-dp6${n}-x`, { ...opts, said: '陳經理說已經安排試用。', ev: replay(`dp6${n}-x`, [A('H1', 'did', '對方已安排試用。')]) });
    const q6 = qOp(e62.pack, 'setAssumptionGrade', 'H1'), keep6 = optOp(q6, 'keep'), change6 = optOp(q6, 'setAssumptionGrade');
    const base = (n - 1) * 5;
    ok(`DPF-6-${base + 1} 場景（${tag}）：E1（11 月 5 日）確認後 changedAt 2026-11-05；沒有日期的事件重播被接受並出題`, e61.accepted && assumption(W6, 'H1').changedAt === '2026-11-05' && e62.accepted && !!q6, { H1: assumption(W6, 'H1'), accepted: e62.accepted, q: q6 });
    ok(`DPF-6-${base + 2}（${tag}）input.dateAssumed 為 true`, !!e62.input && e62.input.dateAssumed === true, e62.input && { eventDate: e62.input.eventDate, dateAssumed: e62.input.dateAssumed });
    ok(`DPF-6-${base + 3}（${tag}）建議放在「維持」：維持選項為建議，value 等於維持一項`, !!keep6 && keep6.rec === true && !(change6 && change6.rec) && q6.value === keep6.text, q6 && { options: q6.options, value: q6.value });
    if (e62.pack) answer(W6, e62.pack);
    ok(`DPF-6-${base + 4}（${tag}）按 value 交答後快照逐字不變`, e62.accepted && snap(W6) === before6, { before: before6, after: snap(W6) });
    ok(`DPF-6-${base + 5}（${tag}）沙盒 event.md 含「事件日期：沒有提供」`, readText(path.join(e62.sandbox, 'event.md')).includes('事件日期：沒有提供'), readText(path.join(e62.sandbox, 'event.md')).slice(0, 300));
  }

  /* ---------- 第 7 項：沒有日期時相對日期不產生 asOf ---------- */
  const follow7 = plusDays(7);
  const ev7 = tag => replay(tag, [A('H1', 'did', '對方上星期已確認安排。', { asOf: '2026-11-05', sourceQuote: '上星期已確認' }), { kind: 'followUp', date: follow7, action: '陳經理回覆報價', why: '由『下星期』換算，請核對。' }]);
  const W7 = await world('asof-assumed');
  const e71 = submit(W7, 'R20261103-100000-dp7-e1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay('dp7-e1', [A('H1', 'said', '對方口頭表示有興趣。')]) });
  if (e71.pack) answer(W7, e71.pack);
  const e72 = submit(W7, 'R20261112-100000-dp7-x', { date: null, said: '陳經理上星期已確認，下星期回覆報價。', ev: ev7('dp7-x') });
  const q7 = qOp(e72.pack, 'setAssumptionGrade', 'H1');
  ok('DPF-7-1 場景：E1（11 月 3 日）確認後 changedAt 2026-11-03；沒有日期的事件重播被接受並出假設題', e71.accepted && assumption(W7, 'H1').changedAt === '2026-11-03' && e72.accepted && !!q7, { H1: assumption(W7, 'H1'), accepted: e72.accepted, run: e72.run && e72.run.state });
  const change7 = optOp(q7, 'setAssumptionGrade');
  ok('DPF-7-2 假設題的改級選項 apply.basisAssumed 為 true，basisDate 不是 2026-11-05（asOf 已丟棄）', !!change7 && change7.apply.basisAssumed === true && q7.options.every(o => !o.apply || o.apply.basisDate !== '2026-11-05'), q7 && q7.options);
  ok('DPF-7-3 q.judge 含 dpBasisAssumed', judgeHas(q7, U.dpBasisAssumed), q7 && q7.judge);
  const pending7 = ((e72.input && e72.input.pendingEventItems) || []).filter(it => it && it.kind === 'followUp');
  ok('DPF-7-4 沒有跟進題（相對日期沒有換算依據）', e72.accepted && !qOp(e72.pack, 'addFollowUp') && !pending7.length, { pack: e72.pack && e72.pack.questions.map(q => q.ask), pending: pending7 });
  const asOfWord = T('dpAsOfDropped', { r: '' });
  ok('DPF-7-5 runs.log 有「' + asOfWord + '」字樣', readText(path.join(W7.DIR.ledger, 'runs.log')).includes(asOfWord), readText(path.join(W7.DIR.ledger, 'runs.log')).split('\n').slice(-12));
  const W7c = await world('asof-real');
  const e7c1 = submit(W7c, 'R20261103-100000-dp7c-e1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay('dp7c-e1', [A('H1', 'said', '對方口頭表示有興趣。')]) });
  if (e7c1.pack) answer(W7c, e7c1.pack);
  const e7c2 = submit(W7c, 'R20261110-100000-dp7c-x', { date: '2026-11-10', said: '陳經理上星期已確認，下星期回覆報價。', ev: ev7('dp7c-x') });
  const q7c = qOp(e7c2.pack, 'setAssumptionGrade', 'H1');
  ok('DPF-7-6 場景（對照組，11 月 10 日真實日期）：重播被接受，出假設題及跟進題', e7c1.accepted && e7c2.accepted && !!q7c && !!(qOp(e7c2.pack, 'addFollowUp') || ((e7c2.input && e7c2.input.pendingEventItems) || []).some(it => it.kind === 'followUp')), { accepted: e7c2.accepted, pack: e7c2.pack && e7c2.pack.questions.map(q => q.ask) });
  ok('DPF-7-7 對照組：asOf 被接受，建議選項 apply.basisDate 為 2026-11-05', !!q7c && q7c.options[0].apply.basisDate === '2026-11-05', q7c && q7c.options[0].apply);
  const md = readText(path.join(PROTO, 'ai-event.md'));
  ok('DPF-7-8 靜態：ai-event.md 有 asOf 規則及「沒有提供」日期的規則句', md.includes('asOf') && md.split(/\r?\n/).some(line => line.includes('沒有提供')), { asOf: md.includes('asOf'), lines: md.split(/\r?\n/).filter(line => line.includes('沒有提供')) });

  /* ---------- 第 8 項：補交舊會議時以往紀錄不含較新的會議 ---------- */
  const W8 = await world('context-filter');
  const e8 = submit(W8, 'R20261110-090000-dp8-e', { date: '2026-11-10', said: '陳經理來電確認試飲安排，試飲安排獨特字句。', ev: replay('dp8-e', []) });
  const m8n = submit(W8, 'R20261110-100000-dp8-new', { date: '2026-11-10', said: '交出會議紀錄。', meta: { id: 'm-dp8-new', version: 1 }, minute: minuteBody('報價安排', '2026 年 11 月 10 日', { says: ['- 陳經理承諾 11 月 25 日交報價。'] }),
    ev: replay('dp8-new', [A('H1', 'said', '對方口頭承諾交報價。', { sourceQuote: '陳經理承諾 11 月 25 日交報價' }), { kind: 'followUp', date: '2026-11-25', action: '陳經理交報價', why: '會議紀錄寫明該日交報價。', sourceQuote: '陳經理承諾 11 月 25 日交報價' }]) });
  if (m8n.pack) answer(W8, m8n.pack);
  const m8o = submit(W8, 'R20261020-100000-dp8-old', { date: '2026-10-20', said: '補交舊會議紀錄。', meta: { id: 'm-dp8-old', version: 1 }, minute: minuteBody('初次見面', '2026 年 10 月 20 日', { says: ['- 陳經理表示有興趣合作。'] }),
    ev: replay('dp8-old', [A('H2', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' })]) });
  const ctx8 = readText(path.join(m8o.sandbox, 'context.md')), newEffects = ((inputOf(W8, 'R20261110-100000-dp8-new') || {}).effects || []).map(e => e.change).filter(Boolean);
  ok('DPF-8-1 場景：11 月 10 日其他事件已處理、M-new 已確認（有改動）；M-old 重播被接受，context.md 的「相關的未完成日程」列出陳經理交報價', e8.accepted && e8.input.status === 'processed' && m8n.accepted && newEffects.length > 0 && m8o.accepted && section(ctx8, '相關的未完成日程').includes('陳經理交報價'), { e8: e8.accepted, newEffects, old: m8o.accepted, context: ctx8.slice(0, 800) });
  const meet8 = section(ctx8, '最近的會議紀錄節錄'), conf8 = section(ctx8, '其後確認的結果'), other8 = section(ctx8, '最近的其他事件');
  ok('DPF-8-2 「最近的會議紀錄節錄」不含 M-new 原句及「11 月 10 日會議紀錄」', !meet8.includes('陳經理承諾 11 月 25 日交報價') && !meet8.includes('11 月 10 日會議紀錄'), meet8);
  ok('DPF-8-3 「其後確認的結果」不含 11 月 10 日的已確認結果', !conf8.includes('11 月 10 日') && !newEffects.some(change => conf8.includes(change)), conf8);
  ok('DPF-8-4 「最近的其他事件」不含 11 月 10 日的事件', !other8.includes('試飲安排獨特字句') && !other8.includes('11 月 10 日'), other8);
  // 對照：較後（11 月 12 日）的會議應看得到 11 月 10 日的其他事件及 M-new；否則 DPF-8-4 只是因其他原因而「沒有」，不能證明過濾生效
  const m8l = submit(W8, 'R20261112-100000-dp8-later', { date: '2026-11-12', said: '交出會議紀錄。', meta: { id: 'm-dp8-later', version: 1 }, minute: minuteBody('跟進會議', '2026 年 11 月 12 日', { says: ['- 陳經理表示會盡快回覆。'] }),
    ev: replay('dp8-later', [A('H3', 'said', '對方口頭表示會回覆。', { sourceQuote: '陳經理表示會盡快回覆' })]) });
  const ctx8l = readText(path.join(m8l.sandbox, 'context.md'));
  ok('DPF-8-5 場景（對照）：較後（11 月 12 日）會議的以往紀錄含 M-new 原句及其已確認結果', m8l.accepted && section(ctx8l, '最近的會議紀錄節錄').includes('陳經理承諾 11 月 25 日交報價') && section(ctx8l, '其後確認的結果').includes('11 月 10 日'), { accepted: m8l.accepted, context: ctx8l });
  // 已知既有缺陷：筆記機讀區帶 date（伺服器寫的事件筆記一定帶）時，founderTextForContext 連機讀區一併交出，hasContactInfo 把「20261110」當作長串數字，事件被當作含聯絡資料而不列入「最近的其他事件」。此項失敗時 DPF-8-4 只是假通過。
  ok('DPF-8-6 場景（對照）：較後（11 月 12 日）會議的「最近的其他事件」含 11 月 10 日的事件', section(ctx8l, '最近的其他事件').includes('試飲安排獨特字句'), section(ctx8l, '最近的其他事件') || ctx8l.slice(0, 400));

  /* ---------- 協調裁決 2：下一個對外動作的現有日期取 basisDate 與 founderUpdatedAt 較遲者 ---------- */
  const W9 = await world('founder-updated');
  { const s = W9.state(); s.company.nextExternalAction = { ...(s.company.nextExternalAction || {}), founderUpdatedAt: '2026-11-08T10:00:00+00:00' }; W9.save(s); }
  const before9 = snap(W9);
  const e9 = submit(W9, 'R20261105-100000-dp9', { date: '2026-11-05', said: '陳經理要求先寄出樣本。', ev: replay('dp9', [{ kind: 'nextAction', text: '向陳經理寄出樣本', why: '原話寫明對方要求寄出樣本。' }]) });
  ok('DPF-9-1 場景：創辦人於 11 月 8 日改過下一個對外動作；11 月 5 日事件重播被接受', e9.accepted, { run: e9.run && e9.run.state });
  ok('DPF-9-2 11 月 5 日的下一步較創辦人 11 月 8 日的更新舊：不出題，已處理', e9.accepted && !qOp(e9.pack, 'setNextExternalAction') && e9.input.status === 'processed', { pack: e9.pack && e9.pack.questions.map(q => q.ask), status: e9.input && e9.input.status });
  if (e9.pack) answer(W9, e9.pack);
  ok('DPF-9-3 快照逐字不變，並有「當日說法」（含 11 月 8 日）', snap(W9) === before9 && datedEffects(inputOf(W9, 'R20261105-100000-dp9')).some(e => String(e.change).includes('11 月 8 日')), { before: before9, after: snap(W9), effects: (inputOf(W9, 'R20261105-100000-dp9') || {}).effects });

  /* ---------- 協調裁決 3：放入文件的日期（三種情況） ---------- */
  const docWorld = async (name, n) => {
    const W = await world(name);
    const e = submit(W, `R20261105-100000-dp10${n}-e1`, { date: '2026-11-05', said: '陳經理表示對試用有興趣。', ev: replay(`dp10${n}-e1`, [A('H1', 'said', '對方口頭表示有興趣。')]) });
    if (e.pack) answer(W, e.pack);
    return { W, e };
  };
  const D1 = await docWorld('doc-dated', 'a');
  const d1 = submit(D1.W, 'R20261112-100000-dp10a-doc', { type: 'doc', date: '2026-11-12', said: '（沒有補充）', doc: { name: '報價單.md', text: '# 報價單\n\n報價日期：2026-11-08\n\n陳經理已確認淺烘豆每磅一百二十元，並已安排試用。\n' },
    ev: replay('dp10a-doc', [A('H1', 'did', '報價單顯示對方已安排試用。', { asOf: '2026-11-08' })]) });
  const qd1 = qOp(d1.pack, 'setAssumptionGrade', 'H1');
  ok('DPF-10-1 場景：文件寫有日期（2026-11-08）的放入文件重播被接受並出題', D1.e.accepted && d1.accepted && !!qd1 && d1.input.via === 'doc', { accepted: d1.accepted, via: d1.input && d1.input.via });
  ok('DPF-10-2 文件日期用作 asOf：建議改級，apply.basisDate 為 2026-11-08（不是收到當日）', !!qd1 && qd1.options[0].rec === true && qd1.options[0].apply.basisDate === '2026-11-08', qd1 && qd1.options);
  const D2 = await docWorld('doc-undated', 'b');
  const before10b = snap(D2.W);
  const d2 = submit(D2.W, 'R20261112-100000-dp10b-doc', { type: 'doc', date: '2026-11-12', said: '（沒有補充）', doc: { name: '價目表.md', text: '# 價目表\n\n淺烘豆每磅一百二十元；陳經理已安排試用。\n' },
    ev: replay('dp10b-doc', [A('H1', 'did', '價目表顯示對方已安排試用。')]) });
  const qd2 = qOp(d2.pack, 'setAssumptionGrade', 'H1'), keepD2 = optOp(qd2, 'keep');
  ok('DPF-10-3 場景：文件沒有日期的放入文件重播被接受，照常出題', D2.e.accepted && d2.accepted && !!qd2, { accepted: d2.accepted });
  ok('DPF-10-4 文件沒有日期：建議維持現有（value 為維持），q.judge 含 dpBasisDocUndated', !!keepD2 && keepD2.rec === true && qd2.value === keepD2.text && judgeHas(qd2, U.dpBasisDocUndated), qd2 && { options: qd2.options, value: qd2.value, judge: qd2.judge });
  if (d2.pack) answer(D2.W, d2.pack);
  ok('DPF-10-5 文件沒有日期：按建議交答後快照逐字不變', d2.accepted && snap(D2.W) === before10b, { before: before10b, after: snap(D2.W) });
  const D3 = await docWorld('doc-current', 'c');
  const d3 = submit(D3.W, 'R20261110-100000-dp10c-doc', { type: 'doc', date: '2026-11-10', said: '這是最新價目表，請按此更新。', doc: { name: '價目表.md', text: '# 價目表\n\n淺烘豆每磅一百二十元；陳經理已安排試用。\n' },
    ev: replay('dp10c-doc', [A('H1', 'did', '創辦人說明這是最新價目表，對方已安排試用。', { [DOC_CURRENT_FIELD]: '這是最新價目表' })]) });
  const qd3 = qOp(d3.pack, 'setAssumptionGrade', 'H1');
  ok('DPF-10-6 場景：創辦人原話寫明是現行資料的放入文件重播被接受並出題', D3.e.accepted && d3.accepted && !!qd3, { accepted: d3.accepted });
  ok('DPF-10-7 原話寫明現行資料：以事件日期為準，建議改級，apply.basisDate 為 2026-11-10，q.judge 不是文件未載日期', !!qd3 && qd3.options[0].rec === true && qd3.options[0].apply.basisDate === '2026-11-10' && !judgeHas(qd3, U.dpBasisDocUndated), qd3 && { options: qd3.options, judge: qd3.judge });

  /* ---------- 回歸：修訂流程（寫明同一會議日期）照舊 ---------- */
  const WR = await world('revision');
  const mid = 'm-2026-11-10-100000-901', text = ['00:01  Speaker 1', '我們會先核對首批數量。', '', '00:12  Speaker 2', '我會在下星期提供資料。', ''].join('\n');
  const folder = minutes.sourceDir(WR.DIR, mid); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'transcript.md'), text);
  minutes.createMinutes(WR.DIR, { id: mid, state: 'speakers', title: '首批安排', meetingDate: '2026-11-10', sources: [{ name: '逐字稿.txt', text: `ledger/minutes/${mid}/transcript.md`, chars: text.length }], labels: [{ label: 'Speaker 1' }, { label: 'Speaker 2' }], suggest: { state: 'running', items: {} }, speakers: {}, version: 1, versions: [], inputId: '', error: '' });
  const v1 = '# 會議紀錄：首版\n\n- 供應商負責在 2026 年 11 月 20 日寄出樣本。\n', v2 = '# 會議紀錄：修訂版\n\n- 供應商負責在 2026 年 11 月 27 日寄出樣本。\n';
  fs.writeFileSync(path.join(folder, 'v1.md'), v1);
  WR.mode('event:event-revision-followup-date');
  const r1 = submit(WR, 'R20261110-100000-dpr-old', { date: '2026-11-10', said: '首版', meta: { id: mid, version: 1 }, minute: v1 });
  if (r1.pack) answer(WR, r1.pack);
  const oldInput = inputOf(WR, 'R20261110-100000-dpr-old');
  WR.mode('event:event-revision-followup-date');
  const r2 = submit(WR, 'R20261110-100000-dpr-new', { date: '2026-11-10', said: '修訂版', meta: { id: mid, version: 2, revisionOf: oldInput ? oldInput.id : '' }, minute: v2 });
  const qr = r2.pack && r2.pack.questions[0];
  ok('DPF-R-1 回歸：同一會議（同日）修改待辦日期仍出修訂題，建議更新原有日程', !!qr && /11 月 20 日改為 11 月 27 日/.test(qr.ask) && qr.options.some(o => o.apply && o.apply.revisionOfTaskId) && qr.options[0].rec === true && qr.value === qr.options[0].text, { first: r1.pack && r1.pack.questions.map(q => q.ask), pack: r2.pack });
  if (r2.pack) answer(WR, r2.pack);
  const rTasks = (WR.state().tasks || []).filter(t => t && t.title === '寄出樣本');
  ok('DPF-R-2 回歸：同意修改後原有日程改為 11 月 27 日，沒有重複', rTasks.length === 1 && rTasks[0].dueAt === '2026-11-27', rTasks);
} catch (error) {
  ok('DPF-X 測試程式出錯', false, String(error && error.stack || error));
}

const pass = results.filter(result => result.pass).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
