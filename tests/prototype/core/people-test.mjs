// 人物及機構名單測試（0.40.0，純函數部分）：逐行驗證 docs/evidence/people-2026-11-07/design.md 第 4 節狀態表。
// 不開伺服器、不開 AI、不連外；pipelineOf 只讀暫存資料夾。
// 用法：node people-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import { assertTestOut, freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [PROTO, OUTDIR] = process.argv.slice(2);
freshTestOut(OUTDIR);
const P = await import(pathToFileURL(path.join(PROTO, 'people-ops.mjs')).href);
const brain = await import(pathToFileURL(path.join(PROTO, 'brain-lib.mjs')).href);
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const frozen = o => JSON.stringify(o);
const TODAY = '2026-11-07';

const A = (id, name, kind, extra = {}) => ({ id, name, label: name, kind, aliases: [], status: 'active', fromMilestoneIds: [], ...extra });
const base = () => ({
  company: { actors: [A('pr-1', '陳經理', 'customer', { org: '甲餐廳', role: '採購經理', addedAt: '2026-10-01', aliases: ['陳總'] }), A('pr-2', '農場主丙', 'partner', { org: '丙農場', addedAt: '2026-10-01' }),
    A('pr-3', '李小姐', 'investor', { addedAt: '2026-10-01' }), A('pr-4', '王先生', 'partner', { status: 'inactive', addedAt: '2026-09-01' }),
    A('pc-m', '陳總', 'customer', { mergedInto: 'pr-1' }),
    A('tm-1', '李家欣', 'team', { role: '共同創辦人', team: { type: 'cofounder', state: 'active', owns: ['m1'] } }),
    A('tm-2', '黃師傅', 'team', { role: '牌照代辦', team: { type: 'contractor', state: 'paused', owns: ['m3'] } }),
    A('tm-3', '周家豪', 'team', { role: '送貨', team: { type: 'parttime', state: 'left', owns: ['m4'] } })], assumptions: [] },
  milestones: [{ id: 'm1', short: '農場簽約' }, { id: 'm3', short: '牌照查詢' }, { id: 'm4', short: '送貨準備' }, { id: 'm5', short: '餐廳試單' }],
  tasks: [{ id: 't1', title: '向陳經理跟進試單', owner: 'founder', status: 'planned', dueAt: '2026-11-12', prospectId: 'pc-m' },
    { id: 't2', title: '送樣本到乙餐廳', owner: 'tm-3', status: 'planned', dueAt: '2026-11-10' }, { id: 't3', title: '看田', owner: 'tm-1', status: 'planned', dueAt: '2026-11-14' }, { id: 't4', title: 'Zero 的準備', owner: 'ai', status: 'planned', prospectId: 'pr-2' }],
  inputs: [{ id: 'in-a', via: 'event', title: '真實事件（11 月 3 日）：與陳經理見面，答應試單', eventDate: '2026-11-03', receivedAt: '2026-11-03T20:00:00', files: ['a/x.pdf'], effects: [] },
    { id: 'in-b', via: 'event', title: '真實事件：農場主丙說要先看條款', eventDate: '2026-10-20', files: [], summary: '', effects: [] },
    { id: 'in-c', via: 'adhoc', title: '請 Zero 做一件事：陳經理的簡介', eventDate: '2026-11-06', files: [], effects: [] }],
  events: [], interviews: {}
});

// ---- 名稱與解析 ----
ok('kindOf：舊字串對應新代碼，未知當供應或合作方，沒有值當客戶', P.kindOf({ kind: '客戶' }) === 'customer' && P.kindOf({ kind: '供應' }) === 'partner' && P.kindOf({ kind: 'investor' }) === 'investor' && P.kindOf({ kind: '怪' }) === 'partner' && P.kindOf({}) === 'customer');
ok('norm：全形半形、空白、大小寫不影響', P.norm(' Ｗong 先生 ') === P.norm('wong先生'));
ok('hasContactInfo：電郵、八位以上數字（含空格短橫）視為聯絡方式，一般名稱不是', P.hasContactInfo('a@b.com') && P.hasContactInfo('9123 4567') && P.hasContactInfo('9123-4567') && !P.hasContactInfo('甲餐廳 3 號店') && !P.hasContactInfo('陳經理'));
{
  const ac = base().company.actors;
  ok('resolveActorId：被合併者解到最終對象；找不到回空；環不死循環', P.resolveActorId(ac, 'pc-m') === 'pr-1' && P.resolveActorId(ac, 'pr-1') === 'pr-1' && P.resolveActorId(ac, 'nope') === '' && P.resolveActorId([A('x', 'x', 'customer', { mergedInto: 'y' }), A('y', 'y', 'customer', { mergedInto: 'x' })], 'x') === '');
}

// ---- 狀態表 1–6、19–22：Zero 建議新對象的核對 ----
{
  const s = base(), ac = s.company.actors, texts = ['11 月 7 日與陳經理見面，對方介紹乙餐廳黃小姐，還提到陳總。'];
  const it = (o = {}) => ({ kind: 'newActor', name: '黃小姐', org: '乙餐廳', role: '負責人', actorKind: 'customer', why: '她之後可能成為試單對象', ...o });
  const chk = (o, t = texts, a = ac) => P.checkNewActorItem(it(o), { actors: a, texts: t });
  const good = chk();
  ok('S1 合規的新對象通過，帶回乾淨欄位', good.status === 'ok' && good.item.name === '黃小姐' && good.item.actorKind === 'customer' && good.item.org === '乙餐廳' && !good.item.similarTo);
  ok('S1 與現有對象 name 完全相同：靜默丟棄', chk({ name: '陳經理' }).status === 'drop' && chk({ name: '陳經理' }).reason === 'duplicate');
  ok('S2 與別名相同：丟棄（含已合併者的名稱）', chk({ name: '陳總' }).status === 'drop');
  ok('S2 與不再接觸者同名：丟棄，不重新啟用', chk({ name: '王先生' }, ['王先生又來電']).status === 'drop');
  ok('S3 機構相同且首字相同：標疑似變體（陳經理 對 陳工）', (() => { const r = chk({ name: '陳工', org: '甲餐廳', role: '採購' }, ['陳工打來']); return r.status === 'ok' && r.item.similarTo === 'pr-1'; })());
  ok('S3 機構不同：不標疑似變體，當新對象', (() => { const r = chk({ name: '陳工', org: '丁餐廳' }, ['陳工打來']); return r.status === 'ok' && !r.item.similarTo; })());
  ok('S4 名稱是現有名稱的子字串：標疑似變體', (() => { const r = chk({ name: '陳', org: '' }, ['陳來電']); return r.status === 'ok' && r.item.similarTo === 'pr-1'; })());
  ok('S20 名稱沒有逐字出現在原話或文字版（只在 PDF／圖片）：退回修正', chk({ name: '周先生' }).status === 'error');
  ok('S20 全形半形、空白不影響逐字核對', chk({ name: 'Wong 先生' }, ['ＷＯＮＧ先生 來電']).status === 'ok');
  ok('S21 名稱、機構、角色含電郵或長數字：退回修正', chk({ name: '黃小姐', org: 'a@b.com' }).status === 'error' && chk({ role: '電話 91234567' }).status === 'error');
  ok('欄位核對：缺理由、類別不在代碼內、成員缺 teamType 或 role 都退回', chk({ why: '' }).status === 'error' && chk({ actorKind: 'boss' }).status === 'error' && chk({ actorKind: 'team', role: '送貨' }).status === 'error' && chk({ actorKind: 'team', teamType: 'parttime', role: '' }).status === 'error');
  ok('欄位核對：名稱過長退回', chk({ name: '很'.repeat(21) }).status === 'error');
  const full = Array.from({ length: P.MAX_ACTIVE }, (_, i) => A('f' + i, '對象' + i, 'customer'));
  ok('S22 名單滿 80：丟棄；標不再接觸可騰位', chk({}, texts, full).status === 'drop' && chk({}, texts, full.map((a, i) => i ? a : { ...a, status: 'inactive' })).status === 'ok');
  // 每件事最多一個新對象、三項上限內先排序
  const items = [{ kind: 'followUp', id: 'f' }, { kind: 'nextAction' }, { kind: 'newActor', name: '甲' }, { kind: 'newActor', name: '乙' }, { kind: 'milestone', id: 'm' }, { kind: 'assumption', id: 'a' }];
  const o = P.orderEventItems(items);
  ok('S19 每件事最多一個新對象；三項上限先排序：假設＞站點＞新對象', o.length === 3 && o[0].kind === 'assumption' && o[1].kind === 'milestone' && o[2].kind === 'newActor' && o[2].name === '甲');
  ok('排序：假設及站點只有一項時，新對象排在跟進日期之前', P.orderEventItems([{ kind: 'nextAction' }, { kind: 'followUp' }, { kind: 'newActor' }]).map(x => x.kind).join() === 'newActor,followUp,nextAction');
}

// ---- 確認題套用：加入、別名、不加入、冪等 ----
{
  const s0 = base(); s0.inputs.push({ id: 'in-ev', via: 'event', title: '事件', files: [], effects: [] });
  const before = frozen(s0), item = { kind: 'newActor', name: '黃小姐', org: '乙餐廳', role: '負責人', actorKind: 'customer', why: 'x' };
  const s1 = P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item, answer: 'add', today: TODAY, now: '2026-11-07T21:00:00' });
  const a = s1.company.actors.find(x => x.name === '黃小姐');
  ok('加入：不改傳入狀態', frozen(s0) === before);
  ok('加入：寫入固定編號、類別代碼、狀態、來源、日期；不寫聯絡方式欄', a && a.id === 'pc-ev-q3' && a.kind === 'customer' && a.status === 'active' && a.addedFrom === 'event' && a.addedAt === TODAY && a.confirmedAt && Array.isArray(a.aliases) && !('phone' in a) && !('email' in a));
  ok('加入：輸入的效果記一筆「已加入名單」', s1.inputs.find(i => i.id === 'in-ev').effects.some(e => e.targetKind === 'actor' && e.targetId === 'pc-ev-q3' && /已加入名單：黃小姐/.test(e.change)));
  const s2 = P.applyNewActor(s1, { inputId: 'in-ev', qid: 'q3', item, answer: 'add', today: TODAY });
  ok('加入：同一題做兩次只加一次（冪等）', s2.company.actors.filter(x => x.name === '黃小姐').length === 1 && frozen(s2) === frozen(s1));
  const t = P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item: { ...item, actorKind: 'team', teamType: 'parttime', name: '陳小明', role: '兼職・配送' }, answer: 'add', today: TODAY }).company.actors.find(x => x.name === '陳小明');
  ok('加入成員：帶 team 欄（類型、在職、空負責範圍）', t && t.kind === 'team' && t.team.type === 'parttime' && t.team.state === 'active' && t.team.owns.length === 0);
  const al2 = P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item: { ...item, name: '陳工' }, answer: 'alias', aliasOf: 'pr-1' });
  ok('S4 記為別名：目標對象別名加入，名稱、類別、編號不變，不新增對象', al2.company.actors.length === s0.company.actors.length && al2.company.actors.find(x => x.id === 'pr-1').aliases.includes('陳工') && al2.company.actors.find(x => x.id === 'pr-1').name === '陳經理');
  ok('S4 別名指向已合併者：解到最終對象', P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item: { ...item, name: '陳工' }, answer: 'alias', aliasOf: 'pc-m' }).company.actors.find(x => x.id === 'pr-1').aliases.includes('陳工'));
  const sk = P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item, answer: 'skip' });
  ok('S5 不加入：名單不變，只記一筆「沒有加入名單」', sk.company.actors.length === s0.company.actors.length && sk.inputs.find(i => i.id === 'in-ev').effects.length === 1 && /沒有加入名單/.test(sk.inputs.find(i => i.id === 'in-ev').effects[0].change));
  ok('套用：無效答案或錯誤項目原樣返回', P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item, answer: 'x' }) === s0 && P.applyNewActor(s0, { inputId: 'in-ev', qid: 'q3', item: { kind: 'followUp' }, answer: 'add' }) === s0);
  ok('S6 合併後再建議輸家舊名：丟棄（名稱已在別名內）', (() => { const m = P.applyActorOp(s0, 'actorMerge', { from: 'pr-2', into: 'pr-1' }).state; return P.checkNewActorItem({ ...item, name: '農場主丙' }, { actors: m.company.actors, texts: ['農場主丙'] }).status === 'drop'; })());
}

// ---- 改正操作（狀態表 7–10、14、15） ----
{
  const s0 = base(), before = frozen(s0), op = (n, v, s = s0) => P.applyActorOp(s, n, v);
  let r = op('actorRename', { id: 'pr-1', name: '陳生' });
  ok('改名：只改 name／label，舊名進別名，編號與其他欄不變；不改傳入狀態', r.ok && frozen(s0) === before && (a => a.name === '陳生' && a.label === '陳生' && a.aliases.includes('陳經理') && a.id === 'pr-1' && a.org === '甲餐廳')(r.state.company.actors.find(x => x.id === 'pr-1')));
  ok('改名：歷史輸入內文不改寫', frozen(r.state.inputs) === frozen(s0.inputs));
  ok('改名：連續改兩次，別名累積；改回舊名不留自己', (() => { const r2 = op('actorRename', { id: 'pr-1', name: '陳先生' }, r.state); const r3 = op('actorRename', { id: 'pr-1', name: '陳經理' }, r2.state); const a = r3.state.company.actors.find(x => x.id === 'pr-1'); return a.name === '陳經理' && !a.aliases.includes('陳經理') && a.aliases.includes('陳生'); })());
  r = op('actorRename', { id: 'pr-1', name: '農場主丙' });
  ok('S14 改名成另一對象已用的名稱：拒絕（改用合併），帳本不變', !r.ok && r.error === 'duplicateName' && frozen(r.state) === before);
  ok('S14 改名成別人的別名：也拒絕；改成併入自己的對象的舊名（0.40.2）則接受', !op('actorRename', { id: 'pr-2', name: '陳總' }).ok && op('actorRename', { id: 'pr-1', name: '陳總' }).ok);
  ok('改名：含電郵拒絕、空白或過長拒絕、已合併者拒絕', op('actorRename', { id: 'pr-1', name: 'a@b.c' }).error === 'contactInfo' && op('actorRename', { id: 'pr-1', name: '  ' }).error === 'invalid' && op('actorRename', { id: 'pr-1', name: '長'.repeat(21) }).error === 'invalid' && op('actorRename', { id: 'pc-m', name: '新名' }).error === 'merged');
  ok('S10 不存在的編號：所有操作都拒絕，帳本不變', ['actorRename', 'actorKind', 'actorStatus', 'actorTeam', 'actorMerge'].every(n => { const x = op(n, { id: 'nope', from: 'nope', into: 'pr-1', name: 'x', kind: 'customer', status: 'inactive', team: {} }); return !x.ok && x.error === 'notFound' && frozen(x.state) === before; }) && !op('taskOwner', { id: 'nope', owner: 'founder' }).ok);
  ok('改類別：只改 kind；格位與其他欄不變', (() => { const x = op('actorKind', { id: 'pr-2', kind: 'investor' }); return x.ok && x.state.company.actors.find(a => a.id === 'pr-2').kind === 'investor' && x.state.company.actors.find(a => a.id === 'pr-2').org === '丙農場'; })());
  ok('改類別：代碼不在名單內拒絕；改成成員要先有角色', op('actorKind', { id: 'pr-1', kind: 'vip' }).error === 'invalid' && op('actorKind', { id: 'pr-2', kind: 'team' }).error === 'needRole' && (x => x.ok && x.state.company.actors.find(a => a.id === 'pr-1').team.state === 'active')(op('actorKind', { id: 'pr-1', kind: 'team' })));
  ok('改類別：離開成員身分保留 team 資料並標不生效（0.40.2，改回成員即還原）', (a => a.team && a.team.dormant === true)(op('actorKind', { id: 'tm-1', kind: 'advisor' }).state.company.actors.find(a => a.id === 'tm-1')));
  r = op('actorStatus', { id: 'pr-1', status: 'inactive' });
  ok('不再接觸：status 寫 inactive，資料全留；恢復接觸改回 active', r.ok && r.state.company.actors.find(a => a.id === 'pr-1').status === 'inactive' && r.state.company.actors.length === s0.company.actors.length && op('actorStatus', { id: 'pr-1', status: 'active' }, r.state).state.company.actors.find(a => a.id === 'pr-1').status === 'active');
  ok('不再接觸：成員不可用此操作（要用 actorTeam）；不合規值拒絕；沒有刪除操作', op('actorStatus', { id: 'tm-1', status: 'inactive' }).error === 'useTeam' && op('actorStatus', { id: 'pr-1', status: 'deleted' }).error === 'invalid' && op('actorDelete', { id: 'pr-2' }).error === 'unknownOp');
  r = op('actorMerge', { from: 'pr-3', into: 'pr-1' });
  ok('S7 合併：輸家設 mergedInto，贏家別名加輸家名稱；歷史輸入、工作、其他對象不改寫', r.ok && (l => l.mergedInto === 'pr-1')(r.state.company.actors.find(a => a.id === 'pr-3')) && r.state.company.actors.find(a => a.id === 'pr-1').aliases.includes('李小姐') && frozen(r.state.inputs) === frozen(s0.inputs) && frozen(r.state.tasks) === frozen(s0.tasks) && r.state.company.actors.length === s0.company.actors.length);
  ok('S7 合併：輸家帶的別名也一併併入；贏家已有的名稱不重複', (() => { const s = P.applyActorOp(s0, 'actorRename', { id: 'pr-3', name: '李博士' }).state; const m = op('actorMerge', { from: 'pr-3', into: 'pr-1' }, s).state.company.actors.find(a => a.id === 'pr-1'); return m.aliases.includes('李博士') && m.aliases.includes('李小姐') && new Set(m.aliases.map(P.norm)).size === m.aliases.length; })());
  ok('S7 合併後讀取：舊編號解到贏家（工作、場景、完成站點的引用）', P.resolveActorId(r.state.company.actors, 'pr-3') === 'pr-1');
  ok('合併：自己併自己、已被併走者作輸家、成員與非成員互併都拒絕；目標已被併走則解到最終對象', op('actorMerge', { from: 'pr-1', into: 'pr-1' }).error === 'self' && op('actorMerge', { from: 'pc-m', into: 'pr-2' }).error === 'merged' && op('actorMerge', { from: 'pr-1', into: 'tm-1' }).error === 'teamMismatch' && (x => x.ok && x.state.company.actors.find(a => a.id === 'pr-2').mergedInto === 'pr-1')(op('actorMerge', { from: 'pr-2', into: 'pc-m' })));
  ok('S24 同一批操作按次序套用：先併後改名（輸家）被拒', (() => { const a = op('actorMerge', { from: 'pr-3', into: 'pr-1' }); return op('actorRename', { id: 'pr-3', name: '新名' }, a.state).error === 'merged'; })());
  ok('S8 合併不可在畫面撤回，但資料完整保留（mergedInto 與別名都在）', (() => { const a = r.state.company.actors.find(x => x.id === 'pr-3'); return a.name === '李小姐' && a.mergedInto === 'pr-1'; })());
  // 成員
  ok('actorTeam：只改 type／state／owns，其他欄不動；不合規值拒絕；非成員拒絕', (x => x.ok && (a => a.team.state === 'paused' && a.team.type === 'cofounder' && a.team.owns.join() === 'm1' && a.role === '共同創辦人')(x.state.company.actors.find(y => y.id === 'tm-1')))(op('actorTeam', { id: 'tm-1', team: { state: 'paused' } })) && op('actorTeam', { id: 'tm-1', team: { state: 'gone' } }).error === 'invalid' && op('actorTeam', { id: 'tm-1', team: { type: 'boss' } }).error === 'invalid' && op('actorTeam', { id: 'pr-1', team: { state: 'left' } }).error === 'notTeam' && op('actorTeam', { id: 'tm-1', team: { owns: 'm1' } }).error === 'invalid');
  ok('actorTeam：owns 去重', op('actorTeam', { id: 'tm-1', team: { owns: ['m1', 'm1', 'm5'] } }).state.company.actors.find(a => a.id === 'tm-1').team.owns.join() === 'm1,m5');
}

// ---- 工作負責人（狀態表 15、16） ----
{
  const s0 = base(), ac = s0.company.actors;
  ok('ownerKind：founder／ai／成員編號；沒有 owner 當 ai', P.ownerKind('founder') === 'founder' && P.ownerKind('ai') === 'ai' && P.ownerKind(undefined) === 'ai' && P.ownerKind('tm-1') === 'team');
  const v = id => P.ownerView(s0.tasks.find(t => t.id === id), ac);
  ok('S15 成員已離開：未完成工作顯示歸創辦人並標已離開，owner 不改寫', (x => x.kind === 'founder' && x.left && x.name === '周家豪')(v('t2')) && s0.tasks.find(t => t.id === 't2').owner === 'tm-3');
  ok('在職成員的工作顯示成員名稱；founder／ai 不標離開', v('t3').kind === 'team' && v('t3').name === '李家欣' && !v('t3').left && v('t1').kind === 'founder' && !v('t1').left && v('t4').kind === 'ai');
  ok('owner 指向不存在的成員：歸創辦人並標已離開', P.ownerView({ owner: 'ghost' }, ac).left === true);
  const reassign = (id, owner) => P.applyActorOp(s0, 'taskOwner', { id, owner });
  ok('S15 改派給我自己／在職成員成功，只改 owner', (x => x.ok && x.state.tasks.find(t => t.id === 't2').owner === 'founder' && x.state.tasks.find(t => t.id === 't2').dueAt === '2026-11-10')(reassign('t2', 'founder')) && reassign('t2', 'tm-1').state.tasks.find(t => t.id === 't2').owner === 'tm-1');
  ok('S16 暫停、離開的成員、非成員、AI 不可作新負責人', reassign('t2', 'tm-2').error === 'invalidOwner' && reassign('t2', 'tm-3').error === 'invalidOwner' && reassign('t2', 'pr-1').error === 'invalidOwner' && reassign('t2', 'ai').error === 'invalidOwner');
  ok('改派給已被合併的成員：解到最終成員', (() => { const x = P.applyActorOp(s0, 'actorMerge', { from: 'tm-3', into: 'tm-1' }).state; return P.applyActorOp(x, 'taskOwner', { id: 't2', owner: 'tm-3' }).state.tasks.find(t => t.id === 't2').owner === 'tm-1'; })());
}

// ---- 讀取：最近接觸、十四日、G6（狀態表 9、17、18、25–27） ----
{
  const s0 = base(), view = P.peopleView(s0, { today: TODAY }), by = id => view.actors.find(a => a.id === id);
  ok('視圖：被合併者不單獨出現；成員、已不再接觸、其餘外部對象各歸其位', !by('pc-m') && view.mergedCount === 1 && view.team.length === 3 && view.closed.map(a => a.id).join() === 'pr-4' && view.external.map(a => a.id).join() === 'pr-1,pr-2,pr-3');
  ok('最近接觸：取輸入的事件日及原話（去前綴）；請 Zero 做事（adhoc）不算接觸', (c => c && c.date === '2026-11-03' && c.text === '與陳經理見面，答應試單' && c.inputId === 'in-a')(by('pr-1').lastContact));
  ok('最近接觸：gapDays 由今日算；從未接觸改由加入日算', by('pr-1').gapDays === 4 && by('pr-3').lastContact === null && by('pr-3').gapDays === 37);
  ok('相關文件：有附件的相關輸入列出份數', by('pr-1').docs.length === 1 && by('pr-1').docs[0].count === 1);
  ok('下一步及日期：被合併者名下（陳總）的未完成跟進工作算到贏家；AI 工作不算', by('pr-1').nextTask && by('pr-1').nextTask.id === 't1' && by('pr-2').nextTask === null);
  // 名稱配對
  const m = P.actorsMentioned([A('a', '陳', 'customer'), A('b', '陳經理', 'customer'), A('c', '農場乙', 'partner')], '陳經理說可以，農場乙也一樣');
  ok('S27 最長名稱優先：「陳經理」不使「陳」也算接觸；兩個對象同時被提到都算', m.map(a => a.id).sort().join() === 'b,c' && P.actorsMentioned([A('a', '陳', 'customer'), A('b', '陳經理', 'customer')], '陳來電').map(a => a.id).join() === 'a');
  const sv = base(); sv.inputs.push({ id: 'in-v', via: 'event', title: '事件：陳總又來電', eventDate: '2026-11-06', files: [], effects: [] });
  ok('S26 名稱變體（陳總 對 陳經理）：未記為別名前不算陳經理的接觸；記別名後算', P.peopleView({ ...sv, company: { ...sv.company, actors: sv.company.actors.filter(a => a.id !== 'pc-m').map(a => a.id === 'pr-1' ? { ...a, aliases: [] } : a) } }, { today: TODAY }).actors.find(a => a.id === 'pr-1').lastContact.date === '2026-11-03' && P.peopleView(sv, { today: TODAY }).actors.find(a => a.id === 'pr-1').lastContact.date === '2026-11-06');
  const si = base(); si.inputs.push({ id: 'in-w', via: 'event', title: '事件：王先生又來電', eventDate: '2026-11-06', files: [], effects: [] });
  ok('S9 已不再接觸者又出現：最近接觸日更新，狀態不自動恢復', (v2 => v2.closed[0].lastContact.date === '2026-11-06' && v2.closed[0].status === 'inactive' && v2.external.every(a => a.id !== 'pr-4'))(P.peopleView(si, { today: TODAY })));
  const se = base(); se.events.push({ id: 'e1', at: '2026-11-05T10:00:00', actor: 'founder', type: 'input', title: '站點已完成', relatedIds: ['pc-m', 'in-x'] });
  ok('事件的 relatedIds 含對象編號（含被合併者）：算到最終對象的接觸', P.peopleView(se, { today: TODAY }).actors.find(a => a.id === 'pr-1').lastContact.date === '2026-11-05');
  // 十四日題
  const sd = base(); sd.company.actors[1].addedAt = '2026-10-01'; sd.inputs[1].eventDate = '2026-10-20';
  let due = P.contactDue(sd, { today: TODAY, limit: 3 });
  ok('十四日題：只計仍有效的外部對象；成員、不再接觸、已合併、未滿十四日者不出現；沒有接觸記錄的以加入日算', due.map(p => p.id).join() === 'pr-3,pr-2' && due[0].gapDays === 37 && due[1].gapDays === 18);
  ok('十四日題：只問沒有接觸最久的一個（limit 預設 1）', P.contactDue(sd, { today: TODAY }).map(p => p.id).join() === 'pr-3');
  sd.interviews = { contactSnooze: { 'pr-3': '2026-11-21' } };
  ok('十四日題：暫緩期內不出現，到期後再問', P.contactDue(sd, { today: TODAY }).map(p => p.id).join() === 'pr-2' && P.contactDue(sd, { today: '2026-11-21' }).map(p => p.id).join() === 'pr-3');
  const sn = base(); sn.inputs = []; for (const a of sn.company.actors) a.addedAt = '';
  ok('十四日題：沒有加入日也沒有接觸的舊對象不出題', P.contactDue(sn, { today: TODAY, limit: 3 }).length === 0);
  // G6
  const g = P.ownershipOf(s0);
  ok('S18 G6：有未離開成員時由名單生成；在職與暫停各一行，離開者不列', g && g.lines.map(l => l.name).join() === '李家欣,黃師傅' && g.lines[0].stations.join() === '農場簽約' && g.lines[1].state === 'paused' && g.lines[1].stations.join() === '牌照查詢');
  ok('S16 暫停者的站留在他那一行，不列入「目前沒有人接手」；S17 負責人都已離開的站才列入', g.unowned.length === 1 && g.unowned[0].station === '送貨準備' && g.unowned[0].formerOwners.join() === '周家豪');
  ok('G6：成員名下未完成工作最多列兩項，其餘計數', (() => { const s = base(); s.tasks.push({ id: 'x1', title: 'a', owner: 'tm-1', status: 'planned' }, { id: 'x2', title: 'b', owner: 'tm-1', status: 'planned' }, { id: 'x3', title: 'c', owner: 'tm-1', status: 'done' }); const l = P.ownershipOf(s).lines[0]; return l.tasks.length === 2 && l.moreTasks === 1; })());
  ok('S21 沒有任何未離開的成員：回傳 null（沿用公司概覽原文）', P.ownershipOf({ company: { actors: [A('a', '甲', 'customer')] } }) === null && P.ownershipOf({ company: { actors: [A('t', '丙', 'team', { team: { type: 'parttime', state: 'left', owns: [] } })] } }) === null && P.ownershipOf({}) === null);
}

// ---- brain-lib：deriveActors／pipelineOf（狀態表 11–13） ----
{
  const ms = [{ id: 'm1', short: '農場簽約', actorName: '農場主丙', pathStatus: 'confirmed', state: 'done' }, { id: 'm5', short: '餐廳試單', actorName: '陳經理', pathStatus: 'confirmed', state: 'active' }];
  const page = (items) => ({ detail: { actors: { items } } });
  const d1 = brain.deriveActors(page([{ id: 'A1', label: '陳經理（甲餐廳）', actorKind: 'customer', org: '甲餐廳', role: '採購經理' }, { id: 'A2', label: '李家欣', actorKind: 'team', role: '共同創辦人', team: { type: 'cofounder', owns: ['m1', 'mX'] } }, { id: 'A3', label: '基金 9123 4567' }, { id: 'A4', label: '青年基金', actorKind: 'investor', org: 'a@b.c' }]), ms, [], { today: TODAY });
  ok('初始化：名單項目帶類別、機構、角色、來源、加入日；團隊帶 team（只留存在的站）', d1.find(a => a.id === 'pr-A1').kind === 'customer' && d1.find(a => a.id === 'pr-A1').org === '甲餐廳' && d1.find(a => a.id === 'pr-A1').addedFrom === 'overview' && d1.find(a => a.id === 'pr-A1').addedAt === TODAY && d1.find(a => a.id === 'pr-A2').team.owns.join() === 'm1' && d1.find(a => a.id === 'pr-A2').team.state === 'active');
  ok('初始化：名稱含聯絡方式的項目不收；機構含聯絡方式只丟機構', !d1.some(a => /9123/.test(a.name)) && d1.find(a => a.id === 'pr-A4') && !('org' in d1.find(a => a.id === 'pr-A4')));
  ok('初始化：沒有清單時由里程碑決策者推出，類別為客戶或供應或合作方，來源 milestone', (x => x.length === 2 && x.every(a => a.addedFrom === 'milestone' && ['customer', 'partner'].includes(a.kind)))(brain.deriveActors(null, ms)));
  ok('初始化：重跑結果相同（冪等）', frozen(brain.deriveActors(page([{ id: 'A1', label: '陳經理（甲餐廳）' }]), ms, d1.slice(0, 1), { today: TODAY })) === frozen(brain.deriveActors(page([{ id: 'A1', label: '陳經理（甲餐廳）' }]), ms, brain.deriveActors(page([{ id: 'A1', label: '陳經理（甲餐廳）' }]), ms, d1.slice(0, 1), { today: TODAY }), { today: TODAY })));
  // S11 舊資料
  const old = [{ id: 'pr-1', name: '陳經理', label: '陳經理', kind: '客戶', fromMilestoneIds: [] }, { id: 'pr-2', name: '農場主丙', label: '農場主丙', kind: '供應', fromMilestoneIds: [] }];
  const migrated = brain.deriveActors(null, ms, old, { today: TODAY });
  ok('S11 舊對象：同步時舊字串換新代碼，補 status／aliases／addedAt，既有名稱不變；不傳入 today 則不寫日期', migrated[0].kind === 'customer' && migrated[1].kind === 'partner' && migrated[0].status === 'active' && Array.isArray(migrated[0].aliases) && migrated[0].addedAt === TODAY && migrated[0].name === '陳經理' && !('addedAt' in brain.deriveActors(null, ms, old)[0]));
  ok('S11 讀取舊對象不寫：peopleView 對缺欄位用預設，傳入的舊對象不被改動', (() => { const s = { company: { actors: old }, inputs: [], events: [], tasks: [] }, b = frozen(s); const v = P.peopleView(s, { today: TODAY }); return frozen(s) === b && v.external.length === 2 && v.external[0].kind === 'customer' && v.external[1].kind === 'partner'; })());
  // S13／S15 改名後重跑
  const renamed = P.applyActorOp({ company: { actors: d1 } }, 'actorRename', { id: 'pr-A1', name: '陳生' }).state.company.actors;
  const again = brain.deriveActors(page([{ id: 'A1', label: '陳經理（甲餐廳）' }]), ms, renamed, { today: TODAY });
  ok('S13／S15 創辦人改名後公司概覽仍寫舊名：不改回舊名，不新增對象', again.find(a => a.id === 'pr-A1').name === '陳生' && again.length === renamed.length);
  const rediscovered = brain.deriveActors(page([{ id: 'B9', label: '陳經理（甲餐廳）' }]), ms, renamed, { today: TODAY });
  ok('S13 公司概覽換了項目編號、名稱沒變：視為同一對象，不新增', rediscovered.length === renamed.length);
  const closedActors = renamed.map(a => a.id === 'pr-A1' ? { ...a, status: 'inactive' } : a);
  ok('S13 已不再接觸、已合併者不被重新啟用或改寫', brain.deriveActors(page([{ id: 'A1', label: '陳經理（甲餐廳）' }]), ms, closedActors, { today: TODAY }).find(a => a.id === 'pr-A1').status === 'inactive' && (() => { const mg = P.applyActorOp({ company: { actors: d1 } }, 'actorMerge', { from: 'pr-A4', into: 'pr-A1' }).state.company.actors; const x = brain.deriveActors(page([{ id: 'A4', label: '青年基金' }]), ms, mg, { today: TODAY }); return x.find(a => a.id === 'pr-A4').mergedInto === 'pr-A1' && x.length === mg.length; })());
  ok('S13 同名不同編號（陳（甲公司）、陳（乙公司））仍各自保留（1b 既有行為）', brain.deriveActors(page([{ id: 'A1', label: '陳（甲公司）' }, { id: 'A2', label: '陳（乙公司）' }]), []).length === 2);
  ok('合併後里程碑決策者欄含輸家舊名：算到贏家，輸家不重算', (() => { const base2 = brain.deriveActors(null, [{ id: 'm1', actorName: '陳總' }, { id: 'm2', actorName: '陳經理' }], []); const merged = P.applyActorOp({ company: { actors: base2 } }, 'actorMerge', { from: base2[0].id, into: base2[1].id }).state.company.actors; const re = brain.deriveActors(null, [{ id: 'm1', actorName: '陳總' }, { id: 'm2', actorName: '陳經理' }], merged); return re.find(a => a.id === base2[1].id).fromMilestoneIds.sort().join() === 'm1,m2' && re.find(a => a.id === base2[0].id).fromMilestoneIds.length === 0; })());

  // pipelineOf
  const tmp = makeTestTemp('people-');
  const DIR = { data: tmp, sandbox: path.join(tmp, 'sandbox'), ledger: path.join(tmp, 'ledger'), company: path.join(tmp, 'company') }; fs.mkdirSync(DIR.ledger, { recursive: true }); fs.mkdirSync(DIR.company, { recursive: true });
  const st = base(); st.milestones = [{ id: 'm1', short: '農場簽約', actorName: '農場主丙', state: 'done', pathStatus: 'confirmed', doneCounterpartIds: ['pr-2'], order: 1 }, { id: 'm5', short: '餐廳試單', actorName: '陳經理', state: 'active', pathStatus: 'confirmed', order: 2 }];
  st.company.assumptions = [{ id: 'H1', text: '陳總願意試單', grade: 'said' }];
  fs.writeFileSync(path.join(DIR.ledger, 'state.json'), JSON.stringify(st));
  const pl = brain.pipelineOf(DIR, { today: TODAY }).prospects, p1 = pl.find(p => p.id === 'pr-1');
  ok('pipelineOf：只列仍有效的外部對象（不含成員、不再接觸、已合併）', pl.map(p => p.id).join() === 'pr-1,pr-2,pr-3');
  ok('pipelineOf：被合併者（陳總）的假設證據算到贏家（取最高格位）', p1.stage === 1);
  ok('pipelineOf：舊讀取處用的 kind 仍是舊顯示字串，另帶代碼；帶機構、角色、最近接觸、相關文件', p1.kind === '客戶' && p1.kindCode === 'customer' && pl.find(p => p.id === 'pr-2').kind === '供應' && p1.org === '甲餐廳' && p1.lastContact.date === '2026-11-03' && p1.docs.length === 1 && pl.find(p => p.id === 'pr-3').kindCode === 'investor');
  ok('pipelineOf：下一步用已確認的人處理工作（含被合併者名下的）及到期日；AI 工作仍標 ai', p1.next === '向陳經理跟進試單' && p1.nextBy === 'founder' && p1.nextDue === '2026-11-12' && p1.nextTaskId === 't1' && pl.find(p => p.id === 'pr-2').nextBy === 'ai');
  ok('pipelineOf：完成站點經合併解析（doneCounterpartIds 指向輸家也算贏家）', (() => { const s2 = JSON.parse(JSON.stringify(st)); s2.milestones[0].doneCounterpartIds = ['pc-m']; return brain.pipelineOf(DIR, { today: TODAY, state: s2 }).prospects.find(p => p.id === 'pr-1').stage === 2; })());
  ok('pipelineOf：opts.state 疊加的改正即時生效（改名、不再接觸）', (() => { const s2 = P.applyActorOp(P.applyActorOp(st, 'actorRename', { id: 'pr-1', name: '陳生' }).state, 'actorStatus', { id: 'pr-2', status: 'inactive' }).state; const r = brain.pipelineOf(DIR, { today: TODAY, state: s2 }).prospects; return r.map(p => p.id).join() === 'pr-1,pr-3' && r[0].name === '陳生' && r[0].aliases.includes('陳經理'); })());
  ok('counterpartsOf：不含成員、不再接觸者；仍可讀', (() => { const r = brain.counterpartsOf(DIR, { today: TODAY }); return r.map(p => p.id).join() === 'pr-1,pr-2,pr-3' && Array.isArray(r[0].assumptions); })());
  // 確認一件把對象推前一格的事件：同時算作與他的最近接觸（經假設／站點編號關聯）；有格位而完全沒有接觸紀錄：不寫很久沒有接觸
  {
    const st2 = base(); st2.company.assumptions = [{ id: 'H1', text: '陳經理願意試單', grade: 'did' }, { id: 'H2', text: '李小姐有興趣', grade: 'said' }];
    st2.inputs = []; st2.events = [{ id: 'e9', at: '2026-11-05T10:00:00', actor: 'founder', type: 'input', title: '假設「陳經理願意試單」：口頭表示 → 實際行動', relatedIds: ['H1'] }];
    st2.company.actors.find(a => a.id === 'pr-1').addedAt = '2026-10-01'; st2.company.actors.find(a => a.id === 'pr-3').addedAt = '2026-10-01';
    fs.writeFileSync(path.join(DIR.ledger, 'state.json'), JSON.stringify(st2));
    const r = brain.pipelineOf(DIR, { today: TODAY, state: st2 }).prospects, a1 = r.find(p => p.id === 'pr-1'), a3 = r.find(p => p.id === 'pr-3');
    ok('確認事件把對象推前：該事件同時是最近接觸（日期、原話），日數由該日算', a1.stage === 2 && a1.lastContact && a1.lastContact.date === '2026-11-05' && a1.gapDays === 2);
    ok('格位高於未接觸而沒有任何接觸紀錄：lastContact 為空、gapDays 為空（不算很久沒有接觸）', a3.stage === 1 && a3.lastContact === null && a3.gapDays === null);
    ok('格位為未接觸、沒有接觸、加入已久：仍按加入日算日數', brain.pipelineOf(DIR, { today: TODAY, state: { ...st2, company: { ...st2.company, assumptions: [] } } }).prospects.find(p => p.id === 'pr-3').gapDays === 37);
    ok('十四日題以對象推進的接觸及日數為準：沒有紀錄的有格位對象不問；暫緩期內不問', (() => { const due = brain.contactDueOf(DIR, { today: TODAY, state: { ...st2, company: { ...st2.company, assumptions: [] } }, limit: 3 }); const un = brain.contactDueOf(DIR, { today: TODAY, state: st2, limit: 3 }); const sn = brain.contactDueOf(DIR, { today: TODAY, state: { ...st2, company: { ...st2.company, assumptions: [] }, interviews: { contactSnooze: { 'pr-3': '2026-11-21' } } }, limit: 3 }); return due.some(p => p.id === 'pr-3') && !un.some(p => p.id === 'pr-3') && !sn.some(p => p.id === 'pr-3'); })());
  }
  ok('S12 沒有 company.actors（舊格式）：照舊即時推出，不報錯', (() => { const s2 = { milestones: st.milestones, company: { assumptions: [] }, inputs: [], events: [], tasks: [] }; return brain.pipelineOf(DIR, { today: TODAY, state: s2 }).prospects.map(p => p.name).sort().join() === '農場主丙,陳經理'; })());
  try { assertTestOut(tmp); fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
}

// ---- 創辦人操作疊加（dash-lib.applyFounderOps）：本機即時，不經 Zero ----
{
  const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
  const s0 = base(), before = frozen(s0);
  const ov = ops => dash.applyFounderOps(s0, ops.map((o, i) => ({ id: 'fo-' + i, at: '2026-11-07T10:00:00', ...o })));
  const r1 = ov([{ op: 'actorRename', target: 'pr-1', value: { name: '陳生' } }]);
  ok('疊加：改名即時見效，舊名進別名；不改傳入狀態', r1.company.actors.find(a => a.id === 'pr-1').name === '陳生' && r1.company.actors.find(a => a.id === 'pr-1').aliases.includes('陳經理') && frozen(s0) === before);
  const r2 = ov([{ op: 'actorMerge', target: 'pr-3', value: { into: 'pr-1' } }, { op: 'actorStatus', target: 'pr-2', value: { status: 'inactive' } }, { op: 'actorTeam', target: 'tm-1', value: { team: { state: 'left' } } }]);
  ok('疊加：合併、不再接觸、成員狀態按次序套用', r2.company.actors.find(a => a.id === 'pr-3').mergedInto === 'pr-1' && r2.company.actors.find(a => a.id === 'pr-2').status === 'inactive' && r2.company.actors.find(a => a.id === 'tm-1').team.state === 'left');
  const r3 = ov([{ op: 'actorRename', target: 'pr-1', value: { name: '農場主丙' } }, { op: 'actorKind', target: 'nope', value: { kind: 'customer' } }]);
  ok('疊加：重名、找不到的操作原樣不動，其他操作不受影響', frozen(r3.company.actors) === frozen(s0.company.actors));
  ok('疊加：工作負責人改派即時見效；改派給暫停成員被拒', ov([{ op: 'taskOwner', target: 't2', value: { owner: 'founder' } }]).tasks.find(t => t.id === 't2').owner === 'founder' && ov([{ op: 'taskOwner', target: 't2', value: { owner: 'tm-2' } }]).tasks.find(t => t.id === 't2').owner === 'tm-3');
  ok('疊加：同一批操作重播結果相同（冪等）', frozen(ov([{ op: 'actorRename', target: 'pr-1', value: { name: '陳生' } }, { op: 'actorRename', target: 'pr-1', value: { name: '陳生' } }])) === frozen(r1));
}

// ---- 明文邊界 ----
{
  const src = fs.readFileSync(path.join(PROTO, 'people-ops.mjs'), 'utf8');
  const s1 = P.applyNewActor(base(), { inputId: 'in-a', qid: 'q1', item: { kind: 'newActor', name: '黃小姐', actorKind: 'customer', why: 'x', phone: '91234567', email: 'a@b.c', salary: 9 }, answer: 'add', today: TODAY });
  const a = s1.company.actors.find(x => x.name === '黃小姐');
  ok('邊界：新對象只有約定欄位，聯絡方式、薪酬等多出的欄一律丟棄', a && !('phone' in a) && !('email' in a) && !('salary' in a) && Object.keys(a).every(k => ['id', 'name', 'label', 'kind', 'org', 'role', 'aliases', 'status', 'addedFrom', 'addedAt', 'confirmedAt', 'fromMilestoneIds', 'team', 'mergedInto'].includes(k)));
  ok('邊界：沒有刪除對象的操作', !P.ACTOR_OPS.some(n => /delete|remove/i.test(n)) && !/splice|\.filter\(a => a\.id !==/.test(src));
}

const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
