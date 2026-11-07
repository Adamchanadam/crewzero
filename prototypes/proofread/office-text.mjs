// Office 附件轉文字（唯一定義處）：把 Word（.docx）、PowerPoint（.pptx）、Excel（.xlsx）轉成純文字（Markdown），
// 令三種 AI 工具都讀得到（佢哋嘅讀檔工具唔拆 Office 檔，而 CrewZero 唔准 AI 執行命令，所以由本機伺服器收件時先轉）。
// 硬規矩（附件係不受信任嘅檔案）：
//   (1) 只用 Node 內建模組；唔用 XML 解析器（免外部實體／DTD），只用字串掃描剝標籤；唔執行檔內任何內容。
//   (2) 只喺記憶體解壓需要嘅幾個項目，唔跟從路徑、唔寫出解壓檔；單項、總量、項目數都有上限，超出即 too-big。
//   (3) 中央目錄宣稱嘅大小同實際解壓長度必須一致，否則當 corrupt。
//   (4) 掃描一律線性（用 indexOf 逐個標籤走），唔用可能無限回溯嘅大範圍正則，免惡意檔拖死伺服器。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DEFAULTS = { maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxEntries: 5000, maxSlides: 500, maxSheets: 100, maxFileBytes: 50 * 1024 * 1024, maxOutputChars: 10000000, maxTableCells: 1000000 };
const LEGACY_EXT = new Set(['doc', 'dot', 'xls', 'xlt', 'ppt', 'pps', 'pot']);

class Fail extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const fail = reason => new Fail(reason);

// 副檔名分類：docx／pptx／xlsx；舊二進位格式 legacy；其他 null
export function officeKind(name) {
  const m = /\.([^./\\]+)$/.exec(String(name ?? ''));
  const ext = m ? m[1].toLowerCase() : '';
  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') return ext;
  return LEGACY_EXT.has(ext) ? 'legacy' : null;
}

/* ---------- ZIP 讀取（只讀中央目錄，記憶體內解壓） ---------- */

function limitsOf(opts) {
  const lim = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) { const v = opts && opts[k]; if (typeof v === 'number' && Number.isFinite(v) && v > 0) lim[k] = v; }
  return lim;
}

function openZip(buf, lim) {
  if (buf.length < 22) throw fail('corrupt');
  // 由檔尾搵 End of Central Directory；註解最長 65535 位元組，註解長度要啱啱接到檔尾
  let eocd = -1;
  for (let i = buf.length - 22, lo = Math.max(0, buf.length - 22 - 0xffff); i >= lo; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw fail('corrupt');
  const diskNo = buf.readUInt16LE(eocd + 4), cdDisk = buf.readUInt16LE(eocd + 6);
  const nHere = buf.readUInt16LE(eocd + 8), n = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (n > lim.maxEntries) throw fail('too-big');
  if (n === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw fail('corrupt'); // ZIP64 唔支援
  if (diskNo || cdDisk || nHere !== n || n === 0) throw fail('corrupt');
  const cdEnd = cdOff + cdSize;
  if (cdEnd > eocd) throw fail('corrupt'); // 中央目錄一定喺 EOCD 之前
  const entries = new Map();
  let p = cdOff;
  for (let k = 0; k < n; k++) {
    if (p + 46 > cdEnd || buf.readUInt32LE(p) !== 0x02014b50) throw fail('corrupt');
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    if (p + 46 + nl + el + cl > cdEnd) throw fail('corrupt');
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (!entries.has(name)) { // 同名重複只認第一個，免歧義
      entries.set(name, { flags: buf.readUInt16LE(p + 8), method: buf.readUInt16LE(p + 10), csize: buf.readUInt32LE(p + 20), usize: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42) });
    }
    p += 46 + nl + el + cl;
  }
  const state = { total: 0 };
  return {
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    // 解壓一個項目並回傳文字；唔存在回 null
    text(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (e.flags & 1) throw fail('encrypted');
      if (e.usize > lim.maxEntryBytes || state.total + e.usize > lim.maxTotalBytes) throw fail('too-big');
      if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw fail('corrupt');
      const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
      const end = start + e.csize;
      if (end > buf.length) throw fail('corrupt');
      const raw = buf.subarray(start, end);
      let out;
      if (e.method === 0) {
        if (e.csize !== e.usize) throw fail('corrupt');
        out = raw;
      } else if (e.method === 8) {
        // 解壓長度以中央目錄宣稱嘅大小封頂；實際更長（宣稱說謊）會拋錯，當 corrupt
        try { out = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) }); } catch { throw fail('corrupt'); }
        if (out.length !== e.usize) throw fail('corrupt');
      } else throw fail('corrupt');
      state.total += out.length;
      return decodeBytes(out);
    },
  };
}

function decodeBytes(b) {
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.toString('utf16le', 2);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.toString('utf8', 3);
  return b.toString('utf8');
}

/* ---------- XML 字串工具（唔用解析器） ---------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// 只解 & < > " ' 同數字實體；其他實體原樣保留；一次過替換，唔會重複解碼（&amp;lt; → &lt;）
function decode(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] !== '#') return ENT[g];
    const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    const okCp = (cp >= 0x20 || cp === 9 || cp === 10 || cp === 13) && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff);
    return okCp ? String.fromCodePoint(cp) : m;
  });
}
const clean = s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
// 讀屬性值（傳入名稱可帶前綴，如 w:val；比對時只認本地名，任何前綴或冇前綴都得）
function attr(body, name) {
  const i = body.search(new RegExp('\\s(?:[\\w.-]+:)?' + name.slice(name.lastIndexOf(':') + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*='));
  if (i < 0) return null;
  const m = /^\s[^=\s]+\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(body.slice(i));
  return m ? decode(m[1] ?? m[2]) : null;
}
// 任何前綴嘅 :id（xlsx 工作表嘅 r:id，前綴名可變）
function relId(body) {
  const m = /\s[\w.-]+:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(body);
  return m ? decode(m[1] ?? m[2]) : null;
}
// 逐個標籤線性走；name 係去咗前綴嘅本地名（OpenXML SDK 等工具會用 x:、ns0: 等任意前綴），qname 係完整標籤名；fn 回傳數字即由該位置繼續（用嚟跳過已處理嘅文字內容）
function walk(xml, fn) {
  let i = 0;
  for (;;) {
    const lt = xml.indexOf('<', i); if (lt < 0) return;
    const gt = xml.indexOf('>', lt + 1); if (gt < 0) return;
    const body = xml.slice(lt + 1, gt);
    i = gt + 1;
    const m = /^(\/?)([^\s/]+)/.exec(body);
    if (!m || m[2][0] === '!' || m[2][0] === '?') continue;
    const r = fn({ close: m[1] === '/', name: m[2].slice(m[2].lastIndexOf(':') + 1), qname: m[2], self: body.endsWith('/'), body, start: lt }, i);
    if (typeof r === 'number') i = r;
  }
}
// 讀 <名>文字</名> 內容；回傳 [文字, 之後位置]；搵唔到收尾就當剩餘全部係文字
function textAt(xml, name, i) {
  const end = xml.indexOf('</' + name + '>', i);
  if (end < 0) return [decode(xml.slice(i)), xml.length];
  return [decode(xml.slice(i, end)), end + name.length + 3];
}
// 文字框會同時有 Choice 同 Fallback，重複；前綴名可變（mc: 以外亦認）；用 indexOf 線性走（唔用大範圍正則，免二次方回溯）；搵唔到收尾就捨棄其後全部
function stripFallback(xml) {
  if (!xml.includes('Fallback')) return xml;
  let out = '', i = 0;
  for (;;) {
    const k = xml.indexOf('Fallback', i);
    if (k < 0) return out + xml.slice(i);
    const m = /<([A-Za-z0-9_.-]+:)$/.exec(xml.slice(Math.max(i, k - 40), k));
    const nx = xml[k + 8] ?? '';
    if (!m || !(nx === '>' || (nx !== '' && nx.trim() === ''))) { out += xml.slice(i, k + 8); i = k + 8; continue; }
    out += xml.slice(i, k - m[0].length);
    const close = '</' + m[1] + 'Fallback>';
    const e = xml.indexOf(close, k);
    if (e < 0) return out;
    i = e + close.length;
  }
}

// 輸出預算（所有格式共用）：累計輸出字元數同表格總格數；超出即 too-big，喺超出嗰刻停止，唔會先組出成個字串
function checkCells(bud, n) { bud.cells += n; if (bud.cells > bud.lim.maxTableCells) throw fail('too-big'); }
function addChars(bud, n) { bud.chars += n; if (bud.chars > bud.lim.maxOutputChars) throw fail('too-big'); }
// counted：呼叫者已先用 checkCells 計過格數（例如 xlsx 補欄分配之前）
function renderTable(rows, bud, counted = false) {
  const w = Math.max(1, rows.reduce((a, r) => Math.max(a, r.length), 0));
  if (!counted) checkCells(bud, rows.length * w); // 先算「列數 × 最闊列」，唔先分配
  const cell = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '\\|').trim();
  const line = r => {
    const parts = [];
    for (let i = 0; i < w; i++) { const c = cell(r[i]); addChars(bud, c.length + 3); parts.push(c); }
    return '| ' + parts.join(' | ') + ' |';
  };
  const out = [line(rows[0])];
  addChars(bud, w * 6);
  out.push('| ' + Array(w).fill('---').join(' | ') + ' |');
  for (let i = 1; i < rows.length; i++) out.push(line(rows[i]));
  return out.join('\n');
}

/* ---------- docx ---------- */

function styleNames(xml) {
  const map = {};
  if (!xml) return map;
  let cur = null;
  walk(xml, t => {
    if (t.name === 'style') cur = t.close ? null : attr(t.body, 'styleId');
    else if (t.name === 'name' && cur && !t.close) map[cur] = attr(t.body, 'val') || '';
  });
  return map;
}
function headingLevel(id, styles) {
  for (const s of [id, styles[id]]) {
    if (!s) continue;
    const m = /(?:heading|標題|标题)\s*([1-6])/i.exec(s);
    if (m) return +m[1];
    if (/^(?:title|標題|标题)$/i.test(s.trim())) return 1;
  }
  return 0;
}

// 回傳區塊陣列（段落、標題、表格各一塊）
function docxBlocks(xml, styles, bud) {
  xml = stripFallback(xml);
  const out = [], tables = [], paras = [];
  let inPPr = false, inChange = false;
  const finishPara = () => {
    const p = paras.pop();
    if (!p) return;
    const text = clean(p.text).trim();
    if (!text) return;
    const tb = tables[tables.length - 1];
    if (tb && tb.cell) { tb.cell.push(text.replace(/\s*[\r\n]+\s*/g, ' ')); return; }
    const flat = text.replace(/\s*[\r\n]+\s*/g, ' ');
    const lv = headingLevel(p.style, styles);
    out.push(lv ? '#'.repeat(lv) + ' ' + flat : p.list ? '- ' + flat : text);
  };
  walk(xml, (t, i) => {
    const tb = tables[tables.length - 1], para = paras[paras.length - 1];
    switch (t.name) {
      case 'tbl': if (!t.close && !t.self) { if (tables.length >= 32) throw fail('corrupt'); tables.push({ rows: [], row: null, cell: null }); } // 巢狀過深只會係惡意檔
        else if (t.close) {
          const done = tables.pop();
          if (done && done.rows.length) {
            const parent = tables[tables.length - 1];
            if (parent && parent.cell) parent.cell.push(done.rows.map(r => r.join(', ')).join('; '));
            else out.push(renderTable(done.rows, bud));
          }
        }
        break;
      case 'tr': if (tb) { if (t.close) { if (tb.row && tb.row.some(c => c.trim())) tb.rows.push(tb.row); tb.row = null; } else if (!t.self) tb.row = []; } break;
      case 'tc': if (tb) { if (t.close) { if (tb.row && tb.cell) tb.row.push(tb.cell.join(' ')); tb.cell = null; } else if (!t.self) tb.cell = []; } break;
      case 'p': if (t.close) finishPara(); else if (!t.self) { if (paras.length >= 64) throw fail('corrupt'); paras.push({ text: '', style: '', list: false }); } break;
      case 'pPr': if (!t.self) inPPr = !t.close; break;
      case 'pPrChange': if (!t.self) inChange = !t.close; break; // 追蹤修訂內嘅舊樣式唔算
      case 'pStyle': if (para && inPPr && !inChange && !t.close) para.style = attr(t.body, 'val') || ''; break;
      case 'numId': if (para && inPPr && !inChange && !t.close) para.list = attr(t.body, 'val') !== '0'; break;
      case 't': if (!t.close && !t.self) { const [s, next] = textAt(xml, t.qname, i); if (para) para.text += s; return next; } break;
      case 'tab': if (para && !inPPr && !t.close) para.text += '\t'; break; // pPr 內係定位點設定，唔係 tab 字元
      case 'br': case 'cr': if (para && !t.close) para.text += '\n'; break;
      case 'noBreakHyphen': if (para && !t.close) para.text += '-'; break;
    }
  });
  while (paras.length) finishPara();
  return out;
}

function docxText(zip, bud) {
  const doc = zip.text('word/document.xml');
  if (doc == null) throw fail('corrupt');
  const styles = styleNames(zip.text('word/styles.xml'));
  const blocks = docxBlocks(doc, styles, bud);
  // 註腳（有餘力先做）：略過分隔線等有 w:type 嘅項目
  const fx = zip.text('word/footnotes.xml');
  if (fx) {
    const notes = [];
    let open = null;
    walk(fx, (t, i) => {
      if (t.name !== 'footnote') return;
      if (!t.close) open = t.self || attr(t.body, 'type') ? null : { id: attr(t.body, 'id') || String(notes.length + 1), from: i };
      else if (open) { const s = docxBlocks(fx.slice(open.from, t.start), styles, bud).join(' ').trim(); if (s) notes.push(open.id + '. ' + s); open = null; }
    });
    if (notes.length) blocks.push('## 註腳\n\n' + notes.join('\n'));
  }
  return blocks.join('\n\n');
}

/* ---------- pptx ---------- */

function relationships(xml) {
  const list = [];
  if (xml) walk(xml, t => { if (t.name === 'Relationship' && !t.close && attr(t.body, 'TargetMode') !== 'External') list.push({ id: attr(t.body, 'Id'), type: attr(t.body, 'Type') || '', target: attr(t.body, 'Target') || '' }); });
  return list;
}
// 相對路徑解析到 ZIP 內名稱；跳出根目錄當無效
function resolveTarget(baseDir, target) {
  const full = target.startsWith('/') ? target.slice(1) : baseDir + '/' + target;
  const norm = path.posix.normalize(full);
  return norm.startsWith('..') || norm.startsWith('/') ? null : norm;
}

// 一張投影片（或備註）嘅文字：段落按行，表格轉 Markdown 表格
function slideLines(xml, bud) {
  xml = stripFallback(xml);
  const lines = [];
  let para = null, tbl = null, skipField = false;
  walk(xml, (t, i) => {
    switch (t.name) {
      case 'fld': skipField = !t.close && !t.self && /type\s*=\s*["']slidenum["']/i.test(t.body); break; // 頁碼欄位唔係內容
      case 'p': if (t.close) {
        const s = clean(para ?? '').trim(); para = null;
        if (s) { if (tbl && tbl.cell) tbl.cell.push(s.replace(/\s*[\r\n]+\s*/g, ' ')); else lines.push(s); }
      } else if (!t.self) para = ''; break;
      case 't': if (!t.close && !t.self) { const [s, next] = textAt(xml, t.qname, i); if (para !== null && !skipField) para += s; return next; } break;
      case 'br': if (para !== null && !t.close) para += '\n'; break;
      case 'tbl': if (!t.close && !t.self) tbl = { rows: [], row: null, cell: null }; else if (t.close && tbl) { if (tbl.rows.length) lines.push(renderTable(tbl.rows, bud)); tbl = null; } break;
      case 'tr': if (tbl) { if (t.close) { if (tbl.row && tbl.row.some(c => c.trim())) tbl.rows.push(tbl.row); tbl.row = null; } else if (!t.self) tbl.row = []; } break;
      case 'tc': if (tbl) { if (t.close) { if (tbl.row && tbl.cell) tbl.row.push(tbl.cell.join(' ')); tbl.cell = null; } else if (!t.self) tbl.cell = []; } break;
    }
  });
  return lines;
}

function pptxText(zip, lim, bud) {
  const slides = zip.names().map(n => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n)).filter(Boolean).map(m => ({ n: +m[1], name: m[0] })).sort((a, b) => a.n - b.n);
  if (!slides.length) throw fail('corrupt');
  if (slides.length > lim.maxSlides) throw fail('too-big');
  const blocks = [];
  for (const s of slides) {
    const xml = zip.text(s.name);
    const lines = slideLines(xml, bud);
    // 備註：優先跟投影片嘅關係檔搵，搵唔到就用同編號嘅 notesSlideN
    let notesName = null;
    const rel = relationships(zip.text(`ppt/slides/_rels/slide${s.n}.xml.rels`)).find(r => /\/notesSlide$/.test(r.type));
    if (rel) notesName = resolveTarget('ppt/slides', rel.target);
    if (!notesName || !zip.has(notesName)) notesName = `ppt/notesSlides/notesSlide${s.n}.xml`;
    const notesXml = zip.has(notesName) ? zip.text(notesName) : null;
    const notes = notesXml ? slideLines(notesXml, bud).join('\n') : '';
    if (!lines.length && !notes) continue;
    blocks.push(`## 第 ${s.n} 張投影片` + (lines.length ? '\n\n' + lines.join('\n') : '') + (notes ? '\n\n備註：' + notes : ''));
  }
  return blocks.join('\n\n');
}

/* ---------- xlsx ---------- */

function colIndex(letters) { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }

function sharedStrings(xml) {
  const list = [];
  if (!xml) return list;
  let cur = null, inPh = false;
  walk(xml, (t, i) => {
    switch (t.name) {
      case 'si': if (t.close) { list.push(cur ?? ''); cur = null; } else if (t.self) list.push(''); else cur = ''; break;
      case 'rPh': if (!t.self) inPh = !t.close; break; // 拼音註釋唔算內容
      case 't': if (!t.close && !t.self) { const [s, next] = textAt(xml, t.qname, i); if (cur !== null && !inPh) cur += s; return next; } break;
    }
  });
  return list;
}

// 一張工作表 → { rows: Map(列號 → Map(欄號 → 文字)), maxCol }
function sheetCells(xml, sst) {
  const rows = new Map();
  let maxCol = -1, rowNo = 0, lastCol = -1, cell = null, inIs = false, inPh = false;
  walk(xml, (t, i) => {
    switch (t.name) {
      case 'row': if (!t.close) { const r = parseInt(attr(t.body, 'r'), 10); rowNo = r > 0 ? r : rowNo + 1; lastCol = -1; } break;
      case 'c':
        if (t.close) {
          if (cell) {
            let s = '';
            if (cell.t === 's') s = sst[parseInt(cell.v, 10)] ?? '';
            else if (cell.t === 'inlineStr') s = cell.is ?? cell.v ?? '';
            else if (cell.t === 'b') s = cell.v === '1' ? 'TRUE' : cell.v === '0' ? 'FALSE' : '';
            else s = cell.v ?? '';
            s = clean(s).trim();
            if (s && cell.col >= 0 && cell.col < 16384 && rowNo > 0 && rowNo <= 1048576) {
              if (!rows.has(rowNo)) rows.set(rowNo, new Map());
              rows.get(rowNo).set(cell.col, s);
              if (cell.col > maxCol) maxCol = cell.col;
            }
          }
          cell = null; inIs = inPh = false;
        } else if (!t.self) {
          const ref = /^([A-Za-z]{1,3})([0-9]+)$/.exec(attr(t.body, 'r') || '');
          let col;
          if (ref) { col = colIndex(ref[1].toUpperCase()); const r = parseInt(ref[2], 10); if (r > 0) rowNo = r; } else col = lastCol + 1;
          lastCol = col;
          cell = { col, t: attr(t.body, 't') || 'n', v: null, is: null };
        } else { // 空儲存格（自閉合）：只推進欄位位置
          const ref = /^([A-Za-z]{1,3})[0-9]+$/.exec(attr(t.body, 'r') || '');
          lastCol = ref ? colIndex(ref[1].toUpperCase()) : lastCol + 1;
        }
        break;
      case 'v': if (cell && !t.close && !t.self) { const [s, next] = textAt(xml, t.qname, i); cell.v = s; return next; } break; // 公式只取快取值
      case 'is': if (cell && !t.self) { inIs = !t.close; if (inIs && cell.is === null) cell.is = ''; } break;
      case 'rPh': if (!t.self) inPh = !t.close; break;
      case 't': if (cell && inIs && !inPh && !t.close && !t.self) { const [s, next] = textAt(xml, t.qname, i); cell.is += s; return next; } break;
    }
  });
  return { rows, maxCol };
}

function xlsxText(zip, lim, bud) {
  const wb = zip.text('xl/workbook.xml');
  if (wb == null) throw fail('corrupt');
  const sheets = [];
  walk(wb, t => { if (t.name === 'sheet' && !t.close) sheets.push({ name: attr(t.body, 'name') || '', rid: relId(t.body) }); });
  if (!sheets.length) throw fail('corrupt');
  if (sheets.length > lim.maxSheets) throw fail('too-big');
  const relXml = zip.text('xl/_rels/workbook.xml.rels');
  const rels = new Map(relationships(relXml).map(r => [r.id, r]));
  const sst = sharedStrings(zip.text('xl/sharedStrings.xml'));
  const blocks = [];
  let any = false, read = 0;
  sheets.forEach((sh, idx) => {
    let file = null;
    if (relXml == null) file = `xl/worksheets/sheet${idx + 1}.xml`; // 冇關係檔：按次序猜
    else { const r = rels.get(sh.rid); if (r && /\/worksheet$/.test(r.type)) file = resolveTarget('xl', r.target); }
    if (!file || !zip.has(file)) return; // 圖表工作表等唔係儲存格資料，略過
    read++;
    const { rows, maxCol } = sheetCells(zip.text(file), sst);
    let body = '（沒有內容）';
    if (rows.size) {
      any = true;
      checkCells(bud, rows.size * (maxCol + 1)); // 又闊又長嘅稀疏表：補欄分配之前先擋
      const table = [...rows.keys()].sort((a, b) => a - b).map(rn => { const r = rows.get(rn); return Array.from({ length: maxCol + 1 }, (_, c) => r.get(c) ?? ''); });
      body = renderTable(table, bud, true);
    }
    blocks.push(`## 工作表：${sh.name}\n\n${body}`);
  });
  if (!read) throw fail('corrupt');
  return any ? blocks.join('\n\n') : '';
}

/* ---------- 對外介面 ---------- */

// buf：整個檔案；name：原檔名（用副檔名判斷類型）
// 回傳 { ok: true, kind, text } 或 { ok: false, kind, reason }；reason 只會係 legacy／encrypted／too-big／corrupt／empty
export function officeToText(buf, name, opts = {}) {
  const kind = officeKind(name);
  if (!kind) return { ok: false, kind: null, reason: 'corrupt' }; // 唔係 Office 檔，呼叫者應先用 officeKind 判斷
  if (kind === 'legacy') return { ok: false, kind, reason: 'legacy' };
  try {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) return { ok: false, kind, reason: 'encrypted' }; // 有密碼嘅 Office 檔係 CFB，唔係 ZIP
    const lim = limitsOf(opts), bud = { lim, chars: 0, cells: 0 };
    const zip = openZip(buf, lim);
    const body = kind === 'docx' ? docxText(zip, bud) : kind === 'pptx' ? pptxText(zip, lim, bud) : xlsxText(zip, lim, bud);
    if (body.length > lim.maxOutputChars) throw fail('too-big'); // 連非表格文字一併計
    if (!body.trim()) return { ok: false, kind, reason: 'empty' };
    const label = path.basename(String(name)).replace(/--+/g, '-').replace(/>/g, '＞');
    return { ok: true, kind, text: `<!-- 由 CrewZero 從 ${label} 轉出的文字版；圖片、圖表及版面未包括 -->\n\n${body}\n` };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, kind, reason: e.reason };
    return { ok: false, kind, reason: e instanceof RangeError ? 'too-big' : 'corrupt' };
  }
}

// 讀檔 → 轉文字 → 成功先喺同一資料夾寫 <原檔名>.md；失敗唔寫檔
export function writeTextSidecar(filePath, opts = {}) {
  const name = path.basename(String(filePath));
  const kind = officeKind(name);
  let buf;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { ok: false, kind, reason: 'corrupt' };
    if (st.size > limitsOf(opts).maxFileBytes) return { ok: false, kind, reason: 'too-big' };
    buf = fs.readFileSync(filePath);
  } catch { return { ok: false, kind, reason: 'corrupt' }; }
  const r = officeToText(buf, name, opts);
  if (!r.ok) return r;
  const sidecar = filePath + '.md';
  try { fs.writeFileSync(sidecar, r.text, 'utf8'); } catch { return { ok: false, kind: r.kind, reason: 'corrupt' }; }
  return { ...r, sidecar };
}
