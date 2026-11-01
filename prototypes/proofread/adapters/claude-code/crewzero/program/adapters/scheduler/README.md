# 排程轉接層

`install-schedule.mjs` 叫作業系統每日按時執行安裝資料夾入面嘅 `run-schedule.cmd`（排程啟動檔：以絕對路徑執行 `node run.mjs --type auto --trigger schedule`，唔靠環境變數）。

| 動作 | 命令 | 用到嘅作業系統命令（Windows） |
|---|---|---|
| 印定義（唔登記） | `node adapters/scheduler/install-schedule.mjs` | 冇 |
| 登記（要創辦人批准） | `--register` | PowerShell：`New-ScheduledTaskAction`、`New-ScheduledTaskTrigger`（每日／平日／每星期）、`New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit -MultipleInstances IgnoreNew`、`Register-ScheduledTask -Force`；登記後即刻用 `Get-ScheduledTask`、`Get-ScheduledTaskInfo` 唯讀讀回 |
| 讀回 | `--status` | `Get-ScheduledTask`、`Get-ScheduledTaskInfo`（下次執行、上次執行時間、結果碼、錯過即補跑設定） |
| 移除 | `--remove` | `Unregister-ScheduledTask -Confirm:$false` |

- **登記名**：`crewzero-<安裝資料夾識別 8 個字>`，兩個安裝唔會撞名。改名前登記嘅排程叫 `startup-os-<識別>`：安裝資料夾仲叫 `startup-os/`，或者登記標記（`data/ledger/schedule.json`）寫住舊名，就沿用舊名，排程狀態、移除同重新登記都對準同一個排程。
- **錯過即補跑**：`-StartWhenAvailable`（電腦當時關機或者睡眠，下次可用時盡快補做）。執行時限＝經營節奏每次上限加 15 分鐘；同一時間只准一次（`IgnoreNew`）。同一日已經做過排程工作，補跑嗰次唔再開 AI（外殼判斷）。
- **未核實**：用「只在使用者登入時執行」登記時，電腦睡眠或關機後係咪真係補跑，要第一星期第一次漏跑時觀察一次（MVP 規格第 3 節）。
- **標記**：登記成功寫 `data/ledger/schedule.json`（登記名、節奏、登記時間、下次執行、命令全文）；伺服器見到標記就喺系統頁顯示「已登記」，節奏同帳本唔同就顯示「節奏已改，須重新登記」並喺待決事項放提示卡。
- **測試**：環境變數 `SOS_SCHED_CMD` 指向假程式（例如 `tests/prototype/lib/fake-schtasks.mjs`），只記錄參數，唔郁電腦上任何排程。
- **其他系統**：MVP 只支援 Windows 自動登記；macOS、Linux 只印定義，由人照住登記。
