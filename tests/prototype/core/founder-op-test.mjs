// 首頁業務主線：創辦人操作不經 AI 即時生效，外殼下一次開工才合併。
// 用法：node founder-op-test.mjs <原型資料夾> <輸出資料夾> <port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT] = process.argv.slice(2);
const DATA = path.join(OUT, 'data');
const BASE = `http://127.0.0.1:${PORT}`;
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.rmSync(OUT, { recursive: true, force: true });
process.env.SOS_DATA = DATA;
const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const DIR = ask.dataDirs(PROTO);
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const stateFile = path.join(DIR.ledger, 'state.json');
write(stateFile, {
  company: { nextExternalAction: { text: '聯絡客戶安排會面', milestoneId: 'M1' } },
  intake: { state: 'complete' },
  milestones: [{ id: 'M1', short: '取得首個客戶', event: '聯絡客戶安排會面', state: 'active', pathStatus: 'confirmed', order: 1 }],
  events: []
});
write(path.join(DIR.asks, 'ask-main.json'), { id: 'ask-main', title: '確認會面安排', askedBy: 'AI', askedAt: ask.localIso(), todoType: 'decision', questions: [{ id: 'q1', ask: '確認會面安排嗎？', kind: 'choice', value: '確認', why: '需要你的決定', options: [{ text: '確認', rec: true }] }] });

let srv = null;
const start = () => spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const post = async (pathName, body) => {
  const res = await fetch(BASE + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch { }
  return { code: res.status, json };
};
const get = async pathName => (await fetch(BASE + pathName)).json();
async function ready() {
  for (let i = 0; i < 80; i++) {
    try { if ((await get('/api/health')).ok) return true; } catch { }
    await sleep(100);
  }
  return false;
}

try {
  srv = start();
  ok('伺服器就緒', await ready());
  await usePass(BASE);
  const changed = await post('/api/founder-op', { op: 'reschedule', target: 'nextAction', value: { date: '2030-02-04' } });
  ok('改期操作獲接收', changed.code === 202 && changed.json && changed.json.ok, changed);
  let dash = await get('/api/dashboard');
  ok('改期無須等待外殼即時讀回', dash.nextAction && dash.nextAction.date === '2030-02-04', dash.nextAction);
  const snooze = await post('/api/founder-op', { op: 'snooze', target: 'ask-main', value: { until: '2030-02-11' } });
  dash = await get('/api/dashboard');
  ok('暫緩即時移出主線', snooze.code === 202 && !dash.todo.some(t => t.id === 'ask-main') && dash.snoozed.some(t => t.id === 'ask-main'), { snooze, todo: dash.todo, snoozed: dash.snoozed });
  const cancel = await post('/api/founder-op', { op: 'cancelNext', target: 'nextAction', value: {} });
  dash = await get('/api/dashboard');
  ok('取消後顯示待設定狀態及建議', cancel.code === 202 && dash.nextAction.stale && dash.nextAction.suggestion && dash.nextAction.suggestion.milestoneId === 'M1', dash.nextAction);
  const reset = await post('/api/founder-op', { op: 'setNext', target: 'nextAction', value: { text: '安排下一次客戶會面', date: '2030-02-08', milestoneId: 'M1' } });
  ok('採用新動作即時讀回', reset.code === 202 && (await get('/api/dashboard')).nextAction.text === '安排下一次客戶會面', reset);
  srv.kill(); srv = null;
  const merged = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA }, encoding: 'utf8', timeout: 30000 });
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  ok('下一次外殼開工合併操作', merged.status === 0 && state.company.nextExternalAction.text === '安排下一次客戶會面' && !fs.existsSync(path.join(DIR.ledger, 'founder-ops.json')), { status: merged.status, stderr: String(merged.stderr || '').slice(0, 300), next: state.company.nextExternalAction });
  ok('外殼合併後留下創辦人操作事件', (state.events || []).filter(event => event.type === 'founder-op').length >= 4, state.events);
  write(stateFile, { demo: true, company: { nextExternalAction: { text: '示範動作', milestoneId: 'M1' } }, milestones: [{ id: 'M1', short: '示範站', state: 'active', pathStatus: 'confirmed' }] });
  srv = start();
  await ready();
  const demo = await post('/api/founder-op', { op: 'cancelNext', target: 'nextAction', value: {} });
  ok('示範資料拒絕創辦人操作', demo.code === 400 && demo.json && demo.json.error === 'demo', demo);
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (srv) srv.kill();
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
