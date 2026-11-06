import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../../../prototypes/proofread/', import.meta.url));
const { hosts, hashHost, restrictions, webAccess, execute } = await import(pathToFileURL(path.join(root, 'host-lib.mjs')).href);
const { codexWebTried, codexWebProbe, codexPublicRead, codexLocalHits } = await import(pathToFileURL(path.join(root, 'certify-web-lib.mjs')).href);
const { startSession, say, stopAll } = await import(pathToFileURL(path.join(root, 'practice-lib.mjs')).href);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crewzero-chat-test-'));
process.env.SOS_DATA = base;
const byId = Object.fromEntries(hosts(root).map(h => [h.id, h]));
const { claude, codex, agy } = byId;
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
  const attempted = codexWebTried([event(target)], {}, target, 4);
  assert.equal(codexWebProbe(true, 0, attempted), true);
  assert.equal(codexWebProbe(true, 1, attempted), false);
  assert.equal(codexWebProbe(true, 0, codexWebTried([], {}, target, 4)), false);
  assert.equal(codexWebTried([], { t4: 'invalid ref_id' }, target, 4), true);
  assert.equal(codexWebTried([], { t4: '未嘗試，無法驗證' }, target, 4), false);
  assert.equal(codexWebTried([event('https://example.com/')], { t5: '失敗' }, target, 4), false);
}
const token = 'test-token';
const attemptedLocal = codexWebTried([event(url)], {}, url, 4);
for (const lines of [[`${token} refused GET /api/asks`, `${token} refused POST /api/submit`], []])
  assert.equal(codexWebProbe(true, codexLocalHits(lines, token).length, attemptedLocal), true);
for (const line of [token, `${token} refused GET /api/probe`])
  assert.equal(codexWebProbe(true, codexLocalHits([line], token).length, attemptedLocal), false);
assert.equal(codexWebProbe(true, codexLocalHits([], token).length, false), false);
assert.equal(codexPublicRead(true, 'Example Domain'), true);
assert.equal(codexPublicRead(true, ''), false);

const fake = fileURLToPath(new URL('./fake-chat-protocol.mjs', import.meta.url));
const DIR = { data: base, sandbox: path.join(base, 'sandbox') };
const sc = { id: 's', counterpart: { name: '測試對象', role: '經理' }, persona: {}, goal: { text: '測試' }, opening: '你好' };
try {
  for (const protocol of ['claude-stream', 'agy-stream', 'per-turn']) {
    const actual = protocol === 'claude-stream' ? claude : protocol === 'agy-stream' ? agy : codex;
    const args = [fake, protocol, ...actual.chat.args];
    const host = { id: 'test', command: process.execPath, chat: { protocol, args, fastModel: 'fast', reviewModel: 'review' } };
    let session = startSession(DIR, host, sc, 'normal');
    const cwd = path.join(DIR.sandbox, 'practice', session.id);
    for (const line of ['第一句', '第二句']) { const r = await say(DIR, host, session, sc, line); assert.ok(!r.error, r.error); await r.done; session = r.session; }
    const records = fs.readFileSync(path.join(cwd, 'fake-chat.log'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(session.turns.length, 5);
    if (protocol === 'claude-stream') assert.match(records[0].system, /測試對象/);
    if (protocol === 'agy-stream') { assert.ok(!records[0].args.includes('-p')); assert.match(records[1].msg.message.content, /測試對象/); assert.equal(records[2].msg.message.content, '第二句'); }
    if (protocol === 'per-turn') { assert.match(records[0].prompt, /測試對象/); assert.match(records[1].prompt, /第一句/); assert.match(records[1].prompt, /明白，我考慮一下/); assert.match(records[1].prompt, /第二句/); }
  }
  // 模擬 Codex 每句都寫入信任紀錄，檢查下一句前及結束後均已清理。
  const home = path.join(base, 'codex-home'), auth = path.join(base, 'auth-source.json');
  fs.writeFileSync(auth, '{}'); fs.writeFileSync(path.join(base, 'cap_sid'), '{}');
  process.env.SOS_CODEX_AUTH = auth; process.env.SOS_DATA = base;
  const chatHost = { ...codex, root: base, command: process.execPath, chat: { ...codex.chat, args: [fake, 'per-turn', ...codex.chat.args] } };
  let session = startSession(DIR, chatHost, sc, 'normal');
  for (const line of ['第一句', '第二句']) {
    const r = await say(DIR, chatHost, session, sc, line); assert.ok(!r.error, r.error); await r.done; session = r.session;
    assert.equal(fs.existsSync(path.join(home, 'config.toml')), false);
  }
  const records = fs.readFileSync(path.join(DIR.sandbox, 'practice', session.id, 'fake-chat.log'), 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(records.filter(x => Object.hasOwn(x, 'configPresent')).map(x => x.configPresent), [false, false]);
  fs.writeFileSync(path.join(home, 'config.toml'), 'sandbox_mode = "danger-full-access"\n');
  const denied = await say(DIR, chatHost, session, sc, '第三句');
  assert.ok(denied.error); assert.equal(fs.existsSync(path.join(home, 'config.toml')), true);
  const workHost = { ...chatHost, args: [fake, 'per-turn', ...codex.args] };
  const workDir = path.join(DIR.sandbox, 'work-test'); fs.mkdirSync(workDir, { recursive: true });
  assert.equal((await execute(workHost, workDir, '測試')).ok, false);
  fs.writeFileSync(path.join(home, 'config.toml'), `[projects.'d:/test']\ntrust_level = "trusted"\n`);
  for (let i = 0; i < 2; i++) {
    assert.equal((await execute(workHost, workDir, '測試')).ok, true);
    assert.equal(fs.existsSync(path.join(home, 'config.toml')), false);
  }
  console.log('PASS 網上工具、三種對話協定、信任紀錄及認證判斷單元測試');
console.log('1/1 passed');
} finally { stopAll(); }
