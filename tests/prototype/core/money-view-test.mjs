// 業績頁投影：帳本讀取、同期比較、可撐月數及創辦人操作的純函數驗證。
import fs from 'node:fs';
import { assertTestOut, freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';

const [PROTO, TMP] = process.argv.slice(2);
if (!PROTO || !TMP) throw new Error('用法：node money-view-test.mjs <原型資料夾> <暫存資料夾>'); freshTestOut(TMP);
const { moneyView, applyFounderOps } = await import(pathToFileURL(path.resolve(PROTO, 'dash-lib.mjs')).href);
const { applyActorOp } = await import(pathToFileURL(path.resolve(PROTO, 'people-ops.mjs')).href);

function pathToFileURL(file) { return new URL('file:///' + file.replace(/\\/g, '/')); }
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const root = makeTestTemp('money-view-');
const dirs = { ledger: path.join(root, 'data', 'ledger'), company: path.join(root, 'data', 'company'), asks: path.join(root, 'data', 'asks'), answers: path.join(root, 'data', 'answers') };
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const rec = (id, date, dir, amountCents, extra = {}) => ({ id, dir, amountCents, currency: 'HKD', date, counterpartId: '', payer: dir === 'in' ? '測試客戶' : '測試供應商', payerKey: dir === 'in' ? '測試客戶' : '測試供應商', category: dir === 'in' ? 'sales' : 'goods', what: '', refund: false, evidence: [], source: 'quick', importBatch: '', importKey: '', confirmedAt: '2026-11-01T09:00:00+00:00', confirmedBy: 'founder', status: 'confirmed', voidedAt: '', voidReason: '', replaces: '', ...extra });

try {
  const empty = moneyView(dirs, { today: '2026-11-11', full: true });
  ok('沒有紀錄時不顯示示意數字', empty.has === false && empty.cur.income === 0 && empty.records.length === 0);

  const records = [
    rec('mn-2026-08-02-090000-001', '2026-08-02', 'out', 10000),
    rec('mn-2026-09-02-090000-002', '2026-09-02', 'out', 10000),
    rec('mn-2026-10-02-090000-003', '2026-10-02', 'out', 10000),
    rec('mn-2026-10-05-090000-004', '2026-10-05', 'in', 25000),
    rec('mn-2026-11-05-090000-005', '2026-11-05', 'in', 30000)
  ];
  write(path.join(dirs.ledger, 'money.json'), { mainCurrency: 'HKD', records, links: {}, balance: { amountCents: 30000, currency: 'HKD', asOf: '2026-11-01', confirmedAt: '2026-11-01T09:00:00+00:00', by: 'founder' } });
  write(path.join(dirs.ledger, 'money', 'pending', records[4].id + '.json'), records[4]);
  const view = moneyView(dirs, { today: '2026-11-11', full: true });
  ok('有紀錄時按主要貨幣計本月收入', view.has && view.cur.income === 30000 && view.mainCurrency === 'HKD', view.cur.income);
  ok('同期比較只比較上月同日止', view.prev.income === 25000 && view.cmp.income.diff === 5000, JSON.stringify(view.cmp.income));
  ok('現金可撐多久按三個完整月份計算', view.runway.state === 'months' && view.runway.basisMonths.length === 3 && view.runway.months === 18, JSON.stringify(view.runway));
  ok('待合併檔與正式帳本同一編號不重複計算', view.records.filter(item => item.id === records[4].id).length === 1 && view.cur.income === 30000);

  const seeded = { goals: { quarter: { endsOn: '2026-12-31', target: { metric: 'income', amountCents: 10000, currency: 'HKD', from: '2026-11-01', setAt: '2026-11-01T09:00:00+00:00', by: 'founder' } } } };
  const sameMetric = applyFounderOps(seeded, [{ op: 'setGoalNumber', target: 'quarter', at: '2026-11-10T12:00:00+00:00', value: { metric: 'income', amount: '200.00', currency: 'HKD' } }]);
  const changedMetric = applyFounderOps(sameMetric, [{ op: 'setGoalNumber', target: 'quarter', at: '2026-11-11T12:00:00+00:00', value: { metric: 'payers', count: 8 } }]);
  ok('只改目標數字保留原有起計日', sameMetric.goals.quarter.target.from === '2026-11-01' && sameMetric.goals.quarter.target.amountCents === 20000);
  ok('改用另一種數字以操作日期重新起計', changedMetric.goals.quarter.target.from === '2026-11-11' && changedMetric.goals.quarter.target.metric === 'payers');

  const add = { id: 'pc-m-1234567890', name: '新客戶', kind: 'customer', at: '2026-11-11T12:00:00+00:00' };
  const once = applyActorOp({ company: { actors: [] }, tasks: [] }, 'actorAdd', add);
  const twice = applyActorOp(once.state, 'actorAdd', add);
  ok('新增名單對象重做兩次仍只有一個對象', once.ok && twice.ok && twice.state.company.actors.length === 1 && twice.state.company.actors[0].addedFrom === 'money');
} finally {
  const passed = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : ' ' + result.info));
  console.log(`${passed}/${results.length} passed`);
  assertTestOut(root); fs.rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 });
}

if (results.some(result => !result.pass)) process.exitCode = 1;
