// 商業模式卡共用模組測試。
// 用法：node model-cards-lib-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [PROTO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../../../prototypes/proofread'), OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-model-out-'))] = process.argv.slice(2);
void OUT;
const M = await import(pathToFileURL(path.join(PROTO, 'model-cards-lib.mjs')).href);
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info: pass ? undefined : info });
const copy = value => JSON.parse(JSON.stringify(value));
// 暫存副本放在測試輸出資料夾內（由 run-all 建立及清理），本測試不自行遞歸刪除（專案規則一）
const temp = path.join(OUT, 'lf-copy'); fs.mkdirSync(temp, { recursive: true });

try {
  const source = fs.readFileSync(path.join(PROTO, 'model-cards.md'), 'utf8');
  const lib = M.parseModelCards(source);
  const c01 = lib.byId.C01, c13 = lib.byId.C13, c25 = lib.byId.C25, s29 = lib.byId.S29;
  ok('parseModelCards：實際卡片檔完整解析', lib.ok && lib.problems.length === 0 && lib.cards.length === 26 && lib.cards.filter(card => card.face === 'charge').length === 12 && lib.cards.filter(card => card.face === 'form').length === 12 && lib.cards.filter(card => card.face === 'scale').length === 2 && lib.extras.length === 41 && lib.diagnostics.length === 16 && lib.metrics.length === 18, lib.problems);
  ok('parseModelCards：核心卡必要欄位及中英文名稱', lib.cards.every(card => card.fit.length && card.traps.length && card.firstTest) && c01.name === '訂閱制' && c01.en === 'Subscription' && lib.cards.find(card => card.name === '混合定價').en === '' && lib.extras.find(card => card.name === '一次性購買').en === '');
  const answers = { q1: c01.fit[0], q2: c13.fit[0], q3: c25.fit[0] };
  const pick = (card, quote, q) => ({ card: card.id, quote, src: { q, said: answers['q' + q] } });
  const valid = {
    name: '每月鮮豆安排', payer: '上班族按月付款取得咖啡豆。', why: '重複需求可先小規模驗證。',
    faces: { charge: [pick(c01, c01.fit[0], 1)], form: [pick(c13, c13.fit[0], 2)], scale: [pick(c25, c25.fit[0], 3)] },
    trap: { card: c01.id, text: c01.traps[0] }, firstTest: { card: c01.id, text: c01.firstTest, watch: '付款及續訂情況', counts: '只計實際付款。', zero: true }
  };
  ok('checkModelPick：實際卡原句的合格組合通過', M.checkModelPick(valid, lib, { answers }).ok, M.checkModelPick(valid, lib, { answers }));
  const invalid = (name, change, face) => { const value = copy(valid); change(value); const got = M.checkModelPick(value, lib, { answers }); ok('checkModelPick：' + name, !got.ok && (!face || got.problems.some(problem => problem.face === face)) && (face === 'model' || !!got.cleaned.faces[face || 'charge']), got); };
  invalid('不存在的卡號會刪去收錢卡', value => { value.faces.charge[0].card = 'C99'; }, 'charge');
  invalid('放錯面向會刪去收錢卡', value => { value.faces.charge[0] = pick(c13, c13.fit[0], 1); }, 'charge');
  invalid('核心卡引文改一字不合格', value => { value.faces.charge[0].quote = c01.fit[0].replace('再度', '再次'); }, 'charge');
  invalid('補充模式引文少於八字不合格', value => { value.faces.scale = [pick(s29, s29.when.slice(0, 7), 3)]; }, 'scale');
  invalid('創辦人原話不在答案內不合格', value => { value.faces.form[0].src.said = '答案沒有這句'; }, 'form');
  invalid('面向既無卡亦非未定不合格', value => { value.faces.scale = {}; }, 'scale');
  invalid('未定但未說欠甚麼不合格', value => { value.faces.scale = { undecided: true, missing: '' }; }, 'scale');
  invalid('核心卡陷阱非卡上原句不合格', value => { value.trap.text = '不是卡上的陷阱。'; }, 'charge');
  invalid('補充模式陷阱沒有 zero 不合格', value => { value.trap = { card: s29.id, text: 'Zero 建議的陷阱。' }; }, 'scale');
  invalid('第一個驗證沒有 zero 不合格', value => { value.firstTest.zero = false; }, 'charge');
  invalid('模式名稱含卡號不合格', value => { value.name = 'C01 訂閱安排'; }, 'model');
  // 接口文件 5.4「組合完整」：Zero 自寫（沒有卡號、zero: true）的陷阱及第一個驗證保留；沒有 zero 的刪去
  const zeroWritten = copy(valid); zeroWritten.trap = { text: '首批顧客只試一次便不再回來。', zero: true }; zeroWritten.firstTest = { text: '先向十位熟客收訂金試做一批。', watch: '付訂金人數', counts: '只計已付訂金', zero: true };
  const zw = M.checkModelPick(zeroWritten, lib, { answers });
  ok('checkModelPick：Zero 自寫的陷阱及第一個驗證保留', zw.ok && zw.cleaned.trap && zw.cleaned.trap.text === zeroWritten.trap.text && zw.cleaned.firstTest && zw.cleaned.firstTest.zero === true, zw);
  const noZero = copy(valid); noZero.trap = { text: '沒有標明是 Zero 建議的陷阱。' };
  const nz = M.checkModelPick(noZero, lib, { answers });
  ok('checkModelPick：沒有卡號又沒有 zero 的陷阱刪去', !nz.ok && !nz.cleaned.trap, nz);
  const twice = copy(valid); twice.faces.charge = [pick(c01, c01.fit[0], 1), pick(c01, c01.fit[1] || c01.fit[0], 1)];
  const tw = M.checkModelPick(twice, lib, { answers });
  ok('checkModelPick：同一面向重複的卡只保留一次', tw.cleaned.faces.charge.length === 1, tw.cleaned.faces.charge);
  const zeroCode = copy(valid); zeroCode.trap = { text: 'C01 的陷阱。', zero: true };
  ok('checkModelPick：Zero 自寫文字含卡號不合格', !M.checkModelPick(zeroCode, lib, { answers }).ok);
  const diagnosis15 = copy(valid); diagnosis15.diagnosis = Array.from({ length: 15 }, (_, index) => ({ n: index + 1, a: '是' }));
  ok('checkModelPick：診斷題只有十五項不合格', !M.checkModelPick(diagnosis15, lib, { answers, needDiagnosis: true }).ok);
  const diagnosisMaybe = copy(valid); diagnosisMaybe.diagnosis = Array.from({ length: 16 }, (_, index) => ({ n: index + 1, a: index === 0 ? '可能' : '否' }));
  ok('checkModelPick：診斷題使用可能不合格', !M.checkModelPick(diagnosisMaybe, lib, { answers, needDiagnosis: true }).ok);
  ok('sameSentence：全形空白、句末句號及頭尾空白不影響', M.sameSentence('　' + c01.fit[0] + '。 ', c01.fit[0]));
  ok('sameSentence：改一字即不同', !M.sameSentence(c01.fit[0], c01.fit[0].replace('再度', '再次')));
  const cleaned = M.checkModelPick(valid, lib, { answers }).cleaned;
  ok('cleaned：每張保留卡均有中文名稱', Object.values(cleaned.faces).flatMap(face => Array.isArray(face) ? face : []).every(card => !!card.name));
  ok('cardLabel：不存在的卡回傳空字串', M.cardLabel('C99', lib) === '');
  const lf = path.join(temp, 'model-cards.md');
  fs.writeFileSync(lf, source.replace(/\r\n/g, '\n'), 'utf8');
  const lfLib = M.loadModelCards(temp);
  ok('loadModelCards：LF 副本與 CRLF 卡片解析相同', lfLib.ok && lfLib.cards.length === lib.cards.length && lfLib.extras.length === lib.extras.length && lfLib.diagnostics.length === lib.diagnostics.length && lfLib.metrics.length === lib.metrics.length, lfLib.problems);
} finally {
}

const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + JSON.stringify(item.info ?? '').slice(0, 500)));
console.log(`\n${pass}/${results.length} 通過`);
process.exit(pass === results.length ? 0 : 1);
