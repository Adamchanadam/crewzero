---
name: install
description: "安裝 CrewZero（零號隊員：AI 團隊同創辦人一齊經營初創嘅工具）到創辦人嘅項目，同埋登記、重新登記或者移除每日排程。Only for CrewZero, not a general installer. Use when the founder asks to install CrewZero (e.g. /crewzero:install in Claude Code, $crewzero:install in Codex, /install in Antigravity, 「安裝 CrewZero」), or says 「安裝排程」「重新登記排程」「移除排程」「排程狀態」. Every write and every schedule registration needs the founder's explicit 「好」／「批准」 in this conversation first."
---

<!--
CrewZero 插件入面嘅安裝指令（只係轉接層，核心係程式資料夾入面嘅 install.mjs 同 adapters/scheduler/install-schedule.mjs）。
同一份插件喺 Claude Code、Codex、Antigravity（agy）三種工具都用得；程式隨插件附帶，喺插件資料夾入面嘅 program/（由開發會話用 build-plugin.mjs 生成）。呢個檔唔寫任何本機絕對路徑。
-->

CrewZero 係 AI 團隊同創辦人一齊經營初創嘅工具。安裝會喺項目入面新增一個 `crewzero/` 資料夾（程式檔同一個空嘅 `data/`），唔改項目其他檔；之後創辦人批准，電腦每日按時叫 AI 開工。

## 指令叫法（三種 AI 工具）

同一個插件喺三種工具嘅叫法唔同。下面凡係叫創辦人「輸入」指令嘅地方，都用佢而家用緊嘅工具嘅叫法：

| 指令 | Claude Code | Codex | Antigravity（agy） |
|---|---|---|---|
| 安裝 | `/crewzero:install` | `$crewzero:install` | `/install` |
| Founder Desk | `/crewzero:desk` | `$crewzero:desk` | `/desk` |
| 營運監察台 | `/crewzero:dashboard` | `$crewzero:dashboard` | `/dashboard` |
| 更新 | `/crewzero:update` | `$crewzero:update` | `/update` |

## 先搵三個位置

- **程式來源（下面寫做 `<程式>`）**：呢份 SKILL.md 喺插件資料夾嘅 `skills/install/` 入面；由呢份 SKILL.md 所在嘅資料夾向上兩層就係插件資料夾，入面嘅 `program` 資料夾就係 `<程式>`。宿主用自己嘅方式話你知呢份 SKILL.md 喺邊：Claude Code 載入技能時講「Base directory for this skill」（即 `skills/install/`）；Codex 喺技能清單每項後面寫 `file: …/skills/install/SKILL.md`（開頭嘅 `r0`、`r1` 之類要用清單頂「Skill roots」表換成完整路徑）；Antigravity 有講路徑就照用。宿主完全冇講路徑先用後備：按次序檢查 `~/.claude/plugins/cache/crewzero/crewzero/<版本>/program`、`~/.claude/plugins/cache/startup-os/crewzero/<版本>/program`（由 startup-os 轉用嘅電腦，市集資料夾可能仍用舊名）、`~/.codex/plugins/cache/crewzero/crewzero/<版本>/program`、`~/.gemini/config/plugins/crewzero/program`（`~` 係而家登入用戶嘅個人資料夾；有幾個 `<版本>` 資料夾就用版本號最大嗰個），用第一個有 `install.mjs` 嘅。除此之外唔好用任何寫死嘅路徑；搵唔到 `<程式>/install.mjs` 就話畀創辦人知插件唔完整，請佢重新安裝插件，然後停。
- **安裝資料夾（下面寫做 `<安裝>`）**：由你而家對話嘅工作資料夾開始，逐層向上搵：先搵 `crewzero/ask.mjs`，搵唔到再搵 `startup-os/ask.mjs`（改名前裝嘅舊版安裝）。用搵到嗰個；佢所在嘅資料夾（`crewzero` 或 `startup-os`）就係 `<安裝>`。兩個都搵唔到即係未安裝。
- **項目根（下面寫做 `<項目根>`）**：搵到 `<安裝>` 就係佢嘅上一層；未安裝就係而家對話嘅工作資料夾。唔肯定係唔係創辦人嘅項目，就問佢一次。

## 創辦人要安裝（`/crewzero:install`、`$crewzero:install` 或 `/install`）

1. 如果已經搵到 `<安裝>`：唔好再安裝。
   - `<安裝>` 係 `crewzero/`：講「呢個項目已經安裝咗 CrewZero」；想換新版本嘅話叫佢輸入更新指令（Claude Code `/crewzero:update`、Codex `$crewzero:update`、Antigravity `/update`；安裝命令唔會覆寫舊版）。
   - `<安裝>` 係 `startup-os/`（舊版）：講「呢個項目已經有舊版安裝（`startup-os/`），CrewZero 會沿用呢個資料夾，唔會另建 `crewzero/`；請輸入更新指令換成新版程式，公司資料不會改動」（填入創辦人工具嘅更新指令叫法）。
   - 再問佢要唔要登記或者重新登記每日排程，要就跳去「登記每日排程」。
2. **寫入之前一定要停**：一字不改講「將在 `<項目根>/crewzero/` 建立程式檔與一個空資料夾，不改動項目其他檔。另外會把這個項目資料夾登記為觀察資料夾：營運監察台的運作環會顯示項目內本機 AI 對話的標題和狀態（只讀，不記入公司紀錄，可在系統頁移除）。」（`<項目根>` 換成真實路徑），再問「好嗎？」。然後停，等創辦人答。冇答「好」（或者同樣明確嘅同意）就唔好做任何寫入。
3. 創辦人答「好」之後執行：`node "<程式>/install.mjs" "<項目根>"`
   - 結束碼 0：安裝完成，照命令印出嘅結果用一兩句話講。之後 `<安裝>` 就係 `<項目根>/crewzero`。
   - 結束碼 2：已經安裝，冇改任何檔；命令印出有新版本或者舊版安裝嘅話，講一句「要更新請輸入 …」（填入創辦人工具嘅更新指令叫法）；然後跳去「登記每日排程」。
   - 其他：照印出嘅原因話畀創辦人知（用白話講原因同點做，見「命令出錯時點講」），唔算完成；唔好自己改檔或者再試第二種方法。
4. 跟住做「登記每日排程」。
5. 最後登記觀察資料夾同打開 Founder Desk（同一條命令）：`node "<安裝>/ask.mjs" --desk --observe "<項目根>"`。話畀創辦人知已經打開（附命令印出嘅網址），項目資料夾已登記為觀察資料夾（不想顯示可在營運監察台系統頁移除或關閉觀測），下一步係頁頂「AI 未設定」嗰張卡嘅「前往設定」。創辦人喺第 2 步明確講唔要觀察，就改用 `node "<安裝>/ask.mjs" --desk`。

## 登記每日排程（亦處理「安裝排程」「重新登記排程」）

1. 先印定義全文：`node "<安裝>/adapters/scheduler/install-schedule.mjs"`。將印出嘅內容（包括命令全文）原文俾創辦人睇，用一句話講：「批准之後，電腦每日按時叫 AI 開工；電腦當時關機或睡眠，會在下次可用時盡快補做。」再問「批准登記？」。然後停，等創辦人答。
2. 創辦人答「批准」之後先執行：`node "<安裝>/adapters/scheduler/install-schedule.mjs" --register`
   - 成功：照印出嘅下次執行時間同「錯過即補跑」設定講一句。
   - 失敗：照印出嘅第一句（中文原因同做法）用白話講；之後印出嘅英文錯誤同命令全文只供你理解，唔好交俾創辦人，亦唔好叫佢自己執行。安裝本身照樣算完成，AI 仍會喺創辦人交答案或者提出要求時工作。
3. 創辦人唔批准：講「系統頁的排程會寫『未登記』；之後想登記，在對話輸入『安裝排程』」。

## 其他要求

- 「移除排程」：先問一次「移除之後，電腦不會再每日叫 AI 開工，確定嗎？」，答確定先執行 `node "<安裝>/adapters/scheduler/install-schedule.mjs" --remove`。
- 「排程狀態」：執行 `node "<安裝>/adapters/scheduler/install-schedule.mjs" --status`，用一句話講第二行嘅內容。
- 排程登記名：新安裝係 `crewzero-` 開頭；改名前登記嘅舊版排程係 `startup-os-` 開頭，命令會自己認得，唔使你處理。

## 命令出錯時點講

命令印出英文、錯誤代號、路徑或者命令嘅時候，唔好照抄畀創辦人。用一兩句白話講：發生咗乜（一個簡單原因），同佢下一步可以點做（例如稍等十秒再講一次、關閉其他開住嘅程式、重新開機）。英文原文只留畀你自己理解；唔好叫創辦人執行任何命令或者打開任何檔案，亦唔好自己改檔或者再試第二種方法。下面寫「照印出嘅原因講」嘅地方，都係咁講。

## 一定要守

- 寫入項目、登記排程、移除排程，每一樣都要創辦人喺今次對話明確答應先做；答應一樣唔代表答應另一樣。
- 唔好手改 `<安裝>/data/` 入面任何檔；唔好為咗「修好」而刪除、覆寫或者改名 `<安裝>`（包括舊版嘅 `startup-os/`）。
- 唔好叫創辦人自己執行檔案；命令由你執行。
