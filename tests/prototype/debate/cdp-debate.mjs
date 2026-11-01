// 辯論舞台＋轉強瀏覽器測試同截圖（假 AI、示範資料）：舞台各區、關鍵時刻、身份篩選、重播、深連、冇回覆盒、手機；Founder Desk 開一場 → 場次頁 → 回應 → 採用／再攻
// 用法：node cdp-debate.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port> [截圖資料夾]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { usePass } from '../lib/testkit.mjs';
const [CHROME, OUT, PROTO, ADAPTER, PORT, SHOTS] = process.argv.slice(2);
const results = []; const ok = (n, p, i) => results.push({ name: n, pass: !!p, info: p ? undefined : i });
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const DATA = path.join(OUT, 'data');
const { seedDemo } = await import(pathToFileURL(path.join(PROTO, 'demo-seed.mjs')).href);
const kit = await import(new URL('../lib/testkit.mjs', import.meta.url).href);
seedDemo(DATA, { reset: true });
await kit.certifyDirect(DATA, PROTO, ADAPTER);
const rvf = path.join(DATA, 'brain', 'reveal.json'), rv = JSON.parse(fs.readFileSync(rvf, 'utf8')); rv.seededAt = new Date(Date.now() - 900000).toISOString(); fs.writeFileSync(rvf, JSON.stringify(rv));
const BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', PORT], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER }, stdio: 'ignore' });
await usePass(BASE);
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/status')).ok) break; } catch { } await sleep(250); }
const c = await openChrome(CHROME, path.join(OUT, 'profile'), 9471);
await usePass(BASE, c);
const { ev, go, click, shot } = c;
const has = sel => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const count = sel => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const text = sel => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
async function waitFor(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { } await sleep(400); } return null; }
const S = (name, sel, opts) => SHOTS ? shot(path.join(SHOTS, `${name}-${c.width()}.png`), sel, opts) : null;
const fnv = s => { let x = 0x811c9dc5; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return ('0000000' + x.toString(16)).slice(-8); };
async function answer(packId, values) {
  const { pack } = await (await fetch(BASE + '/api/ask?id=' + packId)).json();
  const answers = pack.questions.map(q => ({ id: q.id, value: q.id in values ? values[q.id] : q.value, ai: q.value, changed: q.id in values && values[q.id] !== q.value }));
  const machine = { format: 'startup-os.ask-reply/0.1', pack: pack.id, confirmedAt: new Date().toISOString(), batch: answers.map(a => a.id), answers };
  const t = ['kind: ask-answer', 'ref: ' + pack.id, 'option: confirm', 'rev: 1', 'hash: ' + fnv(JSON.stringify(pack)), 'batch: false', 'shownAt: ' + new Date().toISOString()].join('\n') + '\n\n# 答案\n\n```json\n' + JSON.stringify(machine) + '\n```\n';
  return fetch(BASE + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ kind: 'ask-answer', ref: pack.id, text: t }) });
}
const matchApi = async id => (await (await fetch(BASE + '/api/debate/match?id=' + id)).json()).match;

try {
  /* ---------- 監察台：辯論舞台（示範第 1 場；新版紅藍對打分頁分上半場辯論、下半場轉強，論點同轉強卡逐張展開） ---------- */
  for (const w of [1440, 390]) {
    await go(BASE + '/dashboard/brain/wargame', w, 2200);
    if (w === 1440) {
      ok('舞台頭：第 1 場、題目、待你採用、辯論結果不是證據', /第 1 場/.test(await text('#b-wargame .mhead')) && (await text('#b-wargame .mhead')).includes('辯論結果不是證據'), await text('#b-wargame .mhead'));
      ok('進度：藍方 → 紅方 → 藍方反駁 → 裁判 → 轉強 → 再攻 → 待你採用', (await count('#wg-stages .stg')) === 7 && (await count('#wg-stages .stg.done')) === 6, await text('#wg-stages'));
      ok('記分牌：企得住 2 · 受傷 3 · 倒下 1、企得住率、命中率、證據分佈、核實', (await text('#scoreboard')).replace(/\s+/g, '').includes('2企得住3受傷1倒下') && (await text('#scoreboard')).includes('58%') && (await text('#scoreboard')).includes('78%') && (await count('#scoreboard .evbar i')) === 3 && (await text('#scoreboard')).includes('✓ 1'), await text('#scoreboard'));
      ok('裁判總評', (await text('#scoreboard')).includes('裁判總評'));
      ok('五個關鍵時刻（一擊倒下、最傷、盲點、反轉、遺漏的路線）', (await ev(`[...document.querySelectorAll('#key-moments .km .km-k')].map(x=>x.innerText).join()`)) === '一擊倒下,最傷,盲點,反轉,遺漏的路線');
      // 論點預設一次展開一條；撳「全部展開」先數得齊攻擊、反駁
      await click('#wg-all');
      ok('對攻列：六條論點、九條攻擊、三條反駁、六個印章', (await count('#wargame .claim')) === 6 && (await count('#wargame .wc.blue')) === 6 && (await count('#wargame .atk')) === 9 && (await count('#wargame .reb')) === 3 && (await count('#wargame .c-sum .stamp')) === 6,
        { claim: await count('#wargame .claim'), blue: await count('#wargame .wc.blue'), atk: await count('#wargame .atk'), reb: await count('#wargame .reb'), stamp: await count('#wargame .c-sum .stamp') });
      ok('攻擊有身份、嚴重程度、成立與否；見到甚麼證據會推翻可以展開', (await ev(`[...document.querySelectorAll('#wargame .atk')].every(a=>a.querySelector('.who')&&a.querySelector('.more'))`)));
      ok('重判同你挑戰裁判有標示', (await text('#wargame')).includes('重判') && (await text('#wargame')).includes('你挑戰裁判'));
      ok('最傷第 3 位：AI 已經查了（收起可展開）', (await count('#b-wargame [data-row="risk3"] details.aich')) === 1);
      await S('s01-stage-top', '#b-wargame', { maxH: 1250 });
      // 關鍵時刻：撳一擊倒下 → 去返嗰條論點
      await click('#key-moments .km[data-kind="一擊倒下"]');
      ok('撳關鍵時刻：去返嗰條論點並亮起', await waitFor(() => ev(`(()=>{const e=document.querySelector('#wargame [data-row="B4"]');const r=e.getBoundingClientRect();return e.classList.contains('lit')&&r.top>0&&r.top<900})()`), 3000));
      // 身份篩選（全部展開先睇得到每條攻擊）
      await click('#seat-bar [data-seat="投資者"]');
      // 讀回重畫可能啱啱換走個掣（撳中舊掣冇效）：未生效就再撳一次，等席位視角出現先讀
      if (!(await waitFor(() => ev(`!!document.querySelector('#seat-bar [data-seat="投資者"][aria-pressed="true"]')`), 2000))) await click('#seat-bar [data-seat="投資者"]');
      await waitFor(() => ev(`!!document.querySelector('#seat-view')`), 3000);
      ok('只睇投資者：席位視角、攻擊只剩投資者、其餘論點變淡', await has('#seat-view') && (await text('#seat-view')).includes('最在意') && (await ev(`[...document.querySelectorAll('#wargame .atk .who')].every(x=>x.innerText==='投資者')`)) && (await count('#wargame .claim.dim')) === 4,
        { dim: await count('#wargame .claim.dim'), who: await ev(`[...document.querySelectorAll('#wargame .atk .who')].map(x=>x.innerText).join()`) });
      await S('s02-seat-view', '#seat-bar', { height: 1100 });
      await click('#seat-bar .chipb');
      ok('全部身份：恢復', !(await has('#seat-view')) && (await count('#wargame .atk')) === 9);
      // 下半場：轉強卡，撳「全部展開」
      await click('#half-strengthen');
      await click('#tc-all');
      ok('轉強卡四張：修正、反轉做優勢、先驗證、接受並監察；有改前改後、再攻印章', (await ev(`[...document.querySelectorAll('#tcards .tcard .hchip')].map(x=>x.innerText).join()`)) === '修正,反轉做優勢,先驗證,接受並監察' && (await count('#tcards .ba-r')) === 3 && (await count('#tcards .rea-r .stamp')) === 4,
        { h: await ev(`[...document.querySelectorAll('#tcards .tcard .hchip')].map(x=>x.innerText).join()`), ba: await count('#tcards .ba-r'), rea: await count('#tcards .rea-r .stamp') });
      ok('轉強卡：必須先問、你原話、新賣點、14 日內測試', (await text('#tcards')).includes('必須先問') && (await text('#tcards')).includes('你原話') && (await text('#tcards')).includes('新賣點或合作機會') && (await text('#tcards')).includes('兩星期內測試'));
      ok('測試由誰做（AI 自己做、要你做、要你批准）、AI 已經查了（收起可展開）', (await text('#tcards')).includes('AI 自己做') && (await text('#tcards')).includes('要你批准') && (await count('#tcards details.aich')) === 1 && (await text('#tcards details.aich summary')).includes('AI 已經查了：1 項'));
      ok('你的回應：三個表態、挑戰裁判', (await text('#b-wargame .fresp')).includes('同意裁判') && (await text('#b-wargame .fresp')).includes('你挑戰裁判'));
      ok('生意模式修訂草案：三格改動', (await count('#model-revision .mcell')) === 3);
      await ev(`[...document.querySelectorAll('#b-wargame details.aich')].forEach(d => d.open = true)`); await S('s03-strengthen', '#tcards', { height: 2400 });
      await S('s04-model-revision', '#model-revision');
      ok('入口：採用轉強深連 Founder Desk 問題包、再打一場', (await ev(`document.querySelector('#wg-adopt').getAttribute('href')`)) === '/#/ask/ask-demo-strengthen' && (await ev(`document.querySelector('#wg-rematch').getAttribute('href')`)) === '/#/debate/new');
      ok('冇回覆盒（只有意見一句同深連）', (await count('#b-wargame textarea')) === 0);
      // 重播（上半場）：自動播放 → 開頭全部收埋，逐幕出現；下一幕；跳到結果
      await click('#half-debate');
      await click('#replay');
      await sleep(300);
      const hidden0 = await count('#b-wargame [data-act].hide');
      await sleep(1600);
      await S('s05-replay', '#b-wargame', { maxH: 1100 });
      const hidden1 = await count('#b-wargame [data-act].hide');
      ok('重播：開頭收埋、逐幕出現', hidden0 > 20 && hidden1 < hidden0, { hidden0, hidden1 });
      await click('#replay-end');
      ok('跳到結果：全部出返', (await count('#b-wargame [data-act].hide')) === 0);
      await click('#replay-next');
      await sleep(2200);
      ok('下一幕：只出藍方', (await count('#wargame .wc.blue.hide')) === 0 && (await count('#wargame .atk.hide')) === 9, { b: await count('#wargame .wc.blue.hide'), a: await count('#wargame .atk.hide') });
      await click('#replay-next'); await sleep(2800);
      ok('再下一幕：紅方出現、反駁未出', (await count('#wargame .atk.hide')) === 0 && (await count('#wargame .reb.hide')) === 3);
      await click('#replay-end');
    } else {
      ok('手機闊度：冇橫向溢出', await ev('document.documentElement.scrollWidth <= 392'), await ev('document.documentElement.scrollWidth'));
      ok('手機：每格有方位標記（藍方／紅方／裁判）', await ev(`getComputedStyle(document.querySelector('#wargame .wc .side')).display !== 'none'`));
      await S('s01-stage-top', '#b-wargame', { maxH: 2600 });
      await click('#half-strengthen');
      ok('手機：下半場冇橫向溢出', await ev('document.documentElement.scrollWidth <= 392'), await ev('document.documentElement.scrollWidth'));
      await ev(`[...document.querySelectorAll('#b-wargame details.aich')].forEach(d => d.open = true)`); await S('s03-strengthen', '#tcards', { height: 4600 });
    }
  }
  /* ---------- Founder Desk：首頁卡、開一場 ---------- */
  await go(BASE + '/', 1440, 1800);
  ok('首頁有紅藍對打卡（最新一場、開一場辯論）', await waitFor(() => ev(`!!document.querySelector('#debate-card #hub-debate-match')`), 5000) && await has('#hub-debate-new'));
  await go(BASE + '/#/debate/new', 1440, 1800);
  ok('開一場：六種題目、預設五席、力度三級、回合同預計', (await count('#dt-types .chip')) === 6 && (await count('#dt-seats [data-seat]')) === 5 && (await count('#dt-levels .chip')) === 3 && (await text('#debate-form')).includes('約 7 次 AI'));
  await S('f01-new', '#debate-form');
  await click('#dt-types [data-type="pricing"]');
  ok('揀定價：席位換成定價預設、改為快打', await waitFor(() => ev(`document.querySelectorAll('#dt-seats [data-seat]').length===4 && document.querySelector('#debate-form').innerText.includes('快打')`), 4000));
  await click('#dt-seats [data-seat="投資者"]');
  ok('撳一下取消一席', await waitFor(() => ev(`document.querySelectorAll('#dt-seats [data-seat]').length===3`), 4000));
  await c.type('#dt-seat-add', '連鎖餐廳採購');
  await click('#dt-seat-add-btn');
  ok('加一席', await waitFor(() => ev(`!!document.querySelector('#dt-seats [data-seat="連鎖餐廳採購"]')`), 4000));
  await click('#dt-levels [data-level="hard"]');
  await c.type('#dt-title', '每週訂菜收費：同價、月結');
  await go(BASE + '/#/debate/new/pricing', 390, 1800);
  await S('f01-new', '#debate-form');
  ok('手機：開一場冇橫向溢出', await ev('document.documentElement.scrollWidth <= 392'));
  await go(BASE + '/#/debate/new/pricing', 1440, 1800);
  await c.type('#dt-title', '每週訂菜收費：同價、月結');
  await click('#dt-start');
  const stageLink = await waitFor(() => ev(`(document.querySelector('#debate-go-match')||{}).getAttribute&&document.querySelector('#debate-go-match').getAttribute('href')`), 30000);
  ok('開打：外殼開場，出場次頁同舞台連結', !!stageLink && await has('#debate-go-stage'), stageLink);
  const mid = stageLink && stageLink.split('/').pop();
  await go(BASE + '/#/debate/' + mid, 1440, 1500);
  const done = await waitFor(async () => { await go(BASE + '/#/debate/' + mid, 1440, 1200); return has('#dm-respond'); }, 60000);
  ok('場次頁：完場顯示回應這場（三題）', done && (await text('#dm-respond')).includes('回應這場'));
  ok('場次頁：進度、記分、關鍵時刻', (await count('#dm-steps li')) === 7 && (await text('#debate-match')).includes('記分') && (await count('#dm-moments li')) === 3);
  await S('f02-match-done', '#debate-match');
  // 回應（照裁判）→ 轉強 → 再攻 → 等你採用
  const m = await matchApi(mid);
  await answer(m.packs.response, {});
  const adopt = await waitFor(async () => { const x = await matchApi(mid); return x.phase === 'adopt' ? x : null; }, 60000);
  ok('回應之後：AI 轉強、再攻一輪、等你採用', !!adopt && adopt.strengthen.rounds === 1);
  await go(BASE + '/#/debate/' + mid, 1440, 1600);
  await waitFor(() => has('#dm-adopt'), 8000);
  ok('場次頁：採用轉強深連、紅方再攻第二輪掣', (await ev(`document.querySelector('#dm-adopt').getAttribute('href')`)).startsWith('#/ask/') && await has('#dm-reattack') && (await count('#dm-cards li')) >= 2);
  await S('f03-match-adopt', '#debate-match');
  await go(BASE + '/#/debate/' + mid, 390, 1600);
  await S('f03-match-adopt', '#debate-match');
  ok('手機：場次頁冇橫向溢出', await ev('document.documentElement.scrollWidth <= 392'));
  await go(BASE + '/#/debate/' + mid, 1440, 1600);
  await click('#dm-reattack');
  ok('再攻第二輪：每張卡兩個印章', !!(await waitFor(async () => { const x = await matchApi(mid); return x.strengthen.rounds === 2 && !x.next; }, 40000)));
  // 監察台預選呢一場：用 Founder Desk 舞台連結（新版去紅藍對打分頁 ?match=）；兩場可以切換、較上場
  await go(BASE + '/#/debate/' + mid, 1440, 1600);
  const stageHref = await waitFor(() => ev(`(document.querySelector('#debate-go-stage')||{}).getAttribute&&document.querySelector('#debate-go-stage').getAttribute('href')`), 8000);
  await go(BASE + (stageHref || '/dashboard/brain/wargame?match=' + mid), 1440, 2600);
  ok('監察台：由場次頁跳嚟預選呢一場、有場次切換', (await count('#match-bar .chipb')) === 2 && /第 2 場/.test(await text('#b-wargame .mhead')), { stageHref, head: await text('#b-wargame .mhead') });
  ok('監察台：第一場定價唔同成盤生意比（冇較上場）', !(await text('#scoreboard')).includes('較上場'));
  await click('#half-strengthen');
  await click('#tc-all');
  ok('第二輪再攻印章顯示', (await count('#tcards .rea-r')) >= 4);
  await S('s06-match2', '#b-wargame', { maxH: 1300 });
  await click('#match-bar [data-match="D1"]');
  ok('切換返第 1 場', await waitFor(() => ev(`/第 1 場/.test(document.querySelector('#b-wargame .mhead').innerText)`), 4000));
  ok('冇頁面程式錯誤', c.errors.length === 0, c.errors);
} catch (err) {
  ok('測試冇出錯', false, String(err.stack || err));
} finally {
  c.close(); srv.kill();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  for (const r of results) if (!r.pass) console.log(JSON.stringify(r).slice(0, 700));
  console.log(`PASS ${results.filter(r => r.pass).length} / ${results.length}`);
  process.exit(0);
}
