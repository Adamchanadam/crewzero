// 生意大腦後端測試（假 AI）：六項狀態、紅藍對打按時間推進、意見三種、要你決定放上 CrewZero、情景演練作答後 AI 跟進、本機試驗資料夾讀法
// 用法：node brain-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const servers = [];
async function startServer(DATA, port) {
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
  servers.push(srv); const base = `http://127.0.0.1:${port}`;
  await usePass(base);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/status')).ok) break; } catch { } await sleep(250); }
  return base;
}
const api = B => ({ get: async p => (await fetch(B + p)).json(), post: async (p, body, origin = B) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; } });
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); };
async function answer(A, packId, values) {
  const { pack } = await A.get('/api/ask?id=' + packId);
  const answers = pack.questions.map(q => ({ id: q.id, value: q.id in values ? values[q.id] : q.value, ai: q.value, changed: q.id in values }));
  const text = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + new Date().toISOString()].join('\n') + '\n\n```json\n' + JSON.stringify({ format: 'startup-os.ask-reply/0.1', pack: pack.id, answers }) + '\n```\n';
  return A.post('/api/submit', { kind: 'ask-answer', ref: pack.id, text });
}
const runOf = async (A, pred) => (await A.get('/api/status')).runs.find(pred);
const item = (d, id) => d.brain.items.find(x => x.id === id);
function shiftSeed(DATA, sec) { const f = path.join(DATA, 'brain', 'reveal.json'); const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.seededAt = new Date(Date.now() - sec * 1000).toISOString(); fs.writeFileSync(f, JSON.stringify(r)); }

try {
  const DEMO = path.join(OUT, 'demo');
  seedDemo(DEMO, { reset: true });
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const B = await startServer(DEMO, Number(PORT)), A = api(B);
  ok('生意大腦分頁路由', (await fetch(B + '/dashboard/brain')).status === 200);
  let d = await A.get('/api/dashboard');
  ok('示範：六項都有', d.brain.source.kind === 'demo' && d.brain.items.length === 6 && d.brain.items.map(x => x.name).join() === '生意體檢,紅藍對打,情景演練,商機掃描,路線推演,對象推進追蹤');
  ok('四種狀態都出現：已完成、AI 進行中、等你處理、未開始', ['done', 'running', 'waiting', 'not_started'].every(s => d.brain.items.some(x => x.status === s)), d.brain.items.map(x => x.id + ':' + x.status));
  ok('紅藍對打：開頭只有藍隊（推進 6／19）', item(d, 'wargame').detail.stage === 1 && item(d, 'wargame').progress.done === 6 && item(d, 'wargame').progress.total === 19, item(d, 'wargame').progress);
  ok('情景演練等你：深連 CrewZero 練習，兩個對象', item(d, 'scenario').waitHref === '/#/practice/farm-c' && item(d, 'scenario').practice.length === 2);
  ok('生意體檢：三個弱位都有證據級、最平測試、停止條件、來源', item(d, 'checkup').detail.weak.length === 3 && item(d, 'checkup').detail.weak.every(w => w.evidence >= 0 && w.cheapestTest && w.stop && w.source));
  ok('客戶推進：七個對象（名單）、演練另外標明', item(d, 'pipeline').detail.prospects.length === 7 && item(d, 'pipeline').detail.prospects.some(p => p.rehearsal));
  // 推進（真時間）：紅隊攻擊逐條出現
  const t1 = await waitFor(async () => { const x = item(await A.get('/api/dashboard'), 'wargame').detail; return x.stage === 2 ? x : null; }, 30000);
  ok('真時間推進：紅隊開始攻擊（第二階段）', t1 && t1.rows.some(r => r.attacks.length), t1 && t1.stage);
  shiftSeed(DEMO, 100);
  d = await A.get('/api/dashboard');
  ok('裁判判緊：部分論點有判定、部分未判', item(d, 'wargame').detail.stage === 3 && item(d, 'wargame').detail.rows.some(r => r.verdict) && item(d, 'wargame').detail.rows.some(r => !r.verdict));
  // 未整合好就放上 CrewZero：講明原因
  const pre = await A.post('/api/intake', { kind: 'note', type: 'brain-decide', item: 'wargame', cardId: 'decide' });
  const r0 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === pre.j.id); return r && (r.state === 'failed' || r.state === 'done') ? r : null; });
  ok('未整合好：放唔上並講原因', r0 && r0.state === 'failed' && r0.error.includes('未整合好'), r0);
  shiftSeed(DEMO, 165);
  d = await A.get('/api/dashboard');
  const w = item(d, 'wargame');
  ok('整合完成：最大風險、推薦路線、要你決定、假設變動；你回應後轉強中', w.status === 'running' && w.detail.phase === 'strengthening' && w.detail.synthesis.topRisks.length === 3 && w.detail.synthesis.routes.length === 3 && w.detail.synthesis.founderDecisions.length === 2 && w.detail.synthesis.assumptionChanges.every(a => a.label === N.dash.aiUnconfirmed));
  ok('紅藍對打完成後路線推演開始', item(d, 'routes').status === 'running' && item(d, 'routes').progress);
  shiftSeed(DEMO, 260);
  ok('路線推演完成：每條有紅隊評分、第一個測試、停止條件', item(await A.get('/api/dashboard'), 'routes').status === 'done' && item(await A.get('/api/dashboard'), 'routes').detail.routes.every(r => r.redScore && r.firstTest && r.stop));
  // 要你決定 → 外殼機械出問題包 → 深連
  const p1 = await A.post('/api/intake', { kind: 'note', type: 'brain-decide', item: 'wargame', cardId: 'decide' });
  ok('放上 CrewZero：收到', p1.code === 202, p1);
  const r1 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === p1.j.id); return r && r.state === 'done' ? r : null; });
  d = await A.get('/api/dashboard');
  const dec = d.brain.decided.decide;
  ok('要你決定：放咗上 CrewZero（兩條即時生效、AI 建議打星）', r1 && dec && dec.open && (await A.get('/api/ask?id=' + dec.packId)).pack.questions.every(q => q.effect === 'now' && q.options.some(o => o.rec)), dec);
  ok('待你處理出現呢個問題包', d.todo.some(t => t.id === dec.packId));
  await answer(A, dec.packId, {});
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === dec.packId); return r && r.state === 'done'; });
  ok('答咗之後顯示已答', (await A.get('/api/dashboard')).brain.decided.decide.open === false);
  // 意見：有用照記
  const f1 = await A.post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'weak-1', verdict: 'useful', text: '呢個好啱' });
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === f1.j.id); return r && r.state === 'done'; });
  d = await A.get('/api/dashboard');
  ok('意見「有用」：記錄喺卡上同事件', d.brain.feedback['weak-1'].verdict === 'useful' && d.events.some(e => e.title.includes('的意見：有用')));
  ok('要修改冇寫原因唔收', (await A.post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'weak-2', verdict: 'revise', text: '' })).code === 400);
  ok('卡名唔啱唔收', (await A.post('/api/intake', { kind: 'note', type: 'feedback', item: 'bogus', cardId: 'weak-2', verdict: 'useful' })).code === 400);
  ok('本機以外來源唔收', (await A.post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'weak-2', verdict: 'useful' }, 'http://evil.example')).code === 403);
  // 要修改：AI 按意見改，卡上出「修改版」
  const f2 = await A.post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'weak-2', verdict: 'revise', text: '加埋請兼職司機嘅成本' });
  const r2 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === f2.j.id); return r && (r.state === 'done' || r.state === 'failed') ? r : null; });
  const sbTask = r2 && fs.readFileSync(path.join(DEMO, 'sandbox', r2.id, 'card.md'), 'utf8');
  ok('要修改：卡內容同意見交到 AI', sbTask && sbTask.includes('一人送貨能否應付') && fs.readFileSync(path.join(DEMO, 'sandbox', r2.id, 'note.md'), 'utf8').includes('兼職司機'));
  d = await A.get('/api/dashboard');
  const rev = d.brain.feedback['weak-2'].revision;
  ok('要修改：AI 改好，卡上有修改版', r2 && r2.state === 'done' && rev && rev.state === 'done' && rev.runId, rev);
  ok('修改版打得開', (await A.get('/api/run?id=' + rev.runId)).run.artifacts[0].text.includes('兼職司機'));
  // 情景演練：練完有覆盤就算完成（詳細喺情景演練測試）
  const ps = (await A.post('/api/practice', { action: 'start', scenarioId: 'farm-c', level: 'normal' })).j.session;
  await A.post('/api/practice', { action: 'say', sessionId: ps.id, text: '丙生，批發商幾耐俾錢？' });
  await A.post('/api/practice', { action: 'end', sessionId: ps.id });
  d = await A.get('/api/dashboard');
  ok('情景演練：練完有覆盤，狀態變已完成', item(d, 'scenario').status === 'done' && item(d, 'scenario').lastPractice, item(d, 'scenario'));
  ok('伺服器原始碼冇直接寫 AI 命令（扮對方經已認證工具嘅限制設定）', !/claude|codex|execute\(/.test(fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8').replace(/\/\/.*$/gm, '')));

  /* ---------- 本機試驗資料夾（用合成內容，唔用真實試驗內容） ---------- */
  const REAL = path.join(OUT, 'real'), TRIAL = path.join(OUT, 'trial');
  fs.mkdirSync(path.join(TRIAL, 'wargame'), { recursive: true });
  fs.mkdirSync(path.join(REAL, 'founder', 'desk'), { recursive: true });
  fs.writeFileSync(path.join(REAL, 'founder', 'desk', 'brain-source.json'), JSON.stringify({ dir: TRIAL }));
  const B2 = await startServer(REAL, Number(PORT) + 1), A2 = api(B2);
  let e = await A2.get('/api/dashboard');
  ok('試驗資料夾：冇檔就全部未開始', e.brain.source.kind === 'folder' && e.brain.items.every(x => x.status === 'not_started'), e.brain.items.map(x => x.status));
  fs.writeFileSync(path.join(TRIAL, '01-生意體檢.md'), '# 測試體檢\n\n## 最弱三個位\n\n### 弱位一：測試甲\n\n內容甲\n\n### 弱位二：測試乙\n\n內容乙\n\n## 你可能未諗到嘅\n\n- 一\n');
  fs.writeFileSync(path.join(TRIAL, 'wargame', '01-藍隊論證.md'), '# 藍隊論證（測試）\n\n- 論點一\n');
  e = await A2.get('/api/dashboard');
  ok('試驗資料夾：只有藍隊文件 → 照文件顯示、AI 進行中', item(e, 'wargame').status === 'running' && item(e, 'wargame').detail.docsOnly && item(e, 'wargame').detail.docs[0].title === '藍隊論證（測試）');
  fs.writeFileSync(path.join(TRIAL, 'wargame', 'blue.json'), JSON.stringify({ thesis: '測試主張', claims: [{ id: 'B1', topic: '付款', claim: '測試論點一', evidence: 1, source: '你原話 測試.md §1' }, { id: 'B2', topic: '渠道', claim: '測試論點二', evidence: 0, source: 'AI 解讀' }], strategies: [{ id: 'S1', name: '測試路線' }], admittedWeaknesses: [], sources: [] }));
  e = await A2.get('/api/dashboard');
  ok('試驗資料夾：體檢拆成卡（每個弱位一張）', item(e, 'checkup').status === 'done' && item(e, 'checkup').detail.cards.length === 3, item(e, 'checkup').detail && item(e, 'checkup').detail.cards.map(c => c.title));
  ok('試驗資料夾：得藍隊 → AI 進行中', item(e, 'wargame').status === 'running' && item(e, 'wargame').detail.stage === 1);
  fs.writeFileSync(path.join(TRIAL, 'wargame', 'red.json'), JSON.stringify({ attacks: [{ id: 'R1', claimId: 'B1', persona: '採購', attack: '測試攻擊', severity: '高' }] }));
  ok('試驗資料夾：紅隊檔出現 → 紅隊攻擊', item(await A2.get('/api/dashboard'), 'wargame').detail.stage === 2);
  fs.writeFileSync(path.join(TRIAL, 'wargame', 'judge.json'), JSON.stringify({ verdicts: [{ claimId: 'B1', verdict: '受傷', reason: '測試' }, { claimId: 'B2', verdict: '倒下', reason: '測試' }], topRisks: [{ rank: 1, risk: '測試風險', cheapestTest: '測試', stop: '測試' }], routes: [{ id: 'S1', name: '測試路線', recommended: true, why: '測試', redScore: '中', firstTest: '測試', stop: '測試' }], founderDecisions: [{ question: '測試決定？', options: ['A 甲', 'B 乙'], recommend: 'A', why: '測試', risk: '測試決定可能造成延誤。' }], assumptionChanges: [] }));
  e = await A2.get('/api/dashboard');
  ok('試驗資料夾：裁判檔出現 → 完場等你回應（去 CrewZero 場次頁），路線推演由裁判路線得出', item(e, 'wargame').status === 'waiting' && item(e, 'wargame').waitHref === '/#/debate/W1' && item(e, 'routes').status === 'done' && item(e, 'routes').detail.routes[0].name === '測試路線');
  ok('試驗資料夾：伺服器冇寫入試驗資料夾', fs.readdirSync(TRIAL).sort().join() === '01-生意體檢.md,wargame' && fs.readdirSync(path.join(TRIAL, 'wargame')).length === 4);
  const p2 = await A2.post('/api/intake', { kind: 'note', type: 'brain-decide', item: 'wargame', cardId: 'decide' });
  await waitFor(async () => { const r = await runOf(A2, x => x.kind === 'note' && x.ref === p2.j.id); return r && r.state === 'done'; });
  ok('試驗資料夾：要你決定都放得上 CrewZero（冇公司概覽都得）', !!(await A2.get('/api/dashboard')).brain.decided.decide);
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  for (const s of servers) s.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
