// 同時開幾個伺服器（同一個資料夾）：只可以留低一個；排隊紀錄殘留都要開得返
// 用法：node race.mjs <原型資料夾> <輸出資料夾> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
const [PROTO, OUT, PORT] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
freshTestOut(OUT);
const DATA = path.join(OUT, 'data');
const env = { ...process.env, SOS_DATA: DATA };
function start() {
  const p = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', d => { p.log += d; }); p.stderr.on('data', d => { p.log += d; });
  p.exited = false; p.on('exit', () => { p.exited = true; }); return p;
}
async function servers() {
  const out = [];
  for (let p = Number(PORT); p < Number(PORT) + 10; p++) { try { const j = await (await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(600) })).json(); out.push({ port: p, pid: j.pid }); } catch { } }
  return out;
}
// 1. 三個同時開
const ps = [start(), start(), start()];
await sleep(9000);
const alive = ps.filter(p => !p.exited);
const sv = await servers();
ok('同時開三個：只剩一個程序', alive.length === 1, ps.map(p => p.log.trim()).join(' || '));
ok('同時開三個：只有一個埠回應', sv.length === 1, sv);
ok('其餘兩個講「已在運行」', ps.filter(p => /已在運行/.test(p.log)).length === 2);
ok('開機排隊紀錄已清走', !fs.existsSync(path.join(DATA, 'ledger', 'server-start.lock')));
for (const p of ps) try { p.kill(); } catch { }
await sleep(800);
// 2. 排隊紀錄殘留（程序已經死咗）：照開
fs.writeFileSync(path.join(DATA, 'ledger', 'server-start.lock'), '999999');
const q = start(); await sleep(4000);
ok('殘留排隊紀錄：照開到', !q.exited && /已開：/.test(q.log), q.log);
try { q.kill(); } catch { }
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
setTimeout(() => process.exit(0), 500);
