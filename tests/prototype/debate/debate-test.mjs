// 紅藍對打（辯論＋轉強）後端全程測試（假 AI）：開場、每回合、完場回應、重判、轉強核對、再攻兩輪、採用變你要做、出錯出口、AI 未設定、舊場（示範同試驗資料夾）唔郁原檔
// 用法：node debate-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
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
async function waitFor(fn, ms = 45000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); };
async function answer(A, packId, values, only) {
  const { pack } = await A.get('/api/ask?id=' + packId);
  const qs = only ? pack.questions.filter(q => only.includes(q.id)) : pack.questions;
  const answers = qs.map(q => ({ id: q.id, value: q.id in values ? values[q.id] : q.value, ai: q.value, changed: q.id in values && values[q.id] !== q.value }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: new Date().toISOString(), batch: answers.map(a => a.id), answers };
  const text = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + new Date().toISOString()].join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n';
  return A.post('/api/submit', { kind: 'ask-answer', ref: pack.id, text });
}
const mode = (DATA, m) => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const match = async (A, id) => (await A.get('/api/debate/match?id=' + id)).match;
const latestId = async (A, n) => { const d = await A.get('/api/debate'); return d.matches.length >= n ? d.matches[d.matches.length - 1].id : null; };
const until = (A, id, pred, ms) => waitFor(async () => { const m = await match(A, id); return m && pred(m) ? m : null; }, ms);
const hashDir = d => { const h = crypto.createHash('sha256'); for (const f of fs.readdirSync(d).sort()) h.update(f + fs.readFileSync(path.join(d, f))); return h.digest('hex'); };
const raw = (DATA, id, n) => JSON.parse(fs.readFileSync(path.join(DATA, 'debates', id, n), 'utf8'));

try {
  /* ---------- A. 示範：舊場 D1、開場選項、輸入核對 ---------- */
  const DEMO = path.join(OUT, 'demo');
  seedDemo(DEMO, { reset: true });
  // 辯論示範論點引用的假設及證據級，必須存在於這個隔離測試帳本。
  { const f = path.join(DEMO, 'ledger', 'state.json'), s = JSON.parse(fs.readFileSync(f, 'utf8')); s.company.assumptions = [
    { id: 'H1', text: '咖啡愛好者願意為新鮮烘焙付較高月費', grade: 'said' },
    { id: 'H2', text: '兩間工房可以每月穩定供貨', grade: 'did' },
    { id: 'H3', text: '上班族在超市買不到新鮮烘焙的咖啡豆', grade: 'did' },
    { id: 'H4', text: '創辦人親自包裝寄貨足以應付首五十位訂戶', grade: 'guess' }
  ]; fs.writeFileSync(f, JSON.stringify(s)); }
  { const f = path.join(DEMO, 'brain', 'reveal.json'), r = JSON.parse(fs.readFileSync(f, 'utf8')); r.seededAt = new Date(Date.now() - 900000).toISOString(); fs.writeFileSync(f, JSON.stringify(r)); }
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const B = await startServer(DEMO, Number(PORT)), A = api(B);
  let d = await A.get('/api/debate');
  ok('開場選項：六種題目、預設席位、全場／快打', d.types.length === 6 && d.types.find(t => t.id === 'business').format === '全場' && d.types.find(t => t.id === 'pricing').format === '快打' && d.types.every(t => t.seats.length >= 3), d.types);
  ok('示範第 1 場（舊場）喺場次清單，等你採用', d.matches.length === 1 && d.matches[0].id === 'D1' && d.matches[0].legacy, d.matches);
  const demoWar = hashDir(path.join(DEMO, 'brain', 'wargame'));
  ok('開場：題目類型唔啱唔收', (await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'xx', title: 't', seats: ['a', 'b'] })).code === 400);
  ok('開場：冇題目唔收', (await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: ' ', seats: ['a', 'b'] })).code === 400);
  ok('開場：少過兩席唔收', (await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '定價', seats: ['a'] })).code === 400);
  ok('開場：本機以外唔收', (await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '定價', seats: ['a', 'b'] }, 'http://evil.example')).code === 403);
  ok('場次操作：唔啱嘅操作唔收', (await A.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: 'D1', action: 'delete' })).code === 400);

  /* ---------- B. 快打（定價）：藍 → 紅 → 裁判 → 完場出回應包 ---------- */
  const seats1 = ['付款者', '採購或審批者', '競爭者'];
  mode(DEMO, 'debate-blue:slow\nnote:slow');
  ok('開場：快打收到', (await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '每月咖啡訂閱定價', seats: seats1, level: 'hard' })).code === 202);
  const id1 = await waitFor(() => latestId(A, 2));
  const priorityHelp = await A.post('/api/intake', { kind: 'note', type: 'help', text: '請在下一輪前說明。' });
  const priorityRun = priorityHelp.code === 202 && await waitFor(async () => (await A.get('/api/status')).runs.find(r => r.kind === 'note' && r.ref === priorityHelp.j.id && r.state === 'running'), 20000);
  ok('求助優先：藍方完成後先處理求助，紅方尚未開始', priorityRun && !fs.existsSync(path.join(DEMO, 'debates', id1, 'red.json')), { priorityRun, redExists: id1 && fs.existsSync(path.join(DEMO, 'debates', id1, 'red.json')) });
  let m1 = await until(A, id1, m => m.phase === 'done');
  ok('快打：三個回合做完（冇反駁）、完場', m1 && m1.format === '快打' && m1.rebuttals === 0 && m1.budget.aiStarts === 3 && !fs.existsSync(path.join(DEMO, 'debates', id1, 'rebuttal.json')), m1 && { f: m1.format, b: m1.budget, ph: m1.phase });
  ok('快打：紅方身份全部係今場席位、每個身份有最在意', m1 && m1.rows.every(r => r.attacks.every(a => seats1.includes(a.persona))) && m1.seats.length === 3 && m1.seats.every(s => s.cares), m1 && m1.seats);
  ok('快打：測試 AI 冇角色模型表 → 三方同一模型，標獨立性低', m1 && m1.roles.blue.model === m1.roles.judge.model && m1.warnings.includes('三方同一模型，獨立性低'), m1 && { r: m1.roles, w: m1.warnings });
  ok('快打：記分、四個關鍵時刻、紅方命中率', m1 && m1.score.standing + m1.score.wounded + m1.score.fallen === 6 && m1.keyMoments.length === 4 && m1.score.redHitRate > 0, m1 && m1.score);
  const rp1 = m1 && m1.packs.response;
  const pk1 = rp1 && (await A.get('/api/ask?id=' + rp1)).pack;
  ok('完場：回應包有三條關鍵時刻、證據、證據級、挑戰裁判', pk1 && ['v1', 'v2', 'v3', 'ev', 'evg', 'ch'].every(q => pk1.questions.some(x => x.id === q)) && pk1.debate.kind === 'response', pk1 && pk1.questions.map(q => q.id));
  const dp1 = m1 && m1.packs.decisions, dk1 = dp1 && (await A.get('/api/ask?id=' + dp1)).pack;
  const decisionMap = JSON.parse(fs.readFileSync(path.join(DEMO, 'ledger', 'brain-decisions.json'), 'utf8'));
  ok('裁判決定題自動到 Founder Desk：最多三題、即時生效並保留風險', dp1 && decisionMap[id1] === dp1 && dk1 && dk1.questions.length <= 3 && dk1.questions.every(q => q.effect === 'now' && q.risk), dk1 && dk1.questions);
  const asksBeforeManual = fs.readdirSync(path.join(DEMO, 'asks')).filter(f => f.endsWith('.json')).length;
  const manualDecision = await A.post('/api/intake', { kind: 'note', type: 'brain-decide', item: 'wargame', cardId: 'decide', matchId: id1 });
  if (manualDecision.code === 202) await waitFor(async () => (await A.get('/api/status')).runs.find(r => r.ref === manualDecision.j.id && r.state !== 'running'), 20000);
  const asksAfterManual = fs.readdirSync(path.join(DEMO, 'asks')).filter(f => f.endsWith('.json')).length;
  ok('裁判決定題同一場只放一次，手動舊入口不會重複建立', manualDecision.code === 202 && asksBeforeManual === asksAfterManual && JSON.parse(fs.readFileSync(path.join(DEMO, 'ledger', 'brain-decisions.json'), 'utf8'))[id1] === dp1, { before: asksBeforeManual, after: asksAfterManual });
  ok('監察台：紅藍對打等你回應、深連回應包', (await A.get('/api/dashboard')).brain.items.find(x => x.id === 'wargame').waitHref === '/#/ask/' + rp1);

  /* ---------- C. 全場（成盤生意）：加藍方反駁；第二場回應包照出（唔會當答過） ---------- */
  ok('開場：全場收到', (await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'business', title: '月月鮮烘整體生意（第二次）', seats: ['付款者', '買家或使用者', '競爭者', '投資者'], level: 'normal' })).code === 202);
  const id2 = await waitFor(() => latestId(A, 3));
  let m2 = await until(A, id2, m => m.phase === 'done');
  ok('全場：四個回合、有反駁', m2 && m2.format === '全場' && m2.rebuttals > 0 && m2.budget.aiStarts === 4, m2 && m2.budget);
  ok('全場：回應包都出到（第二場唔會當答過）', m2 && m2.packs.response && (await A.get('/api/ask?id=' + m2.packs.response)).pack.questions.length === 6);
  ok('全場：較上場只同同類題目比（同示範第 1 場成盤生意比，唔同定價比）', m2 && m2.delta && m2.delta.prevId === 'D1', m2 && m2.delta);
  ok('快打（定價）係第一場定價：冇較上場', !(await match(A, id1)).delta);
  // 回應：不同意第一個關鍵時刻（一擊倒下 B4）、挑戰一句、寫一個真實證據
  await answer(A, m2.packs.response, { v1: '不同意', ch: '其實已物色兼職包裝人手', ev: '創辦人上週試行一晚包裝五十包，並記錄時間', evg: '有人講過' });
  m2 = await until(A, id2, m => m.phase === 'adopt', 60000);
  ok('回應：記低表態、證據、挑戰（你原話）', m2 && m2.founder.votes[0].agree === false && m2.founder.evidence.length === 1 && m2.founder.challenges[0].claimId === 'B4' && m2.founder.challenges[0].note.includes('兼職包裝人手'), m2 && m2.founder);
  ok('重判：只改挑戰嗰條、標重判、原判保留', m2 && m2.rows.find(r => r.claim.id === 'B4').verdict.rejudged === true && fs.existsSync(path.join(DEMO, 'debates', id2, 'judge-original.json')) && m2.founder.challenges[0].rejudged, m2 && m2.rows.map(r => r.verdict));
  ok('證據：出確認包，唔自動改證據級', m2 && m2.founder.evidence[0].packId && (await A.get('/api/ask?id=' + m2.founder.evidence[0].packId)).pack.debate.kind === 'evidence' && m2.rows.every((r, i) => r.claim.evidence === raw(DEMO, id2, 'blue.json').claims[i].evidence));
  const s2 = m2 && m2.strengthen;
  ok('轉強：企得住而冇人反對嘅論點唔出卡（T4 退回並記原因）', s2 && !s2.cards.some(c => c.id === 'T4') && m2.warnings.some(w => w.includes('第 4 張轉強卡') && w.includes('退回')), s2 && { c: s2.cards.map(c => c.id), w: m2.warnings });
  ok('轉強：必須先問由系統重算（改價、伙伴）', s2 && s2.cards.find(c => c.id === 'T1').askFirst === true && s2.cards.find(c => c.id === 'T3').askFirst === false);
  ok('轉強：測試日期都喺 14 日內', s2 && s2.cards.every(c => { const n = (new Date(c.test.by) - new Date(new Date().toDateString())) / 864e5; return n >= 0 && n <= 14.5; }), s2 && s2.cards.map(c => c.test.by));
  ok('轉強：卡冇寫證據級、全部擬議同未確認', s2 && s2.cards.every(c => c.status === '擬議' && c.label === N.dash.aiUnconfirmed && !('evidence' in c)));
  ok('再攻第一輪：自動做、每張卡有印章', s2 && s2.rounds === 1 && s2.cards.every(c => c.reattacks.length === 1 && c.reattacks[0].verdict) && m2.budget.aiStarts === 4 + 1 + 1 + 2, m2 && m2.budget);
  const ap2 = m2 && [].concat(m2.packs.adoption || [])[0];
  const apk = ap2 && (await A.get('/api/ask?id=' + ap2)).pack;
  ok('採用包：必須先問嘅卡逐張即時生效、其餘暫定', apk && apk.questions.filter(q => q.effect === 'now').map(q => q.id).join() === 'c-T1,c-T2' && apk.questions.find(q => q.id === 'c-T3').effect === 'tentative', apk && apk.questions.map(q => q.id + ':' + q.effect));
  ok('監察台：等你採用、深連採用包', (await A.get('/api/dashboard')).brain.items.find(x => x.id === 'wargame').waitHref === '/#/ask/' + ap2);
  // 只答第一條（採用 T1），T2 必須先問未答 → 唔套用；T3 暫定照建議
  await answer(A, ap2, { 'c-T1': '採用' }, ['c-T1', 'c-T3']);
  m2 = await until(A, id2, m => m.strengthen.cards.find(c => c.id === 'T1').status === '已採用', 20000);
  ok('採用：T1 已採用、T3 照建議採用、T2 未答仍然擬議', m2 && m2.strengthen.cards.find(c => c.id === 'T3').status === '已採用' && m2.strengthen.cards.find(c => c.id === 'T2').status === '擬議' && m2.phase === 'adopt', m2 && m2.strengthen.cards.map(c => c.id + c.status));
  let dash = await A.get('/api/dashboard');
  const fa = dash.tasks.find(t => t.id === 'df-' + id2 + '-T1'), tt = dash.tasks.find(t => t.id === 'dt-' + id2 + '-T1');
  ok('採用：生成你要做嘅行動（有日期）同測試工作（點解排先）', fa && fa.owner === 'founder' && fa.dueAt && tt && tt.owner === 'ai' && tt.why, { fa, tt });
  ok('採用：修訂草案標你已認同', m2 && m2.strengthen.modelRevision.cells.filter(c => c.fromCardId === 'T1').every(c => c.adopted));
  await answer(A, ap2, { 'c-T2': '不採用' }, ['c-T2']);
  m2 = await until(A, id2, m => m.phase === 'adopted', 20000);
  // 外殼先寫 strengthen.json（階段即刻變已採用）再寫場次紀錄；等呢次作答嘅工作做完先讀，免得讀到中間狀態
  await waitFor(async () => (await A.get('/api/status')).runs.filter(r => r.ref === ap2).every(r => r.state !== 'running'), 20000);
  m2 = m2 && await match(A, id2);
  ok('不採用：唔生成工作，全部決定咗 → 已採用', m2 && m2.strengthen.cards.find(c => c.id === 'T2').status === '唔採用' && !(await A.get('/api/dashboard')).tasks.some(t => t.id === 'dt-' + id2 + '-T2') && m2.founder.rejectedCardIds.includes('T2'), m2 && { phase: m2.phase, cards: m2.strengthen.cards.map(c => c.id + ':' + c.status), rejected: m2.founder.rejectedCardIds });
  ok('監察台：採用完紅藍對打變已完成', (await A.get('/api/dashboard')).brain.items.find(x => x.id === 'wargame').status === 'done');

  /* ---------- D. 再攻第二輪（第 2 場定價）：兩輪後仍倒下 → 改先驗證 ---------- */
  mode(DEMO, 'debate-strengthen:strengthen-aitest');
  await answer(A, m1.packs.response, {});
  m1 = await until(A, id1, m => m.phase === 'adopt', 60000);
  ok('全部同意：唔重判、直接轉強同再攻', m1 && !m1.budget.rejudged && m1.strengthen.rounds === 1, m1 && m1.budget);
  const a1 = m1 && m1.strengthen.cards.find(c => c.id === 'T1'), a3 = m1 && m1.strengthen.cards.find(c => c.id === 'T3');
  ok('AI 做得到嘅測試：唔交畀你做（拎走你要做）、未查就標「AI 未查」照出卡', a1 && a1.test.testBy === 'ai' && !a1.test.founderAction && a1.test.aiNote === '未查' && m1.warnings.some(w => w.includes('第 1 張轉強卡') && w.includes('不需由你進行')), a1 && { test: a1.test, warnings: m1.warnings });
  ok('AI 已查：外部事實冇網址就改為觀察並記警告', a3 && a3.test.aiChecked[0].label === 'observation' && m1.warnings.some(w => w.includes('改為觀察')), a3 && a3.test);
  ok('裁判最傷三點有測試由誰做，AI 做得到嘅已查', m1 && m1.synthesis.topRisks.find(r => r.rank === 3).testBy === 'ai' && m1.synthesis.topRisks.find(r => r.rank === 3).aiChecked.length === 1);
  const apq = (await A.get('/api/ask?id=' + [].concat(m1.packs.adoption)[0])).pack.questions.find(q => q.id === 'c-T1');
  ok('採用包寫明 AI 未查', apq && apq.why.includes(N.dash.aiNotChecked), apq && apq.why);
  ok('再攻第二輪：收到', (await A.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: id1, action: 'reattack2' })).code === 202);
  m1 = await until(A, id1, m => m.strengthen.rounds === 2 && !m.next, 40000);
  const t2 = m1 && m1.strengthen.cards.find(c => c.id === 'T2');
  ok('再攻第二輪：每張卡兩個印章；兩輪仍倒下嘅卡改為先驗證', m1 && m1.strengthen.cards.every(c => c.reattacks.length === 2) && t2 && t2.handling === '先驗證' && t2.whyThis.includes('兩輪'), t2);
  await A.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: id1, action: 'reattack2' });
  await sleep(2500);
  ok('再攻第三輪唔准', (await match(A, id1)).strengthen.rounds === 2);

  /* ---------- E. 出錯出口：一方失敗 → 重跑一次；第二次唔准 ---------- */
  mode(DEMO, 'debate-red:debate-bad');
  await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'milestone', title: '首批寄貨安排', seats: ['該站的外部角色', '競爭者', '投資者'] });
  const id3 = await waitFor(() => latestId(A, 4));
  let m3 = await until(A, id3, m => m.phase === 'failed');
  ok('紅方交唔到格式：標未完成、唔會不停重試', m3 && m3.failed.pass === 'red' && !m3.next && m3.budget.aiStarts === 2, m3 && { failed: m3.failed, budget: m3.budget });
  const runsBefore = (await A.get('/api/status')).runs.length;
  await sleep(2500);
  ok('失敗之後伺服器唔會不停叫外殼', (await A.get('/api/status')).runs.length === runsBefore && !(await A.get('/api/status')).busy);
  ok('監察台：紅藍對打等你重跑', (await A.get('/api/dashboard')).brain.items.find(x => x.id === 'wargame').waitHref === '/#/debate/' + id3);
  await A.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: id3, action: 'rerun' });
  m3 = await until(A, id3, m => m.phase === 'done');
  ok('重跑一次：做完', m3 && m3.budget.reruns === 1, m3 && m3.budget);
  mode(DEMO, 'debate-strengthen:strengthen-allbad');
  await answer(A, m3.packs.response, {});
  m3 = await until(A, id3, m => m.phase === 'failed');
  ok('轉強卡全部唔合格：轉強失敗，原因寫明', m3 && m3.failed.pass === 'strengthen' && m3.failed.reason.includes('全部轉強卡均不合格'), m3 && m3.failed);
  await A.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: id3, action: 'rerun' });
  await sleep(3000);
  m3 = await match(A, id3);
  ok('第二次重跑唔准（每場一次）', m3.phase === 'failed' && m3.budget.reruns === 1);

  /* ---------- F. AI 未設定：等設定，設定好自動續做（唔計重跑） ---------- */
  fs.rmSync(path.join(DEMO, 'ledger', 'adapter-cert.json'));
  await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'partner', title: '請工房甲協助包裝', seats: ['伙伴本人', '投資者'] });
  const id4 = await waitFor(() => latestId(A, 5));
  let m4 = await until(A, id4, m => m.failed && m.failed.waitingAI);
  ok('AI 未設定：等設定，唔失敗', m4 && m4.phase === 'failed' && m4.failed.waitingAI, m4 && m4.failed);
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const wr = (await A.get('/api/status')).runs.find(r => r.kind === 'debate' && r.ref === id4 && r.state === 'waiting');
  await A.post('/api/retry', { runId: wr && wr.id });
  m4 = await until(A, id4, m => m.phase === 'done', 60000);
  ok('設定好之後續做到完場、唔計重跑次數', m4 && !m4.budget.reruns, m4 && m4.budget);

  /* ---------- G. 示範舊場 D1：採用寫入疊加資料夾，示範原檔唔郁 ---------- */
  // 示範按時間逐幕出現：將建立時間撥前，當成已經全部出現
  const rv = path.join(DEMO, 'brain', 'reveal.json'), rvj = JSON.parse(fs.readFileSync(rv, 'utf8')); rvj.seededAt = new Date(Date.now() - 600000).toISOString(); fs.writeFileSync(rv, JSON.stringify(rvj));
  await answer(A, 'ask-demo-strengthen', {}, ['c-T3', 'c-T4']);
  const d1 = await until(A, 'D1', m => m.strengthen.cards.some(c => c.status === '已採用'), 20000);
  ok('示範舊場：照 AI 建議採用（暫定卡），必須先問嘅卡要逐張答', d1 && d1.strengthen.cards.find(c => c.id === 'T3').status === '已採用' && d1.strengthen.cards.find(c => c.id === 'T1').status === '擬議', d1 && d1.strengthen.cards.map(c => c.id + c.status));
  ok('示範舊場：寫入疊加資料夾，示範辯論原檔冇改', fs.existsSync(path.join(DEMO, 'debates', 'D1', 'strengthen.json')) && hashDir(path.join(DEMO, 'brain', 'wargame')) === demoWar);
  let tk = (await A.get('/api/dashboard')).tasks;
  ok('AI 已查嘅測試採用之後唔再開工作；要你做嘅有行動同準備', !tk.some(t => t.id === 'dt-D1-T4') && tk.some(t => t.id === 'df-D1-T3' && t.owner === 'founder') && tk.some(t => t.id === 'dt-D1-T3'), tk.filter(t => /D1/.test(t.id)).map(t => t.id));
  await answer(A, 'ask-demo-strengthen', { 'c-T2': '採用' }, ['c-T2']);
  await until(A, 'D1', m => m.strengthen.cards.find(c => c.id === 'T2').status === '已採用', 20000);
  tk = (await A.get('/api/dashboard')).tasks;
  ok('要你批准嘅測試：你要做寫明「批准」', tk.some(t => t.id === 'df-D1-T2' && t.title.startsWith('批准：')), tk.filter(t => /D1/.test(t.id)).map(t => t.id + ':' + t.title));

  /* ---------- H. 試驗資料夾（舊場 W1，冇 match.json、冇反駁、冇裁判命中）：照常顯示；回應 → 轉強寫疊加，試驗資料夾唔郁 ---------- */
  const REAL = path.join(OUT, 'real'), TRIAL = path.join(OUT, 'trial');
  fs.mkdirSync(path.join(TRIAL, 'wargame'), { recursive: true });
  const ex = path.join(PROTO, 'fixtures', 'demo-shop', 'brain', 'wargame');
  const jx = JSON.parse(fs.readFileSync(path.join(ex, 'judge.json'), 'utf8')); delete jx.attackVerdicts; delete jx.factChecks; delete jx.overall;
  const bx = JSON.parse(fs.readFileSync(path.join(ex, 'blue.json'), 'utf8')); bx.admittedWeaknesses = ['未有訂戶付過錢', '包裝寄貨靠創辦人一人'];
  fs.writeFileSync(path.join(TRIAL, 'wargame', 'blue.json'), JSON.stringify(bx)); fs.copyFileSync(path.join(ex, 'red.json'), path.join(TRIAL, 'wargame', 'red.json')); fs.writeFileSync(path.join(TRIAL, 'wargame', 'judge.json'), JSON.stringify(jx));
  fs.writeFileSync(path.join(TRIAL, '01-生意體檢.md'), '# 生意體檢\n\n## 最弱三個位\n\n### 測試弱點\n\n內容\n');
  fs.mkdirSync(path.join(REAL, 'founder', 'desk'), { recursive: true });
  fs.writeFileSync(path.join(REAL, 'founder', 'desk', 'brain-source.json'), JSON.stringify({ dir: TRIAL }));
  kit.seedCompany(REAL, PROTO);
  await kit.certifyDirect(REAL, PROTO, ADAPTER);
  const trialHash = hashDir(path.join(TRIAL, 'wargame'));
  const B2 = await startServer(REAL, Number(PORT) + 1), A2 = api(B2);
  let w1 = (await A2.get('/api/debate')).matches[0];
  ok('試驗資料夾：舊場 W1 照常顯示（完場、冇轉強）', w1 && w1.id === 'W1' && w1.phase === 'done' && w1.cards === 0, w1);
  ok('試驗資料夾：舊場沒有裁判決定題仍可讀取，不會報錯', w1 && !w1.packs.decisions && (await A2.get('/api/status')).runs.every(r => r.state !== 'failed'), w1 && w1.packs);
  let wv = await match(A2, 'W1');
  ok('試驗資料夾：冇裁判命中 → 命中率留空、身份冇命中率；冇核實紀錄', wv && wv.score.redHitRate === null && wv.seats.every(s => s.hitRate === null) && wv.verified === null && wv.keyMoments.length >= 3, wv && { s: wv.score, v: wv.verified });
  ok('試驗資料夾：舊式自認弱點（文字）都讀到', wv && wv.admittedWeaknesses.length === 2);
  ok('監察台：試驗資料夾舊場等你回應（去 Founder Desk 場次頁）', (await A2.get('/api/dashboard')).brain.items.find(x => x.id === 'wargame').waitHref === '/#/debate/W1');
  await A2.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: 'W1', action: 'respond' });
  wv = await until(A2, 'W1', m => m.packs.response);
  ok('回應這場：外殼出回應包', wv && (await A2.get('/api/ask?id=' + wv.packs.response)).pack.questions.length === 6);
  await answer(A2, wv.packs.response, {});
  wv = await until(A2, 'W1', m => m.phase === 'adopt', 60000);
  ok('試驗資料夾：轉強同再攻寫入疊加資料夾，試驗資料夾冇改', wv && wv.strengthen.cards.length >= 2 && fs.existsSync(path.join(REAL, 'debates', 'W1', 'strengthen.json')) && hashDir(path.join(TRIAL, 'wargame')) === trialHash, wv && wv.phase);
  ok('轉強嘅沙盒有試驗資料夾嘅生意體檢文件', fs.readdirSync(path.join(REAL, 'sandbox')).some(d => fs.existsSync(path.join(REAL, 'sandbox', d, 'docs', '01-生意體檢.md'))));

  /* ---------- I. 硬上限：一場最多 11 次 AI 啟動 ---------- */
  const mm = path.join(DEMO, 'debates', id3, 'match.json'), mj = JSON.parse(fs.readFileSync(mm, 'utf8'));
  mj.budget.aiStarts = 11; mj.budget.reruns = 0; mj.failed = { pass: 'strengthen', reason: '測試' }; fs.writeFileSync(mm, JSON.stringify(mj));
  await A.post('/api/intake', { kind: 'note', type: 'debate-action', matchId: id3, action: 'rerun' });
  m3 = await until(A, id3, m => m.failed && m.failed.reason.includes('上限'));
  ok('到上限：唔再開 AI', m3 && m3.budget.aiStarts === 11, m3 && m3.failed);
  // 紅方兩次均覆蓋不足：額外一次退回計入啟動數，之後保留警告，不再退回。
  mode(DEMO, 'debate-red:skip-half\ndebate-red:skip-half');
  await A.post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '覆蓋退回測試', seats: seats1 });
  const id5 = await waitFor(() => latestId(A, 6));
  const m5 = await until(A, id5, m => m.phase === 'done');
  ok('紅方覆蓋不足最多退回一次，並計入啟動上限', m5 && m5.budget.aiStarts === 4 && m5.budget.redCoverageRetry === 1 && m5.budget.aiStarts <= m5.budget.hardCap && m5.warnings.some(w => w.includes('未被攻擊')), m5 && { budget: m5.budget, warnings: m5.warnings });
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  for (const s of servers) s.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 900));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
