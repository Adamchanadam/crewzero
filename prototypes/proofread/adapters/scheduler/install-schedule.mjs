// CrewZero 排程（規劃書 3.6、5.2 第 1 點；MVP 規格 2026-10-29 第 2 節第 3 項）：按公司紀錄嘅經營節奏，叫作業系統每日按時執行排程啟動檔。
// 用法：node install-schedule.mjs                印出排程定義全文（唔登記，等創辦人睇過先批准）
//       node install-schedule.mjs --register     登記（要創辦人批准）：帶「錯過排定時間後盡快補跑」同執行時限；登記後唯讀讀回下次執行時間，寫 data/ledger/schedule.json
//       node install-schedule.mjs --status       唯讀讀回：第一行係 JSON（是否已登記、下次、上次執行時間同結果碼），第二行係白話
//       node install-schedule.mjs --remove       刪除登記同標記
//       可加 --data <資料夾>（預設：環境變數 SOS_DATA，或者程式資料夾入面嘅 data/）
// 測試：環境變數 SOS_SCHED_CMD 指向一個假程式（node 腳本），就改為執行佢，唔郁電腦上任何排程。
// 所用命令名稱見同一資料夾嘅 README.md。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rhythmOf } from '../../rhythm-lib.mjs';

const PROTO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2), has = k => argv.includes('--' + k);
const arg = k => { const i = argv.indexOf('--' + k); return i >= 0 ? String(argv[i + 1] || '') : ''; };
const os = arg('os') || (process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux');
const data = path.resolve(arg('data') || process.env.SOS_DATA || path.join(PROTO, 'data'));
const MARK = path.join(data, 'ledger', 'schedule.json');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const state = readJSON(path.join(data, 'ledger', 'state.json')) || {};
const r = rhythmOf(state);
const [hh, mm] = r.runTime.split(':');
// 登記名帶安裝資料夾識別：兩個安裝唔會撞名。新登記用 crewzero-<識別>；改名前登記嘅舊名係 startup-os-<識別>：
// 安裝資料夾仲叫 startup-os/（舊版原位更新），或者登記標記寫住舊名，就沿用舊名，令「排程狀態」「移除排程」「重新登記」都對準同一個排程，唔會變成兩個。
export const taskName = (root, legacy = false) => (legacy ? 'startup-os-' : 'crewzero-') + crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 8);
const markNow = readJSON(MARK);
const NAME = taskName(PROTO, path.basename(PROTO).toLowerCase() === 'startup-os' || !!(markNow && markNow.name === taskName(PROTO, true)));
const launcher = path.join(PROTO, process.platform === 'win32' || os === 'windows' ? 'run-schedule.cmd' : 'run-schedule.sh');
const LIMIT = (Number(r.runCapMinutes) || 30) + 15;
const CADENCE = { daily: '每日', weekdays: '平日（星期一至五）', weekly: '每星期一次' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const say = s => console.log(s);
const q = s => String(s).replace(/'/g, "''");

// Windows 工作排程器（完整介面）：觸發、補跑、執行時限、唔准重疊
function winScript(op) {
  const status = `$x = Get-ScheduledTask -TaskName '${q(NAME)}' -ErrorAction SilentlyContinue; if (-not $x) { '{"registered":false}' } else { $i = Get-ScheduledTaskInfo -TaskName '${q(NAME)}'; [pscustomobject]@{ registered = $true; next = $(if ($i.NextRunTime) { $i.NextRunTime.ToString('o') } else { '' }); last = $(if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('o') } else { '' }); lastResult = $i.LastTaskResult; startWhenAvailable = [bool]$x.Settings.StartWhenAvailable } | ConvertTo-Json -Compress }`;
  if (op === 'status') return status;
  if (op === 'remove') return `Unregister-ScheduledTask -TaskName '${q(NAME)}' -Confirm:$false -ErrorAction SilentlyContinue; '{"removed":true}'`;
  const at = `'${hh}:${mm}'`;
  const trig = r.runCadence === 'weekdays' ? `New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At ${at}`
    : r.runCadence === 'weekly' ? `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${DAYS[Number(r.interviewWeekday) % 7]} -At ${at}` : `New-ScheduledTaskTrigger -Daily -At ${at}`;
  return [`$ErrorActionPreference = 'Stop'`,
    `$a = New-ScheduledTaskAction -Execute '${q(launcher)}' -WorkingDirectory '${q(PROTO)}'`,
    `$t = ${trig}`,
    `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes ${LIMIT}) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`,
    `Register-ScheduledTask -TaskName '${q(NAME)}' -Description 'CrewZero daily work' -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
    status].join('; ');
}
function runWin(op) {
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', winScript(op)];
  const fake = process.env.SOS_SCHED_CMD;
  const res = fake ? spawnSync(process.execPath, [fake, 'powershell.exe', ...args], { encoding: 'utf8', windowsHide: true })
    : spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  const out = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  let j = null; for (const l of out.slice().reverse()) { try { j = JSON.parse(l); break; } catch { } }
  return { ok: res.status === 0 && !!j, json: j, err: String(res.stderr || res.error || '').trim().slice(0, 400), args };
}
const local = iso => { if (!iso) return '未有'; const d = new Date(iso); if (isNaN(d)) return iso; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const human = `${CADENCE[r.runCadence] || '每日'} ${r.runTime}`;

if (os !== 'windows') {
  // MVP 只支援 Windows 登記；其他系統照舊只印定義，由人照住登記
  const node = process.execPath, cmd = `"${launcher}"`;
  if (has('register') || has('remove') || has('status')) { say('目前只支援在 Windows 電腦設定每日自動開工。在這部電腦，AI 會在你交答案或提出要求時工作；你亦可每日在 AI 對話說「打開 Founder Desk」。'); say('（以下技術定義只供 AI 參考，毋須交給創辦人。）'); }
  if (os === 'mac') say(`macOS launchd：每日 ${hh}:${mm} 執行 ${cmd}（Label ${NAME}）`);
  else say(`Linux cron（crontab 一行）：${Number(mm)} ${Number(hh)} * * ${r.runCadence === 'weekdays' ? '1-5' : r.runCadence === 'weekly' ? String(Number(r.interviewWeekday) % 7) : '*'} ${cmd}`);
  say('（執行環境：' + node + '）');
  process.exit(has('register') || has('remove') || has('status') ? 1 : 0);
}

if (has('status')) {
  const m = readJSON(MARK), x = runWin('status');
  const j = { marked: !!m, registered: !!(x.json && x.json.registered), next: (x.json && x.json.next) || '', last: (x.json && x.json.last) || '', lastResult: x.json && x.json.lastResult != null ? x.json.lastResult : null, startWhenAvailable: !!(x.json && x.json.startWhenAvailable), name: NAME, ok: x.ok };
  console.log(JSON.stringify(j));
  say(j.registered ? `已登記（${NAME}）：下次 ${local(j.next)}；上次執行 ${local(j.last)}${j.lastResult != null && j.last ? '（結果碼 ' + j.lastResult + '）' : ''}；錯過即補跑：${j.startWhenAvailable ? '開啟' : '關閉'}` : `未登記（${NAME}）${m ? '；但仲有登記標記，請重新登記或者移除' : ''}`);
  process.exit(0);
}
if (has('remove')) {
  const x = runWin('remove');
  fs.rmSync(MARK, { force: true });
  say(x.ok ? `已移除每日排程（${NAME}）；AI 只會在你提交答案或要求時開始工作。` : '每日排程未能完全移除：電腦拒絕了這項設定，CrewZero 已停用這個排程的紀錄。請重新開機後，再說一次「移除排程」。');
  if (!x.ok) console.error('（技術細節，只供 AI 排查，毋須交給創辦人）' + (x.err || '讀回時沒有結果'));
  process.exit(x.ok ? 0 : 1);
}
if (!fs.existsSync(launcher)) { say(`未有排程啟動檔：${launcher}。請先以安裝命令安裝 CrewZero。`); process.exit(1); }
if (has('register')) {
  const x = runWin('register');
  if (!x.ok || !x.json || !x.json.registered) {
    // 第一句交畀創辦人（原因同做法）；英文錯誤同命令全文只寫去 stderr 供 AI 排查，唔好叫創辦人自己執行
    say('每日排程未能登記：電腦拒絕了這項設定。安裝已完成，AI 仍會在你交答案或提出要求時工作；如要每日自動開工，請重新開機後再說「安裝排程」。');
    console.error('（技術細節，只供 AI 排查，毋須交給創辦人）' + (x.err || '讀回時找不到這個排程'));
    console.error(winScript('register'));
    process.exit(1);
  }
  const mark = { name: NAME, os: 'windows', cadence: r.runCadence, runTime: r.runTime, timezone: r.timezone, interviewWeekday: r.interviewWeekday, limitMinutes: LIMIT,
    registeredAt: new Date().toISOString(), nextRunAt: x.json.next || '', startWhenAvailable: !!x.json.startWhenAvailable, launcher, command: ['powershell.exe', ...x.args].join(' ') };
  fs.mkdirSync(path.dirname(MARK), { recursive: true });
  fs.writeFileSync(MARK, JSON.stringify(mark, null, 2));
  say(`已登記每日排程：${human}（${r.timezone}），下次 ${local(mark.nextRunAt)}。`);
  say(mark.startWhenAvailable ? '電腦當時關機或睡眠，會在下次可用時盡快補做；每次最多 ' + LIMIT + ' 分鐘。' : '注意：讀回「錯過即補跑」設定未開啟，請在系統頁核對。');
  say('登記名：' + NAME + '（Windows「工作排程器」入面見到）。要移除：在對話輸入「移除排程」。');
  process.exit(0);
}
// 預設：只印定義全文，等創辦人批准
say('【未登記：以下係將會登記嘅每日排程，你批准之後先登記】');
say(`經營節奏：${human}（${r.timezone}），每次最多 ${LIMIT} 分鐘；電腦當時關機或睡眠，會在下次可用時盡快補做${state.company && state.company.rhythm ? '' : '；公司紀錄未有節奏，用預設（交資料時可改）'}`);
say('登記名：' + NAME);
say('執行：' + launcher);
say('Windows 工作排程器（PowerShell）命令全文：');
say(winScript('register'));
