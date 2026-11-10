// CrewZero 營運監察台：虛構示範資料（月月鮮烘）。只寫示範資料夾，唔會郁創辦人用緊嘅 data/。
// 用法：node demo-seed.mjs [示範資料夾] [--reset]；ask.mjs --dashboard --demo 會自動叫（未有示範資料先建）。
// 帳本（ledger/state.json）保留相對時間，監察台讀嘅時候按今日推算；問題包、紀錄、產出喺建立時換成實際日子。
// AI 設定（只限 ask.mjs 開示範時，copyCert）：如果 data/ 已經認證咗 AI 工具，抄一份認證過去，示範入面試兩個新入口時唔使再認證（認證只關 AI 工具嘅啟動設定，同資料夾無關）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTimes } from './dash-lib.mjs';
import { loadMatch, adoptionPacks } from './debate-lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, 'fixtures', 'demo-shop');
export const DEMO_DIR = path.join(ROOT, 'demo-data');

const write = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)); };

const ARTIFACTS = {
  'R-demo-a': { label: '擬好工房合作一頁簡介', summary: '按工房甲會面紀錄擬好一頁簡介，待你驗收。', file: 'roaster-brief.md', title: '工房合作一頁簡介',
    text: '# 月月鮮烘 · 工房合作簡介\n\n**我們做甚麼**：把本地小型烘焙工房的新鮮咖啡豆，每月配好寄到愛喝咖啡的上班族家中。\n\n| 項目 | 安排 |\n|---|---|\n| 首月供貨安排 | 先試供兩批，按首月訂閱量備貨 |\n| 每週取豆 | 每週一次固定時間上門取豆 |\n| 付款 | 月結，收貨後 30 日內付款 |\n| 寄送 | 烘焙後三日內由我方包裝寄出，附烘焙日期 |\n| 獨家 | 不設獨家 |\n\n## 下一步\n\n- 工房丙確認首份三個月供貨協議\n- 簽供貨協議（**要確認**：首月價格）\n' },
  'R-demo-b': { label: '擬好工房甲供貨協議草稿', summary: '按會面紀錄擬好協議草稿，已由你接受。', file: 'roaster-a-agreement.md', title: '工房甲供貨協議草稿',
    text: '# 供貨協議草稿（工房甲）\n\n1. 供應期：首三個月，期滿再議。\n2. 數量：每月按訂閱量供貨，先完成兩批試供。\n3. 價格：按當月生豆價，每月檢討一次。\n4. 付款：月結。\n5. 不設獨家。\n' },
  'R-demo-c': { label: '整理收款及寄送查詢清單', summary: '列出三類開放訂閱前要辦妥的事項及查詢方法；建議先申請收款服務，再開速遞帳戶。', file: 'payment-shipping-checklist.md', title: '收款及寄送查詢清單（初稿）',
    text: '# 收款及寄送查詢清單（初稿）\n\n> 以下由 Zero 整理，**要確認**：以服務商答覆為準。\n\n| 類別 | 要問的問題 | 查詢方法 |\n|---|---|---|\n| 網上收款服務 | 審批需要甚麼文件、需時多久？ | 向兩間收款服務商查詢 |\n| 速遞月結帳戶 | 每月最低寄件量及收費？ | 速遞公司網頁 |\n| 商業登記 | 網店名稱是否需要另行登記？ | 商業登記處網頁 |\n' }
};

// 實際位置：路徑未存在時，取最近一個已存在的上層的實際位置，再接回其餘部分（連結亦按實際指向計算）
function realOf(p) {
  let cur = path.resolve(p); const rest = [];
  while (!fs.existsSync(cur)) { const up = path.dirname(cur); if (up === cur) break; rest.unshift(path.basename(cur)); cur = up; }
  let r = cur; try { r = fs.realpathSync.native(cur); } catch { }
  r = path.join(r, ...rest);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}
// 位置核對（任何寫入之前，路徑未存在亦然）：連結、真實資料夾（本程式的 data/）及其上下層一律拒絕
export function assertDemoPlace(dir) {
  const st = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (st && st.isSymbolicLink()) throw new Error('示範資料夾不可以是連結，已停止：' + dir);
  const real = realOf(dir), data = realOf(path.join(ROOT, 'data'));
  // 用 path.relative 判斷相同、在內或是上層（磁碟根目錄如 D:\ 亦正確判斷）
  const within = (child, parent) => { const r = path.relative(parent, child); return r === '' || (r.split(path.sep)[0] !== '..' && !path.isAbsolute(r)); };
  if (within(real, data) || within(data, real)) throw new Error('這是真實資料夾，不可以放示範資料，已停止：' + dir);
}
// 有沒有內容：只有空的子資料夾不算（ask.mjs 開示範前會先建好資料夾骨架）；任何檔案或連結都算
function hasContent(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory() || hasContent(path.join(d, e.name))) return true; }
  return false;
}
// 內容核對（建立或重建之前）：有內容的資料夾必須有示範標記，reset 亦不例外
function assertDemoTarget(dir) {
  if (!fs.existsSync(dir) || !hasContent(dir)) return;
  let state = null;
  try { state = JSON.parse(fs.readFileSync(path.join(dir, 'ledger', 'state.json'), 'utf8')); } catch { }
  if (!state || state.demo !== true) throw new Error('這個資料夾沒有示範標記，不會改動，已停止：' + dir);
}

export function seedDemo(dir = DEMO_DIR, { reset = false, now = new Date(), copyCert = false } = {}) {
  assertDemoPlace(dir);
  const cert = path.join(ROOT, 'data', 'ledger', 'adapter-cert.json');
  const existingState = path.join(dir, 'ledger', 'state.json');
  if (fs.existsSync(existingState) && !reset) {
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(existingState, 'utf8')); } catch { return { created: false, dir }; }
    // 沒有示範標記的既有資料：甚麼都不寫（連認證檔也不補抄）
    if (existing?.demo !== true) return { created: false, dir };
    const demoName = JSON.parse(fs.readFileSync(path.join(FIX, 'state.json'), 'utf8')).company?.name || '';
    if (existing.company?.name !== demoName) reset = true;
    else {
      // 示範已經有：真實資料後來先認證 AI 工具嘅話，補抄認證。帳本資料夾必須是真資料夾（不是連結），目的位置不可有任何東西（包括失效連結），以免寫入沿連結越界
      const ledgerSt = fs.lstatSync(path.join(dir, 'ledger'), { throwIfNoEntry: false }), dst = path.join(dir, 'ledger', 'adapter-cert.json');
      if (copyCert && fs.existsSync(cert) && ledgerSt && ledgerSt.isDirectory() && !fs.lstatSync(dst, { throwIfNoEntry: false })) fs.copyFileSync(cert, dst);
      return { created: false, dir };
    }
  }
  assertDemoTarget(dir);
  if (reset && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  for (const d of ['founder/inbox', 'founder/replies', 'founder/desk', 'company', 'archive', 'ledger/answers', 'asks', 'sandbox', 'work']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  // 帳本：保留相對時間
  fs.copyFileSync(path.join(FIX, 'state.json'), path.join(dir, 'ledger', 'state.json'));
  // 公司概覽同成頁確認（次序照附錄 C 更正句：工房、收款寄送、試訂、續訂、連續兩個月）
  const page = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'example-company-page.json'), 'utf8'));
  page.page.preparedAt = resolveTimes('@-26d', now);
  write(path.join(dir, 'company', 'page.json'), page);
  write(path.join(dir, 'company', 'biz.json'), { type: 'goods', other: '' });
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
  // 崗位啟用任務的交付草稿（R-demo-e）：與其他產出一樣可以打開閱讀全文
  const roleArt = JSON.parse(fs.readFileSync(path.join(FIX, 'roles-artifact.json'), 'utf8'));
  write(path.join(dir, 'work', roleArt.runId, roleArt.file), roleArt.text);
  write(path.join(dir, 'work', roleArt.runId, 'receipt.json'), { summary: roleArt.summary, artifacts: [{ file: roleArt.file, title: roleArt.title }], founderNext: [] });
  write(path.join(dir, 'work', roleArt.runId, 'run.json'), { id: roleArt.runId, kind: 'demo', label: roleArt.label });
  // 決定紀錄
  const at = s => resolveTimes(s, now);
  const log = [
    { at: at('@-25d 22:10'), source: 'proofread', packId: page.page.id, packTitle: '公司概覽', qid: 'order', question: '里程碑路線次序', ai: '工房簽約 → 訂戶試訂 → 首批續訂 → 收款寄送 → 連續兩個月', answer: '工房簽約 → 收款寄送 → 訂戶試訂 → 首批續訂 → 連續兩個月', changed: true, effect: 'now' },
    { at: at('@-25d 22:10'), source: 'proofread', packId: page.page.id, packTitle: '公司概覽', qid: 'rest', question: 'Zero 已擬好的其他內容', ai: '', answer: '採用建議（暫定，到期再問）', changed: false, effect: 'tentative' },
    { at: at('@-18d 20:40'), source: 'ask', packId: 'ask-demo-exclusive', packTitle: '工房甲的獨家要求', qid: 'exclusive', question: '工房甲要求獨家供應，接受嗎？', ai: '不接受', answer: '不接受', changed: false, effect: 'now' },
    { at: at('@-18d 20:41'), source: 'ask', packId: 'ask-demo-accept-a', packTitle: '驗收：工房甲供貨協議草稿', qid: 'accept', question: '協議草稿可以用嗎？', ai: '接受', answer: '接受', changed: false, effect: 'now' },
    { at: at('@-10d 09:15'), source: 'ask', packId: 'ask-demo-route0', packTitle: '工房乙退出後的路線', qid: 'route', question: '工房乙退出，先以兩間工房試做兩批嗎？', ai: '採用', answer: '採用', changed: false, effect: 'now' }
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
