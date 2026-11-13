// 0.44.0 F1：只讀預演工具。它只列出建議收起的題目，絕不寫入資料夾。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readJSON } from '../../../prototypes/proofread/ask-lib.mjs';

const [DATA] = process.argv.slice(2);
if (!DATA || !fs.existsSync(DATA)) {
  console.log('用法：node fact-cleanup-rehearsal.mjs <資料夾>');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = path.resolve(here, '../../../prototypes/proofread');
const { planCleanup } = await import(pathToFileURL(path.join(prototype, 'fact-ops.mjs')).href);
const asks = path.join(DATA, 'asks'), answersDir = path.join(DATA, 'ledger', 'answers');
const packs = fs.existsSync(asks) ? fs.readdirSync(asks).filter(name => name.endsWith('.json'))
  .map(name => readJSON(path.join(asks, name), null)).filter(pack => pack && Array.isArray(pack.questions)) : [];
const answers = Object.fromEntries(packs.map(pack => [pack.id, readJSON(path.join(answersDir, pack.id + '.json'), { answers: {} })]));
const state = readJSON(path.join(DATA, 'ledger', 'state.json'), {});
const today = new Date().toISOString().slice(0, 10);
const plan = planCleanup({ packs, answers, state, today });
const byQuestion = new Map(packs.flatMap(pack => pack.questions.map(question => [pack.id + '\u0000' + question.id, question])));
const clip = value => String(value || '').replace(/[\r\n]+/g, ' ').replace(/\S+@\S+/g, '［已略］')
  .replace(/(?:\+?\d[\s().-]?){8,}/g, '［已略］').trim().slice(0, 40);
const target = closure => {
  if (closure.by && closure.by.from === 'state') return '現行值「' + clip(closure.by.value) + '」' + (closure.by.source ? '（來源：' + clip(sourceTitle(closure.by.source)) + '）' : '');
  if (closure.by && closure.by.qId) {
    const q = byQuestion.get(String(closure.by.packId) + '\u0000' + String(closure.by.qId));
    return q ? '仍有效題目「' + clip(q.ask) + '」' : '仍有效題目';
  }
  return '沒有可讀取的涵蓋來源';
};
const sourceTitle = source => {
  const input = ((state && state.inputs) || []).find(row => row && row.id === source);
  return input && input.title ? input.title : source === 'founder' ? '創辦人確認' : source || '已確認的現行紀錄';
};

console.log(JSON.stringify(plan.summary, null, 2));
for (const closure of plan.closures) {
  const question = byQuestion.get(closure.packId + '\u0000' + closure.qId);
  console.log(`${clip(question && question.ask)} → ${target(closure)}`);
}
