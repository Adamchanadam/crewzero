// 0.44.0 共用人物名稱比對純函數測試：不載入 run.mjs、不開子程序。
// 用法：node people-match-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROTO, OUT] = process.argv.slice(2);
if (!PROTO || !OUT) throw new Error('用法：node people-match-test.mjs <原型資料夾> <輸出資料夾>');
const people = await import(pathToFileURL(path.join(path.resolve(PROTO), 'people-ops.mjs')).href);
const context = await import(pathToFileURL(path.join(path.resolve(PROTO), 'context-lib.mjs')).href);
const results = [];
const ok = (name, pass, info = null) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : ' ' + JSON.stringify(info))); };
const actor = (id, name, more = {}) => ({ id, name, kind: 'partner', aliases: [], ...more });
const meetingText = lines => ['# 會議紀錄', '', '## 參加者', '', '創辦人、對方。', '', '## 對方的說法及承諾', '', ...lines, '', '## 雙方決定', '', '- 雙方確認。'].join('\n');
const contextFor = actors => ({
  actors, milestones: [], events: [], tasks: [],
  current: { inputId: 'in-now', meetingId: 'm-now', date: '2026-11-12', speakers: { 對方: { kind: 'other', name: '何志明校長' } }, speakerCounts: { 對方: 1 }, text: meetingText(['- 今次會面。']), founderText: '' },
  meetings: [{ id: 'm-old', inputId: 'in-old', date: '2026-11-11', speakers: { 對方: { kind: 'other', name: '何志明' } }, text: meetingText(['- 以往核對內容。']) }],
  inputs: [{ id: 'in-old', eventDate: '2026-11-11', title: '會議' }]
});

try {
  const feng = actor('a-feng', '何志明');
  ok('何志明與何志明校長唯一互相包含，回傳 contains', JSON.stringify(people.matchActorName([feng], '何志明校長')) === JSON.stringify({ id: 'a-feng', how: 'contains' }));

  const chen = [actor('a-chen', '陳大文'), actor('a-wife', '陳大文太太')];
  ok('陳大文太同時對上兩個對象，不猜測', people.matchActorName(chen, '陳大文太') === null);

  ok('只有一字的陳不作包含比對', people.matchActorName([actor('a-chen', '陳大文')], '陳') === null);

  ok('正式名稱完全相同，回傳 exact', JSON.stringify(people.matchActorName([feng], '何志明')) === JSON.stringify({ id: 'a-feng', how: 'exact' }));
  ok('別名完全相同，回傳 exact', JSON.stringify(people.matchActorName([actor('a-alias', '何主任', { aliases: ['何志明'] })], '何志明')) === JSON.stringify({ id: 'a-alias', how: 'exact' }));

  ok('已合併對象不是比對目標', people.matchActorName([actor('a-old', '何志明', { mergedInto: 'a-new' })], '何志明') === null);

  const team = actor('a-team', '何志明', { kind: 'team' });
  const filtered = people.matchActorName([team], '何志明校長', { filter: row => row.kind !== 'team' });
  const teamContext = context.buildMeetingContext(contextFor([team]));
  ok('context-lib 傳入的篩選會排除團隊成員', filtered === null && !teamContext.text.includes('以往核對內容。'), teamContext.text);

  // 「機構＋人名」：同時包含機構及其人員時，取所屬機構亦寫在名稱內的那個人；兩人同屬該機構則不猜（真實事件 N4）
  const org = actor('a-org', '乙餐廳'), huang = actor('a-huang', '黃小姐', { org: '乙餐廳' }), li = actor('a-li', '李小姐', { org: '乙餐廳' });
  ok('機構＋人名：「乙餐廳黃小姐」取黃小姐', JSON.stringify(people.matchActorName([org, huang], '乙餐廳黃小姐')) === JSON.stringify({ id: 'a-huang', how: 'contains' }), people.matchActorName([org, huang], '乙餐廳黃小姐'));
  ok('機構＋人名：只寫「乙餐廳」照舊完全相同對上機構', JSON.stringify(people.matchActorName([org, huang, li], '乙餐廳')) === JSON.stringify({ id: 'a-org', how: 'exact' }));
  ok('機構＋人名：名稱只含機構，而同機構有兩人，不猜', people.matchActorName([huang, li], '乙餐廳小姐') === null);

  const listed = people.matchActorName([feng], '何志明校長');
  const matchedContext = context.buildMeetingContext(contextFor([feng]));
  ok('context-lib 與名單對同一組名稱的比對結果一致', listed && listed.id === 'a-feng' && matchedContext.text.includes('以往核對內容。'), { listed, text: matchedContext.text });
} catch (error) {
  ok('測試程式本身沒有拋錯', false, String(error && error.stack || error));
}

fs.mkdirSync(path.resolve(OUT), { recursive: true });
fs.writeFileSync(path.join(path.resolve(OUT), 'people-match-results.json'), JSON.stringify({ results }, null, 2) + '\n', 'utf8');
const pass = results.filter(row => row.pass).length;
console.log(`${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
