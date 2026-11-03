// 後端測試（唔開瀏覽器）：AI 設定、認證、交資料、擬公司概覽、修正、改寫、失敗重試
// 用法：node backend-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(500); } return null; }
const mode = m => fs.writeFileSync(path.join(DATA, 'fake-mode.txt'), m + '\n');
const fields = { q1: '把本地小農的當季蔬菜直送餐廳（測試）', q2: '餐廳每週付款', q3: '兩個農場有興趣（有人講過）', q4: '約第三個農場主見面', q5: '表哥送貨（已確定）', q6: '季末三間餐廳每週下單' };
const file = (name, text) => ({ name, data: Buffer.from(text).toString('base64') });
const latestIntake = async () => (await get('/api/status')).intake;

try {
  // 2026-10-28 試走：真 AI 把清單區段寫成 { title, items, boxes } 或者單一項，外殼核對要規整成清單（否則公司概覽頁卡住）
  { const { checkCompanyPage } = await import(new URL('file:///' + path.join(PROTO, 'company-page-check.mjs').replace(/\\/g, '/')).href);
    const pg = { format: 'startup-os.proofread/0.1', page: { id: 'x' }, company: { name: 'x' }, glance: { rows: [] }, path: { milestones: [{ id: 'm1', short: 'x' }] },
      detail: { rules: { title: 't', items: [{ id: 'ru1', label: 'l', value: 'v', origin: 'ai' }], boxes: { auto: ['a'] } }, missing: { title: '缺', how: 'h' }, assumptions: { title: 't', items: [] } } };
    const r = checkCompanyPage(pg);
    ok('公司概覽清單區段寫成物件：外殼規整成清單（boxes 放第一項、單一項變一項清單）', Array.isArray(r.page.detail.rules) && r.page.detail.rules[0].boxes && r.page.detail.missing.length === 1 && Array.isArray(r.page.detail.assumptions), r.page.detail); }
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 15000);
  const st0 = await get('/api/status');
  ok('開始時未有認證、未有公司概覽', st0.cert === null && st0.company.ready === false, { cert: st0.cert, company: st0.company });
  const shell0 = await get('/api/shell');
  ok('外殼程序不在時：狀態與頁頭工作均為空，沒有排隊', st0.work && st0.work.running === null && st0.work.queued === 0 && shell0.work && shell0.work.running === null && shell0.work.queued === 0, { status: st0.work, shell: shell0.work });
  const setup = await get('/api/setup');
  ok('系統設定列出 AI 工具（含測試 AI）', setup.hosts.some(h => h.id === 'test' && h.installed), setup.hosts.map(h => h.id + ':' + h.installed));
  ok('冇公司概覽時 /company-page.js 回 404', (await fetch(BASE + '/company-page.js')).status === 404);

  // 1. 未設定 AI 都可以交資料：記低，等 AI 設定
  const bad = await post('/api/intake', { bizType: 'other', fields: { q1: '只填一條' }, files: [] });
  ok('必填未齊：拒收並講原因', bad.code === 400 && /首五條/.test(bad.j && bad.j.message || ''), bad);
  const badExt = await post('/api/intake', { bizType: 'other', fields, files: [file('x.exe', 'x')] });
  ok('唔支援嘅附件：拒收', badExt.code === 400, badExt);
  const sub = await post('/api/intake', { bizType: 'other', fields, files: [file('商業模式.md', '# 測試\n農場直送'), file('會議紀錄.txt', '測試會議')] });
  ok('交資料：收到', sub.code === 202 && sub.j && sub.j.id, sub);
  const waiting = await waitFor(async () => { const i = await latestIntake(); return i && i.state === 'waiting' ? i : null; });
  ok('未設定 AI：交資料等 AI 設定', !!waiting, await latestIntake());
  ok('收件匣已整理（搬去封存）', fs.readdirSync(path.join(DATA, 'founder', 'inbox')).length === 0, fs.readdirSync(path.join(DATA, 'founder', 'inbox')));

  // 2. 認證：有一項出界就唔通過
  mode('certify:certify-escape');
  let r = await post('/api/setup', { action: 'certify', host: 'test' });
  ok('認證開始', r.code === 202, r);
  let cs = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('寫出界：認證未通過', cs && cs.state === 'failed' && cs.items.some(i => i.pass === false), cs && cs.items.map(i => i.name + ':' + i.pass));
  ok('未通過：有修法', cs && cs.items.filter(i => i.pass === false).every(i => i.fix), cs && cs.items.filter(i => i.pass === false));
  ok('未通過：冇認證紀錄', (await get('/api/status')).cert === null);

  // 3. 認證通過 → 自動續做交資料（第一次擬錯格式 → 修正一次）
  mode('intake:intake-bad');
  r = await post('/api/setup', { action: 'certify', host: 'test' });
  // 認證本身唔讀 intake-bad；fake-mode 只會畀第一個讀嘅 AI 用，所以認證前先清走，認證後再設
  cs = await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running' ? s.certify : null; });
  ok('認證通過', cs && cs.state === 'passed', cs && cs.items.map(i => i.name + ':' + i.pass + ' ' + i.detail));
  const done = await waitFor(async () => { const s = await get('/api/status'); const i = s.intake; return i && /done|failed/.test(i.state) && s.company.ready !== undefined ? s : null; }, 40000);
  ok('認證後自動續做：公司概覽已就緒', done && done.intake.state === 'done' && done.company.ready, done && { intake: done.intake, company: done.company, run: done.runs[0] });
  const js = await fetch(BASE + '/company-page.js');
  ok('公司概覽由資料夾供應', js.status === 200 && /STARTUP_OS_PAGE/.test(await js.text()));
  const run1 = done && done.runs.find(x => x.id === done.intake.runId);
  ok('自動修正有記低（出處）', run1 && run1.result && Array.isArray(run1.result.warnings), run1 && run1.result);

  // 4. 內部術語：改寫一次改好
  mode('intake:intake-jargon');
  await post('/api/intake', { bizType: 'other', fields, files: [] });
  let s4 = await waitFor(async () => { const s = await get('/api/status'); const i = s.intake; return i && i.runId && /done|failed/.test(i.state) && s.runs.find(x => x.id === i.runId && x.state !== 'running') ? s : null; }, 40000);
  let run4 = s4 && s4.runs.find(x => x.id === s4.intake.runId);
  const page4 = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
  ok('內部術語：改寫後冇提示', run4 && run4.state === 'done' && (run4.result.styleWarnings || []).length === 0, run4 && run4.result);
  ok('內部術語：內容已改好', !/G1|run/.test(page4.glance.rows[0].value), page4.glance.rows[0].value);
  ok('舊公司概覽入歷史', fs.existsSync(path.join(DATA, 'company', 'history')) && fs.readdirSync(path.join(DATA, 'company', 'history')).some(f => f.startsWith('page-')));

  // 5. 改寫都改唔走：照放並標提示
  mode('intake:jargon-stuck');
  await post('/api/intake', { bizType: 'other', fields, files: [] });
  await sleep(1500);
  let s5 = await waitFor(async () => { const s = await get('/api/status'); const i = s.intake; return i && i.runId && i.runId !== s4.intake.runId && /done|failed/.test(i.state) ? s : null; }, 40000);
  let run5 = s5 && s5.runs.find(x => x.id === s5.intake.runId);
  // 改唔走嘅內部用語：原句照放、該行加「〔含內部用語〕」標記，外殼記健康提示（標咗嘅行唔再入 styleWarnings）
  const page5 = JSON.parse(fs.readFileSync(path.join(DATA, 'company', 'page.json'), 'utf8'));
  const warn5 = (JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8')).health || {}).warnings || [];
  ok('改唔走：照放並有用字提示', run5 && run5.state === 'done' && /G1/.test(page5.glance.rows[0].value) && page5.glance.rows[0].value.includes('〔含內部用語〕')
    && ((run5.result.styleWarnings || []).length > 0 || warn5.some(w => w.includes('含內部用語'))), { value: page5.glance.rows[0].value, styleWarnings: run5 && run5.result.styleWarnings, warn5 });

  // 6. AI 失敗 → 重試
  mode('intake:fail');
  await post('/api/intake', { bizType: 'other', fields, files: [] });
  await sleep(1500);
  let s6 = await waitFor(async () => { const s = await get('/api/status'); const i = s.intake; return i && i.runId && i.runId !== s5.intake.runId && /done|failed/.test(i.state) ? s : null; }, 40000);
  ok('AI 失敗：顯示失敗同原因', s6 && s6.intake.state === 'failed' && s6.runs.find(x => x.id === s6.intake.runId).error, s6 && s6.runs[0]);
  r = await post('/api/retry', { runId: s6.intake.runId });
  let s7 = await waitFor(async () => { const s = await get('/api/status'); const i = s.intake; return i && i.runId !== s6.intake.runId && i.state === 'done' ? s : null; }, 40000);
  ok('重試：完成', !!s7, s7 && s7.intake);

  // 7. 安全：本機以外 Origin 拒收
  const forged = await fetch(BASE + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: JSON.stringify({ fields, files: [] }) });
  ok('其他來源：拒收', forged.status === 403);
  ok('伺服器原始碼冇 AI 啟動命令', !/['"]claude['"]|['"]codex['"]/.test(fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8')));
} catch (e) {
  ok('測試中斷', false, String(e && e.stack || e));
} finally {
  srv.kill();
  fs.writeFileSync(path.join(OUT, 'server-log.txt'), log);
}
console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
setTimeout(() => process.exit(0), 300);
