// 入門頁：首次導向、配對保護、示範入口同畫面互動。
// 用法：node welcome-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { certifyDirect, seedCompany, usePass } from '../lib/testkit.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
const NAMES = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const BASE = `http://127.0.0.1:${PORT}`, DATA = path.join(OUT, 'data');
const WELCOME_SEEN = path.join(DATA, 'founder', 'desk', 'welcome-seen.json');
const waitFor = async (fn, ms = 12000, step = 180) => {
  const until = Date.now() + ms;
  while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch { } await sleep(step); }
  return null;
};
const health = async origin => {
  try { const r = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(800) }); return r.ok ? await r.json() : null; } catch { return null; }
};
function start(data, port) {
  const env = { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' };
  delete env.CZ_NO_WELCOME; delete env.SOS_SIM; delete env.SOS_PORT;
  const child = spawn(process.execPath, [path.join(TEST_PROTO, 'server.mjs'), '--port', String(port)], { cwd: TEST_PROTO, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  return { child, log: () => log };
}
async function root(origin) { return fetch(origin + '/', { redirect: 'manual' }); }
async function post(origin, body, headers = {}) {
  const r = await fetch(origin + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { }
  return { code: r.status, j };
}
async function portsBefore() {
  const map = new Map();
  for (let port = 4380; port < 4390; port++) map.set(port, await health(`http://127.0.0.1:${port}`));
  return map;
}

fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const TEST_PROTO = path.join(OUT, 'prototype'); fs.cpSync(PROTO, TEST_PROTO, { recursive: true });
let main = null, certified = null, company = null, cdp = null, demo = null, demoBefore = new Map();
try {
  main = start(DATA, PORT);
  const mainHealth = await waitFor(() => health(BASE));
  if (!mainHealth) throw new Error('主測試伺服器未起');

  cdp = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
  // 頁面有平滑捲動：撳之前關掉，否則會撳錯位
  const rawClick = cdp.click; cdp.click = async sel => { await cdp.ev("document.documentElement.style.scrollBehavior='auto'"); return rawClick(sel); };

  // 未配對：兩個頁只顯示配對指引，亦唔寫已看紀錄。
  await cdp.go(BASE + '/welcome', 1440, 1800);
  const unpairedWelcome = await waitFor(() => cdp.ev(`(()=>{var e=document.getElementById('no-pass');return e&&!e.hidden?e.innerText:''})()`));
  const unpairedWelcomeSeen = fs.existsSync(WELCOME_SEEN);
  await cdp.go(BASE + '/', 1440, 1800);
  const unpairedRoot = await waitFor(() => cdp.ev(`(()=>{var e=document.getElementById('no-pass');return e&&!e.hidden?e.innerText:''})()`));
  ok('未配對：/welcome 和 / 都只顯示配對指引，沒有寫入已看紀錄', !!unpairedWelcome && !!unpairedRoot && !unpairedWelcomeSeen && !fs.existsSync(WELCOME_SEEN), { welcome: unpairedWelcome, root: unpairedRoot });

  await usePass(BASE, cdp);
  const first = await root(BASE);
  ok('全新已配對資料：/ 先轉去 /welcome', first.status === 302 && first.headers.get('location') === '/welcome', { status: first.status, location: first.headers.get('location') });
  await cdp.go(BASE + '/', 1440, 2200);
  const seen = (() => { try { return JSON.parse(fs.readFileSync(WELCOME_SEEN, 'utf8')); } catch { return null; } })();
  const repeat = await root(BASE);
  ok('首次開入門頁：留下 { at }；再開 / 留在 CrewZero', !!(seen && seen.at) && repeat.status === 200 && !String(repeat.headers.get('location') || '').includes('/welcome'), { seen, status: repeat.status });

  // 已認證同已有公司資料各自都唔彈；兩個資料夾都冇 welcome-seen.json。
  const CERT_DATA = path.join(OUT, 'certified-data'), CERT_PORT = Number(PORT) + 1, CERT_BASE = `http://127.0.0.1:${CERT_PORT}`;
  await certifyDirect(CERT_DATA, TEST_PROTO, ADAPTER);
  certified = start(CERT_DATA, CERT_PORT);
  const certHealth = await waitFor(() => health(CERT_BASE));
  await usePass(CERT_BASE, cdp);
  const certRoot = certHealth && await root(CERT_BASE);
  await cdp.go(CERT_BASE + '/welcome', 1440, 1700);
  const certButton = await cdp.ev(`(()=>{var e=document.querySelector('[data-welcome-setup]');return e?{text:e.textContent,href:e.getAttribute('href')}:null})()`);
  ok('已認證但未看過入門頁：/ 不轉向；按鈕改為「回到待決事項」（名稱表）', certRoot && certRoot.status === 200 && certButton && certButton.text === NAMES.ui.backDesk && certButton.href === '/', { status: certRoot && certRoot.status, certButton });

  const COMPANY_DATA = path.join(OUT, 'company-data'), COMPANY_PORT = Number(PORT) + 2, COMPANY_BASE = `http://127.0.0.1:${COMPANY_PORT}`;
  seedCompany(COMPANY_DATA, TEST_PROTO);
  company = start(COMPANY_DATA, COMPANY_PORT);
  const companyHealth = await waitFor(() => health(COMPANY_BASE));
  await usePass(COMPANY_BASE);
  const companyRoot = companyHealth && await root(COMPANY_BASE);
  ok('已有公司資料的實例：/ 不受首次入門導向影響', companyRoot && companyRoot.status === 200, { status: companyRoot && companyRoot.status });

  await cdp.go(BASE + '/welcome', 1440, 2200);
  const pictureWide = await cdp.ev(`(()=>({pics:[...new Set(Array.from(document.images).map(x=>x.getAttribute('src')).filter(x=>/crew-welcome-/.test(x)))],loaded:Array.from(document.images).filter(x=>/crew-welcome-/.test(x)).every(x=>x.naturalWidth>0),wide:document.documentElement.scrollWidth<=innerWidth}))()`);
  await cdp.shot(path.join(OUT, 'welcome-1440.png'), null, { full: true });
  await cdp.go(BASE + '/welcome', 390, 1800);
  const pictureNarrow = await cdp.ev(`document.documentElement.scrollWidth<=innerWidth`);
  await cdp.shot(path.join(OUT, 'welcome-390.png'), null, { full: true });
  ok('五張入門圖片全載入；1440 和 390 均沒有橫向捲動', pictureWide.pics.length === 5 && pictureWide.loaded && pictureWide.wide && pictureNarrow, { pictureWide, pictureNarrow });

  await cdp.go(BASE + '/welcome', 1440, 1600);
  await cdp.click('.tab[data-i="2"]');
  const afterClick = await cdp.ev(`Array.from(document.querySelectorAll('#frame img.on')).map(x=>x.getAttribute('src'))`);
  await cdp.ev(`(()=>{var e=document.querySelector('.tab[data-i="2"]');e.focus();e.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return 1})()`);
  const afterKey = await cdp.ev(`({on:Array.from(document.querySelectorAll('#frame img.on')).map(x=>x.getAttribute('src')),tab:document.activeElement.getAttribute('data-i')})`);
  ok('四個分頁可點擊及以方向鍵切換，每次只有一張桌面圖片顯示', afterClick.length === 1 && /boundary/.test(afterClick[0] || '') && afterKey.on.length === 1 && /unstuck/.test(afterKey.on[0] || '') && afterKey.tab === '3', { afterClick, afterKey });

  const setupLink = await cdp.ev(`(()=>{var e=document.querySelector('[data-welcome-setup]');return e?{text:e.textContent,href:e.getAttribute('href')}:null})()`);
  ok('未設定 AI 時「開始設定」連去 /#/setup', setupLink && setupLink.text === '開始設定' && setupLink.href === '/#/setup', setupLink);

  // 先用頁面自己嘅處理函式驗證進行同失敗文案，之後先真係開示範。
  await cdp.ev(`(()=>{window.__welcomeFetch=window.fetch;window.fetch=function(u,o){return String(u).indexOf('/api/setup')>=0&&o&&o.method==='POST'?Promise.resolve(new Response(JSON.stringify({ok:true}),{status:202,headers:{'Content-Type':'application/json'}})):window.__welcomeFetch.apply(this,arguments)};return 1})()`);
  await cdp.click('[data-welcome-demo]');
  const demoWorking = await cdp.ev(`Array.from(document.querySelectorAll('[data-welcome-demo]')).every(x=>x.textContent==='正在打開示範…')`);
  await cdp.go(BASE + '/welcome', 1440, 1300);
  await cdp.ev(`(()=>{window.__welcomeFetch=window.fetch;window.fetch=function(u,o){return String(u).indexOf('/api/setup')>=0&&o&&o.method==='POST'?Promise.resolve(new Response('{}',{status:500,headers:{'Content-Type':'application/json'}})):window.__welcomeFetch.apply(this,arguments)};return 1})()`);
  await cdp.click('[data-welcome-demo]'); await sleep(250);
  const demoFailed = await cdp.ev(`document.getElementById('demo-note').textContent`);
  await cdp.go(BASE + '/welcome', 1440, 1300);
  ok('示範按鈕會顯示進行中及失敗時的白話句', demoWorking && demoFailed === '暫時未能打開示範，請稍後再試。', { demoWorking, demoFailed });

  const noPassDemo = await post(BASE, { action: 'openDemo' }, { Cookie: '' });
  demoBefore = await portsBefore();
  const demoStart = await post(BASE, { action: 'openDemo' });
  const demoAgain = await post(BASE, { action: 'openDemo' });
  demo = await waitFor(async () => {
    for (let port = 4380; port < 4390; port++) {
      const current = await health(`http://127.0.0.1:${port}`), before = demoBefore.get(port);
      if (current && current.root !== mainHealth.root && (!before || before.pid !== current.pid)) return { port, health: current };
    }
    return null;
  }, 12000, 300);
  let demoInside = null;
  if (demo) {
    const origin = `http://127.0.0.1:${demo.port}`;
    await usePass(origin);
    demoInside = await post(origin, { action: 'openDemo' });
  }
  ok('openDemo：未配對拒絕；已配對後起另一個示範伺服器；十秒內重按受限；示範內拒絕', noPassDemo.code === 403 && demoStart.code === 202 && demoAgain.code === 429 && !!demo && demoInside && demoInside.code === 409, { noPass: noPassDemo.code, start: demoStart.code, again: demoAgain.code, demo: demo && { port: demo.port, root: demo.health.root }, inside: demoInside && demoInside.code });

  await cdp.go(BASE + '/', 1440, 2300);
  await cdp.click('#open-help');
  const helpLink = await cdp.ev(`!!document.querySelector('#help-modal a[href="/welcome"]')`);
  await cdp.click('#tool-more summary');
  const moreLink = await cdp.ev(`!!document.querySelector('#tool-more a[href="/welcome"]')`);
  ok('「需要幫助」和「更多」都有回到入門頁的連結', helpLink && moreLink, { helpLink, moreLink });

  const welcomeText = fs.readFileSync(path.join(TEST_PROTO, 'welcome.html'), 'utf8');
  ok('入門頁文字不含禁用字', !/陶土|陶泥|clay/i.test(welcomeText), (welcomeText.match(/陶土|陶泥|clay/ig) || []));
  ok('入門頁沒有程式錯誤', !cdp.errors.length, cdp.errors);
} catch (error) {
  ok('測試程式出錯', false, String(error && error.stack || error));
} finally {
  try { cdp && cdp.close(); } catch { }
  if (demo && !demoBefore.get(demo.port)) { try { process.kill(demo.health.pid); } catch { } }
  for (const server of [main, certified, company]) { try { server && server.child.kill(); } catch { } }
  await sleep(350);
}

const passed = results.filter(r => r.pass).length;
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info || null).slice(0, 1200)));
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
