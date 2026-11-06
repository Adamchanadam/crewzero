// 不啟動伺服器：檢查部分完成、對象識別及會後建議的輸入核對。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const PROTO = path.resolve(process.argv[2] || 'prototypes/proofread');
const NAMES = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const brain = await import(pathToFileURL(path.join(PROTO, 'brain-lib.mjs')));
const practice = await import(pathToFileURL(path.join(PROTO, 'practice-lib.mjs')));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'crewzero-first-batch-'));
const previous = process.cwd(), previousData = process.env.SOS_DATA;
let passed = 0, total = 0;
function check(name, ok) { total++; if (ok) passed++; console.log((ok ? 'PASS ' : 'FAIL ') + name); }
try {
  const data = path.join(temp, 'data'), sb = path.join(data, 'sandbox');
  for (const d of [data, sb, path.join(data, 'ledger'), path.join(data, 'company')]) fs.mkdirSync(d, { recursive: true });
  const j = (f, value) => fs.writeFileSync(f, JSON.stringify(value));
  const L = { assumptions: [{ id: 'H1', text: '陳經理已答應', grade: 'guess' }, { id: 'H2', text: '陳會答覆', grade: 'guess' }], milestones: [] };
  const state = { company: { assumptions: L.assumptions }, milestones: [] };
  const stateFile = path.join(data, 'ledger', 'state.json'); j(stateFile, state);
  j(path.join(sb, 'ledger.json'), L); j(path.join(sb, 'job.json'), { type: 'checkup' }); fs.writeFileSync(path.join(sb, 'task.md'), 'test');
  process.env.SOS_DATA = data; process.chdir(sb);
  fs.writeFileSync(path.join(data, 'fake-mode.txt'), 'checkup:partial-one\n');
  await import(pathToFileURL(path.join(PROTO, '..', '..', 'tests', 'prototype', 'lib', 'fake-ai.mjs')).href + '?partial');
  const ck = JSON.parse(fs.readFileSync(path.join(sb, 'out', 'checkup.json')));
  const src = fs.readFileSync(path.join(PROTO, 'run.mjs'), 'utf8');
  const section = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  const ctx = { NAMES, Date, readJSON: (f, fallback) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : fallback, brainFile: () => path.join(data, 'ledger', 'checkup.json'), DIR: { data, sandbox: sb, ledger: path.join(data, 'ledger'), company: path.join(data, 'company') }, clockNow: () => Date.parse('2026-11-12T00:00:00Z'), fs, path, loadState: () => state, log() {} };
  ctx.writeJSON = j;
  vm.createContext(ctx);
  vm.runInContext(section('function checkCheckup(', '// 一次工作入面加一步') + '\n' + section('const checkupStale =', 'function brainLedger()') + '\nthis.checkCheckup=checkCheckup; this.checkupStale=checkupStale;', ctx);
  const result = ctx.checkCheckup(ck, L, '2026-11-05T00:00:00Z'); j(path.join(data, 'ledger', 'checkup.json'), result.result);
  check('checkup:partial-one 保存部分結果及七日後重做', ck.weak.length === 1 && result.result.partial && ctx.checkupStale() && NAMES.dash.brainPartial && fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8').includes('D.brainPartial'));
  const ms = [{ id: 'm1', actorName: '陳', pathStatus: 'confirmed' }, { id: 'm2', actorName: '陳經理', pathStatus: 'confirmed' }];
  const actors = brain.deriveActors(null, ms), again = brain.deriveActors(null, ms, actors);
  state.company.actors = actors; state.milestones = ms; state.company.assumptions[0].grade = 'did'; j(stateFile, state);
  const prospects = brain.pipelineOf({ data, ledger: path.join(data, 'ledger'), company: path.join(data, 'company') }).prospects;
  check('對象前綴沿用舊名字配對及編號穩定', JSON.stringify(actors) === JSON.stringify(again) && prospects.find(x => x.name === '陳').stage === 2 && prospects.find(x => x.name === '陳經理').stage === 2);
  j(path.join(sb, 'job.json'), { type: 'debrief' });
  vm.runInContext(section('function checkEvent(', 'function eventPack(') + '\nthis.checkEvent=checkEvent;', ctx);
  const before = fs.readFileSync(stateFile, 'utf8');
  fs.writeFileSync(path.join(data, 'fake-mode.txt'), 'debrief:auto-grade\n');
  await import(pathToFileURL(path.join(PROTO, '..', '..', 'tests', 'prototype', 'lib', 'fake-ai.mjs')).href + '?grade');
  check('debrief:auto-grade 產出只在工作資料夾', fs.readFileSync(stateFile, 'utf8') === before && fs.existsSync(path.join(sb, 'state.json')));
  // 確認前後共用同一份帳本及真實事件套用函數。
  state.company.assumptions[0].grade = 'guess'; j(stateFile, state);
  const input = { id: 'in-test', kind: 'inbox', title: '真實事件（2026-11-05）：見面', eventDate: '2026-11-05', effects: [] };
  state.inputs = [input]; state.events = [];
  Object.assign(ctx, { U: NAMES.ui, stamp: () => 'test', localIso: () => '2026-11-05T00:00:00Z', dayText: x => x, clip: (x,n) => String(x || '').slice(0,n),
    replySubmittedAt: () => '', founderUpdatedAfter: () => false, EV_RANK: g => NAMES.EV_KEYS.indexOf(g), noteCelebration() {}, finishCelebration() {},
    saveState: v => j(stateFile, v), finish() {}, placePacks: () => [], PRACTICE_DIR: path.join(data, 'practice', 'scenarios'), ADVANCED: false, deriveActors: brain.deriveActors, loadPage: () => null });
  vm.runInContext(section('function eventPack(', 'async function finishEvent(') + section('function handleEventConfirm(', '/* ---------- 深化站點') + '\nthis.eventPack=eventPack; this.handleEventConfirm=handleEventConfirm;', ctx);
  const ev = ctx.checkEvent(path.join(sb, 'out'));
  const pack = ctx.eventPack({ id: 'run' }, state, input, ev.items);
  const beforeStage = brain.pipelineOf({ data, ledger: path.join(data, 'ledger'), company: path.join(data, 'company') }).prospects.find(x => x.name === '陳經理').stage;
  check('會後建議只成確認題，確認前格位不變', state.company.assumptions[0].grade === 'guess' && beforeStage === 0 && pack.questions.some(q => q.options[0].apply.op === 'setAssumptionGrade'));
  const q = pack.questions[0]; ctx.handleEventConfirm({ id: 'reply' }, pack, { answers: { [q.id]: { value: q.options[0].text } } });
  const afterStage = brain.pipelineOf({ data, ledger: path.join(data, 'ledger'), company: path.join(data, 'company') }).prospects.find(x => x.name === '陳經理').stage;
  check('創辦人確認後才更新證據級及格位', state.company.assumptions[0].grade === 'did' && afterStage === 2);
  const match = { id: 'match', founder: {}, topic: {}, budget: {} }, milestonesBefore = JSON.stringify(state.milestones);
  Object.assign(ctx, { ensureMatch: () => match, viewOf: () => ({ synthesis: { routes: [{ id: 'S1', name: '路線甲' }, { id: 'S2', name: '路線乙' }] } }), saveMatch() {} });
  vm.runInContext(section('function handleDebateAnswer(', 'function applyAdoption(') + '\nthis.handleDebateAnswer=handleDebateAnswer;', ctx);
  const dp = { debate: { matchId: 'match', kind: 'decision' }, questions: [{ id: 'd1', ask: '選哪條路線？', options: [{ text: 'A. 路線甲' }, { text: 'B. 路線乙' }] }] };
  ctx.handleDebateAnswer({}, dp, { answers: { d1: { value: 'B. 路線乙' } } });
  check('辯論選 B 記錄路線而里程碑不變', match.founder.decisions[0].value === 'B' && match.chosenRouteId === 'S2' && JSON.stringify(state.milestones) === milestonesBefore);
  const packs = []; ctx.placePacks = (_dir, list) => { packs.push(...list); return list.map(p => ({ id: p.id, count: p.questions.length })); }; ctx.ensureActive = () => {};
  state.milestones = [{ id: 'm1', short: '第一站', state: 'active', pathStatus: 'confirmed' }, { id: 'm2', short: '第二站', state: 'not_started', pathStatus: 'confirmed' }];
  state.company.nextExternalAction = { milestoneId: 'm1', text: '原先行動' }; input.appliedQids = []; input.status = 'awaitingFounder';
  const full = { id: 'full', realEvent: { inputId: input.id, date: '2026-11-05' }, questions: [{ id: 'q1', options: [{ text: '完成', apply: { op: 'markDone', id: 'm1' } }] }, { id: 'q2', options: [{ text: '維持', apply: { op: 'keep' } }] }, { id: 'q3', options: [{ text: '維持', apply: { op: 'keep' } }] }] };
  ctx.handleEventConfirm({}, full, { answers: { q1: { value: '完成' }, q2: { value: '維持' }, q3: { value: '維持' } } });
  check('確認包已滿三題時下一步另開一包', full.questions.length === 3 && packs.length === 1 && packs[0].questions.length === 1 && input.status === 'awaitingFounder');

  const scenarioDir = path.join(data, 'practice', 'scenarios'); fs.mkdirSync(scenarioDir, { recursive: true });
  j(path.join(scenarioDir, 'S1.json'), { id: 'S1', counterpartId: actors[1].id, counterpart: { name: '陳經理' }, persona: { concerns: { text: '舊人物卡', source: '你原話' } }, preparedAt: '2026-11-05' });
  j(path.join(data, 'ledger', 'practice-debriefs.json'), [{ scenarioId: 'S1', text: '上次會後紀錄', commitment: 'yes', at: '2026-11-05' }]);
  const reviewDir = path.join(data, 'founder', 'practice'); fs.mkdirSync(reviewDir, { recursive: true });
  j(path.join(reviewDir, 'review.json'), { scenarioId: 'S1', review: { why: [{ reason: '覆盤重點' }] } });
  const DIR = { data, sandbox: sb, ledger: path.join(data, 'ledger'), company: path.join(data, 'company') }, cps = brain.counterpartsOf(DIR);
  Object.assign(ctx, { counterpartsOf: () => cps, DIR });
  vm.runInContext(section('function writeCounterparts(', '/* ---------- 情景演練') + '\nthis.writeCounterparts=writeCounterparts;', ctx);
  for (const name of ['practice', 'debate', 'checkup']) { const folder = path.join(temp, name); fs.mkdirSync(folder); ctx.writeCounterparts(folder); }
  check('三類工作有會後紀錄及覆盤重點，沒有人物卡', ['practice', 'debate', 'checkup'].every(name => { const t = fs.readFileSync(path.join(temp, name, 'counterparts.md'), 'utf8'); return t.includes('上次會後紀錄') && t.includes('覆盤重點') && !t.includes('舊人物卡') && !t.includes('人物卡'); }) && cps.every(x => !('scenario' in x))); 

  const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')));
  const identityPack = { id: 'PACK-A', questions: [{ id: 'q1' }] };
  const reply = machine => ask.parseFounderReply('kind: ask-answer\nref: PACK-A\n\n```json\n' + JSON.stringify(machine) + '\n```');
  const good = { format: 'startup-os.ask-reply/0.1', pack: 'PACK-A', answers: [{ id: 'q1', value: 'yes' }] };
  check('答案身份：跨包同題號、重複及未知題一律拒收', ask.validateAskReply(reply(good), identityPack).ok && !ask.validateAskReply(reply({ ...good, pack: 'PACK-B' }), identityPack).ok && !ask.validateAskReply(reply({ ...good, answers: [good.answers[0], good.answers[0]] }), identityPack).ok && !ask.validateAskReply(reply({ ...good, answers: [{ id: 'q2' }] }), identityPack).ok);
  const page = { detail: { actors: { items: [{ id: 'A1', label: '陳（甲公司）' }, { id: 'A2', label: '陳（乙公司）' }] } } };
  const distinct = brain.deriveActors(page, []);
  check('不同編號保留短名及完整顯示名稱', distinct.length === 2 && distinct[0].id === 'pr-A1' && distinct[1].id === 'pr-A2' && distinct[1].name === '陳' && distinct[1].label === '陳（乙公司）');
  const fixture = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(PROTO, 'fixtures', 'sample-company-page.js'), 'utf8'), fixture);
  j(path.join(data, 'company', 'page.json'), fixture.window.STARTUP_OS_PAGE);
  state.company = { assumptions: [{ id: 'H1', text: '綠野物流願意試送', grade: 'did' }] };
  state.milestones = [{ id: 'm1', actorName: '綠野物流 —— 擬議送貨與銷售伙伴', state: 'done', pathStatus: 'confirmed' }]; j(stateFile, state);
  const sampleProspect = brain.pipelineOf(DIR).prospects.find(p => p.name === '綠野物流');
  check('N1 真實樣本短名配對及完整標籤', sampleProspect?.stage === 2 && sampleProspect.label === '綠野物流 · 送貨與銷售伙伴');
  const beforeSync = brain.pipelineOf(DIR).prospects.map(p => [p.name, p.stage]);
  const samplePage = fixture.window.STARTUP_OS_PAGE, confirmation = { pageId: samplePage.page.id, values: {}, edits: [], confirmedAt: '2026-11-05' };
  state.ledgerFrom = samplePage.page.id;
  const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')));
  const sync = { NAMES, JSON, Date, loadPage: () => samplePage, readJSON: () => confirmation, CONFIRMED: 'confirmed', loadState: () => state, saveState: v => j(stateFile, v),
    milestonesFromPage: dash.milestonesFromPage, assumptionsFromPage: dash.assumptionsFromPage, deriveActors: brain.deriveActors,
    registry: () => ({}), listOf: x => Array.isArray(x) ? x : [], pick: (o, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(o, k)).map(k => [k, o[k]])),
    ROW_PLANS: [], RULE_PLANS: [], CELLS: [], ensureActive() {}, rhythmFromText: () => ({ interviewWeekday: 1 }), nextWeekday: () => '2026-11-12', todayIso: () => '2026-11-05', localIso: ctx.localIso, clip: ctx.clip, log() {}, intakeArchive: () => '' };
  vm.createContext(sync); vm.runInContext(section('const MS_KEEP =', '// 交資料嘅封存資料夾') + '\nthis.syncLedger=syncLedger;', sync);
  sync.syncLedger();
  const afterSync = brain.pipelineOf(DIR).prospects.map(p => [p.name, p.stage]);
  check('舊格式沒有對象表：同步前後每個格位相同，沒有回填空陣列', JSON.stringify(beforeSync) === JSON.stringify(afterSync) && !Object.hasOwn(state.milestones.find(m => m.id === 'm1'), 'doneCounterpartIds'));
  samplePage.detail.actors.items[0].label = '農場乙'; samplePage.path.milestones[0].actor.value = '農場乙';
  j(path.join(data, 'company', 'page.json'), samplePage);
  state.company = { assumptions: [] }; state.milestones = [{ id: 'm1', short: samplePage.path.milestones[0].short, actorName: '農場甲', state: 'done', pathStatus: 'confirmed' }]; j(stateFile, state);
  sync.syncLedger();
  const oldDone = state.milestones.find(m => m.id === 'm1');
  check('N2 舊完成按現時名字計算且不回填編號', !Object.hasOwn(oldDone, 'doneCounterpartIds') && brain.pipelineOf(DIR).prospects.find(p => p.name === '農場乙')?.stage === 2);
  fs.unlinkSync(path.join(data, 'company', 'page.json'));
  state.company.actors = [{ id: 'a', name: '農場甲', fromMilestoneIds: [] }, { id: 'b', name: '農場乙', fromMilestoneIds: ['m1'] }];
  state.company.assumptions = []; state.milestones = [{ id: 'm1', actorName: '農場乙', state: 'done', doneCounterpartIds: ['a'] }]; j(stateFile, state);
  const moved = brain.pipelineOf(DIR).prospects;
  check('更換決策者不轉移完成格位', moved.find(x => x.id === 'a').stage === 2 && moved.find(x => x.id === 'b').stage === 0);
  j(path.join(scenarioDir, 'S-old.json'), { id: 'S-old', counterpartId: 'a', counterpart: { name: '農場甲' }, persona: { concerns: { text: '創辦人確認', source: '你原話' } }, preparedAt: '2026-11-01' });
  j(path.join(scenarioDir, 'S-new.json'), { id: 'S-new', counterpartId: 'a', counterpart: { name: '農場甲' }, persona: { concerns: { text: '創辦人確認', source: '你原話' }, stance: { text: '推測立場', source: 'Zero 解讀' } }, preparedAt: '2026-11-06' });
  const duplicateQuestion = { id: 1, ask: '選哪項？', kind: 'choice', options: [{ text: '甲' }, { text: '乙' }], value: '甲', why: '測試', effect: 'now' };
  const duplicatePrepared = ask.preparePacks({ format: 'startup-os.ask/0.1', title: '測試題', questions: [duplicateQuestion, { ...duplicateQuestion, id: '1' }] }, { strictTitle: false });
  check('建包拒絕數字及字串同一題號', !duplicatePrepared.ok && duplicatePrepared.errors.some(x => x.includes('重複')));
  const numericPack = { id: 'PACK-A', questions: [{ id: 1 }] };
  const numeric = { ...good, answers: [{ id: 1, value: 'yes' }] };
  check('N5 數字題號接受，正規化重複及跨包拒收', ask.validateAskReply(reply(numeric), numericPack).ok && !ask.validateAskReply(reply({ ...numeric, pack: 'PACK-B' }), numericPack).ok && !ask.validateAskReply(reply({ ...numeric, answers: [{ id: 1 }, { id: '1' }] }), numericPack).ok);
  const html = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8');
  const part = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
  check('體檢頁及商機頁各自標示部分完成', part('function pageCheckup(', 'function pageWargame(').includes('D.brainPartial') && part('function pageOpp(', 'function pageRoutes(').includes('D.brainPartial'));
  state.company.assumptions = [{ id: 'H1', text: '農場甲願意合作', grade: 'guess' }]; state.inputs = []; state.events = []; j(stateFile, state);
  const chainSb = path.join(temp, 'chain'), work = path.join(temp, 'work'); fs.mkdirSync(path.join(chainSb, 'out'), { recursive: true }); fs.mkdirSync(work);
  const madePacks = [];
  Object.assign(ctx, { ROOT: PROTO, DIR: { ...DIR, work, replies: path.join(temp, 'replies'), answers: path.join(temp, 'answers') },
    pausedNow: () => false, certified: () => ({ host: {} }), step() {}, addEvent() {}, newSandbox: () => chainSb, eventTask() {},
    runAI: async () => { j(path.join(chainSb, 'out', 'event.json'), { summary: '會面已記錄', grade: 'paid', personaUpdate: { key: 'concerns', text: '不可寫回' }, items: [{ kind: 'assumption', id: 'H1', grade: 'said', why: '對方口頭表示' }] }); return { ok: true }; },
    rewriteOnce: async () => [], placePacks: (_d, ps) => { madePacks.push(...ps); return ps.map(p => ({ id: p.id, count: p.questions.length })); },
    parseFounderReply: ask.parseFounderReply, validateAskReply: ask.validateAskReply, replyVia: () => 'test', archive() {}, fnv: ask.fnv,
    loadPack: () => madePacks[0], loadAnswers: () => { throw Error('錯配答案不可讀取或寫入'); } });
  vm.runInContext(section('async function finishEvent(', '// 你確認真實事件') + section('async function runAIStep(', '/* ---------- 臨時工作') + section('async function handleDebrief(', 'function noteTask(') + section('async function handleAsk(', 'function handleActionConfirm(') + '\nthis.handleDebrief=handleDebrief; this.handleAsk=handleAsk;', ctx);
  await ctx.handleDebrief({ id: 'chain-run', ref: 'chain', kind: 'note', noteType: 'debrief' }, { commitment: 'yes', scenarioId: 'S1' }, '對方口頭表示');
  check('會後正式處理鏈只建立確認包，證據級不變', madePacks.length === 1 && state.company.assumptions[0].grade === 'guess' && madePacks[0].realEvent.inputId === 'in-chain' && !madePacks[0].questions.some(q => q.options?.some(o => o.apply?.op === 'updatePersona')) && !('personaUpdate' in JSON.parse(fs.readFileSync(path.join(work, 'chain-run', 'event.json')))));
  fs.mkdirSync(ctx.DIR.replies, { recursive: true }); fs.mkdirSync(ctx.DIR.answers, { recursive: true });
  const p = madePacks[0], wrong = { format: 'startup-os.ask-reply/0.1', pack: 'PACK-B', answers: [{ id: p.questions[0].id, value: p.questions[0].value }] };
  fs.writeFileSync(path.join(ctx.DIR.replies, 'wrong.md'), 'kind: ask-answer\nref: ' + p.id + '\nhash: ' + ask.fnv(JSON.stringify(p)) + '\n\n```json\n' + JSON.stringify(wrong) + '\n```');
  const beforeWrong = JSON.stringify(state), beforeCards = fs.readFileSync(path.join(scenarioDir, 'S1.json'), 'utf8');
  await ctx.handleAsk({ id: 'wrong' }, 'wrong.md');
  check('正式答案入口拒收跨包同題號，帳本、人物卡及答案儲存不變', JSON.stringify(state) === beforeWrong && fs.readFileSync(path.join(scenarioDir, 'S1.json'), 'utf8') === beforeCards && fs.readdirSync(ctx.DIR.answers).length === 0);
  const brainDir = { ...DIR, sandbox: path.join(temp, 'brain-sandbox') }, steps = [], events = [];
  let aiReply = { ok: false, timedOut: true }, output = { summary: '一項', weak: [{ title: '弱位', assumptionId: 'H1', why: '理由', cheapestTest: '測試' }] }, offeredCount = 0;
  const bc = { fs, path, Date, NAMES, U: NAMES.ui, DIR: brainDir, ROOT: PROTO, readJSON: ctx.readJSON, writeJSON: j, brainFile: brain.brainFile,
    loadState: () => state, saveState: v => j(stateFile, v), pausedNow: () => false, certified: () => ({ host: {} }), webAccess: () => 'none', listMatches: () => [], brainSource: () => null, writeCounterparts() {}, writeBizContext() {}, writeConfirmedPage() {},
    todayIso: () => '2026-11-05', localIso: ctx.localIso, clockNow: Date.now, datedTask: folder => fs.writeFileSync(path.join(folder, 'task.md'), 'task'),
    runAI: async folder => { j(path.join(folder, 'out', 'checkup.json'), output); return aiReply; }, step: (_r, _k, _l, st, detail) => steps.push({ st, detail }),
    addEvent: e => events.push(e), offerDebate: () => offeredCount++, offerOpportunities: () => offeredCount++, clip: ctx.clip, log() {} };
  vm.createContext(bc);
  vm.runInContext(section('const BRAIN_JOBS =', '// 生意大腦放上 Founder Desk') + '\nthis.brainStep=brainStep;', bc);
  await bc.brainStep({ id: 'partial', steps: [] }, 'checkup');
  const savedPartial = JSON.parse(fs.readFileSync(brain.brainFile(brainDir, 'checkup')));
  check('超時已有有效內容：保存部分結果，不建議後續工作', savedPartial.partial && savedPartial.status === 'partial' && savedPartial.summary.includes('部分完成') && events[0].title.includes('部分完成') && offeredCount === 0 && state.company.assumptions[0].cheapestTestPartial === true);
  const hostSource = fs.readFileSync(path.join(PROTO, 'host-lib.mjs'), 'utf8');
  const timers = [], handlers = {}, pipes = {};
  const hc = { Date, path, fs, AI_FAIL: { timeout: 'TIMEOUT' }, buildArgs: () => [], resolveCommand: () => ({ command: 'fake', prefix: [] }),
    clearCliTrust() {}, restrictions: () => true, modelCandidates: () => [], pickModel: () => null,
    preparedAdapter: () => ({ handoff: { ok: true }, env: {}, cleanup() {} }),
    spawn: () => ({ stdout: { on: (_e, f) => { pipes.out = f; } }, stderr: { on: (_e, f) => { pipes.err = f; } }, on: (e, f) => { handlers[e] = f; }, kill() {} }),
    setTimeout: f => { timers.push(f); return timers.length; }, clearTimeout() {} };
  vm.createContext(hc); vm.runInContext(hostSource.slice(hostSource.indexOf('export async function execute(')).replace('export async function execute(', 'async function execute(') + '\nthis.execute=execute;', hc);
  const pending = hc.execute({ command: 'fake', timeoutMinutes: 1 }, chainSb, '', {});
  pipes.out('partial stdout'); pipes.err('partial stderr'); timers[0](); timers[1]();
  aiReply = await pending; output = { weak: [{ title: '後備弱位', assumptionId: 'H1', why: '理由', cheapestTest: '後備測試' }] };
  await bc.brainStep({ id: 'fallback', steps: [] }, 'checkup');
  check('N6 強制結束後備保留輸出並保存有效部分結果', aiReply.timedOut === true && aiReply.stdout === 'partial stdout' && aiReply.stderr === 'partial stderr' && JSON.parse(fs.readFileSync(brain.brainFile(brainDir, 'checkup'))).partial && state.company.assumptions[0].cheapestTest === '後備測試');
  j(brain.brainFile(brainDir, 'checkup'), savedPartial);
  aiReply = { ok: false, timedOut: true };
  output = { partial: true, weak: [] }; await bc.brainStep({ id: 'empty', steps: [] }, 'checkup');
  check('超時沒有有效內容：記未完成且保留原結果', steps.at(-1).detail.includes('未完成') && JSON.parse(fs.readFileSync(brain.brainFile(brainDir, 'checkup'))).updatedAt === savedPartial.updatedAt);
  output = { weak: [], unseen: [{ text: '尚未想到的事項' }] }; await bc.brainStep({ id: 'unseen', steps: [] }, 'checkup');
  check('超時只交出其他有效體檢項目仍保存部分結果', JSON.parse(fs.readFileSync(brain.brainFile(brainDir, 'checkup'))).unseen[0].text === '尚未想到的事項');
  output = { weak: [{ title: '弱位', assumptionId: 'H1', why: '理由', cheapestTest: '其他測試' }] }; aiReply = { ok: false, timedOut: true, stderr: 'permission denied' };
  await bc.brainStep({ id: 'denied', steps: [] }, 'checkup');
  check('超時同時出現權限錯誤不可轉成部分完成', steps.at(-1).st === 'failed' && state.company.assumptions[0].cheapestTest !== '其他測試');
  aiReply = { ok: false, timedOut: true, safetyOutput: '{"permission_denials":[{"tool_name":"write"}]}' };
  await bc.brainStep({ id: 'structured-denied', steps: [] }, 'checkup');
  check('強制結束後備的結構化權限拒絕不可當成功', steps.at(-1).st === 'failed' && state.company.assumptions[0].cheapestTest !== '其他測試');
  aiReply = { ok: false, timedOut: true, safetyOutput: '{"step_update":{"state":"REJECTED"}}' };
  await bc.brainStep({ id: 'stream-denied', steps: [] }, 'checkup');
  check('強制結束後備的工具拒絕狀態不可當成功', steps.at(-1).st === 'failed');
  const pendingError = hc.execute({ command: 'fake', timeoutMinutes: 1 }, chainSb, '', {});
  const timerIndex = timers.length - 1; timers[timerIndex](); handlers.error(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }));
  aiReply = await pendingError;
  const beforeError = fs.readFileSync(brain.brainFile(brainDir, 'checkup'), 'utf8');
  await bc.brainStep({ id: 'timeout-error', steps: [] }, 'checkup');
  check('超時後子程序 EPERM 保留錯誤並失敗，不保存', aiReply.childError?.code === 'EPERM' && aiReply.childError.message === 'operation not permitted' && steps.at(-1).st === 'failed' && fs.readFileSync(brain.brainFile(brainDir, 'checkup'), 'utf8') === beforeError);
  aiReply = { ok: false, budgetExceeded: true }; await bc.brainStep({ id: 'budget', steps: [] }, 'checkup');
  check('費用上限中止時保存有效部分結果', JSON.parse(fs.readFileSync(brain.brainFile(brainDir, 'checkup'))).partial && state.company.assumptions[0].cheapestTest === '其他測試');
  const beforeInvalid = fs.readFileSync(brain.brainFile(brainDir, 'checkup'), 'utf8');
  let repairStarts = 0, rewrites = 0;
  bc.rewriteOnce = async () => { rewrites++; return []; };
  bc.runAI = async folder => { repairStarts++; j(path.join(folder, 'out', 'checkup.json'), { weak: [{ title: '弱位', assumptionId: 'H99', why: '理由', cheapestTest: '測試' }] }); return { ok: true }; };
  const badResult = await bc.brainStep({ id: 'bad-assumption', steps: [] }, 'checkup');
  check('無效假設修正一次仍錯：不覆寫體檢結果', !badResult && repairStarts === 2 && steps.at(-1).st === 'failed' && fs.readFileSync(brain.brainFile(brainDir, 'checkup'), 'utf8') === beforeInvalid && rewrites === 2);
  repairStarts = 0; rewrites = 0;
  bc.runAI = async folder => { repairStarts++; j(path.join(folder, 'out', 'checkup.json'), { weak: [{ title: '弱位', assumptionId: repairStarts === 1 ? 'H99' : 'H1', why: '理由', cheapestTest: '測試' }] }); return { ok: true }; };
  const repaired = await bc.brainStep({ id: 'fixed-assumption', steps: [] }, 'checkup');
  check('無效假設修正後有效才保存，並經改寫核對', repaired && repairStarts === 2 && rewrites === 2 && JSON.parse(fs.readFileSync(brain.brainFile(brainDir, 'checkup'))).weak[0].assumptionId === 'H1');
  const prepSb = path.join(temp, 'prep-before-ai'); fs.mkdirSync(prepSb);
  let priorAtStart;
  Object.assign(ctx, { ROOT: PROTO, loadState: () => state, counterpartsOf: d => brain.counterpartsOf(d), listScenarios: practice.listScenarios, getTask: () => null, newSandbox: () => prepSb, writeCounterparts() {}, brainSource: () => null, writeConfirmedPage() {},
    runAIStep: async () => { priorAtStart = fs.existsSync(path.join(prepSb, 'scenario-seed.json')); } });
  vm.runInContext(section('async function handlePracticePrep(', 'function finishPracticePrep(') + '\nthis.handlePracticePrep=handlePracticePrep;', ctx);
  await ctx.handlePracticePrep({ id: 'prep-before' }, { counterpartId: 'a', who: '農場甲' }, '');
  j(path.join(chainSb, 'out', 'scenario.json'), { title: '再準備', counterpart: { name: '農場甲' }, persona: { identity: { text: '身份' }, stance: { text: '立場' }, interests: { text: '利益' }, concerns: { text: 'AI 想法' } }, goal: { text: '目標' }, questions: ['問題'], objections: ['反對'] });
  ctx.counterpartsOf = d => brain.counterpartsOf(d); ctx.DIR = DIR; ctx.stamp = () => 'new';
  check('AI 執行前不建立人物卡種子', priorAtStart === false);
  vm.runInContext(section('function finishPracticePrep(', 'async function handleDebrief(') + '\nthis.finishPracticePrep=finishPracticePrep;', ctx);
  ctx.finishPracticePrep({ id: 'prep', practiceCounterpartId: 'a' }, chainSb, '準備');
  const prepared = JSON.parse(fs.readFileSync(path.join(scenarioDir, 'Snew.json')));
  check('重新準備保存 AI 產生的場景欄位', prepared.persona.concerns.text === 'AI 想法' && prepared.persona.concerns.source === 'Zero 解讀');
  const matchDir = path.join(temp, 'debates', 'match'); fs.mkdirSync(matchDir, { recursive: true });
  const matchFile = path.join(matchDir, 'match.json'); j(matchFile, { id: 'match', founder: {}, topic: {}, budget: {} });
  const snapshot = JSON.stringify(state);
  const dc = { fs, path, NAMES, writeJSON: j, localIso: ctx.localIso, mFile: () => matchFile, matchDir: () => matchDir, DIR,
    ensureMatch: () => JSON.parse(fs.readFileSync(matchFile)), viewOf: () => ({ synthesis: { routes: [{ id: 'S1', name: '路線甲' }, { id: 'S2', name: '路線乙' }] } }), U: NAMES.ui, clip: ctx.clip, step() {}, finish() {} };
  vm.createContext(dc);
  vm.runInContext(section('function saveMatch(', 'const viewOf') + section('function handleDebateAnswer(', 'function applyAdoption(') + '\nthis.handleDebateAnswer=handleDebateAnswer;', dc);
  dc.handleDebateAnswer({}, dp, { answers: { d1: { value: 'B. 路線乙' } } });
  const writtenMatch = JSON.parse(fs.readFileSync(matchFile));
  check('辯論選擇寫入實際場次檔，完整公司狀態不變', writtenMatch.chosenRouteId === 'S2' && writtenMatch.founder.decisions[0].value === 'B' && JSON.stringify(state) === snapshot);
  state.company.actors = [{ id: 'a', name: '甲', kind: '客戶', fromMilestoneIds: [] }, { id: 'b', name: '乙', kind: '客戶', fromMilestoneIds: [] }]; state.milestones = []; state.company.assumptions = []; j(stateFile, state);
  const seatDir = path.join(data, 'debates', 'seats'); fs.mkdirSync(seatDir, { recursive: true });
  j(path.join(seatDir, 'match.json'), { id: 'seats', topic: { type: 'business' }, roles: { red: { personas: ['客戶'] } } });
  j(path.join(seatDir, 'blue.json'), { claims: [], strategies: [] });
  j(path.join(seatDir, 'red.json'), { attacks: [], seats: [{ persona: '客戶', counterpartId: 'a', cares: '甲的關注' }] });
  const seatRows = brain.counterpartsOf(DIR);
  check('辯論席位有編號時不按類別串到其他對象', seatRows.find(x => x.id === 'a').seats.includes('甲的關注') && seatRows.find(x => x.id === 'b').seats.length === 0);
  j(path.join(seatDir, 'red.json'), { attacks: [], seats: [{ persona: '客戶', cares: '一般關注' }] });
  check('舊辯論類別配對標明通用觀點', brain.counterpartsOf(DIR).filter(x => x.seats.includes('通用席位觀點：一般關注')).length === 2);
  const datedDir = path.join(temp, 'dated'); fs.mkdirSync(datedDir);
  fs.writeFileSync(path.join(datedDir, 'task.md'), '> 今日日期：2026-11-05（星期四）\n\n工作說明');
  const rc = { fs, path, ROOT: PROTO, DIR, U: NAMES.ui, certified: () => ({ host: {} }), webAccess: () => 'none', budgetLeft: () => 1,
    openUnknowns: () => [], execute: async () => ({ ok: true }), setInterval, clearInterval, readJSON: ctx.readJSON, localIso: ctx.localIso, LOCK: path.join(temp, 'lock'), STARTS: path.join(temp, 'starts') };
  vm.createContext(rc); vm.runInContext(section('function runAI(', '/* ----------') + '\nthis.runAI=runAI;', rc);
  await rc.runAI(datedDir); await rc.runAI(datedDir);
  const lines = fs.readFileSync(path.join(datedDir, 'task.md'), 'utf8').split('\n');
  check('今日日期保持第一行，上網說明第二行且重跑不重複', lines[0].startsWith('> 今日日期：') && lines[1].startsWith('> 本次不可上網') && lines.filter(x => x.startsWith('> 本次')).length === 1);
  const legacyDecision = { id: 'legacy-pack', questions: [{ id: 'd1', ask: '選哪條路線？', options: [{ text: 'A. 路線甲' }, { text: 'B. 路線乙' }], value: 'A. 路線甲' }] };
  const legacyDir = { ...DIR, replies: path.join(temp, 'replies'), answers: path.join(temp, 'answers') }, identity = { format: 'startup-os.ask-reply/0.1', pack: legacyDecision.id, answers: [{ id: 'd1', value: 'B. 路線乙' }] };
  fs.writeFileSync(path.join(legacyDir.replies, 'legacy.md'), 'kind: ask-answer\nref: ' + legacyDecision.id + '\nhash: ' + ask.fnv(JSON.stringify(legacyDecision)) + '\n\n```json\n' + JSON.stringify(identity) + '\n```');
  j(path.join(legacyDir.ledger, 'brain-decisions.json'), { decide: legacyDecision.id });
  let linked = '';
  Object.assign(ctx, { DIR: legacyDir, loadPack: () => structuredClone(legacyDecision), loadAnswers: () => ({ answers: {} }),
    viewOf: id => id === 'W1' ? ({ synthesis: { founderDecisions: [{ question: '選哪條路線？', options: ['A. 路線甲', 'B. 路線乙'] }] } }) : null,
    handleDebateAnswer: (_r, pack) => { linked = pack.debate.matchId; }, requiresFounderAnswer: () => false, hasAnswer: () => true,
    showAns: (_q, v) => v, appendLog() {}, markUnknowns() {}, requiredLeft: () => [] });
  vm.runInContext(section('function handleBrainDecide(', 'function writeCounterparts(') + '\nthis.handleBrainDecide=handleBrainDecide;', ctx);
  ctx.placeFounderDecisions = (key) => ({ ok: true, existing: true, placed: [], packId: legacyDecision.id });
  ctx.handleBrainDecide({ id: 'legacy-request' }, { cardId: 'decide', matchId: 'W1' });
  await ctx.handleAsk({ id: 'legacy-reply' }, 'legacy.md');
  check('N4 舊 decide 鍵依請求場次及題目內容補回身份', linked === 'W1');
  linked = ''; ctx.viewOf = () => ({ synthesis: { founderDecisions: [{ question: '另一張卡', options: ['A. 路線甲', 'B. 路線乙'] }] } });
  await ctx.handleAsk({ id: 'unrelated-reply' }, 'legacy.md');
  check('一般卡片即使編號碰巧相同亦不當成舊場', linked === '');

} catch (e) { total++; console.log('FAIL 測試執行：' + e.stack); }
finally { process.chdir(previous); if (previousData == null) delete process.env.SOS_DATA; else process.env.SOS_DATA = previousData; fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
