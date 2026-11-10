window.STARTUP_OS_PAGE = {
  "format": "startup-os.proofread/0.1",
  "page": {
    "id": "intake-2026-10-26",
    "kind": "intake",
    "revision": 1,
    "preparedAt": "2026-10-26",
    "nextAskOn": "2026-11-02",
    "latestUntil": "2026-11-23",
    "minutes": 3,
    "replyFolder": "founder/replies/"
  },
  "company": {
    "name": "月月鮮烘",
    "initials": "鮮烘",
    "oneLiner": "把本地小型烘焙工房的新鮮咖啡豆，每月配好寄到愛喝咖啡的上班族家中。"
  },
  "sources": [
    { "id": "doc", "title": "生意構思", "date": "2026-10-25", "note": "現行版本；文件寫明「尚未對外傳送」" },
    { "id": "deck", "title": "合作建議簡報", "date": "2026-10", "note": "現況：工房甲已簽約；工房丙答應先試供兩批；工房乙已退出。" }
  ],

  "glance": {
    "guide": "Zero 已閱讀你的生意構思與合作建議簡報，擬定以下內容。如有不對，按一下修改；沒有問題，就到最底「成頁確認」。",
    "tip": {
      "headline": "下一步：四日後與工房丙會面，確認首份三個月供貨協議",
      "why": "工房丙已答應先試供兩批，四日後會面確認首份三個月供貨協議；這是補足三間工房供貨的下一個真實事件。"
    },
    "rows": [
      {
        "id": "goal-quarter", "plan": "G1",
        "label": "本季要去到哪裏",
        "ask": "本季要去到哪裏？",
        "judge": "要是看得見的真實事件：誰去做？用甚麼證明？",
        "value": "三十位訂戶連續兩個月付費訂閱，同時有三間工房簽約供貨",
        "origin": "ai",
        "why": "你未有數字。以「對方書面答覆」作目標，答覆了就算數，毋須估計數字；伙伴與第一位博主是收款之前必經的兩步。",
        "options": [
          { "text": "三十位訂戶連續兩個月付費訂閱，同時有三間工房簽約供貨", "rec": true },
          { "text": "三十位訂戶連續訂閱兩個月", "note": "較進取：兩個月內完成持續訂閱驗證" },
          { "text": "完成網上收款及寄送設定", "note": "較保守：先令訂閱流程可用" }
        ],
        "tentative": { "by": "ai", "until": "2026-11-02", "test": "11 月 2 日再問你：照用、修改，或者定下來" },
        "due": { "id": "goal-quarter-due", "plan": "G1.endsOn", "kind": "date", "label": "目前目標期限", "value": "2026-12-31", "origin": "ai", "why": "本季最後一日。" }
      },
      {
        "id": "goal-4w", "plan": "G2",
        "label": "短期要去到哪裏",
        "ask": "期限之前，要發生甚麼真實事件？",
        "judge": "誰去做？用甚麼證明？",
        "value": "工房丙完成兩批試供；網上收款及寄送流程可用",
        "origin": "ai",
        "why": "工房丙試供及訂閱流程可用，才可安全開始收款。",
        "options": [
          { "text": "工房丙完成兩批試供；網上收款及寄送流程可用", "rec": true },
          { "text": "工房丙確認三個月供貨協議；收款及寄送設定完成", "note": "先完成供貨及訂閱履約基礎" }
        ],
        "tentative": { "by": "ai", "until": "2026-11-02", "test": "11 月 2 日再問你：照用、修改，或者定下來" },
        "due": { "id": "goal-4w-due", "plan": "G2.endsOn", "kind": "date", "label": "短期目標期限", "value": "2026-11-23", "origin": "ai", "why": "今日是 10 月 26 日，本月只餘 5 日，所以 Zero 以四星期後作期限，代替「本月」。" }
      },
      {
        "id": "progress", "plan": "G3",
        "label": "怎樣才算有進展",
        "ask": "出現甚麼證據，你會認為有進展？",
        "judge": "要是公司以外的人做了的事，不計開會次數。",
        "value": "工房丙完成首批試供，或有訂戶完成首月付款",
        "origin": "ai",
        "why": "供貨可行與實際付款是最早、最清楚的進展證據。",
        "options": [
          { "text": "工房丙完成首批試供，或有訂戶完成首月付款", "rec": true },
          { "text": "有五十位訂戶首月付款" },
          { "text": "有訂戶交回首月回饋" }
        ]
      },
      {
        "id": "next-action", "plan": "G5",
        "label": "下一個對外動作",
        "ask": "下一步對外做甚麼？",
        "judge": "對誰？做甚麼？做完怎樣知道有沒有結果？",
        "value": "四日後與工房丙會面，確認首份三個月供貨協議",
        "origin": "ai",
        "flagTo": "m1",
        "why": "工房丙已答應先試供兩批；會面要確認三個月供貨協議，讓供貨安排可持續。",
        "options": [
          { "text": "四日後與工房丙會面，確認首份三個月供貨協議", "rec": true, "flagTo": "m1" },
          { "text": "完成網上收款及寄送設定，再開放首月訂閱", "note": "先令付款與寄送流程可用", "flagTo": "m2" },
          { "text": "向訂戶收集首月回饋，修正咖啡豆組合", "flagTo": "m1" }
        ]
      }
    ],
    "status": {
      "title": "現在去到哪裏",
      "ask": "以下有沒有已經發生？",
      "judge": "Zero 只可以預填「未發生」。已發生的，按一下選程度。",
      "prepared": "已準備好：生意構思（10 月 25 日版）、合作建議簡報（10 月）",
      "items": [
        { "id": "st-partner", "plan": "G4", "kind": "grade", "label": "工房丙答應先試供兩批", "value": "none", "origin": "ai", "why": "文件寫明「尚未對外傳送」。", "src": [{ "from": "doc", "at": "開頭" }] },
        { "id": "st-media", "plan": "G4", "kind": "grade", "label": "已完成網上收款及寄送設定", "value": "none", "origin": "ai", "why": "文件寫明「尚未對外傳送」。", "src": [{ "from": "doc", "at": "開頭" }] },
        { "id": "st-advisor", "plan": "G4", "kind": "grade", "label": "工房甲已簽供貨協議", "value": "none", "origin": "ai", "why": "文件有寫他的角色，但沒有寫他已答應；Zero 不可以當他已答應。", "src": [{ "from": "doc", "at": "第七節" }] },
        { "id": "st-trial", "plan": "G4", "kind": "grade", "label": "已收集首月訂戶回饋", "value": "none", "origin": "ai", "why": "文件與簡報都未提及哪一位試飲者。" },
        { "id": "st-customer", "plan": "G4", "kind": "grade", "label": "有訂戶完成首次自動扣款", "value": "none", "origin": "ai", "why": "文件寫訂戶付款意願「有待實際接觸了解」。", "src": [{ "from": "doc", "at": "第十二節" }] }
      ]
    }
  },

  "path": {
    "guide": "這五站是 Zero 建議的次序，未確認。次序不對，就按住左邊把手拖動重排；按「細節」查看每站為何這樣定。",
    "tip": {
      "headline": "建議次序：工房丙試供 → 收款及寄送設定 → 五十位首月付款 → 首次自動扣款 → 兩月續訂",
      "why": "先完成工房丙試供與收款寄送設定，再以首月付款、首次自動扣款和兩月續訂逐步驗證。"
    },
    "alt": [
      {
        "title": "另一個排法：先完成收款設定，再安排工房丙試供",
        "sequence": "收款及寄送設定 → 工房丙試供 → 五十位首月付款 → 首次自動扣款 → 兩月續訂",
        "why": "先完成收款及寄送設定，工房丙試供完成後即可承接首月訂閱。",
        "cost": "供貨試做會稍後開始；下一個對外動作轉為完成收款及寄送設定。"
      }
    ],
    "milestones": [
      {
        "id": "m1",
        "short": "工房丙試供",
        "why": "工房丙已答應先試供兩批；四日後確認三個月協議，是補足穩定供貨的首要一步。",
        "event": { "id": "m1-event", "plan": "milestone.event", "label": "第 1 站：真實事件", "value": "工房丙完成兩批試供，並於四日後確認首份三個月供貨協議", "origin": "ai" },
        "actor": { "id": "m1-actor", "plan": "milestone.actor", "label": "第 1 站：決策者", "value": "工房丙 —— 試供中的供貨工房", "origin": "doc", "src": [{ "from": "deck", "at": "合作建議" }] },
        "witness": { "id": "m1-witness", "plan": "milestone.witness", "label": "第 1 站：見證人", "value": "工房丙負責人", "origin": "ai" },
        "proof": { "id": "m1-proof", "plan": "milestone.evidence", "label": "第 1 站：證明方式", "value": "對方電郵，或者經對方確認的會議紀錄", "origin": "ai" },
        "deliver": { "id": "m1-deliver", "plan": "milestone.deliveryCondition", "label": "第 1 站：完成標準", "value": "完成兩批試供，並確認首份三個月供貨協議", "origin": "ai" },
        "owner": { "id": "m1-owner", "plan": "G6", "label": "第 1 站：負責人", "value": "我自己", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：創辦人主導伙伴洽談" }], "options": [{ "text": "我自己", "rec": true }, { "text": "未有" }] },
        "target": { "id": "m1-target", "plan": "milestone.targetDate", "label": "第 1 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-11-23", "origin": "ai", "why": "見面加上對方內部考慮，Zero 估計約四星期。", "tentative": { "by": "ai", "until": "2026-11-02", "test": "四日後會面確認三個月供貨協議" } },
        "watch": [{ "label": "工房丙試供", "value": "未有" }],
        "depth": [
          { "id": "m1-d1", "plan": "depth.1", "label": "第 1 站：對方為何會同意", "value": "增加回程車的載貨量，開拓新的訂戶客戶", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
          { "id": "m1-d2", "plan": "depth.2", "label": "第 1 站：對方怎樣決定、需時多久", "value": "", "origin": "missing", "why": "文件沒有寫工房丙內部由誰拍板、要經多少層。知道了才可以準備合適的人與時間表。", "hint": "例：營運經理拍板，大約一個月" },
          { "id": "m1-d3", "plan": "depth.3", "label": "第 1 站：要先具備甚麼", "value": "合作建議簡報（已有）；分帳與客戶歸屬的初步想法（文件寫待商議）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節" }] },
          { "id": "m1-d4", "plan": "depth.4", "label": "第 1 站：最常見的失敗方式", "value": "口頭有興趣，但不肯說明可以接觸多少間訂戶、怎樣分帳", "origin": "ai", "test": "會後請對方書面列出可以接觸哪類訂戶、大約多少間" },
          { "id": "m1-d5", "plan": "depth.5", "label": "第 1 站：為何是這個日子", "value": "Zero 估計：見面加上對方內部考慮，大約四星期", "origin": "ai", "test": "見面時直接問對方何時可以答覆" }
        ]
      },
      {
        "id": "m2",
        "short": "收款及寄送設定",
        "why": "訂閱收款及寄送流程可用，才能安全開始接收首月訂戶。",
        "event": { "id": "m2-event", "plan": "milestone.event", "label": "第 2 站：真實事件", "value": "網上收款及寄送流程可用", "origin": "ai" },
        "actor": { "id": "m2-actor", "plan": "milestone.actor", "label": "第 2 站：決策者", "value": "付款及寄送服務提供者", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
        "witness": { "id": "m2-witness", "plan": "milestone.witness", "label": "第 2 站：見證人", "value": "流程負責人", "origin": "ai" },
        "proof": { "id": "m2-proof", "plan": "milestone.evidence", "label": "第 2 站：證明方式", "value": "收款測試及寄送流程紀錄", "origin": "ai" },
        "deliver": { "id": "m2-deliver", "plan": "milestone.deliveryCondition", "label": "第 2 站：完成標準", "value": "完成一次付款測試及一次寄送流程演練", "origin": "ai" },
        "owner": { "id": "m2-owner", "plan": "G6", "label": "第 2 站：負責人", "value": "我自己", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：創辦人主導伙伴洽談" }], "options": [{ "text": "我自己", "rec": true }, { "text": "未有" }] },
        "target": { "id": "m2-target", "plan": "milestone.targetDate", "label": "第 2 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-11-23", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "完成一次付款測試及一次寄送流程演練" } },
        "watch": [{ "label": "收款及寄送設定", "value": "未有" }, { "label": "試飲訂戶", "value": "未選" }],
        "depth": [
          { "id": "m2-d1", "plan": "depth.1", "label": "第 2 站：對方為何會同意", "value": "可以把多年家中經驗延伸成顧問服務，令試飲切合訂戶實況", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
          { "id": "m2-d2", "plan": "depth.2", "label": "第 2 站：對方怎樣決定、需時多久", "value": "Zero 估計：他本人決定，一次見面可以談妥", "origin": "ai", "test": "直接約他 30 分鐘" },
          { "id": "m2-d3", "plan": "depth.3", "label": "第 2 站：要先具備甚麼", "value": "顧問角色說明、可投入時間與報酬方式（文件寫待商議）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節" }] },
          { "id": "m2-d4", "plan": "depth.4", "label": "第 2 站：最常見的失敗方式", "value": "時間不足，或者報酬未談妥", "origin": "ai", "test": "見面時先問每月可以投入多少時間" },
          { "id": "m2-d5", "plan": "depth.5", "label": "第 2 站：為何是這個日子", "value": "Zero 估計：與第 1 站並行，四星期內", "origin": "ai" }
        ]
      },
      {
        "id": "m3",
        "short": "首月五十位訂戶",
        "why": "第一個客戶方的真實事件：首月五十位訂戶過真實試飲，才知道他會否想長期落單。",
        "event": { "id": "m3-event", "plan": "milestone.event", "label": "第 3 站：真實事件", "value": "五十位訂戶完成首月付款，並交回回饋", "origin": "ai" },
        "actor": { "id": "m3-actor", "plan": "milestone.actor", "label": "第 3 站：決策者", "value": "首月訂戶 —— 付款客戶", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
        "witness": { "id": "m3-witness", "plan": "milestone.witness", "label": "第 3 站：見證人", "value": "該訂戶博主", "origin": "ai" },
        "proof": { "id": "m3-proof", "plan": "milestone.evidence", "label": "第 3 站：證明方式", "value": "博主書面回覆，或者經他確認的會議紀錄", "origin": "ai" },
        "deliver": { "id": "m3-deliver", "plan": "milestone.deliveryCondition", "label": "第 3 站：完成標準", "value": "五十位訂戶完成首月付款，並交回回饋", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
        "owner": { "id": "m3-owner", "plan": "G6", "label": "第 3 站：負責人", "value": "我自己跟進訂戶；擬由電子商務顧問協助咖啡豆配搭（等他確認）", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：電子商務安排由專業人員負責" }], "options": [{ "text": "我自己跟進訂戶；擬由電子商務顧問協助咖啡豆配搭（等他確認）", "rec": true }, { "text": "我自己" }, { "text": "未有" }] },
        "target": { "id": "m3-target", "plan": "milestone.targetDate", "label": "第 3 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-12-18", "origin": "ai", "why": "選定訂戶後，大約三星期安排試飲、約博主。", "tentative": { "by": "ai", "until": "2026-11-02", "test": "試飲時記錄實際用了多少時間" } },
        "watch": [{ "label": "試用過試飲的博主", "value": "0／1" }],
        "depth": [
          { "id": "m3-d1", "plan": "depth.1", "label": "第 3 站：對方為何會同意", "value": "正準備換季內容、或者標榜本地咖啡豆的訂戶，較容易把服務連到具體需要", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
          { "id": "m3-d2", "plan": "depth.2", "label": "第 3 站：對方怎樣決定、需時多久", "value": "Zero 估計：試用由博主自己決定；之後落單要經訂戶同意", "origin": "ai", "test": "問電子商務顧問：訂戶一般怎樣批核首月訂閱費 的訂單" },
          { "id": "m3-d3", "plan": "depth.3", "label": "第 3 站：要先具備甚麼", "value": "試訂跟進安排，與電子商務顧問的咖啡豆配搭建議", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m3-d4", "plan": "depth.4", "label": "第 3 站：最常見的失敗方式", "value": "訂戶認為現有供應商已經足夠，或者價錢比大型網購平台貴", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m3-d5", "plan": "depth.5", "label": "第 3 站：為何是這個日子", "value": "Zero 估計：選定訂戶後大約三星期", "origin": "ai" }
        ]
      },
      {
        "id": "m4",
        "short": "首次自動扣款",
        "why": "首月試訂者完成自動扣款，才可驗證收款流程是否可持續。",
        "event": { "id": "m4-event", "plan": "milestone.event", "label": "第 4 站：真實事件", "value": "至少十位試訂者完成首次自動扣款", "origin": "ai" },
        "actor": { "id": "m4-actor", "plan": "milestone.actor", "label": "第 4 站：決策者", "value": "完成試訂的訂戶", "origin": "doc", "src": [{ "from": "deck", "at": "合作建議" }] },
        "witness": { "id": "m4-witness", "plan": "milestone.witness", "label": "第 4 站：見證人", "value": "完成扣款的訂戶", "origin": "ai" },
        "proof": { "id": "m4-proof", "plan": "milestone.evidence", "label": "第 4 站：證明方式", "value": "對方書面回覆", "origin": "ai" },
        "deliver": { "id": "m4-deliver", "plan": "milestone.deliveryCondition", "label": "第 4 站：完成標準", "value": "至少十位試訂者完成首次自動扣款", "origin": "ai" },
        "owner": { "id": "m4-owner", "plan": "G6", "label": "第 4 站：負責人", "value": "我自己", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：創辦人主導伙伴洽談" }], "options": [{ "text": "我自己", "rec": true }, { "text": "未有" }] },
        "target": { "id": "m4-target", "plan": "milestone.targetDate", "label": "第 4 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-12-31", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "見面時問對方內部何時可以答覆" } },
        "watch": [{ "label": "首次自動扣款", "value": "未有" }],
        "depth": [
          { "id": "m4-d1", "plan": "depth.1", "label": "第 4 站：對方為何會同意", "value": "以本地工房故事充實內容，吸引關心咖啡豆來源的讀者", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
          { "id": "m4-d2", "plan": "depth.2", "label": "第 4 站：對方怎樣決定、需時多久", "value": "Zero 估計：要經對方內部審批，可能比工房丙久", "origin": "ai", "test": "見面時問由誰拍板、需時多久" },
          { "id": "m4-d3", "plan": "depth.3", "label": "第 4 站：要先具備甚麼", "value": "合作建議簡報（已有）", "origin": "doc", "src": [{ "from": "deck", "at": "全份" }] },
          { "id": "m4-d4", "plan": "depth.4", "label": "第 4 站：最常見的失敗方式", "value": "只肯做一次性推廣，不肯長期合作", "origin": "ai", "test": "請對方書面寫明合作範圍" },
          { "id": "m4-d5", "plan": "depth.5", "label": "第 4 站：為何是這個日子", "value": "Zero 估計：本季最後一日，配合目前目標", "origin": "ai" }
        ]
      },
      {
        "id": "m5",
        "short": "兩月續訂",
        "beyondGoal": true,
        "why": "持續訂閱的驗收站：三十位訂戶連續訂閱兩個月。",
        "event": { "id": "m5-event", "plan": "milestone.event", "label": "第 5 站：真實事件", "value": "三十位訂戶連續訂閱兩個月", "origin": "doc", "src": [{ "from": "doc", "at": "第一節：收費基準" }] },
        "actor": { "id": "m5-actor", "plan": "milestone.actor", "label": "第 5 站：決策者", "value": "訂戶 —— 付款客戶", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
        "witness": { "id": "m5-witness", "plan": "milestone.witness", "label": "第 5 站：見證人", "value": "博主或者訂戶", "origin": "ai" },
        "proof": { "id": "m5-proof", "plan": "milestone.evidence", "label": "第 5 站：證明方式", "value": "確認報價，或者收款紀錄", "origin": "ai" },
        "deliver": { "id": "m5-deliver", "plan": "milestone.deliveryCondition", "label": "第 5 站：完成標準", "value": "三十位訂戶連續訂閱兩個月", "origin": "ai" },
        "owner": { "id": "m5-owner", "plan": "G6", "label": "第 5 站：負責人", "value": "未有", "origin": "ai", "why": "創辦人負責跟進訂戶續訂；工房丙只負責供貨。", "src": [{ "from": "doc", "at": "第六節" }], "options": [{ "text": "未有", "rec": true }, { "text": "我自己" }, { "text": "我自己" }] },
        "target": { "id": "m5-target", "plan": "milestone.targetDate", "label": "第 5 站：目標日期", "kind": "date", "suffix": "前", "value": "2027-01-31", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "問電子商務顧問訂戶一般何時調整供應商" } },
        "watch": [{ "label": "連續訂閱兩月的訂戶", "value": "0／1" }],
        "depth": [
          { "id": "m5-d1", "plan": "depth.1", "label": "第 5 站：對方為何會同意", "value": "試飲令博主看到新鮮咖啡豆的新鮮度與來源，認同值得付較高價錢", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m5-d2", "plan": "depth.2", "label": "第 5 站：對方怎樣決定、需時多久", "value": "Zero 估計：訂戶試訂後自行決定續訂，大約 2–4 星期", "origin": "ai", "test": "向首月訂戶收集續訂意向與口味回饋" },
          { "id": "m5-d3", "plan": "depth.3", "label": "第 5 站：要先具備甚麼", "value": "報價組合與伙伴合作條件（分帳、客戶歸屬、收款）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節" }] },
          { "id": "m5-d4", "plan": "depth.4", "label": "第 5 站：最常見的失敗方式", "value": "認同方向但暫時不轉供應商，或者只在節日落單", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m5-d5", "plan": "depth.5", "label": "第 5 站：為何是這個日子", "value": "Zero 估計：博主回覆後加上批核時間", "origin": "ai" }
        ]
      }
    ]
  },

  "detail": {
    "guide": "這裏是 Zero 的根據、估計與未知。「出自你的文件」是你自己寫過的；「Zero 建議」是 Zero 估計的，最值得你看一眼。",
    "tip": {
      "headline": "最值得你補一句：工房丙內部由誰拍板、需時多久",
      "why": "補了這句，第 1 站就不再「待深化」，Zero 可以替你準備合適的人與時間表。"
    },
    "missing": [
      { "ref": "m1-d2", "title": "工房丙內部由誰拍板、需時多久", "how": "第一次見工房丙時問；問到就按一下補上" },
      {
        "title": "季末目標要有多少伙伴、多少間訂戶",
        "how": "11 月 2 日再問你；照用、修改，或者定下來",
        "edit": { "id": "md-goal-number", "plan": "goals.quarter.number", "label": "季末目標的數字", "value": "兩個伙伴答覆，加一位博主回覆", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "11 月 2 日再問你" } }
      },
      {
        "title": "伙伴分帳、客戶歸屬、由誰收款",
        "how": "等對方提出條件，書面確認時帶入；Zero 不會自行估計數字",
        "edit": { "id": "md-terms", "plan": "partner.terms", "label": "伙伴合作條件", "value": "由對方提出，書面確認時帶入", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節：待商議" }] }
      },
      {
        "title": "每次免費試飲要用多少工時",
        "how": "試飲時記錄實際用了多少時間",
        "edit": { "id": "md-hours", "plan": "cost.trialHours", "label": "每次免費試飲工時", "value": "每間大約 3 小時", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "試飲時記錄實際工時" } }
      },
      { "ref": "m5-d2", "title": "訂戶怎樣批核新供應商、何時調整", "how": "問電子商務顧問" },
      {
        "title": "試飲訂戶選哪一間",
        "how": "與電子商務顧問一起選",
        "edit": { "id": "md-trial", "plan": "sample.trial", "label": "試飲訂戶", "value": "未選；Zero 建議選正準備換季內容、或者標榜本地咖啡豆的訂戶", "origin": "ai", "src": [{ "from": "doc", "at": "第三節" }] }
      }
    ],
    "reading": [
      {"id":"biz-type","plan":"biz.type","label":"生意類型","kind":"choice","value":"實體貨品","origin":"ai","options":[{"text":"服務"},{"text":"實體貨品","rec":true},{"text":"軟件、網上服務或內容"},{"text":"平台或配對"},{"text":"非牟利或社企"},{"text":"其他"}],"why":"只影響問題及例子的用字，可以更改。"},
      {"id":"bm-customer","plan":"canvas.customer","label":"客戶","value":"愛喝咖啡、重視新鮮的上班族在網店訂閱，每月自動付款","origin":"doc","src":[{"from":"doc","at":"第三節"}]},
      {"id":"canvas-problem","plan":"canvas.problem","label":"對方的問題","kind":"text","value":"訂戶需要來源清楚、供應穩定的本地新鮮咖啡豆。","origin":"ai"},
      {"id":"canvas-alternatives","plan":"canvas.alternatives","label":"現有替代方案","kind":"text","value":"訂戶可繼續向大型網購平台或現有咖啡豆供應商採購。","origin":"ai"},
      {"id":"bm-value","plan":"canvas.value","label":"價值","value":"本地小型烘焙工房的新鮮咖啡豆，烘焙後三日內寄出並附口味介紹","origin":"doc","src":[{"from":"doc","at":"第一節"}]},
      {"id":"bm-channel","plan":"canvas.channel","label":"渠道","value":"網店訂閱頁面及咖啡博主推介","origin":"doc","src":[{"from":"deck","at":"九宮格"}]},
      {"id":"bm-relation","plan":"canvas.relationship","label":"客戶關係","value":"試飲裝了解口味 → 首月訂閱 → 自動扣款及兩月續訂","origin":"doc","src":[{"from":"deck","at":"九宮格"}]},
      {"id":"bm-revenue","plan":"canvas.revenue","label":"收入","value":"訂戶按月付訂閱費；首月定價待試訂回饋確認","origin":"doc","src":[{"from":"doc","at":"第一節"}]},
      {"id":"bm-resource","plan":"canvas.resources","label":"關鍵資源","value":"本地烘焙工房的供貨關係、咖啡博主推介及包裝寄貨安排","origin":"doc","src":[{"from":"deck","at":"九宮格"}]},
      {"id":"bm-activity","plan":"canvas.activities","label":"關鍵活動","value":"與工房洽談供貨、寄試飲裝及每月包裝寄貨","origin":"doc","src":[{"from":"deck","at":"九宮格"}]},
      {"id":"bm-partner","plan":"canvas.partners","label":"關鍵伙伴","value":"工房甲（已簽約）、工房丙（先試供兩批）；創辦人正物色兼職包裝人手作後備","origin":"doc","src":[{"from":"doc","at":"第七節"}]},
      {"id":"bm-cost","plan":"canvas.cost","label":"成本","value":"咖啡豆採購、試飲裝、包裝、速遞及推廣成本","origin":"doc","src":[{"from":"doc","at":"第九節"}]}
    ],
    "actors": {
      "title": "公司以外的決策者",
      "judge": "Zero 只照抄文件寫的狀態；沒有寫的當作「商討中」，擬議的當作「建議」。",
      "items": [
        { "id": "ac-partner", "plan": "externalActors", "kind": "choice", "label": "工房丙 · 試供中的供貨工房", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "deck", "at": "標「擬議」" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false },
        { "id": "ac-media", "plan": "externalActors", "kind": "choice", "label": "訂戶 · 首月回饋來源", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "deck", "at": "標「擬議」" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false },
        { "id": "ac-advisor", "plan": "externalActors", "kind": "choice", "label": "創辦人 · 訂閱及供貨協調", "value": "商討中", "origin": "ai", "why": "文件沒有標明他的狀態，只寫「伙伴參與仍屬擬議」，所以 Zero 當作仍在商討。", "src": [{ "from": "doc", "at": "開頭、第七節" }], "options": [{ "text": "已確定" }, { "text": "商討中", "rec": true }, { "text": "建議（對方未知）" }], "free": false },
        { "id": "ac-customer", "plan": "externalActors", "kind": "choice", "label": "網上訂閱的個人訂戶 · 付款客戶", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節：有待實際接觸" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false },
        { "id": "ac-farms", "plan": "externalActors", "kind": "choice", "label": "工房甲、工房丙 · 供應工房", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false }
      ]
    },
    "lens": {
      "id": "lens", "plan": "company.lensIds",
      "label": "Zero 用哪幾類生意的問題清單查漏",
      "value": "網上零售",
      "origin": "ai",
      "why": "客戶是網上訂閱的上班族；收入按月訂閱；要處理工房供貨、試飲裝及包裝寄貨。網店正準備開放訂閱，所以採用「網上零售」清單。",
      "options": [
        { "text": "網上零售", "rec": true },
        { "text": "網上零售 ＋ 咖啡博主推介", "note": "推介安排仍待確認" },
        { "text": "網上零售 ＋ 工房直送", "note": "供貨仍在試做" }
      ]
    },
    "assumptions": [
      { "id": "as-need", "plan": "assumptions", "label": "假設：上班族在超市買不到新鮮烘焙的咖啡豆", "value": "上班族在超市買不到新鮮烘焙的咖啡豆", "origin": "ai", "test": "向試飲者了解超市咖啡豆的烘焙日期是否足夠新鮮" },
      { "id": "as-price", "plan": "assumptions", "label": "假設：咖啡愛好者願意為新鮮烘焙付較高月費", "value": "咖啡愛好者願意為新鮮烘焙付較高月費", "origin": "ai", "test": "就同一款豆向預訂者報兩個月費，記錄選擇" },
      { "id": "as-partner", "plan": "assumptions", "label": "假設：兩間工房可以每月穩定供貨", "value": "兩間工房可以每月穩定供貨", "origin": "ai", "test": "記錄兩間工房連續兩批交貨是否準時及缺貨比例" },
      { "id": "as-media", "plan": "assumptions", "label": "假設：創辦人親自包裝寄貨足以應付首五十位訂戶", "value": "創辦人親自包裝寄貨足以應付首五十位訂戶", "origin": "ai", "test": "試行一晚包裝五十包，並記錄時間" },
      { "id": "as-cost", "plan": "assumptions", "label": "假設：試飲成本可以承受", "value": "試飲裝成本與包裝時間可由創辦人處理", "origin": "ai", "test": "試飲時記錄實際工時" },
      { "id": "as-procure", "plan": "assumptions", "label": "假設：訂戶轉供應商有固定程序", "value": "訂戶願意由超市咖啡豆轉為每月訂閱", "origin": "ai", "test": "向首月訂戶收集續訂意向與口味回饋" }
    ],
    "rules": [
      {
        "id": "permissions", "plan": "G7", "effect": true,
        "label": "Zero 可自行處理的事",
        "ask": "哪些事 Zero 毋須問你都可以做？",
        "judge": "確認後即時生效；Zero 只可以建議預設或者更窄。",
        "value": "用預設",
        "origin": "default",
        "options": [
          { "text": "用預設", "rec": true },
          { "text": "收窄：連起草對外訊息都要先問我" }
        ],
        "boxes": {
          "auto": ["閱讀與分析項目內的檔案", "不帶私人資料的網上研究", "起草內部文件與草稿（信、簡報大綱、清單）", "處理你放入的會議紀錄", "準備每週問你的問題"],
          "tellAfter": ["因你的新資料更新對生意的理解", "同一站內增減或重排工作", "開新的 Zero 崗位（未啟用）"],
          "askFirst": ["任何對外聯絡", "花錢或者簽約", "作出承諾（價錢、日期、條件）", "啟用 Zero 崗位", "改目標或者次序", "刪除或者移走你的檔案", "發布、上傳等對外或者不可以回頭的操作"]
        }
      },
      {
        "id": "rhythm", "plan": "G8",
        "label": "Zero 多久工作一次",
        "ask": "Zero 多久自己工作一次、星期幾問你近況？",
        "value": "每日晚上 9 時工作一次；星期一問你近況",
        "origin": "default",
        "options": [
          { "text": "每日晚上 9 時工作一次；星期一問你近況", "rec": true },
          { "text": "平日晚上 9 時工作一次；星期一問你近況" },
          { "text": "每星期一早上 9 時工作一次，同日問你近況" }
        ]
      },
      {
        "id": "product-notes", "plan": "G9",
        "label": "一定要做到的要求",
        "ask": "產品或服務有甚麼非做不可、或者特別之處？",
        "value": "標示烘焙日期；烘焙後三日內寄出；附口味介紹；試飲裝可供體驗",
        "origin": "doc",
        "src": [{ "from": "doc", "at": "第三、七、十二節" }]
      },
      {
        "id": "lines", "plan": "G10",
        "label": "業務線數目",
        "ask": "有沒有兩條互不相干的業務（不同客戶、不同收入）？",
        "value": "一條：訂戶供應",
        "origin": "ai",
        "why": "網店正準備開放訂閱，所以用「網上零售」清單。",
        "options": [
          { "text": "一條：訂戶供應", "rec": true },
          { "text": "一條：網上零售" }
        ]
      }
    ]
  }
};
