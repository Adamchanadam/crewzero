// 待決事項排序測試（規劃書 4.3；唔開瀏覽器）：逾期日數 → 類型 → 提出先後；監察台、Founder Desk 同伺服器同一份清單
// 用法：node todo-test.mjs <原型資料夾> <輸出資料夾> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); // 重試時上一次嘅 Chrome 可能未放手
const DATA = path.join(OUT, 'data');
process.env.SOS_DATA = DATA;
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
const { seedCompany } = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const DIR = lib.dataDirs(PROTO);
// 按日曆日加減（夏令時間轉換嗰幾日都唔會差一日）
const now = new Date(), shift = d => { const x = new Date(now); x.setDate(x.getDate() + d); return x; };
const ago = d => lib.localIso(shift(-d));
const day = d => lib.localIso(shift(d)).slice(0, 10);
seedCompany(DATA, PROTO);
fs.writeFileSync(path.join(DIR.ledger, 'state.json'), JSON.stringify({ tasks: [{ id: 't1', title: '見客', owner: 'founder', status: 'planned', dueOn: day(-5) }, { id: 't2', title: '打電話', owner: 'founder', status: 'planned', dueOn: day(3) }], decisions: [] }));
const pack = (id, extra, askedAt) => fs.writeFileSync(path.join(DIR.asks, id + '.json'), JSON.stringify({ id, title: '測試：' + id, askedBy: 'AI', askedAt, questions: [{ id: 'a', ask: '測試？', kind: 'choice', options: [{ text: '是', rec: true }, { text: '否' }], value: '是', effect: 'tentative', priority: 1 }], ...extra }));
pack('ask-a', { todoType: 'decision' }, ago(10));      // 提出十日：逾期 3 日
pack('ask-b', { todoType: 'trial', due: day(-2) }, ago(1)); // 試行到期兩日
pack('ask-c', { todoType: 'interview', due: day(0) }, ago(1)); // 訪問今日到期：未逾期
pack('ask-d', { todoType: 'acceptance' }, ago(1));
pack('ask-e', { todoType: 'question' }, ago(2));
pack('ask-f', { todoType: 'autoStop' }, ago(1));
pack('ask-g', { actionConfirm: { taskId: 't2' } }, ago(1)); // 你的行動：未到期
pack('ask-h', { actionConfirm: { taskId: 't1' } }, ago(1)); // 你的行動：逾期 5 日
pack('ask-i', { todoType: 'decision' }, ago(3));
pack('ask-j', { todoType: 'decision' }, ago(5));
pack('ask-k', { todoType: 'blocking' }, ago(1));
pack('ask-l', { todoType: 'path' }, ago(2));
const WANT = ['ask-h', 'ask-a', 'ask-b', 'overview', 'ask-f', 'ask-l', 'ask-k', 'ask-d', 'ask-c', 'ask-e', 'ask-j', 'ask-i', 'ask-g'];

const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
try {
  const td = dash.pendingTodo(DIR, now);
  ok('次序：逾期日數 → 類型 → 提出先後', JSON.stringify(td.map(t => t.id)) === JSON.stringify(WANT), td.map(t => t.id + ':' + t.type + ':' + t.overdueDays));
  ok('決定提出後超過七日未答：逾期 3 日', td.find(t => t.id === 'ask-a').overdueDays === 3, td.find(t => t.id === 'ask-a'));
  ok('你的行動按 dueOn 計逾期；未到期排最後', td.find(t => t.id === 'ask-h').overdueDays === 5 && td.find(t => t.id === 'ask-h').type === 'action' && td.at(-1).id === 'ask-g', td.filter(t => t.type === 'action'));
  ok('訪問當日到期唔算逾期，期限照列', td.find(t => t.id === 'ask-c').overdueDays === 0 && td.find(t => t.id === 'ask-c').due === day(0));
  const ds = dash.dashboardState(DIR, { now });
  ok('營運監察台用同一份清單同次序', JSON.stringify(ds.todo.map(t => t.id)) === JSON.stringify(WANT), ds.todo.map(t => t.id));
  await usePass(`http://127.0.0.1:${PORT}`);
  let a = null; for (let i = 0; i < 240 && !a; i++) { try { a = await (await fetch(`http://127.0.0.1:${PORT}/api/asks`)).json(); } catch { await sleep(250); } }
  ok('Founder Desk（/api/asks）回傳同一份清單同次序', a && JSON.stringify(a.todo.map(t => t.id)) === JSON.stringify(WANT), a && a.todo.map(t => t.id));
  ok('每項都有類型名稱同圖示', td.every(t => lib.NAMES.dash['ty_' + t.type] && lib.NAMES.TODO_ICON[t.type]), td.filter(t => !lib.NAMES.dash['ty_' + t.type] || !lib.NAMES.TODO_ICON[t.type]).map(t => t.type));
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), log);
  process.exit(pass === results.length ? 0 : 1);
}
