// 只檢查畫面會見到嘅內容（規劃書 4.10：問題包標題、題目、判斷句、選項、建議值與理由、產出正文、收據摘要）。
// scanOutput 只找命中；fixOutput 喺 AI 改寫一次後仍然命中時做機械步：查得到嘅編號同級數換成名稱，查唔到嘅保留並加「含內部用語」標記。
// 兩者用同一個巡查（visitOutput），所以檢查範圍同替換範圍一樣；日期題、證據級題嘅值、id、bind、src 唔掃。
import fs from 'node:fs';
import path from 'node:path';
import { NAMES, readJSON } from './ask-lib.mjs';
import { deCodeInfo, issuesOf } from './plain-lib.mjs';

// fn(value, file, where) 回傳新值（唔改就回原值）；有改嘅檔寫返落去
function visitOutput(out, fn) {
  const touched = new Set();
  function check(o, k, file, where) {
    if (!o || typeof o[k] !== 'string') return;
    const v = fn(o[k], file, where);
    if (v !== o[k]) { o[k] = v; touched.add(file); }
  }
  const receipt = readJSON(path.join(out, 'receipt.json'), null);
  const mds = {};
  if (receipt) {
    check(receipt, 'summary', 'receipt.json', '工作摘要');
    if (Array.isArray(receipt.founderNext)) receipt.founderNext.forEach((x, i) => check(receipt.founderNext, i, 'receipt.json', '你的下一步'));
    (Array.isArray(receipt.artifacts) ? receipt.artifacts : []).forEach(a => {
      check(a, 'title', 'receipt.json', '產出標題');
      if (/^[\w.-]+\.md$/.test(String(a?.file || ''))) mds[a.file] = a.title || '文件內容';
    });
  }
  // Markdown 即使未列入收據都檢查。
  for (const f of fs.readdirSync(out).filter(f => f.endsWith('.md'))) if (!mds[f]) mds[f] = '文件內容';
  for (const [f, where] of Object.entries(mds)) {
    let text; try { text = fs.readFileSync(path.join(out, f), 'utf8'); } catch { continue; }
    const v = fn(text, f, where);
    if (v !== text) fs.writeFileSync(path.join(out, f), v);
  }
  const pack = readJSON(path.join(out, 'ask.json'), null);
  if (pack) {
    for (const k of ['title', 'context', 'afterConfirm', 'taskTitle']) check(pack, k, 'ask.json', '問題包');
    (Array.isArray(pack.questions) ? pack.questions : []).forEach((q, i) => {
      const where = `第 ${i + 1} 題`;
      for (const k of ['ask', 'judge', 'why']) check(q, k, 'ask.json', where);
      if (q?.kind !== 'date') { if (Array.isArray(q?.value)) q.value.forEach((v, j) => check(q.value, j, 'ask.json', where)); else check(q, 'value', 'ask.json', where); }
      (Array.isArray(q?.options) ? q.options : []).forEach(o => { check(o, 'text', 'ask.json', where); check(o, 'note', 'ask.json', where); const add = o?.apply?.add; if (add && typeof add === 'object') for (const k of ['short', 'event', 'witness', 'evidence', 'deliveryCondition']) check(add, k, 'ask.json', where); });
    });
  }
  const page = readJSON(path.join(out, 'company-page.json'), null);
  if (page) {
    check(page.company, 'oneLiner', 'company-page.json', '公司概覽');
    (Array.isArray(page.sources) ? page.sources : []).forEach(s => { check(s, 'title', 'company-page.json', '資料來源'); check(s, 'note', 'company-page.json', '資料來源'); });
    function walk(o, where) {
      if (Array.isArray(o)) return o.forEach(x => walk(x, where));
      if (!o || typeof o !== 'object') return;
      const editable = typeof o.id === 'string' && 'label' in o && 'value' in o;
      const keys = ['title', 'guide', 'headline', 'why', 'short'];
      if (editable) keys.push('label', 'ask', 'judge', 'hint', 'test');
      for (const key of keys) check(o, key, 'company-page.json', where);
      if (editable && o.kind !== 'date' && o.kind !== 'grade') { if (Array.isArray(o.value)) o.value.forEach((v, j) => check(o.value, j, 'company-page.json', where)); else check(o, 'value', 'company-page.json', where); }
      if (o.tentative) check(o.tentative, 'test', 'company-page.json', where);
      if (Array.isArray(o.options)) o.options.forEach(x => { check(x, 'text', 'company-page.json', where); check(x, 'note', 'company-page.json', where); });
      for (const [key, value] of Object.entries(o)) if (!['options', 'tentative', 'src'].includes(key) && value && typeof value === 'object') walk(value, where);
    }
    walk(page.glance, '公司概覽'); walk(page.path, '里程碑');
    function detail(o) {
      if (Array.isArray(o)) return o.forEach(detail);
      if (!o || typeof o !== 'object') return;
      const skip = new Set(['id', 'plan', 'origin', 'kind', 'ref', 'src', 'until', 'by', 'flagTo']);
      for (const [k, v] of Object.entries(o)) if (!skip.has(k)) { if (typeof v === 'string' && !(k === 'value' && ['grade', 'date'].includes(o.kind))) check(o, k, 'company-page.json', '公司概覽細節'); else if (v && typeof v === 'object') detail(v); }
    }
    detail(page.detail);
    (page.path?.milestones || []).forEach(m => (m.watch || []).forEach(w => { check(w, 'label', 'company-page.json', '里程碑'); check(w, 'value', 'company-page.json', '里程碑'); }));
  }
  // 真實事件建議：AI 只寫摘要同每項理由（問題文字、選項由外殼按名稱表生成；級別機器值唔掃）
  const ev = readJSON(path.join(out, 'event.json'), null);
  if (ev) { check(ev, 'summary', 'event.json', '真實事件'); (Array.isArray(ev.items) ? ev.items : []).forEach((it, i) => check(it, 'why', 'event.json', `第 ${i + 1} 項理由`)); }
  const objs = { 'receipt.json': receipt, 'ask.json': pack, 'company-page.json': page, 'event.json': ev };
  for (const f of touched) if (objs[f]) fs.writeFileSync(path.join(out, f), JSON.stringify(objs[f], null, 2));
}

export function scanOutput(out) {
  const hits = [];
  visitOutput(out, (value, file, where) => {
    for (const issue of issuesOf(value)) {
      const pos = value.indexOf(issue.term);
      hits.push({ file, where, kind: issue.kind, term: issue.term, context: value.slice(Math.max(0, pos - 20), pos + issue.term.length + 20) });
    }
    return value;
  });
  return hits;
}
// 機械步（4.10 (2)(3)）：回 { marked: [{file, where}], colloquial: 數目 }
export function fixOutput(out, ctx = {}) {
  const marked = [];
  visitOutput(out, (value, file, where) => {
    if (!issuesOf(value).length) return value;
    const d = deCodeInfo(value, ctx);
    if (d.marked) marked.push({ file, where });
    return d.text;
  });
  return { marked, colloquial: scanOutput(out).filter(h => h.kind === 'colloquial').length };
}
