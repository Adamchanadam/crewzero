// R2 手機配對：只用本機 HTTP 與測試資料。測一次性秘密、待接受 403、接受／撤銷、到期與每來源速率限制。
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { seedCompany, usePass, passCookie } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const results = []; const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data'), BASE = `http://127.0.0.1:${PORT}`;
seedCompany(DATA, PROTO);
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
async function post(url, body, headers) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { r, j }; }
try {
  await usePass(BASE);
  const browserHeaders = { Origin: BASE, Cookie: passCookie(BASE) };
  const opened = await post(BASE + '/api/setup', { action: 'phone-open' }, browserHeaders);
  const pairUrl = opened.j && opened.j.pairUrl;
  if (!opened.r.ok || !/^http:\/\/10\.|^http:\/\/192\.168\.|^http:\/\/172\./.test(pairUrl || '')) {
    ok('找不到私人 IPv4 時，手機配對測試標為未適用而不會綁 0.0.0.0', opened.r.status === 409, { status: opened.r.status, error: opened.j && opened.j.error });
  } else {
    const pairBase = new URL(pairUrl).origin, secret = pairUrl.slice(pairUrl.indexOf('#') + 1);
    const reopened = await post(BASE + '/api/setup', { action: 'phone-open' }, browserHeaders);
    ok('重新開啟同一個未用配對碼：保留原秘密與原到期時間', reopened.r.status === 200 && reopened.j.pairUrl === pairUrl && reopened.j.expiresAt === opened.j.expiresAt, { first: opened.j.expiresAt, next: reopened.j.expiresAt });
    const qrSandbox = { globalThis: {} };
    vm.runInNewContext(fs.readFileSync(path.join(PROTO, 'pair.js'), 'utf8'), qrSandbox);
    const longest = 'http://192.168.100.100:65535/pair#' + 'a'.repeat(64);
    let longQr = '', tooLongRejected = false; try { longQr = qrSandbox.globalThis.SOS_PAIR.qr(longest); } catch { } try { qrSandbox.globalThis.SOS_PAIR.qr('a'.repeat(107)); } catch { tooLongRejected = true; }
    ok('最長合法私人 IPv4、五位埠及 64 字元秘密符合 QR 位元組容量，並拒絕超出容量', longest.length === 98 && qrSandbox.globalThis.SOS_PAIR.maxBytes === 106 && longest.length <= qrSandbox.globalThis.SOS_PAIR.maxBytes && /<svg/.test(longQr) && tooLongRejected, { bytes: longest.length, capacity: qrSandbox.globalThis.SOS_PAIR.maxBytes });
    const page = await fetch(pairBase + '/pair');
    ok('/pair 只經私人 LAN 監聽提供、頁面不含配對秘密', page.status === 200 && !(await page.text()).includes(secret), page.status);
    const paired = await post(pairBase + '/api/pair', { secret });
    const phoneCookie = paired.r.headers.get('set-cookie') || '';
    const cm = /^(sos_pass_[a-f0-9]{32})=([a-f0-9]{64})/.exec(phoneCookie);
    ok('配對秘密一次性，成功只發 HttpOnly cookie 與四位確認碼', paired.r.status === 200 && !!cm && /^\d{4}$/.test(String(paired.j.code || '')) && !JSON.stringify(paired.j).includes(secret), { status: paired.r.status, code: paired.j && paired.j.code });
    const pending = cm && await fetch(pairBase + '/api/status', { headers: { Cookie: cm[1] + '=' + cm[2] } });
    ok('待接受手機讀資料一律 403 pending', pending && pending.status === 403 && (await pending.json()).error === 'pending');
    const list = await (await fetch(BASE + '/api/setup', { headers: { Cookie: passCookie(BASE) } })).json();
    const device = list.devices.find(x => x.kind === 'phone' && x.state === 'pending');
    ok('電腦見到待接受手機及相同四位確認碼', !!device && device.confirmationCode === paired.j.code, device && { id: device.id, code: device.confirmationCode });
    const accepted = await post(BASE + '/api/setup', { action: 'phone-accept', id: device && device.id }, browserHeaders);
    ok('只有已配對本機瀏覽器可接受手機', accepted.r.status === 200);
    ok('接受後手機可以讀資料', cm && (await fetch(pairBase + '/api/status', { headers: { Cookie: cm[1] + '=' + cm[2] } })).status === 200);
    const phoneHeaders = { Origin: pairBase, Cookie: cm && cm[1] + '=' + cm[2] };
    const localWithPhone = await post(BASE + '/api/setup', { action: 'phone-open' }, { Origin: BASE, Cookie: phoneHeaders.Cookie });
    const localWithLanOrigin = await post(BASE + '/api/setup', { action: 'phone-open' }, { Origin: pairBase, Cookie: passCookie(BASE) });
    ok('手機通行證不能在回環端取得本機管理權，LAN Origin 亦不能操作回環端', localWithPhone.r.status === 403 && localWithLanOrigin.r.status === 403, { phone: localWithPhone.r.status, lanOrigin: localWithLanOrigin.r.status });
    const replies = path.join(DATA, 'founder', 'replies'), beforeReplies = fs.readdirSync(replies).filter(f => f.endsWith('.md')).length;
    const sensitiveText = 'kind: proofread\nref: intake-2026-10-26\n\n```json\n' + JSON.stringify({ edits: [{ id: 'permissions', value: '任意擴大權限' }, { id: 'rhythm', value: '每小時一次' }] }) + '\n```\n';
    const sensitive = await post(pairBase + '/api/submit', { kind: 'proofread', ref: 'intake-2026-10-26', text: sensitiveText }, phoneHeaders);
    ok('手機不能經一般回覆改寫權限或經營節奏，帳本前不會收件', sensitive.r.status === 403 && fs.readdirSync(replies).filter(f => f.endsWith('.md')).length === beforeReplies, sensitive.r.status);
    const confirmed = path.join(DATA, 'ledger', 'confirmed.json'), beforeConfirmed = fs.existsSync(confirmed) ? fs.readFileSync(confirmed, 'utf8') : '';
    const doubleFence = 'kind: proofread\nref: intake-2026-10-26\n\n```JSON\n{"edits":[]}\n```\n\n```json\n' + JSON.stringify({ edits: [{ id: 'permissions', value: 'SYNTHETIC-permission-change' }, { id: 'rhythm', value: 'SYNTHETIC-rhythm-change' }] }) + '\n```\n';
    const doubleFenceResult = await post(pairBase + '/api/submit', { kind: 'proofread', ref: 'intake-2026-10-26', text: doubleFence }, phoneHeaders);
    const refMismatch = 'kind: proofread\nref: synthetic-sensitive-pack\n\n```json\n' + JSON.stringify({ edits: [{ id: 'permissions', value: 'SYNTHETIC-ref-change' }] }) + '\n```\n';
    const refMismatchResult = await post(pairBase + '/api/submit', { kind: 'proofread', ref: 'intake-2026-10-26', text: refMismatch }, phoneHeaders);
    ok('大小寫雙 JSON 區塊及 body／標頭 ref 不一致均被入口拒絕，帳本讀回未變', doubleFenceResult.r.status === 400 && refMismatchResult.r.status === 400 && fs.readdirSync(replies).filter(f => f.endsWith('.md')).length === beforeReplies && (fs.existsSync(confirmed) ? fs.readFileSync(confirmed, 'utf8') : '') === beforeConfirmed, { doubleFence: doubleFenceResult.r.status, refMismatch: refMismatchResult.r.status });
    const viaText = 'kind: proofread\nVIA: browser:aaaaaa\nvIa: browser:bbbbbb\nref: intake-2026-10-26\n\n```json\n' + JSON.stringify({ edits: [{ id: 'permissions', value: '用預設' }] }) + '\n```\n';
    const viaSent = await post(pairBase + '/api/submit', { kind: 'proofread', ref: 'intake-2026-10-26', text: viaText }, phoneHeaders);
    const normalText = 'kind: proofread\nref: intake-2026-10-26\n\n```json\n' + JSON.stringify({ edits: [{ id: 'permissions', value: '用預設' }] }) + '\n```\n';
    const normalSent = await post(pairBase + '/api/submit', { kind: 'proofread', ref: 'intake-2026-10-26', text: normalText }, phoneHeaders);
    const saved = fs.readdirSync(replies).filter(f => f.endsWith('.md')).sort().at(-1), savedText = saved ? fs.readFileSync(path.join(replies, saved), 'utf8') : '';
    const viaLines = savedText.split(/\r?\n/).filter(line => /^via\s*:/i.test(line));
    ok('重複控制欄位被拒；正常回覆只由伺服器寫入唯一手機來源', viaSent.r.status === 400 && normalSent.r.status === 200 && viaLines.length === 1 && /^via: device:[a-f0-9]{8}$/i.test(viaLines[0] || ''), { duplicate: viaSent.r.status, normal: normalSent.r.status, viaLines });
    const again = await post(pairBase + '/api/pair', { secret });
    ok('同一秘密不能第二次使用', again.r.status === 403);
    const partial = net.createConnection({ host: new URL(pairBase).hostname, port: Number(new URL(pairBase).port) });
    await new Promise((resolve, reject) => { partial.once('connect', resolve); partial.once('error', reject); });
    partial.write('POST /api/pair HTTP/1.1\r\nHost: ' + new URL(pairBase).host + '\r\nContent-Type: application/json\r\nContent-Length: 1024\r\n\r\n{"secret":"');
    const delayed = net.createConnection({ host: new URL(pairBase).hostname, port: Number(new URL(pairBase).port) });
    await new Promise((resolve, reject) => { delayed.once('connect', resolve); delayed.once('error', reject); });
    const delayedPayload = JSON.stringify({ kind: 'proofread', ref: 'intake-2026-10-26', text: normalText });
    const delayedReply = new Promise(resolve => { let text = ''; delayed.on('data', x => { text += x; }); delayed.on('close', () => resolve(text)); setTimeout(() => resolve(text), 2500); });
    delayed.write('POST /api/submit HTTP/1.1\r\nHost: ' + new URL(pairBase).host + '\r\nOrigin: ' + pairBase + '\r\nCookie: ' + phoneHeaders.Cookie + '\r\nContent-Type: application/json\r\nContent-Length: ' + Buffer.byteLength(delayedPayload) + '\r\n\r\n' + delayedPayload.slice(0, -1));
    const beforeRevokeReplies = fs.readdirSync(replies).filter(f => f.endsWith('.md')).length, beforeRevokeConfirmed = fs.existsSync(confirmed) ? fs.readFileSync(confirmed, 'utf8') : '';
    const closeAt = Date.now();
    const closing = post(BASE + '/api/setup', { action: 'phone-close' }, browserHeaders);
    await sleep(60); delayed.write(delayedPayload.slice(-1)); delayed.end();
    const closedActive = await closing;
    const delayedText = await delayedReply;
    const afterClose = await fetch(BASE + '/api/status', { headers: { Cookie: phoneHeaders.Cookie } });
    try { partial.destroy(); } catch { }
    try { delayed.destroy(); } catch { }
    const postClosePasses = JSON.parse(fs.readFileSync(path.join(DATA, 'founder', 'desk', 'passes.json'), 'utf8')).passes;
    ok('撤銷期間補完的手機提交會被拒絕，帳本讀回未變', /HTTP\/1\.1 403/.test(delayedText) && fs.readdirSync(replies).filter(f => f.endsWith('.md')).length === beforeRevokeReplies && (fs.existsSync(confirmed) ? fs.readFileSync(confirmed, 'utf8') : '') === beforeRevokeConfirmed, { response: delayedText.slice(0, 40), replies: beforeRevokeReplies });
    ok('未完成 LAN 請求不會拖延關閉：先撤銷手機通行證，再有界關閉連線', closedActive.r.status === 200 && Date.now() - closeAt < 1600 && afterClose.status === 403 && !postClosePasses.some(x => x.kind === 'phone'), { ms: Date.now() - closeAt, status: afterClose.status });
    const expiryOpen = await post(BASE + '/api/setup', { action: 'phone-open' }, browserHeaders), expiryUrl = expiryOpen.j.pairUrl, expiryBase = new URL(expiryUrl).origin;
    const expiryPair = await post(expiryBase + '/api/pair', { secret: expiryUrl.slice(expiryUrl.indexOf('#') + 1) });
    const expiryCookie = /^(sos_pass_[a-f0-9]{32})=([a-f0-9]{64})/.exec(expiryPair.r.headers.get('set-cookie') || '');
    const passFile = path.join(DATA, 'founder', 'desk', 'passes.json'), expPasses = JSON.parse(fs.readFileSync(passFile, 'utf8'));
    expPasses.passes.filter(x => x.kind === 'phone' && x.state === 'pending').forEach(x => { x.pendingExpiresAt = new Date(Date.now() - 1000).toISOString(); }); fs.writeFileSync(passFile, JSON.stringify(expPasses));
    ok('待接受手機逾時後失效', expiryCookie && (await fetch(expiryBase + '/api/status', { headers: { Cookie: expiryCookie[1] + '=' + expiryCookie[2] } })).status === 403, { open: expiryOpen.r.status, openJ: expiryOpen.j && expiryOpen.j.error, pair: expiryPair.r.status, pairJ: expiryPair.j });
    const reset = await post(BASE + '/api/setup', { action: 'phone-open' }, browserHeaders), newUrl = new URL(reset.j.pairUrl).origin;
    let sixth = null; for (let i = 0; i < 6; i++) sixth = await post(newUrl + '/api/pair', { secret: 'f'.repeat(64) });
    ok('每個來源五分鐘最多五次配對嘗試', sixth.r.status === 429, sixth.r.status);
    const closed = await post(BASE + '/api/setup', { action: 'phone-close' }, browserHeaders);
    const passes = JSON.parse(fs.readFileSync(path.join(DATA, 'founder', 'desk', 'passes.json'), 'utf8')).passes;
    ok('關閉手機模式會關閉 LAN 監聽並作廢所有手機通行證', closed.r.status === 200 && !passes.some(x => x.kind === 'phone'), passes.map(x => x.kind));
    const reopenedAfterClose = await post(BASE + '/api/setup', { action: 'phone-open' }, browserHeaders);
    const closedAgain = await post(BASE + '/api/setup', { action: 'phone-close' }, browserHeaders);
    ok('關閉後可重新開啟手機配對，並產生新的配對網址', reopenedAfterClose.r.status === 200 && !!reopenedAfterClose.j.pairUrl && reopenedAfterClose.j.pairUrl !== reset.j.pairUrl && closedAgain.r.status === 200, { before: reset.j.pairUrl, after: reopenedAfterClose.j.pairUrl, closedAgain: closedAgain.r.status });
  }
} catch (e) { ok('測試程式出錯', false, String(e?.stack || e)); }
try { srv.kill(); } catch { } await sleep(300);
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info ?? null).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
