// 常用名稱表：純函數。輸入舊狀態及操作，只輸出新狀態；不讀寫檔、不讀時鐘、不叫 AI。
import { createRequire } from 'node:module';
import { norm, hasContactInfo, looksLikePhrase, duplicateActor } from './people-ops.mjs';

const require = createRequire(import.meta.url);
const NAMES = require('./names.js');
const clone = value => JSON.parse(JSON.stringify(value));
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(String(value) + 'T00:00:00Z'));

export const TERM_KINDS = ['product', 'campaign', 'other'];
export const TERM_MAX = 60;

const stateCopy = state => clone(state && typeof state === 'object' && !Array.isArray(state) ? state : {});
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const termKeys = term => [...new Set([term && term.name, ...((term && Array.isArray(term.aliases)) ? term.aliases : [])].map(norm).filter(Boolean))];
const termId = (inputId, qid) => 'tn-' + String(inputId || '').replace(/^in-/, '').replace(/[^\w-]/g, '').slice(0, 40) + '-' + String(qid || '').replace(/[^\w-]/g, '').slice(0, 20);
const manualId = opId => 'tn-' + String(opId || '').replace(/[^\w-]/g, '').slice(0, 60);
const kindName = kind => (NAMES.ui && NAMES.ui['term_kind_' + kind]) || '';
const validName = value => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length >= 2 && name.length <= 30 && !/[\p{P}\r\n]/u.test(name) && !/^\d+$/.test(name) && !hasContactInfo(name) ? name : '';
};
const sameName = (value, name) => norm(value) === norm(name);
const uniqueAliases = values => {
  const seen = new Set();
  return values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).filter(value => {
    const key = norm(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function pushEffect(state, inputId, effect) {
  const input = (state.inputs || []).find(value => value && value.id === inputId);
  if (!input) return state;
  input.effects = Array.isArray(input.effects) ? input.effects : [];
  if (input.effects.some(value => value && value.targetKind === effect.targetKind && value.targetId === effect.targetId && value.change === effect.change)) return state;
  input.effects.push({ targetKind: effect.targetKind, targetId: effect.targetId, change: effect.change });
  return state;
}
function hasEffect(state, inputId, effect) {
  const input = (state && state.inputs || []).find(value => value && value.id === inputId);
  return !!(input && Array.isArray(input.effects) && input.effects.some(value => value && value.targetKind === effect.targetKind && value.targetId === effect.targetId && value.change === effect.change));
}

const reject = reason => ({ status: 'drop', reason });

// Zero 建議的新名稱：任何不合格資料一律靜默丟棄，不退回 AI 修正，也不令事件失敗。
export function checkNewTermItem(it, ctx = {}) {
  try {
    if (!it || typeof it !== 'object' || Array.isArray(it) || it.kind !== 'newTerm') return reject('invalid');
    const c = object(ctx), name = validName(it.name);
    if (!name) return reject('invalidName');
    if (looksLikePhrase(name)) return reject('phrase');
    if (!TERM_KINDS.includes(it.termKind)) return reject('invalidKind');
    if (typeof it.why !== 'string' || !it.why.trim() || it.why.trim().length > 200) return reject('invalidWhy');

    const terms = Array.isArray(c.terms) ? c.terms : [];
    const actors = Array.isArray(c.actors) ? c.actors : [];
    const texts = Array.isArray(c.texts) ? c.texts : [];
    const overview = Array.isArray(c.overview) ? c.overview : [];
    const declined = object(c.declined);
    const max = Number.isInteger(c.max) && c.max >= 0 ? c.max : TERM_MAX;
    const key = norm(name);

    if (duplicateActor(terms, name)) return reject('duplicate');
    if (duplicateActor(actors, name)) return reject('actor');
    if (typeof c.companyName === 'string' && sameName(c.companyName, name)) return reject('company');
    if (overview.some(line => typeof line === 'string' && norm(line).includes(key))) return reject('overview');
    if (Number(declined[key] || 0) >= 2) return reject('declined');
    if (terms.length >= max) return reject('full');
    if (!texts.some(text => typeof text === 'string' && norm(text).includes(key))) return reject('source');

    const item = { kind: 'newTerm', name, termKind: it.termKind, why: it.why.trim(), ...(typeof it.sourceQuote === 'string' && it.sourceQuote.trim() ? { sourceQuote: it.sourceQuote.trim() } : {}) };
    const similar = terms.find(term => {
      const other = norm(term && term.name);
      return other && other !== key && (other.includes(key) || key.includes(other));
    });
    if (similar && similar.id) item.similarTo = similar.id;
    return { status: 'ok', item };
  } catch {
    return reject('invalid');
  }
}

const termState = state => {
  state.company = object(state.company);
  state.company.terms = Array.isArray(state.company.terms) ? state.company.terms : [];
  return state.company.terms;
};
const declinedState = state => {
  state.termSync = object(state.termSync);
  state.termSync.declined = object(state.termSync.declined);
  return state.termSync.declined;
};
const fail = (state, reason) => ({ ok: false, state, reason });

// answer：accept（加入）、alias（記為別名）、reject（不加入）、other（自行填寫）。
export function applyNewTerm(state, { inputId, qid, item, answer, aliasOf = '', today = '', addedFrom = 'event' } = {}) {
  if (!item || typeof item !== 'object' || item.kind !== 'newTerm' || !['accept', 'alias', 'reject', 'other'].includes(answer)) return state;
  const name = validName(item.name);
  if (!name || !TERM_KINDS.includes(item.termKind)) return state;
  const result = stateCopy(state), terms = termState(result), id = termId(inputId, qid);
  const actors = Array.isArray(result.company.actors) ? result.company.actors : [];
  const effect = (targetKind, targetId, change) => pushEffect(result, inputId, { targetKind, targetId, change });

  if (answer === 'reject') {
    const change = fill(NAMES.ui.termSkipped, { n: name });
    if (hasEffect(state, inputId, { targetKind: 'decision', targetId: id, change })) return state;
    const declined = declinedState(result); declined[norm(name)] = Number(declined[norm(name)] || 0) + 1;
    return effect('decision', id, change);
  }
  if (answer === 'other') return effect('decision', id, fill(NAMES.ui.termSkipped, { n: name }));
  if (answer === 'alias') {
    const target = terms.find(term => term && term.id === aliasOf);
    if (!target || duplicateActor(terms, name) || duplicateActor(actors, name)) return state;
    target.aliases = uniqueAliases([...(Array.isArray(target.aliases) ? target.aliases : []), name]).slice(-5);
    return effect('term', target.id, fill(NAMES.ui.termAliased, { n: target.name }));
  }
  if (terms.some(term => term && term.id === id)) return state;
  if (terms.length >= TERM_MAX || duplicateActor(terms, name) || duplicateActor(actors, name)) return state;
  const source = ['event', 'doc', 'chat', 'manual'].includes(addedFrom) ? addedFrom : 'event';
  terms.push({ id, name, kind: item.termKind, aliases: [], addedAt: isDay(today) ? today : '', addedFrom: source });
  return effect('term', id, fill(NAMES.ui.termAdded, { n: name, k: kindName(item.termKind) }));
}

const termConflict = (terms, actors, companyName, name, ownId = '') => {
  const key = norm(name);
  if (terms.some(term => term && term.id !== ownId && termKeys(term).includes(key))) return 'duplicateName';
  if (duplicateActor(actors, name)) return 'inList';
  if (typeof companyName === 'string' && sameName(companyName, name)) return 'companyName';
  return '';
};

// 創辦人操作：失敗必定交回原 state；成功才交回複本。
export function applyTermOp(state, op, value = {}, { today = '', opId = '', overview = [] } = {}) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const result = stateCopy(source), terms = termState(result), company = result.company;
  const actors = Array.isArray(company.actors) ? company.actors : [];
  const input = object(value);

  if (op === 'termAdd') {
    const name = validName(input.name);
    if (!name || !TERM_KINDS.includes(input.kind)) return fail(state, 'invalid');
    if (!opId || !manualId(opId).replace(/^tn-/, '')) return fail(state, 'invalid');
    const id = manualId(opId), conflict = termConflict(terms, actors, company.name, name);
    if (terms.some(term => term && term.id === id)) return { ok: true, state: result };
    if (conflict) return fail(state, conflict);
    if (Array.isArray(overview) && overview.some(line => typeof line === 'string' && norm(line).includes(norm(name)))) return fail(state, 'companyName');
    if (terms.length >= TERM_MAX) return fail(state, 'full');
    terms.push({ id, name, kind: input.kind, aliases: [], addedAt: isDay(today) ? today : '', addedFrom: 'manual' });
    delete declinedState(result)[norm(name)];
    return { ok: true, state: result };
  }

  const term = terms.find(entry => entry && entry.id === input.id);
  if (!term) return fail(state, 'notFound');
  if (op === 'termRename') {
    const name = validName(input.name);
    if (!name) return fail(state, 'invalid');
    if (norm(name) === norm(term.name)) return { ok: true, state: result };
    const conflict = termConflict(terms, actors, company.name, name, term.id);
    if (conflict) return fail(state, conflict);
    term.aliases = uniqueAliases([...(Array.isArray(term.aliases) ? term.aliases : []), term.name]).filter(alias => norm(alias) !== norm(name)).slice(-5);
    term.name = name;
    return { ok: true, state: result };
  }
  if (op === 'termRemove') {
    result.company.terms = terms.filter(entry => entry !== term);
    const declined = declinedState(result);
    for (const name of [term.name, ...(Array.isArray(term.aliases) ? term.aliases : [])]) if (typeof name === 'string' && norm(name)) declined[norm(name)] = 2;
    return { ok: true, state: result };
  }
  return fail(state, 'unknownOp');
}
