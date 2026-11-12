// --records：只讀匯出已確認業績及公司摘要。
// 用法：node records-test.mjs <原型資料夾> <暫存資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { freshTestOut } from '../lib/out-guard.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [PROTO = path.resolve(here, '../../../prototypes/proofread'), OUT] = process.argv.slice(2);
if (!OUT) throw new Error('需要系統暫存資料夾內的輸出資料夾');
const DATA = path.join(OUT, 'data'), ledger = path.join(DATA, 'ledger');
const results = []; const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };
const snapshot = root => {
  const out = {};
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file); else out[path.relative(root, file)] = fs.readFileSync(file, 'utf8'); } };
  walk(root); return out;
};
const record = (id, status, date) => ({ id, dir: 'in', amountCents: 250000, currency: 'HKD', date, counterpartId: 'pc-1', payer: '甲客戶', payerKey: '甲客戶', category: 'sales', what: '服務費', refund: false, evidence: [{ inputId: 'in-1', file: '收據.jpg', page: 1 }], source: 'receipt', importBatch: '', importKey: '', confirmedAt: '2026-11-10T10:00:00+08:00', confirmedBy: 'founder', status, voidedAt: status === 'void' ? '2026-11-10T11:00:00+08:00' : '', voidReason: status === 'void' ? '重複' : '', replaces: '' });

freshTestOut(OUT); fs.mkdirSync(ledger, { recursive: true });
write(path.join(DATA, 'company', 'page.json'), { company: { name: '測試公司', type: 'service' } });
write(path.join(ledger, 'state.json'), {
  schemaVersion: 1,
  company: { actors: [{ id: 'pc-1', name: '甲客戶', kind: 'customer', org: '甲公司', role: '採購', status: 'active' }] },
  milestones: [{ id: 'm1', short: '取得首張訂單', state: 'active', doneAt: '' }],
  goals: { quarter: { text: '本季收入目標', endsOn: '2026-12-31', target: { metric: 'income', amountCents: 500000, currency: 'HKD', from: '2026-11-01' }, progress: { current: 250000, ratio: 0.5 } } }
});
write(path.join(ledger, 'money.json'), { schema: 1, mainCurrency: 'HKD', records: [record('mn-2026-11-10-100000-001', 'confirmed', '2026-11-09'), record('mn-2026-11-10-100000-002', 'void', '2026-11-08')], importMaps: [], links: {}, mergedBatches: [], undoneBatches: [], balance: null });
write(path.join(DATA, 'asks', 'ask-waiting.json'), { id: 'ask-waiting', open: true, questions: [{ id: 'q-money-waiting', kind: 'money', money: { id: 'mn-waiting' } }] });
const before = snapshot(DATA);
const priorData = process.env.SOS_DATA;
let child;
try { process.env.SOS_DATA = DATA; child = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--records'], { cwd: PROTO, encoding: 'utf8', timeout: 30000 }); }
finally { if (priorData === undefined) delete process.env.SOS_DATA; else process.env.SOS_DATA = priorData; }
let out = null; try { out = JSON.parse(child.stdout); } catch { }
const after = snapshot(DATA);

ok('--records 只輸出可解析 JSON 且不寫檔', child.status === 0 && !!out && JSON.stringify(before) === JSON.stringify(after), { status: child.status, stdout: String(child.stdout || '').slice(0, 300), stderr: String(child.stderr || '').slice(0, 300) });
ok('--records 帶 schema、公司、人物、里程碑及目標欄位', out?.schema === 1 && out.company?.name === '測試公司' && out.company?.mainCurrency === 'HKD' && out.people?.[0]?.id === 'pc-1' && out.milestones?.[0]?.id === 'm1' && out.goal?.target?.metric === 'income', out);
ok('--records 只含已確認且未作廢的業績', out?.money?.records?.length === 1 && out.money.records[0].id === 'mn-2026-11-10-100000-001' && !JSON.stringify(out).includes('mn-2026-11-10-100000-002'), out?.money?.records);
ok('--records 帶最近十二個月指標而不帶待確認題', Array.isArray(out?.money?.months) && out.money.months.length === 12 && !JSON.stringify(out).includes('q-money-waiting') && !JSON.stringify(out).includes('mn-waiting'), out?.money?.months?.map(row => row.month));

const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + JSON.stringify(item.info).slice(0, 800)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
