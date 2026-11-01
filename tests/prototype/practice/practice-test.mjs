// 情景演練後端測試（假對手、假 AI）
// 用法：node practice-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
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
  servers.push(srv); const base = `http://127.0.0.1:${port}`;
  await usePass(base);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/status')).ok) break; } catch { } await sleep(250); }
  return base;
}
const api = B => ({ get: async p => (await fetch(B + p)).json(), post: async (p, body, origin = B) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; } });
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const runOf = async (A, pred) => (await A.get('/api/status')).runs.find(pred);
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'claude.json'), 'utf8'));
  const ca = cfg.chat.args, ti = ca.indexOf('--tools');
  ok('扮對方嘅啟動設定：冇工具、限制模式、唔讀設定、唔用 MCP', ti >= 0 && ca[ti + 1] === '' && ['--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence'].every(x => ca.includes(x)) && !ca.some(x => /dangerously|bypass|add-dir/.test(x)));
  const DATA = path.join(OUT, 'demo');
  seedDemo(DATA, { reset: true });
  // 未設定 AI：開始唔到並講原因
  const B0 = await startServer(DATA, Number(PORT) + 3), A0 = api(B0);
  const n0 = await A0.post('/api/practice', { action: 'start', scenarioId: 'farm-c', level: 'normal' });
  ok('未設定 AI：開始唔到並講原因', n0.code === 409 && n0.j.error === 'ai', n0);
  servers.pop().kill();
  await kit.certifyDirect(DATA, PROTO, ADAPTER);
  const B = await startServer(DATA, Number(PORT)), A = api(B);
  ok('情景演練畫面路由（Founder Desk）', (await fetch(B + '/')).status === 200);
  const pr = await A.get('/api/practice');
  ok('兩個示範場景（換對象都用得）', pr.scenarios.length === 2 && pr.scenarios.some(s => s.id === 'farm-c') && pr.scenarios.some(s => s.id === 'chef-a'), pr.scenarios.map(s => s.id));
  ok('你要做嘅行動：見農場丙已連場景', pr.actions.some(a => a.id === 'f1' && a.scenarioId === 'farm-c') && pr.actions.some(a => !a.scenarioId));
  const sc = (await A.get('/api/practice/scenario?id=farm-c')).scenario;
  ok('人物卡七項都有出處', ['identity', 'background', 'stance', 'interests', 'decision', 'concerns', 'style'].every(k => sc.persona[k] && sc.persona[k].text && sc.persona[k].source));
  ok('外來請求唔收', (await A.post('/api/practice', { action: 'start', scenarioId: 'farm-c' }, 'http://evil.example')).code === 403);
  // 開始（改人物卡一項）
  const st = await A.post('/api/practice', { action: 'start', scenarioId: 'farm-c', level: 'hard', edits: { stance: '其實好想搵新買家' } });
  const s0 = st.j.session;
  ok('開始：對方先開口、有建議講法、標練習', st.code === 200 && s0.turns[0].who === 'them' && s0.suggestions.length === 3 && s0.label === '練習 · 不算證據' && s0.level === 'hard');
  ok('改咗人物卡：標你改過、交到對方', s0.persona.stance.text === '其實好想搵新買家' && /你原話/.test(s0.persona.stance.source) && fs.readFileSync(path.join(DATA, 'sandbox', 'practice', s0.id, 'system.txt'), 'utf8').includes('其實好想搵新買家'));
  ok('對方心底顧慮交咗畀對方、難度係難搞', /心底嘅顧慮[\s\S]*H1/.test(fs.readFileSync(path.join(DATA, 'sandbox', 'practice', s0.id, 'system.txt'), 'utf8')) && /難搞/.test(fs.readFileSync(path.join(DATA, 'sandbox', 'practice', s0.id, 'system.txt'), 'utf8')));
  // 逐句
  let s = s0;
  for (const line of ['丙生，批發商幾耐俾錢？', '我哋可以設保底價。', '首兩個月半月結，點睇？']) {
    const r = await A.post('/api/practice', { action: 'say', sessionId: s.id, text: line });
    if (r.code !== 200) { ok('講一句：對方回應', false, r); break; }
    s = r.j.session;
  }
  ok('三句：對方逐句回應、有回應時間', s.turns.length === 7 && s.turns.filter(t => t.who === 'them').length === 4 && s.timing.length === 3);
  ok('目標追蹤：問中、應對、目標推進、情緒', s.state.asked.length >= 1 && s.state.handled.length >= 1 && s.state.goal >= 1 && s.state.mood, s.state);
  ok('建議講法同提示每句更新', s.suggestions[0].includes('3') && s.hint.includes('3'));
  // 同時送兩句：第二句等
  const [c1, c2] = await Promise.all([A.post('/api/practice', { action: 'say', sessionId: s.id, text: '第四句' }), (async () => { await sleep(40); return A.post('/api/practice', { action: 'say', sessionId: s.id, text: '同時第五句' }); })()]);
  ok('同時送兩句：第二句叫你等', c1.code === 200 && c2.code === 409, [c1.code, c2.code]);
  s = c1.j.session;
  // 收回
  const u = await A.post('/api/practice', { action: 'undo', sessionId: s.id });
  ok('重講呢句：收回你上一句同對方回應', u.code === 200 && u.j.session.turns.length === s.turns.length - 2 && u.j.session.turns[u.j.session.turns.length - 1].who === 'them');
  const r5 = await A.post('/api/practice', { action: 'say', sessionId: s.id, text: '重講：不如先試供一週？' });
  ok('收回之後再講：對方照回（交返之前對話）', r5.code === 200 && r5.j.session.turns.length === s.turns.length);
  // 完
  const e = await A.post('/api/practice', { action: 'end', sessionId: s.id });
  const rv = e.j.session.review;
  ok('完結：覆盤有反應摘要、目標、問題、反對、點解咁反應、心底顧慮、要改、可以改講', rv && rv.summary && rv.goal && rv.questions.length && rv.objections.length && rv.why.length && rv.hidden.length && rv.fixes.length && rv.betterLines.length);
  ok('會面卡：開場、問題、反對應對、收尾', rv && rv.card && rv.card.opening && rv.card.questions.length && rv.card.objections.length && rv.card.closing);
  ok('完結之後唔可以再講', (await A.post('/api/practice', { action: 'say', sessionId: s.id, text: 'x' })).code === 502);
  ok('練習紀錄：可重跑、列出紀錄', (await A.get('/api/practice')).sessions.some(x => x.id === s.id && x.review));
  const d = await A.get('/api/dashboard');
  ok('生意大腦第 3 項：練過有覆盤就算完成，可以再練', d.brain.items.find(x => x.id === 'scenario').status === 'done' && d.brain.items.find(x => x.id === 'scenario').practice.length === 2);
  ok('看板你要做：有練習連結', d.tasks.find(t => t.id === 'f1').scenarioId === 'farm-c');
  // 第二個對象（換對象）
  const s2 = (await A.post('/api/practice', { action: 'start', scenarioId: 'chef-a', level: 'easy' })).j.session;
  const r6 = await A.post('/api/practice', { action: 'say', sessionId: s2.id, text: '明哥，可唔可以落張試單？' });
  ok('換對象：餐廳甲主廚都練得', r6.code === 200 && r6.j.session.turns.length === 3);
  // 為一個你要做嘅行動準備場景
  const p1 = await A.post('/api/intake', { kind: 'note', type: 'practice-prep', taskId: 'f2', who: '發牌機關職員', text: '想問清楚只做配送使唔使牌照' });
  ok('準備練習：收到', p1.code === 202, p1);
  const pr1 = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === p1.j.id); return r && (r.state === 'done' || r.state === 'failed') ? r : null; });
  const nsc = pr1 && pr1.result && pr1.result.scenarioId ? (await A.get('/api/practice/scenario?id=' + pr1.result.scenarioId)).scenario : null;
  ok('準備練習：AI 準備好場景，連返個行動', nsc && nsc.counterpart.name === '發牌機關職員' && nsc.forTaskId === 'f2' && (await A.get('/api/practice')).actions.find(a => a.id === 'f2').scenarioId === nsc.id, pr1);
  ok('準備練習：冇講明對象唔收', (await A.post('/api/intake', { kind: 'note', type: 'practice-prep', taskId: '', text: '' })).code === 400);
  // 會後紀錄
  const db = await A.post('/api/intake', { kind: 'note', type: 'debrief', scenarioId: 'farm-c', sessionId: s.id, text: '丙答應試供一週，下週三開始', commitment: 'partly', followUp: '2026-11-04' });
  const dr = await waitFor(async () => { const r = await runOf(A, x => x.kind === 'note' && x.ref === db.j.id); return r && (r.state === 'done' || r.state === 'failed') ? r : null; });
  ok('會後紀錄：記低、AI 擬跟進問題放上待決事項', dr && dr.state === 'done' && dr.result.asks.length === 1 && (await A.get('/api/dashboard')).events.some(e => e.title.startsWith('會後紀錄：農場主丙')), dr);
  ok('會後紀錄：冇寫內容唔收', (await A.post('/api/intake', { kind: 'note', type: 'debrief', scenarioId: 'farm-c', text: '' })).code === 400);
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  for (const s of servers) s.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 800));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
