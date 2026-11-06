// 模型對齊：只用合成宿主、假工具同隔離帳本，唔會開真 AI。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { writeAdapters } from '../lib/adapters.mjs';
import { usePass, seedCompany } from '../lib/testkit.mjs';

const [PROTO, OUT, PORT] = process.argv.slice(2);
const results = [], servers = [], originalEnv = { ...process.env };
const ok = (name, pass, info) => results.push({ name, pass: !!pass, ...(pass ? {} : { info }) });
const copy = v => structuredClone(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = (f, fallback = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); };
const lines = f => { try { return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
async function waitFor(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(150); } return null; }
let H;
try {
  fs.mkdirSync(OUT, { recursive: true });
  const CASE = path.join(OUT, 'case-' + process.pid), AD = writeAdapters(path.join(CASE, 'adapters')), DATA = path.join(CASE, 'data'), ledger = path.join(DATA, 'ledger');
  fs.mkdirSync(ledger, { recursive: true });
  process.env.SOS_DATA = DATA; process.env.SOS_ADAPTER = AD.models;
  H = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
  const A = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
  const D = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
  const real = Object.fromEntries(['claude', 'codex', 'agy'].map(id => [id, { ...read(path.join(PROTO, 'adapters', 'hosts', id + '.json')), root: PROTO }]));
  const expected = {
    claude: ['sonnet', 'sonnet', 'sonnet', 'opus'],
    codex: ['gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6.1-sol', 'gpt-6.1-terra'],
    agy: ['gemini-3.8-flash-medium', 'gemini-4-argon-medium', 'gemini-4-argon-medium', 'gemini-4-argon-high']
  };
  // 排除模型／思考程度；Codex 快照更新為 web_search=live，agy 另排除 print-timeout。
  const securityHashes = { claude: '69944eef499d3b0cb1e6cb29fb2ba02c5cc4031e4e01db40f99f478d7e79e2c9', codex: '1ce60f43b851cfe148c42d49288da9ab42bb51d0a2bcae7c95953ba9753378cd', agy: '55f70add8ae874300ac61988d98aa31850d310c254950d4b79436cbf226661ec' };
  const stripped = (args, id) => args.filter((a, i) => a !== '--model' && args[i - 1] !== '--model' && !(id === 'agy' && (a === '--print-timeout' || args[i - 1] === '--print-timeout')) && !a.startsWith('model_reasoning_effort=') && !(a === '-c' && args[i + 1]?.startsWith('model_reasoning_effort=')));
  for (const [id, h] of Object.entries(real)) {
    ok(id + ' 真實宿主通過限制（只讀設定）', H.restrictions(h));
    for (const [i, role] of ['everyday', 'blue', 'red', 'judge'].entries()) {
      const args = H.buildArgs(h, path.join(DATA, 'sandbox', 'args'), 'task', role === 'everyday' ? {} : { role });
      ok(id + ' ' + role + ' 模型及思考程度', args[args.indexOf('--model') + 1] === expected[id][i] && !args.some(a => /\{model\}|\{effort\}/.test(a)) && (id !== 'codex' || args.includes('model_reasoning_effort="' + (role === 'judge' ? 'high' : 'medium') + '"')) && (id === 'codex' || !args.includes('--effort')), args);
    }
    ok(id + ' 非模型參數符合核准快照（agy 已納入明確 deny settings）', crypto.createHash('sha256').update(JSON.stringify(stripped(h.args, id))).digest('hex') === securityHashes[id]);
    ok(id + ' 角色時限 25 分鐘，舊 roles 已移除', h.models.timeoutMinutes === 25 && !Object.hasOwn(h, 'roles'));
  }
  ok('agy CLI 時限 25m、平日程式時限仍 10 分鐘', real.agy.args[real.agy.args.indexOf('--print-timeout') + 1] === '25m' && real.agy.timeoutMinutes === 10);
  const h = { ...read(AD.models), root: PROTO, file: AD.models };
  for (const model of ['--dangerously-skip-permissions', '-x', 'has space', 'a'.repeat(41)]) {
    const bad = copy(h); bad.models.red[0].model = model;
    ok('拒絕不安全候選 ' + model, !H.restrictions(bad));
  }
  for (const effort of ['ultra', 'maximum', '', null]) { const bad = copy(h); bad.models.everyday[0].effort = effort; ok('拒絕思考程度 ' + effort, !H.restrictions(bad)); }
  for (const mutate of [x => x.args.push('{model}'), x => { x.args[x.args.indexOf('{model}')] = 'fixed'; x.args.push('{model}'); }, x => x.args.push('{effort}'), x => x.args.push('model_reasoning_effort="{effort}"'), x => delete x.models.everyday, x => x.models.red = [], x => x.models.red = 'preferred', x => delete x.models.everyday[1].effort]) {
    const bad = copy(h); mutate(bad); ok('拒絕不完整角色或佔位範本 ' + results.length, !H.restrictions(bad));
  }
  for (const key of ['fastModel', 'reviewModel']) { const bad = copy(h); bad.chat[key] = '-x'; ok('情景演練驗證 ' + key, !H.restrictions(bad)); }
  const practiceSource = fs.readFileSync(path.join(PROTO, 'practice-lib.mjs'), 'utf8');
  const chatSource = practiceSource.slice(practiceSource.indexOf('function spawnChat('), practiceSource.indexOf('function send('));
  for (const key of ['fastModel', 'reviewModel']) {
    let spawned = false;
    try { vm.runInNewContext(chatSource + '\nspawnChat(host, "cwd", "system", "safe")', { host: { chat: { args: [], [key]: '-x' } }, validModel: H.validModel, resolveCommand: () => { spawned = true; throw new Error('不應到此'); } }); } catch { }
    ok('情景演練 ' + key + ' 不合格時不啟動', !spawned);
  }
  const legacy = read(AD.fake);
  ok('沒有 models 區嘅假宿主行為不變', H.restrictions(legacy) && JSON.stringify(H.buildArgs(legacy, DATA, 'task')) === JSON.stringify(legacy.args));
  const modelsOnly = copy(h); modelsOnly.models.judge[0] = { model: 'new-judge', label: '新模型', effort: 'high' };
  ok('只改模型表唔改安全雜湊', H.hashHost(modelsOnly) === H.hashHost(h));
  for (const key of ['args', 'env', 'required', 'chat.args', 'certify']) {
    const changed = copy(h);
    if (key === 'args') changed.args.push('x');
    if (key === 'env') changed.env = { HOME: '{dataDir}/another' };
    if (key === 'required') changed.required.note = 'x';
    if (key === 'chat.args') changed.chat.args.push('x');
    if (key === 'certify') changed.certify = { neutral: true, role: 'everyday' };
    ok('安全雜湊包含 ' + key, H.hashHost(changed) !== H.hashHost(h));
  }
  const control = v => write(path.join(DATA, 'model-tool.json'), v);
  write(path.join(ledger, 'adapter-cert.json'), { host: AD.models, version: 'fake-model 1.0', argsHash: H.hashHost(h) });
  write(AD.models, modelsOnly);
  ok('只改模型表仍然認證', !!H.certified(PROTO, ledger).host);
  write(AD.models, h);
  control({ version: 'fake-model 2.0' });
  const changed = H.certified(PROTO, ledger);
  ok('只有版本變更：versionOnly、hostId、有版本、沒有 host', changed.versionOnly === true && changed.hostId === 'test' && changed.version === 'fake-model 2.0' && !Object.hasOwn(changed, 'host'), changed);
  write(path.join(ledger, 'adapter-cert.json'), { host: AD.models, version: 'fake-model 1.0', argsHash: 'changed' });
  ok('雜湊變更唔冒充只改版本', !H.certified(PROTO, ledger).versionOnly);

  const sb = name => { const dir = path.join(DATA, 'sandbox', name); fs.mkdirSync(dir, { recursive: true }); return dir; };
  for (const [key, change] of [['清單探測', x => { x.modelsProbe = { args: ['models', 'x'] }; }], ['清單快取', x => { x.modelsCache = '{dataDir}/other.json'; }], ['登入探測', x => { x.loginProbe = { args: ['x'] }; }], ['版本參數', x => { x.versionArgs = ['x']; }]]) {
    const changed = copy(h); change(changed); ok('安全雜湊包含' + key, H.hashHost(changed) !== H.hashHost(h));
  }
  for (const args of [['models', '--dangerously-skip-permissions'], ['-p', 'x'], ['{prompt}'], ['has space'], [], 'models', ['a', 'b', 'c']]) ok('拒絕不安全清單探測 ' + JSON.stringify(args), !H.restrictions({ ...h, modelsProbe: { args } }));
  ok('Antigravity 指示說明命令列不可用，改用讀寫及列資料夾工具', /命令列喺呢度用唔到/.test(real.agy.prompt) && /讀檔、寫檔同列資料夾工具/.test(real.agy.prompt));
  ok('Antigravity 真實清單探測合格', H.restrictions({ ...real.agy, root: PROTO }) && JSON.stringify(real.agy.modelsProbe.args) === '["models"]');
  const cacheHost = { ...h, modelsCache: '{dataDir}/codex-home/models_cache.json' }, cacheFile = path.join(DATA, 'codex-home', 'models_cache.json');
  write(cacheFile, { models: [null, 5, { deprecated: null }] });
  ok('異常模型快取：唔中斷，用首選', H.pickModel(cacheHost).model === 'preferred');
  write(cacheFile, { models: [{ slug: 'backup', deprecated: null }] });
  ok('Codex 清單無首選：選後備', H.pickModel(cacheHost).model === 'backup');
  write(cacheFile, { models: [{ slug: 'preferred', deprecated: { date: '2026-11-04' } }, { slug: 'backup', deprecated: null }] });
  ok('Codex deprecated 非空：跳過', H.pickModel(cacheHost).model === 'backup');
  write(cacheFile, { models: [] }); ok('全部不在清單：仍用首選', H.pickModel(cacheHost).model === 'preferred');
  fs.writeFileSync(cacheFile, 'unreadable-json'); ok('快取讀不到：用首選', H.pickModel(cacheHost).model === 'preferred');
  ok('快取不存在：用首選', H.pickModel({ ...h, modelsCache: '{dataDir}/no-cache.json' }).model === 'preferred');
  const probeHost = { ...h, modelsProbe: { args: [h.args[0], 'models'] } };
  control({ models: ['backup'] });
  ok('agy 探測無首選：選後備', H.pickModel(probeHost).model === 'backup');
  control({ models: ['preferred'] });
  ok('agy 同日只探測一次', H.pickModel(probeHost).model === 'backup' && lines(path.join(DATA, 'model-probes.log')).length === 1);
  write(path.join(ledger, 'model-list-test.json'), { day: '2000-01-01', models: ['backup'] });
  ok('agy 換日重新探測並恢復首選', H.pickModel(probeHost).model === 'preferred' && lines(path.join(DATA, 'model-probes.log')).length === 2);
  write(path.join(ledger, 'model-list-test.json'), { day: '2000-01-01', models: [] }); control({ probeFail: true });
  ok('agy 探測失敗：用首選', H.pickModel(probeHost).model === 'preferred');

  const taskHost = { ...h, args: [...h.args, '--model-task'] };
  const count = () => lines(path.join(DATA, 'model-tool-starts.log')).length;
  control({ failModels: ['preferred'] }); let before = count(), starts = 0;
  let r = await H.execute(taskHost, sb('fallback'), undefined, { onStart: () => { starts++; } });
  ok('首選快速失敗、無產出：後備重試一次', r.ok && count() - before === 2 && starts === 2, r);
  ok('model-seen 記錄實際後備、Claude 取最高成本模型', read(path.join(ledger, 'model-seen.json')).everyday.fallback === true && read(path.join(ledger, 'model-seen.json')).everyday.actual === 'actual-v1');
  const threeCandidates = copy(taskHost); threeCandidates.models.everyday.push({ model: 'third', label: '第三模型', effort: 'medium' });
  control({ failAll: true }); before = count(); r = await H.execute(threeCandidates, sb('both-fail'));
  ok('兩個候選都失敗：整次最多兩次啟動', !r.ok && count() - before === 2, r);
  control({ failAll: true, writeOnFailure: true }); before = count(); r = await H.execute(taskHost, sb('partial'));
  ok('失敗但 out 有巢狀檔案：不重試', !r.ok && count() - before === 1);
  control({ failAll: true, delayMs: 20100 }); before = count(); r = await H.execute(taskHost, sb('late'));
  ok('超過 20 秒才失敗：不重試', !r.ok && count() - before === 1 && r.elapsedMs > 20000, r);
  control({ delayMs: 1000 }); starts = 0; r = await H.execute(taskHost, sb('timeout'), undefined, { timeoutMinutes: 0.002, onStart: () => { starts++; } });
  ok('逾時：不重試', !r.ok && r.timedOut && starts === 1, r);
  starts = 0; r = await H.execute({ ...taskHost, command: path.join(OUT, 'no-such-tool.exe') }, sb('missing'), undefined, { onStart: () => { starts++; } });
  ok('找不到工具：不重試', !r.ok && r.reason === H.AI_FAIL.notFound && starts === 1, r);
  starts = 0; r = await H.execute({ ...taskHost, command: OUT }, sb('cannot-start'), undefined, { onStart: () => { starts++; } });
  ok('未能啟動：不重試', !r.ok && starts === 1, r);
  control({ failModels: ['preferred'] }); before = count(); r = await H.execute(cacheHost, sb('cert-first'), undefined, { certify: true });
  ok('認證忽略可用清單、只測藍方首選（冇藍方用平日）、不重試', !r.ok && count() - before === 1 && lines(path.join(DATA, 'model-tool-starts.log')).at(-1) === 'preferred');
  control({}); starts = 0; r = await H.execute(taskHost, sb('budget-denied'), undefined, { onStart: () => { starts++; return false; } });
  control({ format: 'stream-json', initModel: 'init-model' }); await H.execute({ ...taskHost, outputFormat: 'stream-json' }, sb('init-model'));
  ok('Antigravity 開始事件有模型：記錄實際模型', read(path.join(ledger, 'model-seen.json')).everyday.actual === 'init-model');
  ok('啟動預算拒絕：不啟動', !r.ok && starts === 1 && r.reason === A.NAMES.ui.skip_budgetExhausted);

  const seenFile = path.join(ledger, 'model-seen.json'), noticeFile = path.join(ledger, 'model-notice.json');
  control({ actual: 'actual-v1' }); await H.execute(taskHost, sb('seen-v1'));
  const firstNotice = read(noticeFile)?.id;
  control({ actual: 'actual-v2' }); await H.execute(taskHost, sb('seen-v2'));
  const notice = read(noticeFile);
  ok('實際模型變更：新增一次更新提示', notice?.id && notice.id !== firstNotice && notice.text === 'AI 模型已更新為 首選模型。', notice);
  await H.execute(taskHost, sb('seen-v2-again'));
  ok('同一實際模型再跑：不重複提示', read(noticeFile).id === notice.id);
  const dirs = A.dataDirs(PROTO), view = () => D.dashboardState(dirs, { cert: { host: 'test', label: '測試模型' } }).ai;
  control({ failModels: ['preferred'] }); await H.execute(taskHost, sb('seen-fallback'));
  const fallbackView = view();
  ok('後備提示持續顯示', fallbackView.modelWarnings.includes('原定的 AI 模型暫時無法使用，已改用 後備模型。工作照常進行；如持續出現，請更新 CrewZero。') && JSON.stringify(fallbackView.modelWarnings) === JSON.stringify(view().modelWarnings), fallbackView);
  control({}); await H.execute(taskHost, sb('seen-recover'));
  ok('首選恢復：後備提示消失', read(seenFile).everyday.fallback === false && view().modelWarnings.length === 0);
  ok('系統模型資料有書面名稱及深度思考', view().models === 'AI 模型：平日工作 首選模型；藍方及紅方 首選模型；裁判 後備模型（深度思考）', view());
  for (const format of ['jsonl', 'stream-json']) {
    control({ format, meta: { usage: { tokens: 1 } } }); await H.execute({ ...taskHost, outputFormat: format }, sb('unknown-' + format));
    ok(format + ' 無模型欄位：actual 留空', read(seenFile).everyday.actual === '');
    control({ format, meta: { model: 'reported-model' } }); await H.execute({ ...taskHost, outputFormat: format }, sb('reported-' + format));
    ok(format + ' 有模型欄位：只用事件值', read(seenFile).everyday.actual === 'reported-model');
  }
  process.env.SOS_ADAPTER = AD.fake;
  ok('沒有 models 區：不顯示模型行', !Object.hasOwn(view(), 'models'));
  process.env.SOS_ADAPTER = AD.models;
  const html = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8'), noticeStart = html.indexOf('      var notice = j.ai'), noticeEnd = html.indexOf('      if (status && window.SOS_CELEBRATE) window.SOS_CELEBRATE', noticeStart);
  const stored = new Map(), toasts = [], noticeCtx = vm.createContext({ j: { ai: { modelNotice: { id: 'once', text: '更新' } } }, V: {}, localStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) }, toast: text => toasts.push(text) });
  vm.runInContext(html.slice(noticeStart, noticeEnd), noticeCtx); vm.runInContext(html.slice(noticeStart, noticeEnd), noticeCtx); noticeCtx.V = {}; vm.runInContext(html.slice(noticeStart, noticeEnd), noticeCtx);
  ok('更新提示經輪詢或重開頁面都只出現一次', toasts.length === 1);

  const runSource = fs.readFileSync(path.join(PROTO, 'run.mjs'), 'utf8');
  const runAISource = runSource.slice(runSource.indexOf('function runAI('), runSource.indexOf('function checkReceipt('));
  let left = 40, startRecords = [];
  const runCtx = vm.createContext({ certified: () => ({ host: {} }), webAccess: H.webAccess, ROOT: PROTO, DIR: { ledger }, U: A.NAMES.ui, path, STARTS: 'starts', LOCK: 'lock', openUnknowns: () => [], readJSON: () => ({}), localIso: () => '2026-11-04', budgetLeft: () => left, setInterval: () => 0, clearInterval: () => {}, fs: { readFileSync: () => '', existsSync: () => false, appendFileSync: (_f, line) => { startRecords.push(line); left--; } }, execute: async (_h, _s, _p, opts) => { for (let i = 0; i < 2; i++) if (opts.onStart({ attempt: i }) === false) return { ok: false }; return { ok: true }; } });
  vm.runInContext(runAISource, runCtx);
  await vm.runInContext('runAI("sandbox")', runCtx);
  ok('每次後備啟動都經外殼記錄 STARTS', startRecords.length === 2 && left === 38);
  left = 1; startRecords = []; await vm.runInContext('runAI("sandbox")', runCtx);
  ok('每日只餘一次時不准後備越過上限', startRecords.length === 1 && left === 0);
  const roleSource = runSource.slice(runSource.indexOf('function roleSetup()'), runSource.indexOf('// 開一場辯論', runSource.indexOf('function roleSetup()')));
  for (const [id, host] of Object.entries(real)) {
    const role = vm.runInNewContext(roleSource + '\nroleSetup()', { certified: () => ({ host }), modelCandidates: H.modelCandidates, readsWeb: H.readsWeb, webAccess: H.webAccess, ROOT: PROTO, DIR: { ledger } });
    // 創辦人 2026-11-05 決定 Codex 裁判改用 Terra（與藍紅兩方不同模型）；只有 Antigravity 仍是三方同一模型
    ok(id + ' 角色警告按模型名稱比較', id === 'agy' ? role.warnings.length === 1 && role.warnings[0] === '三方同一模型，獨立性低' : role.warnings.length === 0 && role.roles.judge.sameAsBlue === false, role);
  }
  ok('全程已移除紅藍同模型警告', !runSource.includes('紅方與藍方為同一模型'));
  ok('成本上限 2／情景演練 1 及原有模型不變', real.claude.args[real.claude.args.indexOf('--max-budget-usd') + 1] === '2' && real.claude.chat.args[real.claude.chat.args.indexOf('--max-budget-usd') + 1] === '1' && real.claude.chat.fastModel === 'haiku' && real.claude.chat.reviewModel === 'sonnet');
  const debate = fs.readFileSync(path.join(PROTO, 'debate-lib.mjs'), 'utf8'), rhythm = fs.readFileSync(path.join(PROTO, 'rhythm-lib.mjs'), 'utf8');
  ok('每場 11 次、每日 40 次上限保留', /HARD_CAP\s*=\s*11/.test(debate) && /aiStartsPerDay:\s*40/.test(rhythm));

  // 用原始函數測定時判斷；只替換程序、時鐘同帳本依賴，唔等真實十分鐘。
  const source = fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8');
  const maybeSource = source.slice(source.indexOf('let recertCheckedAt'), source.indexOf('// 認證狀態：', source.indexOf('let recertCheckedAt')));
  const tickSource = source.slice(source.indexOf('function rhythmTick()'), source.indexOf('const rhythmTimer', source.indexOf('function rhythmTick()')));
  let certResult = { versionOnly: true, hostId: 'test', version: '2' }, demo = false, now = 1000000, checks = 0, launched = 0;
  const memory = new Map();
  const ctx = vm.createContext({ certChild: null, child: null, Date: { now: () => now }, isDemoInstance: () => demo, certified: () => { checks++; return certResult; }, ROOT: PROTO, DIR: { ledger }, path, readJSON: f => memory.get(f), writeJSON: (f, v) => memory.set(f, v), localIso: () => 'now', startCertification: () => { launched++; ctx.certChild = {}; return true; } });
  vm.runInContext(maybeSource, ctx);
  ok('maybeRecertify 只啟動一次並記低版本', vm.runInContext('maybeRecertify()', ctx) === true && launched === 1 && memory.get(path.join(ledger, 'recert-attempt.json')).version === '2');
  ctx.certChild = null; now += 600001;
  ok('同版本認證失敗：不再自動重試', vm.runInContext('maybeRecertify()', ctx) === false && launched === 1);
  const beforeCheck = checks; vm.runInContext('maybeRecertify()', ctx);
  ok('未夠十分鐘唔再開版本探測', checks === beforeCheck);
  certResult = { versionOnly: true, hostId: 'test', version: '3' }; now += 600001;
  ok('版本再變：可以再認證', vm.runInContext('maybeRecertify()', ctx) === true && launched === 2);
  ctx.certChild = null; certResult = { code: 'changed' }; now += 600001;
  ok('雜湊變更：不自動認證', vm.runInContext('maybeRecertify()', ctx) === false && launched === 2);
  demo = true; certResult = { versionOnly: true }; now += 600001;
  ok('示範／模擬實例：不自動認證', vm.runInContext('maybeRecertify()', ctx) === false && launched === 2);
  demo = false; ctx.certChild = {}; let kicked = 0;
  ctx.kick = () => { kicked++; }; vm.runInContext(tickSource, ctx); vm.runInContext('rhythmTick()', ctx);
  ok('認證進行時到期：不觸發當日開工', kicked === 0);
  Object.assign(ctx, { certChild: null, fs: { existsSync: () => false }, pendingFiles: () => [], pendingMatches: () => [], pendingFounderOps: () => [], SIM: false, rhythmOf: () => ({}), clockNow: () => new Date(), scheduleEligibility: () => ({ slot: new Date() }), ymd: () => '2026-11-04', firedDay: null, kick: () => { kicked++; return true; } });
  memory.set(path.join(ledger, 'schedule.json'), { mode: 'server' });
  certResult = { versionOnly: true, hostId: 'test', version: '4' };
  vm.runInContext('recertCheckedAt = Date.now()', ctx);
  const beforeDue = checks; vm.runInContext('rhythmTick()', ctx);
  ok('每日到期即使未夠十分鐘仍檢查一次，先認證後開工', checks === beforeDue + 1 && launched === 3 && kicked === 0);
  ctx.certChild = null; certResult = { host: {} }; vm.runInContext('rhythmTick()', ctx);
  ok('認證通過後下一輪才做當日工作', kicked === 1);

  // 真外殼＋假 AI：退一級必須多記一行 STARTS；認證通過後等候工作會自動續做。
  control({ failModels: ['preferred'] }); seedCompany(DATA, PROTO);
  write(path.join(ledger, 'adapter-cert.json'), { host: AD.models, version: 'fake-model 1.0', argsHash: H.hashHost(h) });
  const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_NO_OPEN: '1' }, stdio: 'ignore' }); servers.push(server);
  const base = 'http://127.0.0.1:' + PORT; await usePass(base);
  const post = async body => fetch(base + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }).then(r => r.json());
  const job = await post({ kind: 'note', type: 'adhoc', text: '測試模型後備' });
  const finished = await waitFor(() => (read(path.join(ledger, 'status.json'), {}).runs || []).find(r => r.ref === job.id && r.state === 'done'));
  const startLines = lines(path.join(ledger, 'ai-starts.log'));
  ok('外殼退一級：工作完成，STARTS 多記一次', finished && startLines.filter(l => l.includes(finished.id)).length === 2, { finished, startLines });
  // 另一個安裝模擬升級後首次開機，唔靠重設十分鐘限速。
  const autoData = path.join(CASE, 'auto-data'), autoLedger = path.join(autoData, 'ledger');
  seedCompany(autoData, PROTO);
  write(path.join(autoData, 'model-tool.json'), { version: 'fake-model 2.0' });
  write(path.join(autoLedger, 'adapter-cert.json'), { host: AD.models, version: 'fake-model 1.0', argsHash: H.hashHost(h) });
  const autoServer = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(Number(PORT) + 1)], { cwd: PROTO, env: { ...process.env, SOS_DATA: autoData, SOS_NO_OPEN: '1' }, stdio: 'ignore' }); servers.push(autoServer);
  const autoBase = 'http://127.0.0.1:' + (Number(PORT) + 1); await usePass(autoBase);
  const response = await fetch(autoBase + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: autoBase }, body: JSON.stringify({ kind: 'note', type: 'adhoc', text: '測試工具升級後續做' }) });
  const resumedJob = await response.json();
  const resumed = await waitFor(() => (read(path.join(autoLedger, 'status.json'), {}).runs || []).find(r => r.ref === resumedJob.id && r.state === 'done'), 45000);
  ok('工具升級自動認證通過後，等候工作續做', resumed && read(path.join(autoLedger, 'adapter-cert.json')).version === 'fake-model 2.0' && read(path.join(autoLedger, 'recert-attempt.json')).version === 'fake-model 2.0', resumed);
  // 自動認證失敗：已提交嘅工作要如實顯示等候 AI 設定，唔可以無聲卡住
  const badData = path.join(CASE, 'bad-data'), badLedger = path.join(badData, 'ledger');
  seedCompany(badData, PROTO);
  write(path.join(badData, 'model-tool.json'), { version: 'fake-model 3.0', failAll: true });
  write(path.join(badLedger, 'adapter-cert.json'), { host: AD.models, version: 'fake-model 1.0', argsHash: H.hashHost(h) });
  const badServer = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(Number(PORT) + 2)], { cwd: PROTO, env: { ...process.env, SOS_DATA: badData, SOS_NO_OPEN: '1' }, stdio: 'ignore' }); servers.push(badServer);
  const badBase = 'http://127.0.0.1:' + (Number(PORT) + 2); await usePass(badBase);
  const badJob = await (await fetch(badBase + '/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: badBase }, body: JSON.stringify({ kind: 'note', type: 'adhoc', text: '測試認證失敗唔會卡住' }) })).json();
  const waiting = await waitFor(() => (read(path.join(badLedger, 'status.json'), {}).runs || []).find(r => r.ref === badJob.id && r.state === 'waiting' && r.waitingFor === 'ai-setup'), 45000);
  ok('工具升級自動認證失敗：工作顯示等候 AI 設定，唔會卡住', !!waiting && read(path.join(badLedger, 'certify-status.json')).state === 'failed' && read(path.join(badLedger, 'adapter-cert.json'), null) === null, waiting);
  // 工具升級後按「立即開工」：認證通過後照做，唔會無聲消失
  const nowData = path.join(CASE, 'now-data'), nowLedger = path.join(nowData, 'ledger');
  seedCompany(nowData, PROTO);
  write(path.join(nowData, 'model-tool.json'), { version: 'fake-model 2.0' });
  write(path.join(nowLedger, 'adapter-cert.json'), { host: AD.models, version: 'fake-model 1.0', argsHash: H.hashHost(h) });
  const nowServer = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(Number(PORT) + 3)], { cwd: PROTO, env: { ...process.env, SOS_DATA: nowData, SOS_NO_OPEN: '1' }, stdio: 'ignore' }); servers.push(nowServer);
  const nowBase = 'http://127.0.0.1:' + (Number(PORT) + 3); await usePass(nowBase);
  const nowRes = await fetch(nowBase + '/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: nowBase }, body: JSON.stringify({ action: 'runNow' }) });
  const manual = await waitFor(() => (read(path.join(nowLedger, 'state.json'), {}).runs || []).find(r => r.trigger === 'manual'), 45000);
  ok('立即開工遇上自動認證：認證後照做', nowRes.status === 202 && !!manual && read(path.join(nowLedger, 'adapter-cert.json')).version === 'fake-model 2.0', { status: nowRes.status, manual });
  // 開唔到認證程式（只有 error 冇 exit）：要交外殼處理已提交工作，唔可以卡住
  const certSource = fs.readFileSync(path.join(PROTO, 'server.mjs'), 'utf8');
  const startSource = certSource.slice(certSource.indexOf('function startCertification('), certSource.indexOf('let recertCheckedAt'));
  const handlers = {}, written = new Map(); let scheduled = 0;
  const certCtx = vm.createContext({ certChild: null, certStartedAt: '', kickArgsAfterCert: null, again: false, localIso: () => 'now', process, ROOT: PROTO, PORT: 1, path, spawn: () => ({ on: (k, f) => { handlers[k] = f; } }), DIR: { ledger }, writeJSON: (f, v) => written.set(f, v), readJSON: (f, d) => written.get(f) || d, fs, pendingFiles: () => ['x'], pendingMatches: () => [], schedule: () => { scheduled++; }, kick: () => { } });
  vm.runInContext(startSource, certCtx);
  ok('開到認證程序', vm.runInContext('startCertification("test")', certCtx) === true);
  handlers.error(new Error('EPERM')); handlers.exit?.(1);
  ok('開唔到認證程式：記失敗、清狀態、只交外殼一次', vm.runInContext('certChild', certCtx) === null && scheduled === 1 && written.get(path.join(ledger, 'certify-status.json')).state === 'failed');
  const namesHost = await import(pathToFileURL(path.join(PROTO, 'host-lib.mjs')).href);
  ok('別名升級：顯示實際模型名稱；認唔到嘅代號用模型表名稱', namesHost.modelName('claude-sonnet-6', 'Sonnet 5.5') === 'Sonnet 6' && namesHost.modelName('claude-opus-5-5', 'x') === 'Opus 5.5' && namesHost.modelName('', 'Sonnet 5.5') === 'Sonnet 5.5' && namesHost.modelName('gpt-6.1-sol', 'GPT-6.1 Sol') === 'GPT-6.1 Sol');
} catch (e) { ok('測試程式出錯', false, String(e.stack || e)); }
finally {
  for (const server of servers) { try { server.kill(); } catch { } }
  for (const key of ['SOS_DATA', 'SOS_ADAPTER']) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
}
write(path.join(OUT, 'results.json'), results);
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + String(JSON.stringify(r.info)).slice(0, 1400)));
const passed = results.filter(r => r.pass).length;
console.log(passed + '/' + results.length + ' passed');
process.exit(passed === results.length ? 0 : 1);
