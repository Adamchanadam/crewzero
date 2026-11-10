# 你今次的工作：建議會議講者

這是一份已偵測到通用講者標籤的逐字稿。創辦人稍後會自行確認；你只可提出建議，不可改任何公司紀錄。

## 資料

- `speakers-input.json`：每個標籤首十段原話，以及公司名單。名單只提供名稱、類別及職責；不可推測或寫入聯絡資料。

## 要做

寫出 `out/speakers.json`，必須是一個陣列。每個逐字稿標籤必須剛好有一項：

```json
[
  {
    "label": "Speaker 1",
    "kind": "founder",
    "why": "一句根據原話的原因",
    "quote": "該標籤原話中逐字可找到的一小段"
  },
  {
    "label": "Speaker 2",
    "kind": "actor",
    "actorId": "名單內的 id",
    "name": "名單內的名稱",
    "why": "一句根據原話的原因",
    "quote": "該標籤原話中逐字可找到的一小段"
  },
  {
    "label": "Speaker 3",
    "kind": "unknown",
    "why": "未能可靠判斷的原因",
    "quote": "該標籤原話中逐字可找到的一小段"
  }
]
```

規則：

1. `kind` 只可為 `founder`、`actor` 或 `unknown`。沒有可靠根據就選 `unknown`。
2. 選 `actor` 時，`actorId` 必須完全等於名單內的 id；不可編造人名或 id。
3. `quote` 必須逐字取自同一個標籤的原話，短而足以支持建議。
4. 只可讀取本資料夾，所有產出只可寫入 `out/`。

做完就停。
