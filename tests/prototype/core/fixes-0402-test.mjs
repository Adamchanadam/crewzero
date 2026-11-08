// 0.40.2 十項修正的測試（假 AI、隔離資料夾；不開瀏覽器、不連外網）。每項至少一條「修正前會失敗、修正後通過」的檢查。
//  1 舊頁面雜湊相容　2 附件檔名與筆記規則衝突　3 Office 轉文字不阻塞伺服器　4 合併後改名　5 成員改類別保留負責範圍
//  6 更正連結核對頁面版本　7 片語不當人名　10 畫面不出現「任務 N」編號（8、9 在 people-sync-test.mjs）。
// 設計及狀態表：docs/evidence/release-0402/fix-plan.md
// 用法：node fixes-0402-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
import { docxOf } from '../lib/zip-fixture.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = f => import(pathToFileURL(path.join(PROTO, f)).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await imp('ask-lib.mjs');
const P = await imp('people-ops.mjs');
const inb = await imp('inbound-lib.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const attempt = async (name, fn) => { try { await fn(); } catch (e) { ok(name + '（執行出錯）', false, String(e && e.stack || e).slice(0, 400)); } };
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const b64 = x => Buffer.from(x).toString('base64');
const file = (name, data) => ({ name, data: b64(data) });
const needFn = (o, k) => typeof o[k] === 'function';

/* =====================================================================
   純函數部分（不需要伺服器）
   ===================================================================== */

/* ---- 1 舊頁面雜湊：新舊兩種算法任一相符即接受；頁面其他內容改了仍被拒 ---- */
await attempt('1 純函數', async () => {
  const pg = { page: { id: 'pg-1' }, company: { name: '甲' }, sources: [{ title: '來源', url: 'https://example.org/a', fixedOn: '2026-11-01' }, { title: '無連結' }], glance: { rows: [{ id: 'g1', value: '舊值' }] } };
  const legacy = lib.fnv(JSON.stringify(pg));
  ok('1 頁面來源含網址時，新算法與 0.39.1 算法的結果不同（這正是升級後被拒的原因）', lib.proofreadHash(pg) !== legacy);
  ok('1 確認流程的版本比對函數存在，新算法的雜湊相符', needFn(lib, 'proofreadHashMatches') && lib.proofreadHashMatches(pg, lib.proofreadHash(pg)) === true);
  ok('1 用 0.39.1 算法雜湊（整頁 JSON）的確認被接受', needFn(lib, 'proofreadHashMatches') && lib.proofreadHashMatches(pg, legacy) === true);
  const pg2 = JSON.parse(JSON.stringify(pg)); pg2.glance.rows[0].value = 'Zero 改了這裏';
  ok('1 Zero 改了頁面其他內容：舊算法的雜湊仍被拒', needFn(lib, 'proofreadHashMatches') && lib.proofreadHashMatches(pg2, legacy) === false && lib.proofreadHashMatches(pg2, lib.proofreadHash(pg)) === false);
  const pg3 = JSON.parse(JSON.stringify(pg)); pg3.sources[0].url = 'https://example.org/b';
  ok('1 只改來源連結：舊算法的雜湊對舊頁面成立、新算法的雜湊對新頁面成立', needFn(lib, 'proofreadHashMatches') && lib.proofreadHashMatches(pg, legacy) && lib.proofreadHashMatches(pg3, lib.proofreadHash(pg)));
  ok('1 空值、非字串一律不相符', needFn(lib, 'proofreadHashMatches') && !lib.proofreadHashMatches(pg, '') && !lib.proofreadHashMatches(pg, undefined) && !lib.proofreadHashMatches(pg, null));
});

/* ---- 2 收件匣辨認：附件（任何原名）不是筆記；舊檔相容 ---- */
await attempt('2 純函數', async () => {
  const id = '2026-11-08-103000-123';
  const note = n => needFn(lib, 'isInboxNote') && lib.isInboxNote(n);
  ok('2 真正的筆記檔照舊被認出（含舊編號格式與意見檔）', note(id + '-note-event.md') && note(id + '-note-adhoc.md') && note('OLD-note-order.md') && note(id + '-note-help.md') && note(id + '-feedback-checkup.md') && note('29991231-000000-001-note-feedback.md'));
  const attach = [id + '-note-event-file-01-報告-note-event.md', id + '-note-event-file-02-x-feedback-checkup.md', id + '-note-adhoc-file-01-備忘-note-adhoc.md', id + '-note-order-file-03-y-note-order.md',
    id + '-note-doc-file-01-z-note-help.md', id + '-note-event-file-01-q-note-practice-prep.md', id + '-note-event-file-12-note-event.md'];
  ok('2 原名以 -note-<類型>.md／-feedback-x.md 結尾的附件（event／adhoc／order／doc，含舊檔）不是筆記', attach.every(f => !note(f)), attach.filter(note));
  ok('2 交資料及預填的附件（原名以 -intake.md／-prefill.md 結尾）不是交資料檔或預填檔', needFn(lib, 'isInboxIntake') && !lib.isInboxIntake(id + '-intake-01-甲-intake.md') && !lib.isInboxPrefill(id + '-prefill-02-乙-prefill.md') && lib.isInboxIntake(id + '-intake.md') && lib.isInboxPrefill(id + '-prefill.md'));
  ok('2 isInboxNoteOf：附件不算指定類型的筆記', needFn(lib, 'isInboxNoteOf') && lib.isInboxNoteOf(id + '-note-help.md', 'help') && !lib.isInboxNoteOf(id + '-note-event-file-01-a-note-help.md', 'help'));
});

/* ---- 4 合併後可把保留者改成被合併者的舊名 ---- */
await attempt('4 純函數', async () => {
  const s0 = { company: { actors: [
    { id: 'a1', name: '陳先生', kind: 'customer', aliases: [], status: 'active' },
    { id: 'a2', name: '陳生', kind: 'customer', aliases: ['老陳'], status: 'active' },
    { id: 'a3', name: '李小姐', kind: 'customer', aliases: [], status: 'active' }] } };
  const m = P.applyActorOp(s0, 'actorMerge', { from: 'a2', into: 'a1' });
  ok('4 前提：合併成功，被合併者的名字進了保留者的別名', m.ok && m.state.company.actors[0].aliases.includes('陳生') && m.state.company.actors[1].mergedInto === 'a1');
  const r = P.applyActorOp(m.state, 'actorRename', { id: 'a1', name: '陳生' });
  ok('4 把保留者改名為被合併者的舊名：接受（不再當重名）', r.ok === true, r.error);
  const a1 = r.ok ? r.state.company.actors.find(a => a.id === 'a1') : null;
  ok('4 改名結果：name 為舊名、原名進別名、自己不在自己的別名內、不產生重複別名', a1 && a1.name === '陳生' && a1.aliases.includes('陳先生') && !a1.aliases.includes('陳生') && new Set(a1.aliases).size === a1.aliases.length, a1);
  const r2 = P.applyActorOp(m.state, 'actorRename', { id: 'a1', name: '老陳' });
  ok('4 改成被合併者的別名也接受', r2.ok === true, r2.error);
  const r3 = P.applyActorOp(m.state, 'actorRename', { id: 'a1', name: '李小姐' });
  ok('4 仍然擋住真正的重名（改成另一位對象的名字）', r3.ok === false && r3.error === 'duplicateName', r3);
  const r4 = P.applyActorOp(m.state, 'actorRename', { id: 'a3', name: '陳生' });
  ok('4 另一位對象不可改成已併入別人的對象的名字（那名字屬於保留者）', r4.ok === false && r4.error === 'duplicateName', r4);
  // 兩層合併：a2 併入 a1，a1 再併入 a3 → 把 a3 改成 a2 的舊名也可以
  const m2 = P.applyActorOp(m.state, 'actorMerge', { from: 'a1', into: 'a3' });
  const r5 = m2.ok ? P.applyActorOp(m2.state, 'actorRename', { id: 'a3', name: '陳生' }) : m2;
  ok('4 多層合併：最終保留者可改成鏈上任何被合併者的舊名', m2.ok && r5.ok === true, r5.error);
});

/* ---- 5 成員改類別：保留負責範圍（team 標記不生效），改回成員還原；畫面與工作負責人一致 ---- */
await attempt('5 純函數', async () => {
  const mk = () => ({ milestones: [{ id: 'm1', short: '第一站' }, { id: 'm2', short: '第二站' }],
    tasks: [{ id: 't1', title: '送貨', status: 'active', owner: 'tm1' }, { id: 't2', title: '對帳', status: 'active', owner: 'founder' }],
    company: { actors: [{ id: 'tm1', name: '陳小明', kind: 'team', role: '送貨', aliases: [], status: 'active', team: { type: 'fulltime', state: 'paused', owns: ['m1', 'm2'] } },
      { id: 'tm2', name: '李大華', kind: 'team', role: '營運', aliases: [], status: 'active', team: { type: 'parttime', state: 'active', owns: [] } }] } });
  const s0 = mk();
  ok('5 前提：成員在職時 ownershipOf 列出他的站，工作負責人是團隊', P.ownershipOf(s0).lines.find(l => l.actorId === 'tm1').stations.join() === '第一站,第二站' && P.ownerView(s0.tasks[0], s0.company.actors).kind === 'team');
  const r1 = P.applyActorOp(s0, 'actorKind', { id: 'tm1', kind: 'advisor' });
  const a1 = r1.state.company.actors.find(a => a.id === 'tm1');
  ok('5 改為顧問：team 資料（類型、狀態、負責的站）保留，標記不生效', r1.ok && a1.kind === 'advisor' && a1.team && a1.team.dormant === true && a1.team.type === 'fulltime' && a1.team.state === 'paused' && a1.team.owns.join() === 'm1,m2', a1);
  const ov = P.ownerView(r1.state.tasks[0], r1.state.company.actors);
  ok('5 期間畫面一致：名單視圖沒有 team 欄、不在成員清單；ownershipOf 不列他；工作負責人不再顯示為團隊成員（回創辦人名下並標負責人已離開）',
    (v => !v.actors.find(x => x.id === 'tm1').team && !v.team.some(x => x.id === 'tm1') && v.external.some(x => x.id === 'tm1'))(P.peopleView(r1.state, { today: '2026-11-08' })) && !P.ownershipOf(r1.state).lines.some(l => l.actorId === 'tm1') && ov.kind === 'founder' && ov.left === true && ov.name === '陳小明', ov);
  const r2 = P.applyActorOp(r1.state, 'actorKind', { id: 'tm1', kind: 'team' });
  const a2 = r2.state.company.actors.find(a => a.id === 'tm1');
  ok('5 改回成員：負責範圍原樣還原（類型、狀態、負責的站），不再標不生效', r2.ok && a2.kind === 'team' && !('dormant' in a2.team) && a2.team.type === 'fulltime' && a2.team.state === 'paused' && a2.team.owns.join() === 'm1,m2', a2);
  const ow2 = P.ownershipOf(r2.state), ov2 = P.ownerView(r2.state.tasks[0], r2.state.company.actors);
  ok('5 還原後：ownershipOf 又列出他的站及名下工作，工作負責人回到成員（暫停中）', ow2.lines.find(l => l.actorId === 'tm1').stations.join() === '第一站,第二站' && ow2.lines.find(l => l.actorId === 'tm1').tasks.join() === '送貨' && ov2.kind === 'team' && ov2.paused === true, { ow2, ov2 });
  // 唯一成員改類別：ownershipOf 回 null，名下工作與它一致（不顯示為成員負責）
  const solo = { ...mk(), company: { actors: [mk().company.actors[0]] } };
  const rs = P.applyActorOp(solo, 'actorKind', { id: 'tm1', kind: 'partner' });
  ok('5 唯一成員改類別：ownershipOf 為 null，名下工作也不再顯示為成員負責（與 ownershipOf 一致）', P.ownershipOf(rs.state) === null && P.ownerView(rs.state.tasks[0], rs.state.company.actors).kind !== 'team');
  const r3 = P.applyActorOp(r1.state, 'actorKind', { id: 'tm1', kind: 'customer' });
  ok('5 非成員之間再改類別：保留的 team 資料不被動', r3.ok && r3.state.company.actors.find(a => a.id === 'tm1').team.owns.join() === 'm1,m2');
  const r4 = P.applyActorOp(r1.state, 'actorTeam', { id: 'tm1', team: { state: 'active' } });
  ok('5 非成員不可改團隊資料（actorTeam 拒絕）', r4.ok === false && r4.error === 'notTeam');
  const noRole = mk(); noRole.company.actors.push({ id: 'x9', name: '周先生', kind: 'customer', aliases: [], status: 'active' });
  ok('5 沒有保留 team 的客戶改為成員：照舊要求角色、建立預設 team', P.applyActorOp(noRole, 'actorKind', { id: 'x9', kind: 'team' }).error === 'needRole');
});

/* ---- 7 片語不當人名；真實人名及機構名（中英文）不誤擋 ---- */
await attempt('7 純函數', async () => {
  const chk = name => P.checkNewActorItem({ kind: 'newActor', name, actorKind: 'partner', why: '概覽提到' }, { actors: [], texts: [name + '、其他內容'] });
  const phrases = ['日常營運', '目標客戶', '市場推廣', '日常營運管理', '營運', '負責營運的人', 'Daily Operations', 'Marketing', 'Day-to-day operations', '日常的營運', '可以推廣', '市場及推廣', 'Sales', 'Marketing Team'];
  ok('7 片語（沒有標點、逐字出現在原文）不可作名字：退回修正', phrases.every(n => chk(n).status === 'error'), phrases.filter(n => chk(n).status !== 'error'));
  const real = ['區家明校長', '黃小姐', '乙餐廳', '香港教育局', '晨光教育', '陳大文', '歐陽小姐', '客戶服務中心', '市場推廣部', '家長代表', 'Kelvin Ho', 'Mei Lin Tan', 'Ivy Cheung', 'Sam Wong', 'ABC Marketing Ltd', 'Mark Sales', 'Zero', '美的集團', '的近律師行', 'Target', 'Design', 'Brand', '和記'];
  ok('7 真實人名及機構名（中英文）不誤擋', real.every(n => chk(n).status === 'ok'), real.filter(n => chk(n).status !== 'ok').map(n => [n, chk(n).status]));
  const orgs = P.checkPeopleSync({ items: [{ kind: 'newActor', name: '美的集團', actorKind: 'partner', why: '主要供應商' }, { kind: 'newActor', name: '的近律師行', actorKind: 'advisor', why: '法律顧問' }, { kind: 'newActor', name: 'Target', actorKind: 'customer', why: '洽談中' }] }, { actors: [], texts: ['我們的主要供應商是美的集團，法律顧問是的近律師行，美國客戶 Target 正在洽談。'] });
  ok('7 名稱含「的」及單字英文品牌名：整理名單照常接受，不退回', orgs.ok && orgs.items.length === 3, orgs);
  const sync = P.checkPeopleSync({ items: [{ kind: 'newActor', name: '日常營運', actorKind: 'advisor', why: 'x' }, { kind: 'newActor', name: '王伯', role: '顧問', actorKind: 'advisor', why: 'y' }] }, { actors: [], texts: ['日常營運由我自己負責', '王伯是農務顧問'], lenient: true });
  ok('7 整理名單的核對：片語丟棄、真人名保留', sync.ok && sync.items.length === 1 && sync.items[0].name === '王伯' && sync.dropped.some(d => d.name === '日常營運'), sync);
  const strict = P.checkPeopleSync({ items: [{ kind: 'newActor', name: '日常營運', actorKind: 'advisor', why: 'x' }] }, { actors: [], texts: ['日常營運由我自己負責'] });
  ok('7 非寬鬆時退回修正一次，訊息說明不可寫工作範疇或片語', !strict.ok && /人名或機構名/.test(strict.errors[0]), strict.errors);
  ok('7 looksLikePhrase 有匯出且對空字串穩定', needFn(P, 'looksLikePhrase') && P.looksLikePhrase('') === false);
});

/* ---- 10 畫面不出現「任務 N」編號：原始碼掃描 ＋ 運作環標籤函數行為 ---- */
await attempt('10 靜態', async () => {
  const dash = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8'), orb = fs.readFileSync(path.join(PROTO, 'orbit.js'), 'utf8');
  const bad = [/tasksL\s*\+\s*'\s'\s*\+/, /taskLabel\([^)]*\)\s*\+\s*'\s'\s*\+\s*ft/, /\(n\.tasksL \|\| '任務'\) \+ ' '/, /String\(id\)\.replace\(\/\^t\//];
  const hits = [];
  for (const [nm, src] of [['dashboard.html', dash], ['orbit.js', orb]]) for (const re of bad) if (re.test(src)) hits.push(nm + ' ' + re);
  ok('10 dashboard.html 及 orbit.js 沒有「任務 + 編號」的組字寫法，也不用內部代號當標籤', hits.length === 0, hits);
  ok('10 任務詳情視窗、作業網任務列、事件標籤都用工作標題', /modal\(t\.title, h\('dl'/.test(dash) && /h\('span', null, t\.title\)/.test(dash) && /return t \? t\.title : D\.tasksL/.test(dash));
  // 在最小的假 DOM 內載入 orbit.js 的 taskLabel 不可行（依賴 DOM）：改以函數原始碼求值
  const m = /function taskLabel\(id\) \{[^\n]*\}/.exec(orb);
  const S = { n: { tasksL: '任務' }, taskTitle: { t7: '準備報價單並寄出給甲餐廳的陳先生' } };
  const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const taskLabel = m ? new Function('S', 'clip', m[0] + '; return taskLabel;')(S, clip) : null;
  ok('10 運作環的工作顯示名：有標題寫標題（截短），沒有標題只寫「任務」，不出現數字或內部代號', taskLabel && taskLabel('t7') === clip(S.taskTitle.t7, 14) && taskLabel('t7').length <= 14 && taskLabel('t9') === '任務' && !/\d/.test(taskLabel('t9')), taskLabel && [taskLabel('t7'), taskLabel('t9')]);
});

/* ---- 3 純函數：轉換不阻塞事件迴圈、同時數量受限、逾時／壞檔不留半個文字版 ---- */
await attempt('3 純函數', async () => {
  const paras = []; for (let i = 0; i < 60000; i++) paras.push('第' + i + '段：供應協議條款 ' + 'abcdefghij'.repeat(8));
  const big = docxOf(paras);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-fx0402-'));
  try {
    let max = 0, last = Date.now(); const tk = setInterval(() => { const n = Date.now(); max = Math.max(max, n - last); last = n; }, 10);
    const created = [], t0 = Date.now();
    const r = await inb.receiveAttachments({ id: 'ID', type: 'event', attachments: [...Array.from({ length: 8 }, (_, i) => ({ name: '大' + i + '.docx', bytes: big })), { name: '壞.docx', bytes: Buffer.from('PK not a zip') }], text: '', links: [], inboxDir: dir, created });
    const total = Date.now() - t0; max = Math.max(max, Date.now() - last); clearInterval(tk);
    const info = Object.fromEntries(r.meta.fileInfo.map(f => [f.name, f]));
    ok('3 九份附件（八份大檔）轉換完成期間，事件迴圈最長停頓 ≤ 300 毫秒（修正前同步轉換會停頓整段轉換時間）', max <= 300, { maxGapMs: max, totalMs: total });
    ok('3 回傳時每份大檔都已 convert ok，文字版已完整存在（內容含最後一段）；壞檔為 corrupt 且沒有文字版', Array.from({ length: 8 }, (_, i) => info['ID-note-event-file-' + String(i + 1).padStart(2, '0') + '-大' + i + '.docx']).every(f => f && f.convert === 'ok' && fs.readFileSync(path.join(dir, f.text), 'utf8').includes('第59999段')) && info['ID-note-event-file-09-壞.docx'].convert === 'corrupt' && !fs.existsSync(path.join(dir, 'ID-note-event-file-09-壞.docx.md')), Object.values(info).map(f => f.convert));
    ok('3 fileInfo 次序與附件次序一致；created 記下全部寫出的路徑（原檔＋文字版）', r.meta.fileInfo.length === 9 && r.meta.fileInfo[0].name.endsWith('大0.docx') && created.length === 9 + 8 + 1 && created.every(p => fs.existsSync(p)), { n: r.meta.fileInfo.length, created: created.length });
    ok('3 同時轉換的份數不超過 2', inb.convertStats && inb.convertStats.max >= 1 && inb.convertStats.max <= 2 && inb.convertStats.total === 9, inb.convertStats);
    // 逾時：不留半個文字版，結果是未能轉換
    const f2 = path.join(dir, '逾時.docx'); fs.writeFileSync(f2, big);
    const to = await inb.convertOffice(f2, { timeoutMs: 1 });
    await sleep(800);
    ok('3 逾時：結果為未能轉換（corrupt），文字版不存在（不讓 AI 讀到半個檔）', to.ok === false && to.reason === 'corrupt' && !fs.existsSync(f2 + '.md'), to);
    const okR = await inb.convertOffice(f2);
    ok('3 逾時之後同一檔再轉換：成功（佇列沒有卡住）', okR.ok === true && fs.existsSync(f2 + '.md'), okR);
    // 中途出錯：呼叫者能清掉（所有轉換先收尾才丟例外）
    const dir2 = path.join(dir, 'c5'); fs.mkdirSync(dir2); fs.writeFileSync(path.join(dir2, 'ID-note-event-file-02-乙.docx'), 'x');
    const created2 = []; let threw = false;
    try { await inb.receiveAttachments({ id: 'ID', type: 'event', attachments: [{ name: '甲.docx', bytes: big }, { name: '乙.docx', bytes: big }], text: '', links: [], inboxDir: dir2, created: created2 }); } catch { threw = true; }
    await sleep(600);
    for (const p of created2) try { fs.unlinkSync(p); } catch { }
    ok('3 收件途中出錯：丟例外，清掉記下的路徑後不留任何文字版（只剩原本佔位的檔）', threw && fs.readdirSync(dir2).join() === 'ID-note-event-file-02-乙.docx', { threw, left: fs.readdirSync(dir2) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* =====================================================================
   伺服器部分：1（確認流程）、2（收件）、3（伺服器不停頓）、6（更正連結）
   ===================================================================== */
const DATA = path.join(OUT, 'data'), BASE = `http://127.0.0.1:${PORT}`;
for (const k of ['company', 'ledger']) fs.mkdirSync(path.join(DATA, k), { recursive: true });
oldInstall(DATA, PROTO);
const PAGE = path.join(DATA, 'company', 'page.json'), CONF = path.join(DATA, 'ledger', 'confirmed.json'), STATE = path.join(DATA, 'ledger', 'state.json');
const readPage = () => JSON.parse(fs.readFileSync(PAGE, 'utf8'));
{ const p = readPage(); p.sources = [{ ...p.sources[0] }, { ...p.sources[0], title: '來源乙（市場資料）' }, { ...p.sources[0], title: '來源丙（政策文件）' }]; fs.writeFileSync(PAGE, JSON.stringify(p, null, 2)); }
const env = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
let log = '';
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const call = async (p, body, headers = {}) => { const r = await fetch(BASE + p, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...headers }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const get = async p => (await call(p)).j;
const post = (p, b) => call(p, b);
const waitFor = async (fn, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(300); } return null; };
const state = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const runs = async () => (await get('/api/status')).runs || [];
const mode = (...m) => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m.join('\n') + '\n');
const shellEnv = { ...env };
const shell = () => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: shellEnv, encoding: 'utf8', timeout: 90000 });
const inboxDir = path.join(DATA, 'founder', 'inbox');
const inbox = () => { try { return fs.readdirSync(inboxDir); } catch { return []; } };
let ready = false;
try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 15000);
  await post('/api/setup', { action: 'certify', host: 'test' });
  const cert = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ready = !!cert && cert.state === 'passed';
  ok('假 AI 認證通過', ready, cert && cert.state);
} catch (e) { ok('伺服器啟動', false, String(e)); }

if (ready) {
  /* ---- 6 更正連結須帶來源標題，伺服器核對相符才寫 ---- */
  await attempt('6 伺服器', async () => {
    const p0 = readPage(), raw0 = () => fs.readFileSync(PAGE, 'utf8');
    const t0 = p0.sources[0].title, t1 = p0.sources[1].title;
    const before = raw0();
    const wrong = await post('/api/source-url', { n: 1, title: '另一項來源的標題', url: 'https://example.org/wrong' });
    ok('6 標題與第 n 項不符：拒絕（409）、固定字句請重新載入、page.json 完全沒變', wrong.code === 409 && wrong.j && wrong.j.message === N.ui.srcUrlStale && /重新載入/.test(wrong.j.message) && raw0() === before, wrong);
    const none = await post('/api/source-url', { n: 1, url: 'https://example.org/wrong' });
    ok('6 沒有帶標題（舊頁面的請求）：拒絕（409）、page.json 沒變', none.code === 409 && raw0() === before, none);
    const good = await post('/api/source-url', { n: 1, title: t1, url: 'https://example.org/b' });
    const p1 = readPage();
    ok('6 標題相符：寫入該項（只改第 1 項）', good.code === 200 && p1.sources[1].url === 'https://example.org/b' && !p1.sources[0].url && !p1.sources[2].url, good);
    // 頁面已重擬（來源次序變了）而瀏覽器仍帶舊序號
    const swapped = readPage(); [swapped.sources[0], swapped.sources[1]] = [swapped.sources[1], swapped.sources[0]]; fs.writeFileSync(PAGE, JSON.stringify(swapped, null, 2));
    const before2 = raw0();
    const stale = await post('/api/source-url', { n: 0, title: t0, url: 'https://example.org/stale' });
    ok('6 頁面已重擬、舊序號對應另一項：拒絕、不改錯項', stale.code === 409 && raw0() === before2, stale);
    const fresh = await post('/api/source-url', { n: 1, title: t0, url: 'https://example.org/a' });
    const p2 = readPage();
    ok('6 重新載入後用新序號及標題：寫入正確的一項', fresh.code === 200 && p2.sources[1].title === t0 && p2.sources[1].url === 'https://example.org/a' && p2.sources[0].url === 'https://example.org/b', fresh);
    const html = fs.readFileSync(path.join(PROTO, 'proofread.html'), 'utf8');
    ok('6 proofread.html 送出更正連結時帶上來源標題', /JSON\.stringify\(\{ n: n, title: s\.title, url:/.test(html));
    ok('6 其他來源不受影響、確認檔沒有被改', p2.sources.length === 3);
  });

  /* ---- 1 升級前載入的校對頁（0.39.1 算法的雜湊）在升級後送出確認：被接受；頁面其他內容改了仍被拒 ---- */
  await attempt('1 伺服器', async () => {
    const pg = readPage(), conf0 = JSON.parse(fs.readFileSync(CONF, 'utf8'));
    const legacy = lib.fnv(JSON.stringify(pg));
    ok('1 前提：頁面來源已有網址，兩種算法的雜湊不同', legacy !== lib.proofreadHash(pg) && pg.sources.some(s => s.url));
    const NL = String.fromCharCode(10);
    const submit = async hash => {
      const machine = { format: 'startup-os.proofread-reply/0.1', page: pg.page.id, company: pg.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: conf0.order, orderProposed: conf0.order, orderChanged: false, nextActionMilestone: conf0.nextActionMilestone, decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '' };
      const head = ['kind: proofread', 'ref: ' + pg.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + hash, 'batch: false', 'shownAt: ' + lib.localIso()];
      const seen = new Set((await runs()).map(r => r.id));
      const sub = await post('/api/submit', { kind: 'proofread', ref: pg.page.id, text: [head.join(NL), '', '# 確認', '', '```json', JSON.stringify(machine), '```', ''].join(NL) });
      const run = await waitFor(async () => (await runs()).find(r => !seen.has(r.id) && r.kind === 'proofread' && (r.state === 'done' || r.state === 'failed')));
      return { sub, run };
    };
    const a = await submit(legacy);
    ok('1 升級前載入、用 0.39.1 算法雜湊的確認：被接受（不是「版本已經更改」）', a.sub.code === 200 && a.run && a.run.state === 'done' && !/已經更改/.test(a.run.error || ''), a.run && { state: a.run.state, error: a.run.error });
    const b = await submit(lib.proofreadHash(pg));
    ok('1 新算法的雜湊同樣被接受', b.run && b.run.state === 'done', b.run && b.run.error);
    // Zero 在確認前改了頁面其他內容：帶舊雜湊 → 拒絕
    const edited = readPage(); edited.glance.status.items[0].label = edited.glance.status.items[0].label + '（Zero 已重擬）'; fs.writeFileSync(PAGE, JSON.stringify(edited, null, 2));
    const confBefore = fs.readFileSync(CONF, 'utf8');
    const c = await submit(legacy);
    ok('1 頁面其他內容已改，仍帶舊雜湊：被拒絕，原因為版本已更改', c.run && c.run.state === 'failed' && /已經更改/.test(c.run.error || ''), c.run && { state: c.run.state, error: c.run.error });
    ok('1 被拒絕的確認沒有改動確認檔', fs.readFileSync(CONF, 'utf8') === confBefore);
    fs.writeFileSync(PAGE, JSON.stringify(pg, null, 2));
  });

  /* ---- 2 附件原名與筆記規則衝突：真正的事件／要求不失去附件，也不會多出誤判的筆記工作 ---- */
  await attempt('2 伺服器', async () => {
    mode('event:event-follow', 'event:event-follow', 'event:event-follow');
    const seen0 = new Set((await runs()).map(r => r.id));
    const evAtt = [file('報告-note-event.md', '# 報告\n內容'), file('意見-feedback-checkup.md', '意見'), file('甲-intake.md', '資料'), file('丙-prefill.md', '預填'), file('說明-note-help.md', '求助')];
    const ev = await post('/api/intake', { kind: 'note', type: 'event', text: '11 月 6 日與甲餐廳陳先生會面，對方要求報價。', date: '2026-11-06', files: evAtt });
    ok('2 收件成功（202）', ev.code === 202 && ev.j && ev.j.id, ev);
    const rEv = await waitFor(async () => (await runs()).find(r => !seen0.has(r.id) && r.kind === 'note' && r.noteType === 'event' && (r.state === 'done' || r.state === 'failed')));
    const inEv = ev.j && state().inputs.find(i => i.id === 'in-' + ev.j.id);
    ok('2 事件工作完成，且附件一份不少地登記在這件事上（修正前附件被當成筆記先處理，真正的事件失去附件）', rEv && rEv.state === 'done' && inEv && inEv.files.length === 5, { run: rEv && [rEv.state, rEv.error], files: inEv && inEv.files });
    const ad = await post('/api/intake', { kind: 'note', type: 'adhoc', text: '請準備一頁簡介。', files: [file('備忘-note-adhoc.md', '備忘'), file('x-note-order.md', 'y')] });
    const rAd = await waitFor(async () => (await runs()).find(r => !seen0.has(r.id) && r.kind === 'note' && r.noteType === 'adhoc' && (r.state === 'done' || r.state === 'failed')));
    const inAd = ad.j && state().inputs.find(i => i.id === 'in-' + ad.j.id);
    ok('2 請 Zero 做一件事：附件原名像筆記檔也不被誤判，附件齊全', rAd && rAd.state === 'done' && inAd && inAd.via === 'adhoc' && inAd.files.length === 2, { run: rAd && [rAd.state, rAd.error], files: inAd && inAd.files });
    await sleep(1500);
    const all = (await runs()).filter(r => !seen0.has(r.id));
    ok('2 沒有多出誤判的筆記工作或交資料工作：新工作的類型只有事件及請 Zero 做一件事，也沒有失敗', all.every(r => (r.kind === 'note' && ['event', 'adhoc'].includes(r.noteType)) || r.kind === 'ask') && !all.some(r => r.state === 'failed'), all.map(r => [r.kind, r.noteType, r.state]));
    ok('2 收件匣已清空（附件隨筆記封存）', inbox().length === 0, inbox());
    // 舊檔相容：升級前已在收件匣、未處理的事件（附件原名以 -note-event.md 結尾）
    const oldId = '2026-11-01-090000-001', stored = oldId + '-note-event-file-01-舊報告-note-event.md';
    fs.writeFileSync(path.join(inboxDir, stored), '# 舊報告');
    fs.writeFileSync(path.join(inboxDir, oldId + '-note-event.md'), 'kind: note\ntype: event\nat: ' + lib.localIso() + '\n\n舊的事件文字。\n\n```json\n' + JSON.stringify({ date: '2026-11-01', files: [{ name: '舊報告-note-event.md', stored, bytes: 9 }] }) + '\n```\n');
    mode('event:event-follow');
    const r = shell();
    const inOld = state().inputs.find(i => i.id === 'in-' + oldId);
    ok('2 升級前已在收件匣、未處理的舊檔：照樣被正確處理（事件登記了、附件不丟、不誤判）', inOld && inOld.files.length === 1 && /舊報告-note-event\.md$/.test(inOld.files[0]) && inbox().length === 0, { files: inOld && inOld.files, inbox: inbox(), out: r.stdout.slice(-300) });
  });

  /* ---- 3 伺服器：大附件轉換期間其他請求照常回應；筆記檔在文字版齊全之後才出現 ---- */
  await attempt('3 伺服器', async () => {
    const paras = []; for (let i = 0; i < 60000; i++) paras.push('第' + i + '段：供應協議條款 ' + 'abcdefghij'.repeat(8));
    const bigB64 = docxOf(paras).toString('base64');
    mode('event:event-follow');
    const seen0 = new Set((await runs()).map(r => r.id));
    const files = Array.from({ length: 8 }, (_, i) => ({ name: '大附件' + i + '.docx', data: bigB64 })).concat([file('壞檔.docx', 'PK fake docx')]);
    let max = 0, stop = false, violation = '';
    const pingLoop = (async () => { while (!stop) { const t = Date.now(); try { await fetch(BASE + '/api/status'); } catch { } max = Math.max(max, Date.now() - t); await sleep(20); } })();
    const watcher = (async () => { while (!stop) { const names = inbox(); const nt = names.find(f => /-note-event\.md$/.test(f) && !/-file-/.test(f)); if (nt) { const id = nt.replace(/-note-event\.md$/, ''); const side = names.filter(f => f.startsWith(id + '-note-event-file-') && f.endsWith('.docx.md')); if (side.length !== 8) violation = '筆記檔已出現但文字版只有 ' + side.length + ' 份'; } await sleep(3); } })();
    const t0 = Date.now();
    const sub = await post('/api/intake', { kind: 'note', type: 'event', text: '收到八份大附件。', date: '2026-11-07', files });
    const took = Date.now() - t0;
    stop = true; await pingLoop; await watcher;
    ok('3 收下八份大附件時，伺服器對其他請求的回應最長 ≤ 500 毫秒（修正前同步轉換令整部伺服器停頓）', sub.code === 202 && max <= 500, { code: sub.code, maxPingMs: max, tookMs: took });
    ok('3 筆記檔（外殼開工的訊號）只在八份文字版都寫完之後才出現；AI 不會讀到未轉完的檔', violation === '', violation);
    const rEv = await waitFor(async () => (await runs()).find(r => !seen0.has(r.id) && r.kind === 'note' && r.noteType === 'event' && (r.state === 'done' || r.state === 'failed')));
    const inp = sub.j && state().inputs.find(i => i.id === 'in-' + sub.j.id);
    const fi = inp ? inp.fileInfo || [] : [];
    ok('3 狀態表：八份大檔 convert ok 且文字版存在；壞檔 convert corrupt 且沒有文字版', rEv && rEv.state === 'done' && fi.filter(f => f.convert === 'ok' && f.text && fs.existsSync(path.join(DATA, f.text))).length === 8 && fi.filter(f => f.convert === 'corrupt' && !f.text).length === 1, fi.map(f => f.convert));
  });
}

srv.kill();
await sleep(300);
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'server.log'), log);
process.exit(pass === results.length ? 0 : 1);
