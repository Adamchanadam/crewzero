// 收據確認題：答案只接受三種指定寫法，外殼不直接寫入業績帳本。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { freshTestOut } from '../lib/out-guard.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const [PROTO = path.resolve(here, '../../../prototypes/proofread'), OUT] = process.argv.slice(2);
if (!OUT) throw new Error('需要系統暫存資料夾內的輸出資料夾');
freshTestOut(OUT);
const ask = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const names = ask.NAMES;
const results = [], ok = (name, pass, info = '') => results.push({ name, pass: !!pass, info });
const pack = { id: 'ask-receipt', questions: [{ id: 'q1', kind: 'money' }, { id: 'q2', kind: 'money' }, { id: 'q3', kind: 'money' }] };
const reply = answers => ({ ok: true, head: { kind: 'ask-answer', ref: pack.id }, machine: { format: 'startup-os.ask-reply/0.1', pack: pack.id, answers } });
ok('三種收據答案均通過核對', [names.ui.mnyConfirm, names.ui.mnyReject, names.ui.mnyConfirmEdit].every((value, i) => ask.validateAskReply(reply([{ id: 'q' + (i + 1), value, ...(value === names.ui.mnyConfirmEdit ? { edit: { amount: '12.00', date: '2026-11-10', category: 'goods', what: '材料', payer: '甲' } } : {}) }]), pack).ok));
ok('修改後入帳只可有五個指定欄位', !ask.validateAskReply(reply([{ id: 'q1', value: names.ui.mnyConfirmEdit, edit: { amount: '12', other: 'x' } }]), pack).ok);
const eventPrompt = fs.readFileSync(path.join(PROTO, 'ai-event.md'), 'utf8'), shell = fs.readFileSync(path.join(PROTO, 'run.mjs'), 'utf8');
ok('收據引句與圖片核對規則已寫入提示', /quote/.test(eventPrompt) && /只有圖片/.test(eventPrompt));
// 取出 handleEventConfirm 內 money 題的整段（到第一個 continue 為止），核對段內沒有寫入 money.json
const moneyBlock = (/if \(q\.kind === 'money'\) \{([\s\S]*?)continue;/.exec(shell) || [])[1];
ok('每包沿用三題上限且確認不寫 money.json', /items\.slice\(0, 3\)/.test(shell) && typeof moneyBlock === 'string' && moneyBlock.length < 2000 && !/money\.json|writeMoney|moneyPaths|writeJSON|writeFileSync|atomic/.test(moneyBlock), moneyBlock && moneyBlock.slice(0, 200));
const pass = results.filter(item => item.pass).length;
for (const item of results) console.log((item.pass ? 'PASS ' : 'FAIL ') + item.name + (item.pass ? '' : '\n      ' + item.info));
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
