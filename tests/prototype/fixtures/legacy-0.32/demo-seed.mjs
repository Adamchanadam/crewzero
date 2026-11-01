// startup-os 營運監察台：虛構示範資料（從田間到餐桌）。只寫示範資料夾，唔會郁創辦人用緊嘅 data/。
// 用法：node demo-seed.mjs [示範資料夾] [--reset]；ask.mjs --dashboard --demo 會自動叫（未有示範資料先建）。
// 帳本（ledger/state.json）保留相對時間，監察台讀嘅時候按今日推算；問題包、紀錄、產出喺建立時換成實際日子。
// AI 設定（只限 ask.mjs 開示範時，copyCert）：如果 data/ 已經認證咗 AI 工具，抄一份認證過去，示範入面試兩個新入口時唔使再認證（認證只關 AI 工具嘅啟動設定，同資料夾無關）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTimes } from './dash-lib.mjs';
import { loadMatch, adoptionPacks } from './debate-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, 'fixtures', 'demo-farm');
export const DEMO_DIR = path.join(ROOT, 'demo-data');

const write = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); };

const ARTIFACTS = {
  'R-demo-a': { label: '擬好農場合作一頁簡介', summary: '按農場甲會面紀錄擬好一頁簡介，待你驗收。', file: 'farm-brief.md', title: '農場合作一頁簡介',
    text: '# 從田間到餐桌 · 農場合作簡介\n\n**我們做甚麼**：把本地小農的當季蔬菜直送注重來源的中小型餐廳。\n\n| 項目 | 安排 |\n|---|---|\n| 每週採購量 | 首月每週約 120 公斤葉菜及根莖類 |\n| 付款 | 月結，收貨後 30 日內付款 |\n| 送貨 | 每週兩次，清晨收貨 |\n| 獨家 | 不設獨家 |\n\n## 下一步\n\n- 農場丙確認每週可供應量\n- 簽供應協議（**要確認**：首月價格）\n' },
  'R-demo-b': { label: '擬好農場甲供應協議草稿', summary: '按會面紀錄擬好協議草稿，已由你接受。', file: 'farm-a-agreement.md', title: '農場甲供應協議草稿',
    text: '# 供應協議草稿（農場甲）\n\n1. 供應期：首三個月，期滿再議。\n2. 數量：每週兩次，每次按前一日訂單。\n3. 價格：按當週市價，每月檢討一次。\n4. 付款：月結。\n5. 不設獨家。\n' },
  'R-demo-c': { label: '整理牌照要求查詢清單', summary: '列出三類可能需要的牌照及查詢方法；建議先查牌照再買保險。', file: 'licence-checklist.md', title: '牌照要求查詢清單（初稿）',
    text: '# 牌照要求查詢清單（初稿）\n\n> 以下由 AI 整理，**要確認**：以發牌機關答覆為準。\n\n| 類別 | 要問的問題 | 查詢方法 |\n|---|---|---|\n| 食物業相關牌照 | 只做配送、不做加工，是否需要牌照？ | 致電發牌機關查詢熱線 |\n| 車輛 | 私家車送貨是否需要另外登記？ | 運輸部門網頁 |\n| 保險 | 第三者及貨物保險的最低保額 | 向兩間保險公司索取報價 |\n' }
};

export function seedDemo(dir = DEMO_DIR, { reset = false, now = new Date(), copyCert = false } = {}) {
  const cert = path.join(ROOT, 'data', 'ledger', 'adapter-cert.json');
  if (fs.existsSync(path.join(dir, 'ledger', 'state.json')) && !reset) {
    // 示範已經有：真實資料後來先認證 AI 工具嘅話，補抄認證
    if (copyCert && fs.existsSync(cert) && !fs.existsSync(path.join(dir, 'ledger', 'adapter-cert.json'))) fs.copyFileSync(cert, path.join(dir, 'ledger', 'adapter-cert.json'));
    return { created: false, dir };
  }
  if (reset && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  for (const d of ['founder/inbox', 'founder/replies', 'founder/desk', 'company', 'archive', 'ledger/answers', 'asks', 'sandbox', 'work']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  // 帳本：保留相對時間
  fs.copyFileSync(path.join(FIX, 'state.json'), path.join(dir, 'ledger', 'state.json'));
  // 公司概覽同成頁確認（次序照附錄 C 更正句：農場、牌照、試單、送貨、四週）
  const page = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'example-company-page.json'), 'utf8'));
  page.page.preparedAt = resolveTimes('@-26d', now);
  write(path.join(dir, 'company', 'page.json'), page);
  const values = {};
  (function walk(o) { if (Array.isArray(o)) return o.forEach(walk); if (!o || typeof o !== 'object') return; if (typeof o.id === 'string' && 'value' in o && 'label' in o) values[o.id] = String(o.value); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); })(page);
  write(path.join(dir, 'ledger', 'confirmed.json'), { company: page.company.name, pageId: page.page.id, confirmedAt: resolveTimes('@-25d 22:10', now), replyFile: 'demo', order: ['m1', 'm4', 'm2', 'm3', 'm5'], orderChanged: true, nextActionMilestone: 'm1', edits: [], stillMissing: [], note: '', values });
  // 問題包
  for (const p of resolveTimes(JSON.parse(fs.readFileSync(path.join(FIX, 'asks.json'), 'utf8')), now)) write(path.join(dir, 'asks', p.id + '.json'), p);
  // 生意大腦（六項）：紅藍對打用同真實試驗一樣嘅三個檔；reveal.json 令示範由建立嗰刻起按秒數逐步出現
  fs.cpSync(path.join(FIX, 'brain'), path.join(dir, 'brain'), { recursive: true });
  write(path.join(dir, 'brain', 'brain.json'), resolveTimes(JSON.parse(fs.readFileSync(path.join(FIX, 'brain', 'brain.json'), 'utf8')), now));
  write(path.join(dir, 'brain', 'reveal.json'), { ...JSON.parse(fs.readFileSync(path.join(FIX, 'brain', 'reveal.json'), 'utf8')), seededAt: now.toISOString() });
  // 紅藍對打第 1 場（全場＋轉強）：日子按今日推算；「採用轉強」問題包由同一套規則出（debate-lib）
  for (const f of fs.readdirSync(path.join(FIX, 'brain', 'wargame')).filter(f => f.endsWith('.json'))) write(path.join(dir, 'brain', 'wargame', f), resolveTimes(JSON.parse(fs.readFileSync(path.join(FIX, 'brain', 'wargame', f), 'utf8')), now));
  const d1 = loadMatch({ data: dir }, { kind: 'demo', dir: path.join(dir, 'brain') }, 'D1', { now });
  for (const [i, p] of adoptionPacks(d1).entries()) write(path.join(dir, 'asks', 'ask-demo-strengthen' + (i ? '-' + (i + 1) : '') + '.json'), { ...p, id: 'ask-demo-strengthen' + (i ? '-' + (i + 1) : ''), askedBy: 'AI', askedAt: resolveTimes('@-1d 21:20', now), fromRun: null, todoType: 'decision', questions: p.questions.map((q, k) => ({ ...q, kind: q.kind || 'choice', effect: q.effect || 'tentative', priority: q.priority || k + 1 })) });
  // 情景演練場景（兩個虛構對象，證明換對象都用得）
  for (const f of fs.readdirSync(path.join(FIX, 'practice'))) write(path.join(dir, 'practice', 'scenarios', f), resolveTimes(JSON.parse(fs.readFileSync(path.join(FIX, 'practice', f), 'utf8')), now));
  // 產出（監察台「產出物件」可以打開睇）
  for (const [id, a] of Object.entries(ARTIFACTS)) {
    write(path.join(dir, 'work', id, a.file), a.text);
    write(path.join(dir, 'work', id, 'receipt.json'), { summary: a.summary, artifacts: [{ file: a.file, title: a.title }], founderNext: [] });
    write(path.join(dir, 'work', id, 'run.json'), { id, kind: 'demo', label: a.label });
  }
  // 決定紀錄
  const at = s => resolveTimes(s, now);
  const log = [
    { at: at('@-25d 22:10'), source: 'proofread', packId: page.page.id, packTitle: '公司概覽', qid: 'order', question: '里程碑路線次序', ai: '農場簽約 → 餐廳試單 → 首條送貨路線 → 牌照保險 → 連續四週', answer: '農場簽約 → 牌照保險 → 餐廳試單 → 首條送貨路線 → 連續四週', changed: true, effect: 'now' },
    { at: at('@-25d 22:10'), source: 'proofread', packId: page.page.id, packTitle: '公司概覽', qid: 'rest', question: 'AI 已擬好的其他內容', ai: '', answer: '採用建議（暫定，到期再問）', changed: false, effect: 'tentative' },
    { at: at('@-18d 20:40'), source: 'ask', packId: 'ask-demo-exclusive', packTitle: '農場甲的獨家要求', qid: 'exclusive', question: '農場甲要求獨家供應，接受嗎？', ai: '不接受', answer: '不接受', changed: false, effect: 'now' },
    { at: at('@-18d 20:41'), source: 'ask', packId: 'ask-demo-accept-a', packTitle: '驗收：農場甲供應協議草稿', qid: 'accept', question: '協議草稿可以用嗎？', ai: '接受', answer: '接受', changed: false, effect: 'now' },
    { at: at('@-10d 09:15'), source: 'ask', packId: 'ask-demo-route0', packTitle: '農場乙退出後的路線', qid: 'route', question: '農場乙退出，先以兩個農場試做兩週嗎？', ai: '採用', answer: '採用', changed: false, effect: 'now' }
  ];
  write(path.join(dir, 'ledger', 'decisions.jsonl'), log.map(e => JSON.stringify(e)).join('\n') + '\n');
  if (copyCert && fs.existsSync(cert)) fs.copyFileSync(cert, path.join(dir, 'ledger', 'adapter-cert.json'));
  return { created: true, dir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv.slice(2).find(a => !a.startsWith('--')) || DEMO_DIR;
  const r = seedDemo(path.resolve(dir), { reset: process.argv.includes('--reset') });
  console.log(r.created ? '已建立示範資料：' + r.dir : '示範資料已存在：' + r.dir + '（加 --reset 重建）');
}
