// 公司標誌（創辦人喺頁頭自己上載）：伺服器只收 PNG／JPG／WebP、1MB 以內、按檔頭認格式；要通行證同本機來源；
// 頁頭標誌係掣，按咗可以上載同移除；CrewZero 同營運監察台都顯示同一個標誌，冇就顯示公司名首兩個字。
// 用法：node logo-test.mjs <chrome> <輸出資料夾> <原型資料夾> <port>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { seedCompany, usePass } from '../lib/testkit.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';

const [CHROME, OUT, PROTO, PORT] = process.argv.slice(2);
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data'); seedCompany(DATA, PROTO);
const BASE = `http://127.0.0.1:${PORT}`, LOGO_DIR = path.join(DATA, 'company');

// 細 PNG：w×w 實色圓形（RGBA），唔使任何套件
function png(w, rgb, noise) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(w, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc(w * (w * 4 + 1));
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const i = y * (w * 4 + 1) + 1 + x * 4, inside = (x - w / 2 + .5) ** 2 + (y - w / 2 + .5) ** 2 <= (w / 2 - 1) ** 2;
    raw[i] = noise ? (Math.random() * 256) | 0 : rgb[0]; raw[i + 1] = noise ? (Math.random() * 256) | 0 : rgb[1]; raw[i + 2] = rgb[2]; raw[i + 3] = inside ? 255 : 0;
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG1 = png(64, [46, 140, 87]), PNG2 = png(64, [40, 90, 200]);
const WEBP = fs.readFileSync(path.join(PROTO, 'assets', fs.readdirSync(path.join(PROTO, 'assets')).find(f => /^crew-.*\.webp$/.test(f))));
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const b64 = b => b.toString('base64');
const post = (body, { origin = BASE, cookie } = {}) => fetch(BASE + '/api/logo', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie != null ? { cookie } : {}) }, body: JSON.stringify(body) })
  .then(async r => { let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; });
const shell = async () => (await (await fetch(BASE + '/api/shell')).json()).company;
const files = () => fs.existsSync(LOGO_DIR) ? fs.readdirSync(LOGO_DIR).filter(f => /^logo\.|^\.logo-/.test(f)).sort() : [];

const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
let cdp = null;
try {
  await usePass(BASE);
  /* ---- 伺服器 ---- */
  const c0 = await shell(), a0 = (await (await fetch(BASE + '/api/asks')).json()).company;
  ok('未有標誌：頁頭資料 logo 係 0，/company-logo 回 404', c0.logo === 0 && a0.logo === 0 && (await fetch(BASE + '/company-logo')).status === 404, { c0, a0 });
  const noPassGet = await fetch(BASE + '/company-logo', { headers: { cookie: 'x=1' } });
  const noPassPost = await post({ action: 'set', data: b64(PNG1) }, { cookie: 'x=1' });
  ok('冇通行證：讀標誌同上載都被拒（403），冇寫檔', noPassGet.status === 403 && noPassPost.code === 403 && !files().length, { get: noPassGet.status, post: noPassPost });
  const evil = await post({ action: 'set', data: b64(PNG1) }, { origin: 'http://evil.example' });
  ok('其他網站嘅來源：上載被拒（403）', evil.code === 403 && !files().length, evil);
  const svg = await post({ action: 'set', data: b64(SVG) }), junk = await post({ action: 'set', data: b64(Buffer.from('not an image at all')) }), bad = await post({ action: 'set', data: '***' }), noAct = await post({ data: b64(PNG1) });
  ok('SVG、亂碼、唔係 base64、冇動作：全部 400，冇寫檔', [svg, junk, bad, noAct].every(r => r.code === 400) && svg.j.error === 'type' && /PNG、JPG 或 WebP/.test(svg.j.message || '') && !files().length, { svg, junk, bad, noAct });
  const big = Buffer.concat([PNG1, Buffer.alloc(1024 * 1024)]), large = await post({ action: 'set', data: b64(big) });
  ok('超過 1MB：400，提示講原因同點做，冇寫檔', large.code === 400 && large.j.error === 'large' && /1MB/.test(large.j.message || '') && /改選/.test(large.j.message || '') && !files().length, large);
  const set1 = await post({ action: 'set', data: b64(PNG1) }), got1 = await fetch(BASE + '/company-logo'), body1 = Buffer.from(await got1.arrayBuffer()), c1 = await shell();
  ok('上載 PNG：存成 logo.png，讀返係同一個檔、類型 image/png，頁頭資料有 logo', set1.code === 200 && set1.j.logo > 0 && got1.headers.get('content-type') === 'image/png' && body1.equals(PNG1) && c1.logo === set1.j.logo && files().join() === 'logo.png', { set1, type: got1.headers.get('content-type'), c1, files: files() });
  ok('讀標誌唔會俾瀏覽器快取同猜類型', got1.headers.get('cache-control') === 'no-store' && got1.headers.get('x-content-type-options') === 'nosniff', Object.fromEntries(got1.headers));
  await sleep(30);
  const set2 = await post({ action: 'set', data: b64(WEBP) }), got2 = await fetch(BASE + '/company-logo');
  ok('換成 WebP：舊 logo.png 刪走，只剩 logo.webp，類型 image/webp', set2.code === 200 && files().join() === 'logo.webp' && got2.headers.get('content-type') === 'image/webp', { set2, files: files() });
  const rm = await post({ action: 'remove' }), c2 = await shell();
  ok('移除：標誌檔全部刪走，頁頭資料 logo 返做 0', rm.code === 200 && !files().length && c2.logo === 0 && (await fetch(BASE + '/company-logo')).status === 404, { rm, c2, files: files() });
  ok('伺服器日誌記低更換同移除', /公司標誌已更換/.test(log) && /公司標誌已移除/.test(log), log.slice(-600));

  /* ---- 頁面 ---- */
  cdp = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
  await usePass(BASE, cdp);
  await cdp.go(BASE + '/', 1440, 2500);
  const m0 = await cdp.ev(`(()=>{const m=document.getElementById('co-mark');return m?{tag:m.tagName,img:!!m.querySelector('img'),text:m.textContent,label:m.getAttribute('aria-label')}:null})()`);
  ok('CrewZero 頁頭標誌係掣，未有標誌就顯示公司名首兩個字', m0 && m0.tag === 'BUTTON' && !m0.img && m0.text.length >= 2 && m0.label === '更換公司標誌', m0);
  await cdp.click('#co-mark');
  const d0 = await cdp.ev(`(()=>{const d=document.getElementById('logo-modal');return d?{remove:!!document.getElementById('logo-remove'),text:d.textContent}:null})()`);
  ok('按標誌：彈出公司標誌對話框，講明會自動調整大小、冇技術細節（格式、MB），未有標誌時冇「移除」', d0 && !d0.remove && /自動調整大小/.test(d0.text) && !/PNG|JPG|WebP|MB|像素/.test(d0.text), d0);
  const sample = path.join(OUT, 'sample-logo.png'); fs.writeFileSync(sample, PNG2);
  const doc = await cdp.send('DOM.getDocument', { depth: -1 }), node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#logo-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [sample] });
  let m1 = null;
  for (let i = 0; i < 30; i++) { await sleep(200); m1 = await cdp.ev(`(()=>{const m=document.getElementById('co-mark'),i=m.querySelector('img');return {modal:!!document.getElementById('logo-modal'),src:i?i.getAttribute('src'):'',w:i?i.naturalWidth:0,toast:(document.getElementById('toast')||{}).textContent||''}})()`); if (!m1.modal && m1.w) break; }
  ok('揀圖之後：對話框關閉，頁頭即時換成新標誌，有提示「已更換」', m1 && !m1.modal && /^\/company-logo\?v=\d+$/.test(m1.src) && m1.w === 64 && /已更換/.test(m1.toast) && files().join() === 'logo.png', { m1, files: files() });
  await cdp.shot(path.join(OUT, 'desk-head-logo-1440.png'), '.dtop');
  // 大圖（1600×1600 雜訊，超過 1MB）：瀏覽器自動縮到 512，上載成功
  const bigFile = path.join(OUT, 'big-logo.png'), bigPng = png(1600, [0, 0, 0], true); fs.writeFileSync(bigFile, bigPng);
  await cdp.click('#co-mark');
  const doc2 = await cdp.send('DOM.getDocument', { depth: -1 }), node2 = await cdp.send('DOM.querySelector', { nodeId: doc2.root.nodeId, selector: '#logo-file' });
  await cdp.send('DOM.setFileInputFiles', { nodeId: node2.nodeId, files: [bigFile] });
  let mb = null;
  for (let i = 0; i < 50; i++) { await sleep(200); mb = await cdp.ev(`(()=>{const i=document.querySelector('#co-mark img');return {modal:!!document.getElementById('logo-modal'),w:i?i.naturalWidth:0,h:i?i.naturalHeight:0,note:(document.getElementById('logo-note')||{}).textContent||''}})()`); if (!mb.modal && mb.w === 512) break; }
  const stored = files().map(f => fs.statSync(path.join(LOGO_DIR, f)).size);
  ok('大圖（' + (bigPng.length / 1048576).toFixed(1) + 'MB）自動縮到 512 像素再上載，存檔 1MB 以內', bigPng.length > 1024 * 1024 && mb && !mb.modal && mb.w === 512 && mb.h === 512 && stored.length === 1 && stored[0] <= 1024 * 1024, { mb, files: files(), stored });
  await cdp.go(BASE + '/dashboard', 1440, 3000);
  const dm = await cdp.ev(`(()=>{const i=document.querySelector('#co-mark img');return i?{src:i.getAttribute('src'),w:i.naturalWidth}:null})()`);
  ok('營運監察台頁頭顯示同一個標誌', dm && dm.w === 512, dm);
  await cdp.shot(path.join(OUT, 'dash-head-logo-1440.png'), '.dtop');
  await cdp.go(BASE + '/', 390, 2500);
  await cdp.shot(path.join(OUT, 'desk-head-logo-390.png'), '.dtop');
  await cdp.click('#co-mark');
  await cdp.shot(path.join(OUT, 'logo-dialog-390.png'));
  await cdp.click('#logo-remove');
  let m2 = null;
  for (let i = 0; i < 30; i++) { await sleep(200); m2 = await cdp.ev(`(()=>{const m=document.getElementById('co-mark');return {modal:!!document.getElementById('logo-modal'),img:!!m.querySelector('img'),text:m.textContent}})()`); if (!m2.modal) break; }
  ok('按「移除標誌」：頁頭返去顯示公司名首兩個字，標誌檔刪走', m2 && !m2.modal && !m2.img && m2.text.replace('✎', '').length >= 2 && !files().length, { m2, files: files() });
  ok('頁面冇程式錯誤', !cdp.errors.length, cdp.errors);
} catch (e) {
  ok('測試程式出錯', false, String(e?.stack || e));
} finally {
  try { cdp?.close(); } catch { }
  try { srv.kill(); } catch { }
  await sleep(300);
}
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info ?? null).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
