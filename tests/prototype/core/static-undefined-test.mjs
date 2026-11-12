// 未定義名稱靜態檢查：以本機已有的 TypeScript 檢查器（tsc）讀原型全部 .mjs、.js 及五個頁面的腳本，
// 只保留「找不到名稱」（TS2304、TS2552）及「匯入的名稱不存在」（TS2305、TS2724）四類。
// 起因：0.43.0 的 server.mjs 用了未定義的 plain、own，收據入帳整條路回 500，而 node --check 及各線單元測試都沒有攔到。
// 用法：node static-undefined-test.mjs <原型資料夾> <輸出資料夾>
// 不加任何依賴：在 PATH 上的 tsc 旁邊或 `npm root -g` 下找 typescript/lib/tsc.js，以 node 執行；找不到即判為不通過。
// 已知限制：只認得四類代碼；`process`、`require` 等 Node 名稱在頁面腳本找不到時是 TS2580 等其他代碼，不在本檢查範圍。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertTestOut, freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';

const [PROTO_ARG, OUT] = process.argv.slice(2);
const PROTO = path.resolve(PROTO_ARG || '');
const KEEP = new Set(['TS2304', 'TS2552', 'TS2305', 'TS2724']);
const PAGES = ['dashboard.html', 'ask.html', 'proofread.html', 'pair.html', 'welcome.html'];
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });

// 頁面環境提供、但 TypeScript 的瀏覽器定義不認識的名稱（短名單；每項寫明理由，並核對理由仍然成立）
// assignedBy：該名稱由哪一句設定為 window 全域；檢查時會在原型檔案內找這句，找不到即判為名單過時
const PAGE_GLOBALS = [
  { name: 'ORBIT', assignedBy: /window\.ORBIT\s*=/, reason: 'orbit.js 以 window.ORBIT 公開運作環，監察台頁面直接使用。' },
  { name: 'SOS_MD', assignedBy: /window\.SOS_MD\s*=/, reason: 'md.js 以 window.SOS_MD 公開 Markdown 轉換，各頁面直接使用。' }
];

// .mjs 在 Node 執行：不載入瀏覽器定義（否則 name、status、event、origin 等名稱永遠「找得到」），只宣告 Node 本身提供的全域名稱
const NODE_GLOBALS = ['process', 'Buffer', 'global', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'structuredClone', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController', 'AbortSignal', 'fetch', 'Headers',
  'Request', 'Response', 'FormData', 'Blob', 'File', 'WebSocket', 'performance', 'crypto', 'atob', 'btoa', 'EventTarget', 'Event', 'DOMException',
  'MessageChannel', 'BroadcastChannel', 'navigator'];

function finish() {
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass || !result.info ? '' : '\n      ' + String(typeof result.info === 'string' ? result.info : JSON.stringify(result.info)).slice(0, 4000)));
  const passed = results.filter(result => result.pass).length;
  console.log(`\n${passed}/${results.length} 通過`);
  process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
}

// 找 tsc.js：PATH 上 tsc 所在資料夾旁的 node_modules，或 `npm root -g`；只用 node 執行，不經命令殼
function findTsc() {
  const tried = [];
  const candidates = [];
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    if (['tsc', 'tsc.cmd', 'tsc.ps1'].some(name => fs.existsSync(path.join(dir, name)))) candidates.push(path.join(dir, 'node_modules', 'typescript', 'lib', 'tsc.js'));
  }
  for (const file of candidates) { tried.push(file); if (fs.existsSync(file)) return { file, tried }; }
  // PATH 上找不到才問 npm（Windows 的 npm 是 .cmd，要經 cmd.exe 執行）
  const npm = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/c', 'npm root -g'], { encoding: 'utf8', windowsHide: true, timeout: 30000 })
    : spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 30000 });
  const root = String(npm.stdout || '').trim().split(/\r?\n/).pop();
  if (root) { const file = path.join(root, 'typescript', 'lib', 'tsc.js'); tried.push(file); if (fs.existsSync(file)) return { file, tried }; }
  return { file: '', tried };
}

// 頁面：抽出內嵌腳本（補上空行令行號與頁面相同）及以 <script src> 載入的共用檔
function pageScripts(page, temp) {
  const html = fs.readFileSync(path.join(PROTO, page), 'utf8');
  const shared = [], inline = [], missing = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let match; (match = re.exec(html)); ) {
    const attrs = match[1] || '';
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (type && !/^(?:text\/javascript|application\/javascript|module)$/i.test(type[1])) continue;
    if (src) {
      const rel = src[1].split(/[?#]/)[0].replace(/^\/+/, '');
      const file = path.join(PROTO, rel);
      if (fs.existsSync(file)) shared.push(file); else missing.push(src[1]);
      continue;
    }
    const start = match.index + match[0].indexOf('>') + 1;
    const line = html.slice(0, start).split('\n').length;
    const file = path.join(temp, `${page}.inline-${inline.length + 1}.js`);
    fs.writeFileSync(file, '\n'.repeat(line - 1) + match[2]);
    inline.push({ file, page, line });
  }
  return { shared, inline, missing };
}

function runProgram(tsc, temp, label, files, options) {
  const dir = path.join(temp, label.replace(/[^\w.-]+/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  // 自我核對：放一個必定找不到名稱的檔，tsc 必須指出它，否則這組檢查不可信
  const canary = path.join(dir, options.module ? 'canary-b.mjs' : 'canary.js');
  if (options.module) {
    fs.writeFileSync(path.join(dir, 'canary-a.mjs'), 'export const czCanaryExported = 1;\n');
    fs.writeFileSync(canary, "import { czCanaryNotExported } from './canary-a.mjs';\nczCanaryUndefinedName(czCanaryNotExported);\n");
    fs.writeFileSync(path.join(dir, 'node-globals.d.ts'), NODE_GLOBALS.map(name => `declare var ${name}: any;`).join('\n') + '\n');
  } else {
    fs.writeFileSync(canary, 'czCanaryUndefinedName();\n');
  }
  const list = [...files, ...(options.module ? [path.join(dir, 'canary-a.mjs'), path.join(dir, 'node-globals.d.ts')] : []), canary];
  const config = {
    compilerOptions: {
      allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true, types: [], target: 'es2023',
      ...(options.module ? { module: 'nodenext', moduleResolution: 'nodenext', lib: ['es2023'] } : { module: 'esnext', moduleResolution: 'bundler', lib: ['es2023', 'dom', 'dom.iterable'], moduleDetection: 'auto' })
    },
    files: list
  };
  const tsconfig = path.join(dir, 'tsconfig.json');
  fs.writeFileSync(tsconfig, JSON.stringify(config, null, 2));
  const run = spawnSync(process.execPath, [tsc, '-p', tsconfig, '--pretty', 'false'], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60000 });
  const text = String(run.stdout || '') + String(run.stderr || '');
  if (OUT) fs.writeFileSync(path.join(OUT, `tsc-${label.replace(/[^\w.-]+/g, '_')}.txt`), text);
  const diagnostics = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (m) diagnostics.push({ file: path.resolve(m[1]), line: Number(m[2]), code: m[4], message: m[5] });
  }
  // 設定錯誤（沒有檔案位置的 error TS…）或程序異常都表示這組檢查沒有真正執行
  const configErrors = text.split(/\r?\n/).filter(line => /^error TS\d+/.test(line));
  const canaryHit = diagnostics.some(d => d.file === path.resolve(canary) && KEEP.has(d.code) && /czCanaryUndefinedName/.test(d.message))
    && (!options.module || diagnostics.some(d => d.file === path.resolve(canary) && ['TS2305', 'TS2724'].includes(d.code) && /czCanaryNotExported/.test(d.message)));
  return { diagnostics: diagnostics.filter(d => d.file !== path.resolve(canary)), configErrors, canaryHit, status: run.status, error: run.error ? String(run.error.message || run.error) : '' };
}

const nameOf = message => (/'([^']+)'/.exec(message.replace(/^Module '"[^"]*"' /, '')) || [])[1] || '';

if (!fs.existsSync(path.join(PROTO, 'server.mjs'))) {
  ok('原型資料夾有 server.mjs', false, PROTO);
  finish();
} else {
  if (OUT) freshTestOut(OUT);
  const tsc = findTsc();
  ok('找到 TypeScript 檢查器（tsc）', !!tsc.file, tsc.file ? '' : '沒有可用的 typescript/lib/tsc.js；已找：' + tsc.tried.join('；'));
  if (tsc.file) {
    const temp = makeTestTemp('cz-undef-');
    try {
      const top = fs.readdirSync(PROTO, { withFileTypes: true }).filter(entry => entry.isFile());
      const mjs = top.filter(entry => entry.name.endsWith('.mjs')).map(entry => path.join(PROTO, entry.name));
      const js = top.filter(entry => entry.name.endsWith('.js')).map(entry => path.join(PROTO, entry.name));
      const programs = [{ label: 'mjs', files: mjs, module: true, origin: new Map() }];
      const loaded = new Set();
      for (const page of PAGES) {
        if (!fs.existsSync(path.join(PROTO, page))) { ok(`頁面存在：${page}`, false, path.join(PROTO, page)); continue; }
        const scripts = pageScripts(page, temp);
        scripts.shared.forEach(file => loaded.add(path.resolve(file)));
        // company-page.js 由伺服器按公司資料即時產生，不是檔案
        const missing = scripts.missing.filter(src => !/company-page\.js$/.test(src));
        ok(`${page} 載入的腳本檔都存在`, missing.length === 0, missing);
        programs.push({ label: page, files: [...scripts.shared, ...scripts.inline.map(item => item.file)], module: false, origin: new Map(scripts.inline.map(item => [path.resolve(item.file), page])) });
      }
      const lone = js.filter(file => !loaded.has(path.resolve(file)));
      if (lone.length) programs.push({ label: 'other-js', files: lone, module: false, origin: new Map() });

      const proofText = fs.readdirSync(PROTO).filter(name => /\.(?:m?js|html)$/.test(name)).map(name => fs.readFileSync(path.join(PROTO, name), 'utf8')).join('\n');
      const staleAllow = PAGE_GLOBALS.filter(item => !item.assignedBy.test(proofText)).map(item => item.name);
      ok('頁面全域名稱短名單的理由仍然成立（每項都找到 window 設定句）', staleAllow.length === 0, staleAllow);

      const seen = new Map();
      for (const program of programs) {
        const result = runProgram(tsc.file, temp, program.label, program.files, { module: program.module });
        // 有語法錯誤時 tsc 只報語法、不做名稱檢查（自我核對也不會被指出）：列出語法錯誤位置
        const syntax = result.diagnostics.filter(d => /^TS1\d{3}$/.test(d.code) && d.code !== 'TS1117').map(d => `${program.origin.get(d.file) || path.relative(PROTO, d.file)}:${d.line} ${d.code} ${d.message}`);
        ok(`${program.label}：檢查器正常執行（${program.files.length} 個檔；自我核對已被指出）`, result.canaryHit && result.configErrors.length === 0 && !result.error,
          { status: result.status, error: result.error, configErrors: result.configErrors.slice(0, 5), canaryHit: result.canaryHit, ...(syntax.length ? { syntaxErrors: syntax.slice(0, 10) } : {}) });
        const kept = result.diagnostics.filter(d => KEEP.has(d.code)).map(d => ({ ...d, name: nameOf(d.message), shown: program.origin.get(d.file) || path.relative(PROTO, d.file) }))
          .filter(d => program.module || !PAGE_GLOBALS.some(item => item.name === d.name));
        const unique = kept.filter(d => { const key = `${d.shown}:${d.line}:${d.code}:${d.name}`; if (seen.has(key)) return false; seen.set(key, true); return true; });
        ok(`${program.label}：沒有未定義名稱或不存在的匯入`, unique.length === 0, unique.map(d => `${d.shown}:${d.line} ${d.code} ${d.name}（${d.message}）`).join('\n      '));
      }
    } catch (error) {
      ok('檢查程式出錯', false, String(error && error.stack || error));
    } finally {
      try { fs.rmSync(assertTestOut(temp), { recursive: true, force: true }); } catch { }
    }
  }
  finish();
}
