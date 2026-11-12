// PDF 附件轉文字測試：所有夾具由程式即場組裝；唔讀外部 PDF，唔開子程序或伺服器。
import fs from 'node:fs';
import { assertTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '../../../prototypes/proofread/pdf-text.mjs');
const { isPdf, pdfToText, writePdfSidecar } = await import(pathToFileURL(LIB).href);
const results = [];
const ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const tempDirs = [];
const mkTmp = prefix => { const dir = makeTestTemp(prefix); tempDirs.push(dir); return dir; };
const enc = s => Buffer.from(s, 'latin1');

function stream(dict, data) {
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
  return Buffer.concat([enc('<< ' + dict + ' /Length ' + String(raw.length) + ' >>\nstream\n'), raw, enc('\nendstream')]);
}
function classicPdf(objects, trailerExtra = '', badOffsets = false) {
  const parts = [enc('%PDF-1.7\n%\xff\xff\xff\xff\n')], offsets = new Map();
  let at = parts[0].length;
  for (const item of objects) {
    offsets.set(item.num, at);
    const body = Buffer.isBuffer(item.body) ? item.body : enc(item.body);
    const block = Buffer.concat([enc(String(item.num) + ' 0 obj\n'), body, enc('\nendobj\n')]);
    parts.push(block); at += block.length;
  }
  const size = Math.max(...objects.map(x => x.num)) + 1, xrefAt = at;
  let xref = 'xref\n0 ' + String(size) + '\n0000000000 65535 f \n';
  for (let n = 1; n < size; n++) {
    const off = badOffsets ? 1 : offsets.get(n) ?? 0;
    xref += String(off).padStart(10, '0') + ' 00000 ' + (offsets.has(n) ? 'n' : 'f') + ' \n';
  }
  xref += 'trailer\n<< /Size ' + String(size) + ' /Root 1 0 R ' + trailerExtra + '>>\nstartxref\n' + String(xrefAt) + '\n%%EOF\n';
  return Buffer.concat([...parts, enc(xref)]);
}
function xrefStreamPdf(objects, xrefNo) {
  const parts = [enc('%PDF-1.7\n')];
  let at = parts[0].length;
  for (const item of objects) {
    const body = Buffer.isBuffer(item.body) ? item.body : enc(item.body);
    const block = Buffer.concat([enc(String(item.num) + ' 0 obj\n'), body, enc('\nendobj\n')]);
    parts.push(block); at += block.length;
  }
  const size = xrefNo + 1, rows = [];
  for (let i = 0; i < size; i++) rows.push(Buffer.from([i ? 1 : 0, 0, 0, 0, 0, 0, 0]));
  const predicted = [];
  let prev = Buffer.alloc(7);
  for (const row of rows) {
    predicted.push(2);
    for (let i = 0; i < row.length; i++) predicted.push((row[i] - prev[i]) & 255);
    prev = row;
  }
  const xref = stream('/Type /XRef /Size ' + String(size) + ' /Root 1 0 R /W [1 4 2] /Index [0 ' + String(size) + '] /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >>', zlib.deflateSync(Buffer.from(predicted)));
  const block = Buffer.concat([enc(String(xrefNo) + ' 0 obj\n'), xref, enc('\nendobj\nstartxref\n' + String(at) + '\n%%EOF\n')]);
  return Buffer.concat([...parts, block]);
}
function hex16(n) { return n.toString(16).padStart(4, '0').toUpperCase(); }
function utf16hex(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) out += hex16(text.charCodeAt(i));
  return out;
}
function type0Cmap(text) {
  const pairs = [];
  for (let i = 0; i < text.length; i++) pairs.push('<' + hex16(i + 1) + '> <' + hex16(text.charCodeAt(i)) + '>');
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
    + String(pairs.length) + ' beginbfchar\n' + pairs.join('\n') + '\nendbfchar\nendcmap\nend\nend';
}
function type0Bytes(text) {
  const out = Buffer.alloc(text.length * 2);
  for (let i = 0; i < text.length; i++) out.writeUInt16BE(i + 1, i * 2);
  return '<' + out.toString('hex').toUpperCase() + '>';
}
function type0Objects(content, cmapText, extras = {}) {
  const page = extras.page || '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>';
  return [
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: extras.pages || '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: page },
    { num: 4, body: '<< /Type /Font /Subtype /Type0 /BaseFont /Faux /Encoding /Identity-H /ToUnicode 5 0 R >>' },
    { num: 5, body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(cmapText, 'latin1'))) },
    { num: 6, body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(content, 'latin1'))) },
  ];
}
function simplePdf(content, pageExtra = '') {
  return classicPdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R ' + pageExtra + '>>' },
    { num: 4, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { num: 5, body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(content, 'latin1'))) },
  ]);
}
function reason(buf, opts) { const r = pdfToText(buf, '測試.pdf', opts); return r.ok ? 'OK' : r.reason; }

// 1. Type0、Identity-H、bfchar（包括 UTF-16BE 代理對）
{
  const text = 'Speaker 1 00:00:05 今日想談咖啡豆訂閱的試行安排😀';
  const pdf = classicPdf(type0Objects('BT /F1 12 Tf ' + type0Bytes(text) + ' Tj ET', type0Cmap(text)));
  const r = pdfToText(pdf, '會議.PDF');
  ok('1. Type0＋Identity-H＋bfchar 中文及代理對', r.ok && r.kind === 'pdf' && r.text.includes(text), r.ok ? r.text : r.reason);
}

// 2. bfrange：連續範圍及陣列形式
{
  const cm = '1 begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfrange\n<0001> <0002> <4E00>\n<0003> <0004> [<4E09> <4E0D>]\nendbfrange';
  const pdf = classicPdf(type0Objects('BT /F1 12 Tf <0001000200030004> Tj ET', cm));
  const r = pdfToText(pdf, 'range.pdf');
  ok('2. bfrange 連續及陣列對照', r.ok && r.text.includes('一丁三不'), r.ok ? r.text : r.reason);
}

// 3. Kids 次序及巢狀 Pages
{
  const words = ['甲頁', '乙頁', '丙頁'];
  const cm = type0Cmap(words.join(''));
  const code = text => '<' + [...text].map(ch => hex16(words.join('').indexOf(ch) + 1)).join('') + '>';
  const content = n => stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from('BT /F1 12 Tf ' + code(words[n]) + ' Tj ET', 'latin1')));
  const pdf = classicPdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Resources << /Font << /F1 7 0 R >> >> /Kids [3 0 R 6 0 R] /Count 3 >>' },
    { num: 3, body: '<< /Type /Pages /Kids [4 0 R 5 0 R] /Count 2 >>' },
    { num: 4, body: '<< /Type /Page /Parent 3 0 R /Contents 8 0 R >>' },
    { num: 5, body: '<< /Type /Page /Parent 3 0 R /Contents 9 0 R >>' },
    { num: 6, body: '<< /Type /Page /Parent 2 0 R /Contents 10 0 R >>' },
    { num: 7, body: '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 11 0 R >>' },
    { num: 8, body: content(0) }, { num: 9, body: content(1) }, { num: 10, body: content(2) },
    { num: 11, body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(cm, 'latin1'))) },
  ]);
  const r = pdfToText(pdf, 'pages.pdf'), t = r.text || '';
  ok('3. 多頁 Kids 次序、巢狀頁樹及頁碼分隔', r.ok && t.indexOf('（第 1 頁）\n甲頁') < t.indexOf('（第 2 頁）\n乙頁') && t.indexOf('（第 2 頁）\n乙頁') < t.indexOf('（第 3 頁）\n丙頁'), t);
}

// 4. 物件串流，以及有 PNG predictor 的 xref 串流
{
  const phrase = '物件串流文字', cm = type0Cmap(phrase);
  const objPage = '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>';
  const packed = Buffer.from('3 0 ' + objPage, 'latin1');
  const objectStreamPdf = classicPdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { num: 4, body: '<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 5 0 R >>' },
    { num: 5, body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(cm, 'latin1'))) },
    { num: 6, body: stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from('BT /F1 12 Tf ' + type0Bytes(phrase) + ' Tj ET', 'latin1'))) },
    { num: 7, body: stream('/Type /ObjStm /N 1 /First 4 /Filter /FlateDecode', zlib.deflateSync(packed)) },
  ]);
  const xrefPdf = xrefStreamPdf(type0Objects('BT /F1 12 Tf ' + type0Bytes('xref文字') + ' Tj ET', type0Cmap('xref文字')), 7);
  const a = pdfToText(objectStreamPdf, 'objstm.pdf'), b = pdfToText(xrefPdf, 'xref.pdf');
  ok('4. 物件串流及 PNG predictor xref 串流', a.ok && a.text.includes(phrase) && b.ok && b.text.includes('xref文字'), [a.reason, b.reason]);
}

// 5. 傳統 xref；故意錯偏移後以線性掃描救回
{
  const phrase = '偏移仍可讀', cm = type0Cmap(phrase);
  const good = classicPdf(type0Objects('BT /F1 12 Tf ' + type0Bytes(phrase) + ' Tj ET', cm));
  const bad = classicPdf(type0Objects('BT /F1 12 Tf ' + type0Bytes(phrase) + ' Tj ET', cm), '', true);
  const a = pdfToText(good, 'classic.pdf'), b = pdfToText(bad, 'bad-xref.pdf');
  ok('5. 傳統 xref 及壞偏移回退線性掃描', a.ok && b.ok && a.text.includes(phrase) && b.text.includes(phrase), [a.reason, b.reason]);
}

// 6. 簡單字型 ASCII 與 TJ 空格規則
{
  const r = pdfToText(simplePdf('BT /F1 12 Tf (Speaker 1 ) Tj [(00:00) -250 (05)] TJ ET'), 'simple.pdf');
  ok('6. 簡單字型 ASCII、TJ 小於 -200 加空格', r.ok && r.text.includes('Speaker 1 00:00 05'), r.ok ? r.text : r.reason);
}

// 7. T*、Td 改變 y 的換行
{
  const r = pdfToText(simplePdf('BT /F1 12 Tf 1 0 0 1 0 100 Tm (A) Tj T* (B) Tj 0 -20 Td (C) Tj ET'), 'lines.pdf');
  ok('7. T* 及 Td 改 y 會換行', r.ok && r.text.includes('A\nB\nC'), r.ok ? r.text : r.reason);
}

// 8. 只有圖片運算子，沒有文字層
{
  const r = pdfToText(simplePdf('q /Im0 Do Q'), 'scan.pdf');
  ok('8. 只有圖片 → empty', !r.ok && r.reason === 'empty');
}

// 9. Encrypt 一律拒絕
{
  const r = pdfToText(classicPdf([{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' }, { num: 2, body: '<< /Type /Pages /Kids [] /Count 0 >>' }], '/Encrypt 9 0 R '), 'locked.pdf');
  ok('9. /Encrypt → encrypted', !r.ok && r.reason === 'encrypted', r.reason);
}

// 10. 截斷及亂碼
{
  const good = simplePdf('BT /F1 12 Tf (x) Tj ET');
  ok('10. 截斷檔及亂碼 → corrupt', reason(good.subarray(0, 37)) === 'corrupt' && reason(Buffer.from('not a pdf at all')) === 'corrupt');
}

// 11. 檔案及單一解壓串流上限
{
  const bomb = simplePdf('BT /F1 12 Tf (' + 'A'.repeat(60000) + ') Tj ET');
  ok('11. maxFileBytes 及壓縮炸彈 → too-big', reason(bomb, { maxFileBytes: 10 }) === 'too-big' && reason(bomb, { maxStreamBytes: 100 }) === 'too-big');
}

// 12. 循環頁樹及過深頁樹在兩秒內失敗
{
  const cyclic = classicPdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [2 0 R] /Count 1 >>' },
  ]);
  const deep = [{ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' }];
  for (let n = 2; n < 75; n++) deep.push({ num: n, body: '<< /Type /Pages /Kids [' + String(n + 1) + ' 0 R] /Count 1 >>' });
  deep.push({ num: 75, body: '<< /Type /Page /Parent 74 0 R >>' });
  const t0 = Date.now(), a = pdfToText(cyclic, 'cycle.pdf'), b = pdfToText(classicPdf(deep), 'deep.pdf');
  ok('12. 頁樹循環／過深 → corrupt，不卡死', !a.ok && a.reason === 'corrupt' && !b.ok && b.reason === 'corrupt' && Date.now() - t0 < 2000, [a.reason, b.reason, Date.now() - t0]);
}

// 13. 成功才寫旁放檔；失敗不能遺留 .md
{
  const dir = mkTmp('crewzero-pdf-text-'), good = path.join(dir, 'meeting.pdf'), bad = path.join(dir, 'bad.pdf');
  fs.writeFileSync(good, simplePdf('BT /F1 12 Tf (Sidecar) Tj ET'));
  fs.writeFileSync(bad, 'junk');
  const a = writePdfSidecar(good), b = writePdfSidecar(bad), c = writePdfSidecar(good, { maxFileBytes: 10 });
  const saved = fs.existsSync(good + '.md') ? fs.readFileSync(good + '.md', 'utf8') : '';
  ok('13. writePdfSidecar 成功寫出；壞檔及超大檔不寫', a.ok && a.sidecar === good + '.md' && saved === a.text && saved.includes('Sidecar') && !b.ok && b.reason === 'corrupt' && !fs.existsSync(bad + '.md') && !c.ok && c.reason === 'too-big', [a, b, c]);
}

// 14. 標記行、檔名處理、副檔名及不支援內容過濾器的局部略過
{
  const phrase = '可讀頁', cm = type0Cmap(phrase);
  const objects = type0Objects('BT /F1 12 Tf ' + type0Bytes(phrase) + ' Tj ET', cm, {
    pages: '<< /Type /Pages /Kids [3 0 R 7 0 R] /Count 2 >>',
  });
  objects.push({ num: 7, body: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 8 0 R >>' });
  objects.push({ num: 8, body: stream('/Filter /ASCIIHexDecode', Buffer.from('not decoded', 'latin1')) });
  const r = pdfToText(classicPdf(objects), 'a--> 報告.PdF');
  ok('14. 第一行、檔名淨化、isPdf 及不支援過濾器只跳該頁', r.ok && r.text.startsWith('<!-- 由 CrewZero 從 a-＞ 報告.PdF 轉出的文字版；圖片及版面未包括 -->') && r.text.includes(phrase) && isPdf('A.PDF') && !isPdf('A.pdfx'), r.ok ? r.text : r.reason);
}

const p2StartedAt = Date.now();

// 15. iPhone 列印檔常見的 BDC 標記字典（包括巢狀字典）
{
  const phrase = '標記內容仍可讀', cm = type0Cmap(phrase);
  const codes = [...phrase].map((_, i) => hex16(i + 1));
  const a = '<' + codes.slice(0, 3).join('') + '>', b = '<' + codes.slice(3).join('') + '>';
  const content = 'BT /F1 12 Tf /P <</MCID 3>> BDC ' + a + ' Tj EMC '
    + '/P <</MCID 4 /Meta <</Lang (zh-HK) /ActualText <FEFF6A195E38>>> >> BDC ' + b + ' Tj EMC ET';
  const r = pdfToText(classicPdf(type0Objects(content, cm)), 'marked.pdf');
  ok('15. BDC 標記及巢狀字典不阻斷文字', r.ok && r.text.includes(phrase), r.ok ? r.text : r.reason);
}

// 16. 程序括號和孤立收尾字元只略過，前後文字仍可讀。
{
  const r = pdfToText(simplePdf('BT /F1 12 Tf (Before) Tj { } ) > (After) Tj ET'), 'loose.pdf');
  ok('16. { }、孤立 ) 和 > 不會令頁面損壞', r.ok && r.text.includes('BeforeAfter'), r.ok ? r.text : r.reason);
}

// 17. BI 後的二進位內容不可再按 PDF 記號拆解。
{
  const image = Buffer.from([0x28, 0x29, 0x3C, 0x45, 0x49, 0x20, 0xFF, 0x00, 0x5B]);
  const content = Buffer.concat([
    enc('BT /F1 12 Tf (Before) Tj ET BI /W 4 /H 4 /BPC 8 /CS /G ID\n'), image,
    enc(' EI BT /F1 12 Tf (After) Tj ET'),
  ]);
  const r = pdfToText(simplePdf(content), 'image.pdf');
  ok('17. BI 圖片資料略過，圖片前後文字保留', r.ok && r.text.includes('BeforeAfter') && !r.text.includes('EI'), r.ok ? r.text : r.reason);
}

// 18. 單頁未完結字串只令該頁空白，不影響同一份檔的其他頁。
{
  const content = text => stream('/Filter /FlateDecode', zlib.deflateSync(Buffer.from(text, 'latin1')));
  const pdf = classicPdf([
    { num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { num: 2, body: '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>' },
    { num: 3, body: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>' },
    { num: 4, body: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 9 0 R >> >> /Contents 7 0 R >>' },
    { num: 5, body: '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>' },
    { num: 6, body: content('BT /F1 12 Tf (First) Tj ET') },
    { num: 7, body: content('BT /F1 12 Tf (broken') },
    { num: 8, body: content('BT /F1 12 Tf (Third) Tj ET') },
    { num: 9, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]);
  const r = pdfToText(pdf, 'partial.pdf'), t = r.text || '';
  ok('18. 壞第二頁隔離，第一及第三頁照常輸出', r.ok && t.includes('（第 1 頁）\nFirst') && t.includes('（第 2 頁）\n\n（第 3 頁）\nThird') && !t.includes('broken'), t);
}

// 19. 完整標準 ToUnicode CMap 的字典、程序詞及對照都能通過寬鬆記號器。
{
  const phrase = 'CMap完整對照';
  const pairs = [];
  for (let i = 0; i < phrase.length; i++) pairs.push('<' + hex16(i + 1) + '> <' + hex16(phrase.charCodeAt(i)) + '>');
  const cm = '/CIDInit /ProcSet findresource begin\n{ }\n12 dict begin\nbegincmap\n'
    + '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
    + '/CMapName /Faux-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
    + String(pairs.length) + ' beginbfchar\n' + pairs.join('\n') + '\nendbfchar\nendcmap\n'
    + 'CMapName currentdict /CMap defineresource pop\nend\nend';
  const r = pdfToText(classicPdf(type0Objects('BT /F1 12 Tf ' + type0Bytes(phrase) + ' Tj ET', cm)), 'full-cmap.pdf');
  ok('19. 完整標準 ToUnicode CMap 仍保留對照', r.ok && r.text.includes(phrase), r.ok ? r.text : r.reason);
}

// 20. 新增的真實格式反例保持快速完成。
ok('20. 新增 PDF 反例在兩秒內完成', Date.now() - p2StartedAt < 2000, Date.now() - p2StartedAt);

for (const dir of tempDirs) { assertTestOut(dir); fs.rmSync(dir, { recursive: true, force: true }); }
// 21. 字型把常用字對照到康熙部首或半形句號（真實 iPhone 列印檔見過）：輸出還原為正常漢字及「。」，全形標點不變
{
  const raw = '0:05  Speaker 1\n⼈⽣⼤⽂⼒⻄⻓⻅⻔｡（測試），完';
  const pdf = classicPdf(type0Objects('BT /F1 12 Tf ' + type0Bytes(raw) + ' Tj ET', type0Cmap(raw)));
  const r = pdfToText(pdf, '部首.pdf');
  ok('21. 康熙部首、部首補充字及半形句號還原為正常漢字，全形標點不變', r.ok && r.text.includes('人生大文力西长见门。（測試），完') && !/[⺀-⿟｡]/.test(r.text), r.ok ? r.text : r.reason);
}

const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + JSON.stringify(r.info).slice(0, 900)));
console.log('\n' + String(pass) + '/' + String(results.length) + ' 通過');
process.exit(pass === results.length ? 0 : 1);
