// 0.41.0 看板（第 3 線）純函數及資料層測試：創辦人操作預覽覆蓋（六個新 op）、團隊頁／節奏／回饋卡／今日交付的畫面資料、舊資料容錯、字句風格。
// 不開瀏覽器、不起伺服器、不連外網；只用暫存資料夾。用法：node roles-dash-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [PROTO, OUT] = process.argv.slice(2);
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
process.env.SOS_DATA = DATA; process.env.CZ_NO_WELCOME = '1';
const imp = f => import(pathToFileURL(path.join(PROTO, f)).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));

// 第 3 線新字句後備：names.js 還沒有該鍵時才補（主線把同一份加入 names.js 後這裏自然不再補）
const EXTRA_KEYS = {
  tm_title: 'Zero 團隊', tm_intro: '統籌之下是各崗位，只有一層。每個崗位先做一件啟用任務給你驗收，驗收通過才接手負責的站；崗位名稱、負責的站和必須先問你的事，在確認題時由你定下。',
  tm_resp: '負責：{s}', tm_askFirst: '必須先問你：{s}', tm_strategy: '為甚麼這樣做：{s}', tm_knowledge: '知識背景', tm_source: '出處：', tm_srcPage: '已確認的公司概覽', tm_srcInput: '你交給 Zero 的文件', tm_srcWeb: '網上資料',
  tm_supportsNoRole: '支援{n}', tm_pausedWhy: '暫停原因：{r}', tm_pausedWaitDefault: '你的決定', tm_activated: '{d}啟用：啟用任務「{t}」已由你接受。', tm_pause: '暫停這個崗位', tm_resume: '恢復這個崗位', tm_paused: '已暫停這個崗位', tm_resumed: '已恢復這個崗位',
  tm_actDone: '啟用任務已完成：', tm_actAccept: '★ 驗收啟用任務', tm_actDoing: '啟用任務「{t}」{c}；完成後會請你驗收，驗收後才開始工作。', tm_actNone: '尚未有啟用任務；Zero 擬定後會請你驗收。', tm_leadToday: '今日：校對 {n} 次',
  tm_history: '已併入或已取消的崗位（{n}）', tm_mergedInto: '已併入「{t}」', tm_empty: '尚未有崗位：Zero 會按里程碑提出建議，你驗收啟用任務後才開始工作。',
  tm_changeHint: '想加、拆或合併崗位：在首頁「告訴 Zero 一件事」選「想改計劃」，或在「和 Zero 討論」提出；Zero 會擬好給你確認。', tm_syncBtn: '請 Zero 重新擬崗位', tm_syncRequested: '已請 Zero 重新擬崗位，下次開工會先做。', tm_syncAsked: '有 {n} 題崗位待你確認', tm_syncGo: '前往作答', tm_syncFailed: '上一次擬崗位未成功：{r}',
  pace_title: '每日做多少件', pace_fuseOf: '每日上限 {n} 次', pace_sprintTo: '衝刺到', pace_sprintToHelp: '最長兩星期；到期後自動回到標準。', pace_note: '每件工作都經程式核對；會對外的產出先由 Zero 統籌校對。遇到要你決定的題目，只停受它影響的工作，其餘照做。', pace_saved: '已儲存，Zero 下次開工前生效。',
  pace_usageTitle: '今日用量', pace_timeLabel: '今日用時', pace_minutes: '{n} 分鐘', pace_costLabel: '費用', pace_cost: '約 US${n}（只限 Claude Code 回報；Codex 及 Antigravity 用訂閱額度，不回報金額）', pace_fuseLabel: '每日上限', pace_fuseAll: '標準 {a} 次、加速 {b} 次、衝刺 {c} 次，作為防止失控的保險絲；用盡後餘下工作明日繼續',
  zero_pause: '暫停 Zero', zero_resume: '恢復 Zero', zero_pauseHelp: '暫停後，Zero 做完手上這一件就停手，不再開始新的工作。', zero_pausedNote: 'Zero 已暫停，恢復後才會繼續開工。', zero_paused: '已暫停 Zero', zero_resumed: '已恢復 Zero',
  qa_pendingLine: '{t}交付 · 統籌校對中', dv_recentTitle: 'Zero 近期交付', dv_doneN: '今日做了 {n} 件（上限 {m} 件）', dv_stopLabel: '停止原因：{r}', dv_decideTitle: '要你決定', dv_decideN: '{n} 題', dv_decideMore: '還有 {n} 題，在待決事項逐批作答',
  dv_answer: '作答', dv_outputsTitle: '今日產出', dv_outputsN: '{n} 件', dv_standing: '不屬任何一站（恆常）', dv_internal: '內部準備', dv_waitAccept: '等你驗收', dv_tagProofread: '統籌已校對', dv_tagNotes: '要留意', dv_tagChecked: '已核對', dv_tagPending: '校對中',
  dv_notesLong: '統籌校對後仍有 {n} 處要留意', dv_deliveredAt: '{d}交付', dv_forStation: '為「{s}」一站', dv_pausedRoles: '沒有做的：{t}今日已暫停（{w}）；其餘崗位照做。', dv_issueFix: '建議：{f}', dv_empty: 'Zero 還沒有交付過工作。'
};
const missingKeys = Object.keys(EXTRA_KEYS).filter(k => N.ui[k] == null);
for (const k of missingKeys) N.ui[k] = EXTRA_KEYS[k];
ok('names.js：第 3 線新字句（已在 names.js 的不覆寫；缺的由後備補，主線需加入）', true, missingKeys.length + ' 句後備');
console.log('# names.js 尚缺第 3 線字句 ' + missingKeys.length + ' 句（本測試用後備補上）');

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOW = new Date(); const day = n => { const d = new Date(NOW); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = day(0);
const dash = await imp('dash-lib.mjs');
const roles = await imp('roles-ops.mjs');
const pace = await imp('pace-lib.mjs');
const { seedDemo } = await imp('demo-seed.mjs');
const lib = await imp('ask-lib.mjs');
const hits = text => N.styleIssues(String(text)).filter(i => ['colloquial', 'code', 'section', 'date', 'level', 'field', 'jargon'].includes(i.kind)).map(i => i.kind + ':' + i.term);

/* ---------- A. 創辦人操作預覽覆蓋（六個新 op） ---------- */
const base = {
  company: { rhythm: { runCadence: 'daily', runTime: '21:00' }, actors: [] }, health: {}, milestones: [{ id: 'm1', short: '農場簽約' }],
  teammates: [{ id: 'tm-a', title: '農場採購專員', lifecycle: 'enabled', milestoneIds: ['m1'] }, { id: 'tm-b', title: '餐廳拓展經理', lifecycle: 'planned', milestoneIds: ['m1'] }, { id: 'tm-c', title: '牌照及保險主任', lifecycle: 'paused', lifecycleBefore: 'enabled', pausedReason: '等牌照', milestoneIds: ['m1'] }],
  tasks: [{ id: 't1', title: '工作一', teammateId: 'tm-a', status: 'active' }]
};
const op = (o, target, value, id) => ({ id: id || 'op-' + o + '-' + Math.random().toString(36).slice(2, 6), op: o, target, value, at: TODAY + 'T10:00:00+08:00' });
let s = dash.applyFounderOps(base, [op('setPace', 'company', { pace: 'fast' })]);
ok('預覽：setPace 加速 → 節奏即時顯示新檔', s.company.rhythm.pace === 'fast' && base.company.rhythm.pace === undefined, s.company.rhythm);
s = dash.applyFounderOps(base, [op('setPace', 'company', { pace: 'sprint', sprintUntil: day(5) })]);
ok('預覽：setPace 衝刺 → 到期日及開始日', s.company.rhythm.pace === 'sprint' && s.company.rhythm.sprintUntil === day(5) && s.company.rhythm.sprintStartedOn === TODAY, s.company.rhythm);
s = dash.applyFounderOps(base, [op('setPace', 'company', { pace: 'sprint', sprintUntil: day(40) })]);
ok('預覽：衝刺期限超過十四日 → 截到十四日內', s.company.rhythm.sprintUntil === day(14), s.company.rhythm.sprintUntil);
s = dash.applyFounderOps(base, [op('setPace', 'company', { pace: 'turbo' })]);
ok('預覽：setPace 不合法的檔 → 不改', !s.company.rhythm.pace, s.company.rhythm);
s = dash.applyFounderOps(base, [op('pauseZero', 'company', {})]);
ok('預覽：pauseZero → health.pausedByFounder', s.health.pausedByFounder === true && !base.health.pausedByFounder, s.health);
s = dash.applyFounderOps(s, [op('resumeZero', 'company', {})]);
ok('預覽：resumeZero → 解除', !s.health.pausedByFounder, s.health);
s = dash.applyFounderOps(base, [op('rolePause', 'tm-a', { reason: '想先看餐廳那邊' })]);
ok('預覽：rolePause → 卡顯示暫停（含原因），其工作改歸統籌；原帳本不動', s.teammates[0].lifecycle === 'paused' && s.teammates[0].pausedReason === '想先看餐廳那邊' && s.tasks[0].teammateId === '' && base.teammates[0].lifecycle === 'enabled' && base.tasks[0].teammateId === 'tm-a', s.teammates[0]);
s = dash.applyFounderOps(base, [op('rolePause', 'tm-b', {})]);
ok('預覽：待啟用的卡亦可暫停', s.teammates[1].lifecycle === 'paused' && s.teammates[1].lifecycleBefore === 'planned', s.teammates[1]);
s = dash.applyFounderOps(base, [op('roleResume', 'tm-c', {})]);
ok('預覽：roleResume → 卡顯示原狀態（已啟用），原因清除', s.teammates[2].lifecycle === 'enabled' && !s.teammates[2].pausedReason, s.teammates[2]);
s = dash.applyFounderOps(base, [op('roleResume', 'tm-a', {}), op('rolePause', 'tm-none', {})]);
ok('預覽：已啟用卡按恢復、不存在的卡按暫停 → 原樣不動，不當機', s.teammates.map(t => t.lifecycle).join() === 'enabled,planned,paused', s.teammates.map(t => t.lifecycle));
s = dash.applyFounderOps(base, [op('rolesSync', 'roles', {})]);
ok('預覽：rolesSync → 已要求（rolesSync.requested）', s.rolesSync && s.rolesSync.requested === true && !base.rolesSync, s.rolesSync);
s = dash.applyFounderOps(base, [op('pauseZero', 'company', {}), op('setPace', 'company', { pace: 'fast' }), op('rolePause', 'tm-a', {}), op('rolesSync', 'roles', {})]);
ok('預覽：多個 op 依次套用互不覆蓋', s.health.pausedByFounder && s.company.rhythm.pace === 'fast' && s.teammates[0].lifecycle === 'paused' && s.rolesSync.requested, Object.keys(s));
const before = JSON.stringify(base); dash.applyFounderOps(base, [op('setPace', 'company', { pace: 'sprint' }), op('rolePause', 'tm-a', {}), op('pauseZero', 'company', {})]);
ok('預覽：輸入狀態不被改動（無副作用）', JSON.stringify(base) === before);

/* ---------- B. 團隊頁資料 ---------- */
const msTitle = id => ({ m1: '農場簽約', m2: '餐廳試單' }[id] || '');
const actors = [{ id: 'pr-li', name: '李家欣', kind: 'team', role: '共同創辦人・採購', status: 'active', team: { state: 'active' } }, { id: 'pr-wong', name: '黃師傅', kind: 'team', role: '外判・牌照代辦', status: 'active', team: { state: 'paused' } }];
const rich = {
  company: { permissions: roles.PERMISSIONS_DEFAULT, actors }, inputs: [{ id: 'in-1', title: '農場甲會面紀錄' }],
  teammates: [
    { id: 'tm-a', title: '農場採購專員', name: '農場採購專員', mission: '替李家欣準備資料', milestoneIds: ['m1'], supports: ['pr-li'], how: ['一', '二', '三', '四'], strategy: '先談穩供應', lifecycle: 'enabled', avatarKind: 'procurement', activation: { taskId: 'ta', acceptedAt: TODAY + 'T09:00:00+08:00' },
      knowledge: [{ text: '甲', source: 'confirmedPage' }, { text: '乙', source: 'in-1' }, { text: '丙', source: 'https://www.example.org/x' }, { text: '丁', source: 'in-gone' }], bounds: { askFirst: [...roles.PERMISSIONS_DEFAULT.askFirst, '聯絡任何農場'] } },
    { id: 'tm-b', title: '餐廳拓展經理', milestoneIds: ['m2'], supports: ['pr-li', 'pr-wong'], lifecycle: 'planned', activationTaskId: 'tb' },
    { id: 'tm-c', title: '牌照及保險主任', milestoneIds: [], lifecycle: 'paused', pausedReason: '等牌照批出', supports: [] },
    { id: 'tm-d', title: '市場推廣主任', milestoneIds: ['m2'], lifecycle: 'enabled', pausedAuto: true, pausedOn: TODAY, pausedReason: '等候：牌照批出' },
    { id: 'tm-e', title: '舊崗位', lifecycle: 'merged', mergedInto: 'tm-a' }, { id: 'tm-f', title: '另一舊崗位', lifecycle: 'retired', retiredReason: '退回兩次後取消' }
  ],
  tasks: [{ id: 'ta', title: '資料包', status: 'done', acceptedBy: 'founder' }]
};
const viewTasks = [{ id: 'tb', title: '試食會流程', column: 'review', packId: 'ask-x', teammateId: 'tm-b', owner: 'ai' }, { id: 'tw', title: '工作', column: 'doing', teammateId: 'tm-a', owner: 'ai' }];
const tv = dash.teamView(rich, { today: TODAY, msTitle, tasks: viewTasks, working: new Set(['tw']), counts: { total: 5, proofread: 2, qaRewrite: 1 } });
const by = id => tv.roles.find(r => r.id === id);
ok('團隊頁：統籌卡（稱號、說明、頭像、色環）＋校對次數（校對加重寫＝3）', tv.lead.title === N.ui.role_coordinator && tv.lead.avatar === '/assets/crew-role-lead.webp' && tv.lead.color === '#e88d4f' && tv.lead.proofreadToday === 3, tv.lead);
ok('團隊頁：已併入／已取消不進主格，另列歷史（含去向或原因）', tv.roles.length === 4 && tv.history.length === 2 && /農場採購專員/.test(tv.history[0].note) && tv.history[1].note === '退回兩次後取消', tv.history);
ok('團隊頁：頭像及色環按 avatarKind（採購＝靛藍）', by('tm-a').avatar === '/assets/crew-role-procurement.webp' && by('tm-a').color === '#5a5ee6', by('tm-a'));
ok('團隊頁：沒有 avatarKind 時由稱號推算（拓展→outreach、牌照→compliance、推廣→marketing）', by('tm-b').avatarKind === 'outreach' && by('tm-c').avatarKind === 'compliance' && by('tm-d').avatarKind === 'marketing', ['tm-b', 'tm-c', 'tm-d'].map(i => by(i).avatarKind));
ok('團隊頁：生命週期字句來自名稱表（已啟用／待啟用／暫停）', by('tm-a').lifecycleText === '已啟用' && by('tm-b').lifecycleText === '待啟用' && by('tm-c').lifecycleText === '暫停', ['tm-a', 'tm-b', 'tm-c'].map(i => by(i).lifecycleText));
ok('團隊頁：站名、做法最多三條、策略', by('tm-a').stations.join() === '農場簽約' && by('tm-a').how.length === 3 && by('tm-a').strategy === '先談穩供應', by('tm-a'));
ok('團隊頁：支援句用名單內姓名＋職責；暫停中的成員用「暫停期間支援你」', by('tm-b').supports[0] === '支援李家欣（共同創辦人・採購）' && /黃師傅/.test(by('tm-b').supports[1]) && /暫停期間支援你/.test(by('tm-b').supports[1]), by('tm-b').supports);
ok('團隊頁：知識背景附出處（公司概覽／文件標題／網站名＋連結／找不到文件用泛稱）', JSON.stringify(by('tm-a').knowledge.map(k => [k.label, k.href])) === JSON.stringify([['已確認的公司概覽', ''], ['農場甲會面紀錄', ''], ['example.org', 'https://www.example.org/x'], ['你交給 Zero 的文件', '']]), by('tm-a').knowledge);
ok('團隊頁：必須先問你只列卡自己加的條目（不重複公司預設一長串）', by('tm-a').askFirst.join() === '聯絡任何農場', by('tm-a').askFirst);
ok('團隊頁：待啟用卡的啟用任務入口（做好等驗收有 packId；沒有任務＝尚未有）', by('tm-b').activation.packId === 'ask-x' && by('tm-b').activation.title === '試食會流程', by('tm-b').activation);
ok('團隊頁：已啟用卡顯示啟用日期', by('tm-a').activatedAt === TODAY, by('tm-a').activatedAt);
ok('團隊頁：暫停（創辦人）→ 暫停原因、可恢復；啟用／待啟用 → 可暫停', by('tm-c').canResume && !by('tm-c').canPause && /等牌照批出/.test(by('tm-c').pausedNote) && by('tm-a').canPause && by('tm-b').canPause, by('tm-c'));
ok('團隊頁：當日自動暫停 → 顯示暫停＋等候原因；翌日不再算', by('tm-d').pausedAutoToday && by('tm-d').state === 'paused' && /等候：牌照批出/.test(by('tm-d').pausedNote) && !dash.teamView(rich, { today: day(1), msTitle, tasks: [] }).roles.find(r => r.id === 'tm-d').pausedAutoToday, by('tm-d').pausedNote);
ok('團隊頁：活動狀態（工作中／未啟用／暫停＝等待回覆）', by('tm-a').activity === 'working' && by('tm-b').activity === 'not_started' && by('tm-c').activity === 'waiting', ['tm-a', 'tm-b', 'tm-c'].map(i => by(i).activity));
const oldTv = dash.teamView({ teammates: [{ id: 'tm-buy', name: '採購伙伴', lifecycle: 'enabled', milestoneIds: ['m1'], how: ['整理'], bounds: { tellAfter: [], askFirst: ['對外發訊息'] } }, { id: 'tm-rest', name: '餐廳拓展', lifecycle: 'planned', activationTaskId: 't7' }, { id: 'tm-x', name: '怪名字', milestoneIds: [] }] }, { today: TODAY, msTitle, tasks: [] });
ok('舊資料（只有 name、沒有 title／avatarKind／supports／knowledge）照常顯示：稱號用 name、頭像由名稱推算、新欄為空', oldTv.roles[0].title === '採購伙伴' && oldTv.roles[0].avatarKind === 'procurement' && oldTv.roles[1].avatarKind === 'outreach' && oldTv.roles[2].avatarKind === 'operations' && !oldTv.roles[0].supports.length && !oldTv.roles[0].knowledge.length && oldTv.roles[2].lifecycle === 'planned', oldTv.roles.map(r => [r.title, r.avatarKind, r.lifecycle]));
ok('舊資料：待啟用卡有 activationTaskId 但任務不在畫面列 → 顯示「尚未有啟用任務」', oldTv.roles[1].activation.none === true && oldTv.roles[2].activation.none === true, oldTv.roles[1].activation);
ok('團隊頁：空帳本不當機', dash.teamView({}, {}).roles.length === 0 && dash.teamView(null, {}).lead.title === N.ui.role_coordinator);
ok('團隊頁：崗位已有六個以上 → 超過建議數目提示', dash.teamView({ teammates: Array.from({ length: 6 }, (_, i) => ({ id: 'x' + i, title: '甲專員', lifecycle: 'enabled' })) }, {}).overText === N.ui.role_overCap);

/* ---------- C. 節奏及用量 ---------- */
const p0 = dash.paceView({}, { today: TODAY, counts: null, tele: { starts: 2, minutes: 20, usd: null }, unread: 0 });
ok('節奏：沒有 pace 的舊資料＝標準、保險絲 40、三檔都列出', p0.current === 'standard' && p0.usage.fuse === 40 && p0.options.length === 3 && p0.options[0].current && p0.options.map(o => o.fuse).join() === '40,50,80', p0);
ok('節奏：沒有 ai-starts.log（示範）退回今日啟動數；校對 0', p0.usage.used === 2 && p0.usage.proofread === 0 && p0.usage.line === N.t('pace_usage', { a: 2, b: 40, n: 0 }), p0.usage);
ok('節奏：每檔估計按 PACE_ESTIMATE（標準 3 至 6、衝刺 22 至 60）', /3 至 6/.test(p0.options[0].estimate) && /22 至 60/.test(p0.options[2].estimate), p0.options.map(o => o.estimate));
const lines = [0, 1, 2, 3, 4, 5, 6].map(k => `${TODAY}T08:0${k}:00+08:00\t${['work', 'proofread', 'qa-rewrite', 'rewrite', 'roles', 'proofread', 'work'][k]}\tR-1-${k}`);
const sp = { company: { rhythm: { pace: 'sprint', sprintUntil: day(6), sprintStartedOn: day(-1), sprintPause: { reason: 'backlog', since: TODAY } } } };
const p1 = dash.paceView(sp, { today: TODAY, counts: pace.countStarts(lines, TODAY, {}), tele: {}, unread: 11 });
ok('用量：7 次、其中校對 3 次（校對 2＋校對重寫 1；用字改寫不算校對）、衝刺保險絲 80', p1.usage.used === 7 && p1.usage.proofread === 3 && p1.usage.fuse === 80 && p1.usage.line === N.t('pace_usage', { a: 7, b: 80, n: 3 }), p1.usage);
ok('節奏：衝刺顯示期限範圍（明日至十四日後）、積壓暫停說明含未看數', p1.sprint.until === day(6) && p1.sprint.min === day(1) && p1.sprint.max === day(14) && /11/.test(p1.sprint.pause.text) && p1.sprint.pause.text === N.t('pace_sprintPausedBacklog', { n: 11 }), p1.sprint);
const p2 = dash.paceView({ company: { rhythm: { pace: 'standard', sprintUntil: day(-1), sprintEndedOn: TODAY } }, health: { pausedByFounder: true } }, { today: TODAY, counts: null, tele: { usd: 1.05 }, unread: 0 });
ok('節奏：衝刺已結束提示（回到標準）＋暫停 Zero 狀態＋費用', p2.sprint.endedText === N.t('pace_sprintEnded', { d: TODAY }) && !p2.sprint.pause && p2.zero.paused && p2.usage.usd === 1.05, p2);
ok('節奏：兩日沒回覆的暫停說明', dash.paceView({ company: { rhythm: { pace: 'sprint', sprintUntil: day(3), sprintPause: { reason: 'noReply' } } } }, { today: TODAY }).sprint.pause.text === N.ui.pace_sprintPausedNoReply);
ok('節奏：預設衝刺期限不超過十四日', /^\d{4}-\d{2}-\d{2}$/.test(p0.sprint.defaultUntil) && p0.sprint.defaultUntil <= day(14) && p0.sprint.defaultUntil > TODAY, p0.sprint.defaultUntil);

/* ---------- D. 回饋卡字句 ---------- */
const q = (t, qa) => dash.qaLine(t, qa).text;
ok('回饋卡：統籌已校對', q('餐廳拓展經理', { verdict: 'pass', audience: 'external' }) === '餐廳拓展經理交付 · 統籌已校對');
ok('回饋卡：仍有 N 處要留意（N＝issues 數）', q('農場採購專員', { verdict: 'flagged', issues: [{ where: 'a', what: 'b', fix: 'c' }, { where: 'd', what: 'e', fix: 'f' }] }) === '農場採購專員交付 · 統籌校對後仍有 2 處要留意' && q('x專員', { verdict: 'pass_with_notes' }) === 'x專員交付 · 統籌已校對');
ok('回饋卡：通過但有備註（Z29）＝同通過：字句「統籌已校對」、tag proofread、tone ok；校對一句及問題仍帶出', (() => { const r = dash.qaLine('x專員', { verdict: 'pass_with_notes', audience: 'external', line: '日期要再確認', issues: [{ where: 'w', what: 'a', fix: 'b' }] }); return r.tag === 'proofread' && r.tone === 'ok' && r.line === '日期要再確認' && r.issues.length === 1 && !/要留意/.test(r.text); })());
ok('回饋卡：內部產出／沒有 qa（舊資料）／未知 verdict ＝已核對；teammateId 空＝Zero 統籌', q('', undefined) === 'Zero 統籌交付 · 已核對' && q('甲專員', { verdict: 'none', audience: 'internal' }) === '甲專員交付 · 已核對' && q('甲專員', { verdict: '亂寫' }) === '甲專員交付 · 已核對' && q('甲專員', null) === '甲專員交付 · 已核對');
ok('回饋卡：校對中', q('甲專員', { verdict: 'pending' }) === '甲專員交付 · 統籌校對中');
ok('回饋卡：issues 最多五項、缺欄補空字串', dash.qaLine('x', { verdict: 'flagged', issues: Array.from({ length: 8 }, () => ({ where: 'w' })) }).issues.length === 5 && dash.qaLine('x', { verdict: 'flagged', issues: [{ where: 'w' }] }).issues[0].fix === '');

/* ---------- E. 今日交付（R7）及單件回饋卡 ---------- */
const dst = {
  teammates: rich.teammates,
  tasks: [{ id: 'd1', title: '跟進訊息', milestoneId: 'm2', teammateId: 'tm-b', artifactTitle: '乙餐廳訊息草稿', packId: 'ask-d1' }, { id: 'd2', title: '條款', milestoneId: 'm1', teammateId: 'tm-a', artifactTitle: '條款草案' }, { id: 'd3', title: '掃描', cadence: 'standing', artifactTitle: '商機掃描' }, { id: 'd4', title: '卡住的', milestoneId: 'm1', teammateId: 'tm-a' }, { id: 'y1', title: '昨日', milestoneId: 'm1', teammateId: 'tm-a' }],
  runs: [
    { id: 'R-a', startedAt: TODAY + 'T08:00:00+08:00', endedAt: TODAY + 'T09:30:00+08:00', workDay: TODAY, state: 'ended', ending: 'artifact', aiStarted: true, stopReason: 'itemsCap', items: [
      { taskId: 'd1', teammateId: 'tm-b', ending: 'artifact', endedAt: TODAY + 'T08:20:00+08:00', qa: { audience: 'external', verdict: 'pass', line: '核對無誤' } },
      { taskId: 'd2', teammateId: 'tm-a', ending: 'artifact', endedAt: TODAY + 'T08:50:00+08:00', qa: { audience: 'external', verdict: 'flagged', issues: [{ where: '第三段', what: '無來源', fix: '核對' }] } },
      { taskId: 'd3', teammateId: '', ending: 'artifact', endedAt: TODAY + 'T09:00:00+08:00' },
      { taskId: 'd4', teammateId: 'tm-a', ending: 'blocked', endedAt: TODAY + 'T09:10:00+08:00' }] },
    { id: 'R-y', startedAt: day(-1) + 'T21:00:00+08:00', endedAt: day(-1) + 'T21:14:00+08:00', state: 'ended', ending: 'artifact', artifacts: 1, aiStarted: true, taskIds: ['y1'], label: '昨日工作' }]
};
const todoList = [{ id: 'ask-d1', type: 'acceptance', text: '驗收乙餐廳訊息草稿', href: '/#/ask/ask-d1' }, { id: 'ask-z', type: 'decision', text: '別的題', href: '/#/ask/ask-z' }];
const pv = dash.paceView({ ...dst, company: { rhythm: { pace: 'sprint', sprintUntil: day(5) } } }, { today: TODAY, counts: pace.countStarts(lines, TODAY, {}), tele: {}, unread: 1 });
const dv = dash.deliveriesView({ ...dst, company: { rhythm: { pace: 'sprint', sprintUntil: day(5) } } }, { today: TODAY, msTitle, readReceipt: id => id === 'R-y' ? { teammateId: 'tm-a', qa: { audience: 'external', verdict: 'pass', line: '無誤' }, artifacts: [{ title: '昨日資料包' }] } : null, todo: todoList, pace: pv, openTodo: 2 });
ok('今日交付：同日有 items 的 run → 多件日，產出只計交付（卡住的另計）', dv.today.multi && dv.today.items.length === 3 && dv.today.count === 4 && dv.today.notDoneCount === 1, dv.today);
ok('今日交付：等你驗收的排前面（R7 按優先排列）', dv.today.items[0].taskId === 'd1' && dv.today.items[0].packId === 'ask-d1', dv.today.items.map(i => i.taskId));
ok('今日交付：每件有崗位稱號、站名、頭像及色環；恆常工作不屬任何站、算統籌', dv.today.items[0].roleTitle === '餐廳拓展經理' && dv.today.items[0].station === '餐廳試單' && dv.today.items[0].avatar === '/assets/crew-role-outreach.webp' && dv.today.items[2].standing && dv.today.items[2].roleTitle === 'Zero 統籌' && dv.today.items[2].avatar === '/assets/crew-role-lead.webp', dv.today.items);
ok('今日交付：標題用 artifactTitle；校對字句按 qa', dv.today.items[0].title === '乙餐廳訊息草稿' && dv.today.items[0].qa.text === '餐廳拓展經理交付 · 統籌已校對' && dv.today.items[1].qa.text === '農場採購專員交付 · 統籌校對後仍有 1 處要留意', dv.today.items.map(i => i.qa.text));
ok('今日交付：停止原因（今日已滿 N 件，N＝檔的上限）、衝刺期限、用量行', dv.today.stopText === '今日已滿 10 件' && dv.today.sprintUntil === day(5) && dv.today.usageLine === pv.usage.line, [dv.today.stopText, dv.today.usageLine]);
// 上限跟那一次工作的節奏（run.pace），不跟現在的節奏：衝刺做滿 10 件後即使有待套用的「改回標準」，仍是 10 件、今日已滿 10 件
{
  const sprintRun = { id: 'R-sp', startedAt: TODAY + 'T08:00:00+08:00', endedAt: TODAY + 'T12:00:00+08:00', workDay: TODAY, state: 'ended', ending: 'artifact', aiStarted: true, pace: 'sprint', stopReason: 'itemsCap', items: Array.from({ length: 10 }, (_, i) => ({ taskId: 'sp' + i, ending: 'artifact', endedAt: TODAY + 'T09:' + String(10 + i) + ':00+08:00' })) };
  const pendingStd = { company: { rhythm: { pace: 'sprint', sprintUntil: day(5) } }, runs: [sprintRun] };
  const dvSp = dash.deliveriesView({ ...pendingStd, company: { rhythm: { pace: 'standard' } } }, { today: TODAY });
  ok('今日交付：衝刺 run 10 件、現在的檔已是標準 → 上限仍 10、今日已滿 10 件（用 run.pace，不用現在的檔）', dvSp.today.count === 10 && dvSp.today.cap === 10 && dvSp.today.stopText === '今日已滿 10 件', dvSp.today);
  const dvPend = dash.deliveriesView({ company: { rhythm: { pace: 'sprint', sprintUntil: day(5) } }, runs: [sprintRun] }, { today: TODAY, pace: { current: 'standard', unread: 0, usage: { line: '' }, sprint: { until: '' } } });
  ok('今日交付：衝刺 run 10 件、看板預覽已改回標準（尚未套用）→ 上限仍 10、今日已滿 10 件', dvPend.today.count === 10 && dvPend.today.cap === 10 && dvPend.today.stopText === '今日已滿 10 件', dvPend.today);
  const dvOldRun = dash.deliveriesView({ company: { rhythm: { pace: 'standard' } }, runs: [{ ...sprintRun, pace: undefined, items: sprintRun.items.slice(0, 1) }] }, { today: TODAY });
  ok('今日交付：run 沒有 pace（舊紀錄）→ 退回目前檔的上限', dvOldRun.today.cap === pace.itemsCapOf({ company: { rhythm: { pace: 'standard' } } }), dvOldRun.today.cap);
}
ok('今日交付：要你決定只列驗收題，並帶出該件校對句', dv.today.decisions.length === 1 && dv.today.decisions[0].id === 'ask-d1' && /統籌已校對/.test(dv.today.decisions[0].line), dv.today.decisions);
ok('今日交付：自動暫停的崗位（只列當日自動暫停；創辦人暫停的不列）', JSON.stringify(dv.today.pausedRoles) === JSON.stringify([{ id: 'tm-d', title: '市場推廣主任', reason: '牌照批出' }]), dv.today.pausedRoles);
ok('回饋卡：單件日由收據取 teammateId／qa／產出標題；已併入多件日的今日項不重複', dv.recent.length === 1 && dv.recent[0].runId === 'R-y' && dv.recent[0].roleTitle === '農場採購專員' && dv.recent[0].title === '昨日資料包' && dv.recent[0].qa.verdict === 'pass', dv.recent);
const dvOld = dash.deliveriesView({ runs: [{ id: 'R-o', startedAt: TODAY + 'T09:00:00+08:00', state: 'ended', ending: 'artifact', artifacts: 1, aiStarted: true, label: '舊的工作' }] }, { today: TODAY, readReceipt: () => ({ summary: 'x', artifacts: [{ title: '舊產出' }] }) });
ok('回饋卡：舊資料（收據沒有 teammateId／qa）→ Zero 統籌交付 · 已核對；單件日不是多件日', dvOld.recent[0].qa.text === 'Zero 統籌交付 · 已核對' && dvOld.recent[0].title === '舊產出' && !dvOld.today.multi, dvOld);
ok('今日交付：空帳本不當機', dash.deliveriesView({}, {}).recent.length === 0 && dash.deliveriesView(null, {}).today.multi === false);
ok('今日交付：沒有停止原因／不認識的停止原因 → 不顯示字', dash.deliveriesView({ runs: [{ id: 'R-s', workDay: TODAY, startedAt: TODAY + 'T08:00:00+08:00', items: [{ taskId: 'a', ending: 'artifact' }, { taskId: 'b', ending: 'artifact' }], stopReason: 'notARealReason' }] }, { today: TODAY }).today.stopText === '');
ok('今日交付：briefFailed 已有正式字句（外殼新增 stop_briefFailed）→ 顯示', dash.deliveriesView({ runs: [{ id: 'R-s2', workDay: TODAY, startedAt: TODAY + 'T08:00:00+08:00', items: [{ taskId: 'a', ending: 'artifact' }, { taskId: 'b', ending: 'artifact' }], stopReason: 'briefFailed' }] }, { today: TODAY }).today.stopText === N.ui.stop_briefFailed);

/* ---------- F. 資料層整合：dashboardState（示範夾具轉成真實形狀＋新欄＋創辦人操作隊列） ---------- */
seedDemo(DATA, { reset: true, now: NOW });
const DIR = lib.dataDirs(PROTO);
const demoDs = dash.dashboardState(DIR, {});
ok('整合：示範資料（舊形狀）—— 團隊頁資料齊備，稱號用 name，每張卡有頭像，沒有新欄也不報錯', demoDs.team.roles.length === 3 && demoDs.team.roles.every(r => r.title && /^\/assets\/crew-role-[a-z]+\.webp$/.test(r.avatar)) && demoDs.teammates.every(t => t.title && t.name === t.title && t.activity), demoDs.team.roles.map(r => [r.title, r.avatarKind]));
ok('整合：示範資料 —— 節奏預設標準（保險絲 40）、舊的 aiStartsPerDay 欄不再影響；tele.cap 同為 40', demoDs.pace.current === 'standard' && demoDs.pace.usage.fuse === 40 && demoDs.tele.cap === 40, [demoDs.pace.usage, demoDs.tele.cap]);
ok('整合：示範資料 —— 回饋卡舊收據照顯示（統籌、已核對）', demoDs.deliveries.recent.length > 0 && demoDs.deliveries.recent.some(d => d.qa.text === 'Zero 統籌交付 · 已核對') && demoDs.deliveries.recent.every(d => d.qa.text.endsWith('已核對') || d.qa.text.endsWith('已校對') || /要留意/.test(d.qa.text)), demoDs.deliveries.recent.map(d => d.qa.text));
ok('整合：示範資料不套用創辦人操作（rolesSync 狀態 none）', demoDs.rolesSync.state === 'none');
// 轉成真實形狀
const SP = path.join(DATA, 'ledger', 'state.json');
let st = dash.resolveTimes(JSON.parse(fs.readFileSync(SP, 'utf8')), NOW);
delete st.demo; st.ledgerFrom = 'L-test'; st.intake = { ...(st.intake || {}), confirmedAt: TODAY + 'T08:00:00+08:00' };
st.teammates = [{ id: 'tm-a', title: '農場採購專員', lifecycle: 'enabled', milestoneIds: ['m1'] }, { id: 'tm-b', title: '餐廳拓展經理', lifecycle: 'planned', milestoneIds: ['m2'] }];
delete st.rolesSync; delete st.health.pausedByFounder;
const ids = st.teammates.map(t => t.id);
fs.writeFileSync(SP, JSON.stringify(st, null, 2));
fs.writeFileSync(path.join(DATA, 'ledger', 'ai-starts.log'), lines.join('\n') + '\n');
const real0 = dash.dashboardState(DIR, {});
ok('整合：真實形狀 —— 讀 ai-starts.log：用量 7、校對 3', real0.pace.usage.used === 7 && real0.pace.usage.proofread === 3, real0.pace.usage);
ok('整合：真實形狀 —— 稱號優先用 title；任務列帶 teammateId，崗位名由 title／name 來', real0.team.roles[0].title === '農場採購專員' && real0.tasks.filter(t => t.teammateId === ids[0]).every(t => t.teammate === '農場採購專員'), real0.team.roles[0].title);
ok('整合：真實形狀 —— rolesSync 可要求（idle）', real0.rolesSync.state === 'idle', real0.rolesSync);
const LEDGER = path.join(DATA, 'ledger');
fs.writeFileSync(path.join(LEDGER, 'founder-ops.json'), JSON.stringify([
  { id: 'op-1', op: 'setPace', target: 'company', value: { pace: 'sprint', sprintUntil: day(4) }, at: TODAY + 'T10:00:00+08:00' },
  { id: 'op-2', op: 'pauseZero', target: 'company', value: {}, at: TODAY + 'T10:01:00+08:00' },
  { id: 'op-3', op: 'rolePause', target: ids[1], value: { reason: '先不做' }, at: TODAY + 'T10:02:00+08:00' },
  { id: 'op-4', op: 'rolesSync', target: 'roles', value: {}, at: TODAY + 'T10:03:00+08:00' }]));
const real1 = dash.dashboardState(DIR, {});
const r1 = real1.team.roles.find(r => r.id === ids[1]);
ok('整合：founder-ops.json 的新 op 立即顯示——節奏改衝刺、保險絲 80、期限', real1.pace.current === 'sprint' && real1.pace.usage.fuse === 80 && real1.pace.sprint.until === day(4), real1.pace);
ok('整合：暫停 Zero 立即顯示；崗位顯示暫停且可恢復；重新擬崗位顯示已要求', real1.pace.zero.paused && r1.lifecycle === 'paused' && r1.canResume && r1.pausedNote === N.t('tm_pausedWhy', { r: '先不做' }) && real1.rolesSync.state === 'requested', [real1.pace.zero, r1.lifecycle, real1.rolesSync]);
fs.writeFileSync(path.join(LEDGER, 'founder-ops.json'), JSON.stringify([...JSON.parse(fs.readFileSync(path.join(LEDGER, 'founder-ops.json'), 'utf8')),
  { id: 'op-5', op: 'resumeZero', target: 'company', value: {}, at: TODAY + 'T10:04:00+08:00' }, { id: 'op-6', op: 'roleResume', target: ids[1], value: {}, at: TODAY + 'T10:05:00+08:00' }]));
const real2 = dash.dashboardState(DIR, {});
ok('整合：恢復 Zero／恢復崗位 → 回到原狀（崗位回到恢復前的狀態）', !real2.pace.zero.paused && real2.team.roles.find(r => r.id === ids[1]).lifecycle === st.teammates[1].lifecycle, [real2.pace.zero, real2.team.roles.find(r => r.id === ids[1]).lifecycle]);
st = JSON.parse(fs.readFileSync(SP, 'utf8'));
ok('整合：操作只在畫面覆蓋，不改帳本 state.json', st.company.rhythm.pace !== 'sprint' && !st.health.pausedByFounder && st.teammates[1].lifecycle !== 'paused');

/* ---------- G. 字句風格及接線 ---------- */
const allText = [];
const walk = o => { if (typeof o === 'string') allText.push(o); else if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') Object.values(o).forEach(walk); };
const TEXTKEYS = new Set(['text', 'title', 'line', 'lifecycleText', 'pausedNote', 'supports', 'stations', 'how', 'mission', 'strategy', 'estimate', 'fuseText', 'endedText', 'usageLine', 'stopText', 'note', 'desc', 'overText', 'roleTitle', 'station', 'label', 'where', 'what', 'fix', 'activatedTask']);
const walkK = (o, k) => { if (typeof o === 'string') { if (TEXTKEYS.has(k)) allText.push(o); } else if (Array.isArray(o)) o.forEach(x => walkK(x, k)); else if (o && typeof o === 'object') for (const [kk, v] of Object.entries(o)) walkK(v, kk); };
walkK(JSON.parse(JSON.stringify({ team: real1.team, pace: real1.pace, deliveries: dv })), '');
walkK(JSON.parse(JSON.stringify({ team: tv, pace: p1, d: dash.qaLine('農場採購專員', { verdict: 'flagged', issues: [{ where: '第三段', what: '無來源', fix: '核對' }] }) })), '');
const bad = allText.flatMap(t => hits(t).map(h => h + '｜' + t.slice(0, 30)));
ok('字句：看板資料內所有產品字句沒有內部術語、編號、短日期', !bad.length, bad.slice(0, 5));
ok('字句：看板資料沒有漏出原始鍵名（缺字句會顯示鍵名本身）', !allText.some(t => /\b(tm|pace|dv|zero|qa|role|stop)_[a-zA-Z]+\b/.test(t)), allText.filter(t => /\b(tm|pace|dv|zero|qa|role|stop)_[a-zA-Z]+\b/.test(t)).slice(0, 3));
const ownText = Object.keys(EXTRA_KEYS).map(k => EXTRA_KEYS[k]);
const badOwn = ownText.flatMap(t => hits(t).map(h => h + '｜' + t.slice(0, 30)));
ok('字句：第 3 線新增字句全部過 styleIssues', !badOwn.length, badOwn);
// 頁面與資料層引用的名稱鍵都存在（names.js 或後備）
const src = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8') + fs.readFileSync(path.join(PROTO, 'dash-lib.mjs'), 'utf8');
const used = [...new Set([...src.matchAll(/(?:N\.t|NAMES\.t|N_)\('((?:tm|pace|dv|zero|qa|role|stop)_[a-zA-Z_]+)'/g), ...src.matchAll(/\bU\.((?:tm|pace|dv|zero|qa|role|stop)_[a-zA-Z_]+)/g), ...src.matchAll(/NAMES\.ui\.((?:tm|pace|dv|zero|qa|role|stop)_[a-zA-Z_]+)/g)].map(m => m[1]))];
const gone = used.filter(k => !k.endsWith('_') && N.ui[k] == null);
ok('接線：dashboard.html／dash-lib.mjs 用到的新字句鍵（' + used.length + ' 個）名稱表內都有', used.length > 30 && !gone.length, gone);
const dynKeys = ['role_lifecycle_planned', 'role_lifecycle_enabled', 'role_lifecycle_paused', 'role_lifecycle_merged', 'role_lifecycle_retired', 'pace_standard', 'pace_fast', 'pace_sprint', ...['itemsCap', 'nothingToDo', 'waitingFounder', 'fuse', 'timeout', 'toolFailed', 'rolesPaused', 'backlog', 'noReply', 'expired', 'paceChanged', 'paused'].map(k => 'stop_' + k)];
ok('接線：動態組出來的鍵（生命週期、三檔、停止原因）名稱表內都有', dynKeys.every(k => N.ui[k] != null), dynKeys.filter(k => N.ui[k] == null));
ok('接線：dashboard.html 內聯腳本可解析', (() => { try { const m = [...fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)]; m.forEach(x => new Function(x[1])); return m.length > 0; } catch (e) { return false; } })());
ok('接線：頁面不再用舊的 aiStartsPerDay 作每日上限', !/aiStartsPerDay/.test(fs.readFileSync(path.join(PROTO, 'dash-lib.mjs'), 'utf8').replace(/\/\/.*$/gm, '')));
ok('接線：六個新 op 都有預覽覆蓋', ['setPace', 'pauseZero', 'resumeZero', 'rolePause', 'roleResume', 'rolesSync'].every(o => { const a = o === 'rolePause' ? 'tm-a' : o === 'roleResume' ? 'tm-c' : o === 'rolesSync' ? 'roles' : 'company'; return JSON.stringify(dash.applyFounderOps(base, [op(o, a, o === 'setPace' ? { pace: 'fast' } : {})])) !== JSON.stringify(base); }));

const failed = results.filter(r => !r.pass);
for (const r of results) console.log((r.pass ? '通過' : '失敗') + '：' + r.name + (r.pass ? '' : ' —— ' + JSON.stringify(r.info)));
console.log(`\n${results.length - failed.length}/${results.length} 通過`);
process.exit(failed.length ? 1 : 0);
