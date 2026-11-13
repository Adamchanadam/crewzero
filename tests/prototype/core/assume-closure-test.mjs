// 確認現況假設題的收起與取回；只使用隔離的模擬資料。
// 用法：node assume-closure-test.mjs <原型資料夾> <新輸出資料夾> <埠> <假 adapter>
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertTestOut } from '../lib/out-guard.mjs';
import { oldInstall } from '../fixtures/old-install.mjs';
import { usePass } from '../lib/testkit.mjs';

const [proto, output, port, adapter] = process.argv.slice(2);
if (!proto || !output || !adapter || !/^\d+$/.test(port || '') || +port < 1 || +port > 65535) throw new Error('參數不足或埠無效');
const out = assertTestOut(output);
if (fs.existsSync(out)) throw new Error('需要新輸出資料夾');
fs.mkdirSync(out, { recursive: true });
const ask = await import(pathToFileURL(path.join(proto, 'ask-lib.mjs')).href);
const results = [], ok = (name, pass) => { results.push(!!pass); console.log((pass ? 'PASS ' : 'FAIL ') + name); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const add = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function world(name) {
  const data = path.join(out, name, 'data'); oldInstall(data, proto);
  fs.mkdirSync(path.join(data, 'founder', 'desk'), { recursive: true });
  const clock = d => fs.writeFileSync(path.join(data, 'founder', 'desk', 'sim-clock.json'), JSON.stringify({ offsetMs: Date.parse(d + 'T12:00:00') - Date.now(), at: new Date().toISOString() }));
  const options = { ...process.env, SOS_SIM: '1', SOS_DATA: data, SOS_ADAPTER: adapter, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', SOS_FACT_MERGE: '1' };
  const shell = (...args) => { const r = spawnSync(process.execPath, [path.join(proto, 'run.mjs'), ...args], { cwd: proto, env: options, encoding: 'utf8', timeout: 120000, windowsHide: true }); if (r.status !== 0) throw new Error('外殼失敗：' + String(r.stderr).slice(-1000)); };
  const state = () => read(path.join(data, 'ledger', 'state.json'));
  const packs = () => fs.readdirSync(path.join(data, 'asks')).filter(f => f.endsWith('.json')).map(f => read(path.join(data, 'asks', f))).filter(p => p.rhythm?.kind === 'interview');
  clock('2026-11-02'); shell('--type', 'rhythm', '--trigger', 'manual');
  clock(add(state().interviews.nextOn, -1)); shell('--type', 'rhythm', '--trigger', 'manual');
  return { data, options, shell, state, packs };
}
function answer(w, pack, question) {
  const change = question.options[1];
  const answers = [{ id: question.id, value: change.text, ai: question.value, changed: true }, { id: 'results', value: '本週沒有成果', ai: '', changed: true }];
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: ask.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + ask.packHash(pack), 'batch: false', 'shownAt: ' + ask.localIso()];
  fs.mkdirSync(path.join(w.data, 'founder', 'replies'), { recursive: true });
  fs.writeFileSync(path.join(w.data, 'founder', 'replies', 'test-ask-answer.md'), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  w.shell();
}
async function checkPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(+port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}
let server;
try {
  const first = world('first'), firstPack = first.packs()[0], firstQuestion = firstPack?.questions.find(q => q.bind === 'assume');
  if (!firstQuestion?.noChange) throw new Error('每週訪問缺少確認現況的假設題');
  const firstId = firstQuestion.options[0].apply.id, firstBefore = first.state().company.assumptions.find(a => a.id === firstId)?.grade;
  first.shell('--type', 'rhythm', '--trigger', 'manual');
  const firstHeld = read(path.join(first.data, 'asks', firstPack.id + '.json')), firstHeldQuestion = firstHeld.questions.find(q => q.id === firstQuestion.id);
  answer(first, firstHeld, firstHeldQuestion);
  ok('放題後外殼先處理其他工作，假設題答案仍寫入', !firstHeldQuestion.closed && firstHeldQuestion.options[1].apply.grade !== firstBefore && first.state().company.assumptions.find(a => a.id === firstId)?.grade === firstHeldQuestion.options[1].apply.grade);

  const recovery = world('recovery'), pack = recovery.packs()[0], question = pack?.questions.find(q => q.bind === 'assume');
  if (!question?.noChange) throw new Error('每週訪問缺少確認現況的假設題');
  const id = question.options[0].apply.id, before = recovery.state().company.assumptions.find(a => a.id === id)?.grade;
  const file = path.join(recovery.data, 'asks', pack.id + '.json');
  question.closed = { status: 'applied', reason: '建議值已是現行值', at: '2026-11-08T12:00:00' };
  fs.writeFileSync(file, JSON.stringify(pack));
  await checkPort();
  const base = 'http://127.0.0.1:' + port;
  server = spawn(process.execPath, [path.join(proto, 'server.mjs'), '--port', port], { cwd: proto, env: recovery.options, stdio: 'ignore', windowsHide: true });
  let ready = false;
  for (let i = 0; i < 80; i++) { if (server.exitCode !== null) break; try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {} await sleep(250); }
  if (!ready || server.exitCode !== null) throw new Error('伺服器未能啟動');
  await usePass(base);
  const response = await fetch(base + '/api/asks/reopen', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ packId: pack.id, qId: question.id }) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('舊版取回入口失敗：' + JSON.stringify(result));
  const exit = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exit; server = null;
  const reopened = read(file).questions.find(q => q.id === question.id);
  if (reopened.closed || !reopened.reopened) throw new Error('舊版取回入口沒有取回該題');
  recovery.shell('--type', 'rhythm', '--trigger', 'manual');
  const held = read(file), heldQuestion = held.questions.find(q => q.id === question.id);
  answer(recovery, held, heldQuestion);
  ok('已被錯誤收起的假設題取回後作答寫得入', !heldQuestion.closed && heldQuestion.options[1].apply.grade !== before && recovery.state().company.assumptions.find(a => a.id === id)?.grade === heldQuestion.options[1].apply.grade);
} catch (error) { console.log('錯誤：' + String(error.stack || error)); ok('測試程序', false); }
finally { if (server) { const exit = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exit; } }
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
if (results.some(x => !x)) process.exitCode = 1;
