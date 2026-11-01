// MVP 全新空資料夾試走（MVP 規格 2026-10-29 第 4 節 4.2、4.3）：由插件附帶嘅程式安裝 → 排程（假登記程式，唔登記真排程）→ 直接執行排程啟動檔一次
// → 設定 AI → 交資料（虛構「從田間到餐桌」）→ 成頁確認 → 排程啟動檔再執行一次（交資料之後，真做 AI 工作）→ 關頁重開見「上次離開之後」→ 移除排程。
// 全程經真頁面；只記統計、斷言結果同截圖檔名，唔存商業內容。
// 用法：node mvp-walk.mjs <插件 program 資料夾> <輸出資料夾> <chrome> [<假 adapter>]
//   環境變數：WALK_HOST=test（假 AI，要假 adapter）｜claude（真 AI，按次收費）；WALK_PORT（預設 4760）；WALK_LIMIT_USD（真 AI 上限，預設 8）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const [PROG, OUT, CHROME, FAKE] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.WALK_HOST || 'test', REAL = HOST !== 'test', PORT = Number(process.env.WALK_PORT || 4760), LIMIT = Number(process.env.WALK_LIMIT_USD || 8), SLOW = REAL ? 10 : 1;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const steps = []; let cur = '';
const step = s => { cur = s; console.log('== ' + s); };
const ok = (n, p, i) => { steps.push({ step: cur, name: n, pass: !!p, ...(p ? {} : { info: i }) }); console.log((p ? 'PASS ' : 'FAIL ') + n + (p ? '' : '  ' + String(JSON.stringify(i)).slice(0, 400))); };
fs.mkdirSync(OUT, { recursive: true });
const PROJ = path.join(OUT, 'proj'), T = path.join(PROJ, 'crewzero'), SHOTS = path.join(OUT, 'shots');
fs.rmSync(PROJ, { recursive: true, force: true }); fs.mkdirSync(PROJ, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH/i.test(k) && !/^CLAUDE/i.test(k) && !/^CODEX_THREAD_ID$/i.test(k) && !/^SOS_/.test(k)));
const SCHED = { SOS_SCHED_CMD: path.join(HERE, '..', 'lib', 'fake-schtasks.mjs'), SOS_SCHED_LOG: path.join(OUT, 'sched-calls.jsonl') };
const envSrv = { ...clean, ...SCHED, SOS_PORT: String(PORT), SOS_NO_OPEN: '1', ...(REAL ? {} : { SOS_ADAPTER: FAKE }) };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tree = root => { const o = {}; (function w(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name, p = path.join(d, e.name); if (e.isDirectory()) w(p, r); else o[r] = sha(p); } })(root, ''); return o; };
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const spent = () => ((readJ(path.join(T, 'data', 'ledger', 'status.json')) || { runs: [] }).runs || []).reduce((n, r) => n + ((r.aiCost && r.aiCost.usd) || 0), 0) + ((readJ(path.join(T, 'data', 'ledger', 'certify.json')) || {}).usd || 0);
let pid = 0, c = null, B = '';
const N = createRequire(import.meta.url)(path.join(PROG, 'names.js'));
const { openChrome } = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'cdp-lib.mjs')).href);
async function openDesk() {
  const r = spawnSync(process.execPath, [path.join(T, 'ask.mjs'), '--desk'], { encoding: 'utf8', env: envSrv, timeout: 60000, cwd: PROJ });
  B = ((r.stdout || '').match(/http:\/\/127\.0\.0\.1:\d+\//) || [])[0] || '';
  if (B) { const st = await (await fetch(B + 'api/health')).json(); pid = Number(st.pid) || 0; }
  return r;
}
async function waitFor(fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(600); } return null; }
const text = sel => c.ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
const has = sel => c.ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const shot = name => c.shot(path.join(SHOTS, name), null, { full: true });
const launch = () => spawnSync('cmd.exe', ['/d', '/c', path.join(T, 'run-schedule.cmd')], { encoding: 'utf8', env: REAL ? clean : { ...clean, SOS_ADAPTER: FAKE }, timeout: 40 * 60000 });
const lastRun = () => (((readJ(path.join(T, 'data', 'ledger', 'state.json')) || {}).runs) || []).slice(-1)[0] || {};
try {
  step('1 安裝（插件附帶嘅程式）');
  const r1 = spawnSync(process.execPath, [path.join(PROG, 'install.mjs'), PROJ], { encoding: 'utf8', env: clean });
  ok('安裝成功', r1.status === 0, r1.stdout + r1.stderr);
  ok('crewzero/ 結構、VERSION、START-HERE.md、run-schedule.cmd 齊；data/ 為空', ['ask.mjs', 'server.mjs', 'run.mjs', 'adapters', 'FIRST-WEEK.md', 'VERSION', 'START-HERE.md', 'run-schedule.cmd'].every(f => fs.existsSync(path.join(T, f))) && fs.readdirSync(path.join(T, 'data')).length === 0);
  const snap = tree(T), r2 = spawnSync(process.execPath, [path.join(PROG, 'install.mjs'), PROJ], { encoding: 'utf8', env: clean });
  ok('再裝一次被拒，雜湊不變', r2.status === 2 && JSON.stringify(tree(T)) === JSON.stringify(snap), r2.stdout);

  step('1b 排程（假登記程式；唔登記真排程）');
  const S = path.join(T, 'adapters', 'scheduler', 'install-schedule.mjs');
  const pr = spawnSync(process.execPath, [S], { encoding: 'utf8', env: { ...clean, ...SCHED } });
  ok('印出排程定義全文（未登記）', pr.status === 0 && /未登記/.test(pr.stdout) && /Register-ScheduledTask/.test(pr.stdout), pr.stdout.slice(0, 200));
  const rg = spawnSync(process.execPath, [S, '--register'], { encoding: 'utf8', env: { ...clean, ...SCHED } });
  const mark = readJ(path.join(T, 'data', 'ledger', 'schedule.json'));
  ok('登記（假）：標記寫入、讀回補跑開啟', rg.status === 0 && mark && mark.startWhenAvailable === true && mark.runTime === '21:00', rg.stdout);
  const l0 = launch(), run0 = lastRun();
  ok('直接執行排程啟動檔一次（交資料前）：有排程紀錄，照規則跳過「未交資料」', l0.status === 0 && run0.trigger === 'schedule' && run0.state === 'skipped' && run0.skipReason === 'intakeNotComplete', { status: l0.status, run0 });

  step('2 打開 Founder Desk');
  const od = await openDesk();
  ok('ask.mjs --desk 開到頁', !!B, od.stdout + od.stderr);
  c = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 50);
  await c.go(B, 1280, 3000);
  ok('阻塞卡「AI 未設定」附「前往設定」', (await has('#ai-block')) && (await has('#go-setup')), await text('#ai-block'));
  await shot('01-desk-ai-unset.png');
  await c.go(B + 'dashboard/system', 1280, 3000);
  const sys1 = await text('#sys-sched'), last1 = await text('#sys-last');
  ok('系統頁：排程已登記 · 每日 21:00；上次實際觸發有時間（剛才直接執行）', /已登記/.test(sys1) && /21:00/.test(sys1) && /已跳過|跳過|未問齊/.test(last1), { sys1, last1 });
  await shot('02-system-registered.png');

  step('3 設定 AI');
  await c.go(B, 1280, 2500);
  await c.click('#go-setup'); await waitFor(() => has('#certify-go'), 10000);
  await c.click(`[data-host="${HOST}"]`); await c.click('#certify-go');
  const cert = await waitFor(async () => (await has('#setup-done')) || /未通過/.test(await text('#certify h3')), 5 * 60000);
  ok('認證全過', cert && (await has('#setup-done')), await text('#certify'));
  await shot('03-setup-passed.png');
  await c.click('#setup-done'); await sleep(2500);
  ok('阻塞卡消失；今日要做的事轉「交資料」', !(await has('#ai-block')), await text('#today-card'));

  step('4 交資料（虛構「從田間到餐桌」）');
  await c.go(B + '#/intake', 1280, 2500);
  const vals = ['「從田間到餐桌」把本地小農的當季蔬菜直送餐廳；客戶是注重食材來源的中小型餐廳。', '向農場按批採購，向餐廳按週收費，餐廳每週下一次或兩次單。', '已認識兩位農場主（甲、乙），口頭有興趣，未簽。餐廳未接觸。牌照保險未查。', '約第三位農場主（丙）見面。', '送貨我自己做；農場我自己談；餐廳我自己介紹；合規與保險未有人。'];
  for (let i = 0; i < 5; i++) { await c.ev(`document.querySelector('#q${i + 1}').focus()`); await c.send('Input.insertText', { text: vals[i] }); await sleep(80); }
  await shot('04-intake-filled.png');
  await c.click('#intake-go'); await c.click('#intake-confirm');
  const moved = await waitFor(async () => (await c.ev('location.pathname')) === '/proofread.html', 4 * 60000 * (REAL ? 2 : 1));
  ok('五態到「完成」，自動轉校對；data/company/page.json 出現', !!moved && fs.existsSync(path.join(T, 'data', 'company', 'page.json')), await c.ev('location.href'));
  await sleep(2000); await shot('05-proofread.png');

  step('5 成頁確認');
  await c.click('#go-main'); await c.click('#do-confirm');
  const fin = await waitFor(async () => /✓ 完成|未完成/.test(await text('#track')), 6 * 60000 * (REAL ? 2 : 1));
  const st5 = readJ(path.join(T, 'data', 'ledger', 'state.json')) || {};
  // 假 AI 擬嘅公司概覽範本冇假設清單（測試夾具限制），假設清單只喺真 AI 試走要求
  const nMs = (st5.milestones || []).length, nAs = ((st5.company || {}).assumptions || []).length;
  ok('成頁確認：AI 跟進完成；帳本有里程碑' + (REAL ? '同假設清單' : '（假 AI 範本冇假設清單）'), fin && /✓ 完成/.test(await text('#track')) && nMs > 0 && (!REAL || nAs > 0), { track: (await text('#track')).slice(0, 80), milestones: nMs, assumptions: nAs });
  await shot('06-confirmed.png');
  await c.go(B, 1280, 3000);
  ok('待決事項主卡出現問題包；今日要做的事已更新', (await has('.hero')) && !!(await text('#today-card')), { hero: await text('.hero'), today: await text('#today-card') });
  await shot('07-desk-after-confirm.png');
  if (REAL && spent() > LIMIT) throw new Error('費用已達上限 US$' + LIMIT);

  step('6 排程啟動檔再執行一次（交資料之後：真做 AI 工作）');
  try { process.kill(pid); } catch { } pid = 0; await sleep(800);
  const l1 = launch(), run1 = lastRun();
  const rc = run1.id ? readJ(path.join(T, 'data', 'work', run1.id, 'receipt.json')) : null;
  ok('帳本 runs[] 有 trigger: schedule、已結束（做咗 AI 工作，唔係跳過）；收據存在', l1.status === 0 && run1.trigger === 'schedule' && run1.state === 'ended' && run1.aiStarted === true && !!rc, { status: l1.status, run1, rc: !!rc });
  if (REAL) ok('排程啟動檔（冇任何環境變數）下開到 AI 工具、登入有效，費用記入紀錄', run1.aiStarted && run1.aiCost && run1.aiCost.usd > 0, run1.aiCost);

  step('7 關頁重開');
  const od2 = await openDesk();
  await c.go(B, 1280, 3500);
  const since = await text('#since');
  ok('「上次離開之後」：AI 完成了 1 次工作', /AI 完成了 1 次工作/.test(since), since);
  await shot('08-desk-since.png');
  await c.go(B + 'dashboard/system', 1280, 3000);
  const last2 = await text('#sys-last');
  ok('系統頁「上次實際觸發」有時間', !!last2 && !/^未有$/.test(last2.trim()), last2);
  await shot('09-system-after-run.png');

  step('8 移除排程');
  const rm = spawnSync(process.execPath, [S, '--remove'], { encoding: 'utf8', env: { ...clean, ...SCHED } });
  ok('移除：標記消失', rm.status === 0 && !fs.existsSync(path.join(T, 'data', 'ledger', 'schedule.json')), rm.stdout);
} catch (e) {
  ok('試走中止', false, String(e && e.stack || e));
} finally {
  try { c && c.close(); } catch { } if (pid) { try { process.kill(pid); } catch { } }
  const runs = ((readJ(path.join(T, 'data', 'ledger', 'status.json')) || { runs: [] }).runs || []);
  const sum = { host: HOST, pass: steps.filter(s => s.pass).length, total: steps.length, aiRuns: runs.filter(r => r.aiCost).length, usd: Math.round(spent() * 1000) / 1000, shots: fs.existsSync(SHOTS) ? fs.readdirSync(SHOTS) : [], steps };
  fs.writeFileSync(path.join(OUT, 'walk-result.json'), JSON.stringify(sum, null, 1));
  console.log(`\n${sum.pass}/${sum.total} passed；AI 工作 ${sum.aiRuns} 次；費用 US$${sum.usd}`);
  process.exit(sum.pass === sum.total ? 0 : 1);
}
