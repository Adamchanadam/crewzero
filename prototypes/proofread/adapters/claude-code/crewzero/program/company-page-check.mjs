// 公司概覽核對同可修正嘅欄位。
import { createRequire } from 'node:module';
import { BIZ_TYPES } from './ask-lib.mjs';
const NAMES = createRequire(import.meta.url)('./names.js');

/* ---------- 規劃書 3.1 就緒清單同 3.3 里程碑四格（唯一定義處；外殼、校對頁統計、測試共用） ----------
   G1–G10 全部有值先可以排里程碑：「有值」包括暫定值同用預設。G4＝「目前去到哪裏」各項；G7、G8、G10 喺規則區。
   每個里程碑要填齊四格：事件、決策者（外部角色）、見證人、證明。 */
// 只在新草稿核對時補齊；舊公司概覽遷移不加生意模式欄位。
export const READING_FIELDS = [
  ['biz.type', '生意類型'],
  ['canvas.customer', '客戶'],
  ['canvas.problem', '對方的問題'],
  ['canvas.alternatives', '現有替代方案'],
  ['canvas.value', '價值'],
  ['canvas.channel', '渠道'],
  ['canvas.relationship', '客戶關係'],
  ['canvas.revenue', '收入'],
  ['canvas.resources', '關鍵資源'],
  ['canvas.activities', '關鍵活動'],
  ['canvas.partners', '關鍵伙伴'],
  ['canvas.cost', '成本']
];
export const READING_PLANS = READING_FIELDS.map(([plan]) => plan);
function completeReading(page) {
  const detail = page.detail = page.detail && typeof page.detail === 'object' ? page.detail : {};
  const reading = listOf(detail.reading), ids = new Set(fieldsOf(page).map(f => f.id));
  const uid = base => { let id = base, n = 2; while (ids.has(id)) id = base + '-' + n++; ids.add(id); return id; };
  const labels = Object.values(BIZ_TYPES).map(x => x.label);
  detail.reading = READING_FIELDS.map(([plan, label]) => {
    const f = reading.find(x => x && x.plan === plan) || { plan, value: '待你補充', origin: 'missing' };
    if (typeof f.id !== 'string' || !f.id) f.id = uid(plan.replaceAll('.', '-'));
    f.label = label;
    if (!String(f.value ?? '').trim()) { f.value = '待你補充'; f.origin = 'missing'; }
    if (plan === 'biz.type') {
      f.value = labels.includes(f.value) ? f.value : BIZ_TYPES.other.label;
      f.kind = 'choice'; f.origin = 'ai';
      f.options = labels.map(text => ({ text, ...(text === f.value ? { rec: true } : {}) }));
      f.why = '只影響問題及例子的用字，可以更改。';
      delete f.src;
    } else if (!f.kind) f.kind = 'text';
    return f;
  }).concat(reading.filter(x => x && !READING_PLANS.includes(x.plan)));
}
// 日子次序（只在 ready 核對時當錯誤，叫 AI 修正一次；仍有問題不阻校對，校對頁會提示、確認時再收窄）
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
// 只認存在的日子（2027-02-30 這類會被日期物件溢出成 3 月 2 日，不當有效）
export function validDay(s) {
  const m = DAY.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
// 句首日期規則：與校對頁 legacyDate() 用同一組（前綴「至／在／於」可有可無；ISO 日期同樣；日期後可有「前」）
export const LEGACY_LEAD = {
  iso: /^\s*(?:至|在|於)?\s*(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:前|之前|止)?\s*[：:，,]\s*/,
  zh: /^\s*(?:至|在|於)?\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(?:前|之前|止)?\s*[：:，,]\s*/
};
// 以日期開頭（不論有沒有冒號）：任何一項都報告
const DATE_LEAD = /^\s*(?:至|在|於)?\s*(?:(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{1,2}-\d{1,2})/;
// 內容任何位置的日期（月日，不論有無年份；或 ISO）：只查 G1、G2
const DATE_ANY = /(?:\d{4}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}-\d{1,2}-\d{1,2}/;
export function dateOrderIssues(page) {
  const out = [], rows = (page && page.glance && Array.isArray(page.glance.rows)) ? page.glance.rows : [];
  const g1 = rows.find(r => r && r.plan === 'G1'), g2 = rows.find(r => r && r.plan === 'G2');
  const dueVal = r => r && r.due ? String(r.due.value || '') : '';
  const g1Due = validDay(dueVal(g1)) ? dueVal(g1) : '', g2Due = validDay(dueVal(g2)) ? dueVal(g2) : '';
  for (const [r, nm] of [[g1, 'G1.endsOn'], [g2, 'G2.endsOn']]) if (r && dueVal(r) && !validDay(dueVal(r))) out.push('「' + NAMES.field[nm] + '」（' + dueVal(r) + '）不是存在的日子：請改為真實存在的日子（YYYY-MM-DD）');
  if (g2 && !dueVal(g2)) out.push('「' + NAMES.field.G2 + '」沒有獨立期限：請加 due（plan 寫 "G2.endsOn"、kind 寫 "date"、value 寫 YYYY-MM-DD），日期預設取目前目標期限與設定日加 28 日中較早的一個');
  for (const r of rows) {
    const v = String(r && r.value || '');
    if (!r || r.kind === 'grade') continue;
    // 只防「期限寫進句子」：任何一項以日期開頭都報告；G1、G2 內容任何位置有日期都報告（其他項目中間的事實日期可以有，例如「2026 年 11 月 6 日已答應加入」）
    const name = '「' + (NAMES.field[r.plan] || r.label || '一項') + '」';
    if (DATE_LEAD.test(v)) out.push(name + '內容以日期開頭：日期只可放在 due，內容不要以日期開頭');
    else if (['G1', 'G2'].includes(r.plan) && DATE_ANY.test(v)) out.push(name + '內容寫了日期：期限只可放在 due，內容不要寫日期');
  }
  if (g1Due && g2Due && g2Due > g1Due) out.push('「' + NAMES.field['G2.endsOn'] + '」（' + g2Due + '）遲於「' + NAMES.field['G1.endsOn'] + '」（' + g1Due + '）：請改為不遲於目前目標期限');
  const badUntil = fieldsOf(page).filter(f => f.tentative && f.tentative.until != null && String(f.tentative.until) !== '' && !validDay(f.tentative.until));
  if (badUntil.length) out.push(badUntil.length + ' 項暫定值的覆核日不是存在的日子（' + badUntil.slice(0, 3).map(f => f.label || f.id).join('、') + (badUntil.length > 3 ? ' 等' : '') + '）：請改為真實存在的日子（YYYY-MM-DD）');
  if (g1Due) {
    const late = fieldsOf(page).filter(f => f.tentative && validDay(f.tentative.until) && f.tentative.until > g1Due);
    if (late.length) out.push(late.length + ' 項暫定值的覆核日遲於「' + NAMES.field['G1.endsOn'] + '」（' + g1Due + '）：請把 tentative.until 改為不遲於目前目標期限（' + late.slice(0, 3).map(f => f.label || f.id).join('、') + (late.length > 3 ? ' 等' : '') + '）');
  }
  return out;
}
// 開局答案欄（唯一定義處之一；proofread.html 的 openingIds() 用同一判斷寫法）：
// 每個 G1–G10 計劃只有一個欄是開局答案——「目標與現況」(glance) 內的欄優先，其次規則區 (detail.rules)，再其次其他位置（按文件次序，先出現的）。
// 里程碑內同一計劃的欄位（例如各站負責人也用 plan:G6）在概覽已有該欄時不是開局答案，不承諾每週覆核。
export function openingFields(page) {
  const out = {};
  const walk = o => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && 'value' in o && 'label' in o && /^G(?:10|[1-9])$/.test(String(o.plan || '')) && o.kind !== 'grade' && !out[o.plan]) out[o.plan] = o;
    for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
  };
  walk(page && page.glance); walk(page && page.detail && page.detail.rules); walk(page);
  return out;
}
export const ROW_PLANS = ['G1', 'G2', 'G3', 'G5', 'G6', 'G9'];
export const RULE_PLANS = ['G7', 'G8', 'G10'];
export const CELLS = [['event', 'milestone.event'], ['actor', 'milestone.actor'], ['witness', 'milestone.witness'], ['proof', 'milestone.evidence']];
// 用預設嘅欄（3.1 表：G8 節奏、G10 業務線預設一條、G7 三格預設）
const DEFAULTS = { G7: '用預設：對外聯絡、花錢、作出承諾及刪除檔案，均須先問你', G8: '用預設：每日晚上 9 時工作一次；逢星期一了解近況', G10: '一條業務線' };
const TASKISH = /定稿|寫好|擬好|整理好|完成(?:研究|文件|草稿|簡報|計劃)/;
function fieldsOf(page) {
  const out = [];
  (function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'label' in o && 'value' in o) out.push(o); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); })(page);
  return out;
}
const listOf = x => Array.isArray(x) ? x : x && Array.isArray(x.items) ? x.items : [];
const filled = f => f && f.kind !== 'grade' && String(f.value ?? '').trim() !== '';
// 就緒清單：每個 G 欄有冇、有冇值；里程碑四格齊唔齊
export function readiness(page) {
  const fs = fieldsOf(page), by = p => fs.find(f => f.plan === p);
  const status = listOf(page && page.glance && page.glance.status && page.glance.status.items);
  const rules = listOf(page && page.detail && page.detail.rules);
  const absent = [], empty = [];
  for (const p of ROW_PLANS.concat(RULE_PLANS)) { const f = by(p) || (p === 'G7' && rules.find(r => r.boxes)); if (!f) absent.push(p); else if (!filled(f) && !(p === 'G7' && f.boxes)) empty.push(p); }
  if (!status.length) absent.push('G4');
  const cells = ((page && page.path && page.path.milestones) || []).map(m => ({ id: m.id, have: CELLS.map(([k]) => filled(m[k])) }));
  return { absent, empty, cells, missingPlans: absent.concat(empty).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) };
}
function addDays(iso, n) { const d = new Date((iso || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// 規整（新草稿核對後、舊公司概覽遷移時都做；冪等）：補缺欄（未知）、暫定值補來源同限期（最遲四星期）、四格補空欄、真事／工作建議
export function normalizePage(page, options = {}) {
  const warnings = [];
  const prepared = (page.page && page.page.preparedAt) || options.preparedAt || new Date().toISOString().slice(0, 10);
  const latest = addDays(prepared, 28), ids = new Set(fieldsOf(page).map(f => f.id));
  const uid = base => { let id = base, n = 2; while (ids.has(id)) id = base + '-' + n++; ids.add(id); return id; };
  page.glance = page.glance || {}; page.glance.rows = Array.isArray(page.glance.rows) ? page.glance.rows : [];
  page.detail = page.detail && typeof page.detail === 'object' ? page.detail : {};
  const rules = page.detail.rules = listOf(page.detail.rules);
  const r = readiness(page);
  for (const p of r.absent) {
    if (p === 'G4') continue; // 冇候選事件就冇得補，校對頁「尚未問齊」會列出
    if (p === 'G7') { const withBoxes = rules.find(x => x.boxes); if (withBoxes) { withBoxes.plan = 'G7'; continue; } }
    const f = { id: uid('g' + p.slice(1)), plan: p, label: NAMES.field[p], kind: 'text', value: DEFAULTS[p] || '', origin: DEFAULTS[p] ? 'default' : 'missing' };
    if (RULE_PLANS.includes(p)) rules.push(f); else page.glance.rows.push(f);
    warnings.push('公司概覽缺少「' + NAMES.field[p] + '」，已加入' + (DEFAULTS[p] ? '預設值' : '空欄待你補上'));
  }
  // 暫定值：AI 建議嘅 G 欄同目標日期一律暫定；每個暫定值要有來源（AI 建議／對方提出／你暫定）同限期（最遲設定日加四星期）
  for (const f of fieldsOf(page)) {
    const isG = /^G(?:[1-35-9]|10)$/.test(String(f.plan || '')) || f.plan === 'milestone.targetDate';
    if (isG && f.origin === 'ai' && filled(f) && !f.tentative) f.tentative = { by: 'ai' };
    if (!f.tentative || typeof f.tentative !== 'object') { if (f.tentative) delete f.tentative; continue; }
    const t = f.tentative;
    if (!['ai', 'actor', 'founder'].includes(t.by)) t.by = 'ai';
    if (!validDay(t.until) || t.until > latest || t.until < prepared) t.until = latest;
  }
  // 四格：缺嘅格加空欄（由你補，或者 AI 再建議）；真事／工作：AI 冇判就按事件字面推斷（寫好文件一類係工作）
  const msIds = new Set();
  for (const m of (page.path && page.path.milestones) || []) {
    msIds.add(m.id);
    for (const [k, plan] of CELLS) if (!m[k] || typeof m[k] !== 'object') m[k] = { id: uid(m.id + '-' + k), plan, label: NAMES.field[plan], kind: 'text', value: '', origin: 'missing' };
    if (!['real', 'task'].includes(m.kind)) m.kind = TASKISH.test(String(m.event && m.event.value || '')) ? 'task' : 'real';
  }
  for (const it of listOf(page.glance.status && page.glance.status.items)) if (it.milestone && !msIds.has(it.milestone)) delete it.milestone;
  page.page = { ...(page.page || {}), schema: 2 };
  return { page, warnings };
}
export function checkCompanyPage(page, options = {}) {
  const errors = [], warnings = [], ids = new Set(), fields = [];
  if (!page || typeof page !== 'object' || Array.isArray(page)) return { ok: false, errors: ['資料格式不完整'], warnings };
  if (!String(page.format || '').startsWith('startup-os.proofread/')) errors.push('資料格式不完整');
  if (!page.page || !page.page.id) errors.push('缺少頁面資料');
  if (!page.company || !page.company.name) errors.push('缺少公司名稱');
  if (!page.glance || !Array.isArray(page.glance.rows)) errors.push('缺少公司現況');
  if (!page.path || !Array.isArray(page.path.milestones) || !page.path.milestones.length) errors.push('缺少里程碑');
  // 清單區段（rules、missing、reading、assumptions）AI 有時寫成 { title, items, boxes }：改成清單，boxes 放第一項（畫面按清單畫）
  const dt = page.detail;
  if (dt && typeof dt === 'object') for (const k of ['rules', 'missing', 'reading', 'assumptions']) {
    const x = dt[k];
    if (x == null || Array.isArray(x)) continue;
    if (x && Array.isArray(x.items)) { dt[k] = x.items.map((it, i) => i === 0 && x.boxes && it && !it.boxes ? { ...it, boxes: x.boxes } : it); warnings.push('公司概覽有一區格式為物件，已改為清單'); }
    else if (x && typeof x === 'object' && (x.title || x.label || x.id)) { dt[k] = [x]; warnings.push('公司概覽有一區只有一項，已改為清單'); }
    else { delete dt[k]; warnings.push('公司概覽有一區格式無法讀取，已移除'); }
  }
  if (options.newDraft) completeReading(page);
  function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && 'label' in o && 'value' in o) {
      fields.push(o);
      if (ids.has(o.id)) errors.push('項目編號重複'); else ids.add(o.id);
      if (!o.kind) o.kind = Array.isArray(o.options) ? 'choice' : 'text';
      if (!['choice','grade','date','text','multi'].includes(o.kind)) errors.push('項目類型不正確');
      if (!['doc','ai','default','missing'].includes(o.origin)) errors.push('項目來源不正確');
      if (o.origin === 'doc' && (!Array.isArray(o.src) || !o.src.length)) { o.origin = 'ai'; warnings.push('有一項資料未註明出處，已改為 Zero 建議'); }
    }
    Object.values(o).forEach(walk);
  }
  walk(page);
  const st = page.glance && page.glance.status;
  if (st && typeof st.prepared === 'string' && /^[\d\s./-]*$/.test(st.prepared)) { delete st.prepared; warnings.push('狀態卡「已準備好」一行只有日期，已移除'); }
  const decide = Array.isArray(page.decide) ? page.decide : page.decide?.items;
  if (!Array.isArray(decide) || decide.some(id => id !== '@status' && !ids.has(id))) {
    const defaults = ['@status', fields.find(x => x.plan === 'G5')?.id, fields.find(x => x.plan === 'G1')?.id].filter(Boolean);
    if (Array.isArray(page.decide)) page.decide = defaults; else page.decide = { ...(page.decide || {}), items: defaults };
  }
  if (page.page && options.id) Object.assign(page.page, { id: options.id, kind: 'intake', revision: options.revision || 1, preparedAt: options.preparedAt || new Date().toISOString().slice(0, 10) });
  // 就緒清單同四格（3.1、3.3）：新草稿要求 AI 補齊（ready: true 時當錯誤，叫 AI 修正一次）；修正後仍缺就加空欄，等你喺校對頁補
  if (!errors.length && options.ready) {
    const r = readiness(page);
    for (const p of r.absent) errors.push('缺少「' + (p === 'G4' ? '目前去到哪裏' : NAMES.field[p]) + '」一欄（照格式說明「一定要齊」一節補上；文件沒有寫就寫 Zero 建議值並標為暫定）');
    errors.push(...dateOrderIssues(page));
    const ms = (page.path && page.path.milestones) || [];
    for (const c of r.cells) { const miss = CELLS.filter((x, i) => !c.have[i]).map(x => NAMES.field[x[1]]); const m = ms.find(x => x.id === c.id); if (miss.length) errors.push('「' + ((m && m.short) || '一個里程碑') + '」缺少：' + miss.join('、') + '（文件沒有寫就寫 Zero 建議值）'); }
  }
  if (!errors.length) warnings.push(...normalizePage(page, options).warnings);
  return { ok: !errors.length, errors, warnings, page };
}
export default checkCompanyPage;
