// startup-os Founder Desk：所有畫面名稱嘅唯一定義。改名只改呢度；頁面、外殼（run.mjs）同測試都由呢度讀。
// 規則：名稱（頁名、分頁、標題、按鈕、標記、欄名、步驟名）一律書面語，唔可以有口語字（COLLOQUIAL）；
// 說明句可以白話。公司概覽嘅欄名由格式（資料嘅 plan 欄）決定，唔用 AI 寫入資料嘅 label。
(function (g) {
  // 口語字（2026-10-28 擴充：進行式「緊」、搵、諗、俾、語氣詞；「關係」「聯係」入面嘅「係」唔算；
  // 主線真機核對補：連住、盤生意、成盤、講盤、個位、最平。作連接詞用嘅「同」機械判斷唔到，固定字串靠人手覆核）
  var COLLOQUIAL = /[嘅咗乜唔喺啲咁冇佢嚟哋嗰呢噉嘢啱撳睇揀仲畀晒咩搵諗俾啦喇囉咪]|(?<![關聯維])係|而家|點樣|點解|點先|同埋|邊個|邊度|邊類|邊部分|幾時|幾耐|幾多|頂住|連住|盤生意|成盤|講盤|個位(?!數)|最平|(?:做|擬|寫|備|改|讀|等|判|攻|排|理|開|跑|查|試|整|講|行|跟|傾|放)緊/g;

  var ui = {
    brand: 'Founder Desk',
    // 分頁（導航）
    pending: '待決事項',
    company: '公司概覽',
    log: '決定紀錄',
    // 區段標題
    aiWork: 'AI 近期工作',
    aiAfter: 'AI 後續工作',
    aiOutputs: 'AI 產出（按此展開）',
    yourNext: '你的下一步',
    aiFollowAsk: 'AI 追問',
    otherPending: '其他待決事項',
    answeredBefore: '已作答（{n} 題）',
    answeredN: '作答 {n} 題',
    noPending: '目前沒有待決事項',
    noLog: '尚無紀錄',
    offline: '未能連線',
    sending: '送出中……',
    resend: '★ 重新送出',
    sent: '已交 AI 處理',
    nQuestions: '{n} 題',
    restTitle: '其餘 {n} 題：暫按 AI 建議',
    route: '里程碑路線',
    restAI: 'AI 已擬好的其他內容',
    details: '細節、出處與假設',
    replyBox: '確認內容',
    yourAnswers: '本次答案',
    nowItems: '確認後即時生效',
    fullReply: '查看回覆全文',
    batchHero: '本批 {n} 題',
    batchHeroRest: '本批 {n} 題，其餘 {r} 題暫按 AI 建議',
    packDone: '本問題包已全部作答',
    // 按鈕
    answerN: '作答（{n} 題）',
    viewEdit: '查看／修改',
    goConfirm: '前往確認',
    allLog: '全部決定紀錄',
    adoptGo: '採用 AI 建議並繼續',
    adoptRestGo: '其餘採用 AI 建議並繼續',
    confirmGo: '確認並繼續',
    adoptStart: '採用 AI 建議並開始',
    adoptRestStart: '其餘採用 AI 建議並開始',
    confirmStart: '確認並開始',
    oneByOne: '逐題作答（約 1 分鐘）',
    answerNow: '現在作答',
    next: '下一題 →',
    adoptOne: '採用 AI 建議',
    useDate: '選用此日期',
    custom: '自訂答案…',
    useCustom: '使用自訂答案',
    collapse: '收起',
    restore: '還原 AI 建議',
    submit: '確認並交 AI 處理',
    back: '返回修改',
    moreN: '繼續作答（{n} 題）',
    viewLog: '查看決定紀錄',
    viewAfter: '查看 AI 後續工作',
    retry: '重試',
    stepIntakeReceived: '已收到資料',
    stepIntakeRegistered: '已登記資料',
    stepIntakeAI: 'AI 擬公司概覽',
    stepIntakeReady: '公司概覽已就緒',
    stepReqReceived: '已收到要求',
    stepReqRegistered: '已記錄要求',
    stepReqAI: 'AI 擬定問題',
    stepTaskAI: 'AI 進行臨時工作',
    stepAccept: '記錄驗收結果',
    brainFeedback: '生意大腦意見',
    brainDecide: '生意大腦：需要你決定',
    brainRevise: 'AI 按你意見修改',
    practicePrep: '準備練習場景',
    practicePrepAI: 'AI 準備練習場景',
    practiceDebrief: '會後紀錄',
    practiceDebriefAI: 'AI 按會後紀錄擬跟進問題',
    // 記錄真實事件（規劃書 3.10、3.3）：AI 擬確認問題，你逐項確認後先改證據級同站點進度
    reqEvent: '記錄真實事件',
    eventDate: '事件日期',
    eventFiles: '證明文件（可選）',
    stepEventAI: 'AI 擬定證據級及站點進度的確認問題',
    eventConfirm: '確認真實事件',
    evKeep: '維持',
    evChange: '改為',
    msDoneYes: '已完成，以這次紀錄作證明',
    msDoneNo: '未完成，維持現狀',
    evJudge: '只計對方的行動：對方表示有需要或興趣為「口頭表示」；對方安排會面、提供資料等為「實際行動」；對方付出金錢、時間或承諾為「付出成本」；對方已依賴、停用會有損失為「形成依賴」。',
    msJudge: '完成標準：{c}。證明須為對方的書面回覆、會議紀錄或收據一類；只有記憶而沒有紀錄時，建議先不標示完成。',
    eventAwaiting: '請確認這件事對證據級及站點進度的影響',
    eventNoChange: 'AI 判斷這件事不改變任何假設的證據級或站點進度，已記錄。',
    eventFailed: 'AI 未能整理這件事的影響，請按「重試」',
    eventNeedOverview: '請先確認公司概覽，才可記錄真實事件。',
    aiNextSkip: '已更新公司概覽；改動不影響下一個對外動作，AI 毋須另作準備。',
    // 公司概覽就緒清單（規劃書 3.1）、暫定值來源同限期、里程碑四格、真事／工作判定（7.4）
    readinessMissing: '尚未問齊：{list}',
    tentUntil: '暫定 · 至 {d}',
    tent_ai: 'AI 建議', tent_actor: '對方提出', tent_founder: '你暫定',
    fourCells: '四項資料 {n}／4', fourMissing: '尚欠：{list}',
    kindReal: '真事', kindTask: '工作',
    kindAI: 'AI 判斷：{k}', kindYou: '你判斷：{k}', kindFlip: '改為「{k}」',
    kindHint: '真事：公司以外有人做了某件事，有人見證、有紀錄；工作：我方自己做的事，例如寫好一份文件。',
    // 深化站點（規劃書 3.3 深度檢查五問；透鏡追問）
    depthQ1: '對方為何會點頭？', depthQ2: '對方如何決定、需要多久？', depthQ3: '要先具備甚麼？', depthQ4: '最常見會怎樣失敗？', depthQ5: '為何是這個數字或日期？',
    depthTitle: '深化站點：{s}',
    depthContext: '「{s}」這一站的深度檢查未完成（待深化）。以下每題由你按實情回答；全部有答案、而且只靠推斷的不多於三項，這一站便轉為已深化。',
    depthWhyNone: 'AI 未有根據回答這一項，須由你提供。',
    depthWhyAI: 'AI 按文件推斷，未經證實；如你知道實情，請改寫。',
    msDeepened: '站點已深化：{s}',
    firstTask: '找出缺少的資料：{l}',
    // 真實事件確認：下一個對外動作（規劃書 3.7、附錄 A setNextExternalAction）；確認後唔會再開 AI
    nextActionAsk: '下一個對外動作改為甚麼？',
    nextActionKeep: '維持「{t}」',
    submitApply: '確認', submitApplyNote: '確認後即時更新公司紀錄，不會再開 AI。',
    // 經營節奏（規劃書 3.6、3.8、3.9、3.12、3.14、3.3 站點完成後）
    simBadge: '模擬實例 · 不是生意證據',
    runType_rhythm: '日常工作', runType_interview: '每週訪問', 'runType_on-demand': '即時工作', runType_inbox: '處理收件',
    trig_schedule: '排程', trig_server: '你送出後', trig_manual: '人手',
    skip_intakeNotComplete: '公司概覽未問齊，AI 未開始日常工作', skip_autoStopped: 'AI 已暫停：連續兩次工作都沒有你的輸入或現實進展', skip_pausedByFounder: '已按你的指示暫停',
    skip_budgetExhausted: '今日 AI 啟動已達上限', skip_adapterNotCertified: 'AI 未設定', skip_appliedOnly: '只記錄了你的回覆，今次毋須 AI 跟進', skip_alreadyRan: '今日的排定工作已經做過；補跑不再啟動 AI', runSkipped: '已跳過',
    runEnd_advanced: '有真實進展', runEnd_artifact: '有新產出', runEnd_blocked: '卡住',
    autoStopTitle: 'AI 已暫停：要繼續嗎？', autoStopAsk: 'AI 連續兩次工作都沒有你的輸入或現實進展，已暫停；要繼續嗎？',
    autoStopGo: '繼續', autoStopPause: '暫停', pausedAsk: 'AI 已按你的指示暫停；要繼續嗎？',
    autoStopWhy: '沒有你的輸入，AI 只會重複整理同一批資料；你答一題或交一份資料就會再開始。',
    autoStopRec: '建議繼續：繼續後如兩次工作仍沒有新進展，AI 會再暫停，不會空轉。', pausedWhy: '按「繼續」後，AI 在下一次排定時間開工；期間你交的資料照樣記錄。',
    interviewTitle: '每週訪問（{d}）',
    interviewContext: '每星期一次了解近況。有現值的題目已預填現值，有變化才改；文字題沒有新消息就照建議。',
    interviewNext: '下一個對外動作仍然是「{t}」嗎？', interviewSame: '仍然是（無變化）',
    interviewAssume: '「{a}」現在到了哪個程度？', interviewTent: '「{l}」暫定為「{v}」，照用嗎？', interviewTentKeep: '照用再暫定',
    interviewF1: '這星期現實世界有甚麼進展？哪些事發生了、哪些沒有發生？', interviewF2: '計劃有沒有轉變？', interviewF3: '有沒有新的市場資訊？',
    interviewF4: '有沒有新構思？', interviewF5: '線下會議或對話之中，有沒有 AI 應該知道的事？例如未寫低的口頭決定，或你以為已經批了的事。',
    interviewF6: '待你確認的事項之中，有沒有已經有答案的？',
    interviewNone: '沒有', interviewWhyNone: '預設「沒有」，不是 AI 推斷；有新消息就按「自訂答案」寫一兩句。', interviewWhyNow: '預填公司紀錄的現值；有變化才改。',
    presetTag: '預設', presetWhy: '說明', presetAdopted: '預設', confirmedSame: '你確認沒有變化',
    interviewAllSame: '全部沒有變化', interviewAllSameRest: '其餘全部沒有變化', interviewAllSameNote: '一次記錄：以下題目全部沒有變化，由你確認，不是 AI 代答。',
    staleAsk: '「{t}」的日期（{d}）已過，這件事發生了嗎？', staleHeld: '已舉行', staleMoved: '改了日期', staleCancelled: '取消了',
    staleWhyLedger: '公司紀錄有 {d}的「{t}」，可能與此有關。', staleWhyNone: '公司紀錄沒有相關事件；不知道就先稍後提供，下次訪問再問。',
    heldAsk: '「{t}」結果如何？對方有甚麼回應、有沒有書面紀錄？', heldWhy: '寫一兩句結果，AI 會據此擬確認問題，經你確認才更新進度；未知道就稍後提供。',
    newDateAsk: '「{t}」改到哪一日？', newDateWhy: '確認後下一個對外動作的日期即時更新。',
    next2Ask: '「{t}」取消了；下一個對外動作改為甚麼？', next2Why: '按進行中的一站「{s}」要發生的事填寫；你確認後小旗才移動。',
    overdueAsk: '「{s}」的目標日（{d}）已過，這一站完成了嗎？', overdueDone: '已完成', overdueMove: '改目標日', overdueDrop: '不再做',
    overdueWhyLedger: '公司紀錄有 {d}的「{t}」，可能表示已完成；確認時會再問一次完成標準。', overdueWhyNone: '公司紀錄沒有完成的跡象；不知道就先稍後提供，下次訪問再問。',
    overdueDateAsk: '「{s}」的目標日改為哪一日？', overdueDateWhy: '確認後路線上這一站的目標日即時更新。',
    retireTitle: '撤回一站：{s}', retireAsk: '「{s}」不再做：從路線撤回這一站嗎？', retireYes: '撤回這一站', retireNo: '保留這一站',
    retireWhy: '你在每週訪問答「不再做」；撤回後這一站留在紀錄並標「已撤」，路線由下一站接上。',
    // 交資料「由文件預填」（規劃書 3.1）
    reqDoc: '放入文件', docNeedOverview: '公司概覽確認後，才可放入文件交 AI 閱讀。', docDrop: '把會議紀錄、筆記、證明等文件拖入此處，或按「選擇文件」。AI 只按文件寫明、公司以外已發生的事擬確認題，經你確認後才更新紀錄。',
    docSent: '已收到文件，AI 稍後閱讀', openFolder: '開啟資料夾', openFolderNote: '開啟收件匣資料夾，查看已收到的檔案；要 AI 閱讀新文件，請用上方「放入文件」。', openFolderDone: '已開啟收件匣資料夾', openFolderNoWin: '此環境不會開啟資料夾視窗',
    runNow: '立即開始 AI 工作', runNowNote: '等同手動開工一次；連續兩次開工都沒有你的輸入或現實進展，AI 會自動暫停。', runNowBusy: 'AI 工作進行中，完成後才可再開始。', runNowSent: '已請 AI 開始工作',
    brainJob_checkup: 'AI 生意體檢', brainJob_opportunities: 'AI 商機掃描',
    todayTitle: '今日要做的事', todayNotAuto: '不會自動發生：', firstWeekGuide: '第一星期指引', todayNotOpen: '每週訪問於 {d} 開放',
    prefillGo: '由文件預填', prefillGoNote: 'AI 只讀你加入的文件，按文件原句預填首五條；每條要你確認或改寫，才會隨交資料送出。',
    prefillRunning: 'AI 正在讀你的文件（約一至兩分鐘）', prefillDone: '已按文件預填 {n} 條，請逐條確認或改寫。', prefillFailed: 'AI 未能完成預填',
    prefillDoneSum: '已按文件預填 {n} 條：文件原句 {a} 條、AI 按文件推斷 {b} 條、未能核對原句 {c} 條；文件未有 {d} 條。',
    prefillBad: 'AI 交出的預填格式不正確，請再按一次「由文件預填」',
    prefillTagQuote: 'AI 按文件預填 · 待確認', prefillTagInferred: 'AI 按文件預填 · 待確認 · 按文件推斷，不是原句', prefillTagUnverified: 'AI 按文件預填 · 待確認 · 未能核對原句',
    prefillFrom: '出自《{f}》', prefillFromAny: '出自你加入的文件', prefillAt: '（{a}）', prefillConfirm: '確認這句', prefillUse: '用這句', prefillConfirmed: '已確認', prefillSuggest: 'AI 按文件建議：',
    prefillPending: '尚有 {n} 條預填未確認', prefillUnconfirmed: '尚有 AI 按文件預填的答案未確認，請逐條確認或改寫。', prefillLost: '找不到先前的預填，請再按一次「由文件預填」', prefillNone: '文件未有這項資料，請自行填寫',
    srcYou: '你原話', srcYouDoc: '你原話 · 出自《{f}》', srcAdopted: 'AI 建議 · 你已認同 · 不是文件原句', srcAdoptedUnverified: 'AI 按文件預填 · 你已確認 · 未能核對原句', srcMoved: 'AI 按文件預填 · 由另一題搬來',
    stepPrefillReceived: '已收到文件', stepPrefillRegistered: '已登記文件', stepPrefillAI: 'AI 按文件預填',
    interviewConfirm: '確認訪問答案', interviewSaid: '你在每週訪問（{d}）答：「{t}」。AI 據此擬定以下更新，每項經你確認後才會生效。',
    monthlyTitle: '每月覆核（{d}）', monthlyPerm: 'AI 可自行處理的事，照舊嗎？', monthlyPermKeep: '照舊', monthlyPermNarrow: '收窄',
    monthlyGoal: '本季目標仍然是「{t}」嗎？', monthlyGoalKeep: '仍然是', monthlyWhy: '每四次訪問覆核一次；授權有期限，照舊才繼續生效。', monthlyGoalWhy: '本季目標決定 AI 每日先做哪些工作；有變化才改。',
    trialTitle: '試行到期：{s}', trialAsk: '「{s}」試行已到期，下一步是？', trialPromote: '轉正', trialExtend: '延長一次（四星期）', trialRetire: '撤回',
    trialWhy: '試行已到期或觸及停止條件；未決定前這一站的工作暫停。',
    secondTitle: '開第二站：{s}', secondAsk: '要同時開始「{s}」這一站嗎？', secondYes: '開始，兩站並行', secondNo: '暫不開始',
    debateOfferTitle: '生意體檢建議：開一場紅藍對打', debateOfferAsk: '要就「{t}」開一場紅藍對打嗎？', debateOfferTopic: '生意體檢最弱的環節：{t}',
    debateOfferContext: '生意體檢找出最弱的環節；AI 建議就此開一場紅藍對打：由外部身份逐點攻擊，再把批評變成轉強卡。辯論結果不算證據。',
    debateOfferAfter: '你答「開始」後，AI 會逐回合進行辯論', debateOfferYes: '開始', debateOfferNo: '暫不', debateOfferWhy: '這是生意體檢找出的最弱環節。',
    debateOfferNoted: '已記錄：暫不開辯論。', debateOfferBusy: '已記錄你的答案；目前已有一場辯論未完結，完結後可在 Founder Desk 按「開一場辯論」。',
    oppOfferTitle: '商機掃描：要跟進哪些機會？', oppAsk: '「{t}」：要跟進嗎？',
    oppOfferContext: '商機掃描找到以下機會（AI 建議，不算證據；每項附出處）。你選擇跟進，才會成為工作或交 AI 草擬路線改動。',
    oppOfferAfter: '答案即時生效；做成臨時工作或考慮改路線，AI 會先擬好範圍或選項再問你。',
    oppTask: '做成臨時工作', oppRoute: '考慮因此改路線', oppLater: '暫不', oppDrop: '不再提', oppWhy: '{w}第一個測試：{f}',
    prospectWhy: '推進「{n}」', prospectEvent: 'AI 更新了 {n} 個對象的下一步',
    oppNoteTask: '跟進商機「{t}」：{f}（出處：{s}）', oppNoteRoute: '因應商機「{t}」考慮改路線：{w} 第一個測試：{f}（出處：{s}）', oppDropNote: '你選擇不再提這個機會',
    flagPending: '待更新', nextAfterDone: '「{s}」已完成；下一個對外動作改為甚麼？',
    nextAfterDoneWhy: '小旗原本掛在已完成的一站；AI 按下一站的真事建議，你確認後小旗才移動。',
    schedSim: '模擬計時器（按模擬時鐘）', schedOff: '未登記：在對話輸入「安裝排程」，批准後電腦每日按時叫 AI 開工',
    schedOs: '已登記 · {c} {t}', schedOsStale: '節奏已改，須重新登記：登記時為{c} {t}，現時節奏為{nc} {nt}；在對話輸入「重新登記排程」',
    schedOsMissing: '有登記紀錄，但電腦的排程器讀回時找不到這個排程；在對話輸入「重新登記排程」',
    schedCatchUpOn: '錯過排定時間會在電腦下次可用時盡快補做', schedCatchUpOff: '注意：讀回「錯過即補跑」未開啟，請重新登記',
    schedStaleTodo: '排程節奏已改為 {t}：請重新登記排程', schedReRegister: '重新登記排程', schedGoSystem: '前往系統頁',
    cad_daily: '每日', cad_weekdays: '平日（星期一至五）', cad_weekly: '每星期一次',
    schedLast: '上次實際觸發', schedNext: '下次 AI 開工', schedNever: '未有',
    simClock: '模擬時鐘', simAdvance: '推前一日', simAI: '模擬用 AI', simFake: '假 AI（零費用）', simReal: '真 AI（按次收費）',
    simPersona: 'AI 扮創辦人', simPersonaNote: '扮演者由試走腳本經頁面操作，只讀以下文件；要創辦人判斷的事一律留待創辦人。',
    // 只有你知道的事：AI 未能建議時的選項（規劃書 3.1「未有細節」、4.10 每題必有建議）
    unknownLater: '不知道／稍後提供',
    reload: '重新載入',
    backPending: '返回待決事項',
    goAnswer: '前往作答',
    all: '全部',
    onlyChanged: '只看已修改',
    // 標記
    answered: '已答',
    unanswered: '未答',
    now: '即時生效',
    nowAfter: '確認後即時生效',
    aiRec: '★ AI 建議',
    adopted: '採用建議',
    changed: '已修改',
    tentative: '暫定',
    aiAsk: 'AI 提問',
    yourAsk: '你新增',
    confirmed: '已確認',
    unconfirmed: '未確認',
    fromDoc: '出自你的文件',
    docShort: '文件',
    aiPrefill: 'AI 預填',
    // 欄名
    why: 'AI 建議理由',
    aiOrig: 'AI 原建議',
    customIs: '自訂答案',
    pickDate: '選擇日期',
    orCalendar: '或從日曆選擇',
    batchProgress: '本批已答 {n}／{t}',
    batchAllDone: '✓ 本批已全部作答',
    afterConfirm: '確認後',
    reason: '原因',
    // 處理進度
    track: '交 AI 處理',
    trackDone: '✓ 完成',
    trackRunning: 'AI 處理中',
    trackFailed: '未完成',
    stepReceivedAns: '已收到答案',
    stepReceivedConfirm: '已收到確認',
    stepApplyAns: '記錄答案',
    stepApplyConfirm: '記錄修改與次序',
    stepAppliedAns: '已記錄答案',
    stepAppliedConfirm: '已記錄修改與次序',
    routeOrder: '里程碑路線次序',
    restAdopted: '採用建議（暫定，到期再問）',
    stepQueued: '排隊中',
    aiFollow: 'AI 跟進',
    aiFollowAns: 'AI 按答案跟進',
    aiNext: 'AI 準備下一步',
    staleTitle: '伺服器已重新啟動',
    // 系統設定、AI 未設定、交資料
    setup: '系統設定',
    aiTools: 'AI 工具',
    currentAI: '目前使用',
    certifyGo: '認證並使用',
    certifyRetry: '重新認證',
    certPass: '通過',
    certFail: '未通過',
    certChecking: '檢查中',
    certDate: '認證日期',
    fixHow: '修正方法',
    notInstalled: '未安裝',
    aiNotSet: 'AI 未設定',
    goSetup: '前往設定',
    aiReadyTitle: 'AI 已設定',
    intake: '交資料',
    intakeTitle: '公司背景資料',
    required: '必填',
    optionalN: '選填（{n} 條）',
    files: '文件',
    pickFiles: '選擇文件',
    removeFile: '移除',
    submitIntake: '交 AI 擬公司概覽',
    uploading: '上載中……',
    companyReady: '公司概覽已就緒',
    companyExists: '已有公司概覽',
    goCompany: '前往公司概覽',
    reIntake: '重新交資料',
    requiredProgress: '必填已答 {n}／{t}',
    styleNote: '用字提示',
    autoFixed: '已自動修正',
    noCompany: '未有公司概覽',
    goIntake: '前往交資料',
    // 公司概覽
    companyReady: 'AI 已擬好',
    companyHero: '本批 {n} 題，其餘暫按 AI 建議',
    companyHeroNone: '請檢查，確認後開始',
    milestoneN: '里程碑 {n}',
    orderWhy: 'AI 排序理由',
    orderMoved: '（AI 原排第 {n} 位）',
    afterGoal: '本季目標之後',
    needDepth: '待深化',
    complete: '已齊全',
    depthCheck: '深度檢查',
    watch: '觀察指標',
    cheapTest: '最低成本驗證',
    detailToggle: '細節：深度檢查{gap}、見證人、證明方式 ▾',
    detailClose: '收起細節 ▴',
    gapN: '（尚缺 {n} 項）',
    gapGuess: '（AI 推測過多）',
    viewRoute: '查看各里程碑、調整次序 ▾',
    viewAll: '查看全部 ▾',
    viewEditOpen: '查看／修改 ▾',
    collapseUp: '收起 ▴',
    allNotYet: '全部未發生（AI 建議）',
    changedN: '已修改 {n} 項',
    pendingProgress: '待決事項：已答 {n}／{t}',
    pendingAllDone: '✓ 待決事項已全部作答',
    pendingTitle: '待決事項（已答 {n}／{t}）',
    clearMine: '清除我的修改',
    clearArmed: '再按一次以清除修改',
    demoLoad: '示範：載入其他公司資料',
    downloadOffline: '下載回覆檔（離線）',
    confirmOnly: '確認',
    reviewMore: '查看改動、備註及回覆全文',
    aiFollowAskN: 'AI 追問（{n} 題）',
    loadFail: '載入失敗',
    pickFile: '選擇資料檔',
    fillIn: '待補充 · 按此填寫',
    fillShort: '（待補充）',
    aiUnknown: 'AI 未能回答',
    discardRestart: '放棄修改，重新開始',
    glanceEyebrow: '全文 · 目標與現況',
    glanceTitle: '公司現況與下一步',
    statusNow: '目前進度',
    viewItems: '查看項目 →',
    orderChanged: '次序已調整，確認後生效',
    orderAI: '次序為 AI 建議',
    mapChanged: '次序已調整 · 整頁確認後生效',
    mapAI: '次序未確認 · AI 建議',
    routeTitle: '由現況至目標：{n} 個里程碑',
    needDepthN: '{n} 個里程碑待深化（虛線）',
    flagIsNext: '⚑ 為下一個對外動作',
    detailsTitle: 'AI 的依據、推測與未知',
    missingTitle: '缺少資料',
    missingTag: '已由 AI 暫定，毋須即時補齊',
    howFind: '查找方法',
    actorsTitle: '公司以外的決策者',
    assumptionsTitle: 'AI 假設',
    unverified: '未經證實',
    sourcesTitle: 'AI 依據',
    previewOwners: '各里程碑負責人與目標日期',
    previewDepth: '各里程碑深度檢查',
    missingN: '缺少資料 {n} 項',
    assumptionsN: 'AI 假設 {n} 個',
    readingTitle: 'AI 對業務的解讀',
    actorsStatus: '決策者及其狀態',
    lensTitle: '查漏問題清單',
    rulesTitle: '規則與節奏',
    sourcesName: '資料來源',
    more: '其他',
    offlineView: '離線檢視',
    nextStep: '下一步',
    routeName: '路線',
    changedItems: '已修改項目',
    // 兩個產品互相嘅入口；Founder Desk 交要求
    toDash: '營運監察台',
    reqOrder: '我想改次序／加一站',
    reqAdhoc: '交一件臨時工作',
    reqTitle: '交要求',
    reqSend: '交給 AI',
    reqSent: '已交 AI',
    reqNoCompany: '未有公司概覽',
    // 情景演練（Founder Desk）
    practice: '情景演練', practiceTitle: '練習下一次會面', practiceLabel: '練習 · 不算證據', yourActions: '你要做', practiceAll: '全部練習',
    practiceGo: '練習', practiceAgain: '再練一次', practicePrepare: '準備練習', practiceFree: '練習其他會面', practiceHistory: '練習紀錄', practiceReview: '覆盤', practiceContinue: '繼續練習',
    practiceSeeCard: '查看對方人物卡', practiceBack: '返回情景演練', practicePrepStep: '準備', personaCard: '對方人物卡', goal: '會議目標', practiceQuestions: '要問的問題', practiceObjections: '預計反對意見',
    practiceLevel: '難度', practiceStart: '開始練習', practiceMood: '對方情緒', practiceAsked: '已問', practiceHandled: '已應對', practiceThinking: '對方思考中',
    practiceSend: '送出', practiceHint: '提示', practiceRedo: '重講這句', practiceEnd: '完結',
    practiceSummary: '對方反應摘要', practiceWhy: '對方為何這樣反應', practiceHidden: '對方心底的顧慮', practiceFixes: '要改的地方', practiceBetter: '可以改講',
    practiceCard: '會面卡', practiceDebrief: '會後紀錄', practiceReviewAgain: '重新生成覆盤', cardOpening: '開場一句', cardObjections: '反對應對', cardClosing: '收尾一句',
    // 紅藍對打（Founder Desk）
    debate: '紅藍對打', debateNew: '開一場辯論', debateStart: '開打', debateType: '題目類型', debateTopic: '題目', debateSeats: '紅方席位', debateAddSeat: '加一席',
    debateLevel: '紅方力度', debateFormat: '回合', debateCost: '預計', debateStage: '查看辯論舞台', debateAll: '全部場次', debateBack: '返回紅藍對打',
    debateRespond: '回應這場', debateAdopt: '採用轉強', debateReattack: '紅方再攻第二輪', debateRerun: '重跑未完成的一方', debateRematch: '再打一場',
    debateReq: '開始一場辯論', debateActionReq: '紅藍對打操作', debateAI: 'AI 辯論', plainJob: '改寫顯示用文字',
    dp_blue: '藍方論證', dp_red: '紅方攻擊', dp_rebuttal: '藍方反駁', dp_judge: '裁判判定', dp_rejudge: '裁判重判', dp_strengthen: '轉強出卡', 'dp_reattack-red': '紅方再攻', 'dp_reattack-judge': '裁判判卡'
  };

  // 營運監察台：畫面名稱（書面語）；狀態、欄名、圖例都由呢度讀
  var dash = {
    brand: '營運監察台',
    toDesk: 'Founder Desk',
    // 九個分頁其中七個（另外兩個係 ui.pending、ui.company）
    overview: '公司現況', path: '業務路徑', inputs: '輸入', team: '團隊', log: '紀錄', system: '系統',
    // 一個殼、三組導航（決定二十五）；工具列
    shell: 'startup-os', navDo: '你要做', navRun: '公司運作', navRef: '參考', metricsL: '業務指標',
    noQuarter: '未有里程碑', noPendingShort: '沒有待決事項', repliesWaiting: '你的回覆 {k} · 等 AI 套用',
    refreshNow: '立即讀回', fxOn: '特效 開', fxOff: '特效 關', readNow: '已讀回', readAgo: '讀回 {n} 秒前', reducedNote: '系統已設定減少動態；頁面保留靜態閱讀',
    logDecisions: '決定', logAll: '全部事件', logWork: '全部工作', setupInSystem: 'AI 工具設定', setupInSystemHint: '選擇 AI 工具並完成認證；未設定時 AI 團隊不會開始工作。',
    // 頁首指標
    mQuarter: '本季目標', mPending: '待決事項', mInputs: '現實輸入', mNextInterview: '下次訪問',
    since: '上次離開之後', sinceRuns: 'AI 完成了 {n} 次工作（{m} 次有新產出）', sinceWaiting: '有 {k} 條等你回答', sinceLatest: '最近發生：{t}', sinceNone: '沒有新事項',
    sample: '示範資料 · 虛構公司 · 日期按今日推算',
    live: '本機 LIVE · 5 秒讀回', offline: '連線中斷 · 保留快照', rejected: '狀態被拒 · 保留快照',
    pause: '暫停動效', resume: '恢復動效',
    // 路徑圖
    pathMap: '業務路徑圖', legendConfirmed: '已確認', legendTrial: '試行', legendProposed: 'AI 建議', legendRetired: '已撤', legendFlag: '下一個對外動作',
    orderUnconfirmed: '次序未確認 — 按此確認或調整',
    trialLeft: '試行 · 剩 {n} 日', trialNotStarted: '試行 · 未開始', trialDue: '到期待結論',
    aiSuggest: 'AI 建議：{name}', compare: '比較', adopt: '採用', deepen: '待深化',
    // 待你處理同日程
    todo: '待你處理', allTodo: '全部 {n} 項 →', noTodo: '目前沒有待你處理的事項',
    schedule: '未來兩星期', noSchedule: '未來兩星期沒有排定事項', overdueDays: '已逾期 {n} 日', waitedDays: '已等 {n} 日', today: '今日', tomorrow: '明日',
    scopeAll: '全部',
    // 十格模組
    mod_now: '目前工作', mod_evidence: '進度證據', mod_decisions: '待決事項', mod_paths: '試行與建議路線', 'mod_ai-week': '本週 AI 進展',
    mod_inputs: '現實輸入', mod_team: '團隊', mod_recent: '最近發生', mod_artifacts: '產出物件', mod_system: 'AI 與系統',
    humanCore: '創辦人決定', aiCore: 'AI 團隊',
    deckNext: '下一個關鍵決定', deckChanges: '最近變更', deckFresh: '資料新鮮度',
    // 狀態
    act_working: '工作中', act_doing: '有進行中任務', act_stopped: '已停止', act_waiting: '等待回覆', act_blocked: '受阻', act_idle: '閒置', act_unknown: '待核實', act_not_started: '未啟用',
    ms_not_started: '未開始', ms_active: '進行中', ms_waiting: '等待', ms_blocked: '受阻', ms_done: '已完成',
    ps_confirmed: '已確認', ps_trial: '試行中', ps_proposed: 'AI 建議', ps_retired: '已撤',
    aiUnconfirmed: 'AI 建議 · 未確認', tentative: '暫定',
    // 待你處理類型
    ty_decision: '決定', ty_blocking: '決定', ty_path: '路線決定', ty_acceptance: '驗收', ty_interview: '訪問', ty_inbox: '收件回覆', ty_order: '次序確認', ty_trial: '試行到期', ty_question: '問題', ty_autoStop: 'AI 暫停', todoDue: '期限 {d}',
    sk_interview: '訪問', sk_trial: '試行', sk_target: '目標日', sk_decision: '決定期限', sk_ai: 'AI 開工',
    // 業務路徑分頁
    viewMap: '路線圖', viewTimeline: '時間線',
    groupConfirmed: '已確認', groupTrial: '試行中', groupProposed: 'AI 建議路線', groupRetired: '已撤（{n}）',
    undated: '未定日期', timelineToday: '今日', compareTitle: '路線比較',
    cardRows: '假設|事件鏈|前置與資源|最早可達日期|兩週內首個訊號|失敗訊號與停止條件|回退|對現有里程碑的影響',
    currentPath: '現有路徑', afterAdopt: '採用後會',
    reqOrder: '我想改次序／加一站', reqAdhoc: '交一件臨時工作', reqEvent: '記錄真實事件',
    // 進度證據底部一行假設總覽（規劃書 4.5）
    assumptionsLine: '假設清單：{n} 條仍是假設級 · {m} 條已有實際行動',
    // 看板
    kanban: '工作看板', filterMs: '按里程碑篩選',
    col_todo: '未開始', col_doing: '進行中', col_waiting: '待你回覆', col_blocked: '受阻', col_review: '待你驗收', col_done: '已完成', col_adhoc: '里程碑以外',
    adhocNote: '臨時工作只計產出，不計業務進展', capTag: '能力建設', noTasks: '暫無工作',
    roleCards: '角色卡', capabilities: '能力建設',
    // 現實輸入
    interview: '每週訪問', startInterview: '開始訪問', lastInterview: '上次訪問', changedBy: '因此改了甚麼',
    inbox: '收件匣', unprocessed: '未處理', awaiting: '等你回覆', answer: '回答', recentInputs: '最近已處理', processed: '已處理', evCol: '真實事件', evRecent: '最近記錄',
    // 紀錄
    logEvents: '全部事件', logTasks: '全部工作', search: '搜尋', filterType: '類型', prevPage: '上一頁', nextPage: '下一頁', pageOf: '第 {p}／{n} 頁',
    // 系統
    sysAI: 'AI 工具', goSetup: '前往設定', sysNow: 'AI 現況', sysRuns: '最近 AI 工作', sysRhythm: '經營節奏', sysHealth: '健康提示', sysVersion: '版本資料', sysFresh: '連線與資料新鮮度',
    // 通用
    view: '查看', open: '開啟', close: '關閉', toDeskAsk: '到 Founder Desk 作答', toOverview: '到公司概覽確認',
    blockNoAI: 'AI 未設定', blockNoCompany: '未交資料', blockProofread: '公司概覽待確認', goIntake: '前往交資料', goProofread: '前往校對',
    milestoneDone: '里程碑完成', trialPromoted: '試行轉正',
    // 工作卡：可進行／等候中、等候乜、優先原因、你嘅現實行動、兩站並行
    ready: '可進行', waitingTag: '等候中', waitLabel: '等候', whyLabel: '優先', prepLabel: '準備',
    youDo: '你要做', aiDo: 'AI 做', ownerFilter: '負責', confirmNeeded: '完成需你確認', confirmDone: '確認完成',
    eta: '預計 {d}', parallel: '並行 {n}／2', parallelOk: '第二站經你確認（{d}）', parallelNeed: '第二站未經你確認', parallelOver: '超過兩站同時進行',
    sk_action: '你要做', ty_action: '確認行動', legendActive: '進行期間', legendAction: '你的行動', nextAction: '你下一個行動',
    // 生意大腦（分頁同六項）
    brain: '生意大腦',
    brain_checkup: '生意體檢', brain_wargame: '紅藍對打', brain_scenario: '情景演練', brain_opportunities: '商機掃描', brain_routes: '路線推演', brain_pipeline: '客戶推進追蹤',
    // 運作環陶土 AI 團隊提示（滑鼠停留時顯示）
    clayDoor: '通往公司以外的門：對外行動由你決定，AI 不會自行發送。', clayDoorPending: '門前有待你決定的事項。',
    clayLead_working: 'AI 統籌正在工作枱上處理。', clayLead_salute: 'AI 已準備好，等你指示。', clayLead_sitting: 'AI 已暫停，在工作枱邊等候你的輸入。', clayLead_standing: 'AI 在工作枱邊待命，沒有工作進行中。',
    clayMember: 'AI 團隊成員：一項正在進行的工作。', clayMemberOf: 'AI 團隊成員：正在做{item}。',
    bs_not_started: '未開始', bs_running: 'AI 進行中', bs_waiting: '等你處理', bs_done: '已完成',
    stageBlue: '藍隊論證', stageRed: '紅隊攻擊', stageJudge: '裁判判定', stageSynth: '整合',
    replay: '重播推進', notEvidence: '演練及紅隊結果不算證據；只有真實客戶行為令證據升級',
    evidenceLevel: '證據級', sourceLabel: '來源', cheapestTest: '最低成本測試', stopCondition: '停止條件', weakWhy: '弱點所在',
    weakest: '最薄弱的三個環節', unseen: '你可能未想到', notNow: '目前不建議做', thesis: '主張', whyNowL: '為何是現在',
    topRisks: '最大風險', recRoute: '推薦路線', founderDecide: '需要你決定', assumptionChanges: '假設變動', redScore: '紅隊評分', firstTest: '第一個測試',
    missedRoute: '藍隊遺漏的路線', admitted: '藍隊承認的弱點', strategyAttack: '紅隊對路線的攻擊', putOnDesk: '放上 Founder Desk 作答', chooseRoute: '到 Founder Desk 選擇',
    fbUseful: '有用', fbUseless: '沒有用', fbRevise: '要修改', fbPlaceholder: '一句意見（可留空；要修改請寫改甚麼）', fbSend: '記錄', fbSendRevise: '交給 AI 修改', yourFeedback: '你的意見',
    fbRecorded: '已記錄', runRecordOnly: '只記錄（未開 AI）', fbToAI: '已交 AI 修改', fbQueued: '排隊等候 AI',
    // 證據級（創辦人 2026-10-28 定）：畫面一律顯示名稱，唔顯示級數數字；每級附一句白話解釋
    ev_0: '假設', ev_1: '口頭表示', ev_2: '實際行動', ev_3: '付出成本', ev_4: '形成依賴',
    evd_0: '只是假設，未有任何人表示或行動。', evd_1: '有人表示有需要或有興趣。', evd_2: '有人已採取實際行動，例如安排會面、提供資料。', evd_3: '有人付出金錢、時間或承諾，例如落單、簽約。', evd_4: '對方已經依賴，停用會造成損失。',
    pipe_0: '未接觸',
    claimN: '論點 {n}', cardN: '轉強卡 {n}', assumesL: '涉及關鍵假設',
    // 觀測來源嘅宿主短名（只喺作業網同事件流顯示）
    host_claude: 'Claude', host_codex: 'Codex',
    // 導航分組（只作 aria 標籤同分隔線，畫面唔顯示字）；生意大腦總覽 + 六個分頁（設計稿 2026-10-28）
    brainHome: '總覽', openItem: '打開', backBrain: '返回總覽',
    doneWhere: '做到哪裏', nextL: '下一步', waitingWho: '等誰',
    ww_you: '等你', ww_ai: 'AI 跟進', ww_other: '等對方', ww_none: '—',
    waitStrip: '等你處理（最多三項）',
    sourceFolder: '來源：試驗資料夾 · 未入公司概覽', sourceLedger: '已改由公司紀錄供料：公司概覽確認後，試驗資料夾停用',
    brainRun_checkup: 'AI 正按已確認的公司概覽做生意體檢', brainRun_opportunities: 'AI 正掃描政策、資助與時間窗',
    brainNext_checkup: '公司概覽確認後的首次 AI 工作會做生意體檢', brainNext_opportunities: '生意體檢完成後，每星期掃描一次', brainNext_wargame: '在 Founder Desk 按「開一場辯論」開始',
    brainNext_routes: '紅藍對打完成後，由裁判整合路線', brainNext_pipeline: '公司概覽列出公司以外的決策者後，按你確認的真實事件推進', brainNext_scenario: '有日期的會面行動後，AI 準備練習',
    brainFailedNext: '上次未完成，下一次 AI 工作會再做', brainDone_checkup: '已完成生意體檢', brainDone_opportunities: '已完成商機掃描',
    pipeSummary: '{n} 個對象；格位只按你確認的真實事件推進', pipeNextStation: '下一站：{s}', pipeNoNext: '未有下一步',
    brainWait_wargame: '生意體檢建議開一場紅藍對打，等你決定', brainWait_opportunities: '商機等你決定是否跟進',
    legendL: '圖例',
    blockNoCompanyBrain: '未交資料 · 生意大腦正讀取試驗資料夾',
    blockNoCompanyBrainText: 'AI 未有你公司的正式資料，路徑圖、待你處理及日程暫時只有空架構；生意大腦顯示的是試驗資料夾的內容，未經公司概覽確認。交了資料之後，兩者會合而為一。',
    halfDebate: '上半場 · 辯論', halfStrengthen: '下半場 · 轉強',
    claimsL: '論點逐張', attacksN: '{n} 次攻擊', highN: '高 {n}', expand: '展開', collapseL: '收起', jumpToClaim: '查看這條',
    showAll: '全部展開', showOne: '逐張查看',
    feedbackLog: '你的意見紀錄', feedbackRecent: '最近 {n} 條', feedbackAll: '全部 {n} 條', feedbackNone: '尚未有意見',
    windowAxis: '時間窗由近至遠', kindSupply: '供應', kindCustomer: '客戶',
    // 作業現場（公司現況第一屏）
    workNet: '運作環', eyebrowHuman: '方向與決定', eyebrowAI: '統籌',
    // 運作環第三版（設計稿 2026-10-30）：強度表、節點、對話框、壓縮條、慶祝
    orbitSub: '營運循環：創辦人決定 → AI 統籌分派 → 會話與子代理工作 → 產出 → 創辦人驗收 → 返回決定',
    st_dispatch: 'AI 統籌分派', st_work: '會話與子代理工作', st_accept: '創辦人驗收',
    workLevelL: '工作強度', idleNote: '目前沒有 AI 在工作：沒有亮線、沒有粒子；環的慢轉只是氣氛。', offlineNote: '連線中斷：保留最後紀錄，不代表即時工作。',
    viewDesk: '查看待決事項', openL: '開啟', mainL: '主線', clickDetail: '點擊看詳情', moreTasks: '項更多', milestoneL: '里程碑', metL: '達成', viewing: '正在查看', allL: '全部',
    scopeStatus: '此站任務：進行中 {a} · 等待 {b} · 已交付 {c}', offlineStatus: '回報待核實 · 保留最後紀錄', offlineFocus: '連線中斷 · 保留最後紀錄', idleFocus: '目前沒有 AI 在工作 · 沒有亮線與粒子', unlinkedFocus: '個會話在做未登記的工作', taskUpdated: '任務更新',
    humanHandoff: '已收到你的決定 · 交 AI 團隊', awaitConfirm: '待你確認', stageClearEyebrow: '里程碑已達成', nextStage: '進入下一站',
    sessionDetailL: '會話詳情', nameL: '名稱', latestReqL: '最新請求', lastActiveL: '最後活動', stateL: '狀態', subCountL: '子代理數', linkedTaskL: '對應任務', noName: '讀取不到名稱', noReq: '讀取不到最新請求', notRegistered: '未登記', taskDetailL: '任務詳情', ownerL: '負責', msL: '所屬站點', explainL: '說明',
    ms_planned: '未開始', ms_blocked: '受阻',
    searchL: '搜尋紀錄', pageL: '第 {a} 頁 · 共 {b} 頁', prevL: '上一頁', nextL: '下一頁', logYou: '你', logAI: 'AI', teamLegendL: '工作狀態圖例', signalL: '信號', footRev: '狀態更新', footRead: '最後讀回', footVersion: '版本',
    allWork: '所有工作', otherWork: '其他工作', otherWorkSub: '能力建設', currentL: '目前位置', fullPath: '查看完整路徑圖', stripTitle: '業務路徑', tasksN: '{n} 項任務', noScopeTasks: '此檢視沒有任務', stationN: '第 {n} 站',
    waitedL: '最早一項已等', answerNowL: '現在作答', parallaxHint: '移動滑鼠可微調視角',
    // 即時微動畫（規劃書 4.7 (3)；每秒本機時鐘重算，唔打網路）
    skipToContent: '跳至內容',
    nextRunL: '下次 AI 開工', startsTodayL: '今日 AI 啟動 {a}／{b}', minutesTodayL: '今日用時 {n} 分鐘', costTodayL: '費用約 US${x}', spark24L: '近 24 小時事件',
    sessionsL: '會話', subagentsL: '子代理', tasksL: '任務', tasksSub: 'AI 團隊安排 · 連接會話',
    unlinkedWork: '未登記的工作', unlinkedHint: '這個會話正在工作，但不是 AI 團隊安排的工作',
    observeNone: '本機 AI 會話：未接觀測來源', observeRestricted: '會話紀錄讀取不到', notWorking: '不算工作中',
    litL: '亮線', particlesL: '粒子', noWorkNow: '沒有工作進行中 · 等下一次 AI 開工 {t}', noWorkPlain: '沒有工作進行中', workingNow: '{n} 個會話工作中 · 子代理 {m}',
    eventStream: '即時事件流', eventObserved: '觀測 · 不入紀錄', eventEmpty: '尚無新紀錄 · 最後讀回 {t}', lastRead: '最後讀回 {t}', eventNote: '事件行只由紀錄新事件或會話狀態轉變新增',
    idxTitle: '分類索引', pendingGlobal: '全局 {n} 項待決', observeFolders: '觀察的公司工作資料夾',
    folderUnnamed: '未命名資料夾', sessionUnnamed: '未命名', observeRestrictedEvent: '觀測來源讀取受限',
    observePathInvalid: '請輸入資料夾的完整路徑。', observePathMissing: '找不到這個資料夾，請檢查路徑。', observeFolderGone: '這個資料夾已不在觀察範圍。',
    observeOffText: '本機 AI 會話：未接觀測來源 · 觀測已關閉', observeNoneText: '本機 AI 會話：未接觀測來源', observeNoFolders: '本機 AI 會話：未登記觀察資料夾',
    observeRestrictedText: '觀測來源讀取受限：', observeOkText: '觀測來源：公司工作資料夾 {n} 個', observeTimedOut: '觀測逾時',
    observeAdd: '加入資料夾', observeAddHint: '貼上公司工作資料夾的完整路徑。路徑只用來計算識別碼，不會儲存。', observeNameL: '顯示名稱（可留空）',
    warnCode: 'AI 文字含內部用語：{name}', warnColloquial: 'AI 文字含口語字：{name}', markInternal: '含內部用語',
    docBlue: '紅藍對打藍方', docRed: '紅藍對打紅方', docRebuttal: '紅藍對打藍方反駁', docJudge: '紅藍對打裁判', docStrengthen: '紅藍對打轉強卡',
    observeRemove: '移除', observeOff: '關閉觀測', observeOn: '開啟觀測', observePending: '有 {n} 項更改等待套用', observeSaved: '已收到，稍後生效',
    hostShell: 'AI 團隊', processingL: '處理中',
    // 慶祝特效三級（只由創辦人確認過的真實事件觸發）
    taskDelivered: '任務交付', objectiveDone: '條件達成', stageClear: '里程碑達成', celebrateL: '你確認的真實事件',
    revising: 'AI 修改中', revised: '修改版', revisedFail: '未能修改',
    oppKind: '類別', oppWindow: '時間窗', oppFirst: '第一步測試', nextStepL: '本週建議', materialL: '準備材料', lastRealL: '最近真實行為', rehearsalTag: '演練 · 不算證據',
    brainEmpty: '未有生意大腦資料', brainOverview: '六項總覽', brainProgress: '推進', viewBrain: '查看生意大腦',
    practiceGo: '練習', practiceLastReview: '最近一次覆盤',
    // 紅藍對打：辯論舞台同轉強（設計稿 2026-10-27）
    stage: '辯論舞台', matchN: '第 {n} 場', notEvidenceDebate: '辯論結果不是證據',
    sideBlue: '藍方', sideRed: '紅方', sideJudge: '裁判', sideRebuttal: '藍方反駁', sideStrengthen: '轉強',
    ph_preparing: '準備中', ph_blue: '藍方發言', ph_red: '紅方攻擊', ph_rebuttal: '藍方反駁', ph_judge: '裁判判定', ph_done: '完場', ph_strengthening: '轉強中', ph_reattack: '再攻中', ph_adopt: '待你採用', ph_adopted: '已採用', ph_failed: '未完成',
    tp_business: '整體生意', tp_strategy: '策略或路線', tp_pricing: '定價', tp_partner: '伙伴提案', tp_pitch: '簡報', tp_milestone: '里程碑',
    scoreboard: '記分牌', vStand: '企得住', vHurt: '受傷', vFall: '倒下', blueRate: '藍方企得住率', redHitRate: '紅方命中率', noHitRate: '未有命中紀錄',
    evDist: '證據級分佈', overallL: '裁判總評', deltaL: '較上場', verifiedL: '外部事實核實', verifiedNone: '未有核實紀錄', verifiedOffline: '未開上網：外部事實未能核實',
    keyMoments: '關鍵時刻', km_fall: '一擊倒下', km_top: '最傷', km_blind: '盲點', km_flip: '反轉', km_missed: '遺漏的路線',
    seatAll: '全部身份', seatView: '這個身份如何看你的生意', seatCares: '最在意', seatPain: '攻擊最痛的身份',
    refuteByL: '見到甚麼證據會推翻', failureL: '失敗情境', landedOk: '攻擊成立', landedPart: '部分成立', landedNo: '不成立',
    st_admit: '承認', st_refute: '推翻', st_partial: '部分承認', rejudged: '重判',
    rolesLine: '三方模型', sameProvider: '同一服務商', strategiesRoutes: '路線與策略', redAdded: '紅方補充',
    strengthenCards: '轉強卡', h_fix: '修正', h_flip: '反轉做優勢', h_test: '先驗證', h_watch: '接受並監察',
    cardFrom: '來源', cardCritique: '批評', judgeSaidL: '裁判判定', whyThisL: '為何這樣處理', changesL: '生意模式改動', beforeL: '改前', afterL: '改後', advantageL: '新賣點或合作機會',
    assumptionsL: '假設變化', routeImpactL: '對路線的影響', testL: '兩星期內測試', successL: '成功訊號', costHoursL: '估計 {n} 小時',
    reattackL: '再攻結果', roundN: '第 {n} 輪', notReattacked: '未再攻',
    cs_proposed: '擬議', cs_adopted: '已採用', cs_changed: '已改為先驗證', cs_rejected: '不採用', askFirstL: '必須先問',
    acceptedL: '暫時接受（不出卡）', modelRevision: '生意模式修訂草案', noStrengthen: '未有轉強',
    respond: '回應這場', adoptCards: '採用轉強', rematch: '再打一場', replayAll: '重播', nextAct: '下一幕', autoPlay: '自動播放', skipToEnd: '跳到結果',
    founderL: '你的回應', agreeL: '同意裁判', disagreeL: '不同意', founderEvidence: '你提供的真實證據', founderChallenge: '你挑戰裁判', matchList: '全部場次',
    // AI 先做自己做得到嘅測試（規劃書 3.15）
    testByL: '測試由誰做', tb_ai: 'AI 自己做', tb_founder: '要你做', tb_approval: '要你批准', aiCheckedN: 'AI 已經查了：{n} 項（觀察 {a} · 外部事實 {b}）',
    aiNotChecked: 'AI 未查', aiNotCheckedTime: 'AI 未查：時限不足', lblObs: '觀察', lblFact: '外部事實', readOnL: '查閱 {d}', minutesL: '{n} 分鐘'
  };

  // 公司概覽嘅欄名：由格式（plan）決定
  var field = {
    'G1': '本季目標', 'G1.endsOn': '本季目標期限',
    'G2': '短期目標', 'G2.endsOn': '短期目標期限',
    'G3': '怎樣才算有進展', 'G4': '目前進展', 'G5': '下一個對外動作', 'G6': '負責人',
    'G7': 'AI 可自行處理的事', 'G8': '經營節奏', 'G9': '產品或服務的要求與特色', 'G10': '業務線數目',
    'milestone.event': '里程碑事件', 'milestone.actor': '決策者', 'milestone.witness': '見證人',
    'milestone.evidence': '證明方式', 'milestone.deliveryCondition': '完成標準', 'milestone.targetDate': '目標日期',
    'depth.1': '對方同意的原因', 'depth.2': '決策方式與所需時間', 'depth.3': '前置條件',
    'depth.4': '常見失敗原因', 'depth.5': '日期依據'
  };

  // 舊紀錄入面嘅舊名稱：顯示時換成新名，免得同一樣嘢有兩個名
  var legacy = [
    ['公司一頁', '公司概覽'],
    ['已收到你嘅答案', '已收到答案'], ['已收到你嘅確認', '已收到確認'],
    ['已記低你嘅修改同次序', '已記錄修改與次序'], ['記低你嘅修改同次序', '記錄修改與次序'],
    ['已記低你嘅答案', '已記錄答案'], ['記低你嘅答案', '記錄答案'], ['記低你嘅確認', '記錄確認'],
    ['排緊隊，即刻開始', '排隊中'], ['路上每一站嘅次序', '里程碑路線次序'], ['其餘內容', 'AI 已擬好的其他內容'], ['照 AI 建議（先咁計住，到期再問）', '採用建議（暫定，到期再問）'], ['AI 照你嘅答案繼續做', 'AI 按答案跟進'], ['AI 繼續：', 'AI 跟進：']
  ];

  function fmt(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; }); }
  // 內部工程術語（畫面唔可以出現）：G 編號、英文內部字、檔案路徑或檔名、中文內部字。
  // 路徑只認：磁碟路徑、兩層或以上嘅斜線路徑、內部資料夾開頭；日子（11/23）、A/B 唔算。
  var JARGON = /\b(?:G(?:10|[1-9])|run|sandbox|ledger|bind|purposeKey|artifacts?|receipt|json|schema|founderNext|tentative|id)\b|[A-Za-z]:\\[^\s，。、；：「」（）]*|(?:[\w.-]+\/){2,}[\w.-]+|\b(?:out|data|work|sandbox|ledger|founder|archive)\/[\w./-]*|[^\s，。、；：「」（）]+\.(?:md|json|js|mjs|html|txt)\b|帳本|沙盒|外殼|轉接層/gi;
  // AI 腔：段落開頭嘅客套、收尾總結、主動提議、空泛形容詞同口號（「好的」「當然」只喺段落開頭先算）。
  var AI_TONE = /(?:^|\n)[ \t>#*-]*(?:(?:好的|當然)[，,！!：:。]|以下是|以下係)|很高興|總結來說|總括而言|綜上所述|總而言之|希望對你有幫助|希望以上|如有需要|如有任何問題|隨時告訴我|隨時話我知|我可以幫你|需要我[^。！？?\n]{0,20}[嗎?？]|全方位|一站式|無縫|賦能|極致|革命性|顛覆|打造|助力|引領|卓越|領先|創新驅動|生態圈|閉環|抓手|痛點|賽道/g;
  // 創辦人睇到嘅文字（2026-10-28 創辦人定）：唔可以有內部代號、章節符號、不完整日期、英文欄位名、級數數字
  // 自足檢查（規劃書 3.1 (7)、4.10）：英文字母同數字按整詞比對，所以 4G、英文字片段唔算；完整日期（2026-10-27）、選項標號（A／B／C、1／2／3）唔算。
  // 證據級：級數數字（零級、2 級）同機器值（guess、said、did、paid、stuck）都唔可以出現喺畫面文字。
  var CODE = /\b[BRSHTMDCP]\d{1,3}\b|\b[tmfa]\d{1,3}\b/g, SECTION = /§/g, PART_DATE = /(?<![\d\/-])(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?![\d-])/g,
    FIELD = /\b[a-z]+[A-Z][A-Za-z]*\b|\b[a-z]+_[a-z_]+\b/g, LEVEL = /[零一二三四][級级](?!方程|別)|\b[0-4]\s*級(?!別)|\b(?:guess|said|did|paid|stuck)\b|未有人講過|有人講過|有人做過|有人付出代價|冇咗會痛/g;
  // 名稱表例外清單：普通英文字（品牌、產品名），英文欄位名比對唔計
  var PLAIN_EN = ['iPhone', 'iPad', 'iOS', 'macOS', 'iCloud', 'eBay', 'eCommerce', 'eLearning'];
  // 聲稱字句清單（規劃書 4.10 改寫步）：改寫句唔可以加入原句冇嘅呢啲字句
  var CLAIM_WORDS = ['已簽', '已批准', '已完成', '已確認', '已付', '已同意', '已採用', '已落實', '已成交'];
  // 提示句式建議（2026-10-28 試走）：只有創辦人知道的事，AI 寫「要你提供」「請填寫……」之類當建議；照建議等於交提示句。
  // 外殼見到就改為「不知道／稍後提供」選項（規劃書 4.10 每題必有建議）。
  var PLACEHOLDER = /^(?:要|需要|待)(?:你|您)?(?:提供|確認|填寫|補充|補上)|^(?:未知|不詳|待定|待填|待補|TBD|X{2,}|＿+|_+)[。.]?$|請(?:你|您)?(?:直接|自行|先)?(?:填寫|填上|填入|輸入|提供|補充|寫出|寫下|寫明|簡述|列出|告知)|請按(?:你|您)的實際|^我(?:自己|會)?(?:在回答欄|在答案欄)?(?:填寫|寫明|補上|提供)/;
  function isPlaceholder(s) { return typeof s === 'string' && PLACEHOLDER.test(s.trim()); }
  function styleIssues(s) {
    var result = [];
    [[JARGON, 'jargon'], [AI_TONE, 'tone'], [COLLOQUIAL, 'colloquial'], [CODE, 'code'], [SECTION, 'section'], [PART_DATE, 'date'], [FIELD, 'field'], [LEVEL, 'level']].forEach(function (pair) {
      pair[0].lastIndex = 0;
      var m; while ((m = pair[0].exec(String(s || '')))) if (!(pair[1] === 'field' && PLAIN_EN.indexOf(m[0]) >= 0)) result.push({ kind: pair[1], term: m[0] });
    });
    return result;
  }
  // 口語字嘅書面語代稱：長詞先換；有歧義嘅字（例如作連接詞嘅「同」、「仲」）唔換，只記警告
  var COLLOQUIAL_ALIAS = [
    ['一句話講盤生意', '一句話說明這門生意'], ['成盤生意', '整體生意'], ['講盤生意', '說明這門生意'], ['呢盤生意', '這門生意'], ['這盤生意', '這門生意'], ['盤生意', '門生意'],
    ['最弱三個位置', '最薄弱的三個環節'], ['最弱三個位', '最薄弱的三個環節'], ['最平', '成本最低'], ['連住', '連接'], ['未諗到', '未想到'],
    ['唔係', '不是'], ['唔使', '不用'], ['唔好', '不要'], ['而家', '目前'], ['點樣', '如何'], ['點解', '為何'], ['邊個', '誰'], ['邊度', '哪裏'], ['幾時', '何時'], ['幾多', '多少'],
    ['佢哋', '他們'], ['呢個', '這個'], ['嗰個', '那個'], ['呢啲', '這些'], ['嗰啲', '那些'],
    ['嘅', '的'], ['咗', '了'], ['唔', '不'], ['冇', '沒有'], ['喺', '在'], ['佢', '他'], ['睇', '看'], ['揀', '選'], ['諗', '想'], ['搵', '找'], ['俾', '給'], ['畀', '給'], ['啲', '些'], ['嚟', '來'], ['嘢', '東西']
  ];
  function deColloquial(s) {
    s = String(s == null ? '' : s);
    COLLOQUIAL_ALIAS.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
    return s.replace(/(?<![關聯維])係/g, '是');
  }
  // 證據級（規劃書 3.3）：帳本存機器值 guess|said|did|paid|stuck、辯論檔存數字 0–4；畫面只顯示五級名稱。舊紀錄嘅舊字眼照認。
  var EV_KEYS = ['guess', 'said', 'did', 'paid', 'stuck'], EV_OLD = { none: 0, '未發生': 0, '未有人講過': 0, '有人講過': 1, '有人做過': 2, '有人付出代價': 3, '冇咗會痛': 4 };
  function evIndex(v) {
    if (v == null || v === '') return -1;
    var s = String(v).trim();
    if (/^[0-4]$/.test(s)) return Number(s);
    if (EV_KEYS.indexOf(s) >= 0) return EV_KEYS.indexOf(s);
    if (EV_OLD[s] != null) return EV_OLD[s];
    for (var i = 0; i < 5; i++) if (dash['ev_' + i] === s) return i;
    return -1;
  }
  function evName(v) { var i = evIndex(v); return i < 0 ? String(v == null ? '' : v) : dash['ev_' + i]; }
  function evKey(v) { var i = evIndex(v); return i < 0 ? '' : EV_KEYS[i]; }
  var TODO_ICON = { decision: '◆', blocking: '◆', path: '◆', acceptance: '✓', action: '☑', interview: '☎', inbox: '✉', order: '⇅', trial: '⏱', question: '？', autoStop: '■' };
  var N = {
    TODO_ICON: TODO_ICON, ui: ui, dash: dash, field: field, legacy: legacy, JARGON: JARGON, AI_TONE: AI_TONE, styleIssues: styleIssues, evName: evName, evKey: evKey, EV_KEYS: EV_KEYS, CLAIM_WORDS: CLAIM_WORDS, isPlaceholder: isPlaceholder, deColloquial: deColloquial, COLLOQUIAL_ALIAS: COLLOQUIAL_ALIAS, EV_OLD_NAMES: ['未有人講過', '有人講過', '有人做過', '有人付出代價', '冇咗會痛'],
    t: function (key, v) { return fmt(ui[key] != null ? ui[key] : key, v); },
    d: function (key, v) { return fmt(dash[key] != null ? dash[key] : key, v); },
    fix: function (s) { s = String(s == null ? '' : s); legacy.forEach(function (p) { s = s.split(p[0]).join(p[1]); }); return s; },
    colloquial: function (s) { return String(s || '').match(COLLOQUIAL) || []; },
    isColloquial: function (s) { return N.colloquial(s).length > 0; }
  };
  g.SOS_NAMES = N;
  if (typeof module === 'object' && module.exports) module.exports = N;
})(typeof globalThis !== 'undefined' ? globalThis : this);
