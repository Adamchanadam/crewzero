import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readJSON } from './ask-lib.mjs';

export function hosts(root) {
  const list = ['claude', 'codex'].map(id => path.join(root, 'adapters', 'hosts', id + '.json'));
  if (process.env.SOS_ADAPTER) list.push(path.resolve(process.env.SOS_ADAPTER));
  return list.map(file => { const h = readJSON(file, null); return h && { ...h, id: h.id || 'test', file }; }).filter(Boolean);
}
// 認證雜湊：啟動參數（包括網絡允許同禁止清單）同角色模型表；任何一樣改咗都要重新認證
export const hashHost = h => crypto.createHash('sha256').update(JSON.stringify(h.roles ? [h.command, h.args, null, h.roles] : [h.command, h.args])).digest('hex');
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
export function version(h) {
  const c = resolveCommand(h.command);
  if (c.why) return '';
  try { const r = spawnSync(c.command, [...c.prefix, ...(h.versionArgs || ['--version'])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 10000 }); return r.status === 0 ? (r.stdout || r.stderr).trim() : ''; } catch { return ''; }
}
export function restrictions(h) {
  const a = h.args || [], r = h.required || {};
  if ((r.mustHave || []).some(x => !a.includes(x)) || (r.mustNotHave || []).some(x => a.includes(x))) return false;
  if (r.toolsFlag) { const i = a.indexOf(r.toolsFlag); if (i < 0 || !a[i + 1] || a[i + 1].split(',').some(t => !(r.toolsAllowed || []).includes(t))) return false; }
  // 網絡：允許清單只可以係網上搜尋同讀網頁；可以讀網頁就一定要明確禁止本機同私人網段（規劃書 5.2 第 3 點）
  const ai = a.indexOf('--allowedTools');
  if (ai >= 0) { for (let i = ai + 1; i < a.length && !a[i].startsWith('--'); i++) if (!(r.webTools || []).includes(a[i])) return false; }
  if (readsWeb(h) && (r.mustDeny || []).some(x => !a.includes(`WebFetch(domain:${x})`))) return false;
  return true;
}
export function certified(root, ledger) {
  const cert = readJSON(path.join(ledger, 'adapter-cert.json'), null);
  if (!cert) return { reason: 'AI 未設定，設定好之後會自動繼續' };
  const h = hosts(root).find(x => x.id === cert.host || x.file === cert.host);
  if (!h || !restrictions(h) || hashHost(h) !== cert.argsHash || !cert.version || version(h) !== cert.version) return { reason: 'AI 工具設定已變更，須重新認證' };
  return { host: h, label: cert.label || h.label || h.name || 'AI' };
}
export function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH/i.test(k) && !/^CLAUDE/i.test(k) && !/^CODEX_THREAD_ID$/i.test(k)));
}
// prompt：認證探測用自己嘅啟動句（講明係安全測試、預期會被拒絕）；一般工作用宿主檔嘅 prompt
// opts.role：紅藍對打嘅角色（blue／red／judge），按宿主檔 roles 換 --model 嘅值同時限；其餘啟動設定（限制、工具）完全唔變
export function roleModel(h, role) {
  const r = h && h.roles || {};
  const m = typeof r[role] === 'string' && /^[\w.-]{1,40}$/.test(r[role]) ? r[role] : '';
  return m;
}
// 所有 AI 工作用同一組啟動參數（網絡規則都喺入面）；只係紅藍對打嘅角色換模型同時限
export function buildArgs(h, sandbox, prompt, opts = {}) {
  const outfile = path.join(sandbox, h.outputFile || 'last-message.txt');
  let args = h.args.map(a => a.replaceAll('{prompt}', prompt || h.prompt || '').replaceAll('{cwd}', sandbox).replaceAll('{outfile}', outfile));
  const model = opts.role ? roleModel(h, opts.role) : '';
  const mi = args.indexOf('--model');
  if (model && mi >= 0 && mi + 1 < args.length) { args = args.slice(); args[mi + 1] = model; }
  return args;
}
export function execute(h, sandbox, prompt, opts = {}) {
  const args = buildArgs(h, sandbox, prompt, opts);
  if (opts.role && h.roles && Number(h.roles.timeoutMinutes) > 0) h = { ...h, timeoutMinutes: Math.min(30, Number(h.roles.timeoutMinutes)) };
  // 外殼可以收短一份工作嘅時限（例如商機掃描只用每次上限嘅三分之一）
  if (Number(opts.timeoutMinutes) > 0) h = { ...h, timeoutMinutes: Math.min(h.timeoutMinutes || 10, Number(opts.timeoutMinutes)) };
  return new Promise(resolve => {
    let out = '', err = '', done = false, child;
    const c = resolveCommand(h.command);
    if (c.why) return resolve({ ok: false, reason: '無法啟動 AI 工具，請重試' });
    try { child = spawn(c.command, [...c.prefix, ...args], { cwd: sandbox, env: cleanEnv(), stdio: ['ignore','pipe','pipe'], windowsHide: true }); }
    catch { return resolve({ ok: false, reason: '無法啟動 AI 工具' }); }
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, reason: 'AI 處理時間過長，請重試' }); }, (h.timeoutMinutes || 10) * 60000);
    function finish(result) { if (done) return; done = true; clearTimeout(timer); try { fs.writeFileSync(path.join(sandbox, 'ai-output.txt'), out + '\n' + err); } catch {} resolve(result); }
    child.stdout.on('data', x => { out += x; }); child.stderr.on('data', x => { err += x; });
    child.on('error', () => finish({ ok: false, reason: '無法啟動 AI 工具，請重試' }));
    child.on('close', code => { let meta = null; try { meta = JSON.parse(out); } catch {} finish({ ok: code === 0 && !meta?.is_error, meta, reason: 'AI 工具發生錯誤，請重試' }); });
  });
}
