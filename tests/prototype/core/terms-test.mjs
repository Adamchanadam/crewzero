// 常用名稱表純函數測試：不開伺服器、不開 AI、不連網。
// 用法：node terms-test.mjs <原型資料夾> <輸出資料夾>
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROTO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../prototypes/proofread')] = process.argv.slice(2);
const T = await import(pathToFileURL(path.join(PROTO, 'terms-ops.mjs')).href);
const M = await import(pathToFileURL(path.join(PROTO, 'minutes-lib.mjs')).href);
const P = await import(pathToFileURL(path.join(PROTO, 'people-ops.mjs')).href);
const results = [];
const check = (id, description, fn) => {
  try { results.push({ id, description, pass: !!fn() }); }
  catch (error) { results.push({ id, description, pass: false, info: String(error && error.message || error) }); }
};
const json = value => JSON.stringify(value);
const noThrow = fn => { try { fn(); return true; } catch { return false; } };
const item = (more = {}) => ({ kind: 'newTerm', name: '星塵慢烘禮盒', termKind: 'product', why: '這是公司新推出的禮盒名稱', ...more });
const context = (more = {}) => ({ texts: ['創辦人決定推出星塵慢烘禮盒。'], terms: [], actors: [], companyName: '', overview: [], declined: {}, max: 60, ...more });
const term = (id, name, kind = 'product', more = {}) => ({ id, name, kind, aliases: [], addedAt: '2026-11-10', addedFrom: 'manual', ...more });

check('TA1', 'P1：移走名稱、片語、類別、理由或來源保護會讓不合格名稱通過', () => {
  const bad = [
    item({ name: '產品計劃' }), item({ name: 'Marketing' }), item({ name: '星塵。禮盒' }), item({ name: '長'.repeat(31) }),
    item({ name: 'abc@example.invalid' }), item({ name: '2026-11-10' })
  ];
  return T.checkNewTermItem(item(), context()).status === 'ok' && bad.every(value => T.checkNewTermItem(value, context({ texts: ['星塵。禮盒', value.name] })).status === 'drop');
});

check('TA2', 'P2：移走名稱表、名單、公司名稱或概覽去重會重複加入', () => {
  const cases = [
    context({ terms: [term('t1', '舊禮盒', 'product', { aliases: ['星塵慢烘禮盒'] })] }),
    context({ actors: [{ id: 'a1', name: '客戶甲', aliases: ['星塵慢烘禮盒'] }] }),
    context({ companyName: '星塵慢烘禮盒' }),
    context({ overview: ['產品：星塵慢烘禮盒'] })
  ];
  return cases.every(value => T.checkNewTermItem(item(), value).status === 'drop');
});

check('TA3', 'P3：移走 termSync 的兩次不加入上限，或誤用人物名單計數，會錯誤出題', () => {
  const one = context({ declined: { [P.norm('星塵慢烘禮盒')]: 1 } });
  const two = context({ declined: { [P.norm('星塵慢烘禮盒')]: 2 } });
  const peopleOnly = context({ peopleSync: { declined: { [P.norm('星塵慢烘禮盒')]: 2 } } });
  return T.checkNewTermItem(item(), one).status === 'ok' && T.checkNewTermItem(item(), two).status === 'drop' && T.checkNewTermItem(item(), peopleOnly).status === 'ok';
});

check('TA4', 'P4：移走確認題冪等、別名或複製保護會重複寫入或改動傳入狀態', () => {
  const state = { company: { terms: [term('t-old', '星塵禮盒')] }, inputs: [{ id: 'in-1', effects: [] }] };
  const before = json(state), accepted = T.applyNewTerm(state, { inputId: 'in-1', qid: 'q1', item: item(), answer: 'accept', today: '2026-11-10' });
  const replay = T.applyNewTerm(accepted, { inputId: 'in-1', qid: 'q1', item: item(), answer: 'accept', today: '2026-11-10' });
  const aliased = T.applyNewTerm(state, { inputId: 'in-1', qid: 'q2', item: item({ name: '星塵' }), answer: 'alias', aliasOf: 't-old' });
  const added = accepted.company.terms.find(value => value.name === '星塵慢烘禮盒');
  return json(state) === before && added && added.id === 'tn-1-q1' && added.kind === 'product' && Array.isArray(added.aliases) && added.addedAt === '2026-11-10' && added.addedFrom === 'event' && accepted.inputs[0].effects.some(value => /已加入常用名稱表/.test(value.change)) && json(replay) === json(accepted) && aliased.company.terms.length === state.company.terms.length && aliased.company.terms[0].aliases.includes('星塵');
});

check('TA5', 'P5：移走新增、改名、刪除、聯絡資料或重名保護會留下錯誤名稱或錯誤計數', () => {
  const state = { company: { terms: [term('t1', '晨霧冷萃禮盒', 'product', { aliases: ['晨霧禮盒'] })], actors: [{ id: 'a1', name: '人物甲', aliases: [] }] }, termSync: { declined: { [P.norm('新禮盒')]: 1 } } };
  const added = T.applyTermOp(state, 'termAdd', { name: '新禮盒', kind: 'campaign' }, { today: '2026-11-10', opId: 'fo-add' });
  const renamed = T.applyTermOp(state, 'termRename', { id: 't1', name: '晨霧特選禮盒' });
  const back = T.applyTermOp(renamed.state, 'termRename', { id: 't1', name: '晨霧冷萃禮盒' });
  const removed = T.applyTermOp(back.state, 'termRemove', { id: 't1' });
  const duplicate = T.applyTermOp(state, 'termRename', { id: 't1', name: '人物甲' });
  const phone = T.applyTermOp(state, 'termRename', { id: 't1', name: '9123 4567' });
  return added.ok && added.state.company.terms.some(value => value.name === '新禮盒') && !Object.hasOwn(added.state.termSync.declined, P.norm('新禮盒')) && renamed.ok && renamed.state.company.terms[0].aliases.includes('晨霧冷萃禮盒') && back.ok && !back.state.company.terms[0].aliases.some(value => P.norm(value) === P.norm('晨霧冷萃禮盒')) && removed.ok && removed.state.company.terms.length === 0 && removed.state.termSync.declined[P.norm('晨霧冷萃禮盒')] === 2 && removed.state.termSync.declined[P.norm('晨霧特選禮盒')] === 2 && !duplicate.ok && duplicate.state === state && !phone.ok && phone.state === state;
});

check('TA6', 'P6：移走日期排序、60 項或三千字整行截斷保護會令清單失序或過長', () => {
  const ordered = M.termLines([term('old', '舊名稱', 'other', { addedAt: '2026-01-01' }), term('new', '新名稱', 'campaign', { addedAt: '2026-11-10', aliases: ['新別名'] })]);
  const sixtyOne = M.termLines(Array.from({ length: 61 }, (_, index) => term('t' + index, '名稱' + index, 'product', { addedAt: '2026-11-' + String((index % 28) + 1).padStart(2, '0') })));
  const long = M.termLines(Array.from({ length: 60 }, (_, index) => term('l' + index, '名稱' + index, 'other', { aliases: ['別'.repeat(200)] })));
  return ordered[0].startsWith('新名稱（活動或計劃；另一個寫法：新別名）') && !ordered.join('\n').includes('new') && sixtyOne.length === 60 && long.at(-1) === '（其餘從略）' && M.termLines([]).length === 0;
});

check('TA7', 'P7：每件事只保留首個新名稱，並排在下一個對外動作之後', () => {
  const first = { kind: 'newTerm', name: '第一個名稱' }, second = { kind: 'newTerm', name: '第二個名稱' };
  const ordered = P.orderEventItems([{ kind: 'nextAction' }, first, second, { kind: 'followUp' }], 4);
  return ordered.map(value => value.kind).join(',') === 'followUp,nextAction,newTerm' && ordered.at(-1) === first;
});

check('TA8', '補充：移走靜默丟棄保護會令缺欄、錯類別、物件名稱或缺 ctx 回傳錯誤', () => {
  const values = [item({ why: '' }), item({ termKind: 'brand' }), item({ name: {} }), item()];
  const contexts = [context(), context(), context(), {}];
  return values.every((value, index) => T.checkNewTermItem(value, contexts[index]).status === 'drop');
});

check('TA9', '補充：移走格式保護會令名稱清單在壞輸入時拋出例外', () => {
  return noThrow(() => M.termLines(null)) && noThrow(() => M.termLines([null])) && noThrow(() => M.termLines([{ name: {}, kind: 'product', aliases: [] }])) && M.termLines(null).length === 0 && M.termLines([null]).length === 0;
});

check('TA10', '補充：移走拒絕原物件保護會令失敗操作改動帳本', () => {
  const state = { company: { terms: [term('t1', '晨霧冷萃禮盒')] }, termSync: { declined: {} } };
  const before = json(state), result = T.applyTermOp(state, 'termRename', { id: 't1', name: '9123 4567' });
  return !result.ok && result.state === state && json(state) === before;
});

const pass = results.filter(result => result.pass).length;
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.id + ' ' + result.description + (result.pass ? '' : ' ' + (result.info || '')));
console.log(`${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
