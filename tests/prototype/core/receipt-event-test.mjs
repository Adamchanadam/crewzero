// 收據入帳（真實 AI 形狀）：0.43.0 真實 AI 驗收發現外殼把入帳建議靜靜丟棄（金額是數字、類別是中文字）。
// 甲：ai-event.md 列出的類別代號與 CATEGORIES、名稱表完全一致，並寫明金額寫法。
// 乙：入帳建議核對純函數（金額換算、類別改用「其他」、逐欄錯誤）。
// 丙：重播真實 AI 原輸出 → 出一條入帳題 → 「修改後入帳」改類別 → 只入一筆。
// 丁：假 AI 照真實形狀交回 → 出一條入帳題 → 「確認入帳」 → 只入一筆。
// 戊：修正後仍不合格而丟棄 → 修正提示指出欄位及可用的值；回饋頁及首頁不顯示「沒有影響」，改為說明款項未能記入及「記一筆」。
// 己：收據跟進（FOLLOWUP.md）：只有文字的款項兩種狀態均提示「款項未能記入」、目標數字反例不提示；確認入帳後不再「沒有影響」、不入帳照舊。
// 庚：0.44.0 R 線（docs/evidence/journey-0440/dispatch/brief-r1.md；impl-plan.md 第 9.8 節）：支出對方寫自己公司、退款單、月結單、
//     早於事件日期的跟進（寬鬆丟棄）、可能重複入帳提示（收據確認題及「記一筆」），及沒有相近紀錄時不提示的反例。截圖放 <輸出>/shots-dup/。
// 用法：node receipt-event-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO_ARG, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PROTO = path.resolve(PROTO_ARG), PORT = Number(PORT_TEXT);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const moneyLib = await import(pathToFileURL(path.join(PROTO, 'money-lib.mjs')).href);
const { CATEGORIES } = moneyLib;
const FIXTURE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'fixtures', 'receipt', 'event-real-0430.json');
const results = [], ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const waitFor = async (fn, ms = 60000, step = 300) => { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(step); } return null; };
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// 最小 JPEG（1×1）：收據圖片內容不影響外殼核對，確認題頁只需顯示得到
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const SAID = '附上一張買器材的收據，請幫我記下。';

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });

/* 甲：ai-event.md 的類別代號及金額寫法 */
const md = fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8');
const listed = (word, dir) => { const line = md.split(/\r?\n/).find(l => l.startsWith(`- ${word}（\`dir\` 為 \`${dir}\`）：`)); return line ? [...line.matchAll(/`([A-Za-z]+)`（([^）]+)）/g)].map(m => [m[1], m[2]]) : []; };
const lin = listed('收入', 'in'), lout = listed('支出', 'out');
ok('RE-01 ai-event.md 列出的收入及支出類別代號與 CATEGORIES 完全一致（次序亦同）', JSON.stringify(lin.map(x => x[0])) === JSON.stringify(CATEGORIES.in) && JSON.stringify(lout.map(x => x[0])) === JSON.stringify(CATEGORIES.out), { in: lin, out: lout });
ok('RE-02 每個代號後的名稱與名稱表 mnyCat_ 相同', lin.length + lout.length > 0 && [...lin, ...lout].every(([k, label]) => N.ui['mnyCat_' + k] === label), [...lin, ...lout].filter(([k, label]) => N.ui['mnyCat_' + k] !== label));
ok('RE-03 ai-event.md 寫明金額寫法（例子 1293.50、不加幣別符號、最多兩位小數）', /`amount`[^\n]*1293\.50/.test(md) && /最多兩位小數/.test(md) && /不加幣別符號/.test(md));
// 已付／未付（方案甲）：指示要保留以下規則，防止日後被刪（補丁 11:46 版新增，主線手動併入）
const PAID_RULES = ['以付款憑據判斷，不看單據標題', '「PAID」', '未付的不加 `money`', '`reason` 亦要用一句說明', '不早於事件日期，才另加一項 `followUp`', '訂金只按實收金額入帳', '單據未顯示已付款', '在 `what` 末尾寫「單據號碼 <號碼>」'];  // 0.44.0 R 線（impl-plan 9.6）把號碼定為固定寫法
ok('RE-19 ai-event.md 有已付／未付規則：付款憑據、未付不入帳、跟進日期、訂金、狀態不明、單據號碼', PAID_RULES.every(rule => md.includes(rule)), PAID_RULES.filter(rule => !md.includes(rule)));

/* 乙：入帳建議核對純函數 */
const check = moneyLib.eventMoneyItem;
const base = { kind: 'money', dir: 'out', amount: 1293.5, currency: 'HKD', date: '2026-11-06', payer: '青嶺咖啡器材行', what: '器材', category: 'tools', file: 'IMG_2041.jpg', quote: 'HK$1,293.50', why: '收據' };
const run = it => { try { return check({ ...base, ...it }, ['IMG_2041.jpg']); } catch (e) { return { thrown: String(e && e.message || e) }; } };
if (typeof check !== 'function') ok('RE-04 money-lib.mjs 有 eventMoneyItem 純函數', false, typeof check);
else {
  const cents = [[1293.5, 129350], [640, 64000], ['1293.50', 129350], ['1,293.50', 129350], ['HK$1,293.50', 129350]].map(([amount, want]) => [amount, run({ amount }).amountCents, want]);
  ok('RE-04 數字及文字金額按現有規則換算（1293.5→129350、640→64000）', cents.every(([, got, want]) => got === want), cents);
  const bad = [12.345, 0, -5, 'abc', '', null].map(amount => [amount, run({ amount })]);
  ok('RE-05 三位小數、零、負數、非數字及空白被拒絕，錯誤指出 amount', bad.every(([, r]) => r && r.ok === false && r.errors.some(e => /amount/.test(e))), bad);
  const guessOut = run({ category: '器材' }), guessIn = run({ dir: 'in', category: '雜項收入' }), known = run({});
  ok('RE-06 類別不認得時改用該方向的「其他」（支出 otherOut、收入 otherIn），認得的類別不變', guessOut.ok && guessOut.category === 'otherOut' && guessOut.categoryGuessed === true && guessIn.ok && guessIn.category === 'otherIn' && known.ok && known.category === 'tools' && !known.categoryGuessed, { guessOut, guessIn, known });
  const wrongDir = run({ dir: 'expense' }), wrongFile = run({ file: 'IMG_9999.jpg' }), wrongDate = run({ date: '6/11/2026' }), wrongCur = run({ currency: '港幣' });
  ok('RE-07 方向不合格不會出錯，錯誤指出 dir 及可用的 in、out', wrongDir.ok === false && wrongDir.errors.some(e => /dir/.test(e) && /in/.test(e) && /out/.test(e)), wrongDir);
  ok('RE-08 附件、日期、幣別不合格時，錯誤分別指出欄名及可用的值或寫法', wrongFile.ok === false && wrongFile.errors.some(e => /file/.test(e) && e.includes('IMG_2041.jpg')) && wrongDate.ok === false && wrongDate.errors.some(e => /date/.test(e) && /YYYY-MM-DD/.test(e)) && wrongCur.ok === false && wrongCur.errors.some(e => /currency/.test(e) && /HKD/.test(e)), { wrongFile, wrongDate, wrongCur });
}

/* 丙至戊：真實伺服器及外殼（假 AI） */
const servers = [];
function instance(name, port, prep) {
  const DATA = path.join(OUT, name, 'data');
  fs.mkdirSync(DATA, { recursive: true });
  seedCompany(DATA, PROTO);
  const page = readJSON(path.join(DATA, 'company', 'page.json'));
  fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'ledger', 'confirmed.json'), JSON.stringify({ company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(m => m.id), values: {}, edits: [] }));
  prep(DATA);
  return { DATA, BASE: `http://127.0.0.1:${port}`, port };
}
async function start(inst) {
  await certifyDirect(inst.DATA, PROTO, ADAPTER);
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(inst.port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: inst.DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
  servers.push(srv);
  await waitFor(async () => (await fetch(inst.BASE + '/api/health')).ok, 20000);
  await usePass(inst.BASE);
}
const api = async (BASE, p, body) => { const r = await fetch(BASE + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function tell(inst, data = JPEG) {
  const r = await api(inst.BASE, '/api/intake', { kind: 'note', type: 'event', text: SAID, date: '2026-11-12', files: [{ name: 'IMG_2041.jpg', data }] });
  const id = r.j && r.j.id ? 'in-' + r.j.id : '';
  const input = id && await waitFor(() => { const i = ((readJSON(path.join(inst.DATA, 'ledger', 'state.json')) || {}).inputs || []).find(x => x.id === id); return i && ['awaitingFounder', 'processed', 'failed'].includes(i.status) ? i : null; });
  return { id, input, intake: r };
}
const moneyQs = (inst, input) => { const pack = input && input.packId ? readJSON(path.join(inst.DATA, 'asks', input.packId + '.json')) : null; return { pack, qs: (pack && pack.questions || []).filter(q => q.kind === 'money') }; };
const idle = inst => waitFor(async () => { const d = (await api(inst.BASE, '/api/dashboard')).j; return d && d.ai && !d.ai.busy; }, 60000, 500);
const recordsOf = async (inst, inputId) => ((await api(inst.BASE, '/api/money')).j?.records || []).filter(r => (r.evidence || []).some(e => e.inputId === inputId));
async function answer(chrome, inst, packId, qid, edit) {
  await usePass(inst.BASE, chrome);
  await chrome.go(inst.BASE + '/#/ask/' + packId, 1440, 1500);
  const shown = await waitFor(() => chrome.ev(`(()=>{const q=document.querySelector('#q-${qid}');return !!q&&!!document.querySelector('#money-confirm-${qid}')})()`), 15000);
  const text = shown ? await chrome.ev(`document.querySelector('#q-${qid}').innerText`) : '';
  if (shown && edit) {
    await chrome.click('#money-edit-' + qid);
    await waitFor(() => chrome.ev(`!!document.querySelector('#money-category-${qid}')`), 5000);
    await chrome.ev(`(()=>{const e=document.querySelector('#money-category-${qid}');e.value=${JSON.stringify(edit)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`);
    await chrome.click('#money-edit-save-' + qid);
  } else if (shown) await chrome.click('#money-confirm-' + qid);
  const done = shown && await waitFor(() => chrome.ev(`(document.querySelector('#money-answer-${qid}')||{}).innerText||''`), 10000);
  if (done) { await chrome.click('#go-main'); await sleep(600); await chrome.click('#do-confirm'); }
  return { shown: !!shown, text, done };
}

let chrome;
try {
  chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);

  /* 丙：重播真實 AI 原輸出（金額 1293.5、類別「器材」） */
  const real = instance('replay-real', PORT, DATA => fs.copyFileSync(FIXTURE, path.join(DATA, 'replay-event.json')));
  await start(real);
  const r1 = await tell(real), m1 = moneyQs(real, r1.input), q1 = m1.qs[0];
  ok('RE-09 重播真實原輸出：出一條入帳題，金額 HK$1,293.50、日期 2026-11-06、類別改用 otherOut', r1.input && r1.input.status === 'awaitingFounder' && m1.qs.length === 1 && q1.money.amountCents === 129350 && q1.money.date === '2026-11-06' && q1.money.dir === 'out' && q1.money.category === 'otherOut', { status: r1.input && r1.input.status, qs: m1.qs.map(q => q.money) });
  if (q1) {
    const a1 = await answer(chrome, real, r1.input.packId, q1.id, 'tools');
    ok('RE-10 確認題顯示所用類別（其他支出）', a1.text.includes(N.ui.mnyCat_otherOut), a1.text.slice(0, 400));
    await sleep(1500); await idle(real);
    const done1 = await waitFor(() => { const i = ((readJSON(path.join(real.DATA, 'ledger', 'state.json')) || {}).inputs || []).find(x => x.id === r1.id); return i && i.status === 'processed' ? i : null; });
    const recs1 = await waitFor(async () => { const r = await recordsOf(real, r1.id); return r.length ? r : null; }, 30000);
    await sleep(3000);
    const again1 = await recordsOf(real, r1.id);
    ok('RE-11 「修改後入帳」改類別為 tools 後只入一筆（來源收據、金額及類別正確）', !!done1 && again1.length === 1 && again1[0].amountCents === 129350 && again1[0].category === 'tools' && again1[0].source === 'receipt', { status: done1 && done1.status, recs: (recs1 || []).map(r => [r.amountCents, r.category, r.source]), again: again1.map(r => [r.amountCents, r.category]) });
  }

  /* 丁：假 AI 照真實形狀交回 */
  const shaped = instance('fake-shape', PORT + 2, DATA => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), 'event:event-receipt\n'));
  await start(shaped);
  const r2 = await tell(shaped), m2 = moneyQs(shaped, r2.input), q2 = m2.qs[0];
  ok('RE-12 假 AI 真實形狀（數字金額、中文類別）：出一條入帳題，類別改用 otherOut', r2.input && r2.input.status === 'awaitingFounder' && m2.qs.length === 1 && q2.money.amountCents === 129350 && q2.money.category === 'otherOut', { status: r2.input && r2.input.status, qs: m2.qs.map(q => q.money) });
  if (q2) {
    await answer(chrome, shaped, r2.input.packId, q2.id, '');
    await sleep(1500); await idle(shaped);
    await waitFor(async () => (await recordsOf(shaped, r2.id)).length, 30000);
    await sleep(3000);
    const recs2 = await recordsOf(shaped, r2.id);
    ok('RE-13 按「確認入帳」後只入一筆', recs2.length === 1 && recs2[0].amountCents === 129350 && recs2[0].category === 'otherOut', recs2.map(r => [r.amountCents, r.category, r.source]));
  }

  /* 戊：修正後仍不合格（附件名不是今次附件）而丟棄 */
  const dropped = instance('dropped', PORT + 4, DATA => { const ev = readJSON(FIXTURE); ev.items[0].file = 'IMG_9999.jpg'; fs.writeFileSync(path.join(DATA, 'replay-event.json'), JSON.stringify(ev, null, 2)); });
  await start(dropped);
  const r3 = await tell(dropped);
  await idle(dropped);
  const sb = path.join(dropped.DATA, 'sandbox'), repair = (fs.existsSync(sb) ? fs.readdirSync(sb) : []).map(d => path.join(sb, d, 'task.md')).filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8')).find(t => t.includes('修正真實事件建議')) || '';
  ok('RE-14 修正提示指出 file 不合格並列出今次附件 IMG_2041.jpg，不再用籠統一句', /file/.test(repair) && repair.includes('IMG_2041.jpg') && !repair.includes('方向、金額、幣別、日期、類別、對方、內容或附件不符合格式'), repair.slice(0, 600));
  ok('RE-15 最終丟棄：輸入已處理，沒有入帳紀錄', r3.input && r3.input.status === 'processed' && (await recordsOf(dropped, r3.id)).length === 0, r3.input && r3.input.status);
  await usePass(dropped.BASE, chrome);
  await chrome.go(dropped.BASE + '/#/feedback/' + r3.id, 1440, 1500);
  const fb = await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#fb-card');return c?c.innerText:''})()`), 15000) || '';
  const toMoney = await chrome.ev(`[...document.querySelectorAll('#fb-card a')].some(a=>(a.getAttribute('href')||'').includes('/dashboard/money'))`);
  ok('RE-16 回饋頁不顯示「沒有影響」，改為說明款項未能記入並建議「記一筆」，有連結到業績報告', !!N.ui.mnyNotRecorded && !fb.includes('沒有影響') && fb.includes(N.ui.mnyNotRecorded) && N.ui.mnyNotRecorded.includes('記一筆') && toMoney, fb.slice(0, 700));
  await chrome.shot(path.join(OUT, 'dropped-feedback.png'), '#fb-card');
  await chrome.go(dropped.BASE + '/#/', 1440, 1500);
  const row = await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('[data-input="${r3.id}"]');return e?e.textContent:''})()`), 15000) || '';
  ok('RE-17 首頁「最近交給 Zero 的事」不顯示「沒有影響」，標示款項未記入', !!N.ui.inStMoneyNotRecorded && row && !row.includes('沒有影響') && row.includes(N.ui.inStMoneyNotRecorded), row.slice(0, 300));
  /* 己：收據跟進（docs/evidence/journey-0440/real-ai/receipt/FOLLOWUP.md） */
  const stateInput = (inst, id) => ((readJSON(path.join(inst.DATA, 'ledger', 'state.json')) || {}).inputs || []).find(x => x.id === id) || null;
  const feedbackOf = async (inst, id) => { await usePass(inst.BASE, chrome); await chrome.go(inst.BASE + '/#/feedback/' + id, 1440, 1500); const t = await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#fb-card');return c?c.innerText:''})()`), 15000) || ''; const link = await chrome.ev(`[...document.querySelectorAll('#fb-card a')].some(a=>(a.getAttribute('href')||'').includes('/dashboard/money'))`); return { text: t, link }; };
  const homeRowOf = async (inst, id) => { await chrome.go(inst.BASE + '/#/', 1440, 1500); return await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('[data-input="${id}"]');return e?e.textContent:''})()`), 15000) || ''; };
  async function tellText(inst, text) {
    const r = await api(inst.BASE, '/api/intake', { kind: 'note', type: 'event', text, date: '2026-11-12', files: [] });
    const id = r.j && r.j.id ? 'in-' + r.j.id : '';
    const input = id && await waitFor(() => { const i = stateInput(inst, id); return i && ['awaitingFounder', 'processed', 'failed'].includes(i.status) ? i : null; });
    return { id, input, intake: r };
  }
  // 第 1 項（甲）：只有文字的款項，沒有其他改動
  const textOnly = instance('text-money', PORT + 6, DATA => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), 'event:event-text-money\n'));
  await start(textOnly);
  const t1 = await tellText(textOnly, '乙餐廳今日以現金付清首月訂金 HK$800，沒有收據。');
  await idle(textOnly);
  const fb1 = await feedbackOf(textOnly, t1.id), row1 = await homeRowOf(textOnly, t1.id);
  ok('RE-20 只有文字的款項（沒有其他改動）：輸入記 moneyNotRecorded；回饋頁不顯示「沒有影響」，有「款項未能記入」及「記一筆」說明及業績報告連結', !!t1.input && !!stateInput(textOnly, t1.id)?.moneyNotRecorded && !fb1.text.includes('沒有影響') && fb1.text.includes(N.ui.mnyNotRecorded) && fb1.link, { status: t1.input && t1.input.status, moneyNotRecorded: stateInput(textOnly, t1.id)?.moneyNotRecorded, feedback: fb1.text.slice(0, 600), link: fb1.link });
  ok('RE-21 只有文字的款項：首頁「最近交給 Zero 的事」不顯示「沒有影響」，標示款項未記入', !!row1 && !row1.includes('沒有影響') && row1.includes(N.ui.inStMoneyNotRecorded), row1.slice(0, 300));
  // 第 1 項（乙）：同一件事另有確認題（新對象）
  const withActor = instance('text-money-actor', PORT + 7, DATA => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), 'event:event-text-money-actor\n'));
  await start(withActor);
  const t2 = await tellText(withActor, '乙餐廳的黃小姐今日以現金付清首月訂金 HK$800，沒有收據。');
  await idle(withActor);
  const fb2 = await feedbackOf(withActor, t2.id);
  ok('RE-22 只有文字的款項而同一件事另有確認題：回饋頁同樣出現「款項未能記入」一步', !!t2.input && t2.input.status === 'awaitingFounder' && !!stateInput(withActor, t2.id)?.moneyNotRecorded && fb2.text.includes(N.ui.mnyNotRecorded), { status: t2.input && t2.input.status, moneyNotRecorded: stateInput(withActor, t2.id)?.moneyNotRecorded, feedback: fb2.text.slice(0, 600) });
  // 反例：原話只是目標數字，假 AI 不加旗號
  const target = instance('text-target', PORT + 8, DATA => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), 'event:event-text-target\n'));
  await start(target);
  const t3 = await tellText(target, '我希望下個月每月多賺三千元。');
  await idle(target);
  const fb3 = await feedbackOf(target, t3.id), row3 = await homeRowOf(target, t3.id);
  ok('RE-23 反例：原話只是目標數字而沒有旗號，不出「款項未能記入」提示', !!t3.input && !stateInput(target, t3.id)?.moneyNotRecorded && !fb3.text.includes(N.ui.mnyNotRecorded) && !row3.includes(N.ui.inStMoneyNotRecorded), { status: t3.input && t3.input.status, moneyNotRecorded: stateInput(target, t3.id)?.moneyNotRecorded, feedback: fb3.text.slice(0, 400), row: row3 });
  // 第 2 項：確認入帳後不再是「沒有影響」（用丁的實例）；拒絕入帳照舊
  if (r2 && r2.id) {
    const in2 = stateInput(shaped, r2.id), fb4 = await feedbackOf(shaped, r2.id);
    ok('RE-24 確認入帳後：這件事有一項款項改動（targetKind money），回饋頁不顯示「沒有影響」', (in2?.effects || []).some(e => e && e.targetKind === 'money') && !fb4.text.includes('沒有影響'), { effects: in2 && in2.effects, feedback: fb4.text.slice(0, 500) });
  }
  const rejected = instance('reject', PORT + 9, DATA => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), 'event:event-receipt\n'));
  await start(rejected);
  const r5 = await tell(rejected), q5 = moneyQs(rejected, r5.input).qs[0];
  if (q5) {
    await usePass(rejected.BASE, chrome);
    await chrome.go(rejected.BASE + '/#/ask/' + r5.input.packId, 1440, 1500);
    if (await waitFor(() => chrome.ev(`!!document.querySelector('#money-reject-${q5.id}')`), 15000)) {
      await chrome.click('#money-reject-' + q5.id);
      if (await waitFor(() => chrome.ev(`(document.querySelector('#money-answer-${q5.id}')||{}).innerText||''`), 10000)) { await chrome.click('#go-main'); await sleep(600); await chrome.click('#do-confirm'); }
    }
    await sleep(1500); await idle(rejected);
    await waitFor(() => stateInput(rejected, r5.id)?.status === 'processed', 30000);
  }
  const in5 = stateInput(rejected, r5.id);
  ok('RE-25 拒絕入帳（不入帳）照舊：沒有入帳紀錄，也沒有款項改動', !!q5 && in5?.status === 'processed' && (await recordsOf(rejected, r5.id)).length === 0 && !(in5?.effects || []).some(e => e && e.targetKind === 'money'), { question: !!q5, status: in5 && in5.status, effects: in5 && in5.effects });

  /* 庚：0.44.0 R 線 */
  const SHOTS = path.join(OUT, 'shots-dup');
  const setMode = (inst, text) => fs.writeFileSync(path.join(inst.DATA, 'fake-mode.txt'), text);
  const packsFor = (inst, inputId) => { const dir = path.join(inst.DATA, 'asks'); return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(dir, f))).filter(p => p && p.realEvent && p.realEvent.inputId === inputId); };
  const moneyQsOf = (inst, inputId) => packsFor(inst, inputId).flatMap(p => (p.questions || []).filter(q => q.kind === 'money').map(q => ({ ...q, packId: p.id })));
  const allRecords = async inst => ((await api(inst.BASE, '/api/money')).j?.records || []);
  const countOf = (text, part) => String(text || '').split(part).length - 1;
  const PAYER_NOTE = `（${N.ui.mnyPayerNote}）`;
  const repairRan = inst => { const sb = path.join(inst.DATA, 'sandbox'); return (fs.existsSync(sb) ? fs.readdirSync(sb) : []).some(d => { const f = path.join(sb, d, 'job.json'); return fs.existsSync(f) && (readJSON(f) || {}).type === 'event-repair'; }); };
  // 提示內不可出現的字：紀錄編號、檔名、內部欄位名
  const FORBIDDEN = /mn-\d{4}|IMG_|\.(?:jpe?g|png|pdf)\b|amountCents|payerKey|counterpartId|\bledger\b|\bwaiting\b|\bwhy\b|\bdup\b|\bnumber\b|\bpayer\b|\bwhere\b/i;
  const dupDay = iso => { const [y, m, d] = iso.split('-').map(Number); return `${y} 年 ${m} 月 ${d} 日`; };
  // 打開收據確認題（不作答），讀出資料表、重複提示及按鈕
  async function openCard(inst, packId, qid, width = 1440) {
    await usePass(inst.BASE, chrome);
    await chrome.go(inst.BASE + '/#/ask/' + packId, width, 1500);
    await waitFor(() => chrome.ev(`!!document.querySelector('#money-confirm-${qid}')`), 15000);
    return await chrome.ev(`(()=>{const c=document.querySelector('#q-${qid}');if(!c)return null;const kv={};c.querySelectorAll('.money-receipt-kv dt').forEach(dt=>{kv[dt.innerText.trim()]=(dt.nextElementSibling&&dt.nextElementSibling.innerText||'').trim();});
      const n=c.querySelector('.note.warn'),bs=[...c.querySelectorAll('.money-receipt-actions button')];
      return {text:c.innerText,kv,note:n?n.innerText.trim():null,prevGrid:n?!!(n.previousElementSibling&&n.previousElementSibling.classList.contains('money-receipt-grid')):null,nextActions:n?!!(n.nextElementSibling&&n.nextElementSibling.classList.contains('money-receipt-actions')):null,
        rows:n?n.querySelectorAll('li').length:0,buttons:bs.map(b=>b.innerText.trim()),btnH:bs.map(b=>Math.round(b.getBoundingClientRect().height)),page:document.body.innerText,sw:document.documentElement.scrollWidth,iw:window.innerWidth};})()`);
  }
  const confirmedOf = async (inst, inputId) => { await sleep(1500); await idle(inst); await waitFor(async () => (await recordsOf(inst, inputId)).length, 30000); await sleep(1500); return await recordsOf(inst, inputId); };

  // 1. 支出的對方寫自己公司（月月鮮烘）
  const selfPay = instance('r-self-payer', PORT + 10, DATA => setMode({ DATA }, 'event:event-receipt-self-payer\n'));
  await start(selfPay);
  const sp = await tell(selfPay), spQ = moneyQsOf(selfPay, sp.id)[0];
  ok('RE-26 支出 payer 寫自己公司：確認題的對方改為「' + N.ui.mnyPayerUnknown + '」，事項末尾有一次（不重複）說明', !!spQ && spQ.money.payer === N.ui.mnyPayerUnknown && spQ.money.what.endsWith(PAYER_NOTE) && countOf(spQ.money.what, PAYER_NOTE) === 1, { status: sp.input && sp.input.status, money: spQ && spQ.money });
  if (spQ) {
    const c = await openCard(selfPay, spQ.packId, spQ.id) || {};
    ok('RE-27 確認題頁面：對方一欄顯示「' + N.ui.mnyPayerUnknown + '」，內容一欄末尾有一次說明', (c.kv?.[N.ui.mnyFieldWho] || '').startsWith(N.ui.mnyPayerUnknown) && (c.kv?.[N.ui.mnyFieldWhat] || '').endsWith(PAYER_NOTE) && countOf(c.kv?.[N.ui.mnyFieldWhat], PAYER_NOTE) === 1, c.kv);
    ok('RE-28 反例（收據）：沒有相近紀錄時，問題沒有 dup，頁面不顯示重複提示', !('dup' in spQ) && c.note === null && !String(c.text || '').includes(N.ui.mnyDupLead), { dup: spQ.dup, note: c.note });
    await answer(chrome, selfPay, spQ.packId, spQ.id, '');
    const recs = await confirmedOf(selfPay, sp.id);
    ok('RE-29 確認入帳後紀錄同樣：對方「' + N.ui.mnyPayerUnknown + '」，內容末尾說明只有一次', recs.length === 1 && recs[0].payer === N.ui.mnyPayerUnknown && recs[0].what.endsWith(PAYER_NOTE) && countOf(recs[0].what, PAYER_NOTE) === 1, recs.map(r => [r.payer, r.what]));
  }

  // 2. 退款單（貸記單）：確認入帳及修改後入帳兩條路
  const refund = instance('r-refund', PORT + 11, DATA => setMode({ DATA }, 'event:event-receipt-refund\n'));
  await start(refund);
  const rf1 = await tell(refund), rfQ1 = moneyQsOf(refund, rf1.id)[0];
  ok('RE-30 退款單：確認題 money.refund 為 true（方向 out、HK$300）', !!rfQ1 && rfQ1.money.refund === true && rfQ1.money.dir === 'out' && rfQ1.money.amountCents === 30000, rfQ1 && rfQ1.money);
  let rfRecs = [];
  if (rfQ1) {
    const c = await openCard(refund, rfQ1.packId, rfQ1.id) || {};
    ok('RE-31 退款確認題：資料表種類一欄顯示「' + N.ui.mnyRefundTag + '」', (c.kv?.[N.ui.mnyFieldDir] || '').includes(N.ui.mnyRefundTag), c.kv);
    await answer(chrome, refund, rfQ1.packId, rfQ1.id, '');
    rfRecs = rfRecs.concat(await confirmedOf(refund, rf1.id));
    setMode(refund, 'event:event-receipt-refund\n');
    const rf2 = await tell(refund, Buffer.concat([Buffer.from(JPEG, 'base64'), Buffer.from('r2')]).toString('base64')), rfQ2 = moneyQsOf(refund, rf2.id)[0];
    if (rfQ2) { await answer(chrome, refund, rfQ2.packId, rfQ2.id, 'shipping'); rfRecs = rfRecs.concat(await confirmedOf(refund, rf2.id)); }
  }
  ok('RE-32 退款入帳紀錄 refund: true（「確認入帳」及「修改後入帳」各一筆，後者類別改為 shipping）', rfRecs.length === 2 && rfRecs.every(r => r.refund === true && r.source === 'receipt') && rfRecs[1].category === 'shipping', rfRecs.map(r => [r.refund, r.category, r.amountCents]));
  {
    const live = (await allRecords(refund)).filter(r => r.status === 'confirmed');
    const mm = moneyLib.monthMetrics(live, '2026-11', 'HKD'), plainMm = moneyLib.monthMetrics(live.map(r => ({ ...r, refund: false })), '2026-11', 'HKD');
    ok('RE-33 業績計算按退款處理（money-lib sumDelta）：兩筆支出退款令本月支出為 −HK$600、淨額 +HK$600；當作普通支出則是 +HK$600', live.length === 2 && mm.expense === -60000 && mm.net === 60000 && plainMm.expense === 60000, { refund: [mm.expense, mm.net], plain: plainMm.expense, apiCur: (await api(refund.BASE, '/api/money')).j?.cur });
  }

  // 3. 月結單一張三項
  const stmt = instance('r-statement', PORT + 12, DATA => setMode({ DATA }, 'event:event-receipt-statement\n'));
  await start(stmt);
  const st = await tell(stmt), stQs = moneyQsOf(stmt, st.id);
  ok('RE-34 月結單一張三項：出三條入帳題，各自日期（11-03、11-04、11-05）及金額，不合併；彼此沒有重複提示', stQs.length === 3 && JSON.stringify(stQs.map(q => q.money.date).sort()) === '["2026-11-03","2026-11-04","2026-11-05"]' && JSON.stringify(stQs.map(q => q.money.amountCents).sort((a, b) => a - b)) === '[16000,18000,20000]' && stQs.every(q => !('dup' in q)), { status: st.input && st.input.status, qs: stQs.map(q => [q.money.date, q.money.amountCents, q.dup]) });

  // 4. 早於事件日期的 followUp：修正那次仍然一樣（兩行模式，修正工作亦用同一模式）
  const fpast = instance('r-followup-past', PORT + 13, DATA => setMode({ DATA }, 'event:event-followup-past\nevent-repair:event-followup-past\n'));
  await start(fpast);
  const fp = await tellText(fpast, '供應商要求在本月初跟進付款安排。');
  await idle(fpast);
  const fpIn = stateInput(fpast, fp.id);
  ok('RE-35 只有一項早於事件日期的跟進（修正後仍一樣）：寬鬆模式丟棄該項，事件不失敗（已處理、沒有確認題）', repairRan(fpast) && !fs.existsSync(path.join(fpast.DATA, 'fake-mode.txt')) && fpIn?.status === 'processed' && packsFor(fpast, fp.id).length === 0, { repair: repairRan(fpast), status: fpIn && fpIn.status, error: fpIn && (fpIn.error || fpIn.failReason), packs: packsFor(fpast, fp.id).length });
  // 同一事件另有入帳項目：重播（事件及修正工作原樣交回）＝真實 AI 收據 + 一項早於事件日期的跟進
  const fmix = instance('r-followup-mixed', PORT + 14, DATA => { const ev = readJSON(FIXTURE); ev.items.push({ kind: 'followUp', date: '2026-11-01', action: '跟進供應商付款安排', why: '文件列明要跟進付款安排。' }); fs.writeFileSync(path.join(DATA, 'replay-event.json'), JSON.stringify(ev, null, 2)); });
  await start(fmix);
  const fm = await tell(fmix), fmPacks = packsFor(fmix, fm.id), fmQs = fmPacks.flatMap(p => p.questions || []);
  ok('RE-36 同一事件另有入帳項目：只丟棄過期跟進，入帳題照常出（一條，HK$1,293.50），事件不失敗', repairRan(fmix) && fm.input?.status === 'awaitingFounder' && fmQs.filter(q => q.kind === 'money').length === 1 && fmQs.filter(q => q.kind === 'money')[0].money.amountCents === 129350 && !fmQs.some(q => /跟進供應商付款安排/.test(JSON.stringify(q))), { repair: repairRan(fmix), status: fm.input && fm.input.status, qs: fmQs.map(q => [q.kind, q.about]) });

  // 5. 重複提示（收據）：已入帳同號發票，再交付款證明（原型同一組資料）
  const dupR = instance('r-dup-receipt', PORT + 15, () => { });
  await start(dupR);
  const seedR = await api(dupR.BASE, '/api/money', { action: 'add', dir: 'out', amount: '4860', currency: 'HKD', date: '2026-10-20', payer: '綠山生豆貿易', counterpartId: '', category: 'goods', what: '生豆貨款 單據號碼 INV-2026-0187', files: [] });
  await waitFor(async () => (await allRecords(dupR)).length === 1, 15000);
  await idle(dupR);
  setMode(dupR, 'event:event-receipt-dup\n');
  const d1 = await tell(dupR), dQ1 = moneyQsOf(dupR, d1.id)[0];
  const dRow1 = dQ1 && Array.isArray(dQ1.dup) ? dQ1.dup[0] : null;
  ok('RE-37 已入帳同號發票（相隔 21 日）→ 確認題有 dup 一條：已入帳、原因單據號碼、日期 2026-10-20、對方、金額；q.money 沒有 dup；不回傳紀錄編號', seedR.code === 202 && !!dRow1 && dQ1.dup.length === 1 && dRow1.where === 'ledger' && dRow1.why === 'number' && dRow1.date === '2026-10-20' && dRow1.amountCents === 486000 && dRow1.payer === '綠山生豆貿易' && !('dup' in dQ1.money) && !/mn-\d{4}/.test(JSON.stringify(dQ1.dup)) && Object.keys(dRow1).every(k => ['date', 'amountCents', 'currency', 'payer', 'where', 'why', 'no', 'noShown'].includes(k)), { seed: seedR.code, dup: dQ1 && dQ1.dup });
  if (dQ1) {
    const c = await openCard(dupR, dQ1.packId, dQ1.id, 1440) || {};
    await chrome.shot(path.join(SHOTS, 'receipt-dup-1440.png'), '#q-' + dQ1.id);
    const n = c.note || '';
    ok('RE-38 頁面：提示在資料表與三個按鈕之間，以「重要：」開頭並有「' + N.ui.mnyDupLead + '」', c.prevGrid === true && c.nextActions === true && /^重要\s*[：:]/.test(n) && n.includes(N.ui.mnyDupLead), { note: n, prevGrid: c.prevGrid, nextActions: c.nextActions });
    ok('RE-39 相近紀錄一條，有完整日期（2026 年 10 月 20 日）、對方、金額、「' + N.ui.mnyDupWhereLedger + '」、原因；最後一句是收據提示', c.rows === 1 && n.includes(dupDay('2026-10-20')) && n.includes('綠山生豆貿易') && n.includes('HK$4,860.00') && n.includes(N.ui.mnyDupWhereLedger) && n.includes(N.ui.mnyDupWhyNumber.split('{no}')[0]) && n.endsWith(N.ui.mnyDupReceiptHint), n);
    ok('RE-40 原因內的單據號碼照單據寫法顯示（原型：單據號碼相同（INV-2026-0187））', n.includes(N.t('mnyDupWhyNumber', { no: 'INV-2026-0187' })), n);
    ok('RE-41 提示不出現紀錄編號、檔名或內部欄位名；整頁不出現紀錄編號', !FORBIDDEN.test(n) && !/mn-\d{4}-\d{2}-\d{2}-\d{6}/.test(c.page || ''), (n.match(FORBIDDEN) || [])[0] || '');
    ok('RE-42 三個按鈕不變（確認入帳、修改後入帳、不入帳）', JSON.stringify(c.buttons) === JSON.stringify([N.ui.mnyConfirm, N.ui.mnyConfirmEdit, N.ui.mnyReject]), c.buttons);
    const m = await openCard(dupR, dQ1.packId, dQ1.id, 390) || {};
    await chrome.shot(path.join(SHOTS, 'receipt-dup-390.png'), '#q-' + dQ1.id);
    ok('RE-43 手機 390：有提示，沒有橫向捲動，三個按鈕高度 ≥ 44', !!m.note && m.sw <= m.iw && m.btnH.length === 3 && m.btnH.every(h => h >= 44), { sw: m.sw, iw: m.iw, btnH: m.btnH });
    // 同一單據再交一次（另一份附件），第一題未答 → 第二題同時提示「等你確認」及「已入帳」
    setMode(dupR, 'event:event-receipt-dup\n');
    const d2 = await tell(dupR, Buffer.concat([Buffer.from(JPEG, 'base64'), Buffer.from('d2')]).toString('base64')), dQ2 = moneyQsOf(dupR, d2.id)[0];
    const c2 = dQ2 ? await openCard(dupR, dQ2.packId, dQ2.id, 1440) || {} : {};
    ok('RE-44 第一題未答時再交同號單據：第二題提示兩條，「' + N.ui.mnyDupWhereWaiting + '」（同日）在前、「' + N.ui.mnyDupWhereLedger + '」在後', !!dQ2 && (dQ2.dup || []).length === 2 && dQ2.dup[0].where === 'waiting' && dQ2.dup[1].where === 'ledger' && (c2.note || '').includes(N.ui.mnyDupWhereWaiting) && c2.rows === 2, { dup: dQ2 && dQ2.dup, note: c2.note });
    // 按「確認入帳」照樣入帳；帳本沒有 dup 欄
    await answer(chrome, dupR, dQ1.packId, dQ1.id, '');
    const recs = await confirmedOf(dupR, d1.id);
    const rawHasDup = [path.join(dupR.DATA, 'ledger', 'money.json'), ...(() => { const d = path.join(dupR.DATA, 'ledger', 'money', 'pending'); return fs.existsSync(d) ? fs.readdirSync(d).map(f => path.join(d, f)) : []; })()].some(f => fs.existsSync(f) && /"dup"\s*:/.test(fs.readFileSync(f, 'utf8')));
    ok('RE-45 有提示時按「確認入帳」照樣入帳一筆；帳本紀錄（含檔案）沒有 dup 欄', recs.length === 1 && recs[0].amountCents === 486000 && !('dup' in recs[0]) && !rawHasDup, { recs: recs.map(r => [r.amountCents, r.what]), rawHasDup });
  }

  // 6. 重複提示（記一筆）：業績報告頁表格及端點
  const quick = instance('r-dup-quick', PORT + 16, () => { });
  await start(quick);
  const seedQ = await api(quick.BASE, '/api/money', { action: 'add', dir: 'in', amount: '1280', currency: 'HKD', date: '2026-11-09', payer: 'Brew Lab 咖啡店', counterpartId: '', category: 'sales', what: '', files: [] });
  await waitFor(async () => (await allRecords(quick)).length === 1, 15000);
  await idle(quick); await sleep(1500);
  const MP = { pending: path.join(quick.DATA, 'ledger', 'money', 'pending'), evidence: path.join(quick.DATA, 'ledger', 'money', 'evidence'), ops: path.join(quick.DATA, 'ledger', 'founder-ops.json') };
  const walk = d => !fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)).map(x => e.name + '/' + x).concat(e.name + '/') : [e.name]);
  const snap = () => JSON.stringify({ pending: walk(MP.pending).sort(), evidence: walk(MP.evidence).sort(), ops: fs.existsSync(MP.ops) ? fs.readFileSync(MP.ops, 'utf8') : '' });
  const quickBody = extra => ({ action: 'add', dir: 'in', amount: '1280', currency: 'HKD', date: '2026-11-12', payer: 'Brew Lab 咖啡店', counterpartId: '', category: 'sales', what: '', files: [{ name: 'proof-api.jpg', data: JPEG }], ...extra });
  const before0 = snap();
  const apiDup = await api(quick.BASE, '/api/money', quickBody({}));
  await sleep(1200);
  ok('RE-46 「記一筆」端點：與現有紀錄相近（同一對方、同額、相隔 3 日）→ 400 { ok:false, error:"dup" }，dup 一條（已入帳、對方及金額）；附件、待處理紀錄及操作紀錄零寫入', seedQ.code === 202 && apiDup.code === 400 && apiDup.j?.ok === false && apiDup.j?.error === 'dup' && (apiDup.j?.dup || []).length === 1 && apiDup.j.dup[0].why === 'payer' && apiDup.j.dup[0].where === 'ledger' && snap() === before0 && (await allRecords(quick)).length === 1, { seed: seedQ.code, code: apiDup.code, j: apiDup.j, changed: snap() !== before0 });
  const apiOk = await api(quick.BASE, '/api/money', { action: 'add', dir: 'out', amount: '55', currency: 'HKD', date: '2026-11-12', payer: '文具店', counterpartId: '', category: 'tools', what: '', files: [] });
  ok('RE-47 反例（端點）：沒有相近紀錄時照舊一次寫入（202）', apiOk.code === 202 && apiOk.j?.ok === true, { code: apiOk.code, j: apiOk.j });
  await waitFor(async () => (await allRecords(quick)).length === 2, 15000); await idle(quick); await sleep(1000);

  const PROOF = path.join(OUT, 'proof-quick.jpg');
  fs.writeFileSync(PROOF, Buffer.from(JPEG, 'base64'));
  await usePass(quick.BASE, chrome);
  const RECORDER = `(()=>{if(window.__sent)return true;window.__sent=[];const f=window.fetch;window.fetch=function(u,o){try{if(o&&o.body&&/\\/api\\/money/.test(String(u))){const b=JSON.parse(o.body);window.__sent.push({action:b.action,allowDup:b.allowDup===true,files:(b.files||[]).length,amount:b.amount,payer:b.payer});}}catch(e){}return f.apply(this,arguments);};return true;})()`;
  async function openAdd(width) {
    await chrome.go(quick.BASE + '/dashboard/money', width, 1500);
    await waitFor(() => chrome.ev('!!document.querySelector("#mny-add-open")'), 15000);
    await chrome.ev(RECORDER);
    await chrome.click('#mny-add-open');
    return await waitFor(() => chrome.ev('!!document.querySelector("#mny-amount")'), 5000);
  }
  const setDate = value => chrome.ev(`(()=>{const e=document.querySelector('#mny-date');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`);
  async function attach(file) { const dom = await chrome.send('DOM.getDocument', { depth: -1 }); const node = await chrome.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#mny-files' }); if (node.nodeId) await chrome.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [file] }); await sleep(300); }
  async function fillAdd(amount, payer, date, file) { await chrome.type('#mny-amount', amount); await chrome.type('#mny-payer', payer); await setDate(date); if (file) await attach(file); }
  const quickState = () => chrome.ev(`(()=>{const n=document.querySelector('#mny-dup-hint'),acts=document.querySelector('.mny-dialog .mny-form > .mny-actions'),bs=acts?[...acts.querySelectorAll('button')]:[];
    return {note:n?n.innerText.trim():null,rows:n?n.querySelectorAll('li').length:0,nextActions:n?!!(n.nextElementSibling&&n.nextElementSibling.classList.contains('mny-actions')):null,afterMore:n?!!(n.previousElementSibling&&n.previousElementSibling.matches('details.mny-box')):null,
      buttons:bs.map(b=>b.innerText.trim()),btnH:bs.map(b=>Math.round(b.getBoundingClientRect().height)),submit:!!document.querySelector('#mny-add-submit'),submitDisabled:!!(document.querySelector('#mny-add-submit')||{}).disabled,hintNodes:document.querySelectorAll('#mny-dup-hint').length,force:!!document.querySelector('#mny-add-force'),
      files:(document.querySelector('#mny-files')||{files:[]}).files.length,active:(document.activeElement||{}).id||'',amount:(document.querySelector('#mny-amount')||{}).value,sw:document.documentElement.scrollWidth,iw:window.innerWidth,sent:window.__sent||[]};})()`);
  const waitHint = async on => await waitFor(async () => { const s = await quickState(); return (on ? !!s.note : !s.note) ? s : null; }, 10000) || await quickState();
  const INFO = [];

  // 手機 390：出提示、零寫入、改欄位後回復
  await openAdd(390);
  await fillAdd('1280', 'Brew Lab 咖啡店', '2026-11-12', PROOF);
  const before1 = snap();
  await chrome.click('#mny-add-submit');
  const k1 = await waitHint(true);
  await sleep(1000);
  const zero1 = snap() === before1;
  await chrome.shot(path.join(SHOTS, 'quick-dup-390.png'), '.mny-dialog');
  const qn = k1.note || '';
  ok('RE-48 「記一筆」頁面：送出相近一筆 → 按鈕上方顯示「重要：」提示（在「更多資料」之下）；伺服器零寫入', !!k1.note && k1.nextActions === true && k1.afterMore === true && /^重要\s*[：:]/.test(qn) && qn.includes(N.ui.mnyDupLead) && zero1 && (k1.sent[0] || {}).files === 1 && (k1.sent[0] || {}).allowDup === false, { zero: zero1, ...k1 });
  ok('RE-49 提示內容：完整日期（2026 年 11 月 9 日）、對方、金額、「' + N.ui.mnyDupWhereLedger + '」、原因（' + N.ui.mnyDupWhyPayer + '），最後一句「' + N.ui.mnyDupQuickHint + '」；沒有紀錄編號、檔名或欄位名', k1.rows === 1 && qn.includes(dupDay('2026-11-09')) && qn.includes('Brew Lab 咖啡店') && qn.includes('HK$1,280') && qn.includes(N.ui.mnyDupWhereLedger) && qn.includes(N.ui.mnyDupWhyPayer) && qn.endsWith(N.ui.mnyDupQuickHint) && !FORBIDDEN.test(qn), { note: qn, forbidden: (qn.match(FORBIDDEN) || [])[0] });
  ok('RE-50 按鈕換成「' + N.ui.mnyDupForce + '」及「' + N.ui.mnyBalanceCancel + '」，沒有「' + N.ui.mnyRecord + '」', JSON.stringify(k1.buttons) === JSON.stringify([N.ui.mnyDupForce, N.ui.mnyBalanceCancel]) && !k1.submit && k1.force, k1.buttons);
  ok('RE-51 手機 390：有提示時沒有橫向捲動，兩個按鈕（仍要入帳、取消）高度 ≥ 44', !!k1.note && k1.force && k1.sw <= k1.iw && k1.btnH.length === 2 && k1.btnH.every(h => h >= 44), { sw: k1.sw, iw: k1.iw, btnH: k1.btnH });
  // 改金額（真實按鍵輸入）→ 提示消失、按鈕回復「入帳」
  await chrome.ev(`(()=>{const e=document.querySelector('#mny-amount');e.focus();e.setSelectionRange(e.value.length,e.value.length);return true;})()`);
  await chrome.send('Input.insertText', { text: '0' }); await sleep(600);
  const k2 = await quickState();
  ok('RE-52 改金額後提示消失，按鈕回復「' + N.ui.mnyRecord + '」及「' + N.ui.mnyBalanceCancel + '」', !!k1.note && !k2.note && k2.submit && !k2.force && JSON.stringify(k2.buttons) === JSON.stringify([N.ui.mnyRecord, N.ui.mnyBalanceCancel]) && k2.amount === '12800', { note: k2.note, buttons: k2.buttons, amount: k2.amount });
  await chrome.send('Input.insertText', { text: '0' }); await sleep(400);
  const k3 = await quickState();
  INFO.push((k1.note ? '' : '（未能驗證：提示沒有出現）') + `觀察：提示消失後輸入焦點${k2.active === 'mny-amount' ? '仍在金額欄' : '離開金額欄（' + (k2.active || '沒有') + '）'}；再按一個鍵後金額為 ${k3.amount}（預期 128000）；已揀附件數目 ${k2.files}（提示前為 1）`);
  // 再出提示，改日期（change 事件）→ 提示消失
  await chrome.type('#mny-amount', '1280');
  await chrome.click('#mny-add-submit');
  const k4 = await waitHint(true);
  INFO.push((k1.note ? '' : '（未能驗證：提示沒有出現）') + `觀察：改金額再送出時附件數目 ${(k4.sent.at(-1) || {}).files}（第一次送出為 ${(k1.sent[0] || {}).files}）`);
  await setDate('2026-11-13'); await sleep(600);
  const k5 = await quickState();
  ok('RE-53 改日期（change 事件）後提示同樣消失、按鈕回復', !!k4.note && !k5.note && k5.submit && !k5.force, { again: !!k4.note, after: { note: k5.note, buttons: k5.buttons } });

  // 電腦 1440：出提示 → 「仍要入帳」以 allowDup 重送（附件一併）
  await openAdd(1440);
  await fillAdd('1280', 'Brew Lab 咖啡店', '2026-11-12', PROOF);
  await chrome.click('#mny-add-submit');
  const w1 = await waitHint(true);
  await chrome.shot(path.join(SHOTS, 'quick-dup-1440.png'), '.mny-dialog');
  const brewBefore = (await allRecords(quick)).filter(r => r.payer === 'Brew Lab 咖啡店' && r.status === 'confirmed').length;
  if (await chrome.ev('!!document.querySelector("#mny-add-force")')) await chrome.click('#mny-add-force');
  const forced = await waitFor(async () => { const list = (await allRecords(quick)).filter(r => r.payer === 'Brew Lab 咖啡店' && r.status === 'confirmed' && r.date === '2026-11-12'); return list.length ? list : null; }, 15000) || [];
  const fsent = (await chrome.ev('window.__sent||[]')).at(-1) || {};
  const ev0 = (forced[0] && forced[0].evidence || [])[0] || {};
  const evFile = forced[0] && ev0.file ? path.join(MP.evidence, forced[0].id, ev0.file) : '';
  ok('RE-54 按「' + N.ui.mnyDupForce + '」以 allowDup: true 重送同一內容並入帳，附件一併存入', !!w1.note && fsent.allowDup === true && fsent.files === 1 && forced.length === 1 && forced[0].amountCents === 128000 && ev0.store === 'money' && !!evFile && fs.existsSync(evFile), { hint: !!w1.note, before: brewBefore, sent: fsent, recs: forced.map(r => [r.date, r.amountCents, r.evidence]), evFile: evFile && fs.existsSync(evFile) });
  await sleep(1200);
  if (await chrome.ev('!!document.querySelector("#mny-add-open")')) await chrome.click('#mny-add-open');
  await waitFor(() => chrome.ev('!!document.querySelector("#mny-amount")'), 5000);
  const w2 = await quickState();
  ok('RE-55 入帳後再開「記一筆」：不殘留上一次的重複提示及「' + N.ui.mnyDupForce + '」', !!w1.note && forced.length === 1 && !w2.note && w2.submit && !w2.force, { note: w2.note, buttons: w2.buttons });
  // 反例（頁面）：沒有相近紀錄時直接入帳，不出提示
  await openAdd(1440);
  await fillAdd('777', '新客戶甲', '2026-11-12', '');
  await chrome.click('#mny-add-submit');
  const fresh = await waitFor(async () => (await allRecords(quick)).find(r => r.payer === '新客戶甲'), 15000);
  const w3 = await quickState();
  ok('RE-56 反例（記一筆頁面）：沒有相近紀錄時不顯示提示，直接入帳', !!fresh && !w3.note && !(w3.sent.at(-1) || {}).allowDup, { rec: fresh && fresh.amountCents, note: w3.note });
  for (const line of INFO) console.log('INFO ' + line);
  ok('RE-18 頁面沒有腳本錯誤', chrome.errors.length === 0, chrome.errors);
} catch (error) {
  ok('收據入帳測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  for (const s of servers) s.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
