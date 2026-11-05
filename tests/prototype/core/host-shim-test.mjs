// AI 工具啟動殼測試（2026-10-29 Codex 核實後）：Windows 用 npm 裝嘅 AI 工具喺 PATH 只係 .cmd 啟動殼（例如 codex.cmd）。
// host-lib 要解析出殼背後嘅 node 腳本直接開（唔經命令殼，提示文字唔會被當指令）；解析唔到就當未安裝，設定頁同認證第 1 項寫明原因。
// 全部用假工具（暫存資料夾入面嘅假 npm 殼同假腳本），唔開真 AI、零費用。只喺 Windows 有意義，其他系統記一項略過。
// 用法：node host-shim-test.mjs <原型資料夾> <輸出資料夾> <port>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
let srv = null;
try {
  if (process.platform !== 'win32') { ok('非 Windows：npm 啟動殼只喺 Windows 出現，略過', true); throw null; }
  /* 假 npm 安裝：bin/fooai.cmd（npm 殼格式）→ bin/node_modules/fooai/bin/fooai.js；另有同名冇副檔名嘅 sh 殼（唔可以揀中） */
  const BIN = path.join(OUT, 'bin'), JS = path.join(BIN, 'node_modules', 'fooai', 'bin', 'fooai.js');
  fs.mkdirSync(path.dirname(JS), { recursive: true });
  const shim = name => ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\${name}\\bin\\${name}.js" %*`, ''].join('\r\n');
  fs.writeFileSync(path.join(BIN, 'fooai.cmd'), shim('fooai'));
  fs.writeFileSync(path.join(BIN, 'fooai'), '#!/bin/sh\nexec node "$basedir/node_modules/fooai/bin/fooai.js" "$@"\n');
  // 假工具：--version 印版本；其他就將收到嘅參數寫入工作資料夾 args.json，再寫 -o 指定嘅輸出檔
  fs.writeFileSync(JS, [
    "const fs = require('fs'), path = require('path'); const a = process.argv.slice(2);",
    "if (a[0] === '--version') { console.log('fooai 1.2.3'); process.exit(0); }",
    "fs.writeFileSync(path.join(process.cwd(), 'args.json'), JSON.stringify(a));",
    "const o = a.indexOf('-o'); if (o >= 0) fs.writeFileSync(a[o + 1], 'done');",
    "console.log(JSON.stringify({ is_error: false }));"].join('\n'));
  fs.writeFileSync(path.join(BIN, 'badai.cmd'), '@echo off\r\necho 唔係 npm 殼\r\n');
  fs.writeFileSync(path.join(BIN, 'goneai.cmd'), shim('goneai'));
  process.env.PATH = BIN + ';' + process.env.PATH;
  const L = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);

  const r = L.resolveCommand('fooai');
  ok('npm 殼：解析成 node 直接開殼背後嘅腳本（唔揀冇副檔名嘅 sh 殼、唔經命令殼）', r.command === process.execPath && r.prefix.length === 1 && path.resolve(r.prefix[0]) === path.resolve(JS) && !r.why, r);
  const foo = { id: 'fooai', command: 'fooai', args: ['-o', '{outfile}', '{prompt}'], versionArgs: ['--version'], outputFile: 'last-message.txt', timeoutMinutes: 1 };
  ok('讀得到版本（設定頁當已安裝）', L.version(foo) === 'fooai 1.2.3', L.version(foo));
  const SB = path.join(OUT, 'sandbox'); fs.mkdirSync(SB);
  const prompt = '安全測試 & echo HACKED > pwned.txt | type "%PATH%"';
  const ex = await L.execute(foo, SB, prompt);
  let got = null; try { got = JSON.parse(fs.readFileSync(path.join(SB, 'args.json'), 'utf8')); } catch { }
  ok('經解析出嘅程式執行 AI 工作：成功、輸出檔寫入工作資料夾', ex.ok && fs.readFileSync(path.join(SB, 'last-message.txt'), 'utf8') === 'done', { ex, got });
  const pwned = [SB, OUT, BIN, process.cwd()].some(d => fs.existsSync(path.join(d, 'pwned.txt')));
  ok('提示文字原封不動交到工具（一個參數），冇被命令殼解讀', !!got && got[got.length - 1] === prompt && !pwned, { last: got && got[got.length - 1], pwned });

  const bad = L.resolveCommand('badai'), gone = L.resolveCommand('goneai');
  ok('認唔出嘅 .cmd：唔開、當未安裝，原因講明唔會經命令視窗啟動', !!bad.why && /不會經命令視窗啟動/.test(bad.why) && L.version({ command: 'badai' }) === '', bad);
  ok('殼指向嘅程式唔存在：當未安裝，原因講明程式不存在', !!gone.why && /不存在/.test(gone.why) && L.version({ command: 'goneai' }) === '', gone);
  const exBad = await L.execute({ ...foo, command: 'badai' }, SB, prompt);
  ok('認唔出嘅 .cmd 唔會執行 AI 工作', exBad.ok === false, exBad);
  const declared = crypto.createHash('sha256').update(JSON.stringify(['v2', foo.command, foo.args, foo.chat?.args || null, foo.env || null, foo.sandboxProbe || null, foo.required || null, foo.modelsProbe || null, foo.modelsCache || null, foo.loginProbe || null, foo.versionArgs || null, foo.certify || null])).digest('hex');
  ok('v2 認證雜湊用宣告命令同安全範本，唔用解析結果', L.hashHost(foo) === declared, { got: L.hashHost(foo), declared });

  /* 伺服器設定頁資料：認唔出嘅工具 installed:false 連原因 */
  const ADP = path.join(OUT, 'badai.json');
  fs.writeFileSync(ADP, JSON.stringify({ id: 'test', label: '測試工具', command: 'badai', args: [], versionArgs: ['--version'] }));
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: path.join(OUT, 'data'), SOS_ADAPTER: ADP, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await usePass(`http://127.0.0.1:${PORT}`);
  let s = null; for (let i = 0; i < 60 && !s; i++) { await sleep(500); try { s = await (await fetch(`http://127.0.0.1:${PORT}/api/setup`)).json(); } catch { } }
  const t = s && (s.hosts || []).find(x => x.id === 'test');
  ok('設定頁資料：認唔出嘅工具未安裝並附原因', !!t && t.installed === false && /不會經命令視窗啟動/.test(t.why || ''), s && s.hosts);
  const ask = fs.readFileSync(path.join(PROTO, 'ask.html'), 'utf8');
  ok('設定頁會顯示原因（「此電腦未能使用」一句同工具按鈕）', /x\.why \|\| '未安裝，或此電腦未支援'/.test(ask) && /x\.why \? h\(/.test(ask));
} catch (e) {
  if (e !== null) ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  if (srv) { try { srv.kill(); } catch { } await sleep(500); }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
