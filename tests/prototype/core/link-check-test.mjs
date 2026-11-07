// link-check.mjs 測試：全部使用假 fetch 及假 DNS 查詢，不連外網。結束碼 0＝全過。
import { checkLink, checkLinks, isBlockedAddress } from '../../../prototypes/proofread/link-check.mjs';

const watchdog = setTimeout(() => { console.error('測試超過 10 秒'); process.exit(2); }, 10000);
watchdog.unref();

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; } else { fail++; console.error('失敗：' + name); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 假 fetch／假 lookup ----------
const mkRes = (status, headers = {}) => ({ status, headers: { get: k => headers[String(k).toLowerCase()] ?? null }, body: { cancel: async () => { } } });
const mkFetch = handler => {
  const calls = [];
  const f = async (href, init) => { calls.push({ href, method: init && init.method, init }); return handler(href, init, calls.length, calls); };
  f.calls = calls;
  return f;
};
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const mkLookup = (map = {}) => {
  const calls = [];
  const f = async (host, o) => {
    calls.push({ host, o });
    const v = map[host];
    if (v === 'ENOTFOUND') throw Object.assign(new Error('getaddrinfo ENOTFOUND ' + host), { code: 'ENOTFOUND' });
    if (v === 'EAI_AGAIN') throw Object.assign(new Error('temporary'), { code: 'EAI_AGAIN' });
    return v || PUBLIC;
  };
  f.calls = calls;
  return f;
};
const A = (...addr) => addr.map(a => ({ address: a, family: a.includes(':') ? 6 : 4 }));
const never = () => new Promise(() => { });

const run = async (url, handler, extra = {}) => {
  const fetchImpl = mkFetch(handler);
  const lookup = extra.lookup || mkLookup();
  const r = await checkLink(url, { fetchImpl, lookup, ...extra });
  return { r, fetchImpl, lookup };
};

// ---------- 基本判定 ----------
{
  const { r, fetchImpl } = await run('https://www.example.gov.hk/a', () => mkRes(200));
  ok(r.state === 'ok' && r.code === 200 && r.url === 'https://www.example.gov.hk/a', '200 ok');
  ok(fetchImpl.calls.length === 1 && fetchImpl.calls[0].method === 'HEAD', '只發一次 HEAD');
  const init = fetchImpl.calls[0].init;
  ok(init.redirect === 'manual' && init.credentials === 'omit' && init.headers['User-Agent'] === 'CrewZero', '手動轉址、不帶 cookie、UA');
  ok(!Object.keys(init.headers).some(k => /cookie|authorization/i.test(k)), '不帶 cookie／登入標頭');
}
{
  const { r } = await run('https://example.gov.hk/gone', () => mkRes(404));
  ok(r.state === 'broken' && r.code === 404, '404 broken');
}
{
  const { r } = await run('https://example.gov.hk/gone', () => mkRes(410));
  ok(r.state === 'broken' && r.code === 410, '410 broken');
}
{
  const { r } = await run('https://example.gov.hk/', () => mkRes(304));
  ok(r.state === 'ok', '304 ok');
}
for (const st of [401, 429, 500, 502, 503, 400, 451]) {
  const { r } = await run('https://example.gov.hk/', () => mkRes(st));
  ok(r.state === 'unknown' && r.code === st, st + ' unknown');
}

// ---------- HEAD 失敗改 GET ----------
{
  const { r, fetchImpl } = await run('https://example.com/p', (h, init) => (init.method === 'HEAD' ? mkRes(405) : mkRes(200)));
  ok(r.state === 'ok' && fetchImpl.calls.map(c => c.method).join() === 'HEAD,GET', 'HEAD 405 → GET 200 ok');
}
{
  const { r, fetchImpl } = await run('https://example.com/p', (h, init) => (init.method === 'HEAD' ? mkRes(501) : mkRes(200)));
  ok(r.state === 'ok' && fetchImpl.calls.length === 2, 'HEAD 501 → GET');
}
{
  const { r, fetchImpl } = await run('https://example.com/p', (h, init) => mkRes(403));
  ok(r.state === 'unknown' && r.code === 403 && fetchImpl.calls.map(c => c.method).join() === 'HEAD,GET', 'HEAD 403 → GET 403 unknown');
}
{
  const { r, fetchImpl } = await run('https://example.com/p', (h, init) => (init.method === 'HEAD' ? mkRes(403) : mkRes(404)));
  ok(r.state === 'broken' && fetchImpl.calls.length === 2, 'HEAD 403 → GET 404 broken');
}
{
  const { r, fetchImpl } = await run('https://example.com/p', (h, init) => { if (init.method === 'HEAD') throw new TypeError('fetch failed'); return mkRes(200); });
  ok(r.state === 'ok' && fetchImpl.calls.length === 2, 'HEAD 網絡錯誤 → GET 200 ok');
}
{
  const { r, fetchImpl } = await run('https://example.com/p', () => { throw new TypeError('fetch failed'); });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 2, 'HEAD 與 GET 都網絡錯誤 unknown');
}
{
  const { r } = await run('https://example.com/p', () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } }); });
  ok(r.state === 'unknown' && r.reason === 'tls', 'TLS 錯誤 unknown');
}

// ---------- 轉址 ----------
{
  const { r, fetchImpl } = await run('https://example.com/old', (h) => (h.endsWith('/old') ? mkRes(301, { location: '/new' }) : mkRes(200)));
  ok(r.state === 'ok' && fetchImpl.calls.length === 2 && fetchImpl.calls[1].href === 'https://example.com/new', '301 → 200 ok（相對位置）');
}
{
  const { r, fetchImpl } = await run('https://example.com/old', () => mkRes(302, { location: 'http://example.com/plain' }));
  ok(r.state === 'unknown' && fetchImpl.calls.length === 1, '301 → http 不跟從');
}
{
  const lookup = mkLookup({ 'intranet.example.com': A('10.0.0.9') });
  const { r, fetchImpl } = await run('https://example.com/old', () => mkRes(302, { location: 'https://intranet.example.com/x' }), { lookup });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 1, '轉址到解析為私人位址的主機不請求');
}
for (const loc of ['https://192.168.1.1/', 'https://169.254.169.254/latest', 'https://localhost/', 'https://[::1]/', 'https://printer.local/', 'https://u:p@example.com/']) {
  const { r, fetchImpl } = await run('https://example.com/old', () => mkRes(307, { location: loc }));
  ok(r.state === 'unknown' && fetchImpl.calls.length === 1, '轉址到 ' + loc + ' 不請求');
}
{
  // 剛好 3 次轉址再 200：可
  const { r, fetchImpl } = await run('https://example.com/0', (h) => { const n = Number(h.split('/').pop()); return n < 3 ? mkRes(302, { location: '/' + (n + 1) }) : mkRes(200); });
  ok(r.state === 'ok' && fetchImpl.calls.length === 4, '3 次轉址後 200 ok');
}
{
  // 第 4 次轉址：不再跟從
  const { r, fetchImpl } = await run('https://example.com/0', (h) => { const n = Number(h.split('/').pop()); return mkRes(302, { location: '/' + (n + 1) }); });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 4, '超過 3 次轉址 unknown');
}
{
  const { r } = await run('https://example.com/0', () => mkRes(302));
  ok(r.state === 'unknown', '轉址沒有 location unknown');
}
{
  // 轉址後那一跳 HEAD 405 → GET
  const { r, fetchImpl } = await run('https://example.com/a', (h, init) => (h.endsWith('/a') ? mkRes(301, { location: '/b' }) : init.method === 'HEAD' ? mkRes(405) : mkRes(200)));
  ok(r.state === 'ok' && fetchImpl.calls.map(c => c.method).join() === 'HEAD,HEAD,GET', '轉址後逐跳 HEAD→GET');
}
{
  // 轉址後的主機查無此主機
  const lookup = mkLookup({ 'dead.example.org': 'ENOTFOUND' });
  const { r } = await run('https://example.com/a', () => mkRes(301, { location: 'https://dead.example.org/' }), { lookup });
  ok(r.state === 'broken', '轉址到查無此主機 broken');
}

// ---------- DNS ----------
{
  const lookup = mkLookup({ 'nope.example.gov': 'ENOTFOUND' });
  const { r, fetchImpl } = await run('https://nope.example.gov/', () => mkRes(200), { lookup });
  ok(r.state === 'broken' && fetchImpl.calls.length === 0, 'ENOTFOUND broken、不發請求');
  ok(lookup.calls[0].o && lookup.calls[0].o.all === true, 'lookup 以 all:true 呼叫');
}
{
  const lookup = mkLookup({ 'slow.example.gov': 'EAI_AGAIN' });
  const { r, fetchImpl } = await run('https://slow.example.gov/', () => mkRes(200), { lookup });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 0, '其他 DNS 錯誤 unknown');
}
{
  const { r } = await run('https://example.com/', () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  ok(r.state === 'broken', 'fetch 回報 ENOTFOUND（cause）broken');
}

// ---------- 逾時 ----------
{
  const t0 = Date.now();
  const { r } = await run('https://example.com/', never, { timeoutMs: 100 });
  const dt = Date.now() - t0;
  ok(r.state === 'unknown' && r.reason === 'timeout' && dt < 600, '請求逾時 unknown 且準時返回（' + dt + 'ms）');
}
{
  const t0 = Date.now();
  const lookup = async () => never();
  const { r, fetchImpl } = await run('https://example.com/', () => mkRes(200), { timeoutMs: 100, lookup });
  ok(r.state === 'unknown' && r.reason === 'timeout' && Date.now() - t0 < 600 && fetchImpl.calls.length === 0, 'DNS 逾時 unknown');
}
{
  // 時限涵蓋整串轉址
  const t0 = Date.now();
  const { r } = await run('https://example.com/0', (h) => { const n = Number(h.split('/').pop()); return n < 2 ? mkRes(302, { location: '/' + (n + 1) }) : never(); }, { timeoutMs: 100 });
  ok(r.state === 'unknown' && r.reason === 'timeout' && Date.now() - t0 < 600, '轉址途中逾時 unknown');
}

// ---------- 不發請求的網址 ----------
const NOT_SENT = [
  'http://example.com/',
  'ftp://example.com/',
  'javascript:alert(1)',
  'https://user:pw@example.com/',
  'https://user@example.com/',
  'https://127.0.0.1/',
  'https://127.1/',
  'https://10.0.0.1/',
  'https://172.16.5.4/',
  'https://192.168.1.5/',
  'https://169.254.169.254/',
  'https://100.64.0.1/',
  'https://0.0.0.0/',
  'https://2130706433/',
  'https://0x7f.0.0.1/',
  'https://[::1]/',
  'https://[::]/',
  'https://[::ffff:127.0.0.1]/',
  'https://[::ffff:10.1.2.3]/',
  'https://[fe80::1]/',
  'https://[fd00::1]/',
  'https://[64:ff9b::7f00:1]/',
  'https://[2002:7f00:1::]/',
  'https://localhost/',
  'https://localhost./',
  'https://LOCALHOST:8443/x',
  'https://app.localhost/',
  'https://printer.local/',
  'https://metadata.google.internal/',
  'https://nas/',
  'https://router.lan/',
  'not a url',
  '',
];
for (const u of NOT_SENT) {
  const { r, fetchImpl, lookup } = await run(u, () => mkRes(200));
  ok(r.state === 'unknown' && r.reason === 'not-checked' && fetchImpl.calls.length === 0, '不發請求：' + u);
  if (/^https:\/\/[\d.\[]/.test(u)) ok(lookup.calls.length === 0, 'IP 直寫不查 DNS：' + u);
}
{
  const lookup = mkLookup({ 'internal-app.example.com': A('192.168.1.5') });
  const { r, fetchImpl } = await run('https://internal-app.example.com/', () => mkRes(200), { lookup });
  ok(r.state === 'unknown' && r.reason === 'not-checked' && fetchImpl.calls.length === 0, 'DNS 解析到 192.168.1.5 不請求');
}
{
  const lookup = mkLookup({ 'mixed.example.com': A('93.184.216.34', '10.0.0.1') });
  const { r, fetchImpl } = await run('https://mixed.example.com/', () => mkRes(200), { lookup });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 0, 'DNS 結果任何一個私人就不請求');
}
for (const a of ['::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', 'fc00::5']) {
  const lookup = mkLookup({ 'six.example.com': A(a) });
  const { r, fetchImpl } = await run('https://six.example.com/', () => mkRes(200), { lookup });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 0, 'DNS 解析到 ' + a + ' 不請求');
}
{
  const lookup = mkLookup({ 'empty.example.com': [] });
  const { r, fetchImpl } = await run('https://empty.example.com/', () => mkRes(200), { lookup });
  ok(r.state === 'unknown' && fetchImpl.calls.length === 0, 'DNS 無結果 unknown');
}
{
  // 公開位址可正常查：IPv4／IPv6 直寫、解析到公開 IPv6
  const a = await run('https://93.184.216.34/x', () => mkRes(200));
  ok(a.r.state === 'ok' && a.lookup.calls.length === 0, '公開 IPv4 直寫可查');
  const b = await run('https://[2606:4700:4700::1111]/', () => mkRes(200));
  ok(b.r.state === 'ok', '公開 IPv6 直寫可查');
  const lookup = mkLookup({ 'v6.example.com': A('2606:4700:4700::1111', '93.184.216.34', '::ffff:93.184.216.34') });
  const c = await run('https://v6.example.com/', () => mkRes(200), { lookup });
  ok(c.r.state === 'ok', '解析到公開位址（含 IPv4 映射公開位址）可查');
}
ok(isBlockedAddress('10.0.0.1') && isBlockedAddress('::1') && !isBlockedAddress('8.8.8.8') && !isBlockedAddress('2001:4860:4860::8888') && isBlockedAddress('garbage'), 'isBlockedAddress 抽查');

// ---------- 永不拋出例外 ----------
{
  const bad = [await checkLink(undefined), await checkLink(123), await checkLink(null, null), await checkLink('https://example.com/', { fetchImpl: 'x', lookup: mkLookup() })];
  ok(bad.every(r => r && r.state === 'unknown'), '壞輸入都回結果');
  const r = await checkLink('https://example.com/', { fetchImpl: () => { throw new Error('boom'); }, lookup: mkLookup() });
  ok(r.state === 'unknown', 'fetch 同步拋錯也回結果');
  const r2 = await checkLink('https://example.com/', { fetchImpl: mkFetch(() => mkRes(200)), lookup: () => { throw new Error('boom'); } });
  ok(r2.state === 'unknown', 'lookup 同步拋錯也回結果');
  const m = await checkLinks(null);
  ok(m instanceof Map && m.size === 0, 'checkLinks(null) 回空 Map');
}

// ---------- checkLinks ----------
{
  const fetchImpl = mkFetch(() => mkRes(200));
  const m = await checkLinks(['https://a.example.com/', 'https://a.example.com/', 'https://b.example.com/', 'https://a.example.com/'], { fetchImpl, lookup: mkLookup() });
  ok(m instanceof Map && m.size === 2 && fetchImpl.calls.length === 2, 'checkLinks 去重');
  ok(m.get('https://a.example.com/').state === 'ok' && m.get('https://b.example.com/').state === 'ok', 'checkLinks 結果以網址為鍵');
}
{
  const fetchImpl = mkFetch((h) => (h.includes('/dead') ? mkRes(404) : mkRes(200)));
  const m = await checkLinks(['https://a.example.com/dead', 'https://a.example.com/live', 'http://a.example.com/plain'], { fetchImpl, lookup: mkLookup() });
  ok(m.get('https://a.example.com/dead').state === 'broken' && m.get('https://a.example.com/live').state === 'ok' && m.get('http://a.example.com/plain').state === 'unknown', 'checkLinks 混合結果');
  ok([...m.keys()].join() === 'https://a.example.com/dead,https://a.example.com/live,http://a.example.com/plain', 'checkLinks 鍵順序同輸入');
}
{
  const urls = Array.from({ length: 30 }, (_, i) => 'https://site' + i + '.example.com/');
  const fetchImpl = mkFetch(() => mkRes(200));
  const m = await checkLinks(urls, { fetchImpl, lookup: mkLookup() });
  ok(fetchImpl.calls.length === 20, '最多查 20 條（實際 ' + fetchImpl.calls.length + '）');
  ok(m.size === 30 && urls.slice(0, 20).every(u => m.get(u).state === 'ok') && urls.slice(20).every(u => m.get(u).state === 'unknown' && m.get(u).reason === 'over-limit'), '超出 20 條者標 over-limit，不請求');
}
{
  let inflight = 0, peak = 0;
  const fetchImpl = mkFetch(async () => { inflight++; peak = Math.max(peak, inflight); await sleep(30); inflight--; return mkRes(200); });
  const urls = Array.from({ length: 12 }, (_, i) => 'https://c' + i + '.example.com/');
  const m = await checkLinks(urls, { fetchImpl, lookup: mkLookup() });
  ok(peak === 4 && fetchImpl.calls.length === 12 && m.size === 12, '並行上限 4（最高同時 ' + peak + '）');
}
{
  const t0 = Date.now();
  const urls = Array.from({ length: 10 }, (_, i) => 'https://t' + i + '.example.com/');
  const fetchImpl = mkFetch(never);
  const m = await checkLinks(urls, { fetchImpl, lookup: mkLookup(), totalMs: 150, timeoutMs: 5000 });
  const dt = Date.now() - t0;
  ok(dt < 700, '總時限內返回（' + dt + 'ms）');
  ok(m.size === 10 && urls.every(u => m.get(u).state === 'unknown' && m.get(u).reason === 'timeout'), '總時限到了全部 unknown／timeout');
  ok(fetchImpl.calls.length <= 4, '總時限到了不再開始新請求（實際 ' + fetchImpl.calls.length + '）');
}
{
  // 總時限比單條時限短時，已完成的結果仍保留
  const fetchImpl = mkFetch((h) => (h.includes('hang') ? never() : mkRes(404)));
  const m = await checkLinks(['https://x.example.com/fast', 'https://x.example.com/hang'], { fetchImpl, lookup: mkLookup(), totalMs: 120 });
  ok(m.get('https://x.example.com/fast').state === 'broken' && m.get('https://x.example.com/hang').reason === 'timeout', '總時限只影響未完成者');
}

clearTimeout(watchdog);
console.log('link-check-test：通過 ' + pass + '，失敗 ' + fail);
console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail ? 1 : 0);
