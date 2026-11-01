// 公司概覽核對同可修正嘅欄位。
import { createRequire } from 'node:module';
const NAMES = createRequire(import.meta.url)('./names.js');

/* ---------- 規劃書 3.1 就緒清單同 3.3 里程碑四格（唯一定義處；外殼、校對頁統計、測試共用） ----------
   G1–G10 全部有值先可以排里程碑：「有值」包括暫定值同用預設。G4＝「目前去到哪裏」各項；G7、G8、G10 喺規則區。
   每個里程碑要填齊四格：事件、決策者（外部角色）、見證人、證明。 */
export const ROW_PLANS = ['G1', 'G2', 'G3', 'G5', 'G6', 'G9'];
export const RULE_PLANS = ['G7', 'G8', 'G10'];
export const CELLS = [['event', 'milestone.event'], ['actor', 'milestone.actor'], ['witness', 'milestone.witness'], ['proof', 'milestone.evidence']];
// 用預設嘅欄（3.1 表：G8 節奏、G10 業務線預設一條、G7 三格預設）
const DEFAULTS = { G7: '用預設：對外聯絡、花錢、作出承諾及刪除檔案，均須先問你', G8: '用預設：每日晚上 9 時工作一次；逢星期一了解近況；每次最多 30 分鐘', G10: '一條業務線' };
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.until || '')) || t.until > latest || t.until < prepared) t.until = latest;
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
  function walk(o) {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (typeof o.id === 'string' && 'label' in o && 'value' in o) {
      fields.push(o);
      if (ids.has(o.id)) errors.push('項目編號重複'); else ids.add(o.id);
      if (!o.kind) o.kind = Array.isArray(o.options) ? 'choice' : 'text';
      if (!['choice','grade','date','text','multi'].includes(o.kind)) errors.push('項目類型不正確');
      if (!['doc','ai','default','missing'].includes(o.origin)) errors.push('項目來源不正確');
      if (o.origin === 'doc' && (!Array.isArray(o.src) || !o.src.length)) { o.origin = 'ai'; warnings.push('有一項資料未註明出處，已改為 AI 建議'); }
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
    for (const p of r.absent) errors.push('缺少「' + (p === 'G4' ? '目前去到哪裏' : NAMES.field[p]) + '」一欄（照格式說明「一定要齊」一節補上；文件沒有寫就寫 AI 建議值並標為暫定）');
    const ms = (page.path && page.path.milestones) || [];
    for (const c of r.cells) { const miss = CELLS.filter((x, i) => !c.have[i]).map(x => NAMES.field[x[1]]); const m = ms.find(x => x.id === c.id); if (miss.length) errors.push('「' + ((m && m.short) || '一個里程碑') + '」缺少：' + miss.join('、') + '（文件沒有寫就寫 AI 建議值）'); }
  }
  if (!errors.length) warnings.push(...normalizePage(page, options).warnings);
  return { ok: !errors.length, errors, warnings, page };
}
export default checkCompanyPage;
