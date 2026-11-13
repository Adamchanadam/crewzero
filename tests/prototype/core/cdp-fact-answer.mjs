// 資訊模型第一期：開關打開時用真作答頁作答（驗收 A 阻擋項：網頁作答不可因已收起的題被拒），以及「已代你收起」取回。
// 情境：開關關閉時交出兩件事——舊一件有 H1、H2 兩題，新一件只有 H1；打開開關後日常工作收起舊一件的 H1。
// 之後開作答頁答舊一件餘下的 H2：作答頁只見 H2，送出後外殼接受並套用。最後在待決事項按「取回」，H1 回到作答頁。
// 用法：node cdp-fact-answer.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter（不使用，自行產生）> <port>
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { writeAdapters } from '../lib/adapters.mjs';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, usePass } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO_ARG, , PORT_ARG] = process.argv.slice(2);
const PROTO = path.resolve(PROTO_ARG), PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; }

freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const adapters = writeAdapters(path.join(OUT, 'adapters'));
const fake = read(adapters.fake); fake.args = [path.join(HERE, '..', 'lib', 'fake-ai.mjs')];
const ADAPTER = path.join(OUT, 'adapters', 'fact-answer-fake.json'); fs.writeFileSync(ADAPTER, JSON.stringify(fake, null, 2));
const DATA = path.join(OUT, 'world', 'data');
fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
oldInstall(DATA, PROTO);
const env = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', SOS_FACT_MERGE: '0' };
const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 120000 });
shell('--type', 'rhythm', '--trigger', 'manual');
for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(DATA, d))) fs.rmSync(path.join(DATA, d, f), { force: true }); } catch { } }
await certifyDirect(DATA, PROTO, ADAPTER);
const stateFile = path.join(DATA, 'ledger', 'state.json'), state = () => read(stateFile);
{ const s = state(); s.company = s.company || {}; s.company.actors = [{ id: 'pc-1', name: '陳經理', kind: 'partner', role: '採購' }]; s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' }; s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' }; fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); }
process.env.SOS_DATA = DATA;
const DIR = lib.dataDirs(PROTO);
let rs = 0;
const A = (id, grade, why) => ({ kind: 'assumption', id, grade, why });
function submit(ref, date, said, items) {
  fs.writeFileSync(path.join(DATA, 'replay-event.json'), JSON.stringify({ summary: '取回測試第 ' + (++rs) + ' 件。', grade: 'said', read: { summary: 'Zero 讀了創辦人原話。', highlights: [] }, contrasts: [], items }, null, 2));
  fs.mkdirSync(DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(DIR.inbox, `${ref}-note-event.md`), `kind: note\ntype: event\nat: ${lib.localIso()}\n\n${said}\n\n\`\`\`json\n${JSON.stringify({ date })}\n\`\`\`\n`);
  shell();
  const input = (state().inputs || []).find(x => x.id === 'in-' + ref);
  return input && input.packId;
}
const packOf = id => read(path.join(DIR.asks, id + '.json'));
const assumption = id => ((state().company || {}).assumptions || []).find(a => a.id === id) || {};
const qAbout = (pack, id) => (pack.questions || []).find(q => (q.options || []).some(o => o.apply && o.apply.op === 'setAssumptionGrade' && o.apply.id === id));

let server, chrome;
try {
  const p1 = submit('R20261103-100000-fa-1', '2026-11-03', '陳經理表示有興趣，並已安排試用。', [A('H1', 'said', '對方口頭表示有興趣。'), A('H2', 'did', '對方已安排試用。')]);
  const p2 = submit('R20261110-100000-fa-2', '2026-11-10', '陳經理已付首批試用費用。', [A('H1', 'paid', '對方已付款。')]);
  env.SOS_FACT_MERGE = '1';
  shell('--type', 'rhythm', '--trigger', 'manual');
  const pk1 = p1 && packOf(p1), h1 = pk1 && qAbout(pk1, 'H1'), h2 = pk1 && qAbout(pk1, 'H2');
  ok('FA-0 場景：舊一件的 H1 已收起、H2 仍開放；新一件有 H1', !!p2 && !!h1 && !!h1.closed && !!h2 && !h2.closed, { p1, p2, h1: h1 && h1.closed, h2: !!h2 });
  const h2Before = assumption('H2').grade;

  server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...env }, stdio: 'ignore', windowsHide: true });
  await waitFor(async () => (await fetch(BASE + '/api/status')).ok);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  const ev = e => chrome.ev(e);
  await chrome.go(BASE + '/#/ask/' + p1, 1440, 1000);
  await waitFor(() => ev(`document.querySelectorAll('.dq').length>0`));
  const cards = await ev(`[...document.querySelectorAll('.dq')].map(c=>c.innerText.slice(0,60))`);
  const appText = await ev("(document.getElementById('app')||document.body).innerText.slice(0,1500)"), ids = await ev("[...document.querySelectorAll('[id]')].map(e=>e.id).filter(Boolean).slice(0,80).join(',')");
  ok('FA-1 作答頁只見未收起的 H2（已收起的 H1 不出現）', Array.isArray(cards) && cards.length === 1, { cards, errors: chrome.errors, api: await ev("fetch('/api/ask?id=" + p1 + "').then(r=>r.status+' '+r.statusText).catch(e=>String(e))"), api2: await ev("fetch('/api/asks').then(r=>r.status+'').catch(e=>String(e))"), api3: await ev("fetch('/api/home').then(r=>r.status+'').catch(e=>String(e))") });
  await chrome.click('.dq .opt'); await sleep(300); // 必答題：先揀第一個選項（Zero 建議）
  await chrome.click('#go-main'); await sleep(500);
  await chrome.click('#do-confirm');
  const applied = await waitFor(() => assumption('H2').grade === 'did' ? true : null, 60000);
  const runs = (() => { try { return read(path.join(DIR.ledger, 'status.json')).runs || []; } catch { return []; } })();
  const askRun = runs.filter(r => r.kind === 'ask' && r.ref === p1).slice(-1)[0];
  ok('FA-2 送出後外殼接受並套用 H2（不因已收起的 H1 被拒）', !!applied && h2Before !== 'did', { before: h2Before, after: assumption('H2').grade, run: askRun && { state: askRun.state, steps: (askRun.steps || []).map(s => s.key + ':' + s.state + ':' + (s.detail || '').slice(0, 60)) } });
  ok('FA-3 這次作答沒有「問題包已經更改」', !!askRun && askRun.state === 'done' && !(askRun.steps || []).some(s => /問題包已經更改/.test(String(s.detail || ''))), askRun && askRun.steps);

  // 取回：待決事項的「已代你收起」摺疊區
  await chrome.go(BASE + '/#/', 1440, 1000);
  const row = await waitFor(() => ev(`(()=>{const r=document.querySelector('[data-fact-closed]');return r?r.getAttribute('data-fact-closed'):null})()`), 20000);
  ok('FA-4 待決事項有「已代你收起」摺疊區，列出 H1', !!row && h1 && row === h1.id, { row, h1: h1 && h1.id });
  await ev(`(()=>{const d=document.querySelector('#fact-closed');if(d)d.open=true;return !!d})()`); await sleep(300);
  try { await chrome.shot(path.join(OUT, 'fact-closed-1440.png'), '#fact-closed'); } catch { }
  await ev(`(()=>{const d=document.querySelector('#fact-closed');if(d)d.open=true;const b=document.querySelector('[data-fact-closed] button');if(b)b.click();return !!b})()`);
  const reopened = await waitFor(() => { const q = qAbout(packOf(p1), 'H1'); return q && !q.closed && q.reopened ? q : null; }, 15000);
  ok('FA-5 按「取回」後 H1 不再收起，並有取回紀錄', !!reopened, qAbout(packOf(p1), 'H1'));
  const p2b = packOf(p2), h1new = qAbout(p2b, 'H1');
  ok('FA-6 取回不會令新一件的同一題被收起（取回的題不再被自動收起）', !!h1new && !h1new.closed, h1new && h1new.closed);
  ok('FA-7 頁面沒有錯誤', chrome.errors.length === 0, chrome.errors);
} catch (e) {
  ok('作答及取回測試中斷', false, String(e && e.stack || e));
} finally {
  if (chrome) chrome.close();
  if (server) server.kill();
}
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info ?? '')).slice(0, 900)));
console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
