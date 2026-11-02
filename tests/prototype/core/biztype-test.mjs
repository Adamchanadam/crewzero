// 生意類別測試：真實伺服器、瀏覽器及每週訪問流程。
// 用法：node biztype-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass, seedCompany } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), DATA = path.join(OUT, 'data'), OLD_DATA = path.join(OUT, 'old-data'), WEEK_DATA = path.join(OUT, 'week-data');
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const servers = [];
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
const questions = {
  service: ['提供甚麼服務', '如何收費'], goods: ['賣甚麼貨品', '定價多少'], online: ['提供甚麼內容', '如何收費'], nonprofit: ['計劃做甚麼', '資金來自哪裏'], other: ['你提供甚麼', '如何收取款項']
};
const resultAsk = {
  service: '這星期完成了多少次服務？收到多少款項？', goods: '這星期賣出多少件？收到多少款項？', online: '這星期新增多少使用者或觀看？收到多少款項？', nonprofit: '這星期服務了多少人？取得多少資助或捐款？', other: '這星期有甚麼實際成果？（有數字請寫數字）'
};

fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
let chrome = null;
try {
  const base = start(DATA, PORT);
  await usePass(base);
  ok('主伺服器已啟動', !!await waitFor(async () => (await status(base)).ok));
  const missing = await post(base, { fields: { q1: '測試' }, files: [] });
  const invalid = await post(base, { bizType: 'invalid', fields: {}, files: [] });
  const inherited = await post(base, { bizType: 'constructor', fields: {}, files: [] });
  const tooLong = await post(base, { bizType: 'other', bizOther: '字'.repeat(61), fields: {}, files: [] });
  ok('缺少、非法、繼承屬性及過長的生意類別一律拒收並說明原因', missing.code === 400 && missing.j?.message === '請先選擇你的生意類別。' && invalid.code === 400 && inherited.code === 400 && tooLong.code === 400 && /60/.test(tooLong.j?.message || ''), { missing, invalid, inherited, tooLong });

  chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);
  await usePass(base, chrome);
  await chrome.go(base + '/#/intake');
  if (await chrome.ev(`!!document.querySelector('#intake-anyway')`)) await chrome.click('#intake-anyway');
  for (const type of Object.keys(questions)) {
    await chrome.ev(`document.querySelector('input[name="biz-type"][value="${type}"]').click()`);
    const actual = await waitFor(async () => { const q = await chrome.ev(`['label[for="q1"]','label[for="q2"]'].map(s=>document.querySelector(s).innerText)`); return q[0].includes(questions[type][0]) && q[1].includes(questions[type][1]) ? q : null; });
    ok(`交資料頁：${type} 類別的第 1、2 題用字正確`, actual[0].includes(questions[type][0]) && actual[1].includes(questions[type][1]), actual);
  }
  await chrome.ev(`document.querySelector('input[name="biz-type"][value="service"]').click()`); await waitFor(async () => (await chrome.ev(`document.querySelector('label[for="q1"]').innerText`)).includes('提供甚麼服務'));
  await chrome.type('#q1', '保留中的服務內容');
  const beforeTypeChange = await chrome.ev(`(()=>{const details=document.querySelector('details.iq-opt');details.open=true;window.scrollTo(0,180);return {scrollY:window.scrollY,open:details.open};})()`);
  await chrome.ev(`document.querySelector('input[name="biz-type"][value="goods"]').click()`); await waitFor(async () => (await chrome.ev(`document.querySelector('label[for="q1"]').innerText`)).includes('賣甚麼貨品'));
  ok('切換類別不會清除已填內容', await chrome.ev(`document.querySelector('#q1').value`) === '保留中的服務內容');
  const afterTypeChange = await chrome.ev(`(()=>{const details=document.querySelector('details.iq-opt');return {scrollY:window.scrollY,open:details.open,q1:document.querySelector('#q1').value,required:(document.querySelector('label[for="q1"] .qn')||{}).innerText||''};})()`);
  ok('切換類別只更新題目內容，保留捲動位置、選填區、輸入內容及必填標記', beforeTypeChange.scrollY > 0 && afterTypeChange.scrollY === beforeTypeChange.scrollY && afterTypeChange.open && afterTypeChange.q1 === '保留中的服務內容' && afterTypeChange.required.includes('必填'), { beforeTypeChange, afterTypeChange });
  const nativeRadio = await chrome.ev(`(()=>{const s=getComputedStyle(document.querySelector('input[name="biz-type"]'));return {opacity:s.opacity,width:parseFloat(s.width),height:parseFloat(s.height)};})()`);
  ok('生意類別只顯示自訂圓點，原生圓點仍可鍵盤操作', nativeRadio.opacity === '0' || nativeRadio.width <= 1 || nativeRadio.height <= 1, nativeRadio);
  await chrome.send('Page.reload'); await sleep(1600);
  ok('重新載入後草稿保留已選類別與內容', await chrome.ev(`document.querySelector('input[name="biz-type"][value="goods"]').checked&&document.querySelector('#q1').value==='保留中的服務內容'`));
  const genericText = await chrome.ev(`document.body.innerText`);
  ok('通用版本已沒有舊診所預約例子', !genericText.includes('診所') && !genericText.includes('預約流程'), genericText.slice(0, 800));
  await chrome.ev(`document.querySelector('input[name="biz-type"][value="nonprofit"]').click()`); await waitFor(async () => (await chrome.ev(`document.querySelector('label[for="q1"]').innerText`)).includes('計劃做甚麼'));
  const nonprofitText = await chrome.ev(`document.querySelector('#intake-form').innerText`);
  ok('非牟利版本第 1、2 題不含客戶、收入或產品', !['客戶', '收入', '產品'].some(x => nonprofitText.includes(x)), nonprofitText);

  await chrome.ev(`document.querySelector('input[name="biz-type"][value="goods"]').click()`); await waitFor(async () => (await chrome.ev(`document.querySelector('label[for="q1"]').innerText`)).includes('賣甚麼貨品'));
  const answers = ['本地果醬', '每瓶售 68 元，成本 24 元', '已有兩人預訂', '本週到市集擺檔', '我與一位工匠合作'];
  for (let i = 0; i < answers.length; i++) await chrome.type('#q' + (i + 1), answers[i]);
  await chrome.click('#intake-go'); await chrome.click('#intake-confirm');
  const intake = await waitFor(async () => { const s = await status(base); return s.intake?.runId ? s.intake : null; });
  const archived = await waitFor(() => fs.readdirSync(path.join(DATA, 'archive'), { recursive: true }).map(String).find(x => x.endsWith('-intake.md')) || null);
  const shell = await (await fetch(base + '/api/shell')).json();
  const biz = read(path.join(DATA, 'company', 'biz.json'));
  ok('提交後寫入正確的 biz.json、intake.md 類別行及公司資料 bizType', biz.type === 'goods' && biz.other === '' && !!archived && fs.readFileSync(path.join(DATA, 'archive', archived), 'utf8').includes('生意類別：實體貨品') && shell.company.bizType === 'goods', { biz, archived, company: shell.company });
  const sandbox = await waitFor(() => intake && fs.existsSync(path.join(DATA, 'sandbox', intake.runId, 'biz.md')) ? path.join(DATA, 'sandbox', intake.runId, 'biz.md') : null);
  ok('AI 工作資料夾在共用位置取得 biz.md 用字表', !!sandbox && /類別：實體貨品/.test(fs.readFileSync(sandbox, 'utf8')) && /賣出件數/.test(fs.readFileSync(sandbox, 'utf8')), sandbox && fs.readFileSync(sandbox, 'utf8'));
  await post(base, { kind: 'note', type: 'help', text: '請說明下一步。' });
  const helpBiz = await waitFor(() => fs.existsSync(path.join(DATA, 'sandbox')) && fs.readdirSync(path.join(DATA, 'sandbox')).map(id => path.join(DATA, 'sandbox', id, 'biz.md')).find(file => fs.existsSync(file) && /類別：實體貨品/.test(fs.readFileSync(file, 'utf8'))) || null);
  ok('非交資料的求助工作同樣取得 biz.md 用字表', !!helpBiz, helpBiz);

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
  ok('文件預填按已選類別寫 questions.json，未選類別才用通用題目', prefill.code === 202 && !!prefillSandbox && read(path.join(prefillSandbox, 'questions.json'))[0].ask.includes('賣甚麼貨品'), prefillSandbox && read(path.join(prefillSandbox, 'questions.json')));

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
  for (const type of ['goods', 'online', 'nonprofit', 'other']) {
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
