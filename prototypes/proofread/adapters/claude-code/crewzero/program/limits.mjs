// 收件附件上限及相鄰的純檢查：伺服器、命令列及 Google 取回共用，避免各處漂移。
import crypto from 'node:crypto';

export const FILE_MAX_MB = 25;
export const FILE_MAX_BYTES = FILE_MAX_MB * 1024 * 1024;
export const TOTAL_FILE_MAX_MB = 50;
export const TOTAL_FILE_MAX_BYTES = TOTAL_FILE_MAX_MB * 1024 * 1024;
export const FILE_NAME_MAX = 80;
export const TELL_DUP_WINDOW_MS = 10 * 60 * 1000;

// 先量度字串長度再做一次線性字元檢查；不使用會隨輸入長度反覆回溯的寫法。
export const B64 = Object.freeze({
  test: s => typeof s === 'string' && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s)
});

// 保留副檔名；會議紀錄固定檔尾必須完整保留，否則舊版辨認不到它。
export function cleanFileName(name, max = FILE_NAME_MAX) {
  const safe = String(name || '').replace(/[^\p{L}\p{N}._-]/gu, '_');
  const limit = Number.isSafeInteger(max) && max > 0 ? max : FILE_NAME_MAX;
  if (Array.from(safe).length <= limit) return safe;
  const minutesSuffix = '會議紀錄.md';
  const dot = safe.lastIndexOf('.');
  const suffix = safe.endsWith(minutesSuffix) ? minutesSuffix : dot > 0 ? safe.slice(dot) : '';
  const suffixChars = Array.from(suffix);
  if (suffixChars.length >= limit) return suffixChars.slice(-limit).join('');
  return Array.from(safe).slice(0, limit - suffixChars.length).join('') + suffix;
}

// 同一件交出只看類型、文字、日期及每份附件的內容；名稱或路徑改變不會繞過防重。
export function tellDuplicateKey({ type, text, date, files } = {}) {
  const attachmentHashes = (Array.isArray(files) ? files : []).map(file => {
    const bytes = Buffer.isBuffer(file?.bytes) ? file.bytes : Buffer.from(file?.bytes || '');
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }).sort();
  return crypto.createHash('sha256').update(JSON.stringify({
    type: String(type || ''), text: String(text || ''), date: String(date || ''), files: attachmentHashes
  }), 'utf8').digest('hex');
}

// now 由呼叫者傳入，令十分鐘邊界可作純函數測試。
export function tellDuplicateWithin(seen, key, now, windowMs = TELL_DUP_WINDOW_MS) {
  const entry = seen instanceof Map ? seen.get(key) : null;
  const at = typeof entry === 'object' && entry ? entry.at : entry;
  return Number.isFinite(at) && Number.isFinite(now) && now >= at && now - at <= windowMs;
}
