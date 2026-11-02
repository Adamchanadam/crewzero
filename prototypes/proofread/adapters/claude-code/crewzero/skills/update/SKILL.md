---
name: update
description: "把項目入面已安裝嘅 CrewZero 程式更新到插件嘅新版本，或者還原上一個版本；改名前裝嘅舊版（startup-os/ 資料夾）亦喺原位更新。Only for CrewZero, not a general updater. Use when the founder asks to update CrewZero (e.g. /crewzero:update in Claude Code, $crewzero:update in Codex, /update in Antigravity, 「更新 CrewZero」「有冇新版本」), or says 「還原上一個版本」. data/ is never touched. Every write needs the founder's explicit 「好」 in this conversation first."
---

<!--
CrewZero 插件入面嘅更新指令（只係轉接層，核心係程式資料夾入面嘅 update.mjs）。
同一份插件喺 Claude Code、Codex、Antigravity（agy）三種工具都用得；程式隨插件附帶，喺插件資料夾入面嘅 program/（由開發會話用 build-plugin.mjs 生成）。呢個檔唔寫任何本機絕對路徑。
-->

更新 CrewZero 只會換項目入面安裝資料夾（`crewzero/`；改名前裝嘅舊版係 `startup-os/`，就喺 `startup-os/` 原位更新，唔搬、唔改名）嘅程式檔：先問創辦人，舊版先備份，換入後逐檔核對；`<安裝>/data/`（公司概覽、決定紀錄、AI 工作紀錄）一個檔都唔郁。出咗問題可以還原上一個版本。

## 指令叫法（三種 AI 工具）

同一個插件喺三種工具嘅叫法唔同。下面凡係叫創辦人「輸入」指令嘅地方，都用佢而家用緊嘅工具嘅叫法：

| 指令 | Claude Code | Codex | Antigravity（agy） |
|---|---|---|---|
| 安裝 | `/crewzero:install` | `$crewzero:install` | `/install` |
| Founder Desk | `/crewzero:desk` | `$crewzero:desk` | `/desk` |
| 營運監察台 | `/crewzero:dashboard` | `$crewzero:dashboard` | `/dashboard` |
| 更新 | `/crewzero:update` | `$crewzero:update` | `/update` |

新版插件要先由創辦人喺自己嘅 AI 工具換入（Claude Code 喺命令列 `claude plugin update crewzero`；Codex `codex plugin marketplace upgrade` 再 `codex plugin add crewzero@crewzero`；Antigravity 喺之前下載嘅 crewzero 資料夾執行 `git pull`，再 `agy plugin uninstall crewzero`，然後重新 `agy plugin install crewzero/prototypes/proofread/adapters/claude-code/crewzero`），之後先輸入更新指令換項目入面嘅程式。換入插件呢步由創辦人做，你唔好代佢執行。

## 先搵三個位置

- **程式來源（下面寫做 `<程式>`）**：呢份 SKILL.md 喺插件資料夾嘅 `skills/update/` 入面；由呢份 SKILL.md 所在嘅資料夾向上兩層就係插件資料夾，入面嘅 `program` 資料夾就係 `<程式>`。宿主用自己嘅方式話你知呢份 SKILL.md 喺邊：Claude Code 載入技能時講「Base directory for this skill」（即 `skills/update/`）；Codex 喺技能清單每項後面寫 `file: …/skills/update/SKILL.md`（開頭嘅 `r0`、`r1` 之類要用清單頂「Skill roots」表換成完整路徑）；Antigravity 有講路徑就照用。宿主完全冇講路徑先用後備：按次序檢查 `~/.claude/plugins/cache/crewzero/crewzero/<版本>/program`、`~/.claude/plugins/cache/startup-os/crewzero/<版本>/program`（由 startup-os 轉用嘅電腦，市集資料夾可能仍用舊名）、`~/.codex/plugins/cache/crewzero/crewzero/<版本>/program`、`~/.gemini/config/plugins/crewzero/program`（`~` 係而家登入用戶嘅個人資料夾；有幾個 `<版本>` 資料夾就用版本號最大嗰個），用第一個有 `update.mjs` 嘅。除此之外唔好用任何寫死嘅路徑；搵唔到 `<程式>/update.mjs` 就話畀創辦人知插件唔完整，請佢重新安裝插件，然後停。
- **安裝資料夾（下面寫做 `<安裝>`）**：由你而家對話嘅工作資料夾開始，逐層向上搵：先搵 `crewzero/ask.mjs`，搵唔到再搵 `startup-os/ask.mjs`（改名前裝嘅舊版安裝）。用搵到嗰個；佢所在嘅資料夾（`crewzero` 或 `startup-os`）就係 `<安裝>`。
- **項目根（下面寫做 `<項目根>`）**：`<安裝>` 嘅上一層。兩個都搵唔到：講「這個項目未安裝 CrewZero」，請創辦人輸入安裝指令（Claude Code `/crewzero:install`、Codex `$crewzero:install`、Antigravity `/install`），然後停。

## 創辦人想更新（`/crewzero:update`、`$crewzero:update`、`/update`、「有冇新版本」）

1. 先檢查，唔寫任何嘢：`node "<程式>/update.mjs" "<項目根>"`
   - 結束碼 0：已經係最新版本。照命令印出嘅一句話講，然後停。
   - 結束碼 2：未安裝。請創辦人輸入安裝指令（Claude Code `/crewzero:install`、Codex `$crewzero:install`、Antigravity `/install`），然後停。
   - 結束碼 4：AI 工作進行中。講「AI 工作進行中，完成後再更新」，然後停；唔好自己停止任何程序。
   - 結束碼 3：有新版本。去第 2 步。
   - 其他：照印出嘅原因話畀創辦人知（用白話講原因同點做，見「命令出錯時點講」），然後停；唔好自己改檔或者再試第二種方法。
2. **寫入之前一定要停**：將命令印出嘅嗰句「將更新 … 不會改動 … data」原文俾創辦人睇（命令另外印有「Founder Desk 目前開着」嗰句都要照講），再問「好嗎？」。然後停，等創辦人答。冇答「好」（或者同樣明確嘅同意）就唔好做任何寫入。
3. 創辦人答「好」之後執行：`node "<程式>/update.mjs" "<項目根>" --apply`
   - 結束碼 0：更新完成，照命令印出嘅結果用一兩句話講（新版本號、備份喺邊、`data/` 冇改動），再講下一步係打開 Founder Desk（Claude Code `/crewzero:desk`、Codex `$crewzero:desk`、Antigravity `/desk`）。
   - 結束碼 4：AI 啱啱開始咗工作，命令冇改任何檔；講一句，請創辦人遲啲再試。
   - 其他：更新未完成。命令會自己由備份還原，照佢印出嘅內容用白話講清楚：係咪已經還原、公司資料冇改動、原因係乜同下一步點做（見「命令出錯時點講」）。唔好自己改檔或者刪嘢。

## 創辦人想還原上一個版本（「還原上一個版本」）

1. 先檢查，唔寫任何嘢：`node "<程式>/update.mjs" "<項目根>" --rollback`
   - 結束碼 3：有備份。將命令印出嘅嗰句「將把 … 還原到版本 …」原文俾創辦人睇，再問「好嗎？」。然後停，等創辦人答。
   - 結束碼 1：冇可以還原嘅備份，照印出嘅一句話講，然後停。
   - 結束碼 4：AI 工作進行中，完成後再試，然後停。
2. 創辦人答「好」之後執行：`node "<程式>/update.mjs" "<項目根>" --rollback --apply`
   - 結束碼 0：照命令印出嘅結果講（還原到邊個版本、`data/` 冇改動），再講下一步係打開 Founder Desk。
   - 其他：照印出嘅原因講（用白話講原因同點做，見「命令出錯時點講」），然後停。

## 命令出錯時點講

命令印出英文、錯誤代號、路徑或者命令嘅時候，唔好照抄畀創辦人。用一兩句白話講：發生咗乜（一個簡單原因），同佢下一步可以點做（例如稍等十秒再講一次、關閉其他開住嘅程式、重新開機）。英文原文只留畀你自己理解；唔好叫創辦人執行任何命令或者打開任何檔案，亦唔好自己改檔或者再試第二種方法。下面寫「照印出嘅原因講」嘅地方，都係咁講。

## 一定要守

- 更新同還原都要創辦人喺今次對話明確答「好」先做；檢查（唔加 `--apply`）唔使問。
- 唔好手改 `<安裝>/data/` 入面任何檔；唔好為咗「修好」而自己刪除、覆寫、改名 `<安裝>`（包括舊版嘅 `startup-os/`）或者備份資料夾（`.backup-` 開頭）。
- 唔好叫創辦人自己執行檔案；命令由你執行。
- 更新完唔會自動打開頁面：創辦人之後輸入 Founder Desk 或營運監察台指令（Claude Code `/crewzero:desk`／`/crewzero:dashboard`、Codex `$crewzero:desk`／`$crewzero:dashboard`、Antigravity `/desk`／`/dashboard`），開到嘅就係新版。
