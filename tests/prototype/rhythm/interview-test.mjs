// 每週訪問修正測試（模擬時鐘、隔離資料夾、假 AI、零費用）：
//   日期已過嘅下一個對外動作（改了日期／已舉行／取消了）、已過目標日嘅站（改目標日／已完成／不再做）、
//   文字題標「預設」、「全部沒有變化」一按（經真實頁面）記低係你確認。
// 測試夾具（照實記錄）：每次訪問前將下一個對外動作改成日期已過、將進行中嘅站目標日改成已過；放一筆提到該站嘅輸入。
// 用法：node interview-test.mjs <程式資料夾> <輸出資料夾> <埠> <假 AI 設定> <Chrome>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER, CHROME, START_ARG] = process.argv.slice(2);
// 模擬時鐘由固定起始日開始（同經營節奏測試一樣）：訪問日由「今日」推算，唔固定就會隨真實星期幾同時間變
const START = START_ARG || '2026-10-29T12:00:00';
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), U = N.ui;
const lib = await import(new URL('file:///' + path.join(PROTO, 'ask-lib.mjs').replace(/\\/g, '/')).href);
const results = []; const ok = (n, p, i) => { results.push({ name: n, pass: !!p, info: i }); console.log((p ? 'PASS ' : 'FAIL ') + n + (p ? '' : '  ' + String(JSON.stringify(i ?? '')).slice(0, 400))); };
freshTestOut(OUT);
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT;
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(DATA, 'founder', 'desk'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'founder', 'desk', 'sim-clock.json'), JSON.stringify({ offsetMs: Date.parse(START) - Date.now(), at: new Date().toISOString() }));
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const st = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8')); } catch { return { runs: [] }; } };
const setSt = f => { const s = st(); f(s); s.revision = (s.revision || 0) + 1; fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify(s, null, 2)); };
const page = () => JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
const pack = id => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', id + '.json'), 'utf8'));
const answers = id => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'answers', id + '.json'), 'utf8')).answers; } catch { return {}; } };
const packs = () => fs.readdirSync(path.join(DATA, 'asks')).map(f => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', f), 'utf8')));
const openPacks = () => packs().filter(p => p.questions.some(q => !answers(p.id)[q.id]));
const today = async () => (await get('/api/status')).today;
const dayText = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return `${+m[2]} 月 ${+m[3]} 日`; };
const addDays = (d, n) => lib.localIso(new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000)).slice(0, 10);
async function idle(ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const s = await get('/api/status'); if (!s.busy && !s.pending.length) { await sleep(400); const s2 = await get('/api/status'); if (!s2.busy && !s2.pending.length) return true; } await sleep(300); } return false; }
function proofread() {
  const p = page(), order = p.path.milestones.map(m => m.id);
  const machine = { format: 'startup-os.proofread-reply/0.1', page: p.page.id, company: p.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: {}, kindsChanged: [] };
  const head = ['kind: proofread', 'ref: ' + p.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(p)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'proofread', ref: p.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
// 答一份問題包：pick(q) 回答案（undefined＝唔答）
async function answer(id, pick) {
  const P = pack(id), done = answers(id);
  const list = P.questions.filter(q => !done[q.id]).map(q => { let v = pick ? pick(q) : q.value; if (v === undefined && q.bind === 'results') v = '沒有'; return v === undefined ? null : { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; }).filter(Boolean);
  const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
  const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
  await post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  await idle();
}
async function advance() {
  const before = (st().runs || []).filter(r => r.trigger === 'schedule').length;
  await post('/api/sim', { action: 'advance' });
  const t = Date.now();
  while (Date.now() - t < 60000) { const sr = (st().runs || []).filter(r => r.trigger === 'schedule'); if (sr.length > before && sr[sr.length - 1].state !== 'running' && await idle(20000)) return; await sleep(400); }
}
// 推前到出訪問包；途中自動停就答「繼續」
async function untilInterview() {
  for (let i = 0; i < 9; i++) {
    for (const p of openPacks()) if (p.rhythm && p.rhythm.kind === 'autoStop') await answer(p.id, () => U.autoStopGo);
    const iv = openPacks().find(p => p.rhythm && p.rhythm.kind === 'interview');
    if (iv) return iv;
    await advance();
  }
  return null;
}
// 夾具：下一個對外動作日期已過、進行中嘅站目標日已過
async function staleFixture(text, mid, target) {
  const t = await today();
  setSt(s => { s.company.nextExternalAction = { text, milestoneId: s.company.nextExternalAction.milestoneId }; if (mid) { s.targetOverride = { ...(s.targetOverride || {}), [mid]: target || addDays(t, -3) }; const m = s.milestones.find(x => x.id === mid); m.targetDate = target || addDays(t, -3); } });
}

let srv = null, c = null;
try {
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_SIM: '1', SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore' });
  // 機器忙時伺服器可能遲啲先起好：最多等 60 秒，起唔到就清楚報錯
  let up = false;
  await usePass(BASE);
  for (let i = 0; i < 200 && !up; i++) { try { up = !!(await get('/api/status')).ok; } catch { } if (!up) await sleep(300); }
  if (!up) throw new Error('伺服器 60 秒內未起好');
  await post('/api/setup', { action: 'certify', host: 'test' });
  for (let i = 0; i < 80; i++) { const s = await get('/api/setup'); if (s.certify && s.certify.state !== 'running') break; await sleep(400); }
  await post('/api/intake', { bizType: 'other', fields: { q1: '把本地小農的當季蔬菜直送餐廳（測試）', q2: '餐廳每週付款', q3: '兩個農場有興趣（口頭表示）', q4: '約第三個農場主見面', q5: '表哥送貨（已確定）' }, files: [] });
  await idle(60000); await proofread(); await idle(60000);
  const m1 = st().milestones.find(m => m.id === 'm1');
  ok('起點：第一站進行中', m1.state === 'active', m1.state);

  /* ---------- 第一次訪問：改了日期、改目標日；文字題標預設 ---------- */
  let t = await today();
  await staleFixture(dayText(addDays(t, 1)) + '約農場丙主人見面', 'm1');
  // 放一筆提到第一站嘅輸入（目標日之後）：完成題應建議「已完成」並寫出處
  setSt(s => { s.inputs = (s.inputs || []).concat({ id: 'in-fx1', kind: 'inbox', title: '真實事件（測試）：' + m1.short + '有進展', eventDate: addDays(t, -1), receivedAt: lib.localIso(), status: 'processed', effects: [] }); });
  let iv = await untilInterview();
  ok('一：訪問包出咗', !!iv);
  t = await today();
  const qStale = iv.questions.find(q => q.id === 'stale'), qOd = iv.questions.find(q => q.id === 'od');
  ok('一：下一個對外動作日期已過 → 改問「發生了嗎？」，唔再問「仍然是」', qStale && !iv.questions.some(q => q.id === 'next') && qStale.ask.includes('已過') && qStale.options.map(o => o.text).join('|') === [U.staleHeld, U.staleMoved, U.staleCancelled, U.unknownLater].join('|'), qStale);
  ok('一：公司紀錄冇相關事件 → AI 建議「稍後提供」，理由講明冇紀錄', qStale && qStale.value === U.unknownLater && qStale.options.find(o => o.rec).text === U.unknownLater && qStale.why === U.staleWhyNone, qStale && [qStale.value, qStale.why]);
  ok('一：已過目標日嘅站 → 問「完成了嗎？」（只一條）', qOd && iv.questions.filter(q => q.bind === 'overdue').length === 1 && qOd.overdue.milestoneId === 'm1' && qOd.options.map(o => o.text).join('|') === [U.overdueDone, U.overdueMove, U.overdueDrop, U.unknownLater].join('|'), qOd);
  ok('一：有提到該站嘅輸入 → AI 建議「已完成」並寫出處', qOd && qOd.value === U.overdueDone && /^公司紀錄有/.test(qOd.why), qOd && [qOd.value, qOd.why]);
  const frees = iv.questions.filter(q => q.bind === 'none');
  ok('一：文字題標「預設」（唔係 AI 推斷）、六條照問', frees.length >= 5 && frees.every(q => q.preset && q.noChange && q.value === U.interviewNone && q.why === U.interviewWhyNone), frees.map(q => q.id));
  ok('一：要你答實事嘅題唔算「沒有變化」', !qStale.noChange && !qOd.noChange);
  // 呢份訪問包已按舊（星期一）節奏放出；答之前改成星期三，下一次必須跟新日，唔可以沿用舊包加七日。
  setSt(s => { s.company.rhythm = { ...s.company.rhythm, interviewWeekday: 3 }; });
  await answer(iv.id, q => q.id === 'stale' ? U.staleMoved : q.id === 'od' ? U.overdueMove : undefined);
  let P = pack(iv.id);
  const qDate = P.questions.find(q => q.id === 'newDate'), qOdDate = P.questions.find(q => q.id === 'odDate');
  ok('一：揀「改了日期」→ 同一份訪問加「改到哪一日？」；揀「改目標日」→ 加「目標日改為哪一日？」', qDate && qDate.kind === 'date' && qOdDate && qOdDate.kind === 'date', P.questions.map(q => q.id));
  const nd = addDays(t, 9), od = addDays(t, 20);
  await answer(iv.id, q => q.id === 'newDate' ? nd : q.id === 'odDate' ? od : undefined);
  let s = st();
  ok('一：改期 → 下一個對外動作句入面嘅日期即改', s.company.nextExternalAction.text === dayText(nd) + '約農場丙主人見面', s.company.nextExternalAction);
  ok('一：改目標日 → 該站目標日即改', s.milestones.find(m => m.id === 'm1').targetDate === od);
  ok('一：舊訪問包改日後作答：下次訪問改跟新星期三', s.interviews.lastFor === iv.rhythm.on && s.interviews.nextOn > iv.rhythm.on && new Date(s.interviews.nextOn + 'T12:00:00').getDay() === 3, s.interviews);
  // 下面嘅流程按每週一次排夾具：還原節奏同下次訪問日，唔影響原有覆蓋
  setSt(s => { s.company.rhythm = { ...s.company.rhythm, interviewWeekday: 1 }; s.interviews.nextOn = addDays(iv.rhythm.on, 7); });
  await advance();
  ok('一：之後同步帳本，改咗嘅目標日照留', st().milestones.find(m => m.id === 'm1').targetDate === od, st().milestones.find(m => m.id === 'm1').targetDate);
  // 公司概覽其後改同一站日期：以公司概覽為準，唔可以被訪問改期靜靜蓋過
  {
    const newDay = addDays(od, 20), pf = path.join(DATA, 'company', 'page.json'), pg = page();
    pg.path.milestones.find(m => m.id === 'm1').target = { id: 'm1-target-test', label: '目標日', value: newDay, origin: 'founder' }; fs.writeFileSync(pf, JSON.stringify(pg, null, 2));
    await advance();
    const after = st();
    ok('一：公司概覽改同一站日期 → 以公司概覽為準，覆蓋清走', after.milestones.find(m => m.id === 'm1').targetDate === newDay && !(after.targetOverride || {}).m1, { day: after.milestones.find(m => m.id === 'm1').targetDate, newDay, override: after.targetOverride });
  }
  // 餘下題目：全部照預設
  await answer(iv.id);

  /* ---------- 第二次訪問：已舉行（寫結果 → AI 擬確認題）、已完成（接站點完成確認） ---------- */
  t = await today();
  await staleFixture(dayText(addDays(t, 2)) + '約農場丙主人見面', 'm1', addDays(t, 2));
  iv = await untilInterview();
  t = await today();
  ok('二：第二次訪問出咗', iv && iv.id !== P.id);
  await answer(iv.id, q => q.id === 'stale' ? U.staleHeld : q.id === 'od' ? U.overdueDone : undefined);
  P = pack(iv.id);
  const qHeld = P.questions.find(q => q.id === 'held');
  ok('二：揀「已舉行」→ 同一份訪問加「結果如何？」（預設稍後提供）', qHeld && qHeld.preset && qHeld.value === U.unknownLater, qHeld);
  const done1 = openPacks().find(p => p.realEvent && p.questions.some(q => (q.options || []).some(o => o.apply && o.apply.op === 'markDone' && o.apply.id === 'm1')));
  ok('二：揀「已完成」→ 放上站點完成確認（外殼出、唔使 AI、未確認唔改）', done1 && st().milestones.find(m => m.id === 'm1').state !== 'done' && done1.title.startsWith(U.interviewConfirm), done1 && done1.title);
  const runsBefore = (st().runs || []).length;
  await answer(iv.id, q => q.id === 'held' ? '農場丙主人答應下月試供兩箱（測試）' : undefined);
  await idle(60000);
  const ev = openPacks().find(p => p.realEvent && p.id !== (done1 && done1.id));
  ok('二：寫咗結果 → 同記錄真實事件一樣交 AI 擬確認題', ev && ev.realEvent && (st().runs || []).slice(runsBefore).some(r => r.aiStarted), ev && ev.title);
  if (done1) await answer(done1.id);
  s = st();
  ok('二：確認完成 → 第一站完成、證明係你嘅訪問回覆、下一站進行中', s.milestones.find(m => m.id === 'm1').state === 'done' && (s.milestones.find(m => m.id === 'm1').doneEvidence || []).some(f => /ask-answer/.test(f) && fs.existsSync(path.join(DATA, f))) && s.milestones.find(m => m.id === 'm2').state === 'active', s.milestones.map(m => m.id + ':' + m.state + ':' + JSON.stringify(m.doneEvidence || [])));
  for (const p of openPacks().filter(p => p.realEvent)) await answer(p.id, q => q.id === 'nad' ? U.unknownLater : undefined);
  await answer(iv.id);

  /* ---------- 第三次訪問：取消了（AI 建議下一站要發生嘅事）、不再做（撤回確認）、經頁面「全部沒有變化」 ---------- */
  t = await today();
  await staleFixture(dayText(addDays(t, 2)) + '約餐廳主廚試食', 'm2', addDays(t, 2));
  iv = await untilInterview();
  t = await today();
  ok('三：第三次訪問出咗', !!iv);
  await answer(iv.id, q => q.id === 'stale' ? U.staleCancelled : q.id === 'od' ? U.overdueDrop : undefined);
  P = pack(iv.id); s = st();
  const qN2 = P.questions.find(q => q.id === 'next2'), m2 = s.milestones.find(m => m.id === 'm2');
  ok('三：揀「取消了」→ 加「下一個對外動作改為甚麼？」，AI 按進行中嘅站建議、小旗標待更新', qN2 && qN2.options[0].rec && qN2.options[0].apply && qN2.options[0].apply.op === 'setNextExternalAction' && qN2.why.includes('按進行中的一站') && s.company.nextExternalAction.pendingUpdate === true, [qN2, s.company.nextExternalAction]);
  const rt = openPacks().find(p => p.rhythm && p.rhythm.kind === 'retire');
  ok('三：揀「不再做」→ 放上撤回確認（即時生效、你確認先改）', rt && rt.rhythm.milestoneId === 'm2' && rt.questions[0].effect === 'now' && m2.pathStatus === 'confirmed', rt);
  await answer(iv.id, q => q.id === 'next2' ? q.value : undefined);
  ok('三：答咗 → 下一個對外動作改為 AI 建議、待更新清走', !st().company.nextExternalAction.pendingUpdate && st().company.nextExternalAction.text === qN2.options[0].text, st().company.nextExternalAction);
  if (rt) await answer(rt.id, () => U.retireYes);
  s = st();
  ok('三：確認撤回 → 該站標已撤、下一站接上', s.milestones.find(m => m.id === 'm2').pathStatus === 'retired' && s.milestones.some(m => m.pathStatus === 'confirmed' && m.state === 'active'), s.milestones.map(m => m.id + ':' + m.pathStatus + ':' + m.state));
  await advance();
  ok('三：之後同步帳本，撤回照留', st().milestones.find(m => m.id === 'm2').pathStatus === 'retired');
  // 經頁面：「全部沒有變化」
  c = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 3000);
  await usePass(BASE, c);
  await c.go(BASE + '/?r=1#/ask/' + iv.id, 1440, 2600);
  const btn = await c.ev(`(document.querySelector('#all-same')||{}).innerText||''`);
  ok('頁面：訪問包有「全部沒有變化」', btn === U.interviewAllSame || btn === U.interviewAllSameRest, btn);
  const badge = await c.ev(`[...document.querySelectorAll('.badge-ai')].map(b=>b.innerText).join('|')`);
  ok('頁面：文字題選項標「預設」，唔係「AI 建議」', badge.includes(U.presetTag), badge);
  await c.click('#all-same'); await sleep(900);
  const modal = await c.ev(`(document.querySelector('.modal')||{}).innerText||''`);
  ok('頁面：回覆盒寫明「你確認沒有變化」、唔會開 AI', modal.includes(U.confirmedSame) && modal.includes(U.submitApply), modal.replace(/\s+/g, ' ').slice(0, 300));
  await c.click('#do-confirm'); await sleep(1500); await idle();
  const ans = answers(iv.id), rest = pack(iv.id).questions.filter(q => q.noChange);
  ok('頁面：一按記低全部「沒有變化」題，每題標你確認', rest.length && rest.every(q => ans[q.id] && ans[q.id].confirmedSame), rest.map(q => q.id + ':' + JSON.stringify(ans[q.id] || null)).slice(0, 4));
  const log = fs.readFileSync(path.join(DATA, 'ledger', 'decisions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.packId === iv.id);
  ok('頁面：決定紀錄逐題記「你確認」', log.filter(e => e.confirmedSame).length === rest.filter(q => ans[q.id] && ans[q.id].confirmedSame).length, log.length);
  await c.go(BASE + '/#/log', 1440, 2200);
  ok('頁面：決定紀錄頁顯示「你確認沒有變化」', (await c.ev(`document.body.innerText`)).includes(U.confirmedSame));
  ok('頁面：冇程式錯誤', !c.errors.length, c.errors);
  ok('全部 AI 都係假 AI（零費用）', (st().runs || []).every(r => !r.aiCost || !r.aiCost.usd));
} catch (e) {
  ok('測試出錯', false, String(e && e.stack || e));
} finally {
  if (c) c.close();
  if (srv) srv.kill();
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} 通過`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  process.exit(pass === results.length ? 0 : 1);
}
