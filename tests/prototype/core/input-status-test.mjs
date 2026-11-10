// 交給 Zero 的事：狀態判斷（inputStatus 純函數）逐行情境驗證，加上讀附件端點、更正來源連結、首頁及回饋卡資料的伺服器檢查。
// 狀態表見 docs/evidence/v0400-ui-2026-11-07/status-table.md：每個 case 對應表中一行。
// 用法：node input-status-test.mjs <原型資料夾> <輸出資料夾> <port>
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { usePass } from '../lib/testkit.mjs';
import { writeAdapters } from '../lib/adapters.mjs';
import { buildV0400 } from '../fixtures/v0400-inputs.mjs';
const [PROTO, OUT, PORT] = process.argv.slice(2);
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const dash = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const { inputStatus, inputView } = dash;

/* ---------- A. 純函數：狀態表逐行 ---------- */
const pack = (n) => ({ questions: Array.from({ length: n }, (_, k) => ({ id: 'q' + (k + 1) })) });
const ans = (...ids) => Object.fromEntries(ids.map(i => [i, { value: 'x' }]));
const run = (state, ref = 'a1') => ({ id: 'R1', kind: 'note', ref, state, error: state === 'failed' ? '工具沒有回應' : '' });
const base = { id: 'in-a1', via: 'event', status: 'unprocessed', files: [], effects: [] };
const rows = [
  ['1 剛送出，未有工作紀錄', base, {}, { code: 'working', button: 'feedback', steps: ['received', 'read'] }],
  ['2 等 AI 設定（工作等待中）', base, { runs: [run('waiting')] }, { code: 'working', aiWaiting: true }],
  ['3 工作失敗', base, { runs: [run('failed')] }, { code: 'failed', button: 'retry', failed: true, runId: 'R1' }],
  ['4 工作失敗後重試成功（最新一次已完成，輸入仍未處理）', base, { runs: [run('done'), run('failed')] }, { code: 'working' }],
  ['5 別件事的工作失敗不影響本件', base, { runs: [run('failed', 'zzz')] }, { code: 'working' }],
  ['6 Zero 已擬題，兩題未答', { ...base, status: 'awaitingFounder', packId: 'p' }, { pack: pack(2), answers: {} }, { code: 'awaiting', open: 2, total: 2, button: 'answer', steps: ['received', 'read', 'confirm'] }],
  ['7 問題包部分作答（答了一題）', { ...base, status: 'awaitingFounder', packId: 'p' }, { pack: pack(2), answers: ans('q1') }, { code: 'awaiting', open: 1, answered: 1 }],
  ['8 問題包已全部作答、仍在套用', { ...base, status: 'awaitingFounder', packId: 'p' }, { pack: pack(2), answers: ans('q1', 'q2') }, { code: 'working', applying: true, button: 'feedback' }],
  ['9 問題包被取代或移除', { ...base, status: 'awaitingFounder', packId: 'old' }, { pack: null }, { code: 'working', packGone: true, button: 'feedback' }],
  ['10 確認後有改動', { ...base, status: 'processed', effects: [{ change: 'a', before: 'x', after: 'y' }], read: { summary: 's', highlights: [] } }, {}, { code: 'updated', legacy: false, steps: ['received', 'read', 'confirm', 'changed'] }],
  ['11 確認後全部維持不變（沒有改動項）', { ...base, status: 'processed', effects: [], reason: '沒有對方的行動', read: { summary: 's', highlights: [] } }, {}, { code: 'noeffect', legacy: false, steps: ['received', 'read', 'why'] }],
  ['12 沒有影響的舊紀錄（沒有新欄位）', { ...base, status: 'processed', effects: [] }, {}, { code: 'noeffect', legacy: true }],
  ['13 有改動的舊紀錄（只有一句 change）', { ...base, status: 'processed', effects: [{ change: '舊句' }] }, {}, { code: 'updated', legacy: true }],
  ['14 跟進日期確認後入日程（followUp）', { ...base, status: 'processed', effects: [{ targetKind: 'followUp', targetId: 'f1', change: '回覆甲公司', dueAt: '2026-11-20' }] }, {}, { code: 'updated', legacy: false }],
  ['15 來源是與 Zero 的討論', { ...base, source: 'chat' }, {}, { code: 'working', source: 'chat' }],
  ['16 網頁送出（沒有 source）', base, {}, { source: 'web' }],
  ['17 只有文件、沒有文字', { ...base, via: 'doc', status: 'processed', effects: [{ change: 'x' }] }, { said: '' }, { code: 'updated', textless: true }],
  ['18 有原話', base, { said: '工房甲確認供貨' }, { textless: false }],
  ['19 輸入紀錄缺欄位（沒有 effects、沒有 files）', { id: 'in-z', status: 'processed' }, {}, { code: 'noeffect', legacy: true }],
  ['20 空物件不當機', {}, {}, { code: 'working' }]
];
for (const [name, input, ctx, want] of rows) {
  let got; try { got = inputStatus(input, ctx); } catch (e) { got = { error: String(e) }; }
  const bad = Object.entries(want).filter(([k, v]) => JSON.stringify(got[k]) !== JSON.stringify(v));
  ok('狀態表 ' + name, !bad.length, bad.length ? bad.map(([k, v]) => `${k}: 要 ${JSON.stringify(v)} 得 ${JSON.stringify(got[k])}`) : got.code);
}
// 每個狀態都有名稱鍵，名稱表內有字
for (const code of ['working', 'failed', 'awaiting', 'updated', 'noeffect']) { const t = inputStatus({ ...base, status: code === 'awaiting' ? 'awaitingFounder' : code === 'updated' || code === 'noeffect' ? 'processed' : 'unprocessed', effects: code === 'updated' ? [{ change: 'a' }] : [] }, { pack: pack(1), runs: code === 'failed' ? [run('failed')] : [] }); ok('狀態名稱存在：' + code, t.code === code && N.ui[t.tag], t.tag); }

/* ---------- B. 夾具＋資料層 ---------- */
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data'), ADIR = path.join(OUT, 'adapters'), ads = writeAdapters(ADIR);
const built = await buildV0400(DATA, PROTO, { confirmed: true, adapter: ads.fake });
const [idB, idD, idA, idF, idC, idE, idG, idH] = built.inputs;
process.env.SOS_DATA = DATA;
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const DIR = lib.dataDirs(PROTO);
const ds = dash.dashboardState(DIR, {});
const all = ds.inputs.all;
ok('真實進展頁清單包含文件類（不再過濾 via=doc）', all.some(v => v.via === 'doc') && all.length === 8, all.map(v => v.via).join(','));
const by = id => all.find(v => v.id === id);
ok('夾具：B 已更新紀錄、D 處理中、A 等你確認、C 沒有影響、F 討論來源', by(idB).status.code === 'updated' && by(idD).status.code === 'working' && by(idA).status.code === 'awaiting' && by(idC).status.code === 'noeffect' && by(idF).source === 'chat');
ok('夾具：舊紀錄 G 標為沒有詳細回饋', by(idG).status.legacy === true && by(idG).status.code === 'updated');
ok('夾具：列表按收件時間新到舊', all.every((v, i) => i === 0 || String(all[i - 1].receivedAt) >= String(v.receivedAt)));
const months = [...new Set(all.map(v => String(v.receivedAt).slice(0, 7)))];
ok('夾具：跨兩個月份', months.length === 2, months);
ok('附件可開啟、有轉文字版', by(idE).files[0].openable && by(idE).files[0].hasText && by(idF).files[0].url.startsWith('https://docs.google.com/'));
// 竄改帳本：附件路徑跑出 data 資料夾外，或指向不存在的檔，一律不可開
const stFile = path.join(DATA, 'ledger', 'state.json'), st0 = JSON.parse(fs.readFileSync(stFile, 'utf8'));
const secret = path.join(OUT, 'outside-secret.txt'); fs.writeFileSync(secret, '不可讀取');
st0.inputs.push({ id: 'in-evil', via: 'event', kind: 'inbox', title: '竄改測試', status: 'processed', receivedAt: '2026-11-01T10:00:00+08:00', files: ['../outside-secret.txt', 'archive/not-there.pdf', 'archive'], effects: [] });
fs.writeFileSync(stFile, JSON.stringify(st0));
const evil = dash.dashboardState(DIR, {}).inputs.all.find(v => v.id === 'in-evil');
ok('附件路徑出界、不存在、資料夾都不可開', evil && evil.files.every(f => !f.openable), evil && evil.files.map(f => f.openable));
// 詳細視圖：原話、問題及答案、確認時間
const det = inputView(DIR, st0.inputs.find(i => i.id === idB), { packs: lib.listPacks(DIR), runs: [], loadPack: lib.loadPack, loadAnswers: lib.loadAnswers }, { detail: true });
ok('詳細視圖有原話、兩題答案及確認時間', det.said.includes('五十位訂戶') && det.qa.length === 2 && det.qa.every(q => q.answer) && det.confirmedAt, det.confirmedAt);
const detA = inputView(DIR, st0.inputs.find(i => i.id === idA), { packs: lib.listPacks(DIR), runs: [], loadPack: lib.loadPack, loadAnswers: lib.loadAnswers }, { detail: true });
ok('等你確認：兩題未答、有 Zero 建議', detA.status.open === 2 && detA.qa.every(q => !q.answer && q.suggest), detA.qa.map(q => q.suggest));
// 名稱表：未能讀取、類型判定固定字句
ok('類型判定固定字句', N.fileJudge('a.pdf') === N.ui.attJudgeFull && N.fileJudge('a.docx') === N.ui.attJudgeNew && N.fileJudge('a.xls') === N.ui.attJudgeOld && N.fileJudge('a.png') === N.ui.attJudgeImg);
ok('未能讀取原因：新格式三種及舊格式', /密碼/.test(N.unreadReason('a.docx', 'encrypted')) && /太大/.test(N.unreadReason('a.xlsx', 'too-big')) && /損壞/.test(N.unreadReason('a.pptx', 'corrupt')) && /另存為新版格式/.test(N.unreadReason('a.doc')) && /告訴 Zero/.test(N.unreadReason('a.docx')));

/* ---------- C. 伺服器：首頁資料、回饋卡、讀附件、更正來源連結 ---------- */
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ads.fake, CZ_NO_WELCOME: '1', SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
try {
  await usePass(BASE);
  for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch { } await new Promise(r => setTimeout(r, 250)); }
  const get = async p => { const r = await fetch(BASE + p); return { code: r.status, type: r.headers.get('content-type') || '', disp: r.headers.get('content-disposition') || '', buf: Buffer.from(await r.arrayBuffer()) }; };
  const json = async p => { const r = await get(p); try { return { code: r.code, j: JSON.parse(r.buf.toString('utf8')) }; } catch { return { code: r.code, j: null }; } };
  const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
  const home = await json('/api/home');
  ok('/api/home 回傳最近 5 件及開工預覽', home.code === 200 && home.j.inputs.length === 5 && home.j.inputsTotal >= 8 && home.j.runNow && typeof home.j.runNow.unread === 'number', home.j && home.j.runNow);
  ok('開工預覽：未讀 1 件（處理中的請 Zero 做事）及下一個對外動作', home.j.runNow.unread === 1 && !!home.j.runNow.next, home.j.runNow);
  const card = await json('/api/input?id=' + encodeURIComponent(idB));
  ok('/api/input 回饋卡資料', card.code === 200 && card.j.input.said && card.j.input.qa.length === 2 && card.j.input.status.code === 'updated');
  ok('/api/input 找不到回 404', (await json('/api/input?id=in-nope')).code === 404);
  const f0 = await get('/api/input-file?id=' + encodeURIComponent(idA) + '&n=0');
  ok('讀附件：PDF 在瀏覽器開啟（正確內容類型）', f0.code === 200 && f0.type.startsWith('application/pdf') && /^inline/.test(f0.disp) && f0.buf.slice(0, 4).toString() === '%PDF', f0.type + ' ' + f0.disp);
  const f1 = await get('/api/input-file?id=' + encodeURIComponent(idB) + '&n=0');
  ok('讀附件：圖片在瀏覽器開啟', f1.code === 200 && f1.type === 'image/png' && f1.buf.slice(1, 4).toString() === 'PNG', f1.type);
  const f2 = await get('/api/input-file?id=' + encodeURIComponent(idE) + '&n=0');
  ok('讀附件：Word 檔下載', f2.code === 200 && /^attachment/.test(f2.disp) && f2.type === 'application/octet-stream', f2.type + ' ' + f2.disp);
  const f3 = await get('/api/input-file?id=' + encodeURIComponent(idE) + '&n=0&text=1');
  ok('讀附件：轉文字版', f3.code === 200 && f3.buf.toString('utf8').includes('供應協議草稿'), f3.type);
  const bad = await Promise.all(['/api/input-file?id=in-evil&n=0', '/api/input-file?id=in-evil&n=1', '/api/input-file?id=in-evil&n=2', '/api/input-file?id=' + idA + '&n=9', '/api/input-file?id=' + idA + '&n=-1', '/api/input-file?id=' + idA + '&n=abc', '/api/input-file?id=nope&n=0', '/api/input-file?path=../ledger/state.json', '/api/input-file?id=' + idA + '&n=0&file=../../ledger/state.json'].map(async p => [p, (await get(p)).code]));
  ok('讀附件：出界、不存在、越界序號、任意路徑參數一律 404（參數 file 被忽略）', bad.slice(0, 8).every(([, c]) => c === 404) && bad[8][1] === 200, bad);
  // 沒有通行證不可讀
  const anon = await fetch(BASE + '/api/input-file?id=' + encodeURIComponent(idA) + '&n=0', { headers: { cookie: 'x=y' } });
  ok('讀附件：沒有通行證 403', anon.status === 403, anon.status);
  // 更正來源連結
  const T1 = () => JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8')).sources[1].title;   // 0.40.2：更正連結須帶該項來源標題
  const confirmedFile = path.join(DATA, 'ledger', 'confirmed.json'), h0 = crypto.createHash('sha256').update(fs.readFileSync(confirmedFile)).digest('hex');
  const s0 = (await json('/api/status')).j;
  const badUrls = ['http://example.com/a', 'https://localhost/a', 'https://127.0.0.1/a', 'https://192.168.1.5/a', 'https://10.0.0.2/a', 'https://user:pw@example.com/a', 'https://[::1]/a', 'https://printer.local/a', 'https://example.com/' + 'a'.repeat(300), 'javascript:alert(1)', 'not a url', ''];
  const badRes = await Promise.all(badUrls.map(async u => [u.slice(0, 30), (await post('/api/source-url', { n: 1, title: T1(), url: u })).code]));
  ok('更正連結：不安全或無效網址全部拒絕', badRes.every(([, c]) => c === 400), badRes);
  ok('更正連結：來源序號無效拒絕', (await post('/api/source-url', { n: 99, url: 'https://example.com/a' })).code === 400 && (await post('/api/source-url', { n: 'x', url: 'https://example.com/a' })).code === 400);
  const good = await post('/api/source-url', { n: 1, title: T1(), url: 'https://docs.google.com/spreadsheets/d/FIXED-ID/edit' });
  const pg = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
  ok('更正連結：寫入新網址、舊值存 urlBefore、記 fixedOn', good.code === 200 && pg.sources[1].url.endsWith('FIXED-ID/edit') && pg.sources[1].urlBefore.endsWith('EXAMPLE-ID/edit') && /^\d{4}-\d{2}-\d{2}$/.test(pg.sources[1].fixedOn), pg.sources[1]);
  await post('/api/source-url', { n: 1, title: T1(), url: 'https://docs.google.com/spreadsheets/d/FIXED-2/edit' });
  const pg2 = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
  ok('更正連結：再次更正不蓋掉最初的舊值', pg2.sources[1].urlBefore.endsWith('EXAMPLE-ID/edit') && pg2.sources[1].url.endsWith('FIXED-2/edit'));
  ok('更正連結：其他來源及題目答案不受影響', pg2.sources[0].url === undefined && pg2.sources[2].title === pg.sources[2].title && JSON.stringify(pg2.glance) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8')).glance));
  const h1 = crypto.createHash('sha256').update(fs.readFileSync(confirmedFile)).digest('hex'), s1 = (await json('/api/status')).j;
  ok('更正連結後：確認檔沒有改、公司概覽仍是「已確認」、確認摘要不變', h0 === h1 && s1.company.confirmed === true && s0.company.confirmedDigest === s1.company.confirmedDigest, { confirmed: s1.company.confirmed });
  const ops = fs.readdirSync(path.join(DATA, 'ledger')).filter(f => /founder-ops/.test(f));
  const opText = ops.map(f => fs.readFileSync(path.join(DATA, 'ledger', f), 'utf8')).join('');
  ok('更正連結：創辦人操作隊列有記錄（外殼合併時寫入帳本事件）', /setSourceUrl/.test(opText), ops);
  const sf = await get('/api/source-file?n=0');
  ok('公司概覽來源存檔可開（PDF）', sf.code === 200 && sf.type.startsWith('application/pdf'), sf.code);
  ok('來源存檔：無檔案的來源 404', (await get('/api/source-file?n=2')).code === 404 && (await get('/api/source-file?n=77')).code === 404);
} catch (e) { ok('伺服器檢查不當機', false, String(e && e.stack || e).slice(0, 400) + '\n' + log.slice(-400)); }
finally { try { srv.kill(); } catch { } }
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
process.exit(results.every(r => r.pass) ? 0 : 1);
