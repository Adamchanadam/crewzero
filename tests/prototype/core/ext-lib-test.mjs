// 延伸功能共用模組測試：宣告、資料行、摘要、位置及草稿擁有權。
// 用法：node ext-lib-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const [PROTO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../prototypes/proofread'), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-ext-'))] = process.argv.slice(2);
const E = await import(pathToFileURL(path.join(PROTO, 'ext-lib.mjs')).href);
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info: pass ? undefined : info });
const deep = value => JSON.parse(JSON.stringify(value));
const invalid = (name, alter, clue = name) => { const value = deep(decl); alter(value); const got = E.validate(value, { crewPort: 4380 }); ok(`validate：${name}`, !got.ok && got.errors.join(' ').includes(clue), got.errors); };
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });

const decl = {
  format: 'crewzero.extension/1', guide: 1, name: '訂單生產進度', about: '每張客戶訂單做到哪個工序',
  tables: [{ id: 't1', label: '訂單', title: 'f1', due: 'f4',
    fields: [
      { id: 'f1', label: '訂單名稱', type: 'text', required: true }, { id: 'f2', label: '客戶', type: 'actor' },
      { id: 'f3', label: '數量', type: 'number' }, { id: 'f4', label: '交貨日', type: 'date', required: true },
      { id: 'f5', label: '工序', type: 'stage', stages: [{ id: 's1', label: '打樣' }, { id: 's2', label: '印刷' }, { id: 's3', label: '出貨' }] },
      { id: 'f6', label: '金額', type: 'money', currency: 'HKD' }, { id: 'f7', label: '急單', type: 'bool' },
      { id: 'f8', label: '物料', type: 'choice', options: [{ id: 'o1', label: '牛皮紙' }] }, { id: 'f9', label: '備註', type: 'text', hidden: true }
    ],
    summary: [{ label: '進行中', rule: 'open' }, { label: '七日內交貨', rule: 'dueWithin', days: 7 }, { label: '延誤', rule: 'overdue' }, { label: '訂單金額', rule: 'sum', field: 'f6' }],
    handoff: [{ stage: 's3', text: '訂單「{f1}」已出貨給 {f2}，數量 {f3}。' }]
  }], page: { label: '排期圖', port: 4391 }
};
ok('validate：規劃書範例宣告合格', E.validate(decl, { crewPort: 4380 }).ok, E.validate(decl, { crewPort: 4380 }));
invalid('未知頂層鍵', value => { value.unknown = true; }, 'unknown');
invalid('未知欄位鍵', value => { value.tables[0].fields[0].unknown = true; }, 'unknown');
invalid('種類 datetime', value => { value.tables[0].fields[0].type = 'datetime'; }, 'datetime');
invalid('21 個欄位', value => { value.tables[0].fields.push(...Array.from({ length: 12 }, (_, i) => ({ id: `f${10 + i}`, label: `欄${i}`, type: 'text' }))); }, 'fields');
invalid('9 個工序', value => { value.tables[0].fields[4].stages.push(...Array.from({ length: 6 }, (_, i) => ({ id: `s${4 + i}`, label: `工${i}` }))); }, '工序');
invalid('只有 1 個工序', value => { value.tables[0].fields[4].stages = [value.tables[0].fields[4].stages[0]]; }, '工序');
invalid('兩個工序欄位', value => { value.tables[0].fields.push({ id: 'f10', label: '另一工序', type: 'stage', stages: [{ id: 's10', label: '甲' }, { id: 's11', label: '乙' }] }); }, '工序欄位');
invalid('4 個資料表', value => { value.tables.push(...['t2', 't3', 't4'].map(id => ({ id, label: id, title: 'f10', fields: [{ id: `f${id.slice(1)}0`, label: '名稱', type: 'text' }] }))); }, '資料表');
invalid('21 字名稱', value => { value.name = '長'.repeat(21); }, 'name');
invalid('空白名稱', value => { value.name = ' '; }, 'name');
invalid('整份宣告重複代號', value => { value.tables.push({ id: 't2', label: '另一表', title: 'f1', fields: [{ id: 'f1', label: '重複', type: 'text' }] }); }, 'f1');
invalid('表、欄位、工序及選項代號不是文字', value => { value.tables[0].fields[0].id = ['f1']; }, '代號');
invalid('title 指向數字欄', value => { value.tables[0].title = 'f3'; }, 'title');
invalid('due 指向文字欄', value => { value.tables[0].due = 'f1'; }, 'due');
invalid('sum 指向文字欄', value => { value.tables[0].summary[3].field = 'f1'; }, 'field');
invalid('dueWithin 沒有 due', value => { delete value.tables[0].due; }, 'due');
invalid('days 為 0', value => { value.tables[0].summary[1].days = 0; }, 'days');
invalid('handoff 工序不存在', value => { value.tables[0].handoff[0].stage = 's99'; }, 's99');
invalid('handoff 引用不存在欄位', value => { value.tables[0].handoff[0].text = '{f99}'; }, 'f99');
invalid('page.port 等於 crewPort', value => { value.page.port = 4380; }, 'port');
const zero = E.validate(decl, { crewPort: 4380, fromZero: true }); ok('validate：fromZero 不可有 page', !zero.ok && zero.errors.join(' ').includes('Zero'), zero.errors);
invalid('隱藏必填欄', value => { value.tables[0].fields[0].hidden = true; }, '必填');
invalid('隱藏工序欄', value => { value.tables[0].fields[4].hidden = true; }, '工序');
invalid('名稱含控制字元', value => { value.name = '訂單\n生產'; }, '控制字元');
invalid('format 不符', value => { value.format = 'bad'; }, 'format');
invalid('required 不是布林', value => { value.tables[0].fields[0].required = 'yes'; }, 'required');
invalid('retired 含現有工序代號', value => { value.tables[0].retired = ['s2']; }, 'retired');
const retiredAcrossTables = deep(decl); retiredAcrossTables.tables[0].retired = ['s9']; retiredAcrossTables.tables.push({ id: 't2', label: '第二表', title: 'f10', fields: [{ id: 'f10', label: '名稱', type: 'text' }, { id: 'f11', label: '工序', type: 'stage', stages: [{ id: 's9', label: '甲' }, { id: 's10', label: '乙' }] }] });
const duplicatedRetired = deep(decl); duplicatedRetired.tables[0].retired = ['s9', 's9'];
ok('validate：retired 不可與任何表的現役代號衝突或重複', !E.validate(retiredAcrossTables).ok && !E.validate(duplicatedRetired).ok);
ok('validateText：超過 100 KB 不合格且不拋錯', !E.validateText(' '.repeat(102401)).ok);
ok('validateText：非 JSON 不合格且不拋錯', !E.validateText('{not json').ok);
let invalidInputsNoThrow = true, parsedInvalidErrors = [];
try {
  parsedInvalidErrors = E.validateText('[null, 1]').errors;
  E.validate([null, 1]); E.applyEdits({ tables: [null] }, 1, { forRev: 1 }); E.checkRevision(null, [], null);
  E.summaryOf({ tables: [null] }, null, '2026-11-10'); E.readRows({ rows: [null, 1] }, null);
} catch { invalidInputsNoThrow = false; }
ok('不合格宣告及資料輸入一律回傳錯誤而不拋錯，已解析 JSON 保留內容錯誤', invalidInputsNoThrow && parsedInvalidErrors.length > 0 && !parsedInvalidErrors.some(error => error.includes('不是有效的 JSON')), parsedInvalidErrors);

const edited = E.applyEdits(decl, 1, { forRev: 1, labels: { f1: '訂單編號', s2: '印刷及過膠' }, fieldOrder: ['f4', 'f1'], stageOrder: ['s2', 's1'], hidden: ['f6'] });
ok('applyEdits：改欄位及工序名稱', edited.tables[0].fields.find(field => field.id === 'f1').label === '訂單編號' && edited.tables[0].fields[4].stages.find(stage => stage.id === 's2').label === '印刷及過膠');
ok('applyEdits：部分 fieldOrder 後其餘保持相對次序', edited.tables[0].fields.map(field => field.id).join(',') === 'f4,f1,f2,f3,f5,f6,f7,f8,f9');
const unhidden = E.applyEdits(decl, 1, { forRev: 1, hidden: [] });
ok('applyEdits：hidden 覆蓋且可取消原有隱藏', unhidden.tables[0].fields.find(field => field.id === 'f9').hidden === false);
const guarded = E.applyEdits(decl, 1, { forRev: 1, hidden: ['f1', 'f5', 'f6'], labels: { f2: ' ', f3: '數量' } });
ok('applyEdits：必填及工序不可隱藏，不合格名稱略過', !guarded.tables[0].fields.find(field => field.id === 'f1').hidden && !guarded.tables[0].fields.find(field => field.id === 'f5').hidden && guarded.tables[0].fields.find(field => field.id === 'f2').label === '客戶');
ok('applyEdits：forRev 不同時原樣回傳', E.applyEdits(decl, 2, { forRev: 1, labels: { f1: 'x' } }) === decl);
ok('applyEdits：結果一律通過 validate', E.validate(edited, { crewPort: 4380 }).ok && E.validate(guarded, { crewPort: 4380 }).ok);

const renamed = deep(decl); renamed.name = '新名稱'; ok('checkRevision：只改名合格', E.checkRevision(decl, renamed).ok);
const dropField = deep(decl); dropField.tables[0].fields = dropField.tables[0].fields.filter(field => field.id !== 'f3'); ok('checkRevision：刪欄位不合格', !E.checkRevision(decl, dropField).ok);
const changeType = deep(decl); changeType.tables[0].fields.find(field => field.id === 'f3').type = 'text'; ok('checkRevision：改欄位種類不合格', !E.checkRevision(decl, changeType).ok);
const deleteStage = deep(decl); deleteStage.tables[0].fields[4].stages = deleteStage.tables[0].fields[4].stages.filter(stage => stage.id !== 's2'); deleteStage.tables[0].retired = ['s2']; ok('checkRevision：刪無卡工序並加入 retired 合格', E.checkRevision(decl, deleteStage, { cardCounts: { s2: 0 } }).ok);
ok('checkRevision：刪仍有封存卡的工序不合格', !E.checkRevision(decl, deleteStage, { cardCounts: { s2: 1 } }).ok);
const noRetired = deep(deleteStage); delete noRetired.tables[0].retired; ok('checkRevision：刪工序未加入 retired 不合格', !E.checkRevision(decl, noRetired).ok);
const oldRetired = deep(decl); oldRetired.tables[0].retired = ['s9']; const reuse = deep(oldRetired); reuse.tables[0].retired = []; reuse.tables[0].fields[4].stages.push({ id: 's9', label: '重用' }); ok('checkRevision：新工序重用 retired 代號不合格', !E.checkRevision(oldRetired, reuse).ok);
const droppedRetired = deep(oldRetired); droppedRetired.tables[0].retired = [];
ok('checkRevision：每表既有 retired 必須保留', !E.checkRevision(oldRetired, droppedRetired).ok);
const addField = deep(decl); addField.tables[0].fields.push({ id: 'f10', label: '新欄', type: 'text' }); ok('checkRevision：新增欄位合格', E.checkRevision(decl, addField).ok);

const table = decl.tables[0], validValues = { f1: '文字', f2: { id: 'pc-1', name: '客戶' }, f3: 2, f4: '2026-11-10', f5: 's1', f6: { amountCents: 100, currency: 'HKD' }, f7: true, f8: 'o1' };
for (const [id, value] of Object.entries(validValues)) { const field = table.fields.find(item => item.id === id); ok(`validateRow：${field.type} 合格值`, E.validateRow(table, { [id]: value }).ok); const bad = field.type === 'text' ? 3 : field.type === 'number' ? '3' : field.type === 'money' ? { amountCents: 1.2, currency: 'HKD' } : field.type === 'date' ? '2026-02-30' : field.type === 'bool' ? 'true' : field.type === 'choice' ? 'o99' : field.type === 'stage' ? 's99' : { id: 'x', name: 3 }; ok(`validateRow：${field.type} 不合格值`, !E.validateRow(table, { [id]: bad }).ok); }
ok('validateRow：不認識欄位代號不合格', !E.validateRow(table, { f99: 'x' }).ok);
ok('validateRow：新增缺必填欄不合格，修改時不要求', !E.validateRow(table, {}, { requireAll: true }).ok && E.validateRow(table, {}, { requireAll: false }).ok);

ok('readRows：整檔不是物件時回 bad', !!E.readRows([], table).bad);
const readRows = E.readRows({ schema: 1, rows: [{ id: 'r1', v: { f1: 3, f5: 's99' } }] }, table);
ok('readRows：不符種類的值標記 raw/invalid，未知工序歸 unsorted', readRows.rows[0].v.f1.invalid === true && readRows.rows[0].stage === 'unsorted' && readRows.problems.length >= 2, readRows);

const rows = [
  { id: 'a', archived: false, v: { ...validValues, f1: '過期', f4: '2026-11-09', f5: 's1', f6: { amountCents: 100, currency: 'HKD' } } },
  { id: 'b', archived: false, v: { ...validValues, f1: '今日', f4: '2026-11-10', f5: 's1', f6: { amountCents: 200, currency: 'HKD' } } },
  { id: 'c', archived: false, v: { ...validValues, f1: '第七日', f4: '2026-11-17', f5: 's2', f6: { amountCents: 300, currency: 'HKD' } } },
  { id: 'd', archived: false, v: { ...validValues, f1: '第八日', f4: '2026-11-18', f5: 's1', f6: { amountCents: 400, currency: 'USD' } } },
  { id: 'e', archived: false, v: { ...validValues, f1: '完成', f4: '2026-11-08', f5: 's3', f6: { amountCents: 500, currency: 'HKD' } } },
  { id: 'f', archived: true, v: { ...validValues, f1: '封存', f4: '2026-11-08', f5: 's1', f6: { amountCents: 600, currency: 'HKD' } } }
];
const today = '2026-11-10', summary = E.summaryOf(decl, { t1: rows }, today).t1;
ok('摘要及到期：覆蓋過期、今日、第七日、第八日、最後工序及封存、同幣別金額', E.dueState(table, rows[0], today) === 'overdue' && E.dueState(table, rows[1], today) === 'soon' && E.dueState(table, rows[2], today) === 'soon' && E.dueState(table, rows[3], today) === '' && E.dueState(table, rows[4], today) === '' && E.dueState(table, rows[5], today) === '' && summary[0].value === 4 && summary[1].value === 2 && summary[2].value === 1 && summary[3].value === 1100, { summary, due: rows.map(row => E.dueState(table, row, today)) });
const numberSummaryDecl = deep(decl); numberSummaryDecl.tables[0].summary = [{ label: '數量', rule: 'sum', field: 'f3' }];
const numberSummaryRows = [{ archived: false, v: { f3: 2 } }, { archived: false, v: { f3: 3 } }, { archived: true, v: { f3: 100 } }];
ok('summaryOf：number 欄只加總未封存的有限數字', E.summaryOf(numberSummaryDecl, { t1: numberSummaryRows }, today).t1[0].value === 5);
ok('nextStage、isLastStage 及 handoffText', E.nextStage(table, rows[0]) === 's2' && E.nextStage(table, rows[4]) === '' && E.isLastStage(table, rows[4]) && E.handoffText(table, rows[4], 's3') === '訂單「完成」已出貨給 客戶，數量 2。');

ok('folderNameFor：清走路徑符號、30 字、空白預設及同名加號', E.folderNameFor('../訂單/生產:*?') === '訂單生產' && Array.from(E.folderNameFor('長'.repeat(40))).length === 30 && E.folderNameFor(' ') === '延伸功能' && E.folderNameFor('訂單', new Set(['訂單', '訂單（2）'])) === '訂單（3）');
const manyTaken = new Set(['訂單', ...Array.from({ length: 150 }, (_, index) => `訂單（${index + 2}）`)]);
ok('folderNameFor：超過 99 個同名仍繼續避名且不回傳已存在名稱', E.folderNameFor('訂單', manyTaken) === '訂單（152）');
const proj = path.join(OUT, 'proj'), root = path.join(proj, 'crewzero'), driveRoot = path.parse(path.resolve(OUT)).root, atRoot = path.join(driveRoot, 'crewzero-ext');
ok('extensionsDir、extensionsShown：真實、測試及磁碟根目錄', E.extensionsDir(root, { data: path.join(root, 'data') }) === path.join(proj, '延伸功能') && E.extensionsDir(root, { data: path.join(OUT, 'other') }) === path.join(OUT, 'other', '延伸功能') && E.extensionsDir(atRoot, { data: path.join(atRoot, 'data') }) === path.join(atRoot, 'data', '延伸功能') && E.extensionsShown(root, { data: path.join(root, 'data') }, '訂單') === '項目資料夾／延伸功能／訂單' && E.extensionsShown(root, { data: path.join(OUT, 'other') }, '訂單') === '資料夾／延伸功能／訂單');

const draft = { id: 'x-1', state: 'drafting', base: decl, baseRev: 1, edits: {}, ask: '', sample: [], error: '' };
const serverEdits = E.mergeDraft(draft, { edits: { forRev: 1, labels: { f1: '訂單號' } } }, 'server');
ok('mergeDraft：伺服器可改 edits，不可改 base', serverEdits.ok && !E.mergeDraft(draft, { base: {} }, 'server').ok);
const shellReady = E.mergeDraft(draft, { state: 'ready' }, 'shell'), shellEnabled = E.mergeDraft({ ...draft, state: 'ready' }, { state: 'enabled' }, 'shell');
ok('mergeDraft：外殼 drafting 到 ready 合格，ready 到 enabled 不合格', shellReady.ok && !shellEnabled.ok);
const serverEnabled = E.mergeDraft({ ...draft, state: 'ready' }, { state: 'enabled' }, 'server'), serverBack = E.mergeDraft({ ...draft, state: 'enabled' }, { state: 'drafting' }, 'server');
ok('mergeDraft：伺服器 ready 到 enabled 合格，enabled 到 drafting 不合格', serverEnabled.ok && !serverBack.ok);
const denied = E.mergeDraft(draft, { ask: '可改', base: {} }, 'server');
ok('mergeDraft：越權欄位整個拒絕且原草稿不變', !denied.ok && denied.draft === draft && draft.ask === '');

const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + JSON.stringify(item.info ?? '').slice(0, 400)));
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
