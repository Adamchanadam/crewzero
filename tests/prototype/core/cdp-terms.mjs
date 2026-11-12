// 常用名稱表頁面：固定帳本資料配假 adapter，驗證畫面、三個創辦人操作與手機界限。
// 用法：node cdp-terms.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const run = fs.mkdtempSync(path.join(OUT, 'terms-')), DATA = path.join(run, 'data');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch {} await sleep(250); } return null; }

fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
seedCompany(DATA, PROTO);
const page = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
write(path.join(DATA, 'ledger', 'confirmed.json'), { pageId: page.page.id, confirmedAt: '2026-11-10T10:00:00+00:00', values: {}, order: (page.path?.milestones || []).map(m => m.id) });
write(path.join(DATA, 'ledger', 'state.json'), {
  schemaVersion: 1,
  intake: { state: 'complete' },
  company: {
    name: '測試公司', initials: '測試',
    actors: [{ id: 'pr-cdp', name: '測試客戶', label: '測試客戶', kind: 'customer', aliases: [], status: 'active', fromMilestoneIds: [], addedAt: '2026-11-01' }],
    terms: [
      { id: 'tn-doc', name: '月光禮盒', kind: 'product', aliases: ['月光盒'], addedAt: '2026-11-10', addedFrom: 'doc' },
      { id: 'tn-event', name: '秋日體驗會', kind: 'campaign', aliases: [], addedAt: '2026-11-08', addedFrom: 'event' }
    ]
  },
  tasks: [], events: [], inputs: [], milestones: [], interviews: { applied: {} }
});
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;

async function termId(name) { return chrome.ev(`(()=>{const row=[...document.querySelectorAll('[data-term]')].find(e=>e.textContent.includes(${JSON.stringify(name)}));return row&&row.getAttribute('data-term');})()`); }
async function removeTerm(id) {
  await chrome.click('#term-fix-' + id);
  await chrome.click('#term-remove-' + id);
  await chrome.click('#term-remove-submit');
  return waitFor(() => chrome.ev(`!document.querySelector('[data-term="' + ${JSON.stringify(id)} + '"]')`));
}
function cleanText(value) { return !/undefined|term_/.test(String(value || '')); }
function termsText() {
  return chrome.ev(`(()=>{const t=document.querySelector('#terms'),h=t&&t.querySelector('.sec-h'),a=t&&t.querySelector('[data-term="tn-doc"] .tmeta span');return {text:t&&t.innerText||'',title:h&&h.firstChild&&h.firstChild.textContent||'',intro:t&&t.querySelector('.terms-intro')&&t.querySelector('.terms-intro').textContent||'',add:t&&t.querySelector('#term-add')&&t.querySelector('#term-add').textContent||'',alias:a&&a.textContent||''};})()`);
}
function modalText() {
  return chrome.ev(`(()=>{const m=document.querySelector('#ppl-modal');return {text:m&&m.innerText||'',title:m&&m.querySelector('h2')&&m.querySelector('h2').textContent||'',body:m&&m.querySelector('p')&&m.querySelector('p').textContent||''};})()`);
}

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  await chrome.go(BASE + '/dashboard/brain/pipeline', 1440);
  ok('TP-01 名稱表顯示名稱、類別、別名、日期及來源', await waitFor(() => chrome.ev(`(()=>{const t=document.querySelector('#terms');return !!t&&t.innerText.includes('月光禮盒')&&t.innerText.includes('產品或服務')&&t.innerText.includes('另一個寫法：月光盒')&&t.innerText.includes('11 月 10 日')&&t.innerText.includes('來自你交出的文件');})()`)), await chrome.ev(`(document.querySelector('#terms')||{}).innerText||''`));
  const namedTerms = await termsText();
  const noTopLine = await chrome.ev(`[...document.querySelectorAll('#terms .term .tmeta')].length>0&&[...document.querySelectorAll('#terms .term .tmeta')].every(e=>getComputedStyle(e).borderTopWidth==='0px')`);
  await chrome.shot(path.join(OUT, 'terms-1440.png'), '#terms');
  await chrome.go(BASE + '/dashboard/brain/pipeline', 390);
  await waitFor(() => chrome.ev(`document.querySelectorAll('#terms .term').length > 0`));
  await chrome.shot(path.join(OUT, 'terms-named-390.png'), '#terms');
  await chrome.go(BASE + '/dashboard/brain/pipeline', 1440);
  await waitFor(() => chrome.ev(`document.querySelectorAll('#terms .term').length > 0`));
  await chrome.click('#term-add');
  ok('TP-02 新增名稱對話框顯示名稱欄及三個類別', await chrome.ev(`!!document.querySelector('#term-add-name')&&document.querySelectorAll('[data-term-kind]').length===3`));
  const addModal = await modalText();
  await chrome.shot(path.join(OUT, 'term-add-1440.png')); // 對話框固定置中：截可見視窗，不按元素裁切
  await chrome.type('#term-add-name', '冬日暖心套裝');
  await chrome.click('[data-term-kind="campaign"]');
  await chrome.click('#term-add-submit');
  const addedId = await waitFor(() => termId('冬日暖心套裝'));
  ok('TP-03 新增後即時更新名稱表', !!addedId && await chrome.ev(`document.querySelector('[data-term="' + ${JSON.stringify(addedId)} + '"]').innerText.includes('活動或計劃')`), addedId);
  await chrome.click('#term-fix-' + addedId);
  await chrome.click('#term-rename-' + addedId);
  ok('TP-04 改名稱對話框顯示舊名稱資料', await chrome.ev(`!!document.querySelector('#term-rename-name')&&document.querySelector('#ppl-modal').innerText.includes('冬日暖心套裝')`));
  const renameModal = await modalText();
  await chrome.shot(path.join(OUT, 'term-rename-1440.png')); // 對話框固定置中：截可見視窗，不按元素裁切
  await chrome.type('#term-rename-name', '冬日暖心套裝新版');
  await chrome.click('#term-rename-submit');
  ok('TP-05 改名稱後即時更新並保留舊寫法', await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('[data-term="' + ${JSON.stringify(addedId)} + '"]');return !!e&&e.innerText.includes('冬日暖心套裝新版')&&e.innerText.includes('另一個寫法：冬日暖心套裝');})()`)));
  await chrome.click('#term-fix-' + addedId);
  await chrome.click('#term-remove-' + addedId);
  ok('TP-06 刪除確認框顯示名稱及警告', await chrome.ev(`!!document.querySelector('#term-remove-submit')&&document.querySelector('#ppl-modal').innerText.includes('冬日暖心套裝新版')`));
  const removeModal = await modalText();
  await chrome.shot(path.join(OUT, 'term-remove-1440.png')); // 對話框固定置中：截可見視窗，不按元素裁切
  await chrome.click('#term-remove-submit');
  ok('TP-07 刪除後即時移除名稱', await waitFor(() => chrome.ev(`!document.querySelector('[data-term="' + ${JSON.stringify(addedId)} + '"]')`)));
  await removeTerm(await termId('月光禮盒'));
  await removeTerm(await termId('秋日體驗會'));
  ok('TP-08 沒有名稱時顯示空白說明，仍可新增', await waitFor(() => chrome.ev(`!!document.querySelector('#terms-empty')&&document.querySelector('#terms-empty').textContent===${JSON.stringify(N.ui.term_empty)}&&!!document.querySelector('#term-add')`)));
  const emptyTerms = await termsText();
  await chrome.go(BASE + '/dashboard/brain/pipeline', 390);
  await chrome.shot(path.join(OUT, 'terms-390.png'), '#terms');
  await chrome.click('#term-add');
  const mobile = await chrome.ev(`(()=>{const es=[document.querySelector('#term-add'),document.querySelector('#term-add-name'),...document.querySelectorAll('[data-term-kind]'),...document.querySelectorAll('.term-modal .btn')];return {overflow:document.documentElement.scrollWidth<=innerWidth,heights:es.map(e=>e&&e.getBoundingClientRect().height)};})()`);
  ok('TP-09 390 寬沒有橫向捲動，新按鈕、選項及輸入欄最少 44 像素', mobile.overflow && mobile.heights.every(height => height >= 44), mobile);
  await chrome.shot(path.join(OUT, 'term-add-390.png')); // 對話框固定置中：截可見視窗，不按元素裁切
  await chrome.type('#term-add-name', '春日手機套裝');
  await chrome.click('#term-add-submit');
  const mobileAddedId = await waitFor(() => termId('春日手機套裝'));
  if (!mobileAddedId) throw new Error('手機名稱未能加入');
  await chrome.click('#term-fix-' + mobileAddedId);
  await chrome.click('#term-rename-' + mobileAddedId);
  await chrome.shot(path.join(OUT, 'term-rename-390.png')); // 對話框固定置中：截可見視窗，不按元素裁切
  await chrome.click('#term-rename-submit');
  await waitFor(() => chrome.ev(`!document.querySelector('#ppl-modal')`));
  await chrome.click('#term-fix-' + mobileAddedId);
  await chrome.click('#term-remove-' + mobileAddedId);
  await chrome.shot(path.join(OUT, 'term-remove-390.png')); // 對話框固定置中：截可見視窗，不按元素裁切
  ok('TP-10 沒有腳本錯誤', chrome.errors.length === 0, chrome.errors);
  ok('TP-11 有名稱時名稱表字句正確，別名不是鍵名', cleanText(namedTerms.text) && namedTerms.title === N.ui.term_title && namedTerms.intro === N.ui.term_intro && namedTerms.add === N.ui.term_add && namedTerms.alias === N.t('term_alias', { a: '月光盒' }), namedTerms);
  ok('TP-16 名稱行中間欄沒有沿用其他元件的頂部邊線', noTopLine);
  ok('TP-12 新增名稱對話框字句正確', cleanText(addModal.text) && addModal.title.includes(N.ui.term_add) && addModal.body.includes(N.ui.term_addBody), addModal);
  ok('TP-13 改名稱對話框字句正確', cleanText(renameModal.text) && renameModal.title.includes(N.dash.ppl_fixRename) && renameModal.text.includes(N.ui.term_renameBody) && renameModal.text.includes(N.t('term_current', { n: '冬日暖心套裝' })), renameModal);
  ok('TP-14 刪除名稱對話框字句正確', cleanText(removeModal.text) && removeModal.title.includes(N.t('term_delTitle', { n: '冬日暖心套裝新版' })) && removeModal.body.includes(N.ui.term_delBody), removeModal);
  ok('TP-15 沒有名稱時名稱表字句正確', cleanText(emptyTerms.text) && emptyTerms.title === N.ui.term_title && emptyTerms.intro === N.ui.term_intro && emptyTerms.add === N.ui.term_add, emptyTerms);
} catch (error) {
  ok('頁面測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
  const pass = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + String(JSON.stringify(result.info ?? '')).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
