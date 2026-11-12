// 業績 CSV 匯入：CSV 解讀不讀寫檔案；原檔保存只清理本次建立的資料夾。
import fs from 'node:fs';
import path from 'node:path';
import { payerKeyOf, toCents } from './money-lib.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 2000;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const text = value => String(value ?? '').trim();
const headerKey = value => text(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const dateOK = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number), date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

function csvCells(source) {
  const rows = [], row = [];
  let cell = '', quoted = false, atStart = true;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && atStart) { quoted = true; atStart = false; continue; }
    if (ch === ',') { row.push(cell); cell = ''; atStart = true; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); rows.push(row.splice(0)); cell = ''; atStart = true; continue;
    }
    cell += ch; atStart = false;
  }
  if (quoted) return null;
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// 只接受 UTF-8（可帶 BOM）；其他編碼不嘗試猜測，避免把金額或名稱靜默解錯。
export function parseCsv(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  if (bytes.length > MAX_BYTES) return { ok: false, headers: [], rows: [], error: 'tooBig' };
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return { ok: false, headers: [], rows: [], error: 'encoding' }; }
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const cells = csvCells(source);
  if (!cells || !cells.length) return { ok: false, headers: [], rows: [], error: 'csv' };
  const headers = cells.shift().map(value => text(value));
  while (headers.length && !headers.at(-1)) headers.pop();
  if (!headers.length || headers.some(value => !value)) return { ok: false, headers: [], rows: [], error: 'csv' };
  const data = cells.filter(row => row.some(value => text(value)));
  if (data.length > MAX_ROWS) return { ok: false, headers: [], rows: [], error: 'tooBig' };
  const rows = data.map((cells, index) => ({
    line: index + 2,
    values: Object.fromEntries(headers.map((header, at) => [header, text(cells[at])]))
  }));
  return { ok: true, headers, rows, error: '' };
}

const FIELD_HEADERS = Object.freeze({
  date: ['Paid at', '交易日期', '日期', 'Date', 'Created at'],
  amount: ['Total', 'Gross', 'Amount', '金額'],
  currency: ['Currency', '幣別'],
  payer: ['Billing Name', '客戶', '付款人', 'Customer', 'Name', '對方戶名'],
  what: ['Lineitem name', 'Description', '摘要', '說明', 'Item'],
  orderNo: ['Order ID', 'Transaction ID', '訂單編號', '交易編號'],
  status: ['Financial Status', 'Status', 'Type', '狀態'],
  fee: ['Fee', '手續費']
});

const firstHeader = (headers, wants) => {
  const byKey = new Map(headers.map(header => [headerKey(header), header]));
  for (const want of wants) if (byKey.has(headerKey(want))) return byKey.get(headerKey(want));
  return '';
};

// 依欄名建立可讓頁面直接校對的對應；網店一律以整檔收入處理。
export function guessMap(headers) {
  const list = Array.isArray(headers) ? headers.map(text).filter(Boolean) : [];
  const fields = Object.fromEntries(Object.entries(FIELD_HEADERS).map(([key, wants]) => [key, firstHeader(list, wants)]));
  // Shopify 同時有 Billing Name 與 Name 時，Name 的 # 開頭值是訂單編號，不是另一個對方欄。
  if (!fields.orderNo && fields.payer === firstHeader(list, ['Billing Name'])) fields.orderNo = firstHeader(list, ['Name']);
  const inCol = firstHeader(list, ['存入', 'Income', 'Credit']);
  const outCol = firstHeader(list, ['支出', 'Expense', 'Debit']);
  if (inCol && outCol) return { fields, dirMode: 'twoCols', fixedDir: '', inCol, outCol };
  return { fields, dirMode: 'sign', fixedDir: '', inCol: '', outCol: '' };
}

const privateHeader = header => /(?:^|[ _-])(e-?mail|email|phone|address)(?:$|[ _-])|電郵|電話|地址/i.test(String(header || ''));
const cellOf = (row, header) => header && !privateHeader(header) && row?.values && own(row.values, header) ? text(row.values[header]) : '';
const normalDate = raw => {
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})(?:[ T].*)?$/.exec(text(raw));
  const value = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  return dateOK(value) ? value : '';
};
const signedCents = raw => {
  const value = text(raw).replace(/^(?:HK\$|US\$|NT\$|RMB\s*|[A-Z]{3}\s*)/i, '').replace(/,/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) return { cents: null, negative: false };
  const negative = value.startsWith('-'), cents = toCents(negative ? value.slice(1) : value);
  return { cents, negative };
};
const kindOf = value => headerKey(value);
const cancelled = value => ['voided', 'cancelled', 'canceled', '已取消'].includes(kindOf(value));
const refunded = value => ['refunded', '已退款'].includes(kindOf(value));
const transfer = value => ['payout', 'transfer', '提款', '轉賬'].includes(kindOf(value));
const refundType = value => ['refund', '退款'].includes(kindOf(value));

function directionOf(row, map, fields, kind, refund) {
  if (map.dirMode === 'twoCols') {
    const input = signedCents(cellOf(row, map.inCol)), output = signedCents(cellOf(row, map.outCol));
    if (input.cents) return { dir: 'in', cents: input.cents };
    if (output.cents) return { dir: 'out', cents: output.cents };
    return { dir: '', cents: null };
  }
  const amount = signedCents(cellOf(row, fields.amount));
  if (map.dirMode === 'fixed') return { dir: map.fixedDir === 'out' ? 'out' : 'in', cents: amount.cents };
  // 收款平台的 Refund 是原收款的退款；負號表示退回金額，不表示一筆新的支出。
  if (refund && kind === 'payment') return { dir: 'in', cents: amount.cents };
  return { dir: amount.negative ? 'out' : 'in', cents: amount.cents };
}

function draftFor(row, map, options) {
  const fields = map.fields || {}, kind = String(options.kind || 'other'), type = cellOf(row, fields.status);
  const orderFromName = !fields.orderNo && /^#/.test(cellOf(row, fields.payer)) ? cellOf(row, fields.payer) : '';
  const orderNo = cellOf(row, fields.orderNo) || orderFromName;
  const payer = orderFromName ? '' : cellOf(row, fields.payer);
  const isRefund = refundType(type), byDirection = directionOf(row, map, fields, kind, isRefund);
  const status = cancelled(type) ? { cancelled: true, cancelReason: '已取消' }
    : refunded(type) && byDirection.cents ? { cancelled: true, cancelReason: '已全數退款' }
      : transfer(type) ? { cancelled: true, cancelReason: '轉賬，不是收支' } : {};
  const currency = cellOf(row, fields.currency).toUpperCase() || String(options.mainCurrency || '').toUpperCase();
  return {
    line: row.line,
    draft: {
      dir: byDirection.dir,
      amountCents: byDirection.cents,
      currency,
      date: normalDate(cellOf(row, fields.date)),
      payer,
      what: cellOf(row, fields.what).slice(0, 120),
      category: byDirection.dir === 'in' ? 'sales' : 'otherOut',
      refund: isRefund,
      orderNo,
      ...status
    },
    feeCents: signedCents(cellOf(row, fields.fee)).cents
  };
}

// 解讀已對應欄位；同一單號合併為最早一行。手續費優先沿用舊的數字編號；如會撞到交易原行號，改用獨立的 fee:<行號> 編號。
export function draftsFrom(rows, map, { mainCurrency = '', kind = 'other' } = {}) {
  const safeMap = map && typeof map === 'object' ? map : guessMap([]);
  const parsed = (Array.isArray(rows) ? rows : []).map(row => draftFor(row, safeMap, { mainCurrency, kind }));
  const grouped = new Map(), singles = [];
  for (const item of parsed) {
    const key = text(item.draft.orderNo);
    if (!key) { singles.push(item); continue; }
    const group = grouped.get(key) || []; group.push(item); grouped.set(key, group);
  }
  const merged = [...singles, ...[...grouped.values()].map(group => {
    const first = group[0], draft = { ...first.draft };
    const descriptions = [...new Set(group.map(item => text(item.draft.what)).filter(Boolean))];
    if (descriptions.length) draft.what = descriptions.join('、').slice(0, 120);
    const amounts = group.map(item => item.draft.amountCents).filter(Number.isSafeInteger);
    if (!draft.amountCents && amounts.length) draft.amountCents = amounts.reduce((sum, value) => sum + value, 0);
    return { ...first, draft, feeCents: group.map(item => item.feeCents).filter(Number.isSafeInteger).reduce((sum, value) => sum + value, 0) || null };
  })].sort((left, right) => left.line - right.line);
  const transactionLines = new Set(merged.map(item => String(item.line)));
  const out = [];
  for (const item of merged) {
    out.push({ line: item.line, draft: item.draft });
    if (item.feeCents && !item.draft.cancelled) {
      const feeOrder = item.draft.orderNo ? `${item.draft.orderNo}|fee` : '';
      const oldFeeLine = item.line * 1000 + 1;
      const feeLine = transactionLines.has(String(oldFeeLine)) ? `fee:${item.line}` : oldFeeLine;
      out.push({ line: feeLine, draft: {
        dir: 'out', amountCents: item.feeCents, currency: item.draft.currency, date: item.draft.date,
        payer: item.draft.payer, what: `手續費：${item.draft.what || '原始紀錄'}`.slice(0, 120),
        category: 'tools', refund: false, orderNo: feeOrder
      } });
    }
  }
  return out;
}

// 先確認資料夾由本次呼叫建立，才在失敗時清理；不能把另一個同批次請求的原檔一併刪走。
export function storeImportOriginal(folder, name, bytes, afterWrite) {
  let created = false;
  try {
    fs.mkdirSync(path.dirname(folder), { recursive: true });
    fs.mkdirSync(folder, { recursive: false });
    created = true;
    fs.writeFileSync(path.join(folder, name), bytes, { flag: 'wx' });
    afterWrite();
    return { ok: true };
  } catch {
    if (created) try { fs.rmSync(folder, { recursive: true, force: true }); } catch { }
    return { ok: false };
  }
}
