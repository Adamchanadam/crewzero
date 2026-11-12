import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const [protoArg, outArg] = process.argv.slice(2);
if (!protoArg || !outArg) throw new Error('用法：node review-fix-d-test.mjs <原型資料夾> <輸出資料夾>');
const PROTO = path.resolve(protoArg);
const OUT = freshTestOut(path.resolve(outArg));
const TEMP = makeTestTemp('crewzero-review-fix-d-');
const source = fs.readFileSync(path.join(PROTO, 'ext-view.js'), 'utf8');
const sandbox = { console, Intl, Date, Math, JSON, Set, Map, Array, Object, String, Number, RegExp };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'ext-view.js' });
const P = sandbox.CZExt?._pure;
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const cut = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`找不到程式片段：${start}`);
  return source.slice(from, to);
};

const table = {
  id: 't1', title: 'f1', fields: [
    { id: 'f1', label: '訂單', type: 'text', required: true },
    { id: 'f2', label: '客戶', type: 'actor' },
    { id: 'f3', label: '工序', type: 'stage', stages: [{ id: 's1', label: '打樣' }, { id: 's2', label: '出貨' }] },
    { id: 'f4', label: '金額', type: 'money', currency: 'HKD' },
    { id: 'f5', label: '備註', type: 'text', hidden: true }
  ]
};
const edit = { id: 'r-1', rev: 7, v: { f1: '原訂單', f3: 's1', f4: { amountCents: 100, currency: 'USD' } } };

ok('D1 M6：送出閘門會拒絕重複儲存，按鈕會在送出時停用',
  P.canSaveForm(false, edit) && !P.canSaveForm(true, edit)
  && /if \(!canSaveForm\(state\.formSaving, row\)\) return;/.test(source)
  && /disabled: state\.formSaving/.test(source));

const copied = P.formRow(edit, table), request = P.rowRequest(copied);
copied.v.f1 = '已修改';
ok('D2 CR4：修改以獨立副本及原版本號送出 update',
  edit.v.f1 === '原訂單' && request.op === 'update' && request.id === 'r-1' && request.rev === 7
  && /button\('extEdit', \(\) => openForm\(row\)\)/.test(source));

ok('D3 CR5：刷新只保留目前選取項目，功能頁有返回全部延伸功能',
  P.selectRefreshItem([{ folder: '甲', state: 'disabled' }, { folder: '乙', state: 'enabled' }], '甲')?.folder === '甲'
  && P.selectRefreshItem([{ folder: '乙', state: 'enabled' }], '') === null
  && /button\('extAllExtensions'/.test(source)
  && /else if \(!state\.item\) screen = featureIndex\(\);/.test(source));

ok('D11 FIX8：啟用成功後選中新功能，套用修改後選回原功能',
  P.afterEnableSelection({ folder: '新功能' }, { from: 'folder:原功能' }) === '新功能'
  && P.afterEnableSelection({ ok: true }, { from: 'folder:原功能' }) === '原功能'
  && /state\.item = \{ folder \}; state\.view = 'board'; state\.form = null;/.test(source));

const people = P.peopleForForm({ people: { external: [{ id: 'pc-1', name: '山徑茶舍' }], team: [{ id: 'pc-team', name: '團隊成員' }] } });
ok('D4 CR6：名單對象讀 people.external 並保留名稱', people.length === 1 && people[0].name === '山徑茶舍' && /state\.people = peopleForForm\(dashboard\)/.test(source));

const feature = cut('    function featureCard(item) {', '    async function enableState');
ok('D5 CR9b：資料列問題只保留數目，格式不符卡不顯示核對器原文',
  P.rowProblemCount({ bad: '第 3 列 f4 不符', problems: ['第 1 列 f2', '第 2 列 f3'] }) === 2
  && /extRowsFormatProblem/.test(source) && !/reason: state\.rowsProblem/.test(source)
  && /extFeatureFormatProblem/.test(feature) && !/item\.error/.test(feature));

ok('D6 S1：交給 Zero 後以讀回的最新資料列取代詳情',
  P.latestRow([{ id: 'r-1', handedAt: '2026-11-11T10:00:00Z' }], 'r-1')?.handedAt
  && /state\.detail = latestRow\(state\.rows, row\.id\)/.test(source));

ok('D7 Q1：未分類卡按開後，下一步會指向第一個工序',
  P.nextActionStage(table, { v: { f3: 's99' } }) === 's1'
  && /const next = nextActionStage\(table, row\)/.test(source));

const preview = cut('    function previewView(draft) {', '    function previewBoard');
ok('D8 R6、R7：隱藏欄以預覽宣告為準，預覽不再顯示新增表單分頁',
  P.hiddenFieldIds(table).join(',') === 'f5'
  && /new Set\(hiddenFieldIds\(table\)\)/.test(source)
  && !preview.includes('viewTabs()'));

const blank = P.formRow(null, table);
ok('D9 R8、R10：新資料列預設首個工序，修改金額保留原有幣別',
  blank.v.f3 === 's1'
  && P.moneyValue(table.fields[3], '2.5', edit.v.f4)?.currency === 'USD'
  && P.moneyValue({ type: 'money' }, '2.5', undefined)?.currency === 'HKD'
  && /moneyValue\(field, input\.value, previous\)/.test(source));

const seed = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const demo = path.join(TEMP, '示範');
const seeded = seed.seedDemo(demo, { now: new Date('2026-11-11T10:00:00Z') });
const demoRows = JSON.parse(fs.readFileSync(path.join(demo, '延伸功能', '訂單生產進度', 'data', 't1.json'), 'utf8'));
const fixtureRows = path.join(PROTO, 'fixtures', 'ext-example', '訂單生產進度', 'rows', 't1.json');
const oldFixtureData = path.join(PROTO, 'fixtures', 'ext-example', '訂單生產進度', 'data');
ok('D10 CR18：例子改用 rows，示範實例還原 data 並保留 14 張卡',
  seeded.created && fs.existsSync(fixtureRows) && !fs.existsSync(oldFixtureData)
  && fs.existsSync(path.join(demo, '延伸功能', '訂單生產進度', 'data', 't1.json'))
  && demoRows.rows.length === 14
  && /renameSync\(path\.join\(target, 'rows'\), path\.join\(target, 'data'\)\)/.test(fs.readFileSync(path.join(PROTO, 'demo-seed.mjs'), 'utf8')));

const extItems = { one: [{ folder: '訂單', state: 'enabled' }], mixed: [{ folder: '訂單', state: 'enabled' }, { folder: '客戶', state: 'pending' }] };
const extDrafts = [{ id: '草稿-舊', state: 'drafting', updatedAt: '2026-11-11T08:00:00Z' }, { id: '草稿-新', state: 'ready', updatedAt: '2026-11-11T09:00:00Z' }];
const decide = (input = {}) => P.decideExtView({ items: [], drafts: [], current: null, userChoseIndex: false, trigger: 'initial', target: '', mobile: false, ...input });
const sameDecision = (input, expected) => JSON.stringify(decide(input)) === JSON.stringify(expected);
const indexDecision = choseIndex => ({ view: 'index', folder: '', draftId: '', userChoseIndex: choseIndex });

ok('D12 EXT-DEC-01（狀態表第1行）：沒有功能及草稿會顯示空白清單',
  sameDecision({}, indexDecision(false)));

ok('D12 EXT-DEC-02（狀態表第2行）：初始載入會選最近更新的未完成草稿',
  sameDecision({ items: extItems.one, drafts: extDrafts }, { view: 'draft', folder: '', draftId: '草稿-新', userChoseIndex: false }));

ok('D12 EXT-DEC-03（狀態表第3行）：只有一個已啟用功能會直達看板',
  sameDecision({ items: extItems.one }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-04（狀態表第4行）：手機闊度不改變第1、3、5、6行的選取',
  JSON.stringify(decide({ mobile: true })) === JSON.stringify(decide({}))
  && JSON.stringify(decide({ items: extItems.one, mobile: true })) === JSON.stringify(decide({ items: extItems.one }))
  && JSON.stringify(decide({ items: extItems.mixed, mobile: true })) === JSON.stringify(decide({ items: extItems.mixed }))
  && JSON.stringify(decide({ trigger: 'enableSuccess', target: '訂單', mobile: true })) === JSON.stringify(decide({ trigger: 'enableSuccess', target: '訂單' })));

ok('D12 EXT-DEC-05（狀態表第5行）：多個或非已啟用功能會顯示清單',
  sameDecision({ items: extItems.mixed }, indexDecision(false)));

ok('D12 EXT-DEC-06（狀態表第6行）：啟用成功會打開回應中的功能',
  sameDecision({ trigger: 'enableSuccess', target: '訂單', userChoseIndex: true }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-07（狀態表第7行）：套用修改成功會返回原功能',
  sameDecision({ trigger: 'applySuccess', target: '訂單', userChoseIndex: true }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-08（狀態表第8行）：返回全部延伸功能會鎖定清單選取',
  sameDecision({ trigger: 'backToIndex', items: extItems.one }, indexDecision(true)));

ok('D12 EXT-DEC-09（狀態表第9行）：返回清單後輪詢不會自動再選功能',
  sameDecision({ trigger: 'poll', items: extItems.one, current: { kind: 'index' }, userChoseIndex: true }, indexDecision(true)));

ok('D12 EXT-DEC-10（狀態表第10行）：由清單打開功能會清除返回清單標記',
  sameDecision({ trigger: 'openItem', target: '訂單', userChoseIndex: true }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-11（狀態表第11行）：由清單打開草稿會選中指定草稿',
  sameDecision({ trigger: 'openDraft', target: '草稿-新', userChoseIndex: false }, { view: 'draft', folder: '', draftId: '草稿-新', userChoseIndex: false }));

ok('D12 EXT-DEC-12（狀態表第12行）：輪詢會保留仍然已啟用的看板',
  sameDecision({ trigger: 'poll', items: extItems.one, current: { kind: 'board', folder: '訂單' } }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-13（狀態表第13行）：輪詢遇到不存在或停用功能會回到清單',
  sameDecision({ trigger: 'poll', items: [{ folder: '訂單', state: 'disabled' }], current: { kind: 'board', folder: '訂單' } }, indexDecision(false)));

ok('D12 EXT-DEC-14（狀態表第14行）：草稿啟用後輪詢會打開對應功能',
  sameDecision({ trigger: 'poll', items: extItems.one, current: { kind: 'draft', folder: '訂單', draftId: '草稿-新' } }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-15（狀態表第15行）：取消草稿後按現況重新決定畫面',
  sameDecision({ trigger: 'draftCancelled', items: extItems.one }, { view: 'board', folder: '訂單', draftId: '', userChoseIndex: false }));

ok('D12 EXT-DEC-17（狀態表第16行）：在清單按新增會打開新增入口',
  sameDecision({ trigger: 'openCreate', items: extItems.one }, { view: 'create', folder: '', draftId: '', userChoseIndex: true }));

ok('D12 EXT-DEC-18（狀態表第17行）：新增入口遇到輪詢會保持新增入口',
  sameDecision({ trigger: 'poll', items: extItems.one, current: { kind: 'create' }, userChoseIndex: true }, { view: 'create', folder: '', draftId: '', userChoseIndex: true }));

ok('D12 EXT-DEC-19（狀態表第18行）：新增入口起草成功會打開回應草稿',
  sameDecision({ trigger: 'openDraft', target: '草稿-新', drafts: extDrafts }, { view: 'draft', folder: '', draftId: '草稿-新', userChoseIndex: false }));

const chooser = cut('    const applyExtDecision = (trigger, target = \'\') => {', '    const setBusyNotice =');
const outsideChooser = source.replace(chooser, '');
ok('D12 EXT-DEC-16：功能與草稿選取只由 decideExtView 輸出套用',
  typeof P.decideExtView === 'function'
  && /const decision = decideExtView\(/.test(chooser)
  && !/state\.(?:item|view|draftId)\s*=(?!=)/.test(outsideChooser));

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`${passed}/${results.length} 通過`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
if (passed !== results.length) process.exitCode = 1;
