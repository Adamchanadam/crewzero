// 測試輸出清理：只喺自己個 <輸出> 裏面造檔。
// 用法：node test-output-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claimOutput, collectFailureEvidence, dirSize, MARKER, pruneOutputs, readOutputMarker, safeRemove, sweepInterrupted, updateOutputMarker } from '../lib/test-output.mjs';

const [PROTO, OUT] = process.argv.slice(2);
if (!PROTO || !OUT) { console.log('用法：node test-output-test.mjs <原型資料夾> <輸出資料夾>'); process.exit(2); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  ' + String(info || ''))); };
const test = async (name, fn) => { try { await fn(); ok(name, true); } catch (e) { ok(name, false, e && e.stack || e); } };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const make = name => { const dir = path.join(OUT, 'cases', name); fs.mkdirSync(dir, { recursive: true }); return dir; };
const isWin = process.platform === 'win32';
const link = (target, at) => fs.symlinkSync(target, at, isWin ? 'junction' : 'dir');
const real = p => fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
function mark(dir, state = 'finished', extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ tool: 'crewzero-run-all', schema: 1, out: real(dir), pid: process.pid, startedAt: now, heartbeatAt: now, state, ...extra }, null, 2));
}
const exists = file => fs.existsSync(file);

await test('junction 只撤走自己，哨兵唔會郁', () => {
  const root = make('junction'), target = path.join(root, 'target'), sentinel = path.join(root, 'sentinel'), alias = path.join(target, 'data-junction');
  write(path.join(target, 'inside.txt'), 'inside'); write(path.join(sentinel, 'keep.txt'), 'sentinel');
  try { link(sentinel, alias); } catch (e) { throw new Error('建唔到真 junction/symlink：' + e.message); }
  const before = hash(path.join(sentinel, 'keep.txt')), removed = safeRemove(target, root);
  if (!removed.removed || exists(alias) || !exists(path.join(sentinel, 'keep.txt')) || hash(path.join(sentinel, 'keep.txt')) !== before) throw new Error('junction 或哨兵狀態唔啱');
});

await test('boundary 外同指去外面嘅 junction 唔會刪外面', () => {
  const root = make('outside'), outside = path.join(OUT, 'cases', 'outside-sentinel'), inside = path.join(root, 'inside'), alias = path.join(root, 'alias');
  write(path.join(outside, 'keep.txt'), 'keep'); write(path.join(inside, 'inside.txt'), 'inside');
  const before = hash(path.join(outside, 'keep.txt'));
  let threw = false; try { safeRemove(outside, root); } catch { threw = true; }
  if (!threw || !exists(path.join(outside, 'keep.txt')) || hash(path.join(outside, 'keep.txt')) !== before) throw new Error('boundary 外被改咗');
  try { link(outside, alias); } catch (e) { throw new Error('建 link 失敗：' + e.message); }
  threw = false; try { safeRemove(alias, root); } catch { threw = true; }
  if ((!threw && exists(alias)) || !exists(path.join(outside, 'keep.txt')) || hash(path.join(outside, 'keep.txt')) !== before) throw new Error('外面哨兵唔安全');
});

await test('磁碟根目錄同家目錄唔可以做 boundary', () => {
  const root = make('protected-boundary'), item = path.join(root, 'item'); write(item);
  let disk = false, home = false;
  try { safeRemove(item, path.parse(path.resolve(item)).root); } catch { disk = true; }
  try { safeRemove(item, os.homedir()); } catch { home = true; }
  if (!disk || !home || !exists(item)) throw new Error('危險 boundary 冇被拒絕');
});

await test('未標記、搬咗標記、錯工具同受保護名全部原封不動', () => {
  const root = make('shield'), names = ['crz-logo', 'crz-real', 'crz-ux-harvest', 'crz-pub', 'crz-t352', 'crz-typed'];
  const before = new Map();
  for (const name of names) { const file = path.join(root, name, 'keep.txt'); write(file, name); before.set(file, hash(file)); }
  const source = path.join(root, 'source'); mark(source);
  const copied = path.join(root, 'copied-mark'); fs.mkdirSync(copied); fs.copyFileSync(path.join(source, MARKER), path.join(copied, MARKER));
  const wrong = path.join(root, 'wrong-tool'); mark(wrong); const bad = JSON.parse(fs.readFileSync(path.join(wrong, MARKER))); bad.tool = 'not-crewzero'; fs.writeFileSync(path.join(wrong, MARKER), JSON.stringify(bad));
  sweepInterrupted([root]); pruneOutputs([root], path.join(root, 'none'));
  for (const [file, value] of before) if (!exists(file) || hash(file) !== value) throw new Error('受保護資料夾被改：' + file);
  if (!exists(path.join(copied, MARKER)) || !exists(path.join(wrong, MARKER))) throw new Error('假標記資料夾被碰過');
});

await test('候選本身係 junction 時唔會當舊輸出', () => {
  const root = make('junction-candidate'), realOut = path.join(OUT, 'cases', 'real-candidate'), alias = path.join(root, 'alias'), current = path.join(root, 'current');
  mark(realOut); write(path.join(realOut, 'keep.txt'), 'keep'); mark(current);
  const before = hash(path.join(realOut, 'keep.txt'));
  try { link(realOut, alias); } catch (e) { throw new Error('建 link 失敗：' + e.message); }
  pruneOutputs([root], current, { keep: 1, maxBytes: 1 });
  if (!exists(alias) || !exists(path.join(realOut, 'keep.txt')) || hash(path.join(realOut, 'keep.txt')) !== before) throw new Error('junction 被當成候選');
});

await test('只留最近五次；超額由最舊開始，current 永不刪', () => {
  const root = make('prune-count'), outputs = [];
  for (let i = 0; i < 8; i++) {
    const dir = path.join(root, 'out-' + i); mark(dir); const j = JSON.parse(fs.readFileSync(path.join(dir, MARKER))); j.startedAt = new Date(Date.now() - (8 - i) * 1000).toISOString(); fs.writeFileSync(path.join(dir, MARKER), JSON.stringify(j)); write(path.join(dir, 'data.txt'), String(i)); outputs.push(dir);
  }
  pruneOutputs([root], outputs[7], { keep: 5, maxBytes: Number.MAX_SAFE_INTEGER });
  if (outputs.slice(0, 3).some(exists) || outputs.slice(3).some(dir => !exists(dir))) throw new Error('最近五次保留唔啱');
  const capRoot = make('prune-size'), old = path.join(capRoot, 'old'), newer = path.join(capRoot, 'newer'), current = path.join(capRoot, 'current');
  for (const dir of [old, newer, current]) { mark(dir); write(path.join(dir, 'data.bin'), '1234567890'); }
  const limit = dirSize(current) + 1;
  pruneOutputs([capRoot], current, { keep: 10, maxBytes: limit });
  if (!exists(current) || exists(old) || exists(newer)) throw new Error('大小上限冇由最舊清到 current');
});

await test('運行中唔碰；死 pid 或過期心跳只清 runs', () => {
  const root = make('interrupted'), live = path.join(root, 'live'); mark(live, 'running'); write(path.join(live, 'runs', 'keep.txt'));
  sweepInterrupted([root]); pruneOutputs([root], live);
  if (!exists(path.join(live, 'runs', 'keep.txt')) || readOutputMarker(live).marker.state !== 'running') throw new Error('仲跑緊都被清');
  for (const [name, extra] of [['dead', { pid: 99999999 }], ['stale', { pid: process.pid, heartbeatAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }]]) {
    const dir = path.join(root, name); mark(dir, 'running', extra); write(path.join(dir, 'runs', 'large.tmp'), 'x'.repeat(20)); write(path.join(dir, 'logs', 'keep.txt')); write(path.join(dir, 'failed', 'keep.txt')); write(path.join(dir, 'summary.json'), '{}');
  }
  sweepInterrupted([root]);
  for (const name of ['dead', 'stale']) {
    const dir = path.join(root, name), known = readOutputMarker(dir);
    if (exists(path.join(dir, 'runs')) || !exists(path.join(dir, 'logs', 'keep.txt')) || !exists(path.join(dir, 'failed', 'keep.txt')) || !exists(path.join(dir, 'summary.json')) || !known || known.marker.state !== 'interrupted') throw new Error(name + ' 清理或紀錄唔啱');
  }
});

await test('失敗證據唔跟 profile、Local State、程式或連結；有優先同上限', () => {
  const root = make('evidence'), dest = path.join(root, 'failed');
  write(path.join(root, 'a-old.txt'), 'old!'); write(path.join(root, 'b-new.log'), 'new!'); write(path.join(root, 'c.json'), '{}'); write(path.join(root, 'large.txt'), 'x'.repeat(20)); write(path.join(root, 'code.mjs'), 'bad'); write(path.join(root, 'profile', 'inside.txt'), 'profile'); write(path.join(root, 'chrome', 'Local State'), 'state'); write(path.join(root, 'chrome', 'visible.txt'), 'no');
  const target = path.join(root, 'linked-source'); write(path.join(target, 'link.txt'), 'link');
  try { link(target, path.join(root, 'linked')); } catch (e) { throw new Error('建 link 失敗：' + e.message); }
  const evidence = collectFailureEvidence(root, dest, { maxFileBytes: 6, maxFiles: 2, maxBytes: 8 });
  if (evidence.files.length !== 2 || evidence.bytes > 8 || !evidence.files.every(f => /\.(txt|log)$/.test(f)) || exists(path.join(dest, 'profile', 'inside.txt')) || exists(path.join(dest, 'chrome', 'visible.txt')) || exists(path.join(dest, 'code.mjs')) || exists(path.join(dest, 'linked', 'link.txt'))) throw new Error(JSON.stringify(evidence));
});

await test('claimOutput 拒絕危險輸出，完成嘅標記先可以重用', () => {
  const root = make('claim'), actual = path.join(root, 'actual'), alias = path.join(root, 'alias'); fs.mkdirSync(actual);
  try { link(actual, alias); } catch (e) { throw new Error('建 link 失敗：' + e.message); }
  let rejectedLink = false; try { claimOutput(alias); } catch { rejectedLink = true; }
  const unmarked = path.join(root, 'unmarked'); write(path.join(unmarked, 'keep.txt'));
  let rejectedUnmarked = false; try { claimOutput(unmarked); } catch { rejectedUnmarked = true; }
  const empty = path.join(root, 'empty'); fs.mkdirSync(empty); claimOutput(empty);
  const reuse = path.join(root, 'reuse'); mark(reuse); write(path.join(reuse, 'runs', 'old.txt')); write(path.join(reuse, 'summary.json'), '{}'); claimOutput(reuse);
  const active = path.join(root, 'active'); mark(active, 'running'); let rejectedActive = false; try { claimOutput(active); } catch { rejectedActive = true; }
  if (!rejectedLink || !rejectedUnmarked || !readOutputMarker(empty) || exists(path.join(reuse, 'runs')) || exists(path.join(reuse, 'summary.json')) || !rejectedActive) throw new Error('claim 規則唔啱');
});

await test('端到端：成功與失敗都留紀錄而唔留 runs', () => {
  const e2e = path.join(make('e2e'), 'temp'); fs.mkdirSync(e2e, { recursive: true });
  const env = { ...process.env, TEMP: e2e, TMP: e2e, TMPDIR: e2e }; delete env.SOS_TEST_OUT;
  const runAll = path.join(HERE, '..', 'run-all.mjs'), good = path.join(e2e, 'good');
  const first = spawnSync(process.execPath, [runAll, '--proto', PROTO, '--out', good, '--only', '名稱表', '--no-browser'], { encoding: 'utf8', env, timeout: 180000 });
  const goodSummary = exists(path.join(good, 'summary.json')) ? JSON.parse(fs.readFileSync(path.join(good, 'summary.json'))) : null;
  if (first.status !== 0 || !goodSummary || !goodSummary.finished || !exists(path.join(good, 'logs')) || exists(path.join(good, 'runs')) || !readOutputMarker(good) || readOutputMarker(good).marker.state !== 'finished') throw new Error((first.stdout || '') + (first.stderr || ''));
  const fake = path.join(e2e, 'fake-proto'); write(path.join(fake, 'server.mjs'), ''); const bad = path.join(e2e, 'bad');
  const second = spawnSync(process.execPath, [runAll, '--proto', fake, '--out', bad, '--only', '名稱表', '--no-browser'], { encoding: 'utf8', env, timeout: 180000 });
  const badSummary = exists(path.join(bad, 'summary.json')) ? JSON.parse(fs.readFileSync(path.join(bad, 'summary.json'))) : null;
  if (second.status === 0 || !badSummary || !badSummary.finished || !exists(path.join(bad, 'logs')) || exists(path.join(bad, 'runs'))) throw new Error((second.stdout || '') + (second.stderr || ''));
});

await test('試走拒絕已有未標記內容的資料夾，一個檔都唔郁', () => {
  const out = make('walk-unmarked'), keep = path.join(out, 'profile', 'keep.txt'); write(keep, 'keep');
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'tools', 'mvp-walk.mjs'), PROTO, out, 'no-chrome', 'no-fake'], { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 2 || !exists(keep) || fs.readFileSync(keep, 'utf8') !== 'keep' || exists(path.join(out, '.crewzero-walk-output'))) throw new Error('未有拒絕：' + r.status + ' ' + r.stdout);
});

const passed = results.filter(r => r.pass).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
