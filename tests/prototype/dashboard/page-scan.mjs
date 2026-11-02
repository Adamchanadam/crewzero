// 畫面文字掃描（Founder Desk 同營運監察台全部頁面、問題包、場次）：
// 逐個文字節點掃（包括收起咗嘅內容、表格每一格、title／aria-label／placeholder 提示），用 names.js 嘅 styleIssues
// （口語字、內部代號、章節符號、不完整日期、英文欄位名、級數同機器值、舊證據級名稱、內部術語），
// 另加四類直接比對：舊證據級名稱、檔名（.md／.json）、§、短日期（數字-數字）。命中逐行列出內容。
// 用法：node page-scan.mjs <chrome> <base> <原型資料夾> <輸出 json> <profile> [chrome port] [預填編號]
// 有預填編號（資料夾 ledger/prefill/ 入面嘅一份）就另外掃交資料頁嘅預填狀態：待確認標籤、出處、「用這句」建議。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
const [CHROME, BASE, PROTO, OUT, PROFILE, CPORT = '9487', PREFILL = ''] = process.argv.slice(2);
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const c = await openChrome(CHROME, PROFILE, Number(CPORT));
const report = [];
const MARK = '〔含內部用語〕';
const KINDS = ['colloquial', 'code', 'section', 'date', 'level', 'field', 'jargon'];
const EXTRA = [['old-level', /未有人講過|有人講過|有人做過|有人付出代價|冇咗會痛/g], ['file', /[^\s，。、；：「」（）()]+\.(?:md|json)\b/g], ['section', /§/g], ['short-date', /(?<!\d{4}-)\b\d{1,2}-\d{1,2}\b(?!-\d)/g]];
// 分類：product（產品文字，要零）；own（「你原話」之後引號內嘅原話）；marked（4.10 (3) 照放並標記嘅格）
function classify(text, term) {
  if (text.includes(MARK)) return 'marked';
  const at = text.indexOf(term), i = text.indexOf('你原話');
  if (i >= 0 && at > i) for (const m of text.matchAll(/「[^」]*」/g)) if (m.index > i && at >= m.index && at < m.index + m[0].length) return 'own';
  // 標籤前面緊貼嘅原話引號（「……」（你原話……））
  for (const m of text.matchAll(/「[^」]*」(?=\s*[（(]\s*你原話)/g)) if (at >= m.index && at < m.index + m[0].length) return 'own';
  return 'product';
}
async function scan(url, label, act) {
  await c.go(BASE + url, 1440, 2600);
  if (act) { await c.ev(act); await sleep(700); }
  // 打開全部收起嘅內容
  await c.ev(`(()=>{document.querySelectorAll('details').forEach(d=>d.open=true);['#wg-all','#tc-all'].forEach(s=>{const b=document.querySelector(s);if(b&&!/收起|逐張/.test(b.textContent))b.click()})})()`);
  await sleep(400);
  const texts = await c.ev(`(()=>{const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;
    const leaf=e=>!e.querySelector('script,style,div,section,ul,ol,table,dl,main,header,nav');
    while((n=w.nextNode())){const p=n.parentElement;if(!p||p.closest('script,style,noscript,template'))continue;const blk=p.closest('li,td,th,p,h1,h2,h3,h4,h5,dd,dt,small,span,b,strong,em,a,button,label,summary,figcaption');const t=((blk&&leaf(blk)?blk.textContent:n.nodeValue)||'').replace(/\\s+/g,' ').trim();if(t)out.push(t)}
    document.querySelectorAll('[title],[aria-label],[placeholder]').forEach(e=>['title','aria-label','placeholder'].forEach(a=>{const v=e.getAttribute(a);if(v&&v.trim())out.push('［'+a+'］'+v.trim())}));
    return [...new Set(out)]})()`);
  const hits = [], seen = new Set();
  for (const t of texts) {
    const issues = N.styleIssues(t).filter(i => KINDS.includes(i.kind)).map(i => ({ kind: i.kind, term: i.term }))
      // AI 腔只計 AI 自己寫嘅字：引號入面引述嘅原文唔計
      .concat(N.styleIssues(t.replace(/「[^」]*」|“[^”]*”/g, '「」')).filter(i => i.kind === 'tone').map(i => ({ kind: 'tone', term: i.term })));
    for (const [k, re] of EXTRA) { re.lastIndex = 0; let m; while ((m = re.exec(t))) issues.push({ kind: k, term: m[0] }); }
    for (const i of issues) {
      const key = i.kind + '|' + i.term + '|' + t.slice(0, 200);
      if (seen.has(key)) continue; seen.add(key);
      hits.push({ ...i, line: t.slice(0, 220), cat: classify(t, i.term) });
    }
  }
  // 同一句會喺外層同內層節點各出一次：只留最短嗰行
  const best = new Map();
  for (const h of hits) { const k = h.kind + '|' + h.term + '|' + h.cat; const cur = best.get(k + '|' + h.line.slice(0, 20)); if (!cur || h.line.length < cur.line.length) best.set(k + '|' + h.line.slice(0, 20), h); }
  const list = [...best.values()];
  report.push({ page: label || url, hits: list });
  const n = cat => list.filter(h => h.cat === cat).length;
  console.log((label || url).padEnd(34), '產品文字', n('product'), `（原話 ${n('own')} · 已標含內部用語 ${n('marked')}）`);
  for (const h of list.filter(h => h.cat !== 'own')) console.log('   -', h.cat === 'marked' ? '[已標記]' : '[命中]', h.kind, '「' + h.term + '」', '｜', h.line.slice(0, 160));
}
try {
  const dash = ['/dashboard', '/dashboard/brain', '/dashboard/brain/checkup', '/dashboard/brain/wargame', '/dashboard/brain/scenario', '/dashboard/brain/opportunities', '/dashboard/brain/routes', '/dashboard/brain/pipeline', '/dashboard/path', '/dashboard/inputs', '/dashboard/team', '/dashboard/log', '/dashboard/system'];
  for (const u of dash) await scan(u);
  await scan('/dashboard/brain/wargame', '/dashboard/brain/wargame（下半場）', `(document.querySelector('#half-strengthen')||{click(){}}).click()`);
  await scan('/dashboard/path', '/dashboard/path（時間線）', `(document.querySelector('#view-timeline')||{click(){}}).click()`);
  const desk = ['/', '/#/intake', '/#/setup', '/#/log', '/#/debate', '/#/debate/new', '/#/request/order', '/#/request/adhoc', '/#/request/event', '/proofread.html'];
  for (const u of desk) await scan(u, '', u === '/#/intake' ? `(document.querySelector('#intake-anyway')||{click(){}}).click()` : '');
  // 交資料頁預填狀態：草稿指向一份已完成嘅預填，第 2 題當創辦人已寫（出「用這句」建議）；已有公司概覽就先按「重新提交」
  if (/^[\w-]{1,40}$/.test(PREFILL)) await scan('/#/log', '/#/intake（由文件預填）', `(async()=>{localStorage.setItem('startup-os-intake-draft',JSON.stringify({q2:'我們按月收費。',_prefill:{id:${JSON.stringify(PREFILL)},st:{}}}));location.hash='#/intake';await new Promise(r=>setTimeout(r,1500));const setup=document.querySelector('#intake-anyway');if(setup){setup.click();await new Promise(r=>setTimeout(r,800));}const b=document.querySelector('#reintake');if(b){b.click();await new Promise(r=>setTimeout(r,1500));}await new Promise(r=>setTimeout(r,2500));return !!document.querySelector('.pf-row:not(:empty)')})()`);
  const asks = (await (await fetch(BASE + '/api/asks')).json()).packs.filter(p => p.open).map(p => p.id).slice(0, 8);
  for (const id of asks) await scan('/#/ask/' + id);
  const ms = ((await (await fetch(BASE + '/api/debate')).json()).matches || []).map(m => m.id);
  for (const id of ms) await scan('/#/debate/' + id);
  const count = cat => report.reduce((n, r) => n + r.hits.filter(h => h.cat === cat).length, 0);
  const total = count('product'), marked = count('marked');
  fs.writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), total, marked, report }, null, 1));
  console.log('合計：產品文字命中', total, '· 已標含內部用語', marked, '· 原話', count('own'), '· 程式錯誤', JSON.stringify(c.errors));
} finally { c.close(); }
