// 獨立審閱修正甲：伺服器、延伸功能讀寫及外殼的反例回歸測試。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';

const [PROTO, outArg] = process.argv.slice(2);
if (!PROTO || !outArg) throw new Error('用法：node review-fix-a-test.mjs <原型資料夾> <輸出資料夾>');
const OUT = freshTestOut(outArg);
const TEMP = makeTestTemp('crewzero-review-fix-a-');
const load = name => import(pathToFileURL(path.join(PROTO, name)).href);
const money = await load('money-lib.mjs');
const moneyStore = await load('money-store.mjs');
const csv = await load('money-import.mjs');
const ext = await load('ext-lib.mjs');
const store = await load('ext-store.mjs');
const ask = await load('ask-lib.mjs');
const dash = await load('dash-lib.mjs');
const serverSource = fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8');
const runSource = fs.readFileSync(path.join(PROTO, 'run.mjs'), 'utf8');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const json = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cut = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`找不到測試片段：${start}`);
  return source.slice(from, to);
};
const record = (n = 1, extra = {}) => ({
  id: `mn-2026-11-11-120000-${String(n).padStart(3, '0')}`, dir: 'in', amountCents: 10000, currency: 'HKD', date: '2026-11-11', counterpartId: '', payer: '測試客戶', payerKey: '測試客戶', category: 'sales', what: '測試收入', refund: false, evidence: [], source: 'quick', importBatch: '', importKey: '', confirmedAt: '2026-11-11T12:00:00Z', confirmedBy: 'founder', status: 'confirmed', voidedAt: '', voidReason: '', replaces: '', ...extra
});
const baseMoney = records => ({ schema: 1, mainCurrency: 'HKD', records, importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null });
const declaration = () => ({
  format: 'crewzero.extension/1', guide: 1, name: '驗證訂單', about: '只作驗證', tables: [{ id: 't1', label: '訂單', title: 'f1', due: 'f2', fields: [{ id: 'f1', label: '名稱', type: 'text', required: true }, { id: 'f2', label: '日期', type: 'date' }], summary: [{ label: '延誤', rule: 'overdue' }] }]
});
function dirs(name) {
  const data = path.join(TEMP, name), DIR = { data, ledger: path.join(data, 'ledger'), inbox: path.join(data, 'inbox'), replies: path.join(data, 'replies'), company: path.join(data, 'company'), asks: path.join(data, 'asks'), answers: path.join(data, 'answers'), archive: path.join(data, 'archive') };
  for (const folder of Object.values(DIR)) fs.mkdirSync(folder, { recursive: true });
  return DIR;
}
function server(DIR, override = {}) {
  const context = vm.createContext({
    fs, path, crypto, process, Buffer, DIR, ROOT: PROTO, PORT: 4380, FOUNDER_OPS: path.join(DIR.ledger, 'founder-ops.json'), FOUNDER_OPS_LOCK: path.join(DIR.ledger, '.founder-ops.lock'), NAMES: ask.NAMES,
    localIso: () => '2026-11-11T12:00:00+00:00', readJSON: ask.readJSON, writeJSON: ask.writeJSON, fnv: ask.fnv, validateAskReply: ask.validateAskReply, parseFounderReply: ask.parseFounderReply,
    ...money, ...moneyStore, ...csv, ...ext, ...store,
    hasContactInfo: () => false, plain: value => !!value && typeof value === 'object' && !Array.isArray(value), own: (value, key) => Object.hasOwn(value || {}, key), B64: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    schedule: () => {}, certInfo: () => ({ host: 'test' }), companyStatus: () => ({ confirmed: true }), receiveNote: async () => ({ ok: true }), isDemoInstance: () => false,
    ...override
  });
  vm.runInContext(cut(serverSource, 'const minutesNote =', 'const removeMinuteFiles'), context);
  vm.runInContext(cut(serverSource, 'function founderOpsLockCanRecover()', '// 更正公司概覽'), context);
  return context;
}

// A1：示範實例的有效收據答案不得產生待合併紀錄。
{
  const DIR = dirs('a1'), s = server(DIR, { isDemoInstance: () => true });
  const rec = record(1, { source: 'receipt' }), pack = { id: 'ask-a1', questions: [{ id: 'q1', kind: 'money', money: rec }] };
  const reply = { head: { hash: ask.fnv(JSON.stringify(pack)) }, machine: { answers: [{ id: 'q1', value: '確認入帳' }] } };
  const result = s.receiptMoney(reply, pack);
  check('A1 示範收據拒絕且不寫入', result.error === 'demo' && moneyStore.readMoney(DIR).records.length === 0, JSON.stringify(result));
}

// A2：批次內有不合格紀錄時不得確認或產生操作。
// 最後一輪 CR3（修正紀錄 fix-log-suite1.md）起，缺幣別的首次匯入預設 HKD，可以確認；不合格情況改為直接把批次內一行改成無效幣別。
{
  const DIR = dirs('a2'), s = server(DIR);
  const upload = s.receiveMoney({ action: 'importUpload', kind: 'bank', name: 'bank.csv', data: Buffer.from('Date,Amount,Customer\n2026-11-11,10.00,甲').toString('base64') });
  const batchFile = path.join(moneyStore.moneyPaths(DIR).imports, upload.id + '.json');
  const raw = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
  for (const row of raw.rows || []) if (row.draft) row.draft.currency = 'xx';
  fs.writeFileSync(batchFile, JSON.stringify(raw));
  const result = s.receiveMoney({ action: 'importConfirm', id: upload.id });
  const batch = moneyStore.readImportBatch(DIR, upload.id).batch;
  // CR3 起確認時以同一套規則逐行重新分類：不合格的行標為資料不全並排除，不再整批拒絕；核對它沒有入帳
  const rows = batch?.rows || [], live = (moneyStore.readMoney(DIR).records || []).filter(record => record.status === 'confirmed');
  check('A2 匯入紀錄不合格的行不入帳', upload.ok && rows.length > 0 && rows.every(row => row.status === 'incomplete' && !row.include) && live.length === 0, JSON.stringify({ result, state: batch?.state, rows: rows.map(row => [row.status, row.include]), live: live.length }));
}
// A2b（CR3）：未有主要貨幣、檔內沒有幣別欄的首次匯入，預設 HKD 並可確認
{
  const DIR = dirs('a2b'), s = server(DIR);
  const upload = s.receiveMoney({ action: 'importUpload', kind: 'bank', name: 'bank.csv', data: Buffer.from('Date,Amount,Customer\n2026-11-11,10.00,甲').toString('base64') });
  const result = s.receiveMoney({ action: 'importConfirm', id: upload.id });
  const batch = moneyStore.readImportBatch(DIR, upload.id).batch;
  check('A2b 缺幣別的首次匯入預設 HKD 並可確認', upload.ok && result.ok && batch?.state === 'confirmed' && (batch.rows || []).every(row => !row.draft || row.draft.currency === 'HKD'), JSON.stringify({ result, state: batch?.state, cur: (batch?.rows || []).map(row => row.draft?.currency) }));
}

// A3：操作隊列不可寫時，不可先把匯入批次撤銷。
{
  const DIR = dirs('a3'), s = server(DIR), id = 'mb-2026-11-11-120000-111', paths = moneyStore.moneyPaths(DIR);
  json(path.join(paths.imports, `${id}.json`), { id, state: 'confirmed', confirmedAt: '2026-11-11T12:00:00Z', rows: [] });
  s.appendFounderOps = () => false;
  const result = s.receiveMoney({ action: 'importUndo', id });
  check('A3 撤銷追加失敗時批次保持 confirmed', result.error === 'busy' && moneyStore.readImportBatch(DIR, id).batch?.state === 'confirmed', JSON.stringify(result));
}

// A4：損壞資料表不得被當成空表覆寫。
{
  const DIR = dirs('a4'), decl = declaration();
  store.createExtension(PROTO, DIR, '訂單', decl);
  const file = path.join(ext.extensionsDir(PROTO, DIR), '訂單', 'data', 't1.json'), broken = '{"schema":1,"rows":[';
  fs.writeFileSync(file, broken);
  const result = store.rowWrite(PROTO, DIR, { folder: '訂單', table: 't1', op: 'add', v: { f1: '新行' } });
  check('A4 損壞資料表回 badFormat 並保留原文', result.error === 'badFormat' && fs.readFileSync(file, 'utf8') === broken, JSON.stringify(result));
}

// A5：重讀與換入之間發現同表更新時，重試後保留兩邊資料。
{
  const DIR = dirs('a5'), decl = declaration();
  store.createExtension(PROTO, DIR, '訂單', decl);
  const first = store.rowWrite(PROTO, DIR, { folder: '訂單', table: 't1', op: 'add', v: { f1: '原行' } });
  const file = path.join(ext.extensionsDir(PROTO, DIR), '訂單', 'data', 't1.json'), originalRead = fs.readFileSync;
  let reads = 0, injected = false;
  fs.readFileSync = function(fileName, ...args) {
    if (String(fileName) === file) {
      reads++;
      if (reads === 2 && !injected) { injected = true; const current = JSON.parse(originalRead.call(fs, file, 'utf8')); current.rows.push({ id: 'r-2026-11-11-120000-999', rev: 1, v: { f1: 'AI 同時新增' }, createdAt: '', updatedAt: '', archived: false, handedAt: '' }); fs.writeFileSync(file, JSON.stringify(current)); }
    }
    return originalRead.call(fs, fileName, ...args);
  };
  let result;
  try { result = store.rowWrite(PROTO, DIR, { folder: '訂單', table: 't1', op: 'update', id: first.row.id, rev: 1, v: { f1: '頁面修改' } }); }
  finally { fs.readFileSync = originalRead; }
  const names = read(file).rows.map(row => row.v.f1);
  check('A5 同表競爭更新重試後不遺失資料', result.ok && injected && names.includes('頁面修改') && names.includes('AI 同時新增'), JSON.stringify({ result, names }));
}

// A6：文字起草收件單必須帶草稿編號。
{
  const DIR = dirs('a6'), s = server(DIR), result = s.receiveExt({ action: 'draftSentence', ask: '追蹤訂單' });
  const note = fs.readFileSync(path.join(DIR.inbox, `${result.id}-note-ext-draft.md`), 'utf8');
  check('A6 延伸功能起草收件單帶 draftId', result.ok && ask.parseFounderReply(note).machine?.draftId === result.id, JSON.stringify(ask.parseFounderReply(note).machine));
}

// A7、A8：伺服器不得越權寫 error，且舊修訂不可覆寫新草稿。
{
  const DIR = dirs('a7a8'), s = server(DIR), id = 'x-2026-11-11-120000-222';
  store.createDraft(DIR, { id, state: 'ready', base: declaration(), baseRev: 1, edits: { forRev: 1 }, ask: '', revise: '', folder: '', sourceHash: '', error: '上一輪失敗' });
  const revised = s.receiveExt({ action: 'draftRevise', id, revise: '加一欄' });
  const edited = s.receiveExt({ action: 'draftEdit', id, edits: { forRev: 0, labels: { f1: '新名稱' } } });
  check('A7 重新起草不越權寫 error', revised.ok && store.readDraft(DIR, id)?.state === 'drafting', JSON.stringify(revised));
  check('A8 草稿修訂版本不符回 stale', edited.error === 'stale' && store.readDraft(DIR, id)?.edits.forRev === 1, JSON.stringify(edited));
}

// A9：零現金結餘是合法輸入。
{
  const DIR = dirs('a9'), s = server(DIR);
  json(path.join(DIR.ledger, 'money.json'), baseMoney([]));
  const result = s.receiveMoney({ action: 'balance', amount: '0.00', asOf: '2026-11-11', currency: 'HKD' });
  const op = read(path.join(DIR.ledger, 'founder-ops.json'))[0];
  check('A9 零結餘可確認', result.ok && op.value.amount === '0', JSON.stringify(result));
}

// A10：伺服器必須以 dashboardState 的頂層 ext 參數傳遞延伸功能摘要。
{
  const dashboardCall = /dashboardState\(DIR, \{[\s\S]*?ext: extOverview\(ROOT, DIR, localIso\(\)\.slice\(0, 10\)\)/.test(serverSource);
  const oldNesting = /extra:\s*\{\s*ext:\s*extOverview\(/.test(serverSource);
  check('A10 儀表板延伸功能摘要置於頂層 ext', dashboardCall && !oldNesting, JSON.stringify({ dashboardCall, oldNesting }));
}

// A11：概覽的快取與計算都必須使用傳入的 today。
{
  const DIR = dirs('a11'), decl = declaration();
  store.createExtension(PROTO, DIR, '訂單', decl); store.registerExtension(DIR, '訂單', decl);
  store.rowWrite(PROTO, DIR, { folder: '訂單', table: 't1', op: 'add', v: { f1: '測試', f2: '2030-01-02' } });
  const before = store.extOverview(PROTO, DIR, '2030-01-01'), after = store.extOverview(PROTO, DIR, '2030-01-03');
  check('A11 概覽以傳入日期計算延誤', before.rows[0]?.values[0]?.value === 0 && after.rows[0]?.values[0]?.value === 1, JSON.stringify({ before, after }));
}

// A12：已登記功能被刪欄或刪 retired 時，不能再維持啟用。
{
  const DIR = dirs('a12'), decl = { ...declaration(), tables: [{ ...declaration().tables[0], fields: [...declaration().tables[0].fields, { id: 'f3', label: '保留欄', type: 'text' }], retired: ['s9'] }] };
  store.createExtension(PROTO, DIR, '訂單', decl); store.registerExtension(DIR, '訂單', decl);
  const changed = JSON.parse(JSON.stringify(decl)); changed.tables[0].fields.pop(); changed.tables[0].retired = [];
  json(path.join(ext.extensionsDir(PROTO, DIR), '訂單', 'extension.json'), changed);
  const listed = store.listExtensions(PROTO, DIR)[0], revision = store.revisionCheck(PROTO, DIR, '訂單', changed);
  check('A12 修訂以已登記宣告比較並標為 bad', listed.state === 'bad' && revision.ok && !revision.checked.ok, JSON.stringify({ state: listed.state, revision: revision.checked }));
}

// A13：修改金額後的收據結果必須顯示實際入帳金額。
{
  const start = runSource.indexOf("    if (q.kind === 'money') {", runSource.indexOf('function handleEventConfirm'));
  const end = runSource.indexOf('    const opts = q.options', start);
  const said = [], context = vm.createContext({ questions: [{ kind: 'money', money: { amountCents: 10000, currency: 'HKD' } }], a: { value: ask.NAMES.ui.mnyConfirmEdit, edit: { amount: '250.00' } }, said, U: ask.NAMES.ui, NAMES: ask.NAMES, formatMoney: money.formatMoney, toCents: money.toCents, Number, Object });
  vm.runInContext(`for (const q of questions) {${runSource.slice(start, end)}}`, context);
  check('A13 修改後收據顯示實際入帳額', said[0]?.includes('HK$250'), String(said[0]));
}

// A14：網店類別不可覆蓋已辨識的銀行存入／支出欄。
{
  const DIR = dirs('a14'), s = server(DIR), fixture = path.resolve(PROTO, '..', '..', 'tests', 'prototype', 'fixtures', 'csv', 'bank.csv');
  json(path.join(DIR.ledger, 'money.json'), baseMoney([]));
  const upload = s.receiveMoney({ action: 'importUpload', kind: 'shop', name: 'bank.csv', data: fs.readFileSync(fixture).toString('base64') });
  const batch = upload.ok ? moneyStore.readImportBatch(DIR, upload.id).batch : null;
  check('A14 網店類別保留銀行存入／支出方向', upload.ok && batch?.map?.dirMode === 'twoCols' && batch.rows.length === 3 && batch.rows[0]?.draft?.dir === 'in' && batch.rows.slice(1).every(row => row.draft?.dir === 'out') && batch.rows.every(row => row.status === 'ok'), JSON.stringify(batch?.rows));
}

// A15：重試沿用舊收件單；其他收件單寫入失敗必須回可處理的錯誤。
{
  const DIR = dirs('a15'), old = new Date(Date.now() - 11 * 60000).toISOString();
  const makeDraft = (id, state) => store.createDraft(DIR, { id, state, from: 'sentence', ask: '起草測試', base: {}, baseRev: 0, sample: [], edits: { forRev: 0 }, revise: '', folder: '', sourceHash: '', error: '' }, { now: old });
  const queuedId = 'x-2026-11-11-120000-333', blockedId = 'x-2026-11-11-120000-334';
  const queuedDraft = makeDraft(queuedId, 'drafting'), oldNote = path.join(DIR.inbox, `${queuedId}-note-ext-draft.md`), oldText = '已排隊的收件單\n';
  fs.writeFileSync(oldNote, oldText);
  let scheduled = 0;
  const s = server(DIR, { schedule: delay => { scheduled += delay; } });
  const queued = s.receiveExt({ action: 'draftRetry', id: queuedId });
  const blockedDraft = makeDraft(blockedId, 'failed'), blockedNote = path.join(DIR.inbox, `${blockedId}-note-ext-draft.md`), originalWrite = fs.writeFileSync;
  let blocked;
  fs.writeFileSync = function(file, ...args) {
    if (String(file) === blockedNote) { const error = new Error('denied'); error.code = 'EACCES'; throw error; }
    return originalWrite.call(fs, file, ...args);
  };
  try { blocked = s.receiveExt({ action: 'draftRetry', id: blockedId }); }
  finally { fs.writeFileSync = originalWrite; }
  check('A15 重試沿用舊收件單並回報寫入失敗', queuedDraft.ok && queued.ok && scheduled === 200 && fs.readFileSync(oldNote, 'utf8') === oldText && store.readDraft(DIR, queuedId)?.state === 'drafting' && blockedDraft.ok && blocked?.error === 'busy' && blocked.message === ask.NAMES.ui.founderOpBusy, JSON.stringify({ queued, blocked }));
}

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`${passed}/${results.length} 通過`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
if (passed !== results.length) process.exitCode = 1;
