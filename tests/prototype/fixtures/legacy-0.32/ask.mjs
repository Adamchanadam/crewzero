// startup-os 問題包入口（唔綁定 AI）：將一個問題包放上 Founder Desk，開頁面畀創辦人答。
// 用法：node ask.mjs --desk              打開 Founder Desk（冇開就喺背景開，唔使任何視窗）
//       node ask.mjs --dashboard         打開營運監察台（同一個伺服器）；加 --demo 開虛構示範（加 --reset-demo 重建）
//       node ask.mjs --dashboard --brain <資料夾>   生意大腦讀取一個試驗資料夾（只讀）；--brain off 取消
//       node ask.mjs --dashboard --observe <資料夾> 登記公司工作資料夾，作業網顯示入面嘅本機 AI 會話（只讀）；--observe off／on 關閉或開啟觀測
//       node ask.mjs <問題包.json>      放上去並打開頁面
//       node ask.mjs <問題包.json> --no-open
//       node ask.mjs --list              列出等緊答嘅問題包
//       node ask.mjs --dashboard --sim <實例資料夾>   模擬實例（資料喺 <實例>/data，預設 4650；假 AI 喺 <實例>/../tools）
// 格式同出題規則：ask-format.md。超過 12 條會按優先自動拆包；答過嘅題目會自動拎走。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDirs, preparePacks, placePacks, listPacks, rootId, SERVER_VERSION, BASE_PORT } from './ask-lib.mjs';
import { seedDemo, DEMO_DIR } from './demo-seed.mjs';
import { folderHash } from './folder-hash.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
// 示範（虛構公司「從田間到餐桌」）：用另一個資料夾，唔會郁真實資料；未有就建
if (args.includes('--demo')) { process.env.SOS_DATA = DEMO_DIR; seedDemo(DEMO_DIR, { copyCert: true, reset: args.includes('--reset-demo') }); }
// 模擬實例（設計稿第 8 節）：獨立資料夾、模擬時鐘、預設 4650；唔係生意證據
const si = args.indexOf('--sim');
const PORT0 = si >= 0 ? 4650 : BASE_PORT;
if (si >= 0) {
  const inst = path.resolve(args[si + 1] || '.'), fake = path.join(inst, '..', 'tools', 'adapter-fake.json');
  process.env.SOS_SIM = '1'; process.env.SOS_DATA = path.join(inst, 'data');
  if (fs.existsSync(fake)) process.env.SOS_ADAPTER = fake;
}
const DIR = dataDirs(ROOT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findServer() {
  for (let p = PORT0; p < PORT0 + 10; p++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${p}/api/status`, { signal: AbortSignal.timeout(800) })).json();
      if (j && j.version === SERVER_VERSION && j.root === rootId(DIR.data)) return `http://127.0.0.1:${p}/`;
    } catch { }
  }
  return null;
}
async function ensureServer() {
  let url = await findServer();
  if (url) return url;
  spawn(process.execPath, [path.join(ROOT, 'server.mjs'), ...(si >= 0 ? ['--port', String(PORT0)] : [])], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 20 && !url; i++) { await sleep(500); url = await findServer(); }
  return url;
}
function openBrowser(url) {
  if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

// 生意大腦本機選項：指向一個試驗資料夾（只讀固定檔名）；--brain off 取消
// 規劃書 4.6、4.9：以「存在即失敗」新增 founder/desk/brain-source-<時間>.json，最新一份為準；取消都係再新增一份
const bi = args.indexOf('--brain');
if (bi >= 0) {
  const target = args[bi + 1] || '';
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const cfg = path.join(DIR.data, 'founder', 'desk', `brain-source-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}-${String(t.getMilliseconds()).padStart(3, '0')}.json`);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  if (target === 'off') { fs.writeFileSync(cfg, JSON.stringify({ off: true, setAt: t.toISOString() }), { flag: 'wx' }); console.log('生意大腦：已取消讀取試驗資料夾。'); }
  else {
    const dir = path.resolve(target);
    let isDir = false; try { isDir = fs.statSync(dir).isDirectory(); } catch { }
    if (!isDir) { console.log('生意大腦：找不到此資料夾：' + dir); process.exit(1); }
    fs.writeFileSync(cfg, JSON.stringify({ dir, setAt: t.toISOString() }), { flag: 'wx' });
    console.log('生意大腦：將讀取 ' + dir + '（只讀）');
  }
}
// 觀測來源：登記公司工作資料夾（可以登記多個）；監察台只顯示呢啲資料夾入面嘅本機 AI 會話；--observe off 關閉觀測、--observe on 重新開啟
// 同系統頁同一條路（規劃書 4.12、附錄 A observe）：只寫 founder/desk/observe-<時間>.json（雜湊同顯示名，唔寫路徑），即刻叫外殼套用入帳本
const oi = args.indexOf('--observe');
if (oi >= 0) {
  const target = args[oi + 1] || '';
  const desk = path.join(DIR.data, 'founder', 'desk');
  fs.mkdirSync(desk, { recursive: true });
  let rec;
  if (target === 'off' || target === 'on') rec = { op: target };
  else {
    const dir = path.resolve(target);
    let isDir = false; try { isDir = fs.statSync(dir).isDirectory(); } catch { }
    if (!isDir) { console.log('觀測來源：找不到此資料夾。'); process.exit(1); }
    rec = { op: 'add', hash: folderHash(dir), name: path.basename(dir) };
  }
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const name = `observe-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}-${String(t.getMilliseconds()).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(desk, name), JSON.stringify({ ...rec, at: t.toISOString() }) + '\n', { flag: 'wx' });
  // 外殼第一步套用（唔開 AI）；外殼做緊其他工作就下一次先套用
  spawnSync(process.execPath, [path.join(ROOT, 'run.mjs')], { stdio: 'ignore', windowsHide: true, env: process.env });
  const left = fs.readdirSync(desk).filter(f => /^observe-[\w-]+\.json$/.test(f)).length;
  console.log('觀測來源：' + (rec.op === 'off' ? '已關閉觀測' : rec.op === 'on' ? '已開啟觀測' : '已登記「' + rec.name + '」') + (left ? '（稍後生效）' : ''));
}
if (args.includes('--desk') || args.includes('--dashboard')) {
  const url = await ensureServer();
  if (!url) { console.log('無法啟動本機伺服器。'); process.exit(1); }
  // 營運監察台同 Founder Desk 同一個伺服器，只係打開唔同頁
  const page = args.includes('--dashboard') ? url + 'dashboard' : url;
  console.log((args.includes('--dashboard') ? '營運監察台' : 'Founder Desk') + (args.includes('--demo') ? '（示範：虛構公司）' : si >= 0 ? '（模擬實例：不是生意證據）' : '') + '：' + page);
  if (!args.includes('--no-open') && !process.env.SOS_NO_OPEN) openBrowser(page);
  process.exit(0);
}
if (args.includes('--list')) {
  const packs = listPacks(DIR).filter(p => p.open);
  if (!packs.length) console.log('目前沒有待回答的問題包。');
  for (const p of packs) console.log(`- ${p.title}：尚有 ${p.open}／${p.total} 條未回答（${p.id}）`);
  process.exit(0);
}
// 只係改設定（--brain／--observe）冇開頁面：做完就停，唔好將資料夾當問題包
if (bi >= 0 || oi >= 0) process.exit(0);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.log('用法：node ask.mjs <問題包.json>'); process.exit(1); }
let raw;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
catch (e) { console.log('無法讀取問題包：' + e.message); process.exit(1); }
const by = args.includes('--by-founder') ? '你' : 'AI';
const prep = preparePacks(raw, { dirs: DIR, askedBy: by });
if (!prep.ok) {
  console.log('問題包不符合規格，未有放上 Founder Desk：');
  for (const e of prep.errors) console.log('- ' + e);
  console.log('格式及出題規則見 ask-format.md。');
  process.exit(1);
}
if (prep.dropped.length) console.log(`有 ${prep.dropped.length} 條題目先前已回答，已移除。`);
if (!prep.packs.length) { console.log('全部題目先前均已回答，沒有新問題。'); process.exit(0); }
const placed = placePacks(DIR, prep.packs);
const url = await ensureServer();
for (const p of placed) console.log(`已放上 Founder Desk：${p.title}（共 ${p.count} 條；每次先問最重要的 3 條）`);
if (!url) { console.log('無法啟動 Founder Desk 的本機伺服器；問題包已放好，下次打開 Founder Desk 即可查看。'); process.exit(0); }
const link = `${url}#/ask/${placed[0].id}`;
console.log('Founder Desk：' + link);
if (!args.includes('--no-open') && !process.env.SOS_NO_OPEN) openBrowser(link);
