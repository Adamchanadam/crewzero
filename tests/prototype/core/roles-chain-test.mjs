// 0.41.0 Zero 團隊端到端鏈測試：五條線各自通過的接縫，在這裏用「假 AI + 真實伺服器 + 無頭 Chrome」從頭走一遍。
// 鏈 A（題目）：外殼 run.mjs 出崗位確認包 → 真實伺服器 → ask.html 畫面 → 創辦人在畫面作答（真的 POST /api/submit）→ 外殼套用。
// 鏈 B（交付）：外殼寫收據及 runs → 伺服器 /api/dashboard（dash-lib）→ 首頁 #deliveries、監察台團隊頁，核對與帳本一致。
// 一家虛構公司（舊安裝夾具「從田間到餐桌」，已確認概覽）；只用假 AI（tests/prototype/lib/roles-fake-ai.mjs）；不讀不寫真實資料。
// 步驟：1 夾具 2 擬崗位 3 畫面 4 作答 5 啟用任務＋統籌校對 6 驗收 7 退回 8 校對失敗 9 衝刺＋看板一致 10 暫停 Zero 11 舊資料。
// 用法：node roles-chain-test.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter（不使用）> <起始埠>（用 port 至 port+2）
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { writeAdapters } from '../lib/adapters.mjs';
import { certifyDirect, usePass, forgetPass, passCookie } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, , PORT_ARG] = process.argv.slice(2);
const PORT = Number(PORT_ARG || 7600), BASE = 'http://127.0.0.1:' + PORT, BASE2 = 'http://127.0.0.1:' + (PORT + 2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = f => import(pathToFileURL(path.join(PROTO, f)).href);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await imp('ask-lib.mjs'), R = await imp('roles-ops.mjs'), PACE = await imp('pace-lib.mjs'), P = await imp('people-ops.mjs'), brain = await imp('brain-lib.mjs');
const results = []; const ok = (n, p, i) => { results.push({ name: n, pass: !!p, info: p ? undefined : i }); console.log((p ? 'PASS ' : 'FAIL ') + n + (p ? '' : '\n      ' + String(JSON.stringify(i ?? '')).slice(0, 700))); };
const skip = (n, why) => ok(n, false, '略過：' + why);
const STOP = Number(process.env.CHAIN_STOP || 99);   // 除錯用：只跑到第 N 步
const attempt = async (name, fn) => { const n = parseInt(name, 10); if (n > STOP) return; try { await fn(); } catch (e) {
  // 出錯時附上錯誤原因及主伺服器狀態（是否仍在運行、最後輸出），方便查明連線失敗
  const srv = typeof S !== 'undefined' && S.srv, cause = e && e.cause ? '\n原因：' + String(e.cause.code || e.cause.message || e.cause) : '';
  ok(name + '（執行出錯）', false, String(e && e.stack || e).slice(0, 700) + cause + (srv ? '\n伺服器：' + (srv.p.exitCode === null ? '仍在運行' : '已結束，代碼 ' + srv.p.exitCode) + '\n' + srv.log.text.slice(-800) : ''));
} };
const waitFor = async (fn, ms = 10000, step = 200) => { const until = Date.now() + ms; while (Date.now() < until) { try { const v = await fn(); if (v) return v; } catch { } await sleep(step); } return null; };
const jr = f => JSON.parse(fs.readFileSync(f, 'utf8'));
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });

const TODAY = lib.localIso().slice(0, 10);
const ymd = (off = 0) => lib.localIso(new Date(Date.now() + off * 86400000)).slice(0, 10);
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^SOS_|^CZ_/.test(k) && !/TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL|BEARER|OAUTH|^CLAUDE/i.test(k)));

/* ---------- 假 AI：包一層，容許計劃項目帶 post（在那一次 AI 工作進行中，真的向伺服器送一個請求，模擬創辦人在工作中途按鍵）---------- */
const FAKE = path.resolve(HERE, '..', 'lib', 'roles-fake-ai.mjs');
const WRAP = path.join(OUT, 'chain-fake-ai.mjs');
fs.writeFileSync(WRAP, `import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const DATA = process.env.SOS_DATA || '';
let job = {}; try { job = JSON.parse(fs.readFileSync('job.json', 'utf8')); } catch { }
let plan = {}; try { plan = JSON.parse(fs.readFileSync(path.join(DATA, 'fake-plan.json'), 'utf8')); } catch { }
const q = (plan[job.type || ''] || [])[0];
if (q && q.post) {
  try {
    const r = await fetch(q.post.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: q.post.origin, Cookie: q.post.cookie }, body: JSON.stringify(q.post.body) });
    fs.appendFileSync(path.join(DATA, 'chain-posts.jsonl'), JSON.stringify({ at: Date.now(), type: job.type, status: r.status, body: await r.text() }) + '\\n');
  } catch (e) { fs.appendFileSync(path.join(DATA, 'chain-posts.jsonl'), JSON.stringify({ error: String(e) }) + '\\n'); }
}
await import(${JSON.stringify(pathToFileURL(FAKE).href)});
`);
const AD = writeAdapters(path.join(OUT, 'adapters'));
const adapter = JSON.parse(fs.readFileSync(AD.fake, 'utf8'));
adapter.args = [WRAP];
const ADAPTER = path.join(OUT, 'adapters', 'adapter-chain.json'); fs.writeFileSync(ADAPTER, JSON.stringify(adapter, null, 2));

/* ---------- 一個獨立世界（照 roles-run-test.mjs 的 world）---------- */
let seq = 0;
async function world(name, { roles = false, mutate = null } = {}) {
  const Wd = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name), DATA = path.join(Wd, 'data');
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATA, 'ledger'), { recursive: true });
  oldInstall(DATA, PROTO);
  const env = { ...cleanEnv, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 180000 });
  const STATE = path.join(DATA, 'ledger', 'state.json');
  const state = () => jr(STATE);
  const put = s => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  shell('--type', 'rhythm', '--trigger', 'manual');   // 未認證 → 只同步帳本，不開工
  for (const d of ['asks', path.join('ledger', 'answers')]) { try { for (const f of fs.readdirSync(path.join(DATA, d))) fs.rmSync(path.join(DATA, d, f), { force: true }); } catch { } }
  await certifyDirect(DATA, PROTO, ADAPTER);
  const s = state();
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' };
  s.peopleSync = { for: P.peopleSyncKey(s) }; s.depthPackFor = s.ledgerFrom;
  if (roles !== 'none' && !roles) s.rolesSync = { for: R.rolesKey(s) };
  const keep = (s.tasks || []).filter(x => x.firstBatch).map(x => ({ ...x, status: 'done', doneOn: ymd(-3) }));
  s.tasks = []; s.runs = [];
  if (mutate) mutate(s);
  s.tasks = (s.tasks || []).concat(keep.filter(k => !(s.tasks || []).some(x => x.id === k.id)));
  put(s);
  process.env.SOS_DATA = DATA;
  const DIR = lib.dataDirs(PROTO);
  fs.mkdirSync(path.dirname(brain.brainFile(DIR, 'checkup')), { recursive: true });
  fs.writeFileSync(brain.brainFile(DIR, 'checkup'), JSON.stringify({ updatedAt: lib.localIso(), weak: [], unseen: [], notNow: [], summary: '測試', industryCheck: [] }));
  const W2 = {
    DATA, DIR, state, put, shell, env, STATE,
    plan: o => { const f = path.join(DATA, 'fake-plan.json'); let p = {}; try { p = jr(f); } catch { } for (const [k, v] of Object.entries(o)) p[k] = (p[k] || []).concat(v); fs.writeFileSync(f, JSON.stringify(p)); },
    calls: () => { try { return fs.readFileSync(path.join(DATA, 'fake-calls.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } },
    callTypes: () => W2.calls().map(c => c.type),
    posts: () => { try { return fs.readFileSync(path.join(DATA, 'chain-posts.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } },
    starts: () => { try { return fs.readFileSync(path.join(DATA, 'ledger', 'ai-starts.log'), 'utf8').split('\n').filter(Boolean); } catch { return []; } },
    packs: () => { try { return fs.readdirSync(path.join(DATA, 'asks')).filter(f => f.endsWith('.json')).map(f => jr(path.join(DATA, 'asks', f))); } catch { return []; } },
    answers: id => { try { return jr(path.join(DATA, 'ledger', 'answers', id + '.json')).answers; } catch { return {}; } },
    openPacks: () => W2.packs().filter(p => p.questions.some(q => (q.effect === 'now' || (p.acceptance && q.id === 'accept')) && !W2.answers(p.id)[q.id])),
    packOf: pred => W2.packs().filter(pred).sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt))),
    rhythm: () => shell('--type', 'rhythm', '--trigger', 'manual'),
    lastRun: () => { const rs = state().runs.filter(r => r.type === 'rhythm'); return rs[rs.length - 1]; },
    // 備援：直接寫回覆檔（只在畫面作答失敗時用，令之後的步驟仍可走）
    answer: (pack, pick) => {
      pack = jr(path.join(DATA, 'asks', pack.id + '.json'));
      const done = W2.answers(pack.id);
      const list = pack.questions.filter(q => !done[q.id]).map(q => ({ q, v: pick(q) })).filter(x => x.v !== undefined).map(({ q, v }) => ({ id: q.id, value: v, ai: q.value, changed: v !== q.value }));
      const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: list.map(a => a.id), answers: list };
      const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: ' + (list.length < pack.questions.length), 'shownAt: ' + lib.localIso()];
      fs.mkdirSync(DIR.replies, { recursive: true });
      fs.writeFileSync(path.join(DIR.replies, lib.localIso().replace(/\D/g, '') + '-ask-answer-' + pack.id + '-' + (seq++) + '.md'), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
      return shell();
    },
    // 模擬翌日：把已有的 runs、工作完成日、啟動紀錄的日期整體往前移一日（同 roles-run-test B7 的做法）；創辦人還沒答的題照舊
    nextDay: () => {
      const y = ymd(-1), sh = x => typeof x === 'string' ? x.replace(new RegExp(TODAY, 'g'), y) : x;
      const st = state();
      st.runs = JSON.parse(JSON.stringify(st.runs || []).replace(new RegExp(TODAY, 'g'), y));
      for (const t of st.tasks || []) for (const k of ['doneOn', 'blockedOn', 'failedOn']) if (t[k]) t[k] = sh(t[k]);
      put(st);
      const lf = path.join(DATA, 'ledger', 'ai-starts.log');
      if (fs.existsSync(lf)) fs.writeFileSync(lf, fs.readFileSync(lf, 'utf8').replace(new RegExp(TODAY, 'g'), y));
    }
  };
  return W2;
}
const aiTask = (id, title, extra = {}) => ({ id, title, owner: 'ai', status: 'planned', milestoneId: 'm1', next: '整理一份清單', updatedAt: lib.localIso(), ...extra });
const setRhythm = (s, o) => { s.company = s.company || {}; s.company.rhythm = { ...(s.company.rhythm || {}), ...o }; };
const itemsOf = r => (r && r.items) || [];
const MSG = (title, who = '陳經理') => ({ title, type: 'message', audience: 'external', text: '草稿，未發送\n\n' + who + '您好，想約你下星期見面談供應。\n\n依據：公司概覽\n' });

/* ---------- 伺服器（真實 server.mjs；每個都有明確埠及隔離資料夾）---------- */
const servers = [];
function startServer(data, port) {
  const log = { text: '' };
  const p = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...cleanEnv, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  p.stdout.on('data', d => { log.text += d; }); p.stderr.on('data', d => { log.text += d; });
  servers.push(p);
  return { p, log, base: 'http://127.0.0.1:' + port };
}
const healthOf = async base => { try { return await (await fetch(base + '/api/health', { signal: AbortSignal.timeout(1500) })).json(); } catch { return null; } };
const healthy = base => waitFor(async () => (await healthOf(base)) && true, 25000, 250);
// 等伺服器自己叫起的外殼做完（送出後 1.5 秒去抖才開工；之後可能連續再排一次）
async function quiet(base, firstMs = 2300) {
  await sleep(firstMs);
  for (let i = 0; i < 3; i++) {
    await waitFor(async () => { const h = await healthOf(base); return h && !h.busy; }, 90000, 300);
    await sleep(1100);
    const h = await healthOf(base); if (h && !h.busy) { if (i >= 1) return true; }
  }
  return true;
}
const post = async (base, p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { status: r.status, body: j }; };
// 外殼以 spawnSync 執行時測試程序被阻塞；閒置的連線若剛好在伺服器 5 秒保持連線逾時那一刻被重用，會被重設（ECONNRESET，2026-11-09 實測閒置 5.2–6.9 秒）。
// 讀取請求可以安全地重試一次（瀏覽器遇到同樣情況亦會自動重試）；其他錯誤照常拋出
const getJ = async (base, p) => { try { return await (await fetch(base + p)).json(); } catch (e) { if (!(e && e.cause && e.cause.code === 'ECONNRESET')) throw e; return (await fetch(base + p)).json(); } };

const S = { c: null, W: null, srv: null };   // 共用：Chrome、主世界、主伺服器
const B = {};                                  // 步驟之間傳遞的事實
const hygiene = async (c, sel = '#app') => (await c.ev(`document.querySelector(${JSON.stringify(sel)}).innerText`)).split('\n').flatMap(l => N.styleIssues(l)).filter(h => ['jargon', 'code', 'date', 'section'].includes(h.kind));
const texts = (c, sel) => c.ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map(e=>e.innerText.trim())`);
// 攔截 /api/submit：記下送出的內容，但照樣交給真實伺服器
const captureSubmit = c => c.ev(`(()=>{ window.__posts=[]; if(!window.__f0){window.__f0=window.fetch;} const rf=window.__f0; window.fetch=function(u,o){ if(String(u).indexOf('/api/submit')>=0){ try{window.__posts.push(JSON.parse(o.body));}catch(e){} } return rf.apply(this,arguments); }; return true; })()`);
const machineOf = async c => { const posts = await c.ev(`window.__posts`); const t = posts.length ? posts[posts.length - 1].text : ''; const m = /```json\n([\s\S]*?)\n```/.exec(t); return m ? JSON.parse(m[1]) : null; };
const openAsk = async (c, id, w = 1440) => { await c.go(BASE + '/#/', w, 600); await c.go(BASE + '/#/ask/' + id, w, 1200); return waitFor(() => c.ev(`!!document.querySelector('.dq')`), 12000); };
// 首頁「今日 Zero 交付」預設收成一行；頁面每幾秒會自行更新，所以點之前先確認鍵還在，失敗就重試
const expandDv = async c => { for (let i = 0; i < 4; i++) { try { if ((await c.ev(`document.querySelector('#dv-toggle')?.getAttribute('aria-expanded')`)) !== 'false') return; await c.click('#dv-toggle'); await sleep(500); } catch { await sleep(600); } } };
const rolePacks = W => W.packOf(p => p.rolesSync);
const accPacks = W => W.packOf(p => p.acceptance);

try {
  /* =====================================================================
     1　夾具：已確認的公司概覽（五個站）、名單內有一位帶職責的團隊成員；升級前沒有崗位、沒有節奏欄
  ===================================================================== */
  await attempt('1 夾具', async () => {
    const W = await world('main', { roles: true, mutate: s => {
      s.tasks = []; setRhythm(s, { pace: 'fast' });
      s.company = s.company || {};
      s.company.actors = [{ id: 'pc-t1', name: '陳小明', label: '陳小明', kind: 'team', role: '農場採購', status: 'active', aliases: [], team: { type: 'fulltime', state: 'active' } }];
    } });
    S.W = W; const s = W.state();
    const ms = (s.milestones || []).filter(m => m.pathStatus === 'confirmed');
    ok('1 夾具：已確認的公司概覽（confirmed.json）及五個已確認的站，站有名稱及事件', fs.existsSync(path.join(W.DATA, 'ledger', 'confirmed.json')) && ms.length === 5 && ms.every(m => m.id && m.short && m.event), ms.map(m => [m.id, m.short]));
    ok('1 夾具：名單有一位帶職責的團隊成員；沒有崗位卡；尚未擬過崗位', s.company.actors.some(a => a.kind === 'team' && a.role) && !(s.teammates || []).length && !(s.rolesSync || {}).for, s.rolesSync);
  });

  /* =====================================================================
     2　擬崗位：外殼出確認題包（followAll、q.roleCard、選項字句＝names.js）
  ===================================================================== */
  const ROLES_OUT = {
    summary: '測試：擬了 2 張。', unassigned: ['m3', 'm4', 'm5'].map(id => ({ milestoneId: id, why: '暫由統籌承擔。' })),
    cards: [
      { title: '農場採購專員', mission: '把農場供貨的資料備齊，令會面可以即場簽約。', milestoneIds: ['m1'], supports: ['pc-t1'], targets: ['partner'], how: ['整理供貨資料'], strategy: '先把農場簽約做穩。', sources: ['confirmedPage'], deliverables: ['message', 'checklist'], knowledge: [{ text: '完成條件見公司概覽。', source: 'confirmedPage' }], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '準備給農場的第一封跟進訊息', deliverable: '一份訊息草稿。', milestoneId: 'm1' } },
      { title: '餐廳拓展經理', mission: '跟進每間餐廳的進展和下一步。', milestoneIds: ['m2'], supports: [], targets: ['customer'], how: ['整理餐廳回饋'], strategy: '先把試單做穩。', sources: ['confirmedPage'], deliverables: ['message'], knowledge: [{ text: '完成條件見公司概覽。', source: 'confirmedPage' }], bounds: { tellAfter: [], askFirst: [] }, activation: { title: '準備給餐廳的第一封邀請訊息', deliverable: '一份訊息草稿。', milestoneId: 'm2' } }
    ]
  };
  await attempt('2 擬崗位', async () => {
    const W = S.W; if (!W) return skip('2 擬崗位', '夾具未建立');
    W.plan({ roles: [{ roles: ROLES_OUT }] });
    W.rhythm();
    const ps = rolePacks(W), s = W.state();
    B.rolesPack = ps[0];
    ok('2 擬崗位日常工作：AI 啟動次序為 roles 先於 rhythm', W.callTypes()[0] === 'roles', W.callTypes());
    ok('2 確認包：一包兩題、followAll: true、todoType decision、rolesSync 有 key', ps.length === 1 && ps[0].questions.length === 2 && ps[0].followAll === true && ps[0].todoType === 'decision' && !!(ps[0].rolesSync || {}).key, ps[0] && { n: ps[0].questions.length, followAll: ps[0].followAll, todo: ps[0].todoType, rs: ps[0].rolesSync });
    const q1 = ps[0] && ps[0].questions[0], rc = q1 && q1.roleCard;
    ok('2 q.roleCard 欄位齊全且都是可顯示字串（id、title、avatarKind、mission、stations、supports、askFirst、activation）；站名、支援對象依名單', rc && ['id', 'title', 'avatarKind', 'mission', 'stations', 'supports', 'askFirst', 'activation'].every(k => k in rc) && rc.title === '農場採購專員' && rc.avatarKind === 'procurement' && rc.stations.join() === '工房簽約' && rc.supports.some(x => /陳小明/.test(x)) && Array.isArray(rc.askFirst) && /跟進訊息/.test(rc.activation), rc);
    ok('2 選項字句與 names.js 完全一致：接受（rec）／改名（input）／不要；apply.op 依次為 roleAccept／roleRename／roleDecline', q1 && q1.options.map(o => o.text).join('|') === [N.t('role_optAccept'), N.t('role_optRename'), N.t('role_optDecline')].join('|') && q1.options[0].rec === true && q1.options[1].input === true && !q1.options[2].rec && q1.options.map(o => o.apply && o.apply.op).join() === 'roleAccept,roleRename,roleDecline' && q1.value === q1.options[0].text && !!q1.inputHint, q1 && q1.options);
    ok('2 確認前不寫卡；崗位頭像檔存在於 assets', !(s.teammates || []).length && fs.existsSync(path.join(PROTO, 'assets', 'crew-role-procurement.webp')) && fs.existsSync(path.join(PROTO, 'assets', 'crew-role-outreach.webp')) && fs.existsSync(path.join(PROTO, 'assets', 'crew-role-lead.webp')), s.teammates);
  });

  /* ---------- 起伺服器 + Chrome（認證已由 world() 寫入；伺服器用同一個假 AI 設定）---------- */
  await attempt('伺服器及瀏覽器', async () => {
    if (!S.W) return skip('伺服器及瀏覽器', '夾具未建立');
    S.srv = startServer(S.W.DATA, PORT);
    ok('主伺服器起得來（埠 ' + PORT + '）', await healthy(BASE), S.srv.log.text.slice(-300));
    await usePass(BASE);
    S.c = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1); await usePass(BASE, S.c);
  });
  const c = () => S.c, W = () => S.W;

  /* =====================================================================
     3　畫面：ask.html 顯示崗位卡、三個選項（建議預選）、頂部「照 Zero 建議，全部確認」
  ===================================================================== */
  await attempt('3 畫面', async () => {
    if (!S.c || !B.rolesPack) return skip('3 畫面', '沒有確認包或瀏覽器');
    const pk = B.rolesPack, [qa, qb] = pk.questions;
    ok('3 打開確認包', await openAsk(S.c, pk.id), pk.id);
    ok('3 兩張崗位卡，稱號依序為「農場採購專員」「餐廳拓展經理」', (await texts(S.c, '.dq .rolecard .rc-name')).join('|') === '農場採購專員|餐廳拓展經理', await texts(S.c, '.dq .rolecard .rc-name'));
    const rows = await S.c.ev(`[...document.querySelectorAll('.dq')].map(q=>({opts:[...q.querySelectorAll('.opt')].map(o=>o.innerText.replace(/\\s+/g,' ').trim()),cur:[...q.querySelectorAll('.opt.cur')].map(o=>o.innerText.replace(/\\s+/g,' ').trim()),dd:[...q.querySelectorAll('.rolecard dd')].map(d=>d.innerText)}))`);
    ok('3 每題三個選項、預選且只預選「由 Zero 承擔」（建議）', rows.length === 2 && rows.every(r => r.opts.length === 3 && r.cur.length === 1 && r.cur[0].startsWith(N.t('role_optAccept'))), rows);
    ok('3 卡內欄位來自 q.roleCard：站、支援（陳小明）、必須先問、啟用任務', rows[0].dd.join(' ').includes('工房簽約') && rows[0].dd.join(' ').includes('陳小明') && rows[0].dd.join(' ').includes(qa.roleCard.activation), rows[0].dd);
    await waitFor(() => S.c.ev(`[...document.querySelectorAll('.dq .rc-av')].every(i=>i.complete)`), 5000);
    const av = await S.c.ev(`[...document.querySelectorAll('.dq .rc-av')].map(i=>i.getAttribute('src')+':'+(i.naturalWidth>0))`);
    ok('3 頭像 URL 為 /assets/crew-role-<類別>.webp 且載入成功', av.join('|') === '/assets/crew-role-procurement.webp:true|/assets/crew-role-outreach.webp:true', av);
    ok('3 頂部有「照 Zero 建議，全部確認」鍵（role_confirmAll）', (await texts(S.c, '#follow-all'))[0] === N.t('role_confirmAll'), await texts(S.c, '#follow-all'));
    ok('3 畫面沒有內部編號、短日期、內部用語', (await hygiene(S.c)).length === 0, await hygiene(S.c));
  });

  /* =====================================================================
     4　作答（真的 POST /api/submit）：第 1 張接受（用「照建議」）、第 2 張改名並輸入合規稱號
  ===================================================================== */
  await attempt('4 作答', async () => {
    if (!S.c || !B.rolesPack) return skip('4 作答', '沒有確認包或瀏覽器');
    const pk = B.rolesPack, [qa, qb] = pk.questions, w = W();
    await openAsk(S.c, pk.id); await captureSubmit(S.c);
    await S.c.click(`#q-${qb.id} .opt:nth-of-type(2)`);
    ok('4 選「改名」打開文字框', await waitFor(() => S.c.ev(`!!document.querySelector('#q-${qb.id} textarea')`), 4000), null);
    await S.c.type(`#q-${qb.id} textarea`, '餐廳拓展主任');
    await S.c.click(`#q-${qb.id} .foot .btn.primary`);
    await S.c.click('#follow-all');
    ok('4 「照 Zero 建議，全部確認」：直接開預覽', await waitFor(() => S.c.ev(`!!document.querySelector('#do-confirm')`), 5000), null);
    await S.c.click('#do-confirm');
    const m = await waitFor(() => machineOf(S.c), 8000);
    const a = m && Object.fromEntries(m.answers.map(x => [x.id, x]));
    ok('4 送出內容：第 1 題＝建議答案「由 Zero 承擔」且未被改過；第 2 題＝打字的新稱號（followAll 不覆蓋已改的題）', a && a[qa.id].value === N.t('role_optAccept') && a[qa.id].changed === false && a[qb.id].value === '餐廳拓展主任' && a[qb.id].changed === true, m);
    await quiet(BASE);
    let s = w.state(); let tms = s.teammates || [];
    if (tms.length < 2) {
      ok('4 外殼收到畫面送出的回覆並建了兩張卡（伺服器叫起外殼處理）', false, { teammates: tms.length, replies: fs.existsSync(w.DIR.replies) ? fs.readdirSync(w.DIR.replies) : [], busy: await healthOf(BASE), srv: S.srv.log.text.slice(-400), answers: w.answers(pk.id) });
      // 備援：改用檔案作答，令之後的步驟仍可走
      w.answer(pk, q => q.id === qa.id ? N.t('role_optAccept') : '餐廳拓展主任'); s = w.state(); tms = s.teammates || [];
    } else ok('4 外殼收到畫面送出的回覆並建了兩張卡', true);
    const id1 = R.nextCardId(pk.id, qa.id), id2 = R.nextCardId(pk.id, qb.id);
    const c1 = tms.find(t => t.id === id1), c2 = tms.find(t => t.id === id2);
    B.id1 = id1; B.id2 = id2;
    const fields = c => c && c.lifecycle === 'planned' && !!c.title && c.name === c.title && !!c.avatarKind && !!c.activationTaskId;
    ok('4 兩張卡都是 lifecycle planned，有 title、name（鏡射）、avatarKind、activationTaskId', fields(c1) && fields(c2), { c1, c2 });
    ok('4 第 1 張用 Zero 的稱號；第 2 張用打字的新稱號「餐廳拓展主任」（avatarKind 隨新稱號重新推算）', c1 && c1.title === '農場採購專員' && c2 && c2.title === '餐廳拓展主任' && c2.avatarKind === R.avatarKindOf('餐廳拓展主任'), { c1: c1 && [c1.title, c1.avatarKind], c2: c2 && [c2.title, c2.avatarKind] });
    const t1 = (s.tasks || []).find(t => c1 && t.id === c1.activationTaskId), t2 = (s.tasks || []).find(t => c2 && t.id === c2.activationTaskId);
    ok('4 每張卡一個啟用任務：cadence activation、屬該卡、needsAcceptance、站正確', t1 && t2 && [t1, t2].every(t => t.cadence === 'activation' && t.needsAcceptance === true && t.owner === 'ai') && t1.teammateId === id1 && t2.teammateId === id2 && t1.milestoneId === 'm1' && t2.milestoneId === 'm2', { t1, t2 });
    ok('4 確認包已作答；沒有殘留未答的崗位題', !w.openPacks().some(p => p.rolesSync), w.openPacks().map(p => p.id));
    const evs = s.events.map(e => e.title).join(' ');
    ok('4 事件記下「已確認崗位」及改名後的稱號', /農場採購專員/.test(evs) && /餐廳拓展主任/.test(evs), s.events.slice(-5).map(e => e.title));
  });

  /* =====================================================================
     5　啟用任務交付（外殼＋統籌校對）→ 驗收包 → 畫面顯示校對一句及草稿
  ===================================================================== */
  await attempt('5 啟用任務及校對', async () => {
    const w = W(); if (!w || !B.id1 || !B.id2) return skip('5 啟用任務及校對', '前一步未產生兩張卡');
    w.nextDay();   // 翌日開工
    w.plan({ rhythm: [{ artifacts: [MSG('給農場的第一封跟進訊息', '農場甲')] }, { artifacts: [MSG('給餐廳的第一封邀請訊息', '黃小姐')] }], proofread: [{ verdict: 'pass', line: '核對無誤。' }, { verdict: 'pass', line: '核對無誤。' }] });
    w.rhythm();
    const run = w.lastRun(), s = w.state();
    B.actRun = run;
    ok('5 翌日工作：兩件啟用任務（各由自己的崗位做），之後各有一次統籌校對；次序 rhythm,proofread,rhythm,proofread', itemsOf(run).length === 2 && itemsOf(run).every(i => i.ending === 'artifact') && w.callTypes().slice(-4).join() === 'rhythm,proofread,rhythm,proofread', { items: itemsOf(run), calls: w.callTypes() });
    const it = itemsOf(run).find(i => i.teammateId === B.id1);
    const rc = it && jr(path.join(w.DATA, 'work', it.workId, 'receipt.json'));
    ok('5 收據：teammateId、taskId、qa { audience external, verdict pass, rounds 1, line }；產出保留 type／audience', rc && rc.teammateId === B.id1 && rc.taskId === s.teammates.find(t => t.id === B.id1).activationTaskId && rc.qa && rc.qa.audience === 'external' && rc.qa.verdict === 'pass' && rc.qa.rounds === 1 && rc.qa.line === '核對無誤。' && rc.artifacts[0].audience === 'external' && rc.artifacts[0].type === 'message', rc);
    const acc = accPacks(w).find(p => p.acceptance.teammateId === B.id1);
    B.acc1 = acc; B.acc2 = accPacks(w).find(p => p.acceptance.teammateId === B.id2);
    ok('5 驗收包（pack 層）：acceptance.artifact.text 有草稿全文、activation true、qaVerdict pass、workId', acc && acc.todoType === 'acceptance' && acc.acceptance.activation === true && acc.acceptance.qaVerdict === 'pass' && /農場甲您好/.test((acc.acceptance.artifact || {}).text || '') && !!acc.acceptance.workId, acc && acc.acceptance);
    const qq = acc && acc.questions[0].acceptance;
    ok('5 驗收題（題層）q.acceptance：qaVerdict、qaLine、roleTitle、avatarKind、activation', qq && qq.qaVerdict === 'pass' && qq.qaLine === '核對無誤。' && qq.roleTitle === '農場採購專員' && qq.avatarKind === 'procurement' && qq.activation === true && qq.artifactTitle === '給農場的第一封跟進訊息', qq);
    ok('5 驗收包選項：接受／退回重做／接受但改方向（names.js 字句）', acc && acc.questions[0].options.map(o => o.text).join('|') === ['接受', N.t('role_optReturn'), N.t('role_optAcceptRedirect')].join('|'), acc && acc.questions[0].options);
    ok('5 啟用任務待驗收（done＋needsAcceptance）、卡仍 planned、未看數＝2', ['activationTaskId'].every(() => s.tasks.find(t => t.id === s.teammates.find(x => x.id === B.id1).activationTaskId).status === 'done') && s.teammates.every(t => t.lifecycle === 'planned') && PACE.unreadCount(w.openPacks()) === 2, { unread: PACE.unreadCount(w.openPacks()) });
    if (!acc || !S.c) return;
    ok('5 畫面開驗收包', await openAsk(S.c, acc.id), acc.id);
    const dl = (await texts(S.c, '.deliver'))[0] || '';
    ok('5 畫面顯示交付者及統籌校對（農場採購專員交付 · 統籌已校對）', dl.includes('農場採購專員交付 · 統籌已校對'), dl.slice(0, 160));
    ok('5 畫面顯示校對結果一句（校對結果：核對無誤。）', dl.includes(N.ui.role_qaResult + '：核對無誤。'), dl.slice(0, 260));
    ok('5 畫面顯示草稿全文（草稿，未發送、農場甲您好）', dl.includes('草稿，未發送') && dl.includes('農場甲您好'), dl.slice(0, 300));
    ok('5 畫面標題＝role_activationAsk；接受題三個選項（接受／退回重做／接受但改方向）', (await texts(S.c, '.dq-q'))[0] === N.t('role_activationAsk', { t: '「農場採購專員」' }) && (await texts(S.c, '#q-accept .opt')).join('|') === ['接受', N.t('role_optReturn'), N.t('role_optAcceptRedirect')].join('|'), { q: await texts(S.c, '.dq-q'), o: await texts(S.c, '#q-accept .opt') });
    B.accShot = await S.c.ev(`({ cur: [...document.querySelectorAll('#q-accept .opt.cur')].map(o => o.innerText.trim()), reasonOpts: [...document.querySelectorAll('#q-reason .opt')].map(o => o.innerText.replace(/\\s+/g, ' ').trim()), goMain: document.querySelector('#go-main')?.innerText.trim(), qs: [...document.querySelectorAll('.dq')].map(q => q.id + ':' + q.classList.contains('done')) })`);
    ok('5 驗收畫面沒有內部編號、短日期、內部用語（草稿內的完整日期除外）', (await hygiene(S.c)).length === 0, await hygiene(S.c));
  });

  /* =====================================================================
     6　驗收「接受」（畫面真的送出）→ 卡 enabled，activation.acceptedAt、bounds.lockedAt
  ===================================================================== */
  await attempt('6 驗收接受', async () => {
    const w = W(), acc = B.acc1; if (!w || !acc || !S.c) return skip('6 驗收接受', '沒有驗收包');
    await openAsk(S.c, acc.id); await captureSubmit(S.c);
    await S.c.click('#q-accept .opt:nth-of-type(1)');
    await S.c.click('#go-main');
    let dlg = await waitFor(() => S.c.ev(`!!document.querySelector('#do-confirm')`), 3000);
    if (!dlg) { try { await S.c.shot(path.join(OUT, 'dbg-step6.png'), null, { full: true }); } catch { } B.dbg6 = await S.c.ev(`document.querySelector('#app').innerText.slice(0, 900)`); fs.writeFileSync(path.join(OUT, 'dbg-step6.txt'), String(B.dbg6)); }
    const diag = await S.c.ev(`({ goMain: document.querySelector('#go-main')?.innerText.trim(), qs: [...document.querySelectorAll('.dq')].map(q => q.id + ':' + q.classList.contains('done')), modal: document.querySelector('.modal, #mt, dialog')?.innerText?.slice(0, 120), btns: [...document.querySelectorAll('.btn')].filter(b => b.offsetParent).map(b => b.id + ':' + b.innerText.trim()) })`);
    ok('6 只選「接受」後可確認並開出預覽（0.40.2 的行為：選接受即可，「退回原因」題是選填）', dlg, diag);
    if (!dlg) {   // 實際行為：選填的退回原因題也被當作必答，要再點「不用改」才開得出預覽；照創辦人的操作走完
      await S.c.click('#q-reason .opt:nth-of-type(1)'); await S.c.click('#go-main');
      dlg = await waitFor(() => S.c.ev(`!!document.querySelector('#do-confirm')`), 5000);
    }
    if (dlg) await S.c.click('#do-confirm');
    const m = await waitFor(() => machineOf(S.c), 8000);
    ok('6 送出的答案：accept＝「接受」', m && m.answers.find(a => a.id === 'accept') && m.answers.find(a => a.id === 'accept').value === '接受', m);
    await quiet(BASE);
    let c1 = w.state().teammates.find(t => t.id === B.id1);
    if (!(c1 && c1.lifecycle === 'enabled')) {
      ok('6 外殼收到畫面的驗收回覆並啟用崗位', false, { c1, replies: fs.existsSync(w.DIR.replies) ? fs.readdirSync(w.DIR.replies).slice(-3) : [], srv: S.srv.log.text.slice(-300), answers: w.answers(acc.id) });
      w.answer(acc, q => q.id === 'accept' ? '接受' : undefined); c1 = w.state().teammates.find(t => t.id === B.id1);
    } else ok('6 外殼收到畫面的驗收回覆並啟用崗位', true);
    const s = w.state(), at = s.tasks.find(t => t.id === c1.activationTaskId);
    ok('6 卡 enabled；activation 有 taskId、acceptedAt、replyFile；bounds.lockedAt', c1.lifecycle === 'enabled' && c1.activation && c1.activation.taskId === c1.activationTaskId && !!c1.activation.acceptedAt && c1.bounds && !!c1.bounds.lockedAt, c1);
    ok('6 啟用任務 acceptedBy founder；另一張卡仍待啟用；驗收題已作答（未看數＝1）', at && at.acceptedBy === 'founder' && s.teammates.find(t => t.id === B.id2).lifecycle === 'planned' && PACE.unreadCount(w.openPacks()) === 1, { at, unread: PACE.unreadCount(w.openPacks()) });
  });

  /* =====================================================================
     7　退回：農場採購專員（已啟用）的日常外發工作，創辦人在畫面退回並寫原因 → 翌日經八段說明續派
  ===================================================================== */
  await attempt('7 退回', async () => {
    const w = W(); if (!w || !B.id1 || !S.c) return skip('7 退回', '沒有已啟用的崗位');
    const s0 = w.state(); s0.tasks.push(aiTask('td1', '給農場乙的報價跟進訊息', { teammateId: B.id1, milestoneId: 'm1', cadence: 'daily' })); w.put(s0);
    w.nextDay();
    w.plan({ rhythm: [{ artifacts: [MSG('給農場乙的報價跟進訊息', '農場乙')] }], proofread: [{ verdict: 'pass' }] });
    w.rhythm();
    const acc = accPacks(w).find(p => p.acceptance.taskId === 'td1');
    ok('7 第二件對外產出：由已啟用的崗位交付，出驗收包（非啟用任務）', acc && acc.acceptance.activation === false && acc.acceptance.teammateId === B.id1 && acc.questions[0].options.map(o => o.text).join('|') === ['接受', N.t('role_optReturn')].join('|'), acc && acc.acceptance);
    if (!acc) return;
    B.accRet = acc;
    await openAsk(S.c, acc.id); await captureSubmit(S.c);
    await S.c.click('#q-accept .opt:nth-of-type(2)');
    const qIds = await S.c.ev(`[...document.querySelectorAll('.dq')].map(q=>q.id)`);
    // 「退回」之後的原因題（kind: text）：看畫面怎樣提供輸入
    const hasBox = await S.c.ev(`!!document.querySelector('#q-reason textarea, #q-reason input')`);
    if (!hasBox) { const rb = await S.c.ev(`document.querySelector('#q-reason') ? [...document.querySelectorAll('#q-reason .btn')].map(b=>b.id+':'+b.innerText.trim()) : null`); B.reasonUi = { qIds, hasBox, rb }; }
    const REASON = '價錢要寫清楚每公斤多少';
    try {
      if (!hasBox && await S.c.ev(`!!document.querySelector('#q-reason .btn')`)) { await S.c.click('#q-reason .btn'); }
      await waitFor(() => S.c.ev(`!!document.querySelector('#q-reason textarea')`), 3000);
      await S.c.type('#q-reason textarea', REASON);
      await S.c.click('#q-reason .foot .btn.primary');
    } catch (e) { B.reasonUiErr = String(e).slice(0, 200); }
    await S.c.click('#go-main'); await waitFor(() => S.c.ev(`!!document.querySelector('#do-confirm')`), 5000); await S.c.click('#do-confirm');
    const m = await waitFor(() => machineOf(S.c), 8000);
    const ra = m && m.answers.find(a => a.id === 'reason'), aa = m && m.answers.find(a => a.id === 'accept');
    ok('7 畫面送出：accept＝退回重做，reason＝創辦人打的原因', aa && aa.value === N.t('role_optReturn') && ra && ra.value === REASON, { m, reasonUi: B.reasonUi, err: B.reasonUiErr });
    await quiet(BASE);
    let t = w.state().tasks.find(x => x.id === 'td1');
    if (!(t && t.status === 'active')) {
      ok('7 外殼收到畫面的退回回覆：工作重開（active）、保留退回原因', false, { t, srv: S.srv.log.text.slice(-300) });
      w.answer(acc, q => q.id === 'accept' ? N.t('role_optReturn') : q.id === 'reason' ? REASON : undefined); t = w.state().tasks.find(x => x.id === 'td1');
    } else ok('7 外殼收到畫面的退回回覆', true);
    ok('7 退回：不開通用 ask-continue；工作重開（active）、needsAcceptance 取消、returnNote 帶原因、記上一版工作資料夾', !w.callTypes().includes('ask-continue') && t.status === 'active' && t.needsAcceptance === false && (t.returnNote || '').includes(REASON) && !!t.lastWorkId, { t, calls: w.callTypes() });
    const callsBefore = w.calls().length;
    w.nextDay();
    w.plan({ rhythm: [{ artifacts: [{ ...MSG('給農場乙的報價跟進訊息', '農場乙'), text: '草稿，未發送\n\n農場乙您好，價錢為每公斤 38 元。\n\n依據：公司概覽\n' }] }], proofread: [{ verdict: 'pass' }] });
    w.rhythm();
    const redo = w.calls().slice(callsBefore).find(x => x.type === 'rhythm');
    ok('7 翌日日常工作把同一件用八段說明派回：taskId td1、同一崗位、task.md 第四段含退回原因', redo && redo.taskId === 'td1' && redo.teammateId === B.id1 && /## 四、輸入與進度/.test(redo.task) && redo.task.split('## 四、')[1].split('## 五、')[0].includes(REASON), redo && redo.task.slice(0, 300));
    ok('7 上一版放進沙盒資料夾 previous-1.md，並列在第三段；沒有 ask-continue 類別的 AI 啟動', redo && fs.existsSync(path.join(w.DATA, 'sandbox', redo.sandbox, 'previous-1.md')) && /previous-1\.md/.test(redo.task.split('## 三、')[1].split('## 四、')[0]) && !w.callTypes().includes('ask-continue') && !w.starts().some(l => /\task-continue\t/.test(l)), { starts: w.starts().slice(-4) });
    const t2 = w.state().tasks.find(x => x.id === 'td1');
    ok('7 重做交付後清除 returnNote；再出一包驗收題', t2.returnNote === undefined && accPacks(w).filter(p => p.acceptance.taskId === 'td1').length === 2, t2);
  });

  /* =====================================================================
     8　校對工具失敗：照交並標 flagged（一項「統籌校對未能完成」），出驗收題 issueCount 1，永不留 pending
  ===================================================================== */
  await attempt('8 校對失敗', async () => {
    const w = W(); if (!w || !B.id1) return skip('8 校對失敗', '沒有已啟用的崗位');
    const s0 = w.state(); s0.tasks.push(aiTask('td2', '給餐廳乙的合作建議書', { teammateId: B.id1, milestoneId: 'm1', cadence: 'daily' })); w.put(s0);
    w.plan({ rhythm: [{ artifacts: [{ title: '給餐廳乙的合作建議書', type: 'proposal', audience: 'external', text: '草稿，未發送\n\n黃小姐您好，附上合作建議。\n\n依據：公司概覽\n' }] }], proofread: [{ fail: true }] });
    w.rhythm();
    const run = w.lastRun(), it = itemsOf(run).find(i => i.taskId === 'td2');
    const rc = it && jr(path.join(w.DATA, 'work', it.workId, 'receipt.json')), acc = accPacks(w).find(p => p.acceptance.taskId === 'td2');
    ok('8 校對工具失敗：收據 qa.verdict flagged、一項問題、audience external', rc && rc.qa.verdict === 'flagged' && rc.qa.issues.length === 1 && rc.qa.audience === 'external' && rc.qa.line === N.t('qa_unfinished'), rc && rc.qa);
    ok('8 runs 的 items[].qa 同為 flagged', it && it.qa && it.qa.verdict === 'flagged', it);
    ok('8 驗收包：pack 層 acceptance.issueCount 1、qaVerdict flagged；題層 q.acceptance.qaVerdict flagged', acc && acc.acceptance.issueCount === 1 && acc.acceptance.qaVerdict === 'flagged' && acc.questions[0].acceptance.qaVerdict === 'flagged' && acc.questions[0].acceptance.qaLine === N.t('qa_unfinished'), acc && acc.acceptance);
    const all = JSON.stringify(w.state().runs) + fs.readdirSync(path.join(w.DATA, 'work')).map(d => { try { return fs.readFileSync(path.join(w.DATA, 'work', d, 'receipt.json'), 'utf8'); } catch { return ''; } }).join('') + JSON.stringify(w.packs());
    ok('8 全部收據、runs、問題包都沒有 pending', !/"verdict":\s*"pending"|"qaVerdict":\s*"pending"/.test(all), (all.match(/.{40}pending.{20}/) || [])[0]);
    if (!acc || !S.c) return;
    await openAsk(S.c, acc.id);
    const dl = (await texts(S.c, '.deliver'))[0] || '';
    ok('8 畫面（驗收包）寫明統籌校對未能完成，並有草稿全文', dl.includes(N.t('qa_unfinished')) && dl.includes('黃小姐您好'), dl.slice(0, 260));
    ok('8 畫面表頭寫明「農場採購專員交付 · 統籌校對後仍有 1 處要留意」（pack 層 issueCount 要到達畫面）', dl.includes(N.t('qa_flagged', { t: '農場採購專員', n: 1 })), dl.slice(0, 260));
  });

  /* ---- 8b 探針：校對「通過但有備註」（pass_with_notes）在驗收畫面與看板上的說法是否一致 ---- */
  await attempt('8b 通過但有備註', async () => {
    const w = W(); if (!w || !B.id1 || !S.c) return skip('8b 通過但有備註', '沒有已啟用的崗位');
    const s0 = w.state(); s0.tasks.push(aiTask('td3', '給農場丙的供應條款說明', { teammateId: B.id1, milestoneId: 'm1', cadence: 'daily' })); w.put(s0);
    w.plan({ rhythm: [{ artifacts: [MSG('給農場丙的供應條款說明', '農場丙')] }], proofread: [{ verdict: 'pass_with_notes', line: '日期要再確認。', issues: [{ where: '第二段', what: '見面日期要再確認', fix: '向對方核對日期' }] }] });
    w.rhythm();
    const acc = accPacks(w).find(p => p.acceptance.taskId === 'td3');
    ok('8b 驗收包帶 qaVerdict pass_with_notes 及校對一句', acc && acc.acceptance.qaVerdict === 'pass_with_notes' && acc.questions[0].acceptance.qaLine === '日期要再確認。', acc && acc.acceptance);
    if (!acc) return;
    await openAsk(S.c, acc.id);
    const dl = (await texts(S.c, '.deliver'))[0] || '';
    const d = await getJ(BASE, '/api/dashboard');
    const ent = (d.deliveries.today.items || []).concat(d.deliveries.recent || []).find(x => x.taskId === 'td3');
    const askNotes = dl.includes('要留意'), dashNotes = !!ent && /要留意/.test(ent.qa.text);
    ok('8b 同一件交付：通過但有備註（Z29）＝統籌已校對；驗收畫面表頭與看板（回饋卡）都不說「要留意」，且都說已校對', ent && !askNotes && !dashNotes && dl.includes('統籌已校對') && /統籌已校對/.test(ent.qa.text), { askHeader: dl.slice(0, 80), dash: ent && ent.qa.text, tag: ent && ent.qa.tag });
    ok('8b 看板該件的 packId 指向同一包驗收題', ent && ent.packId === acc.id, { ent: ent && ent.packId, acc: acc.id });
  });

  /* =====================================================================
     9　節奏：經真實伺服器 setPace sprint → 外殼多件日 → runs／收據 → /api/dashboard → 首頁及團隊頁，三方一致
  ===================================================================== */
  await attempt('9 衝刺及看板', async () => {
    const w = W(); if (!w || !S.c) return skip('9 衝刺及看板', '沒有世界');
    const s0 = w.state();
    for (let i = 1; i <= 12; i++) s0.tasks.push(aiTask('ts' + i, '衝刺工作' + i, { milestoneId: 'm' + (1 + (i % 5)), cadence: 'daily' }));
    w.put(s0); w.nextDay();
    const until = ymd(5);
    const r = await post(BASE, '/api/founder-op', { op: 'setPace', target: 'company', value: { pace: 'sprint', sprintUntil: until } });
    ok('9 POST /api/founder-op setPace sprint（含 sprintUntil）→ 202', r.status === 202 && r.body && r.body.ok, r);
    const dprev = await getJ(BASE, '/api/dashboard');
    ok('9 套用前：看板預覽已顯示衝刺（pace.current sprint、sprint.until）', dprev.pace && dprev.pace.current === 'sprint' && dprev.pace.sprint.until === until, dprev.pace && { c: dprev.pace.current, u: dprev.pace.sprint });
    await quiet(BASE);
    const ops = (() => { try { return jr(path.join(w.DATA, 'ledger', 'founder-ops.json')); } catch { return []; } })();
    // 伺服器叫起的外殼可能已合併；不論如何，工作日 run 才是被測對象
    const before = w.state().runs.length;
    w.rhythm();
    const run = w.lastRun(), s = w.state();
    ok('9 rhythm 套用 setPace：company.rhythm.pace sprint、sprintUntil、sprintStartedOn＝今日', s.company.rhythm.pace === 'sprint' && s.company.rhythm.sprintUntil === until && s.company.rhythm.sprintStartedOn === TODAY, s.company.rhythm);
    const its = itemsOf(run);
    B.sprintRun = run;
    ok('9 衝刺 run：items 10 件、taskIds 10 個、stopReason itemsCap、workDay＝今日', its.length === 10 && (run.taskIds || []).length === 10 && run.stopReason === 'itemsCap' && run.workDay === TODAY, { n: its.length, taskIds: (run.taskIds || []).length, stop: run.stopReason, workDay: run.workDay, runs: s.runs.length - before });
    ok('9 items 的 taskId 與 run.taskIds 次序一致、各不相同；每件有 ending artifact、startedAt、endedAt', its.every((i, k) => i.taskId === run.taskIds[k] && i.ending === 'artifact' && i.startedAt && i.endedAt) && new Set(its.map(i => i.taskId)).size === its.length, its.map(i => [i.taskId, i.ending]));
    const lines = w.starts().filter(l => l.startsWith(TODAY));
    ok('9 今日 ai-starts 行數＝衝刺內 AI 啟動數（10 件工作，沒有校對，因全是內部產出）', lines.length === 10 && w.callTypes().slice(-10).every(t => t === 'rhythm'), { lines: lines.length });
    // ---- /api/dashboard ----
    const d = await getJ(BASE, '/api/dashboard');
    const T = d.deliveries && d.deliveries.today;
    B.dash9 = d;
    ok('9 /api/dashboard deliveries.today：multi、count＝10、cap＝10、stopReason itemsCap、items 10 件', T && T.multi === true && T.count === 10 && T.cap === 10 && T.stopReason === 'itemsCap' && T.items.length === 10, T && { multi: T.multi, count: T.count, cap: T.cap, stop: T.stopReason, items: T.items.length });
    ok('9 stopText＝「今日已滿 10 件」（stop_itemsCap，n＝上限）；今日件數與上限一致，不出現「5 件」配「已滿 10 件」', T && T.stopText === N.t('stop_itemsCap', { n: 10 }) && T.count === T.cap, T && { stopText: T.stopText, count: T.count, cap: T.cap });
    const ledgerIds = its.map(i => i.taskId).sort().join();
    ok('9 看板今日產出的任務與帳本 items 一致（逐件對應 title）', T && T.items.map(x => x.taskId).sort().join() === ledgerIds, T && T.items.map(x => x.taskId));
    ok('9 pace：current sprint、用量 a／b＝10／80（與 ai-starts 行數及保險絲一致）', d.pace && d.pace.current === 'sprint' && d.pace.usage.used === 10 && d.pace.usage.fuse === 80, d.pace && d.pace.usage);
    ok('9 未看數一致：看板 pace.unread、deliveries 的待決驗收數、帳本未答驗收包數三者相同', d.pace.unread === PACE.unreadCount(w.openPacks()) && T.decisions.length === PACE.unreadCount(w.openPacks()), { unread: d.pace.unread, decisions: T && T.decisions.length, ledger: PACE.unreadCount(w.openPacks()) });
    // ---- 首頁 ----
    await S.c.go(BASE + '/#/log', 1440, 500); await S.c.go(BASE + '/#/', 1440, 1800);
    ok('9 首頁有 #deliveries', await waitFor(() => S.c.ev(`!!document.querySelector('#deliveries')`), 12000), await S.c.ev(`document.querySelector('#app')?.innerText.slice(0,200)`));
    const sm = (await texts(S.c, '#dv-summary'))[0] || '';
    const expectSm = [N.t('pace_sprintUntil', { d: ((+until.slice(5, 7)) + ' 月 ' + (+until.slice(8)) + ' 日') }), N.t('dv_doneN', { n: 10, m: 10 }), d.pace.usage.line, N.t('dv_stopLabel', { r: N.t('stop_itemsCap', { n: 10 }) })];
    ok('9 首頁摘要：衝刺至…、今日做了 10 件（上限 10 件）、用量、停止原因 今日已滿 10 件 —— 全部與帳本一致', expectSm.every(x => sm.includes(x)), { sm, expectSm });
    ok('9 首頁摘要的「做了 N 件」＝帳本 items 件數；沒有互相矛盾的件數', (sm.match(/做了\s*(\d+)\s*件/) || [])[1] === String(its.length) && (sm.match(/已滿\s*(\d+)\s*件/) || [])[1] === String(its.length), sm);
    await expandDv(S.c);
    await waitFor(() => S.c.ev(`document.querySelectorAll('#deliveries .dv').length>0`), 5000);
    const outs = await S.c.ev(`[...document.querySelectorAll('#deliveries .dv-sub')].map(s=>({h:s.querySelector('.eyebrow').innerText,n:s.querySelectorAll('.dv').length}))`);
    const outSec = outs.find(x => x.h.startsWith(N.ui.dv_outputsTitle));
    ok('9 首頁展開：今日產出一覽件數＝10（與帳本 items 相同）', outSec && outSec.n === 10, outs);
    ok('9 首頁交付區沒有內部編號、短日期、內部用語', (await hygiene(S.c, '#deliveries')).length === 0, await hygiene(S.c, '#deliveries'));
    // ---- 團隊頁 ----
    await S.c.go(BASE + '/dashboard/team', 1440, 2500);
    ok('9 團隊頁有崗位卡', await waitFor(() => S.c.ev(`document.querySelectorAll('.mcard.tm[data-role]').length>=3`), 15000), await S.c.ev(`document.querySelectorAll('.mcard.tm').length`));
    const cards = await S.c.ev(`[...document.querySelectorAll('.mcard.tm[data-role]')].map(e=>({role:e.getAttribute('data-role'),name:e.querySelector('.rc-name')?.innerText,tag:e.querySelector('.rc-id .tag, .rc-id span:last-child')?.innerText,src:e.querySelector('img.rc-av')?.getAttribute('src'),w:e.querySelector('img.rc-av')?.naturalWidth,ring:e.querySelector('img.rc-av')?.style.getPropertyValue('--ring')}))`);
    const st = w.state();
    const want = (id) => { const t = st.teammates.find(x => x.id === id); return { name: t.title, tag: N.t('role_lifecycle_' + t.lifecycle), src: '/assets/crew-role-' + t.avatarKind + '.webp' }; };
    const cardOf = id => cards.find(x => x.role === id);
    const c1 = cardOf(B.id1), c2 = cardOf(B.id2);
    ok('9 團隊頁：已啟用崗位卡顯示稱號＋頭像 URL＋生命週期標籤「' + N.t('role_lifecycle_enabled') + '」，與帳本一致', c1 && c1.name === want(B.id1).name && c1.src === want(B.id1).src && c1.w > 0 && c1.tag === want(B.id1).tag, { c1, want: want(B.id1) });
    ok('9 團隊頁：待啟用崗位卡（改名後「餐廳拓展主任」）顯示新稱號、頭像類別隨稱號、標籤「' + N.t('role_lifecycle_planned') + '」', c2 && c2.name === '餐廳拓展主任' && c2.src === want(B.id2).src && c2.w > 0 && c2.tag === want(B.id2).tag, { c2, want: want(B.id2) });
    ok('9 團隊頁：統籌卡存在（頭像 crew-role-lead.webp）', cardOf('lead') && cardOf('lead').src === '/assets/crew-role-lead.webp' && cardOf('lead').w > 0, cardOf('lead'));
    const actLink = await S.c.ev(`document.querySelector('.mcard.tm[data-role="' + ${JSON.stringify(B.id2)} + '"] a[href^="/#/ask/"]')?.getAttribute('href') || ''`);
    ok('9 團隊頁：待啟用崗位卡的啟用任務入口連到該崗位的驗收包（外殼寫的 packId ↔ 看板的入口）', B.acc2 && actLink === '/#/ask/' + B.acc2.id, { actLink, want: B.acc2 && B.acc2.id });
    ok('9 團隊頁沒有內部編號、短日期、內部用語', (await hygiene(S.c, '#team-roles')).length === 0, await hygiene(S.c, '#team-roles'));
    ok('9 系統頁用量一致：/dashboard/system 的 #usage-line 與 pace.usage.line 相同；三檔中衝刺為目前', await (async () => { await S.c.go(BASE + '/dashboard/system', 1440, 2500); await waitFor(() => S.c.ev(`!!document.querySelector('#usage-line')`), 12000); const ul = (await texts(S.c, '#usage-line'))[0], cur = await S.c.ev(`document.querySelector('.pace.cur')?.getAttribute('data-pace')`); B.sys9 = { ul, cur }; return ul === d.pace.usage.line && cur === 'sprint'; })(), B.sys9);
  });

  /* ---- 9b 探針：停止原因與檔位的一致性（之後才改回標準，看板會不會令舊停止原因配新上限）---- */
  await attempt('9b 事後改檔探針', async () => {
    const w = W(); if (!w || !B.sprintRun) return skip('9b 事後改檔探針', '沒有衝刺 run');
    const r = await post(BASE, '/api/founder-op', { op: 'setPace', target: 'company', value: { pace: 'standard' } });
    ok('9b setPace standard → 202', r.status === 202, r);
    const d = await getJ(BASE, '/api/dashboard'), T = d.deliveries.today;
    ok('9b 改回標準（尚未套用）後，今日交付的停止原因文字仍是衝刺當時的「今日已滿 10 件」，件數與上限同為 10', T.stopReason === 'itemsCap' && T.stopText === N.t('stop_itemsCap', { n: 10 }) && T.count === 10 && T.cap === 10, { stopReason: T.stopReason, stopText: T.stopText, count: T.count, cap: T.cap, pace: d.pace.current });
    await quiet(BASE);
    const d2 = await getJ(BASE, '/api/dashboard'), T2 = d2.deliveries.today;
    ok('9b 外殼套用標準之後，「今日做了 N 件（上限 M 件）」與停止原因「今日已滿 K 件」中的 K 仍等於 N（不出現 10 件配上限 1 件）', T2.count === 10 && T2.cap === T2.count && T2.stopText === N.t('stop_itemsCap', { n: T2.count }), { count: T2.count, cap: T2.cap, stopText: T2.stopText, pace: d2.pace.current });
    // 還原衝刺供第 10 步
    const r2 = await post(BASE, '/api/founder-op', { op: 'setPace', target: 'company', value: { pace: 'sprint', sprintUntil: ymd(5) } });
    ok('9b 還原衝刺 → 202', r2.status === 202, r2);
    await quiet(BASE);
  });

  /* =====================================================================
     10　暫停 Zero：(a) 真實伺服器接受 pauseZero／resumeZero；(b) 衝刺途中真的向伺服器按「暫停」→ 下一件不開始、stopReason paused
  ===================================================================== */
  await attempt('10 暫停 Zero', async () => {
    const w = W(); if (!w) return skip('10 暫停 Zero', '沒有世界');
    // (a) 隊列形狀：伺服器寫入 founder-ops.json 的項目，與外殼測試用的鉤子項目欄位一致
    const fops = () => { try { return jr(path.join(w.DATA, 'ledger', 'founder-ops.json')); } catch { return []; } };
    const ra = await post(BASE, '/api/founder-op', { op: 'pauseZero', target: 'company', value: {} });
    const ent = fops().find(o => o.op === 'pauseZero');
    ok('10a 伺服器接受 pauseZero（202）並寫入隊列：{ id, op, target, value, at }（與外殼接受的形狀相同）', ra.status === 202 && (!ent || ['id', 'op', 'target', 'value', 'at'].every(k => k in ent)), { ra, ent });
    const dpv = await getJ(BASE, '/api/dashboard');
    ok('10a 看板預覽已暫停（pace.zero.paused true）', dpv.pace && dpv.pace.zero.paused === true, dpv.pace && dpv.pace.zero);
    await quiet(BASE);   // 等伺服器叫起的外殼把暫停套用（連按太快的競爭情況在報告另述：曾有一次 400，未能穩定重現）
    const stPaused = w.state().health || {};
    const rr = await post(BASE, '/api/founder-op', { op: 'resumeZero', target: 'company', value: {} });
    ok('10a 外殼套用暫停後再按恢復 → 202；看板預覽回到未暫停', stPaused.pausedByFounder === true && rr.status === 202 && (await getJ(BASE, '/api/dashboard')).pace.zero.paused === false, { rr, pausedByFounder: stPaused.pausedByFounder });
    await quiet(BASE);
    // (b) 衝刺途中：第 2 件 AI 工作進行中，向真實伺服器 POST pauseZero
    const s0 = w.state();
    if (s0.health && s0.health.pausedByFounder) { delete s0.health.pausedByFounder; w.put(s0); }
    w.nextDay();
    const s1 = w.state(); for (let i = 1; i <= 6; i++) s1.tasks.push(aiTask('tp' + i, '暫停測試工作' + i, { milestoneId: 'm' + (1 + (i % 5)), cadence: 'daily' })); w.put(s1);
    const cookie = passCookie(BASE);
    const callsBefore = w.calls().length;
    w.plan({ rhythm: [{}, { post: { url: BASE + '/api/founder-op', origin: BASE, cookie, body: { op: 'pauseZero', target: 'company', value: {} } } }] });
    w.rhythm();
    const run = w.lastRun(), s = w.state(), posted = w.posts();
    ok('10b 衝刺途中的 POST 已被伺服器接受（202）', posted.length === 1 && posted[0].status === 202, posted);
    ok('10b 第 2 件做完後，下一件沒有開始：run.items 2 件、stopReason paused、只有 2 次 AI 啟動', itemsOf(run).length === 2 && run.stopReason === 'paused' && w.calls().slice(callsBefore).filter(c => c.type === 'rhythm').length === 2, { n: itemsOf(run).length, stop: run.stopReason, calls: w.calls().slice(callsBefore).map(c => c.type) });
    ok('10b 外殼套用：health.pausedByFounder true；其餘工作仍是 planned（沒有被偷偷做）', s.health.pausedByFounder === true && s.tasks.filter(t => /^tp/.test(t.id) && t.status === 'planned').length === 4, { h: s.health, tp: s.tasks.filter(t => /^tp/.test(t.id)).map(t => t.status) });
    const d = await getJ(BASE, '/api/dashboard'), T = d.deliveries.today;
    ok('10b 看板：停止原因＝「你已暫停 Zero，今日停止」；pace.zero.paused true；今日件數與帳本一致', T.stopReason === 'paused' && T.stopText === N.t('stop_paused') && d.pace.zero.paused === true && T.count === 2, { stopReason: T.stopReason, stopText: T.stopText, count: T.count, zero: d.pace.zero });
    const sm = await (async () => { await S.c.go(BASE + '/#/log', 1440, 500); await S.c.go(BASE + '/#/', 1440, 1800); await waitFor(() => S.c.ev(`!!document.querySelector('#dv-summary')`), 10000); return (await texts(S.c, '#dv-summary'))[0] || ''; })();
    ok('10b 首頁摘要：做了 2 件、停止原因為暫停', sm.includes(N.t('dv_doneN', { n: 2, m: 10 })) && sm.includes(N.t('dv_stopLabel', { r: N.t('stop_paused') })), sm);
    // 暫停期間再開工：跳過；恢復後可再做
    const before = w.calls().length; w.rhythm();
    ok('10b 暫停期間再開工：skipReason pausedByFounder，不開 AI', w.lastRun().skipReason === 'pausedByFounder' && w.calls().length === before, w.lastRun());
    await post(BASE, '/api/founder-op', { op: 'resumeZero', target: 'company', value: {} }); await quiet(BASE);
    w.rhythm();
    ok('10b 恢復後再開工：不再暫停，繼續做工作', !w.state().health.pausedByFounder && w.calls().length > before, { h: w.state().health, run: w.lastRun() });
  });

  /* ---- 9c 探針：衝刺日內有一件卡住（blocked）。外殼把卡住的件也算進當日件數（itemsOfDay 不分 ending），看板須用同一個數 ---- */
  await attempt('9c 卡住的件', async () => {
    const w = W(); if (!w) return skip('9c 卡住的件', '沒有世界');
    w.nextDay();
    const s0 = w.state(); for (let i = 1; i <= 12; i++) s0.tasks.push(aiTask('tc' + i, '卡住測試工作' + i, { milestoneId: 'm' + (1 + (i % 5)), cadence: 'daily' })); w.put(s0);
    w.plan({ rhythm: [{}, { blocked: true, blockedOn: '等農場回覆' }] });
    w.rhythm();
    const run = w.lastRun(), its = itemsOf(run), delivered = its.filter(i => i.ending === 'artifact').length, blocked = its.filter(i => i.ending === 'blocked').length;
    ok('9c 第 2 件卡住：run.items 記 ending blocked；該工作只記 blockedOn、狀態不變', blocked === 1 && its[1].ending === 'blocked' && w.state().tasks.find(t => t.id === its[1].taskId).blockedOn === TODAY && w.state().tasks.find(t => t.id === its[1].taskId).status === 'planned', { its: its.map(i => [i.taskId, i.ending]) });
    ok('9c 外殼按「處理過的件」計上限：10 件（含卡住的 1 件）即停，stopReason itemsCap', its.length === 10 && run.stopReason === 'itemsCap' && delivered === 9, { n: its.length, delivered, stop: run.stopReason });
    const d = await getJ(BASE, '/api/dashboard'), T = d.deliveries.today;
    ok('9c 看板件數與外殼同一個數：deliveries.today.count＝run.items 件數＝上限；停止原因「今日已滿 10 件」', T.count === its.length && T.cap === 10 && T.stopText === N.t('stop_itemsCap', { n: 10 }), { count: T.count, cap: T.cap, stopText: T.stopText });
    await S.c.go(BASE + '/#/log', 1440, 500); await S.c.go(BASE + '/#/', 1440, 1800); await waitFor(() => S.c.ev(`!!document.querySelector('#dv-summary')`), 10000);
    const sm = (await texts(S.c, '#dv-summary'))[0] || '';
    ok('9c 首頁摘要內部一致：「做了 N 件」與「已滿 K 件」的 N＝K＝10，不出現 9 件配已滿 10 件', (sm.match(/做了\s*(\d+)\s*件/) || [])[1] === '10' && (sm.match(/已滿\s*(\d+)\s*件/) || [])[1] === '10', { sm });
    await expandDv(S.c);
    await waitFor(() => S.c.ev(`document.querySelectorAll('#deliveries .dv').length>0`), 5000);
    const outs = await S.c.ev(`[...document.querySelectorAll('#deliveries .dv-sub')].map(s=>({h:s.querySelector('.eyebrow').innerText,n:s.querySelectorAll('.dv').length}))`);
    const outSec = outs.find(x => x.h.startsWith(N.ui.dv_outputsTitle));
    ok('9c 今日產出一覽件數＝實際交付件數（卡住的沒有產出，不在清單）', outSec && outSec.n === delivered && T.items.length === delivered, { outs, delivered, items: T.items.length });
    B.blockedNote = { summaryN: (sm.match(/做了\s*(\d+)\s*件/) || [])[1], listN: outSec && outSec.n };
  });

  /* =====================================================================
     11　舊資料（0.40.2 形狀：沒有 pace、沒有崗位）：標準檔、一件、保險絲 40；看板顯示標準
  ===================================================================== */
  await attempt('11 舊資料', async () => {
    const O = await world('old', { roles: 'none', mutate: s => { s.tasks = Array.from({ length: 3 }, (_, i) => aiTask('t' + (i + 1), '測試工作' + (i + 1))); } });
    const st0 = O.state();
    ok('11 前提：帳本沒有 pace、沒有崗位卡、沒有 rolesSync（0.40.2 形狀）', !((st0.company || {}).rhythm || {}).pace && !(st0.teammates || []).length && !st0.rolesSync && PACE.paceKey(st0) === 'standard', { rh: (st0.company || {}).rhythm });
    O.plan({ roles: [{ cards: 2 }] });
    O.rhythm();
    const run = O.lastRun(), s = O.state();
    ok('11 標準日：升級後第一次開工，日常工作只做 1 件（rhythm 1 次），不重做同一件', O.callTypes().filter(t => t === 'rhythm').length === 1 && itemsOf(run).length === 1 && s.tasks.find(t => t.id === 't1').status === 'done' && s.tasks.find(t => t.id === 't2').status === 'planned', { calls: O.callTypes(), items: itemsOf(run) });
    ok('11 保險絲 40（PACE.fuseOf）；升級後的擬崗位算作一次啟動，總啟動數遠低於 40', PACE.fuseOf(s) === 40 && O.starts().length <= 4, { fuse: PACE.fuseOf(s), starts: O.starts().length });
    ok('11 沒有崗位卡可派時，仍由統籌做；收據沒有 teammateId', itemsOf(run)[0].teammateId === '' || itemsOf(run)[0].teammateId === undefined, itemsOf(run)[0]);
    const S2 = startServer(O.DATA, PORT + 2);
    try {
      ok('11 舊資料伺服器起得來（埠 ' + (PORT + 2) + '）', await healthy(BASE2), S2.log.text.slice(-300));
      await usePass(BASE2);
      const d = await getJ(BASE2, '/api/dashboard');
      ok('11 看板：pace.current standard；每日上限 1 件；用量 a／40', d.pace && d.pace.current === 'standard' && d.pace.usage.fuse === 40 && /40/.test(d.pace.usage.line), d.pace && { c: d.pace.current, u: d.pace.usage });
      ok('11 看板：今日件數 1、上限 1；非多件日（回饋卡而非今日一覽）', d.deliveries && d.deliveries.today && d.deliveries.today.cap === 1 && d.deliveries.today.multi === false && d.deliveries.today.count === 1, d.deliveries && d.deliveries.today);
      ok('11 看板：沒有 pace 欄的舊帳本，團隊（崗位）列表不當機（team.roles 為陣列）', d.team && Array.isArray(d.team.roles), d.team && Object.keys(d.team));
      await S.c.go(BASE2 + '/dashboard/system', 1440, 2500);
      await usePass(BASE2, S.c); await S.c.go(BASE2 + '/dashboard/system', 1440, 2500);
      await waitFor(() => S.c.ev(`!!document.querySelector('#usage-line')`), 12000);
      ok('11 系統頁：目前檔位＝標準，用量行寫 40', (await S.c.ev(`document.querySelector('.pace.cur')?.getAttribute('data-pace')`)) === 'standard' && /40/.test((await texts(S.c, '#usage-line'))[0] || ''), { cur: await S.c.ev(`document.querySelector('.pace.cur')?.getAttribute('data-pace')`), ul: await texts(S.c, '#usage-line') });
    } finally { try { S2.p.kill(); } catch { } forgetPass(BASE2); }
  });

  ok('瀏覽器全程沒有腳本錯誤', !S.c || S.c.errors.length === 0, S.c && S.c.errors.slice(0, 3));
} catch (e) {
  ok('測試未中途出錯', false, String(e && e.stack || e).slice(0, 700));
} finally {
  try { if (S.c) S.c.close(); } catch { }
  try { if (S.srv) await waitFor(async () => { const h = await healthOf(BASE); return !h || !h.busy; }, 20000, 300); } catch { }
  for (const p of servers) { try { p.kill(); } catch { } }
  await sleep(500);
}
const pass = results.filter(r => r.pass).length;
try { fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1)); } catch { }
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
