// 人物及機構名單：純函數（0.40.0，唯一定義處）。輸入「舊狀態＋事件」，輸出「新狀態」，不讀檔、不讀時鐘（日期由呼叫者傳入）。
// 規矩同 ledger-ops.mjs：不改傳入的 state（先複製）；同一事件做兩次結果相同（冪等）；失敗或拒絕時回傳原樣。
// 欄位以 docs/evidence/v0400-ui-2026-11-07/data-contract.md「人物及機構名單」為準；設計見 docs/evidence/people-2026-11-07/design.md。
// 明文邊界：不存電話、電郵、地址、社交帳號、薪酬、合約、表現；不設新增表格；新對象只可經確認題加入；永不刪除對象。

const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export const KINDS = ['customer', 'partner', 'investor', 'advisor', 'team'];
export const TEAM_TYPES = ['cofounder', 'fulltime', 'parttime', 'contractor'];
export const TEAM_STATES = ['active', 'paused', 'left'];
export const STATUSES = ['active', 'inactive'];
export const ADDED_FROM = ['overview', 'milestone', 'partners', 'event', 'doc', 'chat'];
export const MAX_ACTIVE = 80;
export const GAP_DAYS = 14;
export const NAME_MAX = 20, ORG_MAX = 40, ROLE_MAX = 40;

// 舊顯示字串（0.38.0 前的 kind）與新代碼對應；未知字串當供應或合作方，沒有值當客戶
const LEGACY = { '客戶': 'customer', '供應': 'partner', '投資者': 'investor', '顧問': 'advisor', '團隊成員': 'team' };
export const kindOf = a => { const k = a && a.kind; return KINDS.includes(k) ? k : LEGACY[k] || (k ? 'partner' : 'customer'); };
// 舊讀取處（推進板虛線邊框 /供應/、辯論席位 x.name === p.kind）仍靠這組舊顯示字串，直至畫面改用代碼
export const KIND_LEGACY_NAME = { customer: '客戶', partner: '供應', investor: '投資者', advisor: '顧問', team: '團隊成員' };
// 暫用顯示字（names.js 的名單鍵就緒後改由名稱表供應；畫面一律不直接用這組）
export const TXT = {
  kind: { customer: '客戶', partner: '供應或合作方', investor: '投資者或資助方', advisor: '顧問或協助者', team: '團隊成員' },
  added: '已加入名單：{n}（{k}）', aliased: '已記為「{n}」的另一個稱呼', skipped: '沒有加入名單：{n}'
};
const fill = (t, o) => String(t).replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

// 名稱比對用：NFKC、去空白、英文轉小寫
export const norm = s => String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
// 含電郵樣式或八位以上連續數字（去掉空格、短橫）者視為聯絡方式，不收
export const hasContactInfo = s => { const t = String(s == null ? '' : s).normalize('NFKC'); return /@/.test(t) || /\d{8,}/.test(t.replace(/[\s\-－–.．·()+]/g, '')); };

export const isMerged = a => !!(a && a.mergedInto);
// 沿 mergedInto 走到最終對象；最多 10 層，遇環或找不到回 ''
export function resolveActorId(actors, id) {
  const by = new Map((actors || []).map(a => [a.id, a])); const seen = new Set(); let cur = id;
  for (let i = 0; i < 10 && cur; i++) {
    const a = by.get(cur); if (!a || seen.has(cur)) return '';
    if (!a.mergedInto) return cur;
    seen.add(cur); cur = a.mergedInto;
  }
  return '';
}
export const teamStateOf = a => (a && a.team && TEAM_STATES.includes(a.team.state)) ? a.team.state : 'active';
// 在名單內、仍有效的對象：未合併、未標不再接觸、成員未離開
export const isLive = a => !!a && !isMerged(a) && a.status !== 'inactive' && !(kindOf(a) === 'team' && teamStateOf(a) === 'left');
export const liveActors = actors => (actors || []).filter(isLive);
// 配對用名稱：name 及 aliases（已經正規化、去重）
export const nameKeys = a => [...new Set([a && a.name, ...((a && a.aliases) || [])].map(norm).filter(Boolean))];
export const hasKey = (a, text) => { const t = norm(text); return !!t && nameKeys(a).some(k => t.includes(k)); };

// 完全相同的名稱（含已合併、不再接觸、離開者）
export const duplicateActor = (actors, name) => { const k = norm(name); return k ? (actors || []).find(a => nameKeys(a).includes(k)) || null : null; };
// 疑似變體：名稱互為子字串，或機構相同（非空）且首字相同；已合併者不比對
export function similarActor(actors, cand) {
  const k = norm(cand.name), org = norm(cand.org);
  if (!k) return null;
  return (actors || []).find(a => !isMerged(a) && (nameKeys(a).some(x => x !== k && (x.includes(k) || k.includes(x))) || (org && norm(a.org) === org && nameKeys(a).some(x => x[0] === k[0])))) || null;
}
export const nextActorId = (inputId, qid) => 'pc-' + String(inputId || '').replace(/^in-/, '').replace(/[^\w-]/g, '').slice(0, 40) + '-' + String(qid || '').replace(/[^\w-]/g, '').slice(0, 20);

/* ---------- Zero 建議的新對象：核對（checkEvent 用） ----------
   it：{ kind:'newActor', name, org?, role?, actorKind, teamType?, why }；texts：創辦人原話及附件文字版（字串陣列）。
   回傳 { status:'ok', item } 或 { status:'drop', reason }（靜默丟棄，只記日誌）或 { status:'error', errors }（退回 Zero 修正一次）。 */
// declined：曾答「不加入」的名稱（正規化）→ 次數；事件路徑拒絕兩次後丟棄（設計狀態表第 5 行），整理名單路徑一次即丟棄（呼叫者傳 declineLimit: 1）
// 業務常用詞：名稱若整個由這些詞及「的」「可以」「及」等虛詞組成（「日常營運」「目標客戶」「日常的營運」），或含「負責」「我們」等整句用語，或英文兩個字以上全是常用業務字、單字是明確職能字（Marketing、Sales），就是片語，不是人名或機構名。
// 只擋「整個都是常用詞」：真實名稱至少有一部分不是（「乙餐廳」「美的集團」「的近律師行」「區家明校長」「Kelvin Ho」「ABC Marketing Ltd」「Target」都放行）。
const GENERIC_ZH = ['的', '之', '及', '與', '和', '可以', '日常', '主要', '目前', '現有', '未來', '相關', '其他', '整體', '全部', '所有', '一般', '基本', '重要', '核心', '關鍵', '潛在', '目標', '主力', '長期', '短期', '初期', '後續', '持續',
  '營運', '運營', '管理', '市場', '推廣', '行銷', '營銷', '銷售', '客戶', '用戶', '顧客', '產品', '服務', '策略', '計劃', '方案', '流程', '團隊', '預算', '財務', '成本', '收入', '收益', '利潤', '合作', '夥伴', '伙伴',
  '供應', '供應商', '渠道', '通路', '品牌', '宣傳', '定價', '價格', '需求', '資源', '資金', '人手', '人力', '分工', '工作', '事務', '業務', '生意', '項目', '活動', '研發', '開發', '技術', '系統', '平台', '數據', '資料',
  '內容', '設計', '製作', '採購', '物流', '客服', '招聘', '培訓', '執行', '規劃', '會議', '進度', '合規', '法律', '行政', '運作', '維護', '支援', '支持', '決策', '決定', '創辦人', '老闆', '公司', '組織', '部門', '職能'];
const GENERIC_EN = new Set(['daily', 'day', 'to', 'operations', 'operation', 'ops', 'marketing', 'market', 'sales', 'strategy', 'management', 'manager', 'team', 'customer', 'customers', 'client', 'clients', 'product', 'products', 'service', 'services',
  'plan', 'planning', 'budget', 'finance', 'financial', 'cost', 'revenue', 'partner', 'partners', 'supplier', 'suppliers', 'channel', 'channels', 'brand', 'pricing', 'price', 'resources', 'general', 'main', 'current', 'future', 'target',
  'potential', 'core', 'key', 'business', 'project', 'projects', 'activity', 'activities', 'development', 'research', 'design', 'production', 'procurement', 'logistics', 'hr', 'admin', 'administration', 'support', 'the', 'and', 'of', 'for', 'our', 'new', 'existing', 'other', 'all']);
// 英文單字：只擋明確的職能字；Target、Design、Brand 等可以是品牌名，放行
const FUNCTION_EN = new Set(['operations', 'operation', 'ops', 'marketing', 'sales', 'strategy', 'management', 'planning', 'budget', 'finance', 'procurement', 'logistics', 'hr', 'admin', 'administration',
  'development', 'research', 'production', 'support', 'pricing', 'revenue', 'customers', 'clients', 'suppliers', 'partners', 'products', 'services', 'channels', 'resources', 'activities', 'projects']);
const FUNCTION_ZH = /正在|需要|負責|已經|為了|我們|他們|沒有|如果|因為|所以/;
export function looksLikePhrase(name) {
  const t = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!t) return false;
  if (FUNCTION_ZH.test(t)) return true;
  if (/[A-Za-z]/.test(t)) {
    const toks = t.toLowerCase().split(/[\s\-_/&]+/).filter(Boolean);
    if (toks.length > 6) return true;
    if (toks.length === 1 && FUNCTION_EN.has(toks[0])) return true;
    if (toks.length > 1 && toks.every(x => GENERIC_EN.has(x))) return true;
  }
  const zh = t.replace(/[\s\-_/&]+/g, '');
  if (zh && /^[㐀-鿿]+$/.test(zh)) {
    const ok = new Array(zh.length + 1).fill(false); ok[0] = true;
    for (let i = 1; i <= zh.length; i++) for (const w of GENERIC_ZH) if (w.length <= i && ok[i - w.length] && zh.slice(i - w.length, i) === w) { ok[i] = true; break; }
    if (ok[zh.length]) return true;
  }
  return false;
}
export function checkNewActorItem(it, { actors = [], texts = [], at = '項目', declined = {}, declineLimit = 2, founderNames = [] } = {}) {
  const errors = [], str = (v, n) => typeof v === 'string' && v.trim() && v.trim().length <= n;
  if (!it || typeof it !== 'object') return { status: 'error', errors: [at + '格式不正確'] };
  if (str(it.name, NAME_MAX) && isFounderName(it.name, founderNames)) return { status: 'drop', reason: 'founder' };
  if (str(it.name, NAME_MAX) && (declined[norm(it.name)] || 0) >= declineLimit) return { status: 'drop', reason: 'declined' };
  if (!str(it.name, NAME_MAX)) errors.push(at + '：新對象 name 必須是名稱（最多 ' + NAME_MAX + ' 字）');
  else if (/[，。；：、（）()「」]/.test(it.name)) errors.push(at + '：name 只寫名稱，不可含標點或整句（「' + clip(it.name, 20) + '」）');
  else if (looksLikePhrase(it.name)) errors.push(at + '：name 必須是人名或機構名，不可寫工作範疇或片語（「' + clip(it.name, 20) + '」）');
  if (it.org != null && it.org !== '' && !str(it.org, ORG_MAX)) errors.push(at + '：org 最多 ' + ORG_MAX + ' 字');
  if (it.role != null && it.role !== '' && !str(it.role, ROLE_MAX)) errors.push(at + '：role 最多 ' + ROLE_MAX + ' 字');
  if (!KINDS.includes(it.actorKind)) errors.push(at + '：actorKind 必須是 ' + KINDS.join('、') + ' 之一');
  if (it.actorKind === 'team' && !TEAM_TYPES.includes(it.teamType)) errors.push(at + '：成員需要 teamType（' + TEAM_TYPES.join('、') + '）');
  if (it.actorKind === 'team' && !str(it.role, ROLE_MAX)) errors.push(at + '：成員需要 role');
  if (!str(it.why, 200)) errors.push(at + '：缺少理由 why（一句，最多 200 字）');
  for (const f of ['name', 'org', 'role']) if (hasContactInfo(it[f])) errors.push(at + '：' + f + ' 不可含電郵或長串數字（名單不記聯絡方式）');
  if (errors.length) return { status: 'error', errors };
  const name = it.name.trim();
  if (duplicateActor(actors, name)) return { status: 'drop', reason: 'duplicate' };
  if (liveActors(actors).length >= MAX_ACTIVE) return { status: 'drop', reason: 'full' };
  const k = norm(name);
  if (!texts.some(t => norm(t).includes(k))) return { status: 'error', errors: [at + '：「' + clip(name, 20) + '」沒有逐字出現在創辦人原話或附件文字版內（只在圖片內出現的名字不接受）；沒有出現就不要建議這個對象'] };
  const item = { kind: 'newActor', name, actorKind: it.actorKind, why: it.why.trim(), ...(str(it.org, ORG_MAX) ? { org: it.org.trim() } : {}), ...(str(it.role, ROLE_MAX) ? { role: it.role.trim() } : {}), ...(it.actorKind === 'team' ? { teamType: it.teamType } : {}) };
  const sim = similarActor(actors, item);
  if (sim) item.similarTo = sim.id;
  return { status: 'ok', item };
}

/* ---------- 確認題的套用 ---------- */
function pushEffect(s, inputId, eff) {
  const i = (s.inputs || []).find(x => x && x.id === inputId); if (!i) return s;
  i.effects = Array.isArray(i.effects) ? i.effects : [];
  if (i.effects.some(e => e && e.targetKind === eff.targetKind && e.targetId === eff.targetId && e.change === eff.change)) return s;
  i.effects.push({ targetKind: eff.targetKind, targetId: eff.targetId, change: eff.change });
  return s;
}
// answer：'add'（加入名單）／'alias'（記為 aliasOf 的另一個稱呼）／'skip'（不加入，只記一筆）
export function applyNewActor(state, { inputId, qid, item, answer, aliasOf = '', today = '', now = '', addedFrom = 'event', t = TXT } = {}) {
  if (!item || item.kind !== 'newActor' || !['add', 'alias', 'skip'].includes(answer)) return state;
  const s = clone(state || {}); s.company = s.company || {}; const actors = Array.isArray(s.company.actors) ? s.company.actors : (s.company.actors = []);
  const kn = (t.kind || TXT.kind)[item.actorKind] || '';
  if (answer === 'skip') return pushEffect(s, inputId, { targetKind: 'decision', targetId: nextActorId(inputId, qid), change: fill(t.skipped || TXT.skipped, { n: item.name }) });
  if (answer === 'alias') {
    const finalId = resolveActorId(actors, aliasOf), target = actors.find(a => a.id === finalId);
    if (!target || nameKeys(target).includes(norm(item.name))) return state;
    target.aliases = [...(target.aliases || []), item.name];
    return pushEffect(s, inputId, { targetKind: 'actor', targetId: target.id, change: fill(t.aliased || TXT.aliased, { n: target.name }) });
  }
  const id = nextActorId(inputId, qid);
  if (actors.some(a => a.id === id)) return state;            // 冪等：同一題只加一次
  if (duplicateActor(actors, item.name) || liveActors(actors).length >= MAX_ACTIVE) return state;
  const a = { id, name: item.name, label: item.name, kind: item.actorKind, ...(item.org ? { org: item.org } : {}), ...(item.role ? { role: item.role } : {}), aliases: [], status: 'active',
    addedFrom: ADDED_FROM.includes(addedFrom) ? addedFrom : 'event', ...(isDay(today) ? { addedAt: today } : {}), ...(now ? { confirmedAt: now } : {}), fromMilestoneIds: [],
    ...(item.actorKind === 'team' ? { team: { type: item.teamType, state: 'active', owns: [] } } : {}) };
  actors.push(a);
  return pushEffect(s, inputId, { targetKind: 'actor', targetId: id, change: fill(t.added || TXT.added, { n: item.name, k: kn }) });
}

/* ---------- 創辦人改正（actorRename／actorKind／actorMerge／actorStatus／actorTeam／taskOwner） ----------
   回傳 { ok, error?, state }；失敗時 state 為原狀態。 */
const fail = (state, error) => ({ ok: false, error, state });
export function applyActorOp(state, op, v = {}) {
  const s = clone(state || {}); s.company = s.company || {}; const actors = Array.isArray(s.company.actors) ? s.company.actors : (s.company.actors = []);
  const get = id => actors.find(a => a && a.id === id);
  if (op === 'actorAdd') {
    const id = String(v.id || v.target || '');
    if (!id) return fail(state, 'invalid');
    if (get(id)) return { ok: true, state: s }; // 同一操作重播時不會再建立一位對象。
    const name = String(v.name == null ? '' : v.name).trim(), kind = v.kind;
    if (!name || name.length > NAME_MAX || !KINDS.includes(kind)) return fail(state, 'invalid');
    if (hasContactInfo(name)) return fail(state, 'contactInfo');
    if (duplicateActor(actors, name) || liveActors(actors).length >= MAX_ACTIVE) return fail(state, 'duplicateName');
    const at = String(v.at || v.confirmedAt || ''), addedAt = at.slice(0, 10);
    const actor = { id, name, label: name, kind, aliases: [], status: 'active', addedFrom: 'money',
      ...(isDay(addedAt) ? { addedAt } : {}), ...(at ? { confirmedAt: at } : {}), fromMilestoneIds: [],
      ...(kind === 'team' ? { team: { type: 'parttime', state: 'active', owns: [] } } : {}) };
    actors.push(actor);
    return { ok: true, state: s };
  }
  if (op === 'taskOwner') {
    const t = (s.tasks || []).find(x => x && x.id === v.id); if (!t) return fail(state, 'notFound');
    const owner = v.owner;
    if (owner !== 'founder') {
      const finalId = resolveActorId(actors, owner), a = get(finalId);
      if (!a || kindOf(a) !== 'team' || teamStateOf(a) !== 'active' || a.status === 'inactive') return fail(state, 'invalidOwner');
      t.owner = finalId;
    } else t.owner = 'founder';
    return { ok: true, state: s };
  }
  const a = get(v.id || v.from);
  if (!a) return fail(state, 'notFound');
  if (op === 'actorRename') {
    const name = String(v.name == null ? '' : v.name).trim();
    if (!name || name.length > NAME_MAX) return fail(state, 'invalid');
    if (hasContactInfo(name)) return fail(state, 'contactInfo');
    if (isMerged(a)) return fail(state, 'merged');
    if (norm(name) === norm(a.name)) return { ok: true, state: s };
    // 已併入保留者本身的對象（合併時名字進了保留者的別名）不算重名：合併後可把保留者改成被合併者的舊名
    const dup = actors.find(x => x.id !== a.id && resolveActorId(actors, x.id) !== a.id && nameKeys(x).includes(norm(name)));
    if (dup) return fail(state, 'duplicateName');
    if (!(a.aliases || []).some(x => norm(x) === norm(a.name))) a.aliases = [...(a.aliases || []), a.name];
    a.aliases = (a.aliases || []).filter(x => norm(x) !== norm(name));   // 改回舊名：不留自己
    a.name = name; a.label = name;
    return { ok: true, state: s };
  }
  if (op === 'actorKind') {
    if (!KINDS.includes(v.kind)) return fail(state, 'invalid');
    if (isMerged(a)) return fail(state, 'merged');
    // 改離成員：team 資料（類型、狀態、負責的站及工作）原樣保留，只標 dormant（不生效，各處讀取以 kind 為準）；改回成員時還原
    if (v.kind === 'team') { if (!String(a.role || '').trim()) return fail(state, 'needRole'); if (!a.team) a.team = { type: 'parttime', state: 'active', owns: [] }; else { const { dormant, ...rest } = a.team; a.team = rest; } }
    else if (a.team) a.team = { ...a.team, dormant: true };
    a.kind = v.kind;
    return { ok: true, state: s };
  }
  if (op === 'actorStatus') {
    if (!STATUSES.includes(v.status)) return fail(state, 'invalid');
    if (isMerged(a)) return fail(state, 'merged');
    if (kindOf(a) === 'team') return fail(state, 'useTeam');
    a.status = v.status;
    return { ok: true, state: s };
  }
  if (op === 'actorTeam') {
    if (kindOf(a) !== 'team' || isMerged(a)) return fail(state, 'notTeam');
    const tm = v.team && typeof v.team === 'object' ? v.team : {}, next = { ...(a.team || { type: 'parttime', state: 'active', owns: [] }) };
    if ('type' in tm) { if (!TEAM_TYPES.includes(tm.type)) return fail(state, 'invalid'); next.type = tm.type; }
    if ('state' in tm) { if (!TEAM_STATES.includes(tm.state)) return fail(state, 'invalid'); next.state = tm.state; }
    if ('owns' in tm) {
      // 只准帳本已有的站點編號或工作編號（呼叫者沒有帶站點及工作清單時無從核對，照舊只核對格式；伺服器入隊列前一定帶齊）
      const known = Array.isArray(s.milestones) || Array.isArray(s.tasks) ? new Set([...(s.milestones || []), ...(s.tasks || [])].map(x => x && x.id)) : null;
      if (!Array.isArray(tm.owns) || tm.owns.length > 40 || tm.owns.some(x => typeof x !== 'string' || !x || x.length > 60 || (known && !known.has(x)))) return fail(state, 'invalid'); next.owns = [...new Set(tm.owns)]; }
    a.team = next;
    return { ok: true, state: s };
  }
  if (op === 'actorMerge') {
    const into = get(resolveActorId(actors, v.into)), from = a;
    if (!into || isMerged(from)) return fail(state, isMerged(from) ? 'merged' : 'notFound');
    if (into.id === from.id) return fail(state, 'self');
    if ((kindOf(into) === 'team') !== (kindOf(from) === 'team')) return fail(state, 'teamMismatch');
    const keep = new Set(nameKeys(into));
    const adds = []; for (const x of [from.name, ...(from.aliases || [])]) if (x && !keep.has(norm(x))) { keep.add(norm(x)); adds.push(x); }
    into.aliases = [...(into.aliases || []), ...adds];
    if (kindOf(into) === 'team' && from.team && from.team.owns) into.team = { ...(into.team || { type: 'parttime', state: 'active' }), owns: [...new Set([...((into.team && into.team.owns) || []), ...from.team.owns])] };
    from.mergedInto = into.id;
    return { ok: true, state: s };
  }
  return fail(state, 'unknownOp');
}
export const ACTOR_OPS = ['actorAdd', 'actorRename', 'actorKind', 'actorMerge', 'actorStatus', 'actorTeam', 'taskOwner'];

/* ---------- 工作負責人 ---------- */
// 約定：owner 為 'founder'／'ai'／成員編號。沒有 owner 當 'ai'（舊資料）
export const ownerKind = owner => owner === 'founder' ? 'founder' : (!owner || owner === 'ai') ? 'ai' : 'team';
// 顯示用：離開（或已不在名單）的成員，工作回到創辦人名下並標「負責人已離開」
export function ownerView(task, actors) {
  const k = ownerKind(task && task.owner);
  if (k !== 'team') return { kind: k, name: '', left: false, actorId: '' };
  const id = resolveActorId(actors, task.owner), a = (actors || []).find(x => x.id === id);
  if (!a) return { kind: 'founder', name: '', left: true, actorId: '' };
  if (kindOf(a) !== 'team') return { kind: 'founder', name: a.name, left: true, actorId: id };   // 已改為其他類別：不再是成員（team 資料保留，改回成員即還原）
  return teamStateOf(a) === 'left' || a.status === 'inactive' ? { kind: 'founder', name: a.name, left: true, actorId: id } : { kind: 'team', name: a.name, left: false, actorId: id, paused: teamStateOf(a) === 'paused' };
}

/* ---------- 讀取：名單的共同視圖（推進板、團隊頁、每週訪問、--brief 共用） ---------- */
const dayMs = d => Date.parse(String(d).slice(0, 10) + 'T00:00:00Z');
export const diffDays = (a, b) => (isDay(String(a).slice(0, 10)) && isDay(String(b).slice(0, 10))) ? Math.round((dayMs(a) - dayMs(b)) / 86400000) : null;
const CONTACT_VIA = ['event', 'doc', 'debrief'];
const stripTitle = t => String(t || '').replace(/^[^：]*：/, '');
// 一筆輸入提到哪些對象：完整名稱／別名逐一比對，若同時命中的兩個對象其中一個名稱是另一個的子字串，只算較長者
export function actorsMentioned(actors, text) {
  const hits = liveOrAny(actors).map(a => ({ a, ks: nameKeys(a).filter(k => norm(text).includes(k)) })).filter(x => x.ks.length);
  return hits.filter(x => !hits.some(y => y !== x && y.ks.some(ky => x.ks.every(kx => ky.length > kx.length && ky.includes(kx))))).map(x => x.a);
}
const liveOrAny = actors => (actors || []).filter(a => a && !isMerged(a));   // 已不再接觸、離開者仍要比對（他們也會「又出現」）

export function peopleView(state, { today = '' } = {}) {
  const s = state || {}, actors = ((s.company || {}).actors || []).filter(Boolean), inputs = Array.isArray(s.inputs) ? s.inputs : [], events = Array.isArray(s.events) ? s.events : [], tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const contact = new Map(), docs = new Map();
  const bump = (id, c) => { const cur = contact.get(id); if (!cur || c.date > cur.date || (c.date === cur.date && c.fromInput && !cur.fromInput)) contact.set(id, c); };
  for (const i of inputs) {
    if (!i || !(CONTACT_VIA.includes(i.via) || i.kind === 'interview')) continue;
    const date = String(i.eventDate || i.receivedAt || '').slice(0, 10); if (!isDay(date)) continue;
    for (const a of actorsMentioned(actors, (i.title || '') + ' ' + (i.summary || ''))) {
      bump(a.id, { date, text: stripTitle(i.title), inputId: i.id, fromInput: true });
      if (Array.isArray(i.files) && i.files.length) { const l = docs.get(a.id) || []; l.push({ inputId: i.id, title: stripTitle(i.title), count: i.files.length }); docs.set(a.id, l); }
    }
  }
  for (const e of events) {
    if (!e || e.actor !== 'founder' || !Array.isArray(e.relatedIds)) continue;
    const date = String(e.at || '').slice(0, 10); if (!isDay(date)) continue;
    const seen = new Set();
    for (const r of e.relatedIds) { const id = resolveActorId(actors, r); if (!id || seen.has(id)) continue; seen.add(id); const inp = inputs.find(x => x && e.relatedIds.includes(x.id)); bump(id, { date, text: stripTitle(inp ? inp.title : e.title), inputId: inp ? inp.id : '', fromInput: false }); }
  }
  // 被合併者的接觸算到最終對象
  for (const a of actors) if (isMerged(a)) { const f = resolveActorId(actors, a.id); const c = contact.get(a.id); if (f && c) bump(f, c); const d = docs.get(a.id); if (f && d) docs.set(f, [...(docs.get(f) || []), ...d]); }
  const open = t => t && !['done', 'cancelled'].includes(t.status);
  const list = actors.filter(a => !isMerged(a)).map(a => {
    const c = contact.get(a.id) || null, base = c ? c.date : (a.addedAt || ''), mine = tasks.filter(t => open(t) && (resolveActorId(actors, t.prospectId) === a.id)).filter(t => ownerKind(t.owner) !== 'ai').sort((x, y) => (x.dueAt ? 0 : 1) - (y.dueAt ? 0 : 1) || String(x.dueAt || '').localeCompare(String(y.dueAt || '')));
    const dd = docs.get(a.id) || [];
    return { id: a.id, name: a.name, label: a.label || a.name, kind: kindOf(a), org: a.org || '', role: a.role || '', status: a.status === 'inactive' ? 'inactive' : 'active', aliases: [...(a.aliases || [])], addedFrom: a.addedFrom || '', addedAt: a.addedAt || '',
      ...(a.team && kindOf(a) === 'team' ? { team: { type: a.team.type, state: teamStateOf(a), owns: [...(a.team.owns || [])] } } : {}),
      lastContact: c ? { date: c.date, text: c.text, inputId: c.inputId } : null, gapDays: today && base ? diffDays(today, base) : null,
      nextTask: mine[0] ? { id: mine[0].id, title: mine[0].title, dueAt: mine[0].dueAt || '', owner: mine[0].owner || 'founder' } : null,
      docs: dd.filter((x, i) => dd.findIndex(y => y.inputId === x.inputId) === i) };
  });
  return { actors: list, external: list.filter(x => x.kind !== 'team' && x.status === 'active'), closed: list.filter(x => x.kind !== 'team' && x.status === 'inactive'), team: list.filter(x => x.kind === 'team'), mergedCount: actors.filter(isMerged).length };
}

// 每週訪問的十四日題：只問沒有接觸最久的一個（主線 2026-11-07 18:20 裁定）；snooze 在 state.interviews.contactSnooze[編號]
export function contactDue(state, { today = '', limit = 1 } = {}) {
  const snooze = ((state && state.interviews) || {}).contactSnooze || {};
  return peopleView(state, { today }).external.filter(p => p.gapDays != null && p.gapDays >= GAP_DAYS && !(isDay(snooze[p.id]) && snooze[p.id] > today))
    .sort((x, y) => y.gapDays - x.gapDays || 0).slice(0, limit);
}

// G6「已有人負責的事」：沒有任何未離開的成員 → null（畫面沿用公司概覽原文）。離開者的站只在「所有負責人都已離開」時列入 unowned；暫停者留在自己那一行
export function ownershipOf(state) {
  const s = state || {}, actors = ((s.company || {}).actors || []).filter(a => a && !isMerged(a) && kindOf(a) === 'team' && a.status !== 'inactive');
  const live = actors.filter(a => teamStateOf(a) !== 'left');
  if (!live.length) return null;
  const ms = Array.isArray(s.milestones) ? s.milestones : [], short = id => (ms.find(m => m && m.id === id) || {}).short || '';
  const open = t => t && !['done', 'cancelled'].includes(t.status);
  const lines = live.map(a => {
    const mine = (s.tasks || []).filter(t => open(t) && resolveActorId(((s.company || {}).actors) || [], t.owner) === a.id && ownerKind(t.owner) === 'team');
    return { actorId: a.id, name: a.name, role: a.role || '', state: teamStateOf(a), stations: ((a.team || {}).owns || []).map(short).filter(Boolean), tasks: mine.slice(0, 2).map(t => t.title), moreTasks: Math.max(0, mine.length - 2) };
  });
  const unowned = [];
  const stations = new Set(actors.flatMap(a => (a.team && a.team.owns) || []));
  for (const id of stations) { const owners = actors.filter(a => ((a.team || {}).owns || []).includes(id)); if (short(id) && owners.every(a => teamStateOf(a) === 'left')) unowned.push({ station: short(id), formerOwners: owners.map(a => a.name) }); }
  return { lines, unowned };
}

/* ---------- 創辦人本人：永不列入名單（company-page-format.md「創辦人本人不寫」；工作負責人已有「我自己」） ----------
   founderNamesIn(text)：從已確認概覽原文抽「我自己（X）」「本人（X）」括號內的名字；SELF 是固定代稱。 */
const SELF = ['我自己', '我', '本人', '創辦人', '我本人'];
export function founderNamesIn(text) {
  const out = new Set(); const re = /(?:我自己|本人|我)[（(]([^（）()]{1,40})[）)]/g; let m;
  const t = String(text || '');
  while ((m = re.exec(t))) for (const part of m[1].split(/[、，,／/及和]/)) { const n = part.trim(); if (n && n.length <= NAME_MAX && !hasContactInfo(n)) out.add(n); }
  return [...out];
}
export const isFounderName = (name, founderNames = []) => { const k = norm(name); return !!k && (SELF.some(s => norm(s) === k) || founderNames.some(n => norm(n) === k)); };

/* ---------- Zero 整理名單（people-sync）：狀態家 state.peopleSync（設計見 docs/evidence/people-fix-2026-11-07/chain.md） ----------
   { for, at, requested, packId, pending[], declined{ key: n }, applied{ packId: [qid] } }
   key＝ledgerFrom|intake.confirmedAt：每個已確認的概覽版本最多自動整理一次；創辦人按「請 Zero 整理名單」則下一次先做。 */
export const peopleSyncKey = s => { const st = s || {}; return st.ledgerFrom && st.intake && st.intake.confirmedAt ? st.ledgerFrom + '|' + st.intake.confirmedAt : ''; };
const legacyActor = a => a && !a.mergedInto && !a.addedFrom;   // 0.40.0 前自動帶入、類別未經核對
// 回傳 { due: 'manual'|'auto'|'batch'|'', key }：manual＝創辦人要求；auto＝此版概覽未整理過而名單有缺口（沒有在職成員，或有舊對象）；batch＝上一包答完、仍有擱置項目（不開 AI）
// 中英文（或數字）相鄰處加空格（名字填入句子時用）；標點旁不加
export const mixSpace = s => String(s == null ? '' : s).replace(/([㐀-鿿豈-﫿])([A-Za-z0-9])/g, '$1 $2').replace(/([A-Za-z0-9])([㐀-鿿豈-﫿])/g, '$1 $2');
// today：自動路徑失敗後（lastTry）同一概覽版本當日不再自動重試；創辦人按鍵（requested）不受此限
export function peopleSyncDue(s, { packOpen = false, today = '' } = {}) {
  const st = s || {}, ps = st.peopleSync || {}, key = peopleSyncKey(st);
  if (!key || st.demo === true) return { due: '', key };
  if (packOpen) return { due: '', key };
  if (Array.isArray(ps.pending) && ps.pending.length) return { due: 'batch', key };
  if (ps.requested) return { due: 'manual', key };
  if (ps.for === key) return { due: '', key };
  if (ps.lastTry && ps.lastTry.key === key && today && ps.lastTry.day === today) return { due: '', key };
  const actors = ((st.company || {}).actors || []).filter(Boolean);
  const hasTeam = actors.some(a => isLive(a) && kindOf(a) === 'team');
  return { due: !hasTeam || actors.some(legacyActor) ? 'auto' : '', key };
}
// 整理名單項目的次序：成員 ＞ 顧問 ＞ 投資者 ＞ 合作方 ＞ 客戶 ＞ 改類別
const SYNC_RANK = { team: 0, advisor: 1, investor: 2, partner: 3, customer: 4 };
export const orderSyncItems = items => (items || []).map((x, i) => ({ x, i })).sort((a, b) => ((a.x.kind === 'actorKind' ? 9 : SYNC_RANK[a.x.actorKind] ?? 8) - (b.x.kind === 'actorKind' ? 9 : SYNC_RANK[b.x.actorKind] ?? 8)) || a.i - b.i).map(o => o.x);
/* 核對 Zero 交回的 out/people.json：{ summary?, items[] }，項目是 newActor（沿 checkNewActorItem）或 actorKind { name, actorKind, role?, why }。
   texts：已確認概覽原文（欄值、項目 label／value、里程碑決策者）。回傳 { ok, errors, items, dropped[] }；errors 非空時由呼叫者退回修正一次（lenient 時只丟棄不合格項）。 */
// reasked：自訂答案已再問兩次（值為 2）的對象不再建議（新對象以名稱、改類別以 kind:編號:類別 為鍵）
export function checkPeopleSync(raw, { actors = [], texts = [], declined = {}, founderNames = [], lenient = false, reasked = {} } = {}) {
  const errors = [], items = [], dropped = [], seen = new Set(), str = (v, n) => typeof v === 'string' && v.trim() && v.trim().length <= n;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return { ok: false, errors: ['out/people.json 必須有 items 清單（沒有建議就寫空清單）'], items, dropped };
  const bad = (at, msg, name) => { if (lenient) dropped.push({ name, reason: msg }); else errors.push(at + '：' + msg); };
  raw.items.forEach((it, i) => {
    const at = `items 第 ${i + 1} 項`;
    if (!it || typeof it !== 'object') return bad(at, '格式不正確', '');
    if (it.kind === 'newActor') {
      if (str(it.name, NAME_MAX) && (reasked[norm(it.name)] || 0) >= 2) return dropped.push({ name: String(it.name), reason: 'reasked' });
      const r = checkNewActorItem(it, { actors, texts, at, declined, declineLimit: 1, founderNames });
      if (r.status === 'drop') return dropped.push({ name: String(it.name || ''), reason: r.reason });
      if (r.status === 'error') return bad(at, r.errors[0].replace(/^[^：]*：/, ''), String(it.name || ''));
      const key = 'n:' + norm(r.item.name); if (seen.has(key)) return; seen.add(key);
      return items.push(r.item);
    }
    if (it.kind === 'actorKind') {
      if (!str(it.name, NAME_MAX)) return bad(at, '改類別的 name 必須是名單內的名稱', '');
      if (!KINDS.includes(it.actorKind)) return bad(at, 'actorKind 必須是 ' + KINDS.join('、') + ' 之一', it.name);
      if (!str(it.why, 200)) return bad(at, '缺少理由 why（一句，最多 200 字）', it.name);
      const a = (actors || []).find(x => x && !x.mergedInto && nameKeys(x).includes(norm(it.name)));
      if (!a) return dropped.push({ name: it.name, reason: 'notFound' });
      if (kindOf(a) === it.actorKind) return dropped.push({ name: it.name, reason: 'sameKind' });
      const role = str(it.role, ROLE_MAX) && !hasContactInfo(it.role) ? it.role.trim() : String(a.role || '').trim();
      if (it.actorKind === 'team' && !role) return bad(at, '改為團隊成員須有 role', it.name);
      if (declined['kind:' + a.id + ':' + it.actorKind]) return dropped.push({ name: it.name, reason: 'declined' });
      if ((reasked['kind:' + a.id + ':' + it.actorKind] || 0) >= 2) return dropped.push({ name: it.name, reason: 'reasked' });
      const key = 'k:' + a.id; if (seen.has(key)) return; seen.add(key);
      return items.push({ kind: 'actorKind', id: a.id, name: a.name, from: kindOf(a), actorKind: it.actorKind, ...(it.actorKind === 'team' && !String(a.role || '').trim() ? { role } : {}), why: it.why.trim() });
    }
    return bad(at, 'kind 必須是 newActor 或 actorKind', String(it.name || ''));
  });
  return { ok: !errors.length, errors, items: orderSyncItems(items), dropped };
}
// 改類別題答「改為」：改為成員而沒有角色時先寫建議的 role；純函數，失敗原樣返回
export function applyKindFix(state, { id, kind, role = '' } = {}) {
  const s = clone(state || {}); const a = ((s.company || {}).actors || []).find(x => x && x.id === id);
  if (!a || isMerged(a)) return state;
  if (kind === 'team' && !String(a.role || '').trim() && role) a.role = String(role).trim().slice(0, ROLE_MAX);
  const r = applyActorOp(s, 'actorKind', { id, kind });
  return r.ok ? r.state : state;
}

/* ---------- 真實事件確認項目：每件事最多一個新對象及新名稱；三項上限內先排序再截（假設 ＞ 站點 ＞ 新對象 ＞ 跟進日期 ＞ 下一個對外動作 ＞ 新名稱） ---------- */
export const EVENT_ITEM_ORDER = ['assumption', 'milestone', 'newActor', 'followUp', 'nextAction', 'newTerm'];
export function orderEventItems(items, max = 3) {
  let seenActor = false, seenTerm = false;
  const keep = (items || []).filter(x => {
    if (x && x.kind === 'newActor') { if (seenActor) return false; seenActor = true; }
    if (x && x.kind === 'newTerm') { if (seenTerm) return false; seenTerm = true; }
    return true;
  });
  const rank = x => { const i = EVENT_ITEM_ORDER.indexOf(x && x.kind); return i < 0 ? EVENT_ITEM_ORDER.length : i; };
  return keep.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map(o => o.x).slice(0, max);
}
