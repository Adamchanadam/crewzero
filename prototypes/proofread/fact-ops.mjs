// 事件確認題的事實鍵、合併及清理計劃。所有匯出的函數均為純函數。
import { compareByDate } from './ledger-ops.mjs';
import { matchActorName } from './people-ops.mjs';

export const CLOSED_STATUSES = ['superseded', 'expired', 'applied', 'withdrawn'];

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const list = value => Array.isArray(value) ? value : [];
const clean = value => String(value == null ? '' : value).normalize('NFKC')
  .replace(/[\s　，、。．,.:：;；!?！？「」『』（）()\[\]{}<>〈〉《》\-—–_…·]/g, '').toLowerCase();
const text = value => String(value == null ? '' : value).trim();

const mutation = question => {
  if (!question || typeof question !== 'object') return null;
  if (question.apply && typeof question.apply === 'object') return question.apply;
  return list(question.options).map(option => option && option.apply).find(apply => apply && [
    'setAssumptionGrade', 'setNextExternalAction', 'addFollowUp', 'addActor', 'markDone'
  ].includes(apply.op)) || null;
};

const itemFromItemId = itemId => {
  const source = String(itemId || '');
  if (source.startsWith('assumption:')) return { kind: 'assumption', id: source.slice('assumption:'.length) };
  if (source.startsWith('milestone:')) return { kind: 'milestone', id: source.slice('milestone:'.length) };
  if (source.startsWith('nextAction:')) return { kind: 'nextAction' };
  if (source.startsWith('followUp:revision:')) {
    const rest = source.slice('followUp:revision:'.length).split(':');
    return { kind: 'followUp', revisionOfTaskId: rest.shift() || '', date: rest.join(':') };
  }
  if (source.startsWith('followUp:')) {
    const rest = source.slice('followUp:'.length).split(':');
    return { kind: 'followUp', date: rest.shift() || '', action: rest.join(':') };
  }
  if (source.startsWith('newActor:')) return { kind: 'newActor', name: source.slice('newActor:'.length) };
  return null;
};

// 將事件項目或已建出的題目投影為可比較的建議；不依賴題目顯示字句。
const proposalOf = (itemOrQuestion, state = {}) => {
  const row = itemOrQuestion && typeof itemOrQuestion === 'object' ? itemOrQuestion : null;
  if (!row || row.kind === 'money' || row.money) return null;
  if (row.kind === 'assumption') return row.id ? { kind: 'assumption', id: String(row.id), value: text(row.grade) } : null;
  if (row.kind === 'nextAction') return { kind: 'nextAction', value: text(row.text) };
  if (row.kind === 'followUp') return {
    kind: 'followUp', taskId: text(row.sameAsTask || row.revisionOfTaskId), date: text(row.date), action: text(row.action)
  };
  if (row.kind === 'newActor') return { kind: 'newActor', name: text(row.name), org: text(row.org) };
  if (row.kind === 'milestone') return row.id ? { kind: 'milestone', id: String(row.id), value: row.done === false ? false : true } : null;

  const apply = mutation(row);
  if (apply) {
    if (apply.op === 'setAssumptionGrade') return apply.id ? { kind: 'assumption', id: String(apply.id), value: text(apply.grade) } : null;
    if (apply.op === 'setNextExternalAction') return { kind: 'nextAction', value: text(apply.text) };
    if (apply.op === 'addFollowUp') return {
      kind: 'followUp', taskId: text(apply.revisionOfTaskId || apply.sameAsTask), date: text(apply.date), action: text(apply.action)
    };
    if (apply.op === 'addActor') return { kind: 'newActor', name: text(apply.item && apply.item.name), org: text(apply.item && apply.item.org) };
    if (apply.op === 'markDone') return apply.id ? { kind: 'milestone', id: String(apply.id), value: true } : null;
  }

  const fromId = itemFromItemId(row.itemId || row.id);
  if (fromId) return proposalOf(fromId, state);
  return null;
};

const keyForProposal = (proposal, state = {}) => {
  if (!proposal) return null;
  if (proposal.kind === 'assumption') return proposal.id ? 'assumption:' + proposal.id : null;
  if (proposal.kind === 'nextAction') return 'nextAction';
  if (proposal.kind === 'followUp') {
    if (proposal.taskId) return 'task:' + proposal.taskId;
    const date = text(proposal.date), action = clean(proposal.action);
    return date && action ? `followUp:${date}:${action}` : null;
  }
  if (proposal.kind === 'newActor') {
    const name = text(proposal.name);
    if (!name) return null;
    const hit = matchActorName((((state || {}).company || {}).actors || []), name);
    const actor = hit && list(((state || {}).company || {}).actors).find(row => row && row.id === hit.id);
    return hit && hit.how === 'exact' && !differentOrg(proposal.org, actor && actor.org) ? 'actor:' + hit.id : 'actorName:' + clean(name);
  }
  if (proposal.kind === 'milestone') return proposal.id ? 'milestone:' + proposal.id : null;
  return null;
};

/** 回傳事件項目或題目的事實鍵；不能合併的題目回傳 null。 */
export function factKey(itemOrQuestion, state = {}) {
  return keyForProposal(proposalOf(itemOrQuestion, state), state);
}

const answerFor = (answers, pack, index) => {
  if (answers instanceof Map) return answers.get(pack.id) || {};
  if (Array.isArray(answers)) {
    const found = answers.find(row => row && (row.packId === pack.id || row.id === pack.id));
    return found ? (found.answers || found) : (answers[index] && answers[index].answers) || {};
  }
  if (answers && typeof answers === 'object' && own(answers, pack.id)) return answers[pack.id] || {};
  return {};
};

const answered = (store, question) => {
  const values = store && store.answers && typeof store.answers === 'object' ? store.answers : store || {};
  return own(values, question.id) && !!values[question.id];
};

const basisOf = (pack, question) => {
  const apply = mutation(question) || {};
  const realEvent = pack.realEvent || {};
  const dated = question.dated || {};
  return {
    date: text(apply.basisDate || dated.basisDate || realEvent.date),
    assumed: apply.basisAssumed === true || dated.basisAssumed === true || realEvent.dateAssumed === true
  };
};

const hidden = (record, values) => {
  for (const [key, value] of Object.entries(values)) Object.defineProperty(record, key, { value, enumerable: false });
  return record;
};

/** 將所有未答而未收起的可合併題，按事實鍵分組。 */
export function openByFact(packs = [], answers = {}, state = {}) {
  const out = new Map();
  for (const [index, pack] of list(packs).entries()) {
    if (!pack || !Array.isArray(pack.questions)) continue;
    const store = answerFor(answers, pack, index);
    for (const question of pack.questions) {
      if (!question || question.closed || question.reopened || answered(store, question)) continue;
      const key = factKey(question, state);
      if (!key) continue;
      const basis = basisOf(pack, question);
      const record = hidden({
        packId: pack.id,
        qId: question.id,
        askedAt: pack.askedAt || '',
        basisDate: basis.date,
        inputId: (pack.realEvent || {}).inputId || ''
      }, { _proposal: proposalOf(question, state), _basisAssumed: basis.assumed, _question: question });
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(record);
    }
  }
  return out;
}

const differentOrg = (left, right) => {
  const a = clean(left), b = clean(right);
  return !!a && !!b && a !== b;
};

const hasOtherActorChoice = question => {
  const modes = list(question && question.options).map(option => option && option.apply).filter(apply => apply && apply.op === 'addActor').map(apply => apply.mode);
  return modes.includes('alias') && modes.includes('add');
};

const sameProposal = (left, right) => {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'assumption') return left.id === right.id && left.value === right.value;
  if (left.kind === 'nextAction') return clean(left.value) === clean(right.value);
  if (left.kind === 'followUp') return left.taskId === right.taskId && left.date === right.date && clean(left.action) === clean(right.action);
  if (left.kind === 'newActor') return clean(left.name) === clean(right.name) && !differentOrg(left.org, right.org);
  if (left.kind === 'milestone') return left.id === right.id && left.value === right.value;
  return false;
};

const sourceOf = item => text(item && (item.inputId || item.basisFrom || item.fromInput || item.sourceInputId));

const canCompareActor = (proposal, record) => {
  if (!proposal || proposal.kind !== 'newActor') return true;
  const old = record && (record._proposal || record.proposal || proposalOf(record));
  return !!old && sameProposal(proposal, old) && !hasOtherActorChoice(record && record._question);
};

const sameDayConflict = (proposal, record, result) => {
  if (!record || sameProposal(proposal, record._proposal || record.proposal || proposalOf(record))) return false;
  return result && (result.result === 'sameDay' || (result.result === 'unknown' && result.why === 'basisAssumed'));
};

/** 比較一項新建議和同一事實的未答題，決定取代、只留當日說法，或補來源。 */
export function mergeProposal(newItem, openList = [], state = {}, { eventDate = '', dateAssumed = false } = {}) {
  const proposal = proposalOf(newItem, state);
  const basisDate = text((newItem && newItem.dated && newItem.dated.basisDate) || (newItem && newItem.asOf) || eventDate);
  const assumed = dateAssumed === true || !!(newItem && (newItem.basisAssumed === true || (newItem.dated && newItem.dated.basisAssumed === true)));
  const comparable = list(openList).filter(open => canCompareActor(proposal, open));
  const same = comparable.find(open => sameProposal(proposal, open && (open._proposal || open.proposal || proposalOf(open, state))));
  if (same) return { action: 'sameAsOpen', keep: { packId: same.packId, qId: same.qId }, addSource: sourceOf(newItem) };

  const compared = comparable.map(open => ({
    open,
    result: compareByDate({
      basisDate,
      basisAssumed: assumed,
      hasCurrent: true,
      currentDate: open && open.basisDate,
      currentAssumed: !!(open && (open._basisAssumed || open.basisAssumed))
    })
  }));
  const actualOldExists = compared.some(({ open }) => open && !(open._basisAssumed || open.basisAssumed));
  const newerOldExists = compared.some(({ result }) => result.result === 'olderDiffers');
  const blockedByAssumedDate = assumed && actualOldExists;
  if (newerOldExists || blockedByAssumedDate || compared.some(({ result }) => result.result === 'unknown' && result.why === 'basisAssumed')) {
    const against = compared.find(({ result }) => result.result === 'olderDiffers') || compared[0] || {};
    return { action: 'older', note: {
      fact: factKey(newItem, state), inputId: sourceOf(newItem), basisDate, dateAssumed: assumed,
      reason: blockedByAssumedDate ? '假定日期不可取代有實際日期的未答題' : '已有較新的未答題',
      against: against.open ? { packId: against.open.packId, qId: against.open.qId } : null
    } };
  }

  const closes = compared.filter(({ open, result }) => !sameDayConflict(proposal, open, result)).map(({ open, result }) => ({
    packId: open.packId,
    qId: open.qId,
    status: 'superseded',
    reason: result.result === 'sameDay' ? '同日的另一個說法，改由新題並列' : '較新的建議取代未答題'
  }));
  return { action: 'replace', closes };
}

/** 以不可逆的內容保留方式標記一條題目已收起。 */
export function closeQuestion(pack, qId, { status, reason, reasonKey, by, at } = {}) {
  if (!CLOSED_STATUSES.includes(status)) throw new RangeError('不支援的收起狀態：' + String(status));
  if (!pack || !Array.isArray(pack.questions)) return pack;
  const index = pack.questions.findIndex(question => question && String(question.id) === String(qId));
  if (index < 0 || pack.questions[index].closed) return pack;
  const closed = { status, reason: text(reason), ...(reasonKey ? { reasonKey: text(reasonKey) } : {}), ...(by !== undefined ? { by } : {}), ...(at !== undefined ? { at } : {}) };
  const questions = pack.questions.slice();
  questions[index] = { ...questions[index], closed };
  return { ...pack, questions };
}

const stateSource = (state, row) => {
  const source = text(row && (row.basisFrom || row.sourceId));
  const input = source && list(state && state.inputs).find(item => item && item.id === source);
  if (input && text(input.title)) return text(input.title);
  if (source || text(row && (row.addedFrom || row.confirmedAt))) return '創辦人確認';
  return '已確認的現行紀錄';
};

const stateMatch = (proposal, state, question) => {
  if (question.noChange === true) return null;
  const company = (state && state.company) || {};
  if (!proposal) return null;
  if (proposal.kind === 'assumption') {
    const row = list(company.assumptions).find(item => item && String(item.id) === proposal.id);
    return row && text(row.grade) === proposal.value ? { value: String(row.grade), from: 'state', source: stateSource(state, row) } : null;
  }
  if (proposal.kind === 'nextAction') {
    const current = company.nextExternalAction || {}, value = text(current.text);
    return value && !current.pendingUpdate && value === proposal.value ? { value, from: 'state', source: stateSource(state, current) } : null;
  }
  if (proposal.kind === 'newActor') {
    const hit = matchActorName(list(company.actors), proposal.name);
    if (!hit || hit.how !== 'exact' || hasOtherActorChoice(question)) return null;
    const actor = list(company.actors).find(row => row && row.id === hit.id);
    return actor && !differentOrg(proposal.org, actor.org) ? { value: text(actor.name) || proposal.name, from: 'state', source: stateSource(state, actor) } : null;
  }
  if (proposal.kind === 'milestone') {
    const row = list(state && state.milestones).find(item => item && String(item.id) === proposal.id);
    return row && row.state === 'done' ? { value: text(row.short) || proposal.id, from: 'state', source: stateSource(state, row) } : null;
  }
  if (proposal.kind === 'followUp') {
    const row = proposal.taskId
      ? list(state && state.tasks).find(item => item && String(item.id) === proposal.taskId)
      : list(state && state.tasks).find(item => item && text(item.dueAt) === proposal.date && text(item.title) === proposal.action);
    return row && (proposal.taskId || row.basisFrom) && text(row.dueAt) === proposal.date && text(row.title) === proposal.action
      ? { value: text(row.title), from: 'state', source: stateSource(state, row) } : null;
  }
  return null;
};

const newerOpen = (candidate, current) => {
  const result = compareByDate({
    basisDate: candidate.basisDate,
    basisAssumed: !!candidate._basisAssumed,
    hasCurrent: true,
    currentDate: current.basisDate,
    currentAssumed: !!current._basisAssumed
  });
  if (result.result === 'newer') return true;
  if (result.result === 'olderDiffers') return false;
  if (result.result === 'unknown') {
    if (!candidate._basisAssumed && current._basisAssumed) return true;
    if (candidate._basisAssumed && !current._basisAssumed) return false;
  }
  // 同日兩說與兩邊假定日期而值不同，留給創辦人並排決定。
  if (!sameProposal(candidate._proposal, current._proposal)) return false;
  // 同日相同建議才以穩定次序選一條保留，結果仍可重跑。
  const a = String(candidate.askedAt || '') + '\u0000' + String(candidate.packId) + '\u0000' + String(candidate.qId);
  const b = String(current.askedAt || '') + '\u0000' + String(current.packId) + '\u0000' + String(current.qId);
  return a > b;
};

const closureKey = closure => String(closure.packId) + '\u0000' + String(closure.qId);
const interviewKey = (pack, question) => {
  if (!pack || !pack.rhythm || pack.rhythm.kind !== 'interview' || !question || !question.bind) return null;
  const apply = mutation(question) || {};
  const target = text((question.overdue || {}).milestoneId || (question.watch || {}).id || (question.contact || {}).id || (question.tent || {}).plan || apply.id);
  return target ? String(question.bind) + ':' + target : null;
};

/** 計算一次性清理計劃；只回傳應收起的題目，絕不寫入。 */
export function planCleanup({ packs = [], answers = {}, state = {}, today = '' } = {}) {
  const allPacks = list(packs);
  const open = openByFact(allPacks, answers, state);
  const closures = [];
  const planned = new Set();
  const add = closure => {
    const key = closureKey(closure);
    if (!planned.has(key)) { planned.add(key); closures.push(closure); }
  };

  // 每週訪問只與每週訪問比較，而且題型與對象編號必須完全相同。
  const interviews = new Map();
  for (const [index, pack] of allPacks.entries()) {
    if (!pack || !pack.rhythm || pack.rhythm.kind !== 'interview' || !Array.isArray(pack.questions)) continue;
    const store = answerFor(answers, pack, index);
    for (const question of pack.questions) {
      if (!question || question.closed || question.reopened || answered(store, question)) continue;
      const key = interviewKey(pack, question);
      if (!key) continue;
      if (!interviews.has(key)) interviews.set(key, []);
      interviews.get(key).push({ packId: pack.id, qId: question.id, on: text((pack.rhythm || {}).on) || String(pack.askedAt || '').slice(0, 10) });
    }
  }
  for (const records of interviews.values()) for (const record of records) {
    const newer = records.filter(other => other !== record && other.on > record.on).sort((a, b) => String(b.on).localeCompare(String(a.on)))[0];
    if (newer) add({ packId: record.packId, qId: record.qId, status: 'superseded', reasonKey: 'interview', reason: '已有較新一期訪問', by: { packId: newer.packId, qId: newer.qId }, at: today });
  }

  for (const records of open.values()) {
    if (records.length < 2) continue;
    const groups = [];
    for (const record of records) {
      if (record._proposal && record._proposal.kind === 'newActor' && hasOtherActorChoice(record._question)) continue;
      const group = groups.find(rows => rows.every(row => canCompareActor(record._proposal, row) && canCompareActor(row._proposal, record)));
      if (group) group.push(record); else groups.push([record]);
    }
    for (const group of groups) for (const record of group) {
      const newer = group.filter(other => other !== record && newerOpen(other, record)).sort((a, b) => String(b.askedAt).localeCompare(String(a.askedAt)))[0];
      if (!newer) continue;
      add({
        packId: record.packId, qId: record.qId, status: 'superseded',
        reason: '同一事實已有較新的未答題', by: { packId: newer.packId, qId: newer.qId }, at: today
      });
    }
  }

  for (const records of open.values()) for (const record of records) {
    if (planned.has(closureKey(record))) continue;
    const applied = stateMatch(record._proposal, state, record._question);
    if (applied) {
      add({ packId: record.packId, qId: record.qId, status: 'applied', reason: '建議值已是現行值', by: applied, at: today });
    }
  }

  let unansweredPacks = 0, unansweredQuestions = 0, mergeableEventQuestions = 0;
  for (const [index, pack] of allPacks.entries()) {
    if (!pack || !Array.isArray(pack.questions)) continue;
    const store = answerFor(answers, pack, index);
    let hasOpen = false;
    for (const question of pack.questions) {
      if (!question || question.closed || answered(store, question)) continue;
      hasOpen = true; unansweredQuestions += 1;
      if (factKey(question, state)) mergeableEventQuestions += 1;
    }
    if (hasOpen) unansweredPacks += 1;
  }
  const byStatus = Object.fromEntries(CLOSED_STATUSES.map(status => [status, 0]));
  for (const closure of closures) byStatus[closure.status] = (byStatus[closure.status] || 0) + 1;
  return {
    closures,
    summary: {
      unansweredPacks,
      unansweredQuestions,
      mergeableEventQuestions,
      remainingUnansweredQuestions: unansweredQuestions - closures.length,
      closuresByStatus: Object.fromEntries(Object.entries(byStatus).filter(([, count]) => count))
    }
  };
}

/** 套用已計出的收起計劃，回傳新的問題包陣列。 */
export function applyClosures(packs = [], closures = []) {
  const byPack = new Map();
  for (const closure of list(closures)) {
    if (!closure || !closure.packId || !closure.qId) continue;
    if (!byPack.has(closure.packId)) byPack.set(closure.packId, []);
    byPack.get(closure.packId).push(closure);
  }
  return list(packs).map(pack => {
    let next = pack;
    for (const closure of byPack.get(pack && pack.id) || []) {
      next = closeQuestion(next, closure.qId, closure);
    }
    return next;
  });
}
