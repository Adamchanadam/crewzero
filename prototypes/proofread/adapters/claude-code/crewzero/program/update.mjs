// CrewZero 更新命令：將項目入面已安裝嘅程式檔換成插件附帶嘅新版；data/ 一個檔都唔郁。
// 安裝資料夾：新安裝係 crewzero/；改名前裝嘅舊版係 startup-os/，就喺 startup-os/ 原位更新（唔搬、唔改名，data/ 唔郁）。兩個都有就用 crewzero/。
// 用法：node update.mjs <項目根>                  檢查（唔寫任何嘢）：已是最新 → 結束碼 0；有新版 → 印一句固定說明，結束碼 3；未安裝 → 2；AI 工作進行中 → 4
//       node update.mjs <項目根> --apply          更新：新版先放入暫存資料夾核對，舊版備份到 <安裝資料夾>/.backup-<舊版本>/，再逐檔換入；中途失敗就由備份還原，唔留半套
//       node update.mjs <項目根> --rollback       檢查還原（唔寫）：有備份 → 印一句固定說明，結束碼 3；冇 → 1
//       node update.mjs <項目根> --rollback --apply   還原到最近一次備份嘅版本；data/ 一樣唔郁
// 版本規則：比較安裝資料夾嘅 VERSION 同插件資訊檔（.claude-plugin/plugin.json）嘅版本號；發佈新版一定要提高插件版本號，否則更新命令會當已是最新。
// 伺服器開緊：Windows 下 node 唔會鎖住已載入嘅 .mjs，所以逐檔換入（唔改名成個資料夾）；有 AI 工作進行中就唔更新。
// 排程：更新期間用 run.mjs 同一個 data/ledger/.lock，排程喺呢段時間開工會自動跳過（唔會行到一半新一半舊嘅程式）；更新完即刻放開。
// 測試用：環境變數 SOS_UPDATE_FAIL_AFTER=<n> 換入第 n 個檔之後故意失敗（驗證由備份還原）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { programFiles, pluginVersion, INSTALL_SKIP, GENERATED, compareVersions, writeGenerated, manifestOf, parseManifest, sha256, INSTALL_DIR, findInstall } from './bundle-rules.mjs';
import { rootId, legacyRootId, ownsServerPort as ownsPort, serverOwnership, BASE_PORT } from './ask-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const say = s => console.log('[CrewZero] ' + s);
const tech = s => console.error('（技術細節，只供 AI 排查，毋須交給創辦人）' + s);
// 出錯原因（創辦人會經 AI 聽到）：按系統錯誤代號講白話原因同做法；其他（包括程式自己嘅核對）用通用句。錯誤原文另外寫去 stderr
function plainCause(e) {
  const c = e && e.code, m = String(e && e.message || '');
  if (c === 'EPERM' || c === 'EBUSY' || c === 'EACCES') return '部分檔案正被其他程式使用。請關閉 Founder Desk 及其他開着這個資料夾的程式，再更新一次。';
  if (c === 'ENOSPC') return '電腦的儲存空間不足。請騰出空間後，再更新一次。';
  if (/^更新後核對不符/.test(m)) return '更新後的檔案核對不一致。請再更新一次；仍然失敗，請重新開機後再試。';
  return '電腦未能完成檔案更換。請重新開機後，再更新一次。';
}
// 指令叫法按宿主唔同（同一份插件）：命令本身唔知創辦人用邊種工具，所以三種都印
const CMD = n => `Claude Code：/crewzero:${n}；Codex：$crewzero:${n}；Antigravity：/${n}`;
const argv = process.argv.slice(2), has = k => argv.includes('--' + k);
const arg = argv.find(a => !a.startsWith('--'));
if (!arg) { say('未有提供項目資料夾，今次沒有改動任何檔案。請從項目內的 AI 對話再次更新。'); tech('用法：node update.mjs <項目根> [--apply] [--rollback]'); process.exit(1); }
const proj = path.resolve(arg);
let isDir = false; try { isDir = fs.statSync(proj).isDirectory(); } catch { }
if (!isDir) { say('找不到項目資料夾，今次沒有改動任何檔案。請在正確項目內再次更新。'); tech('找不到項目資料夾：' + proj); process.exit(1); }
const target = findInstall(proj), DATA = path.join(target || proj, 'data');
if (!target) { say(`這個項目未安裝 CrewZero。要安裝請在對話輸入安裝指令（${CMD('install')}）。`); tech('找不到安裝資料夾：' + path.join(proj, INSTALL_DIR)); process.exit(2); }
if (path.resolve(ROOT).toLowerCase().startsWith(path.resolve(target).toLowerCase() + path.sep) || path.resolve(ROOT).toLowerCase() === path.resolve(target).toLowerCase()) { say(`不可以用安裝資料夾自己更新自己；請經插件的更新指令執行（${CMD('update')}）。`); process.exit(1); }
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
// 示範頁面（--demo）由同一份程式運行，只是資料夾不同；不一併關閉，舊程式便會讀到新頁面而失常
const DEMO = path.join(target, 'demo-data');
const isDemo = root => root === rootId(DEMO) || root === legacyRootId(DEMO);
const openName = list => list.every(s => s.demo) ? '示範頁面' : list.some(s => s.demo) ? 'Founder Desk 及示範頁面' : 'Founder Desk';
const spaced = s => s.replace(/([\u4e00-\u9fff])([A-Za-z])/g, '$1 $2').replace(/([A-Za-z])([\u4e00-\u9fff])/g, '$1 $2');
async function runningServers() {
  const found = [];
  const ours = (j, p) => j.root === rootId(DATA) || j.root === rootId(DEMO) || (j.root === legacyRootId(DATA) || j.root === legacyRootId(DEMO)) && serverOwnership(p, Number(j.pid), target) !== 'other';
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    try {
      const response = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) });
      const j = response.ok ? await response.json() : null;
      if (j && ours(j, p)) { found.push({ demo: isDemo(j.root), port: p, pid: Number(j.pid) || 0, busy: !!j.busy, version: String(j.version || ''), legacy: false }); continue; }
    } catch { }
    // 舊版只公開 /api/status；必須同樣列入忙碌判斷及關閉名單，不能遺留無通行證入口。
    try {
      const response = await fetch(`http://127.0.0.1:${p}/api/status`, { signal: AbortSignal.timeout(800) });
      const j = response.ok ? await response.json() : null;
      if (j && Number(j.pid) > 0 && ours(j, p)) found.push({ demo: isDemo(j.root), port: p, pid: Number(j.pid), busy: !!j.busy, version: String(j.version || 'legacy-no-pass'), legacy: true });
    } catch { }
  }
  return found;
}
// 由作業系統核對該埠擁有者同命令列（共用 ask-lib.mjs；Windows、macOS、Linux 都支援）
const ownsServerPort = (port, pid) => ownsPort(port, pid, target);
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
if (servers.some(s => s.busy) || runLockHeld()) { say('Zero 工作進行中，完成後再試。今次沒有改動任何檔案。'); process.exit(4); }
if (APPLY && servers.some(s => s.pid && !ownsServerPort(s.port, s.pid))) {
  say(spaced(`今次未有更新：${openName(servers)}正在開着，系統未能安全關閉。請重新開機後再更新一次。項目沒有任何改動。`));
  tech(spaced(`無法獨立核對開着的${openName(servers)}程序身份，已停止換版，沒有終止任何程序或改動任何檔案。`));
  process.exit(4);
}
function closeServers() {
  const closed = [], unverified = [];
  for (const s of servers) if (s.pid) {
    if (!ownsServerPort(s.port, s.pid)) { unverified.push(s); continue; }
    try { process.kill(s.pid); closed.push(s); } catch { }
  }
  if (closed.length) say(spaced(`已關閉開着的${openName(closed)}（舊版程式）；下次打開便是現在的版本。`));
  if (unverified.length) say(spaced(`${openName(unverified)}正在開着，系統未能安全關閉；請重新開機，下次打開便是現在的版本。`));
  return unverified.length === 0;
}

/* ---------- 還原上一個版本 ---------- */
if (ROLLBACK) {
  const backups = fs.readdirSync(target, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('.backup-'))
    .map(e => ({ dir: path.join(target, e.name), at: fs.statSync(path.join(target, e.name)).mtimeMs })).sort((a, b) => b.at - a.at);
  if (!backups.length) { say('沒有可以還原的備份。今次沒有改動任何檔案。'); tech(`安裝資料夾：${target}；找不到 .backup-<版本> 資料夾。`); process.exit(1); }
  const backup = backups[0].dir, bVersion = readVersion(backup) || path.basename(backup).replace(/^\.backup-/, ''), cur = readVersion(target) || '未知';
  const bFiles = listInstall(backup);
  if (!bFiles.includes('ask.mjs')) { say('備份不完整，不能還原。今次沒有改動任何檔案。'); tech(`備份位置：${backup}；缺少 ask.mjs。`); process.exit(1); }
  if (!APPLY) {
    say(`將把 CrewZero 還原到版本 ${bVersion}；現時版本 ${cur} 的程式會被取代，公司資料不會改動。`);
    tech(`備份位置：${backup}；程式檔數量：${bFiles.length}；公司資料：${DATA}`);
    if (servers.length) say(spaced(`${openName(servers)}目前開着（沒有工作進行中）：還原後會把它關閉，下次打開便是還原後的版本。`));
    process.exit(3);
  }
  const release = takeRunLock();
  if (!release) { say('Zero 工作進行中，完成後再試。今次沒有改動任何檔案。'); process.exit(4); }
  let bad = [];
  try {
    const known = [...Object.keys(parseManifest(fs.existsSync(path.join(target, 'MANIFEST.sha256')) ? fs.readFileSync(path.join(target, 'MANIFEST.sha256'), 'utf8') : '')), ...GENERATED];
    bad = restoreFrom(backup, target, known);
  } catch (e) { bad = ['還原時出錯']; tech(e && e.message || e); }
  finally { release(); }
  if (bad.length) { say('還原未完成：電腦未能完成檔案更換。備份仍然保留，公司資料沒有改動；請重新開機後，再說一次「還原上一個版本」。'); tech(bad.slice(0, 5).join('、') + '；備份位置：' + backup); process.exit(1); }
  closeServers();
  say(`已還原 CrewZero 到版本 ${bVersion}，公司資料沒有改動。`);
  tech(`已逐一核對 ${bFiles.length} 個程式檔；備份位置：${backup}；公司資料：${DATA}`);
  say(`下一步：打開 Founder Desk（${CMD('desk')}）。`);
  process.exit(0);
}

/* ---------- 更新 ---------- */
const oldVersion = readVersion(target), newVersion = pluginVersion(ROOT);
if (!newVersion) { say('CrewZero 插件檔案不完整，今次沒有改動任何檔案。請重新安裝 CrewZero 插件，然後再更新一次。'); process.exit(1); }
const files = programFiles(ROOT, [...INSTALL_SKIP, 'MANIFEST.sha256']);
const lines = manifestOf(ROOT, files), want = parseManifest(lines.join('\n'));
// 插件附帶嘅清單（build-plugin.mjs 生成）要同程式檔一致，否則插件已損壞；清單會列開發用檔（INSTALL_SKIP，例如 開始.cmd），嗰啲本來就唔安裝，唔算不符
if (fs.existsSync(path.join(ROOT, 'MANIFEST.sha256'))) {
  const m = parseManifest(fs.readFileSync(path.join(ROOT, 'MANIFEST.sha256'), 'utf8'));
  const off = [...files.filter(f => m[f] !== want[f]), ...Object.keys(m).filter(f => !want[f] && !INSTALL_SKIP.includes(f))];
  if (off.length) { say('CrewZero 插件檔案不完整，今次沒有改動任何檔案。請重新安裝 CrewZero 插件，然後再更新一次。'); tech(`插件附帶的程式檔與清單不符：${off.length} 個，例如 ${off[0]}`); process.exit(1); }
}
const oldManifest = parseManifest(fs.existsSync(path.join(target, 'MANIFEST.sha256')) ? fs.readFileSync(path.join(target, 'MANIFEST.sha256'), 'utf8') : '');
// 新版已經冇嘅舊程式檔：只刪舊清單列明嘅（創辦人自己放入嘅檔唔喺清單，唔會刪）；舊安裝冇清單就一個都唔刪
const stale = Object.keys(oldManifest).filter(f => !want[f] && !GENERATED.includes(f) && !f.startsWith('data/') && fs.existsSync(at(target, f)));
const changed = files.filter(f => shaOr(at(target, f)) !== want[f]);
const cmp = compareVersions(oldVersion, newVersion);
if (cmp > 0) { say(`已安裝的版本 ${oldVersion} 比插件的版本 ${newVersion} 新，不會改成舊版。今次沒有改動任何檔案。`); process.exit(1); }
if (cmp === 0) {
  say(`CrewZero 已與目前的插件版本（${newVersion}）相同。公司資料沒有改動。`);
  if (changed.length + stale.length) tech(`有 ${changed.length + stale.length} 個程式檔與插件不同但版本號相同。`);
  process.exit(0);
}
const oldLabel = oldVersion || '未知';
let backup = path.join(target, '.backup-' + oldLabel);
for (let i = 2; fs.existsSync(backup); i++) backup = path.join(target, `.backup-${oldLabel}-${i}`);
if (!APPLY) {
  tech(`程式檔數量：${changed.length + stale.length}；備份位置：${backup}`);
  say(`將把 CrewZero 由版本 ${oldLabel} 更新至 ${newVersion}；舊版會先備份，公司資料不會改動。好嗎？`);
  if (servers.length) say(spaced(`${openName(servers)}目前開着（沒有工作進行中）：更新後會把它關閉，下次打開便是新版。`));
  process.exit(3);
}

const release = takeRunLock();
if (!release) { say('Zero 工作進行中，完成後再試。今次沒有改動任何檔案。'); process.exit(4); }
// 暫存資料夾名沿用舊前綴
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
  // 創辦人會經 AI 聽到呢度嘅句：只講原因同做法；錯誤原文（英文、路徑）只寫去 stderr 供 AI 排查
  const why = plainCause(e);
  tech(e && e.message || String(e));
  if (touched) {
    let bad = [];
    try { bad = restoreFrom(backup, target, stageFiles); } catch (e2) { bad = ['還原時出錯']; tech(e2 && e2.message || e2); }
    if (bad.length) { say(`更新未完成，而且未能完全還原；備份仍然保留，公司資料沒有改動。請說「還原上一個版本」再試。原因：${why}`); tech('與備份不符：' + bad.slice(0, 5).join('、') + '；備份位置：' + backup); }
    else { try { fs.rmSync(backup, { recursive: true, force: true }); } catch { } say(`更新未完成，已還原到原本版本，公司資料沒有改動。原因：${why}`); }
  } else {
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch { }
    say(`更新未完成，項目沒有任何改動。原因：${why}`);
  }
  try { fs.rmSync(stage, { recursive: true, force: true }); } catch { }
  release();
  process.exit(1);
}
try { fs.rmSync(stage, { recursive: true, force: true }); } catch { }
release();
closeServers();
say(`CrewZero 已更新至版本 ${newVersion}，公司資料沒有改動。`);
tech(`備份位置：${backup}；程式檔數量：${stageFiles.length}`);
say('以後在 AI 對話說「打開 Founder Desk」，便可再次打開。');
say('如新版有問題，在 AI 對話說「還原上一個版本」。');
