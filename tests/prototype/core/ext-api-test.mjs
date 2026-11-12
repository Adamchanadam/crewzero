// 延伸功能端點：範本草稿 → 校對改動 → 啟用 → 資料行 → 封存已完成 → 交給 Zero；另核對資料夾名稱、連結資料夾、示範實例及其他來源。
// 依據：docs/evidence/results-ext-2026-11-10/contracts-0430.md 第 10.6、10.11 節及 server.mjs 實際寫法。
// 用法（經 run-all.mjs）：node ext-api-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
// 埠：<port> 正式測試實例，<port>+2 示範實例；都在 run-all 分配的 10 個埠之內。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { freshTestOut } from '../lib/out-guard.mjs';
import { usePass, certifyDirect, seedCompany } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT_TEXT, ADAPTER] = process.argv.slice(2);
if (!PROTO || !OUT || !PORT_TEXT || !ADAPTER) { console.log('FAIL 參數不足：需要 <原型資料夾> <輸出資料夾> <port> <假 adapter>'); process.exit(1); }
const PORT = Number(PORT_TEXT), BASE = 'http://127.0.0.1:' + PORT, DEMO_BASE = 'http://127.0.0.1:' + (PORT + 2);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const writeJSON = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const readJSON = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

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
const ext = body => api(BASE, '/api/ext', body);
async function ready(base) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) return true; } catch { } await sleep(250); }
  return false;
}
// 以「外殼正在工作」的鎖令外殼程序一開始便離開，草稿及收件單留在原位供核對（外殼處理另有 ext-draft-test）
function holdShell(data) { fs.mkdirSync(path.join(data, 'ledger'), { recursive: true }); fs.writeFileSync(path.join(data, 'ledger', '.lock'), String(process.pid)); }
function seedData(data, extraState = {}) {
  seedCompany(data, PROTO);
  writeJSON(path.join(data, 'ledger', 'state.json'), { schemaVersion: 1, intake: { state: 'complete' }, company: { name: '測試公司', initials: '測試', actors: [] }, tasks: [], events: [], inputs: [], milestones: [], interviews: { applied: {} }, ...extraState });
}
const confirmOverview = data => {
  const page = readJSON(path.join(data, 'company', 'page.json'));
  writeJSON(path.join(data, 'ledger', 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(item => item.id), values: {}, edits: [] });
};

freshTestOut(OUT);
const DATA = path.join(OUT, 'data'), DEMO = path.join(OUT, 'demo-data');
const EXT_ROOT = path.join(DATA, '延伸功能'), DRAFTS = path.join(DATA, 'ledger', 'extensions');
const OPS_FILE = path.join(DATA, 'ledger', 'founder-ops.json');
const draftFile = id => path.join(DRAFTS, id + '.json');
const folders = () => { try { return fs.readdirSync(EXT_ROOT, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort(); } catch { return []; } };
const ops = () => { const list = readJSON(OPS_FILE, []); return Array.isArray(list) ? list : []; };
const registry = () => readJSON(path.join(DRAFTS, 'index.json'), { items: [] })?.items || [];
const template = readJSON(path.join(PROTO, 'fixtures', 'ext-templates', 'orders.json'));

seedData(DATA); holdShell(DATA);
seedData(DEMO, { demo: true }); holdShell(DEMO);
await certifyDirect(DATA, PROTO, ADAPTER);
await certifyDirect(DEMO, PROTO, ADAPTER);
const server = startServer(DATA, PORT);
const demoServer = startServer(DEMO, PORT + 2);
let linkPath = '';

try {
  ok('EA-01 伺服器啟動', await ready(BASE) && await ready(DEMO_BASE));
  await usePass(BASE); await usePass(DEMO_BASE);
  const first = await api(BASE, '/api/ext');
  ok('EA-02 GET /api/ext：三個範本、未有功能、AI 已設定', first.code === 200 && (first.json?.templates || []).map(item => item.id).join(',') === 'orders,bookings,stock' && (first.json?.items || []).length === 0 && first.json?.aiReady === true, first.json?.templates);

  /* ---------- 範本草稿 ---------- */
  const draftA = await ext({ action: 'draftTemplate', template: 'orders' }), idA = draftA.json?.id || '';
  const savedA = readJSON(draftFile(idA));
  ok('EA-03 draftTemplate 成功：202，草稿 ready、baseRev 1、附樣本', draftA.code === 202 && savedA?.state === 'ready' && savedA?.baseRev === 1 && Array.isArray(savedA?.sample) && savedA.sample.length > 0 && savedA?.base?.name === template?.decl?.name, { draftA, state: savedA?.state });
  const badTemplate = await ext({ action: 'draftTemplate', template: 'unknown' });
  ok('EA-04 draftTemplate 不合格（未知範本）：400', badTemplate.code === 400, badTemplate);

  /* ---------- 由一句話起草 ---------- */
  const sentence = await ext({ action: 'draftSentence', ask: '記錄每位學生的上課出席及剩餘堂數。' }), idS = sentence.json?.id || '';
  const inbox = fs.readdirSync(path.join(DATA, 'founder', 'inbox')).filter(name => name.includes('note-ext-draft'));
  ok('EA-05 draftSentence 成功：202，草稿 drafting，寫 ext-draft 收件單', sentence.code === 202 && readJSON(draftFile(idS))?.state === 'drafting' && inbox.length === 1, { sentence, inbox });
  const badSentence = await ext({ action: 'draftSentence', ask: '' });
  ok('EA-06 draftSentence 不合格（空白）：400', badSentence.code === 400, badSentence);
  const cancelS = await ext({ action: 'draftCancel', id: idS });
  ok('EA-07 draftCancel 成功：202，草稿 cancelled', cancelS.code === 202 && readJSON(draftFile(idS))?.state === 'cancelled', cancelS);

  /* ---------- 校對改動：只限 ready；forRev 必須等於 baseRev ---------- */
  const edits = { forRev: 1, labels: { f1: '訂單編號' }, fieldOrder: ['f2', 'f1', 'f3', 'f4', 'f5', 'f6'], hidden: ['f3'] };
  const edit = await ext({ action: 'draftEdit', id: idA, edits });
  const preview = (await api(BASE, '/api/ext')).json?.drafts?.find(item => item.id === idA)?.preview?.tables?.[0];
  ok('EA-08 draftEdit 成功（ready）：202，預覽套用改名、次序及隱藏', edit.code === 202 && JSON.stringify(readJSON(draftFile(idA))?.edits) === JSON.stringify(edits) && preview?.fields?.find(field => field.id === 'f1')?.label === '訂單編號' && preview?.fields?.[0]?.id === 'f2', { edit, fields: preview?.fields?.map(field => [field.id, field.label, !!field.hidden]) });
  const beforeStale = JSON.stringify(readJSON(draftFile(idA))?.edits);
  const staleEdit = await ext({ action: 'draftEdit', id: idA, edits: { ...edits, forRev: 99, labels: { f1: '舊版本改名' } } });
  ok('EA-09 draftEdit 的 forRev 不等於 baseRev：409 stale，草稿不變（接口第 10.6 節）', staleEdit.code === 409 && staleEdit.json?.error === 'stale' && JSON.stringify(readJSON(draftFile(idA))?.edits) === beforeStale, { staleEdit, edits: readJSON(draftFile(idA))?.edits });
  if (JSON.stringify(readJSON(draftFile(idA))?.edits) !== beforeStale) await ext({ action: 'draftEdit', id: idA, edits });
  const notReady = await ext({ action: 'draftEdit', id: idS, edits: { forRev: 0, labels: { f1: 'x' } } });
  ok('EA-10 draftEdit 於非 ready 草稿：409 stale', notReady.code === 409 && notReady.json?.error === 'stale', notReady);

  /* ---------- 啟用：重按不建第二個資料夾 ---------- */
  const enable = await ext({ action: 'enable', id: idA, name: '訂單生產進度' }), folderA = enable.json?.folder || '';
  const regA = registry().find(item => item.folder === folderA);
  const declA = readJSON(path.join(EXT_ROOT, folderA, 'extension.json'));
  ok('EA-11 enable 成功：202，建資料夾、extension.json（含校對改動）及空 data，登記 enabled，草稿 enabled，追加 extEnable',
    enable.code === 202 && folderA === '訂單生產進度' && declA?.tables?.[0]?.fields?.find(field => field.id === 'f1')?.label === '訂單編號' && fs.statSync(path.join(EXT_ROOT, folderA, 'data')).isDirectory()
    && regA?.state === 'enabled' && /^[a-f0-9]{64}$/.test(regA?.declHash || '') && readJSON(draftFile(idA))?.state === 'enabled' && readJSON(draftFile(idA))?.folder === folderA && ops().some(op => op.op === 'extEnable' && op.target === folderA), { enable, folders: folders(), reg: regA });
  const again = await ext({ action: 'enable', id: idA, name: '訂單生產進度' });
  ok('EA-12 enable 重按：409 stale，仍然只有一個資料夾', again.code === 409 && again.json?.error === 'stale' && folders().length === 1, { again, folders: folders() });
  // 上次啟用中途停下（草稿已記下資料夾名稱而仍是 ready）：再按沿用同一名稱，不另建
  const draftB = await ext({ action: 'draftTemplate', template: 'stock' }), idB = draftB.json?.id || '';
  const half = readJSON(draftFile(idB)); writeJSON(draftFile(idB), { ...half, folder: '存貨預留' });
  const resume = await ext({ action: 'enable', id: idB, name: '另一個名稱' });
  ok('EA-13 草稿已有資料夾名稱時 enable 沿用該名稱，不建第二個', resume.code === 202 && resume.json?.folder === '存貨預留' && folders().join(',') === ['存貨預留', '訂單生產進度'].sort().join(','), { resume, folders: folders() });
  const cancelled = await ext({ action: 'draftCancel', id: idA });
  ok('EA-14 draftCancel 於已啟用草稿：409 stale', cancelled.code === 409, cancelled);

  /* ---------- 資料行 ---------- */
  const add = await ext({ action: 'row', folder: folderA, table: 't1', op: 'add', v: { f1: '訂單甲', f4: '2026-11-20', f5: 's1' } }), row = add.json?.row;
  ok('EA-15 row add 成功：202，rev 1', add.code === 202 && row?.rev === 1 && row?.v?.f1 === '訂單甲', add);
  const badAdd = await ext({ action: 'row', folder: folderA, table: 't1', op: 'add', v: { f1: '欠交貨日' } });
  ok('EA-16 row add 不合格（缺必填欄）：400', badAdd.code === 400, badAdd);
  const update = await ext({ action: 'row', folder: folderA, table: 't1', op: 'update', id: row?.id, rev: 1, v: { f5: 's2' } });
  ok('EA-17 row update 成功：202，rev 2', update.code === 202 && update.json?.row?.rev === 2 && update.json?.row?.v?.f5 === 's2', update);
  const stale = await ext({ action: 'row', folder: folderA, table: 't1', op: 'update', id: row?.id, rev: 1, v: { f5: 's3' } });
  ok('EA-18 row update 的 rev 不符：409 stale，附最新一行', stale.code === 409 && stale.json?.error === 'stale' && stale.json?.row?.rev === 2 && stale.json?.row?.v?.f5 === 's2', stale);
  const rowsView = await api(BASE, `/api/ext/rows?folder=${encodeURIComponent(folderA)}&table=t1`);
  ok('EA-19 GET /api/ext/rows 讀到最新資料行', rowsView.code === 200 && rowsView.json?.rows?.length === 1 && rowsView.json.rows[0].rev === 2, rowsView.json);

  /* ---------- 封存已完成 ---------- */
  const add2 = await ext({ action: 'row', folder: folderA, table: 't1', op: 'add', v: { f1: '訂單乙', f4: '2026-11-21', f5: 's5' } });
  const archive = await ext({ action: 'archiveDone', folder: folderA, table: 't1' });
  const afterArchive = (await api(BASE, `/api/ext/rows?folder=${encodeURIComponent(folderA)}&table=t1`)).json?.rows || [];
  ok('EA-20 archiveDone 成功：只封存最後工序的行', add2.code === 202 && archive.code === 202 && archive.json?.changed === 1 && afterArchive.find(item => item.id === add2.json?.row?.id)?.archived === true && afterArchive.find(item => item.id === row?.id)?.archived === false, { archive, rows: afterArchive.map(item => [item.v?.f1, item.archived]) });
  const badArchive = await ext({ action: 'archiveDone', folder: '../' + folderA, table: 't1' });
  ok('EA-21 archiveDone 不合格（資料夾名稱帶 ..）：400', badArchive.code === 400, badArchive);

  /* ---------- 資料夾名稱帶 .. ---------- */
  const outside = path.join(OUT, '外面');
  const dotted = [
    ['row', { action: 'row', folder: '..', table: 't1', op: 'add', v: { f1: 'x', f4: '2026-11-20' } }],
    ['row', { action: 'row', folder: '../外面', table: 't1', op: 'add', v: { f1: 'x', f4: '2026-11-20' } }],
    ['modifyStart', { action: 'modifyStart', folder: '../' + folderA }],
    ['disable', { action: 'disable', folder: '..\\' + folderA }],
    ['enablePending', { action: 'enablePending', folder: '../bad' }]
  ];
  const dotResults = [];
  for (const [name, body] of dotted) { const result = await ext(body); dotResults.push([name, body.folder, result.code]); }
  ok('EA-22 資料夾名稱帶 .. 一律拒絕（400 或 409），不在延伸功能資料夾外寫檔', dotResults.every(([, , code]) => [400, 409].includes(code)) && !fs.existsSync(outside) && !fs.existsSync(path.join(DATA, 'data')), dotResults);

  /* ---------- 指向別處的連結資料夾 ---------- */
  const target = path.join(OUT, 'link-target');
  fs.mkdirSync(path.join(target, 'data'), { recursive: true });
  writeJSON(path.join(target, 'extension.json'), template.decl);
  linkPath = path.join(EXT_ROOT, '連結功能');
  let linked = false;
  try { fs.symlinkSync(target, linkPath, 'junction'); linked = true; } catch (error) { linked = String(error?.code || error); }
  const listed = (await api(BASE, '/api/ext')).json?.items || [];
  const linkPending = await ext({ action: 'enablePending', folder: '連結功能' });
  const linkRow = await ext({ action: 'row', folder: '連結功能', table: 't1', op: 'add', v: { f1: 'x', f4: '2026-11-20' } });
  const linkModify = await ext({ action: 'modifyStart', folder: '連結功能' });
  ok('EA-23 連結資料夾：不列出、不可啟用、不可寫資料行或修改', linked === true && !listed.some(item => item.folder === '連結功能') && [400, 409].includes(linkPending.code) && [400, 409].includes(linkRow.code) && [400, 409].includes(linkModify.code)
    && !fs.existsSync(path.join(target, 'data', 't1.json')) && !registry().some(item => item.folder === '連結功能'), { linked, listed: listed.map(item => item.folder), codes: [linkPending.code, linkRow.code, linkModify.code] });

  /* ---------- AI 自建、未登記的資料夾 ---------- */
  fs.mkdirSync(path.join(EXT_ROOT, '預約紀錄', 'data'), { recursive: true });
  writeJSON(path.join(EXT_ROOT, '預約紀錄', 'extension.json'), { ...template.decl, name: '預約紀錄' });
  const pendingItem = (await api(BASE, '/api/ext')).json?.items?.find(item => item.folder === '預約紀錄');
  const enablePending = await ext({ action: 'enablePending', folder: '預約紀錄' });
  ok('EA-24 enablePending 成功：pending → 登記 enabled', pendingItem?.state === 'pending' && enablePending.code === 202 && registry().find(item => item.folder === '預約紀錄')?.state === 'enabled', { pendingItem: pendingItem?.state, enablePending });
  const enablePendingAgain = await ext({ action: 'enablePending', folder: '預約紀錄' });
  ok('EA-25 enablePending 於已登記資料夾：409 stale', enablePendingAgain.code === 409, enablePendingAgain);

  /* ---------- 停用、再啟用 ---------- */
  const disable = await ext({ action: 'disable', folder: '預約紀錄' });
  const enableAgain = await ext({ action: 'enableAgain', folder: '預約紀錄' });
  ok('EA-26 disable／enableAgain 成功：只改登記', disable.code === 202 && enableAgain.code === 202 && registry().find(item => item.folder === '預約紀錄')?.state === 'enabled' && fs.existsSync(path.join(EXT_ROOT, '預約紀錄', 'extension.json')), { disable, enableAgain });

  /* ---------- 修改已啟用的功能 ---------- */
  const modify = await ext({ action: 'modifyStart', folder: folderA }), idM = modify.json?.id || '';
  const modifyEdit = await ext({ action: 'draftEdit', id: idM, edits: { forRev: 1, labels: { f6: '內部備註' } } });
  const apply = await ext({ action: 'apply', id: idM });
  ok('EA-27 modifyStart → draftEdit → apply 成功：extension.json 已更新，草稿 enabled', modify.code === 202 && modifyEdit.code === 202 && apply.code === 202 && readJSON(path.join(EXT_ROOT, folderA, 'extension.json'))?.tables?.[0]?.fields?.find(field => field.id === 'f6')?.label === '內部備註' && readJSON(draftFile(idM))?.state === 'enabled', { modify, modifyEdit, apply });
  const modify2 = await ext({ action: 'modifyStart', folder: folderA }), idM2 = modify2.json?.id || '';
  const file = path.join(EXT_ROOT, folderA, 'extension.json'); writeJSON(file, { ...readJSON(file), about: '另一處已改動' });
  const applyStale = await ext({ action: 'apply', id: idM2 });
  ok('EA-28 apply 時 extension.json 已被改動：409 stale', applyStale.code === 409 && applyStale.json?.error === 'stale', applyStale);
  await ext({ action: 'draftCancel', id: idM2 });

  /* ---------- 交給 Zero ---------- */
  const fresh = (await api(BASE, `/api/ext/rows?folder=${encodeURIComponent(folderA)}&table=t1`)).json?.rows?.find(item => item.id === row?.id);
  const toLast = await ext({ action: 'row', folder: folderA, table: 't1', op: 'update', id: row?.id, rev: fresh?.rev, v: { f5: 's5' } });
  const lastRev = toLast.json?.row?.rev;
  const handBody = { action: 'handoff', folder: folderA, table: 't1', id: row?.id, rev: lastRev, text: '訂單甲已出貨。' };
  const noOverview = await ext(handBody);
  const eventNotes = () => fs.readdirSync(path.join(DATA, 'founder', 'inbox')).filter(name => name.endsWith('-note-event.md'));
  const notesBefore = eventNotes().length;
  ok('EA-29 公司概覽未確認時 handoff：400，訊息為 extHandoffNeedsOverview，不寫 handedAt', noOverview.code === 400 && /公司概覽確認後/.test(noOverview.json?.message || '') && !(await api(BASE, `/api/ext/rows?folder=${encodeURIComponent(folderA)}&table=t1`)).json?.rows?.find(item => item.id === row?.id)?.handedAt, noOverview);
  confirmOverview(DATA);
  const handoff = await ext(handBody);
  const handed = (await api(BASE, `/api/ext/rows?folder=${encodeURIComponent(folderA)}&table=t1`)).json?.rows?.find(item => item.id === row?.id);
  const notesAfter = eventNotes().length, noteText = notesAfter ? fs.readFileSync(path.join(DATA, 'founder', 'inbox', eventNotes()[0]), 'utf8') : '';
  ok('EA-30 handoff 成功：202，寫 handedAt，收件匣多一份「發生了一件事」（來源為延伸功能）', toLast.code === 202 && handoff.code === 202 && !!handed?.handedAt && notesAfter === notesBefore + 1 && /"source":"extension"/.test(noteText) && noteText.includes('訂單甲已出貨。'), { toLast: toLast.code, handoff, handedAt: handed?.handedAt, notesBefore, notesAfter });
  const handoffAgain = await ext(handBody);
  ok('EA-31 handoff 重送：409 stale，收件匣不再增加', handoffAgain.code === 409 && handoffAgain.json?.error === 'stale' && eventNotes().length === notesAfter, handoffAgain);
  const badHandoff = await ext({ ...handBody, text: '' });
  ok('EA-32 handoff 不合格（空白內容）：400', badHandoff.code === 400, badHandoff);

  /* ---------- 示範實例、其他來源 ---------- */
  const demo = await api(DEMO_BASE, '/api/ext', { action: 'draftTemplate', template: 'orders' });
  ok('EA-33 示範實例：409 demo，不建草稿', demo.code === 409 && demo.json?.error === 'demo' && !fs.existsSync(path.join(DEMO, 'ledger', 'extensions')), demo);
  const draftsBefore = fs.readdirSync(DRAFTS).length;
  const foreign = await api(BASE, '/api/ext', { action: 'draftTemplate', template: 'orders' }, 'http://evil.example');
  ok('EA-34 其他來源：403，不建草稿', foreign.code === 403 && fs.readdirSync(DRAFTS).length === draftsBefore, foreign);
  ok('EA-35 伺服器沒有請求出錯（500）', serverErrors.length === 0, serverErrors.slice(-5));
} catch (error) {
  ok('延伸功能端點測試程式出錯', false, String(error?.stack || error));
} finally {
  server.kill(); demoServer.kill();
  // 只移除本測試建立的連結本身（不跟隨、不遞迴），令之後清理輸出資料夾時不會經連結走到別處
  if (linkPath) { try { fs.unlinkSync(linkPath); } catch { try { fs.rmdirSync(linkPath); } catch { } } }
  await sleep(300);
  const passed = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 1200)));
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}
