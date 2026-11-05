# CrewZero：由這裏開始

這個資料夾是 CrewZero（版本 {version}，{date} 安裝）：Zero 團隊與創辦人一起經營這間初創的工具。程式與資料都在這裏，不會改動項目的其他檔案。

## 四個入口（在這個項目的 AI 對話輸入）

同一套程式配合 Claude Code、Codex 或 Antigravity 使用，只是指令的叫法不同：

| 入口 | Claude Code | Codex | Antigravity | 作用 |
|---|---|---|---|---|
| Founder Desk | `/crewzero:desk` | `$crewzero:desk` | `/desk` | 待決事項、告訴 Zero、公司概覽、決定紀錄。**每日從這裏開始。** |
| 營運監察台 | `/crewzero:dashboard` | `$crewzero:dashboard` | `/dashboard` | 公司現況、生意大腦、業務路徑、團隊、紀錄、系統。 |
| 安裝 | `/crewzero:install` | `$crewzero:install` | `/install` | 安裝、重新登記排程或移除排程（在對話輸入「安裝排程」「重新登記排程」「移除排程」亦可）。 |
| 更新 | `/crewzero:update` | `$crewzero:update` | `/update` | 把程式更新到插件的新版本（更新前會先問你；`data/` 不會改動）。出了問題，在對話輸入「還原上一個版本」。 |

## 要知道的事

- **`data/` 由系統寫入，請勿手改**：公司概覽、決定紀錄、問題包、Zero 工作紀錄都在這裏。要改內容，請在 Founder Desk 作答或交要求。其他 AI 對話亦不應直接改動 `data/`。
- **版本控制**：建議把 `{dir}/data/` 排除在版本控制之外（安裝不會改動你的設定檔）。
- **沒有本機通知**：Zero 按排程工作後不會彈出提示。請每日自己打開 Founder Desk（上表第一行的指令），頁頂的「上次離開之後」會寫明 Zero 做了甚麼、有幾多條等你回答。
- **每日自動開工**：你批准後，CrewZero 伺服器會按節奏開工（預設每日 21:00）。電腦開着並已打開 CrewZero 時才會按時開工；錯過後只會在 6 小時內補做一次。電腦重開後，要先打開一次 Founder Desk 才會恢復。排程狀態在營運監察台「系統」頁。
- **出錯時**：先看營運監察台「系統」頁——AI 工具設定、排程、最近十次工作的結果與原因都在那裏；Zero 工作失敗的，在 Founder Desk 按「重試」。
- **程式更新**：先在你的 AI 工具換入新版插件，再在對話輸入更新指令（上表最後一行）。更新只換程式檔，**不會改動 `data/`**；舊版先備份到 `.backup-<舊版本>/`，換入後逐檔核對；現時版本號寫在 `VERSION`。不需要時可自行刪除 `.backup-` 開頭的備份資料夾。
- **Codex 與 Antigravity**：目前 Zero 工作不上網做研究——生意體檢與商機掃描只用你交的資料；情景演練與紅藍對打暫不提供。Claude Code 則齊備。
