// 真實事件鏈測試（缺口 1、3、4；唔開瀏覽器，用假 AI、隔離資料夾）
// 起點：已確認公司概覽但帳本未有里程碑（虛構「從田間到餐桌」舊格式夾具）＝補種子嘅情況
// 用法：node event-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const { oldInstall } = await import(new URL('../fixtures/old-install.mjs', import.meta.url).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(new URL('file:///' + path.join(PROTO, 'ask-lib.mjs').replace(/\\/g, '/')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true });
const DATA = path.join(OUT, 'data');
for (const d of ['company', 'ledger']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
const FX = oldInstall(DATA, PROTO);
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; }
const state = () => JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const runsOf = async () => (await get('/api/status')).runs;
const newRun = async (seen, pred) => waitFor(async () => (await runsOf()).find(r => !seen.has(r.id) && pred(r) && (r.state === 'done' || r.state === 'failed')));
const seenIds = async () => new Set((await runsOf()).map(r => r.id));
const pack = id => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', id + '.json'), 'utf8'));
function answer(P, pick) {
  const answers = P.questions.map(q => { const v = pick ? pick(q) : q.value; return { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; });
  const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: P.questions.map(q => q.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
function proofread(edits) {
  const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8')), c = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'confirmed.json'), 'utf8'));
  const machine = { format: 'startup-os.proofread-reply/0.1', page: page.page.id, company: page.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: c.order, orderProposed: c.order, orderChanged: false, nextActionMilestone: c.nextActionMilestone, decided: [], edits, keptAsAI: [], tentativeKept: [], stillMissing: [], note: '' };
  const head = ['kind: proofread', 'ref: ' + page.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(page)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'proofread', ref: page.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
const shown = P => [P.title, P.context, ...P.questions.flatMap(q => [q.ask, q.judge, q.why, q.value, ...(q.options || []).map(o => o.text)])];

try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 15000);
  ok('伺服器版本同程式一致（' + lib.SERVER_VERSION + '）', (await get('/api/status')).version === lib.SERVER_VERSION, (await get('/api/status')).version);
  await post('/api/setup', { action: 'certify', host: 'test' });
  const cert = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('假 AI 認證通過', cert && cert.state === 'passed', cert && cert.state);
  ok('起點：已確認公司概覽、帳本未有里程碑', !fs.existsSync(path.join(DATA, 'ledger', 'state.json')) || !(state().milestones || []).length);
  const d0 = await get('/api/dashboard');
  ok('監察台（未種子）已由公司概覽列出假設清單：全部仍是假設級', d0.assumptions.list.length === 3 && d0.assumptions.guess === 3 && d0.assumptions.acted === 0, d0.assumptions);

  // 入口檢查
  const bad1 = await post('/api/intake', { kind: 'note', type: 'event', text: '與 陳先生 會面', date: '' });
  ok('真實事件：未揀日期即拒收並講原因', bad1.code === 400 && /日期/.test(bad1.j.message), bad1);
  const bad2 = await post('/api/intake', { kind: 'note', type: 'event', text: '', date: '2026-10-29' });
  ok('真實事件：未寫內容即拒收', bad2.code === 400, bad2);

  // 缺口 1：記錄真實事件 → AI 擬確認問題 → 外殼出包
  let seen = await seenIds();
  const TEXT = '10 月 29 日與 農場丙的陳先生 視像會面：對方答應介紹兩間餐廳，並約定 11 月 5 日再談分帳。';
  const sub = await post('/api/intake', { kind: 'note', type: 'event', text: TEXT, date: '2026-10-29', files: [{ name: '會後紀錄.md', data: Buffer.from('# 會後紀錄\n陳先生 答應介紹兩間餐廳。').toString('base64') }] });
  ok('真實事件：收到', sub.code === 202 && sub.j.id, sub);
  let r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  ok('真實事件：AI 工作完成', r && r.state === 'done', r && { state: r.state, error: r.error, steps: r.steps.map(s => s.key + ':' + s.state) });
  let s = state();
  ok('補種子：帳本嘅站同假設數目同公司概覽一樣，全部由公司概覽同步', s.milestones.length === FX.milestones && s.company.assumptions.length === FX.assumptions && s.ledgerFrom && ['complete', 'incomplete'].includes(s.intake.state), { ms: s.milestones.length, as: s.company.assumptions.length, from: s.ledgerFrom });
  let input = s.inputs.find(i => i.id === 'in-' + sub.j.id);
  ok('輸入已登記：事件日期係你填嘅 10 月 29 日、等你確認、證明文件已封存', input && input.eventDate === '2026-10-29' && input.status === 'awaitingFounder' && input.files.length === 1 && fs.existsSync(path.join(DATA, input.file)) && fs.existsSync(path.join(DATA, input.files[0])), input);
  ok('收件匣已清空（筆記同證明文件搬去封存）', fs.readdirSync(path.join(DATA, 'founder', 'inbox')).length === 0, fs.readdirSync(path.join(DATA, 'founder', 'inbox')));
  const P1 = pack(input.packId);
  ok('確認問題包：外殼生成，2 條即時生效題，各有建議、理由同套用內容', P1.realEvent && P1.questions.length === 2 && P1.questions.every(q => q.effect === 'now' && q.why && q.value && q.options.length === 2 && q.options.every(o => o.apply)), P1.questions.map(q => q.ask + ' | ' + q.value));
  const hits = shown(P1).flatMap(t => N.styleIssues(String(t || '')).map(h => h.term));
  ok('確認問題包畫面文字：零內部術語、零口語字、零編號', !hits.length, hits);
  ok('AI 工作說明有列可用的站同假設（ledger.json）', fs.existsSync(path.join(DATA, 'sandbox', r.id, 'ledger.json')) && fs.readFileSync(path.join(DATA, 'sandbox', r.id, 'task-seen.md'), 'utf8').includes('out/event.json'));
  let dash = await get('/api/dashboard');
  ok('監察台：待你處理有確認真實事件、現實輸入「等你回覆」有一項', dash.todo.some(t => t.id === P1.id) && dash.inputs.awaiting.some(a => a.packId === P1.id), { todo: dash.todo.map(t => t.text), awaiting: dash.inputs.awaiting });

  // 你確認：照 AI 建議（一按）
  seen = await seenIds();
  const sent = await answer(P1);
  ok('送出確認', sent.code === 200, sent);
  r = await newRun(seen, x => x.kind === 'ask' && x.ref === P1.id);
  ok('套用完成', r && r.state === 'done', r && r.result);
  s = state(); input = s.inputs.find(i => i.id === input.id);
  const celebration = (s.celebrations?.entries || []).at(-1);
  ok('同一次確認只記一筆最高級，並列另一項', s.celebrations?.entries.length === 1 && celebration?.level === 'top' && celebration.also?.length === 1, celebration);
  const statusBefore = await get('/api/status');
  ok('狀態回傳未看的紀錄', statusBefore.celebrations.some(e => e.id === celebration?.id) && statusBefore.company.firstFlagSeen === false, statusBefore.celebrations);
  const missingPass = await fetch(BASE + '/api/celebrations/seen', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: 'invalid=1' }, body: JSON.stringify({ id: celebration?.id }) });
  const wrongOrigin = await fetch(BASE + '/api/celebrations/seen', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://example.invalid' }, body: JSON.stringify({ id: celebration?.id }) });
  ok('沒有通行證或來源錯誤均拒絕', missingPass.status === 403 && wrongOrigin.status === 403, [missingPass.status, wrongOrigin.status]);
  const unknownCelebration = await post('/api/celebrations/seen', { id: 'unknown' });
  const claim = await post('/api/celebrations/seen', { id: celebration?.id });
  const againClaim = await post('/api/celebrations/seen', { id: celebration?.id });
  const statusAfter = await get('/api/status');
  ok('領取只成功一次，已看後不再顯示，未知編號拒絕', unknownCelebration.code === 400 && claim.j?.claimed === true && againClaim.j?.claimed === false && !statusAfter.celebrations.some(e => e.id === celebration?.id) && statusAfter.company.firstFlagSeen === true, { unknownCelebration, claim, againClaim });
  const q1 = P1.questions[0].options[0].apply, q2 = P1.questions[1].options[0].apply;
  const as = s.company.assumptions.find(a => a.id === q1.id), ms = s.milestones.find(m => m.id === q2.id);
  ok('假設級別：由「假設」改為「實際行動」，狀態轉為有支持，來源記這件事，日期係事件日期', as.grade === 'did' && as.status === 'supported' && as.sourceId === input.id && as.changedAt === '2026-10-29', as);
  ok('站點完成：完成日期係事件日期、證明係封存嘅紀錄同文件', ms.state === 'done' && ms.doneAt === '2026-10-29' && ms.doneEvidence.length === 2 && ms.doneEvidence.every(f => fs.existsSync(path.join(DATA, f))), ms);
  // 0.24 站點完成後（規劃書 3.3）：小旗掛喺完成咗嘅站 → 同一份確認加「下一個對外動作」題，答咗先算處理完
  const nad = pack(P1.id).questions.find(q => q.id === 'nad');
  if (nad) {
    ok('站點完成後：同一份確認加「下一個對外動作」題，未答前小旗標待更新', input.status === 'awaitingFounder' && s.company.nextExternalAction.pendingUpdate === true && nad.options[0].rec, { status: input.status, nea: s.company.nextExternalAction });
    seen = await seenIds();
    await answer(pack(P1.id));
    r = await newRun(seen, x => x.kind === 'ask' && x.ref === P1.id);
    s = state(); input = s.inputs.find(i => i.id === input.id);
    ok('答咗小旗題：小旗移去進行中嘅站', !s.company.nextExternalAction.pendingUpdate && s.company.nextExternalAction.milestoneId !== q2.id, s.company.nextExternalAction);
  }
  ok('輸入收據：兩項影響（站點完成後加小旗一項）、已處理', input.status === 'processed' && input.effects.length === (nad ? 3 : 2), input.effects);
  const evs = s.events.filter(e => (e.relatedIds || []).includes(input.id));
  ok('事件流：記錄真實事件、證據級更新、站點完成各一筆', evs.some(e => e.type === 'input' && /記錄真實事件/.test(e.title)) && evs.some(e => e.type === 'input' && /證據級更新/.test(e.title)) && evs.some(e => e.type === 'milestone' && /站點完成/.test(e.title)), evs.map(e => e.type + ':' + e.title));
  dash = await get('/api/dashboard');
  ok('監察台進度證據：假設清單變為 2 條仍是假設級 · 1 條已有實際行動', dash.assumptions.guess === 2 && dash.assumptions.acted === 1, dash.assumptions);
  ok('監察台路徑：該站顯示已完成', dash.milestones.find(m => m.id === ms.id).state === 'done');
  ok('監察台最近發生有站點完成同證據級更新', dash.recent.some(e => /站點完成/.test(e.title)) && dash.recent.some(e => /證據級更新/.test(e.title)), dash.recent.map(e => e.title));
  ok('監察台現實輸入「最近已處理」列出影響', dash.inputs.recent.some(i => i.id === input.id && i.effects.length === (nad ? 3 : 2)), dash.inputs.recent);
  const dashLines = [dash.recent.map(e => e.title), dash.inputs.recent.flatMap(i => i.effects)].flat();
  const dHits = dashLines.flatMap(t => N.styleIssues(t).map(h => h.term));
  ok('監察台新文字：零內部術語、零編號、零口語字', !dHits.length, dHits);

  // 同一包再送一次：唔會重複套用
  seen = await seenIds();
  await answer(pack(P1.id));
  await newRun(seen, x => x.kind === 'ask' && x.ref === P1.id);
  s = state();
  ok('同一包再送：唔會重複套用（影響項數不變、事件冇多）', s.inputs.find(i => i.id === input.id).effects.length === (nad ? 3 : 2) && s.events.filter(e => (e.relatedIds || []).includes(input.id)).length === evs.length);

  // 缺口 4：再次成頁確認，改動唔影響下一步 → 唔開 AI；帳本進度保留
  seen = await seenIds();
  await proofread([{ id: 's2', plan: 'G4', label: '餐廳接觸過', ai: '未發生', founder: '實際行動', value: 'did' }]);
  r = await newRun(seen, x => x.kind === 'proofread');
  ok('再次確認（只改程度）：唔開 AI，講明原因', r && r.state === 'done' && !r.steps.some(x => x.key === 'ai') && r.result.summary === N.ui.aiNextSkip, r && { steps: r.steps.map(x => x.key), summary: r.result && r.result.summary });
  s = state();
  ok('再次確認後同步：站點完成同假設級別保留', s.milestones.find(m => m.id === ms.id).state === 'done' && s.company.assumptions.find(a => a.id === as.id).grade === 'did');
  seen = await seenIds();
  const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8')), g5 = page.glance.rows.find(x => x.plan === 'G5');
  await proofread([{ id: g5.id, plan: 'G5', label: g5.label, ai: g5.value, founder: '11 月 5 日與 陳先生 再談分帳', value: '11 月 5 日與 陳先生 再談分帳' }]);
  r = await newRun(seen, x => x.kind === 'proofread');
  ok('再次確認（改下一個對外動作）：照開 AI 準備下一步', r && r.state === 'done' && r.steps.some(x => x.key === 'ai'), r && r.steps.map(x => x.key + ':' + x.state));

  // 修正一次：AI 第一次交錯格式
  mode('event:event-bad');
  seen = await seenIds();
  const sub2 = await post('/api/intake', { kind: 'note', type: 'event', text: '11 月 5 日 陳先生 回覆：暫時不能出資。', date: '2026-11-05' });
  r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  ok('AI 第一次格式錯：外殼叫 AI 修正一次後出包', r && r.state === 'done' && /修正一次/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')) && (r.result.asks || []).length === 1, r && { state: r.state, error: r.error });
  // 證據級題答「維持」：唔改級，收據記低維持
  const in2 = state().inputs.find(i => i.id === 'in-' + sub2.j.id), P2 = pack(in2.packId), qa = P2.questions.find(q => q.options[0].apply.op === 'setAssumptionGrade');
  const before = state().company.assumptions.find(a => a.id === qa.options[0].apply.id).grade;
  seen = await seenIds();
  await answer(P2, q => q === qa ? q.options[1].text : q.value);
  await newRun(seen, x => x.kind === 'ask' && x.ref === P2.id);
  s = state();
  ok('答「維持」：級別不變，收據記低維持', s.company.assumptions.find(a => a.id === qa.options[0].apply.id).grade === before && s.inputs.find(i => i.id === in2.id).effects.some(e => /維持/.test(e.change)), s.inputs.find(i => i.id === in2.id).effects);

  // 冇影響：AI 交空清單 → 唔出包，講明
  mode('event:event-none');
  seen = await seenIds();
  const sub3 = await post('/api/intake', { kind: 'note', type: 'event', text: '收到 陳先生 的電郵，內容只是問候。', date: '2026-11-06' });
  r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  ok('冇影響：唔出問題包，記錄並講明', r && r.state === 'done' && !(r.result.asks || []).length && r.result.summary.includes(N.ui.eventNoChange) && state().inputs.find(i => i.id === 'in-' + sub3.j.id).status === 'processed', r && r.result);

  // 缺口 3：提示句建議 → 「不知道／稍後提供」；答咗之後到期前唔再問
  const raw = { format: 'startup-os.ask/0.1', title: '會面前的資料', questions: [
    { id: 'start', ask: '10 月 29 日與 陳先生 視像會面，實際開始時間是甚麼？', kind: 'text', value: '請直接填寫時間，例如「下午 3 時」', why: '訊息要寫明時間。' },
    { id: 'how', ask: '訊息應如何處理開始時間？', options: [{ text: '訊息不寫時間，請對方回覆方便的時段', rec: true }, { text: '我自己寫明時間' }], value: '訊息不寫時間，請對方回覆方便的時段', why: '對方可揀時段。' }] };
  const prep = lib.preparePacks(raw, { dirs: { ledger: path.join(DATA, 'ledger') }, strictTitle: false });
  const qs = prep.packs[0].questions, qStart = qs.find(q => q.id === 'start'), qHow = qs.find(q => q.id === 'how');
  ok('提示句建議改為「不知道／稍後提供」選項並作建議，原句留作提示', qStart.kind === 'choice' && qStart.value === N.ui.unknownLater && qStart.options.some(o => o.text === N.ui.unknownLater && o.rec) && /請直接填寫/.test(qStart.hint), qStart);
  ok('真答案建議照用，只把「我自己寫明」選項換成「不知道／稍後提供」', qHow.value === raw.questions[1].value && qHow.options.some(o => o.text === N.ui.unknownLater) && !qHow.options.some(o => /我自己寫明/.test(o.text)), qHow.options);
  // 放一個包（帶跟進工作）上去，照建議答（＝不知道）
  const P3 = { ...prep.packs[0], id: 'ask-test-unknown', next: { task: '按答案更新約見訊息' }, askedBy: 'AI', askedAt: lib.localIso() };
  fs.writeFileSync(path.join(DATA, 'asks', P3.id + '.json'), JSON.stringify(P3));
  seen = await seenIds();
  await answer(P3);
  r = await newRun(seen, x => x.kind === 'ask' && x.ref === P3.id);
  s = state();
  const md = (s.intake.missingDetails || []).find(m => m.qid === 'start');
  ok('答「不知道／稍後提供」：記入缺少的細節，一星期後到期', md && !md.answeredAt && md.until > lib.localIso().slice(0, 10), s.intake.missingDetails);
  const seenTask = fs.readFileSync(path.join(DATA, 'sandbox', r.id, 'task-seen.md'), 'utf8');
  ok('之後 AI 工作說明列出「不知道」的事項，叫 AI 到期前不要再問', seenTask.includes('創辦人已答「' + N.ui.unknownLater + '」的事項') && seenTask.includes('實際開始時間'), seenTask.slice(-400));
  const again = lib.preparePacks({ format: 'startup-os.ask/0.1', title: '會面時間', questions: [{ id: 'st2', ask: '10 月 29 日與 陳先生 的視像會面，實際開始時間是幾點？', kind: 'text', value: '下午 3 時', why: '訊息要寫明時間。' }, { id: 'jk', ask: '10 月 27 日與乙公司 林小姐 會面的結果是甚麼？', kind: 'text', value: '暫無共識', why: '要知道乙公司立場。' }] }, { dirs: { ledger: path.join(DATA, 'ledger') }, strictTitle: false });
  ok('換個講法再問同一件事：到期前拎走；唔同嘅事照問', again.packs[0].questions.length === 1 && again.packs[0].questions[0].id === 'jk' && again.dropped.length === 1, { kept: again.packs[0].questions.map(q => q.id), dropped: again.dropped });
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), log);
  process.exit(pass === results.length ? 0 : 1);
}
