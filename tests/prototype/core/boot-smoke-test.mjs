// 啟動煙霧測試：真正把伺服器跑起來，每個讀取端點、/api/money 及 /api/ext 每個動作各發一次空白內容及一次最小合格內容，
// /api/submit 發一份含收據題及普通題的答案；斷言沒有 500 以上的回應，伺服器輸出沒有 ReferenceError、TypeError、is not defined。
// 動作名單寫成表，並讀 server.mjs 原始碼核對每個 action === '…' 都在表內（漏了即不通過）；讀取端點同樣核對。
// 有 Chrome 時，各分頁在 1440 及 390 闊度各載入一次：主控台沒有錯誤、沒有被頁面安全設定擋下的資源。
// 起因：0.43.0 各線單元測試都沒有啟動伺服器，server.mjs 未定義的 plain、own 令收據入帳整條路回 500，而所有測試仍然通過。
// 用法：node boot-smoke-test.mjs <Chrome 路徑（可空白）> <輸出資料夾> <原型資料夾> <假 adapter> <port>
// 埠：<port> 伺服器，<port>+1 Chrome 除錯埠；都在 run-all 分配的 10 個埠之內。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_TEXT] = process.argv.slice(2);
if (!OUT || !PROTO || !ADAPTER || !PORT_TEXT) { console.log('FAIL 參數不足：需要 <Chrome 路徑> <輸出資料夾> <原型資料夾> <假 adapter> <port>'); console.log('0/1 通過'); process.exit(1); }
const PORT = Number(PORT_TEXT), BASE = 'http://127.0.0.1:' + PORT;
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const writeJSON = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const readJSON = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const b64 = text => Buffer.from(text).toString('base64');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLqXQAAAABJRU5ErkJggg==';
const TODAY = new Date().toLocaleDateString('sv-SE');
const SERVER_SOURCE = fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8');

/* ---------- 動作表：每個 action 一行；mode 'send' 發空白及最小合格內容，'blank' 只發空白內容（只會被拒、無副作用），'skip' 不發並寫明理由 ---------- */
const MONEY_ACTIONS = ['add', 'void', 'evidence', 'link', 'balance', 'goal', 'importUpload', 'importMap', 'importInclude', 'importCancel', 'importUndo', 'importConfirm'];
const EXT_ACTIONS = ['draftTemplate', 'draftSentence', 'draftEdit', 'draftRevise', 'draftRetry', 'draftCancel', 'enable', 'enablePending', 'modifyStart', 'apply', 'disable', 'enableAgain', 'row', 'archiveDone', 'handoff'];
const OTHER_ACTIONS = [
  ...['start', 'pickWho', 'pickModel', 'moreModels', 'setGoal', 'setCell', 'zeroCell', 'back', 'retry', 'submit'].map(action => ({ route: '/api/ideate', action, mode: 'blank' })),
  ...['edit', 'suggestion'].map(action => ({ route: '/api/canvas', action, mode: 'blank' })),
  { route: '/api/minutes', action: 'preflight', mode: 'send' },
  ...['speakers', 'draft', 'save', 'open', 'submit', 'revise'].map(action => ({ route: '/api/minutes', action, mode: 'blank' })),
  ...['start', 'undo', 'say', 'end'].map(action => ({ route: '/api/practice', action, mode: 'blank' })),
  { route: '/api/logo', action: 'remove', mode: 'blank' },
  ...['observe', 'rhythm', 'schedule', 'phone-close', 'phone-accept', 'phone-reject', 'revoke', 'openFolder', 'certify'].map(action => ({ route: '/api/setup', action, mode: 'blank' })),
  { route: '/api/setup', action: 'phone-open', mode: 'skip', reason: '會在區域網絡開額外監聽，煙霧測試不開。' },
  { route: '/api/setup', action: 'openDemo', mode: 'skip', reason: '會另開常駐的示範伺服器（可能落在 4380–4389），不可在測試內開。' },
  { route: '/api/setup', action: 'runNow', mode: 'skip', reason: '會即時開一次外殼工作程序，結果不定；由其他測試涵蓋。' },
  ...['advance', 'ai'].map(action => ({ route: '/api/sim', action, mode: 'skip', reason: '只限模擬實例（SOS_SIM），本測試實例不開模擬。' }))
];

/* ---------- 讀取端點表：blank 不帶參數；minimal 由 ids 產生（帶真實編號） ---------- */
const GET_ROUTES = [
  ['/api/health'], ['/api/probe', () => '?t=' + 'a'.repeat(36)], ['/api/minutes', ids => ids.minutes ? '?id=' + encodeURIComponent(ids.minutes) : ''],
  ['/api/intake'], ['/api/canvas'], ['/api/prefill'], ['/api/setup'], ['/api/status'], ['/api/dashboard', () => '?lite=1'], ['/api/money'],
  ['/api/money/import', ids => ids.batch ? '?id=' + encodeURIComponent(ids.batch) : ''], ['/api/ext'],
  ['/api/ext/rows', ids => ids.folder ? `?folder=${encodeURIComponent(ids.folder)}&table=t1` : ''], ['/api/shell'], ['/api/home', () => '?seen=1'],
  ['/api/input', () => '?id=in-receipt-1'], ['/api/input-file', () => '?id=in-receipt-1&n=0'], ['/api/source-file'], ['/api/asks'],
  ['/api/ask', ids => ids.pack ? '?id=' + encodeURIComponent(ids.pack) : ''], ['/api/log'], ['/api/practice'], ['/api/debate'], ['/api/debate/match'],
  ['/api/practice/scenario'], ['/api/practice/session'], ['/api/run'], ['/api/sim']
];
// 只接受 POST（或只在特定實例開）的端點：空白內容各發一次
const POST_ROUTES = ['/api/submit', '/api/retry', '/api/setup', '/api/intake', '/api/ideate', '/api/canvas', '/api/input-reread', '/api/asks/reopen', '/api/practice', '/api/logo', '/api/founder-op', '/api/source-url', '/api/celebrations/seen', '/api/sim', '/api/minutes', '/api/money', '/api/ext', '/api/tell', '/api/pass/open', '/api/pair'];

/* ---------- 原始碼核對：動作及端點都在表內 ---------- */
const actionsIn = text => [...new Set([...text.matchAll(/\baction\s*===\s*['"]([^'"]+)['"]/g)].map(m => m[1]))];
const bodyOf = name => { const at = SERVER_SOURCE.indexOf(`function ${name}(`); if (at < 0) return ''; const end = SERVER_SOURCE.indexOf('\nfunction ', at + 10); return SERVER_SOURCE.slice(at, end < 0 ? undefined : end); };
const moneyMissing = actionsIn(bodyOf('receiveMoney')).filter(action => !MONEY_ACTIONS.includes(action));
const extMissing = actionsIn(bodyOf('receiveExt')).filter(action => !EXT_ACTIONS.includes(action));
const tableActions = new Set([...MONEY_ACTIONS, ...EXT_ACTIONS, ...OTHER_ACTIONS.map(item => item.action)]);
const otherMissing = actionsIn(SERVER_SOURCE).filter(action => !tableActions.has(action));
ok('動作表核對：receiveMoney 每個 action 都在業績動作表', bodyOf('receiveMoney') && moneyMissing.length === 0, { missing: moneyMissing });
ok('動作表核對：receiveExt 每個 action 都在延伸功能動作表', bodyOf('receiveExt') && extMissing.length === 0, { missing: extMissing });
ok('動作表核對：server.mjs 其餘每個 action === \'…\' 都在表內', otherMissing.length === 0, { missing: otherMissing });
const routesInSource = [...new Set([...SERVER_SOURCE.matchAll(/\bp\s*===\s*'(\/api\/[^']+)'/g)].map(m => m[1]))];
const knownRoutes = new Set([...GET_ROUTES.map(item => item[0]), ...POST_ROUTES]);
const routeMissing = routesInSource.filter(route => !knownRoutes.has(route));
ok('端點表核對：server.mjs 每個 p === \'/api/…\' 都在讀取或寫入端點表', routesInSource.length > 0 && routeMissing.length === 0, { missing: routeMissing });

/* ---------- 準備資料：照 money-api-test 的做法（公司概覽已確認、名單一人、一份收據輸入），並以鎖令外殼一開始便離開 ---------- */
freshTestOut(OUT);
const DATA = path.join(OUT, 'data'), LEDGER = path.join(DATA, 'ledger');
seedCompany(DATA, PROTO);
const page = readJSON(path.join(DATA, 'company', 'page.json'));
writeJSON(path.join(LEDGER, 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(item => item.id), values: {}, edits: [] });
writeJSON(path.join(LEDGER, 'state.json'), {
  schemaVersion: 1, intake: { state: 'complete' }, tasks: [], events: [], milestones: [], interviews: { applied: {} },
  company: { name: '測試公司', initials: '測試', actors: [{ id: 'pc-1', name: '林小姐', label: '林小姐', kind: 'customer', aliases: [], status: 'active', fromMilestoneIds: [], addedAt: '2026-11-01' }] },
  inputs: [{ id: 'in-receipt-1', files: ['founder/inbox/receipt-1.png'], fileInfo: [{ file: 'founder/inbox/receipt-1.png' }] }]
});
fs.mkdirSync(path.join(DATA, 'founder', 'inbox'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'founder', 'inbox', 'receipt-1.png'), Buffer.from(PNG, 'base64'));
fs.writeFileSync(path.join(LEDGER, '.lock'), String(process.pid));
await certifyDirect(DATA, PROTO, ADAPTER);

const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let serverLog = '', serverExit = null;
server.stdout.on('data', chunk => { serverLog += chunk; });
server.stderr.on('data', chunk => { serverLog += chunk; });
server.on('exit', code => { serverExit = code; });

const calls = [];
async function call(method, route, body, { origin = true, label = '' } = {}) {
  const headers = body === undefined ? {} : { 'Content-Type': 'application/json', ...(origin ? { Origin: BASE } : {}) };
  let code = 0, json = null, error = '';
  try {
    const response = await fetch(BASE + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(60000) });
    code = response.status;
    const text = await response.text();
    try { json = JSON.parse(text); } catch { }
  } catch (e) { error = String(e && e.message || e); }
  calls.push({ method, route, label, code, error });
  return { code, json, error };
}
const under500 = r => r.code > 0 && r.code < 500;
const brief = r => ({ code: r.code, error: r.error, json: r.json && JSON.stringify(r.json).slice(0, 300) });
const money = body => call('POST', '/api/money', body, { label: 'money:' + (body.action || '') });
const ext = body => call('POST', '/api/ext', body, { label: 'ext:' + (body.action || '') });
// 最小合格內容：必須真的成功（expect），否則該動作的正常路徑根本沒有被走過
async function step(group, action, body, expect, send) {
  const blank = await send({ action });
  ok(`${group} ${action}：空白內容不回 500 以上`, under500(blank), brief(blank));
  if (!body) return null;
  const result = await send({ action, ...body });
  ok(`${group} ${action}：最小合格內容回 ${expect}`, result.code === expect, brief(result));
  return result;
}

let chrome = null;
const ids = {};
try {
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(2000) })).ok; } catch { } if (!up) await sleep(250); }
  ok('伺服器啟動', up, serverLog.slice(-800));
  if (!up) throw new Error('伺服器未起');
  await usePass(BASE);

  /* ---------- 讀取端點：先不帶參數各讀一次 ---------- */
  for (const [route] of GET_ROUTES) {
    const r = await call('GET', route, undefined, { label: 'get-blank' });
    ok(`GET ${route}：不帶參數不回 500 以上`, under500(r), brief(r));
  }

  /* ---------- 業績：每個動作空白一次、最小合格一次（按依賴次序串起來） ---------- */
  const addRes = await step('業績', 'add', { dir: 'in', amount: '1,280.50', currency: 'HKD', date: TODAY, payer: '林小姐', counterpartId: 'pc-1', category: 'sales', what: '咖啡豆', files: [{ name: '收據.png', data: PNG }] }, 202, money);
  const recordId = addRes?.json?.id || '';
  await step('業績', 'evidence', { id: recordId, files: [{ name: '補充收據.png', data: PNG }] }, 202, money);
  await step('業績', 'void', { id: recordId, reason: '重複記錄' }, 202, money);
  await step('業績', 'link', { payerKey: '林小姐', counterpartId: 'pc-1' }, 202, money);
  await step('業績', 'balance', { amount: '58,000', asOf: TODAY, currency: 'HKD' }, 202, money);
  await step('業績', 'goal', { metric: 'income', amount: '100,000', currency: 'HKD' }, 202, money);
  const shop = fs.readFileSync(path.join(FIXTURES, 'csv', 'shop.csv'));
  const upRes = await step('業績', 'importUpload', { name: 'shop.csv', data: shop.toString('base64'), kind: 'shop' }, 202, money);
  ids.batch = upRes?.json?.id || '';
  const batchView = (await call('GET', '/api/money/import?id=' + encodeURIComponent(ids.batch), undefined, { label: 'batch' })).json?.batch || {};
  await step('業績', 'importMap', { id: ids.batch, kind: 'shop', map: { fields: batchView.map?.fields || {}, dirMode: 'fixed', fixedDir: 'in', inCol: '', outCol: '' } }, 202, money);
  const afterMap = (await call('GET', '/api/money/import?id=' + encodeURIComponent(ids.batch), undefined, { label: 'batch' })).json?.batch || {};
  const okLine = (afterMap.rows || []).find(row => ['ok', 'dup'].includes(row.status));
  await step('業績', 'importInclude', { id: ids.batch, lines: okLine ? { [String(okLine.line)]: true } : {} }, 202, money);
  await step('業績', 'importConfirm', { id: ids.batch }, 202, money);
  await step('業績', 'importUndo', { id: ids.batch }, 202, money);
  const cancelUp = await money({ action: 'importUpload', name: 'shop.csv', data: shop.toString('base64'), kind: 'shop' });
  await step('業績', 'importCancel', { id: cancelUp.json?.id || '' }, 202, money);

  /* ---------- 延伸功能：每個動作空白一次、最小合格一次 ---------- */
  const tplRes = await step('延伸功能', 'draftTemplate', { template: 'orders' }, 202, ext);
  const idA = tplRes?.json?.id || '';
  const sentenceRes = await step('延伸功能', 'draftSentence', { ask: '記錄每位學生的上課出席及剩餘堂數。' }, 202, ext);
  const idS = sentenceRes?.json?.id || '';
  await step('延伸功能', 'draftEdit', { id: idA, edits: { forRev: 1, labels: { f1: '訂單編號' } } }, 202, ext);
  const idB = (await ext({ action: 'draftTemplate', template: 'bookings' })).json?.id || '';
  await step('延伸功能', 'draftRevise', { id: idB, revise: '多加一欄備註。' }, 202, ext);
  // 重試只接受 failed（或逾時的 drafting）草稿：模擬外殼已取走收件單並把草稿標為 failed（只改本測試自己的資料夾）
  const draftFile = path.join(LEDGER, 'extensions', idS + '.json'), draftS = readJSON(draftFile);
  if (draftS) writeJSON(draftFile, { ...draftS, state: 'failed', error: '測試：起草失敗' });
  fs.rmSync(path.join(DATA, 'founder', 'inbox', idS + '-note-ext-draft.md'), { force: true });
  await step('延伸功能', 'draftRetry', { id: idS }, 202, ext);
  await step('延伸功能', 'draftCancel', { id: idB }, 202, ext);
  const enableRes = await step('延伸功能', 'enable', { id: idA, name: '訂單生產進度' }, 202, ext);
  ids.folder = enableRes?.json?.folder || '';
  const rowAdd = await step('延伸功能', 'row', { folder: ids.folder, table: 't1', op: 'add', v: { f1: '訂單甲', f4: '2026-11-20', f5: 's1' } }, 202, ext);
  const row = rowAdd?.json?.row || {};
  const toLast = await ext({ action: 'row', folder: ids.folder, table: 't1', op: 'update', id: row.id, rev: row.rev, v: { f5: 's5' } });
  ok('延伸功能 row：更新到最後工序回 202', toLast.code === 202, brief(toLast));
  await step('延伸功能', 'handoff', { folder: ids.folder, table: 't1', id: row.id, rev: toLast.json?.row?.rev, text: '訂單甲已出貨。' }, 202, ext);
  await step('延伸功能', 'archiveDone', { folder: ids.folder, table: 't1' }, 202, ext);
  const template = readJSON(path.join(PROTO, 'fixtures', 'ext-templates', 'bookings.json'));
  writeJSON(path.join(DATA, '延伸功能', '預約紀錄', 'extension.json'), { ...(template?.decl || {}), name: '預約紀錄' });
  fs.mkdirSync(path.join(DATA, '延伸功能', '預約紀錄', 'data'), { recursive: true });
  await step('延伸功能', 'enablePending', { folder: '預約紀錄' }, 202, ext);
  await step('延伸功能', 'disable', { folder: '預約紀錄' }, 202, ext);
  await step('延伸功能', 'enableAgain', { folder: '預約紀錄' }, 202, ext);
  const modify = await step('延伸功能', 'modifyStart', { folder: ids.folder }, 202, ext);
  await step('延伸功能', 'apply', { id: modify?.json?.id || '' }, 202, ext);

  /* ---------- 題目答案：一份含收據題及普通題的答案 ---------- */
  const { fnv, packHash } = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
  const receiptId = 'mn-2026-11-07-143005-123';
  const pack = { id: 'ask-smoke', open: true, title: '收據及一般問題', askedBy: 'Zero', askedAt: '2026-11-11T10:00:00+08:00', questions: [
    { id: 'q-money', kind: 'money', ask: '工房乙發票：咖啡豆 HK$2,350', why: '核對收據。', money: { id: receiptId, dir: 'out', amountCents: 235000, currency: 'HKD', date: '2026-11-07', payer: '工房乙', payerKey: '工房乙', counterpartId: '', category: 'goods', what: '咖啡豆 3 公斤', refund: false, evidence: [{ inputId: 'in-receipt-1', file: 'receipt-1.png', page: 1 }], check: 'image' },
      options: [{ text: '確認入帳' }, { text: '修改後入帳' }, { text: '不入帳' }] },
    { id: 'q-plain', ask: '先推廣哪類客戶？', options: [{ text: '咖啡店', rec: true }, { text: '辦公室' }], value: '咖啡店', why: '測試。' }
  ] };
  writeJSON(path.join(DATA, 'asks', pack.id + '.json'), pack);
  ids.pack = pack.id;
  const served = (await call('GET', '/api/ask?id=' + pack.id, undefined, { label: 'ask' })).json?.pack || pack;
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: '2026-11-11T10:05:00+08:00', batch: ['q-money', 'q-plain'], answers: [
    { id: 'q-money', value: '確認入帳', ai: '', changed: true },
    { id: 'q-plain', value: '辦公室', ai: '咖啡店', changed: true }
  ] };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + packHash(served), 'batch: false', 'shownAt: 2026-11-11T10:04:00+08:00'];
  const replyText = head.join('\n') + '\n\n# 答案：收據及一般問題\n\n- 工房乙發票：咖啡豆 HK$2,350\n  - 你：已入帳 HK$2,350.00\n- 先推廣哪類客戶？\n  - 你：辦公室\n\n## 機器讀取部分（供 CrewZero 使用，毋須查閱）\n```json\n' + JSON.stringify(machine, null, 2) + '\n```\n';
  const blankSubmit = await call('POST', '/api/submit', {}, { label: 'submit-blank' });
  ok('POST /api/submit：空白內容不回 500 以上', under500(blankSubmit), brief(blankSubmit));
  const submit = await call('POST', '/api/submit', { kind: 'ask-answer', ref: pack.id, text: replyText }, { label: 'submit' });
  ok('POST /api/submit：含收據題及普通題的答案回 200，收據寫入待合併檔', submit.code === 200 && fs.existsSync(path.join(LEDGER, 'money', 'pending', receiptId + '.json')), brief(submit));

  /* ---------- 其他端點的動作（空白內容；只會被拒，不開任何外部程序） ---------- */
  for (const item of OTHER_ACTIONS.filter(entry => entry.mode !== 'skip')) {
    const r = await call('POST', item.route, { action: item.action }, { label: 'other' });
    ok(`${item.route} ${item.action}：空白內容不回 500 以上`, under500(r), brief(r));
  }
  const pre = await call('POST', '/api/minutes', { action: 'preflight', files: [{ name: '會議.txt', data: b64(['00:00 Speaker 1', '大家早晨，今日先確認咖啡豆供應。', '00:08 Speaker 2', '我會在星期五前比較兩個報價。', '00:16 Speaker 1', '請你把結果和風險寫下來。',
    '00:24 Speaker 2', '我會連同交貨日期一併回覆。', '00:32 Speaker 1', '下星期再決定是否試行。', '00:40 Speaker 2', '好，我會先向兩間供應商查詢。'].join('\n')) }] }, { label: 'minutes' });
  ok('/api/minutes preflight：逐字稿最小合格內容回 200 並建登記', pre.code === 200 && pre.json?.transcript === true && !!pre.json?.id, brief(pre));
  ids.minutes = pre.json?.id || '';
  for (const item of OTHER_ACTIONS.filter(entry => entry.mode === 'skip')) console.log(`（不發送）${item.route} ${item.action}：${item.reason}`);

  /* ---------- 只接受 POST 的端點：空白內容 ---------- */
  for (const route of POST_ROUTES) {
    const noOrigin = route === '/api/tell' || route === '/api/pass/open';
    const r = await call('POST', route, {}, { origin: !noOrigin, label: 'post-blank' });
    ok(`POST ${route}：空白內容不回 500 以上`, under500(r), brief(r));
  }

  /* ---------- 讀取端點：帶真實編號再讀一次 ---------- */
  for (const [route, query] of GET_ROUTES.filter(item => item[1])) {
    const q = query(ids);
    if (!q) { ok(`GET ${route}：有可用編號作最小合格讀取`, false, ids); continue; }
    const r = await call('GET', route + q, undefined, { label: 'get-minimal' });
    ok(`GET ${route}${q.length > 40 ? '' : q}：帶參數不回 500 以上`, under500(r), brief(r));
  }
  // 頁面殼及共用檔
  const tabs = JSON.parse((/const DASH_TABS = (\[[^\]]*\])/.exec(SERVER_SOURCE) || [, '[]'])[1].replace(/'/g, '"'));
  const brainPages = JSON.parse((/const BRAIN_PAGES = (\[[^\]]*\])/.exec(SERVER_SOURCE) || [, '[]'])[1].replace(/'/g, '"'));
  const shared = JSON.parse((/const SHARED = (\[[^\]]*\])/.exec(SERVER_SOURCE) || [, '[]'])[1].replace(/'/g, '"'));
  const pagePaths = ['/', '/welcome', '/dashboard', ...tabs.map(tab => '/dashboard/' + tab), ...brainPages.map(name => '/dashboard/brain/' + name), '/proofread.html', '/ask.html', '/ext-style.css', '/company-page.js', ...shared.map(file => '/' + file)];
  ok('頁面名單由 server.mjs 讀到分頁及共用檔', tabs.length > 0 && shared.length > 0, { tabs, brainPages, shared });
  for (const route of pagePaths) {
    const r = await call('GET', route, undefined, { label: 'page' });
    ok(`GET ${route}：頁面或共用檔回 200 或轉址`, r.code === 200 || r.code === 302, brief(r));
  }

  /* ---------- 頁面：1440 及 390 闊度各載入一次 ---------- */
  if (!CHROME) {
    console.log('（未做）頁面載入：沒有 Chrome（run-all 加了 --no-browser 或本機找不到 Chrome）');
  } else {
    chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);
    await usePass(BASE, chrome);
    // 每頁開始前放入收集器：頁面安全設定擋下的資源、資源載入失敗、console.error、未處理的 Promise 拒絕、伺服器 500
    await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const L=window.__czErr=[];
addEventListener('securitypolicyviolation',e=>L.push('頁面安全設定擋下：'+e.violatedDirective+' '+e.blockedURI));
addEventListener('error',e=>{const t=e.target;if(t&&t!==window&&(t.src||t.href))L.push('資源載入失敗：'+(t.src||t.href));},true);
addEventListener('unhandledrejection',e=>L.push('未處理的 Promise 拒絕：'+String(e.reason&&e.reason.stack||e.reason).slice(0,300)));
const ce=console.error;console.error=function(...a){L.push('console.error：'+a.map(x=>String(x&&x.stack||x)).join(' ').slice(0,300));return ce.apply(this,a);};
const f=window.fetch;window.fetch=function(...a){return f.apply(this,a).then(r=>{if(r.status>=500)L.push('伺服器回 '+r.status+'：'+String(a[0]).slice(0,120));return r;});};})();` });
    const views = ['/', '/dashboard', ...tabs.map(tab => '/dashboard/' + tab), ...brainPages.map(name => '/dashboard/brain/' + name), '/#/ask/' + pack.id, '/proofread.html'];
    for (const width of [1440, 390]) {
      for (const view of views) {
        const before = chrome.errors.length;
        let problems = [];
        try {
          await chrome.go(BASE + view, width, 2200);
          problems = await chrome.ev('(window.__czErr||[]).slice()');
          const blank = await chrome.ev('(document.body&&document.body.innerText||"").trim().length');
          if (!blank) problems.push('頁面沒有任何文字');
        } catch (e) { problems.push('載入出錯：' + String(e && e.message || e).slice(0, 300)); }
        problems.push(...chrome.errors.slice(before).map(text => '腳本錯誤：' + String(text).slice(0, 300)));
        ok(`頁面 ${view}（${width}）：沒有腳本錯誤、沒有被擋下的資源`, problems.length === 0, problems.slice(0, 8));
      }
    }
  }
} catch (error) {
  ok('煙霧測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  // 伺服器仍然活着（中途沒有因未處理的錯誤而結束）
  ok('伺服器全程沒有中斷', serverExit === null, { serverExit, tail: serverLog.slice(-600) });
  server.kill();
  await sleep(300);
  const fatal = serverLog.split(/\r?\n/).filter(line => /ReferenceError|TypeError|is not defined/.test(line));
  ok('伺服器輸出沒有 ReferenceError、TypeError、is not defined', fatal.length === 0, fatal.slice(0, 10));
  const requestErrors = serverLog.split(/\r?\n/).filter(line => /請求出錯/.test(line));
  ok('伺服器輸出沒有「請求出錯」', requestErrors.length === 0, requestErrors.slice(0, 10));
  const over = calls.filter(item => item.code >= 500 || item.code === 0);
  ok(`全部 ${calls.length} 個請求沒有 500 以上的回應或連線失敗`, calls.length > 0 && over.length === 0, over.slice(0, 15));
  try { fs.writeFileSync(path.join(OUT, 'server-log.txt'), serverLog); fs.writeFileSync(path.join(OUT, 'calls.json'), JSON.stringify(calls, null, 1)); } catch { }
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + String(typeof result.info === 'string' ? result.info : JSON.stringify(result.info)).slice(0, 1500)));
  const passed = results.filter(result => result.pass).length;
  console.log(`\n${passed}/${results.length} 通過`);
  process.exit(passed === results.length ? 0 : 1);
}
