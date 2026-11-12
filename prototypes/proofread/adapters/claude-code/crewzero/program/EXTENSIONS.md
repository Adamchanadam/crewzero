# 延伸功能說明

延伸功能讓創辦人為個別工作建立專用資料表，例如訂單生產進度、預約與出席或存貨。CrewZero 會按宣告自動提供看板、清單及表單；資料留在項目資料夾內，更新 CrewZero 時不會改動。

延伸功能不是改寫 CrewZero 程式、不是公司紀錄的另一條寫入途徑，也不是自動對外發送工具。不可修改 CrewZero 的程式、crewzero/ 資料夾或 crewzero/data/；不可代創辦人確認任何決定；不可把資料發送到外部服務。

## 先找安裝資料夾

新安裝的程式資料夾是 crewzero/；舊安裝仍可能叫 startup-os/。以下指令以新安裝為例；如使用舊安裝，把 crewzero/ 改為 startup-os/。

## 資料夾

在項目資料夾建立 延伸功能/，每個功能使用一個子資料夾。資料夾名稱只可含文字、數字、空格及 -，最多 30 字。每個功能的結構如下：

    延伸功能/
      訂單生產進度/
        extension.json
        data/
          t1.json
        page/                 （可免）

extension.json 是宣告；data/ 內每個資料表有一個 <資料表代號>.json。不要在 crewzero/ 或其 data/ 內寫入任何延伸功能檔案。

## 宣告格式

extension.json 是 JSON，頂層只可有 format、guide、name、about、tables、page：

    {
      "format": "crewzero.extension/1",
      "guide": 1,
      "name": "訂單生產進度",
      "about": "每張客戶訂單做到哪個工序",
      "tables": []
    }

name、各個 label 不可空白，最多 20 字；about 最多 80 字。每個功能最多 3 個資料表；每表最多 20 個欄位、4 個摘要數字、8 條交給 Zero 規則。

每張表只可有 id、label、title、due、fields、summary、handoff、retired。表代號必須是 t 加數字，例如 t1。title 必須指向同一張表的一個文字欄位；due 如有，必須指向日期欄位。

欄位只可有 id、label、type、required、hidden、stages、options、currency。欄位代號必須是 f 加數字，例如 f1，整份宣告不可重複或重用代號。可用欄位種類如下：

| 種類 | 資料值 |
| --- | --- |
| text | 最多 2,000 字的文字 |
| number | 有限數字 |
| money | amountCents 整數及三個大寫英文字母的 currency |
| date | YYYY-MM-DD |
| bool | true 或 false |
| choice | 已宣告的選項代號 |
| stage | 已宣告的工序代號 |
| actor | 名單對象的 id 及當時名稱 |

required 只可為 true 或 false；必填欄位和 title 欄位不可隱藏。money 的 currency 可免，填寫時必須是三個大寫英文字母。

一張表最多一個 stage 欄位。工序代號必須是 s 加數字，例如 s1；工序最少 2 個、最多 8 個。choice 的選項代號必須是 o 加數字，例如 o1；每個選項欄最少 1 個、最多 20 個選項。工序和選項的每個項目只可有 id、label。

summary 是最多 4 項的陣列，每項只可有 label、rule、days、field。可用規則是：

- open：未封存而未到最後工序的數目。
- overdue：已過交貨日的數目；表必須設定 due。
- dueWithin：指定日數內到期的數目；表必須設定 due，days 是 1 至 90 的整數。
- sum：指定數字或金額欄位的總和；field 指向該欄位。

handoff 是最多 8 項的陣列，每項只可有 stage、text。stage 必須是該表已有的工序。text 最多 200 字，可使用同一張表內欄位的代號，例如 訂單「{f1}」已出貨給 {f2}，數量 {f3}。最後工序的交給 Zero 只會建立待確認事項；不會自行更改公司紀錄。

已用過的欄位、選項和資料表代號不可刪除或改種類。只有沒有任何卡片的工序可以刪除；刪除後把它的 s 代號放入 retired，之後不可重用。

如需要獨立頁，page 只可有 label、port。port 必須是 1024 至 65535，且不可與 CrewZero 相同。只在電腦本機的 page/ 內建立；複製一份 ext-style.css 使用。CrewZero 只會提供打開連結，不會載入、啟動或執行該頁的程式。

## 資料列

每個 data/t1.json 的外層是 { "schema": 1, "rows": [] }。每一行有 id、rev、v、createdAt、updatedAt、archived、handedAt；欄位值放在 v，以 f 代號作鍵。新增資料時提供所有必填欄位。不要刪除資料列；已完成或不再使用的資料列標記為 archived，日後可取回。

## 先用積木

先使用 CrewZero 的資料表積木。只有積木無法完成工作時，才在 page/ 建獨立頁。獨立頁不可直接讀寫 CrewZero；需要讀公司紀錄時，只可執行：

    node crewzero/ask.mjs --records

這個指令只讀取已確認的公司資料。任何公司紀錄改動只可透過：

    node crewzero/ask.mjs --tell <草稿檔>

先向創辦人展示草稿並取得確認，才可交給 Zero。不可手改公司資料檔。

## 完整例子：包裝廠訂單生產進度

建立一個名為「訂單生產進度」的功能，內有一張 t1「訂單」表。f1 是必填文字「訂單名稱」；f2 是「客戶」名單對象；f3 是「數量」；f4 是必填日期「交貨日」；f5 是工序，依次為 s1「打樣」、s2「印刷」、s3「成型」、s4「品檢」、s5「出貨」；f6 是可隱藏的「備註」文字。

把 title 設為 f1、due 設為 f4。摘要依次為「延誤」的 overdue、「七日內交貨」的 dueWithin（days 為 7），以及「進行中」的 open。handoff 設在 s5，文字為：訂單「{f1}」已出貨給 {f2}，數量 {f3}。資料列可以有訂單名稱、客戶、數量、交貨日和目前工序；已完成而不再需要顯示的列以 archived 標記。

## 完成前檢查

完成所有檔案後，先執行：

    node crewzero/ask.mjs --check-extension "訂單生產進度"

修正所有格式問題後，請創辦人到「延伸功能」頁按「啟用」。AI 建立檔案不等於已啟用；只有創辦人按下「啟用」後，功能才會出現在公司現況摘要。
