// 缺口 5 測試（唔開瀏覽器；隔離資料夾、缺口 5 版假 AI；只用程式副本 g5/dev）
// 用法：node overview-test.mjs <原型資料夾> <輸出資料夾> <起始埠> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT0, ADAPTER] = process.argv.slice(2);
const { oldInstall } = await import(new URL('../fixtures/old-install.mjs', import.meta.url).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(new URL('file:///' + path.join(PROTO, 'ask-lib.mjs').replace(/\\/g, '/')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
freshTestOut(OUT);
let srv = null, BASE = '', DATA = '';
async function start(name, port, seed) {
  if (srv) { srv.kill(); await sleep(500); }
  DATA = path.join(OUT, name, 'data'); BASE = `http://127.0.0.1:${port}`;
  fs.mkdirSync(DATA, { recursive: true }); if (seed) seed(DATA);
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
  await usePass(BASE);
  for (let i = 0; i < 60; i++) { try { if ((await get('/api/status')).ok) break; } catch { } await sleep(300); }
  await post('/api/setup', { action: 'certify', host: 'test' });
  for (let i = 0; i < 80; i++) { const s = await get('/api/setup'); if (s.certify && s.certify.state !== 'running') return s.certify.state; await sleep(400); }
}
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const runs = async () => (await get('/api/status')).runs;
const seen = async () => new Set((await runs()).map(r => r.id));
async function newRun(before, pred, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { const r = (await runs()).find(x => !before.has(x.id) && pred(x) && x.state !== 'running'); if (r) return r; await sleep(400); } return null; }
const st = () => JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
const page = () => JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
const conf = () => JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'confirmed.json'), 'utf8'));
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const log = () => fs.readFileSync(path.join(DATA, 'ledger', 'runs.log'), 'utf8');
const regOf = p => { const r = {}; (function w(o) { if (Array.isArray(o)) return o.forEach(w); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'label' in o && 'value' in o) r[o.id] = o; for (const k in o) if (o[k] && typeof o[k] === 'object') w(o[k]); })(p); return r; };
function proofread(edits, kinds, kindsChanged) {
  const p = page(); let c = null; try { c = conf(); } catch { }
  const order = c ? c.order : p.path.milestones.map(m => m.id);
  const machine = { format: 'startup-os.proofread-reply/0.1', page: p.page.id, company: p.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: c ? c.nextActionMilestone : 'm1', decided: [], edits, keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: kinds || {}, kindsChanged: kindsChanged || [] };
  const head = ['kind: proofread', 'ref: ' + p.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(p)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'proofread', ref: p.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
function answer(P, pick) {
  const answers = P.questions.map(q => { const v = pick ? pick(q) : q.value; return { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; });
  const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: P.questions.map(q => q.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
const packs = () => fs.readdirSync(path.join(DATA, 'asks')).map(f => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', f), 'utf8')));
const answered = id => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'answers', id + '.json'), 'utf8')).answers; } catch { return {}; } };
const fields = { q1: '把本地小農的當季蔬菜直送餐廳（測試）', q2: '餐廳每週付款', q3: '兩個農場有興趣（口頭表示）', q4: '約第三個農場主見面', q5: '表哥送貨（已確定）' };
const shownTexts = P => [P.title, P.context, ...P.questions.flatMap(q => [q.ask, q.judge, q.why, ...(q.options || []).map(o => o.text), q.kind === 'text' ? '' : q.value])];

try {
  /* ---------- 一：新格式（AI 照齊就緒清單） ---------- */
  ok('一：假 AI 認證', await start('one', Number(PORT0)) === 'passed');
  let b = await seen();
  await post('/api/intake', { bizType: 'other', fields, files: [] });
  let r = await newRun(b, x => x.kind === 'intake', 60000);
  ok('一：交資料 → AI 擬公司概覽', r && r.state === 'done', r && r.error);
  let p = page(), reg = regOf(p);
  const plans = new Set(Object.values(reg).map(f => f.plan).filter(Boolean));
  ok('一：公司概覽有 G1–G10 各欄（G4 為目前進展）', ['G1', 'G2', 'G3', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'].every(x => plans.has(x)) && p.glance.status.items.length && p.page.schema === 2, [...plans]);
  ok('一：冇叫 AI 修正（第一次就齊）', !/修正一次/.test(log()));
  ok('一：每個暫定值都有來源同限期（最遲四星期）', Object.values(reg).filter(f => f.tentative).every(f => ['ai', 'actor', 'founder'].includes(f.tentative.by) && /^\d{4}-\d{2}-\d{2}$/.test(f.tentative.until) && f.tentative.until <= new Date(Date.parse(p.page.preparedAt) + 28 * 864e5).toISOString().slice(0, 10)), Object.values(reg).filter(f => f.tentative).map(f => f.id + ':' + JSON.stringify(f.tentative)));
  ok('一：每站四格齊、有真事／工作建議', p.path.milestones.every(m => ['event', 'actor', 'witness', 'proof'].every(k => m[k] && String(m[k].value).trim()) && ['real', 'task'].includes(m.kind)), p.path.milestones.map(m => m.id + ':' + m.kind));
  // 成頁確認：你將第 3 站由「工作」改為「真事」
  b = await seen();
  await proofread([], { m3: 'real' }, ['m3']);
  r = await newRun(b, x => x.kind === 'proofread', 60000);
  ok('一：成頁確認完成（首次確認照開 AI）', r && r.state === 'done' && r.steps.some(x => x.key === 'ai'), r && r.steps.map(x => x.key + ':' + x.state));
  let s = st();
  ok('一：你的真事／工作判斷入帳本（第 3 站＝真事）', s.milestones.find(m => m.id === 'm3').kind === 'real' && conf().kinds.m3 === 'real');
  ok('一：開局答案入帳本：就緒清單齊（complete）、暫定值帶來源同限期', s.intake.state === 'complete' && !s.intake.missing.length && s.intake.answers.G2 && s.intake.answers.G2.tentative && s.intake.answers.G2.tentative.by === 'ai', s.intake);
  ok('一：決定紀錄記低每站真事／工作', fs.readFileSync(path.join(DATA, 'ledger', 'decisions.jsonl'), 'utf8').includes('kind-m3'));
  const dp = packs().find(x => x.depth);
  const m1 = s.milestones.find(m => m.id === (dp && dp.depth.milestoneId));
  ok('一：首次確認後放深化問題（路線上第一個待深化嘅真事站，最多三題，每題有建議同理由）', dp && m1 && m1.depth === 'shallow' && dp.questions.length >= 1 && dp.questions.length <= 3 && dp.questions.every(q => q.value && q.why), dp && dp.questions.map(q => q.ask + ' → ' + q.value));
  const dHits = dp ? shownTexts(dp).flatMap(t => N.styleIssues(String(t || '')).map(h => h.term)) : ['冇包'];
  ok('一：深化問題畫面文字零命中', !dHits.length, dHits);
  // 你寫一個答案（唔係照 AI 推斷）→ 已深化
  b = await seen();
  await answer(dp, q => q === dp.questions[0] ? '測試：農場主本人決定，見一次面即可簽' : q === dp.questions[1] ? '測試：要先有一頁簡介同付款條款' : q.value);
  r = await newRun(b, x => x.kind === 'ask' && x.ref === dp.id);
  s = st(); const m1b = s.milestones.find(m => m.id === dp.depth.milestoneId);
  ok('一：深化答案記入你原話、該站轉為已深化、事件流有「站點已深化」', m1b.depth === 'ok' && m1b.depthAnswers.some(a => a.founderText) && s.events.some(e => /站點已深化/.test(e.title)), { depth: m1b.depth, answers: m1b.depthAnswers, summary: r && r.result && r.result.summary });
  const dp2 = packs().find(x => x.depth && x.id !== dp.id && !Object.keys(answered(x.id)).length);
  if (dp2) {
    b = await seen(); await answer(dp2, () => N.ui.unknownLater); await newRun(b, x => x.kind === 'ask' && x.ref === dp2.id);
    const dp3 = packs().find(x => x.depth && x.id !== dp.id && x.id !== dp2.id);
    ok('一：答「不知道」嘅深化題唔會即刻重問同一題（下一包係另一站或另一題）', !dp3 || dp3.depth.milestoneId !== dp2.depth.milestoneId || dp3.questions.every(q => !dp2.questions.some(p => p.ask === q.ask)), dp3 && dp3.questions.map(q => q.ask));
  } else ok('一：答「不知道」嘅深化題唔會即刻重問同一題（冇第二包可試）', true);
  // 再同步（再次確認）唔會蓋走你嘅深化答案
  b = await seen();
  await proofread([], { m3: 'real' }, ['m3']);
  await newRun(b, x => x.kind === 'proofread', 60000);
  s = st();
  ok('一：再次確認後深化答案同已深化保留', s.milestones.find(m => m.id === dp.depth.milestoneId).depth === 'ok' && s.milestones.find(m => m.id === dp.depth.milestoneId).depthAnswers.some(a => a.founderText));
  const d1 = await get('/api/dashboard');
  ok('一：監察台：該站唔再標待深化；第 3 站類別＝真事', d1.milestones.find(m => m.id === dp.depth.milestoneId).depth === 'ok' && d1.milestones.find(m => m.id === 'm3').kind === 'real');

  /* ---------- 二：AI 冇照齊（修正一次後仍缺 → 空欄、首批工作） ---------- */
  ok('二：假 AI 認證', await start('two', Number(PORT0) + 1) === 'passed');
  mode('intake:intake-noready');
  b = await seen();
  await post('/api/intake', { bizType: 'other', fields, files: [] });
  r = await newRun(b, x => x.kind === 'intake', 60000);
  p = page(); reg = regOf(p);
  ok('二：AI 漏欄：外殼叫 AI 修正一次；仍缺就加空欄，唔阻校對', r && r.state === 'done' && /修正一次/.test(log()) && /修正後仍未齊/.test(log()) && p.page.schema === 2, r && r.error);
  const g2 = Object.values(reg).find(f => f.plan === 'G2'), g3 = Object.values(reg).find(f => f.plan === 'G3');
  ok('二：缺欄以空欄出現（等你補），節奏同業務線用預設', g2 && g2.origin === 'missing' && !g2.value && Object.values(reg).find(f => f.plan === 'G8').origin === 'default', { g2, g8: Object.values(reg).find(f => f.plan === 'G8') });
  b = await seen();
  await proofread([{ id: g2.id, plan: 'G2', label: g2.label, ai: '', founder: '四星期內：一個農場書面答覆', value: '四星期內：一個農場書面答覆' }]);
  r = await newRun(b, x => x.kind === 'proofread', 60000);
  s = st();
  const fb = s.tasks.filter(t => t.firstBatch);
  ok('二：就緒清單未齊（incomplete，列出未答齊嘅欄）；已補嘅短期目標唔再列', s.intake.state === 'incomplete' && s.intake.missing.includes('G3') && !s.intake.missing.includes('G2'), s.intake.missing);
  ok('二：缺少的資料轉成首批工作（每個缺欄、每個四格未齊嘅站各一項）', fb.some(t => t.id === 'md-G3') && fb.some(t => t.id === 'md-m1') && !fb.some(t => t.id === 'md-G2'), fb.map(t => t.id + ':' + t.title));
  const fbHits = fb.flatMap(t => N.styleIssues(t.title + ' ' + t.next).map(h => h.term));
  ok('二：首批工作標題零命中', !fbHits.length, fbHits);
  const d2 = await get('/api/dashboard');
  ok('二：監察台看板：首批工作排最前，寫明原因', d2.tasks[0] && d2.tasks[0].why && d2.tasks[0].why.rule === 0 && /首批工作/.test(d2.tasks[0].why.text), d2.tasks.slice(0, 2).map(t => t.title + '｜' + (t.why && t.why.text)));
  const prompt = fs.readFileSync(path.join(DATA, 'sandbox', r.id, 'confirmed-page.md'), 'utf8');
  ok('二：AI 準備下一步時讀到首批工作', /首批工作：缺少的資料/.test(prompt));
  b = await seen();
  await proofread([{ id: g2.id, plan: 'G2', label: g2.label, ai: '', founder: '四星期內：一個農場書面答覆', value: '四星期內：一個農場書面答覆' }, { id: g3.id, plan: 'G3', label: g3.label, ai: '', founder: '有農場簽協議', value: '有農場簽協議' }]);
  await newRun(b, x => x.kind === 'proofread', 60000);
  s = st();
  ok('二：補咗進展標準：嗰項首批工作轉完成', s.tasks.find(t => t.id === 'md-G3').status === 'done' && !s.intake.missing.includes('G3'));

  /* ---------- 三：目前進展的口頭表示不可推導站點完成 ---------- */
  ok('三：口頭表示測試 AI 認證', await start('said', Number(PORT0) + 2, d => {
    oldInstall(d, PROTO, { linkStatus: true, statusGrade: 'said' });
  }) === 'passed');
  mode('event:event-next');
  b = await seen();
  const saidEvent = await post('/api/intake', { kind: 'note', type: 'event', text: '測試：10 月 29 日與農場丙的陳先生會面，對方表示有興趣。', date: '2026-10-29' });
  r = await newRun(b, x => x.kind === 'note' && x.noteType === 'event', 60000);
  let saidState = st(), saidDashboard = await get('/api/dashboard'), saidMilestone = saidState.milestones.find(m => m.id === 'm1');
  ok('三：文件記錄的口頭表示不完成第 1 站，本季完成數為 0', r && r.state === 'done' && saidMilestone && saidMilestone.state !== 'done' && saidDashboard.metrics.quarter.done === 0, { milestone: saidMilestone, quarter: saidDashboard.metrics.quarter });

  /* ---------- 四：舊公司概覽遷移、目前進展推導站點、真實事件改下一個對外動作 ---------- */
  ok('四：假 AI 認證', await start('three', Number(PORT0) + 3, d => {
    oldInstall(d, PROTO, { linkStatus: true });
  }) === 'passed');
  mode('event:event-next');
  b = await seen();
  const ev = await post('/api/intake', { kind: 'note', type: 'event', text: '測試：10 月 29 日與 農場丙的陳先生 會面，對方答應介紹兩間餐廳。', date: '2026-10-29' });
  r = await newRun(b, x => x.kind === 'note' && x.noteType === 'event', 60000);
  p = page(); s = st();
  ok('四：舊公司概覽遷移到新格式（舊版入歷史）', p.page.schema === 2 && fs.readdirSync(path.join(DATA, 'company', 'history')).some(f => /before-migrate/.test(f)) && p.path.milestones.every(m => m.witness && m.proof && m.kind), fs.readdirSync(path.join(DATA, 'company', 'history')));
  const m1c = s.milestones.find(m => m.id === 'm1');
  ok('四：遷移保留三格權限（自己做／做完再通知／必須先問）', (p.detail.rules || []).some(x => x.boxes && (x.boxes.askFirst || []).length), p.detail.rules);
  ok('四：已確認嘅舊公司概覽遷移後都有一次深化問題', packs().some(x => x.depth) && s.depthPackFor === s.ledgerFrom, s.depthPackFor);
  ok('四：文件記錄的實際行動完成第 1 站，證明是交資料封存文件', m1c.state === 'done' && m1c.doneEvidence.length === 1 && fs.existsSync(path.join(DATA, m1c.doneEvidence[0])) && s.events.some(e => /站點已完成（目前進展）/.test(e.title)), m1c);
  ok('四：遷移後未答齊的欄位和四格轉為首批工作', s.tasks.some(t => t.id === 'md-G2') && s.tasks.some(t => t.id === 'md-m2'), s.tasks.filter(t => t.firstBatch).map(t => t.id));
  const input = s.inputs.find(i => i.id === 'in-' + ev.j.id), EP = packs().find(x => x.id === input.packId);
  const qn = EP && EP.questions.find(q => q.options[0].apply.op === 'setNextExternalAction');
  ok('四：真實事件確認包有「下一個對外動作改為甚麼？」（維持選項寫出現值）', qn && qn.ask === N.ui.nextActionAsk && qn.options[1] && /^維持「/.test(qn.options[1].text), EP && EP.questions.map(q => q.ask + '｜' + q.options.map(o => o.text).join('／')));
  b = await seen();
  await answer(EP);
  await newRun(b, x => x.kind === 'ask' && x.ref === EP.id);
  s = st();
  ok('四：確認後下一個對外動作改為新一句，事件流有記錄', s.company.nextExternalAction.text === qn.options[0].apply.text && s.events.some(e => /下一個對外動作改為/.test(e.title)), s.company.nextExternalAction);
  let d3 = await get('/api/dashboard');
  ok('四：監察台下一個對外動作同小旗跟新一句', d3.nextAction.text === qn.options[0].apply.text && d3.nextAction.milestoneId === (qn.options[0].apply.milestoneId || ''), d3.nextAction);
  b = await seen();
  await proofread([]);
  await newRun(b, x => x.kind === 'proofread', 60000);
  d3 = await get('/api/dashboard');
  ok('四：之後再次成頁確認（下一個對外動作冇改）唔會蓋走真實事件定嘅新一句', d3.nextAction.text === qn.options[0].apply.text, d3.nextAction);
  ok('四：監察台第 1 站已完成，唔再標待深化', d3.milestones.find(m => m.id === 'm1').state === 'done');
} catch (e) { ok('測試程式出錯', false, String(e && e.stack || e)); }
finally {
  if (srv) srv.kill();
  const pass = results.filter(x => x.pass).length;
  for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + (x.pass ? '' : '\n      ' + String(JSON.stringify(x.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
