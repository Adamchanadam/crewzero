// 示範帳本保護：示範有公司概覽同成頁確認，但帳本係手造（試行、已撤、觀察項）；記錄真實事件唔可以用公司概覽覆寫帳本
// 用法：node event-demo-test.mjs <原型資料夾> <輸出資料夾> <port> <假 adapter>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { usePass } from '../lib/testkit.mjs';
const [PROTO, OUT, PORT, ADAPTER] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
fs.rmSync(OUT, { recursive: true, force: true });
const DATA = path.join(OUT, 'data');
const { seedDemo } = await import(new URL('file:///' + path.join(PROTO, 'demo-seed.mjs').replace(/\\/g, '/')).href);
seedDemo(DATA, { copyCert: false });
const legacyDemo = path.join(OUT, 'legacy-demo');
fs.mkdirSync(path.join(legacyDemo, 'ledger'), { recursive: true });
fs.writeFileSync(path.join(legacyDemo, 'ledger', 'state.json'), JSON.stringify({ demo: true, company: { name: '從田間到餐桌' } }));
const migratedDemo = seedDemo(legacyDemo, { copyCert: false });
const migratedState = JSON.parse(fs.readFileSync(path.join(legacyDemo, 'ledger', 'state.json'), 'utf8'));
const repeatedDemo = seedDemo(legacyDemo, { copyCert: false });
ok('舊示範安裝自動換成月月鮮烘；重跑不重建', migratedDemo.created === true && migratedState.company?.name === '月月鮮烘' && repeatedDemo.created === false, { migratedDemo, name: migratedState.company?.name, repeatedDemo });
const realDemo = path.join(OUT, 'real-demo');
fs.mkdirSync(path.join(realDemo, 'ledger'), { recursive: true });
const realState = '{"company":{"name":"真實公司"}}';
fs.writeFileSync(path.join(realDemo, 'ledger', 'state.json'), realState);
const protectedDemo = seedDemo(realDemo, { copyCert: false });
ok('沒有 demo 標記的既有資料不刪除', protectedDemo.created === false && fs.readFileSync(path.join(realDemo, 'ledger', 'state.json'), 'utf8') === realState, protectedDemo);
const brokenDemo = path.join(OUT, 'broken-demo');
fs.mkdirSync(path.join(brokenDemo, 'ledger'), { recursive: true });
const brokenState = '{壞檔';
fs.writeFileSync(path.join(brokenDemo, 'ledger', 'state.json'), brokenState);
const protectedBrokenDemo = seedDemo(brokenDemo, { copyCert: false });
ok('損壞的既有資料不刪除', protectedBrokenDemo.created === false && fs.readFileSync(path.join(brokenDemo, 'ledger', 'state.json'), 'utf8') === brokenState, protectedBrokenDemo);
// 獨立驗收必修 1：reset 亦不可刪除沒有示範標記的資料夾；連結及身份不明的非空資料夾一律拒絕
const refused = fn => { try { fn(); return ''; } catch (e) { return String(e && e.message || e); } };
const resetReal = refused(() => seedDemo(realDemo, { reset: true, copyCert: false }));
ok('reset 遇到沒有示範標記的資料夾：拒絕，資料原封不動', /沒有示範標記/.test(resetReal) && fs.readFileSync(path.join(realDemo, 'ledger', 'state.json'), 'utf8') === realState, resetReal);
const linkDemo = path.join(OUT, 'link-demo');
let linkMade = true; try { fs.symlinkSync(realDemo, linkDemo, 'junction'); } catch { linkMade = false; }
const resetLink = linkMade ? refused(() => seedDemo(linkDemo, { reset: true, copyCert: false })) : 'skip';
ok('reset 遇到連結（指向其他資料夾）：拒絕，目標資料原封不動（連結必須建立成功，否則此項未覆蓋）', linkMade && /連結/.test(resetLink) && fs.readFileSync(path.join(realDemo, 'ledger', 'state.json'), 'utf8') === realState, { linkMade, resetLink });
// 窄覆核必修：連結指向既有同名示範、沒有 reset，亦在任何寫入之前拒絕
const sameDemoLink = path.join(OUT, 'link-same-demo');
let sameLinkMade = true; try { fs.symlinkSync(DATA, sameDemoLink, 'junction'); } catch { sameLinkMade = false; }
const seedSameLink = sameLinkMade ? refused(() => seedDemo(sameDemoLink, { copyCert: true })) : 'skip';
ok('連結指向既有示範（沒有 reset）：一樣拒絕', sameLinkMade && /連結/.test(seedSameLink), { sameLinkMade, seedSameLink });
// 窄覆核必修：真實資料夾（程式的 data/）內尚未存在的路徑亦拒絕；只呼叫核對函數，不會寫入
const { assertDemoPlace } = await import(new URL('file:///' + path.join(PROTO, 'demo-seed.mjs').replace(/\\/g, '/')).href);
const insideData = path.join(PROTO, 'data', 'no-such-' + Date.now().toString(36), 'demo');
const placeInside = refused(() => assertDemoPlace(insideData));
ok('真實資料夾內尚未存在的路徑：拒絕', /真實資料夾/.test(placeInside) && !fs.existsSync(insideData), placeInside);
ok('真實資料夾本身及其上層（包括磁碟根目錄）：拒絕；示範資料夾：通過', /真實資料夾/.test(refused(() => assertDemoPlace(path.join(PROTO, 'data')))) && /真實資料夾/.test(refused(() => assertDemoPlace(PROTO))) && /真實資料夾/.test(refused(() => assertDemoPlace(path.parse(path.resolve(PROTO)).root))) && refused(() => assertDemoPlace(path.join(PROTO, 'demo-data'))) === '' && refused(() => assertDemoPlace(DATA)) === '', { root: refused(() => assertDemoPlace(path.parse(path.resolve(PROTO)).root)) });
// 窄覆核必修：沒有示範標記的既有資料，就算要求補抄認證亦不寫入任何檔案
const realFilesBefore = fs.readdirSync(path.join(realDemo, 'ledger')).join();
const realCopy = seedDemo(realDemo, { copyCert: true });
ok('沒有示範標記的既有資料：要求補抄認證亦不寫入', realCopy.created === false && fs.readdirSync(path.join(realDemo, 'ledger')).join() === realFilesBefore, { realCopy, files: fs.readdirSync(path.join(realDemo, 'ledger')) });
const loose = path.join(OUT, 'loose-folder');
fs.mkdirSync(loose, { recursive: true }); fs.writeFileSync(path.join(loose, 'notes.txt'), '創辦人的筆記');
const seedLoose = refused(() => seedDemo(loose, { copyCert: false }));
ok('身份不明的非空資料夾：不建立示範，原有檔案不動', /沒有示範標記/.test(seedLoose) && fs.readFileSync(path.join(loose, 'notes.txt'), 'utf8') === '創辦人的筆記' && !fs.existsSync(path.join(loose, 'ledger')), seedLoose);
// 開示範前 ask.mjs 會先建好空的資料夾骨架：只有空資料夾不算有內容，示範照常建立
const skeleton = path.join(OUT, 'skeleton-demo');
for (const d of ['archive', 'asks', 'company', 'founder/inbox', 'ledger/answers', 'work']) fs.mkdirSync(path.join(skeleton, d), { recursive: true });
const seedSkeleton = (() => { try { return seedDemo(skeleton, { copyCert: true }); } catch (e) { return String(e && e.message || e); } })();
ok('只有空資料夾骨架：示範照常建立', seedSkeleton && seedSkeleton.created === true && JSON.parse(fs.readFileSync(path.join(skeleton, 'ledger', 'state.json'), 'utf8')).demo === true, seedSkeleton);
// 獨立驗收必修 3：崗位啟用任務的交付草稿可以讀到全文
const roleArt = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'demo-shop', 'roles-artifact.json'), 'utf8'));
const roleReceipt = JSON.parse(fs.readFileSync(path.join(DATA, 'work', roleArt.runId, 'receipt.json'), 'utf8'));
ok('示範崗位交付草稿已建立：全文、收據、執行紀錄齊全', fs.readFileSync(path.join(DATA, 'work', roleArt.runId, roleArt.file), 'utf8') === roleArt.text && roleReceipt.artifacts[0].file === roleArt.file && fs.existsSync(path.join(DATA, 'work', roleArt.runId, 'run.json')), roleReceipt);
const before = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: ['ignore', 'pipe', 'pipe'] });
const get = async p => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
async function waitFor(fn, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(400); } return null; }
try {
  await usePass(BASE);
  await waitFor(async () => { try { return (await get('/api/status')).ok; } catch { return false; } }, 15000);
  await post('/api/setup', { action: 'certify', host: 'test' });
  await waitFor(async () => { const s = await get('/api/setup'); return s.certify && s.certify.state !== 'running'; });
  const sub = await post('/api/intake', { kind: 'note', type: 'event', text: '測試：工房甲書面確認供貨。', date: '2026-10-29' });
  ok('示範：真實事件收到', sub.code === 202, sub);
  const r = await waitFor(async () => (await get('/api/status')).runs.find(x => x.kind === 'note' && x.noteType === 'event' && x.state !== 'running'));
  ok('示範：AI 工作完成', r && r.state === 'done', r && { state: r.state, error: r.error });
  const s = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
  const ids = x => x.milestones.map(m => m.id + ':' + m.pathStatus + ':' + (m.watchItems || []).length + ':' + (m.trial ? 'trial' : '')).join(',');
  ok('示範帳本唔被公司概覽覆寫：站、試行、已撤、觀察項照舊；冇 ledgerFrom', ids(s) === ids(before) && !s.ledgerFrom && s.demo === true, { before: ids(before), after: ids(s), from: s.ledgerFrom });
  ok('示範：仍可記錄真實事件（輸入已登記）', (s.inputs || []).some(i => i.id === 'in-' + sub.j.id));
} catch (e) { ok('測試程式出錯', false, String(e && e.stack || e)); }
finally {
  srv.kill();
  const pass = results.filter(x => x.pass).length;
  for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + (x.pass ? '' : '\n      ' + JSON.stringify(x.info).slice(0, 900)));
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
