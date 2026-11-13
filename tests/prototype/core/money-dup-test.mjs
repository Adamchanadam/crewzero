// 用法：node money-dup-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [PROTO = path.resolve(here, '../../../prototypes/proofread'), OUT = path.resolve(here, '../../../docs/evidence/journey-0440/dispatch/s1-unit-out')] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const M = await import(pathToFileURL(path.join(PROTO, 'money-lib.mjs')).href);
const S = await import(pathToFileURL(path.join(PROTO, 'money-store.mjs')).href);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const record = (overrides = {}) => {
  const base = { id: 'mn-2026-11-01-120000-001', dir: 'out', amountCents: 486000, currency: 'HKD', date: '2026-11-01', counterpartId: '', payer: '綠山生豆貿易', category: 'goods', what: '生豆貨款', refund: false, evidence: [], source: 'receipt', importBatch: '', importKey: '', confirmedAt: '2026-11-01T12:00:00+00:00', confirmedBy: 'founder', status: 'confirmed', voidedAt: '', voidReason: '', replaces: '' };
  const value = { ...base, ...overrides };
  value.payerKey = Object.hasOwn(overrides, 'payerKey') ? overrides.payerKey : M.payerKeyOf(value.payer);
  return value;
};
const hints = (candidate, rows) => M.duplicateHints(candidate, rows);
const ledger = value => ({ record: value, where: 'ledger' });
const waiting = value => ({ record: value, where: 'waiting' });

// 1. 相同單據號碼不受日期窗口限制。
const noOld = record({ id: 'mn-2026-10-11-120000-001', date: '2026-10-11', what: '供應商發票 單據號碼 INV-2026-0187' });
const noNew = record({ id: 'mn-2026-11-01-120000-002', what: '付款證明 Invoice No. inv20260187' });
ok('1. 相隔 21 日而單據號碼相同會提示', hints(noNew, [ledger(noOld)]).some(row => row.why === 'number' && row.no === 'INV20260187'));

// 2. 付款未明的舊單據放寬至 60 日；其他同對方同額紀錄仍是 14 日。
const unpaid = record({ id: 'mn-2026-10-01-120000-001', date: '2026-10-01', what: '單據未顯示已付款' });
const paid = record({ id: 'mn-2026-10-01-120000-002', date: '2026-10-01', what: '已付款' });
ok('2. 付款未明 30／60 日提示、61 日不提示；一般 21 日不提示、10 日提示', hints(record({ date: '2026-10-31' }), [ledger(unpaid)]).length === 1 && hints(record({ date: '2026-11-30' }), [ledger(unpaid)]).length === 1 && hints(record({ date: '2026-12-01' }), [ledger(unpaid)]).length === 0 && hints(record({ date: '2026-10-22' }), [ledger(paid)]).length === 0 && hints(record({ date: '2026-10-11' }), [ledger(paid)]).length === 1);

// 3. 一般同對方同額只在 14 日窗口內提示。
const jan = record({ id: 'mn-2026-01-01-120000-001', date: '2026-01-01' });
ok('3. 每月租金相隔 30 日不提示；14 日提示、15 日不提示', hints(record({ date: '2026-01-31' }), [ledger(jan)]).length === 0 && hints(record({ date: '2026-01-15' }), [ledger(jan)]).length === 1 && hints(record({ date: '2026-01-16' }), [ledger(jan)]).length === 0);

// 4. 相同號碼但不同對方不可誤報。
const differentPayer = record({ id: 'mn-2026-10-01-120000-003', payer: '藍海供應', what: '單據號碼 1001' });
ok('4. 不同供應商而單據號碼同為 1001 不提示', hints(record({ what: '發票號碼 1001' }), [ledger(differentPayer)]).length === 0);

// 5. 訂金和餘額同號、不同金額仍交由創辦人判斷。
const deposit = record({ id: 'mn-2026-10-01-120000-004', amountCents: 200000, what: '收據號碼 D-0031' });
ok('5. 訂金及餘額同號但金額不同會提示', hints(record({ amountCents: 700000, what: '單據號碼 d0031' }), [ledger(deposit)]).some(row => row.why === 'number'));

// 6. 作廢紀錄不可參與比對。
const voided = record({ id: 'mn-2026-10-01-120000-005', status: 'void', what: '單據號碼 INV-2026-0187' });
ok('6. 已作廢紀錄不提示', hints(noNew, [ledger(voided)]).length === 0);

// 7. 沒有對方名稱時只以同額及三日窗口提示。
const unnamed = record({ id: 'mn-2026-11-01-120000-006', date: '2026-11-01', payer: '', payerKey: '' });
ok('7. 沒有對方的同額相隔 2 日提示、4 日不提示', hints(record({ date: '2026-11-03', payer: '', payerKey: '' }), [ledger(unnamed)]).some(row => row.why === 'amount') && hints(record({ date: '2026-11-05', payer: '', payerKey: '' }), [ledger(unnamed)]).length === 0);

// 8. 方向和幣別是必要的先決條件。
const differentDir = record({ id: 'mn-2026-11-01-120000-007', dir: 'in', what: '單據號碼 INV-2026-0187' });
const differentCurrency = record({ id: 'mn-2026-11-01-120000-008', currency: 'USD', what: '單據號碼 INV-2026-0187' });
ok('8. 方向或幣別不同不提示', hints(noNew, [ledger(differentDir)]).length === 0 && hints(noNew, [ledger(differentCurrency)]).length === 0);

// 9. 只擷取帶標籤、含數字的單據號碼。
const chineseNo = M.docNumbersOf('單據號碼：INV-2026-0187'), englishNo = M.docNumbersOf('Invoice No. inv20260187');
ok('9. 單據號碼正規化；日期、金額及無數字英文詞不擷取', chineseNo.includes('INV20260187') && englishNo.includes('INV20260187') && M.docNumbersOf('2026-10-20 HK$4,860.00 1,280').length === 0 && M.docNumbersOf('Invoice for 咖啡豆；Order form').length === 0);

// 10. 最多三條，單據號碼優先，其餘按日期接近程度排列，且不洩漏紀錄編號。
const farNumber = record({ id: 'mn-2026-09-01-120000-001', date: '2026-09-01', what: '收據號碼 A-100' });
const nearOne = record({ id: 'mn-2026-10-31-120000-001', date: '2026-10-31' });
const nearTwo = record({ id: 'mn-2026-10-30-120000-001', date: '2026-10-30' });
const nearThree = record({ id: 'mn-2026-10-29-120000-001', date: '2026-10-29' });
const capped = hints(record({ date: '2026-11-01', what: '單據號碼 a100' }), [ledger(nearThree), ledger(nearTwo), ledger(farNumber), ledger(nearOne)]);
ok('10. 最多三條、號碼層優先、其餘按日期接近、回傳沒有紀錄編號', capped.length === 3 && capped[0].why === 'number' && capped[1].date === '2026-10-31' && capped.every(row => !Object.hasOwn(row, 'id')));

// 11. 等你確認的題目納入；已答、同一輸入的舊問題包及自己本身不納入。
const poolRoot = fs.mkdtempSync(path.join(OUT, 'money-dup-pool-'));
const DIR = { ledger: path.join(poolRoot, 'ledger'), asks: path.join(poolRoot, 'asks'), answers: path.join(poolRoot, 'answers') };
const paths = S.moneyPaths(DIR);
fs.mkdirSync(paths.pending, { recursive: true }); fs.mkdirSync(DIR.asks, { recursive: true }); fs.mkdirSync(DIR.answers, { recursive: true });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const candidate = record({ id: 'mn-2026-11-12-120000-001', date: '2026-11-12' }), oldWaiting = record({ id: 'mn-2026-11-10-120000-001', date: '2026-11-10' }), newWaiting = record({ id: 'mn-2026-11-11-120000-001', date: '2026-11-11' }), answeredWaiting = record({ id: 'mn-2026-11-11-120000-002', date: '2026-11-11' });
write(paths.money, { records: [record({ id: 'mn-2026-11-09-120000-001', date: '2026-11-09' })] });
write(path.join(DIR.asks, 'ask-old.json'), { id: 'ask-old', askedAt: '2026-11-10T10:00:00+00:00', realEvent: { inputId: 'in-rerun' }, questions: [{ id: 'q-old', kind: 'money', money: oldWaiting }] });
write(path.join(DIR.asks, 'ask-new.json'), { id: 'ask-new', askedAt: '2026-11-10T11:00:00+00:00', realEvent: { inputId: 'in-rerun' }, questions: [{ id: 'q-new', kind: 'money', money: newWaiting }] });
write(path.join(DIR.asks, 'ask-answered.json'), { id: 'ask-answered', askedAt: '2026-11-10T12:00:00+00:00', realEvent: { inputId: 'in-answered' }, questions: [{ id: 'q-answered', kind: 'money', money: answeredWaiting }] });
write(path.join(DIR.answers, 'ask-answered.json'), { answers: { 'q-answered': { value: '確認入帳' } } });
write(path.join(DIR.asks, 'ask-self.json'), { id: 'ask-self', askedAt: '2026-11-10T13:00:00+00:00', realEvent: { inputId: 'in-current' }, questions: [{ id: 'q-self', kind: 'money', money: candidate }] });
const waitingPool = S.dupPool(DIR), waitingIds = waitingPool.filter(row => row.where === 'waiting').map(row => row.record.id), waitingHints = hints(candidate, waitingPool);
ok('11. 等你確認納入；已答、重跑舊包及自己不計', waitingIds.includes(newWaiting.id) && !waitingIds.includes(oldWaiting.id) && !waitingIds.includes(answeredWaiting.id) && waitingHints.some(row => row.where === 'waiting') && waitingHints.every(row => row.date !== candidate.date));

// 12. 退款與原交易雖然方向、幣別及單據號碼一樣，性質不同不可互相提示；兩筆退款則照常比對。
const originalSale = record({ id: 'mn-2026-11-01-120000-012', what: '發票號碼 R-2026-100', refund: false });
const refundCredit = record({ id: 'mn-2026-11-02-120000-012', date: '2026-11-02', what: '貸記單 單據號碼 r2026100', refund: true });
ok('12. 退款旗號不同不提示；兩筆退款照常提示', hints(refundCredit, [ledger(originalSale)]).length === 0 && hints(refundCredit, [ledger({ ...originalSale, id: 'mn-2026-11-01-120000-013', refund: true })]).some(row => row.why === 'number'));

// 13. 同一次交出（同一附件或同一事件）內的各項不是重複入帳候選；排隊後再入帳也沿用相同來源。
// 但另一次交出的同一份檔案（例如同一張付款證明交兩次）正是要提示的情況（主線裁定，見 R 線驗收 RE-44）。
const sourceEvent = record({ id: 'mn-2026-11-01-120000-014', what: '單據號碼 ST-100', evidence: [{ inputId: 'in-statement', file: 'statement.pdf' }] });
const sourceAttachment = record({ id: 'mn-2026-11-01-120000-015', what: '單據號碼 ST-100', evidence: [{ inputId: 'in-other', file: 'statement.pdf' }] });
const sameEventCandidate = record({ id: 'mn-2026-11-02-120000-014', date: '2026-11-02', what: '單據號碼 st100', evidence: [{ inputId: 'in-statement', file: 'other-page.pdf' }] });
const resubmitCandidate = record({ id: 'mn-2026-11-02-120000-015', date: '2026-11-02', what: '單據號碼 st100', evidence: [{ inputId: 'in-third', file: 'statement.pdf' }] });
ok('13. 同一次交出的各項不互相提示；另一次交出的同名檔仍按號碼提示', hints(sameEventCandidate, [waiting(sourceEvent), ledger(sourceEvent)]).length === 0 && hints(resubmitCandidate, [ledger(sourceAttachment)]).some(row => row.why === 'number'));

// 14. 系統顯示的「未註明對方」等同沒有對方，應走三日金額窗口而非十四日對方窗口。
const unknownPayer = record({ id: 'mn-2026-11-01-120000-016', date: '2026-11-01', payer: '未註明對方' });
const unknownNear = record({ id: 'mn-2026-11-03-120000-016', date: '2026-11-03', payer: '未註明對方' });
const unknownFar = record({ id: 'mn-2026-11-05-120000-016', date: '2026-11-05', payer: '未註明對方' });
ok('14. 未註明對方按沒有對方處理：2 日提示金額、4 日不提示', hints(unknownNear, [ledger(unknownPayer)]).some(row => row.why === 'amount') && hints(unknownFar, [ledger(unknownPayer)]).length === 0);

// 15. CSV 匯入與重複提示的金額層共用 sameAmountNear（同方向、同幣別、同金額、相隔 3 日內）：沒有對方的情況兩者結果一致；
// CSV 其餘規則維持 0.43.0（規格 9.1「CSV 匯入不變」），所以只比較金額層。
const csvOld = record({ id: 'mn-2026-11-01-120000-017', date: '2026-11-01', payer: '', payerKey: '', counterpartId: '' });
const csvCase = (date, amountCents) => {
  const draft = { dir: 'out', amountCents, currency: 'HKD', date, payer: '', category: 'goods', what: '生豆貨款', refund: false };
  const hint = hints(record({ id: 'mn-' + date + '-120000-017', date, amountCents, payer: '', payerKey: '', counterpartId: '' }), [ledger(csvOld)]).some(row => row.why === 'amount');
  const csv = M.classifyImportRows([draft], [csvOld], { mapId: 'map-unit' })[0].status === 'dup';
  return { hint, csv, shared: M.sameAmountNear(draft, csvOld, 3) };
};
const c3 = csvCase('2026-11-04', csvOld.amountCents), c4 = csvCase('2026-11-05', csvOld.amountCents), cAmt = csvCase('2026-11-02', csvOld.amountCents + 100);
// 16. 畫面顯示單據上原本的寫法（已批原型「INV-2026-0187」），比對仍用正規化號碼
const shownOld = record({ id: 'mn-2026-10-20-120000-018', date: '2026-10-20', what: '咖啡豆 發票號碼 INV-2026-0187' });
const shownNew = record({ id: 'mn-2026-11-10-120000-018', date: '2026-11-10', what: '咖啡豆 單據號碼 inv20260187' });
const shownHint = hints(shownNew, [ledger(shownOld)])[0] || {};
ok('16. 號碼提示保留原本寫法供畫面顯示', shownHint.why === 'number' && shownHint.no === 'INV20260187' && shownHint.noShown === 'INV-2026-0187', shownHint);
ok('15. CSV 匯入與重複提示的金額層一致（3 日內提示、4 日不提示、金額不同不提示）', c3.hint && c3.csv && c3.shared && !c4.hint && !c4.csv && !c4.shared && !cAmt.hint && !cAmt.csv && !cAmt.shared, { c3, c4, cAmt });

// 17–19. 收據與月結單：銀行描述與收據店名通常不同（主線全面審查 2026-11-12 04-money-ext M1）。
// 剛好一方是收據（另一方是月結單匯入或手動紀錄）時，方向、金額、幣別相同而相隔 3 日內，即使對方名稱不同亦提示；兩張收據之間維持第 4 項規則。
// 「先交收據、後匯入月結單」走 classifyImportRows（規格 9.1「CSV 匯入不變」，重複會預設不入帳），本版不改，見收據。
const stmtRow = record({ id: 'mn-2026-11-02-120000-019', date: '2026-11-02', payer: 'FPS 轉賬 GREENHILL TRADING', what: '銀行月結單', source: 'import', importKey: 'map-bank|h|2026-11-02|486000|HKD|out|x|y|#1' });
const shopReceipt = record({ id: 'mn-2026-11-01-120000-019', date: '2026-11-01', payer: '綠山生豆貿易', what: '生豆貨款 收據', source: 'receipt' });
ok('17. 先匯入月結單、後交收據：對方寫法不同仍提示「金額相同，日期相近」', hints(shopReceipt, [ledger(stmtRow)]).some(row => row.why === 'amount'), hints(shopReceipt, [ledger(stmtRow)]));
const manualBank = record({ id: '', date: '2026-11-02', payer: 'FPS 轉賬 GREENHILL TRADING', what: '銀行支出', source: 'founder' });
ok('18. 先交收據、後手動「記一筆」同一筆銀行支出：對方寫法不同仍提示', hints(manualBank, [ledger(shopReceipt)]).some(row => row.why === 'amount'), hints(manualBank, [ledger(shopReceipt)]));
ok('19. 反例：收據對月結單金額不同、或相隔 4 日，不提示', hints(record({ ...shopReceipt, amountCents: 486100 }), [ledger(stmtRow)]).length === 0 && hints(record({ ...shopReceipt, date: '2026-11-06' }), [ledger(stmtRow)]).length === 0);

fs.writeFileSync(path.join(OUT, 'money-dup-results.json'), JSON.stringify(results, null, 2));
const passed = results.filter(result => result.pass).length;
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info)));
console.log(`\n${passed}/${results.length} 通過`);
process.exit(passed === results.length ? 0 : 1);
