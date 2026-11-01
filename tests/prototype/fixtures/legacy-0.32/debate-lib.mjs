// startup-os 紅藍對打（辯論）同轉強：場次、記分、關鍵時刻、格式核對、轉強卡核對、問題包（唯一計算處）。
// 監察台（經 brain-lib）、Founder Desk（經伺服器）、外殼（run.mjs）都用呢度；伺服器只讀。
// 設計：docs/plan/DESIGN-debate-and-strengthen-2026-10-27.md；檔案格式：試驗資料夾 wargame/FORMAT.md，原型多出嘅可選欄見 debate-format.md。
// 規則：辯論、反駁、裁判、轉強全部係「AI 建議 · 未確認」，唔算證據；記分只供畫面，唔入進度、唔觸發特效。
// 場次存放：
//   舊場：生意大腦來源資料夾嘅 wargame/（示範 data/brain/wargame；真實 = 試驗資料夾/wargame），唯讀
//   新場：<資料夾>/debates/<場次 id>/（外殼寫）；舊場嘅創辦人回應同外殼產出寫喺 <資料夾>/debates/<舊場 id>/，讀時優先
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, NAMES } from './ask-lib.mjs';
import { readDisplay, deCodeJSON, folderAssumptions } from './plain-lib.mjs';

export const TOPIC_TYPES = ['business', 'strategy', 'pricing', 'partner', 'pitch', 'milestone'];
// 整體生意、策略、伙伴提案用全場（加藍方反駁）；其餘細題目用快打（設計稿 1.3，主線按推薦）
const FULL = ['business', 'strategy', 'partner'];
export const formatFor = type => FULL.includes(type) ? '全場' : '快打';
export const passesFor = format => format === '全場' ? ['blue', 'red', 'rebuttal', 'judge'] : ['blue', 'red', 'judge'];
// 紅方預設席位（設計稿 1.1、1.2；畫面可以加減，上限六席）
export const SEATS = {
  business: ['付款者', '買家或使用者', '伙伴或渠道', '競爭者', '投資者'],
  strategy: ['付款者', '伙伴或渠道', '競爭者', '投資者'],
  pricing: ['付款者', '採購或審批者', '競爭者', '投資者'],
  partner: ['伙伴本人', '伙伴的競爭者', '我方其他伙伴', '投資者'],
  pitch: ['投資者聽眾', '客戶聽眾', '競爭者'],
  milestone: ['該站的外部角色', '競爭者', '投資者']
};
export const LEVELS = { easy: '溫和', normal: '一般', hard: '嚴厲' };
export const VERDICTS = ['企得住', '受傷', '倒下'];
export const HANDLING = ['修正', '反轉做優勢', '先驗證', '接受並監察'];
export const CELLS = ['客戶群', '價值主張', '渠道', '客戶關係', '收入', '關鍵資源', '關鍵活動', '關鍵伙伴', '成本', '產品要求', '外部角色'];
export const CARD_STATUS = ['擬議', '已採用', '已改處理', '唔採用'];
export const HARD_CAP = 11;
const SEV = ['高', '中', '低'];
const POINTS = { '企得住': 2, '受傷': 1, '倒下': 0 };
const okId = id => /^[\w-]{1,40}$/.test(String(id || ''));
const txt = (x, n) => typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : '';
const arr = x => Array.isArray(x) ? x : [];

/* ---------- 場次：列出、讀一場（合併疊加） ---------- */
export const debatesDir = DIR => path.join(DIR.data, 'debates');
function legacyInfo(src) {
  if (!src || !src.dir || src.kind === 'missing') return null;
  const dir = path.join(src.dir, 'wargame');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  if (!files.includes('blue.json') && !files.some(f => f.endsWith('.md') && !/FORMAT/i.test(f))) return null;
  const m = readJSON(path.join(dir, 'match.json'), null);
  return { id: m && okId(m.id) ? m.id : 'W1', dir };
}
function dirsOf(DIR, src, id) {
  const L = legacyInfo(src);
  return [path.join(debatesDir(DIR), id)].concat(L && L.id === id ? [L.dir] : []);
}
// 讀場次檔：有顯示用白話版本（原檔冇改過）就用顯示用版本（plain-lib.mjs）
function reader(dirs, DIR, id) {
  return n => {
    for (const d of dirs) {
      const f = path.join(d, n), key = d === dirs[0] ? 'debates/' + id + '/' + n : 'source/wargame/' + n;
      let j = null; try { const s = n === 'match.json' || !DIR ? fs.readFileSync(f, 'utf8') : readDisplay(DIR, key, f); j = s == null ? null : JSON.parse(s); } catch { j = null; }
      if (j) return j;
    }
    return null;
  };
}
function mtime(f) { try { return fs.statSync(f).mtime.toISOString(); } catch { return ''; } }
export function matchIds(DIR, src) {
  const L = legacyInfo(src), ids = [];
  if (L) ids.push(L.id);
  const dd = debatesDir(DIR);
  if (fs.existsSync(dd)) for (const d of fs.readdirSync(dd)) if (okId(d) && d !== (L && L.id) && fs.existsSync(path.join(dd, d, 'match.json'))) ids.push(d);
  return ids;
}
// 外殼要做嘅下一個回合（有 next、未失敗）
export function pendingMatches(DIR) {
  const dd = debatesDir(DIR);
  if (!fs.existsSync(dd)) return [];
  return fs.readdirSync(dd).map(d => readJSON(path.join(dd, d, 'match.json'), null)).filter(m => m && okId(m.id) && m.next && !m.failed).sort((a, b) => String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
}
export function readMatchFile(DIR, src, id, name) { return okId(id) ? reader(dirsOf(DIR, src, id))(name) : null; }
// 畫面用：同上，但優先讀顯示用版本
function viewReader(DIR, src, id) { return reader(dirsOf(DIR, src, id), DIR, id); }
export function matchDir(DIR, id) { return path.join(debatesDir(DIR), id); }
export function isLegacy(src, id) { const L = legacyInfo(src); return !!L && L.id === id; }
export function legacyDir(src) { const L = legacyInfo(src); return L ? L.dir : null; }

// 示範：按建立示範後嘅秒數逐步出現（同真實資料夾陸續寫入一樣）
function applyReveal(f, reveal, nowMs) {
  const sec = (nowMs - new Date(reveal.seededAt).getTime()) / 1000;
  const shown = (map, id) => !map || map[id] == null || map[id] <= sec;
  const at = k => reveal[k] == null || reveal[k] <= sec;
  const out = { ...f };
  if (out.red) out.red = { ...out.red, attacks: arr(out.red.attacks).filter(a => shown(reveal.red, a.id)), strategyAttacks: at('strategyAttacksAt') ? out.red.strategyAttacks : [], missedStrategy: at('strategyAttacksAt') ? out.red.missedStrategy : null };
  if (out.red && !out.red.attacks.length) out.red = null;
  if (out.reb) { out.reb = { rebuttals: arr(out.reb.rebuttals).filter(r => shown(reveal.rebuttal, r.attackId)) }; if (!out.reb.rebuttals.length) out.reb = null; }
  if (out.judge) {
    const v = arr(out.judge.verdicts).filter(x => shown(reveal.judge, x.claimId));
    const ids = new Set(v.map(x => x.claimId)), atk = new Map(arr(f.red && f.red.attacks).map(a => [a.id, a.claimId]));
    const av = arr(out.judge.attackVerdicts).filter(x => ids.has(atk.get(x.attackId)));
    out.judge = at('synthesisAt') ? { ...out.judge, verdicts: v, attackVerdicts: av } : { verdicts: v, attackVerdicts: av, partial: true };
    if (!v.length && out.judge.partial) out.judge = null;
  }
  if (out.match && out.match.founder && !at('founderAt')) out.match = { ...out.match, founder: null };
  if (out.str) {
    const cards = arr(out.str.cards).filter(c => shown(reveal.strengthen, c.id)).map(c => ({ ...c, reattacks: arr(c.reattacks).filter(r => shown(reveal.reattack, c.id) || r.round > 1) }));
    out.str = cards.length ? { ...out.str, cards, accepted: at('strengthenDoneAt') ? out.str.accepted : [], modelRevision: at('strengthenDoneAt') ? out.str.modelRevision : null, partial: !at('strengthenDoneAt') } : null;
  }
  return out;
}

// 自認弱點：新場係 {claimId, text}；舊場係文字（有論點編號或者論點頭幾個字先算對得上）
function admittedOf(blue) {
  const claims = arr(blue && blue.claims);
  return arr(blue && blue.admittedWeaknesses).map(w => {
    if (w && typeof w === 'object') return { claimId: claims.some(c => c.id === w.claimId) ? w.claimId : '', text: txt(w.text, 300) };
    const s = String(w || '');
    const c = claims.find(c => new RegExp('\\b' + c.id + '\\b').test(s) || (String(c.claim || '').length >= 6 && s.includes(String(c.claim).slice(0, 6))));
    return { claimId: c ? c.id : '', text: s.slice(0, 300) };
  }).filter(w => w.text);
}

/* ---------- 記分、關鍵時刻、席位 ---------- */
export function scoreOf(claims, verdicts, attacks, attackVerdicts) {
  const vs = claims.map(c => (verdicts.find(v => v.claimId === c.id) || {}).verdict).filter(v => POINTS[v] != null);
  const n = { standing: vs.filter(v => v === '企得住').length, wounded: vs.filter(v => v === '受傷').length, fallen: vs.filter(v => v === '倒下').length };
  const hit = arr(attackVerdicts).filter(x => x.landed === '成立' || x.landed === '部分').length;
  return {
    ...n, judged: vs.length, total: claims.length,
    blueRate: vs.length ? Math.round(100 * vs.reduce((s, v) => s + POINTS[v], 0) / (2 * vs.length)) / 100 : null,
    redHitRate: arr(attackVerdicts).length && attacks.length ? Math.round(100 * hit / attacks.length) / 100 : null,
    attacks: { high: attacks.filter(a => a.severity === '高').length, mid: attacks.filter(a => a.severity === '中').length, low: attacks.filter(a => a.severity === '低').length },
    evidence: [0, 1, 2, 3, 4].map(k => claims.filter(c => Number(c.evidence) === k).length)
  };
}
const sevRank = s => SEV.indexOf(s) < 0 ? 3 : SEV.indexOf(s);
// 機械規則（設計稿 2.3），最多五張，按種類次序取
export function keyMomentsOf(v) {
  const out = [], seen = new Set();
  const push = m => { if (out.length < 5 && !seen.has(m.kind + m.ref)) { seen.add(m.kind + m.ref); out.push({ ...m, order: out.length + 1 }); } };
  const landedRank = a => ({ '成立': 0, '部分': 1 }[a.landed] ?? 2);
  for (const r of v.rows) if (r.verdict && r.verdict.verdict === '倒下') {
    const fatal = r.attacks.slice().sort((a, b) => landedRank(a) - landedRank(b) || sevRank(a.severity) - sevRank(b.severity))[0];
    push({ kind: '一擊倒下', ref: r.claim.id, text: r.claim.claim, detail: fatal ? fatal.attack : r.verdict.reason, persona: fatal ? fatal.persona : '', attackId: fatal ? fatal.id : '' });
  }
  const top = v.synthesis && v.synthesis.topRisks.find(x => Number(x.rank) === 1);
  if (top) push({ kind: '最傷', ref: 'risk1', text: top.risk, detail: top.cheapestTest, stop: top.stop });
  for (const r of v.rows) if (r.verdict && (r.verdict.verdict === '受傷' || r.verdict.verdict === '倒下') && Number(r.claim.evidence) >= 2 && !r.admitted)
    push({ kind: '盲點', ref: r.claim.id, text: r.claim.claim, detail: r.verdict.reason });
  for (const r of v.rows) if (r.verdict && r.verdict.verdict === '企得住') for (const a of r.attacks) if (a.severity === '高')
    push({ kind: '反轉', ref: r.claim.id, text: a.attack, detail: a.landedNote || r.verdict.reason, persona: a.persona, attackId: a.id });
  const ms = v.missedStrategy;
  if (ms && v.synthesis) {
    const blueIds = new Set(v.strategies.map(s => s.id));
    const route = v.synthesis.routes.find(x => !blueIds.has(x.id) || x.name === ms.name);
    if (route) push({ kind: '漏咗嘅路', ref: route.id, text: route.name, detail: ms.summary || route.why });
  }
  return out;
}
function seatsOf(match, red, attacks, avMap) {
  const names = arr(match.roles && match.roles.red && match.roles.red.personas).map(String);
  for (const a of attacks) if (a.persona && !names.includes(a.persona)) names.push(a.persona);
  const cares = Object.fromEntries(arr(red && red.seats).map(s => [String(s.persona || ''), txt(s.cares, 200)]));
  const hasAV = avMap.size > 0;
  return names.map(name => {
    const mine = attacks.filter(a => a.persona === name);
    const hit = mine.filter(a => ['成立', '部分'].includes((avMap.get(a.id) || {}).landed)).length;
    return { name, attacks: mine.length, high: mine.filter(a => a.severity === '高').length, hitRate: hasAV && mine.length ? Math.round(100 * hit / mine.length) / 100 : null, cares: cares[name] || '' };
  }).sort((a, b) => (b.hitRate ?? -1) - (a.hitRate ?? -1) || b.high - a.high || b.attacks - a.attacks);
}

/* ---------- 讀一場：舞台、Founder Desk、外殼共用嘅樣 ---------- */
export function loadMatch(DIR, src, id, { now = new Date(), reveal = null, prev = null } = {}) {
  if (!okId(id)) return null;
  const legacy = isLegacy(src, id), dirs = dirsOf(DIR, src, id), rd = viewReader(DIR, src, id);
  if (!legacy && !fs.existsSync(path.join(dirs[0], 'match.json'))) return null;
  let f = { match: rd('match.json') || {}, blue: rd('blue.json'), red: rd('red.json'), reb: rd('rebuttal.json'), judge: rd('judge.json'), str: rd('strengthen.json') };
  if (legacy && reveal && reveal.seededAt) f = applyReveal(f, reveal, now.getTime());
  const { match, blue, red, reb, judge, str } = f;
  const files = dirs.flatMap(d => ['blue.json', 'red.json', 'rebuttal.json', 'judge.json', 'strengthen.json', 'match.json'].map(n => mtime(path.join(d, n)))).filter(Boolean).sort();
  const base = {
    id, legacy, topic: { type: TOPIC_TYPES.includes(match.topic && match.topic.type) ? match.topic.type : 'business', title: txt(match.topic && match.topic.title, 120), targetId: txt(match.topic && match.topic.targetId, 40) },
    format: match.format === '快打' ? '快打' : match.format === '全場' ? '全場' : (reb ? '全場' : '快打'), level: LEVELS[match.level] ? match.level : 'normal',
    startedAt: match.startedAt || (legacy ? mtime(path.join(dirs[dirs.length - 1], 'blue.json')) : ''), endedAt: match.endedAt || '',
    roles: match.roles || null, warnings: arr(match.warnings).map(String).slice(0, 8), web: match.web === true, label: 'AI 建議 · 未確認',
    next: match.next || '', failed: match.failed || null, budget: match.budget || null, packs: match.packs || {}, previousMatchId: match.previousMatchId || '',
    updatedAt: files.pop() || ''
  };
  // 舊場只有各隊文件（未有 JSON）：照文件顯示
  if (!blue) {
    const wd = legacy ? dirs[dirs.length - 1] : null;
    const docs = wd && fs.existsSync(wd) ? fs.readdirSync(wd).filter(n => n.endsWith('.md') && !/FORMAT/i.test(n)).sort().map((n, i) => {
      const t = (() => { try { return fs.readFileSync(path.join(wd, n), 'utf8'); } catch { return ''; } })();
      const h1 = (/^#\s+(.+)$/m.exec(t) || [])[1];
      return { id: 'wgdoc-' + (i + 1), title: (h1 || n.replace(/\.md$/, '')).trim(), md: t.replace(/^#\s+.+$/m, '').trim(), team: /裁判/.test(n) ? 3 : /紅隊|紅方/.test(n) ? 2 : /藍隊|藍方/.test(n) ? 1 : 0 };
    }) : [];
    const top = docs.length ? Math.max(...docs.map(d => d.team)) : 0;
    return { ...base, docsOnly: docs.length > 0, docs, phase: match.failed && !match.next ? 'failed' : match.next ? 'blue' : docs.length ? ['preparing', 'red', 'judge', 'done'][top] : 'preparing', stage: top === 3 ? 4 : top === 2 ? 2 : top ? 1 : 0,
      thesis: '', whyNow: '', rows: [], strategies: [], extraRoutes: [], admittedWeaknesses: [], sources: [], strategyAttacks: [], missedStrategy: null, synthesis: null, score: null, keyMoments: [], seats: [], strengthen: null, founder: null,
      progress: { done: top, total: 3 } };
  }
  const claims = arr(blue.claims), attacks = arr(red && red.attacks), verdicts = arr(judge && judge.verdicts);
  const rebMap = new Map(arr(reb && reb.rebuttals).map(r => [r.attackId, r]));
  const avMap = new Map(arr(judge && judge.attackVerdicts).map(x => [x.attackId, x]));
  const admitted = admittedOf(blue);
  const rows = claims.map(c => {
    const v = verdicts.find(x => x.claimId === c.id) || null;
    return { claim: c, verdict: v, points: v && POINTS[v.verdict] != null ? POINTS[v.verdict] : null, admitted: admitted.some(w => w.claimId === c.id),
      attacks: attacks.filter(a => a.claimId === c.id).map(a => ({ ...a, rebuttal: rebMap.get(a.id) || null, landed: (avMap.get(a.id) || {}).landed || '', landedNote: (avMap.get(a.id) || {}).note || '' })) };
  });
  const synth = judge && !judge.partial && (judge.topRisks || judge.routes || judge.founderDecisions) ? judge : null;
  const strategies = arr(blue.strategies).map(s => ({ ...s, attacks: arr(red && red.strategyAttacks).filter(a => a.strategyId === s.id), route: synth ? arr(synth.routes).find(r => r.id === s.id) || null : null }));
  const blueIds = new Set(strategies.map(s => s.id));
  const v = {
    ...base, stage: !attacks.length ? 1 : !verdicts.length ? 2 : !synth ? 3 : 4,
    thesis: blue.thesis || '', whyNow: blue.whyNow || '', rows, strategies, admittedWeaknesses: admitted, sources: arr(blue.sources),
    strategyAttacks: arr(red && red.strategyAttacks), missedStrategy: red && red.missedStrategy || null,
    extraRoutes: synth ? arr(synth.routes).filter(r => !blueIds.has(r.id)).map(r => ({ ...r, redAdded: !!(red && red.missedStrategy && (red.missedStrategy.name === r.name || !blueIds.has(r.id))) })) : [],
    synthesis: synth ? { topRisks: arr(synth.topRisks), routes: arr(synth.routes), founderDecisions: arr(synth.founderDecisions), assumptionChanges: arr(synth.assumptionChanges), overall: txt(synth.overall, 300) } : null,
    rebuttals: arr(reb && reb.rebuttals).length,
    founder: match.founder || null
  };
  v.score = verdicts.length ? scoreOf(claims, verdicts, attacks, judge && judge.attackVerdicts) : null;
  if (v.score && synth) v.score.overall = txt(synth.overall, 300);
  const fc = arr(judge && judge.factChecks);
  v.verified = fc.length ? { ok: fc.filter(x => x.ok === true).length, failed: fc.filter(x => x.ok !== true).length } : null;
  v.keyMoments = keyMomentsOf(v);
  v.seats = seatsOf(match, red, attacks, avMap);
  // 推進：藍方論點、紅方攻擊、反駁（全場先計高攻擊）、裁判逐條、整合
  const highs = attacks.filter(a => a.severity === '高').length;
  v.progress = { done: claims.length + attacks.length + (v.format === '全場' ? Math.min(highs, rebMap.size) : 0) + verdicts.length + (synth ? 1 : 0),
    total: claims.length + Math.max(attacks.length, claims.length) + (v.format === '全場' ? Math.max(highs, rebMap.size) : 0) + claims.length + 1 };
  // 下半場：轉強卡（狀態只由外殼按你嘅回覆改）
  if (str && arr(str.cards).length) {
    const cards = arr(str.cards).map(c => ({ ...c, status: CARD_STATUS.includes(c.status) ? c.status : '擬議', label: c.status === '已採用' || c.status === '已改處理' ? 'AI 建議 · 你已認同' : 'AI 建議 · 未確認', reattacks: arr(c.reattacks) }));
    const st = Object.fromEntries(cards.map(c => [c.id, c.status]));
    v.strengthen = { cards, accepted: arr(str.accepted), founderQuestions: arr(str.founderQuestions), partial: !!str.partial,
      modelRevision: str.modelRevision ? { ...str.modelRevision, cells: arr(str.modelRevision.cells).map(x => ({ ...x, adopted: st[x.fromCardId] === '已採用' || st[x.fromCardId] === '已改處理', rejected: st[x.fromCardId] === '唔採用' })) } : null,
      rounds: Math.max(0, ...cards.map(c => Math.max(0, ...c.reattacks.map(r => Number(r.round) || 0)))) };
  } else v.strengthen = null;
  v.phase = phaseOf(v, match);
  // 最後保險：AI 文字仲有編號就機械換成名稱（創辦人 2026-10-28：畫面唔可以有冇解釋嘅編號）
  const ctx = { claims: Object.fromEntries(v.rows.map(r => [r.claim.id, r.claim.claim])), routes: Object.fromEntries(v.strategies.map(s => [s.id, s.name]).concat(v.synthesis ? v.synthesis.routes.map(r => [r.id, r.name]) : [])), cards: v.strengthen ? Object.fromEntries(v.strengthen.cards.map((c, i) => [c.id, { n: i + 1, title: c.critique || '' }])) : {},
    attacks: Object.fromEntries(v.rows.flatMap(r => r.attacks || []).map(x => [x.id, x.attack])), assumptions: src && src.kind === 'folder' ? folderAssumptions(src.dir) : {} };
  if (prev && prev.score && v.score) v.delta = { prevId: prev.id, standing: v.score.standing - prev.score.standing, wounded: v.score.wounded - prev.score.wounded, fallen: v.score.fallen - prev.score.fallen };
  return deCodeJSON(v, ctx);
}
function phaseOf(v, match) {
  if (v.failed && !v.next) return 'failed';
  if (v.next) return { blue: 'blue', red: 'red', rebuttal: 'rebuttal', judge: 'judge', rejudge: 'judge', strengthen: 'strengthening', 'reattack-red': 'reattack', 'reattack-judge': 'reattack' }[v.next] || 'preparing';
  if (!v.rows.some(r => r.attacks.length)) return 'red';
  if (!v.synthesis) return v.rows.some(r => r.verdict) ? 'judge' : v.format === '全場' && match.status === 'rebuttal' ? 'rebuttal' : 'judge';
  if (!v.strengthen) return v.founder && v.founder.respondedAt ? 'strengthening' : 'done';
  if (v.strengthen.partial) return 'strengthening';
  const cards = v.strengthen.cards;
  if (cards.every(c => c.status !== '擬議')) return 'adopted';
  return 'adopt';
}
// 全部場次（舊場排先、按開始時間）；每場有記分同較上場
export function listMatches(DIR, src, opts = {}) {
  const views = matchIds(DIR, src).map(id => loadMatch(DIR, src, id, opts)).filter(Boolean)
    .sort((a, b) => (b.legacy - a.legacy) || String(a.startedAt).localeCompare(String(b.startedAt)));
  // 較上場：只同同一類題目嘅上一場比
  views.forEach((v, i) => { v.n = i + 1; const p = views.slice(0, i).reverse().find(x => x.score && x.topic.type === v.topic.type); if (p && v.score) v.delta = { prevId: p.id, prevN: p.n, standing: v.score.standing - p.score.standing, wounded: v.score.wounded - p.score.wounded, fallen: v.score.fallen - p.score.fallen }; });
  return views;
}
export const summaryOf = v => ({ id: v.id, n: v.n, legacy: v.legacy, topic: v.topic, format: v.format, phase: v.phase, startedAt: v.startedAt, score: v.score ? { standing: v.score.standing, wounded: v.score.wounded, fallen: v.score.fallen } : null, cards: v.strengthen ? v.strengthen.cards.length : 0, packs: v.packs, failed: v.failed, next: v.next, budget: v.budget });

/* ---------- 外殼：核對 AI 交嘅每個回合（唔啱就退回或者截短，並記警告） ---------- */
function result(errors, warnings, data) { return { ok: !errors.length, errors, warnings, data }; }
// AI 先做自己做得到嘅測試（規劃書 3.15）：測試由邊個做；AI 已查結果（外部事實冇網址同查閱日期就當觀察）
export const TEST_BY = ['ai', 'founder', 'approval'];
const testByOf = (...xs) => xs.find(x => TEST_BY.includes(x)) || '';
function aiCheckedOf(list, warnings, where) {
  return arr(list).filter(x => x && txt(x.finding, 300)).slice(0, 6).map(x => {
    const sources = arr(x.sources).filter(s => s && txt(s.title, 160)).slice(0, 5).map(s => { const url = /^https?:\/\//.test(String(s.url || '')) ? txt(s.url, 400) : ''; return { title: txt(s.title, 160), url, readOn: /^\d{4}-\d{2}-\d{2}$/.test(String(s.readOn || '')) ? s.readOn : url ? isoDay(new Date()) : '' }; });
    let label = x.label === 'fact' ? 'fact' : 'observation';
    if (label === 'fact' && !sources.some(s => s.url && s.readOn)) { label = 'observation'; warnings.push(`${where}：外部事實沒有網址或查閱日期，已改為觀察`); }
    return { finding: txt(x.finding, 300), label, sources, minutes: Math.max(0, Math.min(120, Math.round(Number(x.minutes) || 0))) };
  });
}
export function checkBlue(j, { maxClaims = 12 } = {}) {
  const e = [], w = [];
  if (!j || typeof j !== 'object') return result(['藍方未有交出論證'], w, null);
  const claims = arr(j.claims).filter(c => c && /^B\d{1,2}$/.test(String(c.id)) && txt(c.claim, 300));
  if (!claims.length) e.push('藍方沒有有效論點');
  if (claims.length > maxClaims) w.push(`論點多過 ${maxClaims} 條，已截短`);
  const ids = new Set();
  const data = {
    thesis: txt(j.thesis, 300), whyNow: txt(j.whyNow, 300),
    claims: claims.slice(0, maxClaims).filter(c => !ids.has(c.id) && ids.add(c.id)).map(c => ({ id: c.id, topic: txt(c.topic, 20) || '其他', claim: txt(c.claim, 300), evidence: Math.max(0, Math.min(4, Math.round(Number(c.evidence) || 0))), source: txt(c.source, 80) || 'AI 解讀', assumptionIds: arr(c.assumptionIds).map(String).slice(0, 5) })),
    strategies: arr(j.strategies).filter(s => s && /^S\d{1,2}$/.test(String(s.id)) && txt(s.name, 40)).slice(0, 4).map(s => ({ id: s.id, name: txt(s.name, 40), summary: txt(s.summary, 300), upside: txt(s.upside, 200), firstTest: txt(s.firstTest, 200), success: txt(s.success, 200), stop: txt(s.stop, 200) })),
    admittedWeaknesses: arr(j.admittedWeaknesses).slice(0, 6).map(x => x && typeof x === 'object' ? { claimId: String(x.claimId || ''), text: txt(x.text, 300) } : txt(x, 300)).filter(x => x && (typeof x === 'string' || x.text)),
    // 有網址冇查閱日期：用今次回合嘅日子（同日查嘅）
    sources: arr(j.sources).slice(0, 30).map((s, i) => { const url = /^https?:\/\//.test(String(s && s.url || '')) ? txt(s.url, 400) : ''; const r = /^\d{4}-\d{2}-\d{2}$/.test(String(s && s.readOn || '')) ? s.readOn : url ? isoDay(new Date()) : ''; return { n: Number(s && s.n) || i + 1, title: txt(s && s.title, 160), url, readOn: r }; }).filter(s => s.title)
  };
  if (!data.thesis) e.push('藍方未有寫出一句話主張');
  if (data.admittedWeaknesses.length < 1) w.push('藍方未有承認任何弱點');
  return result(e, w, data);
}
export function checkRed(j, blue, seats) {
  const e = [], w = [];
  if (!j || typeof j !== 'object') return result(['紅方未有交出攻擊'], w, null);
  const cids = new Set(arr(blue.claims).map(c => c.id)), sids = new Set(arr(blue.strategies).map(s => s.id));
  const seen = new Set();
  const attacks = arr(j.attacks).filter(a => a && /^R\d{1,3}$/.test(String(a.id)) && cids.has(a.claimId) && txt(a.attack, 300) && !seen.has(a.id) && seen.add(a.id)).slice(0, 30).map(a => {
    const persona = txt(a.persona, 40) || '其他';
    if (seats && seats.length && !seats.includes(persona)) w.push(`有一條攻擊的身份不在席位內：${persona}`);
    return { id: a.id, claimId: a.claimId, persona, attack: txt(a.attack, 300), failureScenario: txt(a.failureScenario, 300), refuteBy: txt(a.refuteBy, 300), severity: SEV.includes(a.severity) ? a.severity : '中' };
  });
  if (!attacks.length) e.push('紅方沒有有效攻擊（攻擊須對準藍方論點）');
  if (arr(j.attacks).length > attacks.length) w.push(`有 ${arr(j.attacks).length - attacks.length} 條攻擊格式不正確或未對準論點，已剔除`);
  const data = { attacks,
    strategyAttacks: arr(j.strategyAttacks).filter(a => a && sids.has(a.strategyId) && txt(a.attack, 300)).slice(0, 8).map(a => ({ strategyId: a.strategyId, attack: txt(a.attack, 300), severity: SEV.includes(a.severity) ? a.severity : '中' })),
    missedStrategy: j.missedStrategy && txt(j.missedStrategy.name, 40) ? { name: txt(j.missedStrategy.name, 40), summary: txt(j.missedStrategy.summary, 300) } : null,
    seats: arr(j.seats).filter(s => s && txt(s.persona, 40)).slice(0, 6).map(s => ({ persona: txt(s.persona, 40), cares: txt(s.cares, 200) })) };
  return result(e, w, data);
}
export function checkRebuttal(j, red) {
  const w = [];
  const highs = new Set(arr(red.attacks).filter(a => a.severity === '高').map(a => a.id));
  const ST = ['認低威', '推翻', '部分'];
  const all = arr(j && j.rebuttals);
  const rebuttals = all.filter(r => r && highs.has(r.attackId) && ST.includes(r.stance) && txt(r.text, 300)).slice(0, 10).map(r => ({ attackId: r.attackId, stance: r.stance, text: txt(r.text, 300), evidence: txt(r.evidence, 80) || '無' }));
  if (all.length > rebuttals.length) w.push('反駁只可針對高嚴重攻擊，其餘已剔除');
  return result(highs.size && !rebuttals.length ? ['藍方沒有有效反駁'] : [], w, { rebuttals });
}
export function checkJudge(j, blue, red) {
  const e = [], w = [];
  if (!j || typeof j !== 'object') return result(['裁判未有交出判定'], w, null);
  const claims = arr(blue.claims), aids = new Set(arr(red.attacks).map(a => a.id));
  const verdicts = claims.map(c => { const v = arr(j.verdicts).find(x => x && x.claimId === c.id); return v && VERDICTS.includes(v.verdict) ? { claimId: c.id, verdict: v.verdict, reason: txt(v.reason, 300) || '未寫理由' } : null; });
  if (verdicts.some(x => !x)) e.push('裁判未判定所有論點');
  const LAND = ['成立', '部分', '不成立'];
  const data = {
    verdicts: verdicts.filter(Boolean),
    topRisks: arr(j.topRisks).filter(r => r && txt(r.risk, 300)).slice(0, 3).map((r, i) => {
      const testBy = testByOf(r.testBy, r.by), aiChecked = aiCheckedOf(r.aiChecked, w, `最傷第 ${i + 1} 位`);
      if (testBy === 'ai' && !aiChecked.length) w.push(`最傷第 ${i + 1} 位：AI 可自行完成的測試尚未進行`);
      return { rank: i + 1, risk: txt(r.risk, 300), cheapestTest: txt(r.cheapestTest, 300), stop: txt(r.stop, 300), testBy, aiChecked };
    }),
    routes: arr(j.routes).filter(r => r && txt(r.name, 40)).slice(0, 5).map((r, i) => ({ id: /^S\d{1,2}$/.test(String(r.id)) ? r.id : 'S' + (9 + i), name: txt(r.name, 40), recommended: r.recommended === true, why: txt(r.why, 300), redScore: SEV.includes(r.redScore) ? r.redScore : '中', firstTest: txt(r.firstTest, 300), stop: txt(r.stop, 300) })),
    founderDecisions: arr(j.founderDecisions).filter(d => d && txt(d.question, 200) && arr(d.options).length >= 2).slice(0, 3).map(d => ({ question: txt(d.question, 200), options: arr(d.options).slice(0, 3).map(o => txt(String(o), 120)), recommend: txt(String(d.recommend || ''), 10), why: txt(d.why, 300) })),
    assumptionChanges: arr(j.assumptionChanges).filter(a => a && txt(a.change, 300)).slice(0, 12).map(a => ({ assumptionId: txt(a.assumptionId, 10), change: txt(a.change, 300), label: 'AI 建議 · 未確認' })),
    attackVerdicts: arr(j.attackVerdicts).filter(x => x && aids.has(x.attackId) && LAND.includes(x.landed)).map(x => ({ attackId: x.attackId, landed: x.landed, note: txt(x.note, 200) })),
    overall: txt(j.overall, 300),
    factChecks: arr(j.factChecks).filter(x => x && Number(x.n)).slice(0, 30).map(x => ({ n: Number(x.n), ok: x.ok === true, note: txt(x.note, 200) }))
  };
  if (!data.topRisks.length) e.push('裁判未有列出最傷三點');
  if (!data.attackVerdicts.length) w.push('裁判未有逐條判定攻擊，紅方命中率不會顯示');
  return result(e, w, data);
}
// 重判：只可以改指定幾條（≤3）
export function checkRejudge(j, targets) {
  const verdicts = arr(j && j.verdicts).filter(v => v && targets.includes(v.claimId) && VERDICTS.includes(v.verdict)).slice(0, 3).map(v => ({ claimId: v.claimId, verdict: v.verdict, reason: txt(v.reason, 300) || '重判' }));
  return result(verdicts.length ? [] : ['裁判未有交出重判結果'], [], { verdicts });
}
// 你嘅行動「必須先問」：改價、承諾（關鍵伙伴）、改里程碑（設計稿 3.4：外殼重算，AI 填嘅值唔理）
export const askFirstOf = c => arr(c.changes).some(x => x.cell === '收入' || x.cell === '關鍵伙伴') || arr(c.routeImpact).some(r => r.change && r.change !== 'none');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// 轉強卡機械核對（設計稿 3.4）：唔合格嘅卡退回並記原因
export function checkStrengthen(j, v, { now = new Date(), matchId = '' } = {}) {
  const w = [], rejected = [];
  if (!j || !Array.isArray(j.cards)) return { ...result(['藍方未有交出轉強卡'], w, null), rejected };
  const claims = new Map(v.rows.map(r => [r.claim.id, r])), atk = new Map(v.rows.flatMap(r => r.attacks.map(a => [a.id, a])));
  const votes = new Map(arr(v.founder && v.founder.votes).map(x => [x.ref, x.agree]));
  const last = isoDay(addDays(now, 14));
  const ids = new Set(), cards = [];
  for (const [k, c] of j.cards.slice(0, 12).entries()) {
    const n = k + 1, bad = why => rejected.push({ id: String(c && c.id || '?'), n, why });
    if (!c || !/^T\d{1,2}$/.test(String(c.id)) || ids.has(c.id)) { bad('編號不正確或重複'); continue; }
    const from = c.from || {}, cids = arr(from.claimIds).map(String), aids = arr(from.attackIds).map(String);
    if (!cids.length || cids.some(x => !claims.has(x))) { bad('指向不存在的論點'); continue; }
    if (aids.some(x => !atk.has(x))) { bad('指向不存在的攻擊'); continue; }
    const verdict = (claims.get(cids[0]).verdict || {}).verdict || '';
    const disagreed = cids.some(x => votes.get(x) === false) || arr(v.founder && v.founder.challenges).some(x => cids.includes(x.claimId));
    if (verdict === '企得住' && !disagreed) { bad('企得住的論點不需出卡'); continue; }
    if (!HANDLING.includes(c.handling)) { bad('處理方式不正確'); continue; }
    if (verdict === '倒下' && !['修正', '反轉做優勢'].includes(c.handling)) { bad('倒下的論點只可修正或反轉'); continue; }
    if (JSON.stringify(c).match(/"(?:evidence|grade|證據級)"\s*:/)) { bad('卡內不可寫證據級'); continue; }
    const changes = arr(c.changes).filter(x => x && CELLS.includes(x.cell) && txt(x.after, 300)).map(x => ({ cell: x.cell, before: txt(x.before, 300), after: txt(x.after, 300) }));
    if (arr(c.changes).length > changes.length) { bad('生意模式格名不正確'); continue; }
    if (['修正', '反轉做優勢'].includes(c.handling) && !changes.length) { bad('修正或反轉須寫明修改哪一格'); continue; }
    const t = c.test || {};
    if (!txt(t.what, 300) || !txt(t.stop, 300)) { bad('沒有兩星期內的測試與停止條件'); continue; }
    let by = /^\d{4}-\d{2}-\d{2}$/.test(String(t.by || '')) ? t.by : last;
    if (by > last) { w.push(`第 ${n} 張轉強卡的測試日期超過 14 日，已改為 ${zhDay(last)}`); by = last; }
    if (by < isoDay(now)) by = last;
    const card = {
      id: c.id, from: { claimIds: cids, attackIds: aids, verdict, persona: txt(from.persona, 40) || (atk.get(aids[0]) || {}).persona || '', topRiskRank: Number(from.topRiskRank) || null, founderVote: disagreed ? '唔同意' : votes.has(cids[0]) ? '同意' : '未投' },
      critique: txt(c.critique, 300) || (atk.get(aids[0]) || {}).attack || '', judgeSaid: txt(c.judgeSaid, 300) || (claims.get(cids[0]).verdict || {}).reason || '',
      handling: c.handling, whyThis: txt(c.whyThis, 300), changes, advantage: c.handling === '反轉做優勢' ? txt(c.advantage, 300) : '',
      assumptionChanges: arr(c.assumptionChanges).filter(a => a && txt(a.text, 300)).slice(0, 4).map(a => ({ assumptionId: txt(a.assumptionId, 10), change: ['改寫', '新增', '拆開', '加限制', '取代'].includes(a.change) ? a.change : '改寫', text: txt(a.text, 300), cheapestTest: txt(a.cheapestTest, 300), supersedes: txt(a.supersedes, 10) })),
      routeImpact: arr(c.routeImpact).filter(r => r && txt(r.milestoneId, 20)).slice(0, 3).map(r => ({ milestoneId: txt(r.milestoneId, 20), change: ['delay', 'retarget', 'add', 'retire', 'trial', 'newLine', 'none'].includes(r.change) ? r.change : 'none', detail: txt(r.detail, 300), value: txt(String(r.value ?? ''), 120) })),
      test: { what: txt(t.what, 300), by, testBy: testByOf(t.testBy, t.by) || (txt(t.founderAction, 200) ? 'founder' : ''), success: txt(t.success, 300), stop: txt(t.stop, 300), founderAction: txt(t.founderAction, 200), costHours: Math.max(0, Math.min(40, Number(t.costHours) || 0)), aiChecked: aiCheckedOf(t.aiChecked, w, `第 ${n} 張轉強卡`) },
      reattacks: [], status: '擬議', label: 'AI 建議 · 未確認', founderNote: ''
    };
    // AI 自己做得到嘅測試唔交畀你做；應查而未查嘅照出卡，標「AI 未查」
    if (card.test.testBy === 'ai' && card.test.founderAction) { w.push(`第 ${n} 張轉強卡：AI 可自行完成的測試不需由你進行，已剔除「你要做」`); card.test.founderAction = ''; }
    if (card.test.testBy === 'ai' && !card.test.aiChecked.length) { card.test.aiNote = /時限/.test(JSON.stringify(t)) ? '時限不足' : '未查'; w.push(`第 ${n} 張轉強卡：AI 可自行完成的測試尚未進行`); }
    if (card.routeImpact.some(r => r.change !== 'none' && !r.value)) { bad('觸及里程碑但未寫可執行的數值'); continue; }
    card.askFirst = askFirstOf(card);
    ids.add(card.id); cards.push(card);
  }
  if (cards.length > 8) { w.push('轉強卡多於八張，已截短'); cards.length = 8; }
  const kept = new Set(cards.map(c => c.id));
  const data = {
    matchId, basedOn: { blue: 'blue.json', red: 'red.json', rebuttal: v.rebuttals ? 'rebuttal.json' : '', judge: 'judge.json' }, cards,
    accepted: arr(j.accepted).filter(a => a && claims.has(a.claimId)).slice(0, 12).map(a => ({ claimId: a.claimId, note: txt(a.note, 300) })),
    modelRevision: j.modelRevision ? { version: Number(j.modelRevision.version) || 2, summary: txt(j.modelRevision.summary, 300), cells: arr(j.modelRevision.cells).filter(x => x && CELLS.includes(x.cell) && kept.has(x.fromCardId) && txt(x.text, 300)).map(x => ({ cell: x.cell, text: txt(x.text, 300), fromCardId: x.fromCardId })) } : null,
    founderQuestions: arr(j.founderQuestions).filter(q => q && kept.has(q.cardId)).map(q => ({ cardId: q.cardId, question: txt(q.question, 200), recommend: ['A', 'B', 'C'].includes(q.recommend) ? q.recommend : 'A', why: txt(q.why, 300) }))
  };
  for (const r of rejected) w.push(`第 ${r.n} 張轉強卡已退回：${r.why}`);
  return { ...result(cards.length ? [] : ['全部轉強卡均不合格'], w, data), rejected };
}
export function checkReattackRed(j, cards) {
  const ids = new Set(cards.map(c => c.id));
  const attacks = arr(j && j.attacks).filter(a => a && ids.has(a.cardId) && txt(a.attack, 300)).map(a => ({ cardId: a.cardId, persona: txt(a.persona, 40) || '紅方', attack: txt(a.attack, 300), severity: SEV.includes(a.severity) ? a.severity : '中' }));
  const one = [...new Map(attacks.map(a => [a.cardId, a])).values()];
  return result(one.length ? [] : ['紅方未有再攻任何一張卡'], one.length < ids.size ? [`紅方只再攻了 ${one.length}／${ids.size} 張卡`] : [], { attacks: one });
}
export function checkReattackJudge(j, attacks) {
  const ids = new Set(attacks.map(a => a.cardId));
  const verdicts = [...new Map(arr(j && j.verdicts).filter(v => v && ids.has(v.cardId) && VERDICTS.includes(v.verdict)).map(v => [v.cardId, { cardId: v.cardId, verdict: v.verdict, reason: txt(v.reason, 300) || '未寫理由' }])).values()];
  return result(verdicts.length ? [] : ['裁判未有判定轉強卡'], verdicts.length < ids.size ? [`裁判只判定了 ${verdicts.length}／${ids.size} 張卡`] : [], { verdicts });
}

/* ---------- 問題包（外殼機械出，唔使 AI） ---------- */
const KM_LABEL = { '一擊倒下': '一擊倒下', '最傷': '最傷', '盲點': '盲點', '反轉': '反轉', '漏咗嘅路': '遺漏的路線' };
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const when = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(iso || '')); return m ? `${+m[2]} 月 ${+m[3]} 日 ${m[4]}` : ''; };
const zhDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${+m[2]} 月 ${+m[3]} 日` : String(s || ''); };
// 「辯論回應」：三條關鍵時刻各一題同意／唔同意；收起：真實證據（連證據級）、挑戰裁判。唔答就照裁判原判開始轉強。
export function responsePack(v) {
  const kms = v.keyMoments.slice(0, 3);
  const name = v.topic.title || '紅藍對打';
  const refs = {};
  const qs = kms.map((k, i) => {
    refs['v' + (i + 1)] = k.ref;
    const row = v.rows.find(r => r.claim.id === k.ref);
    return { id: 'v' + (i + 1), priority: i + 1, ask: `【${KM_LABEL[k.kind] || k.kind}】${clip(k.text, 60)}${row && row.verdict ? `——裁判判「${row.verdict.verdict}」` : ''}。你同意裁判嗎？`, kind: 'choice',
      options: [{ text: '同意裁判', rec: true }, { text: '不同意' }], value: '同意裁判', why: clip(row && row.verdict ? row.verdict.reason : k.detail || '按裁判判定', 120) };
  });
  qs.push({ id: 'ev', priority: 4, ask: `就「${clip(name, 24)}」（${when(v.startedAt)}）這場，你手上有沒有真實證據可以推翻某條攻擊？如有，請寫一句：是誰、做過甚麼。`, kind: 'text', value: '沒有', why: '只有真實客戶、伙伴或付款者的行為才算證據；你確認後才會記錄，AI 不會自行更改證據級。' });
  qs.push({ id: 'evg', priority: 5, ask: `如果有，這個證據去到哪一級？（${when(v.startedAt)} 場）`, kind: 'choice', options: [{ text: NAMES.dash.ev_1, rec: true }, { text: NAMES.dash.ev_2 }, { text: NAMES.dash.ev_3 }], value: NAMES.dash.ev_1, why: '按實際發生的事選擇；沒有證據便無須理會。' });
  qs.push({ id: 'ch', priority: 6, ask: `你覺得裁判判錯了哪一條？為甚麼？（${when(v.startedAt)} 場；沒有就留空）`, kind: 'text', value: '沒有', why: '寫了就會請裁判重判（最多三條，一場一次）；你的原話會原文交給裁判。' });
  return { format: 'startup-os.ask/0.1', title: clip('紅藍對打回應：' + name, 60), context: '裁判已判定。請對三個關鍵時刻表態；不答就按裁判判定開始轉強。辯論結果不算證據。',
    afterConfirm: '按你的回應開始轉強：AI 把受傷及倒下的論點變成轉強卡，紅方再攻一輪，之後請你採用。', questions: qs, debate: { matchId: v.id, kind: 'response', refs } };
}
const H_SHORT = { '修正': '修正', '反轉做優勢': '反轉做優勢', '先驗證': '先驗證', '接受並監察': '接受並監察' };
export const ADOPT_OPTS = { adopt: '採用', test: '改為先驗證', reject: '不採用' };
// 「轉強採用」：必須先問嘅卡（改價、承諾、里程碑）逐條即時生效，每包最多三條；其餘卡暫定，主按鈕照 AI 建議採用
export function adoptionPacks(v) {
  if (!v.strengthen) return [];
  const cards = v.strengthen.cards.filter(c => c.status === '擬議');
  const fq = new Map(v.strengthen.founderQuestions.map(q => [q.cardId, q]));
  const qOf = (c, now) => {
    const ch = c.changes[0];
    const re = c.reattacks.filter(r => r.round === Math.max(...c.reattacks.map(x => x.round))).map(r => r.verdict)[0];
    const fallen = c.from.verdict === '倒下';
    const opts = [{ text: ADOPT_OPTS.adopt, rec: true }].concat(fallen || c.handling === '先驗證' ? [] : [{ text: ADOPT_OPTS.test }]).concat([{ text: ADOPT_OPTS.reject }]);
    const q = fq.get(c.id);
    const rec = q && q.recommend === 'C' ? ADOPT_OPTS.reject : q && q.recommend === 'B' && !fallen && c.handling !== '先驗證' ? ADOPT_OPTS.test : ADOPT_OPTS.adopt;
    opts.forEach(o => { o.rec = o.text === rec; });
    return { id: 'c-' + c.id, ask: `「${clip(c.critique, 40)}」→ ${H_SHORT[c.handling]}${ch ? `：${ch.cell}改為「${clip(ch.after, 50)}」` : `：${clip(c.test.what, 50)}`}${re ? `（再攻後${re}）` : ''}。採用嗎？`,
      kind: 'choice', effect: now ? 'now' : 'tentative', options: opts, value: rec, why: clip((q && q.why) || c.whyThis || '按轉強規則', 120) + ((c.test.aiChecked || []).length ? `；AI 已查證 ${c.test.aiChecked.length} 項` : c.test.testBy === 'ai' ? '；AI 未查' : '') + (c.test.founderAction ? `；採用後${c.test.testBy === 'approval' ? '要你批准' : '你要做'}：${clip(c.test.founderAction, 40)}（${zhDay(c.test.by)} 前）` : '') };
  };
  const first = cards.filter(c => c.askFirst), rest = cards.filter(c => !c.askFirst);
  const name = clip(v.topic.title || '紅藍對打', 30);
  const packs = [];
  const chunks = [];
  for (let i = 0; i < first.length; i += 3) chunks.push(first.slice(i, i + 3));
  if (!chunks.length) chunks.push([]);
  chunks.forEach((part, i) => {
    const qs = part.map((c, k) => ({ ...qOf(c, true), priority: k + 1 })).concat(i === 0 ? rest.map((c, k) => ({ ...qOf(c, false), priority: 4 + k })) : []);
    if (!qs.length) return;
    packs.push({ format: 'startup-os.ask/0.1', title: clip('採用轉強：' + name + (chunks.length > 1 ? `（${i + 1}／${chunks.length}）` : ''), 60),
      context: '每張轉強卡把一個批評變成修正、優勢、測試或觀察；改價、承諾及里程碑要你逐張確認。採用不會令任何證據級上升。',
      afterConfirm: '採用的卡會變成有日期的測試及你要做的行動；不採用的卡保留紀錄。', questions: qs, debate: { matchId: v.id, kind: 'adopt', cards: part.map(c => c.id).concat(i === 0 ? rest.map(c => c.id) : []) } });
  });
  return packs;
}
export function evidencePack(v, text, grade) {
  return { format: 'startup-os.ask/0.1', title: clip('確認真實證據：' + (v.topic.title || '紅藍對打'), 60), context: '你在辯論回應寫了一個真實證據。確認後記錄為現實輸入；證據級只由你確認先算。',
    questions: [{ id: 'confirm', priority: 1, ask: `你寫的證據：「${clip(text, 80)}」（${NAMES.evName(grade)}）。確認記錄為真實證據嗎？`, kind: 'choice', effect: 'now', options: [{ text: '確認記錄', rec: true }, { text: '暫不記錄' }], value: '確認記錄', why: '只有真實客戶、伙伴或付款者的行為先算證據。' }],
    debate: { matchId: v.id, kind: 'evidence', text: clip(text, 300), grade } };
}
