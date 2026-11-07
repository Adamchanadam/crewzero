// 人物及機構名單後台整合測試（0.40.0）：每週訪問十四日題、創辦人改正經操作隊列合併進帳本、示範帳本拒絕、邊界（聯絡方式拒絕）、
// 舊帳本（kind 為「客戶」「供應」，沒有新欄）照常讀、G6 給 Zero 的背景由名單生成。假 AI、隔離資料夾；不開瀏覽器、不連外網。
// 用法：node people-backend-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true });
const DATA = path.join(OUT, 'data');
for (const d of ['company', 'ledger']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
oldInstall(DATA, PROTO);
const STATE = path.join(DATA, 'ledger', 'state.json');
const state = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const put = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
const localDay = (add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const env = { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 60000 });
const packs = () => { const d = path.join(DATA, 'asks'); try { return fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))); } catch { return []; } };
const BASE = `http://127.0.0.1:${PORT}`;
let srv = null, log = '';
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const waitFor = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; };

try {
  // 先跑一次外殼，把公司概覽同步成帳本（站、假設、名單）
  shell('--type', 'rhythm', '--trigger', 'manual');
  let s = state();
  // 夾具的公司概覽沒有名單：直接放兩個舊格式對象（kind 為「客戶」「供應」，沒有別名、狀態、加入日期等新欄）
  s.company.actors = [{ id: 'pr-a1', name: '甲餐廳陳經理', label: '甲餐廳陳經理', kind: '客戶', fromMilestoneIds: [] }, { id: 'pr-a2', name: '丙農場主', label: '丙農場主', kind: '供應', fromMilestoneIds: [] }, { id: 'pr-a3', name: '丁公司李小姐', label: '丁公司李小姐', kind: '客戶', fromMilestoneIds: [] }];
  put(s);
  const dashOld = await (async () => { srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env, stdio: ['ignore', 'pipe', 'pipe'] }); srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; }); await usePass(BASE); await waitFor(async () => { try { return (await (await fetch(BASE + '/api/health')).json()).ok; } catch { return false; } }, 15000); return waitFor(async () => { const r = await fetch(BASE + '/api/dashboard'); return r.ok ? r.json() : null; }, 15000); })();
  ok('舊帳本（舊 kind 字串、沒有新欄）：監察台照常讀取，不報錯', !!dashOld && !dashOld.error, dashOld && Object.keys(dashOld).slice(0, 5));
  shell('--type', 'rhythm', '--trigger', 'manual');
  s = state();
  ok('舊帳本下次同步：kind 換成新代碼並補欄位，名稱與編號不變', s.company.actors.every(a => ['customer', 'partner', 'investor', 'advisor', 'team'].includes(a.kind) && a.status === 'active' && Array.isArray(a.aliases) && a.addedAt) && s.company.actors.length > 0, s.company.actors.map(a => a.kind));

  /* ---- 十四日跟進題 ---- */
  s = state();
  const target = s.company.actors.find(a => a.kind !== 'team');
  target.addedAt = localDay(-30); target.status = 'active';
  s.company.actors.forEach(a => { if (a.id !== target.id) a.addedAt = localDay(-1); });
  s.inputs = []; s.events = (s.events || []).filter(e => e.actor !== 'founder');
  s.interviews = { ...(s.interviews || {}), nextOn: localDay(0), packFor: '', packId: '', contactSnooze: {} };
  put(s);
  for (const f of fs.readdirSync(path.join(DATA, 'asks'))) fs.rmSync(path.join(DATA, 'asks', f), { force: true });
  shell('--type', 'rhythm', '--trigger', 'manual');
  const iv = packs().find(p => p.rhythm && p.rhythm.kind === 'interview');
  const cq = iv && iv.questions.filter(q => q.bind === 'contact');
  ok('十四日題：超過十四日沒有接觸的對象，每週訪問加一題（且只一題），問「下一步是？」', iv && cq.length === 1 && cq[0].contact.id === target.id && new RegExp(target.name + '已 3\\d 日沒有接觸，下一步是？').test(cq[0].ask), cq && cq.map(q => q.ask));
  ok('十四日題：三個選項（一星期內聯絡／暫時維持／不再接觸），推薦第一個；說明「加入名單後還沒有接觸」', cq && cq[0].options.map(o => o.text).join('|') === [N.t('contactYes', { n: target.name }), N.ui.contactSnooze, N.ui.contactClose].join('|') && cq[0].options[0].rec && /加入名單後還沒有接觸/.test(cq[0].why), cq && cq[0]);
  { const hits = (cq || []).flatMap(q => [q.ask, q.why, ...q.options.map(o => o.text)]).flatMap(t => N.styleIssues(String(t)).map(h => h.term)); ok('十四日題畫面文字零內部術語、零編號', !hits.length, hits); }
  // 暫時維持 → 兩星期內不再問
  const answerIv = async (pickIdx) => {
    const P = packs().find(p => p.rhythm && p.rhythm.kind === 'interview'), lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
    const answers = P.questions.map(q => ({ id: q.id, value: q.bind === 'contact' ? q.options[pickIdx].text : q.value, ai: q.value, changed: false }));
    const machine = { format: 'startup-os.ask-reply/0.1', pack: P.id, confirmedAt: lib.localIso(), batch: P.questions.map(q => q.id), answers };
    const head = ['kind: ask-answer', 'ref: ' + P.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(P)), 'batch: false', 'shownAt: ' + lib.localIso()];
    const r = await post('/api/submit', { kind: 'ask-answer', ref: P.id, text: head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
    await sleep(3500); shell('--type', 'rhythm', '--trigger', 'manual');
    return { r, P };
  };
  const a1 = await answerIv(1);
  s = state();
  ok('答「暫時維持」：兩星期後再問（contactSnooze），對象仍在名單、沒有新工作', a1.r.code === 200 && s.interviews.contactSnooze && s.interviews.contactSnooze[target.id] === localDay(14) && !(s.tasks || []).some(t => t.prospectId === target.id), s.interviews);

  /* ---- 創辦人改正經操作隊列，外殼合併進帳本 ---- */
  const opPost = (op, tgt, value) => post('/api/founder-op', { op, target: tgt, value });
  const other = s.company.actors.find(a => a.id !== target.id && a.kind !== 'team');
  const r1 = await opPost('actorRename', target.id, { name: '陳總監' });
  ok('改名：接受', r1.code === 202, r1);
  const r2 = await opPost('actorRename', target.id, { name: '電話91234567' });
  ok('邊界：名稱含八位以上數字（聯絡方式）一律拒絕', r2.code === 400 && r2.j.message === N.ui.pbErr_contactInfo, r2);
  const r3 = await opPost('actorRename', target.id, { name: 'a@b.com' });
  ok('邊界：名稱含電郵一律拒絕', r3.code === 400, r3.j);
  const r4 = await opPost('actorRename', target.id, { name: other.name });
  ok('改名為另一個對象已用的名稱：拒絕並提示改用合併', r4.code === 400 && r4.j.message === N.ui.pbErr_duplicateName, r4.j);
  const r5 = await opPost('actorRename', 'pc-not-exist', { name: '誰' });
  ok('不存在的對象：拒絕，沒有刪除對象的操作', r5.code === 400 && r5.j.message === N.ui.pbErr_notFound, r5.j);
  const r6 = await opPost('actorDelete', target.id, {});
  ok('沒有「刪除」操作：未知操作拒絕', r6.code === 400, r6.j);
  const r7 = await opPost('actorRename', target.id, { name: '陳總監', phone: '12345678' });
  ok('邊界：多出的欄位（電話等）整個操作拒絕', r7.code === 400, r7.j);
  const r8 = await opPost('actorMerge', target.id, { into: target.id });
  ok('不能併入自己', r8.code === 400 && r8.j.message === N.ui.pbErr_self, r8.j);
  const r9 = await opPost('actorStatus', other.id, { status: 'inactive' });
  const r10 = await opPost('actorMerge', target.id, { into: other.id });
  ok('不再接觸之後，併入該對象仍可（只有合併自己、已併者才拒絕）', r9.code === 202 && r10.code === 202, [r9.code, r10.code]);
  shell('--type', 'rhythm', '--trigger', 'manual');
  s = state();
  const tgt = s.company.actors.find(a => a.id === target.id), oth = s.company.actors.find(a => a.id === other.id);
  ok('外殼合併：改名換了 name 並把舊名放入別名；不再接觸寫入狀態；合併設 mergedInto 並把名字併入保留者別名；全部對象仍在名單（永不刪除）', tgt && tgt.mergedInto === other.id && oth.status === 'inactive' && oth.aliases.includes('陳總監') && s.company.actors.length === s.company.actors.length && s.company.actors.some(a => a.id === target.id), { tgt, oth });
  ok('改正的帳本事件標題帶名稱（改名、合併、不再接觸），不是「取消暫停」', (s.events || []).filter(e => e.type === 'founder-op').map(e => e.title).every(t => !/取消暫停/.test(t)) && (s.events || []).some(e => e.title === N.t('actorRenamed', { a: target.name, b: '陳總監' })) && (s.events || []).some(e => e.title === N.t('actorMerged', { a: target.name, b: other.name })) && (s.events || []).some(e => e.title === N.t('actorClosed', { n: other.name })), (s.events || []).filter(e => e.type === 'founder-op').map(e => e.title));
  // 已併走的對象不再被十四日題問
  s = state(); s.interviews.contactSnooze = {}; s.interviews.packFor = ''; put(s);
  for (const f of fs.readdirSync(path.join(DATA, 'asks'))) { const pk = JSON.parse(fs.readFileSync(path.join(DATA, 'asks', f), 'utf8')); if (pk.rhythm && pk.rhythm.kind === 'interview') fs.rmSync(path.join(DATA, 'asks', f), { force: true }); }
  s = state(); delete s.interviews.packId; put(s);
  shell('--type', 'rhythm', '--trigger', 'manual');
  const iv2 = packs().find(p => p.rhythm && p.rhythm.kind === 'interview');
  ok('已被併走或不再接觸的對象不出十四日題', !iv2 || !iv2.questions.some(q => q.bind === 'contact' && [target.id, other.id].includes(q.contact.id)), iv2 && iv2.questions.filter(q => q.bind === 'contact'));

  /* ---- 團隊與 G6 ---- */
  s = state();
  const free = s.company.actors.find(a => a.kind !== 'team' && !a.mergedInto && a.status === 'active');
  const msId = (s.milestones || [])[0].id;
  s.company.actors.push({ id: 'tm-t1', name: '林師傅', label: '林師傅', kind: 'team', role: '送貨', aliases: [], status: 'active', addedFrom: 'event', addedAt: localDay(-1), fromMilestoneIds: [], team: { type: 'parttime', state: 'active', owns: [msId] } });
  put(s);
  const sb = path.join(OUT, 'sb'); fs.mkdirSync(sb, { recursive: true });
  const r11 = await opPost('actorTeam', 'tm-t1', { team: { state: 'paused', junk: 'x' } });
  const r12 = await opPost('actorTeam', free.id, { team: { state: 'left' } });
  ok('成員狀態：成員可改；非成員拒絕', r11.code === 202 && r12.code === 400 && r12.j.message === N.ui.pbErr_notTeam, [r11.code, r12.code]);
  const r13 = await opPost('taskOwner', 'no-such-task', { owner: 'tm-t1' });
  ok('工作負責人：任務不存在拒絕', r13.code === 400, r13.j);
  shell('--type', 'rhythm', '--trigger', 'manual');
  s = state();
  ok('actorTeam：只改 type／state／owns，多出的欄位不入帳', s.company.actors.find(a => a.id === 'tm-t1').team.state === 'paused' && !('junk' in s.company.actors.find(a => a.id === 'tm-t1').team), s.company.actors.find(a => a.id === 'tm-t1'));
  // G6 給 Zero 的背景：有在職或暫停成員時由名單生成；全部離開則回到公司概覽原文
  const md = id => { const dirs = fs.readdirSync(path.join(DATA, 'sandbox')); return dirs.map(d => path.join(DATA, 'sandbox', d, 'confirmed-page.md')).filter(f => fs.existsSync(f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]; };
  // 以 ask 一個臨時工作觸發沙盒寫入 confirmed-page.md
  await post('/api/intake', { kind: 'note', type: 'adhoc', text: '請整理一頁簡介。' });
  const sbFile = await waitFor(async () => md(), 30000);
  const text = sbFile ? fs.readFileSync(sbFile, 'utf8') : '';
  ok('G6：有成員時給 Zero 的公司概覽背景由名單生成（名稱、角色、分工），不含編號', /林師傅（送貨）/.test(text) && /暫停中/.test(text) && !/tm-t1/.test(text), text.split(/\r?\n/).filter(l => /負責人/.test(l)));

  /* ---- 工作負責人：taskOwner（只可交給在職成員或創辦人） ---- */
  s = state(); s.tasks = (s.tasks || []).concat([{ id: 'tk-own1', title: '送樣本', owner: 'founder', status: 'planned', dueAt: localDay(3), updatedAt: '' }]);
  s.company.actors.find(a => a.id === 'tm-t1').team.state = 'active'; put(s);
  const o1 = await opPost('taskOwner', 'tk-own1', { owner: 'tm-t1' }), o2 = await opPost('taskOwner', 'tk-own1', { owner: free.id }), o3 = await opPost('taskOwner', 'tk-own1', { owner: 'ai-x' });
  ok('taskOwner：在職成員可接手；非成員、不存在的對象拒絕', o1.code === 202 && o2.code === 400 && o2.j.message === N.ui.pbErr_invalidOwner && o3.code === 400, [o1.code, o2.code, o3.code]);
  shell('--type', 'rhythm', '--trigger', 'manual');
  ok('taskOwner 外殼合併：工作 owner 換成成員編號，日期、標題、狀態不變', (() => { const t = state().tasks.find(x => x.id === 'tk-own1'); return t && t.owner === 'tm-t1' && t.title === '送樣本' && t.dueAt === localDay(3) && t.status === 'planned'; })());
  const lf = await opPost('actorTeam', 'tm-t1', { team: { state: 'left' } });
  shell('--type', 'rhythm', '--trigger', 'manual');
  ok('成員離開：工作 owner 不改寫（畫面才標「負責人已離開」）；離開者不可再接手工作', lf.code === 202 && state().tasks.find(x => x.id === 'tk-own1').owner === 'tm-t1' && (await opPost('taskOwner', 'tk-own1', { owner: 'tm-t1' })).code === 400);
  /* ---- ask.mjs --brief 名單段：有名稱、類別、最近接觸、團隊；不印編號、電話、電郵 ---- */
  s = state(); s.company.actors.find(a => a.id === 'tm-t1').team.state = 'active'; s.company.actors.find(a => a.id === 'tm-t1').role = '送貨 9123 4567'; s.company.actors.find(a => a.id === free.id).org = '聯絡 x@y.com'; s.company.actors.find(a => a.id === free.id).addedAt = localDay(-40); put(s);
  const brief = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--brief'], { cwd: PROTO, env, encoding: 'utf8', timeout: 60000 }).stdout;
  ok('--brief 名單段：列出外部對象（含類別名稱）與團隊成員，已不再接觸或已併走的不列', new RegExp(N.dash.ppl_kind_customer + '：').test(brief) && brief.includes(free.name) && /團隊成員：林師傅/.test(brief) && !brief.includes(other.name), brief);
  ok('--brief 名單段：不印編號、電話、電郵', !/pr-a\d|tm-t1|pc-/.test(brief) && !/9123|91234567/.test(brief) && !/@/.test(brief), brief);
  /* ---- 示範帳本：所有改正拒絕 ---- */
  s = state(); s.demo = true; put(s);
  const rd = await opPost('actorRename', target.id, { name: '示範改名' });
  ok('示範帳本：名單改正一律拒絕（沿用示範拒絕字句）', rd.code === 400 && rd.j.message === N.ui.founderDemoDenied, rd.j);
} catch (e) {
  ok('測試程式出錯', false, String(e && e.stack || e));
} finally {
  if (srv) srv.kill();
  const pass = results.filter(r => r.pass).length;
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  fs.writeFileSync(path.join(OUT, 'server.log'), log);
  process.exit(pass === results.length ? 0 : 1);
}
