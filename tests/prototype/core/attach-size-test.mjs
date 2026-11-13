// 附件上限回歸測試（docs/evidence/attachment-size-2026-11-12/fable-analysis.md「回歸測試」一節）：
// 每份 25MB、每次合共 50MB；經 /api/tell、網頁收件、會議紀錄預檢、收據上載；標誌及 CSV 維持原上限；壞 base64 不回 500；
// 人為 500 有紀錄檔原文、畫面不叫人重試；長檔名保留「會議紀錄.md」；交出 70 秒才有回覆時 ask.mjs 不報失敗；同一份交出只入庫一次。
// 假 AI、隔離資料夾、不開瀏覽器、不連外網；大檔即時以隨機位元組產生，測試完逐個刪除。
// 安裝資料夾是 <out>/proj/crewzero（原型複本，不含 data），創辦人項目資料夾是 <out>/proj；ask.mjs --tell 的附件只可以來自項目資料夾。
// 用法：node attach-size-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
// 埠（都在 run-all 分配的 10 個埠之內）：port 延遲代理（模擬 70 秒才回覆）、port+5 主伺服器、port+8 造 500 用的第二實例。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { usePass } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT_TEXT, ADAPTER] = process.argv.slice(2);
if (!PROTO || !OUT || !PORT_TEXT || !ADAPTER) { console.log('FAIL 參數不足：需要 <原型資料夾> <輸出資料夾> <port> <假 adapter>'); process.exit(1); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const { isMinutesFileName } = await import(pathToFileURL(path.join(PROTO, 'minutes-check.mjs')).href);
const L = await import(pathToFileURL(path.join(PROTO, 'limits.mjs')).href);
const PORT = Number(PORT_TEXT), PROXY_PORT = PORT, MAIN_PORT = PORT + 5, ERR_PORT = PORT + 8;
const BASE = `http://127.0.0.1:${MAIN_PORT}`, ERR_BASE = `http://127.0.0.1:${ERR_PORT}`;
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MB = n => Math.round(n * 1024 * 1024);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const b64 = b => Buffer.from(b).toString('base64');
const rnd = n => crypto.randomBytes(n);
const pdfOf = n => { const head = Buffer.from('%PDF-1.4\n'); return Buffer.concat([head, rnd(n - head.length)]); };

freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const PROJ = path.join(OUT, 'proj'), INSTALL = path.join(PROJ, 'crewzero'), DATA = path.join(INSTALL, 'data-test');
const ATT = path.join(PROJ, 'att');
fs.mkdirSync(ATT, { recursive: true });
fs.cpSync(PROTO, INSTALL, { recursive: true, filter: s => !/[\\/]data$/.test(s) && !/[\\/]node_modules[\\/]/.test(s) });
const seed = data => {
  fs.mkdirSync(path.join(data, 'company'), { recursive: true }); fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, INSTALL);
  // 以「外殼正在工作」的鎖令外殼程序一開始便離開：收件匣、會議紀錄及收據檔留在原位，供本測試逐位元組核對
  fs.writeFileSync(path.join(data, 'ledger', '.lock'), String(process.pid));
};
seed(DATA);
const INBOX = path.join(DATA, 'founder', 'inbox');
const ENV = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_PORT: String(PORT), CZ_NO_WELCOME: '1', SOS_NO_OPEN: '1' };
let log = '';
const startServer = (data, port) => {
  const child = spawn(process.execPath, [path.join(INSTALL, 'server.mjs'), '--port', String(port)], { cwd: INSTALL, env: { ...ENV, SOS_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  return child;
};
const ready = async base => { for (let i = 0; i < 120; i++) { try { if ((await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) })).ok) return true; } catch { } await sleep(250); } return false; };
const call = async (base, route, body, { origin = true } = {}) => {
  const headers = { 'Content-Type': 'application/json' }; if (origin) headers.Origin = base;
  const r = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { }
  return { code: r.status, j };
};
const tell = body => call(BASE, '/api/tell', body, { origin: false });
const web = body => call(BASE, '/api/intake', { kind: 'note', ...body });
const minutes = body => call(BASE, '/api/minutes', body);
const money = body => call(BASE, '/api/money', body);
const logo = body => call(BASE, '/api/logo', body);
const brief = r => ({ code: r.code, error: r.j && r.j.error, message: r.j && r.j.message, id: r.j && r.j.id, duplicate: r.j && r.j.duplicate });
// 「零新檔」只看會收到附件或改動的位置：收件匣、會議紀錄、收據、待合併、公司資料夾（標誌）
const WATCH = [INBOX, path.join(DATA, 'ledger', 'minutes'), path.join(DATA, 'ledger', 'money', 'evidence'), path.join(DATA, 'ledger', 'money', 'pending'), path.join(DATA, 'ledger', 'money', 'imports'), path.join(DATA, 'company')];
const listAll = dir => { const out = []; const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(DATA, f)); } }; walk(dir); return out; };
const snap = () => WATCH.flatMap(listAll).sort().join('\n');
// 收件匣筆記（發生了一件事）內的附件紀錄：```json { date, files: [{ name, stored, bytes }] }```
const noteOf = (id, type = 'event') => { try { return fs.readFileSync(path.join(INBOX, `${id}-note-${type}.md`), 'utf8'); } catch { return ''; } };
const recordsOf = (id, type = 'event') => { const m = /```json\n([\s\S]*?)\n```/.exec(noteOf(id, type)); try { return JSON.parse(m[1]).files || []; } catch { return []; } };
const storedSame = (id, bufs, type = 'event') => { const recs = recordsOf(id, type); return recs.length === bufs.length && bufs.every((b, i) => recs[i].bytes === b.length && fs.existsSync(path.join(INBOX, recs[i].stored)) && fs.statSync(path.join(INBOX, recs[i].stored)).size === b.length && sha(fs.readFileSync(path.join(INBOX, recs[i].stored))) === sha(b)); };
const notesWith = text => fs.readdirSync(INBOX).filter(f => /-note-(event|adhoc|order)\.md$/.test(f) && fs.readFileSync(path.join(INBOX, f), 'utf8').includes(text));
// ask.mjs 以非同步方式執行（延遲代理在本程序內，不能用 spawnSync 阻塞事件迴圈）
const ask = (draft, env = ENV, timeoutMs = 200000) => new Promise(resolve => {
  const file = path.join(OUT, 'draft-' + crypto.randomBytes(4).toString('hex') + '.json'); fs.writeFileSync(file, JSON.stringify(draft));
  const at = Date.now(), child = spawn(process.execPath, [path.join(INSTALL, 'ask.mjs'), '--tell', file], { cwd: PROJ, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = ''; child.stdout.on('data', d => { stdout += d; }); child.stderr.on('data', d => { stderr += d; });
  const kill = setTimeout(() => child.kill(), timeoutMs);
  child.on('exit', status => { clearTimeout(kill); resolve({ status, stdout, stderr: stderr.slice(0, 400), ms: Date.now() - at }); });
});
const made = [];   // 本測試寫入的大檔（測試完逐個刪除）
const putFile = (name, buf) => { const f = path.join(ATT, name); fs.writeFileSync(f, buf); made.push(f); return f; };
const SIZES = [3.3, 4.8, 9.9, 24.9];
const OVER = L.FILE_MAX_BYTES + 1;
const transcriptText = size => {
  const head = ['00:00 Speaker 1', '大家早晨，今日先確認咖啡豆供應。', '', '00:08 Speaker 2', '我會在星期五前比較兩個報價。', '', '00:16 Speaker 1', '請你把結果和風險寫下來。', '', '00:24 Speaker 2', '我會連同交貨日期一併回覆。', '', '00:32 Speaker 1', '下星期再決定是否試行。', '', '00:40 Speaker 2', '好，我會先向兩間供應商查詢。', '', ''].join('\n');
  const h = Buffer.from(head, 'utf8'), line = Buffer.from('a'.repeat(99) + '\n'), n = size - h.length, parts = [h];
  for (let i = 0; i < Math.floor(n / line.length); i++) parts.push(line);
  parts.push(Buffer.alloc(n % line.length, 0x62));
  return Buffer.concat(parts);
};
const PNG_HEAD = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
let srv = null, srv2 = null, proxy = null;
// 代理：健康檢查回 health（令 ask.mjs 認作同一個 CrewZero），/api/tell 立即轉交 target，收到回覆後等到 holdMs 才交回 ask.mjs
const startProxy = async (health, target, holdMs) => {
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const at = Date.now();
      try {
        if (req.method === 'GET' && req.url === '/api/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ...health, pid: process.pid })); }
        if (req.method === 'POST' && req.url === '/api/tell') {
          const up = await fetch(target + '/api/tell', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] || 'application/json' }, body: Buffer.concat(chunks) });
          const text = await up.text();
          await sleep(Math.max(0, holdMs - (Date.now() - at)));
          res.writeHead(up.status, { 'Content-Type': 'application/json' }); return res.end(text);
        }
        res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}');
      } catch { try { res.writeHead(502); res.end(); } catch { } }
    });
  });
  server.requestTimeout = 0; server.headersTimeout = 0;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PROXY_PORT, '127.0.0.1', resolve); });
  return server;
};

try {
  srv = startServer(DATA, MAIN_PORT);
  ok('主伺服器啟動', await ready(BASE), log.slice(-400));
  await usePass(BASE);

  /* ---- 一、經 /api/tell 及網頁收件：3.3、4.8、9.9、24.9MB 成功，存檔位元組相符 ---- */
  for (const route of ['tell', 'web']) {
    for (const s of SIZES) {
      const isPdf = route === 'tell' && s === 4.8, buf = isPdf ? pdfOf(MB(s)) : rnd(MB(s)), name = `附件${s}MB.${isPdf ? 'pdf' : 'png'}`;
      const text = `附件大小測試（${route === 'tell' ? '對話交出' : '網頁收件'}，${s}MB）`;
      const r = await (route === 'tell' ? tell : web)({ type: 'event', text, date: '2026-11-12', files: [{ name, data: b64(buf) }] });
      ok(`${route === 'tell' ? 'A' : 'B'} ${route === 'tell' ? '/api/tell' : '網頁收件'}：${s}MB 成功，存檔位元組數及內容相同`, r.code === 202 && r.j && r.j.ok && !r.j.duplicate && storedSame(r.j.id, [buf]), { r: brief(r), recs: r.j && recordsOf(r.j.id) });
    }
  }

  /* ---- 二、剛超過 25MB、合共超過 50MB：400、字句、零新檔 ---- */
  for (const route of ['tell', 'web']) {
    const go = route === 'tell' ? tell : web, tag = route === 'tell' ? '/api/tell' : '網頁收件';
    let before = snap(), r = await go({ type: 'event', text: `剛超過上限（${tag}）`, date: '2026-11-12', files: [{ name: '剛超過.png', data: b64(rnd(OVER)) }] });
    ok(`C ${tag}：剛超過 25MB 回 400，字句含「25MB」，零新檔`, r.code === 400 && /25MB/.test(r.j && r.j.message || '') && snap() === before, { r: brief(r), changed: snap() !== before });
    before = snap();
    r = await go({ type: 'event', text: `合共超過上限（${tag}）`, date: '2026-11-12', files: [{ name: '甲.png', data: b64(rnd(MB(24.9))) }, { name: '乙.png', data: b64(rnd(MB(24.9))) }, { name: '丙.png', data: b64(rnd(MB(0.4))) }] });
    ok(`C ${tag}：三份各 25MB 內但合共 50.2MB 回 400「合共太大」，零新檔`, r.code === 400 && /合共太大/.test(r.j && r.j.message || '') && /50MB/.test(r.j && r.j.message || '') && snap() === before, { r: brief(r), changed: snap() !== before });
  }

  /* ---- 三、ask.mjs --tell：4.8MB PDF、24.9MB 成功；剛超過 25MB 在本機已拒絕 ---- */
  { const pdf = pdfOf(MB(4.8)), big = rnd(MB(24.9)); putFile('逐字稿4.8MB.pdf', pdf); putFile('相片24.9MB.png', big);
    const text = '附件大小測試（ask.mjs 交出 4.8MB PDF 及 24.9MB 圖片）';
    const r = await ask({ type: 'event', text, date: '2026-11-12', files: ['att/逐字稿4.8MB.pdf', 'att/相片24.9MB.png'] });
    const notes = notesWith(text), id = notes[0] && notes[0].replace(/-note-event\.md$/, '');
    ok('D ask.mjs --tell：4.8MB PDF 加 24.9MB 圖片成功，印「已交給 Zero」，存檔位元組相同', r.status === 0 && /^已交給 Zero：/.test(r.stdout) && notes.length === 1 && storedSame(id, [pdf, big]), { r, notes });
    putFile('剛超過.png', rnd(OVER));
    const before = snap(), r2 = await ask({ type: 'event', text: '剛超過上限（ask.mjs）', date: '2026-11-12', files: ['att/剛超過.png'] });
    ok('D ask.mjs --tell：剛超過 25MB 非零結束、字句含「25MB」、零新檔', r2.status !== 0 && r2.stdout.includes('25MB') && r2.stdout.includes(N.t('tellFileTooLarge', { name: '「剛超過.png」', mb: 25 })) && snap() === before, { r2, changed: snap() !== before }); }

  /* ---- 四、會議紀錄預檢：同樣大小的逐字稿成功並原樣存檔；剛超過 25MB 回 400、零新檔 ---- */
  for (const s of SIZES) {
    const buf = transcriptText(MB(s)), r = await minutes({ action: 'preflight', files: [{ name: `逐字稿${s}MB.txt`, data: b64(buf) }] });
    const id = r.j && r.j.id, stored = id && path.join(DATA, 'ledger', 'minutes', id, `01-逐字稿${s}MB.txt`);
    ok(`E 會議紀錄預檢：${s}MB 逐字稿成功，原檔位元組數及內容相同`, r.code === 200 && r.j && r.j.transcript === true && stored && fs.existsSync(stored) && fs.statSync(stored).size === buf.length && sha(fs.readFileSync(stored)) === sha(buf), { r: { code: r.code, transcript: r.j && r.j.transcript, id, message: r.j && r.j.message } });
  }
  { const before = snap(), r = await minutes({ action: 'preflight', files: [{ name: '剛超過.txt', data: b64(transcriptText(OVER)) }] });
    ok('E 會議紀錄預檢：剛超過 25MB 回 400，字句含「25MB」，零新檔', r.code === 400 && /25MB/.test(r.j && r.j.message || '') && snap() === before, { r: brief(r), changed: snap() !== before }); }

  /* ---- 五、收據上載：同樣大小成功；24.9MB 加 10MB 兩張不出「刪減文字」；剛超過 25MB 回 400、零新檔 ---- */
  let amt = 101;
  const receipt = files => money({ action: 'add', dir: 'out', amount: String(amt++), currency: 'HKD', date: '2026-11-10', payer: '測試供應商' + amt, category: 'goods', what: '收據大小測試', files, allowDup: true });
  const evidenceSame = (id, list) => list.every(([name, buf]) => { const f = path.join(DATA, 'ledger', 'money', 'evidence', id, name); return fs.existsSync(f) && fs.statSync(f).size === buf.length && sha(fs.readFileSync(f)) === sha(buf); });
  for (const s of SIZES) {
    const buf = rnd(MB(s)), name = `收據${s}MB.png`, r = await receipt([{ name, data: b64(buf) }]);
    ok(`F 收據上載：${s}MB 成功，存檔位元組數及內容相同`, r.code === 202 && r.j && r.j.ok && evidenceSame(r.j.id, [[name, buf]]), brief(r));
  }
  { const a = rnd(MB(24.9)), b = rnd(MB(10)), r = await receipt([{ name: '收據甲.png', data: b64(a) }, { name: '收據乙.png', data: b64(b) }]);
    ok('F 收據上載：兩張 24.9MB 加 10MB 成功，沒有「刪減文字」字句，兩張都原樣存檔', r.code === 202 && r.j && r.j.ok && !/刪減/.test(JSON.stringify(r.j)) && evidenceSame(r.j.id, [['收據甲.png', a], ['收據乙.png', b]]), brief(r)); }
  { const before = snap(), r = await receipt([{ name: '剛超過.png', data: b64(rnd(OVER)) }]);
    ok('F 收據上載：剛超過 25MB 回 400，字句含「25MB」，零新檔', r.code === 400 && /25MB/.test(r.j && r.j.message || '') && snap() === before, { r: brief(r), changed: snap() !== before }); }

  /* ---- 六、標誌及 CSV 維持原上限 ---- */
  { const logoFiles = () => fs.readdirSync(path.join(DATA, 'company')).filter(f => /^logo\./.test(f));
    let before = snap(), r = await logo({ action: 'set', data: b64(Buffer.concat([PNG_HEAD, rnd(MB(1.2) - PNG_HEAD.length)])) });
    // 0.44.0 主線把 /api/logo 請求本體上限由 1.5MB 提高到 2MB（附件規格「標誌 1.2MB 仍回『太大』」），所以 1.2MB 回 400 ui.logoLarge，不再回「請刪減部分文字」
    const logoLargeText = N.ui.logoLarge || (N.dash || {}).logoLarge;
    ok('G 標誌 1.2MB：不收，回 400「太大」（logoLarge），不是 500，沒有寫入標誌', r.code === 400 && r.j && r.j.message === logoLargeText && !logoFiles().length && snap() === before, { r: brief(r), files: logoFiles() });
    before = snap(); r = await logo({ action: 'set', data: b64(Buffer.concat([PNG_HEAD, rnd(MB(1) + 10240 - PNG_HEAD.length)])) });
    ok('G 標誌剛超過 1MB（請求仍在本體上限內）：400「超過 1MB」，沒有寫入標誌', r.code === 400 && r.j && r.j.error === 'large' && r.j.message === N.ui.logoLarge && !logoFiles().length && snap() === before, brief(r)); }
  { const rows = ['日期,金額,說明']; let csv = Buffer.from(''); while (csv.length < MB(3.5)) { for (let i = 0; i < 5000; i++) rows.push(`2026-11-10,${100 + (i % 900)},咖啡豆訂單第 ${i} 號`); csv = Buffer.from(rows.join('\n'), 'utf8'); }
    csv = csv.subarray(0, MB(3.5));
    const before = snap(), r = await money({ action: 'importUpload', name: '大檔.csv', kind: 'shop', data: b64(csv) });
    ok('G CSV 3.5MB：400「檔案太大」，不是 500，零新檔', r.code === 400 && /檔案太大/.test(r.j && r.j.message || '') && snap() === before, { r: brief(r), changed: snap() !== before }); }

  /* ---- 七、壞 base64：各入口回 400 中文，takeFiles 入口講「無法讀取」，零新檔 ---- */
  { const longBad = b64(rnd(MB(3.3))); const mid = Math.floor(longBad.length / 8) * 4;
    const BADS = [['%%%', '亂碼'], ['ab=c', '中間有等號'], [longBad.slice(0, mid) + '*' + longBad.slice(mid + 1), '3.3MB 中間夾一個非法字元'], [longBad.slice(0, -1), '3.3MB 長度不是 4 的倍數']];
    for (const [data, tag] of BADS) {
      const before = snap(), t0 = Date.now();
      const rs = [
        ['/api/tell', await tell({ type: 'event', text: '壞附件（' + tag + '）', date: '2026-11-12', files: [{ name: '壞.pdf', data }] })],
        ['網頁收件', await web({ type: 'event', text: '壞附件（' + tag + '）', date: '2026-11-12', files: [{ name: '壞.pdf', data }] })],
        ['會議紀錄預檢', await minutes({ action: 'preflight', files: [{ name: '壞.txt', data }] })],
        ['收據上載', await receipt([{ name: '壞.png', data }])]
      ];
      const ms = Date.now() - t0;
      ok(`H 壞 base64（${tag}）：/api/tell、網頁收件、會議紀錄預檢、收據上載都回 400「無法讀取」，零新檔`, rs.every(([, r]) => r.code === 400 && /無法讀取/.test(r.j && r.j.message || '')) && snap() === before && ms < 15000, { ms, rs: rs.map(([k, r]) => [k, brief(r)]), changed: snap() !== before });
      // 標誌請求本體上限 1.5MB：大份的壞資料改用同類但 0.9MB 的版本，免得量到的是本體上限而不是 base64 檢查
      const small = data.length <= MB(1) ? data : tag.includes('非法字元') ? longBad.slice(0, 450000) + '*' + longBad.slice(450001, 900000) : longBad.slice(0, 899999);
      const csvBad = await money({ action: 'importUpload', name: '壞.csv', kind: 'shop', data }), logoBad = await logo({ action: 'set', data: small });
      ok(`H 壞 base64（${tag}）：CSV 匯入及標誌回 400 中文原因，不是 500`, csvBad.code === 400 && /[一-鿿]/.test(csvBad.j && csvBad.j.message || '') && logoBad.code === 400 && logoBad.j && logoBad.j.message === N.ui.logoBad, { csvBad: brief(csvBad), logoBad: brief(logoBad) });
    } }

  /* ---- 八、長檔名：94 字加「會議紀錄.md」仍被認作會議紀錄 ---- */
  { const stem = ('二零二六年十一月十二日咖啡豆供應商比較及試行安排') .repeat(5).slice(0, 94), name = stem + '會議紀錄.md';
    const md = Buffer.from('# 會議紀錄\n\n## 摘要\n\n星期五前比較兩個報價，下星期決定是否試行。\n', 'utf8');
    for (const [tag, go] of [['/api/tell', tell], ['網頁收件', web]]) {
      const r = await go({ type: 'event', text: `長檔名會議紀錄（${tag}）`, date: '2026-11-12', files: [{ name, data: b64(md) }] });
      const rec = r.j && recordsOf(r.j.id)[0];
      ok(`I ${tag}：檔名 ${Array.from(name).length} 字（94 字加「會議紀錄.md」）截短後仍以「會議紀錄.md」結尾、被認作會議紀錄，內容原樣`, r.code === 202 && rec && Array.from(rec.name).length <= L.FILE_NAME_MAX && rec.name.endsWith('會議紀錄.md') && isMinutesFileName(rec.name) && storedSame(r.j.id, [md]), { r: brief(r), rec });
    } }

  /* ---- 九、同一份交出送兩次（10 分鐘內）：只入庫一次 ---- */
  { const body = { type: 'event', text: '重複交出測試（經 /api/tell）', date: '2026-11-12', files: [{ name: '報價.png', data: b64(rnd(MB(3.3))) }] };
    const r1 = await tell(body), before = snap(), r2 = await tell(body);
    ok('J /api/tell 同一份送兩次：第一次正常、第二次 202 而且 duplicate: true，沒有新檔，收件匣只有一份', r1.code === 202 && !r1.j.duplicate && r2.code === 202 && r2.j && r2.j.duplicate === true && r2.j.id === r1.j.id && snap() === before && notesWith(body.text).length === 1, { r1: brief(r1), r2: brief(r2), notes: notesWith(body.text) });
    putFile('重複.png', rnd(MB(4.8)));
    const draft = { type: 'event', text: '重複交出測試（經 ask.mjs）', date: '2026-11-12', files: ['att/重複.png'] };
    const a1 = await ask(draft), a2 = await ask(draft);
    ok('J ask.mjs 同一份交兩次：第一次「已交給 Zero」，第二次印 ui.tellDupSame，收件匣只有一份', a1.status === 0 && /^已交給 Zero：/.test(a1.stdout) && a2.status === 0 && a2.stdout.split('\n')[0].trim() === N.ui.tellDupSame && notesWith(draft.text).length === 1, { a1, a2, notes: notesWith(draft.text) }); }
  // 附加探測（規格以外）：同一份交出同時送兩次（例如逾時後重交、而第一次仍在轉換 PDF）
  { const body = { type: 'event', text: '同時重複交出探測', date: '2026-11-12', files: [{ name: '同時.pdf', data: b64(pdfOf(MB(3.3))) }] };
    const [x, y] = await Promise.all([tell(body), tell(body)]);
    ok('J 附加探測：同一份交出同時送兩次，收件匣只有一份', x.code === 202 && y.code === 202 && notesWith(body.text).length === 1, { x: brief(x), y: brief(y), notes: notesWith(body.text) }); }

  /* ---- 十、交出 70 秒才有回覆：ask.mjs 不在 60 秒報失敗、不印 tellNoServer；收件匣只有一份 ---- */
  { const health = await (await fetch(BASE + '/api/health')).json();
    proxy = await startProxy(health, BASE, 70000);
    const viaProxy = await (await fetch(`http://127.0.0.1:${PROXY_PORT}/api/health`)).json();
    ok('K 延遲代理就緒：健康檢查與主伺服器相同版本及資料夾', viaProxy.version === health.version && viaProxy.root === health.root, { viaProxy, health });
    putFile('慢轉換.png', rnd(MB(3.3)));
    const draft = { type: 'event', text: '交出要 70 秒才有回覆', date: '2026-11-12', files: ['att/慢轉換.png'] };
    const r = await ask(draft);
    ok('K ask.mjs --tell：伺服器 70 秒後才回覆，仍印「已交給 Zero」並正常結束（不在 60 秒報失敗、不印 tellNoServer 或 tellTimeout）', r.status === 0 && r.ms >= 70000 && /^已交給 Zero：/.test(r.stdout) && !r.stdout.includes(N.ui.tellNoServer) && !r.stdout.includes(N.ui.tellTimeout), r);
    ok('K 慢回覆的交出：收件匣只有一份', notesWith(draft.text).length === 1, notesWith(draft.text));
    await new Promise(resolve => proxy.close(resolve)); proxy = null;
    const again = await ask(draft);
    ok('K 創辦人誤以為失敗再交一次：印 ui.tellDupSame，收件匣仍只有一份', again.status === 0 && again.stdout.split('\n')[0].trim() === N.ui.tellDupSame && notesWith(draft.text).length === 1, { again, notes: notesWith(draft.text) }); }

  /* ---- 十一、人為 500：收件匣位置變成檔案，寫入失敗；紀錄檔有原文，畫面是 ui.err_server（不叫人重試） ---- */
  { const ROOT2 = path.join(OUT, 'd500'), DATA2 = path.join(ROOT2, 'data'), LOG2 = path.join(ROOT2, 'logs', 'server-errors.log');
    fs.mkdirSync(DATA2, { recursive: true }); seed(DATA2);
    srv2 = startServer(DATA2, ERR_PORT);
    ok('L 第二實例啟動', await ready(ERR_BASE), log.slice(-400));
    const inbox2 = path.join(DATA2, 'founder', 'inbox'), moved = inbox2 + '-moved';
    fs.renameSync(inbox2, moved); fs.writeFileSync(inbox2, '佔位檔：令收件匣寫入失敗');
    let r, a;
    try {
      r = await call(ERR_BASE, '/api/tell', { type: 'adhoc', text: '人為 500 測試' }, { origin: false });
      // ask.mjs 開始時會自行建立收件匣，所以不能指向這個實例；改經代理把 ask.mjs 的交出轉到這個實例，畫面看到的是真實 500 回應
      proxy = await startProxy(await (await fetch(BASE + '/api/health')).json(), ERR_BASE, 0);
      a = await ask({ type: 'adhoc', text: '人為 500 測試（ask.mjs）' });
    } finally {
      fs.rmSync(inbox2, { force: true }); fs.renameSync(moved, inbox2);
      if (proxy) { await new Promise(resolve => proxy.close(resolve)); proxy = null; }
    }
    const logText = fs.existsSync(LOG2) ? fs.readFileSync(LOG2, 'utf8') : '';
    ok('L 人為 500：回 500，error 為 server，畫面字句是 ui.err_server', r.code === 500 && r.j && r.j.error === 'server' && r.j.message === N.ui.err_server, brief(r));
    ok('L ui.err_server 不叫人重試（沒有「再試」「重試」「再送出一次」）', !/再試|重試|再送出一次/.test(N.ui.err_server), N.ui.err_server);
    ok('L 紀錄檔（data 以外的 logs/server-errors.log）有錯誤原文（錯誤代號、收件匣路徑及呼叫堆疊）', /\b(ENOENT|ENOTDIR|EEXIST|EISDIR|EPERM)\b/.test(logText) && logText.includes('inbox') && /\n\s+at /.test(logText) && !fs.existsSync(path.join(DATA2, 'logs')), logText.slice(0, 600));
    ok('L ask.mjs 遇到 500：非零結束，只印 ui.err_server，不印 tellNoServer', a.status !== 0 && a.stdout.split('\n')[0].trim() === N.ui.err_server && !a.stdout.includes(N.ui.tellNoServer), a); }
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  if (proxy) try { proxy.close(); proxy.closeAllConnections?.(); } catch { }
  for (const s of [srv, srv2]) if (s) try { s.kill(); } catch { }
  await sleep(1500);
  // 結束後在本測試的埠段內不應有遺留伺服器（ask.mjs 找不到伺服器時會自行開一個）
  const leftover = [];
  for (let p = PORT; p < PORT + 10; p++) { try { const r = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) }); if (r.ok) leftover.push(p); } catch { } }
  ok('結束後埠段內沒有遺留的伺服器', !leftover.length, leftover);
  for (const f of made) try { fs.rmSync(f, { force: true }); } catch { }
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  try { fs.writeFileSync(path.join(OUT, 'server.log'), log); } catch { }
  process.exit(pass === results.length ? 0 : 1);
}
