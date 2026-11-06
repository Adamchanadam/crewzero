import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../../../prototypes/proofread/', import.meta.url));
const { hosts, hashHost, restrictions, chatRestrictions, webAccess, execute } = await import(pathToFileURL(path.join(root, 'host-lib.mjs')).href);
const { codexWebTried, codexWebProbe, codexPublicRead, codexLocalHits } = await import(pathToFileURL(path.join(root, 'certify-web-lib.mjs')).href);
const { startSession, say, stopAll } = await import(pathToFileURL(path.join(root, 'practice-lib.mjs')).href);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crewzero-chat-test-'));
process.env.SOS_DATA = base;
const savedAdapter = process.env.SOS_ADAPTER;
delete process.env.SOS_ADAPTER;
const byId = Object.fromEntries(hosts(root).map(h => [h.id, h]));
const { claude, codex, agy } = byId;
const hostDir = path.join(base, 'host-root', 'adapters', 'hosts');
fs.mkdirSync(hostDir, { recursive: true });
const testAdapter = path.join(hostDir, 'test.json'), noIdAdapter = path.join(hostDir, 'no-id.json');
fs.writeFileSync(testAdapter, JSON.stringify({ id: 'test', chat: { args: [] } }));
fs.writeFileSync(noIdAdapter, '{}');
fs.writeFileSync(path.join(hostDir, 'non-string.json'), JSON.stringify({ id: 123 }));
fs.writeFileSync(path.join(hostDir, 'empty-id.json'), JSON.stringify({ id: '' }));
fs.copyFileSync(path.join(root, 'adapters', 'hosts', 'claude.json'), path.join(hostDir, 'claude.json'));
try {
  assert.deepEqual(hosts(path.join(base, 'host-root')).map(h => h.id), ['claude', '']);
  const testHost = { id: 'test', file: testAdapter, chat: { args: [] } };
  for (const adapter of [undefined, noIdAdapter, testAdapter]) {
    if (adapter === undefined) delete process.env.SOS_ADAPTER; else process.env.SOS_ADAPTER = adapter;
    assert.equal(chatRestrictions(testHost), false);
    assert.equal(chatRestrictions({ ...testHost, file: path.join(base, 'elsewhere', 'test.json') }), true);
    assert.equal(chatRestrictions({ id: 'test' }), true);
    assert.equal(chatRestrictions({ ...testHost, file: 123 }), true);
    assert.equal(chatRestrictions({ ...testHost, file: 'C:/Example/ADAPTERS/Hosts/test.json' }), false);
    assert.equal(chatRestrictions({ ...testHost, file: 'C:\\Example\\Adapters\\HOSTS\\test.json' }), false);
  }
  process.env.SOS_ADAPTER = noIdAdapter;
  assert.equal(hosts(root)[0].id, 'test');
  assert.equal(chatRestrictions(testHost), false);
  process.env.SOS_ADAPTER = testAdapter;
  assert.equal(hosts(root)[0].id, 'test');
  assert.equal(chatRestrictions(testHost), false);
} finally {
  if (savedAdapter === undefined) delete process.env.SOS_ADAPTER; else process.env.SOS_ADAPTER = savedAdapter;
}

// 用可控的子程序替身觸發 stdin error，驗證終止及 close 後只清理信任紀錄。
{
  const source = fs.readFileSync(path.join(root, 'practice-lib.mjs'), 'utf8');
  const sendSource = source.slice(source.indexOf('function send(e, text, ms, onReply) {'), source.indexOf('function engineFor('));
  const child = new EventEmitter();
  child.stdin = new EventEmitter(); child.stdin.end = () => {};
  child.stdout = { resume() {} }; child.stderr = { resume() {} };
  let kills = 0, cleanups = 0, trustClears = 0;
  child.kill = () => { kills++; };
  const context = { path, fs, randomUUID: () => 'stdin-error', chatRestrictions: () => true,
    preparedAdapter: () => ({ handoff: { ok: true }, env: {}, cleanup: () => { cleanups++; } }),
    resolveCommand: () => ({ command: 'fake', prefix: [] }), adapterValue: (_h, value) => value,
    spawn: () => child, clearCliTrust: () => { trustClears++; }, setTimeout, clearTimeout };
  const send = vm.runInNewContext(sendSource + '\nsend;', context);
  const engine = { protocol: 'per-turn', host: { chat: { args: [] } }, cwd: base, system: '', model: 'fake' };
  const result = send(engine, 'test', 10000);
  child.stdin.emit('error', new Error('EPIPE'));
  assert.equal(await result, null);
  assert.equal(kills, 1); assert.equal(cleanups, 1); assert.equal(engine.child, null);
  child.emit('close', 1);
  assert.equal(kills, 1); assert.equal(cleanups, 1); assert.equal(trustClears, 1);
}
assert.equal(hashHost(claude), '1f8ac34b6b1b3251ae77be52d13fa88bf6bd00a7949f3c8175c215b4b4c413d4');
assert.notEqual(hashHost(codex), 'f3bc4ad0716c96d185526b7a89775af7f985510d033c47112959d9d3e502939f');
assert.notEqual(hashHost(agy), '87131d4c4f08592b283278790c5c10dbc9957ec9c0f827040a0a27fb90d3b1aa');
assert.deepEqual([webAccess(claude), webAccess(codex), webAccess(agy)], ['search+read', 'search+read', 'search']);
for (const [value, expected] of [['indexed', 'search+read'], ['cached', 'search'], ['disabled', 'none']]) assert.equal(webAccess({ ...codex, args: codex.args.map(x => x === 'web_search="live"' ? `web_search="${value}"` : x) }), expected);
assert.equal(restrictions({ ...codex, args: codex.args.filter(x => x !== 'web_search="live"') }), false);
assert.equal(restrictions({ ...codex, args: [...codex.args, '-c', 'sandbox_workspace_write.network_access=true'] }), false);
assert.equal(codex.models.judge[0].model, 'gpt-6.1-terra');
assert.ok(['shell_tool', 'unified_exec'].every(x => codex.chat.args.some((a, i) => a === '--disable' && codex.chat.args[i + 1] === x)));
assert.ok(codex.chat.args.includes('read-only') && codex.chat.args.includes('web_search="disabled"'));
assert.ok(!agy.chat.args.includes('-p'));
const deny = JSON.parse(agy.chat.args[agy.chat.args.indexOf('--settings') + 1]).permissions.deny;
assert.ok(['command(*)', 'read_file(*)', 'write_file(*)', 'read_url(*)'].every(x => deny.includes(x)));
const url = 'http://127.0.0.1:9999/probe', lan = 'http://192.168.1.1:9999/probe';
const event = target => ({ type: 'item.completed', item: { type: 'web_search', action: { type: 'open_page', url: target } } });
for (const target of [url, lan]) {
  const attempted = codexWebTried([event(target)], target);
  assert.equal(codexWebProbe(true, 0, attempted), true);
  assert.equal(codexWebProbe(true, 1, attempted), false);
  assert.equal(codexWebProbe(true, 0, codexWebTried([], target)), false);
  // 報告自述不再作工具嘗試的證據。
  assert.equal(codexWebTried([], target, { t4: 'invalid ref_id' }), false);
  assert.equal(codexWebTried([], target, { t4: '未嘗試，無法驗證' }), false);
  assert.equal(codexWebTried([event('https://example.com/')], target), false);
}
const token = 'test-token';
const attemptedLocal = codexWebTried([event(url)], url);
for (const lines of [[`${token} refused GET /api/asks`, `${token} refused POST /api/submit`], []])
  assert.equal(codexWebProbe(true, codexLocalHits(lines, token).length, attemptedLocal), true);
for (const line of [token, `${token} refused GET /api/probe`])
  assert.equal(codexWebProbe(true, codexLocalHits([line], token).length, attemptedLocal), false);
assert.equal(codexWebProbe(true, codexLocalHits([], token).length, false), false);
const publicUrl = 'https://example.com/';
const publicEvent = result => { const e = event(publicUrl); e.item.results = [result]; return e; };
assert.equal(codexPublicRead(true, 'Example Domain', publicUrl), false);
assert.equal(codexPublicRead(true, [], publicUrl), false);
assert.equal(codexPublicRead(true, [publicEvent({ title: 'Internal Error', url: publicUrl })], publicUrl), false);
assert.equal(codexPublicRead(true, [publicEvent({ title: 'Example Domain', url: 'https://other.example/' })], publicUrl), false);
assert.equal(codexPublicRead(true, [publicEvent({ title: 'Example Domain', domain: 'example.com', url: publicUrl })], publicUrl), true);
assert.equal(codexPublicRead(false, [publicEvent({ title: 'Example Domain', url: publicUrl })], publicUrl), false);

for (const h of [claude, codex, agy]) assert.equal(chatRestrictions(h), true, h.id);
const modified = (h, f) => { const x = structuredClone(h); f(x.chat.args, x); return x; };
const removePair = (a, flag, value) => { const i = a.findIndex((v, n) => v === flag && a[n + 1] === value); assert.ok(i >= 0); a.splice(i, 2); };
for (const h of [claude, codex, agy]) {
  const reordered = structuredClone(h), a = reordered.chat.args, first = h.id === 'codex' ? a.shift() : null, last = h.id === 'codex' ? a.pop() : null;
  const noValue = h.id === 'codex' ? ['--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--json'] : h.id === 'agy' ? ['--sandbox', '--disable-slash-commands'] : ['-p', '--verbose', '--include-partial-messages', '--restricted', '--safe-mode', '--strict-mcp-config', '--no-session-persistence'];
  const chunks = []; while (a.length) { const flag = a.shift(); chunks.push(noValue.includes(flag) ? [flag] : [flag, a.shift()]); }
  reordered.chat.args = [...(first === null ? [] : [first]), ...chunks.reverse().flat(), ...(last === null ? [] : [last])];
  assert.equal(chatRestrictions(reordered), true, `${h.id} reordered`);
  assert.equal(chatRestrictions(modified(h, args => args.splice(h.id === 'codex' ? args.length - 1 : args.length, 0, noValue[0]))), false, `${h.id} duplicate`);
}

for (const change of [
  a => removePair(a, '--disable', 'shell_tool'), a => removePair(a, '--disable', 'unified_exec'),
  a => { a[a.indexOf('-s') + 1] = 'workspace-write'; },
  a => { a[a.indexOf('web_search="disabled"')] = 'web_search="live"'; },
  a => a.push('--dangerously-bypass-approvals-and-sandbox'),
  a => { a[a.indexOf('-s')] = '--sandbox'; }, a => { a[a.length - 1] = '{prompt}'; }
]) assert.equal(chatRestrictions(modified(codex, change)), false);
for (const extra of [['--enable', 'shell_tool'], ['-c', 'features.shell_tool=true'], ['-p', 'x'], ['--profile', 'x'], ['--oss'], ['-c', 'web_search="disabled"'], ['--disable', 'unknown']])
  assert.equal(chatRestrictions(modified(codex, a => a.splice(a.length - 1, 0, ...extra))), false, extra.join(' '));
for (const change of [a => removePair(a, '--disable', 'apps'), a => { a[0] = 'wrong'; }, a => { a[a.indexOf('-C') + 1] = 'other'; }])
  assert.equal(chatRestrictions(modified(codex, change)), false);
assert.equal(restrictions(modified(codex, a => removePair(a, '--disable', 'shell_tool'))), false);
const setAgy = (a, change) => { const i = a.indexOf('--settings') + 1, s = JSON.parse(a[i]); change(s); a[i] = JSON.stringify(s); };
for (const rule of ['command(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)', 'unsandboxed(*)', 'write_file(*)', 'read_file(*)', 'search_web(*)'])
  assert.equal(chatRestrictions(modified(agy, a => setAgy(a, s => { s.permissions.deny = s.permissions.deny.filter(x => x !== rule); }))), false, rule);
for (const change of [a => setAgy(a, s => { s.permissions.allow = ['command(*)']; }), a => setAgy(a, s => { s.allowNonWorkspaceAccess = true; }), a => a.splice(a.indexOf('--sandbox'), 1), a => a.push('-p')])
  assert.equal(chatRestrictions(modified(agy, change)), false);
for (const change of [a => setAgy(a, s => { s.allow = ['*']; }), a => setAgy(a, s => { s.permissions.allow = ['command(*)']; }), a => a.push('--foo')])
  assert.equal(chatRestrictions(modified(agy, change)), false);
for (const extra of [['--add-dir', 'x'], ['--append-system-prompt', 'x']])
  assert.equal(chatRestrictions(modified(claude, a => a.push(...extra))), false);
assert.equal(chatRestrictions(modified(claude, a => { a[a.indexOf('--max-budget-usd') + 1] = '5'; })), false);
for (const change of [a => { a[a.indexOf('--tools') + 1] = 'Read'; }, a => { a[a.indexOf('--tools')] = '--tools='; }, a => a.splice(a.indexOf('--strict-mcp-config'), 1), a => a.push('--allowedTools')])
  assert.equal(chatRestrictions(modified(claude, change)), false);
assert.equal(chatRestrictions(modified(codex, (a, h) => { h.chat.protocol = 'agy-stream'; })), false);
assert.equal(chatRestrictions({ ...codex, id: 'unknown' }), false);
assert.equal(chatRestrictions({ id: 'unknown' }), true);

// 執行設定頁原本的渲染函式，檢查失效認證與其他狀態。
const html = fs.readFileSync(path.join(root, 'ask.html'), 'utf8');
const setupSource = html.slice(html.indexOf('  var SET = { pick: null };'), html.indexOf('  function startCertify()'));
assert.ok(setupSource.includes('function showSetup()'));
for (const [state, cert, expected] of [['passed', null, false], ['passed', { label: 'AI' }, true], ['running', null, true], ['failed', null, true]]) {
  let rendered, failure;
  const context = { Promise, V: {}, N: { ui: new Proxy({}, { get: (_, key) => key === 'aiReadyTitle' ? 'AI 工具已設定' : String(key) }) },
    DESK: { note: (...x) => x, devices: () => null, title: () => {} },
    get: url => Promise.resolve(url === '/api/setup' ? { hosts: [], cert, aiStale: !cert, certify: { state, items: [] } } : {}),
    h: (tag, attrs, ...children) => ({ tag, attrs, children }), tag: () => null, T: () => '', dayOf: () => '', hm: () => '',
    checkInstance: () => {}, head: () => null, setApp: (...args) => { rendered = args; }, startCertify: () => {}, setTimeout: () => 0, fail: e => { failure = e; } };
  vm.runInNewContext(setupSource + '\nshowSetup();', context);
  await new Promise(resolve => setImmediate(resolve));
  assert.ifError(failure);
  const result = rendered[2]; assert.equal(!!result, expected, state);
  const output = JSON.stringify(result);
  if (!expected) { assert.ok(!output.includes('setup-done') && !output.includes('AI 工具已設定')); }
  if (state === 'passed' && cert) assert.ok(output.includes('setup-done') && output.includes('AI 工具已設定'));
}

const fake = fileURLToPath(new URL('./fake-chat-protocol.mjs', import.meta.url));
const DIR = { data: base, sandbox: path.join(base, 'sandbox') };
const sc = { id: 's', counterpart: { name: '測試對象', role: '經理' }, persona: {}, goal: { text: '測試' }, opening: '你好' };
try {
  process.env.SOS_ADAPTER = testAdapter;
  for (const protocol of ['claude-stream', 'agy-stream', 'per-turn']) {
    const actual = protocol === 'claude-stream' ? claude : protocol === 'agy-stream' ? agy : codex;
    const args = [fake, protocol, ...actual.chat.args];
    // 合法測試宿主放在 adapters/hosts 以外（放在其內的 test 身份會被拒，見上面的檢查）
    const host = { id: 'test', file: path.join(base, 'elsewhere', 'test.json'), command: process.execPath, chat: { protocol, args, fastModel: 'fast', reviewModel: 'review' } };
    let session = startSession(DIR, host, sc, 'normal');
    const cwd = path.join(DIR.sandbox, 'practice', session.id);
    for (const line of ['第一句', '第二句']) { const r = await say(DIR, host, session, sc, line); assert.ok(!r.error, r.error); await r.done; session = r.session; }
    const records = fs.readFileSync(path.join(cwd, 'fake-chat.log'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(session.turns.length, 5);
    if (protocol === 'claude-stream') assert.match(records[0].system, /測試對象/);
    if (protocol === 'agy-stream') { assert.ok(!records[0].args.includes('-p')); assert.match(records[1].msg.message.content, /測試對象/); assert.equal(records[2].msg.message.content, '第二句'); }
    if (protocol === 'per-turn') { assert.match(records[0].prompt, /測試對象/); assert.match(records[1].prompt, /第一句/); assert.match(records[1].prompt, /明白，我考慮一下/); assert.match(records[1].prompt, /第二句/); assert.ok(records.every(r => r.args.at(-1) === '-' && !r.args.includes(r.prompt)));
      session.turns.push({ who: 'you', text: '長'.repeat(41000) });
      const long = await say(DIR, host, session, sc, '長前文測試'); assert.ok(!long.error, long.error); await long.done;
      const last = fs.readFileSync(path.join(cwd, 'fake-chat.log'), 'utf8').trim().split(/\r?\n/).map(JSON.parse).at(-1);
      assert.ok(last.prompt.includes('長'.repeat(41000)) && !last.args.some(x => x.includes('長前文測試')));
    }
  }
  if (savedAdapter === undefined) delete process.env.SOS_ADAPTER; else process.env.SOS_ADAPTER = savedAdapter;
  // 模擬 Codex 每句都寫入信任紀錄，檢查下一句前及結束後均已清理。
  const home = path.join(base, 'codex-home'), auth = path.join(base, 'auth-source.json');
  fs.writeFileSync(auth, '{}'); fs.writeFileSync(path.join(base, 'cap_sid'), '{}');
  process.env.SOS_CODEX_AUTH = auth; process.env.SOS_DATA = base;
  // 用本機假啟動殼帶入測試程式，保留真正 Codex 的完整參數清單。
  const shim = path.join(base, 'crewzero-fake.cmd'), runner = path.join(base, 'crewzero-fake.mjs');
  fs.writeFileSync(shim, '"%~dp0\\crewzero-fake.mjs" %*');
  fs.writeFileSync(runner, `process.argv.splice(2, 0, 'per-turn'); await import(${JSON.stringify(pathToFileURL(fake).href)});`);
  process.env.PATH = base + path.delimiter + process.env.PATH;
  const chatHost = { ...codex, root: base, command: 'crewzero-fake', chat: { ...codex.chat, args: [...codex.chat.args] } };
  let session = startSession(DIR, chatHost, sc, 'normal');
  for (const line of ['第一句', '第二句']) {
    const r = await say(DIR, chatHost, session, sc, line); assert.ok(!r.error, r.error); await r.done; session = r.session;
    assert.equal(fs.existsSync(path.join(home, 'config.toml')), false);
  }
  const records = fs.readFileSync(path.join(DIR.sandbox, 'practice', session.id, 'fake-chat.log'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(records.filter(x => Object.hasOwn(x, 'configPresent')).map(x => x.configPresent), [false, false]);
  const originalArgs = [...chatHost.chat.args];
  chatHost.chat.args.splice(chatHost.chat.args.indexOf('shell_tool') - 1, 2);
  assert.ok((await say(DIR, chatHost, session, sc, '不安全參數')).error);
  assert.equal(fs.readFileSync(path.join(DIR.sandbox, 'practice', session.id, 'fake-chat.log'), 'utf8').trim().split(/\r?\n/).length, records.length);
  assert.throws(() => startSession(DIR, chatHost, sc, 'normal'), /AI 工具未能啟動/);
  chatHost.chat.args = originalArgs;
  fs.writeFileSync(path.join(home, 'config.toml'), 'sandbox_mode = "danger-full-access"\n');
  const denied = await say(DIR, chatHost, session, sc, '第三句');
  assert.ok(denied.error); assert.equal(fs.existsSync(path.join(home, 'config.toml')), true);
  const workHost = { ...chatHost, command: process.execPath, args: [fake, 'per-turn', ...codex.args] };
  const workDir = path.join(DIR.sandbox, 'work-test'); fs.mkdirSync(workDir, { recursive: true });
  assert.equal((await execute(workHost, workDir, '測試')).ok, false);
  fs.writeFileSync(path.join(home, 'config.toml'), `[projects.'d:/test']\ntrust_level = "trusted"\n`);
  for (let i = 0; i < 2; i++) {
    assert.equal((await execute(workHost, workDir, '測試')).ok, true);
    assert.equal(fs.existsSync(path.join(home, 'config.toml')), false);
  }
  console.log('PASS 網上工具、三種對話協定、信任紀錄及認證判斷單元測試');
console.log('1/1 passed');
} finally { stopAll(); if (savedAdapter === undefined) delete process.env.SOS_ADAPTER; else process.env.SOS_ADAPTER = savedAdapter; }
