// 新手收尾：以真實伺服器及瀏覽器核對第一天的必要出口。
// 用法：node novice-test.mjs <chrome> <輸出> <原型> <假 adapter> <port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certify, seedCompany, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_ARG] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT, DATA = path.join(OUT, 'data');
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const waitFor = async (fn, ms = 30000) => { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(250); } return null; };
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
try {
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1); await usePass(BASE, chrome);
  await chrome.go(BASE + '/#/intake');
  const blocked = await waitFor(() => chrome.ev(`({card:!!document.querySelector('#intake-setup-first'),form:!!document.querySelector('#intake-form'),any:document.querySelector('#intake-anyway')?.textContent})`));
  ok('未設定 AI 時交資料頁只顯示設定卡和次要入口', blocked?.card && !blocked?.form && blocked.any === '先填寫資料（設定 AI 工具後才會處理）', blocked);
  await chrome.click('#intake-anyway');
  ok('按次要入口後展開交資料表格', !!await waitFor(() => chrome.ev(`!!document.querySelector('#intake-form')`)), null);
  await chrome.type('#q1', '保留中的草稿');
  await chrome.go(BASE + '/#/intake');
  ok('已有草稿時重新載入直接顯示交資料表格', !!await waitFor(() => chrome.ev(`!!document.querySelector('#intake-form')`)), null);

  await chrome.ev(`localStorage.removeItem('startup-os-intake-draft')`);
  await certify(BASE);
  await chrome.go(BASE + '/#/intake');
  const certified = await waitFor(() => chrome.ev(`({card:!!document.querySelector('#intake-setup-first'),form:!!document.querySelector('#intake-form')})`));
  ok('已設定 AI 時直接顯示交資料表格', certified?.form && !certified?.card, certified);
  await chrome.go(BASE + '/#/setup');
  const setupText = await waitFor(() => chrome.ev(`document.body.innerText`));
  ok('設定頁說明 AI 只處理 CrewZero 的工作', String(setupText || '').includes('只處理 CrewZero 的工作'), setupText);
  await chrome.ev(`document.querySelector('#tool-more').open=true`);
  await chrome.click('#open-phone');
  await chrome.click('.pair-modal .btn.primary.big');
  await waitFor(() => chrome.ev(`!!document.querySelector('.pair-qr')`));
  await chrome.ev(`window.__noviceDateNow=Date.now;Date.now=function(){return window.__noviceDateNow()+60001;}`);
  const phoneHint = await waitFor(() => chrome.ev(`document.querySelector('.phone-bar')?.innerText`));
  ok('等待 60 秒的手機配對指引：說明私人 Wi-Fi、訪客網絡、Windows 網絡設定和允許連線', String(phoneHint || '').includes('私人 Wi-Fi') && String(phoneHint || '').includes('訪客網絡會隔離裝置') && String(phoneHint || '').includes('設定」＞「網絡和網際網路') && String(phoneHint || '').includes('允許連線'), phoneHint);
  await chrome.ev(`if(window.__noviceDateNow)Date.now=window.__noviceDateNow;`);
  await chrome.ev(`document.querySelector('.pair-modal .btn:last-child')?.click()`);

  seedCompany(DATA, PROTO);
  fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'ledger', 'confirmed.json'), JSON.stringify({ confirmedAt: new Date().toISOString() }));
  fs.writeFileSync(path.join(DATA, 'ledger', 'state.json'), JSON.stringify({ company: { name: '', initials: '', rhythm: { runCadence: 'weekly', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } }, interviews: { nextOn: '2099-01-05', applied: {} }, tasks: [], events: [] }));
  await chrome.go(BASE + '/#/');
  const waitCard = await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#today-card');const a=c&&c.querySelector('a');return c?{text:c.innerText,href:a&&a.getAttribute('href')}:null})()`));
  ok('首次訪問未到時提供日期與可用的「發生了一件事」入口', !!waitCard && waitCard.text.includes('首次每週訪問在 1 月 5 日') && waitCard.href === '#/request/event', waitCard);
  await chrome.click('#today-card a');
  ok('首次訪問未到的入口（舊網址 #/request/event）回到首頁，並選好「發生了一件事」、展開表格', !!await waitFor(() => chrome.ev(`location.hash==='#/'&&!!document.querySelector('#tell-form')&&!document.querySelector('#tell-form').hidden&&document.querySelector('#quick-event').getAttribute('aria-pressed')==='true'`)), await chrome.ev(`location.hash+' '+((document.querySelector('#quick-event')||{}).className||'')`));
  fs.mkdirSync(path.join(DATA, 'asks'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'asks', 'ask-novice-interview.json'), JSON.stringify({ id: 'ask-novice-interview', title: '首次每週訪問', askedBy: 'AI', askedAt: new Date().toISOString(), todoType: 'interview', due: '2099-01-05', rhythm: { kind: 'interview', on: '2099-01-05' }, questions: [{ id: 'progress', ask: '本週有甚麼真實進展？', kind: 'text', priority: 1 }] }));
  await chrome.go(BASE + '/#/');
  await chrome.send('Page.reload'); await sleep(1600);
  const interviewCard = await waitFor(() => chrome.ev(`(()=>{const c=document.querySelector('#today-card');const a=c&&c.querySelector('#today-go');return c?{text:c.innerText,href:a&&a.getAttribute('href')}:null})()`));
  ok('放入訪問問題包後改為開始訪問', !!interviewCard && interviewCard.text.includes('開始訪問') && interviewCard.href === '#/ask/ask-novice-interview', interviewCard);
  await chrome.click('#today-go');
  ok('開始訪問入口可打開問題頁', !!await waitFor(() => chrome.ev(`location.hash==='#/ask/ask-novice-interview'&&!!document.querySelector('#go-main')`)), null);

  await chrome.go(BASE + '/dashboard');
  const mark = await waitFor(() => chrome.ev(`document.querySelector('#co-mark')?.textContent?.trim()`));
  ok('未填公司名稱時標記顯示 CZ', mark === 'CZ', mark);
  const dashboardText = await waitFor(() => chrome.ev(`document.body.innerText`));
  ok('公司概覽不顯示內部技術詞', !/(子代理|會話|亮線|粒子)/.test(String(dashboardText || '')), dashboardText);
  await chrome.go(BASE + '/#/', 1440, 3000);
  const teleText = await waitFor(() => chrome.ev(`(document.querySelector('[data-tele]')||{}).textContent||''`));
  ok('待決事項頁的 AI 工作次數使用短句而沒有「啟動」', String(teleText || '').includes(N.dash.startsTodayL.split('{a}')[0]) && String(teleText || '').includes('次') && !String(teleText || '').includes('啟動'), teleText);
  await chrome.go(BASE + '/dashboard/system');
  const systemText = await waitFor(() => chrome.ev(`document.body.innerText`));
  ok('系統頁說明公司資料只存放在這部電腦', String(systemText || '').includes(N.ui.sysData) && N.ui.sysData.includes('公司資料只存放在這部電腦'), systemText);

  await chrome.go(BASE + '/#/setup');
  await waitFor(() => chrome.ev(`!!document.querySelector('#tool-more')`));
  await chrome.ev(`document.querySelector('#tool-more').open=true`);
  await chrome.click('#open-phone');
  await chrome.click('.pair-modal .btn.primary.big');
  const qrReady = await waitFor(() => chrome.ev(`!!document.querySelector('.pair-qr')`));
  if (!qrReady) throw new Error('沒有產生手機配對二維碼');
  await chrome.ev(`window.__noviceDateNow=Date.now;Date.now=function(){return window.__noviceDateNow()+600001;}`);
  await sleep(1200);
  const expired = await waitFor(() => chrome.ev(`!!document.querySelector('#phone-new-code')`), 3000);
  ok('二維碼失效後顯示產生新二維碼按鈕', !!expired, expired);
  if (expired) {
    await chrome.ev(`Date.now=window.__noviceDateNow`);
    await chrome.click('#phone-new-code');
    ok('按產生新二維碼後恢復配對二維碼', !!await waitFor(() => chrome.ev(`!!document.querySelector('.pair-qr')&&!document.querySelector('#phone-new-code')`)), null);
  }
  await chrome.ev(`if(window.__noviceDateNow)Date.now=window.__noviceDateNow;`);

  const installRoot = path.join(OUT, 'install-root'); fs.mkdirSync(installRoot, { recursive: true });
  const installed = spawnSync(process.execPath, [path.join(PROTO, 'install.mjs'), installRoot], { cwd: PROTO, encoding: 'utf8', windowsHide: true });
  const installText = String(installed.stdout || '');
  ok('安裝完成提示提供重新打開入口而沒有內部名稱', installed.status === 0 && installText.includes('打開 CrewZero') && !/VERSION|START-HERE|程式檔/.test(installText), { code: installed.status, text: installText });
  ok('瀏覽器沒有程式錯誤', !chrome.errors.length, chrome.errors);
} catch (error) {
  ok('測試程式出錯', false, String(error?.stack || error));
} finally {
  try { chrome?.close(); } catch { }
  try { server.kill(); } catch { }
}
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info || null).slice(0, 900)));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
process.exit(results.every(r => r.pass) ? 0 : 1);
