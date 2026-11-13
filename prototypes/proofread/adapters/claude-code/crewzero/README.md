# CrewZero（零號隊員）

創業起步常常孤軍作戰。Zero 是你的 AI 隊員，在背後陪你由構思開始一起打拚。CrewZero 在你的電腦上運行，配合已安裝並登入的 Claude Code、Codex 或 Antigravity 使用：Zero 團隊先替你準備資料、草稿和練習；見客、收款、簽約仍由你決定和去做。

- 介紹頁：https://adamchanadam.github.io/crewzero/
- 原始碼及版本說明：https://github.com/Adamchanadam/crewzero

## 你需要

- Windows 電腦及 [Node.js](https://nodejs.org)（免費程式）。
- 已安裝並登入的 Claude Code、Codex 或 Antigravity。CrewZero 要在你的電腦上運行，claude.ai 網頁版及手機程式的對話不能使用。

## 安裝插件（每部電腦一次）

| 工具 | 在已登入的 AI 對話交給它 |
|---|---|
| Claude Code | 輸入 `/plugin marketplace add Adamchanadam/crewzero`，再輸入 `/plugin install crewzero@crewzero` |
| Codex | 說：「請幫我安裝 CrewZero 插件：`codex plugin marketplace add Adamchanadam/crewzero`，再 `codex plugin add crewzero@crewzero`。」 |
| Antigravity | 說：「請幫我安裝 CrewZero 插件：`git clone https://github.com/Adamchanadam/crewzero`，再 `agy plugin install crewzero/prototypes/proofread/adapters/claude-code/crewzero`。」 |

## 指令

| 用途 | Claude Code | Codex | Antigravity |
|---|---|---|---|
| 安裝到你的生意資料夾 | `/crewzero:install` | `$crewzero:install` | `/install` |
| 打開 CrewZero（每日入口） | `/crewzero:dashboard` | `$crewzero:dashboard` | `/dashboard` |
| 和 Zero 討論 | `/crewzero:discuss` | `$crewzero:discuss` | `/discuss` |
| 更新程式 | `/crewzero:update` | `$crewzero:update` | `/update` |
| 加延伸功能 | `/crewzero:extend` | `$crewzero:extend` | `/extend` |

亦可在 AI 對話直接說「安裝 CrewZero」「打開 CrewZero」「和 Zero 討論」「更新 CrewZero」或「加延伸功能」。安裝及更新前，AI 工具都會先問過你。

## CrewZero 在你電腦上做的事

- **資料位置**：在你指定的生意資料夾內建立 `crewzero/`，程式及公司資料只存放在這裏。更新只換程式，不改動 `crewzero/data/`。業績紀錄及生意模式圖的資料同樣存放在這個資料夾內；延伸功能的設定及資料存放在生意資料夾內的「延伸功能」資料夾。
- **本機網頁**：開啟本機網頁伺服器，只接受這部電腦（127.0.0.1）的連線，埠號由 4380 起。你在系統分頁開啟手機配對時，才另外在家中或辦公室網絡的私人位址開放，只限已配對的裝置；配對可隨時撤銷。
- **啟動 AI 工具**：Zero 的工作由你已登入的 AI 工具完成。CrewZero 在你的生意資料夾內啟動該工具；啟動前，名稱含 TOKEN、KEY、SECRET、PASSWORD、CREDENTIAL、BEARER、OAUTH 或以 CLAUDE 開頭的環境變數一律移除，不交給該工具。工作內容會經該工具送到其服務供應商，按該工具的條款處理。
- **上網研究**：AI 工具可按工作需要上網搜尋及開啟網頁。
- **自動開工**：你在系統分頁開啟後，每日自動開工由已開啟的 CrewZero 伺服器按你選的經營節奏進行。「登入時打開 CrewZero」要另外同意：Windows 登記一項登入時執行的工作排程，macOS 寫入 LaunchAgent，Linux 寫入桌面自動啟動項目。在 AI 對話說「移除排程」即可全部移除。
- **CrewZero 程式本身的網絡連線**，只有以下三種：
  - 你貼上 Google 文件、試算表或簡報連結時，從 `docs.google.com` 下載匯出副本，存為附件。
  - Zero 在產出引用的外部網址，以 HTTPS 試開一次，確認能否開啟，不讀取或儲存網頁內容；本機及私人網段的位址一律不連線。
  - 認證 AI 工具時，連線 `https://example.com/`，確認這部電腦能上網。
- **不收集使用資料**：CrewZero 沒有使用統計，亦不會把你的資料傳給開發者。頁面上的「給意見」及「支持 CrewZero」只是連結，你按下才會開啟。

## 商業模式卡的參考來源

Zero 構思及檢視生意模式時參考程式內的商業模式卡（`program/model-cards.md`）。模式名稱及分類參考下列公開資料；卡片文字由 CrewZero 自行撰寫，不代表各來源的立場。

- Business Model Navigator 模式清單：https://businessmodelnavigator.com/explore
- Y Combinator Startup School「Startup Business Models and Pricing」摘要：https://summify.io/discover/startup-business-models-and-pricing-startup-school-oWZbWz
- Stone & Chalk 九種初創商業模式及指標：https://www.stoneandchalk.com.au/articles/9-business-models-for-billion-dollar-startups
- a16z 按用量收費與訂閱的選擇原則：https://a16z.com/usage-based-pricing-rule-of-thumb/
- Board of Innovation 商業模式例子：https://boardofinnovation.com/guides/50-business-model-examples/
- 生意模式圖按 Business Model Canvas 九格整理：https://www.strategyzer.com

## English

CrewZero is a local AI team for founders who already use Claude Code, Codex or Antigravity. Zero prepares research, drafts and practice runs; the founder makes every decision and takes every real-world action. It needs a Windows computer, Node.js and a signed-in AI tool. It runs on your own computer, so it does not work in the claude.ai web or mobile chat.

What CrewZero does on your computer:

- Creates a `crewzero/` folder inside the business folder you choose. Program files and company data stay there; updates replace program files only and never change `crewzero/data/`.
- Runs a local web server on 127.0.0.1, starting at port 4380. Only when you turn on phone pairing does it also listen on your private home or office network address, and only paired devices can use it.
- Starts your signed-in Claude Code, Codex or Antigravity command-line tool to do Zero's work. Before starting it, CrewZero removes environment variables whose names contain TOKEN, KEY, SECRET, PASSWORD, CREDENTIAL, BEARER or OAUTH, or start with CLAUDE. Work content is sent to that tool's provider under that tool's terms. The AI tool may search and read the web.
- Daily auto-start is run by the CrewZero server after you turn it on in the System tab. Opening CrewZero at login is a separate opt-in: a Windows logon scheduled task, a macOS LaunchAgent or a Linux desktop autostart entry. Saying "移除排程" removes them.
- CrewZero's own code makes only three kinds of network requests: it downloads export copies of Google Docs, Sheets or Slides links that you paste (docs.google.com only); it opens each external source link cited by Zero once over HTTPS to check that the link works, without reading or storing the page and never contacting local or private addresses; and it checks `https://example.com/` while certifying an AI tool, to confirm that the computer is online.
- No analytics. Nothing is sent to the developer.

The business model cards (`program/model-cards.md`) are written by CrewZero. Pattern names and groupings draw on the public sources listed in the Chinese section above; they do not represent those sources' views. The business model map follows the nine blocks of the Business Model Canvas (Strategyzer).

Privacy policy: [https://adamchanadam.github.io/crewzero/privacy.html](https://adamchanadam.github.io/crewzero/privacy.html)

## 授權及作者 / License

CrewZero（零號隊員）由 Adam Chan 製作，以 Apache License 2.0 授權，詳見本資料夾的 `LICENSE` 及 `NOTICE`。CrewZero、零號隊員名稱、標誌及 Zero 角色圖不在授權範圍內。

CrewZero is made by Adam Chan and licensed under the Apache License 2.0 (see `LICENSE` and `NOTICE`). The CrewZero name, logo and Zero character artwork are not covered by the licence.

## 意見及支持

歡迎[給意見](https://docs.google.com/forms/d/e/1FAIpQLScnJzUP1-pt5IfWE29x8URA9fJpVBvgji4vHHdj12wIb2zRgA/viewform)，或[支持 CrewZero](https://buymeacoffee.com/adamchan)。

私隱政策：[https://adamchanadam.github.io/crewzero/privacy.html](https://adamchanadam.github.io/crewzero/privacy.html)
