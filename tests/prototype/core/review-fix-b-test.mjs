// 獨立審閱修正乙：清單、匯入及業績計算的反例。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';

const [PROTO, outArg] = process.argv.slice(2);
if (!PROTO || !outArg) throw new Error('用法：node review-fix-b-test.mjs <原型資料夾> <輸出資料夾>');
const OUT = freshTestOut(outArg);
const TMP = makeTestTemp('review-fix-b-');
const load = name => import(pathToFileURL(path.join(PROTO, name)).href);
const [bundle, moneyImport, money, dash] = await Promise.all([
  load('bundle-rules.mjs'), load('money-import.mjs'), load('money-lib.mjs'), load('dash-lib.mjs')
]);
const results = [];
const ok = (name, check, detail = '') => results.push({ name, pass: !!check, detail });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };

{
  const install = path.join(TMP, 'manifest-install'), outside = path.join(TMP, 'manifest-outside');
  fs.mkdirSync(install, { recursive: true });
  write(path.join(install, 'data', 'keep.json'), { keep: true });
  write(path.join(outside, 'keep.json'), { keep: true });
  fs.symlinkSync(outside, path.join(install, 'linked'), 'junction');
  ok('B1：清單正規化及 junction 均在刪除前拒絕',
    !!bundle.manifestEntryProblem('./data/keep.json', install) && !!bundle.manifestEntryProblem('linked/keep.json', install)
    && fs.existsSync(path.join(install, 'data', 'keep.json')) && fs.existsSync(path.join(outside, 'keep.json')));
}

{
  const map = { fields: { date: 'Date', amount: 'Amount', currency: 'Currency', payer: 'Payer', what: 'What', orderNo: '', status: '', fee: 'Fee' }, dirMode: 'fixed', fixedDir: 'in', inCol: '', outCol: '' };
  const rows = Array.from({ length: 2000 }, (_, index) => ({
    line: index + 2, values: { Date: '2026-11-11', Amount: '1.00', Currency: 'HKD', Payer: `客戶${index + 1}`, What: '交易', Fee: index === 0 ? '0.01' : '' }
  }));
  const drafts = moneyImport.draftsFrom(rows, map, { mainCurrency: 'HKD', kind: 'payment' });
  const classified = money.classifyImportRows(drafts.map(item => item.draft), [], { mapId: 'map-review-b' });
  const batch = { id: 'mb-2026-11-11-120000-111', state: 'confirmed', confirmedAt: '2026-11-11T12:00:00Z', rows: classified.map((item, index) => ({ ...item, line: drafts[index].line })) };
  const records = money.recordsFromBatch(batch), fee = drafts.find(item => String(item.line).startsWith('fee:'));
  ok('B2：二千行首筆手續費不再覆蓋最後交易',
    records.length === 2001 && fee?.line === 'fee:2' && new Set(drafts.map(item => String(item.line))).size === drafts.length
    && new Set(records.map(record => record.id)).size === records.length && records.every(record => money.validateRecord(record).ok)
    && money.monthMetrics(records, '2026-11', 'HKD').income === 200000);
}

{
  const folder = path.join(TMP, 'first-import', 'ledger', 'money', 'imports', 'mb-2026-11-11-120000-111');
  let written = false;
  const result = moneyImport.storeImportOriginal(folder, 'bank.csv', Buffer.from('Date,Amount'), () => { written = true; });
  ok('B3：首次匯入會先建立父資料夾', result.ok && written && fs.existsSync(path.join(folder, 'bank.csv')));
}

{
  const state = dash.applyFounderOps({}, [{ op: 'setGoalNumber', target: 'quarter', at: '2026-11-11T12:00:00Z', value: { metric: 'income', amount: '100000', currency: 'HKD' } }]);
  ok('B4：目標的分字串不會再次乘一百', state.goals?.quarter?.target?.amountCents === 100000);
}

{
  const DIR = { data: path.join(TMP, 'merged-actors'), ledger: path.join(TMP, 'merged-actors', 'ledger'), company: path.join(TMP, 'merged-actors', 'company'), asks: path.join(TMP, 'merged-actors', 'asks'), answers: path.join(TMP, 'merged-actors', 'answers') };
  for (const folder of Object.values(DIR)) fs.mkdirSync(folder, { recursive: true });
  const record = (id, date, counterpartId) => ({ id, dir: 'in', amountCents: 10000, currency: 'HKD', date, counterpartId, payer: '客戶', payerKey: '客戶', category: 'sales', what: '付款', refund: false, evidence: [], source: 'quick', importBatch: '', importKey: '', confirmedAt: '2026-11-11T12:00:00Z', confirmedBy: 'founder', status: 'confirmed', voidedAt: '', voidReason: '', replaces: '' });
  write(path.join(DIR.ledger, 'money.json'), { schema: 1, mainCurrency: 'HKD', records: [record('mn-2026-11-01-120000-001', '2026-11-01', 'pc-old'), record('mn-2026-11-11-120000-002', '2026-11-11', 'pc-new')], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null });
  write(path.join(DIR.ledger, 'state.json'), { company: { actors: [{ id: 'pc-old', name: '舊客戶', mergedInto: 'pc-new' }, { id: 'pc-new', name: '現客戶', kind: 'customer', status: 'active' }] } });
  const view = dash.moneyView(DIR, { today: '2026-11-11', full: true });
  ok('B5：合併客戶的付款者及回頭客只計最終編號', view.cur.payers === 1 && view.cur.repeat === 1 && view.trend.at(-1)?.payers === 1);
}

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`${passed}/${results.length} 通過`);
if (passed !== results.length) process.exitCode = 1;
