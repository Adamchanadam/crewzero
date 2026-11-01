// startup-os 更新命令：將項目入面已安裝嘅 startup-os/ 程式檔換成插件附帶嘅新版；data/ 一個檔都唔郁。
// 用法：node update.mjs <項目根>                  檢查（唔寫任何嘢）：已是最新 → 結束碼 0；有新版 → 印一句固定說明，結束碼 3；未安裝 → 2；AI 工作進行中 → 4
//       node update.mjs <項目根> --apply          更新：新版先放入暫存資料夾核對，舊版備份到 startup-os/.backup-<舊版本>/，再逐檔換入；中途失敗就由備份還原，唔留半套
//       node update.mjs <項目根> --rollback       檢查還原（唔寫）：有備份 → 印一句固定說明，結束碼 3；冇 → 1
//       node update.mjs <項目根> --rollback --apply   還原到最近一次備份嘅版本；data/ 一樣唔郁
// 版本規則：比較安裝資料夾嘅 VERSION 同插件資訊檔（.claude-plugin/plugin.json）嘅版本號；發佈新版一定要提高插件版本號，否則更新命令會當已是最新。
// 伺服器開緊：Windows 下 node 唔會鎖住已載入嘅 .mjs，所以逐檔換入（唔改名成個資料夾）；有 AI 工作進行中就唔更新。
// 排程：更新期間用 run.mjs 同一個 data/ledger/.lock，排程喺呢段時間開工會自動跳過（唔會行到一半新一半舊嘅程式）；更新完即刻放開。
// 測試用：環境變數 SOS_UPDATE_FAIL_AFTER=<n> 換入第 n 個檔之後故意失敗（驗證由備份還原）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { programFiles, pluginVersion, INSTALL_SKIP, GENERATED, compareVersions, writeGenerated, manifestOf, parseManifest, sha256 } from './bundle-rules.mjs';
import { rootId, BASE_PORT } from './ask-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const say = s => console.log('[startup-os] ' + s);
const argv = process.argv.slice(2), has = k => argv.includes('--' + k);
const arg = argv.find(a => !a.startsWith('--'));
if (!arg) { say('用法：node update.mjs <項目根> [--apply] [--rollback]'); process.exit(1); }
const proj = path.resolve(arg);
let isDir = false; try { isDir = fs.statSync(proj).isDirectory(); } catch { }
if (!isDir) { say('找不到項目資料夾：' + proj); process.exit(1); }
const target = path.join(proj, 'startup-os'), DATA = path.join(target, 'data');
if (!fs.existsSync(path.join(target, 'ask.mjs'))) { say(`這個項目未安裝 startup-os（${target}）。要安裝請在對話輸入 /startup-os:install。`); process.exit(2); }
if (path.resolve(ROOT).toLowerCase().startsWith(path.resolve(target).toLowerCase() + path.sep) || path.resolve(ROOT).toLowerCase() === path.resolve(target).toLowerCase()) { say('不可以用安裝資料夾自己更新自己；請經插件的 /startup-os:update 執行。'); process.exit(1); }
const APPLY = has('apply'), ROLLBACK = has('rollback');
const FAIL_AFTER = Number(process.env.SOS_UPDATE_FAIL_AFTER) || 0;

const sha = f => sha256(fs.readFileSync(f));
const shaOr = f => { try { return sha(f); } catch { return ''; } };
const at = (dir, f) => path.join(dir, ...f.split('/'));
const readVersion = dir => { try { return fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim(); } catch { return ''; } };
// 安裝資料夾入面嘅檔（相對路徑，用「/」分隔）：跳過 data/ 同所有備份資料夾；其餘（包括創辦人自己放入嘅檔）都計
function listInstall(dir) {
  const out = [];
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!rel && (e.name === 'data' || e.name.startsWith('.backup-'))) continue;
      const r = rel ? rel + '/' + e.name : e.name, p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, r); else if (e.isFile()) out.push(r);
    }
  })(dir, '');
  return out.sort();
}
function copyInto(src, dst, files) { for (const f of files) { fs.mkdirSync(path.dirname(at(dst, f)), { recursive: true }); fs.copyFileSync(at(src, f), at(dst, f)); } }
function removeFile(dir, f) {
  fs.rmSync(at(dir, f), { force: true });
  let d = path.dirname(at(dir, f));
  while (d.length > dir.length && d.toLowerCase().startsWith(dir.toLowerCase()) && fs.existsSync(d) && !fs.readdirSync(d).length) { fs.rmdirSync(d); d = path.dirname(d); }
}
// 由備份還原：備份入面每個檔抄返去；known 入面（已知嘅程式檔、生成檔）而備份冇嘅就刪走；最後逐檔核對。回傳唔一致嘅檔
function restoreFrom(backup, dir, known) {
  const bFiles = listInstall(backup);
  copyInto(backup, dir, bFiles);
  for (const f of known) if (!bFiles.includes(f) && !f.startsWith('data/') && fs.existsSync(at(dir, f))) removeFile(dir, f);
  return bFiles.filter(f => shaOr(at(dir, f)) !== sha(at(backup, f)));
}

/* ---------- 開緊嘅伺服器、進行中嘅 AI 工作 ---------- */
async function runningServers() {
  const found = [], want = rootId(DATA);
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${p}/api/status`, { signal: AbortSignal.timeout(800) })).json();
      if (j && j.root === want) found.push({ port: p, pid: Number(j.pid) || 0, busy: !!j.busy, version: String(j.version || '') });
    } catch { }
  }
  return found;
}
const RUN_LOCK = path.join(DATA, 'ledger', '.lock');
// 同 run.mjs 同一個鎖、同一個 20 分鐘過期規則
const runLockHeld = () => { try { return Date.now() - fs.statSync(RUN_LOCK).mtimeMs <= 20 * 60 * 1000; } catch { return false; } };
function takeRunLock() {
  if (!fs.existsSync(path.dirname(RUN_LOCK))) return () => { };
  try { fs.writeFileSync(RUN_LOCK, String(process.pid), { flag: 'wx' }); }
  catch { if (runLockHeld()) return null; fs.rmSync(RUN_LOCK, { force: true }); return takeRunLock(); }
  return () => { try { if (fs.readFileSync(RUN_LOCK, 'utf8') === String(process.pid)) fs.rmSync(RUN_LOCK, { force: true }); } catch { } };
}
const servers = await runningServers();
if (servers.some(s => s.busy) || runLockHeld()) { say('AI 工作進行中，完成後再試。今次沒有改動任何檔案。'); process.exit(4); }
function closeServers() {
  let closed = 0;
  for (const s of servers) if (s.pid) { try { process.kill(s.pid); closed++; } catch { } }
  if (closed) say('已關閉開着的 Founder Desk（舊版程式）；下次打開便是現在的版本。');
}

/* ---------- 還原上一個版本 ---------- */
if (ROLLBACK) {
  const backups = fs.readdirSync(target, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('.backup-'))
    .map(e => ({ dir: path.join(target, e.name), at: fs.statSync(path.join(target, e.name)).mtimeMs })).sort((a, b) => b.at - a.at);
  if (!backups.length) { say(`沒有可以還原的備份（${target} 內沒有 .backup-<版本> 資料夾）。今次沒有改動任何檔案。`); process.exit(1); }
  const backup = backups[0].dir, bVersion = readVersion(backup) || path.basename(backup).replace(/^\.backup-/, ''), cur = readVersion(target) || '未知';
  const bFiles = listInstall(backup);
  if (!bFiles.includes('ask.mjs')) { say(`備份不完整（${backup} 內沒有 ask.mjs），不能還原。今次沒有改動任何檔案。`); process.exit(1); }
  if (!APPLY) {
    say(`將把 ${target} 還原到版本 ${bVersion}（來自 ${backup}，${bFiles.length} 個檔），現時版本 ${cur} 的程式檔會被取代；不會改動 ${DATA}。`);
    if (servers.length) say('Founder Desk 目前開着（沒有工作進行中）：還原後會把它關閉，下次打開便是還原後的版本。');
    process.exit(3);
  }
  const release = takeRunLock();
  if (!release) { say('AI 工作進行中，完成後再試。今次沒有改動任何檔案。'); process.exit(4); }
  let bad = [];
  try {
    const known = [...Object.keys(parseManifest(fs.existsSync(path.join(target, 'MANIFEST.sha256')) ? fs.readFileSync(path.join(target, 'MANIFEST.sha256'), 'utf8') : '')), ...GENERATED];
    bad = restoreFrom(backup, target, known);
  } catch (e) { bad = ['（還原時出錯：' + (e && e.message || e) + '）']; }
  finally { release(); }
  if (bad.length) { say(`還原未完成，有 ${bad.length} 個檔與備份不符：${bad.slice(0, 5).join('、')}。備份仍在 ${backup}，請再試一次；${DATA} 沒有改動。`); process.exit(1); }
  closeServers();
  say(`已還原 startup-os 到版本 ${bVersion}（${bFiles.length} 個檔已逐一核對）。備份資料夾保留在 ${backup}；沒有改動 ${DATA}。`);
  say('下一步：打開 Founder Desk（/startup-os:desk）。');
  process.exit(0);
}

/* ---------- 更新 ---------- */
const oldVersion = readVersion(target), newVersion = pluginVersion(ROOT);
if (!newVersion) { say('插件不完整（找不到版本號），請重新安裝插件。今次沒有改動任何檔案。'); process.exit(1); }
const files = programFiles(ROOT, [...INSTALL_SKIP, 'MANIFEST.sha256']);
const lines = manifestOf(ROOT, files), want = parseManifest(lines.join('\n'));
// 插件附帶嘅清單（build-plugin.mjs 生成）要同程式檔一致，否則插件已損壞；清單會列開發用檔（INSTALL_SKIP，例如 開始.cmd），嗰啲本來就唔安裝，唔算不符
if (fs.existsSync(path.join(ROOT, 'MANIFEST.sha256'))) {
  const m = parseManifest(fs.readFileSync(path.join(ROOT, 'MANIFEST.sha256'), 'utf8'));
  const off = [...files.filter(f => m[f] !== want[f]), ...Object.keys(m).filter(f => !want[f] && !INSTALL_SKIP.includes(f))];
  if (off.length) { say(`插件附帶的程式檔與清單不符（${off.length} 個，例如 ${off[0]}），請重新安裝插件。今次沒有改動任何檔案。`); process.exit(1); }
}
const oldManifest = parseManifest(fs.existsSync(path.join(target, 'MANIFEST.sha256')) ? fs.readFileSync(path.join(target, 'MANIFEST.sha256'), 'utf8') : '');
// 新版已經冇嘅舊程式檔：只刪舊清單列明嘅（創辦人自己放入嘅檔唔喺清單，唔會刪）；舊安裝冇清單就一個都唔刪
const stale = Object.keys(oldManifest).filter(f => !want[f] && !GENERATED.includes(f) && !f.startsWith('data/') && fs.existsSync(at(target, f)));
const changed = files.filter(f => shaOr(at(target, f)) !== want[f]);
const cmp = compareVersions(oldVersion, newVersion);
if (cmp > 0) { say(`已安裝的版本 ${oldVersion} 比插件的版本 ${newVersion} 新，不會改成舊版。今次沒有改動任何檔案。`); process.exit(1); }
if (cmp === 0) {
  say(`已是最新版本 ${newVersion}，沒有改動任何檔案。` + (changed.length + stale.length ? `（注意：有 ${changed.length + stale.length} 個程式檔與插件不同但版本號相同；要推出新版，請先提高插件版本號。）` : ''));
  process.exit(0);
}
const oldLabel = oldVersion || '未知';
let backup = path.join(target, '.backup-' + oldLabel);
for (let i = 2; fs.existsSync(backup); i++) backup = path.join(target, `.backup-${oldLabel}-${i}`);
if (!APPLY) {
  say(`將更新 ${target} 內的 ${changed.length + stale.length} 個程式檔（版本 ${oldLabel} → ${newVersion}），並重新生成 VERSION、START-HERE.md 和排程啟動檔；舊版會先備份到 ${backup}；不會改動 ${DATA}。`);
  if (servers.length) say('Founder Desk 目前開着（沒有工作進行中）：更新後會把它關閉，下次打開便是新版。');
  process.exit(3);
}

const release = takeRunLock();
if (!release) { say('AI 工作進行中，完成後再試。今次沒有改動任何檔案。'); process.exit(4); }
const stage = path.join(proj, `.startup-os-updating-${process.pid}`);
let touched = false, stageFiles = [];
try {
  // 1. 新版先放入暫存資料夾（程式檔、生成檔、清單），逐檔核對
  copyInto(ROOT, stage, files);
  writeGenerated(stage, target, ROOT, newVersion);
  fs.writeFileSync(path.join(stage, 'MANIFEST.sha256'), lines.join('\n') + '\n');
  for (const f of files) if (sha(at(stage, f)) !== want[f]) throw new Error('暫存的程式檔核對不符：' + f);
  stageFiles = listInstall(stage);
  // 2. 舊版備份（data/ 同其他備份以外嘅全部檔），逐檔核對
  const installed = listInstall(target);
  copyInto(target, backup, installed);
  for (const f of installed) if (sha(at(backup, f)) !== sha(at(target, f))) throw new Error('備份核對不符：' + f);
  // 3. 逐檔換入（唔改名成個資料夾：伺服器開緊時資料夾改唔到名，但逐檔覆寫冇問題）
  touched = true;
  let n = 0;
  for (const f of stageFiles) { fs.mkdirSync(path.dirname(at(target, f)), { recursive: true }); fs.copyFileSync(at(stage, f), at(target, f)); if (FAIL_AFTER && ++n >= FAIL_AFTER) throw new Error('測試：故意在第 ' + n + ' 個檔之後失敗'); }
  for (const f of stale) removeFile(target, f);
  // 4. 逐檔核對新版
  const off = [...files.filter(f => shaOr(at(target, f)) !== want[f]), ...stageFiles.filter(f => !want[f] && shaOr(at(target, f)) !== sha(at(stage, f)))];
  if (off.length) throw new Error('更新後核對不符：' + off.slice(0, 3).join('、'));
} catch (e) {
  const why = e && e.message || String(e);
  if (touched) {
    let bad = [];
    try { bad = restoreFrom(backup, target, stageFiles); } catch (e2) { bad = ['（還原時出錯：' + (e2 && e2.message || e2) + '）']; }
    if (bad.length) say(`更新未完成，而且還原時有 ${bad.length} 個檔與備份不符：${bad.slice(0, 5).join('、')}。備份仍在 ${backup}，可在對話輸入「還原上一個版本」再試；${DATA} 沒有改動。原因：${why}`);
    else { try { fs.rmSync(backup, { recursive: true, force: true }); } catch { } say(`更新未完成，已由備份還原到版本 ${oldLabel}（逐檔核對一致）；${DATA} 沒有改動。原因：${why}`); }
  } else {
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch { }
    say(`更新未完成，沒有改動 ${target} 內任何檔案。原因：${why}`);
  }
  try { fs.rmSync(stage, { recursive: true, force: true }); } catch { }
  release();
  process.exit(1);
}
try { fs.rmSync(stage, { recursive: true, force: true }); } catch { }
release();
closeServers();
say(`已更新 startup-os：版本 ${oldLabel} → ${newVersion}（${files.length} 個程式檔已逐一核對${stale.length ? '，刪除了 ' + stale.length + ' 個新版已沒有的舊程式檔' : ''}）。舊版備份在 ${backup}；沒有改動 ${DATA}。`);
say('下一步：打開 Founder Desk（/startup-os:desk）；原有資料照用。若新版有問題，在對話輸入「還原上一個版本」。');
