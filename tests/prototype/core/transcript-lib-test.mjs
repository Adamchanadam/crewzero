import assert from 'node:assert/strict';
import {
  applyMap,
  detect,
  formatMap,
  gate,
  parseMap,
  parseTurns,
  samples,
  marks,
  markLegend,
  unmappedIn,
} from '../../../prototypes/proofread/transcript-lib.mjs';

let passed = 0;
let total = 0;

function test(name, run) {
  total += 1;
  try {
    run();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(error.message);
  }
}

const iphone = `<!-- 月月鮮烘與工房丙 -->
0:05  Speaker 1
今日想談首三個月的供貨安排。
我們每月需要約兩百包。

0:12  Speaker 2
試供兩批的反應不錯。

（第 2 頁）
0:20  Speaker 1
請工房丙下周提供報價。

0:28  Speaker 2
我會整理三種包裝方案。

0:35  Speaker 1
也請標明最早交貨日期。`;

const fourTurns = `0:01  Speaker 1\n月月鮮烘。\n0:02  Speaker 1\n工房丙。\n0:03  Speaker 1\n試供。\n0:04  Speaker 1\n報價。`;
const oneNamed = `0:01  陳先生\n月月鮮烘。\n0:02  陳先生\n工房丙。\n0:03  陳先生\n試供。\n0:04  陳先生\n報價。\n0:05  陳先生\n下周。`;
const named = `0:01  陳先生\n月月鮮烘想訂貨。\n0:02  工房丙\n可以安排試供。\n0:03  陳先生\n請報價。\n0:04  工房丙\n會附交貨日期。\n0:05  陳先生\n下周確認。`;

test('iPhone 格式逐段解析', () => {
  const turns = parseTurns(iphone);
  assert.equal(turns.length, 5);
  assert.deepEqual(turns[0], {
    speaker: 'Speaker 1',
    generic: true,
    at: '0:05',
    text: '今日想談首三個月的供貨安排。 我們每月需要約兩百包。',
  });
  assert.equal(turns[2].text, '請工房丙下周提供報價。');
  assert.ok(!turns.some((turn) => turn.text.includes('第 2 頁')));
  assert.deepEqual(detect(iphone).turns, 5);
  assert.deepEqual(detect(iphone).stamps, 5);
});

test('逐字稿偵測與反例', () => {
  assert.equal(detect(iphone).transcript, true);
  assert.equal(detect('## 會議紀錄\n工房丙答應試供兩批。').transcript, false);
  assert.equal(detect(fourTurns).transcript, false);
  assert.equal(detect(oneNamed).transcript, false);
  assert.deepEqual(detect(iphone).generic, ['Speaker 1', 'Speaker 2']);
  assert.deepEqual(detect(named).named, ['陳先生', '工房丙']);
});

test('講者在前及括號時間', () => {
  const text = `Speaker 1 (00:05)\n月月鮮烘先問供貨。\nSpeaker 1 (00:12)\n工房丙答覆。\nSpeaker 1 (00:20)\n再談包裝。\nSpeaker 1 (00:28)\n提出送貨安排。\nSpeaker 1 (00:35)\n同意下周確認。`;
  assert.equal(detect(text).transcript, true);
  assert.deepEqual(detect(text).generic, ['Speaker 1']);
  assert.equal(parseTurns(text)[0].at, '00:05');
});

test('講者在前及空行結束段落', () => {
  const text = `Speaker 1  00:00:05\n月月鮮烘先問供貨。\n\n不應附入上一段。\nSpeaker 2  00:00:12\n工房丙答覆。`;
  const turns = parseTurns(text);
  assert.equal(turns[0].speaker, 'Speaker 1');
  assert.equal(turns[0].text, '月月鮮烘先問供貨。');
  assert.equal(turns[1].speaker, 'Speaker 2');
});

test('繁體中文通用標籤', () => {
  const text = `講者 1  00:05\n月月鮮烘提出試供。\n講者 1  00:12\n工房丙記下要求。\n講者 1  00:20\n雙方談報價。\n講者 1  00:28\n安排包裝。\n講者 1  00:35\n下周再聯絡。`;
  assert.deepEqual(detect(text).generic, ['講者 1']);
  assert.equal(detect(text).transcript, true);
});

test('簡體中文通用標籤', () => {
  const text = `发言人1  00:05\n月月鲜烘提出试供。\n发言人1  00:12\n工房丙记下要求。\n发言人1  00:20\n双方谈报价。\n发言人1  00:28\n安排包装。\n发言人1  00:35\n下周再联络。`;
  assert.deepEqual(detect(text).generic, ['发言人1']);
  assert.equal(detect(text).transcript, true);
});

test('Unknown Speaker 與具名講者分類', () => {
  const unknown = `0:05  Unknown Speaker\n月月鮮烘提出試供。\n0:12  Unknown Speaker\n工房丙記下要求。\n0:20  Unknown Speaker\n雙方談報價。\n0:28  Unknown Speaker\n安排包裝。\n0:35  Unknown Speaker\n下周再聯絡。`;
  assert.deepEqual(detect(unknown).generic, ['Unknown Speaker']);
  assert.deepEqual(detect(named).named, ['陳先生', '工房丙']);
  assert.equal(detect(named).transcript, true);
});

test('樣本次序、數目與截短', () => {
  assert.deepEqual(samples(iphone, 'Speaker 1', 2, 10), [
    '今日想談首三個月的供…',
    '請工房丙下周提供報價…',
  ]);
  assert.deepEqual(samples(iphone, 'Speaker 2', 3, 60), ['試供兩批的反應不錯。', '我會整理三種包裝方案。']);
  // 短句（嗯、OK）在有較完整句子時不作例句；不足時才補上，輸出保持原文次序
  const shorty = ['0:01  Speaker 1', '嗯。', '', '0:02  Speaker 1', 'OK', '', '0:03  Speaker 1', '我們每月需要約兩百包咖啡豆。', '', '0:04  Speaker 1', '對。', '', '0:05  Speaker 1', '下星期三前請報價給我們。'].join('\n');
  assert.deepEqual(samples(shorty, 'Speaker 1', 2), ['我們每月需要約兩百包咖啡豆。', '下星期三前請報價給我們。']);
  assert.deepEqual(samples(shorty, 'Speaker 1', 3), ['嗯。', '我們每月需要約兩百包咖啡豆。', '下星期三前請報價給我們。']);
});

test('講者對照格式與解析', () => {
  const map = { 'Speaker 1': '我自己（創辦人）', 'Speaker 2': '工房丙（烘焙師）' };
  assert.deepEqual(parseMap(formatMap(map)), map);
  const words = `前文\n講者對照: Speaker 1=我自己；Speaker 2=工房丙\n其他文字\n講者對照：Speaker 3＝包裝同事`;
  assert.deepEqual(parseMap(words), {
    'Speaker 1': '我自己',
    'Speaker 2': '工房丙',
    'Speaker 3': '包裝同事',
  });
});

test('全部對照才通過閘門', () => {
  const founder = '講者對照：Speaker 1＝月月鮮烘；Speaker 2＝工房丙';
  assert.deepEqual(gate(founder, [iphone]), { ok: true, missing: [], transcripts: 1 });
});

test('漏講者會由閘門列出', () => {
  assert.deepEqual(gate('講者對照：Speaker 1＝月月鮮烘', [iphone]), {
    ok: false,
    missing: ['Speaker 2'],
    transcripts: 1,
  });
});

test('沒有逐字稿不阻擋', () => {
  assert.deepEqual(gate('', ['## 會議紀錄\n工房丙會跟進。']), {
    ok: true,
    missing: [],
    transcripts: 0,
  });
});

test('兩份逐字稿合併講者', () => {
  const other = iphone.replaceAll('Speaker 1', 'Speaker 3').replaceAll('Speaker 2', 'Speaker 4');
  assert.deepEqual(gate('講者對照：Speaker 1＝月月鮮烘；Speaker 2＝工房丙；Speaker 3＝物流同事', [iphone, other]), {
    ok: false,
    missing: ['Speaker 4'],
    transcripts: 2,
  });
});

test('只在講者行套用對照', () => {
  const text = `0:05  Speaker 1\nSpeaker 1 提出試供兩批。\n0:12  Speaker 2\n工房丙同意報價。`;
  const applied = applyMap(text, { 'Speaker 1': '月月鮮烘', 'Speaker 2': '工房丙' });
  assert.ok(applied.includes('0:05  月月鮮烘'));
  assert.ok(applied.includes('Speaker 1 提出試供兩批。'));
  assert.ok(applied.includes('0:12  工房丙'));
});

test('會議紀錄不可遺留未對照標籤', () => {
  const map = { 'Speaker 1': '月月鮮烘', 'Speaker 2': '工房丙' };
  assert.deepEqual(unmappedIn('月月鮮烘表示已交貨；Speaker 3 表示日期待定。', map), ['Speaker 3']);
  assert.deepEqual(unmappedIn('月月鮮烘與工房丙確認下周交貨。', map), []);
});

test('四萬字四百段效能', () => {
  const body = '月月鮮烘與工房丙確認試供、報價、包裝、交貨及下周跟進安排。'.repeat(3);
  const large = Array.from({ length: 400 }, (_, index) => {
    const second = String(index % 60).padStart(2, '0');
    return `0:${second}  Speaker ${(index % 2) + 1}\n${body}`;
  }).join('\n\n');
  assert.ok(large.length >= 40_000);
  const checks = [
    () => detect(large),
    () => parseTurns(large),
    () => gate('講者對照：Speaker 1＝月月鮮烘；Speaker 2＝工房丙', [large]),
  ];
  for (const check of checks) {
    const started = performance.now();
    check();
    assert.ok(performance.now() - started < 200);
  }
});

test('草稿標示：⚠️ 及 ✏️ 的位置、所屬一節、原因；說明行不計；數目重算', () => {
  const draft = [
    '# 會議紀錄：工房丙試供安排（2026 年 11 月 8 日）',
    '',
    '> ⚠️ 不肯定，請核對（共 9 處）　✏️ 待你補充（共 9 處）',
    '',
    '## 對方的說法及承諾',
    '月結方面希望⚠️（聽不清：三十日或三十五日）三十日付款。',
    '',
    '## 待辦',
    '- 工房丙：提供報價；⚠️（由「下星期三」換算）2026 年 11 月 18 日。',
    '- 我方：確認首批數量；✏️（請補負責人）；✏（請補日期）日期待定。',
  ].join('\n');
  const list = marks(draft);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((m) => m.kind), ['unsure', 'unsure', 'fill', 'fill']);
  assert.deepEqual(list.map((m) => m.section), ['對方的說法及承諾', '待辦', '待辦', '待辦']);
  assert.equal(list[0].reason, '聽不清：三十日或三十五日');
  assert.equal(list[3].reason, '請補日期');
  assert.equal(list[2].line, 10);
  assert.equal(markLegend(draft), '> ⚠️ 不肯定，請核對（共 2 處）　✏️ 待你補充（共 2 處）');
  const fixed = draft.replace('⚠️（聽不清：三十日或三十五日）', '').replace('✏️（請補負責人）', '李家欣');
  assert.equal(markLegend(fixed), '> ⚠️ 不肯定，請核對（共 1 處）　✏️ 待你補充（共 1 處）');
  assert.deepEqual(marks('沒有任何標示的紀錄。'), []);
});

console.log(`${passed}/${total} 通過`);
process.exitCode = passed === total ? 0 : 1;
