// 確認後生意模式圖的唯一取值處（接口文件 docs/evidence/journey-0440/contracts-0440.md 第 2a 節）；只讀檔，不寫檔。
// 確認稿、討論背景、業績頁「計劃」、會議紀錄、GET /api/canvas、公司現況小卡一律經 readCanvas 取值，不自行讀公司概覽的九格。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadModelCards } from './model-cards-lib.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const C = require('./canvas-lib.js');
const NAMES = require('./names.js');
const FACES = ['charge', 'form', 'scale'];
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const readObject = file => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return plain(v) ? v : null; } catch { return null; } };
const readList = file => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };

// 待合併的生意模式圖操作：先讀外殼已暫存的批次（較舊），再讀 founder-ops.json（較新）；已合併的操作略過。
function pendingCanvasOps(DIR, done) {
  let batches = [];
  try {
    batches = fs.readdirSync(DIR.ledger).filter(file => /^\.founder-ops-\d+-\d+\.json$/.test(file))
      .sort((a, b) => (Number((/-(\d+)\.json$/.exec(a) || [])[1]) || 0) - (Number((/-(\d+)\.json$/.exec(b) || [])[1]) || 0) || a.localeCompare(b))
      .map(file => path.join(DIR.ledger, file));
  } catch { batches = []; }
  const seen = new Set(done), ops = [];
  for (const file of [...batches, path.join(DIR.ledger, 'founder-ops.json')]) {
    for (const op of readList(file)) {
      if (!plain(op) || (op.op !== 'canvasEdit' && op.op !== 'canvasSugAnswer')) continue;
      if (op.id && seen.has(op.id)) continue;
      if (op.id) seen.add(op.id);
      ops.push(op);
    }
  }
  return ops;
}

// 外殼建立或換新底稿用：同一份公司概覽不應呼叫（由外殼按 pageId 判斷）；prev 是舊的 canvas.json，換新時舊九格入上一版、未答建議改為不採用。
export function buildCanvasBase(page, values, pageId, prev = null, at = '') {
  const from = C.canvasFromPage(page, values || {});
  const old = plain(prev) ? prev : null;
  const history = old && plain(old.cells) ? [{ rev: Number.isInteger(old.rev) ? old.rev : 0, at, cells: old.cells, why: '換新公司概覽' }, ...(Array.isArray(old.history) ? old.history : [])].slice(0, 20) : [];
  const suggestions = old && Array.isArray(old.suggestions) ? old.suggestions.map(s => plain(s) && s.state === 'open' ? { ...s, state: 'rejected' } : s) : [];
  return { pageId: String(pageId || ''), rev: 1, at, cells: from.cells, history, suggestions };
}

// 已選卡的畫面資料：中文名、英文名及核心邏輯（給「模式說明」用）。
function cardsOf(model, proto) {
  if (!plain(model) || !plain(model.faces) || !proto) return [];
  const lib = loadModelCards(proto), out = [];
  for (const face of FACES) {
    const list = Array.isArray(model.faces[face]) ? model.faces[face] : [];
    for (const pick of list) {
      const card = lib.byId && lib.byId[pick && pick.card];
      if (card && !out.some(x => x.id === card.id)) out.push({ id: card.id, face, name: card.name, en: card.en || '', logic: card.logic || card.desc || '' });
    }
  }
  return out;
}

// 取現行九格：已確認的公司概覽、canvas.json 及待合併的創辦人操作，加上每格證據級。
export function readCanvas(DIR, { proto = HERE } = {}) {
  const empty = { confirmed: false, pageId: '', view: null, type: '', goal: 'open', model: null, cards: [], levels: null, levelsShown: false, weakest: [] };
  const confirmed = readObject(path.join(DIR.ledger, 'confirmed.json'));
  if (!confirmed) return empty;
  const page = readObject(path.join(DIR.company, 'page.json'));
  const samePage = !!(page && page.page && confirmed.pageId === page.page.id);
  const fromPage = samePage ? C.canvasFromPage(page, confirmed.values || {}) : null;
  // canvas.json 屬另一份公司概覽（換新後外殼未及建新底稿）時不當現況，改用即時建立的底稿（Opus 覆核建議 11）
  const storedRaw = readObject(path.join(DIR.ledger, 'canvas.json'));
  const stored = storedRaw && (!storedRaw.pageId || String(storedRaw.pageId) === String(confirmed.pageId || '')) ? storedRaw : null;
  const state = readObject(path.join(DIR.ledger, 'state.json')) || {};
  const done = Array.isArray(state.founderOpsDone) ? state.founderOpsDone.filter(id => typeof id === 'string') : [];
  // 沒有 canvas.json 時即時建立的底稿與外殼寫回時 buildCanvasBase 建的完全相同（rev 1），畫面送出的 forRev 才對得上（驗收閘 M1-2）
  const base = stored || (fromPage ? buildCanvasBase(page, confirmed.values || {}, confirmed.pageId) : null);
  const view = base ? C.canvasView(base, pendingCanvasOps(DIR, done)) : null;
  // 帳本假設在 state.company.assumptions（run.mjs syncLedger）；舊測試資料或有放在頂層的，一併接受
  const assumptions = plain(state.company) && Array.isArray(state.company.assumptions) ? state.company.assumptions : Array.isArray(state.assumptions) ? state.assumptions : [];
  const levelsShown = assumptions.some(a => plain(a) && typeof a.cell === 'string' && a.cell);
  const levels = C.cellLevels(assumptions);
  const model = fromPage ? fromPage.model : null;
  return {
    confirmed: true, pageId: String(confirmed.pageId || ''), view,
    type: fromPage ? fromPage.type : '', goal: fromPage && fromPage.goal ? C.goalKeyOf(fromPage.goal, NAMES) : 'open',
    model, cards: cardsOf(model, proto), levels, levelsShown, weakest: levelsShown ? C.weakest(levels) : []
  };
}
