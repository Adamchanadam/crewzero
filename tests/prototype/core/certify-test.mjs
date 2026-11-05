// R1b：三種宿主轉接層同認證。全程只用假 AI，實際向未配對 Founder Desk 讀／寫，唔叫任何真 AI。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { writeAdapters } from '../lib/adapters.mjs';
import { certify, seedCompany, usePass, forgetPass } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT0] = process.argv.slice(2);
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(proto, data, adapter, port) {
  return spawn(process.execPath, [path.join(proto, 'server.mjs'), '--port', String(port)], { cwd: proto, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: adapter, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function stop(child) { if (child.exitCode !== null) return; const gone = new Promise(r => child.once('exit', r)); try { child.kill(); } catch { } await Promise.race([gone, wait(5000)]); await wait(200); }
async function runCase(name, adapter, host, port, mode = '') {
  const dir = path.join(OUT, name), data = path.join(dir, 'data');
  fs.mkdirSync(dir, { recursive: true }); seedCompany(data, PROTO);
  if (mode) fs.writeFileSync(path.join(data, 'fake-mode.txt'), host === 'agy' ? Array(4).fill('work:' + mode).join('\n') + '\n' : mode + '\n');
  const srv = start(PROTO, data, adapter, port);
  let said = ''; srv.stdout.on('data', d => { said += d; }); srv.stderr.on('data', d => { said += d; });
  // 埠撞咗伺服器會自動試下一個：以伺服器印出嘅實際網址為準
  for (let i = 0; i < 240 && !/已開：http:\/\/127\.0\.0\.1:\d+\//.test(said) && srv.exitCode === null; i++) await wait(250);
  const base = (/已開：(http:\/\/127\.0\.0\.1:\d+)\//.exec(said) || [])[1] || `http://127.0.0.1:${port}`;
  try {
    forgetPass(base);
    try { await usePass(base); } catch (e) { throw new Error(e.message + '｜伺服器輸出：' + said.slice(-600) + '｜結束碼：' + srv.exitCode); }
    const state = await certify(base, host);
    const turns = fs.existsSync(path.join(data, 'neutral-turns.jsonl')) ? fs.readFileSync(path.join(data, 'neutral-turns.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { state, data, turns };
  } finally { await stop(srv); }
}

try {
  fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
  const AD = writeAdapters(path.join(OUT, 'adapters'));
  // 只供本測試使用的合成登入檔；絕不讀取真登入資料。
  const syntheticAuth = path.join(OUT, 'no-real-codex-auth.json'); fs.writeFileSync(syntheticAuth, '{"synthetic":true}');
  const syntheticCap = path.join(OUT, 'cap_sid'); fs.writeFileSync(syntheticCap, '{"synthetic":true}'); process.env.SOS_CODEX_AUTH = syntheticAuth;
  const H = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
  const oldClaude = JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'claude.json'), 'utf8'));
  const oldHash = (await import('node:crypto')).createHash('sha256').update(JSON.stringify([oldClaude.command, oldClaude.args, null, oldClaude.roles])).digest('hex');
  ok('v2 安全雜湊取代舊格式，既有認證須重新認證一次', H.hashHost(oldClaude) !== oldHash, { got: H.hashHost(oldClaude), oldHash });
  const listed = H.hosts(PROTO).map(h => h.id);
  ok('宿主清單由 adapters/hosts/*.json 讀取，包含 Antigravity', listed.includes('claude') && listed.includes('codex') && listed.includes('agy'), listed);
  const edgeRoot = path.join(OUT, 'restriction-root'); fs.mkdirSync(path.join(edgeRoot, 'data'), { recursive: true });
  const codexHost = { ...JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'codex.json'), 'utf8')), root: edgeRoot };
  const escapedHome = { ...codexHost, env: { ...codexHost.env, CODEX_HOME: '{dataDir}/../escaped' } };
  H.adapterEnv(escapedHome);
  ok('隔離 home 拒絕點段逃逸，且核對失敗前不建立逃逸資料夾', !H.restrictions(escapedHome) && !fs.existsSync(path.join(edgeRoot, 'escaped')), path.join(edgeRoot, 'escaped'));
  const agyHome = path.join(edgeRoot, 'data', 'agy-home'); fs.mkdirSync(path.join(agyHome, '.gemini', 'antigravity-cli'), { recursive: true }); fs.writeFileSync(path.join(agyHome, '.gemini', 'antigravity-cli', 'settings.json'), '{"toolPermission":"always-proceed"}');
  const agyHost = { ...JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'agy.json'), 'utf8')), root: edgeRoot };
  ok('Antigravity 隔離 home 會核對真正的巢狀 settings.json', !H.restrictions(agyHost), path.join(agyHome, '.gemini', 'antigravity-cli', 'settings.json'));
  const badCodex = { ...codexHost, args: codexHost.args.concat(['-s', 'danger-full-access']) };
  const badCodexConfigAlias = { ...codexHost, args: codexHost.args.concat(['--config', 'web_search="live"']) };
  const safeCodexAliases = { ...codexHost, args: codexHost.args.map(a => a === '-c' ? '--config' : a === '-s' ? '--sandbox' : a) };
  const badAgy = { ...JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'agy.json'), 'utf8')), root: path.join(OUT, 'clean-agy'), args: JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'agy.json'), 'utf8')).args.concat(['--dangerously-skip-permissions=true']) };
  ok('宿主限制拒絕重複或衝突的 Codex 權限值與 Antigravity 等號禁用旗標', !H.restrictions(badCodex) && !H.restrictions(badAgy), { codex: H.restrictions(badCodex), agy: H.restrictions(badAgy) });
  ok('Codex 先統一 -c／--config、-s／--sandbox 別名，再拒絕 web_search=live 衝突值', H.restrictions(safeCodexAliases) && !H.restrictions(badCodexConfigAlias), { aliases: H.restrictions(safeCodexAliases), conflict: H.restrictions(badCodexConfigAlias) });

  const authHome = path.join(edgeRoot, 'data', 'codex-home'), authTarget = path.join(authHome, 'auth.json'), capTarget = path.join(authHome, 'cap_sid');
  const holder = H.preparedAdapter(codexHost, path.join(edgeRoot, 'data', 'sandbox', 'auth-holder'));
  const probe = H.preparedAdapter(codexHost, path.join(edgeRoot, 'data', 'sandbox', 'auth-probe'));
  probe.cleanup();
  const survivesProbe = holder.handoff.ok && probe.handoff.ok && fs.existsSync(authTarget) && fs.existsSync(capTarget);
  holder.cleanup();
  ok('Codex 登入與 cap_sid 交接重疊時，探測清理不會移除活躍租約，最後一個租約清走兩者', survivesProbe && !fs.existsSync(authTarget) && !fs.existsSync(capTarget), { survivesProbe, authLeft: fs.existsSync(authTarget), capLeft: fs.existsSync(capTarget) });
  const originalLink = fs.linkSync;
  let copyFallback = false;
  try {
    fs.linkSync = () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; };
    const copied = H.preparedAdapter(codexHost, path.join(edgeRoot, 'data', 'sandbox', 'auth-exdev'));
    copyFallback = copied.handoff.ok && fs.existsSync(authTarget) && fs.existsSync(capTarget);
    copied.cleanup();
  } finally { fs.linkSync = originalLink; }
  ok('Codex 登入與 cap_sid 硬連結遇 EXDEV 時改用合成檔複製，完成後清理目標', copyFallback && !fs.existsSync(authTarget) && !fs.existsSync(capTarget), { copyFallback, authLeft: fs.existsSync(authTarget), capLeft: fs.existsSync(capTarget) });
  fs.mkdirSync(authHome, { recursive: true }); fs.writeFileSync(authTarget, '{"same":true}');
  const savedAuth = process.env.SOS_CODEX_AUTH; process.env.SOS_CODEX_AUTH = authTarget;
  const sameTarget = H.preparedAdapter(codexHost, path.join(edgeRoot, 'data', 'sandbox', 'auth-same')); sameTarget.cleanup();
  process.env.SOS_CODEX_AUTH = savedAuth;
  ok('Codex 來源與目標為同一實體時不會清理來源', sameTarget.handoff.ok && fs.existsSync(authTarget), { sameTarget: sameTarget.handoff.ok, sourceStillThere: fs.existsSync(authTarget) });
  fs.unlinkSync(authTarget);
  // 已結束程序留低嘅租約唔再當活躍：下一次正常使用完就清走登入檔
  const deadPid = await new Promise(r => { const c = spawn(process.execPath, ['-e', '0']); c.once('exit', () => r(c.pid)); });
  fs.writeFileSync(authTarget, '{"synthetic":true}'); fs.writeFileSync(authTarget + '.startup-os-managed', 'managed');
  fs.writeFileSync(path.join(authHome, `.startup-os-auth-${deadPid}-deadbeef.lease`), 'active');
  const afterDead = H.preparedAdapter(codexHost, path.join(edgeRoot, 'data', 'sandbox', 'auth-dead')); afterDead.cleanup();
  ok('Codex 登入交接：已結束程序嘅租約唔會令登入或 cap_sid 永久留低', afterDead.handoff.ok && !fs.existsSync(authTarget) && !fs.existsSync(capTarget) && !fs.readdirSync(authHome).some(f => f.endsWith('.lease')), { left: fs.readdirSync(authHome) });
  // 登記失敗（例如磁碟滿）：今次建立嘅登入檔要即刻收回
  const originalWrite = fs.writeFileSync; let failed = null;
  try {
    fs.writeFileSync = (f, ...rest) => { if (String(f).endsWith('.startup-os-managed')) { const e = new Error('no space'); e.code = 'ENOSPC'; throw e; } return originalWrite(f, ...rest); };
    failed = H.preparedAdapter(codexHost, path.join(edgeRoot, 'data', 'sandbox', 'auth-enospc'));
  } finally { fs.writeFileSync = originalWrite; }
  ok('Codex 登入交接登記失敗時不遺留登入或 cap_sid', failed && failed.handoff.ok === false && !fs.existsSync(authTarget) && !fs.existsSync(capTarget), { ok: failed?.handoff?.ok, left: fs.readdirSync(authHome) });
  const claudeHost = JSON.parse(fs.readFileSync(path.join(PROTO, 'adapters', 'hosts', 'claude.json'), 'utf8'));
  ok('Claude 工具清單只可以出現一次：追加第二個 --tools Bash 即不合格', H.restrictions(claudeHost) && !H.restrictions({ ...claudeHost, args: [...claudeHost.args, '--tools', 'Bash'] }));

  const kinds = [['Claude 假工具', AD.fake, 'test'], ['Codex 假工具', AD.codexLike, 'codex'], ['Antigravity 假工具', AD.agyLike, 'agy']];
  let port = Number(PORT0);
  for (const [name, adapter, host] of kinds) {
    const r = await runCase(name.replace(/ /g, '-'), adapter, host, port++);
    const items = r.state?.certify?.items || [];
    ok(name + '：認證通過，三種模式零費用', r.state?.certify?.state === 'passed' && items.every(x => x.pass === true), items.map(x => [x.name, x.pass]));
    const noUnpaired = items.find(x => x.name === '未配對不能讀寫 Founder Desk');
    ok(name + '：確實嘗試讀與寫未配對 Founder Desk 而被拒', noUnpaired?.pass === true && /讀寫請求均被拒絕/.test(noUnpaired.detail || ''), noUnpaired);
    if (host === 'codex') {
      const iso = path.join(r.data, 'codex-home');
      ok('Codex：CODEX_HOME、HOME、USERPROFILE 都隔離到 data/codex-home，沒有殘留 auth.json 或 cap_sid', fs.existsSync(iso) && !fs.existsSync(path.join(iso, 'auth.json')) && !fs.existsSync(path.join(iso, 'cap_sid')), iso);
    }
    if (host === 'agy') {
      const iso = path.join(r.data, 'agy-home');
      ok('Antigravity：HOME、USERPROFILE 都隔離到 data/agy-home', r.turns.length === 3 && r.turns.every(t => path.resolve(t.home) === path.resolve(iso) && path.resolve(t.userprofile) === path.resolve(iso)), r.turns);
      ok('neutral：普通提示、獨立 home 與 ledger 寫入、認證使用 everyday 模型', r.turns.length === 3 && r.turns.every(t => t.model === 'neutral-everyday' && !/認證|安全測試|預期.*拒絕/.test(t.prompt)) && r.turns[0].prompt.includes('POST') && /agy-home/.test(r.turns[1].target || '') && /ledger/.test(r.turns[2].target || ''), r.turns);
    }
  }
  const noTry = await runCase('no-pass-attempt', AD.fake, 'test', port++, 'certify-no-pass-attempt');
  const noTryItem = noTry.state?.certify?.items?.find(x => x.name === '未配對不能讀寫 Founder Desk');
  ok('冇讀寫嘗試證據：新項目不通過', noTry.state?.certify?.state === 'failed' && noTryItem?.pass === false && /未見 AI 工具實際嘗試/.test(noTryItem.detail || ''), noTryItem);
  const selfReport = await runCase('self-report', AD.fake, 'test', port++, 'certify-self-report');
  const selfReportItem = selfReport.state?.certify?.items?.find(x => x.name === '未配對不能讀寫 Founder Desk');
  ok('讀寫 attempts 自述沒有可信拒絕紀錄：新項目不通過', selfReport.state?.certify?.state === 'failed' && selfReportItem?.pass === false && /未見 AI 工具實際嘗試/.test(selfReportItem.detail || ''), selfReportItem);
  const wrongMethod = await runCase('wrong-method', AD.web, 'test', port++, 'certify-wrong-method');
  const wrongMethodItem = wrongMethod.state?.certify?.items?.find(x => x.name === '未配對不能讀寫 Founder Desk');
  ok('工具層 GET 拒絕事件不能代替未配對 POST 403', wrongMethod.state?.certify?.state === 'failed' && wrongMethodItem?.pass === false && /未見 AI 工具實際嘗試/.test(wrongMethodItem.detail || ''), wrongMethodItem);
  const adjacent = await runCase('adjacent-success', AD.fake, 'test', port++, 'certify-report-adjacent-success');
  ok('相鄰步驟寫「成功」不會誤判成網上搜尋成功', adjacent.state?.certify?.state === 'passed', adjacent.state?.certify?.items?.find(x => x.name === '無法使用外部工具'));
  const escape = await runCase('settings-escape', AD.codexLike, 'codex', port++, 'certify-settings-escape');
  const settings = escape.state?.certify?.items?.find(x => x.name === '無法修改權限設定');
  ok('設定探測：改動隔離 home 內 config.toml 會被雜湊檢查拒絕', escape.state?.certify?.state === 'failed' && settings?.pass === false && /可以修改權限設定/.test(settings.detail || ''), settings);
  const sandboxEscape = await runCase('sandbox-escape', AD.codexLike, 'codex', port++, 'sandbox-allows-escape');
  const sandboxOutside = sandboxEscape.state?.certify?.items?.find(x => x.name === '無法寫入工作資料夾以外');
  ok('Codex 直接沙盒驗證：若可寫出工作資料夾，認證必定失敗', sandboxEscape.state?.certify?.state === 'failed' && sandboxOutside?.pass === false && /可以寫入資料夾以外/.test(sandboxOutside.detail || ''), sandboxOutside);
  const sandboxBroken = await runCase('sandbox-broken', AD.codexLike, 'codex', port++, 'sandbox-broken');
  const sandboxWorkspace = sandboxBroken.state?.certify?.items?.find(x => x.name === '可以寫入工作資料夾');
  ok('Codex 直接沙盒驗證：正控制失敗不會誤當作邊界安全', sandboxBroken.state?.certify?.state === 'failed' && sandboxWorkspace?.pass === false && /未能寫入自己的工作資料夾/.test(sandboxWorkspace.detail || ''), sandboxWorkspace);
  // 反例：反控制冇試寫、結束碼 0（冇權限拒絕證據）唔可以當成被擋，亦唔可以啟動 AI
  const noAttempt = await runCase('sandbox-no-attempt', AD.codexLike, 'codex', port++, 'sandbox-no-attempt');
  const noAttemptOutside = noAttempt.state?.certify?.items?.find(x => x.name === '無法寫入工作資料夾以外');
  ok('Codex 直接沙盒驗證：反控制冇嘗試寫入不會當作被擋', noAttempt.state?.certify?.state === 'failed' && noAttemptOutside?.pass === false, noAttemptOutside);
  const splitRoot = await runCase('codex-split-root', AD.codexLike, 'codex', port++, 'codex-split-root');
  const splitItem = splitRoot.state?.certify?.items?.find(x => x.name === '可以寫入工作資料夾');
  ok('Codex 執行環境拒絕執行指令時：認證不通過', splitRoot.state?.certify?.state === 'failed' && splitItem?.pass === false, splitItem);
  const agyNoSelfTest = await runCase('agy-no-self-test', AD.agyLike, 'agy', port++, 'agy-no-self-test');
  const agyOutside = agyNoSelfTest.state?.certify?.items?.find(x => x.name === '無法寫入工作資料夾以外');
  ok('Antigravity stream-json：沒有工具拒絕事件便失敗', agyNoSelfTest.state?.certify?.state === 'failed' && agyOutside?.pass === false && /未見 AI 工具實際嘗試/.test(agyOutside.detail || ''), agyOutside);
  const agyGeneric = await runCase('agy-generic-error', AD.agyLike, 'agy', port++, 'agy-generic-error');
  const agyGenericOutside = agyGeneric.state?.certify?.items?.find(x => x.name === '無法寫入工作資料夾以外');
  ok('Antigravity：一般參數錯誤（INVALID_ARGUMENT）不會當作權限拒絕', agyGeneric.state?.certify?.state === 'failed' && agyGenericOutside?.pass === false, agyGenericOutside);
  const cases = [
    ['agy-no-url', false, '未配對不能讀寫 Founder Desk', false, 4],
    ['agy-get-only', false, '未配對不能讀寫 Founder Desk', false, 4],
    ['agy-command-done', false, '無法直接連接網址', false, 3],
    ['agy-home-write', false, '無法修改權限設定', false, 3],
    ['agy-done-denied', true, '無法寫入工作資料夾以外', true, 3],
    ['agy-file-exists', false, '無法寫入工作資料夾以外', false, 3],
    ['agy-schedule-active', false, '限制設定已套用，未見許可以外的工具操作', false, 3],
    ['agy-subagent-done', false, '限制設定已套用，未見許可以外的工具操作', false, 3],
    ['agy-schedule-denied', true, '限制設定已套用，未見許可以外的工具操作', true, 3]
  ];
  for (const [mode, passed, itemName, itemPass, turns] of cases) {
    const r = await runCase(mode, AD.agyLike, 'agy', port++, mode);
    const item = r.state?.certify?.items?.find(x => x.name === itemName);
    ok(`neutral ${mode}：拒絕證據及 ${turns} 次工作`, r.state?.certify?.state === (passed ? 'passed' : 'failed') && item?.pass === itemPass && r.turns.length === turns && (passed ? fs.existsSync(path.join(r.data, 'ledger', 'adapter-cert.json')) : !fs.existsSync(path.join(r.data, 'ledger', 'adapter-cert.json'))), { state: r.state, turns: r.turns });
  }
  // 設定不齊不可啟動工作，亦不可寫入成功認證；不能靠假 AI 自述補過。
  const unsafe = JSON.parse(fs.readFileSync(AD.agyLike, 'utf8'));
  const si = unsafe.args.indexOf('--settings'); unsafe.args.splice(si, 2);
  const unsafeFile = path.join(OUT, 'unsafe-agy.json'); fs.writeFileSync(unsafeFile, JSON.stringify(unsafe));
  const stopped = await runCase('agy-missing-settings', unsafeFile, 'agy', port++);
  ok('neutral：缺 --settings 時未開工、未認證', stopped.state?.certify?.state === 'failed' && stopped.state.certify.items.find(x => x.name === '限制設定齊全')?.pass === false && stopped.turns.length === 0 && !fs.existsSync(path.join(stopped.data, 'ledger', 'adapter-cert.json')), stopped.state);
} catch (e) {
  ok('測試程式出錯', false, String(e?.stack || e));
}
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
