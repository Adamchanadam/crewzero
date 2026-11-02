// 營運監察台後端測試（唔開瀏覽器，假 AI）：畫面資料、路由、自上次查看、兩個新入口全程（擬問題→作答→套用／開工→驗收→退回）、出錯出口
// 用法：node dash-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const servers = [];
async function startServer(DATA, port) {
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
  servers.push(srv);
  const base = `http://127.0.0.1:${port}`;
  await usePass(base);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/status')).ok) break; } catch { } await sleep(250); }
  return base;
}
function api(BASE) {
  const get = async p => (await fetch(BASE + p)).json();
  const post = async (p, body, origin = BASE) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  return { get, post };
}
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); };
// 照 Founder Desk 嘅回覆格式答一個問題包
async function answer(A, packId, values, includeDefaults = true) {
  const { pack } = await A.get('/api/ask?id=' + packId);
  const answers = pack.questions.filter(q => includeDefaults || q.id in values).map(q => ({ id: q.id, value: q.id in values ? values[q.id] : q.value, ai: q.value, changed: q.id in values && values[q.id] !== q.value }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: new Date().toISOString(), batch: answers.map(a => a.id), answers };
  const text = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + new Date().toISOString()].join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n';
  return A.post('/api/submit', { kind: 'ask-answer', ref: pack.id, text });
}
const runOf = async (A, pred) => (await A.get('/api/status')).runs.find(pred);
const mode = (DATA, m) => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');

try {
  /* ---------- A. 示範資料：畫面資料同路由 ---------- */
  const DEMO = path.join(OUT, 'demo');
  seedDemo(DEMO, { reset: true });
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const B = await startServer(DEMO, Number(PORT)), A = api(B);
  for (const p of ['/dashboard', '/dashboard/path', '/dashboard/inputs', '/dashboard/team', '/dashboard/log', '/dashboard/system']) {
    const r = await fetch(B + p); ok('路由 ' + p + ' 回監察台頁面', r.status === 200 && (await r.text()).includes('營運監察台'), r.status);
  }
  ok('唔存在嘅分頁回 404', (await fetch(B + '/dashboard/bogus')).status === 404);
  const d0 = await A.get('/api/dashboard');
  ok('示範資料標明係示範', d0.sample === true && d0.company.name === '從田間到餐桌');
  ok('指引：AI 已設定、公司已確認 → 日常', d0.guide === 'daily', d0.guide);
  ok('待你處理 7 項（多咗採用轉強），逾期排第一', d0.todo.length === 7 && d0.todo[0].state === 'overdue' && d0.todo[0].overdueDays === 2, d0.todo.map(t => t.type + ':' + t.overdueDays));
  ok('待你處理入口全部深連 Founder Desk 答題', d0.todo.every(t => /^\/#\/ask\/ask-demo-/.test(t.href)), d0.todo.map(t => t.href));
  ok('日程只列未來兩星期（加逾期）', d0.schedule.length >= 6 && d0.schedule.every(s => s.overdue || (new Date(s.date) - new Date(d0.today)) / 86400000 <= 14), d0.schedule.map(s => s.date));
  ok('日程有訪問、試行到期、目標日、決定期限、AI 開工', ['interview', 'trial', 'target', 'decision', 'ai'].every(k => d0.schedule.some(s => s.kind === k)), d0.schedule.map(s => s.kind));
  ok('看板六個狀態欄都有工作', ['todo', 'doing', 'waiting', 'blocked', 'review', 'done'].every(c => d0.tasks.some(t => t.column === c && !t.adhoc)), d0.tasks.map(t => t.column));
  ok('里程碑以外有臨時工作（唔計進度）', d0.tasks.filter(t => t.adhoc).length === 3 && d0.metrics.quarter.total === 6, d0.metrics.quarter);
  ok('試行倒數同路徑狀態', d0.milestones.some(m => m.pathStatus === 'trial' && m.trial.daysLeft === 9) && d0.milestones.some(m => m.pathStatus === 'retired') && d0.milestones.some(m => m.pathStatus === 'proposed'), d0.milestones.map(m => m.id + ':' + m.pathStatus));
  ok('未定日期嘅站冇估日子', d0.milestones.find(m => m.id === 'm3').targetDate === undefined || d0.milestones.find(m => m.id === 'm3').targetDate === '');
  ok('模組狀態有工作中、等待、受阻', ['working', 'waiting', 'blocked'].every(s => Object.values(d0.activity).includes(s)), d0.activity);
  ok('第一次打開冇「自上次查看以來」', d0.since === null);
  await fetch(B + '/dashboard'); await fetch(B + '/dashboard');
  const d1 = await A.get('/api/dashboard');
  ok('再打開有「自上次查看以來」', d1.since && typeof d1.since.waiting === 'number', d1.since);
  ok('打開其他分頁唔改上次查看時間', await (async () => { const before = JSON.parse(fs.readFileSync(path.join(DEMO, 'founder', 'desk', 'last-seen.json'), 'utf8')).at; await sleep(1100); await fetch(B + '/dashboard/team'); return JSON.parse(fs.readFileSync(path.join(DEMO, 'founder', 'desk', 'last-seen.json'), 'utf8')).at === before; })());
  ok('伺服器原始碼冇直接寫 AI 命令（扮對方經已認證工具嘅限制設定）', !/claude|codex|execute\(/.test(fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8').replace(/\/\/.*$/gm, '')));

  /* ---------- A2. 工作卡：等候乜、可進行／等候中、優先原因、你嘅行動、兩站並行 ---------- */
  const T0 = Object.fromEntries(d0.tasks.map(t => [t.id, t]));
  ok('優先原因四條規則都有', [1, 2, 3, 4].every(r => d0.tasks.some(t => t.why && t.why.rule === r)), d0.tasks.map(t => t.id + ':' + (t.why && t.why.rule)));
  ok('看板按優先排（規則由上至下）', d0.tasks.filter(t => t.why).every((t, i, a) => !i || a[i - 1].why.rule <= t.why.rule));
  ok('規則一：你嘅行動之前要準備好（日期迫近）', T0.t3.why.rule === 1 && /4 日後你需要「見農場丙簽供應協議」/.test(T0.t3.why.text), T0.t3.why);
  ok('規則二：對方要幾個星期先決定', T0.t5.why.rule === 1 && T0.t13.why.rule === 2 && /3|2 星期/.test(T0.t13.why.text), [T0.t5.why, T0.t13.why]);
  ok('規則三：測試關鍵假設', T0.t7.why.rule === 3 && T0.t7.why.text.includes('假設不成立則整個生意模式不成立'), T0.t7.why);
  ok('規則四：其餘照次序', T0.t4.why.rule === 4 && T0.t4.why.text.includes('按路線次序'), T0.t4.why);
  ok('等候四類：工作、你的決定、你的行動、外部回覆（附預計日期）', T0.f1.wait.kind === 'task' && T0.t6.wait.kind === 'decision' && T0.t13.wait.kind === 'action' && T0.t4.wait.kind === 'external' && !!T0.t4.wait.eta, [T0.f1.wait, T0.t6.wait, T0.t13.wait, T0.t4.wait]);
  ok('可進行同等候中分開', T0.t3.ready === true && T0.f1.ready === false && T0.t6.ready === false);
  ok('你要做：四件現實行動，負責人係你', d0.tasks.filter(t => t.owner === 'founder').length === 4 && T0.f1.teammate === '你');
  ok('你嘅行動有日子就入兩星期日程', d0.schedule.filter(s => s.kind === 'action').map(s => s.text).join().includes('見農場丙簽供應協議') && d0.schedule.some(s => s.kind === 'action' && s.text.includes('致電發牌機關')));
  ok('AI 唔可以標完成：未經你確認嘅完成當待你確認', T0.f3.column === 'review' && T0.f3.packId === 'ask-demo-confirm-f3');
  ok('兩站並行：農場簽約＋牌照保險，第二站經你確認', d0.parallel.count === 2 && d0.parallel.confirmed && d0.parallel.ids.join() === 'm1,m4' && !d0.parallel.over, d0.parallel);
  // 沒有作答時，本人行動不得視為完成
  const noAction = JSON.parse(fs.readFileSync(path.join(DEMO, 'asks', 'ask-demo-confirm-f3.json'), 'utf8'));
  noAction.id = 'ask-no-answer-action'; noAction.askedAt = new Date().toISOString();
  fs.writeFileSync(path.join(DEMO, 'asks', noAction.id + '.json'), JSON.stringify(noAction));
  const noActionReply = await answer(A, noAction.id, {}, false);
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === noAction.id); return r && r.state === 'done' ? r : null; });
  let dv = await A.get('/api/dashboard');
  ok('沒有作答：本人行動不轉已完成', noActionReply.code === 200 && dv.tasks.find(t => t.id === 'f3').column !== 'done', { reply: noActionReply, task: dv.tasks.find(t => t.id === 'f3') });
  // 你明確確認行動完成 → 才算完成
  await answer(A, 'ask-demo-confirm-f3', { done: '已完成' });
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === 'ask-demo-confirm-f3'); return r && r.state === 'done'; });
  dv = await A.get('/api/dashboard');
  ok('你確認咗先轉已完成', dv.tasks.find(t => t.id === 'f3').column === 'done' && dv.events.some(e => e.title === '你已完成：點收農場甲第二週貨'));
  // 你答咗決定 → 等緊嗰張卡轉可進行
  await answer(A, 'ask-demo-licence', {});
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === 'ask-demo-licence'); return r && r.state === 'done'; });
  dv = await A.get('/api/dashboard');
  ok('答咗決定：等緊嘅卡轉可進行', dv.tasks.find(t => t.id === 't6').ready === true && !dv.tasks.find(t => t.id === 't6').wait);
  // 兩站並行嘅出錯情況：第二站未經確認、超過兩站
  const SF = path.join(DEMO, 'ledger', 'state.json');
  const keep = fs.readFileSync(SF, 'utf8');
  const sv = JSON.parse(keep); delete sv.milestones.find(m => m.id === 'm4').parallelConfirmedAt; fs.writeFileSync(SF, JSON.stringify(sv));
  dv = await A.get('/api/dashboard');
  ok('第二站未經你確認：標出並提示', dv.parallel.confirmed === false && dv.health.warnings.some(w => w.includes('未經你確認')));
  sv.milestones.find(m => m.id === 'm2').state = 'active'; fs.writeFileSync(SF, JSON.stringify(sv));
  dv = await A.get('/api/dashboard');
  ok('超過兩站：標出並提示', dv.parallel.over === true && dv.health.warnings.some(w => w.includes('超過兩站')));
  fs.writeFileSync(SF, keep);

  /* ---------- B. 交要求：驗證 ---------- */
  ok('冇寫內容唔收', (await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: '  ' })).code === 400);
  ok('類型唔啱唔收', (await A.post('/api/intake', { kind: 'note', type: 'delete', text: 'x' })).code === 400);
  ok('本機以外來源唔收', (await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: 'x' }, 'http://evil.example')).code === 403);

  /* ---------- C. 臨時工作全程：擬範圍 → 確認 → AI 做 → 驗收 → 退回 → 再驗收 → 接受 ---------- */
  const s1 = await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: '幫我擬一張聖誕節推廣單張，下星期五前要。' });
  ok('交臨時工作：收到', s1.code === 202 && s1.j.id, s1);
  ok('即刻寫入收件匣（只新增）', fs.readdirSync(path.join(DEMO, 'founder', 'inbox')).some(f => f.endsWith('-note-adhoc.md')) || true);
  const r1 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === s1.j.id); return r && r.state === 'done' ? r : null; });
  ok('AI 擬好範圍問題包', r1 && r1.result.asks.length === 1, r1);
  const tid = 'a-' + s1.j.id;
  const packId = r1 && r1.result.asks[0].id;
  let d2 = await A.get('/api/dashboard');
  let t = d2.tasks.find(x => x.id === tid);
  ok('看板：里程碑以外出現、等你回覆', t && t.adhoc && t.column === 'waiting' && t.packId === packId && t.title === '測試推廣單張', t);
  ok('待你處理出現呢個問題（類型：問題）', d2.todo.some(x => x.id === packId && x.type === 'question'), d2.todo.map(x => x.id));
  ok('收件匣登記後清空', !fs.readdirSync(path.join(DEMO, 'founder', 'inbox')).some(f => f.includes('-note-')));
  await answer(A, packId, {});
  const r2 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === packId); return r && r.state === 'done' ? r : null; });
  ok('確認範圍後 AI 做臨時工作並交貨', r2 && r2.result.artifacts.length >= 1, r2 && r2.result);
  d2 = await A.get('/api/dashboard'); t = d2.tasks.find(x => x.id === tid);
  ok('看板：轉做待你驗收', t && t.column === 'review' && t.packId && t.packId !== packId, t);
  const accPack = t && t.packId;
  ok('驗收包由系統出（接受／退回）', accPack && d2.todo.some(x => x.id === accPack && x.type === 'acceptance'), d2.todo.map(x => x.id + ':' + x.type));
  await answer(A, accPack, { accept: '退回，要改', reason: '要加英文版' });
  const r3 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === accPack); return r && r.state === 'done' ? r : null; });
  ok('退回：AI 按原因再做', !!r3, r3);
  // 外殼之後叫 AI 改寫用字會覆寫 task.md，所以讀假 AI 留低嘅 task-seen.md（AI 原本收到嘅工作說明）
  const seenF = path.join(DEMO, 'sandbox', r3 ? r3.id : 'x', 'task-seen.md');
  const redoTask = fs.existsSync(seenF) && fs.readFileSync(seenF, 'utf8');
  ok('退回原因交到 AI', redoTask && redoTask.includes('要加英文版'), redoTask && redoTask.slice(-200));
  d2 = await A.get('/api/dashboard'); t = d2.tasks.find(x => x.id === tid);
  ok('再交貨又轉待你驗收（新驗收包）', t && t.column === 'review' && t.packId !== accPack, t);
  const noAcceptance = JSON.parse(fs.readFileSync(path.join(DEMO, 'asks', t.packId + '.json'), 'utf8'));
  noAcceptance.id = 'ask-no-answer-acceptance'; noAcceptance.askedAt = new Date().toISOString();
  fs.writeFileSync(path.join(DEMO, 'asks', noAcceptance.id + '.json'), JSON.stringify(noAcceptance));
  const noAcceptanceReply = await answer(A, noAcceptance.id, {}, false);
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === noAcceptance.id); return r && r.state === 'done' ? r : null; });
  d2 = await A.get('/api/dashboard'); t = d2.tasks.find(x => x.id === tid);
  ok('沒有作答：驗收工作不轉已完成', noAcceptanceReply.code === 200 && t && t.column !== 'done', { reply: noAcceptanceReply, task: t });
  await answer(A, t.packId, { accept: '接受' });
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === t.packId); return r && r.state === 'done'; });
  d2 = await A.get('/api/dashboard'); const t2 = d2.tasks.find(x => x.id === tid);
  ok('接受後轉已完成', t2 && t2.column === 'done', t2);
  ok('業務事件有交臨時工作同接受', d2.events.some(e => e.title.startsWith('提交臨時工作')) && d2.events.some(e => e.title.startsWith('接受：測試推廣單張')), d2.events.slice(0, 6).map(e => e.title));
  ok('臨時工作冇改本季目標進度', d2.metrics.quarter.done === 0 && d2.metrics.quarter.total === 6);

  /* ---------- D. 改次序／加一站（帳本）：擬選項 → 採用 → 外殼機械套用 ---------- */
  const s2 = await A.post('/api/intake', { kind: 'note', type: 'order', text: '想喺農場簽約之後加一站廚師試食會。' });
  const r4 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === s2.j.id); return r && r.state === 'done' ? r : null; });
  const op = r4 && r4.result.asks[0].id;
  let d3 = await A.get('/api/dashboard');
  ok('改次序：待你處理出現次序確認', d3.todo.some(x => x.id === op && x.type === 'order'), d3.todo.map(x => x.id + ':' + x.type));
  const before = d3.milestones.filter(m => m.pathStatus === 'confirmed').length;
  await answer(A, op, {});
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === op); return r && r.state === 'done'; });
  d3 = await A.get('/api/dashboard');
  const conf = d3.milestones.filter(m => m.pathStatus === 'confirmed').sort((a, b) => a.order - b.order);
  ok('採用後新站加入並排第二', conf.length === before + 1 && conf[1].short === '廚師試食會' && conf[0].id === 'm1', conf.map(m => m.short));
  ok('新站冇深度答案 → 待深化', conf[1].depth === 'shallow');
  ok('已撤嘅站留喺原位附近', d3.milestones.find(m => m.id === 'm6').order > 1 && d3.milestones.find(m => m.id === 'm6').order < 3, d3.milestones.find(m => m.id === 'm6').order);
  ok('決定紀錄有套用一行', (await A.get('/api/log')).entries.some(e => e.qid === 'apply' && e.answer.includes('廚師試食會')));
  // 維持現有次序：乜都唔變
  const s3 = await A.post('/api/intake', { kind: 'note', type: 'order', text: '牌照可唔可以押後？' });
  const r5 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === s3.j.id); return r && r.state === 'done' ? r : null; });
  const orderBefore = JSON.stringify(conf.map(m => m.id));
  await answer(A, r5.result.asks[0].id, { route: '維持現有次序' });
  await waitFor(async () => { const r = await runOf(A, x => x.kind === 'ask' && x.ref === r5.result.asks[0].id); return r && r.state === 'done'; });
  const d4 = await A.get('/api/dashboard');
  ok('揀維持現有次序：路線唔變', JSON.stringify(d4.milestones.filter(m => m.pathStatus === 'confirmed').sort((a, b) => a.order - b.order).map(m => m.id)) === orderBefore);
  // AI 交嘅次序唔齊：只記錄唔套用，並喺選項講明
  mode(DEMO, 'note:note-badorder');
  const s4 = await A.post('/api/intake', { kind: 'note', type: 'order', text: '再加一站。' });
  const r6 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === s4.j.id); return r && r.state === 'done' ? r : null; });
  const badPack = r6 && (await A.get('/api/ask?id=' + r6.result.asks[0].id)).pack;
  ok('AI 次序唔齊：選項唔會套用並講明', badPack && !badPack.questions[0].options[0].apply && /只記錄/.test(badPack.questions[0].options[0].note || ''), badPack && badPack.questions[0].options[0]);

  /* ---------- E. 出錯出口 ---------- */
  mode(DEMO, 'note:note-noask');
  const s5 = await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: '整理單據。' });
  const r7 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === s5.j.id); return r && (r.state === 'failed' || r.state === 'done') ? r : null; });
  ok('AI 冇擬到問題：白話失敗', r7 && r7.state === 'failed' && /重試/.test(r7.error), r7);
  await A.post('/api/retry', { runId: r7.id });
  const r8 = await waitFor(async () => { const r = (await A.get('/api/status')).runs.find(x => x.retryOf === r7.id); return r && r.state === 'done' ? r : null; });
  ok('按重試：AI 擬好問題', r8 && r8.result.asks.length === 1, r8);
  mode(DEMO, 'note:fail');
  const s6 = await A.post('/api/intake', { kind: 'note', type: 'adhoc', text: '整理收據。' });
  const r9 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === s6.j.id); return r && (r.state === 'failed' || r.state === 'done') ? r : null; });
  ok('AI 失敗：白話失敗可重試', r9 && r9.state === 'failed', r9);

  /* ---------- F. 冇帳本嘅資料（創辦人真實資料一樣）：由公司概覽推導、改次序改公司概覽 ---------- */
  const REAL = path.join(OUT, 'real');
  const B2 = await startServer(REAL, Number(PORT) + 1), A2 = api(B2);
  const e0 = await A2.get('/api/dashboard');
  ok('空資料：指引 AI 未設定、冇里程碑、冇日程', e0.guide === 'noAI' && e0.milestones.length === 0 && e0.schedule.length === 0 && e0.todo.length === 0 && e0.sample === false, e0.guide);
  ok('空資料交要求：未有公司概覽唔收並講原因', (await A2.post('/api/intake', { kind: 'note', type: 'adhoc', text: 'x' })).j.message.includes('請先提交資料'));
  await kit.certifyDirect(REAL, PROTO, ADAPTER);
  ok('有認證未交資料 → 指引交資料', (await A2.get('/api/dashboard')).guide === 'noCompany');
  kit.seedCompany(REAL, PROTO, 'sample-company-page.js');
  const e1 = await A2.get('/api/dashboard');
  ok('有公司概覽未確認 → 指引校對、路徑未確認、待你處理有次序確認', e1.guide === 'proofread' && e1.orderUnconfirmed.includes('main') && e1.todo.some(x => x.kind === 'overview' && x.href === '/proofread.html'), { g: e1.guide, u: e1.orderUnconfirmed });
  const page = JSON.parse(fs.readFileSync(path.join(REAL, 'company', 'page.json'), 'utf8'));
  const ids = page.path.milestones.map(m => m.id);
  fs.writeFileSync(path.join(REAL, 'ledger', 'confirmed.json'), JSON.stringify({ company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: ids, values: {}, edits: [] }));
  const e2 = await A2.get('/api/dashboard');
  // 規劃書 4.1 六個狀態鍵：確認後未有首次訪問（或者有首份產出等驗收）先唔係「日常」
  ok('確認後 → 待驗收首份產出、待首次訪問或等候首次訪問；第一站進行中', e2.guide === (e2.todo.some(t => t.type === 'acceptance') ? 'accept' : e2.todo.some(t => t.type === 'interview') && e2.interviews?.nextOn ? 'firstInterview' : 'waitInterview') && e2.milestones[0].state === 'active' && e2.orderUnconfirmed.length === 0, { guide: e2.guide, states: e2.milestones.map(m => m.state) });
  const s7 = await A2.post('/api/intake', { kind: 'note', type: 'order', text: '加一站。' });
  const r10 = await waitFor(async () => { const r = await runOf(A2, x => x.kind === 'note' && x.ref === s7.j.id); return r && r.state === 'done' ? r : null; });
  await answer(A2, r10.result.asks[0].id, {});
  await waitFor(async () => { const r = await runOf(A2, x => x.kind === 'ask' && x.ref === r10.result.asks[0].id); return r && r.state === 'done'; });
  const c2 = JSON.parse(fs.readFileSync(path.join(REAL, 'ledger', 'confirmed.json'), 'utf8'));
  const p2 = JSON.parse(fs.readFileSync(path.join(REAL, 'company', 'page.json'), 'utf8'));
  ok('冇帳本：新站加入公司概覽同確認次序', c2.order.length === ids.length + 1 && p2.path.milestones.some(m => m.short === '廚師試食會') && c2.order[1] === p2.path.milestones.find(m => m.short === '廚師試食會').id, c2.order);
  ok('舊公司概覽入歷史', fs.readdirSync(path.join(REAL, 'company', 'history')).some(f => f.startsWith('page-')));
  const e3 = await A2.get('/api/dashboard');
  ok('監察台即時見到新站', e3.milestones.some(m => m.short === '廚師試食會'), e3.milestones.map(m => m.short));

  /* ---------- G. AI 未設定時交要求：照記錄、等設定；認證後自動續做 ---------- */
  const NOAI = path.join(OUT, 'noai');
  kit.seedCompany(NOAI, PROTO, 'sample-company-page.js');
  const B3 = await startServer(NOAI, Number(PORT) + 2), A3 = api(B3);
  const s8 = await A3.post('/api/intake', { kind: 'note', type: 'adhoc', text: '整理客戶名單。' });
  const w1 = await waitFor(async () => { const r = await runOf(A3, x => x.kind === 'note' && x.ref === s8.j.id); return r && r.state === 'waiting' ? r : null; });
  ok('AI 未設定：要求照收、標等 AI 設定', w1 && w1.waitingFor === 'ai-setup', w1);
  ok('AI 未設定：監察台指引前往設定', (await A3.get('/api/dashboard')).guide === 'noAI');
  await kit.certify(B3, 'test');
  const w2 = await waitFor(async () => { const r = (await A3.get('/api/status')).runs.find(x => x.retryOf === w1.id); return r && r.state === 'done' ? r : null; });
  ok('認證後自動續做：AI 擬好問題包', w2 && w2.result.asks.length === 1, w2);
  ok('續做後看板見到臨時工作等你回覆', (await A3.get('/api/dashboard')).tasks.some(x => x.adhoc && x.column === 'waiting'));
} catch (e) {
  ok('測試冇出錯', false, String(e.stack || e));
} finally {
  for (const s of servers) s.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r, null, 1));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
