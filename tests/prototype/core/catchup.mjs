// 補做測試：伺服器未開時已有回覆檔 → 起伺服器 → 應自動補做到完成
// 用法：node catchup.mjs <原型資料夾> <adapter 檔> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { seedCompany, certifyDirect, usePass } from '../lib/testkit.mjs';
const [PROTO, ADAPTER, PORT] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); };
const data = path.join(process.env.SOS_TEST_OUT || (await import('node:os')).tmpdir(), 'catchup-data');
process.env.SOS_DATA = data;
fs.rmSync(data, { recursive: true, force: true });
seedCompany(data, PROTO);
await certifyDirect(data, PROTO, ADAPTER);
const page = JSON.parse(fs.readFileSync(path.join(data, 'company', 'page.json'), 'utf8'));
const machine = { page: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(m => m.id), orderChanged: false, nextActionMilestone: 'm1', edits: [], stillMissing: [], note: '' };
const text = ['kind: proofread', `ref: ${page.page.id}`, 'option: confirm', `rev: ${page.page.revision}`, `hash: ${fnv(JSON.stringify(page))}`, 'batch: false', 'shownAt: x', '', '# 測試', '```json', JSON.stringify(machine), '```', ''].join('\n');
fs.mkdirSync(path.join(data, 'founder', 'replies'), { recursive: true });
fs.writeFileSync(path.join(data, 'founder', 'replies', `2026-10-26-000000-proofread-${page.page.id}.md`), text);
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_ADAPTER: ADAPTER, SOS_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
await usePass(`http://127.0.0.1:${PORT}`);
let st = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try { st = await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json(); } catch { }
  if (st && st.runs && st.runs[0] && st.runs[0].state !== 'running') break;
}
srv.kill();
const run = st && st.runs && st.runs[0];
const res = [
  ['開機見到未處理回覆並補做', /有上次未處理的回覆/.test(log)],
  ['補做完成', run && run.state === 'done'],
  ['回覆資料夾清空', fs.readdirSync(path.join(data, 'founder', 'replies')).length === 0]
];
// 第二段：交資料寫入咗，但機器喺處理之前關咗 → 再開機補做
fs.mkdirSync(path.join(data, 'founder', 'inbox'), { recursive: true });
fs.writeFileSync(path.join(data, 'founder', 'inbox', '2026-10-27-000000-001-intake.md'), '## 1. 你賣乜、畀邊個？\n\n測試\n');
fs.writeFileSync(path.join(data, 'founder', 'inbox', '2026-10-27-000000-001-intake-01-計劃.md'), '# 測試計劃\n');
const srv2 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_ADAPTER: ADAPTER, SOS_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] });
let log2 = ''; srv2.stdout.on('data', d => { log2 += d; }); srv2.stderr.on('data', d => { log2 += d; });
await usePass(`http://127.0.0.1:${PORT}`);
let st2 = null;
for (let i = 0; i < 60; i++) { await sleep(500); try { st2 = await (await fetch(`http://127.0.0.1:${PORT}/api/status`)).json(); } catch { } if (st2 && st2.intake && /done|failed/.test(st2.intake.state)) break; }
srv2.kill();
res.push(['交資料開機補做：公司概覽已就緒', st2 && st2.intake && st2.intake.state === 'done' && st2.company.ready]);
res.push(['交資料開機補做：收件匣清空', fs.readdirSync(path.join(data, 'founder', 'inbox')).length === 0]);
console.log(log.trim());
for (const [n, p] of res) console.log((p ? 'PASS ' : 'FAIL ') + n);
await sleep(500);
fs.rmSync(data, { recursive: true, force: true });
process.exit(0);
