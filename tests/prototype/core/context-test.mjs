// 0.42.1 會議紀錄資料脈絡純函數測試：不載入 run.mjs、不讀寫資料夾。
import { buildMeetingContext, contextQuoteSources } from '../../../prototypes/proofread/context-lib.mjs';

const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' ' + JSON.stringify(info))); };
const actor = (id, name, more = {}) => ({ id, name, kind: 'partner', aliases: [], ...more });
const minutes = (id, inputId, date, speaker, body, more = {}) => ({ id, inputId, date, text: body, speakers: { '對方': speaker }, ...more });
const meetingText = lines => ['# 會議紀錄', '', '## 參加者', '', '創辦人、陳經理。', '', '## 對方的說法及承諾', '', ...lines, '', '## 雙方決定', '', '- 雙方確認安排。', '', '## 待辦', '', '- 陳經理：提供報價。', '', '## 未定事項', '', '- 日期待定。'].join('\n');

try {
  const a1 = actor('a1', '陳經理', { org: '工房甲' }), a2 = actor('a2', '周經理', { org: '乙餐廳' });
  const old = minutes('m-old', 'in-old', '2026-11-03', { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- 陳經理承諾保留條款。', '- ⚠️ 陳經理說這句未核對。', '- 電郵：contact@example.com']), { effects: [{ change: '已加入日程：保留條款' }] });
  const unrelated = minutes('m-other', 'in-other', '2026-11-04', { kind: 'actor', actorId: 'a2', name: '周經理' }, meetingText(['- 周經理的無關紀錄。']));
  const base = {
    actors: [a1, a2], milestones: [{ id: 'm1', short: '試供' }],
    current: { inputId: 'in-now', meetingId: 'm-now', speakers: { '陳': { kind: 'actor', actorId: 'a1', name: '陳經理' } }, speakerCounts: { 陳: 4 }, text: meetingText(['- 今次報價日期改為 11 月 25 日。']), founderText: '陳經理在會上確認。' },
    meetings: [old, unrelated],
    inputs: [{ id: 'in-old', eventDate: '2026-11-03', title: '會議：工房甲' }, { id: 'in-other', eventDate: '2026-11-04', title: '會議：乙餐廳' }],
    events: [{ id: 'in-event', eventDate: '2026-11-05', title: '事件：陳經理', founderText: '創辦人原話：陳經理要求寄樣本。', summary: 'Zero 摘要不應出現。' }],
    tasks: [
      { id: 'fu-kept', title: '工房甲保留條款', dueAt: '2026-11-18', fromInput: 'in-old', minutesSource: { id: 'm-old' }, status: 'open', owner: 'founder', milestoneId: 'm1' },
      { id: 'ai-drop', title: 'Zero 自己建議的工作', dueAt: '2026-11-19', status: 'open', owner: 'ai', prospectId: 'a1' },
      { id: 'batch-drop', title: '首批工作', dueAt: '2026-11-20', status: 'open', owner: 'founder', firstBatch: true, prospectId: 'a1' }
    ]
  };
  const c1 = buildMeetingContext(base);
  ok('TC1 可靠程度及參加者篩選：只留已確認日程、相關會議及創辦人原話，並剔除標示與聯絡資料', c1.text.includes('工房甲保留條款') && c1.text.includes('陳經理承諾保留條款。') && c1.text.includes('創辦人原話：陳經理要求寄樣本。') && !c1.text.includes('Zero 自己建議的工作') && !c1.text.includes('首批工作') && !c1.text.includes('周經理的無關紀錄') && !c1.text.includes('未核對') && !c1.text.includes('contact@example.com') && !c1.text.includes('Zero 摘要'), c1.text);
  ok('TC2 每一項資料行都有出處，並交出行文字到出處的對照', c1.lineSources.length > 0 && c1.lineSources.every(row => c1.text.includes(row.text) && row.source) && Object.keys(c1.sourceByLine).length === c1.lineSources.length, c1.lineSources);

  const longTasks = Array.from({ length: 10 }, (_, i) => ({ id: 'fu-long-' + i, title: '陳經理日程' + i + '：' + '日程內容'.repeat(85), dueAt: `2026-12-${String(i + 1).padStart(2, '0')}`, status: 'open', owner: 'founder', prospectId: 'a1' }));
  const longMeeting = n => minutes('m-long-' + n, 'in-long-' + n, `2026-11-0${n + 1}`, { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- ' + ('以往會議內容' + n).repeat(180)]));
  const longEvents = Array.from({ length: 3 }, (_, i) => ({ id: 'in-event-' + i, eventDate: `2026-10-0${i + 1}`, title: '事件：陳經理', founderText: `最舊事件${i}：` + '原話'.repeat(160) }));
  const c4 = buildMeetingContext({ ...base, tasks: longTasks, meetings: [longMeeting(1), longMeeting(2), longMeeting(3)], events: longEvents });
  ok('TC3 上限及次序：不超過六千字，日程優先保留，最後類別由較舊資料開始刪除', c4.text.length <= 6000 && c4.text.includes('陳經理日程0') && !c4.text.includes('最舊事件0'), { length: c4.text.length });

  const merged = actor('a-old', '陳舊稱', { mergedInto: 'a1' });
  const sameA = actor('same-a', '李小姐', { org: '甲公司' }), sameB = actor('same-b', '李小姐', { org: '乙公司' });
  const mergedMeeting = minutes('m-merged', 'in-merged', '2026-11-01', { kind: 'actor', actorId: 'a-old', name: '陳舊稱' }, meetingText(['- 被合併對象的紀錄。']));
  const sameOrgMeeting = minutes('m-same-org', 'in-same-org', '2026-11-02', { name: '李小姐', org: '乙公司' }, meetingText(['- 同名不同機構的紀錄。']));
  const c17 = buildMeetingContext({ ...base, actors: [a1, merged, sameA, sameB], current: { ...base.current, speakers: { '陳': { kind: 'actor', actorId: 'a1', name: '陳經理' } } }, meetings: [mergedMeeting, sameOrgMeeting] });
  const demo = buildMeetingContext({ ...base, demo: true });
  ok('TC4 合併對象算到最終對象、同名不同機構不混淆、示範實例回傳空', c17.text.includes('被合併對象的紀錄。') && !c17.text.includes('同名不同機構的紀錄。') && demo.text === '', { selected: c17.text, demo });

  const emptySpeakerMeeting = minutes('m-tc17', 'in-tc17', '2026-11-06', { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- 空講者資料仍要按參加者選入。']), { speakers: {} });
  const c18 = buildMeetingContext({ ...base, meetings: [emptySpeakerMeeting], inputs: [{ id: 'in-tc17', eventDate: '2026-11-06', minutes: { id: 'm-tc17' } }], events: [], tasks: [{ id: 'fu-tc17', title: '補交資料', dueAt: '2026-11-18', status: 'open', owner: 'founder', minutesSource: { id: 'm-tc17' } }] });
  ok('TC17 空講者資料時按正文參加者選入以往會議及其未完成日程', c18.text.includes('空講者資料仍要按參加者選入。') && c18.text.includes('補交資料'), c18.text);

  const c19 = buildMeetingContext({ ...base, meetings: [], events: [], tasks: [] });
  ok('TC18 找到今次參加者但沒有相關資料時不交出脈絡文字', c19.text === '', c19);

  const taskQuotes = contextQuoteSources('- 日程引句 [日程 fu-tc19；11 月 3 日會議紀錄]\n- 無來源日程引句 [日程 fu-tc19-empty]\n- 會議引句 [11 月 3 日會議紀錄]', '引句');
  ok('TC19 日程引句出處移除日程編號，沒有來源時只顯示日程，會議引句維持原有出處', taskQuotes.length === 3 && taskQuotes[0].source === '日程（11 月 3 日會議紀錄）' && !taskQuotes[0].source.includes('fu-tc19') && taskQuotes[1].source === '日程' && taskQuotes[2].source === '11 月 3 日會議紀錄', taskQuotes);

  const c20 = buildMeetingContext({ ...base, meetings: [old], inputs: [{ id: 'in-tc20-linked', eventDate: '2026-11-09', minutes: { id: 'm-old' } }], events: [], tasks: [
    { id: 'fu-tc20-linked', title: '同會議輸入後備', dueAt: '2026-11-18', status: 'open', owner: 'founder', minutesSource: { id: 'm-old' } },
    { id: 'fu-tc20-missing', title: '找不到輸入後備', dueAt: '2026-11-19', status: 'open', owner: 'founder', prospectId: 'a1', minutesSource: { id: 'm-tc20-missing' } }
  ] });
  const c20Visible = c20.text.replace(/\s+\[[^\]]+\]/g, '');
  ok('TC20 日程來源後備以同會議輸入日期或以往會議紀錄顯示，兩者均不含編號', c20Visible.includes('來源：11 月 9 日會議紀錄') && c20Visible.includes('來源：以往會議紀錄') && !/(?:fu|in|m)-/.test(c20Visible), c20Visible);

  const c21 = buildMeetingContext({ ...base, current: { ...base.current, speakers: {}, text: ['# 會議紀錄', '', '## 參加者', '', '- 訪客', '', '## 對方的說法及承諾', '', '- 陳經理沒有出席，下次再邀請。'].join('\n'), founderText: '創辦人提到陳經理。' }, meetings: [old], events: [], tasks: [] });
  ok('TC21 今次參加者只有訪客時，正文或創辦人原話提及陳經理也不可選入', c21.text === '', c21.text);

  const sameCurrentA = actor('a-tc22-a', '陳經理', { org: '甲公司' }), sameCurrentB = actor('a-tc22-b', '陳經理', { org: '乙公司' });
  const c22 = buildMeetingContext({ ...base, actors: [sameCurrentA, sameCurrentB], current: { ...base.current, speakers: {}, text: ['# 會議紀錄', '', '## 參加者', '', '- 陳經理'].join('\n') }, meetings: [], events: [], tasks: [] });
  ok('TC22 今次參加者同名而沒有機構資料時，兩個機構的對象都不可選入', c22.text === '', c22.text);

  const otherChen = actor('a-tc23', '陳經理', { org: '乙公司' });
  const c23 = buildMeetingContext({ ...base, actors: [a1, otherChen], meetings: [], events: [], tasks: [{ id: 'fu-tc23', title: '乙公司陳經理跟進', dueAt: '2026-11-18', status: 'open', owner: 'founder', prospectId: 'a-tc23' }] });
  ok('TC23 日程 prospectId 屬另一機構時，不可因標題含今次參加者名字而選入', c23.text === '', c23.text);

  const versionOne = minutes('m-tc24', 'in-tc24-v1', '2026-11-01', { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- 第一版有陳經理。']), { version: 1 });
  const versionTwo = minutes('m-tc24', 'in-tc24-v2', '2026-11-02', { kind: 'actor', actorId: 'a2', name: '周經理' }, meetingText(['- 第二版已移除陳經理。']), { version: 2 });
  const c24 = buildMeetingContext({ ...base, meetings: [versionOne, versionTwo], events: [], tasks: [] });
  ok('TC24 同一會議最新版移除參加者後，舊版不可重新入選', c24.text === '', c24.text);

  const dotContactMeeting = minutes('m-tc25', 'in-tc25', '2026-11-06', { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- 聯絡 1234.5678。', '- 可保留的承諾。']));
  const c25 = buildMeetingContext({ ...base, meetings: [dotContactMeeting], events: [], tasks: [] });
  ok('TC25 會議行含以點分隔的電話時不可進入脈絡', !c25.text.includes('1234.5678') && c25.text.includes('可保留的承諾。'), c25.text);

  const wideContactMeeting = minutes('m-tc26', 'in-tc26', '2026-11-06', { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- 聯絡 １２３４５６７８。', '- 可保留的承諾。']));
  const c26 = buildMeetingContext({ ...base, meetings: [wideContactMeeting], events: [], tasks: [] });
  ok('TC26 會議行含全形數字電話時不可進入脈絡', !c26.text.includes('１２３４５６７８') && c26.text.includes('可保留的承諾。'), c26.text);

  const c27 = buildMeetingContext({ ...base, meetings: [], events: [], inputs: [{ id: 'in-tc27', eventDate: '2026-11-03', title: '2026-11-03 回覆 m-123，電郵 fake@example.invalid' }], tasks: [{ id: 'fu-tc27', title: '日程來源清理', dueAt: '2026-11-18', status: 'open', owner: 'founder', prospectId: 'a1', fromInput: 'in-tc27' }] });
  const c27Task = c27.lineSources.find(row => row.text.includes('日程來源清理'));
  const c27Quotes = contextQuoteSources(c27.text, '日程來源清理');
  const c27Sources = c27.lineSources.map(row => row.source).join('\n');
  ok('TC27 原輸入標題含日期、編號及電郵時，所有顯示出處及日程來源均只保留受控日期類別', !!c27Task && c27Task.text.includes('來源：11 月 3 日記下的事') && c27Quotes.length === 1 && c27Quotes[0].source === '日程（11 月 3 日記下的事）' && !/(?:2026-11-03|m-123|fake@example\.invalid)/.test(c27Sources), { task: c27Task, quotes: c27Quotes, sources: c27Sources });

  const betaMeeting = minutes('m-tc28-beta', 'in-tc28-beta', '2026-11-07', { kind: 'actor', actorId: 'a1', name: '陳經理' }, meetingText(['- 乙會議內容。']));
  const c28 = buildMeetingContext({ ...base, meetings: [betaMeeting], events: [], inputs: [{ id: 'in-tc28-alpha', eventDate: '2026-11-05', title: '甲會議' }, { id: 'in-tc28-beta', eventDate: '2026-11-07', minutes: { id: 'm-tc28-beta' } }], tasks: [{ id: 'fu-tc28', title: '跨會議出處', dueAt: '2026-11-18', status: 'open', owner: 'founder', fromInput: 'in-tc28-alpha', minutesSource: { id: 'm-tc28-beta' } }] });
  const c28Quotes = contextQuoteSources(c28.text, '跨會議出處');
  ok('TC28 同時有 fromInput 與 minutesSource 時，日程出處必須使用 minutesSource 指向的會議日期', c28Quotes.length === 1 && c28Quotes[0].source === '日程（11 月 7 日會議紀錄）', c28Quotes);

  const c29 = buildMeetingContext({ ...base, meetings: [old], inputs: [{ id: 'in-old', eventDate: '2026-11-03', minutes: { id: 'm-old' } }, { id: 'in-tc29-note', eventDate: '2026-11-04', title: '普通記事' }], events: [{ id: 'in-tc29-event', eventDate: '2026-11-05', title: '事件：陳經理', founderText: '創辦人原話：陳經理確認安排。' }], tasks: [
    { id: 'fu-tc29-meeting', title: '會議來源日程', dueAt: '2026-11-18', status: 'open', owner: 'founder', minutesSource: { id: 'm-old' } },
    { id: 'fu-tc29-note', title: '記事來源日程', dueAt: '2026-11-19', status: 'open', owner: 'founder', prospectId: 'a1', fromInput: 'in-tc29-note' },
    { id: 'fu-tc29-existing', title: '既有日程來源', dueAt: '2026-11-20', status: 'open', owner: 'founder', prospectId: 'a1' }
  ] });
  const c29Sources = c29.lineSources.map(row => row.source.replace(/^日程\s+[^；\]]+；/, ''));
  const c29SourcePattern = /^(?:\d{1,2} 月 \d{1,2} 日(?:會議紀錄|已確認結果|其他事件|記下的事)|(?:以往會議紀錄|既有日程)|日期不詳(?:會議紀錄|已確認結果|其他事件|記下的事)?)$/;
  ok('TC29 多類資料同時存在時，全部對外出處只由月日及受控類別組成', c29Sources.length > 0 && c29Sources.every(source => c29SourcePattern.test(source) && !/(?:\d{4}-\d{2}-\d{2}|(?:fu|in|m|ai)-|@|(?:\+?\d[\s.-]?){8,})/i.test(source)) && ['11 月 3 日會議紀錄', '11 月 3 日已確認結果', '11 月 4 日記下的事', '11 月 5 日其他事件', '既有日程'].every(source => c29Sources.includes(source)), c29Sources);

  // 0.44.0：紀錄常寫「機構＋人名」。名稱互相包含而只對上名單上唯一一個對象，才算對上；對上兩個或以上當作對不上（協調會話 2026-11-12）
  const g1 = actor('g1', '工房丙'), g2 = actor('g2', '工房丁'), g3 = actor('g3', '陳經理', { aliases: ['陳生'] });
  const gOld = minutes('m-g-old', 'in-g-old', '2026-11-03', { kind: 'actor', actorId: 'g1', name: '工房丙' }, meetingText(['- 工房丙承諾十一月底交貨。']));
  const gBase = name => ({ actors: [g1, g2, g3], milestones: [], meetings: [gOld], inputs: [{ id: 'in-g-old', eventDate: '2026-11-03', title: '會議：工房丙' }], events: [], tasks: [],
    current: { inputId: 'in-g-now', meetingId: 'm-g-now', date: '2026-11-10', speakers: { '對方': { kind: 'other', name } }, speakerCounts: { 對方: 3 }, text: meetingText(['- 今次再談交貨。']), founderText: '' } });
  ok('TC30 紀錄寫「工房丙何師傅」：包含名單上的「工房丙」，唯一對上，帶入以往會議', buildMeetingContext(gBase('工房丙何師傅')).text.includes('工房丙承諾十一月底交貨'), buildMeetingContext(gBase('工房丙何師傅')).text);
  ok('TC31 紀錄只寫「工房」：同時對上「工房丙」「工房丁」，當作對不上，不帶入', !buildMeetingContext(gBase('工房')).text.includes('工房丙承諾十一月底交貨'), buildMeetingContext(gBase('工房')).text);
  ok('TC32 名稱完全相同照舊對上', buildMeetingContext(gBase('工房丙')).text.includes('工房丙承諾十一月底交貨'), buildMeetingContext(gBase('工房丙')).text);
  const gOld2 = minutes('m-g-old2', 'in-g-old2', '2026-11-03', { kind: 'other', name: '工房丙（何師傅）' }, meetingText(['- 何師傅說豆會先試烘。']));
  const gBase2 = { ...gBase('工房丙'), meetings: [gOld2], inputs: [{ id: 'in-g-old2', eventDate: '2026-11-03', title: '會議：工房丙' }] };
  gBase2.current.speakers = { '對方': { kind: 'actor', actorId: 'g1', name: '工房丙' } };
  ok('TC33 舊紀錄寫「工房丙何師傅」一類而今次有名單編號：同樣對上', buildMeetingContext({ ...gBase2, meetings: [{ ...gOld2, speakers: { '對方': { kind: 'other', name: '工房丙何師傅' } } }] }).text.includes('何師傅說豆會先試烘'), buildMeetingContext({ ...gBase2, meetings: [{ ...gOld2, speakers: { '對方': { kind: 'other', name: '工房丙何師傅' } } }] }).text);
  ok('TC34 別名一併比對：紀錄寫「乙公司陳生」，經別名「陳生」只對上陳經理', (() => {
    const cOld = minutes('m-c-old', 'in-c-old', '2026-11-03', { kind: 'actor', actorId: 'g3', name: '陳經理' }, meetingText(['- 陳經理答應寄樣本。']));
    const data = { ...gBase('乙公司陳生'), meetings: [cOld], inputs: [{ id: 'in-c-old', eventDate: '2026-11-03', title: '會議：陳經理' }] };
    return buildMeetingContext(data).text.includes('陳經理答應寄樣本');
  })());
  ok('TC35 一個字的名稱不作包含比對（免得「丙」對上任何含「丙」的名稱）', (() => {
    const one = actor('g9', '丙'); const data = gBase('工房丙何師傅'); data.actors = [one]; data.meetings = [minutes('m-one', 'in-one', '2026-11-03', { kind: 'actor', actorId: 'g9', name: '丙' }, meetingText(['- 一字名稱的紀錄。']))]; data.inputs = [{ id: 'in-one', eventDate: '2026-11-03', title: '會議' }];
    return !buildMeetingContext(data).text.includes('一字名稱的紀錄');
  })());
} catch (error) {
  ok('TC 程式本身沒有拋錯', false, String(error && error.stack || error));
}

const pass = results.filter(row => row.pass).length;
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
