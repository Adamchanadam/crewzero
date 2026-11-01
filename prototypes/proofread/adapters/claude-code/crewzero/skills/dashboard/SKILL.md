---
name: dashboard
description: "營運監察台（CrewZero 公司日常運作頁面：業務路徑圖、待你處理、未來兩星期日程、工作看板、時間線、AI 團隊現況）。Use when the founder asks to open 營運監察台, dashboard, 看板, 時間線 or 日程 (e.g. 「打開營運監察台」, /crewzero:dashboard in Claude Code, $crewzero:dashboard in Codex, /dashboard in Antigravity), or wants to see the fictional demo (「睇示範」). Decisions and answers still happen on Founder Desk."
---

<!--
CrewZero 插件入面嘅營運監察台指令（只係轉接層，核心係項目入面安裝資料夾嘅 ask.mjs；Claude Code、Codex、Antigravity 三種工具同一份）。
同 Founder Desk 同一個本機伺服器、同一份資料；監察台只睇同跳轉，所有作答都喺 Founder Desk。呢個檔唔寫任何本機絕對路徑。
-->

營運監察台係創辦人睇公司日常運作嘅頁面：生意行到邊、AI 團隊做緊乜、邊度卡住、要邊個決定、未來兩星期有乜到期。監察台冇作答框；要創辦人決定嘅事一按就跳去 Founder Desk。

## 先搵安裝位置

由你而家對話嘅工作資料夾開始，逐層向上搵：先搵 `crewzero/ask.mjs`，搵唔到再搵 `startup-os/ask.mjs`（改名前裝嘅舊版安裝）。用搵到嗰個；佢所在嘅資料夾（`crewzero` 或 `startup-os`）就係安裝位置（下面寫做 `<安裝>`）。

兩個都搵唔到：講「這個項目未安裝 CrewZero」，請創辦人輸入安裝指令（按佢用緊嘅工具：Claude Code `/crewzero:install`、Codex `$crewzero:install`、Antigravity `/install`）安裝，然後停。

## 創辦人想打開營運監察台

執行：`node "<安裝>/ask.mjs" --dashboard`

佢會自己喺背景開好伺服器，再喺瀏覽器打開。之後用一句話話畀創辦人知已經打開（附命令印出嘅網址）。唔好叫創辦人執行任何檔案。

## 創辦人想睇示範（虛構公司「從田間到餐桌」）

執行：`node "<安裝>/ask.mjs" --dashboard --demo`

示範資料同創辦人真實資料分開（另一個資料夾、另一個網址），日子按今日推算；喺示範入面答題或者交要求唔會影響真實資料。想由頭再試，加 `--reset-demo`。話畀創辦人知呢個係示範、內容係虛構。

## 想喺生意大腦睇一個試驗資料夾（只限本機）

執行：`node "<安裝>/ask.mjs" --dashboard --brain "<試驗資料夾>"`

監察台「生意大腦」分頁會只讀嗰個資料夾嘅固定檔（生意體檢、會面預演、紅藍對打三個檔），檔案陸續寫入就逐步顯示。取消：`--brain off`。資料夾入面嘅真實生意資料只喺本機顯示，唔好上載或者抄去其他地方。
