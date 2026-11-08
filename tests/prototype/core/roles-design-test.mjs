// Zero 團隊分工（0.41.0 設計稿）情境測試：逐行驗證 docs/evidence/zero-roles-2026-11-08/state-table-041.md 狀態表 Z1–Z57，每行至少一條。
// 只測三個純函數模組（roles-ops.mjs、brief-lib.mjs、pace-lib.mjs）；不開伺服器、不開 AI、不寫任何資料夾。測試資料只用真實帳本有的欄位（站：order、state not_started、actorName）。
// 0.40.2 會改 people-ops.mjs（本測試經 roles-ops／pace-lib 間接依賴）：合併後須重跑本測試。
// 用法：node tests/prototype/core/roles-design-test.mjs（結束碼 0 ＝ 全過）
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(HERE, '..', '..', '..', 'prototypes', 'proofread');
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const R = await import(pathToFileURL(path.join(PROTO, 'roles-ops.mjs')).href);
const B = await import(pathToFileURL(path.join(PROTO, 'brief-lib.mjs')).href);
const P = await import(pathToFileURL(path.join(PROTO, 'pace-lib.mjs')).href);
const styleIssues = s => N.styleIssues(String(s || ''));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const ROWS = Array.from({ length: 58 }, (_, i) => 'Z' + (i + 1));
const TODAY = '2026-11-10', NOW = '2026-11-10T21:05:00';
const J = x => JSON.stringify(x);

/* ---------- 示範狀態：虛構公司「從田間到餐桌」；站的欄位形狀照 fixtures/demo-farm/state.json（order、state、actorName、pathStatus） ---------- */
function base() {
  return {
    ledgerFrom: 'pg-1', intake: { confirmedAt: '2026-11-01T10:00:00' }, demo: false,
    company: {
      actors: [
        { id: 'pc-lee', name: '李家欣', label: '李家欣', kind: 'team', role: '採購', aliases: [], status: 'active', addedFrom: 'overview', team: { type: 'cofounder', state: 'active', owns: ['m1'] } },
        { id: 'pc-chan', name: '陳志明', label: '陳志明', kind: 'advisor', role: '教育專業顧問', aliases: [], status: 'active', addedFrom: 'overview' },
        { id: 'pc-farm', name: '農場甲', label: '農場甲', kind: 'partner', aliases: ['甲農場'], status: 'active', addedFrom: 'overview' },
        { id: 'pc-rest', name: '餐廳乙', label: '餐廳乙', kind: 'customer', aliases: [], status: 'active', addedFrom: 'overview' },
        { id: 'pc-school', name: '學校', label: '學校', kind: 'customer', aliases: [], status: 'active', addedFrom: 'overview' }
      ],
      nextExternalAction: { text: '11 月 18 日與農場甲見面', date: '2026-11-18', milestoneId: 'm1' },
      rhythm: { runCadence: 'daily', runTime: '21:00' }
    },
    milestones: [
      { id: 'm1', short: '首間農場簽約', title: '首間農場簽約供應', event: '首間農場簽約供應', lineId: 'main', order: 1, pathStatus: 'confirmed', state: 'active', actorName: '農場甲', witness: '農場主', evidence: '簽署協議', deliveryCondition: '一份已簽的供應協議', targetDate: '2026-11-25' },
      { id: 'm2', short: '首間餐廳試單', title: '首間餐廳試單', event: '首間餐廳試單', lineId: 'main', order: 2, pathStatus: 'confirmed', state: 'not_started', actorName: '餐廳乙' },
      { id: 'm3', short: '三間餐廳恆常訂購', title: '三間餐廳恆常訂購', event: '三間餐廳恆常訂購', lineId: 'main', order: 3, pathStatus: 'confirmed', state: 'not_started', actorName: '餐廳乙、丙、丁' },
      { id: 'm4', short: '牌照及保險齊備', title: '牌照及保險齊備', event: '牌照及保險齊備', lineId: 'main', order: 4, pathStatus: 'confirmed', state: 'not_started', actorName: '發牌機關' }
    ],
    tasks: [
      { id: 't1', title: '農場甲會面簡介', owner: 'ai', milestoneId: 'm1', status: 'planned', updatedAt: '2026-11-09T10:00:00' },
      { id: 't2', title: '候選餐廳名單', owner: 'ai', milestoneId: 'm2', status: 'planned', updatedAt: '2026-11-09T10:00:00' },
      { id: 't3', title: '牌照要求查詢清單', owner: 'ai', milestoneId: 'm4', status: 'planned', updatedAt: '2026-11-09T10:00:00', prepFor: 'f1' },
      { id: 'f1', title: '致電發牌機關', owner: 'founder', milestoneId: 'm4', status: 'planned', dueAt: '2026-11-14' }
    ],
    inputs: [{ id: 'in-doc1', kind: 'inbox', via: 'doc', title: '農場甲供應量表', status: 'processed' }],
    health: { lastInputAt: '2026-11-10T08:00:00' }, runs: [], events: []
  };
}
// Zero 交回的三張崗位卡（合規；bounds 只寫加條）
const CARDS = {
  cards: [
    { title: '農場採購專員', mission: '替創辦人準備農場洽談所需的資料', milestoneIds: ['m1'], supports: ['pc-lee'], targets: ['partner'], how: ['整理農場資料及供應量', '準備簡介與條款草案'], strategy: '先把供應量與價格查清，令每次會面都可以即場簽約', sources: ['in-doc1', 'web'], deliverables: ['intro', 'proposal', 'checklist'], knowledge: [{ text: '農場甲每週可供應三百公斤', source: 'in-doc1' }], bounds: { tellAfter: ['整理農場名單'], askFirst: ['答應任何價錢'] }, activation: { title: '農場甲會面簡介', deliverable: '一頁簡介，列出供應量、價格範圍及要對方承諾的事', milestoneId: 'm1' } },
    { title: '餐廳拓展經理', mission: '找到願意試食與試單的餐廳', milestoneIds: ['m2', 'm3'], supports: [], targets: ['customer'], how: ['整理餐廳名單', '準備試食會流程'], strategy: '先由相熟餐廳入手，以試單換取恆常訂購', sources: ['web'], deliverables: ['message', 'intro', 'questions'], knowledge: [], activation: { title: '候選餐廳名單', deliverable: '十二間候選餐廳及接觸次序', milestoneId: 'm2' } },
    { title: '牌照及保險主任', mission: '查清牌照與保險要求，避免送菜前出現問題', milestoneIds: ['m4'], supports: ['pc-chan'], targets: [], how: ['整理查詢清單', '比較保險報價'], strategy: '先查公開資料，再向發牌機關確認', sources: ['web'], deliverables: ['checklist', 'research', 'questions'], knowledge: [{ text: '食物業牌照由食物環境衞生署簽發', source: 'https://www.fehd.gov.hk/' }], activation: { title: '牌照要求查詢清單', deliverable: '牌照及保險逐項清單連申請期限', milestoneId: 'm4' } }
  ],
  unassigned: []
};
const CTX = s => ({ state: s, styleIssues, inputIds: ['in-doc1'], first: true, today: TODAY });
// 把三張卡確認入帳並記擬崗位完成（Z4、Z1 的捷徑，供後面各行用）
function withCards(s = base()) {
  const chk = R.checkRoleCards(CARDS, CTX(s));
  let st = R.markRolesDrafted(s, { now: NOW, pending: [], unassigned: chk.unassigned, packId: 'ask-1' });
  chk.cards.forEach((c, i) => { st = R.applyRoleAnswer(st, { packId: 'ask-1', qid: 'q' + (i + 1), card: c, answer: 'accept', now: NOW, today: TODAY, styleIssues }); });
  return { state: st, cards: chk.cards, ids: st.teammates.map(t => t.id) };
}
const deep = x => JSON.parse(J(x));

try {
  /* ===== 甲、擬崗位、確認、啟用、暫停 ===== */
  { // Z1
    const s = base();
    ok('Z1 概覽已確認、未擬過、沒有崗位 → auto', R.rolesDue(s, { today: TODAY }).due === 'auto', R.rolesDue(s, { today: TODAY }));
    ok('Z1 示範實例不擬崗位', R.rolesDue({ ...s, demo: true }, { today: TODAY }).due === '');
    ok('Z1 此版已擬過 → 不再自動', R.rolesDue({ ...s, rolesSync: { for: R.rolesKey(s) } }, { today: TODAY }).due === '');
    ok('Z1 創辦人要求 → manual；有擱置卡 → batch；題目未答 → 不做', R.rolesDue({ ...s, rolesSync: { requested: true } }).due === 'manual' && R.rolesDue({ ...s, rolesSync: { pending: [{ title: 'x' }] } }).due === 'batch' && R.rolesDue({ ...s, rolesSync: { requested: true } }, { packOpen: true }).due === '');
    const failed = R.markRolesFailed(s, { today: TODAY, reason: 'AI 工具未能完成' });
    ok('Z1 當日失敗過 → 當日不再自動重試、翌日照做；requested 清掉', R.rolesDue(failed, { today: TODAY }).due === '' && R.rolesDue(failed, { today: '2026-11-11' }).due === 'auto' && failed.rolesSync.requested === false);
    const drafted = R.markRolesDrafted({ ...s, rolesSync: { requested: true, lastTry: { key: 'x', day: TODAY } } }, { now: NOW, pending: [], unassigned: [{ milestoneId: 'm4', why: '暫由統籌承擔' }] });
    ok('Z1 擬完即寫 for、清 requested 及 lastTry、記未分配站及站清單快照（必修 5）', drafted.rolesSync.for === R.rolesKey(s) && drafted.rolesSync.requested === false && !drafted.rolesSync.lastTry && drafted.rolesSync.unassigned[0].milestoneId === 'm4' && J(drafted.rolesSync.stationsAt) === J(['m1', 'm2', 'm3', 'm4']) && R.rolesDue(drafted, { today: TODAY }).due === '', drafted.rolesSync);
    ok('Z1 已有崗位卡 → 不自動擬', R.rolesDue(withCards().state, { today: TODAY }).due === '');
  }
  { // Z2
    const s = base(), good = R.checkRoleCards(CARDS, CTX(s));
    ok('Z2 三張合規卡通過；每站一個崗位；sources 一律含公司概覽；bounds 只寫加條亦通過並併入預設', good.ok && good.cards.length === 3 && good.cards.every(c => c.sources.includes('confirmedPage')) && good.cards[0].bounds.askFirst.includes('答應任何價錢') && good.cards[0].bounds.askFirst.length === R.PERMISSIONS_DEFAULT.askFirst.length + 1, good.errors);
    ok('Z2 頭像按職能機械配', good.cards.map(c => c.avatarKind).join() === 'procurement,outreach,compliance' && R.AVATAR_KINDS.length === 8, good.cards.map(c => c.avatarKind));
    const bad = (mut, name) => { const raw = deep(CARDS); mut(raw); const r = R.checkRoleCards(raw, CTX(s)); ok('Z2 ' + name + ' → 退回', !r.ok, r.errors); return r; };
    bad(r => { r.cards[0].parentId = 'x'; }, '含 parentId（子角色）');
    bad(r => { r.cards[0].milestoneIds = []; }, 'milestoneIds 為空');
    bad(r => { r.cards[1].milestoneIds = ['m1', 'm2']; }, '兩張卡同負責一站');
    bad(r => { r.cards[0].supports = ['pc-farm']; }, 'supports 指向合作方（非成員／顧問）');
    bad(r => { r.cards[0].knowledge = [{ text: '農場每週供三百公斤' }]; }, '知識背景沒有來源');
    bad(r => { r.cards[0].bounds = { tellAfter: 'x' }; }, 'bounds 不是清單');
    bad(r => { r.cards[0].title = '採購伙伴'; }, '稱號用「伙伴」且沒有職級');
    bad(r => { r.cards[0].title = '陳志明經理'; }, '稱號與名單真人相似');
    bad(r => { r.cards[0].title = '教育專業顧問'; }, '稱號用真人職銜');
    bad(r => { r.cards[0].title = 'Zero採購專員'; }, '稱號含 Zero');
    bad(r => { r.cards[0].title = '農場採購同埋物流專員'; }, '稱號有口語');
    bad(r => { r.cards[0].mission = '聯絡 farm@example.com'; }, '文字含聯絡方式');
    const five = r => { r.cards.push({ ...r.cards[2], title: '餐廳配送營運主任', milestoneIds: ['m3'] }); r.cards[1].milestoneIds = ['m2']; r.cards.push({ ...r.cards[2], title: '財務及融資主任', milestoneIds: ['m4'] }); r.cards[2].milestoneIds = ['m2']; };
    bad(five, '首次超過四張（第一次核對）');
    const raw5 = deep(CARDS); five(raw5); const r5 = R.checkRoleCards(raw5, { ...CTX(s), lenient: true });
    ok('Z2 第二次核對超過四張 → 逐張處理，只收前四張、其餘記下（覆核建議 c）', r5.ok && r5.cards.length <= 4 && r5.dropped.some(d => d.reason === '首次最多四個崗位'), r5.dropped);
    bad(r => { r.cards.pop(); }, '已確認站沒有崗位亦沒有說明（J1）');
    const un = deep(CARDS); un.cards.pop(); un.unassigned = [{ milestoneId: 'm4', why: '只有一站，待分工確定後再議，暫由統籌承擔' }];
    ok('Z2 未分配的站在 unassigned 說明 → 通過（J1：每站有且只有一個負責者，崗位或統籌）', R.checkRoleCards(un, CTX(s)).ok, R.checkRoleCards(un, CTX(s)).errors);
    const len = deep(CARDS); len.cards[0].parentId = 'x';
    const r2 = R.checkRoleCards(len, { ...CTX(s), lenient: true });
    ok('Z2 第二次（lenient）只丟棄不合格卡並記下', r2.ok && r2.cards.length === 2 && r2.dropped.length === 1, r2.dropped);
    const extra = R.checkRoleCards({ ...deep(CARDS), cards: [{ ...deep(CARDS).cards[0], title: '王大文採購專員' }] }, { ...CTX(s), extraNames: ['王大文'] });
    ok('Z2 稱號與擱置中的新對象相似 → 退回（J2）', !extra.ok && /擱置/.test(extra.errors[0]), extra.errors);
    ok('Z2 稱號只與真人比對，不與機構名比對：「學校拓展經理」在名單有「學校」仍通過（覆核建議 c）', R.checkTitle('學校拓展經理', { actors: s.company.actors, styleIssues }).ok && R.checkTitle('餐廳拓展經理', { actors: s.company.actors, styleIssues }).ok && !R.checkTitle('李家欣採購專員', { actors: s.company.actors, styleIssues }).ok);
  }
  { // Z3
    const s = base(), chk = R.checkRoleCards(CARDS, CTX(s));
    const four = [...chk.cards, { ...chk.cards[2], title: '財務及融資主任' }];
    const b = R.nextRoleBatch(four, {});
    ok('Z3 每批最多三題，第四張留 pending', b.items.length === 3 && b.rest.length === 1 && b.rest[0].title === '財務及融資主任');
    ok('Z3 已拒絕的稱號不再出題', R.nextRoleBatch(four, { 'title:財務及融資主任': 1 }).items.length === 3 && R.nextRoleBatch(four, { 'title:財務及融資主任': 1 }).rest.length === 0);
  }
  { // Z4
    const { state: s, cards } = withCards();
    const t = s.teammates[0];
    ok('Z4 確認「由 Zero 承擔」→ 新卡 planned、title 與 name 相同、繼承 bounds、有啟用任務', s.teammates.length === 3 && t.lifecycle === 'planned' && t.title === '農場採購專員' && t.name === t.title && t.bounds.askFirst.includes('答應任何價錢') && t.bounds.askFirst.length > R.PERMISSIONS_DEFAULT.askFirst.length && t.activationTaskId && s.tasks.some(x => x.id === t.activationTaskId && x.cadence === 'activation' && x.teammateId === t.id && x.milestoneId === 'm1'), t);
    const again = R.applyRoleAnswer(s, { packId: 'ask-1', qid: 'q1', card: cards[0], answer: 'accept', now: NOW, today: TODAY });
    ok('Z4 同一題套用兩次結果相同（冪等）', J(again) === J(s));
    const s0 = base(); const first = R.applyRoleAnswer(s0, { packId: 'ask-1', qid: 'q1', card: cards[0], answer: 'accept', now: NOW });
    const clash = R.applyRoleAnswer(first, { packId: 'ask-1', qid: 'q9', card: { ...cards[1], milestoneIds: ['m1'] }, answer: 'accept', now: NOW });
    ok('Z4 站已被同批先答的卡佔用 → 第二張不寫入', J(clash) === J(first));
    ok('Z4 不改其他站、路線及權限', J(s.milestones) === J(base().milestones) && !s.company.permissions);
  }
  { // Z5
    const s = base(), chk = R.checkRoleCards(CARDS, CTX(s));
    const ren = R.applyRoleAnswer(s, { packId: 'ask-1', qid: 'q1', card: chk.cards[0], answer: 'rename', newTitle: '農場供應採購主任', now: NOW, styleIssues });
    ok('Z5 改名合規 → 以新名寫卡', ren.teammates[0].title === '農場供應採購主任' && ren.teammates[0].name === '農場供應採購主任');
    const bad = R.applyRoleAnswer(s, { packId: 'ask-1', qid: 'q1', card: chk.cards[0], answer: 'rename', newTitle: '農場採購伙伴', now: NOW, styleIssues });
    ok('Z5 改名不合規 → 保留 Zero 的名並記原因', bad.teammates[0].title === '農場採購專員' && Object.values(bad.rolesSync.renameRejected)[0], bad.rolesSync);
    const bad2 = R.applyRoleAnswer(s, { packId: 'ask-1', qid: 'q1', card: chk.cards[0], answer: 'rename', newTitle: '李家欣採購專員', now: NOW, styleIssues });
    ok('Z5 改名與名單真人相似 → 保留 Zero 的名', bad2.teammates[0].title === '農場採購專員');
  }
  { // Z6
    const s = base(), chk = R.checkRoleCards(CARDS, CTX(s));
    const d = R.applyRoleAnswer({ ...s, rolesSync: { pending: chk.cards } }, { packId: 'ask-1', qid: 'q3', card: chk.cards[2], answer: 'decline' });
    ok('Z6 「不要這個崗位」→ 不寫卡；記稱號及站；擱置清單移除', (d.teammates || []).length === 0 && d.rolesSync.declined['title:牌照及保險主任'] === 1 && d.rolesSync.declined['station:m4'] === 1 && d.rolesSync.pending.length === 2, d.rolesSync);
    ok('Z6 再套用同一題不重複計', J(R.applyRoleAnswer(d, { packId: 'ask-1', qid: 'q3', card: chk.cards[2], answer: 'decline' })) === J(d));
    ok('Z6 路線、工作不變', J(d.milestones) === J(s.milestones) && J(d.tasks) === J(s.tasks));
  }
  { // Z7
    const { state: s, ids } = withCards();
    const t = s.teammates[0], act = s.tasks.find(x => x.id === t.activationTaskId);
    ok('Z7 啟用任務需驗收、交付前 lifecycle 仍 planned', act.needsAcceptance === true && t.lifecycle === 'planned');
    const pick = R.pickAssignment(s, [act], { today: TODAY });
    ok('Z7 待啟用卡可做自己的啟用任務', pick.teammateId === ids[0] && pick.reason === 'activation', pick);
    ok('Z7 啟用任務交付 → 出驗收題（需要驗收）', P.needsAcceptance({ activation: true, external: false }) && !P.needsAcceptance({ activation: true, ending: 'blocked' }));
  }
  { // Z8
    const { state: s, ids } = withCards();
    const a = R.applyActivation(s, { teammateId: ids[0], answer: 'accept', now: NOW, replyFile: 'r1.md', cardHash: 'abc' });
    const t = a.teammates[0];
    ok('Z8 驗收「接受」→ enabled、activation 齊全、bounds 鎖定、任務 done', t.lifecycle === 'enabled' && t.activation.taskId === t.activationTaskId && t.activation.acceptedAt === NOW && t.activation.replyFile === 'r1.md' && t.activation.cardHash === 'abc' && t.bounds.lockedAt === NOW && a.tasks.find(x => x.id === t.activationTaskId).status === 'done', t);
    ok('Z8 再套用一次相同（冪等）', J(R.applyActivation(a, { teammateId: ids[0], answer: 'accept', now: '2026-11-11T00:00:00' })) === J(a));
    const b = R.applyActivation(s, { teammateId: ids[1], answer: 'acceptRedirect', now: NOW });
    ok('Z8 「接受，但我想改方向」同樣啟用', b.teammates[1].lifecycle === 'enabled');
    ok('Z8 已鎖定的 bounds 只可加條不可減條', R.boundsNotLoosened(t.bounds, { ...t.bounds, askFirst: [...t.bounds.askFirst, '多一條'] }) && !R.boundsNotLoosened(t.bounds, { ...t.bounds, askFirst: t.bounds.askFirst.slice(1) }));
  }
  { // Z9、Z10
    const { state: s, ids } = withCards();
    const r1 = R.applyActivation(s, { teammateId: ids[1], answer: 'return', now: NOW });
    const task1 = r1.tasks.find(x => x.id === r1.teammates[1].activationTaskId);
    ok('Z9 「退回重做」→ 工作重開、退回次數 1、lifecycle 不變', r1.teammates[1].activationReturns === 1 && task1.status === 'active' && r1.teammates[1].lifecycle === 'planned', r1.teammates[1]);
    const r2 = R.applyActivation(r1, { teammateId: ids[1], answer: 'return', now: NOW });
    const task2 = r2.tasks.find(x => x.id === r2.teammates[1].activationTaskId);
    ok('Z10 退回達 2 → 需改卡或取消；工作不再自動重開', R.needsRecard(r2.teammates[1]) && task2.status === 'waiting' && /改崗位卡/.test(task2.waitingFor) && r2.teammates[1].lifecycle === 'planned', task2);
    ok('Z10 未達兩次不可套用「改卡或取消」', R.applyRecard(r1, { teammateId: ids[1], answer: 'cancel' }) === r1);
    const cancelled = R.applyRecard(r2, { teammateId: ids[1], answer: 'cancel', now: NOW });
    ok('Z10 「取消」→ retired、啟用任務取消、不佔軟上限、不負責任何站（必修 8）', cancelled.teammates[1].lifecycle === 'retired' && cancelled.tasks.find(x => x.id === task2.id).status === 'cancelled' && R.countedCards(cancelled).length === 2 && !R.ownerOfStation(cancelled, 'm2'), cancelled.teammates[1]);
    const newCard = { ...CARDS.cards[1], title: '餐廳試單拓展專員', how: ['先找三間相熟餐廳'], activation: { title: '三間相熟餐廳的試單邀請草稿', deliverable: '三份訊息草稿', milestoneId: 'm2' } };
    const recard = R.applyRecard(r2, { teammateId: ids[1], answer: 'recard', card: newCard, now: NOW });
    const t2 = recard.teammates[1], nt = recard.tasks.find(x => x.id === t2.activationTaskId);
    ok('Z10 「改卡」→ 欄位換新、退回次數重設、新啟用任務、舊任務取消、仍 planned', t2.title === '餐廳試單拓展專員' && t2.name === t2.title && t2.activationReturns === 0 && t2.lifecycle === 'planned' && nt && nt.id !== task2.id && nt.status === 'planned' && recard.tasks.find(x => x.id === task2.id).status === 'cancelled', t2);
    ok('Z10 已啟用的卡不受退回影響', J(R.applyActivation(R.applyActivation(s, { teammateId: ids[0], answer: 'accept', now: NOW }), { teammateId: ids[0], answer: 'return' })) === J(R.applyActivation(s, { teammateId: ids[0], answer: 'accept', now: NOW })));
  }
  { // Z8、Z9（覆核 M5）：待啟用的卡在驗收題未答時被暫停，之後才答驗收
    const { state: s0, ids } = withCards();
    const p = R.pauseCard(s0, { teammateId: ids[1], reason: '先停一停', now: NOW });
    ok('Z8 前提：待啟用卡暫停後 lifecycle paused、lifecycleBefore planned', p.teammates[1].lifecycle === 'paused' && p.teammates[1].lifecycleBefore === 'planned');
    const a = R.applyActivation(p, { teammateId: ids[1], answer: 'accept', now: NOW, replyFile: 'r2.md', cardHash: 'h2' });
    const ta = a.teammates[1], actTask = a.tasks.find(x => x.id === ta.activationTaskId);
    ok('Z8 暫停中的待啟用卡答「接受」：記入 activation、鎖定 bounds、啟用任務 done；仍暫停，恢復後是 enabled（覆核 M5）', a !== p && ta.lifecycle === 'paused' && ta.lifecycleBefore === 'enabled' && ta.activation.replyFile === 'r2.md' && ta.bounds.lockedAt === NOW && actTask.status === 'done' && R.resumeCard(a, { teammateId: ids[1], now: NOW }).teammates[1].lifecycle === 'enabled', ta);
    ok('Z8 暫停中答「接受」再套用一次相同（冪等）', J(R.applyActivation(a, { teammateId: ids[1], answer: 'accept', now: '2026-11-11T00:00:00' })) === J(a));
    const r1 = R.applyActivation(p, { teammateId: ids[1], answer: 'return', now: NOW });
    ok('Z9 暫停中的待啟用卡答「退回」：退回次數加一、啟用任務重開；恢復後仍是 planned（覆核 M5）', r1.teammates[1].activationReturns === 1 && r1.tasks.find(x => x.id === r1.teammates[1].activationTaskId).status === 'active' && r1.teammates[1].lifecycle === 'paused' && R.resumeCard(r1, { teammateId: ids[1], now: NOW }).teammates[1].lifecycle === 'planned', r1.teammates[1]);
    const r2 = R.applyActivation(r1, { teammateId: ids[1], answer: 'return', now: NOW });
    ok('Z10 暫停中退回達 2：恢復後 needsRecard、啟用任務等你決定（改卡或取消）（覆核 M5）', R.needsRecard(R.resumeCard(r2, { teammateId: ids[1], now: NOW }).teammates[1]) && r2.tasks.find(x => x.id === r2.teammates[1].activationTaskId).status === 'waiting');
    const e = R.applyActivation(R.pauseCard(R.applyActivation(s0, { teammateId: ids[0], answer: 'accept', now: NOW }), { teammateId: ids[0], now: NOW }), { teammateId: ids[0], answer: 'return', now: NOW });
    ok('Z10 已啟用後才暫停的卡，遲來的「退回」仍不影響（只認暫停前是待啟用的）', e.teammates[0].lifecycle === 'paused' && !e.teammates[0].activationReturns);
  }
  { // Z11、Z12
    let { state: s, ids } = withCards();
    s = R.applyActivation(s, { teammateId: ids[0], answer: 'accept', now: NOW });
    s.tasks.push({ id: 't9', title: '農場甲條款草案', owner: 'ai', milestoneId: 'm1', teammateId: ids[0], status: 'planned', cadence: 'daily' });
    s.runs.push({ id: 'R1', state: 'ended', teammateId: ids[0], teammateTitle: '農場採購專員' });
    const p = R.pauseCard(s, { teammateId: ids[0], reason: '農場洽談暫停至下月', now: NOW });
    ok('Z11 創辦人暫停 → paused、原因；其站未完成工作改由統籌', p.teammates[0].lifecycle === 'paused' && p.teammates[0].pausedReason === '農場洽談暫停至下月' && p.tasks.find(x => x.id === 't9').teammateId === '' && J(p.runs) === J(s.runs) && J(p.teammates[0].milestoneIds) === J(['m1']), p.teammates[0]);
    ok('Z11 暫停的崗位不派工（連啟用任務也不派）', R.pickAssignment(p, [p.tasks.find(x => x.id === 't9')], { today: TODAY }).reason === 'ownerPaused' && R.pickAssignment(R.pauseCard(s, { teammateId: ids[1], reason: 'x' }), [s.tasks.find(x => x.id === s.teammates[1].activationTaskId)]).reason === 'ownerPaused');
    const r = R.resumeCard(p, { teammateId: ids[0], now: NOW });
    ok('Z12 恢復 → 回到 enabled、原因刪去、工作寫回', r.teammates[0].lifecycle === 'enabled' && !r.teammates[0].pausedReason && r.tasks.find(x => x.id === 't9').teammateId === ids[0] && r.teammates[0].activation, r.teammates[0]);
    const pp = R.resumeCard(R.pauseCard(s, { teammateId: ids[1], reason: 'x' }), { teammateId: ids[1] });
    ok('Z12 從未啟用的卡恢復 → planned', pp.teammates[1].lifecycle === 'planned');
  }
  { // Z13
    const { state: s, ids } = withCards();
    const items = [{ teammateId: ids[0], ending: 'blocked', waitingFor: '農場甲回覆價格' }, { teammateId: ids[1], ending: 'artifact' }, { teammateId: ids[0], ending: 'blocked', waitingFor: '農場甲回覆價格' }];
    const a = R.autoPauseCards(s, { items, today: TODAY });
    ok('Z13 同一崗位當日連續兩件卡住 → pausedAuto 當日；其餘崗位不受影響', a.teammates[0].pausedAuto === true && a.teammates[0].pausedOn === TODAY && /等候：農場甲回覆價格/.test(a.teammates[0].pausedReason) && !a.teammates[1].pausedAuto && a.teammates[0].lifecycle === 'planned', a.teammates[0]);
    ok('Z13 當日視為暫停、翌日自動解除', R.isPausedToday(a.teammates[0], TODAY) && !R.isPausedToday(a.teammates[0], '2026-11-11') && !R.autoPauseCards(a, { items: [], today: '2026-11-11' }).teammates[0].pausedAuto);
    ok('Z13 卡住後有一件成功 → 不暫停', !R.autoPauseCards(s, { items: [items[0], { teammateId: ids[0], ending: 'artifact' }, items[2]], today: TODAY }).teammates[0].pausedAuto);
    const act = a.tasks.find(x => x.id === a.teammates[0].activationTaskId);
    ok('Z13 當日自動暫停的崗位：一般工作改派統籌，但啟用任務仍由它做（覆核建議 d）', R.pickAssignment(a, [{ id: 'tx', milestoneId: 'm1' }], { today: TODAY }).reason === 'ownerPaused' && R.pickAssignment(a, [act], { today: TODAY }).teammateId === ids[0]);
  }

  /* ===== 乙、中途加崗位、拆分、合併、重擬 ===== */
  { // Z14–Z17
    ok('Z14 創辦人輸入含加崗位要求 → wantsRole', R.wantsRole('想加一個市場推廣及媒體崗位') && R.wantsRole('多一個人負責媒體') && !R.wantsRole('想改一下第二站的日期'));
    const { state: s } = withCards();
    const station = { short: '首次媒體報道刊出', event: '首次媒體報道刊出', witness: '創辦人', deliveryCondition: '一篇有署名媒體的報道刊出', evidence: '刊出報道的連結或剪報，由創辦人確認' };
    const req = R.stationRequest(s, station);
    ok('Z14 加站只產生現有「改次序／加一站」同一形狀的套用要求（order 含 new、add 四格齊），不寫 state.milestones（必修 2）', req && J(req.order) === J(['m1', 'm2', 'm3', 'm4', 'new']) && req.add.short === '首次媒體報道刊出' && req.add.witness === '創辦人' && req.add.evidence && req.add.deliveryCondition && R.stationRequest(s, { ...station, evidence: '' }) === null, req);
    ok('Z14 站名上限 12 字（與現有加站核對 markRequest 一致）；事件 120 字', R.STATION_SHORT_MAX === 12 && R.stationRequest(s, { ...station, short: '首次媒體報道在報章及網上同時刊出' }) === null && R.stationRequest(s, { ...station, short: '首次媒體報道刊出見報' }) !== null);
    const card = { title: '市場推廣及媒體主任', mission: '令目標餐廳與公眾知道可追溯來源的菜', milestoneIds: [], supports: [], targets: ['customer'], how: ['整理媒體名單', '準備新聞稿草稿'], strategy: '先爭取一篇報道，再借它接觸餐廳', sources: ['web'], deliverables: ['message', 'intro'], knowledge: [], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '媒體名單及接觸次序', deliverable: '十間目標媒體及首篇稿的角度', milestoneId: '' }, avatarKind: 'marketing' };
    const voided = R.applyRoleWithStation(s, { packId: 'ask-2', qid: 'q2', stationAnswer: 'decline', card, roleAnswer: 'accept', now: NOW });
    ok('Z15 加站否決 → 加崗位不成立、不寫卡；不記為拒絕崗位', voided.teammates.length === 3 && Object.values(voided.rolesSync.voided)[0] === 'noStation' && !(voided.rolesSync.declined || {})['station:m5'], voided.rolesSync);
    ok('Z16 加站已確認但帳本仍未同步出新站 → 原樣，卡不會指向不存在的站', R.applyRoleWithStation(s, { packId: 'ask-2', qid: 'q2', stationAnswer: 'accept', newStationId: 'm5', card, roleAnswer: 'accept', now: NOW }) === s);
    const synced = deep(s); synced.milestones.push({ id: 'm5', short: '首次媒體報道刊出', event: '首次媒體報道刊出', order: 5, pathStatus: 'confirmed', state: 'not_started', witness: '創辦人', evidence: station.evidence, deliveryCondition: station.deliveryCondition, addedBy: 'founder' });
    const both = R.applyRoleWithStation(synced, { packId: 'ask-2', qid: 'q2', stationAnswer: 'accept', newStationId: 'm5', card, roleAnswer: 'accept', now: NOW });
    const nt = both.teammates[3];
    ok('Z16 兩題都確認、applyOrder 已把新站同步入帳 → 新卡 planned 指新站並附啟用任務；其他站不變', nt && nt.lifecycle === 'planned' && J(nt.milestoneIds) === J(['m5']) && both.tasks.some(x => x.id === nt.activationTaskId && x.milestoneId === 'm5') && J(both.milestones.slice(0, 4)) === J(s.milestones), nt);
    const single = R.applyRoleAnswer(s, { packId: 'ask-3', qid: 'q1', card: { ...card, milestoneIds: ['m3'], activation: { ...card.activation, milestoneId: 'm3' } }, answer: 'accept', now: NOW });
    ok('Z17 路線已有對應站但已被別的崗位負責 → 不寫（每站一個負責者）', single.teammates.length === 3);
    const freed = R.mergeCards(s, { fromId: s.teammates[1].id, intoId: s.teammates[0].id });
    const free = R.applyRoleAnswer({ ...freed, teammates: freed.teammates.map(t => t.id === s.teammates[0].id ? { ...t, milestoneIds: ['m1', 'm2'] } : t) }, { packId: 'ask-3', qid: 'q1', card: { ...card, milestoneIds: ['m3'], activation: { ...card.activation, milestoneId: 'm3' } }, answer: 'accept' });
    ok('Z17 路線已有對應站且無人負責 → 只出加崗位一題，直接寫卡', free.teammates.length === 4 && J(free.teammates[3].milestoneIds) === J(['m3']));
  }
  { // Z18
    const { state: sc } = withCards();
    sc.milestones.push({ id: 'm5', short: '首次媒體報道刊出', order: 5, pathStatus: 'confirmed', state: 'not_started', actorName: '媒體', addedBy: 'founder' });
    const sig = R.suggestSignals(sc, { today: TODAY });
    ok('Z18 訊號 (2)：上次擬崗位後新增一站（不在站清單快照）而沒有負責崗位 → 一個建議', sig.length === 1 && sig[0].kind === 'station' && sig[0].key === 'station:m5', sig);
    const marked = R.markSuggested(sc, { key: sig[0].key, today: TODAY });
    ok('Z18 同一訊號只建議一次', R.suggestSignals(marked, { today: TODAY }).length === 0);
    const declined = R.declineSuggestion(sc, { key: sig[0].key });
    ok('Z18 答「不要」後不再就同一站建議', R.suggestSignals(declined, { today: TODAY }).length === 0 && declined.rolesSync.declined['station:m5'] === 1);
    const un = withCards(); un.state.rolesSync.unassigned = [{ milestoneId: 'm4', why: '暫由統籌承擔' }]; un.state.teammates[2].lifecycle = 'retired';
    ok('Z18 J1 列明由統籌承擔的站、及已知站不算新站（必修 5）', R.suggestSignals(un.state, { today: TODAY }).length === 0);
    const { state: sc2 } = withCards();
    sc2.milestones.push({ id: 'm6', short: '投資者簡報', order: 6, pathStatus: 'confirmed', state: 'not_started', actorName: '投資者丙' }, { id: 'm7', short: '第二位投資者', order: 7, pathStatus: 'confirmed', state: 'not_started', actorName: '投資者丙' });
    sc2.rolesSync.stationsAt = [...sc2.rolesSync.stationsAt, 'm6', 'm7'];
    for (let i = 0; i < 3; i++) sc2.tasks.push({ id: 'x' + i, title: '投資者準備' + i, owner: 'ai', milestoneId: i < 2 ? 'm6' : 'm7', status: 'done', doneOn: '2026-11-0' + (5 + i) });
    const sig2 = R.suggestSignals(sc2, { today: TODAY });
    ok('Z18 訊號 (1)：14 日內三件由統籌完成、要點頭的人相同（真實帳本沒有 actorKind，以 actorName 分組）→ 一個建議', sig2.length === 1 && sig2[0].kind === 'kind' && sig2[0].actorKind === '投資者丙' && sig2[0].milestoneIds.length === 2, sig2);
    sc2.tasks[sc2.tasks.length - 1].doneOn = '2026-10-01';
    ok('Z18 只有兩件在 14 日內 → 不建議；每批最多一個', R.suggestSignals(sc2, { today: TODAY }).length === 0);
  }
  { // Z19
    let { state: s } = withCards();
    for (let i = 0; i < 3; i++) { s.milestones.push({ id: 'n' + i, short: '站' + i, order: 10 + i, pathStatus: 'confirmed', state: 'not_started' }); s = R.applyRoleAnswer(s, { packId: 'ask-c', qid: 'q' + i, card: { ...CARDS.cards[2], title: ['財務及融資主任', '餐廳配送營運主任', '客戶服務專員'][i], milestoneIds: ['n' + i], supports: [], knowledge: [], activation: { title: 'x', deliverable: 'y', milestoneId: 'n' + i } }, answer: 'accept' }); }
    ok('Z19 已啟用＋待啟用達六張 → overCap，先出合併題', s.teammates.length === 6 && R.overCap(s));
    const paused = R.pauseCard(s, { teammateId: s.teammates[5].id, reason: 'x' });
    ok('Z19 暫停的卡不計入軟上限', !R.overCap(paused));
    const merged = R.mergeCards(s, { fromId: s.teammates[5].id, intoId: s.teammates[4].id });
    ok('Z19 合併後降到五張 → 可再加', !R.overCap(merged) && R.countedCards(merged).length === 5);
  }
  { // Z20
    const { state: s, ids } = withCards();
    s.milestones.push({ id: 'm8', short: '投資者簡報', order: 8, pathStatus: 'confirmed', state: 'active', actorName: '投資者丙' });
    s.milestones[1].state = 'active';
    s.teammates[1].milestoneIds = ['m2', 'm3', 'm8'];
    const sig = R.splitSignal(s, ids[1]);
    ok('Z20 拆分訊號：負責三個進行中／下一個的站（真實狀態 active／not_started）而要點頭的人不同', sig.split && sig.why === 'stations', sig);
    ok('Z20 只負責兩個進行中站 → 不拆；連續三件等候分屬兩個對象 → 拆', !R.splitSignal(s, ids[0]).split && R.splitSignal(s, ids[0], { recent: [{ teammateId: ids[0], waitingWho: '農場甲' }, { teammateId: ids[0], waitingWho: '農場甲' }, { teammateId: ids[0], waitingWho: '農場丙' }] }).why === 'waits');
    const newCard = { ...CARDS.cards[1], title: '投資者關係經理', milestoneIds: ['m8'], targets: ['investor'], activation: { title: '投資者簡報大綱', deliverable: '一頁簡報大綱', milestoneId: 'm8' } };
    s.tasks.push({ id: 't8', title: '投資者名單', owner: 'ai', milestoneId: 'm8', teammateId: ids[1], status: 'planned' });
    const sp = R.splitCard(s, { teammateId: ids[1], keepIds: ['m2', 'm3'], newCard, packId: 'ask-s', qid: 'q1', now: NOW });
    const nt = sp.teammates[3];
    ok('Z20 拆分確認 → 原卡縮範圍、splitInto；新卡 planned 附啟用任務；工作改屬新卡', J(sp.teammates[1].milestoneIds) === J(['m2', 'm3']) && sp.teammates[1].splitInto[0] === nt.id && nt.lifecycle === 'planned' && J(nt.milestoneIds) === J(['m8']) && sp.tasks.find(x => x.id === 't8').teammateId === nt.id && sp.tasks.some(x => x.id === nt.activationTaskId), sp.teammates);
    ok('Z20 原卡 lifecycle 不變；再套用一次相同', sp.teammates[1].lifecycle === s.teammates[1].lifecycle && J(R.splitCard(sp, { teammateId: ids[1], keepIds: ['m2', 'm3'], newCard, packId: 'ask-s', qid: 'q1', now: NOW })) === J(sp));
  }
  { // Z21
    let { state: s, ids } = withCards();
    s = R.applyActivation(s, { teammateId: ids[0], answer: 'accept', now: NOW });
    s.tasks.push({ id: 't9', title: '餐廳乙試食安排', owner: 'ai', milestoneId: 'm2', teammateId: ids[1], status: 'planned' });
    s.runs.push({ id: 'R1', state: 'ended', teammateId: ids[1], teammateTitle: '餐廳拓展經理' });
    const m = R.mergeCards(s, { fromId: ids[1], intoId: ids[0], now: NOW });
    ok('Z21 合併 → 被併卡 merged、mergedInto；站及未完成工作改屬目標；目標狀態不變；歷史收據不改', m.teammates[1].lifecycle === 'merged' && m.teammates[1].mergedInto === ids[0] && J(m.teammates[0].milestoneIds) === J(['m1', 'm2', 'm3']) && m.tasks.find(x => x.id === 't9').teammateId === ids[0] && m.teammates[0].lifecycle === 'enabled' && J(m.runs) === J(s.runs), m.teammates);
    ok('Z21 讀取時解到最終卡；每站仍只一個崗位', R.resolveCardId(m, ids[1]) === ids[0] && R.ownerOfStation(m, 'm2').id === ids[0]);
    ok('Z21 併入自己 → 原樣；併入已合併卡 → 解到最終卡', J(R.mergeCards(m, { fromId: ids[0], intoId: ids[0] })) === J(m) && R.mergeCards(m, { fromId: ids[2], intoId: ids[1] }).teammates[2].mergedInto === ids[0]);
  }
  { // Z22
    const { state: s } = withCards();
    s.milestones[3].pathStatus = 'retired';
    const r = R.recardAfterRoute(s, { now: NOW });
    ok('Z22 卡的站全被撤 → 暫停並寫原因；milestoneIds 保留', r.teammates[2].lifecycle === 'paused' && r.teammates[2].pausedReason === '負責的站已撤回' && J(r.teammates[2].milestoneIds) === J(['m4']), r.teammates[2]);
    const s2 = withCards().state; s2.milestones.push({ id: 'm9', short: '新站', order: 9, pathStatus: 'confirmed', state: 'not_started' });
    ok('Z22 上次擬崗位後新增的已確認站無崗位 → 標記重擬（requested）', R.recardAfterRoute(s2).rolesSync.requested === true && R.rolesDue(R.recardAfterRoute(s2)).due === 'manual');
    const s3 = withCards().state; s3.rolesSync.unassigned = [{ milestoneId: 'm4', why: '暫由統籌承擔' }]; s3.teammates[2].lifecycle = 'retired';
    ok('Z22 J1 未分配站（由統籌承擔）不觸發重擬；已知站亦不觸發（必修 5）', R.recardAfterRoute(s3) === s3 && R.recardAfterRoute(withCards().state) === withCards().state || J(R.recardAfterRoute(s3)) === J(s3));
    ok('Z22 擬完即清 requested（manual → 擬完後不再 due）', R.rolesDue(R.markRolesDrafted(R.recardAfterRoute(s2), { now: NOW }), { today: TODAY }).due === '');
  }

  /* ===== 丙、派工、八段說明、校對 ===== */
  { // Z23、Z53
    let { state: s, ids } = withCards();
    s = R.applyActivation(s, { teammateId: ids[0], answer: 'accept', now: NOW });
    const order = P.orderCanDo(s, { today: TODAY });
    ok('Z53 外殼自己排「可以做」：有日期的準備及下一個對外動作所在站先（按日期）、其餘按路線次序再按建立次序；已驗收的啟用任務不在清單', order.map(t => t.id).join() === 't3,t1,t2,' + s.teammates[1].activationTaskId + ',' + s.teammates[2].activationTaskId, order.map(t => [t.id, t.title]));
    const t1 = s.tasks.find(x => x.id === 't1');
    ok('Z23 派工取排好的第一項：站的負責崗位已啟用 → 派該崗位', R.pickAssignment(s, [t1], { today: TODAY }).teammateId === ids[0] && R.pickAssignment(s, [t1]).reason === 'owner');
    ok('Z23 崗位待啟用而工作非其啟用任務 → 統籌並註明（J8）', R.pickAssignment(s, [s.tasks.find(x => x.id === 't2')]).reason === 'ownerPlanned');
    ok('Z23 不屬任何站（臨時、恆常）→ 統籌', R.pickAssignment(s, [{ id: 'a1', title: '臨時', adhoc: true }]).reason === 'adhoc' && R.pickAssignment(s, [{ id: 'c1', title: '名單整理', cadence: 'standing' }]).reason === 'standing');
    s.milestones.push({ id: 'm9', short: '無人站', order: 9, pathStatus: 'confirmed', state: 'not_started' });
    ok('Z23 站沒有崗位 → 統籌', R.pickAssignment(s, [{ id: 'z1', title: 'x', milestoneId: 'm9' }]).reason === 'noOwner');
    ok('Z23 清單為空 → 沒有工作', R.pickAssignment(s, []).task === null && R.pickAssignment(s, []).reason === 'nothingToDo');
    // Z53 每件收尾寫工作狀態，當日已做或卡住的件不再派（必修 1：衝刺不會重做同一件）
    const a1 = P.applyItemEnding(s, { taskId: 't3', ending: 'artifact', today: TODAY, now: NOW, needsAcceptance: false, artifactTitle: '牌照要求查詢清單' });
    const a2 = P.applyItemEnding(a1, { taskId: 't1', ending: 'blocked', waitingFor: '農場甲回覆價格', today: TODAY, now: NOW });
    const a3 = P.applyItemEnding(a2, { taskId: 't2', ending: 'failed', today: TODAY });
    const picks = []; let st = s;
    for (let i = 0; i < 3; i++) { const list = P.orderCanDo(st, { today: TODAY }); const p = R.pickAssignment(st, list, { today: TODAY }); picks.push(p.task.id); st = P.applyItemEnding(st, { taskId: p.task.id, ending: 'artifact', today: TODAY, now: NOW }); }
    ok('Z53 連續三件派工不重複（每件收尾後重排）', new Set(picks).size === 3 && picks[0] === 't3', picks);
    ok('Z53 收尾狀態：交付 → done（內部產出不需驗收）；卡住 → 只記 blockedOn、狀態不變；工具失敗 → 只記 failedOn；三者都不在今日清單', a1.tasks.find(x => x.id === 't3').status === 'done' && !a1.tasks.find(x => x.id === 't3').needsAcceptance && a2.tasks.find(x => x.id === 't1').status === 'planned' && a2.tasks.find(x => x.id === 't1').blockedOn === TODAY && a2.tasks.find(x => x.id === 't1').waitingFor === '農場甲回覆價格' && a3.tasks.find(x => x.id === 't2').failedOn === TODAY && a3.tasks.find(x => x.id === 't2').status === 'planned' && !P.orderCanDo(a3, { today: TODAY }).some(t => ['t3', 't1', 't2'].includes(t.id)), a3.tasks);
    ok('Z53 卡住 → 同日不再做 → 翌日自動可再做（第二輪必修：不寫 status blocked，清單不會日漸清空）', !P.orderCanDo(a2, { today: TODAY }).some(t => t.id === 't1') && P.orderCanDo(a2, { today: '2026-11-11' }).some(t => t.id === 't1') && P.orderCanDo(a3, { today: '2026-11-11' }).some(t => t.id === 't2'));
    const rel = P.releaseBlocked(a2, { milestoneIds: ['m1'], today: TODAY });
    ok('Z53 卡住 → 創辦人答題（相關站的輸入）→ 同日可再做；不相關站的輸入不解除；沒有卡住時原樣', P.orderCanDo(rel, { today: TODAY }).some(t => t.id === 't1') && !rel.tasks.find(x => x.id === 't1').blockedOn && !P.orderCanDo(P.releaseBlocked(a2, { milestoneIds: ['m2'] }), { today: TODAY }).some(t => t.id === 't1') && P.orderCanDo(P.releaseBlocked(a2), { today: TODAY }).some(t => t.id === 't1') && P.releaseBlocked(a1) === a1);
    ok('Z53 現有 status waiting／blocked 的工作（創辦人或舊程式設的）仍不入清單', !P.orderCanDo({ ...s, tasks: s.tasks.map(t => t.id === 't2' ? { ...t, status: 'waiting' } : t) }, { today: TODAY }).some(t => t.id === 't2'));
    const ext = P.applyItemEnding(s, { taskId: 't1', ending: 'artifact', today: TODAY, needsAcceptance: true });
    ok('Z53 對外產出交付 → done 並標需要驗收（驗收前不算已接受）', ext.tasks.find(x => x.id === 't1').needsAcceptance === true && !ext.tasks.find(x => x.id === 't1').acceptedBy);
    ok('Z53 當日已做的件亦可由收據 items 推出', J(P.doneTodayIds({ runs: [{ id: 'R1', workDay: TODAY, items: [{ taskId: 't3' }, { taskId: 't1' }] }, { id: 'R0', startedAt: '2026-11-09T21:00:00', items: [{ taskId: 't2' }] }] }, TODAY)) === J(['t3', 't1']));
  }
  { // Z24、Z25
    const parts = { kind: 'work', station: { short: '首間農場簽約', event: '首間農場簽約供應', doneWhen: '農場甲簽署供應協議' }, task: { title: '農場甲會面簡介', next: '一頁簡介' }, role: { title: '農場採購專員', bounds: { tellAfter: ['整理農場名單'], askFirst: ['答應任何價錢'] } },
      exclude: ['餐廳拓展經理負責的站', '恆常任務'], files: [{ name: 'confirmed-page.md', about: '已確認的公司概覽' }, { name: 'in-doc1.md', about: '農場甲供應量表' }], web: { allowed: true, note: '只可讀取' },
      progress: { before: ['已整理農場甲供應量'], answered: ['目標每週三百公斤'], unknown: ['農場甲的最低訂量'], todayDone: ['候選餐廳名單（餐廳拓展經理）'] }, permissions: R.PERMISSIONS_DEFAULT,
      firstStep: '按供應量表列出要對方承諾的三件事。', deliver: { types: ['intro'], max: 2, proofread: true, acceptance: '創辦人按簡介能否即場使用驗收' }, glossary: [{ term: '農場甲', meaning: '首個目標供應農場' }, { term: '首間農場簽約', meaning: '路線第一站' }, { term: '餐廳拓展經理', meaning: 'Zero 團隊負責餐廳的崗位' }] };
    const text = B.buildBrief(parts);
    const chk = B.checkBrief(text, { files: ['confirmed-page.md', 'in-doc1.md', 'task.md'], names: ['農場甲', '首間農場簽約', '餐廳拓展經理'] });
    ok('Z24 八段齊全、附名詞表、第四段有今日已做、第七段寫明會經校對', B.SECTIONS.every((_, i) => text.includes(B.heading(i))) && text.includes('## 名詞表') && text.includes('今日已做的件') && text.includes('先校對') && text.includes(B.FIRST_STEP_PREFIX), text.slice(0, 400));
    ok('Z25 機械核對通過', chk.ok, chk.errors);
    const rw = B.buildBrief({ ...parts, kind: 'rewrite', progress: { ...parts.progress, rewriteIssues: ['第二段供應量與來源不符'] } });
    ok('Z24 重寫工作第四段附問題清單', rw.includes('上次校對發回的問題') && rw.includes('第二段供應量與來源不符'));
    const pr = B.buildProofreadBrief({ artifactTitle: '農場甲會面簡介', roleTitle: '農場採購專員', station: '首間農場簽約', doneWhen: '農場甲簽署供應協議', files: [{ name: '01-intro.md', about: '產出全文' }], round: 2, lastIssues: ['價格沒有依據'], glossary: [{ term: '農場甲', meaning: '首個目標供應農場' }] });
    ok('Z24 校對說明八段齊、第二次附上次問題、不可上網、不提新問題', B.checkBrief(pr, { files: ['01-intro.md'], names: ['農場甲'] }).ok && pr.includes('第 2 次校對') && pr.includes('價格沒有依據') && pr.includes('不可上網') && pr.includes('不提出新問題'), pr.slice(0, 300));
  }
  { // Z26
    const good = B.buildBrief({ station: { short: 'A', event: 'B', doneWhen: 'C' }, task: { title: 'T' }, permissions: R.PERMISSIONS_DEFAULT, glossary: [] });
    const miss = good.replace(B.heading(4) + '\n', '');
    ok('Z26 故意刪一段 → 不合格（缺段）', !B.checkBrief(miss).ok && B.checkBrief(miss).errors.some(e => e.code === 'missingSection'), B.checkBrief(miss).errors);
    const forb = good.replace('只做上述這一項工作。', '範圍照舊，按上文。');
    const fe = B.checkBrief(forb).errors;
    ok('Z26 含禁用字眼「照舊」「按上文」→ 不合格', fe.filter(e => e.code === 'forbidden').length === 2, fe);
    ok('Z26 兩字詞獨立成詞才算：「範圍如前。」「做法同上」不合格', B.forbiddenHits('範圍如前。').length === 1 && B.forbiddenHits('做法同上').length === 1 && B.forbiddenHits('先做這件，如上，再交收據').length === 1);
    const okText = B.buildBrief({ station: { short: '首間農場簽約', event: '簽約', doneWhen: '簽署' }, task: { title: '準備簡介', next: '例如上網查農場甲的牌照' }, permissions: R.PERMISSIONS_DEFAULT, progress: { answered: ['例如前期先做試食', '同上次會面一樣帶樣本'] }, glossary: [] });
    ok('Z26 反例：「例如上網」「例如前期」「同上次會面」不是禁用字眼（必修 7）', B.checkBrief(okText).ok, B.checkBrief(okText).errors);
    ok('Z26 禁用字眼清單齊（含「按上文」「照舊」「如前」「見上次」「如上所述」）', ['按上文', '照舊', '如前', '見上次', '如上所述'].every(w => B.FORBIDDEN.includes(w)));
    ok('Z26 「如上所述」「如前所述」攔下；「例如上網」「例如上述情況」不誤擋', B.forbiddenHits('做法如上所述。').includes('如上所述') && B.forbiddenHits('範圍如前所述').includes('如前所述') && B.forbiddenHits('例如上網查資料').length === 0 && B.forbiddenHits('例如前期先做試食').length === 0);
    ok('Z26 名詞表未覆蓋文內名稱 → 不合格', B.checkBrief(good.replace('只做上述這一項工作。', '只做農場甲這一項工作。'), { names: ['農場甲'] }).errors.some(e => e.code === 'glossary'));
    ok('Z26 提到的檔不在資料夾 → 不合格', B.checkBrief(good.replace('只做上述這一項工作。', '先讀 `missing.md`。'), { files: ['task.md'] }).errors.some(e => e.code === 'file'));
    ok('Z26 連續兩件不合格 → 停當日；一件合格一件不合格 → 不停', B.briefFailStreak([false, true, true]) && !B.briefFailStreak([true, false, true]) && !B.briefFailStreak([true]));
    { // 覆核 M1：引述的資料（創辦人答案、退回原因、未知、先前做過、今日已做、校對問題）不是外殼寫的句子，禁用字眼核對不掃它
      const parts = { kind: 'work', station: { short: '首間農場簽約', event: '簽約', doneWhen: '簽署' }, task: { title: '準備簡介', next: '一頁簡介' }, permissions: R.PERMISSIONS_DEFAULT, files: [{ name: 'confirmed-page.md', about: '已確認的公司概覽' }, { name: 'in-doc1.md', about: '供應量表' }], glossary: [{ term: '農場甲', meaning: '供應農場' }], progress: {} };
      const quoted = B.buildBrief({ ...parts, kind: 'rewrite', progress: { before: ['如上所述的名單'], answered: ['每週送貨時間要改嗎？：照舊', '創辦人退回了上一版，原因：同上，價錢要改為每公斤三十八元'], unknown: ['同前'], todayDone: ['照舊報價'], rewriteIssues: ['第二段按上文改'] } });
      const qc = B.checkBrief(quoted, { files: ['confirmed-page.md', 'in-doc1.md', 'task.md'], names: ['農場甲'] });
      ok('Z26 引述的資料含「照舊」「同上」「同前」「如上所述」「按上文」不誤判；內容仍完整寫入說明（覆核 M1）', qc.ok && ['三十八元', '照舊報價', '按上文改', '如上所述的名單', '每週送貨時間要改嗎'].every(w => quoted.includes(w)), qc.errors);
      const own = B.buildBrief({ ...parts, task: { title: '照舊報價', next: '' } });
      ok('Z26 外殼自己寫的句子含禁用字眼仍攔下（引述不是漏洞）', B.checkBrief(own, { files: ['confirmed-page.md', 'in-doc1.md', 'task.md'], names: [] }).errors.some(e => e.code === 'forbidden'));
      const evil = B.buildBrief({ ...parts, progress: { ...parts.progress, answered: ['好`。 照舊 `再來', '請見 report.pdf'] } });
      ok('Z26 答案內的反引號被換掉，拆不開引述；以副檔名結尾的答案不被當成提到的檔（覆核 M1）', B.checkBrief(evil, { files: ['confirmed-page.md', 'in-doc1.md', 'task.md'], names: [] }).ok, B.checkBrief(evil, { files: ['confirmed-page.md', 'in-doc1.md', 'task.md'], names: [] }).errors);
    }
  }
  { // Z27、Z28
    const actors = base().company.actors;
    const ext = (a, self) => P.isExternal(a, { selfReport: self, actors });
    ok('Z27 訊息草稿開頭「草稿，未發送」→ 對外', ext({ type: 'message', title: '給農場甲的訊息', text: '草稿，未發送\n陳先生您好……' }).rules.includes('draft'));
    ok('Z27 含金額的報價 → 對外', ext({ type: 'quote', text: '每公斤 HK$38，每週供應三百公斤。' }).rules.includes('claims'));
    ok('Z27 對外類型的文件含「據……顯示」→ 對外', ext({ type: 'proposal', text: '據食環署統計顯示，本區有三十間持牌餐廳。' }).rules.includes('claims'));
    ok('Z27 內部比較表含金額亦校（寧多勿漏）', ext({ type: 'checklist', text: '農場甲報價比較：每公斤 HK$38；農場丙 HK$42。' }).external);
    ok('Z27 收件人稱呼句式（致／您好）→ 對外', ext({ type: 'plan', text: '致餐廳乙黃小姐：\n試食安排如下。' }).rules.includes('recipient') && ext({ type: 'list', text: '黃小姐您好，\n附上名單。' }).rules.includes('recipient'));
    ok('Z27 Zero 自報對外 → 對外（取較嚴）', ext({ type: 'questions', text: '會面要問的三件事。' }, 'external').external && ext({ type: 'questions', text: '會面要問的三件事。' }, 'external').rules.includes('self'));
    ok('Z28 問題清單、檢查清單無金額無收件人 → 內部，不開校對', !ext({ type: 'questions', text: '會面要問的三件事：供應期、包裝、送貨時間。' }).external && !ext({ type: 'checklist', text: '出發前檢查：樣本、簡介、名片。' }).external);
    ok('Z28 反例（覆核建議 a）：標題含伙伴名、站名「三間餐廳」、給創辦人的研究摘要「研究顯示」、內部時間表「兩星期內」都不對外', !ext({ type: 'questions', text: '# 見農場甲前的問題清單\n1. 供應期？' }).external && !ext({ type: 'checklist', text: '# 檢查清單\n為「三間餐廳恆常訂購」準備：樣本、簡介' }).external && !ext({ type: 'research', text: '# 給你的研究摘要\n研究顯示小農直銷可行。' }).external && !ext({ type: 'plan', text: '# 準備計劃\n兩星期內整理好名單。' }).external && !ext({ type: 'list', text: '候選餐廳名單：共十二間。' }).external);
    ok('Z28 內部產出每件最差 2 次（做、用字改寫）；對外最差 6 次', P.startsPerItem(false) === 2 && P.startsPerItem(true) === 6);
  }
  { // Z29–Z32
    const good = { verdict: 'pass', checks: P.CHECK_ITEMS.map(item => ({ item, ok: true })), line: '數字與名單核對無誤；訊息沒有承諾價錢。', issues: [] };
    const r = P.checkProofreadResult(good, { styleIssues });
    ok('Z29 校對結果可解析、六項齊、結果一句書面語 → pass', r.ok && r.verdict === 'pass' && r.line === good.line, r);
    const q1 = P.applyProofread({ audience: 'external' }, { verdict: 'pass', line: good.line });
    ok('Z29 pass → 交創辦人，rounds 1', q1.next === 'deliver' && q1.qa.verdict === 'pass' && q1.qa.rounds === 1);
    const notes = P.applyProofread({ audience: 'external' }, { verdict: 'pass_with_notes', line: '通過，日期寫法要留意。', issues: [{ where: '第二段', what: '日期寫法', fix: '寫全日期' }] });
    ok('Z29 pass_with_notes → 交創辦人並帶留意事項', notes.next === 'deliver' && notes.qa.verdict === 'pass_with_notes' && notes.qa.issues.length === 1);
    const ret = { verdict: 'return', checks: P.CHECK_ITEMS.map(item => ({ item, ok: item !== 'sources' })), line: '依據第二條在來源內找不到。', issues: [{ where: '依據第二條', what: '來源內沒有此數字', fix: '刪去或改寫為要確認' }] };
    const q2 = P.applyProofread({ audience: 'external' }, P.checkProofreadResult(ret, { styleIssues }));
    ok('Z30 第一次 return → 派重寫、verdict 待定、帶問題清單', q2.next === 'rewrite' && q2.qa.verdict === 'pending' && q2.qa.rounds === 1 && q2.qa.issues.length === 1, q2);
    const q3 = P.applyProofread(q2.qa, P.checkProofreadResult(ret, { styleIssues }));
    ok('Z31 重寫後第二次仍 return → flagged、照交創辦人、不開第三次', q3.next === 'deliverFlagged' && q3.qa.verdict === 'flagged' && q3.qa.rounds === 2 && P.applyProofread(q3.qa, { verdict: 'return' }).next === 'deliverFlagged' && P.applyProofread(q3.qa, { verdict: 'return' }).qa.rounds === 2, q3);
    ok('Z32 不可解析 → 當 return；六項不齊 → 不合格', P.checkProofreadResult(null).verdict === 'return' && !P.checkProofreadResult({ ...good, checks: good.checks.slice(0, 5) }).ok && !P.checkProofreadResult({ ...good, line: '呢份嘢冇問題' }, { styleIssues }).ok && !P.checkProofreadResult({ ...ret, issues: [] }).ok);
  }
  { // Z33、Z34
    const k = P.keepArtifacts([{ file: 'a.md' }, { file: 'b.md' }, { file: 'c.md' }]);
    ok('Z33 收據第三份起不收並記下', k.kept.length === 2 && k.dropped === 1 && P.ARTIFACTS_MAX === 2);
    const { state: s } = withCards();
    s.tasks.push({ id: 'ps', title: '整理名單', owner: 'ai', status: 'planned', cadence: 'standing' });
    ok('Z34 恆常任務由統籌做、不入每日件數清單、不佔件數上限', R.pickAssignment(s, [{ id: 'ps', title: '整理名單', cadence: 'standing' }]).teammateId === '' && !P.orderCanDo(s, { today: TODAY }).some(t => t.id === 'ps') && P.itemsLeftToday(s, 0) === 1);
    const c = P.countStarts(['2026-11-10T09:00\tpeople-sync\tR1-people', '2026-11-10T09:10\tcheckup\tR1-checkup', '2026-11-10T21:00\twork\tR2', '2026-11-10T21:20\tproofread\tR2-pf'], TODAY);
    ok('Z34 恆常啟動計入保險絲總數但不計校對', c.total === 4 && c.other === 2 && P.proofreadStarts(c) === 1);
  }

  /* ===== 丁、節奏、保險絲、衝刺停止 ===== */
  { // Z35、Z36
    const s = base();
    ok('Z35 舊資料沒有 pace → 標準、每日 1 件、保險絲 40、逾時 45', P.paceKey(s) === 'standard' && P.itemsCapOf(s) === 1 && P.fuseOf(s) === 40 && P.timeoutOf(s) === 45);
    const sp = P.setPace(s, { pace: 'sprint', today: TODAY });
    ok('Z35 轉衝刺 → sprintUntil 預設為紀錄內最近真實日期（11 月 14 日的創辦人行動）、記開始日', sp.company.rhythm.pace === 'sprint' && sp.company.rhythm.sprintUntil === '2026-11-14' && sp.company.rhythm.sprintStartedOn === TODAY, sp.company.rhythm);
    const far = base(); far.tasks = far.tasks.filter(t => t.owner !== 'founder'); far.company.nextExternalAction = { date: '2026-12-30' }; far.milestones[0].targetDate = '2026-12-25';
    ok('Z35 真實日期都超過 14 日 → 最長 14 日', P.setPace(far, { pace: 'sprint', today: TODAY }).company.rhythm.sprintUntil === '2026-11-24');
    ok('Z35 創辦人自定超過 14 日 → 截到 14 日；自定在期內照用', P.setPace(s, { pace: 'sprint', sprintUntil: '2026-12-20', today: TODAY }).company.rhythm.sprintUntil === '2026-11-24' && P.setPace(s, { pace: 'sprint', sprintUntil: '2026-11-20', today: TODAY }).company.rhythm.sprintUntil === '2026-11-20');
    ok('Z35 改回標準 → 逾時 45；不認識的檔原樣', P.timeoutOf(P.setPace(sp, { pace: 'standard' })) === 45 && P.setPace(s, { pace: 'turbo' }) === s);
    const pausedSp = { ...sp, company: { ...sp.company, rhythm: { ...sp.company.rhythm, sprintPause: { reason: 'backlog', since: TODAY } } } };
    ok('Z35 衝刺中只改期限 → 積壓暫停照留、開始日不重設；改檔才清（覆核建議 e）', P.setPace(pausedSp, { pace: 'sprint', sprintUntil: '2026-11-21', today: '2026-11-12' }).company.rhythm.sprintPause.reason === 'backlog' && P.setPace(pausedSp, { pace: 'sprint', sprintUntil: '2026-11-21', today: '2026-11-12' }).company.rhythm.sprintStartedOn === TODAY && !P.setPace(pausedSp, { pace: 'fast' }).company.rhythm.sprintPause);
    ok('Z36 保險絲按檔 40／50／80；估計表照每件最差 6 次（必修 6）', P.PACES.standard.fuse === 40 && P.PACES.fast.fuse === 50 && P.PACES.sprint.fuse === 80 && P.PACE_ESTIMATE.sprint.worst === 60 && P.PACE_ESTIMATE.standard.worst === 6 && P.PACE_ESTIMATE.fast.worst === 18);
    const c = P.countStarts('2026-11-10T21:00\twork\tR2\n2026-11-10T21:05\trewrite\tR2\n2026-11-10T21:20\tproofread\tR2-pf\n2026-11-10T21:40\tqa-rewrite\tR2-rw\n2026-11-09T21:00\twork\tR0\n', TODAY);
    ok('Z36 解析現有 ai-starts.log 格式：今日 4 次，其中校對 2（校對＋校對重寫）；現有用字改寫 rewrite 不算校對（必修 6）', c.total === 4 && P.proofreadStarts(c) === 2 && c.work === 2 && P.usageView(s, c).fuse === 40 && P.usageView(s, c).used === 4 && P.fuseLeft(s, c) === 36, c);
    ok('Z36 舊欄 aiStartsPerDay 不再讀取（設為 5 仍是 40）', P.fuseOf({ company: { rhythm: { aiStartsPerDay: 5 } } }) === 40);
  }
  { // Z57 工作日
    const sp = P.setPace(base(), { pace: 'sprint', today: TODAY });
    const lines = [...Array.from({ length: 70 }, (_, i) => `2026-11-10T21:${String(i % 60).padStart(2, '0')}\twork\tR9-${i}`), ...Array.from({ length: 10 }, (_, i) => `2026-11-11T00:0${i}\twork\tR9-x${i}`)];
    const withRuns = { ...sp, runs: [{ id: 'R9', workDay: TODAY, startedAt: '2026-11-10T21:00:00', state: 'running' }] };
    ok('Z57 開工時鎖定工作日：跨午夜的啟動仍計入該工作日，80 次用盡（必修 3）', P.workDayOf('2026-11-10T21:00:00') === TODAY && P.countStarts(lines, TODAY, { runIds: P.runIdsOfDay(withRuns, TODAY) }).total === 80 && P.nextStop(withRuns, { pace: 'sprint', itemsDone: 3, canDo: 5, counts: P.countStarts(lines, TODAY, { runIds: P.runIdsOfDay(withRuns, TODAY) }) }).reason === 'fuse');
    ok('Z57 不鎖工作日時午夜後會歸零（舊行為，證明鎖定有必要）', P.countStarts(lines, '2026-11-11').total === 10);
    ok('Z57 每件之間重讀帳本：創辦人暫停／自動停 → 停；改回標準或加速 → 停；程序內總時限（衝刺 240 分鐘）→ 停；否則繼續', P.betweenItems({ ...sp, health: { pausedByFounder: true } }, { startedPace: 'sprint' }).reason === 'paused' && P.betweenItems({ ...sp, health: { autoStopped: true } }, { startedPace: 'sprint' }).reason === 'paused' && P.betweenItems(P.setPace(sp, { pace: 'standard' }), { startedPace: 'sprint' }).reason === 'paceChanged' && P.betweenItems(P.setPace(sp, { pace: 'fast' }), { startedPace: 'sprint' }).reason === 'paceChanged' && P.betweenItems(sp, { startedPace: 'sprint', startedAt: '2026-11-10T21:00:00', now: '2026-11-11T01:00:00' }).reason === 'timeout' && !P.betweenItems(sp, { startedPace: 'sprint', startedAt: '2026-11-10T21:00:00', now: '2026-11-10T23:00:00' }).stop);
    ok('Z57 由標準改為衝刺不算改檔停止（放寬不停）', !P.betweenItems(sp, { startedPace: 'standard' }).stop && P.nextStop(sp, { paused: true }).reason === 'paused' && P.nextStop(sp, { paceChanged: true }).reason === 'paceChanged');
    // Z58 「暫停 Zero」及改節奏經創辦人操作隊列（伺服器寫、外殼每件之間合併），衝刺持鎖時亦在下一件前生效
    const ops = [{ id: 'o1', op: 'pauseZero', at: '2026-11-10T21:30:00' }, { id: 'o2', op: 'setPace', value: { pace: 'standard' }, at: '2026-11-10T21:31:00' }, { id: 'o3', op: 'setSourceUrl', value: { n: 1 } }];
    const afterOps = P.applyPaceOps(sp, ops);
    ok('Z58 操作隊列：pauseZero → health.pausedByFounder；setPace → 改檔；不認識的 op 略過；每件之間 betweenItems 即停', afterOps.health.pausedByFounder === true && afterOps.company.rhythm.pace === 'standard' && P.betweenItems(afterOps, { startedPace: 'sprint' }).reason === 'paused' && P.betweenItems(P.applyPaceOps(sp, [ops[1]]), { startedPace: 'sprint' }).reason === 'paceChanged', afterOps.health);
    ok('Z58 resumeZero 清除暫停；setPace 轉衝刺經隊列亦記開始日及期限；空隊列原樣', !P.applyPaceOps(afterOps, [{ op: 'resumeZero' }]).health.pausedByFounder && P.applyPaceOps(base(), [{ op: 'setPace', value: { pace: 'sprint' }, at: NOW }]).company.rhythm.sprintStartedOn === TODAY && P.applyPaceOps(sp, []) === sp);
  }
  { // Z37、Z38
    const std = base(), fast = P.setPace(base(), { pace: 'fast' });
    ok('Z37 標準日只開一件：做完一件即停', P.nextStop(std, { itemsDone: 1, canDo: 5 }).reason === 'itemsCap' && !P.nextStop(std, { itemsDone: 0, canDo: 5 }).stop);
    ok('Z38 加速日最多三件', !P.nextStop(fast, { itemsDone: 2, canDo: 5 }).stop && P.nextStop(fast, { itemsDone: 3, canDo: 5 }).reason === 'itemsCap' && P.itemsLeftToday(fast, 1) === 2);
  }
  { // Z39–Z47、Z54、Z55
    const sp = P.setPace(base(), { pace: 'sprint', today: TODAY });
    const go = { itemsDone: 4, canDo: 3, counts: { total: 20 }, unread: 2, noReply: 0, toolFails: 0, pausedRoles: 0 };
    ok('Z39 衝刺未滿、尚有工作、保險絲未盡 → 繼續', !P.nextStop(sp, go).stop);
    ok('Z39 當日件數達 10 → itemsCap', P.nextStop(sp, { ...go, itemsDone: 10 }).reason === 'itemsCap');
    ok('Z40 「可以做」清單為空 → nothingToDo', P.nextStop(sp, { ...go, canDo: 0 }).reason === 'nothingToDo');
    ok('Z41 餘下全受未答題影響 → waitingFounder（要創辦人決定）', P.nextStop(sp, { ...go, canDo: 0, blockedByQuestions: true }).reason === 'waitingFounder' && P.nextStop(sp, { ...go, blockedByQuestions: true }).reason === 'waitingFounder');
    ok('Z42 未看產出超過 10 → backlog（10 份不停）', P.nextStop(sp, { ...go, unread: 11 }).reason === 'backlog' && !P.nextStop(sp, { ...go, unread: 10 }).stop);
    const packs = [...Array.from({ length: 11 }, (_, i) => ({ id: 'a' + i, open: true, todoType: 'acceptance' })), { id: 'd1', open: true, todoType: 'decision' }, { id: 'a99', open: false, todoType: 'acceptance' }];
    ok('Z54 未看數＝仍未作答的驗收題（必修 4）：11 題未答 → 11；已答的及其他題不計', P.unreadCount(packs) === 11 && P.unreadCount([]) === 0 && P.unreadCount(packs.slice(1)) === 10);
    ok('Z54 只有需要驗收的產出才出驗收題：對外產出、啟用任務出；內部產出不出（未看數不會因內部產出只增不減）', P.needsAcceptance({ external: true }) && P.needsAcceptance({ activation: true }) && !P.needsAcceptance({ external: false, activation: false }) && !P.needsAcceptance({ external: true, ending: 'blocked' }));
    ok('Z55 驗收題作答（接受／退回）後不在未答清單 → 未看數下降、衝刺自動恢復', P.unreadCount(packs.map(p => p.id === 'a0' ? { ...p, open: false } : p)) === 10 && !P.applySprintPause(P.applySprintPause(sp, { unread: 11, today: TODAY }), { unread: 10, today: '2026-11-11' }).company.rhythm.sprintPause);
    ok('Z43 有未答題且兩日沒有回覆 → noReply；沒有未答題不算（J4）', P.noReplyDays({ health: { lastInputAt: '2026-11-08T08:00:00' } }, { today: TODAY, openPacks: 2 }) === 2 && P.noReplyDays({ health: { lastInputAt: '2026-11-08T08:00:00' } }, { today: TODAY, openPacks: 0 }) === 0 && P.noReplyDays({ health: { lastInputAt: '2026-11-09T08:00:00' } }, { today: TODAY, openPacks: 2 }) === 0 && P.nextStop(sp, { ...go, noReply: 2 }).reason === 'noReply');
    const paused = P.applySprintPause(sp, { unread: 12, today: TODAY });
    ok('Z42 積壓 → sprintPause 寫入、pace 不變；條件消失自動清除', paused.company.rhythm.sprintPause.reason === 'backlog' && paused.company.rhythm.pace === 'sprint' && !P.applySprintPause(paused, { unread: 3, today: TODAY }).company.rhythm.sprintPause && P.applySprintPause(paused, { unread: 12, today: '2026-11-11' }) === paused);
    ok('Z43 兩日沒有回覆 → sprintPause noReply；回覆後自動恢復', P.applySprintPause(sp, { noReply: 2, today: TODAY }).company.rhythm.sprintPause.reason === 'noReply' && !P.applySprintPause(P.applySprintPause(sp, { noReply: 2, today: TODAY }), { noReply: 0 }).company.rhythm.sprintPause);
    ok('Z42 標準檔不做積壓保護', !P.nextStop(base(), { itemsDone: 0, canDo: 1, unread: 30 }).stop);
    ok('Z44 工具連續兩次失敗 → toolFailed；卡住不算失敗', P.toolFailStreak([{ ok: true }, { ok: false, failKind: 'timeout' }, { ok: false, failKind: 'rejected' }]) === 2 && P.toolFailStreak([{ ok: false, failKind: 'timeout' }, { ok: false }, { ok: false, failKind: 'start' }]) === 1 && P.nextStop(sp, { ...go, toolFails: 2 }).reason === 'toolFailed');
    ok('Z45 保險絲用盡 → fuse（80 次）；79 次仍可做', P.nextStop(sp, { ...go, counts: { total: 80 } }).reason === 'fuse' && !P.nextStop(sp, { ...go, counts: { total: 79 } }).stop && P.nextStop(base(), { itemsDone: 0, canDo: 1, counts: { total: 40 } }).reason === 'fuse');
    ok('Z46 程序內總時限到 → timeout 優先於其他原因；衝刺 240 分鐘', P.nextStop(sp, { ...go, timedOut: true, counts: { total: 80 } }).reason === 'timeout' && P.timeoutOf(sp) === 240);
    ok('Z47 兩個崗位被停 → rolesPaused；一個不停', P.nextStop(sp, { ...go, pausedRoles: 2 }).reason === 'rolesPaused' && !P.nextStop(sp, { ...go, pausedRoles: 1 }).stop);
    const { state: s, ids } = withCards();
    const two = R.autoPauseCards(s, { items: [{ teammateId: ids[0], ending: 'blocked' }, { teammateId: ids[0], ending: 'blocked' }, { teammateId: ids[1], ending: 'blocked' }, { teammateId: ids[1], ending: 'blocked' }], today: TODAY });
    ok('Z47 崗位自動暫停數由卡算出（含創辦人暫停）', R.pausedCardsToday(two, TODAY).length === 2 && R.pausedCardsToday(R.pauseCard(two, { teammateId: ids[2], reason: 'x' }), TODAY).length === 3);
    ok('Z26 連續兩件說明不合格 → briefFailed', P.nextStop(sp, { ...go, briefFails: true }).reason === 'briefFailed');
    ok('Z39 停止原因清單齊全', ['itemsCap', 'nothingToDo', 'waitingFounder', 'backlog', 'noReply', 'toolFailed', 'fuse', 'timeout', 'rolesPaused', 'expired', 'paceChanged', 'paused'].every(r => P.STOP_REASONS.includes(r)));
  }
  { // Z48
    const sp = P.setPace(base(), { pace: 'sprint', sprintUntil: '2026-11-14', today: TODAY });
    ok('Z48 到期前首次開工 → 不改', P.expireSprint(sp, '2026-11-14') === sp && !P.sprintExpired(sp, '2026-11-14'));
    const ex = P.expireSprint(sp, '2026-11-15');
    ok('Z48 到期後首次開工 → pace 回標準、記結束日；sprintUntil 保留作紀錄', ex.company.rhythm.pace === 'standard' && ex.company.rhythm.sprintEndedOn === '2026-11-15' && ex.company.rhythm.sprintUntil === '2026-11-14', ex.company.rhythm);
    ok('Z48 一按可續：再設衝刺即清結束日並重設期限', P.setPace(ex, { pace: 'sprint', today: '2026-11-15' }).company.rhythm.sprintUntil === '2026-11-18' && !P.setPace(ex, { pace: 'sprint', today: '2026-11-15' }).company.rhythm.sprintEndedOn);
  }
  { // Z49
    ok('Z49 當日多件全無輸入亦無進展 → 只加一；連續兩日自動停', P.dailyStreak(0, [{}, {}, {}]).streak === 1 && !P.dailyStreak(0, [{}, {}]).autoStop && P.dailyStreak(1, [{}, {}, {}]).autoStop);
    ok('Z49 當日任何一件有創辦人輸入或經核實進展 → 重設', P.dailyStreak(1, [{}, { advanced: true }]).streak === 0 && P.dailyStreak(1, [{ hadInput: true }]).streak === 0);
  }

  /* ===== 戊、升級與人員 ===== */
  { // Z50
    const first = { peopleSync: 2, roles: 2, checkup: 2, opportunities: 1, daily: P.startsPerItem(true) };
    const total = Object.values(first).reduce((a, b) => a + b, 0);
    ok('Z50 升級後第一次日常工作最差次數 2＋2＋2＋1＋6 ＝ 13 ≤ 40（必修 6 重算）', total === 13 && total <= P.PACES.standard.fuse, first);
    ok('Z50 擬崗位在整理名單之後：沒有成員時 supports 只可為空', !R.checkRoleCards({ cards: [{ ...CARDS.cards[0], supports: ['pc-lee'] }], unassigned: [{ milestoneId: 'm2', why: 'x' }, { milestoneId: 'm3', why: 'x' }, { milestoneId: 'm4', why: 'x' }] }, { ...CTX(base()), actors: [] }).ok);
    const sprintWorst = P.PACES.sprint.itemsPerDay * P.startsPerItem(true), standing = 2 + 2 + 2 + 1 + 7;
    ok('Z50 衝刺 10 件最差 60 次，加恆常（名單 2、崗位 2、體檢 2、商機 1、紅藍對打 7）＝ 74 ≤ 80', sprintWorst === 60 && sprintWorst + standing === 74 && sprintWorst + standing <= P.PACES.sprint.fuse);
  }
  { // Z51
    const s = base();
    const w = R.ensurePermissions(s);
    ok('Z51 概覽確認後寫入三格預設、source default；不碰 page／confirmed（狀態內沒有這些鍵）', w.company.permissions.self.length > 0 && w.company.permissions.tellAfter.length > 0 && w.company.permissions.askFirst.includes('啟用崗位') && w.company.permissions.source === 'default' && !('page' in w) && !('confirmed' in w), w.company.permissions);
    ok('Z51 補寫時回新物件（外殼據此直接 saveState，不經 syncLedger 的比較欄）；已有即原樣；創辦人收窄後不覆寫（必修 9）', w !== s && R.ensurePermissions(w) === w && R.ensurePermissions({ company: { permissions: { self: [], tellAfter: [], askFirst: ['全部先問'], source: 'founder' } } }).company.permissions.askFirst[0] === '全部先問');
    ok('Z51 舊資料沒有 permissions → 讀取時用預設（角色卡有物可繼承）', R.permissionsOf(s) === R.PERMISSIONS_DEFAULT && R.inheritBounds(R.permissionsOf(s), { askFirst: ['聯絡任何餐廳'] }).askFirst.includes('聯絡任何餐廳'));
    ok('Z51 預設文字過內部用語檢查', [...R.PERMISSIONS_DEFAULT.self, ...R.PERMISSIONS_DEFAULT.tellAfter, ...R.PERMISSIONS_DEFAULT.askFirst].every(x => !styleIssues(x).length), [...R.PERMISSIONS_DEFAULT.self, ...R.PERMISSIONS_DEFAULT.tellAfter, ...R.PERMISSIONS_DEFAULT.askFirst].filter(x => styleIssues(x).length));
  }
  { // Z52
    const { state: s, ids } = withCards();
    ok('Z52 成員都在 → 沒有題', R.supportsReview(s).ask.length === 0 && R.supportsReview(s).paused.length === 0);
    const left = deep(s); left.company.actors[0].team.state = 'left';
    const rv = R.supportsReview(left);
    ok('Z52 成員離開 → 每張支援該成員的卡出一題', rv.ask.length === 1 && rv.ask[0].teammateId === ids[0] && rv.ask[0].name === '李家欣', rv);
    const ap = R.applySupportsLeft(left, { teammateId: ids[0], actorId: 'pc-lee', now: NOW });
    ok('Z52 確認後 supports 移除該成員；名單不刪對象；歷史不改', ap.teammates[0].supports.length === 0 && ap.company.actors.length === 5 && J(R.applySupportsLeft(ap, { teammateId: ids[0], actorId: 'pc-lee' })) === J(ap));
    const pz = deep(s); pz.company.actors[0].team.state = 'paused';
    ok('Z52 成員暫停 → 不改 supports，只顯示「原支援〈姓名〉，暫停期間支援你」', R.supportsReview(pz).ask.length === 0 && R.supportsReview(pz).paused[0].name === '李家欣' && R.supportsLines(pz.teammates[0], pz.company.actors)[0].paused === true && R.supportsLines(s.teammates[0], s.company.actors)[0].role === '採購');
  }
  { // Z56 校對計數分開顯示（校對＋校對重寫），費用照實
    const c = P.countStarts(['2026-11-10T21:00\twork\tR2', '2026-11-10T21:20\tproofread\tR2-pf', '2026-11-10T21:30\tqa-rewrite\tR2-rw', '2026-11-10T21:50\tproofread\tR2-pf2', '2026-11-10T22:00\troles\tR2-roles', '2026-11-10T22:10\troles-repair\tR2-roles'], TODAY);
    ok('Z56 系統頁「今日 Zero 工作 a／b 次（其中校對 n 次）」：a 計全部，n 只計校對及校對重寫；擬崗位及修正歸 roles', c.total === 6 && P.proofreadStarts(c) === 3 && c.roles === 2 && P.usageView(P.setPace(base(), { pace: 'sprint', today: TODAY }), c).fuse === 80);
    ok('Z56 估計表與每件最差 6、典型 2.1 一致', P.STARTS_PER_ITEM.worst === 6 && Math.round(P.STARTS_PER_ITEM.typical * 10) + 10 === P.PACE_ESTIMATE.sprint.typical * 1 + 9 && P.PACE_ESTIMATE.sprint.typical === 22);
  }

  /* ===== 新字句全部過內部用語檢查（資料約定第 11 節） ===== */
  {
    const TEXT = ['待啟用', '已啟用', '暫停', '已併入', '已取消', 'Zero 統籌', '派工、校對，並承擔不屬任何崗位的工作', '確認 Zero 崗位', '照 Zero 建議，全部確認', '由 Zero 承擔', '改名', '不要這個崗位', '名稱未能採用：名稱太長。已保留 Zero 建議的名稱', '接受即啟用餐廳拓展經理', '退回重做', '接受，但我想改方向', '這個崗位的啟用任務已退回兩次。改崗位卡，還是取消這個崗位？', '改崗位卡', '取消這個崗位', '支援李家欣（採購）', '原支援李家欣，暫停期間支援你', '今日連續兩件卡住，等候：農場甲回覆價格', '崗位已超過建議數目', '崗位已有六個。先把「客戶服務專員」併入「餐廳拓展經理」？', '不合併，照加', '「餐廳拓展經理」負責的事太多，拆成「餐廳拓展經理」及「投資者關係經理」？', '加一站「首次媒體報道刊出」？', '加崗位「市場推廣及媒體主任」？', '因不加站而不成立', '這一站暫由 Zero 統籌承擔', 'Zero 建議加一個崗位「投資者關係經理」，負責「投資者簡報」', '李家欣已離開團隊。「農場採購專員」改為支援你？', '餐廳拓展經理交付 · 統籌已校對', '牌照及保險主任交付 · 已核對', '農場採購專員交付 · 統籌校對後仍有 1 處要留意', '統籌校對中', '標準（每日 1 件）', '加速（每日最多 3 件）', '衝刺（連續做至需要你決定或當日做滿 10 件）', '估計每日 AI 工作 22 至 60 次', '衝刺至 11 月 14 日', '衝刺已於 11 月 15 日結束，已回到標準', '再衝刺', '衝刺暫停：有 12 份產出等你驗收，驗收後自動恢復', '衝刺暫停：已有兩日沒有收到你的回覆，回覆後自動恢復', '今日 Zero 工作 7／80 次（其中校對 2 次）', '每日上限只作保險絲', '每件工作的時間上限由 AI 工具決定（約 10 至 15 分鐘）', '今日 Zero 交付', '今日已滿 10 件', '可以做的工作已做完', '等候你決定 2 題', '今日 Zero 工作次數已達上限，餘下工作明日繼續', '今日時間已到，未完成的一件明日繼續', 'AI 工具連續兩次失敗，今日停止', '兩個崗位今日已暫停，今日停止', '有 12 份產出等你驗收，衝刺暫停', '兩日沒有收到你的回覆，衝刺暫停', '衝刺已到期', '你已改回標準，今日餘下工作明日繼續', '你已暫停 Zero，今日停止', 'Zero 交了 3 份，只收兩份', '工作說明未能齊備，已改用通用說明'];
    const hits = TEXT.map(t => [t, styleIssues(t)]).filter(([, h]) => h.length);
    ok('新字句 ' + TEXT.length + ' 句全部通過內部用語檢查', TEXT.length === 63 && hits.length === 0, hits);
    const titles = ['農場採購專員', '餐廳拓展經理', '牌照及保險主任', '市場推廣及媒體主任', '學校拓展經理'];
    ok('原型四個稱號及「學校拓展經理」全部通過命名核對（含與名單比對）', titles.every(t => R.checkTitle(t, { actors: base().company.actors, styleIssues }).ok), titles.map(t => R.checkTitle(t, { actors: base().company.actors, styleIssues })));
    ok('示範資料舊名（採購伙伴、合規助理、餐廳拓展）不合命名規則，須改名', ['採購伙伴', '合規助理', '餐廳拓展'].every(t => !R.checkTitle(t, { styleIssues }).ok));
    ok('機械組名後備：領域＋職能＋專員', R.fallbackTitle('農場', '採購') === '農場採購專員' && R.checkTitle(R.fallbackTitle('農場', '採購'), { styleIssues }).ok);
  }
  /* ===== 純函數規矩：不改傳入狀態 ===== */
  {
    const s = base(), before = J(s);
    R.checkRoleCards(CARDS, CTX(s)); R.ensurePermissions(s); P.setPace(s, { pace: 'sprint', today: TODAY }); R.rolesDue(s); P.nextStop(s, {}); P.orderCanDo(s, { today: TODAY }); R.stationRequest(s, {});
    const { state: sc } = withCards(s); const b2 = J(sc);
    R.applyActivation(sc, { teammateId: sc.teammates[0].id, answer: 'accept', now: NOW }); R.pauseCard(sc, { teammateId: sc.teammates[0].id }); R.mergeCards(sc, { fromId: sc.teammates[1].id, intoId: sc.teammates[0].id }); R.autoPauseCards(sc, { items: [], today: TODAY }); R.recardAfterRoute(sc); P.applyItemEnding(sc, { taskId: 't1', ending: 'artifact', today: TODAY }); R.markRolesDrafted(sc, {});
    ok('純函數不改傳入的狀態', J(s) === before && J(sc) === b2);
  }
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
}

const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 1200)));
const covered = ROWS.filter(id => results.some(r => new RegExp('^' + id + '(\\D|$)').test(r.name)));
const missing = ROWS.filter(id => !covered.includes(id));
console.log(`\n狀態表覆蓋：${covered.length}/${ROWS.length}${missing.length ? '；未覆蓋：' + missing.join('、') : ''}`);
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length && !missing.length ? 0 : 1);
