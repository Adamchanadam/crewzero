// 監察台修正（2026-10-28）：記錄型工作唔當 AI 完成、結果卡意見字眼／已撳狀態、你的意見紀錄（對齊版：總覽頁底部）
// 用法：node fix-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port> [截圖資料夾]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT, SHOTS] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const { openChrome } = await import(new URL('../lib/cdp-lib.mjs', import.meta.url).href);
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
let srv = null, c = null;
try {
  const DEMO = path.join(OUT, 'demo');
  seedDemo(DEMO, { reset: true });
  await kit.certifyDirect(DEMO, PROTO, ADAPTER);
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DEMO, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
  const B = `http://127.0.0.1:${PORT}`;
  await usePass(B);
  for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/status')).ok) break; } catch { } await sleep(250); }
  const get = async p => (await fetch(B + p)).json();
  const post = async (p, body) => { const r = await fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: B }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  let d;
  // 「工作中」同光流嘅檢查已搬去 v2-test.mjs（設計稿 2026-10-28：冇新鮮度窗）
  c = await openChrome(CHROME, path.join(OUT, 'profile'), 9477);
  await usePass(B, c);

  /* ---------- 3. 記錄型工作唔當 AI 完成 ---------- */
  const before = (await get('/api/dashboard')).deck.freshness.lastRunAt;
  const f1 = await post('/api/intake', { kind: 'note', type: 'feedback', item: 'checkup', cardId: 'weak-1', verdict: 'useful', text: '' });
  const r1 = await waitFor(async () => (await get('/api/status')).runs.find(r => r.kind === 'note' && r.ref === f1.j.id && r.state === 'done'));
  d = await get('/api/dashboard');
  ok('記錄「有用」：外殼冇開 AI', r1 && !(r1.steps || []).some(s => s.key === 'ai'), r1 && r1.steps);
  ok('記錄「有用」：冇生成「AI 完成工作」事件', r1 && !d.events.some(e => e.id === 'ev-' + r1.id) && !d.events.some(e => /(?:AI|Zero) 完成工作/.test(e.title) && (e.relatedIds || []).includes(r1.id)));
  ok('記錄「有用」：照記做你的輸入', d.events.some(e => e.actor === 'founder' && e.title.includes('的意見：有用')));
  // 示範時間按今日推算（對齊到分鐘），所以唔可以比較前後；改為核對「上次 AI 工作」唔係呢個記錄型工作
  ok('記錄「有用」：產出物件唔亮工作中、上次 AI 工作唔計呢個記錄型工作', d.activity.artifacts !== 'working' && d.deck.freshness.lastRunAt !== r1.endedAt && d.runs.find(r => r.id === r1.id).aiStarted === false, { act: d.activity.artifacts, before, after: d.deck.freshness.lastRunAt, rec: r1.endedAt });
  ok('記錄型工作名稱用要求類別（生意大腦意見）', d.runs.find(r => r.id === r1.id).label === '生意大腦意見', d.runs.find(r => r.id === r1.id));
  await c.go(B + '/dashboard/system', 1440, 2000);
  ok('系統頁：記錄型工作標「只記錄（未開 AI）」，唔標完成', await c.ev(`[...document.querySelectorAll('.row-item')].some(r=>r.textContent.includes(${JSON.stringify(N.dash.runRecordOnly)}))`), await c.ev(`document.querySelector('main').textContent.slice(0,600)`));
  const fb1 = d.brain.feedback['weak-1'];
  ok('意見紀錄：附項目名同卡名、已處理', fb1 && fb1.itemName === '生意體檢' && fb1.title === '是否有訂戶願意為新鮮烘焙付較高月費' && !fb1.pending, fb1);

  /* ---------- 4. 收件匣入面未處理嘅意見都計（外殼忙緊都見到） ---------- */
  process.env.SOS_DATA = DEMO;
  const { dataDirs } = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
  const { loadBrain } = await import(pathToFileURL(path.join(PROTO, 'brain-lib.mjs')).href);
  const DIR = dataDirs(PROTO);
  const note = (cardId, verdict, at) => `kind: note\ntype: feedback\nat: ${at}\n\n（冇寫意見）\n\n\`\`\`json\n${JSON.stringify({ cardId, item: 'checkup', verdict, text: '' })}\n\`\`\`\n`;
  const nf = path.join(DIR.inbox, '29991231-000000-001-note-feedback.md'), of = path.join(DIR.inbox, '29991231-000000-002-note-feedback.md');
  fs.writeFileSync(nf, note('weak-3', 'useless', '2999-12-31T00:00:00+00:00'));
  fs.writeFileSync(of, note('weak-1', 'useless', '2000-01-01T00:00:00+00:00'));
  const b = loadBrain(DIR, {});
  ok('收件匣未處理：顯示已送出（pending），有卡名', b.feedback['weak-3'] && b.feedback['weak-3'].pending === true && b.feedback['weak-3'].verdict === 'useless' && b.feedback['weak-3'].title === '網上收款及寄送尚未辦妥', b.feedback['weak-3']);
  ok('收件匣入面比帳本舊嘅意見：唔蓋過帳本', b.feedback['weak-1'].verdict === 'useful' && !b.feedback['weak-1'].pending, b.feedback['weak-1']);
  fs.rmSync(nf); fs.rmSync(of);

  /* ---------- 5. 結果卡意見：字眼、已撳狀態（生意體檢分頁）；你的意見紀錄（總覽頁底部） ---------- */
  await c.go(B + '/dashboard/brain/checkup', 1440, 2500);
  const card = id => `.fb[data-card="${id}"]`;
  ok('已撳嘅意見保持高亮', await c.ev(`document.querySelector('${card('weak-1')} .chipb[data-fb="useful"]').getAttribute('aria-pressed')==='true' && document.querySelector('${card('weak-1')} .chipb[data-fb="useless"]').getAttribute('aria-pressed')==='false'`));
  const said1 = await c.ev(`document.querySelector('${card('weak-1')} .said').textContent`);
  ok('卡上：你的意見：有用 · 時間 · 已記錄（唔係已交 AI）', /^你的意見：有用 · .+ · 已記錄$/.test(said1) && !said1.includes(N.dash.fbToAI), said1);
  const fbRow = id => `#fblog li[data-fb-card="${id}"]`;
  await c.click(`${card('weak-2')} .chipb[data-fb="useless"]`);
  const sendUseless = await c.ev(`document.querySelector('#fb-send').textContent`);
  await c.click(`${card('weak-2')} .chipb[data-fb="revise"]`);
  const sendRevise = await c.ev(`document.querySelector('#fb-send').textContent`);
  ok('送出鍵：有用／沒有用寫「記錄」，要修改寫「交給 AI 修改」', sendUseless === N.dash.fbSend && sendRevise === N.dash.fbSendRevise, { sendUseless, sendRevise });
  await c.click(`${card('weak-2')} .chipb[data-fb="useless"]`);
  if (SHOTS) await c.shot(path.join(SHOTS, 'q02-feedback-choose-1440.png'), '#b-checkup .report');
  await c.ev(`document.querySelector('#fb-send').click()`);
  const instant = await waitFor(async () => c.ev(`(()=>{const s=document.querySelector('${card('weak-2')} .said');return s && /沒有用/.test(s.textContent) && /已記錄/.test(s.textContent) && document.querySelector('${card('weak-2')} .chipb[data-fb="useless"]').getAttribute('aria-pressed')==='true';})()`), 1500);
  ok('撳完即刻：卡上見到沒有用 · 已記錄、按鈕保持高亮', instant, await c.ev(`document.querySelector('${card('weak-2')}').textContent`));
  await sleep(1500);
  await c.go(B + '/dashboard/brain', 1440, 2500);
  ok('你的意見紀錄（總覽頁底部）：寫明屬生意體檢、卡名、意見、已記錄', await c.ev(`(()=>{const r=document.querySelector('${fbRow('weak-1')}');return !!r && /生意體檢/.test(r.textContent) && /是否有訂戶願意為新鮮烘焙付較高月費/.test(r.textContent) && /有用/.test(r.textContent) && /已記錄/.test(r.textContent);})()`), await c.ev(`(document.querySelector('#fblog')||{}).textContent`));
  ok('你的意見紀錄喺總覽頁底部（六格之後）', await c.ev(`(()=>{const a=document.querySelector('#brain-head'),f=document.querySelector('#fblog');return !!f && a.compareDocumentPosition(f)&4;})()`));
  const rowsText = await c.ev(`[...document.querySelectorAll('#fblog li')].map(r=>r.textContent).join(' | ')`);
  ok('紀錄兩條、最新排先', /一人包裝寄貨能否應付/.test(rowsText.split(' | ')[0]) && rowsText.split(' | ').length === 2, rowsText);
  await c.click(fbRow('weak-1') + ' .card a');
  await sleep(2600);
  ok('撳「查看這條」：去生意體檢分頁，跳去嗰張卡並短暫標示', await c.ev(`(()=>{const e=document.querySelector('${card('weak-1')}').closest('.weak');const r=e.getBoundingClientRect();return location.pathname==='/dashboard/brain/checkup' && e.classList.contains('fbhit') && r.top>=0 && r.bottom<=innerHeight;})()`));
  // 要修改：交 AI 修改，卡上同列表跟住進度
  await c.click(`${card('weak-3')} .chipb[data-fb="revise"]`);
  await c.type('#fb-text', '加埋保險報價');
  await c.ev(`document.querySelector('#fb-send').click()`);
  const said3 = await waitFor(async () => { const t = await c.ev(`(document.querySelector('${card('weak-3')} .said')||{}).textContent||''`); return t.includes(N.dash.fbToAI) ? t : null; }, 2000);
  ok('要修改：卡上寫「已交 AI 修改」', said3, said3);
  ok('要修改：AI 改好，卡上有修改版', await waitFor(async () => c.ev(`/修改版/.test(document.querySelector('${card('weak-3')}').textContent)`), 30000), await c.ev(`document.querySelector('${card('weak-3')}').textContent`));
  if (SHOTS) await c.shot(path.join(SHOTS, 'q04-feedback-cards-1440.png'), '#b-checkup .report');
  await c.go(B + '/dashboard/brain', 1440, 2500);
  ok('意見紀錄寫修改版', /修改版/.test(await c.ev(`document.querySelector('${fbRow('weak-3')}').textContent`)));
  if (SHOTS) await c.shot(path.join(SHOTS, 'q03-feedback-list-1440.png'), '#fblog');
  // 手機闊度
  await c.go(B + '/dashboard/brain', 390, 2500);
  ok('手機：意見紀錄冇橫向捲動', await c.ev(`!!document.querySelector('#fblog') && document.documentElement.scrollWidth<=390`), await c.ev(`document.documentElement.scrollWidth`));
  if (SHOTS) await c.shot(path.join(SHOTS, 'q05-feedback-list-390.png'), '#fblog');
  // 冇紀錄：面板寫「尚未有意見」
  fs.rmSync(path.join(DEMO, 'ledger', 'brain-feedback.json'));
  await c.go(B + '/dashboard/brain', 1440, 2500);
  ok('冇意見紀錄：寫「尚未有意見」', await c.ev(`!document.querySelector('#fblog li') && /尚未有意見/.test(document.querySelector('#fblog').textContent)`));
  ok('冇程式錯誤', !c.errors.length, c.errors);
  // 字眼：舊嘅「交給 AI」「已交 AI」唔再出現喺有用／沒有用
  const html = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8');
  ok('監察台冇寫死「已交 AI：」提示', !/已交 (?:AI|Zero)：/.test(html) && !/· 已交 (?:AI|Zero)'/.test(html));
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  if (c) c.close();
  if (srv) srv.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 900));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
