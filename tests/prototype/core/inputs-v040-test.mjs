// 0.40.0 後台收件與回饋測試（假 AI、假 Google、隔離資料夾；不開瀏覽器、不連外網）
// 驗證 docs/evidence/v0400-ui-2026-11-07/backend-state-table.md 的整條鏈行（C 行）：
//   Office 附件轉文字、Google 連結取回（成功／未分享／找不到）、說明檔不被當附件、讀了甚麼／文件重點／沒有影響的原因、
//   跟進日期確認題（加入／不加入）、效果前後狀態、擬出問題包的工作收尾值、門檻統一、同一輸入重做不重複、重新讀取、來源網址逐字核對、舊格式帳本。
// 用法：node inputs-v040-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
import { docxOf } from '../lib/zip-fixture.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const b64 = x => Buffer.from(x).toString('base64');
const file = (name, data) => ({ name, data: b64(data) });
const localDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const FAKE_STATE = path.join(OUT, 'fake-google.json');
const setGoogle = o => fs.writeFileSync(FAKE_STATE, JSON.stringify(o));
setGoogle({ version: 1 });

function boot(DATA, port, prep, extraEnv = {}) {
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  const FX = prep ? prep(DATA) : null;
  const BASE = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_FETCH_MODULE: path.join(HERE, '..', 'lib', 'fake-google-fetch.mjs'), FAKE_GOOGLE_STATE: FAKE_STATE, CZ_NO_WELCOME: '1', SOS_NO_OPEN: '1', ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  const S = { DATA, BASE, FX, srv, log: '' };
  srv.stdout.on('data', d => { S.log += d; }); srv.stderr.on('data', d => { S.log += d; });
  S.get = async p => (await fetch(BASE + p)).json();
  S.post = async (p, body, headers = {}) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  S.waitFor = async (fn, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; };
  S.state = () => JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
  S.mode = (...m) => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m.join('\n') + '\n');
  S.runs = async () => (await S.get('/api/status')).runs;
  S.seen = async () => new Set((await S.runs()).map(r => r.id));
  S.newRun = (seen, pred) => S.waitFor(async () => (await S.runs()).find(r => !seen.has(r.id) && pred(r) && (r.state === 'done' || r.state === 'failed')));
  S.pack = id => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', id + '.json'), 'utf8'));
  S.answer = (P, pick) => {
    const answers = P.questions.map(q => { const v = pick ? pick(q) : q.value; return { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; });
    const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: P.questions.map(q => q.id), answers };
    const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
    return S.post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  };
  S.ready = async () => {
    await usePass(BASE);
    await S.waitFor(async () => { try { return (await S.get('/api/status')).ok; } catch { return false; } }, 15000);
    await S.post('/api/setup', { action: 'certify', host: 'test' });
    return S.waitFor(async () => { const s = await S.get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  };
  S.inbox = () => fs.readdirSync(path.join(DATA, 'founder', 'inbox'));
  return S;
}
const strip = rel => path.basename(rel).replace(/^.*?-note-(?:event|doc|adhoc|order)-file-\d+-/, '');
const ID = (p, n = 20) => p + 'A'.repeat(n);
const gdoc = id => `https://docs.google.com/document/d/${id}/edit?usp=sharing`, gsheet = id => `https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`, gslides = id => `https://docs.google.com/presentation/d/${id}/edit`;

const A = boot(path.join(OUT, 'dataA'), Number(PORT), DATA => oldInstall(DATA, PROTO));
let B = null;
try {
  const cert = await A.ready();
  ok('假 AI 認證通過', cert && cert.state === 'passed', cert && cert.state);
  const { post, state, newRun, seen, mode, pack, DATA, FX } = { ...A, state: A.state, newRun: A.newRun, seen: A.seen, mode: A.mode, pack: A.pack };
  const evRun = async (body, modes = []) => { if (modes.length) mode(...modes); const before = await A.seen(); const sub = await A.post('/api/intake', { kind: 'note', ...body }); const r = sub.code === 202 ? await A.newRun(before, x => x.kind === 'note' && ['event', 'doc'].includes(x.noteType)) : null; return { sub, r }; };

  /* ---- G1 門檻統一：未確認公司概覽時，三類都拒收，固定字句，收件匣不留任何檔 ---- */
  const conf = path.join(DATA, 'ledger', 'confirmed.json'), confBak = conf + '.bak';
  fs.renameSync(conf, confBak);
  const gate = [
    await A.post('/api/intake', { kind: 'note', type: 'event', text: '會面', date: '2026-11-06', files: [file('甲.md', 'x')] }),
    await A.post('/api/intake', { kind: 'note', type: 'doc', text: '', files: [file('甲.md', 'x')] }),
    await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: '請做一份簡介' }),
    await A.post('/api/intake', { kind: 'note', type: 'order', text: '想把第二站提前' })];
  ok('G1 發生了一件事／文件／請 Zero 做一件事／想改計劃：公司概覽未確認一律拒收，同一句固定字句', gate.every(g => g.code === 400 && g.j.message === N.ui.needOverviewAll), gate.map(g => [g.code, g.j && g.j.message]));
  ok('G1 拒收時收件匣沒有任何檔', A.inbox().length === 0, A.inbox());
  fs.renameSync(confBak, conf);

  /* ---- C1/C2 Office 附件轉文字、說明檔、封存 ---- */
  let docx = docxOf(['報價單', '總額 12000 元，十一月二十日前回覆。']);
  mode('event:event-follow');
  let seen0 = await A.seen();
  const sub1 = await A.post('/api/intake', { kind: 'note', type: 'event', text: '11 月 6 日與甲餐廳陳先生會面，對方要求報價，並寄來報價單。', date: '2026-11-06', source: 'chat', files: [{ name: '報價.docx', data: docx.toString('base64') }, file('壞檔.docx', 'PK fake docx'), file('說明.md', '# 說明')] });
  ok('C1 收到（網頁送出的 source 欄不被接受）', sub1.code === 202 && sub1.j.id, sub1);
  const r1 = await A.newRun(seen0, x => x.kind === 'note' && x.noteType === 'event');
  ok('C1 AI 工作完成', r1 && r1.state === 'done', r1 && { state: r1.state, error: r1.error });
  let s = state(), in1 = s.inputs.find(i => i.id === 'in-' + sub1.j.id);
  ok('C1 files[] 只列三個原檔，不含轉出的文字版 .md', in1 && in1.files.map(strip).sort().join('|') === ['報價.docx', '壞檔.docx', '說明.md'].sort().join('|'), in1 && in1.files);
  const fiOf = name => (in1.fileInfo || []).find(x => strip(x.file) === name);
  ok('C1 報價.docx：fileInfo 有文字版路徑，convert 為 ok；路徑是封存後相對 data/ 的路徑，檔案存在', fiOf('報價.docx') && fiOf('報價.docx').convert === 'ok' && /\.docx\.md$/.test(fiOf('報價.docx').text) && fs.existsSync(path.join(DATA, fiOf('報價.docx').text)) && fs.readFileSync(path.join(DATA, fiOf('報價.docx').text), 'utf8').includes('總額 12000 元') && fs.existsSync(path.join(DATA, fiOf('報價.docx').file)), in1 && in1.fileInfo);
  ok('C2 壞檔.docx：convert 為 corrupt，沒有文字版', fiOf('壞檔.docx') && fiOf('壞檔.docx').convert === 'corrupt' && !fiOf('壞檔.docx').text, in1 && in1.fileInfo);
  ok('C1 網頁送出的來源：沒有 source（當網頁送出）', in1 && !('source' in in1));
  ok('C1 原檔位元組不變', Buffer.compare(fs.readFileSync(path.join(DATA, fiOf('報價.docx').file)), docx) === 0);
  ok('C1 收件匣已清空（含說明檔與文字版）', A.inbox().length === 0, A.inbox());
  const archDir = path.dirname(path.join(DATA, in1.file));
  ok('C1 說明檔一併封存，沒有被當成附件或筆記', fs.readdirSync(archDir).some(f => f === sub1.j.id + '-note-event-meta.json') && !in1.files.some(f => /meta\.json$/.test(f)));
  { const evMd = fs.readFileSync(path.join(DATA, 'sandbox', r1.id, 'event.md'), 'utf8');
    ok('C1 給 Zero 的附件清單：有文字版的註明「文字版：…（圖片及版面不包括）」', /  - files\/報價\.docx\r?\n    - 文字版：files\/報價\.docx\.md（圖片及版面不包括）/.test(evMd) && !/files\/壞檔\.docx\r?\n    - 文字版/.test(evMd), evMd.slice(0, 400));
    ok('C1 文字版也放進 Zero 的 files/', fs.existsSync(path.join(DATA, 'sandbox', r1.id, 'files', '報價.docx.md'))); }

  /* ---- C6 讀了甚麼／文件重點／跟進日期題 ---- */
  ok('C6 讀了甚麼與文件重點存入該輸入（含頁碼）', in1.read && /讀了創辦人原話及/.test(in1.read.summary) && in1.read.highlights.length === 1 && in1.read.highlights[0].page === 2, in1 && in1.read);
  ok('C6 有確認題時沒有 reason', !('reason' in in1));
  const P1 = pack(in1.packId);
  const fuQ = P1.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp'));
  ok('C6 確認題包含跟進日期題：事件日後 14 日、說明為甚麼', P1.questions.length === 3 && fuQ && fuQ.options[0].apply.date === '2026-11-20' && /11 月 20 日/.test(fuQ.ask) && fuQ.why && fuQ.options.map(o => o.text).join() === `${N.ui.followUpYes},${N.ui.followUpNo}`, P1.questions.map(q => q.ask));
  { const hits = [P1.title, P1.context, ...P1.questions.flatMap(q => [q.ask, q.judge, q.why, q.value, ...q.options.map(o => o.text)])].flatMap(t => N.styleIssues(String(t || '')).map(h => h.term)); ok('C6 確認題畫面文字零內部術語、零口語字、零編號', !hits.length, hits); }
  ok('C16 擬出問題包的工作收尾值是 asked（不再是 blocked），顯示名「已交你確認」', (state().runs || []).find(x => x.id === r1.id)?.ending === 'asked' && N.ui.runEnd_asked === '已交你確認', (state().runs || []).find(x => x.id === r1.id));
  ok('C20 輸入進度：等你確認', in1.status === 'awaitingFounder');

  /* ---- C8 確認：加入日程 + 前後狀態 ---- */
  const tasksBefore = state().tasks.length;
  seen0 = await A.seen();
  const ans1 = await A.answer(P1);
  const rc = await A.newRun(seen0, x => x.kind === 'ask' && x.ref === P1.id);
  ok('C8 確認套用完成', ans1.code === 200 && rc && rc.state === 'done', rc && rc.result);
  s = state(); in1 = s.inputs.find(i => i.id === in1.id);
  const fuTask = s.tasks.find(t => t.id === 'fu-' + in1.id + '-' + fuQ.id);
  ok('C8 跟進日期入日程：tasks[] 多一項創辦人行動，有 dueAt', s.tasks.length === tasksBefore + 1 && fuTask && fuTask.owner === 'founder' && fuTask.dueAt === '2026-11-20' && fuTask.title === '回覆甲餐廳的報價', fuTask);
  { const dash = await A.get('/api/dashboard');
    ok('C8 日程清單與月曆自動顯示這項行動', JSON.stringify(dash.schedule || dash.sched || dash.calendar || dash).includes('回覆甲餐廳的報價'), Object.keys(dash).slice(0, 30)); }
  const fxF = in1.effects.find(e => e.targetKind === 'followUp');
  ok('C8 效果有 followUp：dueAt、前後狀態', fxF && fxF.dueAt === '2026-11-20' && fxF.before === '未排入日程' && /11 月 20 日/.test(fxF.after), fxF);
  const fxA = in1.effects.find(e => e.targetKind === 'assumption'), fxM = in1.effects.find(e => e.targetKind === 'decision' && /已完成/.test(e.change));
  ok('C10 假設效果有 before／after（「假設」→「實際行動」）', fxA && fxA.before === N.evName('guess') && fxA.after === N.evName('did'), fxA);
  ok('C10 站點效果有 before／after（未完成→已完成（日期））', fxM && fxM.before === '未完成' && /已完成（/.test(fxM.after), fxM);
  ok('C20 站點完成後下一個對外動作題另放一包：輸入仍等你確認（沿用既有流程）', in1.status === 'awaitingFounder' && in1.packId !== P1.id, in1.status);

  /* ---- C9 不加入：不寫任何行動 ---- */
  const evSecond = await evRun({ type: 'event', text: '11 月 6 日乙餐廳來電，要求下週回覆報價。', date: '2026-11-06' }, ['event:event-follow']);
  s = state(); const in2 = s.inputs.find(i => i.id === 'in-' + evSecond.sub.j.id);
  const P2 = in2 && pack(in2.packId), fuQ2 = P2 && P2.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp'));
  const nTasks = s.tasks.length;
  seen0 = await A.seen();
  await A.answer(P2, q => q === fuQ2 ? N.ui.followUpNo : q.value);
  await A.newRun(seen0, x => x.kind === 'ask' && x.ref === P2.id);
  s = state(); const in2b = s.inputs.find(i => i.id === in2.id);
  ok('C9 創辦人答「不加入」：不寫 tasks[]，只記「沒有加入日程」', s.tasks.length === nTasks && !s.tasks.some(t => t.id === 'fu-' + in2.id + '-' + fuQ2.id) && in2b.effects.some(e => e.targetKind === 'decision' && /沒有加入日程/.test(e.change)) && !in2b.effects.some(e => e.targetKind === 'followUp'), in2b.effects);

  /* ---- C7 不合格的跟進日期（早於事件日）→ 退回修正一次 ---- */
  const logPath = path.join(DATA, 'ledger', 'runs.log');
  const evBad = await evRun({ type: 'event', text: '11 月 6 日丙餐廳確認會面，下週回覆。', date: '2026-11-06' }, ['event:event-follow-bad', 'event-repair:event-follow-bad']);
  ok('C7 跟進日期早於事件日：叫 AI 修正一次，修正後處理成功', evBad.r && evBad.r.state === 'done' && /followUp 的 date 不可早於事件日期/.test(fs.readFileSync(logPath, 'utf8')), evBad.r && { state: evBad.r.state, error: evBad.r.error });
  { const inB = state().inputs.find(i => i.id === 'in-' + evBad.sub.j.id), PB = inB && pack(inB.packId); ok('C7 修正後的確認題帶合規日期', PB && PB.questions.some(q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp' && o.apply.date === '2026-11-20')), PB && PB.questions.map(q => q.ask)); }

  /* ---- C10b 沒有確認題：reason 必填並存入 ---- */
  const evNone = await evRun({ type: 'event', text: '11 月 7 日丁餐廳只是問候，沒有任何新安排。', date: '2026-11-07' }, ['event:event-none']);
  { const inN = state().inputs.find(i => i.id === 'in-' + evNone.sub.j.id);
    ok('C10 沒有任何確認題：reason 存入、輸入直接為已處理', evNone.r && evNone.r.state === 'done' && inN && inN.status === 'processed' && /沒有改變對方做到哪一步/.test(inN.reason) && inN.read && inN.read.highlights.length === 1, inN);
    ok('C16 沒有問題包的工作收尾不是 asked', (state().runs || []).find(x => x.id === evNone.r.id)?.ending !== 'asked'); }
  { ok('C10 AI 說明檔要求 read、reason、followUp', (() => { const t = fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8'); return /"read"/.test(t) && /`reason`/.test(t) && /"followUp"/.test(t) && /文字版/.test(t); })()); }

  /* ---- C3/C4 Google 連結：成功、未分享、找不到；不擋送出 ---- */
  const docId = ID('okdoc'), sheetId = ID('oksheet'), slideId = ID('okslides'), closedId = ID('closed'), missId = ID('missing');
  const textG = `見 ${gslides(slideId)} 另外 ${gdoc(closedId)}，還有 ${gdoc(missId)}；一般網頁 https://example.org/a 不取回。`;
  const evG = await evRun({ type: 'event', text: textG, date: '2026-11-06', links: [gdoc(docId), gsheet(sheetId)], files: [file('收據.md', '# 收據')] }, ['event:event-none']);
  ok('C3 含未分享及找不到的連結照樣收（不擋送出）', evG.sub.code === 202 && Array.isArray(evG.sub.j.linkErrors) && evG.sub.j.linkErrors.length === 2, evG.sub);
  const inG = state().inputs.find(i => i.id === 'in-' + evG.sub.j.id);
  const gi = k => (inG.fileInfo || []).find(x => x.kind === k);
  ok('C3 三條成功：文件、試算表、簡報各有 url、readOn（今日）、種類', ['google-doc', 'google-sheet', 'google-slides'].every(k => gi(k) && gi(k).readOn === localDay() && /^https:\/\/docs\.google\.com\//.test(gi(k).url)), inG && inG.fileInfo);
  ok('C3 files[] 為「收據.md」加三個 Google 原件（pdf、xlsx、pdf），沒有文字版', inG.files.length === 4 && inG.files.filter(f => /\.(pdf|xlsx)$/.test(f)).length === 3 && !inG.files.some(f => /\.xlsx\.md$|預算說明\.md$|推介\.txt$/.test(f)), inG.files.map(strip));
  ok('C3 文件：Markdown 文字版存為原件旁的 .md；簡報：純文字版；試算表：XLSX 轉文字', fs.readFileSync(path.join(DATA, gi('google-doc').text), 'utf8').includes('預算說明（第 1 版）') && fs.readFileSync(path.join(DATA, gi('google-slides').text), 'utf8').includes('三間餐廳試單') && /8001/.test(fs.readFileSync(path.join(DATA, gi('google-sheet').text), 'utf8')) && gi('google-sheet').convert === 'ok', gi('google-sheet'));
  ok('C4 失敗原因記入 linkErrors：未分享 not-shared、找不到 not-found', inG.linkErrors && inG.linkErrors.map(x => x.reason).sort().join() === 'not-found,not-shared' && inG.linkErrors.every(x => /^google-doc$/.test(x.kind) && /^https:\/\/docs\.google\.com\//.test(x.url)), inG.linkErrors);
  ok('C3 一般網頁連結不取回（沒有該來源的檔案，也不出現在 linkErrors）', !JSON.stringify(inG).includes('example.org'));
  { const evMd = fs.readFileSync(path.join(DATA, 'sandbox', evG.r.id, 'event.md'), 'utf8'); ok('C3 給 Zero 的清單註明 Google 原連結及讀取日期', evMd.includes('來自 Google 連結：https://docs.google.com/spreadsheets/d/' + sheetId) && evMd.includes('讀取）'), evMd.slice(0, 700)); }
  ok('C3 收件匣已清空（含 Google 取回的檔及說明檔）', A.inbox().length === 0, A.inbox());
  { const onlyBad = await A.post('/api/intake', { kind: 'note', type: 'doc', text: '', links: [gdoc(ID('closed'))] });
    ok('C4 只貼連結、沒有寫字也沒有附件，而連結全部讀不到：拒收並講怎樣做，收件匣不留檔', onlyBad.code === 400 && onlyBad.j.message === N.ui.linkNotShared && A.inbox().length === 0, onlyBad); }

  /* ---- C13–C15 重新讀取 ---- */
  const nSheet = inG.files.findIndex(f => /\.xlsx$/.test(f)), nSlides = inG.files.findIndex(f => /推介.*\.pdf$/.test(f));
  const oldSheet = gi('google-sheet').file, oldText = gi('google-sheet').text;
  setGoogle({ version: 2 });
  const rr1 = await A.post('/api/input-reread', { id: inG.id, n: nSheet });
  ok('C13 重新讀取：已配對頁面，回 202 與讀取日期', rr1.code === 202 && rr1.j.readOn === localDay(), rr1);
  const swapped = await A.waitFor(async () => { const i = state().inputs.find(x => x.id === inG.id); return i && i.files[nSheet] !== oldSheet ? i : null; }, 30000);
  ok('C13 帳本換用新快照，舊快照記入 previous、檔案兩份都在', swapped && swapped.fileInfo.find(x => x.kind === 'google-sheet').previous[0].file === oldSheet && fs.existsSync(path.join(DATA, oldSheet)) && fs.existsSync(path.join(DATA, swapped.files[nSheet])) && /8002/.test(fs.readFileSync(path.join(DATA, swapped.fileInfo.find(x => x.kind === 'google-sheet').text), 'utf8')) && fs.readFileSync(path.join(DATA, oldText), 'utf8').includes('8001'), swapped && swapped.fileInfo);
  ok('C13 不自動重做 AI 工作（沒有新的 AI 工作）', !(await A.runs()).some(r => r.ref === evG.sub.j.id && r.id !== evG.r.id && r.kind === 'note'));
  const rr2 = await A.post('/api/input-reread', { id: inG.id, n: nSheet });
  ok('C14 同一條連結一分鐘內再讀：回 429', rr2.code === 429, rr2);
  const archFiles = () => fs.readdirSync(path.dirname(path.join(DATA, oldSheet))).length;
  const filesBefore = archFiles(), stateBefore = JSON.stringify(state().inputs.find(x => x.id === inG.id));
  setGoogle({ version: 3, down: true });
  const rr3 = await A.post('/api/input-reread', { id: inG.id, n: nSlides });
  await sleep(1500);
  ok('C14 讀取失敗：回 422，舊快照及 readOn 不變、沒有新檔、沒有留單', rr3.code === 422 && archFiles() === filesBefore && JSON.stringify(state().inputs.find(x => x.id === inG.id)) === stateBefore && (!fs.existsSync(path.join(DATA, 'ledger', 'rereads')) || fs.readdirSync(path.join(DATA, 'ledger', 'rereads')).length === 0), rr3);
  setGoogle({ version: 1 });
  const rr4 = await A.post('/api/input-reread', { id: 'in-nope', n: 0 }), rr5 = await A.post('/api/input-reread', { id: inG.id, n: 0 }), rr6 = await A.post('/api/input-reread', { id: inG.id, n: 99 });
  const rr7 = await fetch(A.BASE + '/api/input-reread', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: A.BASE, Cookie: 'invalid=1' }, body: JSON.stringify({ id: inG.id, n: nSlides }) });
  ok('C15 輸入不存在／不是 Google 附件／序號超出：404；沒有通行證：403', rr4.code === 404 && rr5.code === 404 && [400, 404].includes(rr6.code) && rr7.status === 403, [rr4.code, rr5.code, rr6.code, rr7.status]);

  /* ---- C11 同一輸入重做（失敗後重試）：不重複登記、不重複加事件／行動／效果 ---- */
  const docx2 = docxOf(['重做用附件', '第二份']);
  const evFail = await evRun({ type: 'event', text: '11 月 6 日戊餐廳再寄來文件，重做測試。', date: '2026-11-06', files: [{ name: '重做.docx', data: docx2.toString('base64') }] }, ['event:fail']);
  ok('C11 第一次失敗', evFail.r && evFail.r.state === 'failed', evFail.r && evFail.r.state);
  const idF = 'in-' + evFail.sub.j.id;
  const snapshotCounts = () => { const st = state(); return { inputs: st.inputs.filter(i => i.id === idF).length, events: (st.events || []).filter(e => (e.relatedIds || []).includes(idF)).length, tasks: st.tasks.length, effects: (st.inputs.find(i => i.id === idF) || { effects: [] }).effects.length }; };
  const c0 = snapshotCounts();
  mode('event:event-follow');
  seen0 = await A.seen();
  await A.post('/api/retry', { runId: evFail.r.id });
  const rRetry = await A.newRun(seen0, x => x.kind === 'note' && x.noteType === 'event');
  const c1 = snapshotCounts();
  ok('C11 重試成功，輸入仍只有一項、事件紀錄不重複、任務與效果不因重做而增加', rRetry && rRetry.state === 'done' && c1.inputs === 1 && c1.events === c0.events && c1.tasks === c0.tasks && c1.effects === 0, { c0, c1 });
  ok('C11 重試給 Zero 的清單仍有文字版', rRetry && /文字版：files\/重做\.docx\.md/.test(fs.readFileSync(path.join(DATA, 'sandbox', rRetry.id, 'event.md'), 'utf8')));

  /* ---- C12 會後紀錄的跟進日期走同一條路 ---- */
  seen0 = await A.seen();
  const deb = await A.post('/api/intake', { kind: 'note', type: 'debrief', text: '今日與己餐廳見面，對方說會考慮。', commitment: 'partly', followUp: '2026-11-25' });
  const rDeb = await A.newRun(seen0, x => x.kind === 'note' && x.noteType === 'debrief');
  const inD = state().inputs.find(i => i.id === 'in-' + deb.j.id), PD = inD && inD.packId && pack(inD.packId);
  const fuD = PD && PD.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addFollowUp'));
  ok('C12 會後紀錄的跟進日期：外殼補一條跟進題（仍要確認才入日程），尚未寫任務', rDeb && rDeb.state === 'done' && fuD && fuD.options[0].apply.date === '2026-11-25' && !state().tasks.some(t => t.dueAt === '2026-11-25'), PD && PD.questions.map(q => q.ask));
  if (PD) { seen0 = await A.seen(); await A.answer(PD); await A.newRun(seen0, x => x.kind === 'ask' && x.ref === PD.id); }
  ok('C12 確認後跟進日期入日程', state().tasks.some(t => t.owner === 'founder' && t.dueAt === '2026-11-25' && /跟進與/.test(t.title)), state().tasks.filter(t => t.dueAt).map(t => [t.title, t.dueAt]));

  /* ---- C17 請 Zero 做一件事（帶附件、來源）：登記成輸入，進度跟問題包 ---- */
  seen0 = await A.seen();
  const ad = await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: '請準備一頁簡介，星期五要。', files: [file('參考.md', '# 參考資料')], date: '2026-11-07' });
  const rAd = await A.newRun(seen0, x => x.kind === 'note' && x.noteType === 'adhoc');
  const inAd = state().inputs.find(i => i.id === 'in-' + ad.j.id);
  ok('C17 請 Zero 做一件事：登記成輸入（via adhoc），附件封存、進度為等你確認，不帶事件日期', rAd && rAd.state === 'done' && inAd && inAd.via === 'adhoc' && inAd.files.length === 1 && fs.existsSync(path.join(DATA, inAd.files[0])) && inAd.status === 'awaitingFounder' && inAd.packId && !('eventDate' in inAd), inAd);
  ok('C16 臨時工作擬出問題包：收尾值 asked', (state().runs || []).find(x => x.id === rAd.id)?.ending === 'asked');
  ok('C17 附件在給 Zero 的要求內', /files\/參考\.md/.test(fs.readFileSync(path.join(DATA, 'sandbox', rAd.id, 'note.md'), 'utf8')));
  { const PAd = pack(inAd.packId); seen0 = await A.seen(); await A.answer(PAd); await A.newRun(seen0, x => x.kind === 'ask' && x.ref === PAd.id); ok('C17 問題包答完：輸入為已處理', state().inputs.find(i => i.id === inAd.id).status === 'processed'); }

  /* ---- C5 收件途中出錯：先寫的檔由呼叫者整批清掉（receiveAttachments 把已寫路徑記入 created） ---- */
  { const lib2 = await import(pathToFileURL(path.join(PROTO, 'inbound-lib.mjs')).href);
    const dir = path.join(OUT, 'c5'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ID-note-event-file-02-乙.md'), 'x'); // 第二個附件的位置已被佔用 → 寫入失敗
    const created = []; let threw = false;
    try { await lib2.receiveAttachments({ id: 'ID', type: 'event', attachments: [{ name: '甲.md', bytes: Buffer.from('a') }, { name: '乙.md', bytes: Buffer.from('b') }], text: '', links: [], inboxDir: dir, created }); } catch { threw = true; }
    for (const p of created) try { fs.unlinkSync(p); } catch { }
    ok('C5 出錯時丟出例外，已寫的路徑都記在 created，清掉後不留半寫入（只剩原本佔位的檔）', threw && created.length === 1 && fs.readdirSync(dir).join() === 'ID-note-event-file-02-乙.md', { threw, created }); }

  /* ---- C18 舊格式帳本照常讀 ---- */
  { const st = state(); st.inputs.push({ id: 'in-legacy', kind: 'inbox', via: 'event', title: '舊紀錄', file: '', files: [], eventDate: '2026-10-01', receivedAt: '2026-10-01T10:00:00+08:00', status: 'processed', effects: [{ targetKind: 'decision', targetId: 'p', change: '維持不變' }] });
    fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify(st, null, 2));
    const dash = await A.get('/api/dashboard');
    ok('C18 舊格式輸入（沒有新欄位）：監察台照常讀取', dash && dash.inputs && JSON.stringify(dash.inputs).includes('舊紀錄'), dash && dash.inputs); }
  ok('C18 AI 工作說明與提示不再叫創辦人用 Founder Desk／營運監察台', !fs.readdirSync(PROTO).filter(f => /^ai-.*\.md$/.test(f)).some(f => /Founder Desk|營運監察台/.test(fs.readFileSync(path.join(PROTO, f), 'utf8'))));

  /* ---- A1 校對頁載入後在同一頁更正來源連結，再按確認：版本雜湊略去來源連結欄，不可被當成「版本已更改」；舊確認紀錄仍有效 ---- */
  { const pg0 = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8')), conf0 = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'confirmed.json'), 'utf8'));
    const NL = String.fromCharCode(10), loadHash = lib.proofreadHash(pg0);
    ok('A1 沒有連結欄的舊頁面：新雜湊與 0.39.1 的算法（整頁 JSON）結果相同', loadHash === lib.fnv(JSON.stringify(pg0)), [loadHash, lib.fnv(JSON.stringify(pg0))]);
    const fixR = await A.post('/api/source-url', { n: 0, url: 'https://example.org/policy' });
    const pg1 = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
    ok('A1 更正連結：page.json 的來源有連結及更正日期', fixR.code < 300 && pg1.sources[0].url === 'https://example.org/policy' && !!pg1.sources[0].fixedOn, fixR);
    ok('A1 更正前後雜湊相同（載入時算的雜湊仍然有效）；整頁 JSON 的雜湊則不同', lib.proofreadHash(pg1) === loadHash && lib.fnv(JSON.stringify(pg1)) !== loadHash);
    const machine = { format: 'startup-os.proofread-reply/0.1', page: pg1.page.id, company: pg1.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: conf0.order, orderProposed: conf0.order, orderChanged: false, nextActionMilestone: conf0.nextActionMilestone, decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '' };
    const head = ['kind: proofread', 'ref: ' + pg1.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + loadHash, 'batch: false', 'shownAt: ' + lib.localIso()];
    const before = await A.seen();
    const sub = await A.post('/api/submit', { kind: 'proofread', ref: pg1.page.id, text: [head.join(NL), '', '# 確認', '', '```json', JSON.stringify(machine), '```', ''].join(NL) });
    const rp = await A.newRun(before, x => x.kind === 'proofread');
    ok('A1 同一頁更正連結後按確認：被接受（沒有「版本已經更改」）', sub.code === 200 && rp && rp.state === 'done' && !/已經更改/.test(rp.error || ''), rp && { state: rp.state, error: rp.error });
    const conf1 = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'confirmed.json'), 'utf8'));
    ok('A1 公司概覽仍是已確認，舊確認紀錄沒有因雜湊算法改變而失效', conf1.pageId === pg1.page.id && (await A.get('/api/dashboard')).company.confirmed === true, conf1.pageId); }

  /* ---- U 來源網址逐字核對（告訴 Zero 擬公司概覽）：另一個空資料夾 ---- */
  B = boot(path.join(OUT, 'dataB'), Number(PORT) + 1, null, { SOS_LINKCHECK_MODULE: path.join(HERE, '..', 'lib', 'fake-link-check.mjs') });
  const certB = await B.ready();
  ok('U 第二個實例假 AI 認證通過', certB && certB.state === 'passed');
  const fieldsB = { q1: '把本地小農的當季蔬菜直送餐廳。政策見 https://example.hk/procurement_schs.html', q2: '餐廳每週付款', q3: '', q4: '', q5: '', q6: '', q7: '', q8: '' };
  B.mode('intake:intake-badurl', 'intake-repair:intake-badurl');
  let seenB = await B.seen();
  const subB = await B.post('/api/intake', { bizType: 'other', fields: fieldsB, files: [] });
  const rB = await B.newRun(seenB, x => x.kind === 'intake');
  const pageB = () => JSON.parse(fs.readFileSync(path.join(B.DATA, 'company', 'page.json'), 'utf8'));
  const zz = () => (pageB().sources || []).find(x => x.id === 'zz1');
  ok('U1 Zero 抄錯網址（schs → schools）且修正後仍錯：網址留空並加註「原文網址未能核對」', subB.code === 202 && rB && rB.state === 'done' && zz() && !zz().url && /原文網址未能核對/.test(zz().note || ''), { run: rB && rB.state, zz: zz() });
  B.mode('intake:intake-badurl-fix', 'intake-repair:intake-badurl-fix');
  seenB = await B.seen();
  await B.post('/api/intake', { bizType: 'other', fields: fieldsB, files: [] });
  const rB2 = await B.newRun(seenB, x => x.kind === 'intake');
  ok('U1 退回修正一次後改回原文網址：保留網址', rB2 && rB2.state === 'done' && zz() && zz().url === 'https://example.hk/procurement_schs.html' && !/未能核對/.test(zz().note || ''), zz());
  ok('L1 外部連結試開：明確打不開（404）的來源加註「連結未能開啟」，網址不刪', zz() && /連結未能開啟/.test(zz().note || '') && zz().url === 'https://example.hk/procurement_schs.html', zz());
  ok('L1 能打開的連結（商業模式來源沒有網址）不加註、不誤報', (pageB().sources || []).filter(x => x.id !== 'zz1').every(x => !/連結未能開啟/.test(JSON.stringify(x))));
  /* ---- A2 來源存檔：Zero 只寫附件檔名，外殼換成封存後的相對路徑；對不上就留空 ---- */
  B.mode('intake:intake-srcfile');
  seenB = await B.seen();
  await B.post('/api/intake', { bizType: 'other', fields: fieldsB, files: [file('商業計劃.md', '# 商業計劃' + String.fromCharCode(10) + '農場直送餐廳。')] });
  const rB3 = await B.newRun(seenB, x => x.kind === 'intake');
  { const z2 = (pageB().sources || []).find(x => x.id === 'zz2'), z3 = (pageB().sources || []).find(x => x.id === 'zz3');
    ok('A2 來源 file 只寫檔名：換成封存相對路徑，檔案存在且可由 data/ 解析', rB3 && rB3.state === 'done' && z2 && /^archive[/][^/]+[/]intake-[^/]+[/].*-intake-01-商業計劃[.]md$/.test(z2.file) && fs.existsSync(path.join(B.DATA, z2.file)) && /農場直送/.test(fs.readFileSync(path.join(B.DATA, z2.file), 'utf8')), z2);
    ok('A2 對不上任何附件的檔名：file 留空，不留打不開的連結', z3 && !('file' in z3), z3); }
  { const pg = pageB(), outs = ['zz4', 'zz5', 'zz6'].map(id => (pg.sources || []).find(x => x.id === id));
    ok('A2 出界路徑（archive/../ledger/…、反斜線、archive/x/../../company/…）：file 一律刪去', outs.every(x => x && !('file' in x)), outs);
    const idx = (pg.sources || []).findIndex(x => x.id === 'zz2');
    const okRes = await fetch(B.BASE + '/api/source-file?n=' + idx);
    ok('A2 正常的來源存檔仍可由 /api/source-file 開啟', okRes.status === 200, okRes.status);
    // 即使 page.json 被寫成出界路徑（舊資料或手改），伺服器也只認封存資料夾內的普通檔
    const pj = path.join(B.DATA, 'company', 'page.json'), raw = JSON.parse(fs.readFileSync(pj, 'utf8'));
    raw.sources.push({ id: 'zz9', title: '舊資料出界', file: 'ledger/state.json' }, { id: 'zz10', title: '舊資料出界二', file: 'archive/../company/page.json' });
    fs.writeFileSync(pj, JSON.stringify(raw));
    const r9 = await fetch(B.BASE + '/api/source-file?n=' + (raw.sources.length - 2)), r10 = await fetch(B.BASE + '/api/source-file?n=' + (raw.sources.length - 1));
    ok('A2 伺服器雙重防線：來源 file 指向帳本或公司資料（含 archive/..）一律 404', r9.status === 404 && r10.status === 404, [r9.status, r10.status]); }
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  A.srv.kill(); if (B) B.srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), A.log + '\n----\n' + (B ? B.log : ''));
  process.exit(pass === results.length ? 0 : 1);
}
