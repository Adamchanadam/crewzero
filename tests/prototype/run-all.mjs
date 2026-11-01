// startup-os 原型回歸測試：一條命令跑全套（隔離資料夾、假 AI、零費用；唔掂原型嘅 data/）。
// 用法：node tests/prototype/run-all.mjs [--proto <原型資料夾>] [--out <輸出資料夾>] [--chrome <Chrome 路徑>] [--port <起始埠>] [--only <名稱或檔名，逗號分隔>] [--no-browser]
// 亦可用環境變數：SOS_TEST_PROTO、SOS_TEST_OUT、SOS_TEST_CHROME、SOS_TEST_PORT。詳情見同一資料夾嘅 README.md。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAdapters } from './lib/adapters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, env) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : process.env[env] || ''; };
const pad = n => String(n).padStart(2, '0');
const now = new Date(), stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const PROTO = path.resolve(opt('proto', 'SOS_TEST_PROTO') || path.join(HERE, '..', '..', 'prototypes', 'proofread'));
const OUT = path.resolve(opt('out', 'SOS_TEST_OUT') || path.join(os.tmpdir(), 'startup-os-tests', stamp));
const PORT = Number(opt('port', 'SOS_TEST_PORT') || 4700);
const ONLY = (opt('only', 'SOS_TEST_ONLY') || '').split(',').map(s => s.trim()).filter(Boolean);
const NO_BROWSER = argv.includes('--no-browser');
// 唔准喺原型自己嘅 data/ 或者專案入面跑
if (!fs.existsSync(path.join(PROTO, 'server.mjs'))) { console.log('搵唔到原型（server.mjs）：' + PROTO); process.exit(2); }
if (OUT.startsWith(path.resolve(PROTO))) { console.log('輸出資料夾唔可以喺原型資料夾入面：' + OUT); process.exit(2); }
// 不可用嘅埠（其他服務、真實實例、模擬實例）；每項測試佔 10 個埠
// 另加 Fetch 標準封鎖嘅埠（Node fetch 同 Chrome 都拒絕連，例如 6000 會報 bad port，伺服器起咗都連唔到）
// 5040：Windows 系統服務長期佔用（綁唔到，伺服器會自動跳去下一個埠，測試就連錯埠）
const RESERVED = [4318, 4380, 4381, 4398, 4402, 4470, 4471, 4650, 5040, 5354, 5530,
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

// [名稱, 檔案, 參數, 要瀏覽器]；{out} 每項自己一個資料夾，{port} 每項自己一段埠
const TESTS = [
  ['後端', 'core/backend-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['裝置通行證', 'core/pass-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['安裝', 'core/install-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['插件打包', 'core/plugin-bundle-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['更新', 'core/update-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['AI 工具啟動殼', 'core/host-shim-test.mjs', ['{proto}', '{out}', '{port}']],
  ['宿主認證與隔離', 'core/certify-test.mjs', ['{proto}', '{out}', '{port}']],
  ['手機配對', 'core/phone-pair-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['伺服器安全反例', 'core/round3-server-safety-test.mjs', ['{proto}', '{out}', '{port}']],
  ['旅程（主線）', 'core/journey.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', 'main'], true],
  ['旅程（出錯）', 'core/journey.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', 'errors'], true],
  ['答題', 'core/cdp-ask.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', path.join(FX, 'demo-14.json')], true],
  ['鏈（假 AI）', 'core/cdp-chain.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}', 'ok', '90'], true],
  ['鏈（缺 AI）', 'core/cdp-chain.mjs', ['{chrome}', '{out}', '{proto}', '{missing}', '{port}', 'missing', '60'], true],
  ['開機補做', 'core/catchup.mjs', ['{proto}', '{fake}', '{port}']],
  ['校對頁', 'core/proofread-page-test.mjs', ['{chrome}', '{out}', fileUrl(path.join(PROTO, 'proofread.html')) + '?data=fixtures/sample-company-page.js', fileUrl(path.join(FX, 'farm-page.js'))], true],
  ['舊分頁', 'core/stale.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['並發', 'core/race.mjs', ['{proto}', '{out}', '{port}']],
  ['名稱表', 'core/names-check.mjs', ['{proto}', '{out}']],
  ['真實事件', 'core/event-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['示範保護', 'core/event-demo-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['待決排序', 'core/todo-test.mjs', ['{proto}', '{out}', '{port}']],
  ['由文件預填', 'core/prefill-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['由文件預填頁面', 'core/cdp-prefill.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['階段 B 頁面', 'core/cdp-desk-b.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['公司概覽', 'overview/overview-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['監察台', 'dashboard/dash-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['監察台頁面', 'dashboard/cdp-dash.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['生意大腦', 'dashboard/brain-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
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
  ['情景演練頁面', 'practice/cdp-practice.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
  ['上網', 'web/web-test.mjs', ['{proto}', '{out}', '{port}', '{web}']],
  ['經營節奏 14 日', 'rhythm/rhythm-test.mjs', ['{proto}', '{out}', '{port}', '{fake}']],
  ['經營節奏 14 日（21:00 後開始）', 'rhythm/rhythm-test.mjs', ['{proto}', '{out}', '{port}', '{fake}', '2026-10-29T21:30:00']],
  ['排程登記', 'rhythm/schedule-test.mjs', ['{chrome}', '{out}', '{proto}', '{fake}', '{port}'], true],
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
    const env = { ...process.env, SOS_TEST_OUT: args.out, SOS_NO_OPEN: '1', SOS_CODEX_AUTH: path.join(args.out, 'no-real-codex-auth.json') };
    for (const k of ['SOS_DATA', 'SOS_SIM', 'SOS_ADAPTER', 'SOS_FAKE_PAGE']) delete env[k];
    const child = spawn(process.execPath, [path.join(HERE, file), ...args.list], { cwd: path.dirname(path.join(HERE, file)), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = ''; child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    const kill = setTimeout(() => child.kill(), 20 * 60000);
    child.on('exit', code => { clearTimeout(kill); resolve({ text, code }); });
  });
}
const results = [];
let port = PORT;
console.log(`原型：${PROTO}\n輸出：${OUT}\nChrome：${CHROME || '（冇；要瀏覽器嘅測試唔會跑）'}\n`);
for (const [i, [name, file, params, browser]] of TESTS.entries()) {
  if (ONLY.length && !ONLY.some(o => name.includes(o) || file.includes(o))) continue;
  while (RESERVED.some(r => r >= port && r < port + 10)) port += 10;
  const out = path.join(OUT, 'runs', pad(i + 1) + '-' + path.basename(file, '.mjs'));
  if (browser && !CHROME) { results.push({ name, file, pass: false, score: '未跑', note: '冇 Chrome' }); console.log(`－ ${name}：未跑（冇 Chrome）`); continue; }
  const map = { '{proto}': PROTO, '{out}': out, '{port}': String(port), '{fake}': AD.fake, '{web}': AD.web, '{missing}': AD.missing, '{chrome}': CHROME };
  const list = params.map(p => map[p] ?? p);
  const t0 = Date.now(), log = path.join(OUT, 'logs', pad(i + 1) + '-' + path.basename(file, '.mjs') + '.txt');
  let { text, code } = await run(file, { list, out });
  fs.writeFileSync(log, text);
  let v = verdict(text, code), first = null;
  // 唔通過就自動重試一次（機器忙時嘅時序問題）；兩次都照記，總結標明「重試後通過」
  if (!v.pass) {
    first = v.score;
    ({ text, code } = await run(file, { list, out }));
    fs.writeFileSync(log.replace(/\.txt$/, '-retry.txt'), text);
    v = verdict(text, code);
  }
  results.push({ name, file, port, ...v, ...(first ? { retried: true, firstScore: first } : {}), seconds: Math.round((Date.now() - t0) / 1000) });
  console.log(`${v.pass ? '✓' : '✗'} ${name}：${v.score}${first ? (v.pass ? '（重試後通過；第一次 ' + first + '）' : '（重試都唔通過；第一次 ' + first + '）') : ''}（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  port += 10;
}
const failed = results.filter(r => !r.pass), retriedOk = results.filter(r => r.pass && r.retried);
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), proto: PROTO, chrome: CHROME, results }, null, 2));
console.log(`\n${results.length - failed.length}／${results.length} 項通過${retriedOk.length ? '（其中 ' + retriedOk.length + ' 項重試後通過：' + retriedOk.map(r => r.name).join('、') + '）' : ''}${failed.length ? '；唔通過：' + failed.map(r => r.name).join('、') + '（逐項紀錄：' + path.join(OUT, 'logs') + '）' : ''}`);
process.exit(failed.length ? 1 : 0);
