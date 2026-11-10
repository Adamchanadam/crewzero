// 會議紀錄伺服器：預檢、講者確認、草稿、交出、PDF 文字版及收件閘門。
// 用法：node minutes-server-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usePass, certifyDirect, seedCompany } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT_TEXT, ADAPTER] = process.argv.slice(2);
const PORT = Number(PORT_TEXT);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function transcript() {
  return [
    '00:00 Speaker 1', '大家早晨，今日先確認咖啡豆供應。',
    '00:08 Speaker 2', '我會在星期五前比較兩個報價。',
    '00:16 Speaker 1', '請你把結果和風險寫下來。',
    '00:24 Speaker 2', '我會連同交貨日期一併回覆。',
    '00:32 Speaker 1', '下星期再決定是否試行。',
    '00:40 Speaker 2', '好，我會先向兩間供應商查詢。'
  ].join('\n');
}

function pdfLiteral(text) {
  return String(text).replace(/([\\()])/g, '\\$1');
}

function transcriptPdf(text) {
  const content = 'BT /F1 12 Tf ' + text.split('\n').map(line => '(' + pdfLiteral(line) + ') Tj T*').join(' ') + ' ET';
  const stream = '<< /Length ' + Buffer.byteLength(content, 'latin1') + ' >>\nstream\n' + content + '\nendstream';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    stream
  ];
  const parts = [Buffer.from('%PDF-1.7\n', 'latin1')], offsets = [];
  let at = parts[0].length;
  for (let index = 0; index < objects.length; index++) {
    offsets[index + 1] = at;
    const block = Buffer.from(String(index + 1) + ' 0 obj\n' + objects[index] + '\nendobj\n', 'latin1');
    parts.push(block);
    at += block.length;
  }
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let index = 1; index <= 5; index++) xref += String(offsets[index]).padStart(10, '0') + ' 00000 n \n';
  xref += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + at + '\n%%EOF\n';
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

function startServer(data, port) {
  return spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], {
    cwd: PROTO,
    env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' },
    stdio: 'ignore'
  });
}

async function api(base, route, body) {
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json', Origin: base },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await response.json(); } catch { }
  return { code: response.status, json };
}

async function ready(base) {
  for (let index = 0; index < 80; index++) {
    try { if ((await fetch(base + '/api/health')).ok) return true; } catch { }
    await sleep(250);
  }
  return false;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
const BASE = 'http://127.0.0.1:' + PORT;
const MINUTES = await import(pathToFileURL(path.join(PROTO, 'minutes-lib.mjs')).href);
const { patchMinutes, minutesDir, sha256 } = MINUTES;
const server = startServer(DATA, PORT);
let demoServer = null;

try {
  seedCompany(DATA, PROTO);
  const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
  writeJSON(path.join(DATA, 'ledger', 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: new Date().toISOString(), order: page.path.milestones.map(item => item.id), values: {}, edits: [] });
  await certifyDirect(DATA, PROTO, ADAPTER);
  ok('伺服器啟動', await ready(BASE));
  await usePass(BASE);

  const source = transcript();
  const plain = await api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '筆記.txt', data: Buffer.from('普通筆記，沒有逐字稿格式。').toString('base64') }] });
  ok('非逐字稿預檢不留檔', plain.code === 200 && plain.json?.transcript === false && !fs.existsSync(path.join(DATA, 'ledger', 'minutes')), plain);

  const simultaneous = await Promise.all([
    api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '平行甲.txt', data: Buffer.from(source).toString('base64') }] }),
    api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '平行乙.txt', data: Buffer.from(source).toString('base64') }] })
  ]);
  const simultaneousIds = simultaneous.map(result => result.json?.id);
  ok('同時兩次預檢各自保留編號及原檔', simultaneous.every(result => result.code === 200 && result.json?.transcript) && new Set(simultaneousIds).size === 2 && simultaneousIds.every((id, index) => typeof id === 'string' && fs.existsSync(path.join(DATA, 'ledger', 'minutes', id + '.json')) && fs.existsSync(path.join(DATA, 'ledger', 'minutes', id, '01-' + (index ? '平行乙.txt' : '平行甲.txt')))), { simultaneous });
  const [survivor, rejected] = await Promise.all([
    api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '保留.txt', data: Buffer.from(source).toString('base64') }] }),
    api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '損壞.txt', data: '%%%' }] })
  ]);
  const survivorId = survivor.json?.id;
  ok('失敗預檢不影響另一件會議', survivor.code === 200 && survivor.json?.transcript && rejected.code === 400 && typeof survivorId === 'string' && fs.existsSync(path.join(DATA, 'ledger', 'minutes', survivorId + '.json')) && fs.existsSync(path.join(DATA, 'ledger', 'minutes', survivorId, '01-保留.txt')), { survivor, rejected });

  const largePdfText = Array.from({ length: 12000 }, (_, index) => '00:' + String(index % 60).padStart(2, '0') + ' Speaker ' + (index % 2 + 1) + '\n正在核對預檢工作緒是否保持回應。').join('\n');
  let workerPreflightDone = false;
  const workerPreflight = api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '大型逐字稿.pdf', data: transcriptPdf(largePdfText).toString('base64') }] });
  workerPreflight.then(() => { workerPreflightDone = true; }, () => { workerPreflightDone = true; });
  await sleep(25);
  const converting = !workerPreflightDone, healthAt = Date.now();
  let healthy = false;
  try { healthy = (await fetch(BASE + '/api/health')).ok; } catch { }
  const healthElapsed = Date.now() - healthAt;
  const workerResult = await workerPreflight;
  ok('大型 PDF 預檢期間健康檢查仍可回應', converting && healthy && healthElapsed < 1500 && workerResult.code === 200 && workerResult.json?.ok === true, { converting, healthy, healthElapsed, code: workerResult.code, json: workerResult.json }); /* 本項驗轉換期間伺服器仍回應；這份測試 PDF 超出轉文字上限，是否判為逐字稿不在本項範圍 */

  const preflight = await api(BASE, '/api/minutes', { action: 'preflight', files: [{ name: '會議.txt', data: Buffer.from(source).toString('base64') }] });
  const mid = preflight.json?.id;
  const recordFile = mid && path.join(DATA, 'ledger', 'minutes', mid + '.json');
  const beforeSpeakers = recordFile && JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  ok('逐字稿預檢建登記檔、標籤例句及收件匣筆記', preflight.code === 200 && preflight.json?.transcript === true && beforeSpeakers?.state === 'speakers' && beforeSpeakers.labels.length === 2 && beforeSpeakers.labels.every(item => item.samples.length) && fs.existsSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-speakers.md')), { preflight, labels: beforeSpeakers?.labels });
  const openBefore = await api(BASE, '/api/minutes');
  ok('GET 清單列出未交出的會議', openBefore.code === 200 && openBefore.json?.items.some(item => item.id === mid && item.state === 'speakers'), openBefore);

  const incomplete = await api(BASE, '/api/minutes', { action: 'speakers', id: mid, map: { 'Speaker 1': { kind: 'founder', name: '我', actorId: '' } } });
  ok('缺一位講者時拒收', incomplete.code === 400 && incomplete.json?.message, incomplete);
  const complete = await api(BASE, '/api/minutes', { action: 'speakers', id: mid, map: {
    'Speaker 1': { kind: 'founder', name: '我', actorId: '' },
    'Speaker 2': { kind: 'other', name: '陳小明', actorId: '' }
  } });
  const draft = await api(BASE, '/api/minutes', { action: 'draft', id: mid, title: '咖啡豆供應會議', meetingDate: '2026-11-10' });
  const drafting = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  ok('講者確認後進入草稿及寫入草稿筆記', complete.code === 200 && draft.code === 202 && drafting.state === 'drafting' && fs.existsSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-draft.md')), { complete, draft, state: drafting.state });

  const draftText = '# 會議紀錄\n\n> ⚠️ 不肯定，請核對（共 1 處）　✏️ 待你補充（共 0 處）\n\n## 摘要\n\n⚠️（交貨日期）星期五前比較兩個報價。\n';
  const draftName = '2026-11-10 咖啡豆供應會議（草稿）.md';
  const draftDir = minutesDir(PROTO, { data: DATA });
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(path.join(draftDir, draftName), draftText, 'utf8');
  patchMinutes({ ledger: path.join(DATA, 'ledger') }, mid, { state: 'ready', file: draftName, hash: sha256(draftText) }, { who: 'shell', from: 'drafting' });

  const readyView = await api(BASE, '/api/minutes?id=' + encodeURIComponent(mid));
  ok('模擬外殼完成後 GET 有全文、雜湊及標示數', readyView.code === 200 && readyView.json?.state === 'ready' && readyView.json?.text === draftText && readyView.json?.hash === sha256(draftText) && readyView.json?.marks?.warn === 1, readyView);

  const originalDraft = fs.readFileSync(path.join(draftDir, draftName), 'utf8');
  const outsideMinutes = path.join(OUT, 'outside-minutes'), outsideDraft = path.join(outsideMinutes, draftName);
  let junctionSave, junctionOpen, outsideUnchanged = false;
  try {
    fs.mkdirSync(outsideMinutes, { recursive: true });
    fs.writeFileSync(outsideDraft, '不得改動這個目標檔。', 'utf8');
    fs.rmSync(draftDir, { recursive: true, force: true });
    fs.symlinkSync(outsideMinutes, draftDir, 'junction');
    junctionSave = await api(BASE, '/api/minutes', { action: 'save', id: mid, text: '不得寫進 junction。', hash: readyView.json.hash });
    junctionOpen = await api(BASE, '/api/minutes', { action: 'open', id: mid });
    outsideUnchanged = fs.readFileSync(outsideDraft, 'utf8') === '不得改動這個目標檔。';
  } finally {
    fs.rmSync(draftDir, { recursive: true, force: true });
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(path.join(draftDir, draftName), originalDraft, 'utf8');
  }
  ok('會議紀錄資料夾是 junction 時儲存及打開都拒絕，目標檔不變', junctionSave?.code === 400 && junctionSave.json?.error === 'folder' && junctionOpen?.code === 400 && junctionOpen.json?.error === 'folder' && outsideUnchanged, { junctionSave, junctionOpen, outsideUnchanged });

  fs.writeFileSync(path.join(draftDir, draftName), draftText + '\n本機先改了一行。', 'utf8');
  const oldSave = await api(BASE, '/api/minutes', { action: 'save', id: mid, text: '不應覆蓋', hash: readyView.json.hash });
  ok('舊雜湊儲存回 409 且不覆蓋', oldSave.code === 409 && oldSave.json?.error === 'changed' && fs.readFileSync(path.join(draftDir, draftName), 'utf8').includes('本機先改了一行'), oldSave);

  const changedView = await api(BASE, '/api/minutes?id=' + encodeURIComponent(mid));
  const marked = await api(BASE, '/api/minutes', { action: 'submit', id: mid, hash: changedView.json.hash, acceptMarks: false });
  ok('有標示而未確認時不交出', marked.code === 409 && marked.json?.error === 'marks', marked);

  const submitted = await api(BASE, '/api/minutes', { action: 'submit', id: mid, hash: changedView.json.hash, acceptMarks: true });
  const afterSubmit = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  const inbox = fs.readdirSync(path.join(DATA, 'founder', 'inbox'));
  const eventNote = inbox.find(name => name === afterSubmit.inputId.slice(3) + '-note-event.md');
  const eventText = eventNote ? fs.readFileSync(path.join(DATA, 'founder', 'inbox', eventNote), 'utf8') : '';
  const finalFile = afterSubmit.file && path.join(draftDir, afterSubmit.file);
  ok('交出後改名、v1、事件筆記、machine.minutes、附件及登記檔均正確', submitted.code === 202 && afterSubmit.state === 'submitted' && afterSubmit.file && !afterSubmit.file.includes('（草稿）') && finalFile && fs.existsSync(finalFile) && !fs.existsSync(path.join(draftDir, draftName)) && fs.existsSync(path.join(DATA, 'ledger', 'minutes', mid, 'v1.md')) && /"minutes"/.test(eventText) && inbox.some(name => name.startsWith(afterSubmit.inputId.slice(3) + '-note-event-file-') && name.endsWith('會議紀錄.md')) && afterSubmit.versions.length === 1, { submitted, record: afterSubmit, inbox });
  const openAfter = await api(BASE, '/api/minutes');
  ok('交出後 GET 清單不再列出該會議', openAfter.code === 200 && !openAfter.json?.items.some(item => item.id === mid), openAfter);

  const revise = await api(BASE, '/api/minutes', { action: 'revise', id: mid });
  const reviseView = await api(BASE, '/api/minutes?id=' + encodeURIComponent(mid));
  const revisedText = reviseView.json.text + '\n\n## 補充\n\n已確認供應商比較安排。';
  const savedV2 = await api(BASE, '/api/minutes', { action: 'save', id: mid, text: revisedText, hash: reviseView.json.hash });
  const submittedV2 = await api(BASE, '/api/minutes', { action: 'submit', id: mid, hash: savedV2.json?.hash, acceptMarks: true });
  const afterV2 = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  ok('修改會議紀錄使用第 2 版', revise.code === 200 && reviseView.json?.state === 'ready' && savedV2.code === 200 && submittedV2.code === 202 && afterV2.version === 2 && fs.existsSync(path.join(DATA, 'ledger', 'minutes', mid, 'v2.md')) && afterV2.versions.length === 2, { revise, savedV2, submittedV2, record: afterV2 });

  const reopen = await api(BASE, '/api/minutes', { action: 'revise', id: mid });
  fs.rmSync(path.join(draftDir, afterV2.file), { force: true });
  fs.rmSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-draft.md'), { force: true });
  const missingView = await api(BASE, '/api/minutes?id=' + encodeURIComponent(mid));
  const redraft = await api(BASE, '/api/minutes', { action: 'draft', id: mid });
  const redrafting = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  ok('草稿檔不見時顯示可重試，講者已齊可重新整理', reopen.code === 200 && missingView.code === 200 && missingView.json?.state === 'ready' && missingView.json?.error === 'missing' && missingView.json?.message && redraft.code === 202 && redrafting.state === 'drafting' && redrafting.error === '' && fs.existsSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-draft.md')), { missingView, redraft, record: redrafting });

  // 窄覆核新必修：整理失敗（外殼設 failed）後按「重試」，講者已齊就接受，重新整理
  let failedRetry = null;
  try {
    fs.rmSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-draft.md'), { force: true });
    patchMinutes({ ledger: path.join(DATA, 'ledger') }, mid, { state: 'failed', error: '測試：草稿缺一節' }, { who: 'shell', from: 'drafting' });
    const retried = await api(BASE, '/api/minutes', { action: 'draft', id: mid });
    failedRetry = { retried, record: JSON.parse(fs.readFileSync(recordFile, 'utf8')) };
  } catch (error) { failedRetry = { error: String(error && error.message || error) }; }
  ok('整理失敗後重試：講者已齊時接受，狀態回到整理中並寫草稿筆記', failedRetry && failedRetry.retried && failedRetry.retried.code === 202 && failedRetry.record.state === 'drafting' && fs.existsSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-draft.md')), failedRetry);

  // 最後一輪核對必修 2：已交出版本的定稿檔不見，按「修改會議紀錄」由最後交出的版本還原後再改，內容不失
  let restoreCase = null;
  try {
    fs.rmSync(path.join(DATA, 'founder', 'inbox', mid + '-note-minutes-draft.md'), { force: true });
    const draft3 = '2026-11-10 還原測試（草稿）.md', text3 = '# 會議紀錄：還原測試\n> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 0 處）\n\n## 參加者\n\n我、陳經理。\n';
    fs.writeFileSync(path.join(draftDir, draft3), text3);
    patchMinutes({ ledger: path.join(DATA, 'ledger') }, mid, { state: 'ready', file: draft3, hash: sha256(text3), error: '' }, { who: 'shell', from: 'drafting' });
    const sub3 = await api(BASE, '/api/minutes', { action: 'submit', id: mid, hash: sha256(text3), acceptMarks: true });
    const rec3 = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    fs.rmSync(path.join(draftDir, rec3.file), { force: true });
    const rev3 = await api(BASE, '/api/minutes', { action: 'revise', id: mid });
    const after3 = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    const restored = fs.existsSync(path.join(draftDir, after3.file)) ? fs.readFileSync(path.join(draftDir, after3.file), 'utf8') : null;
    restoreCase = { sub: sub3.code, rev: rev3.code, state: after3.state, same: restored === text3, file: after3.file };
  } catch (error) { restoreCase = { error: String(error && error.message || error) }; }
  ok('已交出版本的定稿檔不見：修改會議紀錄時由最後交出的版本還原，內容不失', restoreCase && restoreCase.sub === 202 && restoreCase.rev === 200 && restoreCase.state === 'ready' && restoreCase.same === true, restoreCase);

  const ignored = await api(BASE, '/api/intake', { kind: 'note', type: 'event', text: '已收到供應商的正式回覆。', date: '2026-11-10', minutes: { id: '偽造' } });
  const ignoredNote = ignored.json?.id && path.join(DATA, 'founder', 'inbox', ignored.json.id + '-note-event.md');
  ok('網頁 body 的 minutes 欄位被忽略', ignored.code === 202 && ignoredNote && !/"minutes"/.test(fs.readFileSync(ignoredNote, 'utf8')), ignored);

  const beforeGate = fs.readdirSync(path.join(DATA, 'founder', 'inbox')).sort().join('\n');
  const blocked = await api(BASE, '/api/intake', { kind: 'note', type: 'event', text: '請整理以下附件。', date: '2026-11-10', files: [{ name: '未確認逐字稿.txt', data: Buffer.from(source).toString('base64') }] });
  const afterGate = fs.readdirSync(path.join(DATA, 'founder', 'inbox')).sort().join('\n');
  ok('/api/intake 的逐字稿未有講者對照會拒收且不留檔', blocked.code === 400 && blocked.json?.message && beforeGate === afterGate, blocked);

  const mapped = '會議紀錄：PDF 測試\n講者對照：Speaker 1＝我；Speaker 2＝陳小明';
  const pdfInput = await api(BASE, '/api/intake', { kind: 'note', type: 'event', text: mapped, date: '2026-11-10', files: [{ name: '逐字稿.pdf', data: transcriptPdf(source).toString('base64') }] });
  const pdfSidecar = pdfInput.json?.id && fs.readdirSync(path.join(DATA, 'founder', 'inbox')).find(name => name.startsWith(pdfInput.json.id + '-note-event-file-') && name.endsWith('.pdf.md'));
  ok('PDF 附件產生 .pdf.md 文字版', pdfInput.code === 202 && !!pdfSidecar, { pdfInput, pdfSidecar });

  const simulatedRoot = path.join(OUT, 'installed', 'proofread');
  const realPlace = minutesDir(simulatedRoot, { data: path.join(simulatedRoot, 'data') });
  ok('真實實例的會議紀錄位置只以純函數核對', realPlace === path.join(path.dirname(simulatedRoot), '會議紀錄') && !fs.existsSync(realPlace), realPlace);

  const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
  const demoData = path.join(OUT, 'demo-data');
  seedDemo(demoData, { copyCert: false });
  demoServer = startServer(demoData, PORT + 1);
  const demoBase = 'http://127.0.0.1:' + (PORT + 1);
  ok('示範伺服器啟動', await ready(demoBase));
  await usePass(demoBase);
  const demo = await api(demoBase, '/api/minutes');
  ok('示範實例一律回 minDemo', demo.code === 409 && demo.json?.error === 'demo', demo);
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (server) server.kill();
  if (demoServer) demoServer.kill();
  const passed = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 900)));
  console.log('\n' + passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
}
