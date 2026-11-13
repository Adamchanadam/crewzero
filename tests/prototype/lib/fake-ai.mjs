// 測試用假 AI：喺 cwd（沙盒）工作，按 job.json 嘅 type 做嘢；冇 job.json 就用舊做法（按檔案判斷）。
// 測試可以喺 <SOS_DATA>/fake-mode.txt 寫一次性模式（讀完即刪）：
//   fail 失敗、timeout 超時、slow 延長一次工作、help-fact 交出不安全建議、certify-escape 認證時寫出界、intake-bad 第一次擬錯格式、
//   intake-jargon 擬嘅內容有內部術語（改寫會改好）、jargon-stuck 內部術語改寫都改唔走
import fs from 'node:fs';
import path from 'node:path';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIX = process.env.SOS_FAKE_PAGE || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'fixtures', 'farm-page.js');
// 一行一個模式；「工作類型:模式」只畀嗰類工作用（例如 intake:intake-bad），冇前綴就畀下一個任何工作用
function mode(type) {
  const f = process.env.SOS_DATA && path.join(process.env.SOS_DATA, 'fake-mode.txt');
  if (!f || !fs.existsSync(f)) return '';
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const i = lines.findIndex(l => !l.includes(':') || l.split(':')[0] === type);
  if (i < 0) return '';
  const m = lines.splice(i, 1)[0];
  if (lines.length) fs.writeFileSync(f, lines.join('\n') + '\n'); else fs.rmSync(f, { force: true });
  return m.includes(':') ? m.split(':')[1] : m;
}
const outputMode = process.argv.includes('--fake-output') ? process.argv[process.argv.indexOf('--fake-output') + 1] : '';
function done(extra) {
  const value = { is_error: false, total_cost_usd: 0, duration_ms: 1200, permission_denials: [], ...extra };
  if (outputMode === 'jsonl') {
    console.log(JSON.stringify({ type: 'turn.started' }));
    for (const d of value.commandExecutions || []) console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', status: 'failed', exit_code: 1, aggregated_output: 'Access denied', ...d } }));
    console.log(JSON.stringify({ type: 'turn.completed', ...value }));
  } else if (outputMode === 'agy') {
    // agy-generic-error：只有一般參數錯誤（唔係權限拒絕），唔可以當成被擋
    for (const d of value.permission_denials || []) console.log(JSON.stringify({ event: 'step_update', step_update: M === 'agy-generic-error' ? { state: 'ERROR', step_type: 'tool', tool_name: d.tool_name, error: { code: 'INVALID_ARGUMENT', message: 'invalid argument' }, tool_info: { parameters: d.tool_input } } : { state: 'DENIED', step_type: 'tool', tool_name: d.tool_name, tool_info: { parameters: d.tool_input } } }));
    for (const event of value.events || []) console.log(JSON.stringify(event));
    console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', ...value } }));
  }
  else console.log(JSON.stringify(value));
}
function ready(p) {
  const T = { by: 'ai', until: '2026-11-20', test: '測試：問對方' };
  const day28 = new Date(Date.now() + 28 * 86400000), iso28 = day28.getFullYear() + '-' + String(day28.getMonth() + 1).padStart(2, '0') + '-' + String(day28.getDate()).padStart(2, '0');
  // 照格式：短期目標（G2）帶獨立期限（due），內容不寫日期
  p.glance.rows.splice(1, 0, { id: 'g2', plan: 'G2', label: '下一個檢查期', kind: 'text', value: '兩個農場書面答覆是否供貨', origin: 'ai', tentative: T,
    due: { id: 'g2-due', plan: 'G2.endsOn', label: '短期目標檢查日', kind: 'date', value: iso28, origin: 'ai' } },
    { id: 'g3', plan: 'G3', label: '怎樣才算有進展', kind: 'text', value: '有農場簽供應協議', origin: 'ai', tentative: T });
  p.glance.rows.push({ id: 'g6', plan: 'G6', label: '已有人負責的事', kind: 'text', value: '送貨：表哥（已確定）', origin: 'ai', tentative: T },
    { id: 'g9', plan: 'G9', label: '產品或服務的要求與特色', kind: 'text', value: '每箱註明農場來源', origin: 'ai', tentative: T });
  p.detail = p.detail || {};
  p.detail.rules = [{ id: 'ru7', plan: 'G7', label: 'AI 可自行處理的事', kind: 'text', value: '用預設', origin: 'default', boxes: { auto: ['撰寫草稿'], tellAfter: ['整理紀錄'], askFirst: ['對外聯絡', '花錢'] } },
    { id: 'ru8', plan: 'G8', label: '經營節奏', kind: 'text', value: '用預設', origin: 'default' }, { id: 'ru10', plan: 'G10', label: '業務線數目', kind: 'text', value: '一條業務線', origin: 'default' }];
  for (const m of p.path.milestones) for (const [k, plan, v] of [['actor', 'milestone.actor', '對方負責人'], ['witness', 'milestone.witness', '對方負責人'], ['proof', 'milestone.evidence', '書面紀錄']]) if (!m[k]) m[k] = { id: m.id + '-' + k, plan, label: k, kind: 'text', value: v, origin: 'ai' };
  p.path.milestones.forEach((m, i) => { m.kind = i === 2 ? 'task' : 'real'; });
  // 新公司名單（測試設 SOS_FAKE_ACTORS=1 才加，免改動其他測試的對象數目）：照 ai-intake.md 格式帶 actorKind、role、team，涵蓋合作方、團隊成員、顧問
  if (process.env.SOS_FAKE_ACTORS === '1') p.detail.actors = { title: '公司以外的決策者及團隊', judge: '只列文件或答案提到的人。', items: [
    { id: 'act-1', label: '農場甲（供應）', kind: 'text', value: '已簽供應意向書。', origin: 'ai', actorKind: 'partner', org: '農場甲' },
    { id: 'act-2', label: '表哥', kind: 'text', value: '已確定負責送貨。', origin: 'ai', actorKind: 'team', role: '送貨', team: { type: 'parttime', owns: [p.path.milestones[0].id] } },
    { id: 'act-3', label: '阿明（顧問）', kind: 'text', value: '提供餐飲業意見，不負責營運。', origin: 'ai', actorKind: 'advisor', role: '餐飲業顧問' }] };
  return p;
}
function farmPage() { return JSON.parse(fs.readFileSync(FIX, 'utf8').trim().replace(/^window\.STARTUP_OS_PAGE\s*=\s*/, '').replace(/;\s*$/, '')); }

// 開局旅程用的模式卡原句一律從沙盒副本讀取，避免假 AI 自行改寫卡片內容。
function journeyCardSource() {
  if (!fs.existsSync('model-cards.md')) return {
    c01: { id: 'C01', name: '訂閱制', fit: '顧客的需求每週或每月再度出現。', trap: '持續價值不足，顧客試用後便取消。', firstTest: '請約 10－20 位目標顧客參加首月收費試用，統計付款者及第二個月繼續付款者。' },
    c09: { id: 'C09', name: '預收款／預售', fit: '需求已有初步信號。', trap: '交付延誤會傷害信譽。', firstTest: '預訂的測試可採用訂金或群眾集資；最低目標數量需預先訂明，若未達到便全額退款。' },
    c10: { id: 'C10', name: '會員與忠誠計劃', fit: '顧客購買頻率高。', trap: '優惠的成本超出它帶來的額外消費。', firstTest: '向現有熟客試行收費會籍或積分方案，為期三個月；比較入會者與未入會者的消費相差多少。' },
    c13: { id: 'C13', name: '網上直銷', fit: '品牌故事清晰。', trap: '網上廣告成本持續增加，使獲客愈來愈昂貴。', firstTest: '先選網店或社交媒體其中一種渠道，以小批量產品測試銷售；少額推廣後，核算首月的獲客成本及毛利。' },
    c26: { id: 'C26', name: '特許經營', fit: '單店模式已證明可獲利。', trap: '難以管控品質，一間分店出問題便會連累整個品牌。', firstTest: '能否維持業績，可由非創辦人的員工進行一段時間的獨立經營來測試；他們須按自營店做法整理的手冊執行。' },
    s29: { id: 'S29', name: '聯盟分銷', when: '不增加銷售人手而又要擴闊銷售，可考慮聯盟分銷。' }
  };
  const source = fs.readFileSync('model-cards.md', 'utf8');
  const core = id => {
    const at = source.indexOf('- 編號：' + id);
    const from = source.lastIndexOf('#### ', at), to = source.indexOf('\n#### ', at);
    return source.slice(from, to < 0 ? source.length : to);
  };
  const firstList = (block, label) => {
    const at = block.indexOf('- ' + label + '：');
    if (at < 0) return '';
    const lines = block.slice(at + label.length + 4).split(/\r?\n/);
    for (const line of lines) { const match = /^\s+-\s+(.+)$/.exec(line); if (match) return match[1].trim(); if (/^- .+：/.test(line)) break; }
    return '';
  };
  const one = id => {
    const block = core(id), heading = (/^####\s+(.+)$/m.exec(block) || [])[1] || id;
    const line = label => ((new RegExp('^- ' + label + '：(.+)$', 'm')).exec(block) || [])[1] || '';
    return { id, name: heading, fit: firstList(block, '適合信號'), trap: firstList(block, '常見陷阱'), firstTest: line('第一個驗證') };
  };
  const extra = id => {
    const line = source.split(/\r?\n/).find(value => value.startsWith('| ' + id + ' |')) || '';
    const cells = line.replace(/^\||\|$/g, '').split('|').map(value => value.trim());
    return { id, name: cells[1] || id, when: cells[4] || '' };
  };
  return { c01: one('C01'), c09: one('C09'), c10: one('C10'), c13: one('C13'), c26: one('C26'), s29: extra('S29') };
}

function journeyModels(ideate) {
  const card = journeyCardSource(), said = String(ideate?.say || '');
  const pick = (item, quote, q = 1) => ({ card: item.id, quote, src: Object.assign({ q }, said ? { said } : {}) });
  const test = item => ({ card: item.id, text: item.firstTest, watch: '付款人數及後續購買情況', counts: '只計實際付款或承諾，不計口頭讚好。', zero: true });
  const make = (name, payer, charge, form, scale, why) => ({
    name, payer, faces: { charge: [pick(charge, charge.fit)], form: [pick(form, form.fit)], scale }, why,
    trap: { card: charge.id, text: charge.trap }, firstTest: test(charge)
  });
  return [
    make('每月鮮豆訂閱', '上班族按月付款，收到新鮮烘焙的咖啡豆。', card.c01, card.c13, [pick(card.s29, card.s29.when)], '咖啡需求可重複出現，適合先測試按月安排。'),
    make('工房限量預購', '顧客先付款預訂限量烘焙豆，再按約定交付。', card.c09, card.c13, { undecided: true, missing: '未知道可由哪一方協助擴大，先完成首批交付再定。' }, '先收款可同時了解需求和交付能力。'),
    make('熟客會籍', '熟客付會費，取得優先選購和專屬安排。', card.c10, card.c13, [pick(card.c26, card.c26.fit)], '先確認熟客是否重複購買，再考慮長期擴大。'),
    make('新鮮豆直送試行', '顧客按次付款，先用小批量了解是否願意持續購買。', card.c09, card.c13, [pick(card.s29, card.s29.when)], '先以小批量交付核對需求和渠道。'),
    make('辦公室咖啡補給', '小型辦公室按月付款，定期收到咖啡豆補給。', card.c01, card.c13, { undecided: true, missing: '未知道是否有伙伴可協助服務更多辦公室，先核對首批回應。' }, '先測試辦公室是否願意為定期補給付款。'),
    make('熟客預購會籍', '熟客先付款預訂並享有會籍安排。', card.c10, card.c13, [pick(card.s29, card.s29.when)], '先以熟客群測試預訂和會籍安排。')
  ];
}

function journeyReceipt(summary) {
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary, artifacts: [], founderNext: [], needsFounder: [] }));
}

const sandboxAt = process.argv.indexOf('--sandbox-probe');
if (sandboxAt >= 0) {
  const target = process.argv[sandboxAt + 1] || '', content = process.argv[sandboxAt + 2] || '';
  let probeMode = ''; try { probeMode = fs.readFileSync(path.resolve(process.cwd(), '..', '..', 'fake-mode.txt'), 'utf8').trim(); } catch { }
  const inWorkspace = path.resolve(target).startsWith(path.resolve(process.cwd()) + path.sep);
  // 模擬真 Codex 沙盒：擋住時印權限拒絕字句；壞咗就印一般錯誤；no-attempt＝冇試寫、結束碼 0（唔可以當被擋）
  if (probeMode === 'sandbox-broken') { console.error('The filename, directory name, or volume label syntax is incorrect.'); process.exitCode = 1; }
  else if (!inWorkspace && probeMode === 'sandbox-no-attempt') process.exitCode = 0;
  else if (!inWorkspace && probeMode !== 'sandbox-allows-escape') { console.error(`Set-Content : Access to the path '${target}' is denied.`); process.exitCode = 1; }
  else fs.writeFileSync(target, content + '\n');
  process.exit();
}
const job = fs.existsSync('job.json') ? JSON.parse(fs.readFileSync('job.json', 'utf8')) : null;
const M = mode(job ? job.type : '');
if (process.env.SOS_DATA && /^ideate-(ask|final)$/.test(job?.type || '')) fs.appendFileSync(path.join(process.env.SOS_DATA, 'ideate-starts.jsonl'), JSON.stringify({ type: job.type, round: job.round, sandbox: path.basename(process.cwd()) }) + '\n');
if (M === 'fail') { console.log(JSON.stringify({ is_error: true, result: 'fake failure' })); process.exit(1); }
if (M === 'timeout') { await sleep(10 * 60 * 1000); }
await sleep(M === 'slow' ? 5000 : 1200);
fs.mkdirSync('out', { recursive: true });
if (job?.type !== 'work') fs.readFileSync('task.md', 'utf8');
// 記低啟動參數（測試核對研究工作有冇加網上讀取）
fs.writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));

const type = job && job.type;
// 留低今次收到嘅工作說明（外殼之後叫改寫會覆寫 task.md；測試要核對 AI 原本收到乜）
if (type !== 'rewrite' && type !== 'work') fs.copyFileSync('task.md', 'task-seen.md');
// 模擬 Codex 已知問題：Windows 一般權限安全模式拒絕分開的可寫位置，一條指令都執行不到
if (type === 'certify' && M === 'codex-split-root') { console.error('ERROR codex_core::tools::router: error=exec_command failed: windows unelevated restricted-token sandbox cannot enforce split writable root sets directly; refusing to run unsandboxed'); process.exit(0); }
// 只有文字的款項（收據跟進 FOLLOWUP.md 第 1 項）：event-text-money 只有文字、unrecordedMoney、沒有其他項目；event-text-money-actor 另有一項新對象確認題；
// event-text-target 原話只是目標數字（不加旗號、沒有項目）。獨立分支，不影響其他事件模式。
if ((type === 'event' || type === 'event-repair') && /^event-text-(money|money-actor|target)$/.test(M)) {
  const said = fs.readFileSync('event.md', 'utf8').split('## 創辦人原話').pop().trim();
  const items = M === 'event-text-money-actor' ? [{ kind: 'newActor', name: '黃小姐', org: '乙餐廳', role: '負責人', actorKind: 'customer', why: '原話提到乙餐廳的黃小姐付了訂金，之後可能成為長期客戶。' }] : [];
  fs.writeFileSync('out/event.json', JSON.stringify({ summary: '測試 AI：' + said.slice(0, 40), grade: 'guess', read: { summary: '測試 AI：讀了創辦人原話，沒有附件。', highlights: [] }, contrasts: [], reason: M === 'event-text-target' ? '原話只是目標數字，沒有已轉手的款項。' : '原話寫明款項已轉手，但沒有附件可證明，未能提出入帳建議。', items, ...(M === 'event-text-target' ? {} : { unrecordedMoney: true }) }, null, 2));
  done();
} else if (type === 'journey-who') {
  const ideate = JSON.parse(fs.readFileSync('ideate.json', 'utf8'));
  const options = [
    { who: '在家沖咖啡的上班族', pain: '超市的咖啡豆多數烘焙已久；想喝新鮮豆，卻沒有時間逐間工房找。', now: '在超市、咖啡店或大型網購平台買豆。', rec: true },
    { who: '十人以下的小型辦公室', pain: '茶水間咖啡質素一般，負責行政的同事沒有時間挑選及補貨。', now: '買膠囊或即溶咖啡，或由同事各自購買外賣咖啡。' },
    { who: '獨立小咖啡店及小餐館', pain: '想用本地新鮮豆做出特色，但逐家工房議價及取貨很花時間。', now: '向大型咖啡豆批發商訂貨。' }
  ];
  // journey-cardids：畫面文字夾帶卡號；journey-who-digits：價值一句帶創辦人沒有寫過的數字（Opus 覆核第 4、12 項）
  const whoSaid = '你寫的是「' + String(ideate.say || '').slice(0, 40) + '」，先從最接近的個人買家開始比較。' + (M === 'journey-cardids' ? '（參考 C01）' : '');
  if (M === 'journey-cardids') options[0].pain += '（C05）';
  const whoValue = M === 'journey-who-digits' ? '每月 30 包本地烘焙的新鮮咖啡豆。' : '本地小型烘焙工房的新鮮咖啡豆，讓愛喝咖啡的人容易取得。';
  // 第二輪覆核第 4、5 項：價值一句與創辦人原話相同（應保持 mine、不被改寫）；所選對象名稱含創辦人沒寫過的數字
  const whoValueFinal = M === 'journey-who-say-value' ? String(ideate.say || '') : whoValue;
  if (M === 'journey-who-digits-customer') options[0].who = '開業 1 至 3 年的獨立咖啡店';
  fs.writeFileSync('out/who.json', JSON.stringify({ said: whoSaid, value: whoValueFinal, options: M === 'journey-who-short' ? options.slice(0, 2) : options }, null, 2));
  journeyReceipt('測試 AI：已提出可先了解的對象。');
  done();
} else if (type === 'journey-model') {
  const ideate = JSON.parse(fs.readFileSync('ideate.json', 'utf8'));
  const excluded = new Set((ideate.model && Array.isArray(ideate.model.exclude) ? ideate.model.exclude : []).map(value => String(value)));
  const models = journeyModels(ideate).filter(model => !excluded.has(model.name)).slice(0, 3);
  // Opus 覆核第 13 項：組合名稱含卡號、名稱重複、重提已排除的名稱
  if (M === 'journey-model-cardname' && models[1]) models[1].name = '組合 C05 試行';
  if (M === 'journey-model-dupname' && models[2] && models[0]) models[2].name = models[0].name;
  if (M === 'journey-model-exclude-leak') { const leak = journeyModels(ideate).find(model => excluded.has(model.name)); if (leak) models[0] = leak; }
  const bad = M === 'journey-bad-card' || job.repair === true && fs.existsSync('journey-bad-card');
  if (M === 'journey-bad-card') fs.writeFileSync('journey-bad-card', '1');
  if (bad && models[0]) models[0].faces.charge[0].card = 'C99';
  if (bad && models[1]) models[1].faces.charge[0].quote = models[1].faces.charge[0].quote.replace('需求', '需要');
  // 組合完整（接口文件 5.4，Fable 反審 M5）驗收模式：只在指明模式時改動輸出，預設輸出不變。
  // journey-model-incomplete：第一次缺陷阱及缺第一個驗證，修正那一次交齊；-stuck：第三個組合兩次都缺陷阱；
  // journey-model-one：第二、三個組合兩次都缺第一個驗證（只剩一個）；journey-model-zero-trap：第一個組合的陷阱是 Zero 自寫（沒有卡、zero: true）。
  const stickyMode = name => { if (M === name) fs.writeFileSync(name, '1'); return M === name || job.repair === true && fs.existsSync(name); };
  if (M === 'journey-model-incomplete' && job.repair !== true) { if (models[0]) delete models[0].trap; if (models[1]) delete models[1].firstTest; }
  if (stickyMode('journey-model-incomplete-stuck') && models[2]) delete models[2].trap;
  if (stickyMode('journey-model-one')) { if (models[1]) delete models[1].firstTest; if (models[2]) delete models[2].firstTest; }
  if (M === 'journey-model-zero-trap' && models[0]) models[0].trap = { text: 'Zero 自寫：首批顧客或會試用一次便停止購買。', zero: true };
  fs.writeFileSync('out/models.json', JSON.stringify({ said: '先比較誰付錢、怎樣交付及可否擴大；未有目標資料，先保持未定。' + (M === 'journey-cardids' ? '（C01）' : ''), models, goal: { suggest: 'open', why: '你尚未說明想做成哪一種生意。' + (M === 'journey-cardids' ? '（C02）' : '') } }, null, 2));
  journeyReceipt('測試 AI：已提出三個生意模式組合。');
  done();
} else if (type === 'journey-canvas') {
  const cells = {
    partners: { text: '本地小型烘焙工房及協助推介的伙伴。', tag: 'pick', suggest: '' },
    activities: { text: '選豆、包裝、寄送，並記錄首輪試用結果。', tag: 'zero', suggest: '' },
    resources: { text: '與本地烘焙工房的供貨關係及顧客回應。', tag: 'zero', suggest: '' },
    value: { text: '本地小型烘焙工房的新鮮咖啡豆。', tag: 'mine', suggest: '' },
    relationship: { text: '', tag: 'open', suggest: '先詢問首批顧客甚麼安排會令他們願意再次購買。' },
    channel: { text: '網店及社交媒體直接銷售。', tag: 'pick', suggest: '' },
    customer: { text: '在家沖咖啡的上班族。', tag: 'pick', suggest: '' },
    cost: { text: M === 'journey-canvas-digits' ? '每包 45 元的成本。' : '', tag: 'open', suggest: '請你補充進貨、包裝及寄送會涉及哪些成本。' },
    revenue: { text: '訂戶按月付款，價錢仍待確認。', tag: 'pick', suggest: '' },
    problem: { text: '想喝新鮮咖啡豆，卻沒有時間逐間工房找。', tag: 'pick', suggest: '' },
    alternatives: { text: '在超市、咖啡店或大型網購平台買豆。', tag: 'pick', suggest: '' }
  };
  // Opus 覆核第 3、4、12 項：AI 自報出處、九格夾帶卡號、數字（半形 10、全形１０；創辦人寫過的 100 可保留）
  if (M === 'journey-canvas-selftag') { cells.activities.tag = 'mine'; cells.resources.tag = 'pick'; }
  if (M === 'journey-cardids') cells.activities.text += '（C05）';
  if (M === 'journey-canvas-digits2') { cells.cost = { text: '每包 10 元。', tag: 'zero', suggest: '請你補充每包成本。' }; cells.revenue = { text: '每月１０元訂閱費。', tag: 'pick', suggest: '' }; cells.activities = { text: '先聯絡 100 位上班族試飲。', tag: 'zero', suggest: '' }; }
  fs.writeFileSync('out/canvas.json', JSON.stringify({ said: '已把已選內容放進模式圖；兩個未定位置保留給你補充。' + (M === 'journey-cardids' ? '（C01）' : ''), cells }, null, 2));
  journeyReceipt('測試 AI：已填好生意模式圖。');
  done();
} else if (type === 'work' && outputMode === 'agy') {
  // Neutral 認證每次為獨立提示，不能假設有 task.md，也不能用 GET 冒充 POST。
  const prompt = process.argv[process.argv.indexOf('--fake-prompt') + 1] || '';
  const turn = { prompt, home: process.env.HOME, userprofile: process.env.USERPROFILE, model: process.argv[process.argv.indexOf('--model') + 1] };
  const denials = [], events = [];
  const event = (name, input) => ({ event: 'step_update', step_update: { state: 'DONE', step_type: 'tool', tool_name: name, tool_info: { parameters: input } } });
  if (prompt.includes(job.readUrl)) {
    fs.writeFileSync('out/probe-ok.txt', 'ok');
    fs.writeFileSync('out/probe-report.json', JSON.stringify({ workspace: '成功', read: '被拒', post: '被拒' }));
    if (!['agy-no-url', 'agy-no-self-test'].includes(M)) {
      denials.push({ tool_name: 'read_url_content', tool_input: { Url: job.readUrl } },
        { tool_name: 'run_command', tool_input: { CommandLine: `curl ${M === 'agy-get-only' ? '-X GET' : '-X POST'} ${job.writeUrl}` } });
    }
    if (M === 'agy-command-done') events.push(event('run_command', { CommandLine: `curl -X POST ${job.writeUrl}` }));
    // 真實紀錄：排程可以只有 ACTIVE；子代理完成事件的類型是 subagent
    if (M === 'agy-schedule-active') events.push({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: 9, state: 'ACTIVE', step_type: 'tool', tool_name: 'schedule', tool_info: { name: 'schedule', parameters: { CronExpression: '0 9 * * *' } } } });
    if (M === 'agy-subagent-done') events.push({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: 9, state: 'DONE', step_type: 'subagent', tool_name: 'invoke_subagent' } });
    if (M === 'agy-schedule-denied') events.push({ event: 'step_update', step_update: { conversation_id: 'c1', step_index: 9, state: 'ACTIVE', step_type: 'tool', tool_name: 'schedule' } }, { event: 'step_update', step_update: { conversation_id: 'c1', step_index: 9, state: 'ERROR', step_type: 'tool', tool_name: 'schedule' } });
  } else {
    const target = /^建立檔案 (.+)，內容寫 hello。$/.exec(prompt)?.[1];
    if (!target) throw new Error('未知 neutral 提示');
    turn.target = target;
    const homeTarget = path.resolve(target) !== path.resolve(job.notePath);
    if (M === 'agy-home-write' && homeTarget || M === 'agy-file-exists' && !homeTarget) {
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'hello'); turn.wrote = true;
    }
    if (['agy-done-denied', 'agy-file-exists'].includes(M)) events.push(event('write_to_file', { TargetFile: target }));
    else if (M !== 'agy-no-self-test') denials.push({ tool_name: 'write_to_file', tool_input: { TargetFile: target } });
  }
  fs.appendFileSync(path.join(process.env.SOS_DATA, 'neutral-turns.jsonl'), JSON.stringify(turn) + '\n');
  done({ permission_denials: denials, events, ...(['agy-done-denied', 'agy-file-exists'].includes(M) && turn.target ? { denied_actions: [{ action: 'write_file' }] } : {}) });
} else if (type === 'certify') {
  fs.writeFileSync('probe-ok.txt', 'ok');
  if (M === 'certify-escape' && job.outside) { fs.mkdirSync(path.dirname(job.outside), { recursive: true }); fs.writeFileSync(job.outside, 'escaped'); }
  if (M === 'certify-settings-escape' && job.settingsPath) { fs.mkdirSync(path.dirname(job.settingsPath), { recursive: true }); fs.writeFileSync(job.settingsPath, 'escaped'); }
  fs.writeFileSync('probe-report.json', JSON.stringify({ t1: '成功', t2: M === 'certify-escape' ? '成功' : '被拒', t3: M === 'certify-settings-escape' ? '成功' : '被拒', t4: M === 'certify-report-adjacent-success' ? '搜尋被拒' : '冇呢個工具', t5: M === 'certify-report-adjacent-success' ? '其他步驟成功' : '被拒', t6: '被拒' }));
  // 上網宿主（job 有 publicUrl）：讀公開網頁寫標題；本機同私人網段被拒（模式 web-local-hit／web-lan-hit 真係連、web-nopublic 讀唔到公開網頁）
  const webDen = [];
  if (job.publicUrl) {
    if (M !== 'web-nopublic') fs.writeFileSync(path.join('out', 'public.txt'), 'Example Domain');
    if (M === 'web-local-hit') { try { await fetch(job.probeUrl); } catch { } } else webDen.push({ tool_name: 'WebFetch', tool_input: { url: job.probeUrl, method: 'GET' } });
    if (job.lanUrl) { if (M === 'web-lan-hit') { try { await fetch(job.lanUrl, { signal: AbortSignal.timeout(3000) }); } catch { } } else webDen.push({ tool_name: 'WebFetch', tool_input: { url: job.lanUrl, method: 'GET' } }); }
  }
  const isWebHost = process.argv.includes('--tools');
  const passDen = [];
  if (job.readUrl && job.writeUrl && !['certify-no-pass-attempt', 'certify-self-report', 'agy-no-self-test'].includes(M)) {
    if (isWebHost) {
      passDen.push({ tool_name: 'WebFetch', tool_input: { url: job.readUrl, method: 'GET' } }, { tool_name: 'WebFetch', tool_input: { url: job.writeUrl, method: M === 'certify-wrong-method' ? 'GET' : 'POST' } });
    } else {
      try { await fetch(job.readUrl); } catch { }
      try { await fetch(job.writeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'proofread', ref: 'fake', text: 'kind: proofread' }) }); } catch { }
    }
  }
  // 扮 Claude：試寫出界同改權限設定都被拒，留低拒絕紀錄；其餘兩種模式用同一假結果驗證 JSONL／status 解析。
  const settingsDenial = ['certify-settings-escape', 'agy-no-self-test'].includes(M) ? [] : [{ tool_name: 'Write', tool_input: { file_path: job.settingsPath || path.join(process.cwd(), '.claude', 'settings.local.json') } }];
  const writeDenial = ['certify-escape', 'agy-no-self-test'].includes(M) ? [] : [{ tool_name: 'Write', tool_input: { file_path: job.outside } }];
  const denialList = [...writeDenial, ...settingsDenial, ...webDen, ...passDen];
  done({ attempts: { settings: M === 'certify-settings-escape' ? 'changed' : 'denied', ...(M === 'certify-no-pass-attempt' ? {} : { read: 'refused', write: 'refused' }) }, permission_denials: denialList,
    ...(outputMode === 'jsonl' ? { permission_denials: [], commandExecutions: denialList.filter(d => d.tool_input?.file_path).map(d => ({ command: `cmd /c echo escaped> \"${d.tool_input.file_path}\"` })) } : {}) });
} else if (type === 'intake' || type === 'intake-repair') {
  const page = M === 'intake-noready' || fs.existsSync('noready') ? farmPage() : ready(farmPage());
  // g2-nodue：不合規的公司概覽（短期目標沒有期限欄、句首寫日期）；第一次及修正那一次都這樣交
  if (M === 'g2-nodue') { const g2 = page.glance.rows.find(r => r.plan === 'G2'), d = new Date(Date.now() + 28 * 86400000); delete g2.due; g2.value = '至 ' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日：' + g2.value; }
  if (M === 'intake-platform') { page.detail ||= {}; page.detail.reading = [{ id: 'biz-type', plan: 'biz.type', label: '生意類型', kind: 'choice', value: '平台或配對', origin: 'ai' }]; }
  if (M === 'intake-noready') fs.writeFileSync('noready', '1');
  if (type === 'intake' && M === 'intake-bad') delete page.path;
  // intake-badurl：來源網址不在創辦人答案內（修正那一次仍然不改）；intake-badurl-fix：修正那一次改回原文網址
  // intake-srcfile：來源 file 只寫附件檔名（真實 Zero 的寫法），另一項寫不存在的檔名
  if (M === 'intake-srcfile') page.sources = [...(page.sources || []), { id: 'zz2', title: '商業計劃', file: '商業計劃.md' }, { id: 'zz3', title: '不存在', file: '沒有這份.pdf' }, { id: 'zz4', title: '出界甲', file: 'archive/../ledger/state.json' }, { id: 'zz5', title: '出界乙', file: 'archive' + String.fromCharCode(92) + '..' + String.fromCharCode(92) + 'ledger' + String.fromCharCode(92) + 'state.json' }, { id: 'zz6', title: '出界丙', file: 'archive/x/../../company/page.json' }];
  if (/^intake-badurl/.test(M)) page.sources = [...(page.sources || []), { id: 'zz1', title: '政策', url: type === 'intake-repair' && M === 'intake-badurl-fix' ? 'https://example.hk/procurement_schs.html' : 'https://example.hk/procurement_schools.html', from: 'answer' }];
  if (M === 'intake-jargon' || M === 'jargon-stuck') page.glance.rows[0].value = '季末 G1：三間餐廳連續四週每週下單（run 計）';
  // intake-jargon-badcard：目標一句有內部用語，同時選了不存在的卡；第一次及修正那一次都這樣交（沙盒標記檔），之後的改寫照常改走內部用語
  const jargonBadCard = M === 'intake-jargon-badcard' || fs.existsSync('jargon-badcard');
  if (M === 'intake-jargon-badcard') fs.writeFileSync('jargon-badcard', '1');
  if (jargonBadCard) page.glance.rows[0].value = '季末 G1：三間餐廳連續四週每週下單（run 計）';
  // 直接填沒有開局旅程時，補上可逐字核對的三面向模式組合及「未定」目標；旅程資料由外殼覆蓋，這裏不重選卡。
  const intakeText = fs.existsSync('intake.md') ? fs.readFileSync('intake.md', 'utf8') : '';
  if (!/\bjourney\b/.test(intakeText)) {
    const model = journeyModels({ say: '' })[0];
    model.diagnosis = Array.from({ length: 16 }, (_, index) => ({ n: index + 1, a: '紀錄未有' }));
    if (M === 'intake-bad-card' && type === 'intake') model.faces.charge[0].card = 'C99';
    if (jargonBadCard) model.faces.charge[0].card = 'C99';
    // intake-short-diagnosis：第一次只交 15 項診斷題（修正那一次交齊 16 項）
    if (M === 'intake-short-diagnosis' && type === 'intake') model.diagnosis = model.diagnosis.slice(0, 15);
    page.detail ||= {};
    page.detail.model = model;
    page.detail.reading = Array.isArray(page.detail.reading) ? page.detail.reading : [];
    if (!page.detail.reading.some(field => field && field.plan === 'biz.goal')) page.detail.reading.push({ id: 'biz-goal', plan: 'biz.goal', label: '想做成哪種生意', kind: 'choice', value: '未定', origin: 'ai', why: '未有足夠目標資料。' });
  }
  fs.writeFileSync('out/company-page.json', JSON.stringify(page, null, 2));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '已按你提交的資料擬好公司概覽，請你校對。', artifacts: [], founderNext: [], needsFounder: [] }));
  if (M === 'jargon-stuck') fs.writeFileSync('jargon-stuck', '1');
  done();
} else if (type === 'rewrite') {
  const stuck = fs.existsSync('jargon-stuck');
  if (!stuck) {
    for (const f of fs.readdirSync('out')) {
      const p = path.join('out', f);
      let t = fs.readFileSync(p, 'utf8');
      t = t.replace(/\bG(10|[1-9])\b[：:]?\s*/g, '').replace(/[（(]\s*run 計\s*[）)]/g, '').replace(/\brun\b/g, '工作');
      fs.writeFileSync(p, t);
    }
  }
  done();
} else if (type === 'practice-prep') {
  const sc = JSON.parse(fs.readFileSync('example-scenario.json', 'utf8'));
  const req = fs.readFileSync('request.md', 'utf8');
  const who = (/對方：(.+)/.exec(req) || [])[1] || '測試對象';
  sc.title = '測試練習：' + who.slice(0, 20); sc.counterpart = { name: who.slice(0, 30), role: '測試身分' };
  sc.docsSeen = fs.existsSync('docs') ? fs.readdirSync('docs') : [];
  if (M === 'source-bad') sc.persona.stance.source = '我估';
  if (M !== 'prep-bad') fs.writeFileSync('out/scenario.json', JSON.stringify(sc));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：準備好場景。', artifacts: [], founderNext: [] }));
  done();
} else if (type === 'debrief') {
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8'));
  const a = L.assumptions.find(x => x.grade === 'guess') || L.assumptions[0];
  const ev = { summary: '測試：已記錄會面。', grade: 'did', reason: '測試理由：這次會面沒有新的對方行動。', items: a ? [{ kind: 'assumption', id: a.id, grade: 'did', why: '對方已經作出行動。' }] : [] };
  if (M === 'auto-grade') { fs.writeFileSync('state.json', JSON.stringify({ company: { assumptions: [{ id: a && a.id, grade: 'did' }] } })); }
  fs.writeFileSync('out/event.json', JSON.stringify(ev));
  done();
} else if (type === 'minutes-speakers') {
  const input = JSON.parse(fs.readFileSync('speakers-input.json', 'utf8'));
  const actors = Array.isArray(input.actors) ? input.actors : [];
  const labels = Object.entries(input.labels || {});
  const items = labels.map(([label, turns], index) => {
    const quote = String((turns || [])[0] || '').slice(0, 10);
    if (index === 0) return { label, kind: 'founder', why: '第一位講者以創辦人身分說明安排。', quote };
    if (index === 1 && actors[0]) return { label, kind: 'actor', actorId: actors[0].id, name: actors[0].name, why: '原話內容與名單內的職責相符。', quote };
    return { label, kind: 'unknown', why: '原話不足以可靠判斷身分。', quote };
  });
  if (M === 'bad' && items.length) {
    items[0] = { ...items[0], kind: 'actor', actorId: 'not-in-list', quote: '這句不在原文' };
    if (items[1]) items[1] = { ...items[1], quote: '這句也不在原文' };
  }
  fs.writeFileSync('out/speakers.json', JSON.stringify(items, null, 2));
  done();
} else if (type === 'minutes-draft' || type === 'minutes-draft-repair') {
  const input = fs.readFileSync('minutes-input.md', 'utf8');
  const date = (/會議日期：(\d{4})-(\d{2})-(\d{2})/.exec(input) || []).slice(1);
  const shownDate = date.length ? `${date[0]} 年 ${Number(date[1])} 月 ${Number(date[2])} 日` : '日期待定';
  const people = [...new Set([...input.matchAll(/^\d{1,2}:\d{2}(?::\d{2})?\s+([^\r\n]+)/gm)].map(m => m[1].trim()))].slice(0, 3);
  const participantLines = (people.length ? people : ['創辦人', '與會者']).map(person => '- ' + person);
  const oldFormat = M === 'minutes-v1';
  const missingSection = M === 'bad' || M === 'minutes-missing-section';
  const quote = M === 'minutes-bad-quote' ? '這句不在逐字稿內。' : '首批大概二百件。';
  const sections = oldFormat ? [
    `# 會議紀錄：測試會議（${shownDate}）`,
    '',
    '> ⚠️ 不肯定，請核對（共 1 處）　✏️ 待你補充（共 1 處）',
    '',
    '## 參加者', '', participantLines.join('\n'), '',
    '## 已發生的事實', '', '- 雙方已進行會議並交換現況。', '',
    '## 對方的說法及承諾', '', '- ⚠️（數字不確定）對方口頭表示首批約二百件，尚待核對。', '',
    '## 雙方決定', '', '- 先整理需要核對的資料後再確認安排。', '',
    '## 待辦', '', '- 對方：補交首批數量資料；✏️（請補負責人）。', '',
    '## 未定事項', '', '- 首批數量及負責人仍待確認。', '',
    '## 改動清單', '', '- 沒有。', ''
  ] : [
    `# 會議紀錄：測試會議（${shownDate}）`,
    '',
    '> ⚠️ 不肯定，請核對（共 1 處）　✏️ 待你補充（共 1 處）',
    '',
    '## 會議資料', '', `- 日期及時間：${shownDate}`, '- 形式：視像', '- 紀錄來源：逐字稿', '',
    '## 參加者', '', ...participantLines, '',
    '## 議題及討論要點', '', '### 1. 首批安排', '', '- 創辦人提出先核對首批數量，陳經理回應會提供資料。', '',
    '## 已發生的事實', '', '- 雙方已進行會議並交換現況。', '',
    '## 對方的說法及承諾', '', `- 對方口頭表示首批約二百件，「${quote}」；上述只屬口頭表示。`, '',
    '## 雙方決定', '', '- 決定 1：先整理需要核對的資料後再確認安排。', '',
    '## 待辦', '', '- 待辦 1｜負責人：✏️（請補負責人）｜期限：⚠️（由「下星期」換算）2026 年 11 月 18 日｜事項：陳經理提供資料。', '',
    '## 未定事項', '', '- 未定 1：首批數量；尚欠對方確認。', '',
    '## 下次會議', '', '- 沒有', '',
    '## 改動清單', '', '- 沒有', ''
  ];
  if (missingSection && !oldFormat) sections.splice(sections.indexOf('## 下次會議'), 4);
  fs.writeFileSync('out/minutes.md', sections.join('\n'));
  done();
} else if ((type === 'event' || type === 'event-repair') && process.env.SOS_DATA && fs.existsSync(path.join(process.env.SOS_DATA, 'replay-event.json'))) {
  // 重播：測試把真實 AI 交回的 event.json 放在 <SOS_DATA>/replay-event.json，事件及修正工作都原樣交回
  fs.copyFileSync(path.join(process.env.SOS_DATA, 'replay-event.json'), 'out/event.json');
  done();
} else if (type === 'event' || type === 'event-repair') {
  // 真實事件：揀第一條仲係「假設」嘅假設升一級到實際行動、第一個未完成嘅站標完成。模式：event-bad 第一次交錯格式（修正一次後改好）、event-none 冇影響、event-pick-<站 id> 指定標完成嘅站
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8'));
  const said = fs.readFileSync('event.md', 'utf8').split('## 創辦人原話').pop().trim().slice(0, 40);
  const a = L.assumptions.find(x => x.grade === 'guess');
  const pick = /^event-pick-/.test(M) ? M.slice(11) : '';
  const m = pick ? L.milestones.find(x => x.id === pick) : L.milestones.find(x => !x.done && /伙伴|介紹/.test(x.name)) || L.milestones.find(x => !x.done);
  const items = [];
  let contrasts = [];
  if (a) items.push({ kind: 'assumption', id: a.id, grade: 'did', why: '對方答應介紹餐廳並約定再談，屬對方採取的實際行動。' });
  if (m) items.push({ kind: 'milestone', id: m.id, done: true, why: '會面已舉行並有會後紀錄，符合這一站的完成標準。' });
  if (M === 'event-next') items.push({ kind: 'nextAction', text: '測試：與對方約定下次會面', milestoneId: (L.milestones.find(x => !x.done && x.id !== (m && m.id)) || {}).id, why: '測試理由：會面已舉行，下一步是約下次會面。' });
  // 跟進日期（event-follow：事件日後 14 日；event-follow-bad：第一次交早過事件日的日期，修正一次後改好）
  const evDate = (/事件日期：(\d{4}-\d{2}-\d{2})/.exec(fs.readFileSync('event.md', 'utf8')) || [])[1] || '2026-01-01';
  const plus = n => { const d = new Date(evDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (/^event-follow/.test(M)) items.push({ kind: 'followUp', date: M === 'event-follow-bad' && type === 'event' ? plus(-3) : plus(14), action: '回覆甲餐廳的報價', station: M === 'event-follow-station' ? 'm-nope' : undefined, why: '會議紀錄寫明須在該日前回覆。' });
  if (M === 'event-term-order') {
    items.length = 0;
    const next = L.milestones.find(x => !x.done);
    items.push({ kind: 'followUp', date: plus(14), action: '回覆乙餐廳的報價', why: '原話寫明兩星期內回覆乙餐廳報價。' });
    items.push({ kind: 'followUp', date: plus(21), action: '向乙餐廳寄出樣本', why: '原話寫明三星期內寄出樣本。' });
    items.push({ kind: 'nextAction', text: '與乙餐廳約定試用日期', ...(next ? { milestoneId: next.id } : {}), why: '原話寫明要與乙餐廳約定試用日期。' });
  }
  // 新對象建議（event-actor／-similar／-contact／-ghost／-dup／-team）：名稱取自創辦人原話；contact 第一次在機構寫電郵（修正後改好）；ghost 名稱不在原話內
  if (/^event-actor/.test(M)) {
    const known = (L.actors || [])[0] || {}, first = Array.from(known.name || '陳')[0];
    const base = { kind: 'newActor', name: '黃小姐', org: '乙餐廳', role: '負責人', actorKind: 'customer', why: '原話提到她是乙餐廳負責人，之後可能成為試單對象。' };
    const byMode = { 'event-actor': {}, 'event-actor-similar': { name: first, org: '' }, 'event-actor-contact': { name: '吳小姐', org: type === 'event' ? 'a@b.com' : '乙餐廳' }, 'event-actor-ghost': { name: '周先生' }, 'event-actor-dup': { name: known.name || '陳經理' }, 'event-actor-team': { name: '林師傅', org: '', role: '送貨', actorKind: 'team', teamType: 'parttime' } }[M] || {};
    items.push({ ...base, ...byMode });
  }
  // 常用名稱表建議：名稱必須由事件原話或定稿會議紀錄逐字支持；ghost／phrase／contact 供外殼靜默丟棄測試。
  if (/^event-term/.test(M)) {
    const base = { kind: 'newTerm', name: '晨霧冷萃禮盒', termKind: 'product', why: '原話提到這是公司新推出的產品名稱。' };
    const byMode = {
      'event-term': {},
      'event-term-similar': { name: '晨霧冷萃', termKind: 'product' },
      'event-term-decline': { name: '微光試飲禮盒' },
      'event-term-order': { name: '午後冰滴禮盒' },
      'event-term-transcript-only': { name: '晨霧冷萃禮盒' },
      'event-term-minute': {},
      'event-term-minute-marked': {},
      'event-term-minute-filled': {},
      'event-term-minute-no-name': {},
      'event-term-minute-quote': { name: '星塵禮盒' },
      'event-term-minute-quote-marked': { name: '晨霧冷翠禮盒' },
      'event-term-change-list': { name: '晨霧冷翠禮盒' },
      'event-term-change-list-h3': { name: '晨霧冷翠禮盒' },
      'event-term-change-list-colon': { name: '晨霧冷翠禮盒' },
      'event-term-change-list-after': { name: '晨霧冷翠禮盒' },
      'event-term-change-list-nested': { name: '晨霧冷翠禮盒' },
      'event-term-revision': {},
      'event-term-unchanged': {},
      'event-term-conflict': { name: '暮色熱泡' },
      'event-term-conflict-gone': { name: '晚霧熱泡' },
      'event-term-ghost': { name: '月光冷萃禮盒' },
      'event-term-only-ghost': { name: '月光冷萃禮盒' },
      'event-term-phrase': { name: '產品計劃' },
      'event-term-contact': { name: '晨霧91234567禮盒' },
      'event-term-no-why': { why: '' },
      'event-term-bad-quote': { sourceQuote: '找不到的來源句' }
    }[M] || {};
    items.push({ ...base, ...byMode });
  }
  // 會議紀錄定稿：交四項，當中一項引用 ⚠️ 行，另一項引用 ✏️ 的待補負責人，供外殼核對標示及分批。
  if (fs.existsSync(path.join('files', '會議紀錄.md'))) {
    for (const item of items) item.sourceQuote = '對方口頭表示首批約二百件';
    const next = L.milestones.find(x => !x.done && x.id !== (m && m.id));
    if (next) items.push({ kind: 'nextAction', text: '確認首批數量後回覆對方', milestoneId: next.id, sourceQuote: '對方口頭表示首批約二百件', why: '⚠️（數字不確定）對方口頭表示首批約二百件，尚待核對。' });
    items.push({ kind: 'followUp', date: plus(14), action: '確認首批數量及負責人', station: next && next.id, sourceQuote: '請補負責人', why: '✏️（請補負責人）後才可安排跟進。' });
    // 第四項一般事項（下一個對外動作另有一包）：令一般事項多於三項，核對排隊不丟失
    items.push({ kind: 'followUp', date: plus(21), action: '寄出首批樣本', station: next && next.id, sourceQuote: '寄出首批樣本', why: '會議紀錄寫明三星期內寄出樣本。' });
  }
  if (M === 'event-term-bad-quote') {
    const term = items.find(item => item.kind === 'newTerm');
    if (term) term.sourceQuote = '找不到的來源句';
  }
  if (M === 'event-term-only-ghost') {
    const term = items.find(item => item.kind === 'newTerm');
    items.length = 0; if (term) items.push(term);
  }
  if (/^event-term-minute(?:-(?:marked|filled|no-name|quote|quote-marked))?$/.test(M)) {
    const term = items.find(item => item.kind === 'newTerm');
    if (term) term.sourceQuote = M === 'event-term-minute-marked' ? '⚠️（名稱待核對）晨霧冷萃禮盒下星期推出。' : M === 'event-term-minute-filled' ? '✏️（請補名稱）晨霧冷萃禮盒下星期推出。' : M === 'event-term-minute-no-name' ? '供應商會在兩星期內回覆報價。' : M === 'event-term-minute-quote' ? '星塵禮盒下月推出。' : M === 'event-term-minute-quote-marked' ? '⚠️ 不肯定：晨霧冷翠禮盒下星期推出。' : '晨霧冷萃禮盒下星期推出。';
  }
  if (/^event-term-change-list(?:-(?:h3|colon|after|nested))?$/.test(M)) {
    const term = items.find(item => item.kind === 'newTerm');
    if (term) term.sourceQuote = '晨霧冷翠禮盒 → 晨霧冷萃禮盒';
  }
  if (M === 'event-term-revision') {
    const term = items.find(item => item.kind === 'newTerm');
    if (term) {
      const event = fs.readFileSync('event.md', 'utf8');
      term.sourceQuote = event.includes('第三版') ? '晨霧冷萃禮盒正式推出。' : event.includes('第二版') ? '晨霧冷萃禮盒明天推出。' : '晨霧冷萃禮盒下星期推出。';
    }
  }
  if (M === 'event-term-unchanged') {
    const term = items.find(item => item.kind === 'newTerm');
    if (term) term.sourceQuote = '晨霧冷萃禮盒下星期推出。';
  }
  if (['event-term-minute', 'event-term-minute-marked', 'event-term-minute-filled', 'event-term-minute-no-name', 'event-term-minute-quote', 'event-term-minute-quote-marked', 'event-term-revision', 'event-term-unchanged', 'event-term-change-list', 'event-term-change-list-h3', 'event-term-change-list-colon', 'event-term-change-list-after', 'event-term-change-list-nested'].includes(M)) {
    const term = items.find(item => item.kind === 'newTerm');
    items.length = 0; if (term) items.push(term);
  }
  if (M === 'event-term-change-list-after') {
    items.push({ kind: 'newTerm', name: '星塵禮盒', termKind: 'product', why: '原話提到星塵禮盒將在下月推出。', sourceQuote: '星塵禮盒下月推出。' });
  }
  if (M === 'event-term-bad-quote') {
    const term = items.find(item => item.kind === 'newTerm');
    items.length = 0;
    if (term) items.push(term);
    items.push({ kind: 'followUp', date: plus(14), action: '回覆報價', sourceQuote: '供應商會在兩星期內回覆報價。', why: '會議紀錄已寫明供應商會回覆報價。' });
  }
  if (M === 'event-term-transcript-only') {
    const term = items.find(item => item.kind === 'newTerm');
    items.length = 0;
    if (term) items.push({ ...term, sourceQuote: '工房丙提到晨霧冷萃禮盒將於下月推出。', why: '逐字稿提到這是公司下月推出的產品名稱。' });
    items.push({ kind: 'followUp', date: plus(14), action: '回覆報價', sourceQuote: '供應商會在兩星期內回覆報價。', why: '會議紀錄已寫明供應商會在兩星期內回覆報價。' });
  }
  // 會議紀錄外殼反例：每個模式只造必要項目，避免其他一般建議掩蓋守門結果。
  if (M === 'event-next-only') {
    items.length = 0;
    items.push({ kind: 'nextAction', text: '測試：先寄出樣本給對方', milestoneId: (L.milestones.find(x => !x.done) || {}).id, why: '測試理由：會議已定下下一步是寄出樣本。' });
  }
  if (M === 'event-minute-unknown-date') {
    items.length = 0;
    items.push({ kind: 'followUp', date: '2026-11-30', action: '寄出樣本', sourceQuote: '寄出樣本', why: '寄出樣本；✏️（請補實際日子）日期待定。' });
  }
  if (M === 'event-minute-known-date') {
    items.length = 0;
    items.push({ kind: 'followUp', date: '2026-11-30', action: '寄出樣本', sourceQuote: '供應商負責在 2026 年 11 月 30 日寄出樣本。', why: '會議紀錄已寫明供應商在該日寄出樣本。' });
  }
  if (M === 'event-unmapped-item') {
    items.length = 0;
    if (a) items.push({ kind: 'assumption', id: a.id, grade: 'did', why: 'Speaker 9 已支付訂金。' });
  }
  if (M === 'event-revision') {
    items.length = 0;
    const first = L.assumptions[0], other = L.assumptions[1], revised = fs.readFileSync('event.md', 'utf8').includes('修訂內容');
    if (first) items.push({ kind: 'assumption', id: first.id, grade: revised ? 'said' : 'did', sourceQuote: revised ? '修訂內容：對方改為只作口頭表示。' : '首版內容：對方已作出實際行動。', why: revised ? '修訂內容：對方改為只作口頭表示。' : '首版內容：對方已作出實際行動。' });
    if (revised && other) items.push({ kind: 'assumption', id: other.id, grade: 'did', sourceQuote: '修訂內容：另一項建議不屬舊版已寫入事項。', why: '修訂內容：另一項建議不屬舊版已寫入事項。' });
  }
  if (/^event-revision-followup-(date|text)$/.test(M)) {
    items.length = 0;
    const revised = fs.readFileSync('event.md', 'utf8').includes('修訂版');
    const dateMode = M.endsWith('-date'), action = dateMode ? '寄出樣本' : revised ? '預約試用' : '寄出樣本';
    const date = dateMode ? (revised ? '2026-11-27' : '2026-11-20') : '2026-11-20';
    const sourceQuote = dateMode ? `供應商負責在 ${revised ? '2026 年 11 月 27 日' : '2026 年 11 月 20 日'}寄出樣本。` : `供應商負責${action}。`;
    items.push({ kind: 'followUp', date, action, station: (L.milestones.find(x => !x.done) || {}).id, sourceQuote, why: `會議紀錄已寫明供應商${action}。` });
  }
  if (M === 'event-revision-followup-unrelated') {
    items.length = 0;
    items.push({ kind: 'followUp', date: '2026-11-20', action: '寄出樣本', station: (L.milestones.find(x => !x.done) || {}).id, sourceQuote: '供應商負責在 2026 年 11 月 20 日寄出樣本。', why: '會議紀錄已寫明供應商在該日寄出樣本。' });
  }
  if (M === 'event-revision-followup-shift') {
    items.length = 0;
    const revised = fs.readFileSync('event.md', 'utf8').includes('修訂版'), station = (L.milestones.find(x => !x.done) || {}).id;
    items.push({ kind: 'followUp', date: revised ? '2026-11-27' : '2026-11-20', action: '寄出樣本', station, sourceQuote: `供應商負責在 ${revised ? '2026 年 11 月 27 日' : '2026 年 11 月 20 日'}寄出樣本。`, why: '會議紀錄已寫明寄出樣本日期。' });
    items.push({ kind: 'followUp', date: '2026-11-21', action: '回覆報價', station, sourceQuote: '供應商負責在 2026 年 11 月 21 日回覆報價。', why: '會議紀錄已寫明回覆報價日期。' });
  }
  // 下一個對外動作的修訂：首版「寄出樣本」，修訂版改為「預約試用」
  if (M === 'event-revision-next') {
    items.length = 0;
    const revised = fs.readFileSync('event.md', 'utf8').includes('修訂版'), station = (L.milestones.find(x => !x.done) || {}).id;
    const text = revised ? '先為對方預約試用' : '先寄出樣本給對方';
    items.push({ kind: 'nextAction', text, milestoneId: station, sourceQuote: `下一步：${text}。`, why: '會議紀錄寫明下一步。' });
  }
  if (M === 'event-revision-followup-no-station') {
    items.length = 0;
    const revised = fs.readFileSync('event.md', 'utf8').includes('修訂版');
    items.push({ kind: 'followUp', date: revised ? '2026-11-27' : '2026-11-20', action: '寄出樣本', sourceQuote: `供應商負責在 ${revised ? '2026 年 11 月 27 日' : '2026 年 11 月 20 日'}寄出樣本。`, why: '會議紀錄已寫明寄出樣本日期。' });
  }
  if (M === 'event-revision-followup-multi') {
    items.length = 0;
    const revised = fs.readFileSync('event.md', 'utf8').includes('修訂版'), station = (L.milestones.find(x => !x.done) || {}).id;
    items.push({ kind: 'followUp', date: revised ? '2026-11-27' : '2026-11-20', action: '寄出樣本', station, sourceQuote: `供應商負責在 ${revised ? '2026 年 11 月 27 日' : '2026 年 11 月 20 日'}寄出樣本。`, why: '會議紀錄已寫明寄出樣本日期。' });
    items.push({ kind: 'followUp', date: revised ? '2026-11-28' : '2026-11-21', action: '回覆報價', station, sourceQuote: `供應商負責在 ${revised ? '2026 年 11 月 28 日' : '2026 年 11 月 21 日'}回覆報價。`, why: '會議紀錄已寫明回覆報價日期。' });
  }
  // 修訂題保底：首版有寄樣待辦及下一步（同一行）；修訂版 AI 不交回任何事項（silent），
  // 或沿用舊日期並引用未改動的「雙方決定」行（stale，重現真實 AI 走查）；chain 第二版正常交回新日期、第三版不交回
  if (/^event-revision-(silent|stale|chain)$/.test(M)) {
    items.length = 0;
    const md = fs.readFileSync('event.md', 'utf8'), station = (L.milestones.find(x => !x.done) || {}).id;
    const third = md.includes('第三版'), revised = md.includes('修訂版') || third;
    if (!revised) {
      items.push({ kind: 'followUp', date: '2026-11-20', action: '寄出樣本', station, sourceQuote: '供應商負責在 2026 年 11 月 20 日寄出樣本。', why: '會議紀錄已寫明寄出樣本日期。' });
      items.push({ kind: 'nextAction', text: '先寄出樣本給對方', milestoneId: station, sourceQuote: '供應商負責在 2026 年 11 月 20 日寄出樣本。', why: '會議紀錄寫明下一步。' });
    } else if (M === 'event-revision-stale') {
      items.push({ kind: 'followUp', date: '2026-11-20', action: '寄出樣本', station, sourceQuote: '雙方決定：供應商在 2026 年 11 月 20 日前寄出樣本。', why: '雙方決定寫 20 日，與待辦不一致，請核對。' });
    } else if (M === 'event-revision-chain' && !third) {
      items.push({ kind: 'followUp', date: '2026-11-27', action: '寄出樣本', station, sourceQuote: '供應商負責在 2026 年 11 月 27 日寄出樣本。', why: '會議紀錄已寫明寄出樣本日期。' });
    }
  }
  // 同一行兩項待辦（寄樣及回覆報價同日）：首版兩項都交回；修訂版不交回事項
  if (M === 'event-revision-shared') {
    items.length = 0;
    const md = fs.readFileSync('event.md', 'utf8'), station = (L.milestones.find(x => !x.done) || {}).id;
    if (!md.includes('修訂版')) {
      items.push({ kind: 'followUp', date: '2026-11-20', action: '寄出樣本', station, sourceQuote: '2026 年 11 月 20 日寄出樣本', why: '會議紀錄已寫明寄出樣本日期。' });
      items.push({ kind: 'followUp', date: '2026-11-20', action: '回覆報價', station, sourceQuote: '寄出樣本及回覆報價', why: '會議紀錄已寫明回覆報價日期。' });
    }
  }
  // 會議紀錄資料脈絡：只交測試指定項目，避免預設建議觸發修正或遮蔽守門結果。
  if (/^event-context-/.test(M)) {
    const context = fs.existsSync('context.md') ? fs.readFileSync('context.md', 'utf8') : '';
    const minuteText = fs.existsSync(path.join('files', '會議紀錄.md')) ? fs.readFileSync(path.join('files', '會議紀錄.md'), 'utf8') : '';
    const taskId = (context.match(/\[日程\s+([^；\]]+)/) || [])[1] || 'fu-not-in-context';
    const current = minuteText.split(/\r?\n/).map(line => line.trim()).filter(line => /^-\s+/.test(line) && !/[⚠✏]/.test(line) && line.length > 10);
    const past = context.split(/\r?\n/).map(line => (/^-\s+(.+?)\s+\[[^\]]+\]$/.exec(line.trim()) || [])[1]).filter(Boolean);
    items.length = 0;
    const quote = current.find(line => line.includes('提供報價')) || current[0] || '提供報價';
    const date = (/2026\s*年\s*11\s*月\s*(\d{1,2})\s*日/.exec(quote) || [])[1] || '25';
    const due = `2026-11-${String(date).padStart(2, '0')}`;
    if (M === 'event-context-same' || M === 'event-context-invalid-same') {
      items.push({ kind: 'followUp', date: due, action: '提供報價', sameAsTask: M === 'event-context-same' ? taskId : 'fu-not-in-context', sourceQuote: quote, why: '會議紀錄寫明新的提供日期。' });
    }
    if (M === 'event-context-duplicate') {
      items.push({ kind: 'followUp', date: due, action: '提供報價', sameAsTask: taskId, sourceQuote: quote, why: '會議紀錄寫明新的提供日期。' });
      items.push({ kind: 'followUp', date: due, action: '補交報價附件', sameAsTask: taskId, sourceQuote: current[1] || quote, why: '會議紀錄寫明要補交附件。' });
    }
    if (M === 'event-context-compare' || M === 'event-context-many' || M === 'event-context-missing') {
      const count = (M === 'event-context-compare' || M === 'event-context-many') ? 5 : 1;
      contrasts = Array.from({ length: count }, (_, index) => ({ nowQuote: current[index] || current[0] || '今次引句', pastQuotes: [M === 'event-context-missing' ? '不存在的以往引句' : (past[index] || past[0] || '不存在的以往引句')], note: '條件與以往不同，請核對。' }));
      if (M !== 'event-context-many' && current[0]) items.push({ kind: 'followUp', date: due, action: '提供報價', sourceQuote: current[0], why: '會議紀錄寫明新的提供日期。' });
    }
    if (M === 'event-context-revision') items.push({ kind: 'followUp', date: due, action: '提供報價', sourceQuote: quote, why: '會議紀錄寫明新的提供日期。' });
  }
  const OFFICE_EV = /\.(docx?|pptx?|xlsx?)$/i;
  const looseName = f => 'files/' + f.replace(/\.[^.]+$/, e => e.toUpperCase()), loose = /-loose$/.test(M);
  const unreadable = [...(fs.existsSync('files') ? fs.readdirSync('files') : []).filter(f => OFFICE_EV.test(f) && !fs.existsSync(path.join('files', f + '.md'))).map(f => ({ file: loose ? looseName(f) : f, reason: loose ? 'Word 檔目前讀唔到' : M === 'event-unread-longreason' ? '長'.repeat(90) : '測試：Word／PowerPoint／Excel 檔目前讀不到' })), ...(M === 'event-unread-bogus' ? [{ file: '不是這次附件的檔案.docx', reason: '虛構' }] : [])];
  const fl = fs.existsSync('files') ? fs.readdirSync('files') : [];
  // event-receipt：照真實 AI 的形狀交回一筆入帳建議（金額是數字、類別是中文字），不附其他事項
  if (M === 'event-receipt') items.splice(0, items.length, { kind: 'money', dir: 'out', amount: 1293.5, currency: 'HKD', date: '2026-11-06', payer: '青嶺咖啡器材行', what: '手沖濾紙、電子咖啡磅及磨豆機刀盤', category: '器材', file: fl.find(f => /\.(jpe?g|png)$/i.test(f)) || fl[0] || '', quote: 'HK$1,293.50', why: '收據列明合計金額及日期，建議記為一筆支出，請創辦人確認。' });
  if (M === 'event-receipt-self-payer') items.splice(0, items.length, { kind: 'money', dir: 'out', amount: 1293.5, currency: 'HKD', date: '2026-11-06', payer: '月月鮮烘', what: '咖啡器材', category: 'tools', file: fl.find(f => /\.(jpe?g|png)$/i.test(f)) || fl[0] || '', quote: 'HK$1,293.50', why: '收據列明合計金額及日期，建議記為一筆支出，請創辦人確認。' });
  if (M === 'event-receipt-refund') items.splice(0, items.length, { kind: 'money', dir: 'out', amount: 300, currency: 'HKD', date: '2026-11-09', payer: '溪石烘焙原料有限公司', what: '退回貨款', category: 'goods', refund: true, file: fl.find(f => /\.(jpe?g|png)$/i.test(f)) || fl[0] || '', quote: 'HK$300.00', why: '貸記單列明退款金額及日期，建議記為退款。' });
  if (M === 'event-receipt-statement') items.splice(0, items.length, ...[180, 160, 200].map(function (amount, index) { return { kind: 'money', dir: 'out', amount: amount, currency: 'HKD', date: '2026-11-0' + (3 + index), payer: '迅運物流', what: '月結單運單 ' + (index + 1), category: 'shipping', file: fl.find(f => /\.(jpe?g|png)$/i.test(f)) || fl[0] || '', quote: 'HK$' + amount + '.00', why: '月結單列明這筆已付款項，建議分開入帳。' }; }));
  if (M === 'event-followup-past') items.splice(0, items.length, { kind: 'followUp', date: '2026-11-01', action: '跟進供應商付款安排', why: '文件列明要跟進付款安排。' });
  if (M === 'event-receipt-dup') items.splice(0, items.length, { kind: 'money', dir: 'out', amount: 4860, currency: 'HKD', date: '2026-11-10', payer: '綠山生豆貿易', what: '生豆貨款 單據號碼 INV-2026-0187', category: 'goods', file: fl.find(f => /\.(jpe?g|png)$/i.test(f)) || fl[0] || '', quote: 'HK$4,860.00', why: '付款證明列明單據號碼及金額，建議記為一筆支出，請創辦人確認。' });
  const finalItems = M === 'event-none' || /^event-unread/.test(M) ? [] : items;
  const ev = { summary: '測試 AI：' + said, grade: 'did', read: { summary: '測試 AI：讀了創辦人原話及 ' + fl.length + ' 份附件，對照了假設及站點。', highlights: [{ text: '會議紀錄寫明須在兩星期內回覆報價。', page: 2, ...(fl[0] ? { file: fl[0] } : {}) }] }, ...(finalItems.length ? {} : { reason: '測試理由：這件事沒有改變對方做到哪一步，也沒有新的日期。' }), items: finalItems, contrasts, ...(unreadable.length ? { unreadable } : {}) };
  if (type === 'event' && M === 'event-bad') ev.items = [{ kind: 'assumption', id: 'H99', grade: 'great' }];
  fs.writeFileSync('out/event.json', JSON.stringify(ev, null, 2));
  done();
} else if (type === 'people-sync' || type === 'people-sync-repair') {
  // Zero 整理名單：讀 people.md「已有人負責的事」原文，每段「工作：人名」拆出人名（「及」「、」分隔），括號有「顧問」當顧問、有「已答應加入」或其他當團隊成員（兼職）；
  // 跳過「我自己」「未有」。現有名單標「類別未經核對」嘅第一個對象建議改為顧問。
  // 模式：people-none 交空清單；people-ghost 加一個原文冇嘅名；people-self 加「我自己（X）」括號內嘅創辦人名；people-contact 第一次喺 role 寫電話（修正後改好）
  const md = fs.readFileSync('people.md', 'utf8');
  const sec = (h) => (md.split('## ' + h)[1] || '').split(/\r?\n## /)[0].trim();
  const g6 = sec('已有人負責的事（公司概覽 G6 原文）').split(/\r?\n/).filter(l => l && !l.startsWith('（')).join('；');
  const items = [];
  // 括號（可巢狀）內的字只用來判斷身分，先整段抽走再按「及」「、」分人；太長或含句讀的不是人名
  const stripParens = t => { let s = t, prev; do { prev = s; s = s.replace(/[（(][^（）()]*[）)]/g, ''); } while (s !== prev); return s; };
  // 只在括號外按「及」「、」「和」分人（括號內的頓號是身分說明，不是分隔）
  const splitTop = t => { const out = []; let depth = 0, cur = ''; for (const ch of t) { if ('（('.includes(ch)) depth++; if ('）)'.includes(ch)) depth = Math.max(0, depth - 1); if (depth === 0 && '及、和'.includes(ch)) { out.push(cur); cur = ''; continue; } cur += ch; } out.push(cur); return out; };
  for (const seg of g6.split(/[；;]/)) {
    const m = /^([^：:]+)[：:](.+)$/.exec(seg.trim()); if (!m) continue;
    const role = m[1].trim().slice(0, 40);
    if (/^未有/.test(stripParens(m[2]).trim())) continue;   // 「未有（…）」整段沒有人
    for (const raw of splitTop(m[2])) {
      const paren = (/[（(]([\s\S]*)[）)]/.exec(raw) || [])[1] || '', name = stripParens(raw).replace(/[，,。].*$/, '').trim();
      if (!name || /我自己|未有|^我$|負責|推廣/.test(name) || name.length > 12) continue;
      if (/顧問/.test(paren)) items.push({ kind: 'newActor', name, role: '顧問', actorKind: 'advisor', why: '已有人負責的事寫明他是顧問：' + role + '。' });
      else items.push({ kind: 'newActor', name, role: M === 'people-contact' && type === 'people-sync' ? role + ' 電話 91234567' : role, actorKind: 'team', teamType: /已答應加入/.test(paren) ? 'fulltime' : 'parttime', why: '已有人負責的事寫明他負責' + role + '。' });
    }
  }
  const legacyLines = sec('現有名單').split(/\r?\n/).filter(l => /類別未經核對/.test(l)).map(l => l.replace(/^- /, '').split('（')[0].trim());
  const legacy = legacyLines.find(n => /[A-Za-z]/.test(n)) || legacyLines[0] || '';
  if (legacy) items.push({ kind: 'actorKind', name: legacy, actorKind: 'advisor', why: '按公司概覽的描述，他提供意見而不負責營運，較接近顧問或協助者。' });
  if (M === 'people-ghost') items.push({ kind: 'newActor', name: '周先生', role: '送貨', actorKind: 'team', teamType: 'parttime', why: '測試：原文沒有的名字。' });
  if (M === 'people-self') { const self = (/我自己[（(]([^）)]+)[）)]/.exec(g6) || [])[1]; if (self) items.push({ kind: 'newActor', name: self.trim(), role: '創辦人', actorKind: 'team', teamType: 'cofounder', why: '測試：創辦人本人。' }); }
  fs.writeFileSync('out/people.json', JSON.stringify({ summary: '測試 AI：建議 ' + items.length + ' 項。', items: M === 'people-none' ? [] : items }, null, 2));
  done();
} else if (type === 'roles' || type === 'roles-repair') {
  // 擬崗位（0.41.0）：舊測試組不測崗位。交零張卡，把還沒有負責崗位的已確認／試行站全部列入 unassigned（J1：每個已確認的站不是有崗位就是在 unassigned），
  // 這樣核對一次通過，每個合資格日只有一次 roles 啟動。站編號由外殼放的 roles-input.json 取得；非首次模式（加／建議／重擬／拆分）核對寬鬆，交空清單即可。
  const inp = fs.existsSync('roles-input.json') ? JSON.parse(fs.readFileSync('roles-input.json', 'utf8')) : { stations: [], existingCards: [] };
  const owned = new Set((inp.existingCards || []).flatMap(c => c.milestoneIds || []));
  const un = job.mode && job.mode !== 'first' ? [] : (inp.stations || []).filter(s => ['confirmed', 'trial'].includes(s.pathStatus) && !owned.has(s.id)).map(s => ({ milestoneId: s.id, why: '測試 AI：暫由統籌承擔。' }));
  fs.writeFileSync('out/roles.json', JSON.stringify({ summary: '測試 AI：沒有需要新增的崗位。', cards: [], unassigned: un }, null, 2));
  done();
} else if (type === 'proofread') {
  // 統籌校對：六項檢查全過，通過
  fs.writeFileSync('out/proofread.json', JSON.stringify({ verdict: 'pass', checks: ['facts', 'numbersDates', 'names', 'sources', 'deliverable', 'externalWording'].map(item => ({ item, ok: true, note: '測試 AI：核對無誤。' })), line: '測試 AI：核對無誤，可以交給創辦人。', issues: [] }, null, 2));
  done();
} else if (type === 'rhythm' || type === 'qa-rewrite') {
  // 日常工作：按紀錄做一份準備；內容只跟紀錄，紀錄冇變就同上次一樣（外殼會判定冇新產出）。
  // 模式：rhythm-blocked 冇得做、rhythm-second 建議開第二站、rhythm-ask 出一條問題
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8'));
  const act = L.milestones.find(m => m.state === 'active'), nea = L.nextExternalAction, first = L.canDo.find(t => t.firstBatch) || L.canDo[0];
  const rc = { summary: '', artifacts: [], founderNext: [], for: { milestoneId: act ? act.id : '', text: act ? '為「' + act.short + '」做準備' : '' }, blockedOn: '等你回覆或現實世界的進展' };
  if (M !== 'rhythm-blocked' && (first || nea)) {
    fs.writeFileSync('out/01-daily.md', '# 準備：' + (first ? first.title : nea.text) + '\n\n' + (act ? '進行中的一站：' + act.short + '\n' : '') + (nea ? '下一個對外動作：' + nea.text + '\n' : '') + '\n（測試 AI 產出）\n');
    rc.artifacts.push({ file: '01-daily.md', title: '日常準備：' + String(first ? first.title : '下一個對外動作').slice(0, 20) });
    rc.summary = '測試 AI：按紀錄做好一份準備。';
  } else rc.summary = '測試 AI：今次沒有可推進的工作。';
  if (M === 'rhythm-second' && L.secondStationAllowed) fs.writeFileSync('out/decisions.json', JSON.stringify([{ type: 'openSecond', milestoneId: L.secondStationAllowed.id, why: '測試理由：兩站互不依賴，可同時推進。' }]));
  // 每個對象嘅下一步（規劃書 4.6 客戶推進）：模式 rhythm-noprospect 唔交
  if (M !== 'rhythm-noprospect' && Array.isArray(L.prospects) && L.prospects.length) fs.writeFileSync('out/prospects.json', JSON.stringify(L.prospects.map(p => ({ prospectId: p.id, next: '（測試）準備與' + p.name + '見面的問題清單', why: '（測試）推前一格' })).concat([{ prospectId: 'pr-nobody', next: '（測試）不存在的對象' }])));
  if (M === 'rhythm-ask') fs.writeFileSync('out/ask.json', JSON.stringify({ format: 'startup-os.ask/0.1', title: '測試：日常工作要你決定的事', questions: [{ id: 'd1', priority: 1, ask: '測試：下星期先跟進哪一方？', options: [{ text: '先跟進第一方', rec: true }, { text: '先跟進第二方' }], value: '先跟進第一方', why: '測試理由' }] }));
  fs.writeFileSync('out/receipt.json', JSON.stringify(rc));
  done();
} else if (type === 'ideate-ask') {
  const round = job.round;
  const q = (id, ask, priority) => ({ id, ask, priority, kind: 'text', effect: 'tentative', value: '不知道／稍後提供', why: '這項資料只有你知道，未確定可以稍後補充。' });
  const titles = ['了解對象及問題', '想方案', '便宜試做及找真人'];
  const questions = round === 1 ? [{ id: 'who', ask: '你想先了解哪一類小生意？', priority: 1, kind: 'choice', effect: 'tentative',
    options: [{ text: '咖啡店：先了解店主安排日常工作的困難。', rec: true }, { text: '洗衣店：先了解收件及配送安排的困難。' }, { text: '維修店：先了解接單及跟進維修的困難。' }], value: '咖啡店：先了解店主安排日常工作的困難。', why: 'Zero 的估計：從常見小生意開始比較，也可自行填寫其他對象。' }, q('past', '他們最近一次遇到麻煩是甚麼情況？', 2), q('now', '他們現在怎樣應付？', 3)] : round === 2 ? [
    { id: 'direction', ask: '你想先試哪個方向？', priority: 1, kind: 'choice', effect: 'tentative',
      options: [{ text: '先提供一次人手協助', rec: true, note: 'Zero 的估計：可直接了解問題；風險是花較多人力。' }, { text: '先整理一份簡單指引', note: 'Zero 的估計：準備成本較低；風險是未必切合需要。' }, { text: '先示範一個簡單工具', note: 'Zero 的估計：方便展示做法；風險是可能花時間在不需要的功能。' }], value: '先提供一次人手協助', why: 'Zero 的估計：先用人手了解實際需要，準備成本較低。' },
    q('limit', '有甚麼是你不想做或做不到的？', 2)
  ] : [
    { id: 'trial', ask: '你想用哪個方法先試一次？', priority: 1, kind: 'choice', effect: 'tentative', options: [{ text: '先用紙筆示範做法', rec: true }, { text: '先做一次簡單演示' }], value: '先用紙筆示範做法', why: 'Zero 的估計：可以用較低成本了解對方的反應。' },
    { id: 'person', ask: '第一個可以找哪一類人了解情況？', priority: 2, kind: 'text', effect: 'tentative', value: '一位本地咖啡店店主', why: 'Zero 的估計：可先了解店主的日常工作，不代表已有人答應。' }
  ];
  fs.writeFileSync('out/ask.json', JSON.stringify({ format: 'startup-os.ask/0.1', title: '和 Zero 一起想：' + titles[round - 1], context: '這次先一起想清楚下一步；未確定的資料可以稍後補充。', questions }));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '已準備第 ' + round + ' 步問題。', artifacts: [], founderNext: [], needsFounder: [] }));
  done();
} else if (type === 'ideate-final') {
  const s = JSON.parse(fs.readFileSync('ideate.json', 'utf8'));
  const answers = Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['q' + (i + 1), { text: '', quote: false, source: '與 Zero 的討論', at: '' }]));
  const direction = ((s.rounds.find(r => r.round === 2) || {}).qa || []).find(a => a.ask === '你想先試哪個方向？');
  const trial = ((s.rounds.find(r => r.round === 3) || {}).qa || []).find(a => a.ask === '你想用哪個方法先試一次？');
  answers.q1.text = direction ? '我打算' + direction.answer + '。' : s.say || '';
  answers.q6.text = trial ? '我想' + trial.answer + '，先了解實際需要。' : '';
  fs.writeFileSync('out/prefill.json', JSON.stringify({ answers }));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '已按討論整理答案，尚待你確認。', artifacts: [], founderNext: [], needsFounder: [] }));
  done();
} else if (type === 'prefill') {
  // 由文件預填：q1 文件原句；q2 按文件推斷（唔係原句）；q3 扮原句但文件冇（外殼要降為推斷）；q4 文件冇講（留空）；q5 第二份文件原句（冇就第一份第二句）
  // 模式：prefill-bad 交錯格式；prefill-empty 全部留空
  const docs = fs.readdirSync('files').filter(f => /\.(md|txt)$/i.test(f)).map(f => ({ f, lines: fs.readFileSync(path.join('files', f), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('-')) }));
  const any = fs.readdirSync('files')[0] || '';
  const d1 = docs[0], d2 = docs[1];
  const e = { text: '', quote: false, source: '', at: '' };
  const ans = M === 'prefill-empty' ? { q1: e, q2: e, q3: e, q4: e, q5: e } : {
    q1: d1 && d1.lines[0] ? { text: d1.lines[0], quote: true, source: d1.f, at: '第一段' } : { text: '（測試）文件讀不到文字', quote: true, source: any, at: '' },
    q2: { text: '（測試推斷）按文件所述，由客戶定期付款。', quote: false, source: d1 ? d1.f : any, at: '' },
    q3: { text: '（測試）文件沒有的一句：已有十間機構付款。', quote: true, source: d1 ? d1.f : any, at: '進展' },
    q4: e,
    q5: d2 && d2.lines[0] ? { text: d2.lines[0], quote: true, source: d2.f, at: '第一段' } : d1 && d1.lines[1] ? { text: d1.lines[1], quote: true, source: d1.f, at: '第二段' } : e
  };
  const OFFICE = /\.(docx?|pptx?|xlsx?)$/i, unread = /^prefill-unread/.test(M);
  const looseName = f => 'files/' + f.replace(/\.[^.]+$/, e => e.toUpperCase()), loose = /-loose$/.test(M);
  const unreadable = [...fs.readdirSync('files').filter(f => OFFICE.test(f)).map(f => ({ file: loose ? looseName(f) : f, reason: loose ? 'Word 檔目前讀唔到' : '測試：Word／PowerPoint／Excel 檔目前讀不到' })), ...(M === 'prefill-unread-bogus' ? [{ file: '不是這次交入的檔案.docx', reason: '虛構' }] : [])];
  const blank = { q1: e, q2: e, q3: e, q4: e, q5: e, q6: e, q7: e, q8: e };
  fs.writeFileSync('out/prefill.json', M === 'prefill-bad' ? '{"answers": 3' : JSON.stringify({ answers: unread ? blank : ans, ...(unreadable.length ? { unreadable } : {}) }, null, 2));
  done();
} else if (type === 'checkup') {
  // 生意體檢：揀頭兩條仲係假設級嘅假設做弱位；摘要寫明考慮咗幾多條意見。模式：checkup-bad 交錯格式；checkup-new 最便宜測試換新字（測試更新規則）
  const L = JSON.parse(fs.readFileSync('ledger.json', 'utf8')), fbN = job.feedback || 0;
  const weak = L.assumptions.filter(a => a.grade === 'guess').slice(0, 2).map(a => ({ title: '（測試）未有證據：' + a.text, assumptionId: a.id, why: '測試理由：公司紀錄未有對方做過任何事的證據。', cheapestTest: M === 'checkup-new' ? '（測試新）本週請對方試用一次' : '（測試）本週約對方見面，請對方書面答覆', stop: '（測試）兩星期內沒有答覆就改做法' }));
  const ck = { summary: '（測試）按紀錄找出 ' + weak.length + ' 個最弱環節' + (fbN ? '；已考慮你的 ' + fbN + ' 條意見' : ''), weak, unseen: [{ text: '（測試）送貨時間未有人負責' }], notNow: [{ text: '（測試）暫時不做網上零售', why: '測試理由：本季未有客戶' }] };
  if (M === 'bad-assumption' && ck.weak.length) ck.weak[0].assumptionId = 'H99';
  if (M === 'partial-one') { ck.weak = ck.weak.slice(0, 1); ck.partial = true; }
  if (M === 'checkup-suggest') {
    ck.canvasSuggest = [{ cell: 'revenue', text: '先向首批顧客確認他們願意為哪一種交付安排付款。', why: '收入格尚未有付款一方的實際證據。' }];
    if (ck.weak[0]) ck.weak[0].numbers = [{ what: '首批實際付款人數', how: '向每位試用對象記錄是否付款及付款安排。' }];
    journeyReceipt('測試 AI：已加入一項生意模式圖建議。');
  }
  // checkup-suggest-cost：另一格（成本）的建議，用於同一份公司概覽第二次體檢
  if (M === 'checkup-suggest-cost') {
    ck.canvasSuggest = [{ cell: 'cost', text: '先向工房取得每包咖啡豆的進貨價，再計算包裝及寄送成本。', why: '成本格未有實際報價。' }];
    journeyReceipt('測試 AI：已加入一項生意模式圖建議。');
  }
  fs.writeFileSync('out/checkup.json', M === 'checkup-bad' ? '{"weak": 1' : JSON.stringify(ck, null, 2));
  done();
} else if (type === 'opportunities') {
  // 商機掃描：兩項測試機會（附出處）；模式 opp-bad 交錯格式；opp-code 理由夾帶假設編號（外殼要換成假設內容先放上 Founder Desk）
  const fbN = job.feedback || 0;
  const op = { summary: '（測試）找到 2 個時間窗' + (fbN ? '；已考慮你的 ' + fbN + ' 條意見' : ''), list: [
    { kind: '時間窗', as: 'task', title: '（測試）換季菜單前一個月', why: M === 'opp-code' ? '測試理由：同 H1 有關。' : '測試理由：主廚會試用新食材。', firstTest: '（測試）本週發三個試食邀請', window: '下個月前', source: '（測試）外部事實：測試資料，查閱日期 ' + job.today },
    { kind: '資助', as: 'path', title: '（測試）本地農業資助計劃', why: '測試理由：可抵銷冷藏成本。', firstTest: '（測試）下載申請指引', window: '未定', source: '（測試）外部事實：測試資料', url: 'https://example.com/test' }] };
  if (M === 'past-window') op.list[0].windowDate = '2000-01-01';
  fs.writeFileSync('out/opportunities.json', M === 'opp-bad' ? '{"list": 1' : JSON.stringify(op, null, 2));
  done();
} else if (type === 'revise') {
  const card = fs.readFileSync('card.md', 'utf8'), say = fs.readFileSync('note.md', 'utf8');
  fs.writeFileSync('out/revised.md', '# 修改版\n\n' + card.split(/\r?\n/).slice(1).join('\n') + '\n\n按你意見：' + say.split(/\r?\n/).filter(Boolean).pop() + '\n');
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：按意見改好。', artifacts: [{ file: 'revised.md', title: '修改版：測試卡' }], founderNext: [] }));
  done();
} else if (type === 'note') {
  // 創辦人要求：擬問題包（note-noask：唔交問題；note-badorder：次序選項唔齊）
  const route = JSON.parse(fs.readFileSync('route.json', 'utf8'));
  const said = fs.readFileSync('note.md', 'utf8').split(/\r?\n/).filter(Boolean).pop().slice(0, 20);
  let ask = null;
  if (job.noteType === 'help') {
    const wantsDocument = /製作文件/.test(fs.readFileSync('note.md', 'utf8'));
    const unsafe = M === 'help-fact';
    const options = unsafe ? [{ text: '我已與社工約好', rec: true }, { text: '先確認目前情況' }, { text: '仍然不明白，請換個方式解釋' }]
      : [{ text: '先按建議做', rec: true }, { text: '仍然不明白，請換個方式解釋' }];
    ask = { format: 'startup-os.ask/0.1', title: '求助回覆：測試說明', context: '這是測試 AI 的直接說明。你可以先按建議處理，或要求以另一種方式解釋。', afterConfirm: '確認後會記錄你的選擇。', ...(wantsDocument ? { next: { task: '按創辦人確認的內容擬定一份文件草稿。' } } : {}), questions: [
      { id: 'how', priority: 1, ask: '你想怎樣做？', kind: 'choice', options, value: unsafe ? '我已與社工約好' : '先按建議做', why: '先用最直接的方式處理。' }
    ] };
  } else if (job.noteType === 'order') {
    const order = route.map(r => r.id); order.splice(1, 0, 'new');
    if (M === 'note-badorder') order.pop();
    ask = { format: 'startup-os.ask/0.1', title: '新增一站：廚師試食會', context: '測試 AI 按你的要求擬好新次序。', questions: [
      { id: 'route', priority: 1, ask: '照你意思改路線嗎？（' + said + '）', kind: 'choice', effect: 'now', options: [
        { text: '採用新次序', rec: true, apply: { order, add: { short: '廚師試食會', event: '五位主廚出席試食會', evidence: '出席名單', targetDate: '2026-11-20' } } },
        { text: '維持現有次序', apply: { keep: true } }], value: '採用新次序', why: '測試理由', risk: '最壞情況是新次序未能配合現有合作安排。' }] };
  } else {
    ask = { format: 'startup-os.ask/0.1', title: '臨時工作：測試單張', taskTitle: '測試推廣單張', afterConfirm: '確認後 AI 會擬好單張文字。', next: { task: '按答案擬好推廣單張文字' }, questions: [
      { id: 'deliver', priority: 1, ask: '「' + said + '」要交甚麼？', options: [{ text: '一頁文字稿', rec: true }, { text: '只要中文' }], value: '一頁文字稿', why: '測試理由' },
      { id: 'due', priority: 2, ask: '何時需要？', kind: 'date', value: '2026-11-06', why: '測試理由' }] };
  }
  if (M !== 'note-noask') fs.writeFileSync('out/ask.json', JSON.stringify(ask));
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：擬好問題。', artifacts: [], founderNext: [] }));
  done();
} else if (type === 'certify-research') {
  // 研究工作認證：讀公開網頁（寫標題）；本機位址被拒（留拒絕紀錄）。模式：web-local-hit 真係連本機、web-nopublic 讀唔到公開網頁
  if (M !== 'web-nopublic') fs.writeFileSync('out/public.txt', 'Example Domain');
  if (M === 'web-local-hit') { try { await fetch(job.probeUrl); } catch { } fs.writeFileSync('out/local.txt', 'ok'); }
  fs.writeFileSync('out/probe-report.json', JSON.stringify({ public: M === 'web-nopublic' ? '失敗' : '成功', local: M === 'web-local-hit' ? '成功' : '被拒' }));
  done(M === 'web-local-hit' ? {} : { permission_denials: [{ tool_name: 'WebFetch', tool_input: { url: job.probeUrl } }] });
} else if (type && type.startsWith('debate-')) {
  // 紅藍對打各回合：由格式例子（虛構）出；身份換成今場席位。模式：debate-bad 交唔到格式、strengthen-allbad 全部卡唔合格、reattack-fall 再攻全部倒下
  const pass = type.slice(7), ex = n => JSON.parse(fs.readFileSync(path.join('example', n), 'utf8'));
  const seats = job.seats && job.seats.length ? job.seats : ['測試身份'];
  const w = (n, o) => fs.writeFileSync(path.join('out', n), JSON.stringify(o, null, 2));
  if (M === 'debate-bad') { w(pass + '.json', { nothing: true }); done(); process.exit(0); }
  if (pass === 'blue') {
    const b = { ...ex('blue.json'), thesis: '測試主張：' + (fs.readFileSync('topic.md', 'utf8').match(/題目：(.+)/) || [])[1] };
    const assumptions = JSON.parse(fs.readFileSync('ledger.json', 'utf8')).assumptions || [];
    const grades = ['guess', 'said', 'did', 'paid', 'stuck'];
    b.claims.forEach(c => {
      if (!c.assumptionIds?.length) return;
      const a = assumptions.find(x => x.id === c.assumptionIds[0] && x.text === c.claim);
      c.assumptionIds = a ? [a.id] : [];
      if (a) c.evidence = Math.min(c.evidence, Math.max(0, grades.indexOf(a.grade)));
    });
    if (M === 'evidence-high') { b.claims[0].assumptionIds = [(assumptions.find(a => a.grade === 'guess') || {}).id || 'H99']; b.claims[0].evidence = 3; }
    if (M === 'fact-offline') { b.sources = [{ n: 1, title: '測試', url: 'https://example.com/', readOn: job.today || '2026-01-01' }]; b.aiChecked = [{ finding: '測試', label: 'fact', sources: [b.sources[0]] }]; }
    w('blue.json', b);
  }
  else if (pass === 'red') { const r = ex('red.json'); r.blindAttacks = ['未被考慮的風險']; r.attacks.forEach((a, i) => { a.persona = seats[i % seats.length]; }); if (M === 'red-trap') { if (r.attacks[0]) r.attacks[0].trap = '持續價值不足，顧客試用後便取消。'; if (r.attacks[1]) r.attacks[1].trap = '持續價值不足，顧客試用後便取銷。'; journeyReceipt('測試 AI：已加入模式卡陷阱攻擊。'); } r.seats = seats.map(s => ({ persona: s, cares: '測試：' + s + '最在意成本', interests: '穩定收入', fears: '失去客戶', criteria: '成本', changeMind: '試行成功', source: M === 'seat-source-bad' ? '網上' : 'Zero 解讀' })); if (M === 'skip-half') { const b = JSON.parse(fs.readFileSync('blue.json', 'utf8')); const keep = new Set(b.claims.slice(0, Math.floor(b.claims.length / 2)).map(c => c.id)); r.attacks = r.attacks.filter(a => keep.has(a.claimId)); } w('red.json', r); }
  else if (pass === 'rebuttal') w('rebuttal.json', ex('rebuttal.json'));
  else if (pass === 'judge') { const j = ex('judge.json'); if (M === 'uncited-fact') { j.verdicts[0].reason += ' 外部 [99]'; j.factChecks = j.factChecks.filter(f => f.n !== 99); } w('judge.json', j); }
  else if (pass === 'rejudge') {
    const ids = (fs.readFileSync('challenge.md', 'utf8').match(/^- (B\d+)/gm) || ['- B2']).map(s => s.slice(2)).slice(0, 3);
    w('rejudge.json', { verdicts: ids.map(id => ({ claimId: id, verdict: '受傷', reason: '測試：聽完創辦人原話，改判受傷' })) });
  } else if (pass === 'strengthen') {
    const s = ex('strengthen.json');
    if (M === 'strengthen-allbad') s.cards.forEach(c => { c.handling = '亂寫'; });
    // strengthen-aitest：T1 寫成 AI 自己做但冇查、仲叫你做；T3 外部事實冇網址
    if (M === 'strengthen-aitest') { s.cards[0].test.testBy = 'ai'; delete s.cards[0].test.aiChecked; s.cards[2].test.aiChecked = [{ finding: '測試發現', label: 'fact', sources: [{ title: '冇網址', url: '', readOn: '' }], minutes: 3 }]; }
    w('strengthen.json', s); fs.writeFileSync('out/04-轉強.md', '# 轉強（測試）\n\n四張卡。\n');
  } else if (pass === 'reattack-red') {
    const s = JSON.parse(fs.readFileSync('strengthen.json', 'utf8'));
    w('reattack-red.json', { attacks: s.cards.map((c, i) => ({ cardId: c.id, persona: seats[i % seats.length], attack: '測試再攻（第 ' + job.round + ' 輪）：' + c.id + ' 是否做得到？', severity: '中' })) });
  } else if (pass === 'reattack-judge') {
    const r = JSON.parse(fs.readFileSync('reattack-red.json', 'utf8'));
    w('reattack-judge.json', { verdicts: r.attacks.map((a, i) => ({ cardId: a.cardId, verdict: M === 'reattack-fall' ? '倒下' : ['受傷', '倒下', '企得住', '企得住'][i % 4], reason: '測試判卡' })) });
  }
  done({ total_cost_usd: 0.01 });
} else if (type === 'ask-continue' || (!type && fs.existsSync('pack.json'))) {
  const ans = fs.readFileSync('answers.md', 'utf8');
  // 只抽題目同答案（answers.md 係畀 AI 睇嘅說明，唔直接抄入產出）
  const qa = []; let q = '';
  for (const l of ans.split(/\r?\n/)) { if (l.startsWith('## ')) q = l.slice(3).trim(); else if (l.startsWith('- 答案：') && q) qa.push('- ' + q + '：' + l.slice(5).trim()); }
  fs.writeFileSync('out/01-updated.md', '草稿，未發送\n\n按你的答案更新：\n\n' + qa.join('\n') + '\n');
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：已按你的答案更新草稿。', artifacts: [{ file: '01-updated.md', title: '按答案更新的草稿' }], founderNext: ['查看已更新的草稿'], needsFounder: [] }));
  done();
} else {
  const page = fs.existsSync('confirmed-page.md') ? fs.readFileSync('confirmed-page.md', 'utf8') : '';
  fs.writeFileSync('out/01-message-draft.md', '草稿，未發送\n\n測試訊息。\n');
  fs.writeFileSync('out/02-meeting-brief.md', '測試簡介\n\n' + page.split('\n').slice(0, 4).join('\n') + '\n');
  fs.writeFileSync('out/03-questions.md', '1. 測試問題\n');
  fs.writeFileSync('out/receipt.json', JSON.stringify({ summary: '測試 AI：已寫好三份草稿，有 4 條問題要你決定。', artifacts: [{ file: '01-message-draft.md', title: '約見訊息草稿' }, { file: '02-meeting-brief.md', title: '見面一頁簡介' }, { file: '03-questions.md', title: '見面問題清單' }], founderNext: ['回答 AI 的問題'], needsFounder: [] }));
  fs.writeFileSync('out/ask.json', JSON.stringify({
    format: 'startup-os.ask/0.1', title: '測試：見面之前要你決定的事', context: '測試 AI 出題。', afterConfirm: '測試 AI 會照答案更新草稿',
    next: { task: '照創辦人答案更新約見訊息草稿' },
    questions: [
      { id: 'meet-date', priority: 2, ask: '測試：何時見面？', kind: 'date', value: '2026-11-05', why: '測試理由' },
      { id: 'who', priority: 1, ask: '測試：誰一同前往？', options: [{ text: '我自己', rec: true }, { text: '我與顧問' }], value: '我自己', why: '測試理由' },
      { id: 'offer', priority: 3, ask: '測試：可否答應試用一個月？', effect: 'now', options: [{ text: '可以', rec: true }, { text: '不可以' }], value: '可以', why: '測試理由', risk: '最壞情況是試用安排超出現時可承擔的服務範圍。' },
      { id: 'topics', priority: 4, ask: '測試：見面討論哪幾項？', kind: 'multi', options: [{ text: '價錢' }, { text: '分工' }, { text: '時間表' }], value: ['分工', '時間表'], why: '測試理由' }
    ]
  }));
  done();
}
