// 目標日期（公司概覽「目標與現況」）測試：日期連動、暫定覆核日只有一種日子、兩層縮排、回覆檔、後台收窄、核對規則
// 只用兩個虛構重現資料：fixtures/goal-dates-repro.js（G2 無期限欄，句首寫日期）、goal-dates-repro-structured.js（G2 有期限欄）
// 用法：node goal-dates-test.mjs <chrome.exe> <輸出資料夾> <原型資料夾> <假 adapter> <起始埠> [埠段大小，預設 20]
// 埠段：本組只可使用 [起始埠, 起始埠 + 埠段大小) 之內的埠（run-all.mjs 給「目標日期」20 個），否則會落入下一組的埠段
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import net from 'node:net';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass, forgetPass, certify } from '../lib/testkit.mjs';

const [CHROME, OUT, PROTO, ADAPTER, PORT0, SPAN0] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const lib = await import(pathToFileURL(path.join(PROTO, 'ask-lib.mjs')).href);
const chk = await import(pathToFileURL(path.join(PROTO, 'company-page-check.mjs')).href);
// GD_TRACE=1：逐條進度除了印到 stderr，亦即時寫入 <輸出資料夾>/gd-trace.log（run-all 要等整組結束才寫日誌，卡住時從這個檔看進度）
const traceLog = line => { if (!process.env.GD_TRACE) return; console.error(line); try { fs.appendFileSync(path.join(OUT, 'gd-trace.log'), line + '\n'); } catch { } };
const trace = msg => traceLog(new Date().toISOString().slice(11, 19) + ' ---- ' + msg);
const results = []; const ok = (n, p, i) => { results.push({ name: n, pass: !!p, info: i }); traceLog(new Date().toISOString().slice(11, 19) + ' ' + (p ? 'PASS' : 'FAIL') + ' ' + n); };
// 等伺服器、查狀態的 fetch 一律有時限：埠接受連線卻不回應時，不會空等預設的 300 秒
const tfetch = (u, o = {}) => fetch(u, { signal: AbortSignal.timeout(20000), ...o });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const PORT = Number(PORT0), SPAN = Number(SPAN0 || 20);
const KEY_LEGACY = 'sos-proofread:goal-dates-repro-2026-11-06:1:b1024575', KEY_STRUCT = 'sos-proofread:goal-dates-repro-structured-2026-11-06:1:54829453';
const loadFixture = f => { const c = { window: {} }; vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(PROTO, 'fixtures', f), 'utf8'), c); return c.window.STARTUP_OS_PAGE; };
const plain = s => String(s || '').replaceAll('2026 年 ', '').replace(/\s+/g, ' ');

trace("進入 一：頁面（無頭 Chrome，真實點擊與輸入）");
/* ---------- 一：頁面（無頭 Chrome，真實點擊與輸入） ---------- */
const base = pathToFileURL(path.join(PROTO, 'proofread.html')).href;
const LEGACY = base + '?data=fixtures/goal-dates-repro.js', STRUCT = base + '?data=fixtures/goal-dates-repro-structured.js';
const c = await openChrome(CHROME, path.join(OUT, 'profile'), PORT + 1);
const { ev, go, click, errors } = c;
async function fresh(url, w = 1440) { await go(url, w, 1200); await ev('localStorage.clear()'); await go(url, w, 1500); }
async function clickText(scope, text) {
  const found = await ev(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(scope)})].filter(e=>e.textContent.includes(${JSON.stringify(text)}));if(!els.length)return false;els[0].setAttribute('data-x','1');return true})()`);
  if (!found) throw new Error('搵唔到 ' + scope + ' ／ ' + text);
  await click('[data-x="1"]');
  await ev(`document.querySelectorAll('[data-x]').forEach(e=>e.removeAttribute('data-x'))`);
}
// 日期欄：以原生方式寫入值（不同系統地區的欄位次序不同），再真實按「使用這個日子」
async function setDate(dataK, iso) {
  await click(`[data-k="${dataK}"]`);
  await ev(`(()=>{const i=document.querySelector('.panel input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(iso)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await clickText('.panel .btn.primary', N.ui.useDate);
}
const txt = async sel => { const t = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent:null})()`); return t == null ? null : plain(t); };
const G1D = 'g~goal-quarter-due', G2D = 'g~goal-4w-due';
const G2DATE = '[data-row="goal-4w"] .row-date', G2HEAD = '[data-row="goal-4w"] .row-head', G1ROW = '[data-row="goal-quarter"]';
async function answerG1AndOpen() {
  await clickText('#dq-goal-quarter .opt', '三十位訂戶連續兩個月付費訂閱');
  await click('#rest-toggle'); await sleep(300);
}
async function draft() { return ev(`(()=>{const k=Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'));return {keys:k,edits:k.length?JSON.parse(localStorage.getItem(k[0])).edits:null}})()`); }
async function replyText() {
  await click('#go-main');
  const t = await ev(`document.querySelector('#modal-root pre.file').textContent`);
  const sum = await ev(`document.querySelector('#modal-root .m-rest').textContent`);
  await ev(`document.querySelector('#modal-root .m-foot .btn').click()`); await sleep(200);
  return { t, sum };
}
const machineOf = t => JSON.parse(/```json\r?\n([\s\S]*?)```/.exec(t)[1]);
let lastReply = null;
try {
  // 結構化資料：G1 提前 → G2 自動調整
  await fresh(STRUCT);
  await answerG1AndOpen();
  ok('一：初始 G2 檢查日 12 月 4 日、無調整標籤', (await txt(G2DATE)).includes('12 月 4 日') && !(await txt(G2HEAD)).includes(N.ui.autoAdjusted));
  const d0 = await draft();
  ok('一：草稿鑰匙不變（結構化）', d0.keys.length === 1 && d0.keys[0] === KEY_STRUCT, d0.keys);
  await setDate(G1D, '2026-11-27');
  ok('一：G1 提前到 11 月 27 日：G2 自動變 11 月 27 日', (await txt(G2DATE)).includes('11 月 27 日'), await txt(G2DATE));
  ok('一：標示「隨目前目標期限調整」，與「已修改」分開', (await txt(G2HEAD)).includes(N.ui.autoAdjusted) && !(await txt(G2HEAD)).includes(N.ui.changed));
  ok('一：自動值不存入草稿（只存創辦人親自改的）', Object.keys((await draft()).edits).join() === 'goal-quarter-due', JSON.stringify((await draft()).edits));
  ok('一：暫定總說明只有一種日子（11 月 27 日，且不再有 11 月 9 日）', (await txt('.gaps')).includes('11 月 27 日前後的每週訪問') && !(await txt('#layer1')).includes('11 月 9 日'), await txt('.gaps'));
  lastReply = await replyText();
  const m1 = machineOf(lastReply.t);
  const auto = m1.edits.find(e => e.id === 'goal-4w-due');
  ok('二：回覆檔 edits 帶 auto:true 與調整後的值', auto && auto.auto === true && auto.value === '2026-11-27', auto);
  ok('二：創辦人親自改的（G1 期限）沒有 auto', m1.edits.find(e => e.id === 'goal-quarter-due') && !m1.edits.find(e => e.id === 'goal-quarter-due').auto);
  ok('二：tentativeKept 為收窄後日子（全部 2026-11-27）', m1.tentativeKept.length >= 1 && m1.tentativeKept.every(x => x.until === '2026-11-27'), m1.tentativeKept.map(x => x.until));
  ok('二：自動調整的項目不在 keptAsAI', !m1.keptAsAI.includes('goal-4w-due'));
  ok('二：「你修改了 N 項」只算創辦人（1 項），自動調整另計', /結果：已確認（你修改了 1 項；另有 1 項隨目前目標期限調整）/.test(lastReply.t) && lastReply.sum.includes('你修改了 1 項') && lastReply.sum.includes('1 項隨目前目標期限調整'), lastReply.sum);
  ok('二：回覆檔另列「隨目前目標期限調整的項目」一節，且不再有 nextAskOn 日子', lastReply.t.includes('## ' + N.t('autoReplyHead', { n: 1 })) && !lastReply.t.includes('11 月 9 日前後') && !m1.tentativeKept.some(x => x.until === '2026-11-09'));
  // G1 改回 → 撤回
  await setDate(G1D, '2026-12-31');
  ok('一：G1 改回 12 月 31 日：自動調整撤回，G2 回 12 月 4 日', (await txt(G2DATE)).includes('12 月 4 日') && !(await txt(G2HEAD)).includes(N.ui.autoAdjusted), await txt(G2DATE));
  ok('二：撤回後回覆檔沒有 auto', !(await replyText()).t.includes('"auto": true'));
  // 創辦人親自改 G2（先不遲於 G1），再把 G1 提前：只提示，不改
  await setDate(G2D, '2026-12-20');
  ok('一：親自改 G2 為 12 月 20 日：顯示「已修改」', (await txt(G2HEAD)).includes(N.ui.changed));
  await setDate(G1D, '2026-12-01');
  ok('一：G1 提前到 12 月 1 日：G2 維持 12 月 20 日（不自動改創辦人的值）', (await txt(G2DATE)).includes('12 月 20 日'), await txt(G2DATE));
  ok('一：顯示提示「短期目標檢查日（12 月 20 日）遲於目前目標期限（12 月 1 日），請修改其中一項。」', (await txt('#date-conflict')) === N.t('dateConflict', { a: '12 月 20 日', b: '12 月 1 日' }), await txt('#date-conflict'));
  ok('一：親自改的 G2 沒有「隨目前目標期限調整」', !(await txt(G2HEAD)).includes(N.ui.autoAdjusted));
  ok('一：有衝突時回覆檔不自動調整（edits 無 auto）', !machineOf((await replyText()).t).edits.some(e => e.auto));

  // 舊資料：句首日期抽出
  await fresh(LEGACY);
  const d1 = await draft();
  await answerG1AndOpen();
  ok('一：草稿鑰匙不變（舊資料）', (await draft()).keys[0] === KEY_LEGACY, (await draft()).keys);
  ok('一：舊資料日期抽出放在日期行（12 月 4 日），內容不再以「至…日：」開頭', (await txt(G2DATE)).includes('12 月 4 日') && !(await txt('[data-row="goal-4w"] .ed-val')).startsWith('至'), await txt('[data-row="goal-4w"] .ed-val'));
  ok('一：日期行說明修改句子即可更改（不另設編輯）', (await txt(G2DATE)).includes(N.ui.dateInText) && (await ev(`!document.querySelector('${G2DATE} .ed-val')`)));
  ok('一：舊資料日期不遲於期限時沒有衝突提示', (await txt('#date-conflict')) === null);
  await setDate(G1D, '2026-11-27');
  ok('一：舊資料日期遲於期限：顯示提示', (await txt('#date-conflict')) === N.t('dateConflict', { a: '12 月 4 日', b: '11 月 27 日' }), await txt('#date-conflict'));
  ok('一：舊資料不自動改句子，句子內容不含日期', !(await txt('[data-row="goal-4w"] .ed-val')).includes('11 月 27 日'));
  const m2 = machineOf((await replyText()).t);
  ok('二：舊資料的回覆檔 tentativeKept 也收窄到 11 月 27 日', m2.tentativeKept.length >= 1 && m2.tentativeKept.every(x => x.until === '2026-11-27'), m2.tentativeKept.map(x => x.until));

  // 已答項目不再顯示「Zero 建議」出處；未答項目仍顯示
  await fresh(LEGACY);
  await answerG1AndOpen();
  ok('一：未答項目仍顯示「Zero 建議」出處', (await txt('[data-row="progress"] .row-note')).includes(N.ui.tent_ai));
  ok('一：已答（G1）項目不再顯示「Zero 建議」出處，仍顯示「暫定」', !(await txt(G1ROW + ' .row-note')).includes(N.ui.tent_ai) && (await txt(G1ROW + ' .row-note')).includes(N.ui.tentative), await txt(G1ROW + ' .row-note'));
  ok('一：「暫定」標籤只寫「暫定」，日子放在提示文字', (await ev(`document.querySelector('${G1ROW} .tag.tent').textContent`)) === N.ui.tentative && (await ev(`document.querySelector('${G1ROW} .tag.tent').title`)).includes('12 月 4 日前後的每週訪問'));
  ok('一：頁面不再出現 nextAskOn 的日子（11 月 9 日）', !(await txt('#app')).includes('11 月 9 日'));
  ok('一：同一項「已修改」最多一個', (await ev(`document.querySelectorAll('${G1ROW} .row-chips .tag.mine').length`)) <= 1);
  await setDate(G1D, '2026-12-31');
  ok('一：創辦人改日期後，同一項只有一個「已修改」', (await ev(`document.querySelectorAll('${G1ROW} .row-chips .tag.mine').length`)) === 1);

  // 兩層縮排與對齊（1440：約 24px；390：約 14px；無橫向捲動）
  for (const [w, want] of [[1440, 24], [390, 14]]) {
    await fresh(LEGACY, w);
    await click('#rest-toggle'); await sleep(300);
    const m = JSON.parse(await ev(`(()=>{
      function left(el){const t=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while(n=t.nextNode()){if(n.textContent.trim()){const r=document.createRange();r.selectNodeContents(n);const b=r.getClientRects()[0];if(b)return b.left}}return null}
      const out={rows:[]};
      for(const id of ['goal-quarter','goal-4w','progress','next-action']){const row=document.querySelector('[data-row="'+id+'"]');
        out.rows.push({name:left(row.querySelector('.row-name')),content:left(row.querySelector('.row-body > .ed .ed-val')),date:row.querySelector('.row-date')?left(row.querySelector('.row-date')):null,note:row.querySelector('.row-note')?row.querySelector('.row-note').getBoundingClientRect().left:null,sub:row.querySelector('.row-sub')?left(row.querySelector('.row-sub')):null})}
      const st=document.querySelector('.status');out.st={name:left(st.querySelector('.row-name')),judge:left(st.querySelector('.p-judge')),item:left(st.querySelector('.st-text'))};
      out.sw=document.documentElement.scrollWidth;out.iw=window.innerWidth;return JSON.stringify(out)})()`));
    const near = (a, b, t = 3) => Math.abs(a - b) <= t;
    ok(`一：${w}px 第二層比項目名稱縮約 ${want}px`, m.rows.every(r => near(r.content - r.name, want, 4)), m.rows.map(r => Math.round(r.content - r.name)));
    ok(`一：${w}px 內容、日期行、附註行、對應行左邊緣對齊（差不超過 2px）`, m.rows.every(r => [r.date, r.note, r.sub].filter(x => x != null).every(x => near(x, r.content, 2))), m.rows);
    ok(`一：${w}px「目前進度」說明與各項同樣縮進`, near(m.st.judge - m.st.name, want, 4) && near(m.st.item, m.st.judge, 2), m.st);
    ok(`一：${w}px 沒有橫向捲動`, m.sw <= m.iw, [m.sw, m.iw]);
  }
  /* ---------- 六：覆審修正（頁面） ---------- */
  let vn = 0;
  const variant = (fn, legacy) => { const p = JSON.parse(JSON.stringify(loadFixture(legacy ? 'goal-dates-repro.js' : 'goal-dates-repro-structured.js'))); fn(p); const f = path.join(OUT, `v${++vn}.js`); fs.writeFileSync(f, 'window.STARTUP_OS_PAGE = ' + JSON.stringify(p) + ';\n'); return base + '?data=' + pathToFileURL(f).href; };
  const rowOf = (p, plan) => p.glance.rows.find(r => r.plan === plan);
  const openFull = async url => { await fresh(url); await click('#rest-toggle'); await sleep(300); };
  try {
  // 六-1：空的 G2 期限欄仍可填寫；就緒清單、缺項、回覆 stillMissing 一致
  await openFull(variant(p => { rowOf(p, 'G2').due.value = ''; }));
  ok('六-1：期限欄為空、句首沒有日期：仍有空白日期編輯入口', await ev(`!!document.querySelector('${G2DATE} [data-k="${G2D}"].empty')`), await txt(G2DATE));
  ok('六-1：就緒清單列出「短期目標檢查日」', ((await txt('#ready-miss')) || '').includes(N.field['G2.endsOn']), await txt('#ready-miss'));
  ok('六-1：回覆 stillMissing 含這一欄', machineOf((await replyText()).t).stillMissing.includes('goal-4w-due'));
  await setDate(G2D, '2026-12-02');
  ok('六-1：填寫後顯示日期，就緒提示不再列出，stillMissing 不再含', (await txt(G2DATE)).includes('12 月 2 日') && !((await txt('#ready-miss')) || '').includes(N.field['G2.endsOn']) && !machineOf((await replyText()).t).stillMissing.includes('goal-4w-due'), await txt(G2DATE));
  await click(`[data-k="${G2D}"]`); await clickText('.panel .btn', N.ui.restore);
  ok('六-1：再「還原 Zero 建議」後入口仍在，並取得焦點', await ev(`!!document.querySelector('[data-k="${G2D}"].empty') && document.activeElement && document.activeElement.getAttribute('data-k') === '${G2D}'`), await ev(`document.activeElement && document.activeElement.outerHTML.slice(0,80)`));
  await openFull(variant(p => { const g = rowOf(p, 'G2'); g.due.value = ''; g.value = '至 12 月 4 日：' + g.value; }));
  ok('六-1：期限欄為空但句首有日期：用抽出的日期，不算缺', (await txt(G2DATE)).includes('12 月 4 日') && !machineOf((await replyText()).t).stillMissing.includes('goal-4w-due') && ((await txt('#ready-miss')) || '').includes(N.field['G2.endsOn']) === false);
  } catch (e) { ok('六-1 測試中斷', false, String(e && e.stack || e)); }
  try {
  // 六-2：不存在的日子不連動、不收窄
  await openFull(variant(p => { rowOf(p, 'G1').due.value = '2026-02-30'; }));
  const mInv = machineOf((await replyText()).t);
  ok('六-2：G1 期限為不存在的日子：G2 不自動調整，不顯示衝突', !(await txt(G2HEAD)).includes(N.ui.autoAdjusted) && (await txt('#date-conflict')) === null && !mInv.edits.some(e => e.auto), mInv.edits);
  ok('六-2：暫定覆核日不被收窄成不存在的日子', mInv.tentativeKept.length >= 1 && mInv.tentativeKept.every(x => x.until === '2026-12-04'), mInv.tentativeKept.map(x => x.until));
  } catch (e) { ok('六-2 測試中斷', false, String(e && e.stack || e)); }
  try {
  // 六-3：句首日期（沒有「至」、其他前綴、ISO）
  for (const [content, label] of [['2026 年 12 月 4 日：取得書面答覆', '無前綴'], ['在 12 月 4 日前：取得書面答覆', '「在」前綴加「前」'], ['2026-12-04：取得書面答覆', 'ISO 無前綴'], ['於 2026-12-04：取得書面答覆', 'ISO「於」前綴']]) {
    await openFull(variant(p => { const g = rowOf(p, 'G2'); delete g.due; g.value = content; }));
    ok('六-3：句首日期可辨認：' + label, (await txt(G2DATE) || '').includes('12 月 4 日') && (await txt('[data-row="goal-4w"] .ed-val')).startsWith('取得書面答覆'), [await txt(G2DATE), await txt('[data-row="goal-4w"] .ed-val')]);
  }
  await openFull(variant(p => { const g = rowOf(p, 'G2'); delete g.due; g.value = '取得書面答覆'; }));
  ok('六-3：句子沒有日期就沒有日期行', (await txt(G2DATE)) === null);
  const pageSrc = fs.readFileSync(path.join(PROTO, 'proofread.html'), 'utf8');
  const mm = /var LEG_ISO = (\/.*?\/), LEG_ZH = (\/.*?\/);/.exec(pageSrc);
  ok('六-3：校對頁與核對器用同一組句首日期規則', mm && new Function('return ' + mm[1])().source === chk.LEGACY_LEAD.iso.source && new Function('return ' + mm[2])().source === chk.LEGACY_LEAD.zh.source, mm && [mm[1], String(chk.LEGACY_LEAD.iso)]);
  } catch (e) { ok('六-3 測試中斷', false, String(e && e.stack || e)); }
  try {
  // 六-4、六-5：只承諾後台會重問的項目；面板顯示現行覆核日
  const fp = loadFixture('goal-dates-repro-structured.js'), tents = [];
  (function w(o) { if (Array.isArray(o)) return o.forEach(w); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'value' in o && 'label' in o && o.tentative) tents.push(o); for (const k in o) if (o[k] && typeof o[k] === 'object') w(o[k]); })(fp);
  const recheck = e => /^G(?:10|[1-9])$/.test(String(e.plan || '')) && e.kind !== 'grade';
  const nT = tents.length, mT = tents.filter(recheck).length;
  await openFull(STRUCT);
  const want4 = N.t('tentPart', { n: nT, m: mT, d: '12 月 4 日' });
  ok('六-4：資料有只屬一般暫定的項目（不是全部都會重問）', mT >= 1 && mT < nT, [nT, mT]);
  ok('六-4：總說明只承諾會重問的項目', (await txt('.gaps')).includes(want4), [await txt('.gaps'), want4]);
  ok('六-4：確認摘要與回覆檔同一說法', (await replyText()).sum.includes(want4) && (await replyText()).t.includes(want4));
  ok('六-4：會重問的項目（目前目標）標籤提示每週訪問', (await ev(`document.querySelector('${G1ROW} .tag.tent').title`)).includes('每週訪問'));
  await click('#layer3 .layer-toggle'); await sleep(300);
  ok('六-4：只是尚待核實的項目標籤不承諾日子', await ev(`(()=>{const t=document.querySelector('#missing .miss-item .tag.tent');return !!t && t.title.includes(${JSON.stringify(N.ui.tentPending)}) && !t.title.includes('每週訪問')})()`), await ev(`(document.querySelector('#missing .miss-item .tag.tent')||{}).title`));
  await click('#missing [data-k="x~md-goal-number"]');
  const pnl = await txt('.panel');
  ok('六-5：非重問項目面板：核對安排只寫尚待核實，核實方法照列原文', pnl.includes(N.ui.tentPlanHead + '：' + N.ui.tentPending) && pnl.includes(N.ui.tentTestHead + '：') && !pnl.includes('每週訪問') && !pnl.includes('到期處理方式'), pnl);
  await openFull(STRUCT);
  await clickText('#dq-goal-quarter .opt', '完成網上收款及寄送設定');
  await setDate(G1D, '2026-11-27');
  await click(`[data-k="g~goal-quarter"]`);
  const pnl2 = await txt('.panel');
  ok('六-5：重問項目面板顯示現行覆核日（11 月 27 日前後的每週訪問），不再有「到期處理方式」', pnl2.includes(N.ui.tentPlanHead + '：Zero 會在 11 月 27 日前後的每週訪問再與你核對') && pnl2.includes(N.ui.tentTestHead + '：') && !pnl2.includes('到期處理方式'), pnl2);
  } catch (e) { ok('六-4／六-5 測試中斷', false, String(e && e.stack || e)); }
  ok('一：頁面沒有錯誤', errors.length === 0, errors);
} catch (e) { ok('頁面測試中斷', false, String(e && e.stack || e)); }
finally { c.close(); }

trace("進入 三：後台（假 AI，隔離資料夾）：確認時收窄覆核日；自動調整");
/* ---------- 三：後台（假 AI，隔離資料夾）：確認時收窄覆核日；自動調整不算創辦人答案 ---------- */
let srv = null;
const BASE = `http://127.0.0.1:${PORT}`, DATA = path.join(OUT, 'data');
const get = async p => (await tfetch(BASE + p)).json();
const post = async (p, body) => { const r = await tfetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const seen = async () => new Set((await get('/api/status')).runs.map(r => r.id));
async function newRun(before, pred, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const r = (await get('/api/status')).runs.find(x => !before.has(x.id) && pred(x) && x.state !== 'running'); if (r) return r; await sleep(400); } return null; }
const J = (...p) => JSON.parse(fs.readFileSync(path.join(DATA, ...p), 'utf8'));
try {
  fs.mkdirSync(path.join(DATA, 'company'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'company', 'page.json'), JSON.stringify(loadFixture('goal-dates-repro-structured.js'), null, 2));
  srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await usePass(BASE);
  for (let i = 0; i < 60; i++) { try { if ((await get('/api/status')).ok) break; } catch { } await sleep(300); }
  ok('三：假 AI 認證', (await certify(BASE)).certify.state === 'passed');
  const page = J('company', 'page.json');
  const g1due = page.glance.rows.find(r => r.plan === 'G1').due, g2due = page.glance.rows.find(r => r.plan === 'G2').due;
  const order = page.path.milestones.map(m => m.id);
  const machine = { format: 'startup-os.proofread-reply/0.1', page: page.page.id, company: page.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order, orderProposed: order, orderChanged: false, nextActionMilestone: 'm1', decided: [],
    edits: [{ id: g1due.id, plan: 'G1.endsOn', label: '目前目標期限', ai: g1due.value, founder: '2026-11-27', value: '2026-11-27' }, { id: g2due.id, plan: 'G2.endsOn', label: '短期目標檢查日', ai: g2due.value, founder: '2026-11-27', value: '2026-11-27', auto: true }],
    keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: {}, kindsChanged: [] };
  const head = ['kind: proofread', 'ref: ' + page.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(page)), 'batch: false', 'shownAt: ' + lib.localIso()];
  const b = await seen();
  const sent = await post('/api/submit', { kind: 'proofread', ref: page.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
  ok('三：含 auto 欄位的回覆檔被接受', sent.code === 200 && sent.j && sent.j.ok, sent);
  const r = await newRun(b, x => x.kind === 'proofread');
  ok('三：確認完成', r && r.state === 'done', r && (r.error || r.steps));
  const s = J('ledger', 'state.json'), cf = J('ledger', 'confirmed.json');
  const ans = s.intake.answers;
  ok('三：開局答案的暫定覆核日已收窄到目前目標期限（2026-11-27）', ['G1', 'G2', 'G3', 'G5'].filter(p => ans[p] && ans[p].tentative).length >= 2 && ['G1', 'G2', 'G3', 'G5'].filter(p => ans[p] && ans[p].tentative).every(p => ans[p].tentative.until === '2026-11-27'), Object.fromEntries(Object.entries(ans).filter(([, a]) => a && a.tentative).map(([p, a]) => [p, a.tentative.until])));
  ok('三：確認紀錄只把創辦人親自改的記為 edits，自動調整另記 autoEdits', cf.edits.length === 1 && cf.edits[0].id === g1due.id && cf.autoEdits.length === 1 && cf.autoEdits[0].id === g2due.id, [cf.edits.map(e => e.id), (cf.autoEdits || []).map(e => e.id)]);
  ok('三：自動調整後的值仍進入確認值', cf.values[g2due.id] === '2026-11-27');
  const entries = fs.readFileSync(path.join(DATA, 'ledger', 'decisions.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const aEntry = entries.find(e => e.qid === g2due.id), fEntry = entries.find(e => e.qid === g1due.id);
  ok('三：決定紀錄把自動調整記成「隨目前目標期限調整」（auto），不是創辦人的答案', aEntry && aEntry.auto === true && aEntry.question.includes(N.ui.autoAdjusted) && aEntry.changed === true, aEntry);
  ok('三：創辦人親自改的期限仍記成創辦人修改（無 auto）', fEntry && fEntry.changed === true && !fEntry.auto, fEntry);
  const rr = (await get('/api/status')).runs.find(x => x.id === r.id);
  ok('三：進度文字「修改了 1 項」且另列自動調整', JSON.stringify(rr.steps).includes('修改了 1 項') && JSON.stringify(rr.steps).includes(N.ui.autoAdjusted), rr.steps);
} catch (e) { ok('後台測試中斷', false, String(e && e.stack || e)); }
finally { if (srv) srv.kill(); }

trace("進入 五：模擬 AI 第一次及修正都交不合規概覽（G2 無期限欄、");
/* ---------- 五：模擬 AI 第一次及修正都交不合規概覽（G2 無期限欄、句首寫日期）：不補空期限欄，頁面仍顯示日期，確認後不變差 ---------- */
let srv2 = null, c2 = null;
const BASE2 = `http://127.0.0.1:${PORT + 2}`, DATA2 = path.join(OUT, 'data-nodue');
const get2 = async p => (await tfetch(BASE2 + p)).json();
const post2 = async (p, body) => { const r = await tfetch(BASE2 + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE2 }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const seen2 = async () => new Set((await get2('/api/status')).runs.map(r => r.id));
async function newRun2(before, pred, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const r = (await get2('/api/status')).runs.find(x => !before.has(x.id) && pred(x) && x.state !== 'running'); if (r) return r; await sleep(400); } return null; }
try {
  fs.mkdirSync(DATA2, { recursive: true });
  srv2 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 2)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA2, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await usePass(BASE2);
  for (let i = 0; i < 60; i++) { try { if ((await get2('/api/status')).ok) break; } catch { } await sleep(300); }
  ok('五：假 AI 認證', (await certify(BASE2)).certify.state === 'passed');
  fs.writeFileSync(path.join(DATA2, 'fake-mode.txt'), 'intake:g2-nodue\nintake-repair:g2-nodue\n');
  let b2 = await seen2();
  await post2('/api/intake', { bizType: 'other', fields: { q1: '把本地小農的當季蔬菜直送餐廳（測試）', q2: '餐廳每週付款', q3: '兩個農場有興趣（口頭表示）', q4: '約第三個農場主見面', q5: '表哥送貨（已確定）' }, files: [] });
  const ir = await newRun2(b2, x => x.kind === 'intake', 90000);
  ok('五：AI 兩次都交不合規概覽，仍擬成公司概覽（不阻校對）', ir && ir.state === 'done', ir && ir.error);
  const logText = fs.readFileSync(path.join(DATA2, 'ledger', 'runs.log'), 'utf8');
  ok('五：有叫 AI 修正一次，修正後仍有問題，照用該概覽', /修正一次/.test(logText) && /沒有獨立期限/.test(logText) && /修正後仍未齊/.test(logText), logText.split('\n').filter(l => /修正/.test(l)).slice(0, 3));
  const pg = JSON.parse(fs.readFileSync(path.join(DATA2, 'company', 'page.json'), 'utf8'));
  const row2 = pg.glance.rows.find(r => r.plan === 'G2');
  ok('五：規整沒有為短期目標補空的期限欄', row2 && !row2.due && /^至 /.test(row2.value), row2 && { due: row2.due, value: row2.value });
  ok('五：沒有任何空的 G2.endsOn 欄', !JSON.stringify(pg).includes('G2.endsOn'));
  // 確認後 intake.state 不因此變差
  const order2 = pg.path.milestones.map(m => m.id);
  const machine2 = { format: 'startup-os.proofread-reply/0.1', page: pg.page.id, company: pg.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: order2, orderProposed: order2, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: { m3: 'real' }, kindsChanged: ['m3'] };
  const head2 = ['kind: proofread', 'ref: ' + pg.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(pg)), 'batch: false', 'shownAt: ' + lib.localIso()];
  b2 = await seen2();
  await post2('/api/submit', { kind: 'proofread', ref: pg.page.id, text: head2.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine2) + '\n```\n' });
  const pr = await newRun2(b2, x => x.kind === 'proofread');
  const st2 = JSON.parse(fs.readFileSync(path.join(DATA2, 'ledger', 'state.json'), 'utf8'));
  ok('五：確認完成，intake.state 為 complete、沒有未答齊欄（不因短期目標沒有期限欄而變差）', pr && pr.state === 'done' && st2.intake.state === 'complete' && !st2.intake.missing.length, st2.intake && { state: st2.intake.state, missing: st2.intake.missing });
  ok('五：短期目標的開局答案照常記入（內容完整、未被標為缺）', st2.intake.answers.G2 && String(st2.intake.answers.G2.value).startsWith('至 '), st2.intake.answers.G2);
  // 頁面：用該概覽開啟
  fs.writeFileSync(path.join(OUT, 'page-nodue.js'), 'window.STARTUP_OS_PAGE = ' + JSON.stringify(pg) + ';\n');
  c2 = await openChrome(CHROME, path.join(OUT, 'profile2'), PORT + 3);
  const url2 = base + '?data=' + pathToFileURL(path.join(OUT, 'page-nodue.js')).href;
  await c2.go(url2, 1440, 1200); await c2.ev('localStorage.clear()');
  await c2.go(url2, 1440, 1500);
  await c2.click('#rest-toggle'); await sleep(300);
  const t2 = async sel => c2.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return e?e.textContent:null})()`);
  const dd = new Date(Date.now() + 28 * 86400000);
  const want = (dd.getMonth() + 1) + ' 月 ' + dd.getDate() + ' 日';
  ok('五：頁面仍顯示由句首抽出的日期', plain(await t2('[data-row="g2"] .row-date')).includes(want), await t2('[data-row="g2"] .row-date'));
  ok('五：短期目標內容不再以「至…日：」開頭', !(await t2('[data-row="g2"] .ed-val')).startsWith('至'), await t2('[data-row="g2"] .ed-val'));
  const missN = async () => { const m = /(\d+) 項未有答案/.exec(String(await t2('.gaps') || '')); return m ? Number(m[1]) : 0; };
  const nodueMiss = await missN();
  // 對照：同一份概覽，只是短期目標改為合規（有期限欄），未有答案的項數應完全相同
  const ok2 = JSON.parse(JSON.stringify(pg)), g2ok = ok2.glance.rows.find(r => r.plan === 'G2');
  g2ok.value = g2ok.value.replace(/^至 [^：]*：/, ''); g2ok.due = { id: 'g2-due', plan: 'G2.endsOn', label: '短期目標檢查日', kind: 'date', value: want ? new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10) : '', origin: 'ai' };
  fs.writeFileSync(path.join(OUT, 'page-ok.js'), 'window.STARTUP_OS_PAGE = ' + JSON.stringify(ok2) + ';\n');
  const url3 = base + '?data=' + pathToFileURL(path.join(OUT, 'page-ok.js')).href;
  await c2.go(url3, 1440, 1200); await c2.ev('localStorage.clear()'); await c2.go(url3, 1440, 1500);
  await c2.click('#rest-toggle'); await sleep(300);
  const okMiss = await missN();
  ok('五：短期目標不算「未有答案」（無空欄標示、未答項數與合規概覽相同、沒有就緒缺欄提示）', nodueMiss === okMiss, { nodueMiss, okMiss });
  await c2.go(url2, 1440, 1500); await c2.click('#rest-toggle'); await sleep(300);
  ok('五：短期目標沒有空欄標示，也沒有就緒缺欄提示', (await c2.ev(`document.querySelectorAll('[data-row="g2"] .ed-val.empty').length`)) === 0 && (await t2('#ready-miss')) === null);
  await c2.click('#go-main');
  const rt = await c2.ev(`document.querySelector('#modal-root pre.file').textContent`);
  ok('五：回覆檔的 stillMissing 不含短期目標', !(machineOf(rt).stillMissing || []).some(id => /g2/i.test(id)), machineOf(rt).stillMissing);
  ok('五：頁面沒有錯誤', c2.errors.length === 0, c2.errors);
} catch (e) { ok('模擬 AI 不合規概覽測試中斷', false, String(e && e.stack || e)); }
finally { if (c2) c2.close(); if (srv2) srv2.kill(); }

trace("進入 六：覆審修正（後台與監察台）");
/* ---------- 六：覆審修正（後台與監察台） ---------- */
let srv4 = null;
const BASE4 = `http://127.0.0.1:${PORT + 4}`, DATA4 = path.join(OUT, 'data-fix5');
const get4 = async p => (await tfetch(BASE4 + p)).json();
const post4 = async (p, body) => { const r = await tfetch(BASE4 + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE4 }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
const seen4 = async () => new Set((await get4('/api/status')).runs.map(r => r.id));
async function newRun4(before, pred, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { const r = (await get4('/api/status')).runs.find(x => !before.has(x.id) && pred(x) && x.state !== 'running'); if (r) return r; await sleep(400); } return null; }
const J4 = (...p) => JSON.parse(fs.readFileSync(path.join(DATA4, ...p), 'utf8'));
try {
  fs.mkdirSync(path.join(DATA4, 'company'), { recursive: true });
  fs.writeFileSync(path.join(DATA4, 'company', 'page.json'), JSON.stringify(loadFixture('goal-dates-repro-structured.js'), null, 2));
  srv4 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 4)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA4, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await usePass(BASE4);
  for (let i = 0; i < 60; i++) { try { if ((await get4('/api/status')).ok) break; } catch { } await sleep(300); }
  ok('六：假 AI 認證（後台）', (await certify(BASE4)).certify.state === 'passed');
  const pg4 = J4('company', 'page.json'), g1d = pg4.glance.rows.find(r => r.plan === 'G1').due;
  const ord = pg4.path.milestones.map(m => m.id);
  const confirmWith = async (value, kindsDone) => {
    const machine = { format: 'startup-os.proofread-reply/0.1', page: pg4.page.id, company: pg4.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: ord, orderProposed: ord, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [{ id: g1d.id, plan: 'G1.endsOn', label: '目前目標期限', ai: g1d.value, founder: value, value }], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: {}, kindsChanged: [] };
    const head = ['kind: proofread', 'ref: ' + pg4.page.id, 'option: confirm-with-edits', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(J4('company', 'page.json'))), 'batch: false', 'shownAt: ' + lib.localIso()];
    const b = await seen4();
    await post4('/api/submit', { kind: 'proofread', ref: pg4.page.id, text: head.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine) + '\n```\n' });
    return newRun4(b, x => x.kind === 'proofread');
  };
  // 六-2：不存在的日子不收窄
  const r1 = await confirmWith('2026-02-30');
  const untils = Object.entries(J4('ledger', 'state.json').intake.answers).filter(([, a]) => a && a.tentative).map(([p, a]) => a.tentative.until);
  ok('六-2：目前目標期限為不存在的日子：確認時不收窄暫定覆核日', r1 && r1.state === 'done' && untils.length >= 2 && untils.every(u => u === '2026-12-04'), untils);
  // 六-7：每月覆核改寫目標後（只有文字、沒有期限），監察台仍用已確認的目標期限
  const r2 = await confirmWith('2026-11-27');
  ok('六-7：以有效日子再確認', r2 && r2.state === 'done');
  const stp = path.join(DATA4, 'ledger', 'state.json'), st4 = J4('ledger', 'state.json');
  st4.goals = { ...(st4.goals || {}), quarter: { text: '每月覆核後的目標（只有文字）', setAt: '2026-11-06', by: 'founder' } };
  fs.writeFileSync(stp, JSON.stringify(st4, null, 2));
  const dash = await get4('/api/dashboard');
  const quarters = []; (function w(o, k) { if (Array.isArray(o)) return o.forEach(x => w(x, k)); if (!o || typeof o !== 'object') return; if (k === 'quarter' && 'endsOn' in o) quarters.push(o); for (const kk in o) w(o[kk], kk); })(dash);
  ok('六-7：監察台的季度目標保留每月覆核的文字，期限回落到已確認的 2026-11-27', quarters.length >= 1 && quarters.every(q => q.text === '每月覆核後的目標（只有文字）' && q.endsOn === '2026-11-27'), quarters);
} catch (e) { ok('覆審修正後台測試中斷', false, String(e && e.stack || e)); }
finally { if (srv4) srv4.kill(); }

trace("進入 七：確認或送出之後指向真正的下一步（伺服器、假 AI、真實點");
/* ---------- 七：確認或送出之後指向真正的下一步（伺服器、假 AI、真實點擊；全部虛構資料） ----------
   公司概覽確認並交 Zero 後：大掣改為「前往待你處理（N 項）」或「回到 Founder Desk」（頂部大掣與底部列一致）；
   只有確認後又作修改才是「再確認一次」；伺服器已確認但瀏覽器沒有紀錄也不再出現「確認並開始」；完成卡有「你的下一步」。
   問題頁全部作答、要求頁完成後同樣有下一步。 */
let srv7 = null, c7 = null;
const BASE7 = `http://127.0.0.1:${PORT + 5}`, DATA7 = path.join(OUT, 'data-next-step');
const get7 = async p => (await tfetch(BASE7 + p)).json();
const status7 = () => get7('/api/status');
const asksDir7 = path.join(DATA7, 'asks');
const clearAsks7 = () => { try { for (const f of fs.readdirSync(asksDir7)) if (f.endsWith('.json')) fs.rmSync(path.join(asksDir7, f), { force: true }); } catch { } };
let packSeq7 = 0;
function pack7(questions = 2) {
  const id = 'ns' + (++packSeq7), f = path.join(OUT, id + '.json');
  fs.writeFileSync(f, JSON.stringify({ format: 'startup-os.ask/0.1', title: '虛構待決事項 ' + id, context: '測試用。', afterConfirm: '回答後，Zero 會繼續準備。', questions: Array.from({ length: questions }, (_, i) => ({ id: id + '-q' + (i + 1), priority: i + 1, ask: '虛構問題 ' + id + ' 第 ' + (i + 1) + ' 條？', kind: 'text', value: '先按建議', why: '測試用。' })) }));
  // SOS_PORT 指向本測試的伺服器（PORT+5）：ask.mjs 找得到它，不會在創辦人日常用的 4380–4389 另開伺服器
  const r = spawnSync(process.execPath, [path.join(PROTO, 'ask.mjs'), f, '--no-open'], { cwd: PROTO, encoding: 'utf8', env: { ...process.env, SOS_DATA: DATA7, SOS_PORT: String(PORT + 5) } });
  return r.status === 0;
}
const until7 = async (fn, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; };
try {
  fs.mkdirSync(path.join(DATA7, 'company'), { recursive: true });
  fs.writeFileSync(path.join(DATA7, 'company', 'page.json'), JSON.stringify(loadFixture('goal-dates-repro-structured.js'), null, 2));
  srv7 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 5)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA7, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await usePass(BASE7);
  for (let i = 0; i < 60; i++) { try { if ((await status7()).ok) break; } catch { } await sleep(300); }
  ok('七：假 AI 認證', (await certify(BASE7)).certify.state === 'passed');
  c7 = await openChrome(CHROME, path.join(OUT, 'profile7'), PORT + 6);
  await usePass(BASE7, c7);
  const { ev: e7, go: g7, click: k7 } = c7;
  const PAGE7 = BASE7 + '/proofread.html';
  const main7 = () => e7(`(()=>{const e=document.querySelector('#go-main');return e?{tag:e.tagName,text:e.textContent.trim(),href:e.getAttribute('href')}:null})()`);
  const bar7 = () => e7(`(()=>{const e=document.querySelector('#cbar .btn.primary.big');return e?{tag:e.tagName,text:e.textContent.trim(),href:e.getAttribute('href')}:null})()`);
  const trackText7 = () => e7(`document.querySelector('#track')?.innerText||''`);
  const doneTrack7 = () => until7(async () => /✓ 完成|未完成/.test(await trackText7()));
  const okLbl = async t => t === wantLabel((await status7()).openAsks);
  const wantLabel = n => n > 0 ? N.t('goPending', { n }) : N.ui.backDesk;
  const goalQ7 = '#dq-goal-quarter .opt:not(.cur)';
  async function pickGoal() {
    await e7(`(()=>{const o=document.querySelector(${JSON.stringify(goalQ7)});if(o)o.setAttribute('data-pick','1')})()`);
    await k7('[data-pick="1"]'); await e7(`document.querySelectorAll('[data-pick]').forEach(e=>e.removeAttribute('data-pick'))`);
  }
  // 1) 未確認：大掣是按鈕「確認並開始」一類，不是連結
  await g7(PAGE7, 1440, 1500); await e7('localStorage.clear()'); await g7(PAGE7, 1440, 2200);
  const m0 = await main7();
  ok('七-1：未確認時大掣是按鈕（採用／確認並開始），不是連結', m0 && m0.tag === 'BUTTON' && m0.text !== '再確認一次' && !/前往待決事項|回到待決事項/.test(m0.text), m0);
  const txt7 = sel => e7(`document.querySelector(${JSON.stringify(sel)})?.innerText||''`);
  ok('七-1：未確認前：頁內作答區改名「請你先決定的 N 件事（已答 x／N）」，不再叫「待決事項」；底部列同樣改名', /^請你先決定的 \d+ 件事（已答 0／\d+）$/.test((await txt7('.decide .layer-title')).trim()) && /^請你先決定：已答 0／\d+$/.test((await txt7('#cbar .prog-n')).trim()) && !(await txt7('.decide .layer-title')).includes('待決事項') && !(await txt7('#cbar .prog-n')).includes('待決事項'), { t: await txt7('.decide .layer-title'), b: await txt7('#cbar .prog-n') });
  ok('七-1：未確認前：大卡仍是原本的說明，且有「逐題作答」', (await txt7('.hero-t')).includes('Zero 已整理好你的公司概覽') && (await txt7('.hero-act')).includes(N.ui.oneByOne), await txt7('.hero'));
  // 2) 首次確認並交 Zero（Zero 會新開問題）
  await k7('#go-main'); await k7('#do-confirm');
  ok('七-2：首次確認：交 Zero 處理完成', !!(await doneTrack7()), (await trackText7()).slice(0, 200));
  const st1 = await status7();
  const asksFirst = await e7(`document.querySelectorAll('#track .asks-next a').length`);
  ok('七-2：Zero 新開了問題時，完成卡仍是原本的「前往作答」按鈕，不重複加 Founder Desk 按鈕', st1.openAsks > 0 ? (asksFirst > 0 && (await e7(`!document.querySelector('#track #next-desk')`))) : true, { openAsks: st1.openAsks, asksFirst });
  // 3) 改成剛好 3 項待你處理，再作一個不影響下一個對外動作的修改並再確認
  clearAsks7(); for (let i = 0; i < 3; i++) pack7();
  await sleep(1200);
  ok('七-3：預備 3 項待你處理', (await status7()).openAsks >= 3, (await status7()).openAsks);
  await g7(PAGE7, 1440, 2200);
  const m1 = await main7();
  ok('七-3：確認後之後沒有再修改，重新打開頁面：大掣是連結「前往待你處理（3 項）」到 Founder Desk 首頁', m1 && m1.tag === 'A' && (await okLbl(m1.text)) && /\/#\/$/.test(m1.href || '') , m1);
  const b1 = await bar7();
  ok('七-3：底部列與頂部大掣一致（連結、同一用字）', b1 && b1.tag === 'A' && (await okLbl(b1.text)) && b1.href === m1.href, b1);
  ok('七-3：頂部不同時出現兩個大的主要按鈕', (await e7(`document.querySelectorAll('.hero .btn.primary').length`)) === 1);
  ok('七-3：確認後沒有「再確認一次」及「確認並開始」', !/再確認一次|確認並開始/.test(String((await main7()).text) + String((await bar7()).text)));
  const heroT = (await txt7('.hero-t')).trim(), heroP = (await txt7('.hero-p')).trim();
  ok('七-3：已確認並交 Zero 後，大卡反映現況：標題「你已確認公司概覽」及修改說明，沒有「逐題作答」、「Zero 將隨即」', heroT === N.ui.companyHeroDone && heroP === N.ui.companyHeroDoneNote && !(await txt7('.hero')).includes('逐題作答') && !(await txt7('.hero')).includes('先請你看') && !(await txt7('.hero')).includes('Zero 將隨即'), { heroT, heroP });
  const decT = (await txt7('.decide .layer-title')).trim();
  ok('七-3：已確認後，作答區標題不再寫「已答 x／N」，底部列寫「已確認（未作答的已按 Zero 建議）」，沒有「下一題」', /^請你先決定的 \d+ 件事（已確認）$/.test(decT) && (await txt7('#cbar .prog-n')).trim() === N.ui.barConfirmed && (await e7(`!document.querySelector('#cbar .btn.small')`)), { decT, bar: await txt7('#cbar') });
  ok('七-3：作答區及導航不同名：作答區標題、底部列、大卡都不含「待決事項」「Founder Desk」', !/待決事項|Founder Desk/.test(decT + (await txt7('#cbar .prog-n')) + heroT + heroP), { decT });
  await pickGoal();
  const m2 = await main7();
  ok('七-4：確認後又作修改：大掣才變「再確認一次」（按鈕），並有原本的提示', m2 && m2.tag === 'BUTTON' && m2.text === '再確認一次' && (await e7(`document.body.innerText.includes('你在確認後再作了修改')`)), m2);
  ok('七-4：確認後又作修改：大卡及底部列回到未確認時的說明', (await txt7('.hero-t')).includes('Zero 已整理好你的公司概覽') && /^請你先決定：已答 \d+／\d+$/.test((await txt7('#cbar .prog-n')).trim()), { h: await txt7('.hero-t'), b: await txt7('#cbar .prog-n') });
  await g7(PAGE7, 1440, 2200);
  const m2b = await main7();
  ok('七-4：重新載入頁面，確認後的修改仍記得（仍是「再確認一次」，不被當作已交 Zero）', m2b && m2b.tag === 'BUTTON' && m2b.text === '再確認一次', m2b);
  await k7('#go-main'); await k7('#do-confirm');
  ok('七-5：再確認完成（改動不影響下一個對外動作）', !!(await doneTrack7()) && (await trackText7()).includes(N.ui.aiNextSkip.slice(0, 12)), (await trackText7()).slice(0, 250));
  { const t5 = await trackText7(); const skip = N.ui.aiNextSkip; ok('七-5：「改動不影響下一個對外動作」一句只出現一次（結果摘要與最後一步相同時不重複）', t5.split(skip).length === 2, { count: t5.split(skip).length - 1, t5: t5.slice(0, 400) });
  ok('七-5：完成卡的按鈕維持次要樣式；整個畫面只有一個最顯眼的主要按鈕（頂部大掣）', (await e7(`document.querySelectorAll('#track .btn.primary').length`)) === 0 && (await e7(`document.querySelectorAll('.hero .btn.primary').length`)) === 1, await e7(`document.querySelectorAll('#track .btn.primary').length`));
  ok('七-5：完成卡與大掣的用字與導航一致，沒有「Founder Desk」', !/Founder Desk/.test(t5 + (await txt7('.hero')) + (await txt7('#cbar'))), t5.slice(-200)); }
  const n5 = (await status7()).openAsks;
  const nextWords = await e7(`(()=>{const n=document.querySelector('#track .next-step');return n?{h:n.querySelector('h4')?.textContent,line:n.querySelector('p')?.textContent,btn:n.querySelector('a')?.textContent,href:n.querySelector('a')?.getAttribute('href'),last:n===document.querySelector('#track .tr-result').lastElementChild}:null})()`);
  ok('七-5：完成卡最後有「你的下一步」：Founder Desk 有 3 項待你處理，附按鈕', nextWords && nextWords.h === N.ui.yourNext && nextWords.line === N.t('deskHasPending', { n: n5 }) && nextWords.btn === wantLabel(n5) && /\/#\/$/.test(nextWords.href) && nextWords.last, nextWords);
  const m3 = await main7();
  ok('七-5：確認送出後，大掣即時變成連結「前往待你處理（3 項）」', m3 && m3.tag === 'A' && m3.text === wantLabel(n5), m3);
  await e7('window.scrollTo(0,0)');
  // 4) 待處理數目改變，大掣自動跟著更新（頁面輪詢）；沒有待處理時改為「回到 Founder Desk」
  clearAsks7(); await sleep(500);
  const live = await until7(async () => { const x = await main7(); return x && x.tag === 'A' && x.text === wantLabel(0) ? x : null; }, 25000);
  ok('七-6：待你處理的事項清零後，大掣自動變「回到 Founder Desk」（連結）', !!live, await main7());
  const nb = await e7(`(()=>{const n=document.querySelector('#track .next-step');return n?{line:n.querySelector('p')?.textContent,btn:n.querySelector('a')?.textContent}:null})()`);
  ok('七-6：完成卡寫「目前沒有待你處理的事項」，附「回到 Founder Desk」', nb && nb.line === N.ui.deskNoPending && nb.btn === N.ui.backDesk, nb);
  ok('七-6：底部列同步', ((await bar7()) || {}).text === wantLabel(0) && ((await bar7()) || {}).tag === 'A', await bar7());
  // 5) 伺服器已確認、瀏覽器沒有紀錄（清了瀏覽器資料／換瀏覽器）：不出現「確認並開始」，直接指向下一步
  pack7(); pack7(); await sleep(1000);
  await g7(PAGE7, 1440, 1500); await e7('localStorage.clear()'); await g7(PAGE7, 1440, 2500);
  const m4 = await main7(), b4 = await bar7();
  ok('七-7：伺服器顯示已確認、瀏覽器沒有紀錄：大掣是「前往待你處理（2 項）」連結，不是「確認並開始」', m4 && m4.tag === 'A' && (await okLbl(m4.text)) && b4 && b4.tag === 'A' && (await okLbl(b4.text)), { m4, b4 });
  ok('七-7：這時 /api/status 的確認資料來自伺服器（confirmed、confirmedPageId 與目前頁面編號相同）', await (async () => { const s = (await status7()).company; return s.confirmed && s.confirmedPageId && s.confirmedPageId === s.pageId; })(), (await status7()).company);
  await pickGoal();
  const m5 = await main7();
  ok('七-7：這時再作修改，大掣變「再確認一次」', m5 && m5.tag === 'BUTTON' && m5.text === '再確認一次', m5);
  await g7(PAGE7, 1440, 1500); await e7('localStorage.clear()'); await g7(PAGE7, 1440, 2000);
  await k7('#go-main');
  ok('七-8：點大掣直接前往 Founder Desk 首頁（#/）', await until7(async () => (await e7('location.pathname')) === '/' && (await e7('location.hash')) === '#/', 10000), await e7('location.href'));
  // 6) 問題頁：全部作答後，完成卡有下一步（待處理數目取自同一個資料）
  clearAsks7(); pack7(); pack7(); pack7(); await sleep(1000);
  const asks7 = await get7('/api/asks'), pid = asks7.packs[0].id;
  await g7(BASE7 + '/#/ask/' + pid, 1440, 2500);
  await k7('#go-main'); await k7('#do-confirm');
  ok('七-9：問題頁送出完成', !!(await until7(async () => /✓ 完成/.test(await e7(`document.querySelector('#track')?.innerText||''`)))), await e7(`document.querySelector('#track')?.innerText||''`));
  const askNext = await e7(`(()=>{const n=document.querySelector('#track .next-step');return n?{h:n.querySelector('h4')?.textContent,line:n.querySelector('p')?.textContent,btn:n.querySelector('a')?.textContent,cls:n.querySelector('a')?.className,href:n.querySelector('a')?.getAttribute('href')}:null})()`);
  ok('七-9：問題包全部作答後，完成卡有「你的下一步」及指向 Founder Desk 的主按鈕（2 項待你處理）', askNext && askNext.h === N.ui.yourNext && askNext.line === N.t('deskHasPending', { n: (await status7()).openAsks }) && (await okLbl(askNext.btn)) && /primary/.test(askNext.cls) && /\/#\/$/.test(askNext.href), askNext);
  // 7) 首頁「告訴 Zero 一件事」（0.40.0 取代三個交要求頁）：送出後有可見的下一步（已收到＋查看回饋），回饋卡出現作答入口，並可回到首頁
  clearAsks7(); await sleep(500);
  await g7(BASE7 + '/#/', 1440, 2500);
  await k7('#quick-adhoc');
  await e7(`(()=>{const t=document.querySelector('#quick-text');t.focus();})()`);
  await c7.type('#quick-text', '請擬一張虛構的推廣單張（測試）');
  await k7('#quick-send');
  const reqDone = await until7(async () => (await e7(`document.querySelector('#quick-note')?.innerText||''`)).includes('已收到') && (await e7(`!!document.querySelector('#quick-track')`)), 30000);
  ok('七-10：送出後有可見的下一步：已收到，並有「查看回饋」連結', !!reqDone, await e7(`document.querySelector('#quick-note')?.innerText||''`));
  await k7('#quick-track');
  const reqAnswer = await until7(async () => (await e7(`!!document.querySelector('#fb-card #fb-answer')`)), 90000);
  const reqState = await e7(`({answer:!!document.querySelector('#fb-answer'),back:document.querySelector('#fb-back')?.getAttribute('href')||'',state:document.querySelector('#fb-card')?.dataset.state||'',text:(document.querySelector('#fb-card')?.innerText||'').slice(0,300)})`);
  ok('七-10：回饋卡完成讀取後有作答入口，並有回到首頁的按鈕', !!reqAnswer && reqState.back === '#/', reqState);
  ok('七-11：頁面沒有錯誤', c7.errors.length === 0, c7.errors);
} catch (e) { ok('確認後的下一步測試中斷', false, String(e && e.stack || e)); }
finally { if (c7) c7.close(); if (srv7) srv7.kill(); }

trace("進入 八：第八輪覆核修正（已交付判斷、確認後修改標記、輪詢重畫、待");
/* ---------- 八：第八輪覆核修正（已交付判斷、確認後修改標記、輪詢重畫、待決事項零值文字）----------
   「已交付」以內容比較為準：頁面以目前有效內容（含自動調整後的日期）、次序、真事／工作類別算摘要值，
   與伺服器 /api/status 回傳的最近一次確認摘要值（company.confirmedDigest）比較；第十輪起完全不用 changedAfter 旗標。 */
let srv8 = null, c8 = null;
const BASE8 = `http://127.0.0.1:${PORT + 7}`, DATA8 = path.join(OUT, 'data-r8');
const get8 = async p => (await tfetch(BASE8 + p)).json();
const status8 = () => get8('/api/status');
const until8 = async (fn, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; };
try {
  fs.mkdirSync(path.join(DATA8, 'company'), { recursive: true });
  fs.writeFileSync(path.join(DATA8, 'company', 'page.json'), JSON.stringify(loadFixture('goal-dates-repro-structured.js'), null, 2));
  srv8 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 7)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA8, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await usePass(BASE8);
  for (let i = 0; i < 60; i++) { try { if ((await status8()).ok) break; } catch { } await sleep(300); }
  ok('八：假 AI 認證', (await certify(BASE8)).certify.state === 'passed');
  c8 = await openChrome(CHROME, path.join(OUT, 'profile8'), PORT + 8);
  await usePass(BASE8, c8);
  const { ev: e8, go: g8, click: k8 } = c8;
  const PAGE8 = BASE8 + '/proofread.html';
  const main8 = () => e8(`(()=>{const e=document.querySelector('#go-main');return e?{tag:e.tagName,text:e.textContent.trim()}:null})()`);
  const trackText8 = () => e8(`document.querySelector('#track')?.innerText||''`);
  const done8 = () => until8(async () => /✓ 完成|未完成/.test(await trackText8()));
  const isLink = m => !!m && m.tag === 'A';
  const isReconfirm = m => !!m && m.tag === 'BUTTON' && m.text === '再確認一次';
  const dGet = async () => JSON.parse(await e8(`localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0])`));
  const dSet = o => e8(`localStorage.setItem(Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0], ${JSON.stringify('')}+${JSON.stringify(JSON.stringify(o))})`);
  const load8 = async (w = 2600) => { await g8(PAGE8, 1440, w); };
  const openRest8 = async () => {
    if (!(await e8(`!!document.querySelector('#layer2')`))) { await k8('#rest-toggle'); await sleep(300); }
    if (!(await e8(`!!document.querySelector('[data-mid]')`))) { await k8('#layer2 .layer-toggle'); await sleep(300); }
  };
  const orderDom8 = () => e8(`[...document.querySelectorAll('[data-mid]')].map(x=>x.dataset.mid).join()`);
  const keyPress8 = async (key, vk) => { await c8.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: vk }); await c8.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk }); await sleep(500); };
  const moveByKey8 = async (mid, dir) => { await e8(`document.querySelector('[data-h="${mid}"]').focus()`); await keyPress8(dir < 0 ? 'ArrowUp' : 'ArrowDown', dir < 0 ? 38 : 40); };
  const confirmNow8 = async () => { await k8('#go-main'); await k8('#do-confirm'); return done8(); };
  const pickGoal8 = async () => { await e8(`(()=>{const o=document.querySelector('#dq-goal-quarter .opt:not(.cur)');if(o)o.setAttribute('data-pick','1')})()`); await k8('[data-pick="1"]'); await e8(`document.querySelectorAll('[data-pick]').forEach(e=>e.removeAttribute('data-pick'))`); };

  // 1) 首次確認：先改一個答案、一站類別、一個次序，之後送出
  await g8(PAGE8, 1440, 1500); await e8('localStorage.clear()'); await load8();
  await pickGoal8();
  await openRest8();
  await k8('[data-kind="m1"]');
  await moveByKey8('m3', -1);
  ok('八-0：首次確認前先改了答案、一站類別及次序', (await orderDom8()).startsWith('m1,m3,m2') && (await dGet()).kinds.m1, [await orderDom8(), (await dGet()).kinds]);
  ok('八-0：首次確認完成', !!(await confirmNow8()), (await trackText8()).slice(0, 200));
  const st0 = await status8();
  ok('八-0：/api/status 帶最近一次確認的摘要值（八位十六進位），不含機密內容', /^[0-9a-f]{8}$/.test(String(st0.company.confirmedDigest || '')), st0.company);
  ok('八-0：確認並送出後，大掣是連結（已交付）', isLink(await main8()), await main8());
  const BASE_DRAFT = await dGet();
  // 每個情況之間，把草稿還原成「剛確認並送出」的樣子（伺服器上的確認內容不變），各情況互不影響
  const resetDelivered8 = async () => { await load8(); await dSet(BASE_DRAFT); await load8(); };

  // 2) 第 1 點：確認後切換一站「真事／工作」類別，要出現「再確認一次」，重開頁面仍然
  await openRest8(); await k8('[data-kind="m2"]');
  ok('八-1：確認後切換一站類別：大掣變「再確認一次」', isReconfirm(await main8()), await main8());
  // 第十輪起「確認後修改」只按內容比較，草稿不再有 changedAfter 旗標：草稿只帶切換後的類別，頁面由內容與已確認內容不同而判斷
  ok('八-1：草稿帶著切換後的類別（不再有 changedAfter 旗標）', (await dGet()).changedAfter === undefined && JSON.stringify((await dGet()).kinds) !== JSON.stringify(BASE_DRAFT.kinds), [await dGet(), BASE_DRAFT.kinds]);
  await load8();
  ok('八-1：重開頁面仍是「再確認一次」，並提示確認後作了修改', isReconfirm(await main8()) && (await e8(`document.body.innerText.includes('你在確認後再作了修改')`)), await main8());
  await resetDelivered8();
  ok('八-1：還原到已確認並送出的草稿後，回到已交付（連結）', isLink(await main8()), await main8());

  // 3) 第 2 點：確認後重排路線（鍵盤），立即重開頁面
  await load8(); await openRest8();
  await moveByKey8('m5', -1);
  ok('八-2：確認後用鍵盤重排：大掣變「再確認一次」', isReconfirm(await main8()), await main8());
  await load8();
  ok('八-2：立即重開頁面：新次序仍在，且不被當成已交付（仍是「再確認一次」）', isReconfirm(await main8()), await main8());
  ok('八-2：草稿帶著新次序（不再有 changedAfter 旗標）', (await dGet()).changedAfter === undefined && (await dGet()).order.join() !== BASE_DRAFT.order.join(), [(await dGet()).order, BASE_DRAFT.order]);
  await resetDelivered8();
  ok('八-2：還原到已確認並送出的草稿後，回到已交付（連結）', isLink(await main8()), await main8());
  // 真實滑鼠拖動
  await load8(); await openRest8();
  const before8 = await orderDom8();
  const hr = await e8(`(()=>{const r=document.querySelector('[data-h="m4"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await e8(`document.querySelector('[data-h="m4"]').scrollIntoView({block:'center'})`); await sleep(200);
  const hr2 = await e8(`(()=>{const r=document.querySelector('[data-h="m4"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await c8.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hr2.x, y: hr2.y });
  await c8.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hr2.x, y: hr2.y, button: 'left', buttons: 1, clickCount: 1 });
  const ty8 = await e8(`(()=>{const li=document.querySelector('[data-mid="m4"]').previousElementSibling;const r=li.getBoundingClientRect();return r.top+r.height/2-40})()`);
  for (let i = 1; i <= 20; i++) { await c8.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hr2.x, y: hr2.y + (ty8 - hr2.y) * i / 20, button: 'left', buttons: 1 }); await sleep(30); }
  await c8.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hr2.x, y: ty8, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(600);
  const afterDrag = await orderDom8();
  ok('八-2：真實滑鼠拖動確實改變了次序', afterDrag !== before8, [before8, afterDrag]);
  ok('八-2：拖動重排後：大掣變「再確認一次」，草稿帶著新次序', isReconfirm(await main8()) && (await dGet()).changedAfter === undefined && (await dGet()).order.join() !== BASE_DRAFT.order.join(), [await main8(), (await dGet()).order]);
  await load8();
  ok('八-2：拖動後立即重開頁面：仍是「再確認一次」', isReconfirm(await main8()), await main8());
  await resetDelivered8();
  const DELIVERED = BASE_DRAFT;

  // 4) 第 3 點 (a)：沒有 changedAfter 旗標的草稿，只要有未送出的修改（內容、次序、類別）就不可當成已交付
  const mut = async (label, fn) => {
    const d = JSON.parse(JSON.stringify(DELIVERED)); delete d.changedAfter; fn(d);
    await load8(); await dSet(d); await load8();
    const m = await main8();
    ok('八-3a：沒有 changedAfter 旗標、' + label + '：不當成已交付（「再確認一次」）', isReconfirm(m), m);
  };
  await mut('有未送出的內容修改', d => { d.edits = { ...d.edits, 'next-action': '虛構的另一個下一步' }; });
  await mut('有未送出的次序修改', d => { d.order = d.order.slice().reverse(); });
  await mut('有未送出的類別修改', d => { d.kinds = { ...d.kinds, m4: d.kinds.m4 === 'task' ? 'real' : 'task' }; });
  // 3) (b)：0.39.0 舊草稿（已確認並送出，其後沒有再改，沒有 changedAfter、沒有內容摘要）升級後不可被迫再確認
  { const d = JSON.parse(JSON.stringify(DELIVERED)); delete d.changedAfter; delete d.confirmed.digest;
    await load8(); await dSet(d); await load8();
    const m = await main8(), bar = await e8(`document.querySelector('#cbar .btn.primary.big')?.tagName||null`);
    ok('八-3b：0.39.0 舊草稿（confirmed.sent:true，有已送出的修改，沒有 changedAfter／摘要），伺服器確認內容相同：大掣是連結，不要求再確認', isLink(m) && bar === 'A' && Object.keys(d.edits).length >= 1, { m, bar, edits: Object.keys(d.edits) });
    ok('八-3b：升級後草稿鑰匙及內容不變', (await e8(`Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:')).length`)) === 1, await e8(`Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))`)); }
  // 3) (c)：換了瀏覽器或清了瀏覽器資料
  await load8(); await e8('localStorage.clear()'); await load8();
  ok('八-3c：清了瀏覽器資料：伺服器已確認，大掣是連結（已交付）', isLink(await main8()), await main8());
  await pickGoal8();
  ok('八-3c：這時再作修改：大掣變「再確認一次」', isReconfirm(await main8()), await main8());
  await load8();
  // 7) 離線下載紀錄、其後伺服器已確認同一內容
  { const d = JSON.parse(JSON.stringify(DELIVERED)); delete d.changedAfter; d.confirmed = { at: '2026 年 11 月 7 日 10:00', name: 'offline-copy.md' }; d.sent = null;
    await load8(); await dSet(d); await load8();
    ok('八-7：本機只有離線下載紀錄，伺服器其後已確認同一內容：大掣是連結（已交付）', isLink(await main8()), await main8());
    ok('八-7：不再出現「只下載了回覆檔」的未送達提示', !(await e8(`document.body.innerText.includes('只下載了回覆檔')`))); }
  { const d = JSON.parse(JSON.stringify(DELIVERED)); delete d.changedAfter; d.confirmed = { at: '2026 年 11 月 7 日 10:00', name: 'offline-copy.md' }; d.sent = null; d.edits = { ...d.edits, 'next-action': '離線後又改過的下一步' };
    await load8(); await dSet(d); await load8();
    ok('八-7：離線下載後又有不同於伺服器確認的修改：不當成已交付', isReconfirm(await main8()), await main8()); }
  // 8) 套用確認失敗：輪詢改變已交付狀態時，大卡、作答區標題、底部列、按鈕一併重畫
  //    （第十一輪：套用失敗「而伺服器仍是別的確認」才算未交付；伺服器已有相同內容則算已交付，見十一-1。所以這裏的假狀態同時把伺服器快照的摘要改成不同的值）
  await load8(); await dSet(DELIVERED); await load8();
  ok('八-8：開始前：已交付，大卡寫已確認', isLink(await main8()) && (await e8(`document.querySelector('.hero-t')?.innerText||''`)).trim() === N.ui.companyHeroDone, await e8(`document.querySelector('.hero-t')?.innerText||''`));
  const sentName = DELIVERED.sent && DELIVERED.sent.name;
  await e8(`(()=>{const orig=window.fetch;window.fetch=function(u){return orig.apply(this,arguments).then(r=>{if(String(u).includes('/api/status')){return r.clone().json().then(j=>{j.runs=[{id:'r-fail-8',kind:'proofread',state:'failed',ref:'x',replyFiles:[${JSON.stringify(sentName)}],steps:[{key:'applied',label:'套用確認',state:'failed',detail:'版本不符'}],error:'你確認時所見的版本已經更改，請重新開啟頁面再確認',startedAt:new Date().toISOString()}].concat(j.runs||[]);if(j.company&&j.company.confirmedSnapshot)j.company.confirmedSnapshot=Object.assign({},j.company.confirmedSnapshot,{digest:'00000000'});return new Response(JSON.stringify(j),{status:200,headers:{'Content-Type':'application/json'}})}).catch(()=>r)}return r})}})()`);
  const changed8 = await until8(async () => { const m = await main8(); return m && m.tag === 'BUTTON' ? m : null; }, 25000);
  ok('八-8：輪詢發現套用失敗：按鈕改為「再確認一次」', !!changed8 && changed8.text === '再確認一次', changed8);
  const heroT8 = (await e8(`document.querySelector('.hero-t')?.innerText||''`)).trim(), decT8 = (await e8(`document.querySelector('.decide .layer-title')?.innerText||''`)).trim(), barN8 = (await e8(`document.querySelector('#cbar .prog-n')?.innerText||''`)).trim();
  ok('八-8：大卡不再寫「你已確認公司概覽」', heroT8 !== N.ui.companyHeroDone && heroT8.includes('Zero 已整理好你的公司概覽'), heroT8);
  ok('八-8：作答區標題及底部列也回到未確認時的說法', !/（已確認）$/.test(decT8) && barN8 !== N.ui.barConfirmed, { decT8, barN8 });
  // 9) 待決事項零值文字
  const zero = await e8(`(()=>{const s=window.SOS_DESK.nextStep(0);return {line:s.line,button:s.button}})()`);
  ok('九：待處理為零時，下一步文字不聲稱「全部處理」，只說目前沒有待作答的問題', zero.line === N.ui.deskNoPending && N.ui.deskNoPending === '目前沒有待作答的問題' && !/全部處理/.test(zero.line), zero);
  ok('八：頁面沒有錯誤', c8.errors.length === 0, c8.errors);
} catch (e) { ok('第八輪頁面測試中斷', false, String(e && e.stack || e)); }
finally { if (c8) c8.close(); if (srv8) srv8.kill(); }

trace("進入 八-4：開局答案欄只選一個（頁面承諾的每週覆核與後台一致）-");
/* ---------- 八-4：開局答案欄只選一個（頁面承諾的每週覆核與後台一致）---------- */
let srv9 = null, c9 = null;
const BASE9 = `http://127.0.0.1:${PORT + 9}`, DATA9 = path.join(OUT, 'data-r8-g6');
const get9 = async p => (await tfetch(BASE9 + p)).json();
const post9 = async (p, body) => { const r = await tfetch(BASE9 + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE9 }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { } return { code: r.status, j }; };
try {
  const pg = JSON.parse(JSON.stringify(loadFixture('goal-dates-repro-structured.js')));
  // 概覽有一個暫定的 G6（負責人）；各站負責人也用 plan:G6，其中第一站暫定、最後一站已確認
  pg.glance.rows.push({ id: 'g6', plan: 'G6', label: '已有人負責的事', kind: 'text', value: '送貨：表哥（已確定）', origin: 'ai', tentative: { by: 'ai', until: '2026-12-04', test: '12 月 4 日再問你' } });
  pg.path.milestones[0].owner.tentative = { by: 'ai', until: '2026-12-04', test: '見面時問清楚' };
  fs.mkdirSync(path.join(DATA9, 'company'), { recursive: true });
  fs.writeFileSync(path.join(DATA9, 'company', 'page.json'), JSON.stringify(pg, null, 2));
  srv9 = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT + 9)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA9, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  await usePass(BASE9);
  for (let i = 0; i < 60; i++) { try { if ((await get9('/api/status')).ok) break; } catch { } await sleep(300); }
  ok('八-4：假 AI 認證', (await certify(BASE9)).certify.state === 'passed');
  // 後台：確認後，開局答案 G6 取概覽的欄（暫定、有覆核日），不被最後一站負責人覆蓋
  const order9 = pg.path.milestones.map(m => m.id);
  const machine9 = { format: 'startup-os.proofread-reply/0.1', page: pg.page.id, company: pg.company.name, confirmedAt: lib.localIso(), confirm: ['intake', 'order'], order: order9, orderProposed: order9, orderChanged: false, nextActionMilestone: 'm1', decided: [], edits: [], keptAsAI: [], tentativeKept: [], stillMissing: [], note: '', kinds: {}, kindsChanged: [] };
  const head9 = ['kind: proofread', 'ref: ' + pg.page.id, 'option: confirm', 'rev: 1', 'hash: ' + lib.fnv(JSON.stringify(pg)), 'batch: false', 'shownAt: ' + lib.localIso()];
  const sent9 = await post9('/api/submit', { kind: 'proofread', ref: pg.page.id, text: head9.join('\n') + '\n\n# 確認\n\n```json\n' + JSON.stringify(machine9) + '\n```\n' });
  ok('八-4：確認回覆被接受', sent9.code === 200 && sent9.j && sent9.j.ok, sent9);
  const ran9 = await until8(async () => { const s = (await get9('/api/status')).runs.find(r => r.kind === 'proofread' && r.state !== 'running'); return s || null; });
  ok('八-4：確認完成', ran9 && ran9.state === 'done', ran9 && ran9.error);
  const ans9 = JSON.parse(fs.readFileSync(path.join(DATA9, 'ledger', 'state.json'), 'utf8')).intake.answers;
  ok('八-4：開局答案 G6 取概覽的欄（值及暫定覆核日），不是最後一站的負責人', ans9.G6 && ans9.G6.value === '送貨：表哥（已確定）' && ans9.G6.tentative && ans9.G6.tentative.until === '2026-12-04', ans9.G6);
  ok('八-4：核對器與後台共用同一規則：每個計劃只有一個開局答案欄，概覽優先於各站欄位', chk.openingFields(pg).G6.id === 'g6' && chk.openingFields(pg).G1.id === 'goal-quarter' && !Object.values(chk.openingFields(pg)).some(f => /^m\d-owner$/.test(f.id)), Object.fromEntries(Object.entries(chk.openingFields(pg)).map(([p, f]) => [p, f.id])));
  // 頁面：只承諾會被每週覆核的欄
  c9 = await openChrome(CHROME, path.join(OUT, "profile9"), PORT + 6);
  await usePass(BASE9, c9);
  const { ev: e9, go: g9, click: k9 } = c9;
  await g9(BASE9 + '/proofread.html', 1440, 1500); await e9('localStorage.clear()'); await g9(BASE9 + '/proofread.html', 1440, 2600);
  await k9('#rest-toggle'); await sleep(300); await k9('#layer2 .layer-toggle'); await sleep(300);
  const tents9 = []; (function w(o) { if (Array.isArray(o)) return o.forEach(w); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'value' in o && 'label' in o && o.tentative) tents9.push(o); for (const k in o) if (o[k] && typeof o[k] === 'object') w(o[k]); })(pg);
  const nT9 = tents9.length, mT9 = tents9.filter(e => /^G(?:10|[1-9])$/.test(String(e.plan || '')) && e.kind !== 'grade' && (e.plan !== 'G6' || e.id === 'g6')).length;
  const want9 = N.t(mT9 === nT9 ? 'tentAll' : 'tentPart', { n: nT9, m: mT9, d: '12 月 4 日' });
  const gaps9 = await e9(`(document.querySelector('.gaps')?.textContent||'').replace(/\\s+/g,' ')`);
  ok('八-4：總說明只承諾概覽的 G6，不把第一站暫定負責人當成每週覆核（會重問的項目數與後台一致）', mT9 >= 1 && mT9 < nT9 && gaps9.includes(want9), [gaps9, want9, nT9, mT9]);
  const titles9 = JSON.parse(await e9(`JSON.stringify([...document.querySelectorAll('.tag.tent')].map(t=>({t:t.title, row:(t.closest('[data-row]')||{getAttribute(){return ''}}).getAttribute('data-row')||'', st:(t.closest('.station,li')||{}).id||''})))`));
  const ownerTag = await e9(`(()=>{const t=document.querySelector('[data-eid="m1-owner"] .tag.tent');return t?t.title:null})()`);
  const g6Tag = await e9(`(()=>{const t=document.querySelector('[data-row="g6"] .tag.tent');return t?t.title:null})()`);
  ok('八-4：概覽的 G6 標籤承諾每週訪問核對', g6Tag != null && g6Tag.includes('每週訪問') && g6Tag.includes('12 月 4 日'), g6Tag);
  ok('八-4：第一站（暫定）負責人的標籤不承諾每週覆核，只寫尚待核實', ownerTag != null && ownerTag.includes(N.ui.tentPending) && !ownerTag.includes('每週訪問'), { ownerTag, titles9 });
  ok('八-4：頁面沒有錯誤', c9.errors.length === 0, c9.errors);
} catch (e) { ok('八-4 測試中斷', false, String(e && e.stack || e)); }
finally { if (c9) c9.close(); if (srv9) srv9.kill(); }

trace("進入 九：第九輪（「已交付」以伺服器已確認的內容為基線；附件原因用");
/* ---------- 九：第九輪（「已交付」以伺服器已確認的內容為基線；附件原因用固定字句）----------
   狀態表（proofread.html 的「確認之後」一節是唯一定義處）每一行至少一個斷言：
     載入中／取得失敗／離線（檔案）／伺服器沒有確認／回覆仍在處理／有確認而本機沒有未送出修改／有確認而本機有未送出修改／只差自動調整日期 */
let srvR = null, cR = null, srvF = null;
// 第九輪改用前面各節沒用過的埠（PORT + 10 起，逐個確認空閒才用）：前面各節剛結束的伺服器／瀏覽器埠，在 Windows 上可能還要幾十秒才釋放，
// 重用會令新瀏覽器拿不到除錯埠、伺服器靜默改用下一個埠而測試連錯對象。順帶避開本機長期被佔用或 fetch 不接受的埠。
const SKIP_PORTS = new Set([4318, 4380, 4381, 5040, 5354, 5530, 6000, 9012, 9013, 9014]);
const portFree = p => new Promise(res => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
// 只在本組的埠段 [PORT, PORT + SPAN) 之內選；不再向後掃描到下一組的埠段（第十一輪：舊版最多掃 300 個，會落入「舊分頁」的埠）
async function freePorts(from, n) { const got = []; for (let p = from; got.length < n && p < PORT + SPAN; p++) if (!SKIP_PORTS.has(p) && await portFree(p)) got.push(p); if (got.length < n) throw new Error('本組埠段內找不到足夠的空閒埠（' + from + ' 至 ' + (PORT + SPAN - 1) + '，要 ' + n + ' 個）'); return got; }
const [P_SRV, P_SRVF, P_CHR, P_CHRF] = await freePorts(PORT + 10, 4);
const USED_PORTS = { P_SRV, P_SRVF, P_CHR, P_CHRF };
const BASER = `http://127.0.0.1:${P_SRV}`, DATAR = path.join(OUT, 'data-r9');
const BASEF = `http://127.0.0.1:${P_SRVF}`, DATAF = path.join(OUT, 'data-r9-fresh');
try {
  const pg9 = loadFixture('goal-dates-repro-structured.js');
  const reg9 = {}; (function w(o) { if (Array.isArray(o)) return o.forEach(w); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'value' in o && 'label' in o) reg9[o.id] = o; for (const k in o) if (o[k] && typeof o[k] === 'object') w(o[k]); })(pg9);
  const ids9 = pg9.path.milestones.map(m => m.id), defKind = m => m.kind === 'task' ? 'task' : 'real';
  fs.mkdirSync(path.join(DATAR, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATAR, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATAR, 'company', 'page.json'), JSON.stringify(pg9, null, 2));
  const CONF = path.join(DATAR, 'ledger', 'confirmed.json');
  // 照真實後台的形狀寫確認內容；0.39.0 的確認沒有 autoEdits；示範資料的確認沒有 kinds／order
  const confObj = (edits, o = {}) => {
    const values = {}; for (const [id, e] of Object.entries(reg9)) values[id] = String(e.value ?? '');
    Object.assign(values, edits, o.autoValues || {});
    const auto = (o.autoEdits || []).map(id => ({ id, value: values[id], label: reg9[id].label, auto: true }));
    const c = { company: pg9.company.name, pageId: pg9.page.id, confirmedAt: '2026-11-06T10:00:00+08:00', replyFile: 'r-039.md', orderChanged: false, nextActionMilestone: null,
      edits: Object.entries(edits).map(([id, v]) => ({ id, value: v, label: reg9[id].label })), ...(auto.length ? { autoEdits: auto } : {}), stillMissing: [], note: '', values, kindsChanged: [] };
    if (!o.noOrder) c.order = o.order || ids9;
    if (!o.noKinds) c.kinds = { ...Object.fromEntries(pg9.path.milestones.map(m => [m.id, defKind(m)])), ...(o.kinds || {}) };
    return c;
  };
  const putConf = (edits, o) => fs.writeFileSync(CONF, JSON.stringify(confObj(edits, o), null, 2));
  const dgOf = (edits, o) => lib.confirmedDigest(confObj(edits, o), pg9);
  srvR = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(P_SRV)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATAR, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  forgetPass(BASER); await usePass(BASER);
  let upR = false; for (let i = 0; i < 60 && !upR; i++) { try { upR = !!(await (await tfetch(BASER + '/api/status', { signal: AbortSignal.timeout(3000) })).json()).ok; } catch { } if (!upR) await sleep(300); }
  ok('九：校對頁伺服器在預期的埠啟動（不是靜默改用其他埠）', upR, BASER);
  cR = await openChrome(CHROME, path.join(OUT, 'profile-r9'), P_CHR);
  await usePass(BASER, cR);
  const { ev: eR, go: gR, click: kR } = cR;
  // 讓測試控制 /api/status：hold＝一直不回應；fail＝回 500；pending:<檔名>＝在待處理清單加一個檔名（模擬回覆仍在佇列）
  await cR.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const o=window.fetch;window.fetch=function(u,opt){let m=null;try{m=sessionStorage.getItem('__st')}catch(e){}if(m&&String(u).includes('/api/status')){if(m==='hold')return new Promise(()=>{});if(m==='fail')return Promise.resolve(new Response('{}',{status:500}));if(m.startsWith('pending:'))return o.apply(this,arguments).then(r=>r.clone().json().then(j=>{j.pending=(j.pending||[]).concat([m.slice(8)]);return new Response(JSON.stringify(j),{status:200,headers:{'Content-Type':'application/json'}})}))}return o.apply(this,arguments)}})()` });
  const PAGER = BASER + '/proofread.html';
  const loadR = async (w = 2600) => { await gR(PAGER, 1440, w); };
  const setSt = v => eR(`(()=>{try{${v == null ? `sessionStorage.removeItem('__st')` : `sessionStorage.setItem('__st', ${JSON.stringify(v)})`}}catch(e){}})()`);
  const mainR = () => eR(`(()=>{const e=document.querySelector('#go-main');return e?{tag:e.tagName,text:e.textContent.trim()}:null})()`);
  const heroR = async () => (await eR(`document.querySelector('.hero-t')?.innerText||''`)).trim();
  const bodyHas = s => eR(`document.body.innerText.includes(${JSON.stringify(s)})`);
  const isLinkR = m => !!m && m.tag === 'A', isReR = m => !!m && m.tag === 'BUTTON' && m.text === '再確認一次';
  const draftKeys = () => eR(`Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))`);
  const plant = (d, key = KEY_STRUCT) => eR(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(d))})`);
  const openRestR = async () => { if (!(await eR(`!!document.querySelector('[data-row="next-action"]')`))) { await kR('#rest-toggle'); await sleep(350); } };
  const shownR = sel => eR(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`).then(plain);
  const pickGoalR = async () => { await eR(`(()=>{const o=document.querySelector('#dq-goal-quarter .opt:not(.cur)');if(o)o.setAttribute('data-pick','1')})()`); await kR('[data-pick="1"]'); await eR(`document.querySelectorAll('[data-pick]').forEach(e=>e.removeAttribute('data-pick'))`); };
  const replyR = async () => { await kR('#go-main'); const t = await eR(`document.querySelector('#modal-root pre.file').textContent`); await eR(`document.querySelector('#modal-root .m-foot .btn').click()`); await sleep(200); return machineOf(t); };
  const fresh9 = async () => { await loadR(1200); await eR('localStorage.clear()'); await loadR(); };
  const NA_X = '九輪測試：下一步改寫為先約見綠野物流的負責人', NA_Y = '九輪測試：另一部瀏覽器確認的下一步，改為先約何師傅', NA_C = '九輪測試：這部瀏覽器剛送出、仍在佇列的下一步';
  const delivered39 = (extra = {}) => ({ edits: { 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 6 日 10:00', name: 'r-039.md', sent: true }, sent: { name: 'r-039.md', at: '2026-11-06T10:00:00+08:00' }, ok: {}, kinds: {}, ...extra });

  const sc = async (name, fn) => { if (process.env.GD_ONLY && !process.env.GD_ONLY.split(',').some(k => name.includes(k))) return; try { await fn(); } catch (e) { ok(name + ' 測試中斷', false, String(e && e.stack || e).slice(0, 400)); } };
  await sc("九-1", async () => {
  // 九-1（必修 1）：沒有草稿的瀏覽器，伺服器已確認含改寫句子及改過的期限
  await setSt(null);
  putConf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' });
  await fresh9();
  ok('九-1：沒有草稿的瀏覽器：伺服器已確認 → 大掣是連結（已交付），大卡寫已確認', isLinkR(await mainR()) && (await heroR()) === N.ui.companyHeroDone, [await mainR(), await heroR()]);
  await openRestR();
  ok('九-1：顯示的是已確認的「下一個對外動作」（改寫的句子），不是 Zero 原句', (await shownR('[data-row="next-action"] .ed-val')).includes(NA_X), await shownR('[data-row="next-action"] .ed-val'));
  ok('九-1：目前目標期限顯示已確認的 11 月 27 日（不是 Zero 原值）', (await shownR('[data-row="goal-quarter"] .row-date')).includes('11 月 27 日'), await shownR('[data-row="goal-quarter"] .row-date'));
  // 第十二輪：基線（S.confirmed.digest）存在草稿內，採用伺服器內容時一併保存，重新載入後仍在（舊斷言「不寫入草稿」已不適用：不存基線，重新載入就無從分辨有沒有未送出的修改）
  const d91 = (await draftKeys()).length === 1 ? JSON.parse(await eR(`localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0])`)) : null;   // draftNow 在後面才定義
  ok('九-1：採用伺服器內容時把基線（伺服器確認的摘要）存入草稿，之後重新載入仍在', !!d91 && !!d91.confirmed && d91.confirmed.sent === true && d91.confirmed.digest === dgOf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' }), d91 && d91.confirmed);
  await pickGoalR();
  ok('九-1：在此改一項後，大掣變「再確認一次」，並提示確認後再作了修改', isReR(await mainR()) && await bodyHas('你在確認後再作了修改'), await mainR());
  const m91 = await replyR();
  const ed91 = Object.fromEntries(m91.edits.map(e => [e.id, e]));
  ok('九-1：再確認的回覆包含全部已確認修改（下一個對外動作、目前目標期限）及今次新改，不會被後台還原', ed91['next-action'] && ed91['next-action'].value === NA_X && ed91['goal-quarter-due'] && ed91['goal-quarter-due'].value === '2026-11-27' && ed91['goal-quarter'], m91.edits.map(e => e.id));
  ok('九-1：已確認的兩項是創辦人的修改（沒有 auto），只有檢查日是自動調整', !ed91['next-action'].auto && !ed91['goal-quarter-due'].auto && ed91['goal-4w-due'] && ed91['goal-4w-due'].auto === true, m91.edits.map(e => [e.id, e.auto]));
  ok('九-1：改過之後重開頁面，草稿帶著已確認的修改（再確認不會漏）', (await (async () => { await loadR(); const d = JSON.parse(await eR(`localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0])`)); return d.edits['next-action'] === NA_X && d.edits['goal-quarter-due'] === '2026-11-27' && d.edits['goal-quarter'] && d.changedAfter === undefined && d.confirmed && d.confirmed.sent; })()), await eR(`localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0])`));
  ok('九-1：重開後仍是「再確認一次」', isReR(await mainR()), await mainR());

  });
  await sc("九-1b", async () => {
  // 九-1b：次序及真事／工作類別也以伺服器為準
  { const swapped = ids9.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const flip = defKind(pg9.path.milestones[2]) === 'task' ? 'real' : 'task';
    putConf({ 'next-action': NA_X }, { order: swapped, kinds: { [ids9[2]]: flip } });
    await fresh9();
    ok('九-1b：次序及類別由伺服器帶入後，仍是已交付（連結）', isLinkR(await mainR()), await mainR());
    await openRestR(); await pickGoalR();
    const m = await replyR();
    ok('九-1b：再確認的回覆帶出已確認的次序與類別', m.order.join() === swapped.join() && m.kinds[ids9[2]] === flip && m.kindsChanged.includes(ids9[2]), { order: m.order, k: m.kinds[ids9[2]], kc: m.kindsChanged }); }

  });
  await sc("九-2", async () => {
  // 九-2（必修 2）：照真實創辦人的形狀——0.39.0 的確認（目前目標期限早於短期目標檢查日，沒有自動調整）＋0.39.0 舊草稿
  putConf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' });
  await loadR(1200); await eR('localStorage.clear()'); await plant(delivered39()); await loadR();
  ok('九-2：0.39.0 舊草稿（sent:true、沒有 changedAfter、沒有摘要、內容同伺服器）升級後：大掣是連結（已交付）', isLinkR(await mainR()), await mainR());
  ok('九-2：沒有「你在確認後再作了修改」', !(await bodyHas('你在確認後再作了修改')));
  ok('九-2：只差自動調整的檢查日：另有如實的說明（檢查日已按目前目標期限調整為 11 月 27 日），附「再確認一次」', !!N.ui.autoGapNote && (await shownR('#auto-gap')).includes(plain(N.t('autoGapNote', { d: '11 月 27 日' }))) && (await shownR('#auto-gap-btn')) === N.ui.reconfirm, await shownR('#auto-gap'));
  ok('九-2：草稿鑰匙及內容不變', (await draftKeys()).join() === KEY_STRUCT && (await eR(`Object.keys(JSON.parse(localStorage.getItem(${JSON.stringify(KEY_STRUCT)})).edits).join()`)) === 'next-action,goal-quarter-due');
  await kR('#auto-gap-btn');
  ok('九-2：按說明裡的「再確認一次」打開確認視窗（讓 Zero 採用新日子）', await eR(`!!document.querySelector('#modal-root #do-confirm')`));
  await eR(`document.querySelector('#modal-root .m-foot .btn').click()`); await sleep(200);
  await fresh9();
  ok('九-2：同一伺服器、沒有草稿的瀏覽器：同樣是已交付，同樣沒有「你在確認後再作了修改」', isLinkR(await mainR()) && !(await bodyHas('你在確認後再作了修改')), await mainR());

  });
  await sc("九-2b", async () => {
  // 九-2b：0.39.1 的確認已把自動調整的檢查日另記（autoEdits）：沒有草稿的瀏覽器顯示已交付，也沒有自動調整的說明
  putConf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' }, { autoEdits: ['goal-4w-due'], autoValues: { 'goal-4w-due': '2026-11-27' } });
  await fresh9();
  ok('九-2b：0.39.1 的確認（含 autoEdits）：已交付，沒有說明', isLinkR(await mainR()) && !(await bodyHas('你在確認後再作了修改')) && (await eR(`!document.querySelector('#auto-gap')`)), await mainR());
  await openRestR(); await pickGoalR();
  const m92 = await replyR(), ed92 = Object.fromEntries(m92.edits.map(e => [e.id, e]));
  ok('九-2b：自動調整的檢查日不會變成創辦人的修改：再確認時仍帶 auto:true，創辦人親自改的沒有', ed92['goal-4w-due'] && ed92['goal-4w-due'].auto === true && ed92['goal-quarter-due'] && !ed92['goal-quarter-due'].auto && ed92['next-action'] && !ed92['next-action'].auto, m92.edits.map(e => [e.id, e.auto]));

  });
  await sc("九-3", async () => {
  // 九-3（建議 3）：A 瀏覽器送出的內容其後被另一部瀏覽器的確認取代
  { putConf({ 'next-action': NA_X });
    const dgX = dgOf({ 'next-action': NA_X });
    const draftA = { edits: { 'next-action': NA_X }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 6 日 10:00', name: 'a.md', sent: true, digest: dgX }, sent: { name: 'a.md', at: '2026-11-06T10:00:00+08:00' }, ok: {}, kinds: {} };
    await loadR(1200); await eR('localStorage.clear()'); await plant(draftA); await loadR(); await openRestR();
    ok('九-3：A 的內容與伺服器相同：已交付，顯示 A 的內容', isLinkR(await mainR()) && (await shownR('[data-row="next-action"] .ed-val')).includes(NA_X), [await mainR(), await shownR('[data-row="next-action"] .ed-val')]);
    putConf({ 'next-action': NA_Y });
    await loadR(); await openRestR();
    const naY = await shownR('[data-row="next-action"] .ed-val');
    ok('九-3：伺服器被另一份不同內容取代後，A 重開時顯示伺服器的內容，不再顯示 A 的舊內容', naY.includes(NA_Y) && !naY.includes(NA_X), naY);
    ok('九-3：不聲稱 A 的舊內容已交付（頁面上沒有 A 的舊句子）', !(await bodyHas(NA_X)));
    // 本機另有未送出的修改時，不可被伺服器覆蓋
    const unsent = '九輪測試：A 在送出之後又改了一句，未送出';
    await loadR(1200); await eR('localStorage.clear()'); await plant({ ...draftA, edits: { 'next-action': unsent } }); await loadR(); await openRestR();
    ok('九-3：本機有未送出的修改：保留本機內容，不被伺服器覆蓋', (await shownR('[data-row="next-action"] .ed-val')).includes(unsent), await shownR('[data-row="next-action"] .ed-val'));
    ok('九-3：本機有未送出的修改：大掣是「再確認一次」，並提示確認後再作了修改', isReR(await mainR()) && await bodyHas('你在確認後再作了修改'), await mainR()); }

  });
  await sc("九-4", async () => {
  // 九-4：伺服器狀態未到、取得失敗：不顯示「已確認」，用中性提示
  putConf({ 'next-action': NA_X });
  await loadR(1200); await eR('localStorage.clear()'); await setSt('hold'); await loadR(1800);
  ok('九-4：伺服器狀態未到（沒有草稿）：中性提示「正在讀取已確認的內容」', !!N.ui.snapLoading && (await shownR('#snap-note')) === plain(N.ui.snapLoading), await shownR('#snap-note'));
  ok('九-4：伺服器狀態未到：大掣是按鈕、大卡不寫已確認', !isLinkR(await mainR()) && (await heroR()) !== N.ui.companyHeroDone && !(await bodyHas('你在確認後再作了修改')), [await mainR(), await heroR()]);
  await plant(delivered39()); await loadR(1800);
  ok('九-4：伺服器狀態未到（本機草稿稱已送出）：仍不顯示已確認', (await heroR()) !== N.ui.companyHeroDone && !isLinkR(await mainR()), [await mainR(), await heroR()]);
  await eR('localStorage.clear()'); await setSt('fail'); await loadR(1800);
  ok('九-4：取得失敗：中性提示「暫時未能讀取你已確認的內容」，不顯示已確認', !!N.ui.snapUnknown && (await shownR('#snap-note')) === plain(N.ui.snapUnknown) && (await heroR()) !== N.ui.companyHeroDone && !isLinkR(await mainR()), [await shownR('#snap-note'), await heroR()]);
  ok('九-4：取得失敗時仍有離線檢視的說明', await bodyHas(N.ui.offlineView));
  await setSt(null);

  });
  await sc("九-5", async () => {
  // 九-5：伺服器對本頁沒有確認
  fs.rmSync(CONF, { force: true });
  await fresh9();
  ok('九-5：伺服器沒有確認、沒有草稿：首次確認字樣的按鈕，沒有中性提示', (await mainR()) && (await mainR()).tag === 'BUTTON' && (await mainR()).text !== '再確認一次' && (await eR(`!document.querySelector('#snap-note')`)), await mainR());
  await plant(delivered39({ confirmed: { at: '2026 年 11 月 6 日 10:00', name: 'r-039.md', sent: true, digest: dgOf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' }) } })); await loadR();
  ok('九-5：伺服器沒有確認而本機稱已送出（也不在處理中）：不聲稱已交付，大掣是「再確認一次」，沒有不實的「確認後再作了修改」', isReR(await mainR()) && !(await bodyHas('你在確認後再作了修改')), await mainR());

  });
  await sc("九-6", async () => {
  // 九-6：回覆仍在佇列：以送出當刻的內容為準，不採用舊的伺服器內容
  { putConf({ 'next-action': NA_X });
    const dgC = dgOf({ 'next-action': NA_C });
    const draftC = { edits: { 'next-action': NA_C }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name: 'c.md', sent: true, digest: dgC }, sent: { name: 'c.md', at: '2026-11-07T10:00:00+08:00' }, ok: {}, kinds: {} };
    await loadR(1200); await eR('localStorage.clear()'); await plant(draftC); await setSt('pending:c.md'); await loadR(); await openRestR();
    ok('九-6：回覆仍在佇列：顯示送出當刻的內容，不被舊的伺服器內容取代', (await shownR('[data-row="next-action"] .ed-val')).includes(NA_C), await shownR('[data-row="next-action"] .ed-val'));
    ok('九-6：回覆仍在佇列：視為已交付（連結），沒有「確認後再作了修改」', isLinkR(await mainR()) && !(await bodyHas('你在確認後再作了修改')), await mainR());
    await setSt(null); await loadR(); await openRestR();
    ok('九-6：回覆不在佇列也沒有工作紀錄（伺服器已套用另一份）：改顯示伺服器的內容', (await shownR('[data-row="next-action"] .ed-val')).includes(NA_X) && isLinkR(await mainR()), await shownR('[data-row="next-action"] .ed-val')); }

  });
  await sc("九-7", async () => {
  // 九-7：示範資料形狀的確認（沒有 kinds、沒有 order）
  putConf({ 'next-action': NA_X }, { noKinds: true, noOrder: true });
  await fresh9();
  ok('九-7：確認紀錄沒有類別及次序（示範資料形狀）：沒有草稿的瀏覽器仍是已交付', isLinkR(await mainR()), await mainR());

  });
  await sc("九-8", async () => {
  // 九-8：開啟的是檔案（離線）：沒有中性提示、按鈕
  await gR(STRUCT, 1440, 1200); await eR('localStorage.clear()'); await gR(STRUCT, 1440, 1500);   // 用本節的瀏覽器（第一個瀏覽器已閒置很久）
  ok('九-8：開啟檔案（離線）：沒有伺服器中性提示，大掣是按鈕', (await eR(`!document.querySelector('#snap-note')`)) && (await eR(`document.querySelector('#go-main')?.tagName`)) === 'BUTTON');
  ok('九-8：頁面沒有錯誤', cR.errors.length === 0, cR.errors);
  });

  /* ---------- 十：第十輪（「已交付」只按內容比較；套用失敗保留送出的內容；輸入中途不採用新內容；中性提示；站編號）---------- */
  trace('進入 十：第十輪頁面');
  const SAYS = '你在確認後再作了修改', NEUTRAL = '這部瀏覽器上的內容與 Zero 已收到的版本不同', RESTORED = '已還原你上次未確認的修改';
  const STATUS_R = path.join(DATAR, 'ledger', 'status.json');
  const noNote = async () => !(await bodyHas(SAYS)) && !(await bodyHas(NEUTRAL));
  const qokClick = async () => { const has = await eR(`!!document.querySelector('#dq-status .q-ok')`); if (has) await kR('#dq-status .q-ok'); return has; };
  const draftNow = async () => JSON.parse(await eR(`localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('sos-proofread:'))[0])`));
  const waitR = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(300); } return null; };
  const runOf = (state, files = ['r-x.md']) => ({ runs: [{ id: 'R10-' + state, kind: 'proofread', ref: pg9.page.id, startedAt: '2026-11-07T10:00:00+08:00', state, ...(state === 'failed' ? { error: '這次答案未能記錄：答案來源重複。請按「重新載入」，再確認一次。' } : {}), replyFiles: files,
    steps: [{ key: 'received', label: '收到', state: 'done', at: '', detail: '' }, ...(state === 'failed' ? [{ key: 'applied', label: '套用確認', state: 'failed', at: '', detail: '答案來源重複' }] : [])] }] });
  const NA_Z = '十輪測試：又一部瀏覽器其後確認的下一步，改為先約陳先生';

  await sc("十-1", async () => {
  // 十-1（必修 1）：「已交付」只按內容比較——按「照現狀」、改了又改回已確認的值，內容沒有變，不算修改
  putConf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' });
  await fresh9();
  const hasOk = await qokClick();
  ok('十-1a：沒有草稿的瀏覽器採用快照後，狀態卡有「照現狀」按鈕（測試前提）', hasOk);
  ok('十-1a：按「照現狀」後仍是已交付（連結），大卡仍寫已確認，沒有「再確認一次」及任何修改提示', isLinkR(await mainR()) && (await heroR()) === N.ui.companyHeroDone && await noNote(), [await mainR(), await heroR()]);
  ok('十-1a：草稿不再帶 changedAfter 旗標', (await draftNow()).changedAfter === undefined, await draftNow());
  await loadR();
  ok('十-1a：重新載入後亦然', isLinkR(await mainR()) && await noNote(), await mainR());
  // 改一項再改回已確認的選項
  await fresh9();
  const curIdx = await eR(`[...document.querySelectorAll('#dq-goal-quarter .opt')].findIndex(o=>o.classList.contains('cur'))`);
  await pickGoalR();
  ok('十-1b：改選另一項：大掣變「再確認一次」，並提示確認後再作了修改（測試前提）', isReR(await mainR()) && await bodyHas(SAYS), await mainR());
  await eR(`document.querySelectorAll('#dq-goal-quarter .opt')[${curIdx}].setAttribute('data-back','1')`); await kR('[data-back="1"]');
  ok('十-1b：再按回原本已確認的選項（內容與確認相同）：仍是已交付（連結），沒有修改提示', isLinkR(await mainR()) && await noNote(), await mainR());
  await loadR();
  ok('十-1b：重新載入後亦然', isLinkR(await mainR()) && await noNote(), await mainR());
  // 真的改了內容
  await fresh9(); await pickGoalR();
  ok('十-1c：真的改了內容：「再確認一次」及修改提示', isReR(await mainR()) && await bodyHas(SAYS), await mainR());
  await loadR();
  ok('十-1c：重新載入後仍是「再確認一次」', isReR(await mainR()) && await bodyHas(SAYS), await mainR());
  // 0.39.0 舊草稿（真實創辦人的形狀）升級後按「照現狀」
  await loadR(1200); await eR('localStorage.clear()'); await plant(delivered39()); await loadR();
  ok('十-1d：0.39.0 舊草稿升級後：已交付（連結）', isLinkR(await mainR()) && await noNote(), await mainR());
  const had39 = await qokClick();
  ok('十-1d：0.39.0 舊草稿按「照現狀」後仍是已交付（連結），沒有修改提示', had39 === true && isLinkR(await mainR()) && await noNote(), { hadButton: had39, main: await mainR() });
  await loadR();
  ok('十-1d：重新載入後仍是已交付', isLinkR(await mainR()) && await noNote(), await mainR());
  // 離線確認：存入已算好的摘要；內容不變就不顯示修改提示
  await gR(STRUCT, 1440, 1200); await eR('localStorage.clear()'); await gR(STRUCT, 1440, 2000);
  await kR('#go-main'); await kR('#do-confirm'); await sleep(800);
  const dOff = await draftNow();
  ok('十-1e：離線確認把已算好的摘要存入草稿（八位十六進位），不當成已送出', dOff.confirmed && /^[0-9a-f]{8}$/.test(String(dOff.confirmed.digest || '')) && !dOff.confirmed.sent, dOff.confirmed);
  ok('十-1e：離線確認後內容沒有變：沒有修改提示', await noNote(), await mainR());
  await gR(STRUCT, 1440, 2000);
  const had1e = await qokClick();
  ok('十-1e：離線確認、重新載入、按「照現狀」後：仍沒有修改提示（確實按到「照現狀」）', had1e === true && await noNote(), { hadButton: had1e });
  await pickGoalR();
  ok('十-1e：離線確認後真的改了內容：有修改提示', await bodyHas(SAYS));
  });

  await sc("十-2", async () => {
  // 十-2（必修 2；第十一輪改為創辦人核准的字句）：未能讀取附件的整句是「未能讀取：{f}。{r}」，{r} 自帶句號、按檔案類型寫；頁名取自名稱表（intakeTitle）
  const PAGE = N.ui.intakeTitle, line = f => plain(N.t('unreadFileLine', { f, r: N.unreadReason(f) }));
  const WANT = {
    legacy: 'Zero 未能讀取舊版 Office 格式。請另存為新版格式（例如 .docx）或 PDF 再交，或在「' + PAGE + '」頁直接寫下文件重點。',
    convert: '這份文件未能轉成文字。請另存為 PDF 再交，或在「' + PAGE + '」頁直接寫下文件重點。',
    tooBig: '這份文件太大，未能轉成文字。請分拆後再交，或在「' + PAGE + '」頁直接寫下文件重點。',
    corrupt: '這份文件可能已損壞，未能轉成文字。請重新另存後再交，或在「' + PAGE + '」頁直接寫下文件重點。',
    password: '這份文件設有密碼，未能轉成文字。請移除密碼後再交，或在「' + PAGE + '」頁直接寫下文件重點。',
    pdf: '這份 PDF 未能讀取，常見原因是掃描圖片或設有密碼。請改交可選取文字的 PDF、移除密碼後再交，或在「' + PAGE + '」頁直接寫下文件重點。',
    other: 'Zero 目前無法讀取這種檔案。請改交 PDF，或在「' + PAGE + '」頁直接寫下文件重點。'
  };
  const FILES = { legacy: ['舊版.doc', '舊版.xls', '舊版.ppt'], modern: ['計劃書.docx', '簡報.PPTX', '數據.xlsx'], pdf: ['報告.pdf', '報告.PDF'], other: ['照片.png', 'x.HEIC', '無副檔名', '筆記.pages', '表.numbers', '簡報.key'] };
  const ALL = [].concat(FILES.legacy, FILES.modern, FILES.pdf, FILES.other);
  ok('十-2：整句範本是「未能讀取：{f}。{r}」（原因自帶句號，不再用破折號接完整句子）', N.ui.unreadFileLine === '未能讀取：{f}。{r}', N.ui.unreadFileLine);
  ok('十-2：舊版 Office（.doc、.xls、.ppt）整句是核准字句：請另存為新版格式或 PDF', FILES.legacy.every(f => line(f) === plain('未能讀取：' + f + '。' + WANT.legacy)), FILES.legacy.map(line));
  ok('十-2：新版 Office（.docx、.xlsx、.pptx）未能轉成文字：按原因代碼分五句（沒有代碼＝一般轉換失敗；太大、損壞、密碼各有一句）', FILES.modern.every(f => line(f) === plain('未能讀取：' + f + '。' + WANT.convert) && N.unreadReason(f, 'too-big') === WANT.tooBig && N.unreadReason(f, 'corrupt') === WANT.corrupt && N.unreadReason(f, 'encrypted') === WANT.password), FILES.modern.map(f => [line(f), N.unreadReason(f, 'too-big'), N.unreadReason(f, 'corrupt'), N.unreadReason(f, 'encrypted')]));
  ok('十-2：PDF 整句是核准字句，說明掃描圖片不會讀到，不再設頁數門檻', FILES.pdf.every(f => line(f) === plain('未能讀取：' + f + '。' + WANT.pdf) && /掃描圖片/.test(line(f)) && !/100\s*頁/.test(line(f))), FILES.pdf.map(line));
  ok('十-2：其他（圖片、無副檔名）整句是核准字句', ['照片.png', 'x.HEIC', '無副檔名'].every(f => line(f) === plain('未能讀取：' + f + '。' + WANT.other)), ['照片.png', 'x.HEIC', '無副檔名'].map(line));
  ok('十-2：Apple 格式（.pages、.numbers、.key）不歸入 Office，改用「其他」字句（字句只寫 Word、Excel、PowerPoint）', ['筆記.pages', '表.numbers', '簡報.key'].every(f => line(f) === plain('未能讀取：' + f + '。' + WANT.other) && !/Word/.test(line(f))), ['筆記.pages', '表.numbers', '簡報.key'].map(line));
  ok('十-2：沒有「。。」及「——」，每句以句號結尾', ALL.every(f => !line(f).includes('。。') && !line(f).includes('——') && line(f).endsWith('。')), ALL.map(line).filter(x => x.includes('。。') || x.includes('——') || !x.endsWith('。')));
  ok('十-2：引號成對，只用「」，沒有與外層衝突的『』', ALL.every(f => (line(f).match(/「/g) || []).length === (line(f).match(/」/g) || []).length && !/[『』]/.test(line(f))), ALL.map(line).filter(x => /[『』]/.test(x)));
  ok('十-2：用字檢查零命中（整句）', ALL.every(f => N.styleIssues(N.t('unreadFileLine', { f, r: N.unreadReason(f) })).length === 0), ALL.map(f => N.styleIssues(N.t('unreadFileLine', { f, r: N.unreadReason(f) }))).filter(x => x.length));
  ok('十-2：頁名只在名稱表一處（intakeTitle）：各句原因用 {page}，沒有另寫一份「' + PAGE + '」', ['unreadReasonOffice', 'unreadReasonConvert', 'unreadReasonTooBig', 'unreadReasonCorrupt', 'unreadReasonPassword', 'unreadReasonPdf', 'unreadDefaultReason'].every(k => N.ui[k].includes('{page}') && !N.ui[k].includes(PAGE)), ['unreadReasonOffice', 'unreadReasonConvert', 'unreadReasonTooBig', 'unreadReasonCorrupt', 'unreadReasonPassword', 'unreadReasonPdf', 'unreadDefaultReason'].map(k => N.ui[k]));
  });

  await sc("十-3", async () => {
  // 十-3（建議 1）：套用確認失敗後保留創辦人送出的內容，不退回舊的伺服器確認
  putConf({ 'next-action': NA_Y });
  const dgX = dgOf({ 'next-action': NA_X });
  const draftX = { edits: { 'next-action': NA_X }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name: 'r-x.md', sent: true, digest: dgX }, sent: { name: 'r-x.md', at: '2026-11-07T10:00:00+08:00' }, ok: {}, kinds: {} };
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running')));
  await loadR(1200); await eR('localStorage.clear()'); await plant(draftX); await loadR(); await openRestR();
  ok('十-3：回覆處理中：顯示送出的內容，大掣是連結（測試前提）', isLinkR(await mainR()) && (await shownR('[data-row="next-action"] .ed-val')).includes(NA_X), [await mainR(), await shownR('[data-row="next-action"] .ed-val')]);
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('failed')));
  const flipped = await waitR(async () => isReR(await mainR()));
  ok('十-3：套用失敗：大掣改為「再確認一次」', !!flipped, await mainR());
  const naF = await shownR('[data-row="next-action"] .ed-val');
  ok('十-3：套用失敗後仍顯示創辦人送出的內容，不退回舊的伺服器確認', naF.includes(NA_X) && !naF.includes(NA_Y), naF);
  ok('十-3：如實提示：這部瀏覽器上的內容與 Zero 已收到的版本不同，並沿用現有失敗提示', await bodyHas(NEUTRAL) && await bodyHas('答案來源重複'), await shownR('.notice'));
  await loadR(); await openRestR();
  const naF2 = await shownR('[data-row="next-action"] .ed-val');
  ok('十-3：重新載入後仍是創辦人送出的內容，仍是「再確認一次」', naF2.includes(NA_X) && !naF2.includes(NA_Y) && isReR(await mainR()), [naF2, await mainR()]);
  const m103 = await replyR();
  ok('十-3：再確認的回覆帶創辦人送出的內容（不是舊的伺服器內容）', m103.edits.some(e => e.id === 'next-action' && e.value === NA_X), m103.edits.map(e => [e.id, e.value]));
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十-4", async () => {
  // 十-4（建議 2）：創辦人輸入中途（自行填寫框有字、確認視窗開着）不採用伺服器的新內容；閒下來才採用
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running', ['other.md'])));   // 有別人的工作在進行：輪詢每 2 秒一次，縮短等候
  putConf({ 'next-action': NA_Y });
  await fresh9();
  await kR('#dq-goal-quarter .dq-foot .btn.small'); await sleep(300);
  const TYPED = '十輪測試：創辦人正在打字，未按「使用」';
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value=${JSON.stringify(TYPED)};t.dispatchEvent(new Event('input'));t.focus();return true})()`);
  putConf({ 'next-action': NA_Z });
  await sleep(7000);
  const typedAfter = await eR(`document.querySelector('#dq-goal-quarter textarea')?.value ?? null`);
  ok('十-4：自行填寫框有未按「使用」的字時，伺服器內容被別處改寫：輸入框的字沒有被清空', typedAfter === TYPED, typedAfter);
  // 清空輸入框並按「收起」（自行填寫框打開期間算輸入中）
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value='';t.dispatchEvent(new Event('input'))})()`);
  await kR('#dq-goal-quarter .p-foot .btn:not(.primary)');
  await openRestR();
  const adoptedZ = await waitR(async () => (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Z));
  ok('十-4：輸入框清空並收起、閒下來之後，才採用伺服器的新內容', !!adoptedZ, await shownR('[data-row="next-action"] .ed-val'));
  // 確認視窗開着：不採用（0.39.0 確認的形狀，檢查日有自動調整，沒有草稿的瀏覽器不動手也能打開確認視窗）
  putConf({ 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' });
  await fresh9(); await openRestR();
  ok('十-4：打開確認視窗的前提：有「再確認一次」說明（檢查日自動調整）', await eR(`!!document.querySelector('#auto-gap-btn')`));
  await kR('#auto-gap-btn');
  putConf({ 'next-action': NA_Y, 'goal-quarter-due': '2026-11-27' });
  await sleep(7000);
  ok('十-4：確認視窗開着時，伺服器內容被別處改寫：視窗仍開着，頁面內容沒有在視窗後面被換掉', (await eR(`!!document.querySelector('#modal-root #do-confirm')`)) && (await shownR('[data-row="next-action"] .ed-val')).includes(NA_X), await shownR('[data-row="next-action"] .ed-val'));
  await eR(`document.querySelector('#modal-root .m-foot .btn').click()`);
  const adoptedY = await waitR(async () => (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Y));
  ok('十-4：關閉確認視窗、閒下來之後，才採用伺服器的新內容', !!adoptedY, await shownR('[data-row="next-action"] .ed-val'));
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十-5", async () => {
  // 十-5：兩個小矛盾
  // (a) 0.39.0 舊草稿（沒有送出摘要）內容與伺服器不同。第十一輪：無法分辨誰改過，保留本機並用中性字句；
  //     第十二輪（有意的行為改變）：舊草稿沒有基線而 S.confirmed.sent 為真，以伺服器為準，採用伺服器的內容（真實創辦人的舊草稿除自動調整外與伺服器相同，不受影響）
  putConf({ 'next-action': NA_Y });
  await loadR(1200); await eR('localStorage.clear()'); await plant(delivered39()); await loadR(); await openRestR();
  ok('十-5a：0.39.0 舊草稿（沒有送出摘要）內容與伺服器不同：以伺服器為準，顯示伺服器的內容，已交付（連結）', isLinkR(await mainR()) && (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Y), [await mainR(), await shownR('[data-row="next-action"] .ed-val')]);
  ok('十-5a：沒有中性字句，也沒有「你在確認後再作了修改」', await noNote(), await shownR('.notice'));
  // 有摘要的草稿（這部瀏覽器確認過）之後又改了：仍可確定是確認後的修改
  const dgX7 = dgOf({ 'next-action': NA_X });
  await loadR(1200); await eR('localStorage.clear()');
  await plant({ edits: { 'next-action': NA_X + '（又改了）' }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 6 日 10:00', name: 'a.md', sent: true, digest: dgX7 }, sent: { name: 'a.md', at: '2026-11-06T10:00:00+08:00' }, ok: {}, kinds: {} }); await loadR();
  ok('十-5a：這部瀏覽器確認過（有摘要）而內容之後又改了：寫「你在確認後再作了修改」', isReR(await mainR()) && await bodyHas(SAYS) && !(await bodyHas(NEUTRAL)), await shownR('.notice'));
  // (b) 還原的未確認草稿內容剛好等於伺服器確認
  const un = text => ({ edits: { 'next-action': text }, order: ids9, openedPath: false, note: '', confirmed: null, sent: null, ok: {}, kinds: {} });
  await loadR(1200); await eR('localStorage.clear()'); await plant(un(NA_Y)); await loadR();
  ok('十-5b：還原的未確認草稿內容等於伺服器確認：視為已確認（連結），不顯示「已還原……」及「放棄修改」', isLinkR(await mainR()) && !(await bodyHas(RESTORED)) && !(await bodyHas(N.ui.discardRestart)), [await mainR(), await shownR('.notice')]);
  await loadR(1200); await eR('localStorage.clear()'); await plant(un('十輪測試：本機未確認、與伺服器不同的下一步')); await loadR();
  ok('十-5b：對照：內容與伺服器不同的未確認草稿，仍顯示「已還原你上次未確認的修改」及「放棄修改」', isReR(await mainR()) && await bodyHas(RESTORED) && await bodyHas(N.ui.discardRestart), [await mainR(), await shownR('.notice')]);
  });

  await sc("十-6", async () => {
  // 十-6（建議 4）：站編號若是數字，頁面與伺服器的摘要一致（頁面計算摘要時站編號一律轉成字串）
  const DATAN = path.join(OUT, 'data-r10-num'), [P_NUM] = await freePorts(P_CHRF + 1, 1);
  USED_PORTS.P_NUM = P_NUM;
  const pgN = JSON.parse(JSON.stringify(pg9)); pgN.path.milestones.forEach((m, i) => { m.id = i + 1; });
  fs.mkdirSync(path.join(DATAN, 'company'), { recursive: true }); fs.mkdirSync(path.join(DATAN, 'ledger'), { recursive: true });
  fs.writeFileSync(path.join(DATAN, 'company', 'page.json'), JSON.stringify(pgN, null, 2));
  const valuesN = {}; (function w(o) { if (Array.isArray(o)) return o.forEach(w); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'value' in o && 'label' in o) valuesN[o.id] = String(o.value ?? ''); for (const k in o) if (o[k] && typeof o[k] === 'object') w(o[k]); })(pgN);
  valuesN['next-action'] = NA_X;
  fs.writeFileSync(path.join(DATAN, 'ledger', 'confirmed.json'), JSON.stringify({ company: pgN.company.name, pageId: pgN.page.id, confirmedAt: '2026-11-06T10:00:00+08:00', replyFile: 'r-num.md', orderChanged: false, nextActionMilestone: null, edits: [{ id: 'next-action', value: NA_X, label: 'x' }], stillMissing: [], note: '', values: valuesN, order: pgN.path.milestones.map(m => String(m.id)), kinds: Object.fromEntries(pgN.path.milestones.map(m => [String(m.id), m.kind === 'task' ? 'task' : 'real'])), kindsChanged: [] }, null, 2));
  const srvN = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(P_NUM)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATAN, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  try {
    const BASEN = `http://127.0.0.1:${P_NUM}`;
    forgetPass(BASEN); await usePass(BASEN); await usePass(BASEN, cR);
    let upN = false; for (let i = 0; i < 60 && !upN; i++) { try { upN = !!(await (await tfetch(BASEN + '/api/status', { signal: AbortSignal.timeout(3000) })).json()).ok; } catch { } if (!upN) await sleep(300); }
    ok('十-6：站編號是數字的伺服器在預期的埠啟動', upN, BASEN);
    await gR(BASEN + '/proofread.html', 1440, 1200); await eR('localStorage.clear()'); await gR(BASEN + '/proofread.html', 1440, 2600);
    ok('十-6：站編號是數字（1、2、3……）：伺服器已確認 → 沒有草稿的瀏覽器是已交付（連結），沒有修改提示', isLinkR(await mainR()) && await noNote(), [await mainR(), await shownR('.notice')]);
    await qokClick();
    ok('十-6：按「照現狀」後仍是已交付', isLinkR(await mainR()) && await noNote(), await mainR());
    // 草稿的次序是數字（頁面自己存的）：頁面與伺服器算出同一個摘要，內容相同就是已交付
    const KEY_N = 'sos-proofread:' + pgN.page.id + ':' + (pgN.page.revision || 0) + ':' + lib.fnv(JSON.stringify(pgN));
    await gR(BASEN + '/proofread.html', 1440, 1200); await eR('localStorage.clear()');
    await plant({ edits: { 'next-action': NA_X }, order: pgN.path.milestones.map(m => m.id), openedPath: false, note: '', confirmed: { at: '2026 年 11 月 6 日 10:00', name: 'r-num.md', sent: true }, sent: { name: 'r-num.md', at: '2026-11-06T10:00:00+08:00' }, ok: {}, kinds: {} }, KEY_N);
    await gR(BASEN + '/proofread.html', 1440, 2600);
    ok('十-6：本機草稿的次序是數字、內容與伺服器確認相同：已交付（連結），沒有修改提示（頁面與伺服器的摘要一致）', isLinkR(await mainR()) && await noNote(), [await mainR(), await shownR('.notice')]);
  } finally { srvN.kill(); }
  });

  /* ---------- 十一：第十一輪（套用失敗後伺服器已有相同內容；還原草稿的確認基線；只按內容保護未送出修改；輸入中途不整頁重畫；埠段）---------- */
  trace('進入 十一：第十一輪頁面');
  const unDraft = text => ({ edits: { 'next-action': text }, order: ids9, openedPath: false, note: '', confirmed: null, sent: null, ok: {}, kinds: {} });
  const swapped = ids9.slice(); [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  // 路線次序：要先展開「其餘」及「路線」兩層才有站的清單
  const orderOf = async () => { await openRestR(); if (await eR(`!!document.querySelector('#layer2.closed')`)) { await kR('#layer2 .layer-toggle'); await sleep(250); } return eR(`[...document.querySelectorAll('#layer2 [data-mid]')].map(e=>e.dataset.mid)`); };
  const BASE_CONF = { 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' };
  const fastPoll = () => fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running', ['other.md'])));   // 有別人的工作在進行：輪詢每 2 秒一次，縮短等候
  // 失敗進度卡（標題是 trackFailed）；「AI 工具未設定」的警告卡也有 .bad，不能混淆
  const trackBad = () => eR(`[...document.querySelectorAll('#track .track.bad h3')].some(x => x.textContent === ${JSON.stringify(N.ui.trackFailed)})`);

  await sc("十一-1", async () => {
  // 十一-1（覆核建議 1）：這部瀏覽器的回覆套用失敗，其後伺服器已有與送出內容相同的確認（例如另一部瀏覽器確認了同一份）：算已交付
  putConf({ 'next-action': NA_Y });
  const draftX = { edits: { 'next-action': NA_X }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name: 'r-x.md', sent: true, digest: dgOf({ 'next-action': NA_X }) }, sent: { name: 'r-x.md', at: '2026-11-07T10:00:00+08:00' }, ok: {}, kinds: {} };
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running')));
  await loadR(1200); await eR('localStorage.clear()'); await plant(draftX); await loadR();
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('failed')));
  const flipped = await waitR(async () => isReR(await mainR()));
  ok('十一-1：前提：套用失敗而伺服器仍是別的內容：「再確認一次」及失敗進度卡', !!flipped && await trackBad() && await bodyHas('答案來源重複'), [await mainR(), await trackBad()]);
  putConf({ 'next-action': NA_X });   // 另一部瀏覽器其後確認了與送出內容相同的一份
  const done = await waitR(async () => isLinkR(await mainR()), 25000);
  ok('十一-1：伺服器其後有相同內容：已交付（連結），大卡寫已確認', !!done && (await heroR()) === N.ui.companyHeroDone, [await mainR(), await heroR()]);
  ok('十一-1：沒有「再確認一次」，也沒有修改提示或中性提示', !isReR(await mainR()) && await noNote(), [await mainR(), await shownR('.notice')]);
  ok('十一-1：不再顯示過時的失敗進度卡及失敗原因（內容已經在 Zero 那裏）', !(await trackBad()) && !(await bodyHas('答案來源重複')), [await trackBad()]);
  await loadR();
  ok('十一-1：重新載入後亦然：已交付、沒有提示、沒有失敗進度卡', isLinkR(await mainR()) && await noNote() && !(await trackBad()) && !(await bodyHas('答案來源重複')), [await mainR(), await trackBad()]);
  // 第十三輪：伺服器曾有相同內容（上面已同步，失敗紀錄 S.sent 已清除並存入草稿）之後伺服器的確認被移走：Zero 曾收到這份內容，過時的失敗卡不再顯示才正確。
  // （舊斷言「失敗進度卡仍在」的情境是「伺服器從沒有相同內容」；那個情況改在十三-3 用全新的失敗草稿驗證。）仍是「再確認一次」，沒有中性字句
  fs.rmSync(CONF, { force: true });
  await loadR();
  ok('十一-1：（第十三輪改）曾同步到相同內容、其後伺服器沒有任何確認：「再確認一次」、不再顯示過時的失敗進度卡、沒有中性字句', isReR(await mainR()) && !(await trackBad()) && !(await bodyHas('答案來源重複')) && await noNote(), [await mainR(), await trackBad(), await shownR('.notice')]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十一-2", async () => {
  // 十一-2（覆核建議 2）：還原的未確認草稿等於伺服器確認 → 視為已確認並記下確認基線；伺服器其後換成新內容 → 頁面採用新內容
  fastPoll(); putConf({ 'next-action': NA_Y });
  await loadR(1200); await eR('localStorage.clear()'); await plant(unDraft(NA_Y)); await loadR();
  ok('十一-2：前提：還原的未確認草稿等於伺服器確認：已交付（連結），沒有「已還原……」', isLinkR(await mainR()) && !(await bodyHas(RESTORED)), [await mainR(), await shownR('.notice')]);
  putConf({ 'next-action': NA_Z });
  const adopted = await waitR(async () => { await openRestR(); return (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Z); }, 25000);
  ok('十一-2：伺服器其後換成新內容：頁面採用新內容', !!adopted, await shownR('[data-row="next-action"] .ed-val'));
  ok('十一-2：採用後是已交付（連結），沒有修改提示，不顯示舊內容', isLinkR(await mainR()) && await noNote() && !(await bodyHas(NA_Y)), [await mainR(), await shownR('.notice')]);
  // 反例：還原的草稿真的有未送出的修改（與伺服器不同）：伺服器其後再改，也不覆蓋本機修改
  const UNSENT = '十一輪測試：本機尚未確認、尚未送出的下一步';
  putConf({ 'next-action': NA_Y });
  await loadR(1200); await eR('localStorage.clear()'); await plant(unDraft(UNSENT)); await loadR();
  putConf({ 'next-action': NA_Z }); await sleep(7000); await openRestR();
  ok('十一-2：反例：還原的草稿有未送出的修改：伺服器改變也不覆蓋本機修改', (await shownR('[data-row="next-action"] .ed-val')).includes(UNSENT) && isReR(await mainR()), [await shownR('[data-row="next-action"] .ed-val'), await mainR()]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十一-3", async () => {
  // 十一-3（覆核建議 3）：採用伺服器新內容的條件只按內容判斷有沒有需要保護的修改；動過手但內容沒變、收起後留有殘字，都不擋採用
  fastPoll();
  // (a) 按「照現狀」（內容沒變）→ 另一個分頁答「改次序」改了伺服器
  putConf(BASE_CONF); await fresh9(); await openRestR();
  const had = await qokClick();
  ok('十一-3a：前提：按到「照現狀」，仍是已交付', had === true && isLinkR(await mainR()), { hadButton: had, main: await mainR() });
  const o0 = await orderOf();
  ok('十一-3a：前提：頁面次序是原次序', o0.join() === ids9.join(), o0);
  putConf(BASE_CONF, { order: swapped });
  const a1 = await waitR(async () => (await orderOf()).join() === swapped.join(), 25000);
  ok('十一-3a：按「照現狀」後，伺服器次序被另一個分頁改了：頁面採用新次序', !!a1, await orderOf());
  ok('十一-3a：採用後仍是已交付（連結），沒有「再確認一次」及修改提示', isLinkR(await mainR()) && await noNote(), [await mainR(), await shownR('.notice')]);
  await loadR(); await sleep(1500);
  ok('十一-3a（第十二輪加）：重新載入後仍是新次序、已交付，沒有提示', (await orderOf()).join() === swapped.join() && isLinkR(await mainR()) && await noNote(), [await orderOf(), await mainR()]);
  // (b) 在自行填寫框打字後按「收起」（殘字留在記憶體，看不見）
  putConf(BASE_CONF); await fresh9();
  await kR('#dq-goal-quarter .dq-foot .btn.small'); await sleep(300);
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value='十一輪測試：打了字但按了收起';t.dispatchEvent(new Event('input'));return true})()`);
  await kR('#dq-goal-quarter .p-foot .btn:not(.primary)'); await sleep(300);
  ok('十一-3b：前提：自行填寫框已收起，頁面是已交付', (await eR(`!document.querySelector('#dq-goal-quarter textarea')`)) && isLinkR(await mainR()), await mainR());
  await openRestR();
  putConf(BASE_CONF, { order: swapped });
  const b1 = await waitR(async () => (await orderOf()).join() === swapped.join(), 25000);
  ok('十一-3b：在自行填寫框打字後按「收起」，伺服器次序被改：頁面採用新次序', !!b1, await orderOf());
  ok('十一-3b：採用後是已交付（連結），沒有修改提示', isLinkR(await mainR()) && await noNote(), [await mainR(), await shownR('.notice')]);
  // (c) 反例：真的改了內容、尚未送出 → 伺服器改變也不覆蓋本機修改
  putConf(BASE_CONF); await fresh9(); await pickGoalR(); await openRestR();
  const myGoal = await shownR('#dq-goal-quarter .opt.cur');
  ok('十一-3c：前提：改了「目前目標」，大掣變「再確認一次」', isReR(await mainR()) && await bodyHas(SAYS), await mainR());
  putConf(BASE_CONF, { order: swapped });
  await sleep(8000);
  ok('十一-3c：反例：有未送出的修改時，伺服器次序改變不覆蓋本機：次序不變、改過的選項仍在、仍是「再確認一次」', (await orderOf()).join() === ids9.join() && (await shownR('#dq-goal-quarter .opt.cur')) === myGoal && isReR(await mainR()), [await orderOf(), await shownR('#dq-goal-quarter .opt.cur'), await mainR()]);
  // (d) 反例：改過內容、又按了「照現狀」（動過手）→ 內容仍與確認不同，不覆蓋
  await qokClick();
  putConf(BASE_CONF, { order: swapped.slice().reverse() });
  await sleep(8000);
  ok('十一-3d：反例：改過內容再按「照現狀」，伺服器再改：仍保留本機修改', (await shownR('#dq-goal-quarter .opt.cur')) === myGoal && isReR(await mainR()), [await shownR('#dq-goal-quarter .opt.cur'), await mainR()]);
  // (e) 0.39.0 舊草稿（沒有摘要）：按「照現狀」後伺服器改次序 → 採用（第十二輪起：舊草稿沒有基線而已送出，以伺服器為準）
  putConf(BASE_CONF);
  await loadR(1200); await eR('localStorage.clear()'); await plant(delivered39()); await loadR(); await openRestR();
  const had39b = await qokClick();
  putConf(BASE_CONF, { order: swapped });
  const e1 = await waitR(async () => (await orderOf()).join() === swapped.join(), 25000);
  ok('十一-3e：0.39.0 舊草稿（沒有摘要）按「照現狀」，伺服器次序被改：採用新次序，仍是已交付', had39b === true && !!e1 && isLinkR(await mainR()) && await noNote(), { hadButton: had39b, order: await orderOf(), main: await mainR() });
  // 第十二輪：採用後基線存入草稿，重新載入後仍是新次序、已交付（舊版採用只在記憶體，重新載入退回舊次序並提示內容不同）
  await loadR(); await sleep(1500);
  ok('十一-3e（第十二輪加）：重新載入後仍是新次序、已交付（連結），沒有提示', (await orderOf()).join() === swapped.join() && isLinkR(await mainR()) && await noNote(), { order: await orderOf(), main: await mainR() });
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十一-4", async () => {
  // 十一-4（覆核建議 4）：輸入中途伺服器內容改變，輸入框保持焦點及文字；只更新進度，不整頁重畫（第十二輪起大掣也不先改）
  fastPoll(); putConf({ 'next-action': NA_Y });
  await fresh9();
  await kR('#dq-goal-quarter .dq-foot .btn.small'); await sleep(300);
  const TYPED = '十一輪測試：創辦人正在打字，伺服器內容改變時不可失去焦點';
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value=${JSON.stringify(TYPED)};t.dispatchEvent(new Event('input'));t.focus();t.setSelectionRange(5,9);t.__keep=1;return true})()`);
  ok('十一-4：前提：輸入框有字、有焦點，大掣是連結（已交付）', (await eR(`document.activeElement===document.querySelector('#dq-goal-quarter textarea')`)) && isLinkR(await mainR()), await mainR());
  putConf({ 'next-action': NA_Z });
  await sleep(7000);   // 輪詢每 2 秒一次：足夠輪詢數次
  // 第十二輪：輸入中途只更新進度，大掣及底部列不改（舊斷言「大掣變再確認一次」已不適用：那樣大掣變了而沒有任何提示）；閒下來重畫時一併更新，見十二-6
  ok('十一-4：伺服器內容被別處改寫後，輸入中途大掣沒有改變（仍是連結），閒下來才更新', isLinkR(await mainR()), await mainR());
  const st = await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');return {same:!!t&&t.__keep===1,focused:!!t&&document.activeElement===t,value:t?t.value:null,sel:t?[t.selectionStart,t.selectionEnd]:null}})()`);
  ok('十一-4：輸入框仍是同一個、保持焦點，文字及游標位置沒有變', st.same && st.focused && st.value === TYPED && st.sel && st.sel[0] === 5 && st.sel[1] === 9, st);
  // 閒下來（清空、收起）之後才採用新內容並整頁重畫
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value='';t.dispatchEvent(new Event('input'))})()`);
  await kR('#dq-goal-quarter .p-foot .btn:not(.primary)'); await openRestR();
  const z = await waitR(async () => (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Z), 25000);
  ok('十一-4：閒下來之後採用伺服器的新內容，已交付（連結）', !!z && isLinkR(await mainR()), [await shownR('[data-row="next-action"] .ed-val'), await mainR()]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十一-5", async () => {
  // 十一-5（覆核建議 5，測試工具）：第九、十節選用的埠全部落在本組的埠段 [PORT + 10, PORT + SPAN) 之內，不落入下一組（舊分頁）的埠段
  const mine = Object.entries(USED_PORTS);
  trace('埠段：本組 ' + PORT + '–' + (PORT + SPAN - 1) + '（' + SPAN + ' 個）；第九、十節用 ' + mine.map(([k, v]) => k + '=' + v).join('、'));
  ok('十一-5：第九、十節用的 5 個埠（伺服器 3、瀏覽器 2）全在本組埠段內', mine.length === 5 && mine.every(([, p]) => p >= PORT + 10 && p < PORT + SPAN), { PORT, SPAN, mine });
  ok('十一-5：5 個埠各不相同', new Set(mine.map(([, p]) => p)).size === 5, mine);
  });

  /* ---------- 十二：第十二輪（單一持久基線 S.confirmed.digest：採用／保護只看「自上次同步後內容有沒有改」；基線存在草稿內，重新載入後仍在）---------- */
  trace('進入 十二：第十二輪頁面');
  const plantDraft39 = async () => { await loadR(1200); await eR('localStorage.clear()'); await plant(delivered39()); };   // 0.39.0 舊草稿（sent:true、沒有摘要）；內容同 BASE_CONF
  const orderIs = async o => (await orderOf()).join() === o.join();

  await sc("十二-1", async () => {
  // 十二-1（覆核必修 1，推演 R2）：0.39.0 舊草稿；頁面未開時伺服器改了次序，之後才打開 → 採用新次序、已交付，重新載入亦然；再確認的回覆不帶舊次序
  fastPoll(); putConf(BASE_CONF);
  await plantDraft39();
  putConf(BASE_CONF, { order: swapped });   // 頁面未開：另一個分頁／瀏覽器答了「改次序」
  await loadR(); await openRestR();
  ok('十二-1：頁面未開時伺服器改了次序：之後打開，採用新次序', await orderIs(swapped), await orderOf());
  ok('十二-1：已交付（連結），沒有「再確認一次」，沒有任何提示', isLinkR(await mainR()) && await noNote(), [await mainR(), await shownR('.notice')]);
  const d12 = await draftNow();
  ok('十二-1：基線存入草稿（八位十六進位摘要，已送出）', !!d12.confirmed && d12.confirmed.sent === true && /^[0-9a-f]{8}$/.test(String(d12.confirmed.digest || '')), d12.confirmed);
  await loadR(); await sleep(1500);
  ok('十二-1：重新載入後亦然：新次序、已交付、沒有提示', await orderIs(swapped) && isLinkR(await mainR()) && await noNote(), [await orderOf(), await mainR()]);
  await pickGoalR();
  const m121 = await replyR();
  ok('十二-1：之後改一項再確認，回覆帶新次序，不帶舊次序（不會把伺服器的次序撤回）', m121.order.join() === swapped.join(), m121.order);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十二-2", async () => {
  // 十二-2（推演 R3）：0.39.0 舊草稿；頁面開着時伺服器改了次序 → 採用；重新載入後仍是新次序、已交付
  fastPoll(); putConf(BASE_CONF);
  await plantDraft39(); await loadR(); await openRestR();
  ok('十二-2：前提：舊草稿內容同伺服器：已交付（連結），次序是原次序', isLinkR(await mainR()) && await orderIs(ids9), [await mainR(), await orderOf()]);
  putConf(BASE_CONF, { order: swapped });
  const a2 = await waitR(async () => await orderIs(swapped), 25000);
  ok('十二-2：頁面開着時伺服器改了次序：採用新次序，仍是已交付', !!a2 && isLinkR(await mainR()) && await noNote(), [await orderOf(), await mainR()]);
  await loadR(); await sleep(1500);
  ok('十二-2：重新載入後仍是新次序、已交付（連結），沒有提示', await orderIs(swapped) && isLinkR(await mainR()) && await noNote(), [await orderOf(), await mainR(), await shownR('.notice')]);
  // 0.39.0 舊草稿內容與伺服器不同（不只次序）：以伺服器為準（有意的行為改變；十-5a 同）
  putConf({ 'next-action': NA_Y, 'goal-quarter-due': '2026-11-27' });
  await plantDraft39(); await loadR(); await openRestR();
  ok('十二-2：舊草稿內容與伺服器不同：採用伺服器的內容，已交付', isLinkR(await mainR()) && (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Y) && await noNote(), [await mainR(), await shownR('[data-row="next-action"] .ed-val')]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十二-3", async () => {
  // 十二-3（推演 R7）：這部瀏覽器送出 A；本機改成 B（未送出）；另一部瀏覽器確認了 B；其後伺服器只改次序 → 採用；本機改回 A → 保護
  fastPoll(); putConf(BASE_CONF);
  const draftA = { edits: { 'next-action': NA_X, 'goal-quarter-due': '2026-11-27' }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name: 'a.md', sent: true, digest: dgOf(BASE_CONF) }, sent: { name: 'a.md', at: '2026-11-07T10:00:00+08:00' }, ok: {}, kinds: {} };
  await loadR(1200); await eR('localStorage.clear()'); await plant(draftA); await loadR(); await openRestR();
  ok('十二-3：前提：這部瀏覽器送出的 A 同伺服器：已交付', isLinkR(await mainR()), await mainR());
  const curIdx3 = await eR(`[...document.querySelectorAll('#dq-goal-quarter .opt')].findIndex(o=>o.classList.contains('cur'))`);
  await pickGoalR();
  ok('十二-3：前提：本機改成 B（未送出）：「再確認一次」及修改提示', isReR(await mainR()) && await bodyHas(SAYS), await mainR());
  const eB = (await draftNow()).edits;
  putConf(eB);   // 另一部瀏覽器確認了 B
  const gotB = await waitR(async () => isLinkR(await mainR()) && await noNote(), 25000);
  ok('十二-3：另一部瀏覽器確認了與本機相同的 B：已交付（連結），沒有提示', !!gotB, [await mainR(), await shownR('.notice')]);
  putConf(eB, { order: swapped });   // 其後伺服器只改了次序，內容仍是 B
  const gotZ = await waitR(async () => await orderIs(swapped), 25000);
  ok('十二-3：伺服器其後只改次序（內容仍是 B）：採用新次序（基線已移到 B，不再停在舊的 A），仍是已交付', !!gotZ && isLinkR(await mainR()) && await noNote(), [await orderOf(), await mainR()]);
  await eR(`document.querySelectorAll('#dq-goal-quarter .opt')[${curIdx3}].setAttribute('data-back','1')`); await kR('[data-back="1"]');
  ok('十二-3：本機再改回 A（不同於基線 B）：「再確認一次」及修改提示', isReR(await mainR()) && await bodyHas(SAYS), await mainR());
  putConf(eB, { order: swapped.slice().reverse() });
  await sleep(8000);
  ok('十二-3：本機有未送出的修改（改回 A）時，伺服器再改次序也不覆蓋：次序不變、仍是「再確認一次」', await orderIs(swapped) && isReR(await mainR()), [await orderOf(), await mainR()]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十二-4", async () => {
  // 十二-4（推演 R8）：套用失敗 → 伺服器其後有相同內容 → 伺服器再改次序 → 採用、已交付、沒有失敗卡；重新載入亦然
  putConf({ 'next-action': NA_Y });
  const draftX4 = { edits: { 'next-action': NA_X }, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name: 'r-x.md', sent: true, digest: dgOf({ 'next-action': NA_X }) }, sent: { name: 'r-x.md', at: '2026-11-07T10:00:00+08:00' }, ok: {}, kinds: {} };
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running')));
  await loadR(1200); await eR('localStorage.clear()'); await plant(draftX4); await loadR();
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('failed')));
  const f4 = await waitR(async () => isReR(await mainR()) && await trackBad());
  ok('十二-4：前提：套用失敗而伺服器仍是別的內容：「再確認一次」及失敗進度卡', !!f4, [await mainR(), await trackBad()]);
  putConf({ 'next-action': NA_X });   // 另一部瀏覽器確認了同一份
  const same4 = await waitR(async () => isLinkR(await mainR()), 25000);
  ok('十二-4：伺服器其後有相同內容：已交付，失敗進度卡不再顯示', !!same4 && !(await trackBad()), [await mainR(), await trackBad()]);
  putConf({ 'next-action': NA_X }, { order: swapped });   // 之後伺服器的次序被改
  const adopt4 = await waitR(async () => await orderIs(swapped), 25000);
  ok('十二-4：伺服器再改次序：採用新次序，已交付（連結），沒有失敗進度卡及失敗原因，沒有提示', !!adopt4 && isLinkR(await mainR()) && !(await trackBad()) && !(await bodyHas('答案來源重複')) && await noNote(), [await orderOf(), await mainR(), await trackBad()]);
  await loadR(); await sleep(1500);
  ok('十二-4：重新載入後亦然（失敗紀錄仍在伺服器最近五項）：新次序、已交付、沒有失敗進度卡', await orderIs(swapped) && isLinkR(await mainR()) && !(await trackBad()) && !(await bodyHas('答案來源重複')) && await noNote(), [await orderOf(), await mainR(), await trackBad()]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十二-5", async () => {
  // 十二-5（反例）：有未送出的修改時，伺服器改變不覆蓋，重新載入後仍不覆蓋；從未確認過、有本機修改的草稿不被覆蓋
  fastPoll(); putConf(BASE_CONF);
  await fresh9(); await pickGoalR(); await openRestR();
  const mine5 = await shownR('#dq-goal-quarter .opt.cur');
  putConf(BASE_CONF, { order: swapped });
  await sleep(8000);
  ok('十二-5：有未送出的修改時，伺服器改次序不覆蓋：次序不變、改過的選項仍在、仍是「再確認一次」', await orderIs(ids9) && (await shownR('#dq-goal-quarter .opt.cur')) === mine5 && isReR(await mainR()), [await orderOf(), await shownR('#dq-goal-quarter .opt.cur'), await mainR()]);
  await loadR(); await sleep(5000); await openRestR();
  ok('十二-5：重新載入後仍不覆蓋：次序不變、改過的選項仍在、仍是「再確認一次」及修改提示', await orderIs(ids9) && (await shownR('#dq-goal-quarter .opt.cur')) === mine5 && isReR(await mainR()) && await bodyHas(SAYS), [await orderOf(), await shownR('#dq-goal-quarter .opt.cur'), await mainR()]);
  // 從未確認過、有本機修改：伺服器出現確認也不覆蓋；重新載入亦然
  const UNSENT12 = '十二輪測試：從未確認過、本機尚未送出的下一步';
  putConf({ 'next-action': NA_Y });
  await loadR(1200); await eR('localStorage.clear()'); await plant(unDraft(UNSENT12)); await loadR();
  putConf({ 'next-action': NA_Z });
  await sleep(7000); await openRestR();
  ok('十二-5：從未確認過、有本機修改的草稿：伺服器改變不覆蓋', (await shownR('[data-row="next-action"] .ed-val')).includes(UNSENT12) && isReR(await mainR()), [await shownR('[data-row="next-action"] .ed-val'), await mainR()]);
  await loadR(); await sleep(5000); await openRestR();
  ok('十二-5：重新載入後亦然', (await shownR('[data-row="next-action"] .ed-val')).includes(UNSENT12) && isReR(await mainR()), [await shownR('[data-row="next-action"] .ed-val'), await mainR()]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十二-6", async () => {
  // 十二-6：輸入中途伺服器內容改變：大掣及底部列不改（只更新進度），閒下來重畫時一併更新
  fastPoll(); putConf({ 'next-action': NA_Y });
  await fresh9();
  await kR('#dq-goal-quarter .dq-foot .btn.small'); await sleep(300);
  const TYPED6 = '十二輪測試：創辦人正在打字，大掣不可先變';
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value=${JSON.stringify(TYPED6)};t.dispatchEvent(new Event('input'));t.focus();t.__keep=1;return true})()`);
  const bar0 = await eR(`document.querySelector('#cbar .prog-n')?.textContent||''`);
  ok('十二-6：前提：輸入框有字，大掣是連結（已交付），底部列寫已確認', isLinkR(await mainR()) && bar0 === N.ui.barConfirmed, [await mainR(), bar0]);
  putConf({ 'next-action': NA_Z });
  await sleep(7000);
  const bar1 = await eR(`document.querySelector('#cbar .prog-n')?.textContent||''`);
  const same6 = await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');return !!t&&t.__keep===1&&t.value===${JSON.stringify(TYPED6)}})()`);
  ok('十二-6：輸入中途伺服器內容改變：大掣仍是連結、底部列不變（不會變成沒有提示的「再確認一次」）', isLinkR(await mainR()) && bar1 === N.ui.barConfirmed, [await mainR(), bar1]);
  ok('十二-6：輸入框仍是同一個，文字沒有變', same6);
  await eR(`(()=>{const t=document.querySelector('#dq-goal-quarter textarea');t.value='';t.dispatchEvent(new Event('input'))})()`);
  await kR('#dq-goal-quarter .p-foot .btn:not(.primary)'); await openRestR();
  const z6 = await waitR(async () => (await shownR('[data-row="next-action"] .ed-val')).includes(NA_Z), 25000);
  ok('十二-6：閒下來之後採用新內容並重畫：大掣是連結（已交付），底部列寫已確認，沒有提示', !!z6 && isLinkR(await mainR()) && (await eR(`document.querySelector('#cbar .prog-n')?.textContent||''`)) === N.ui.barConfirmed && await noNote(), [await mainR(), await shownR('.notice')]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  /* ---------- 十三：第十三輪（基線只認「肯定已在 Zero 那裏」的內容：離線確認不是基線；套用失敗標記 unapplied；舊草稿載入時補基線）---------- */
  trace('進入 十三：第十三輪頁面');
  const DRAFTX13 = (name, edits) => ({ edits, order: ids9, openedPath: false, note: '', confirmed: { at: '2026 年 11 月 7 日 10:00', name, sent: true, digest: dgOf(edits) }, sent: { name, at: '2026-11-07T10:00:00+08:00' }, ok: {}, kinds: {} });
  const mineNA = async () => { await openRestR(); return shownR('[data-row="next-action"] .ed-val'); };

  await sc("十三-1", async () => {
  // 十三-1（第十二輪必修 1，推演 N1）：已與 Zero 同步 B；讀取狀態失敗時離線確認 X（只下載回覆檔，Zero 沒有收到）；重新載入、伺服器仍是 B → 保留 X，不被 B 覆蓋
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  putConf({ 'next-action': NA_Y });
  await setSt(null); await fresh9();
  ok('十三-1：前提：已與 Zero 同步 B（伺服器的確認）：已交付（連結）', isLinkR(await mainR()), await mainR());
  await pickGoalR();
  const goalX = await shownR('#dq-goal-quarter .opt.cur');
  await setSt('fail'); await loadR();
  await kR('#go-main'); await kR('#do-confirm'); await sleep(800);
  const dOff13 = await draftNow();
  ok('十三-1：前提：離線確認（讀取狀態失敗）只存摘要，沒有 sent', !!dOff13.confirmed && /^[0-9a-f]{8}$/.test(String(dOff13.confirmed.digest || '')) && !dOff13.confirmed.sent, dOff13.confirmed);
  await setSt(null); await loadR(); await sleep(14000);
  ok('十三-1：重新載入、伺服器仍是 B：保留離線確認的 X（目前目標的選項仍在），沒有被 B 覆蓋', (await shownR('#dq-goal-quarter .opt.cur')) === goalX, [await shownR('#dq-goal-quarter .opt.cur'), goalX]);
  ok('十三-1：大掣是「再確認一次」，不是連結；中性字句寫明內容與 Zero 已收到的不同', isReR(await mainR()) && await bodyHas(NEUTRAL), [await mainR(), await shownR('.notice')]);
  const dAfter13 = await draftNow();
  ok('十三-1：草稿仍保留 X 的修改，沒有被換成 B 的確認', !!dAfter13.edits && Object.keys(dAfter13.edits).some(k => k.startsWith('goal-quarter')) && !dAfter13.confirmed.sent, dAfter13);
  // 從未同步過的新瀏覽器（推演 N1b）
  await setSt(null); await loadR(1200); await eR('localStorage.clear()'); await setSt('fail'); await loadR();
  await pickGoalR();
  const goalX2 = await shownR('#dq-goal-quarter .opt.cur');
  await kR('#go-main'); await kR('#do-confirm'); await sleep(800);
  await setSt(null); await loadR(); await sleep(14000);
  ok('十三-1：新瀏覽器離線確認 X，重新載入、伺服器是 B：保留 X，「再確認一次」', (await shownR('#dq-goal-quarter .opt.cur')) === goalX2 && isReR(await mainR()), [await shownR('#dq-goal-quarter .opt.cur'), await mainR()]);
  await setSt(null);
  });

  await sc("十三-2", async () => {
  // 十三-2（第十二輪建議 1，推演 N2）：套用失敗 → 伺服器其後有相同內容 → 重新載入時伺服器已改次序 → 採用新次序、已交付、沒有失敗卡
  await setSt(null);
  putConf({ 'next-action': NA_Y });
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running')));
  await loadR(1200); await eR('localStorage.clear()'); await plant(DRAFTX13('r-x.md', { 'next-action': NA_X })); await loadR();
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('failed')));
  const f13 = await waitR(async () => isReR(await mainR()) && await trackBad());
  ok('十三-2：前提：套用失敗而伺服器仍是別的內容：「再確認一次」及失敗進度卡', !!f13, [await mainR(), await trackBad()]);
  putConf({ 'next-action': NA_X });   // 另一部瀏覽器確認了同一份
  const same13 = await waitR(async () => isLinkR(await mainR()) && !(await trackBad()), 25000);
  ok('十三-2：伺服器其後有相同內容：已交付，失敗進度卡不再顯示', !!same13, [await mainR(), await trackBad()]);
  const d132 = await draftNow();
  ok('十三-2：清除失敗紀錄（S.sent）已寫入草稿，不只在記憶體', d132.sent == null && !!d132.confirmed && d132.confirmed.sent === true && !d132.confirmed.unapplied, d132);
  await gR('about:blank', 1440, 600);   // 關閉頁面：之後伺服器才改次序，重新打開時才第一次讀到
  putConf({ 'next-action': NA_X }, { order: swapped });
  await loadR(); await sleep(1500);
  ok('十三-2：重新載入時伺服器已改次序（失敗紀錄仍在伺服器最近五項）：採用新次序', await orderIs(swapped), await orderOf());
  ok('十三-2：已交付（連結），沒有失敗進度卡及失敗原因，沒有「再確認一次」，沒有提示', isLinkR(await mainR()) && !(await trackBad()) && !(await bodyHas('答案來源重複')) && await noNote(), [await mainR(), await trackBad(), await shownR('.notice')]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十三-3", async () => {
  // 十三-3（第十二輪建議 2，推演 N3）：套用失敗 → 失敗紀錄跌出 /api/status 最近五項 → 仍保留送出的內容，不被伺服器覆蓋；重新載入亦然；不顯示「只下載了回覆檔」
  await setSt(null);
  putConf({ 'next-action': NA_Y });
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('running')));
  await loadR(1200); await eR('localStorage.clear()'); await plant(DRAFTX13('r-x.md', { 'next-action': NA_X })); await loadR();
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('failed')));
  const f133 = await waitR(async () => isReR(await mainR()) && await trackBad());
  ok('十三-3：前提：套用失敗而伺服器仍是別的內容：「再確認一次」及失敗進度卡', !!f133, [await mainR(), await trackBad()]);
  const d133 = await draftNow();
  ok('十三-3：套用失敗時基線標記為未套用（unapplied），sent 不變（所以不會顯示只下載了回覆檔）', !!d133.confirmed && d133.confirmed.unapplied === true && d133.confirmed.sent === true && !!d133.sent, d133.confirmed);
  ok('十三-3：套用失敗時沒有顯示「只下載了回覆檔」', !(await bodyHas('只下載了回覆檔')), await shownR('.notice'));
  fastPoll();   // 失敗紀錄不再出現在狀態內（模擬跌出最近五項）；別人的工作在進行，輪詢每 2 秒一次
  await waitR(async () => !(await trackBad()), 25000);
  await sleep(5000);
  ok('十三-3：失敗紀錄跌出狀態後：失敗進度卡消失，但保留送出的內容（下一個對外動作仍是 X），沒有被伺服器的 Y 覆蓋', !(await trackBad()) && (await mineNA()).includes(NA_X) && !(await mineNA()).includes(NA_Y), [await trackBad(), await mineNA()]);
  ok('十三-3：仍是「再確認一次」，不是連結；沒有「只下載了回覆檔」', isReR(await mainR()) && !(await bodyHas('只下載了回覆檔')), [await mainR(), await shownR('.notice')]);
  await loadR(); await sleep(12000);
  ok('十三-3：重新載入亦然：保留 X、「再確認一次」、沒有「只下載了回覆檔」', (await mineNA()).includes(NA_X) && !(await mineNA()).includes(NA_Y) && isReR(await mainR()) && !(await bodyHas('只下載了回覆檔')), [await mineNA(), await mainR()]);
  const d133b = await draftNow();
  ok('十三-3：草稿仍有 unapplied 標記及送出的內容', !!d133b.confirmed && d133b.confirmed.unapplied === true && (d133b.edits || {})['next-action'] === NA_X, d133b.confirmed);
  // 對照：這份內容其後真的進了 Zero（伺服器確認 X）→ 同步、unapplied 消失
  putConf({ 'next-action': NA_X });
  const sync133 = await waitR(async () => isLinkR(await mainR()), 25000);
  const d133c = await draftNow();
  ok('十三-3：對照：伺服器其後確認了 X：已交付（連結），基線移到快照並存入草稿，unapplied 消失', !!sync133 && !!d133c.confirmed && d133c.confirmed.sent === true && !d133c.confirmed.unapplied && d133c.confirmed.digest === dgOf({ 'next-action': NA_X }), d133c.confirmed);
  // 套用失敗而伺服器沒有任何確認（狀態表第二種情況）：失敗進度卡仍在、沒有中性字句，S.sent 保留
  fs.rmSync(CONF, { force: true });
  fs.writeFileSync(STATUS_R, JSON.stringify(runOf('failed')));
  await loadR(1200); await eR('localStorage.clear()'); await plant(DRAFTX13('r-x.md', { 'next-action': NA_X })); await loadR();
  ok('十三-3：套用失敗而伺服器對本頁從沒有確認：「再確認一次」、失敗進度卡在、沒有中性字句、沒有「只下載了回覆檔」', isReR(await mainR()) && await trackBad() && await bodyHas('答案來源重複') && await noNote() && !(await bodyHas('只下載了回覆檔')), [await mainR(), await trackBad(), await shownR('.notice')]);
  const d133d = await draftNow();
  ok('十三-3：同上：S.sent 保留，基線標記為未套用', !!d133d.sent && !!d133d.confirmed && d133d.confirmed.unapplied === true && d133d.confirmed.sent === true, d133d);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });

  await sc("十三-4", async () => {
  // 十三-4（第十二輪建議 3，推演 N4）：0.39.0 舊草稿（sent 為真、沒有摘要）；升級後首次讀取狀態失敗期間改了內容 → 重新載入、伺服器正常 → 保留修改，不被覆蓋
  await setSt(null);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  putConf(BASE_CONF);
  await plantDraft39();
  await setSt('fail'); await loadR();
  const dLoad = await draftNow();
  ok('十三-4：舊草稿載入時以當刻內容補作基線並存入草稿（八位十六進位摘要，sent 保留）', !!dLoad.confirmed && dLoad.confirmed.sent === true && /^[0-9a-f]{8}$/.test(String(dLoad.confirmed.digest || '')), dLoad.confirmed);
  await pickGoalR();
  const goal4 = await shownR('#dq-goal-quarter .opt.cur');
  await setSt(null);
  putConf(BASE_CONF, { order: swapped });   // 伺服器正常，內容與本機不同
  await loadR(); await sleep(14000);
  ok('十三-4：重新載入、伺服器正常：保留升級後才作的修改（目前目標的選項仍在），次序沒有被換成伺服器的', (await shownR('#dq-goal-quarter .opt.cur')) === goal4 && await orderIs(ids9), [await shownR('#dq-goal-quarter .opt.cur'), goal4, await orderOf()]);
  ok('十三-4：「再確認一次」，並提示確認後再作了修改', isReR(await mainR()) && await bodyHas(SAYS), [await mainR(), await shownR('.notice')]);
  // 對照：載入後沒有再改 → 照舊以伺服器為準（真實創辦人的舊草稿）
  await plantDraft39(); await setSt(null); await loadR(); await openRestR();
  ok('十三-4：對照：舊草稿載入後沒有再改，伺服器次序不同：採用伺服器（已交付，沒有提示）', await orderIs(swapped) && isLinkR(await mainR()) && await noNote(), [await orderOf(), await mainR()]);
  fs.writeFileSync(STATUS_R, JSON.stringify({ runs: [] }));
  });
} catch (e) { ok('第九輪頁面測試中斷', false, String(e && e.stack || e)); }
finally { if (cR) cR.close(); if (srvR) srvR.kill(); }

trace("進入 九-9：未能讀取附件的原因用固定字句（畫面不顯示 AI 寫的");
/* ---------- 九-9：未能讀取附件的原因用固定字句（畫面不顯示 AI 寫的原因） ---------- */
{
  const RZ = k => N.t(k, { page: N.ui.intakeTitle });   // 原因句帶頁名，由名稱表的 intakeTitle 填入
  const reasons = [['計劃書.docx', RZ('unreadReasonConvert')], ['簡報.PPTX', RZ('unreadReasonConvert')], ['數據.xlsx', RZ('unreadReasonConvert')], ['舊版.doc', RZ('unreadReasonOffice')], ['報告.pdf', RZ('unreadReasonPdf')], ['照片.png', RZ('unreadDefaultReason')], ['無副檔名', RZ('unreadDefaultReason')]];
  ok('九-9：按副檔名取固定原因（Office／PDF／其他）', typeof N.unreadReason === 'function' && reasons.every(([f, want]) => N.unreadReason(f) === want), reasons.map(([f]) => [f, N.unreadReason && N.unreadReason(f)]));
  ok('九-9：固定原因是書面語，用字檢查零命中，且不含口語', typeof N.unreadReason === 'function' && reasons.every(([f]) => N.styleIssues(N.t('unreadFileLine', { f, r: N.unreadReason(f) })).length === 0 && !/讀唔到|冇|唔/.test(N.unreadReason(f))), reasons.map(([f]) => N.styleIssues(N.t('unreadFileLine', { f, r: N.unreadReason && N.unreadReason(f) }))));
  const askSrc = fs.readFileSync(path.join(PROTO, 'ask.html'), 'utf8'), dashSrc = fs.readFileSync(path.join(PROTO, 'dashboard.html'), 'utf8');
  const askUses = askSrc.match(/unreadFileLine[^)]*N\.unreadReason\([^)]*\)/g) || [], askAll = askSrc.match(/unreadFileLine/g) || [], dashAll = dashSrc.match(/unreadFileLine/g) || [];
  ok('九-9：顯示位置（預填、回饋卡）都取固定原因，不取 AI 寫的 reason；真實進展頁只讀回饋卡，不另顯示原因', askUses.length >= 2 && askUses.length === askAll.length && dashAll.length === 0 && !/u\.reason/.test(askSrc) && !/u\.reason/.test(dashSrc), { askUses: askUses.length, askAll: askAll.length, dashAll: dashAll.length });
}
let cF = null;
try {
  fs.mkdirSync(DATAF, { recursive: true });
  srvF = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(P_SRVF)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATAF, SOS_ADAPTER: ADAPTER, CZ_NO_WELCOME: '1' }, stdio: 'ignore' });
  forgetPass(BASEF); await usePass(BASEF);
  let upF = false; for (let i = 0; i < 60 && !upF; i++) { try { upF = !!(await (await tfetch(BASEF + '/api/status', { signal: AbortSignal.timeout(3000) })).json()).ok; } catch { } if (!upF) await sleep(300); }
  ok('九-9：附件原因伺服器在預期的埠啟動', upF, BASEF);
  ok('九-9：假 AI 認證', (await certify(BASEF)).certify.state === 'passed');
  fs.writeFileSync(path.join(DATAF, 'fake-mode.txt'), 'prefill:prefill-unread-loose\n');
  cF = await openChrome(CHROME, path.join(OUT, 'profile-r9f'), P_CHRF);
  await usePass(BASEF, cF);
  await cF.send('DOM.enable');
  await cF.go(BASEF + '/#/intake', 1280, 2200);
  if (await cF.ev(`!!document.querySelector('#intake-anyway')`)) await cF.ev(`document.querySelector('#intake-anyway').click()`);
  const docx = path.join(OUT, '計劃書.docx'); fs.writeFileSync(docx, 'PK fake docx');
  const dom = await cF.send('DOM.getDocument', { depth: -1 });
  const inp = await cF.send('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '#intake-files' });
  await cF.send('DOM.setFileInputFiles', { nodeId: inp.nodeId, files: [docx] });
  await sleep(500);
  await cF.click('#pf-go');
  let t9 = null; for (let i = 0; i < 120 && !t9; i++) { t9 = await cF.ev(`document.querySelector('#pf-unread')?.innerText||''`); if (!t9) await sleep(500); }
  const want9 = N.t('unreadFileLine', { f: '計劃書.docx', r: N.unreadReason('計劃書.docx') });
  ok('九-9：假 AI 寫口語原因、加 files/、副檔名大小寫不同：畫面顯示固定的書面語原因', plain(t9 || '').replace(/\s+/g, '') === plain(want9).replace(/\s+/g, '') && !/讀唔到/.test(t9 || ''), t9);
  const st9 = await cF.ev(`document.querySelector('#pf-state')?.innerText||''`);
  ok('九-9：全部文件未能讀取：預填結果不說成「文件未有」', plain(st9).includes(plain(N.ui.prefillAllUnread)) && !/文件未有/.test(st9), st9);
  ok('九-9：頁面沒有錯誤', cF.errors.length === 0, cF.errors);
} catch (e) { ok('第九輪附件原因測試中斷', false, String(e && e.stack || e)); }
finally { if (cF) cF.close(); if (srvF) srvF.kill(); }

trace("進入 四：核對規則（company-page-check.mjs）");
/* ---------- 四：核對規則（company-page-check.mjs） ---------- */
try {
  const clone = x => JSON.parse(JSON.stringify(x));
  const good = loadFixture('goal-dates-repro-structured.js');
  const rows = p => p.glance.rows, g1 = p => rows(p).find(r => r.plan === 'G1'), g2 = p => rows(p).find(r => r.plan === 'G2');
  ok('四：已合格的資料（結構化重現）沒有日期次序問題', chk.dateOrderIssues(good).length === 0, chk.dateOrderIssues(good));
  for (const f of ['sample-company-page.js', 'goal-dates-repro-structured.js']) ok('四：現有合格資料 ' + f + ' 仍然通過就緒核對', chk.checkCompanyPage(clone(loadFixture(f)), { ready: true }).ok, chk.checkCompanyPage(clone(loadFixture(f)), { ready: true }).errors);
  const ex = JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures', 'example-company-page-full.json'), 'utf8'));
  ok('四：給 AI 的完整範例 G2 有獨立期限、內容不寫日期', chk.dateOrderIssues(ex).length === 0 && !!g2(ex).due, chk.dateOrderIssues(ex));
  const legacy = loadFixture('goal-dates-repro.js');
  const li = chk.dateOrderIssues(legacy);
  ok('四：G2 沒有期限欄被找出', li.some(x => x.includes('沒有獨立期限')), li);
  ok('四：內容以日期開頭被找出', li.some(x => x.includes('內容以日期開頭')), li);
  const full = clone(good); g1(full).value += '（2026-12-01 前）';
  ok('四：G1 內容含完整日期被找出', chk.dateOrderIssues(full).some(x => x.includes('內容寫了日期') && x.includes('目前目標')), chk.dateOrderIssues(full));
  const g6 = clone(good); g6.glance.rows.push({ id: 'g6', plan: 'G6', label: '負責人', kind: 'text', value: '工具建構：我自己及某人（2026 年 11 月 6 日已答應加入）', origin: 'ai' });
  ok('四：G6 內容中間含合理的事實日期，不報告', chk.dateOrderIssues(g6).length === 0, chk.dateOrderIssues(g6));
  const g3 = clone(good); g3.glance.rows.push({ id: 'g3', plan: 'G3', label: '怎樣才算有進展', kind: 'text', value: '至 12 月 4 日：有人書面答覆', origin: 'ai' });
  ok('四：G3 內容以日期開頭仍被找出', chk.dateOrderIssues(g3).some(x => x.includes('內容以日期開頭')), chk.dateOrderIssues(g3));
  const late = clone(good); g2(late).due.value = '2027-02-01';
  ok('四：G2 期限遲於 G1 期限被找出', chk.dateOrderIssues(late).some(x => x.includes('遲於')), chk.dateOrderIssues(late));
  const tent = clone(good); g1(tent).due.value = '2026-11-20';
  ok('四：暫定覆核日遲於 G1 期限被找出', chk.dateOrderIssues(tent).some(x => x.includes('暫定值的覆核日遲於')), chk.dateOrderIssues(tent));
  const r1 = chk.checkCompanyPage(clone(legacy), { ready: true }), r2 = chk.checkCompanyPage(clone(legacy), { ready: false });
  ok('四：就緒核對把上述問題列為錯誤（叫 AI 修正一次）', !r1.ok && r1.errors.some(x => x.includes('沒有獨立期限')), r1.errors);
  ok('四：修正後仍有問題時不阻校對（非就緒核對照樣通過）', r2.ok, r2.errors);
  // 六：覆審修正（核對器）
  const withRow = (plan, value, extra = {}) => { const p = clone(good); const r = p.glance.rows.find(x => x.plan === plan) || (p.glance.rows.push({ id: 'x-' + plan, plan, label: plan, kind: 'text', value: '', origin: 'ai' }), p.glance.rows[p.glance.rows.length - 1]); r.value = value; Object.assign(r, extra); return p; };
  ok('六-6：G1 內容寫「12 月 4 日前」（無年份）被找出', chk.dateOrderIssues(withRow('G1', '兩間農場在 12 月 4 日前書面答覆')).some(x => x.includes('目前目標') && x.includes('內容寫了日期')), chk.dateOrderIssues(withRow('G1', '兩間農場在 12 月 4 日前書面答覆')));
  ok('六-6：G2 內容寫「（12 月 4 日前）」被找出', chk.dateOrderIssues(withRow('G2', '取得書面答覆（12 月 4 日前）')).some(x => x.includes('短期目標') && x.includes('內容寫了日期')));
  ok('六-6：G3 以「至 2026-12-04：」開頭被找出', chk.dateOrderIssues(withRow('G3', '至 2026-12-04：有人付款')).some(x => x.includes('內容以日期開頭')));
  ok('六-6：G3 以「2026-12-04：」（無前綴）開頭被找出', chk.dateOrderIssues(withRow('G3', '2026-12-04：有人付款')).some(x => x.includes('內容以日期開頭')));
  ok('六-6：G3、G6 中間的事實日期仍不報告', chk.dateOrderIssues(withRow('G3', '有人付款（12 月 4 日前）')).length === 0 && chk.dateOrderIssues(withRow('G6', '工具建構：某人（2026 年 11 月 6 日已答應加入）')).length === 0);
  const inv1 = clone(good); inv1.glance.rows.find(r => r.plan === 'G1').due.value = '2026-02-30';
  ok('六-2：G1 期限為不存在的日子被找出', chk.dateOrderIssues(inv1).some(x => x.includes('不是存在的日子') && x.includes('2026-02-30')), chk.dateOrderIssues(inv1));
  const inv2 = clone(good); inv2.glance.rows.find(r => r.plan === 'G2').due.value = '2026-02-30';
  ok('六-2：G2 期限為不存在的日子被找出', chk.dateOrderIssues(inv2).some(x => x.includes('不是存在的日子')));
  const inv3 = clone(good); inv3.glance.rows.find(r => r.plan === 'G3').tentative = { by: 'ai', until: '2026-02-30', test: '測試' };
  ok('六-2：暫定覆核日為不存在的日子被找出', chk.dateOrderIssues(inv3).some(x => x.includes('覆核日不是存在的日子')));
  ok('六-2：validDay 只認存在的日子', chk.validDay('2028-02-29') && !chk.validDay('2027-02-29') && !chk.validDay('2026-13-01') && !chk.validDay('2026-02-30'));
  const inv4 = chk.checkCompanyPage(clone(inv3), { ready: false });
  ok('六-2：規整會把不存在的覆核日改為合法日子', inv4.ok && chk.validDay(inv4.page.glance.rows.find(r => r.plan === 'G3').tentative.until), inv4.errors);
} catch (e) { ok('核對測試中斷', false, String(e && e.stack || e)); }

for (const x of results) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.name + (x.pass ? '' : '\n      ' + String(JSON.stringify(x.info)).slice(0, 900)));
const pass = results.filter(x => x.pass).length;
console.log(`\n${pass}/${results.length} passed`);
setTimeout(() => process.exit(pass === results.length ? 0 : 1), 500);
