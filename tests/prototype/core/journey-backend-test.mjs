// 開局旅程及生意模式圖後端驗收（不開瀏覽器）：接口文件 docs/evidence/journey-0440/contracts-0440.md 第 4–7 節；
// 項目編號對應派工單 dispatch/brief-b.md 第 5 節（B1 至 B15），另加 M1–M5（Fable 反審）。
// 用法：node journey-backend-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
// 做法：
//   - 要經伺服器端點的（開局旅程、直接填）各開一個伺服器，埠只用 port、port+1、port+2（run-all 每組 10 個埠）。
//   - 確認後的工作（canvas.json、體檢建議、M1–M3、舊「一起想」、紅方開關）不開伺服器，直接叫外殼 run.mjs，做法同 minutes-run-test.mjs。
//   - 每個情景各自 try／catch，一個中斷不會令其他核對消失；最後一行一定印「n/m passed」。
//   - 這是「先失敗」的驗收閘：功能未完成時會有不通過項目，每項印出實際值，方便實作者對照。
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { certifyDirect, usePass, forgetPass } from '../lib/testkit.mjs';
import { oldInstall } from '../fixtures/old-install.mjs';

const [PROTO, OUT, PORT_ARG, ADAPTER] = process.argv.slice(2);
const PORT = Number(PORT_ARG);
if (!PROTO || !OUT || !Number.isInteger(PORT) || !ADAPTER) throw new Error('缺少測試參數。');
const require = createRequire(import.meta.url);
const imp = file => import(pathToFileURL(path.join(PROTO, file)).href);
const N = require(path.join(PROTO, 'names.js'));
const lib = await imp('ask-lib.mjs');
const MC = await imp('model-cards-lib.mjs');
const store = await imp('canvas-store.mjs');
const minutesLib = await imp('minutes-lib.mjs');
const dash = await imp('dash-lib.mjs');
const LIB = MC.loadModelCards(PROTO);

const results = [];
const ok = (name, pass, info = null) => results.push({ name, pass: !!pass, info: pass ? null : info });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const text = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const CARD = /\b[CS]\d{2}\b/;
const CANVAS_KEYS = ['partners', 'activities', 'resources', 'value', 'relationship', 'channel', 'customer', 'cost', 'revenue'];
const ALL_KEYS = CANVAS_KEYS.concat(['problem', 'alternatives']);
const GOALS = ['fast', 'steady', 'scale', 'raise', 'open'];
const ERR = /TypeError|ReferenceError|is not defined|SyntaxError/;

// 最小 Word 檔（只有 word/document.xml），供旅程附件文字版測試
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC_T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeDocx(sentence) {
  const raw = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${sentence}</w:t></w:r></w:p></w:body></w:document>`, 'utf8');
  const comp = zlib.deflateRawSync(raw), name = Buffer.from('word/document.xml', 'utf8');
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 42);
  const cd = Buffer.concat([ch, name]), off = lh.length + name.length + comp.length;
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([lh, name, comp, cd, eo]);
}
freshTestOut(OUT);
const RUN = path.join(OUT, 'w');
fs.mkdirSync(RUN, { recursive: true });
const servers = [];

// 與 ask-lib dataDirs 相同的資料夾表（不改 process.env）
const dirsOf = data => ({ data, replies: path.join(data, 'founder', 'replies'), inbox: path.join(data, 'founder', 'inbox'), company: path.join(data, 'company'), archive: path.join(data, 'archive'), ledger: path.join(data, 'ledger'), answers: path.join(data, 'ledger', 'answers'), asks: path.join(data, 'asks'), sandbox: path.join(data, 'sandbox'), work: path.join(data, 'work') });
// 畫面文字中的卡號（不含機器欄 card 及 id；id 只供程式對應，不顯示）
function cardHits(value, at = '') {
  if (value == null) return [];
  if (typeof value === 'string') return CARD.test(value) ? [at + '：' + value.slice(0, 80)] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => cardHits(item, at + '[' + i + ']'));
  if (typeof value === 'object') return Object.entries(value).filter(([key]) => key !== 'card' && key !== 'id').flatMap(([key, item]) => cardHits(item, at + '.' + key));
  return [];
}
const section = (md, title) => { const start = md.indexOf('## ' + title); if (start < 0) return ''; const next = md.indexOf('\n## ', start + 1); return md.slice(start, next < 0 ? undefined : next); };
const assumptionsOf = page => { const a = page && page.detail && page.detail.assumptions; return Array.isArray(a) ? a : Array.isArray(a && a.items) ? a.items : []; };
const readingOf = page => Array.isArray(page && page.detail && page.detail.reading) ? page.detail.reading : [];
const fieldOf = (page, plan) => readingOf(page).find(field => field && field.plan === plan) || null;
const aiStarts = data => text(path.join(data, 'ledger', 'ai-starts.log')).split('\n').filter(Boolean).length;
const runsOf = data => (read(path.join(data, 'ledger', 'status.json'), { runs: [] }) || { runs: [] }).runs || [];
const sandboxJobs = data => { const dir = path.join(data, 'sandbox'); let list = []; try { list = fs.readdirSync(dir); } catch { } return list.map(name => ({ name, dir: path.join(dir, name), job: read(path.join(dir, name, 'job.json'), null) })).filter(item => item.job); };
const ops = file => { const list = read(file, []); return Array.isArray(list) ? list : []; };
const ideaCell = (cells, key) => key === 'problem' || key === 'alternatives' ? (cells.customer && cells.customer.sub && cells.customer.sub[key]) || cells[key] || null : cells[key] || null;
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { let value = null; try { value = await fn(); } catch { } if (value) return value; await sleep(200); } return null; }
async function scenario(name, fn) { try { await fn(); } catch (error) { ok(name + '：情景中斷', false, String(error && error.stack || error)); } }

/* ---------- 經伺服器的世界 ---------- */
async function serverWorld(name, port) {
  const data = path.join(RUN, name);
  fs.mkdirSync(data, { recursive: true });
  await certifyDirect(data, PROTO, ADAPTER);
  const child = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(port)], { cwd: PROTO, env: { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  forgetPass(base);
  await usePass(base);
  const get = async url => (await fetch(base + url)).json();
  const post = async (url, body) => { const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }); let json = null; try { json = await response.json(); } catch { } return { code: response.status, json }; };
  if (!await waitFor(async () => (await get('/api/status')).ok, 15000)) throw new Error(name + ' 伺服器未能啟動');
  const world = { name, data, base, DIR: dirsOf(data), get, post, log: () => log, child,
    api: async () => (await get('/api/intake')).ideate,
    file: () => read(path.join(data, 'ledger', 'ideate.json'), null),
    mode: value => { const f = path.join(data, 'fake-mode.txt'); if (value) fs.writeFileSync(f, value + '\n'); else fs.rmSync(f, { force: true }); },
    stop: () => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill(); setTimeout(resolve, 3000); }) };
  servers.push(world);
  return world;
}
const choose = (w, step, ms = 40000) => waitFor(async () => { const s = await w.api(); return s && s.state === 'choose' && s.step === step ? s : null; }, ms);
const settled = (w, ms = 40000) => waitFor(async () => { const s = await w.api(); return s && ['choose', 'failed', 'ready', 'closed'].includes(s.state) ? s : null; }, ms);
const statusRun = (w, pred, ms = 60000) => waitFor(async () => (await w.get('/api/status')).runs.find(run => pred(run) && ['done', 'failed'].includes(run.state)) || null, ms);
function proofreadText(page, order) {
  const machine = { format: 'startup-os.proofread-reply/0.1', page: page.page.id, company: page.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: order[0], decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '' };
  const head = ['kind: proofread', 'ref: ' + page.page.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.proofreadHash(page), 'batch: false', 'shownAt: ' + lib.localIso()];
  return head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n';
}

/* ---------- 只叫外殼的世界（做法同 minutes-run-test.mjs） ---------- */
let worldSeq = 0;
async function shellWorld(name, { old = true } = {}) {
  const data = path.join(RUN, String(++worldSeq).padStart(2, '0') + '-' + name);
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  if (old) oldInstall(data, PROTO);
  const env = { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const DIR = dirsOf(data);
  let outText = '';
  const shell = (...args) => { const r = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...args], { cwd: PROTO, env, encoding: 'utf8', timeout: 180000 }); outText += (r.stdout || '') + (r.stderr || ''); return r; };
  if (old) {
    // 未認證先同步帳本（不開工），清走同步時放上的題包，再認證
    shell('--type', 'rhythm', '--trigger', 'manual');
    for (const dir of [DIR.asks, DIR.answers]) { try { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); } catch { } }
  }
  await certifyDirect(data, PROTO, ADAPTER);
  const stateFile = path.join(DIR.ledger, 'state.json');
  const s = read(stateFile, null);
  if (s) { s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' }; s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' }; write(stateFile, s); }
  return {
    data, DIR, env, shell, out: () => outText,
    mode: value => fs.writeFileSync(path.join(data, 'fake-mode.txt'), value + '\n'),
    page: () => read(path.join(DIR.company, 'page.json'), null),
    confirmed: () => read(path.join(DIR.ledger, 'confirmed.json'), null),
    canvas: () => read(path.join(DIR.ledger, 'canvas.json'), null),
    state: () => read(stateFile, {}),
    log: () => text(path.join(DIR.ledger, 'runs.log')),
    confirm() {
      const page = read(path.join(DIR.company, 'page.json')), c = read(path.join(DIR.ledger, 'confirmed.json'), null);
      const order = c && Array.isArray(c.order) && c.order.length ? c.order.filter(id => page.path.milestones.some(m => m.id === id)) : page.path.milestones.map(m => m.id);
      fs.mkdirSync(DIR.replies, { recursive: true });
      fs.writeFileSync(path.join(DIR.replies, `${Date.now()}-proofread-${page.page.id}.md`), proofreadText(page, order.length ? order : page.path.milestones.map(m => m.id)));
    },
    answer(pack, pick) {
      const answers = pack.questions.map(q => { const value = pick ? pick(q) : q.value; return { id: q.id, value, ai: q.value, changed: JSON.stringify(value) !== JSON.stringify(q.value) }; });
      const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: lib.localIso(), batch: answers.map(a => a.id), answers };
      const head = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + (lib.packHash ? lib.packHash(pack) : lib.fnv(JSON.stringify(pack))), 'batch: false', 'shownAt: ' + lib.localIso()];
      fs.mkdirSync(DIR.replies, { recursive: true });
      fs.writeFileSync(path.join(DIR.replies, `${Date.now()}-ask-answer-${pack.id}.md`), head.join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n');
    },
    note(type, body, machine = null) {
      fs.mkdirSync(DIR.inbox, { recursive: true });
      const id = 'R' + Date.now();
      fs.writeFileSync(path.join(DIR.inbox, `${id}-note-${type}.md`), `kind: note\ntype: ${type}\nat: ${lib.localIso()}\n\n${body}\n` + (machine ? '\n```json\n' + JSON.stringify(machine) + '\n```\n' : ''));
      return id;
    },
    addOps(list) { const file = path.join(DIR.ledger, 'founder-ops.json'); write(file, ops(file).concat(list)); }
  };
}
const packsWithCanvasSug = DIR => { let names = []; try { names = fs.readdirSync(DIR.asks).filter(f => f.endsWith('.json')); } catch { } return names.map(f => read(path.join(DIR.asks, f), null)).filter(p => p && Array.isArray(p.questions) && p.questions.some(q => q && q.canvasSug)); };
const canvasCore = c => c && JSON.stringify({ rev: c.rev, cells: c.cells, history: (c.history || []).length, suggestions: (c.suggestions || []).map(s => [s.id, s.state]) });
// 已確認值：九格加兩個子格，按公司概覽欄位 id 讀 confirmed.values
const confirmedCells = (page, confirmed) => Object.fromEntries(ALL_KEYS.map(key => { const field = fieldOf(page, 'canvas.' + key); return [key, field ? String((confirmed.values || {})[field.id] ?? field.value ?? '') : null]; }));
const cellText = (cells, key) => { const cell = ideaCell(cells || {}, key); return cell ? String(cell.text || '') : null; };
const modelCore = model => model && JSON.stringify({ name: model.name, payer: model.payer, why: model.why, faces: Object.fromEntries(Object.entries(model.faces || {}).map(([face, list]) => [face, Array.isArray(list) ? list.map(pick => pick.card) : list])), trap: model.trap, firstTest: model.firstTest, altCharge: model.altCharge || null });

/* ======================= 一、開局旅程主線（狀態表第 1–14 行、交出起草、確認稿、假設欄位） ======================= */
await scenario('主線', async () => {
  const w = await serverWorld('main', PORT);
  const say = '把新鮮咖啡豆送到沒有時間尋找工房的上班族。';
  const begun = await w.post('/api/ideate', { action: 'start', text: say, files: [] });
  ok('B1-01 起點：開始一起想建檔，running／who', begun.code === 202 && begun.json?.state?.state === 'running' && begun.json?.state?.step === 'who' && begun.json?.state?.v === 2, begun);
  const who = await choose(w, 'who');
  ok('B1-02 對象：外殼核對後 choose／who，剛好三項、一項推薦', !!who && who.who.options.length === 3 && who.who.options.filter(item => item.rec).length === 1 && !!who.who.value, who && who.who);
  const pickWho = await w.post('/api/ideate', { action: 'pickWho', pick: 0 });
  ok('B1-03 選對象：running／model', pickWho.code === 202 && pickWho.json?.state?.state === 'running' && pickWho.json?.state?.step === 'model', pickWho);
  const model = await choose(w, 'model');
  const facePicks = model ? model.model.options.flatMap(o => Object.values(o.faces || {}).filter(Array.isArray).flat()) : [];
  ok('B1-04 模式：至少兩個合格組合，每張卡附中文名', !!model && model.model.options.length >= 2 && facePicks.length > 0 && facePicks.every(p => p.name && p.name === MC.cardLabel(p.card, LIB)), model && model.model.options.map(o => ({ name: o.name, picks: Object.values(o.faces || {}).filter(Array.isArray).flat().map(p => p.card + ':' + p.name) })));
  ok('B1-04b GET /api/intake 不回傳內部欄位 exclude（5.3）', !!model && !('exclude' in model) && !('exclude' in (model.model || {})), model && { top: Object.keys(model), model: Object.keys(model.model || {}) });
  const firstNames = model ? model.model.options.map(o => o.name) : [];
  const more = await w.post('/api/ideate', { action: 'moreModels' });
  const moreModel = await waitFor(async () => { const s = await w.api(); return s && s.state === 'choose' && s.step === 'model' && Number(s.model.asked) === 2 ? s : null; }, 40000);
  const fileAfterMore = w.file();
  ok('B1-05 請 Zero 再提出三個：asked 2，exclude 記下已提名稱，新組合不重複', more.code === 202 && !!moreModel && firstNames.every(n => (fileAfterMore?.model?.exclude || []).includes(n)) && moreModel.model.options.every(o => !firstNames.includes(o.name)), { code: more.code, exclude: fileAfterMore?.model?.exclude, names: moreModel && moreModel.model.options.map(o => o.name) });
  const pickedIndex = 0, pickedModel = moreModel ? moreModel.model.options[pickedIndex] : null;
  const pm = await w.post('/api/ideate', { action: 'pickModel', pick: pickedIndex });
  const g = pm.json && pm.json.state;
  ok('B1-06 選組合：不叫 AI，直接 choose／goal；目標預設為建議，驗證及陷阱取自所選組合', [200, 202].includes(pm.code) && g?.state === 'choose' && g?.step === 'goal' && g.goal === g.model?.goal?.suggest && g.test?.text === pickedModel?.firstTest?.text && g.test?.trap === pickedModel?.trap?.text, { code: pm.code, state: g && { state: g.state, step: g.step, goal: g.goal, suggest: g.model?.goal?.suggest, test: g.test } });
  const edited = String(g?.test?.text || '向首批上班族提出收費試飲。') + '先試兩星期。';
  const sg = await w.post('/api/ideate', { action: 'setGoal', goal: 'steady', test: { text: edited } });
  ok('B1-07 設目標並修改驗證：running／canvas，test.edited 為真', sg.code === 202 && sg.json?.state?.state === 'running' && sg.json?.state?.step === 'canvas' && sg.json?.state?.goal === 'steady' && sg.json?.state?.test?.edited === true, sg.json && sg.json.state && { state: sg.json.state.state, step: sg.json.state.step, goal: sg.json.state.goal, test: sg.json.state.test });
  const canvas = await choose(w, 'canvas');
  const cells = canvas ? canvas.canvas.cells : {};
  const whoPicked = who ? who.who.options[0] : {};
  ok('B1-08 模式圖：九格及對象兩個子格；外殼按已選內容強制出處（5.4）', !!canvas && CANVAS_KEYS.every(k => cells[k]) && !!cells.customer?.sub?.problem && !!cells.customer?.sub?.alternatives && cells.customer.text === whoPicked.who && cells.customer.tag === 'pick' && cellText(cells, 'problem') === whoPicked.pain && cells.value.tag === 'zero' && ['revenue', 'channel', 'partners'].every(k => !cells[k].text || cells[k].tag === 'pick'), canvas && Object.fromEntries(ALL_KEYS.map(k => [k, ideaCell(cells, k)])));
  const relSuggest = String(cells.relationship?.suggest || '');
  const zero = await w.post('/api/ideate', { action: 'zeroCell', key: 'relationship' });
  const afterZero = await w.api();
  ok('B1-09a 未定格按「跟 Zero 建議」：即時填入建議，tag zero，不叫 AI', [200, 202].includes(zero.code) && !!relSuggest && afterZero?.state === 'choose' && afterZero?.canvas?.cells?.relationship?.tag === 'zero' && afterZero.canvas.cells.relationship.text === relSuggest, { code: zero.code, suggest: relSuggest, cell: afterZero?.canvas?.cells?.relationship });
  const own = '包裝、寄送及進貨成本仍待實測。';
  const mine = await w.post('/api/ideate', { action: 'setCell', key: 'cost', text: own });
  const afterMine = await w.api();
  ok('B1-09b 自己寫一格：tag mine，同一狀態存檔', [200, 202].includes(mine.code) && afterMine?.state === 'choose' && afterMine?.canvas?.cells?.cost?.tag === 'mine' && afterMine.canvas.cells.cost.text === own, { code: mine.code, cell: afterMine?.canvas?.cells?.cost });

  // 狀態表第 13 行（2026-11-12 主線定）：上一步保留之後各步結果；選擇不變再前進不叫 AI；選擇改了才清空重做
  let startsBefore = aiStarts(w.data);
  const back = await w.post('/api/ideate', { action: 'back' });
  const bs = back.json && back.json.state;
  ok('B1-13a 上一步：回到 choose／goal，之後各步的結果（包括自己寫的格）保留', [200, 202].includes(back.code) && bs?.state === 'choose' && bs?.step === 'goal' && bs?.canvas?.cells?.cost?.text === own && bs?.canvas?.cells?.cost?.tag === 'mine', bs && { state: bs.state, step: bs.step, cost: bs.canvas?.cells?.cost });
  const again = await w.post('/api/ideate', { action: 'setGoal', goal: 'steady', test: { text: edited } });
  await sleep(2500);
  const st13b = await settled(w);
  ok('B1-13b 選擇不變再前進：直接回到 choose／canvas，不叫 AI，自己寫的格仍在', again.json?.state?.state === 'choose' && again.json?.state?.step === 'canvas' && st13b?.step === 'canvas' && st13b?.canvas?.cells?.cost?.text === own && aiStarts(w.data) === startsBefore, { reply: again.json?.state && { state: again.json.state.state, step: again.json.state.step }, now: st13b && { state: st13b.state, step: st13b.step, cost: st13b.canvas?.cells?.cost }, aiStarts: [startsBefore, aiStarts(w.data)] });
  await choose(w, 'canvas');
  startsBefore = aiStarts(w.data);
  await w.post('/api/ideate', { action: 'back' });
  const toModel = await w.post('/api/ideate', { action: 'back' });
  const same = await w.post('/api/ideate', { action: 'pickModel', pick: pickedIndex });
  const ss = same.json && same.json.state;
  ok('B1-13c 回到模式後選回同一組合：直接回到 choose／goal，已選目標及改過的驗證保留，不叫 AI', toModel.json?.state?.step === 'model' && ss?.state === 'choose' && ss?.step === 'goal' && ss?.goal === 'steady' && ss?.test?.text === edited && aiStarts(w.data) === startsBefore, { back: toModel.json?.state?.step, now: ss && { state: ss.state, step: ss.step, goal: ss.goal, test: ss.test?.text }, aiStarts: [startsBefore, aiStarts(w.data)] });
  await settled(w);
  const changed = await w.post('/api/ideate', { action: 'setGoal', goal: 'fast', test: { text: edited } });
  const redo = await choose(w, 'canvas');
  ok('B1-13d 改了目標：清空之後各步並重做（叫 AI），舊的自己寫格不保留', changed.json?.state?.state === 'running' && !!redo && redo.goal === 'fast' && redo.canvas?.cells?.cost?.text !== own && aiStarts(w.data) > startsBefore, { reply: changed.json?.state && { state: changed.json.state.state, step: changed.json.state.step }, cost: redo?.canvas?.cells?.cost, aiStarts: [startsBefore, aiStarts(w.data)] });
  // 第 14 行：關閉頁面後再開，按檔案狀態回到同一步
  const viaApi = await w.api(), viaFile = w.file();
  ok('B1-14 再開：讀回的狀態與檔案同一步、同一內容', !!viaApi && !!viaFile && viaApi.state === viaFile.state && viaApi.step === viaFile.step && JSON.stringify(viaApi.canvas) === JSON.stringify(viaFile.canvas), { api: viaApi && [viaApi.state, viaApi.step], file: viaFile && [viaFile.state, viaFile.step] });

  // 第 10 行及 5.5：交出起草
  const before = await w.api();
  const submit = await w.post('/api/ideate', { action: 'submit' });
  const intakeId = submit.json?.state?.intakeId || '';
  ok('B1-10a 交出：ready，記 intakeId', submit.code === 202 && submit.json?.state?.state === 'ready' && !!intakeId && w.file()?.state === 'ready', submit);
  const intakeFile = await waitFor(() => { for (const root of [w.DIR.inbox, w.DIR.archive]) { let list = []; try { list = fs.readdirSync(root, { recursive: true }); } catch { } const hit = list.find(f => String(f).endsWith(intakeId + '-intake.md')); if (hit) return path.join(root, hit); } return null; }, 15000);
  const blocks = [...text(intakeFile || '').matchAll(/```json\n([\s\S]*?)\n```/g)];
  const machine = blocks.length ? JSON.parse(blocks[blocks.length - 1][1]) : null;
  const bcells = before?.canvas?.cells || {}, bwho = before?.who?.pick === -1 ? { who: before.who.own, pain: '', now: '' } : (before?.who?.options || [])[before?.who?.pick] || {};
  const bmodel = before?.model?.options?.[before?.model?.pick] || null;
  const f = machine && machine.fields || {};
  const wantFields = { q1: before?.say, q2: bwho.who, q3: bwho.pain, q4: bcells.revenue?.text || '', q5: '', q6: before?.test?.text, q7: bcells.partners?.tag === 'mine' ? bcells.partners.text : '', q8: before?.test?.trap };
  ok('B1-10b 交出收件：八題由旅程產生（5.5），機器區有 journey', !!machine && !!machine.journey && Object.entries(wantFields).every(([k, v]) => String(f[k] ?? '') === String(v ?? '')), { file: intakeFile, fields: f, want: wantFields, journey: !!(machine && machine.journey) });
  // 交出回應不成功時伺服器不會叫外殼；收件已寫入就由測試叫外殼一次，令其後各項（起草、確認稿）仍可核對
  let intakeDone = await waitFor(async () => { const s = await w.get('/api/status'); return s.intake && ['done', 'failed'].includes(s.intake.state) ? s : null; }, submit.code === 202 ? 60000 : 8000);
  if (!intakeDone && intakeFile) {
    spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: w.data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, encoding: 'utf8', timeout: 180000 });
    intakeDone = await waitFor(async () => { const s = await w.get('/api/status'); return s.intake && ['done', 'failed'].includes(s.intake.state) ? s : null; }, 30000);
  }
  const page = read(path.join(w.DIR.company, 'page.json'));
  ok('B3-00 交出後起草完成', intakeDone?.intake?.state === 'done' && !!page, intakeDone && intakeDone.intake);
  if (page) {
    const mismatch = [];
    for (const key of ALL_KEYS) {
      const field = fieldOf(page, 'canvas.' + key), cell = ideaCell(bcells, key);
      if (!field || !cell) { mismatch.push({ key, field: !!field, cell: !!cell }); continue; }
      const wantOrigin = cell.tag === 'mine' ? 'doc' : 'ai';
      // 未定格：草稿可寫成空白、「待你補充」或 origin missing（originTag 同樣當作「未定」，接口文件第 2 節）
      if (cell.tag === 'open' && !String(cell.text || '') && (field.origin === 'missing' || ['', '待你補充', '未定'].includes(String(field.value || '')))) continue;
      if (String(field.value || '') !== String(cell.text || '') || (cell.tag !== 'open' && field.origin !== wantOrigin) || (cell.tag === 'pick') !== (field.picked === true)) mismatch.push({ key, value: field.value, origin: field.origin, picked: field.picked, journey: cell });
    }
    ok('B3-01 起草：九格及兩個子格的文字、出處與旅程相同（AI 寫的被覆蓋）', mismatch.length === 0, mismatch);
    const reading = readingOf(page), goalField = fieldOf(page, 'biz.goal');
    const ti = reading.findIndex(x => x && x.plan === 'biz.type'), gi = reading.findIndex(x => x && x.plan === 'biz.goal');
    const opts = (goalField?.options || []).map(o => typeof o === 'string' ? o : o && o.text);
    ok('B3-02 起草：biz.goal 是第 13 項、排在 biz.type 之後，值為旅程目標，五個選項', !!goalField && gi === ti + 1 && goalField.kind === 'choice' && goalField.value === N.ui['goal_' + before?.goal] && JSON.stringify(opts) === JSON.stringify(GOALS.map(k => N.ui['goal_' + k])) && (goalField.options || []).filter(o => o && o.rec).length === 1, { goalField, index: [ti, gi] });
    ok('B3-03 起草：detail.model 與旅程所選組合相同（起草不重新選卡）', !!bmodel && modelCore(page.detail?.model) === modelCore(bmodel), { draft: page.detail?.model, journey: bmodel });
    const cardFields = JSON.stringify(page.detail?.model || {}).match(/"card":"[^"]*"/g) || [];
    ok('B3-03b 起草：detail.model 的 card 欄保持卡號原樣（用字改寫及標記不可改動機器欄位）', cardFields.length > 0 && cardFields.every(s => /^"card":"[CS]\d{2}"$/.test(s)), cardFields);
    const first = page.path?.milestones?.[0], g5 = (page.glance?.rows || []).find(r => r && r.plan === 'G5');
    ok('B3-04 起草：第一個驗證寫入第一個路線站及「下一個對外動作」（G5）', !!first && JSON.stringify(first).includes(before?.test?.text) && g5?.value === before?.test?.text, { first, g5, test: before?.test?.text });
    const trap = String(before?.test?.trap || '');
    const trapAs = assumptionsOf(page).find(a => String(a.label || a.value || '') === trap);
    ok('B3-05 起草：最大陷阱成為一條假設，帶 cell 及 milestoneIds', !!trap && !!trapAs && !!trapAs.cell && Array.isArray(trapAs.milestoneIds) && trapAs.milestoneIds.length > 0, { trap, assumptions: assumptionsOf(page) });
    ok('B3-06 起草：畫面文字零卡號', cardHits(page).length === 0, cardHits(page));
    ok('B5-01 旅程草稿有十三項生意模式欄位（含 biz.goal）', reading.length === 13 && !!goalField, reading.map(x => x.plan));
    // 確認旅程公司概覽
    const order = page.path.milestones.map(m => m.id);
    const conf = await w.post('/api/submit', { kind: 'proofread', ref: page.page.id, text: proofreadText(page, order) });
    const prun = await statusRun(w, run => run.kind === 'proofread', 90000);
    ok('B6-00 確認旅程公司概覽：外殼完成', [200, 202].includes(conf.code) && prun?.state === 'done', { code: conf.code, run: prun && { state: prun.state, error: prun.error } });
    const cj = read(path.join(w.DIR.ledger, 'canvas.json'));
    ok('M2-00 確認時建立 ledger/canvas.json（rev 1、記 pageId、九格取自確認值）', !!cj && cj.rev === 1 && cj.pageId === page.page.id && cellText(cj.cells, 'customer') === cellText(bcells, 'customer'), cj && { rev: cj.rev, pageId: cj.pageId, customer: cj.cells?.customer });
    const sbs = prun ? sandboxJobs(w.data).filter(item => item.name.startsWith(prun.id)) : [];
    const mdFile = sbs.map(item => path.join(item.dir, 'confirmed-page.md')).find(file => fs.existsSync(file));
    const md = text(mdFile || ''), sec = section(md, N.ui.readingTitle);
    const faceNames = bmodel ? Object.values(bmodel.faces || {}).filter(Array.isArray).flat().map(p => MC.cardLabel(p.card, LIB)).filter(Boolean) : [];
    ok('B6-01 確認稿有「生意模式圖」一節：生意類型、想做成哪種生意、面向中文名稱、九格', !!sec && faceNames.length > 0 && faceNames.every(n => sec.includes(n)) && sec.includes(N.ui['goal_' + before?.goal]) && sec.includes(String(bcells.customer?.text || '')), { file: mdFile, section: sec, faceNames });
    ok('B6-02 確認稿零卡號', !!md && !CARD.test(md), (md.match(/.*\b[CS]\d{2}\b.*/g) || []).slice(0, 5));
    const zsec = section(md, 'Zero 假設（未證實）');
    ok('B6-03 確認稿「Zero 假設（未證實）」印假設內容（label），不是「尚未驗證」一類的值（回歸）', !!zsec && zsec.includes(trap) && !/^- (尚未驗證|未證實|待你補充)\s*$/m.test(zsec), zsec);
    const ledgerAs = (read(path.join(w.DIR.ledger, 'state.json'), {})?.company?.assumptions) || [];
    ok('B7-01 假設經帳本同步後仍帶 cell 及 milestoneIds', ledgerAs.some(a => a.text === trap && a.cell && Array.isArray(a.milestoneIds) && a.milestoneIds.length > 0), ledgerAs.map(a => ({ text: a.text, cell: a.cell, milestoneIds: a.milestoneIds })));
    const ck = sandboxJobs(w.data).filter(item => item.job.type === 'checkup').map(item => read(path.join(item.dir, 'ledger.json'), null)).find(Boolean);
    ok('B7-02 生意體檢提示 hints.lowestForNextStations 不再是空', !!ck && Array.isArray(ck.hints?.lowestForNextStations) && ck.hints.lowestForNextStations.length > 0, ck && ck.hints);
  }
  ok('B1-99 主線伺服器沒有程式錯誤', !ERR.test(w.log()), w.log().split('\n').filter(l => ERR.test(l)).slice(0, 5));
  await w.stop();
});

/* ======================= 二、旅程變化（壞卡、組合完整 M5、對象不合格、AI 失敗、數字） ======================= */
await scenario('旅程變化', async () => {
  const w = await serverWorld('variants', PORT + 1);
  async function fresh(mode) {
    const cur = w.file();
    if (cur) write(path.join(w.DIR.ledger, 'ideate.json'), { ...cur, state: 'closed' });
    w.mode(mode);
    return w.post('/api/ideate', { action: 'start', text: '把新鮮咖啡豆送到沒有時間尋找工房的上班族。', files: [] });
  }
  async function toModel(mode) {
    await fresh(mode);
    if (!await choose(w, 'who')) return await w.api();
    await w.post('/api/ideate', { action: 'pickWho', pick: 0 });
    await sleep(500);
    return settled(w, 45000);
  }
  const repairedModelJobs = () => sandboxJobs(w.data).filter(item => item.job.type === 'journey-model' && item.job.repair === true).map(item => item.name);
  const complete = o => !!(o && o.name && o.payer && o.trap && o.trap.text && o.firstTest && o.firstTest.text && Object.values(o.faces || {}).some(face => Array.isArray(face) && face.some(p => p && p.card)));

  const bad = await toModel('journey-model:journey-bad-card');
  const options = bad?.model?.options || [];
  const faceProblems = options.flatMap(o => MC.checkModelPick(o, LIB, {}).problems.filter(p => ['charge', 'form', 'scale'].includes(p.face)).map(p => o.name + '：' + p.why));
  ok('B2-01 journey-bad-card：不存在的卡及改字原句被清理，組合保留合格部分', bad?.state === 'choose' && bad?.step === 'model' && options.length >= 2 && !JSON.stringify(options).includes('C99') && faceProblems.length === 0 && options.every(complete), { state: bad && [bad.state, bad.step, bad.reason], faceProblems, options: options.map(o => o.faces) });
  if (bad?.state === 'choose') {
    const cur = w.file(); cur.model.asked = 3; write(path.join(w.DIR.ledger, 'ideate.json'), cur);
    const limit = await w.post('/api/ideate', { action: 'moreModels' });
    ok('B1-05b 請 Zero 再提出三個最多再提兩次：asked 3 時回 409', limit.code === 409, limit);
  }

  let seen = repairedModelJobs();
  const inc = await toModel('journey-model:journey-model-incomplete');
  const newRepairs = repairedModelJobs().filter(n => !seen.includes(n));
  ok('M5-1 組合缺陷阱或第一個驗證：修正一次後補上', inc?.state === 'choose' && inc?.step === 'model' && (inc.model.options || []).length === 3 && inc.model.options.every(complete) && newRepairs.length === 1, { state: inc && [inc.state, inc.step, inc.reason], options: inc?.model?.options?.map(o => ({ name: o.name, trap: !!o.trap, firstTest: !!o.firstTest })), repairs: newRepairs });

  const stuck = await toModel('journey-model:journey-model-incomplete-stuck');
  ok('M5-2 修正後仍缺的組合被剔除，其餘兩個照用', stuck?.state === 'choose' && stuck?.step === 'model' && (stuck.model.options || []).length === 2 && stuck.model.options.every(complete) && !stuck.model.options.some(o => o.name === '熟客會籍'), { state: stuck && [stuck.state, stuck.step, stuck.reason], names: stuck?.model?.options?.map(o => o.name) });

  const one = await toModel('journey-model:journey-model-one');
  ok('M5-3 只剩一個合格組合：failed，原因 jrBadModel（第 11 行）', one?.state === 'failed' && one?.step === 'model' && one?.reason === N.ui.jrBadModel, one && { state: one.state, step: one.step, reason: one.reason, options: (one.model?.options || []).length });

  const zt = await toModel('journey-model:journey-model-zero-trap');
  ok('M5-4 Zero 自寫陷阱（沒有卡、zero: true）保留', zt?.state === 'choose' && (zt.model.options || []).some(o => o.trap && !o.trap.card && o.trap.zero === true && String(o.trap.text).startsWith('Zero 自寫')), { state: zt && [zt.state, zt.step, zt.reason], traps: zt?.model?.options?.map(o => o.trap) });

  await fresh('journey-who:journey-who-short\njourney-who:journey-who-short');
  const failedWho = await waitFor(async () => { const s = await w.api(); return s && s.state === 'failed' ? s : null; }, 40000);
  ok('B1-11 對象修正一次後仍不合格：failed／who，原因 jrBadWho', failedWho?.step === 'who' && failedWho?.reason === N.ui.jrBadWho, failedWho && { step: failedWho.step, reason: failedWho.reason });
  w.mode('');
  const retried = await w.post('/api/ideate', { action: 'retry' });
  const recovered = await choose(w, 'who');
  ok('B1-12 再試一次：同一步 running，完成後回到 choose／who', retried.code === 202 && retried.json?.state?.state === 'running' && retried.json?.state?.step === 'who' && !!recovered, { code: retried.code, state: retried.json?.state && [retried.json.state.state, retried.json.state.step] });

  await fresh('journey-who:fail');
  const failed = await waitFor(async () => { const s = await w.api(); return s && s.state === 'failed' ? s : null; }, 40000);
  w.mode('');
  await w.post('/api/ideate', { action: 'retry' });
  const passedRetry = await choose(w, 'who');
  ok('B2-03 journey-fail：failed 後再試一次可完成同一步', failed?.step === 'who' && !!failed?.reason && !!passedRetry, { failed: failed && [failed.state, failed.step, failed.reason], passedRetry: !!passedRetry });

  const d = await toModel('');
  if (d?.state === 'choose' && d.step === 'model') {
    await w.post('/api/ideate', { action: 'pickModel', pick: 0 });
    const goal = await choose(w, 'goal');
    w.mode('journey-canvas:journey-canvas-digits');
    await w.post('/api/ideate', { action: 'setGoal', goal: goal?.model?.goal?.suggest || 'open', test: { text: goal?.test?.text || '向首批顧客提出收費試用。' } });
  }
  const dc = await choose(w, 'canvas');
  ok('B2-02 journey-canvas-digits：不是創辦人寫的數字令該格改為 open、文字清空、建議照留', dc?.canvas?.cells?.cost?.tag === 'open' && dc.canvas.cells.cost.text === '' && !!dc.canvas.cells.cost.suggest, dc && dc.canvas.cells.cost);
  ok('B2-99 旅程變化伺服器沒有程式錯誤', !ERR.test(w.log()), w.log().split('\n').filter(l => ERR.test(l)).slice(0, 5));
  await w.stop();
});

/* ======================= 三、直接填（沒有旅程）：選卡核對、16 條診斷、改寫回歸 ======================= */
await scenario('直接填', async () => {
  const w = await serverWorld('direct', PORT + 2);
  const fields = { q1: '把本地小型烘焙工房的新鮮咖啡豆賣給上班族（測試）', q2: '訂戶按月付款', q3: '兩間工房有興趣', q4: '約第三間工房見面', q5: '自己包裝寄貨', q6: '季末三十位訂戶' };
  async function intake(mode) {
    const before = (await w.get('/api/status')).intake;
    const logBefore = text(path.join(w.DIR.ledger, 'runs.log')).length;
    w.mode(mode);
    const sent = await w.post('/api/intake', { bizType: 'other', fields, files: [] });
    const s = await waitFor(async () => { const st = await w.get('/api/status'); const i = st.intake; return i && i.runId && (!before || i.runId !== before.runId) && ['done', 'failed'].includes(i.state) && st.runs.find(r => r.id === i.runId && r.state !== 'running') ? st : null; }, 60000);
    const page = read(path.join(w.DIR.company, 'page.json'));
    return { sent, run: s && s.runs.find(r => r.id === s.intake.runId), page, log: text(path.join(w.DIR.ledger, 'runs.log')).slice(logBefore) };
  }
  const a = await intake('intake:intake-bad-card');
  const model = a.page?.detail?.model;
  const check = model ? MC.checkModelPick(model, LIB, { needDiagnosis: true }) : null;
  ok('B4-01 直接填 intake-bad-card：修正一次後合格（沒有不存在的卡，16 項診斷）', a.run?.state === 'done' && !!model && !JSON.stringify(model.faces || {}).includes('C99') && check?.ok && (model.diagnosis || []).length === 16 && /修正一次/.test(a.log), { run: a.run && [a.run.state, a.run.error], problems: check && check.problems, diagnosis: (model?.diagnosis || []).length, log: a.log.slice(-600) });
  ok('B5-02 直接填新草稿有十三項，含 biz.goal', readingOf(a.page).length === 13 && !!fieldOf(a.page, 'biz.goal'), readingOf(a.page).map(x => x.plan));
  const b = await intake('intake:intake-short-diagnosis');
  ok('B4-02 診斷題不足 16 項時退回修正一次，最後有 16 項', b.run?.state === 'done' && /16/.test(b.log) && /修正一次/.test(b.log) && (b.page?.detail?.model?.diagnosis || []).length === 16, { run: b.run && [b.run.state, b.run.error], diagnosis: (b.page?.detail?.model?.diagnosis || []).length, log: b.log.slice(-600) });
  const c = await intake('intake:intake-jargon-badcard');
  const g1 = (c.page?.glance?.rows || []).find(r => r && r.plan === 'G1') || (c.page?.glance?.rows || [])[0] || {};
  ok('B4-03 改寫回歸（intake-jargon-badcard）：選卡核對不會令改寫好的內部用語還原', c.run?.state === 'done' && !/\bG1\b|\brun\b/.test(String(g1.value || '')) && !JSON.stringify(c.page?.detail?.model?.faces || {}).includes('C99'), { run: c.run && [c.run.state, c.run.error, c.run.result && c.run.result.styleWarnings], g1: g1.value, log: c.log.slice(-800) });
  // 第二輪覆核第 8 項：journeyProvenance 不可由 /api/intake 請求內容提供；值為 null 不可回 500
  const intakeFileOf = id => { for (const root of [w.DIR.inbox, w.DIR.archive]) { let list = []; try { list = fs.readdirSync(root, { recursive: true }); } catch { } const hit = list.find(f => id && String(f).endsWith(id + '-intake.md')); if (hit) return path.join(root, hit); } return null; };
  const machineOf = file => { const b = [...text(file || '').matchAll(/```json\n([\s\S]*?)\n```/g)]; return b.length ? JSON.parse(b[b.length - 1][1]) : null; };
  const r8a = await w.post('/api/intake', { bizType: 'other', fields, files: [], journey: { say: fields.q1 }, journeyProvenance: null });
  ok('R2-8a /api/intake 帶 journeyProvenance: null 不回 500', r8a.code < 500, r8a);
  const r8b = await w.post('/api/intake', { bizType: 'other', fields, files: [], journey: { say: fields.q1 }, journeyProvenance: { q2: { kind: 'adopted', from: 'ideate', source: '偽造' }, q3: { kind: 'adopted', from: 'ideate', source: '偽造' } } });
  const m8b = machineOf(await waitFor(() => intakeFileOf(r8b.json && r8b.json.id), 10000));
  ok('R2-8b 請求內容的 journeyProvenance 不被採用：整個請求被拒（4xx），或收件 q2、q3 仍記「你寫的」', (r8b.code >= 400 && r8b.code < 500) || ([200, 202].includes(r8b.code) && m8b?.provenance?.q2?.kind === 'founder' && m8b?.provenance?.q3?.kind === 'founder'), { code: r8b.code, provenance: m8b && m8b.provenance });
  ok('B4-99 直接填伺服器沒有程式錯誤', !ERR.test(w.log()), w.log().split('\n').filter(l => ERR.test(l)).slice(0, 5));
  await w.stop();
});

/* ======================= 四、舊公司概覽（十二項）確認、同步、體檢建議、M2 ======================= */
await scenario('舊公司概覽及體檢建議', async () => {
  const W = await shellWorld('old-twelve');
  const page0 = W.page();
  W.mode('checkup:checkup-suggest');
  W.confirm();
  W.shell();
  const prun = runsOf(W.data).find(run => run.kind === 'proofread');
  const stateAs = W.state()?.company?.assumptions || [];
  ok('B5-03 舊公司概覽（十二項、沒有 biz.goal）確認、同步、體檢都不出錯', readingOf(page0).length === 12 && prun?.state === 'done' && fs.existsSync(path.join(W.DIR.ledger, 'brain', 'checkup.json')) && stateAs.length >= 3 && !ERR.test(W.out() + W.log()), { reading: readingOf(page0).length, run: prun && [prun.state, prun.error], checkup: fs.existsSync(path.join(W.DIR.ledger, 'brain', 'checkup.json')), errors: (W.out() + W.log()).split('\n').filter(l => ERR.test(l)).slice(0, 5) });
  const cj = W.canvas();
  ok('M2-01 舊實例確認時建立 canvas.json（rev 1、pageId、九格為確認值）', !!cj && cj.rev === 1 && cj.pageId === page0.page.id && ALL_KEYS.every(k => cellText(cj.cells, k) === confirmedCells(page0, W.confirmed())[k]), cj && { rev: cj.rev, pageId: cj.pageId, cells: cj.cells, want: confirmedCells(page0, W.confirmed()) });
  const sug = (cj?.suggestions || []).find(s => s.from === 'checkup');
  const packs = packsWithCanvasSug(W.DIR);
  const pack = sug && read(path.join(W.DIR.asks, sug.packId + '.json'), null);
  ok('B8-01 體檢 canvasSuggest：建議寫入 canvas.json，待決事項有一個問題包（題目帶 canvasSug）', !!sug && sug.state === 'open' && sug.cell === 'revenue' && !!pack && pack.questions.some(q => q.canvasSug && q.canvasSug.id === sug.id) && packs.length === 1, { suggestions: cj?.suggestions, packs: packs.map(p => p.id) });
  if (!sug || !pack) return;
  W.answer(pack, q => q.canvasSug ? N.ui.cvAdopt : q.value);
  W.shell(); W.shell();
  const cj2 = W.canvas(), sug2 = (cj2?.suggestions || []).find(s => s.id === sug.id);
  ok('B8-02 在待決事項答「採用」：該格更新、history 多一版、建議 adopted', !!cj2 && cellText(cj2.cells, 'revenue') === sug.text && (cj2.history || []).length === (cj.history || []).length + 1 && sug2?.state === 'adopted' && cj2.rev === cj.rev + 1, cj2 && { revenue: cj2.cells?.revenue, history: (cj2.history || []).length, suggestion: sug2, rev: cj2.rev });
  // 同一操作合併兩次：把同一個操作（同一 id）再放入創辦人操作檔
  const opId = 'canvas-suggestion-' + pack.id;
  W.addOps([{ id: opId, at: lib.localIso(), op: 'canvasSugAnswer', target: sug.id, value: { action: 'adopt' } }]);
  W.shell();
  const cj3 = W.canvas();
  ok('B8-03 同一操作合併兩次：canvas.json 不變', canvasCore(cj3) === canvasCore(cj2), { before: canvasCore(cj2), after: canvasCore(cj3) });
  // M2：改一格、答一個建議（上面）、留一個未答建議後，同一份公司概覽再確認
  const newValue = '新鮮烘焙咖啡豆每月送到府上，附口味介紹。';
  const rev = store.readCanvas(W.DIR, { proto: PROTO }).view?.rev;
  W.addOps([{ id: 'op-m2-edit', at: lib.localIso(), op: 'canvasEdit', target: 'value', value: { text: newValue, forRev: rev } }]);
  W.shell();
  const cjE = W.canvas();
  ok('M2-02 改一格：canvas.json 更新、上一版保留、tag mine', cellText(cjE?.cells, 'value') === newValue && cjE.cells.value.tag === 'mine' && (cjE.history || []).length === (cj3?.history || []).length + 1, cjE && { value: cjE.cells?.value, history: (cjE.history || []).length, forRev: rev });
  // 第二次體檢（同一份公司概覽）：刪去體檢結果令確認後再做一次；建議另一格（成本），免與已答的收入格問題包同名
  fs.rmSync(path.join(W.DIR.ledger, 'brain', 'checkup.json'), { force: true });
  W.mode('checkup:checkup-suggest-cost');
  W.confirm(); W.shell();
  const cjS = W.canvas(), open2 = (cjS?.suggestions || []).find(s => s.state === 'open' && s.id !== sug.id);
  ok('M2-03 同一份公司概覽再確認（第二次體檢）：不重建，已改的格及上一版保留，新建議放入', cellText(cjS?.cells, 'value') === newValue && (cjS?.history || []).length >= (cjE?.history || []).length && !!open2 && !!read(path.join(W.DIR.asks, String(open2.packId) + '.json'), null), cjS && { value: cjS.cells?.value, history: (cjS.history || []).length, suggestions: cjS.suggestions });
  W.confirm(); W.shell();
  const cjR = W.canvas(), open2R = (cjR?.suggestions || []).find(s => open2 && s.id === open2.id);
  ok('M2-04 再確認同一份：已改的格、上一版、未答的建議（及其問題包）全部保留', cellText(cjR?.cells, 'value') === newValue && (cjR?.history || []).length === (cjS?.history || []).length && open2R?.state === 'open' && !!read(path.join(W.DIR.asks, String(open2?.packId) + '.json'), null) && (cjR?.suggestions || []).find(s => s.id === sug.id)?.state === 'adopted', cjR && { value: cjR.cells?.value, history: (cjR.history || []).length, suggestions: cjR.suggestions });
  // 換一份新公司概覽確認
  const page = W.page(), oldId = page.page.id, newRevenue = '按次收費，每包另計運費。';
  page.page.id = oldId + '-v2';
  const rf = fieldOf(page, 'canvas.revenue'); if (rf) rf.value = newRevenue;
  write(path.join(W.DIR.company, 'page.json'), page);
  W.confirm(); W.shell();
  const cjN = W.canvas(), open2N = (cjN?.suggestions || []).find(s => open2 && s.id === open2.id);
  ok('M2-05 換一份新公司概覽確認：舊九格入 history、未答建議改 rejected 並收回問題包', cjN?.pageId === page.page.id && cellText(cjN.cells, 'revenue') === newRevenue && cellText(cjN.history?.[0]?.cells, 'value') === newValue && /換新公司概覽/.test(String(cjN.history?.[0]?.why || '')) && open2N?.state === 'rejected' && !fs.existsSync(path.join(W.DIR.asks, String(open2?.packId) + '.json')), cjN && { pageId: cjN.pageId, revenue: cjN.cells?.revenue, history0: cjN.history?.[0], suggestion: open2N, packLeft: open2 && fs.existsSync(path.join(W.DIR.asks, String(open2.packId) + '.json')) });
});

/* ======================= 五、M1 舊安裝第一次改格、M3 單一取值、討論背景、紅方開關 ======================= */
await scenario('M1 及 M3', async () => {
  const W = await shellWorld('m1-m3');
  const page = W.page(), confirmed = W.confirmed();
  const brief0 = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--brief'], { cwd: PROTO, env: W.env, encoding: 'utf8', timeout: 60000 });
  const line0 = String(brief0.stdout || '').split('\n').find(l => l.startsWith(N.ui.readingTitle + '：')) || '';
  ok('B10-1 討論背景：舊實例沒有 canvas.json 時照常輸出九格精簡版', brief0.status === 0 && !fs.existsSync(path.join(W.DIR.ledger, 'canvas.json')) && !!line0 && line0.includes(confirmedCells(page, confirmed).customer.slice(0, 10)), { status: brief0.status, line: line0, err: brief0.stderr });
  const parts = line0.slice((N.ui.readingTitle + '：').length).split('；').map(p => p.split('：').slice(1).join('：'));
  ok('B10-2 討論背景的九格精簡版：每格最多 40 字（7 節）', parts.length >= 9 && parts.every(p => [...p].length <= 40), parts.map(p => [...p].length + '：' + p));
  const newRevenue = '按季預繳，每季收一次訂閱費。';
  const rev0 = store.readCanvas(W.DIR, { proto: PROTO }).view?.rev;
  W.addOps([{ id: 'op-m1-edit', at: lib.localIso(), op: 'canvasEdit', target: 'revenue', value: { text: newRevenue, forRev: rev0 } }]);
  W.shell();
  const cj = W.canvas(), want = confirmedCells(page, confirmed);
  const others = ALL_KEYS.filter(k => k !== 'revenue');
  ok('M1-1 舊安裝第一次改格：寫出 canvas.json，其餘八格（及兩個子格）與確認值相同、不是空白', !!cj && others.every(k => cellText(cj.cells, k) === want[k] && !!want[k]), { forRev: rev0, canvas: cj && cj.cells, want });
  ok('M1-2 舊安裝第一次改格：用畫面讀到的版本號（GET /api/canvas 的 rev）送出的修改要生效', !!cj && cellText(cj.cells, 'revenue') === newRevenue && cj.cells.revenue.tag === 'mine', { forRev: rev0, baseRev: cj && cj.rev, revenue: cj && cj.cells && cj.cells.revenue });
  // M3：單一取值——確認稿、討論背景、業績頁「計劃」、會議紀錄都顯示新值。
  // 與 M1 分開：如 M1 的修改未生效，這裏按 canvas.json 現時版本號再改一次，令 M3 可獨立核對。
  if (cellText(W.canvas()?.cells, 'revenue') !== newRevenue) {
    W.addOps([{ id: 'op-m3-edit', at: lib.localIso(), op: 'canvasEdit', target: 'revenue', value: { text: newRevenue, forRev: store.readCanvas(W.DIR, { proto: PROTO }).view?.rev } }]);
    W.shell();
  }
  W.note('event', '這件事沒有新進展。'); W.shell();
  const evRun = runsOf(W.data).find(run => run.kind === 'note');
  const md = evRun ? text(path.join(W.DIR.sandbox, evRun.id, 'confirmed-page.md')) : '';
  ok('M3-1 改格後確認稿（工作沙盒 confirmed-page.md）「生意模式圖」一節顯示新值', section(md, N.ui.readingTitle).includes(newRevenue), { run: evRun && [evRun.id, evRun.state], section: section(md, N.ui.readingTitle) });
  const brief = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--brief'], { cwd: PROTO, env: W.env, encoding: 'utf8', timeout: 60000 });
  ok('M3-2 改格後討論背景（ask.mjs --brief）顯示新值', brief.status === 0 && String(brief.stdout).includes(newRevenue), { status: brief.status, line: String(brief.stdout || '').split('\n').find(l => l.startsWith(N.ui.readingTitle)) });
  const money = dash.moneyView(W.DIR, { today: lib.localIso().slice(0, 10), full: true });
  ok('M3-3 改格後業績頁「計劃」收入顯示新值', money?.plan?.income === newRevenue, money && money.plan);
  const lines = minutesLib.overviewLines(page, W.confirmed(), store.readCanvas(W.DIR, { proto: PROTO }));
  ok('M3-4 改格後會議紀錄的公司概覽行（overviewLines 經 readCanvas）顯示新值，小標題為「生意模式圖」', lines.some(l => l.includes(newRevenue)) && lines.includes(N.ui.readingTitle), lines);
  // Opus 覆核第 8 項：改格後時間線事件用專屬標題，不是「取消暫緩」
  const founderEvents = (W.state().events || []).filter(e => e && e.type === 'founder-op');
  ok('OPUS-8 改模式圖後時間線事件標題正確（不是「取消暫緩」）', founderEvents.length > 0 && founderEvents.every(e => e.title !== N.ui.founderUnsnoozed) && founderEvents.some(e => e.title === N.ui.cvEditSaved), founderEvents.map(e => e.title));
  // Opus 覆核第 10 項：對方的問題、現有替代方案在確認稿、討論背景、會議紀錄都有
  const sub = confirmedCells(page, confirmed);
  const briefText = String(brief.stdout || '');
  const has = s => !!sub.problem && !!sub.alternatives && s.includes(sub.problem) && s.includes(sub.alternatives);
  ok('OPUS-10 對方的問題及現有替代方案：確認稿、討論背景、會議紀錄都有', has(section(md, N.ui.readingTitle)) && has(briefText.split('\n').find(l => l.startsWith(N.ui.readingTitle)) || '') && has(lines.join('\n')), { problem: sub.problem, alternatives: sub.alternatives, confirmedPage: has(section(md, N.ui.readingTitle)), brief: has(briefText), minutes: has(lines.join('\n')) });
  // 第二輪覆核第 9 項：確認時空白、確認後才在模式圖補寫的格，會議紀錄背景也要有
  const costField = fieldOf(page, 'canvas.cost'), lateCost = '確認後補寫：每包成本待工房報價。';
  W.addOps([{ id: 'op-r2-9', at: lib.localIso(), op: 'canvasEdit', target: 'cost', value: { text: lateCost, forRev: store.readCanvas(W.DIR, { proto: PROTO }).view?.rev } }]);
  W.shell();
  const c9 = { ...W.confirmed(), values: { ...(W.confirmed().values || {}), ...(costField ? { [costField.id]: '' } : {}) } };
  const lines9 = minutesLib.overviewLines(page, c9, store.readCanvas(W.DIR, { proto: PROTO }));
  ok('R2-9 確認後才在模式圖補寫的格（確認時空白）出現在會議紀錄背景', lines9.some(l => l.includes(lateCost)), { canvasCost: W.canvas()?.cells?.cost, lines: lines9 });
  // 紅方用陷阱（S10）：開關 MODEL_TRAPS_IN_DEBATE 是 run.mjs 內的常數，測試不能切換；只驗預設關閉
  W.mode('debate-red:red-trap');
  W.note('debate-start', '每月訂閱定價', { topicType: 'pricing', title: '每月訂閱定價', seats: ['付款者', '競爭者'], level: 'hard', targetId: '' });
  for (let i = 0; i < 6 && !sandboxJobs(W.data).some(item => item.job.type === 'debate-red'); i++) W.shell();
  const debateSbs = sandboxJobs(W.data).filter(item => String(item.job.type).startsWith('debate-'));
  ok('B9-1 紅方陷阱開關預設關閉：辯論沙盒沒有 model-traps.md，job 不標 modelTraps', debateSbs.some(item => item.job.type === 'debate-red') && debateSbs.every(item => !fs.existsSync(path.join(item.dir, 'model-traps.md')) && item.job.modelTraps !== true), debateSbs.map(item => ({ name: item.name, type: item.job.type, modelTraps: item.job.modelTraps, file: fs.existsSync(path.join(item.dir, 'model-traps.md')) })));
});

/* ======================= 六、舊「一起想」（第 15、16 行） ======================= */
await scenario('舊一起想', async () => {
  const A = await shellWorld('legacy-asking', { old: false });
  write(path.join(A.DIR.ledger, 'ideate.json'), { id: 'legacy-run', state: 'asking', say: '舊構思', round: 1, rounds: [{ round: 1, packId: 'legacy-pack' }] });
  write(path.join(A.DIR.asks, 'legacy-pack.json'), { id: 'legacy-pack', format: 'startup-os.ask/0.1', title: '和 Zero 一起想：了解對象及問題', ideate: { id: 'legacy-run', round: 1 }, questions: [{ id: 'who', ask: '你想先了解哪一類小生意？', kind: 'text', value: '', why: '測試' }] });
  fs.mkdirSync(A.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(A.DIR.inbox, 'legacy-run-note-ideate.md'), 'kind: note\ntype: ideate\n\n舊構思\n');
  const r = A.shell();
  const s = read(path.join(A.DIR.ledger, 'ideate.json'));
  const listed = (() => { try { return lib.listPacks(A.DIR).map(p => p && (p.id || p)); } catch (e) { return ['讀取失敗：' + e.message]; } })();
  ok('B15-1 舊格式 asking：當作 closed、reason upgraded，舊問題包從待決事項收回', r.status === 0 && s?.state === 'closed' && s?.reason === 'upgraded' && !fs.existsSync(path.join(A.DIR.asks, 'legacy-pack.json')) && !listed.includes('legacy-pack'), { status: r.status, state: s, listed });
  const B = await shellWorld('legacy-running', { old: false });
  write(path.join(B.DIR.ledger, 'ideate.json'), { id: 'legacy-running', state: 'running', say: '舊構思二', rounds: [] });
  fs.mkdirSync(B.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(B.DIR.inbox, 'legacy-running-note-ideate.md'), 'kind: note\ntype: ideate\n\n舊構思二\n');
  B.shell();
  const sb = read(path.join(B.DIR.ledger, 'ideate.json'));
  ok('B15-2 舊格式 running：當作 closed、reason upgraded，構思保留作預填', sb?.state === 'closed' && sb?.reason === 'upgraded' && sb?.say === '舊構思二' && !sandboxJobs(B.data).some(item => /^ideate-|^journey-/.test(item.job.type)), sb);
  const C = await shellWorld('legacy-ready', { old: false });
  const readyFile = path.join(C.DIR.ledger, 'ideate.json');
  write(readyFile, { id: 'legacy-ready', state: 'ready', say: '舊構思三', prefillId: 'pf-legacy', rounds: [] });
  const bytes = fs.readFileSync(readyFile, 'utf8');
  fs.mkdirSync(C.DIR.inbox, { recursive: true });
  fs.writeFileSync(path.join(C.DIR.inbox, 'legacy-ready-note-ideate.md'), 'kind: note\ntype: ideate\n\n舊構思三\n');
  C.shell();
  ok('B15-3 舊格式 ready：不受影響（檔案不變、不叫 AI）', fs.readFileSync(readyFile, 'utf8') === bytes && !sandboxJobs(C.data).some(item => /^ideate-|^journey-/.test(item.job.type)), fs.readFileSync(readyFile, 'utf8'));
});

/* ======================= 七、Opus 覆核 15 項（docs/evidence/journey-0440/review-opus.md） ======================= */
const SAY = '把新鮮咖啡豆送到沒有時間尋找工房的上班族。';
const v2State = patch => ({ v: 2, id: 'opus-' + Date.now(), state: 'running', step: 'who', reason: '', updatedAt: lib.localIso(), say: SAY, files: [], who: { said: '', value: '', options: [], pick: 0, own: '' }, model: { said: '', options: [], pick: 0, asked: 1, exclude: [], goal: { suggest: 'open', why: '' } }, goal: 'open', goalBy: 'pick', test: { text: '', watch: '', counts: '', trap: '', edited: false }, canvas: { cells: {}, said: '' }, intakeId: '', ...patch });
const nonEmptyCells = cells => Object.entries(cells || {}).filter(([, c]) => c && String(c.text || '').trim()).map(([k]) => k);
async function freshJourney(w, mode, text = SAY, files = []) {
  const cur = w.file();
  if (cur) write(path.join(w.DIR.ledger, 'ideate.json'), { ...cur, state: 'closed' });
  w.mode(mode);
  return w.post('/api/ideate', { action: 'start', text, files });
}
async function submitAndDraft(w) {
  const before = await w.api();
  const submit = await w.post('/api/ideate', { action: 'submit' });
  const intakeId = submit.json?.state?.intakeId || w.file()?.intakeId || '';
  const intakeFile = await waitFor(() => { for (const root of [w.DIR.inbox, w.DIR.archive]) { let list = []; try { list = fs.readdirSync(root, { recursive: true }); } catch { } const hit = list.find(f => intakeId && String(f).endsWith(intakeId + '-intake.md')); if (hit) return path.join(root, hit); } return null; }, 15000);
  let done = await waitFor(async () => { const s = await w.get('/api/status'); return s.intake && ['done', 'failed'].includes(s.intake.state) ? s : null; }, submit.code === 202 ? 60000 : 8000);
  if (!done && intakeFile) {
    spawnSync(process.execPath, [path.join(PROTO, 'run.mjs')], { cwd: PROTO, env: { ...process.env, SOS_DATA: w.data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' }, encoding: 'utf8', timeout: 180000 });
    done = await waitFor(async () => { const s = await w.get('/api/status'); return s.intake && ['done', 'failed'].includes(s.intake.state) ? s : null; }, 30000);
  }
  // 封存後的收件檔在 archive/<月>/intake-<id>/ 內
  const archived = await waitFor(() => { let list = []; try { list = fs.readdirSync(w.DIR.archive, { recursive: true }); } catch { } const hit = list.find(f => intakeId && String(f).endsWith(intakeId + '-intake.md')); return hit ? path.join(w.DIR.archive, hit) : null; }, 20000);
  const file = archived || intakeFile;
  const blocks = [...text(file || '').matchAll(/```json\n([\s\S]*?)\n```/g)];
  return { before, submit, intakeId, file, intakeText: text(file || ''), machine: blocks.length ? JSON.parse(blocks[blocks.length - 1][1]) : null, done, page: read(path.join(w.DIR.company, 'page.json')) };
}

await scenario('OPUS 附件、再提三個、出處', async () => {
  const w = await serverWorld('opus-a', PORT + 3);
  const plan = '# 計劃\n\n每月寄一包新鮮咖啡豆給上班族。\n';
  const b64 = Buffer.from(plan).toString('base64');
  const begun = await w.post('/api/ideate', { action: 'start', text: SAY, files: [{ name: '計劃.md', data: b64 }] });
  const raw = text(path.join(w.DIR.ledger, 'ideate.json'));
  const st0 = w.file();
  ok('OPUS-5a 附件：ideate.json 不含 base64 原文，files 只記 name／stored／bytes', begun.code === 202 && !!st0 && !raw.includes(b64) && Array.isArray(st0.files) && st0.files.length === 1 && st0.files.every(f => f && Object.keys(f).every(k => ['name', 'stored', 'bytes'].includes(k)) && f.name && f.stored && Number.isInteger(f.bytes)), { code: begun.code, files: st0 && st0.files && st0.files.map(f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, typeof v === 'string' && v.length > 60 ? v.slice(0, 30) + '…（' + v.length + ' 字）' : v]))), bytes: raw.length });
  const who = await choose(w, 'who');
  const whoSb = sandboxJobs(w.data).find(item => item.job.type === 'journey-who');
  const sbFiles = whoSb ? (() => { try { return fs.readdirSync(path.join(whoSb.dir, 'files')); } catch { return []; } })() : [];
  ok('OPUS-5b 附件：旅程沙盒 files/ 內有該檔（AI 讀得到原文，不是 base64）', !!who && sbFiles.some(f => f.endsWith('計劃.md')) && sbFiles.some(f => f.endsWith('計劃.md') && text(path.join(whoSb.dir, 'files', f)).includes('每月寄一包')), { sandbox: whoSb && whoSb.name, files: sbFiles });
  await w.post('/api/ideate', { action: 'pickWho', pick: 0 });
  const m1 = await choose(w, 'model');
  await w.post('/api/ideate', { action: 'pickModel', pick: 0 });
  const g1 = await choose(w, 'goal');
  await w.post('/api/ideate', { action: 'setGoal', goal: g1?.goal || 'open', test: { text: g1?.test?.text || '' } });
  await choose(w, 'canvas');
  await w.post('/api/ideate', { action: 'back' });
  await w.post('/api/ideate', { action: 'back' });
  await choose(w, 'model', 10000);
  await w.post('/api/ideate', { action: 'moreModels' });
  const m2 = await waitFor(async () => { const s = await w.api(); return s && s.state === 'choose' && s.step === 'model' && Number(s.model.asked) === 2 ? s : null; }, 40000);
  const f2 = w.file();
  ok('OPUS-1a 再提三個後：未選新組合（pick 不指向新卡）、第一個驗證及九格已清空', !!m2 && f2.model.pick < 0 && !f2.test?.text && !f2.test?.trap && nonEmptyCells(f2.canvas?.cells).length === 0, { pick: f2?.model?.pick, test: f2?.test, cells: nonEmptyCells(f2?.canvas?.cells), oldFirst: m1 && m1.model.options[0].name, newFirst: m2 && m2.model.options[0].name });
  const startsBefore = aiStarts(w.data);
  const pm = await w.post('/api/ideate', { action: 'pickModel', pick: 0 });
  const g2 = await choose(w, 'goal', 15000);
  const newFirst = m2 ? m2.model.options[0] : null;
  ok('OPUS-1b 選新的第 0 個：第 4 步的驗證、陷阱來自新組合，九格未沿用舊組合', !!g2 && !!newFirst && g2.test?.text === newFirst.firstTest?.text && g2.test?.trap === newFirst.trap?.text && nonEmptyCells(g2.canvas?.cells).length === 0, { code: pm.code, test: g2 && g2.test, want: newFirst && { text: newFirst.firstTest?.text, trap: newFirst.trap?.text }, cells: nonEmptyCells(g2?.canvas?.cells) });
  w.mode('journey-canvas:journey-canvas-selftag');
  await w.post('/api/ideate', { action: 'setGoal', goal: 'steady', test: { text: g2?.test?.text || '' } });
  const cv = await choose(w, 'canvas');
  ok('OPUS-1c 選新組合後前進：重新叫 AI 填九格', !!cv && aiStarts(w.data) > startsBefore, { aiStarts: [startsBefore, aiStarts(w.data)] });
  ok('OPUS-3a AI 自報 mine／pick 的非強制格（關鍵活動、關鍵資源）改為 zero', cv?.canvas?.cells?.activities?.tag === 'zero' && cv?.canvas?.cells?.resources?.tag === 'zero', cv && { activities: cv.canvas.cells.activities, resources: cv.canvas.cells.resources });
  const r = await submitAndDraft(w);
  const pv = r.machine && r.machine.provenance || {};
  const adopted = q => pv[q] && pv[q].kind !== 'founder' && pv[q].from === 'ideate';
  ok('OPUS-2a 旅程收件出處：q1 為「你寫的」，Zero 建議的對象、麻煩、收入、驗證、陷阱為「你認同的 Zero 建議…不是原句」', pv.q1?.kind === 'founder' && ['q2', 'q3', 'q4', 'q6', 'q8'].every(adopted) && r.intakeText.includes('你認同的 Zero 建議') && /不是原句/.test(r.intakeText), { provenance: pv, file: r.file });
  ok('OPUS-5c 附件：交出後起草收件帶該附件', !!r.machine && (r.machine.files || []).length === 1 && !!r.file && fs.readdirSync(path.dirname(r.file)).some(f => f !== path.basename(r.file) && f.endsWith('計劃.md')), { files: r.machine && r.machine.files, dir: r.file && fs.readdirSync(path.dirname(r.file)) });
  const page = r.page;
  const docFields = ['customer', 'problem', 'alternatives', 'revenue', 'channel', 'partners'].map(k => fieldOf(page, 'canvas.' + k)).filter(f => f && f.origin === 'doc');
  ok('OPUS-2b 起草後，來自 Zero 建議的項目不是 origin doc', !!page && docFields.length === 0, docFields.map(f => [f.plan, f.value, f.origin]));
  const openFields = ['relationship', 'cost'].map(k => fieldOf(page, 'canvas.' + k));
  ok('OPUS-3b 未定格起草後寫「待你補充」、origin missing（不是 Zero 建議）', !!page && openFields.every(f => f && f.value === '待你補充' && f.origin === 'missing'), openFields.map(f => f && [f.plan, f.value, f.origin]));
  const goalField = fieldOf(page, 'biz.goal');
  ok('OPUS-3c 旅程中自己選的目標（非 Zero 建議）起草後 picked 為真', !!goalField && goalField.value === N.ui.goal_steady && goalField.picked === true && goalField.origin === 'ai', goalField);
  await w.stop();
});

await scenario('OPUS 卡號、數字、自己寫對象、組合剔除', async () => {
  const w = await serverWorld('opus-b', PORT + 4);
  async function toCanvas(mode, text = SAY, own = '') {
    await freshJourney(w, mode, text);
    if (!await choose(w, 'who')) return { failed: await w.api() };
    await w.post('/api/ideate', own ? { action: 'pickWho', own } : { action: 'pickWho', pick: 0 });
    const m = await settled(w, 45000);
    if (!m || m.step !== 'model' || m.state !== 'choose') return { model: m };
    await w.post('/api/ideate', { action: 'pickModel', pick: 0 });
    const g = await choose(w, 'goal', 15000);
    await w.post('/api/ideate', { action: 'setGoal', goal: g?.goal || 'open', test: { text: g?.test?.text || '' } });
    return { model: m, canvas: await settled(w, 45000) };
  }
  // 第 12 項：數字只來自創辦人（完整數字比對、全形數字、強制格亦核對）
  const d = await toCanvas('journey-who:journey-who-digits\njourney-canvas:journey-canvas-digits2', '先找 100 位上班族試用新鮮咖啡豆。');
  const dc = d.canvas?.canvas?.cells || {};
  ok('OPUS-12a 創辦人寫「100」而 AI 寫「10 元」：該格清空改 open、建議照留', dc.cost?.tag === 'open' && dc.cost?.text === '' && !!dc.cost?.suggest, dc.cost);
  ok('OPUS-12b 全形數字（１０）同樣核對：收入格清空', !/[0-9０-９]/.test(String(dc.revenue?.text || '')), dc.revenue);
  ok('OPUS-12c 創辦人寫過的完整數字（100）保留', String(dc.activities?.text || '').includes('100'), dc.activities);
  ok('OPUS-12d 外殼強制寫入的價值格亦核對：不含創辦人沒寫過的數字（30）', !!d.canvas && !String(dc.value?.text || '').includes('30'), dc.value);
  // 第 3 項：自己寫對象時，對方的問題及替代方案不是創辦人原文就不可標 mine
  const own = '在家工作的平面設計師';
  const o = await toCanvas('', SAY, own);
  const oc = o.canvas?.canvas?.cells || {};
  const ownProblem = ideaCell(oc, 'problem') || {};
  ok('OPUS-3d 自己寫對象：客戶格為原話（mine），對方的問題不是原話就不可標 mine', oc.customer?.text === own && oc.customer?.tag === 'mine' && (ownProblem.tag !== 'mine' || (String(ownProblem.text || '') && own.includes(String(ownProblem.text)))), { customer: oc.customer, problem: ownProblem });
  // 第 13 項：組合剔除而非整步失敗
  const cn = await toCanvas('journey-model:journey-model-cardname');
  const cnm = cn.model || cn.failed;
  ok('OPUS-13a 組合名稱含卡號：只剔除該組合，其餘照常 choose', cnm?.state === 'choose' && cnm?.step === 'model' && (cnm.model.options || []).length >= 2 && cnm.model.options.every(x => !CARD.test(x.name)), { state: cnm && [cnm.state, cnm.step, cnm.reason], names: cnm?.model?.options?.map(x => x.name) });
  const dn = await toCanvas('journey-model:journey-model-dupname');
  const dnm = dn.model || dn.failed;
  ok('OPUS-13b 組合名稱重複：只剔除重複的一個，其餘照常 choose', dnm?.state === 'choose' && (dnm.model.options || []).length >= 2 && new Set(dnm.model.options.map(x => x.name)).size === dnm.model.options.length, { state: dnm && [dnm.state, dnm.step, dnm.reason], names: dnm?.model?.options?.map(x => x.name) });
  await freshJourney(w, '');
  await choose(w, 'who');
  await w.post('/api/ideate', { action: 'pickWho', pick: 0 });
  const ex1 = await choose(w, 'model');
  const firstNames = ex1 ? ex1.model.options.map(x => x.name) : [];
  w.mode('journey-model:journey-model-exclude-leak');
  await w.post('/api/ideate', { action: 'moreModels' });
  const ex2 = await waitFor(async () => { const s = await w.api(); return s && (s.state === 'failed' || s.state === 'choose' && Number(s.model.asked) === 2) ? s : null; }, 40000);
  ok('OPUS-13c 再提三個時 AI 重提已排除的名稱：該組合被剔除，其餘照常 choose', ex2?.state === 'choose' && (ex2.model.options || []).length >= 2 && ex2.model.options.every(x => !firstNames.includes(x.name)), { state: ex2 && [ex2.state, ex2.step, ex2.reason], names: ex2?.model?.options?.map(x => x.name), excluded: firstNames });
  // 第 4 項：三步輸出夾帶卡號，畫面及公司概覽零卡號（最後做，交出後公司概覽已就緒，不能再開始）
  await freshJourney(w, 'journey-who:journey-cardids\njourney-model:journey-cardids\njourney-canvas:journey-cardids');
  const cw = await choose(w, 'who');
  const whoHits = cw ? cardHits({ said: cw.who.said, value: cw.who.value, options: cw.who.options }) : ['未到 choose／who'];
  await w.post('/api/ideate', { action: 'pickWho', pick: 0 });
  const cm = await choose(w, 'model');
  const modelHits = cm ? cardHits({ said: cm.model.said, goal: cm.model.goal, options: cm.model.options.map(x => ({ ...x, faces: Object.fromEntries(Object.entries(x.faces || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map(p => ({ name: p.name })) : v])) })) }) : ['未到 choose／model'];
  await w.post('/api/ideate', { action: 'pickModel', pick: 0 });
  const cg = await choose(w, 'goal', 15000);
  await w.post('/api/ideate', { action: 'setGoal', goal: cg?.goal || 'open', test: { text: cg?.test?.text || '' } });
  const cc = await choose(w, 'canvas');
  const canvasHits = cc ? cardHits({ said: cc.canvas.said, cells: cc.canvas.cells }) : ['未到 choose／canvas'];
  ok('OPUS-4a 三步輸出夾帶卡號：對象、組合、九格畫面文字零卡號', whoHits.length === 0 && modelHits.length === 0 && canvasHits.length === 0, { who: whoHits, model: modelHits, canvas: canvasHits });
  const leftover = obj => { const out = []; (function walk(v, at) { if (typeof v === 'string') { if (/（\s*）|\(\s*\)|〔含內部用語〕/.test(v)) out.push(at + '：' + v); } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'card' && k !== 'id') walk(x, at + '.' + k); })(obj, ''); return out; };
  const r7a = leftover({ who: cw && cw.who, model: cm && { said: cm.model.said, goal: cm.model.goal }, canvas: cc && cc.canvas });
  ok('R2-7a 刪去卡號後沒有留下空括號或「〔含內部用語〕」（對象、組合、九格）', !!cc && r7a.length === 0, r7a);
  const r = cc ? await submitAndDraft(w) : null;
  ok('OPUS-4b 三步輸出夾帶卡號：交出後公司概覽畫面文字零卡號', !!r?.page && cardHits(r.page).length === 0, r?.page ? cardHits(r.page) : r);
  const r7b = r?.page ? leftover(r.page.detail?.reading || []) : ['未有公司概覽'];
  ok('R2-7b 刪去卡號後公司概覽生意模式欄位沒有空括號或「〔含內部用語〕」', r7b.length === 0, r7b);
  await w.stop();
});

await scenario('OPUS 等候逾時及舊格式開始', async () => {
  const w = await serverWorld('opus-c', PORT + 5);
  write(path.join(w.DIR.ledger, 'ideate.json'), v2State({ updatedAt: new Date(Date.now() - 30 * 60000).toISOString() }));
  const stale = await w.api();
  ok('OPUS-15a running 逾 20 分鐘而沒有進行中工作：回傳 failed（可按再試一次）', stale?.state === 'failed', stale && { state: stale.state, step: stale.step, reason: stale.reason, updatedAt: stale.updatedAt });
  const retry = await w.post('/api/ideate', { action: 'retry' });
  ok('OPUS-15b 逾時後再試一次：接受並重新開始同一步', retry.code === 202 && retry.json?.state?.state === 'running' && retry.json?.state?.step === 'who', retry);
  await choose(w, 'who');
  const legacy = { id: 'legacy-opus', state: 'asking', say: '舊構思', round: 1, rounds: [{ round: 1, packId: 'legacy-opus-pack' }] };
  write(path.join(w.DIR.ledger, 'ideate.json'), legacy);
  write(path.join(w.DIR.asks, 'legacy-opus-pack.json'), { id: 'legacy-opus-pack', format: 'startup-os.ask/0.1', title: '和 Zero 一起想：了解對象及問題', ideate: { id: 'legacy-opus', round: 1 }, questions: [{ id: 'who', ask: '你想先了解哪一類小生意？', kind: 'text', value: '', why: '測試' }] });
  const started = await w.post('/api/ideate', { action: 'start', text: SAY, files: [] });
  const legacyFile = read(path.join(w.DIR.ledger, 'ideate-legacy.json'));
  ok('OPUS-15c 舊格式時按開始：舊檔改名保留為 ideate-legacy.json', started.code === 202 && legacyFile?.id === 'legacy-opus', { code: started.code, legacy: legacyFile });
  const gone = await waitFor(() => !fs.existsSync(path.join(w.DIR.asks, 'legacy-opus-pack.json')), 30000);
  ok('OPUS-15d 舊格式時按開始：舊「一起想」問題包被外殼收回', !!gone, { packLeft: fs.existsSync(path.join(w.DIR.asks, 'legacy-opus-pack.json')) });
  await w.stop();
});

await scenario('OPUS 未確認時模式圖操作不擋其他操作', async () => {
  const W = await shellWorld('opus-unconfirmed');
  fs.rmSync(path.join(W.DIR.ledger, 'confirmed.json'), { force: true });
  W.addOps([{ id: 'op-opus6-canvas', at: lib.localIso(), op: 'canvasEdit', target: 'value', value: { text: '未確認時的修改。', forRev: 0 } }, { id: 'op-opus6-pause', at: lib.localIso(), op: 'pauseZero', target: '', value: {} }]);
  W.shell();
  const st = W.state();
  const left = ops(path.join(W.DIR.ledger, 'founder-ops.json'));
  let staged = []; try { staged = fs.readdirSync(W.DIR.ledger).filter(f => /^\.founder-ops-/.test(f)); } catch { }
  ok('OPUS-6 公司概覽未確認時有一個模式圖操作：其他創辦人操作（暫停 Zero）照常合併，不整批卡住', (st.founderOpsDone || []).includes('op-opus6-pause') && !left.length && !staged.length && (st.events || []).some(e => e && e.type === 'founder-op' && e.title === N.ui.skip_pausedByFounder), { done: st.founderOpsDone, left: left.map(o => o.id), staged, log: W.log().split('\n').filter(l => /模式圖|創辦人操作/.test(l)).slice(-4) });
  const r1Titles = (st.events || []).filter(e => e && e.type === 'founder-op').map(e => e.title);
  ok('R2-1b 被略去的模式圖操作不寫「已更新這一格」時間線', !r1Titles.includes(N.ui.cvEditSaved), r1Titles);
});

await scenario('R2 原話、對象數字、附件文字版', async () => {
  const w = await serverWorld('r2', PORT + 6);
  async function journeyToCanvas(mode, say = SAY, files = []) {
    await freshJourney(w, mode, say, files);
    const who = await choose(w, 'who');
    if (!who) return { who: await w.api() };
    await w.post('/api/ideate', { action: 'pickWho', pick: 0 });
    const m = await choose(w, 'model');
    if (!m) return { who, model: await w.api() };
    await w.post('/api/ideate', { action: 'pickModel', pick: 0 });
    const g = await choose(w, 'goal', 15000);
    await w.post('/api/ideate', { action: 'setGoal', goal: g?.goal || 'open', test: { text: g?.test?.text || '' } });
    return { who, model: m, canvas: await settled(w, 45000) };
  }
  // 第 6 項：Word 附件要有文字版放入旅程沙盒
  const docx = makeDocx('工房報價單：每包新鮮咖啡豆試賣價待定。');
  await freshJourney(w, '', SAY, [{ name: '報價單.docx', data: docx.toString('base64') }]);
  await choose(w, 'who');
  const sb6 = sandboxJobs(w.data).find(item => item.job.type === 'journey-who');
  const f6 = sb6 ? (() => { try { return fs.readdirSync(path.join(sb6.dir, 'files')); } catch { return []; } })() : [];
  const t6 = f6.filter(f => !/\.docx$/i.test(f)).map(f => text(path.join(sb6.dir, 'files', f)));
  ok('R2-6 旅程 Word 附件有文字版：沙盒 files/ 有可讀的文字檔', t6.some(t => t.includes('工房報價單')), { sandbox: sb6 && sb6.name, files: f6, ideateFiles: w.file()?.files });
  // 第 4 項：與原話相同的價值一句及 mine 格不被語氣改寫，出處不降為 Zero 建議
  const say4 = '季末 G1：把新鮮咖啡豆送到沒有時間的上班族。';
  const j4 = await journeyToCanvas('journey-who:journey-who-say-value', say4);
  ok('R2-4a 對象步：與原話相同的價值一句不被語氣改寫', j4.who?.who?.value === say4, j4.who && j4.who.who);
  ok('R2-4b 九格：價值格保持原話及「你的原話」（mine）', j4.canvas?.canvas?.cells?.value?.text === say4 && j4.canvas.canvas.cells.value.tag === 'mine', j4.canvas && j4.canvas.canvas && j4.canvas.canvas.cells.value);
  // 第 5 項：所選對象含創辦人沒寫過的數字：客戶格保留對象名稱，只刪數字
  const j5 = await journeyToCanvas('journey-who:journey-who-digits-customer');
  const c5 = j5.canvas?.canvas?.cells?.customer;
  ok('R2-5 所選對象含不符數字：客戶格保留對象名稱、只刪去數字，不清空', !!c5 && String(c5.text || '').includes('獨立咖啡店') && !/[0-9０-９]/.test(String(c5.text)) && c5.tag !== 'open', c5);
  await w.stop();
});

for (const server of servers) if (server.child.exitCode === null) server.child.kill();
fs.writeFileSync(path.join(OUT, 'journey-backend-results.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(OUT, 'journey-backend-server.log'), servers.map(server => `# ${server.name}\n${server.log()}`).join('\n'));
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n  實際：' + JSON.stringify(result.info).slice(0, 1500)));
console.log(`${results.filter(result => result.pass).length}/${results.length} passed`);
process.exitCode = results.every(result => result.pass) ? 0 : 1;
setTimeout(() => process.exit(process.exitCode), 300);
