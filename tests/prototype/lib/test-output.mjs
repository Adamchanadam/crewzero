// 測試輸出只可以清自己有標記嘅資料夾；連結一律唔跟。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const OUTPUT_KEEP = 5;
export const OUTPUT_MAX_BYTES = 500 * 1024 * 1024;
export const FAILURE_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const FAILURE_GROUP_MAX_FILES = 200;
export const FAILURE_GROUP_MAX_BYTES = 20 * 1024 * 1024;
export const FAILURE_RUN_MAX_BYTES = 100 * 1024 * 1024;
export const HEARTBEAT_MS = 60 * 60 * 1000;
export const MARKER = '.crewzero-test-output.json';

const RETRY_MS = 10 * 1000;
const markerStates = new Set(['running', 'finished', 'interrupted']);
const canonical = p => {
  let v = path.resolve(String(p));
  if (process.platform === 'win32') v = v.toLocaleLowerCase('en-US');
  return v;
};
const samePath = (a, b) => canonical(a) === canonical(b);
const isInside = (child, parent) => samePath(child, parent) || canonical(child).startsWith(canonical(parent) + path.sep);
const real = p => fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p);
const isMissing = e => e && e.code === 'ENOENT';
const isBusy = e => e && ['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(e.code);
const sleep = ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

function plainDirectory(dir) {
  const stat = fs.lstatSync(dir);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function protectedBoundary(boundary) {
  const here = real(boundary);
  if (samePath(here, path.parse(here).root)) throw new Error('清理邊界唔可以係磁碟根目錄');
  let home = os.homedir();
  try { home = real(home); } catch { }
  if (samePath(here, home)) throw new Error('清理邊界唔可以係家目錄');
  return here;
}

function makeWritable(file, stat) {
  if (stat.isSymbolicLink()) return;
  try { fs.chmodSync(file, stat.isDirectory() ? 0o777 : 0o666); } catch { }
}

function retry(remove, file, stat, deadline) {
  let last = null;
  do {
    try { remove(); return { ok: true }; } catch (e) {
      last = e;
      if (!isBusy(e) || Date.now() >= deadline) break;
      makeWritable(file, stat);
      sleep(80);
    }
  } while (Date.now() < deadline);
  return { ok: false, error: last };
}

function removeLink(file, stat, deadline) {
  // Windows junction 用 rmdir；其他連結 unlink。兩個都試，唔會入去。
  return retry(() => {
    try {
      if (stat.isDirectory()) fs.rmdirSync(file);
      else fs.unlinkSync(file);
    } catch (e) {
      if (!['ENOTDIR', 'EINVAL', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      if (stat.isDirectory()) fs.unlinkSync(file);
      else fs.rmdirSync(file);
    }
  }, file, stat, deadline).ok;
}

function removeNode(file, parentReal, left, deadline) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (e) { if (isMissing(e)) return true; left.push(file); return false; }
  if (stat.isSymbolicLink()) {
    if (removeLink(file, stat, deadline)) return true;
    left.push(file); return false;
  }
  if (!stat.isDirectory()) {
    if (retry(() => fs.unlinkSync(file), file, stat, deadline).ok) return true;
    left.push(file); return false;
  }

  // 正常資料夾都要核對實體位置，避免 race 或特殊 reparse point。
  let nodeReal;
  try { nodeReal = real(file); } catch { left.push(file); return false; }
  if (!samePath(nodeReal, path.join(parentReal, path.basename(file)))) {
    if (removeLink(file, stat, deadline)) return true;
    left.push(file); return false;
  }
  let entries;
  try { entries = fs.readdirSync(file); } catch { left.push(file); return false; }
  let clear = true;
  for (const name of entries) if (!removeNode(path.join(file, name), nodeReal, left, deadline)) clear = false;
  if (!clear) { left.push(file); return false; }
  if (retry(() => fs.rmdirSync(file), file, stat, deadline).ok) return true;
  left.push(file); return false;
}

// 唔用 rmSync(recursive)：junction 只撤走自己，唔會跟去外面。
export function safeRemove(target, boundary) {
  if (!fs.existsSync(boundary)) throw new Error('清理邊界唔存在：' + boundary);
  if (!plainDirectory(boundary)) throw new Error('清理邊界必須係普通資料夾：' + boundary);
  const boundaryReal = protectedBoundary(boundary);
  let targetReal;
  try { targetReal = real(target); } catch (e) { if (isMissing(e)) return { removed: true, left: [] }; throw new Error('清理目標唔可確認：' + target); }
  if (!isInside(targetReal, boundaryReal)) throw new Error('清理目標唔喺指定測試輸出入面：' + target);
  const left = [];
  const removed = removeNode(target, real(path.dirname(target)), left, Date.now() + RETRY_MS);
  return { removed, left: [...new Set(left)] };
}

// 計大小同樣唔跟連結，避免一個 junction 令舊輸出計錯或越界。
export function dirSize(dir) {
  let stat;
  try { stat = fs.lstatSync(dir); } catch { return 0; }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  try {
    for (const name of fs.readdirSync(dir)) total += dirSize(path.join(dir, name));
  } catch { }
  return total;
}

function failureLimits(limits = {}) {
  return {
    maxFileBytes: limits.maxFileBytes ?? limits.fileBytes ?? FAILURE_FILE_MAX_BYTES,
    maxFiles: limits.maxFiles ?? FAILURE_GROUP_MAX_FILES,
    maxBytes: limits.maxBytes ?? FAILURE_GROUP_MAX_BYTES
  };
}

function ordinaryFile(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink() ? stat : null; } catch { return null; }
}

// 失敗證據只留可讀文字、畫面、JSON；Chrome profile 同程式副本一律略過。
export function collectFailureEvidence(groupDir, destDir, limits = {}) {
  const cap = failureLimits(limits), found = [], skipped = [];
  const allowed = new Map([['.txt', 0], ['.log', 0], ['.png', 1], ['.json', 2], ['.jsonl', 2]]);
  function walk(dir, rel = '') {
    let stat;
    try { stat = fs.lstatSync(dir); } catch { return; }
    if (stat.isSymbolicLink()) { skipped.push(rel || path.basename(dir)); return; }
    if (!stat.isDirectory()) return;
    const name = path.basename(dir);
    let names;
    try { names = fs.readdirSync(dir); } catch { skipped.push(rel || name); return; }
    if (name === 'profile' || name === 'node_modules' || names.includes('Local State')) { skipped.push(rel || name); return; }
    for (const child of names) {
      const file = path.join(dir, child), childRel = rel ? path.join(rel, child) : child;
      let childStat;
      try { childStat = fs.lstatSync(file); } catch { continue; }
      if (childStat.isSymbolicLink()) { skipped.push(childRel); continue; }
      if (childStat.isDirectory()) walk(file, childRel);
      else if (childStat.isFile()) {
        const ext = path.extname(child).toLowerCase();
        if (!allowed.has(ext)) { skipped.push(childRel); continue; }
        found.push({ file, rel: childRel, stat: childStat, kind: allowed.get(ext) });
      }
    }
  }
  walk(groupDir);
  found.sort((a, b) => a.kind - b.kind || b.stat.mtimeMs - a.stat.mtimeMs || a.rel.localeCompare(b.rel));
  const files = []; let bytes = 0;
  for (const item of found) {
    if (item.stat.size > cap.maxFileBytes || files.length >= cap.maxFiles || bytes + item.stat.size > cap.maxBytes) { skipped.push(item.rel); continue; }
    // 抄之前再 lstat，一變連結就寧願唔留證據。
    const current = ordinaryFile(item.file);
    if (!current || current.size !== item.stat.size) { skipped.push(item.rel); continue; }
    const to = path.join(destDir, item.rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(item.file, to);
    } catch { skipped.push(item.rel); continue; }
    files.push(item.rel); bytes += current.size;
  }
  return { files, bytes, skipped };
}

function markerPath(out) { return path.join(out, MARKER); }

// 只接受「資料夾本身、標記檔、標記內實體路徑」三樣都對得上嘅輸出。
export function readOutputMarker(out) {
  try {
    if (!plainDirectory(out)) return null;
    const mark = markerPath(out), stat = fs.lstatSync(mark);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(fs.readFileSync(mark, 'utf8'));
    if (!value || value.tool !== 'crewzero-run-all' || value.schema !== 1 || !markerStates.has(value.state) || typeof value.out !== 'string' || !Number.isInteger(Number(value.pid)) || !Number.isFinite(Date.parse(value.startedAt || '')) || !Number.isFinite(Date.parse(value.heartbeatAt || ''))) return null;
    const here = real(out), marked = real(value.out);
    if (!samePath(here, marked)) return null;
    return { marker: value, out: here };
  } catch { return null; }
}

function processAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
}

function fresh(marker, opts = {}) {
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const at = Date.parse(marker.heartbeatAt || '');
  return Number.isFinite(at) && Date.now() - at <= heartbeatMs;
}

function writeMarker(out, marker) {
  fs.writeFileSync(markerPath(out), JSON.stringify(marker, null, 2));
  return marker;
}

export function updateOutputMarker(out, changes = {}) {
  const known = readOutputMarker(out);
  if (!known) throw new Error('測試輸出標記唔有效，唔會改：' + out);
  const marker = { ...known.marker, ...changes, out: known.out };
  return writeMarker(out, marker);
}

function clearReusableOutput(out) {
  for (const name of ['runs', 'logs', 'failed', 'adapters', 'summary.json']) {
    const item = path.join(out, name);
    if (!fs.existsSync(item)) continue;
    const removed = safeRemove(item, out);
    if (!removed.removed) throw new Error('舊測試輸出暫時清唔走：' + removed.left.join('、'));
  }
}

// 開跑前先認領輸出；有任何未標記內容，都寧願拒絕而唔會冒認。
export function claimOutput(out, opts = {}) {
  if (fs.existsSync(out)) {
    let stat;
    try { stat = fs.lstatSync(out); } catch { stat = null; }
    if (!stat || stat.isSymbolicLink()) throw new Error('輸出資料夾唔可以係連結或 junction：' + out);
    if (!stat.isDirectory()) throw new Error('輸出位置已存在但唔係資料夾：' + out);
    const known = readOutputMarker(out);
    const names = fs.readdirSync(out);
    if (!known && names.length) throw new Error('輸出資料夾已有未標記內容，唔會接管：' + out);
    if (known) {
      if (known.marker.state === 'running' && processAlive(known.marker.pid) && fresh(known.marker, opts)) throw new Error('另一個全套測試仲喺度跑緊：' + out);
      clearReusableOutput(out);
    }
  } else fs.mkdirSync(out, { recursive: true });
  const outReal = real(out), now = new Date().toISOString();
  return writeMarker(out, { tool: 'crewzero-run-all', schema: 1, out: outReal, pid: opts.pid ?? process.pid, startedAt: now, heartbeatAt: now, state: 'running' });
}

function outputsUnder(roots) {
  const seen = new Set(), outputs = [];
  for (const root of roots) {
    try {
      if (!plainDirectory(root)) continue;
      for (const name of fs.readdirSync(root)) {
        const out = path.join(root, name), known = readOutputMarker(out);
        if (!known || seen.has(canonical(known.out))) continue;
        seen.add(canonical(known.out)); outputs.push({ path: out, ...known });
      }
    } catch { }
  }
  return outputs;
}

// 上次死咗或者冇心跳嘅，先撤走最肥嘅 runs；紀錄保留畀人睇。
export function sweepInterrupted(roots, opts = {}) {
  const interrupted = [];
  for (const output of outputsUnder(roots)) {
    const marker = output.marker;
    if (marker.state !== 'running' || (processAlive(marker.pid) && fresh(marker, opts))) continue;
    const runs = path.join(output.path, 'runs');
    const removed = fs.existsSync(runs) ? safeRemove(runs, output.path) : { removed: true, left: [] };
    updateOutputMarker(output.path, { state: 'interrupted', heartbeatAt: new Date().toISOString() });
    interrupted.push({ path: output.path, removed });
  }
  return interrupted;
}

function outputTime(output) {
  const at = Date.parse(output.marker.startedAt || '');
  if (Number.isFinite(at)) return at;
  try { return fs.statSync(output.path).mtimeMs; } catch { return 0; }
}

// 只剪走已有有效標記、而且唔係仍在跑嗰啲輸出。
export function pruneOutputs(roots, current, limits = {}) {
  const keep = limits.keep ?? OUTPUT_KEEP, maxBytes = limits.maxBytes ?? OUTPUT_MAX_BYTES;
  let currentReal = '';
  try { currentReal = real(current); } catch { }
  const all = outputsUnder(roots);
  const currentKey = canonical(currentReal || current);
  const protectedRunning = output => output.marker.state === 'running';
  const removable = all.filter(o => canonical(o.out) !== currentKey && !protectedRunning(o)).sort((a, b) => outputTime(b) - outputTime(a));
  const removed = [];
  for (const output of removable.slice(Math.max(0, keep - 1))) {
    const bytes = dirSize(output.path), result = safeRemove(output.path, output.path);
    if (result.removed) removed.push({ path: output.path, bytes });
  }
  const left = outputsUnder(roots);
  let total = left.reduce((sum, output) => sum + dirSize(output.path), 0);
  const oldest = left.filter(o => canonical(o.out) !== currentKey && !protectedRunning(o)).sort((a, b) => outputTime(a) - outputTime(b));
  for (const output of oldest) {
    if (total <= maxBytes) break;
    const bytes = dirSize(output.path), result = safeRemove(output.path, output.path);
    if (result.removed) { total -= bytes; removed.push({ path: output.path, bytes }); }
  }
  return { removed, bytes: removed.reduce((sum, item) => sum + item.bytes, 0), keptBytes: Math.max(0, total) };
}
