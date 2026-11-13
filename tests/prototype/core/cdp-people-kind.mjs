// 0.44.0 K 線：名單「更正 → 改類別」加入「團隊成員」的端點及頁面測試。
// 依據：docs/evidence/journey-0440/dispatch/brief-k1.md；分析報告「回歸測試」第 7、8 項（docs/evidence/people-team-2026-11-12/fable-analysis.md）。
// 固定帳本配假 adapter；伺服器用 port，Chrome 用 port+1；只在輸出資料夾寫檔，不連外網。
// 用法：node cdp-people-kind.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { freshTestOut } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const D = N.dash;
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
freshTestOut(OUT);
const run = fs.mkdtempSync(path.join(OUT, 'kind-')), DATA = path.join(run, 'data');
const STATE = path.join(DATA, 'ledger', 'state.json');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const state = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const actor = id => ((state().company || {}).actors || []).find(a => a && a.id === id);
const localDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }
const kindOp = (id, value) => post('/api/founder-op', { op: 'actorKind', target: id, value });
const nonEmpty = v => typeof v === 'string' && v.trim().length > 0;

/* ---------- 固定資料：與已批原型同一組人物（陳嘉慧是沒有角色的顧問） ---------- */
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
const msIds = (page.path?.milestones || []).map(m => m.id);
const MS = msIds[0] || 'ms-1';
write(path.join(DATA, 'ledger', 'confirmed.json'), { pageId: page.page.id, confirmedAt: '2026-11-10T10:00:00+00:00', values: {}, order: msIds });
const base = { aliases: [], status: 'active', fromMilestoneIds: [], addedAt: '2026-11-01' };
const OWNS = [MS, 'tk-k1'];
write(STATE, {
  schemaVersion: 1,
  intake: { state: 'complete' },
  company: {
    name: '測試公司', initials: '測試',
    actors: [
      { id: 'pr-lin', name: '林子軒', label: '林子軒', kind: 'customer', org: '晨光咖啡室', role: '店主', ...base },
      { id: 'pr-chan', name: '陳嘉慧', label: '陳嘉慧', kind: 'advisor', ...base },
      { id: 'pr-ho', name: '何美玲', label: '何美玲', kind: 'partner', org: '新麥麪粉行', role: '業務經理', ...base },
      { id: 'pr-wong', name: '王志明', label: '王志明', kind: 'advisor', ...base },
      { id: 'tm-lee', name: '李家豪', label: '李家豪', kind: 'team', role: '送貨', ...base, team: { type: 'parttime', state: 'paused', owns: OWNS } }
    ]
  },
  tasks: [{ id: 'tk-k1', title: '安排首批送貨', owner: 'tm-lee', status: 'planned', column: 'planned', dueAt: '2026-12-01', updatedAt: '' }],
  events: [], inputs: [], milestones: [], interviews: { applied: {} }
});
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;

/* ---------- 頁面小工具 ---------- */
const PIPE = BASE + '/dashboard/brain/pipeline';
async function openKind(id) {
  await waitFor(() => chrome.ev(`!!document.querySelector('[data-actor="${id}"] .fixwrap > button')`), 15000);
  await chrome.click(`[data-actor="${id}"] .fixwrap > button`);
  const tagged = await chrome.ev(`(()=>{const a=[...document.querySelectorAll('[data-actor="${id}"] .fixwrap .menu a')].find(e=>e.textContent===${JSON.stringify(D.ppl_fixKind)});if(!a)return false;a.setAttribute('data-k1','kind');return true;})()`);
  if (!tagged) throw new Error('找不到「' + D.ppl_fixKind + '」選項：' + id);
  await chrome.click('[data-k1="kind"]');
  if (!await waitFor(() => chrome.ev(`!!document.querySelector('#ppl-modal [data-kind="team"]')`), 5000)) throw new Error('改類別對話框沒有打開：' + id);
}
const SAVE = '#ppl-modal .pair-actions .btn.primary', CANCEL = '#ppl-modal .pair-actions .btn:not(.primary)';
const blur = () => chrome.ev(`(document.activeElement&&document.activeElement.blur&&document.activeElement.blur(),true)`);
// 對話框現況：選中的類別、兩欄是否出現（以實際高度判斷，不只看 hidden）、角色值、成員類別、提示字句
function modal() {
  return chrome.ev(`(()=>{const m=document.querySelector('#ppl-modal');if(!m)return null;const f=m.querySelector('#ppl-kind-team-fields');const role=m.querySelector('#ppl-kind-role');const hint=m.querySelector('#ppl-kind-role-hint');const note=m.querySelector('#ppl-kind-team-note');
    const r=f?f.getBoundingClientRect():{height:0};
    return {text:m.innerText,kinds:[...m.querySelectorAll('[data-kind]')].map(e=>e.getAttribute('data-kind')+'='+e.textContent.trim()),cur:([...m.querySelectorAll('[data-kind].cur')].map(e=>e.getAttribute('data-kind'))),
      shown:!!f&&!f.hidden&&r.height>0,fieldsH:r.height,hiddenAttr:!!f&&f.hidden,role:role&&role.value,ph:role&&role.placeholder,max:role&&role.maxLength,
      types:[...m.querySelectorAll('[data-team-type]')].map(e=>e.getAttribute('data-team-type')+'='+e.textContent.trim()),typeCur:[...m.querySelectorAll('[data-team-type].cur')].map(e=>e.getAttribute('data-team-type')),
      hint:hint&&hint.textContent,hintErr:!!hint&&hint.classList.contains('err'),note:note&&note.textContent,noteErr:!!note&&note.classList.contains('err'),
      labels:[...m.querySelectorAll('#ppl-kind-team-fields label')].map(e=>e.textContent.trim())};})()`);
}
const TYPES = ['cofounder', 'fulltime', 'parttime', 'contractor'];
const typesText = TYPES.map(t => t + '=' + D['team_' + t]);
const kindsText = ['customer', 'partner', 'investor', 'advisor', 'team'].map(k => k + '=' + D['ppl_kind_' + k]);

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);

  /* ===== 一、端點：拒絕的情況（甚麼都不寫入帳本） ===== */
  const before = JSON.stringify(actor('pr-chan'));
  const e1 = await kindOp('pr-chan', { kind: 'team' });
  ok('K-01 改為團隊成員不填角色：400，錯誤代碼 needRole', e1.code === 400 && e1.j && e1.j.error === 'needRole', e1);
  ok('K-02 不填角色：回覆字句是「' + D.ppl_errNeedRole + '」', e1.j && nonEmpty(e1.j.message) && e1.j.message === D.ppl_errNeedRole, e1.j);
  const e2 = await kindOp('pr-chan', { kind: 'team', role: '營運及採購負責人' });
  ok('K-03 不選成員類別：400，錯誤代碼 needTeamType', e2.code === 400 && e2.j && e2.j.error === 'needTeamType', e2);
  ok('K-04 不選成員類別：回覆字句是「' + D.ppl_errNeedTeamType + '」', e2.j && nonEmpty(e2.j.message) && e2.j.message === D.ppl_errNeedTeamType, e2.j);
  const e3 = await kindOp('pr-chan', { kind: 'team', role: '營運及採購負責人', teamType: 'boss' });
  ok('K-05 成員類別不在四個選項內：400 needTeamType', e3.code === 400 && e3.j && e3.j.error === 'needTeamType', e3);
  const e4 = await kindOp('pr-chan', { kind: 'team', role: '角'.repeat(41), teamType: 'fulltime' });
  const e4b = await kindOp('pr-chan', { kind: 'team', role: '   ', teamType: 'fulltime' });
  ok('K-06 角色 41 字：400 roleTooLong「' + D.ppl_errRoleTooLong + '」；只有空格當未填（needRole）', e4.code === 400 && e4.j && e4.j.error === 'roleTooLong' && nonEmpty(e4.j.message) && e4.j.message === D.ppl_errRoleTooLong && e4b.code === 400 && e4b.j && e4b.j.error === 'needRole', [e4, e4b]);
  const e5 = await kindOp('pr-chan', { kind: 'team', role: '採購 電話 91234567', teamType: 'fulltime' });
  const e6 = await kindOp('pr-chan', { kind: 'team', role: '採購 a@b.com', teamType: 'fulltime' });
  ok('K-07 角色含電話或電郵：400', e5.code === 400 && e6.code === 400, [e5, e6]);
  ok('K-08 角色含聯絡資料：代碼 roleContact，回覆字句是「' + D.ppl_errRoleContact + '」', e5.j && e5.j.error === 'roleContact' && nonEmpty(e5.j.message) && e5.j.message === D.ppl_errRoleContact, e5.j);
  const e7 = await kindOp('pr-chan', { kind: 'partner', role: '顧問', teamType: 'fulltime' });
  const e8 = await kindOp('pr-chan', { kind: 'team', role: '營運', teamType: 'fulltime', share: '10%' });
  ok('K-09 改為其他類別卻帶角色或成員類別、或多出欄位（如分成）：400', e7.code === 400 && e8.code === 400, [e7, e8]);
  await sleep(1500);
  ok('K-10 被拒絕的請求不入帳：陳嘉慧仍是顧問、沒有角色', JSON.stringify(actor('pr-chan')) === before, actor('pr-chan'));
  const exact = await kindOp('pr-chan', { kind: 'team', role: '角'.repeat(40), teamType: 'fulltime' });
  ok('K-11 角色剛好 40 字：在已疊加帳本上試套通過（202）', exact.code === 202, exact);
  // 上面一項會入隊列並由外殼合併；頁面測試改用另一位沒有角色的顧問（王志明）
  await waitFor(() => (actor('pr-chan') || {}).kind === 'team');
  ok('K-12 40 字角色入帳：role、roleBasisDate（伺服器當日）、roleBasisFrom founder、roleHistory 一筆', (() => { const a = actor('pr-chan'); return a && a.role === '角'.repeat(40) && a.roleBasisDate === localDay() && a.roleBasisFrom === 'founder' && Array.isArray(a.roleHistory) && a.roleHistory.length === 1; })(), actor('pr-chan'));

  /* ===== 二、頁面：顧問（沒有角色）在同一框填角色及成員類別後改為團隊成員（回歸第 7 項） ===== */
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  await chrome.go(PIPE, 1440);
  await openKind('pr-wong');
  let m = await modal();
  ok('K-13 對話框有五個類別，第五項是「' + D.ppl_kind_team + '」；現時類別（顧問）已選', m && m.kinds.join('|') === kindsText.join('|') && m.cur.join() === 'advisor', m);
  ok('K-14 現時類別不是團隊成員：角色及成員類別兩欄不出現（高度 0）', m && !m.shown && m.fieldsH === 0, m);
  await chrome.click('#ppl-modal [data-kind="partner"]');
  m = await modal();
  ok('K-15 選其他類別（供應或合作方）：兩欄仍不出現', m && m.cur.join() === 'partner' && !m.shown, m);
  await chrome.click('#ppl-modal [data-kind="team"]');
  m = await modal();
  ok('K-16 選團隊成員：同一框出現角色及成員類別兩欄；角色空白（對象原本沒有角色）', m && m.shown && m.role === '' && m.labels.length === 2, m);
  ok('K-17 兩欄字句：角色、必填提示、例子、成員類別、四個成員類別名稱、團隊頁說明；沒有預設成員類別', m && m.labels[0] === D.ppl_kindRole + '*' && m.labels[1] === D.ppl_kindTeamType + '*' && m.hint === D.ppl_kindRoleHint && m.ph === D.ppl_kindRolePh && m.max === 40 && m.types.join('|') === typesText.join('|') && m.typeCur.length === 0 && m.note === D.ppl_kindTeamNote, m);
  ok('K-18 對話框沒有鍵名、undefined、分成欄', m && !/undefined|ppl_|team_|null/.test(m.text) && !/分成/.test(m.text), m && m.text);
  // 已批原型：角色欄與下面成員類別兩列選項同寬（佔滿右欄）
  const wid = await chrome.ev(`(()=>{const r=document.querySelector('#ppl-kind-role').getBoundingClientRect().width,t=document.querySelector('#ppl-modal .ppl-kind-types').getBoundingClientRect().width;return {role:Math.round(r),types:Math.round(t)};})()`);
  ok('K-44 角色欄佔滿右欄（與成員類別選項同寬，同原型）', Math.abs(wid.role - wid.types) <= 2, wid);
  await chrome.click(SAVE);
  m = await modal();
  ok('K-19 未填角色按儲存：角色欄下顯示「' + D.ppl_errNeedRole + '」（紅字），對話框不關', m && m.hint === D.ppl_errNeedRole && m.hintErr && (actor('pr-wong') || {}).kind === 'advisor', m);
  await chrome.type('#ppl-kind-role', '營運及採購負責人');
  m = await modal();
  ok('K-20 開始輸入角色：錯誤提示還原為必填提示', m && m.hint === D.ppl_kindRoleHint && !m.hintErr, m);
  await chrome.click(SAVE);
  m = await modal();
  ok('K-21 未選成員類別按儲存：顯示「' + D.ppl_errNeedTeamType + '」，對話框不關', m && m.note === D.ppl_errNeedTeamType && m.noteErr && (actor('pr-wong') || {}).kind === 'advisor', m);
  await chrome.click('#ppl-modal [data-team-type="fulltime"]');
  m = await modal();
  ok('K-22 選「' + D.team_fulltime + '」：只有這一項選中', m && m.typeCur.join() === 'fulltime', m);
  await chrome.click(SAVE);
  ok('K-23 儲存後對話框關閉', await waitFor(() => chrome.ev(`!document.querySelector('#ppl-modal')`), 10000));
  const wong = await waitFor(() => { const a = actor('pr-wong'); return a && a.kind === 'team' ? a : null; });
  ok('K-24 帳本：王志明改為團隊成員，team 欄為 { type: fulltime, state: active, owns: [] }', wong && wong.team && wong.team.type === 'fulltime' && wong.team.state === 'active' && Array.isArray(wong.team.owns) && wong.team.owns.length === 0 && !('dormant' in wong.team), wong);
  ok('K-25 帳本：role、roleBasisDate（伺服器當日）、roleBasisFrom founder、roleHistory 一筆（舊值空白）', wong && wong.role === '營運及採購負責人' && wong.roleBasisDate === localDay() && wong.roleBasisFrom === 'founder' && Array.isArray(wong.roleHistory) && wong.roleHistory.length === 1 && wong.roleHistory[0].oldRole === '' && wong.roleHistory[0].newBasisDate === localDay(), wong);
  await chrome.go(BASE + '/dashboard/team', 1440);
  ok('K-26 團隊頁列出王志明及角色', await waitFor(() => chrome.ev(`document.body.innerText.includes('王志明')&&document.body.innerText.includes('營運及採購負責人')`), 10000), await chrome.ev(`document.body.innerText.slice(0,1500)`));

  /* ===== 三、同一請求重送：歷史不重複（回歸第 7 項「重播」） ===== */
  const same = { kind: 'team', role: '營運及採購負責人', teamType: 'fulltime' };
  // 隊列按先後套用：每批重送後排一個可辨認的標記操作（林子軒改名），等標記入帳，才證明前面的重送已合併
  const marker = async name => { const r = await post('/api/founder-op', { op: 'actorRename', target: 'pr-lin', value: { name } }); return r.code === 202 && !!await waitFor(() => (actor('pr-lin') || {}).name === name); };
  const r1 = await kindOp('pr-wong', same), r2 = await kindOp('pr-wong', same);
  const m1 = await marker('林子軒甲');
  const r3 = await kindOp('pr-wong', same);
  const m2 = await marker('林子軒');
  const wong2 = actor('pr-wong');
  ok('K-27 同一請求重送三次（兩次在合併前、一次在合併後）：都接受（202）且已入帳，角色歷史仍只有一筆，team 欄不變', m1 && m2 && [r1, r2, r3].every(r => r.code === 202) && wong2.roleHistory.length === 1 && JSON.stringify(wong2.team) === JSON.stringify(wong.team) && wong2.roleBasisDate === wong.roleBasisDate, { markers: [m1, m2], codes: [r1, r2, r3].map(r => r.code), wong2 });

  /* ===== 四、團隊成員改為顧問再改回：負責的站及工作還原（回歸第 8 項） ===== */
  const lee0 = actor('tm-lee');
  const t1 = await kindOp('tm-lee', { kind: 'advisor' });
  const leeA = await waitFor(() => { const a = actor('tm-lee'); return a && a.kind === 'advisor' ? a : null; });
  ok('K-28 團隊成員改為顧問：team 資料原樣保留並標 dormant（owns、狀態不清走）', t1.code === 202 && leeA && leeA.team && leeA.team.dormant === true && JSON.stringify(leeA.team.owns) === JSON.stringify(OWNS) && leeA.team.state === 'paused', leeA);
  await chrome.go(PIPE, 1440);
  ok('K-29 改為顧問後，名單頁有李家豪一行（創辦人可以再改回）', await waitFor(() => chrome.ev(`!!document.querySelector('[data-actor="tm-lee"]')`), 10000));
  await openKind('tm-lee');
  await chrome.click('#ppl-modal [data-kind="team"]');
  m = await modal();
  ok('K-30 原有角色預填：選團隊成員時角色欄已是「送貨」', m && m.shown && m.role === '送貨', m);
  await chrome.click('#ppl-modal [data-team-type="parttime"]');
  await chrome.click(SAVE);
  const leeB = await waitFor(() => { const a = actor('tm-lee'); return a && a.kind === 'team' ? a : null; });
  const task = (state().tasks || []).find(t => t.id === 'tk-k1');
  ok('K-31 改回團隊成員：負責的站及工作（owns）原樣還原，dormant 移除，成員狀態保留', leeB && leeB.team && JSON.stringify(leeB.team.owns) === JSON.stringify(OWNS) && !('dormant' in leeB.team) && leeB.team.state === 'paused' && leeB.team.type === 'parttime', leeB);
  ok('K-32 改離再改回：工作負責人不變（仍是李家豪）', task && task.owner === 'tm-lee', task);
  ok('K-33 角色同值改回：不新增角色歷史', leeB && leeB.role === '送貨' && (!leeB.roleHistory || leeB.roleHistory.length === (lee0.roleHistory || []).length), leeB);
  const dash = await get('/api/dashboard');
  const tm = ((dash.j && dash.j.people && dash.j.people.team) || []).find(x => x.id === 'tm-lee');
  ok('K-34 監察台資料：李家豪回到團隊名單', !!tm, (dash.j && dash.j.people && dash.j.people.team || []).map(x => x.id));

  /* ===== 五、選其他類別時兩欄不出現；原有角色預填（有角色的供應方） ===== */
  await chrome.go(PIPE, 1440);
  await openKind('pr-ho');
  m = await modal();
  ok('K-35 供應方（有角色）打開對話框：兩欄不出現', m && m.cur.join() === 'partner' && !m.shown, m);
  await chrome.click('#ppl-modal [data-kind="team"]');
  m = await modal();
  ok('K-36 選團隊成員：角色預填「業務經理」', m && m.shown && m.role === '業務經理', m);
  for (const k of ['customer', 'investor', 'advisor', 'partner']) {
    await chrome.click(`#ppl-modal [data-kind="${k}"]`);
    const mk = await modal();
    if (mk.shown) { ok('K-37 由團隊成員改選其他類別：兩欄收起', false, { k, mk }); break; }
    if (k === 'partner') ok('K-37 由團隊成員改選其他類別（客戶、投資者、顧問、供應）：兩欄收起', true);
  }
  await chrome.click(CANCEL);
  ok('K-38 取消：對話框關閉，帳本不變', await waitFor(() => chrome.ev(`!document.querySelector('#ppl-modal')`), 5000) && (actor('pr-ho') || {}).kind === 'partner');

  /* ===== 六、手機 390 寬：對話框可捲動，捲到底「儲存」可見可按 ===== */
  await chrome.go(PIPE, 390);
  await openKind('pr-ho');
  await chrome.click('#ppl-modal [data-kind="team"]');
  await chrome.click('#ppl-modal [data-team-type="contractor"]');
  // 改為較矮的手機畫面（390×560），令對話框內容一定超出一屏
  await chrome.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 560, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  const mob = await chrome.ev(`(()=>{const L=document.querySelector('#ppl-modal .layer');const cs=getComputedStyle(L);const s=document.querySelector(${JSON.stringify(SAVE)});
    const top0=s.getBoundingClientRect().top;L.scrollTop=L.scrollHeight;const r=s.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return {ov:cs.overflowY,sh:L.scrollHeight,ch:L.clientHeight,scrolled:L.scrollTop,saveTopBefore:top0,top:r.top,bottom:r.bottom,vh:innerHeight,h:r.height,hit:!!hit&&(hit===s||s.contains(hit)),noX:document.documentElement.scrollWidth<=innerWidth&&L.scrollWidth<=L.clientWidth};})()`);
  ok('K-39 手機 390×560：對話框內容超出一屏時可以捲動（overflow-y auto，scrollHeight > clientHeight）', ['auto', 'scroll'].includes(mob.ov) && mob.sh > mob.ch && mob.scrolled > 0, mob);
  ok('K-40 手機：捲到底後「儲存」完整在畫面內、沒有被遮蓋、最少 44 像素高；沒有橫向捲動', mob.top >= 0 && mob.bottom <= mob.vh && mob.hit && mob.h >= 44 && mob.noX, mob);
  // 直接在捲動後的位置按（不經 scrollIntoView）
  const pt = await chrome.ev(`(()=>{const r=document.querySelector(${JSON.stringify(SAVE)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await chrome.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await chrome.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  const ho = await waitFor(() => { const a = actor('pr-ho'); return a && a.kind === 'team' ? a : null; });
  ok('K-41 手機：在捲到底的位置按「儲存」成功，何美玲改為外判團隊成員，角色沿用「業務經理」且不新增歷史', ho && ho.team && ho.team.type === 'contractor' && ho.role === '業務經理' && (!ho.roleHistory || ho.roleHistory.length === 0), ho);

  /* ===== 七、頁面角色含電話：畫面提示 ===== */
  await chrome.go(PIPE, 1440);
  await openKind('pr-lin');
  await chrome.click('#ppl-modal [data-kind="team"]');
  await chrome.type('#ppl-kind-role', '店主 91234567');
  await chrome.click('#ppl-modal [data-team-type="cofounder"]');
  await chrome.click(SAVE);
  const toast = await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('#toast');return e&&!e.hidden&&e.textContent.trim()||null;})()`), 5000);
  ok('K-42 頁面角色含電話：提示「' + D.ppl_errRoleContact + '」，對話框不關、帳本不變', toast && nonEmpty(D.ppl_errRoleContact) && toast.includes(D.ppl_errRoleContact) && await chrome.ev(`!!document.querySelector('#ppl-modal')`) && (actor('pr-lin') || {}).kind === 'customer', { toast });
  /* ===== 八、角色輸入欄寬度（已批原型 kind-dialog-team-1440／390：與成員類別兩列同寬；手機佔滿全寬）及截圖 ===== */
  for (const width of [1440, 390]) {
    await chrome.go(PIPE, width, width === 390 ? 844 : 900);
    await openKind('pr-lin');
    await chrome.click('#ppl-modal [data-kind="team"]');
    await chrome.ev("(()=>{const r=document.querySelector('#ppl-kind-role');r.value='';return true})()");
    await chrome.type('#ppl-kind-role', '營運及採購負責人');
    await chrome.click('#ppl-modal [data-team-type="fulltime"]');
    await blur(); await sleep(300);
    const w = await chrome.ev(`(()=>{const r=document.querySelector('#ppl-kind-role'),t=document.querySelector('#ppl-modal .ppl-kind-types');return {role:Math.round(r.getBoundingClientRect().width),types:Math.round(t.getBoundingClientRect().width)}})()`);
    ok('K-45 角色輸入欄（' + width + '）：與成員類別兩列同寬', w && w.role >= w.types - 2 && w.role > 250, w);
    await chrome.ev(`(()=>{const m=document.querySelector('#ppl-modal');if(m)m.scrollTop=0;window.scrollTo(0,0);return true})()`); await sleep(200);
    const shot = await chrome.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `k1-kind-team-${width}.png`), Buffer.from(shot.data, 'base64'));
    await chrome.click(CANCEL); await sleep(200);
  }
  ok('K-43 沒有腳本錯誤', chrome.errors.length === 0, chrome.errors);
} catch (error) {
  ok('頁面測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info ?? '')).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
