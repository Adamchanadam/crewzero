// 商業模式卡的解析及選卡核對；只讀卡片檔，方便外殼和測試共用。
import fs from 'node:fs';
import path from 'node:path';

export const FACES = Object.freeze(['charge', 'form', 'scale']);
export const CARD_ID = /\b[CS]\d{2}\b/g;

const cache = new Map();
const faceNames = { charge: '收錢', form: '賣甚麼形態', scale: '怎樣擴大' };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const clean = value => String(value == null ? '' : value).trim();
const chars = value => Array.from(String(value == null ? '' : value)).length;
const clone = value => JSON.parse(JSON.stringify(value));
const faces = value => FACES.includes(value) ? value : '';

function section(text, heading) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex(line => line.startsWith(heading));
  if (start < 0) return { lines: [], start: -1 };
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return { lines: lines.slice(start + 1, end < 0 ? undefined : end), start };
}

function tableRows(lines, startLine, problems, label) {
  const rows = [];
  lines.forEach((line, index) => {
    if (!/^\s*\|/.test(line) || /^\s*\|\s*[-: ]+\|/.test(line)) return;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(clean);
    if (!cells.length || cells[0] === '問題' || cells[0] === '指標' || cells[0] === '編號') return;
    if (cells.length < 2) problems.push(`第 ${startLine + index + 1} 行的${label}表格欄位不足。`);
    else rows.push({ cells, line: startLine + index + 1 });
  });
  return rows;
}

function field(block, label) {
  const line = block.lines.find(value => value.startsWith(`- ${label}：`));
  return line ? clean(line.slice(label.length + 3)) : '';
}

function listField(block, label) {
  const at = block.lines.findIndex(value => value.startsWith(`- ${label}：`));
  if (at < 0) return [];
  const values = [];
  for (let index = at + 1; index < block.lines.length; index++) {
    const line = block.lines[index];
    if (/^- [^\s].*：/.test(line)) break;
    const match = /^\s+-\s+(.+)$/.exec(line);
    if (match) values.push(clean(match[1]));
  }
  return values.filter(Boolean);
}

function cardBlocks(lines, firstLine, problems) {
  const result = [];
  let face = '';
  for (let index = 0; index < lines.length; index++) {
    const sub = /^###\s+4\.([123])\s+/.exec(lines[index]);
    if (sub) { face = ['charge', 'form', 'scale'][Number(sub[1]) - 1]; continue; }
    const title = /^####\s+(.+)$/.exec(lines[index]);
    if (!title) continue;
    const end = lines.findIndex((line, next) => next > index && /^####\s+|^###\s+|^##\s+/.test(line));
    const block = { name: clean(title[1]), face, lines: lines.slice(index + 1, end < 0 ? undefined : end), line: firstLine + index + 1 };
    const id = field(block, '編號');
    if (!face) problems.push(`第 ${block.line} 行的核心卡「${block.name}」不在已知面向。`);
    if (!/^C\d{2}$/.test(id)) problems.push(`第 ${block.line} 行的核心卡「${block.name}」缺少正確編號。`);
    const card = {
      id, name: block.name, en: field(block, '英文名'), face, logic: field(block, '核心邏輯'),
      fit: listField(block, '適合信號'), unfit: listField(block, '不適合信號'),
      metrics: field(block, '關鍵指標').split('、').map(clean).filter(Boolean),
      traps: listField(block, '常見陷阱'), firstTest: field(block, '第一個驗證'),
      combos: field(block, '常見組合').split('、').map(clean).filter(Boolean)
    };
    if (!card.logic || !card.fit.length || !card.traps.length || !card.firstTest) problems.push(`第 ${block.line} 行的核心卡「${block.name}」缺少必要內容。`);
    result.push(card);
    index = end < 0 ? lines.length : end - 1;
  }
  return result;
}

function extraRows(lines, firstLine, problems) {
  const rows = [];
  let face = '';
  for (let index = 0; index < lines.length; index++) {
    const sub = /^###\s+5\.([123])\s+/.exec(lines[index]);
    if (sub) { face = ['charge', 'form', 'scale'][Number(sub[1]) - 1]; continue; }
    const line = lines[index];
    if (!/^\s*\|/.test(line) || /^\s*\|\s*[-: ]+\|/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(clean);
    if (cells[0] === '編號') continue;
    if (cells.length < 5) { problems.push(`第 ${firstLine + index + 1} 行的補充模式表格欄位不足。`); continue; }
    const [id, name, en, desc, when] = cells;
    if (!/^S\d{2}$/.test(id) || !name || !desc || !when || !face) problems.push(`第 ${firstLine + index + 1} 行的補充模式資料不完整。`);
    rows.push({ id, name, en, face, desc, when });
  }
  return rows;
}

// 解析商業模式卡 Markdown，格式問題以 problems 回報，不會拋出例外。
export function parseModelCards(text) {
  const source = String(text == null ? '' : text);
  const problems = [], diagnostics = [], metrics = [], cards = [], extras = [], byId = {};
  const d = section(source, '## 2.');
  if (d.start < 0) problems.push('找不到第 2 節診斷問題。');
  else tableRows(d.lines, d.start + 1, problems, '診斷問題').forEach((row, index) => diagnostics.push({ n: index + 1, ask: row.cells[0], prefers: row.cells[1].split('、').map(clean).filter(Boolean) }));
  const m = section(source, '## 3.');
  if (m.start < 0) problems.push('找不到第 3 節指標詞彙。');
  else tableRows(m.lines, m.start + 1, problems, '指標詞彙').forEach(row => metrics.push({ name: row.cells[0], meaning: row.cells[1] || '', formula: row.cells[2] || '' }));
  const core = section(source, '## 4.');
  if (core.start < 0) problems.push('找不到第 4 節核心模式卡。');
  else cards.push(...cardBlocks(core.lines, core.start + 1, problems));
  const extra = section(source, '## 5.');
  if (extra.start < 0) problems.push('找不到第 5 節補充模式。');
  else extras.push(...extraRows(extra.lines, extra.start + 1, problems));
  for (const item of [...cards, ...extras]) {
    if (!item.id) continue;
    if (byId[item.id]) problems.push(`模式卡編號「${item.id}」重複。`);
    else byId[item.id] = item;
  }
  return { ok: problems.length === 0, problems, diagnostics, metrics, cards, extras, byId };
}

// 讀取資料夾內的卡片檔，按修改時間快取已解析結果。
export function loadModelCards(dir) {
  try {
    const file = path.join(dir, 'model-cards.md'), stat = fs.statSync(file), prior = cache.get(file);
    if (prior && prior.mtimeMs === stat.mtimeMs) return prior.value;
    const value = parseModelCards(fs.readFileSync(file, 'utf8'));
    cache.set(file, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch (error) {
    return { ok: false, problems: [`未能讀取商業模式卡：${error.message}`], diagnostics: [], metrics: [], cards: [], extras: [], byId: {} };
  }
}

// 比較兩句卡片引文，忽略頭尾及全形或半形空白，亦忽略句末句號。
export function sameSentence(a, b) {
  const normalise = value => clean(value).replace(/[\s\u3000]+/g, '').replace(/。+$/, '');
  return normalise(a) === normalise(b);
}

// 取得模式卡的中文名稱；找不到卡片時回傳空字串。
export function cardLabel(id, lib) {
  return clean(lib?.byId?.[id]?.name);
}

function containsCardId(value) {
  CARD_ID.lastIndex = 0;
  return CARD_ID.test(String(value == null ? '' : value));
}

function commonRun(a, b, length = 6) {
  const left = Array.from(String(a || '').replace(/[\s\u3000]+/g, ''));
  const right = Array.from(String(b || '').replace(/[\s\u3000]+/g, '')).join('');
  for (let index = 0; index + length <= left.length; index++) if (right.includes(left.slice(index, index + length).join(''))) return true;
  return false;
}

function hasSourceQuote(quote, source) {
  return clean(source).includes(clean(quote));
}

function problemForCard(model, card, fallback) {
  for (const face of FACES) {
    const index = Array.isArray(model?.faces?.[face]) ? model.faces[face].findIndex(item => item?.card === card?.id) : -1;
    if (index >= 0) return { face, index };
  }
  return { face: card?.face || fallback, index: -1 };
}

// 核對一個模式組合是否逐字引用有效卡片，並回傳可安全顯示的清理版本。
export function checkModelPick(model, lib, { answers, needDiagnosis } = {}) {
  const input = model && typeof model === 'object' ? model : {};
  const safeLib = lib && typeof lib === 'object' ? lib : { byId: {} };
  const problems = [], cleaned = clone(input);
  cleaned.faces = {};
  const add = (face, index, why) => problems.push({ face, index, why });
  for (const face of FACES) {
    const original = input.faces?.[face], selected = Array.isArray(original) ? original : [];
    const kept = [];
    selected.forEach((pick, index) => {
      const id = clean(pick?.card), card = safeLib.byId?.[id];
      if (!card) { add(face, index, `${faceNames[face]}面向的卡「${id || '未填'}」不存在，請改用這個面向的有效模式卡。`); return; }
      if (card.face !== face) { add(face, index, `${faceNames[face]}面向的卡「${id}」屬於${faceNames[card.face] || '其他'}，請移到正確面向或換卡。`); return; }
      let valid = true;
      const quote = clean(pick?.quote);
      if (id.startsWith('C') ? !card.fit.some(sentence => sameSentence(sentence, quote)) : chars(quote) < 8 || !String(card.when || '').includes(quote)) {
        add(face, index, `${faceNames[face]}面向的卡「${id}」引文不合格，請逐字引用適合信號${id.startsWith('S') ? '或「何時考慮」連續至少 8 字原文' : ''}。`); valid = false;
      }
      const q = pick?.src?.q;
      if (!Number.isInteger(q) || q < 1 || q > 8) { add(face, index, `${faceNames[face]}面向的卡「${id}」出處題號必須是 q1 至 q8。`); valid = false; }
      if (clean(pick?.src?.said) && answers && !hasSourceQuote(pick.src.said, answers[`q${q}`])) { add(face, index, `${faceNames[face]}面向的卡「${id}」的創辦人原話不在 q${q} 答案內，請引用答案中的連續原文。`); valid = false; }
      // 同一面向同一張卡只保留一次（真實 AI 走查曾把同一張卡列兩次，畫面便重複顯示）
      if (valid && !kept.some(item => item.card === id)) kept.push({ ...clone(pick), name: card.name });
    });
    const undecided = !Array.isArray(original) && original && original.undecided === true ? original : selected.length === 0 && original?.undecided === true ? original : null;
    if (kept.length) cleaned.faces[face] = kept;
    else if (undecided && clean(undecided.missing)) cleaned.faces[face] = { undecided: true, missing: clean(undecided.missing) };
    else {
      add(face, -1, `${faceNames[face]}面向沒有合格模式卡，請選一張卡或寫明尚欠哪項資料。`);
      cleaned.faces[face] = { undecided: true, missing: '資料不足，未能選定。' };
    }
  }
  for (const key of ['name', 'payer', 'why']) if (containsCardId(input[key])) add('model', -1, `模式的${key}不可包含卡號，請只保留給創辦人看的文字。`);
  const validateCardText = key => {
    const value = input[key], card = safeLib.byId?.[clean(value?.card)], where = problemForCard(input, card, key);
    // 接口文件 5.4「組合完整」（Fable 反審 M5）：沒有卡號而標明 zero: true 的，是 Zero 自寫的陷阱或驗證，可以保留
    if (value && !clean(value.card) && value.zero === true && clean(value.text)) {
      const fields = key === 'trap' ? ['text'] : ['text', 'watch', 'counts'];
      if (fields.some(field => containsCardId(value[field]))) { add(where.face, where.index, `${key === 'trap' ? '最大陷阱' : '第一個驗證'}的畫面文字不可包含卡號。`); delete cleaned[key]; }
      else cleaned[key] = clone(value);
      return;
    }
    let valid = !!value && !!card;
    if (!valid) add(where.face, where.index, `${key === 'trap' ? '最大陷阱' : '第一個驗證'}未能對應有效模式卡，請改用已選的模式卡。`);
    if (valid && (key === 'firstTest' || card.id.startsWith('S')) && value.zero !== true) { add(where.face, where.index, `${key === 'trap' ? '最大陷阱' : '第一個驗證'}必須標明 zero: true，因為這是 Zero 建議。`); valid = false; }
    if (valid && key === 'trap' && card.id.startsWith('C') && ![...card.traps, ...card.unfit].some(sentence => sameSentence(sentence, value.text))) { add(where.face, where.index, `模式卡「${card.id}」的最大陷阱不是卡上原句，請逐字引用常見陷阱或不適合信號。`); valid = false; }
    if (valid && key === 'firstTest' && card.id.startsWith('C') && !commonRun(value.text, card.firstTest)) { add(where.face, where.index, `模式卡「${card.id}」的第一個驗證與卡上原文沒有連續 6 字相同，請依卡片原句重寫。`); valid = false; }
    const fields = key === 'trap' ? ['text'] : ['text', 'watch', 'counts'];
    if (fields.some(field => containsCardId(value?.[field]))) { add(where.face, where.index, `${key === 'trap' ? '最大陷阱' : '第一個驗證'}的畫面文字不可包含卡號。`); valid = false; }
    if (valid) cleaned[key] = clone(value); else delete cleaned[key];
  };
  validateCardText('trap');
  validateCardText('firstTest');
  if (needDiagnosis) {
    const diagnosis = Array.isArray(input.diagnosis) ? input.diagnosis : [];
    if (diagnosis.length !== 16) add('diagnosis', -1, '診斷題必須剛好有 16 項，請補齊或刪除多出的項目。');
    if (diagnosis.some(item => !['是', '否', '紀錄未有'].includes(item?.a))) add('diagnosis', -1, '診斷題答案只可填「是」「否」或「紀錄未有」，請不要使用推測字眼。');
  }
  return { ok: problems.length === 0, problems, cleaned };
}
