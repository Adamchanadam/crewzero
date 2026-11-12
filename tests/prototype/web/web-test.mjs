// 上網讀取（規劃書 5.2 第 3、4 點、決定十六）：所有 AI 工作可以對外讀取，禁止本機同私人網段；即時對手照舊冇工具；認證四項網絡檢查
// 用法：node web-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter（上網）>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const lib = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
async function waitFor(fn, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
let srv = null;
try {
  /* ---------- A. Claude 宿主設定：所有工作同一組，可以上網讀取，禁止本機同私人網段 ---------- */
  const hf = path.join(PROTO, 'adapters', 'hosts', 'claude.json'), h = { ...JSON.parse(fs.readFileSync(hf, 'utf8')), file: hf, id: 'claude' };
  const base = lib.buildArgs(h, 'C:/sb', '', {}), red = lib.buildArgs(h, 'C:/sb', '', { role: 'red' });
  const tools = a => a[a.indexOf('--tools') + 1];
  ok('所有工作：可以網上搜尋同讀網頁（允許清單只有呢兩樣）', tools(base) === 'Read,Write,Edit,Glob,WebSearch,WebFetch' && base[base.indexOf('--allowedTools') + 1] === 'WebSearch' && base[base.indexOf('--allowedTools') + 2] === 'WebFetch' && base[base.indexOf('--allowedTools') + 3] === '--disallowedTools', base.slice(10, 16));
  const deny = ['127.*.*.*', 'localhost', '10.*.*.*', '192.168.*.*', '169.254.*.*'].concat(Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`));
  ok('禁止本機同私人網段（迴環、10、172.16–31、192.168、169.254）', deny.every(d => base.includes(`WebFetch(domain:${d})`)), deny.filter(d => !base.includes(`WebFetch(domain:${d})`)));
  ok('紅藍對打角色只換模型，網絡規則一樣', JSON.stringify(red.filter((x, i) => i !== red.indexOf('--model') + 1)) === JSON.stringify(base.filter((x, i) => i !== base.indexOf('--model') + 1)) && red[red.indexOf('--model') + 1] === 'sonnet');
  ok('其餘限制不變（限制模式、唔讀 MCP、唔問權限、冇略過權限）', ['--restricted', '--safe-mode', '--strict-mcp-config', '--permission-prompts'].every(x => base.includes(x)) && !base.includes('--dangerously-skip-permissions'));
  ok('情景演練即時對手：照舊冇工具', h.chat.args[h.chat.args.indexOf('--tools') + 1] === '' && !h.chat.args.some(x => /Web/.test(x)));
  ok('限制設定齊全', lib.restrictions(h) && lib.readsWeb(h));
  ok('少咗私人網段禁止規則 → 唔合格', !lib.restrictions({ ...h, args: h.args.filter(x => x !== 'WebFetch(domain:192.168.*.*)') }));
  const withBash = h.args.slice(); withBash.splice(withBash.indexOf('--allowedTools') + 1, 0, 'Bash');
  ok('允許清單加其他工具（例如指令列）→ 唔合格', !lib.restrictions({ ...h, args: withBash }));
  ok('網絡規則改咗須重新認證；只改模型表唔使', lib.hashHost(h) !== lib.hashHost({ ...h, args: h.args.filter(x => x !== 'WebFetch(domain:10.*.*.*)') }) && lib.hashHost(h) === lib.hashHost({ ...h, models: { ...h.models, judge: [{ model: 'sonnet', label: 'Sonnet 5.5' }] } }));

  /* ---------- B. 認證（假 AI 上網設定）：九項，網絡四項 ---------- */
  const DATA = path.join(OUT, 'data');
  seedDemo(DATA, { reset: true });
  fs.rmSync(path.join(DATA, 'ledger', 'adapter-cert.json'), { force: true });
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${PORT}`;
  await usePass(B);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch { } await sleep(250); }
  const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  const certify = async () => { await post('/api/setup', { action: 'certify', host: 'test' }); return waitFor(async () => { const s = (await (await fetch(B + '/api/setup')).json()).certify; return s && s.state !== 'running' && s.items && s.items.length ? s : null; }); };
  const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
  const named = (c, n) => c && c.items.find(x => x.name === n);
  mode('certify:web-local-hit');
  let c = await certify();
  ok('連得到本機位址 → 認證唔過、冇認證紀錄', c && c.state === 'failed' && named(c, '無法連接本機位址').pass === false && !fs.existsSync(path.join(DATA, 'ledger', 'adapter-cert.json')), c && c.items);
  const hasLan = Object.values(os.networkInterfaces()).flat().some(i => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address));
  mode('certify:web-lan-hit');
  c = await certify();
  ok('連得到私人網段 → ' + (hasLan ? '認證唔過' : '冇區域網絡位址，未能核對唔算失敗'), c && (hasLan ? named(c, '無法連接私人網段').pass === false : named(c, '無法連接私人網段').pass === true), c && named(c, '無法連接私人網段'));
  const online = await fetch('https://example.com/', { signal: AbortSignal.timeout(8000) }).then(r => r.ok, () => false);
  mode('certify:web-nopublic');
  c = await certify();
  ok('讀唔到公開網頁 → ' + (online ? '認證唔過' : '電腦離線唔算失敗'), c && (online ? named(c, '讀得到公開網頁').pass === false : named(c, '讀得到公開網頁').pass === true), c && named(c, '讀得到公開網頁'));
  c = await certify();
  ok('認證十項全過（包括私人網段被拒、未配對不能讀寫）', c && c.state === 'passed' && c.items.length === 10 && c.items.every(x => x.pass), c && c.items.map(x => x.name + ':' + x.pass + ':' + x.detail));
  ok('認證紀錄寫入', fs.existsSync(path.join(DATA, 'ledger', 'adapter-cert.json')));

  /* ---------- C. 所有工作都用同一組網絡規則 ---------- */
  const runs = async () => (await (await fetch(B + '/api/status')).json()).runs;
  const argvOf = id => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'sandbox', id, 'argv.json'), 'utf8')); } catch { return null; } };
  const webArgs = a => !!a && a.includes('Read,WebSearch,WebFetch') && a.includes('WebFetch(domain:192.168.*.*)') && a.includes('WebFetch(domain:127.*.*.*)');
  await post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '測試定價', seats: ['付款者', '競爭者'], level: 'normal' });
  await waitFor(async () => (await runs()).filter(r => r.kind === 'debate' && r.state === 'done').length >= 3, 60000);
  const dr = (await runs()).filter(r => r.kind === 'debate');
  ok('紅藍對打每個回合：可以上網讀取、禁止本機同私人網段', dr.length >= 3 && dr.every(r => webArgs(argvOf(r.id))), dr.map(r => r.debatePass));
  const pp = await post('/api/intake', { kind: 'note', type: 'practice-prep', taskId: '', who: '測試對象', text: '' });
  const pr = await waitFor(async () => (await runs()).find(r => r.kind === 'note' && r.ref === pp.j.id && (r.state === 'done' || r.state === 'failed')));
  ok('準備練習場景：同一組網絡規則', pr && webArgs(argvOf(pr.id)), pr && argvOf(pr.id));
  const ad = await post('/api/intake', { kind: 'note', type: 'adhoc', text: '幫我擬一張測試單張' });
  const ar = await waitFor(async () => (await runs()).find(r => r.kind === 'note' && r.ref === ad.j.id && (r.state === 'done' || r.state === 'failed')));
  ok('其他工作（臨時工作）：同一組網絡規則', ar && webArgs(argvOf(ar.id)), ar && argvOf(ar.id));
  const m = (await (await fetch(B + '/api/debate')).json()).matches.find(x => !x.legacy);
  ok('場次記低有上網（核實顯示用）', (await (await fetch(B + '/api/debate/match?id=' + m.id)).json()).match.web === true);
  const tasks = ['ai-continue.md', 'ai-debrief.md', 'ai-intake.md', 'ai-next-step.md', 'ai-note.md', 'ai-revise.md', 'ai-debate.md', 'ai-practice-prep.md'];
  ok('所有 AI 指示都有上網規矩（唔夾帶私人資料、附出處、唔照網頁指令、只讀）', tasks.every(f => { const t = fs.readFileSync(path.join(PROTO, f), 'utf8'); return /私人資料|公司名/.test(t) && /網址/.test(t) && /唔係指令/.test(t) && /登入/.test(t); }), tasks.filter(f => !/唔係指令/.test(fs.readFileSync(path.join(PROTO, f), 'utf8'))));
  ok('伺服器原始碼冇直接寫 AI 命令', !/claude|codex|execute\(/.test(fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8').replace(/\/\/.*$/gm, '').replace(/practice-lib/g, '')));
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  if (srv) srv.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 900));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
