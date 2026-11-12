// 插件打包測試（MVP 規格 2026-10-29 第 2 節第 6 項）：
// (1) 插件入面嘅 program/ 同原型喺同一排除清單下逐檔雜湊一致（唔一致即失敗，防止插件內程式落後；要重跑 adapters/claude-code/build-plugin.mjs）；
// (2) 將成個 adapters/claude-code/ 複製去原型以外嘅暫存位置，喺嗰度執行 program/install.mjs <空資料夾>：裝得到、開得到 CrewZero、資料寫入新安裝嘅 data/；
// (3) 複製出去嘅插件資料夾，掃描本機絕對路徑同開發資料夾名，結果要係零。假 AI、零費用。
// 用法：node plugin-bundle-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installPass } from '../lib/testkit.mjs';
let unpair = () => { };
const [PROTO, OUT, PORT, FAKE] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const rules = await import(pathToFileURL(path.join(PROTO, 'bundle-rules.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = root => { const out = []; (function w(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name, p = path.join(d, e.name); if (e.isDirectory()) w(p, r); else out.push(r); } })(root, ''); return out.sort(); };
const PLUGIN_SRC = path.join(PROTO, 'adapters', 'claude-code');
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_/.test(k))), SOS_PORT: String(PORT), SOS_NO_OPEN: '1', SOS_ADAPTER: FAKE };
const AWAY = fs.mkdtempSync(path.join(os.tmpdir(), 'sos-plugin-'));
let pid = 0;
try {
  /* (1) program/ 同原型一致 */
  const PROG = path.join(PLUGIN_SRC, 'crewzero', 'program');
  const want = rules.programFiles(PROTO);
  const have = fs.existsSync(PROG) ? files(PROG).filter(f => f !== 'MANIFEST.sha256') : [];
  const diff = { missing: want.filter(f => !have.includes(f)), extra: have.filter(f => !want.includes(f)), changed: want.filter(f => have.includes(f) && sha(path.join(PROG, f)) !== sha(path.join(PROTO, f))) };
  const attr = spawnSync('git', ['check-attr', 'text', '--', 'adapters/claude-code/crewzero/program/ask.html'], { cwd: PROTO, encoding: 'utf8' });
  ok('插件程式下載時不可轉換換行符（校驗清單按位元組）', attr.status === 0 && /text: unset/.test(attr.stdout), attr.stdout);
  ok('插件入面嘅程式（program/）同原型逐檔一致（同一排除清單）；唔一致請重跑 build-plugin.mjs', want.length > 0 && !diff.missing.length && !diff.extra.length && !diff.changed.length, diff);
  const man = fs.existsSync(path.join(PROG, 'MANIFEST.sha256')) ? fs.readFileSync(path.join(PROG, 'MANIFEST.sha256'), 'utf8').trim().split(/\r?\n/).map(l => l.split('  ')) : [];
  ok('MANIFEST.sha256 列齊每個程式檔同正確雜湊', man.length === want.length && man.every(([h, f]) => want.includes(f) && sha(path.join(PROG, f)) === h), man.length + ' vs ' + want.length);
  const pj = JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, 'crewzero', '.claude-plugin', 'plugin.json'), 'utf8')), mk = JSON.parse(fs.readFileSync(path.join(PLUGIN_SRC, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const LIC_SHA = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30', PLUGIN_ROOT = path.join(PLUGIN_SRC, 'crewzero');
  const licOk = fs.existsSync(path.join(PLUGIN_ROOT, 'LICENSE')) && sha(path.join(PLUGIN_ROOT, 'LICENSE')) === LIC_SHA, noticeOk = fs.existsSync(path.join(PLUGIN_ROOT, 'NOTICE')) && fs.readFileSync(path.join(PLUGIN_ROOT, 'NOTICE'), 'utf8').includes('由 Adam Chan 製作');
  ok('插件根目錄有 Apache-2.0 LICENSE（雜湊等於官方原文）及 NOTICE（含作者聲明），plugin.json 的 license 是 Apache-2.0', licOk && noticeOk && pj.license === 'Apache-2.0', { license: licOk, notice: noticeOk, pluginJson: pj.license });
  ok('插件資訊檔同市集檔版本一致', pj.version === mk.version && mk.plugins.every(p => p.version === pj.version), { plugin: pj.version, market: mk.version });
  // 0.43.0 加入「加延伸功能」（extend）：規劃書 DESIGN-results-and-extensions-2026-11-10 第 316 行「插件加一個入口『加延伸功能』」
  const SKILL_NAMES = ['install', 'dashboard', 'discuss', 'update', 'extend'];
  const skills = SKILL_NAMES.map(s => path.join(PLUGIN_SRC, 'crewzero', 'skills', s, 'SKILL.md'));
  ok('五個指令齊（install、dashboard、discuss、update、extend），舊的 desk 指令已移除', skills.every(f => fs.existsSync(f)) && !fs.existsSync(path.join(PLUGIN_SRC, 'crewzero', 'skills', 'desk')) && fs.readdirSync(path.join(PLUGIN_SRC, 'crewzero', 'skills')).sort().join() === [...SKILL_NAMES].sort().join(), skills.filter(f => !fs.existsSync(f)));
  const sk = Object.fromEntries(SKILL_NAMES.map((s, i) => [s, fs.existsSync(skills[i]) ? fs.readFileSync(skills[i], 'utf8') : '']));
  ok('install 技能：安裝前講明會登記觀察資料夾，最後一步用 --dashboard --observe 登記項目根（唔使創辦人貼路徑）', /觀察資料夾/.test(sk.install) && /--dashboard --observe "<項目根>"/.test(sk.install));
  ok('update 技能：寫入前先檢查再停等創辦人答「好」、用 --apply 執行、有「還原上一個版本」、唔手改 data/', /--apply/.test(sk.update) && /還原上一個版本/.test(sk.update) && /--rollback/.test(sk.update) && /好嗎/.test(sk.update) && sk.update.includes('<安裝>/data/') && fs.existsSync(path.join(PLUGIN_SRC, 'crewzero', 'program', 'update.mjs')));
  ok('dashboard 技能：問題包草稿寫去系統暫存資料夾、唔寫入項目資料夾，放上之後刪走', /系統暫存資料夾/.test(sk.dashboard) && /唔好存喺項目資料夾/.test(sk.dashboard) && /刪走/.test(sk.dashboard) && !/存喺你而家嘅工作資料夾/.test(sk.dashboard));
  ok('discuss 技能：草稿寫去系統暫存資料夾、唔寫入項目資料夾，交出之後刪走', /系統暫存資料夾/.test(sk.discuss) && /唔好存喺項目資料夾/.test(sk.discuss) && /刪走/.test(sk.discuss));

  /* (2) 喺原型以外嘅位置用插件附帶嘅程式安裝 */
  const COPY = path.join(AWAY, 'claude-code');
  fs.cpSync(PLUGIN_SRC, COPY, { recursive: true });
  const outside = !path.resolve(COPY).toLowerCase().startsWith(path.resolve(path.join(PROTO, '..', '..')).toLowerCase() + path.sep);
  ok('插件複製去原型所屬項目以外嘅暫存位置', outside && fs.existsSync(path.join(COPY, 'crewzero', 'program', 'install.mjs')), COPY);
  const PROJ = path.join(AWAY, 'proj'); fs.mkdirSync(PROJ);
  const r1 = spawnSync(process.execPath, [path.join(COPY, 'crewzero', 'program', 'install.mjs'), PROJ], { encoding: 'utf8', env, cwd: AWAY });
  const T = path.join(PROJ, 'crewzero');
  ok('喺嗰度執行 program/install.mjs <空資料夾>：安裝成功，VERSION 取自插件資訊檔', r1.status === 0 && fs.existsSync(path.join(T, 'ask.mjs')) && fs.readFileSync(path.join(T, 'VERSION'), 'utf8').trim() === pj.version && fs.readdirSync(path.join(T, 'data')).length === 0, { status: r1.status, out: r1.stdout, err: r1.stderr });
  const r2 = spawnSync(process.execPath, [path.join(T, 'ask.mjs'), '--desk'], { encoding: 'utf8', env, timeout: 30000, cwd: PROJ });
  const url = (r2.stdout.match(/http:\/\/127\.0\.0\.1:\d+\//) || [])[0];
  const st = url ? await (await fetch(url + 'api/health')).json() : {};
  pid = Number(st.pid) || 0;
  if (url) unpair = await installPass(lib.rootId(path.join(T, 'data')), url, path.join(T, 'data'));
  ok('開得到 CrewZero，伺服器用新安裝嘅 data/', !!url && /CrewZero/.test(await (await fetch(url)).text()) && st.root === lib.rootId(path.join(T, 'data')), { out: r2.stdout, root: st.root });
  const post = async (p, body) => { const r = await fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.replace(/\/$/, '') }, body: JSON.stringify(body) }); return r.status; };
  if (url) await post('api/setup', { action: 'certify', host: 'test' });
  let cert = null; for (let i = 0; url && i < 100 && !cert; i++) { await sleep(400); const s = await (await fetch(url + 'api/setup')).json(); if (s.certify && s.certify.state !== 'running') cert = s.certify; }
  ok('資料寫入新安裝嘅 data/（設定 AI 之後有認證紀錄）', cert && cert.state === 'passed' && fs.existsSync(path.join(T, 'data', 'ledger', 'adapter-cert.json')), cert);

  /* (3) 複製出去嘅插件資料夾：零本機路徑 */
  const BAD = /_Adam_Projects|Users.adam|AI-Native_Starup/i;
  const hits = files(COPY).filter(f => BAD.test(f) || BAD.test(fs.readFileSync(path.join(COPY, f), 'latin1')) || BAD.test(fs.readFileSync(path.join(COPY, f), 'utf8')));
  ok('插件資料夾掃描本機絕對路徑同開發資料夾名：零命中', !hits.length, hits);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  unpair();
  if (pid) { try { process.kill(pid); } catch { } }
  await sleep(500);
  try { fs.rmSync(AWAY, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
