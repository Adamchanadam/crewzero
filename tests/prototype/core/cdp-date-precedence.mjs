// 0.44.0 按日期逐項判斷（P 線）頁面測試：先用 run.mjs＋假 AI 重播造好帳本（不開伺服器），之後才在該資料夾開伺服器及無頭 Chrome 核對頁面。
// 依協調會話裁決（docs/evidence/journey-0440/dispatch/p-plan.md 最前一節）：依據行寫入 q.judge；新舊說法用現有 q.pair（#pair-<題號>，標籤 pair.oldLabel／nowLabel）；
// 「當日說法」是這件事的一項改動（回饋頁現有改動清單 #fb-changes），不核對 #fb-compare。
// 另含第 6 項（b）伺服器部分：/api/tell 不帶日期、會議紀錄交出時沒有會議日期，筆記機讀區要有 dateAssumed: true（流程測試不開伺服器，故放這裏）。
// 用法：node cdp-date-precedence.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>（使用 port 起 8 個埠：伺服器 +0、+2、+4、+6，Chrome +1）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO_ARG, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PROTO = path.resolve(PROTO_ARG), PORT = Number(PORT_TEXT);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = file => import(pathToFileURL(path.join(PROTO, file)).href);
const lib = await imp('ask-lib.mjs');
const minutes = await imp('minutes-lib.mjs');
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const U = N.ui, T = (key, values) => N.t(key, values);
const results = [], ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readJSON = file => { try { return read(file); } catch { return null; } };
const squash = s => String(s || '').replace(/\s+/g, '');
const waitFor = async (fn, ms = 20000, step = 300) => { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(step); } return null; };
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH)/i.test(key)));
let seq = 0;

freshTestOut(OUT);
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 造帳本（做法同 date-precedence-flow-test.mjs；只在伺服器啟動前使用） ---------- */
async function world(name) {
  const data = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name, 'data');
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, PROTO);
  const env = { ...childEnv, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
  shell('--type', 'rhythm', '--trigger', 'manual');
  for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(data, d))) fs.rmSync(path.join(data, d, f), { force: true }); } catch { } }
  await certifyDirect(data, PROTO, ADAPTER);
  const stateFile = path.join(data, 'ledger', 'state.json');
  const state = () => read(stateFile), save = value => fs.writeFileSync(stateFile, JSON.stringify(value, null, 2));
  const s = state();
  s.company = s.company || {}; s.company.actors = [{ id: 'pc-1', name: '陳經理', kind: 'partner', role: '採購' }];
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' }; save(s);
  process.env.SOS_DATA = data;
  return { data, DIR: lib.dataDirs(PROTO), shell, state, save };
}
let replaySeq = 0;
const replay = items => ({ summary: '測試重播第 ' + (++replaySeq) + ' 件。', grade: 'said', read: { summary: 'Zero 讀了創辦人原話及附件，對照了現有假設、日程及下一個對外動作。', highlights: [] }, contrasts: [], items });
function minuteBody(title, date, { facts = [], says = [], decide = [], todos = [] } = {}) {
  const or = rows => rows.length ? rows : ['- 沒有。'];
  return ['# 會議紀錄：' + title + '（' + date + '）', '> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 0 處）', '', '## 參加者', '', '創辦人、陳經理。', '',
    '## 已發生的事實', '', ...or(facts), '', '## 對方的說法及承諾', '', ...or(says), '', '## 雙方決定', '', ...or(decide), '', '## 待辦', '', ...or(todos), '', '## 未定事項', '', '- 仍待確認。', ''].join('\n');
}
function submit(W, ref, { date, said = '記錄一件事。', minute = null, meta = null, ev }) {
  fs.writeFileSync(path.join(W.data, 'replay-event.json'), JSON.stringify(ev, null, 2));
  const machine = { date, ...(meta ? { minutes: meta } : {}) };
  fs.mkdirSync(W.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-event.md`), `kind: note\ntype: event\nat: ${lib.localIso()}\n\n${said}\n\n\`\`\`json\n${JSON.stringify(machine)}\n\`\`\`\n`);
  if (minute) fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-event-file-1-會議紀錄.md`), minute);
  W.shell();
  const input = (W.state().inputs || []).find(x => x.id === 'in-' + ref) || null;
  const pack = input && input.packId ? readJSON(path.join(W.DIR.asks, input.packId + '.json')) : null;
  return { input, pack, accepted: !!(input && input.summary === ev.summary) };
}
function answer(W, pack) {
  const answers = pack.questions.map(q => ({ id: q.id, value: q.value, ai: q.value, changed: false }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: false', 'shownAt: ' + lib.localIso()];
  fs.mkdirSync(W.DIR.replies, { recursive: true });
  fs.writeFileSync(path.join(W.DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
  W.shell();
}
const qGrade = pack => ((pack && pack.questions) || []).find(q => (q.options || []).some(o => o.apply && o.apply.op === 'setAssumptionGrade')) || null;
const A = (id, grade, why, extra = {}) => ({ kind: 'assumption', id, grade, why, ...extra });

/* ---------- 伺服器 ---------- */
const servers = [];
async function serve(W, port) {
  const BASE = 'http://127.0.0.1:' + port;
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...childEnv, SOS_DATA: W.data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
  servers.push(srv);
  await waitFor(async () => (await fetch(BASE + '/api/health')).ok, 20000);
  await usePass(BASE);
  return { BASE, stop: () => srv.kill() };
}
const noteMachine = (W, inputId) => {
  const input = ((readJSON(path.join(W.data, 'ledger', 'state.json')) || {}).inputs || []).find(x => x.id === inputId);
  if (!input || !input.file) return null;
  let text = ''; try { text = fs.readFileSync(path.join(W.data, input.file), 'utf8'); } catch { return null; }
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  try { return blocks.length ? JSON.parse(blocks[blocks.length - 1][1]) : {}; } catch { return {}; }
};

let chrome;
try {
  /* 造帳本：第 1 項（較新）、第 2 項（較舊而不同）、第 4 項（同日）、第 6 項（b）用的空白公司 */
  const W1 = await world('newer');
  const e1 = submit(W1, 'R20261103-100000-dpc1-e1', { date: '2026-11-03', said: '陳經理表示對試用有興趣。', ev: replay([A('H1', 'said', '對方口頭表示有興趣。')]) });
  if (e1.pack) answer(W1, e1.pack);
  const e2 = submit(W1, 'R20261110-100000-dpc1-e2', { date: '2026-11-10', said: '陳經理已安排到工房試用。', ev: replay([A('H1', 'did', '對方已安排試用。')]) });
  const q1 = qGrade(e2.pack);

  const W2 = await world('older-different');
  const m1 = submit(W2, 'R20261105-100000-dpc2-m1', { date: '2026-11-05', said: '交出會議紀錄。', meta: { id: 'm-dpc2-m1', version: 1 },
    minute: minuteBody('首次合作', '2026 年 11 月 5 日', { facts: ['- 陳經理已到工房試飲並確認合作意向。'], says: ['- 陳經理要求先寄出試用樣本。'], todos: ['- 陳經理在 2026 年 11 月 25 日前提供報價。'] }),
    ev: replay([A('H1', 'did', '對方已到工房試飲並確認合作意向。', { sourceQuote: '陳經理已到工房試飲並確認合作意向' }),
      { kind: 'followUp', date: '2026-11-25', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 25 日前提供報價' },
      { kind: 'nextAction', text: '向陳經理寄出試用樣本', why: '會上定下先寄樣本。', sourceQuote: '陳經理要求先寄出試用樣本' }]) });
  if (m1.pack) answer(W2, m1.pack);
  const t1 = (W2.state().tasks || []).find(t => t && t.dueAt === '2026-11-25' && t.minutesSource && t.minutesSource.id === 'm-dpc2-m1');
  const m2 = submit(W2, 'R20261020-100000-dpc2-m2', { date: '2026-10-20', said: '補交舊會議紀錄。', meta: { id: 'm-dpc2-m2', version: 1 },
    minute: minuteBody('初次見面', '2026 年 10 月 20 日', { says: ['- 陳經理表示有興趣合作。', '- 陳經理在 2026 年 11 月 18 日前提供報價。'], decide: ['- 雙方同意先再約見面一次。'] }),
    ev: replay([A('H1', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' }),
      { kind: 'followUp', date: '2026-11-18', action: '陳經理提供報價', why: '會議紀錄寫明須在該日前提供報價。', sourceQuote: '陳經理在 2026 年 11 月 18 日前提供報價', sameAsTask: t1 ? t1.id : 'missing' },
      { kind: 'nextAction', text: '先約陳經理再次見面', why: '會上同意再見面。', sourceQuote: '雙方同意先再約見面一次' }]) });

  const W4 = await world('same-day');
  const s4a = submit(W4, 'R20261110-100000-dpc4-a', { date: '2026-11-10', said: '交出會議紀錄（甲）。', meta: { id: 'm-dpc4-a', version: 1 }, minute: minuteBody('上午會議', '2026 年 11 月 10 日', { says: ['- 陳經理表示有興趣合作。'] }),
    ev: replay([A('H1', 'said', '對方口頭表示有興趣。', { sourceQuote: '陳經理表示有興趣合作' })]) });
  if (s4a.pack) answer(W4, s4a.pack);
  const s4b = submit(W4, 'R20261110-100000-dpc4-b', { date: '2026-11-10', said: '交出會議紀錄（乙）。', meta: { id: 'm-dpc4-b', version: 1 }, minute: minuteBody('下午會議', '2026 年 11 月 10 日', { facts: ['- 陳經理已到工房試飲並落實試用。'] }),
    ev: replay([A('H1', 'did', '對方已落實試用。', { sourceQuote: '陳經理已到工房試飲並落實試用' })]) });
  const q4 = qGrade(s4b.pack);

  const WS = await world('server-assumed');
  // 會議紀錄已整理好而沒有會議日期：直接造 ready 登記檔（sources 留空，交出時只附會議紀錄本身）
  const mid = 'm-2026-11-12-100000-777', minuteText = minuteBody('日期待定的會議', '日期待定', { says: ['- 陳經理表示會盡快回覆。'] }), draftName = '日期待定的會議（草稿）.md';
  fs.mkdirSync(minutes.sourceDir(WS.DIR, mid), { recursive: true });   // 正常由預檢保留編號時建立；交出時寫 v1.md 到這裏
  minutes.createMinutes(WS.DIR, { id: mid, state: 'speakers', title: '日期待定的會議', meetingDate: '', sources: [], labels: [], suggest: { state: 'done', items: {} }, speakers: {}, version: 1, versions: [], inputId: '', error: '' });
  minutes.patchMinutes(WS.DIR, mid, { state: 'drafting', title: '日期待定的會議', meetingDate: '' }, { who: 'server', from: 'speakers' });
  const draftDir = minutes.minutesDir(PROTO, WS.DIR); fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(path.join(draftDir, draftName), minuteText, 'utf8');
  minutes.patchMinutes(WS.DIR, mid, { state: 'ready', file: draftName, hash: minutes.sha256(minuteText) }, { who: 'shell', from: 'drafting' });

  ok('DPC-1 場景：四個帳本已造好（第 1 項有待答題、第 2 項 M1 已確認而 M2 重播被接受、第 4 項乙有題、第 6 項（b）會議紀錄為可交出狀態）',
    e1.accepted && e2.accepted && !!q1 && m1.accepted && !!t1 && m2.accepted && s4a.accepted && s4b.accepted && !!q4 && (minutes.readMinutes(WS.DIR, mid) || {}).state === 'ready',
    { e1: e1.accepted, e2: e2.accepted, q1: !!q1, m1: m1.accepted, t1: !!t1, m2: m2.accepted, s4b: s4b.accepted, q4: !!q4, minutes: (minutes.readMinutes(WS.DIR, mid) || {}).state });

  chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);

  /* ---------- 第 1 項：較新題的依據行及新舊說法並列 ---------- */
  const S1 = await serve(W1, PORT);
  await usePass(S1.BASE, chrome);
  await chrome.go(S1.BASE + '/#/ask/' + (e2.input && e2.input.packId), 1440);
  const card1 = q1 && await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#q-${q1.id}');if(!c)return null;const p=document.querySelector('#pair-${q1.id}');return {why:[...c.querySelectorAll('.why')].map(x=>x.innerText),pair:p?p.innerText:''};})()`), 15000);
  const basis1 = T('dpBasisNewer', { d: '11 月 10 日', src: U.dpSrcEvent, c: '11 月 3 日' });
  ok('DPC-2 第 1 項：題目卡出現（場景）', !!card1, card1);
  ok('DPC-3 第 1 項：題目卡的說明（q.judge）顯示依據行「' + basis1 + '」', !!card1 && card1.why.some(t => squash(t).includes(squash(basis1))), card1 && card1.why);
  ok('DPC-4 第 1 項：#pair 並列框顯示「現有紀錄（11 月 3 日）」及「11 月 10 日的事件紀錄」', !!card1 && squash(card1.pair).includes(squash(T('dpPairOldDated', { c: '11 月 3 日' }))) && squash(card1.pair).includes(squash(T('dpPairNow', { d: '11 月 10 日', src: U.dpSrcEvent }))), card1 && card1.pair);
  if (card1) await chrome.shot(path.join(OUT, 'newer-question-1440.png'), '#q-' + q1.id);
  S1.stop();

  /* ---------- 第 2 項：回饋頁改動清單顯示當日說法 ---------- */
  const S2 = await serve(W2, PORT + 2);
  await usePass(S2.BASE, chrome);
  await chrome.go(S2.BASE + '/#/feedback/' + (m2.input && m2.input.id), 1440);
  const fb2 = await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#fb-card');if(!c)return null;const ch=document.querySelector('#fb-changes');return {card:c.innerText,changes:ch?[...ch.querySelectorAll('li')].map(x=>x.innerText):[]};})()`), 15000);
  ok('DPC-5 第 2 項：回饋頁出現（場景）', !!fb2, fb2);
  const older = fb2 ? fb2.changes.filter(t => squash(t).includes(squash('10 月 20 日' + U.dpWhereMeeting)) && squash(t).includes(squash('11 月 5 日'))) : [];
  ok('DPC-6 第 2 項：回饋頁改動清單有三項當日說法（含「10 月 20 日會上」及「11 月 5 日」）', older.length === 3, fb2 && fb2.changes);
  ok('DPC-7 第 2 項：回饋頁不顯示「沒有影響」', !!fb2 && !fb2.card.includes('沒有影響') && older.length > 0, fb2 && fb2.card.slice(0, 600));
  if (fb2) await chrome.shot(path.join(OUT, 'older-feedback-1440.png'), '#fb-card');
  S2.stop();

  /* ---------- 第 4 項：同日題沒有預選、沒有「AI 建議」標記 ---------- */
  const S4 = await serve(W4, PORT + 4);
  await usePass(S4.BASE, chrome);
  await chrome.go(S4.BASE + '/#/ask/' + (s4b.input && s4b.input.packId), 1440);
  const card4 = q4 && await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#q-${q4.id}');if(!c)return null;const p=document.querySelector('#pair-${q4.id}');return {badges:c.querySelectorAll('.badge-ai').length,cur:c.querySelectorAll('.opt.cur,[aria-pressed="true"]').length,why:[...c.querySelectorAll('.why')].map(x=>x.innerText),pair:p?p.innerText:'',text:c.innerText};})()`), 15000);
  ok('DPC-8 第 4 項：同日題卡出現（場景）', !!card4, card4);
  ok('DPC-9 第 4 項：同日題沒有「' + U.aiRec + '」標記', !!card4 && card4.badges === 0 && !card4.text.includes(U.aiRec), card4 && { badges: card4.badges });
  ok('DPC-10 第 4 項：同日題沒有預選', !!card4 && card4.cur === 0, card4 && { cur: card4.cur });
  const basis4 = T('dpBasisSameDay', { d: '11 月 10 日', src: U.dpSrcMeeting, c: '11 月 10 日' });
  ok('DPC-11 第 4 項：同日題說明顯示「' + basis4 + '」，並排框列出兩個說法', !!card4 && card4.why.some(t => squash(t).includes(squash(basis4))) && squash(card4.pair).includes(squash(T('dpPairOldDated', { c: '11 月 10 日' }))) && squash(card4.pair).includes(squash(T('dpPairNow', { d: '11 月 10 日', src: U.dpSrcMeeting }))), card4 && { why: card4.why, pair: card4.pair });
  if (card4) await chrome.shot(path.join(OUT, 'same-day-question-1440.png'), '#q-' + q4.id);
  S4.stop();

  /* ---------- 第 6 項（b）：伺服器寫入的筆記機讀區 ---------- */
  const SS = await serve(WS, PORT + 6);
  const tell = await fetch(SS.BASE + '/api/tell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'event', text: '陳經理今日來電，表示會盡快回覆報價。' }) });
  const tellJson = await tell.json().catch(() => ({}));
  const tellMachine = tellJson && tellJson.id ? await waitFor(() => noteMachine(WS, 'in-' + tellJson.id), 30000) : null;
  ok('DPC-12 第 6 項（b）場景：/api/tell 不帶日期被接受並登記', tell.status === 202 && !!tellMachine, { status: tell.status, body: tellJson, machine: tellMachine });
  ok('DPC-13 第 6 項（b）：/api/tell 不帶日期，筆記機讀區有 dateAssumed: true', !!tellMachine && tellMachine.dateAssumed === true, tellMachine);
  await waitFor(async () => { const d = await (await fetch(SS.BASE + '/api/dashboard')).json(); return d && d.ai && !d.ai.busy; }, 60000, 500);
  const sub = await fetch(SS.BASE + '/api/minutes', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SS.BASE }, body: JSON.stringify({ action: 'submit', id: mid, hash: minutes.sha256(minuteText), acceptMarks: true }) });
  const subJson = await sub.json().catch(() => ({}));
  const subMachine = subJson && subJson.inputId ? await waitFor(() => noteMachine(WS, subJson.inputId), 30000) : null;
  ok('DPC-14 第 6 項（b）場景：沒有會議日期的會議紀錄交出被接受並登記', sub.status === 202 && !!subMachine, { status: sub.status, body: subJson, machine: subMachine });
  ok('DPC-15 第 6 項（b）：會議紀錄交出（rec.meetingDate 空），筆記機讀區有 dateAssumed: true', !!subMachine && subMachine.dateAssumed === true, subMachine);
  SS.stop();

  ok('DPC-16 頁面沒有腳本錯誤', chrome.errors.length === 0, chrome.errors);
} catch (error) {
  ok('DPC-X 測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  for (const s of servers) s.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info ?? '')).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
