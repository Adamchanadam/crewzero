// 用法：node attach-limits-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [PROTO = path.resolve(here, '../../../prototypes/proofread'), OUT = path.resolve(here, '../../../docs/evidence/journey-0440/dispatch/s1-unit-out')] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const L = await import(pathToFileURL(path.join(PROTO, 'limits.mjs')).href);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });

// 線性 Base64 檢查要能安全處理超過舊有失敗門檻的大字串。
const twelve = 'A'.repeat(12 * 1024 * 1024), thirty = 'A'.repeat(30 * 1024 * 1024);
let largeB64 = false;
try { largeB64 = L.B64.test(twelve) === true && L.B64.test(thirty) === true; } catch (error) { largeB64 = false; }
ok('1. 12MB 與 30MB 合法 Base64 可通過且不拋錯', largeB64);
ok('2. Base64 長度、非法字元及中間等號會被拒絕', L.B64.test('AAA') === false && L.B64.test('AA$=') === false && L.B64.test('AA=A') === false);

const meetingName = '主題'.repeat(47) + '會議紀錄.md', pdfName = '長檔名'.repeat(30) + '.pdf';
const cleanMeeting = L.cleanFileName(meetingName), cleanPdf = L.cleanFileName(pdfName);
ok('3. 截檔名保留完整會議紀錄結尾及副檔名', cleanMeeting.endsWith('會議紀錄.md') && Array.from(cleanMeeting).length <= L.FILE_NAME_MAX && cleanPdf.endsWith('.pdf') && Array.from(cleanPdf).length <= L.FILE_NAME_MAX);

const same = L.tellDuplicateKey({ type: 'event', text: '同一件事', date: '2026-11-12', files: [{ bytes: Buffer.from([1, 2, 3]) }] });
const sameAgain = L.tellDuplicateKey({ type: 'event', text: '同一件事', date: '2026-11-12', files: [{ bytes: Buffer.from([1, 2, 3]) }] });
const changed = L.tellDuplicateKey({ type: 'event', text: '同一件事', date: '2026-11-12', files: [{ bytes: Buffer.from([1, 2, 4]) }] });
const seen = new Map([[same, { at: 1000 }]]);
ok('4. 去重雜湊同內容相同、改一位元不同，並以傳入時間判斷十分鐘', same === sameAgain && same !== changed && L.tellDuplicateWithin(seen, same, 1000 + 10 * 60 * 1000) && !L.tellDuplicateWithin(seen, same, 1000 + 10 * 60 * 1000 + 1));

const sourceOf = name => fs.readFileSync(path.join(PROTO, name), 'utf8');
const usesLimit = name => {
  const source = sourceOf(name);
  return source.includes("from './limits.mjs'") && source.includes('FILE_MAX_') && !/10\s*\*\s*1024\s*\*\s*1024/.test(source) && !/25\s*\*\s*1024\s*\*\s*1024/.test(source);
};
ok('5. 每份附件上限為 25MB，ask、Google 收件及取回均共用常數', L.FILE_MAX_MB === 25 && usesLimit('ask.mjs') && usesLimit('inbound-lib.mjs') && usesLimit('link-fetch.mjs'));

fs.writeFileSync(path.join(OUT, 'attach-limits-results.json'), JSON.stringify(results, null, 2));
const passed = results.filter(result => result.pass).length;
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info)));
console.log(`\n${passed}/${results.length} 通過`);
process.exit(passed === results.length ? 0 : 1);
