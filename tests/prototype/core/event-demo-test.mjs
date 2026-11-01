// 示範帳本保護：示範有公司概覽同成頁確認，但帳本係手造（試行、已撤、觀察項）；記錄真實事件唔可以用公司概覽覆寫帳本
// 用法：node event-demo-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true });
const DATA = path.join(OUT, 'data');
const { seedDemo } = await import(new URL('file:///' + path.join(PROTO, 'demo-seed.mjs').replace(/\\/g, '/')).href);
seedDemo(DATA, { copyCert: false });
const before = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: ['ignore', 'pipe', 'pipe'] });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; }
try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 15000);
  await post('/api/setup', { action: 'certify', host: 'test' });
  await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running'; });
  const sub = await post('/api/intake', { kind: 'note', type: 'event', text: '測試：農場甲書面確認供貨。', date: '2026-10-29' });
  ok('示範：真實事件收到', sub.code === 202, sub);
  const r = await waitFor(async () => (await get('/api/status')).runs.find(x => x.kind === 'note' && x.noteType === 'event' && x.state !== 'running'));
  ok('示範：AI 工作完成', r && r.state === 'done', r && { state: r.state, error: r.error });
  const s = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
  const ids = x => x.milestones.map(m => m.id + ':' + m.pathStatus + ':' + (m.watchItems || []).length + ':' + (m.trial ? 'trial' : '')).join(',');
  ok('示範帳本唔被公司概覽覆寫：站、試行、已撤、觀察項照舊；冇 ledgerFrom', ids(s) === ids(before) && !s.ledgerFrom && s.demo === true, { before: ids(before), after: ids(s), from: s.ledgerFrom });
  ok('示範：仍可記錄真實事件（輸入已登記）', (s.inputs || []).some(i => i.id === 'in-' + sub.j.id));
} catch (e) { ok('測試程式出錯', false, String(e && e.stack || e)); }
finally {
  srv.kill();
  const pass = results.filter(x => x.pass).length;
  for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + (x.pass ? '' : '\n      ' + JSON.stringify(x.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
