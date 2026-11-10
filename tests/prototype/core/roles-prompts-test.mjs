// Zero 團隊分工（0.41.0）第 5 線測試：AI 指示檔（ai-roles.md、ai-rhythm.md、ai-proofread.md）與示範資料（fixtures/demo-shop）。
// 只讀檔、只用純函數模組；不開伺服器、不開 AI、不寫任何資料夾。
// 用法：node tests/prototype/core/roles-prompts-test.mjs [原型資料夾] [輸出資料夾]（結束碼 0 ＝ 全過）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = process.argv[2] && fs.existsSync(path.join(process.argv[2], 'roles-ops.mjs')) ? path.resolve(process.argv[2]) : path.resolve(HERE, '..', '..', '..', 'prototypes', 'proofread');
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const R = await import(pathToFileURL(path.join(PROTO, 'roles-ops.mjs')).href);
const B = await import(pathToFileURL(path.join(PROTO, 'brief-lib.mjs')).href);
const P = await import(pathToFileURL(path.join(PROTO, 'pace-lib.mjs')).href);
const styleIssues = s => N.styleIssues(String(s || ''));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const J = x => JSON.stringify(x);
const read = f => fs.readFileSync(path.join(PROTO, f), 'utf8').replace(/\r\n/g, '\n');
const readJ = f => JSON.parse(read(f));
const blocks = md => [...md.matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]);

/* ---------- A. ai-roles.md ---------- */
const roles = read('ai-roles.md');
ok('A1 ai-roles.md 寫明輸出檔 out/roles.json 及輸入檔', roles.includes('out/roles.json') && roles.includes('confirmed-page.md') && roles.includes('roles-input.json'));
const FIELDS = ['title', 'mission', 'milestoneIds', 'supports', 'targets', 'how', 'strategy', 'sources', 'deliverables', 'knowledge', 'bounds', 'activation', 'unassigned', 'cards'];
ok('A2 ai-roles.md 逐一寫明交回欄位', FIELDS.every(f => roles.includes('`' + f + '`') || roles.includes('"' + f + '"')), FIELDS.filter(f => !roles.includes('`' + f + '`') && !roles.includes('"' + f + '"')));
ok('A3 ai-roles.md 寫明規則：最多四張、三個職級、4 至 10 字、每站最多一個、knowledge 要來源、bounds 只寫加條、不擬子崗位、不寫聯絡方式',
  roles.includes('最多四張') && R.RANKS.every(r => roles.includes(r)) && roles.includes('4 至 10') && roles.includes('最多一個負責崗位') && roles.includes('每條必須有 `source`') && roles.includes('只寫加條') && roles.includes('不擬子崗位') && roles.includes('不寫聯絡方式'));
ok('A4 ai-roles.md 的可交類型、對象類別、頭像以外的列舉與程式常數一致', P.DELIVERABLE_TYPES.every(t => roles.includes('`' + t + '`')) && R.TARGET_KINDS.every(t => roles.includes('`' + t + '`')));
ok('A5 ai-roles.md 的 supports 規則：只可 team／advisor，且寫 id', roles.includes('`team`') && roles.includes('`advisor`') && roles.includes('的 `id`'));
// 範例材料（與 ai-roles.md 的虛構烘焙工房一致）
const sampleBlock = blocks(roles).find(b => b.includes('食品牌照主任') && b.includes('"unassigned"'));
const templateBlock = blocks(roles).find(b => b.includes('"title": "稱號"'));
let sample = null, template = null;
try { sample = JSON.parse(sampleBlock); } catch { }
try { template = JSON.parse(templateBlock); } catch { }
ok('A6 ai-roles.md 內有可解析的完整範例及欄位樣板', !!sample && !!template && Array.isArray(sample.cards) && sample.cards.length === 2);
const bakeryState = () => ({
  ledgerFrom: 'pg-b', intake: { confirmedAt: '2026-11-01T10:00:00' }, demo: false, teammates: [],
  company: { actors: [
    { id: 'pc-1', name: '何美玲', kind: 'team', role: '營運', aliases: [], status: 'active', addedFrom: 'overview', team: { type: 'cofounder', state: 'active' } },
    { id: 'pc-2', name: '鄭伯', kind: 'advisor', role: '食品安全顧問', aliases: [], status: 'active', addedFrom: 'overview' },
    { id: 'pc-3', name: '社區中心', kind: 'customer', aliases: [], status: 'active', addedFrom: 'overview' }
  ] },
  milestones: [
    { id: 'm1', short: '試做配方', pathStatus: 'confirmed', state: 'active' }, { id: 'm2', short: '咖啡店試售', pathStatus: 'confirmed', state: 'active' },
    { id: 'm3', short: '每週固定供應', pathStatus: 'confirmed', state: 'not_started' }, { id: 'm4', short: '食品牌照', pathStatus: 'confirmed', state: 'not_started' }
  ]
});
const chk = (raw, extra = {}) => R.checkRoleCards(raw, { state: bakeryState(), styleIssues, first: true, ...extra });
const c0 = sample ? chk(sample) : { ok: false, errors: ['沒有範例'] };
ok('A7 範例 roles.json 照指示原樣寫，通過 checkRoleCards（首次、2 張、1 個未分配站）', c0.ok && c0.cards.length === 2 && c0.unassigned.length === 1, c0.errors);
ok('A8 範例每張卡的欄位集合與樣板一致（沒有多寫、沒有漏寫）', !!sample && sample.cards.every(c => J(Object.keys(c).sort()) === J(Object.keys(template).sort())), sample && sample.cards.map(c => Object.keys(c)));
ok('A9 通過後 bounds 併入公司預設且只多不少；avatarKind 由稱號推出；sources 附 confirmedPage', c0.ok && c0.cards.every(c => R.PERMISSIONS_DEFAULT.askFirst.every(x => c.bounds.askFirst.includes(x)) && c.sources[0] === 'confirmedPage') && c0.cards[0].avatarKind === 'outreach' && c0.cards[1].avatarKind === 'compliance', c0.cards.map(c => c.avatarKind));
// 反例：指示列出的每條規則，違反時真的被退回（證明指示與核對對得上）
const mut = f => { const s = JSON.parse(sampleBlock); f(s); return chk(s); };
ok('A10 反例：稱號職級不對、含伙伴、缺職級、超長、含 Zero 都被退回', ['社區渠道拓展組長', '社區渠道伙伴專員', '社區渠道拓展', '社區渠道拓展及食品牌照協調經理', 'Zero 拓展經理'].every(t => !mut(s => { s.cards[0].title = t; }).ok));
ok('A11 反例：supports 指向客戶、knowledge 缺來源、bounds 不是清單、有子角色欄、啟用任務不屬該卡的站都被退回',
  !mut(s => { s.cards[0].supports = ['pc-3']; }).ok && !mut(s => { delete s.cards[0].knowledge[0].source; }).ok && !mut(s => { s.cards[0].bounds = { tellAfter: 'x', askFirst: [] }; }).ok &&
  !mut(s => { s.cards[0].parentId = 'tm-1'; }).ok && !mut(s => { s.cards[0].activation.milestoneId = 'm4'; }).ok);
ok('A12 反例：兩卡搶同一站、已確認的站既無崗位又不在 unassigned、第五張卡都被退回',
  !mut(s => { s.cards[1].milestoneIds = ['m2']; }).ok && !mut(s => { s.unassigned = []; }).ok && !mut(s => { const c = s.cards[0]; s.cards = [0, 1, 2, 3, 4].map(i => ({ ...c, title: ['甲店拓展經理', '乙店拓展經理', '丙店拓展經理', '丁店拓展經理', '戊店拓展經理'][i], milestoneIds: [i < 2 ? ['m2', 'm3'][i] : 'm' + (i + 1)] })); }).ok);
ok('A13 範例文字欄位沒有內部用語或聯絡方式', sample.cards.every(c => [c.mission, c.strategy, ...c.how, ...c.knowledge.map(k => k.text), c.activation.title, c.activation.deliverable].every(t => !styleIssues(t).length && !/\d{4}[- ]?\d{4}|@/.test(t))), sample.cards.map(c => styleIssues(c.mission)));

/* ---------- B. ai-rhythm.md（一次一件、八段說明） ---------- */
const rhythm = read('ai-rhythm.md');
ok('B1 ai-rhythm.md 寫明每次只做一件、只做 task.md 交來的工作，並不再有「揀做乜」排序', rhythm.includes('每次啟動只交給你一件工作') && rhythm.includes('task.md') && !rhythm.includes('揀做乜') && !rhythm.includes('揀第一樣'));
ok('B2 ai-rhythm.md 寫明八段說明的段名及名詞表', B.SECTIONS.every(sec => rhythm.includes(sec)) || ['目標', '範圍與排除項', '停止及回報條件', '權限', '第一步', '交付與驗收'].every(w => rhythm.includes(w)), B.SECTIONS.filter(w => !rhythm.includes(w)));
ok('B3 ai-rhythm.md 寫明最多兩份、兩分鐘、依據欄、草稿，未發送、audience 與 type', rhythm.includes('最多交兩份') && rhythm.includes('兩分鐘') && rhythm.includes('依據') && rhythm.includes('草稿，未發送') && rhythm.includes('`audience`') && rhythm.includes('`type`') && rhythm.includes('external'));
ok('B4 ai-rhythm.md 寫明停止及回報：卡住時 artifacts 留空、blockedOn 寫等候甚麼；問題寫成 ask.json', rhythm.includes('`artifacts` 留空') && rhythm.includes('`blockedOn`') && rhythm.includes('out/ask.json'));
const rb = blocks(rhythm).find(b => b.includes('"artifacts"'));
let receipt = null; try { receipt = JSON.parse(rb); } catch { }
ok('B5 ai-rhythm.md 的收據範例可解析，每份產出有 type（可交類型）與 audience（external／internal），≤ 2 份', !!receipt && Array.isArray(receipt.artifacts) && receipt.artifacts.length <= P.ARTIFACTS_MAX && receipt.artifacts.every(a => P.DELIVERABLE_TYPES.includes(a.type) && ['external', 'internal'].includes(a.audience)), receipt);
ok('B6 ai-rhythm.md 的 type 列舉與 DELIVERABLE_TYPES 一致', P.DELIVERABLE_TYPES.every(t => rhythm.includes('`' + t + '`')));
ok('B7 自足：ai-rhythm.md／ai-roles.md／ai-proofread.md 本身不含「按上文」一類指向上一次的字眼', ['ai-rhythm.md', 'ai-roles.md', 'ai-proofread.md'].every(f => !B.forbiddenHits(read(f)).length), ['ai-rhythm.md', 'ai-roles.md', 'ai-proofread.md'].map(f => B.forbiddenHits(read(f))));

/* ---------- C. ai-proofread.md 與 buildProofreadBrief 一起使用 ---------- */
const proof = read('ai-proofread.md');
ok('C1 ai-proofread.md 寫明輸出檔 out/proofread.json、六項固定檢查名稱、三種判定、line 與 issues', proof.includes('out/proofread.json') && P.CHECK_ITEMS.every(i => proof.includes('`' + i + '`')) && P.VERDICTS.every(v => proof.includes('`' + v + '`')) && proof.includes('`line`') && proof.includes('`issues`'), P.CHECK_ITEMS.filter(i => !proof.includes('`' + i + '`')));
const pb = blocks(proof).find(b => b.includes('"verdict"'));
let pr = null; try { pr = JSON.parse(pb); } catch { }
const pc = pr ? P.checkProofreadResult(pr, { styleIssues }) : { ok: false, errors: ['沒有範例'] };
ok('C2 ai-proofread.md 的範例通過 checkProofreadResult（六項齊、line 書面語 ≤ 40 字）', pc.ok && pc.verdict === 'pass_with_notes' && pc.issues.length === 1, pc.errors);
ok('C3 反例：缺一項檢查、發回沒有 issues、line 過長，被 checkProofreadResult 退回', !P.checkProofreadResult({ ...pr, checks: pr.checks.slice(1) }).ok && !P.checkProofreadResult({ ...pr, verdict: 'return', issues: [] }).ok && !P.checkProofreadResult({ ...pr, line: '字'.repeat(41) }).ok);
const brief = B.buildProofreadBrief({ artifactTitle: '餐廳乙試單安排確認訊息草稿', roleTitle: '餐廳拓展經理', station: '餐廳試單', doneWhen: '五份試單回饋', round: 1,
  files: [{ name: 'followup-draft.md', about: '要校對的產出全文' }, { name: 'confirmed-page.md', about: '創辦人確認的公司概覽' }, { name: 'ai-proofread.md', about: '校對的六項檢查及 out/proofread.json 格式' }],
  glossary: [{ term: '餐廳拓展經理', meaning: '負責餐廳試單與下單的崗位' }, { term: '餐廳試單', meaning: '路線上的一站' }] });
const bc = B.checkBrief(brief, { files: ['followup-draft.md', 'confirmed-page.md', 'ai-proofread.md'], names: ['餐廳拓展經理', '餐廳試單'] });
ok('C4 校對說明（buildProofreadBrief）列出 ai-proofread.md 後通過 checkBrief；第一步要求先讀第三段列出的檔', bc.ok && brief.includes('`ai-proofread.md`') && brief.includes(B.FIRST_STEP_PREFIX), bc.errors);
ok('C5 校對說明本身只提「checks 六項」而不列名稱：沒有 ai-proofread.md 時 AI 無從知道六項（所以需要本檔）', !P.CHECK_ITEMS.some(i => brief.includes(i)) && brief.includes('checks 六項'));

/* ---------- D. 示範資料 state.json ---------- */
const S = readJ('fixtures/demo-shop/state.json');
const tm = S.teammates, msById = Object.fromEntries(S.milestones.map(m => [m.id, m])), liveMs = S.milestones.filter(m => m.pathStatus !== 'retired');
const actors = S.company.actors;
ok('D1 示範三張卡：稱號合規（checkTitle、職級、4 至 10 字）且 name 鏡射 title', tm.length === 3 && tm.every(t => t.title === t.name && R.checkTitle(t.title, { actors, styleIssues }).ok && R.RANKS.some(r => t.title.endsWith(r))), tm.map(t => [t.title, R.checkTitle(t.title, { actors, styleIssues }).errors]));
ok('D2 示範三卡改名：工房採購專員、收款及物流主任、訂戶拓展經理；舊名不再出現', J(tm.map(t => t.title)) === J(['工房採購專員', '收款及物流主任', '訂戶拓展經理']) && !JSON.stringify(S).match(/採購伙伴|合規助理|"訂戶拓展"/));
ok('D3 站上的 ownerName 跟隨新稱號', S.milestones.filter(m => m.ownerKind === 'teammate').every(m => m.ownerName === tm.find(t => t.id === m.ownerId).title));
const owners = new Map(); let dup = false; for (const t of tm) for (const id of t.milestoneIds) { if (owners.has(id)) dup = true; owners.set(id, t.id); }
ok('D4 每站最多一張卡；每個已確認／試行的站都有負責崗位；卡只指向未撤回的站', !dup && liveMs.filter(m => ['confirmed', 'trial'].includes(m.pathStatus)).every(m => owners.has(m.id)) && tm.every(t => t.milestoneIds.length && t.milestoneIds.every(id => msById[id] && msById[id].pathStatus !== 'retired')));
ok('D5 supports 只指向名單內仍在的團隊成員／顧問（黃先生暫停中仍算在名單）', tm.every(t => t.supports.every(id => { const a = actors.find(x => x.id === id); return a && R.isLive?.(a) !== false && ['team', 'advisor'].includes(a.kind); })), tm.map(t => t.supports));
ok('D6 欄位值合規：targets、deliverables、sources、knowledge 來源、how 條數與字數、mission／strategy 字數',
  tm.every(t => t.targets.every(k => R.TARGET_KINDS.includes(k)) && t.deliverables.length && t.deliverables.every(x => P.DELIVERABLE_TYPES.includes(x)) && t.sources[0] === 'confirmedPage' && t.knowledge.length <= 6 && t.knowledge.every(k => k.text && ['confirmedPage'].includes(k.source)) &&
    t.how.length >= 1 && t.how.length <= 3 && t.how.every(x => x.length <= 40) && t.mission.length <= 60 && t.strategy.length <= 80));
ok('D7 頭像類別在八類內且與稱號推算一致；生命週期合法；暫停有原因', tm.every(t => R.AVATAR_KINDS.includes(t.avatarKind) && t.avatarKind === R.avatarKindOf(t.title) && R.LIFECYCLES.includes(t.lifecycle)) && tm.filter(t => t.lifecycle === 'paused').every(t => t.pausedReason && t.pausedReason.length <= 80) && tm.some(t => t.lifecycle === 'enabled') && tm.some(t => t.lifecycle === 'planned') && tm.some(t => t.lifecycle === 'paused'), tm.map(t => [t.avatarKind, t.lifecycle]));
const addsOf = (t, k) => t.bounds[k].filter(x => !R.PERMISSIONS_DEFAULT[k].includes(x));
ok('D8 bounds 已併入公司預設且只多不少（加條各自合規、與 inheritBounds 結果一致）；已啟用卡有 lockedAt', tm.every(t => R.PERMISSIONS_DEFAULT.askFirst.every(x => t.bounds.askFirst.includes(x)) && R.PERMISSIONS_DEFAULT.tellAfter.every(x => t.bounds.tellAfter.includes(x)) && R.checkBounds({ tellAfter: addsOf(t, 'tellAfter'), askFirst: addsOf(t, 'askFirst') }).ok && J(R.inheritBounds(R.PERMISSIONS_DEFAULT, { tellAfter: addsOf(t, 'tellAfter'), askFirst: addsOf(t, 'askFirst') }).askFirst) === J(t.bounds.askFirst)) && tm.filter(t => t.activation).every(t => t.bounds.lockedAt));
const task = id => S.tasks.find(t => t.id === id);
ok('D9 啟用任務：每張卡的 activationTaskId 指向屬該卡、cadence 為 activation 的工作；待啟用卡的啟用任務已交付並待驗收', tm.every(t => { const k = task(t.activationTaskId); return k && k.teammateId === t.id && k.cadence === 'activation'; }) && (k => k.status === 'done' && k.needsAcceptance && !k.acceptedBy && k.packId === 'ask-demo-activation')(task(tm.find(t => t.lifecycle === 'planned').activationTaskId)));
ok('D10 已啟用卡的 activation 指向已接受的工作', tm.filter(t => t.activation).every(t => (k => k.status === 'done' && k.acceptedBy === 'founder')(task(t.activation.taskId)) && t.activation.taskId === t.activationTaskId && t.activation.acceptedAt && t.activation.replyFile && t.activation.cardHash), tm.map(t => t.activation));
const CAD = ['activation', 'daily', 'rewrite', 'proofread', 'standing'];
ok('D11 帶 teammateId 的工作全部有 cadence（合法值）；不帶的不亂加', S.tasks.filter(t => t.teammateId).every(t => CAD.includes(t.cadence)) && S.tasks.filter(t => !t.teammateId).every(t => !('cadence' in t)));
ok('D12 company.permissions 為三格預設（來源 default）；rhythm.pace 為 standard', J(S.company.permissions.askFirst) === J(R.PERMISSIONS_DEFAULT.askFirst) && J(S.company.permissions.self) === J(R.PERMISSIONS_DEFAULT.self) && J(S.company.permissions.tellAfter) === J(R.PERMISSIONS_DEFAULT.tellAfter) && S.company.permissions.source === 'default' && S.company.rhythm.pace === 'standard' && P.paceKey(S) === 'standard');
// 把示範卡改寫成 Zero 會交回的 roles.json 形狀，用 checkRoleCards 逐張核對（確認前的狀態：teammates 清空）
const raw = { cards: tm.map(t => ({ title: t.title, mission: t.mission, milestoneIds: t.milestoneIds, supports: t.supports, targets: t.targets, how: t.how, strategy: t.strategy, sources: t.sources.filter(x => x !== 'confirmedPage'), deliverables: t.deliverables, knowledge: t.knowledge, bounds: { tellAfter: addsOf(t, 'tellAfter'), askFirst: addsOf(t, 'askFirst') },
  activation: { title: task(t.activationTaskId).title, deliverable: '一份「' + task(t.activationTaskId).title + '」', milestoneId: (task(t.activationTaskId).milestoneId) } })), unassigned: [] };
const dc = R.checkRoleCards(raw, { state: { ...S, teammates: [], milestones: S.milestones.map(m => ({ ...m })) }, actors, styleIssues, first: true });
ok('D13 示範三卡改寫成 roles.json 形狀後通過 checkRoleCards（首次）', dc.ok && dc.cards.length === 3, dc.errors);
ok('D14 示範卡的文字欄位通過 names.js 檢查', tm.every(t => [t.title, t.mission, t.strategy, t.pausedReason || '', ...t.how, ...t.knowledge.map(k => k.text), ...t.bounds.askFirst.filter(x => !R.PERMISSIONS_DEFAULT.askFirst.includes(x))].every(x => !styleIssues(x).length)), tm.map(t => [t.mission, t.strategy, ...t.how].filter(x => styleIssues(x).length)));

/* ---------- E. 示範題目包（R1 確認崗位、R3 驗收啟用任務）及相關紀錄 ---------- */
const asks = readJ('fixtures/demo-shop/asks.json'), pk = id => asks.find(p => p.id === id);
const rp = pk('ask-demo-roles'), ap = pk('ask-demo-activation');
ok('E1 R1 確認崗位包：decision、rolesSync.key、followAll、三題；選項文字與 apply 照約定', rp && rp.todoType === 'decision' && rp.rolesSync && rp.rolesSync.key && rp.followAll === true && rp.questions.length === 3 &&
  rp.questions.every(q => q.kind === 'choice' && q.effect === 'now' && J(q.options.map(o => o.text)) === J(['由 Zero 承擔', '改名', '不要這個崗位']) && J(q.options.map(o => o.apply.op)) === J(['roleAccept', 'roleRename', 'roleDecline']) && q.options[0].rec && q.options[1].input === true && q.inputHint && q.value === '由 Zero 承擔' && q.why));
ok('E2 R1 每題 roleCard：稱號對應示範卡、站名取自該卡負責的站、支援寫「姓名（職責）」、askFirst 為加條、啟用任務有文字',
  rp && rp.questions.every((q, i) => { const c = q.roleCard, t = tm.find(x => x.title === c.title); return t && c.avatarKind === t.avatarKind && J(c.stations.sort()) === J(t.milestoneIds.map(id => msById[id].title || msById[id].short).sort()) && c.supports.every(s => /^.+（.+）$/.test(s)) && c.askFirst.length && c.activation; }), rp && rp.questions.map(q => q.roleCard.stations));
const aq = ap && ap.questions[0].acceptance;
ok('E3 R3 驗收包：pack.acceptance 帶任務編號及草稿全文，題目帶 acceptance 欄位；三個選項字句', ap && ap.todoType === 'acceptance' && ap.fromRun === 'R-demo-e' && ap.acceptance && ap.acceptance.taskId === 't14' && ap.acceptance.artifact && ap.acceptance.artifact.title && ap.acceptance.artifact.text.startsWith('草稿，未發送') && aq && aq.taskId === 't14' && aq.teammateId === 'tm-rest' && aq.roleTitle === '訂戶拓展經理' && aq.avatarKind === 'outreach' && aq.activation === true && aq.qaVerdict === 'pass' && aq.qaLine.length <= 40 && aq.artifactTitle === ap.acceptance.artifact.title &&
  ap.questions[0].id === 'accept' && ap.questions[0].ask === '接受即啟用「訂戶拓展經理」' && J(ap.questions[0].options.map(o => o.text)) === J(['接受', '退回重做', '接受，但我想改方向']));
const art = readJ('fixtures/demo-shop/roles-artifact.json');
const run = S.runs.find(r => r.id === 'R-demo-e');
ok('E4 R3 草稿檔（roles-artifact.json）與驗收包、執行紀錄、產出清單一致；草稿以「草稿，未發送」開頭且判為對外', art.runId === ap.fromRun && art.title === ap.acceptance.artifact.title && art.text === ap.acceptance.artifact.text && run && run.teammateId === 'tm-rest' && run.qa && run.qa.verdict === 'pass' && run.qa.line === aq.qaLine && S.artifacts.some(a => a.runId === 'R-demo-e' && a.title === art.title) && art.text.startsWith('草稿，未發送') && P.isExternal({ type: 'message', text: art.text }).external === true);
ok('E5 草稿沒有金額、日期承諾、聯絡方式；每條依據可在示範資料找到（陳經理在名單、創辦人行動「向陳經理跟進合作推介」的下一步）', !/(\$|HK|元|每週\s*\d)/.test(art.text) && !/\d{4}[- ]?\d{4}|@/.test(art.text) && actors.some(a => a.name === '陳經理' && a.org === '博主乙') && S.tasks.some(t => t.id === 'f5' && t.next === '問清楚合作推介日期及形式'));
ok('E6 decisions 與 tasks 指向存在的題目包；要主線接入的 demo-seed 產出條目見進度檔', ['d-roles', 'd-activation'].every(id => { const d = S.decisions.find(x => x.id === id); return d && pk(d.packId) && d.status === 'pending'; }) && S.tasks.filter(t => t.packId && String(t.packId).startsWith('ask-demo-')).every(t => pk(t.packId)));
const walk = (o, out = []) => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach(x => walk(x, out)); else if (o && typeof o === 'object') for (const k of Object.keys(o)) if (!['id', 'op', 'avatarKind', 'format', 'key', 'kind', 'effect', 'todoType', 'artifactFile', 'qaVerdict', 'teammateId', 'taskId', 'fromRun', 'milestoneId', 'askedAt', 'askedBy', 'apply'].includes(k)) walk(o[k], out); return out; };
const bad = walk([rp, ap]).filter(s => styleIssues(s).length);
ok('E7 兩包題目的所有文字通過 names.js 檢查（無內部用語、編號、短日期、口語）', !bad.length, bad.map(s => [s, styleIssues(s)]));
const bad2 = [run.label, run.summary, run.qa.line, ...S.events.filter(e => e.id === 'e17').map(e => e.title), ...S.decisions.filter(d => /^d-(roles|activation)/.test(d.id)).map(d => d.title), task('t14').title, task('t7').title, art.title, art.label, art.summary, art.text].filter(s => styleIssues(s).length);
ok('E8 新增的執行紀錄、事件、決定、工作標題及草稿全文通過 names.js 檢查', !bad2.length, bad2.map(s => [s, styleIssues(s)]));
ok('E9 示範仍是虛構公司：不含真實資料夾路徑字樣', !/prototypes\/proofread\/data/.test(JSON.stringify([S, asks, art])));

/* ---------- F. ai-roles.md 的四種特別要求（照第 1 線外殼 rolesStep／checkRolesOut 的呼叫方式核對） ---------- */
ok('F0 ai-roles.md 寫明四種情況的判斷依據及共同規矩', ['特別要求', 'request', 'returnedBecause', 'moveStations', 'keepStations', '"station"', '`stations`', '`why`'].every(w => roles.includes(w)) && roles.includes('只擬**一張卡**') && roles.includes('`unassigned` 寫空清單'));
const modeState = () => { const s = bakeryState(); s.milestones.push({ id: 'm5', short: '線上訂購試行', pathStatus: 'confirmed', state: 'not_started' });
  s.teammates = [{ id: 'tm-1', name: '社區渠道拓展經理', title: '社區渠道拓展經理', milestoneIds: ['m2', 'm3'], lifecycle: 'enabled' }, { id: 'tm-2', name: '食品牌照主任', title: '食品牌照主任', milestoneIds: ['m4'], lifecycle: 'planned' }]; return s; };
const NEWST = '__new';
// 同 run.mjs checkRolesOut／rolesStep：非首次一律 lenient；加站時暫用站編號；重擬時舊卡當已取消；拆分時原卡只留保留的站
function shellCheck(mode, raw, s) {
  let st = s, r = raw; const reqs = new Map();
  if (mode === 'add' && raw && Array.isArray(raw.cards)) {
    st = { ...s, milestones: [...s.milestones, { id: NEWST, short: '', pathStatus: 'confirmed' }] };
    r = { ...raw, cards: raw.cards.map(c => { if (!(c && c.station && typeof c.station === 'object')) return c; const req = R.stationRequest(s, c.station); if (!req) return { ...c, milestoneIds: [] };
      reqs.set(c.title, req); return { ...c, milestoneIds: [...new Set([...(c.milestoneIds || []), NEWST])], activation: { ...(c.activation || {}), milestoneId: NEWST } }; }) };
  }
  const chk = R.checkRoleCards(r, { state: st, actors: s.company.actors, extraNames: [], styleIssues, inputIds: [], first: false, lenient: true });
  chk.cards = chk.cards.map(c => reqs.has(c.title) ? { ...c, milestoneIds: c.milestoneIds.filter(x => x !== NEWST), needsStation: true, stationReq: reqs.get(c.title) } : c);
  if (mode === 'add') chk.cards = chk.cards.filter(c => c.needsStation || c.milestoneIds.length);
  return chk;
}
const modeBlock = title => { const b = blocks(roles).find(x => x.includes('"title": "' + title + '"')); try { return JSON.parse(b); } catch { return null; } };
const withTeam = (s, f) => { s.teammates = f(s.teammates); return s; };
const fa = modeBlock('市場推廣及媒體主任'), fb = modeBlock('配方試做專員'), fc = modeBlock('牌照及保險主任'), fd = modeBlock('線上訂購推廣專員'), fe = modeBlock('固定供應跟進主任');
const mA = fa && shellCheck('add', fa, modeState());
ok('F1 add（路線沒有合適的站）：範例卡帶 station、milestoneIds 空，經外殼還原後通過並產生加站要求', !!mA && mA.ok && mA.cards.length === 1 && mA.cards[0].needsStation && mA.cards[0].milestoneIds.length === 0 && mA.cards[0].stationReq.add.short === '首次媒體報道' && mA.cards[0].stationReq.order.at(-1) === 'new', mA && mA.errors);
ok('F1b add 反例：station 缺一格（沒有 evidence）→ 卡被丟棄', fa && shellCheck('add', { ...fa, cards: [{ ...fa.cards[0], station: { ...fa.cards[0].station, evidence: '' } }] }, modeState()).cards.length === 0);
const mB = fb && shellCheck('add', fb, modeState());
ok('F2 add（路線已有合適的站 m1）：範例通過，負責 m1，不需加站', !!mB && mB.ok && mB.cards.length === 1 && J(mB.cards[0].milestoneIds) === J(['m1']) && !mB.cards[0].needsStation, mB && mB.errors);
ok('F2b add 反例：要求已有崗位的站（m2）→ 卡被丟棄', fb && shellCheck('add', { ...fb, cards: [{ ...fb.cards[0], milestoneIds: ['m2'], activation: { ...fb.cards[0].activation, milestoneId: 'm2' } }] }, modeState()).cards.length === 0);
const mC = fc && shellCheck('recard', fc, withTeam(modeState(), tm => tm.map(x => x.id === 'tm-2' ? { ...x, lifecycle: 'retired' } : x)));
ok('F3 recard：舊卡暫當已取消，範例新卡負責同樣的站 m4 並通過；稱號與舊卡不同', !!mC && mC.ok && mC.cards.length === 1 && J(mC.cards[0].milestoneIds) === J(['m4']) && mC.cards[0].title !== '食品牌照主任', mC && mC.errors);
ok('F3b recard 反例：不暫時取消舊卡就會被「站已有負責崗位」擋下（證明外殼這樣呼叫才通過）', fc && shellCheck('recard', fc, modeState()).cards.length === 0);
const mD = fd && shellCheck('suggest', fd, modeState());
ok('F4 suggest：範例卡負責 request 指出的未有崗位的站 m5 並通過', !!mD && mD.ok && mD.cards.length === 1 && J(mD.cards[0].milestoneIds) === J(['m5']), mD && mD.errors);
ok('F4b suggest 反例：指向已有崗位的站（m4）→ 卡被丟棄', fd && shellCheck('suggest', { ...fd, cards: [{ ...fd.cards[0], milestoneIds: ['m4'], activation: { ...fd.cards[0].activation, milestoneId: 'm4' } }] }, modeState()).cards.length === 0);
const mE = fe && shellCheck('split', fe, withTeam(modeState(), tm => tm.map(x => x.id === 'tm-1' ? { ...x, milestoneIds: ['m2'] } : x)));
ok('F5 split：原卡只留 m2 後，範例新卡 milestoneIds ＝ moveStations（m3）並通過；稱號與原崗位不同', !!mE && mE.ok && mE.cards.length === 1 && J(mE.cards[0].milestoneIds) === J(['m3']) && mE.cards[0].title !== '社區渠道拓展經理', mE && mE.errors);
ok('F5b split 反例：沿用原稱號 → 同名被丟棄', fe && shellCheck('split', { ...fe, cards: [{ ...fe.cards[0], title: '社區渠道拓展經理' }] }, withTeam(modeState(), tm => tm.map(x => x.id === 'tm-1' ? { ...x, milestoneIds: ['m2'] } : x))).cards.length === 0);
ok('F6 四個特別要求範例的文字沒有內部用語；unassigned 皆為空清單', [fa, fb, fc, fd, fe].every(x => x && J(x.unassigned) === '[]' && x.cards.every(c => [c.mission, c.strategy, ...c.how, ...c.knowledge.map(k => k.text), c.activation.title, c.activation.deliverable, ...(c.station ? [c.station.short, c.station.event, c.station.witness, c.station.evidence, c.station.deliveryCondition] : [])].every(v => !styleIssues(v).length))));

const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 1200)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
