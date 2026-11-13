// 帳本寫入純函數測試（0.40.0）：逐行驗證 docs/evidence/v0400-ui-2026-11-07/backend-state-table.md 的純函數行
// （輸入舊狀態＋事件，輸出新狀態；不改傳入的狀態；冪等；失敗或拒絕時原樣返回）。不開伺服器、不開 AI、不連外網。
// 用法：node ledger-state-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [PROTO] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const ops = await import(pathToFileURL(path.join(PROTO, 'ledger-ops.mjs')).href);
const P = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const frozen = obj => JSON.stringify(obj);
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const style = N.styleIssues;

const base = () => ({ revision: 3, tasks: [{ id: 't1', title: '舊工作', owner: 'ai', status: 'planned' }], milestones: [{ id: 'm1', short: '第一站' }], company: { assumptions: [] },
  inputs: [{ id: 'in-old', via: 'event', title: '舊事', files: [], status: 'processed', effects: [{ targetKind: 'decision', targetId: 'p', change: '維持' }] }] });

// R1 登記輸入：文字版不列入 files[]，fileInfo 路徑改成封存後路徑
{
  const s0 = base(), before = frozen(s0);
  const meta = { source: 'chat', fileInfo: [{ name: 'X-note-event-file-01-報價.docx', text: 'X-note-event-file-01-報價.docx.md', convert: 'ok' }, { name: 'X-note-event-file-02-預算.xlsx', text: 'X-note-event-file-02-預算.xlsx.md', url: 'https://docs.google.com/spreadsheets/d/' + 'a'.repeat(30) + '/edit', readOn: '2026-11-07', kind: 'google-sheet', convert: 'ok' }], linkErrors: [{ url: 'https://docs.google.com/document/d/' + 'b'.repeat(30) + '/edit', kind: 'google-doc', reason: 'not-shared' }] };
  const names = ['X-note-event-file-01-報價.docx', 'X-note-event-file-01-報價.docx.md', 'X-note-event-file-02-預算.xlsx', 'X-note-event-file-02-預算.xlsx.md', 'X-note-event-file-03-合約.pdf'];
  const s1 = ops.registerInput(s0, { id: 'in-X', via: 'event', title: '真實事件', file: 'archive/2026-11/X-note-event.md', dir: 'archive/2026-11', names, eventDate: '2026-11-06', receivedAt: '2026-11-07T10:00:00+08:00', meta });
  const i = s1.inputs.find(x => x.id === 'in-X');
  ok('R1 不改傳入的舊狀態', frozen(s0) === before);
  ok('R1 files[] 只列原檔，不含轉文字版 .md', same(i.files, ['archive/2026-11/X-note-event-file-01-報價.docx', 'archive/2026-11/X-note-event-file-02-預算.xlsx', 'archive/2026-11/X-note-event-file-03-合約.pdf']), i.files);
  ok('R1 fileInfo 路徑改成封存後相對路徑，文字版、Google 網址、讀取日期、種類齊全', i.fileInfo.length === 2 && i.fileInfo[0].file === 'archive/2026-11/X-note-event-file-01-報價.docx' && i.fileInfo[0].text === 'archive/2026-11/X-note-event-file-01-報價.docx.md' && i.fileInfo[0].convert === 'ok' && i.fileInfo[1].kind === 'google-sheet' && i.fileInfo[1].readOn === '2026-11-07' && /^https:\/\/docs\.google\.com\//.test(i.fileInfo[1].url), i.fileInfo);
  ok('R1 來源 chat 與連結失敗原因寫入輸入', i.source === 'chat' && same(i.linkErrors.map(x => x.reason), ['not-shared']));
  ok('R1 其他輸入不動', same(s1.inputs.find(x => x.id === 'in-old'), s0.inputs[0]) && s1.tasks.length === 1);
  // R2 同編號重新登記不重複
  const s2 = ops.registerInput(s1, { id: 'in-X', via: 'event', title: '真實事件', file: 'archive/2026-11/X-note-event.md', dir: 'archive/2026-11', names, eventDate: '2026-11-06', receivedAt: '2026-11-07T10:00:00+08:00', meta });
  ok('R2 同一輸入重新登記：只有一項，內容相同', s2.inputs.filter(x => x.id === 'in-X').length === 1 && same(s2.inputs.find(x => x.id === 'in-X'), i));
  // 沒有說明檔（舊格式）：照舊
  const s3 = ops.registerInput(base(), { id: 'in-Y', via: 'doc', title: '文件', file: 'a/b.md', dir: 'a', names: ['Y-note-doc-file-01-甲.md'], eventDate: '2026-11-06', receivedAt: 't' });
  const y = s3.inputs.find(x => x.id === 'in-Y');
  ok('R2 沒有說明檔：照舊，沒有 fileInfo／source／linkErrors', same(y.files, ['a/Y-note-doc-file-01-甲.md']) && !('fileInfo' in y) && !('source' in y) && !('linkErrors' in y));
  // 說明檔含不合規欄位會被丟掉
  const m = ops.cleanMeta({ source: 'web', fileInfo: [{ name: 'a.docx', convert: 'weird', url: 'http://x', kind: 'x' }, { nope: 1 }], linkErrors: [{ url: 'https://docs.google.com/document/d/c', kind: 'google-doc', reason: 'boom' }] });
  ok('R2 說明檔不合規的來源、原因代碼、網址、種類一律丟掉', !('source' in m) && m.fileInfo.length === 1 && !('convert' in m.fileInfo[0]) && !('url' in m.fileInfo[0]) && !('kind' in m.fileInfo[0]) && m.linkErrors.length === 0, m);
}

// R3 recordReading
{
  const s0 = base(); s0.inputs.push({ id: 'in-R', via: 'event', title: 'R', files: [], status: 'unprocessed', effects: [] });
  const before = frozen(s0);
  const r = { summary: '測試摘要', grade: 'did', read: { summary: '讀了原話', highlights: [{ text: '十一月二十日前回覆', page: 2 }] }, reason: '', unreadable: [] };
  const s1 = ops.recordReading(s0, 'in-R', r);
  const i = s1.inputs.find(x => x.id === 'in-R');
  ok('R3 讀了甚麼與文件重點存入該輸入，不改舊狀態', frozen(s0) === before && i.summary === '測試摘要' && i.grade === 'did' && i.read.highlights[0].page === 2 && !('reason' in i) && !('unreadable' in i));
  const s2 = ops.recordReading(s0, 'in-R', { summary: '沒有影響', reason: '對方沒有做任何新的事。' });
  ok('R3 沒有影響的原因存入，沒有 read 時不留 read', s2.inputs.find(x => x.id === 'in-R').reason === '對方沒有做任何新的事。' && !('read' in s2.inputs.find(x => x.id === 'in-R')));
  ok('R3 找不到輸入：原樣返回', same(ops.recordReading(s0, 'in-none', r), s0));
}

// E1 addEffect：before／after，同一項不重複
{
  const s0 = base(); s0.inputs[0].effects = [];
  const e = { targetKind: 'assumption', targetId: 'H1', change: '「假設」由「口頭表示」改為「實際行動」', before: '口頭表示', after: '實際行動' };
  const s1 = ops.addEffect(s0, 'in-old', e), s2 = ops.addEffect(s1, 'in-old', e);
  ok('E1 效果帶 before／after', s1.inputs[0].effects.length === 1 && s1.inputs[0].effects[0].before === '口頭表示' && s1.inputs[0].effects[0].after === '實際行動');
  ok('E1 同一項做兩次不重複', same(s1, s2));
  const s3 = ops.addEffect(s0, 'in-old', { targetKind: 'decision', targetId: 'p', change: '維持不變' });
  ok('E1 沒有 before／after 時不寫這兩欄', !('before' in s3.inputs[0].effects[0]) && !('after' in s3.inputs[0].effects[0]));
}

// F1–F3 跟進日期
{
  const s0 = base(); s0.inputs.push({ id: 'in-F', via: 'event', title: 'F', files: [], status: 'awaitingFounder', effects: [], eventDate: '2026-11-06' });
  const before = frozen(s0);
  const args = { inputId: 'in-F', qid: 'q3', answer: 'accept', item: { date: '2026-11-20', action: '回覆甲餐廳的報價', station: 'm1', why: '會議紀錄寫明' }, now: '2026-11-07T10:00:00+08:00' };
  const s1 = ops.applyFollowUp(s0, args);
  const t = s1.tasks.find(x => x.id === ops.followUpTaskId('in-F', 'q3'));
  ok('F1 創辦人確認加入日程：寫一項創辦人行動，有 dueAt、owner、站點', frozen(s0) === before && t && t.owner === 'founder' && t.dueAt === '2026-11-20' && t.status === 'planned' && t.milestoneId === 'm1' && t.title === '回覆甲餐廳的報價', t);
  const fx = s1.inputs.find(x => x.id === 'in-F').effects;
  ok('F1 效果 targetKind 為 followUp，帶 dueAt 與前後狀態', fx.length === 1 && fx[0].targetKind === 'followUp' && fx[0].dueAt === '2026-11-20' && fx[0].before === '未排入日程' && /11 月 20 日/.test(fx[0].after) && fx[0].targetId === t.id, fx);
  const s2 = ops.applyFollowUp(s1, args);
  ok('F2 同一題做兩次：不重複加任務、不重複加效果', same(s1, s2) && s2.tasks.filter(x => x.id === t.id).length === 1);
  const sr = ops.applyFollowUp(s0, { ...args, answer: 'reject' });
  ok('F3 創辦人不加入：不寫任何任務，只記「沒有加入日程」', sr.tasks.length === s0.tasks.length && sr.inputs.find(x => x.id === 'in-F').effects.length === 1 && sr.inputs.find(x => x.id === 'in-F').effects[0].targetKind === 'decision' && /沒有加入日程/.test(sr.inputs.find(x => x.id === 'in-F').effects[0].change));
  ok('F3 拒絕後即使再答加入前的狀態也不留任務', !sr.tasks.some(x => String(x.id).startsWith('fu-')));
  const sb = ops.applyFollowUp(s0, { ...args, item: { ...args.item, station: 'm-nope' } });
  ok('F1 站點不存在：任務照加但不帶站點', sb.tasks.find(x => x.id.startsWith('fu-')) && !('milestoneId' in sb.tasks.find(x => x.id.startsWith('fu-'))));
  ok('F1 日期不合規或輸入不存在：原樣返回', same(ops.applyFollowUp(s0, { ...args, item: { ...args.item, date: '2026-13-40' } }), s0) && same(ops.applyFollowUp(s0, { ...args, inputId: 'in-zzz' }), s0));
}

// S1–S4 重新讀取快照
{
  const url = 'https://docs.google.com/spreadsheets/d/' + 'a'.repeat(30) + '/edit';
  const s0 = base(); s0.inputs.push({ id: 'in-G', via: 'event', title: 'G', files: ['archive/g/old.xlsx', 'archive/g/other.pdf'], fileInfo: [{ file: 'archive/g/old.xlsx', text: 'archive/g/old.xlsx.md', url, readOn: '2026-11-01', kind: 'google-sheet' }], status: 'processed', effects: [] });
  const before = frozen(s0);
  const fresh = { file: 'archive/g/old-r20261107-100000.xlsx', text: 'archive/g/old-r20261107-100000.xlsx.md', readOn: '2026-11-07' };
  const s1 = ops.refreshSnapshot(s0, { inputId: 'in-G', n: 0, fresh });
  const i = s1.inputs.find(x => x.id === 'in-G');
  ok('S1 重新讀取成功：files[n]、fileInfo 換成新快照，readOn 更新', frozen(s0) === before && i.files[0] === fresh.file && i.files[1] === 'archive/g/other.pdf' && i.fileInfo[0].file === fresh.file && i.fileInfo[0].text === fresh.text && i.fileInfo[0].readOn === '2026-11-07' && i.fileInfo[0].url === url, i);
  ok('S1 舊快照保留在 previous', same(i.fileInfo[0].previous, [{ file: 'archive/g/old.xlsx', text: 'archive/g/old.xlsx.md', readOn: '2026-11-01' }]), i.fileInfo[0].previous);
  ok('S2 同一次重新讀取做兩次：結果相同', same(ops.refreshSnapshot(s1, { inputId: 'in-G', n: 0, fresh }), s1));
  ok('S3 重新讀取失敗（沒有新快照）：舊快照及 readOn 不變', same(ops.refreshSnapshot(s0, { inputId: 'in-G', n: 0, fresh: null }), s0) && same(ops.refreshSnapshot(s0, { inputId: 'in-G', n: 0, fresh: { file: 'x', readOn: 'bad' } }), s0));
  ok('S4 不是 Google 附件（沒有網址）或序號不存在：原樣返回', same(ops.refreshSnapshot(s0, { inputId: 'in-G', n: 1, fresh }), s0) && same(ops.refreshSnapshot(s0, { inputId: 'in-G', n: 9, fresh }), s0));
}

// 核對函數（out/event.json 新欄位）
{
  const rd = ops.checkRead({ summary: '讀了原話及一份附件，對照了兩條假設。', highlights: [{ text: '會議紀錄寫明須在十一月二十日前回覆。', page: 3, file: '會議紀錄.pdf' }] }, { delivered: ['會議紀錄.pdf'], styleIssues: style });
  ok('C 核對 read：合格', rd.ok && rd.read.highlights[0].page === 3 && rd.read.highlights[0].file === '會議紀錄.pdf', rd);
  ok('C 核對 read：檔名不是今次附件、頁碼不是數字、缺 summary 都不合格', !ops.checkRead({ summary: 'x', highlights: [{ text: 'y', file: '假的.pdf' }] }, { delivered: ['真的.pdf'] }).ok && !ops.checkRead({ summary: 'x', highlights: [{ text: 'y', page: 'p3' }] }).ok && !ops.checkRead({ highlights: [] }).ok);
  ok('C 核對 read：含編號或內部用語不合格', !ops.checkRead({ summary: '假設 H2 升級了', highlights: [] }, { styleIssues: style }).ok);
  // 0.44.0：121–400 字由外殼截短（不退回修正），超過 400 字仍不合格
  ok('C 核對 reason：空白、超過 400 字、含編號不合格；稍長截至 120 字；合格則回傳', !ops.checkReason('', {}).ok && !ops.checkReason('長'.repeat(401), {}).ok && ops.checkReason('長'.repeat(121), {}).reason.length === 120 && !ops.checkReason('因為 H2 沒有變', { styleIssues: style }).ok && ops.checkReason('對方沒有做任何新的事。', { styleIssues: style }).reason === '對方沒有做任何新的事。');
  const fu = (it, extra = {}) => ops.checkFollowUpItem({ kind: 'followUp', why: '因為', ...it }, 'items 第 1 項', { eventDate: '2026-11-06', milestones: [{ id: 'm1' }], styleIssues: style, ...extra });
  ok('C 核對 followUp：合格', fu({ date: '2026-11-20', action: '回覆報價', station: 'm1' }).length === 0);
  ok('C 核對 followUp：日期格式、早於事件日、站點不存在、action 缺或含編號都不合格', fu({ date: '11-20', action: 'x' }).length && fu({ date: '2026-11-01', action: 'x' }).length && fu({ date: '2026-11-20', action: 'x', station: 'zz' }).length && fu({ date: '2026-11-20' }).length && fu({ date: '2026-11-20', action: '回覆 H2 的事' }).length);
}

// U1／U2 來源網址逐字核對與出處標註
{
  const answer = '政策見 https://www.edb.gov.hk/tc/sch-admin/admin/about-sch/procurement_procedures_in_aided_schs.html ，另見計劃書。';
  const good = { title: '你的答案', url: 'https://www.edb.gov.hk/tc/sch-admin/admin/about-sch/procurement_procedures_in_aided_schs.html', from: 'answer' };
  const bad = { title: '政策', url: 'https://www.edb.gov.hk/tc/sch-admin/admin/about-sch/procurement_procedures_in_aided_schools.html', from: 'answer' };
  const research = { title: '行業報告', url: 'https://example.org/不在原文內', readOn: '2026-11-07' };
  const r = ops.checkSourceUrls([good, bad, research], answer);
  ok('U1 抄錯的網址（schs → schools）被擋，抄對的與 Zero 自己上網查到的（沒有 from）不擋', !r.ok && r.bad.length === 1 && r.bad[0].index === 1, r);
  const fixed = ops.blankBadSourceUrls([good, bad, research], answer, N.ui.sourceUrlUnverified);
  ok('U1 仍不符：url 留空並加註「原文網址未能核對」，其他來源不動', !('url' in fixed[1]) && fixed[1].note === '原文網址未能核對' && fixed[0].url === good.url && fixed[2].url === research.url);
  ok('U1 附件來源（from: file）同樣逐字核對', !ops.checkSourceUrls([{ title: 't', url: 'https://a.example/x', from: 'file', file: '計劃書.docx' }], '附件文字內只有 https://a.example/y').ok && ops.checkSourceUrls([{ title: 't', url: 'https://a.example/y', from: 'file' }], '附件文字內只有 https://a.example/y').ok);
  const S = N.ui.sourceSearchOnly;
  ok('U2 出處自報：缺欄或 false 標「（只經搜尋摘要）」，true 不標，沒有網址不標', ops.fullTextSuffix({ url: 'https://x.example' }, S) === S && ops.fullTextSuffix({ url: 'https://x.example', fullText: false }, S) === S && ops.fullTextSuffix({ url: 'https://x.example', fullText: true }, S) === '' && ops.fullTextSuffix({ fullText: false }, S) === '');
}

// L 外部連結試開結果標註（純函數）
{
  const res = new Map([['https://a.example/x', { state: 'broken' }], ['https://b.example/y', { state: 'unknown', reason: 'timeout' }], ['https://c.example/z', { state: 'ok' }]]);
  const src = [{ source: '甲報告', url: 'https://a.example/x' }, { source: '乙報告', url: 'https://b.example/y' }, { source: '丙報告', url: 'https://c.example/z' }, { source: '沒有網址' }];
  const out = ops.annotateBrokenLinks(src, res, 'source', N.ui.linkBroken);
  ok('L1 只有明確打不開的標「連結未能開啟」；unknown、ok、沒有網址不標；網址不刪；不改傳入資料', out[0].source === '甲報告（連結未能開啟）' && out[0].url === 'https://a.example/x' && out[1].source === '乙報告' && out[2].source === '丙報告' && out[3].source === '沒有網址' && src[0].source === '甲報告');
  ok('L1 同一句不重複加；note 欄用「；」接', ops.annotateBrokenLinks(out, res, 'source', N.ui.linkBroken)[0].source === '甲報告（連結未能開啟）' && ops.annotateBrokenLinks([{ note: '已核對', url: 'https://a.example/x' }], res, 'note', N.ui.linkBroken)[0].note === '已核對；連結未能開啟');
}

// 名稱：新鍵為商用書面語，通過口語及術語檢查
{
  const keys = ['runEnd_asked', 'needOverviewAll', 'eventAwaitingNone', 'followUpAsk', 'followUpYes', 'followUpNo', 'followUpJudge', 'followUpDebrief', 'followUpDebriefWhy', 'fxFollowUpBefore', 'fxMsBefore', 'fxMsAfter', 'fxNextNone', 'sourceUrlUnverified', 'sourceSearchOnly', 'linkNotShared', 'tellNoOverview', 'tellDone', 'tellBadDraft', 'tellNoServer', 'briefNone', 'rereadBusy', 'rereadFailed', 'rereadOk', 'reqAwaiting', 'linkBroken'];
  const hits = keys.filter(k => typeof N.ui[k] !== 'string' || !N.ui[k]).concat(keys.filter(k => N.ui[k] && style(N.ui[k]).length).map(k => k + '*'));
  ok('N 新增名稱齊全且通過口語、術語、編號檢查', hits.length === 0, hits);
  ok('N 新收尾值顯示名為「已交你確認」', N.ui.runEnd_asked === '已交你確認');
}

// 人物及機構名單（後台）：新鍵為書面語；真實事件確認項目排序；每件事最多一個新對象；三項上限
{
  const people = await import(pathToFileURL(path.join(PROTO, 'people-ops.mjs')).href);
  const pb = Object.keys(N.ui).filter(k => k.startsWith('pb')), bad = pb.filter(k => style(String(N.ui[k]).replace(/\{\w+\}/g, '甲')).length);
  ok('P 名單新鍵（pb 開頭）齊全且通過口語、術語、編號檢查', pb.length >= 14 && !bad.length, bad);
  const it = k => ({ kind: k, id: k + Math.random() });
  const ordered = people.orderEventItems([it('nextAction'), it('followUp'), it('newActor'), it('milestone'), it('assumption')]);
  ok('P 確認項目次序：假設 ＞ 站點 ＞ 新對象 ＞ 跟進日期 ＞ 下一個對外動作；先排序再截三項', ordered.map(x => x.kind).join() === 'assumption,milestone,newActor', ordered.map(x => x.kind));
  ok('P 聯絡方式：用點、空格、括號、加號分隔的電話一律視為聯絡方式；一般名稱和機構不是', ['9123.4567', '9123 4567', '+852-9123-4567', '(852) 9123.4567', '９１２３４５６７'].every(x => people.hasContactInfo(x)) && !['陳經理', '乙餐廳', '第 3 組', '二〇二六年'].some(x => people.hasContactInfo(x)));
  { const st = { company: { actors: [{ id: 't', name: '林師傅', kind: 'team', role: '送貨', aliases: [], team: { type: 'parttime', state: 'active', owns: [] } }] }, milestones: [{ id: 'm1' }], tasks: [{ id: 'tk1' }] };
    ok('P 成員分工 owns 只准帳本已有的站點或工作編號', people.applyActorOp(st, 'actorTeam', { id: 't', team: { owns: ['m1', 'tk1'] } }).ok && !people.applyActorOp(st, 'actorTeam', { id: 't', team: { owns: ['chan@example.com'] } }).ok && !people.applyActorOp(st, 'actorTeam', { id: 't', team: { owns: ['91234567'] } }).ok && !people.applyActorOp(st, 'actorTeam', { id: 't', team: { owns: ['m-nope'] } }).ok); }
  { const page = { page: { id: 'p1' }, company: { name: 'X' }, sources: [{ id: 's1', title: '預算', date: '2026-10-01' }] }, fixed = JSON.parse(JSON.stringify(page));
    fixed.sources[0].url = 'https://example.org/x'; fixed.sources[0].urlBefore = 'https://old.example/'; fixed.sources[0].fixedOn = '2026-11-07';
    const oldAlgo = JSON.stringify(page);
    ok('A1 版本雜湊：略去來源的 url、urlBefore、fixedOn；沒有這三欄的舊頁面與 0.39.1 算法一致；其他欄位改變仍然改變雜湊', P.proofreadHash(fixed) === P.proofreadHash(page) && P.proofreadHash(page) === P.fnv(oldAlgo) && P.proofreadHash({ ...page, company: { name: 'Y' } }) !== P.proofreadHash(page) && P.proofreadHash({ ...page, sources: [{ ...page.sources[0], title: '改' }] }) !== P.proofreadHash(page)); }
  const two = people.orderEventItems([{ kind: 'newActor', id: 'a' }, { kind: 'newActor', id: 'b' }]);
  ok('P 兩個新對象只留一個', two.length === 1 && two[0].id === 'a', two);
}

const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
