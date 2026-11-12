// 規劃書 v1.6.2 TEST-CASES 3.1／3.2：自足檢查同證據級名稱（隔離資料夾、假 AI：改寫交唔出 → 機械步）
// 用法：node plain-test.mjs <輸出資料夾> <原型資料夾> <假 adapter>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [OUT, PROTO, ADAPTER] = process.argv.slice(2);
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const imp = f => import(pathToFileURL(path.join(PROTO, f)).href);
const P = await imp('plain-lib.mjs'), A = await imp('ask-lib.mjs'), SC = await imp('style-check.mjs');
const N = A.NAMES;
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
const MARK = '〔含內部用語〕';
try {
  /* ---------- 1. 機械步（單元） ---------- */
  const ctx = { claims: { B1: '有餐廳願意付較高價錢' }, routes: { S2: '先辦試食會' }, assumptions: { H1: '餐廳願意為來源付錢' }, tasks: { t5: '約見三間餐廳' }, milestones: { m2: '首張訂單' }, attacks: { R1: '餐廳只看價錢' } };
  const src = '建議以 S2 為主線，先處理 H1 同 B1（R1 已回應）；跟進 t5，目標 m2；證據二級、3 級、said；見 §3.2 及 plan.md；founderAction 欄；10-29 前完成；R99 查不到；D20 查不到。';
  const out = P.deCode(src, ctx);
  ok('查得到嘅編號換成名稱或標題（路線、假設、論點、攻擊、工作、站點）', /「先辦試食會」路線/.test(out) && /假設「餐廳願意為來源付錢」/.test(out) && /論點「有餐廳願意付較高價錢」/.test(out) && /紅方攻擊「餐廳只看價錢」/.test(out) && /工作「約見三間餐廳」/.test(out) && /站點「首張訂單」/.test(out), out);
  ok('級數同機器值換成五級名稱、數字縮寫日期寫完整', /「實際行動」/.test(out) && /「付出成本」/.test(out) && /「口頭表示」/.test(out) && /10 月 29 日/.test(out) && !/二級|3 級|\bsaid\b|10-29/.test(out), out);
  ok('查唔到嘅編號同英文欄位名原樣保留，該行加「含內部用語」標記；章節符號同檔名清走（主線 2026-10-28：畫面唔顯示檔名同 §）', /R99/.test(out) && /D20/.test(out) && !/§/.test(out) && !/plan\.md/.test(out) && /見相關章節/.test(out) && /founderFrom|founderAction/.test(out) && out.endsWith(MARK), out);
  const row = P.deCode('| 農場甲 | 接觸餐廳 | 商議中（有人講過） | 你原話（farm-notes.md §3）：「農場甲 仍有意 S2 嘅做法」；10-27 開會 |', ctx);
  ok('表格逐格：狀態欄舊證據級名稱換五級名稱、出處括號入面嘅檔名同 § 刪走、原話引號內一字不改、引號外短日期寫完整', /商議中（口頭表示）/.test(row) && /你原話：「農場甲 仍有意 S2 嘅做法」/.test(row) && /10 月 27 日 ?開會/.test(row) && !/operating-direction|§/.test(row), row);
  const dup = P.deCode('證據級為口頭表示（有人講過）；有人做過；未有人講過', ctx);
  ok('「你原話」標籤前緊貼嘅原話引號唔改，括號入面出處照清', P.deCode('次序是「先向伙伴 pitching，再揀餐廳」（你原話 plan.md §2）', ctx) === '次序是「先向伙伴 pitching，再揀餐廳」（你原話）');
  ok('級數只喺證據級語境換：「同一級別」「最輕的採購級別」保持原樣', P.deCode('其後每年一萬亦在同一級別', ctx) === '其後每年一萬亦在同一級別' && P.deCode('以最輕的採購級別處理', ctx) === '以最輕的採購級別處理');
  ok('舊證據級名稱：重複嘅括號刪走，其餘換五級名稱', dup === '證據級為口頭表示；實際行動；假設', dup);
  const col = P.deCode('## 一句話講盤生意\n最弱三個位：揀最平嘅做法，連住成盤生意都諗過，佢而家冇時間', ctx);
  ok('口語字有書面語代稱就換（名稱表 COLLOQUIAL_ALIAS），唔加標記', col === '## 一句話說明這門生意\n最薄弱的三個環節：選成本最低的做法，連接整體生意都想過，他目前沒有時間', col);
  ok('引號入面引述嘅原文唔當 AI 腔', P.issuesOf('目的是「以科技賦能教育」。').length === 0 && P.issuesOf('我們以科技賦能教育。').length === 1);
  const own = '你原話：先做 S2，H1 二級。';
  ok('創辦人原話嘅行唔掃、唔改', P.deCode(own, ctx) === own && P.scanText(own).length === 0);
  const j = P.deCodeJSONInfo({ id: 'B1', claim: '跟進 t5', source: '你原話 · plan.md §2', founder: { evidence: [{ text: 'H1 已有人講過', grade: 'said' }] } }, ctx);
  ok('JSON：機器欄位同 founder 欄唔改，文字欄位換名稱', j.value.id === 'B1' && j.value.source === '你原話 · plan.md §2' && j.value.founder.evidence[0].text === 'H1 已有人講過' && j.value.founder.evidence[0].grade === 'said' && /工作「約見三間餐廳」/.test(j.value.claim), j.value);
  ok('改寫句核對：多咗原句冇嘅數字、聲稱字句或者太長 → 唔過', !P.rewriteOk('約見餐廳', '約見三間餐廳，已簽約') && !P.rewriteOk('約見 3 間餐廳', '約見 5 間餐廳') && !P.rewriteOk('短句', '短句'.repeat(20)) && P.rewriteOk('以 S2 為主線', '以「先辦試食會」為主線', ctx));
  ok('證據級：機器值、數字、舊字眼都顯示五級名稱', ['guess', 'said', 'did', 'paid', 'stuck', 0, 2, '有人講過', '口頭表示'].map(N.evName).join() === '假設,口頭表示,實際行動,付出成本,形成依賴,假設,實際行動,口頭表示,口頭表示' && N.evKey('實際行動') === 'did');
  ok('名稱表固定字串：零口語字、零內部編號、零級數或機器值', Object.entries(N.dash).concat(Object.entries(N.ui)).filter(([k, v]) => typeof v === 'string' && N.styleIssues(v).some(i => ['colloquial', 'code', 'section', 'date', 'field', 'level'].includes(i.kind))).length === 0,
    Object.entries(N.dash).concat(Object.entries(N.ui)).filter(([k, v]) => typeof v === 'string' && N.styleIssues(v).some(i => ['colloquial', 'code', 'section', 'date', 'field', 'level'].includes(i.kind))).slice(0, 8));

  /* ---------- 2. 命令入口交包：命中即退回 ---------- */
  const bad = { format: 'startup-os.ask/0.1', title: '確認路線', questions: [{ id: 'q1', ask: '以 S2 做主線，H1 去到二級未？', kind: 'choice', options: [{ text: '是' }, { text: '否' }], value: '否', why: '見 plan.md' }] };
  const r1 = A.preparePacks(bad, { strictTitle: true });
  ok('命令入口：題目含代號、級數、檔名 → 退回並講原因', !r1.ok && r1.errors.some(e => /S2/.test(e) && /H1/.test(e)) && r1.errors.some(e => /plan\.md/.test(e)), r1);
  const r2 = A.preparePacks({ ...bad, questions: [{ ...bad.questions[0], ask: '你原話：「以 S2 做主線」。是否維持？', why: '決定下一步' }] }, { strictTitle: true });
  ok('命令入口：標「你原話」嘅句唔掃', r2.ok, r2);

  /* ---------- 3. 一般 AI 工作產出：改寫後仍命中 → 機械替換、標記 ---------- */
  const o = path.join(OUT, 'out'); fs.mkdirSync(o, { recursive: true });
  fs.writeFileSync(path.join(o, 'receipt.json'), JSON.stringify({ summary: '已更新 t5 的草稿；R99 待處理', artifacts: [{ file: 'a.md', title: '草稿' }], founderNext: [] }));
  fs.writeFileSync(path.join(o, 'a.md'), '# 草稿\n\n跟進 t5，目標 m2。\n\n參考 §4。\n');
  const fx = SC.fixOutput(o, ctx);
  const rc = JSON.parse(fs.readFileSync(path.join(o, 'receipt.json'), 'utf8')), md = fs.readFileSync(path.join(o, 'a.md'), 'utf8');
  ok('一般工作：收據同產出查得到嘅編號換名稱，查唔到嘅標記，章節符號清走', /工作「約見三間餐廳」/.test(rc.summary) && rc.summary.endsWith(MARK) && /站點「首張訂單」/.test(md) && /參考相關章節。/.test(md) && !/§/.test(md) && fx.marked.length === 1, { rc, md, fx });

  /* ---------- 4. 試驗資料夾顯示用版本（外殼 --plain；假 AI 交唔出 → 機械步、health.warnings） ---------- */
  const DATA = path.join(OUT, 'data'), TRIAL = path.join(OUT, 'trial');
  fs.mkdirSync(path.join(TRIAL, 'wargame'), { recursive: true });
  fs.writeFileSync(path.join(TRIAL, '05-假設清單.md'), '# 假設清單\n\n| 編號 | 假設 | 來源 |\n|---|---|---|\n| H1 | 餐廳願意為來源付錢 | AI 解讀 |\n');
  fs.writeFileSync(path.join(TRIAL, '01-生意體檢.md'), '# 測試生意體檢\n\n## 最弱位置\n\n### 價錢\n\n H1 仍是零級；建議 S1；見 §2.1 及 notes.md。\n\n你原話：H1 先做。\n');
  fs.writeFileSync(path.join(TRIAL, 'wargame', 'blue.json'), JSON.stringify({ thesis: '以 S1 為主線', claims: [{ id: 'B1', claim: '餐廳肯付錢（H1）', evidence: 1, source: '你原話 · plan.md' }], strategies: [{ id: 'S1', name: '先辦試食會', summary: '先 B1 後 R7' }] }));
  fs.mkdirSync(path.join(DATA, 'founder', 'desk'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'founder', 'desk', 'brain-source-20261028-100000-000.json'), JSON.stringify({ dir: TRIAL }));
  await kit.certifyDirect(DATA, PROTO, ADAPTER);
  const before = fs.readFileSync(path.join(TRIAL, '01-生意體檢.md'), 'utf8');
  const res = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--plain'], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, encoding: 'utf8', timeout: 120000 });
  const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'display', 'index.json'), 'utf8'));
  const dmd = fs.readFileSync(path.join(DATA, 'display', 'source', '01-生意體檢.md'), 'utf8'), dblue = JSON.parse(fs.readFileSync(path.join(DATA, 'display', 'source', 'wargame', 'blue.json'), 'utf8'));
  ok('原檔唔郁（試驗資料夾只讀）', fs.readFileSync(path.join(TRIAL, '01-生意體檢.md'), 'utf8') === before);
  ok('顯示用版本：假設同路線換名稱、級數換名稱、章節同檔名清走；原話唔改', /假設「餐廳願意為來源付錢」 ?仍是「假設」/.test(dmd) && /「先辦試食會」路線/.test(dmd) && /見相關章節 及 相關文件。/.test(dmd) && !/notes\.md|§/.test(dmd) && /你原話：H1 先做。/.test(dmd), dmd);
  ok('紅藍對打檔：論點同路線換名稱，查唔到嘅攻擊編號保留並標記；來源欄唔改', /「先辦試食會」路線/.test(dblue.thesis) && /假設「餐廳願意為來源付錢」/.test(dblue.claims[0].claim) && /R7/.test(dblue.strategies[0].summary) && dblue.strategies[0].summary.endsWith(MARK) && dblue.claims[0].source === '你原話 · plan.md', dblue);
  ok('索引記錄模式同標記數', idx['source/01-生意體檢.md'].mode === 'fallback' && idx['source/01-生意體檢.md'].marked === 0 && idx['source/wargame/blue.json'].marked >= 1, idx);
  const st = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
  ok('health.warnings 有「AI 文字含內部用語：<項目名稱>」（唔用檔名）', (st.health && st.health.warnings || []).includes(N.dash.warnCode.replace('{name}', '紅藍對打藍方')) && !st.health.warnings.some(w => /生意體檢/.test(w)) && !st.health.warnings.some(w => /\.(md|json)/.test(w)), st.health);
  const res2 = spawnSync(process.execPath, [path.join(PROTO, 'run.mjs'), '--plain'], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, encoding: 'utf8', timeout: 120000 });
  const st2 = JSON.parse(fs.readFileSync(path.join(DATA, 'ledger', 'state.json'), 'utf8'));
  ok('重跑：原檔冇改就略過，警告唔重複', JSON.stringify(st2.health) === JSON.stringify(st.health) && res2.status === 0, st2.health);
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 1500));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
}
