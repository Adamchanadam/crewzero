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
  { const evMd = fs.readFileSync(path.join(DATA, 'sandbox', r.id, 'event.md'), 'utf8'); ok('event.md 逐份列出附件檔名（不只寫份數）', /證明文件：1 份（在 files\/）/.test(evMd) && evMd.includes('  - files/會後紀錄.md'), evMd.slice(0, 200)); }
  { const ai = fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8'); ok('工作說明：PDF 整份一次讀、不用 pages；Word／PowerPoint／Excel 要如實列出未能讀取及建議另存 PDF', /一次過讀整份/.test(ai) && /唔好用 `pages` 參數/.test(ai) && /Word、PowerPoint、Excel/.test(ai) && /另存為 PDF/.test(ai)); }
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

  // 0.39.1 第八輪-6：四份各 80 字檔名的 Word 附件讀不到 → 摘要只寫事件重點（≤300 字），未能讀取的檔案走獨立清單，結果卡及真實進展逐份顯示
  mode('event:event-unread');
  seen = await seenIds();
  const longDocs = ['甲', '乙', '丙', '丁'].map(c => ({ name: c.repeat(75) + '.docx', data: Buffer.from('PK fake docx').toString('base64') }));
  const sub6 = await post('/api/intake', { kind: 'note', type: 'event', text: '11 月 7 日 陳先生 寄來四份 Word 附件，內容未能閱讀。', date: '2026-11-07', files: longDocs });
  ok('第八輪-6：四份長檔名 Word 附件的事件：收到', sub6.code === 202 && sub6.j.id, sub6);
  r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  const in6 = state().inputs.find(i => i.id === 'in-' + sub6.j.id);
  ok('第八輪-6：事件處理成功（不因未能讀取而被 300 字上限拒絕），摘要只寫事件重點', r && r.state === 'done' && in6 && in6.summary.length <= 300 && !longDocs.some(d => in6.summary.includes(d.name.slice(0, 10))), r && { state: r.state, error: r.error, summary: in6 && in6.summary });
  ok('第八輪-6：事件紀錄保留結構化的「未能讀取的檔案」，四份逐份列出且檔名完整', in6 && Array.isArray(in6.unreadable) && in6.unreadable.length === 4 && longDocs.every(d => in6.unreadable.some(u => u.file === d.name && /讀不到/.test(u.reason))), in6 && in6.unreadable);
  ok('第八輪-6：結果卡（工作結果）帶同一份清單', r && r.result && Array.isArray(r.result.unreadable) && r.result.unreadable.length === 4, r && r.result);
  const dash6 = await get('/api/dashboard');
  const ev6 = (dash6.inputs.events || []).find(e => e.id === in6.id);
  ok('第八輪-6：監察台「真實進展」的事件紀錄帶未能讀取的檔案清單', ev6 && Array.isArray(ev6.unreadable) && ev6.unreadable.length === 4, ev6);
  // 假檔名：AI 列出不屬於這次附件的檔名 → 核對不通過，叫 AI 修正一次（修正後只留真正的附件），不留假紀錄
  mode('event:event-unread-bogus');
  seen = await seenIds();
  const sub7 = await post('/api/intake', { kind: 'note', type: 'event', text: '11 月 8 日 陳先生 再寄一份 Word 附件。', date: '2026-11-08', files: [longDocs[0]] });
  r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  const in7 = state().inputs.find(i => i.id === 'in-' + sub7.j.id);
  ok('第八輪-6：AI 列出不是這次附件的檔名：外殼不接受並叫 AI 修正一次，紀錄只留真正的附件', r && r.state === 'done' && /unreadable 第 \d+ 項/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')) && in7 && Array.isArray(in7.unreadable) && in7.unreadable.length === 1 && in7.unreadable[0].file === longDocs[0].name, r && { state: r.state, error: r.error, unreadable: in7 && in7.unreadable });
  // 0.39.1 第九輪：AI 常加 files/ 前綴、副檔名大小寫不同、原因寫成口語 → 認得是同一份附件（換回實際檔名），事件不會被判為不合格
  mode('event:event-unread-loose');
  seen = await seenIds();
  const fixCount = () => (fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8').match(/unreadable 第 \d+ 項/g) || []).length;
  const fix0 = fixCount();
  const sub8 = await post('/api/intake', { kind: 'note', type: 'event', text: '11 月 9 日 陳先生 又寄來一份 Word 附件。', date: '2026-11-09', files: [{ name: '會後紀錄.docx', data: Buffer.from('PK fake docx').toString('base64') }] });
  r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  const in8 = state().inputs.find(i => i.id === 'in-' + sub8.j.id);
  ok('第九輪-6：AI 寫 files/會後紀錄.DOCX：不被判為不合格（沒有叫 AI 修正），事件處理成功', r && r.state === 'done' && fixCount() === fix0, r && { state: r.state, error: r.error, fixes: fixCount() - fix0 });
  ok('第九輪-6：紀錄換回實際檔名「會後紀錄.docx」', in8 && Array.isArray(in8.unreadable) && in8.unreadable.length === 1 && in8.unreadable[0].file === '會後紀錄.docx', in8 && in8.unreadable);
  ok('第九輪-6：AI 的口語原因只保存作紀錄，畫面原因由 names.js 固定（Office 檔一句）', in8 && in8.unreadable[0].reason === 'Word 檔目前讀唔到' && /未能轉成文字/.test(N.unreadReason('會後紀錄.docx')) && !/讀唔到|唔/.test(N.unreadReason('會後紀錄.docx')), in8 && in8.unreadable);
  // 0.39.1 第十輪：原因超過 80 字 → 截斷並記警告，不判整份事件不合格（與預填一致）
  mode('event:event-unread-longreason');
  seen = await seenIds();
  const fix10 = fixCount();
  const sub10 = await post('/api/intake', { kind: 'note', type: 'event', text: '11 月 10 日 陳先生 再寄一份 Word 附件。', date: '2026-11-10', files: [{ name: '補充說明.docx', data: Buffer.from('PK fake docx').toString('base64') }] });
  r = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
  const in10 = state().inputs.find(i => i.id === 'in-' + sub10.j.id);
  ok('第十輪-3：AI 寫的未能讀取原因超過 80 字：不被判為不合格（沒有叫 AI 修正），事件處理成功', r && r.state === 'done' && fixCount() === fix10, r && { state: r.state, error: r.error, fixes: fixCount() - fix10 });
  ok('第十輪-3：紀錄的原因截斷為 80 字，檔名完整保留', in10 && Array.isArray(in10.unreadable) && in10.unreadable.length === 1 && in10.unreadable[0].file === '補充說明.docx' && in10.unreadable[0].reason.length === 80, in10 && in10.unreadable);
  ok('第十輪-3：後台日誌記了截斷警告', /未能讀取原因超過 80 字，已截斷/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')));
  ok('第十輪-3：事件說明（ai-event.md）寫明原因最多 80 字', /最多 80 字/.test(fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8').split(/\r?\n/).filter(l => /unreadable/.test(l) && /reason/.test(l)).join('')));
  mode('event:event-ok');

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


  /* ---- 0.40.0 人物及機構名單：Zero 建議新對象 → 確認題 → 加入／別名／不加入；退回修正；逐字核對；丟棄 ---- */
  const actorsNow = () => (state().company.actors || []);
  const actorQ = P => P && P.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addActor'));
  const runActor = async (text, modes) => {
    mode(modes.join(String.fromCharCode(10))); seen = await seenIds();
    const sub = await post('/api/intake', { kind: 'note', type: 'event', text, date: '2026-11-11' });
    const run = await newRun(seen, x => x.kind === 'note' && x.noteType === 'event');
    const inp = state().inputs.find(i => i.id === 'in-' + sub.j.id);
    return { sub, run, inp, P: inp && inp.packId ? pack(inp.packId) : null };
  };
  const nA0 = actorsNow().length;
  const NA1 = await runActor('11 月 11 日 乙餐廳的黃小姐 來電，說想先試單。', ['event:event-actor']);
  const nq1 = actorQ(NA1.P);
  ok('N1 Zero 建議新對象：出「加入名單？」確認題（二選項，推薦加入），顯示機構、名稱、角色，並寫明不記聯絡方式', NA1.run && NA1.run.state === 'done' && nq1 && nq1.options.length === 2 && nq1.options[0].rec && /乙餐廳黃小姐（負責人）/.test(nq1.ask) && /不記聯絡方式/.test(nq1.judge) && /Zero 建議類別：客戶/.test(nq1.judge), nq1 && { ask: nq1.ask, opts: nq1.options.map(o => o.text) });
  ok('N1 確認前名單沒有改動', actorsNow().length === nA0);
  { const hits = [NA1.P.title, NA1.P.context, ...NA1.P.questions.flatMap(q => [q.ask, q.judge, q.why, q.value, ...q.options.map(o => o.text)])].flatMap(t => N.styleIssues(String(t || '')).map(h => h.term)); ok('N1 確認題畫面文字零內部術語、零編號', !hits.length, hits); }
  seen = await seenIds(); await answer(NA1.P);
  await newRun(seen, x => x.kind === 'ask' && x.ref === NA1.P.id);
  { const a = actorsNow().find(x => x.name === '黃小姐'), inp = state().inputs.find(i => i.id === NA1.inp.id);
    ok('N2 創辦人按加入：名單新增一人，類別、機構、角色、來源、確認時間齊，狀態在冊，只有約定欄位', a && a.kind === 'customer' && a.org === '乙餐廳' && a.role === '負責人' && a.addedFrom === 'event' && a.status === 'active' && a.confirmedAt && a.addedAt && !Object.keys(a).some(k => !['id', 'name', 'label', 'kind', 'org', 'role', 'aliases', 'status', 'addedFrom', 'addedAt', 'confirmedAt', 'fromMilestoneIds', 'team', 'mergedInto'].includes(k)), a);
    ok('N2 回饋卡效果：已加入名單，帶編號指向新對象', inp.effects.some(e => e.targetKind === 'actor' && e.targetId === (a && a.id) && /已加入名單：黃小姐（客戶）/.test(e.change)), inp.effects); }
  // 同名再被建議：丟棄（名單已有），不出題
  const NA2 = await runActor('11 月 12 日 黃小姐 再來電。', ['event:event-actor']);
  ok('N3 與名單同名：靜默丟棄、不出新對象題、日誌有記錄', NA2.run && NA2.run.state === 'done' && !actorQ(NA2.P) && /名稱已在名單內/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')));
  // 疑似變體 → 三選項；選記為別名
  const known = actorsNow().find(a => a.name === '黃小姐');
  const NA3 = await runActor('11 月 13 日 ' + known.name + ' 來電，提到下星期。', ['event:event-actor-similar']);
  const nq3 = actorQ(NA3.P);
  ok('N4 名稱是現有名稱的子字串：三選項（記為別名／另一個對象／不加入）', nq3 && nq3.options.length === 3 && /本人，記為別名/.test(nq3.options[0].text) && nq3.options[0].rec, nq3 && nq3.options.map(o => o.text));
  if (nq3) { seen = await seenIds(); await answer(NA3.P, q => q.id === nq3.id ? nq3.options[0].text : q.value); await newRun(seen, x => x.kind === 'ask' && x.ref === NA3.P.id); }
  { const t = actorsNow().find(a => a.id === known.id), first = Array.from(known.name)[0];
    ok('N4 記為別名：目標對象的別名加了新稱呼，名稱與類別不變，名單沒有新增人', t && t.aliases.includes(first) && t.name === known.name && t.kind === known.kind && actorsNow().length === nA0 + 1, t); }
  // 不加入
  const NA4 = await runActor('11 月 14 日 乙餐廳的黃小姐 的同事 林師傅 也來電。', ['event:event-actor-team']);
  const nq4 = actorQ(NA4.P), nn4 = actorsNow().length;
  seen = await seenIds(); await answer(NA4.P, q => q.id === (nq4 || {}).id ? N.ui.newActorNo : q.value); await newRun(seen, x => x.kind === 'ask' && x.ref === NA4.P.id);
  ok('N5 創辦人按不加入：不寫任何對象，只記「沒有加入名單」', nq4 && actorsNow().length === nn4 && !actorsNow().some(a => a.name === '林師傅') && state().inputs.find(i => i.id === NA4.inp.id).effects.some(e => /沒有加入名單：林師傅/.test(e.change)), state().inputs.find(i => i.id === NA4.inp.id).effects);
  // 團隊成員：同一個建議再來，這次加入
  const NA5 = await runActor('11 月 15 日 新請了 林師傅 幫手送貨。', ['event:event-actor-team']);
  seen = await seenIds(); await answer(NA5.P); await newRun(seen, x => x.kind === 'ask' && x.ref === NA5.P.id);
  { const m = actorsNow().find(a => a.name === '林師傅');
    ok('N6 團隊成員：類別 team，team 欄預設在職、工作類型 parttime、分工空白；之前按過不加入不影響之後加入', m && m.kind === 'team' && m.role === '送貨' && m.team && m.team.type === 'parttime' && m.team.state === 'active' && Array.isArray(m.team.owns) && !m.team.owns.length, m); }
  // 電郵 → 退回修正一次
  const NA6 = await runActor('11 月 16 日 乙餐廳的吳小姐 來電。', ['event:event-actor-contact', 'event-repair:event-actor-contact']);
  ok('N7 機構含電郵：退回 Zero 修正一次，修正後處理成功並出題', NA6.run && NA6.run.state === 'done' && /不可含電郵或長串數字/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')) && !!actorQ(NA6.P), NA6.run && NA6.run.state);
  ok('N7 修正後的確認題及名單內沒有電郵', !/@/.test(JSON.stringify(NA6.P)) && !JSON.stringify(actorsNow()).includes('@'));
  // 名稱不在原話 → 退回，修正後仍不在 → 只丟棄該項，整件事不失敗
  const NA7 = await runActor('11 月 17 日 只是例行問候。', ['event:event-actor-ghost', 'event-repair:event-actor-ghost']);
  ok('N8 名稱沒有逐字出現在原話：退回一次，仍不合格就只丟棄該項，整件事照常完成', NA7.run && NA7.run.state === 'done' && !actorQ(NA7.P) && /沒有逐字出現在創辦人原話/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')) && /修正後仍不合格，已丟棄/.test(fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8')), NA7.run && NA7.run.state);
  ok('N9 AI 說明檔寫明新對象項目、逐字出現、不寫聯絡方式', (() => { const t = fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8'); return /"kind": "newActor"/.test(t) && /逐字/.test(t) && /唔好寫電話、電郵/.test(t); })());
  mode('event:event-ok');
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
