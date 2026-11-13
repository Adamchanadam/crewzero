// 0.44.0 日期優先次序純函數測試：不開伺服器、不開 AI、不連外網。
// 用法：node date-precedence-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [PROTO, OUT] = process.argv.slice(2);
const proto = path.resolve(PROTO);
const out = path.resolve(OUT);
const NAMES = createRequire(import.meta.url)(path.join(proto, 'names.js'));
const ops = await import(pathToFileURL(path.join(proto, 'ledger-ops.mjs')).href);
const context = await import(pathToFileURL(path.join(proto, 'context-lib.mjs')).href);
const results = [];
const ok = (name, pass, info = null) => results.push({ name, pass: !!pass, info });
const same = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
const frozen = value => JSON.stringify(value);

try {
  // DP-01 至 DP-08：日期比較及無日期邊界。
  ok('DP-01 較新資料照常通過', ops.compareByDate({ basisDate: '2026-11-11', hasCurrent: true, currentDate: '2026-11-10' }).result === 'newer');
  ok('DP-02 較舊而不同的資料被識別', ops.compareByDate({ basisDate: '2026-11-09', hasCurrent: true, currentDate: '2026-11-10' }).result === 'olderDiffers');
  ok('DP-03 較舊而缺項提出補記', ops.compareByDate({ basisDate: '2026-11-09', hasCurrent: false, newestDate: '2026-11-10' }).result === 'olderMissing');
  ok('DP-04 同日資料並列處理', ops.compareByDate({ basisDate: '2026-11-10', hasCurrent: true, currentDate: '2026-11-10' }).result === 'sameDay');
  ok('DP-05 假定日期不當作較新', ops.compareByDate({ basisDate: '2026-11-10', basisAssumed: true, hasCurrent: true, currentDate: '2026-11-01' }).result === 'unknown');
  {
    const r = ops.compareByDate({ basisDate: '2026-02-30', hasCurrent: true, currentDate: '2026-11-01' });
    ok('DP-06 不存在的基準日期當作假定日期', r.result === 'unknown' && r.why === 'basisAssumed');
  }
  {
    const r = ops.compareByDate({ basisDate: '2026-11-10', hasCurrent: true, currentDate: '2026-11-01', currentAssumed: true });
    ok('DP-07 現有資料屬假定日期時不可比較', r.result === 'unknown' && r.why === 'currentUndated');
  }
  {
    const r = ops.compareByDate({ basisDate: '2026-11-10', hasCurrent: false });
    ok('DP-08 缺項而沒有較新事件時照常加入', r.result === 'newer' && r.why === 'noCurrent');
  }

  // DP-09 至 DP-13：個別說法日期必須有可核對的依據。
  ok('DP-09 個別日期不晚於事件日期時合格', ops.checkAsOf('2026-10-20', { eventDate: '2026-10-21' }) === '2026-10-20');
  ok('DP-10 個別日期晚於事件日期時丟棄', ops.checkAsOf('2026-10-22', { eventDate: '2026-10-21' }) === '');
  ok('DP-11 假定事件日期只有相對說法時丟棄個別日期', ops.checkAsOf('2026-10-20', { eventDate: '2026-10-21', dateAssumed: true, quote: '上星期曾經答應。' }) === '');
  ok('DP-12 假定事件日期但引句逐字有月日可接受', ops.checkAsOf('2026-10-20', { eventDate: '2026-10-21', dateAssumed: true, quote: '對方在 10 月 20 日確認。' }) === '2026-10-20');
  ok('DP-13 換算得出的個別日期一律丟棄', ops.checkAsOf('2026-10-20', { eventDate: '2026-10-21', why: '由下星期換算' }) === '');

  // DP-14：現有紀錄的日期來源次序，不可把寫入時間錯當依據。
  {
    const state = {
      company: {
        assumptions: [{ id: 'a1', grade: 'did', changedAt: '2026-11-04', changedAtAssumed: true }],
        nextExternalAction: { text: '寄出報價', basisDate: '2026-11-05', basisAssumed: true, founderUpdatedAt: '2026-11-20T10:00:00Z' }
      },
      inputs: [
        { id: 'in-minutes', eventDate: '2026-11-01', minutes: { id: 'm1' } },
        { id: 'in-from', eventDate: '2026-11-02' }
      ],
      tasks: [
        { id: 't-basis', basisDate: '2026-11-03', updatedAt: '2099-01-01T00:00:00Z' },
        { id: 't-minutes', minutesSource: { id: 'm1' }, updatedAt: '2099-01-01T00:00:00Z' },
        { id: 't-from', fromInput: 'in-from', updatedAt: '2099-01-01T00:00:00Z' },
        { id: 't-none', updatedAt: '2099-01-01T00:00:00Z' }
      ]
    };
    const checks = [
      ops.recordBasis(state, { kind: 'assumption', id: 'a1' }).date === '2026-11-04' && ops.recordBasis(state, { kind: 'assumption', id: 'a1' }).assumed,
      ops.recordBasis(state, { kind: 'nextAction' }).date === '2026-11-20' && !ops.recordBasis(state, { kind: 'nextAction' }).assumed,
      ops.recordBasis(state, { kind: 'task', id: 't-basis' }).date === '2026-11-03',
      ops.recordBasis(state, { kind: 'task', id: 't-minutes' }).date === '2026-11-01',
      ops.recordBasis(state, { kind: 'task', id: 't-from' }).date === '2026-11-02',
      ops.recordBasis(state, { kind: 'task', id: 't-none' }).date === ''
    ];
    ok('DP-14 現有日程按依據、會議、輸入順序取日，絕不使用 updatedAt', checks.every(Boolean), checks);
  }

  // DP-15：日期閘門的豁免、當日說法、相對日期及不改傳入資料。
  {
    const state = {
      company: { assumptions: [{ id: 'a1', grade: 'did', changedAt: '2026-11-10' }] },
      inputs: [
        { id: 'in-new', via: 'event', status: 'processed', eventDate: '2026-11-10' },
        { id: 'in-now', via: 'event', status: 'processed', eventDate: '2026-10-20', dateAssumed: true, minutes: { id: 'm-now' } }
      ],
      tasks: [
        { id: 't-same', title: '同一會議日程', dueAt: '2026-11-15', minutesSource: { id: 'm-now' } },
        { id: 't-old', title: '較新日程', dueAt: '2026-11-16', basisDate: '2026-11-10' }
      ]
    };
    const before = frozen(state);
    const revision = { kind: 'followUp', sameAsTask: 't-old', revisionOfTaskId: 't-x', date: '2026-11-22', action: '修訂日程', why: '原有日程要修訂。' };
    const sameMeeting = { kind: 'followUp', sameAsTask: 't-same', date: '2026-11-22', action: '同會議修訂', why: '原有日程要修訂。' };
    const older = { kind: 'assumption', id: 'a1', grade: 'said', asOf: '2026-10-20', sourceQuote: '對方在 10 月 20 日說明。', why: '原有說法。' };
    const relative = { kind: 'followUp', sameAsTask: 't-old', date: '2026-11-22', action: '換算日程', why: '由相對日期換算。' };
    const gated = ops.dateGate(state, state.inputs[1], [revision, sameMeeting, older, relative]);
    const note = gated.notes[0] || {};
    ok('DP-15 修訂與同會議來源豁免；較舊不同改為當日說法；假定事件的換算日程丟棄；不改 state',
      gated.items.includes(revision) && !('dated' in revision) && gated.items.includes(sameMeeting) && !('dated' in sameMeeting) &&
      !gated.items.includes(older) && note.kind === 'assumption' && note.said === 'said' && note.now === 'did' && note.source === 'meeting' &&
      gated.dropped.some(row => row.item === relative && row.reason === 'relative') && frozen(state) === before, gated);
  }

  // DP-16：寫入新日程時保留依據日期及假定標記，重做不重複。
  {
    const state = { inputs: [{ id: 'in-f', effects: [] }], tasks: [], milestones: [] };
    const before = frozen(state);
    const args = { inputId: 'in-f', qid: 'q1', answer: 'accept', item: { date: '2026-11-20', action: '回覆報價', why: '會議記錄。', basisDate: '2026-11-10', basisAssumed: true }, now: '2026-11-12T10:00:00Z' };
    const once = ops.applyFollowUp(state, args);
    const twice = ops.applyFollowUp(once, args);
    const task = once.tasks.find(row => row.id === ops.followUpTaskId('in-f', 'q1'));
    ok('DP-16 applyFollowUp 寫入依據日期、保持冪等且不改傳入 state', frozen(state) === before && task && task.basisDate === '2026-11-10' && task.basisAssumed === true && same(once, twice), task);
  }

  // DP-17：只有明確為真才留下日期屬假定標記。
  {
    const ev = { id: 'in-d', via: 'event', title: '事件', file: '', dir: '', names: [], eventDate: '2026-11-10', receivedAt: '2026-11-10T10:00:00Z' };
    const yes = ops.registerInput({}, { ...ev, dateAssumed: true }).inputs[0];
    const no = ops.registerInput({}, ev).inputs[0];
    ok('DP-17 registerInput 只在 dateAssumed 為真時寫入標記', yes.dateAssumed === true && !Object.hasOwn(no, 'dateAssumed'), { yes, no });
  }

  // DP-18：有今次日期時不交出之後會議及事件，仍保留相關未完成日程。
  {
    const actor = { id: 'a1', name: '陳經理', kind: 'partner', aliases: [] };
    const meeting = (id, inputId, date, words, effect) => ({
      id, inputId, date, speakers: { 陳: { kind: 'actor', actorId: 'a1', name: '陳經理' } },
      text: '# 會議紀錄\n\n## 參加者\n\n陳經理\n\n## 對方的說法及承諾\n\n- ' + words + '\n\n## 雙方決定\n\n- 雙方確認。',
      effects: [{ change: effect }]
    });
    const current = { inputId: 'in-current', meetingId: 'm-current', date: '2026-11-10', speakers: { 陳: { kind: 'actor', actorId: 'a1', name: '陳經理' } }, speakerCounts: { 陳: 1 } };
    const data = {
      actors: [actor], current,
      meetings: [meeting('m-old', 'in-old', '2026-11-09', '舊會議內容。', '舊會議確認。'), meeting('m-new', 'in-new', '2026-11-11', '較新會議內容。', '較新會議確認。')],
      inputs: [{ id: 'in-old', eventDate: '2026-11-09', minutes: { id: 'm-old' } }, { id: 'in-new', eventDate: '2026-11-11', minutes: { id: 'm-new' } }],
      events: [
        { id: 'e-old', eventDate: '2026-11-09', title: '陳經理舊事件', founderText: '陳經理舊事件。' },
        { id: 'e-new', eventDate: '2026-11-11', title: '陳經理較新事件', founderText: '陳經理較新事件。' }
      ],
      tasks: [{ id: 't-new', title: '較新日程仍保留', dueAt: '2026-11-20', owner: 'founder', status: 'open', minutesSource: { id: 'm-new' } }]
    };
    const filtered = context.buildMeetingContext(data);
    const noDate = context.buildMeetingContext({ ...data, current: { ...current, date: undefined } });
    const badDate = context.buildMeetingContext({ ...data, current: { ...current, date: '2026-02-30' } });
    ok('DP-18 只交出不晚於今次的會議及事件，日程照未過濾關聯；沒有有效今次日期時維持舊輸出',
      filtered.text.includes('舊會議內容。') && filtered.text.includes('舊會議確認。') && filtered.text.includes('陳經理舊事件。') &&
      !filtered.text.includes('較新會議內容。') && !filtered.text.includes('較新會議確認。') && !filtered.text.includes('陳經理較新事件。') &&
      filtered.text.includes('較新日程仍保留') && same(noDate, badDate), { filtered, noDate, badDate });
  }

  // DP-19：P2 使用的所有日期優先文字鍵已可用且符合顯示文字規範。
  {
    const keys = ['dpBasisNewer', 'dpBasisNoCurrent', 'dpBasisUndated', 'dpBasisSameDay', 'dpBasisAssumed', 'dpOlderNote', 'dpMissingAsk', 'dpMissingYes', 'dpMissingNo', 'dpMissingDone', 'dpLabelOlder', 'dpLabelNewer', 'dpLabelUnclear', 'dpCardTitle', 'dpAllOlderReason', 'dpApplyKept', 'dpNoDateContext', 'dpAsOfDropped'];
    const bad = keys.filter(key => typeof NAMES.ui[key] !== 'string' || !NAMES.ui[key] || NAMES.styleIssues(NAMES.ui[key].replace(/\{[^}]+\}/g, '甲')).length);
    ok('DP-19 日期優先文字鍵齊全且通過顯示文字檢查', bad.length === 0, bad);
  }

  // DP-20 至 DP-22：P2 所需的現值及逐項文件日期資料。
  {
    const state = { company: { nextExternalAction: { text: '寄出報價', basisDate: '2026-11-05', basisAssumed: true, founderUpdatedAt: '2026-11-08T10:00:00+00:00' } }, inputs: [{ id: 'in-doc', via: 'doc', eventDate: '2026-11-12' }], tasks: [] };
    const current = ops.recordBasis(state, { kind: 'nextAction' });
    ok('DP-20 下一個對外動作取 basisDate 與 founderUpdatedAt 較遲的日子', current.date === '2026-11-08' && current.assumed === false, current);
    const gated = ops.dateGate(state, state.inputs[0], [{ kind: 'nextAction', itemId: 'n1', text: '改為新報價', basisAssumedWhy: 'docUndated' }]);
    const dated = gated.items[0] && gated.items[0].dated;
    ok('DP-21 文件逐項日期假定保留原因並建議維持現有', dated && dated.result === 'unknown' && dated.why === 'docUndated' && dated.basisAssumed === true, dated);
    const applied = ops.applyFollowUp({ inputs: [{ id: 'in-doc', effects: [] }], tasks: [], milestones: [] }, { inputId: 'in-doc', qid: 'q1', answer: 'accept', item: { date: '2026-11-20', action: '回覆報價', basisDate: '2026-11-12', basisFrom: 'in-doc' }, now: '2026-11-12T10:00:00Z' });
    ok('DP-22 日程保留依據來源', applied.tasks[0] && applied.tasks[0].basisFrom === 'in-doc', applied.tasks[0]);
  }
} catch (error) {
  ok('DP 測試程式沒有拋錯', false, String(error && error.stack || error));
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'date-precedence-results.json'), JSON.stringify({ results }, null, 2) + '\n', 'utf8');
// 理由文字稍長由外殼截短，不退回修正（0.44.0 真實 AI 一批 R4）
{
  const long = '這張是供應商寄來的月結單，列出三張運單，' + '每張已由銀行自動轉帳。'.repeat(10);
  const cut = ops.checkReason(long), tooLong = ops.checkReason('甲'.repeat(401)), shortOk = ops.checkReason('這件事沒有影響。');
  ok('DP-90 理由 121–400 字截至 120 字內的句號；超過 400 字仍退回；短句照舊', cut.ok && cut.reason.length <= 120 && cut.reason.endsWith('。') && !tooLong.ok && shortOk.ok && shortOk.reason === '這件事沒有影響。', { cut, tooLong: tooLong.ok });
}

const pass =results.filter(row => row.pass).length;
for (const row of results) console.log((row.pass ? 'PASS ' : 'FAIL ') + row.name + (row.pass ? '' : '\n      ' + String(JSON.stringify(row.info)).slice(0, 900)));
console.log('\n' + pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
