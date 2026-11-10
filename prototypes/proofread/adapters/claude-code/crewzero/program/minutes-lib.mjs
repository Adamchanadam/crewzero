// 會議紀錄（0.42.0）：草稿位置、登記檔讀寫、檔名、雜湊。伺服器及外殼共用；接口見 docs 的 contracts-0420.md 第 2、3 節。
// 只用 Node 內建模組；不叫 AI、不開程序。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJSON, localIso } from './ask-lib.mjs';

export const STATES = ['speakers', 'drafting', 'ready', 'failed', 'submitted'];
export const MAX_CHARS = 60000;
export const FOLDER = '會議紀錄';

// 真實實例（資料在程式資料夾的 data）：草稿放項目資料夾下的「會議紀錄」，創辦人看得見；其他實例（測試、示範、模擬）放資料夾內，互不影響
export function isRealInstance(ROOT, DIR) {
  const norm = p => { const r = path.resolve(p); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return norm(DIR.data) === norm(path.join(ROOT, 'data'));
}
export function minutesDir(ROOT, DIR) {
  const parent = path.dirname(path.resolve(ROOT));
  // 程式資料夾已在磁碟根目錄時（沒有「項目資料夾」可放），退回資料夾內，不在根目錄建資料夾
  if (!isRealInstance(ROOT, DIR) || parent === path.parse(parent).root) return path.join(DIR.data, FOLDER);
  return path.join(parent, FOLDER);
}
// 頁面顯示的位置：不回傳絕對路徑
export function minutesShown(ROOT, DIR, file) {
  const inProject = minutesDir(ROOT, DIR) !== path.join(DIR.data, FOLDER);
  return (inProject ? '項目資料夾' : '資料夾') + '／' + FOLDER + '／' + String(file || '');
}

export const newMinutesId = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `m-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
};
export const validId = id => /^m-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}$/.test(String(id || ''));

export const sha256 = text => crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');

// 會議紀錄專用的名稱及用詞清單；run.mjs 的 confirmedMarkdown 是其他工作用的完整概覽，兩者互不取代。
// 清走不應交給草稿 AI 的聯絡方式、路徑及憑證；每個值最多 200 字（連「…」）。
function cleanOverviewValue(value) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) return '';
  const dates = [];
  const protectedDates = String(value).replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => {
    let n = dates.length, label = '';
    do { label = String.fromCharCode(65 + n % 26) + label; n = Math.floor(n / 26) - 1; } while (n >= 0);
    const token = `\uE000${label}\uE001`;
    dates.push([token, date]);
    return token;
  });
  const text = protectedDates.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '')
    .replace(/\+?\d[\d\s.．·()-]{6,}\d/g, match => /^\d{4}-\d{2}-\d{2}$/.test(match) || match.replace(/[\s.．·()-]/g, '').length < 8 ? match : '')
    .replace(/\b[A-Za-z]:[\\/][^\s，。；）)]*/g, '')
    .replace(/\b(?:sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}|\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '')
    .replace(/\s+/g, ' ').trim();
  const restored = dates.reduce((result, [token, date]) => result.replaceAll(token, date), text);
  return restored.length > 200 ? restored.slice(0, 199).trimEnd() + '…' : restored;
}

// 只可用確認屬於目前 pageId 的整頁內容；頁面改版而未重新確認時，所有名稱及用詞都不可帶入草稿。
export function overviewLines(page, confirmed) {
  try {
    if (!page || typeof page !== 'object' || !page.page || !page.page.id || !confirmed || typeof confirmed !== 'object' || confirmed.pageId !== page.page.id || !confirmed.values || typeof confirmed.values !== 'object' || Array.isArray(confirmed.values)) return [];
    const stringValue = value => typeof value === 'string' ? cleanOverviewValue(value) : '';
    const values = confirmed.values;
    const confirmedValue = field => {
      if (!field || typeof field.id !== 'string' || !Object.prototype.hasOwnProperty.call(values, field.id)) return '';
      const value = cleanOverviewValue(values[field.id]);
      return value && value !== '待你補充' && value !== '不適用' ? value : '';
    };
    const lines = [];
    const company = page.company || {};
    const name = stringValue(company.name), oneLiner = stringValue(company.oneLiner);
    if (name && name !== '待你補充' && name !== '不適用') lines.push('公司：' + name);
    if (oneLiner && oneLiner !== '待你補充' && oneLiner !== '不適用') lines.push('一句話：' + oneLiner);

    const canvas = (Array.isArray(page.detail && page.detail.reading) ? page.detail.reading : []).filter(field => field && String(field.plan || '').startsWith('canvas.'))
      .map(field => {
        const label = stringValue(field.label), value = confirmedValue(field);
        return label && value ? `${label}：${value}` : '';
      }).filter(Boolean);
    if (canvas.length) lines.push('生意模式一覽', ...canvas);

    const glance = (Array.isArray(page.glance && page.glance.rows) ? page.glance.rows : []).filter(field => field && field.kind !== 'date' && field.kind !== 'grade')
      .map(field => {
        const label = stringValue(field.label), value = confirmedValue(field);
        return label && value ? `${label}：${value}` : '';
      }).filter(Boolean);
    if (glance.length) lines.push('目標及下一步', ...glance);

    const stations = (Array.isArray(page.path && page.path.milestones) ? page.path.milestones : []).map(station => {
      const short = stringValue(station && station.short);
      if (!short) return '';
      const terms = ['event', 'actor', 'witness', 'owner'].map(key => confirmedValue(station && station[key])).filter(Boolean);
      return short + (terms.length ? '：' + terms.join('；') : '');
    }).filter(Boolean);
    if (stations.length) lines.push('業務路徑各站', ...stations);

    const cap = 6000, tail = '（其餘從略）', kept = [];
    let total = 0;
    for (const line of lines) {
      const next = total + (kept.length ? 1 : 0) + line.length;
      if (next <= cap) { kept.push(line); total = next; continue; }
      while (kept.length && total + 1 + tail.length > cap) {
        const removed = kept.pop();
        total -= removed.length + (kept.length ? 1 : 0);
      }
      if (total + (kept.length ? 1 : 0) + tail.length <= cap) kept.push(tail);
      return kept;
    }
    return kept;
  } catch { return []; }
}

// 標題只留文字、數字、空格及「-」，最多 30 字；空白就用「會議紀錄」
export function cleanTitle(t) {
  const s = String(t || '').replace(/[^\p{L}\p{N} -]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  return s || '會議紀錄';
}
// 草稿檔名「YYYY-MM-DD 標題（草稿）.md」；定稿去掉「（草稿）」；同名加「（2）」「（3）」。exists(name) 回 true 表示已被其他檔佔用
export function fileNameFor({ date, title, draft }, exists = () => false) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : '日期待定';
  const base = `${day} ${cleanTitle(title)}`;
  for (let n = 1; n < 100; n++) {
    const name = base + (n > 1 ? `（${n}）` : '') + (draft ? '（草稿）' : '') + '.md';
    if (!exists(name)) return name;
  }
  throw new Error('同名檔案太多');
}
export const finalNameOf = draftName => String(draftName).replace(/（草稿）\.md$/, '.md');

// 登記檔：ledger/minutes/<mid>.json；原檔及文字版放 ledger/minutes/<mid>/
export const recordPath = (DIR, mid) => path.join(DIR.ledger, 'minutes', mid + '.json');
export const sourceDir = (DIR, mid) => path.join(DIR.ledger, 'minutes', mid);
export function readMinutes(DIR, mid) {
  if (!validId(mid)) return null;
  return readJSON(recordPath(DIR, mid), null);
}
// 欄位擁有權（伺服器與外殼是兩個程序，同時寫同一份登記檔）：每方只可改自己的欄位，狀態轉換亦分開。
// 伺服器 ready → drafting 只在草稿檔已不見時用（重新整理）；由伺服器核對檔案確實不在才可呼叫
export const OWNER = {
  server: { fields: ['state', 'title', 'meetingDate', 'sources', 'labels', 'speakers', 'version', 'versions', 'inputId', 'file', 'hash', 'suggest', 'createdAt', 'id', 'error'], moves: [['speakers', 'drafting'], ['failed', 'drafting'], ['ready', 'drafting'], ['ready', 'submitted'], ['submitted', 'ready']] },
  shell: { fields: ['state', 'suggest', 'file', 'hash', 'error'], moves: [['drafting', 'ready'], ['drafting', 'failed']] }
};
const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// 寫檔：每個寫入者用自己的暫存檔名（不與其他程序共用同一個 .tmp），再改名覆蓋；Windows 改名被暫時拒絕就等一陣再試
function writeOwn(file, obj) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) { if (i >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { try { fs.rmSync(tmp, { force: true }); } catch { } throw e; } sleepMs(25); }
  }
}
// 跨程序鎖：「讀取 → 核對狀態 → 合併 → 寫入」整段在鎖內做；鎖檔超過 10 秒當作遺留（寫入程序已中斷）並清走
function withLock(DIR, mid, fn) {
  const lock = recordPath(DIR, mid) + '.lock';
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let fd = null;
  for (let i = 0; i < 200 && fd === null; i++) {
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { force: true }); } catch { }
      sleepMs(10);
    }
  }
  if (fd === null) throw new Error('會議登記檔正被其他程序寫入，請稍後再試');
  try { return fn(); }
  finally { try { fs.closeSync(fd); } catch { } try { fs.rmSync(lock, { force: true }); } catch { } }
}
// 保留新會議編號：以獨佔方式建立原檔資料夾（已有就換下一毫秒的編號再試），所以兩次同時預檢不會共用同一個資料夾。
// 回傳的資料夾只屬這次預檢，失敗時可以整個刪走，不會刪到其他會議
export function reserveMinutesId(DIR) {
  fs.mkdirSync(path.join(DIR.ledger, 'minutes'), { recursive: true });
  for (let i = 0; i < 50; i++) {
    const id = newMinutesId(new Date());
    try { fs.mkdirSync(sourceDir(DIR, id)); if (!fs.existsSync(recordPath(DIR, id))) return id; fs.rmdirSync(sourceDir(DIR, id)); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    sleepMs(2);
  }
  throw new Error('未能建立會議編號，請稍後再試');
}
// 新建登記檔（只供伺服器預檢用；編號要先經 reserveMinutesId 保留）：獨佔建立，已有同名登記檔就拋錯，不覆蓋
export function createMinutes(DIR, rec) {
  if (!rec || !validId(rec.id) || rec.state !== 'speakers') throw new Error('會議登記檔格式不正確');
  fs.mkdirSync(path.join(DIR.ledger, 'minutes'), { recursive: true });
  const body = JSON.stringify({ ...rec, createdAt: rec.createdAt || localIso(), updatedAt: localIso() }, null, 2);
  try { fs.writeFileSync(recordPath(DIR, rec.id), body, { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') throw new Error('會議編號重複'); throw e; }
  return readMinutes(DIR, rec.id);
}
// 合併寫入：在跨程序鎖內重讀最新登記檔再淺合併 patch，不會用舊副本蓋掉對方剛寫的欄位。
// who：'server' 或 'shell'；from：期望的現時狀態（不符就拋錯，不寫）；patch.state 與現時不同時要是 who 容許的轉換。
// suggest 只可由外殼寫入結果；伺服器只在預檢時設 { state:'running' }（經 createMinutes），或手動重試時設 running。
export function patchMinutes(DIR, mid, patch, { who, from } = {}) {
  const own = OWNER[who];
  if (!own) throw new Error('未知的寫入方');
  if (!validId(mid)) throw new Error('找不到這次會議');
  const bad = Object.keys(patch || {}).filter(k => !own.fields.includes(k));
  if (bad.length) throw new Error(`${who} 不可改 ${bad.join('、')}`);
  return withLock(DIR, mid, () => {
    const cur = readMinutes(DIR, mid);
    if (!cur) throw new Error('找不到這次會議');
    if (from && cur.state !== from) throw new Error(`會議狀態已是 ${cur.state}，不是 ${from}`);
    if (patch.state && patch.state !== cur.state && !own.moves.some(([a, b]) => a === cur.state && b === patch.state)) throw new Error(`${who} 不可把會議狀態由 ${cur.state} 轉為 ${patch.state}`);
    const next = { ...cur, ...patch, id: cur.id, updatedAt: localIso() };
    writeOwn(recordPath(DIR, mid), next);
    return next;
  });
}
// 未交出的會議（給「接下來」補救列）：新的排前
export function listOpen(DIR) {
  const dir = path.join(DIR.ledger, 'minutes');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(dir, f), null))
    .filter(r => r && validId(r.id) && r.state !== 'submitted')
    .map(r => ({ id: r.id, state: r.state, title: r.title || '', updatedAt: r.updatedAt || r.createdAt || '' }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
// 草稿或定稿檔的實際位置：所有讀、寫、改名、打開都要經這裏。
// 只接受單一檔名（.md）；「會議紀錄」資料夾本身及檔案都不可以是連結（junction／捷徑），實際位置必須就在「會議紀錄」內。
// 不合就拋錯；create：資料夾未有就建立。回傳絕對路徑（檔案可以未存在）
export function minutesFilePath(ROOT, DIR, name, { create = false } = {}) {
  const n = String(name || '');
  if (!n || n !== path.basename(n) || !/\.md$/i.test(n) || /[\\/:*?"<>|\x00-\x1f]/.test(n)) throw new Error('會議紀錄檔名不正確');
  const dir = minutesDir(ROOT, DIR);
  let st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (!st && create) { fs.mkdirSync(dir, { recursive: true }); st = fs.lstatSync(dir, { throwIfNoEntry: false }); }
  if (st && (st.isSymbolicLink() || !st.isDirectory())) throw new Error('「會議紀錄」資料夾不可以是連結');
  const norm = p => process.platform === 'win32' ? p.toLowerCase() : p;
  if (st) {
    const parentReal = fs.realpathSync.native(path.dirname(dir)), real = fs.realpathSync.native(dir);
    if (norm(real) !== norm(path.join(parentReal, path.basename(dir)))) throw new Error('「會議紀錄」資料夾不可以是連結');
  }
  const file = path.join(dir, n);
  const fst = fs.lstatSync(file, { throwIfNoEntry: false });
  if (fst && (fst.isSymbolicLink() || !fst.isFile())) throw new Error('會議紀錄檔不可以是連結');
  return file;
}
// 讀草稿或定稿全文（不存在或位置不合都回 null）
export function readMinutesFile(ROOT, DIR, rec) {
  try { return fs.readFileSync(minutesFilePath(ROOT, DIR, rec && rec.file), 'utf8'); } catch { return null; }
}
