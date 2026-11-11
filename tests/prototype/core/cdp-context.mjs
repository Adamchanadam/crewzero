// 會議紀錄資料脈絡頁面：直接寫測試世界，核對對照回饋卡及日程配對三選項題。
// 用法：node cdp-context.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
// 純函數：node cdp-context.mjs --pure <原型資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const PURE = process.argv[2] === '--pure';
const args = process.argv.slice(PURE ? 3 : 2);
const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = args;
const PURE_PROTO = PURE ? args[0] : PROTO;
const dash = await import(pathToFileURL(path.join(PURE_PROTO, 'dash-lib.mjs')).href);
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const compared = dash.inputView({ data: '.', ledger: '.' }, {
  id: 'in-filter', via: 'event', status: 'processed', files: [], effects: [],
  compare: [
    { now: 17, past: [{ quote: 18, from: 19 }, { quote: '第二句', from: '來源二' }, { quote: '第三句', from: '來源三' }, { quote: '應截斷', from: '來源四' }], note: 20 },
    { now: '第二項', past: [], note: '說明二' },
    { now: '第三項', past: [], note: '說明三' },
    { now: '應截斷', past: [], note: '說明四' }
  ]
}, {}, { detail: true });
ok('TX1 inputView 只交出字串化 compare 欄位，最多三項及每項三句以往原句',
  Array.isArray(compared.compare) && compared.compare.length === 3 && compared.compare[0].now === '17' && compared.compare[0].note === '20' &&
  compared.compare[0].past.length === 3 && compared.compare[0].past[0].quote === '18' && compared.compare[0].past[0].from === '19' &&
  compared.compare.every(row => Object.keys(row).sort().join(',') === 'note,now,past' && row.past.every(old => Object.keys(old).sort().join(',') === 'from,quote' && typeof old.quote === 'string' && typeof old.from === 'string')),
  compared.compare);

if (PURE) {
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}

const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH)/i.test(key)));
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const run = fs.mkdtempSync(path.join(OUT, 'context-')), DATA = path.join(run, 'data');
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
write(path.join(DATA, 'founder', 'inbox', 'in-context.md'), 'kind: event\n\n今次會議紀錄原話。');
write(path.join(DATA, 'ledger', 'state.json'), {
  schemaVersion: 1, intake: { state: 'complete' }, company: { name: '測試公司', initials: '測試', actors: [] }, tasks: [], events: [], milestones: [], interviews: { applied: {} },
  inputs: [{
    id: 'in-context', via: 'event', status: 'awaitingFounder', packId: 'ask-context', file: 'founder/inbox/in-context.md', title: '會議紀錄資料脈絡測試', eventDate: '2026-11-10', receivedAt: '2026-11-10T10:00:00+00:00', files: [], effects: [],
    read: { summary: 'Zero 已讀今次會議紀錄。', highlights: [] },
    compare: [
      { now: '今次付款改為貨到付款。', past: [{ quote: '以往付款可以月結。', from: '11 月 3 日會議紀錄' }], note: '付款安排與以往不同。' },
      { now: '今次試供改為兩批。', past: [{ quote: '以往只試供一批。', from: '11 月 3 日會議紀錄' }], note: '試供數量有改動。' },
      { now: '今次報價維持上次安排。', past: [{ quote: '以往淺烘豆每磅一百二十元。', from: '11 月 3 日會議紀錄' }, { quote: '以往深烘豆每磅一百三十元。', from: '11 月 3 日會議紀錄' }], note: '需核對今次所指報價。' }
    ]
  }]
});
write(path.join(DATA, 'asks', 'ask-context.json'), {
  id: 'ask-context', title: '日程對應測試', askedBy: 'AI', askedAt: '2026-11-10T10:00:00+00:00',
  questions: [
    {
      id: 'task-pair', priority: 1, ask: '工房丙的供貨報價改為 11 月 25 日前提供：更新原有一項日程？', kind: 'choice', effect: 'now', judge: '日程已有同一件事。更新原有一項，日程不會多出重複的項目。',
      pair: { old: { title: '工房丙提供首三個月供貨報價', date: '2026-11-18', from: '11 月 3 日會議紀錄' }, now: { text: '陳經理：提供首三個月供貨報價', date: '2026-11-25' } },
      options: [{ text: '更新原有一項，日期改為 11 月 25 日', rec: true }, { text: '這是另一件事，另加一項日程' }, { text: '不加入日程' }], value: '更新原有一項，日期改為 11 月 25 日'
    },
    { id: 'task-no-pair', priority: 2, ask: '是否加入另一項日程？', kind: 'choice', effect: 'now', options: [{ text: '加入', rec: true }, { text: '不加入' }], value: '加入' }
  ]
});

const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch {} await sleep(250); } return null; }
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...childEnv, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);

  await chrome.go(BASE + '/#/feedback/in-context', 1440);
  const compare = await waitFor(() => chrome.ev(`(()=>{const s=document.querySelector('#fb-compare'),items=[...document.querySelectorAll('#fb-compare .cmp')];return s&&items.length===3?{text:s.innerText,icons:[...document.querySelectorAll('#fb-card .fb-ic')].map(x=>x.textContent),past:items.map(x=>x.querySelectorAll('.past').length)}:null;})()`));
  ok('TX2 回饋卡在第二步後顯示資訊步、小字及三項對照，編號保持 1、2、i、3', !!compare && compare.text.includes('對照以往紀錄') && compare.text.includes('只供參考，不會改動任何紀錄') && compare.icons.join(',') === '1,2,i,3' && compare.past.join(',') === '1,1,2', compare);
  ok('TX3 三項對照均顯示今次原句、以往原句、出處及說明', !!compare && ['今次付款改為貨到付款。', '以往付款可以月結。', '付款安排與以往不同。', '今次試供改為兩批。', '以往只試供一批。', '試供數量有改動。', '今次報價維持上次安排。', '以往淺烘豆每磅一百二十元。', '以往深烘豆每磅一百三十元。', '需核對今次所指報價。', '11 月 3 日會議紀錄：'].every(text => compare.text.includes(text)), compare && compare.text);
  await chrome.shot(path.join(OUT, 'compare-1440.png'), '#fb-card');

  const stateFile = path.join(DATA, 'ledger', 'state.json'), noCompareState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  noCompareState.inputs.push({ ...noCompareState.inputs[0], id: 'in-no-compare', title: '沒有對照資料的會議紀錄' });
  delete noCompareState.inputs[1].compare;
  write(stateFile, noCompareState);
  await chrome.go(BASE + '/#/feedback/in-no-compare', 1440);
  const noCompare = await waitFor(() => chrome.ev(`!!document.querySelector('#fb-card')&&!document.querySelector('#fb-compare')`));
  ok('TX4 沒有 compare 的輸入不顯示對照步驟', !!noCompare, noCompare);

  await chrome.go(BASE + '/#/ask/ask-context', 1440);
  const paired = await waitFor(() => chrome.ev(`(()=>{const p=document.querySelector('#pair-task-pair');return p?{text:p.innerText,noPair:!!document.querySelector('#pair-task-no-pair'),before:p.previousElementSibling&&p.previousElementSibling.className,after:p.nextElementSibling&&p.nextElementSibling.className}:null;})()`));
  ok('TX5 三選項題在說明後、選項前顯示日程並排框，日期以月日格式顯示', !!paired && paired.text.includes('日程原有一項') && paired.text.includes('工房丙提供首三個月供貨報價') && paired.text.includes('11 月 18 日 · 來自 11 月 3 日會議紀錄') && paired.text.includes('今次會議紀錄') && paired.text.includes('陳經理：提供首三個月供貨報價') && paired.text.includes('11 月 25 日前') && !paired.noPair && paired.before === 'why' && /opt/.test(paired.after), paired);
  await chrome.shot(path.join(OUT, 'pair-1440.png'), '#q-task-pair');

  await chrome.go(BASE + '/#/feedback/in-context', 390);
  const compareMobile = await waitFor(() => chrome.ev(`!!document.querySelector('#fb-compare')&&document.documentElement.scrollWidth<=innerWidth`));
  ok('TX6 390 寬的回饋卡沒有橫向捲動', !!compareMobile, compareMobile);
  await chrome.shot(path.join(OUT, 'compare-390.png'), '#fb-card');

  await chrome.go(BASE + '/#/ask/ask-context', 390);
  const pairMobile = await waitFor(() => chrome.ev(`(()=>{const p=document.querySelector('#pair-task-pair'),opts=[...document.querySelectorAll('#q-task-pair .opt')];return p?{overflow:document.documentElement.scrollWidth<=innerWidth,stacked:getComputedStyle(p).gridTemplateColumns.split(' ').length===1,heights:opts.map(x=>x.getBoundingClientRect().height),text:document.body.innerText}:null;})()`));
  ok('TX7 390 寬的並排框改為上下排列，沒有橫向捲動，選項最少 44 像素', !!pairMobile && pairMobile.overflow && pairMobile.stacked && pairMobile.heights.every(height => height >= 44), pairMobile && { overflow: pairMobile.overflow, stacked: pairMobile.stacked, heights: pairMobile.heights });
  ok('TX8 頁面字句沒有 undefined 或名稱鍵名，並且沒有腳本錯誤', !!pairMobile && !/undefined|contextCompare|contextTask/.test(pairMobile.text) && chrome.errors.length === 0, { text: pairMobile && pairMobile.text, errors: chrome.errors });
  await chrome.shot(path.join(OUT, 'pair-390.png'), '#q-task-pair');
} catch (error) {
  ok('TX9 頁面測試程式沒有拋錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + String(JSON.stringify(result.info ?? '')).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
