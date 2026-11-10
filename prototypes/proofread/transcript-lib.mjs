const LIMIT = 5_000_000;
const GENERIC_SOURCE = String.raw`(?:Speaker[ \t]*\d+|Unknown[ \t]+Speaker|講者[ \t]*\d+|讲者[ \t]*\d+|發言人[ \t]*\d+|发言人[ \t]*\d+|說話者[ \t]*\d+|说话人[ \t]*\d+)`;

export const GENERIC = new RegExp(`^${GENERIC_SOURCE}$`, 'iu');

const GENERIC_FINDER = new RegExp(
  String.raw`(?:^|[^\p{L}\p{N}_])(${GENERIC_SOURCE})(?![\p{L}\p{N}_])`,
  'giu',
);
const PAGE_LINE = /^\s*[（(]第\s*\d+\s*頁[）)]\s*$/u;
const COMMENT_LINE = /^\s*<!--.*-->\s*$/u;

function limitedText(value) {
  return typeof value === 'string' ? value.slice(0, LIMIT) : '';
}

function isSpeakerLabel(value) {
  return value.length > 0
    && value.length <= 120
    && !/[\r\n<>{}\[\]。！？!?；;]/u.test(value)
    && !PAGE_LINE.test(value)
    && !COMMENT_LINE.test(value);
}

function isTime(value) {
  const parts = value.split(':');
  if (parts.length !== 2 && parts.length !== 3) return false;
  if (parts[0].length < 1 || parts[0].length > 2) return false;
  for (let index = 1; index < parts.length; index += 1) {
    if (parts[index].length !== 2) return false;
  }
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      const code = part.charCodeAt(index);
      if (code < 48 || code > 57) return false;
    }
  }
  return true;
}

function firstGap(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === ' ' || value[index] === '\t') return index;
  }
  return -1;
}

function lastGap(value) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === ' ' || value[index] === '\t') return index;
  }
  return -1;
}

function header(line) {
  const clean = line.trim();
  const first = firstGap(clean);
  if (first > 0) {
    const at = clean.slice(0, first);
    const speaker = clean.slice(first).trim();
    if (isTime(at) && isSpeakerLabel(speaker)) {
      return { speaker, generic: GENERIC.test(speaker), at };
    }
  }

  if (clean.endsWith(')')) {
    const open = clean.lastIndexOf('(');
    if (open > 0) {
      const speaker = clean.slice(0, open).trim();
      const at = clean.slice(open + 1, -1).trim();
      if (isTime(at) && isSpeakerLabel(speaker)) {
        return { speaker, generic: GENERIC.test(speaker), at };
      }
    }
  }

  const last = lastGap(clean);
  if (last > 0) {
    const speaker = clean.slice(0, last).trim();
    const at = clean.slice(last).trim();
    if (isTime(at) && isSpeakerLabel(speaker)) {
      return { speaker, generic: GENERIC.test(speaker), at };
    }
  }

  return null;
}

function ignored(line) {
  return line.trim() === '' || PAGE_LINE.test(line) || COMMENT_LINE.test(line);
}

function ownValue(map, label) {
  if (!map || typeof map !== 'object' || !Object.prototype.hasOwnProperty.call(map, label)) {
    return '';
  }
  return typeof map[label] === 'string' ? map[label].trim() : '';
}

function uniqueLabels(turns, predicate) {
  const labels = [];
  const seen = new Set();
  for (const turn of turns) {
    if (predicate(turn) && !seen.has(turn.speaker)) {
      seen.add(turn.speaker);
      labels.push(turn.speaker);
    }
  }
  return labels;
}

export function parseTurns(text) {
  const turns = [];
  let current = null;

  for (const line of limitedText(text).split(/\r\n|\n|\r/u)) {
    if (line.trim() === '') {
      if (current) {
        turns.push({ ...current, text: current.lines.join(' ').trim() });
        current = null;
      }
      continue;
    }
    if (ignored(line)) continue;

    const found = header(line);
    if (found) {
      if (current) turns.push({ ...current, text: current.lines.join(' ').trim() });
      current = { ...found, lines: [] };
    } else if (current) {
      current.lines.push(line.trim());
    }
  }

  if (current) turns.push({ ...current, text: current.lines.join(' ').trim() });
  return turns.map(({ lines, ...turn }) => turn);
}

export function detect(text) {
  const parsed = parseTurns(text);
  const generic = uniqueLabels(parsed, (turn) => turn.generic);
  const named = uniqueLabels(parsed, (turn) => !turn.generic);
  const stamps = parsed.length;
  return {
    transcript: stamps >= 5 && (generic.length >= 1 || named.length >= 2),
    generic,
    named,
    turns: parsed.length,
    stamps,
  };
}

// 例句供創辦人辨認講者：優先揀較完整的句子（「嗯」「OK」等短句幫助不大），不足才用短句補上；輸出保持原文次序
export function samples(text, speaker, n = 3, max = 60, minChars = 8) {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 3;
  const width = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 60;
  const least = Number.isFinite(minChars) ? Math.max(0, Math.floor(minChars)) : 8;
  const turns = parseTurns(text).filter((turn) => turn.speaker === speaker && turn.text);
  const picked = turns.filter((turn) => turn.text.length >= least).slice(0, count);
  for (const turn of turns) { if (picked.length >= count) break; if (!picked.includes(turn)) picked.push(turn); }
  return turns.filter((turn) => picked.includes(turn))
    .map((turn) => (turn.text.length > width ? `${turn.text.slice(0, width)}…` : turn.text));
}

export function formatMap(map) {
  const pairs = [];
  if (map && typeof map === 'object') {
    for (const [label, name] of Object.entries(map)) {
      const cleanLabel = label.trim();
      const cleanName = typeof name === 'string' ? name.trim() : '';
      if (cleanLabel && cleanName) pairs.push(`${cleanLabel}＝${cleanName}`);
    }
  }
  return `講者對照：${pairs.join('；')}`;
}

export function parseMap(text) {
  const map = {};
  for (const line of limitedText(text).split(/\r\n|\n|\r/u)) {
    const found = /^\s*講者對照\s*[:：]\s*(.*)$/u.exec(line);
    if (!found) continue;
    for (const pair of found[1].split(/[；;]/u)) {
      const divider = pair.search(/[＝=]/u);
      if (divider < 0) continue;
      const label = pair.slice(0, divider).trim();
      const name = pair.slice(divider + 1).trim();
      if (label && name) map[label] = name;
    }
  }
  return map;
}

export function gate(founderText, transcriptTexts = []) {
  const map = parseMap(founderText);
  const missing = [];
  const seen = new Set();
  let transcripts = 0;
  const texts = Array.isArray(transcriptTexts) ? transcriptTexts : [];

  for (const text of texts) {
    const result = detect(text);
    if (!result.transcript) continue;
    transcripts += 1;
    for (const label of result.generic) {
      if (!ownValue(map, label) && !seen.has(label)) {
        seen.add(label);
        missing.push(label);
      }
    }
  }

  return { ok: missing.length === 0, missing, transcripts };
}

export function applyMap(text, map) {
  const original = typeof text === 'string' ? text : '';
  const prefix = original.slice(0, LIMIT);
  const suffix = original.slice(LIMIT);
  const parts = prefix.split(/(\r\n|\n|\r)/u);

  for (let index = 0; index < parts.length; index += 2) {
    const found = header(parts[index]);
    const name = found?.generic ? ownValue(map, found.speaker) : '';
    if (!name) continue;
    const at = parts[index].indexOf(found.speaker);
    if (at >= 0) {
      parts[index] = `${parts[index].slice(0, at)}${name}${parts[index].slice(at + found.speaker.length)}`;
    }
  }

  return `${parts.join('')}${suffix}`;
}

export function unmappedIn(text, map = {}) {
  const labels = [];
  const seen = new Set();
  const source = limitedText(text);
  const finder = new RegExp(GENERIC_FINDER.source, GENERIC_FINDER.flags);
  let found;

  while ((found = finder.exec(source)) !== null) {
    const label = found[1];
    if (!ownValue(map, label) && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

// 會議紀錄草稿的標示（規格見 meeting-minutes-format.md「不肯定內容標示」）：
// ⚠️ 不肯定，請核對；✏️ 待你補充。頂部說明行（以「> ⚠️ 不肯定」開頭）不計。
const MARK_KINDS = [['⚠', 'unsure'], ['✏', 'fill']];
export function marks(text) {
  const out = [];
  let section = '';
  const lines = limitedText(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const head = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (head) { section = head[1]; continue; }
    if (/^>\s*⚠️?\s*不肯定/.test(line)) continue;
    let p = 0;
    while (p < line.length) {
      let hit = -1, kind = '';
      for (const [sym, k] of MARK_KINDS) { const q = line.indexOf(sym, p); if (q >= 0 && (hit < 0 || q < hit)) { hit = q; kind = k; } }
      if (hit < 0) break;
      let q = hit + 1;
      if (line.charCodeAt(q) === 0xFE0F) q++;
      let reason = '';
      if (line[q] === '（') { const end = line.indexOf('）', q + 1); if (end > q) { reason = line.slice(q + 1, end).trim(); q = end + 1; } }
      out.push({ kind, line: i + 1, section, reason, text: line.trim().slice(0, 120) });
      p = q;
    }
  }
  return out;
}
// 頂部說明行：按現有標示重算數目
export function markLegend(text) {
  const list = marks(text);
  const unsure = list.filter((m) => m.kind === 'unsure').length, fill = list.filter((m) => m.kind === 'fill').length;
  return `> ⚠️ 不肯定，請核對（共 ${unsure} 處）　✏️ 待你補充（共 ${fill} 處）`;
}
