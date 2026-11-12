// 生意類別測試：真實伺服器、瀏覽器及每週訪問流程。
// 用法：node biztype-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certify, certifyDirect, usePass, seedCompany } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), DATA = path.join(OUT, 'data'), OLD_DATA = path.join(OUT, 'old-data'), WEEK_DATA = path.join(OUT, 'week-data');
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const servers = [];
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const fence = String.fromCharCode(96).repeat(3);
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); };
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function start(data, port) {
  const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore' });
  servers.push(srv);
  return `http://127.0.0.1:${port}`;
}
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch { } await sleep(250); } return null; }
const post = async (base, body) => { const r = await fetch(base + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const status = async base => (await fetch(base + '/api/status')).json();
const submitAsk = async (base, pack, answers) => {
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
  const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + lib.localIso()];
  return fetch(base + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ kind: 'ask-answer', ref: pack.id, text: head.join('\n') + '\n\n# 答案\n\n' + fence + 'json\n' + JSON.stringify(machine) + '\n' + fence + '\n' }) });
};
const resultAsk = {
  platform: '這星期撮合了多少單？收到多少款項？',
  service: '這星期完成了多少次服務？收到多少款項？', goods: '這星期賣出多少件？收到多少款項？', online: '這星期有多少人使用？收到多少款項？', nonprofit: '這星期服務了多少人？取得多少資助或捐款？', other: '這星期有甚麼實際成果？（有數字請寫數字）'
};

freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
let chrome = null;
try {
  const base = start(DATA, PORT);
  await usePass(base);
  ok('主伺服器已啟動', !!await waitFor(async () => (await status(base)).ok));
  const invalid = await post(base, { bizType: 'invalid', fields: { q1: '測試' }, files: [] });
  const inherited = await post(base, { bizType: 'constructor', fields: { q1: '測試' }, files: [] });
  const tooLong = await post(base, { bizType: 'other', bizOther: '字'.repeat(61), fields: { q1: '測試' }, files: [] });
  const required = await post(base, { fields: { q1: '   ', q2: '只有對象' }, files: [] });
  ok('非法、繼承屬性及過長類別拒收；空白第 1 題拒收', [invalid, inherited, tooLong, required].every(x => x.code === 400) && /60/.test(tooLong.j?.message || ''), { invalid, inherited, tooLong, required });
  const spec = await (await fetch(base + '/api/intake')).json();
  ok('API 八題只有第 1 題必填，六類均用同一組題目', spec.questions.length === 8 && spec.questions.filter(q => q.required).map(q => q.n).join() === '1' && spec.bizTypes.length === 6 && Object.values(spec.questionsByBizType).every(q => JSON.stringify(q) === JSON.stringify(spec.questions)), spec);

  chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);
  await usePass(base, chrome);
  await chrome.go(base + '/#/intake');
  if (await chrome.ev(`!!document.querySelector('#intake-anyway')`)) await chrome.click('#intake-anyway');
  ok('交資料頁毋須選類別，八題用字及例子來自 API', await chrome.ev(`!document.querySelector('input[name="biz-type"]')&&${JSON.stringify(spec.questions)}.every(q=>document.querySelector('label[for="q'+q.n+'"]').textContent.includes(q.ask)&&document.querySelector('#q'+q.n).placeholder===(q.example?'例：'+q.example:''))`));
  await chrome.type('#q1', '用 AI 幫傳統小生意');
  ok('八題直接顯示，只有一題必填標記', await chrome.ev(`document.querySelectorAll('#intake-form .iq-q').length===8&&document.querySelectorAll('#intake-form .iq-q .qn').length===1`));
  await chrome.type('#q8', '先了解實際需要');
  await chrome.send('Page.reload'); await sleep(1600);
  ok('新草稿鍵保留第 1、8 題，毋須補選類別', await chrome.ev(`document.querySelector('#q1').value==='用 AI 幫傳統小生意'&&document.querySelector('#q8').value==='先了解實際需要'&&!!localStorage.getItem('startup-os-intake-draft-v2')&&!document.querySelector('input[name="biz-type"]')`));
  // 選填全留空仍可送出；必填一題的原話不得被機械改成 Zero。
  await chrome.type('#q8', '');
  await chrome.click('#intake-go'); await chrome.click('#intake-confirm');
  const intake = await waitFor(async () => { const s = await status(base); return s.intake?.state === 'waiting' ? s.intake : null; });
  ok('沒有類別、其餘留空可以送出；尚未擬草稿不寫 biz.json', !!intake && !fs.existsSync(path.join(DATA, 'company', 'biz.json')), intake);
  write(path.join(DATA, 'fake-mode.txt'), 'intake:intake-platform\n');
  const cert = await certify(base);
  ok('設定完成後接續交資料', cert.certify?.state === 'passed');
  const drafted = await waitFor(async () => { const s = await status(base); return s.intake?.state === 'done' ? s.intake : null; });
  const pageFile = path.join(DATA, 'company', 'page.json');
  const page = read(pageFile), biz = read(path.join(DATA, 'company', 'biz.json'));
  ok('新草稿 biz.type 寫入 biz.json，來源為 ai', !!drafted && biz.type === 'platform' && biz.source === 'ai', { drafted, biz });
  const archive = fs.readdirSync(path.join(DATA, 'archive'), { recursive: true }).map(String).find(f => f.endsWith('-intake.md'));
  const intakeText = archive && fs.readFileSync(path.join(DATA, 'archive', archive), 'utf8');
  ok('交資料封存有八題及原本 AI 生意描述，沒有虛構類別行', !!intakeText && intakeText.includes('用 AI 幫傳統小生意') && !intakeText.includes('生意類別：') && /"q8": ""/.test(intakeText), intakeText);
  const reading = page.detail.reading;
  const fields = reading.map(f => f.id);
  // 即使資料指定這些欄位為決定題，首屏也要排除。
  page.decide = { items: fields }; write(pageFile, page);
  await chrome.go(base + '/proofread.html');
  ok('生意模式十二欄存在詳情，biz.type、canvas.* 不進首屏決定題', reading.length === 12 && await chrome.ev(`${JSON.stringify(fields)}.every(id=>!document.getElementById('dq-'+id.replace(/[^a-zA-Z0-9_-]/g,'-')))&&document.body.innerText.includes(${JSON.stringify(lib.NAMES.ui.readingTitle)})`));
  // 恢復預設決定題後，經正常確認介面產出的相同契約修改類別。
  delete page.decide; write(pageFile, page);
  const f = reading.find(x => x.plan === 'biz.type');
  const machine = { format: 'startup-os.proofread-reply/0.1', confirmedAt: lib.localIso(), edits: [{ id: f.id, label: f.label, ai: f.value, value: lib.BIZ_TYPES.goods.label, founder: lib.BIZ_TYPES.goods.label }], order: page.path.milestones.map(m=>m.id), kinds: {}, stillMissing: [] };
  const head = ['kind: proofread', 'ref: '+page.page.id, 'hash: '+lib.fnv(JSON.stringify(page)), 'rev: 1'];
  const response = await fetch(base + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ kind: 'proofread', ref: page.page.id, text: head.join('\n')+'\n\n'+fence+'json\n'+JSON.stringify(machine)+'\n'+fence+'\n' }) });
  const founderBiz = await waitFor(() => { const b = read(path.join(DATA, 'company', 'biz.json')); return b.source === 'founder' ? b : null; });
  ok('確認公司概覽改類別，biz.json 改為 founder 來源', response.ok && founderBiz?.type === 'goods', founderBiz);
  await waitFor(async () => !(await status(base)).busy);
  const helpRequest = await post(base, { kind: 'note', type: 'help', text: '請說明下一步。' });
  const helpRun = await waitFor(async () => (await status(base)).runs?.find(r => r.kind === 'note' && r.ref === helpRequest.j?.id && ['done','failed'].includes(r.state)) || null);
  const helpBiz = helpRun && path.join(DATA, 'sandbox', helpRun.id, 'biz.md');
  ok('非交資料的求助工作同樣取得 biz.md 用字表', helpRequest.code === 202 && !!helpBiz && fs.existsSync(helpBiz) && /實體貨品/.test(fs.readFileSync(helpBiz, 'utf8')), helpRun);

  seedCompany(OLD_DATA, PROTO);
  const oldBase = start(OLD_DATA, PORT + 3);
  await usePass(oldBase, chrome);
  ok('舊資料的 /api/shell 不帶 bizType', !Object.prototype.hasOwnProperty.call((await (await fetch(oldBase + '/api/shell')).json()).company, 'bizType'));
  await chrome.go(oldBase + '/#/');
  ok('舊資料頁面正常，沒有強制補選類別', await chrome.ev(`!document.querySelector('#intake-form')&&!document.body.innerText.includes('你的生意屬於哪一類？')`));
  await post(oldBase, { kind: 'note', type: 'help', text: '請說明下一步。' });
  const oldSandbox = await waitFor(() => fs.existsSync(path.join(OLD_DATA, 'sandbox')) && fs.readdirSync(path.join(OLD_DATA, 'sandbox')).map(id => path.join(OLD_DATA, 'sandbox', id)).find(dir => fs.existsSync(dir)) || null);
  ok('沒有 biz.json 的舊資料不會在 AI 工作資料夾加入 biz.md', !!oldSandbox && !fs.existsSync(path.join(oldSandbox, 'biz.md')), oldSandbox);
  const prefill = await post(oldBase, { kind: 'prefill', bizType: 'goods', files: [{ name: '貨品資料.md', data: Buffer.from('# 貨品\n果醬').toString('base64') }] });
  const prefillSandbox = await waitFor(() => fs.readdirSync(path.join(OLD_DATA, 'sandbox')).map(id => path.join(OLD_DATA, 'sandbox', id)).find(dir => fs.existsSync(path.join(dir, 'questions.json')) && fs.existsSync(path.join(dir, 'biz.md')) && /實體貨品/.test(fs.readFileSync(path.join(dir, 'biz.md'), 'utf8'))) || null);
  ok('文件預填八題保持通用問法，同時提供已有類別用字表', prefill.code === 202 && !!prefillSandbox && read(path.join(prefillSandbox, 'questions.json'))[0].ask === lib.INTAKE_QUESTIONS[0].ask, prefillSandbox && read(path.join(prefillSandbox, 'questions.json')));

  await waitFor(async () => !(await status(oldBase)).busy);
  const savedBiz = '{"type":"service","other":"舊值","source":"founder"}';
  write(path.join(OLD_DATA, 'company', 'biz.json'), savedBiz);
  await certifyDirect(OLD_DATA, PROTO, ADAPTER);
  const redraft = await post(oldBase, { bizType: '', fields: { q1: '重新整理測試生意' }, files: [] });
  const redrafted = await waitFor(async () => { const s=await status(oldBase); return s.intake?.id===redraft.j?.id && s.intake.state==='done'; });
  ok('空白類別可送出；新草稿推斷不覆寫已有 biz.json', redraft.code === 202 && !!redrafted && fs.readFileSync(path.join(OLD_DATA, 'company', 'biz.json'), 'utf8') === savedBiz, redraft);

  const weekState = { schemaVersion: 1, tasks: [], events: [], company: { assumptions: [{ id: 'h1', text: '服務對象會參與', grade: 'guess', status: 'open' }] }, intake: { confirmedAt: '2000-01-01T00:00:00+00:00', answers: {} }, interviews: { nextOn: '2000-01-01', applied: {} } };
  write(path.join(WEEK_DATA, 'ledger', 'state.json'), weekState);
  const weekBase = start(WEEK_DATA, PORT + 5);
  await usePass(weekBase, chrome);
  let weekNo = 0;
  async function placeWeek(type) {
    const bizFile = path.join(WEEK_DATA, 'company', 'biz.json');
    if (type) write(bizFile, { type, other: '' }); else fs.rmSync(bizFile, { force: true });
    const s = read(path.join(WEEK_DATA, 'ledger', 'state.json')); s.interviews = { nextOn: '2000-01-' + String(++weekNo).padStart(2, '0'), applied: {} }; write(path.join(WEEK_DATA, 'ledger', 'state.json'), s);
    const before = new Set(fs.existsSync(path.join(WEEK_DATA, 'asks')) ? fs.readdirSync(path.join(WEEK_DATA, 'asks')) : []);
    await post(weekBase, { kind: 'note', type: 'help', text: '請說明本週安排。' });
    const file = await waitFor(() => fs.readdirSync(path.join(WEEK_DATA, 'asks')).find(f => !before.has(f)) || null);
    return file ? { file, pack: read(path.join(WEEK_DATA, 'asks', file)) } : null;
  }
  const servicePack = await placeWeek('service');
  ok('每週訪問的首題按服務類別設定，沒有 AI 預設', servicePack?.pack.questions[0]?.id === 'results' && servicePack.pack.questions[0].ask === resultAsk.service && !Object.hasOwn(servicePack.pack.questions[0], 'value') && !servicePack.pack.questions[0].noChange, servicePack?.pack.questions[0]);
  await chrome.go(weekBase + '/#/ask/' + servicePack.pack.id);
  await waitFor(async () => await chrome.ev(`!!document.querySelector('#q-results textarea')`));
  await chrome.click('#go-main'); await sleep(300);
  const requiredResultBlocked = await chrome.ev(`!document.querySelector('#do-confirm')`);
  const beforeResultAnswer = path.join(WEEK_DATA, 'ledger', 'answers', servicePack.pack.id + '.json');
  ok('每週成果未作答時不能採用 AI 建議，亦不會留下成果答案', requiredResultBlocked && (!fs.existsSync(beforeResultAnswer) || !read(beforeResultAnswer).answers.results), { requiredResultBlocked, beforeResultAnswer: fs.existsSync(beforeResultAnswer) ? read(beforeResultAnswer).answers : null });
  await chrome.click('#all-same'); await chrome.click('#do-confirm');
  const serviceAnswers = await waitFor(() => { const f = path.join(WEEK_DATA, 'ledger', 'answers', servicePack.pack.id + '.json'); return fs.existsSync(f) ? read(f).answers : null; });
  ok('「全部沒有變化」不會帶過每週成果題', !!serviceAnswers && !serviceAnswers.results && Object.keys(serviceAnswers).length > 0, serviceAnswers);
  const oldRunIds = new Set((await status(weekBase)).runs.filter(r => r.ref === servicePack.pack.id).map(r => r.id));
  const blankResult = await submitAsk(weekBase, servicePack.pack, [{ id: 'results', value: '   ', ai: '', changed: true }]);
  const blankRun = await waitFor(async () => (await status(weekBase)).runs.find(r => r.kind === 'ask' && r.ref === servicePack.pack.id && !oldRunIds.has(r.id) && r.state === 'done') || null);
  const afterBlankAnswers = read(beforeResultAnswer).answers;
  const afterBlankState = read(path.join(WEEK_DATA, 'ledger', 'state.json'));
  ok('空白每週成果不會入帳；同一次訪問仍可補答', blankResult.status === 200 && !!blankRun && !afterBlankAnswers.results && !afterBlankState.interviews.lastFor && afterBlankState.interviews.nextOn === servicePack.pack.rhythm.on, { status: blankResult.status, run: blankRun, answers: afterBlankAnswers, interviews: afterBlankState.interviews });
  const beforeResults = await waitFor(() => {
    const s = read(path.join(WEEK_DATA, 'ledger', 'state.json'));
    return s.interviews && (s.interviews.applied || {})[servicePack.pack.id] ? s : null;
  });
  ok('成果題未填寫時，首次訪問仍未完成且下次日期不變', !!beforeResults && !beforeResults.interviews.lastOn && !beforeResults.interviews.lastFor && !beforeResults.interviews.count && beforeResults.interviews.nextOn === servicePack.pack.rhythm.on, beforeResults && beforeResults.interviews);
  await chrome.go(weekBase + '/#/');
  await chrome.go(weekBase + '/#/ask/' + servicePack.pack.id);
  await chrome.type('#q-results textarea', '本週完成 3 次服務，收到 900 元'); await chrome.click('#go-main'); await sleep(300);
  ok('已輸入但未按記錄的每週成果會在送出前記錄', await chrome.ev(`!!document.querySelector('#do-confirm')`));
  await chrome.click('#do-confirm');
  const resultEvent = await waitFor(() => { const s = read(path.join(WEEK_DATA, 'ledger', 'state.json')); return (s.events || []).find(e => e.title === '本週成果：本週完成 3 次服務，收到 900 元') || null; });
  const afterResults = read(path.join(WEEK_DATA, 'ledger', 'state.json'));
  const grade = afterResults.company.assumptions[0].grade;
  const record = path.join(WEEK_DATA, 'work', 'interviews', servicePack.pack.rhythm.on + '.md');
  ok('每週成果答案寫入事件與訪問紀錄，才完成訪問並推進下次日期，不改變證據級', !!resultEvent && afterResults.interviews.lastFor === servicePack.pack.rhythm.on && afterResults.interviews.nextOn !== servicePack.pack.rhythm.on && grade === 'guess' && fs.existsSync(record) && fs.readFileSync(record, 'utf8').includes('本週完成 3 次服務，收到 900 元'), { resultEvent, interviews: afterResults.interviews, grade, record });
  for (const type of ['goods', 'online', 'platform', 'nonprofit', 'other']) {
    const placed = await placeWeek(type);
    ok(`每週訪問的首題按 ${type} 類別設定`, placed?.pack.questions[0]?.ask === resultAsk[type], placed?.pack.questions[0]);
    if (placed) write(path.join(WEEK_DATA, 'ledger', 'answers', placed.pack.id + '.json'), { answers: Object.fromEntries(placed.pack.questions.map(q => [q.id, { value: '沒有' }])) });
  }
  const noBizPack = await placeWeek(null);
  ok('沒有類別時每週成果題使用通用寫法', noBizPack?.pack.questions[0]?.ask === resultAsk.other, noBizPack?.pack.questions[0]);
  ok('瀏覽器沒有程式錯誤', !chrome.errors.length, chrome.errors);
} catch (error) {
  ok('測試程式出錯', false, String(error?.stack || error));
} finally {
  try { chrome?.close(); } catch { }
  for (const srv of servers) try { srv.kill(); } catch { }
}
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info ?? null).slice(0, 900)));
const passed = results.filter(r => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
