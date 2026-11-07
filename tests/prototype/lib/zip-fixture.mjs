// 測試用：自組最小 ZIP／docx／xlsx（不靠外部檔案、不加 npm 套件）
import zlib from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(entries) {
  const parts = [], cd = [];
  let off = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = zlib.deflateRawSync(raw), name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc32(raw), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc32(raw), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cd.push(ch, name);
    off += lh.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10); eo.writeUInt32LE(cdBuf.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, eo]);
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// 每個字串一段
export const docxOf = paragraphs => makeZip([{ name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${paragraphs.map(t => `<w:p><w:r><w:t>${esc(t)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` }]);
// rows：二維陣列（字串或數字）
export function xlsxOf(rows, sheetName = '預算') {
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const cell = (v, r, c) => { const ref = String.fromCharCode(65 + c) + (r + 1); return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`; };
  return makeZip([
    { name: 'xl/workbook.xml', data: `<workbook ${S}><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: `<worksheet ${S}><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('')}</sheetData></worksheet>` },
  ]);
}
