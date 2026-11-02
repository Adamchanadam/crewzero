// 階段 A「節奏與推進」測試：模擬時鐘推前 14 日（唔開瀏覽器；隔離資料夾、假 AI、零費用；只用程式副本）
// 用法：node rhythm-test.mjs <程式副本> <輸出資料夾> <埠> <假 adapter> [<模擬起始時間（本機時間）>]
// 模擬時鐘由固定起始時間開始（預設 2026-10-29 星期四 12:00），唔受真實時間影響；之前用真實「今日」，21:00 之後跑會遲一日開始、訪問日對到另一日
// 測試夾具（原型冇呢啲入口，照實記錄）：試行站（冇採用路徑嘅入口）、第四次訪問（每月覆核）、今日 AI 啟動上限
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER, START_ARG] = process.argv.slice(2);
const START = START_ARG || '2026-10-29T12:00:00';
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), U = N.ui;
const lib = await import(new URL('file:///' + path.join(PROTO, 'ask-lib.mjs').replace(/\\/g, '/')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => { results.push({ name: n, pass: !!p, info: i }); console.log((p ? 'PASS ' : 'FAIL ') + n + (p ? '' : '  ' + JSON.stringify(i ?? '').slice(0, 300))); };
fs.rmSync(OUT, { recursive: true, force: true });
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT;
fs.mkdirSync(DATA, { recursive: true });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const st = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8')); } catch { return { runs: [] }; } };
const setSt = f => { const s = st(); f(s); s.revision = (s.revision || 0) + 1; fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify(s, null, 2)); };
const page = () => JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
const conf = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'confirmed.json'), 'utf8')); } catch { return null; } };
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const packs = () => fs.readdirSync(path.join(DATA, 'asks')).map(f => JSON.parse(fs.readFileSync(path.join(DATA, 'asks', f), 'utf8')));
const answers = id => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'answers', id + '.json'), 'utf8')).answers; } catch { return {}; } };
const openPacks = () => packs().filter(p => p.questions.some(q => !answers(p.id)[q.id]));
const today = async () => (await get('/api/status')).today;
async function idle(ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const s = await get('/api/status'); if (!s.busy && !s.pending.length) { await sleep(400); const s2 = await get('/api/status'); if (!s2.busy && !s2.pending.length) return true; } await sleep(300); } return false; }
function proofread() {
  const p = page(), order = p.path.milestones.map(m => m.id);
  const machine = { format: 'startup-os.proofread-reply/0.1', page: p.page.id, company: p.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: {}, kindsChanged: [] };
  const head = ['kind: proofread', 'ref: ' + p.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(p)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return post('/api/submit', { kind: 'proofread', ref: p.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
}
// 答一份問題包：pick(q) 回答案（undefined＝唔答呢題）
async function answer(P, pick) {
  P = JSON.parse(fs.readFileSync(path.join(DATA, 'asks', P.id + '.json'), 'utf8'));
  const done = answers(P.id);
  const list = P.questions.filter(q => !done[q.id]).map(q => { let v = pick ? pick(q) : q.value; if (v === undefined && q.bind === 'results') v = '沒有'; return v === undefined ? null : { id: q.id, value: v, ai: q.value, changed: JSON.stringify(v) !== JSON.stringify(q.value) }; }).filter(Boolean);
  const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
  const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
  const r = await post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  await idle();
  return r;
}
const schedRuns = () => (st().runs || []).filter(r => r.trigger === 'schedule');
// 推前一日：等計時器觸發嗰日嘅排程 run 做完
async function advance() {
  const before = schedRuns().length;
  const r = await post('/api/sim', { action: 'advance' });
  const t = Date.now();
  while (Date.now() - t < 60000) { const sr = schedRuns(); if (sr.length > before && sr[sr.length - 1].state !== 'running' && await idle(20000)) return { day: await today(), run: sr[sr.length - 1], code: r.code }; await sleep(500); }
  return { day: await today(), run: null, code: r.code };
}
const packOf = kind => openPacks().find(p => p.rhythm && p.rhythm.kind === kind);
const shownTexts = P => [P.title, P.context, ...P.questions.flatMap(q => [q.ask, q.why, ...(q.options || []).map(o => o.text), typeof q.value === 'string' ? q.value : ''])];
const dayLog = [];

let srv = null;
try {
  /* ---------- 零：模擬實例保護 ---------- */
  // 喺臨時程式複本試（唔包 data/），唔會指向原型真資料
  const GUARD = path.join(OUT, 'guard-copy');
  fs.mkdirSync(GUARD, { recursive: true });
  for (const e of fs.readdirSync(PROTO, { withFileTypes: true })) if (e.isFile()) fs.copyFileSync(path.join(PROTO, e.name), path.join(GUARD, e.name));
  fs.cpSync(path.join(PROTO, 'adapters'), path.join(GUARD, 'adapters'), { recursive: true });
  let r0 = spawnSync(process.execPath, [path.join(GUARD, 'server.mjs'), '--port', String(Number(PORT) + 5)], { cwd: GUARD, env: { ...process.env, SOS_SIM: '1', SOS_DATA: '' }, timeout: 8000 });
  ok('零：模擬模式冇獨立資料夾即拒絕啟動', r0.status === 1 && !fs.existsSync(path.join(GUARD, 'data')), r0.status);
  r0 = spawnSync(process.execPath, [path.join(GUARD, 'server.mjs'), '--port', String(Number(PORT) + 5)], { cwd: GUARD, env: { ...process.env, SOS_SIM: '1', SOS_DATA: path.join(GUARD, 'data') }, timeout: 8000 });
  ok('零：模擬模式指向程式本身嘅資料夾即拒絕啟動', r0.status === 1 && !fs.existsSync(path.join(GUARD, 'data')), r0.status);

  fs.mkdirSync(path.join(DATA, 'founder', 'desk'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'founder', 'desk', 'sim-clock.json'), JSON.stringify({ offsetMs: Date.parse(START) - Date.now(), at: new Date().toISOString() }));
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_SIM: '1', SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore' });
  // 機器忙時伺服器可能遲啲先起好：最多等 60 秒，起唔到就清楚報錯
  let up = false;
  await usePass(BASE);
  for (let i = 0; i < 200 && !up; i++) { try { up = !!(await get('/api/status')).ok; } catch { } if (!up) await sleep(300); }
  if (!up) throw new Error('伺服器 60 秒內未起好');
  const s0 = await get('/api/status');
  ok('零：狀態帶模擬時鐘同今日', s0.sim && s0.sim.on && /^\d{4}-\d{2}-\d{2}$/.test(s0.today), s0.sim);
  ok('零：模擬時鐘由固定起始日開始（' + START + '）', s0.today === START.slice(0, 10), [s0.today, START]);
  await post('/api/setup', { action: 'certify', host: 'test' });
  for (let i = 0; i < 80; i++) { const s = await get('/api/setup'); if (s.certify && s.certify.state !== 'running') break; await sleep(400); }
  ok('零：假 AI 認證', !!(await get('/api/status')).cert);

  /* ---------- 一：未有公司概覽 → 排程 run 跳過（未問齊） ---------- */
  let a = await advance();
  ok('一：未交資料時排程 run 照記、跳過原因「未問齊」', a.run && a.run.state === 'skipped' && a.run.skipReason === 'intakeNotComplete' && a.run.aiStarted === false, a.run);
  dayLog.push([a.day, a.run && (a.run.state + ':' + (a.run.skipReason || a.run.ending))]);

  /* ---------- 二：交資料、成頁確認（同日、你送出後） ---------- */
  await post('/api/intake', { bizType: 'other', fields: { q1: '把本地小農的當季蔬菜直送餐廳（測試）', q2: '餐廳每週付款', q3: '兩個農場有興趣（口頭表示）', q4: '約第三個農場主見面', q5: '表哥送貨（已確定）' }, files: [] });
  await idle(60000);
  await proofread(); await idle(60000);
  let s = st();
  ok('二：成頁確認後寫入經營節奏（預設每日 21:00、訪問星期一）同第一次訪問日', s.company.rhythm && s.company.rhythm.runTime === '21:00' && s.company.rhythm.interviewWeekday === 1 && /^\d{4}-\d{2}-\d{2}$/.test(s.interviews.nextOn), [s.company.rhythm, s.interviews]);
  ok('二：最前未完成嘅站自動進行中', (s.milestones.find(m => m.id === 'm1') || {}).state === 'active', s.milestones.map(m => m.id + ':' + m.state));
  ok('二：你送出後嘅 run 都記入帳本（處理收件／你送出後）', (s.runs || []).some(r => r.type === 'inbox' && r.trigger === 'server'), (s.runs || []).map(r => r.type + '/' + r.trigger));
  const nextOn0 = s.interviews.nextOn;
  const dash0 = await get('/api/dashboard');
  ok('二：系統頁資料：排程由模擬計時器負責、有下次開工時間', dash0.rhythmInfo && dash0.rhythmInfo.scheduler === 'sim' && /T21:00/.test(dash0.rhythmInfo.nextRunAt), dash0.rhythmInfo);

  /* ---------- 三：推前 14 日 ---------- */
  let leftOnce = 0, stopDayInterview = false, ivAnswered = 0, eventDone = false, trialInjected = false, trialRuns = 0, secondAsked = false, pausedTested = false, monthlySeen = false, budgetTested = false, certTested = false;
  for (let d = 1; d <= 14; d++) {
    // 夾具：第 6 日放一個已到期嘅試行站（原型冇採用路徑入口）
    if (d === 6 && !trialInjected) { const t = await today(); setSt(x => { x.milestones.push({ id: 'mt1', title: '試行：週末市集', short: '試行：週末市集', lineId: 'main', order: null, pathStatus: 'trial', state: 'active', kind: 'real', event: '週末市集擺檔兩次', depth: 'ok', trial: { adoptedAt: t, startedAt: lib.localIso(new Date(Date.parse(t) - 30 * 86400000)).slice(0, 10), until: lib.localIso(new Date(Date.parse(t) - 86400000)).slice(0, 10), successSignal: { text: '兩次擺檔都賣出三十箱', value: 1, target: 2, met: false }, stopSignal: { text: '任何一次賣不到十箱', met: false } } }); }); trialInjected = true; }
    // 第 13 日：今日 AI 啟動上限（夾具改上限做 0），睇排程 run 跳過
    if (d === 13) setSt(x => { x.company.rhythm.aiStartsPerDay = 0; });
    if (d === 14) setSt(x => { x.company.rhythm.aiStartsPerDay = 40; });
    // 第 11 日：換成未認證嘅 AI（模擬面板），睇排程 run 跳過「AI 未設定」；之後換返
    if (d === 11) { const sw = await post('/api/sim', { action: 'ai', mode: 'real' }); certTested = sw.code === 200 && sw.j && sw.j.ready === false; }
    // 第 4 日：AI 建議開第二站
    if (d === 4) mode('rhythm:rhythm-second');
    a = await advance();
    if (d === 11) { const sw = await post('/api/sim', { action: 'ai', mode: 'fake' }); certTested = certTested && sw.j && sw.j.ready === true && a.run && a.run.skipReason === 'adapterNotCertified'; }
    s = st();
    dayLog.push([a.day, a.run && (a.run.type + ':' + a.run.state + ':' + (a.run.skipReason || a.run.ending)), 'streak ' + (s.health || {}).noProgressStreak + (s.health.autoStopped ? ' 自動停' : '') + (s.health.pausedByFounder ? ' 暫停' : '')]);
    if (leftOnce && d === leftOnce + 1) ok('三：自動停之後嗰日冇任何輸入' + (stopDayInterview ? '（訪問包已到期、冇答）' : '') + ' → 下一次排程 run 跳過「已自動停」（規劃書 3.8）', a.run && a.run.state === 'skipped' && a.run.skipReason === 'autoStopped', a.run);
    if (trialInjected && s.milestones.some(m => m.id === 'mt1' && m.pathStatus === 'trial')) trialRuns++;
    if (d === 13) budgetTested = a.run && a.run.state === 'skipped' && a.run.skipReason === 'budgetExhausted';

    // 你：按待決事項逐項處理（模擬創辦人）
    const stop = packOf('autoStop');
    if (stop) {
      ok('三：自動停嘅問題：AI 建議「繼續」、即時生效、理由講清楚', stop.questions[0].options[0].rec && stop.questions[0].effect === 'now' && stop.questions[0].why === U.autoStopRec && stop.context === U.autoStopWhy, stop.questions[0]);
      // 第一次答「暫停」試持續暫停；之後答「繼續」
      if (!pausedTested && stop.rhythm.kind === 'autoStop') { await answer(stop, () => U.autoStopPause); pausedTested = 'paused'; }
      // 暫停測試做完之後嘅第一次自動停：留一日唔答，睇下一次排程 run 跳過「已暫停」
      else if (pausedTested === 'done' && !leftOnce) leftOnce = d;
      else await answer(stop, () => U.autoStopGo);
    }
    // 留一日唔答：嗰日乜都唔答（任何回覆、包括訪問答案都係合資格輸入，會解除自動停，規劃書 3.8），睇下一次排程 run 係咪跳過
    if (leftOnce === d) { stopDayInterview = !!packOf('interview'); continue; }
    // 暫停期間：交一件臨時工作 → AI 工作等你按繼續（唔郁站點）
    if (pausedTested === 'paused') {
      const pz = packOf('paused');
      ok('三：揀「暫停」→ 持續暫停，另出「要繼續嗎？」', st().health.pausedByFounder === true && pz, st().health);
      await post('/api/intake', { kind: 'note', type: 'adhoc', text: '測試：幫我擬一張推廣單張。' });
      await idle();
      const w = (await get('/api/status')).runs.find(r => r.kind === 'note');
      ok('三：暫停期間你交嘅工作照登記，AI 工作等你按繼續', w && w.state === 'waiting' && w.waitingFor === 'paused', w && [w.state, w.waitingFor]);
      pausedTested = 'resume';
    } else if (pausedTested === 'resume' && d >= 3) {
      const pz = packOf('paused');
      if (pz) {
        await answer(pz, () => U.autoStopGo);
        await idle(60000);
        const w = (await get('/api/status')).runs.filter(r => r.kind === 'note');
        ok('三：按繼續 → 解除暫停、等住嘅 AI 工作自動續做', st().health.pausedByFounder === false && w.some(r => r.state === 'done' || r.state === 'resumed'), w.map(r => r.state));
        pausedTested = 'done';
      }
    }
    const iv = packOf('interview');
    // 持續暫停期間唔答訪問（文字答案要開 AI，會等你按繼續）；按繼續之後先答。測試開始時間唔同，暫停同訪問可能撞同一日
    if (iv && ivAnswered === 0 && !st().health.pausedByFounder) {
      const t = shownTexts(iv).join('｜');
      const ivResults = iv.questions.find(q => q.bind === 'results'), ivNext = iv.questions.find(q => q.bind === 'next');
      ok('三：訪問包首題是每週成果，沒有 AI 預設', iv.questions[0].bind === 'results' && ivResults && !Object.hasOwn(ivResults, 'value'), iv.questions.map(q => q.id + '=' + q.value));
      ok('三：訪問包：下一個對外動作預填「仍然是」、文字題預設「沒有」、最多 12 條', iv.questions.length <= 12 && ivNext && ivNext.value === U.interviewSame && iv.questions.filter(q => q.bind === 'none').every(q => q.value === U.interviewNone), iv.questions.map(q => q.id + '=' + q.value));
      ok('三：訪問包文字冇內部術語', N.styleIssues ? !shownTexts(iv).some(x => N.styleIssues(String(x || '')).length) : true, shownTexts(iv).flatMap(x => N.styleIssues(String(x || ''))));
      const due = (await today()) >= lib.localIso(new Date(Date.parse(nextOn0) - 2 * 86400000)).slice(0, 10);
      ok('三：訪問日前兩天內出題', due, [await today(), nextOn0]);
      await answer(iv, q => q.id === 'f1' ? '第一個農場已經簽了供應協議（測試）' : q.value);
      ivAnswered = 1;
      s = st();
      ok('三：答訪問後下次訪問日更新（一星期後）', s.interviews.nextOn === lib.localIso(new Date(Date.parse(nextOn0) + 7 * 86400000)).slice(0, 10) && s.interviews.lastOn === (await today()), s.interviews);
      // 文字答案走真實事件確認：AI 建議站點完成、證據級改變
      const cf = openPacks().find(p => p.realEvent);
      ok('三：訪問文字答案 → AI 建議（確認訪問答案），未確認唔改', cf && cf.title.startsWith(U.interviewConfirm) && st().milestones.find(m => m.id === 'm1').state !== 'done', cf && cf.title);
      if (cf) {
        await answer(cf, q => q.value);
        s = st();
        const m1 = s.milestones.find(m => m.id === 'm1'), m2 = s.milestones.find(m => m.id === 'm2');
        ok('三：確認後站點完成、下一站自動進行中', m1.state === 'done' && m2.state === 'active', s.milestones.map(m => m.id + ':' + m.state));
        const cf2 = JSON.parse(fs.readFileSync(path.join(DATA, 'asks', cf.id + '.json'), 'utf8')), nad = cf2.questions.find(q => q.id === 'nad');
        ok('三：小旗題加入同一份確認：AI 預填下一站要發生的事、小旗標「待更新」', nad && nad.options[0].rec && nad.options[0].apply.milestoneId === 'm2' && s.company.nextExternalAction.pendingUpdate === true && s.company.nextExternalAction.milestoneId === 'm1', [nad, s.company.nextExternalAction]);
        const dsh = await get('/api/dashboard');
        ok('三：監察台：已完成嘅站唔再顯示待深化、小旗資料帶「待更新」', dsh.nextAction.pendingUpdate === true && dsh.milestones.find(m => m.id === 'm1').state === 'done', dsh.nextAction);
        await answer(cf2, q => q.value);
        s = st();
        ok('三：答咗小旗題，小旗移去下一站', s.company.nextExternalAction.milestoneId === 'm2' && !s.company.nextExternalAction.pendingUpdate, s.company.nextExternalAction);
        eventDone = 'interview';
      }
    } else if (iv && ivAnswered === 1) {
      // 第二次訪問：夾具令佢係第四次（每月覆核）；文字題全部「沒有」→ 唔開 AI
      setSt(x => { x.interviews.count = 3; });
      const before = (st().runs || []).length;
      await answer(iv, q => q.value);
      ivAnswered = 2;
      s = st();
      const last = (s.runs || []).slice(before).pop();
      ok('三：第二次訪問：全部照建議 → 只記錄、唔開 AI、下次訪問日再更新', last && last.aiStarted === false && s.interviews.count === 4 && s.interviews.lastFor === iv.rhythm.on, [last, s.interviews]);
      const mr = packOf('monthly');
      ok('三：每第四次訪問另出每月覆核（權限照舊／收窄、本季目標）', mr && mr.questions.length === 2 && mr.questions.every(q => q.effect === 'now'), mr && mr.questions.map(q => q.ask));
      if (mr) { await answer(mr, q => q.id === 'goal' ? '季末：四間餐廳每週下單（測試）' : q.value); monthlySeen = st().goals && st().goals.quarter && /四間餐廳/.test(st().goals.quarter.text); }
    }
    const sec = packOf('second');
    if (sec && !secondAsked) {
      ok('三：AI 建議開第二站 → 外殼核對後問你，理由用 AI 交嘅理由', sec.questions[0].why.includes('兩站互不依賴') && sec.questions[0].options[0].rec && sec.questions[0].effect === 'now', sec.questions[0]);
      await answer(sec, () => U.secondYes);
      s = st();
      const act = s.milestones.filter(m => m.pathStatus === 'confirmed' && m.state === 'active');
      ok('三：確認後兩站並行、記低你確認嘅時間', act.length === 2 && act.some(m => m.parallelConfirmedAt), act.map(m => m.id));
      secondAsked = true;
    }
    if (d === 5) {
      await post('/api/intake', { kind: 'note', type: 'event', text: '測試：第二站的對方已書面答覆同意試用。', date: await today(), files: [] });
      await idle(60000);
      const cf = openPacks().find(p => p.realEvent && p.title.startsWith(U.eventConfirm));
      const before = st().company.nextExternalAction;
      ok('三：記錄真實事件 → AI 建議，經你確認先生效', cf && cf.questions.some(q => (q.options || []).some(o => o.apply && o.apply.op === 'markDone')), cf && cf.questions.map(q => q.ask));
      if (cf) {
        const target = cf.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'markDone')).options[0].apply.id;
        await answer(cf, q => q.value);
        s = st();
        const cf2 = JSON.parse(fs.readFileSync(path.join(DATA, 'asks', cf.id + '.json'), 'utf8')), nad = cf2.questions.find(q => q.id === 'nad');
        ok('三：真實事件確認後站點完成、小旗題出現', s.milestones.find(m => m.id === target).state === 'done' && (before.milestoneId !== target || (nad && s.company.nextExternalAction.pendingUpdate)), [target, before, nad && nad.ask]);
        if (nad) { await answer(cf2, q => q.value); s = st(); ok('三：答咗小旗題，小旗移站', s.company.nextExternalAction.milestoneId !== target && !s.company.nextExternalAction.pendingUpdate, s.company.nextExternalAction); }
        eventDone = 'both';
      }
    }
    const tr = packOf('trial');
    if (tr) {
      ok('三：試行到期 → 站轉「等你決定」、AI 建議延長一次（未有定論）', st().milestones.find(m => m.id === 'mt1').state === 'waiting' && tr.questions[0].options.find(o => o.rec).text === U.trialExtend && tr.todoType === 'trial', tr.questions[0]);
      const dsh = await get('/api/dashboard');
      ok('三：監察台待你處理：試行到期排最前', dsh.todo.length && dsh.todo[0].type === 'trial', dsh.todo.map(t => t.type));
      await answer(tr, () => U.trialExtend);
      const mt = st().milestones.find(m => m.id === 'mt1');
      ok('三：延長一次：到期日加四星期、只可延長一次', mt.trial.extendedOnce && mt.state === 'active' && mt.trial.until > (await today()), mt.trial);
    }
  }

  /* ---------- 四：14 日總結 ---------- */
  s = st();
  const sr = s.runs.filter(r => r.trigger === 'schedule'), slots = sr.map(r => r.slot);
  ok('四：每日一次排程 run（15 日共 15 次，冇重複）', sr.length === 15 && new Set(slots).size === 15, slots);
  ok('四：冇人手觸發；排程同你送出後兩種都有', !s.runs.some(r => r.trigger === 'manual') && s.runs.some(r => r.trigger === 'server') && sr.length > 0, [...new Set(s.runs.map(r => r.trigger))]);
  ok('四：兩次冇輸入即自動停（有跳過「已暫停」嘅排程 run）', sr.some(r => r.skipReason === 'autoStopped'), sr.map(r => r.skipReason || r.ending));
  ok('四：持續暫停期間排程 run 跳過「已按你的指示暫停」', sr.some(r => r.skipReason === 'pausedByFounder') || pausedTested === 'done', sr.map(r => r.skipReason || ''));
  ok('四：同一份產出唔算新產出（有「卡住」收尾）', sr.some(r => r.ending === 'blocked') && sr.some(r => r.ending === 'artifact'), sr.map(r => r.ending || ''));
  ok('四：試行站同步後仍然保留（至少兩次排程 run）', trialRuns >= 2 && s.milestones.some(m => m.id === 'mt1' && m.trial), trialRuns);
  ok('四：今日 AI 啟動已達上限 → 排程 run 跳過', budgetTested);
  ok('四：換成未認證嘅 AI → 排程 run 跳過「AI 未設定」；換返假 AI 即恢復', certTested);
  ok('四：每月覆核答咗即改本季目標', monthlySeen);
  ok('四：訪問兩次都答咗', ivAnswered === 2);
  ok('四：訪問答案同記錄真實事件兩條路都令站點移動', eventDone === 'both', eventDone);
  ok('四：每次 AI 都係假 AI（零費用）', s.runs.every(r => !r.aiCost || !r.aiCost.usd), s.runs.filter(r => r.aiCost && r.aiCost.usd).map(r => r.id));
  const dsh = await get('/api/dashboard');
  ok('四：監察台最近 AI 工作冇重複（同一次 run 只出一次）', new Set(dsh.runs.map(r => r.id)).size === dsh.runs.length, dsh.runs.map(r => r.id));
  ok('四：系統頁上次實際觸發＝最後一次排程 run', dsh.rhythmInfo.lastScheduleAt === sr[sr.length - 1].startedAt, [dsh.rhythmInfo.lastScheduleAt, sr[sr.length - 1].startedAt]);
  ok('四：帳本冇示範標記', s.demo !== true);
  if (START_ARG) ok('四：重現 2026-10-29 晚嘅排位：自動停嗰日訪問包已到期', stopDayInterview, dayLog.map(x => x.join(' ')));
  fs.writeFileSync(path.join(OUT, 'days.json'), JSON.stringify(dayLog, null, 1));
  console.log(dayLog.map(x => x.join('  ')).join('\n'));
} catch (e) {
  ok('測試出錯', false, String(e && e.stack || e));
} finally {
  if (srv) srv.kill();
  const pass = results.filter(r => r.pass).length;
  console.log(`\n${pass}/${results.length} 通過`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  process.exit(pass === results.length ? 0 : 1);
}
