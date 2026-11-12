// 外殼業績合併：中斷後重做、來源限定及創辦人操作的讀寫情景。
// 用法：node money-merge-test.mjs <原型資料夾> <暫存資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { freshTestOut } from '../lib/out-guard.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [PROTO = path.resolve(here, '../../../prototypes/proofread'), OUT] = process.argv.slice(2);
if (!OUT) throw new Error('需要系統暫存資料夾內的輸出資料夾');
const store = await import(pathToFileURL(path.join(PROTO, 'money-store.mjs')).href);
const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

freshTestOut(OUT);

function init(name) {
  const data = path.join(OUT, name, 'data'), DIR = { ledger: path.join(data, 'ledger') }, paths = store.moneyPaths(DIR);
  for (const dir of [paths.ledger, paths.pending, paths.imports, path.join(data, 'founder', 'inbox'), path.join(data, 'founder', 'replies'), path.join(data, 'asks'), path.join(data, 'archive'), path.join(data, 'company'), path.join(data, 'work'), path.join(data, 'sandbox')]) fs.mkdirSync(dir, { recursive: true });
  write(path.join(paths.ledger, 'state.json'), { schemaVersion: 1, company: { actors: [] }, events: [], tasks: [], milestones: [] });
  return { data, DIR, paths };
}
function record(id, payer = '甲公司') {
  return { id, dir: 'in', amountCents: 123400, currency: 'HKD', date: '2026-11-08', counterpartId: '', payer, payerKey: payer, category: 'sales', what: '顧問服務', refund: false, evidence: [{ inputId: 'in-receipt', file: '收據.jpg', page: 1 }], source: 'receipt', importBatch: '', importKey: '', confirmedAt: '2026-11-09T10:00:00+08:00', confirmedBy: 'founder', status: 'confirmed', voidedAt: '', voidReason: '', replaces: '' };
}
function run(data) {
  const prior = process.env.SOS_DATA;
  try { process.env.SOS_DATA = data; return spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, encoding: 'utf8', timeout: 30000 }); }
  finally { if (prior === undefined) delete process.env.SOS_DATA; else process.env.SOS_DATA = prior; }
}
function moneyRows(DIR) { return store.readMoney(DIR).records.filter(row => row.status === 'confirmed'); }
function op(id, type, target, value = {}) { return { id, at: '2026-11-09T10:00:00+08:00', op: type, target, value }; }

// 狀態表：每個中斷點重新開工後，readMoney 都只能看見同一筆交易。
for (const [name, setup] of [
  ['寫入前', ({ paths, rec }) => { write(path.join(paths.pending, rec.id + '.json'), rec); write(paths.founderOps, [op('fo-1', 'moneyAdd', rec.id)]); }],
  ['寫入後、state 前', ({ paths, rec }) => { write(paths.money, { schema: 1, records: [rec], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null }); write(path.join(paths.pending, rec.id + '.json'), rec); write(paths.founderOps, [op('fo-2', 'moneyAdd', rec.id)]); }],
  ['state 後、刪批次前', ({ paths, rec, state }) => { write(paths.money, { schema: 1, records: [rec], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null }); state.founderOpsDone = ['fo-3']; write(path.join(paths.ledger, 'state.json'), state); write(path.join(paths.ledger, '.founder-ops-1-20261109100000.json'), [op('fo-3', 'moneyAdd', rec.id)]); }],
  ['刪待合併檔前', ({ paths, rec }) => { write(paths.money, { schema: 1, records: [rec], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null }); write(path.join(paths.pending, rec.id + '.json'), rec); write(paths.founderOps, [op('fo-4', 'moneyAdd', rec.id)]); }]
]) {
  const ctx = init('interrupt-' + name), rec = record('mn-2026-11-09-100000-001'), state = read(path.join(ctx.paths.ledger, 'state.json'));
  setup({ ...ctx, rec, state }); const child = run(ctx.data), rows = moneyRows(ctx.DIR), saved = fs.existsSync(ctx.paths.money) ? read(ctx.paths.money) : null;
  ok(`中斷：${name}重開後只有一筆`, child.status === 0 && rows.length === 1 && rows[0].amountCents === 123400 && saved?.records?.length === 1, { status: child.status, rows: rows.length, error: String(child.error || ''), stderr: String(child.stderr || '').slice(0, 500), stdout: String(child.stdout || '').slice(0, 300) });
}

{
  const ctx = init('concurrent'), first = record('mn-2026-11-09-100000-011', '甲公司'), second = record('mn-2026-11-09-100000-012', '乙公司');
  write(path.join(ctx.paths.pending, first.id + '.json'), first); write(path.join(ctx.paths.pending, second.id + '.json'), second);
  write(path.join(ctx.paths.ledger, '.founder-ops-1-20261109100000.json'), [op('fo-11', 'moneyAdd', first.id)]);
  write(ctx.paths.founderOps, [op('fo-12', 'moneyAdd', second.id)]);
  const child = run(ctx.data), rows = moneyRows(ctx.DIR);
  ok('合併期間新增操作：兩筆都保留且不重複', child.status === 0 && rows.length === 2 && new Set(rows.map(row => row.id)).size === 2, { status: child.status, ids: rows.map(row => row.id) });
}

{
  const ctx = init('corrupt'), rec = record('mn-2026-11-09-100000-021');
  write(ctx.paths.money, '{壞掉的 JSON'); write(path.join(ctx.paths.pending, rec.id + '.json'), rec); write(ctx.paths.founderOps, [op('fo-21', 'moneyAdd', rec.id)]);
  const before = fs.readFileSync(ctx.paths.money, 'utf8'), child = run(ctx.data), after = fs.readFileSync(ctx.paths.money, 'utf8');
  const state = read(path.join(ctx.paths.ledger, 'state.json')), batches = fs.readdirSync(ctx.paths.ledger).filter(file => /^\.founder-ops-/.test(file));
  ok('損壞 money.json：不覆寫、不刪待合併檔或批次', child.status === 0 && before === after && fs.existsSync(path.join(ctx.paths.pending, rec.id + '.json')) && batches.length === 1 && !(state.founderOpsDone || []).includes('fo-21'), { status: child.status, batches, done: state.founderOpsDone || [] });
}

{
  const ctx = init('unmatched'), rec = record('mn-2026-11-09-100000-031');
  write(path.join(ctx.paths.pending, rec.id + '.json'), rec);
  const child = run(ctx.data);
  ok('沒有 moneyAdd 的待合併檔不寫入 money.json', child.status === 0 && !fs.existsSync(ctx.paths.money) && fs.existsSync(path.join(ctx.paths.pending, rec.id + '.json')), { status: child.status });
}

{
  const ctx = init('import-map'), batchId = 'mb-2026-11-09-100000-001';
  const batch = { schema: 1, id: batchId, state: 'confirmed', mapId: 'map-1234abcd', map: { fields: { date: '日期', amount: '金額' }, dirMode: 'sign', fixedDir: '', inCol: '', outCol: '', headers: ['日期', '金額'] }, rows: [{ line: 2, status: 'ok', include: true, importKey: 'map-1234abcd|h|one', draft: { dir: 'in', amountCents: 5000, currency: 'HKD', date: '2026-11-08', payer: '丙公司', what: '銷售', category: 'sales', refund: false } }], confirmedAt: '2026-11-09T10:00:00+08:00', undoneAt: '' };
  write(path.join(ctx.paths.imports, batchId + '.json'), batch); write(ctx.paths.founderOps, [op('fo-31', 'moneyImport', batchId)]);
  const child = run(ctx.data), saved = read(ctx.paths.money);
  ok('匯入確認把欄位對應寫入 importMaps', child.status === 0 && saved.records.length === 1 && saved.importMaps.length === 1 && saved.importMaps[0].id === batch.mapId, { status: child.status, importMaps: saved.importMaps });
}

{
  const ctx = init('actor-link'), rec = record('mn-2026-11-09-100000-041', '新客戶');
  write(ctx.paths.money, { schema: 1, records: [rec], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null });
  write(ctx.paths.founderOps, [op('fo-41a', 'actorAdd', 'pc-m-test', { name: '新客戶', kind: 'customer' }), op('fo-41b', 'moneyLink', '新客戶', { counterpartId: 'pc-m-test' })]);
  const child = run(ctx.data), state = read(path.join(ctx.paths.ledger, 'state.json')), saved = read(ctx.paths.money);
  ok('actorAdd 在 moneyLink 前：名單與帳本連結同時成立', child.status === 0 && state.company.actors.some(actor => actor.id === 'pc-m-test' && actor.name === '新客戶') && saved.links.新客戶 === 'pc-m-test', { status: child.status, actors: state.company.actors, links: saved.links });
}

{
  const ctx = init('titles');
  const ops = ['moneyAdd', 'moneyImport', 'moneyUndoImport', 'moneyVoid', 'moneyEvidence', 'moneyLink', 'moneyBalance', 'setGoalNumber', 'actorAdd', 'extEnable'].map((type, index) => op('fo-t' + index, type, type === 'moneyBalance' ? 'balance' : 'x' + index, type === 'actorAdd' ? { name: '新客戶', kind: 'customer' } : {}));
  write(ctx.paths.founderOps, ops); const child = run(ctx.data), titles = read(path.join(ctx.paths.ledger, 'state.json')).events.map(item => item.title);
  ok('新操作時間線不再落入舊的未知操作標題', child.status === 0 && titles.length === ops.length && titles.every(title => title && title !== ask.NAMES.ui.founderUnsnoozed), { status: child.status, titles });
}

const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + JSON.stringify(item.info).slice(0, 800)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
