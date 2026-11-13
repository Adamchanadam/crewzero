// 會議紀錄格式檢查：純函數，不讀寫檔案、不呼叫 AI。
import { markLegend, marks, unmappedIn } from './transcript-lib.mjs';

// 新格式固定的十個段落，次序同範本一致。
export const MINUTES_HEADINGS_V2 = ['會議資料', '參加者', '議題及討論要點', '已發生的事實', '對方的說法及承諾', '雙方決定', '待辦', '未定事項', '下次會議', '改動清單'];
// 舊格式維持接受，避免既有會議紀錄被新版規則攔下。
export const MINUTES_HEADINGS_V1 = ['參加者', '已發生的事實', '對方的說法及承諾', '雙方決定', '待辦', '未定事項', '改動清單'];

const HEADING = /^##\s+(.+?)\s*$/u;
const EMPTY = /^-\s*沒有\s*[。．]?\s*$/u;
const QUOTE_WARNING = '⚠️（引句未能在逐字稿找到，請核對）';
const DATE_WARNING = '⚠️（日期由程式標示，請核對）';
const MISSING_OWNER = '✏️（請補負責人）';
const MISSING_DATE = '日期待定 ✏️（請補日期）';

const cleanText = value => String(value == null ? '' : value).replace(/\r\n/g, '\n');
const linesOf = value => cleanText(value).split('\n');
const headingOf = line => {
  const found = HEADING.exec(String(line || '').trim());
  return found ? found[1] : '';
};
const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function blocksOf(text) {
  const lines = linesOf(text), blocks = new Map();
  let current = '';
  for (let index = 0; index < lines.length; index++) {
    const heading = headingOf(lines[index]);
    if (heading) {
      current = heading;
      if (!blocks.has(current)) blocks.set(current, { heading, at: index, lines: [] });
      continue;
    }
    if (current) blocks.get(current).lines.push({ text: lines[index], at: index });
  }
  return { lines, blocks };
}

function normQuote(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/[，、]/g, ',').replace(/[。．]/g, '.').replace(/[：]/g, ':').replace(/[；]/g, ';').replace(/[！]/g, '!').replace(/[？]/g, '?').replace(/[「『]/g, '"').replace(/[」』]/g, '"').replace(/\s+/g, '');
}

function sectionRows(block) {
  return (block ? block.lines : []).map(row => ({ ...row, value: row.text.trim() })).filter(row => row.value);
}

function numberedRows(block, label) {
  const rows = sectionRows(block).filter(row => !EMPTY.test(row.value));
  const found = rows.map(row => ({ ...row, match: new RegExp(`^-\\s*${escape(label)}\\s+(\\d+)\\s*[：:]\\s*(.+)$`, 'u').exec(row.value) }));
  return { rows, found };
}

function checkNumbered(errors, block, label) {
  const { rows, found } = numberedRows(block, label);
  if (!rows.length) return;
  if (found.some(row => !row.match)) errors.push(`「${label}」每項須寫成「- ${label} N：…」。`);
  const numbers = found.filter(row => row.match).map(row => Number(row.match[1]));
  if (numbers.length === rows.length && numbers.some((number, index) => number !== index + 1)) errors.push(`「${label}」編號須由 1 連續。`);
}

function todoParts(value) {
  const start = /^-\s*待辦\s+(\d+)\s*(?:｜\s*(.*))?$/u.exec(String(value || '').trim());
  if (!start) return null;
  const fields = new Map();
  for (const found of String(start[2] || '').matchAll(/(?:^|｜)\s*(負責人|期限|事項)\s*：\s*([^｜]*)/gu)) fields.set(found[1], found[2].trim());
  return { number: Number(start[1]), owner: fields.get('負責人') || '', due: fields.get('期限') || '', action: fields.get('事項') || '', fields };
}

// 日期前可有一個或多個「⚠️（…）」核對標示（範本的「由某相對日期換算」或程式的標示），之後須是完整日期。
function hasFullDate(value) {
  return /^\s*(?:⚠️?（[^）]*）\s*)*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*$/u.test(String(value || ''));
}

// 日期前已有任何「⚠️（…）」核對標示，即已提醒創辦人核對，不用再加程式標示。
function dateFlagged(value) {
  return /⚠️?（[^）]*）\s*\d{4}\s*年/u.test(String(value || ''));
}

// 中文數字（一至三十一）轉阿拉伯數字，供逐字稿日期比對；不認得時回傳空字串。
function cnNumber(text) {
  const digits = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const s = String(text || '');
  if (!s) return '';
  if (s === '十') return '10';
  const at = s.indexOf('十');
  if (at < 0) return s.length === 1 && s in digits ? String(digits[s]) : '';
  const tens = at === 0 ? 1 : digits[s.slice(0, at)], ones = at === s.length - 1 ? 0 : digits[s.slice(at + 1)];
  return tens === undefined || ones === undefined || s.length > 3 ? '' : String(tens * 10 + ones);
}

function dateParts(value) {
  const found = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/u.exec(String(value || ''));
  return found ? { month: Number(found[2]), day: Number(found[3]) } : null;
}

function transcriptHasDate(transcript, month, day) {
  const raw = String(transcript || '').normalize('NFKC').replace(/\s+/g, '');
  if (!raw) return false;
  // 「十一月二十日」等中文數字日期先轉為「11月20日」再比對
  const source = raw.replace(/([〇零一二兩三四五六七八九十]{1,3})月([〇零一二兩三四五六七八九十]{1,3})(日|號)/gu, (all, mo, da, tail) => {
    const m2 = cnNumber(mo), d2 = cnNumber(da);
    return m2 && d2 ? `${m2}月${d2}${tail}` : all;
  });
  const m = String(month), d = String(day);
  return new RegExp(`${escape(m)}月${escape(d)}(?:日|號|(?=[^\d]))|${escape(d)}/${escape(m)}(?:$|[^\d])`, 'u').test(source);
}

function participantRows(block) {
  return sectionRows(block).filter(row => !EMPTY.test(row.value));
}

function declaredSpeakerCount(rows) {
  for (const row of rows) {
    const found = /逐字稿有\s*(\d+)\s*位講者/u.exec(row.value);
    if (found) return Number(found[1]);
  }
  return 0;
}

function isDatePending(value) {
  return /日期待定/u.test(String(value || '')) && /✏️?（[^）]*日期[^）]*）/u.test(String(value || ''));
}

function v1Check(text, map, errors) {
  const { lines, blocks } = blocksOf(text);
  for (const heading of MINUTES_HEADINGS_V1) if (!blocks.has(heading)) errors.push(`缺少「${heading}」。`);
  const changes = blocks.get('改動清單');
  if (changes && !sectionRows(changes).length) errors.push('改動清單沒有內容。');
  const missing = unmappedIn(lines.join('\n'), map || {});
  if (missing.length) errors.push(`仍有未對照講者：${missing.join('、')}。`);
}

// 判斷文字屬新版還是舊版；只要有一個新增段落便按新版處理。
export function minutesFormat(text) {
  const { blocks } = blocksOf(text);
  return ['會議資料', '議題及討論要點', '下次會議'].some(heading => blocks.has(heading)) ? 'v2' : 'v1';
}

// 接受「會議紀錄.md」及帶日期或主題前綴的會議紀錄檔名。
export function isMinutesFileName(name) {
  const value = String(name || '');
  return value === '會議紀錄.md' || value.endsWith('會議紀錄.md');
}

// 核對新舊會議紀錄，回傳可展示的錯誤及可由程式補上的修正項目。
export function checkMinutes(text, { transcript = '', speakers = 0, map = {} } = {}) {
  const errors = [], fixes = [], value = cleanText(text), format = minutesFormat(value);
  if (!value.trim()) errors.push('會議紀錄沒有內容。');
  if (format === 'v1') {
    if (value.length > 60000) errors.push('草稿內容不完整或過長。');
    v1Check(value, map, errors);
    return { ok: !errors.length, format, errors, fixes };
  }
  if ([...value].length > 4500) errors.push('會議紀錄超過 4,500 字。');

  const { lines, blocks } = blocksOf(value);
  for (const heading of MINUTES_HEADINGS_V2) {
    const block = blocks.get(heading);
    if (!block) {
      errors.push(`缺少「${heading}」。`);
      continue;
    }
    if (!sectionRows(block).length) {
      errors.push(`「${heading}」沒有內容。`);
      fixes.push(`在「${heading}」補上「- 沒有」。`);
    }
  }
  const positions = MINUTES_HEADINGS_V2.map(heading => lines.findIndex(line => headingOf(line) === heading));
  if (positions.every(position => position >= 0) && positions.some((position, index) => index > 0 && position < positions[index - 1])) errors.push('十個段落須按會議資料至改動清單的固定次序排列。');

  const todoBlock = blocks.get('待辦'), todoRows = sectionRows(todoBlock).filter(row => !EMPTY.test(row.value));
  if (todoRows.length) {
    const numbers = [];
    for (const row of todoRows) {
      const todo = todoParts(row.value);
      if (!todo || !todo.action) {
        errors.push('待辦每項須寫成「- 待辦 N｜負責人：…｜期限：…｜事項：…」。');
        continue;
      }
      numbers.push(todo.number);
      if (!todo.owner) {
        errors.push(`待辦 ${todo.number} 沒有負責人。`);
        fixes.push(`為待辦 ${todo.number} 補上「${MISSING_OWNER}」。`);
      }
      if (!todo.due) {
        errors.push(`待辦 ${todo.number} 沒有期限。`);
        fixes.push(`為待辦 ${todo.number} 補上「${MISSING_DATE}」。`);
      } else if (!hasFullDate(todo.due) && !isDatePending(todo.due)) {
        errors.push(`待辦 ${todo.number} 的期限須為完整日期，或「日期待定」加待補標示。`);
      } else if (hasFullDate(todo.due)) {
        const date = dateParts(todo.due);
        if (date && !transcriptHasDate(transcript, date.month, date.day) && !dateFlagged(todo.due)) {
          errors.push(`待辦 ${todo.number} 的日期未能在逐字稿找到，請標示核對。`);
          fixes.push(`在待辦 ${todo.number} 的期限前加「${DATE_WARNING}」。`);
        }
      }
    }
    if (numbers.length === todoRows.length && numbers.some((number, index) => number !== index + 1)) errors.push('「待辦」編號須由 1 連續。');
  }

  const promiseRows = sectionRows(blocks.get('對方的說法及承諾')).filter(row => !EMPTY.test(row.value));
  if (transcript && promiseRows.length) {
    const source = normQuote(transcript);
    for (const row of promiseRows) {
      const quotes = [...row.value.matchAll(/「([^」]+)」/gu)].map(found => found[1]);
      const matched = quotes.length && quotes.every(quote => source.includes(normQuote(quote)));
      if (!matched && !row.value.includes(QUOTE_WARNING)) {
        errors.push('「對方的說法及承諾」每項須有可在逐字稿找到的「」引句。');
        fixes.push(`在未核對的說法末尾加「${QUOTE_WARNING}」。`);
      }
    }
  }

  const participant = participantRows(blocks.get('參加者'));
  const speakerCount = Number.isInteger(speakers) && speakers > 0 ? speakers : 0;
  if (speakerCount && Math.max(participant.length, declaredSpeakerCount(participant)) < speakerCount) {
    errors.push(`逐字稿有 ${speakerCount} 位講者，參加者尚未列齊。`);
    fixes.push(`在「參加者」加「- ✏️（逐字稿有 ${speakerCount} 位講者，請補參加者）」。`);
  }

  checkNumbered(errors, blocks.get('雙方決定'), '決定');
  checkNumbered(errors, blocks.get('未定事項'), '未定');
  const changes = blocks.get('改動清單');
  if (changes && !sectionRows(changes).length) errors.push('改動清單沒有內容。');
  const missing = unmappedIn(value, map || {});
  if (missing.length) errors.push(`仍有未對照講者：${missing.join('、')}。`);
  return { ok: !errors.length, format, errors, fixes: [...new Set(fixes)] };
}

function rewriteLegend(text) {
  const lines = linesOf(text).filter(line => !/^>\s*⚠️?\s*不肯定/u.test(line) && line.trim() !== '逐字稿聲音不清的地方較多，建議先核對講者及數字。');
  const titleAt = lines.findIndex(line => /^#\s+\S/u.test(line));
  if (titleAt < 0) return cleanText(text);
  const body = lines.join('\n'), extra = marks(body).length > 20 ? ['逐字稿聲音不清的地方較多，建議先核對講者及數字。'] : [];
  lines.splice(titleAt + 1, 0, markLegend(body), ...extra);
  return lines.join('\n').replace(/\n+$/u, '') + '\n';
}

// 缺少的節按固定次序插回（插在下一個已有的節之前；後面沒有節就放在最後），內容先留空，交 fillEmptySections 補「沒有」。
function insertMissingSections(lines) {
  const blocks = blocksOf(lines.join('\n')).blocks;
  for (let index = 0; index < MINUTES_HEADINGS_V2.length; index++) {
    const heading = MINUTES_HEADINGS_V2[index];
    if (blocks.has(heading)) continue;
    const next = MINUTES_HEADINGS_V2.slice(index + 1).find(name => blocks.has(name));
    const at = next ? blocks.get(next).at : lines.length;
    const insert = ['## ' + heading, ''];
    if (at > 0 && String(lines[at - 1] || '').trim() !== '') insert.unshift('');
    lines.splice(at, 0, ...insert);
    return insertMissingSections(lines);
  }
  return lines;
}

function fillEmptySections(lines) {
  lines = insertMissingSections(lines);
  const blocks = blocksOf(lines.join('\n')).blocks;
  for (const heading of MINUTES_HEADINGS_V2) {
    const block = blocks.get(heading);
    if (!block || sectionRows(block).length) continue;
    lines.splice(block.at + 1, 0, '- 沒有');
    return fillEmptySections(lines);
  }
  return lines;
}

function fixTodoLine(line, transcript) {
  const todo = todoParts(line);
  if (!todo || !todo.action) return line;
  const owner = todo.owner || MISSING_OWNER;
  let due = todo.due || MISSING_DATE;
  if (hasFullDate(due)) {
    const date = dateParts(due);
    if (date && !transcriptHasDate(transcript, date.month, date.day) && !dateFlagged(due)) due = DATE_WARNING + due;
  }
  return `- 待辦 ${todo.number}｜負責人：${owner}｜期限：${due}｜事項：${todo.action}`;
}

function fixSections(lines, transcript, speakers) {
  let active = '';
  const participantRows = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = headingOf(lines[index]);
    if (heading) { active = heading; continue; }
    if (active === '待辦' && /^-\s*待辦\s+\d+/u.test(lines[index].trim())) lines[index] = fixTodoLine(lines[index], transcript);
    if (active === '對方的說法及承諾' && transcript && lines[index].trim() && !EMPTY.test(lines[index].trim()) && !lines[index].includes(QUOTE_WARNING)) {
      const quotes = [...lines[index].matchAll(/「([^」]+)」/gu)].map(found => found[1]);
      const found = quotes.length && quotes.every(quote => normQuote(transcript).includes(normQuote(quote)));
      if (!found) lines[index] = lines[index].replace(/\s*$/u, '') + QUOTE_WARNING;
    }
    if (active === '參加者') {
      if (lines[index].trim() && !EMPTY.test(lines[index].trim())) participantRows.push(lines[index]);
    }
  }
  const count = Number.isInteger(speakers) && speakers > 0 ? speakers : 0;
  if (count && Math.max(participantRows.length, declaredSpeakerCount(participantRows.map(text => ({ value: String(text).trim() })))) < count) {
    const headingAt = lines.findIndex(line => headingOf(line) === '參加者');
    if (headingAt >= 0) {
      let at = headingAt + 1;
      while (at < lines.length && !headingOf(lines[at])) at++;
      lines.splice(at, 0, `- ✏️（逐字稿有 ${count} 位講者，請補參加者）`);
    }
  }
  return lines;
}

// 只作可預測的文字補正，並重寫頂部標示說明行；不寫入任何檔案。
export function fixMinutes(text, { transcript = '', speakers = 0 } = {}) {
  let lines = linesOf(text);
  if (minutesFormat(text) === 'v2') {
    lines = fillEmptySections(lines);
    lines = fixSections(lines, transcript, speakers);
  }
  return rewriteLegend(lines.join('\n'));
}
