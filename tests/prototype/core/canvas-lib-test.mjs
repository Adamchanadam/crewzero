// 生意模式圖共用模組測試。
// 用法：node canvas-lib-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const [PROTO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../prototypes/proofread'), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-canvas-out-'))] = process.argv.slice(2);
void OUT;
const require = createRequire(import.meta.url);
const C = require(path.resolve(PROTO, 'canvas-lib.js'));
const N = require(path.resolve(PROTO, 'names.js'));
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info: pass ? undefined : info });
const copy = value => JSON.parse(JSON.stringify(value));

ok('CELLS：九格次序、plan 及 area 正確', C.CELLS.map(cell => cell.key).join(',') === 'partners,activities,resources,value,relationship,channel,customer,cost,revenue' && C.CELLS.map(cell => cell.area).join(',') === 'pa,ac,re,va,cr,ch,cu,co,rv' && C.CELLS.every(cell => cell.plan === 'canvas.' + cell.key));
ok('SUB：客戶格包含問題及替代方案', JSON.stringify(C.SUB.customer) === JSON.stringify(['problem', 'alternatives']));
ok('originTag：文件、已選建議、一般建議及未定四種情況', C.originTag({ origin: 'doc', value: '原話' }) === 'mine' && C.originTag({ origin: 'ai', picked: true, value: '已選' }) === 'pick' && C.originTag({ origin: 'ai', value: '建議' }) === 'zero' && C.originTag({ origin: 'default', value: '預設' }) === 'zero' && C.originTag({ origin: 'missing', value: '' }) === 'open' && C.originTag({ origin: 'doc', value: '待你補充' }) === 'open');

const fields = [
  ...C.CELLS.map((cell, index) => ({ id: 'f-' + cell.key, plan: cell.plan, value: '原有' + cell.key, origin: index === 0 ? 'doc' : 'ai', picked: index === 1 })),
  { id: 'f-problem', plan: 'canvas.problem', value: '客戶問題', origin: 'ai', picked: true },
  { id: 'f-alternatives', plan: 'canvas.alternatives', value: '現有替代', origin: 'ai' },
  { id: 'f-type', plan: 'biz.type', value: '產品生意', origin: 'doc' },
  { id: 'f-goal', plan: 'biz.goal', value: '小而穩的生意', origin: 'ai', picked: true }
];
const page = { detail: { reading: fields, model: { name: '測試模式' } } };
const generated = C.canvasFromPage(page, { 'f-value': '確認後價值' });
ok('canvasFromPage：十三項 reading、confirmed 覆蓋及 model 正確', generated.type === '產品生意' && generated.goal === '小而穩的生意' && generated.model.name === '測試模式' && generated.cells.value.text === '確認後價值' && generated.cells.customer.sub.problem.text === '客戶問題' && generated.cells.customer.sub.alternatives.tag === 'zero', generated);
const oldPage = { detail: { reading: fields.filter(field => field.plan !== 'biz.goal') } };
const missingPage = C.canvasFromPage({}, {});
ok('canvasFromPage：十二項舊概覽及沒有 detail 都不拋錯', C.canvasFromPage(oldPage).goal === '' && C.canvasFromPage(oldPage).model === null && missingPage.goal === '' && missingPage.model === null && Object.keys(missingPage.cells).length === 9);

const levels = C.cellLevels([
  { id: 'a1', cell: 'activities', grade: 'said', text: '有人講過活動安排。' },
  { id: 'a2', cell: 'activities', grade: 'stuck', text: '停止便造成痛點的活動安排。' },
  { id: 'a3', cell: 'problem', grade: 'did', text: '客戶已做過尋找替代方案。' },
  { id: 'a4', cell: 'alternatives', grade: 'paid', text: '客戶已付出成本採用替代方案。' },
  { id: 'a5', cell: 'revenue', grade: 'did', text: '有人做過但尚未付款。' },
  { id: 'a6', cell: 'cost', grade: '有人講過', text: '舊級數字眼仍然適用。' },
  { id: 'a7', cell: 'partners', grade: 'said', text: '長'.repeat(41) }
]);
const revenuePaid = C.cellLevels([{ cell: 'revenue', grade: 'paid', text: '付款方已付款。' }]);
ok('cellLevels：同格取最高、問題替代歸客戶、收入及舊級數正確', levels.activities.level === 4 && levels.customer.level === 3 && levels.revenue.level === 0 && levels.revenue.why === '有人做過但尚未付款。' && revenuePaid.revenue.level === 3 && levels.cost.level === 1 && levels.partners.why.endsWith('…') && levels.channel.level === 0 && levels.channel.why === '', levels);
ok('weakest：按 CELLS 次序回傳零級格', C.weakest({ partners: { level: 0 }, activities: { level: 1 }, resources: { level: 0 }, value: { level: 2 }, relationship: { level: 0 }, channel: { level: 3 }, customer: { level: 0 }, cost: { level: 4 }, revenue: { level: 0 } }).join(',') === 'partners,resources,relationship,customer,revenue');

const baseCells = Object.fromEntries(C.CELLS.map(cell => [cell.key, { text: '原有' + cell.key, tag: 'zero' }]));
baseCells.customer.sub = { problem: { text: '原有問題', tag: 'pick' }, alternatives: { text: '原有替代', tag: 'pick' } };
const base = { rev: 1, at: '2026-11-12', cells: baseCells, history: [], suggestions: [
  { id: 's-adopt', cell: 'revenue', text: '採用收入建議', why: '測試', state: 'open' },
  { id: 's-edit', cell: 'problem', text: '原建議問題', why: '測試', state: 'open' },
  { id: 's-reject', cell: 'cost', text: '不採用成本建議', why: '測試', state: 'open' }
] };
const edit = C.canvasView(base, [{ id: 'e1', op: 'canvasEdit', target: 'value', value: { text: '創辦人改寫價值', forRev: 1 }, at: '2026-11-13' }, { id: 'late', op: 'canvasEdit', target: 'cost', value: { text: '過期操作', forRev: 1 } }]);
ok('canvasView：創辦人改格、版本歷史及過期 forRev', edit.rev === 2 && edit.cells.value.text === '創辦人改寫價值' && edit.cells.value.tag === 'mine' && edit.history.length === 1 && edit.history[0].rev === 1 && edit.cells.cost.text === '原有cost', edit);
const adopted = C.canvasView(base, [{ id: 'a1', op: 'canvasSugAnswer', target: 's-adopt', value: { action: 'adopt' } }]);
const edited = C.canvasView(base, [{ id: 'a2', op: 'canvasSugAnswer', target: 's-edit', value: { action: 'edit', text: '創辦人修訂問題' } }]);
const rejected = C.canvasView(base, [{ id: 'a3', op: 'canvasSugAnswer', target: 's-reject', value: { action: 'reject' } }]);
ok('canvasView：採用、修改及拒絕建議', adopted.rev === 2 && adopted.cells.revenue.text === '採用收入建議' && adopted.cells.revenue.tag === 'pick' &&adopted.suggestions[0].state === 'adopted' && edited.rev === 2 && edited.cells.customer.sub.problem.text === '創辦人修訂問題' && edited.cells.customer.sub.problem.tag === 'mine' && edited.suggestions[1].state === 'edited' && rejected.rev === 1 && rejected.cells.cost.text === '原有cost' && rejected.suggestions[2].state === 'rejected');
const before = copy(base), operations = [{ id: 'same-edit', op: 'canvasEdit', target: 'value', value: { text: '只改一次', forRev: 1 } }, { id: 'same-answer', op: 'canvasSugAnswer', target: 's-adopt', value: { action: 'adopt' } }];
const once = C.canvasView(base, operations), twice = C.canvasView(base, [...operations, ...operations]);
ok('canvasView：重複操作 id 不重複套用且不改輸入', JSON.stringify(once) === JSON.stringify(twice) && JSON.stringify(base) === JSON.stringify(before));
const retained = C.canvasView({ ...base, history: Array.from({ length: 20 }, (_, index) => ({ at: '', rev: index, cells: {} })) }, [{ id: 'retain', op: 'canvasEdit', target: 'value', value: { text: '新版', forRev: 1 } }]);
ok('canvasView：base null 安全及 history 最多二十版', C.canvasView(null, []).rev === 0 && C.historyEntry(C.canvasView(null, []), 0) === null && retained.history.length === 20 && C.historyEntry(edit, 0).cells.value.text === '原有value');
ok('goalKeyOf：五個畫面名稱及未知名稱', C.GOALS.every(key => C.goalKeyOf(N.ui['goal_' + key], N) === key) && C.goalKeyOf('不存在的名稱', N) === 'open');

const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + JSON.stringify(item.info ?? '').slice(0, 500)));
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
