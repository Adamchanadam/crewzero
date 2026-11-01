// CrewZero 觀測程式（Codex 轉接層；規劃書 4.12、設計稿 2026-10-28 第 3 節）
// 只讀：睇 Codex 本機會話紀錄（~/.codex/sessions/年/月/日/rollout-*.jsonl）嘅頭一行（工作資料夾）同尾段事件；唔讀對話內容。
// 伺服器用子程序叫：stdin 傳 {"folders":[{"hash":"<sha256>","name":"<顯示名>"}, ...]}——只有雜湊，冇路徑；stdout 一行 JSON。
// 只回固定欄位，唔回路徑、唔回會話識別原文。觀察範圍：會話工作資料夾（或佢上層資料夾）用同一算法計雜湊，喺清單入面先列（4.12）。
//
// 「工作中」點判：最後一個 task_started 之後未見 task_complete／turn_aborted → 工作中（15 分鐘冇新事件 → 待核實）；
//   task_complete → 閒置；turn_aborted → 已停止。只列 2 小時內有活動嘅會話。
// 子會話（session_meta 有 parent_thread_id）：父會話都喺清單入面就計做父會話嘅子代理（5 分鐘內有更新而未完成先算），否則自己列出並標 child。
// 未驗證：2026-10-28 只用本機歷史紀錄核對過讀法同分類，未喺 Codex 會話進行中實測「工作中」。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.join(os.homedir(), '.codex');
const STALE_MS = 15 * 60000, SUB_MS = 5 * 60000, MAX_FILES = 300;
let SHOW_MS = 2 * 3600000;
// 同 folder-hash.mjs 同一算法：正規化絕對路徑（正斜線、去尾斜線、Windows 大小寫不分）嘅 SHA-256
const normFolder = p => { const s = path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? s.toLowerCase() : s; };
const folderHash = p => crypto.createHash('sha256').update(normFolder(p)).digest('hex');
function inScope(cwd, hashes) {
  for (let p = path.resolve(cwd), i = 0; i < 64; i++) {
    if (hashes.has(folderHash(p))) return true;
    const up = path.dirname(p);
    if (up === p) return false;
    p = up;
  }
  return false;
}
const pad = n => String(n).padStart(2, '0');
function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } }

// 讀頭一行（session_meta 可以好長，最多讀 4 MB）
function firstLine(f) {
  const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(65536), parts = [];
  try {
    for (let pos = 0, total = 0; total < 4 * 1024 * 1024;) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      const i = buf.subarray(0, n).indexOf(10);
      if (i >= 0) { parts.push(Buffer.from(buf.subarray(0, i))); break; }
      parts.push(Buffer.from(buf.subarray(0, n))); pos += n; total += n;
    }
  } finally { fs.closeSync(fd); }
  return Buffer.concat(parts).toString('utf8');
}
// 讀尾段（最後 256 KB）入面嘅 event_msg 類型
function lastEvents(f) {
  const size = fs.statSync(f).size, len = Math.min(size, 256 * 1024), fd = fs.openSync(f, 'r'), buf = Buffer.alloc(len);
  try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
  const out = [];
  for (const l of buf.toString('utf8').split('\n')) {
    if (!l.includes('"event_msg"')) continue;
    try { const j = JSON.parse(l); if (j.type === 'event_msg' && j.payload) out.push({ type: j.payload.type }); } catch { }
  }
  return out;
}
function threadNames(ids) {
  const names = {}, f = path.join(ROOT, 'session_index.jsonl');
  try {
    const size = fs.statSync(f).size, len = Math.min(size, 1024 * 1024), fd = fs.openSync(f, 'r'), buf = Buffer.alloc(len);
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    for (const l of buf.toString('utf8').split('\n')) { try { const j = JSON.parse(l); if (ids.has(j.id) && typeof j.thread_name === 'string') names[j.id] = j.thread_name; } catch { } }
  } catch { }
  return names;
}

function main() {
  const input = readStdin(), hashes = new Set((input.folders || []).map(f => f && typeof f.hash === 'string' && /^[a-f0-9]{64}$/.test(f.hash) ? f.hash : null).filter(Boolean));
  if (Number(input.showHours) > 0) SHOW_MS = Math.min(72, Number(input.showHours)) * 3600000; // 只供測試：用歷史紀錄核對讀法
  const out = { ok: true, host: 'codex', sessions: [], problems: [] };
  const base = path.join(ROOT, 'sessions');
  if (!hashes.size) { process.stdout.write(JSON.stringify(out) + '\n'); return; }
  if (!fs.existsSync(base)) { out.ok = false; out.unavailable = true; process.stdout.write(JSON.stringify(out) + '\n'); return; }
  const now = Date.now(), files = [];
  for (let back = 0; back * 86400000 <= SHOW_MS + 86400000; back++) {
    const d = new Date(now - back * 86400000), dir = path.join(base, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()));
    let list = [];
    try { list = fs.readdirSync(dir).filter(f => /^rollout-.*\.jsonl$/.test(f)); } catch { continue; }
    for (const f of list) { const p = path.join(dir, f); let t = 0; try { t = fs.statSync(p).mtimeMs; } catch { } if (now - t <= SHOW_MS) files.push({ p, t }); }
  }
  if (files.length > MAX_FILES) { out.problems.push('會話太多，只查看最近 ' + MAX_FILES + ' 個'); files.sort((a, b) => b.t - a.t).length = MAX_FILES; }
  const found = [];
  for (const { p, t } of files) {
    let meta;
    try { const j = JSON.parse(firstLine(p)); meta = j.type === 'session_meta' ? j.payload : null; } catch { meta = null; }
    if (!meta || typeof meta.cwd !== 'string' || !path.isAbsolute(meta.cwd) || !inScope(meta.cwd, hashes)) continue;
    let ev = [];
    try { ev = lastEvents(p); } catch { out.problems.push('有會話紀錄讀取不到'); continue; }
    const last = [...ev].reverse().find(e => ['task_started', 'task_complete', 'turn_aborted'].includes(e.type));
    let state, reason;
    if (!last) { state = 'unknown'; reason = '未見開始或完成事件'; }
    else if (last.type === 'task_started') { if (now - t <= STALE_MS) { state = 'working'; reason = '已開始，未見完成'; } else { state = 'unknown'; reason = '已開始，但 15 分鐘內沒有新事件'; } }
    else if (last.type === 'task_complete') { state = 'idle'; reason = '上一個要求已完成'; }
    else { state = 'stopped'; reason = '上一個要求中途停止'; }
    found.push({ id: String(meta.id || meta.session_id || p), parent: meta.parent_thread_id ? String(meta.parent_thread_id) : '', state, reason, t });
  }
  const names = threadNames(new Set(found.map(x => x.id)));
  const ids = new Set(found.map(x => x.id));
  for (const s of found) {
    if (s.parent && ids.has(s.parent)) continue;
    const kids = found.filter(k => k.parent === s.id && k.state === 'working' && now - k.t <= SUB_MS);
    out.sessions.push({
      key: crypto.createHash('sha256').update('codex:' + s.id).digest('hex').slice(0, 12),
      host: 'codex', kind: 'interactive', state: s.state === 'idle' && kids.length ? 'working' : s.state,
      title: names[s.id] || '', latestRequest: '', lastActiveAt: new Date(Math.max(s.t, ...kids.map(k => k.t))).toISOString(), reportedAt: new Date(now).toISOString(),
      child: !!s.parent, isRun: false, taskIds: [],
      reason: s.state === 'idle' && kids.length ? '主會話完成，子會話工作中' : s.reason,
      subagents: { active: kids.length, windowMinutes: SUB_MS / 60000 }
    });
  }
  process.stdout.write(JSON.stringify(out) + '\n');
}
main();
