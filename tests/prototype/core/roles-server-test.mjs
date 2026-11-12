// 0.41.0 伺服器線測試（假 AI、隔離資料夾；不開瀏覽器、不連外網、不登記真實排程）。
//  1 六個新創辦人操作（setPace、pauseZero、resumeZero、rolePause、roleResume、rolesSync）的核對與隊列形狀
//  2 排程器逾時按節奏檔（45／90／240），舊資料沒有 pace 時與舊公式相同；伺服器計時器遇到待套用的 setPace 叫外殼、並同步登記標記
//  3 崗位頭像由 /assets/ 送出
//  4 更正連結加比對來源 id（舊請求只帶標題照舊）
//  5 轉換途中伺服器重啟留下的附件：開機時搬到封存區，不再算作待處理，且一個檔都不刪
// 設計：docs/evidence/zero-roles-2026-11-08/impl-contract.md 第 2 節；docs/evidence/release-0402/fix-plan.md 覆核建議 1、2。
// 用法：node roles-server-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>（用 port 至 port+4）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { usePass, forgetPass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT0, ADAPTER] = process.argv.slice(2);
const PORT = Number(PORT0);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = f => import(pathToFileURL(path.join(PROTO, f)).href);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const attempt = async (name, fn) => { try { await fn(); } catch (e) { ok(name + '（執行出錯）', false, String(e && e.stack || e).slice(0, 500)); } };
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const pad = n => String(n).padStart(2, '0');
const localDay = (add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const J = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const W = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_|^CZ_/.test(k) && !/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH|^CLAUDE/i.test(k)));
const mkData = root => { const data = path.join(root, 'data'); for (const d of ['founder/replies', 'founder/inbox', 'company', 'archive', 'ledger/answers', 'asks', 'sandbox', 'work']) fs.mkdirSync(path.join(data, d), { recursive: true }); return data; };
const servers = [];
function startServer(data, port, extra = {}) {
  const log = { text: '' };
  const p = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...cleanEnv, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => { log.text += d; }); p.stderr.on('data', d => { log.text += d; });
  servers.push(p);
  return { p, log, base: `http://127.0.0.1:${port}` };
}
const stop = async s => { try { s.p.kill(); } catch { } await sleep(400); };
const waitFor = async (fn, ms = 30000, step = 300) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
const healthy = async base => waitFor(async () => { try { return (await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }, 20000, 250);
const postTo = (base) => async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };

const lops = await imp('ledger-ops.mjs');
const pace = await imp('pace-lib.mjs');
const inb = await imp('inbound-lib.mjs');

/* =====================================================================
   1 純函數：核對與重播
   ===================================================================== */
await attempt('1 純函數', async () => {
  const T = '2026-11-08';
  const st = { ledgerFrom: 'pg', intake: { confirmedAt: '2026-11-01T10:00:00+08:00' }, teammates: [{ id: 'tm-a', lifecycle: 'enabled' }, { id: 'tm-b' }, { id: 'tm-c', lifecycle: 'paused' }, { id: 'tm-m', lifecycle: 'merged', mergedInto: 'tm-a' }, { id: 'tm-r', lifecycle: 'retired' }] };
  const c = (op, target, value, state = st, o = {}) => lops.checkRolesOp(op, target, value, state, { today: T, ...o });
  ok('1 六個新 op 的名稱與允許欄位對上凍結表', JSON.stringify(lops.ROLES_OPS) === JSON.stringify({ setPace: ['pace', 'sprintUntil'], pauseZero: [], resumeZero: [], rolePause: ['reason'], roleResume: [], rolesSync: [] }), lops.ROLES_OPS);
  ok('1 setPace：三檔都接受，隊列值只留 pace', ['standard', 'fast', 'sprint'].every(p => { const r = c('setPace', 'company', { pace: p }); return r.ok && JSON.stringify(r.value) === JSON.stringify({ pace: p }); }));
  ok('1 setPace：衝刺期限在今日至今日＋14 內接受（含兩端）', c('setPace', 'company', { pace: 'sprint', sprintUntil: T }).ok && c('setPace', 'company', { pace: 'sprint', sprintUntil: '2026-11-22' }).ok);
  ok('1 setPace：期限早於今日、遲於今日＋14、不是真實日期、不是字串一律拒絕', [{ sprintUntil: '2026-11-07' }, { sprintUntil: '2026-11-23' }, { sprintUntil: '2026-02-30' }, { sprintUntil: '11/20' }, { sprintUntil: 20261120 }, { sprintUntil: {} }].every(v => !c('setPace', 'company', { pace: 'sprint', ...v }).ok));
  ok('1 setPace：期限只屬於衝刺；非法檔、缺檔、多餘欄位、錯的對象一律拒絕', !c('setPace', 'company', { pace: 'fast', sprintUntil: '2026-11-10' }).ok && !c('setPace', 'company', { pace: 'turbo' }).ok && !c('setPace', 'company', {}).ok && !c('setPace', 'company', { pace: 'fast', x: 1 }).ok && !c('setPace', 'roles', { pace: 'fast' }).ok);
  ok('1 setPace：衝刺不寫期限也接受（外殼用預設期限）；空字串當沒有', c('setPace', 'company', { pace: 'sprint' }).ok && JSON.stringify(c('setPace', 'company', { pace: 'sprint', sprintUntil: '' }).value) === JSON.stringify({ pace: 'sprint' }));
  const paused = { ...st, health: { pausedByFounder: true } };
  ok('1 pauseZero／resumeZero：未暫停才接受暫停、已暫停才接受恢復', c('pauseZero', 'company', {}).ok && !c('resumeZero', 'company', {}).ok && !c('pauseZero', 'company', {}, paused).ok && c('resumeZero', 'company', {}, paused).ok);
  ok('1 pauseZero／resumeZero：對象須是 company、不可帶欄位', !c('pauseZero', 'roles', {}).ok && !c('pauseZero', 'company', { reason: 'x' }).ok && !c('resumeZero', 'tm-a', {}, paused).ok);
  ok('1 連按：待套用的暫停令第二次暫停被拒，待套用的恢復令再恢復被拒', !c('pauseZero', 'company', {}, st, { pending: [{ op: 'pauseZero' }] }).ok && c('resumeZero', 'company', {}, st, { pending: [{ op: 'pauseZero' }] }).ok && !c('resumeZero', 'company', {}, paused, { pending: [{ op: 'resumeZero' }] }).ok);
  ok('1 rolePause：啟用中、待啟用（沒有 lifecycle 當待啟用）的卡接受', c('rolePause', 'tm-a', {}).ok && c('rolePause', 'tm-b', {}).ok);
  ok('1 rolePause：暫停中、已併入、已取消、不存在的卡一律拒絕', ['tm-c', 'tm-m', 'tm-r', 'tm-zzz', ''].every(id => !c('rolePause', id, {}).ok));
  ok('1 rolePause：原因 ≤ 80 字接受並去空白；81 字、非字串、多餘欄位拒絕', JSON.stringify(c('rolePause', 'tm-a', { reason: '  等客戶回覆  ' }).value) === JSON.stringify({ reason: '等客戶回覆' }) && c('rolePause', 'tm-a', { reason: '字'.repeat(80) }).ok && !c('rolePause', 'tm-a', { reason: '字'.repeat(81) }).ok && !c('rolePause', 'tm-a', { reason: 5 }).ok && !c('rolePause', 'tm-a', { why: 'x' }).ok);
  ok('1 roleResume：只有暫停中的卡接受', c('roleResume', 'tm-c', {}).ok && ['tm-a', 'tm-b', 'tm-m', 'tm-zzz'].every(id => !c('roleResume', id, {}).ok));
  ok('1 連按：待套用的暫停令同一張卡不能再暫停；待套用的暫停令可接著恢復', !c('rolePause', 'tm-a', {}, st, { pending: [{ op: 'rolePause', target: 'tm-a', value: {} }] }).ok && c('roleResume', 'tm-a', {}, st, { pending: [{ op: 'rolePause', target: 'tm-a', value: {} }] }).ok && !c('roleResume', 'tm-c', {}, st, { pending: [{ op: 'roleResume', target: 'tm-c' }] }).ok);
  ok('1 rolesSync：概覽已確認、沒有未答的崗位題、未在擬崗位中才接受', c('rolesSync', 'roles', {}).ok);
  ok('1 rolesSync：未確認概覽、示範、有未答崗位題包、已要求、還有排隊的卡、錯的對象一律拒絕', !c('rolesSync', 'roles', {}, { ...st, intake: {} }).ok && !c('rolesSync', 'roles', {}, { ...st, ledgerFrom: '' }).ok && !c('rolesSync', 'roles', {}, { ...st, demo: true }).ok && !c('rolesSync', 'roles', {}, st, { rolesPackOpen: true }).ok && !c('rolesSync', 'roles', {}, { ...st, rolesSync: { requested: true } }).ok && !c('rolesSync', 'roles', {}, { ...st, rolesSync: { pending: [{ title: 'x' }] } }).ok && !c('rolesSync', 'people', {}).ok);
  ok('1 rolesSync：已擬過（for 等於此版）而沒有其他阻礙時仍可再要求；連按第二次被拒', c('rolesSync', 'roles', {}, { ...st, rolesSync: { for: 'pg|2026-11-01T10:00:00+08:00' } }).ok && !c('rolesSync', 'roles', {}, st, { pending: [{ op: 'rolesSync' }] }).ok);
  ok('1 不認識的 op、非字串對象一律拒絕', !c('peopleSync', 'people', {}).ok && !lops.checkRolesOp('setPace', 5, { pace: 'fast' }, st, { today: T }).ok);
  const before = JSON.stringify(st); lops.checkRolesOp('rolePause', 'tm-a', { reason: 'x' }, st, { pending: [{ op: 'rolePause', target: 'tm-a', value: {} }], today: T });
  ok('1 核對不改傳入的帳本狀態', JSON.stringify(st) === before);
});

/* =====================================================================
   2 install-schedule：逾時按檔（只寫標記，不碰作業系統；用 --data 指向隔離資料夾）
   ===================================================================== */
await attempt('2 install-schedule', async () => {
  const script = path.join(PROTO, 'adapters', 'scheduler', 'install-schedule.mjs');
  const limitFor = (name, rhythm) => {
    const root = path.join(OUT, 'sch-' + name), data = path.join(root, 'data');
    W(path.join(data, 'ledger', 'state.json'), { schemaVersion: 1, runs: [], company: { rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1, ...rhythm } } });
    const r = spawnSync(process.execPath, [script, '--register', '--data', data], { cwd: PROTO, encoding: 'utf8', env: { ...cleanEnv, SOS_SCHED_CMD: path.join(HERE, '..', 'lib', 'fake-schtasks.mjs') }, timeout: 30000 });
    const mark = (() => { try { return J(path.join(data, 'ledger', 'schedule.json')); } catch { return null; } })();
    return { status: r.status, limit: mark && mark.limitMinutes, mode: mark && mark.mode, out: r.stdout + r.stderr };
  };
  const want = { standard: pace.PACES.standard.timeoutMinutes, fast: pace.PACES.fast.timeoutMinutes, sprint: pace.PACES.sprint.timeoutMinutes };
  ok('2 節奏檔的逾時是 45／90／240 分鐘（pace-lib 定義）', want.standard === 45 && want.fast === 90 && want.sprint === 240, want);
  for (const k of ['standard', 'fast', 'sprint']) { const r = limitFor(k, { runCapMinutes: 30, pace: k }); ok(`2 登記標記的逾時：${k} → ${want[k]} 分鐘`, r.status === 0 && r.mode === 'server' && r.limit === want[k], r); }
  const a = limitFor('legacy30', { runCapMinutes: 30 });
  ok('2 舊資料沒有 pace：逾時與舊公式相同（每次上限 30 ＋ 15 ＝ 45）', a.status === 0 && a.limit === 45, a);
  const b = limitFor('legacy45', { runCapMinutes: 45 });
  ok('2 舊資料沒有 pace、每次上限 45：仍是舊公式 60，不被新規則改動', b.status === 0 && b.limit === 60, b);
  const d = limitFor('nocap', {});
  ok('2 完全沒有上限欄位的舊資料：45', d.status === 0 && d.limit === 45, d);
  const e = limitFor('badpace', { runCapMinutes: 30, pace: 'turbo' });
  ok('2 pace 不是合法檔：當舊資料處理（45），不報錯', e.status === 0 && e.limit === 45, e);
  const f = limitFor('stdcap60', { runCapMinutes: 60, pace: 'standard' });
  ok('2 明確選了標準檔：按檔 45，不理舊的每次上限', f.status === 0 && f.limit === 45, f);
});

/* =====================================================================
   5a 純函數：收件匣附件歸屬與歸位（不需要伺服器）
   ===================================================================== */
await attempt('5 純函數', async () => {
  const id = '20261108-100000-001';
  ok('5 主檔對應：交資料、預填、四類筆記的附件／文字版／說明檔都認得出主檔', [
    [id + '-intake-01-報價.docx', id + '-intake.md'], [id + '-intake-01-報價.docx.md', id + '-intake.md'], [id + '-meta-intake.json', id + '-intake.md'],
    [id + '-prefill-02-表.xlsx', id + '-prefill.md'], [id + '-meta-prefill.json', id + '-prefill.md'],
    [id + '-note-event-file-01-會議.docx', id + '-note-event.md'], [id + '-note-event-file-01-會議.docx.md', id + '-note-event.md'], [id + '-note-event-meta.json', id + '-note-event.md'],
    [id + '-note-doc-file-03-a.pdf', id + '-note-doc.md'], [id + '-note-adhoc-file-01-a.docx', id + '-note-adhoc.md'], [id + '-note-order-meta.json', id + '-note-order.md']
  ].every(([f, o]) => inb.uploadOwner(f) === o), [id + '-note-event-file-01-會議.docx']);
  ok('5 主檔本身、回覆檔、別的檔不是附件（沒有主檔對應）', ['-intake.md', '-prefill.md', '-note-event.md', '-note-help.md', '-feedback-checkup.md'].every(s => inb.uploadOwner(id + s) === '') && inb.uploadOwner('readme.md') === '' && inb.uploadOwner('') === '');
  ok('5 原名裏含 -note-event.md、-intake-01- 字樣也按第一個前綴認主檔', inb.uploadOwner(id + '-note-event-file-01-a-note-event.md') === id + '-note-event.md' && inb.uploadOwner(id + '-note-doc-file-01-x-intake-01-y.docx') === id + '-note-doc.md');
  const root = path.join(OUT, 'rehome-unit'), inbox = path.join(root, 'inbox'), arch = path.join(root, 'archive');
  const files = {
    [id + '-intake-01-報價.docx']: 'ORIGINAL-A', [id + '-intake-01-報價.docx.md']: 'half text', [id + '-meta-intake.json']: '{"x":1}',
    ['20261108-100100-002-note-event-file-01-會議.docx']: 'ORIGINAL-B', ['20261108-100100-002-note-event-file-01-會議.docx.md']: 'text B', ['20261108-100100-002-note-event-meta.json']: '{}',
    ['20261108-100200-003-note-doc-file-01-a-note-event.md']: 'ORIGINAL-C',
    ['20261108-100300-004-note-event.md']: 'keep owner', ['20261108-100300-004-note-event-file-01-x.docx']: 'keep attach', ['20261108-100300-004-note-event-meta.json']: 'keep meta',
    ['20261108-100400-005-intake.md']: 'keep intake', ['20261108-100400-005-intake-01-y.docx']: 'keep intake attach',
    ['20261108-100500-006-note-help.md']: 'help note', ['.hidden']: 'dot', ['random.txt']: 'random'
  };
  fs.mkdirSync(inbox, { recursive: true }); fs.mkdirSync(path.join(inbox, 'subdir'), { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(inbox, n), c);
  const moved = inb.rehomeInterruptedUploads({ inboxDir: inbox, archiveDir: arch });
  const dest = path.join(arch, 'interrupted-uploads');
  const orphanNames = Object.keys(files).filter(n => /^(20261108-100000-001|20261108-100100-002|20261108-100200-003)-/.test(n));
  ok('5 沒有主檔的附件、文字版、說明檔共 7 個全部搬走', moved.length === 7 && orphanNames.length === 7 && orphanNames.every(n => moved.includes(n) && !fs.existsSync(path.join(inbox, n))), { moved, orphanNames });
  ok('5 搬走的檔內容與原來逐位元組相同（原檔沒有被改、沒有被刪）', orphanNames.every(n => fs.existsSync(path.join(dest, n)) && fs.readFileSync(path.join(dest, n), 'utf8') === files[n]));
  const keep = Object.keys(files).filter(n => !orphanNames.includes(n));
  ok('5 有主檔的附件、主檔、回覆檔、隱藏檔、其他檔、子資料夾原樣不動', keep.every(n => fs.readFileSync(path.join(inbox, n), 'utf8') === files[n]) && fs.existsSync(path.join(inbox, 'subdir')), keep);
  ok('5 收件匣檔數＋封存區檔數等於原來檔數（沒有任何檔消失）', fs.readdirSync(inbox, { withFileTypes: true }).filter(e => e.isFile()).length + fs.readdirSync(dest).length === Object.keys(files).length);
  ok('5 再跑一次沒有東西可搬（冪等）', inb.rehomeInterruptedUploads({ inboxDir: inbox, archiveDir: arch }).length === 0);
  // 同名已在封存區：不覆蓋，加尾碼
  fs.writeFileSync(path.join(inbox, id + '-intake-01-報價.docx'), 'ORIGINAL-A2');
  const again = inb.rehomeInterruptedUploads({ inboxDir: inbox, archiveDir: arch });
  ok('5 封存區已有同名檔：新來的加尾碼，兩份內容都在', again.length === 1 && fs.readFileSync(path.join(dest, id + '-intake-01-報價.docx'), 'utf8') === 'ORIGINAL-A' && fs.readFileSync(path.join(dest, id + '-intake-01-報價-2.docx'), 'utf8') === 'ORIGINAL-A2', fs.readdirSync(dest));
  ok('5 收件匣資料夾不存在：回空，不丟錯', inb.rehomeInterruptedUploads({ inboxDir: path.join(root, 'nope'), archiveDir: arch }).length === 0);
});

/* =====================================================================
   3、4、1 伺服器：founder-op、assets、source-url
   ===================================================================== */
const DA = mkData(path.join(OUT, 'a'));
oldInstall(DA, PROTO);
const pageId = J(path.join(DA, 'company', 'page.json')).page.id;
const STATE_A = path.join(DA, 'ledger', 'state.json'), OPS_A = path.join(DA, 'ledger', 'founder-ops.json');
const baseState = (extra = {}) => ({
  schemaVersion: 1, ledgerFrom: pageId, intake: { state: 'complete', confirmedAt: '2026-11-01T10:00:00+08:00' },
  company: { name: '測試公司', rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1, runCapMinutes: 30 } },
  teammates: [{ id: 'tm-a', title: '餐廳拓展經理', lifecycle: 'enabled' }, { id: 'tm-b', title: '農場採購專員', lifecycle: 'planned' }, { id: 'tm-c', title: '牌照及保險主任', lifecycle: 'paused' },
    { id: 'tm-d', title: '舊卡', lifecycle: 'merged', mergedInto: 'tm-a' }, { id: 'tm-e', title: '取消卡', lifecycle: 'retired' }],
  milestones: [], tasks: [], events: [], runs: [], ...extra
});
W(STATE_A, baseState());
W(OPS_A, []);
// 留住外殼：鎖檔寫入本測試程序的編號（程序仍在，鎖在 20 分鐘內有效），伺服器叫起外殼時外殼會立即離開，不會合併隊列
fs.writeFileSync(path.join(DA, 'ledger', '.lock'), String(process.pid));
const A = startServer(DA, PORT);
const postA = postTo(A.base);
const queue = () => { try { return J(OPS_A); } catch { return []; } };
const resetState = (extra = {}) => { W(STATE_A, baseState(extra)); W(OPS_A, []); };
const op = (o, target, value) => postA('/api/founder-op', { op: o, target, ...(value === undefined ? {} : { value }) });
const accepted = async (name, o, target, value, expectValue) => {
  const n = queue().length, r = await op(o, target, value), q = queue(), last = q[q.length - 1];
  ok(name, r.code === 202 && r.j && r.j.ok === true && q.length === n + 1 && last && last.op === o && last.target === target && (expectValue === undefined || JSON.stringify(last.value) === JSON.stringify(expectValue)), { r, last });
  return last;
};
const rejected = async (name, o, target, value) => {
  const n = queue().length, r = await op(o, target, value);
  ok(name, r.code === 400 && r.j && r.j.ok === false && r.j.error === 'invalid' && typeof r.j.message === 'string' && r.j.message.length > 0 && queue().length === n, { r, n, now: queue().length });
};

await attempt('伺服器起動', async () => {
  ok('伺服器（測試資料夾、假 AI）起得來', await healthy(A.base), A.log.text.slice(0, 400));
  await usePass(A.base);
});

await attempt('1 伺服器：setPace', async () => {
  resetState();
  const T = localDay(0);
  const a = await accepted('1 setPace 衝刺＋期限（今日＋5）：202，隊列一筆，值為 pace＋sprintUntil', 'setPace', 'company', { pace: 'sprint', sprintUntil: localDay(5) }, { pace: 'sprint', sprintUntil: localDay(5) });
  ok('1 隊列項目形狀：id（fo- 開頭）、at、op、target、value，沒有多餘欄位', a && JSON.stringify(Object.keys(a)) === JSON.stringify(['id', 'at', 'op', 'target', 'value']) && /^fo-[a-z0-9]+-[a-f0-9]{6}$/.test(a.id) && /^\d{4}-\d{2}-\d{2}T/.test(a.at), a);
  await accepted('1 setPace 加速、標準：接受', 'setPace', 'company', { pace: 'fast' }, { pace: 'fast' });
  await accepted('1 setPace 標準', 'setPace', 'company', { pace: 'standard' }, { pace: 'standard' });
  await accepted('1 setPace 衝刺不寫期限：接受（外殼用預設期限）', 'setPace', 'company', { pace: 'sprint' }, { pace: 'sprint' });
  await accepted('1 衝刺期限正好是今日、今日＋14：接受', 'setPace', 'company', { pace: 'sprint', sprintUntil: T }, { pace: 'sprint', sprintUntil: T });
  await accepted('1 衝刺期限今日＋14：接受', 'setPace', 'company', { pace: 'sprint', sprintUntil: localDay(14) }, { pace: 'sprint', sprintUntil: localDay(14) });
  await rejected('1 衝刺期限昨日：拒絕', 'setPace', 'company', { pace: 'sprint', sprintUntil: localDay(-1) });
  await rejected('1 衝刺期限今日＋15：拒絕', 'setPace', 'company', { pace: 'sprint', sprintUntil: localDay(15) });
  await rejected('1 衝刺期限不是真實日期：拒絕', 'setPace', 'company', { pace: 'sprint', sprintUntil: '2026-02-30' });
  await rejected('1 加速檔帶期限：拒絕', 'setPace', 'company', { pace: 'fast', sprintUntil: localDay(3) });
  await rejected('1 不存在的檔：拒絕', 'setPace', 'company', { pace: 'turbo' });
  await rejected('1 沒有檔：拒絕', 'setPace', 'company', {});
  await rejected('1 沒有 value：拒絕', 'setPace', 'company');
  await rejected('1 多餘欄位：拒絕', 'setPace', 'company', { pace: 'fast', fuse: 99 });
  await rejected('1 對象不是 company：拒絕', 'setPace', 'roles', { pace: 'fast' });
  await rejected('1 value 是陣列：拒絕', 'setPace', 'company', ['fast']);
  const r = await postA('/api/founder-op', { op: 'setPace', target: 'company', value: { pace: 'sprint', sprintUntil: 'x'.repeat(300) } });
  ok('1 超長字串：沿用既有 200 字上限拒絕', r.code === 400 && r.j.error === 'invalid');
});

await attempt('1 伺服器：暫停／恢復 Zero', async () => {
  resetState();
  await rejected('1 未暫停時恢復：拒絕', 'resumeZero', 'company', {});
  await accepted('1 pauseZero：接受（value 為空物件）', 'pauseZero', 'company', {}, {});
  await rejected('1 已有待套用的暫停：再暫停被拒', 'pauseZero', 'company', {});
  await accepted('1 待套用的暫停之後：可恢復', 'resumeZero', 'company');
  await rejected('1 待套用的恢復之後：再恢復被拒', 'resumeZero', 'company', {});
  await accepted('1 恢復之後：可再暫停', 'pauseZero', 'company', {});
  await rejected('1 pauseZero 帶欄位：拒絕', 'pauseZero', 'company', { reason: 'x' });
  await rejected('1 pauseZero 對象不是 company：拒絕', 'pauseZero', 'tm-a', {});
  resetState({ health: { pausedByFounder: true } });
  await rejected('1 帳本已暫停：再暫停被拒', 'pauseZero', 'company', {});
  await accepted('1 帳本已暫停：恢復接受', 'resumeZero', 'company', {}, {});
  await rejected('1 帳本已暫停、隊列已有恢復：再恢復被拒', 'resumeZero', 'company', {});
});

await attempt('1 伺服器：崗位暫停／恢復', async () => {
  resetState();
  await accepted('1 rolePause 啟用中的卡（不寫原因）：接受，value 為空物件', 'rolePause', 'tm-a', {}, {});
  await rejected('1 同一張卡已有待套用的暫停：再暫停被拒', 'rolePause', 'tm-a', {});
  await accepted('1 待套用的暫停之後：roleResume 接受', 'roleResume', 'tm-a');
  await rejected('1 待套用的恢復之後：再恢復被拒', 'roleResume', 'tm-a', {});
  await accepted('1 rolePause 待啟用的卡＋原因：接受，原因去空白', 'rolePause', 'tm-b', { reason: '  等創辦人回覆  ' }, { reason: '等創辦人回覆' });
  await rejected('1 暫停中的卡再暫停：拒絕', 'rolePause', 'tm-c', {});
  await rejected('1 已併入的卡暫停：拒絕', 'rolePause', 'tm-d', {});
  await rejected('1 已取消的卡暫停：拒絕', 'rolePause', 'tm-e', {});
  await rejected('1 不存在的卡暫停：拒絕', 'rolePause', 'tm-zzz', {});
  await rejected('1 原因 81 字：拒絕', 'rolePause', 'tm-a', { reason: '字'.repeat(81) });
  await rejected('1 原因不是字串：拒絕', 'rolePause', 'tm-a', { reason: 3 });
  await rejected('1 rolePause 多餘欄位：拒絕', 'rolePause', 'tm-a', { why: 'x' });
  await accepted('1 暫停中的卡：roleResume 接受', 'roleResume', 'tm-c', {}, {});
  await rejected('1 啟用中的卡恢復：拒絕', 'roleResume', 'tm-a', {});
  await rejected('1 已併入的卡恢復：拒絕', 'roleResume', 'tm-d', {});
  await rejected('1 不存在的卡恢復：拒絕', 'roleResume', 'tm-zzz', {});
  W(OPS_A, []);
  await accepted('1 原因剛好 80 字：接受', 'rolePause', 'tm-a', { reason: '字'.repeat(80) }, { reason: '字'.repeat(80) });
});

await attempt('1 伺服器：rolesSync', async () => {
  resetState();
  await accepted('1 rolesSync：概覽已確認、沒有崗位題、沒在擬崗位：接受', 'rolesSync', 'roles', {}, {});
  await rejected('1 已有待套用的重新擬崗位：再按被拒', 'rolesSync', 'roles', {});
  await rejected('1 對象不是 roles：拒絕', 'rolesSync', 'people', {});
  resetState({ intake: {} });
  await rejected('1 概覽未確認（沒有確認時間）：拒絕', 'rolesSync', 'roles', {});
  resetState({ ledgerFrom: '' });
  await rejected('1 帳本還沒有來自概覽的版本：拒絕', 'rolesSync', 'roles', {});
  resetState({ rolesSync: { requested: true } });
  await rejected('1 帳本已記「已要求」：拒絕', 'rolesSync', 'roles', {});
  resetState({ rolesSync: { pending: [{ title: '農場採購專員' }] } });
  await rejected('1 還有排隊未出的崗位卡（擬崗位進行中）：拒絕', 'rolesSync', 'roles', {});
  resetState();
  W(path.join(DA, 'asks', 'ask-roles1.json'), { id: 'ask-roles1', title: '確認 Zero 崗位', askedBy: 'AI', askedAt: new Date().toISOString(), todoType: 'decision', rolesSync: { key: 'k' }, questions: [{ id: 'q1', ask: '由 Zero 承擔「農場採購專員」？', kind: 'choice', value: '由 Zero 承擔', why: '測試', options: [{ text: '由 Zero 承擔', rec: true }] }] });
  await rejected('1 有未答的崗位確認題包：拒絕', 'rolesSync', 'roles', {});
  W(path.join(DA, 'ledger', 'answers', 'ask-roles1.json'), { answers: { q1: { value: '由 Zero 承擔' } } });
  await accepted('1 崗位題答完之後：接受', 'rolesSync', 'roles', {}, {});
  resetState({ rolesSync: { packId: 'ask-roles1' } });
  fs.rmSync(path.join(DA, 'ledger', 'answers', 'ask-roles1.json'), { force: true });
  await rejected('1 帳本記的最近一包崗位題仍未答完：拒絕', 'rolesSync', 'roles', {});
  fs.rmSync(path.join(DA, 'asks', 'ask-roles1.json'), { force: true });
});

await attempt('1 伺服器：示範實例與其他', async () => {
  resetState({ demo: true });
  for (const [o, t, v] of [['setPace', 'company', { pace: 'fast' }], ['pauseZero', 'company', {}], ['resumeZero', 'company', {}], ['rolePause', 'tm-a', {}], ['roleResume', 'tm-c', {}], ['rolesSync', 'roles', {}]]) {
    const r = await op(o, t, v);
    ok(`1 示範實例拒絕 ${o}`, r.code === 400 && r.j && r.j.ok === false && r.j.error === 'demo' && queue().length === 0, r);
  }
  resetState();
  const r1 = await op('snooze', 'no-such-item', { until: localDay(3) }), r2 = await postA('/api/founder-op', { op: 'rolePauseAll', target: 'company', value: {} });
  ok('1 不認識的 op 仍被拒；既有 op 的核對不受影響（snooze 不存在的項目 → 拒絕）', r2.code === 400 && r2.j.error === 'invalid' && r1.code === 400 && queue().length === 0, { r1, r2 });
  const r3 = await postA('/api/founder-op', { op: 'pauseZero', target: 'x'.repeat(130), value: {} });
  ok('1 對象超過 120 字：拒絕', r3.code === 400 && r3.j.error === 'invalid');
  // 既有 op 照舊可用：snooze 需要待決項，這裏用 peopleSync（概覽已確認 → 接受）
  W(OPS_A, []);
  const r4 = await op('peopleSync', 'people', {});
  ok('1 既有 op（peopleSync）仍可用，與新 op 同一隊列', r4.code === 202 && queue().length === 1 && queue()[0].op === 'peopleSync', r4);
  // 同一批連按多個不同 op：全部進同一個隊列，次序保留
  W(OPS_A, []); resetState();
  await op('pauseZero', 'company', {}); await op('setPace', 'company', { pace: 'fast' }); await op('rolePause', 'tm-a', { reason: '等' }); await op('rolesSync', 'roles', {});
  ok('1 四個不同的新 op 依次進隊列，次序保留', queue().map(x => x.op).join(',') === 'pauseZero,setPace,rolePause,rolesSync', queue().map(x => x.op));
});

await attempt('3 頭像', async () => {
  const kinds = ['lead', 'outreach', 'content', 'partner', 'procurement', 'compliance', 'marketing', 'finance', 'operations'];
  for (const k of kinds) {
    const r = await fetch(A.base + `/assets/crew-role-${k}.webp`), buf = Buffer.from(await r.arrayBuffer());
    ok(`3 /assets/crew-role-${k}.webp 送出 image/webp，內容與檔案相同`, r.status === 200 && r.headers.get('content-type') === 'image/webp' && buf.equals(fs.readFileSync(path.join(PROTO, 'assets', `crew-role-${k}.webp`))), { status: r.status, type: r.headers.get('content-type') });
  }
  const miss = await fetch(A.base + '/assets/crew-role-nonexistent.webp');
  ok('3 沒有的頭像：404', miss.status === 404);
  const bad = await Promise.all(['/assets/..%2Fserver.mjs', '/assets/crew-role-lead.png', '/assets/%2e%2e/server.mjs', '/assets/crew-role-lead.webp/../../server.mjs'].map(async p => { const r = await fetch(A.base + p); return { p, code: r.status, type: r.headers.get('content-type') }; }));
  ok('3 只送 crew-*.webp：路徑跳出或別的副檔名一律不送（404 或不是 webp／原始碼）', bad.every(x => x.code !== 200 || x.type === 'image/webp'), bad);
});

await attempt('4 更正連結比對來源 id', async () => {
  const PAGE = path.join(DA, 'company', 'page.json'), page0 = J(PAGE);
  const srcs = () => J(PAGE).sources;
  const setSources = list => { const p = J(PAGE); p.sources = list; W(PAGE, p); };
  setSources([{ id: 'src-1', title: '市場報告', url: 'https://example.org/old-1' }, { id: 'src-2', title: '市場報告', url: 'https://example.org/old-2' }, { id: 'src-3', url: 'https://example.org/old-3' }, { title: '舊來源沒有編號', url: 'https://example.org/old-4' }]);
  const url = n => `https://example.org/new-${n}`;
  const call = body => postA('/api/source-url', body);
  const stale = r => r.code === 409 && r.j && r.j.error === 'stale';
  let r = await call({ n: 1, id: 'src-1', title: '市場報告', url: url(1) });
  ok('4 同名兩項、id 對不上第 n 項：409 stale，頁面不變', stale(r) && srcs()[1].url === 'https://example.org/old-2' && srcs()[0].url === 'https://example.org/old-1', { r, s: srcs() });
  r = await call({ n: 1, id: 'src-2', title: '市場報告', url: url(2) });
  ok('4 id 與標題都對：寫入該項，另一同名項不動', r.code === 200 && r.j.ok && srcs()[1].url === url(2) && srcs()[0].url === 'https://example.org/old-1' && srcs()[1].urlBefore === 'https://example.org/old-2', { r, s: srcs() });
  r = await call({ n: 0, id: 'src-1', title: '另一個標題', url: url(3) });
  ok('4 id 對、標題不對：拒絕（兩者都要符合）', stale(r) && srcs()[0].url === 'https://example.org/old-1', r);
  r = await call({ n: 0, id: 'src-9', url: url(4) });
  ok('4 只帶不符的 id：拒絕', stale(r) && srcs()[0].url === 'https://example.org/old-1', r);
  r = await call({ n: 2, id: 'src-3', url: url(5) });
  ok('4 沒有標題的來源：憑 id 可更正（舊版因無標題不能更正）', r.code === 200 && r.j.ok && srcs()[2].url === url(5), { r, s: srcs() });
  r = await call({ n: 2, url: url(6) });
  ok('4 沒有標題的來源、請求也沒帶 id：仍拒絕（舊規則不變）', stale(r) && srcs()[2].url === url(5), r);
  r = await call({ n: 3, id: 'src-3', title: '舊來源沒有編號', url: url(7) });
  ok('4 請求帶 id 而目前這項沒有 id：視為頁面已變，拒絕', stale(r) && srcs()[3].url === 'https://example.org/old-4', r);
  r = await call({ n: 3, title: '舊來源沒有編號', url: url(8) });
  ok('4 舊請求只帶標題：照舊按標題核對並接受', r.code === 200 && r.j.ok && srcs()[3].url === url(8), { r, s: srcs() });
  r = await call({ n: 0, title: '市場報告', url: url(9) });
  ok('4 舊請求只帶標題、同名項取第 n 項（舊行為不變）', r.code === 200 && r.j.ok && srcs()[0].url === url(9), srcs());
  r = await call({ n: 0, title: '錯誤標題', url: url(10) });
  ok('4 舊請求標題不符：拒絕（舊行為不變）', stale(r) && srcs()[0].url === url(9), r);
  r = await call({ n: 1, id: 5, title: '市場報告', url: url(11) });
  ok('4 id 型別不對（數字）而與目前 id 不同：拒絕', stale(r), r);
  r = await call({ n: 1, id: { x: 1 }, title: '市場報告', url: url(12) });
  ok('4 id 是物件：拒絕', stale(r) && srcs()[1].url === url(2), r);
  setSources([{ id: 7, title: '數字編號', url: 'https://example.org/old-n' }]);
  r = await call({ n: 0, id: '7', title: '數字編號', url: url(13) });
  ok('4 頁面 id 是數字、請求帶同一個數字的字串：接受（按字串比對）', r.code === 200 && r.j.ok, r);
  r = await call({ n: 0, id: '', title: '數字編號', url: url(14) });
  ok('4 空字串 id 當沒有帶：按標題核對', r.code === 200 && r.j.ok, r);
  const bad = await call({ n: 0, id: '7', title: '數字編號', url: 'http://example.org/not-https' });
  ok('4 id 相符也不放寬網址規則：非 https 仍拒絕', bad.code === 400 && bad.j.error === 'invalid', bad);
  const ops = queue().filter(x => x.op === 'setSourceUrl');
  ok('4 成功的更正照舊進創辦人操作隊列（setSourceUrl，只記標題）', ops.length >= 3 && ops.every(x => x.target.startsWith('source-') && typeof x.value.title === 'string'), ops);
  W(PAGE, page0);
});

await stop(A);

/* =====================================================================
   2b 伺服器計時器：待套用的 setPace 叫外殼；登記標記的逾時跟檔
   ===================================================================== */
const hhmm = (addMin) => { const d = new Date(Date.now() + addMin * 60000); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const mkTick = (name, rhythm, markLimit, opsList) => {
  const data = mkData(path.join(OUT, name));
  W(path.join(data, 'ledger', 'state.json'), { schemaVersion: 1, runs: [], company: { rhythm: { runCadence: 'daily', runTime: hhmm(180), interviewWeekday: 1, runCapMinutes: 30, ...rhythm } } });
  W(path.join(data, 'ledger', 'schedule.json'), { mode: 'server', cadence: 'daily', runTime: hhmm(180), interviewWeekday: 1, limitMinutes: markLimit, approvedAt: new Date(Date.now() - 600000).toISOString(), autostart: { enabled: false, os: 'windows', name: 'crewzero-test' } });
  W(path.join(data, 'ledger', 'founder-ops.json'), opsList);
  fs.writeFileSync(path.join(data, 'ledger', '.lock'), String(process.pid));
  return data;
};
const KICK = '有新內容，交外殼處理';
const tickB = attempt('2 計時器（有 pace、待套用 setPace）', async () => {
  const data = mkTick('tick-b', { pace: 'sprint', sprintUntil: localDay(5) }, 45, [{ id: 'fo-test-b1', at: new Date().toISOString(), op: 'setPace', target: 'company', value: { pace: 'sprint' } }]);
  const B = startServer(data, PORT + 1);
  ok('2 計時器測試伺服器 B 起得來', await healthy(B.base));
  const markFile = path.join(data, 'ledger', 'schedule.json');
  const flipped = await waitFor(() => { try { return J(markFile).limitMinutes === 240; } catch { return false; } }, 60000, 500);
  const kicked = await waitFor(() => B.log.text.includes(KICK), 5000, 300);
  const mk = J(markFile);
  ok('2 帳本已是衝刺：下一次計時器把登記標記的逾時由 45 改成 240', flipped, mk);
  ok('2 其餘標記欄位原樣保留（模式、批准時間、登入啟動）', mk.mode === 'server' && mk.autostart && mk.autostart.enabled === false && mk.autostart.name === 'crewzero-test' && mk.cadence === 'daily' && !!mk.approvedAt, mk);
  ok('2 隊列裏有待套用的 setPace：計時器叫外殼先合併（與 setRhythm 同一做法）', kicked, B.log.text.slice(-400));
  await stop(B);
});
const tickC = attempt('2 計時器（舊資料沒有 pace、待套用 setRhythm）', async () => {
  const data = mkTick('tick-c', {}, 123, [{ id: 'fo-test-c1', at: new Date().toISOString(), op: 'setRhythm', value: { runCadence: 'daily', runTime: hhmm(200), interviewWeekday: 1 } }]);
  const C = startServer(data, PORT + 2);
  ok('2 計時器測試伺服器 C 起得來', await healthy(C.base));
  const kicked = await waitFor(() => C.log.text.includes(KICK), 60000, 500);
  const mk = J(path.join(data, 'ledger', 'schedule.json'));
  ok('2 舊資料沒有 pace：登記標記的逾時不被改動（保持舊公式的結果）', mk.limitMinutes === 123, mk);
  ok('2 待套用的 setRhythm 仍照舊叫外殼', kicked, C.log.text.slice(-400));
  await stop(C);
});

/* =====================================================================
   7 首頁輕量端點：只交付卡、不觀測，仍受同一通行證保護
   ===================================================================== */
await attempt('7 首頁輕量交付端點', async () => {
  const data = mkData(path.join(OUT, 'lite'));
  oldInstall(data, PROTO);
  const page = J(path.join(data, 'company', 'page.json'));
  const at = new Date().toISOString(), day = localDay(), observedInput = path.join(data, 'fake-observe-input.json');
  W(path.join(data, 'ledger', 'state.json'), {
    schemaVersion: 1, ledgerFrom: page.page.id, intake: { state: 'complete', confirmedAt: at },
    company: { name: '輕量測試公司', rhythm: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1, pace: 'standard' } },
    observe: { folders: [{ hash: 'a'.repeat(64), name: '測試觀測資料夾' }] },
    milestones: [{ id: 'm-lite', short: '首輪合作' }], teammates: [{ id: 'tm-lite', title: '餐廳拓展經理', lifecycle: 'enabled' }],
    tasks: [{ id: 'task-lite', title: '跟進餐廳', artifactTitle: '餐廳交付', status: 'done', milestoneId: 'm-lite', teammateId: 'tm-lite', packId: 'ask-lite' }],
    runs: [{ id: 'R-lite', startedAt: at, endedAt: at, workDay: day, state: 'ended', ending: 'artifact', aiStarted: true, items: [{ taskId: 'task-lite', teammateId: 'tm-lite', ending: 'artifact', endedAt: at, qa: { audience: 'external', verdict: 'pass', line: '核對無誤' } }] }], events: []
  });
  W(path.join(data, 'asks', 'ask-lite.json'), { id: 'ask-lite', title: '驗收餐廳交付', askedAt: at, todoType: 'acceptance', questions: [{ id: 'q1', ask: '接受交付？', options: [{ text: '接受' }] }] });
  W(path.join(data, 'fake-observe.json'), { sessions: [] });
  const S = startServer(data, PORT + 4, { SOS_OBSERVER: path.join(HERE, '..', 'dashboard', 'fake-observe.mjs') });
  ok('7 輕量端點測試伺服器起得來', await healthy(S.base), S.log.text.slice(0, 400));
  await usePass(S.base);
  const liteResponse = await fetch(S.base + '/api/dashboard?lite=1'), lite = await liteResponse.json();
  ok('7 lite 只回 ok 與 deliveries，且不觸發觀測程序', liteResponse.status === 200 && JSON.stringify(Object.keys(lite).sort()) === JSON.stringify(['deliveries', 'ok']) && !fs.existsSync(observedInput), { status: liteResponse.status, keys: Object.keys(lite), observed: fs.existsSync(observedInput) });
  const fullResponse = await fetch(S.base + '/api/dashboard'), full = await fullResponse.json();
  ok('7 有崗位交付時 lite 與完整監察台的 deliveries 深度相同；完整端點仍會觀測', fullResponse.status === 200 && JSON.stringify(lite.deliveries) === JSON.stringify(full.deliveries) && fs.existsSync(observedInput), { same: JSON.stringify(lite.deliveries) === JSON.stringify(full.deliveries), observed: fs.existsSync(observedInput) });
  forgetPass(S.base);
  const denied = await fetch(S.base + '/api/dashboard?lite=1');
  ok('7 未配對時 lite 與完整端點同樣拒絕', denied.status === 403);
  await stop(S);
});

/* =====================================================================
   5b 伺服器開機：轉換途中重啟留下的附件
   ===================================================================== */
await attempt('5 伺服器開機歸位', async () => {
  const data = mkData(path.join(OUT, 'rehome'));
  oldInstall(data, PROTO);
  W(path.join(data, 'ledger', 'state.json'), baseState());
  const inbox = path.join(data, 'founder', 'inbox'), dest = path.join(data, 'archive', 'interrupted-uploads');
  const id1 = '20261108-110000-001', id2 = '20261108-110100-002';
  const orphans = { [id1 + '-intake-01-報價.docx']: 'ORIGINAL-INTAKE-DOCX', [id1 + '-intake-01-報價.docx.md']: '# half written', [id1 + '-meta-intake.json']: '{"fileInfo":[]}',
    [id2 + '-note-event-file-01-會議.docx']: 'ORIGINAL-EVENT-DOCX', [id2 + '-note-event-file-01-會議.docx.md']: '# text', [id2 + '-note-event-meta.json']: '{"fileInfo":[]}' };
  for (const [n, c] of Object.entries(orphans)) fs.writeFileSync(path.join(inbox, n), c);
  const names = Object.keys(orphans);
  // 外殼仍在工作（鎖檔有活著的程序）：不碰收件匣，監察台照舊把它們算作待處理 —— 這就是修正前的情況
  fs.writeFileSync(path.join(data, 'ledger', '.lock'), String(process.pid));
  let S = startServer(data, PORT + 3);
  ok('5 開機測試伺服器起得來', await healthy(S.base)); await usePass(S.base);
  const dash = async () => { const r = await fetch(S.base + '/api/dashboard'); return r.json(); };
  let d = await dash(), listed = ((d.inputs || {}).unprocessed || []).map(x => x.id);
  ok('5 對照：外殼仍在工作時不搬，交資料的附件、文字版、說明檔全部被算作待處理（修正前的現象）', names.filter(n => n.startsWith(id1)).every(n => listed.includes(n)) && names.every(n => fs.existsSync(path.join(inbox, n))) && !fs.existsSync(dest), { listed });
  await stop(S); forgetPass(S.base);
  fs.rmSync(path.join(data, 'ledger', '.lock'), { force: true });
  S = startServer(data, PORT + 3);
  ok('5 重啟（外殼沒有在工作）：伺服器起得來', await healthy(S.base)); await usePass(S.base);
  d = await dash(); listed = ((d.inputs || {}).unprocessed || []).map(x => x.id);
  ok('5 開機時六個沒有主檔的檔全部搬離收件匣', names.every(n => !fs.existsSync(path.join(inbox, n))), fs.readdirSync(inbox));
  ok('5 搬到 archive/interrupted-uploads/，內容逐位元組相同（原檔沒被刪、沒被改）', names.every(n => fs.existsSync(path.join(dest, n)) && fs.readFileSync(path.join(dest, n), 'utf8') === orphans[n]), fs.existsSync(dest) ? fs.readdirSync(dest) : 'no dest');
  ok('5 監察台不再把它們算作待處理（附件與文字版各一項的重複計算消失）', names.every(n => !listed.includes(n)) && listed.length === 0, listed);
  ok('5 伺服器說明了搬走的數量', /6 個上次中斷的附件/.test(S.log.text), S.log.text.slice(0, 500));
  await stop(S);
  // 有主檔的一組照舊留在原處（下一次開機仍不碰）
  const keepId = '20261108-110200-003';
  fs.writeFileSync(path.join(inbox, keepId + '-note-event-file-01-x.docx'), 'KEEP'); fs.writeFileSync(path.join(inbox, keepId + '-note-event.md'), 'kind: note\ntype: event\nat: 2026-11-08T11:02:00+08:00\n\n測試\n');
  fs.writeFileSync(path.join(data, 'ledger', '.lock'), String(process.pid));
  S = startServer(data, PORT + 3);
  ok('5 第三次開機起得來', await healthy(S.base));
  ok('5 有主檔的附件不被搬走', fs.existsSync(path.join(inbox, keepId + '-note-event-file-01-x.docx')) && fs.existsSync(path.join(inbox, keepId + '-note-event.md')));
  await stop(S);
});

/* =====================================================================
   6 隊列讀取次序：伺服器核對與外殼合併（改名 → 套用 → 存檔 → 刪批次檔）之間的窗口（確定性模擬，不靠計時）
   讀取次序固定為 founder-ops.json → 批次檔 → state.json；剛排隊的暫停在任何交錯下都看得見，合法的「恢復 Zero」不會被當作「未暫停」拒絕
   ===================================================================== */
await attempt('6 隊列讀取次序', async () => {
  const dl = await imp('dash-lib.mjs');
  const root = path.join(OUT, 'race'), led = path.join(root, 'ledger'), DIRX = { ledger: led };
  const STATE = path.join(led, 'state.json'), Q = path.join(led, 'founder-ops.json');
  const pauseOp = { id: 'fo-pause', at: '2026-11-08T10:00:00+08:00', op: 'pauseZero', target: 'company', value: {} };
  const reset = () => { fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(led, { recursive: true }); W(STATE, { founderOpsDone: [], health: {} }); W(Q, [pauseOp]); };
  // 外殼合併的檔案動作次序（run.mjs mergeFounderOps）：改名、套用並存檔、刪批次檔
  const shellRename = () => { const staged = path.join(led, '.founder-ops-1-' + Date.now() + '.json'); fs.renameSync(Q, staged); return staged; };
  const shellApply = staged => { const ops = J(staged), s = J(STATE), n = pace.applyPaceOps(s, ops, {}); n.founderOpsDone = ops.map(o => o.id); W(STATE, n); };
  const shellDelete = staged => fs.rmSync(staged, { force: true });
  const resumeOk = ({ state, pending }) => lops.checkRolesOp('resumeZero', 'company', {}, state, { pending, today: '2026-11-08' }).ok;
  const origReaddir = fs.readdirSync;
  const withHook = (fn, run) => { fs.readdirSync = (...a) => { fn(); return origReaddir(...a); }; try { return run(); } finally { fs.readdirSync = origReaddir; } };
  reset();
  ok('6 無交錯：已排隊暫停 → 恢復被接受；再暫停被拒', resumeOk(dl.readFounderOpsSnapshot(DIRX)) && !lops.checkRolesOp('pauseZero', 'company', {}, dl.readFounderOpsSnapshot(DIRX).state, { pending: dl.readFounderOpsSnapshot(DIRX).pending, today: '2026-11-08' }).ok);
  // 交錯 1：讀完 founder-ops.json 後，外殼把整個合併做完（改名、套用、存檔、刪批次）再輪到讀 state
  reset(); let n1 = 0;
  const s1 = withHook(() => { if (!n1++) { const st = shellRename(); shellApply(st); shellDelete(st); } }, () => dl.readFounderOpsSnapshot(DIRX));
  ok('6 交錯 1（隊列讀完後外殼合併完畢）：暫停已在 state，合法恢復被接受，同一操作不重複套用', n1 === 1 && s1.state.founderOpsDone.includes('fo-pause') && s1.pending.length === 0 && resumeOk(s1), { n1, pending: s1.pending, done: s1.state.founderOpsDone });
  // 交錯 2：讀完 founder-ops.json 後、列資料夾時外殼剛改名（批次檔出現），之後才套用存檔
  reset(); let n2 = 0, staged2 = '';
  const s2 = withHook(() => { if (!n2++) staged2 = shellRename(); }, () => dl.readFounderOpsSnapshot(DIRX));
  shellApply(staged2); shellDelete(staged2);
  ok('6 交錯 2（列資料夾時外殼剛改名）：暫停只算一次，合法恢復被接受', s2.pending.length === 1 && s2.pending[0].id === 'fo-pause' && resumeOk(s2), s2.pending);
  // 交錯 3：改名、套用、存檔都完成，批次檔尚未刪（隊列檔空、批次檔與 state 同時有同一操作）
  reset(); let n3 = 0;
  const s3 = withHook(() => { if (!n3++) { const st = shellRename(); shellApply(st); } }, () => dl.readFounderOpsSnapshot(DIRX));
  ok('6 交錯 3（已存檔、批次檔未刪）：按 founderOpsDone 去重，不重播，暫停已生效', s3.pending.length === 0 && s3.state.founderOpsDone.includes('fo-pause') && resumeOk(s3), s3.pending);
  // 交錯 4（窄覆核 N3）：外殼已改名、未存檔（或改名後當掉）——隊列檔不在、只有批次檔；批次檔名規則必須配得到真實檔名
  reset(); const staged4 = shellRename();
  const s4 = dl.readFounderOpsSnapshot(DIRX);
  ok('6 交錯 4（只有批次檔、未存檔）：批次檔被讀到，暫停算一次，合法恢復被接受', fs.existsSync(staged4) && !fs.existsSync(Q) && s4.pending.length === 1 && s4.pending[0].id === 'fo-pause' && resumeOk(s4) && dl.pendingFounderOps(DIRX, J(STATE)).length === 1, { staged: path.basename(staged4), pending: s4.pending });
  // 同一份舊讀法對照：先讀 state 再讀隊列（修正前的次序）在交錯 1 下漏看暫停，證明這個模擬確實能分辨新舊次序
  reset(); const stOld = J(STATE); { const st = shellRename(); shellApply(st); shellDelete(st); }
  ok('6 對照：舊次序（先讀 state 後讀隊列）在交錯 1 下漏看暫停 → 恢復被拒（模擬有鑑別力）', !resumeOk({ state: stOld, pending: dl.pendingFounderOps(DIRX, stOld) }));
  // 批次檔與隊列檔內相同 id 只算一次；未知形狀的內容略過
  reset(); fs.writeFileSync(path.join(led, '.founder-ops-1-' + Date.now() + '.json'), JSON.stringify([pauseOp, 5, null]));
  ok('6 同一操作 id 在隊列檔與批次檔各出現一次只算一次', dl.readFounderOpsSnapshot(DIRX).pending.length === 1);
  // 排程器也必須用同一快照：隊列先讀後外殼即完成合併時，新次序可見「已套用」；舊次序同時看不到舊 state 與隊列，會漏掉剛提交的節奏操作。
  for (const op of [{ id: 'fo-pace', at: '2026-11-08T10:00:00+08:00', op: 'setPace', target: 'company', value: { pace: 'fast' } }, { id: 'fo-rhythm', at: '2026-11-08T10:00:00+08:00', op: 'setRhythm', target: 'company', value: { runCadence: 'daily', runTime: '21:00', interviewWeekday: 1 } }]) {
    fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(led, { recursive: true }); W(STATE, { founderOpsDone: [], health: {} }); W(Q, [op]);
    let reads = 0;
    const fresh = withHook(() => { if (!reads++) { const staged = shellRename(); shellApply(staged); shellDelete(staged); } }, () => dl.readFounderOpsSnapshot(DIRX));
    fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(led, { recursive: true }); W(STATE, { founderOpsDone: [], health: {} }); W(Q, [op]);
    const staleState = J(STATE); { const staged = shellRename(); shellApply(staged); shellDelete(staged); }
    const oldMisses = !staleState.founderOpsDone.includes(op.id) && !dl.pendingFounderOps(DIRX, staleState).some(item => item && item.id === op.id);
    const freshSees = fresh.state.founderOpsDone.includes(op.id) || fresh.pending.some(item => item && item.id === op.id);
    ok(`6 排程讀取次序：${op.op} 在確定性交錯下不會漏掉；舊次序會漏`, reads === 1 && freshSees && oldMisses, { reads, freshDone: fresh.state.founderOpsDone, freshPending: fresh.pending.map(item => item.id), oldMisses });
  }
  fs.rmSync(root, { recursive: true, force: true });
});

await tickB; await tickC;

for (const s of servers) { try { s.kill(); } catch { } }
await sleep(300);
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
