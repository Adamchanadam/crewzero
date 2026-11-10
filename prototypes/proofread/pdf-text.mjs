// PDF 附件轉文字：只讀記憶體，唔執行檔內內容；以有界線性掃描處理不受信任檔案。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DEFAULTS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxObjects: 200000,
  maxStreamBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxPages: 2000,
  maxOutputChars: 10000000,
};
const MAX_DEPTH = 64;
// 部首補充字 → 對應漢字（常見於簡體字型的 ToUnicode；見 pdfToText 的 fixGlyphs）
const RADICAL_SUPPLEMENT = { 0x2EA0: 0x6C11, 0x2EA8: 0x72AD, 0x2EBC: 0x6708, 0x2EC1: 0x864E, 0x2EC4: 0x897F, 0x2EC5: 0x89C1, 0x2EC6: 0x89D2, 0x2EC8: 0x8BA0, 0x2EC9: 0x8D1D, 0x2ECB: 0x8F66, 0x2ECD: 0x8FB6, 0x2ECF: 0x961D, 0x2ED0: 0x9485, 0x2ED3: 0x957F, 0x2ED4: 0x95E8, 0x2ED6: 0x961D, 0x2ED7: 0x96E8, 0x2ED8: 0x9752, 0x2ED9: 0x97E6, 0x2EDA: 0x9875, 0x2EDB: 0x98CE, 0x2EDC: 0x98DE, 0x2EDD: 0x98DF, 0x2EDF: 0x98E0, 0x2EE0: 0x9963, 0x2EE2: 0x9A6C, 0x2EE3: 0x9AA8, 0x2EE4: 0x9B3C, 0x2EE5: 0x9C7C, 0x2EE6: 0x9E1F, 0x2EE7: 0x5364, 0x2EE8: 0x9EA6, 0x2EE9: 0x9EC4, 0x2EEA: 0x9EFE, 0x2EEB: 0x6589, 0x2EEC: 0x9F50, 0x2EED: 0x6B6F, 0x2EEE: 0x9F7F, 0x2EEF: 0x7ADC, 0x2EF0: 0x9F99, 0x2EF1: 0x9F9C, 0x2EF2: 0x4E80, 0x2EF3: 0x9F9F };

class Fail extends Error { constructor(reason) { super(reason); this.reason = reason; } }
const fail = reason => new Fail(reason);

function limitsOf(opts) {
  const lim = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    const v = opts && opts[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) lim[k] = v;
  }
  return lim;
}

export function isPdf(name) {
  const m = /\.([^./\\]+)$/.exec(String(name ?? ''));
  return !!m && m[1].toLowerCase() === 'pdf';
}

function white(c) { return c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32; }
function delim(c) { return white(c) || c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37; }
function boundary(s, p) { return p < 0 || p >= s.length || delim(s.charCodeAt(p)); }
function skip(s, p, end = s.length) {
  while (p < end) {
    const c = s.charCodeAt(p);
    if (white(c)) { p++; continue; }
    if (c === 37) {
      p++;
      while (p < end && s.charCodeAt(p) !== 10 && s.charCodeAt(p) !== 13) p++;
      continue;
    }
    break;
  }
  return p;
}
function wordEnd(s, p, end = s.length) {
  while (p < end && !delim(s.charCodeAt(p))) p++;
  return p;
}
function keywordAt(s, p, word, end = s.length) {
  return p + word.length <= end && s.startsWith(word, p) && boundary(s, p - 1) && boundary(s, p + word.length);
}
function findKeyword(s, word, p = 0, end = s.length) {
  for (;;) {
    const at = s.indexOf(word, p);
    if (at < 0 || at >= end) return -1;
    if (keywordAt(s, at, word, end)) return at;
    p = at + word.length;
  }
}
function hexDigit(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return -1;
}
function asNumber(v) { return v && v.type === 'num' ? v.value : null; }
function asName(v) { return v && v.type === 'name' ? v.value : null; }
function asRef(v) { return v && v.type === 'ref' ? v : null; }

// PDF 基本語法：只讀取本工作需要的字典、陣列、名稱、數字及字串。
function readName(s, p, end) {
  if (s.charCodeAt(p) !== 47) throw fail('corrupt');
  p++;
  let out = '';
  while (p < end && !delim(s.charCodeAt(p))) {
    if (s.charCodeAt(p) === 35 && p + 2 < end) {
      const a = hexDigit(s.charCodeAt(p + 1)), b = hexDigit(s.charCodeAt(p + 2));
      if (a >= 0 && b >= 0) { out += String.fromCharCode((a << 4) | b); p += 3; continue; }
    }
    out += s[p++];
  }
  return { value: { type: 'name', value: out }, pos: p };
}
function readLiteral(s, p, end, depth = 0) {
  if (depth >= MAX_DEPTH || s.charCodeAt(p) !== 40) throw fail('corrupt');
  const out = [];
  let nest = 1;
  for (p++; p < end; p++) {
    const c = s.charCodeAt(p);
    if (c === 92) {
      if (++p >= end) throw fail('corrupt');
      const n = s.charCodeAt(p);
      if (n === 110) out.push(10);
      else if (n === 114) out.push(13);
      else if (n === 116) out.push(9);
      else if (n === 98) out.push(8);
      else if (n === 102) out.push(12);
      else if (n === 13) { if (s.charCodeAt(p + 1) === 10) p++; }
      else if (n === 10) {}
      else if (n >= 48 && n <= 55) {
        let val = n - 48, count = 1;
        while (count < 3 && p + 1 < end) {
          const q = s.charCodeAt(p + 1);
          if (q < 48 || q > 55) break;
          val = val * 8 + q - 48; p++; count++;
        }
        out.push(val & 255);
      } else out.push(n);
    } else if (c === 40) {
      if (++nest > MAX_DEPTH) throw fail('corrupt');
      out.push(c);
    } else if (c === 41) {
      if (--nest === 0) return { value: { type: 'str', value: Buffer.from(out) }, pos: p + 1 };
      out.push(c);
    } else if (c === 13) {
      if (s.charCodeAt(p + 1) === 10) p++;
      out.push(10);
    } else out.push(c);
  }
  throw fail('corrupt');
}
function readHex(s, p, end) {
  if (s.charCodeAt(p) !== 60 || s.charCodeAt(p + 1) === 60) throw fail('corrupt');
  const out = [];
  let high = -1;
  for (p++; p < end; p++) {
    const c = s.charCodeAt(p);
    if (c === 62) {
      if (high >= 0) out.push(high << 4);
      return { value: { type: 'hex', value: Buffer.from(out) }, pos: p + 1 };
    }
    if (white(c)) continue;
    const h = hexDigit(c);
    if (h < 0) throw fail('corrupt');
    if (high < 0) high = h;
    else { out.push((high << 4) | h); high = -1; }
  }
  throw fail('corrupt');
}
function atomValue(raw) {
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return { type: 'num', value: Number(raw) };
  return { type: 'word', value: raw };
}
function parseValue(s, p, end, depth = 0) {
  if (depth >= MAX_DEPTH) throw fail('corrupt');
  p = skip(s, p, end);
  if (p >= end) throw fail('corrupt');
  const c = s.charCodeAt(p);
  if (c === 47) return readName(s, p, end);
  if (c === 40) return readLiteral(s, p, end, depth);
  if (c === 60) {
    if (s.charCodeAt(p + 1) !== 60) return readHex(s, p, end);
    const map = new Map(); p += 2;
    for (;;) {
      p = skip(s, p, end);
      if (p + 1 < end && s.charCodeAt(p) === 62 && s.charCodeAt(p + 1) === 62) return { value: { type: 'dict', map }, pos: p + 2 };
      const key = readName(s, p, end); p = skip(s, key.pos, end);
      const val = parseValue(s, p, end, depth + 1); map.set(key.value.value, val.value); p = val.pos;
    }
  }
  if (c === 91) {
    const arr = []; p++;
    for (;;) {
      p = skip(s, p, end);
      if (p >= end) throw fail('corrupt');
      if (s.charCodeAt(p) === 93) return { value: { type: 'array', value: arr }, pos: p + 1 };
      const v = parseValue(s, p, end, depth + 1); arr.push(v.value); p = v.pos;
    }
  }
  const q = wordEnd(s, p, end);
  if (q === p) throw fail('corrupt');
  const first = atomValue(s.slice(p, q));
  if (first.type !== 'num') return { value: first, pos: q };
  let after = skip(s, q, end);
  const r = wordEnd(s, after, end);
  if (r > after) {
    const second = atomValue(s.slice(after, r));
    if (second.type === 'num') {
      const mark = skip(s, r, end);
      if (keywordAt(s, mark, 'R', end)) return { value: { type: 'ref', num: first.value, gen: second.value }, pos: mark + 1 };
    }
  }
  return { value: first, pos: q };
}

function headerAt(s, p) {
  if (!boundary(s, p - 1)) return null;
  let q = p;
  while (q < s.length && s.charCodeAt(q) >= 48 && s.charCodeAt(q) <= 57) q++;
  if (q === p || !white(s.charCodeAt(q))) return null;
  const num = Number(s.slice(p, q)); q = skip(s, q);
  const g0 = q;
  while (q < s.length && s.charCodeAt(q) >= 48 && s.charCodeAt(q) <= 57) q++;
  if (q === g0 || !white(s.charCodeAt(q))) return null;
  const gen = Number(s.slice(g0, q)); q = skip(s, q);
  if (!keywordAt(s, q, 'obj')) return null;
  return { num, gen, after: q + 3 };
}
function objectKey(ref) { return String(ref.num) + ' ' + String(ref.gen); }

// 線性讀取物件：當 xref 偏移壞咗仍然可定位；stream 內容會整段跳過，避免誤認其內字樣。
function scanObjects(buf, lim) {
  const s = buf.toString('latin1');
  if (s.indexOf('%PDF-') < 0 || s.indexOf('%PDF-') > 1024) throw fail('corrupt');
  const objects = new Map();
  let p = 0;
  while (p < s.length) {
    const h = headerAt(s, p);
    if (!h) { p++; continue; }
    if (objects.size >= lim.maxObjects) throw fail('too-big');
    const bodyStart = skip(s, h.after);
    let dict = null, afterDict = bodyStart, stream = null, endObj = -1;
    if (s.charCodeAt(bodyStart) === 60 && s.charCodeAt(bodyStart + 1) === 60) {
      const parsed = parseValue(s, bodyStart, s.length);
      if (parsed.value.type !== 'dict') throw fail('corrupt');
      dict = parsed.value; afterDict = skip(s, parsed.pos);
      if (keywordAt(s, afterDict, 'stream')) {
        let dataStart = afterDict + 6;
        if (s.charCodeAt(dataStart) === 13 && s.charCodeAt(dataStart + 1) === 10) dataStart += 2;
        else if (s.charCodeAt(dataStart) === 10 || s.charCodeAt(dataStart) === 13) dataStart++;
        else throw fail('corrupt');
        const n = asNumber(dict.map.get('Length'));
        let dataEnd;
        if (n !== null && Number.isInteger(n) && n >= 0) {
          dataEnd = dataStart + n;
          if (dataEnd > s.length) throw fail('corrupt');
          const marker = skip(s, dataEnd);
          if (keywordAt(s, marker, 'endstream')) {
            endObj = findKeyword(s, 'endobj', marker + 9);
            stream = { data: buf.subarray(dataStart, dataEnd) };
          }
        }
        if (!stream) {
          const marker = findKeyword(s, 'endstream', dataStart);
          if (marker < 0) throw fail('corrupt');
          dataEnd = marker;
          while (dataEnd > dataStart && (s.charCodeAt(dataEnd - 1) === 10 || s.charCodeAt(dataEnd - 1) === 13)) dataEnd--;
          stream = { data: buf.subarray(dataStart, dataEnd) };
          endObj = findKeyword(s, 'endobj', marker + 9);
        }
      }
    }
    if (endObj < 0) endObj = findKeyword(s, 'endobj', afterDict);
    if (endObj < 0) throw fail('corrupt');
    const obj = { ...h, dict, stream, decoded: undefined, decoding: false };
    const key = objectKey(h);
    if (!objects.has(key)) objects.set(key, obj);
    p = endObj + 6;
  }
  if (!objects.size) throw fail('corrupt');
  return { source: s, objects };
}

function getObject(objects, ref) {
  const r = asRef(ref) || ref;
  if (!r || !Number.isInteger(r.num) || !Number.isInteger(r.gen)) throw fail('corrupt');
  const obj = objects.get(objectKey(r)) || (r.gen === 0 ? objects.get(String(r.num) + ' 0') : null);
  if (!obj) throw fail('corrupt');
  return obj;
}
function directDict(v, objects) {
  if (!v) return null;
  if (v.type === 'dict') return v;
  if (v.type === 'ref') return getObject(objects, v).dict || null;
  return null;
}

function pngPredictor(data, parms) {
  const predictor = asNumber(parms && parms.map.get('Predictor')) ?? 1;
  if (predictor <= 1) return data;
  if (predictor < 10 || predictor > 15) throw fail('corrupt');
  const columns = asNumber(parms.map.get('Columns')) ?? 1;
  const colors = asNumber(parms.map.get('Colors')) ?? 1;
  const bits = asNumber(parms.map.get('BitsPerComponent')) ?? 8;
  if (![columns, colors, bits].every(Number.isInteger) || columns < 1 || colors < 1 || bits < 1 || bits > 16) throw fail('corrupt');
  const rowBytes = Math.ceil(columns * colors * bits / 8);
  const bpp = Math.max(1, Math.ceil(colors * bits / 8));
  if (rowBytes <= 0 || data.length % (rowBytes + 1) !== 0) throw fail('corrupt');
  const out = Buffer.alloc((data.length / (rowBytes + 1)) * rowBytes);
  let at = 0, to = 0, prev = Buffer.alloc(rowBytes);
  while (at < data.length) {
    const mode = data[at++];
    if (mode > 4) throw fail('corrupt');
    const row = Buffer.alloc(rowBytes);
    for (let i = 0; i < rowBytes; i++) {
      const x = data[at++], left = i >= bpp ? row[i - bpp] : 0, up = prev[i], ul = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (mode === 1) add = left;
      else if (mode === 2) add = up;
      else if (mode === 3) add = Math.floor((left + up) / 2);
      else if (mode === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      row[i] = (x + add) & 255;
    }
    row.copy(out, to); to += rowBytes; prev = row;
  }
  return out;
}

function streamFilters(dict) {
  const f = dict.map.get('Filter');
  if (!f) return [];
  if (f.type === 'name') return [f.value];
  if (f.type === 'array') return f.value.map(asName);
  return [null];
}
function streamParms(dict) {
  const p = dict.map.get('DecodeParms');
  if (!p) return null;
  if (p.type === 'array') return directDict(p.value[0], null);
  return p.type === 'dict' ? p : null;
}

function decodeStream(obj, lim, state, optional = false) {
  if (!obj.stream) throw fail('corrupt');
  if (obj.decoded !== undefined) return obj.decoded;
  if (obj.decoding) throw fail('corrupt');
  obj.decoding = true;
  try {
    const filters = streamFilters(obj.dict);
    if (filters.some(f => f !== 'FlateDecode' && f !== 'Fl')) {
      if (optional) { obj.decoded = null; return null; }
      throw fail('corrupt');
    }
    if (filters.length > 1) {
      if (optional) { obj.decoded = null; return null; }
      throw fail('corrupt');
    }
    let data = obj.stream.data;
    if (data.length > lim.maxStreamBytes) throw fail('too-big');
    if (filters.length) {
      try { data = zlib.inflateSync(data, { maxOutputLength: lim.maxStreamBytes }); }
      catch (e) {
        if (e instanceof RangeError || e?.code === 'ERR_BUFFER_TOO_LARGE') throw fail('too-big');
        throw fail('corrupt');
      }
      if (data.length > lim.maxStreamBytes) throw fail('too-big');
      const parms = streamParms(obj.dict);
      if (parms) {
        data = pngPredictor(data, parms);
        if (data.length > lim.maxStreamBytes) throw fail('too-big');
      }
    }
    state.total += data.length;
    if (state.total > lim.maxTotalBytes) throw fail('too-big');
    obj.decoded = data;
    return data;
  } finally { obj.decoding = false; }
}

function materializeObjectStreams(objects, lim, state) {
  const initial = [...objects.values()];
  for (const obj of initial) {
    if (!obj.dict || asName(obj.dict.map.get('Type')) !== 'ObjStm') continue;
    const n = asNumber(obj.dict.map.get('N')), first = asNumber(obj.dict.map.get('First'));
    if (!Number.isInteger(n) || !Number.isInteger(first) || n < 0 || first < 0 || n > lim.maxObjects) throw fail('corrupt');
    const data = decodeStream(obj, lim, state, false);
    if (first > data.length) throw fail('corrupt');
    const head = data.toString('latin1', 0, first);
    const entries = [];
    let p = 0;
    for (let i = 0; i < n; i++) {
      p = skip(head, p, head.length);
      const a = wordEnd(head, p, head.length), num = Number(head.slice(p, a)); p = skip(head, a, head.length);
      const b = wordEnd(head, p, head.length), off = Number(head.slice(p, b)); p = b;
      if (!Number.isInteger(num) || !Number.isInteger(off) || num < 0 || off < 0) throw fail('corrupt');
      entries.push({ num, off });
    }
    if (skip(head, p, head.length) !== head.length) throw fail('corrupt');
    for (let i = 0; i < entries.length; i++) {
      const from = first + entries[i].off, to = i + 1 < entries.length ? first + entries[i + 1].off : data.length;
      if (from > to || to > data.length) throw fail('corrupt');
      const body = data.toString('latin1', from, to);
      const parsed = parseValue(body, 0, body.length);
      if (parsed.value.type !== 'dict' || skip(body, parsed.pos, body.length) !== body.length) throw fail('corrupt');
      if (objects.size >= lim.maxObjects) throw fail('too-big');
      const key = String(entries[i].num) + ' 0';
      if (!objects.has(key)) objects.set(key, { num: entries[i].num, gen: 0, dict: parsed.value, stream: null, decoded: undefined, decoding: false });
    }
  }
}

function findRoot(source, objects) {
  let root = null;
  for (let p = 0; ;) {
    const at = findKeyword(source, 'trailer', p);
    if (at < 0) break;
    const q = skip(source, at + 7);
    try {
      const d = parseValue(source, q, source.length).value;
      if (d.type === 'dict' && d.map.get('Encrypt')) throw fail('encrypted');
      if (d.type === 'dict' && asRef(d.map.get('Root'))) root = d.map.get('Root');
    } catch (e) { if (e instanceof Fail && e.reason === 'encrypted') throw e; }
    p = at + 7;
  }
  for (const obj of objects.values()) {
    if (!obj.dict || asName(obj.dict.map.get('Type')) !== 'XRef') continue;
    if (obj.dict.map.get('Encrypt')) throw fail('encrypted');
    if (asRef(obj.dict.map.get('Root'))) root = obj.dict.map.get('Root');
  }
  if (!root) throw fail('corrupt');
  return root;
}

function validateXrefStreams(objects, lim, state) {
  for (const obj of objects.values()) {
    if (obj.dict && asName(obj.dict.map.get('Type')) === 'XRef') decodeStream(obj, lim, state, false);
  }
}

function pageTree(objects, rootRef, lim) {
  const root = getObject(objects, rootRef);
  if (!root.dict || asName(root.dict.map.get('Type')) !== 'Catalog') throw fail('corrupt');
  const start = asRef(root.dict.map.get('Pages'));
  if (!start) throw fail('corrupt');
  const pages = [], active = new Set(), seen = new Set();
  function walk(ref, inherited, depth) {
    if (depth >= MAX_DEPTH) throw fail('corrupt');
    const key = objectKey(ref);
    if (active.has(key) || seen.has(key)) throw fail('corrupt');
    active.add(key); seen.add(key);
    const obj = getObject(objects, ref), d = obj.dict;
    if (!d) throw fail('corrupt');
    const resources = d.map.get('Resources') ?? inherited;
    const kind = asName(d.map.get('Type'));
    if (kind === 'Pages' || d.map.has('Kids')) {
      const kids = d.map.get('Kids');
      if (!kids || kids.type !== 'array') throw fail('corrupt');
      for (const child of kids.value) {
        const r = asRef(child);
        if (!r) throw fail('corrupt');
        walk(r, resources, depth + 1);
      }
    } else if (kind === 'Page') {
      if (pages.length >= lim.maxPages) throw fail('too-big');
      pages.push({ obj, resources });
    } else throw fail('corrupt');
    active.delete(key);
  }
  walk(start, null, 0);
  if (!pages.length) throw fail('corrupt');
  return pages;
}

// 內容串流及 CMap 可有標記字典、程序括號和未受支援的語法。這裡只保留
// 抽字所需的運算元，其他資料一律有界地略過，避免一個頁面令整份檔失敗。
function skipContentDictionary(s, p, end, depth = 0) {
  let nesting = 1;
  p += 2;
  while (p < end) {
    p = skip(s, p, end);
    if (p >= end) return end;
    const c = s.charCodeAt(p);
    if (c === 60 && s.charCodeAt(p + 1) === 60) {
      if (++nesting > MAX_DEPTH || depth + nesting > MAX_DEPTH) return end;
      p += 2;
    } else if (c === 62 && s.charCodeAt(p + 1) === 62) {
      p += 2;
      if (--nesting === 0) return p;
    } else if (c === 40) {
      try { p = readLiteral(s, p, end, depth).pos; } catch { return end; }
    } else if (c === 60) {
      try { p = readHex(s, p, end).pos; } catch { return end; }
    } else p++;
  }
  return end;
}
function contentToken(s, p, end, depth = 0) {
  p = skip(s, p, end);
  if (p >= end) return null;
  const c = s.charCodeAt(p);
  if (c === 47) { const v = readName(s, p, end); return { ...v, value: { type: 'name', value: v.value.value } }; }
  if (c === 40) {
    try { return readLiteral(s, p, end, depth); }
    catch { return { value: { type: 'skip' }, pos: end }; }
  }
  if (c === 60) {
    if (s.charCodeAt(p + 1) === 60) return { value: { type: 'dict' }, pos: skipContentDictionary(s, p, end, depth) };
    try { return readHex(s, p, end); }
    catch { return { value: { type: 'skip' }, pos: end }; }
  }
  if (c === 91) {
    if (depth >= MAX_DEPTH) return { value: { type: 'skip' }, pos: end };
    const values = []; p++;
    for (;;) {
      p = skip(s, p, end);
      if (p >= end) return { value: { type: 'skip' }, pos: end };
      if (s.charCodeAt(p) === 93) return { value: { type: 'array', value: values }, pos: p + 1 };
      const v = contentToken(s, p, end, depth + 1);
      if (!v || v.pos <= p || (v.value.type === 'skip' && v.pos >= end)) return { value: { type: 'skip' }, pos: end };
      values.push(v.value); p = v.pos;
    }
  }
  // 程序括號及孤立收尾字元不是本工具的輸入；逐字略過便可繼續讀文字。
  if (c === 123 || c === 125 || c === 41 || c === 62 || c === 93) return { value: { type: 'skip' }, pos: p + 1 };
  const q = wordEnd(s, p, end);
  if (q === p) return { value: { type: 'skip' }, pos: p + 1 };
  return { value: atomValue(s.slice(p, q)), pos: q };
}
function skipInlineImage(s, p, end) {
  while (p < end) {
    const token = contentToken(s, p, end);
    if (!token || token.pos <= p) return end;
    p = token.pos;
    if (token.value.type !== 'word' || token.value.value !== 'ID') continue;
    if (p >= end || !white(s.charCodeAt(p))) return end;
    if (s.charCodeAt(p) === 13 && s.charCodeAt(p + 1) === 10) p += 2;
    else p++;
    // EI 只有在白字元之後、且其後為分隔字元或檔尾才是圖片結束標記。
    for (let q = p + 1; q + 1 < end; q++) {
      if (s.charCodeAt(q - 1) === 32 || s.charCodeAt(q - 1) === 9 || s.charCodeAt(q - 1) === 10 || s.charCodeAt(q - 1) === 12 || s.charCodeAt(q - 1) === 13 || s.charCodeAt(q - 1) === 0) {
        if (s.charCodeAt(q) === 69 && s.charCodeAt(q + 1) === 73 && (q + 2 >= end || delim(s.charCodeAt(q + 2)))) return q + 2;
      }
    }
    return end;
  }
  return end;
}

function utf16be(buf) {
  if (buf.length % 2) return '';
  let out = '';
  for (let i = 0; i < buf.length; i += 2048) {
    const units = [];
    for (let j = i; j < Math.min(buf.length, i + 2048); j += 2) units.push((buf[j] << 8) | buf[j + 1]);
    out += String.fromCharCode(...units);
  }
  return out;
}
function addUtf16be(buf, n) {
  const out = Buffer.from(buf);
  for (let i = out.length - 1; i >= 0 && n; i--) { const v = out[i] + (n & 255); out[i] = v & 255; n = (n >>> 8) + (v >>> 8); }
  return out;
}
function cmapTokens(data) {
  const s = data.toString('latin1'), out = [];
  let p = 0;
  while (p < s.length) {
    const v = contentToken(s, p, s.length);
    if (!v) break;
    out.push(v.value); p = v.pos;
  }
  return out;
}
function cmap(data) {
  const tokens = cmapTokens(data), exact = new Map(), ranges = [], spaces = [];
  const key = b => b.toString('hex');
  for (let i = 0; i < tokens.length; i++) {
    const tag = tokens[i]?.value;
    if (tag === 'begincodespacerange') {
      for (i++; i < tokens.length && tokens[i].value !== 'endcodespacerange'; i += 2) {
        if (tokens[i].type === 'hex' && tokens[i + 1]?.type === 'hex') spaces.push({ lo: tokens[i].value, hi: tokens[i + 1].value });
      }
    } else if (tag === 'beginbfchar') {
      for (i++; i < tokens.length && tokens[i].value !== 'endbfchar'; i += 2) {
        if (tokens[i].type === 'hex' && tokens[i + 1]?.type === 'hex') exact.set(key(tokens[i].value), utf16be(tokens[i + 1].value));
      }
    } else if (tag === 'beginbfrange') {
      for (i++; i < tokens.length && tokens[i].value !== 'endbfrange'; i += 3) {
        const a = tokens[i], b = tokens[i + 1], to = tokens[i + 2];
        if (a?.type !== 'hex' || b?.type !== 'hex' || !to) continue;
        if (to.type === 'hex') ranges.push({ a: a.value, b: b.value, to: to.value });
        else if (to.type === 'array' && to.value.every(x => x.type === 'hex')) ranges.push({ a: a.value, b: b.value, list: to.value.map(x => x.value) });
      }
    }
  }
  return {
    code(bytes) {
      const k = key(bytes);
      if (exact.has(k)) return exact.get(k);
      let value = 0;
      for (const b of bytes) value = value * 256 + b;
      for (const r of ranges) {
        if (r.a.length !== bytes.length || r.b.length !== bytes.length) continue;
        let lo = 0, hi = 0;
        for (const b of r.a) lo = lo * 256 + b;
        for (const b of r.b) hi = hi * 256 + b;
        if (value >= lo && value <= hi) {
          const off = value - lo;
          return utf16be(r.list ? (r.list[off] || Buffer.alloc(0)) : addUtf16be(r.to, off));
        }
      }
      return '';
    },
    spaces,
  };
}

function fontInfo(fontObj, objects, lim, state) {
  const d = fontObj.dict;
  if (!d) return null;
  const subtype = asName(d.map.get('Subtype'));
  if (subtype === 'Type3') return null;
  const type0 = subtype === 'Type0';
  if (type0 && asName(d.map.get('Encoding')) !== 'Identity-H') return null;
  let map = null;
  const tu = asRef(d.map.get('ToUnicode'));
  if (tu) {
    const cm = getObject(objects, tu);
    try { map = cmap(decodeStream(cm, lim, state, false)); } catch { return null; }
  }
  return { type0, map };
}

function cleanText(s) {
  let out = '';
  for (const ch of s) {
    const n = ch.charCodeAt(0);
    if (n === 9 || n >= 32) out += ch;
  }
  return out;
}
function decodeText(bytes, font) {
  if (!font) return '';
  let out = '';
  const width = font.type0 ? 2 : 1;
  for (let i = 0; i + width <= bytes.length; i += width) {
    const part = bytes.subarray(i, i + width);
    if (font.map) out += font.map.code(part);
    else if (!font.type0 && part[0] >= 32 && part[0] <= 126) out += String.fromCharCode(part[0]);
  }
  return cleanText(out);
}

function extractPage(page, objects, lim, state, fontCache) {
  const resource = directDict(page.resources, objects);
  const fonts = resource ? directDict(resource.map.get('Font'), objects) : null;
  const lookup = name => {
    if (!fonts) return null;
    const f = asRef(fonts.map.get(name));
    if (!f) return null;
    const k = objectKey(f);
    if (!fontCache.has(k)) fontCache.set(k, fontInfo(getObject(objects, f), objects, lim, state));
    return fontCache.get(k);
  };
  const lines = [], budget = { chars: 0 }, add = text => {
    if (!text) return;
    budget.chars += text.length;
    if (budget.chars > lim.maxOutputChars) throw fail('too-big');
    current += text;
  };
  let current = '', inText = false, font = null, y = null, saw = false;
  const newline = () => { lines.push(current); current = ''; budget.chars++; if (budget.chars > lim.maxOutputChars) throw fail('too-big'); };
  const operands = [];
  function run(op) {
    const last = () => operands[operands.length - 1];
    if (op === 'BT') { inText = true; operands.length = 0; return; }
    if (op === 'ET') { inText = false; operands.length = 0; return; }
    if (!inText) { operands.length = 0; return; }
    if (op === 'Tf') { const n = operands[operands.length - 2]; if (n?.type === 'name') font = lookup(n.value); operands.length = 0; return; }
    if (op === 'Tj') { const v = last(); if (v?.type === 'str' || v?.type === 'hex') { const t = decodeText(v.value, font); if (t) saw = true; add(t); } operands.length = 0; return; }
    if (op === 'TJ') {
      const a = last();
      if (a?.type === 'array') for (const v of a.value) {
        if (v.type === 'str' || v.type === 'hex') { const t = decodeText(v.value, font); if (t) saw = true; add(t); }
        else if (v.type === 'num' && v.value < -200) add(' ');
      }
      operands.length = 0; return;
    }
    if (op === "'" || op === '"') {
      newline();
      const v = last();
      if (v?.type === 'str' || v?.type === 'hex') { const t = decodeText(v.value, font); if (t) saw = true; add(t); }
      operands.length = 0; return;
    }
    if (op === 'T*') { newline(); operands.length = 0; return; }
    if (op === 'Td' || op === 'TD') {
      const ty = asNumber(operands[operands.length - 1]);
      if (ty !== null) { if (y !== null && ty !== 0) newline(); y = (y ?? 0) + ty; }
      operands.length = 0; return;
    }
    if (op === 'Tm') {
      const ny = asNumber(operands[operands.length - 1]);
      if (ny !== null) { if (y !== null && ny !== y) newline(); y = ny; }
      operands.length = 0; return;
    }
    operands.length = 0;
  }
  function content(data) {
    const s = data.toString('latin1');
    let p = 0;
    while (p < s.length) {
      const token = contentToken(s, p, s.length);
      if (!token) break;
      p = token.pos;
      if (token.value.type === 'word') {
        if (token.value.value === 'BI') { operands.length = 0; p = skipInlineImage(s, p, s.length); continue; }
        run(token.value.value);
      }
      else operands.push(token.value);
    }
  }
  const c = page.obj.dict.map.get('Contents');
  if (!c) return '';
  const refs = [];
  if (c.type === 'ref') refs.push(c);
  else if (c.type === 'array') for (const v of c.value) { if (v.type !== 'ref') throw fail('corrupt'); refs.push(v); }
  else throw fail('corrupt');
  for (const ref of refs) {
    const obj = getObject(objects, ref);
    const data = decodeStream(obj, lim, state, true);
    if (data) content(data);
  }
  if (current || lines.length) lines.push(current);
  if (!saw) return '';
  const out = [];
  let blank = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (!blank && out.length) out.push(''); blank = true; }
    else { out.push(line); blank = false; }
  }
  return out.join('\n');
}

export function pdfToText(buf, name, opts = {}) {
  const kind = 'pdf';
  try {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
    const lim = limitsOf(opts);
    if (buf.length > lim.maxFileBytes) return { ok: false, kind, reason: 'too-big' };
    const { source, objects } = scanObjects(buf, lim);
    const state = { total: 0 };
    const root = findRoot(source, objects);
    validateXrefStreams(objects, lim, state);
    materializeObjectStreams(objects, lim, state);
    const pages = pageTree(objects, root, lim), fontCache = new Map(), blocks = [];
    let any = false;
    for (let i = 0; i < pages.length; i++) {
      let text = '';
      try { text = extractPage(pages[i], objects, lim, state, fontCache); }
      catch (e) {
        if (e instanceof Fail && e.reason === 'too-big') throw e;
        // 頁面內容或其資源壞咗，只放棄該頁；檔頭、物件表、頁樹仍在上方驗證。
        text = '';
      }
      if (text) any = true;
      blocks.push('（第 ' + String(i + 1) + ' 頁）' + (text ? '\n' + text : ''));
    }
    if (!any) return { ok: false, kind, reason: 'empty' };
    const label = path.basename(String(name)).replace(/--+/g, '-').replace(/>/g, '＞');
    // 部分字型把常用字對照到外形相同的康熙部首、部首補充、相容漢字或半形標點（例如「⽣」U+2F63 而非「生」）：
    // 人眼看不出，但名單核對會配不上；只對這幾段字元做 NFKC，其餘全形標點照舊。
    // 部首補充區（U+2E80–2EFF）沒有 NFKC 對照，常用者按 Unicode EquivalentUnifiedIdeograph 對照表逐個還原
    const fixGlyphs = s => s.replace(/[⺀-⿟豈-﫿｡-､]/g, c => RADICAL_SUPPLEMENT[c.codePointAt(0)] ? String.fromCodePoint(RADICAL_SUPPLEMENT[c.codePointAt(0)]) : c.normalize('NFKC'));
    const text = '<!-- 由 CrewZero 從 ' + label + ' 轉出的文字版；圖片及版面未包括 -->\n\n' + fixGlyphs(blocks.join('\n\n')) + '\n';
    if (text.length > lim.maxOutputChars) return { ok: false, kind, reason: 'too-big' };
    return { ok: true, kind, text };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, kind, reason: e.reason };
    return { ok: false, kind, reason: e instanceof RangeError ? 'too-big' : 'corrupt' };
  }
}

export function writePdfSidecar(filePath, opts = {}) {
  const name = path.basename(String(filePath));
  let buf;
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return { ok: false, kind: 'pdf', reason: 'corrupt' };
    if (st.size > limitsOf(opts).maxFileBytes) return { ok: false, kind: 'pdf', reason: 'too-big' };
    buf = fs.readFileSync(filePath);
  } catch { return { ok: false, kind: 'pdf', reason: 'corrupt' }; }
  const r = pdfToText(buf, name, opts);
  if (!r.ok) return r;
  const sidecar = filePath + '.md';
  try { fs.writeFileSync(sidecar, r.text, 'utf8'); }
  catch { return { ok: false, kind: 'pdf', reason: 'corrupt' }; }
  return { ...r, sidecar };
}
