// 裝置通行證（設計 2026-10-31 第 3 節）：冇通行證嘅請求對每條資料／動作路由都 403 而且乜都唔寫；公開路由照舊；
// 一次性連結只限測試實例回傳、兌換一次即作廢；頁面冇通行證就顯示配對指引；系統設定頁列出裝置、撤銷即失效；
// 檔案只有雜湊；ask.mjs 嘅輸出冇任何通行證或一次性連結。
// 用法：node pass-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { seedCompany, certify, usePass, pair, passCookie, passCookieName, installPass } from '../lib/testkit.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT] = process.argv.slice(2);
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const DATA = path.join(OUT, 'data');
const BASE = `http://127.0.0.1:${PORT}`;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
seedCompany(DATA, PROTO);
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const raw = (p, init) => fetch(BASE + p, init);
const json = async (p, init) => { const r = await raw(p, init); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j, r }; };
const post = (p, body, extra = {}) => raw(p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, ...extra }, body: JSON.stringify(body) });
const listFiles = d => { try { return fs.readdirSync(d).sort(); } catch { return []; } };
const SHOTS = process.env.SOS_R1A_SHOTS || '';
async function shotBoth(c, file, url) {
  for (const w of [1440, 390]) {
    await c.go(url, w, 2200);
    const f = path.join(OUT, `${file}-${w}.png`); await c.shot(f, null, { full: true });
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.copyFileSync(f, path.join(SHOTS, `${file}-${w}.png`)); }
  }
}
let c = null;
try {
  let up = false;
  for (let i = 0; i < 240 && !up; i++) { try { up = (await raw('/api/health')).ok; } catch { } if (!up) await sleep(250); }
  ok('伺服器起到；/api/health 公開而且只有身份欄位', up && (await json('/api/health')).j.root === lib.rootId(DATA) && !('company' in (await json('/api/health')).j) && !('runs' in (await json('/api/health')).j), (await json('/api/health')).j);

  // F1：SOS_DATA 即使以 Windows 大小寫、尾斜線、點段或 junction 指回預設 data/，都不可開測試發連結鉤。
  async function noTestLinkForDefaultAlias(label, aliasOf, port) {
    const copy = path.join(OUT, 'alias-' + label), defaultData = path.join(copy, 'data');
    fs.cpSync(PROTO, copy, { recursive: true, filter: source => !['data', 'demo-data'].includes(path.relative(PROTO, source).split(path.sep)[0]) });
    seedCompany(defaultData, copy);
    const child = spawn(process.execPath, [path.join(copy, 'server.mjs'), '--port', String(port)], { cwd: copy, env: { ...process.env, SOS_DATA: aliasOf(defaultData), SOS_NO_OPEN: '1' }, stdio: 'ignore' });
    try {
      let ready = false; for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch { } if (!ready) await sleep(100); }
      const r = ready && await fetch(`http://127.0.0.1:${port}/api/pass/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk', noOpen: true }) });
      const j = r && await r.json();
      return !!(ready && r.ok && j && j.ok === true && !Object.hasOwn(j, 'link'));
    } finally { try { child.kill(); } catch { } await sleep(180); }
  }
  if (process.platform === 'win32') {
    const f1cases = [
      ['大小寫', d => d.slice(0, -4) + 'DATA'],
      ['尾斜線', d => d + path.sep],
      ['點段', d => d + path.sep + '..' + path.sep + 'data']
    ];
    for (let i = 0; i < f1cases.length; i++) {
      const [label, aliasOf] = f1cases[i];
      ok(`SOS_DATA ${label} 指向預設資料夾時不會開測試發連結鉤`, await noTestLinkForDefaultAlias(label, aliasOf, Number(PORT) + 20 + i), label);
    }
    const junctionRoot = path.join(OUT, 'alias-junction'), junctionData = path.join(junctionRoot, 'data'), junction = path.join(junctionRoot, 'data-junction');
    fs.cpSync(PROTO, junctionRoot, { recursive: true, filter: source => !['data', 'demo-data'].includes(path.relative(PROTO, source).split(path.sep)[0]) });
    seedCompany(junctionData, junctionRoot);
    try {
      fs.symlinkSync(junctionData, junction, 'junction');
      const jp = Number(PORT) + 24, child = spawn(process.execPath, [path.join(junctionRoot, 'server.mjs'), '--port', String(jp)], { cwd: junctionRoot, env: { ...process.env, SOS_DATA: junction, SOS_NO_OPEN: '1' }, stdio: 'ignore' });
      let ready = false; for (let i = 0; i < 80 && !ready; i++) { try { ready = (await fetch(`http://127.0.0.1:${jp}/api/health`)).ok; } catch { } if (!ready) await sleep(100); }
      const r = ready && await fetch(`http://127.0.0.1:${jp}/api/pass/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk', noOpen: true }) });
      const j = r && await r.json();
      ok('SOS_DATA junction 指向預設資料夾時不會開測試發連結鉤', !!(ready && r.ok && j && j.ok === true && !Object.hasOwn(j, 'link')), 'junction');
      try { child.kill(); } catch { }
    } catch { ok('SOS_DATA junction 指向預設資料夾時不會開測試發連結鉤（環境未能建立 junction）', true); }
  }

  // F2：先以保留的 0.32 程式開同一資料夾，再開新版；新版必須辨認公開 /api/status、停止空閒舊程序，並接管為通行證保護的入口。
  const oldProgram = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'legacy-0.32', 'server.mjs');
  const legacyPort = Number(PORT) + 30;
  // 真實換版係原地：同一個程式資料夾先行 0.32，換入新檔後再開新版（新版只會終止「同一資料夾 server.mjs」而且由作業系統核對到嘅程序）
  const legacyRun = async (folder, label, expectStopped) => {
    const old = spawn(process.execPath, [path.join(folder, 'server.mjs'), '--port', String(legacyPort)], { cwd: folder, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: 'ignore' });
    let oldReady = false; for (let i = 0; i < 80 && !oldReady; i++) { try { oldReady = (await fetch(`http://127.0.0.1:${legacyPort}/api/status`)).ok; } catch { } if (!oldReady) await sleep(100); }
    if (expectStopped) fs.cpSync(PROTO, folder, { recursive: true, filter: s => !/[\\/](data|program)$/.test(s) });
    const replacement = spawn(process.execPath, [path.join(expectStopped ? folder : PROTO, 'server.mjs'), '--port', String(legacyPort)], { cwd: expectStopped ? folder : PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_NO_OPEN: '1' }, stdio: 'ignore' });
    let newReady = false; for (let i = 0; i < 100 && !newReady; i++) { try { newReady = (await fetch(`http://127.0.0.1:${legacyPort}/api/health`)).ok; } catch { } if (!newReady) await sleep(100); }
    await sleep(800);
    let oldAlive = true; try { process.kill(old.pid, 0); } catch { oldAlive = false; }
    const status = await fetch(`http://127.0.0.1:${legacyPort}/api/status`).then(r => r.status).catch(() => 0);
    ok(label, expectStopped ? oldReady && newReady && status === 403 && !oldAlive : oldReady && oldAlive && status === 200, { oldReady, newReady, status, oldAlive });
    try { old.kill(); } catch { } try { replacement.kill(); } catch { } await sleep(300);
  };
  if (fs.existsSync(oldProgram) && process.platform === 'win32') {
    const inPlace = path.join(OUT, 'legacy-in-place');
    fs.rmSync(inPlace, { recursive: true, force: true }); fs.cpSync(path.dirname(oldProgram), inPlace, { recursive: true });
    await legacyRun(inPlace, '換版（原地）：同一資料夾先開 0.32 公開伺服器，換入新檔再開新版，舊程序被停而 /api/status 改為通行證保護', true);
    await legacyRun(path.dirname(oldProgram), '換版（另一資料夾）：身份核對唔到就唔終止任何程序，舊版照舊運行', false);
  }
  const askSource = fs.readFileSync(path.join(PROTO, 'ask.mjs'), 'utf8'), updateSource = fs.readFileSync(path.join(PROTO, 'update.mjs'), 'utf8');
  ok('找伺服器與更新同樣有舊版 /api/status 後備，並標為沒有通行證', /api\/status/.test(askSource) && /沒有通行證/.test(askSource) && /api\/status/.test(updateSource) && /legacy-no-pass/.test(updateSource));

  // F5：helper 的清理只可撤走自己加的通行證，既有與測試期間新增的項目必須保留；測試設定資料夾固定在 OUT。
  const oldLocalAppData = process.env.LOCALAPPDATA, testProfile = path.join(OUT, 'testkit-profile'), cleanupData = path.join(OUT, 'cleanup-data'), cleanupRoot = lib.rootId(cleanupData), cleanupFile = path.join(testProfile, 'startup-os', cleanupRoot, 'passes.json');
  try {
    process.env.LOCALAPPDATA = testProfile;
    fs.mkdirSync(path.dirname(cleanupFile), { recursive: true });
    const makePass = hash => ({ id: hash.slice(0, 8), kind: 'browser', hash, name: '測試', state: 'paired', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
    const original = makePass('a'.repeat(64)), concurrent = makePass('b'.repeat(64));
    fs.writeFileSync(cleanupFile, JSON.stringify({ format: 'startup-os.passes/0.1', passes: [original] }));
    const clean = await installPass(cleanupRoot, '', cleanupData);
    const whileActive = JSON.parse(fs.readFileSync(cleanupFile, 'utf8')); whileActive.passes.push(concurrent); fs.writeFileSync(cleanupFile, JSON.stringify(whileActive));
    clean();
    const left = JSON.parse(fs.readFileSync(cleanupFile, 'utf8')).passes;
    ok('測試通行證清理只移除本次雜湊，保留原有與並行新增裝置', left.length === 2 && left.some(p => p.hash === original.hash) && left.some(p => p.hash === concurrent.hash), left.map(p => p.hash.slice(0, 8)));
  } finally { if (oldLocalAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocalAppData; }

  /* 1. 冇通行證：每條資料／動作路由 403 {error:'pass'}，乜都唔寫 */
  const probeT = 'f'.repeat(36);
  const GETS = ['/api/status', '/api/setup', '/api/intake', '/api/prefill?id=x', '/api/dashboard', '/api/shell', '/api/home?seen=1', '/api/asks', '/api/ask?id=x', '/api/log', '/api/practice', '/api/practice/scenario?id=x', '/api/practice/session?id=x', '/api/debate', '/api/debate/match?id=x', '/api/run?id=R1', '/company-page.js', '/api/sim'];
  const POSTS = [['/api/submit', { kind: 'proofread', ref: 'x', text: 'kind: proofread\n' }], ['/api/retry', {}], ['/api/setup', { action: 'certify', host: 'test' }], ['/api/setup', { action: 'revoke', id: 'aaaaaaaa' }], ['/api/setup', { action: 'observe', op: 'off' }], ['/api/intake', { kind: 'note', type: 'order', text: '測試' }], ['/api/practice', { action: 'start', scenarioId: 'x' }], ['/api/sim', { action: 'advance' }]];
  const before = { replies: listFiles(path.join(DATA, 'founder', 'replies')), inbox: listFiles(path.join(DATA, 'founder', 'inbox')), desk: listFiles(path.join(DATA, 'founder', 'desk')), ledger: listFiles(path.join(DATA, 'ledger')) };
  const bad = [];
  for (const p of GETS) { const { code, j } = await json(p + (p.includes('?') ? '&' : '?') + 't=' + probeT); if (code !== 403 || !j || j.error !== 'pass') bad.push([p, code, j]); }
  for (const [p, body] of POSTS) { const r = await post(p + '?t=' + probeT, body); let j = null; try { j = await r.json(); } catch { } if (r.status !== 403 || !j || j.error !== 'pass') bad.push([p, r.status, j]); }
  ok('冇通行證：每條 GET 資料路由同每條 POST 動作路由都 403 {error:"pass"}（' + (GETS.length + POSTS.length) + ' 條）', bad.length === 0, bad);
  ok('冇通行證：Origin 正確、回環位址都照拒（通行證檢查喺來源檢查之前）', (await post('/api/retry', {})).status === 403);
  const after = { replies: listFiles(path.join(DATA, 'founder', 'replies')), inbox: listFiles(path.join(DATA, 'founder', 'inbox')), desk: listFiles(path.join(DATA, 'founder', 'desk')).filter(f => f !== 'probe-hits.log'), ledger: listFiles(path.join(DATA, 'ledger')) };
  ok('冇通行證：回覆、收件匣、帳本、desk 資料夾冇新檔（只有 probe-hits.log）', JSON.stringify(after) === JSON.stringify(before), { before, after });
  const hits = fs.readFileSync(path.join(DATA, 'founder', 'desk', 'probe-hits.log'), 'utf8').split(/\r?\n/).filter(Boolean);
  ok('403 而網址帶 ?t=<探測 token> 就記一行「<token> refused <方法> <路徑>」', hits.includes(probeT + ' refused GET /api/asks') && hits.includes(probeT + ' refused POST /api/submit') && hits.every(l => /^[a-f0-9]{36} refused (GET|POST) \/\S+$/.test(l)), hits.slice(0, 5));
  ok('冇 ?t= 嘅 403 唔記（探測紀錄只記認證探測）', hits.length === GETS.length + POSTS.length, hits.length);

  /* 2. 公開路由：頁面殼、共用檔、圖、/api/probe */
  const pub = [];
  for (const p of ['/', '/ask.html', '/proofread.html', '/dashboard', '/dashboard/system', '/dashboard/brain/checkup', '/names.js', '/desk.js', '/md.js', '/orbit.js']) { const r = await raw(p); if (r.status !== 200) pub.push([p, r.status]); }
  ok('公開：頁面殼同共用檔冇通行證都 200', pub.length === 0, pub);
  ok('公開：/api/probe 照記 token', (await raw('/api/probe?t=' + 'e'.repeat(36))).status === 200 && fs.readFileSync(path.join(DATA, 'founder', 'desk', 'probe-hits.log'), 'utf8').includes('e'.repeat(36) + '\n'));
  const seenBefore = fs.existsSync(path.join(DATA, 'ledger', 'last-seen.json'));
  await raw('/dashboard');
  ok('冇通行證打開 /dashboard：唔記「上次查看」（唔寫檔）', !fs.existsSync(path.join(DATA, 'ledger', 'last-seen.json')) || seenBefore, listFiles(path.join(DATA, 'ledger')));

  /* 3. /api/pass/open：只限回環、冇 Origin；回應唔含通行證；測試實例先有一次性連結；10 秒內只開一次瀏覽器 */
  ok('瀏覽器（有 Origin）叫 /api/pass/open 被拒', (await post('/api/pass/open', { page: 'desk' })).status === 403);
  ok('/api/pass/open 頁名唔合規格就 400', (await raw('/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: '../x' }) })).status === 400);
  const o1 = await json('/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk' }) });
  const o2 = await json('/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk' }) });
  ok('第一次開：ok、測試實例附一次性連結、回應冇通行證；10 秒內第二次要開瀏覽器就 429', o1.code === 200 && /^\/pass\/[a-f0-9]{64}$/.test(o1.j.link) && !JSON.stringify(o1.j).includes('sos_pass') && o2.code === 429, { o1: o1.j, o2: o2.j });
  const o3 = await json('/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'ask/abc-1', noOpen: true }) });
  ok('noOpen（測試用）：唔開瀏覽器、唔受 10 秒限制、照有連結', o3.code === 200 && o3.j.opened === false && /^\/pass\//.test(o3.j.link));
  const x1 = await raw(o3.j.link, { redirect: 'manual' });
  const sc = x1.headers.get('set-cookie') || '';
  ok('兌換：302 去目標頁、Set-Cookie HttpOnly + SameSite=Strict + Path=/ + 30 日', x1.status === 302 && x1.headers.get('location') === '/#/ask/abc-1' && /^sos_pass_[a-f0-9]{32}=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000$/.test(sc), { loc: x1.headers.get('location'), sc: sc.replace(/=[a-f0-9]{64}/, '=<64hex>') });
  const x2 = await raw(o3.j.link, { redirect: 'manual' });
  ok('同一條連結第二次：作廢（302 去首頁、冇 cookie）', x2.status === 302 && x2.headers.get('location') === '/' && !x2.headers.get('set-cookie'));
  const sealed = await json('/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk', noOpen: true }) });
  const logToken = 'd'.repeat(36);
  const hidden = sealed.j && sealed.j.link ? await raw(sealed.j.link + '?t=' + logToken, { method: 'HEAD' }) : null;
  const afterHidden = fs.readFileSync(path.join(DATA, 'founder', 'desk', 'probe-hits.log'), 'utf8');
  ok('拒絕日誌不記一次性連結或任意路徑，只記固定遮蔽標識', hidden && hidden.status === 403 && afterHidden.includes(logToken + ' refused HEAD /pass/:token') && !/\/pass\/[a-f0-9]{64}/.test(afterHidden), hidden && hidden.status);
  const CK = (/^(sos_pass_[a-f0-9]{32})=/.exec(sc) || [])[1], secret = (/=([a-f0-9]{64})/.exec(sc) || [])[1];
  ok('cookie 名由完整實體資料夾雜湊得出（不同實例不會互相蓋過）', CK === passCookieName(DATA) && CK !== passCookieName(path.join(OUT, 'other-data')), CK);
  const pf = path.join(DATA, 'founder', 'desk', 'passes.json');
  const pfText = fs.readFileSync(pf, 'utf8');
  ok('passes.json 只有雜湊：冇通行證本身、每項有 id／kind／hash／name／日期', !pfText.includes(secret) && JSON.parse(pfText).passes.every(p => /^[a-f0-9]{64}$/.test(p.hash) && p.kind === 'browser' && p.id === p.hash.slice(0, 8) && p.createdAt && p.expiresAt), pfText.slice(0, 300));
  ok('passes.json 唔喺 data/ 以外（測試實例）、亦唔喺 founder/replies 或 inbox', fs.existsSync(pf));
  const withPass = { headers: { Cookie: CK + '=' + secret } };
  const st = await json('/api/status', withPass);
  ok('有通行證：/api/status 200 而且有公司資料', st.code === 200 && st.j.company && st.j.company.ready === true, st.j && st.j.company);
  ok('有通行證：/company-page.js 200', (await raw('/company-page.js', withPass)).status === 200);
  ok('偽造 cookie（隨機 64 位）：403', (await raw('/api/status', { headers: { Cookie: CK + '=' + 'a'.repeat(64) } })).status === 403);
  ok('有通行證但 Origin 錯：POST 403 origin（來源檢查仍在）', (await (await post('/api/retry', {}, { Cookie: CK + '=' + secret, Origin: 'http://evil.test' })).json()).error === 'origin');

  /* 4. 已配對裝置清單同撤銷 */
  const su = await json('/api/setup', withPass);
  ok('/api/setup 列出裝置：呢部標 current、名稱由 User-Agent 粗分', su.code === 200 && su.j.devices.length === 1 && su.j.devices[0].current === true && su.j.devices[0].id === JSON.parse(pfText).passes[0].id && typeof su.j.devices[0].name === 'string' && !('hash' in su.j.devices[0]), su.j.devices);
  // 第二部裝置（Node 測試工具），撤銷佢，佢即刻 403；第一部照用
  const second = (await pair(BASE)).value;
  const su2 = await json('/api/setup', withPass);
  ok('第二部裝置配對後清單有兩部', su2.j.devices.length === 2, su2.j.devices);
  const otherId = su2.j.devices.find(d => !d.current).id;
  ok('撤銷另一部：200', (await post('/api/setup', { action: 'revoke', id: otherId }, { Cookie: CK + '=' + secret })).status === 200);
  ok('被撤銷嘅裝置即刻 403；未撤銷嘅照用', (await raw('/api/status', { headers: { Cookie: CK + '=' + second } })).status === 403 && (await raw('/api/status', withPass)).status === 200);
  ok('撤銷唔存在嘅裝置：404', (await post('/api/setup', { action: 'revoke', id: 'deadbeef' }, { Cookie: CK + '=' + secret })).status === 404);

  /* 5. ask.mjs：輸出冇通行證、冇一次性連結；用 /api/health 認伺服器 */
  const pack = path.join(OUT, 'pack.json');
  fs.writeFileSync(pack, JSON.stringify({ format: 'startup-os.ask/0.1', title: '測試：通行證', questions: [{ id: 'a', ask: '何時開始？', kind: 'date', value: '2026-11-02', why: '測試' }] }));
  // ask.mjs 一定要搵到本測試伺服器（SOS_PORT），唔可以自己喺 4380 起嘅埠開新伺服器；先用一次開頁額度，令 ask.mjs 嗰次撞 429（測試伺服器有 SOS_NO_OPEN，唔會開真瀏覽器）
  const envAskRejected = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_PORT: String(PORT) }; delete envAskRejected.SOS_NO_OPEN;
  await json('/api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk' }) });
  const throttled = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--dashboard'], { cwd: PROTO, encoding: 'utf8', env: envAskRejected });
  ok('開頁限流 429：ask.mjs 如實說明瀏覽器未打開並以失敗碼結束', throttled.status === 1 && throttled.stdout.includes(N.ui.openTooSoon) && /瀏覽器未有打開/.test(throttled.stdout) && !/\/pass\/|sos_pass|[a-f0-9]{64}/.test(throttled.stdout), throttled.stdout);
  const envAsk = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', SOS_PORT: String(PORT) };
  const a1 = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), pack], { cwd: PROTO, encoding: 'utf8', env: envAsk });
  const a2 = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--desk'], { cwd: PROTO, encoding: 'utf8', env: envAsk });
  const outAll = a1.stdout + a1.stderr + a2.stdout + a2.stderr;
  ok('ask.mjs 放問題包並開頁：結束碼 0、印普通網址', a1.status === 0 && /CrewZero：http:\/\/127\.0\.0\.1:\d+\/#\/ask\//.test(a1.stdout) && a2.status === 0 && /CrewZero：http:\/\/127\.0\.0\.1:\d+\/\s*$/m.test(a2.stdout), outAll);
  ok('ask.mjs 輸出零 token：冇 /pass/、冇 64 位十六進制、冇 sos_pass', !/\/pass\//.test(outAll) && !/[a-f0-9]{64}/.test(outAll) && !/sos_pass/.test(outAll), outAll);
  ok('ask.mjs 原始碼唔再自己開瀏覽器、改經 /api/pass/open、用 /api/health 認伺服器', (() => { const t = fs.readFileSync(path.join(PROTO, 'ask.mjs'), 'utf8'); return !/'start', ''/.test(t) && t.includes('api/pass/open') && t.includes('api/health') && t.indexOf('api/health') >= 0 && t.indexOf('api/health') < t.indexOf('/api/status'); })());

  /* 6. 正實例（冇 SOS_DATA）：/api/pass/open 永不回傳連結 */
  const REAL = path.join(OUT, 'real-proto'); fs.mkdirSync(REAL, { recursive: true });
  fs.cpSync(PROTO, REAL, { recursive: true, filter: src => !['data', 'demo-data', 'node_modules'].includes(path.relative(PROTO, src).split(path.sep)[0]) });
  const RP = Number(PORT) + 3, envReal = { ...process.env, SOS_NO_OPEN: '1' }; delete envReal.SOS_DATA; delete envReal.SOS_SIM; delete envReal.SOS_ADAPTER;
  const real = spawn(process.execPath, [path.join(REAL, 'server.mjs'), '--port', String(RP)], { cwd: REAL, env: envReal, stdio: 'ignore' });
  try {
    let up2 = false; for (let i = 0; i < 120 && !up2; i++) { try { up2 = (await fetch(`http://127.0.0.1:${RP}/api/health`)).ok; } catch { } if (!up2) await sleep(250); }
    const ro = await (await fetch(`http://127.0.0.1:${RP}/api/pass/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'desk', noOpen: true }) })).json();
    ok('正實例：/api/pass/open 回 ok 但冇 link、冇任何 token', up2 && ro.ok === true && !('link' in ro) && !/[a-f0-9]{64}/.test(JSON.stringify(ro)), ro);
    ok('正實例：/api/status 一樣 403', (await fetch(`http://127.0.0.1:${RP}/api/status`)).status === 403);
    ok('正實例：data/ 入面冇 passes.json', !fs.existsSync(path.join(REAL, 'data', 'founder', 'desk', 'passes.json')));
  } finally { real.kill(); }

  /* 7. 頁面：冇通行證 → 配對指引；有通行證 → 正常；系統設定頁裝置清單；撤銷自己即見指引 */
  await certify(BASE, 'test').catch(() => null);
  if (CHROME) {
    c = await openChrome(CHROME, path.join(OUT, 'profile'), Number(PORT) + 5);
    await c.go(BASE + '/', 1440, 2500);
    const np = await c.ev(`(()=>{const e=document.getElementById('no-pass');return e?{title:e.querySelector('h2').textContent,text:e.innerText}:null})()`);
    ok('首頁冇通行證：全頁顯示「此瀏覽器未與 CrewZero 配對」同三種工具嘅 dashboard 叫法', np && np.title === N.ui.noPassTitle && np.title === '此瀏覽器未與 CrewZero 配對' && /\/crewzero:dashboard（Claude Code）/.test(np.text) && /\$crewzero:dashboard（Codex）/.test(np.text) && /\/dashboard（Antigravity）/.test(np.text) && !/\/pass\//.test(np.text), np);
    await shotBoth(c, '403-desk', BASE + '/');
    await c.go(BASE + '/dashboard', 1440, 2500);
    const npd = await c.ev(`(()=>{const e=document.getElementById('no-pass');return e?e.innerText:null})()`);
    ok('營運監察台冇通行證：指引講 /crewzero:dashboard', npd && /\/crewzero:dashboard（Claude Code）/.test(npd), npd);
    await c.go(BASE + '/proofread.html', 1440, 2500);
    const npc = await c.ev(`(()=>{return {np:!!document.getElementById('no-pass'),noco:!!document.getElementById('no-company')}})()`);
    ok('公司概覽冇通行證：顯示指引、唔會誤顯示「未有公司概覽」', npc.np && !npc.noco, npc);
    // 配對（cookie 入 Chrome）後：正常頁面
    await usePass(BASE, c);
    await c.go(BASE + '/', 1440, 2500);
    const hub = await c.ev(`(()=>({np:!!document.getElementById('no-pass'),app:document.getElementById('app').innerText.slice(0,2000)}))()`);
    ok('已配對：Founder Desk 正常顯示（有問題包、冇指引）', !hub.np && /測試：通行證/.test(hub.app), hub);
    await shotBoth(c, 'desk-paired', BASE + '/');
    await c.go(BASE + '/#/setup', 1440, 2500);
    const dev = await c.ev(`(()=>{const l=[...document.querySelectorAll('#devices-card .dev-list li')];return {n:l.length,cur:l.filter(x=>x.dataset.current==='true').length,text:document.getElementById('devices-card').innerText}})()`);
    ok('系統設定頁：裝置清單列出已配對瀏覽器，呢部標「此瀏覽器」、有日期、有撤銷', dev.n >= 2 && dev.cur === 1 && dev.text.includes(N.ui.devices) && dev.text.includes(N.ui.deviceThis) && dev.text.includes(N.ui.deviceRevoke) && /\d{4} 年 \d{1,2} 月 \d{1,2} 日/.test(dev.text) && !/[a-f0-9]{64}/.test(dev.text), dev);
    await shotBoth(c, 'setup-devices', BASE + '/#/setup');
    await c.go(BASE + '/dashboard/system', 1440, 2500);
    const dev2 = await c.ev(`(()=>{const l=[...document.querySelectorAll('#devices .dev-list li')];return {n:l.length,cur:l.filter(x=>x.dataset.current==='true').length}})()`);
    ok('監察台系統分頁：同一份裝置清單', dev2.n === dev.n && dev2.cur === 1, dev2);
    await shotBoth(c, 'dashboard-system-devices', BASE + '/dashboard/system');
    // 撤銷自己：按兩次（第一次只係確認）；之後讀回 403 → 指引
    await c.go(BASE + '/#/setup', 1440, 2500);
    const curId = await c.ev(`document.querySelector('#devices-card li[data-current="true"] [data-revoke]').getAttribute('data-revoke')`);
    await c.click('#devices-card li[data-current="true"] [data-revoke]');
    const armed = await c.ev(`document.querySelector('#devices-card li[data-current="true"] [data-revoke]').textContent`);
    ok('撤銷按鈕第一次只係確認句', armed === N.ui.deviceRevokeConfirm, armed);
    await c.click('#devices-card li[data-current="true"] [data-revoke]');
    await sleep(1500);
    const gone = await c.ev(`!!document.getElementById('no-pass')`);
    ok('撤銷自己呢部之後：清單冇咗佢、頁面即刻見到配對指引', gone && !JSON.parse(fs.readFileSync(pf, 'utf8')).passes.some(p => p.id === curId), { gone, curId });
    ok('頁面冇 JavaScript 錯誤', c.errors.length === 0, c.errors);
  }
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  if (c) c.close();
  srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`${pass} / ${results.length}`);
  process.exit(pass === results.length ? 0 : 1);
}
