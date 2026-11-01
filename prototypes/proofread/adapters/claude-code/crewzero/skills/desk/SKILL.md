---
name: desk
description: "Founder Desk（CrewZero 創辦人做決定嘅本機頁面）。Use when the founder asks to open Founder Desk, 決定紀錄 or 公司概覽 (e.g. 「打開 Founder Desk」, /crewzero:desk in Claude Code, $crewzero:desk in Codex, /desk in Antigravity). Also use whenever you need the founder to decide something or supply information: put the questions on Founder Desk as a question pack instead of asking in chat."
---

<!--
CrewZero 插件入面嘅 Founder Desk 指令（只係轉接層，核心係項目入面安裝資料夾嘅 ask.mjs；Claude Code、Codex、Antigravity 三種工具同一份）。
呢個檔唔寫任何本機絕對路徑：安裝位置由對話工作資料夾向上搵。創辦人唔使執行任何檔案：伺服器由下面嘅命令自動喺背景開，舊版會自動換新。
-->

Founder Desk 係創辦人做決定嘅頁面：AI 有嘢要佢決定，就放上去；佢每次只答最重要嘅 3 條，其餘照 AI 建議先咁計住；答過嘅全部有紀錄，AI 收到答案會自動繼續做。

## 先搵安裝位置

由你而家對話嘅工作資料夾開始，逐層向上搵：先搵 `crewzero/ask.mjs`，搵唔到再搵 `startup-os/ask.mjs`（改名前裝嘅舊版安裝）。用搵到嗰個；佢所在嘅資料夾（`crewzero` 或 `startup-os`）就係安裝位置（下面寫做 `<安裝>`）。

兩個都搵唔到：講「這個項目未安裝 CrewZero」，請創辦人輸入安裝指令（按佢用緊嘅工具：Claude Code `/crewzero:install`、Codex `$crewzero:install`、Antigravity `/install`）安裝，然後停。唔好用其他位置嘅安裝代替。

## 創辦人想打開 Founder Desk

執行：`node "<安裝>/ask.mjs" --desk`

佢會自己喺背景開好，再喺瀏覽器打開。之後用一句話話畀創辦人知已經打開（附命令印出嘅網址）。唔好叫創辦人執行任何檔案。

## 你需要創辦人決定或者提供資料

唔好喺對話入面逐條問。照以下做：

0. 先讀公司背景：`<安裝>/data/company/page.json`（公司概覽，由 AI 按創辦人交嘅資料擬好；冇呢個檔即係創辦人未交資料，先叫佢打開 Founder Desk 交資料；如果 `<安裝>/data/ledger/confirmed.json` 存在，以入面創辦人確認咗嘅答案為準）。你嘅建議唔可以同公司概覽矛盾（例如目標客戶、價錢、伙伴狀態）；有矛盾就照公司概覽，或者將矛盾寫成一條問題。
1. 讀 `<安裝>/ask-format.md`，完全跟「出題規則」：先問會改變下一步嘅；每條附你嘅建議同一句理由；你自己搵得到嘅唔好問；一條一件事；選項最多 3 個；標明「即刻生效」定「先咁計住」。
2. 將問題寫成一個問題包 JSON，**存喺系統暫存資料夾**（Windows 係環境變數 `TEMP` 指住嘅資料夾；macOS、Linux 係 `/tmp`），檔名用 `crewzero-ask-<日期時間>.json`（下面寫做 `<草稿>`）。**唔好存喺項目資料夾**（包括項目根同 `<安裝>`），免得喺項目留低檔案。如果答完要你繼續做嘢，寫埋 `next.task`。
3. 執行：`node "<安裝>/ask.mjs" "<草稿>"`
4. 如果命令話「唔合規格」，按佢列出嘅原因改好 `<草稿>` 再行一次。
5. 成功之後刪走 `<草稿>`（Founder Desk 已經有自己一份），再用一兩句話話畀創辦人知：問題包叫乜、有幾多條、今次先答 3 條、Founder Desk 已經打開（附命令印出嘅網址）。然後停，等佢答。

唔好手改 `<安裝>/data/` 入面任何檔。
