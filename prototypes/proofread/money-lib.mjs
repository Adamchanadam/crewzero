// 業績資料的純計算、合併及匯入重複判斷；不讀寫檔案。
import crypto from 'node:crypto';

export const MAX_CENTS = 100000000000;
export const CATEGORIES = Object.freeze({
  in: Object.freeze(['sales', 'service', 'deposit', 'grant', 'funding', 'otherIn']),
  out: Object.freeze(['goods', 'people', 'rent', 'marketing', 'tools', 'shipping', 'professional', 'otherOut'])
});
const UNATTRIBUTED = '未註明對方';
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
const dateNumber = value => validDate(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
const validTimestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
const asArray = value => Array.isArray(value) ? value : [];
const clone = value => JSON.parse(JSON.stringify(value));

// 將常見金額文字轉成整數分；格式不符、零、負數或超過上限時回傳 null。
export function toCents(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 && value <= MAX_CENTS ? value : null;
  let text = String(value ?? '').trim().replace(/^(?:HK\$|US\$|NT\$|RMB\s*|[A-Z]{3}\s*)/i, '').replace(/,/g, '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, decimal = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number((decimal + '00').slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null;
}

// 核對創辦人確認的現金結餘；金額可以是零，但不可為負數。
export function validateBalance(balance) {
  const errors = [];
  if (!plain(balance)) return { ok: false, errors: ['現金結餘不是物件'] };
  if (!Number.isSafeInteger(balance.amountCents) || balance.amountCents < 0 || balance.amountCents > MAX_CENTS) errors.push('現金結餘金額必須是上限內的非負整數分');
  if (typeof balance.currency !== 'string' || !/^[A-Z]{3}$/.test(balance.currency)) errors.push('現金結餘貨幣必須是三個大寫英文字母');
  if (!validDate(balance.asOf)) errors.push('現金結餘截至日期必須是有效的 YYYY-MM-DD');
  if (!validTimestamp(balance.confirmedAt)) errors.push('現金結餘確認時間格式不正確');
  if (balance.by !== 'founder') errors.push('現金結餘確認人必須是 founder');
  return { ok: errors.length === 0, errors };
}

// 產生名稱的穩定比對鍵：NFKC、去空白及常見標點，英文字母轉小寫。
export function payerKeyOf(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[\s\u3000\p{P}\p{S}]/gu, '');
}

// 產生手動或收據業績紀錄的編號；同一處理內時鐘相同或倒退時，仍以毫秒遞增避免兩筆收據撞號。
let lastMoneyIdAt = -1;
export function newMoneyId(d = new Date()) {
  const source = d instanceof Date && Number.isFinite(d.getTime()) ? d : new Date();
  const at = Math.max(source.getTime(), lastMoneyIdAt + 1); lastMoneyIdAt = at;
  d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `mn-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// 依匯入批次及原始行號產生可重現的紀錄編號。
export function recordIdForImport(batchId, line) {
  const stamp = String(batchId || '').replace(/^mb-/, '');
  const fee = /^fee:(\d+)$/.exec(String(line || ''));
  if (fee) return `mn-${stamp}-F${fee[1]}`;
  return `mn-${stamp}-L${Number(line)}`;
}

// 判斷紀錄是否已有收據、手動附件或匯入原檔證據。
export function hasEvidence(record) {
  if (String(record?.importBatch || '')) return true;
  return asArray(record?.evidence).some(item => plain(item) &&
    ((typeof item.inputId === 'string' && !!item.inputId && typeof item.file === 'string' && !!item.file) ||
      (item.store === 'money' && typeof item.file === 'string' && !!item.file)));
}

// 核對一筆業績紀錄是否符合共用接口。
export function validateRecord(record) {
  const errors = [];
  if (!plain(record)) return { ok: false, errors: ['紀錄不是物件'] };
  const textFields = [
    ['id', '紀錄編號'], ['dir', '方向'], ['currency', '貨幣'], ['date', '日期'], ['counterpartId', '對方編號'],
    ['payer', '對方名稱'], ['payerKey', '對方比對鍵'], ['category', '類別'], ['what', '說明'], ['source', '來源'],
    ['importBatch', '匯入批次'], ['importKey', '匯入鍵'], ['confirmedAt', '確認時間'], ['confirmedBy', '確認人'],
    ['status', '狀態'], ['voidedAt', '作廢時間'], ['voidReason', '作廢原因'], ['replaces', '取代紀錄']
  ];
  for (const [key, label] of textFields) if (typeof record[key] !== 'string') errors.push(`${label}必須是文字`);
  if (typeof record.id === 'string' && !/^mn-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}(?:-[LF]\d+)?$/.test(record.id)) errors.push('紀錄編號格式不正確');
  if (typeof record.dir === 'string' && !['in', 'out'].includes(record.dir)) errors.push('方向必須是 in 或 out');
  if (!Number.isSafeInteger(record.amountCents) || record.amountCents <= 0 || record.amountCents > MAX_CENTS) errors.push('金額必須是上限內的大於零整數分');
  if (typeof record.currency === 'string' && !/^[A-Z]{3}$/.test(record.currency)) errors.push('貨幣必須是三個大寫英文字母');
  if (!validDate(record.date)) errors.push('日期必須是有效的 YYYY-MM-DD');
  const categories = typeof record.dir === 'string' ? (CATEGORIES[record.dir] || []) : [];
  if (typeof record.category === 'string' && !categories.includes(record.category)) errors.push('類別不屬於此方向可用的類別');
  if (typeof record.what !== 'string' || Array.from(record.what).length > 120) errors.push('說明最多 120 字');
  if (typeof record.payer !== 'string' || Array.from(record.payer).length > 80) errors.push('對方名稱最多 80 字');
  if (typeof record.voidReason !== 'string' || Array.from(record.voidReason).length > 200) errors.push('作廢原因最多 200 字');
  if (typeof record.status === 'string' && !['confirmed', 'void'].includes(record.status)) errors.push('狀態必須是 confirmed 或 void');
  if (typeof record.source === 'string' && !['receipt', 'quick', 'import'].includes(record.source)) errors.push('來源必須是 receipt、quick 或 import');
  if (typeof record.refund !== 'boolean') errors.push('退款標記必須是布林值');
  if (!Array.isArray(record.evidence)) errors.push('證據必須是陣列');
  return { ok: errors.length === 0, errors };
}

// 由匯入批次的已選行建立正式紀錄。
export function recordsFromBatch(batch) {
  if (!plain(batch) || !['confirmed', 'undone'].includes(batch.state) || !Array.isArray(batch.rows)) return [];
  return batch.rows.filter(row => plain(row) && row.include === true && ['ok', 'dup'].includes(row.status) && plain(row.draft)).map(row => {
    const draft = row.draft;
    const dir = draft.dir;
    return {
      id: recordIdForImport(batch.id, row.line), dir, amountCents: draft.amountCents,
      currency: draft.currency, date: draft.date, counterpartId: '', payer: String(draft.payer || ''),
      payerKey: payerKeyOf(draft.payer), category: draft.category || (dir === 'in' ? 'sales' : 'otherOut'),
      what: String(draft.what || ''), refund: !!draft.refund, evidence: [], source: 'import',
      importBatch: String(batch.id || ''), importKey: String(row.importKey || ''),
      confirmedAt: String(batch.confirmedAt || ''), confirmedBy: 'founder', status: 'confirmed',
      voidedAt: '', voidReason: '', replaces: ''
    };
  });
}

// 取得合併後紀錄的主要貨幣，已存的選擇永遠優先。
export function mainCurrencyOf(saved, records = []) {
  if (/^[A-Z]{3}$/.test(String(saved || ''))) return saved;
  const candidate = asArray(records).filter(record => plain(record) && /^[A-Z]{3}$/.test(String(record.currency || '')))
    .sort((a, b) => {
      const left = Date.parse(a.confirmedAt), right = Date.parse(b.confirmedAt);
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })[0];
  return candidate ? candidate.currency : '';
}

// 合併帳本、待合併紀錄、匯入批次及創辦人操作，並保持同一操作重播後不變。
export function mergeMoney({ base = {}, pending = [], batches = [], ops = [] } = {}) {
  const source = plain(base) ? base : {};
  const byId = new Map(), rejected = [];
  const take = record => {
    const result = validateRecord(record);
    const id = plain(record) && typeof record.id === 'string' ? record.id : '';
    if (!result.ok) { rejected.push({ id, reason: result.errors.join('；') }); return; }
    if (byId.has(record.id)) return;
    const accepted = clone(record);
    accepted.payerKey = payerKeyOf(accepted.payer);
    byId.set(record.id, accepted);
  };
  if (own(source, 'records') && !Array.isArray(source.records)) rejected.push({ id: '', reason: 'records 必須是陣列' });
  asArray(source.records).forEach(take);
  asArray(pending).forEach(take);
  asArray(batches).forEach(batch => recordsFromBatch(batch).forEach(take));

  const links = plain(source.links) ? { ...source.links } : {};
  const mergedBatches = new Set(asArray(source.mergedBatches).filter(Boolean));
  const undoneBatches = new Set(asArray(source.undoneBatches).filter(Boolean));
  const voidBatchIds = new Set(asArray(batches).filter(batch => plain(batch) && batch.state === 'undone').map(batch => batch.id));
  for (const batch of asArray(batches)) if (plain(batch) && batch.state === 'confirmed' && batch.id) mergedBatches.add(batch.id);

  for (const op of asArray(ops)) {
    if (!plain(op)) continue;
    if (op.op === 'moneyUndoImport' && op.target) { voidBatchIds.add(op.target); undoneBatches.add(op.target); }
    if (op.op === 'moneyImport' && op.target) mergedBatches.add(op.target);
  }
  for (const record of byId.values()) if (voidBatchIds.has(record.importBatch)) {
    record.status = 'void'; record.voidReason = record.voidReason || '撤銷匯入';
  }
  for (const op of asArray(ops)) {
    if (!plain(op)) continue;
    const value = plain(op.value) ? op.value : {};
    if (op.op === 'moneyVoid' && byId.has(op.target)) {
      const record = byId.get(op.target);
      if (record.status !== 'void') {
        record.status = 'void'; record.voidReason = String(value.reason || record.voidReason || '');
        record.voidedAt = String(op.createdAt || op.at || record.voidedAt || '');
      }
    } else if (op.op === 'moneyEvidence' && byId.has(op.target) && typeof value.file === 'string' && value.file) {
      const record = byId.get(op.target); const evidence = asArray(record.evidence);
      if (!evidence.some(item => plain(item) && item.store === 'money' && item.file === value.file)) evidence.push({ store: 'money', file: value.file });
      record.evidence = evidence;
    }
  }
  const linkOps = asArray(ops).map((op, index) => ({ op, index, at: Date.parse(op?.at) }))
    .filter(({ op }) => plain(op) && op.op === 'moneyLink')
    .sort((left, right) => Number.isFinite(left.at) && Number.isFinite(right.at) && left.at !== right.at ? left.at - right.at : left.index - right.index);
  for (const { op } of linkOps) {
    const value = plain(op.value) ? op.value : {};
    if (typeof op.target === 'string' && typeof value.counterpartId === 'string' && value.counterpartId) links[op.target] = value.counterpartId;
  }
  let balance = null;
  if (source.balance !== undefined && source.balance !== null) {
    const checked = validateBalance(source.balance);
    if (checked.ok) balance = clone(source.balance);
    else rejected.push({ id: 'balance', reason: checked.errors.join('；') });
  }
  const seenBalanceOpIds = new Set(), balanceOps = [];
  for (const [index, op] of asArray(ops).entries()) {
    if (!plain(op) || op.op !== 'moneyBalance' || op.target !== 'balance') continue;
    const id = typeof op.id === 'string' && op.id ? op.id : '';
    if (id && seenBalanceOpIds.has(id)) continue;
    if (id) seenBalanceOpIds.add(id);
    const value = plain(op.value) ? op.value : {};
    const amount = typeof value.amount === 'string' && /^\d+$/.test(value.amount) ? Number(value.amount) : NaN;
    const candidate = {
      amountCents: amount, currency: value.currency, asOf: value.asOf,
      confirmedAt: typeof op.at === 'string' ? op.at : '', by: 'founder'
    };
    const checked = validateBalance(candidate);
    if (!checked.ok) { rejected.push({ id: 'balance', reason: checked.errors.join('；') }); continue; }
    balanceOps.push({ at: Date.parse(candidate.confirmedAt), id, index, balance: candidate });
  }
  balanceOps.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id) || left.index - right.index);
  const latestBalanceOp = balanceOps.at(-1);
  if (latestBalanceOp) {
    const baseAt = Date.parse(balance?.confirmedAt);
    if (!balance || !Number.isFinite(baseAt) || latestBalanceOp.at >= baseAt) balance = latestBalanceOp.balance;
  }
  const records = [...byId.values()];
  return {
    mainCurrency: mainCurrencyOf(source.mainCurrency, records), records, importMaps: asArray(source.importMaps),
    links, mergedBatches: [...mergedBatches], undoneBatches: [...undoneBatches], balance, rejected
  };
}

// 篩出尚未作廢的已確認紀錄。
export const liveRecords = records => asArray(records).filter(record => record?.status === 'confirmed');

// 依對方編號、名稱連結或名稱比對鍵取得統一身份。
export function identityOf(record, links = {}) {
  if (typeof record?.counterpartId === 'string' && record.counterpartId) return record.counterpartId;
  const key = record?.payerKey || payerKeyOf(record?.payer);
  if (key && plain(links) && typeof links[key] === 'string' && links[key]) return links[key];
  return key || UNATTRIBUTED;
}
const isIncome = record => record?.dir === 'in' && record?.category !== 'funding';
const isQualifiedIncome = (record, links) => isIncome(record) && !record.refund && identityOf(record, links) !== UNATTRIBUTED;
const sumDelta = record => record.refund ? -record.amountCents : record.amountCents;

// 計算某月的主要貨幣指標及其他貨幣的提示數字。
export function monthMetrics(records, month, mainCurrency, links = {}) {
  const result = { income: 0, expense: 0, net: 0, funding: 0, payers: 0, repeat: 0, avg: null, unattributed: 0, other: {} };
  const monthly = liveRecords(records).filter(record => typeof record?.date === 'string' && record.date.startsWith(`${month}-`));
  const eligible = [];
  for (const record of monthly) {
    const bucket = record.currency === mainCurrency ? result : (result.other[record.currency] ||= { income: 0, expense: 0 });
    if (record.category === 'funding') { if (record.currency === mainCurrency) result.funding += sumDelta(record); continue; }
    if (record.dir === 'in') bucket.income += sumDelta(record);
    if (record.dir === 'out') bucket.expense += sumDelta(record);
    if (record.currency === mainCurrency && isQualifiedIncome(record, links)) eligible.push(record);
    if (record.currency === mainCurrency && isIncome(record) && !record.refund && identityOf(record, links) === UNATTRIBUTED) result.unattributed++;
  }
  result.net = result.income - result.expense;
  const groups = new Map();
  for (const record of eligible) { const id = identityOf(record, links); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(record); }
  result.payers = groups.size;
  const allEligible = liveRecords(records).filter(record => record.currency === mainCurrency && isQualifiedIncome(record, links));
  result.repeat = [...groups.entries()].filter(([identity, group]) => {
    const last = group.map(record => record.date).sort().at(-1);
    return allEligible.some(record => identityOf(record, links) === identity && record.date < last);
  }).length;
  result.avg = result.payers ? Math.round(result.income / result.payers) : null;
  return result;
}

// 比較兩個月的同一數值。
export function compareMonths(cur, prev) {
  const now = typeof cur === 'number' ? cur : Number(cur?.income || 0);
  const before = typeof prev === 'number' ? prev : Number(prev?.income || 0);
  return { diff: now - before, pct: before === 0 ? null : (now - before) / Math.abs(before) };
}

// 由結束月份倒推指定數量的月份，結果由舊至新。
export function monthsBack(endMonth, n) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(endMonth || ''));
  if (!match || !Number.isInteger(n) || n < 1) return [];
  const out = [], end = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  for (let i = n - 1; i >= 0; i--) { const date = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)); out.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`); }
  return out;
}

// 建立最近月份的趨勢資料。
export const trend = (records, endMonth, n, mainCurrency, links = {}) => monthsBack(endMonth, n).map(month => ({ month, ...monthMetrics(records, month, mainCurrency, links) }));

const shiftMonth = (month, delta) => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match || !Number.isInteger(delta)) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};
const lastDayOfMonth = month => {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() : 0;
};
const emptyRunway = () => ({
  state: 'unset', balanceCents: 0, currency: '', asOf: '', stale: false,
  basisMonths: [], avgNetCents: 0, burnCents: 0, months: null, otherCurrencies: []
});

// 以最近完整月份的平均淨額，估算已確認現金結餘可支撐多久。
export function cashRunway(balance, records, today, mainCurrency) {
  if (!validateBalance(balance).ok || !validDate(today)) return emptyRunway();
  const expiryMonth = shiftMonth(String(balance.asOf).slice(0, 7), 1);
  const expiry = `${expiryMonth}-${String(Math.min(Number(String(balance.asOf).slice(8, 10)), lastDayOfMonth(expiryMonth))).padStart(2, '0')}`;
  const result = {
    ...emptyRunway(), state: 'noHistory', balanceCents: balance.amountCents, currency: balance.currency,
    asOf: balance.asOf, stale: dateNumber(today) > dateNumber(expiry)
  };
  if (mainCurrency && balance.currency !== mainCurrency) return { ...result, state: 'otherCurrency' };
  if (!mainCurrency) return result;

  const relevant = liveRecords(records).filter(record => record?.currency === mainCurrency && record.category !== 'funding' && validDate(record.date));
  if (!relevant.length) return result;
  const first = relevant.slice().sort((left, right) => left.date.localeCompare(right.date))[0];
  const startMonth = Number(first.date.slice(8, 10)) >= 8 ? shiftMonth(first.date.slice(0, 7), 1) : first.date.slice(0, 7);
  const endMonth = shiftMonth(today.slice(0, 7), -1);
  const basisMonths = monthsBack(endMonth, 3).filter(month => month >= startMonth);
  if (!basisMonths.length || !relevant.some(record => basisMonths.includes(record.date.slice(0, 7)))) return result;

  const totalNetCents = basisMonths.reduce((sum, month) => sum + monthMetrics(relevant, month, mainCurrency).net, 0);
  result.basisMonths = basisMonths;
  result.otherCurrencies = [...new Set(liveRecords(records)
    .filter(record => typeof record?.date === 'string' && basisMonths.includes(record.date.slice(0, 7)) && typeof record.currency === 'string' && record.currency !== mainCurrency)
    .map(record => record.currency))].sort();
  result.avgNetCents = Math.round(totalNetCents / basisMonths.length);
  if (totalNetCents >= 0) return { ...result, state: 'balanced' };
  result.burnCents = Math.round(-totalNetCents / basisMonths.length);
  result.months = Math.floor(balance.amountCents * 10 * basisMonths.length / -totalNetCents) / 10;
  return { ...result, state: 'months' };
}

// 比較本月截至今日與上月同日止的收入、支出及付款者指標。
export function samePeriodMetrics(records, today, mainCurrency, links = {}) {
  if (!validDate(today)) {
    const empty = monthMetrics([], '', mainCurrency, links);
    return { month: '', prevMonth: '', cutoff: '', cur: empty, prev: empty };
  }
  const month = today.slice(0, 7), prevMonth = shiftMonth(month, -1);
  const cutoff = `${prevMonth}-${String(Math.min(Number(today.slice(8, 10)), lastDayOfMonth(prevMonth))).padStart(2, '0')}`;
  const through = end => liveRecords(records).filter(record => validDate(record?.date) && record.date <= end);
  return {
    month, prevMonth, cutoff,
    cur: monthMetrics(through(today), month, mainCurrency, links),
    prev: monthMetrics(through(cutoff), prevMonth, mainCurrency, links)
  };
}

// 計算一個目標由設定日到結束日的累計進度。
export function goalProgress(target, records, endDate, mainCurrency, links = {}) {
  const metric = target?.metric, from = String(target?.from || ''), end = String(endDate || '');
  let income = 0, expense = 0; const payers = new Set();
  for (const record of liveRecords(records)) {
    if (record.currency !== mainCurrency || !validDate(record.date) || record.date < from || record.date > end) continue;
    if (record.category === 'funding') continue;
    if (record.dir === 'in') income += sumDelta(record);
    if (record.dir === 'out') expense += sumDelta(record);
    if (isQualifiedIncome(record, links)) payers.add(identityOf(record, links));
  }
  const goal = metric === 'payers' ? Number(target?.count || 0) : Number(target?.amountCents || 0);
  const current = metric === 'income' ? income : metric === 'net' ? income - expense : metric === 'payers' ? payers.size : 0;
  return { metric, goal, current, ratio: goal > 0 ? Math.max(0, Math.min(1, current / goal)) : 0 };
}

// 列出尚未連到名單、貢獻最高的付款者。
export function topUnlistedPayers(records, mainCurrency, links = {}, limit = 5) {
  const groups = new Map();
  for (const record of liveRecords(records)) {
    if (record.currency !== mainCurrency || !isIncome(record)) continue;
    const identity = identityOf(record, links); if (identity === UNATTRIBUTED || /^pc-/.test(identity)) continue;
    const item = groups.get(identity) || { name: '', payerKey: identity, totalCents: 0, date: '' };
    item.totalCents += sumDelta(record);
    if (String(record.date || '') >= item.date) { item.name = String(record.payer || ''); item.date = String(record.date || ''); }
    groups.set(identity, item);
  }
  return [...groups.values()].sort((a, b) => b.totalCents - a.totalCents || a.payerKey.localeCompare(b.payerKey)).slice(0, limit)
    .map(({ name, payerKey, totalCents }) => ({ name, payerKey, totalCents }));
}

// 計算一位名單對象的已付款次數及總額。
export function payerStats(records, counterpartId, links = {}, mainCurrency) {
  let count = 0, totalCents = 0;
  for (const record of liveRecords(records)) if (record.currency === mainCurrency && isQualifiedIncome(record, links) && identityOf(record, links) === counterpartId) { count++; totalCents += record.amountCents; }
  return { count, totalCents, currency: mainCurrency };
}

// 找出已有證據的名單付款，供推進格位使用。
export function pipelinePaidIds(records, links = {}) {
  const ids = new Set();
  for (const record of liveRecords(records)) if (isQualifiedIncome(record, links) && hasEvidence(record)) {
    const id = identityOf(record, links); if (/^pc-/.test(id)) ids.add(id);
  }
  return ids;
}

// 按 CrewZero 的簡短格式顯示以分為單位的金額。
export function formatMoney(cents, currency) {
  const amount = Number(cents || 0), sign = amount < 0 ? '-' : '', abs = Math.abs(Math.trunc(amount));
  const whole = Math.floor(abs / 100).toLocaleString('en-US'), decimal = abs % 100;
  const number = whole + (decimal ? `.${String(decimal).padStart(2, '0')}` : '');
  const prefix = { HKD: 'HK$', USD: 'US$', TWD: 'NT$', CNY: 'RMB ' }[currency] || `${currency || '---'} `;
  return `${sign}${prefix}${number}`;
}

// 依原始欄名穩定產生匯入對應表編號。
export function mapIdFor(headers) {
  const text = asArray(headers).map(value => String(value)).sort((a, b) => a.localeCompare(b)).join('\u0000');
  return `map-${crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)}`;
}

// 建立匯入列的重複判斷鍵。
export function importKeyOf(draft, mapId, occurrence = 1) {
  const order = String(draft?.orderNo || '').trim();
  if (order) return `${mapId}|o|${order}`;
  return `${mapId}|h|${draft?.date || ''}|${draft?.amountCents || ''}|${draft?.currency || ''}|${draft?.dir || ''}|${payerKeyOf(draft?.payer)}|${payerKeyOf(draft?.what)}|#${occurrence}`;
}

// 為匯入草稿標示可入帳、重複、已見、缺資料或已取消的狀態。
export function classifyImportRows(drafts, existing, { mapId } = {}) {
  const all = asArray(existing), seen = new Map();
  for (const record of all) if (record?.importKey && !(record.status === 'void' && record.voidReason === '撤銷匯入')) seen.set(record.importKey, (seen.get(record.importKey) || 0) + 1);
  const occurrences = new Map();
  return asArray(drafts).map(draft => {
    const fingerprint = `${draft?.date || ''}|${draft?.amountCents || ''}|${draft?.currency || ''}|${draft?.dir || ''}|${payerKeyOf(draft?.payer)}|${payerKeyOf(draft?.what)}`;
    const occurrence = (occurrences.get(fingerprint) || 0) + 1; occurrences.set(fingerprint, occurrence);
    const importKey = importKeyOf(draft, mapId, occurrence);
    let status = 'ok', reason = '', seenCount = 0;
    if (draft?.cancelled) { status = 'cancelled'; reason = String(draft.cancelReason || '此行已取消'); }
    else {
      const dir = draft?.dir, problems = [];
      if (!validDate(draft?.date)) problems.push('日期');
      if (!Number.isSafeInteger(draft?.amountCents) || draft.amountCents <= 0) problems.push('金額');
      if (!['in', 'out'].includes(dir)) problems.push('方向');
      if (!/^[A-Z]{3}$/.test(String(draft?.currency || ''))) problems.push('貨幣');
      if (!CATEGORIES[dir]?.includes(draft?.category)) problems.push('類別');
      if (typeof draft?.payer !== 'string' || Array.from(draft.payer).length > 80) problems.push('對方');
      if (typeof draft?.what !== 'string' || Array.from(draft.what).length > 120) problems.push('說明');
      if (problems.length) { status = 'incomplete'; reason = `資料不全：${problems.join('、')}`; }
      else if (seen.has(importKey)) { status = 'seen'; seenCount = seen.get(importKey); reason = `已匯入過 ${seenCount} 筆`; }
    }
    if (status === 'ok') {
      const duplicate = all.some(record => {
        if (!record || record.status !== 'confirmed' || record.dir !== draft.dir || record.amountCents !== draft.amountCents || record.currency !== draft.currency) return false;
        if (Math.abs(dateNumber(record.date) - dateNumber(draft.date)) > 3 * 86400000) return false;
        const oldOrder = /^([^|]+)\|o\|(.+)$/.exec(String(record.importKey || ''));
        const newOrder = String(draft.orderNo || '').trim();
        if (oldOrder && oldOrder[1] === String(mapId) && newOrder && oldOrder[2] !== newOrder) return false;
        const draftPayerKey = payerKeyOf(draft?.payer);
        const recordPayerKey = payerKeyOf(record?.payer) || payerKeyOf(record?.payerKey);
        return !(draftPayerKey && recordPayerKey && draftPayerKey !== recordPayerKey);
      });
      if (duplicate) { status = 'dup'; reason = '日期相近而方向、金額及貨幣相同，可能重複'; }
    }
    return { draft, importKey, status, reason, seenCount, include: status === 'ok' };
  });
}
