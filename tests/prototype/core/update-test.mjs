// 更新命令測試（update.mjs）：喺隔離資料夾建一個舊版安裝（data/ 放真實格式嘅舊安裝夾具），再用原型（新版）更新。
// 核對：已是最新冇改動；未安裝指去安裝；AI 工作進行中拒絕；檢查唔寫；更新後 data/ 逐檔雜湊不變、程式檔同清單一致、VERSION 新、
// 有備份、排程啟動檔路徑有效、舊版開緊嘅伺服器被關閉、新版伺服器開到並讀到公司資料；中途失敗由備份完整還原；還原上一個版本；
// 創辦人自己放入嘅檔（data/ 以外）更新同還原都唔會刪；新版已冇嘅舊程式檔（舊清單列明）會刪。假 AI、零費用。
// 舊版來源：環境變數 SOS_TEST_OLD 指向舊版插件資料夾（入面有 .claude-plugin/ 同 program/，例如 0.30 備份嘅 adapters/claude-code/startup-os；改名後係 adapters/claude-code/crewzero）；
// 冇就由原型自己合成一個「舊版」（版本號改細、一個程式檔改咗）。兩種都只讀來源，唔寫入。
// 更新命令由插件附帶嘅 program/update.mjs 執行（將原型嘅 adapters/claude-code/crewzero 複製去輸出資料夾，同真實安裝一樣由 program/ 行；旁邊有 MANIFEST.sha256）；program/ 要同原型同步（插件打包測試另外核對）。
// 用法：node update-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { oldInstall } from '../fixtures/old-install.mjs';
import { installPass } from '../lib/testkit.mjs';
const unpairs = [];
const [PROTO, OUT, PORT, FAKE] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const rules = await import(pathToFileURL(path.join(PROTO, 'bundle-rules.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function tree(root, skip = []) { const out = {}; (function w(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name, p = path.join(d, e.name); if (!rel && skip.some(s => e.name === s || e.name.startsWith(s))) continue; if (e.isDirectory()) { out[r + '/'] = 'dir'; w(p, r); } else out[r] = sha(p); } })(root, ''); return out; }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k))), SOS_PORT: String(PORT), SOS_NO_OPEN: '1', SOS_ADAPTER: FAKE };
const run = (script, args, extra = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...env, ...extra }, timeout: 60000 });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// 插件附帶嘅程式：複製去輸出資料夾，由嗰度嘅 program/update.mjs 行（同真實安裝一樣）；program/ 唔同步就用原型嘅 update.mjs 並記一項失敗
const PLUG = path.join(OUT, 'plugin-copy');
fs.cpSync(path.join(PROTO, 'adapters', 'claude-code', 'crewzero'), PLUG, { recursive: true });
const PROG = path.join(PLUG, 'program');
let UPDATE = path.join(PROG, 'update.mjs');
const pids = [];
try {
  /* 舊版插件資料夾（複製去輸出資料夾，版本號改做 0.3.0；來源只讀） */
  const OLDP = path.join(OUT, 'old-plugin');
  const src = process.env.SOS_TEST_OLD || '';
  let oldSource = '';
  if (src && fs.existsSync(path.join(src, 'program', 'install.mjs'))) {
    fs.cpSync(src, OLDP, { recursive: true }); oldSource = '舊版備份：' + src;
  } else {
    const files = rules.programFiles(PROTO, ['MANIFEST.sha256']);
    for (const f of files) { const d = path.join(OLDP, 'program', ...f.split('/')); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(PROTO, ...f.split('/')), d); }
    fs.appendFileSync(path.join(OLDP, 'program', 'FIRST-WEEK.md'), '\n（合成舊版：此行只在測試用的舊版出現）\n');
    fs.writeFileSync(path.join(OLDP, 'program', 'MANIFEST.sha256'), rules.manifestOf(path.join(OLDP, 'program'), files).join('\n') + '\n');
    oldSource = '由原型合成';
  }
  fs.mkdirSync(path.join(OLDP, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(OLDP, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'startup-os', version: '0.3.0' }));
  const PROJ = path.join(OUT, 'proj'); fs.mkdirSync(PROJ);
  const r0 = run(path.join(OLDP, 'program', 'install.mjs'), [PROJ]);
  // 舊版項目嘅安裝資料夾係改名前嘅 startup-os/：由原型合成嘅舊版會裝成 crewzero/，就改名做 startup-os/ 扮改名前嘅項目；之後所有更新、還原都要喺 startup-os/ 原位做
  if (!fs.existsSync(path.join(PROJ, 'startup-os')) && fs.existsSync(path.join(PROJ, 'crewzero'))) fs.renameSync(path.join(PROJ, 'crewzero'), path.join(PROJ, 'startup-os'));
  const T = path.join(PROJ, 'startup-os'), DATA = path.join(T, 'data');
  ok(`舊版安裝（${oldSource}）：VERSION 0.3.0、有 MANIFEST.sha256`, r0.status === 0 && fs.readFileSync(path.join(T, 'VERSION'), 'utf8').trim() === '0.3.0' && fs.existsSync(path.join(T, 'MANIFEST.sha256')), { status: r0.status, out: r0.stdout, err: r0.stderr });
  const fx = oldInstall(DATA, PROTO);
  const company = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'example-company-page.json'), 'utf8')).company.name;
  // 創辦人自己放入嘅檔（data/ 以外）；一個新版已冇嘅舊程式檔（寫入舊清單）
  fs.writeFileSync(path.join(T, 'my-notes.md'), '創辦人自己的筆記\n');
  fs.writeFileSync(path.join(T, 'fixtures', 'my-own.txt'), '創辦人自己的檔\n');
  fs.writeFileSync(path.join(T, 'old-only.mjs'), '// 舊版才有的程式檔\n');
  fs.appendFileSync(path.join(T, 'MANIFEST.sha256'), sha(path.join(T, 'old-only.mjs')) + '  old-only.mjs\n');
  const before = tree(T), dataBefore = tree(DATA);
  const newVersion = rules.pluginVersion(PROTO);
  const newFiles = rules.programFiles(PROTO, [...rules.INSTALL_SKIP, 'MANIFEST.sha256']);
  const want = rules.parseManifest(rules.manifestOf(PROTO, newFiles).join('\n'));
  const progOff = newFiles.filter(f => { try { return sha(path.join(PROG, ...f.split('/'))) !== want[f]; } catch { return true; } });
  ok('插件附帶嘅 program/ 同原型同步（更新命令由 program/update.mjs 執行，旁邊有 MANIFEST.sha256）', !progOff.length && fs.existsSync(path.join(PROG, 'MANIFEST.sha256')) && rules.pluginVersion(PROG) === newVersion, { off: progOff.slice(0, 5), hint: '請重跑 adapters/claude-code/build-plugin.mjs' });
  if (progOff.length) UPDATE = path.join(PROTO, 'update.mjs');
  const expectCount = newFiles.filter(f => { try { return sha(path.join(T, ...f.split('/'))) !== want[f]; } catch { return true; } }).length + 1;

  /* 已是最新：由原型全新安裝再更新，一個檔都唔改 */
  const PROJ2 = path.join(OUT, 'proj-new'); fs.mkdirSync(PROJ2);
  run(path.join(PROTO, 'install.mjs'), [PROJ2]);
  const T2 = path.join(PROJ2, 'crewzero'), snap2 = tree(T2);
  ok('新項目安裝成 crewzero/（冇 startup-os/）', fs.existsSync(path.join(T2, 'ask.mjs')) && !fs.existsSync(path.join(PROJ2, 'startup-os')), fs.readdirSync(PROJ2));
  const u1 = run(UPDATE, [PROJ2]), u2 = run(UPDATE, [PROJ2, '--apply']);
  ok('已是最新：檢查同 --apply 都結束碼 0、講已是最新、一個檔都唔改', u1.status === 0 && u2.status === 0 && /與目前的插件版本.*相同/.test(u1.stdout) && /與目前的插件版本.*相同/.test(u2.stdout) && same(tree(T2), snap2), { u1: u1.stdout, u2: u2.stdout, err: u1.stderr });
  fs.writeFileSync(path.join(T2, 'VERSION'), '9.9.9\n');
  const u3 = run(UPDATE, [PROJ2, '--apply']);
  ok('已安裝版本比插件新：拒絕（結束碼 1），唔改成舊版', u3.status === 1 && /比插件的版本/.test(u3.stdout) && fs.readFileSync(path.join(T2, 'VERSION'), 'utf8').trim() === '9.9.9' && same(Object.fromEntries(Object.entries(tree(T2)).filter(([k]) => k !== 'VERSION')), Object.fromEntries(Object.entries(snap2).filter(([k]) => k !== 'VERSION'))), u3.stdout);
  const EMPTY = path.join(OUT, 'empty'); fs.mkdirSync(EMPTY);
  const u4 = run(UPDATE, [EMPTY, '--apply']);
  ok('未安裝：結束碼 2，指去 /crewzero:install，唔建任何檔', u4.status === 2 && /crewzero:install/.test(u4.stdout) && !fs.readdirSync(EMPTY).length, u4.stdout);
  const i2 = run(path.join(PROTO, 'install.mjs'), [PROJ]);
  ok('舊版 startup-os/ 上再執行安裝命令：拒絕（結束碼 2）並指去 /crewzero:update，冇另建 crewzero/，一個檔都唔改', i2.status === 2 && /已有舊版安裝/.test(i2.stdout) && /crewzero:update/.test(i2.stdout) && !fs.existsSync(path.join(PROJ, 'crewzero')) && same(tree(T), before), i2.stdout);

  /* AI 工作進行中：run.mjs 嘅鎖存在就拒絕 */
  const LOCK = path.join(DATA, 'ledger', '.lock');
  fs.writeFileSync(LOCK, String(process.pid));
  const b1 = run(UPDATE, [PROJ]), b2 = run(UPDATE, [PROJ, '--apply']);
  fs.rmSync(LOCK, { force: true });
  ok('AI 工作進行中（有鎖）：檢查同 --apply 都結束碼 4、冇改任何檔', b1.status === 4 && b2.status === 4 && /Zero 工作進行中/.test(b2.stdout) && same(tree(T), before), { b1: b1.stdout, b2: b2.stdout });

  /* 檢查（唔寫）：創辦人只見版本和資料保障，技術數目與備份位置只在 stderr */
  const c1 = run(UPDATE, [PROJ]);
  const m = c1.stderr.match(/程式檔數量：(\d+)；備份位置：(.+)/);
  ok('檢查：結束碼 3、創辦人文字說明版本與公司資料保障；程式檔數目在技術細節且與實際一致', c1.status === 3 && c1.stdout.includes(`由版本 0.3.0 更新至 ${newVersion}`) && /公司資料不會改動/.test(c1.stdout) && m && Number(m[1]) === expectCount && !c1.stdout.includes('程式檔') && !c1.stdout.includes('.backup-') && !c1.stdout.includes(PROJ), { out: c1.stdout, err: c1.stderr, expectCount });
  ok('檢查冇寫任何嘢：安裝資料夾雜湊不變、冇備份、項目根冇暫存資料夾', same(tree(T), before) && fs.readdirSync(PROJ).join(',') === 'startup-os', fs.readdirSync(PROJ));

  /* 中途失敗：由備份還原到一模一樣 */
  const f1 = run(UPDATE, [PROJ, '--apply'], { SOS_UPDATE_FAIL_AFTER: '7' });
  ok('換入第 7 個檔之後故意失敗：結束碼 1、講已由備份還原', f1.status === 1 && /已還原到原本版本/.test(f1.stdout), { status: f1.status, out: f1.stdout, err: f1.stderr });
  const f1Line = f1.stdout.split(/\r?\n/).find(l => /更新未完成/.test(l)) || '';
  ok('失敗句：講原因同做法、公司資料冇改動；冇錯誤原文、冇路徑（原文只去 stderr）', /原因：/.test(f1Line) && /公司資料沒有改動/.test(f1Line) && /請/.test(f1Line) && !/測試：故意|[A-Za-z]:\\/.test(f1Line) && /測試：故意/.test(f1.stderr), { f1Line, err: f1.stderr });
  ok('失敗後安裝資料夾逐檔雜湊同更新前一模一樣（含 VERSION、創辦人嘅檔、舊程式檔；冇留低備份）', same(tree(T), before), { extra: Object.keys(tree(T)).filter(k => !(k in before)), missing: Object.keys(before).filter(k => !(k in tree(T))), changed: Object.keys(before).filter(k => k in tree(T) && tree(T)[k] !== before[k]).slice(0, 5) });
  ok('失敗後 data/ 逐檔不變、冇留低鎖、項目根冇暫存資料夾', same(tree(DATA), dataBefore) && !fs.existsSync(LOCK) && fs.readdirSync(PROJ).join(',') === 'startup-os', fs.readdirSync(PROJ));

  /* 舊版伺服器開緊（冇工作進行中）→ 更新 → 舊伺服器被關閉 */
  const s0 = run(path.join(T, 'ask.mjs'), ['--desk']);
  const url0 = (s0.stdout.match(/http:\/\/127\.0\.0\.1:\d+\//) || [])[0];
  const st0 = url0 ? await (await fetch(url0 + 'api/health')).json() : {};
  if (url0) unpairs.push(await installPass(lib.rootId(DATA), url0, DATA));
  const oldPid = Number(st0.pid) || 0; if (oldPid) pids.push(oldPid);
  ok('舊版 CrewZero 開到（更新前）', !!url0 && oldPid > 0 && st0.root === lib.rootId(DATA), { out: s0.stdout, err: s0.stderr, st0 });
  // 伺服器開機會建空資料夾（asks/、founder/ 等），係伺服器做嘅；data/ 快照喺伺服器開咗之後先影，更新前後比較
  await sleep(800);
  const dataPre = tree(DATA);
  ok('舊版伺服器開機只建空資料夾，data/ 檔案雜湊同夾具一致', same(Object.fromEntries(Object.entries(dataPre).filter(([, v]) => v !== 'dir')), Object.fromEntries(Object.entries(dataBefore).filter(([, v]) => v !== 'dir'))));
  const c2 = run(UPDATE, [PROJ]);
  ok('檢查時講明 CrewZero 開着、更新後會關閉', c2.status === 3 && /CrewZero 目前開着/.test(c2.stdout), c2.stdout);
  const a1 = run(UPDATE, [PROJ, '--apply']);
  ok(`更新：結束碼 0、講新版本 ${newVersion}、公司資料沒有改動、已關閉舊版 CrewZero；備份位置只在技術細節`, a1.status === 0 && new RegExp(`已更新至版本 ${newVersion.replace(/\./g, '\\.')}`).test(a1.stdout) && /沒有改動/.test(a1.stdout) && /已關閉開着的 CrewZero/.test(a1.stdout) && /備份位置：.*\.backup-0\.3\.0/.test(a1.stderr) && !a1.stdout.includes('.backup-') && !a1.stdout.includes('程式檔'), { status: a1.status, out: a1.stdout, err: a1.stderr });
  await sleep(500);
  ok('舊版伺服器已經唔再運行', !alive(oldPid), oldPid);
  ok('更新後 data/ 逐檔雜湊不變（連資料夾都冇多冇少）、冇留低鎖', same(tree(DATA), dataPre) && !fs.existsSync(LOCK), { changed: Object.keys(dataPre).filter(k => tree(DATA)[k] !== dataPre[k]), extra: Object.keys(tree(DATA)).filter(k => !(k in dataPre)) });
  const offs = newFiles.filter(f => { try { return sha(path.join(T, ...f.split('/'))) !== want[f]; } catch { return true; } });
  const manNow = fs.existsSync(path.join(T, 'MANIFEST.sha256')) ? rules.parseManifest(fs.readFileSync(path.join(T, 'MANIFEST.sha256'), 'utf8')) : {};
  ok('每個程式檔同新版清單雜湊一致，安裝資料夾嘅 MANIFEST.sha256 就係新清單', !offs.length && same(manNow, want), offs.slice(0, 5));
  ok('VERSION 係新版本', fs.readFileSync(path.join(T, 'VERSION'), 'utf8').trim() === newVersion, fs.readFileSync(path.join(T, 'VERSION'), 'utf8'));
  const BK = path.join(T, '.backup-0.3.0');
  const oldNonData = Object.entries(before).filter(([k]) => !k.startsWith('data/') && k !== 'data/' && !k.endsWith('/'));
  ok('備份資料夾有舊版全部檔（data/ 以外，含創辦人嘅檔）、逐檔雜湊同更新前一致', fs.existsSync(BK) && oldNonData.every(([k, h]) => { try { return sha(path.join(BK, ...k.split('/'))) === h; } catch { return false; } }) && !fs.existsSync(path.join(BK, 'data')), oldNonData.filter(([k, h]) => { try { return sha(path.join(BK, ...k.split('/'))) !== h; } catch { return true; } }).map(([k]) => k).slice(0, 5));
  ok('新版已冇嘅舊程式檔（舊清單列明）已刪；創辦人自己放入嘅兩個檔原封不動', !fs.existsSync(path.join(T, 'old-only.mjs')) && sha(path.join(T, 'my-notes.md')) === before['my-notes.md'] && sha(path.join(T, 'fixtures', 'my-own.txt')) === before['fixtures/my-own.txt']);
  const cmd = fs.readFileSync(path.join(T, 'run-schedule.cmd'), 'utf8');
  ok('排程啟動檔重新生成：絕對路徑指住存在嘅執行環境同同一資料夾嘅 run.mjs', cmd.includes('"' + process.execPath + '"') && cmd.includes('"' + path.join(T, 'run.mjs') + '"') && fs.existsSync(process.execPath) && fs.existsSync(path.join(T, 'run.mjs')) && cmd.includes('cd /d "' + T + '"'), cmd);
  const sh = fs.readFileSync(path.join(T, 'START-HERE.md'), 'utf8');
  ok('START-HERE.md 重新生成：新版本號、有更新指令同還原方法、資料夾名係原位嘅 startup-os/', sh.includes(newVersion) && sh.includes('/crewzero:update') && sh.includes('`startup-os/data/`') && !sh.includes('{dir}') && sh.includes('還原上一個版本') && !/\{version\}|\{date\}/.test(sh), sh.slice(0, 200));
  ok('項目根冇暫存資料夾', fs.readdirSync(PROJ).join(',') === 'startup-os', fs.readdirSync(PROJ));

  /* 新版伺服器開到、讀到舊格式嘅公司資料 */
  const s1 = run(path.join(T, 'ask.mjs'), ['--desk']);
  const url1 = (s1.stdout.match(/http:\/\/127\.0\.0\.1:\d+\//) || [])[0];
  const st1 = url1 ? await (await fetch(url1 + 'api/health')).json() : {};
  if (url1) unpairs.push(await installPass(lib.rootId(DATA), url1, DATA));
  const newPid = Number(st1.pid) || 0; if (newPid) pids.push(newPid);
  ok('更新後打開 CrewZero：新版伺服器、同一個 data/', !!url1 && st1.version === lib.SERVER_VERSION && st1.root === lib.rootId(DATA), { out: s1.stdout, err: s1.stderr, st1 });
  const pageJs = url1 ? await (await fetch(url1 + 'company-page.js')).text() : '';
  const dash = url1 ? await (await fetch(url1 + 'api/dashboard')).json() : {};
  ok('新版讀到舊安裝嘅公司資料（公司概覽同監察台都有公司名）', pageJs.includes(company) && dash.company && dash.company.name === company, { company, dashCompany: dash.company, page: pageJs.slice(0, 120) });

  /* 還原上一個版本 */
  const afterUpdate = tree(T, ['.backup-']), dataMid = tree(DATA);
  const rb1 = run(UPDATE, [PROJ, '--rollback']);
  ok('還原檢查：結束碼 3、創辦人文字只說版本與公司資料保障；備份位置和程式檔數目只在技術細節、冇寫任何檔', rb1.status === 3 && /還原到版本 0\.3\.0/.test(rb1.stdout) && /公司資料不會改動/.test(rb1.stdout) && /備份位置：.*\.backup-0\.3\.0/.test(rb1.stderr) && /程式檔數量：\d+/.test(rb1.stderr) && !rb1.stdout.includes('.backup-') && !rb1.stdout.includes('程式檔') && same(tree(T, ['.backup-']), afterUpdate), { out: rb1.stdout, err: rb1.stderr });
  const rb2 = run(UPDATE, [PROJ, '--rollback', '--apply']);
  await sleep(500);
  ok('還原：結束碼 0、講已還原到 0.3.0、data/ 沒有改動、關閉咗開着嘅新版伺服器', rb2.status === 0 && /已還原 CrewZero 到版本 0\.3\.0/.test(rb2.stdout) && /沒有改動/.test(rb2.stdout) && !alive(newPid), { status: rb2.status, out: rb2.stdout, err: rb2.stderr });
  const restored = tree(T, ['.backup-', 'data']);
  const beforeNoData = Object.fromEntries(Object.entries(before).filter(([k]) => !k.startsWith('data/') && k !== 'data/'));
  ok('還原後 data/ 以外逐檔同更新前一模一樣（VERSION 0.3.0、舊程式檔返返嚟、創辦人嘅檔仍在、新版新增嘅檔已刪）', same(restored, beforeNoData), { extra: Object.keys(restored).filter(k => !(k in beforeNoData)).slice(0, 5), missing: Object.keys(beforeNoData).filter(k => !(k in restored)).slice(0, 5), changed: Object.keys(beforeNoData).filter(k => k in restored && restored[k] !== beforeNoData[k]).slice(0, 5) });
  ok('還原冇改 data/（同還原前逐檔一致）、備份資料夾保留、冇留低鎖', same(tree(DATA), dataMid) && fs.existsSync(BK) && !fs.existsSync(LOCK));

  /* 還原之後再更新：備份唔會覆寫（另起 -2） */
  const a2 = run(UPDATE, [PROJ, '--apply']);
  ok('還原後再更新：成功，舊備份原封不動、新備份另起 .backup-0.3.0-2', a2.status === 0 && fs.existsSync(path.join(T, '.backup-0.3.0-2')) && oldNonData.every(([k, h]) => { try { return sha(path.join(BK, ...k.split('/'))) === h; } catch { return false; } }) && fs.readFileSync(path.join(T, 'VERSION'), 'utf8').trim() === newVersion && same(tree(DATA), dataMid), { status: a2.status, out: a2.stdout, err: a2.stderr });

  /* 公司伺服器和示範伺服器同時開着 → 更新 → 兩個都關閉（示範伺服器曾經漏關，舊程式讀新頁面會失常） */
  const rb3 = run(UPDATE, [PROJ, '--rollback', '--apply']);
  await sleep(500);
  ok('再次還原到舊版，準備同時開兩個伺服器', rb3.status === 0, rb3.stdout);
  const openHealth = async () => { const out = []; for (let p = Number(PORT); p < Number(PORT) + 10; p++) { try { const j = await (await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) })).json(); out.push(j); } catch { } } return out; };
  run(path.join(T, 'ask.mjs'), ['--desk']);
  run(path.join(T, 'ask.mjs'), ['--dashboard', '--demo']);
  const both = await openHealth();
  const deskNow = both.find(j => j.root === lib.rootId(DATA)), demoNow = both.find(j => j.root === lib.rootId(path.join(T, 'demo-data')));
  // 只記下根目錄屬於本測試項目（公司資料或示範資料）的伺服器，收尾時才停；其他程式的伺服器一律不碰
  for (const j of both) if (j.root === lib.rootId(DATA) || j.root === lib.rootId(path.join(T, 'demo-data'))) pids.push(Number(j.pid));
  ok('舊版公司伺服器和示範伺服器都開着', !!deskNow && !!demoNow && deskNow.pid !== demoNow.pid, both);
  const c3 = run(UPDATE, [PROJ]);
  ok('檢查時講明兩者都開着、更新後會關閉', c3.status === 3 && /CrewZero 及示範頁面目前開着/.test(c3.stdout), c3.stdout);
  const a3 = run(UPDATE, [PROJ, '--apply']);
  await sleep(500);
  ok('更新：結束碼 0、講明兩者都已關閉、兩個程序都不再運行', a3.status === 0 && /已關閉開着的 CrewZero 及示範頁面/.test(a3.stdout) && !alive(Number(deskNow?.pid)) && !alive(Number(demoNow?.pid)), { status: a3.status, out: a3.stdout });
  ok('更新後沒有舊版伺服器留下', (await openHealth()).every(j => j.root !== lib.rootId(DATA) && j.root !== lib.rootId(path.join(T, 'demo-data'))), await openHealth());

  /* 只有示範伺服器開着：同樣認得、關得到 */
  const rb4 = run(UPDATE, [PROJ, '--rollback', '--apply']);
  await sleep(500);
  run(path.join(T, 'ask.mjs'), ['--dashboard', '--demo']);
  const onlyDemo = (await openHealth()).find(j => j.root === lib.rootId(path.join(T, 'demo-data')));
  if (onlyDemo) pids.push(Number(onlyDemo.pid));
  const a4 = run(UPDATE, [PROJ, '--apply']);
  await sleep(500);
  ok('只有示範伺服器開着：更新後已關閉，文字只提示範頁面', rb4.status === 0 && !!onlyDemo && a4.status === 0 && /已關閉開着的示範頁面/.test(a4.stdout) && !alive(Number(onlyDemo?.pid)), { rb4: rb4.status, a4: a4.status, out: a4.stdout });
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  for (const u of unpairs) u();
  for (const p of pids) { try { process.kill(p); } catch { } }
  await sleep(300);
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
