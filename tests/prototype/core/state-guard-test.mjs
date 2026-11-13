// 帳本讀取失敗不可清空（主線全面審查 2026-11-12 06-architecture 第 1 項）：直接叫 run.mjs，不用 AI、不開伺服器。
// 修正前預期 SG-01、SG-02、SG-04 不通過（外殼把讀不到的帳本當空白，再整份寫回；寫入前沒有上一版）。
// 暫時鎖定（EBUSY／EPERM）在 Node 無法可靠模擬，由程式碼審閱核對重試，不在此測。
// 用法：node state-guard-test.mjs <原型資料夾> <輸出資料夾>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';

const [PROTO, OUT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + JSON.stringify(info).slice(0, 700))); };
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
let seq = 0;

function world(name) {
  const data = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name, 'data');
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, PROTO);
  const ledger = path.join(data, 'ledger'), state = path.join(ledger, 'state.json');
  const env = { ...process.env, SOS_DATA: data, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = () => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
  // 一個創辦人操作：外殼開工時合併，會整份寫回帳本
  const queueOp = () => fs.writeFileSync(path.join(ledger, 'founder-ops.json'), JSON.stringify([{ id: 'op-sg-' + seq, at: '2026-11-12T20:00:00+00:00', op: 'setNext', target: 'nextAction', value: { text: '測試下一步' } }]));
  return { data, ledger, state, shell, queueOp };
}
const raw = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };

// SG-01 內容損壞：不可覆寫，創辦人操作留待下次
{
  const w = world('corrupt'), bad = '{"tasks": [{"id": "t1", "title": "未寫完';
  w.shell(); // 先讓外殼完成舊安裝同步
  fs.writeFileSync(w.state, bad); w.queueOp();
  const r = w.shell();
  ok('SG-01 帳本內容損壞：外殼不覆寫 state.json', raw(w.state) === bad, { after: String(raw(w.state)).slice(0, 200), status: r.status });
  ok('SG-02 帳本內容損壞：創辦人操作沒有被吃掉（founder-ops 仍在或未合併）', fs.existsSync(path.join(w.ledger, 'founder-ops.json')) || fs.readdirSync(w.ledger).some(f => /^\.founder-ops-/.test(f)), fs.readdirSync(w.ledger));
}
// SG-03 空白檔（0 字節）同樣當作讀不到
{
  const w = world('empty');
  w.shell();
  fs.writeFileSync(w.state, ''); w.queueOp();
  w.shell();
  ok('SG-03 帳本是空白檔：外殼不覆寫', raw(w.state) === '', String(raw(w.state)).slice(0, 200));
}
// SG-04 正常寫入：寫入前把上一版存為 state.json.prev
{
  const w = world('prev');
  w.shell();
  let before = null; try { before = JSON.parse(raw(w.state)); } catch { }
  before = before && typeof before === 'object' ? before : { schemaVersion: 1, tasks: [], events: [] }; before.sgMarker = 'before'; fs.writeFileSync(w.state, JSON.stringify(before, null, 2));
  const beforeRaw = raw(w.state);
  w.queueOp(); w.shell();
  const prev = raw(w.state + '.prev'), now = JSON.parse(raw(w.state) || '{}');
  ok('SG-04 寫入後 state.json.prev 是上一版', prev === beforeRaw, { prev: prev && prev.slice(0, 120) });
  ok('SG-05 正常合併照常：新版帳本有創辦人操作', (now.founderOpsDone || []).includes('op-sg-' + seq) && now.sgMarker === 'before', { done: now.founderOpsDone, marker: now.sgMarker });
}
// SG-06 檔案不存在：照舊由空白帳本開始（回歸）
{
  const w = world('missing');
  w.shell();
  fs.rmSync(w.state, { force: true }); w.queueOp();
  const r = w.shell();
  const now = JSON.parse(raw(w.state) || '{}');
  ok('SG-06 帳本不存在：照舊建立新帳本並合併操作', (now.founderOpsDone || []).includes('op-sg-' + seq), { status: r.status, now: Object.keys(now) });
}

// SG-07 創辦人操作檔損壞：外殼不可當空清單合併後刪檔（內容要原樣留在 ledger）
{
  const w = world('ops-corrupt'), badOps = '[{"id": "op-x", "op": "setNext", "value": {"text": "未寫完';
  w.shell();
  fs.writeFileSync(path.join(w.ledger, 'founder-ops.json'), badOps);
  w.shell();
  const kept = fs.readdirSync(w.ledger).filter(f => /founder-ops/.test(f) && f.endsWith('.json')).some(f => raw(path.join(w.ledger, f)) === badOps);
  ok('SG-07 創辦人操作檔損壞：外殼保留原檔，不刪除未合併的更正', kept, fs.readdirSync(w.ledger));
}

console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
