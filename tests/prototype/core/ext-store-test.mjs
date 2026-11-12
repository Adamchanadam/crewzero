// 延伸功能讀寫層測試；所有資料只放系統暫存資料夾。
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../..');
// 參數次序與其他測試相同：<原型資料夾> <輸出資料夾>（2026-11-11 曾把原型資料夾當輸出資料夾整個刪去）
const PROTO = path.resolve(process.argv[2] || path.join(ROOT, 'prototypes', 'proofread'));
const OUT = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'cz-ext-store-')));
// 防線：輸出資料夾不可是原型資料夾、不可含程式檔或 git 資料，否則拒絕清除
if (OUT === PROTO || PROTO.startsWith(OUT + path.sep) || ['server.mjs', 'package.json', '.git'].some(f => fs.existsSync(path.join(OUT, f)))) { console.error('拒絕清除輸出資料夾：' + OUT); process.exit(2); }
const E = await import(pathToFileURL(path.join(PROTO, 'ext-store.mjs')).href);
const L = await import(pathToFileURL(path.join(PROTO, 'ext-lib.mjs')).href);
const results = [];
const ok = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail });
const now = '2026-11-11T10:00:00+00:00';
const DIR = { data: path.join(OUT, 'data'), ledger: path.join(OUT, 'data', 'ledger') };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
freshTestOut(OUT); fs.mkdirSync(DIR.ledger, { recursive: true });

const decl = (name, overdue = false) => ({
  format: 'crewzero.extension/1', guide: 1, name, about: '測試用延伸功能',
  tables: [{ id: 't1', label: '訂單', title: 'f1', due: 'f2', fields: [
    { id: 'f1', label: '名稱', type: 'text', required: true },
    { id: 'f2', label: '到期日', type: 'date' },
    { id: 'f3', label: '工序', type: 'stage', stages: [{ id: 's1', label: '處理中' }, { id: 's2', label: '完成' }] }
  ], summary: [{ label: overdue ? '延誤' : '未完成', rule: overdue ? 'overdue' : 'open' }], handoff: [] }]
});
const draft = { id: 'x-2026-11-11-100000-001', state: 'ready', from: 'template:orders', ask: '', base: decl('訂單生產進度'), baseRev: 1, sample: [], edits: { forRev: 1 }, revise: '', folder: '', sourceHash: '', error: '' };

const made = E.createDraft(DIR, draft, { now });
const edited = E.patchDraft(DIR, draft.id, { edits: { forRev: 1, labels: { f1: '訂單名稱' } } }, 'server', { expect: 'ready', now });
const preview = L.applyEdits(edited.draft?.base, edited.draft?.baseRev, edited.draft?.edits);
ok('範本草稿可建立及校對，只有伺服器欄位會改動', made.ok && edited.ok && preview.tables[0].fields[0].label === '訂單名稱');

const folder = E.folderNameFor(preview.name, new Set());
const named = E.patchDraft(DIR, draft.id, { folder }, 'server', { expect: 'ready', now });
const created = E.createExtension(PROTO, DIR, folder, preview);
const registered = created.ok && E.registerExtension(DIR, folder, preview, { now });
const enabled = E.patchDraft(DIR, draft.id, { state: 'enabled' }, 'server', { expect: 'ready', now });
ok('啟用依次寫入資料夾、宣告、登記及草稿狀態', named.ok && created.ok && registered?.state === 'enabled' && enabled.ok && E.readRegistry(DIR).items.some(item => item.folder === folder));

const added = E.rowWrite(PROTO, DIR, { folder, table: 't1', op: 'add', v: { f1: '訂單甲', f2: '2026-11-10', f3: 's1' } }, { now });
const sameRev = E.rowWrite(PROTO, DIR, { folder, table: 't1', op: 'update', id: added.row?.id, rev: 1, v: { f1: '訂單甲（已核對）' } }, { now });
const staleRev = E.rowWrite(PROTO, DIR, { folder, table: 't1', op: 'update', id: added.row?.id, rev: 1, v: { f1: '不應寫入' } }, { now });
ok('改一行的版本相同才接受，不同版本回資料已更新', added.ok && sameRev.ok && staleRev.error === 'stale' && staleRev.row?.v?.f1 === '訂單甲（已核對）');

const done = E.rowWrite(PROTO, DIR, { folder, table: 't1', op: 'update', id: added.row?.id, rev: 2, v: { f3: 's2' } }, { now });
const archived = E.archiveDone(PROTO, DIR, folder, 't1', { now });
const rowsAfterArchive = E.readExtensionRows(PROTO, DIR, folder, 't1');
ok('封存全部已完成的卡', done.ok && archived.ok && archived.changed === 1 && rowsAfterArchive.rows[0]?.archived === true);

const altered = JSON.parse(JSON.stringify(preview)); altered.tables[0].fields[2].stages = [{ id: 's1', label: '處理中' }, { id: 's3', label: '新工序' }]; altered.tables[0].retired = ['s2'];
const unarchivedAdd = E.rowWrite(PROTO, DIR, { folder, table: 't1', op: 'add', v: { f1: '未完成卡', f3: 's2' } }, { now });
const revision = E.revisionCheck(PROTO, DIR, folder, altered);
ok('仍有卡的工序不能刪除', unarchivedAdd.ok && revision.ok && !revision.checked.ok && revision.checked.errors.some(error => error.includes('仍有')), JSON.stringify({ unarchivedAdd, revision }));

const extRoot = L.extensionsDir(PROTO, DIR), sourceFile = path.join(extRoot, folder, 'extension.json');
const sourceText = fs.readFileSync(sourceFile, 'utf8');
fs.writeFileSync(sourceFile, sourceText + '\n');
const sourceChanged = hash(sourceText) !== hash(fs.readFileSync(sourceFile, 'utf8'));
fs.writeFileSync(sourceFile, sourceText);
ok('套用修改前可用 sourceHash 偵測本機已改動', sourceChanged);

const outside = path.join(OUT, 'outside'); let linkRejected = true;
try {
  fs.mkdirSync(outside, { recursive: true }); fs.symlinkSync(outside, path.join(extRoot, '連結功能'), 'junction');
  linkRejected = !E.listExtensions(PROTO, DIR).some(item => item.folder === '連結功能');
} catch { linkRejected = true; }
ok('連結資料夾不接受', linkRejected);

for (const [index, name] of ['甲', '乙', '丙', '丁'].entries()) {
  const nextFolder = E.folderNameFor(name, new Set(E.listExtensions(PROTO, DIR).map(item => item.folder)));
  const nextDecl = decl(name, index === 3); E.createExtension(PROTO, DIR, nextFolder, nextDecl); E.registerExtension(DIR, nextFolder, nextDecl, { now });
  E.rowWrite(PROTO, DIR, { folder: nextFolder, table: 't1', op: 'add', v: { f1: name, f2: index === 3 ? '2026-11-01' : '2026-12-01', f3: 's1' } }, { now });
}
const overview = E.extOverview(PROTO, DIR, '2026-11-11');
ok('公司現況摘要按過期優先、最多三行並保留其餘數目', overview.rows.length === 3 && overview.rows[0]?.name === '丁' && overview.rows.every(row => row.values.length <= 2) && overview.more === 2);

const passed = results.filter(result => result.pass).length;
for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.pass ? '' : `：${result.detail}`}`);
console.log(`\n${passed}/${results.length} 通過`);
process.exit(passed === results.length ? 0 : 1);
