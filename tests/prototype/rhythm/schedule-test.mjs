// 伺服器每日開工授權與登入啟動：全部經 SOS_SCHED_CMD 假程式，唔會登記真排程。
// 用法：node schedule-test.mjs <chrome-unused> <輸出> <原型> <假AI> <port-unused>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, OUT, PROTO, FAKE] = process.argv.slice(2);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const read = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'schedule-calls.jsonl');
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^SOS_/.test(key)));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = { ...clean, SOS_ADAPTER: FAKE, SOS_SCHED_CMD: path.join(HERE, '..', 'lib', 'fake-schtasks.mjs'), SOS_SCHED_LOG: LOG };
const calls = () => { try { return fs.readFileSync(LOG, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x)); } catch { return []; } };
try {
  const proj = path.join(OUT, 'project'); fs.mkdirSync(proj, { recursive: true });
  const installed = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), proj], { encoding: 'utf8', env });
  const root = path.join(proj, 'crewzero'), schedule = path.join(root, 'adapters', 'scheduler', 'install-schedule.mjs');
  const markFile = path.join(root, 'data', 'ledger', 'schedule.json'), stateFile = path.join(root, 'data', 'ledger', 'state.json');
  const run = (args, more = {}) => spawnSync(process.execPath, [schedule, ...args], { cwd: root, encoding: 'utf8', env: { ...env, ...more } });

  const explain = run([]);
  ok('未批准時只印說明，不寫授權標記，並說明登入啟動要另行同意', explain.status === 0 && /尚未開啟/.test(explain.stdout) && /目前不會設定/.test(explain.stdout) && !fs.existsSync(markFile), explain.stdout);

  const daily = run(['--register']);
  const mark = read(markFile);
  ok('批准每日開工只寫 server 授權標記，全新安裝完全不碰系統排程', daily.status === 0 && mark && mark.mode === 'server' && mark.cadence === 'daily' && mark.runTime === '21:00' && mark.approvedAt && mark.autostart && mark.autostart.enabled === false && calls().length === 0, { out: daily.stdout, mark, calls: calls() });

  const status0 = run(['--status']), json0 = JSON.parse(status0.stdout.split(/\r?\n/)[0]);
  ok('狀態第一行有 mode、登入啟動、帳本上次結果和下次時間', status0.status === 0 && json0.ok === true && json0.mode === 'server' && json0.autostart.enabled === false && json0.lastRun === null && !!json0.next, status0.stdout);

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ runs: [{ trigger: 'schedule', slot: '2030-01-01', startedAt: '2030-01-01T21:00:00+00:00', state: 'skipped', skipReason: 'intakeNotComplete' }] }, null, 2));
  const ranBlocked = () => { fs.writeFileSync(stateFile, JSON.stringify({ runs: [{ trigger: 'schedule', slot: '2030-01-01', startedAt: '2030-01-01T21:00:00+00:00', state: 'ended', ending: 'blocked', rejected: true }] }, null, 2)); return run(['--status']); };
  const blocked = ranBlocked();
  ok('工作未完成：不可說完成，JSON 保留原因欄位', /未完成/.test(blocked.stdout) && !/實際結果：完成/.test(blocked.stdout) && JSON.parse(blocked.stdout.split(/\r?\n/)[0]).lastRun.rejected === true, blocked.stdout);
  fs.writeFileSync(stateFile, JSON.stringify({ runs: [{ trigger: 'schedule', slot: '2030-01-01', startedAt: '2030-01-01T21:00:00+00:00', state: 'skipped', skipReason: 'intakeNotComplete' }] }, null, 2));
  const statusSkip = run(['--status']), jsonSkip = JSON.parse(statusSkip.stdout.split(/\r?\n/)[0]);
  ok('狀態按帳本如實說明跳過原因，不用作業系統結果碼冒充已執行', jsonSkip.lastRun && jsonSkip.lastRun.skipReason === 'intakeNotComplete' && /跳過：公司概覽未問齊/.test(statusSkip.stdout.split(/\r?\n/)[1] || ''), statusSkip.stdout);

  const startCmd = path.join(root, 'start-crewzero.cmd'), win = run(['--register', '--autostart']);
  const winCall = calls().map(a => a.at(-1)).find(x => /New-ScheduledTaskTrigger -AtLogOn/.test(x)) || '';
  const winMark = read(markFile);
  ok('Windows 登入啟動用 AtLogOn、IgnoreNew、5 分鐘上限和 start-crewzero.cmd', win.status === 0 && fs.existsSync(startCmd) && winMark.autostart.enabled && /New-ScheduledTaskTrigger -AtLogOn -User/.test(winCall) && /-MultipleInstances IgnoreNew/.test(winCall) && /New-TimeSpan -Minutes 5/.test(winCall) && winCall.includes(startCmd), winCall);

  const startSh = path.join(root, 'start-crewzero.sh');
  fs.writeFileSync(startSh, '#!/bin/sh\n');
  const macHome = path.join(OUT, 'mac-home'), mac = run(['--register', '--autostart', '--os', 'mac'], { HOME: macHome });
  const macMark = read(markFile), macPlist = path.join(macHome, 'Library', 'LaunchAgents', macMark.autostart.name + '.plist');
  ok('macOS 寫 LaunchAgent，bootstrap 後 print 讀回', mac.status === 0 && fs.existsSync(macPlist) && /RunAtLoad/.test(fs.readFileSync(macPlist, 'utf8')) && calls().some(a => a[0] === 'launchctl' && a.includes('bootstrap')) && calls().some(a => a[0] === 'launchctl' && a.includes('print')), { out: mac.stdout, calls: calls() });
  const macRemove = run(['--remove', '--os', 'mac'], { HOME: macHome });
  ok('macOS 移除同時移除標記及 LaunchAgent', macRemove.status === 0 && !fs.existsSync(markFile) && !fs.existsSync(macPlist), macRemove.stdout);

  const linuxHome = path.join(OUT, 'linux-home'), linux = run(['--register', '--autostart', '--os', 'linux'], { HOME: linuxHome });
  const linuxMark = read(markFile), desktop = path.join(linuxHome, '.config', 'autostart', linuxMark.autostart.name + '.desktop');
  ok('Linux 寫 desktop autostart 檔', linux.status === 0 && fs.existsSync(desktop) && /X-GNOME-Autostart-enabled=true/.test(fs.readFileSync(desktop, 'utf8')), linux.stdout);
  ok('Linux 移除清走登入啟動與標記', run(['--remove', '--os', 'linux'], { HOME: linuxHome }).status === 0 && !fs.existsSync(desktop) && !fs.existsSync(markFile));

  // 登入啟動移唔走：計時器即刻停，保留標記；重新登記先再清一次，清唔走就唔啟用
  run(['--register', '--autostart']);
  const stopFail = run(['--remove'], { SOS_SCHED_FAIL: '1' }), stopped = read(markFile);
  ok('移除失敗：計時器停用但保留標記，以失敗結束', stopFail.status === 1 && stopped && stopped.mode === 'stopped' && /已停用/.test(stopFail.stdout), stopFail.stdout);
  const stoppedStatus = run(['--status']);
  ok('已停用狀態如實說明，冇下次時間', stoppedStatus.status === 0 && JSON.parse(stoppedStatus.stdout.split(/\r?\n/)[0]).mode === 'stopped' && JSON.parse(stoppedStatus.stdout.split(/\r?\n/)[0]).next === '' && JSON.parse(stoppedStatus.stdout.split(/\r?\n/)[0]).cleanupPending === true && /尚未完全移除/.test(stoppedStatus.stdout), stoppedStatus.stdout);
  const reFail = run(['--register'], { SOS_SCHED_FAIL: '1' });
  ok('重新登記先清殘留：清唔走唔啟用', reFail.status === 1 && read(markFile).mode === 'stopped', reFail.stdout);
  const reOk = run(['--register']);
  ok('清走之後先啟用', reOk.status === 0 && read(markFile).mode === 'server', reOk.stdout);
  run(['--remove']);
  // 真 PowerShell 語義：cmdlet 用替身，驗證移除腳本點分「確實冇」同「查唔到」（唔碰任何排程）
  if (process.platform === 'win32') {
    const src = fs.readFileSync(schedule, 'utf8'), script = (/if \(op === 'remove'\) return `([^`]*)`;/.exec(src) || [])[1].replaceAll('${q(NAME)}', 'crewzero-probe');
    const stub = (body, name) => 'function ' + name + ' { [CmdletBinding()] param($TaskName, [switch]$Confirm) ' + body + ' }';
    const gone = "Write-Error -Category ObjectNotFound -Message 'none'", denied = "Write-Error -Category PermissionDenied -Message 'denied'", exists = "[pscustomobject]@{ TaskName = $TaskName }", fine = '$null';
    const ps = (un, get) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', stub(un, 'Unregister-ScheduledTask') + '; ' + stub(get, 'Get-ScheduledTask') + '; ' + script], { encoding: 'utf8', windowsHide: true });
    const removed = r => r.status === 0 && /"removed":true/.test(r.stdout);
    // 指令根本載入唔到：唔可以當工作不存在
    const noCmd = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', "$PSModuleAutoLoadingPreference = 'None'; " + script], { encoding: 'utf8', windowsHide: true });
    const cases = { 指令不可用: !removed(noCmd), 移除成功查回冇: removed(ps(fine, gone)), 本來就冇: removed(ps(gone, gone)), 移除被拒: !removed(ps(denied, gone)), 查回被拒: !removed(ps(fine, denied)), 仍然存在: !removed(ps(fine, exists)) };
    ok('移除腳本：只有確實冇先算成功', Object.values(cases).every(Boolean), cases);
  }
  fs.writeFileSync(markFile, JSON.stringify({ name: 'crewzero-old', os: 'windows', cadence: 'daily', runTime: '21:00' }, null, 2));
  const legacyRefused = run(['--register'], { SOS_SCHED_FAIL: '1' }), legacyStill = read(markFile);
  ok('舊排程移除失敗：不啟用新計時器，原標記保留，以失敗結束', legacyRefused.status === 1 && /未能切換/.test(legacyRefused.stdout) && legacyStill && !legacyStill.mode && legacyStill.name === 'crewzero-old', legacyRefused.stdout);
  const gone = run(['--status'], { SOS_SCHED_QUERY: 'not-found' }), goneJson = JSON.parse(gone.stdout.split(/\r?\n/)[0]);
  ok('舊工作已不存在：如實說已失效，不說仍運作', gone.status === 0 && goneJson.registered === false && /已失效/.test(gone.stdout) && !/仍運作/.test(gone.stdout), gone.stdout);
  fs.writeFileSync(LOG + '.state', JSON.stringify({ registered: true }));
  const legacy = run(['--status']), legacyJson = JSON.parse(legacy.stdout.split(/\r?\n/)[0]);
  const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href + '?schedule=' + Date.now());
  const dirs = { data: path.join(root, 'data'), ledger: path.join(root, 'data', 'ledger'), company: path.join(root, 'data', 'company'), asks: path.join(root, 'data', 'asks'), inbox: path.join(root, 'data', 'founder', 'inbox'), replies: path.join(root, 'data', 'founder', 'replies') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const view = dash.dashboardState(dirs, { now: new Date() });
  const html = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8'), names = fs.readFileSync(path.join(PROTO, 'names.js'), 'utf8');
  ok('舊格式不自動遷移：狀態、系統資料和待決卡都明說舊式仍運作', legacy.status === 0 && legacyJson.mode === 'os' && view.rhythmInfo.scheduler === 'os' && view.todo.some(x => x.id === 'schedule-legacy') && /schedLegacy/.test(html) && /舊式排程仍運作中/.test(names), { out: legacy.stdout, todo: view.todo });

  const viewOf = st => dash.dashboardState(dirs, { now: new Date(), schedStatus: st }).rhythmInfo;
  // 舊標記保留舊時間 nextRunAt：都唔可以繞過
  fs.writeFileSync(markFile, JSON.stringify({ name: 'crewzero-old', os: 'windows', cadence: 'daily', runTime: '09:00', nextRunAt: '2030-01-05T09:00:00.000Z' }, null, 2));
  const live = viewOf({ ok: true, registered: true }), lost = viewOf({ ok: true, registered: false }), unknown = viewOf({ ok: false, registered: false }), none = viewOf(null);
  ok('舊式工作：一律唔講下次時間；查到存在、已失效、查唔到分開顯示', live.nextRunAt === '' && live.os.confirmed === true && lost.nextRunAt === '' && lost.os.missing === true && unknown.nextRunAt === '' && unknown.os.confirmed === false && none.nextRunAt === '' && none.os.confirmed === false && /schedLegacyUnknown/.test(html), { live, lost, unknown });
  fs.writeFileSync(markFile, JSON.stringify({ mode: 'stopped', autostart: { enabled: true, os: 'windows', name: 'crewzero-old' }, stoppedAt: '2030-01-01T00:00:00.000Z' }, null, 2));
  const stoppedView = dash.dashboardState(dirs, { now: new Date() });
  ok('登入啟動待清理：監察台同待決卡都講，冇下次時間', stoppedView.rhythmInfo.cleanupPending === true && stoppedView.rhythmInfo.nextRunAt === '' && stoppedView.todo.some(x => x.id === 'schedule-cleanup') && /schedCleanupPending/.test(html), stoppedView.rhythmInfo);
  fs.writeFileSync(markFile, JSON.stringify({ name: 'crewzero-old', os: 'windows', cadence: 'daily', runTime: '21:00' }, null, 2));
  fs.writeFileSync(stateFile, JSON.stringify({ runs: [{ trigger: 'schedule', slot: '2030-01-01', startedAt: '2030-01-01T21:00:00+00:00', state: 'ended', ending: 'blocked', rejected: true, rejectReason: 'adapter failed' }] }, null, 2));
  const failedRun = viewOf(null).lastSchedule;
  ok('工作失敗：監察台資料帶齊原因，頁面唔可以顯示完成', failedRun.rejected === true && failedRun.rejectReason === 'adapter failed' && /runUnfinished/.test(html), failedRun);

  const removed = run(['--remove']);
  ok('移除會清走舊格式標記及同名 Windows 工作', removed.status === 0 && !fs.existsSync(markFile) && calls().some(a => /Unregister-ScheduledTask/.test(a.at(-1))), removed.stdout);
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
}
const passed = results.filter(x => x.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info).slice(0, 1200)));
console.log('\n' + passed + '/' + results.length + ' passed');
process.exit(passed === results.length ? 0 : 1);
