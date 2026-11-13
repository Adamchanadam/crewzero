// 0.44.0 會議紀錄改版驗收（派工單 dispatch/brief-m1.md 第 2.1–2.5 節；分析 minutes-format-2026-11-12/fable-analysis.md「可推翻檢查」）。
// 用法：node minutes-v2-test.mjs <原型資料夾> <輸出資料夾> <port（不使用）> <假 adapter>
// 範圍：
//   - 網頁路徑：缺節草稿退回一次、最終存檔十節齊全且缺的節為「沒有」；引句不在逐字稿標 ⚠️。
//   - 對話路徑：node ask.mjs --check-minutes <紀錄檔> [--transcript <逐字稿>] [--print-fixed]：首行、退出碼、補好全文、不寫任何檔；
//     引句、待辦期限、講者多於參加者三項自動修正；新範本合格、舊七節合格。
//   - 交給 Zero：新檔名（<日期> <對象> 會議紀錄.md）當作會議紀錄、多於一份只取第一份、舊七節仍接受、新舊紀錄可「對照以往紀錄」。
// 不開伺服器，直接叫外殼 run.mjs（做法同 minutes-run-test.mjs）；所有暫存資料放在輸出資料夾內，不遞歸刪除任何資料夾。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';
import { certifyDirect } from '../lib/testkit.mjs';

const [PROTO, OUT, , ADAPTER] = process.argv.slice(2);
if (!PROTO || !OUT || !ADAPTER) throw new Error('缺少測試參數。');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const { oldInstall } = await import(pathToFileURL(path.join(HERE, '..', 'fixtures', 'old-install.mjs')).href);
const imp = file => import(pathToFileURL(path.join(PROTO, file)).href);
const lib = await imp('ask-lib.mjs');
const minutes = await imp('minutes-lib.mjs');
const results = [];
const ok = (name, pass, info = null) => results.push({ name, pass: !!pass, info: pass ? null : info });
const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const text = file => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };
const HEADINGS_V2 = ['會議資料', '參加者', '議題及討論要點', '已發生的事實', '對方的說法及承諾', '雙方決定', '待辦', '未定事項', '下次會議', '改動清單'];
const headingsOf = md => String(md || '').split(/\r?\n/).map(l => (/^##\s+(.+?)\s*$/.exec(l) || [])[1]).filter(Boolean);
const sectionOf = (md, title) => { const lines = String(md || '').split(/\r?\n/); const i = lines.findIndex(l => new RegExp('^##\\s+' + title + '\\s*$').test(l)); if (i < 0) return null; const rest = lines.slice(i + 1); const j = rest.findIndex(l => /^##\s+/.test(l)); return (j < 0 ? rest : rest.slice(0, j)).join('\n'); };
const dirsOf = data => ({ data, replies: path.join(data, 'founder', 'replies'), inbox: path.join(data, 'founder', 'inbox'), company: path.join(data, 'company'), archive: path.join(data, 'archive'), ledger: path.join(data, 'ledger'), answers: path.join(data, 'ledger', 'answers'), asks: path.join(data, 'asks'), sandbox: path.join(data, 'sandbox'), work: path.join(data, 'work') });
async function scenario(name, fn) { try { await fn(); } catch (error) { ok(name + '：情景中斷', false, String(error && error.stack || error)); } }

freshTestOut(OUT);
let seq = 0;
async function world(name) {
  const data = path.join(OUT, String(++seq).padStart(2, '0') + '-' + name);
  fs.mkdirSync(path.join(data, 'company'), { recursive: true });
  fs.mkdirSync(path.join(data, 'ledger'), { recursive: true });
  oldInstall(data, PROTO);
  const env = { ...process.env, SOS_DATA: data, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1', CZ_NO_WELCOME: '1' };
  const shell = (...a) => spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), ...a], { cwd: PROTO, env, encoding: 'utf8', timeout: 180000 });
  const DIR = dirsOf(data);
  shell('--type', 'rhythm', '--trigger', 'manual');
  for (const d of [DIR.asks, DIR.answers]) { try { for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true }); } catch { } }
  await certifyDirect(data, PROTO, ADAPTER);
  const stateFile = path.join(DIR.ledger, 'state.json');
  const s = read(stateFile, {});
  s.company = s.company || {}; s.company.actors = [{ id: 'pc-1', name: '陳經理', kind: 'partner', role: '採購' }];
  s.interviews = { ...(s.interviews || {}), nextOn: '2099-01-01' }; s.peopleSync = { for: 'test' }; s.rolesSync = { for: 'test' };
  fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  return { data, DIR, env, shell, state: () => read(stateFile, {}), save: v => fs.writeFileSync(stateFile, JSON.stringify(v, null, 2)), mode: m => fs.writeFileSync(path.join(data, 'fake-mode.txt'), m + '\n') };
}
const runsOf = W => (read(path.join(W.DIR.ledger, 'status.json'), { runs: [] }) || { runs: [] }).runs || [];
const latest = W => runsOf(W)[0] || null;
// 0.44.0 按日期逐項判斷：正常使用時伺服器必定在事件筆記機讀區寫明 date；沒有日期的事件屬「日期屬假定」。場景按「有日期、先後清楚」寫：預設 2026-11-12，舊會議另傳 2026-11-03。
function withDate(body, date) {
  const blocks = [...String(body).matchAll(/```json\n([\s\S]*?)\n```/g)];
  if (blocks.length === 1) return body.replace(blocks[0][0], '```json\n' + JSON.stringify({ date, ...JSON.parse(blocks[0][1]) }) + '\n```');
  return body + '\n\n```json\n' + JSON.stringify({ date }) + '\n```';
}
function note(W, id, type, body = '', date = '2026-11-12') { fs.mkdirSync(W.DIR.inbox, { recursive: true }); fs.writeFileSync(path.join(W.DIR.inbox, `${id}-note-${type}.md`), `kind: note\ntype: ${type}\nat: ${lib.localIso()}\n\n${type === 'event' || type === 'doc' ? withDate(body, date) : body}`); }
const TRANSCRIPT = ['00:01  Speaker 1', '我們會先核對首批數量。', '', '00:12  Speaker 2', '我會在11月17日前提供資料。', '', '00:24  Speaker 1', '請你確認負責人。', '', '00:36  Speaker 2', '首批大概二百件。', ''].join('\n');
function meeting(W, suffix) {
  const id = `m-2026-11-10-100000-${suffix}`;
  const folder = minutes.sourceDir(W.DIR, id); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'transcript.md'), TRANSCRIPT);
  minutes.createMinutes(W.DIR, { id, state: 'speakers', title: '首批安排', meetingDate: '2026-11-10', sources: [{ name: '逐字稿.txt', text: `ledger/minutes/${id}/transcript.md`, chars: TRANSCRIPT.length }], labels: [{ label: 'Speaker 1' }, { label: 'Speaker 2' }], suggest: { state: 'running', items: {} }, speakers: {}, version: 1, versions: [], inputId: '', error: '' });
  minutes.patchMinutes(W.DIR, id, { speakers: { 'Speaker 1': { kind: 'founder', name: '我' }, 'Speaker 2': { kind: 'actor', actorId: 'pc-1', name: '陳經理' } }, state: 'drafting' }, { who: 'server', from: 'speakers' });
  return id;
}
// 新範本（十節）合格樣本；parts 可覆蓋個別節的內容，值為 null 表示整節刪去
function v2(parts = {}) {
  const base = {
    會議資料: ['- 日期及時間：2026 年 11 月 10 日 10:00', '- 形式：面談', '- 紀錄來源：逐字稿'],
    參加者: ['- 我（創辦人）', '- 陳經理（採購）'],
    議題及討論要點: ['### 1. 首批數量', '', '- 陳經理提出首批大概二百件。'],
    已發生的事實: ['- 雙方已就首批數量會面。'],
    對方的說法及承諾: ['- 陳經理口頭表示會在下星期前提供資料「我會在11月17日前提供資料。」（只屬口頭表示）'],
    雙方決定: ['- 決定 1：先核對首批數量。'],
    待辦: ['- 待辦 1｜負責人：陳經理｜期限：2026 年 11 月 17 日｜事項：提供首批資料'],
    未定事項: ['- 未定 1：首批數量；尚欠對方書面確認。'],
    下次會議: ['- 沒有'],
    改動清單: ['- 沒有'],
    ...parts
  };
  const body = HEADINGS_V2.filter(h => base[h] !== null).flatMap(h => ['## ' + h, '', ...base[h], '']);
  const warn = body.join('\n').split('⚠️').length - 1, fill = body.join('\n').split('✏️').length - 1;
  return ['# 會議紀錄：首批安排（2026 年 11 月 10 日）', '', `> ⚠️ 不肯定，請核對（共 ${warn} 處）　✏️ 待你補充（共 ${fill} 處）`, '', ...body].join('\n');
}
// 舊七節樣本；「對方口頭表示首批約二百件」是假 AI 事件建議引用的原句，放入令引句核對有對象（與 minutes-run-test 定稿樣本相同）
const V1 = ['# 會議紀錄：舊格式（2026 年 11 月 3 日）', '> ⚠️ 不肯定，請核對（共 0 處）　✏️ 待你補充（共 0 處）', '', '## 參加者', '', '創辦人、陳經理。', '', '## 已發生的事實', '', '雙方已會面。', '', '對方口頭表示首批約二百件。', '', '## 對方的說法及承諾', '', '- 陳經理表示原有條件維持不變，會按舊價供貨。', '', '## 雙方決定', '', '- 雙方確認安排。', '', '## 待辦', '', '- 陳經理：提供報價。', '', '## 未定事項', '', '- 仍待確認。', '', '## 改動清單', '', '沒有。', ''].join('\n');

/* ======================= 一、網頁路徑 ======================= */
await scenario('網頁路徑', async () => {
  const W = await world('web-missing');
  const id = meeting(W, '001');
  W.mode('minutes-draft:minutes-missing-section');
  note(W, id, 'minutes-draft'); W.shell();
  const rec = minutes.readMinutes(W.DIR, id);
  const draft = rec && rec.file ? text(path.join(minutes.minutesDir(PROTO, W.DIR), rec.file)) : '';
  const run = latest(W), job = run ? read(path.join(W.DIR.sandbox, run.id, 'job.json'), {}) : {};
  ok('MV2-01 網頁路徑缺節草稿：退回 AI 修正一次（修正指示列出缺「下次會議」）', job.type === 'minutes-draft-repair' && JSON.stringify(job.errors || []).includes('下次會議'), { job, run: run && [run.id, run.state] });
  ok('MV2-02 網頁路徑修正後仍缺：由程式補好存檔，十節齊全、次序正確，缺的節為「沒有」', rec?.state === 'ready' && JSON.stringify(headingsOf(draft)) === JSON.stringify(HEADINGS_V2) && /^-\s*沒有\s*$/m.test(sectionOf(draft, '下次會議') || ''), { state: rec && rec.state, error: rec && rec.error, headings: headingsOf(draft), next: sectionOf(draft, '下次會議') });
  const W2 = await world('web-default');
  const id2 = meeting(W2, '002');
  note(W2, id2, 'minutes-draft'); W2.shell();
  const rec2 = minutes.readMinutes(W2.DIR, id2), d2 = rec2 && rec2.file ? text(path.join(minutes.minutesDir(PROTO, W2.DIR), rec2.file)) : '';
  ok('MV2-03 網頁路徑預設草稿：十節齊全，待辦為「待辦 N｜負責人：…｜期限：…｜事項：…」格式', rec2?.state === 'ready' && JSON.stringify(headingsOf(d2)) === JSON.stringify(HEADINGS_V2) && (sectionOf(d2, '待辦') || '').split(/\r?\n/).filter(l => /^-\s/.test(l) && !/^-\s*沒有/.test(l)).every(l => /^-\s*待辦\s*\d+｜負責人：[^｜]+｜期限：[^｜]+｜事項：.+/.test(l)), { state: rec2 && rec2.state, headings: headingsOf(d2), todo: sectionOf(d2, '待辦') });
  const W3 = await world('web-bad-quote');
  const id3 = meeting(W3, '003');
  W3.mode('minutes-draft:minutes-bad-quote');
  note(W3, id3, 'minutes-draft'); W3.shell();
  const rec3 = minutes.readMinutes(W3.DIR, id3), d3 = rec3 && rec3.file ? text(path.join(minutes.minutesDir(PROTO, W3.DIR), rec3.file)) : '';
  const sayLines = (sectionOf(d3, '對方的說法及承諾') || '').split(/\r?\n/).filter(l => /「[^」]+」/.test(l));
  const missing = sayLines.filter(l => { const q = (/「([^」]+)」/.exec(l) || [])[1] || ''; return !TRANSCRIPT.replace(/\s/g, '').includes(q.replace(/\s/g, '')); });
  // 假 AI 只在第一次交出壞引句；修正那一次已改好的話，必須見到確有退回修正（引句問題被查出），否則留下的壞引句要標 ⚠️
  const run3 = latest(W3), job3 = run3 ? read(path.join(W3.DIR.sandbox, run3.id, 'job.json'), {}) : {};
  const caught = missing.length > 0 ? missing.every(l => l.includes('⚠️')) : job3.type === 'minutes-draft-repair' && /引句/.test(JSON.stringify(job3.errors || []));
  ok('MV2-04 網頁路徑：引句不在逐字稿被查出（退回修正，或存檔時該項標 ⚠️）', rec3?.state === 'ready' && caught, { state: rec3 && rec3.state, lines: sayLines, job: job3 });
});

/* ======================= 二、對話路徑命令 ======================= */
await scenario('對話路徑命令', async () => {
  const W = await world('cli');
  const dir = path.join(OUT, 'cli-files');
  fs.mkdirSync(dir, { recursive: true });
  const tFile = path.join(dir, '逐字稿.txt');
  fs.writeFileSync(tFile, TRANSCRIPT);
  const T3 = TRANSCRIPT + '\n00:48  Speaker 3\n我是速遞公司的代表。\n';
  const t3File = path.join(dir, '逐字稿三人.txt'); fs.writeFileSync(t3File, T3);
  const snapshot = () => { const list = []; for (const root of [dir, W.data]) { (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const st = fs.statSync(p); list.push(p + '|' + st.size + '|' + st.mtimeMs); } } })(root); } return list.sort().join('\n'); };
  const check = (name, body, args = [], transcript = tFile) => {
    const f = path.join(dir, name); fs.writeFileSync(f, body);
    const r = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), '--check-minutes', f, ...(transcript ? ['--transcript', transcript] : []), ...args], { cwd: PROTO, env: W.env, encoding: 'utf8', timeout: 60000 });
    const out = String(r.stdout || ''), first = out.split(/\r?\n/)[0] || '';
    const fixed = out.includes('\n---\n') ? out.slice(out.indexOf('\n---\n') + 5) : '';
    return { status: r.status, out, first, fixed, err: String(r.stderr || '').slice(0, 400) };
  };
  const good = check('合格.md', v2());
  ok('MV2-10 新範本合格紀錄：首行「會議紀錄檢查：合格」，退出碼 0', good.first === '會議紀錄檢查：合格' && good.status === 0, good);
  const old = check('舊格式.md', V1);
  ok('MV2-11 舊七節紀錄：繼續被接受（合格，退出碼 0）', old.first === '會議紀錄檢查：合格' && old.status === 0, old);
  const before = snapshot();
  const missingBody = v2({ 下次會議: null });
  const miss = check('缺節.md', missingBody);
  ok('MV2-12 對話路徑缺節草稿：首行「會議紀錄檢查：有 N 項要修正」，退出碼 1，列出缺「下次會議」', /^會議紀錄檢查：有 \d+ 項要修正$/.test(miss.first) && miss.status === 1 && miss.out.includes('下次會議'), miss);
  const missFix = check('缺節.md', missingBody, ['--print-fixed']);
  ok('MV2-13 --print-fixed：印出補好的全文，十節齊全、缺的節為「沒有」', JSON.stringify(headingsOf(missFix.fixed)) === JSON.stringify(HEADINGS_V2) && /^-\s*沒有\s*$/m.test(sectionOf(missFix.fixed, '下次會議') || ''), { first: missFix.first, headings: headingsOf(missFix.fixed), fixed: missFix.fixed.slice(0, 800) });
  const after = snapshot();
  const changed = after.split('\n').filter(l => !before.split('\n').includes(l));
  ok('MV2-14 命令不寫任何檔（只多了測試自己寫入的紀錄檔）', changed.every(l => l.startsWith(path.join(dir, '缺節.md') + '|')), changed);
  const quote = check('引句.md', v2({ 對方的說法及承諾: ['- 陳經理口頭表示首批免費「我保證首批全部免費。」（只屬口頭表示）'] }), ['--print-fixed']);
  const qLine = (sectionOf(quote.fixed, '對方的說法及承諾') || '').split(/\r?\n/).find(l => l.includes('我保證首批全部免費')) || '';
  ok('MV2-15 引句不在逐字稿：列為要修正，補好後該項標 ⚠️', quote.status === 1 && qLine.includes('⚠️'), { first: quote.first, line: qLine, out: quote.out.slice(0, 600) });
  const due = check('期限.md', v2({ 待辦: ['- 待辦 1｜負責人：陳經理｜期限：2026 年 11 月 30 日｜事項：提供首批資料'] }), ['--print-fixed']);
  const dLine = (sectionOf(due.fixed, '待辦') || '').split(/\r?\n/).find(l => l.includes('待辦 1')) || '';
  ok('MV2-16 待辦期限在逐字稿找不到原文：列為要修正，補好後該行標 ⚠️', due.status === 1 && dLine.includes('⚠️'), { first: due.first, line: dLine });
  const spk = check('講者.md', v2(), ['--print-fixed'], t3File);
  const pSec = sectionOf(spk.fixed, '參加者') || '';
  ok('MV2-17 講者多於參加者：列為要修正，補好後參加者加一行 ✏️', spk.status === 1 && pSec.includes('✏️'), { first: spk.first, participants: pSec });
  const legend = check('說明行.md', v2().replace('（共 0 處）　✏️', '（共 5 處）　✏️'), ['--print-fixed']);
  ok('MV2-18 說明行數目與正文不符：由程式重寫', /^>\s*⚠️ 不肯定，請核對（共 0 處）/m.test(legend.fixed), { first: legend.first, fixed: legend.fixed.slice(0, 300) });
});

/* ======================= 三、交給 Zero（「發生了一件事」附件） ======================= */
await scenario('交給 Zero', async () => {
  const W = await world('event-new-name');
  const ref = 'R20261112-100000-newname';
  W.mode('event:event-term-minute');
  note(W, ref, 'event', '交出會議紀錄。');
  const body = v2({ 已發生的事實: ['- 雙方已就首批數量會面。', '- 晨霧冷萃禮盒下星期推出。'] });
  fs.writeFileSync(path.join(W.DIR.inbox, `${ref}-note-event-file-1-2026-11-12 綠園小館 會議紀錄.md`), body);
  W.shell();
  const input = (W.state().inputs || []).find(x => x.id === 'in-' + ref) || {}, run = latest(W);
  const sbFiles = run ? (() => { try { return fs.readdirSync(path.join(W.DIR.sandbox, run.id, 'files')); } catch { return []; } })() : [];
  ok('MV2-20 新檔名（<日期> <對象> 會議紀錄.md）交給 Zero：當作會議紀錄，工作資料夾命名為 files/會議紀錄.md', run?.state === 'done' && !!input.minutes && sbFiles.includes('會議紀錄.md'), { run: run && [run.id, run.state], minutes: input.minutes, files: sbFiles });
  ok('MV2-21 新檔名會議紀錄的引句核對生效（逐字出現的新名稱照常出題，minuteItems 有紀錄）', Array.isArray(input.minuteItems) && !!input.packId, { minuteItems: input.minuteItems, packId: input.packId });
  const W2 = await world('event-two-minutes');
  const ref2 = 'R20261112-100000-two';
  note(W2, ref2, 'event', '交出兩份會議紀錄。');
  fs.writeFileSync(path.join(W2.DIR.inbox, `${ref2}-note-event-file-1-2026-11-12 綠園小館 會議紀錄.md`), v2());
  fs.writeFileSync(path.join(W2.DIR.inbox, `${ref2}-note-event-file-2-2026-11-05 工房丙 會議紀錄.md`), v2({ 已發生的事實: ['- 第二份紀錄獨有的句子。'] }));
  W2.shell();
  const run2 = latest(W2), sb2 = run2 ? path.join(W2.DIR.sandbox, run2.id, 'files') : '';
  const f2 = sb2 ? (() => { try { return fs.readdirSync(sb2); } catch { return []; } })() : [];
  ok('MV2-22 多於一份會議紀錄：只有第一份當會議紀錄（files/會議紀錄.md），其餘當普通附件', f2.includes('會議紀錄.md') && !text(path.join(sb2, '會議紀錄.md')).includes('第二份紀錄獨有的句子') && f2.some(f => f !== '會議紀錄.md' && text(path.join(sb2, f)).includes('第二份紀錄獨有的句子')), { run: run2 && [run2.id, run2.state], files: f2 });
  const W3 = await world('event-v1');
  const ref3 = 'R20261112-100000-v1';
  // 假 AI 預設事件建議引用另一份樣本的句子；這裏用只按會議紀錄行出建議的模式，免得引句不符而令工作失敗
  W3.mode('event:event-context-idle');
  note(W3, ref3, 'event', '交出舊格式會議紀錄。');
  fs.writeFileSync(path.join(W3.DIR.inbox, `${ref3}-note-event-file-1-會議紀錄.md`), V1);
  W3.shell();
  const in3 = (W3.state().inputs || []).find(x => x.id === 'in-' + ref3) || {}, run3 = latest(W3);
  ok('MV2-23 舊七節格式的已存紀錄仍可交給 Zero（當作會議紀錄、工作完成）', run3?.state === 'done' && !!in3.minutes, { run: run3 && [run3.id, run3.state, run3.error], minutes: in3.minutes });
  // 對照以往紀錄：舊七節（以往）對新十節（今次）
  const W4 = await world('event-compare');
  const submit = (r, b, mode, meta, date) => { W4.mode('event:' + mode); note(W4, r, 'event', '交出會議紀錄。\n\n```json\n' + JSON.stringify({ minutes: meta }) + '\n```', date); fs.writeFileSync(path.join(W4.DIR.inbox, `${r}-note-event-file-1-會議紀錄.md`), b); W4.shell(); return (W4.state().inputs || []).find(x => x.id === 'in-' + r) || {}; };
  const oldIn = submit('R20261103-100000-old', V1, 'event-context-idle', { id: 'm-old', version: 1 }, '2026-11-03');
  const st = W4.state(); st.tasks = [...(st.tasks || []), { id: 'fu-old', title: '提供報價', dueAt: '2026-11-18', status: 'open', owner: 'founder', fromInput: oldIn.id, minutesSource: { id: 'm-old', line: '- 陳經理：提供報價。' } }]; W4.save(st);
  const nowIn = submit('R20261112-100000-now', v2({ 對方的說法及承諾: ['- 陳經理表示今次條件改為先付訂金「我會在11月17日前提供資料。」（只屬口頭表示）'] }), 'event-context-many', { id: 'm-now', version: 1 }, '2026-11-12');
  const ctx = latest(W4) ? text(path.join(W4.DIR.sandbox, latest(W4).id, 'context.md')) : '';
  ok('MV2-24 新舊紀錄可在「對照以往紀錄」配對（舊七節為以往、新十節為今次）', Array.isArray(nowIn.compare) && nowIn.compare.length > 0, { compare: nowIn.compare, context: ctx.slice(0, 500), run: latest(W4) && [latest(W4).state, latest(W4).error] });
});

fs.writeFileSync(path.join(OUT, 'minutes-v2-results.json'), JSON.stringify(results, null, 2));
for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n  實際：' + JSON.stringify(result.info).slice(0, 1500)));
console.log(`${results.filter(result => result.pass).length}/${results.length} passed`);
process.exitCode = results.every(result => result.pass) ? 0 : 1;
