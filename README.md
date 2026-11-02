# CrewZero（零號隊員）

給已在用 Claude Code、Codex 或 Antigravity 的創辦人與小團隊：一隊在你電腦上運行的 AI 團隊，先替你準備資料、草稿和練習；見客、收款、簽約仍由你決定和去做。

- 介紹頁：https://adamchanadam.github.io/crewzero/
- 每個版本改了甚麼：[版本說明](https://github.com/Adamchanadam/crewzero/releases)

## 你需要

Windows 電腦、[Node.js](https://nodejs.org)（免費程式），以及已安裝並登入的 AI 工具。請先登入 Claude Code、Codex 或 Antigravity 其中一個。

## 安裝（每部電腦一次）

| 工具 | 在已登入的 AI 對話交給它 |
|---|---|
| Claude Code | 在對話輸入 `/plugin marketplace add Adamchanadam/crewzero`，再輸入 `/plugin install crewzero@crewzero` |
| Codex | 說：「請幫我安裝 CrewZero 插件：`codex plugin marketplace add Adamchanadam/crewzero`，再 `codex plugin add crewzero@crewzero`。」 |
| Antigravity | 說：「請幫我安裝 CrewZero 插件：`git clone https://github.com/Adamchanadam/crewzero`，再 `agy plugin install crewzero/prototypes/proofread/adapters/claude-code/crewzero`。」（已在用 Claude Code 的話，`agy plugin import claude` 亦可） |

你不用自己開命令列；AI 工具會先問過你才執行。如 AI 工具要求重新開啟，請照做。

## 開始

1. 在 AI 對話說「安裝 CrewZero」。如尚未有工作位置，請先為你的生意開一個專用資料夾；AI 會在開始前問你是否同意。
2. 完成後，在 AI 對話說「打開 Founder Desk」。第一次打開時，系統會替你的瀏覽器配對，不用輸入任何東西。

以後在 AI 對話說「打開 Founder Desk」，便可再次打開。

| 指令 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 安裝 | `/crewzero:install` | `$crewzero:install` | `/install` |
| Founder Desk | `/crewzero:desk` | `$crewzero:desk` | `/desk` |
| 營運監察台 | `/crewzero:dashboard` | `$crewzero:dashboard` | `/dashboard` |
| 更新 | `/crewzero:update` | `$crewzero:update` | `/update` |

使用 Codex 或 Antigravity 時，AI 工作不會上網做研究，生意體檢與商機掃描只用你交的資料；情景演練與紅藍對打在 Claude Code 提供。

## 取得新版

到 AI 對話說「更新 CrewZero」，AI 會先問過你才進行。更新只換程式，你的公司資料不會改動。

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

公司資料只存放在這部電腦。只有已配對的瀏覽器或手機可以讀取及寫入；手機配對可以隨時撤銷。手機只可在與這部電腦相同的家中或辦公室 Wi-Fi 使用；其他人要使用，請在這部電腦的瀏覽器開啟。
