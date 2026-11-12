// 會議紀錄共用模組（minutes-lib.mjs）純函數測試：位置、檔名、登記檔合併寫入及欄位擁有權。不開程序、不連網。
// 用法：node minutes-lib-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const [PROTO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../prototypes/proofread'), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-minutes-'))] = process.argv.slice(2);
const M = await import(pathToFileURL(path.join(PROTO, 'minutes-lib.mjs')).href);
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
const threw = fn => { try { fn(); return ''; } catch (e) { return String(e && e.message || e); } };
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });

// 位置：真實實例在項目資料夾下；其他實例在資料夾內；根目錄不建
const proj = path.join(OUT, 'proj'), root = path.join(proj, 'crewzero');
ok('真實實例：項目資料夾下的「會議紀錄」', M.minutesDir(root, { data: path.join(root, 'data') }) === path.join(proj, '會議紀錄'));
ok('測試實例：資料夾內的「會議紀錄」', M.minutesDir(root, { data: path.join(OUT, 'other') }) === path.join(OUT, 'other', '會議紀錄'));
const driveRoot = path.parse(path.resolve(OUT)).root, atRoot = path.join(driveRoot, 'crewzero-x');
ok('程式資料夾在磁碟根目錄：退回資料夾內，不在根目錄建資料夾', M.minutesDir(atRoot, { data: path.join(atRoot, 'data') }) === path.join(atRoot, 'data', '會議紀錄'));
ok('顯示位置不含絕對路徑', M.minutesShown(root, { data: path.join(root, 'data') }, 'a.md') === '項目資料夾／會議紀錄／a.md' && M.minutesShown(root, { data: path.join(OUT, 'o') }, 'a.md') === '資料夾／會議紀錄／a.md');

// 檔名：草稿、定稿、同名、清理標題
const taken = new Set(['2026-11-08 工房丙（草稿）.md']);
ok('草稿檔名；同名加（2）', M.fileNameFor({ date: '2026-11-08', title: '工房丙', draft: true }) === '2026-11-08 工房丙（草稿）.md' && M.fileNameFor({ date: '2026-11-08', title: '工房丙', draft: true }, n => taken.has(n)) === '2026-11-08 工房丙（2）（草稿）.md');
ok('定稿去掉（草稿）', M.finalNameOf('2026-11-08 工房丙（2）（草稿）.md') === '2026-11-08 工房丙（2）.md');
ok('標題只留文字、數字、空格及「-」；路徑符號清走；空白用「會議紀錄」', M.cleanTitle('../工房丙\\試供:*?') === '工房丙 試供' && M.cleanTitle('  ') === '會議紀錄' && !/[\\/:*?"<>|]/.test(M.fileNameFor({ date: 'x', title: 'a/b\\c', draft: true })));
ok('沒有會議日期：檔名寫「日期待定」', M.fileNameFor({ date: '', title: '工房丙', draft: false }) === '日期待定 工房丙.md');

// 已確認公司概覽名稱及用詞：只取 confirmed.values，兩條會議紀錄路線共用。
const clone = value => JSON.parse(JSON.stringify(value));
const overviewPage = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'example-company-page.json'), 'utf8'));
const overviewFields = page => [
  ...(page.detail.reading || []),
  ...(page.glance.rows || []),
  ...((page.path.milestones || []).flatMap(station => ['event', 'actor', 'witness', 'owner'].map(key => station[key]).filter(Boolean)))
];
const overviewConfirmed = page => ({ pageId: page.page.id, values: Object.fromEntries(overviewFields(page).filter(field => field && field.id).map(field => [field.id, field.value])) });
const overview = overviewConfirmed(overviewPage), overviewText = M.overviewLines(overviewPage, overview);
ok('L1 缺少公司概覽或確認值時不輸出；兩者齊備時包含公司名稱', M.overviewLines(overviewPage, null).length === 0 && M.overviewLines(null, overview).length === 0 && overviewText.includes('公司：月月鮮烘'), overviewText);
const l2Single = clone(overviewPage), l2SingleConfirmed = overviewConfirmed(l2Single);
l2SingleConfirmed.values['canvas-value'] = '長'.repeat(10000);
const l2SingleLine = M.overviewLines(l2Single, l2SingleConfirmed).find(line => line.startsWith('價值：')) || '';
const l2Many = clone(overviewPage);
l2Many.path.milestones = Array.from({ length: 40 }, (_, index) => ({ id: 'm-long-' + index, short: '長站 ' + index, event: { id: 'm-long-' + index + '-event', value: '長'.repeat(10000) } }));
const l2ManyConfirmed = overviewConfirmed(l2Many);
for (const id of Object.keys(l2ManyConfirmed.values)) l2ManyConfirmed.values[id] = '長'.repeat(10000);
const l2ManyLines = M.overviewLines(l2Many, l2ManyConfirmed), l2ManyText = l2ManyLines.join('\n');
ok('L2 每個確認值截短，總輸出不超過六千字並在整行邊界從略', l2SingleLine.length <= 210 && l2SingleLine.endsWith('…') && l2ManyText.length <= 6000 && l2ManyLines.at(-1) === '（其餘從略）', { line: l2SingleLine.length, total: l2ManyText.length, last: l2ManyLines.at(-1) });
ok('L3 名稱清單不印欄位編號', !/(?:canvas-value|g1|m1-e)/.test(overviewText.join('\n')), overviewText);
const l4Page = clone(overviewPage), l4Confirmed = overviewConfirmed(l4Page);
l4Confirmed.values['canvas-value'] = '星塵慢烘禮盒'; delete l4Confirmed.values['canvas-partners'];
l4Page.detail.reading.find(field => field.id === 'canvas-partners').value = '銀杏速遞行';
const l4Text = M.overviewLines(l4Page, l4Confirmed).join('\n');
ok('L4 十二格只印已確認值，不退回公司概覽原值', l4Text.includes('生意模式一覽') && l4Text.includes('星塵慢烘禮盒') && !l4Text.includes('銀杏速遞行'), l4Text);
const l5Page = clone(overviewPage), l5Confirmed = overviewConfirmed(l5Page);
l5Page.company.name = '待你補充'; l5Page.company.oneLiner = '不適用';
l5Confirmed.values['biz-type'] = '實體貨品';
for (const [index, field] of l5Page.detail.reading.filter(field => String(field.plan || '').startsWith('canvas.')).entries()) l5Confirmed.values[field.id] = index % 2 ? '待你補充' : '不適用';
const l5Text = M.overviewLines(l5Page, l5Confirmed).join('\n');
ok('L5 生意類型、公司名稱及一句話的待補充／不適用都略過；十二格全略過時不印小標題', !l5Text.includes('實體貨品') && !l5Text.includes('待你補充') && !l5Text.includes('不適用') && !l5Text.includes('生意模式一覽'), l5Text);
const l6WrongPage = { ...overview, pageId: '另一頁' }, l6NoPageId = { ...overview };
delete l6NoPageId.pageId;
ok('L6 確認頁面編號不同或缺少時，一律不輸出名稱清單', M.overviewLines(overviewPage, l6WrongPage).length === 0 && M.overviewLines(overviewPage, l6NoPageId).length === 0, { wrong: M.overviewLines(overviewPage, l6WrongPage), missing: M.overviewLines(overviewPage, l6NoPageId) });
const l7Array = { pageId: overviewPage.page.id, values: [] };
const l7Object = overviewConfirmed(overviewPage);
l7Object.values['canvas-value'] = { toString: null };
const l7NullBool = overviewConfirmed(overviewPage);
l7NullBool.values['canvas-value'] = null; l7NullBool.values['canvas-partners'] = false;
const l7Number = overviewConfirmed(overviewPage);
l7Number.values['canvas-value'] = 2026;
const l7PageTypes = clone(overviewPage), l7PageTypesConfirmed = overviewConfirmed(l7PageTypes);
l7PageTypes.company.name = 123; l7PageTypes.company.oneLiner = true; l7PageTypes.detail.reading.find(field => field.id === 'canvas-value').label = 456;
const l7Plan = clone(overviewPage), l7PlanConfirmed = overviewConfirmed(l7Plan);
l7Plan.detail.reading.find(field => field.id === 'canvas-value').plan = { toString: null };
const l7ObjectText = M.overviewLines(overviewPage, l7Object).join('\n'), l7NullBoolText = M.overviewLines(overviewPage, l7NullBool).join('\n'), l7NumberText = M.overviewLines(overviewPage, l7Number).join('\n'), l7PageTypesText = M.overviewLines(l7PageTypes, l7PageTypesConfirmed).join('\n');
ok('L7 格式錯誤不拋錯：values 陣列及壞 plan 回空；物件、null、布林及非字串頁面名稱／標籤不輸出；有限數字可用', threw(() => M.overviewLines(overviewPage, l7Array)) === '' && M.overviewLines(overviewPage, l7Array).length === 0 && threw(() => M.overviewLines(overviewPage, l7Object)) === '' && !l7ObjectText.includes('價值：') && threw(() => M.overviewLines(overviewPage, l7NullBool)) === '' && !l7NullBoolText.includes('價值：') && !l7NullBoolText.includes('false') && l7NumberText.includes('價值：2026') && !l7PageTypesText.includes('公司：123') && !l7PageTypesText.includes('一句話：true') && !l7PageTypesText.includes('456：') && threw(() => M.overviewLines(l7Plan, l7PlanConfirmed)) === '' && M.overviewLines(l7Plan, l7PlanConfirmed).length === 0, { object: l7ObjectText, nullBool: l7NullBoolText, number: l7NumberText, pageTypes: l7PageTypesText });
const l8Confirmed = overviewConfirmed(overviewPage), l8Secret = 'ghp_' + 'a'.repeat(20);
l8Confirmed.values['canvas-value'] = `星塵慢烘禮盒 demo@example.invalid C:\\demo\\offer.txt ${l8Secret} 9123 4567 8901`;
const l8Text = M.overviewLines(overviewPage, l8Confirmed).join('\n');
ok('L8 名稱清單清走電郵、電話、Windows 路徑及憑證樣式字串，保留產品名稱', l8Text.includes('星塵慢烘禮盒') && !l8Text.includes('demo@example.invalid') && !l8Text.includes('C:\\demo\\offer.txt') && !l8Text.includes(l8Secret) && !l8Text.includes('9123 4567 8901'), l8Text);
const l9Confirmed = overviewConfirmed(overviewPage);
l9Confirmed.values['canvas-value'] = '長'.repeat(250);
const l9Value = (M.overviewLines(overviewPage, l9Confirmed).find(line => line.startsWith('價值：')) || '').slice('價值：'.length);
ok('L9 每個輸出值連「…」最多 200 字', l9Value.length === 200 && l9Value.endsWith('…'), { length: l9Value.length, value: l9Value });
const l10Range = overviewConfirmed(overviewPage), l10DatePhone = overviewConfirmed(overviewPage);
l10Range.values['canvas-value'] = '星塵慢烘禮盒 2026-11-10 - 2026-11-24';
l10DatePhone.values['canvas-value'] = '2026-11-10 9123 4567 8901';
const l10RangeValue = (M.overviewLines(overviewPage, l10Range).find(line => line.startsWith('價值：')) || '').slice('價值：'.length);
const l10DatePhoneValue = (M.overviewLines(overviewPage, l10DatePhone).find(line => line.startsWith('價值：')) || '').slice('價值：'.length);
ok('L10 日期範圍原樣保留；日期旁電話清走', l10RangeValue === '星塵慢烘禮盒 2026-11-10 - 2026-11-24' && l10DatePhoneValue === '2026-11-10', { range: l10RangeValue, datePhone: l10DatePhoneValue });

// 登記檔：建立、合併寫入、擁有權、狀態轉換
const DIR = { data: path.join(OUT, 'data'), ledger: path.join(OUT, 'data', 'ledger') };
const mid = M.newMinutesId(new Date(2026, 10, 10, 9, 8, 7, 6));
ok('會議編號格式', mid === 'm-2026-11-10-090807-006' && M.validId(mid) && !M.validId('../x') && !M.validId('m-1'));
M.createMinutes(DIR, { id: mid, state: 'speakers', labels: [{ label: 'Speaker 1', samples: [] }], suggest: { state: 'running', items: {} }, speakers: {} });
ok('重複建立被拒', /重複/.test(threw(() => M.createMinutes(DIR, { id: mid, state: 'speakers' }))));
// 伺服器先寫講者，外殼後寫建議：外殼重讀最新檔，不會蓋掉講者
M.patchMinutes(DIR, mid, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' } } }, { who: 'server' });
M.patchMinutes(DIR, mid, { suggest: { state: 'done', items: { 'Speaker 1': { kind: 'founder' } } } }, { who: 'shell' });
const r1 = M.readMinutes(DIR, mid);
ok('合併寫入：外殼寫建議不會蓋掉伺服器剛寫的講者', r1.speakers['Speaker 1'].name === '我' && r1.suggest.state === 'done');
ok('外殼不可改講者、標題、版本', /不可改/.test(threw(() => M.patchMinutes(DIR, mid, { speakers: {} }, { who: 'shell' }))) && /不可改/.test(threw(() => M.patchMinutes(DIR, mid, { version: 2 }, { who: 'shell' }))));
ok('外殼不可把 speakers 轉為 drafting；伺服器可以', /不可把/.test(threw(() => M.patchMinutes(DIR, mid, { state: 'drafting' }, { who: 'shell' }))) && M.patchMinutes(DIR, mid, { state: 'drafting' }, { who: 'server', from: 'speakers' }).state === 'drafting');
ok('期望狀態不符：不寫', /不是 speakers/.test(threw(() => M.patchMinutes(DIR, mid, { title: 'x' }, { who: 'server', from: 'speakers' }))) && M.readMinutes(DIR, mid).title !== 'x');
ok('伺服器不可把 drafting 轉為 ready（只有外殼可以）', /不可把/.test(threw(() => M.patchMinutes(DIR, mid, { state: 'ready' }, { who: 'server' }))) && M.patchMinutes(DIR, mid, { state: 'ready', file: 'a（草稿）.md', hash: 'h' }, { who: 'shell', from: 'drafting' }).state === 'ready');
ok('ready → submitted → ready（修改會議紀錄）只由伺服器', M.patchMinutes(DIR, mid, { state: 'submitted', inputId: 'in-x' }, { who: 'server' }).state === 'submitted' && M.patchMinutes(DIR, mid, { state: 'ready', version: 2 }, { who: 'server' }).version === 2);
ok('未知寫入方被拒', /未知/.test(threw(() => M.patchMinutes(DIR, mid, {}, { who: 'page' }))));
ok('未交出清單：ready 在內，submitted 不在', (() => { const a = M.listOpen(DIR).map(x => x.id).includes(mid); M.patchMinutes(DIR, mid, { state: 'submitted' }, { who: 'server' }); return a && !M.listOpen(DIR).some(x => x.id === mid); })());
ok('讀檔只接受單一檔名', M.readMinutesFile(root, DIR, { file: '../ledger/state.json' }) === null);

// 獨立驗收必修 3：同一時間連續保留編號，每個都不同，各自有自己的原檔資料夾；登記檔獨佔建立
const ids = Array.from({ length: 30 }, () => M.reserveMinutesId(DIR));
ok('連續保留 30 個會議編號：全部不同，各有原檔資料夾', new Set(ids).size === 30 && ids.every(i => M.validId(i) && fs.existsSync(M.sourceDir(DIR, i))), ids.slice(0, 3));
M.createMinutes(DIR, { id: ids[0], state: 'speakers' });
ok('同一編號再建立登記檔：拒絕，不覆蓋', /重複/.test(threw(() => M.createMinutes(DIR, { id: ids[0], state: 'speakers', title: '覆蓋' }))) && M.readMinutes(DIR, ids[0]).title === undefined);

// 獨立驗收必修 4：兩個程序同時合併寫入（各寫自己的欄位各 40 次），最後兩方的欄位都在，沒有遺留暫存檔
const raceId = ids[1];
M.createMinutes(DIR, { id: raceId, state: 'speakers', suggest: { state: 'running', items: {} }, speakers: {} });
const worker = path.join(OUT, 'race-worker.mjs');
fs.writeFileSync(worker, `import { pathToFileURL } from 'node:url';
const [lib, data, ledger, mid, who] = process.argv.slice(2);
const M = await import(pathToFileURL(lib).href);
const DIR = { data, ledger };
for (let i = 0; i < 40; i++) M.patchMinutes(DIR, mid, who === 'server' ? { speakers: { ['Speaker ' + i]: { kind: 'other', name: '甲' + i } } } : { suggest: { state: 'running', items: { ['Speaker ' + i]: { kind: 'unknown' } } } }, { who });
M.patchMinutes(DIR, mid, who === 'server' ? { title: '伺服器完成' } : { error: '外殼完成' }, { who });
`);
const { spawn } = await import('node:child_process');
const runOne = who => new Promise(res => { const c = spawn(process.execPath, [worker, path.join(PROTO, 'minutes-lib.mjs'), DIR.data, DIR.ledger, raceId, who], { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; c.stderr.on('data', d => err += d); c.on('exit', code => res({ code, err })); });
const [rs, rh] = await Promise.all([runOne('server'), runOne('shell')]);
const raced = M.readMinutes(DIR, raceId);
const leftovers = fs.readdirSync(path.join(DIR.ledger, 'minutes')).filter(f => f.startsWith(raceId) && /\.tmp$|\.lock$/.test(f));
ok('兩個程序同時合併寫入：雙方最後寫入的欄位都在，沒有遺留暫存檔或鎖檔', rs.code === 0 && rh.code === 0 && raced.title === '伺服器完成' && raced.error === '外殼完成' && !!raced.speakers['Speaker 39'] && !!raced.suggest.items['Speaker 39'] && !leftovers.length, { rs: rs.err.slice(0, 200), rh: rh.err.slice(0, 200), title: raced.title, error: raced.error, leftovers });

// 獨立驗收必修 9：「會議紀錄」資料夾是連結時，一律拒絕讀寫
const TDIR = { data: path.join(OUT, 'tdata'), ledger: path.join(OUT, 'tdata', 'ledger') };
const elsewhere = path.join(OUT, 'elsewhere'); fs.mkdirSync(elsewhere, { recursive: true }); fs.writeFileSync(path.join(elsewhere, 'x.md'), '其他資料');
fs.mkdirSync(TDIR.data, { recursive: true });
let linked = true; try { fs.symlinkSync(elsewhere, path.join(TDIR.data, '會議紀錄'), 'junction'); } catch { linked = false; }
ok('「會議紀錄」是連結：拒絕，讀檔回 null（連結必須建立成功，否則此項未覆蓋）', linked && /連結/.test(threw(() => M.minutesFilePath(root, TDIR, 'x.md'))) && M.readMinutesFile(root, TDIR, { file: 'x.md' }) === null, { linked });
ok('檔名含路徑、非 .md、特殊符號：拒絕', ['../x.md', 'a/b.md', 'x.txt', 'a:b.md', ''].every(n => /檔名不正確/.test(threw(() => M.minutesFilePath(root, DIR, n)))));
ok('正常位置：可建立資料夾並回傳路徑', M.minutesFilePath(root, DIR, '2026-11-10 會議紀錄.md', { create: true }) === path.join(DIR.data, '會議紀錄', '2026-11-10 會議紀錄.md') && fs.existsSync(path.join(DIR.data, '會議紀錄')));

// 獨立驗收必修 11：草稿檔不見時，伺服器可由 ready 轉回 drafting 重新整理；外殼不可
const lost = ids[2]; M.createMinutes(DIR, { id: lost, state: 'speakers' });
M.patchMinutes(DIR, lost, { state: 'drafting' }, { who: 'server' }); M.patchMinutes(DIR, lost, { state: 'ready', file: 'x.md' }, { who: 'shell' });
ok('草稿檔不見：伺服器可由 ready 轉回 drafting；外殼不可', /不可把/.test(threw(() => M.patchMinutes(DIR, lost, { state: 'drafting' }, { who: 'shell' }))) && M.patchMinutes(DIR, lost, { state: 'drafting', error: '' }, { who: 'server', from: 'ready' }).state === 'drafting');

const pass = results.filter(x => x.pass).length;
for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + (x.pass ? '' : '\n      ' + JSON.stringify(x.info ?? '').slice(0, 400)));
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
