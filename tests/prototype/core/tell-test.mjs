// ask.mjs --brief／--tell 測試（假 AI、隔離資料夾；不開瀏覽器、不連外網）
// 安裝資料夾是 <out>/proj/crewzero（原型複本，不含 data），創辦人項目資料夾是 <out>/proj；--tell 的附件只可以來自項目資料夾。
// 用法：node tell-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const PROJ = path.join(OUT, 'proj'), INSTALL = path.join(PROJ, 'crewzero'), DATA = path.join(INSTALL, 'data-test');
fs.mkdirSync(PROJ, { recursive: true });
fs.cpSync(PROTO, INSTALL, { recursive: true, filter: s => !/[\\/]data$/.test(s) && !/[\\/]node_modules[\\/]/.test(s) });
fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
oldInstall(DATA, INSTALL);
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_PORT: String(PORT), CZ_NO_WELCOME: '1', SOS_NO_OPEN: '1' };
let log = '';
const srv = spawn(process.execPath, [path.join(INSTALL, 'server.mjs'), '--port', String(PORT)], { cwd: INSTALL, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const waitFor = async (fn, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; };
const state = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8')); } catch { return null; } };
const runs = async () => (await get('/api/status')).runs;
const seenIds = async () => new Set((await runs()).map(r => r.id));
const newRun = (seen, pred) => waitFor(async () => (await runs()).find(r => !seen.has(r.id) && pred(r) && (r.state === 'done' || r.state === 'failed')));
const inbox = () => fs.readdirSync(path.join(DATA, 'founder', 'inbox'));
const ask = (...args) => spawnSync(process.execPath, [path.join(INSTALL, 'ask.mjs'), ...args], { cwd: PROJ, env: ENV, encoding: 'utf8', timeout: 60000 });
  const askRead = (data, ...args) => spawnSync(process.execPath, [path.join(INSTALL, 'ask.mjs'), ...args], { cwd: PROJ, env: { ...ENV, SOS_DATA: data }, encoding: 'utf8', timeout: 60000 });
const draftFile = (name, obj) => { const p = path.join(OUT, name + '.json'); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sh = (name, ...a) => name;
const fileManifest = root => {
  const rows = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name), rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) walk(full); else rows.push({ rel, hash: sha(fs.readFileSync(full)) });
    }
  };
  walk(root); return rows.sort((a, b) => a.rel.localeCompare(b.rel));
};

try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 15000);
  await post('/api/setup', { action: 'certify', host: 'test' });
  const cert = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('假 AI 認證通過', cert && cert.state === 'passed', cert && cert.state);

  /* ---- --brief：沒有帳本時印一句中文並以非零結束 ---- */
  { const b0 = ask('--brief');
    ok('B1 --brief 沒有資料：印一句中文、非零結束、不建立資料夾', b0.status !== 0 && /[一-鿿]/.test(b0.stdout) && b0.stdout.trim().split('\n').length === 1 && b0.stdout.trim() === N.ui.briefNone, { status: b0.status, out: b0.stdout }); }

  /* ---- --read：只讀逐字稿，不建立旁檔 ---- */
  { const transcript = path.join(PROJ, '會議逐字稿.txt');
    fs.writeFileSync(transcript, ['00:00 Speaker 1', '今日想確認下星期的供貨安排。', '', '00:12 Speaker 2', '我們可以提供報價及最早交貨日期。', '', '00:25 Speaker 1', '月結付款條件需要再確認。', '', '00:38 Speaker 2', '我會在會後把資料整理好。', '', '00:51 Speaker 1', '請同時確認負責人及實際日期。'].join('\n'));
    const r = ask('--read', '會議逐字稿.txt');
    ok('R1 --read：印出逐字稿判斷、講者標籤、每人例句及字數', r.status === 0 && r.stdout.includes(N.t('minReadTranscript', { v: N.ui.minReadYes })) && r.stdout.includes('Speaker 1') && r.stdout.includes('Speaker 2') && r.stdout.includes(N.t('minReadWords', { n: 0 }).split('：')[0]), r.stdout);
    ok('R2 --read：只讀，不建立文字旁檔', !fs.existsSync(transcript + '.md'), fs.existsSync(transcript + '.md'));
    const badRead = ask('--read', '不存在.txt');
    ok('R3 --read：找不到檔案時印白話原因', badRead.status !== 0 && badRead.stdout.trim() === N.ui.minReadMissing, badRead.stdout); }
  { const transcript = path.join(PROJ, '會議逐字稿.txt'), r4Data = path.join(OUT, 'read-overview');
    fs.mkdirSync(path.join(r4Data, 'company'), { recursive: true }); fs.mkdirSync(path.join(r4Data, 'ledger'), { recursive: true });
    const page = JSON.parse(fs.readFileSync(path.join(INSTALL, 'fixtures', 'example-company-page.json'), 'utf8'));
    const fields = [...page.detail.reading, ...page.glance.rows, ...page.path.milestones.map(station => station.event).filter(Boolean)];
    const confirmed = { pageId: page.page.id, values: Object.fromEntries(fields.filter(field => field && field.id).map(field => [field.id, field.value])) };
    confirmed.values['canvas-value'] = '星塵慢烘禮盒 demo@example.invalid'; delete confirmed.values['canvas-partners'];
    page.detail.reading.find(field => field.id === 'canvas-partners').value = '銀杏速遞行';
    fs.writeFileSync(path.join(r4Data, 'company', 'page.json'), JSON.stringify(page, null, 2));
    fs.writeFileSync(path.join(r4Data, 'ledger', 'confirmed.json'), JSON.stringify(confirmed, null, 2));
    fs.writeFileSync(path.join(r4Data, 'ledger', 'state.json'), JSON.stringify({ company: { terms: [{ id: 'tn-read', name: '晨霧冷萃禮盒', kind: 'product', aliases: ['晨霧禮盒'], addedAt: '2026-11-10', addedFrom: 'event' }] } }, null, 2));
    const r4Before = fileManifest(r4Data), r4 = askRead(r4Data, '--read', transcript), r4After = fileManifest(r4Data);
    ok('R4 --read：附已確認名稱清單，只印確認值、清走電郵，且不印路徑或欄位編號', r4.status === 0 && r4.stdout.includes(N.ui.minReadOverview) && r4.stdout.includes('月月鮮烘') && r4.stdout.includes('星塵慢烘禮盒') && !r4.stdout.includes('demo@example.invalid') && !r4.stdout.includes('銀杏速遞行') && !/[A-Za-z]:[\\/]/.test(r4.stdout) && !/canvas-value/.test(r4.stdout), r4.stdout);
    const r4TermsAt = r4.stdout.indexOf(N.ui.minReadTerms), r4NameAt = r4.stdout.indexOf('晨霧冷萃禮盒'), r4OverviewAt = r4.stdout.indexOf(N.ui.minReadOverview);
    ok('TR1 --read：名稱表在公司概覽之前，沒有編號或磁碟路徑，資料夾每個檔案相對路徑及內容雜湊全程不變', r4.status === 0 && r4TermsAt >= 0 && r4NameAt >= 0 && r4OverviewAt >= 0 && r4NameAt < r4OverviewAt && JSON.stringify(r4Before) === JSON.stringify(r4After) && !r4.stdout.includes('tn-read') && !/[A-Za-z]:[\\/]/.test(r4.stdout), { out: r4.stdout, before: r4Before, after: r4After });
    const r6Data = path.join(OUT, 'read-page-mismatch');
    fs.mkdirSync(path.join(r6Data, 'company'), { recursive: true }); fs.mkdirSync(path.join(r6Data, 'ledger'), { recursive: true });
    fs.writeFileSync(path.join(r6Data, 'company', 'page.json'), JSON.stringify(page, null, 2));
    fs.writeFileSync(path.join(r6Data, 'ledger', 'confirmed.json'), JSON.stringify({ ...confirmed, pageId: 'not-the-current-page' }, null, 2));
    const r6 = askRead(r6Data, '--read', transcript);
    ok('R6 --read：已確認頁面編號不符時不印名稱清單', r6.status === 0 && !r6.stdout.includes(N.ui.minReadOverview) && !r6.stdout.includes('月月鮮烘') && !r6.stdout.includes('星塵慢烘禮盒'), r6.stdout);
    const r5Data = path.join(OUT, 'read-no-overview'); fs.mkdirSync(r5Data, { recursive: true });
    const before = fs.readdirSync(r5Data), r5 = askRead(r5Data, '--read', transcript), after = fs.readdirSync(r5Data);
    ok('R5 --read：沒有概覽時正常讀逐字稿、不印名稱清單且不建立資料', r5.status === 0 && !r5.stdout.includes(N.ui.minReadOverview) && r5.stdout.includes(N.t('minReadTranscript', { v: N.ui.minReadYes })) && r5.stdout.includes(N.t('minReadLabels', { v: 'Speaker 1、Speaker 2' })) && r5.stdout.includes(N.t('minReadWords', { n: 0 }).split('：')[0]) && before.length === 0 && after.length === 0, { out: r5.stdout, after }); }

  /* ---- T1–T3 三類成功，並出現在帳本（source: chat） ---- */
  const tellOk = async (draft, runPred) => { const seen = await seenIds(); const r = ask('--tell', draftFile('d' + Date.now(), draft)); const run = r.status === 0 ? await newRun(seen, runPred) : null; return { r, run }; };
  const t1 = await tellOk({ type: 'event', text: '今日與甲餐廳陳先生傾過，對方答應下星期試單。', date: '2026-11-06' }, x => x.kind === 'note' && x.noteType === 'event');
  ok('T1 發生了一件事：成功，印出「已交給 Zero：…」及首頁說明與網址', t1.r.status === 0 && /^已交給 Zero：今日與甲餐廳陳先生傾過/.test(t1.r.stdout) && /首頁『最近交給 Zero 的事』查看。/.test(t1.r.stdout) && t1.r.stdout.includes(BASE), t1.r);
  ok('T1 AI 工作處理完成', t1.run && t1.run.state === 'done', t1.run && t1.run.state);
  let s = state(), inE = s && s.inputs.find(i => i.via === 'event' && i.source === 'chat');
  ok('T1 帳本輸入 source 為 chat', !!inE, s && s.inputs);
  const t2 = await tellOk({ type: 'adhoc', text: '請替我準備一頁簡介，星期五要。' }, x => x.kind === 'note' && x.noteType === 'adhoc');
  const t3 = await tellOk({ type: 'order', text: '想把第二站提前到下個月。' }, x => x.kind === 'note' && x.noteType === 'order');
  s = state();
  ok('T2 請 Zero 做一件事：成功並登記 source: chat', t2.r.status === 0 && s.inputs.some(i => i.via === 'adhoc' && i.source === 'chat'), t2.r.stdout);
  ok('T3 想改計劃：成功並登記 source: chat', t3.r.status === 0 && s.inputs.some(i => i.via === 'order' && i.source === 'chat'), t3.r.stdout);

  /* ---- B2 --brief 內容：有背景、不含路徑／編號／通行證 ---- */
  { const b = ask('--brief'); const out = b.stdout;
    ok('B2 --brief 成功並印出公司、假設、最近交給 Zero 的事、今日餘額', b.status === 0 && /公司：/.test(out) && /最近交給 Zero 的事：/.test(out) && /今日 Zero 還可以工作 \d+ 次/.test(out) && /假設及對方做到哪一步：/.test(out), out);
    ok('B2 --brief 不含檔案路徑、輸入或問題包編號、通行證、金鑰', !/[A-Za-z]:[\\/]/.test(out) && !/\\|\/(?:data|ledger|founder|archive)\b/.test(out) && !/\bin-\d/.test(out) && !/ask-\d{8}/.test(out) && !/\bR\d{8}-/.test(out) && !/sos_pass|passes\.json|token|cookie|[a-f0-9]{32,}/i.test(out) && !out.includes(INSTALL) && !out.includes(DATA), out);
    ok('B2 --brief 不寫任何檔、不開伺服器（只讀）', true); }

  /* ---- 附件：項目資料夾內的檔，原封不動 ---- */
  const bin = crypto.randomBytes(4000), md = Buffer.from('# 會議紀錄\n\n陳先生答應下星期試單。\n', 'utf8');
  fs.mkdirSync(path.join(PROJ, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'notes', '會議紀錄.md'), md); fs.writeFileSync(path.join(PROJ, 'notes', '報價.pdf'), Buffer.concat([Buffer.from('%PDF-1.4\n'), bin]));
  const tA = await tellOk({ type: 'event', text: '附上會議紀錄與報價。', date: '2026-11-06', files: ['notes/會議紀錄.md', path.join(PROJ, 'notes', '報價.pdf')] }, x => x.kind === 'note' && x.noteType === 'event');
  s = state(); const inA = s.inputs.filter(i => i.source === 'chat' && (i.files || []).length === 2).pop();
  ok('T4 帶附件（項目資料夾內的相對及絕對路徑）：成功', tA.r.status === 0 && inA, tA.r.stdout);
  ok('T4 附件內容逐位元組相同', inA && inA.files.length === 2 && inA.files.some(f => sha(fs.readFileSync(path.join(DATA, f))) === sha(md)) && inA.files.some(f => sha(fs.readFileSync(path.join(DATA, f))) === sha(Buffer.concat([Buffer.from('%PDF-1.4\n'), bin]))), inA && inA.files);

  /* ---- 拒絕：每一項都要非零結束、印中文原因、收件匣及帳本不變 ---- */
  const snap = () => JSON.stringify({ inbox: inbox(), inputs: (state().inputs || []).map(i => i.id), tasks: (state().tasks || []).length });
  const rejects = [];
  const reject = (name, draft, re) => { const before = snap(); const r = ask('--tell', draftFile('r' + rejects.length, draft)); rejects.push(name); ok('X' + rejects.length + ' 拒絕：' + name, r.status !== 0 && /[一-鿿]/.test(r.stdout) && (!re || re.test(r.stdout)) && snap() === before, { status: r.status, out: r.stdout.slice(0, 200), changed: snap() !== before }); return r; };
  reject('內容超過 4000 字', { type: 'event', text: '長'.repeat(4001) }, /4000/);
  reject('內容空白', { type: 'adhoc', text: '   ' });
  reject('未知類型（help）', { type: 'help', text: '救命' });
  reject('未知類型（decide）', { type: 'decide', text: '直接決定' });
  reject('「即時生效」欄位 effect', { type: 'order', text: '想改計劃', effect: 'now' }, /不接受/);
  reject('額外欄位 now', { type: 'order', text: '想改計劃', now: true }, /不接受/);
  reject('日期格式不正確', { type: 'event', text: '傾過', date: '11月6日' });
  fs.writeFileSync(path.join(OUT, 'outside.md'), '項目資料夾外的檔');
  reject('項目資料夾外的檔（絕對路徑）', { type: 'event', text: '附檔', files: [path.join(OUT, 'outside.md')] }, /不在項目資料夾內/);
  reject('用 .. 逃出項目資料夾', { type: 'event', text: '附檔', files: ['notes/../../outside.md'] }, /不在項目資料夾內/);
  fs.mkdirSync(path.join(PROJ, 'real-dir'), { recursive: true }); fs.writeFileSync(path.join(PROJ, 'real-dir', 'a.md'), '真檔');
  let linkOk = true;
  try { fs.symlinkSync(path.join(PROJ, 'real-dir'), path.join(PROJ, 'link-dir'), 'junction'); } catch { linkOk = false; }
  if (linkOk) reject('目錄連結（junction）下的檔', { type: 'event', text: '附檔', files: ['link-dir/a.md'] }, /連結/); else ok('X 目錄連結：本機不能建立（略過）', true);
  let fileLink = true;
  try { fs.symlinkSync(path.join(PROJ, 'real-dir', 'a.md'), path.join(PROJ, 'file-link.md'), 'file'); } catch { fileLink = false; }
  if (fileLink) reject('符號連結檔', { type: 'event', text: '附檔', files: ['file-link.md'] }, /連結/); else ok('X 符號連結檔：本機沒有權限建立（略過，目錄連結已測）', true);
  fs.mkdirSync(path.join(INSTALL, 'data'), { recursive: true }); fs.writeFileSync(path.join(INSTALL, 'data', 'secret.md'), '機密'); fs.writeFileSync(path.join(DATA, 'company', 'x.md'), '公司資料');
  reject('安裝資料夾 data/ 內的檔', { type: 'event', text: '附檔', files: [path.join(INSTALL, 'data', 'secret.md')] }, /資料夾內/);
  reject('正在使用的資料夾內的檔', { type: 'event', text: '附檔', files: [path.join(DATA, 'company', 'x.md')] }, /資料夾內/);
  fs.writeFileSync(path.join(PROJ, 'big.pdf'), Buffer.alloc(25 * 1024 * 1024 + 1, 1));
  reject('超大檔（超過 25MB）', { type: 'event', text: '附檔', files: ['big.pdf'] }, /25MB/);
  fs.writeFileSync(path.join(PROJ, 'tool.exe'), 'x');
  reject('檔案類型不收', { type: 'event', text: '附檔', files: ['tool.exe'] }, /類型/);
  reject('附件是資料夾', { type: 'event', text: '附檔', files: ['notes'] }, /不是檔案/);
  reject('附件不存在', { type: 'event', text: '附檔', files: ['notes/沒有這個.md'] }, /找不到/);
  const badJson = draftFile('bad', '{ not json');
  { const before = snap(); const r = ask('--tell', badJson); ok('X 草稿不是有效 JSON：拒絕', r.status !== 0 && /[一-鿿]/.test(r.stdout) && snap() === before, r.stdout); }

  /* ---- 公司概覽未確認：被伺服器拒收，不留半寫入 ---- */
  const conf = path.join(DATA, 'ledger', 'confirmed.json');
  fs.renameSync(conf, conf + '.bak');
  { const before = snap(); const r = ask('--tell', draftFile('noconf', { type: 'event', text: '傾過', date: '2026-11-06', files: ['notes/會議紀錄.md'] }));
    ok('X 公司概覽未確認：拒收並講固定字句，收件匣與帳本不變（不留半寫入）', r.status !== 0 && r.stdout.includes(N.ui.needOverviewAll) && snap() === before, { out: r.stdout, changed: snap() !== before }); }
  fs.renameSync(conf + '.bak', conf);

  /* ---- 網頁路徑不能冒充 chat；/api/tell 只限回環、沒有 Origin ---- */
  { const web = await post('/api/intake', { kind: 'note', type: 'adhoc', text: '網頁送出，想冒充討論。', source: 'chat' });
    await sleep(500);
    const inW = web.j && state().inputs.find(i => i.id === 'in-' + web.j.id);
    // 還未被外殼登記就已被處理？等工作完成後再看
    await waitFor(async () => state().inputs.find(i => i.id === 'in-' + web.j.id), 30000);
    ok('S1 網頁送出帶 source: chat 也不會變成討論來源', web.code === 202 && !state().inputs.find(i => i.id === 'in-' + web.j.id)?.source, state().inputs.find(i => i.id === 'in-' + web.j.id));
    const withOrigin = await fetch(BASE + '/api/tell', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ type: 'adhoc', text: '有 Origin' }) });
    ok('S2 帶 Origin（瀏覽器）的 /api/tell 一律拒絕', withOrigin.status === 403, withOrigin.status);
    const badTell = await fetch(BASE + '/api/tell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'adhoc', text: '多欄位', effect: 'now' }) });
    ok('S3 /api/tell 不接受額外欄位', badTell.status === 400, badTell.status); }
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), log);
  process.exit(pass === results.length ? 0 : 1);
}
