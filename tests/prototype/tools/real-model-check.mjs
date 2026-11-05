// 真實 AI 模型核對（要收費或用計劃額度，唔入全套測試；改模型表後由人手批准先跑）：
// 用隔離資料夾同虛構公司，跑一次認證、一場快打紅藍對打（藍、紅、裁判）同一次平日工作，輸出統計同各方內容。
// 用法：node real-model-check.mjs <claude|codex|agy> <輸出資料夾> <port>
//   環境變數：CHECK_LIMIT_USD（累計到呢個金額就停，預設 6；每次啟動上限 US$2，所以最差唔超過 US$8）
//   CHECK_PROTO（用另一份程式，例如比較舊版）；CHECK_CERT_ONLY=1（只跑認證）；
//   CHECK_SKIP_CERT=1（只限呢個隔離資料夾：唔跑認證，直接驗模型；結果唔代表工具可以正式使用）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { certify, seedCompany, usePass } from '../lib/testkit.mjs';

const [HOST, OUT, PORT] = process.argv.slice(2);
if (!['claude', 'codex', 'agy'].includes(HOST) || !OUT || !PORT) { console.log('用法：node real-model-check.mjs <claude|codex|agy> <輸出資料夾> <port>'); process.exit(2); }
const PROTO = process.env.CHECK_PROTO ? path.resolve(process.env.CHECK_PROTO) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'prototypes', 'proofread');
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT, LIMIT = Number(process.env.CHECK_LIMIT_USD || 6);
if (fs.existsSync(OUT) && fs.readdirSync(OUT).length) { console.log('輸出資料夾已有內容，唔會接管：' + OUT); process.exit(2); }
fs.mkdirSync(DATA, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const say = s => console.log(new Date().toISOString().slice(11, 19) + ' ' + s);
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH/i.test(k) && !/^CLAUDE/i.test(k) && !/^CODEX_THREAD_ID$/i.test(k) && !/^SOS_/.test(k) && !/^CHECK_/.test(k)));
const report = { host: HOST, startedAt: new Date().toISOString(), steps: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const spent = () => ((readJ(path.join(DATA, 'ledger', 'status.json')) || { runs: [] }).runs || []).reduce((n, r) => n + ((r.aiCost && r.aiCost.usd) || 0), 0);

seedCompany(DATA, PROTO);
const SKIP_CERT = process.env.CHECK_SKIP_CERT === '1';
if (SKIP_CERT) {
  const lib = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href), h = lib.hosts(PROTO).find(x => x.id === HOST);
  fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'ledger', 'adapter-cert.json'), JSON.stringify({ host: HOST, label: h.label, certifiedAt: new Date().toISOString(), version: lib.version(h), argsHash: lib.hashHost(h), results: [] }));
  report.certSkipped = true;
}
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...clean, SOS_DATA: DATA, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: 'ignore', windowsHide: true });
const stop = () => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' }); else server.kill(); } catch { } };
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const get = async p => (await fetch(BASE + p)).json();
async function waitFor(fn, minutes) {
  const end = Date.now() + minutes * 60000;
  while (Date.now() < end) {
    if (spent() >= LIMIT) throw new Error('累計費用到上限 US$' + LIMIT + '，已停止');
    try { const v = await fn(); if (v) return v; } catch { }
    await sleep(5000);
  }
  return null;
}

try {
  await usePass(BASE);

  if (!SKIP_CERT) {
  say('1 認證');
  const cert = await certifyLong();
  report.steps.push({ step: 'certify', state: cert.state, items: cert.items.map(i => ({ name: i.name, pass: i.pass, detail: i.detail })) });
  save();
  say('認證：' + cert.state);
  if (cert.state !== 'passed') throw new Error('認證未通過');
  if (process.env.CHECK_CERT_ONLY === '1') throw new Error('只跑認證，已完成');
  }

  say('2 快打紅藍對打');
  const seats = ['付款者', '採購或審批者', '競爭者'];
  const started = await post('/api/intake', { kind: 'note', type: 'debate-start', topicType: 'pricing', title: '每週訂菜定價是否合理', seats, level: 'normal' });
  if (started.code !== 202) throw new Error('開場失敗：' + started.code);
  const id = await waitFor(async () => { const d = await get('/api/debate'); return d.matches.length ? d.matches[d.matches.length - 1].id : null; }, 10);
  if (!id) throw new Error('場次未開到');
  const match = await waitFor(async () => { const m = (await get('/api/debate/match?id=' + id)).match; return m && ['done', 'failed'].includes(m.phase) ? m : null; }, 80);
  report.steps.push({ step: 'debate', id, phase: match?.phase || 'timeout', roles: match?.roles, warnings: match?.warnings, budget: match?.budget, score: match?.score });
  for (const name of ['blue', 'red', 'judge']) report[name] = readJ(path.join(DATA, 'debates', id, name + '.json'));
  save();
  say('對打：' + (match?.phase || 'timeout'));

  say('3 平日工作');
  const help = await post('/api/intake', { kind: 'note', type: 'help', text: '請用三句話說明公司目前最值得先做的一件事，並說明原因。' });
  if (help.code !== 202) throw new Error('求助失敗：' + help.code);
  const run = await waitFor(async () => (await get('/api/status')).runs.find(r => r.ref === help.j.id && ['done', 'failed'].includes(r.state)), 30);
  report.steps.push({ step: 'everyday', state: run?.state || 'timeout', summary: run?.result?.summary, reason: run?.reason });
  save();
  say('平日工作：' + (run?.state || 'timeout'));
} catch (e) {
  report.error = String(e?.message || e);
  say('停止：' + report.error);
} finally {
  try { report.ai = (await get('/api/dashboard')).ai; } catch { }
  const status = readJ(path.join(DATA, 'ledger', 'status.json')) || { runs: [] };
  report.runs = (status.runs || []).map(r => ({ id: r.id, kind: r.kind, label: r.label, state: r.state, reason: r.reason, aiCost: r.aiCost, model: r.model, models: r.models, debatePass: r.debatePass, steps: (r.steps || []).map(s => s.state + ' ' + s.label + (s.detail ? '：' + s.detail : '')) }));
  report.spentUsd = spent();
  for (const f of ['model-seen.json', 'model-notice.json', 'starts.json', 'runs.log']) { const p = path.join(DATA, 'ledger', f); if (fs.existsSync(p)) report[f] = f.endsWith('.json') ? readJ(p) : fs.readFileSync(p, 'utf8').slice(-4000); }
  report.ledgerFiles = fs.existsSync(path.join(DATA, 'ledger')) ? fs.readdirSync(path.join(DATA, 'ledger')) : [];
  report.finishedAt = new Date().toISOString();
  save();
  stop();
  say('完成，累計 US$' + report.spentUsd.toFixed(3));
}

// 真工具認證比測試 AI 慢：沿用 testkit 嘅開始方式，再等到有結果
async function certifyLong() {
  try { const s = await certify(BASE, HOST); if (s.certify) return s.certify; } catch (e) { if (!/certify timeout/.test(String(e?.message))) throw e; }
  const s = await waitFor(async () => { const j = await get('/api/setup'); return j.certify && j.certify.state !== 'running' ? j : null; }, 30);
  if (!s) throw new Error('認證逾時');
  return s.certify;
}
