// Office 附件轉文字測試（prototypes/proofread/office-text.mjs；唔開伺服器、唔開瀏覽器、唔加 npm 套件）
// 測：docx／pptx／xlsx 內容正確；安全（解壓炸彈、項目數、垃圾檔、加密、舊格式、宣稱大小說謊、惡意標籤）；旁放文字檔 .md；真實檔案。
// 夾具用 zlib.deflateRawSync 自組最小 ZIP，唔靠外部檔案（真檔只作額外核對，搵唔到就跳過）。
// 用法：node office-text-test.mjs（結束碼 0 = 全過）
import fs from 'node:fs';
import { assertTestOut, makeTestTemp } from '../lib/out-guard.mjs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '../../../prototypes/proofread/office-text.mjs');
const { officeKind, officeToText, writeTextSidecar } = await import(pathToFileURL(LIB).href);
const results = [];
const ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const T0 = Date.now();
const tmpDirs = [];
const mkTmp = prefix => { const d = makeTestTemp(prefix); tmpDirs.push(d); return d; };

/* ---------- 自寫 ZIP 寫入器 ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// entries: [{ name, data, method = 8, cdMethod, cdUsize, cdCsize, flags }]；o: { eocdCount, comment }
function makeZip(entries, o = {}) {
  const parts = [], cd = [];
  let off = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.flags ?? 0, 8); ch.writeUInt16LE(e.cdMethod ?? method, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(e.cdCsize ?? comp.length, 20); ch.writeUInt32LE(e.cdUsize ?? raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, name);
    off += lh.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd), comment = Buffer.from(o.comment || '', 'utf8');
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0);
  eo.writeUInt16LE(o.eocdCount ?? entries.length, 8); eo.writeUInt16LE(o.eocdCount ?? entries.length, 10);
  eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(off, 16); eo.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, cdBuf, eo, comment]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const run = t => `<w:r><w:t>${t}</w:t></w:r>`;
const docxOf = body => makeZip([{ name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>` }]);

/* ---------- 1. docx ---------- */
{
  const styles = `<w:styles ${W}><w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
  const body = [
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run('年度報告 Annual')}</w:p>`,
    `<w:p><w:pPr><w:pStyle w:val="2"/></w:pPr>${run('第二章')}</w:p>`,
    `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t xml:space="preserve">Hello </w:t></w:r>${run('World')}<w:r><w:tab/></w:r>${run('R&amp;D &lt;b&gt; &#65;&#x4E2D; &amp;lt; &nbsp; 中文')}<w:r><w:br/></w:r>${run('第二行')}</w:p>`,
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run('清單項目')}</w:p>`,
    `<w:p><w:del><w:r><w:delText>已刪除的字</w:delText></w:r></w:del>${run('保留的字')}</w:p>`,
    `<w:p><mc:AlternateContent><mc:Choice>${run('文字框')}</mc:Choice><mc:Fallback>${run('文字框')}</mc:Fallback></mc:AlternateContent></w:p>`,
    `<w:p/>`,
    `<w:tbl><w:tr><w:tc><w:p>${run('項目')}</w:p></w:tc><w:tc><w:p>${run('名稱|說明')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('一')}</w:p><w:p>${run('續行')}</w:p></w:tc><w:tc><w:p>${run('Apple')}</w:p></w:tc></w:tr></w:tbl>`,
    `<w:p>${run('表格後')}</w:p>`,
  ].join('');
  const footnotes = `<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p>${run('分隔線不算')}</w:p></w:footnote><w:footnote w:id="2"><w:p>${run('註腳內容')}</w:p></w:footnote></w:footnotes>`;
  const buf = makeZip([
    { name: 'word/document.xml', data: `<w:document ${W}><w:body>${body}</w:body></w:document>` },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/footnotes.xml', data: footnotes },
  ]);
  const r = officeToText(buf, '報告.docx');
  const t = r.text || '';
  ok('docx：成功並帶說明行', r.ok && r.kind === 'docx' && t.startsWith('<!-- 由 CrewZero 從 報告.docx 轉出的文字版；圖片、圖表及版面未包括 -->\n\n'), t.slice(0, 120));
  ok('docx：英文標題樣式轉 #、中文樣式名（heading 2）轉 ##', t.includes('# 年度報告 Annual\n') && t.includes('\n## 第二章\n'), t);
  ok('docx：多個 run 連成一段、tab、換行、實體（含數字實體；&amp;lt; 不重複解碼；未知實體原樣）', t.includes('Hello World\tR&D <b> A中 &lt; &nbsp; 中文\n第二行'), JSON.stringify(t));
  ok('docx：定位點設定（pPr 內 w:tab）不當成 tab 字元', !/\n\t/.test(t) && !t.includes('\tHello'), JSON.stringify(t));
  ok('docx：清單項目、刪除的字不出現、文字框備援不重複', t.includes('- 清單項目') && !t.includes('已刪除的字') && t.includes('保留的字') && t.split('文字框').length === 2, t);
  ok('docx：表格轉 Markdown 表格（含表頭分隔列、| 跳脫、儲存格內多段併成一行）', t.includes('| 項目 | 名稱\\|說明 |\n| --- | --- |\n| 一 續行 | Apple |'), t);
  ok('docx：表格後的段落仍輸出；空段落不產生空區塊', t.includes('表格後') && !/\n\n\n/.test(t), JSON.stringify(t));
  ok('docx：註腳讀到、分隔線註腳不算', t.includes('## 註腳') && t.includes('2. 註腳內容') && !t.includes('分隔線不算'), t);
  ok('officeKind 分類', officeKind('a.DOCX') === 'docx' && officeKind('b.pptx') === 'pptx' && officeKind('c.xlsx') === 'xlsx' && officeKind('d.doc') === 'legacy' && officeKind('e.xls') === 'legacy' && officeKind('f.ppt') === 'legacy' && officeKind('g.pdf') === null && officeKind('noext') === null);
}

/* ---------- 2. pptx ---------- */
{
  const slide = inner => `<p:sld ${A}><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;
  const para = (...ts) => `<a:p>${ts.map(x => `<a:r><a:t>${x}</a:t></a:r>`).join('')}</a:p>`;
  const notes = (...ts) => `<p:notes ${A}><p:cSld><p:spTree>${ts.map(x => para(x)).join('')}<a:p><a:fld type="slidenum"><a:t>2</a:t></a:fld></a:p></p:spTree></p:cSld></p:notes>`;
  const tbl = `<a:tbl><a:tr><a:tc><a:txBody>${para('甲')}</a:txBody></a:tc><a:tc><a:txBody>${para('乙')}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${para('1')}</a:txBody></a:tc><a:tc><a:txBody>${para('2')}</a:txBody></a:tc></a:tr></a:tbl>`;
  const rels = target => `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="${target}"/></Relationships>`;
  const buf = makeZip([
    { name: 'ppt/slides/slide10.xml', data: slide(para('第十張', ' & 內容') + para('B段')) },
    { name: 'ppt/slides/slide2.xml', data: slide(para('標題', '二') + para('第二段')) },
    { name: 'ppt/slides/slide1.xml', data: slide(para('封面') + tbl) },
    { name: 'ppt/slides/slide3.xml', data: slide('') },
    { name: 'ppt/notesSlides/notesSlide2.xml', data: notes('講者備註 A', '備註第二行') },
    { name: 'ppt/slides/_rels/slide10.xml.rels', data: rels('../notesSlides/notesSlide7.xml') },
    { name: 'ppt/notesSlides/notesSlide7.xml', data: notes('經關係檔找到的備註') },
  ]);
  const r = officeToText(buf, '簡報.pptx');
  const t = r.text || '';
  const i1 = t.indexOf('## 第 1 張投影片'), i2 = t.indexOf('## 第 2 張投影片'), i10 = t.indexOf('## 第 10 張投影片');
  ok('pptx：slide10 排在 slide2 之後（數字排序，非字串排序）', r.ok && r.kind === 'pptx' && i1 >= 0 && i1 < i2 && i2 < i10, t);
  ok('pptx：同一段多個 a:t 連接、段與段換行、實體解碼', t.includes('標題二\n第二段') && t.includes('第十張 & 內容\nB段'), JSON.stringify(t));
  ok('pptx：備註讀到（同編號 notesSlideN；及經關係檔指向另一編號）', t.includes('備註：講者備註 A\n備註第二行') && t.includes('備註：經關係檔找到的備註'), t);
  ok('pptx：投影片頁碼欄位不當作備註內容', !/備註第二行\n2\b/.test(t), t);
  ok('pptx：投影片內表格轉 Markdown 表格；空白投影片略過', t.includes('| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |') && !t.includes('第 3 張'), t);
}

/* ---------- 3. xlsx ---------- */
{
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const wb = `<workbook ${S}><sheets><sheet name="第二頁" sheetId="2" r:id="rId2"/><sheet name="Data &amp; Co" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rt = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
  const rels = `<Relationships><Relationship Id="rId1" Type="${rt}" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rt}" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://x/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const sst = `<sst ${S} count="3" uniqueCount="3"><si><t>名稱</t></si><si><r><t>蘋</t></r><r><rPr><b/></rPr><t>果</t></r><rPh sb="0" eb="1"><t>ping</t></rPh></si><si><t xml:space="preserve"> A &amp; B </t></si></si></sst>`;
  const sheet1 = `<worksheet ${S}><sheetData>`
    + `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="3"/><c r="C1" t="inlineStr"><is><t>備註</t></is></c></row>`
    + `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>3.14</v></c><c r="C2" t="b"><v>1</v></c><c r="D2"><f>B2*2</f><v>6.28</v></c></row>`
    + `<row r="3"><c r="A3" t="b"><v>0</v></c><c r="B3" t="str"><f>"x"&amp;"y"</f><v>xy</v></c><c r="C3" t="s"><v>2</v></c></row>`
    + `<row r="5"><c r="A5" t="inlineStr"><is><r><t>分</t></r><r><t>段</t></r></is></c></row>`
    + `</sheetData></worksheet>`;
  const sheet2 = `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>只有一格</t></is></c></row></sheetData></worksheet>`;
  const buf = makeZip([
    { name: 'xl/workbook.xml', data: wb }, { name: 'xl/_rels/workbook.xml.rels', data: rels }, { name: 'xl/sharedStrings.xml', data: sst },
    { name: 'xl/worksheets/sheet1.xml', data: sheet1 }, { name: 'xl/worksheets/sheet2.xml', data: sheet2 },
  ]);
  const r = officeToText(buf, '數據.xlsx');
  const t = r.text || '';
  ok('xlsx：兩張工作表按 workbook 次序（非檔案編號次序）、名稱實體解碼', r.ok && r.kind === 'xlsx' && t.indexOf('## 工作表：第二頁') >= 0 && t.indexOf('## 工作表：第二頁') < t.indexOf('## 工作表：Data & Co'), t);
  ok('xlsx：跳欄（A1、C1）空欄留空；共用字串、inline 字串', t.includes('| 名稱 |  | 備註 |  |'), t);
  ok('xlsx：共用字串多個 run 連接且不含拼音；數字原樣、布林、公式快取值', t.includes('| 蘋果 | 3.14 | TRUE | 6.28 |'), t);
  ok('xlsx：布林 FALSE、字串公式快取、共用字串保留實體解碼', t.includes('| FALSE | xy | A & B |  |'), t);
  ok('xlsx：沒有值的列（第 4 列）不輸出，第 5 列 inline 多段連接', t.includes('| 分段 |  |  |  |') && !t.split('\n').some(l => l === '|  |  |  |  |'), t);
  ok('xlsx：單格工作表輸出', t.includes('| 只有一格 |'), t);
}

/* ---------- 4. 安全與壞檔 ---------- */
{
  const reason = (buf, name, opts) => { const r = officeToText(buf, name, opts); return r.ok ? 'OK' : r.reason; };
  const big = Buffer.alloc(2 * 1024 * 1024, 0x61);
  const bomb = makeZip([{ name: 'word/document.xml', data: Buffer.concat([Buffer.from(`<w:document ${W}><w:body><w:p><w:r><w:t>`), big, Buffer.from('</w:t></w:r></w:p></w:body></w:document>')]) }]);
  ok('安全：高壓縮比項目 + 很細的 maxTotalBytes → too-big', reason(bomb, 'a.docx', { maxTotalBytes: 100000 }) === 'too-big', reason(bomb, 'a.docx', { maxTotalBytes: 100000 }));
  ok('安全：單一項目超 maxEntryBytes → too-big', reason(bomb, 'a.docx', { maxEntryBytes: 1000 }) === 'too-big');
  ok('安全：同一個檔在預設上限內正常轉換（壓縮檔細但解壓 2MB 可接受）', reason(bomb, 'a.docx') === 'OK');
  const many = makeZip(Array.from({ length: 30 }, (_, i) => ({ name: `x/f${i}.txt`, data: 'a' })).concat([{ name: 'word/document.xml', data: `<w:document ${W}><w:body><w:p>${run('hi')}</w:p></w:body></w:document>` }]));
  ok('安全：中央目錄項目數超 maxEntries → too-big', reason(many, 'a.docx', { maxEntries: 10 }) === 'too-big');
  ok('安全：項目數在上限內正常', reason(many, 'a.docx') === 'OK');
  const fakeCount = makeZip([{ name: 'word/document.xml', data: '<w:document/>' }], { eocdCount: 40000 });
  ok('安全：EOCD 謊報 40000 個項目 → too-big（預設）；放寬上限後走目錄失敗 → corrupt', reason(fakeCount, 'a.docx') === 'too-big' && reason(fakeCount, 'a.docx', { maxEntries: 100000 }) === 'corrupt');
  ok('壞檔：非 ZIP 垃圾、空 Buffer、截斷的 ZIP → corrupt', reason(Buffer.from('this is not a zip file at all, just junk text'.repeat(20)), 'a.docx') === 'corrupt' && reason(Buffer.alloc(0), 'a.xlsx') === 'corrupt' && reason(docxOf('<w:p/>').subarray(0, 60), 'a.docx') === 'corrupt');
  const cfb = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
  ok('加密：CFB 檔頭 → encrypted（docx／xlsx／pptx 都是）', reason(cfb, 'a.docx') === 'encrypted' && reason(cfb, 'b.xlsx') === 'encrypted' && reason(cfb, 'c.pptx') === 'encrypted');
  ok('加密：ZIP 項目加密旗標 → encrypted', reason(makeZip([{ name: 'word/document.xml', data: 'x', flags: 1 }]), 'a.docx') === 'encrypted');
  ok('舊格式：.doc／.xls／.ppt → legacy（連 CFB 內容也不解析）', reason(cfb, 'a.doc') === 'legacy' && reason(cfb, 'a.xls') === 'legacy' && reason(cfb, 'a.ppt') === 'legacy');
  ok('空文件：docx 無段落／pptx 無文字／xlsx 無儲存格 → empty', reason(docxOf('<w:p/><w:p>' + run('   ') + '</w:p>'), 'a.docx') === 'empty'
    && reason(makeZip([{ name: 'ppt/slides/slide1.xml', data: `<p:sld ${A}><a:p/></p:sld>` }]), 'a.pptx') === 'empty'
    && reason(makeZip([{ name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' }, { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' }, { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1"/></row></sheetData></worksheet>' }]), 'a.xlsx') === 'empty');
  ok('缺主要內容：ZIP 有效但沒有 word/document.xml／投影片／workbook.xml → corrupt', reason(makeZip([{ name: 'other.xml', data: 'x' }]), 'a.docx') === 'corrupt' && reason(makeZip([{ name: 'other.xml', data: 'x' }]), 'a.pptx') === 'corrupt' && reason(makeZip([{ name: 'other.xml', data: 'x' }]), 'a.xlsx') === 'corrupt');
  // 中央目錄宣稱大小與實際不符
  const doc = `<w:document ${W}><w:body><w:p>${run('x'.repeat(5000))}</w:p></w:body></w:document>`;
  const lieSmall = officeToText(makeZip([{ name: 'word/document.xml', data: doc, cdUsize: 100 }]), 'a.docx');
  const lieBig = officeToText(makeZip([{ name: 'word/document.xml', data: doc, cdUsize: 99999 }]), 'a.docx');
  const lieHuge = officeToText(makeZip([{ name: 'word/document.xml', data: doc, cdUsize: 0xfffffffe }]), 'a.docx');
  const lieStore = officeToText(makeZip([{ name: 'word/document.xml', data: doc, method: 0, cdUsize: 100 }]), 'a.docx');
  const lieComp = officeToText(makeZip([{ name: 'word/document.xml', data: doc, cdCsize: 0xfffffff0 }]), 'a.docx');
  const okSet = new Set(['corrupt', 'too-big']);
  ok('宣稱大小不符：宣稱太小／太大／巨大／存儲長度不符／壓縮長度越界 → 不崩潰，回 corrupt 或 too-big', [lieSmall, lieBig, lieHuge, lieStore, lieComp].every(r => !r.ok && okSet.has(r.reason)), [lieSmall, lieBig, lieHuge, lieStore, lieComp].map(r => r.reason));
  ok('宣稱巨大 → too-big；宣稱太小而實際更長 → corrupt', lieHuge.reason === 'too-big' && lieSmall.reason === 'corrupt');
  ok('不支援的壓縮方法 → corrupt', reason(makeZip([{ name: 'word/document.xml', data: doc, cdMethod: 12 }]), 'a.docx') === 'corrupt');
  // 惡意路徑：只當名稱查表，不寫出任何檔
  const tmpRoot = mkTmp('office-text-');
  const inner = path.join(tmpRoot, 'inner'); fs.mkdirSync(inner);
  const evil = makeZip([{ name: '../evil.txt', data: 'pwn' }, { name: '/abs/evil2.txt', data: 'pwn' }, { name: 'word/document.xml', data: `<w:document ${W}><w:body><w:p>${run('正常')}</w:p></w:body></w:document>` }]);
  fs.writeFileSync(path.join(inner, 'e.docx'), evil);
  const re = writeTextSidecar(path.join(inner, 'e.docx'));
  // 暫存資料夾由 makeTestTemp 建立，內有守門標記檔 .cz-test-tmp；核對「沒有新檔」時略過該標記
  const listed = dir => fs.readdirSync(dir).filter(name => name !== '.cz-test-tmp').sort();
  ok('安全：ZIP 內 ../ 與絕對路徑項目不被跟從、不寫出任何解壓檔（旁放檔以外沒有新檔）', re.ok && !fs.existsSync(path.join(tmpRoot, 'evil.txt')) && listed(inner).join(',') === 'e.docx,e.docx.md' && listed(tmpRoot).join(',') === 'inner', { inner: fs.readdirSync(inner), root: fs.readdirSync(tmpRoot) });
  // 惡意標籤：未收尾的 <w:t>、巨量 '<a' 都不可拖慢
  const t1 = Date.now();
  const hostile = officeToText(docxOf('<w:p>' + '<w:t>'.repeat(300000) + '</w:p>'), 'h.docx');
  const hostile2 = officeToText(docxOf('<w:p>' + '<a'.repeat(500000)), 'h2.docx');
  const hostile3 = officeToText(docxOf('<w:p>' + '<w:t>'.repeat(100000) + '</w:t>' + '</w:p>'), 'h3.docx');
  const hostile4 = officeToText(docxOf('<w:p>' + '<mc:Fallback>'.repeat(200000)), 'h4.docx');
  const hostile5 = officeToText(makeZip([{ name: 'ppt/slides/slide1.xml', data: `<p:sld ${A}><a:p>` + '<mc:Fallback>'.repeat(200000) }]), 'h5.pptx');
  const hostile6 = officeToText(docxOf('<w:tbl><w:tr><w:tc>'.repeat(100000) + '<w:p>' + run('x') + '</w:p>'), 'h6.docx');
  const hostile7 = officeToText(docxOf('<w:p>'.repeat(100000) + run('x')), 'h7.docx');
  ok('安全：惡意標籤（大量未收尾 <w:t>、<a<a<a…、未收尾 mc:Fallback）線性處理，不卡死', Date.now() - t1 < 5000 && [hostile, hostile2, hostile3, hostile4, hostile5].every(r => typeof r.ok === 'boolean'), Date.now() - t1);
  ok('安全：巢狀過深的表格或段落 → corrupt（不爆記憶體、不卡死）', !hostile6.ok && hostile6.reason === 'corrupt' && !hostile7.ok && hostile7.reason === 'corrupt', [hostile6.reason, hostile7.reason]);
  // 輸出預算：闊表格（一列極闊加大量窄列）、pptx 表格、xlsx 稀疏大表、長共用字串被大量引用，都要快速回 too-big
  const timed = fn => { const t = Date.now(); const r = fn(); return [r, Date.now() - t]; };
  const wCell = '<w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>', aCell = '<a:tc><a:txBody><a:p><a:r><a:t>a</a:t></a:r></a:p></a:txBody></a:tc>';
  const [rw, msW] = timed(() => officeToText(docxOf('<w:tbl><w:tr>' + wCell.repeat(45000) + '</w:tr>' + ('<w:tr>' + wCell + '</w:tr>').repeat(45000) + '</w:tbl>'), 'w.docx'));
  const [rp, msP] = timed(() => officeToText(makeZip([{ name: 'ppt/slides/slide1.xml', data: `<p:sld ${A}><a:tbl><a:tr>` + aCell.repeat(45000) + '</a:tr>' + ('<a:tr>' + aCell + '</a:tr>').repeat(45000) + '</a:tbl></p:sld>' }]), 'p.pptx'));
  const XS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const xlsxOf = (sheet, sst) => makeZip([
    { name: 'xl/workbook.xml', data: `<workbook ${XS}><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet }, ...(sst ? [{ name: 'xl/sharedStrings.xml', data: sst }] : []),
  ]);
  const sparse = `<worksheet ${XS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="XFD1" t="inlineStr"><is><t>z</t></is></c></row>` + Array.from({ length: 200 }, (_, i) => `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>x</t></is></c></row>`).join('') + '</sheetData></worksheet>';
  const [rx, msX] = timed(() => officeToText(xlsxOf(sparse), 'x.xlsx'));
  const longStr = `<sst ${XS}><si><t>${'長'.repeat(100000)}</t></si></sst>`;
  const colName = n => (n >= 26 ? colName(Math.floor(n / 26) - 1) : '') + String.fromCharCode(65 + (n % 26));
  const refs = `<worksheet ${XS}><sheetData><row r="1">` + Array.from({ length: 300 }, (_, i) => `<c r="${colName(i)}1" t="s"><v>0</v></c>`).join('') + '</row></sheetData></worksheet>';
  const [rs, msS] = timed(() => officeToText(xlsxOf(refs, longStr), 's.xlsx'));
  ok('輸出預算：闊表格 docx（45000 欄 × 45000 列）→ too-big 且 3 秒內', !rw.ok && rw.reason === 'too-big' && msW < 3000, [rw.reason, msW]);
  ok('輸出預算：pptx 闊表格 → too-big 且 3 秒內', !rp.ok && rp.reason === 'too-big' && msP < 3000, [rp.reason, msP]);
  ok('輸出預算：xlsx 稀疏大表（A 欄到 XFD 欄 × 200 列）→ too-big 且 3 秒內', !rx.ok && rx.reason === 'too-big' && msX < 3000, [rx.reason, msX]);
  ok('輸出預算：長共用字串被大量引用（輸出字元超 maxOutputChars）→ too-big 且 3 秒內', !rs.ok && rs.reason === 'too-big' && msS < 3000, [rs.reason, msS]);
  ok('輸出預算：maxOutputChars／maxTableCells 可由 opts 覆寫', officeToText(docxOf(`<w:p>${run('x'.repeat(500))}</w:p>`), 'o.docx', { maxOutputChars: 100 }).reason === 'too-big'
    && officeToText(docxOf(`<w:tbl><w:tr>${wCell}${wCell}</w:tr></w:tbl>`), 'o.docx', { maxTableCells: 1 }).reason === 'too-big'
    && officeToText(docxOf(`<w:tbl><w:tr>${wCell}${wCell}</w:tr></w:tbl>`), 'o.docx').ok);
  ok('文字框備援：有收尾的 mc:Fallback 內文字被移除、其後文字保留', officeToText(docxOf(`<w:p>${run('前')}<mc:Fallback>${run('備援')}</mc:Fallback>${run('後')}</w:p>`), 'f.docx').text.includes('前後'));
  // 檔名放進說明註解時不可跳出註解
  const named = officeToText(docxOf(`<w:p>${run('x')}</w:p>`), 'a--> <script>.docx');
  ok('說明行：檔名含 --> 也不會提早結束註解', named.ok && named.text.split('-->').length === 2, named.text && named.text.slice(0, 100));
}

/* ---------- 4b. 命名空間前綴可變（OpenXML SDK 等工具產生 x:、ns0: 等前綴） ---------- */
{
  const XM = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const xbuf = makeZip([
    { name: 'xl/workbook.xml', data: `<x:workbook xmlns:x="${XM}" xmlns:q="${RN}"><x:sheets><x:sheet name="表一" sheetId="1" q:id="rId1"/></x:sheets></x:workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: `<x:sst xmlns:x="${XM}"><x:si><x:t>名稱</x:t></x:si><x:si><x:r><x:t>蘋</x:t></x:r><x:r><x:t>果</x:t></x:r></x:si></x:sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<x:worksheet xmlns:x="${XM}"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>備註</x:t></x:is></x:c></x:row><x:row r="2"><x:c r="A2" t="s"><x:v>1</x:v></x:c><x:c r="B2"><x:f>1+1</x:f><x:v>2</x:v></x:c><x:c r="C2" t="b"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>` },
  ]);
  const rx = officeToText(xbuf, '前綴.xlsx');
  ok('前綴：x: 前綴的 xlsx 轉出正確文字（工作表名、共用字串、inline 字串、公式快取值、布林、跳欄）', rx.ok && rx.text.includes('## 工作表：表一') && rx.text.includes('| 名稱 |  | 備註 |') && rx.text.includes('| 蘋果 | 2 | TRUE |'), rx.ok ? rx.text : rx.reason);
  const NS = 'xmlns:ns0="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:ns1="http://schemas.openxmlformats.org/markup-compatibility/2006"';
  const n = t => `<ns0:r><ns0:t>${t}</ns0:t></ns0:r>`;
  const dbuf = makeZip([{ name: 'word/document.xml', data: `<ns0:document ${NS}><ns0:body>`
    + `<ns0:p><ns0:pPr><ns0:pStyle ns0:val="Heading1"/></ns0:pPr>${n('前綴標題')}</ns0:p>`
    + `<ns0:p><ns0:pPr><ns0:tabs><ns0:tab ns0:val="left" ns0:pos="720"/></ns0:tabs></ns0:pPr>${n('內文')}<ns0:r><ns0:tab/></ns0:r>${n('後')}<ns0:r><ns0:br/></ns0:r>${n('下一行')}</ns0:p>`
    + `<ns0:p><ns1:AlternateContent><ns1:Choice>${n('文字框')}</ns1:Choice><ns1:Fallback>${n('文字框')}</ns1:Fallback></ns1:AlternateContent></ns0:p>`
    + `<ns0:tbl><ns0:tr><ns0:tc><ns0:p>${n('甲')}</ns0:p></ns0:tc><ns0:tc><ns0:p>${n('乙')}</ns0:p></ns0:tc></ns0:tr></ns0:tbl>`
    + `</ns0:body></ns0:document>` }]);
  const rd = officeToText(dbuf, '前綴.docx');
  ok('前綴：ns0: 非標準前綴的 docx（標題、tab、換行、定位點設定、Fallback 去重、表格）轉出正確文字', rd.ok && rd.text.includes('# 前綴標題') && rd.text.includes('內文\t後\n下一行') && !rd.text.includes('\t內文') && rd.text.split('文字框').length === 2 && rd.text.includes('| 甲 | 乙 |'), rd.ok ? JSON.stringify(rd.text) : rd.reason);
  const pbuf = makeZip([{ name: 'ppt/slides/slide1.xml', data: '<p:sld xmlns:p="x" xmlns:d="y"><d:p><d:r><d:t>前綴投影片</d:t></d:r></d:p><d:p><d:r><d:t>第二行</d:t></d:r></d:p></p:sld>' }]);
  const rp = officeToText(pbuf, '前綴.pptx');
  ok('前綴：d: 非標準前綴的 pptx 轉出正確文字', rp.ok && rp.text.includes('前綴投影片\n第二行'), rp.ok ? rp.text : rp.reason);
}

/* ---------- 5. writeTextSidecar ---------- */
{
  const dir = mkTmp('office-sidecar-');
  const good = path.join(dir, '報告.docx');
  fs.writeFileSync(good, docxOf(`<w:p>${run('旁放檔內容')}</w:p>`));
  const r = writeTextSidecar(good);
  const written = fs.existsSync(good + '.md') ? fs.readFileSync(good + '.md', 'utf8') : null;
  ok('旁放檔：成功時寫出 <原檔名>.md（報告.docx.md）且內容等於轉出文字', r.ok && r.sidecar === good + '.md' && path.basename(r.sidecar) === '報告.docx.md' && written === r.text && written.includes('旁放檔內容'), r);
  const bad = path.join(dir, 'bad.docx'); fs.writeFileSync(bad, 'junk junk junk');
  const old = path.join(dir, 'old.doc'); fs.writeFileSync(old, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.alloc(50)]));
  const emp = path.join(dir, 'empty.docx'); fs.writeFileSync(emp, docxOf('<w:p/>'));
  const rb = writeTextSidecar(bad), ro = writeTextSidecar(old), re = writeTextSidecar(emp), rm = writeTextSidecar(path.join(dir, 'missing.docx'));
  ok('旁放檔：壞檔／舊格式／空文件／不存在 → 回失敗原因、不寫檔、不拋錯',
    !rb.ok && rb.reason === 'corrupt' && !ro.ok && ro.reason === 'legacy' && !re.ok && re.reason === 'empty' && !rm.ok
    && !fs.existsSync(bad + '.md') && !fs.existsSync(old + '.md') && !fs.existsSync(emp + '.md') && !fs.existsSync(path.join(dir, 'missing.docx.md')), [rb, ro, re, rm]);
  const rt = writeTextSidecar(good, { maxTotalBytes: 10 });
  ok('旁放檔：opts 傳到轉換（上限極細 → too-big）', !rt.ok && rt.reason === 'too-big');
}

/* ---------- 6. 真實檔案（有就測，沒有就跳過） ---------- */
{
  const cands = ['../../../docs/evidence/doc-reading-2026-11-06/test-files', '../../../../../docs/evidence/doc-reading-2026-11-06/test-files'].map(p => path.resolve(HERE, p));
  const dir = cands.find(d => fs.existsSync(path.join(d, 'test.docx')));
  if (!dir) console.log('SKIP 找不到真實 Office 檔夾具（test-files），略過第 6 項');
  else for (const f of ['test.docx', 'test.pptx', 'test.xlsx']) {
    const r = officeToText(fs.readFileSync(path.join(dir, f)), f);
    const body = r.ok ? r.text.replace(/^<!--.*?-->\s*/, '') : '';
    console.log(`--- ${f} 頭 200 字 ---\n${(r.ok ? r.text : '失敗：' + r.reason).slice(0, 200)}\n`);
    ok(`真檔：${f} 轉出非空文字`, r.ok && body.trim().length > 0, r.ok ? '' : r.reason);
  }
}

ok('整個測試 30 秒內完成', Date.now() - T0 < 30000, Date.now() - T0);

for (const d of tmpDirs) { assertTestOut(d); fs.rmSync(d, { recursive: true, force: true }); }
const pass = results.filter(r => r.pass).length;
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n      ' + String(JSON.stringify(r.info)).slice(0, 900)));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
