// Zero 團隊分工：崗位卡純函數（0.41.0，設計稿；唯一定義處）。輸入「舊狀態＋事件」，輸出「新狀態」或判定；不讀寫檔、不讀時鐘、不開程序（日期與核對函數由呼叫者傳入）。
// 規矩同 ledger-ops.mjs／people-ops.mjs：不改傳入的 state（先複製）；同一事件做兩次結果相同（冪等）；失敗或拒絕時回傳原樣。
// 欄位以 docs/evidence/zero-roles-2026-11-08/data-contract-041.md 為準；狀態表見同資料夾 state-table-041.md（Z1–Z52）。
import { norm, nameKeys, hasContactInfo, isLive, kindOf, teamStateOf, isMerged as actorMerged, resolveActorId } from './people-ops.mjs';
import { DELIVERABLE_TYPES, addDays } from './pace-lib.mjs';
export { DELIVERABLE_TYPES };

const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const str = (v, n) => typeof v === 'string' && v.trim() && v.trim().length <= n;
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export const LIFECYCLES = ['planned', 'enabled', 'paused', 'merged', 'retired'];   // retired＝退回兩次後取消（Z10），不佔軟上限、不負責任何站
export const RANKS = ['專員', '主任', '經理'];
export const TITLE_MIN = 4, TITLE_MAX = 10;
export const FIRST_MAX = 4;          // 首次擬崗位最多四張
export const SOFT_CAP = 6;           // 已啟用＋待啟用的軟上限
export const PACK_MAX = 3;           // 每批確認題最多三題
export const RETURN_LIMIT = 2;       // 啟用任務退回兩次即出「改卡或取消」題
export const TARGET_KINDS = ['customer', 'partner', 'investor'];
export const SUPPORT_KINDS = ['team', 'advisor'];
// 與頭像線的檔名一致（prototypes/proofread/assets/crew-role-<kind>.webp；統籌另用 lead）
export const AVATAR_KINDS = ['outreach', 'content', 'partner', 'procurement', 'compliance', 'marketing', 'finance', 'operations'];
export const AVATAR_LEAD = 'lead';
// 稱號職能詞 → 頭像類別（按出現先後取第一個命中；推不出用 operations）
const AVATAR_WORDS = [['市場推廣', 'marketing'], ['推廣', 'marketing'], ['媒體', 'marketing'], ['宣傳', 'marketing'], ['採購', 'procurement'], ['供應', 'procurement'], ['牌照', 'compliance'], ['合規', 'compliance'], ['保險', 'compliance'], ['法務', 'compliance'], ['財務', 'finance'], ['會計', 'finance'], ['融資', 'finance'], ['伙伴', 'partner'], ['合作', 'partner'], ['分工', 'partner'], ['內容', 'content'], ['課程', 'content'], ['診斷', 'content'], ['研究', 'content'], ['拓展', 'outreach'], ['銷售', 'outreach'], ['客戶', 'outreach'], ['營運', 'operations'], ['物流', 'operations'], ['配送', 'operations']];
export const avatarKindOf = title => { const t = String(title || ''); const hit = AVATAR_WORDS.find(([w]) => t.includes(w)); return hit ? hit[1] : 'operations'; };

// 稱號禁用：不含 Zero／英文／數字／編號；不以真人稱謂收尾；不用口語稱呼
const BAD_SUFFIX = /(先生|小姐|女士|校長|老師|博士|顧問|教授|醫生|律師)$/;
const BAD_WORDS = ['幫手', '拍檔', '伙伴', '助理', '助手', '隊員', '成員'];
const CJK = /^[㐀-鿿豈-﫿]+$/;

/* ---------- 三格權限預設（原規劃書 3.7；寫入 company.permissions，角色卡由此繼承） ---------- */
export const PERMISSIONS_DEFAULT = {
  self: ['讀取與分析公司紀錄內的檔案', '上網研究、核對與查證，每條引用附出處', '起草內部文件與草稿（訊息草稿、簡介、清單、研究摘要）', '有訊號時草擬路線建議，不自行啟動', '更新工作、事件與系統狀態', '處理交來的資料並歸檔', '準備訪問問題'],
  tellAfter: ['因訪問或資料而更新商業模式讀解與假設', '同一站內新增或重排工作', '擬新崗位卡及其啟用任務', '為對話或筆記中的事實建立確認題', '清走「等待對方回覆」標記'],
  askFirst: ['任何對外發送（電郵、訊息、填表、登入、留言、發布、付款、提交）', '花錢或簽約', '作出承諾（價格、日期、條件）', '啟用崗位', '同時開第二站', '把暫定值定案', '改變站的次序或目標', '改動已確認站的標題、事件、證明、交付條件或目標日期', '採用路線選項、撤回站、轉向', '刪除或移走你的檔案', '安裝軟件或其他不可回復的操作', '新功能', '最終交付品質驗收']
};
// 公司概覽確認後（或已確認舊公司缺此欄）寫入預設；已有即原樣（不覆寫創辦人收窄後的內容）。只寫 state.company，不碰 page／confirmed。
export function ensurePermissions(state, { source = 'default' } = {}) {
  const p = state && state.company && state.company.permissions;
  if (p && Array.isArray(p.self) && Array.isArray(p.tellAfter) && Array.isArray(p.askFirst)) return state;
  const s = clone(state || {}); s.company = s.company || {};
  s.company.permissions = { ...clone(PERMISSIONS_DEFAULT), source };
  return s;
}
export const permissionsOf = state => { const p = state && state.company && state.company.permissions; return p && Array.isArray(p.askFirst) ? p : PERMISSIONS_DEFAULT; };

/* ---------- 讀取 ---------- */
export const titleOf = t => String((t && (t.title || t.name)) || '');
export const liveCards = state => ((state && state.teammates) || []).filter(t => t && t.lifecycle !== 'merged' && t.lifecycle !== 'retired');
export const cardById = (state, id) => ((state && state.teammates) || []).find(t => t && t.id === id) || null;
// 沿 mergedInto 解到最終卡（最多 10 層）
export function resolveCardId(state, id) {
  const seen = new Set(); let cur = id;
  for (let i = 0; i < 10 && cur; i++) { const c = cardById(state, cur); if (!c || seen.has(cur)) return ''; if (!c.mergedInto) return cur; seen.add(cur); cur = c.mergedInto; }
  return '';
}
export const isPausedToday = (t, today) => !!t && (t.lifecycle === 'paused' || (t.pausedAuto === true && (!today || t.pausedOn === today)));
// 某站的負責崗位（未合併；不論啟用狀態）
export const ownerOfStation = (state, milestoneId) => liveCards(state).find(t => (t.milestoneIds || []).includes(milestoneId)) || null;
export const countedCards = state => liveCards(state).filter(t => ['planned', 'enabled'].includes(t.lifecycle || 'planned'));
export const overCap = state => countedCards(state).length >= SOFT_CAP;

/* ---------- 稱號核對（第 2.5 節）。actors：名單；roleTexts：名單內真人職銜；styleIssues：names.js 的檢查（由呼叫者傳入） ---------- */
export function checkTitle(title, { actors = [], extraNames = [], styleIssues = () => [], existingTitles = [] } = {}) {
  const t = String(title == null ? '' : title).trim(), errors = [];
  if (!t) return { ok: false, errors: ['稱號不可為空'] };
  if (!CJK.test(t)) errors.push('稱號只可用中文，不含英文、數字或符號');
  if (/zero/i.test(t)) errors.push('稱號不含「Zero」');
  if (t.length < TITLE_MIN || t.length > TITLE_MAX) errors.push(`稱號須為 ${TITLE_MIN} 至 ${TITLE_MAX} 個中文字`);
  if (!RANKS.some(r => t.endsWith(r))) errors.push('稱號須以「專員」「主任」或「經理」結尾');
  if (BAD_SUFFIX.test(t)) errors.push('稱號不可以真人稱謂結尾');
  for (const w of BAD_WORDS) if (t.includes(w)) { errors.push('稱號不用「' + w + '」一類稱呼'); break; }
  if (hasContactInfo(t)) errors.push('稱號不可含聯絡方式');
  if (styleIssues(t).length) errors.push('稱號有內部用語、編號或口語');
  const k = norm(t);
  // 只與名單內的真人（成員、顧問）比對；機構名（客戶、合作方）不比對，否則「學校拓展經理」會因名單有「學校」被拒（覆核建議 c）
  for (const a of actors || []) {
    if (!a || actorMerged(a) || !SUPPORT_KINDS.includes(kindOf(a))) continue;
    const keys = nameKeys(a);
    if (keys.some(x => x && (x === k || x.includes(k) || k.includes(x)))) { errors.push('稱號與名單內「' + a.name + '」相似'); break; }
    if (a.role && norm(a.role) === k) { errors.push('稱號不可用名單內真人的職銜「' + a.role + '」'); break; }
  }
  for (const n of extraNames || []) { const x = norm(n); if (x && (x === k || x.includes(k) || k.includes(x))) { errors.push('稱號與擱置中的新對象「' + n + '」相似'); break; } }
  if ((existingTitles || []).some(x => norm(x) === k)) errors.push('已有同名崗位');
  return { ok: !errors.length, errors };
}
// 第 2.5 節第 5 條：再不合格時以「領域＋職能＋專員」機械組名
export const fallbackTitle = (domain, func) => clip(String(domain || '').trim() + String(func || '').trim(), TITLE_MAX - 2) + '專員';

/* ---------- bounds：Zero 只寫「加條」（可只列新增的條目，亦可連同預設一併列出）；寫入時由 inheritBounds 併入公司預設，所以結果永不少於預設（只可加不可減） ---------- */
export function checkBounds(bounds, permissions) {
  const b = bounds && typeof bounds === 'object' ? bounds : {}, errors = [];
  for (const k of ['tellAfter', 'askFirst']) {
    const list = Array.isArray(b[k]) ? b[k] : null;
    if (!list) { errors.push(`bounds.${k} 必須是清單`); continue; }
    if (list.some(x => !str(x, 60))) errors.push(`bounds.${k} 每條須為一句（最多 60 字）`);
    if (list.length > 12) errors.push(`bounds.${k} 最多 12 條`);
  }
  return { ok: !errors.length, errors };
}
// 已鎖定的 bounds 只可收窄（加條），不可減條：newBounds 必須包含 locked 的每一條
export const boundsNotLoosened = (locked, next) => ['tellAfter', 'askFirst'].every(k => { const have = new Set(((next || {})[k] || []).map(norm)); return ((locked || {})[k] || []).every(x => have.has(norm(x))); });
export const inheritBounds = (permissions, extra = {}) => { const p = permissions || PERMISSIONS_DEFAULT; const add = (base, more) => [...new Set([...(base || []), ...((Array.isArray(more) ? more : []).filter(x => str(x, 60)).map(x => x.trim()))])]; return { tellAfter: add(p.tellAfter, extra.tellAfter), askFirst: add(p.askFirst, extra.askFirst) }; };

/* ---------- 擬崗位核對（Z2）：Zero 交回 out/roles.json { cards: [...], unassigned: [{ milestoneId, why }] } ----------
   ctx：{ state, actors, extraNames, styleIssues, inputIds, first（首次擬崗位，最多四張）, lenient（第二次：只丟棄不合格卡）, today }
   回傳 { ok, errors, cards, unassigned, dropped } */
export function checkRoleCards(raw, ctx = {}) {
  const { state = {}, actors = ((state.company || {}).actors || []), extraNames = [], styleIssues = () => [], inputIds = [], first = false, lenient = false } = ctx;
  const errors = [], cards = [], dropped = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cards)) return { ok: false, errors: ['out/roles.json 必須有 cards 清單'], cards, unassigned: [], dropped };
  const bad = (at, msg, title) => { if (lenient) dropped.push({ title, reason: msg }); else errors.push(at + '：' + msg); return null; };
  const ms = (state.milestones || []).filter(m => m && m.pathStatus !== 'retired');
  const msIds = new Set(ms.map(m => m.id));
  const confirmedIds = ms.filter(m => m.pathStatus === 'confirmed' || m.pathStatus === 'trial').map(m => m.id);
  const existing = liveCards(state), existingTitles = existing.map(titleOf);
  const ownerByStation = new Map(); for (const t of existing) for (const id of t.milestoneIds || []) ownerByStation.set(id, titleOf(t));
  const permissions = permissionsOf(state);
  const liveActorIds = new Set((actors || []).filter(a => isLive(a) && SUPPORT_KINDS.includes(kindOf(a))).map(a => a.id));
  const inputSet = new Set(inputIds);
  const titlesSeen = new Set();
  let list = raw.cards;
  if (first && list.length > FIRST_MAX) { if (lenient) { list.slice(FIRST_MAX).forEach(c => dropped.push({ title: String((c && (c.title || c.name)) || ''), reason: '首次最多四個崗位' })); list = list.slice(0, FIRST_MAX); } else errors.push(`首次最多擬 ${FIRST_MAX} 個崗位（交了 ${list.length} 個）`); }
  list.forEach((c, i) => {
    const at = `cards 第 ${i + 1} 項`, title = String((c && (c.title || c.name)) || '').trim();
    if (!c || typeof c !== 'object') return bad(at, '格式不正確', '');
    if ('parentId' in c || 'children' in c || 'subRoles' in c) return bad(at, '崗位只有一層，不可有子角色欄', title);
    const tc = checkTitle(title, { actors, extraNames, styleIssues, existingTitles });
    if (!tc.ok) return bad(at, tc.errors[0], title);
    if (titlesSeen.has(norm(title))) return bad(at, '同一批內稱號重複', title); titlesSeen.add(norm(title));
    if (!str(c.mission, 60)) return bad(at, '缺少使命 mission（一句，最多 60 字）', title);
    if (!Array.isArray(c.milestoneIds) || !c.milestoneIds.length) return bad(at, '崗位跟站走：milestoneIds 不可為空', title);
    if (c.milestoneIds.some(id => !msIds.has(id))) return bad(at, '有不存在或已撤回的站', title);
    for (const id of c.milestoneIds) { if (ownerByStation.has(id)) return bad(at, `站已有負責崗位「${ownerByStation.get(id)}」，每站只可一個`, title); }
    if (!Array.isArray(c.how) || !c.how.length || c.how.length > 3 || c.how.some(x => !str(x, 40))) return bad(at, '做法 how 須為 1 至 3 條，每條最多 40 字', title);
    if (!str(c.strategy, 80)) return bad(at, '缺少策略 strategy（一句，最多 80 字）', title);
    const supports = Array.isArray(c.supports) ? c.supports : [];
    if (supports.some(id => !liveActorIds.has(resolveActorId(actors, id)))) return bad(at, 'supports 只可指向名單內的團隊成員或顧問', title);
    const targets = Array.isArray(c.targets) ? c.targets : [];
    if (targets.some(k => !TARGET_KINDS.includes(k))) return bad(at, 'targets 只可是 ' + TARGET_KINDS.join('、'), title);
    const sources = Array.isArray(c.sources) ? c.sources : [];
    if (sources.some(x => x !== 'confirmedPage' && x !== 'web' && !inputSet.has(x))) return bad(at, 'sources 只可是 confirmedPage、web 或創辦人交過的文件編號', title);
    const deliverables = Array.isArray(c.deliverables) ? c.deliverables : [];
    if (!deliverables.length || deliverables.some(x => !DELIVERABLE_TYPES.includes(x))) return bad(at, 'deliverables 須為可交類型清單：' + DELIVERABLE_TYPES.join('、'), title);
    const knowledge = Array.isArray(c.knowledge) ? c.knowledge : [];
    if (knowledge.length > 6) return bad(at, '知識背景最多 6 條', title);
    for (const kn of knowledge) { if (!kn || !str(kn.text, 120) || !str(kn.source, 300) || !(kn.source === 'confirmedPage' || inputSet.has(kn.source) || /^https:\/\//.test(kn.source))) return bad(at, '知識背景每條須有 text 及來源 source（公司概覽、文件編號或網址）', title); }
    const bc = checkBounds(c.bounds || { tellAfter: [], askFirst: [] }, permissions);
    if (!bc.ok) return bad(at, bc.errors[0], title);
    for (const f of ['mission', 'strategy']) if (hasContactInfo(c[f]) || styleIssues(c[f]).length) return bad(at, f + ' 有聯絡方式、內部用語、編號或口語', title);
    for (const x of [...c.how, ...knowledge.map(k => k.text)]) if (hasContactInfo(x) || styleIssues(x).length) return bad(at, '做法或知識背景有聯絡方式、內部用語、編號或口語', title);
    const act = c.activation && typeof c.activation === 'object' ? c.activation : null;
    if (!act || !str(act.title, 40) || !str(act.deliverable, 80) || !c.milestoneIds.includes(act.milestoneId)) return bad(at, '啟用任務須有 title、deliverable，並屬該崗位負責的一站', title);
    for (const id of c.milestoneIds) ownerByStation.set(id, title);
    cards.push({ title, mission: c.mission.trim(), milestoneIds: [...new Set(c.milestoneIds)], supports: [...new Set(supports.map(id => resolveActorId(actors, id)))], targets: [...new Set(targets)], how: c.how.map(x => x.trim()), strategy: c.strategy.trim(),
      sources: [...new Set(['confirmedPage', ...sources])], deliverables: [...new Set(deliverables)], knowledge: knowledge.map(k => ({ text: k.text.trim(), source: k.source.trim() })), bounds: inheritBounds(permissions, c.bounds || {}),
      activation: { title: act.title.trim(), deliverable: act.deliverable.trim(), milestoneId: act.milestoneId }, avatarKind: AVATAR_KINDS.includes(c.avatarKind) ? c.avatarKind : avatarKindOf(title) });
  });
  // J1 保守做法：已確認而沒有負責崗位的站必須在 unassigned 列明（由統籌承擔）
  const un = Array.isArray(raw.unassigned) ? raw.unassigned.filter(u => u && msIds.has(u.milestoneId) && str(u.why, 80)).map(u => ({ milestoneId: u.milestoneId, why: u.why.trim() })) : [];
  const unSet = new Set(un.map(u => u.milestoneId));
  const missing = confirmedIds.filter(id => !ownerByStation.has(id) && !unSet.has(id));
  if (missing.length && !lenient) errors.push('已確認的站沒有負責崗位亦沒有說明：' + missing.join('、') + '（寫入 unassigned 並說明由統籌承擔的原因）');
  return { ok: !errors.length, errors, cards, unassigned: lenient ? un.concat(missing.map(id => ({ milestoneId: id, why: '暫由統籌承擔' }))) : un, dropped };
}
/* ---------- 擬崗位觸發（Z1）：state.rolesSync 照 peopleSync 形狀 { for, at, requested, packId, pending[], declined{}, lastTry, suggestedFor{} } ---------- */
export const rolesKey = s => { const st = s || {}; return st.ledgerFrom && st.intake && st.intake.confirmedAt ? st.ledgerFrom + '|' + st.intake.confirmedAt : ''; };
export function rolesDue(s, { packOpen = false, today = '' } = {}) {
  const st = s || {}, rs = st.rolesSync || {}, key = rolesKey(st);
  if (!key || st.demo === true) return { due: '', key };
  if (packOpen) return { due: '', key };
  if (Array.isArray(rs.pending) && rs.pending.length) return { due: 'batch', key };
  if (rs.requested) return { due: 'manual', key };
  if (rs.for === key) return { due: '', key };
  if (rs.lastTry && rs.lastTry.key === key && today && rs.lastTry.day === today) return { due: '', key };
  return { due: liveCards(st).length ? '' : 'auto', key };
}
// 擬崗位完成（核對通過、已出第一包）後寫入狀態（必修 5）：此版已擬、清 requested 及 lastTry、記未分配的站（由統籌承擔）及當時的站清單（之後新站以此判斷）
export function markRolesDrafted(state, { key = '', now = '', pending = [], unassigned = [], packId = '' } = {}) {
  const s = clone(state || {}); const rs = { ...(s.rolesSync || {}) }; delete rs.lastTry;
  s.rolesSync = { ...rs, for: key || rolesKey(s), at: now, requested: false, pending: clone(pending), ...(packId ? { packId } : {}), unassigned: (unassigned || []).map(u => ({ milestoneId: u.milestoneId, why: String(u.why || '').slice(0, 80) })),
    stationsAt: (s.milestones || []).filter(m => m && m.pathStatus !== 'retired').map(m => m.id) };
  return s;
}
// 擬崗位失敗：記 lastTry，當日不再自動重試；清 requested（畫面恢復按鈕）
export function markRolesFailed(state, { key = '', today = '', reason = '' } = {}) { const s = clone(state || {}); s.rolesSync = { ...(s.rolesSync || {}), requested: false, lastTry: { key: key || rolesKey(s), day: today, reason: String(reason || '').slice(0, 80) } }; return s; }
export const unassignedIds = state => new Set((((state || {}).rolesSync || {}).unassigned || []).map(u => u && u.milestoneId).filter(Boolean));
// 一批確認題：最多三張，其餘留 pending（Z3）。回 { items, rest }
export function nextRoleBatch(pending, declined = {}) {
  const live = (pending || []).filter(c => c && !(declined['title:' + norm(c.title)] > 0));
  return { items: live.slice(0, PACK_MAX), rest: live.slice(PACK_MAX) };
}

/* ---------- 確認題套用（Z4–Z6）：answer 'accept'｜'rename'｜'decline'；card 為 checkRoleCards 通過的卡 ---------- */
export const nextCardId = (packId, qid) => 'tm-' + String(packId || '').replace(/[^\w-]/g, '').slice(-24) + '-' + String(qid || '').replace(/[^\w-]/g, '').slice(0, 8);
export const activationTaskId = cardId => 'act-' + cardId;
export function applyRoleAnswer(state, { packId, qid, card, answer, newTitle = '', now = '', today = '', actors, styleIssues = () => [], extraNames = [] } = {}) {
  if (!card || !['accept', 'rename', 'decline'].includes(answer)) return state;
  const s = clone(state || {}); s.teammates = Array.isArray(s.teammates) ? s.teammates : []; s.rolesSync = s.rolesSync || {}; s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const acts = actors || ((s.company || {}).actors || []);
  const id = nextCardId(packId, qid);
  if (answer === 'decline') {
    const d = s.rolesSync.declined = s.rolesSync.declined || {};
    const tk = 'title:' + norm(card.title); if (d[tk] && d['decl:' + id]) return state;   // 冪等：同一題只記一次
    d[tk] = (d[tk] || 0) + 1; for (const m of card.milestoneIds || []) d['station:' + m] = (d['station:' + m] || 0) + 1; d['decl:' + id] = 1;
    s.rolesSync.pending = (s.rolesSync.pending || []).filter(c => norm(c.title) !== norm(card.title));
    return s;
  }
  if (s.teammates.some(t => t.id === id)) return state;   // 冪等
  let title = card.title, renameNote = '';
  if (answer === 'rename') {
    const chk = checkTitle(newTitle, { actors: acts, extraNames, styleIssues, existingTitles: liveCards(s).map(titleOf) });
    if (chk.ok) title = String(newTitle).trim(); else renameNote = chk.errors[0];
  }
  // 站若已被另一張卡佔用（同批先答的題），本卡不寫入（每站只可一個）
  if ((card.milestoneIds || []).some(m => ownerOfStation(s, m))) return state;
  const taskId = activationTaskId(id);
  const t = { id, title, name: title, mission: card.mission, milestoneIds: [...card.milestoneIds], supports: [...(card.supports || [])], targets: [...(card.targets || [])], how: [...(card.how || [])], strategy: card.strategy || '',
    sources: [...(card.sources || ['confirmedPage'])], deliverables: [...(card.deliverables || [])], knowledge: clone(card.knowledge || []), bounds: inheritBounds(permissionsOf(s), card.bounds || {}), lifecycle: 'planned', activationTaskId: taskId, activationReturns: 0,
    avatarKind: card.avatarKind || avatarKindOf(title), ...(now ? { createdAt: now, updatedAt: now } : {}) };
  s.teammates.push(t);
  if (!s.tasks.some(x => x && x.id === taskId)) s.tasks.push({ id: taskId, title: card.activation.title, owner: 'ai', status: 'planned', milestoneId: card.activation.milestoneId, teammateId: id, cadence: 'activation', next: card.activation.deliverable, needsAcceptance: true, ...(now ? { updatedAt: now } : {}) });
  s.rolesSync.pending = (s.rolesSync.pending || []).filter(c => norm(c.title) !== norm(card.title));
  return renameNote ? Object.assign(s, { rolesSync: { ...s.rolesSync, renameRejected: { [id]: renameNote } } }) : s;
}

/* ---------- 啟用任務驗收（Z7–Z10）：answer 'accept'｜'acceptRedirect'｜'return' ---------- */
export function applyActivation(state, { teammateId, answer, now = '', replyFile = '', cardHash = '' } = {}) {
  const s = clone(state || {}); const t = cardById(s, teammateId);
  if (!t || t.lifecycle === 'merged' || !t.activationTaskId) return state;
  const task = (s.tasks || []).find(x => x && x.id === t.activationTaskId);
  // M5：待啟用的卡在驗收題未答時被創辦人暫停（lifecycle 'paused'、lifecycleBefore 'planned'），之後才答驗收：照待啟用處理，並留在暫停（恢復時回到應有狀態）
  const pausedPlanned = t.lifecycle === 'paused' && t.lifecycleBefore === 'planned';
  if (answer === 'accept' || answer === 'acceptRedirect') {
    if (t.activation && (t.lifecycle === 'enabled' || (t.lifecycle === 'paused' && t.lifecycleBefore === 'enabled'))) return state;   // 冪等
    if (t.lifecycle !== 'planned' && !pausedPlanned) return state;
    if (pausedPlanned) t.lifecycleBefore = 'enabled'; else t.lifecycle = 'enabled';
    t.activation = { taskId: t.activationTaskId, acceptedAt: now, replyFile, cardHash };
    t.bounds = { ...(t.bounds || inheritBounds(permissionsOf(s))), lockedAt: now }; if (now) t.updatedAt = now;
    if (task) { task.status = 'done'; task.acceptedBy = 'founder'; if (now) task.updatedAt = now; }
    return s;
  }
  if (answer === 'return') {
    if (t.lifecycle !== 'planned' && !pausedPlanned) return state;
    t.activationReturns = (t.activationReturns || 0) + 1; if (now) t.updatedAt = now;
    if (t.activationReturns < RETURN_LIMIT) { if (task) { task.status = 'active'; delete task.acceptedBy; if (now) task.updatedAt = now; } }
    else if (task) { task.status = 'waiting'; task.waitingFor = '等你決定：改崗位卡，還是取消這個崗位'; }
    return s;
  }
  return state;
}
export const needsRecard = t => !!t && t.lifecycle === 'planned' && (t.activationReturns || 0) >= RETURN_LIMIT;
// 「改卡或取消」題的套用（Z10）：answer 'recard'（以 Zero 重擬並經核對的 card 取代欄位、重設退回次數、新啟用任務）／'cancel'（lifecycle: retired，啟用任務取消，不佔軟上限、不負責任何站）
export function applyRecard(state, { teammateId, answer, card, now = '' } = {}) {
  const s = clone(state || {}); const t = cardById(s, teammateId);
  if (!t || !needsRecard(t)) return state;
  const task = (s.tasks || []).find(x => x && x.id === t.activationTaskId);
  if (answer === 'cancel') {
    t.lifecycle = 'retired'; t.retiredReason = '啟用任務退回兩次後取消'; if (now) t.updatedAt = now;
    if (task) { task.status = 'cancelled'; delete task.waitingFor; if (now) task.updatedAt = now; }
    for (const x of s.tasks || []) if (openTask(x) && x.teammateId === t.id) x.teammateId = '';
    return s;
  }
  if (answer === 'recard') {
    if (!card || !card.activation || !(card.milestoneIds || []).includes(card.activation.milestoneId)) return state;
    if ((card.milestoneIds || []).some(m => { const o = ownerOfStation(s, m); return o && o.id !== t.id; })) return state;
    for (const k of ['mission', 'how', 'strategy', 'sources', 'deliverables', 'knowledge', 'targets', 'supports']) if (card[k] !== undefined) t[k] = clone(card[k]);
    if (card.title) { t.title = card.title; t.name = card.title; t.avatarKind = card.avatarKind || avatarKindOf(card.title); }
    t.milestoneIds = [...card.milestoneIds]; t.bounds = inheritBounds(permissionsOf(s), card.bounds || {}); t.activationReturns = 0; if (now) t.updatedAt = now;
    if (task) { task.status = 'cancelled'; delete task.waitingFor; }
    const newTaskId = activationTaskId(t.id) + '-' + ((s.tasks || []).filter(x => x && String(x.id).startsWith(activationTaskId(t.id))).length + 1);
    t.activationTaskId = newTaskId;
    s.tasks = Array.isArray(s.tasks) ? s.tasks : [];
    s.tasks.push({ id: newTaskId, title: card.activation.title, owner: 'ai', status: 'planned', milestoneId: card.activation.milestoneId, teammateId: t.id, cadence: 'activation', next: card.activation.deliverable, needsAcceptance: true, ...(now ? { updatedAt: now } : {}) });
    return s;
  }
  return state;
}

/* ---------- 暫停與恢復（Z11–Z13） ---------- */
const openTask = x => x && !['done', 'cancelled'].includes(x.status);
export function pauseCard(state, { teammateId, reason = '', now = '' } = {}) {
  const s = clone(state || {}); const t = cardById(s, teammateId);
  if (!t || !['planned', 'enabled'].includes(t.lifecycle || 'planned')) return state;
  t.lifecycleBefore = t.lifecycle || 'planned'; t.lifecycle = 'paused'; t.pausedReason = clip(reason, 80); if (now) t.updatedAt = now;
  for (const x of s.tasks || []) if (openTask(x) && x.teammateId === t.id && x.id !== t.activationTaskId) { x.teammateIdBefore = x.teammateId; x.teammateId = ''; }
  return s;
}
export function resumeCard(state, { teammateId, now = '' } = {}) {
  const s = clone(state || {}); const t = cardById(s, teammateId);
  if (!t || t.lifecycle !== 'paused') return state;
  t.lifecycle = t.lifecycleBefore || (t.activation ? 'enabled' : 'planned'); delete t.lifecycleBefore; delete t.pausedReason; if (now) t.updatedAt = now;
  for (const x of s.tasks || []) if (openTask(x) && x.teammateIdBefore === t.id) { x.teammateId = t.id; delete x.teammateIdBefore; }
  return s;
}
// 崗位層面：同一崗位當日連續兩件 blocked → pausedAuto（當日有效）。items：當日已收尾的件 [{ teammateId, ending, waitingFor }]（按次序）
export function autoPauseCards(state, { items = [], today = '' } = {}) {
  const s = clone(state || {}); let changed = false;
  for (const t of liveCards(s)) {
    if (t.pausedAuto && t.pausedOn !== today) { delete t.pausedAuto; delete t.pausedOn; if (t.pausedReason && t.pausedReason.startsWith('等候：')) delete t.pausedReason; changed = true; }
    const mine = items.filter(i => i && i.teammateId === t.id);
    const last2 = mine.slice(-2);
    if (last2.length === 2 && last2.every(i => i.ending === 'blocked') && !(t.pausedAuto && t.pausedOn === today)) { t.pausedAuto = true; t.pausedOn = today; t.pausedReason = '等候：' + clip(last2[1].waitingFor || last2[1].blockedOn || '你的決定', 60); changed = true; }
  }
  return changed ? s : state;
}
export const pausedCardsToday = (state, today) => liveCards(state).filter(t => isPausedToday(t, today));

/* ---------- 中途加崗位（Z14–Z17）、Zero 主動建議（Z18）、軟上限（Z19） ---------- */
// 創辦人輸入含加崗位要求
export const wantsRole = text => /(加|多|新增|增設|設)\s*(一個|一位|個)?\s*[^，。；]{0,12}?(崗位|職位|角色)|多一個人負責|多個人負責/.test(String(text || '').replace(/\s+/g, ''));
// 加站（必修 2）：純函數不寫 state.milestones（syncLedger 每次按公司概覽頁重建，直接寫入會被刪）。只產生現有「改次序／加一站」確認題同一形狀的套用要求
// { order: [...現有路線編號, 'new'], add: { short, event, witness, evidence, deliveryCondition, targetDate } }，由 run.mjs applyOrder 寫 page.json 及 confirmed.json 再 syncLedger；新站編號由 applyOrder 配（'m' + n）。
// station 四格：事件（event）、負責人（witness，即「要點頭的人」）、完成條件（deliveryCondition）、真實證據形式（evidence）。四格不齊回 null。
// 站名 short 上限 12 字（與 run.mjs markRequest 第 580 行的現有加站核對一致）、event 120 字。
// 接入點：真實公司的 applyOrder（第 679–682 行）現時只把 short、event、targetDate 寫入 page.json／confirmed.json，witness、evidence、deliveryCondition 會丟失——
// 實作時 applyOrder 須把這三欄一併寫入 page.path.milestones[] 新站，syncLedger 的 milestonesFromPage 亦須帶過去；示範帳本路徑（第 665 行）已保留。
export const STATION_SHORT_MAX = 12, STATION_EVENT_MAX = 120;
export function stationRequest(state, station) {
  const st = station || {};
  if (!str(st.short, STATION_SHORT_MAX) || !str(st.event, STATION_EVENT_MAX) || !str(st.witness, 40) || !str(st.deliveryCondition, 120) || !str(st.evidence, 120)) return null;
  const route = ((state || {}).milestones || []).filter(m => m && m.pathStatus === 'confirmed').sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99)).map(m => m.id);
  return { order: [...route, 'new'], add: { short: st.short.trim(), event: st.event.trim(), witness: st.witness.trim(), evidence: st.evidence.trim(), deliveryCondition: st.deliveryCondition.trim(), ...(isDay(st.targetDate) ? { targetDate: st.targetDate } : {}) } };
}
// 同批兩題的套用（Z15、Z16）：stationAnswer 'accept'｜'decline'；newStationId＝applyOrder 套用加站後、syncLedger 重建帳本內的新站編號（外殼讀 page.json 的 route 得出）。
// 不加站則加崗位不成立；加站已確認但帳本仍未有該站 → 原樣（等下一次套用），絕不讓卡指向不存在的站。
export function applyRoleWithStation(state, { packId, qid, stationAnswer, newStationId = '', card, roleAnswer, newTitle = '', now = '', today = '', styleIssues } = {}) {
  if (!card) return state;
  if (stationAnswer !== 'accept') { const s = clone(state || {}); s.rolesSync = { ...(s.rolesSync || {}), voided: { ...((s.rolesSync || {}).voided || {}), [nextCardId(packId, qid)]: 'noStation' } }; s.rolesSync.pending = (s.rolesSync.pending || []).filter(c => norm(c.title) !== norm(card.title)); return s; }
  if (!newStationId || !((state || {}).milestones || []).some(m => m && m.id === newStationId && m.pathStatus !== 'retired')) return state;
  const c2 = { ...card, milestoneIds: [...new Set([...(card.milestoneIds || []), newStationId])], activation: { ...card.activation, milestoneId: (card.activation && card.activation.milestoneId) || newStationId } };
  return applyRoleAnswer(state, { packId, qid, card: c2, answer: roleAnswer, newTitle, now, today, styleIssues });
}
// Zero 主動建議訊號（第 2.2 節入口二）。回 [{ kind: 'kind'|'station', key, milestoneIds, actorKind? }]，最多一個（每批最多一個；已建議或已拒絕的不再出）
export function suggestSignals(state, { today = '', days = 14, min = 3 } = {}) {
  const s = state || {}, rs = s.rolesSync || {}, seen = { ...(rs.suggestedFor || {}) }, declined = rs.declined || {};
  const since = isDay(today) ? addDays(today, -days) : '';
  const owned = new Set(liveCards(s).flatMap(t => t.milestoneIds || [])), un = unassignedIds(s);
  const known = Array.isArray(rs.stationsAt) ? new Set(rs.stationsAt) : null;   // 上次擬崗位時的站清單；沒有快照時只認 applyOrder 加入的站（addedBy: 'founder'）
  const out = [];
  // (2) 路線新增一站（上次擬崗位後才出現）而沒有負責崗位；J1 列明由統籌承擔的站不算
  for (const m of (s.milestones || []).filter(m => m && m.pathStatus === 'confirmed' && !owned.has(m.id) && !un.has(m.id))) {
    const key = 'station:' + m.id; if (seen[key] || declined[key]) continue;
    const isNew = known ? !known.has(m.id) : m.addedBy === 'founder';
    if (!isNew) continue;
    out.push({ kind: 'station', key, milestoneIds: [m.id] }); break;
  }
  // (1) 14 日內三件或以上由統籌完成、站無崗位、對象類別相同（類別以站的 actorKind，沒有就以要點頭的人 actorName 分組）
  if (!out.length) {
    const byKind = {};
    for (const t of (s.tasks || []).filter(t => t && t.status === 'done' && !t.teammateId && t.milestoneId && !owned.has(t.milestoneId) && (!since || String(t.doneOn || t.updatedAt || '').slice(0, 10) >= since))) {
      const m = (s.milestones || []).find(x => x && x.id === t.milestoneId); const ak = (m && (m.actorKind || m.actorName)) || t.actorKind || '';
      if (!ak) continue;
      (byKind[ak] = byKind[ak] || { n: 0, ms: new Set() }).n++; byKind[ak].ms.add(t.milestoneId);
    }
    for (const [ak, v] of Object.entries(byKind)) { const key = 'kind:' + ak; if (v.n >= min && !seen[key] && !declined[key]) { out.push({ kind: 'kind', key, milestoneIds: [...v.ms], actorKind: ak }); break; } }
  }
  return out.slice(0, 1);
}
export function markSuggested(state, { key, today = '' } = {}) { if (!key) return state; const s = clone(state || {}); s.rolesSync = { ...(s.rolesSync || {}), suggestedFor: { ...((s.rolesSync || {}).suggestedFor || {}), [key]: today } }; return s; }
export function declineSuggestion(state, { key } = {}) { if (!key) return state; const s = clone(state || {}); const d = { ...((s.rolesSync || {}).declined || {}) }; d[key] = (d[key] || 0) + 1; s.rolesSync = { ...(s.rolesSync || {}), declined: d }; return s; }

/* ---------- 拆分（Z20）、合併（Z21）、路線改變重擬（Z22） ---------- */
// 拆分訊號：負責 ≥ 3 個進行中／下一個的站而對象類別不同；或連續三件工作的「等候」分屬兩個對象。回 { split: boolean, why }
export function splitSignal(state, teammateId, { recent = [] } = {}) {
  const s = state || {}, t = cardById(s, teammateId); if (!t) return { split: false, why: '' };
  // 「進行中或下一個」：真實帳本的站狀態是 active／waiting／blocked／not_started／done；下一個＝路線次序最前的 not_started 站
  const all = (s.milestones || []).filter(m => m && m.pathStatus !== 'retired').sort((a, b) => (Number(a.order) || 99) - (Number(b.order) || 99));
  const next = all.find(m => m.state === 'not_started');
  const ms = all.filter(m => (t.milestoneIds || []).includes(m.id) && (['active', 'waiting', 'blocked'].includes(m.state) || (next && m.id === next.id)));
  const kinds = new Set(ms.map(m => m.actorKind || m.actorName).filter(Boolean));
  if (ms.length >= 3 && kinds.size >= 2) return { split: true, why: 'stations' };
  const waits = recent.filter(r => r && r.teammateId === t.id).slice(-3).map(r => r.waitingWho || '').filter(Boolean);
  if (waits.length === 3 && new Set(waits).size >= 2) return { split: true, why: 'waits' };
  return { split: false, why: '' };
}
// 拆分確認：keepIds 留在原卡，newCard（已過 checkRoleCards 的卡，milestoneIds 為拆出的站）
export function splitCard(state, { teammateId, keepIds = [], newCard, packId, qid, now = '', today = '' } = {}) {
  const s0 = state || {}, t0 = cardById(s0, teammateId);
  if (!t0 || t0.lifecycle === 'merged' || !newCard || !Array.isArray(keepIds) || !keepIds.length) return state;
  const moving = (t0.milestoneIds || []).filter(id => !keepIds.includes(id));
  if (!moving.length || keepIds.some(id => !(t0.milestoneIds || []).includes(id))) return state;
  const newId = nextCardId(packId, qid); if (cardById(s0, newId)) return state;   // 冪等
  let s = clone(s0); const t = cardById(s, teammateId);
  t.milestoneIds = [...keepIds]; t.splitInto = [...new Set([...(t.splitInto || []), newId])]; if (now) t.updatedAt = now;
  for (const x of s.tasks || []) if (openTask(x) && x.teammateId === t.id && moving.includes(x.milestoneId)) x.teammateId = newId;
  s = applyRoleAnswer(s, { packId, qid, card: { ...newCard, milestoneIds: moving }, answer: 'accept', now, today });
  return cardById(s, newId) ? s : state;
}
export function mergeCards(state, { fromId, intoId, now = '' } = {}) {
  const s = clone(state || {}); const from = cardById(s, fromId), into = cardById(s, resolveCardId(s, intoId));
  if (!from || !into || from.id === into.id || from.lifecycle === 'merged' || into.lifecycle === 'merged') return state;
  into.milestoneIds = [...new Set([...(into.milestoneIds || []), ...(from.milestoneIds || [])])];
  for (const x of s.tasks || []) if (openTask(x) && x.teammateId === from.id && x.id !== from.activationTaskId) x.teammateId = into.id;
  from.lifecycle = 'merged'; from.mergedInto = into.id; if (now) { from.updatedAt = now; into.updatedAt = now; }
  return s;
}
// 路線改變後：卡的站全被撤 → 暫停並標記重擬；已確認站無崗位 → 標記重擬。回新狀態（沒有改動原樣）
export function recardAfterRoute(state, { now = '' } = {}) {
  const s = clone(state || {}); let changed = false;
  const live = (s.milestones || []).filter(m => m && m.pathStatus !== 'retired').map(m => m.id);
  for (const t of liveCards(s)) {
    if ((t.milestoneIds || []).length && !(t.milestoneIds || []).some(id => live.includes(id)) && t.lifecycle !== 'paused') { t.lifecycleBefore = t.lifecycle || 'planned'; t.lifecycle = 'paused'; t.pausedReason = '負責的站已撤回'; if (now) t.updatedAt = now; changed = true; }
  }
  const owned = new Set(liveCards(s).filter(t => t.lifecycle !== 'paused').flatMap(t => t.milestoneIds || [])), un = unassignedIds(s);
  // 已確認站無崗位、不在 J1 的未分配清單、創辦人沒有拒絕過、而且是上次擬崗位後才出現的站 → 標記重擬（必修 5：未分配站及已知站不會令每次路線改變都重擬）
  const known = Array.isArray((s.rolesSync || {}).stationsAt) ? new Set(s.rolesSync.stationsAt) : null;
  const orphan = (s.milestones || []).some(m => m && m.pathStatus === 'confirmed' && !owned.has(m.id) && !un.has(m.id) && !((s.rolesSync || {}).declined || {})['station:' + m.id] && (known ? !known.has(m.id) : m.addedBy === 'founder'));
  if (orphan && !(s.rolesSync || {}).requested) { s.rolesSync = { ...(s.rolesSync || {}), requested: true }; changed = true; }
  return changed ? s : state;
}

/* ---------- 派工選擇（Z23、J8）：canDo 為外殼已排序的「可以做」清單（工作物件）。回 { task, teammateId, reason } ---------- */
export const COORDINATOR = '';   // teammateId 空＝統籌
export function pickAssignment(state, canDo, { today = '' } = {}) {
  const list = (canDo || []).filter(Boolean);
  if (!list.length) return { task: null, teammateId: COORDINATOR, reason: 'nothingToDo' };
  const task = list[0];
  if (!task.milestoneId) return { task, teammateId: COORDINATOR, reason: task.adhoc ? 'adhoc' : task.cadence === 'standing' ? 'standing' : 'noStation' };
  const t = ownerOfStation(state, task.milestoneId);
  if (!t) return { task, teammateId: COORDINATOR, reason: 'noOwner' };
  // 啟用任務永遠由該崗位做（當日自動暫停不改派，覆核建議 d）；創辦人暫停的卡連啟用任務都不派
  if (task.id === t.activationTaskId) return t.lifecycle === 'paused' ? { task, teammateId: COORDINATOR, reason: 'ownerPaused' } : { task, teammateId: t.id, reason: 'activation' };
  if (isPausedToday(t, today)) return { task, teammateId: COORDINATOR, reason: 'ownerPaused' };
  if ((t.lifecycle || 'planned') === 'planned') return { task, teammateId: COORDINATOR, reason: 'ownerPlanned' };
  return { task, teammateId: t.id, reason: 'owner' };
}

/* ---------- 人類成員離開（Z52）：supports 含離開成員的卡 → 確認題清單；暫停成員 → 顯示句 ---------- */
export function supportsReview(state) {
  const s = state || {}, actors = ((s.company || {}).actors || []);
  const out = { ask: [], paused: [] };
  for (const t of liveCards(s)) for (const id of t.supports || []) {
    const fid = resolveActorId(actors, id), a = actors.find(x => x && x.id === fid);
    if (!a || a.status === 'inactive' || (kindOf(a) === 'team' && teamStateOf(a) === 'left')) out.ask.push({ teammateId: t.id, actorId: id, name: a ? a.name : '' });
    else if (kindOf(a) === 'team' && teamStateOf(a) === 'paused') out.paused.push({ teammateId: t.id, actorId: id, name: a.name });
  }
  return out;
}
export function applySupportsLeft(state, { teammateId, actorId, now = '' } = {}) {
  const s = clone(state || {}); const t = cardById(s, teammateId);
  if (!t || !(t.supports || []).includes(actorId)) return state;
  t.supports = t.supports.filter(x => x !== actorId); if (now) t.updatedAt = now;
  return s;
}
// 角色卡顯示用的支援句（名稱由名單取；字句之後入 names.js）
export function supportsLines(card, actors) {
  return (card && card.supports || []).map(id => { const a = (actors || []).find(x => x && x.id === resolveActorId(actors, id)); if (!a) return null; const paused = kindOf(a) === 'team' && teamStateOf(a) === 'paused'; return { name: a.name, role: a.role || '', paused }; }).filter(Boolean);
}
