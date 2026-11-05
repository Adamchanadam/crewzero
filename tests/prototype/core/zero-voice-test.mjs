// 用字及機械轉換；純本機檔案／函數，不啟動伺服器、瀏覽器或 AI。
// node zero-voice-test.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const [PROTO, OUT] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const { scanOutput, fixOutput } = await import(pathToFileURL(path.join(PROTO, 'style-check.mjs')).href);
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
// 僅匹配這個詞位，不能因同一行有合法例外而放行其他 AI 字樣。
const exceptions = [
  { file: 'names.js', text: '照 AI 建議（先咁計住，到期再問）', reason: '舊字串的轉換輸入，保留才能讀取舊畫面文字。' },
  { file: 'names.js', text: 'AI 照你嘅答案繼續做', reason: '舊字串的轉換輸入，輸出已改為 Zero。' },
  { file: 'names.js', text: 'AI 繼續：', reason: '舊工作標籤的轉換輸入。' },
  { file: 'ask.html', text: "P.askedBy === 'AI'", reason: '舊問題包的機器枚舉，並非顯示給創辦人的稱呼。' },
  { file: 'dashboard.html', text: '/^(?:AI|Zero) 建議/', reason: '同時識別舊資料 AI 建議與新資料 Zero 建議。' },
  { file: 'dashboard.html', text: '/^(?:AI|Zero) 解讀/', reason: '同時識別舊資料 AI 解讀與新資料 Zero 解讀。' }
];
// 保留字串／正則內的 //，只移除真正註解。跨行 HTML、CSS、JS 註解均處理。
function uncomment(source) {
  let block = '', quote = '', escaped = false;
  return source.split(/\r?\n/).map(line => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      if (block) { if (line.startsWith(block, i)) { i += block.length - 1; block = ''; } out += ' '; continue; }
      const c = line[i];
      if (quote) { out += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue; }
      if (line.startsWith('<!--', i)) { block = '-->'; i += 3; out += '    '; continue; }
      if (line.startsWith('/*', i)) { block = '*/'; i++; out += '  '; continue; }
      if (line.startsWith('//', i)) break;
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
    }
    // 單／雙引號不能跨實體行；template literal 則可以。
    if (quote !== '`') { quote = ''; escaped = false; }
    return out;
  });
}
function violations(file, source) {
  const hits = [];
  uncomment(source).forEach((line, i) => {
    const re = /(?<![A-Za-z0-9_])AI(?![A-Za-z0-9_])/g;
    for (const match of line.matchAll(re)) {
      const at = match.index, tail = line.slice(at), before = line.slice(0, at);
      if (/^AI (?:工具|模型|對話|隊員)/.test(tail) || /對話中的\s*$/.test(before)) continue;
      const allowed = exceptions.some(e => e.file === file && [...line.matchAll(new RegExp(e.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].some(m => at >= m.index && at < m.index + e.text.length));
      if (!allowed) hits.push({ file, line: i + 1, text: line.trim() });
    }
  });
  return hits;
}
for (const file of ['names.js', 'ask.html', 'proofread.html', 'dashboard.html', 'welcome.html', 'orbit.js', 'desk.js']) {
  const hits = violations(file, fs.readFileSync(path.join(PROTO, file), 'utf8'));
  ok(`${file}：獨立 AI 字樣只用於核准稱呼或明列例外`, hits.length === 0, hits);
}
ok('掃描器能捉錯字且不被同一行例外掩蓋', violations('ask.html', "P.askedBy === 'AI'; const title='AI 建議';").length === 1 && violations('names.js', "const t='AI 工具、AI 模型、AI 對話、對話中的 AI、AI 隊員';").length === 0 && violations('desk.js', '/* AI 建議\nAI 判斷 */ const t="Zero";').length === 0);
// 掃描實際用戶文字，legacy 的輸入只用作舊資料轉換。
const oldNames = /交資料|現實輸入|本季目標/;
function textValues(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter(([key]) => key !== 'legacy').flatMap(([, child]) => textValues(child));
}
const repo = path.resolve(PROTO, '..', '..');
const oldHits = textValues(N).filter(s => oldNames.test(s));
for (const file of ['site/index.html', 'README.md']) {
  if (oldNames.test(fs.readFileSync(path.join(repo, file), 'utf8'))) oldHits.push(file);
}
ok('用戶文字及網站不再使用三個舊名稱', oldHits.length === 0, oldHits);
ok('舊名稱掃描器能捉到三個舊名稱', ['交資料', '現實輸入', '本季目標'].every(s => oldNames.test(s)));
ok('舊輸出轉換兩個名稱，普通交資料不變', N.fix('現實輸入、本季目標、向對方交資料') === '真實進展、目前目標、向對方交資料');
ok('意見表的四個階段用新名稱', N.feedback.stages.join('|') === '尚未開始|已告訴 Zero|公司概覽已確認|示範資料');
const { guideCard } = await import(pathToFileURL(path.join(PROTO, 'dash-lib.mjs')).href);
const guideText = fs.readFileSync(path.join(PROTO, 'FIRST-WEEK.md'), 'utf8');
const guide = guideCard(guideText, { guide: 'noCompany', todo: [] });
const oldGuide = guideCard(guideText.replace('## 尚未告訴 Zero', '## 未交資料'), { guide: 'noCompany', todo: [] });
ok('第一星期指引的新舊標題均可讀取', guide?.button === N.ui.intake && guide.href === '#/intake' && oldGuide?.href === '#/intake', { guide, oldGuide });
const plain = fs.readFileSync(path.join(PROTO, 'ai-plain.md'), 'utf8');
ok('ai-plain 稱呼規則保留創辦人 AI 生意，轉述不改 Zero', plain.includes('Zero 只指正在替創辦人工作的隊員') && plain.includes('用 AI 幫傳統小生意') && plain.includes('轉述時也不可改成 Zero'));
const ideate = fs.readFileSync(path.join(PROTO, 'ai-ideate.md'), 'utf8');
ok('ideate 第一步提供三個對象，只有親身經歷可用不知道', ideate.includes('第一題必須列出三個可選對象') && ideate.includes('沒有線索就用常見的小生意類別') && ideate.includes('只有創辦人親身經歷的題才可建議'));
fs.mkdirSync(OUT, { recursive: true });
const work = fs.mkdtempSync(path.join(OUT, 'voice-'));
const original = '用 AI 幫傳統小生意';
for (const label of ['建議', '解讀', '推斷', '估計', '判斷']) {
  const dir = path.join(work, label); fs.mkdirSync(dir);
  const old = 'AI ' + label, expected = 'Zero ' + label;
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify({ summary: old, artifacts: [], founderNext: [original] }));
  fs.writeFileSync(path.join(dir, 'ask.json'), JSON.stringify({ title: old, context: original, questions: [{ id: 'AI-machine', ask: old, value: original, why: old, options: [{ text: old, note: original }] }] }));
  fs.writeFileSync(path.join(dir, 'note.md'), old + '\n\n' + original + '\n\n你原話：「' + original + '」\n');
  scanOutput(dir); fixOutput(dir);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  const ask = JSON.parse(fs.readFileSync(path.join(dir, 'ask.json'), 'utf8'));
  const md = fs.readFileSync(path.join(dir, 'note.md'), 'utf8');
  ok(`style-check 機械轉換 ${old}，保留生意中的 AI 及機器編號`, receipt.summary === expected && receipt.founderNext[0] === original && ask.title === expected && ask.context === original && ask.questions[0].id === 'AI-machine' && ask.questions[0].ask === expected && ask.questions[0].value === original && ask.questions[0].options[0].text === expected && md.startsWith(expected) && md.includes(original) && md.includes('你原話：「' + original + '」'), { receipt, ask, md });
}
ok('舊標籤仍能轉換，新標籤不重複轉換', N.zeroLabels('AI 建議 · 未確認') === N.dash.aiUnconfirmed && N.zeroLabels(N.dash.aiUnconfirmed) === N.dash.aiUnconfirmed);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '\n' + JSON.stringify(r.info ?? null)));
console.log(`${results.filter(r=>r.pass).length}/${results.length} passed`);
process.exitCode = results.every(r=>r.pass) ? 0 : 1;
