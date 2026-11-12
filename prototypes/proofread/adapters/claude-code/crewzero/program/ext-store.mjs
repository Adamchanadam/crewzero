// 延伸功能的檔案讀寫：所有可變檔均重讀後以專屬暫存檔換入。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { extensionsDir, folderNameFor, validate, validateText, checkRevision, stageCardCounts, validateRow, readRows, isLastStage, dueState, summaryOf, applyEdits, mergeDraft, newDraftId, newRowId } from './ext-lib.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safeDraftId = value => /^x-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}$/.test(String(value || ''));
const safeRowId = value => /^r-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}$/.test(String(value || ''));
const iso = value => typeof value === 'string' && value ? value : new Date().toISOString();

export function extensionPaths(DIR) {
  const base = path.join(DIR.ledger, 'extensions');
  return { base, registry: path.join(base, 'index.json'), drafts: base, decls: path.join(base, 'decl') };
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function readTableJson(file) {
  if (!fs.existsSync(file)) return { ok: true, source: { schema: 1, rows: [] }, hash: '', exists: false };
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, error: 'badFormat' }; }
  let source;
  try { source = JSON.parse(text); } catch { return { ok: false, error: 'badFormat' }; }
  if (!plain(source) || !Array.isArray(source.rows)) return { ok: false, error: 'badFormat' };
  return { ok: true, source, hash: sha256(text), exists: true };
}
function fileInfo(file) {
  try { return fs.lstatSync(file); } catch { return null; }
}
function atomicJson(file, value, { create = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fileInfo(file);
  if (current?.isSymbolicLink() || (current && !current.isFile())) throw new Error('目標檔案不是一般檔案');
  if (create && current) throw new Error('檔案已存在');
  const temp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
    for (let i = 0; ; i++) {
      try { fs.renameSync(temp, file); return; }
      catch (error) {
        if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
        sleep(25);
      }
    }
  } finally { try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch { } }
}
function withLock(file, fn) {
  const lock = `${file}.lock`; fs.mkdirSync(path.dirname(lock), { recursive: true });
  let fd = null;
  for (let i = 0; i < 200 && fd === null; i++) {
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { force: true }); } catch { }
      sleep(10);
    }
  }
  if (fd === null) return null;
  try { return fn(); }
  finally { try { fs.closeSync(fd); } catch { } try { fs.rmSync(lock, { force: true }); } catch { } }
}
function rootDir(ROOT, DIR, { create = false } = {}) {
  const target = extensionsDir(ROOT, DIR), state = fileInfo(target);
  if (!state && create) fs.mkdirSync(target, { recursive: true });
  const checked = fileInfo(target);
  if (!checked || !checked.isDirectory() || checked.isSymbolicLink()) return '';
  try {
    const parent = fs.realpathSync.native(path.dirname(target)), actual = fs.realpathSync.native(target);
    if (path.resolve(actual).toLocaleLowerCase('en-US') !== path.resolve(path.join(parent, path.basename(target))).toLocaleLowerCase('en-US')) return '';
  } catch { return ''; }
  return target;
}
function actualFolders(ROOT, DIR) {
  const root = rootDir(ROOT, DIR); if (!root) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => entry.name).filter(name => {
        const state = fileInfo(path.join(root, name)); return !!state && state.isDirectory() && !state.isSymbolicLink();
      });
  } catch { return []; }
}
function folderPath(ROOT, DIR, folder) {
  const name = String(folder || '');
  if (!name || name !== path.basename(name) || !actualFolders(ROOT, DIR).includes(name)) return '';
  return path.join(rootDir(ROOT, DIR), name);
}
function extensionFile(ROOT, DIR, folder) {
  const dir = folderPath(ROOT, DIR, folder); if (!dir) return '';
  const file = path.join(dir, 'extension.json'), state = fileInfo(file);
  return state && state.isFile() && !state.isSymbolicLink() ? file : '';
}
function draftPath(DIR, id) { return safeDraftId(id) ? path.join(extensionPaths(DIR).drafts, `${id}.json`) : ''; }
function registryShape(value) {
  const items = Array.isArray(value?.items) ? value.items.filter(item => plain(item) && typeof item.folder === 'string' && ['enabled', 'disabled'].includes(item.state)) : [];
  return { schema: 1, items: clone(items) };
}

export function readRegistry(DIR) { return registryShape(readJson(extensionPaths(DIR).registry, { schema: 1, items: [] })); }
export function writeRegistry(DIR, registry) { atomicJson(extensionPaths(DIR).registry, registryShape(registry)); return readRegistry(DIR); }
export function readDraft(DIR, id) { const file = draftPath(DIR, id); return file ? readJson(file, null) : null; }
export function listDrafts(DIR) {
  const { drafts } = extensionPaths(DIR); let names = [];
  try { names = fs.readdirSync(drafts); } catch { return []; }
  return names.filter(name => /^x-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.json$/.test(name)).map(name => readJson(path.join(drafts, name), null)).filter(Boolean)
    .filter(draft => ['drafting', 'ready', 'failed'].includes(draft.state)).sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}
export function createDraft(DIR, draft, { now = '' } = {}) {
  const id = String(draft?.id || ''); if (!safeDraftId(id)) return { ok: false, error: 'notFound' };
  const file = draftPath(DIR, id);
  try { atomicJson(file, { ...clone(draft), id, createdAt: iso(draft.createdAt || now), updatedAt: iso(now) }, { create: true }); }
  catch (error) { return { ok: false, error: error?.message === '檔案已存在' ? 'exists' : 'invalid' }; }
  return { ok: true, draft: readDraft(DIR, id) };
}
// 跨程序草稿修補：鎖內重讀、驗狀態、mergeDraft，才用暫存檔換入。
export function patchDraft(DIR, id, patch, who, { expect, now = '' } = {}) {
  const file = draftPath(DIR, id); if (!file) return { ok: false, error: 'notFound' };
  try {
    const result = withLock(file, () => {
      const current = readJson(file, null); if (!current) return { ok: false, error: 'notFound' };
      const expected = expect == null ? null : Array.isArray(expect) ? expect : [expect];
      if (expected && !expected.includes(current.state)) return { ok: false, error: 'stale', draft: current };
      if (who === 'server' && own(patch, 'edits') && Number(patch.edits?.forRev) !== Number(current.baseRev)) return { ok: false, error: 'stale', draft: current };
      const merged = mergeDraft(current, { ...(plain(patch) ? patch : {}), updatedAt: iso(now) }, who);
      if (!merged.ok) return { ok: false, error: 'invalid', reason: merged.error, draft: current };
      atomicJson(file, merged.draft); return { ok: true, draft: merged.draft };
    });
    return result || { ok: false, error: 'busy' };
  } catch { return { ok: false, error: 'invalid' }; }
}
export const writeDraft = (DIR, id, patch, options = {}) => patchDraft(DIR, id, patch, options.who || 'server', options);

function readDecl(ROOT, DIR, folder, options = {}) {
  const file = extensionFile(ROOT, DIR, folder); if (!file) return { ok: false, error: 'notFound' };
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, error: 'notFound' }; }
  const checked = validateText(text, options); if (!checked.ok) return { ok: false, error: checked.errors.join('；'), file };
  return { ok: true, decl: JSON.parse(text), text, file, hash: sha256(text) };
}
function dataFile(ROOT, DIR, folder, table) {
  const dir = folderPath(ROOT, DIR, folder); if (!dir || !/^t\d+$/.test(String(table || ''))) return '';
  const data = path.join(dir, 'data'), state = fileInfo(data);
  if (state && (!state.isDirectory() || state.isSymbolicLink())) return '';
  const file = path.join(data, `${table}.json`), item = fileInfo(file);
  return !item || (item.isFile() && !item.isSymbolicLink()) ? file : '';
}
function rowsFor(ROOT, DIR, folder, decl) {
  const byTable = {};
  for (const table of decl.tables || []) {
    const file = dataFile(ROOT, DIR, folder, table.id);
    byTable[table.id] = file ? readRows(readJson(file, { schema: 1, rows: [] }), table).rows : [];
  }
  return byTable;
}
export function readExtensionRows(ROOT, DIR, folder, tableId) {
  const ext = readDecl(ROOT, DIR, folder); if (!ext.ok) return { ok: false, error: ext.error, rows: [], problems: [], bad: ext.error };
  const table = (ext.decl.tables || []).find(item => item.id === tableId); if (!table) return { ok: false, error: 'notFound', rows: [], problems: [], bad: '找不到資料表' };
  const file = dataFile(ROOT, DIR, folder, table.id); if (!file) return { ok: false, error: 'notFound', rows: [], problems: [], bad: '資料夾或資料檔不可用' };
  const loaded = readTableJson(file);
  if (!loaded.ok) return { ok: false, error: 'badFormat', rows: [], problems: [], bad: '資料表不是有效的 JSON' };
  return { ok: true, ...readRows(loaded.source, table) };
}
function declarationSnapshot(DIR, hash, decl) {
  if (!/^[a-f0-9]{64}$/.test(hash)) return;
  const file = path.join(extensionPaths(DIR).decls, `${hash}.json`);
  if (!fileInfo(file)) atomicJson(file, decl, { create: true });
}
export function registerExtension(DIR, folder, decl, { state = 'enabled', now = '' } = {}) {
  const text = JSON.stringify(decl, null, 2), hash = sha256(text), at = iso(now);
  const current = readRegistry(DIR), previous = current.items.find(item => item.folder === folder);
  const item = { folder, state: state === 'disabled' ? 'disabled' : 'enabled', enabledAt: previous?.enabledAt || at, declHash: hash, seenHash: hash };
  current.items = [...current.items.filter(entry => entry.folder !== folder), item];
  writeRegistry(DIR, current); declarationSnapshot(DIR, hash, decl); return item;
}
export function createExtension(ROOT, DIR, folder, decl) {
  const root = rootDir(ROOT, DIR, { create: true }); if (!root || folder !== path.basename(folder)) return { ok: false, error: 'invalid' };
  const target = path.join(root, folder);
  try {
    if (!fileInfo(target)) fs.mkdirSync(target);
    const state = fileInfo(target); if (!state?.isDirectory() || state.isSymbolicLink()) return { ok: false, error: 'invalid' };
    fs.mkdirSync(path.join(target, 'data'), { recursive: true });
    const data = fileInfo(path.join(target, 'data')); if (!data?.isDirectory() || data.isSymbolicLink()) return { ok: false, error: 'invalid' };
    const file = path.join(target, 'extension.json'); if (!fileInfo(file)) atomicJson(file, decl, { create: true });
    return { ok: true, folder };
  } catch { return { ok: false, error: 'invalid' }; }
}
export function writeExtension(ROOT, DIR, folder, decl) {
  const checked = validate(decl); if (!checked.ok) return { ok: false, error: checked.errors.join('；') };
  const file = extensionFile(ROOT, DIR, folder); if (!file) return { ok: false, error: 'notFound' };
  try { atomicJson(file, decl); return { ok: true, hash: sha256(JSON.stringify(decl, null, 2)) }; } catch { return { ok: false, error: 'invalid' }; }
}
function registeredDeclaration(DIR, entry) {
  const hash = String(entry?.declHash || '');
  if (!/^[a-f0-9]{64}$/.test(hash)) return null;
  const decl = readJson(path.join(extensionPaths(DIR).decls, `${hash}.json`), null);
  return validate(decl).ok ? decl : null;
}
export function listExtensions(ROOT, DIR, { crewPort, today } = {}) {
  const registry = readRegistry(DIR), registered = new Map(registry.items.map(item => [item.folder, item]));
  const items = [];
  for (const folder of actualFolders(ROOT, DIR)) {
    const ext = readDecl(ROOT, DIR, folder, { crewPort });
    if (!ext.ok) { items.push({ folder, name: folder, state: 'bad', error: ext.error, updatedAt: '' }); continue; }
    const entry = registered.get(folder), stat = fileInfo(ext.file), summary = summaryOf(ext.decl, rowsFor(ROOT, DIR, folder, ext.decl), today || new Date().toISOString().slice(0, 10));
    let state = entry?.state || 'pending', error = '', changed = false;
    if (entry && entry.declHash !== ext.hash) {
      const saved = registeredDeclaration(DIR, entry);
      const checked = saved && checkRevision(saved, ext.decl, { cardCounts: stageCardCounts(saved, rowsFor(ROOT, DIR, folder, saved)) });
      if (!checked?.ok) { state = 'bad'; error = checked?.errors?.join('；') || '找不到已登記的宣告版本'; }
      else changed = true;
    }
    items.push({ folder, name: ext.decl.name, state, decl: ext.decl, summary, updatedAt: stat ? new Date(stat.mtimeMs).toISOString() : '', ...(error ? { error } : {}), ...(changed ? { changed: true } : {}) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}
export function templateDraft(ROOT, DIR, template, { now = '' } = {}) {
  if (!['orders', 'bookings', 'stock'].includes(template)) return { ok: false, error: 'invalid' };
  const file = path.join(ROOT, 'fixtures', 'ext-templates', `${template}.json`), source = readJson(file, null);
  if (!plain(source) || !validate(source.decl).ok || !Array.isArray(source.sample)) return { ok: false, error: 'notFound' };
  for (let i = 0; i < 50; i++) {
    const id = newDraftId(new Date(Date.now() + i));
    const draft = { id, state: 'ready', from: `template:${template}`, ask: '', base: source.decl, baseRev: 1, sample: source.sample.slice(0, 5), edits: { forRev: 1 }, revise: '', folder: '', sourceHash: '', error: '' };
    const made = createDraft(DIR, draft, { now }); if (made.ok) return made;
  }
  return { ok: false, error: 'busy' };
}
export function rowWrite(ROOT, DIR, { folder, table: tableId, op, id = '', rev, v = {} } = {}, { now = '' } = {}) {
  const ext = readDecl(ROOT, DIR, folder); if (!ext.ok) return { ok: false, error: ext.error };
  const table = (ext.decl.tables || []).find(item => item.id === tableId); if (!table) return { ok: false, error: 'notFound' };
  const file = dataFile(ROOT, DIR, folder, tableId); if (!file) return { ok: false, error: 'notFound' };
  try {
    const result = withLock(file, () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const loaded = readTableJson(file); if (!loaded.ok) return { ok: false, error: 'badFormat' };
        const source = loaded.source;
        if (Buffer.byteLength(JSON.stringify(source), 'utf8') > 2 * 1024 * 1024) return { ok: false, error: 'limit' };
        const rows = clone(source.rows), at = iso(now); let row;
        if (op === 'add') {
          if (rows.length >= 2000) return { ok: false, error: 'limit' };
          const checked = validateRow(table, v, { requireAll: true }); if (!checked.ok) return { ok: false, error: 'invalid', reason: checked.errors.join('；') };
          let rowId = newRowId(); for (let i = 0; rows.some(item => item?.id === rowId) && i < 50; i++) rowId = newRowId(new Date(Date.now() + i + 1));
          row = { id: rowId, rev: 1, v: checked.v, createdAt: at, updatedAt: at, archived: false, handedAt: '' }; rows.push(row);
        } else {
          const index = rows.findIndex(item => item?.id === id); if (index < 0) return { ok: false, error: 'notFound' };
          row = rows[index]; if (!Number.isInteger(rev) || rev !== row.rev) return { ok: false, error: 'stale', row };
          if (op === 'update') { const checked = validateRow(table, { ...row.v, ...(plain(v) ? v : {}) }); if (!checked.ok) return { ok: false, error: 'invalid', reason: checked.errors.join('；') }; row.v = checked.v; }
          else if (op === 'archive') row.archived = true;
          else if (op === 'restore') row.archived = false;
          else return { ok: false, error: 'invalid' };
          row.rev += 1; row.updatedAt = at;
        }
        const next = { schema: 1, rows }; if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 2 * 1024 * 1024) return { ok: false, error: 'limit' };
        // 換入前重讀；不合作的直接寫檔仍可在此檢查與 rename 間插入，時窗只剩一次檔案替換。
        const latest = readTableJson(file);
        if (!latest.ok) return { ok: false, error: 'badFormat' };
        if (latest.exists !== loaded.exists || latest.hash !== loaded.hash) continue;
        atomicJson(file, next); return { ok: true, row };
      }
      return { ok: false, error: 'stale' };
    });
    return result || { ok: false, error: 'busy' };
  } catch { return { ok: false, error: 'invalid' }; }
}
export function archiveDone(ROOT, DIR, folder, tableId, { now = '' } = {}) {
  const ext = readDecl(ROOT, DIR, folder); if (!ext.ok) return { ok: false, error: ext.error };
  const table = (ext.decl.tables || []).find(item => item.id === tableId), file = table && dataFile(ROOT, DIR, folder, tableId); if (!table || !file) return { ok: false, error: 'notFound' };
  const result = withLock(file, () => {
    const source = readJson(file, { schema: 1, rows: [] }); if (!plain(source) || !Array.isArray(source.rows)) return { ok: false, error: 'invalid' };
    const rows = clone(source.rows), at = iso(now); let changed = 0;
    for (const row of rows) if (!row.archived && isLastStage(table, row)) { row.archived = true; row.rev = Number.isInteger(row.rev) ? row.rev + 1 : 1; row.updatedAt = at; changed++; }
    if (changed) atomicJson(file, { schema: 1, rows }); return { ok: true, changed };
  });
  return result || { ok: false, error: 'busy' };
}
// 交給 Zero 前先落下 handedAt；送件失敗時呼叫者可用 clear 還原，避免重複派送。
export function markHanded(ROOT, DIR, folder, tableId, id, rev, { now = '', clear = false } = {}) {
  const ext = readDecl(ROOT, DIR, folder); if (!ext.ok) return { ok: false, error: ext.error };
  const table = (ext.decl.tables || []).find(item => item.id === tableId), file = table && dataFile(ROOT, DIR, folder, tableId); if (!table || !file) return { ok: false, error: 'notFound' };
  const result = withLock(file, () => {
    const source = readJson(file, { schema: 1, rows: [] }); if (!plain(source) || !Array.isArray(source.rows)) return { ok: false, error: 'invalid' };
    const rows = clone(source.rows), row = rows.find(item => item?.id === id); if (!row) return { ok: false, error: 'notFound' };
    if (!clear && (!Number.isInteger(rev) || row.rev !== rev)) return { ok: false, error: 'stale', row };
    if (!clear && row.handedAt) return { ok: false, error: 'stale', row };
    row.handedAt = clear ? '' : iso(now); atomicJson(file, { schema: 1, rows }); return { ok: true, row };
  });
  return result || { ok: false, error: 'busy' };
}
const overviewCache = new Map();
function overviewStamp(ROOT, DIR) {
  const files = [extensionPaths(DIR).registry];
  for (const folder of actualFolders(ROOT, DIR)) {
    const dir = folderPath(ROOT, DIR, folder); files.push(path.join(dir, 'extension.json'));
    try { for (const name of fs.readdirSync(path.join(dir, 'data'))) if (name.endsWith('.json')) files.push(path.join(dir, 'data', name)); } catch { }
  }
  return files.map(file => { const stat = fileInfo(file); return `${file}:${stat?.mtimeMs || 0}:${stat?.size || 0}`; }).join('|');
}
// 公司現況只取已啟用功能的首兩項摘要；有過期數字的優先，最多三行。
export function extOverview(ROOT, DIR, today) {
  const key = `${path.resolve(ROOT)}|${path.resolve(DIR.ledger)}|${String(today || '')}`, stamp = overviewStamp(ROOT, DIR), cached = overviewCache.get(key);
  if (cached?.stamp === stamp) return clone(cached.value);
  const rows = [];
  for (const item of listExtensions(ROOT, DIR, { today })) {
    if (item.state !== 'enabled') continue;
    const values = Object.values(item.summary || {}).flat().slice(0, 2).map(value => ({ label: value.label, value: value.value, ...(value.currency ? { currency: value.currency } : {}), warn: value.rule === 'overdue' && value.value > 0 }));
    rows.push({ folder: item.folder, name: item.name, values, warn: values.some(value => value.warn) });
  }
  rows.sort((left, right) => Number(right.warn) - Number(left.warn) || left.name.localeCompare(right.name, 'zh-Hant'));
  const value = { rows: rows.slice(0, 3).map(({ warn, ...row }) => row), more: Math.max(0, rows.length - 3), pending: listDrafts(DIR).length };
  overviewCache.set(key, { stamp, value }); return clone(value);
}

export function revisionCheck(ROOT, DIR, folder, next) {
  const current = readDecl(ROOT, DIR, folder); if (!current.ok) return current;
  const entry = readRegistry(DIR).items.find(item => item.folder === folder), saved = registeredDeclaration(DIR, entry);
  if (!saved) return { ok: false, error: 'notFound', current };
  return { ok: true, current, checked: checkRevision(saved, next, { cardCounts: stageCardCounts(saved, rowsFor(ROOT, DIR, folder, saved)) }) };
}
export { applyEdits, folderNameFor, dueState };
