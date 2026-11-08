// 0.41.0 Zero 崗位題目畫面：確認崗位（R1）、啟用任務驗收（R3）、加站及加崗位同包（R6）、校對頁更正連結帶來源編號。
// 題目包全部是測試內手造的資料（放在測試自己的資料夾），不依賴出題的外殼。
// 用法：node roles-ask-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <起始埠>
// 截圖：環境變數 ROLES_ASK_SHOTS 指定資料夾時，另存 1440 及 390 寬的 R1、R3、R6 全頁截圖。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certify, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT, DATA = path.join(OUT, 'data');
const SHOTS = process.env.ROLES_ASK_SHOTS || '';
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const waitFor = async (fn, ms = 10000) => { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(200); } return null; };
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore', windowsHide: true });

/* ---------- 手造題目包（形狀照實作約定第 3 節） ---------- */
const U = N.ui;
const NOW = new Date().toISOString();
const card = (id, title, kind, mission, stations, supports, askFirst, activation) => ({ id, title, avatarKind: kind, mission, stations, supports, askFirst, activation });
const roleQ = (id, rc, why, priority) => ({ id, priority, about: rc.id, ask: '這個崗位由 Zero 承擔？', judge: '驗收通過才正式接手。', kind: 'choice', effect: 'now', risk: '確認後崗位開始做啟用任務。',
  options: [{ text: U.role_optAccept, rec: true }, { text: U.role_optRename, input: true }, { text: U.role_optDecline }], value: U.role_optAccept, why, inputHint: '輸入新的稱號，例如「餐廳拓展經理」', roleCard: rc });
const C1 = card('tm-a', '農場採購專員', 'procurement', '把農場供貨的資料備齊，令會面可以即場簽約。', ['三個農場簽供應協議', '先以兩個農場供貨試做兩週'], ['李家欣（共同創辦人・採購）'], ['聯絡任何農場', '答應任何收購價或供應條件'], '農場丙簽約前資料包');
const C2 = card('tm-b', '餐廳拓展經理', 'outreach', '跟進每間餐廳的進展和下一步。', ['五間餐廳完成試單並給回饋', '首條每週送貨路線'], ['你', '陳小明（兼職・配送）'], ['聯絡任何餐廳', '向餐廳送出任何文件'], '甲餐廳試單後的跟進訊息草稿');
const C3 = card('tm-c', '牌照及保險主任', 'compliance', '整理牌照要求，令你致電發牌機關前有清單。', ['牌照與保險到位'], ['黃師傅（外判・牌照代辦，暫停中）；暫停期間支援你'], ['向任何機關提交申請或資料'], '牌照要求查詢清單');
const PACK_R1 = { format: 'startup-os.ask/0.1', id: 'ask-roles-r1', title: U.role_confirmTitle, context: '公司概覽已確認，Zero 按路線各站擬了三個崗位。', afterConfirm: '確認後，Zero 下次開工先做三件啟用任務。', next: null, askedBy: 'Zero', askedAt: NOW, todoType: 'decision', rolesSync: { key: 'k1' }, followAll: true,
  questions: [roleQ('r1', C1, '農場簽約是目前進行中的站。', 1), roleQ('r2', C2, '四個站都對準餐廳。', 2), roleQ('r3', C3, '這一站正等候牌照批出。', 3)] };
const DRAFT = '草稿，未發送\n\n陳經理，您好。感謝上星期讓我們試送一週當季蔬菜。想請教三件事：哪幾款菜式最合用、份量是否合適、送貨時間有沒有要調整。\n\n依據：\n1. 你在 11 月 7 日記下：甲餐廳陳經理答應下星期試單。';
const accQ = (extra = {}) => ({ id: 'accept', priority: 1, about: 'tm-b', ask: T('role_activationAsk', { t: '「餐廳拓展經理」' }), judge: '接受即啟用，此崗位開始接手四個餐廳站。', kind: 'choice', effect: 'now', risk: '接受後崗位開始接手。', options: [{ text: '接受' }, { text: U.role_optReturn }, { text: U.role_optAcceptRedirect }], value: '接受', why: '草稿只問回饋，不承諾任何條件。',
  acceptance: { taskId: 't7', teammateId: 'tm-b', roleTitle: '餐廳拓展經理', avatarKind: 'outreach', artifactTitle: '甲餐廳試單後的跟進訊息草稿', artifactFile: 'work/r1/out/draft.md', qaVerdict: 'pass', qaLine: '訊息沒有承諾價錢或送貨日期；提到的陳經理與試單日期與名單及紀錄一致。', activation: true, ...extra } });
function T(k, v) { return N.t(k, v); }
const PACK_R3 = { format: 'startup-os.ask/0.1', id: 'ask-roles-r3', title: '驗收啟用任務', context: '餐廳拓展經理交了啟用任務。', afterConfirm: '接受即啟用；退回 Zero 會按原因再改。', next: null, askedBy: 'Zero', askedAt: NOW, todoType: 'acceptance',
  acceptance: { taskId: 't7', artifact: { title: '甲餐廳試單後的跟進訊息草稿', text: DRAFT } },
  questions: [accQ({ artifact: { title: '甲餐廳試單後的跟進訊息草稿', text: DRAFT } })] };
const PACK_R3_NOTEXT = { ...PACK_R3, id: 'ask-roles-r3b', acceptance: { taskId: 't7', artifact: null }, questions: [accQ()] };
const C4 = card('tm-d', '市場推廣及媒體主任', 'marketing', '為首次媒體報道一站服務。', ['首次媒體報道刊出'], ['你'], ['聯絡任何媒體或記者', '向外發布任何文字或圖片'], '三家本地飲食媒體的報道角度比較及一頁新聞稿草稿');
const stationQ = { id: 's1', priority: 1, about: 'station', ask: T('role_addStationAsk', { s: '首次媒體報道刊出' }), judge: '事件：一家飲食或本地媒體刊出關於公司的報道。真實證據：刊出報道的連結或剪報，由你記下並確認。', kind: 'choice', effect: 'now', risk: '加站會改變業務路徑。', options: [{ text: '加這一站', rec: true }, { text: '不加站（下一題的崗位亦不會加入）' }], value: '加這一站', why: '路線沒有一站以媒體報道為成果。' };
const roleQ2 = { ...roleQ('s2', C4, '崗位跟站走：不加站就不加崗位。', 2), ask: T('role_addRoleAsk', { t: '市場推廣及媒體主任' }), options: [{ text: '加這個崗位，先做啟用任務', rec: true }, { text: '加這個崗位，但改名', input: true }, { text: '不加崗位（這一站由 Zero 統籌照舊處理）' }], value: '加這個崗位，先做啟用任務' };
const PACK_R6 = { format: 'startup-os.ask/0.1', id: 'ask-roles-r6', title: '確認想改計劃', context: '你想加一個市場推廣及媒體崗位。', afterConfirm: '', next: null, askedBy: 'Zero', askedAt: NOW, todoType: 'decision', questions: [stationQ, roleQ2] };

let c;
try {
  await usePass(BASE); await certify(BASE);
  seedCompany(DATA, PROTO);
  fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'asks'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'ledger', 'confirmed.json'), JSON.stringify({ confirmedAt: NOW }));
  fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify({ company: { name: '測試公司', initials: '測試' }, tasks: [], milestones: [] }));
  for (const p of [PACK_R1, PACK_R3, PACK_R3_NOTEXT, PACK_R6]) fs.writeFileSync(path.join(DATA, 'asks', p.id + '.json'), JSON.stringify(p, null, 2));
  c = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1); await usePass(BASE, c);
  const q1 = (sel) => c.ev(sel);
  const shot = async (name, w) => { if (SHOTS) await c.shot(path.join(SHOTS, name + '-' + w + '.png'), null, { full: true }); };
  const open = async (id, w = 1440) => { await c.go(BASE + '/#/', w, 900); await c.go(BASE + '/#/ask/' + id, w, 1200); await waitFor(() => c.ev(`!!document.querySelector('.dq')`)); };
  // 攔截送出：不真的交給外殼，只記下送出的內容
  const capture = () => c.ev(`(()=>{ window.__posts=[]; const rf=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf('/api/submit')>=0){ window.__posts.push(JSON.parse(o.body)); return Promise.resolve(new Response(JSON.stringify({ok:true,file:'x.md',receivedAt:new Date().toISOString()}),{status:200,headers:{'Content-Type':'application/json'}})); } return rf.apply(this,arguments); }; return true; })()`);
  const machine = async () => { const posts = await c.ev(`window.__posts`); const t = posts.length ? posts[posts.length - 1].text : ''; const m = /```json\n([\s\S]*?)\n```/.exec(t); return m ? JSON.parse(m[1]) : null; };
  const texts = sel => c.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>e.innerText.trim())`);
  const hygiene = async () => {
    const t = await c.ev(`document.querySelector('#app').innerText`);
    return t.split('\n').flatMap(l => N.styleIssues(l)).filter(h => ['jargon', 'code', 'date', 'section'].includes(h.kind));
  };

  /* ===== R1：確認崗位 ===== */
  await open('ask-roles-r1');
  ok('R1 三題三張崗位卡，各有稱號', (await texts('.dq .rolecard .rc-name')).join('|') === '農場採購專員|餐廳拓展經理|牌照及保險主任', await texts('.dq .rolecard .rc-name'));
  const rows = await c.ev(`[...document.querySelectorAll('.dq')].map(q=>({opts:q.querySelectorAll('.opt').length,cur:[...q.querySelectorAll('.opt.cur')].map(o=>o.innerText.replace(/\\s+/g,' ').trim()),labels:[...q.querySelectorAll('.rolecard dt')].map(d=>d.innerText)}))`);
  ok('R1 每題三個選項，預選「由 Zero 承擔」並標 Zero 建議', rows.length === 3 && rows.every(r => r.opts === 3 && r.cur.length === 1 && r.cur[0].startsWith(U.role_optAccept) && r.cur[0].includes(U.aiRec.replace(/^★ /, ''))), rows);
  ok('R1 卡內有負責的站、支援的人、必須先問你、啟用任務四欄', rows.every(r => r.labels.join('|') === [N.dash.ppl_stations, U.role_cardSupports, U.role_cardAskFirst, U.role_cardActivation].join('|')), rows[0]);
  const texts1 = await texts('.dq .rolecard dd');
  ok('R1 卡內內容照 roleCard 顯示（站、支援、必須先問、啟用任務、使命）', texts1[0].includes('三個農場簽供應協議；先以兩個農場供貨試做兩週') && texts1[1].includes('李家欣（共同創辦人・採購）') && texts1[2].includes('聯絡任何農場；答應任何收購價或供應條件') && texts1[3].includes('農場丙簽約前資料包') && (await texts('.rc-mission'))[0].includes('資料備齊'), texts1.slice(0, 4));
  ok('R1 頭像載入（assets/crew-role-<類別>.webp）', await c.ev(`[...document.querySelectorAll('.dq .rc-av')].map(i=>i.getAttribute('src')+':'+(i.naturalWidth>0)).join('|')`) === '/assets/crew-role-procurement.webp:true|/assets/crew-role-outreach.webp:true|/assets/crew-role-compliance.webp:true', await c.ev(`[...document.querySelectorAll('.dq .rc-av')].map(i=>i.getAttribute('src')+':'+i.naturalWidth).join('|')`));
  ok('R1 頂部有「照 Zero 建議，全部確認」鍵（鍵 role_confirmAll）', (await texts('#follow-all'))[0] === U.role_confirmAll && U.role_confirmAll === '照 Zero 建議，全部確認', await texts('#follow-all'));
  ok('R1 首屏最多 3 項要決定的題', await c.ev(`[...document.querySelectorAll('.dq')].filter(q=>q.getBoundingClientRect().top<innerHeight).length`) <= 3, null);
  ok('R1 畫面沒有內部編號、短日期、內部用語', (await hygiene()).length === 0, await hygiene());
  ok('R1 沒有「自訂答案…」鍵（改名選項已負責）', !(await c.ev(`[...document.querySelectorAll('.dq .btn')].some(b=>b.innerText.trim()===${JSON.stringify(U.custom)})`)), null);
  await shot('R1-confirm-roles', 1440);

  // 全部照建議
  await capture();
  await c.click('#follow-all');
  const preview = await waitFor(() => c.ev(`!!document.querySelector('#do-confirm')`));
  ok('R1 全部確認：直接開預覽，不用逐題作答', !!preview, null);
  await c.click('#do-confirm');
  const m1 = await waitFor(machine);
  ok('R1 全部確認：三題答案都是建議答案「由 Zero 承擔」，送出內容未被改過', m1 && m1.answers.length === 3 && m1.answers.every(a => a.value === U.role_optAccept && a.changed === false), m1);

  // 改名：打開文字框、輸入、作為答案值送出
  await open('ask-roles-r1');
  await capture();
  await c.click('#q-r1 .opt:nth-of-type(2)');
  const ta = await waitFor(() => c.ev(`!!document.querySelector('#q-r1 textarea')`));
  ok('R1 選「改名」打開文字框，提示用 inputHint', !!ta && (await c.ev(`document.querySelector('#q-r1 textarea').placeholder`)) === '輸入新的稱號，例如「餐廳拓展經理」', await c.ev(`document.querySelector('#q-r1 textarea')?.placeholder`));
  ok('R1 選了「改名」該題已作答（值先記為「改名」，沒填也算改名）', await c.ev(`document.querySelector('#q-r1').classList.contains('done') && document.querySelectorAll('#q-r1 .opt.cur').length===1 && document.querySelector('#q-r1 .opt.cur').innerText.includes(${JSON.stringify(U.role_optRename)})`), null);
  await c.type('#q-r1 textarea', '農場供應專員');
  await c.click('#q-r1 .foot .btn.primary');
  ok('R1 填寫後「改名」選項保持選中，顯示自訂答案', await c.ev(`document.querySelector('#q-r1 .opt.cur')?.innerText.includes(${JSON.stringify(U.role_optRename)}) && document.querySelector('#q-r1 .custom')?.innerText.includes('農場供應專員')`), await texts('#q-r1 .custom'));
  await c.click('#follow-all');
  await waitFor(() => c.ev(`!!document.querySelector('#do-confirm')`));
  await c.click('#do-confirm');
  const m2 = await waitFor(machine);
  const a2 = m2 && Object.fromEntries(m2.answers.map(a => [a.id, a]));
  ok('R1 改名：打字內容成為該題答案值；其餘兩題照建議；全部確認不覆蓋已改的題', a2 && a2.r1.value === '農場供應專員' && a2.r1.changed === true && a2.r2.value === U.role_optAccept && a2.r3.value === U.role_optAccept, m2);

  // 只選「改名」不填
  await open('ask-roles-r1');
  await capture();
  await c.click('#q-r2 .opt:nth-of-type(2)');
  await c.click('#follow-all'); await waitFor(() => c.ev(`!!document.querySelector('#do-confirm')`)); await c.click('#do-confirm');
  const m3 = await waitFor(machine);
  ok('R1 只選「改名」沒有填：答案值是「改名」二字（外殼當空處理）', m3 && m3.answers.find(a => a.id === 'r2').value === U.role_optRename, m3 && m3.answers.map(a => a.value));

  // 不要這個崗位 → 答案值
  await open('ask-roles-r1');
  await c.click('#q-r3 .opt:nth-of-type(3)');
  ok('R1 選「不要這個崗位」：選項切換、其餘題仍預選', await c.ev(`document.querySelector('#q-r3 .opt.cur').innerText.includes(${JSON.stringify(U.role_optDecline)}) && document.querySelector('#q-r1 .opt.cur').innerText.includes(${JSON.stringify(U.role_optAccept)})`), null);

  /* ===== R1 手機 ===== */
  await open('ask-roles-r1', 390);
  const mob = await c.ev(`(()=>{const hs=[...document.querySelectorAll('.dq .opt,.dq .btn,#follow-all,#go-main,.cbar .btn')].filter(e=>e.offsetParent).map(e=>({t:e.innerText.trim().slice(0,12),h:Math.round(e.getBoundingClientRect().height)}));return {small:hs.filter(x=>x.h<44),n:hs.length,over:document.documentElement.scrollWidth>innerWidth+1}})()`);
  ok('R1 手機：所有按鈕及選項高度 ≥ 44 像素，沒有橫向捲動', mob.n > 8 && mob.small.length === 0 && !mob.over, mob);
  ok('R1 手機：首屏最多 3 項要決定的題', await c.ev(`[...document.querySelectorAll('.dq')].filter(q=>q.getBoundingClientRect().top<innerHeight).length`) <= 3, null);
  ok('R1 手機：欄位改為直排（dt、dd 不並排）', await c.ev(`getComputedStyle(document.querySelector('dl.rc')).gridTemplateColumns.split(' ').length===1`), await c.ev(`getComputedStyle(document.querySelector('dl.rc')).gridTemplateColumns`));
  await shot('R1-confirm-roles', 390);

  /* ===== R3：驗收啟用任務 ===== */
  await open('ask-roles-r3');
  const dl = (await texts('.deliver'))[0] || '';
  ok('R3 顯示交付者及統籌校對（餐廳拓展經理交付 · 統籌已校對）', dl.includes('餐廳拓展經理交付 · 統籌已校對'), dl.slice(0, 80));
  ok('R3 顯示校對結果一句', dl.includes(U.role_qaResult + '：訊息沒有承諾價錢或送貨日期'), dl.slice(0, 200));
  ok('R3 顯示草稿全文，預設展開', dl.includes('草稿，未發送') && dl.includes('依據') && dl.includes('陳經理，您好') && await c.ev(`document.querySelector('.deliver details.art').open`), dl.slice(0, 300));
  ok('R3 三個選項，題內驗收不預選、不標 Zero 建議（要創辦人親自揀）', await c.ev(`document.querySelectorAll('.dq .opt').length===3 && document.querySelectorAll('.dq .opt.cur').length===0 && !document.querySelector('.dq .badge-ai')`) && (await texts('.dq .opt')).join('|') === ['接受', U.role_optReturn, U.role_optAcceptRedirect].join('|'), await texts('.dq .opt'));
  ok('R3 標題用 role_activationAsk', (await texts('.dq-q'))[0] === '接受即啟用「餐廳拓展經理」', await texts('.dq-q'));
  ok('R3 畫面沒有內部編號、短日期、內部用語（草稿內的完整日期除外）', (await hygiene()).length === 0, await hygiene());
  await shot('R3-activation-accept', 1440);
  await capture();
  await c.click('.dq .opt:nth-of-type(1)');
  ok('R3 揀「接受」後可確認', await c.ev(`!!document.querySelector('.dq.done')`), null);
  await c.click('#go-main'); await waitFor(() => c.ev(`!!document.querySelector('#do-confirm')`)); await c.click('#do-confirm');
  const m4 = await waitFor(machine);
  ok('R3 送出答案「接受」', m4 && m4.answers.find(a => a.id === 'accept').value === '接受', m4 && m4.answers);
  await open('ask-roles-r3');
  await c.click('.dq .opt:nth-of-type(2)'); await c.click('#go-main'); await waitFor(() => c.ev(`!!document.querySelector('#do-confirm')`));
  ok('R3 退回時預覽說明是交 Zero 處理（整包 acceptance 仍決定送出字句）', (await texts('#mt'))[0] === U.submit && (await texts('#do-confirm'))[0].includes(U.submit), await texts('#mt'));
  await open('ask-roles-r3b');
  ok('R3 沒有草稿全文時顯示讀不到的提示，不顯示空白或編號', (await texts('.deliver'))[0].includes(U.acceptanceMissing), (await texts('.deliver'))[0]);
  await open('ask-roles-r3', 390);
  const mob3 = await c.ev(`(()=>{const hs=[...document.querySelectorAll('.dq .opt,.dq .btn,#go-main,.cbar .btn')].filter(e=>e.offsetParent).map(e=>Math.round(e.getBoundingClientRect().height));return {n:hs.length,small:hs.filter(h=>h<44),over:document.documentElement.scrollWidth>innerWidth+1}})()`);
  ok('R3 手機：按鈕及選項 ≥ 44 像素，沒有橫向捲動', mob3.n >= 4 && mob3.small.length === 0 && !mob3.over, mob3);
  await shot('R3-activation-accept', 390);

  /* ===== R6：加站＋加崗位同包 ===== */
  await open('ask-roles-r6');
  const r6 = await c.ev(`[...document.querySelectorAll('.dq')].map(q=>({ask:q.querySelector('.dq-q').innerText,opts:q.querySelectorAll('.opt').length,card:!!q.querySelector('.rolecard'),cur:[...q.querySelectorAll('.opt.cur')].length}))`);
  ok('R6 兩題：加站題（無崗位卡）及加崗位題（有崗位卡）各自三個或兩個選項、各預選一項', r6.length === 2 && r6[0].card === false && r6[1].card === true && r6[0].opts === 2 && r6[1].opts === 3 && r6[0].cur === 1 && r6[1].cur === 1, r6);
  ok('R6 加崗位題的「改名」同樣打開文字框', await (async () => { await c.click('#q-s2 .opt:nth-of-type(2)'); return c.ev(`!!document.querySelector('#q-s2 textarea')`); })(), null);
  ok('R6 畫面沒有內部編號、短日期、內部用語', (await hygiene()).length === 0, await hygiene());
  await open('ask-roles-r6');
  await shot('R6-add-role', 1440);
  await open('ask-roles-r6', 390);
  const mob6 = await c.ev(`(()=>{const hs=[...document.querySelectorAll('.dq .opt,.dq .btn,#go-main,.cbar .btn')].filter(e=>e.offsetParent).map(e=>Math.round(e.getBoundingClientRect().height));return {n:hs.length,small:hs.filter(h=>h<44),over:document.documentElement.scrollWidth>innerWidth+1}})()`);
  ok('R6 手機：按鈕及選項 ≥ 44 像素，沒有橫向捲動', mob6.n >= 5 && mob6.small.length === 0 && !mob6.over, mob6);
  await shot('R6-add-role', 390);

  /* ===== 首頁：今日 Zero 交付（R7）及交付回饋卡（R4）。資料用 dash-lib.deliveriesView 的真實輸出，經頁面的 /api/dashboard 回應注入 ===== */
  {
    process.env.SOS_DATA = DATA;
    const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
    const pad = n => String(n).padStart(2, '0'), dayStr = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    const TODAY = dayStr(0), at = (day, hm) => day + 'T' + hm + ':00+08:00';
    const MS = { m1: '農場乙長期供應葉菜', m2: '五間餐廳完成試單並給回饋', m3: '牌照與保險到位' };
    const cards = [
      { id: 'tm-a', title: '農場採購專員', name: '農場採購專員', lifecycle: 'enabled', milestoneIds: ['m1'], avatarKind: 'procurement' },
      { id: 'tm-b', title: '餐廳拓展經理', name: '餐廳拓展經理', lifecycle: 'enabled', milestoneIds: ['m2'], avatarKind: 'outreach' },
      { id: 'tm-d', title: '牌照及保險主任', name: '牌照及保險主任', lifecycle: 'enabled', milestoneIds: ['m3'], avatarKind: 'compliance', pausedAuto: true, pausedOn: TODAY, pausedReason: '等候：牌照批出' }];
    const tasks = [
      { id: 'd1', title: '跟進訊息', milestoneId: 'm2', teammateId: 'tm-b', artifactTitle: '乙餐廳黃小姐的試單邀請訊息草稿', packId: 'ask-roles-r3' },
      { id: 'd2', title: '條款', milestoneId: 'm1', teammateId: 'tm-a', artifactTitle: '農場乙一年供應協議條款草案', packId: 'ask-roles-r3b' },
      { id: 'd3', title: '掃描', cadence: 'standing', artifactTitle: '本週商機掃描：區內農墟及餐飲活動' },
      { id: 'd4', title: '問題清單', milestoneId: 'm1', teammateId: 'tm-a', artifactTitle: '見農場丙前的問題清單' },
      { id: 'd5', title: '卡住的', milestoneId: 'm3', teammateId: 'tm-d' },
      { id: 'y1', title: '昨日', milestoneId: 'm1', teammateId: 'tm-a', packId: 'ask-y1' }, { id: 'w1', title: '前日', milestoneId: 'm1', teammateId: 'tm-a', packId: 'ask-w1' }];
    const runs = [
      { id: 'R-a', startedAt: at(TODAY, '08:00'), endedAt: at(TODAY, '09:30'), workDay: TODAY, state: 'ended', ending: 'artifact', aiStarted: true, stopReason: 'itemsCap', items: [
        { taskId: 'd1', teammateId: 'tm-b', ending: 'artifact', endedAt: at(TODAY, '08:20'), qa: { audience: 'external', verdict: 'pass', line: '訊息沒有承諾價錢或日期。' } },
        { taskId: 'd2', teammateId: 'tm-a', ending: 'artifact', endedAt: at(TODAY, '08:50'), qa: { audience: 'external', verdict: 'flagged', line: '每週供應量找不到來源。', issues: [{ where: '第三段', what: '每週供應量沒有來源', fix: '向李家欣核對' }] } },
        { taskId: 'd3', teammateId: '', ending: 'artifact', endedAt: at(TODAY, '09:00') },
        { taskId: 'd4', teammateId: 'tm-a', ending: 'artifact', endedAt: at(TODAY, '09:05') },
        { taskId: 'd5', teammateId: 'tm-d', ending: 'blocked', endedAt: at(TODAY, '09:10') }] },
      { id: 'R-y', startedAt: at(dayStr(-1), '21:00'), endedAt: at(dayStr(-1), '21:14'), state: 'ended', ending: 'artifact', artifacts: 1, aiStarted: true, taskIds: ['y1'], label: '昨日工作' },
      { id: 'R-w', startedAt: at(dayStr(-2), '20:00'), endedAt: at(dayStr(-2), '20:31'), state: 'ended', ending: 'artifact', artifacts: 1, aiStarted: true, taskIds: ['w1'], label: '前日工作' }];
    const rcOf = id => id === 'R-y' ? { teammateId: 'tm-a', qa: { audience: 'external', verdict: 'pass', line: '數字與名單核對無誤。' }, artifacts: [{ title: '農場丙簽約前資料包' }] }
      : id === 'R-w' ? { teammateId: 'tm-a', qa: { audience: 'external', verdict: 'flagged', line: '草案第三段找不到來源。', issues: [{ where: '第三段', what: '每週供應量沒有來源', fix: '向李家欣核對' }] }, artifacts: [{ title: '農場乙一年供應協議條款草案' }] } : null;
    const acc = (id, text) => ({ id, type: 'acceptance', text, href: '/#/ask/' + id });
    const todoCtx = [acc('ask-roles-r3', '這份訊息草稿可以採用？'), acc('ask-roles-r3b', '這份條款草案可以採用？'), acc('dv-x1', '甲餐廳的跟進訊息可以採用？'), acc('dv-x2', '丙農場的資料包可以採用？'), acc('dv-x3', '丁餐廳的報價說明可以採用？'), acc('dv-x4', '戊農場的供應表可以採用？'), acc('ask-y1', '這份資料包可以採用？'), acc('ask-w1', '這份條款草案可以採用？')];
    const company = { rhythm: { pace: 'sprint', sprintUntil: dayStr(5) } };
    const base = { teammates: cards, tasks, company };
    const pv = dash.paceView({ ...base, runs }, { today: TODAY, counts: null, tele: {}, unread: todoCtx.length });
    const DV_A = dash.deliveriesView({ ...base, runs }, { today: TODAY, msTitle: id => MS[id] || '', readReceipt: rcOf, todo: todoCtx, pace: pv, openTodo: todoCtx.length });
    const DV_B = dash.deliveriesView({ teammates: cards, tasks, company: {}, runs: runs.slice(1) }, { today: TODAY, msTitle: id => MS[id] || '', readReceipt: rcOf, todo: todoCtx.slice(6), pace: null, openTodo: 2 });
    ok('首頁資料：多件日（今日 5 件、衝刺、停止原因）及單件日（回饋卡）的 deliveries 形狀如預期', DV_A.today.multi && DV_A.today.count === 5 && DV_A.today.items.length === 4 && DV_A.today.pausedRoles.length === 1 && DV_A.recent.length === 2 && !DV_B.today.multi && DV_B.recent.length === 2, { a: DV_A.today.count, b: DV_B.recent.length });

    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__DV=${JSON.stringify(DV_A)}; (function(){const rf=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf('/api/dashboard')>=0){ return rf.apply(this,arguments).then(r=>r.json()).then(j=>{ j.deliveries=window.__DV; return new Response(JSON.stringify(j),{status:200,headers:{'Content-Type':'application/json'}}); }); } return rf.apply(this,arguments); };})();` });
    const home = async w => { await c.go(BASE + '/#/', w, 900); await c.send('Page.reload'); await sleep(1500); await waitFor(() => c.ev(`!!document.querySelector('#next-list')`), 15000); await waitFor(() => c.ev(`!!document.querySelector('#deliveries')`), 8000); };
    const dvPos = () => c.ev(`(()=>{const d=document.querySelector('#deliveries'),n=document.querySelector('#next-list'),vh=innerHeight;if(!d||!n)return null;const dr=d.getBoundingClientRect(),nr=n.getBoundingClientRect();return {dvTop:Math.round(dr.top),dvBottom:Math.round(dr.bottom),nextTop:Math.round(nr.top),nextBottom:Math.round(nr.bottom),vh,rowsInView:[...document.querySelectorAll('#next-list [data-todo]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().top<vh).length,askInView:[...document.querySelectorAll('#next-list a[href^="#/ask/"],#deliveries a[href^="#/ask/"]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().top<vh&&e.getBoundingClientRect().bottom>0).length,askList:[...document.querySelectorAll('a[href^="#/ask/"]')].filter(e=>e.offsetParent&&e.getBoundingClientRect().top<vh&&e.getBoundingClientRect().bottom>0).map(e=>e.getAttribute('href')+'@'+Math.round(e.getBoundingClientRect().top)),over:document.documentElement.scrollWidth>innerWidth+1}})()`);
    const hygieneDv = async () => (await c.ev(`document.querySelector('#deliveries').innerText`)).split('\n').flatMap(l => N.styleIssues(l)).filter(h => ['jargon', 'code', 'date', 'section'].includes(h.kind));

    // 1440：多件日
    await home(1440);
    const p0 = await dvPos();
    ok('首頁 1440：待決列已有 3 題時，今日交付預設收成一行摘要，首屏作答入口最多 3 個', p0 && (await c.ev(`document.querySelector('#dv-toggle').getAttribute('aria-expanded')`)) === 'false' && p0.askInView <= 3 && p0.rowsInView <= 3, p0);
    await c.click('#dv-toggle'); await waitFor(() => c.ev(`document.querySelectorAll('#deliveries .dv').length>0`));
    const tx = (await texts('#deliveries'))[0] || '';
    ok('首頁 1440：展開後標題「今日 Zero 交付」', tx.toUpperCase().includes(U.pace_deliveriesTitle.toUpperCase()), tx.slice(0, 80));
    const sm = (await texts('#dv-summary'))[0] || '';
    ok('首頁 1440：一行摘要有衝刺到期日、今日做了 N 件（上限）、用量、停止原因', sm.includes(T('pace_sprintUntil', { d: (+dayStr(5).slice(5, 7)) + ' 月 ' + (+dayStr(5).slice(8)) + ' 日' })) && sm.includes(T('dv_doneN', { n: 5, m: 10 })) && sm.includes(DV_A.today.usageLine) && sm.includes(T('dv_stopLabel', { r: DV_A.today.stopText })), sm);
    const outs = await c.ev(`[...document.querySelectorAll('#deliveries .dv-sub')].map(s=>({h:s.querySelector('.eyebrow').innerText,rows:[...s.querySelectorAll('.dv')].map(r=>r.innerText.replace(/\\s+/g,' ').trim())}))`);
    const outSec = outs.find(s => s.h.startsWith(U.dv_outputsTitle)), decSec = outs.find(s => s.h.startsWith(U.dv_decideTitle));
    ok('首頁 1440：今日產出 4 件，等你驗收的排前；顯示崗位、站、校對字句', outSec && outSec.rows.length === 4 && outSec.rows[0].includes('乙餐廳黃小姐的試單邀請訊息草稿') && outSec.rows[0].includes('餐廳拓展經理 · ' + MS.m2) && outSec.rows[0].includes(U.dv_tagProofread + ' · ' + U.dv_waitAccept) && outSec.rows[1].includes(T('dv_notesLong', { n: 1 }) + ' · ' + U.dv_waitAccept) && outSec.rows[2].includes(U.dv_standing) && outSec.rows[3].includes(U.dv_internal + ' · ' + U.dv_tagChecked), outSec);
    await waitFor(() => c.ev(`[...document.querySelectorAll('#deliveries .dv .rc-av')].every(i=>i.complete)`), 5000);
    const avs = await c.ev(`[...document.querySelectorAll('#deliveries .dv .rc-av')].map(i=>i.getAttribute('src')+':'+i.naturalWidth)`);
    ok('首頁 1440：產出頭像載入', avs.length === 4 && avs.every(s => !s.endsWith(':0')), avs);
    ok('首頁 1440：要你決定最多列 3 項，其餘寫「還有 N 題」，不重複首頁待決列已有的題', decSec && decSec.rows.length === 3 && !decSec.rows.some(r => r.includes('這份訊息草稿可以採用') || r.includes('這份條款草案可以採用？ ')) && tx.includes(T('dv_decideMore', { n: 3 })), { decSec, more: tx.includes(T('dv_decideMore', { n: 3 })) });
    ok('首頁 1440：自動暫停的崗位（沒有做的：…）', tx.includes(T('dv_pausedRoles', { t: '牌照及保險主任', w: '牌照批出' })), tx.slice(-300));
    const cardsTx = await texts('#deliveries .dv-card');
    ok('首頁 1440：R4 回饋卡兩張：〈崗位〉交付 · 統籌已校對：標題；校對一句；有要留意的卡列出處與建議', cardsTx.length === 2 && cardsTx[0].includes('農場採購專員交付 · 統籌已校對：農場丙簽約前資料包') && cardsTx[0].includes(U.role_qaResult + '：數字與名單核對無誤') && cardsTx[1].includes('農場採購專員交付 · 統籌校對後仍有 1 處要留意：農場乙一年供應協議條款草案') && cardsTx[1].includes('第三段：每週供應量沒有來源') && cardsTx[1].includes(T('dv_issueFix', { f: '向李家欣核對' })), cardsTx);
    ok('首頁 1440：回饋卡有作答入口（#/ask/<包>），並寫明幾時交付及所屬站', await c.ev(`[...document.querySelectorAll('#deliveries .dv-card')].map(d=>d.querySelector('a.btn')?.getAttribute('href')).join('|')`) === '#/ask/ask-y1|#/ask/ask-w1' && cardsTx[0].includes('交付') && cardsTx[0].includes(T('dv_forStation', { s: MS.m1 })), cardsTx[0]);
    ok('首頁 1440：沒有內部編號、短日期、內部用語', (await hygieneDv()).length === 0, await hygieneDv());
    const p1 = await dvPos();
    ok('首頁 1440：今日交付排在待決列之後（不推走題目），沒有橫向捲動', p1 && p1.dvTop >= p1.nextBottom - 2 && !p1.over, p1);
    await shot('home-deliveries', 1440);

    // 390：預設收成一行摘要，不推走待決題
    await home(390);
    const p2 = await dvPos();
    ok('首頁 390：今日交付預設收成一行摘要加展開鍵，待決列完整在上面', p2 && (await c.ev(`document.querySelector('#dv-toggle').getAttribute('aria-expanded')`)) === 'false' && (await c.ev(`document.querySelectorAll('#deliveries .dv, #deliveries .dv-card').length`)) === 0 && p2.dvTop >= p2.nextBottom - 2 && !p2.over, p2);
    ok('首頁 390：收起時的區塊不高於 200 像素，首屏要決定的作答入口最多 3 個', p2 && p2.dvBottom - p2.dvTop <= 200 && p2.askInView <= 3 && p2.rowsInView <= 3, p2);
    ok('首頁 390：展開鍵高度 ≥ 44 像素，一行摘要有內容', await c.ev(`document.querySelector('#dv-toggle').getBoundingClientRect().height>=44`) && (await texts('#dv-summary'))[0].includes(T('dv_doneN', { n: 5, m: 10 })), await texts('#dv-summary'));
    await shot('home-deliveries-collapsed', 390);
    await c.click('#dv-toggle');
    await waitFor(() => c.ev(`document.querySelectorAll('#deliveries .dv').length>0`));
    const mob = await c.ev(`(()=>{const hs=[...document.querySelectorAll('#deliveries .btn, #deliveries a.btn')].filter(e=>e.offsetParent).map(e=>({t:e.innerText.trim().slice(0,10),h:Math.round(e.getBoundingClientRect().height)}));return {n:hs.length,small:hs.filter(x=>x.h<44),over:document.documentElement.scrollWidth>innerWidth+1}})()`);
    ok('首頁 390：展開後內容出現，所有按鈕 ≥ 44 像素，沒有橫向捲動', mob.n >= 8 && mob.small.length === 0 && !mob.over && (await c.ev(`document.querySelector('#dv-toggle').getAttribute('aria-expanded')`)) === 'true', mob);
    ok('首頁 390：展開後沒有內部編號、短日期、內部用語', (await hygieneDv()).length === 0, await hygieneDv());
    await shot('home-deliveries-expanded', 390);

    // 單件日：只有回饋卡
    await c.ev(`window.__DV=${JSON.stringify(DV_B)}`);
    await c.go(BASE + '/#/log', 1440, 600); await c.go(BASE + '/#/', 1440, 1500);
    await waitFor(() => c.ev(`!!document.querySelector('#deliveries')`), 8000);
    const bx = (await texts('#deliveries'))[0] || '';
    ok('首頁單件日：標題「Zero 近期交付」，沒有今日產出一覽，只有回饋卡', bx.toUpperCase().includes(U.dv_recentTitle.toUpperCase()) && !bx.includes(U.pace_deliveriesTitle) && !bx.includes(U.dv_outputsTitle) && (await c.ev(`document.querySelectorAll('#deliveries .dv-card').length`)) === 2, bx.slice(0, 120));
    await shot('home-feedback-card', 1440);
    // 沒有任何交付：不顯示
    await c.ev(`window.__DV=${JSON.stringify({ recent: [], today: { multi: false } })}`);
    await c.go(BASE + '/#/log', 1440, 600); await c.go(BASE + '/#/', 1440, 1500);
    ok('首頁沒有交付：整塊不顯示', !(await c.ev(`!!document.querySelector('#deliveries')`)), null);
  }

  /* ===== 校對頁：更正連結帶來源編號 ===== */
  await c.go(BASE + '/proofread.html', 1440, 2500);
  await waitFor(() => c.ev(`!!document.querySelector('#rest-toggle')`), 15000);
  await c.click('#rest-toggle');
  await waitFor(() => c.ev(`!!document.querySelector('#layer3 .layer-toggle')`), 15000);
  if ((await c.ev(`document.querySelector('#layer3 .layer-toggle')?.getAttribute('aria-expanded')`)) === 'false') await c.click('#layer3 .layer-toggle');
  const hasFix = await waitFor(() => c.ev(`!!document.querySelector('[data-fix-link="0"]')`), 15000);
  if (hasFix) {
    await c.ev(`(()=>{ window.__src=[]; const rf=window.fetch; window.fetch=function(u,o){ if(String(u).indexOf('/api/source-url')>=0) window.__src.push(JSON.parse(o.body)); return rf.apply(this,arguments); }; })()`);
    await c.click('[data-fix-link="0"]');
    await c.type('#src-url-0', 'https://example.com/doc');
    await c.click('[data-save-link="0"]');
    const body = await waitFor(() => c.ev(`window.__src[0]||null`));
    ok('校對頁：更正連結送出來源 id 及標題', body && body.id === 'doc' && body.title === '生意構思' && body.n === 0 && body.url === 'https://example.com/doc', body);
  } else { await c.shot(path.join(SHOTS || OUT, 'pf-debug.png'), null, { full: true }); ok('校對頁：更正連結送出來源 id 及標題', false, '沒有找到來源清單的更正連結：' + JSON.stringify(await c.ev(`({l3:!!document.querySelector('#layer3'),exp:document.querySelector('#layer3 .layer-toggle')?.getAttribute('aria-expanded'),srcs:(document.querySelector('#srcs')||{}).innerHTML,srv:document.body.innerText.includes('離線')})`))); }

  ok('全部頁面沒有腳本錯誤', c.errors.length === 0, c.errors.slice(0, 3));
} catch (e) {
  ok('測試未中途出錯', false, String(e && e.stack || e).slice(0, 600));
} finally {
  try { c && c.close(); } catch { }
  try { server.kill(); } catch { }
}
console.log(JSON.stringify(results, null, 1));
const pass = results.filter(r => r.pass).length;
console.log(`${pass} / ${results.length}`);
process.exit(pass === results.length ? 0 : 1);
