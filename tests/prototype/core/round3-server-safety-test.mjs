// R3 反例：舊 /api/status 可以謊報 PID；換版前必須由作業系統核對埠擁有者，不能終止無關程序。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { seedCompany } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT] = process.argv.slice(2);
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitExit = child => new Promise(resolve => { const timer = setTimeout(() => resolve(false), 5000); child.once('exit', () => { clearTimeout(timer); resolve(true); }); });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data'); seedCompany(DATA, PROTO);
let mock = null, waiter = null, candidate = null;
try {
  const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
  waiter = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  mock = http.createServer((req, res) => {
    if (req.url === '/api/health') { res.writeHead(405); return res.end(); }
    if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ root: ask.rootId(DATA), busy: false, pid: waiter.pid })); }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => { mock.once('error', reject); mock.listen(Number(PORT), '127.0.0.1', resolve); });
  candidate = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = await waitExit(candidate);
  let alive = false; try { process.kill(waiter.pid, 0); alive = true; } catch { }
  ok('舊協定冒充別的 PID：新伺服器停止換版，無關等待程序仍在', exited && alive, { exited, alive });
  await new Promise(resolve => mock.close(resolve)); mock = null;
  const replies = path.join(DATA, 'founder', 'replies'); fs.mkdirSync(replies, { recursive: true });
  fs.writeFileSync(path.join(replies, 'duplicate-via.md'), 'kind: proofread\nvia: device:deadbeef\nVIA: browser:aaaaaa\n\n```json\n{}\n```\n');
  const runner = spawn(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
  const runExited = await waitExit(runner);
  const status = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'status.json'), 'utf8'));
  const last = (status.runs || []).at(-1) || {};
  ok('下游 run.mjs 遇重複 via 會拒絕，未寫入可採用的決定紀錄', runExited && last.state === 'failed' && /來源重複/.test(last.error || ''), last);
  const updateSource = fs.readFileSync(path.join(PROTO, 'update.mjs'), 'utf8');
  ok('更新程式同樣先核對埠擁有者，未核對即停止換版', /function ownsServerPort/.test(updateSource) && /無法獨立核對開着的 Founder Desk 程序身份/.test(updateSource), true);
} catch (e) {
  ok('測試程式出錯', false, String(e?.stack || e));
} finally {
  try { candidate?.kill(); } catch { }
  try { mock?.close(); } catch { }
  try { waiter?.kill(); } catch { }
  await wait(200);
}
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info ?? null).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
