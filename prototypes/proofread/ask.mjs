// CrewZero 問題包入口（唔綁定 AI）：將一個問題包放上待決事項，開頁面畀創辦人答。
// 用法：node ask.mjs --desk              打開 CrewZero（冇開就喺背景開，唔使任何視窗）
//       node ask.mjs --dashboard         打開 CrewZero（同一個伺服器）；加 --demo 開虛構示範（加 --reset-demo 重建）
//       node ask.mjs --dashboard --brain <資料夾>   生意大腦讀取一個試驗資料夾（只讀）；--brain off 取消
//       node ask.mjs --dashboard --observe <資料夾> 登記公司工作資料夾，作業網顯示入面嘅本機 AI 會話（只讀）；--observe off／on 關閉或開啟觀測
//       node ask.mjs <問題包.json>      放上去並打開頁面
//       node ask.mjs <問題包.json> --no-open
//       node ask.mjs --list              列出等緊答嘅問題包
//       node ask.mjs --dashboard --sim <實例資料夾>   模擬實例（資料喺 <實例>/data，預設 4650；假 AI 喺 <實例>/../tools）
// 格式同出題規則：ask-format.md。超過 12 條會按優先自動拆包；答過嘅題目會自動拎走。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDirs, preparePacks, placePacks, listPacks, readJSON, rootId, legacyRootId, SERVER_VERSION, BASE_PORT, NAMES } from './ask-lib.mjs';
import { rhythmOf } from './rhythm-lib.mjs';
import { pipelineOf } from './brain-lib.mjs';
import { peopleView, resolveActorId } from './people-ops.mjs';
import { seedDemo, DEMO_DIR } from './demo-seed.mjs';
import { folderHash } from './folder-hash.mjs';
import { dashboardState, guideCard } from './dash-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const STATUS_ONLY = args.includes('--status');
const BRIEF = args.includes('--brief');
// 模擬實例（設計稿第 8 節）：獨立資料夾、模擬時鐘、預設 4650；唔係生意證據
const si = args.indexOf('--sim');
const PORT0 = si >= 0 ? 4650 : BASE_PORT;
if (si >= 0) {
  const inst = path.resolve(args[si + 1] || '.'), fake = path.join(inst, '..', 'tools', 'adapter-fake.json');
  process.env.SOS_SIM = '1'; process.env.SOS_DATA = path.join(inst, 'data');
  if (fs.existsSync(fake)) process.env.SOS_ADAPTER = fake;
}
// 示範（虛構公司「月月鮮烘」）：用另一個資料夾，唔會郁真實資料；未有就建
if (args.includes('--demo')) process.env.SOS_DATA = DEMO_DIR;
const DIR = dataDirs(ROOT, { create: !STATUS_ONLY && !BRIEF });
if (STATUS_ONLY) {
  if (!fs.existsSync(DIR.data)) {
    console.log('未能讀取目前安排：尚未找到 CrewZero 資料。');
    process.exit(1);
  }
  let firstWeek = ''; try { firstWeek = fs.readFileSync(path.join(ROOT, 'FIRST-WEEK.md'), 'utf8'); } catch {}
  let card = null; try {
    const c = readJSON(path.join(DIR.ledger, 'adapter-cert.json'), null);
    card = guideCard(firstWeek, dashboardState(DIR, { cert: c && c.host ? { host: c.host, label: c.label, certifiedAt: c.certifiedAt } : null }));
  } catch {
    if (!fs.existsSync(DIR.ledger)) card = guideCard(firstWeek, { guide: 'noAI', todo: [] });
  }
  if (!card || !card.today || !card.button) {
    console.log('未能讀取目前安排：目前沒有可顯示的下一步。');
    process.exit(1);
  }
  console.log('目前：' + card.today);
  console.log('下一步：' + card.button + '（在 CrewZero 按此按鈕）');
  console.log('重新打開：在 AI 對話輸入 /crewzero:dashboard（或說「打開 CrewZero」）');
  process.exit(0);
}
// --brief：只讀，印一段白話背景給 AI 對話討論前閱讀。不印檔案路徑、編號、秘密、通行證；沒有資料就印一句中文並以非零結束。
if (BRIEF) {
  const state = readJSON(path.join(DIR.ledger, 'state.json'), null), page = readJSON(path.join(DIR.company, 'page.json'), null);
  if (!state || !page || !page.company) { console.log(NAMES.ui.briefNone); process.exit(1); }
  const clip = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const day = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? `${+m[2]} 月 ${+m[3]} 日` : ''; };
  const safe = t => clip(t, 120).replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '').replace(/\+?\d[\d\s.．·()-]{6,}\d/g, m => /^\d{4}-\d{2}-\d{2}$/.test(m) || m.replace(/[\s.．·()-]/g, '').length < 8 ? m : '').replace(/\b[A-Za-z]:[\/][^\s，。；）)]*/g, '').replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}|\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '').replace(/\s{2,}/g, ' ').trim();
  let ds = {}; try { ds = dashboardState(DIR, {}) || {}; } catch { }
  const out = [];
  out.push('公司：' + safe(page.company.name) + (page.company.oneLiner ? '。' + safe(page.company.oneLiner) : ''));
  const q = ds.goals && ds.goals.quarter;
  if (q && q.text) out.push('目前目標：' + safe(q.text) + (q.endsOn ? '（目標日：' + day(q.endsOn) + '）' : ''));
  const na = ds.nextAction;
  if (na && na.text && !na.missing && !na.cancelledAt) out.push('下一個對外動作：' + safe(na.text) + (na.date ? '（' + day(na.date) + '）' : ''));
  const todo = (ds.todo || []).slice(0, 5);
  if (todo.length) out.push('待決事項（最多 5 項）：' + todo.map(t => safe(t.text)).join('；'));
  const as = ((state.company || {}).assumptions || []).slice(0, 8);
  if (as.length) out.push('假設及對方做到哪一步：' + as.map(a => safe(a.text) + '（' + NAMES.evName(a.grade || 'guess') + '）').join('；'));
  // 人物及機構名單：每個仍有效的外部對象一行（名稱、類別、推進格位、最近接觸、下一步及日期），按類別分段，段內先列十四日以上沒有接觸或下一步逾期者，每段最多 4 個；團隊成員一行（名稱、角色、負責）。不印編號、聯絡方式、已不再接觸的對象
  {
    const d0 = new Date(), p2 = n => String(n).padStart(2, '0'), todayS = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}`;
    let pv = null; try { pv = peopleView(state, { today: todayS }); } catch { }
    // 格位、最近接觸、逾期都用對象推進（brain-lib 的 pipelineOf／contactDueOf）同一個判斷：格位高於未接觸而沒有接觸紀錄的，不寫「還沒有接觸」，也不當逾期
    const stageBy = new Map(), pr = new Map(); try { for (const p of pipelineOf(DIR, { state, today: todayS }).prospects || []) { stageBy.set(p.id, p.stage || 0); pr.set(p.id, p); } } catch { }
    const stationName = id => (((state.milestones || []).find(m => m && m.id === id)) || {}).short || '';
    if (pv) {
      for (const k of ['customer', 'partner', 'investor', 'advisor']) {
        const group = pv.external.filter(p => p.kind === k);
        if (!group.length) continue;
        const late = p => ((pr.get(p.id) || {}).gapDays != null && pr.get(p.id).gapDays >= 14) || (p.nextTask && p.nextTask.dueAt && p.nextTask.dueAt < todayS);
        const sorted = group.slice().sort((a, b) => (late(b) ? 1 : 0) - (late(a) ? 1 : 0));
        const line = p => safe(p.name) + '（' + [p.org ? safe(p.org) : '', p.stage === 0 || !stageBy.get(p.id) ? '未接觸' : NAMES.evName(NAMES.EV_KEYS[stageBy.get(p.id)]),
          (pr.get(p.id) || {}).lastContact ? '最近接觸 ' + day(pr.get(p.id).lastContact.date) : stageBy.get(p.id) > 0 ? NAMES.dash.ppl_noRecord : '還沒有接觸', p.nextTask ? '下一步：' + safe(p.nextTask.title) + (p.nextTask.dueAt ? '，' + day(p.nextTask.dueAt) : '') : ''].filter(Boolean).join('；') + '）';
        out.push(NAMES.dash['ppl_kind_' + k] + '：' + sorted.slice(0, 4).map(line).join('；') + (sorted.length > 4 ? '；另有 ' + (sorted.length - 4) + ' 個' : ''));
      }
      const members = pv.team.filter(p => p.team.state !== 'left');
      if (members.length) out.push('團隊成員：' + members.map(p => {
        const mine = (state.tasks || []).filter(t => t && !['done', 'cancelled'].includes(t.status) && resolveActorId(((state.company || {}).actors) || [], t.owner) === p.id).map(t => safe(t.title)).slice(0, 2);
        return safe(p.name) + '（' + [p.role ? safe(p.role) : '', '負責：' + ([...p.team.owns.map(stationName).filter(Boolean), ...mine].join('、') || '分工未定'), p.team.state === 'paused' ? NAMES.ui.pbOwnPaused : ''].filter(Boolean).join('；') + '）';
      }).join('；'));
    }
  }
  const ST = { unprocessed: 'Zero 處理中', awaitingFounder: '等你確認', processed: '已處理' };
  const inputs = (state.inputs || []).filter(i => i && i.title).slice().sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 5);
  if (inputs.length) out.push('最近交給 Zero 的事：' + inputs.map(i => safe(i.title) + '（' + (ST[i.status] || '已處理') + '）').join('；'));
  const runs = (state.runs || []).filter(r => r.state === 'ended' && r.summary).slice(-3).reverse();
  if (runs.length) out.push('最近三次 Zero 工作：' + runs.map(r => day(r.startedAt) + ' ' + safe(r.summary)).join('；'));
  let used = 0; try { const d = new Date(), p2 = n => String(n).padStart(2, '0'), today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; used = fs.readFileSync(path.join(DIR.ledger, 'ai-starts.log'), 'utf8').split('\n').filter(l => l.startsWith(today)).length; } catch { }
  const cap = rhythmOf(state).aiStartsPerDay;
  out.push('今日 Zero 還可以工作 ' + Math.max(0, cap - used) + ' 次（上限 ' + cap + ' 次）。');
  console.log(out.join('\n'));
  process.exit(0);
}
if (args.includes('--demo')) seedDemo(DEMO_DIR, { copyCert: true, reset: args.includes('--reset-demo') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let legacyServer = null;

async function findServer() {
  legacyServer = null;
  for (let p = PORT0; p < PORT0 + 10; p++) {
    try {
      const response = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: AbortSignal.timeout(800) });
      const j = response.ok ? await response.json() : null;
      if (j && j.version === SERVER_VERSION && j.root === rootId(DIR.data)) return `http://127.0.0.1:${p}/`;
    } catch { }
    // 舊版只有公開 /api/status，沒有通行證；發現後不可沿用，交由新版開機流程關閉或安全地阻擋。
    try {
      const response = await fetch(`http://127.0.0.1:${p}/api/status`, { signal: AbortSignal.timeout(800) });
      const j = response.ok ? await response.json() : null;
      if (j && (j.root === rootId(DIR.data) || j.root === legacyRootId(DIR.data)) && Number(j.pid) > 0) legacyServer = { port: p, busy: !!j.busy };
    } catch { }
  }
  return null;
}
async function ensureServer(noOpen = false) {
  let url = await findServer();
  if (url) return url;
  spawn(process.execPath, [path.join(ROOT, 'server.mjs'), ...(noOpen ? ['--no-open'] : []), ...(si >= 0 ? ['--port', String(PORT0)] : [])], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 20 && !url; i++) { await sleep(500); url = await findServer(); }
  return url;
}
// 打開頁面：唔係自己開瀏覽器，而係請伺服器開（裝置通行證，設計 2026-10-31 第 3.2 節）。伺服器自己產生一次性連結交畀系統瀏覽器，
// 回應唔含連結，所以呢個程式（同叫佢嘅 AI 對話）永遠攞唔到通行證；呢度印出嘅網址只係普通網址。
async function openPage(url, page) {
  if (args.includes('--no-open') || process.env.SOS_NO_OPEN) return { ok: true, skipped: true };
  try {
    const response = await fetch(url + 'api/pass/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }), signal: AbortSignal.timeout(5000) });
    let body = null; try { body = await response.json(); } catch { }
    if (response.ok && body && body.ok === true) return { ok: true };
    // 呢度印出嘅句會由 AI 轉述畀創辦人：只用中文原因同做法，唔印狀態碼或者英文
    return { ok: false, message: typeof body?.message === 'string' && /[一-鿿]/.test(body.message) ? body.message : 'CrewZero 未有接受這次開頁要求。請稍等十秒，再說一次。' };
  } catch { return { ok: false, message: 'CrewZero 未有回應。請稍等十秒，再說一次。' }; }
}

if (args.includes('--serve')) {
  const url = await ensureServer(true);
  if (!url) { console.log('未能啟動 CrewZero 伺服器，請稍後再試。'); process.exit(1); }
  console.log('CrewZero 伺服器已開啟。');
  process.exit(0);
}

// --tell <草稿.json>：把「與 Zero 討論」得出的一件事交給 Zero（發生了一件事／請 Zero 做一件事／想改計劃）。
// 草稿 { "type": "event"|"adhoc"|"order", "text": "…", "date"?: "YYYY-MM-DD", "files"?: ["路徑", …] }。
// 這裏只做草稿檢查及讀檔（附件必須是創辦人項目資料夾內已存在的普通檔），然後經本機伺服器的 /api/tell 送出：
// 伺服器之後與網頁送出完全同一條驗證及處理路徑（公司概覽要已確認、字數、附件類型及大小），所以這裏不寫入任何檔案，失敗也不會留下半寫入。
const ti = args.indexOf('--tell');
if (ti >= 0) {
  const bad = why => { console.log(NAMES.t('tellBadDraft', { why })); process.exit(1); };
  let draft;
  try { draft = JSON.parse(fs.readFileSync(args[ti + 1] || '', 'utf8').replace(/^﻿/, '')); } catch { bad('找不到草稿，或草稿不是有效的檔案'); }
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) bad('草稿格式不正確');
  const extra = Object.keys(draft).filter(k => !['type', 'text', 'date', 'files'].includes(k));
  if (extra.length) bad('草稿只可以有類型、內容、日期和附件四項，不接受其他項目');
  if (!['event', 'adhoc', 'order'].includes(draft.type)) bad('類型只可以是「發生了一件事」「請 Zero 做一件事」「想改計劃」三種');
  const text = typeof draft.text === 'string' ? draft.text.trim() : '';
  if (!text) bad('內容不可留空');
  if (text.length > 4000) bad('內容最多 4000 字');
  if (draft.date != null && (typeof draft.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || isNaN(new Date(draft.date + 'T00:00:00')))) bad('日期格式不正確');
  const list = draft.files == null ? [] : draft.files;
  if (!Array.isArray(list) || list.length > 20 || list.some(f => typeof f !== 'string' || !f)) bad('附件最多 20 份，而且每項要寫路徑');
  // 附件只可以是創辦人項目資料夾（安裝資料夾 crewzero/ 的上一層）內已存在的普通檔：每一層都不可以是連結，不可以在安裝資料夾的 data/ 內
  const project = fs.realpathSync(path.dirname(ROOT));
  const within = (root, p) => { const r = path.relative(root, p); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  const EXTS = ['md', 'txt', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'png', 'jpg', 'jpeg'];
  const files = []; let total = 0;
  for (const f of list) {
    const abs = path.resolve(process.cwd(), f), shown = '「' + path.basename(f).slice(0, 60) + '」';
    let real; try { real = fs.realpathSync(abs); } catch { bad(shown + ' 找不到'); }
    if (!within(project, real) || !within(project, abs)) bad(shown + ' 不在項目資料夾內');
    // 逐層檢查：從項目資料夾往下，任何一層是連結（含 Windows 資料夾連結）即拒絕
    let cur = project;
    for (const part of path.relative(project, abs).split(path.sep)) { cur = path.join(cur, part); let st; try { st = fs.lstatSync(cur); } catch { bad(shown + ' 找不到'); } if (st.isSymbolicLink()) bad(shown + ' 是連結，不接受'); }
    for (const dd of [DIR.data, path.join(ROOT, 'data')]) { let dataReal = ''; try { dataReal = fs.realpathSync(dd); } catch { } if (dataReal && (real === dataReal || within(dataReal, real))) bad(shown + ' 在 CrewZero 的資料夾內，不接受'); }
    const st = fs.statSync(real);
    if (!st.isFile()) bad(shown + ' 不是檔案');
    if (!EXTS.includes(path.extname(real).slice(1).toLowerCase())) bad(shown + ' 的檔案類型未能接收，請改為 PDF 或 Word 文件');
    if (st.size > 10 * 1024 * 1024) bad(shown + ' 太大，每份須在 10MB 以內');
    total += st.size; if (total > 50 * 1024 * 1024) bad('附件合共太大，須在 50MB 以內');
    files.push({ name: path.basename(real), data: fs.readFileSync(real).toString('base64') });
  }
  const url = await ensureServer(true);
  if (!url) { console.log(NAMES.ui.tellNoServer); process.exit(1); }
  let res = null, body = null;
  try {
    res = await fetch(url + 'api/tell', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: draft.type, text, ...(draft.date ? { date: draft.date } : {}), files }), signal: AbortSignal.timeout(60000) });
    try { body = await res.json(); } catch { }
  } catch { console.log(NAMES.ui.tellNoServer); process.exit(1); }
  if (!res.ok || !body || body.ok !== true) {
    const why = typeof body?.message === 'string' && /[一-鿿]/.test(body.message) ? body.message : NAMES.ui.tellNoServer;
    console.log(res.status === 403 ? NAMES.ui.tellNoServer : why);
    process.exit(1);
  }
  const one = text.replace(/\s+/g, ' ');
  console.log('已交給 Zero：' + (one.length > 40 ? one.slice(0, 39) + '…' : one) + '。可在 CrewZero 首頁『最近交給 Zero 的事』查看。');
  console.log('CrewZero：' + url);
  process.exit(0);
}
// 生意大腦本機選項：指向一個試驗資料夾（只讀固定檔名）；--brain off 取消
// 規劃書 4.6、4.9：以「存在即失敗」新增 founder/desk/brain-source-<時間>.json，最新一份為準；取消都係再新增一份
const bi = args.indexOf('--brain');
if (bi >= 0) {
  const target = args[bi + 1] || '';
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const cfg = path.join(DIR.data, 'founder', 'desk', `brain-source-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}-${String(t.getMilliseconds()).padStart(3, '0')}.json`);
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  if (target === 'off') { fs.writeFileSync(cfg, JSON.stringify({ off: true, setAt: t.toISOString() }), { flag: 'wx' }); console.log('生意大腦：已取消讀取試驗資料夾。'); }
  else {
    const dir = path.resolve(target);
    let isDir = false; try { isDir = fs.statSync(dir).isDirectory(); } catch { }
    if (!isDir) { console.log('生意大腦：找不到此資料夾：' + dir); process.exit(1); }
    fs.writeFileSync(cfg, JSON.stringify({ dir, setAt: t.toISOString() }), { flag: 'wx' });
    console.log('生意大腦：將讀取 ' + dir + '（只讀）');
  }
}
// 觀測來源：登記公司工作資料夾（可以登記多個）；監察台只顯示呢啲資料夾入面嘅本機 AI 會話；--observe off 關閉觀測、--observe on 重新開啟
// 同系統頁同一條路（規劃書 4.12、附錄 A observe）：只寫 founder/desk/observe-<時間>.json（雜湊同顯示名，唔寫路徑），即刻叫外殼套用入帳本
const oi = args.indexOf('--observe');
if (oi >= 0) {
  const target = args[oi + 1] || '';
  const desk = path.join(DIR.data, 'founder', 'desk');
  fs.mkdirSync(desk, { recursive: true });
  let rec;
  if (target === 'off' || target === 'on') rec = { op: target };
  else {
    const dir = path.resolve(target);
    let isDir = false; try { isDir = fs.statSync(dir).isDirectory(); } catch { }
    if (!isDir) { console.log('觀測來源：找不到此資料夾。'); process.exit(1); }
    rec = { op: 'add', hash: folderHash(dir), name: path.basename(dir) };
  }
  const t = new Date(), p2 = n => String(n).padStart(2, '0');
  const name = `observe-${t.getFullYear()}${p2(t.getMonth() + 1)}${p2(t.getDate())}-${p2(t.getHours())}${p2(t.getMinutes())}${p2(t.getSeconds())}-${String(t.getMilliseconds()).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(desk, name), JSON.stringify({ ...rec, at: t.toISOString() }) + '\n', { flag: 'wx' });
  // 外殼第一步套用（唔開 AI）；外殼做緊其他工作就下一次先套用
  spawnSync(process.execPath, [path.join(ROOT, 'run.mjs')], { stdio: 'ignore', windowsHide: true, env: process.env });
  const left = fs.readdirSync(desk).filter(f => /^observe-[\w-]+\.json$/.test(f)).length;
  console.log('觀測來源：' + (rec.op === 'off' ? '已關閉觀測' : rec.op === 'on' ? '已開啟觀測' : '已登記「' + rec.name + '」') + (left ? '（稍後生效）' : ''));
}
if (args.includes('--desk') || args.includes('--dashboard')) {
  const url = await ensureServer();
  // 開唔到：印一句原因同做法（AI 照住用白話轉述，唔好自己試其他方法）
  const want = '打開 CrewZero';
  if (!url) { console.log(legacyServer?.busy ? `舊版 CrewZero 正在處理工作；為保護資料，今次未有打開頁面。請等幾分鐘，再說一次「${want}」。` : `未能打開：這部電腦暫時未能啟動 CrewZero，公司資料沒有改動。請稍等十秒，再說一次「${want}」；仍然不行，請關閉其他已開的 CrewZero 視窗或重新開機後再試。`); process.exit(1); }
  // CrewZero 兩頁同一個伺服器，只係打開唔同頁
  const page = args.includes('--dashboard') ? url + 'dashboard' : url;
  const label = 'CrewZero' + (args.includes('--demo') ? '（示範：虛構公司）' : si >= 0 ? '（模擬實例：不是生意證據）' : '');
  const opened = await openPage(url, args.includes('--dashboard') ? 'dashboard' : 'desk');
  if (!opened.ok) { console.log(`${label} 已準備好，但瀏覽器未有打開：${opened.message.replace(/再說一次。$/, `再說一次「${want}」。`)}`); process.exit(1); }
  console.log(label + '：' + page);
  process.exit(0);
}
if (args.includes('--list')) {
  const packs = listPacks(DIR).filter(p => p.open);
  if (!packs.length) console.log('目前沒有待回答的問題包。');
  for (const p of packs) console.log(`- ${p.title}：尚有 ${p.open}／${p.total} 條未回答（${p.id}）`);
  process.exit(0);
}
// 只係改設定（--brain／--observe）冇開頁面：做完就停，唔好將資料夾當問題包
if (bi >= 0 || oi >= 0) process.exit(0);
const file = args.find(a => !a.startsWith('--'));
if (!file) { console.log('用法：node ask.mjs <問題包.json>'); process.exit(1); }
let raw;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
catch (e) { console.log('無法讀取問題包：' + e.message); process.exit(1); }
const by = args.includes('--by-founder') ? '你' : 'AI';
const prep = preparePacks(raw, { dirs: DIR, askedBy: by });
if (!prep.ok) {
  console.log('問題包不符合規格，未有放上待決事項：');
  for (const e of prep.errors) console.log('- ' + e);
  console.log('格式及出題規則見 ask-format.md。');
  process.exit(1);
}
if (prep.dropped.length) console.log(`有 ${prep.dropped.length} 條題目先前已回答，已移除。`);
if (!prep.packs.length) { console.log('全部題目先前均已回答，沒有新問題。'); process.exit(0); }
const placed = placePacks(DIR, prep.packs);
const url = await ensureServer();
for (const p of placed) console.log(`已放上待決事項：${p.title}（共 ${p.count} 條；每次先問最重要的 3 條）`);
if (!url) { console.log(legacyServer?.busy ? '問題包已放好；沒有通行證功能的舊版正在處理工作，為保護資料瀏覽器未有打開，完成後再試。' : '問題已準備好，但 CrewZero 暫時未能開啟；下次打開 CrewZero 便會看到。'); process.exit(legacyServer?.busy ? 1 : 0); }
const link = `${url}#/ask/${placed[0].id}`;
const opened = await openPage(url, 'ask/' + placed[0].id);
if (!opened.ok) { console.log('問題包已放好，但瀏覽器未有打開：' + opened.message + '請勿再放一次；創辦人打開 CrewZero 即可看到。'); console.log('CrewZero：' + link); process.exit(0); }
console.log('CrewZero：' + link);
