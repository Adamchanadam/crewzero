// 出錯時創辦人見到乜（2026-11-02 產品負責人兩條規則）：每個出錯提示講一個簡單原因加一個做法；畫面唔可以有英文原始錯誤、代號、路徑。
// 測：伺服器總攔截只送固定代號同中文原因（細節只入伺服器紀錄）；頁面送出失敗顯示伺服器中文原因、只有代號時按代號對照、連唔到講中文；
// 整頁讀取失敗分清搵唔到／連唔到並有掣；CrewZero 停咗而頁面開住有頁頂提示；AI 工作失敗原因按程式分辨到嘅訊號分類；頁面原始碼冇將 e.message 放上畫面。
// 用法：node error-text-test.mjs <chrome> <輸出資料夾> <原型資料夾> <port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { seedCompany, usePass } from '../lib/testkit.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';

const [CHROME, OUT, PROTO, PORT] = process.argv.slice(2);
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), U = N.ui;
const DATA = path.join(OUT, 'data'); seedCompany(DATA, PROTO);
const BASE = `http://127.0.0.1:${PORT}`;
// 英文原始錯誤、代號、路徑：畫面唔可以出現
const RAW = /Failed to fetch|Load failed|NetworkError|too large|body timeout|Unexpected|JSON|SyntaxError|TypeError|\binvalid\b|\bbusy\b|not found|pack-not-here|\blocal\b|[A-Za-z]:\\|ERR_|E(?:PERM|BUSY|NOENT|NOSPC)|HTTP \d|\b[45]\d\d\b|undefined|\bnull\b/;

let log = '', srv = null;
function start() {
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
}
const raw = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers }, body })
  .then(async r => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { } return { code: r.status, t, j }; }, e => ({ code: 0, t: String(e), j: null }));
start();
let cdp = null;
try {
  await usePass(BASE);
  /* ---- 1. 伺服器總攔截 ---- */
  const big = await raw('/api/submit', JSON.stringify({ kind: 'ask-answer', ref: 'x', text: 'a'.repeat(40 * 1024) }));
  ok('送出內容超過上限：回 413、代號 too-large、中文原因講點做；冇英文原文', big.code === 413 && big.j && big.j.error === 'too-large' && big.j.message === U.err_tooLarge && !/too large/.test(big.t), big);
  const bad = await raw('/api/submit', '{"kind": "ask-answer", bad');
  ok('送出內容唔係 JSON：回 400、代號 bad-body、中文原因；冇 Unexpected／JSON 原文', bad.code === 400 && bad.j && bad.j.error === 'bad-body' && bad.j.message === U.err_badBody && !/Unexpected|JSON/.test(bad.j.message), bad);
  ok('總攔截嘅錯誤原文只寫入伺服器自己嘅紀錄', /請求出錯/.test(log) && /too large/.test(log), log.slice(-500));
  const exe = await raw('/api/intake', JSON.stringify({ kind: 'prefill', files: [{ name: '程式.exe', data: Buffer.from('x').toString('base64') }] }));
  ok('附件類型唔收：講明邊一份、點做（另存為 PDF 或 Word）', exe.code === 400 && /「程式\.exe」/.test(exe.j && exe.j.message || '') && /另存為/.test(exe.j.message), exe);

  /* ---- 2. 頁面原始碼：冇將錯誤原文放上畫面 ---- */
  const leaks = [];
  for (const f of ['ask.html', 'proofread.html', 'dashboard.html', 'desk.js']) {
    fs.readFileSync(path.join(PROTO, f), 'utf8').split(/\r?\n/).forEach((l, i) => {
      if (/^\s*\/\//.test(l)) return;
      if (/\+\s*(?:e|er|e2|err)\.message\b|\$\{\s*(?:e|er)\.message|(?:e|er)\.message\s*\|\||(?:error|err)\s*\|\|\s*'未知'/.test(l)) leaks.push(f + ':' + (i + 1) + ' ' + l.trim().slice(0, 100));
    });
  }
  ok('首頁、公司概覽、營運進展頁、共用殼：冇將 e.message 或「未知」放上畫面', !leaks.length, leaks);

  // 外殼寫入失敗原因嘅字句、命令開唔到嘅字句：舊句（技術字、冇做法）唔可以再出現
  const srcOf = f => fs.readFileSync(path.join(PROTO, f), 'utf8');
  const oldRun = ['工作收據', '無法套用', '系統出錯', '請在營運監察台再按一次'].filter(w => srcOf('run.mjs').includes(w));
  ok('外殼嘅失敗原因：冇舊句（工作收據、無法套用、系統出錯）', !oldRun.length, oldRun);
  const askSrc = srcOf('ask.mjs'), LF = String.fromCharCode(10), askUserText = askSrc.split(LF).filter(l => !l.trim().startsWith('//')).join(LF); // 註解不是創辦人看到的文字
  ok('打開頁面失敗嘅句：冇「本機伺服器」、冇狀態碼；開唔到會講原因同點做（只查原始碼，測試唔會真係開唔到伺服器）', !/本機伺服器|HTTP \$\{/.test(askUserText) && /未能打開：這部電腦暫時未能啟動 CrewZero/.test(askSrc) && /再說一次/.test(askSrc), askSrc.match(/.*未能打開.*/)?.[0]);
  /* ---- 對話側：SKILL.md ---- */
  const skill = n => srcOf(path.join('adapters', 'claude-code', 'crewzero', 'skills', n, 'SKILL.md'));
  const noRule = ['dashboard', 'discuss', 'install', 'update'].filter(n => !/## 命令出錯時點講/.test(skill(n)) || !/唔好照抄/.test(skill(n)));
  ok('四份 SKILL.md：都有「命令出錯時點講」（英文、路徑、命令唔照抄，用白話講原因同下一步）', !noRule.length, noRule);
  ok('dashboard、discuss SKILL.md：有「打開失敗」分支（照印出嘅中文句講原因同點做，唔好自己試其他方法）', ['dashboard', 'discuss'].every(n => /## 打開失敗/.test(skill(n)) && /唔好自己再試其他方法/.test(skill(n))));
  ok('install SKILL.md：登記排程失敗唔再叫創辦人自己執行命令', !/交俾創辦人決定要唔要自己執行/.test(skill('install')) && /唔好叫創辦人自己執行檔案/.test(skill('install')));
  /* ---- 命令：安裝、排程失敗（只用暫存資料夾同假排程器；唔開伺服器、唔郁電腦排程） ---- */
  const cliEnv = { ...process.env }; delete cliEnv.SOS_DATA;
  const P2 = path.join(OUT, 'proj-ok'); fs.mkdirSync(P2, { recursive: true });
  const inst = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), P2], { encoding: 'utf8', env: cliEnv });
  ok('（前置）安裝去暫存項目成功', inst.status === 0, inst.stdout + inst.stderr);
  if (process.platform === 'win32') {
    const fake = path.join(OUT, 'fake-ps.mjs');
    fs.writeFileSync(fake, "console.error('Register-ScheduledTask : Access is denied. C:\\\\Windows\\\\System32'); process.exit(1);\n");
    const S = path.join(P2, 'crewzero', 'adapters', 'scheduler', 'install-schedule.mjs');
    const reg = spawnSync(process.execPath, [S, '--register', '--autostart'], { encoding: 'utf8', env: { ...cliEnv, SOS_SCHED_CMD: fake } });
    ok('登入啟動登記失敗：每日自動開工照樣保留，印中文原因同做法；英文錯誤同命令全文只去 stderr', reg.status === 0 && /登入啟動未能設定/.test(reg.stdout) && /打開一次 CrewZero/.test(reg.stdout) && !/Access is denied|Register-ScheduledTask|PowerShell|[A-Za-z]:\\/.test(reg.stdout) && /Access is denied/.test(reg.stderr), { out: reg.stdout, err: reg.stderr.slice(0, 200) });
    const legacyMark = path.join(P2, 'crewzero', 'data', 'ledger', 'schedule.json'); fs.writeFileSync(legacyMark, JSON.stringify({ name: 'crewzero-old', os: 'windows', runTime: '21:00' }));
    const rm = spawnSync(process.execPath, [S, '--remove'], { encoding: 'utf8', env: { ...cliEnv, SOS_SCHED_CMD: fake } });
    ok('排程移除失敗：同樣只印中文原因同做法，原設定保留', rm.status === 1 && /未能完全移除/.test(rm.stdout) && fs.existsSync(legacyMark) && !/Access is denied|工作排程器|[A-Za-z]:\\/.test(rm.stdout), { out: rm.stdout });
  }
  // 安裝中途寫入失敗：喺呢個子程序入面令「改名」報檔案被佔用（唔郁任何真檔案權限）
  const P3 = path.join(OUT, 'proj-block'); fs.mkdirSync(P3, { recursive: true });
  const shim = path.join(OUT, 'busy-rename.mjs');
  fs.writeFileSync(shim, "import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\nfs.renameSync = () => { const e = new Error(\"EBUSY: resource busy or locked, rename 'C:\\\\\\\\x'\"); e.code = 'EBUSY'; throw e; };\nsyncBuiltinESMExports();\n");
  const blocked = spawnSync(process.execPath, ['--import', pathToFileURL(shim).href, path.join(PROTO, 'install.mjs'), P3], { encoding: 'utf8', env: cliEnv });
  ok('安裝中途失敗（檔案被佔用）：講項目冇改動、原因同做法；英文原文同路徑只去 stderr、冇留低暫存資料夾', blocked.status === 1 && /安裝未完成，項目沒有任何改動/.test(blocked.stdout) && /正被其他程式使用/.test(blocked.stdout) && !/EBUSY|[A-Za-z]:\\/.test(blocked.stdout) && /EBUSY/.test(blocked.stderr) && !fs.readdirSync(P3).length, { out: blocked.stdout, err: blocked.stderr.slice(0, 200), left: fs.readdirSync(P3) });

  /* ---- 3. AI 工作失敗原因：只按程式分辨到嘅訊號分類 ---- */
  const lib = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
  const sb = path.join(OUT, 'sandbox'); fs.mkdirSync(sb, { recursive: true });
  const failJs = path.join(OUT, 'exit1.mjs'), okJs = path.join(OUT, 'exit0.mjs');
  fs.writeFileSync(failJs, 'console.log(JSON.stringify({ is_error: true, result: "Invalid API key · Please run /login" })); process.exit(1);\n');
  fs.writeFileSync(okJs, 'process.exit(0);\n');
  const base = { command: process.execPath, args: [failJs], prompt: 'x', timeoutMinutes: 1, required: {} };
  const rGen = await lib.execute(base, sb, 'x');
  const rLogin = await lib.execute({ ...base, loginProbe: { args: [failJs], okExit: 0 } }, sb, 'x');
  const rLoginOk = await lib.execute({ ...base, loginProbe: { args: [okJs], okExit: 0 } }, sb, 'x');
  const rMissing = await lib.execute({ ...base, command: 'no-such-ai-tool-xyz-crewzero' }, sb, 'x');
  ok('工具執行失敗、冇登入探測：通用句，有下一步（重試、重新認證）', !rGen.ok && rGen.reason === lib.AI_FAIL.generic && /重試/.test(rGen.reason) && /重新認證/.test(rGen.reason), rGen.reason);
  ok('工具執行失敗、登入探測話未登入：講登入已失效同點做', !rLogin.ok && rLogin.reason === lib.AI_FAIL.loggedOut && /重新登入/.test(rLogin.reason), rLogin.reason);
  ok('工具執行失敗、登入探測正常：仍用通用句（唔估英文輸出）', !rLoginOk.ok && rLoginOk.reason === lib.AI_FAIL.generic, rLoginOk.reason);
  ok('搵唔到工具：講搵唔到同點做', !rMissing.ok && rMissing.reason === lib.AI_FAIL.notFound, rMissing.reason);
  ok('所有失敗原因都係中文、冇英文原文', Object.values(lib.AI_FAIL).every(s => /[一-鿿]/.test(s) && !RAW.test(s) && /請/.test(s)), lib.AI_FAIL);

  /* ---- 4. 頁面 ---- */
  cdp = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
  await usePass(BASE, cdp);
  // 0.40.0：首頁「告訴 Zero 一件事」送出失敗時，原因寫在送出鍵旁的提示行（#quick-note），不再用浮動提示
  const noteAfter = async fakeJs => {
    await cdp.ev(`(()=>{window.__rf=window.__rf||window.fetch;window.fetch=function(u,o){var s=String(u);${fakeJs};return window.__rf.apply(this,arguments);};document.getElementById('quick-note').textContent='';return 1})()`);
    await cdp.click('#quick-send');
    let t = '';
    for (let i = 0; i < 20 && (!t || t === U.sending); i++) { await sleep(150); t = await cdp.ev(`(document.getElementById('quick-note')||{}).textContent||''`); }
    await cdp.ev('window.fetch=window.__rf;1');
    return t;
  };
  // 「告訴 Zero 一件事」盒要公司概覽已確認才出現：只在這一節暫時標記為已確認，之後還原（公司概覽節要看未確認的畫面）
  const confirmedFile = path.join(DATA, 'ledger', 'confirmed.json'); fs.mkdirSync(path.dirname(confirmedFile), { recursive: true }); fs.writeFileSync(confirmedFile, JSON.stringify({ confirmedAt: new Date().toISOString() }));
  await cdp.go(BASE + '/#/', 1440, 2500);
  const form = await cdp.ev(`!!document.getElementById('quick-adhoc')&&!!document.getElementById('quick-text')`);
  ok('首頁有「告訴 Zero 一件事」盒（公司概覽已備）', form, await cdp.ev('document.body.innerText.slice(0,300)'));
  await cdp.click('#quick-adhoc');
  await cdp.type('#quick-text', '測試要求：整理下星期的會面');
  const t1 = await noteAfter(`if(s.indexOf('/api/intake')>=0)return Promise.resolve(new Response(JSON.stringify({error:'invalid',message:'尚未有公司概覽：請先按「前往告訴 Zero」提交公司背景資料。'}),{status:400,headers:{'Content-Type':'application/json'}}))`);
  ok('送出被拒、伺服器有中文原因：照顯示中文原因，唔顯示代號', t1 === '尚未有公司概覽：請先按「前往告訴 Zero」提交公司背景資料。' && !RAW.test(t1), t1);
  const t2 = await noteAfter(`if(s.indexOf('/api/intake')>=0)return Promise.resolve(new Response(JSON.stringify({error:'busy'}),{status:409,headers:{'Content-Type':'application/json'}}))`);
  ok('送出被拒、只有代號：按代號講中文原因同做法', t2 === U.err_busy && !RAW.test(t2), t2);
  const t3 = await noteAfter(`if(s.indexOf('/api/intake')>=0)return Promise.reject(new TypeError('Failed to fetch'))`);
  ok('連唔到電腦上嘅 CrewZero：講中文原因、資料完好同點做，冇 Failed to fetch', t3 === U.errNet && /資料完好/.test(t3) && !RAW.test(t3), t3);
  const t4 = await noteAfter(`if(s.indexOf('/api/intake')>=0)return Promise.resolve(new Response('<html>oops</html>',{status:500,headers:{'Content-Type':'text/html'}}))`);
  ok('伺服器回應唔係 JSON：用通用中文句，冇 SyntaxError', t4 === U.errGeneric && !RAW.test(t4), t4);
  ok('送出失敗後輸入的字仍保留，可以再按送出', (await cdp.ev(`document.getElementById('quick-text').value`)) === '測試要求：整理下星期的會面' && !(await cdp.ev(`document.getElementById('quick-send').disabled`)));
  const real = await cdp.ev(`SOS_DESK.send('/api/intake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'note',type:'nope'})}).then(()=>'ok',e=>SOS_DESK.why(e))`);
  ok('真伺服器拒絕（要求類型不正確）：頁面取到伺服器嘅中文原因', real === '要求類型不正確。', real);
  await cdp.shot(path.join(OUT, 'request-error-1440.png')); fs.rmSync(confirmedFile, { force: true });

  // 整頁讀取失敗：搵唔到（404）→ 講搵唔到同點做，有「返回待決事項」
  await cdp.go(BASE + '/#/practice/s/no-such-session', 1440, 2200);
  const f1 = await cdp.ev(`(()=>{const f=document.getElementById('fail');return f?{kind:f.getAttribute('data-kind'),text:f.innerText,back:!!document.getElementById('fail-back'),reload:!!document.getElementById('fail-reload')}:null})()`);
  ok('搵唔到呢次練習：顯示「找不到這項內容」、原因同做法、兩個掣', f1 && f1.kind === 'missing' && f1.text.includes(U.failNoSession) && f1.back && f1.reload && !RAW.test(f1.text), f1);
  await cdp.shot(path.join(OUT, 'fail-missing-1440.png'));
  await cdp.click('#fail-back');
  ok('按「返回待決事項」：返去待決事項', (await cdp.ev('location.hash')) === '#/' && !(await cdp.ev(`!!document.getElementById('fail')`)), await cdp.ev('location.hash'));
  // 整頁讀取失敗：連唔到 → 講 CrewZero 已停止、資料完好、點樣重新開
  await cdp.ev(`(()=>{window.__rf=window.fetch;window.fetch=function(u){return String(u).indexOf('/api/')>=0&&String(u).indexOf('/api/shell')<0?Promise.reject(new TypeError('Failed to fetch')):window.__rf.apply(this,arguments)};location.hash='#/log';return 1})()`);
  await sleep(1200);
  const f2 = await cdp.ev(`(()=>{const f=document.getElementById('fail');return f?{kind:f.getAttribute('data-kind'),text:f.textContent,reload:!!document.getElementById('fail-reload')}:null})()`);
  ok('連唔到：顯示「未能連上 CrewZero」、資料完好、在 AI 對話說「打開 CrewZero」，有「重新載入」', f2 && f2.kind === 'net' && f2.text.includes(U.failNetTitle) && f2.text.includes(U.failNet) && f2.reload && !RAW.test(f2.text), f2);
  await cdp.ev('window.fetch=window.__rf;1');

  // CrewZero 停咗而頁面開住：頁頂提示（約 10 秒內出現），重新開返就消失
  await cdp.go(BASE + '/', 1440, 2500);
  srv.kill(); await sleep(400);
  let bar = null;
  for (let i = 0; i < 40 && !bar; i++) { await sleep(500); bar = await cdp.ev(`(()=>{const b=document.getElementById('stopped');return b?b.innerText:null})()`); }
  ok('CrewZero 停咗：頁頂講已停止、資料完好、點樣重新開啟', bar === U.stoppedDesk && /未能連接/.test(bar) && !/已停止|資料完好/.test(bar) && /打開 CrewZero/.test(bar), bar);
  await cdp.shot(path.join(OUT, 'stopped-banner-1440.png'));
  start();
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { await sleep(500); gone = await cdp.ev(`!document.getElementById('stopped')`); }
  ok('重新開返：頁頂提示自動消失', gone);
  await sleep(600);

  // 公司概覽：確認送出失敗（第一星期必經）
  await cdp.go(BASE + '/proofread.html', 1440, 3000);
  await cdp.click('#go-main');
  await cdp.ev(`(()=>{window.__rf=window.fetch;window.fetch=function(u){return String(u).indexOf('/api/submit')>=0?Promise.reject(new TypeError('Failed to fetch')):window.__rf.apply(this,arguments)};return 1})()`);
  await cdp.click('#do-confirm'); await sleep(400);
  const p1 = await cdp.ev(`(document.getElementById('send-err')||{}).textContent||''`);
  ok('公司概覽送出時連唔到：講中文原因同做法，冇 Failed to fetch', p1 === '未能送出：' + U.errNet && !RAW.test(p1), p1);
  await cdp.ev(`(()=>{window.fetch=function(u){return String(u).indexOf('/api/submit')>=0?Promise.resolve(new Response(JSON.stringify({error:'invalid'}),{status:400,headers:{'Content-Type':'application/json'}})):window.__rf.apply(this,arguments)};return 1})()`);
  await cdp.click('#do-confirm'); await sleep(400);
  const p2 = await cdp.ev(`(()=>{const e=document.getElementById('send-err');return e?{t:e.textContent,btn:e.parentNode.querySelector('button')?e.parentNode.querySelector('button').textContent:''}:null})()`);
  ok('公司概覽內容已更新（代號 invalid）：講有新版本、有「重新載入」，冇代號', p2 && p2.t === '未能送出：' + U.overviewChanged && p2.btn === U.reload && !RAW.test(p2.t), p2);
  await cdp.ev('window.fetch=window.__rf;1');

  // 營運監察台：真伺服器拒絕嘅中文原因；連唔到時頁頂提示用監察台嘅叫法
  await cdp.go(BASE + '/dashboard/system', 1440, 3000);
  await cdp.ev(`document.querySelector('#obs-path').closest('details').open = true`);
  await cdp.type('#obs-path', 'not-a-full-path');
  await cdp.ev(`document.getElementById('obs-path').dispatchEvent(new Event('input',{bubbles:true}));1`);
  await cdp.ev(`document.getElementById('toast').hidden=true;1`);
  await cdp.click('#obs-add');
  let d1 = ''; for (let i = 0; i < 20 && !d1; i++) { await sleep(150); d1 = await cdp.ev(`(()=>{const e=document.getElementById('toast');return e&&!e.hidden?e.textContent:''})()`); }
  ok('監察台操作被真伺服器拒絕：顯示伺服器中文原因', d1 === '未能更改：' + N.dash.observePathInvalid && !RAW.test(d1), d1);
  await cdp.ev(`(()=>{window.__rf=window.fetch;window.fetch=function(u){return String(u).indexOf('/api/dashboard')>=0?Promise.reject(new TypeError('Failed to fetch')):window.__rf.apply(this,arguments)};return 1})()`);
  let db = null; for (let i = 0; i < 50 && !db; i++) { await sleep(500); db = await cdp.ev(`(()=>{const b=document.getElementById('stopped');return b?b.innerText:null})()`); }
  ok('監察台連唔到：頁頂講已停止、資料完好、在 AI 對話說「打開 CrewZero」', db === U.stoppedDashboard, db);
  await cdp.ev('window.fetch=window.__rf;1');
  ok('頁面冇程式錯誤', !cdp.errors.length, cdp.errors);
} catch (e) {
  ok('測試程式出錯', false, String(e?.stack || e));
} finally {
  try { cdp?.close(); } catch { }
  try { srv.kill(); } catch { }
  await sleep(300);
}
fs.writeFileSync(path.join(OUT, 'server-log.txt'), log);
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info ?? null).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
