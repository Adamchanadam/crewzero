---
name: extend
description: "為 CrewZero 加延伸功能。使用者說「加延伸功能」、「加一個功能」、/crewzero:extend、$crewzero:extend 或 /extend 時使用。"
---

# 加延伸功能

先由目前工作資料夾逐層尋找安裝資料夾：優先找 crewzero/，找不到才找舊名稱 startup-os/。兩者都找不到時，說明此項目尚未安裝 CrewZero，並停止。

找到後，必須先完整閱讀安裝資料夾內的 EXTENSIONS.md，才可以規劃、建立或修改任何延伸功能。其餘工作一律依照該檔的資料夾、宣告、公司紀錄、核對及啟用規則。

三種工具的入口如下：

| 工具 | 指令 |
| --- | --- |
| Claude Code | /crewzero:extend |
| Codex | $crewzero:extend |
| Antigravity | /extend |

不可使用本機絕對路徑。完成後先執行 EXTENSIONS.md 指定的 --check-extension 檢查；核對通過後，請創辦人到「延伸功能」頁按「啟用」。
