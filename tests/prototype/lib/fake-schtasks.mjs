// 測試用假排程器：代替 powershell.exe，只記錄參數（SOS_SCHED_LOG，每行一個 JSON 陣列），唔郁電腦上任何排程。
// 登記後記住「已登記」（同名 .state 檔），讀回時交返下次執行時間；SOS_SCHED_LAST 可以設上次執行時間（ISO）。
import fs from 'node:fs';
const args = process.argv.slice(2), script = args[args.length - 1] || '';
const LOG = process.env.SOS_SCHED_LOG, STATE = LOG ? LOG + '.state' : '';
if (LOG) fs.appendFileSync(LOG, JSON.stringify(args) + '\n');
const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
const at = (script.match(/-At '(\d{2}):(\d{2})'/) || []).slice(1).map(Number);
function nextAt() { const d = new Date(); d.setHours(at[0] ?? 21, at[1] ?? 0, 0, 0); if (d <= new Date()) d.setDate(d.getDate() + 1); return d.toISOString(); }
if (process.env.SOS_SCHED_FAIL === '1') { console.error('假排程器：登記失敗（測試）'); process.exit(1); }
if (/Unregister-ScheduledTask/.test(script)) { if (STATE) fs.rmSync(STATE, { force: true }); console.log('{"removed":true}'); process.exit(0); }
if (/Register-ScheduledTask/.test(script)) { const s = { registered: true, next: nextAt(), startWhenAvailable: /-StartWhenAvailable/.test(script) }; if (STATE) fs.writeFileSync(STATE, JSON.stringify(s)); }
const s = read();
const last = process.env.SOS_SCHED_LAST || '', lastResult = last ? Number(process.env.SOS_SCHED_LAST_RESULT || 0) : 267011;
console.log(JSON.stringify(s ? { ...s, last, lastResult } : { registered: false }));
