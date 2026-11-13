// 業績檔案位置及唯一的容錯讀取入口；只讀檔案。
import fs from 'node:fs';
import path from 'node:path';
import { listPacks, loadAnswers, loadPack } from './ask-lib.mjs';
import { duplicateSourceOf, mergeMoney, validateBalance, validateRecord } from './money-lib.mjs';

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const asArray = value => Array.isArray(value) ? value : [];

// 回傳業績帳本各檔案及資料夾的位置。
export function moneyPaths(DIR) {
  const ledger = DIR?.ledger || '';
  const root = path.join(ledger, 'money');
  return {
    ledger, money: path.join(ledger, 'money.json'), pending: path.join(root, 'pending'),
    imports: path.join(root, 'imports'), evidence: path.join(root, 'evidence'), founderOps: path.join(ledger, 'founder-ops.json')
  };
}

function problem(problems, file, reason) { problems.push({ file: path.basename(file), reason }); }
function readObject(file, problems) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!plain(data)) { problem(problems, file, '格式不是物件'); return null; }
    return data;
  } catch (error) { problem(problems, file, error?.code === 'ENOENT' ? '讀不到檔案' : 'JSON 格式不符'); return null; }
}
function jsonFiles(dir, problems) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(item => item.isFile() && item.name.endsWith('.json')).map(item => path.join(dir, item.name)).sort(); }
  catch (error) { if (error?.code !== 'ENOENT') problem(problems, dir, '無法讀取資料夾'); return []; }
}
function founderBatchFiles(DIR, problems) {
  try {
    return fs.readdirSync(DIR.ledger).filter(file => /^\.founder-ops-\d+-\d+\.json$/.test(file))
      .sort((a, b) => (Number((/\.founder-ops-\d+-(\d+)\.json$/.exec(a) || [])[1]) || 0) - (Number((/\.founder-ops-\d+-(\d+)\.json$/.exec(b) || [])[1]) || 0) || a.localeCompare(b))
      .map(file => path.join(DIR.ledger, file));
  } catch (error) { if (error?.code !== 'ENOENT') problem(problems, DIR.ledger, '無法讀取創辦人操作資料夾'); return []; }
}

// 讀取一個匯入批次；讀不到或格式不符時以 problems 回報而不拋錯。
export function readImportBatch(DIR, id) {
  const problems = [];
  if (!/^[A-Za-z0-9._-]+$/.test(String(id || ''))) return { batch: null, problems: [{ file: String(id || ''), reason: '批次編號不正確' }] };
  const file = path.join(moneyPaths(DIR).imports, `${id}.json`);
  return { batch: readObject(file, problems), problems };
}

// 列出可讀的匯入批次，不把原始附件檔當成批次。
export function listImportBatches(DIR) {
  const problems = [], batches = [];
  for (const file of jsonFiles(moneyPaths(DIR).imports, problems)) {
    const batch = readObject(file, problems); if (batch) batches.push(batch);
  }
  return { batches, problems };
}

// 按固定次序讀取所有業績來源，再交給純合併函數處理。
export function readMoney(DIR) {
  const paths = moneyPaths(DIR), problems = [], ops = [], seenOps = new Set();
  const takeOps = file => {
    if (!fs.existsSync(file)) return;
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { problem(problems, file, 'JSON 格式不符'); return; }
    if (!Array.isArray(raw)) { problem(problems, file, '格式不是操作陣列'); return; }
    for (const op of raw) if (plain(op) && !(op.id && seenOps.has(op.id))) { ops.push(op); if (op.id) seenOps.add(op.id); }
  };
  takeOps(paths.founderOps); for (const file of founderBatchFiles(DIR, problems)) takeOps(file);

  const pending = [];
  for (const file of jsonFiles(paths.pending, problems)) { const record = readObject(file, problems); if (record) pending.push(record); }
  const batches = [];
  for (const file of jsonFiles(paths.imports, problems)) {
    const batch = readObject(file, problems); if (!batch) continue;
    if (batch.state === 'confirmed' || batch.state === 'undone') batches.push(batch);
  }
  let base = {};
  if (fs.existsSync(paths.money)) {
    const parsed = readObject(paths.money, problems);
    if (parsed) {
      const balance = parsed.balance !== undefined && parsed.balance !== null && !validateBalance(parsed.balance).ok ? null : parsed.balance;
      if (parsed.balance !== undefined && parsed.balance !== null && balance === null) problem(problems, paths.money, '現金結餘格式不符');
      if (!Array.isArray(parsed.records)) {
        problem(problems, paths.money, 'records 必須是陣列');
        base = { ...parsed, balance, records: [] };
      } else {
        const records = [];
        for (const record of parsed.records) {
          const checked = validateRecord(record);
          if (checked.ok) records.push(record);
          else problem(problems, paths.money, `紀錄格式不符：${checked.errors.join('；')}`);
        }
        base = { ...parsed, balance, records };
      }
    }
  }
  const merged = mergeMoney({ base, pending, batches, ops });
  for (const rejected of merged.rejected || []) {
    if (rejected.id === 'balance') problem(problems, paths.money, '現金結餘格式不符');
    else problem(problems, rejected.id || 'money', rejected.reason || '紀錄格式不符');
  }
  return { mainCurrency: merged.mainCurrency, records: merged.records, importMaps: merged.importMaps, links: merged.links, balance: merged.balance, problems };
}

// 收集已入帳及仍待創辦人確認的業績紀錄，供可能重複提示使用。
export function dupPool(DIR) {
  const pool = readMoney(DIR).records.filter(record => record?.status === 'confirmed').map(record => ({ record, where: 'ledger', source: duplicateSourceOf(record) }));
  let packs = [];
  try { packs = listPacks(DIR).map(summary => loadPack(DIR, summary.id)).filter(Boolean); } catch { return pool; }
  const latestByInput = new Map();
  for (const pack of packs) {
    const inputId = String(pack?.realEvent?.inputId || ''); if (!inputId) continue;
    const prior = latestByInput.get(inputId), rank = `${pack.askedAt || ''}\u0000${pack.id || ''}`;
    if (!prior || rank > prior.rank) latestByInput.set(inputId, { id: pack.id, rank });
  }
  for (const pack of packs) {
    const inputId = String(pack?.realEvent?.inputId || '');
    if (inputId && latestByInput.get(inputId)?.id !== pack.id) continue;
    const answers = loadAnswers(DIR, pack.id)?.answers || {};
    for (const question of asArray(pack.questions)) if (question?.kind === 'money' && !answers[question.id] && plain(question.money)) pool.push({ record: question.money, where: 'waiting', source: duplicateSourceOf(question.money) });
  }
  return pool;
}
