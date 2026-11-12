// Google 連結取回（link-fetch.mjs）測試：辨認網址、抽出連結、成功取回、各種失敗、路徑安全
// 全部用注入的假 fetch，零外網請求；每次請求都記錄並斷言主機名只可能是 Google 的三種網域
// 用法：node tests/prototype/core/link-fetch-test.mjs （結束碼 0 = 全過）
import fs from 'node:fs';
import { assertTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.join(HERE, '..', '..', '..', 'prototypes', 'proofread', 'link-fetch.mjs');
const { parseGoogleLink, findGoogleLinks, fetchGoogleLink } = await import(pathToFileURL(MOD).href);

const t0 = Date.now();
const results = [];
const ok = (name, pass, info) => { results.push({ name, pass: !!pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  <- ' + JSON.stringify(info))); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-';
const DOC = `https://docs.google.com/document/d/${ID}/edit`;
const SHEET = `https://docs.google.com/spreadsheets/d/${ID}/edit`;
const SLIDES = `https://docs.google.com/presentation/d/${ID}/edit`;

/* ---------- 一：parseGoogleLink ---------- */
{
  const p = s => parseGoogleLink(s);
  const good = [
    [`https://docs.google.com/document/d/${ID}/edit`, 'doc'],
    [`https://docs.google.com/document/d/${ID}/edit?usp=sharing`, 'doc'],
    [`https://docs.google.com/document/u/1/d/${ID}/view`, 'doc'],
    [`https://docs.google.com/u/1/document/d/${ID}/edit`, 'doc'],
    [`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=123`, 'sheet'],
    [`https://docs.google.com/spreadsheets/u/0/d/${ID}/edit?usp=sharing#gid=0`, 'sheet'],
    [`  https://docs.google.com/presentation/d/${ID}/edit?usp=sharing  `, 'slides'],
    [`https://docs.google.com/presentation/d/${ID}`, 'slides'],
    [`https://docs.google.com/presentation/d/${ID}/view`, 'slides'],
  ];
  for (const [s, kind] of good) {
    const r = p(s);
    ok('辨認：' + s.trim().slice(24, 70), r && r.kind === kind && r.id === ID && /^https:\/\/docs\.google\.com\/[a-z]+\/d\/[^/]+\/edit$/.test(r.url), r);
  }
  const bad = [
    `http://docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com.evil.com/document/d/${ID}/edit`,
    `https://evil.com/docs.google.com/document/d/${ID}/edit`,
    `https://evil.com/?u=https://docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com/document/d/short123/edit`,
    `https://docs.google.com/document/d/${ID.slice(0, 19)}/edit`,
    `https://user:pw@docs.google.com/document/d/${ID}/edit`,
    `https://user@docs.google.com/document/d/${ID}/edit`,
    `https://142.250.1.1/document/d/${ID}/edit`,
    `https://[::1]/document/d/${ID}/edit`,
    `https://docs.google.com:8443/document/d/${ID}/edit`,
    `https://docs.google.com./document/d/${ID}/edit`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://docs.google.com/forms/d/${ID}/edit`,
    `https://docs.google.com/document/d/e/2PACX-1vSomethingPublishedDoc/pub`,
    `https://docs.google.com/document/d/${ID}x.y/edit`,
    `https://docs.google.com/document/`,
    `docs.google.com/document/d/${ID}/edit`,
    `請看 https://docs.google.com/document/d/${ID}/edit`,
    '', null, undefined, 42,
  ];
  for (const s of bad) ok('拒絕：' + String(s).slice(0, 60), p(s) === null, p(s));
}

/* ---------- 二：findGoogleLinks ---------- */
{
  const text = `大家好，預算表在這裡：${SHEET}?usp=sharing，簡報請見 (${SLIDES}#slide=id.p) 謝謝。\n`
    + `Doc: ${DOC}. Again the budget: ${SHEET}#gid=7 and a bad one http://docs.google.com/document/d/${ID}/edit and https://example.com/x`;
  const r = findGoogleLinks(text);
  ok('抽出：中英文混合，重複、http、其他網域不收', r.length === 3 && same(r.map(x => x.kind), ['sheet', 'slides', 'doc']), r);
  const twoOnly = findGoogleLinks(`請看 ${SHEET}，還有 ${SLIDES}。重複 ${SHEET}`);
  ok('抽出：兩條、重複去重', twoOnly.length === 2 && twoOnly[0].kind === 'sheet' && twoOnly[1].kind === 'slides', twoOnly);
  const many = Array.from({ length: 8 }, (_, i) => `https://docs.google.com/document/d/${ID.slice(0, 38)}${String(i).padStart(2, '0')}/edit`).join(' ');
  ok('抽出：上限 5 條', findGoogleLinks(many).length === 5, findGoogleLinks(many).length);
  ok('抽出：無連結回空陣列', same(findGoogleLinks('沒有連結 only text'), []) && same(findGoogleLinks(null), []));
  ok('抽出：句尾標點與括號不被當成網址一部分', findGoogleLinks(`（${DOC}）。`)[0]?.id === ID);
}

/* ---------- 假 fetch ---------- */
const ALLOWED_HOSTS = h => h === 'docs.google.com' || h === 'accounts.google.com' || h.endsWith('.googleusercontent.com') || h === 'evilgoogleusercontent.com' || h === 'googleusercontent.com.evil.com' || h === 'evil.com';
const requests = [];
const allRequests = []; // 累計（requests 會被個別測試清空）
const tmpRoot = makeTestTemp('crewzero-linkfetch-');
let dirN = 0;
const newDir = () => path.join(tmpRoot, 'dest' + (++dirN));
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 1)]);
const XLSX = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(300, 2)]);
const MD = Buffer.from('# 標題\n\n內容\n', 'utf8');
const TXT = Buffer.from('第一頁\n第二頁\n', 'utf8');
const cdStar = name => `attachment; filename="x.bin"; filename*=UTF-8''${encodeURIComponent(name)}`;

const resp = (status, body, headers = {}) => new Response(body, { status, headers });
const redirect = (loc, status = 307) => new Response(null, { status, headers: { location: loc } });
const hostOf = u => new URL(u).hostname;
const CONTENT = 'https://doc-0s-sheets.googleusercontent.com/export/abc';

// handler(url, init) => Response | Promise<Response>；包一層記錄請求並核對主機名
function fake(handler) {
  return async (url, init) => {
    const u = new URL(url);
    requests.push({ url: String(url), host: u.hostname, init });
    allRequests.push({ url: String(url), host: u.hostname });
    return handler(String(url), init || {}, u);
  };
}
// 正常的 Google：docs.google.com 的匯出網址 307 到 googleusercontent，再 200
function goodGoogle({ title = '預算表', mdType = 'text/x-markdown' } = {}) {
  return fake((url, init, u) => {
    if (u.hostname === 'docs.google.com') {
      const tag = u.pathname.replace(/^.*\/d\/[^/]+\//, '') + u.search; // export?format=md 等
      return redirect(CONTENT + '?x=' + encodeURIComponent(tag));
    }
    const tag = decodeURIComponent(u.searchParams.get('x') || '');
    const cd = cdStar(title + '.' + (tag.includes('xlsx') ? 'xlsx' : tag.includes('md') ? 'md' : tag.includes('txt') ? 'txt' : 'pdf'));
    if (tag.includes('format=md')) return resp(200, MD, { 'content-type': mdType, 'content-disposition': cd });
    if (tag.includes('format=pdf') || tag.includes('export/pdf')) return resp(200, PDF, { 'content-type': 'application/pdf', 'content-disposition': cd });
    if (tag.includes('format=xlsx')) return resp(200, XLSX, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': cd });
    if (tag.includes('export/txt')) return resp(200, TXT, { 'content-type': 'text/plain', 'content-disposition': cd });
    return resp(404, 'no');
  });
}
const NOW = () => new Date(2026, 10, 7, 9, 30);
const inside = (dir, f) => path.dirname(path.resolve(f.path)) === path.resolve(dir) && f.path === path.resolve(dir, f.name);
const fetchIt = (link, fetchImpl, extra = {}) => fetchGoogleLink(link, { destDir: extra.destDir || newDir(), fetchImpl, now: NOW, ...extra });

/* ---------- 三：成功路徑 ---------- */
{
  const dir = newDir();
  const r = await fetchIt(parseGoogleLink(DOC), goodGoogle(), { destDir: dir });
  ok('成功：doc 取得 md 與 pdf', r.ok && r.kind === 'doc' && r.files.length === 2 && r.files[0].role === 'text' && r.files[0].name === '預算表.md' && r.files[1].role === 'original' && r.files[1].name === '預算表.pdf', r);
  ok('成功：doc 顯示名、讀取日期、網址', r.title === '預算表' && r.readOn === '2026-11-07' && r.url === DOC, { title: r.title, readOn: r.readOn, url: r.url });
  ok('成功：檔案在 destDir 內，內容與大小正確', r.files.every(f => inside(dir, f) && fs.existsSync(f.path)) && fs.readFileSync(r.files[0].path, 'utf8') === MD.toString('utf8') && r.files[1].bytes === PDF.length && fs.statSync(r.files[1].path).size === PDF.length, r.files);
  ok('成功：destDir 內只有這兩個檔', same(fs.readdirSync(dir).sort(), ['預算表.md', '預算表.pdf'].sort()), fs.readdirSync(dir));
}
{
  const dir = newDir();
  const r = await fetchIt(parseGoogleLink(SHEET), goodGoogle({ title: '營運 預算' }), { destDir: dir });
  ok('成功：sheet 取得 xlsx（original）', r.ok && r.kind === 'sheet' && r.files.length === 1 && r.files[0].role === 'original' && r.files[0].name === '營運_預算.xlsx' && r.title === '營運 預算' && inside(dir, r.files[0]), r);
  ok('成功：xlsx 內容原樣', fs.readFileSync(r.files[0].path).equals(XLSX));
}
{
  const dir = newDir();
  const r = await fetchIt(parseGoogleLink(SLIDES), goodGoogle({ title: 'Pitch deck' }), { destDir: dir });
  ok('成功：slides 取得 pdf（original）與 txt（text）', r.ok && r.kind === 'slides' && r.files.length === 2 && r.files[0].role === 'original' && r.files[0].name === 'Pitch_deck.pdf' && r.files[1].role === 'text' && r.files[1].name === 'Pitch_deck.txt', r);
}
{
  // 請求細節：先打 docs.google.com，307 後打 googleusercontent；手動轉址、沒有 cookie／授權標頭、UA 為 CrewZero
  requests.length = 0;
  await fetchIt(parseGoogleLink(DOC), goodGoogle());
  const first = requests.filter(q => q.host === 'docs.google.com'), second = requests.filter(q => q.host.endsWith('.googleusercontent.com'));
  ok('請求：doc 的 md、pdf 各一次，每次經一次 307', first.length === 2 && second.length === 2 && first[0].url.includes('/export?format=md') && first[1].url.includes('/export?format=pdf'), requests.map(q => q.url));
  ok('請求：redirect manual、不帶 cookie／授權、UA 為 CrewZero', requests.every(q => q.init.redirect === 'manual' && q.init.headers['User-Agent'] === 'CrewZero' && !Object.keys(q.init.headers).some(k => /cookie|authorization/i.test(k)) && q.init.credentials === 'omit' && q.init.method === 'GET' && q.init.signal), requests[0].init);
  requests.length = 0;
  await fetchIt(parseGoogleLink(SLIDES), goodGoogle());
  ok('請求：slides 用 export/pdf 與 export/txt', requests.some(q => q.url.includes('/presentation/d/' + ID + '/export/pdf')) && requests.some(q => q.url.includes('/export/txt')));
  requests.length = 0;
  await fetchIt(parseGoogleLink(SHEET), goodGoogle());
  ok('請求：sheet 用 export?format=xlsx', requests.some(q => q.url === `https://docs.google.com/spreadsheets/d/${ID}/export?format=xlsx`));
}
{
  // 中文檔名：filename*=UTF-8'' 百分比編碼；普通 filename="..."；沒有標頭則用預設名
  const mk = cd => fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, XLSX, { 'content-type': 'application/octet-stream', ...(cd ? { 'content-disposition': cd } : {}) }));
  const a = await fetchIt(parseGoogleLink(SHEET), mk(`attachment; filename="download.xlsx"; filename*=UTF-8''%E9%A0%90%E7%AE%97%E8%A1%A8%202026.xlsx`));
  ok('檔名：filename*=UTF-8 百分比編碼解碼', a.ok && a.title === '預算表 2026' && a.files[0].name === '預算表_2026.xlsx', a.title);
  const b = await fetchIt(parseGoogleLink(SHEET), mk(`attachment; filename="Budget v1.2.xlsx"`));
  ok('檔名：普通 filename="…"', b.ok && b.title === 'Budget v1.2' && b.files[0].name === 'Budget_v1.2.xlsx', b.title);
  const c = await fetchIt(parseGoogleLink(SHEET), mk(null));
  ok('檔名：沒有 Content-Disposition 用預設名', c.ok && c.title === 'Google 試算表' && c.files[0].name === 'Google_試算表.xlsx', c.title);
  const d = await fetchIt(parseGoogleLink(DOC), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT + '?m=' + (url.includes('md') ? 'md' : 'pdf')) : url.includes('m=md') ? resp(200, MD, { 'content-type': 'text/markdown' }) : resp(200, PDF, { 'content-type': 'application/pdf' })));
  ok('檔名：doc 沒標頭時用「Google 文件」；text/markdown 通過', d.ok && d.title === 'Google 文件' && d.files.length === 2, d);
  const e = await fetchIt(parseGoogleLink(SHEET), mk(`attachment; filename="${Buffer.from('預算表.xlsx', 'utf8').toString('latin1')}"`));
  ok('檔名：以 latin1 讀進來的 UTF-8 普通 filename 會還原', e.ok && e.title === '預算表', e.title);
  // 同名衝突
  const dir = newDir();
  const x1 = await fetchIt(parseGoogleLink(SHEET), goodGoogle(), { destDir: dir });
  const x2 = await fetchIt(parseGoogleLink(SHEET), goodGoogle(), { destDir: dir });
  const x3 = await fetchIt(parseGoogleLink(SHEET), goodGoogle(), { destDir: dir });
  ok('同名衝突：加 -2、-3', x1.files[0].name === '預算表.xlsx' && x2.files[0].name === '預算表-2.xlsx' && x3.files[0].name === '預算表-3.xlsx' && fs.readdirSync(dir).length === 3, [x1, x2, x3].map(x => x.files[0].name));
}

/* ---------- 四：失敗路徑 ---------- */
{
  const dir = newDir();
  const link = parseGoogleLink(DOC);
  const shape = r => r && r.ok === false && r.kind === 'doc' && r.url === DOC && Object.keys(r).sort().join() === 'kind,ok,reason,url';
  let r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('https://accounts.google.com/ServiceLogin?continue=x') : resp(200, 'x')), { destDir: dir });
  ok('失敗：轉到 accounts.google.com → not-shared', shape(r) && r.reason === 'not-shared', r);
  ok('失敗後 destDir 沒有檔案', !fs.existsSync(dir) || fs.readdirSync(dir).length === 0);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, '<html>login</html>', { 'content-type': 'text/html; charset=utf-8' })));
  ok('失敗：200 但 text/html → not-shared', shape(r) && r.reason === 'not-shared', r);
  r = await fetchIt(link, fake(() => resp(401, 'no')));
  ok('失敗：401 → not-shared', r.reason === 'not-shared', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(403, 'no')));
  ok('失敗：403 → not-shared', r.reason === 'not-shared', r);
  r = await fetchIt(link, fake(() => resp(404, 'nf')));
  ok('失敗：404 → not-found', shape(r) && r.reason === 'not-found', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('https://evilgoogleusercontent.com/x') : resp(200, 'x')));
  ok('失敗：轉到 evilgoogleusercontent.com → blocked-redirect', shape(r) && r.reason === 'blocked-redirect', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('https://googleusercontent.com.evil.com/x') : resp(200, 'x')));
  ok('失敗：轉到 googleusercontent.com.evil.com → blocked-redirect', r.reason === 'blocked-redirect', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('https://evil.com/x') : resp(200, 'x')));
  ok('失敗：轉到其他網域 → blocked-redirect', r.reason === 'blocked-redirect', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('http://doc-0s.googleusercontent.com/x') : resp(200, 'x')));
  ok('失敗：轉到 http:// → blocked-redirect', r.reason === 'blocked-redirect', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('https://doc-0s.googleusercontent.com:8443/x') : resp(200, 'x')));
  ok('失敗：轉到不同連接埠 → blocked-redirect', r.reason === 'blocked-redirect', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('https://googleusercontent.com/x') : resp(200, 'x')));
  ok('失敗：轉到裸 googleusercontent.com（非子網域）→ blocked-redirect', r.reason === 'blocked-redirect', r);
  r = await fetchIt(link, fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect('/relative/path') : resp(200, 'x')));
  ok('失敗：相對路徑轉址（仍在 docs.google.com）→ blocked-redirect', r.reason === 'blocked-redirect', r);

  // 轉址次數：3 次可以，第 4 次擋
  let n = 0;
  n = 0; r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => { n++; return n <= 3 ? redirect('https://doc-' + n + '.googleusercontent.com/x') : resp(200, XLSX, { 'content-type': 'application/octet-stream' }); }));
  ok('轉址：剛好 3 次仍成功', r.ok === true, r);
  n = 0; r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => { n++; return redirect('https://doc-' + n + '.googleusercontent.com/x'); }));
  ok('轉址：超過 3 次 → blocked-redirect（且只打了 4 次請求）', r.reason === 'blocked-redirect' && n === 4, { r, n });

  // 大小：Content-Length 超上限、串流超上限
  let bodyRead = false;
  r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, XLSX, { 'content-type': 'application/octet-stream', 'content-length': String(5000) })), { maxBytes: 1000 });
  ok('失敗：Content-Length 超上限 → too-big', r.ok === false && r.reason === 'too-big', r);
  const dir2 = newDir();
  const streamOver = new ReadableStream({
    start(c) { c.enqueue(new Uint8Array([0x50, 0x4b, 3, 4])); },
    pull(c) { bodyRead = true; c.enqueue(new Uint8Array(400)); },
  });
  r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : new Response(streamOver, { status: 200, headers: { 'content-type': 'application/octet-stream' } })), { maxBytes: 1000, destDir: dir2 });
  ok('失敗：串流超上限（無 Content-Length）→ too-big，且沒有殘留檔', r.ok === false && r.reason === 'too-big' && bodyRead && (!fs.existsSync(dir2) || fs.readdirSync(dir2).length === 0), { r, files: fs.existsSync(dir2) ? fs.readdirSync(dir2) : null });
  const dir2b = newDir();
  r = await fetchIt(parseGoogleLink(DOC), goodGoogle(), { maxBytes: 10, destDir: dir2b });
  ok('失敗：doc 兩個格式都超上限 → too-big，沒有殘留檔', r.reason === 'too-big' && (!fs.existsSync(dir2b) || fs.readdirSync(dir2b).length === 0), r);

  // 逾時：假 fetch 不回應（且不理 signal）；以及串流讀到一半停住
  let ts = Date.now();
  r = await fetchIt(link, fake(() => new Promise(() => { })), { timeoutMs: 80 });
  ok('失敗：請求不回應 → timeout（遵守 timeoutMs，不依賴假 fetch 理會 signal）', r.reason === 'timeout' && Date.now() - ts < 3000, { r, ms: Date.now() - ts });
  ts = Date.now();
  const hang = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46])); } }); // 送出檔頭後不再出資料
  r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : new Response(hang, { status: 200, headers: { 'content-type': 'application/octet-stream' } })), { timeoutMs: 80 });
  ok('失敗：讀取內容中途停住 → timeout', r.reason === 'timeout' && Date.now() - ts < 3000, { r, ms: Date.now() - ts });

  // 其他失敗
  r = await fetchIt(link, fake(() => { throw new TypeError('fetch failed'); }));
  ok('失敗：fetch 丟錯 → network', r.reason === 'network', r);
  r = await fetchIt(link, fake(() => resp(500, 'err')));
  ok('失敗：500 → network', r.reason === 'network', r);
  r = await fetchIt(link, fake(() => new Response(null, { status: 307 })));
  ok('失敗：307 沒有 Location → network', r.reason === 'network', r);
  r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, Buffer.from('not a zip'), { 'content-type': 'application/octet-stream' })));
  ok('失敗：xlsx 檔頭不是 PK → not-shared', r.reason === 'not-shared', r);
  r = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, XLSX, { 'content-type': 'application/json' })));
  ok('失敗：xlsx 內容類型不符 → not-shared', r.reason === 'not-shared', r);
  r = await fetchIt(parseGoogleLink(SLIDES), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT + '?m=' + (url.includes('pdf') ? 'pdf' : 'txt')) : url.includes('m=pdf') ? resp(200, Buffer.from('<html>'), { 'content-type': 'application/pdf' }) : resp(200, TXT, { 'content-type': 'text/html' })));
  ok('失敗：pdf 檔頭不是 %PDF、txt 為 html → not-shared', r.reason === 'not-shared', r);
  r = await fetchGoogleLink({ kind: 'x', id: ID }, { destDir: newDir(), fetchImpl: fake(() => resp(200, 'x')) });
  ok('失敗：link 內容不合規 → 失敗結果，不發請求', r.ok === false && !requests.some(q => q.url.includes('/x/')), r);
  let threw = false; try { await fetchGoogleLink(parseGoogleLink(DOC), {}); } catch { threw = true; }
  ok('缺 destDir 丟 TypeError', threw);

  // 部分成功：doc 的 md 成功、pdf 失敗仍算成功；md 失敗 pdf 成功亦然；失敗原因取最先遇到的
  const partial = (mdRes, pdfRes) => fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT + '?m=' + (url.includes('format=md') ? 'md' : 'pdf')) : url.includes('m=md') ? mdRes() : pdfRes());
  const dir3 = newDir();
  r = await fetchIt(link, partial(() => resp(200, MD, { 'content-type': 'text/x-markdown', 'content-disposition': cdStar('提案.md') }), () => resp(404, 'x')), { destDir: dir3 });
  ok('部分成功：md 成功 pdf 失敗 → 仍成功，只回 md', r.ok && r.files.length === 1 && r.files[0].role === 'text' && r.files[0].name === '提案.md' && same(fs.readdirSync(dir3), ['提案.md']), r);
  r = await fetchIt(link, partial(() => resp(200, '<html>', { 'content-type': 'text/html' }), () => resp(200, PDF, { 'content-type': 'application/pdf', 'content-disposition': cdStar('提案.pdf') })));
  ok('部分成功：md 失敗 pdf 成功 → 成功，只回 pdf', r.ok && r.files.length === 1 && r.files[0].role === 'original' && r.title === '提案', r);
  r = await fetchIt(link, partial(() => resp(404, 'x'), () => resp(200, '<html>', { 'content-type': 'text/html' })));
  ok('全部失敗：回報最先遇到的原因（not-found，非 not-shared）', r.ok === false && r.reason === 'not-found', r);
}

/* ---------- 五：路徑安全 ---------- */
{
  for (const evil of ['..\\..\\evil', '../../evil', 'a/b\\c', '..', '.', 'CON', 'nul', '預算/..\\..\\x', ' . ', 'x'.repeat(300)]) {
    const dir = path.join(newDir(), 'inner');
    const mk = fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, XLSX, { 'content-type': 'application/octet-stream', 'content-disposition': cdStar(evil + '.xlsx') }));
    const r = await fetchIt(parseGoogleLink(SHEET), mk, { destDir: dir });
    const escaped = fs.readdirSync(path.dirname(dir)).filter(f => f !== 'inner');
    ok('路徑安全：title=' + JSON.stringify(evil.slice(0, 20)), r.ok && r.files.every(f => inside(dir, f) && f.name.length <= 80 && !/[\\/]/.test(f.name) && !/^(?:con|nul)\./i.test(f.name) && !f.name.startsWith('.')) && escaped.length === 0 && fs.readdirSync(dir).length === 1, { r, escaped });
  }
}

/* ---------- 五之二：Unicode 格式字元與 resourcekey ---------- */
{
  // 檔名含 U+202E（文字方向反轉）、U+200B（零寬空格）：顯示名與存檔名都要去除
  const dir = newDir();
  const evilName = '預算\u202E表\u200B2026';
  const mk = fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, XLSX, { 'content-type': 'application/octet-stream', 'content-disposition': cdStar(evilName + '.xlsx') }));
  const r = await fetchIt(parseGoogleLink(SHEET), mk, { destDir: dir });
  ok('格式字元：顯示名去掉 U+202E／U+200B', r.ok && r.title === '預算表2026' && !/\p{Cf}/u.test(r.title), r.title);
  ok('格式字元：存檔名同樣沒有格式字元', r.ok && r.files[0].name === '預算表2026.xlsx' && !/\p{Cf}/u.test(r.files[0].name) && same(fs.readdirSync(dir), ['預算表2026.xlsx']), r.files);
  const rl = await fetchIt(parseGoogleLink(SHEET), fake((url, init, u) => u.hostname === 'docs.google.com' ? redirect(CONTENT) : resp(200, XLSX, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${Buffer.from('a\u202Eb.xlsx', 'utf8').toString('latin1')}"` })), { destDir: newDir() });
  ok('格式字元：普通 filename 內的 U+202E 亦去除', rl.ok && rl.title === 'ab', rl.title);

  // resourcekey：保留合規值，其他查詢參數丟棄；非法值丟棄
  const KEY = '0-AbC_dEf-123';
  const withKey = seg => `https://docs.google.com/${seg}/d/${ID}/edit?usp=sharing&resourcekey=${KEY}&foo=bar#gid=1`;
  for (const [seg, kind] of [['document', 'doc'], ['spreadsheets', 'sheet'], ['presentation', 'slides']]) {
    const link = parseGoogleLink(withKey(seg));
    ok('resourcekey：' + kind + ' 解析保留金鑰、標準網址帶金鑰、丟棄其他參數', link && link.kind === kind && link.resourceKey === KEY && link.url === `https://docs.google.com/${seg}/d/${ID}/edit?resourcekey=${KEY}`, link);
    requests.length = 0;
    const r = await fetchIt(link, goodGoogle());
    const docs = requests.filter(q => q.host === 'docs.google.com');
    ok('resourcekey：' + kind + ' 匯出請求全部帶上該參數', r.ok && r.url === link.url && docs.length >= 1 && docs.every(q => new URL(q.url).searchParams.get('resourcekey') === KEY && !q.url.includes('foo=') && !q.url.includes('usp=')), docs.map(q => q.url));
  }
  requests.length = 0;
  await fetchIt(parseGoogleLink(withKey('document')), goodGoogle());
  ok('resourcekey：doc 匯出網址形狀正確', requests.some(q => q.url === `https://docs.google.com/document/d/${ID}/export?format=md&resourcekey=${KEY}`));
  requests.length = 0;
  await fetchIt(parseGoogleLink(withKey('presentation')), goodGoogle());
  ok('resourcekey：slides 匯出網址形狀正確', requests.some(q => q.url === `https://docs.google.com/presentation/d/${ID}/export/pdf?resourcekey=${KEY}`) && requests.some(q => q.url === `https://docs.google.com/presentation/d/${ID}/export/txt?resourcekey=${KEY}`));
  for (const bad of ['a b', 'x&y=1', 'x%26y', 'k/../z', 'k;z', '<s>', '', 'x'.repeat(101)]) {
    const link = parseGoogleLink(`https://docs.google.com/document/d/${ID}/edit?resourcekey=${encodeURIComponent(bad)}`);
    ok('resourcekey：非法值丟棄 ' + JSON.stringify(bad.slice(0, 12)), link && link.resourceKey === '' && link.url === DOC, link);
  }
  const noKey = parseGoogleLink(DOC);
  ok('resourcekey：沒有金鑰時 resourceKey 為空字串，匯出網址不帶參數', noKey.resourceKey === '');
  requests.length = 0;
  await fetchIt(noKey, goodGoogle());
  ok('resourcekey：沒有金鑰的請求不含 resourcekey', requests.length > 0 && requests.every(q => !q.url.includes('resourcekey')));
  // 傳進 fetchGoogleLink 的 link 物件不被信任：手造的非法金鑰不會進入請求
  requests.length = 0;
  const forged = await fetchIt({ kind: 'doc', id: ID, resourceKey: 'x&evil=1', url: DOC }, goodGoogle());
  ok('resourcekey：手造的非法金鑰在取回時被丟棄', forged.ok && requests.every(q => !q.url.includes('evil') && !q.url.includes('resourcekey')), requests.map(q => q.url));
  ok('resourcekey：findGoogleLinks 同樣保留金鑰', findGoogleLinks(`看 ${withKey('spreadsheets')}。`)[0]?.resourceKey === KEY);
}

/* ---------- 六：全局斷言 ---------- */
ok('零外網：所有請求主機名只可能是 docs.google.com／accounts.google.com／*.googleusercontent.com（及測試用的假惡意網域，且從未被請求）', allRequests.length > 20 && allRequests.every(q => ALLOWED_HOSTS(q.host) && !['evilgoogleusercontent.com', 'googleusercontent.com.evil.com', 'evil.com'].includes(q.host)) && allRequests.every(q => ['docs.google.com', 'accounts.google.com'].includes(q.host) || q.host.endsWith('.googleusercontent.com')), { n: allRequests.length, hosts: [...new Set(allRequests.map(q => q.host))] });
ok('整個測試 30 秒內完成', Date.now() - t0 < 30000, Date.now() - t0 + 'ms');

assertTestOut(tmpRoot); fs.rmSync(tmpRoot, { recursive: true, force: true });
const failed = results.filter(r => !r.pass);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通過' + (failed.length ? '，失敗：' + failed.map(f => f.name).join('；') : ''));
process.exit(failed.length ? 1 : 0);
