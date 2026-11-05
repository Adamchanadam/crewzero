import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { dataDirs, readJSON, writeJSON, localIso, NAMES } from './ask-lib.mjs';

// 只接受這個完整設定值；不可藉 required.pairs 同步改動而放寬權限。
const AGY_SETTINGS = '{"permissions":{"deny":["command(*)","read_url(*)","execute_url(*)","mcp(*)","unsandboxed(*)","read_file({agyHome}/)"]},"allowNonWorkspaceAccess":false,"enableTerminalSandbox":true}';

export function hosts(root) {
  const hostDir = path.join(root, 'adapters', 'hosts');
  let list = [];
  // 測試／示範指定宿主時只載入該檔，避免零費用測試觸碰電腦已安裝的真 AI 工具。
  if (process.env.SOS_ADAPTER) list = [path.resolve(process.env.SOS_ADAPTER)];
  else try { list = fs.readdirSync(hostDir).filter(f => f.endsWith('.json')).sort().map(f => path.join(hostDir, f)); } catch { }
  return [...new Set(list)].map(file => { const h = readJSON(file, null); return h && { ...h, id: h.id || 'test', file, root }; }).filter(Boolean);
}
// 模型表唔影響安全限制；安全範本任何改動都要重新認證，舊雜湊只會失效一次。
export const hashHost = h => crypto.createHash('sha256').update(JSON.stringify(['v2', h.command, h.args, h.chat?.args || null, h.env || null, h.sandboxProbe || null, h.required || null, h.modelsProbe || null, h.modelsCache || null, h.loginProbe || null, h.versionArgs || null, h.certify || null])).digest('hex');
// 呢個宿主嘅 AI 工作可唔可以上網讀取（工具清單有讀網頁）
export function readsWeb(h) { const a = h && h.args || [], f = h && h.required && h.required.toolsFlag, i = f ? a.indexOf(f) : -1; return i >= 0 && String(a[i + 1] || '').split(',').includes('WebFetch'); }
// Windows：npm 裝嘅 AI 工具（例如 codex）喺 PATH 只係 .cmd 啟動殼；Node 唔經命令殼開唔到 .cmd，而經命令殼開會令提示文字被當指令解讀。
// 所以喺 PATH 搵到 .cmd／.bat 就解析出殼背後嘅 node 腳本（或者 .exe）直接開；解析唔到就當未安裝，why 寫明原因。認證雜湊照舊用宿主檔原本嘅 command。
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
function fromShim(f, cmd) {
  let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { }
  const m = [...t.matchAll(/"%~?dp0%?\\([^"]+)"\s+%\*/g)].pop();
  const target = m ? path.resolve(path.dirname(f), m[1]) : '';
  if (target && isFile(target) && /\.[cm]?js$/i.test(target)) { const own = path.join(path.dirname(f), 'node.exe'); return { command: isFile(own) ? own : process.execPath, prefix: [target] }; }
  if (target && isFile(target) && /\.exe$/i.test(target)) return { command: target, prefix: [] };
  return { command: cmd, prefix: [], why: target && !isFile(target) ? `找到 ${cmd} 的啟動檔，但它指向的程式不存在：請重新安裝 ${cmd}。` : `找到 ${cmd} 的啟動檔，但未能找出它實際啟動的程式；為免指示文字被誤當指令執行，不會經命令視窗啟動。請重新安裝 ${cmd}。` };
}
export function resolveCommand(cmd) {
  if (process.platform !== 'win32' || !cmd || /[\\/]/.test(cmd) || path.extname(cmd)) return { command: cmd, prefix: [] };
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim().toLowerCase()).filter(Boolean);
  for (const dir of (process.env.PATH || '').split(';').map(d => d.trim().replace(/^"|"$/g, '')).filter(Boolean)) {
    for (const ext of exts) {
      const f = path.join(dir, cmd + ext);
      if (!isFile(f)) continue;
      if (ext === '.exe' || ext === '.com') return { command: f, prefix: [] };
      if (ext === '.cmd' || ext === '.bat') return fromShim(f, cmd);
    }
  }
  return { command: cmd, prefix: [] };
}
function dataDirFor(h, sandbox = '') {
  if (h?.root) return dataDirs(h.root).data;
  // 測試假宿主未必由 hosts(root) 建立；其沙盒慣例仍係 <data>/sandbox/<run>。
  return sandbox ? path.resolve(sandbox, '..', '..') : '';
}
export function adapterValue(h, value, sandbox = '') {
  const dataDir = dataDirFor(h, sandbox);
  const codexHome = path.join(dataDir, 'codex-home');
  const agyHome = path.resolve(dataDir, 'agy-home').replace(/\\/g, '/');
  if (value === AGY_SETTINGS) {
    const settings = JSON.parse(value);
    settings.permissions.deny = settings.permissions.deny.map(rule => rule.replaceAll('{agyHome}', agyHome));
    return JSON.stringify(settings);
  }
  return String(value || '').replaceAll('{dataDir}', dataDir).replaceAll('{codexHome}', codexHome).replaceAll('{agyHome}', agyHome)
    .replaceAll('{cwd}', sandbox).replaceAll('{outfile}', sandbox ? path.join(sandbox, h.outputFile || 'last-message.txt') : '');
}
function hasDotPart(value) { return /(?:^|[\\/])\.\.?($|[\\/])/.test(String(value || '')); }
function physicalExisting(value) {
  let cur = path.resolve(value || '.');
  while (true) {
    try { return fs.realpathSync.native(cur); } catch { }
    const parent = path.dirname(cur);
    if (parent === cur) return '';
    cur = parent;
  }
}
function insideData(h, value, sandbox = '') {
  const data = dataDirFor(h, sandbox);
  if (!data || !value || hasDotPart(value)) return false;
  const base = path.resolve(data), target = path.resolve(value);
  if (target !== base && !target.startsWith(base + path.sep)) return false;
  const baseReal = physicalExisting(base), targetReal = physicalExisting(target);
  if (!baseReal || !targetReal) return true; // 尚未建立時，已拒絕點段及文字路徑逃逸。
  const fold = s => process.platform === 'win32' ? s.toLocaleLowerCase('en-US') : s;
  return fold(targetReal) === fold(baseReal) || fold(targetReal).startsWith(fold(baseReal) + path.sep);
}
function isolatedHomesAreSafe(h, sandbox = '') {
  if (!h?.env) return true;
  const blocked = [
    'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md', 'config.toml', 'settings.json',
    path.join('.gemini', 'AGENTS.md'), path.join('.gemini', 'GEMINI.md'),
    path.join('.gemini', 'config', 'AGENTS.md'), path.join('.gemini', 'config', 'GEMINI.md'),
    path.join('.gemini', 'antigravity-cli', 'settings.json')
  ];
  for (const value of Object.values(h.env)) {
    if (typeof value !== 'string' || !/^\{dataDir\}(?:[\\/]|$)/.test(value) || hasDotPart(value)) return false;
    const home = adapterValue(h, value, sandbox);
    if (!insideData(h, home, sandbox)) return false;
    for (const name of blocked) if (fs.existsSync(path.join(home, name))) return false;
  }
  return true;
}
// 每次子程序都用同一份乾淨環境；隔離 home 必須在啟動前存在，否則 Codex 會拒絕使用它。
export function adapterEnv(h, sandbox = '') {
  const env = cleanEnv();
  if (!isolatedHomesAreSafe(h, sandbox)) return env;
  for (const [key, value] of Object.entries(h?.env || {})) {
    const target = adapterValue(h, value, sandbox);
    if (!target || !insideData(h, target, sandbox)) continue;
    fs.mkdirSync(target, { recursive: true });
    env[key] = target;
  }
  return env;
}
// Codex 的隔離 home 不保留憑證；同一個 home 可同時由工作及版本／登入探測使用。
// 以短暫鎖和每個使用者的租約協調，最後一個使用者才清理登入檔。
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const foldPath = value => process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
function samePhysicalPath(a, b) {
  try {
    const ra = fs.realpathSync.native(a), rb = fs.realpathSync.native(b);
    return foldPath(ra) === foldPath(rb);
  } catch { return foldPath(path.resolve(a)) === foldPath(path.resolve(b)); }
}
function withAuthLock(home, work) {
  const lock = path.join(home, '.startup-os-auth.lock');
  for (let n = 0; n < 100; n++) {
    try {
      fs.mkdirSync(lock);
      try { return work(); } finally { try { fs.rmdirSync(lock); } catch { } }
    } catch (e) {
      if (e?.code !== 'EEXIST') return { ok: false, reason: '無法安全準備 AI 工具登入檔。' };
      pause(20);
    }
  }
  return { ok: false, reason: 'AI 工具登入檔正由另一個程序處理，請重試。' };
}
// 活躍租約：檔名帶 PID；程序已結束嘅租約當作失效並清走（中斷嘅程序唔會永遠鎖住登入檔）
const LEASE = /^\.startup-os-auth-(\d+)-\w+\.lease$/;
function liveLeases(home) {
  const live = [];
  for (const f of fs.readdirSync(home)) {
    const m = LEASE.exec(f); if (!m) continue;
    let alive = false; try { process.kill(Number(m[1]), 0); alive = true; } catch (e) { alive = e?.code === 'EPERM'; }
    if (alive) live.push(f); else try { fs.unlinkSync(path.join(home, f)); } catch { }
  }
  return live;
}
function authHandoff(h, sandbox = '') {
  if (h?.id !== 'codex' || !h?.env?.CODEX_HOME) return { ok: true, cleanup: () => { } };
  const home = adapterValue(h, h.env.CODEX_HOME, sandbox);
  if (!insideData(h, home, sandbox)) return { ok: false, reason: '隔離登入資料夾不安全。', cleanup: () => { } };
  // 測試用 SOS_CODEX_AUTH 指向合成檔，永遠唔連結真登入檔
  const source = process.env.SOS_CODEX_AUTH || path.join(os.homedir(), '.codex', 'auth.json'), target = path.join(home, 'auth.json');
  // cap_sid（只有 Windows 有）必須跟隨登入來源；隔離 home 只在活躍租約期間持有硬連結（跨磁碟才複製）。
  const winCap = process.platform === 'win32';
  const capSource = path.join(path.dirname(source), 'cap_sid'), capTarget = path.join(home, 'cap_sid');
  const entries = [
    { source, target, marker: target + '.startup-os-managed' },
    ...(winCap ? [{ source: capSource, target: capTarget, marker: capTarget + '.startup-os-managed' }] : [])
  ];
  const lease = path.join(home, `.startup-os-auth-${process.pid}-${crypto.randomBytes(8).toString('hex')}.lease`);
  try { fs.mkdirSync(home, { recursive: true }); } catch { return { ok: false, reason: '無法建立隔離登入資料夾。', cleanup: () => { } }; }
  // source 與 target 相同（包括符號連結的同一實體）時，絕不可先清理 target。
  if (samePhysicalPath(source, target)) return { ok: true, cleanup: () => { } };
  const prepared = withAuthLock(home, () => {
    const made = [];
    const remove = entry => { try { fs.unlinkSync(entry.target); } catch { } try { fs.unlinkSync(entry.marker); } catch { } };
    try {
      if (!fs.statSync(source).isFile() || (winCap && !fs.statSync(capSource).isFile())) return { ok: false, reason: '找不到 AI 工具登入資料：請先在該 AI 工具正常登入並使用一次，再按重試。' };
      const leases = liveLeases(home);
      if (entries.some(entry => fs.existsSync(entry.target) && !fs.existsSync(entry.marker))) return { ok: false, reason: '隔離登入檔狀態不明，未有啟動 AI 工具。' };
      if (!leases.length) for (const entry of entries) if (fs.existsSync(entry.marker)) remove(entry);
      for (const entry of entries) if (!fs.existsSync(entry.target)) {
        try { fs.linkSync(entry.source, entry.target); }
        catch (e) {
          if (!['EXDEV', 'EPERM', 'EOPNOTSUPP', 'ENOTSUP'].includes(e?.code)) throw e;
          fs.copyFileSync(entry.source, entry.target, fs.constants.COPYFILE_EXCL);
        }
        made.push(entry);
        fs.writeFileSync(entry.marker, 'managed');
      }
      fs.writeFileSync(lease, 'active', { flag: 'wx' });
      return { ok: true };
    } catch {
      // 交接失敗：收回今次建立嘅租約；登入檔與沙盒身份檔同樣不留在 data。
      try { fs.unlinkSync(lease); } catch { }
      if (made.length && !liveLeases(home).length) made.forEach(remove);
      return { ok: false, reason: '無法安全準備 AI 工具登入檔。' };
    }
  });
  if (!prepared.ok) return { ...prepared, cleanup: () => { } };
  return {
    ok: true,
    cleanup: () => {
      withAuthLock(home, () => {
        try { fs.unlinkSync(lease); } catch { }
        const active = liveLeases(home).length > 0;
        if (!active) for (const entry of entries) if (fs.existsSync(entry.marker) && !samePhysicalPath(entry.source, entry.target)) {
          try { fs.unlinkSync(entry.target); } catch { }
          try { fs.unlinkSync(entry.marker); } catch { }
        }
        return { ok: true };
      });
    }
  };
}
export function preparedAdapter(h, sandbox = '') {
  const env = adapterEnv(h, sandbox), handoff = authHandoff(h, sandbox);
  return { env, cleanup: handoff.cleanup, handoff };
}
// Codex 的 sandbox 子命令不會呼叫模型；認證可用它驗證實際檔案邊界。
export function sandboxProbe(h, sandbox, target, content = 'startup-os-sandbox-probe') {
  const probe = h?.sandboxProbe;
  if (!probe || typeof probe.command !== 'string' || !probe.command || !Array.isArray(probe.args)) return Promise.resolve({ ok: false, code: null, reason: 'AI 工具設定缺少安全限制檢查。' });
  const command = adapterValue(h, probe.command, sandbox);
  const c = resolveCommand(command);
  if (c.why) return Promise.resolve({ ok: false, code: null, reason: c.why });
  const argList = process.platform !== 'win32' && Array.isArray(probe.posixArgs) ? probe.posixArgs : probe.args;
  const args = argList.map(value => adapterValue(h, value, sandbox).replaceAll('{target}', String(target)).replaceAll('{content}', String(content)));
  const prepared = preparedAdapter(h, sandbox);
  if (!prepared.handoff.ok) { prepared.cleanup(); return Promise.resolve({ ok: false, code: null, reason: prepared.handoff.reason || '無法安全準備 AI 工具登入。' }); }
  return new Promise(resolve => {
    let child, settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); prepared.cleanup(); resolve(result); };
    const timer = setTimeout(() => { try { child?.kill(); } catch { } finish({ ok: false, code: null, timedOut: true, reason: '安全限制檢查逾時。' }); }, Number(probe.timeoutMs) || 15000);
    let said = '';
    try { child = spawn(c.command, [...c.prefix, ...args], { cwd: sandbox, env: prepared.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); child.stdout.on('data', d => { said += d; }); child.stderr.on('data', d => { said += d; }); }
    catch { finish({ ok: false, code: null, reason: '無法啟動安全限制檢查。' }); return; }
    child.on('error', () => finish({ ok: false, code: null, reason: '無法啟動安全限制檢查。' }));
    child.on('close', code => finish({ ok: code === 0, code, output: said.slice(-4000) }));
  });
}
export function version(h) {
  const c = resolveCommand(h.command);
  if (c.why) return '';
  if (!restrictions(h)) return '';
  const prepared = preparedAdapter(h);
  if (!prepared.handoff.ok) { prepared.cleanup(); return ''; }
  try { const r = spawnSync(c.command, [...c.prefix, ...(h.versionArgs || ['--version'])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 10000, env: prepared.env }); return r.status === 0 ? (r.stdout || r.stderr).trim() : ''; } catch { return ''; } finally { prepared.cleanup(); }
}
export function login(h) {
  const probe = h?.loginProbe;
  if (!probe || !Array.isArray(probe.args)) return null;
  const c = resolveCommand(h.command);
  if (c.why) return false;
  if (!restrictions(h)) return false;
  const prepared = preparedAdapter(h);
  if (!prepared.handoff.ok) { prepared.cleanup(); return false; }
  try {
    const r = spawnSync(c.command, [...c.prefix, ...probe.args.map(String)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 15000, env: prepared.env });
    return r.status === (Number.isInteger(probe.okExit) ? probe.okExit : 0);
  } catch { return false; } finally { prepared.cleanup(); }
}
function normalizedArgs(args, required) {
  const aliases = new Map();
  for (const [canonical, names] of Object.entries(required?.aliases || {})) {
    aliases.set(String(canonical), String(canonical));
    for (const name of Array.isArray(names) ? names : []) aliases.set(String(name), String(canonical));
  }
  const out = [];
  for (const raw of args.map(String)) {
    const eq = /^--?[\w-]+=/.test(raw) ? raw.indexOf('=') : -1, flag = eq >= 0 ? raw.slice(0, eq) : raw, canonical = aliases.get(flag) || flag;
    out.push(canonical);
    if (eq >= 0) out.push(raw.slice(eq + 1));
  }
  return out;
}
function pairedArgsAreSafe(args, required) {
  const pairs = Array.isArray(required?.pairs) ? required.pairs : [];
  const allowed = new Map();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [flag, value] = pair.map(String);
    if (!allowed.has(flag)) allowed.set(flag, new Set());
    allowed.get(flag).add(value);
  }
  for (const [flag, values] of allowed) {
    const seen = new Map();
    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]);
      if (arg === flag) {
        const value = String(args[++i] ?? '');
        if (!values.has(value)) return false;
        seen.set(value, (seen.get(value) || 0) + 1);
      } else if (arg.startsWith(flag + '=')) return false;
    }
    for (const value of values) if (seen.get(value) !== 1) return false;
  }
  return true;
}
export const validModel = model => typeof model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(model);
const validEffort = effort => ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort);
function modelsAreSafe(h) {
  if (h.args !== undefined && (!Array.isArray(h.args) || h.args.some(a => typeof a !== 'string'))) return false;
  // 清單探測只可以係唯讀查詢：唔准帶旗標、佔位或者提示文字
  if (h.modelsProbe && (!Array.isArray(h.modelsProbe.args) || !h.modelsProbe.args.length || h.modelsProbe.args.length > 2 || h.modelsProbe.args.some(a => typeof a !== 'string' || a.startsWith('-') || /[{}\s]/.test(a)))) return false;
  if (h.chat && [h.chat.fastModel, h.chat.reviewModel].some(m => m !== undefined && !validModel(m))) return false;
  const args = h.args || [], modelCount = args.reduce((n, a) => n + (String(a).match(/\{model\}/g) || []).length, 0);
  if (args.some((a, i) => a.includes('{agyHome}') && !(h.id === 'agy' && a === AGY_SETTINGS && args[i - 1] === '--settings'))) return false;
  const effortArgs = args.filter(a => String(a).includes('{effort}'));
  if (!Object.hasOwn(h, 'models')) return modelCount === 0 && effortArgs.length === 0;
  const table = h.models;
  if (!table || typeof table !== 'object' || Array.isArray(table) || !Array.isArray(table.everyday)) return false;
  const mi = args.indexOf('{model}');
  if (modelCount !== 1 || mi < 1 || args[mi - 1] !== '--model' || args.filter(a => a === '--model' || String(a).startsWith('--model=')).length !== 1) return false;
  if (effortArgs.length > 1 || effortArgs.some(a => a !== 'model_reasoning_effort="{effort}"')) return false;
  return Object.entries(table).filter(([k]) => !['note', 'timeoutMinutes'].includes(k)).every(([, list]) => Array.isArray(list) && list.length > 0 && list.every(c => c && validModel(c.model) && (c.effort === undefined ? !effortArgs.length : validEffort(c.effort))));
}
export function restrictions(h) {
  if (!h || !modelsAreSafe(h)) return false;
  if (h.id === 'agy') {
    const args = h.args || [], at = args.indexOf('--settings');
    if (at < 0 || args[at + 1] !== AGY_SETTINGS || args.filter(a => a === '--settings' || a.startsWith('--settings=')).length !== 1 ||
      !(h.required?.pairs || []).some(pair => pair?.[0] === '--settings' && pair?.[1] === AGY_SETTINGS)) return false;
  }
  const r = h.required || {}, a = normalizedArgs(h.args || [], r);
  const banned = [...(r.mustNotHave || []), ...(r.forbiddenFlags || [])].map(String);
  if ((r.mustHave || []).some(x => !a.includes(x)) || banned.some(x => a.some(v => String(v) === x || String(v).startsWith(x + '='))) || !pairedArgsAreSafe(a, r)) return false;
  // 工具清單只可以出現一次（第二個清單或等號寫法可能蓋過第一個）
  if (r.toolsFlag) { const i = a.indexOf(r.toolsFlag); if (i < 0 || !a[i + 1] || a.filter(v => String(v) === r.toolsFlag || String(v).startsWith(r.toolsFlag + '=')).length !== 1 || a[i + 1].split(',').some(t => !(r.toolsAllowed || []).includes(t))) return false; }
  // 網絡：允許清單只可以係網上搜尋同讀網頁；可以讀網頁就一定要明確禁止本機同私人網段（規劃書 5.2 第 3 點）
  const ai = a.indexOf('--allowedTools');
  if (ai >= 0) { for (let i = ai + 1; i < a.length && !a[i].startsWith('--'); i++) if (!(r.webTools || []).includes(a[i])) return false; }
  if (readsWeb(h) && (r.mustDeny || []).some(x => !a.includes(`WebFetch(domain:${x})`))) return false;
  return isolatedHomesAreSafe(h);
}
// 認證紀錄是否仍然適用於現在的設定（不開工具查版本，頁面每次讀回都可以用）
export function certCurrent(root, ledger) {
  const cert = readJSON(path.join(ledger, 'adapter-cert.json'), null);
  if (!cert) return false;
  const h = hosts(root).find(x => x.id === cert.host || x.file === cert.host);
  return !!(h && restrictions(h) && hashHost(h) === cert.argsHash && cert.version);
}
export function certified(root, ledger) {
  const cert = readJSON(path.join(ledger, 'adapter-cert.json'), null);
  if (!cert) return { code: 'none', reason: 'AI 工具未設定，設定好之後會自動繼續' };
  const h = hosts(root).find(x => x.id === cert.host || x.file === cert.host);
  const changed = { code: 'changed', reason: 'AI 工具設定已變更，須重新認證' };
  if (!h || !restrictions(h) || hashHost(h) !== cert.argsHash || !cert.version) return changed;
  const current = version(h);
  if (current !== cert.version) return current ? { ...changed, versionOnly: true, hostId: h.id, version: current } : changed;
  return { host: h, label: cert.label || h.label || h.name || 'AI 工具' };
}
export function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH/i.test(k) && !/^CLAUDE/i.test(k) && !/^CODEX_THREAD_ID$/i.test(k)));
}
// 認證使用專用提示；一般工作使用宿主檔的提示。
export function modelCandidates(h, role = 'everyday') {
  return h?.models?.[role] || h?.models?.everyday || [];
}
// 清單只用嚟揀已批准嘅候選，唔會自動加入新模型。探測失敗就照用首選。
export function pickModel(h, role = 'everyday', ctx = {}) {
  const candidates = modelCandidates(h, role);
  if (!candidates.length) return null;
  const sandbox = ctx.sandbox || '', data = dataDirFor(h, sandbox), ledger = ctx.ledger || path.join(data, 'ledger');
  let available = null;
  if (h.modelsCache) {
    const cache = readJSON(adapterValue(h, h.modelsCache, sandbox), null);
    if (Array.isArray(cache?.models)) available = new Set(cache.models.filter(m => m && typeof m.slug === 'string' && (!m.deprecated || (Array.isArray(m.deprecated) && !m.deprecated.length))).map(m => m.slug));
  } else if (h.modelsProbe && restrictions(h)) {
    const file = path.join(ledger, 'model-list-' + h.id + '.json'), day = localIso().slice(0, 10), saved = readJSON(file, null);
    if (saved?.day === day) available = Array.isArray(saved.models) ? new Set(saved.models) : null;
    else {
      let models = null;
      const c = resolveCommand(h.command), prepared = c.why ? null : preparedAdapter(h, sandbox);
      try {
        if (prepared?.handoff.ok) {
          const r = spawnSync(c.command, [...c.prefix, ...h.modelsProbe.args], { env: prepared.env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
          if (r.status === 0) models = (r.stdout || '').split(/\r?\n/).map(l => l.trim().split(/\s+/)[0]).filter(validModel);
        }
      } catch { } finally { prepared?.cleanup(); }
      try { writeJSON(file, { day, models }); } catch { }
      if (models) available = new Set(models);
    }
  }
  return (available && candidates.find(c => available.has(c.model))) || candidates[0];
}
// 所有 AI 工作用同一組啟動參數（網絡規則都喺入面）；只係紅藍對打嘅角色換模型同時限
export function buildArgs(h, sandbox, prompt, opts = {}) {
  const outfile = path.join(sandbox, h.outputFile || 'last-message.txt');
  const candidates = modelCandidates(h, opts.role), chosen = opts.model === undefined ? candidates[0] : candidates.find(c => c.model === (typeof opts.model === 'string' ? opts.model : opts.model?.model) && (typeof opts.model === 'string' || c.effort === opts.model?.effort));
  if (h.models && (!modelsAreSafe(h) || !chosen)) throw new Error('AI 模型設定不合格');
  // 先代入模型再放提示文字，唔會改寫提示入面嘅佔位字樣。
  return h.args.map(a => adapterValue(h, a, sandbox).replaceAll('{model}', chosen?.model || '').replaceAll('{effort}', chosen?.effort || '')
    .replaceAll('{cwd}', sandbox).replaceAll('{outfile}', outfile).replaceAll('{prompt}', prompt || h.prompt || ''));
}
function hasOutput(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory() ? hasOutput(path.join(dir, e.name)) : true); }
  catch (e) { return e.code !== 'ENOENT'; }
}
function actualModel(h, meta) {
  if (h.outputFormat !== 'jsonl' && h.outputFormat !== 'stream-json') return Object.entries(meta?.modelUsage || {}).sort((a, b) => Number(b[1]?.costUSD || 0) - Number(a[1]?.costUSD || 0))[0]?.[0] || '';
  // 只認事件實際提供嘅欄位，唔由請求參數估。
  for (const event of [...(meta?.events || [])].reverse()) {
    for (const obj of [event, event.init, event.result, event.message, event.item, event.step_update]) if (typeof obj?.model === 'string') return obj.model;
  }
  return '';
}
// Claude 別名會隨工具升級；有實際代號就顯示實際版本。其他代號認唔到就用模型表名稱，唔估。
export function modelName(actual, label) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(String(actual || ''));
  return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '') : label;
}
function recordModel(h, sandbox, role, chosen, meta) {
  if (!chosen) return;
  const ledger = path.join(dataDirFor(h, sandbox), 'ledger'), file = path.join(ledger, 'model-seen.json'), seen = readJSON(file, {}), prior = seen[role];
  const now = { requested: chosen.model, label: chosen.label || chosen.model, fallback: chosen !== modelCandidates(h, role)[0], actual: actualModel(h, meta), at: localIso() };
  seen[role] = now;
  try {
    writeJSON(file, seen);
    if (prior && (now.actual !== prior.actual || now.fallback !== prior.fallback)) writeJSON(path.join(ledger, 'model-notice.json'), { id: crypto.randomUUID(), text: NAMES.t(now.fallback ? 'aiModelFallback' : 'aiModelUpdated', { model: modelName(now.actual, now.label) + (chosen.effort === 'high' ? NAMES.ui.aiDeepThinking : '') }) });
  } catch { }
}
// AI 工作失敗原因（創辦人會喺失敗卡「原因：」見到）：只按程式真係分辨到嘅訊號分類，唔估英文錯誤字句。
// 訊號：計時器到時 → 超時；啟動檔解析失敗或者系統話搵唔到程式（ENOENT）→ 搵唔到工具；其他啟動失敗 → 未能啟動；
// 工具執行完但失敗，而宿主檔有登入探測（loginProbe）且探測話未登入 → 登入失效；其餘 → 通用句（都有下一步）。
export const AI_FAIL = {
  timeout: 'Zero 處理時間過長，這次未有完成。請按「重試」。',
  notFound: '找不到 AI 工具：電腦上的 AI 工具可能已移除或搬走。請重新安裝並登入該工具，再到「系統設定」重新認證。',
  cannotStart: '未能啟動 AI 工具。請再按一次「重試」；仍然失敗，請重新開機後再試。',
  loggedOut: 'AI 工具的登入已失效。請在你的 AI 工具重新登入，再按「重試」。',
  generic: 'AI 工具未能完成這項工作。請再按一次「重試」；仍然失敗，請到「系統設定」重新認證 AI 工具。'
};
function failedReason(h) { return h?.loginProbe && login(h) === false ? AI_FAIL.loggedOut : AI_FAIL.generic; }
export async function execute(h, sandbox, prompt, opts = {}) {
  if (!restrictions(h)) return { ok: false, reason: 'AI 工具的限制設定不完整。' };
  // 認證要 AI 真係逐項嘗試：實測 Codex 平日模型（Terra）會自行判斷唔試，所以用藍方模型（冇藍方就用平日）
  const role = opts.certify ? h.certify?.role || 'blue' : opts.role || 'everyday', candidates = modelCandidates(h, role);
  const chosen = opts.certify ? candidates[0] : opts.model === undefined ? pickModel(h, role, { sandbox }) : candidates.find(c => c.model === (typeof opts.model === 'string' ? opts.model : opts.model?.model));
  let model = chosen, result;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (opts.onStart && opts.onStart({ model, attempt }) === false) return { ok: false, reason: NAMES.ui.skip_budgetExhausted };
    result = await executeOnce(h, sandbox, prompt, { ...opts, role, ...(model ? { model } : {}) });
    const next = candidates[candidates.indexOf(model) + 1];
    if (attempt || opts.certify || !next || !Number.isInteger(result.code) || result.code === 0 || result.elapsedMs > 20000 || result.timedOut || hasOutput(path.join(sandbox, 'out'))) break;
    model = next;
  }
  if (Number.isInteger(result.code)) recordModel(h, sandbox, role, model, result.meta);
  return result;
}
function executeOnce(h, sandbox, prompt, opts) {
  const args = buildArgs(h, sandbox, prompt, opts);
  if (opts.role && opts.role !== 'everyday' && Number(h.models?.timeoutMinutes) > 0) h = { ...h, timeoutMinutes: Math.min(30, Number(h.models.timeoutMinutes)) };
  // 外殼可以收短一份工作嘅時限（例如商機掃描只用每次上限嘅三分之一）
  if (Number(opts.timeoutMinutes) > 0) h = { ...h, timeoutMinutes: Math.min(h.timeoutMinutes || 10, Number(opts.timeoutMinutes)) };
  return new Promise(resolve => {
    let out = '', err = '', done = false, child;
    const started = Date.now();
    const c = resolveCommand(h.command);
    if (c.why) return resolve({ ok: false, reason: AI_FAIL.notFound });
    const prepared = preparedAdapter(h, sandbox);
    if (!prepared.handoff.ok) { prepared.cleanup(); return resolve({ ok: false, reason: prepared.handoff.reason || '無法安全準備 AI 工具登入，請重新登入後再試。' }); }
    try { child = spawn(c.command, [...c.prefix, ...args], { cwd: sandbox, env: prepared.env, stdio: ['ignore','pipe','pipe'], windowsHide: true }); }
    catch (e) { prepared.cleanup(); return resolve({ ok: false, reason: e?.code === 'ENOENT' ? AI_FAIL.notFound : AI_FAIL.cannotStart }); }
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, timedOut: true, reason: AI_FAIL.timeout }); }, (h.timeoutMinutes || 10) * 60000);
    function finish(result) { if (done) return; done = true; clearTimeout(timer); prepared.cleanup(); try { fs.writeFileSync(path.join(sandbox, 'ai-output.txt'), out + '\n' + err); } catch {} resolve(result); }
    child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { err += x; });
    child.on('error', e => finish({ ok: false, reason: e?.code === 'ENOENT' ? AI_FAIL.notFound : AI_FAIL.cannotStart }));
    child.on('close', code => {
      if (done) return;
      let meta = null;
      if (h.outputFormat === 'jsonl') {
        const events = out.split(/\r?\n/).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
        const last = [...events].reverse().find(x => x.type === 'turn.completed') || events.at(-1) || {};
        const webSearches = events.reduce((n, event) => n + (JSON.stringify(event).match(/web[_-]?search/gi) || []).length, 0);
        const denials = events.filter(event => event.type === 'item.completed' && event.item?.type === 'command_execution').map(event => event.item)
          .filter(item => Number(item.exit_code) !== 0 && /(?:denied|refused|not permitted|permission|access is denied|not authorized|operation not permitted|unauthorizedaccess)/i.test(String(item.aggregated_output || '')))
          .map(item => ({ tool_name: 'command_execution', tool_input: { command: item.command || '' }, exit_code: item.exit_code, aggregated_output: item.aggregated_output || '', status: item.status || '' }));
        meta = { ...last, events, permission_denials: [...(Array.isArray(last.permission_denials) ? last.permission_denials : []), ...denials], webSearches, usage: last.usage || last.item?.usage || null };
      } else if (h.outputFormat === 'stream-json') {
        const events = out.split(/\r?\n/).map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
        const last = [...events].reverse().find(event => event.event === 'result')?.result || {};
        const proof = h.denialProof?.streamToolEvent;
        const denials = proof ? events.filter(event => event.event === proof.event && event.step_update?.step_type === proof.stepType && (proof.rejectStates || []).map(String).includes(String(event.step_update?.state || '').toUpperCase()) && (['DENIED', 'REJECTED'].includes(String(event.step_update?.state || '').toUpperCase()) || /(?:permission|denied|not allowed|sandbox|outside (?:the )?workspace|refus)/i.test(JSON.stringify(event.step_update || {}).replace(/"parameters":{[^}]*}/, ''))))
          .map(event => ({ tool_name: event.step_update?.tool_name || event.step_update?.tool_info?.name || '', tool_input: event.step_update?.tool_info?.parameters || {}, state: event.step_update?.state || '' })) : [];
        // stream-json 只認工具事件；結果物件自帶嘅 permission_denials（其他工具格式）唔採信
        meta = { ...last, events, permission_denials: denials, usage: last.usage || null };
      } else { try { meta = JSON.parse(out); } catch {} }
      const statusOk = !meta || !Object.hasOwn(meta, 'status') || meta.status === 'SUCCESS';
      const ok = code === 0 && !meta?.is_error && statusOk;
      // 失敗先做登入探測（同認證用同一個探測；冇探測嘅宿主唔做）；探測期間計時器唔會觸發，finish 隨即清走
      finish({ ok, code, elapsedMs: Date.now() - started, meta, stderr: err, reason: ok ? '' : failedReason(h) });
    });
  });
}
