// 舊「和 Zero 一起想」相容性：0.44.0 收回舊問題包；五步新旅程由 cdp-journey.mjs 驗收。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { freshTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT_TEXT] = process.argv.slice(2);
const PORT = Number(PORT_TEXT), BASE = `http://127.0.0.1:${PORT}`, results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info: pass ? '' : info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const wait = async fn => { for (let i = 0; i < 80; i++) { if (await fn()) return true; await sleep(200); } return false; };

freshTestOut(OUT);
const RUN = makeTestTemp('crewzero-ideate-upgrade-'), DATA = path.join(RUN, 'data');
fs.mkdirSync(DATA, { recursive: true });
await certifyDirect(DATA, PROTO, ADAPTER);
const ideateFile = path.join(DATA, 'ledger', 'ideate.json');
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: 'ignore', windowsHide: true });
let chrome;
try {
  if (!await wait(async () => { try { return (await fetch(BASE + '/api/health')).ok; } catch { return false; } })) throw new Error('伺服器未起');
  chrome = await openChrome(CHROME, path.join(RUN, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  write(ideateFile, { id: 'old-running', state: 'running', say: '舊構思：按月寄新鮮咖啡豆。', updatedAt: new Date().toISOString() });
  const upgraded = await (await fetch(BASE + '/api/intake')).json();
  ok('舊 running 回傳升級後的 closed 狀態', upgraded.ideate?.v === 2 && upgraded.ideate.state === 'closed' && upgraded.ideate.reason === 'upgraded', upgraded.ideate);
  await chrome.go(BASE + '/#/intake', 1440, 900);
  ok('舊問題包不再出現，起點預填舊構思並提示升級', await chrome.ev(`document.querySelector('#jr-say')?.value==='舊構思：按月寄新鮮咖啡豆。'&&document.body.innerText.includes(${JSON.stringify('已改為逐步選卡')})&&!document.querySelector('#zero-think-box')`));
  write(ideateFile, { id: 'old-ready', state: 'ready', say: '舊 ready 構思', prefillId: 'old-prefill', updatedAt: new Date().toISOString() });
  const ready = await (await fetch(BASE + '/api/intake')).json();
  ok('舊 ready 保留原有預填入口，不轉成五步狀態', ready.ideate?.legacy === true && ready.ideate?.prefillId === 'old-prefill' && ready.ideate?.v == null, ready.ideate);
  ok('升級頁面沒有程式錯誤', !chrome.errors.length, chrome.errors);
} catch (error) { ok('舊格式相容性驗收中斷', false, String(error.stack || error)); }
chrome?.close(); server.kill();
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n' + result.info));
console.log(`${results.filter(result => result.pass).length}/${results.length} 通過`);
process.exitCode = results.every(result => result.pass) ? 0 : 1;
