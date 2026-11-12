// 名稱機制檢查：名稱表全部書面語；頁面唔自己寫名稱表已有嘅名；標題口語字檢查（命令入口退回、AI 流程照放並記警告）
// 用法：node names-check.mjs <原型資料夾> <輸出資料夾>
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [PROTO, OUT] = process.argv.slice(2);
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: i });
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));

const bad = [...Object.entries(N.ui), ...Object.entries(N.field)].filter(([, v]) => N.isColloquial(v));
ok('名稱表全部書面語', bad.length === 0, bad);

// 頁面入面唔可以有名稱表已有嘅名（4 字或以上，避免撞短字）以字串形式寫死
for (const f of ['ask.html', 'proofread.html', 'desk.js', 'welcome.html']) {
  const t = fs.readFileSync(path.join(PROTO, f), 'utf8');
  // 此處是沒有宿主名稱時的通用後備值；其他位置仍檢查重複標籤。
  const labels = f === 'proofread.html' ? t.replace("(st.ai && st.ai.name) || 'AI 工具'", '(st.ai && st.ai.name) || hostFallback') : t;
  const dup = Object.values(N.ui).filter(v => v.length >= 4 && !/\{/.test(v) && labels.includes(`'${v}'`));
  ok(`${f}：冇自己寫名稱表已有嘅名`, dup.length === 0, dup);
  ok(`${f}：冇舊名「公司一頁」`, !t.includes('公司一頁'));
}

// 頁面同外殼嘅固定文字（有中文嘅字串）唔可以有內部術語
for (const f of ['ask.html', 'proofread.html', 'welcome.html', 'run.mjs', 'server.mjs', 'certify.mjs', 'host-lib.mjs', 'company-page-check.mjs']) {
  const shown = /\.html$/.test(f) ? () => true : l => /step\(|finish\(|reason:|why = |message:|item\(|fix|detail|names = |summary:|warnings\.push|errors\.push|fail\(/.test(l);
  const source = fs.readFileSync(path.join(PROTO, f), 'utf8').split(/\r?\n/).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l) && shown(l)).join('\n');
  // download 屬性是檔案名稱；相鄰的連結文字仍受原有掃描約束。
  const t = /\.html$/.test(f) ? source.replace(/\bdownload:\s*'[^'\n]*'/g, 'download: filename') : source;
  const hits = [];
  const re = /'([^'\n]*[\u4e00-\u9fff][^'\n]*)'|`([^`\n]*[\u4e00-\u9fff][^`\n]*)`/g; let m;
  while ((m = re.exec(t))) { const s = (m[1] || m[2]).replace(/\$\{[^}]*\}/g, ''); const j = N.styleIssues(s).filter(x => x.kind === 'jargon'); if (j.length) hits.push(s.slice(0, 60) + ' → ' + j.map(x => x.term).join(',')); }
  ok(`${f}：畫面文字冇內部術語`, hits.length === 0, hits.slice(0, 8));
}

// 舊紀錄嘅舊名，顯示時會換成新名
ok('舊名轉新名', N.fix('公司一頁 · 已記低你嘅答案') === '公司概覽 · 已記錄答案', N.fix('公司一頁 · 已記低你嘅答案'));

// 標題檢查
freshTestOut(OUT);
process.env.SOS_DATA = path.join(OUT, 'data');
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const DIR = lib.dataDirs(PROTO);
const pack = t => ({ format: 'startup-os.ask/0.1', title: t, questions: [{ id: 'a', ask: '何時開始？', kind: 'date', value: '2026-11-02', why: '測試' }] });
const strict = lib.preparePacks(pack('約農場甲見面之前要你決定嘅事'), { dirs: DIR });
ok('命令入口：口語標題退回', !strict.ok && strict.errors.some(e => /書面語/.test(e)), strict.errors);
const lenient = lib.preparePacks(pack('約農場甲見面之前要你決定嘅事'), { dirs: DIR, strictTitle: false });
ok('AI 流程：口語標題照放，記警告', lenient.ok && lenient.packs.length === 1 && lenient.warnings.length === 1, lenient.warnings);
const formal = lib.preparePacks(pack('約見農場甲前的待決事項'), { dirs: DIR });
ok('書面語標題通過', formal.ok && formal.warnings.length === 0, formal.errors);

console.log(JSON.stringify(results, null, 1));
console.log('PASS ' + results.filter(r => r.pass).length + ' / ' + results.length);
