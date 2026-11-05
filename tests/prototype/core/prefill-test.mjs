// 交資料「由文件預填」測試（規劃書 3.1；唔開瀏覽器，用假 AI、隔離資料夾）
// 硬規矩：AI 按文件預填嘅值一律標「AI 按文件預填」連出處；創辦人確認之後先算數；「你原話」唔可以造假（掃描工具證明）。
// 用法：node prefill-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 }); // 重試時上一次嘅 Chrome 可能未放手
const DATA = path.join(OUT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; }
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const norm = s => String(s || '').replace(/\s+/g, '');
const PLAN = '# 計劃書\n\n我們替社區洗衣店收集和配送衣物。\n\n客戶按月付款，每月最少收集四次。\n';
const MEET = '與兩間洗衣店店主會面，兩間都願意試用一個月。\n';
const DOCS = [{ name: '計劃書.md', data: b64(PLAN) }, { name: '會議紀錄.txt', data: b64(MEET) }, { name: '簡報.pdf', data: Buffer.from('%PDF-1.4 fake binary').toString('base64') }];
const fields = o => { const f = {}; for (let n = 1; n <= 8; n++) f['q' + n] = o['q' + n] || ''; return f; };
const prefillDone = id => waitFor(async () => { const r = await get('/api/prefill?id=' + id); return r.j && r.j.state !== 'running' ? r.j : null; });
const scan = (dir, out) => spawnSync(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'prefill-scan.mjs'), dir, ...(out ? [out] : [])], { encoding: 'utf8' });

try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).j.ok; } catch { return false; } }, 60000);
  await post('/api/setup', { action: 'certify', host: 'test' });
  const cert = await waitFor(async () => { const s = (await get('/api/setup')).j; return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('假 AI 認證通過', cert && cert.state === 'passed', cert);

  // 入口
  const none = await post('/api/intake', { kind: 'prefill', files: [] });
  ok('未加文件就按「由文件預填」：拒收並講原因', none.code === 400 && /文件/.test(none.j.message), none);
  const r1 = await post('/api/intake', { kind: 'prefill', files: DOCS });
  ok('交文件做預填：收到並回傳編號', r1.code === 202 && r1.j.id, r1);
  const id = r1.j.id;
  const st1 = await prefillDone(id);
  ok('預填完成：頁面可以讀到結果', st1 && st1.state === 'done' && st1.prefill && st1.prefill.answers, st1);
  const P = st1.prefill, A = P.answers;
  ok('第 1 題：文件原句，出處係含有嗰句嘅文件', A.q1 && A.q1.label === 'quote' && [PLAN, MEET].some(t => norm(t).includes(norm(A.q1.text))) && (A.q1.source === '計劃書.md' ? norm(PLAN).includes(norm(A.q1.text)) : norm(MEET).includes(norm(A.q1.text))), A.q1);
  ok('第 2 題：AI 按文件推斷，標「不是原句」', A.q2 && A.q2.label === 'inferred' && !A.q2.downgraded, A.q2);
  ok('第 3 題：AI 話係原句但文件搵唔到：降為推斷並記低', A.q3 && A.q3.label === 'inferred' && A.q3.downgraded === true, A.q3);
  ok('第 4 題：文件冇講：留空，列為「文件未有」', !A.q4 && P.missing.includes('q4'), { q4: A.q4, missing: P.missing });
  ok('第 5 題：另一份文件原句', A.q5 && A.q5.label === 'quote', A.q5);
  // 規劃者第 161 點：工作說明第一行有今日日期，AI 先判斷到「本週」一類字眼係咪已過
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const pfRun = (await get('/api/status')).j.runs.find(r => r.kind === 'prefill' && r.ref === id);
  const pfTask = pfRun ? fs.readFileSync(path.join(DATA, 'sandbox', pfRun.id, 'task.md'), 'utf8') : '';
  ok('預填工作說明第一行寫今日日期', pfTask.startsWith('> 今日日期：' + ymd(new Date())) && /按今日日期判斷/.test(pfTask), pfTask.slice(0, 120));
  ok('預填唔寫公司概覽、唔出問題包、唔建業務紀錄', !fs.existsSync(path.join(DATA, 'company', 'page.json')) && !(fs.existsSync(path.join(DATA, 'asks')) && fs.readdirSync(path.join(DATA, 'asks')).some(f => f.endsWith('.json'))) && !(((fs.existsSync(path.join(DATA, 'ledger', 'state.json')) ? JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8')) : {}).milestones || []).length), fs.existsSync(path.join(DATA, 'asks')) ? fs.readdirSync(path.join(DATA, 'asks')) : []);
  const inbox = fs.readdirSync(path.join(DATA, 'founder', 'inbox'));
  const arch = fs.readdirSync(path.join(DATA, 'archive'), { recursive: true }).map(String).filter(f => f.includes(id + '-prefill'));
  ok('收件匣清空；文件同說明搬去封存（掃描照封存核對）', !inbox.some(f => f.includes('-prefill')) && arch.length === 4, { inbox, arch });
  const run = (await get('/api/status')).j.runs.find(r => r.kind === 'prefill' && r.ref === id);
  ok('AI 工作紀錄：摘要講清楚幾多條原句、推斷、未有', run && run.state === 'done' && /文件原句 2 條/.test(run.result.summary) && /推斷 2 條/.test(run.result.summary) && !N.styleIssues(run.result.summary).length, run && run.result);

  // 送出交資料：未確認就算數係唔得
  const base = { q1: A.q1.text, q2: A.q2.text, q3: '我們已和兩間洗衣店會面。', q4: '社區洗衣店店主。', q5: A.q5.text };
  const un = await post('/api/intake', { bizType: 'other', fields: fields(base), files: [], prefillId: id, provenance: { q2: 'confirmed', q5: 'confirmed' } });
  ok('有預填未確認就送出：伺服器拒收（創辦人確認之後先算數）', un.code === 400 && un.j.message === N.ui.prefillUnconfirmed, un);
  const sneak = await post('/api/intake', { bizType: 'other', fields: fields(base), files: [] });
  ok('唔講預填編號、照抄預填：伺服器照樣認得，拒收', sneak.code === 400 && sneak.j.message === N.ui.prefillUnconfirmed, sneak);
  ok('拒收之後收件匣冇交資料檔', !fs.readdirSync(path.join(DATA, 'founder', 'inbox')).some(f => f.endsWith('-intake.md')));
  // 確認 q1、q2、q5；q3 係自己改寫；第 4 題抄咗第 2 題嘅預填（搬題）
  const good = await post('/api/intake', { bizType: 'other', fields: fields({ ...base, q4: A.q2.text }), files: DOCS.slice(0, 2), prefillId: id, provenance: { q1: 'confirmed', q2: 'confirmed', q5: 'confirmed' } });
  ok('逐條確認後送出：收到', good.code === 202 && good.j.ok, good);
  const it = await waitFor(async () => { const s = (await get('/api/status')).j; return s.intake && (s.intake.state === 'done' || s.intake.state === 'failed') ? s.intake : null; });
  ok('交資料照常交 AI 擬公司概覽', it && it.state === 'done', it);
  const mdFile = fs.readdirSync(path.join(DATA, 'archive'), { recursive: true }).map(String).find(f => f.endsWith(good.j.id + '-intake.md'));
  const md = mdFile ? fs.readFileSync(path.join(DATA, 'archive', mdFile), 'utf8') : '';
  const mc = JSON.parse((md.match(/```json\s*([\s\S]*?)```\s*$/) || [, '{}'])[1]);
  const pv = mc.provenance || {};
  ok('來源紀錄：第 1、5 題係「你確認的文件原句」（已確認、連出處）', pv.q1 && pv.q1.kind === 'quote' && pv.q1.confirmed && pv.q1.source === A.q1.source && pv.q5.kind === 'quote' && pv.q5.confirmed, pv);
  ok('來源紀錄：第 2 題係「你認同的 Zero 建議」，唔係原句', pv.q2 && pv.q2.kind === 'adopted' && pv.q2.label === 'inferred' && pv.q2.confirmed, pv.q2);
  ok('來源紀錄：自己改寫嘅第 3 題先係「你寫的」', pv.q3 && pv.q3.kind === 'founder', pv.q3);
  ok('來源紀錄：抄咗預填去第 4 題，都唔記成「你寫的」，亦唔記「已確認」', pv.q4 && pv.q4.kind === 'adopted' && pv.q4.moved === true && !pv.q4.confirmed, pv.q4);
  ok('交 AI 嘅檔案每題下面寫明來源（搬題嗰條照實寫）', md.includes('（來源：你確認的文件原句，出自《' + A.q1.source + '》') && md.includes('（來源：你認同的 Zero 建議') && md.includes('（來源：你寫的）') && md.includes('（來源：Zero 按文件預填的句子，由另一題搬來'), md.slice(0, 900));
  const sbIntake = fs.readdirSync(path.join(DATA, 'sandbox')).map(d => path.join(DATA, 'sandbox', d, 'task.md')).filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8')).find(t => /^# 擬公司概覽/m.test(t));
  ok('擬公司概覽嘅工作說明：AI 推斷唔可以升做文件寫明', sbIntake && /只可以當 Zero 推斷/.test(sbIntake), (sbIntake || '').slice(0, 300));
  ok('擬公司概覽嘅工作說明第一行寫今日日期，並要對照文件日期', sbIntake && sbIntake.startsWith('> 今日日期：' + ymd(new Date())) && /3b./.test(sbIntake), (sbIntake || '').slice(0, 160));

  // 讀唔到文字嘅文件：標「未能核對原句」，永不升做原句
  const r2 = await post('/api/intake', { kind: 'prefill', files: [DOCS[2]] });
  const st2 = await prefillDone(r2.j.id);
  ok('只得 pdf：AI 話係原句都只標「未能核對原句」', st2 && st2.state === 'done' && st2.prefill.answers.q1 && st2.prefill.answers.q1.label === 'unverified' && !Object.values(st2.prefill.answers).some(a => a.label === 'quote'), st2 && st2.prefill);
  // 確認採用未能核對嘅預填：記「你確認的 AI 預填 · 未能核對是否原句」，唔記原句、唔記你寫的
  const u1 = st2.prefill.answers.q1.text;
  const seenIntake = (await get('/api/status')).j.intake.id;
  const good2 = await post('/api/intake', { bizType: 'other', fields: fields({ q1: u1, q2: '每月收費。', q3: '未有。', q4: '洗衣店店主。', q5: '只有我。' }), files: [DOCS[2]], prefillId: r2.j.id, provenance: { q1: 'confirmed' } });
  ok('採用未能核對嘅預填後送出：收到', good2.code === 202, good2);
  await waitFor(async () => { const s = (await get('/api/status')).j; return s.intake && s.intake.id !== seenIntake && (s.intake.state === 'done' || s.intake.state === 'failed'); });
  const md2f = fs.readdirSync(path.join(DATA, 'archive'), { recursive: true }).map(String).find(f => f.endsWith(good2.j.id + '-intake.md'));
  const md2 = md2f ? fs.readFileSync(path.join(DATA, 'archive', md2f), 'utf8') : '';
  const pv2 = (JSON.parse((md2.match(/```json\s*([\s\S]*?)```\s*$/) || [, '{}'])[1]).provenance) || {};
  ok('未能核對嘅預填：記「已確認的 AI 預填 · 未能核對是否原句」', pv2.q1 && pv2.q1.kind === 'adopted' && pv2.q1.label === 'unverified' && pv2.q1.confirmed && md2.includes('未能核對是否原句') && pv2.q2.kind === 'founder', { pv2, md: md2.slice(0, 300) });
  // AI 交錯格式
  mode('prefill:prefill-bad');
  const r3 = await post('/api/intake', { kind: 'prefill', files: DOCS.slice(0, 1) });
  const st3 = await prefillDone(r3.j.id);
  ok('AI 交錯格式：預填失敗並講原因，唔寫任何結果', st3 && st3.state === 'failed' && !fs.existsSync(path.join(DATA, 'ledger', 'prefill', r3.j.id + '.json')), st3);
  const g404 = await get('/api/prefill?id=../../x');
  ok('預填查詢只接受正常編號', g404.code === 404, g404);

  // 模擬實例：工作說明嘅今日日期跟模擬時鐘（推前 10 日）
  const SIMD = path.join(OUT, 'sim-data'), SP = Number(PORT) + 1, SB2 = `http://127.0.0.1:${SP}`;
  fs.mkdirSync(path.join(SIMD, 'founder', 'desk'), { recursive: true });
  fs.writeFileSync(path.join(SIMD, 'founder', 'desk', 'sim-clock.json'), JSON.stringify({ offsetMs: 10 * 86400000 }));
  const sim = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(SP)], { cwd: PROTO, env: { ...process.env, SOS_DATA: SIMD, SOS_SIM: '1', SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
  try {
    const sget = async p => { const r = await fetch(SB2 + p); return r.json(); };
    const spost = async (p, body) => (await fetch(SB2 + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SB2 }, body: JSON.stringify(body) })).json();
    await usePass(SB2);
    await waitFor(async () => { try { return (await sget('/api/status')).ok; } catch { return false; } });
    await spost('/api/setup', { action: 'certify', host: 'test' });
    await waitFor(async () => { const s = await sget('/api/setup'); return s.certify && s.certify.state !== 'running'; });
    const rs = await spost('/api/intake', { kind: 'prefill', files: DOCS.slice(0, 1) });
    await waitFor(async () => { const p = await sget('/api/prefill?id=' + rs.id); return p.state && p.state !== 'running'; });
    const srun = (await sget('/api/status')).runs.find(r => r.kind === 'prefill' && r.ref === rs.id);
    const later = new Date(); later.setDate(later.getDate() + 10);
    const stask = srun ? fs.readFileSync(path.join(SIMD, 'sandbox', srun.id, 'task.md'), 'utf8') : '';
    ok('模擬實例：工作說明嘅今日日期跟模擬時鐘（推前 10 日）', stask.startsWith('> 今日日期：' + ymd(later)), stask.slice(0, 60));
  } finally { sim.kill(); }

  // 機械掃描：真資料零違規；人手造假即刻捉到
  const s1 = scan(DATA, path.join(OUT, 'scan.json'));
  ok('掃描：「你原話」標籤零違規', s1.status === 0 && /違規 0 項/.test(s1.stdout), s1.stdout + s1.stderr);
  const T = path.join(OUT, 'tamper'); fs.cpSync(DATA, T, { recursive: true });
  const tf = path.join(T, 'archive', mdFile);
  fs.writeFileSync(tf, fs.readFileSync(tf, 'utf8').replace('"kind": "adopted",\n      "label": "inferred"', '"kind": "founder",\n      "label": "inferred"').replace(/（來源：你認同的 Zero 建議[^\n]*/, '（來源：你寫的）'));
  const pf = path.join(T, 'ledger', 'prefill', id + '.json'), pj = JSON.parse(fs.readFileSync(pf, 'utf8'));
  pj.answers.q3.label = 'quote'; fs.writeFileSync(pf, JSON.stringify(pj));
  const s2 = scan(T);
  ok('掃描：AI 建議改成「你寫的」、捏造句改成原句，兩樣都捉到', s2.status === 1 && /記成「你寫的」/.test(s2.stdout) && /文件搵唔到/.test(s2.stdout), s2.stdout);
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
