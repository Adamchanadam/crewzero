// CSV 匯入純函數測試。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..');
const PROTO = path.join(ROOT, 'prototypes', 'proofread');
const CSV = path.join(ROOT, 'tests', 'prototype', 'fixtures', 'csv');
const I = await import(pathToFileURL(path.join(PROTO, 'money-import.mjs')).href);
const M = await import(pathToFileURL(path.join(PROTO, 'money-lib.mjs')).href);
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const load = name => I.parseCsv(fs.readFileSync(path.join(CSV, name)));
const pick = (rows, order) => rows.find(row => row.draft.orderNo === order);

const shop = load('shop.csv');
const shopMap = { ...I.guessMap(shop.headers), dirMode: 'fixed', fixedDir: 'in' };
const shopRows = I.draftsFrom(shop.rows, shopMap, { mainCurrency: 'HKD', kind: 'shop' });
const shop1001 = pick(shopRows, '#1001'), shop1002 = pick(shopRows, '#1002'), shop1003 = pick(shopRows, '#1003'), shop1004 = pick(shopRows, '#1004');
ok('網店：UTF-8、Paid at、Billing Name、同一訂單合併及私隱欄不保存', shop.ok && shop1001?.line === 2 && shop1001.draft.amountCents === 23800 && shop1001.draft.date === '2026-10-01' && shop1001.draft.payer === '林小姐' && shop1001.draft.what === '哥倫比亞 慧蘭 250g、掛耳包 10 入' && !JSON.stringify(shopRows).includes('@'));
ok('網店：全數退款及取消的原因正確', shop1002?.draft.cancelled && shop1002.draft.cancelReason === '已全數退款' && shop1003?.draft.cancelled && shop1003.draft.cancelReason === '已取消');
ok('網店：另一筆訂單照樣可入帳', shop1004?.draft.amountCents === 128050 && shop1004.draft.payer === '好日子咖啡室' && shop1004.draft.what === '企業禮盒');

const payment = load('payment.csv');
const paymentRows = I.draftsFrom(payment.rows, I.guessMap(payment.headers), { mainCurrency: 'HKD', kind: 'payment' });
const paymentIncome = paymentRows.find(row => row.line === 2), fee = paymentRows.find(row => row.line === 2001), refund = paymentRows.find(row => row.line === 3), payout = paymentRows.find(row => row.line === 4);
ok('收款平台：總額入帳及手續費另成工具支出', paymentIncome?.draft.amountCents === 50000 && paymentIncome.draft.dir === 'in' && fee?.draft.dir === 'out' && fee.draft.amountCents === 1750 && fee.draft.category === 'tools' && fee.draft.what === '手續費：Order 88');
ok('收款平台：退款沿原收入方向、提款不算收支', refund?.draft.dir === 'in' && refund.draft.refund === true && refund.draft.amountCents === 10000 && payout?.draft.cancelled && payout.draft.cancelReason === '轉賬，不是收支');
const paymentClassified = M.classifyImportRows(paymentRows.map(row => row.draft), [], { mapId: 'map-payment' });
ok('手續費有穩定且不同的匯入鍵', paymentClassified.length === 4 && paymentClassified[0].importKey !== paymentClassified[1].importKey);

const bank = load('bank.csv');
const bankRows = I.draftsFrom(bank.rows, I.guessMap(bank.headers), { mainCurrency: 'HKD', kind: 'bank' });
ok('銀行：BOM、斜線日期及存入／支出兩欄正確', bank.ok && bankRows.length === 3 && bankRows[0].draft.dir === 'in' && bankRows[0].draft.amountCents === 23800 && bankRows[0].draft.date === '2026-10-03' && bankRows.slice(1).every(row => row.draft.dir === 'out' && row.draft.amountCents === 650000 && row.draft.payer === '工作室業主' && row.draft.what === '租金 10 月'));
const bankClassified = M.classifyImportRows(bankRows.map(row => row.draft), [], { mapId: 'map-bank' });
ok('銀行：相同金額的兩筆支出各有不同匯入鍵並可入帳', bankClassified.slice(1).every(row => row.status === 'ok') && bankClassified[1].importKey !== bankClassified[2].importKey);

const big5 = load('big5.csv');
ok('Big5 位元組拒絕為編碼錯誤', !big5.ok && big5.error === 'encoding');
ok('超出 2 MB 或 2,000 行即拒絕', I.parseCsv(Buffer.alloc(2 * 1024 * 1024 + 1)).error === 'tooBig' && I.parseCsv(Buffer.from('a\n' + 'x\n'.repeat(2001))).error === 'tooBig');

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`\n${passed}/${results.length} 通過`);
process.exit(passed === results.length ? 0 : 1);
