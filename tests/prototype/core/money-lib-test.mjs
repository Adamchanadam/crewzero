// 業績共用模組測試：純計算、匯入分類及容錯讀取。
// 用法：node money-lib-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const [PROTO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../prototypes/proofread'), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-money-'))] = process.argv.slice(2);
const M = await import(pathToFileURL(path.join(PROTO, 'money-lib.mjs')).href);
const S = await import(pathToFileURL(path.join(PROTO, 'money-store.mjs')).href);
const fixture = JSON.parse(fs.readFileSync(path.join(PROTO, '../../tests/prototype/fixtures/money-scenarios.json'), 'utf8'));
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info: pass ? undefined : info });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deep = value => JSON.parse(JSON.stringify(value));
const statuses = rows => rows.map(row => row.status);
const metrics = (records, month, mainCurrency, links) => M.monthMetrics(records, month, mainCurrency, links);
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });

// 情景表：主要貨幣、月份指標、比較、趨勢、目標、付款者及格位。
const base = M.mergeMoney({ base: { records: fixture.records } });
ok('情景表：主要貨幣', base.mainCurrency === fixture.expect.mainCurrency, base.mainCurrency);
for (const [month, expect] of Object.entries(fixture.expect.months)) ok(`情景表：${month} 的所有指標（包括 other）`, same(metrics(base.records, month, base.mainCurrency, base.links), expect), metrics(base.records, month, base.mainCurrency, base.links));
ok('情景表：10 月較 9 月比較', same(M.compareMonths(metrics(base.records, '2026-10', base.mainCurrency, base.links).income, metrics(base.records, '2026-09', base.mainCurrency, base.links).income), fixture.expect.compareOctSep));
ok('情景表：9 月較 8 月比較', same(M.compareMonths(metrics(base.records, '2026-09', base.mainCurrency, base.links).income, metrics(base.records, '2026-08', base.mainCurrency, base.links).income), fixture.expect.compareSepAug));
for (const name of ['compareNegative', 'compareNegToPos']) {
  const expect = fixture.expect[name], actual = M.compareMonths(expect.cur, expect.prev);
  ok(`情景表：${name} 的差額及百分比`, actual.diff === expect.diff && Math.abs(actual.pct - expect.pct) <= 1e-9, actual);
}
ok('情景表：趨勢月份由舊至新', same(M.trend(base.records, '2026-10', 3, base.mainCurrency, base.links).map(item => item.month), fixture.expect.trend3To2026_10));
for (const goal of fixture.expect.goals) { const actual = M.goalProgress(goal.target, base.records, goal.endDate, base.mainCurrency, base.links); ok(`情景表：${goal.target.metric} 目標進度`, actual.current === goal.current && actual.ratio === goal.ratio, actual); }
ok('情景表：付款者統計', same(M.payerStats(base.records, 'pc-1', base.links, base.mainCurrency), fixture.expect.payerStatsPc1));
ok('情景表：未連名單付款者次序及金額', same(M.topUnlistedPayers(base.records, base.mainCurrency, base.links).map(({ name, totalCents }) => ({ name, totalCents })), fixture.expect.topUnlisted));
ok('情景表：已付款名單編號', same([...M.pipelinePaidIds(base.records, base.links)].sort(), fixture.expect.pipelinePaidIds));

// 合併情景：操作、待合併紀錄和重播都不應改變結果。
for (const scenario of fixture.scenarios) {
  const pending = scenario.add || [];
  const duplicate = scenario.duplicateEverything;
  const merged = M.mergeMoney({ base: { records: fixture.records }, pending: duplicate ? fixture.records : pending, ops: duplicate ? [...(scenario.ops || []), ...(scenario.ops || [])] : (scenario.ops || []) });
  const value = scenario.month ? metrics(merged.records, scenario.month, merged.mainCurrency, merged.links) : null;
  const metricPass = !scenario.expect || Object.entries(scenario.expect).every(([key, expected]) => value[key] === expected);
  const paidPass = !scenario.pipelinePaidIds || same([...M.pipelinePaidIds(merged.records, merged.links)].sort(), scenario.pipelinePaidIds);
  const linkPass = !scenario.links || same(merged.links, scenario.links);
  ok(`合併情景：${scenario.name}`, metricPass && paidPass && linkPass, { value, paid: [...M.pipelinePaidIds(merged.records, merged.links)], links: merged.links });
}

// 匯入：首次、再匯入、跨檔、相同交易及撤銷後均依 importKey 判斷。
const imp = fixture.imports, existing = [deep(imp.existingQuick)];
const classify = (file, list = existing) => M.classifyImportRows(file.drafts, list, { mapId: file.mapId });
const aFirst = classify(imp.fileA); ok('匯入 A 首次分類', same(statuses(aFirst), imp.fileA.expectFirst), statuses(aFirst));
const aBatch = { id: imp.fileA.batch, state: 'confirmed', confirmedAt: '2026-11-05T10:00:00+08:00', rows: aFirst.map((row, i) => ({ ...row, line: i + 2 })) };
const aRecords = M.recordsFromBatch(aBatch); existing.push(...aRecords);
ok('匯入 A 再次分類為已見或原有狀態', same(statuses(classify(imp.fileA)), imp.fileA.expectAgain), statuses(classify(imp.fileA)));
ok('匯入 B 在 A 後的分類', same(statuses(classify(imp.fileB)), imp.fileB.expect), statuses(classify(imp.fileB)));
ok('匯入 C 不同欄位對應的分類', same(statuses(classify(imp.fileC)), imp.fileC.expect), statuses(classify(imp.fileC)));
const dFirst = classify(imp.fileD); ok('匯入 D 兩行相同交易首次均可入帳', same(statuses(dFirst), imp.fileD.expectFirst) && dFirst[0].importKey !== dFirst[1].importKey, dFirst.map(row => ({ status: row.status, importKey: row.importKey })));
const dBatch = { id: imp.fileD.batch, state: 'confirmed', confirmedAt: '2026-11-06T10:00:00+08:00', rows: dFirst.map((row, i) => ({ ...row, line: i + 2 })) };
existing.push(...M.recordsFromBatch(dBatch));
ok('匯入 D 再次分類為已見', same(statuses(classify(imp.fileD)), imp.fileD.expectAgain), statuses(classify(imp.fileD)));
const eRows = M.classifyImportRows(imp.fileE.drafts, [deep(imp.existingQuick)], { mapId: imp.fileE.mapId });
ok('匯入 E：不同名稱不算重複，空白或相同名稱仍算可能重複', same(statuses(eRows), imp.fileE.expect), statuses(eRows));
const revoked = M.mergeMoney({ base: { records: existing }, batches: [{ ...aBatch, state: 'undone' }] });
ok('撤銷 A 後同一檔可重新匯入', same(statuses(M.classifyImportRows(imp.fileA.drafts, revoked.records, { mapId: imp.fileA.mapId })), imp.fileA.expectFirst));
const otherVoid = M.mergeMoney({ base: { records: existing.map(record => record.importBatch === imp.fileA.batch ? { ...record, status: 'void', voidReason: '資料有誤' } : record) } });
ok('其他原因作廢的仍視為已見', same(statuses(M.classifyImportRows(imp.fileA.drafts, otherVoid.records, { mapId: imp.fileA.mapId })), imp.fileA.expectAgain));

// 單元：轉換、正規化、核對、顯示、主要貨幣及匯入編號。
ok('toCents：貨幣、整數、負數、文字、零及超大數', M.toCents('HK$1,280.50') === 128050 && M.toCents('1280') === 128000 && M.toCents('-50') === null && M.toCents('abc') === null && M.toCents('0') === null && M.toCents('1000000001') === null);
ok('payerKeyOf：全形半形、大小寫、空白及標點一致', M.payerKeyOf(' ＡＢＣ　Cafe，有限公司！ ') === 'abccafe有限公司');
const sample = deep(fixture.records[0]);
const invalids = [
  ['零金額', { amountCents: 0 }], ['小數金額', { amountCents: 1.5 }], ['錯誤日期', { date: '2026-02-30' }], ['不認識類別', { category: 'unknown' }], ['錯誤方向', { dir: 'side' }], ['過長說明', { what: '長'.repeat(121) }]
];
for (const [name, patch] of invalids) ok(`validateRecord：拒絕${name}`, !M.validateRecord({ ...sample, ...patch }).ok, M.validateRecord({ ...sample, ...patch }));
const wrongTextFields = ['id', 'currency', 'counterpartId', 'importBatch', 'importKey', 'replaces'];
const wrongTextRecord = { ...sample, id: [sample.id] };
const wrongTextMerge = M.mergeMoney({ base: { records: [wrongTextRecord] } });
ok('validateRecord：代號、幣別及可空代號欄位必須是文字，合併列入 rejected', wrongTextFields.every(field => !M.validateRecord({ ...sample, [field]: [sample[field]] }).ok) && wrongTextMerge.records.length === 0 && wrongTextMerge.rejected.length === 1, wrongTextMerge);
ok('formatMoney：四種貨幣及有角分', M.formatMoney(128000, 'HKD') === 'HK$1,280' && M.formatMoney(1250, 'USD') === 'US$12.50' && M.formatMoney(30000, 'TWD') === 'NT$300' && M.formatMoney(5000, 'CNY') === 'RMB 50');
const later = { ...sample, id: 'mn-2026-11-03-000000-001', currency: 'USD', confirmedAt: '2026-11-03T00:00:00+08:00', date: '2020-01-01' };
ok('mainCurrencyOf：按確認時間而非交易日期，已存值優先', M.mainCurrencyOf('', [later, sample]) === 'HKD' && M.mainCurrencyOf('USD', [sample]) === 'USD');
const zoneEarlier = { ...sample, id: 'mn-2026-11-09-163000-001', currency: 'HKD', confirmedAt: '2026-11-10T00:30:00+08:00' };
const zoneLater = { ...sample, id: 'mn-2026-11-09-200000-001', currency: 'USD', confirmedAt: '2026-11-09T20:00:00Z' };
ok('mainCurrencyOf：以不同時區的確認時間值而非文字排序', M.mainCurrencyOf('', [zoneLater, zoneEarlier]) === 'HKD');
const linkByTime = M.mergeMoney({
  base: { records: [sample] },
  ops: [
    { op: 'moneyLink', target: '時間測試', value: { counterpartId: 'pc-2' }, at: '2026-11-10T11:00:00+08:00' },
    { op: 'moneyLink', target: '時間測試', value: { counterpartId: 'pc-1' }, at: '2026-11-10T10:00:00+08:00' }
  ]
});
ok('mergeMoney：moneyLink 按 at 時間值由舊至新，原讀檔次序不變', linkByTime.links.時間測試 === 'pc-2', linkByTime.links);
ok('recordIdForImport：同批同行編號固定', M.recordIdForImport('mb-2026-11-05-100000-000', 2) === M.recordIdForImport('mb-2026-11-05-100000-000', 2));
const feeRecordId = M.recordIdForImport('mb-2026-11-05-100000-000', 'fee:2');
ok('recordIdForImport：手續費編號與交易行不同且可通過紀錄核對', feeRecordId.endsWith('-F2') && feeRecordId !== M.recordIdForImport('mb-2026-11-05-100000-000', 2) && M.validateRecord({ ...sample, id: feeRecordId }).ok, feeRecordId);

// readMoney：容錯、隊列批次、待合併、匯入批次及四個合併時刻。
const DIR = { ledger: path.join(OUT, 'ledger') }, paths = S.moneyPaths(DIR);
fs.mkdirSync(paths.pending, { recursive: true }); fs.mkdirSync(paths.imports, { recursive: true });
const rec = { ...deep(sample), id: 'mn-2026-11-10-100000-001', date: '2026-10-10', amountCents: 1000, confirmedAt: '2026-11-10T10:00:00+08:00' };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
write(path.join(paths.pending, `${rec.id}.json`), rec);
let read = S.readMoney(DIR); ok('readMoney：只在待合併檔的紀錄只計一次', metrics(read.records, '2026-10', 'HKD', read.links).income === 1000, read);
write(paths.money, { schema: 1, records: [rec] }); read = S.readMoney(DIR); ok('readMoney：待合併檔及 money.json 同一紀錄仍只計一次', metrics(read.records, '2026-10', 'HKD', read.links).income === 1000, read);
write(paths.founderOps, [{ id: 'void-1', op: 'moneyVoid', target: rec.id, value: { reason: '測試' } }]); read = S.readMoney(DIR); ok('readMoney：主操作隊列的 moneyVoid 生效', read.records.find(item => item.id === rec.id)?.status === 'void');
const keptVoid = M.mergeMoney({ base: { records: [{ ...rec, status: 'void', voidReason: '原有原因', voidedAt: '2026-11-10T09:00:00+08:00' }] }, ops: [{ op: 'moneyVoid', target: rec.id, value: { reason: '後來原因' }, at: '2026-11-10T10:00:00+08:00' }] }).records[0];
ok('mergeMoney：已作廢紀錄不改寫原有作廢原因及時間', keptVoid.voidReason === '原有原因' && keptVoid.voidedAt === '2026-11-10T09:00:00+08:00', keptVoid);
fs.rmSync(paths.founderOps); write(path.join(DIR.ledger, '.founder-ops-1-20261110100000.json'), [{ id: 'void-2', op: 'moneyVoid', target: rec.id, value: { reason: '批次' } }]); read = S.readMoney(DIR); ok('readMoney：批次操作檔的 moneyVoid 同樣生效', read.records.find(item => item.id === rec.id)?.status === 'void');
fs.rmSync(path.join(DIR.ledger, '.founder-ops-1-20261110100000.json'));
const batchRecord = { ...rec, id: 'mn-2026-11-10-100000-002', amountCents: 2000 };
const batchRow = { line: 2, status: 'ok', include: true, importKey: 'map-x|o|#x', draft: { dir: 'in', amountCents: 2000, currency: 'HKD', date: '2026-10-11', payer: '甲', what: '', category: 'sales' } };
write(path.join(paths.imports, 'mb-2026-11-10-100000-002.json'), { id: 'mb-2026-11-10-100000-002', state: 'confirmed', confirmedAt: rec.confirmedAt, rows: [batchRow] });
write(path.join(paths.imports, 'mb-2026-11-10-100000-003.json'), { id: 'mb-2026-11-10-100000-003', state: 'parsed', confirmedAt: rec.confirmedAt, rows: [batchRow] });
write(path.join(paths.imports, 'mb-2026-11-10-100000-004.json'), { id: 'mb-2026-11-10-100000-004', state: 'undone', confirmedAt: rec.confirmedAt, rows: [{ ...batchRow, line: 3, importKey: 'map-x|o|#y' }] });
read = S.readMoney(DIR); ok('readMoney：confirmed 計入、parsed 不計、undone 作廢', read.records.some(item => item.importBatch === 'mb-2026-11-10-100000-002' && item.status === 'confirmed') && !read.records.some(item => item.importBatch === 'mb-2026-11-10-100000-003') && read.records.some(item => item.importBatch === 'mb-2026-11-10-100000-004' && item.status === 'void'), read.records);
fs.writeFileSync(paths.money, '{壞 JSON'); read = S.readMoney(DIR); ok('readMoney：money.json 損壞列入 problems，其他來源照讀', read.problems.some(item => item.file === 'money.json') && read.records.some(item => item.importBatch === 'mb-2026-11-10-100000-002'), read.problems);
const corruptDir = { ledger: path.join(OUT, 'corrupt-ledger') }, corruptPaths = S.moneyPaths(corruptDir);
write(corruptPaths.money, { records: { not: 'array' } }); const wrongRecords = S.readMoney(corruptDir);
write(corruptPaths.money, { records: [rec, { ...rec, id: [rec.id] }] }); const invalidRecord = S.readMoney(corruptDir);
ok('readMoney：money.json 的非陣列 records 及無效紀錄均列出檔名，合格紀錄照讀', wrongRecords.problems.some(item => item.file === 'money.json' && item.reason.includes('records')) && invalidRecord.problems.some(item => item.file === 'money.json' && item.reason.includes('紀錄格式不符')) && invalidRecord.records.length === 1, { wrongRecords, invalidRecord });

const mergeDir = { ledger: path.join(OUT, 'merge-ledger') }, mergePaths = S.moneyPaths(mergeDir); fs.mkdirSync(mergePaths.pending, { recursive: true });
const mergeRec = { ...rec, id: 'mn-2026-11-10-100000-099' }, octIncome = () => metrics(S.readMoney(mergeDir).records, '2026-10', 'HKD', {}).income;
write(path.join(mergePaths.pending, `${mergeRec.id}.json`), mergeRec); const moments = [octIncome()];
write(mergePaths.money, { records: [mergeRec] }); moments.push(octIncome());
fs.rmSync(path.join(mergePaths.pending, `${mergeRec.id}.json`)); moments.push(octIncome());
write(mergePaths.founderOps, []); moments.push(octIncome());
ok('readMoney：合併中途四個時刻的 10 月收入相同', same(moments, [1000, 1000, 1000, 1000]), moments);

// 現金可撐多久：結餘核對、三個完整月份、合併操作及同期比較。
const B = (amountCents, asOf = '2026-11-01', currency = 'HKD', confirmedAt = '2026-11-02T09:00:00+08:00') => ({ amountCents, currency, asOf, confirmedAt, by: 'founder' });
let runwayRecordNumber = 0;
const runwayRecord = ({ dir = 'out', amountCents, date, category = dir === 'in' ? 'sales' : 'goods', currency = 'HKD', payer = '測試對方', refund = false, status = 'confirmed' }) => ({
  id: `mn-${date}-000000-${String(++runwayRecordNumber).padStart(3, '0')}`,
  dir, amountCents, currency, date, counterpartId: '', payer, payerKey: M.payerKeyOf(payer), category, what: '', refund, evidence: [],
  source: 'quick', importBatch: '', importKey: '', confirmedAt: '2026-11-02T09:00:00+08:00', confirmedBy: 'founder',
  status, voidedAt: '', voidReason: '', replaces: ''
});
const SRecords = () => [
  runwayRecord({ amountCents: 999900, date: '2026-07-15' }),
  runwayRecord({ dir: 'in', amountCents: 200000, date: '2026-08-02' }),
  runwayRecord({ amountCents: 500000, date: '2026-08-05', category: 'rent' }),
  runwayRecord({ dir: 'in', amountCents: 250000, date: '2026-09-03' }),
  runwayRecord({ amountCents: 520000, date: '2026-09-06' }),
  runwayRecord({ dir: 'in', amountCents: 300000, date: '2026-10-04' }),
  runwayRecord({ amountCents: 630000, date: '2026-10-07', category: 'people' }),
  runwayRecord({ amountCents: 777700, date: '2026-11-05' })
];
const runway = (balance, records = [], today = '2026-11-10', currency = 'HKD') => M.cashRunway(balance, records, today, currency);

const c1 = runway(null);
ok('C1：未設定結餘回傳 unset 預設值', same(c1, { state: 'unset', balanceCents: 0, currency: '', asOf: '', stale: false, basisMonths: [], avgNetCents: 0, burnCents: 0, months: null, otherCurrencies: [] }), c1);
const c2Invalids = [
  { ...B(1), amountCents: -1 }, { ...B(1), amountCents: 1.5 }, { ...B(1), amountCents: '100' },
  { ...B(1), currency: 'hkd' }, { ...B(1), asOf: '2026-02-30' }, { ...B(1), confirmedAt: '' }, { ...B(1), by: 'zero' }
];
ok('C2：七種不合格結餘均為 unset 並核對失敗', c2Invalids.every(item => !M.validateBalance(item).ok && runway(item).state === 'unset'));
const c3 = runway(B(2250000), [], '2026-13-01');
ok('C3：不合格 today 回傳 unset', same(c3, { state: 'unset', balanceCents: 0, currency: '', asOf: '', stale: false, basisMonths: [], avgNetCents: 0, burnCents: 0, months: null, otherCurrencies: [] }), c3);
const c4 = runway(B(2250000), SRecords());
ok('C4：基本組 S 的三個月淨支出及月數', same(c4, { state: 'months', balanceCents: 2250000, currency: 'HKD', asOf: '2026-11-01', stale: false, basisMonths: ['2026-08', '2026-09', '2026-10'], avgNetCents: -300000, burnCents: 300000, months: 7.5, otherCurrencies: [] }), c4);
ok('C5：一百萬結餘可撐 3.3 個月', runway(B(1000000), SRecords()).months === 3.3);
const c6 = runway(B(0), SRecords());
ok('C6：零結餘仍為 months 且月數為零', c6.state === 'months' && c6.months === 0);
const c7Records = [runwayRecord({ amountCents: 40000, date: '2026-08-01' }), runwayRecord({ amountCents: 30000, date: '2026-09-01' }), runwayRecord({ amountCents: 30000, date: '2026-10-01' })];
const c7 = runway(B(99999), c7Records);
ok('C7：平均淨額四捨五入及 2.9 個月', c7.avgNetCents === -33333 && c7.burnCents === 33333 && c7.months === 2.9, c7);
ok('C8：十萬結餘可撐 3 個月', runway(B(100000), c7Records).months === 3);
const c9 = runway(B(100000), [runwayRecord({ dir: 'in', amountCents: 1000, date: '2026-08-01' }), runwayRecord({ amountCents: 500, date: '2026-09-01' }), runwayRecord({ amountCents: 500, date: '2026-10-01' })]);
ok('C9：收支為零屬 balanced', c9.state === 'balanced' && c9.avgNetCents === 0 && c9.burnCents === 0 && c9.months === null, c9);
const c10 = runway(B(100000), [runwayRecord({ dir: 'in', amountCents: 300000, date: '2026-08-01' }), runwayRecord({ dir: 'in', amountCents: 100000, date: '2026-09-01' }), runwayRecord({ amountCents: 50000, date: '2026-09-02' }), runwayRecord({ amountCents: 20000, date: '2026-10-01' })]);
ok('C10：正平均淨額屬 balanced', c10.state === 'balanced' && c10.avgNetCents === 110000, c10);
const c11 = runway(B(600000), [runwayRecord({ amountCents: 100000, date: '2026-09-01' }), runwayRecord({ amountCents: 200000, date: '2026-10-02' })]);
ok('C11：兩個完整月份的平均及月數', same(c11.basisMonths, ['2026-09', '2026-10']) && c11.avgNetCents === -150000 && c11.months === 4, c11);
const c12 = runway(B(450000), [runwayRecord({ amountCents: 90000, date: '2026-10-03' })]);
ok('C12：單一完整月份的月數', same(c12.basisMonths, ['2026-10']) && c12.months === 5, c12);
const c13 = runway(B(600000), [runwayRecord({ amountCents: 50000, date: '2026-09-20' }), runwayRecord({ amountCents: 200000, date: '2026-10-02' })]);
ok('C13：首月第 20 日開始，略過該首月', same(c13.basisMonths, ['2026-10']) && c13.burnCents === 200000 && c13.months === 3, c13);
ok('C14：首筆為十月中旬而未有完整月份屬 noHistory', runway(B(100000), [runwayRecord({ amountCents: 50000, date: '2026-10-15' }), runwayRecord({ amountCents: 10000, date: '2026-11-02' })]).state === 'noHistory');
ok('C15：只有本月紀錄屬 noHistory', runway(B(100000), [runwayRecord({ amountCents: 10000, date: '2026-11-02' })]).state === 'noHistory');
const c16 = runway(B(100000), [], '2026-11-10', '');
ok('C16：未定主要貨幣仍帶回結餘', c16.state === 'noHistory' && c16.balanceCents === 100000, c16);
const c17 = runway(B(1000000), [runwayRecord({ dir: 'in', amountCents: 1000000, date: '2026-08-01', category: 'funding' }), runwayRecord({ amountCents: 100000, date: '2026-09-01' }), runwayRecord({ amountCents: 100000, date: '2026-10-01' })]);
ok('C17：資金注入不作起計或淨支出', same(c17.basisMonths, ['2026-09', '2026-10']) && c17.burnCents === 100000 && c17.months === 10, c17);
ok('C18：三個計算月份沒有紀錄屬 noHistory', runway(B(100000), [runwayRecord({ amountCents: 100000, date: '2026-05-01' })]).state === 'noHistory');
const c19 = runway(B(1000000), [runwayRecord({ amountCents: 300000, date: '2026-08-01' }), runwayRecord({ amountCents: 300000, date: '2026-10-01' })]);
ok('C19：中間空月仍計入平均', same(c19.basisMonths, ['2026-08', '2026-09', '2026-10']) && c19.avgNetCents === -200000 && c19.months === 5, c19);
const c20Records = [...SRecords(), runwayRecord({ dir: 'in', amountCents: 1000000, date: '2026-09-10', category: 'funding' })];
const c20 = runway(B(2250000), c20Records);
ok('C20：資金注入不改變基本組結果', c20.months === 7.5 && c20.burnCents === 300000, c20);
const c21Records = [...SRecords(), runwayRecord({ amountCents: 900000, currency: 'USD', date: '2026-09-12' }), runwayRecord({ dir: 'in', amountCents: 5000, currency: 'JPY', date: '2026-10-12' })];
const c21 = runway(B(2250000), c21Records);
ok('C21：其他貨幣不計入淨額但列出提示', c21.months === 7.5 && same(c21.otherCurrencies, ['JPY', 'USD']), c21);
const c22 = runway(B(2250000, '2026-11-01', 'USD'), SRecords());
ok('C22：結餘幣別不同屬 otherCurrency', c22.state === 'otherCurrency' && c22.months === null && c22.balanceCents === 2250000, c22);
const c23Records = [...SRecords(), runwayRecord({ amountCents: 999999, date: '2026-10-20', status: 'void' }), runwayRecord({ amountCents: 30000, date: '2026-10-21', refund: true })];
const c23 = runway(B(2900000), c23Records);
ok('C23：作廢及退款按月淨額處理', c23.avgNetCents === -290000 && c23.burnCents === 290000 && c23.months === 10, c23);
const c24a = runway(B(100000, '2026-10-10'), [], '2026-11-10', ''), c24b = runway(B(100000, '2026-10-10'), [], '2026-11-11', '');
ok('C24：剛好一個月不過期，翌日過期', c24a.state === 'noHistory' && c24a.stale === false && c24b.state === 'noHistory' && c24b.stale === true);
const c25a = runway(B(100000, '2026-01-31'), [], '2026-02-28', ''), c25b = runway(B(100000, '2026-01-31'), [], '2026-03-01', '');
ok('C25：平年月底的過期日正確', c25a.stale === false && c25b.stale === true);
const c26a = runway(B(100000, '2028-01-31'), [], '2028-02-29', ''), c26b = runway(B(100000, '2028-01-31'), [], '2028-03-01', '');
ok('C26：閏年月底的過期日正確', c26a.stale === false && c26b.stale === true);
ok('C27：截至日遲於今日不過期', runway(B(100000, '2026-11-20'), [], '2026-11-10', '').stale === false);
const c28 = runway(B(2250000, '2026-09-30'), SRecords());
ok('C28：過期結餘仍按相同基礎計算', c28.months === 7.5 && c28.stale === true, c28);

const balanceOp = (at, amount, currency = 'HKD', asOf = '2026-11-01') => ({ op: 'moneyBalance', target: 'balance', at, value: { amount, currency, asOf } });
const m1 = M.mergeMoney({ base: { balance: B(5800000) } });
ok('M1：base 結餘沒有操作時原樣回傳', same(m1.balance, { amountCents: 5800000, currency: 'HKD', asOf: '2026-11-01', confirmedAt: '2026-11-02T09:00:00+08:00', by: 'founder' }), m1);
const m2 = M.mergeMoney({ ops: [balanceOp('2026-11-02T09:00:00+08:00', '5800000')] });
ok('M2：moneyBalance 建立完整結餘', same(m2.balance, { amountCents: 5800000, currency: 'HKD', asOf: '2026-11-01', confirmedAt: '2026-11-02T09:00:00+08:00', by: 'founder' }), m2);
const m3Ops = [balanceOp('2026-11-02T10:00:00+08:00', '100'), balanceOp('2026-11-02T09:00:00+08:00', '200')];
ok('M3：以實際較新時間的操作取代', M.mergeMoney({ ops: m3Ops }).balance?.amountCents === 100);
ok('M4：不同時區按實際時間比較', M.mergeMoney({ ops: [balanceOp('2026-11-02T01:00:00Z', '1'), balanceOp('2026-11-02T08:30:00+08:00', '2')] }).balance?.amountCents === 1);
const m5Base = B(300, '2026-11-01', 'HKD', '2026-11-05T00:00:00Z');
const m5Early = M.mergeMoney({ base: { balance: m5Base }, ops: [balanceOp('2026-11-04T00:00:00Z', '100')] });
const m5Late = M.mergeMoney({ base: { balance: m5Base }, ops: [balanceOp('2026-11-06T00:00:00Z', '200')] });
const m5Same = M.mergeMoney({ base: { balance: m5Base }, ops: [balanceOp('2026-11-05T00:00:00Z', '400')] });
ok('M5：早於 base 保留，相同或較遲操作取代', m5Early.balance?.amountCents === 300 && m5Late.balance?.amountCents === 200 && m5Same.balance?.amountCents === 400);
const m6Values = [balanceOp('2026-11-02T09:00:00+08:00', '12.5'), balanceOp('2026-11-02T09:00:00+08:00', '-5'), balanceOp('2026-11-02T09:00:00+08:00', ''), balanceOp('2026-11-02T09:00:00+08:00', '100', 'HKD', '2026-02-30')];
ok('M6：四種不合格操作均略過並列 rejected', m6Values.every(item => { const merged = M.mergeMoney({ ops: [item] }); return merged.balance === null && merged.rejected.some(rejected => rejected.id === 'balance'); }));
const m7 = M.mergeMoney({ base: { balance: { ...B(100), amountCents: '100' } } });
ok('M7：不合格 base 結餘清空並列 rejected', m7.balance === null && m7.rejected.some(rejected => rejected.id === 'balance'));
const m8a = M.mergeMoney({ ops: [...m3Ops, ...m3Ops] }), m8b = M.mergeMoney({ ops: [m3Ops[0], m3Ops[1], m3Ops[0]] });
ok('M8：重播及重複操作保持相同結果', m8a.balance?.amountCents === 100 && m8b.balance?.amountCents === 100);
const m10a = { ...balanceOp('2026-11-02T00:00:00Z', '100'), id: 'op-a' }, m10b = { ...balanceOp('2026-11-02T00:00:00Z', '200'), id: 'op-b' };
const m10Values = [[m10a, m10b], [m10b, m10a], [m10a, m10b, m10a]].map(ops => M.mergeMoney({ ops }).balance?.amountCents);
ok('M10：相同時間結餘操作按 id 穩定去重及取勝', same(m10Values, [200, 200, 200]), m10Values);
const m11Balances = [
  { ...B(100), asOf: ['2026-11-01'] }, { ...B(100), asOf: { toString: null } },
  { ...B(100), confirmedAt: ['2026-11-02T09:00:00+08:00'] }, { ...B(100), currency: ['HKD'] }, { ...B(100), by: ['founder'] }
];
const m11Record = runwayRecord({ amountCents: 100, date: '2026-08-01' }); m11Record.date = ['2026-08-01'];
const m11Op = { ...balanceOp('2026-11-02T09:00:00+08:00', '100'), value: { amount: '100', currency: 'HKD', asOf: { toString: null } } };
const m11Dir = { ledger: path.join(OUT, 'invalid-date-ledger') }, m11Paths = S.moneyPaths(m11Dir);
let m11NoThrow = true, m11Merge, m11Read, m11Runway, m11Period;
try {
  m11Merge = M.mergeMoney({ ops: [m11Op] });
  m11Runway = M.cashRunway(B(100), [m11Record], { toString: null }, 'HKD');
  m11Period = M.samePeriodMetrics([m11Record], ['2026-11-10'], 'HKD');
  write(m11Paths.money, { records: [], balance: { ...B(100), asOf: { toString: null } } }); write(m11Paths.founderOps, [m11Op]);
  m11Read = S.readMoney(m11Dir);
} catch { m11NoThrow = false; }
ok('M11：非字串日期及結餘欄位拒絕、略過且不拋錯', m11NoThrow && m11Balances.every(balance => !M.validateBalance(balance).ok) && m11Merge.balance === null && m11Merge.rejected.some(item => item.id === 'balance') && m11Runway.state === 'unset' && m11Period.month === '' && m11Period.cur.income === 0 && m11Read.balance === null && m11Read.problems.every(item => item.reason === '現金結餘格式不符'), { m11Merge, m11Read, m11Runway, m11Period });
const m9Dir = { ledger: path.join(OUT, 'balance-ledger') }, m9Paths = S.moneyPaths(m9Dir);
write(m9Paths.money, { records: [], balance: B(5800000) }); const m9Good = S.readMoney(m9Dir);
write(m9Paths.money, { records: [], balance: { ...B(5800000), amountCents: '5800000' } }); const m9Bad = S.readMoney(m9Dir);
write(m9Paths.money, { records: [] }); write(m9Paths.founderOps, [balanceOp('2026-11-02T09:00:00+08:00', '5800000')]); const m9Op = S.readMoney(m9Dir);
ok('M9：readMoney 回傳合格結餘、隱藏不合格金額及套用操作', same(m9Good.balance, { amountCents: 5800000, currency: 'HKD', asOf: '2026-11-01', confirmedAt: '2026-11-02T09:00:00+08:00', by: 'founder' }) && m9Bad.balance === null && m9Bad.problems.some(item => item.reason === '現金結餘格式不符' && !/\d/.test(item.reason)) && same(m9Op.balance, { amountCents: 5800000, currency: 'HKD', asOf: '2026-11-01', confirmedAt: '2026-11-02T09:00:00+08:00', by: 'founder' }), { m9Good, m9Bad, m9Op });

const p1Records = [
  runwayRecord({ dir: 'in', amountCents: 10000, date: '2026-10-05', payer: '對方甲' }),
  runwayRecord({ dir: 'in', amountCents: 20000, date: '2026-10-20', payer: '對方乙' }),
  runwayRecord({ dir: 'in', amountCents: 15000, date: '2026-11-03', payer: '對方甲' }),
  runwayRecord({ dir: 'in', amountCents: 99999, date: '2026-11-12', payer: '對方丙' })
];
const p1 = M.samePeriodMetrics(p1Records, '2026-11-10', 'HKD');
ok('P1：本月及上月同期只計截至日的紀錄', p1.month === '2026-11' && p1.prevMonth === '2026-10' && p1.cutoff === '2026-10-10' && p1.cur.income === 15000 && p1.cur.payers === 1 && p1.cur.repeat === 1 && p1.prev.income === 10000 && p1.prev.payers === 1, p1);
const p2a = M.samePeriodMetrics([], '2026-03-31', 'HKD'), p2b = M.samePeriodMetrics([], '2028-03-31', 'HKD'), p2c = M.samePeriodMetrics([], '2026-01-15', 'HKD');
ok('P2：同期截止日處理平年、閏年及跨年', p2a.cutoff === '2026-02-28' && p2b.cutoff === '2028-02-29' && p2c.cutoff === '2025-12-15' && p2c.prevMonth === '2025-12');
const p3 = M.samePeriodMetrics(p1Records, 'x', 'HKD');
ok('P3：不合格 today 回傳空指標', p3.cur.income === 0 && p3.cur.avg === null && p3.prev.income === 0, p3);

const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + JSON.stringify(item.info ?? '').slice(0, 400)));
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
