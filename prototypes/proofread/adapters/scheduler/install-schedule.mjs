// CrewZero 排程：每日開工由伺服器計時，作業系統只可選擇喺登入時開返伺服器。
// 用法：node install-schedule.mjs [--register] [--autostart] [--status] [--remove] [--data <資料夾>]
// 測試：SOS_SCHED_CMD 指向假程式，只記錄系統命令，唔會改電腦設定。
import fs from 'node:fs';
import path from 'node:path';
import osLib from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rhythmOf, nextRunAt } from '../../rhythm-lib.mjs';
import { rootId, BASE_PORT } from '../../ask-lib.mjs';

const PROTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2), has = k => argv.includes('--' + k);
const arg = k => { const i = argv.indexOf('--' + k); return i >= 0 ? String(argv[i + 1] || '') : ''; };
const platform = arg('os') || (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux');
const data = path.resolve(arg('data') || process.env.SOS_DATA || path.join(PROTO, 'data'));
const MARK = path.join(data, 'ledger', 'schedule.json');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const state = readJSON(path.join(data, 'ledger', 'state.json')) || {};
const r = rhythmOf(state);
const LIMIT = (Number(r.runCapMinutes) || 30) + 15;
const CADENCE = { daily: '每日', weekdays: '平日（星期一至五）', weekly: '每星期一次' };
const say = s => console.log(s);
const tech = s => console.error('（技術細節，只供 AI 排查，毋須交給創辦人）' + s);
const q = s => String(s).replace(/'/g, "''");
const local = d => { if (!d) return '未有'; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
export const taskName = (root, legacy = false) => (legacy ? 'startup-os-' : 'crewzero-') + crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 8);
const markNow = readJSON(MARK);
const oldName = markNow && (markNow.name || markNow.autostart && markNow.autostart.name);
const NAME = taskName(PROTO, path.basename(PROTO).toLowerCase() === 'startup-os' || oldName === taskName(PROTO, true));
const launcherFor = target => path.join(PROTO, target === 'windows' ? 'start-crewzero.cmd' : 'start-crewzero.sh');
const launcher = launcherFor(platform);
const home = process.env.HOME || osLib.homedir();
const plist = path.join(home, 'Library', 'LaunchAgents', NAME + '.plist');
const desktop = path.join(home, '.config', 'autostart', NAME + '.desktop');

function runNative(command, args) {
  const fake = process.env.SOS_SCHED_CMD;
  const res = fake ? spawnSync(process.execPath, [fake, command, ...args], { encoding: 'utf8', windowsHide: true })
    : spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  return { ok: res.status === 0, out: String(res.stdout || '').trim(), err: String(res.stderr || res.error || '').trim().slice(0, 400) };
}
function winScript(op) {
  const status = `$ErrorActionPreference = 'Stop'; try { $x = Get-ScheduledTask -TaskName '${q(NAME)}' -ErrorAction Stop; if (-not $x) { '{"registered":false}' } else { [pscustomobject]@{ registered = $true } | ConvertTo-Json -Compress } } catch { if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { '{"registered":false}' } else { throw } }`;
  if (op === 'status') return status;
  if (op === 'remove') return `Unregister-ScheduledTask -TaskName '${q(NAME)}' -Confirm:$false -ErrorAction SilentlyContinue; '{"removed":true}'`;
  return [`$ErrorActionPreference = 'Stop'`,
    `$a = New-ScheduledTaskAction -Execute '${q(launcher)}' -WorkingDirectory '${q(PROTO)}'`,
    `$t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"`,
    `$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)`,
    `Register-ScheduledTask -TaskName '${q(NAME)}' -Description 'CrewZero login start' -Action $a -Trigger $t -Settings $s -Force | Out-Null`, status].join('; ');
}
function runWin(op) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', winScript(op)];
  const x = runNative('powershell.exe', args), lines = x.out.split(/\r?\n/).filter(Boolean);
  let json = null; for (const line of lines.slice().reverse()) { try { json = JSON.parse(line); break; } catch { } }
  return { ...x, json, args, ok: x.ok && !!json };
}
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function macPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${NAME}</string><key>ProgramArguments</key><array><string>${xml(launcher)}</string></array><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(process.env.PATH || '')}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><false/></dict></plist>\n`;
}
function registerAutostart() {
  if (!fs.existsSync(launcher)) return { ok: false, registered: false, err: '找不到登入啟動檔' };
  if (platform === 'windows') { const x = runWin('register'); return { ok: x.ok && !!x.json.registered, registered: !!(x.json && x.json.registered), err: x.err, tech: `powershell.exe ${x.args.join(' ')}` }; }
  if (platform === 'mac') {
    fs.mkdirSync(path.dirname(plist), { recursive: true }); fs.writeFileSync(plist, macPlist());
    const uid = String(process.getuid ? process.getuid() : process.env.UID || 0);
    // 已載入時 bootstrap 會報錯；重新登記先撤舊嗰個
    runNative('launchctl', ['bootout', 'gui/' + uid + '/' + NAME]);
    const boot = runNative('launchctl', ['bootstrap', 'gui/' + uid, plist]);
    const check = boot.ok ? runNative('launchctl', ['print', 'gui/' + uid + '/' + NAME]) : boot;
    return { ok: boot.ok && check.ok, registered: boot.ok && check.ok, err: check.err || boot.err, tech: `launchctl bootstrap gui/${uid} ${plist}` };
  }
  fs.mkdirSync(path.dirname(desktop), { recursive: true });
  fs.writeFileSync(desktop, `[Desktop Entry]\nType=Application\nName=CrewZero\nExec=env "PATH=${process.env.PATH || ''}" "${launcher}"\nX-GNOME-Autostart-enabled=true\n`);
  return { ok: true, registered: true, tech: desktop };
}
function autostartStatus(mark) {
  if (!mark || !mark.autostart || !mark.autostart.enabled) return { enabled: false, registered: false };
  if (mark.autostart.os === 'windows') { const x = runWin('status'); return { enabled: true, registered: !!(x.ok && x.json && x.json.registered), ok: x.ok }; }
  if (mark.autostart.os === 'mac') {
    const uid = String(process.getuid ? process.getuid() : process.env.UID || 0), x = fs.existsSync(plist) ? runNative('launchctl', ['print', 'gui/' + uid + '/' + NAME]) : { ok: false };
    return { enabled: true, registered: !!(fs.existsSync(plist) && x.ok), ok: x.ok };
  }
  return { enabled: true, registered: fs.existsSync(desktop), ok: true };
}
function removeAutostart() {
  if (platform === 'windows') return runWin('remove');
  if (platform === 'mac') { const uid = String(process.getuid ? process.getuid() : process.env.UID || 0); if (fs.existsSync(plist)) runNative('launchctl', ['bootout', 'gui/' + uid + '/' + NAME]); fs.rmSync(plist, { force: true }); return { ok: !fs.existsSync(plist) }; }
  fs.rmSync(desktop, { force: true }); return { ok: !fs.existsSync(desktop) };
}
function lastRun() {
  return (state.runs || []).filter(x => x && x.trigger === 'schedule').sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))).pop() || null;
}
function skipText(reason) {
  return ({ intakeNotComplete: '公司概覽未問齊', pausedByFounder: '已按創辦人指示暫停', autoStopped: 'AI 已暫停', budgetExhausted: '今日 AI 次數已用完', adapterNotCertified: 'AI 未設定', adapterVersionChanged: 'AI 工具已更新，須重新認證', alreadyRan: '今日已做過' })[reason] || reason || '';
}
function statusLine(last) {
  if (!last) return '未有';
  if (last.state === 'skipped') return '跳過：' + skipText(last.skipReason);
  return last.state === 'ended' ? '完成' : last.state || '未有';
}
function serverMark(autostart) {
  return { mode: 'server', cadence: r.runCadence, runTime: r.runTime, timezone: r.timezone, interviewWeekday: r.interviewWeekday, limitMinutes: LIMIT, approvedAt: new Date().toISOString(), autostart: { enabled: !!autostart.enabled, os: platform, name: NAME } };
}
async function serverOpen() {
  for (let port = BASE_PORT; port < BASE_PORT + 10; port++) { try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(300) }), body = response.ok ? await response.json() : null; if (body && body.root === rootId(data)) return true; } catch { } }
  return false;
}

if (has('status')) {
  const mark = readJSON(MARK), last = lastRun(), next = nextRunAt(r, new Date());
  if (mark && mark.mode !== 'server') {
    const x = platform === 'windows' ? runWin('status') : { ok: true, json: { registered: false } };
    const j = { ok: !!x.ok, mode: 'os', autostart: { enabled: false, registered: false }, lastRun: last ? { at: last.startedAt || '', state: last.state || '', skipReason: last.skipReason || '' } : null, next: next ? next.toISOString() : '' };
    console.log(JSON.stringify(j)); say(x.ok ? '舊式排程仍運作中；請在 AI 對話說「重新登記排程」。' : '暫時未能讀取舊式排程的狀態，請稍後再試。'); process.exit(x.ok ? 0 : 1);
  }
  const auto = autostartStatus(mark), j = { ok: auto.ok !== false, mode: mark && mark.mode || 'none', autostart: auto, lastRun: last ? { at: last.startedAt || '', state: last.state || '', skipReason: last.skipReason || '' } : null, next: mark && mark.mode === 'server' && next ? next.toISOString() : '' };
  console.log(JSON.stringify(j));
  if (!j.ok) say('暫時未能讀取登入啟動的狀態，請稍後再試。');
  else if (j.mode !== 'server') say('每日自動開工未開啟。');
  else say(`每日自動開工已開啟：下次 ${local(next)}；上次實際結果：${statusLine(last)}。${auto.enabled ? (auto.registered ? '登入啟動已開啟。' : '登入啟動尚未成功。') : '登入啟動未開啟。'}`);
  process.exit(j.ok ? 0 : 1);
}
if (has('remove')) {
  const x = removeAutostart(); fs.rmSync(MARK, { force: true });
  say(x.ok ? '已移除每日自動開工及登入啟動；AI 只會在你提交答案或要求時開始工作。' : '每日自動開工已停用；登入啟動未能完全移除，請重新開機後再說一次「移除排程」。');
  process.exit(x.ok ? 0 : 1);
}
if (has('register')) {
  // 舊式每日工作同新登入工作共用登記名；先移走舊設定，無論有冇揀登入自啟都唔留兩套。
  if (platform === 'windows') runWin('remove');
  let auto = { enabled: false }, x = null;
  if (has('autostart')) { x = registerAutostart(); auto = { enabled: !!x.ok }; }
  const mark = serverMark(auto); fs.mkdirSync(path.dirname(MARK), { recursive: true }); fs.writeFileSync(MARK, JSON.stringify(mark, null, 2));
  const live = await serverOpen();
  say(live ? `每日自動開工已生效：${CADENCE[r.runCadence] || '每日'} ${r.runTime}。` : `每日自動開工已批准：打開 Founder Desk 一次後開始生效（${CADENCE[r.runCadence] || '每日'} ${r.runTime}）。`);
  if (has('autostart')) say(x && x.ok ? '登入電腦時會自動打開 CrewZero。' : '每日自動開工已保留；登入啟動未能設定，電腦重開後請打開一次 Founder Desk 才會恢復。');
  else say('登入啟動未開啟；電腦重開後，請打開一次 Founder Desk 才會恢復。');
  if (x && x.tech) tech(x.tech + (x.err ? '\n結果：' + x.err : ''));
  process.exit(0);
}

say('每日自動開工尚未開啟。');
say(`批准後，CrewZero 伺服器會於${CADENCE[r.runCadence] || '每日'} ${r.runTime}開工；伺服器必須開着，錯過後只會在 6 小時內補做一次。`);
say('登入電腦時自動打開 CrewZero 是另一項可選設定；批准每日開工不代表批准登入啟動。');
