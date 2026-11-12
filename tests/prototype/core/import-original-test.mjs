// 匯入原檔保存：只可清理由本次呼叫建立的資料夾。
// 用法：node import-original-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';

const [PROTO, outArg] = process.argv.slice(2);
const OUT = freshTestOut(outArg);
const { storeImportOriginal } = await import(pathToFileURL(path.join(PROTO, 'money-import.mjs')).href);
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const existing = path.join(OUT, 'other-batch'), other = path.join(existing, 'other.csv');
fs.mkdirSync(existing); fs.writeFileSync(other, '另一批原檔');
const otherHash = sha(other);
let afterExisting = false;
const existingResult = storeImportOriginal(existing, 'upload.csv', Buffer.from('這一批'), () => { afterExisting = true; });
ok('資料夾已存在時失敗，另一批原檔原封不動', !existingResult.ok && !afterExisting && fs.existsSync(other) && sha(other) === otherHash);

const successFolder = path.join(OUT, 'success-batch'), successOriginal = path.join(successFolder, 'upload.csv'), successReceipt = path.join(OUT, 'success.json');
let afterSuccess = false;
const successResult = storeImportOriginal(successFolder, 'upload.csv', Buffer.from('成功原檔'), () => { afterSuccess = true; fs.writeFileSync(successReceipt, '批次已寫入'); });
ok('成功時原檔及 afterWrite 都完成', successResult.ok && afterSuccess && fs.readFileSync(successOriginal, 'utf8') === '成功原檔' && fs.existsSync(successReceipt));

const failedFolder = path.join(OUT, 'afterwrite-fails');
const failedResult = storeImportOriginal(failedFolder, 'upload.csv', Buffer.from('本次原檔'), () => { throw new Error('故意失敗'); });
ok('afterWrite 失敗時只清走本次建立的資料夾', !failedResult.ok && !fs.existsSync(failedFolder));

const sameNameFolder = path.join(OUT, 'same-name'), sameName = path.join(sameNameFolder, 'upload.csv');
fs.mkdirSync(sameNameFolder); fs.writeFileSync(sameName, '已有原檔');
const sameNameHash = sha(sameName);
let afterSameName = false;
const sameNameResult = storeImportOriginal(sameNameFolder, 'upload.csv', Buffer.from('不能覆寫'), () => { afterSameName = true; });
ok('同名原檔已存在時失敗，不刪任何東西', !sameNameResult.ok && !afterSameName && fs.existsSync(sameName) && sha(sameName) === sameNameHash);

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`\n${passed}/${results.length} 通過`);
process.exit(passed === results.length ? 0 : 1);
