# 排程轉接層

每日自動開工由已開啟的 CrewZero 伺服器負責：它按經營節奏檢查，錯過排定時間只會在 6 小時內補做一次。install-schedule.mjs 不再登記每日作業系統工作；它只記錄創辦人的批准，並可另行登記「登入時打開 CrewZero」。

| 動作 | 命令 | 結果 |
|---|---|---|
| 印說明 | node adapters/scheduler/install-schedule.mjs | 不寫入；先說明每日開工與獨立的登入啟動選項 |
| 開啟每日自動開工 | --register | 寫入 data/ledger/schedule.json 的 mode: "server" 授權記錄；若伺服器未開，首次打開 Founder Desk 後才生效 |
| 同時開登入啟動 | --register --autostart | Windows 登記登入工作；macOS 寫 LaunchAgent；Linux 寫 desktop autostart。失敗不會取消已批准的每日自動開工 |
| 讀回 | --status | 第一行 JSON：ok、mode、登入啟動狀態、帳本的上次實際結果、下次時間 |
| 移除 | --remove | 移除授權記錄、登入啟動及同名的舊式 Windows 每日工作 |

- **兩項獨立同意**：答應每日自動開工，不代表答應登入電腦時自動打開 CrewZero。
- **Windows 登入工作**：New-ScheduledTaskTrigger -AtLogOn、New-ScheduledTaskAction、IgnoreNew 及 5 分鐘上限；主線須在真機確認 Windows 工作排程器不會在啟動檔結束時終止 detached 伺服器。
- **macOS**：~/Library/LaunchAgents/<登記名>.plist，以 launchctl bootstrap 後再 launchctl print 讀回。
- **Linux**：~/.config/autostart/<登記名>.desktop。
- **未經真機驗證**：Windows 工作排程器（會否在工作結束時關掉伺服器、登入時會否閃出視窗）、macOS 與 Linux 的登入啟動都未作真機驗證。安裝流程因此不主動提出登入啟動。
- **舊式遷移**：舊 schedule.json 沒有 mode: "server" 時，伺服器不會自行開工；系統頁會提示「更新自動開工設定」（AI 對話說「重新登記排程」亦可），原有 Windows 每日工作不會被更新破壞。
- **測試**：設定 SOS_SCHED_CMD=tests/prototype/lib/fake-schtasks.mjs 只記錄命令，絕不登記真排程。
