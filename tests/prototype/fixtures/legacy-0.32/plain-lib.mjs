// startup-os 顯示用白話（唯一計算處；規劃書 3.1 創辦人可見文字規則、4.10 自足檢查）：創辦人睇到嘅文字要自足、商用書面語，
// 唔可以有內部代號、級數數字或機器值、章節符號、檔名、英文欄位名、不完整日期同口語字（比對清單喺 names.js 嘅 styleIssues）。
// AI 輸出原檔唔郁；有問題就由外殼叫 AI 改寫一份「顯示用版本」放喺 <資料>/display/，畫面優先讀顯示用版本。
// 4.10 處理次序：(1) 先改寫一次，改寫句逐段機械核對（長度、新數字或日期、聲稱字句），唔過嘅段落用返原文；
// (2) 仍然命中：查得到對象嘅編號換成該對象嘅名稱或標題、級數同機器值換成五級名稱；
// (3) 其餘（查唔到嘅編號、章節符號、檔名、英文欄位名等）原句照放，該行加「含內部用語」標記，外殼記 health.warnings。
// 創辦人原話（標「你原話」嘅行、founder 欄）唔掃、唔改。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NAMES, readJSON } from './ask-lib.mjs';

// 機器欄位：唔係畫面文字（編號、日期碼、網址、列舉值）
export const MACHINE = new Set(['id', 'ref', 'n', 'claimId', 'claimIds', 'attackId', 'attackIds', 'strategyId', 'cardId', 'fromCardId', 'assumptionId', 'assumptionIds', 'supersedes',
  'milestoneId', 'taskId', 'taskIds', 'packId', 'runId', 'matchId', 'url', 'readOn', 'by', 'testBy', 'label', 'handling', 'verdict', 'landed', 'stance', 'severity', 'redScore',
  'change', 'cell', 'kind', 'type', 'status', 'phase', 'format', 'recommend', 'founderVote', 'basedOn', 'source', 'packs', 'next', 'roles', 'queuedAt', 'endedAt', 'respondedAt', 'prevId', 'href', 'waitHref', 'chooseHref', 'file', 'files', 'practiceId', 'pass', 'at', 'startedAt', 'updatedAt', 'createdAt', 'version', 'ok', 'minutes', 'evidence', 'rank', 'topRiskRank', 'costHours', 'recommended', 'agree', 'grade']);
// 創辦人原話：唔掃、唔改（規劃書 4.10）
export const ORIGINAL = new Set(['founder', 'founderNote', 'founderQuote', 'quote', 'original']);
export const MARK = '〔含內部用語〕';
// 唔掃、唔改嘅欄位。例外：裁判結論嘅假設變動（有 assumptionId、冇 text）入面嘅 change 係畫面文字（改寫後嘅假設內容）；
// 轉強卡嘅假設變動 change 係列舉值（改寫／新增…），文字喺 text。
const skip = (k, holder) => ORIGINAL.has(k) || (MACHINE.has(k) && !(k === 'change' && holder && typeof holder === 'object' && 'assumptionId' in holder && !('text' in holder)));
// 要加標記嘅命中類型（口語字只記警告，唔加標記）
const SELF = ['code', 'section', 'date', 'field', 'level', 'jargon', 'tone'];

export const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// 一行拆成可處理同受保護嘅片段（規劃書 4.10：創辦人原話唔掃、唔改）：Markdown 表格逐格處理；
// 「你原話」之後有引號就只保護引號內嘅原話，冇引號就保護標籤之後成句；標籤後面括號入面嘅出處（檔名、§）唔受保護。
// 標籤喺括號入面、原話引號喺標籤前面（「……」（你原話，……））：前面緊貼嘅引號受保護，成組括號當出處。
const cellsOf = line => /^\s*\|.*\|\s*$/.test(line) ? line.split('|') : [line];
export function partsOf(seg) {
  const out = []; let rest = String(seg);
  const quotes = (chunk, keepAll) => {
    if (!/「[^」]*」/.test(chunk)) { out.push({ t: chunk, keep: keepAll }); return; }
    let last = 0;
    for (const m of chunk.matchAll(/「[^」]*」/g)) { out.push({ t: chunk.slice(last, m.index), keep: false }, { t: m[0], keep: true }); last = m.index + m[0].length; }
    out.push({ t: chunk.slice(last), keep: false });
  };
  for (;;) {
    const i = rest.indexOf('你原話');
    if (i < 0) { out.push({ t: rest, keep: false }); break; }
    const inParen = i > 0 && /[（(]/.test(rest[i - 1]);
    const head = rest.slice(0, inParen ? i - 1 : i), pre = /「[^」]*」\s*$/.exec(head);
    if (pre) out.push({ t: head.slice(0, pre.index), keep: false }, { t: pre[0], keep: true }); else out.push({ t: head, keep: false });
    rest = rest.slice(head.length);
    if (inParen) {
      const j = rest.indexOf(rest[0] === '（' ? '）' : ')'), g = j < 0 ? rest : rest.slice(0, j + 1);
      out.push({ t: g, keep: false }); rest = rest.slice(g.length);
    } else {
      out.push({ t: '你原話', keep: false }); rest = rest.slice(3);
      const cite = /^\s*(?:（[^（）]*）|\([^()]*\))/.exec(rest);
      if (cite) { out.push({ t: cite[0], keep: false }); rest = rest.slice(cite[0].length); }
    }
    const next = rest.indexOf('你原話'), chunk = next < 0 ? rest : rest.slice(0, next);
    rest = next < 0 ? '' : rest.slice(next);
    // 原話已經喺標籤前面（pre）或者標籤喺括號入面：之後嘅字照處理，只保護引號；否則冇引號就成句當原話
    quotes(chunk, !(pre || inParen));
    if (!rest) break;
  }
  return out.filter(p => p.t);
}
// 命中：AI 腔只計 AI 自己寫嘅字，引號入面引述嘅原文（外部文件、對方說話）唔計 AI 腔
const issuesIn = t => NAMES.styleIssues(t).filter(i => i.kind !== 'tone').concat(NAMES.styleIssues(String(t).replace(/「[^」]*」|“[^”]*”/g, '「」')).filter(i => i.kind === 'tone'));
// 一段文字嘅命中：原話唔計；已加標記嘅格（已經照放）唔再計
export function issuesOf(s) {
  if (typeof s !== 'string') return [];
  return s.split(/\r?\n/).flatMap(cellsOf).filter(c => !c.includes(MARK)).flatMap(c => partsOf(c).filter(p => !p.keep).flatMap(p => issuesIn(p.t)));
}

// 逐個畫面文字欄位行一次
export function walkText(o, fn, at = []) {
  if (Array.isArray(o)) { o.forEach((x, i) => walkText(x, fn, at.concat(i))); return; }
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (skip(k, o)) continue;
    if (typeof v === 'string') fn(v, at.concat(k));
    else if (v && typeof v === 'object') walkText(v, fn, at.concat(k));
  }
}
export function scanJSON(o) {
  const hits = [];
  walkText(o, (v, at) => { for (const i of issuesOf(v)) hits.push({ path: at.join('.'), kind: i.kind, term: i.term, text: v }); });
  return hits;
}
export function scanText(t) { return issuesOf(t).map(i => ({ path: '', kind: i.kind, term: i.term, text: '' })); }

// 改寫後結構要一樣：所有鍵同機器欄位嘅值唔變，陣列長度唔變
export function sameShape(a, b) {
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameShape(x, b[i]));
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return false;
    return ka.every(k => skip(k, a) ? JSON.stringify(a[k]) === JSON.stringify(b[k]) : sameShape(a[k], b[k]));
  }
  return typeof a === typeof b;
}
// Markdown 改寫後標題結構要一樣（生意大腦按 ## 同 ### 拆卡）
export const headings = t => String(t || '').split(/\r?\n/).filter(l => /^#{1,3} /.test(l)).map(l => l.match(/^#+/)[0]).join(',');

/* ---------- (1) 改寫句機械核對（4.10）：長度不多於原句一倍半（短句以原句加二十字為限）、唔加原句冇嘅數字或日期、唔加聲稱字句 ---------- */
// 數字按數值比較（08 同 8、30,000 同 30000 當同一個）
const NUMS = s => (String(s).match(/\d+(?:[.,]\d+)*/g) || []).map(n => n.replace(/,/g, '').replace(/^0+(?=\d)/, ''));
// 原型詮釋：原句先按 (2) 機械展開查得到嘅編號（外殼本來就會換入嘅名稱），長度上限、數字同聲稱字句都以「原句＋展開版」為基準；
// 否則把短編號換成名稱嘅合理改寫會因為變長而被退回。
export function rewriteOk(a, b, ctx = null) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const base = ctx ? deCode(a, ctx).split(' ' + MARK).join('').split(MARK).join('') : a;
  const len = Math.max(a.length, base.length);
  if (b.length > Math.max(len * 1.5, len + 20)) return false;
  const na = new Set(NUMS(a).concat(NUMS(base)));
  if (NUMS(b).some(n => !na.has(n))) return false;
  if (NAMES.CLAIM_WORDS.some(w => b.includes(w) && !a.includes(w) && !base.includes(w))) return false;
  return true;
}
// JSON：以原檔結構為準逐個文字欄位核對——機器欄位、鍵、陣列長度一律用原檔（AI 改咗都唔收），
// 文字欄位改寫唔過核對或者改寫版冇對應位置就用返原文；回 { value, rejected }
export function mergeRewriteJSON(a, b, ctx = null) {
  let rejected = 0;
  const walk = (x, y) => {
    if (Array.isArray(x)) return x.map((v, i) => walk(v, Array.isArray(y) ? y[i] : undefined));
    if (x && typeof x === 'object') { const yy = y && typeof y === 'object' && !Array.isArray(y) ? y : {}; const r = {}; for (const k of Object.keys(x)) r[k] = skip(k, x) ? x[k] : walk(x[k], yy[k]); return r; }
    if (typeof x === 'string') { if (typeof y === 'string' && rewriteOk(x, y, ctx)) return y; if (y !== x) rejected++; return x; }
    return x;
  };
  return { value: walk(a, b), rejected };
}
// Markdown：按標題分段逐段核對（標題結構已核對一樣），唔過嘅段落用返原文；回 { text, rejected }
export function mergeRewriteMd(a, b, ctx = null) {
  const split = t => String(t).split(/\r?\n(?=#{1,3} )/);
  const sa = split(a), sb = split(b);
  if (sa.length !== sb.length) return { text: a, rejected: sa.length };
  let rejected = 0;
  const out = sa.map((x, i) => { if (rewriteOk(x, sb[i], ctx)) return sb[i]; rejected++; return x; });
  return { text: out.join('\n'), rejected };
}

/* ---------- (2)(3) 機械替換同標記 ---------- */
const EV = [0, 1, 2, 3, 4].map(i => NAMES.dash['ev_' + i]);
const LV = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4 };
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const q = (s, n = 24) => '「' + clip(s, n) + '」';
// ctx：{ claims:{B1:'論點'}, routes:{S1:'路線名'}, cards:{T1:{n:1,title:''}}, attacks:{R1:'攻擊'}, assumptions:{H1:'假設'}, tasks:{t5:'工作'}, milestones:{m4:'站點'}, decisions:{D20:'決定'} }
// 出處：括號入面嘅檔名同章節符號刪走（畫面只顯示來源標籤；主線 2026-10-28），刪完冇嘢就連括號一齊刪
const FILE_RE = /[^\s，。、；：「」（）()|]+\.(?:md|json|js|mjs|txt)\b/g, SEC_RE = /§\s*[\d.一二三四五六七八九十]+(?:\s*[至-]\s*[\d.]+)?/g;
function cleanCite(c) {
  if (!/\.(?:md|json|js|mjs|txt)\b|§/.test(c)) return c;
  const open = c[0], close = open === '（' ? '）' : ')';
  const inner = c.slice(1, -1).replace(FILE_RE, '').replace(SEC_RE, '').replace(/^[\s，、；·:：及和]+|[\s，、；·:：及和]+$/g, '').replace(/\s{2,}/g, ' ');
  return inner ? open + inner + close : '';
}
const OLD_EV = /(未有人講過|有人講過|有人做過|有人付出代價|冇咗會痛)/g;
// 可處理片段嘅機械替換（4.10 (2)）：查得到嘅編號、級數同機器值、舊證據級名稱、短日期、出處檔名同章節、名稱表有代稱嘅口語字
// ctx.trace（陣列）有就逐處記低「原文 → 替換後」同前後文，供人手覆核有冇改錯意思
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function transform(t, ctx) {
  const look = (map, id) => map && map[id];
  const R = (cat, re, fn) => {
    t = t.replace(re, (...a) => {
      const r = fn(...a);
      if (ctx.trace && r !== a[0]) { const at = a[a.length - 2], src = a[a.length - 1]; ctx.trace.push({ cat, from: a[0], to: r, context: src.slice(Math.max(0, at - 24), at + a[0].length + 24) }); }
      return r;
    });
  };
  R('來源標籤', /（[^（）]*）|\([^()]*\)/g, m => cleanCite(m));
  R('來源標籤', /(見|參考|參閱|詳見|按|根據)\s*§\s*[\d.一二三四五六七八九十]+/g, (m, a) => a + '相關章節');
  R('來源標籤', SEC_RE, () => '');
  R('來源標籤', FILE_RE, () => '相關文件');
  R('級數', /(假設|口頭表示|實際行動|付出成本|形成依賴)(」?)（(未有人講過|有人講過|有人做過|有人付出代價|冇咗會痛)）/g, (m, a, q2, b) => NAMES.evName(b) === a ? a + q2 : m);
  R('級數', OLD_EV, m => NAMES.evName(m));
  R('編號', /\bH\d{1,3}\b/g, m => look(ctx.assumptions, m) ? '假設' + q(ctx.assumptions[m]) : m);
  R('編號', /\bS\d{1,2}\b/g, m => look(ctx.routes, m) ? q(ctx.routes[m], 30) + '路線' : m);
  R('編號', /\bB\d{1,2}\b/g, m => look(ctx.claims, m) ? '論點' + q(ctx.claims[m]) : m);
  R('編號', /\bT\d{1,2}\b/g, m => { const c = look(ctx.cards, m); return c ? (c.title ? '轉強卡' + q(c.title) : '第 ' + c.n + ' 張轉強卡') : m; });
  R('編號', /\bR\d{1,3}\b/g, m => look(ctx.attacks, m) ? '紅方攻擊' + q(ctx.attacks[m]) : m);
  R('編號', /\b[tm]\d{1,3}\b/g, m => look(ctx.tasks, m) ? '工作' + q(ctx.tasks[m]) : look(ctx.milestones, m) ? '站點' + q(ctx.milestones[m]) : m);
  R('編號', /\bD\d{1,3}\b/g, m => look(ctx.decisions, m) ? '決定' + q(ctx.decisions[m]) : m);
  // 級數只喺證據級語境換：「同一級別」「採購級別」嘅「級別」唔係證據級（主線 2026-10-28 真機核對）
  R('級數', /([零一二三四])[級级](?!方程|別)/g, (m, d) => '「' + EV[LV[d]] + '」');
  R('級數', /\b([0-4])\s*級(?!別)/g, (m, d) => '「' + EV[Number(d)] + '」');
  R('級數', /\b(guess|said|did|paid|stuck)\b/g, m => '「' + NAMES.evName(m) + '」');
  R('日期', /(?<![\d\/-])(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![\d-])/g, (m, a, b) => Number(a) + ' 月 ' + Number(b) + ' 日');
  for (const [a, b] of NAMES.COLLOQUIAL_ALIAS) R('口語字代稱', new RegExp(esc(a), 'g'), () => b);
  R('口語字代稱', /(?<![關聯維])係/g, () => '是');
  return t;
}
// 一格（或一行）：可處理片段照換，原話照放；仲有查唔到嘅就喺格尾加「含內部用語」標記（4.10 (3)）
function cellDeCode(cell, ctx) {
  const base = cell.split(' ' + MARK).join('').split(MARK).join('');
  const parts = partsOf(base).map(p => p.keep ? p : { t: transform(p.t, ctx), keep: false });
  const text = parts.map(p => p.t).join('');
  const left = parts.filter(p => !p.keep).flatMap(p => issuesIn(p.t)).filter(i => SELF.includes(i.kind));
  if (!left.length) return { text, marked: false };
  const m = /\s*$/.exec(text);
  return { text: text.slice(0, m.index) + ' ' + MARK + m[0], marked: true };
}
function lineDeCode(line, ctx) {
  const cells = cellsOf(line);
  if (cells.length === 1) return cellDeCode(line, ctx);
  let marked = false;
  const text = cells.map((c, i) => { if (i === 0 || i === cells.length - 1) return c; const r = cellDeCode(c, ctx); marked = marked || r.marked; return r.text; }).join('|');
  return { text, marked };
}
export function deCodeInfo(s, ctx = {}) {
  if (typeof s !== 'string') return { text: s, marked: 0 };
  let marked = 0;
  const text = s.split(/(\r?\n)/).map(part => { if (/^\r?\n$/.test(part)) return part; const r = lineDeCode(part, ctx); if (r.marked) marked++; return r.text; }).join('');
  return { text, marked };
}
export const deCode = (s, ctx = {}) => deCodeInfo(s, ctx).text;
export function deCodeJSONInfo(o, ctx = {}) {
  let marked = 0;
  const walk = x => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    const r = {};
    for (const [k, v] of Object.entries(x)) {
      if (skip(k, x)) r[k] = v;
      else if (typeof v === 'string') { const d = deCodeInfo(v, ctx); marked += d.marked; r[k] = d.text; }
      else r[k] = walk(v);
    }
    return r;
  };
  return { value: walk(o), marked };
}
export const deCodeJSON = (o, ctx) => deCodeJSONInfo(o, ctx).value;
// 假設清單（Markdown 表格「| H1 | 內容 | … |」或者「H1：內容」）→ { H1: '內容' }
export function assumptionsFrom(md) {
  const out = {};
  for (const l of String(md || '').split(/\r?\n/)) {
    const m = /^\|\s*(H\d{1,3})\s*\|\s*([^|]+?)\s*\|/.exec(l) || /^[-*]?\s*(H\d{1,3})\s*[：:]\s*(.+)$/.exec(l);
    if (m && !out[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

// 試驗資料夾入面嘅假設清單（檔名有「假設」嘅 Markdown）
export function folderAssumptions(dir) {
  let out = {};
  try { for (const f of fs.readdirSync(dir).filter(f => /假設/.test(f) && f.endsWith('.md'))) out = { ...assumptionsFrom(fs.readFileSync(path.join(dir, f), 'utf8')), ...out }; } catch { }
  return out;
}

/* ---------- 顯示用版本放邊度 ---------- */
// key：source/<相對路徑>（試驗資料夾）或者 debates/<場次>/<檔名>（新場次）
export const displayDir = DIR => path.join(DIR.data, 'display');
export const displayPath = (DIR, key) => path.join(displayDir(DIR), ...key.split('/'));
export function displayIndex(DIR) { return readJSON(path.join(displayDir(DIR), 'index.json'), {}) || {}; }
// 讀檔：有對應而且原檔冇改過嘅顯示用版本就用顯示用版本
export function readDisplay(DIR, key, srcFile) {
  let src; try { src = fs.readFileSync(srcFile, 'utf8'); } catch { return null; }
  const idx = displayIndex(DIR)[key], p = displayPath(DIR, key);
  if (idx && idx.sha === sha(src) && fs.existsSync(p)) { try { return fs.readFileSync(p, 'utf8'); } catch { } }
  return src;
}
