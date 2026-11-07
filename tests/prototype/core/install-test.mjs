// 安裝命令測試（MVP 規格 2026-10-29 第 2 節第 1 項、第 4 節 4.2 第 1 步）：全新空資料夾安裝 → 結構、排除清單、空 data/、VERSION、START-HERE.md、排程啟動檔；
// 再裝一次被拒而且全部檔案雜湊不變；以安裝咗嘅 ask.mjs --desk 開頁，資料寫入新安裝嘅 data/（唔郁原型 data/）。假 AI、零費用。
// 用法：node install-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installPass } from '../lib/testkit.mjs';
let unpair = () => { };
const [PROTO, OUT, PORT, FAKE] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const rules = await import(pathToFileURL(path.join(PROTO, 'bundle-rules.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function tree(root) { const out = {}; (function w(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name, p = path.join(d, e.name); if (e.isDirectory()) { out[r + '/'] = 'dir'; w(p, r); } else out[r] = sha(p); } })(root, ''); return out; }
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k))), SOS_PORT: String(PORT), SOS_NO_OPEN: '1', SOS_ADAPTER: FAKE };
let pid = 0;
try {
  const PROJ = path.join(OUT, 'proj'); fs.mkdirSync(PROJ);
  fs.writeFileSync(path.join(PROJ, 'README.md'), '# 測試項目\n');
  const before = sha(path.join(PROJ, 'README.md'));
  const protoData = fs.existsSync(path.join(PROTO, 'data')) ? Object.keys(tree(path.join(PROTO, 'data'))).length : -1;
  const r1 = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), PROJ], { encoding: 'utf8', env });
  const T = path.join(PROJ, 'crewzero');
  const firstStatus = spawnSync(process.execPath, [path.join(T, 'ask.mjs'), '--status'], { encoding: 'utf8', env });
  ok('剛安裝時查狀態：指引先設定 AI，不報錯，不建立檔案', firstStatus.status === 0 && firstStatus.stdout.includes('設定 AI') && !firstStatus.stdout.includes('未能讀取') && fs.readdirSync(path.join(T, 'data')).length === 0, firstStatus.stdout + firstStatus.stderr);
  ok('全新空資料夾安裝：結束碼 0，創辦人文字只確認安裝完成，不含路徑或程式檔', r1.status === 0 && /CrewZero 已安裝完成/.test(r1.stdout) && !r1.stdout.includes(PROJ) && !r1.stdout.includes('程式檔'), { status: r1.status, out: r1.stdout, err: r1.stderr });
  const must = ['ask.mjs', 'server.mjs', 'run.mjs', 'install.mjs', 'adapters/scheduler/install-schedule.mjs', 'adapters/hosts/claude.json', 'FIRST-WEEK.md', 'VERSION', 'START-HERE.md', 'run-schedule.cmd', 'start-crewzero.cmd', 'fixtures/example-company-page-full.json'];
  ok('結構：入口、外殼、轉接層、第一星期指引、VERSION、START-HERE.md、相容排程及登入啟動檔、外殼要讀嘅虛構範本都齊', must.every(f => fs.existsSync(path.join(T, f))), must.filter(f => !fs.existsSync(path.join(T, f))));
  ok('data/ 係空資料夾', fs.statSync(path.join(T, 'data')).isDirectory() && fs.readdirSync(path.join(T, 'data')).length === 0, fs.existsSync(path.join(T, 'data')) && fs.readdirSync(path.join(T, 'data')));
  const absent = ['demo-data', 'mockups', 'screenshots', 'PROTOTYPE-HANDOFF.md', 'adapters/claude-code/crewzero', 'adapters/claude-code/.claude-plugin', '開始.cmd', 'start-here-template.md'];
  ok('排除清單：示範、設計稿、截圖、交接筆記、插件資料夾同市集資訊、開發用啟動檔都冇帶', absent.every(f => !fs.existsSync(path.join(T, f))), absent.filter(f => fs.existsSync(path.join(T, f))));
  const want = rules.programFiles(PROTO, rules.INSTALL_SKIP);
  const got = Object.keys(tree(T)).filter(k => !k.endsWith('/') && !['VERSION', 'START-HERE.md', 'run-schedule.cmd', 'run-schedule.sh', 'start-crewzero.cmd', 'start-crewzero.sh'].includes(k));
  ok('程式檔同原型一致（同一排除清單，逐檔雜湊）', JSON.stringify(got.sort()) === JSON.stringify(want) && want.every(f => sha(path.join(T, f)) === sha(path.join(PROTO, f))), { extra: got.filter(f => !want.includes(f)), missing: want.filter(f => !got.includes(f)) });
  const ver = rules.pluginVersion(PROTO);
  ok('VERSION 取自插件資訊檔', /^\d+\.\d+\.\d+$/.test(ver) && fs.readFileSync(path.join(T, 'VERSION'), 'utf8').trim() === ver, { ver, file: fs.readFileSync(path.join(T, 'VERSION'), 'utf8') });
  const sh = fs.readFileSync(path.join(T, 'START-HERE.md'), 'utf8');
  ok('START-HERE.md：四個指令（沒有 desk、沒有舊名稱）、data/ 不可手改、沒有本機通知要自己打開、出錯看系統頁、程式更新做法、版本', ['/crewzero:dashboard', '/crewzero:discuss', '/crewzero:install', '$crewzero:dashboard', '$crewzero:discuss', '/discuss', 'crewzero/data/', '請勿手改', '沒有本機通知', '系統', '程式更新', ver].every(k => sh.includes(k)) && !/\{version\}|\{date\}/.test(sh) && !/Founder Desk|營運監察台|crewzero:desk|\/desk/.test(sh), sh.slice(0, 300));
  const cmd = fs.readFileSync(path.join(T, 'run-schedule.cmd'), 'utf8');
  ok('排程啟動檔：絕對路徑叫執行環境同同一資料夾嘅 run.mjs，以排程觸發，唔靠環境變數', cmd.includes('"' + process.execPath + '"') && cmd.includes('"' + path.join(T, 'run.mjs') + '"') && cmd.includes('--type auto --trigger schedule') && cmd.includes('cd /d "' + T + '"') && !/SOS_|%[A-Z_]+%/.test(cmd), cmd);
  const start = fs.readFileSync(path.join(T, 'start-crewzero.cmd'), 'utf8');
  ok('登入啟動檔：絕對路徑叫 ask.mjs --serve，唔會開瀏覽器亦唔靠環境變數', start.includes('"' + process.execPath + '"') && start.includes('"' + path.join(T, 'ask.mjs') + '"') && start.includes('--serve') && start.includes('cd /d "' + T + '"') && !/SOS_|%[A-Z_]+%/.test(start), start);
  ok('項目其他檔冇改', sha(path.join(PROJ, 'README.md')) === before && fs.readdirSync(PROJ).sort().join(',') === 'README.md,crewzero', fs.readdirSync(PROJ));

  /* 再裝一次：拒絕，一個檔都唔改 */
  const snap = tree(T);
  const r2 = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), PROJ], { encoding: 'utf8', env });
  ok('再裝一次：拒絕（結束碼 2）並講已安裝', r2.status === 2 && /已安裝/.test(r2.stdout), { status: r2.status, out: r2.stdout });
  ok('再裝一次：全部檔案雜湊不變、冇多冇少', JSON.stringify(tree(T)) === JSON.stringify(snap));
  const r3 = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), path.join(OUT, 'no-such-folder')], { encoding: 'utf8', env });
  ok('項目資料夾唔存在：拒絕，唔建任何檔', r3.status === 1 && !fs.existsSync(path.join(OUT, 'no-such-folder')), r3.stdout);
  /* 改名前裝嘅舊版項目（有 startup-os/）：唔另建 crewzero/，指去更新指令，一個檔都唔改 */
  const LP = path.join(OUT, 'legacy-proj'), LT = path.join(LP, 'startup-os'); fs.mkdirSync(LT, { recursive: true });
  fs.writeFileSync(path.join(LT, 'ask.mjs'), '// 舊版\n'); fs.writeFileSync(path.join(LT, 'VERSION'), '0.6.1\n');
  const lsnap = tree(LP), r5 = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), LP], { encoding: 'utf8', env });
  ok('舊版 startup-os/ 項目執行安裝：拒絕（結束碼 2）、講沿用舊資料夾並指去更新指令、冇建 crewzero/、一個檔都唔改', r5.status === 2 && /舊版安裝/.test(r5.stdout) && /\/crewzero:update/.test(r5.stdout) && !fs.existsSync(path.join(LP, 'crewzero')) && JSON.stringify(tree(LP)) === JSON.stringify(lsnap), { status: r5.status, out: r5.stdout });

  /* 以安裝咗嘅入口開頁：資料寫入新安裝嘅 data/ */
  const r4 = spawnSync(process.execPath, [path.join(T, 'ask.mjs'), '--desk'], { encoding: 'utf8', env, timeout: 30000 });
  const url = (r4.stdout.match(/http:\/\/127\.0\.0\.1:\d+\//) || [])[0];
  ok('node crewzero/ask.mjs --desk（舊別名）：開到 CrewZero', r4.status === 0 && !!url, { out: r4.stdout, err: r4.stderr });
  const st = url ? await (await fetch(url + 'api/health')).json() : {};
  pid = Number(st.pid) || 0;
  // 正實例冇測試鉤：測試自己扮已配對嘅瀏覽器（寫雜湊入用戶設定資料夾，完畢即刪）
  if (url) unpair = await installPass(lib.rootId(path.join(T, 'data')), url, path.join(T, 'data'));
  ok('伺服器認得新安裝嘅資料夾（同一個 data/）', st.root === lib.rootId(path.join(T, 'data')), { root: st.root, want: lib.rootId(path.join(T, 'data')) });
  const page = url ? await (await fetch(url)).text() : '';
  ok('首頁是 CrewZero', /CrewZero/.test(page), page.slice(0, 200));
  const post = async (p, body) => { const r = await fetch(url + p.replace(/^\//, ''), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.replace(/\/$/, '') }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  await post('/api/setup', { action: 'certify', host: 'test' });
  let cert = null; for (let i = 0; i < 100 && !cert; i++) { await sleep(400); const s = await (await fetch(url + 'api/setup')).json(); if (s.certify && s.certify.state !== 'running') cert = s.certify; }
  ok('喺新安裝設定 AI（假 AI）：認證寫入新安裝嘅 data/', cert && cert.state === 'passed' && fs.existsSync(path.join(T, 'data', 'ledger', 'adapter-cert.json')), cert);
  ok('原型自己嘅 data/ 冇被寫入', (fs.existsSync(path.join(PROTO, 'data')) ? Object.keys(tree(path.join(PROTO, 'data'))).length : -1) === protoData, protoData);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  unpair();
  if (pid) { try { process.kill(pid); } catch { } }
  await sleep(300);
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
