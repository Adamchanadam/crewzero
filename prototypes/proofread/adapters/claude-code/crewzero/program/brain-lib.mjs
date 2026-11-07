// CrewZero 生意大腦：六項嘅狀態、推進同結果（唯一計算處）。監察台同外殼都用呢度，伺服器只讀。
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
import { KINDS, TEAM_TYPES, KIND_LEGACY_NAME, GAP_DAYS, kindOf, norm, hasContactInfo, hasKey, nameKeys, resolveActorId, ownerKind, peopleView, diffDays } from './people-ops.mjs';

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
  preparing: 'Zero 正在準備辯論', blue: '藍方正在撰寫論證', red: '紅方正在逐點攻擊', rebuttal: '藍方正在反駁', judge: '裁判正在逐條判定',
  done: '辯論完結：等你回應三個關鍵時刻，其後開始轉強', strengthening: 'Zero 將批評變成轉強卡', reattack: '紅方再攻轉強卡', adopt: '轉強卡等你採用', adopted: '已採用轉強卡', failed: '有一方未完成，可以重跑一次'
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
    waitText: { done: '回應這場辯論（三個關鍵時刻）', adopt: '到待決事項採用轉強卡', failed: '到待決事項重跑未完成的一方' }[w.phase] || '',
    detail: { ...w, matches: ms.map(summaryOf) } };
}

/* ---------- 主函數 ---------- */
export function loadBrain(DIR, { now = new Date(), runs = [], packs = [], state = null } = {}) {
  const src = brainSource(DIR);
  const nowMs = now.getTime();
  const items = ITEMS.map(x => ({ ...x, status: 'not_started', summary: '', progress: null, updatedAt: '', detail: null, waitHref: '', waitText: '' }));
  const it = id => items.find(x => x.id === id);
  // 未設定來源但喺 Founder Desk 開過辯論：只顯示紅藍對打
  if (!src && matchIds(DIR, null).length) { Object.assign(it('wargame'), wargameItem(DIR, null, now, null, packs)); const decided = {}; for (const [cardId, packId] of Object.entries(readJSON(path.join(DIR.ledger, 'brain-decisions.json'), {}) || {})) decided[cardId] = { packId, open: packs.some(p => p.id === packId) }; return { source: { kind: 'debates' }, items, feedback: feedbackOf(DIR, items, runs), decided }; }
  if (!src) return { source: null, items, feedback: feedbackOf(DIR, items, runs), decided: {} };
  if (src.kind === 'missing') return { source: { kind: 'missing' }, items, feedback: feedbackOf(DIR, items, runs), decided: {} };

  if (src.kind === 'demo') {
    const b = readJSON(path.join(src.dir, 'brain.json'), {}) || {};
    const reveal = readJSON(path.join(src.dir, 'reveal.json'), null);
    const sec = reveal && reveal.seededAt ? (nowMs - new Date(reveal.seededAt).getTime()) / 1000 : 1e9;
    for (const k of ['checkup', 'opportunities', 'pipeline', 'routes', 'scenario']) if (b[k]) Object.assign(it(k), { status: b[k].status || 'done', summary: b[k].summary || '', detail: b[k], updatedAt: b[k].updatedAt || '' });
    // 示範（以及帳本已有名單的試驗）：人物及機構以帳本的名單為準，與團隊頁、每週訪問、背景摘要同一來源；示範結果卡（brain.json）的格位、練習、準備材料只按名稱疊加。沒有名單的舊格式照用 brain.json
    const dst = state || null;
    if (dst && Array.isArray((dst.company || {}).actors) && dst.company.actors.length && b.pipeline) {
      const live = pipelineOf(DIR, { state: dst }), old = (b.pipeline && b.pipeline.prospects) || [];
      const prospects = live.prospects.map(p => {
        const o = old.find(x => x.name === p.name || (p.aliases || []).includes(x.name));
        return o ? { ...p, stage: Math.max(p.stage || 0, o.stage || 0), ...(!p.lastContact && (o.stage || 0) > 0 ? { gapDays: null } : {}), ...(o.lastReal ? { lastReal: o.lastReal } : {}), ...(p.nextTaskId || !o.next ? {} : { next: o.next }), ...(o.material ? { material: o.material } : {}), ...(o.practiceId ? { practiceId: o.practiceId } : {}), ...(o.rehearsal ? { rehearsal: o.rehearsal } : {}) } : p;
      });
      Object.assign(it('pipeline'), { status: 'done', summary: NAMES.dash.pipeSummary.replace('{n}', prospects.length), detail: { ...b.pipeline, prospects }, updatedAt: b.pipeline.updatedAt || '' });
    }
    const wi = wargameItem(DIR, src, now, reveal, packs);
    if (wi) Object.assign(it('wargame'), wi);
    // 示範：路線推演喺紅藍對打完成後先開始（演示狀態由未開始 → AI 做緊 → 完成）
    if (reveal && reveal.routes) {
      const r = it('routes');
      if (sec < reveal.routes.runningAt) Object.assign(r, { status: 'not_started', summary: '紅藍對打完成後開始', progress: null });
      else if (sec < reveal.routes.doneAt) Object.assign(r, { status: 'running', summary: '按紅隊評分推演兩至三條路線', progress: { done: Math.min(2, Math.floor((sec - reveal.routes.runningAt) / ((reveal.routes.doneAt - reveal.routes.runningAt) / 3))), total: 3 } });
    }
  } else if (src.kind === 'ledger') {
    ledgerItems(DIR, it, { now, runs, packs, state });
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
    if (w.synthesis && w.synthesis.routes.length) Object.assign(it('routes'), { status: 'done', summary: '由紅藍對打得出 ' + w.synthesis.routes.length + ' 條路線，交由你選擇', detail: { routes: w.synthesis.routes.map(r => ({ id: r.id, name: r.name, summary: r.why, redScore: r.redScore, firstTest: r.firstTest, stop: r.stop, recommended: w.chosenRouteId ? r.id === w.chosenRouteId : !!r.recommended })), chosenRouteId: w.chosenRouteId || '', decisionsMade: !!(w.founder && (w.founder.decisions || []).length) }, updatedAt: w.updatedAt });
  }

  // 等你：揀咗角色／問題包未答；有 AI 跟進就跟住 AI 工作狀態
  for (const x of items) {
    const d = x.detail || {};
    if (d.packId) {
      const open = packs.find(p => p.id === d.packId);
      const run = runs.find(r => r.kind === 'ask' && r.ref === d.packId);
      if (open && x.status !== 'done') Object.assign(x, { status: 'waiting', waitHref: '/#/ask/' + d.packId, waitText: d.waitText || '請先在待決事項回答一條問題' });
      else if (run && run.state === 'running') Object.assign(x, { status: 'running', summary: 'Zero 正按你的答案跟進', progress: { done: 1, total: 2 } });
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
    else if (sx.status !== 'done') Object.assign(sx, { status: 'waiting', waitHref: '/#/practice/' + scenarios[0].id, waitText: (sx.detail && sx.detail.waitText) || '請先在情景演練練習一次' });
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
function ledgerItems(DIR, it, { now, runs, packs, state = null }) {
  const U = NAMES.dash;
  const brainRun = k => runs.find(r => (r.steps || []).some(s => s.key === 'brain-' + k));
  for (const k of ['checkup', 'opportunities']) {
    const res = readJSON(brainFile(DIR, k), null), r = brainRun(k), st = r && (r.steps || []).find(s => s.key === 'brain-' + k);
    if (res) Object.assign(it(k), { status: res.partial ? 'partial' : 'done', summary: res.partial && !String(res.summary || '').includes('部分完成') ? '部分完成，只覆蓋已交出的項目。' + (res.summary || '') : res.summary || '', detail: res, updatedAt: res.updatedAt || '' });
    else if (st && st.state === 'running') Object.assign(it(k), { status: 'running', summary: U['brainRun_' + k], progress: { done: 1, total: 2 } });
    else Object.assign(it(k), { status: 'not_started', summary: st && ['failed', 'skipped'].includes(st.state) ? U.brainFailedNext : U['brainNext_' + k] });
  }
  const wi = wargameItem(DIR, null, now, null, packs);
  if (wi) Object.assign(it('wargame'), wi); else it('wargame').summary = U.brainNext_wargame;
  const w = wi ? wi.detail : {};
  if (w.synthesis && w.synthesis.routes.length) Object.assign(it('routes'), { status: 'done', summary: '由紅藍對打得出 ' + w.synthesis.routes.length + ' 條路線，交由你選擇', detail: { routes: w.synthesis.routes.map(r => ({ id: r.id, name: r.name, summary: r.why, redScore: r.redScore, firstTest: r.firstTest, stop: r.stop, recommended: w.chosenRouteId ? r.id === w.chosenRouteId : !!r.recommended })), chosenRouteId: w.chosenRouteId || '', decisionsMade: !!(w.founder && (w.founder.decisions || []).length) }, updatedAt: w.updatedAt });
  else it('routes').summary = U.brainNext_routes;
  // 生意體檢之後建議開辯論、商機等你決定（run.mjs 放上 Founder Desk 嘅確認類待決定）：未答就顯示等你
  const offers = readJSON(path.join(DIR.ledger, 'brain-offers.json'), {}) || {};
  for (const [k, o] of [['wargame', offers.debate], ['opportunities', offers.opportunities]]) {
    const x = it(k);
    if (o && o.packId && packs.some(p => p.id === o.packId) && !x.detail?.partial && x.status !== 'running' && x.status !== 'waiting') Object.assign(x, { status: 'waiting', waitHref: '/#/ask/' + o.packId, waitText: U['brainWait_' + k] });
  }
  const pipe = pipelineOf(DIR, state ? { state } : {});
  if (pipe.prospects.length) Object.assign(it('pipeline'), { status: 'done', summary: U.pipeSummary.replace('{n}', pipe.prospects.length), detail: pipe, updatedAt: pipe.updatedAt });
  else it('pipeline').summary = U.brainNext_pipeline;
  if (it('scenario').status === 'not_started') it('scenario').summary = U.brainNext_scenario;
}
// 固定對象名稱；名單規則見 people-ops.mjs（唯一定義處）與 docs/evidence/people-2026-11-07/design.md。
// 格位配對沿用 1b 決定（D1）的字串包含規則，只多比對別名；最近接觸配對才用「最長名稱優先」（people-ops 的 actorsMentioned）。
export function actorMatches(name, text, actors) {
  if (name && typeof name === 'object') return hasKey(name, text);
  return !!(name && text && String(text).includes(name));
}
const todayLocal = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const cut = (s, n) => String(s == null ? '' : s).trim().slice(0, n);
// 每次同步公司概覽都會跑：只增欄、只增對象，不改名、不刪、不重新啟用已不再接觸或已合併者。
// opts.today：新對象及補寫 addedAt 用；沒有就不寫（保持純函數及可重跑）
export function deriveActors(page, ms, existing = [], opts = {}) {
  const today = opts.today || '';
  const entries = ((page && page.detail && page.detail.actors && page.detail.actors.items) || []).filter(a => a && a.label);
  const raw = entries.length ? entries.map((a, i) => ({ id: 'pr-' + (a.id || i), label: String(a.label), value: String(a.value || ''), item: a })) : ms.flatMap(m => String(m.actorName || '').split(/[；;]/)).map(t => t.trim()).filter((t, i, all) => t && all.findIndex(x => x.split(/[（(·：:]/)[0].trim() === t.split(/[（(·：:]/)[0].trim()) === i).map((label, i) => ({ id: 'pr-m' + i, label, value: '', item: null }));
  const out = existing.map(a => ({ ...a, fromMilestoneIds: [...(a.fromMilestoneIds || [])] }));
  for (const a of raw) {
    const name = a.label.split(/[（(·：:]/)[0].trim(); if (!name) continue;
    const existingActor = out.find(x => entries.length ? x.id === a.id : (x.name === name || nameKeys(x).includes(norm(name))));
    if (existingActor) {
      // 創辦人改過名、或已有別名：以創辦人的名稱為準，頁面上的舊名只補進別名；沒有別名的照舊跟頁面
      if ((existingActor.aliases || []).length) { if (!nameKeys(existingActor).includes(norm(name))) existingActor.aliases.push(name); }
      else { existingActor.name = name; existingActor.label = a.label.trim(); }
      continue;
    }
    // 頁面重新校對後換了項目編號、名稱沒變：視為同一對象（已有別名者，或顯示名稱相同者）
    if (out.some(x => nameKeys(x).includes(norm(name)) && ((x.aliases || []).length || norm(x.label) === norm(a.label)))) continue;
    if (hasContactInfo(name)) continue;
    let id = a.id, n = 1; while (out.some(x => x.id === id)) id = a.id + '-' + n++;
    const it = a.item || {}, kind = KINDS.includes(it.actorKind) ? it.actorKind : /客戶|付款|付費|顧客/.test(a.label + a.value) ? 'customer' : 'partner';
    const org = cut(it.org, 40), role = cut(it.role, 40);
    const msIds = new Set(ms.map(m => m.id));
    out.push({ id, name, label: a.label.trim(), kind, ...(org && !hasContactInfo(org) ? { org } : {}), ...(role && !hasContactInfo(role) ? { role } : {}), aliases: [], status: 'active', addedFrom: entries.length ? 'overview' : 'milestone', ...(today ? { addedAt: today } : {}), fromMilestoneIds: [],
      ...(kind === 'team' ? { team: { type: TEAM_TYPES.includes(it.team && it.team.type) ? it.team.type : 'parttime', state: 'active', owns: [...new Set((Array.isArray(it.team && it.team.owns) ? it.team.owns : Array.isArray(it.milestones) ? it.milestones : []).filter(x => msIds.has(x)))] } } : {}) });
  }
  for (const a of out) {
    // 舊對象：讀到的舊顯示字串換成新代碼，缺的欄位補預設（只在同步時寫，不改既有值）
    if (a.kind && !KINDS.includes(a.kind)) a.kind = kindOf(a);
    if (!Array.isArray(a.aliases)) a.aliases = [];
    if (!a.status) a.status = 'active';
    if (!a.addedAt && today) a.addedAt = today;
    a.fromMilestoneIds = a.fromMilestoneIds.filter(id => !ms.some(m => m.id === id));
    if (a.mergedInto || kindOf(a) === 'team') continue;
    for (const m of ms) if (hasKey(a, m.actorName)) a.fromMilestoneIds.push(m.id);
  }
  return out;
}
// 客戶推進（現名「對象推進追蹤」）：對象＝名單內仍有效的外部對象（客戶、供應或合作方、投資者或資助方、顧問或協助者）；團隊成員、已不再接觸、已合併者不入格位。
// 格位（0 未接觸 … 4 形成依賴，同證據五級）只由創辦人確認過嘅嘢推進；接觸（lastContact）只是「創辦人寫過與他有關的事」，不推進格位。
// opts.state：呼叫者已疊加創辦人操作的帳本（即時顯示改正）；opts.today：測試用
export function pipelineOf(DIR, opts = {}) {
  const s = opts.state || readJSON(path.join(DIR.ledger, 'state.json'), {}) || {};
  const page = readJSON(path.join(DIR.company, 'page.json'), null), c = readJSON(path.join(DIR.ledger, 'confirmed.json'), null) || {};
  const vals = c.values || {}, EV = NAMES.EV_KEYS;
  // 帳本未有里程碑（外殼未同步過）就用公司概覽嘅路線
  const ms = (Array.isArray(s.milestones) && s.milestones.length ? s.milestones : ((page && page.path && page.path.milestones) || []).map((m, i) => ({ id: m.id, short: m.short, actorName: m.actor ? String(vals[m.actor.id] ?? m.actor.value ?? '') : '', event: m.event ? String(vals[m.event.id] ?? m.event.value ?? '') : '', state: 'not_started', pathStatus: 'confirmed', order: i + 1 }))).filter(m => m.pathStatus !== 'retired');
  // 公司概覽冇「公司以外的決策者」清單（舊格式）就由里程碑嘅決策者推出
  const allActors = Array.isArray((s.company || {}).actors) ? s.company.actors : deriveActors(page, ms);
  const todayStr = opts.today || todayLocal();
  const view = peopleView({ ...s, company: { ...(s.company || {}), actors: allActors } }, { today: todayStr }), vById = new Map(view.actors.map(p => [p.id, p]));
  const actors = allActors.filter(a => a && !a.mergedInto && a.status !== 'inactive' && kindOf(a) !== 'team');
  const rid = id => resolveActorId(allActors, id);
  const asm = (s.company || {}).assumptions || [];
  const status = ((page && page.glance && page.glance.status && page.glance.status.items) || []);
  const events = (s.events || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const nea = (s.company || {}).nextExternalAction;
  const opportunities = readJSON(brainFile(DIR, 'opportunities'), null)?.list || [];
  const practiceDirs = DIR.data ? { ...DIR, sandbox: DIR.sandbox || path.join(DIR.data, 'sandbox') } : null;
  const scenarios = practiceDirs ? listScenarios(practiceDirs) : [], sessionDir = DIR.data ? path.join(DIR.data, 'founder', 'practice') : '';
  const sessions = sessionDir && fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(sessionDir, f), null)).filter(Boolean).sort((x, y) => String(y.endedAt || y.startedAt || '').localeCompare(String(x.endedAt || x.startedAt || ''))) : [];
  let latest = '';
  const prospects = actors.map((a, i) => {
    const name = a.name, label = a.label || name;
    const has = t => hasKey(a, t);
    const original = (((page || {}).detail || {}).actors || {}).items || [], field = original.find(x => 'pr-' + x.id === a.id) || original.find(x => String(x.label || '').trim() === name);
    const val = field ? String(vals[field.id] ?? field.value ?? '') : '';
    let stage = 0;
    const mine = asm.filter(x => has(x.text)), myMs = ms.filter(m => (a.fromMilestoneIds || []).includes(m.id) || has(m.actorName) || has(m.event));
    for (const x of mine) stage = Math.max(stage, Math.max(0, EV.indexOf(x.grade)));
    // 0.38.0 的舊完成沒有編號，永久按現時名字計算，不回溯遷移。有編號的經合併解析（被合併者的完成算到最終對象）。
    for (const m of ms) if (m.state === 'done' && (Array.isArray(m.doneCounterpartIds) ? m.doneCounterpartIds.some(x => rid(x) === a.id) : myMs.includes(m))) stage = Math.max(stage, 2);
    for (const x of status) if (has(x.label)) stage = Math.max(stage, Math.max(0, EV.indexOf(NAMES.evKey(vals[x.id] ?? x.value))));
    const ids = new Set([...mine.map(x => x.id), ...myMs.map(m => m.id)]);
    // 最近一件真事：只計你確認咗、改到呢個對象嘅假設或站點嗰次（唔計淨係記錄咗、未確認嘅事件）；有原本記錄就用你嘅原話
    const ev = events.find(e => e.actor === 'founder' && e.type !== 'decision' && (e.relatedIds || []).some(r => ids.has(r))); // 下一個對外動作改動唔算呢個對象嘅真事
    const inp = ev && (s.inputs || []).find(i => (ev.relatedIds || []).includes(i.id));
    if (ev && ev.at > latest) latest = ev.at;
    const nextM = myMs.filter(m => m.state !== 'done' && m.pathStatus === 'confirmed').sort((x, y) => (x.order || 0) - (y.order || 0))[0];
    // 下一步：創辦人（或成員）已確認的跟進工作優先；其次 AI 上次建議、已做成工作嘅（未完成）；冇就用下一個對外動作或者下一站
    const id = a.id, pv = vById.get(id) || {}, human = pv.nextTask, tk = (s.tasks || []).find(t => rid(t.prospectId) === id && ownerKind(t.owner) === 'ai' && !['done', 'cancelled'].includes(t.status));
    const myScenarios = scenarios.filter(sc => sc.counterpartId ? rid(sc.counterpartId) === id : sc.counterpart?.name === name).sort((x, y) => String(y.preparedAt || y.id).localeCompare(String(x.preparedAt || x.id)));
    const myIds = new Set(myScenarios.map(sc => sc.id)), review = sessions.find(session => myIds.has(session.scenarioId) && session.review);
    const materialTask = DIR.work && (s.tasks || []).filter(t => rid(t.prospectId) === id && /^R[\w-]{1,40}$/.test(String(t.fromRun || ''))).sort((x, y) => String(y.updatedAt || '').localeCompare(String(x.updatedAt || ''))).find(t => (readJSON(path.join(DIR.work, t.fromRun, 'receipt.json'), null)?.artifacts || []).length);
    const receipt = materialTask && readJSON(path.join(DIR.work, materialTask.fromRun, 'receipt.json'), null);
    const kindCode = a.kind ? kindOf(a) : (/客戶|付款|付費|顧客/.test(label + val) ? 'customer' : 'partner');
    // 最近接觸＝輸入（名稱配對）與「你確認過、改到這個對象的事件」（經假設／站點的編號關聯）中最新的一項：確認把對象推前一格的事件，同時就是與他的接觸。
    // 格位高於未接觸而完全找不到接觸紀錄：不算「很久沒有接觸」（沒有紀錄不等於沒有接觸），gapDays 為空，畫面寫「未有你寫下的接觸紀錄」
    let lc = pv.lastContact || null;
    if (ev && /^\d{4}-\d{2}-\d{2}/.test(String(ev.at))) { const d0 = String(ev.at).slice(0, 10); if (!lc || d0 > lc.date) lc = { date: d0, text: String(inp ? inp.title : ev.title).replace(/^[^：]*：/, ''), inputId: inp ? inp.id : '' }; }
    const gap = lc ? diffDays(todayStr, lc.date) : (stage > 0 ? null : (pv.gapDays == null ? null : pv.gapDays));
    return { id, name, label, ...(myScenarios.length ? { practiceId: myScenarios[0].id } : {}), ...(review ? { rehearsal: ({ yes: '目標達成', partly: '目標部分達成', no: '目標未達成' }[review.review.goal?.met] || '') } : {}), ...(receipt ? { material: { runId: materialTask.fromRun, title: receipt.artifacts[0].title || materialTask.title } } : {}), hasOpportunity: opportunities.some(o => o.counterpartId && rid(o.counterpartId) === id),
      // kind 沿用舊顯示字串（舊讀取處用 /供應/ 及辯論席位名比對），代碼在 kindCode；畫面改用代碼後再移除舊字串
      kind: KIND_LEGACY_NAME[kindCode], kindCode, org: a.org || '', role: a.role || '', stage, lastReal: ev ? String(inp ? inp.title : ev.title).replace(/^[^：]*：/, '') : '', lastAt: ev ? ev.at : '',
      lastContact: lc, gapDays: gap, docs: pv.docs || [], addedAt: a.addedAt || '', aliases: [...(a.aliases || [])],
      next: human ? human.title : tk ? tk.title : nea && has(nea.text) ? nea.text : nextM ? NAMES.dash.pipeNextStation.replace('{s}', nextM.short) : NAMES.dash.pipeNoNext, ...(human ? { nextBy: ownerKind(human.owner) === 'team' ? 'team' : 'founder', nextTaskId: human.id, ...(human.dueAt ? { nextDue: human.dueAt } : {}) } : tk ? { nextBy: 'ai', nextTaskId: tk.id } : {}), status: val };
  });
  return { prospects, updatedAt: latest || (s.updatedAt || '') };
}

// 每週訪問的十四日題：只問沒有接觸最久的對象（預設一個）；用 pipelineOf 的接觸及日數（含確認過的事件），格位高於未接觸而沒有紀錄者不問。暫緩日期在 state.interviews.contactSnooze[編號]
export function contactDueOf(DIR, opts = {}) {
  const s = opts.state || readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}, today = opts.today || todayLocal(), snooze = (s.interviews || {}).contactSnooze || {};
  return pipelineOf(DIR, { ...opts, state: s, today }).prospects.filter(p => p.gapDays != null && p.gapDays >= GAP_DAYS && !(typeof snooze[p.id] === 'string' && snooze[p.id] > today))
    .sort((x, y) => y.gapDays - x.gapDays || y.stage - x.stage).slice(0, opts.limit || 1);
}

// 工作資料只整理既有紀錄；人物卡和演練覆盤不作真實證據。
export function counterpartsOf(DIR, opts = {}) {
  const s = opts.state || readJSON(path.join(DIR.ledger, 'state.json'), {}) || {}, actors = (s.company || {}).actors || [];
  const prospects = pipelineOf(DIR, { ...opts, state: s }).prospects, scenarios = listScenarios(DIR);
  const logs = readJSON(path.join(DIR.ledger, 'practice-debriefs.json'), []) || [];
  const matches = listMatches(DIR, brainSource(DIR));
  const rid = id => resolveActorId(actors, id);
  return prospects.map(p => {
    const actor = actors.find(a => a.id === p.id) || {};
    const scs = scenarios.filter(sc => sc.counterpartId ? rid(sc.counterpartId) === p.id : sc.counterpart && sc.counterpart.name === p.name).sort((a,b) => String(b.preparedAt || b.id).localeCompare(String(a.preparedAt || a.id)));
    const ids = new Set(scs.map(sc => sc.id));
    const sessionDir = path.join(DIR.data, 'founder', 'practice');
    const lastReviewed = fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(sessionDir, f), null)).filter(x => x && ids.has(x.scenarioId) && x.review).sort((a,b) => String(b.endedAt || b.startedAt || '').localeCompare(String(a.endedAt || a.startedAt || '')))[0] : null;
    const review = Array.isArray(lastReviewed?.review?.why) ? lastReviewed.review.why : [];
    const debrief = logs.filter(d => ids.has(d.scenarioId)).sort((a,b) => String(b.at).localeCompare(String(a.at)))[0] || null;
    const seats = matches.flatMap(m => (m.seats || []).filter(x => x.counterpartId ? rid(x.counterpartId) === p.id : x.name === p.name || x.name === p.kind).map(x => x.cares && (x.counterpartId ? x.cares : '通用席位觀點：' + x.cares))).filter(Boolean);
    return { ...p, milestones: (s.milestones || []).filter(m => (actor.fromMilestoneIds || []).includes(m.id)).map(m => ({ name: m.short, actor: m.actorName || '' })),
      assumptions: ((s.company || {}).assumptions || []).filter(a => hasKey(actor.id ? actor : { name: p.name, aliases: p.aliases }, a.text)).map(a => ({ text: a.text, grade: NAMES.evName(a.grade || 'guess') })),
      debrief, review, seats };
  });
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
