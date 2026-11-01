// 交資料「由文件預填」（規劃書 3.1，唯一定義處）：外殼核對 AI 預填、伺服器送出時重新判定來源、掃描工具核查，三處共用呢度嘅規則。
// 硬規矩：「你原話」標籤唔可以造假——
//   (1) AI 話係文件原句（quote）嘅，外殼逐字喺文件搵到先算原句；搵唔到降為「AI 按文件推斷」；讀唔到文字嘅文件（pdf、docx 等）標「未能核對原句」，永不升為原句。
//   (2) 送出交資料時，伺服器只喺答案同已核對嘅預填逐字一樣先記「你確認的文件原句」；同任何預填一樣嘅答案永遠唔會記成「你寫的」。
import fs from 'node:fs';
import path from 'node:path';

export const PREFILL_Q = ['q1', 'q2', 'q3', 'q4', 'q5'];
export const TEXT_EXT = ['md', 'txt', 'csv'];
const norm = s => String(s || '').replace(/[\s　]+/g, '');
const ext = f => (String(f).split('.').pop() || '').toLowerCase();
// 文件文字：只讀得到純文字檔；其餘當讀唔到（null）
export function docTexts(dir) {
  const out = [];
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (!fs.statSync(p).isFile()) continue; out.push({ name: f, text: TEXT_EXT.includes(ext(f)) ? fs.readFileSync(p, 'utf8') : null }); } } catch { }
  return out;
}
// 一條預填嘅標籤：quote（已核對原句）／inferred（AI 推斷，唔係原句）／unverified（文件讀唔到文字，未能核對）
export function labelOf(a, docs) {
  const t = norm(a.text);
  if (!t) return null;
  const named = docs.find(d => d.name === a.source || d.name.endsWith(String(a.source || '')));
  if (a.quote === true) {
    if (docs.some(d => d.text != null && norm(d.text).includes(t))) return 'quote';
    if (named ? named.text == null : docs.every(d => d.text == null)) return 'unverified';
    return 'inferred';
  }
  return 'inferred';
}
// 核對 AI 交嘅 out/prefill.json → { ok, answers, warnings }；answers 只含有文字嘅題
export function checkPrefill(raw, docs) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || !raw.answers || typeof raw.answers !== 'object') return { ok: false, errors: ['未有交出預填，或者格式不正確'] };
  const answers = {};
  for (const q of PREFILL_Q) {
    const a = raw.answers[q];
    if (!a || typeof a !== 'object' || typeof a.text !== 'string' || !a.text.trim()) continue;
    const text = a.text.trim().slice(0, 1200), source = String(a.source || '').slice(0, 120), at = String(a.at || '').slice(0, 80);
    const label = labelOf({ ...a, text, source }, docs);
    const named = docs.find(d => d.name === source) || docs.find(d => source && d.name.endsWith(source));
    const hit = label === 'quote' ? [named, ...docs].find(d => d && d.text != null && norm(d.text).includes(norm(text))) : null;
    if (a.quote === true && label === 'inferred') warnings.push(q + '：AI 話係原句，但文件搵唔到，已改為按文件推斷');
    answers[q] = { text, label, source: hit ? hit.name : named ? named.name : '', at, ...(a.quote === true && label !== 'quote' ? { downgraded: true } : {}) };
  }
  return { ok: true, answers, warnings };
}
// 送出交資料：按預填紀錄重新判定每題來源（頁面講嘅只係提示）
// prefills：所有預填紀錄，今次頁面講嘅嗰次排最先；同一題搵唔到就再搵其他題（抄咗去第二題都唔算你寫的，記 moved）
export function provenanceOf(fields, claims, prefills) {
  const list = [].concat(prefills || []).filter(p => p && p.answers && typeof p.answers === 'object');
  const out = {};
  for (const q of Object.keys(fields)) {
    const v = String(fields[q] || '').trim();
    if (!v) continue;
    let hit = null, rec = null, moved = false;
    for (const p of list) { const a = p.answers[q]; if (a && norm(a.text) === norm(v)) { hit = a; rec = p; break; } }
    if (!hit) for (const p of list) { const a = Object.values(p.answers).find(a => a && norm(a.text) === norm(v)); if (a) { hit = a; rec = p; moved = true; break; } }
    out[q] = !hit ? { kind: 'founder' } : { kind: hit.label === 'quote' ? 'quote' : 'adopted', ...(hit.label === 'quote' ? {} : { label: hit.label }), source: hit.source, at: hit.at, prefillId: rec.id, ...(moved ? { moved: true } : {}) };
  }
  return out;
}
// 讀晒資料夾入面嘅預填紀錄（first 排最先）
export function loadPrefills(dir, first) {
  let all = [];
  try { all = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse().map(f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean); } catch { }
  return [...all.filter(p => p.id === first), ...all.filter(p => p.id !== first)];
}
// 交資料檔每題下面嘅來源一句（交 AI 擬公司概覽時睇）
export const provenanceLine = p => !p ? '' : p.moved ? `（來源：AI 按文件預填的句子，由另一題搬來，未經逐條確認；出自《${p.source || '你的文件'}》）` : p.kind === 'quote' ? `（來源：你確認的文件原句，出自《${p.source}》${p.at ? '：' + p.at : ''}）` : p.kind === 'adopted' && p.label === 'unverified' ? `（來源：你確認的 AI 預填，出自《${p.source || '你的文件'}》，未能核對是否原句）` : p.kind === 'adopted' ? `（來源：你認同的 AI 建議，按《${p.source || '你的文件'}》推斷，不是原句）` : '（來源：你寫的）';
// 送出時仍有同預填一樣、但頁面未確認嘅答案：伺服器拒收（創辦人確認之後先算數）
export const unconfirmed = (prov, claims) => Object.keys(prov).filter(q => prov[q].kind !== 'founder' && !prov[q].moved && !(claims && claims[q] === 'confirmed'));
