import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// 最後一輪甲線：匯入、收據、外殼及創辦人可見錯誤的回歸測試。
const [PROTO, outArg] = process.argv.slice(2);
if (!PROTO || !outArg) throw new Error('用法：node review-fix-c-test.mjs <原型資料夾> <輸出資料夾>');
const OUT = freshTestOut(outArg);
const TEMP = makeTestTemp('crewzero-review-fix-c-');
const load = name => import(pathToFileURL(path.join(PROTO, name)).href);
const money = await load('money-lib.mjs');
const moneyStore = await load('money-store.mjs');
const csv = await load('money-import.mjs');
const dash = await load('dash-lib.mjs');
const people = await load('people-ops.mjs');
const ask = await load('ask-lib.mjs');
// 0.44.0 起 server.mjs 由 limits.mjs 匯入 cleanFileName、B64、檔案上限等（附件上限改動）；vm 環境放入同一組真函數
const limits = await load('limits.mjs');
const serverSource = fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8');
const runSource = fs.readFileSync(path.join(PROTO, 'run.mjs'), 'utf8');
const askSource = fs.readFileSync(path.join(PROTO, 'ask.html'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8');
const eventGuide = fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8');
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cut = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`找不到測試片段：${start}`);
  return source.slice(from, to);
};
const baseMoney = records => ({ schema: 1, mainCurrency: '', records, importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null });
const receiptRecord = (id = 'mn-2026-11-11-120000-101') => ({
  id, dir: 'in', amountCents: 10000, currency: 'HKD', date: '2026-11-11', counterpartId: 'pc-old', payer: '原來客戶', payerKey: '原來客戶', category: 'sales', what: '測試收入', refund: false,
  evidence: [{ inputId: 'in-test', file: 'receipt.jpg', page: 1 }], source: 'receipt', importBatch: '', importKey: '', confirmedAt: '', confirmedBy: '', status: 'confirmed', voidedAt: '', voidReason: '', replaces: ''
});
function dirs(name) {
  const data = path.join(TEMP, name), DIR = { data, ledger: path.join(data, 'ledger'), inbox: path.join(data, 'inbox'), replies: path.join(data, 'replies'), company: path.join(data, 'company'), asks: path.join(data, 'asks'), answers: path.join(data, 'answers'), archive: path.join(data, 'archive') };
  for (const folder of Object.values(DIR)) fs.mkdirSync(folder, { recursive: true });
  return DIR;
}
function server(DIR, override = {}) {
  const context = vm.createContext({
    fs, path, crypto, process, Buffer, DIR, ROOT: PROTO, PORT: 4380, FOUNDER_OPS: path.join(DIR.ledger, 'founder-ops.json'), FOUNDER_OPS_LOCK: path.join(DIR.ledger, '.founder-ops.lock'), NAMES: ask.NAMES,
    localIso: () => '2026-11-11T12:00:00+00:00', readJSON: ask.readJSON, writeJSON: ask.writeJSON, fnv: ask.fnv, packHash: ask.packHash, readListStrict: ask.readListStrict, validateAskReply: ask.validateAskReply, parseFounderReply: ask.parseFounderReply,
    ...money, ...moneyStore, ...csv, ...people, ...limits,
    hasContactInfo: people.hasContactInfo, plain: value => !!value && typeof value === 'object' && !Array.isArray(value), own: (value, key) => Object.hasOwn(value || {}, key),
    schedule: () => {}, certInfo: () => ({ host: 'test' }), companyStatus: () => ({ confirmed: true }), receiveNote: async () => ({ ok: true }), isDemoInstance: () => false, say: () => {},
    ...override
  });
  vm.runInContext(cut(serverSource, 'const minutesNote =', 'const removeMinuteFiles'), context);
  vm.runInContext(cut(serverSource, 'function founderOpsLockCanRecover()', '// 更正公司概覽'), context);
  return context;
}

// M1：欄名來自 batch.map.headers；空白對應不可保存，舊空白對應不可套用。
{
  const DIR = dirs('m1'), s = server(DIR), source = 'Date,Amount,Customer,Order ID,Status,Fee\n2026-11-11,10.00,甲,A-1,paid,0.50\n';
  const mapId = money.mapIdFor(['Date', 'Amount', 'Customer', 'Order ID', 'Status', 'Fee']);
  write(path.join(DIR.ledger, 'money.json'), { ...baseMoney([]), importMaps: [{ id: mapId, fields: { date: '', amount: '', currency: '', payer: '', what: '', orderNo: '', status: '', fee: '' }, dirMode: 'sign', fixedDir: '', inCol: '', outCol: '' }] });
  const upload = s.receiveMoney({ action: 'importUpload', kind: 'shop', name: 'shop.csv', data: Buffer.from(source).toString('base64') });
  const before = upload.ok ? moneyStore.readImportBatch(DIR, upload.id).batch : null;
  const rejected = upload.ok ? s.receiveMoney({ action: 'importMap', id: upload.id, map: { fields: { date: '', amount: '', currency: '', payer: '', what: '', orderNo: '', status: '', fee: '' }, dirMode: 'sign', fixedDir: '', inCol: '', outCol: '' } }) : null;
  const after = upload.ok ? moneyStore.readImportBatch(DIR, upload.id).batch : null;
  check('M1 空白對應被拒，舊空白對應不套用', upload.ok && before?.map?.headers?.includes('Date') && before.map.fields.date === 'Date' && before.map.fields.orderNo === 'Order ID' && rejected?.error === 'invalid' && JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ upload, rejected }));
}

// M3：題目頁以與入帳端相同的格式讀取 HK$ 與逗號，失敗時顯示白話提示。
{
  const context = vm.createContext({ N: { ui: { ...ask.NAMES.ui } }, T: (text, values) => String(text).replace('{amount}', values.amount) });
  vm.runInContext(cut(askSource, '  function moneyValue', '  /* ---------- 伺服器重新開過'), context);
  const good = context.moneySummary({ money: { amountCents: 10000, currency: 'HKD' } }, { value: '修改後入帳', edit: { amount: 'HK$2,500.00' } });
  const bad = context.moneySummary({ money: { amountCents: 10000, currency: 'HKD' } }, { value: '修改後入帳', edit: { amount: 'HK$二百五十' } });
  check('M3 修改收據金額用 HK$ 格式解析，失敗不回退原金額', good.includes('HK$2,500.00') && bad === context.N.ui.mnyAmountInvalid, JSON.stringify({ good, bad }));
}

// M4：批次投影保留檔名，零筆批次在頁面層不列為可撤銷項目。
{
  const DIR = dirs('m4'), paths = moneyStore.moneyPaths(DIR), id = 'mb-2026-11-11-120000-111';
  write(path.join(paths.imports, `${id}.json`), { id, state: 'confirmed', createdAt: '2026-11-11T12:00:00Z', confirmedAt: '2026-11-11T12:01:00Z', file: { name: 'bank.csv' }, rows: [{ line: 2, include: true, status: 'ok', importKey: 'k', draft: { dir: 'in', amountCents: 1000, currency: 'HKD', date: '2026-11-11', payer: '甲', what: '收入', category: 'sales', refund: false } }] });
  const view = dash.moneyView(DIR, { today: '2026-11-11', full: true });
  check('M4 批次摘要帶原檔名及可入帳筆數', view.batches[0]?.file?.name === 'bank.csv' && view.batches[0]?.summary?.total === 1 && /summary\.total.*> 0/.test(dashboardSource), JSON.stringify(view.batches));
}

// M5：操作檔暫時不可寫時，撤銷不改批次並回 409 可處理的 busy。
{
  const DIR = dirs('m5'), id = 'mb-2026-11-11-120000-112', paths = moneyStore.moneyPaths(DIR);
  write(path.join(paths.imports, `${id}.json`), { id, state: 'confirmed', rows: [] });
  const blockedWrite = (file, value) => { if (path.resolve(file) === path.resolve(paths.founderOps)) { const error = new Error('locked'); error.code = 'EPERM'; throw error; } return ask.writeJSON(file, value); };
  const s = server(DIR, { writeJSON: blockedWrite });
  const result = s.receiveMoney({ action: 'importUndo', id });
  check('M5 撤銷操作檔被鎖回 busy 並保持批次', result.error === 'busy' && moneyStore.readImportBatch(DIR, id).batch?.state === 'confirmed', JSON.stringify(result));
}

// R15：在同一個受保護暫存實例直接執行外殼，仍可換入匯入紀錄與欄位對應。
{
  const data = path.join(TEMP, 'shell-merge'), DIR = { data, ledger: path.join(data, 'ledger'), inbox: path.join(data, 'founder', 'inbox'), replies: path.join(data, 'founder', 'replies'), company: path.join(data, 'company'), asks: path.join(data, 'asks'), archive: path.join(data, 'archive'), work: path.join(data, 'work'), sandbox: path.join(data, 'sandbox') }, paths = moneyStore.moneyPaths(DIR), id = 'mb-2026-11-11-120000-113';
  for (const folder of [...Object.values(DIR), paths.pending, paths.imports]) fs.mkdirSync(folder, { recursive: true });
  write(path.join(paths.ledger, 'state.json'), { schemaVersion: 1, company: { actors: [] }, events: [], tasks: [], milestones: [] });
  write(path.join(paths.imports, `${id}.json`), { schema: 1, id, state: 'confirmed', mapId: 'map-review-c', map: { fields: { date: 'Date', amount: 'Amount' }, dirMode: 'sign', fixedDir: '', inCol: '', outCol: '', headers: ['Date', 'Amount'] }, rows: [{ line: 2, status: 'ok', include: true, importKey: 'map-review-c|one', draft: { dir: 'in', amountCents: 1000, currency: 'HKD', date: '2026-11-11', payer: '甲', what: '收入', category: 'sales', refund: false } }], confirmedAt: '2026-11-11T12:00:00+00:00', undoneAt: '' });
  write(paths.founderOps, [{ id: 'fo-review-c', at: '2026-11-11T12:00:00+00:00', op: 'moneyImport', target: id, value: {} }]);
  const previousData = process.env.SOS_DATA;
  try {
    process.env.SOS_DATA = data;
    await import(pathToFileURL(path.join(PROTO, 'run.mjs')).href + `?review-fix-c=${Date.now()}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  } finally {
    if (previousData === undefined) delete process.env.SOS_DATA; else process.env.SOS_DATA = previousData;
  }
  const saved = fs.existsSync(paths.money) ? read(paths.money) : null;
  check('R15 外殼可在首次匯入時換入帳本及保留對應', saved?.records?.length === 1 && saved.importMaps?.[0]?.id === 'map-review-c', JSON.stringify(saved));
}

// CR2、CR3：同毫秒收據編號不撞號；缺貨幣與長合併說明會在預覽先正規化。
{
  const fixed = new Date('2026-11-11T12:00:00.000Z'), ids = [money.newMoneyId(fixed), money.newMoneyId(fixed)];
  const rows = [1, 2].map(line => ({ line, values: { Date: '2026-11-11', Amount: '10.00', Customer: '甲', What: '說明'.repeat(80), Order: 'A-1' } }));
  const drafts = csv.draftsFrom(rows, { fields: { date: 'Date', amount: 'Amount', currency: '', payer: 'Customer', what: 'What', orderNo: 'Order', status: '', fee: '' }, dirMode: 'fixed', fixedDir: 'in', inCol: '', outCol: '' }, { mainCurrency: 'HKD', kind: 'shop' });
  const DIR = dirs('cr3'), s = server(DIR), upload = s.receiveMoney({ action: 'importUpload', kind: 'shop', name: 'shop.csv', data: Buffer.from('Date,Amount,Customer,What,Order\n2026-11-11,10.00,甲,' + '說明'.repeat(80) + ',A-1\n').toString('base64') });
  const confirm = upload.ok ? s.receiveMoney({ action: 'importConfirm', id: upload.id }) : null;
  check('CR2、CR3 收據不撞號，匯入預覽與確認同樣接受預設 HKD 及截短說明', ids[0] !== ids[1] && drafts[0]?.draft?.currency === 'HKD' && Array.from(drafts[0]?.draft?.what || '').length <= 120 && upload?.ok && confirm?.ok, JSON.stringify({ ids, draft: drafts[0], confirm }));
}

// R1、G3、R16：改對方後不沿用舊名單連結；遲到答案與過期問題包均有指定回覆。
{
  const DIR = dirs('receipt'), s = server(DIR), rec = receiptRecord(), pack = { id: 'ask-r', questions: [{ id: 'q1', kind: 'money', money: rec }] };
  const reply = { head: { hash: ask.fnv(JSON.stringify(pack)) }, machine: { answers: [{ id: 'q1', value: ask.NAMES.ui.mnyConfirmEdit, edit: { amount: 'HK$250.00', date: '2026-11-11', category: 'sales', what: '更新收入', payer: '新客戶' } }] } };
  const first = s.receiptMoney(reply, pack), saved = read(path.join(moneyStore.moneyPaths(DIR).pending, `${rec.id}.json`)), second = s.receiptMoney(reply, pack), stale = s.receiptMoney({ ...reply, head: { hash: 'different' } }, pack);
  check('R1、G3、R16 收據改對方會斷開舊連結，遲到及過期回覆可識別', first.ok && saved.counterpartId === '' && saved.amountCents === 25000 && second.error === 'answered' && stale.error === 'stale', JSON.stringify({ first, second, stale, saved }));
}

// CR7、CR8、CR9a：修訂要求、逐收據文字核對及創辦人可見錯誤均使用指定安全邊界。
{
  const pass = runSource.includes("'# 原先要求'") && runSource.includes("'# 這次修改'") && runSource.includes('textByFile.get(file)') && runSource.includes('if (lenient) { log(`真實事件建議的業績項目已丟棄') && runSource.includes('NAMES.ui.extDraftCheckFailed') && serverSource.includes('NAMES.ui.extApplyCheckFailed') && /### 收據及入帳建議/.test(eventGuide) && /只有今次附件清楚載有/.test(eventGuide);
  check('CR7、CR8、CR9a 修訂、收據核對及錯誤訊息已收窄至創辦人可理解的邊界', pass, '檢查外殼、伺服器及 ai-event 的受保護文字路徑');
}

// M2、G6–G8、R2–R5、R11：其餘頁面與名單、CSV 邊界不可回退。
{
  const DIR = dirs('ui-boundary'), stateFile = path.join(DIR.ledger, 'state.json'), s = server(DIR);
  write(stateFile, { company: { actors: [{ id: 'pc-old', name: '重名客戶', kind: 'customer' }] } });
  const duplicate = s.newMoneyActor('重名客戶', 'customer', 'receipt-1');
  write(stateFile, { company: { actors: Array.from({ length: 80 }, (_, index) => ({ id: `pc-${index}`, name: `客戶${index}`, kind: 'customer' })) } });
  const capped = s.newMoneyActor('第八十一位', 'customer', 'receipt-2');
  const trailing = csv.parseCsv(Buffer.from('Date,Amount,\n2026-11-11,10.00,\n'));
  const invalid = csv.parseCsv(Buffer.from('Date,Amount\n"未完,10.00'));
  const usesKey = key => dashboardSource.includes(`N.ui['${key}']`) || dashboardSource.includes(`N.ui.${key}`);
  const pass = duplicate === null && capped === null && trailing.ok && trailing.headers.join(',') === 'Date,Amount' && invalid.error === 'csv'
    && dashboardSource.includes("headers = batch.headers || batch.map && batch.map.headers || []") && dashboardSource.includes('Object.assign({}, fields)')
    && usesKey('mnyImportNoNew') && usesKey('mnyImportSkip') && !dashboardSource.includes('mny-import-all')
    && usesKey('mnyVoidReasonRequired') && usesKey('mnyFieldPayer') && usesKey('mnyGoalMetric')
    && dashboardSource.includes("V.extMount.refresh()") && askSource.includes('P && P.realEvent') && runSource.includes('files: Array.isArray(input.files) ? input.files.map(String) : []')
    && serverSource.includes('NAMES.ui.mnyErrCsv');
  check('M2、G6–G8、R2–R5、R11 保留欄位、逐列、附件、CSV、名單及延伸頁邊界', pass, JSON.stringify({ duplicate, capped, trailing: trailing.headers, invalid: invalid.error }));
}

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`${passed}/${results.length} 通過`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
if (passed !== results.length) process.exitCode = 1;
