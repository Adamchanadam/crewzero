// CrewZero 原型回歸測試：一條命令跑全套（隔離資料夾、假 AI、零費用；唔掂原型嘅 data/）。
// 用法：node tests/prototype/run-all.mjs [--proto <原型資料夾>] [--out <輸出資料夾>] [--chrome <Chrome 路徑>] [--port <起始埠>] [--only <名稱或檔名，逗號分隔>] [--no-browser] [--ports（只列出各組埠段後結束）]
// 亦可用環境變數：SOS_TEST_PROTO、SOS_TEST_OUT、SOS_TEST_CHROME、SOS_TEST_PORT。詳情見同一資料夾嘅 README.md。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAdapters } from './lib/adapters.mjs';
import { claimOutput, collectFailureEvidence, dirSize, FAILURE_GROUP_MAX_BYTES, FAILURE_RUN_MAX_BYTES, pruneOutputs, safeRemove, sweepInterrupted, updateOutputMarker } from './lib/test-output.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, env) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : process.env[env] || ''; };
const pad = n => String(n).padStart(2, '0');
const now = new Date(), stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const PROTO = path.resolve(opt('proto', 'SOS_TEST_PROTO') || path.join(HERE, '..', '..', 'prototypes', 'proofread'));
const OUT = path.resolve(opt('out', 'SOS_TEST_OUT') || path.join(os.tmpdir(), 'crewzero-tests', stamp));
const PORT = Number(opt('port', 'SOS_TEST_PORT') || 4700);
const ONLY = (opt('only', 'SOS_TEST_ONLY') || '').split(',').map(s => s.trim()).filter(Boolean);
const NO_BROWSER = argv.includes('--no-browser');
const KEEP_RUNS = argv.includes('--keep-runs');
// 唔准喺原型自己嘅 data/ 或者專案入面跑
if (!fs.existsSync(path.join(PROTO, 'server.mjs'))) { console.log('搵唔到原型（server.mjs）：' + PROTO); process.exit(2); }
if (OUT.startsWith(path.resolve(PROTO))) { console.log('輸出資料夾唔可以喺原型資料夾入面：' + OUT); process.exit(2); }
const DEFAULT_OUTPUT_ROOT = path.join(os.tmpdir(), 'crewzero-tests');
const OUTPUT_ROOTS = [...new Map([path.dirname(OUT), DEFAULT_OUTPUT_ROOT].map(p => [process.platform === 'win32' ? path.resolve(p).toLocaleLowerCase('en-US') : path.resolve(p), path.resolve(p)])).values()];
try {
  claimOutput(OUT);
} catch (e) {
  console.log('輸出資料夾唔安全，唔會開始：' + (e && e.message || e));
  process.exit(2);
}
// 清理出事唔可以改變測試結果：只記低，留畀下次
const cleanupErrors = [];
const quietly = (fn, fallback = null) => { try { return fn(); } catch (e) { cleanupErrors.push(String(e && e.message || e)); return fallback; } };
quietly(() => sweepInterrupted(OUTPUT_ROOTS));
quietly(() => pruneOutputs(OUTPUT_ROOTS, OUT));
// 不可用嘅埠（其他服務、真實實例、模擬實例）；每項測試預設佔 10 個埠，需要更多的組在 TESTS 第 5 欄寫明（例如「目標日期」20 個）
// 另加 Fetch 標準封鎖嘅埠（Node fetch 同 Chrome 都拒絕連，例如 6000 會報 bad port，伺服器起咗都連唔到）
// 5040：Windows 系統服務長期佔用（綁唔到，伺服器會自動跳去下一個埠，測試就連錯埠）
const RESERVED = [4318, 4380, 4381, 7680, 4398, 4402, 4470, 4471, 4650, 5040, 5354, 5530,
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080];
function findChrome() {
  const c = opt('chrome', 'SOS_TEST_CHROME');
  if (c) return fs.existsSync(c) ? c : '';
  const list = process.platform === 'win32'
    ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).map(d => path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find(f => fs.existsSync(f)) || '';
}
const CHROME = NO_BROWSER ? '' : findChrome();
fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
const AD = writeAdapters(path.join(OUT, 'adapters'));
const FX = path.join(HERE, 'fixtures');
const fileUrl = p => 'file:///' + p.replace(/\\/g, '/');

// [名稱, 檔案, 參數, 要瀏覽器, 埠段大小（預設 10）]；{out} 每項自己一個資料夾，{port} 每項自己一段埠，{span} 這一段有多少個埠
// 測試自己另選埠時（例如「目標日期」第九節起）只可在 {port} 起、{span} 個埠之內選，否則會落入下一組的埠段
const TESTS = [
  ['後端', 'core/backend-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['裝置通行證', 'core/pass-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['安裝', 'core/install-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['插件打包', 'core/plugin-bundle-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['更新', 'core/update-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['AI 工具啟動殼', 'core/host-shim-test.mjs', ['{proto}', '{out}', '{port}']],
  ['宿主認證與隔離', 'core/certify-test.mjs', ['{proto}', '{out}', '{port}']],
  ['模型對齊', 'core/model-alignment-test.mjs', ['{proto}', '{out}', '{port}']],
  ['手機配對', 'core/phone-pair-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['伺服器安全反例', 'core/round3-server-safety-test.mjs', ['{proto}', '{out}', '{port}']],
  ['公司標誌', 'core/logo-test.mjs', ['{chrome}', '{out}', '{proto}', '{port}'], true],
  ['求助流程', 'core/help-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['主動出手', 'core/proactive-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['出錯提示', 'core/error-text-test.mjs', ['{chrome}', '{out}', '{proto}', '{port}'], true],
  ['旅程（主線）', 'core/journey.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', 'main'], true],
  ['旅程（出錯）', 'core/journey.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', 'errors'], true],
  ['答題', 'core/cdp-ask.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', path.join(FX, 'demo-14.json')], true],
  ['鏈（假 AI）', 'core/cdp-chain.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', 'ok', '90'], true],
  ['鏈（缺 AI）', 'core/cdp-chain.mjs', ['{chrome}', '{out}', '{proto}', '{missing}', '{port}', 'missing', '60'], true],
  ['開機補做', 'core/catchup.mjs', ['{proto}', '{fake}', '{port}']],
  ['校對頁', 'core/proofread-page-test.mjs', ['{chrome}', '{out}', fileUrl(path.join(PROTO, 'proofread.html')) + '?data=fixtures/sample-company-page.js', fileUrl(path.join(FX, 'farm-page.js'))], true],
  ['目標日期', 'core/goal-dates-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', '{span}'], true, 20],
  ['舊分頁', 'core/stale.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['並發', 'core/race.mjs', ['{proto}', '{out}', '{port}']],
  ['名稱表', 'core/names-check.mjs', ['{proto}', '{out}']],
  ['測試輸出清理', 'core/test-output-test.mjs', ['{proto}', '{out}']],
  ['真實事件', 'core/event-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['帳本寫入純函數', 'core/ledger-state-test.mjs', ['{proto}', '{out}']],
  ['人物及機構名單', 'core/people-test.mjs', ['{proto}', '{out}']],
  ['人物及機構名單後台', 'core/people-backend-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['Zero 整理名單', 'core/people-sync-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['公司概覽確認後狀態', 'core/overview-state-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['後台收件與回饋', 'core/inputs-v040-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['0.40.2 十項修正', 'core/fixes-0402-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['與 Zero 討論指令', 'core/tell-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['Office 轉文字', 'core/office-text-test.mjs', []],
  ['Google 連結取回', 'core/link-fetch-test.mjs', []],
  ['試開外部連結', 'core/link-check-test.mjs', []],
  ['輸入狀態純函數', 'core/input-status-test.mjs', ['{proto}', '{out}', '{port}']],
  ['技能文字', 'core/skills-text-test.mjs', ['{proto}', '{out}']],
  ['慶祝紀錄', 'core/celebration-test.mjs', []],
  ['示範保護', 'core/event-demo-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['待決排序', 'core/todo-test.mjs', ['{proto}', '{out}', '{port}']],
  ['首頁業務主線', 'core/founder-op-test.mjs', ['{proto}', '{out}', '{port}']],
  ['由文件預填', 'core/prefill-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['由文件預填頁面', 'core/cdp-prefill.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['八題及生意模式純函數', 'core/intake-v2-test.mjs', ['{proto}', '{out}']],
  ['八題及生意類別', 'core/biztype-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['Zero 稱呼', 'core/zero-voice-test.mjs', ['{proto}', '{out}']],
  ['和 Zero 一起想', 'core/ideate-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['給意見', 'core/cdp-feedback.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['第一天', 'core/cdp-firstday.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['告訴 Zero 文件核對', 'core/cdp-intake-check.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['慶祝', 'core/cdp-celebration.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['新手收尾', 'core/novice-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['入門頁', 'core/welcome-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['首頁業務主線頁面', 'core/main-line-page-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['階段 B 頁面', 'core/cdp-desk-b.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['公司概覽', 'overview/overview-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['監察台', 'dashboard/dash-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
    ['日程月曆與改日期', 'dashboard/calendar-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['監察台頁面', 'dashboard/cdp-dash.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['生意大腦', 'dashboard/brain-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['生意大腦第二批機械核對', 'dashboard/brain-second-batch-test.mjs', ['{proto}']],
  ['生意大腦第三批補完', 'dashboard/brain-third-completion-test.mjs', ['{proto}']],
  ['生意大腦第一批純函數', 'dashboard/brain-first-batch-test.mjs', ['{proto}']],
  ['生意大腦接帳本', 'dashboard/brain-ledger-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['生意大腦觸發表', 'dashboard/brain-c2-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['生意大腦頁面', 'dashboard/cdp-brain.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['修正', 'dashboard/fix-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['監察台對齊版', 'dashboard/v2-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['一個殼與運作環', 'dashboard/shell-de-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['站點完成後', 'dashboard/strip-done-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['自足檢查', 'dashboard/plain-test.mjs', ['{out}', '{proto}', '{fake}']],
  ['紅藍對打', 'debate/debate-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['紅藍對打頁面', 'debate/cdp-debate.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['情景演練', 'practice/practice-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['網上工具與對話協定', 'practice/web-chat-unit.mjs', ['{proto}']],
  ['情景演練頁面', 'practice/cdp-practice.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['上網', 'web/web-test.mjs', ['{proto}', '{out}', '{port}', '{web}']],
  ['經營節奏 14 日', 'rhythm/rhythm-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['經營節奏 14 日（21:00 後開始）', 'rhythm/rhythm-test.mjs', ['{proto}', '{out}', '{port}', '{fake}', '2026-10-29T21:30:00']],
  ['伺服器定時', 'rhythm/server-tick-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['排程登記', 'rhythm/schedule-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}']],
  ['自動開工設定', 'rhythm/rhythm-edit-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['每週訪問', 'rhythm/interview-test.mjs', ['{proto}', '{out}', '{port}', '{fake}', '{chrome}'], true]
];
// 結果：最後一行「x / y」「x/y passed」「x/y 通過」；冇總數就睇有冇 FAIL 行
function verdict(text, code) {
  const fails = (text.match(/^FAIL\b/gm) || []).length;
  const sums = [...text.matchAll(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?=\s*(?:passed|通過|$))/gm)];
  const last = sums.pop();
  if (last) { const [p, t] = [Number(last[1]), Number(last[2])]; return { pass: p === t && t > 0 && !fails && code === 0, score: p + '/' + t }; }
  const passes = (text.match(/^PASS\b/gm) || []).length;
  return { pass: passes > 0 && !fails && code === 0, score: passes + '/' + (passes + fails) };
}
function run(file, args) {
  return new Promise(resolve => {
    // SOS_NO_OPEN：伺服器唔會開系統瀏覽器（裝置通行證嘅一次性連結由測試自己兌換）
    const env = { ...process.env, SOS_TEST_OUT: args.out, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', SOS_CODEX_AUTH: path.join(args.out, 'no-real-codex-auth.json') };
    for (const k of ['SOS_DATA', 'SOS_SIM', 'SOS_ADAPTER', 'SOS_FAKE_PAGE']) delete env[k];
    const child = spawn(process.execPath, [path.join(HERE, file), ...args.list], { cwd: path.dirname(path.join(HERE, file)), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    const kill = setTimeout(() => child.kill(), 20 * 60000);
    child.on('exit', code => { clearTimeout(kill); resolve({ text, code }); });
  });
}
// 埠段分配：每組佔 [起點, 起點 + 段大小)，段與段不重疊，也不含不可用的埠
function allocatePorts() {
  const plan = new Map(); let p = PORT; const taken = [];
  for (const [i, [name, file, , , span = 10]] of TESTS.entries()) {
    if (ONLY.length && !ONLY.some(o => name.includes(o) || file.includes(o))) continue;
    while (RESERVED.some(r => r >= p && r < p + span)) p += 10;
    const seg = { name, from: p, to: p + span - 1, span };
    const clash = taken.find(t => seg.from <= t.to && t.from <= seg.to);
    if (clash) { console.log(`埠段重疊：${seg.name} ${seg.from}-${seg.to} 與 ${clash.name} ${clash.from}-${clash.to}`); process.exit(2); }
    taken.push(seg); plan.set(i, seg); p += span;
  }
  return { plan, taken };
}
const PORTS = allocatePorts();
if (argv.includes('--ports')) {
  for (const t of PORTS.taken) console.log(`${t.from}-${t.to}（${t.span}）${t.name}`);
  console.log(`共 ${PORTS.taken.length} 組，埠段互不重疊`);
  process.exit(0);
}
const results = [];
let evidenceBytes = 0;
function writeSummary(finished, output) {
  const summary = { at: new Date().toISOString(), proto: PROTO, chrome: CHROME, results, finished };
  if (output) summary.output = output;
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
}
console.log(`原型：${PROTO}\n輸出：${OUT}\nChrome：${CHROME || '（冇；要瀏覽器嘅測試唔會跑）'}\n`);
for (const [i, [name, file, params, browser]] of TESTS.entries()) {
  if (ONLY.length && !ONLY.some(o => name.includes(o) || file.includes(o))) continue;
  const seg = PORTS.plan.get(i), port = seg.from;
  const out = path.join(OUT, 'runs', pad(i + 1) + '-' + path.basename(file, '.mjs'));
  if (browser && !CHROME) {
    results.push({ name, file, pass: false, score: '未跑', note: '冇 Chrome', evidence: null, leftBytes: 0 });
    writeSummary(false);
    console.log(`－ ${name}：未跑（冇 Chrome）`); continue;
  }
  quietly(() => updateOutputMarker(OUT, { heartbeatAt: new Date().toISOString() }));
  const map = { '{proto}': PROTO, '{out}': out, '{port}': String(port), '{span}': String(seg.span), '{fake}': AD.fake, '{web}': AD.web, '{missing}': AD.missing, '{chrome}': CHROME };
  const list = params.map(p => map[p] ?? p);
  const t0 = Date.now(), log = path.join(OUT, 'logs', pad(i + 1) + '-' + path.basename(file, '.mjs') + '.txt');
  let { text, code } = await run(file, { list, out });
  fs.writeFileSync(log, text);
  let v = verdict(text, code), first = null;
  // 唔通過就自動重試一次（機器忙時嘅時序問題）；兩次都照記，總結標明「重試後通過」
  if (!v.pass) {
    first = v.score;
    const retryOut = path.join(out, 'retry');
    const retryList = list.map((arg, j) => params[j] === '{out}' ? retryOut : arg);
    ({ text, code } = await run(file, { list: retryList, out: retryOut }));
    fs.writeFileSync(log.replace(/\.txt$/, '-retry.txt'), text);
    v = verdict(text, code);
  }
  let evidence = null;
  if (!v.pass) {
    evidence = quietly(() => collectFailureEvidence(out, path.join(OUT, 'failed', path.basename(out)), { maxBytes: Math.min(FAILURE_GROUP_MAX_BYTES, Math.max(0, FAILURE_RUN_MAX_BYTES - evidenceBytes)) }));
    evidenceBytes += evidence ? evidence.bytes : 0;
  }
  let cleared = { removed: false, left: [] };
  if (!KEEP_RUNS && fs.existsSync(out)) cleared = quietly(() => safeRemove(out, OUT), cleared);
  const leftBytes = dirSize(out);
  results.push({ name, file, port, ...v, ...(first ? { retried: true, firstScore: first } : {}), seconds: Math.round((Date.now() - t0) / 1000), evidence, leftBytes, ...(cleared.left.length ? { cleanupLeft: cleared.left } : {}) });
  writeSummary(false);
  console.log(`${v.pass ? '✓' : '✗'} ${name}：${v.score}${first ? (v.pass ? '（重試後通過；第一次 ' + first + '）' : '（重試都唔通過；第一次 ' + first + '）') : ''}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
}
const failed = results.filter(r => !r.pass), retriedOk = results.filter(r => r.pass && r.retried);
if (!KEEP_RUNS && fs.existsSync(path.join(OUT, 'runs'))) quietly(() => safeRemove(path.join(OUT, 'runs'), OUT));
quietly(() => updateOutputMarker(OUT, { state: 'finished', heartbeatAt: new Date().toISOString() }));
const pruned = quietly(() => pruneOutputs(OUTPUT_ROOTS, OUT), { removed: [] });
const output = { bytes: dirSize(OUT), removedOld: pruned.removed, ...(cleanupErrors.length ? { cleanupErrors } : {}) };
writeSummary(true, output);
console.log(`\n${results.length - failed.length}／${results.length} 項通過${retriedOk.length ? '（其中 ' + retriedOk.length + ' 項重試後通過：' + retriedOk.map(r => r.name).join('、') + '）' : ''}${failed.length ? '；唔通過：' + failed.map(r => r.name).join('、') + '（逐項紀錄：' + path.join(OUT, 'logs') + '）' : ''}`);
console.log('輸出保留 ' + (output.bytes / 1024 / 1024).toFixed(1) + ' MB');
process.exit(failed.length ? 1 : 0);
