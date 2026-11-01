# startup-os

給已在用 Claude Code、Codex 或 Antigravity 的創辦人與小團隊：一隊在你電腦上運行的 AI 團隊，先替你準備資料、草稿和練習；見客、收款、簽約仍由你決定和去做。

介紹頁：https://adamchanadam.github.io/startup-os/

startup-os 由「陶土 AI 團隊」代表：一位統籌成員，按工作分出六位生意大腦成員（生意體檢、紅藍對打、情景演練、商機掃描、路線推演、客戶推進追蹤）。角色、世界觀與用法的唯一定義處是 [`docs/plan/brand-characters-spec.md`](docs/plan/brand-characters-spec.md)。

## 現時版本：0.32（插件 0.5.0，2026-10-30）

新增更新指令 `/startup-os:update`：已安裝的項目可以換成新版程式，而 `startup-os/data/` 入面你的公司資料一個檔都不會改動。

- 先比較已安裝版本與插件版本；已是最新就不改動任何檔案。
- 寫入前先說明會更新多少個程式檔，你答「好」才進行。
- 舊程式先備份到 `startup-os/.backup-<舊版本>/`；逐個檔換入並核對；中途失敗會由備份自動還原。
- AI 工作進行中會拒絕更新；更新期間排程暫停開工。
- 有問題可以輸入「還原上一個版本」。

## 0.31（2026-10-30）

本版把陶土 AI 團隊放入真正的產品介面：

- **Founder Desk**：「今日要做的事」卡與「沒有待決事項」以暗淡的陶土場景作背景；AI 自動停時，問題包右邊是坐在枱邊等你的統籌成員。
- **營運監察台・運作環**：創辦人決定核心是門口（有待你決定的事時，門前放着文件與未寄出的信）；AI 統籌核心坐落在工作枱上，統籌成員按真實狀態工作、敬禮等你指示、企定待命或坐低等；每個真正運行中的 AI 工作是一位細成員，做生意大腦工作時戴上該項的胸章和道具。
- **動作只跟真實工作**：細成員與統籌成員只在真 AI 工作時才以定格動畫方式輕輕郁動；閒置時統籌成員偶然縮一縮身。暫停動效或系統減少動態時全部靜止。
- **生意大腦**：六個分頁頁頭各有自己的成員；未有資料時顯示六位成員排列圖。
- **手機**：運作環清單每行有陶土小頭像。
- **三級慶祝**：里程碑完成時，橫幅旁的台階插上新旗。
- 標題字與小標題字放大，閱讀層次更清楚。

## 目錄

| 位置 | 內容 |
|---|---|
| `prototypes/proofread/` | 程式本體（零依賴 Node.js）：本機伺服器、Founder Desk、營運監察台、AI 外殼 |
| `prototypes/proofread/adapters/claude-code/startup-os/` | 插件（Claude Code、Codex、Antigravity 共用同一份；四個指令 install、desk、dashboard、update），`program/` 由 `build-plugin.mjs` 生成 |
| `tests/prototype/` | 全套測試（隔離資料夾、假 AI、零費用）：`node tests/prototype/run-all.mjs` |
| `docs/` | 創辦人簡報、規劃書、設計規格、品牌角色與圖像 |
| `site/` | 介紹頁 |

## 開始

需要 Windows 電腦、Node.js，以及已安裝並登入的 Claude Code、OpenAI Codex CLI 或 Google Antigravity CLI（`agy`）其中一個。同一份插件三種工具都用得，只是指令的叫法不同。

1. 安裝插件（每部電腦一次）：

   | 工具 | 輸入 |
   |---|---|
   | Claude Code | 在對話輸入 `/plugin marketplace add Adamchanadam/startup-os`，再 `/plugin install startup-os@startup-os` |
   | Codex | 在命令列輸入 `codex plugin marketplace add Adamchanadam/startup-os`，再 `codex plugin add startup-os@startup-os` |
   | Antigravity | 在命令列輸入 `agy plugin install https://github.com/Adamchanadam/startup-os`（已在用 Claude Code 的話，`agy plugin import claude` 亦可） |

2. 到你項目的 AI 對話輸入安裝指令，答「好」，並批准每日排程。
3. 之後用 Founder Desk 指令打開 Founder Desk；有新版時先在你的工具換入新版插件，再輸入更新指令。

| 指令 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 安裝 | `/startup-os:install` | `$startup-os:install` | `/install` |
| Founder Desk | `/startup-os:desk` | `$startup-os:desk` | `/desk` |
| 營運監察台 | `/startup-os:dashboard` | `$startup-os:dashboard` | `/dashboard` |
| 更新 | `/startup-os:update` | `$startup-os:update` | `/update` |

Codex 與 Antigravity 版本目前 AI 工作不上網做研究：生意體檢與商機掃描只用你交的資料，情景演練與紅藍對打暫不提供；Claude Code 版本齊備。

## 不在本倉庫的東西

真實公司資料、示範資料、其他公司的模擬與試驗紀錄、舊版本備份、設計稿與截圖原檔都只留在本機（見 `.gitignore`）。
