# CrewZero（零號隊員）

給已在用 Claude Code、Codex 或 Antigravity 的創辦人與小團隊：一隊在你電腦上運行的 AI 團隊，先替你準備資料、草稿和練習；見客、收款、簽約仍由你決定和去做。

- 介紹頁：https://adamchanadam.github.io/crewzero/
- 每個版本改了甚麼：[版本說明](https://github.com/Adamchanadam/crewzero/releases)

## 你需要

Windows 電腦、Node.js，以及已安裝並登入的 Claude Code、OpenAI Codex CLI 或 Google Antigravity CLI（`agy`）其中一個。同一份插件三種工具都用得，只是指令的叫法不同。

## 安裝（每部電腦一次）

| 工具 | 輸入 |
|---|---|
| Claude Code | 在對話輸入 `/plugin marketplace add Adamchanadam/crewzero`，再 `/plugin install crewzero@crewzero` |
| Codex | 在命令列輸入 `codex plugin marketplace add Adamchanadam/crewzero`，再 `codex plugin add crewzero@crewzero` |
| Antigravity | 在命令列輸入 `git clone https://github.com/Adamchanadam/crewzero`，再 `agy plugin install crewzero/prototypes/proofread/adapters/claude-code/crewzero`（已在用 Claude Code 的話，`agy plugin import claude` 亦可） |

## 開始

1. 到你項目的 AI 對話輸入安裝指令，答「好」，並批准每日排程。
2. 之後用 Founder Desk 指令打開 Founder Desk。第一次打開時，系統會替你的瀏覽器配對，不用輸入任何東西。

| 指令 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 安裝 | `/crewzero:install` | `$crewzero:install` | `/install` |
| Founder Desk | `/crewzero:desk` | `$crewzero:desk` | `/desk` |
| 營運監察台 | `/crewzero:dashboard` | `$crewzero:dashboard` | `/dashboard` |
| 更新 | `/crewzero:update` | `$crewzero:update` | `/update` |

使用 Codex 或 Antigravity 時，AI 工作不會上網做研究，生意體檢與商機掃描只用你交的資料；情景演練與紅藍對打在 Claude Code 提供。

## 取得新版

先在你的工具換入新版插件，再到項目的 AI 對話輸入更新指令。更新只換程式，你的公司資料不會改動。

| 工具 | 換入新版插件 |
|---|---|
| Claude Code | 在命令列輸入 `claude plugin update crewzero`，然後重開 Claude Code |
| Codex | 在命令列輸入 `codex plugin marketplace upgrade`，再 `codex plugin add crewzero@crewzero` |
| Antigravity | 在之前下載的 crewzero 資料夾執行 `git pull`，再 `agy plugin uninstall crewzero`，然後重新 `agy plugin install crewzero/prototypes/proofread/adapters/claude-code/crewzero` |

## 由 startup-os 轉用 CrewZero

CrewZero 是 startup-os 的新名字。已在用 startup-os 的話，按你的工具做一次以下步驟：

| 工具 | 步驟 |
|---|---|
| Claude Code | 1. 在命令列輸入 `claude plugin marketplace update startup-os`<br>2. 再輸入 `claude plugin install crewzero`<br>3. 重開 Claude Code<br>4. 到項目的 AI 對話輸入 `/crewzero:update` |
| Codex | 1. 在命令列輸入 `codex plugin remove startup-os@startup-os`<br>2. 再輸入 `codex plugin marketplace remove startup-os`<br>3. 再輸入 `codex plugin marketplace add Adamchanadam/crewzero`<br>4. 再輸入 `codex plugin add crewzero@crewzero`<br>5. 重開 Codex，到項目的 AI 對話輸入 `$crewzero:update` |
| Antigravity | 1. 在命令列輸入 `agy plugin uninstall startup-os`<br>2. 再輸入 `git clone https://github.com/Adamchanadam/crewzero`<br>3. 再輸入 `agy plugin install crewzero/prototypes/proofread/adapters/claude-code/crewzero`<br>4. 到項目的 AI 對話輸入 `/update` |

- 程式會在項目原本的 `startup-os/` 資料夾內更新，資料夾不用改名，也不會另建 `crewzero/`。
- 公司資料（`startup-os/data/`）不會改動；已配對的瀏覽器與手機、每日排程都照舊有效。
- 之後打開頁面改用新指令，例如 Claude Code 的 `/crewzero:desk`。

## 你的資料

公司資料只存在你電腦上項目的 `crewzero/data/` 資料夾（由 startup-os 轉用的項目是 `startup-os/data/`）。只有已配對的瀏覽器或手機讀得到、寫得到；手機配對可以隨時撤銷。
