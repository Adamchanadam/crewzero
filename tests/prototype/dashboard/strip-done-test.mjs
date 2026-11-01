// 站點完成後（規劃書 3.3 唯一定義處、3.14 第 4 點）喺公司現況壓縮條嘅樣：行真資料鏈——記錄真實事件 → 假 AI 建議站點完成 → 你確認 →
// 外殼套用（下一站進行中、小旗留原站標「待更新」、同一確認包加「下一個對外動作」題）→ 約 6 秒後畫面：下一站標「目前位置」、小旗標「待更新」、
// 三級慶祝寫明下一站 → 你答「下一個對外動作」→ 小旗移去下一站、「待更新」消失。
// 隔離資料夾、虛構示範公司、假 AI、假觀測程式（三個會話工作中，同設計稿慶祝三級一樣）。
// 用法：node strip-done-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js')), D = N.dash, U = N.ui;
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const { openChrome } = await import(pathToFileURL(path.join(HERE, '..', 'lib', 'cdp-lib.mjs')).href);
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
let srv = null, c = null;
try {
  const DEMO = path.join(OUT, 'demo');
  seedDemo(DEMO, { reset: true });
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  const SF = path.join(DEMO, 'ledger', 'state.json'), FAKE = path.join(DEMO, 'fake-observe.json');
  const norm = p => { const s = path.resolve(String(p)).replace(/\\/g, '/').replace(/\/+$/, ''); return process.platform === 'win32' ? s.toLowerCase() : s; };
  const st0 = JSON.parse(fs.readFileSync(SF, 'utf8'));
  st0.observe = { folders: [{ hash: crypto.createHash('sha256').update(norm(DEMO)).digest('hex'), name: '公司工作資料夾' }] };
  fs.writeFileSync(SF, JSON.stringify(st0, null, 2));
  const readSt = () => JSON.parse(fs.readFileSync(SF, 'utf8'));
  const now = () => new Date().toISOString();
  const S = (k, title, sub) => ({ key: k, host: 'claude', kind: 'interactive', state: 'working', title, lastActiveAt: now(), reason: '近 5 分鐘有新紀錄', subagents: { active: sub, windowMinutes: 5 } });
  fs.writeFileSync(FAKE, JSON.stringify({ sessions: [S('de0000000001', '核對牌照要求', 3), S('de0000000003', '比較保險報價', 3), S('de0000000002', '治理設置與路徑覆核', 0)] }));
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DEMO, SOS_ADAPTER: ADAPTER, SOS_OBSERVER: path.join(HERE, 'fake-observe.mjs'), SOS_NO_OPEN: '1' }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${PORT}`;
  await usePass(B);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch { } await sleep(250); }
  const get = async p => (await fetch(B + p)).json();
  const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  const runsOf = async () => (await get('/api/status')).runs;
  const seenIds = async () => new Set((await runsOf()).map(r => r.id));
  const newRun = (seen, pred) => waitFor(async () => (await runsOf()).find(r => !seen.has(r.id) && pred(r) && (r.state === 'done' || r.state === 'failed')), 60000);
  const packOf = id => JSON.parse(fs.readFileSync(path.join(DEMO, 'asks', id + '.json'), 'utf8'));
  function answer(P) {
    const store = (() => { try { return JSON.parse(fs.readFileSync(path.join(DEMO, 'ledger', 'answers', P.id + '.json'), 'utf8')).answers || {}; } catch { return {}; } })();
    const qs = P.questions.filter(q => !store[q.id]);
    const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: qs.map(q => q.id), answers: qs.map(q => ({ id: q.id, value: q.value, ai: q.value, changed: false })) };
    const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
    return post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  }
  c = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
  await usePass(B, c);
  const strip = () => c.ev(`(()=>{const st=[...document.querySelectorAll('#strip .st-stage[data-ms]')].map(b=>({id:b.dataset.ms,now:b.classList.contains('now'),small:(b.querySelector('small')||{}).textContent||'',fl:!!b.querySelector('.fl'),pend:!!b.querySelector('.fl.pend')}));const cap=(document.querySelector('.strip-cap')||{}).innerText||'';return {st,cap,bn3:(document.querySelector('.o-bn3')||{}).innerText||''}})()`);
  const msShort = id => (readSt().milestones.find(m => m.id === id) || {}).short;

  /* 開局：第 1 站「農場簽約」進行中、小旗喺佢度；「牌照保險」等待中（同一條路線同時兩站進行中） */
  await c.go(B + '/dashboard', 1440, 4500);
  const s0 = await strip(), flag0 = readSt().company.nextExternalAction;
  const nowId0 = (s0.st.find(x => x.now) || {}).id;
  ok('開局：目前位置係路線上最前一個進行中嘅已確認站（只標一個）', s0.st.filter(x => x.now).length === 1 && nowId0 === 'm1' && s0.cap.includes(msShort('m1') + '（' + D.currentL + '）'), s0);
  ok('開局：試行站唔當目前位置，寫「試行」', s0.st.some(x => x.id === 'm1t' && !x.now && x.small === D.legendTrial), s0.st);
  ok('開局：小旗喺第 1 站，冇「待更新」', flag0.milestoneId === 'm1' && s0.st.find(x => x.id === 'm1').fl && !s0.st.some(x => x.pend) && !s0.cap.includes(U.flagPending), { flag0, s0 });

  /* 記錄真實事件 → 假 AI 建議第 1 站完成 → 你照建議確認 */
  let seen = await seenIds();
  fs.writeFileSync(path.join(DEMO, 'fake-mode.txt'), 'event:event-pick-m1' + String.fromCharCode(10));
  const e1 = await post('/api/intake', { kind: 'note', type: 'event', text: '（測試）農場主丙今日簽咗供應協議，並以電郵確認。', date: lib.localIso().slice(0, 10) });
  const er = await newRun(seen, r => r.kind === 'note' && r.noteType === 'event');
  const pk = (await get('/api/asks')).packs.filter(p => p.open).map(p => packOf(p.id)).find(p => p.realEvent);
  ok('真實事件：AI 擬好確認題（包括站點完成）', e1.code === 202 && er && er.state === 'done' && pk && pk.questions.some(q => (q.options || []).some(o => o.apply && o.apply.op === 'markDone' && o.apply.id === 'm1')), { e1, er: er && er.result, pk: pk && pk.questions.map(q => q.ask) });
  seen = await seenIds();
  await answer(pk);
  const ar = await newRun(seen, r => r.kind === 'ask' && r.ref === pk.id);
  const tDone = Date.now();
  const sA = readSt(), m1 = sA.milestones.find(m => m.id === 'm1'), m4 = sA.milestones.find(m => m.id === 'm4');
  ok('外殼套用：第 1 站完成；下一站「牌照保險」仍然進行中（等待），冇第三站被開', ar && ar.state === 'done' && m1.state === 'done' && m4.state === 'waiting' && sA.milestones.filter(m => m.pathStatus === 'confirmed' && ['active', 'waiting', 'blocked'].includes(m.state)).length <= 2, { m1: m1.state, m4: m4.state, sum: ar && ar.result });
  ok('外殼套用：小旗留喺完成咗嘅站、標待更新；同一確認包加咗「下一個對外動作」題（AI 預填下一站嘅事件）', sA.company.nextExternalAction.milestoneId === 'm1' && sA.company.nextExternalAction.pendingUpdate === true && packOf(pk.id).questions.some(q => q.id === 'nad' && q.options.some(o => o.apply && o.apply.op === 'setNextExternalAction' && o.apply.milestoneId === 'm4')), { nea: sA.company.nextExternalAction, qs: packOf(pk.id).questions.map(q => q.id) });

  /* 畫面：三級慶祝寫明下一站；約 6 秒後壓縮條 */
  const bn = await waitFor(async () => { const x = await strip(); return x.bn3 ? x : null; }, 12000);
  await sleep(1300); await c.shot(path.join(OUT, 'done-celebration-1440.png'));
  ok('三級慶祝：寫明進入下一站「牌照保險」', bn && bn.bn3.includes(msShort('m4')), bn && bn.bn3);
  await sleep(Math.max(0, 6000 - (Date.now() - tDone)));
  const s6 = await strip();
  await c.shot(path.join(OUT, 'done-after-6s-1440.png'));
  const n6 = s6.st.find(x => x.now) || {};
  ok('約 6 秒後：「牌照保險」標目前位置（等待），壓縮條標題同步；只標一個', s6.st.filter(x => x.now).length === 1 && n6.id === 'm4' && n6.small === D.currentL && s6.cap.includes(msShort('m4') + '（' + D.currentL + ' · ' + D.ms_waiting + '）'), s6);
  ok('約 6 秒後：小旗照規劃書 3.3 留喺已完成嘅站、標「待更新」，等你答先移', s6.st.find(x => x.id === 'm1').fl && s6.st.find(x => x.id === 'm1').pend && !s6.st.find(x => x.id === 'm4').fl && s6.cap.includes('（' + U.flagPending + '）'), s6);

  /* 你答「下一個對外動作」：小旗移去下一站，「待更新」消失 */
  seen = await seenIds();
  await answer(packOf(pk.id));
  const nr = await newRun(seen, r => r.kind === 'ask' && r.ref === pk.id);
  const sB = readSt().company.nextExternalAction;
  ok('答咗：小旗移去「牌照保險」、冇待更新', nr && nr.state === 'done' && sB.milestoneId === 'm4' && !sB.pendingUpdate, { sB, nr: nr && nr.result });
  const sM = await waitFor(async () => { const x = await strip(); return x.st.find(z => z.id === 'm4' && z.fl) ? x : null; }, 15000);
  await c.shot(path.join(OUT, 'done-flag-moved-1440.png'));
  ok('畫面：小旗喺「牌照保險」、已完成嘅站冇小旗、標題冇「待更新」', sM && !sM.st.find(x => x.id === 'm1').fl && !sM.st.some(x => x.pend) && !sM.cap.includes(U.flagPending), sM || await strip());

  /* 頁頭「待決事項」指標下面：設計稿字眼（分頁名） */
  const sub = await c.ev(`(document.querySelector('[data-m="pendingText"]')||{}).textContent||''`), cnt = (await get('/api/shell')).metrics.pending;
  ok('頁頭「待決事項」指標下面：有待決時寫「待決事項」（設計稿），冇就寫「沒有待決事項」', sub === (cnt ? U.pending : D.noPendingShort) && sub !== D.toDeskAsk, { sub, cnt });
  ok('頁面冇程式錯誤', !(c.errors || []).length, c.errors);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  try { c && c.close(); } catch { } try { srv && srv.kill(); } catch { }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
