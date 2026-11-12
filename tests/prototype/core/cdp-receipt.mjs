// 收據確認題：名稱鍵、收據原圖、三項決定、修改後入帳及伺服器待合併紀錄。
// 用法：node cdp-receipt.mjs <chrome> <輸出資料夾> <原型資料夾> <假 adapter> <port>
// 純名稱鍵檢查：node cdp-receipt.mjs --names-only [原型資料夾]
import fs from 'node:fs';
import { freshTestOut } from '../lib/out-guard.mjs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { openChrome, sleep } from '../lib/cdp-lib.mjs';
import { certifyDirect, usePass } from '../lib/testkit.mjs';
import { parseFounderReply } from '../../../prototypes/proofread/ask-lib.mjs';

const args = process.argv.slice(2), namesOnly = args[0] === '--names-only';
const [CHROME, OUT, PROTO_ARG, ADAPTER, PORT_ARG] = namesOnly ? [null, null, args[1] || 'prototypes/proofread', null, null] : args;
const PROTO = path.resolve(PROTO_ARG || 'prototypes/proofread');
const PORT = Number(PORT_ARG), BASE = 'http://127.0.0.1:' + PORT;
const N = createRequire(import.meta.url)(path.join(PROTO, 'names.js'));
const results = [], ok = (name, pass, info) => results.push({ name, pass: !!pass, info });
const EXPECTED_NAMES = {
  mnyTab: '業績報告', mnyIncome: '本月收入', mnyExpense: '本月支出', mnyNet: '本月淨額', mnyPayers: '付款客戶', mnyRepeat: '回頭客', mnyAvg: '每位客戶平均收入', mnyVsLastAmounts: '上月 {prev}',
  mnyNone: '未有紀錄', mnyNoneHint: '記下第一筆收入或支出，這裏便會顯示本月業績。', mnyAdd: '記一筆', mnyImport: '匯入紀錄', mnyGiveReceipt: '把收據交給 Zero', mnyWaiting: '另有 {n} 筆等你確認', mnyUnattributed: '有 {n} 筆收入未註明客戶', mnyFunding: '資金注入（不計入收入）', mnyOtherCur: '{cur} 收入 {income}、支出 {expense}，未計入以上數字',
  mnyTrend: '最近六個月', mnyCustomers: '客戶', mnyCategories: '支出類別', mnyPlanVsActual: '計劃與實際', mnyRecords: '紀錄', mnyTodo: '待處理', mnyNoEvidence: '未有證據', mnyAddEvidence: '補上證據', mnyVoid: '作廢', mnyVoided: '已作廢', mnyVoidReason: '作廢原因', mnyUnlisted: '收入最高而未在名單的客戶', mnyAddToList: '加入名單', mnyPaidTimes: '已付款 {n} 次，合共 {total}', mnyEvidenceToAdvance: '補上證據後推進',
  mnyDirIn: '收入', mnyDirOut: '支出', mnyFieldAmount: '金額', mnyFieldCurrency: '幣別', mnyFieldDate: '日期', mnyFieldWho: '對方', mnyFieldCategory: '類別', mnyFieldWhat: '內容', mnyFieldFiles: '附件', mnyMoreFields: '更多資料', mnyRecord: '入帳', mnyAddAndList: '加入名單並入帳', mnyNameOnly: '只記名稱', mnyConfirm: '確認入帳', mnyConfirmEdit: '修改後入帳', mnyReject: '不入帳',
  mnyImportMap: '欄位對應', mnyImportKind: '這是甚麼紀錄', mnyImportSummary: '共 {n} 筆：收入 {incount} 筆合共 {insum}，支出 {outcount} 筆合共 {outsum}，日期由 {from} 至 {to}', mnyImportAll: '全部入帳', mnyImportReview: '逐筆檢查', mnyImportCancel: '取消匯入', mnyImportUndo: '撤銷這次匯入', mnyImportSeen: '已匯入過 {n} 筆', mnyImportDup: '可能重複', mnyImportIncomplete: '資料不全', mnyGoalSet: '設定目標數字', mnyGoalProgress: '目標進度', mnyGoalMetricIncome: '累計收入', mnyGoalMetricNet: '累計淨額', mnyGoalMetricPayers: '付款客戶',
  mnyCat_sales: '銷售收入', mnyCat_service: '服務收入', mnyCat_deposit: '訂金', mnyCat_grant: '資助', mnyCat_funding: '資金注入', mnyCat_otherIn: '其他收入', mnyCat_goods: '貨品及物料', mnyCat_people: '人手', mnyCat_rent: '租金', mnyCat_marketing: '宣傳', mnyCat_tools: '工具及軟件', mnyCat_shipping: '運送', mnyCat_professional: '專業服務', mnyCat_otherOut: '其他支出', mnyDemo: '示範只作展示，不會入帳。',
  mnyVsSamePeriod: '比上月同期 {diff}（{pct}）', mnyVsSamePeriodAmounts: '上月同期 {prev}', mnyRunway: '現金可撐多久', mnyRunwayMonths: '約 {n} 個月', mnyRunwayLong: '三年以上', mnyRunwayShort: '不足一個月', mnyRunwayOtherCurNote: '另有 {cur} 收支未計入', mnyRunwayBasis: '現金結餘 {balance}（截至 {date}）· 近 {k} 個月平均每月淨支出 {burn}', mnyRunwayBalanced: '收支已平衡', mnyRunwayBalancedBasis: '近 {k} 個月平均每月淨額 {avg}，現金結餘 {balance}（截至 {date}）', mnyRunwayNoHistory: '有一個完整月份的紀錄後便會計算可撐多久', mnyRunwayOtherCur: '現金結餘以 {cur} 輸入，請改為 {main}', mnyRunwayUnsetHint: '輸入現金結餘，便可按近三個月的收支估計現金可撐多久。', mnyRunwayStale: '結餘已超過一個月未更新', mnyBalance: '現金結餘', mnyBalanceAmount: '結餘金額', mnyBalanceAsOf: '截至日期', mnyBalanceSet: '設定現金結餘', mnyBalanceUpdate: '更新現金結餘', mnyBalanceHint: '輸入公司銀行帳戶及現金合共的結餘。CrewZero 不連接銀行帳戶，只按你輸入的數字計算。', mnyBalanceConfirm: '確認', mnyBalanceCancel: '取消', mnyOverviewRunway: '現金約可撐 {n} 個月', mnyOverviewBalanced: '收支已平衡', mnyOverviewStale: '要更新',
  extTab: '延伸功能', extIntro: '為你的生意加上專用的功能，例如每張訂單的生產進度。資料存在你的項目資料夾，CrewZero 更新時不會改動。', extTemplates: '從範本開始', extTplOrders: '訂單生產進度', extTplBookings: '預約與出席', extTplStock: '存貨', extAsk: '寫一句你想要甚麼', extAskPlaceholder: '例如：記錄每位學生的上課出席及剩餘堂數', extAskSend: '請 Zero 起草', extAdvanced: '進階：請以你使用的 AI 工具，依照「加延伸功能」說明另建獨立頁面。', extDrafting: 'Zero 正在起草', extDraftingHint: '約需一分鐘，你可以先離開，完成後會在這裏出現。', extDraftFailed: '未能完成起草：{reason}', extRetry: '重試', extUseTemplate: '改用範本', extPreview: '預覽', extFieldsPanel: '欄位及工序', extEnable: '啟用', extRevise: '說一句修改', extCancel: '取消', extApply: '套用修改', extRename: '改名', extShow: '顯示', extHide: '隱藏', extDragHint: '拖動把手可改次序', extViewBoard: '看板', extViewList: '清單', extViewForm: '新增表單', extNew: '新增', extMore: '更多資料', extSave: '儲存', extNext: '下一步：{stage}', extMovedUndo: '已移到「{stage}」', extUndo: '復原', extStale: '資料已更新，已重新載入。', extOverdue: '已過期', extDueSoon: '七日內到期', extShowMore: '顯示更多', extArchiveDone: '封存全部已完成', extArchived: '已封存', extRestore: '取回', extUnsorted: '未分類', extHandoff: '交給 Zero', extHanded: '已交給 Zero', extHandoffHint: 'Zero 會擬好確認題，你確認後才更新公司紀錄。', extHandoffNeedsOverview: '公司概覽確認後才可交給 Zero。', extNewPending: '新延伸功能，待你啟用', extEnabled: '已啟用', extDisabled: '已停用', extDisable: '停用', extEnableAgain: '再啟用', extModify: '修改這個功能', extOpenPage: '打開', extOpenOnComputer: '請在電腦打開', extUpdatedAt: '設定於 {when} 更新', extBadFormat: '這個延伸功能的資料格式不符：{reason}', extStageHasCards: '這個工序仍有 {n} 張卡，請先移到其他工序。', extMoreExt: '另有 {n} 個延伸功能', extDemo: '示範只作展示，重新載入後會還原。', extNoAi: '先設定 AI 工具，才可請 Zero 起草；範本可以直接使用。',
  mnySaved: '已記下。', mnyErrInvalid: '資料不符合格式，請檢查後再試。', mnyErrNotFound: '找不到這筆紀錄，請重新載入。', mnyErrEncoding: '認不出這個檔的編碼，請另存為 UTF-8 再試。', mnyErrTooBig: '檔案太大，上限 2 MB、2,000 行。', extErrInvalid: '設定不符合格式：{reason}', extErrNotFound: '找不到這個延伸功能，請重新載入。', extErrLimit: '已到上限：{reason}', extSaved: '已儲存。', reqExtDraft: 'Zero 起草延伸功能',
  mnyReceiptEyebrow: '確認入帳 · 第 {n} 題，共 {total} 題', mnyReceiptImageNote: '這張是圖片，請對照原圖核對金額。', mnyReceiptFrom: '你在「告訴 Zero」交來這份文件，Zero 讀出以下資料。', mnyFieldDir: '種類', mnyFieldSource: '出處', mnyReceiptDone: '已入帳 {amount}', mnyReceiptSkipped: '不入帳', mnyListed: '名單', mnyReceiptOpen: '開啟'
};
const nameMismatches = Object.entries(EXPECTED_NAMES).filter(([key, value]) => N.ui[key] !== value);
ok('RC-01 第 7、9.6、10.10 節名稱鍵及文字完全一致', nameMismatches.length === 0, nameMismatches);

function report() {
  const passed = results.filter(result => result.pass).length;
  for (const result of results) console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name + (result.pass ? '' : '\n      ' + JSON.stringify(result.info).slice(0, 900)));
  console.log(`\n${passed}/${results.length} passed`);
  return passed === results.length ? 0 : 1;
}

if (namesOnly) process.exit(report());

const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
const get = async p => { const r = await fetch(BASE + p); let j = null; try { j = await r.json(); } catch {} return { code: r.status, j }; };
async function waitFor(fn, ms = 30000) { const until = Date.now() + ms; while (Date.now() < until) { try { const value = await fn(); if (value) return value; } catch {} await sleep(250); } return null; }

freshTestOut(OUT); fs.mkdirSync(OUT, { recursive: true });
const run = fs.mkdtempSync(path.join(OUT, 'receipt-')), DATA = path.join(run, 'data');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLqXQAAAABJRU5ErkJggg==', 'base64');
// 紀錄編號須符合 mn-YYYY-MM-DD-HHMMSS-mmm（接口第 1.2 節），否則伺服器按 validateRecord 拒收
const money = (id, payer, amountCents, category, inputId, file) => ({ id, dir: 'out', amountCents, currency: 'HKD', date: '2026-11-07', payer, payerKey: payer, counterpartId: 'pc-receipt', category, what: '咖啡豆 3 公斤', refund: false, evidence: [{ inputId, file, page: 1 }], check: 'image' });
const pack = {
  id: 'ask-receipt', open: true, title: '確認兩張收據', askedBy: 'Zero', askedAt: '2026-11-11T10:00:00+00:00',
  questions: [
    { id: 'q-money-confirm', kind: 'money', ask: '工房乙發票：咖啡豆 HK$2,350', why: '核對收據。', money: money('mn-2026-11-07-100000-001', '工房乙', 235000, 'goods', 'in-receipt-1', '工房乙發票.jpg'), options: [{ text: N.ui.mnyConfirm }, { text: N.ui.mnyConfirmEdit }, { text: N.ui.mnyReject }] },
    { id: 'q-money-edit', kind: 'money', ask: '工房丙發票：咖啡豆 HK$2,350', why: '核對收據。', money: money('mn-2026-11-07-100000-002', '工房丙', 235000, 'goods', 'in-receipt-2', '工房丙發票.jpg'), options: [{ text: N.ui.mnyConfirm }, { text: N.ui.mnyConfirmEdit }, { text: N.ui.mnyReject }] },
    { id: 'q-choice', kind: 'choice', ask: '普通選擇題仍可同包處理？', value: '可以', options: [{ text: '可以' }, { text: '不可以' }] }
  ]
};
write(path.join(DATA, 'founder', 'inbox', 'receipt-1.jpg'), image);
write(path.join(DATA, 'founder', 'inbox', 'receipt-2.jpg'), image);
write(path.join(DATA, 'asks', pack.id + '.json'), pack);
write(path.join(DATA, 'ledger', 'state.json'), {
  schemaVersion: 1, intake: { state: 'complete' }, company: { name: '測試公司', initials: '測試', actors: [{ id: 'pc-receipt', name: '工房乙', label: '工房乙', kind: 'partner', aliases: [], status: 'active', fromMilestoneIds: [], addedAt: '2026-11-01' }] }, tasks: [], events: [], milestones: [], interviews: { applied: {} },
  inputs: [
    { id: 'in-receipt-1', files: ['founder/inbox/receipt-1.jpg'], fileInfo: [{ file: 'founder/inbox/receipt-1.jpg' }] },
    { id: 'in-receipt-2', files: ['founder/inbox/receipt-2.jpg'], fileInfo: [{ file: 'founder/inbox/receipt-2.jpg' }] }
  ]
});
await certifyDirect(DATA, PROTO, ADAPTER);
const server = spawn(process.execPath, [path.join(PROTO, 'server.mjs'), '--port', String(PORT)], { cwd: PROTO, env: { ...process.env, SOS_DATA: DATA, SOS_ADAPTER: ADAPTER, SOS_NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
// 伺服器輸出留作失敗證據（只記最後 20,000 字）
let serverLog = '';
const keepLog = chunk => { serverLog = (serverLog + chunk).slice(-20000); };
server.stdout.on('data', keepLog); server.stderr.on('data', keepLog);
let chrome;

try {
  await waitFor(async () => (await get('/api/status')).code === 200, 15000);
  await usePass(BASE);
  chrome = await openChrome(CHROME, path.join(run, 'profile'), PORT + 1);
  await usePass(BASE, chrome);
  await chrome.go(BASE + '/#/ask/' + pack.id, 1440, 1000);
  ok('RC-02 題目頁顯示兩張收據原圖、金額、名單標籤及三個決定', await waitFor(() => chrome.ev(`(()=>{const one=document.querySelector('#q-q-money-confirm'),two=document.querySelector('#q-q-money-edit');return !!one&&!!two&&one.querySelector('img.money-receipt-img')&&one.innerText.includes(${JSON.stringify(N.ui.mnyListed)})&&one.innerText.includes('HK$2,350.00')&&one.querySelectorAll('.money-receipt-actions .btn').length===3;})()`)), await chrome.ev(`(document.querySelector('#q-q-money-confirm')||{}).innerText||''`));
  await chrome.click('#money-confirm-q-money-confirm');
  ok('RC-03 確認入帳後顯示已入帳摘要', await waitFor(() => chrome.ev(`(document.querySelector('#money-answer-q-money-confirm')||{}).innerText===${JSON.stringify(N.t('mnyReceiptDone', { amount: 'HK$2,350.00' }))}`)));
  await chrome.click('#money-edit-q-money-edit');
  ok('RC-04 修改後入帳展開五個預填欄位', await chrome.ev(`(()=>{const ids=['amount','date','category','what','payer'];return ids.every(k=>!!document.querySelector('#money-'+k+'-q-money-edit'));})()`));
  await chrome.ev(`(()=>{const e=document.querySelector('#money-amount-q-money-edit');e.value='2,500.00';e.dispatchEvent(new Event('input',{bubbles:true}));return e.value;})()`);
  await chrome.click('#money-edit-save-q-money-edit');
  ok('RC-05 修改後入帳摘要採用新金額', await waitFor(() => chrome.ev(`(document.querySelector('#money-answer-q-money-edit')||{}).innerText===${JSON.stringify(N.t('mnyReceiptDone', { amount: 'HK$2,500.00' }))}`)));
  await chrome.go(BASE + '/#/ask/' + pack.id, 390, 844);
  ok('RC-06 390 闊度收據左右內容改為上下，沒有橫向捲動', await waitFor(() => chrome.ev(`(()=>{const e=document.querySelector('.money-receipt-grid');return !!e&&getComputedStyle(e).gridTemplateColumns.split(' ').length===1&&document.documentElement.scrollWidth<=innerWidth;})()`)));
  await chrome.go(BASE + '/#/ask/' + pack.id, 1440, 1000);
  await waitFor(() => chrome.ev('!!document.querySelector("#go-main")'));
  await chrome.click('#go-main');
  const modalText = () => chrome.ev(`(document.querySelector('#modal-root')||{}).innerText||''`);
  const beforeSend = await modalText();
  // 送出前預覽：修改後入帳一項應顯示修改後的金額
  ok('RC-07a 送出前預覽顯示修改後入帳的新金額', beforeSend.includes(N.t('mnyReceiptDone', { amount: 'HK$2,500.00' })), beforeSend.slice(0, 600));
  await chrome.click('#do-confirm');
  const replyFile = await waitFor(() => { const dir = path.join(DATA, 'founder', 'replies'); if (!fs.existsSync(dir)) return null; return fs.readdirSync(dir).find(name => name.endsWith('.md')) || null; });
  const reply = replyFile ? parseFounderReply(fs.readFileSync(path.join(DATA, 'founder', 'replies', replyFile), 'utf8')) : null;
  const receipts = (reply && reply.machine && reply.machine.answers || []).filter(answer => /^q-money-/.test(String(answer.id)));
  // 沒有回覆檔時附上頁面訊息及伺服器紀錄，方便分辨是頁面未送出還是伺服器拒收
  ok('RC-07 送出答案保留確認及修改後入帳的格式', receipts.length === 2 && receipts[0].value === N.ui.mnyConfirm && receipts[1].value === N.ui.mnyConfirmEdit && JSON.stringify(receipts[1].edit) === JSON.stringify({ amount: '2,500.00', date: '2026-11-07', category: 'goods', what: '咖啡豆 3 公斤', payer: '工房丙' }), replyFile ? receipts : { page: (await modalText()).slice(-300), server: serverLog.split('\n').filter(line => /出錯|拒收/.test(line)).slice(-5) });
  // 伺服器先寫待合併檔；外殼隨後可能已合併入 money.json 並刪去待合併檔，所以兩處任一有齊都算（經 /api/money 的 readMoney 讀取，兩處都包括）
  const ids = ['mn-2026-11-07-100000-001', 'mn-2026-11-07-100000-002'];
  const pending = await waitFor(async () => {
    const dir = path.join(DATA, 'ledger', 'money', 'pending'), files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    const records = ((await get('/api/money')).j?.records || []).filter(record => ids.includes(record.id) && record.source === 'receipt');
    return records.length === 2 ? { files, records: records.map(record => [record.id, record.amountCents]) } : null;
  });
  ok('RC-08 伺服器按答案寫入兩筆收據紀錄（修改後入帳採用新金額）', !!pending && pending.records.some(([id, cents]) => id === ids[0] && cents === 235000) && pending.records.some(([id, cents]) => id === ids[1] && cents === 250000), pending);
  ok('RC-09 頁面沒有腳本錯誤', chrome.errors.length === 0, chrome.errors);
} catch (error) {
  ok('收據確認頁面測試程式出錯', false, String(error && error.stack || error));
} finally {
  if (chrome) chrome.close();
  server.kill();
  process.exit(report());
}
