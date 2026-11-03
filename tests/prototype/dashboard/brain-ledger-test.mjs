// 生意大腦接帳本測試（規劃書 4.6；假 AI、隔離資料夾）：
// 確認前讀試驗資料夾（有來源徽章）→ 成頁確認嗰次工作做生意體檢 → 改由公司紀錄供料、試驗資料夾停用；
// 客戶推進格位只由確認咗嘅真實事件推進；意見寫入下一次體檢；「等你處理」同待決事項同源；畫面（系統頁、總覽、體檢、推進板）。
// 用法：node brain-ledger-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const { seedCompany } = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
fs.mkdirSync(path.join(DATA, 'founder', 'desk'), { recursive: true });
seedCompany(DATA, PROTO);
// 試驗資料夾（確認之前生意大腦讀佢；確認之後停用）
const TRIAL = path.join(OUT, 'trial'); fs.mkdirSync(TRIAL);
fs.writeFileSync(path.join(TRIAL, '生意體檢.md'), '# 生意體檢（試驗資料夾）\n\n## 最弱的環節\n\n### 試驗資料夾的弱位\n只喺試驗資料夾出現。\n');
fs.writeFileSync(path.join(DATA, 'founder', 'desk', 'brain-source.json'), JSON.stringify({ dir: TRIAL }));
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const page = () => JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
const state = () => JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
const brainOf = k => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'brain', k + '.json'), 'utf8')); } catch { return null; } };
const runsOf = async () => (await get('/api/status')).runs;
const seenIds = async () => new Set((await runsOf()).map(r => r.id));
const newRun = async (seen, pred) => waitFor(async () => (await runsOf()).find(r => !seen.has(r.id) && pred(r) && (r.state === 'done' || r.state === 'failed')));
function proofread() {
  const p = page(), order = p.path.milestones.map(m => m.id), kinds = Object.fromEntries(order.map((id, i) => [id, i === 2 ? 'task' : 'real']));
  const machine = { format: 'startup-os.proofread-reply/0.1', page: p.page.id, company: p.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds, kindsChanged: [] };
  const head = ['kind: proofread', 'ref: ' + p.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(p)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'proofread', ref: p.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
function answer(P, values = {}) {
  const answers = P.questions.map(q => { const v = values[q.id] ?? q.value; return { id: q.id, value: v, ai: q.value, changed: v !== q.value }; });
  const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: P.questions.map(q => q.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
// 生意體檢之後嘅「建議開辯論」、商機掃描之後嘅「要跟進嗎？」（brain-c2-test 測試）：呢度一律答暫不，等原本嘅檢查照做
async function declineOffers() {
  for (let i = 0; i < 4; i++) {
    const P = (await get('/api/asks')).packs.filter(p => p.open).map(p => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', p.id + '.json'), 'utf8'))).find(p => p.rhythm && ['debate', 'opportunity'].includes(p.rhythm.kind));
    if (!P) return;
    const seen = await seenIds();
    await answer(P, Object.fromEntries(P.questions.map(q => [q.id, P.rhythm.kind === 'debate' ? N.ui.debateOfferNo : N.ui.oppLater])));
    await newRun(seen, r => r.kind === 'ask' && r.ref === P.id);
  }
}
const monthlyPack = id => { const P = { format: 'startup-os.ask/0.1', id, title: '每月覆核（測試）', askedBy: 'AI', askedAt: lib.localIso(), todoType: 'decision', rhythm: { kind: 'monthly' }, afterConfirm: '答案即時生效',
  questions: [{ id: 'perm', ask: N.ui.monthlyPerm, kind: 'choice', options: [{ text: N.ui.monthlyPermKeep, rec: true }, { text: N.ui.monthlyPermNarrow }], value: N.ui.monthlyPermKeep, effect: 'now', priority: 1, why: '測試理由' },
    { id: 'goal', ask: '本季目標仍然是這個嗎？', kind: 'choice', options: [{ text: N.ui.monthlyGoalKeep, rec: true }], value: N.ui.monthlyGoalKeep, effect: 'now', priority: 2, why: '測試理由' }] };
  fs.writeFileSync(path.join(DATA, 'asks', id + '.json'), JSON.stringify(P)); return P; };

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
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.writeFileSync(path.join(DATA, 'company', 'biz.json'), JSON.stringify({ type: 'goods', other: '' }));
  await post('/api/setup', { action: 'certify', host: 'test' });
  const cert = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('假 AI 認證通過', cert && cert.state === 'passed', cert);

  /* 確認之前：讀試驗資料夾，有來源徽章 */
  const d0 = await get('/api/dashboard');
  ok('確認之前：生意大腦讀試驗資料夾', d0.brain.source && d0.brain.source.kind === 'folder' && d0.brain.items.find(x => x.id === 'checkup').detail.kind === 'md', d0.brain.source);

  /* 成頁確認：同一次工作先做生意體檢，再準備下一步 */
  let seen = await seenIds();
  const pr = await proofread();
  ok('送出成頁確認', pr.code === 202 || pr.code === 200, pr);
  const r1 = await newRun(seen, r => r.kind === 'proofread');
  const ckStep = r1 && (r1.steps || []).find(s => s.key === 'brain-checkup');
  ok('成頁確認嗰次工作：有「AI 生意體檢」一步而且完成，之後照準備下一步', r1 && r1.state === 'done' && ckStep && ckStep.state === 'done' && ckStep.label === N.ui.brainJob_checkup && (r1.steps || []).findIndex(s => s.key === 'brain-checkup') < (r1.steps || []).findIndex(s => s.key === 'ai'), r1 && r1.steps);
  const ck = brainOf('checkup'), st1 = state();
  const asmById = Object.fromEntries(((st1.company || {}).assumptions || []).map(a => [a.id, a]));
  ok('體檢結果寫入公司紀錄：最多三個弱位，每個指向帳本假設', ck && ck.weak.length >= 1 && ck.weak.length <= 3 && ck.weak.every(w => asmById[w.assumptionId]), ck);
  ok('證據級由帳本假設讀，唔係 AI 寫', ck && ck.weak.every(w => w.evidence === Math.max(0, N.EV_KEYS.indexOf(asmById[w.assumptionId].grade))), ck && ck.weak.map(w => [w.assumptionId, w.evidence]));
  ok('體檢唔改任何假設級別', ((st1.company || {}).assumptions || []).every(a => a.grade === 'guess'), (st1.company || {}).assumptions);
  const ckSb = path.join(DATA, 'sandbox', r1.id + '-checkup');
  ok('生意體檢的工作資料夾附生意類別用字表', fs.existsSync(path.join(ckSb, 'biz.md')) && /類別：實體貨品/.test(fs.readFileSync(path.join(ckSb, 'biz.md'), 'utf8')));
  const ckTask = fs.readFileSync(path.join(ckSb, 'task.md'), 'utf8');
  ok('體檢工作說明：第一行今日日期、有已確認公司概覽同帳本', ckTask.startsWith('> 今日日期：' + lib.localIso().slice(0, 10)) && fs.existsSync(path.join(ckSb, 'confirmed-page.md')) && fs.existsSync(path.join(ckSb, 'ledger.json')) && fs.readFileSync(path.join(ckSb, 'feedback.md'), 'utf8').includes('（沒有）'), ckTask.slice(0, 80));
  const d1 = await get('/api/dashboard');
  const it = id => d1.brain.items.find(x => x.id === id);
  ok('確認之後：改由公司紀錄供料，試驗資料夾停用（設定檔照留）', d1.brain.source.kind === 'ledger' && d1.brain.source.folderOff === true && fs.existsSync(path.join(DATA, 'founder', 'desk', 'brain-source.json')), d1.brain.source);
  ok('生意體檢顯示公司紀錄嘅結果，唔再顯示試驗資料夾內容', it('checkup').status === 'done' && (it('checkup').detail.weak || []).length === ck.weak.length && !JSON.stringify(d1.brain).includes('只喺試驗資料夾出現'), it('checkup'));
  ok('未做嘅項目講明幾時做（唔係空白）', ['opportunities', 'routes'].every(k => it(k).status === 'not_started' && it(k).summary), ['opportunities', 'routes'].map(k => it(k).summary));
  ok('紅藍對打：生意體檢之後等你決定開唔開（入口去建議包）', it('wargame').status === 'waiting' && String(it('wargame').waitHref).startsWith('/#/ask/'), it('wargame'));
  await declineOffers();
  const wgNo = (await get('/api/dashboard')).brain.items.find(x => x.id === 'wargame');
  ok('答「暫不」之後：紅藍對打講明點樣開始', wgNo.status === 'not_started' && wgNo.summary === N.dash.brainNext_wargame, wgNo);
  const pipe = it('pipeline').detail || {};
  ok('客戶推進：對象嚟自公司概覽嘅公司以外決策者，未有確認事件全部喺「未接觸」', (pipe.prospects || []).length === 5 && pipe.prospects.every(p => p.stage === 0), pipe.prospects);

  /* 真實事件確認之後：格位前移 */
  seen = await seenIds();
  mode('event:event-next'); // 確認包另有「下一個對外動作」改去第 2 站（何師傅）：唔可以當何師傅有真事
  const e1 = await post('/api/intake', { kind: 'note', type: 'event', text: '與綠野物流負責人會面，對方答應試送一次並以電郵確認。', date: lib.localIso().slice(0, 10) });
  ok('記錄真實事件：收到', e1.code === 202, e1);
  const er = await newRun(seen, r => r.kind === 'note' && r.noteType === 'event');
  ok('真實事件：AI 擬好確認題', er && er.state === 'done', er);
  const pm = (await get('/api/asks')).packs.filter(p => p.open).map(p => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', p.id + '.json'), 'utf8'))).find(p => p.realEvent);
  ok('真實事件確認包已放上 Founder Desk', !!pm, (await get('/api/asks')).packs.map(p => p.title));
  const midPipe = (await get('/api/dashboard')).brain.items.find(x => x.id === 'pipeline').detail.prospects.find(p => p.name === '綠野物流');
  ok('確認之前：格位未動、最近真事唔顯示淨係記錄咗嘅事（AI 建議唔算）', midPipe && midPipe.stage === 0 && !midPipe.lastReal, midPipe);
  seen = await seenIds();
  await answer(pm);
  await newRun(seen, r => r.kind === 'ask');
  const gp = (await get('/api/dashboard')).brain.items.find(x => x.id === 'pipeline').detail.prospects.find(p => p.name === '綠野物流');
  ok('你確認真實事件之後：綠野物流格位前移，最近一件真事用你嘅原話', gp && gp.stage >= 2 && /與綠野物流負責人會面/.test(gp.lastReal), gp);
  const hp = (await get('/api/dashboard')).brain.items.find(x => x.id === 'pipeline').detail.prospects.find(p => p.name === '何師傅');
  ok('下一個對外動作改去何師傅嗰站：唔當何師傅有真事、格位唔郁（試走揭出）', hp && hp.stage === 0 && !hp.lastReal, hp);
  // 體檢側卡（你可能未想到）要修改：AI 按意見出修改版（試走揭出曾經搵唔到卡內容）
  seen = await seenIds();
  const rv = await post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'unseen', verdict: 'revise', text: '測試：刪去第一句' });
  const rvRun = await newRun(seen, r => r.kind === 'note' && r.noteType === 'feedback');
  ok('體檢側卡「要修改」：AI 出修改版', rv.code === 202 && rvRun && rvRun.state === 'done' && (rvRun.steps || []).some(s => s.key === 'ai' && s.state === 'done'), rvRun && { steps: rvRun.steps, result: rvRun.result });

  /* 每月覆核：體檢唔成功唔影響覆核；成功時寫入你上次嘅意見 */
  const oldTitle = ck.weak[0].title;
  const fb = await post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: ck.weak[0].id, verdict: 'useless', text: '測試意見：呢點同我無關' });
  ok('對體檢結果卡畀意見：收到', fb.code === 202, fb);
  await waitFor(async () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'brain-feedback.json'), 'utf8'))[ck.weak[0].id]; } catch { return null; } }, 30000);
  const ckPath = path.join(DATA, 'ledger', 'brain', 'checkup.json'), stale = { ...brainOf('checkup'), updatedAt: lib.localIso(new Date(Date.now() - 30 * 86400000)) };
  fs.writeFileSync(ckPath, JSON.stringify(stale));
  mode('checkup:checkup-bad');
  seen = await seenIds();
  await answer(monthlyPack('ask-test-monthly-1'));
  const m1 = await newRun(seen, r => r.kind === 'ask' && r.ref === 'ask-test-monthly-1');
  const m1s = m1 && (m1.steps || []).find(s => s.key === 'brain-checkup');
  ok('每月覆核：距上次體檢超過 28 日就重做；AI 交錯格式就記失敗，舊結果照留，覆核照樣完成', m1 && m1.state === 'done' && m1s && m1s.state === 'failed' && brainOf('checkup').updatedAt === stale.updatedAt, m1 && m1.steps);
  seen = await seenIds();
  await answer(monthlyPack('ask-test-monthly-2'));
  const m2 = await newRun(seen, r => r.kind === 'ask' && r.ref === 'ask-test-monthly-2');
  const ck2 = brainOf('checkup');
  const fbMd = m2 ? fs.readFileSync(path.join(DATA, 'sandbox', m2.id + '-checkup', 'feedback.md'), 'utf8') : '';
  ok('下一次體檢：工作說明寫入你上次嘅意見（卡名、沒有用、你嗰句）', fbMd.includes('「' + oldTitle + '」：沒有用——測試意見：呢點同我無關'), fbMd);
  ok('下一次體檢：側卡「要修改」嗰條意見都寫入', fbMd.includes('「' + N.dash.unseen + '」：要修改——測試：刪去第一句'), fbMd);
  ok('下一次體檢：結果記低考慮咗幾多條意見，日期更新', ck2 && ck2.feedbackUsed === 2 && ck2.updatedAt > stale.updatedAt && /已考慮你的 2 條意見/.test(ck2.summary), ck2);

  /* 商機掃描：訪問日前嘅日常工作入面做（同一次工作、時限三分之一）；六日內唔重做 */
  const sp = path.join(DATA, 'ledger', 'state.json'), s3 = state();
  s3.interviews = { ...(s3.interviews || {}), nextOn: lib.localIso().slice(0, 10) }; fs.writeFileSync(sp, JSON.stringify(s3, null, 2));
  const rhythm = () => new Promise(res => { const c = spawn(process.execPath, [path.join(PROTO, 'run.mjs'), '--type', 'rhythm', '--trigger', 'manual'], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' }); c.on('exit', res); });
  await waitFor(async () => !(await get('/api/dashboard')).ai.busy, 30000);
  await rhythm();
  const stR = state(), rr = (stR.runs || []).filter(r => r.type === 'rhythm').pop();
  const st5 = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'status.json'), 'utf8')).runs.find(r => rr && r.id === rr.id);
  const opStep = st5 && (st5.steps || []).find(s => s.key === 'brain-opportunities');
  const op = brainOf('opportunities');
  ok('訪問日前嘅日常工作：同一次工作先做商機掃描', opStep && opStep.state === 'done' && op && op.list.length === 2 && op.list.every(o => o.source), { steps: st5 && st5.steps, op });
  ok('商機掃描：網址另放、只接受 https', op && op.list[1].url === 'https://example.com/test' && !op.list[0].url, op && op.list);
  const opJob = st5 ? JSON.parse(fs.readFileSync(path.join(DATA, 'sandbox', st5.id + '-opportunities', 'task.md'), 'utf8').startsWith('> 今日日期：') ? '{"ok":1}' : '{}') : {};
  ok('商機掃描工作說明第一行有今日日期', opJob.ok === 1);
  await rhythm();
  const rr2 = (state().runs || []).filter(r => r.type === 'rhythm').pop();
  const st6 = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'status.json'), 'utf8')).runs.find(r => rr2 && r.id === rr2.id);
  ok('六日內再開日常工作：唔再做商機掃描', rr2 && rr2.id !== (rr && rr.id) && st6 && !(st6.steps || []).some(s => s.key === 'brain-opportunities'), st6 && st6.steps);

  /* 再次成頁確認、改動唔影響下一步：唔重新準備下一步，但未做過體檢就照做（試走揭出；升級前已確認嘅公司） */
  fs.renameSync(ckPath, ckPath + '.bak');
  seen = await seenIds();
  await proofread();
  const r9 = await newRun(seen, r => r.kind === 'proofread');
  const r9s = r9 && (r9.steps || []).find(s => s.key === 'brain-checkup');
  ok('再次確認冇改動：唔重新準備下一步，但補做未做過嘅生意體檢', r9 && r9.state === 'done' && r9s && r9s.state === 'done' && !(r9.steps || []).some(s => s.key === 'ai') && r9.result && r9.result.summary === N.ui.aiNextSkip && !!brainOf('checkup'), r9 && { steps: r9.steps, result: r9.result });
  fs.rmSync(ckPath + '.bak', { force: true });

  await declineOffers();
  /* 確認之後創辦人開一場辯論：來源係公司紀錄（冇試驗資料夾），工作資料夾有公司概覽同生意體檢結果，打完出回應包 */
  const ds = await post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '每週訂單定價（測試）', seats: ['付款者', '採購或審批者', '競爭者'], level: 'normal' });
  ok('確認之後開一場辯論：收到', ds.code === 202, ds);
  const dId = await waitFor(async () => { const d = await get('/api/debate'); return d.matches.length ? d.matches[d.matches.length - 1].id : null; });
  const dm = await waitFor(async () => { const m = (await get('/api/debate/match?id=' + dId)).match; return m && (m.phase === 'done' || m.phase === 'failed') ? m : null; }, 120000);
  const dRun = (await runsOf()).find(r => r.kind === 'debate' && r.ref === dId);
  const dSb = dRun ? path.join(DATA, 'sandbox', dRun.id) : '';
  ok('辯論打完（藍 → 紅 → 裁判）並出回應包', dm && dm.phase === 'done' && dm.packs && dm.packs.response, dm && { phase: dm.phase, packs: dm.packs });
  ok('辯論工作資料夾：有已確認公司概覽同生意體檢結果，冇試驗資料夾文件', dSb && fs.existsSync(path.join(dSb, 'confirmed-page.md')) && fs.existsSync(path.join(dSb, 'checkup.json')) && !fs.existsSync(path.join(dSb, 'docs')), dSb && fs.readdirSync(dSb));
  const dw = (await get('/api/dashboard')).brain.items.find(x => x.id === 'wargame');
  ok('生意大腦：紅藍對打等你回應，入口去回應包', dw.status === 'waiting' && dw.waitHref === '/#/ask/' + dm.packs.response, { status: dw.status, href: dw.waitHref });

  /* 「等你處理」同待決事項同源 */
  const bp = { format: 'startup-os.ask/0.1', id: 'ask-test-brain', title: '紅藍對打：需要你決定的事（測試）', askedBy: 'AI', askedAt: lib.localIso(), todoType: 'decision', brainItem: 'wargame', questions: [{ id: 'd1', ask: '先跟進哪一方？', kind: 'choice', options: [{ text: '綠野物流', rec: true }, { text: '食材周報' }], value: '綠野物流', effect: 'now', priority: 1, why: '測試理由' }] };
  fs.writeFileSync(path.join(DATA, 'asks', bp.id + '.json'), JSON.stringify(bp));
  const d2 = await get('/api/dashboard'), asks = await get('/api/asks');
  const tb = d2.todo.filter(t => t.brain), ab = asks.todo.filter(t => t.brain), lane = d2.brainTodo || [];
  ok('要拍板的裁判決定包留主線；辯論回應包留生意大腦；監察台同 Founder Desk 同一份', tb.length === 2 && tb.some(t => t.id === bp.id) && tb.some(t => t.id === dm.packs.decisions) && lane.some(t => t.id === dm.packs.response) && !tb.some(t => t.id === dm.packs.response) && tb.every(t => t.brain === 'wargame') && JSON.stringify(ab.map(t => t.id)) === JSON.stringify(tb.map(t => t.id)), { tb, ab });

  /* 畫面 */
  await openChrome();
  await go('/dashboard/system');
  ok('系統頁：寫明「已改由公司紀錄供料」', (await text('#sys-brain-src')) === N.dash.sourceLedger, await text('#sys-brain-src'));
  await go('/dashboard/brain');
  ok('生意大腦總覽：冇「試驗資料夾」來源徽章', !(await ev(`!!document.querySelector('#src-badge')`)) && !(await text('body')).includes(N.dash.sourceFolder), await text('#brain-head'));
  const waits = await ev(`[...document.querySelectorAll('#wait-strip li')].map(l=>({item:l.dataset.item,href:(l.querySelector('a')||{}).getAttribute&&l.querySelector('a').getAttribute('href'),t:l.innerText}))`);
  ok('等你處理：同待決事項同一份、同一次序（唔重複列）', JSON.stringify(waits.map(w => w.href)) === JSON.stringify(lane.map(t => t.href)) && waits.every(w => w.item === 'wargame'), { waits, lane: lane.map(t => t.href) });
  await shot('brain-overview.png');
  await go('/dashboard/brain/checkup');
  ok('生意體檢頁：顯示公司紀錄嘅弱位', (await ev(`document.querySelectorAll('.weak').length`)) === brainOf('checkup').weak.length, await ev(`document.querySelectorAll('.weak').length`));
  await go('/dashboard/brain/opportunities');
  ok('商機掃描頁：出處有網址就做連結，網址唔直接顯示', (await ev(`document.querySelectorAll('a.srclink').length`)) === 1 && !(await text('main')).includes('example.com'), await ev(`document.querySelectorAll('a.srclink').length`));
  await go('/dashboard/brain/pipeline');
  ok('客戶推進頁：五個對象，綠野物流已推進', (await ev(`document.querySelectorAll('#pipeline .pr').length`)) === 5 && (await text('#pipeline')).includes('綠野物流'), await text('#pipeline'));
  await shot('brain-pipeline.png');
  const hits = N.styleIssues((await text('#pipeline')).replace(/（測試）[^\n]*/g, ''));
  ok('客戶推進頁文字：用字檢查零命中', !hits.length, hits);
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
