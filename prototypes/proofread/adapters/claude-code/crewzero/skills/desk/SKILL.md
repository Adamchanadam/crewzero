---
name: desk
description: "Founder Desk（CrewZero 創辦人做決定嘅本機頁面）。Use when the founder asks to open Founder Desk, 決定紀錄 or 公司概覽 (e.g. 「打開 Founder Desk」, /crewzero:desk in Claude Code, $crewzero:desk in Codex, /desk in Antigravity), or says 「我唔知點做」「卡住」「點用」「CrewZero 出錯」「打唔開」「下一步做乜」. Also use whenever you need the founder to decide something or supply information: put the questions on Founder Desk as a question pack instead of asking in chat."
---

<!--
CrewZero 插件入面嘅 Founder Desk 指令（只係轉接層，核心係項目入面安裝資料夾嘅 ask.mjs；Claude Code、Codex、Antigravity 三種工具同一份）。
呢個檔唔寫任何本機絕對路徑：安裝位置由對話工作資料夾向上搵。創辦人唔使執行任何檔案：伺服器由下面嘅命令自動喺背景開，舊版會自動換新。
-->

Founder Desk 係創辦人做決定嘅頁面：Zero 有嘢要佢決定，就放上去；佢每次只答最重要嘅 3 條，其餘照 Zero 建議先咁計住；答過嘅全部有紀錄，Zero 收到答案會自動繼續做。

## 先搵安裝位置

由你而家對話嘅工作資料夾開始，逐層向上搵：先搵 `crewzero/ask.mjs`，搵唔到再搵 `startup-os/ask.mjs`（改名前裝嘅舊版安裝）。用搵到嗰個；佢所在嘅資料夾（`crewzero` 或 `startup-os`）就係安裝位置（下面寫做 `<安裝>`）。

兩個都搵唔到：講「這個項目未安裝 CrewZero」，請創辦人輸入安裝指令（按佢用緊嘅工具：Claude Code `/crewzero:install`、Codex `$crewzero:install`、Antigravity `/install`）安裝，然後停。唔好用其他位置嘅安裝代替。

## 創辦人想打開 Founder Desk

## 創辦人唔知點做或者卡住

先跟「先搵安裝位置」搵 `<安裝>`。

- 搵唔到：講「這個項目未安裝 CrewZero」，請創辦人輸入安裝指令（按佢而家用緊嘅工具），然後停。
- 搵到：先執行 `node "<安裝>/ask.mjs" --status`。用兩三句白話轉述目前情況、下一步同重新打開方法，然後執行 `node "<安裝>/ask.mjs" --desk` 打開頁面。
- 如果係生意問題，例如應該先做乜或者點樣揀，請創辦人喺 Founder Desk 頁頂按「需要幫助」交出。答案會留喺紀錄；唔好喺對話逐條問。

執行：`node "<安裝>/ask.mjs" --desk`

佢會自己喺背景開好，再喺瀏覽器打開。之後用一句話話畀創辦人知已經打開（附命令印出嘅網址）。唔好叫創辦人執行任何檔案。

## 打開失敗

命令結束碼唔係 0（印出「未能打開」或者「瀏覽器未有打開」）：照佢印出嘅中文句，用一兩句白話講原因同點做（例如「Founder Desk 暫時未能開啟，公司資料沒有改動；請稍等十秒，再說一次『打開 Founder Desk』」），然後停。唔好自己再試其他方法（例如直接執行伺服器檔、換埠、刪檔、關閉程序），唔好叫創辦人執行任何檔案。放問題包時印出「問題已準備好，但 Founder Desk 暫時未能開啟」都係一樣：講問題已經放好、下次打開就見到，然後停，唔好再放一次。

## 命令出錯時點講

命令印出英文、錯誤代號、路徑或者命令嘅時候，唔好照抄畀創辦人。用一兩句白話講：發生咗乜（一個簡單原因），同佢下一步可以點做（例如稍等十秒再講一次、關閉其他開住嘅程式、重新開機）。英文原文只留畀你自己理解；唔好叫創辦人執行任何命令或者打開任何檔案，亦唔好自己改檔或者再試第二種方法。下面寫「照印出嘅原因講」嘅地方，都係咁講。


## 你需要創辦人決定或者提供資料

唔好喺對話入面逐條問。照以下做：

0. 先讀公司背景：`<安裝>/data/company/page.json`（公司概覽，由 Zero 按創辦人交嘅資料擬好；冇呢個檔即係創辦人尚未告訴 Zero，先叫佢打開 Founder Desk 告訴 Zero；如果 `<安裝>/data/ledger/confirmed.json` 存在，以入面創辦人確認咗嘅答案為準）。你嘅建議唔可以同公司概覽矛盾（例如目標客戶、價錢、伙伴狀態）；有矛盾就照公司概覽，或者將矛盾寫成一條問題。
1. 讀 `<安裝>/ask-format.md`，完全跟「出題規則」：先問會改變下一步嘅；每條附你嘅建議同一句理由；你自己搵得到嘅唔好問；一條一件事；選項最多 3 個；標明「即刻生效」定「先咁計住」。
2. 將問題寫成一個問題包 JSON，**存喺系統暫存資料夾**（Windows 係環境變數 `TEMP` 指住嘅資料夾；macOS、Linux 係 `/tmp`），檔名用 `crewzero-ask-<日期時間>.json`（下面寫做 `<草稿>`）。**唔好存喺項目資料夾**（包括項目根同 `<安裝>`），免得喺項目留低檔案。如果答完要你繼續做嘢，寫埋 `next.task`。
3. 執行：`node "<安裝>/ask.mjs" "<草稿>"`
4. 如果命令話「唔合規格」，按佢列出嘅原因改好 `<草稿>` 再行一次。
5. 成功之後刪走 `<草稿>`（Founder Desk 已經有自己一份），再用一兩句話話畀創辦人知：問題包叫乜、有幾多條、今次先答 3 條、Founder Desk 已經打開（附命令印出嘅網址）。然後停，等佢答。

唔好手改 `<安裝>/data/` 入面任何檔。
