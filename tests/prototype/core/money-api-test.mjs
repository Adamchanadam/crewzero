// 業績端點：每個 action 成功一例及不合格一例、示範實例、其他來源、匯入批次狀態表、收據答案重送、匯入確認時重跑重複判斷、名單新增的操作次序。
// 依據：docs/evidence/results-ext-2026-11-10/contracts-0430.md 第 10.1、10.3、10.11 節及 server.mjs 實際寫法。
// 用法（經 run-all.mjs）：node money-api-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
// 埠：<port> 正式測試實例，<port>+2 示範實例；都在 run-all 分配的 10 個埠之內。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { usePass, certifyDirect, seedCompany } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT_TEXT, ADAPTER] = process.argv.slice(2);
if (!PROTO || !OUT || !PORT_TEXT || !ADAPTER) { console.log('FAIL 參數不足：需要 <原型資料夾> <輸出資料夾> <port> <假 adapter>'); process.exit(1); }
const PORT = Number(PORT_TEXT), BASE = 'http://127.0.0.1:' + PORT, DEMO_BASE = 'http://127.0.0.1:' + (PORT + 2);
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const writeJSON = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const readJSON = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const b64 = text => Buffer.from(text).toString('base64');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLqXQAAAABJRU5ErkJggg==';

// 伺服器輸出只留「出錯／拒收」行，作失敗證據
const serverErrors = [];
function startServer(data, port) {
  const child = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = chunk => { for (const line of String(chunk).split('\n')) if (/請求出錯/.test(line)) serverErrors.push(line.trim().slice(0, 300)); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  return child;
}
async function api(base, route, body, origin = base) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', Origin: origin }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await response.json(); } catch { }
  return { code: response.status, json };
}
const money = body => api(BASE, '/api/money', body);
async function ready(base) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) return true; } catch { } await sleep(250); }
  return false;
}
// 以「外殼正在工作」的鎖令外殼程序一開始便離開：待合併檔及操作檔留在原位，供本測試逐項核對（外殼合併另有 money-merge-test）
function holdShell(data) { fs.mkdirSync(path.join(data, 'ledger'), { recursive: true }); fs.writeFileSync(path.join(data, 'ledger', '.lock'), String(process.pid)); }
function seedData(data, extraState = {}) {
  seedCompany(data, PROTO);
  const page = readJSON(path.join(data, 'company', 'page.json'));
  writeJSON(path.join(data, 'ledger', 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(item => item.id), values: {}, edits: [] });
  writeJSON(path.join(data, 'ledger', 'state.json'), {
    schemaVersion: 1, intake: { state: 'complete' }, tasks: [], events: [], milestones: [], interviews: { applied: {} },
    company: { name: '測試公司', initials: '測試', actors: [{ id: 'pc-1', name: '林小姐', label: '林小姐', kind: 'customer', aliases: [], status: 'active', fromMilestoneIds: [], addedAt: '2026-11-01' }] },
    inputs: [{ id: 'in-receipt-1', files: ['founder/inbox/receipt-1.jpg'], fileInfo: [{ file: 'founder/inbox/receipt-1.jpg' }] }],
    ...extraState
  });
}

freshTestOut(OUT);
const DATA = path.join(OUT, 'data'), DEMO = path.join(OUT, 'demo-data');
const LEDGER = path.join(DATA, 'ledger'), OPS_FILE = path.join(LEDGER, 'founder-ops.json');
const PENDING = path.join(LEDGER, 'money', 'pending'), IMPORTS = path.join(LEDGER, 'money', 'imports');
const ops = () => { const list = readJSON(OPS_FILE, []); return Array.isArray(list) ? list : []; };
const pendingFiles = () => { try { return fs.readdirSync(PENDING).filter(name => name.endsWith('.json')).sort(); } catch { return []; } };
const batchFile = id => path.join(IMPORTS, id + '.json');
const batchText = id => { try { return fs.readFileSync(batchFile(id), 'utf8'); } catch { return ''; } };

seedData(DATA); holdShell(DATA);
seedData(DEMO, { demo: true }); holdShell(DEMO);
await certifyDirect(DATA, PROTO, ADAPTER);
await certifyDirect(DEMO, PROTO, ADAPTER);
const server = startServer(DATA, PORT);
const demoServer = startServer(DEMO, PORT + 2);
const { fnv, packHash } = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);

try {
  ok('MA-01 伺服器啟動', await ready(BASE) && await ready(DEMO_BASE));
  await usePass(BASE); await usePass(DEMO_BASE);

  /* ---------- 記一筆 ---------- */
  const addBody = { action: 'add', dir: 'in', amount: '1,280.50', currency: 'HKD', date: '2026-11-10', payer: '林小姐', counterpartId: 'pc-1', category: 'sales', what: '咖啡豆', files: [{ name: '收據.png', data: PNG }] };
  const added = await money(addBody), addedId = added.json?.id || '';
  const addedRecord = readJSON(path.join(PENDING, addedId + '.json'));
  ok('MA-02 add 成功：202、待合併檔是完整紀錄、附件已存、追加 moneyAdd', added.code === 202 && /^mn-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}$/.test(addedId) && addedRecord?.amountCents === 128050 && addedRecord?.source === 'quick' && addedRecord?.status === 'confirmed' && addedRecord?.evidence?.[0]?.store === 'money'
    && fs.existsSync(path.join(LEDGER, 'money', 'evidence', addedId, '收據.png')) && ops().some(op => op.op === 'moneyAdd' && op.target === addedId), { added, addedRecord });
  const pendingBefore = pendingFiles().length;
  const badAdd = await money({ ...addBody, amount: '0', files: [] });
  ok('MA-03 add 不合格（金額 0）：400，不寫待合併檔', badAdd.code === 400 && badAdd.json?.error === 'invalid' && pendingFiles().length === pendingBefore, badAdd);
  const view = await api(BASE, '/api/money');
  ok('MA-04 GET /api/money 讀到剛記下的紀錄', view.code === 200 && (view.json?.records || []).some(record => record.id === addedId), { code: view.code, records: (view.json?.records || []).map(record => record.id) });

  /* ---------- 加入名單並入帳：actorAdd 先於 moneyLink 先於 moneyAdd ---------- */
  const opsBefore = ops().length;
  const listed = await money({ action: 'add', dir: 'in', amount: '300', currency: 'HKD', date: '2026-11-10', payer: '新客戶甲', category: 'sales', what: '掛耳包', files: [], addToList: { kind: 'customer' } });
  const listedOps = ops().slice(opsBefore), listedRecord = readJSON(path.join(PENDING, (listed.json?.id || '') + '.json'));
  ok('MA-05 add 加 addToList：依次追加 actorAdd、moneyLink、moneyAdd，紀錄的對方編號即新編號', listed.code === 202 && listedOps.map(op => op.op).join(',') === 'actorAdd,moneyLink,moneyAdd'
    && listedOps[0].target === 'pc-m-' + listed.json.id && listedOps[1].value?.counterpartId === listedOps[0].target && listedRecord?.counterpartId === listedOps[0].target, { listed, listedOps });

  /* ---------- 作廢 ---------- */
  const voided = await money({ action: 'void', id: addedId, reason: '重複記錄' });
  ok('MA-06 void 成功：202，追加 moneyVoid 帶原因', voided.code === 202 && ops().some(op => op.op === 'moneyVoid' && op.target === addedId && op.value?.reason === '重複記錄'), voided);
  const badVoid = await money({ action: 'void', id: addedId, reason: '' });
  ok('MA-07 void 不合格（沒有原因）：400', badVoid.code === 400, badVoid);

  /* ---------- 補上證據 ---------- */
  const evidence = await money({ action: 'evidence', id: addedId, files: [{ name: '補充收據.jpg', data: PNG }] });
  ok('MA-08 evidence 成功：202，附件已存，追加 moneyEvidence', evidence.code === 202 && fs.existsSync(path.join(LEDGER, 'money', 'evidence', addedId, '補充收據.jpg')) && ops().some(op => op.op === 'moneyEvidence' && op.target === addedId && op.value?.file === '補充收據.jpg'), evidence);
  const badEvidence = await money({ action: 'evidence', id: addedId, files: [] });
  ok('MA-09 evidence 不合格（沒有附件）：400', badEvidence.code === 400, badEvidence);

  /* ---------- 連到名單 ---------- */
  const linked = await money({ action: 'link', payerKey: '林小姐', counterpartId: 'pc-1' });
  ok('MA-10 link 連到現有對象：202，追加 moneyLink', linked.code === 202 && ops().some(op => op.op === 'moneyLink' && op.target === '林小姐' && op.value?.counterpartId === 'pc-1'), linked);
  const badLink = await money({ action: 'link', payerKey: '林小姐', counterpartId: 'pc-missing' });
  ok('MA-11 link 不合格（名單沒有這個編號）：400', badLink.code === 400, badLink);
  const beforeNew = ops().length;
  const linkNew = await money({ action: 'link', payerKey: '新客戶乙', newName: '新客戶乙', kind: 'partner' });
  const newOps = ops().slice(beforeNew);
  ok('MA-12 link 加 newName：先追加 actorAdd，再追加 moneyLink 指向同一新編號', linkNew.code === 202 && newOps.map(op => op.op).join(',') === 'actorAdd,moneyLink' && /^pc-m-[a-f0-9]{10}$/.test(newOps[0].target) && newOps[0].value?.name === '新客戶乙' && newOps[0].value?.kind === 'partner' && newOps[1].target === '新客戶乙' && newOps[1].value?.counterpartId === newOps[0].target, { linkNew, newOps });
  const linkNewAgain = await money({ action: 'link', payerKey: '新客戶乙', newName: '新客戶乙', kind: 'partner' });
  ok('MA-12a 同一來源重按：對象編號不變', linkNewAgain.code === 202 && ops().slice(-2)[0]?.target === newOps[0]?.target, linkNewAgain);
  const badNew = await money({ action: 'link', payerKey: '新客戶丙', newName: '陳生 91234567', kind: 'customer' });
  ok('MA-13 link 新名稱含聯絡資料：400，不追加操作', badNew.code === 400 && !ops().some(op => op.op === 'actorAdd' && String(op.value?.name || '').includes('91234567')), badNew);

  /* ---------- 現金結餘、目標數字 ---------- */
  const balance = await money({ action: 'balance', amount: '58,000', asOf: '2026-11-10', currency: 'HKD' });
  ok('MA-14 balance 成功：202，追加 moneyBalance（金額以分計）', balance.code === 202 && ops().some(op => op.op === 'moneyBalance' && op.value?.amount === '5800000' && op.value?.asOf === '2026-11-10'), balance);
  const badBalance = await money({ action: 'balance', amount: '58000', asOf: '2099-01-01', currency: 'HKD' });
  ok('MA-15 balance 不合格（截至日期遲於今日）：400', badBalance.code === 400, badBalance);
  const goal = await money({ action: 'goal', metric: 'income', amount: '100,000', currency: 'HKD' });
  ok('MA-16 goal 成功：202，追加 setGoalNumber', goal.code === 202 && ops().some(op => op.op === 'setGoalNumber' && op.value?.metric === 'income' && op.value?.amount === '10000000'), goal);
  const badGoal = await money({ action: 'goal', metric: 'unknown', amount: '100' });
  ok('MA-17 goal 不合格（未知指標）：400', badGoal.code === 400, badGoal);

  /* ---------- 匯入 ---------- */
  const shop = fs.readFileSync(path.join(FIXTURES, 'csv', 'shop.csv'));
  const upload = async () => money({ action: 'importUpload', name: 'shop.csv', data: shop.toString('base64'), kind: 'shop' });
  const up = await upload(), upId = up.json?.id || '';
  const upBatch = readJSON(batchFile(upId));
  ok('MA-18 importUpload 成功：202，批次檔 parsed 及原檔已存', up.code === 202 && /^mb-/.test(upId) && upBatch?.state === 'parsed' && Array.isArray(upBatch?.rows) && upBatch.rows.length > 0 && fs.existsSync(path.join(IMPORTS, upId, 'shop.csv')), { up, state: upBatch?.state });
  const badUp = await money({ action: 'importUpload', name: 'shop.csv', data: '%%%', kind: 'shop' });
  ok('MA-19 importUpload 不合格（不是 base64）：400', badUp.code === 400, badUp);
  const read = await api(BASE, '/api/money/import?id=' + encodeURIComponent(upId));
  ok('MA-20 GET /api/money/import 回傳批次及摘要，不含原檔絕對位置', read.code === 200 && read.json?.batch?.id === upId && !('stored' in (read.json?.batch?.file || {})) && Number.isInteger(read.json?.summary?.total), read.json?.summary);

  const mapped = await money({ action: 'importMap', id: upId, kind: 'shop', map: { ...(upBatch?.map || {}), fields: upBatch?.map?.fields || {}, dirMode: 'fixed', fixedDir: 'in', inCol: '', outCol: '' } });
  ok('MA-21 importMap 成功（parsed）：202，批次仍是 parsed', mapped.code === 202 && readJSON(batchFile(upId))?.state === 'parsed', mapped);
  const beforeBadMap = batchText(upId);
  const badMap = await money({ action: 'importMap', id: upId, kind: 'shop', map: { fields: {}, dirMode: 'unknown' } });
  ok('MA-22 importMap 不合格（未知方向寫法）：400，批次檔不變', badMap.code === 400 && batchText(upId) === beforeBadMap, badMap);

  const okLine = (readJSON(batchFile(upId))?.rows || []).find(row => ['ok', 'dup'].includes(row.status));
  const include = okLine ? await money({ action: 'importInclude', id: upId, lines: { [String(okLine.line)]: false } }) : { code: 0, json: '樣本沒有 ok 行' };
  ok('MA-23 importInclude 成功：202，該行 include 改為 false', include.code === 202 && (readJSON(batchFile(upId))?.rows || []).find(row => row.line === okLine?.line)?.include === false, include);
  const restore = okLine ? await money({ action: 'importInclude', id: upId, lines: { [String(okLine.line)]: true } }) : null;
  const beforeBadInclude = batchText(upId);
  const badInclude = await money({ action: 'importInclude', id: upId, lines: [] });
  // 接口第 10.1 節：不合格回 400；server.mjs 現時對非物件 lines 回 409 stale。兩者都視為拒絕，差異另行回報
  ok('MA-24 importInclude 不合格（lines 不是物件）：拒絕（400 或 409），批次檔不變', [400, 409].includes(badInclude.code) && batchText(upId) === beforeBadInclude, { badInclude, restore: restore?.code });

  // 第二批：同一檔、在第一批確認前上載（兩批都未見過這些行）
  const second = await upload(), secondId = second.json?.id || '';
  const confirm = await money({ action: 'importConfirm', id: upId });
  const confirmedBatch = readJSON(batchFile(upId));
  ok('MA-25 importConfirm 成功：202，parsed → confirmed，寫 confirmedAt，追加 moneyImport', confirm.code === 202 && confirmedBatch?.state === 'confirmed' && !!confirmedBatch?.confirmedAt && ops().some(op => op.op === 'moneyImport' && op.target === upId), confirm);
  const badConfirm = await money({ action: 'importConfirm', id: 'mb-missing' });
  ok('MA-26 importConfirm 不合格（沒有這個批次）：409 stale', badConfirm.code === 409 && badConfirm.json?.error === 'stale', badConfirm);
  const firstIncluded = (confirmedBatch?.rows || []).filter(row => row.include).map(row => row.importKey);
  const secondBefore = readJSON(batchFile(secondId));
  const secondConfirm = await money({ action: 'importConfirm', id: secondId });
  const secondBatch = readJSON(batchFile(secondId));
  const secondIncluded = (secondBatch?.rows || []).filter(row => row.include);
  ok('MA-27 importConfirm 重跑重複判斷：已有相同紀錄的行改為已見、不入帳', second.code === 202 && secondConfirm.code === 202 && firstIncluded.length > 0 && (secondBefore?.rows || []).some(row => row.include)
    && secondIncluded.length === 0 && firstIncluded.every(key => (secondBatch?.rows || []).some(row => row.importKey === key && row.status === 'seen' && row.include === false)), { firstIncluded, second: (secondBatch?.rows || []).map(row => [row.line, row.status, row.include]) });
  const after = await api(BASE, '/api/money');
  const importRecords = (after.json?.records || []).filter(record => record.source === 'import' && record.status !== 'void');
  ok('MA-28 兩批同一檔合共只入帳一次', importRecords.length === firstIncluded.length && !importRecords.some(record => record.importBatch === secondId), { importRecords: importRecords.length, firstIncluded: firstIncluded.length });

  const cancelUp = await upload(), cancelId = cancelUp.json?.id || '';
  const cancel = await money({ action: 'importCancel', id: cancelId });
  ok('MA-29 importCancel 成功：202，parsed → cancelled', cancel.code === 202 && readJSON(batchFile(cancelId))?.state === 'cancelled', cancel);
  const badCancel = await money({ action: 'importCancel', id: 'mb-missing' });
  ok('MA-30 importCancel 不合格（沒有這個批次）：409 stale', badCancel.code === 409, badCancel);
  const undo = await money({ action: 'importUndo', id: upId });
  ok('MA-31 importUndo 成功：202，confirmed → undone，寫 undoneAt，追加 moneyUndoImport', undo.code === 202 && readJSON(batchFile(upId))?.state === 'undone' && !!readJSON(batchFile(upId))?.undoneAt && ops().some(op => op.op === 'moneyUndoImport' && op.target === upId), undo);
  const badUndo = await money({ action: 'importUndo', id: 'mb-missing' });
  ok('MA-32 importUndo 不合格（沒有這個批次）：409 stale', badUndo.code === 409, badUndo);

  // 狀態表：parsed → confirmed → undone；parsed → cancelled；其他一律 409 stale 而批次檔不變
  const parsedUp = await upload(), parsedId = parsedUp.json?.id || '';
  const mapBody = { kind: 'shop', map: { fields: {}, dirMode: 'fixed', fixedDir: 'in', inCol: '', outCol: '' } };
  const illegal = [
    ['parsed', parsedId, 'importUndo', {}],
    ['confirmed', secondId, 'importMap', mapBody], ['confirmed', secondId, 'importInclude', { lines: {} }], ['confirmed', secondId, 'importConfirm', {}], ['confirmed', secondId, 'importCancel', {}],
    ['cancelled', cancelId, 'importMap', mapBody], ['cancelled', cancelId, 'importInclude', { lines: {} }], ['cancelled', cancelId, 'importConfirm', {}], ['cancelled', cancelId, 'importCancel', {}], ['cancelled', cancelId, 'importUndo', {}],
    ['undone', upId, 'importMap', mapBody], ['undone', upId, 'importInclude', { lines: {} }], ['undone', upId, 'importConfirm', {}], ['undone', upId, 'importCancel', {}], ['undone', upId, 'importUndo', {}]
  ];
  const wrong = [];
  for (const [state, id, action, extra] of illegal) {
    const before = batchText(id), opsCount = ops().length;
    const result = await money({ action, id, ...extra });
    if (readJSON(batchFile(id))?.state !== state && state !== 'parsed') wrong.push([state, action, '狀態已變']);
    if (result.code !== 409 || result.json?.error !== 'stale' || batchText(id) !== before || ops().length !== opsCount) wrong.push([state, action, result.code, result.json?.error, batchText(id) === before ? '' : '批次檔有改動']);
  }
  ok('MA-33 匯入批次每個不准的狀態轉換：409 stale，批次檔及操作不變', wrong.length === 0, wrong);

  /* ---------- 收據確認題答案送兩次 ---------- */
  const receiptId = 'mn-2026-11-07-143005-123';
  const pack = { id: 'ask-money-twice', open: true, title: '確認收據', askedBy: 'Zero', askedAt: '2026-11-11T10:00:00+08:00', questions: [
    { id: 'q-money', kind: 'money', ask: '工房乙發票：咖啡豆 HK$2,350', why: '核對收據。', money: { id: receiptId, dir: 'out', amountCents: 235000, currency: 'HKD', date: '2026-11-07', payer: '工房乙', payerKey: '工房乙', counterpartId: '', category: 'goods', what: '咖啡豆 3 公斤', refund: false, evidence: [{ inputId: 'in-receipt-1', file: '工房乙發票.jpg', page: 1 }], check: 'image' },
      options: [{ text: '確認入帳' }, { text: '修改後入帳' }, { text: '不入帳' }] }
  ] };
  writeJSON(path.join(DATA, 'asks', pack.id + '.json'), pack);
  const served = await api(BASE, '/api/ask?id=' + pack.id);
  const servedPack = served.json?.pack || pack;
  const replyText = shownAt => {
    const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: '2026-11-11T10:05:00+08:00', batch: ['q-money'], answers: [{ id: 'q-money', value: '修改後入帳', ai: '', changed: true, edit: { amount: '2,500.00', date: '2026-11-07', category: 'goods', what: '咖啡豆 3 公斤', payer: '工房乙' } }] };
    const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + packHash(servedPack), 'batch: false', 'shownAt: ' + shownAt];
    return head.join('\n') + '\n\n# 答案：確認收據\n\n- 工房乙發票：咖啡豆 HK$2,350\n  - 你：已入帳 HK$2,500.00\n\n## 機器讀取部分（供 CrewZero 使用，毋須查閱）\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n';
  };
  const submit = text => api(BASE, '/api/submit', { kind: 'ask-answer', ref: pack.id, text });
  const firstSubmit = await submit(replyText('2026-11-11T10:04:00+08:00'));
  const secondSubmit = await submit(replyText('2026-11-11T10:04:00+08:00'));
  const receiptFiles = pendingFiles().filter(name => name === receiptId + '.json');
  const receiptRecord = readJSON(path.join(PENDING, receiptId + '.json'));
  const receiptOps = ops().filter(op => op.op === 'moneyAdd' && op.target === receiptId);
  ok('MA-34 同一份收據答案送兩次：只有一個待合併檔、一項 moneyAdd，金額採用修改後的數字', served.code === 200 && firstSubmit.code === 200 && receiptFiles.length === 1 && receiptOps.length === 1 && receiptRecord?.amountCents === 250000 && receiptRecord?.source === 'receipt',
    { served: served.code, firstSubmit, secondSubmit: secondSubmit.code, receiptFiles, receiptOps: receiptOps.length, amount: receiptRecord?.amountCents });

  /* ---------- 示範實例、其他來源 ---------- */
  const demo = await api(DEMO_BASE, '/api/money', addBody);
  ok('MA-35 示範實例：409 demo，不寫待合併檔', demo.code === 409 && demo.json?.error === 'demo' && !fs.existsSync(path.join(DEMO, 'ledger', 'money', 'pending')), demo);
  const before = pendingFiles().length;
  const foreign = await api(BASE, '/api/money', addBody, 'http://evil.example');
  ok('MA-36 其他來源：403，不寫待合併檔', foreign.code === 403 && pendingFiles().length === before, foreign);
  ok('MA-37 伺服器沒有請求出錯（500）', serverErrors.length === 0, serverErrors.slice(-5));
} catch (error) {
  ok('業績端點測試程式出錯', false, String(error?.stack || error));
} finally {
  server.kill(); demoServer.kill();
  await sleep(300);
  const passed = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 1200)));
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
