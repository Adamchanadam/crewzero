// 會議紀錄資料脈絡：只按呼叫者交來的資料選取；不讀寫檔、不呼叫 AI。
import { hasContactInfo } from './people-ops.mjs';

const CAP = 6000;
const SECTIONS = new Set(['對方的說法及承諾', '雙方決定', '待辦', '未定事項']);

export const norm = value => String(value == null ? '' : value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const hasPrivateContact = value => hasContactInfo(value) || /電話|電郵|地址|WhatsApp|聯絡方式/i.test(String(value == null ? '' : value).normalize('NFKC'));
const clip = (value, n) => String(value == null ? '' : value).trim().slice(0, n);
const list = value => Array.isArray(value) ? value : [];
const isOpen = task => task && !['done', 'cancelled'].includes(task.status);
const dateOf = item => String((item && (item.eventDate || item.date || item.receivedAt)) || '').slice(0, 10);
const dateLabel = date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!match) return '日期不詳';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? `${month} 月 ${day} 日` : '日期不詳';
};
const actorKeys = actor => [...new Set([actor && actor.name, ...list(actor && actor.aliases)].map(norm).filter(Boolean))];

function finalActorId(actors, id) {
  const byId = new Map(list(actors).map(actor => [actor && actor.id, actor]));
  const seen = new Set(); let current = id;
  for (let i = 0; i < 10 && current; i++) {
    const actor = byId.get(current);
    if (!actor || seen.has(current)) return '';
    if (!actor.mergedInto) return current;
    seen.add(current); current = actor.mergedInto;
  }
  return '';
}

function externalActors(actors) {
  return list(actors).filter(actor => actor && actor.id && !actor.mergedInto && actor.kind !== 'team' && !['我', '本人'].includes(String(actor.name || '').trim()));
}

function namesFromParticipants(text) {
  const lines = String(text || '').split(/\r?\n/);
  const at = lines.findIndex(line => /^#{2,6}\s*參加者\s*$/.test(line.trim()));
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,6}\s/.test(line)) break;
    for (const part of line.replace(/^[-*]\s*/, '').split(/[、，,；;]/)) {
      const name = part.replace(/[（(].*?[）)]/g, '').replace(/[。．.!！?？].*$/u, '').replace(/^(?:創辦人|我|本人)\s*/u, '').trim();
      if (name) out.push({ name });
    }
  }
  return out;
}

function directSpeakerRows(meeting) {
  const direct = meeting && meeting.speakers;
  if (Array.isArray(direct) && direct.filter(Boolean).length) return direct.filter(Boolean);
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && Object.keys(direct).length) return Object.entries(direct).map(([label, value]) => ({ label, ...(typeof value === 'string' ? { name: value } : value || {}) }));
  return [];
}

function speakerRows(meeting) {
  const direct = directSpeakerRows(meeting);
  if (direct.length) return direct;
  return namesFromParticipants(meeting && meeting.text);
}

function sameOrganisation(a, b) {
  const x = norm(a), y = norm(b);
  return !x || !y || x.includes(y) || y.includes(x);
}

function matchingActors(actors, speaker) {
  const id = finalActorId(actors, speaker && speaker.actorId);
  if (id) return [id];
  const name = norm(speaker && speaker.name);
  if (!name) return [];
  const hits = externalActors(actors).filter(actor => actorKeys(actor).includes(name) && sameOrganisation(actor.org, speaker.org));
  // 同名但沒有足夠機構資料可分辨時，不把舊會議當作任何一人。
  return hits.length === 1 ? [hits[0].id] : [];
}

function currentParticipants(data) {
  const actors = list(data.actors), current = data.current || {}, counts = current.speakerCounts || {};
  const found = new Map();
  // 今次有講者對照時，只信對照；沒有才讀「參加者」一節，絕不以全文或創辦人原話補人。
  const speakers = directSpeakerRows(current);
  for (const speaker of (speakers.length ? speakers : namesFromParticipants(current.text))) {
    for (const id of matchingActors(actors, speaker)) {
      const actor = actors.find(row => row && row.id === id);
      if (!actor || actor.kind === 'team') continue;
      const count = Number(counts[speaker.label] || counts[id] || 0);
      const old = found.get(id);
      if (!old || count > old.count) found.set(id, { actor, count, order: found.size });
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count || a.order - b.order).slice(0, 5).map(row => row.actor);
}

function meetingMatches(actors, meeting, participantIds) {
  const ids = new Set(participantIds);
  for (const speaker of speakerRows(meeting)) if (matchingActors(actors, speaker).some(id => ids.has(id))) return true;
  return false;
}

function sectionLines(text) {
  const rows = String(text || '').split(/\r?\n/);
  const out = []; let active = '';
  for (const raw of rows) {
    const line = raw.trim();
    const heading = /^#{2,6}\s*(.+?)\s*$/.exec(line);
    if (heading) { active = SECTIONS.has(heading[1]) ? heading[1] : ''; if (active) out.push({ heading: active }); continue; }
    if (!active || !line || /[⚠✏]/u.test(line) || hasPrivateContact(line)) continue;
    out.push({ text: line });
  }
  return out;
}

function sourceLine(text, source) { return { text: `${text} [${source}]`, source }; }

function meetingBlock(meeting) {
  const source = `${dateLabel(dateOf(meeting))}會議紀錄`;
  const people = speakerRows(meeting).map(row => row.name).filter(name => name && !hasPrivateContact(name)).slice(0, 3).join('、');
  const lines = [sourceLine(`### ${source}${people ? `（${people}）` : ''}`, source)];
  for (const row of sectionLines(meeting.text)) {
    if (row.heading) lines.push(sourceLine(`#### ${row.heading}`, source));
    else lines.push(sourceLine(row.text, source));
  }
  const kept = []; let size = 0;
  for (const line of lines) {
    if (size + line.text.length <= 1200) { kept.push(line); size += line.text.length + 1; continue; }
    // 單一原句過長時，保留仍可辨識的開首及完整出處；其後內容不再加入這次會議。
    const suffix = ` [${line.source}]`, room = 1200 - size - suffix.length - 1;
    if (room > 20 && !/^#{3,4}\s/.test(line.text)) {
      const base = line.text.endsWith(suffix) ? line.text.slice(0, -suffix.length) : line.text;
      kept.push({ text: base.slice(0, room) + suffix, source: line.source });
    }
    break;
  }
  return kept.length > 1 ? kept : [];
}

function sourceOfTask(task, inputs) {
  const minutesId = task && task.minutesSource && task.minutesSource.id;
  if (minutesId) {
    const minutesInput = list(inputs).filter(row => row && row.minutes && row.minutes.id === minutesId).sort((a, b) => {
      const version = row => Number((row && row.minutes && row.minutes.version) || (row && row.version) || 1) || 1;
      return version(b) - version(a) || dateOf(b).localeCompare(dateOf(a));
    })[0];
    if (minutesInput) return `${dateLabel(dateOf(minutesInput))}會議紀錄`;
    return '以往會議紀錄';
  }
  const input = list(inputs).find(row => row && row.id === task.fromInput);
  if (input) return `${dateLabel(dateOf(input))}記下的事`;
  return '既有日程';
}

function relevantTasks(data, people, meetings) {
  const ids = new Set(people.map(actor => actor.id)), names = people.flatMap(actor => actorKeys(actor));
  const meetingIds = new Set(meetings.map(meeting => meeting.id).filter(Boolean));
  const inputIds = new Set(meetings.map(meeting => meeting.inputId).filter(Boolean));
  const station = new Map(list(data.milestones).map(row => [row && row.id, row && (row.short || row.title || '')]));
  return list(data.tasks).filter(task => {
    if (!isOpen(task) || task.owner === 'ai' || task.firstBatch || hasPrivateContact(task.title)) return false;
    if (meetingIds.has(task.minutesSource && task.minutesSource.id) || inputIds.has(task.fromInput)) return true;
    if (task.prospectId) return ids.has(finalActorId(data.actors, task.prospectId));
    return names.some(name => norm(task.title).includes(name));
  }).sort((a, b) => String(a.dueAt || '9999-99-99').localeCompare(String(b.dueAt || '9999-99-99'))).slice(0, 10).map(task => {
    const from = sourceOfTask(task, data.inputs);
    const details = [clip(task.title, 300), task.dueAt || '日期待定', station.get(task.milestoneId)].filter(value => value && !hasPrivateContact(value)).join('；');
    return sourceLine(`- ${details}（來源：${from}）`, `日程 ${task.id}；${from}`);
  });
}

function latestMeetings(data, people) {
  const current = data.current || {}, actors = data.actors || [], ids = people.map(actor => actor.id);
  const candidates = list(data.meetings).filter(meeting => meeting && meeting.inputId !== current.inputId && meeting.id !== current.meetingId && meeting.text);
  const latest = new Map();
  for (const meeting of candidates) {
    const key = meeting.id || meeting.inputId;
    const old = latest.get(key);
    if (!old || Number(meeting.version || 1) > Number(old.version || 1) || (Number(meeting.version || 1) === Number(old.version || 1) && dateOf(meeting) > dateOf(old))) latest.set(key, meeting);
  }
  const picked = new Map();
  for (const actor of people) {
    const mine = [...latest.values()].filter(meeting => meetingMatches(actors, meeting, new Set([actor.id]))).sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 2);
    for (const meeting of mine) picked.set(meeting.id || meeting.inputId, meeting);
  }
  return [...picked.values()].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
}

function confirmedBlocks(meetings) {
  const out = [];
  for (const meeting of meetings) {
    const source = `${dateLabel(dateOf(meeting))}已確認結果`;
    for (const effect of list(meeting.effects).slice(0, 5)) if (effect && effect.change && !hasPrivateContact(effect.change)) out.push(sourceLine(`- ${clip(effect.change, 300)}`, source));
  }
  return out;
}

function otherEvents(data, people) {
  const names = people.flatMap(actor => actorKeys(actor)), meetingInputs = new Set(list(data.meetings).map(row => row && row.inputId));
  const candidates = list(data.events).filter(event => event && !meetingInputs.has(event.id) && names.some(name => norm(`${event.title || ''}\n${event.founderText || ''}`).includes(name)));
  const latest = new Map();
  for (const person of people) {
    const keys = actorKeys(person);
    for (const event of candidates.filter(row => keys.some(key => norm(`${row.title || ''}\n${row.founderText || ''}`).includes(key))).sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 3)) latest.set(event.id, event);
  }
  return [...latest.values()].sort((a, b) => dateOf(b).localeCompare(dateOf(a))).filter(event => !hasPrivateContact(event.founderText)).map(event => sourceLine(`- ${dateLabel(dateOf(event))}，創辦人原話：「${clip(event.founderText, 200)}」`, `${dateLabel(dateOf(event))}其他事件`));
}

function addCategory(out, title, blocks, budget) {
  if (!blocks.length) return budget;
  const groups = blocks.map(block => Array.isArray(block) ? block : [block]).filter(group => group.length);
  const body = groups.flat().map(line => line.text).join('\n');
  if (!body) return budget;
  const header = `## ${title}`;
  if (header.length + body.length + 3 <= budget) { out.push(header, '', ...groups.flat()); return budget - header.length - body.length - 3; }
  const kept = [];
  let left = budget - header.length - 3;
  for (const group of groups) {
    const size = group.reduce((sum, line) => sum + line.text.length + 1, 0);
    if (size > left) break;
    kept.push(...group); left -= size;
  }
  if (kept.length) out.push(header, '', ...kept);
  return left;
}

// 回傳的 sourceByLine 供外殼逐字核對；同一原句有多個出處時保留所有候選。
export function buildMeetingContext(data = {}) {
  if (data.demo === true) return { text: '', sourceByLine: {}, lineSources: [], taskIds: [] };
  const people = currentParticipants(data);
  if (!people.length) return { text: '', sourceByLine: {}, lineSources: [], taskIds: [] };
  const meetings = latestMeetings(data, people);
  const tasks = relevantTasks(data, people, meetings);
  const blocks = [];
  let budget = CAP - '# 以往紀錄（外殼按今次參加者選出；只供對照，不是今次會議的內容）\n\n'.length;
  budget = addCategory(blocks, '相關的未完成日程', tasks, budget);
  budget = addCategory(blocks, '最近的會議紀錄節錄', meetings.map(meetingBlock), budget);
  budget = addCategory(blocks, '其後確認的結果', confirmedBlocks(meetings), budget);
  addCategory(blocks, '最近的其他事件', otherEvents(data, people), budget);
  const lines = blocks.map(line => typeof line === 'string' ? { text: line, source: '' } : line);
  if (!lines.length) return { text: '', sourceByLine: {}, lineSources: [], taskIds: [] };
  const text = ['# 以往紀錄（外殼按今次參加者選出；只供對照，不是今次會議的內容）', '', ...lines.map(line => line.text), ''].join('\n');
  const lineSources = lines.filter(line => line.source).map(line => ({ text: line.text, source: line.source }));
  const sourceByLine = Object.fromEntries(lineSources.map(line => [line.text, line.source]));
  const taskIds = tasks.map(line => (/^日程\s+([^；\]]+)/.exec(line.source || '') || [])[1]).filter(Boolean);
  return { text: text.length <= CAP ? text : '', sourceByLine, lineSources, taskIds };
}

export function contextQuoteSources(text, quote) {
  const needle = String(quote || '').trim();
  if (!needle) return [];
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /^(.*)\s+\[([^\]]+)\]\s*$/.exec(raw.trim());
    if (m && m[1].includes(needle)) {
      const taskSource = /^日程\s+[^；\]]+(?:；(.+))?$/.exec(m[2]);
      out.push({ line: m[1], source: taskSource ? (taskSource[1] ? `日程（${taskSource[1]}）` : '日程') : m[2] });
    }
  }
  return out;
}

export function contextTasks(text) {
  const out = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = /^(.*)\s+\[日程\s+([^；\]]+)(?:；([^\]]+))?\]\s*$/.exec(raw.trim());
    if (m) out.set(m[2], { line: m[1], from: m[3] || '' });
  }
  return out;
}
