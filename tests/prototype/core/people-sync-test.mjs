// Zero 整理名單（0.40.1）：已升級舊公司（已確認概覽、舊類別、沒有團隊）→ 日常工作自動整理一次 → 待決事項最多 3 題 → 部分作答 → 答齊 → 團隊頁、已有人負責的事、--brief；
// 創辦人要求再整理（已拒絕不再問、重複觸發不重複出題）；重擬概覽不改名不重複（deriveActors）；全新公司由 Zero 擬的名單直接入帳（含團隊、顧問）。
// 逐行驗證 docs/evidence/people-fix-2026-11-07/chain.md 狀態表 P1–P19。假 AI、隔離資料夾；不開瀏覽器、不連外網。
// 用法：node people-sync-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { usePass, certify } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const P = await import(pathToFileURL(path.join(PROTO, 'people-ops.mjs')).href);
const brain = await import(pathToFileURL(path.join(PROTO, 'brain-lib.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
freshTestOut(OUT);
const DATA = path.join(OUT, 'data');
for (const d of ['company', 'ledger']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
oldInstall(DATA, PROTO);
const STATE = path.join(DATA, 'ledger', 'state.json'), PAGE = path.join(DATA, 'company', 'page.json'), CONF = path.join(DATA, 'ledger', 'confirmed.json');
const state = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const put = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const env = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', SOS_FAKE_ACTORS: '1' };
const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 90000 });
const packs = () => { const d = path.join(DATA, 'asks'); try { return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))); } catch { return []; } };
const syncPacks = () => packs().filter(p => p.peopleSync);
const BASE = `http://127.0.0.1:${PORT}`;
let srv = null, log = '';
// 負載下伺服器可能暫時連不上（fetch failed）：讀取重試三次
const tryFetch = async (u, o) => { let last; for (let i = 0; i < 4; i++) { try { return await fetch(u, { ...o, signal: AbortSignal.timeout(20000) }); } catch (e) { last = e; await sleep(700 * (i + 1)); } } throw last; };
const get = async p => (await tryFetch(BASE + p)).json();
const post = async (p, body) => { const r = await tryFetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const waitFor = async (fn, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; };
const shown = Q => [Q.title, Q.context, ...Q.questions.flatMap(q => [q.ask, q.judge, q.why, q.value, ...(q.options || []).map(o => o.text)])];
const styleHits = texts => texts.flatMap(t => N.styleIssues(String(t || '')).map(h => h.term)).concat(texts.filter(t => /Founder Desk|pr-|pc-|tm-|\b\d{1,2}-\d{1,2}\b/.test(String(t || ''))).map(t => '內部字眼：' + t));
// 作答：只答 pick 回傳非 undefined 的題（部分作答）
async function answer(Q, pick) {
  const answers = Q.questions.map(q => ({ q, v: pick(q) })).filter(x => x.v !== undefined).map(({ q, v }) => ({ id: q.id, value: v, ai: q.value, changed: v !== q.value }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: Q.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + Q.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(Q) : lib.fnv(JSON.stringify(Q))), 'batch: ' + (answers.length < Q.questions.length), 'shownAt: ' + lib.localIso()];
  const r = await post('/api/submit', { kind: 'ask-answer', ref: Q.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  await sleep(3500); shell();
  return r;
}
const G6 = '願景及方向：我自己（李大文）；送貨及日常營運：我自己及 陳小明（2026 年 11 月 6 日已答應加入）；農務顧問：王伯（顧問，不負責營運）；銷售跟進：未有';
const TODAY = new Date().toISOString().slice(0, 10);

try {
  /* ---- 純函數：觸發條件、核對、創辦人本人、已拒絕 ---- */
  {
    const base = { ledgerFrom: 'p1', intake: { confirmedAt: '2026-11-06T10:00:00' }, company: { actors: [{ id: 'pr-1', name: '甲', kind: '客戶' }] } };
    ok('P1 觸發：已確認概覽、沒有成員 → auto；key 含概覽版本', P.peopleSyncDue(base).due === 'auto' && P.peopleSyncDue(base).key === 'p1|2026-11-06T10:00:00');
    ok('P2 同版已整理 → 不再觸發；P16 概覽換版（新 ledgerFrom）→ 再觸發', P.peopleSyncDue({ ...base, peopleSync: { for: 'p1|2026-11-06T10:00:00' } }).due === '' && P.peopleSyncDue({ ...base, ledgerFrom: 'p2', peopleSync: { for: 'p1|2026-11-06T10:00:00' } }).due === 'auto');
    ok('已有成員且沒有舊對象 → 不自動觸發；有舊對象（沒有 addedFrom）仍觸發', P.peopleSyncDue({ ...base, company: { actors: [{ id: 't', name: '乙', kind: 'team', addedFrom: 'overview', team: { state: 'active' } }] } }).due === '' && P.peopleSyncDue({ ...base, company: { actors: [{ id: 't', name: '乙', kind: 'team', addedFrom: 'overview', team: { state: 'active' } }, { id: 'pr-1', name: '甲', kind: '客戶' }] } }).due === 'auto');
    ok('P3 創辦人要求 → manual；P4 已有未答的題 → 不觸發；P11 有擱置項目 → batch（不開 AI）', P.peopleSyncDue({ ...base, peopleSync: { for: 'p1|2026-11-06T10:00:00', requested: true } }).due === 'manual' && P.peopleSyncDue({ ...base, peopleSync: { requested: true } }, { packOpen: true }).due === '' && P.peopleSyncDue({ ...base, peopleSync: { for: 'x', pending: [{ kind: 'newActor' }] } }).due === 'batch');
    ok('P17 示範帳本、未確認概覽 → 不觸發', P.peopleSyncDue({ ...base, demo: true }).due === '' && P.peopleSyncDue({ company: {} }).due === '');
    ok('founderNamesIn：抽「我自己（X）」括號內的名字，多個以「及」「、」分開', P.founderNamesIn(G6).join() === '李大文' && P.founderNamesIn('負責：我自己（陳大文及李小明）').join() === '陳大文,李小明' && P.founderNamesIn('沒有').length === 0);
    const actors = [{ id: 'pr-1', name: '甲餐廳陳經理', kind: '客戶', aliases: [] }, { id: 'pr-2', name: '丙農場主', kind: 'partner', aliases: ['農場主丙'], addedFrom: 'overview' }];
    const texts = [G6, '甲餐廳陳經理', '丙農場主'];
    const chk = (items, o = {}) => P.checkPeopleSync({ items }, { actors, texts, founderNames: P.founderNamesIn(G6), ...o });
    const good = chk([{ kind: 'actorKind', name: '甲餐廳陳經理', actorKind: 'advisor', why: 'x' }, { kind: 'newActor', name: '王伯', role: '顧問', actorKind: 'advisor', why: 'y' }, { kind: 'newActor', name: '陳小明', role: '送貨', actorKind: 'team', teamType: 'fulltime', why: 'z' }]);
    ok('核對：合規項目通過，次序成員＞顧問＞改類別', good.ok && good.items.map(x => x.kind + ':' + (x.name)).join() === 'newActor:陳小明,newActor:王伯,actorKind:甲餐廳陳經理' && good.items[2].from === 'customer' && good.items[2].id === 'pr-1');
    ok('P13 創辦人本人（我自己／李大文）→ 丟棄，不出題', chk([{ kind: 'newActor', name: '李大文', role: 'x', actorKind: 'team', teamType: 'cofounder', why: 'y' }, { kind: 'newActor', name: '我自己', role: 'x', actorKind: 'team', teamType: 'cofounder', why: 'y' }]).items.length === 0 && chk([{ kind: 'newActor', name: '李大文', role: 'x', actorKind: 'team', teamType: 'cofounder', why: 'y' }]).dropped[0].reason === 'founder');
    ok('P12 名稱不在概覽原文 → 退回修正；lenient 時丟棄', !chk([{ kind: 'newActor', name: '周先生', role: 'x', actorKind: 'team', teamType: 'parttime', why: 'y' }]).ok && chk([{ kind: 'newActor', name: '周先生', role: 'x', actorKind: 'team', teamType: 'parttime', why: 'y' }], { lenient: true }).ok);
    ok('P14 名稱已在名單（含別名）→ 丟棄', chk([{ kind: 'newActor', name: '農場主丙', actorKind: 'partner', why: 'y' }]).dropped[0].reason === 'duplicate');
    ok('P6 已答「不加入」的名稱 → 整理名單一次即不再問；事件路徑要兩次', chk([{ kind: 'newActor', name: '王伯', role: '顧問', actorKind: 'advisor', why: 'y' }], { declined: { [P.norm('王伯')]: 1 } }).dropped[0].reason === 'declined' && P.checkNewActorItem({ kind: 'newActor', name: '王伯', actorKind: 'advisor', why: 'y' }, { actors, texts, declined: { [P.norm('王伯')]: 1 } }).status === 'ok' && P.checkNewActorItem({ kind: 'newActor', name: '王伯', actorKind: 'advisor', why: 'y' }, { actors, texts, declined: { [P.norm('王伯')]: 2 } }).status === 'drop');
    ok('P15 改類別：對象不存在／類別相同／改成員沒有角色／曾答維持 → 丟棄或退回', chk([{ kind: 'actorKind', name: '沒有人', actorKind: 'advisor', why: 'y' }]).dropped[0].reason === 'notFound' && chk([{ kind: 'actorKind', name: '丙農場主', actorKind: 'partner', why: 'y' }]).dropped[0].reason === 'sameKind' && !chk([{ kind: 'actorKind', name: '丙農場主', actorKind: 'team', why: 'y' }]).ok && chk([{ kind: 'actorKind', name: '丙農場主', actorKind: 'advisor', why: 'y' }], { declined: { 'kind:pr-2:advisor': 1 } }).dropped[0].reason === 'declined');
    ok('P8 改類別套用：改為成員時先寫建議的角色；已合併者原樣', (() => { const s = { company: { actors: [{ id: 'pr-2', name: '丙農場主', kind: 'partner', aliases: [] }] } }; const r = P.applyKindFix(s, { id: 'pr-2', kind: 'team', role: '農務' }); return r.company.actors[0].kind === 'team' && r.company.actors[0].role === '農務' && r.company.actors[0].team.state === 'active' && P.applyKindFix({ company: { actors: [{ id: 'x', name: 'x', mergedInto: 'y' }] } }, { id: 'x', kind: 'advisor' }).company.actors[0].kind === undefined; })());
    ok('邊界：聯絡方式（電郵、長數字）退回', !chk([{ kind: 'newActor', name: '王伯', role: '顧問 91234567', actorKind: 'advisor', why: 'y' }]).ok);
  }
  /* ---- (c) 重擬概覽：deriveActors 名稱優先，不按編號改名、不重複 ---- */
  {
    const page = items => ({ detail: { actors: { items: items.map(it => ({ kind: 'text', value: '', origin: 'ai', ...it })) } } });
    const old = [{ id: 'pr-act-1', name: '學校校長', label: '學校校長', kind: 'customer', aliases: [], status: 'active', fromMilestoneIds: [], addedFrom: 'overview' }, { id: 'pr-act-2', name: 'Amy Wong', label: 'Amy Wong（丁報社）', kind: 'partner', aliases: [], status: 'active', fromMilestoneIds: [], addedFrom: 'overview' }, { id: 'pc-ev-q1', name: '黃小姐', label: '黃小姐', kind: 'customer', aliases: [], status: 'active', fromMilestoneIds: [], addedFrom: 'event' }];
    const next = brain.deriveActors(page([{ id: 'act-1', label: 'Amy Wong（丁報社）' }, { id: 'act-2', label: '周大文', actorKind: 'team', role: '營運', team: { type: 'fulltime', owns: [] } }, { id: 'act-3', label: '黃小姐（乙餐廳負責人）' }]), [], old, { today: TODAY });
    ok('C1 再版概覽 act-1 換了人：舊 pr-act-1 不被改名；Amy Wong 不重複；新成員周大文加入並帶 team', next.find(a => a.id === 'pr-act-1').name === '學校校長' && next.filter(a => a.name === 'Amy Wong').length === 1 && (t => t && t.kind === 'team' && t.team.type === 'fulltime' && t.role === '營運' && t.addedFrom === 'overview')(next.find(a => a.name === '周大文')), next.map(a => a.id + ':' + a.name));
    ok('C2 事件加入的「黃小姐」對頁面「黃小姐（乙餐廳負責人）」：同一人，不重複新增', next.filter(a => a.name === '黃小姐').length === 1 && next.length === old.length + 1);
    ok('C1 新對象配新編號，不覆蓋舊編號', next.find(a => a.name === '周大文').id !== 'pr-act-2' && new Set(next.map(a => a.id)).size === next.length);
    // 同名不同人：機構不同即另一個人；同頁兩項同名各自保留、label 不互相覆蓋；不再接觸者的 label 不改
    const two = page([{ id: 'act-1', label: '陳先生（甲餐廳）', actorKind: 'customer' }, { id: 'act-2', label: '陳先生（乙供應商）', actorKind: 'partner' }]);
    const r1 = brain.deriveActors(two, [], [], { today: TODAY }), r2 = brain.deriveActors(two, [], r1, { today: TODAY });
    ok('C3 同頁兩個陳先生：各自保留；再同步同一頁不新增、label 不互相覆蓋', r1.length === 2 && r2.length === 2 && r2[0].label === '陳先生（甲餐廳）' && r2[1].label === '陳先生（乙供應商）' && r2[0].kind === 'customer' && r2[1].kind === 'partner', r2.map(a => a.label));
    const r3 = brain.deriveActors(page([{ id: 'act-1', label: '陳先生（丙學校）', actorKind: 'customer' }]), [], r1, { today: TODAY });
    ok('C3 重擬概覽出現「陳先生（丙學校）」：機構不同，當作另一個人新增，舊兩位不改', r3.length === 3 && r3[0].label === '陳先生（甲餐廳）' && r3[1].label === '陳先生（乙供應商）' && r3[2].label === '陳先生（丙學校）', r3.map(a => a.id + ':' + a.label));
    const ex = [{ id: 'pr-1', name: '黃美玲', label: '黃美玲', aliases: ['黃小姐'], kind: 'customer', status: 'active', addedFrom: 'overview' }, { id: 'pc-1', name: '周大文', label: '周大文', aliases: [], kind: 'team', status: 'inactive', addedFrom: 'event' }, { id: 'pr-3', name: 'Amy', label: 'Amy', aliases: [], kind: 'partner', mergedInto: 'pr-1', status: 'active' }];
    const r4 = brain.deriveActors(page([{ id: 'act-1', label: '黃小姐（乙餐廳負責人）', actorKind: 'customer' }, { id: 'act-2', label: '周大文（全職）', actorKind: 'team' }, { id: 'act-3', label: 'Amy（顧問）', actorKind: 'advisor' }, { id: 'act-4', label: '黃美玲', actorKind: 'customer' }]), [], ex, {});
    ok('C3 改過名（別名）、不再接觸、已合併者：都視為同一人不新增；不再接觸者的 label 與狀態不改；同一人以別名及本名各列一次不重複', r4.length === 3 && r4.find(a => a.id === 'pc-1').label === '周大文' && r4.find(a => a.id === 'pc-1').status === 'inactive' && r4.find(a => a.id === 'pr-3').mergedInto === 'pr-1' && r4.find(a => a.id === 'pr-1').name === '黃美玲', r4.map(a => [a.id, a.name, a.label, a.status]));
    ok('mixSpace：中英相鄰加空格，標點旁不加', P.mixSpace('公司概覽提到Amy Wong（營運）：加入名單？') === '公司概覽提到 Amy Wong（營運）：加入名單？' && P.mixSpace('Amy目前記為客戶') === 'Amy 目前記為客戶' && P.mixSpace('陳小明目前') === '陳小明目前');
  }

  /* ---- 端到端：已升級舊公司 ---- */
  shell('--type', 'rhythm', '--trigger', 'manual');   // 先同步帳本（未認證 AI，不會開工）
  let s = state();
  ok('起點：帳本已由公司概覽同步，名單沒有成員', (s.milestones || []).length > 0 && !(s.company.actors || []).some(a => a.kind === 'team'), { ms: (s.milestones || []).length });
  // 放入 G6 原文（頁面一行＋確認值）及兩個舊格式對象（沒有 addedFrom，kind 為舊字串）
  const page = JSON.parse(fs.readFileSync(PAGE, 'utf8')), conf = JSON.parse(fs.readFileSync(CONF, 'utf8'));
  page.glance.rows.push({ id: 'g6', plan: 'G6', label: '已有人負責的事', kind: 'text', value: G6, origin: 'ai' });
  conf.values.g6 = G6;
  fs.writeFileSync(PAGE, JSON.stringify(page, null, 2)); fs.writeFileSync(CONF, JSON.stringify(conf, null, 2));
  s = state();
  s.company.actors = [{ id: 'pr-a1', name: '甲餐廳陳經理', label: '甲餐廳陳經理', kind: '客戶', fromMilestoneIds: [] }, { id: 'pr-a2', name: '丙農場主', label: '丙農場主', kind: '供應', fromMilestoneIds: [] }];
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  put(s);
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  await usePass(BASE);
  const cert = await certify(BASE, 'test');
  ok('假 AI 認證通過', cert.certify && cert.certify.state === 'passed', cert.certify && cert.certify.state);
  const d0 = await get('/api/dashboard');
  ok('整理前：團隊頁入口狀態為可要求（idle）；監察台 people.sync 存在', d0.people && d0.people.sync && d0.people.sync.state === 'idle', d0.people && d0.people.sync);
  // 日常工作：自動整理一次
  const r1 = shell('--type', 'rhythm', '--trigger', 'manual');
  s = state();
  let sp = syncPacks();
  ok('P1 日常工作自動整理一次：出一包「Zero 整理名單」，最多 3 題', sp.length === 1 && sp[0].questions.length === 3 && sp[0].title === N.ui.peopleSyncTitle, { n: sp.length, qs: sp[0] && sp[0].questions.map(q => q.ask), out: r1.stdout.slice(-400) });
  const Q1 = sp[0];
  ok('題目次序：團隊成員（陳小明）＞顧問（王伯）＞改類別（甲餐廳陳經理→顧問或協助者）；成員帶全職', Q1 && /陳小明/.test(Q1.questions[0].ask) && Q1.questions[0].options[0].apply.item.actorKind === 'team' && Q1.questions[0].options[0].apply.item.teamType === 'fulltime' && /王伯/.test(Q1.questions[1].ask) && Q1.questions[1].options[0].apply.item.actorKind === 'advisor' && Q1.questions[2].options[0].apply.op === 'fixKind' && Q1.questions[2].ask === N.t('peopleSyncKindAsk', { n: '甲餐廳陳經理', a: N.dash.ppl_kind_customer, b: N.dash.ppl_kind_advisor }), Q1 && Q1.questions.map(q => q.ask + ' | ' + q.options.map(o => o.text).join('/')));
  ok('P13 創辦人本人（我自己／李大文）沒有成為題目', Q1 && !shown(Q1).some(t => /李大文|我自己/.test(String(t))));
  ok('題目問句用「公司概覽提到」，畫面文字零內部術語、零編號、零短日期', Q1 && Q1.questions[0].ask === N.t('peopleSyncAsk', { who: '陳小明（送貨及日常營運）' }) && !styleHits(shown(Q1)).length, Q1 && styleHits(shown(Q1)));
  ok('P1 狀態：peopleSync.for 記此版概覽；沒有擱置；packId 指向這一包', s.peopleSync && s.peopleSync.for === P.peopleSyncKey(s) && (s.peopleSync.pending || []).length === 0 && s.peopleSync.packId === Q1.id, s.peopleSync);
  ok('名單在確認前不變（舊對象仍是兩個，類別只機械對應）', s.company.actors.length === 2 && s.company.actors.every(a => ['customer', 'partner'].includes(a.kind)));
  shell('--type', 'rhythm', '--trigger', 'manual');
  ok('P2／P4 重複觸發：同版概覽、已有未答的題 → 不再出題、不開第二包', syncPacks().length === 1, syncPacks().map(p => p.id));
  const d1 = await get('/api/dashboard');
  ok('團隊頁入口：已擬好 3 條題（asked），連到待決事項', d1.people.sync.state === 'asked' && d1.people.sync.packId === Q1.id && d1.people.sync.count === 3, d1.people.sync);
  const rq = await post('/api/founder-op', { op: 'peopleSync', target: 'people', value: {} });
  ok('已有未答的題時再按「請 Zero 整理名單」：拒絕', rq.code === 400, rq);
  /* P10 部分作答：只答第一題「加入」 */
  const a1 = await answer(Q1, q => q.id === 'q1' ? q.options[0].text : undefined);
  s = state();
  const tm = s.company.actors.find(a => a.name === '陳小明');
  ok('P5／P10 只答一題：陳小明加入名單（成員、全職、角色、來源公司概覽、固定編號）；其餘兩題仍待答；不放新包', a1.code === 200 && tm && tm.kind === 'team' && tm.team.type === 'fulltime' && tm.team.state === 'active' && tm.role === '送貨及日常營運' && tm.addedFrom === 'overview' && tm.id === P.nextActorId(Q1.id, 'q1') && syncPacks().length === 1 && s.peopleSync.packId === Q1.id, tm);
  ok('P5 事件一筆「已加入名單：陳小明（團隊成員）」', (s.events || []).some(e => e.title === N.t('peopleAdded', { n: '陳小明', k: N.dash.ppl_kind_team })));
  /* 答齊：王伯「不加入」、類別「維持」 */
  const a2 = await answer(Q1, q => q.id === 'q2' ? N.ui.newActorNo : q.id === 'q3' ? q.options[1].text : undefined);
  s = state();
  ok('P6／P9 答「不加入」記入 declined；答「維持」記入 declined（類別）；名單不變', a2.code === 200 && s.peopleSync.declined[P.norm('王伯')] === 1 && s.peopleSync.declined['kind:pr-a1:advisor'] === 1 && !s.company.actors.some(a => a.name === '王伯') && s.company.actors.find(a => a.id === 'pr-a1').kind === 'customer', s.peopleSync.declined);
  ok('答齊後 packId 清空；同一題不套用兩次（applied 記錄）', !s.peopleSync.packId && (s.peopleSync.applied[Q1.id] || []).length === 3, s.peopleSync.applied);
  ok('冪等：再跑外殼，陳小明仍只有一個', (shell(), state().company.actors.filter(a => a.name === '陳小明').length === 1));
  /* 下游 */
  const d2 = await get('/api/dashboard');
  ok('團隊頁：陳小明在成員清單；已有人負責的事由名單生成（有他一行）；入口回到可再要求（done）', d2.people.team.some(m => m.name === '陳小明') && d2.people.ownership && d2.people.ownership.lines.some(l => l.name === '陳小明') && d2.people.sync.state === 'done', { team: d2.people.team.map(m => m.name), own: d2.people.ownership, sync: d2.people.sync });
  const brief = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--brief'], { cwd: PROTO, env, encoding: 'utf8', timeout: 60000 }).stdout;
  ok('--brief：團隊成員一行有陳小明（角色），不印編號', /團隊成員：陳小明（送貨及日常營運/.test(brief) && !/pc-|pr-a/.test(brief), brief.split('\n').filter(l => /團隊/.test(l)));
  /* P3 創辦人要求再整理：假 AI 再提王伯及改類別 → 全部因已拒絕而丟棄 → 零項目 */
  const runsBefore = new Set(((await get('/api/status')).runs || []).map(r => r.id)), atBefore = state().peopleSync.at;
  const rq2 = await post('/api/founder-op', { op: 'peopleSync', target: 'people', value: {} });
  ok('P3 按「請 Zero 整理名單」：接受（已整理過仍可再要求）', rq2.code === 202, rq2);
  const d3 = await waitFor(async () => { const d = await get('/api/dashboard'); return d.people.sync.state === 'requested' ? d : null; }, 5000);
  ok('按下後入口即顯示「整理中」（requested）', !!d3, d3 && d3.people.sync);
  // 伺服器按鍵後即叫外殼（不等下一次日常工作）：等新一次外殼完成、整理時間更新
  const done3 = await waitFor(async () => { const st = state(); const runs = ((await get('/api/status')).runs || []).filter(r => !runsBefore.has(r.id) && r.state !== 'running'); return runs.length && st.peopleSync && !st.peopleSync.requested && st.peopleSync.at !== atBefore ? st : null; }, 40000);
  s = state();
  ok('P6／P18 再整理：王伯及類別建議因已拒絕而丟棄，Zero 交回零項目 → 不出新題，事件「沒有需要補充」', done3 && syncPacks().length === 1 && (s.events || []).some(e => e.title === N.ui.peopleSyncNone), { packs: syncPacks().length, ev: (s.events || []).slice(-3).map(e => e.title) });
  const d4 = await get('/api/dashboard');
  ok('整理後入口：已整理（done），帶日期', d4.people.sync.state === 'done' && d4.people.sync.at, d4.people.sync);
  { const rr = (s.runs || []).filter(r => !runsBefore.has(r.id) && r.type === 'inbox'); ok('按鍵觸發的整理名單 run 記為 Zero 有開工（ended、aiStarted），不是「只套用答案」的跳過', rr.length === 1 && rr[0].state === 'ended' && rr[0].aiStarted === true && !rr[0].skipReason, rr.map(r => [r.id, r.state, r.skipReason, r.aiStarted]));
    ok('整理成功但零項目：收尾值 checked（完成類，顯示名「已核對，名單沒有缺口」），不是 blocked 或 advanced', rr.length === 1 && rr[0].ending === 'checked' && N.ui.runEnd_checked === '已核對，名單沒有缺口', rr.map(r => r.ending)); }
  { const rq0 = (s.runs || []).find(r => r.id === Q1.fromRun || (r.placed || []).includes(Q1.id)); ok('整理成功並出題：收尾值 asked', !rq0 || rq0.ending === 'asked', rq0 && rq0.ending); }
  ok('整理名單的創辦人操作事件標題正確（不是「取消暫停」）', (s.events || []).some(e => e.type === 'founder-op' && e.title === N.ui.peopleSyncRequested) && !(s.events || []).some(e => e.type === 'founder-op' && /取消暫停/.test(e.title)));
  /* P11 擱置分批：直接放 5 項擱置，答齊一包後自動放下一包 */
  s = state();
  s.peopleSync.pending = ['甲', '乙', '丙', '丁', '戊'].map((n, i) => ({ kind: 'newActor', name: '擱置' + n, role: '測試', actorKind: 'advisor', why: '測試擱置項目 ' + (i + 1) }));
  s.peopleSync.packId = ''; s.peopleSync.requested = false; put(s);
  shell();
  let sp2 = syncPacks().filter(p => p.id !== Q1.id);
  ok('P11 有擱置項目、沒有未答的題：機械放一包 3 題，不開 AI；餘 2 項仍擱置', sp2.length === 1 && sp2[0].questions.length === 3 && state().peopleSync.pending.length === 2, sp2.map(p => p.questions.length));
  await answer(sp2[0], q => N.ui.newActorNo);
  sp2 = syncPacks().filter(p => p.id !== Q1.id);
  ok('P11 一包答齊後自動放下一包（2 題），擱置清空', sp2.length === 2 && sp2.some(p => p.questions.length === 2) && state().peopleSync.pending.length === 0, sp2.map(p => p.questions.length));
  { const last = sp2.find(p => p.questions.length === 2); if (last) await answer(last, q => N.ui.newActorNo); }
  ok('P11 第二包答齊後沒有再放包，packId 清空', syncPacks().filter(p => p.id !== Q1.id).length === 2 && !state().peopleSync.packId, state().peopleSync.packId);
  /* P7 擱置項目放出時重新核對：已在名單或已拒絕的不再問 */
  s = state(); s.peopleSync.pending = [{ kind: 'newActor', name: '陳小明', role: '送貨', actorKind: 'team', teamType: 'parttime', why: '測試：已在名單' }, { kind: 'newActor', name: '王伯', role: '顧問', actorKind: 'advisor', why: '測試：已拒絕' }, { kind: 'actorKind', id: 'pr-a1', name: '甲餐廳陳經理', from: 'customer', actorKind: 'advisor', why: '測試：已答維持' }, { kind: 'newActor', name: '擱置己', role: '測試', actorKind: 'advisor', why: '測試：仍要問' }]; s.peopleSync.packId = ''; s.peopleSync.requested = false; put(s);
  shell();
  { const pk = syncPacks().find(p => p.id === state().peopleSync.packId); ok('P7 放出擱置題時重新核對：已在名單、已拒絕、已答維持的不再問，只剩一題', pk && pk.questions.length === 1 && /擱置己/.test(pk.questions[0].ask) && state().peopleSync.pending.length === 0, pk && pk.questions.map(q => q.ask)); if (pk) await answer(pk, q => N.ui.newActorNo); }
  /* 0.40.2 修正 8：自訂答案（答案不在選項內）不是「不加入」：記下原話，這一項下一批再問一次（只問一次） */
  s = state(); s.peopleSync.pending = [{ kind: 'newActor', name: '自訂甲', role: '測試', actorKind: 'advisor', why: '測試：自訂答案' }]; s.peopleSync.packId = ''; s.peopleSync.requested = false; put(s);
  shell();
  const pkC = syncPacks().find(p => p.id === state().peopleSync.packId);
  ok('8 前提：放出一題「自訂甲」', pkC && pkC.questions.length === 1 && /自訂甲/.test(pkC.questions[0].ask), pkC && pkC.questions.map(q => q.ask));
  const words = '先不決定，等下個月見過他再說';
  await answer(pkC, q => words);
  s = state();
  const pkC2 = syncPacks().find(p => p.id === s.peopleSync.packId);
  ok('8 自訂答案不算拒絕：沒有記入 declined，也沒有加入名單', !s.peopleSync.declined[P.norm('自訂甲')] && !s.company.actors.some(a => a.name === '自訂甲'), s.peopleSync.declined);
  ok('8 記下創辦人原話（事件）', (s.events || []).some(e => e.title.includes('自訂甲') && e.title.includes(words)), (s.events || []).slice(-3).map(e => e.title));
  ok('8 這一項留待下一批再問一次：新一包仍是「自訂甲」，reasked 記為 1', pkC2 && pkC2.id !== pkC.id && /自訂甲/.test(pkC2.questions[0].ask) && s.peopleSync.reasked && s.peopleSync.reasked[P.norm('自訂甲')] === 1, { reasked: s.peopleSync.reasked, pk: pkC2 && pkC2.id });
  const nSyncPacks = syncPacks().length;
  await answer(pkC2, q => '還是再想想');
  s = state();
  // 0.44.0：第二次自訂答案只結束這一題，不再以 reasked === 2 永久封鎖名稱（名稱鍵不留）；之後事件再提到同名照常出題（見 people-match-flow-test.mjs PM-6）
  ok('8 第二次仍用自訂答案：這一題結束（沒有新包、擱置清空）、仍不算拒絕、再記下原話（peopleCustomClosed）、名稱不留封鎖', syncPacks().length === nSyncPacks && s.peopleSync.pending.length === 0 && !s.peopleSync.packId && !s.peopleSync.declined[P.norm('自訂甲')] && !(s.peopleSync.reasked || {})[P.norm('自訂甲')] && (s.events || []).some(e => e.title === N.t('peopleCustomClosed', { n: '自訂甲', s: '還是再想想' })), { packs: syncPacks().length, pending: s.peopleSync.pending, reasked: s.peopleSync.reasked, ev: (s.events || []).slice(-2).map(e => e.title) });
  ok('8 自訂答案的事件句不含內部編號及短日期', !styleHits((s.events || []).filter(e => e.title.includes('自訂甲')).map(e => e.title)).length);
  // 改類別題：自訂答案不算「維持」，下一批再問；之後選「改為」照常套用
  s = state(); s.peopleSync.pending = [{ kind: 'actorKind', id: 'pr-a2', name: '丙農場主', from: 'partner', actorKind: 'advisor', why: '測試：改類別自訂答案' }]; s.peopleSync.packId = ''; put(s);
  shell();
  const pkK = syncPacks().find(p => p.id === state().peopleSync.packId);
  await answer(pkK, q => '要先問過農場主本人');
  s = state();
  const pkK2 = syncPacks().find(p => p.id === s.peopleSync.packId);
  ok('8 改類別題的自訂答案：不記入 declined（不算維持）、類別沒變、下一批再問一次', !s.peopleSync.declined['kind:pr-a2:advisor'] && s.company.actors.find(a => a.id === 'pr-a2').kind === 'partner' && pkK2 && pkK2.id !== pkK.id && /丙農場主/.test(pkK2.questions[0].ask), { declined: s.peopleSync.declined, pk: pkK2 && pkK2.id });
  if (pkK2) await answer(pkK2, q => q.options[0].text);
  ok('8 再問時選「改為」：照常套用（丙農場主改為顧問或協助者）', state().company.actors.find(a => a.id === 'pr-a2').kind === 'advisor');
  /* 0.40.2 修正 9：擱置項目放出時全部失效（名單沒有缺口）→ 收尾「已核對」，不記失敗 */
  s = state(); s.peopleSync.pending = [{ kind: 'newActor', name: '陳小明', role: '送貨', actorKind: 'team', teamType: 'parttime', why: '測試：已在名單' }, { kind: 'newActor', name: '王伯', role: '顧問', actorKind: 'advisor', why: '測試：已拒絕' }]; s.peopleSync.packId = ''; s.peopleSync.requested = false; put(s);
  const runIds9 = new Set(((await get('/api/status')).runs || []).map(r => r.id)), ledgerRuns9 = new Set((state().runs || []).map(r => r.id)), nPacks9 = syncPacks().length;
  const r9 = shell();
  const new9 = ((await get('/api/status')).runs || []).filter(r => !runIds9.has(r.id));
  const led9 = (state().runs || []).filter(r => !ledgerRuns9.has(r.id));
  ok('9 全部擱置項目已失效：外殼這次工作不是失敗（狀態 done、沒有錯誤）', new9.length === 1 && new9[0].state === 'done' && !new9[0].error, new9.map(r => [r.kind, r.state, r.error]));
  ok('9 帳本工作記錄收尾值是 checked（已核對，名單沒有缺口），不是 blocked，也沒有 rejected', led9.length === 1 && led9[0].ending === 'checked' && !led9[0].rejected, led9.map(r => [r.ending, r.rejected, r.rejectReason]));
  ok('9 沒有出新題；擱置清空；不留失敗原因（lastTry）', syncPacks().length === nPacks9 && state().peopleSync.pending.length === 0 && !state().peopleSync.lastTry, { packs: syncPacks().length - nPacks9, ps: state().peopleSync });
  /* P17 示範帳本：操作拒絕、入口不顯示 */
  s = state(); s.demo = true; put(s);
  const rd = await post('/api/founder-op', { op: 'peopleSync', target: 'people', value: {} });
  const d5 = await get('/api/dashboard');
  ok('P17 示範帳本：要求整理拒絕；入口狀態 none', rd.code === 400 && d5.people.sync.state === 'none', { rd: rd.code, sync: d5.people.sync });
  s = state(); delete s.demo; put(s);

  /* ---- AI 失敗：清 requested、畫面寫原因並恢復按鈕；無關操作不會再開 AI；自動路徑當日不再重試 ---- */
  const sbCount = () => { try { return fs.readdirSync(path.join(DATA, 'sandbox')).filter(f => f.endsWith('-people')).length; } catch { return 0; } };
  fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), Array(6).fill('people-sync:fail').join('\n') + '\n');
  const sb0 = sbCount(), rb0 = new Set(((await get('/api/status')).runs || []).map(r => r.id));
  const rf = await post('/api/founder-op', { op: 'peopleSync', target: 'people', value: {} });
  const fdone = await waitFor(async () => { const st = state(); const runs = ((await get('/api/status')).runs || []).filter(r => !rb0.has(r.id) && r.state !== 'running'); return runs.length && !st.peopleSync.requested ? st : null; }, 40000);
  const dF = await get('/api/dashboard');
  ok('AI 失敗：requested 清除，記下失敗原因；入口恢復按鈕（done／idle）並附一句原因', rf.code === 202 && fdone && fdone.peopleSync.lastTry && fdone.peopleSync.lastTry.reason && ['done', 'idle'].includes(dF.people.sync.state) && dF.people.sync.failed === fdone.peopleSync.lastTry.reason && sbCount() === sb0 + 1, { sync: dF.people.sync, lastTry: fdone && fdone.peopleSync.lastTry, sb: sbCount() - sb0 });
  const free2 = state().company.actors.find(a => a.kind !== 'team' && !a.mergedInto);
  for (let i = 0; i < 2; i++) { await post('/api/founder-op', { op: 'actorRename', target: free2.id, value: { name: free2.name + (i ? '' : '乙') } }); await sleep(3000); }
  ok('失敗後的無關創辦人操作不會再開 AI', sbCount() === sb0 + 1 && !state().peopleSync.requested, { sb: sbCount() - sb0 });
  const rf2 = await post('/api/founder-op', { op: 'peopleSync', target: 'people', value: {} });
  ok('失敗後創辦人可以再按「請 Zero 整理名單」', rf2.code === 202, rf2);
  // 等伺服器叫的那次外殼完全結束（run 不再 running）才改狀態，免得外殼收尾寫回蓋走測試寫的值
  const rb1 = new Set(((await get('/api/status')).runs || []).map(r => r.id));
  await waitFor(async () => { const runs = ((await get('/api/status')).runs || []).filter(r => !rb1.has(r.id)); return runs.length && runs.every(r => r.state !== 'running') && !state().peopleSync.requested; }, 40000);
  await sleep(1500);
  // 外殼的「今日」是本機日期（不是 UTC）
  const localDay = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  s = state(); s.peopleSync.for = 'old-version'; s.peopleSync.lastTry = { key: P.peopleSyncKey(s), day: localDay(), reason: '測試' }; put(s);
  const sb1 = sbCount(); shell('--type', 'rhythm', '--trigger', 'manual');
  ok('自動路徑：同一概覽版本當日已失敗 → 日常工作不再重試', sbCount() === sb1 && state().peopleSync.for === 'old-version', { sb: sbCount() - sb1 });
  s = state(); s.peopleSync.lastTry.day = '2000-01-01'; put(s);
  shell('--type', 'rhythm', '--trigger', 'manual');
  ok('自動路徑：隔日再試一次', sbCount() === sb1 + 1, { sb: sbCount() - sb1 });
  fs.rmSync(path.join(DATA, 'fake-mode.txt'), { force: true });
  s = state(); s.peopleSync.for = P.peopleSyncKey(s); delete s.peopleSync.lastTry; put(s);

  /* ---- 事件路徑：答「不加入」兩次後，同名不再建議 ---- */
  // 0.44.0：十分鐘內同文字、同日期、同附件的再次提交當作重複（只入庫一次）；三次見面是三件不同日子的事，日期由前天起逐日遞增至今日
  let roundsLeft = 3;
  const eventRound = async () => {
    const day = new Date(Date.now() - (--roundsLeft) * 86400000).toISOString().slice(0, 10);
    const ev = await post('/api/intake', { kind: 'note', type: 'event', text: '今日與乙餐廳黃小姐見面，她有興趣試單。', date: day, files: [] });
    const inp = await waitFor(async () => { const st = state(); const i = (st.inputs || []).find(x => x.id === 'in-' + ev.j.id); return i && ['awaitingFounder', 'processed'].includes(i.status) ? i : null; }, 40000);
    const pk = inp && inp.packId ? packs().find(p => p.id === inp.packId) : null;
    return { inp, pk };
  };
  fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), ['event:event-actor', 'event:event-actor', 'event:event-actor'].join('\n') + '\n');
  const e1 = await eventRound();
  const naq = pk => pk && pk.questions.find(q => (q.options || []).some(o => o.apply && o.apply.op === 'addActor'));
  ok('事件路徑：Zero 建議的新對象（黃小姐）出確認題', !!naq(e1.pk), e1.pk && e1.pk.questions.map(q => q.ask));
  if (e1.pk) await answer(e1.pk, q => naq(e1.pk) === q ? N.ui.newActorNo : q.value);
  const e2 = await eventRound();
  ok('事件路徑：答「不加入」一次後同名仍會再問（可能改變主意）', state().peopleSync.declined[P.norm('黃小姐')] === 1 && !!naq(e2.pk), { declined: state().peopleSync.declined, qs: e2.pk && e2.pk.questions.map(q => q.ask) });
  if (e2.pk) await answer(e2.pk, q => naq(e2.pk) === q ? N.ui.newActorNo : q.value);
  const e3 = await eventRound();
  ok('事件路徑：答「不加入」兩次後，同名不再出題（外殼丟棄）', state().peopleSync.declined[P.norm('黃小姐')] === 2 && e3.inp && !naq(e3.pk), { declined: state().peopleSync.declined, qs: e3.pk && e3.pk.questions.map(q => q.ask), status: e3.inp && e3.inp.status });
  fs.rmSync(path.join(DATA, 'fake-mode.txt'), { force: true });

  /* ---- (b) 全新公司：告訴 Zero → Zero 擬概覽（含團隊、顧問）→ 確認 → 名單直接入帳 ---- */
  const DATA2 = path.join(OUT, 'data2'); for (const d of ['company', 'ledger']) fs.mkdirSync(path.join(DATA2, d), { recursive: true });
  const env2 = { ...env, SOS_DATA: DATA2 }, PORT2 = String(Number(PORT) + 1), BASE2 = `http://127.0.0.1:${PORT2}`;
  const srv2 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT2], { cwd: PROTO, env: env2, stdio: ['ignore', 'pipe', 'pipe'] });
  srv2.stdout.on('data', d => { log += d; }); srv2.stderr.on('data', d => { log += d; });
  try {
    await usePass(BASE2);
    await certify(BASE2, 'test');
    const post2 = async (p, body) => { const r = await fetch(BASE2 + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE2 }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
    const sub = await post2('/api/intake', { bizType: 'goods', fields: { q1: '把本地小農的當季蔬菜直送餐廳。送貨由表哥負責，阿明是餐飲業顧問。' }, files: [] });
    ok('(b) 告訴 Zero：收到', sub.code === 202, sub);
    const pg = await waitFor(async () => fs.existsSync(path.join(DATA2, 'company', 'page.json')) ? JSON.parse(fs.readFileSync(path.join(DATA2, 'company', 'page.json'), 'utf8')) : null, 40000);
    ok('(b) Zero 擬的公司概覽帶名單項目（合作方、團隊成員、顧問），外殼核對保留 actorKind、role、team', pg && pg.detail.actors.items.length === 3 && pg.detail.actors.items[1].actorKind === 'team' && pg.detail.actors.items[1].team.type === 'parttime' && pg.detail.actors.items[2].actorKind === 'advisor', pg && pg.detail.actors);
    // 校對確認（整頁照 Zero 擬的值）
    const values = {}; (function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'label' in o && 'value' in o) values[o.id] = String(o.value ?? ''); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); })(pg);
    const machine = { format: 'startup-os.proofread-reply/0.1', page: pg.page.id, company: pg.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: pg.path.milestones.map(m => m.id), orderProposed: pg.path.milestones.map(m => m.id), orderChanged: false, nextActionMilestone: pg.path.milestones[0].id, decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '' };
    const head = ['kind: proofread', 'ref: ' + pg.page.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(pg)), 'batch: false', 'shownAt: ' + lib.localIso()];
    const pr = await post2('/api/submit', { kind: 'proofread', ref: pg.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
    ok('(b) 校對確認：收到', pr.code === 200 || pr.code === 202, pr);
    const s2 = await waitFor(async () => { try { const st = JSON.parse(fs.readFileSync(path.join(DATA2, 'ledger', 'state.json'), 'utf8')); return (st.company && (st.company.actors || []).length) ? st : null; } catch { return null; } }, 40000);
    const team = s2 && s2.company.actors.find(a => a.name === '表哥'), adv = s2 && s2.company.actors.find(a => a.name === '阿明');
    ok('(b) 確認後名單：表哥是成員（兼職、送貨、負責第一站）、阿明是顧問、農場甲是合作方；類別及 team 欄保留', team && team.kind === 'team' && team.team.type === 'parttime' && team.role === '送貨' && team.team.owns.length === 1 && adv && adv.kind === 'advisor' && s2.company.actors.find(a => a.name === '農場甲').kind === 'partner', s2 && s2.company.actors);
    ok('(b) 已有成員且全部有來源 → 不自動排整理名單', s2 && P.peopleSyncDue(s2).due === '', s2 && P.peopleSyncDue(s2));
    const own = s2 && P.ownershipOf(s2);
    ok('(b) 已有人負責的事由名單生成：表哥一行帶第一站', own && own.lines.length === 1 && own.lines[0].name === '表哥' && own.lines[0].stations.length === 1, own);
  } finally { srv2.kill(); }
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  if (srv) srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 1200)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), log);
  process.exit(pass === results.length ? 0 : 1);
}
