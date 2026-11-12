// 延伸功能頁面純計算：分欄、到期、摘要列排序及獨立頁主機名稱。
// 用法：node ext-view-test.mjs <原型資料夾>
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTO = process.argv[2] || path.resolve(HERE, '../../../prototypes/proofread');
const source = fs.readFileSync(path.join(PROTO, 'ext-view.js'), 'utf8');
const sandbox = { console, Intl, Date, Math, JSON, Set, Map, Array, Object, String, Number, RegExp };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'ext-view.js' });
const P = sandbox.CZExt?._pure;
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });

const table = {
  id: 't1', title: 'f1', due: 'f2',
  fields: [
    { id: 'f1', label: '名稱', type: 'text' }, { id: 'f2', label: '交貨日', type: 'date' },
    { id: 'f3', label: '工序', type: 'stage', stages: [{ id: 's1', label: '打樣' }, { id: 's2', label: '出貨' }] }
  ]
};
const rows = [
  { id: 'late', createdAt: '2026-11-01', archived: false, v: { f1: '延誤', f2: '2026-11-09', f3: 's1' } },
  { id: 'today', createdAt: '2026-11-02', archived: false, v: { f1: '今日', f2: '2026-11-10', f3: 's1' } },
  { id: 'soon', createdAt: '2026-11-03', archived: false, v: { f1: '第七日', f2: '2026-11-17', f3: 's1' } },
  { id: 'later', createdAt: '2026-11-04', archived: false, v: { f1: '第八日', f2: '2026-11-18', f3: 's1' } },
  { id: 'done', createdAt: '2026-11-05', archived: false, v: { f1: '完成', f2: '2026-11-08', f3: 's2' } },
  { id: 'archived', createdAt: '2026-11-06', archived: true, v: { f1: '已封存', f2: '2026-11-08', f3: 's1' } },
  { id: 'unknown', createdAt: '2026-11-07', archived: false, v: { f1: '未分類', f2: '', f3: 's99' } }
];

ok('純函數已掛接', !!P && typeof P.groupRows === 'function' && typeof P.pageUrl === 'function');
ok('到期色：過期、今日及第七日', P.dueState(table, rows[0], '2026-11-10') === 'overdue' && P.dueState(table, rows[1], '2026-11-10') === 'soon' && P.dueState(table, rows[2], '2026-11-10') === 'soon');
ok('到期色：第八日、最後工序及封存不著色', P.dueState(table, rows[3], '2026-11-10') === '' && P.dueState(table, rows[4], '2026-11-10') === '' && P.dueState(table, rows[5], '2026-11-10') === '');
ok('無效日期不著色', P.dueState(table, { archived: false, v: { f2: '2026-02-30', f3: 's1' } }, '2026-11-10') === '');
const grouped = P.groupRows(table, rows);
ok('分欄：未知工序歸未分類、封存預設不顯示', grouped.s1.map(row => row.id).join(',') === 'late,today,soon,later' && grouped.s2.map(row => row.id).join(',') === 'done' && grouped.unsorted.map(row => row.id).join(',') === 'unknown');
const allGrouped = P.groupRows(table, rows, true);
ok('分欄：清單模式可保留封存行', allGrouped.s1.some(row => row.id === 'archived'));
ok('下一步及最後工序', P.nextStage(table, rows[0]) === 's2' && P.nextStage(table, rows[4]) === '' && P.isLastStage(table, rows[4]));
const overview = P.overviewOrder([{ name: '乙', values: [{ warn: false }] }, { name: '甲', values: [{ warn: true }] }, { name: '丙', values: [{ warn: true }] }]);
ok('公司現況：有警示先排、同級按名稱', overview.map(row => row.name).join(',') === '丙,甲,乙' || overview.map(row => row.name).join(',') === '甲,丙,乙');
ok('獨立頁：127.0.0.1 換 localhost', P.swapHost('127.0.0.1') === 'localhost' && P.pageUrl('127.0.0.1:4380', 4391) === 'http://localhost:4391');
ok('獨立頁：localhost 換 127.0.0.1', P.swapHost('http://localhost:4380/path') === '127.0.0.1' && P.pageUrl('localhost', 4391) === 'http://127.0.0.1:4391');
ok('日期顯示不使用短日期', P.formatDate('2026-11-07').includes('11') && P.formatDate('2026-11-07').includes('7'));

const pass = results.filter(result => result.pass).length;
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info)));
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
