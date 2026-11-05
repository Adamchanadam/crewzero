// 假 AI 全鏈及恢復：只由主線執行（會啟動隔離伺服器及 Chrome）。
// node ideate-test.mjs <chrome> <輸出> <原型> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), servers = [], results = [];
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const A = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const fence = String.fromCharCode(96).repeat(3);
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); return !!pass; };
const need = (name, pass, info) => { if (!ok(name, pass, info)) throw new Error(name); };
const read = (f, fallback = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const lines = f => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; } };
const write = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
async function waitFor(fn, ms = 60000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const v = await fn(); if (v) return v; await sleep(150); }
  return null;
}
async function start(name, port, configured = true) {
  const data = path.join(OUT, name);
  fs.mkdirSync(data, { recursive: true });
  if (configured) await certifyDirect(data, PROTO, ADAPTER);
  const child = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  child.on('exit', () => write(path.join(OUT, name + '-server.log'), log));
  const base = `http://127.0.0.1:${port}`;
  await usePass(base);
  const get = async url => (await fetch(base + url)).json();
  const post = async (url, value) => {
    const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(value) });
    return { code: r.status, j: await r.json() };
  };
  const ideate = async () => (await get('/api/intake')).ideate;
  return { data, base, get, post, ideate, session: () => read(path.join(data, 'ledger', 'ideate.json')), starts: () => lines(path.join(data, 'ledger', 'ai-starts.log')), actual: () => lines(path.join(data, 'ideate-starts.jsonl')).map(JSON.parse) };
}
async function asking(c, round) {
  const s = await waitFor(async () => { const s = await c.ideate(); return s?.state === 'asking' && s.round === round ? s : null; });
  need(`第 ${round} 步 asking`, !!s, await c.ideate());
  const pack = (await c.get('/api/ask?id=' + s.packId)).pack;
  need(`第 ${round} 步只一包、最多三題、綁定本次構思`, pack?.questions.length > 0 && pack.questions.length <= 3 && pack.ideate?.round === round && pack.ideate.id === c.session().id, pack);
  return pack;
}
async function answer(c, pack) {
  const answers = pack.questions.map(q => ({ id: q.id, value: q.value, ai: q.value, changed: false }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: A.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + A.fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + A.localIso()];
  return c.post('/api/submit', { kind: 'ask-answer', ref: pack.id, text: head.join('\n') + '\n\n' + fence + 'json\n' + JSON.stringify(machine) + '\n' + fence + '\n' });
}
function counted(c, label) {
  const actual = c.actual(), booked = c.starts().filter(l => /\tideate-(?:ask|final)\t/.test(l));
  ok(label, actual.length > 0 && actual.length === booked.length && actual.every(a => booked.some(l => l.endsWith('\t' + a.sandbox) && l.includes('\t' + a.type + '\t'))), { actual, booked });
}
fs.mkdirSync(OUT, { recursive: true });
// 每次執行全新測試區，不覆寫或清走未知舊輸出。
const RUN = fs.mkdtempSync(path.join(OUT, 'ideate-'));
let chrome;
try {
  // start 使用獨立子目錄；其餘結果放 OUT 便於全套收據收集。
  const main = await start(path.basename(RUN) + '/main', PORT);
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1);
  await usePass(main.base, chrome);
  write(path.join(main.data, 'fake-mode.txt'), 'ideate-ask:slow\n');
  const begin = await main.post('/api/intake', { kind: 'note', type: 'ideate', text: '用 AI 幫傳統小生意' });
  need('開始收到，GET /api/intake 如實回傳 running', begin.code === 202 && (await main.ideate())?.state === 'running', begin);
  await chrome.go(main.base + '/#/intake', 1440, 300);
  ok('交資料頁顯示 running，不再顯示可重複啟動按鈕', await chrome.ev(`document.querySelector('#zero-think-box').textContent.includes(${JSON.stringify(N.ui.ideateRunning)})&&!document.querySelector('#zero-think')`));
  const sessionId = main.session().id;
  const p1 = await asking(main, 1);
  ok('第一題三個可選對象，親身經歷題可用不知道', p1.questions[0].options?.length === 3 && p1.questions[0].options.every(o => o.text !== N.ui.unknownLater) && p1.questions.slice(1).some(q => q.value === N.ui.unknownLater), p1.questions);
  await chrome.go(main.base + '/#/intake');
  ok('asking 顯示本步及答題入口', await chrome.ev(`document.querySelector('#zero-think-box').textContent.includes(${JSON.stringify(N.t('ideateAsking', { n: 1 }))})&&document.querySelector('#zero-think-box a').getAttribute('href')===${JSON.stringify('#/ask/' + p1.id)}`));
  for (let round = 1; round <= 3; round++) {
    const pack = round === 1 ? p1 : await asking(main, round);
    const reply = await answer(main, pack);
    need(`第 ${round} 步作答收到`, reply.code === 200, reply);
  }
  const ready = await waitFor(async () => { const s = await main.ideate(); return s?.state === 'ready' ? s : null; });
  need('第三步後收尾為 ready', ready?.prefillId && main.session().id === sessionId, ready);
  const prefill = await main.get('/api/prefill?id=' + ready.prefillId);
  need('GET /api/prefill 有討論內容，來源 ideate、沒有虛構原句或實績', prefill.state === 'done' && prefill.prefill?.from === 'ideate' && prefill.prefill.answers.q1?.text && prefill.prefill.answers.q6?.text && !prefill.prefill.answers.q5 && Object.values(prefill.prefill.answers).every(a => a.label === 'inferred'), prefill);
  ok('三步加收尾共四次 AI 工作', main.actual().length === 4 && main.actual().filter(a => a.type === 'ideate-ask').length === 3 && main.actual().filter(a => a.type === 'ideate-final').length === 1, main.actual());
  counted(main, '每次構思及收尾均計入 ai-starts.log');
  await chrome.go(main.base + '/#/intake');
  const loaded = await waitFor(() => chrome.ev(`document.querySelector('#q1')?.value===${JSON.stringify(prefill.prefill.answers.q1.text)}&&!!document.querySelector('#pf-confirm-all')`));
  need('ready：交資料頁載入預填，可全部照用', !!loaded, await chrome.ev(`({q1:document.querySelector('#q1')?.value,want:${JSON.stringify(prefill.prefill.answers.q1.text)},confirmAll:!!document.querySelector('#pf-confirm-all'),pending:document.querySelectorAll('[data-pf-confirm]').length,box:document.querySelector('#pf-box')?.innerText,think:document.querySelector('#zero-think-box')?.innerText,answers:${JSON.stringify(Object.keys(prefill.prefill.answers))}})`));
  await chrome.click('#pf-confirm-all');
  ok('全部照用後沒有待確認預填，送出掣可用', await chrome.ev(`!document.querySelector('[data-pf-confirm]')&&!document.querySelector('#intake-go').disabled`));
  await chrome.click('#intake-go'); await chrome.click('#intake-confirm');
  const closed = await waitFor(async () => (await main.ideate())?.state === 'closed');
  need('送出交資料後構思 closed', !!closed, await main.ideate());
  const overview = await waitFor(async () => { const s = await main.get('/api/status'); return s.intake?.state === 'done' ? s.intake : null; });
  need('交資料接續擬公司概覽', !!overview && !!read(path.join(main.data, 'company', 'page.json')), overview);
  const before = main.starts().length;
  const knownRuns = new Set((await main.get('/api/status')).runs.map(r => r.id));
  const late = await answer(main, p1);
  const lateRun = await waitFor(async () => (await main.get('/api/status')).runs.find(r => !knownRuns.has(r.id) && r.kind === 'ask' && r.ref === p1.id && ['done', 'failed'].includes(r.state)));
  ok('closed 後再答舊包不重開工作、不增加啟動次數', late.code === 200 && lateRun?.state === 'done' && (await main.ideate()).state === 'closed' && main.starts().length === before, { late, lateRun, before, after: main.starts().length });
  const rejected = await main.post('/api/intake', { kind: 'note', type: 'ideate', text: '另想一個' });
  ok('已有公司概覽拒收新構思，保持 closed', rejected.code === 400 && rejected.j.message === N.ui.ideateHasOverview && (await main.ideate()).state === 'closed', rejected);
} catch (error) { ok('完整構思鏈中斷', false, String(error.stack || error)); }

try {
  const recovery = await start(path.basename(RUN) + '/recovery', PORT + 2);
  const begin = await recovery.post('/api/intake', { kind: 'note', type: 'ideate', text: '' });
  need('無第一句線索仍可開始構思', begin.code === 202, begin);
  const first = await asking(recovery, 1);
  write(path.join(recovery.data, 'fake-mode.txt'), 'ideate-ask:fail\n');
  need('恢復案例第一步作答收到', (await answer(recovery, first)).code === 200);
  const failed = await waitFor(async () => { const s = await recovery.ideate(); return s?.state === 'failed' && s.reason ? s : null; });
  need('第二步 AI 失敗：failed 有原因', !!failed, await recovery.ideate());
  const prior = recovery.session(), answered = JSON.stringify(prior.rounds.find(r=>r.round === 1));
  await usePass(recovery.base, chrome);
  await chrome.go(recovery.base + '/#/intake');
  need('failed 頁面顯示原因及重試按鈕', await chrome.ev(`document.querySelector('#zero-think')?.textContent===${JSON.stringify(N.ui.ideateRetry)}&&document.querySelector('#zero-think-box').textContent.includes(${JSON.stringify(failed.reason)})`));
  await chrome.click('#zero-think');
  const second = await asking(recovery, 2);
  ok('再按由未完成第二步繼續，不重問第一步', recovery.session().id === prior.id && JSON.stringify(recovery.session().rounds.find(r=>r.round === 1)) === answered && second.ideate.round === 2 && recovery.actual().filter(a=>a.round === 1).length === 1, recovery.session());
  counted(recovery, '失敗及恢復的每次 AI 工作均計入 ai-starts.log');
} catch (error) { ok('失敗恢復鏈中斷', false, String(error.stack || error)); }

try {
  const unset = await start(path.basename(RUN) + '/unset', PORT + 3, false);
  const r = await unset.post('/api/intake', { kind: 'note', type: 'ideate', text: '未設定工具' });
  const status = await unset.get('/api/status');
  ok('AI 未設定時如實拒收及提供原因，不留下虛假 running 或啟動紀錄', r.code === 400 && r.j.error === 'ai' && r.j.message === N.ui.err_ai && !status.ai.ready && (await unset.ideate()) === null && unset.starts().length === 0 && unset.actual().length === 0, { r, ideate: await unset.ideate() });
} catch (error) { ok('未設定案例中斷', false, String(error.stack || error)); }
ok('瀏覽器沒有程式錯誤', !!chrome && !chrome.errors.length, chrome?.errors);
chrome?.close();
for (const child of servers) {
  if (child.exitCode !== null) continue;
  const ended = new Promise(resolve => child.once('exit', resolve)); child.kill();
  await Promise.race([ended, sleep(5000)]);
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + JSON.stringify(r.info ?? null)));
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r=>r.pass) ? 0 : 1;
