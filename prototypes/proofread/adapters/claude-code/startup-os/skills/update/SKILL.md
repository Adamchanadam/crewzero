---
name: update
description: "把項目入面已安裝嘅 startup-os 程式更新到插件嘅新版本，或者還原上一個版本。Only for startup-os, not a general updater. Use when the founder asks to update startup-os (e.g. /startup-os:update in Claude Code, $startup-os:update in Codex, /update in Antigravity, 「更新 startup-os」「有冇新版本」), or says 「還原上一個版本」. data/ is never touched. Every write needs the founder's explicit 「好」 in this conversation first."
---

<!--
startup-os 插件入面嘅更新指令（只係轉接層，核心係程式資料夾入面嘅 update.mjs）。
同一份插件喺 Claude Code、Codex、Antigravity（agy）三種工具都用得；程式隨插件附帶，喺插件資料夾入面嘅 program/（由開發會話用 build-plugin.mjs 生成）。呢個檔唔寫任何本機絕對路徑。
-->

更新 startup-os 只會換項目入面 `startup-os/` 嘅程式檔：先問創辦人，舊版先備份，換入後逐檔核對；`startup-os/data/`（公司概覽、決定紀錄、AI 工作紀錄）一個檔都唔郁。出咗問題可以還原上一個版本。

## 指令叫法（三種 AI 工具）

同一個插件喺三種工具嘅叫法唔同。下面凡係叫創辦人「輸入」指令嘅地方，都用佢而家用緊嘅工具嘅叫法：

| 指令 | Claude Code | Codex | Antigravity（agy） |
|---|---|---|---|
| 安裝 | `/startup-os:install` | `$startup-os:install` | `/install` |
| Founder Desk | `/startup-os:desk` | `$startup-os:desk` | `/desk` |
| 營運監察台 | `/startup-os:dashboard` | `$startup-os:dashboard` | `/dashboard` |
| 更新 | `/startup-os:update` | `$startup-os:update` | `/update` |

新版插件要先由創辦人喺自己嘅 AI 工具換入（Claude Code 喺命令列 `claude plugin update startup-os`；Codex `codex plugin marketplace upgrade` 再 `codex plugin add startup-os@startup-os`；Antigravity `agy plugin uninstall startup-os` 再重新 `agy plugin install`），之後先輸入更新指令換項目入面嘅程式。換入插件呢步由創辦人做，你唔好代佢執行。

## 先搵兩個位置

- **程式來源（下面寫做 `<程式>`）**：呢份 SKILL.md 喺插件資料夾嘅 `skills/update/` 入面；由呢份 SKILL.md 所在嘅資料夾向上兩層就係插件資料夾，入面嘅 `program` 資料夾就係 `<程式>`。宿主用自己嘅方式話你知呢份 SKILL.md 喺邊：Claude Code 載入技能時講「Base directory for this skill」（即 `skills/update/`）；Codex 喺技能清單每項後面寫 `file: …/skills/update/SKILL.md`（開頭嘅 `r0`、`r1` 之類要用清單頂「Skill roots」表換成完整路徑）；Antigravity 有講路徑就照用。宿主完全冇講路徑先用後備：按次序檢查 `~/.claude/plugins/cache/startup-os/startup-os/<版本>/program`、`~/.codex/plugins/cache/startup-os/startup-os/<版本>/program`、`~/.gemini/config/plugins/startup-os/program`（`~` 係而家登入用戶嘅個人資料夾；有幾個 `<版本>` 資料夾就用版本號最大嗰個），用第一個有 `update.mjs` 嘅。除此之外唔好用任何寫死嘅路徑；搵唔到 `<程式>/update.mjs` 就話畀創辦人知插件唔完整，請佢重新安裝插件，然後停。
- **項目根（下面寫做 `<項目根>`）**：由你而家對話嘅工作資料夾開始，逐層向上搵 `startup-os/ask.mjs`；搵到嗰層就係 `<項目根>`。搵唔到：講「這個項目未安裝 startup-os」，請創辦人輸入安裝指令（Claude Code `/startup-os:install`、Codex `$startup-os:install`、Antigravity `/install`），然後停。

## 創辦人想更新（`/startup-os:update`、`$startup-os:update`、`/update`、「有冇新版本」）

1. 先檢查，唔寫任何嘢：`node "<程式>/update.mjs" "<項目根>"`
   - 結束碼 0：已經係最新版本。照命令印出嘅一句話講，然後停。
   - 結束碼 2：未安裝。請創辦人輸入安裝指令（Claude Code `/startup-os:install`、Codex `$startup-os:install`、Antigravity `/install`），然後停。
   - 結束碼 4：AI 工作進行中。講「AI 工作進行中，完成後再更新」，然後停；唔好自己停止任何程序。
   - 結束碼 3：有新版本。去第 2 步。
   - 其他：照印出嘅原因話畀創辦人知，然後停；唔好自己改檔或者再試第二種方法。
2. **寫入之前一定要停**：將命令印出嘅嗰句「將更新 … 不會改動 … data」原文俾創辦人睇（命令另外印有「Founder Desk 目前開着」嗰句都要照講），再問「好嗎？」。然後停，等創辦人答。冇答「好」（或者同樣明確嘅同意）就唔好做任何寫入。
3. 創辦人答「好」之後執行：`node "<程式>/update.mjs" "<項目根>" --apply`
   - 結束碼 0：更新完成，照命令印出嘅結果用一兩句話講（新版本號、備份喺邊、`data/` 冇改動），再講下一步係打開 Founder Desk（Claude Code `/startup-os:desk`、Codex `$startup-os:desk`、Antigravity `/desk`）。
   - 結束碼 4：AI 啱啱開始咗工作，命令冇改任何檔；講一句，請創辦人遲啲再試。
   - 其他：更新未完成。命令會自己由備份還原，照佢印出嘅內容講清楚：係咪已經還原、`data/` 冇改動、原因係乜。唔好自己改檔或者刪嘢。

## 創辦人想還原上一個版本（「還原上一個版本」）

1. 先檢查，唔寫任何嘢：`node "<程式>/update.mjs" "<項目根>" --rollback`
   - 結束碼 3：有備份。將命令印出嘅嗰句「將把 … 還原到版本 …」原文俾創辦人睇，再問「好嗎？」。然後停，等創辦人答。
   - 結束碼 1：冇可以還原嘅備份，照印出嘅一句話講，然後停。
   - 結束碼 4：AI 工作進行中，完成後再試，然後停。
2. 創辦人答「好」之後執行：`node "<程式>/update.mjs" "<項目根>" --rollback --apply`
   - 結束碼 0：照命令印出嘅結果講（還原到邊個版本、`data/` 冇改動），再講下一步係打開 Founder Desk。
   - 其他：照印出嘅原因講，然後停。

## 一定要守

- 更新同還原都要創辦人喺今次對話明確答「好」先做；檢查（唔加 `--apply`）唔使問。
- 唔好手改 `startup-os/data/` 入面任何檔；唔好為咗「修好」而自己刪除、覆寫 `startup-os/` 或者備份資料夾（`.backup-` 開頭）。
- 唔好叫創辦人自己執行檔案；命令由你執行。
- 更新完唔會自動打開頁面：創辦人之後輸入 Founder Desk 或營運監察台指令（Claude Code `/startup-os:desk`／`/startup-os:dashboard`、Codex `$startup-os:desk`／`$startup-os:dashboard`、Antigravity `/desk`／`/dashboard`），開到嘅就係新版。
