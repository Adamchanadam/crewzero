// 延伸功能宣告、資料行、摘要及草稿的純函數；除位置函數外不讀寫檔案。
import { isRealInstance } from './minutes-lib.mjs';

export const EXTENSIONS_FOLDER = '延伸功能';
export const TYPES = Object.freeze(['text', 'number', 'money', 'date', 'bool', 'choice', 'stage', 'actor']);
export const DRAFT_OWNER = Object.freeze({
  server: Object.freeze({ fields: ['state', 'ask', 'edits', 'revise', 'folder', 'sourceHash'], moves: [['ready', 'enabled'], ['ready', 'cancelled'], ['ready', 'drafting'], ['failed', 'drafting'], ['failed', 'cancelled'], ['drafting', 'cancelled']] }),
  shell: Object.freeze({ fields: ['state', 'base', 'baseRev', 'sample', 'error'], moves: [['drafting', 'ready'], ['drafting', 'failed']] })
});
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const chars = value => Array.from(String(value ?? '')).length;
const control = value => /[\x00-\x1f\x7f-\x9f]/.test(String(value ?? ''));
const labelOK = value => typeof value === 'string' && !!value.trim() && chars(value) <= 20 && !control(value);
const textOK = (value, max) => typeof value === 'string' && chars(value) <= max && !control(value);
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [y, m, d] = String(value).split('-').map(Number), date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};
const dateValue = value => validDate(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
const arrays = value => Array.isArray(value) ? value : [];
const tableFields = table => arrays(table?.fields);
const stageField = table => tableFields(table).find(field => field?.type === 'stage');
const fieldOf = (table, id) => tableFields(table).find(field => field?.id === id);
const allowed = (object, keys, at, errors) => {
  if (!plain(object)) { errors.push(`${at}必須是物件`); return false; }
  for (const key of Object.keys(object)) if (!keys.includes(key)) errors.push(`${at}含有不認識的鍵「${key}」`);
  return true;
};
const idOK = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}\\d+$`).test(value);

// 取得延伸功能資料夾位置；真實實例放在項目資料夾，其他實例放在資料夾內。
export function extensionsDir(ROOT, DIR) {
  const parent = pathParent(ROOT);
  if (!isRealInstance(ROOT, DIR) || parent === pathRoot(parent)) return joinPath(DIR.data, EXTENSIONS_FOLDER);
  return joinPath(parent, EXTENSIONS_FOLDER);
}
// 為位置函數保留 Node path 的單一封裝，避免其他純函數碰檔案。
function pathParent(value) { const path = globalThis.__crewzeroPath; return path ? path.dirname(path.resolve(value)) : nodePath.dirname(nodePath.resolve(value)); }
function pathRoot(value) { const path = globalThis.__crewzeroPath; return path ? path.parse(value).root : nodePath.parse(value).root; }
function joinPath(...parts) { const path = globalThis.__crewzeroPath; return path ? path.join(...parts) : nodePath.join(...parts); }
import nodePath from 'node:path';

// 回傳頁面顯示的位置，不洩露絕對路徑。
export function extensionsShown(ROOT, DIR, folder) {
  const inProject = extensionsDir(ROOT, DIR) !== joinPath(DIR.data, EXTENSIONS_FOLDER);
  return `${inProject ? '項目資料夾' : '資料夾'}／${EXTENSIONS_FOLDER}／${String(folder || '')}`;
}

// 產生安全、可重複避名的延伸功能資料夾名稱。
export function folderNameFor(name, taken = () => false) {
  const exists = typeof taken === 'function' ? taken : value => taken instanceof Set ? taken.has(value) : arrays(taken).includes(value);
  const raw = String(name ?? '').replace(/[^\p{L}\p{N} -]/gu, '').replace(/\s+/g, ' ').trim() || EXTENSIONS_FOLDER;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `（${n}）`, base = raw.slice(0, Math.max(0, 30 - chars(suffix))).trimEnd();
    const candidate = base + suffix;
    if (!exists(candidate)) return candidate;
  }
}

// 核對延伸功能宣告的格式、上限、代號及欄位關係。
export function validate(decl, options = {}) {
  const errors = [], ids = new Set(), retired = [], safeOptions = plain(options) ? options : {};
  const addId = (id, prefix, where) => { if (!idOK(id, prefix)) errors.push(`${where}代號「${id || ''}」格式不正確，應為 ${prefix}<數字>`); else if (ids.has(id)) errors.push(`${where}代號「${id}」與整份宣告重複`); else ids.add(id); };
  if (!allowed(decl, ['format', 'guide', 'name', 'about', 'tables', 'page'], '宣告', errors)) return { ok: false, errors };
  if (decl.format !== 'crewzero.extension/1') errors.push('宣告的 format 必須是「crewzero.extension/1」');
  if (!Number.isInteger(decl.guide) || decl.guide <= 0) errors.push('宣告的 guide 必須是正整數');
  if (!labelOK(decl.name)) errors.push('宣告的 name 不可空白、不可含控制字元且最多 20 字');
  if (!textOK(decl.about, 80)) errors.push('宣告的 about 必須是最多 80 字且不含控制字元的文字');
  if (!Array.isArray(decl.tables) || !decl.tables.length || decl.tables.length > 3) errors.push('宣告的資料表必須為 1 至 3 個');
  for (const table of arrays(decl.tables)) {
    const where = `資料表「${table?.label || table?.id || '未命名'}」`;
    if (!allowed(table, ['id', 'label', 'title', 'due', 'fields', 'summary', 'handoff', 'retired'], where, errors)) continue;
    addId(table.id, 't', where);
    if (!labelOK(table.label)) errors.push(`${where}的 label 不可空白、不可含控制字元且最多 20 字`);
    if (!Array.isArray(table.fields) || !table.fields.length || table.fields.length > 20) errors.push(`${where}的 fields 必須為 1 至 20 個`);
    let stages = 0;
    for (const field of arrays(table.fields)) {
      const at = `${where}的欄位「${field?.label || field?.id || '未命名'}」`;
      if (!allowed(field, ['id', 'label', 'type', 'required', 'hidden', 'stages', 'options', 'currency'], at, errors)) continue;
      addId(field.id, 'f', at);
      if (!labelOK(field.label)) errors.push(`${at}的 label 不可空白、不可含控制字元且最多 20 字`);
      if (!TYPES.includes(field.type)) errors.push(`${at}：種類「${field.type}」不認識，可用的種類是 ${TYPES.join('、')}`);
      if (own(field, 'required') && typeof field.required !== 'boolean') errors.push(`${at}的 required 必須是布林值`);
      if (own(field, 'hidden') && typeof field.hidden !== 'boolean') errors.push(`${at}的 hidden 必須是布林值`);
      if (field.type === 'money' && own(field, 'currency') && !/^[A-Z]{3}$/.test(String(field.currency || ''))) errors.push(`${at}的 currency 必須是三個大寫英文字母`);
      if (field.type === 'stage') {
        stages++;
        if (!Array.isArray(field.stages) || field.stages.length < 2 || field.stages.length > 8) errors.push(`${at}的工序必須為 2 至 8 個`);
        for (const stage of arrays(field.stages)) {
          const sw = `${at}的工序「${stage?.label || stage?.id || '未命名'}」`;
          if (!allowed(stage, ['id', 'label'], sw, errors)) continue;
          addId(stage.id, 's', sw);
          if (!labelOK(stage.label)) errors.push(`${sw}的 label 不可空白、不可含控制字元且最多 20 字`);
        }
        if (field.hidden) errors.push(`${at}是工序欄位，不可隱藏`);
      }
      if (field.type === 'choice') {
        if (!Array.isArray(field.options) || !field.options.length || field.options.length > 20) errors.push(`${at}的選項必須為 1 至 20 個`);
        for (const option of arrays(field.options)) {
          const ow = `${at}的選項「${option?.label || option?.id || '未命名'}」`;
          if (!allowed(option, ['id', 'label'], ow, errors)) continue;
          addId(option.id, 'o', ow);
          if (!labelOK(option.label)) errors.push(`${ow}的 label 不可空白、不可含控制字元且最多 20 字`);
        }
      }
      if (field.required === true && field.hidden === true) errors.push(`${at}是必填欄位，不可隱藏`);
    }
    if (stages > 1) errors.push(`${where}最多只可有 1 個工序欄位`);
    const title = fieldOf(table, table.title);
    if (!title || title.type !== 'text') errors.push(`${where}的 title 必須指向同一資料表的文字欄位`);
    else if (title.hidden) errors.push(`${where}的 title 欄位不可隱藏`);
    if (own(table, 'due') && table.due !== '' && (!fieldOf(table, table.due) || fieldOf(table, table.due).type !== 'date')) errors.push(`${where}的 due 必須指向同一資料表的日期欄位`);
    if (!Array.isArray(table.summary) && own(table, 'summary')) errors.push(`${where}的 summary 必須是陣列`);
    if (arrays(table.summary).length > 4) errors.push(`${where}最多只可有 4 個摘要`);
    for (const item of arrays(table.summary)) {
      const at = `${where}的摘要「${item?.label || item?.rule || '未命名'}」`; allowed(item, ['label', 'rule', 'days', 'field'], at, errors);
      if (!labelOK(item?.label)) errors.push(`${at}的 label 不可空白、不可含控制字元且最多 20 字`);
      if (!['open', 'overdue', 'dueWithin', 'sum'].includes(item?.rule)) errors.push(`${at}的 rule 不認識，可用的值是 open、overdue、dueWithin、sum`);
      if (['overdue', 'dueWithin'].includes(item?.rule) && (!table.due || !fieldOf(table, table.due))) errors.push(`${at}需要資料表的 due 日期欄位`);
      if (item?.rule === 'dueWithin' && (!Number.isInteger(item.days) || item.days < 1 || item.days > 90)) errors.push(`${at}的 days 必須是 1 至 90 的整數`);
      if (item?.rule === 'sum' && !['number', 'money'].includes(fieldOf(table, item.field)?.type)) errors.push(`${at}的 field 必須指向同一資料表的數字或金額欄位`);
    }
    if (!Array.isArray(table.handoff) && own(table, 'handoff')) errors.push(`${where}的 handoff 必須是陣列`);
    if (arrays(table.handoff).length > 8) errors.push(`${where}最多只可有 8 條 handoff`);
    const stageIds = new Set(arrays(stageField(table)?.stages).map(stage => stage?.id).filter(id => typeof id === 'string'));
    for (const item of arrays(table.handoff)) {
      const at = `${where}的 handoff`; allowed(item, ['stage', 'text'], at, errors);
      if (!stageIds.has(item?.stage)) errors.push(`${at}的工序「${item?.stage || ''}」不存在`);
      if (!textOK(item?.text, 200)) errors.push(`${at}的 text 必須是最多 200 字且不含控制字元的文字`);
      for (const fieldId of String(item?.text || '').matchAll(/\{(f\d+)\}/g)) if (!fieldOf(table, fieldId[1])) errors.push(`${at}引用了不存在的欄位「${fieldId[1]}」`);
    }
    if (own(table, 'retired')) {
      if (!Array.isArray(table.retired)) errors.push(`${where}的 retired 必須是陣列`);
      for (const id of arrays(table.retired)) retired.push({ id, where });
    }
  }
  const retiredIds = new Set();
  for (const item of retired) {
    if (!idOK(item.id, 's')) { errors.push(`${item.where}的 retired 工序代號「${item.id}」格式不正確`); continue; }
    if (ids.has(item.id)) errors.push(`${item.where}的 retired 不可含任何現役代號「${item.id}」`);
    if (retiredIds.has(item.id)) errors.push(`${item.where}的 retired 代號「${item.id}」不可重複`);
    retiredIds.add(item.id);
  }
  if (own(decl, 'page')) {
    const page = decl.page; allowed(page, ['label', 'port'], 'page', errors);
    if (!labelOK(page?.label)) errors.push('page 的 label 不可空白、不可含控制字元且最多 20 字');
    if (!Number.isInteger(page?.port) || page.port < 1024 || page.port > 65535) errors.push('page 的 port 必須是 1024 至 65535 的整數');
    if (page?.port === safeOptions.crewPort) errors.push('page 的 port 不可等於 CrewZero 的 port');
    if (safeOptions.fromZero) errors.push('Zero 起草的宣告不可有 page');
  }
  return { ok: errors.length === 0, errors };
}

// 先核對大小及 JSON，再核對延伸功能宣告。
export function validateText(text, options = {}) {
  if (Buffer.byteLength(String(text ?? ''), 'utf8') > 100 * 1024) return { ok: false, errors: ['extension.json 超過 100 KB'] };
  try { return validate(JSON.parse(String(text ?? '')), options); }
  catch { return { ok: false, errors: ['extension.json 不是有效的 JSON'] }; }
}

// 核對修改版沒有刪除或重用資料代號，並只刪除沒有卡的工序。
export function checkRevision(oldDecl, newDecl, options = {}) {
  const cardCounts = plain(options) ? options.cardCounts : {};
  const oldChecked = validate(oldDecl), newChecked = validate(newDecl);
  const errors = [...newChecked.errors];
  if (!oldChecked.ok) return { ok: false, errors: [...errors, '原有宣告格式不正確，不能核對修訂'] };
  if (!newChecked.ok) return { ok: false, errors };
  const counts = plain(cardCounts) ? cardCounts : {};
  const oldTables = new Map(arrays(oldDecl?.tables).map(table => [table.id, table]));
  const newTables = new Map(arrays(newDecl?.tables).map(table => [table.id, table]));
  const oldRetired = new Set([...oldTables.values()].flatMap(table => arrays(table.retired)));
  for (const [id, table] of oldTables) {
    const replacement = newTables.get(id); if (!replacement) { errors.push(`原有資料表「${id}」不可刪除`); continue; }
    const nextRetired = new Set(arrays(replacement.retired));
    for (const retired of arrays(table.retired)) if (!nextRetired.has(retired)) errors.push(`已退役工序「${retired}」必須保留在原有資料表`);
    const newFields = new Map(tableFields(replacement).map(field => [field.id, field]));
    for (const field of tableFields(table)) {
      const next = newFields.get(field.id); if (!next) { errors.push(`原有欄位「${field.id}」不可刪除`); continue; }
      if (next.type !== field.type) errors.push(`欄位「${field.id}」不可更改種類`);
      const nextOptions = new Set(arrays(next.options).map(option => option.id));
      for (const option of arrays(field.options)) if (!nextOptions.has(option.id)) errors.push(`原有選項「${option.id}」不可刪除`);
      const nextStages = new Set(arrays(next.stages).map(stage => stage.id)), retired = new Set(arrays(replacement.retired));
      for (const stage of arrays(field.stages)) if (!nextStages.has(stage.id)) {
        if (!retired.has(stage.id)) errors.push(`刪除工序「${stage.id}」時必須加入 retired`);
        if (Number(counts[stage.id] || 0) !== 0) errors.push(`工序「${stage.id}」仍有 ${counts[stage.id]} 張卡，不可刪除`);
      }
    }
  }
  const newActive = new Set();
  for (const table of arrays(newDecl?.tables)) {
    newActive.add(table.id);
    for (const field of tableFields(table)) {
      newActive.add(field.id);
      for (const stage of arrays(field.stages)) newActive.add(stage.id);
      for (const option of arrays(field.options)) newActive.add(option.id);
    }
  }
  for (const id of newActive) if (oldRetired.has(id)) errors.push(`新代號不可重用已退役代號「${id}」`);
  return { ok: errors.length === 0, errors };
}

// 統計各工序的卡數，包括已封存的卡。
export function stageCardCounts(decl, rowsByTable = {}) {
  const counts = {};
  for (const table of arrays(decl?.tables)) { const field = stageField(table); if (!field) continue; for (const row of arrays(rowsByTable[table.id])) { const id = row?.v?.[field.id]; if (typeof id === 'string') counts[id] = (counts[id] || 0) + 1; } }
  return counts;
}

function validValue(field, value) {
  if (field.type === 'text') return typeof value === 'string' && chars(value) <= 2000;
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (field.type === 'money') return plain(value) && Number.isSafeInteger(value.amountCents) && /^[A-Z]{3}$/.test(String(value.currency || ''));
  if (field.type === 'date') return validDate(value);
  if (field.type === 'bool') return typeof value === 'boolean';
  if (field.type === 'choice') return arrays(field.options).some(option => option.id === value);
  if (field.type === 'stage') return arrays(field.stages).some(stage => stage.id === value);
  if (field.type === 'actor') return plain(value) && /^pc-.+/.test(String(value.id || '')) && typeof value.name === 'string' && chars(value.name) <= 80;
  return false;
}

// 核對一行資料的欄位代號、種類及新增時的必填欄。
export function validateRow(table, v, { requireAll = false } = {}) {
  const errors = [];
  if (!plain(v)) return { ok: false, errors: ['資料列值必須是物件'], v };
  for (const [id, value] of Object.entries(v)) { const field = fieldOf(table, id); if (!field) errors.push(`欄位「${id}」不存在`); else if (!validValue(field, value)) errors.push(`欄位「${field.label || id}」的值不符合 ${field.type} 種類`); }
  if (requireAll) for (const field of tableFields(table)) if (field.required && (!own(v, field.id) || v[field.id] === '' || v[field.id] === null || v[field.id] === undefined)) errors.push(`必填欄位「${field.label || field.id}」不可留空`);
  return { ok: errors.length === 0, errors, v };
}

// 容錯讀取資料表，讓個別壞值仍可顯示並標記。
export function readRows(json, table) {
  if (!plain(json) || !Array.isArray(json.rows)) return { rows: [], problems: [], bad: '資料檔必須是含 rows 陣列的物件' };
  const rows = [], problems = [], stage = stageField(table), stageIds = new Set(arrays(stage?.stages).map(item => item?.id).filter(id => typeof id === 'string'));
  for (const rawRow of json.rows) {
    if (!plain(rawRow) || !plain(rawRow.v)) { problems.push('資料列格式不符'); continue; }
    const row = { ...rawRow, v: { ...rawRow.v } };
    for (const [id, value] of Object.entries(rawRow.v)) {
      const field = fieldOf(table, id);
      if (!field || (field.type === 'stage' && !stageIds.has(value)) || !validValue(field, value)) { row.v[id] = { raw: value, invalid: true }; problems.push(`資料列「${rawRow.id || ''}」的欄位「${id}」格式不符`); }
    }
    if (stage) { const value = rawRow.v[stage.id]; row.stage = stageIds.has(value) ? value : 'unsorted'; row.stageId = row.stage; row.column = row.stage; }
    rows.push(row);
  }
  return { rows, problems, bad: '' };
}

// 判斷一張卡是否已在最後工序。
export function isLastStage(table, row) {
  const field = stageField(table), stages = arrays(field?.stages);
  return !!field && stages.length > 0 && row?.v?.[field.id] === stages.at(-1)?.id;
}

// 取得一張卡可前進到的下一個工序代號。
export function nextStage(table, row) {
  const field = stageField(table), stages = arrays(field?.stages), index = stages.findIndex(stage => stage.id === row?.v?.[field?.id]);
  return index >= 0 && index < stages.length - 1 ? stages[index + 1].id : '';
}

// 判斷到期狀態：過期、七日內或空白；完成及封存一律不著色。
export function dueState(table, row, today) {
  if (row?.archived || isLastStage(table, row)) return '';
  const due = row?.v?.[table?.due]; if (!validDate(due) || !validDate(today)) return '';
  const days = Math.round((dateValue(due) - dateValue(today)) / 86400000);
  return days < 0 ? 'overdue' : days <= 7 ? 'soon' : '';
}

function moneyText(value) {
  const cents = Number(value?.amountCents || 0), sign = cents < 0 ? '-' : '', abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US'), decimal = abs % 100, number = whole + (decimal ? `.${String(decimal).padStart(2, '0')}` : '');
  const prefix = { HKD: 'HK$', USD: 'US$', TWD: 'NT$', CNY: 'RMB ' }[value?.currency] || `${value?.currency || '---'} `;
  return sign + prefix + number;
}

// 計算每個資料表宣告的摘要數字。
export function summaryOf(decl, rowsByTable = {}, today) {
  const result = {};
  const rowMap = plain(rowsByTable) ? rowsByTable : {};
  for (const table of arrays(decl?.tables)) {
    if (!plain(table)) continue;
    const rows = arrays(rowMap[table.id]);
    result[table.id] = arrays(table.summary).map(item => {
      let value = 0, currency;
      const rule = item?.rule, label = typeof item?.label === 'string' ? item.label : '';
      if (rule === 'open') value = rows.filter(row => !row?.archived && !isLastStage(table, row)).length;
      if (rule === 'overdue') value = rows.filter(row => dueState(table, row, today) === 'overdue').length;
      if (rule === 'dueWithin') value = rows.filter(row => {
        if (row?.archived || isLastStage(table, row)) return false; const due = row?.v?.[table.due]; const days = (dateValue(due) - dateValue(today)) / 86400000; return validDate(due) && validDate(today) && days >= 0 && days <= item.days;
      }).length;
      if (rule === 'sum') {
        const field = fieldOf(table, item.field), values = rows.filter(row => !row?.archived).map(row => row?.v?.[item.field]).filter(value => plain(value) && Number.isSafeInteger(value.amountCents));
        if (field?.type === 'number') value = rows.filter(row => !row?.archived).map(row => row?.v?.[item.field]).filter(Number.isFinite).reduce((sum, entry) => sum + entry, 0);
        if (field?.type === 'money') {
          currency = field.currency || values[0]?.currency || '';
          value = values.filter(entry => entry.currency === currency).reduce((sum, entry) => sum + entry.amountCents, 0);
        }
      }
      return currency ? { label, rule, value, currency } : { label, rule, value };
    });
  }
  return result;
}

// 依某工序的句式合成「交給 Zero」的文字。
export function handoffText(table, row, stageId) {
  const handoff = arrays(table?.handoff).find(item => item.stage === stageId); if (!handoff) return '';
  return String(handoff.text || '').replace(/\{(f\d+)\}/g, (_, id) => {
    const field = fieldOf(table, id), value = row?.v?.[id]; if (value === undefined || value === null) return '';
    if (field?.type === 'actor') return String(value?.name || '');
    if (field?.type === 'stage') return String(arrays(field.stages).find(stage => stage.id === value)?.label || '');
    if (field?.type === 'money') return moneyText(value);
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
  });
}

function newId(prefix, d = new Date()) { const p = n => String(n).padStart(2, '0'); return `${prefix}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`; }
// 產生延伸功能草稿編號。
export const newDraftId = d => newId('x', d);
// 產生延伸功能資料行編號。
export const newRowId = d => newId('r', d);

// 將頁面校對內容安全地套用到宣告；無效校對一律退回原宣告。
export function applyEdits(base, baseRev, edits) {
  if (!plain(base) || !plain(edits) || edits.forRev !== baseRev) return base;
  if (!validate(base).ok) return base;
  const next = clone(base), validName = value => labelOK(value);
  const labels = plain(edits.labels) ? edits.labels : {};
  for (const table of arrays(next.tables)) {
    if (validName(labels[table.id])) table.label = labels[table.id];
    for (const field of tableFields(table)) {
      if (validName(labels[field.id])) field.label = labels[field.id];
      for (const stage of arrays(field.stages)) if (validName(labels[stage.id])) stage.label = labels[stage.id];
      for (const option of arrays(field.options)) if (validName(labels[option.id])) option.label = labels[option.id];
    }
    const order = arrays(edits.fieldOrder), byId = new Map(tableFields(table).map(field => [field.id, field]));
    if (order.length) table.fields = [...order.filter(id => byId.has(id)).map(id => byId.get(id)), ...tableFields(table).filter(field => !order.includes(field.id))];
    const field = stageField(table), stageOrder = arrays(edits.stageOrder);
    if (field && stageOrder.length) { const byStage = new Map(arrays(field.stages).map(stage => [stage.id, stage])); field.stages = [...stageOrder.filter(id => byStage.has(id)).map(id => byStage.get(id)), ...arrays(field.stages).filter(stage => !stageOrder.includes(stage.id))]; }
    if (own(edits, 'hidden') && Array.isArray(edits.hidden)) for (const field of tableFields(table)) field.hidden = edits.hidden.includes(field.id) && !field.required && field.type !== 'stage' && field.id !== table.title;
  }
  return validate(next).ok ? next : base;
}

// 按伺服器或外殼的欄位擁有權合併草稿修補；越權或越級轉換整個拒絕。
export function mergeDraft(current, patch, who) {
  const owner = DRAFT_OWNER[who];
  if (!owner) return { ok: false, draft: current, error: '未知的寫入方' };
  if (!plain(current) || !plain(patch)) return { ok: false, draft: current, error: '草稿或修補格式不正確' };
  const forbidden = Object.keys(patch).filter(key => !owner.fields.includes(key) && key !== 'updatedAt');
  if (forbidden.length) return { ok: false, draft: current, error: `${who} 不可改 ${forbidden.join('、')}` };
  if (own(patch, 'state') && patch.state !== current.state && !owner.moves.some(([from, to]) => from === current.state && to === patch.state)) return { ok: false, draft: current, error: `${who} 不可把草稿狀態由 ${current.state} 轉為 ${patch.state}` };
  return { ok: true, draft: { ...current, ...clone(patch), id: current.id }, error: '' };
}
