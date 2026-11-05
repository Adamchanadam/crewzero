// 「你原話」標籤掃描（規劃書 3.1 硬規矩：AI 按文件預填嘅值唔可以變成「你原話」）。
// 獨立重做一次核對，唔用原型程式嘅判斷：
//   (1) 每份預填紀錄：標「文件原句」嘅答案，逐字（只忽略空白）喺封存嘅文件搵到，而且出處寫中嗰份文件；
//       讀唔到文字嘅文件（pdf、docx 等）唔可以有「文件原句」。
//   (2) 每份交資料：答案同任何一次預填（任何一題）逐字一樣嘅，來源唔可以係「你寫的」，同一題嘅要有「已確認」；
//       來源係「文件原句」嘅，對應預填都要係已核對嘅原句；檔案入面每題下面嘅來源一句同機器紀錄一致。
//   (3) 公司概覽：同 AI 推斷（唔係原句）預填一樣嘅項目，唔可以標「文件寫明」。
// 用法：node prefill-scan.mjs <資料夾（data）> [輸出 json]；冇違規 exit 0，有違規 exit 1。
import fs from 'node:fs';
import path from 'node:path';
const [DATA, OUT] = process.argv.slice(2);
if (!DATA || !fs.existsSync(DATA)) { console.log('用法：node prefill-scan.mjs <資料夾> [輸出 json]'); process.exit(2); }
const TEXT = ['md', 'txt', 'csv'];
const norm = s => String(s || '').replace(/[\s　]+/g, '');
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const walk = d => { const out = []; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } } catch { } return out; };
const violations = [], checked = { prefills: 0, answers: 0, intakes: 0, fields: 0, pageItems: 0 };
const bad = (where, what, detail) => violations.push({ where, what, detail });

// (1) 預填紀錄
const prefills = fs.existsSync(path.join(DATA, 'ledger', 'prefill')) ? fs.readdirSync(path.join(DATA, 'ledger', 'prefill')).filter(f => f.endsWith('.json')).map(f => readJSON(path.join(DATA, 'ledger', 'prefill', f))).filter(Boolean) : [];
const archived = walk(path.join(DATA, 'archive'));
for (const p of prefills) {
  checked.prefills++;
  const mine = archived.filter(f => path.basename(f).startsWith(p.id + '-prefill-'));
  const docs = mine.map(f => ({ name: path.basename(f).slice((p.id + '-prefill-').length).replace(/^\d+-/, ''), text: TEXT.includes(path.extname(f).slice(1).toLowerCase()) ? fs.readFileSync(f, 'utf8') : null }));
  if (!mine.length && p.from !== 'ideate') bad('預填 ' + p.id, '搵唔到封存文件，無法核對', '');
  for (const [q, a] of Object.entries(p.answers || {})) {
    checked.answers++;
    if (p.from === 'ideate' && a.label !== 'inferred') bad('預填 ' + p.id + ' ' + q, '構思答案只能是推斷，不能當文件原句', a.label);
    if (!['quote', 'inferred', 'unverified'].includes(a.label)) bad('預填 ' + p.id + ' ' + q, '標籤不明', a.label);
    if (a.label !== 'quote') continue;
    const hit = docs.filter(d => d.text != null && norm(d.text).includes(norm(a.text)));
    if (!hit.length) bad('預填 ' + p.id + ' ' + q, '標「文件原句」但文件搵唔到', a.text.slice(0, 80));
    else if (!hit.some(d => d.name === a.source)) bad('預填 ' + p.id + ' ' + q, '出處唔係含有原句嗰份文件', { source: a.source, found: hit.map(d => d.name) });
  }
}
const allAns = prefills.flatMap(p => Object.entries(p.answers || {}).map(([q, a]) => ({ id: p.id, q, ...a })));

// (2) 交資料（收件匣同封存）
const LINE = { quote: '（來源：你確認的文件原句', adopted: '（來源：你認同的 Zero 建議', unverified: '（來源：你確認的 Zero 預填', moved: '（來源：Zero 按文件預填的句子，由另一題搬來', founder: '（來源：你寫的）' };
const intakes = [...walk(path.join(DATA, 'archive')), ...walk(path.join(DATA, 'founder', 'inbox'))].filter(f => f.endsWith('-intake.md'));
for (const f of intakes) {
  checked.intakes++;
  const text = fs.readFileSync(f, 'utf8'), m = text.match(/```json\s*([\s\S]*?)```\s*$/);
  const mc = m ? (() => { try { return JSON.parse(m[1]); } catch { return null; } })() : null;
  if (!mc || !mc.fields) { bad(path.basename(f), '交資料檔讀唔到機器紀錄', ''); continue; }
  const prov = mc.provenance || {};
  for (const [q, v] of Object.entries(mc.fields)) {
    if (!String(v || '').trim()) continue;
    checked.fields++;
    const same = allAns.filter(a => norm(a.text) === norm(v)), sameQ = same.filter(a => a.q === q), p = prov[q];
    if (same.length && (!p || p.kind === 'founder')) bad(path.basename(f) + ' ' + q, '答案同 AI 預填一樣，卻記成「你寫的」', String(v).slice(0, 80));
    if (sameQ.length && p && p.kind !== 'founder' && !p.confirmed) bad(path.basename(f) + ' ' + q, 'AI 預填未經確認就送出', String(v).slice(0, 80));
    // 由另一題搬來嘅預填：創辦人冇逐條確認過，唔可以記「已確認」
    if (p && p.moved && (sameQ.length || p.confirmed)) bad(path.basename(f) + ' ' + q, '搬題的預填被記成已確認或同題預填', String(v).slice(0, 80));
    if (p && p.kind === 'quote' && !same.some(a => a.label === 'quote')) bad(path.basename(f) + ' ' + q, '記成「文件原句」但對應預填唔係已核對原句', String(v).slice(0, 80));
    if (p && p.kind === 'adopted' && !same.length) bad(path.basename(f) + ' ' + q, '記成 AI 建議但搵唔到對應預填', String(v).slice(0, 80));
    // 檔案入面嗰題下面嘅來源一句
    const sec = text.split(/^## /m).find(s => s.startsWith(q.slice(1) + '. '));
    const want = !p ? null : p.moved ? LINE.moved : p.kind === 'quote' ? LINE.quote : p.kind === 'adopted' && p.label === 'unverified' ? LINE.unverified : p.kind === 'adopted' ? LINE.adopted : LINE.founder;
    // 已保存的 AI 來源字眼仍是有效紀錄；新紀錄使用 Zero。
    const accepted = want ? [want, want.replace('Zero', 'AI')] : [];
    if (mc.provenance && want && !accepted.some(w => (sec || '').includes(w))) bad(path.basename(f) + ' ' + q, '檔案入面嘅來源一句同機器紀錄唔一致', { want, got: (sec || '').split('\n').filter(l => l.startsWith('（來源')) });
    if (mc.provenance && (sec || '').includes(LINE.founder) && same.length) bad(path.basename(f) + ' ' + q, '檔案寫「你寫的」但答案同 AI 預填一樣', String(v).slice(0, 80));
  }
}

// (3) 公司概覽：AI 推斷唔可以升做文件寫明
const page = readJSON(path.join(DATA, 'company', 'page.json'));
if (page) {
  const items = [];
  (function each(o) { if (Array.isArray(o)) return o.forEach(each); if (o && typeof o === 'object') { if ('origin' in o && 'value' in o) items.push(o); Object.values(o).forEach(each); } })(page);
  const inferred = allAns.filter(a => a.label !== 'quote');
  for (const it of items) {
    checked.pageItems++;
    if (it.origin === 'doc' && typeof it.value === 'string' && inferred.some(a => norm(a.text) === norm(it.value))) bad('公司概覽 ' + (it.label || it.id), 'AI 推斷的預填被標成文件寫明', it.value.slice(0, 80));
  }
}

const report = { at: new Date().toISOString(), data: DATA, checked, violations };
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`預填 ${checked.prefills} 份（${checked.answers} 條）、交資料 ${checked.intakes} 份（${checked.fields} 條答案）、公司概覽 ${checked.pageItems} 項；違規 ${violations.length} 項`);
for (const v of violations) console.log('違規：' + v.where + '：' + v.what + (v.detail ? ' ' + JSON.stringify(v.detail).slice(0, 200) : ''));
process.exit(violations.length ? 1 : 0);
