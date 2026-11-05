// 生意大腦觸發表補完測試（規劃書 4.6；假 AI、隔離資料夾）：
// (a) 生意體檢之後 AI 以確認類待決定建議開紅藍對打（答「開始」先開場；已有一包未答唔再放）；
// (b) 日常工作 AI 建議每個對象嘅下一步，成為工作（每個對象一項、唔重複、唔存在嘅對象唔收）；
// (c) 商機寫成臨時工作建議或路徑選項，經決定先做（做成臨時工作／考慮改路線行返要求流程；不再提寫入下次掃描）；
// (d) 弱位寫成假設清單嘅最便宜測試：同步公司概覽唔會洗走；上次由體檢寫嘅會更新，公司概覽寫嘅唔郁。
// 用法：node brain-c2-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const { SEATS } = await import(pathToFileURL(path.join(PROTO, 'debate-lib.mjs')).href);
const { seedCompany } = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
seedCompany(DATA, PROTO);
// 公司概覽嘅假設先唔寫測試（體檢只填未有測試、或者上次由體檢寫嘅）
{ const pf = path.join(DATA, 'company', 'page.json'), pg = JSON.parse(fs.readFileSync(pf, 'utf8')); const it = Array.isArray(pg.detail.assumptions) ? pg.detail.assumptions : pg.detail.assumptions.items; for (const a of it) { delete a.test; if (a.tentative) delete a.tentative.test; } fs.writeFileSync(pf, JSON.stringify(pg, null, 2)); }
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const readJ = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const page = () => readJ(path.join(DATA, 'company', 'page.json'));
const state = () => readJ(path.join(DATA, 'ledger', 'state.json'), {});
const brainOf = k => readJ(path.join(DATA, 'ledger', 'brain', k + '.json'));
const runsOf = async () => (await get('/api/status')).runs;
const seenIds = async () => new Set((await runsOf()).map(r => r.id));
const newRun = async (seen, pred, ms) => waitFor(async () => (await runsOf()).find(r => !seen.has(r.id) && pred(r) && (r.state === 'done' || r.state === 'failed')), ms);
const openPacks = async () => (await get('/api/asks')).packs.filter(p => p.open).map(p => readJ(path.join(DATA, 'asks', p.id + '.json'))).filter(Boolean);
const offerOf = async k => (await openPacks()).filter(p => p.rhythm && p.rhythm.kind === k);
const idle = () => waitFor(async () => { const d = await get('/api/dashboard'); return !d.ai.busy && !fs.readdirSync(path.join(DATA, 'founder', 'inbox')).some(f => f.endsWith('.md')); }, 90000);
const asmOf = id => ((state().company || {}).assumptions || []).find(a => a.id === id);
function proofread() {
  const p = page(), order = p.path.milestones.map(m => m.id), kinds = Object.fromEntries(order.map((id, i) => [id, i === 2 ? 'task' : 'real']));
  const machine = { format: 'startup-os.proofread-reply/0.1', page: p.page.id, company: p.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds, kindsChanged: [] };
  const head = ['kind: proofread', 'ref: ' + p.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(p)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'proofread', ref: p.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
// 作答：values 指定某幾條揀乜（冇指定就照 AI 建議）
function answer(P, values = {}) {
  const answers = P.questions.map(q => { const v = values[q.id] ?? q.value; return { id: q.id, value: v, ai: q.value, changed: v !== q.value }; });
  const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: P.questions.map(q => q.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
async function answerRun(P, values) { const seen = await seenIds(); await answer(P, values); return newRun(seen, r => r.kind === 'ask' && r.ref === P.id); }
const monthlyPack = id => { const P = { format: 'startup-os.ask/0.1', id, title: '每月覆核（測試）', askedBy: 'AI', askedAt: lib.localIso(), todoType: 'decision', rhythm: { kind: 'monthly' }, afterConfirm: '答案即時生效',
  questions: [{ id: 'perm', ask: N.ui.monthlyPerm, kind: 'choice', options: [{ text: N.ui.monthlyPermKeep, rec: true }, { text: N.ui.monthlyPermNarrow }], value: N.ui.monthlyPermKeep, effect: 'now', priority: 1, why: '測試理由' }] };
  fs.writeFileSync(path.join(DATA, 'asks', id + '.json'), JSON.stringify(P)); return P; };
const rhythm = () => new Promise(res => { const c = spawn(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'rhythm', '--trigger', 'manual'], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' }); c.on('exit', res); });
const lastRhythm = () => { const rr = (state().runs || []).filter(r => r.type === 'rhythm').pop(); return rr && (readJ(path.join(DATA, 'ledger', 'status.json'), { runs: [] }).runs.find(r => r.id === rr.id)); };
const plainOf = P => [P.title, P.context, P.afterConfirm, ...P.questions.flatMap(q => [q.ask, q.why, ...(q.options || []).map(o => o.text)])].join('\n').replace(/（測試[^）]*）[^\n」]*/g, '');

// 瀏覽器
const cport = Number(PORT) + 5;
let chrome = null, ws = null; const errors = [];
let seq = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(e + ' -> ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
const text = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
async function openChrome() {
  chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${cport}`, `--user-data-dir=${path.join(OUT, 'profile')}`, 'about:blank'], { stdio: 'ignore' });
  let list = null; for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${cport}/json/list`)).json(); } catch { await sleep(250); } }
  ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => { ws.onopen = r; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { const p = pend.get(d.id); pend.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await usePass(BASE, { send });
}
const go = async u => { await send('Page.navigate', { url: BASE + u }); await sleep(2200); };
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); }

try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 60000);
  await post('/api/setup', { action: 'certify', host: 'test' });
  const cert = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('假 AI 認證通過', cert && cert.state === 'passed', cert);

  /* 成頁確認：首次生意體檢 → (d) 最便宜測試寫入假設清單 → (a) 建議開辯論 */
  let seen = await seenIds();
  await proofread();
  const r1 = await newRun(seen, r => r.kind === 'proofread');
  const ck = brainOf('checkup');
  ok('成頁確認嗰次工作做咗生意體檢', r1 && r1.state === 'done' && ck && ck.weak.length === 2, r1 && r1.steps);
  const [w1, w2] = ck.weak;
  ok('(d) 弱位嘅最便宜測試寫入假設清單，標明出自生意體檢', [w1, w2].every(w => { const a = asmOf(w.assumptionId); return a && a.cheapestTest === w.cheapestTest && a.cheapestTestBy === 'checkup'; }), [w1, w2].map(w => asmOf(w.assumptionId)));
  // 規劃書出題規則第 8 條（所有 AI 建議都守）：體檢工作說明有「唔可以同已確認嘅計劃矛盾」，帳本摘要有齊已確認值
  const ckSb = path.join(DATA, 'sandbox', r1.id + '-checkup'), ckTask = fs.readFileSync(path.join(ckSb, 'task.md'), 'utf8'), ckL = readJ(path.join(ckSb, 'ledger.json'), {});
  const stMs = (state().milestones || []).filter(m => m.pathStatus !== 'retired').sort((a, b) => (a.order || 0) - (b.order || 0));
  ok('體檢工作說明：唔可以同已確認嘅計劃矛盾（矛盾寫入「你可能未想到」等創辦人確認）；帳本摘要有次序、是否已確認、進度、本季目標、下一個對外動作',
    ckTask.includes('唔可以同已確認嘅計劃矛盾') && ckTask.includes('到第幾站時可以做') && ckTask.includes('要創辦人確認以邊個為準')
    && Array.isArray(ckL.milestones) && ckL.milestones.length === stMs.length && ckL.milestones.every((m, i) => m.order === i + 1 && m.id === stMs[i].id && m.confirmed === (stMs[i].pathStatus === 'confirmed') && m.state === (stMs[i].state || 'not_started'))
    && 'quarterGoal' in ckL && typeof ckL.quarterGoal === 'string' && 'nextExternalAction' in ckL, { rule: ckTask.includes('唔可以同已確認嘅計劃矛盾'), ms: ckL.milestones, goal: ckL.quarterGoal });
  const offers1 = await offerOf('debate'), D1 = offers1[0];
  ok('(a) 生意體檢之後：一包確認類待決定建議開辯論（屬生意大腦紅藍對打）', offers1.length === 1 && D1.todoType === 'decision' && D1.brainItem === 'wargame' && D1.questions.length === 1, offers1.map(p => ({ title: p.title, todoType: p.todoType, brainItem: p.brainItem })));
  const q1 = D1 && D1.questions[0];
  ok('(a) 問題寫明最弱環節、AI 建議「開始」、必須先問、附理由', q1 && q1.ask === N.t('debateOfferAsk', { t: w1.title }) && q1.value === N.ui.debateOfferYes && q1.options.find(o => o.rec).text === N.ui.debateOfferYes && q1.options.some(o => o.text === N.ui.debateOfferNo) && q1.effect === 'now' && q1.why, q1);
  ok('(a) 外殼冇自己開場：未有任何辯論', !(await get('/api/debate')).matches.length, (await get('/api/debate')).matches);
  const d1 = await get('/api/dashboard'), wg1 = d1.brain.items.find(x => x.id === 'wargame');
  ok('(a) 生意大腦：紅藍對打顯示等你，入口去建議包', wg1.status === 'waiting' && wg1.waitHref === '/#/ask/' + D1.id && wg1.waitText === N.dash.brainWait_wargame, { status: wg1.status, href: wg1.waitHref, t: wg1.waitText });
  ok('(a) 建議包留在生意大腦，不佔主線待決', d1.brainTodo.some(t => t.id === D1.id && t.brain === 'wargame' && t.type === 'decision') && !d1.todo.some(t => t.id === D1.id), d1.brainTodo.map(t => [t.id, t.brain, t.type]));
  const hitsD = N.styleIssues(plainOf(D1));
  ok('(a) 建議包文字：用字檢查零命中、冇內部編號', !hitsD.length && !/\bH\d+\b|weak-|ask-/.test(plainOf(D1)), hitsD);

  /* (d) 同步公司概覽唔會洗走體檢寫嘅測試（之前每次外殼開工同步都會洗走） */
  seen = await seenIds();
  await post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: w2.id, verdict: 'useful', text: '' });
  await newRun(seen, r => r.kind === 'note' && r.noteType === 'feedback');
  ok('(d) 之後再開工（同步公司概覽）：體檢寫嘅最便宜測試照留', [w1, w2].every(w => { const a = asmOf(w.assumptionId); return a && a.cheapestTest === w.cheapestTest && a.cheapestTestBy === 'checkup'; }), [w1, w2].map(w => asmOf(w.assumptionId)));

  /* (d) 第二次體檢：上次體檢寫嘅更新；公司概覽寫嘅唔郁 */
  const p = page(), a2 = asmOf(w2.assumptionId), items = Array.isArray(p.detail.assumptions) ? p.detail.assumptions : p.detail.assumptions.items;
  const pi = items.find(x => x.id === a2.pageRef); pi.test = '創辦人寫的測試：本週打電話問一次';
  fs.writeFileSync(path.join(DATA, 'company', 'page.json'), JSON.stringify(p, null, 2));
  const ckPath = path.join(DATA, 'ledger', 'brain', 'checkup.json');
  fs.writeFileSync(ckPath, JSON.stringify({ ...brainOf('checkup'), updatedAt: lib.localIso(new Date(Date.now() - 30 * 86400000)) }));
  mode('checkup:checkup-new');
  const m1 = await answerRun(monthlyPack('ask-test-monthly-c2'));
  const ck2 = brainOf('checkup');
  ok('(d) 每月覆核重做體檢', m1 && m1.state === 'done' && ck2 && ck2.weak[0].cheapestTest === '（測試新）本週請對方試用一次', m1 && m1.steps);
  const b1 = asmOf(w1.assumptionId), b2 = asmOf(w2.assumptionId);
  ok('(d) 上次由生意體檢寫嘅測試：換成今次嘅', b1.cheapestTest === '（測試新）本週請對方試用一次' && b1.cheapestTestBy === 'checkup', b1);
  ok('(d) 公司概覽寫嘅測試：唔郁', b2.cheapestTest === '創辦人寫的測試：本週打電話問一次' && b2.cheapestTestBy !== 'checkup', b2);
  ok('(a) 上一包未答：第二次體檢唔再放第二包', (await offerOf('debate')).length === 1, (await offerOf('debate')).map(p => p.id));

  /* (a) 答「開始」：外殼開場，用體檢最弱環節做題目 */
  const a1 = await answerRun(D1);
  const ms = (await get('/api/debate')).matches, mt = ms[ms.length - 1];
  const mj = mt && readJ(path.join(DATA, 'debates', mt.id, 'match.json'));
  ok('(a) 答「開始」：開咗一場辯論，題目係體檢最弱環節，席位同力度用預設', a1 && a1.state === 'done' && ms.length === 1 && mj && mj.topic.type === 'business' && mj.topic.title === N.t('debateOfferTopic', { t: w1.title }) && JSON.stringify(mj.roles.red.personas) === JSON.stringify(SEATS.business) && mj.level === 'normal' && mj.offerPackId === D1.id, mj && { topic: mj.topic, seats: mj.roles.red.personas, level: mj.level, next: mj.next });
  ok('(a) 紀錄：你開始一場辯論（創辦人輸入）', (state().events || []).some(e => e.actor === 'founder' && e.title.startsWith('開始一場辯論：') && (e.relatedIds || []).includes(D1.id)), (state().events || []).slice(-3));

  // 辯論逐回合做完（等你回應）先開日常工作：外殼一次只做一件，辯論回合做緊時日常工作會跳過
  const dm = await waitFor(async () => { const m = (await get('/api/debate/match?id=' + mt.id)).match; return m && (m.phase === 'done' || m.phase === 'failed') ? m : null; }, 120000);
  ok('(a) 辯論逐回合做完，等你回應', dm && dm.phase === 'done', dm && dm.phase);

  /* 日常工作（訪問日）：商機掃描 + 每個對象嘅下一步 */
  const sp = path.join(DATA, 'ledger', 'state.json');
  const interviewToday = () => { const s = state(); s.interviews = { ...(s.interviews || {}), nextOn: lib.localIso().slice(0, 10) }; fs.writeFileSync(sp, JSON.stringify(s, null, 2)); };
  await idle(); interviewToday();
  await rhythm();
  const st1 = lastRhythm(), L1 = st1 ? readJ(path.join(DATA, 'sandbox', st1.id, 'ledger.json'), {}) : {};
  ok('(b) 日常工作嘅公司紀錄摘要有每個對象（推進位置用名稱）', (L1.prospects || []).length === 5 && L1.prospects.every(x => x.id && x.name && x.stage === '未接觸' && x.next), L1.prospects);
  const pn = () => (state().tasks || []).filter(t => t.prospectId);
  const pn1 = pn();
  ok('(b) 每個對象一項 AI 工作，唔存在嘅對象唔收', pn1.length === 5 && pn1.every(t => t.owner === 'ai' && t.status === 'planned' && /^（測試）準備與/.test(t.title)) && !pn1.some(t => t.prospectId === 'pr-nobody'), pn1);
  const pipe1 = (await get('/api/dashboard')).brain.items.find(x => x.id === 'pipeline').detail.prospects;
  ok('(b) 客戶推進板：下一步用 AI 建議嘅工作，標明 AI 建議；格位唔郁', pipe1.every(x => x.nextBy === 'ai' && pn1.some(t => t.id === x.nextTaskId && t.title === x.next) && x.stage === 0), pipe1.map(x => [x.name, x.next, x.nextBy, x.stage]));
  ok('(b) 紀錄：AI 更新咗對象嘅下一步', (state().events || []).some(e => e.title === N.t('prospectEvent', { n: 5 })), (state().events || []).slice(-4).map(e => e.title));

  const O1 = (await offerOf('opportunity'))[0], op1 = brainOf('opportunities');
  ok('(c) 商機掃描之後：一包確認類待決定，每個機會一條（屬生意大腦商機掃描）', O1 && O1.todoType === 'decision' && O1.brainItem === 'opportunities' && O1.questions.length === op1.list.length && O1.questions.every((q, i) => q.opp === op1.list[i].id && q.effect === 'now'), O1 && O1.questions);
  ok('(c) AI 建議：唔改路線嘅做成臨時工作、要改路線嘅考慮改路線；選項有暫不、不再提', O1 && O1.questions[0].value === N.ui.oppTask && O1.questions[1].value === N.ui.oppRoute && O1.questions.every(q => [N.ui.oppTask, N.ui.oppRoute, N.ui.oppLater, N.ui.oppDrop].every(t => q.options.some(o => o.text === t)) && q.options.filter(o => o.rec).length === 1), O1 && O1.questions.map(q => [q.value, q.options]));
  ok('(c) 每條附點解有關同第一個測試', O1 && O1.questions.every((q, i) => q.why.includes(op1.list[i].firstTest)), O1 && O1.questions.map(q => q.why));
  const opItem = (await get('/api/dashboard')).brain.items.find(x => x.id === 'opportunities');
  ok('(c) 生意大腦：商機掃描顯示等你，入口去決定包', opItem.status === 'waiting' && opItem.waitHref === '/#/ask/' + O1.id, { status: opItem.status, href: opItem.waitHref });
  const hitsO = N.styleIssues(plainOf(O1));
  ok('(c) 決定包文字：用字檢查零命中', !hitsO.length, hitsO);
  ok('(c) 未決定之前：冇臨時工作、冇改路線要求', !(state().tasks || []).some(t => t.adhoc) && !fs.readdirSync(path.join(DATA, 'founder', 'inbox')).some(f => /-note-(adhoc|order)\.md$/.test(f)));

  /* (b) 再開日常工作：唔重複；AI 冇改字就唔改 */
  await rhythm();
  ok('(b) 再開日常工作：每個對象仍然只有一項工作', pn().length === 5 && pn().every(t => pn1.some(x => x.id === t.id)), pn().map(t => t.id));

  /* (c) 決定：第一個做成臨時工作、第二個考慮改路線 → 外殼代你交要求，行返原有流程 */
  await idle();
  seen = await seenIds();
  await answer(O1);
  const oa = await newRun(seen, r => r.kind === 'ask' && r.ref === O1.id);
  ok('(c) 答咗：已記錄兩個決定', oa && oa.state === 'done' && /做成臨時工作/.test(oa.result.summary) && /考慮因此改路線/.test(oa.result.summary), oa && oa.result);
  const na = await newRun(seen, r => r.kind === 'note' && r.noteType === 'adhoc');
  const no = await newRun(seen, r => r.kind === 'note' && r.noteType === 'order');
  ok('(c) 做成臨時工作：行臨時工作流程（AI 先擬交付內容再問你）', na && na.state === 'done' && (state().tasks || []).some(t => t.adhoc && t.id === 'a-' + na.ref) && (await openPacks()).some(p => p.taskId === 'a-' + na.ref), na && na.result);
  ok('(c) 考慮改路線：行改路線流程（AI 擬選項，你決定先入路線）', no && no.state === 'done' && (await openPacks()).some(p => p.questions.some(q => (q.options || []).some(o => o.apply && o.apply.order))), no && no.result);
  const arch = path.join(DATA, 'archive');
  const archived = fs.readdirSync(arch).flatMap(mo => fs.statSync(path.join(arch, mo)).isDirectory() ? fs.readdirSync(path.join(arch, mo)).filter(f => /-note-(adhoc|order)\.md$/.test(f)).map(f => fs.readFileSync(path.join(arch, mo, f), 'utf8')) : []);
  ok('(c) 要求寫明出自商機（機會、第一個測試、出處）', archived.length === 2 && archived.every(t => /^from: opportunity /m.test(t) && t.includes(O1.id) && !t.includes('```')) && archived.some(t => t.includes('跟進商機「' + op1.list[0].title + '」')) && archived.some(t => t.includes('因應商機「' + op1.list[1].title + '」')), archived);
  ok('(c) 紀錄：你提交臨時工作、要求改路線（創辦人輸入）', ['提交臨時工作：', '要求改路線：'].every(k => (state().events || []).some(e => e.actor === 'founder' && e.title.startsWith(k))), (state().events || []).slice(-6).map(e => e.title));
  const routeBefore = (state().milestones || []).map(m => m.id).join(',');
  ok('(c) 未答改路線選項之前：路線未變', !(state().milestones || []).some(m => m.short === '廚師試食會'), routeBefore);

  /* (c) 第二星期：不再提 → 寫入下一次掃描嘅意見 */
  await idle();
  const opPath = path.join(DATA, 'ledger', 'brain', 'opportunities.json');
  fs.writeFileSync(opPath, JSON.stringify({ ...brainOf('opportunities'), updatedAt: lib.localIso(new Date(Date.now() - 7 * 86400000)) }));
  interviewToday(); mode('opportunities:opp-code');
  await rhythm();
  const O2 = (await offerOf('opportunity'))[0], op2 = brainOf('opportunities');
  ok('(c) AI 寫嘅假設編號：放上 Founder Desk 之前換成假設內容', O2 && !/\bH1\b/.test(O2.questions[0].why) && O2.questions[0].why.includes('假設「' + asmOf('H1').text + '」'), O2 && O2.questions[0].why);
  ok('(c) 下一次掃描：上一包答咗，就放新一包', O2 && O2.id !== O1.id, O2 && O2.id);
  // 上一包未答又再掃描：唔放新一包；舊包嘅機會照答得（內容喺問題包入面，唔靠新結果檔）
  await idle();
  fs.writeFileSync(opPath, JSON.stringify({ ...brainOf('opportunities'), updatedAt: lib.localIso(new Date(Date.now() - 7 * 86400000)) }));
  interviewToday();
  await rhythm();
  const op3 = brainOf('opportunities'), opn = await offerOf('opportunity');
  ok('(c) 上一包未答：再掃描都唔放新一包（掃描結果照更新）', opn.length === 1 && opn[0].id === O2.id && op3.updatedAt !== op2.updatedAt, { open: opn.map(p => p.id), was: op2.updatedAt, now: op3.updatedAt });
  await idle();
  const o2a = await answerRun(O2, { o1: N.ui.oppLater, o2: N.ui.oppDrop });
  const fbAll = readJ(path.join(DATA, 'ledger', 'brain-feedback.json'), {});
  ok('(c) 暫不：乜都唔做；不再提：記成你對嗰張卡嘅意見（舊包照答得）', o2a && o2a.state === 'done' && fbAll[op2.list[1].id] && fbAll[op2.list[1].id].verdict === 'useless' && fbAll[op2.list[1].id].title === op2.list[1].title && !fbAll[op2.list[0].id], fbAll);
  fs.writeFileSync(opPath, JSON.stringify({ ...brainOf('opportunities'), updatedAt: lib.localIso(new Date(Date.now() - 7 * 86400000)) }));
  await idle(); interviewToday();
  await rhythm();
  const st3 = lastRhythm(), fbMd = st3 ? fs.readFileSync(path.join(DATA, 'sandbox', st3.id + '-opportunities', 'feedback.md'), 'utf8') : '';
  ok('(c) 再下一次掃描：工作說明寫入「不再提」（用機會名，唔係「一張結果卡」）', fbMd.includes('「' + op2.list[1].title + '」：沒有用——' + N.ui.oppDropNote), fbMd);

  /* 畫面 */
  await idle();
  await openChrome();
  await go('/dashboard/brain/pipeline');
  ok('客戶推進頁：每個對象下一步標「AI 建議 · 未確認」', (await ev(`[...document.querySelectorAll('#pipeline .pr')].filter(r=>r.innerText.includes(${JSON.stringify(N.dash.aiUnconfirmed)})).length`)) === 5, await text('#pipeline'));
  await shot('c2-pipeline.png');
  await go('/dashboard/brain');
  const waits = await ev(`[...document.querySelectorAll('#wait-strip li')].map(l=>({item:l.dataset.item,t:l.innerText}))`);
  ok('生意大腦總覽：等你處理有商機決定', waits.some(w => w.item === 'opportunities'), waits);
  await shot('c2-brain.png');
  const O3 = (await offerOf('opportunity'))[0];
  if (O3) { await go('/#/ask/' + O3.id); await shot('c2-desk-opportunity.png'); const dt = await text('#app'); ok('Founder Desk：商機決定包顯示每個機會一條', dt.includes(N.ui.oppTask) && dt.includes(N.t('oppAsk', { t: brainOf('opportunities').list[0].title })), dt.slice(0, 400)); }
  else ok('Founder Desk：商機決定包顯示每個機會一條', false, 'no open opportunity pack');
  ok('頁面冇程式錯誤', !errors.length, errors);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  try { ws && ws.close(); } catch { } try { chrome && chrome.kill(); } catch { } srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), log);
  process.exit(pass === results.length ? 0 : 1);
}
