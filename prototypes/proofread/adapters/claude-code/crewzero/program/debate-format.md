# 紅藍對打檔案格式（原型用；同試驗資料夾 wargame/FORMAT.md 一致，加幾個可選欄）

所有檔用 UTF-8、欄位固定、一句一欄；`|` 分隔嘅係只可以揀其中一個。檔案未出現即代表嗰一方未完成。辯論、反駁、裁判、轉強全部屬「AI 建議 · 未確認」或「AI 解讀」，唔算證據；只有真實客戶、伙伴或付款者嘅行為先可以令證據級上升。

證據級（0–4）：0 假設、1 口頭表示、2 實際行動、3 付出成本、4 形成依賴。來源只可以寫：「你原話 <文件名> §x」「外部 [n]」「AI 解讀」。

## blue.json（藍方：最強但誠實嘅論證）

```json
{ "thesis": "一句話主張", "whyNow": "一句",
  "claims": [ { "id": "B1", "topic": "付款|採購|價錢|渠道|交付|競爭|時間窗|擴展|需要|其他", "claim": "一句", "evidence": 0, "source": "你原話 <文件名> §x｜外部 [n]｜AI 解讀", "assumptionIds": ["H1"] } ],
  "strategies": [ { "id": "S1", "name": "短名", "summary": "一句", "upside": "一句", "firstTest": "一句", "success": "一句", "stop": "一句" } ],
  "admittedWeaknesses": [ { "claimId": "B3", "text": "一句：藍方自己承認嘅弱點" } ],
  "sources": [ { "n": 1, "title": "…", "url": "…", "readOn": "YYYY-MM-DD" } ] }
```

上限：論點 12 條、策略 4 條；自認弱點至少 2 條（原型要 `claimId`，畫面用嚟搵「盲點」）。

## red.json（紅方：幾個席位逐點攻擊）

```json
{ "attacks": [ { "id": "R1", "claimId": "B1", "persona": "席位名（照 topic.md）", "attack": "一句", "failureScenario": "一句：點樣失敗", "refuteBy": "一句：見到乜證據就推翻呢個攻擊", "severity": "高|中|低" } ],
  "strategyAttacks": [ { "strategyId": "S1", "attack": "一句", "severity": "高|中|低" } ],
  "missedStrategy": { "name": "短名", "summary": "一句：藍方漏咗嘅路線" },
  "seats": [ { "persona": "席位名", "cares": "一句：呢個身份最在意乜" } ] }
```

上限：攻擊 30 條；每條論點至少一條攻擊；`seats` 係原型多出嘅可選欄。

## rebuttal.json（藍方反駁，只限全場：只對「高」攻擊，每條一句，唔加新論點）

```json
{ "rebuttals": [ { "attackId": "R4", "stance": "認低威|推翻|部分", "text": "一句", "evidence": "外部 [n]｜你原話 §x｜無" } ] }
```

## judge.json（裁判：核實、逐條判）

```json
{ "verdicts": [ { "claimId": "B1", "verdict": "企得住|受傷|倒下", "reason": "一句（評語）" } ],
  "attackVerdicts": [ { "attackId": "R1", "landed": "成立|部分|不成立", "note": "一句" } ],
  "overall": "一句總評",
  "factChecks": [ { "n": 1, "ok": true, "note": "一句：已核實或者點解未能核實" } ],
  "topRisks": [ { "rank": 1, "risk": "一句", "cheapestTest": "一句", "stop": "一句：幾時之前未見到乜就停、縮或換", "testBy": "ai|founder|approval",
      "aiChecked": [ { "finding": "一句", "label": "observation|fact", "sources": [ { "title": "…", "url": "…", "readOn": "YYYY-MM-DD" } ], "minutes": 9 } ] } ],
  "routes": [ { "id": "S1", "name": "短名", "recommended": true, "why": "一句", "redScore": "高|中|低", "firstTest": "一句", "stop": "一句" } ],
  "founderDecisions": [ { "question": "一句", "options": [ "A …", "B …" ], "recommend": "A", "why": "一句" } ],
  "assumptionChanges": [ { "assumptionId": "H1", "change": "一句", "label": "AI 建議 · 未確認" } ] }
```

`factChecks` 係原型多出嘅可選欄（畫面「外部事實核實」用）。最傷三點、要你決定嘅事最多三條。

## rejudge.json（重判：創辦人挑戰之後，只可以改指定嘅論點，最多三條）

```json
{ "verdicts": [ { "claimId": "B5", "verdict": "企得住|受傷|倒下", "reason": "一句：有冇改判、點解" } ] }
```

## strengthen.json（轉強：藍方模型出卡）

```json
{ "cards": [ { "id": "T1", "from": { "claimIds": ["B3"], "attackIds": ["R4"], "verdict": "受傷|倒下", "persona": "一句：邊個身份", "topRiskRank": 1 },
      "critique": "一句：紅方點講", "judgeSaid": "一句：裁判點判",
      "handling": "修正|反轉做優勢|先驗證|接受並監察", "whyThis": "一句：命中揀法邊條規則",
      "changes": [ { "cell": "客戶群|價值主張|渠道|客戶關係|收入|關鍵資源|關鍵活動|關鍵伙伴|成本|產品要求|外部角色", "before": "一句", "after": "一句" } ],
      "advantage": "一句（反轉時：新賣點或合作機會；其他為空）",
      "assumptionChanges": [ { "assumptionId": "H1", "change": "改寫|新增|拆開|加限制|取代", "text": "一句", "cheapestTest": "一句", "supersedes": "H1" } ],
      "routeImpact": [ { "milestoneId": "里程碑編號", "change": "delay|retarget|add|retire|trial|newLine|none", "detail": "一句", "value": "可機械執行嘅值（日期、目標數、取代者）；none 可以留空" } ],
      "test": { "what": "一句", "by": "YYYY-MM-DD（14 日內）", "testBy": "ai|founder|approval", "success": "一句", "stop": "一句", "founderAction": "一句或空（只限 founder／approval）", "costHours": 2,
        "aiChecked": [ { "finding": "一句", "label": "observation|fact", "sources": [ { "title": "…", "url": "…", "readOn": "YYYY-MM-DD" } ], "minutes": 9 } ] } } ],
  "accepted": [ { "claimId": "B7", "note": "一句：受傷但暫時接受，點解" } ],
  "modelRevision": { "version": 2, "summary": "一句", "cells": [ { "cell": "收入", "text": "一句（修訂後）", "fromCardId": "T1" } ] },
  "founderQuestions": [ { "cardId": "T1", "question": "一句", "recommend": "A|B|C", "why": "一句" } ] }
```

`status`、`label`、`askFirst`、`reattacks`、`founderVote` 由系統填，唔使寫。任何欄都唔可以寫證據級。

測試由邊個做（規劃書 3.15）：`testBy` 係 `ai`＝AI 自己做得到（唯讀上網研究、公開數據、文件同網站核對），喺出卡同一回合內先做，結果寫 `aiChecked`；`founder`＝要創辦人親身做；`approval`＝要創辦人批准先做（對外發送、花錢、要登入）。`aiChecked` 嘅 `fact` 一定要有 `url` 同 `readOn`，冇就當 `observation`；兩種都唔係證據級。`founderAction` 只寫 `founder`／`approval` 類嘅事。（`FORMAT.md` 第二次追加寫做 `test.by`，但 `by` 已經係測試日期，所以原型用 `testBy`；寫成 `by: "ai"` 都照讀。）

## reattack-red.json（紅方再攻：每張卡一條）

```json
{ "attacks": [ { "cardId": "T1", "persona": "一句：邊個身份", "attack": "一句", "severity": "高|中|低" } ] }
```

## reattack-judge.json（裁判判卡）

```json
{ "verdicts": [ { "cardId": "T1", "verdict": "企得住|受傷|倒下", "reason": "一句" } ] }
```
