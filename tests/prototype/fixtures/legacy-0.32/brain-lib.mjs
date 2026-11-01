// startup-os 生意大腦：六項嘅狀態、推進同結果（唯一計算處）。監察台同外殼都用呢度，伺服器只讀。
// 來源（揀一個）：
//   示範：<資料夾>/brain/（demo-seed 建；brain.json 加 wargame/ 三個檔；reveal.json 令示範按時間逐步出現）
//   公司紀錄（規劃書 4.6）：公司概覽成頁確認後，六項一律由帳本供料（ledger/brain/ 嘅生意體檢、商機掃描結果；客戶推進由帳本推算），試驗資料夾自動停用
//   本機選項（只喺確認之前）：<資料夾>/founder/desk/brain-source.json 指向一個試驗資料夾（只讀固定檔名：*生意體檢*.md、*預演*.md、wargame/ 嘅辯論檔）
// 紅藍對打（辯論＋轉強）嘅場次、記分、關鍵時刻由 debate-lib.mjs 計；呢度只揀最新一場做第 2 項。
// 規則：演練同紅隊結果唔算證據；只有真實客戶行為先令證據升級（頁面分開標示）。
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, NAMES } from './ask-lib.mjs';
import { listScenarios } from './practice-lib.mjs';
import { listMatches, summaryOf, matchIds } from './debate-lib.mjs';
import { readDisplay, deCode, deCodeJSON, folderAssumptions } from './plain-lib.mjs';

// 名稱由名稱表定（names.js 嘅 brain_<id>）
export const ITEMS = ['checkup', 'wargame', 'scenario', 'opportunities', 'routes', 'pipeline'].map((id, i) => ({ id, no: i + 1, name: NAMES.dash['brain_' + id] }));

function readText(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }
function mtime(f) { try { return fs.statSync(f).mtime.toISOString(); } catch { return ''; } }

// 公司概覽已成頁確認（同監察台嘅「已確認」同一判定）
export function companyConfirmed(DIR) {
  if (fs.existsSync(path.join(DIR.ledger, 'confirmed.json'))) return true;
  const s = readJSON(path.join(DIR.ledger, 'state.json'), null);
  return !!(s && s.intake && s.intake.state === 'complete');
}
export function brainSource(DIR) {
  const demo = path.join(DIR.data, 'brain');
  if (fs.existsSync(path.join(demo, 'brain.json'))) return { kind: 'demo', dir: demo };
  // 最新一份 brain-source-<時間>.json 為準（取消都係新增一份 {off:true}）；冇就讀舊版單一設定檔
  const desk = path.join(DIR.data, 'founder', 'desk');
  let latest = null; try { latest = fs.readdirSync(desk).filter(f => /^brain-source-[\w-]+\.json$/.test(f)).sort().pop() || null; } catch { }
  const cfg = readJSON(path.join(desk, latest || 'brain-source.json'), null);
  // 確認咗公司概覽：改由公司紀錄供料；試驗資料夾設定檔照留、唔讀
  if (companyConfirmed(DIR)) return { kind: 'ledger', ...(cfg && typeof cfg.dir === 'string' ? { folderOff: true } : {}) };
  if (cfg && typeof cfg.dir === 'string' && path.isAbsolute(cfg.dir)) {
    try { if (fs.statSync(cfg.dir).isDirectory()) return { kind: 'folder', dir: cfg.dir }; } catch { }
    return { kind: 'missing', dir: cfg.dir };
  }
  return null;
}

// Markdown 檔拆成卡：每個 ## 一張；「最弱」嗰節入面每個 ### 再拆
function mdCards(text, prefix) {
  const cards = [];
  const parts = text.split(/\r?\n(?=## )/);
  for (const part of parts.slice(1)) {
    const title = part.split(/\r?\n/)[0].replace(/^##\s*/, '').trim();
    const body = part.split(/\r?\n/).slice(1).join('\n');
    const subs = body.split(/\r?\n(?=### )/);
    if (subs.length > 1 && /最弱|薄弱|弱位|風險/.test(title)) {
      subs.slice(1).forEach((s, i) => cards.push({ id: `${prefix}-${cards.length + 1}`, group: title, title: s.split(/\r?\n/)[0].replace(/^###\s*/, '').trim(), md: s.split(/\r?\n/).slice(1).join('\n').trim() }));
    } else cards.push({ id: `${prefix}-${cards.length + 1}`, group: '', title, md: body.trim() });
  }
  return cards;
}

/* ---------- 紅藍對打：最新一場做第 2 項；舞台可以切換睇其他場 ---------- */
const PHASE_TEXT = {
  preparing: 'AI 正在準備辯論', blue: '藍方正在撰寫論證', red: '紅方正在逐點攻擊', rebuttal: '藍方正在反駁', judge: '裁判正在逐條判定',
  done: '辯論完結：等你回應三個關鍵時刻，其後開始轉強', strengthening: 'AI 將批評變成轉強卡', reattack: '紅方再攻轉強卡', adopt: '轉強卡等你採用', adopted: '已採用轉強卡', failed: '有一方未完成，可以重跑一次'
};
function wargameItem(DIR, src, now, reveal, packs) {
  const ms = listMatches(DIR, src, { now, reveal });
  if (!ms.length) return null;
  const w = ms[ms.length - 1];
  const open = id => packs.some(p => p.id === id);
  const adoptPack = [].concat(w.packs.adoption || []).find(open);
  const status = ['done', 'adopt', 'failed'].includes(w.phase) ? 'waiting' : w.phase === 'adopted' ? 'done' : 'running';
  return { status, summary: PHASE_TEXT[w.phase] || '', progress: w.progress, updatedAt: w.updatedAt,
    waitHref: w.phase === 'adopt' && adoptPack ? '/#/ask/' + adoptPack : w.packs.response && open(w.packs.response) && w.phase === 'done' ? '/#/ask/' + w.packs.response : '/#/debate/' + w.id,
    waitText: { done: '回應這場辯論（三個關鍵時刻）', adopt: '到 Founder Desk 採用轉強卡', failed: '到 Founder Desk 重跑未完成的一方' }[w.phase] || '',
    detail: { ...w, matches: ms.map(summaryOf) } };
}

/* ---------- 主函數 ---------- */
export function loadBrain(DIR, { now = new Date(), runs = [], packs = [] } = {}) {
  const src = brainSource(DIR);
  const nowMs = now.getTime();
  const items = ITEMS.map(x => ({ ...x, status: 'not_started', summary: '', progress: null, updatedAt: '', detail: null, waitHref: '', waitText: '' }));
  const it = id => items.find(x => x.id === id);
  // 未設定來源但喺 Founder Desk 開過辯論：只顯示紅藍對打
  if (!src && matchIds(DIR, null).length) { Object.assign(it('wargame'), wargameItem(DIR, null, now, null, packs)); return { source: { kind: 'debates' }, items, feedback: feedbackOf(DIR, items, runs), decided: {} }; }
  if (!src) return { source: null, items, feedback: feedbackOf(DIR, items, runs), decided: {} };
  if (src.kind === 'missing') return { source: { kind: 'missing' }, items, feedback: feedbackOf(DIR, items, runs), decided: {} };

  if (src.kind === 'demo') {
    const b = readJSON(path.join(src.dir, 'brain.json'), {}) || {};
    const reveal = readJSON(path.join(src.dir, 'reveal.json'), null);
    const sec = reveal && reveal.seededAt ? (nowMs - new Date(reveal.seededAt).getTime()) / 1000 : 1e9;
    for (const k of ['checkup', 'opportunities', 'pipeline', 'routes', 'scenario']) if (b[k]) Object.assign(it(k), { status: b[k].status || 'done', summary: b[k].summary || '', detail: b[k], updatedAt: b[k].updatedAt || '' });
    const wi = wargameItem(DIR, src, now, reveal, packs);
    if (wi) Object.assign(it('wargame'), wi);
    // 示範：路線推演喺紅藍對打完成後先開始（演示狀態由未開始 → AI 做緊 → 完成）
    if (reveal && reveal.routes) {
      const r = it('routes');
      if (sec < reveal.routes.runningAt) Object.assign(r, { status: 'not_started', summary: '紅藍對打完成後開始', progress: null });
      else if (sec < reveal.routes.doneAt) Object.assign(r, { status: 'running', summary: '按紅隊評分推演兩至三條路線', progress: { done: Math.min(2, Math.floor((sec - reveal.routes.runningAt) / ((reveal.routes.doneAt - reveal.routes.runningAt) / 3))), total: 3 } });
    }
  } else if (src.kind === 'ledger') {
    ledgerItems(DIR, it, { now, runs, packs });
  } else {
    // 本機試驗資料夾：只讀固定檔名
    const files = fs.readdirSync(src.dir).filter(f => f.endsWith('.md'));
    const pick = re => files.find(f => re.test(f));
    const ck = pick(/生意體檢/), sc = pick(/預演|演練/);
    // 試驗資料夾文件：有顯示用白話版本就用；最後保險機械換走編號
    // 顯示用白話版本優先；仍有編號就機械換成名稱（查唔到嘅保留並標「含內部用語」，plain-lib.mjs）
    const actx = { assumptions: folderAssumptions(src.dir) };
    const plainMd = f => deCode(readDisplay(DIR, 'source/' + f, path.join(src.dir, f)) || '', actx);
    if (ck) { const t = plainMd(ck); Object.assign(it('checkup'), { status: 'done', summary: '最薄弱的三個環節、你可能未想到之處、目前不建議做的事', detail: { kind: 'md', file: ck, cards: mdCards(t, 'checkup') }, updatedAt: mtime(path.join(src.dir, ck)) }); }
    if (sc) { const t = plainMd(sc); Object.assign(it('scenario'), { status: 'done', summary: '模擬會面：對方的反應與你的應對', detail: { kind: 'md', file: sc, cards: mdCards(t, 'scenario') }, updatedAt: mtime(path.join(src.dir, sc)) }); }
    const wi = wargameItem(DIR, src, now, null, packs);
    if (wi) Object.assign(it('wargame'), wi);
    const w = wi ? wi.detail : {};
    if (w.synthesis && w.synthesis.routes.length) Object.assign(it('routes'), { status: 'done', summary: '由紅藍對打得出 ' + w.synthesis.routes.length + ' 條路線，交由你選擇', detail: { routes: w.synthesis.routes.map(r => ({ id: r.id, name: r.name, summary: r.why, redScore: r.redScore, firstTest: r.firstTest, stop: r.stop, recommended: !!r.recommended })) }, updatedAt: w.updatedAt });
  }

  // 等你：揀咗角色／問題包未答；有 AI 跟進就跟住 AI 工作狀態
  for (const x of items) {
    const d = x.detail || {};
    if (d.packId) {
      const open = packs.find(p => p.id === d.packId);
      const run = runs.find(r => r.kind === 'ask' && r.ref === d.packId);
      if (open && x.status !== 'done') Object.assign(x, { status: 'waiting', waitHref: '/#/ask/' + d.packId, waitText: d.waitText || '請先在 Founder Desk 回答一條問題' });
      else if (run && run.state === 'running') Object.assign(x, { status: 'running', summary: 'AI 正按你的答案跟進', progress: { done: 1, total: 2 } });
      else if (run && run.state === 'done' && (run.result && run.result.artifacts || []).length) Object.assign(x, { status: 'done', summary: d.doneSummary || x.summary, resultRun: { id: run.id, title: run.result.artifacts[0].title } });
    }
  }
  // 情景演練：連去 Founder Desk 練習；練過有覆盤就算完成（練習唔算證據）
  const seDir = path.join(DIR.data, 'founder', 'practice');
  const scenarios = listScenarios(DIR);
  const sessions = fs.existsSync(seDir) ? fs.readdirSync(seDir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(seDir, f), null)).filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))) : [];
  const sx = it('scenario');
  if (scenarios.length) {
    sx.practice = scenarios.map(s => ({ id: s.id, title: s.title, who: s.counterpart.name, role: s.counterpart.role || '', date: s.date || '', sessions: sessions.filter(x => x.scenarioId === s.id).length }));
    const done = sessions.find(x => x.review && scenarios.some(s => s.id === x.scenarioId));
    if (done) Object.assign(sx, { status: 'done', summary: '練過 ' + sessions.length + ' 次；最近：' + ({ yes: '目標達成', partly: '目標部分達成', no: '目標未達成' }[done.review.goal && done.review.goal.met] || '已覆盤'), lastPractice: { id: done.id, who: (scenarios.find(s => s.id === done.scenarioId) || {}).counterpart.name } });
    else if (sx.status !== 'done') Object.assign(sx, { status: 'waiting', waitHref: '/#/practice/' + scenarios[0].id, waitText: (sx.detail && sx.detail.waitText) || '請先在 Founder Desk 練習一次' });
  }
  // 「要你決定」：已經放上 Founder Desk 嘅問題包
  const decided = {};
  for (const [cardId, packId] of Object.entries(readJSON(path.join(DIR.ledger, 'brain-decisions.json'), {}) || {})) decided[cardId] = { packId, open: packs.some(p => p.id === packId) };
  // 示範同試驗資料夾嘅結果卡：最後保險機械換走編號（紅藍對打由 debate-lib 處理）
  const dctx = src.kind === 'folder' ? { assumptions: folderAssumptions(src.dir) } : src.kind === 'ledger' ? { assumptions: ledgerAssumptions(DIR) } : {};
  for (const x of items) if (x.detail && x.id !== 'wargame') x.detail = deCodeJSON(x.detail, dctx);
  return { source: { kind: src.kind, ...(src.folderOff ? { folderOff: true } : {}) }, items, feedback: feedbackOf(DIR, items, runs), decided };
}

/* ---------- 公司紀錄供料（規劃書 4.6 供料與觸發表） ----------
   生意體檢、商機掃描：外殼開 AI 做，結果寫 ledger/brain/<項目>.json；紅藍對打、情景演練：創辦人開；路線推演：由紅藍對打整合得出；
   客戶推進：每次讀帳本即時重算（等同規劃書「外殼重算」），格位只計創辦人確認過嘅嘢。 */
export const brainFile = (DIR, k) => path.join(DIR.ledger, 'brain', k + '.json');
export function ledgerAssumptions(DIR) {
  const s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  return Object.fromEntries(((s.company || {}).assumptions || []).filter(a => a && a.id && a.text).map(a => [a.id, a.text]));
}
function ledgerItems(DIR, it, { now, runs, packs }) {
  const U = NAMES.dash;
  const brainRun = k => runs.find(r => (r.steps || []).some(s => s.key === 'brain-' + k));
  for (const k of ['checkup', 'opportunities']) {
    const res = readJSON(brainFile(DIR, k), null), r = brainRun(k), st = r && (r.steps || []).find(s => s.key === 'brain-' + k);
    if (res) Object.assign(it(k), { status: 'done', summary: res.summary || '', detail: res, updatedAt: res.updatedAt || '' });
    else if (st && st.state === 'running') Object.assign(it(k), { status: 'running', summary: U['brainRun_' + k], progress: { done: 1, total: 2 } });
    else Object.assign(it(k), { status: 'not_started', summary: st && st.state === 'failed' ? U.brainFailedNext : U['brainNext_' + k] });
  }
  const wi = wargameItem(DIR, null, now, null, packs);
  if (wi) Object.assign(it('wargame'), wi); else it('wargame').summary = U.brainNext_wargame;
  const w = wi ? wi.detail : {};
  if (w.synthesis && w.synthesis.routes.length) Object.assign(it('routes'), { status: 'done', summary: '由紅藍對打得出 ' + w.synthesis.routes.length + ' 條路線，交由你選擇', detail: { routes: w.synthesis.routes.map(r => ({ id: r.id, name: r.name, summary: r.why, redScore: r.redScore, firstTest: r.firstTest, stop: r.stop, recommended: !!r.recommended })) }, updatedAt: w.updatedAt });
  else it('routes').summary = U.brainNext_routes;
  // 生意體檢之後建議開辯論、商機等你決定（run.mjs 放上 Founder Desk 嘅確認類待決定）：未答就顯示等你
  const offers = readJSON(path.join(DIR.ledger, 'brain-offers.json'), {}) || {};
  for (const [k, o] of [['wargame', offers.debate], ['opportunities', offers.opportunities]]) {
    const x = it(k);
    if (o && o.packId && packs.some(p => p.id === o.packId) && x.status !== 'running' && x.status !== 'waiting') Object.assign(x, { status: 'waiting', waitHref: '/#/ask/' + o.packId, waitText: U['brainWait_' + k] });
  }
  const pipe = pipelineOf(DIR);
  if (pipe.prospects.length) Object.assign(it('pipeline'), { status: 'done', summary: U.pipeSummary.replace('{n}', pipe.prospects.length), detail: pipe, updatedAt: pipe.updatedAt });
  else it('pipeline').summary = U.brainNext_pipeline;
  if (it('scenario').status === 'not_started') it('scenario').summary = U.brainNext_scenario;
}
// 客戶推進：對象＝已確認公司概覽嘅外部角色；格位（0 未接觸 … 4 形成依賴，同證據五級）只由創辦人確認過嘅嘢推進
export function pipelineOf(DIR) {
  const s = readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  const page = readJSON(path.join(DIR.company, 'page.json'), null), c = readJSON(path.join(DIR.ledger, 'confirmed.json'), null) || {};
  const vals = c.values || {}, EV = NAMES.EV_KEYS;
  // 帳本未有里程碑（外殼未同步過）就用公司概覽嘅路線
  const ms = (Array.isArray(s.milestones) && s.milestones.length ? s.milestones : ((page && page.path && page.path.milestones) || []).map((m, i) => ({ id: m.id, short: m.short, actorName: m.actor ? String(vals[m.actor.id] ?? m.actor.value ?? '') : '', event: m.event ? String(vals[m.event.id] ?? m.event.value ?? '') : '', state: 'not_started', pathStatus: 'confirmed', order: i + 1 }))).filter(m => m.pathStatus !== 'retired');
  // 公司概覽冇「公司以外的決策者」清單（舊格式）就由里程碑嘅決策者推出
  let actors = ((page && page.detail && page.detail.actors && page.detail.actors.items) || []).filter(a => a && a.label);
  if (!actors.length) { const seen = new Set(); actors = ms.flatMap(m => String(m.actorName || '').split(/[；;]/)).map(t => t.trim()).filter(t => { const k = t.split(/[（(·：:]/)[0].trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; }).map((t, i) => ({ id: 'm' + i, label: t, value: '' })); }
  const asm = (s.company || {}).assumptions || [];
  const status = ((page && page.glance && page.glance.status && page.glance.status.items) || []);
  const events = (s.events || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const nea = (s.company || {}).nextExternalAction;
  let latest = '';
  const prospects = actors.map((a, i) => {
    const label = String(a.label), name = label.split(/[（(·：:]/)[0].trim();
    const has = t => !!(name && t && String(t).includes(name));
    const val = String(vals[a.id] ?? a.value ?? '');
    let stage = 0;
    const mine = asm.filter(x => has(x.text)), myMs = ms.filter(m => has(m.actorName) || has(m.event));
    for (const x of mine) stage = Math.max(stage, Math.max(0, EV.indexOf(x.grade)));
    for (const m of myMs) if (m.state === 'done') stage = Math.max(stage, 2);
    for (const x of status) if (has(x.label)) stage = Math.max(stage, Math.max(0, EV.indexOf(NAMES.evKey(vals[x.id] ?? x.value))));
    const ids = new Set([...mine.map(x => x.id), ...myMs.map(m => m.id)]);
    // 最近一件真事：只計你確認咗、改到呢個對象嘅假設或站點嗰次（唔計淨係記錄咗、未確認嘅事件）；有原本記錄就用你嘅原話
    const ev = events.find(e => e.actor === 'founder' && e.type !== 'decision' && (e.relatedIds || []).some(r => ids.has(r))); // 下一個對外動作改動唔算呢個對象嘅真事
    const inp = ev && (s.inputs || []).find(i => (ev.relatedIds || []).includes(i.id));
    if (ev && ev.at > latest) latest = ev.at;
    const nextM = myMs.filter(m => m.state !== 'done' && m.pathStatus === 'confirmed').sort((x, y) => (x.order || 0) - (y.order || 0))[0];
    // 下一步：AI 上次建議、已做成工作嘅（未完成）優先；冇就用下一個對外動作或者下一站
    const id = 'pr-' + (a.id || i), tk = (s.tasks || []).find(t => t.prospectId === id && !['done', 'cancelled'].includes(t.status));
    return { id, name, kind: /客戶|付款|付費|顧客/.test(label + val) ? '客戶' : '供應', stage, lastReal: ev ? String(inp ? inp.title : ev.title).replace(/^[^：]*：/, '') : '', lastAt: ev ? ev.at : '',
      next: tk ? tk.title : nea && has(nea.text) ? nea.text : nextM ? NAMES.dash.pipeNextStation.replace('{s}', nextM.short) : NAMES.dash.pipeNoNext, ...(tk ? { nextBy: 'ai', nextTaskId: tk.id } : {}), status: val };
  });
  return { prospects, updatedAt: latest || (s.updatedAt || '') };
}

/* ---------- 結果卡意見：收件匣入面未處理嘅都計（外殼忙緊都見到已送出）；要改嘅跟住 AI 修改工作嘅狀態；附卡名同項目名（「你的回饋」列表用） ---------- */
function feedbackOf(DIR, items, runs) {
  const feedback = readJSON(path.join(DIR.ledger, 'brain-feedback.json'), {}) || {};
  for (const f of fs.existsSync(DIR.inbox) ? fs.readdirSync(DIR.inbox).filter(f => /-note-feedback\.md$|-feedback-[a-z]+\.md$/.test(f)).sort() : []) {
    const raw = readText(path.join(DIR.inbox, f)) || '', j = /```json\s*([\s\S]*?)```/.exec(raw), at = (/^at: (.*)$/m.exec(raw) || [])[1] || '';
    let m = null; try { m = j && JSON.parse(j[1]); } catch { }
    if (m && m.cardId && !(feedback[m.cardId] && String(feedback[m.cardId].at) >= at)) feedback[m.cardId] = { item: m.item, verdict: m.verdict, text: m.text || '', at, pending: true };
  }
  for (const [cardId, f] of Object.entries(feedback)) {
    if (!f) continue;
    f.itemName = (items.find(x => x.id === f.item) || {}).name || '';
    f.title = cardTitle(items, cardId);
    if (!f.runId) continue;
    const run = runs.find(r => r.id === f.runId || r.retryOf === f.runId);
    if (run) f.revision = { state: run.state, title: run.result && run.result.artifacts && run.result.artifacts[0] ? run.result.artifacts[0].title : '', runId: run.state === 'done' ? run.id : '' };
  }
  return feedback;
}

/* ---------- 一張卡嘅名（「你的回饋」列表用；搵唔到就留空） ---------- */
function cardTitle(items, cardId) {
  for (const x of items) {
    const d = x.detail || {};
    const c = [...(d.cards || []), ...(d.weak || []), ...(d.list || []), ...(d.docs || [])].find(c => c.id === cardId);
    if (c) return c.title || '';
    const r = (d.routes || []).find(c => 'route-' + c.id === cardId) || (d.prospects || []).find(c => 'pipe-' + c.id === cardId);
    if (r) return r.name || '';
    if (x.id === 'wargame' && d.rows) {
      const k = (d.synthesis ? d.synthesis.topRisks : []).find(r => 'risk-' + r.rank === cardId);
      if (k) return NAMES.dash.topRisks + ' ' + k.rank + '：' + k.risk;
      const w = d.rows.find(r => 'claim-' + r.claim.id === cardId);
      if (w) return w.claim.claim;
    }
    if (x.id === 'scenario') {
      if (cardId === 'scenario-run' && x.resultRun) return x.resultRun.title;
      const p = (x.practice || []).find(p => 'practice-' + p.id === cardId);
      if (p) return p.who + '：' + p.title;
    }
  }
  return { unseen: NAMES.dash.unseen, notnow: NAMES.dash.notNow }[cardId] || '';
}

/* ---------- 一張卡嘅文字（交 AI 修改用） ---------- */
export function cardText(DIR, cardId, now = new Date()) {
  const b = loadBrain(DIR, { now });
  for (const x of b.items) {
    const d = x.detail || {};
    for (const c of d.cards || []) if (c.id === cardId) return `# ${x.name}：${c.title}\n\n${c.md || ''}\n`;
    for (const c of d.weak || []) if (c.id === cardId) return `# ${x.name}：${c.title}\n\n- 證據級：${NAMES.dash['ev_' + c.evidence] || ''}\n- 弱點所在：${c.why}\n- 最低成本測試：${c.cheapestTest}\n- 停止條件：${c.stop}\n`;
    for (const c of d.list || []) if (c.id === cardId) return `# ${x.name}：${c.title}\n\n${['why', 'firstTest', 'source', 'window'].map(k => c[k] ? '- ' + c[k] : '').filter(Boolean).join('\n')}\n`;
    for (const c of d.routes || []) if ('route-' + c.id === cardId) return `# ${x.name}：${c.name}\n\n- ${c.summary || ''}\n- 紅隊評分：${c.redScore}\n- 第一個測試：${c.firstTest}\n- 停止條件：${c.stop}\n`;
    for (const c of d.prospects || []) if ('pipe-' + c.id === cardId) return `# ${x.name}：${c.name}\n\n- 目前：${c.stageText || ''}\n- 本週建議：${c.next}\n`;
    for (const c of d.docs || []) if (c.id === cardId) return `# ${x.name}：${c.title}\n\n${c.md}\n`;
    // 生意體檢兩張側卡（成組畀意見）
    if (cardId === 'unseen' && (d.unseen || []).length) return `# ${x.name}：${NAMES.dash.unseen}\n\n${d.unseen.map(u => '- ' + u.text).join('\n')}\n`;
    if (cardId === 'notnow' && (d.notNow || []).length) return `# ${x.name}：${NAMES.dash.notNow}\n\n${d.notNow.map(u => '- ' + u.text + (u.why ? '（' + u.why + '）' : '')).join('\n')}\n`;
    if (x.id === 'wargame' && d.rows) {
      for (const r of (d.synthesis ? d.synthesis.topRisks : [])) if ('risk-' + r.rank === cardId) return `# 紅藍對打：最大風險 ${r.rank}\n\n- ${r.risk}\n- 成本最低的測試：${r.cheapestTest}\n- 停止條件：${r.stop}\n`;
      for (const r of d.rows) if ('claim-' + r.claim.id === cardId) return `# 紅藍對打：${r.claim.claim}\n\n- 藍隊證據級：${r.claim.evidence}\n${r.attacks.map(a => '- 紅隊（' + a.persona + '）：' + a.attack).join('\n')}\n- 裁判：${r.verdict ? r.verdict.verdict + '：' + r.verdict.reason : '未判'}\n`;
    }
  }
  return null;
}
