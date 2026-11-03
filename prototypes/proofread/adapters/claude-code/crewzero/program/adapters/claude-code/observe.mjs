// CrewZero 觀測程式（Claude Code 轉接層；規劃書 4.12、設計稿 2026-10-28 第 3 節）
// 只讀：問 `claude agents --json` 本機有邊啲運行中會話（全部資料夾），再按雜湊篩出觀察範圍內嘅；之後只睇會話紀錄檔嘅修改時間，唔讀紀錄內容。
// 伺服器用子程序叫：stdin 傳 {"folders":[{"hash":"<sha256>","name":"<顯示名>"}, ...]}——只有雜湊，冇路徑；stdout 一行 JSON。
// 只回固定欄位：唔回路徑、唔回會話識別原文（key 係雜湊）。
//
// 觀察範圍（4.12）：會話工作資料夾用同一算法計雜湊（見 folderHash；同 folder-hash.mjs 一致，測試核對）；
//   會話喺登記資料夾入面嘅子資料夾開都算（逐層向上計雜湊比對；原型選擇，記錄喺 PROTOTYPE-HANDOFF）。
// 本機實測（CLI 2.1.306，2026-10-28）：`agents --json` 唔帶 --all、--cwd 會列出全部資料夾嘅運行中會話，
//   互動會話只有 status: busy|idle；帶 --all 而唔帶 --cwd 只列出背景會話歷史，所以唔用 --all。
// 「工作中」點判：busy 而且主紀錄或者進行中子代理紀錄 5 分鐘內有更新 → 工作中；busy 但 5 分鐘冇更新 → 待核實；idle → 閒置；
//   其他狀態 → 已停止；程序結束就唔喺清單（唔列）。
// 子代理點計（2026-10-28 實測一次真實子代理）：開始時寫 agent-*.meta.json 同 .jsonl；完成時先寫 .prefix.json。
//   所以「有 meta.json、冇 prefix.json、.jsonl 5 分鐘內有更新」先算一個（規劃書 4.12 口徑）。
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RECENT_MS = 5 * 60000, SUB_MS = 5 * 60000;
// 同 folder-hash.mjs 同一算法：正規化絕對路徑（正斜線、去尾斜線、Windows 大小寫不分）嘅 SHA-256
const normFolder = p => { const s = path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? s.toLowerCase() : s; };
const folderHash = p => crypto.createHash('sha256').update(normFolder(p)).digest('hex');
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
// 會話紀錄資料夾名：工作資料夾路徑入面每個唔係英文字母或數字嘅字元換做「-」（本機實測）
const projectDir = cwd => path.join(os.homedir(), '.claude', 'projects', String(cwd).replace(/[^A-Za-z0-9]/g, '-'));
const env = () => { const e = {}; for (const [k, v] of Object.entries(process.env)) if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CLAUDECODE|CLAUDE_CODE/i.test(k)) e[k] = v; return e; };

function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; } }
// 工作資料夾或者佢任何一層上層資料夾喺觀察範圍入面
function inScope(cwd, hashes) {
  for (let p = path.resolve(cwd), i = 0; i < 64; i++) {
    if (hashes.has(folderHash(p))) return true;
    const up = path.dirname(p);
    if (up === p) return false;
    p = up;
  }
  return false;
}

function subagents(dir, now) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return e.code === 'ENOENT' ? { active: 0, last: 0 } : null; }
  let active = 0, last = 0;
  for (const f of names) {
    const m = /^(agent-[\w-]+)\.meta\.json$/.exec(f);
    if (!m || names.includes(m[1] + '.prefix.json')) continue;
    const t = mtime(path.join(dir, m[1] + '.jsonl'));
    if (t && now - t <= SUB_MS) { active++; last = Math.max(last, t); }
  }
  return { active, last };
}

function main() {
  const hashes = new Set((readStdin().folders || []).map(f => f && typeof f.hash === 'string' && /^[a-f0-9]{64}$/.test(f.hash) ? f.hash : null).filter(Boolean));
  const out = { ok: true, host: 'claude', sessions: [], problems: [] };
  if (!hashes.size) { process.stdout.write(JSON.stringify(out) + '\n'); return; }
  const r = spawnSync('claude', ['agents', '--json'], { encoding: 'utf8', timeout: 8000, env: env(), windowsHide: true, shell: false });
  if (r.error && r.error.code === 'ENOENT') { out.ok = false; out.unavailable = true; process.stdout.write(JSON.stringify(out) + '\n'); return; }
  let list = null;
  if (r.error || r.status !== 0) out.problems.push(r.error && r.error.code === 'ETIMEDOUT' ? '讀取逾時' : '讀取失敗');
  else { try { list = JSON.parse(r.stdout); } catch { list = null; } if (!Array.isArray(list)) { list = null; out.problems.push('會話清單格式不明'); } }
  const now = Date.now(), seen = new Set();
  for (const a of list || []) {
    if (!a || typeof a.sessionId !== 'string' || typeof a.cwd !== 'string' || !path.isAbsolute(a.cwd) || seen.has(a.sessionId) || !inScope(a.cwd, hashes)) continue;
    seen.add(a.sessionId);
    const pdir = projectDir(a.cwd);
    const log = mtime(path.join(pdir, a.sessionId + '.jsonl'));
    const sub = subagents(path.join(pdir, a.sessionId, 'subagents'), now);
    const recent = Math.max(log, sub ? sub.last : 0);
    const st = String(a.status || a.state || '');
    let state, reason;
    if (st === 'busy' || st === 'running') {
      if (recent && now - recent <= RECENT_MS) { state = 'working'; reason = '近 5 分鐘有新紀錄'; }
      else { state = 'unknown'; reason = recent ? '顯示忙碌，但 5 分鐘內沒有新紀錄' : '顯示忙碌，但讀取不到會話紀錄'; }
    } else if (st === 'idle' && sub && sub.active) { state = 'working'; reason = '主會話等候中，子代理工作中'; }
    else if (st === 'idle') { state = 'idle'; reason = '等候下一個要求'; }
    else if (/done|complete|stop|exit|fail|kill/i.test(st)) { state = 'stopped'; reason = '已完成或已停止'; }
    else { state = 'unknown'; reason = '狀態未明'; }
    const s = {
      key: crypto.createHash('sha256').update('claude:' + a.sessionId).digest('hex').slice(0, 12),
      host: 'claude', kind: a.kind === 'background' ? 'background' : 'interactive', state,
      title: typeof a.name === 'string' ? a.name : '', latestRequest: '',
      lastActiveAt: recent ? new Date(recent).toISOString() : '', reportedAt: new Date(now).toISOString(), reason, child: false, isRun: false, taskIds: []
    };
    // 掃描子代理資料夾受限（讀唔到）就成欄省略，畫面唔顯示子代理數（4.12）
    if (sub) s.subagents = { active: state === 'working' ? sub.active : 0, windowMinutes: SUB_MS / 60000 };
    out.sessions.push(s);
  }
  process.stdout.write(JSON.stringify(out) + '\n');
}
main();
