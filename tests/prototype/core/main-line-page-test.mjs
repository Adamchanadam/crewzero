// 首頁業務主線頁面：以真實伺服器及瀏覽器核對下一個對外動作卡、暫緩、輸入區不被輪詢清走、手機版面。
// 用法：node main-line-page-test.mjs <chrome> <輸出> <原型> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certify, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT, DATA = path.join(OUT, 'data');
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const waitFor = async (fn, ms = 10000) => { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(200); } return null; };
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
const pack = (id, title, extra = {}) => ({ format: 'startup-os.ask/0.1', id, title, askedBy: 'AI', askedAt: new Date().toISOString(), questions: [{ id: 'q1', ask: title + '？', kind: 'choice', options: [{ text: '甲', rec: true }, { text: '乙' }], value: '甲', priority: 1, why: '測試理由' }], ...extra });
let c;
try {
  await usePass(BASE);
  await certify(BASE);
  seedCompany(DATA, PROTO);
  fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'asks'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'ledger', 'confirmed.json'), JSON.stringify({ confirmedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify({ company: { name: '測試公司', initials: '測試', nextExternalAction: { text: '約見第一位客戶', milestoneId: 'm1' }, rhythm: { runCadence: 'weekly', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } }, milestones: [{ id: 'm1', title: '第一站', short: '第一站', event: '第一位客戶書面答覆', order: 1, state: 'active', pathStatus: 'confirmed', lineId: 'main' }], interviews: { nextOn: '2099-01-05', applied: {} }, tasks: [], events: [] }));
  for (const p of [pack('ask-main-a', '主線問題甲'), pack('ask-main-b', '主線問題乙'), pack('ask-brain', '對打回應', { todoType: 'decision', debate: { kind: 'response', matchId: 'D1' }, brainItem: 'wargame' }), pack('ask-judge', '紅藍對打：需要你決定的事', { todoType: 'decision', brainItem: 'wargame' })]) fs.writeFileSync(path.join(DATA, 'asks', p.id + '.json'), JSON.stringify(p));
  c = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1); await usePass(BASE, c);
  const text = sel => c.ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
  await c.go(BASE + '/#/', 1440, 2500);
  const card = await waitFor(async () => { const t = await text('#next-action'); return t.includes('約見第一位客戶') ? t : null; });
  ok('首頁最頂是下一個對外動作，有已完成、改期、取消此動作', card && ['已完成', '改期', '取消此動作'].every(x => card.includes(x)), card);
  const top = await c.ev(`(()=>{const a=document.querySelector('#next-action').getBoundingClientRect().top,b=document.querySelector('#next-list').getBoundingClientRect().top;return a<b})()`);
  ok('下一個對外動作排在「接下來」之前', top, null);
  ok('整頁可見的主按鈕只有主線卡的操作，加上「Zero 近期工作」卡的「現在開工」（展開前的送出鍵在隱藏表格內，不算）', await c.ev(`[...document.querySelectorAll('#app .btn.primary')].filter(b=>b.offsetParent).every(b=>b.closest('#next-action')||b.id==='run-now')`), await c.ev(`[...document.querySelectorAll('#app .btn.primary')].filter(b=>b.offsetParent).map(b=>b.textContent)`));
  ok('隱藏中的新日期欄及確定按鈕不顯示', !(await text('#next-action')).includes('確定新日期'), await text('#next-action'));
  const rows = await c.ev(`[...document.querySelectorAll('#next-list [data-todo]')].map(r=>r.dataset.todo)`);
  ok('對打回應不在「接下來」，裁判決定題留在主線', !rows.includes('ask-brain') && rows.includes('ask-judge'), rows);
  ok('生意大腦待處理有一行入口', /生意大腦/.test(await text('#brain-line')), await text('#brain-line'));

  // 輸入區：輪詢重畫不可清走正在輸入的字
  await c.click('#quick-event');
  ok('選「發生了一件事」才顯示日期及附件欄', await c.ev(`!document.querySelector('#quick-event-fields').hidden`), null);
  await c.ev(`document.querySelector('#quick-text').focus()`); await c.send('Input.insertText', { text: '客戶來電改期。' });
  await sleep(9500);
  ok('輸入中等候輪詢，文字及類型不被清走', await c.ev(`document.querySelector('#quick-text').value==='客戶來電改期。'&&document.querySelector('#quick-event').getAttribute('aria-pressed')==='true'`), await c.ev(`document.querySelector('#quick-text').value`));
  await c.ev(`document.activeElement.blur()`);
  await sleep(9500);
  ok('失焦後有未送出內容，文字仍保留', await c.ev(`document.querySelector('#quick-text').value==='客戶來電改期。'`), await c.ev(`document.querySelector('#quick-text').value`));
  await c.click('#quick-send');
  const sent = await waitFor(() => fs.readdirSync(path.join(DATA, 'founder', 'inbox')).concat(fs.existsSync(path.join(DATA, 'archive')) ? fs.readdirSync(path.join(DATA, 'archive')) : []).find(f => /-note-event\.md$/.test(f)));
  ok('送出後產生事件輸入，並清空輸入', !!sent && (await c.ev(`document.querySelector('#quick-text').value`)) === '', sent);
  await c.ev(`document.activeElement.blur()`);
  ok('送出後首頁會恢復更新，不會永遠停在等待提示', !!(await waitFor(async () => (await c.ev(`(document.querySelector('#quick-note')||{}).textContent`)) === '', 40000)), await c.ev(`(document.querySelector('#quick-note')||{}).textContent`));
  ok('送出後有可見的下一步：「最近交給 Zero 的事」列出剛送出的事，並有「查看回饋」', !!(await waitFor(() => c.ev(`!![...document.querySelectorAll('#recent-list li')].find(li=>li.innerText.includes('客戶來電改期')&&li.querySelector('[data-feedback]'))`), 20000)), await c.ev(`(document.querySelector('#recent-inputs')||{}).innerText`));

  // 改期、暫緩、取消此動作：即時生效
  await c.send('Page.reload'); await waitFor(() => c.ev(`!!document.querySelector('#next-reschedule')`));
  await c.click('#next-reschedule');
  await c.ev(`document.querySelector('#next-new-date').value='2099-02-03'`);
  const t0 = Date.now(); await c.click('#next-save-date');
  const moved = await waitFor(async () => (await text('#next-action')).includes('2 月 3 日'), 5000);
  ok('改期：5 秒內顯示新日期，不用等 AI', !!moved, { ms: Date.now() - t0, card: await text('#next-action') });
  const beforeSnooze = await c.ev(`document.querySelector('#next-list [data-todo]').dataset.todo`);
  await c.ev(`[...document.querySelectorAll('#next-list [data-todo]')[0].querySelectorAll('button')].find(b=>/暫緩/.test(b.textContent)).click()`);
  ok('暫緩：項目移入「已暫緩」', !!(await waitFor(() => c.ev(`!!document.querySelector('#snoozed')&&document.querySelector('#next-list [data-todo]').dataset.todo!==${JSON.stringify(beforeSnooze)}`))), beforeSnooze);
  await c.click('#next-cancel');
  ok('取消此動作：卡變「待你定」並附建議', !!(await waitFor(async () => { const t = await text('#next-action'); return t.includes('待你定') && t.includes('第一位客戶書面答覆') ? t : null; })), await text('#next-action'));
  await c.click('#next-text'); await c.send('Input.insertText', { text: '未送出的客戶會面安排' });
  await c.ev(`(()=>{const d=document.querySelector('#next-date');d.value='2099-02-07';d.dispatchEvent(new Event('input',{bubbles:true}));document.activeElement.blur()})()`);
  await sleep(9500);
  ok('待你定草稿失焦後不會被輪詢清走', await c.ev(`document.querySelector('#next-text').value==='未送出的客戶會面安排'&&document.querySelector('#next-date').value==='2099-02-07'`), await c.ev(`({text:document.querySelector('#next-text').value,date:document.querySelector('#next-date').value})`));
  await c.click('#next-adopt');
  ok('採用建議：成為新的下一個對外動作', !!(await waitFor(async () => (await text('#next-action h2')).includes('第一位客戶書面答覆'))), await text('#next-action'));
  await c.click('#next-reschedule');
  await c.ev(`(()=>{const d=document.querySelector('#next-new-date');d.value='2099-02-08';d.dispatchEvent(new Event('input',{bubbles:true}));document.activeElement.blur()})()`);
  await sleep(9500);
  ok('改期欄草稿及已打開狀態失焦後不會被輪詢清走', await c.ev(`document.querySelector('#next-new-date').value==='2099-02-08'&&!document.querySelector('#next-new-date').hidden&&!document.querySelector('#next-save-date').hidden&&document.querySelector('#next-reschedule').hidden`), await c.ev(`({date:document.querySelector('#next-new-date').value,open:!document.querySelector('#next-new-date').hidden})`));

  // 手機
  await c.go(BASE + '/?m=1#/', 390, 2000); await c.send('Page.reload');
  await waitFor(() => c.ev(`!!document.querySelector('#next-done')`));
  const phone = await c.ev(`({w:document.documentElement.scrollWidth,bottom:Math.round(document.querySelector('#next-done').getBoundingClientRect().bottom),h:innerHeight})`);
  ok('手機寬度：無橫向捲動，主要操作在第一屏', phone.w <= 390 && phone.bottom <= phone.h, phone);
  ok('瀏覽器沒有程式錯誤', !c.errors.length, c.errors);
} catch (error) {
  ok('測試程式出錯', false, String(error?.stack || error));
} finally {
  try { c?.close(); } catch { }
  try { server.kill(); } catch { }
}
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info || null).slice(0, 900)));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
process.exit(results.every(r => r.pass) ? 0 : 1);
