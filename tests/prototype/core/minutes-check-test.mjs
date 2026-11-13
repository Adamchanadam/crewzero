// 會議紀錄純函數測試：不啟動伺服器、不呼叫 AI，暫存結果只寫入指定輸出資料夾。
// 用法：node minutes-check-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROTO, OUT] = process.argv.slice(2);
if (!PROTO || !OUT) throw new Error('需要原型資料夾及輸出資料夾');
fs.mkdirSync(OUT, { recursive: true });
const M = await import(pathToFileURL(path.join(PROTO, 'minutes-check.mjs')).href);
const results = [];
const ok = (name, pass, info = null) => results.push({ name, pass: !!pass, info: pass ? undefined : info });
const transcript = '陳經理說：「首批大概二百件。」最遲 11月18日提供資料。';
const v2 = [
  '# 會議紀錄：測試（2026 年 11 月 10 日）',
  '',
  '> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 0 處）',
  '',
  '## 會議資料', '', '- 日期及時間：2026 年 11 月 10 日', '- 形式：視像', '- 紀錄來源：逐字稿', '',
  '## 參加者', '', '- 我', '- 陳經理', '',
  '## 議題及討論要點', '', '### 1. 首批安排', '', '- 陳經理提出會提供資料。', '',
  '## 已發生的事實', '', '- 雙方已完成會議。', '',
  '## 對方的說法及承諾', '', '- 陳經理口頭表示「首批大概二百件。」；上述只屬口頭表示。', '',
  '## 雙方決定', '', '- 決定 1：先核對首批數量。', '',
  '## 待辦', '', '- 待辦 1｜負責人：陳經理｜期限：2026 年 11 月 18 日｜事項：提供資料。', '',
  '## 未定事項', '', '- 未定 1：首批數量；尚欠對方確認。', '',
  '## 下次會議', '', '- 沒有', '',
  '## 改動清單', '', '- 沒有', ''
].join('\n');
const checked = (text, opts = {}) => M.checkMinutes(text, { transcript, speakers: 2, ...opts });
const repaired = (text, opts = {}) => M.fixMinutes(text, { transcript, speakers: 2, ...opts });

ok('v2：十節、列點、引句、待辦、日期及編號均合格', checked(v2).ok && checked(v2).format === 'v2', checked(v2));
const noNext = v2.replace('## 下次會議\n\n- 沒有\n\n', '');
ok('v2：缺少下次會議不合格', !checked(noNext).ok && checked(noNext).errors.some(error => error.includes('下次會議')), checked(noNext));
const wrongOrder = v2.replace('## 會議資料', '## 暫存段落').replace('## 參加者', '## 會議資料').replace('## 暫存段落', '## 參加者');
ok('v2：十節次序錯誤不合格', !checked(wrongOrder).ok && checked(wrongOrder).errors.some(error => error.includes('固定次序')), checked(wrongOrder));
const blankNext = v2.replace('## 下次會議\n\n- 沒有', '## 下次會議\n');
ok('v2：空白段落不合格，補「沒有」後合格', !checked(blankNext).ok && checked(repaired(blankNext)).ok && repaired(blankNext).includes('## 下次會議\n- 沒有'), { before: checked(blankNext), after: checked(repaired(blankNext)) });
const missingTodoFields = v2.replace('負責人：陳經理｜期限：2026 年 11 月 18 日', '負責人：｜期限：');
ok('v2：待辦欠負責人及期限不合格，補待補標示後合格', !checked(missingTodoFields).ok && checked(repaired(missingTodoFields)).ok && repaired(missingTodoFields).includes('✏️（請補負責人）') && repaired(missingTodoFields).includes('日期待定 ✏️（請補日期）'), { before: checked(missingTodoFields), after: checked(repaired(missingTodoFields)) });
const transcriptWithoutDate = '陳經理說：「首批大概二百件。」對方稍後提供資料。';
ok('v2：逐字稿沒有待辦日期時要求警示，補警示後合格', !checked(v2, { transcript: transcriptWithoutDate }).ok && checked(repaired(v2, { transcript: transcriptWithoutDate }), { transcript: transcriptWithoutDate }).ok && repaired(v2, { transcript: transcriptWithoutDate }).includes('⚠️（日期由程式標示，請核對）'), { before: checked(v2, { transcript: transcriptWithoutDate }), after: checked(repaired(v2, { transcript: transcriptWithoutDate }), { transcript: transcriptWithoutDate }) });
const badQuote = v2.replace('首批大概二百件。', '這句不在逐字稿。');
ok('v2：找不到引句不合格，補核對警示後合格', !checked(badQuote).ok && checked(repaired(badQuote)).ok && repaired(badQuote).includes('⚠️（引句未能在逐字稿找到，請核對）'), { before: checked(badQuote), after: checked(repaired(badQuote)) });
ok('v2：逐字稿講者多於參加者列點不合格，補提示後合格', !checked(v2, { speakers: 3 }).ok && checked(repaired(v2, { speakers: 3 }), { speakers: 3 }).ok && repaired(v2, { speakers: 3 }).includes('逐字稿有 3 位講者'), { before: checked(v2, { speakers: 3 }), after: checked(repaired(v2, { speakers: 3 }), { speakers: 3 }) });
const badNumbers = v2.replace('決定 1：', '決定 2：').replace('未定 1：', '未定 2：').replace('待辦 1｜', '待辦 2｜');
ok('v2：決定、未定及待辦編號不連續不合格', !checked(badNumbers).ok && ['決定', '未定', '待辦'].every(word => checked(badNumbers).errors.some(error => error.includes(word))), checked(badNumbers));
const noChanges = v2.replace('## 改動清單\n\n- 沒有', '## 改動清單\n');
ok('v2：改動清單空白不合格，補「沒有」後合格', !checked(noChanges).ok && checked(repaired(noChanges)).ok, { before: checked(noChanges), after: checked(repaired(noChanges)) });
const unmapped = v2.replace('陳經理提出會提供資料。', 'Speaker 9 提出會提供資料。');
ok('v2：未對照講者不合格', !checked(unmapped).ok && checked(unmapped).errors.some(error => error.includes('未對照講者')), checked(unmapped));
const tooLong = v2.replace('- 沒有\n', '- ' + '長'.repeat(4501) + '\n');
ok('v2：超過 4,500 字不合格', !checked(tooLong).ok && checked(tooLong).errors.some(error => error.includes('4,500')), checked(tooLong));
const v1 = [
  '# 會議紀錄：舊格式', '', '## 參加者', '', '- 我', '', '## 已發生的事實', '', '- 已會面。', '',
  '## 對方的說法及承諾', '', '- 對方口頭表示會回覆。', '', '## 雙方決定', '', '- 先核對。', '',
  '## 待辦', '', '- 對方跟進。', '', '## 未定事項', '', '- 日期待定。', '', '## 改動清單', '', '- 沒有', ''
].join('\n');
ok('v1：舊七節紀錄繼續合格', checked(v1).ok && checked(v1).format === 'v1', checked(v1));
ok('isMinutesFileName：新舊檔名合格，不相干檔名不合格', M.isMinutesFileName('會議紀錄.md') && M.isMinutesFileName('2026-11-12 綠園小館 會議紀錄.md') && !M.isMinutesFileName('會議逐字稿.md'), null);
const wrongLegend = v2.replace('共 0 處）　✏️ 待你補充（共 0 處）', '共 9 處）　✏️ 待你補充（共 9 處）').replace('- 雙方已完成會議。', '- ⚠️（數字待核對）雙方已完成會議。');
ok('fixMinutes：重寫標示說明行數目', repaired(wrongLegend).includes('共 1 處）　✏️ 待你補充（共 0 處）'), repaired(wrongLegend));

// 真實 AI 實測（2026-11-12）：範本自己的換算標示要被接受；程式標示疊上後仍屬完整日期；中文數字日期要認得
const tplMark = v2.replace('期限：2026 年 11 月 18 日', '期限：⚠️（由「下星期三」換算）2026 年 11 月 25 日');
ok('DT1 範本換算標示「⚠️（由…換算）」視作已標示核對，不再要求程式標示', checked(tplMark).ok, checked(tplMark));
const unflagged = v2.replace('期限：2026 年 11 月 18 日', '期限：2026 年 11 月 25 日');
ok('DT2 逐字稿沒有的日期而沒有任何標示：仍不合格；修補後加程式標示並合格', !checked(unflagged).ok && checked(repaired(unflagged)).ok && repaired(unflagged).includes('⚠️（日期由程式標示，請核對）2026 年 11 月 25 日'), { before: checked(unflagged), after: repaired(unflagged) });
const doubleMark = v2.replace('期限：2026 年 11 月 18 日', '期限：⚠️（日期由程式標示，請核對）⚠️（由「月底前」換算）2026 年 11 月 30 日');
ok('DT3 兩個標示疊在日期前仍屬完整日期', checked(doubleMark).ok && repaired(doubleMark) === repaired(repaired(doubleMark)), checked(doubleMark));
const cnTranscript = '我會在十一月二十日之前確認首批數量。';
const cnDate = v2.replace('期限：2026 年 11 月 18 日', '期限：2026 年 11 月 20 日').replace('- 陳經理口頭表示「首批大概二百件。」；上述只屬口頭表示。', '- 沒有');
ok('DT4 逐字稿寫「十一月二十日」：2026 年 11 月 20 日 視作逐字稿有的日期', checked(cnDate, { transcript: cnTranscript }).ok, checked(cnDate, { transcript: cnTranscript }));

const pass = results.filter(result => result.pass).length;
fs.writeFileSync(path.join(OUT, 'minutes-check-results.json'), JSON.stringify(results, null, 2));
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n' + JSON.stringify(result.info)));
console.log(`${pass}/${results.length} 通過`);
process.exitCode = pass === results.length ? 0 : 1;
