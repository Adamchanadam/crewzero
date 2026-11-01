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
    "name": "從田間到餐桌",
    "initials": "田桌",
    "oneLiner": "（虛構示範）把本地小農的當季蔬菜直送中小型餐廳，每箱註明農場來源。"
  },
  "sources": [
    { "id": "doc", "title": "生意構思", "date": "2026-10-25", "note": "現行版本；文件寫明「尚未對外傳送」" },
    { "id": "deck", "title": "合作建議簡報", "date": "2026-10", "note": "綠野物流、食材周報標「擬議」；最後一頁寫「先試送一次，再商議合作條件」" }
  ],

  "glance": {
    "guide": "AI 已閱讀你的生意構思與合作建議簡報，擬定以下內容。如有不對，按一下修改；沒有問題，就到最底「成頁確認」。",
    "tip": {
      "headline": "下一步：約綠野物流介紹合作建議簡報",
      "why": "文件擬由綠野物流接觸餐廳並負責送貨，但對方未答應。對方是否參與，決定你之後是否要自己逐間餐廳洽談；簡報已準備好，是目前最快可以發生的真實事件。"
    },
    "rows": [
      {
        "id": "goal-quarter", "plan": "G1",
        "label": "本季要去到哪裏",
        "ask": "本季要去到哪裏？",
        "judge": "要是看得見的真實事件：誰去做？用甚麼證明？",
        "value": "綠野物流與食材周報都書面答覆是否參與（接受或拒絕都算），而且有一位主廚試用試送後書面回覆",
        "origin": "ai",
        "why": "你未有數字。以「對方書面答覆」作目標，答覆了就算數，毋須估計數字；伙伴與第一位主廚是收款之前必經的兩步。",
        "options": [
          { "text": "綠野物流與食材周報都書面答覆是否參與（接受或拒絕都算），而且有一位主廚試用試送後書面回覆", "rec": true },
          { "text": "第一間餐廳付款訂購（每週最少 HK$1,500）", "note": "較進取：兩個月內要處理好伙伴、試送與餐廳落單" },
          { "text": "見齊伙伴並收到答覆即可", "note": "較保守：本季只處理伙伴" }
        ],
        "tentative": { "by": "ai", "until": "2026-11-02", "test": "11 月 2 日再問你：照用、修改，或者定下來" },
        "due": { "id": "goal-quarter-due", "plan": "G1.endsOn", "kind": "date", "label": "本季目標期限", "value": "2026-12-31", "origin": "ai", "why": "本季最後一日。" }
      },
      {
        "id": "goal-4w", "plan": "G2",
        "label": "短期要去到哪裏",
        "ask": "期限之前，要發生甚麼真實事件？",
        "judge": "誰去做？用甚麼證明？",
        "value": "綠野物流書面答覆；何師傅確認擔任廚藝顧問，並與你選定一間試送餐廳",
        "origin": "ai",
        "why": "這兩件事是安排試送之前必須具備的。",
        "options": [
          { "text": "綠野物流書面答覆；何師傅確認擔任廚藝顧問，並與你選定一間試送餐廳", "rec": true },
          { "text": "綠野物流、食材周報、何師傅三方都見過並答覆", "note": "伙伴先行，試送餐廳之後才選" }
        ],
        "tentative": { "by": "ai", "until": "2026-11-02", "test": "11 月 2 日再問你：照用、修改，或者定下來" },
        "due": { "id": "goal-4w-due", "plan": "G2.endsOn", "kind": "date", "label": "短期目標期限", "value": "2026-11-23", "origin": "ai", "why": "今日是 10 月 26 日，本月只餘 5 日，所以 AI 以四星期後作期限，代替「本月」。" }
      },
      {
        "id": "progress", "plan": "G3",
        "label": "怎樣才算有進展",
        "ask": "出現甚麼證據，你會認為有進展？",
        "judge": "要是公司以外的人做了的事，不計開會次數。",
        "value": "有人書面答覆（伙伴或主廚；接受或拒絕都算）",
        "origin": "ai",
        "why": "本季仍未到收款階段，對方書面答覆是最早、最清楚的證據；拒絕也是有用的答案。",
        "options": [
          { "text": "有人書面答覆（伙伴或主廚；接受或拒絕都算）", "rec": true },
          { "text": "有餐廳付款" },
          { "text": "有主廚試用試送並提供意見" }
        ]
      },
      {
        "id": "next-action", "plan": "G5",
        "label": "下一個對外動作",
        "ask": "下一步對外做甚麼？",
        "judge": "對誰？做甚麼？做完怎樣知道有沒有結果？",
        "value": "用合作建議簡報約綠野物流介紹，請對方答覆是否參與、想承接哪部分",
        "origin": "ai",
        "flagTo": "m1",
        "why": "簡報已準備好；文件擬由綠野物流接觸餐廳並負責送貨，對方是否願意，決定你是否要自己逐間餐廳洽談。",
        "options": [
          { "text": "用合作建議簡報約綠野物流介紹，請對方答覆是否參與、想承接哪部分", "rec": true, "flagTo": "m1" },
          { "text": "先約何師傅，一起選試送餐廳、安排第一次試送", "note": "簡報最後一頁：先試送，再見伙伴", "flagTo": "m2" },
          { "text": "同時約綠野物流與食材周報，一次過介紹", "flagTo": "m1" }
        ]
      }
    ],
    "status": {
      "title": "現在去到哪裏",
      "ask": "以下有沒有已經發生？",
      "judge": "AI 只可以預填「未發生」。已發生的，按一下選程度。",
      "prepared": "已準備好：生意構思（10 月 25 日版）、合作建議簡報（10 月）",
      "items": [
        { "id": "st-partner", "plan": "G4", "kind": "grade", "label": "已向綠野物流介紹合作建議簡報", "value": "none", "origin": "ai", "why": "文件寫明「尚未對外傳送」。", "src": [{ "from": "doc", "at": "開頭" }] },
        { "id": "st-media", "plan": "G4", "kind": "grade", "label": "已向食材周報介紹合作建議簡報", "value": "none", "origin": "ai", "why": "文件寫明「尚未對外傳送」。", "src": [{ "from": "doc", "at": "開頭" }] },
        { "id": "st-advisor", "plan": "G4", "kind": "grade", "label": "何師傅答應擔任廚藝顧問", "value": "none", "origin": "ai", "why": "文件有寫他的角色，但沒有寫他已答應；AI 不可以當他已答應。", "src": [{ "from": "doc", "at": "第七節" }] },
        { "id": "st-trial", "plan": "G4", "kind": "grade", "label": "已選定試送餐廳", "value": "none", "origin": "ai", "why": "文件與簡報都未提及哪一間餐廳。" },
        { "id": "st-customer", "plan": "G4", "kind": "grade", "label": "有餐廳試用過試送、或者洽談過", "value": "none", "origin": "ai", "why": "文件寫餐廳付款意願「有待實際接觸了解」。", "src": [{ "from": "doc", "at": "第十二節" }] }
      ]
    }
  },

  "path": {
    "guide": "這五站是 AI 建議的次序，未確認。次序不對，就按住左邊把手拖動重排；按「細節」查看每站為何這樣定。",
    "tip": {
      "headline": "建議次序：綠野物流 → 何師傅 → 主廚試用 → 食材周報 → 第一間付款餐廳",
      "why": "先問清楚擬負責送貨與接觸餐廳的伙伴是否願意，再安排試送給主廚；食材周報不影響第一間餐廳，所以排後；收款一站在本季目標之後。"
    },
    "alt": [
      {
        "title": "另一個排法：先試送，再見伙伴",
        "sequence": "何師傅 → 主廚試用 → 綠野物流 → 食材周報 → 第一間付款餐廳",
        "why": "簡報最後一頁寫「先試送一次，再商議合作條件」；見伙伴時有真實試送結果，較有說服力。",
        "cost": "大約遲 3–4 星期才知道綠野物流是否願意送貨；下一個對外動作會變成約何師傅。想這樣排，就把第 2、3 站拖到最前。"
      }
    ],
    "milestones": [
      {
        "id": "m1",
        "short": "綠野物流答覆",
        "why": "你下一個對外動作就是見綠野物流，所以排第一；對方是否願意送貨與接觸餐廳，決定之後是否要你自己逐間餐廳洽談。",
        "event": { "id": "m1-event", "plan": "milestone.event", "label": "第 1 站：真實事件", "value": "綠野物流看完合作建議簡報後，書面答覆是否參與、想承接哪部分（接受或拒絕都算）", "origin": "ai" },
        "actor": { "id": "m1-actor", "plan": "milestone.actor", "label": "第 1 站：決策者", "value": "綠野物流 —— 擬議送貨與銷售伙伴", "origin": "doc", "src": [{ "from": "deck", "at": "合作建議" }] },
        "witness": { "id": "m1-witness", "plan": "milestone.witness", "label": "第 1 站：見證人", "value": "綠野物流負責人", "origin": "ai" },
        "proof": { "id": "m1-proof", "plan": "milestone.evidence", "label": "第 1 站：證明方式", "value": "對方電郵，或者經對方確認的會議紀錄", "origin": "ai" },
        "deliver": { "id": "m1-deliver", "plan": "milestone.deliveryCondition", "label": "第 1 站：完成標準", "value": "答覆寫明承接範圍（接觸餐廳、送貨、收款）與初步條件；或者明確拒絕", "origin": "ai" },
        "owner": { "id": "m1-owner", "plan": "G6", "label": "第 1 站：負責人", "value": "我自己", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：創辦人主導伙伴洽談" }], "options": [{ "text": "我自己", "rec": true }, { "text": "未有" }] },
        "target": { "id": "m1-target", "plan": "milestone.targetDate", "label": "第 1 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-11-23", "origin": "ai", "why": "見面加上對方內部考慮，AI 估計約四星期。", "tentative": { "by": "ai", "until": "2026-11-02", "test": "見完綠野物流後問對方何時可以答覆" } },
        "watch": [{ "label": "綠野物流答覆", "value": "未有" }],
        "depth": [
          { "id": "m1-d1", "plan": "depth.1", "label": "第 1 站：對方為何會同意", "value": "增加回程車的載貨量，開拓新的餐廳客戶", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
          { "id": "m1-d2", "plan": "depth.2", "label": "第 1 站：對方怎樣決定、需時多久", "value": "", "origin": "missing", "why": "文件沒有寫綠野物流內部由誰拍板、要經多少層。知道了才可以準備合適的人與時間表。", "hint": "例：營運經理拍板，大約一個月" },
          { "id": "m1-d3", "plan": "depth.3", "label": "第 1 站：要先具備甚麼", "value": "合作建議簡報（已有）；分帳與客戶歸屬的初步想法（文件寫待商議）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節" }] },
          { "id": "m1-d4", "plan": "depth.4", "label": "第 1 站：最常見的失敗方式", "value": "口頭有興趣，但不肯說明可以接觸多少間餐廳、怎樣分帳", "origin": "ai", "test": "會後請對方書面列出可以接觸哪類餐廳、大約多少間" },
          { "id": "m1-d5", "plan": "depth.5", "label": "第 1 站：為何是這個日子", "value": "AI 估計：見面加上對方內部考慮，大約四星期", "origin": "ai", "test": "見面時直接問對方何時可以答覆" }
        ]
      },
      {
        "id": "m2",
        "short": "何師傅確認",
        "why": "試送要靠他判斷主廚關心甚麼；他確認後才可以選定試送餐廳。",
        "event": { "id": "m2-event", "plan": "milestone.event", "label": "第 2 站：真實事件", "value": "何師傅書面確認擔任廚藝顧問、每月可以投入多少時間，並與你選定一間試送餐廳", "origin": "ai" },
        "actor": { "id": "m2-actor", "plan": "milestone.actor", "label": "第 2 站：決策者", "value": "何師傅 —— 廚藝顧問", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
        "witness": { "id": "m2-witness", "plan": "milestone.witness", "label": "第 2 站：見證人", "value": "何師傅本人", "origin": "ai" },
        "proof": { "id": "m2-proof", "plan": "milestone.evidence", "label": "第 2 站：證明方式", "value": "何師傅的書面確認（電郵或訊息）", "origin": "ai" },
        "deliver": { "id": "m2-deliver", "plan": "milestone.deliveryCondition", "label": "第 2 站：完成標準", "value": "寫明顧問角色、可投入時間與報酬方式（或者寫明稍後再談），並選定試送餐廳", "origin": "ai" },
        "owner": { "id": "m2-owner", "plan": "G6", "label": "第 2 站：負責人", "value": "我自己", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：創辦人主導伙伴洽談" }], "options": [{ "text": "我自己", "rec": true }, { "text": "未有" }] },
        "target": { "id": "m2-target", "plan": "milestone.targetDate", "label": "第 2 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-11-23", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "直接約何師傅 30 分鐘" } },
        "watch": [{ "label": "何師傅確認", "value": "未有" }, { "label": "試送餐廳", "value": "未選" }],
        "depth": [
          { "id": "m2-d1", "plan": "depth.1", "label": "第 2 站：對方為何會同意", "value": "可以把多年廚房經驗延伸成顧問服務，令試送切合餐廳實況", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
          { "id": "m2-d2", "plan": "depth.2", "label": "第 2 站：對方怎樣決定、需時多久", "value": "AI 估計：他本人決定，一次見面可以談妥", "origin": "ai", "test": "直接約他 30 分鐘" },
          { "id": "m2-d3", "plan": "depth.3", "label": "第 2 站：要先具備甚麼", "value": "顧問角色說明、可投入時間與報酬方式（文件寫待商議）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節" }] },
          { "id": "m2-d4", "plan": "depth.4", "label": "第 2 站：最常見的失敗方式", "value": "時間不足，或者報酬未談妥", "origin": "ai", "test": "見面時先問每月可以投入多少時間" },
          { "id": "m2-d5", "plan": "depth.5", "label": "第 2 站：為何是這個日子", "value": "AI 估計：與第 1 站並行，四星期內", "origin": "ai" }
        ]
      },
      {
        "id": "m3",
        "short": "主廚試用",
        "why": "第一個客戶方的真實事件：主廚試用過真實試送，才知道他會否想長期落單。",
        "event": { "id": "m3-event", "plan": "milestone.event", "label": "第 3 站：真實事件", "value": "一位主廚試用試送後，書面回覆是否想深入洽談（想或者暫時不需要都算）", "origin": "ai" },
        "actor": { "id": "m3-actor", "plan": "milestone.actor", "label": "第 3 站：決策者", "value": "試送餐廳的主廚 —— 付款客戶的決策人", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
        "witness": { "id": "m3-witness", "plan": "milestone.witness", "label": "第 3 站：見證人", "value": "該餐廳主廚", "origin": "ai" },
        "proof": { "id": "m3-proof", "plan": "milestone.evidence", "label": "第 3 站：證明方式", "value": "主廚書面回覆，或者經他確認的會議紀錄", "origin": "ai" },
        "deliver": { "id": "m3-deliver", "plan": "milestone.deliveryCondition", "label": "第 3 站：完成標準", "value": "試送一箱當季蔬菜（附農場來源與收成日期）交到主廚手上，主廚書面回覆", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
        "owner": { "id": "m3-owner", "plan": "G6", "label": "第 3 站：負責人", "value": "我自己約主廚；擬由何師傅判斷菜式配搭（等他確認）", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：廚藝判斷由專業人員負責" }], "options": [{ "text": "我自己約主廚；擬由何師傅判斷菜式配搭（等他確認）", "rec": true }, { "text": "我自己" }, { "text": "未有" }] },
        "target": { "id": "m3-target", "plan": "milestone.targetDate", "label": "第 3 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-12-18", "origin": "ai", "why": "選定餐廳後，大約三星期安排試送、約主廚。", "tentative": { "by": "ai", "until": "2026-11-02", "test": "試送時記錄實際用了多少時間" } },
        "watch": [{ "label": "試用過試送的主廚", "value": "0／1" }],
        "depth": [
          { "id": "m3-d1", "plan": "depth.1", "label": "第 3 站：對方為何會同意", "value": "正準備換季菜單、或者標榜本地食材的餐廳，較容易把服務連到具體需要", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
          { "id": "m3-d2", "plan": "depth.2", "label": "第 3 站：對方怎樣決定、需時多久", "value": "AI 估計：試用由主廚自己決定；之後落單要經餐廳老闆同意", "origin": "ai", "test": "問何師傅：餐廳一般怎樣批核每週 HK$1,500 的訂單" },
          { "id": "m3-d3", "plan": "depth.3", "label": "第 3 站：要先具備甚麼", "value": "試送安排，與何師傅的菜式建議", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m3-d4", "plan": "depth.4", "label": "第 3 站：最常見的失敗方式", "value": "餐廳認為現有供應商已經足夠，或者價錢比批發市場貴", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m3-d5", "plan": "depth.5", "label": "第 3 站：為何是這個日子", "value": "AI 估計：選定餐廳後大約三星期", "origin": "ai" }
        ]
      },
      {
        "id": "m4",
        "short": "食材周報答覆",
        "why": "文件擬由食材周報協助推廣（未答應），但第一間餐廳不靠它，所以可以同時進行，排後也不影響。",
        "event": { "id": "m4-event", "plan": "milestone.event", "label": "第 4 站：真實事件", "value": "食材周報看完合作建議簡報後，書面答覆是否以品牌與渠道參與（接受或拒絕都算）", "origin": "ai" },
        "actor": { "id": "m4-actor", "plan": "milestone.actor", "label": "第 4 站：決策者", "value": "食材周報 —— 擬議推廣渠道伙伴", "origin": "doc", "src": [{ "from": "deck", "at": "合作建議" }] },
        "witness": { "id": "m4-witness", "plan": "milestone.witness", "label": "第 4 站：見證人", "value": "食材周報負責人", "origin": "ai" },
        "proof": { "id": "m4-proof", "plan": "milestone.evidence", "label": "第 4 站：證明方式", "value": "對方書面回覆", "origin": "ai" },
        "deliver": { "id": "m4-deliver", "plan": "milestone.deliveryCondition", "label": "第 4 站：完成標準", "value": "答覆寫明合作範圍（品牌、推廣、讀者優惠）；或者明確拒絕", "origin": "ai" },
        "owner": { "id": "m4-owner", "plan": "G6", "label": "第 4 站：負責人", "value": "我自己", "origin": "doc", "src": [{ "from": "doc", "at": "第七節：創辦人主導伙伴洽談" }], "options": [{ "text": "我自己", "rec": true }, { "text": "未有" }] },
        "target": { "id": "m4-target", "plan": "milestone.targetDate", "label": "第 4 站：目標日期", "kind": "date", "suffix": "前", "value": "2026-12-31", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "見面時問對方內部何時可以答覆" } },
        "watch": [{ "label": "食材周報答覆", "value": "未有" }],
        "depth": [
          { "id": "m4-d1", "plan": "depth.1", "label": "第 4 站：對方為何會同意", "value": "以本地農場故事充實內容，吸引關心食材來源的讀者", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
          { "id": "m4-d2", "plan": "depth.2", "label": "第 4 站：對方怎樣決定、需時多久", "value": "AI 估計：要經對方內部審批，可能比綠野物流久", "origin": "ai", "test": "見面時問由誰拍板、需時多久" },
          { "id": "m4-d3", "plan": "depth.3", "label": "第 4 站：要先具備甚麼", "value": "合作建議簡報（已有）", "origin": "doc", "src": [{ "from": "deck", "at": "全份" }] },
          { "id": "m4-d4", "plan": "depth.4", "label": "第 4 站：最常見的失敗方式", "value": "只肯做一次性推廣，不肯長期合作", "origin": "ai", "test": "請對方書面寫明合作範圍" },
          { "id": "m4-d5", "plan": "depth.5", "label": "第 4 站：為何是這個日子", "value": "AI 估計：本季最後一日，配合本季目標", "origin": "ai" }
        ]
      },
      {
        "id": "m5",
        "short": "首間付款",
        "beyondGoal": true,
        "why": "真正開始收款的一站。放在這裏是讓你看到之後怎樣去到收款；它在本季目標之後。",
        "event": { "id": "m5-event", "plan": "milestone.event", "label": "第 5 站：真實事件", "value": "第一間餐廳確認報價、付款訂購每週當季蔬菜（每週最少 HK$1,500）", "origin": "doc", "src": [{ "from": "doc", "at": "第一節：收費基準" }] },
        "actor": { "id": "m5-actor", "plan": "milestone.actor", "label": "第 5 站：決策者", "value": "餐廳老闆 —— 付款客戶", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
        "witness": { "id": "m5-witness", "plan": "milestone.witness", "label": "第 5 站：見證人", "value": "主廚或者餐廳老闆", "origin": "ai" },
        "proof": { "id": "m5-proof", "plan": "milestone.evidence", "label": "第 5 站：證明方式", "value": "確認報價，或者收款紀錄", "origin": "ai" },
        "deliver": { "id": "m5-deliver", "plan": "milestone.deliveryCondition", "label": "第 5 站：完成標準", "value": "收到餐廳第一筆款項或確認報價", "origin": "ai" },
        "owner": { "id": "m5-owner", "plan": "G6", "label": "第 5 站：負責人", "value": "未有", "origin": "ai", "why": "文件寫擬由綠野物流跟進落單，但綠野物流未答應，所以 AI 不可以當作有人負責。", "src": [{ "from": "doc", "at": "第六節" }], "options": [{ "text": "未有", "rec": true }, { "text": "我自己" }, { "text": "綠野物流（等對方答應才算）" }] },
        "target": { "id": "m5-target", "plan": "milestone.targetDate", "label": "第 5 站：目標日期", "kind": "date", "suffix": "前", "value": "2027-01-31", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "問何師傅餐廳一般何時調整供應商" } },
        "watch": [{ "label": "付款餐廳", "value": "0／1" }],
        "depth": [
          { "id": "m5-d1", "plan": "depth.1", "label": "第 5 站：對方為何會同意", "value": "試送令主廚看到當季蔬菜的新鮮度與來源，認同值得付較高價錢", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m5-d2", "plan": "depth.2", "label": "第 5 站：對方怎樣決定、需時多久", "value": "AI 估計：主廚同意後由老闆批核，大約 2–4 星期", "origin": "ai", "test": "問何師傅餐廳怎樣批核新供應商、何時調整" },
          { "id": "m5-d3", "plan": "depth.3", "label": "第 5 站：要先具備甚麼", "value": "報價組合與伙伴合作條件（分帳、客戶歸屬、收款）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節" }] },
          { "id": "m5-d4", "plan": "depth.4", "label": "第 5 站：最常見的失敗方式", "value": "認同方向但暫時不轉供應商，或者只在節日落單", "origin": "doc", "src": [{ "from": "doc", "at": "第六節" }] },
          { "id": "m5-d5", "plan": "depth.5", "label": "第 5 站：為何是這個日子", "value": "AI 估計：主廚回覆後加上批核時間", "origin": "ai" }
        ]
      }
    ]
  },

  "detail": {
    "guide": "這裏是 AI 的根據、估計與未知。「出自你的文件」是你自己寫過的；「AI 建議」是 AI 估計的，最值得你看一眼。",
    "tip": {
      "headline": "最值得你補一句：綠野物流內部由誰拍板、需時多久",
      "why": "補了這句，第 1 站就不再「待深化」，AI 可以替你準備合適的人與時間表。"
    },
    "missing": [
      { "ref": "m1-d2", "title": "綠野物流內部由誰拍板、需時多久", "how": "第一次見綠野物流時問；問到就按一下補上" },
      {
        "title": "季末目標要有多少伙伴、多少間餐廳",
        "how": "11 月 2 日再問你；照用、修改，或者定下來",
        "edit": { "id": "md-goal-number", "plan": "goals.quarter.number", "label": "季末目標的數字", "value": "兩個伙伴答覆，加一位主廚回覆", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "11 月 2 日再問你" } }
      },
      {
        "title": "伙伴分帳、客戶歸屬、由誰收款",
        "how": "等對方提出條件，書面確認時帶入；AI 不會自行估計數字",
        "edit": { "id": "md-terms", "plan": "partner.terms", "label": "伙伴合作條件", "value": "由對方提出，書面確認時帶入", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節：待商議" }] }
      },
      {
        "title": "每次免費試送要用多少工時",
        "how": "試送時記錄實際用了多少時間",
        "edit": { "id": "md-hours", "plan": "cost.trialHours", "label": "每次免費試送工時", "value": "每間大約 3 小時", "origin": "ai", "tentative": { "by": "ai", "until": "2026-11-02", "test": "試送時記錄實際工時" } }
      },
      { "ref": "m5-d2", "title": "餐廳怎樣批核新供應商、何時調整", "how": "問何師傅" },
      {
        "title": "試送餐廳選哪一間",
        "how": "與何師傅一起選",
        "edit": { "id": "md-trial", "plan": "sample.trial", "label": "試送餐廳", "value": "未選；AI 建議選正準備換季菜單、或者標榜本地食材的餐廳", "origin": "ai", "src": [{ "from": "doc", "at": "第三節" }] }
      }
    ],
    "reading": [
      { "id": "bm-customer", "plan": "canvas.customer", "label": "客戶", "value": "中小型餐廳付款；主廚判斷質素，老闆批核訂單", "origin": "doc", "src": [{ "from": "doc", "at": "第三節" }] },
      { "id": "bm-value", "plan": "canvas.value", "label": "價值", "value": "當季本地蔬菜直送，每箱註明農場來源與收成日期", "origin": "doc", "src": [{ "from": "doc", "at": "第一節" }] },
      { "id": "bm-channel", "plan": "canvas.channel", "label": "渠道", "value": "直接接觸餐廳；擬由綠野物流接觸餐廳、食材周報推廣", "origin": "doc", "src": [{ "from": "deck", "at": "九宮格" }] },
      { "id": "bm-relation", "plan": "canvas.relationship", "label": "客戶關係", "value": "免費試送了解需要 → 按報價每週落單 → 換季更新菜單建議", "origin": "doc", "src": [{ "from": "deck", "at": "九宮格" }] },
      { "id": "bm-revenue", "plan": "canvas.revenue", "label": "收入", "value": "每週訂單最少 HK$1,500；節日加購另計、未定價", "origin": "doc", "src": [{ "from": "doc", "at": "第一節" }] },
      { "id": "bm-resource", "plan": "canvas.resources", "label": "關鍵資源", "value": "農場關係、廚藝顧問、冷藏送貨安排", "origin": "doc", "src": [{ "from": "deck", "at": "九宮格" }] },
      { "id": "bm-activity", "plan": "canvas.activities", "label": "關鍵活動", "value": "按批採購與分揀、安排送貨、與主廚確認菜式配搭", "origin": "doc", "src": [{ "from": "deck", "at": "九宮格" }] },
      { "id": "bm-partner", "plan": "canvas.partners", "label": "關鍵伙伴", "value": "農場甲、農場乙、何師傅（廚藝顧問）；擬議綠野物流、食材周報", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }] },
      { "id": "bm-cost", "plan": "canvas.cost", "label": "成本", "value": "免費試送與未成交跟進、採購、送貨、冷藏、包裝、伙伴費用", "origin": "doc", "src": [{ "from": "doc", "at": "第九節" }] }
    ],
    "actors": {
      "title": "公司以外的決策者",
      "judge": "AI 只照抄文件寫的狀態；沒有寫的當作「商討中」，擬議的當作「建議」。",
      "items": [
        { "id": "ac-partner", "plan": "externalActors", "kind": "choice", "label": "綠野物流 · 送貨與銷售伙伴", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "deck", "at": "標「擬議」" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false },
        { "id": "ac-media", "plan": "externalActors", "kind": "choice", "label": "食材周報 · 推廣渠道伙伴", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "deck", "at": "標「擬議」" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false },
        { "id": "ac-advisor", "plan": "externalActors", "kind": "choice", "label": "何師傅 · 廚藝顧問", "value": "商討中", "origin": "ai", "why": "文件沒有標明他的狀態，只寫「伙伴參與仍屬擬議」，所以 AI 當作仍在商討。", "src": [{ "from": "doc", "at": "開頭、第七節" }], "options": [{ "text": "已確定" }, { "text": "商討中", "rec": true }, { "text": "建議（對方未知）" }], "free": false },
        { "id": "ac-customer", "plan": "externalActors", "kind": "choice", "label": "中小型餐廳 · 付款客戶", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "doc", "at": "第十二節：有待實際接觸" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false },
        { "id": "ac-farms", "plan": "externalActors", "kind": "choice", "label": "農場甲、農場乙 · 供應農場", "value": "建議（對方未知）", "origin": "doc", "src": [{ "from": "doc", "at": "第七節" }], "options": [{ "text": "已確定" }, { "text": "商討中" }, { "text": "建議（對方未知）", "rec": true }], "free": false }
      ]
    },
    "lens": {
      "id": "lens", "plan": "company.lensIds",
      "label": "AI 用哪幾類生意的問題清單查漏",
      "value": "食品供應 ＋ 批發分銷 ＋ 本地服務",
      "origin": "ai",
      "why": "付款的是餐廳，主廚判斷質素（食品供應）；收入是每週訂單，要處理採購、分揀、送貨（批發分銷）；客戶集中在同一區，靠見面與試送建立關係（本地服務）。網上零售是願景，本季未做，所以不用「網上零售」清單。",
      "options": [
        { "text": "食品供應 ＋ 批發分銷 ＋ 本地服務", "rec": true },
        { "text": "食品供應 ＋ 批發分銷", "note": "不理會本地關係的風險" },
        { "text": "食品供應 ＋ 批發分銷 ＋ 網上零售", "note": "如果本季就做網上零售" }
      ]
    },
    "assumptions": [
      { "id": "as-need", "plan": "assumptions", "label": "假設：主廚認同要處理", "value": "主廚認同「食材來源不清楚」是要處理的問題", "origin": "ai", "test": "試送後與一位主廚談 20 分鐘，看他會否主動問每週供應" },
      { "id": "as-price", "plan": "assumptions", "label": "假設：餐廳肯付較高價錢", "value": "餐廳願意為來源清楚的當季蔬菜比批發市場多付一成", "origin": "ai", "test": "試送之後直接報價，記錄主廚反應" },
      { "id": "as-partner", "plan": "assumptions", "label": "假設：綠野物流有能力送貨", "value": "綠野物流有能力與意願接觸餐廳、負責送貨", "origin": "ai", "test": "會後請綠野物流書面列出可以服務哪些地區、大約多少間餐廳" },
      { "id": "as-media", "plan": "assumptions", "label": "假設：食材周報肯長期合作", "value": "食材周報願意以品牌與渠道長期參與，不只做一次性推廣", "origin": "ai", "test": "請對方書面寫明合作範圍" },
      { "id": "as-cost", "plan": "assumptions", "label": "假設：試送成本可以承受", "value": "每次免費試送大約 3 小時，成本可以承受", "origin": "ai", "test": "試送時記錄實際工時" },
      { "id": "as-procure", "plan": "assumptions", "label": "假設：餐廳轉供應商有固定程序", "value": "餐廳轉用新供應商有固定程序與時間", "origin": "ai", "test": "問何師傅餐廳怎樣批核、何時調整" }
    ],
    "rules": [
      {
        "id": "permissions", "plan": "G7", "effect": true,
        "label": "AI 可以自己做到幾盡",
        "ask": "哪些事 AI 毋須問你都可以做？",
        "judge": "確認後即時生效；AI 只可以建議預設或者更窄。",
        "value": "用預設",
        "origin": "default",
        "options": [
          { "text": "用預設", "rec": true },
          { "text": "收窄：連起草對外訊息都要先問我" }
        ],
        "boxes": {
          "auto": ["閱讀與分析項目內的檔案", "不帶私人資料的網上研究", "起草內部文件與草稿（信、簡報大綱、清單）", "處理你放入的會議紀錄", "準備每週問你的問題"],
          "tellAfter": ["因你的新資料更新對生意的理解", "同一站內增減或重排工作", "開新的 AI 崗位（未啟用）"],
          "askFirst": ["任何對外聯絡", "花錢或者簽約", "作出承諾（價錢、日期、條件）", "啟用 AI 崗位", "改目標或者次序", "刪除或者移走你的檔案", "發布、上傳等對外或者不可以回頭的操作"]
        }
      },
      {
        "id": "rhythm", "plan": "G8",
        "label": "AI 多久工作一次",
        "ask": "AI 多久自己工作一次、星期幾問你近況？",
        "value": "每日晚上 9 時工作一次；星期一問你近況；每次最多 30 分鐘",
        "origin": "default",
        "options": [
          { "text": "每日晚上 9 時工作一次；星期一問你近況；每次最多 30 分鐘", "rec": true },
          { "text": "平日晚上 9 時工作一次；星期一問你近況；每次最多 30 分鐘" },
          { "text": "每星期一早上 9 時工作一次，同日問你近況；每次最多 60 分鐘" }
        ]
      },
      {
        "id": "product-notes", "plan": "G9",
        "label": "一定要做到的要求",
        "ask": "產品或服務有甚麼非做不可、或者特別之處？",
        "value": "每箱註明農場來源與收成日期；全程冷藏送貨；不承諾指定品種，按當季供應；試送免費",
        "origin": "doc",
        "src": [{ "from": "doc", "at": "第三、七、十二節" }]
      },
      {
        "id": "lines", "plan": "G10",
        "label": "業務線數目",
        "ask": "有沒有兩條互不相干的業務（不同客戶、不同收入）？",
        "value": "一條：餐廳供應",
        "origin": "ai",
        "why": "網上零售文件寫是發展願景，本季未做，所以先當作一條。",
        "options": [
          { "text": "一條：餐廳供應", "rec": true },
          { "text": "兩條：餐廳供應 ＋ 網上零售" }
        ]
      }
    ]
  }
};
