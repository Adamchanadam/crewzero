# 公司概覽資料格式

資料必須是有效 JSON，`format` 以 `startup-os.proofread/` 開頭。`page` 包含 `id`、`kind`、`revision`、`preparedAt`，其餘可有 `nextAskOn`、`latestUntil`、`minutes`。`company` 包含 `name`、`initials`、`oneLiner`。`sources` 是來源清單，每項有 `id`、`title`，可有 `date`、`note`。如工作資料夾有 `biz.md`，按其中用字寫欄位內容。

`glance.rows` 是目標及下一步清單；每項是可改項目，期限可放在 `due` 可改項目。`glance.status` 可有 `title`、`prepared`、`items`；`prepared` 係一句講創辦人已經準備好邊啲資料，例如「已準備好：商業計劃（10 月 1 日版）、工房訪問紀錄」，唔好淨係寫日子，冇就唔寫；每項是 `kind: "grade"` 的可改項目，值只能是 `none`、`said`、`did`、`paid`。`decide.items` 是首屏項目編號清單；`@status` 代表現況，預設次序為現況、G5、G1。首屏三項（現況、G5、G1 嗰兩項）一定要寫 `ask`（白話一句問題，例如「下一步對外做乜？」「今季要去到邊？」）同 `judge`（一句判斷標準；講「公司以外」時保留呢個字眼，或者寫成「你以外」，唔好將對方名字代入，否則會同建議答案矛盾）；`glance.status` 一定要寫 `judge`（例如「冇發生就唔使撳；撳咗嘅再揀去到幾盡。」）。`label` 由畫面按格式決定，唔使花心機。

`path.milestones` 至少一項，每項有 `id`、`short`、`why`；可改項目 `event`、`actor`、`witness`、`proof`、`deliver`、`owner`、`target` 分別代表事件、決策者、見證人、證明、完成條件、負責人及目標日期；`depth` 可有五個可改項目，依次代表對方同意原因、決策方式和時間、前置條件、失敗原因、日期或數字依據。`watch` 是 `{label,value}` 清單。`beyondGoal` 標示目標以後的里程碑。

`detail` 可包含 `guide`、`tip`（`headline`、`why`）、`missing`（`title`、`how`，以及 `ref` 或可改項目 `edit`）、`reading`（可改項目清單）、`actors`（`title`、`judge`、`items`）、`lens`（可改項目）、`assumptions`（可改項目清單及 `test`）、`rules`（可改項目清單及 `boxes.auto`、`boxes.tellAfter`、`boxes.askFirst`）。各區可有 `title`、`guide` 和 `tip`。

**`detail.actors.items`（公司以外的決策者，也是「人物及機構名單」的來源，必須寫）**：文件或創辦人答案明確寫到的每個人或機構各一項，涵蓋五類：客戶、供應或合作方、投資者或資助方、顧問或協助者、團隊成員（共同創辦人、全職、兼職、外判；創辦人本人不寫）。關鍵伙伴、投資者、顧問的名稱也寫在這裏，不要只寫在生意模式一覽的文字格。每項除可改項目的 `id`、`label`、`value`（對方的狀態）、`origin` 外，另帶：`actorKind`（`customer`、`partner`、`investor`、`advisor`、`team` 之一；**不可用 `kind`，那是可改項目的欄位類型**）、選填 `org`（機構，最多 40 字）、`role`（角色，最多 40 字；團隊成員必填）；團隊成員另帶 `team: {"type": "cofounder｜fulltime｜parttime｜contractor", "owns": ["負責的里程碑 id"]}`。`label` 的名稱（括號或「·」之前的部分）是名單的稱呼，要和文件寫法一致。**只寫名稱、機構和角色，不寫電話、電郵、地址、社交帳號，也不寫薪酬、合約、表現。** 名字只可來自創辦人的文件或答案，不可憑空補人。

可改項目有唯一 `id`、`label`、`value`、`origin`；`kind` 為 `choice`、`grade`、`date`、`text`、`multi`，選項放 `options`，每項可有 `text`、`note`、`rec`；亦可有 `why`、`ask`、`judge`、`hint`。`plan` 用 `biz.type`、`canvas.*`（見下列清單）、G1 至 G10、`milestone.event`、`milestone.actor`、`milestone.witness`、`milestone.evidence`、`milestone.deliveryCondition`、`milestone.targetDate`、`depth.1` 至 `depth.5` 表示欄位用途。

`origin` 只能是 `doc`、`ai`、`default`、`missing`。文件明確寫出的資料用 `doc`，附 `src: [{"from":"來源編號","at":"位置"}]`；未知用 `missing`，在 `detail.missing` 說明怎樣找答案。文件未寫的建議或未發生、未有的狀態用 `ai`，預設規則用 `default`。暫定值加 `tentative: {"by":"ai","until":"YYYY-MM-DD","test":"最低成本的驗證方法"}`，期限最遲四星期，且不可遲於 G1 的期限。

虛構例子：`{"id":"g1","plan":"G1","label":"目前目標","value":"三十位訂戶試訂","origin":"doc","src":[{"from":"資料一","at":"目標"}]}`。

## 一定要齊（規劃書 3.1 就緒清單、3.3 四格；外殼會核對，唔齊會叫你修正一次）

- **`detail.reading` 生意模式一覽十二項一定要齊**：照以下 `plan`、`label` 同次序，每格一句，只放詳細資料，唔可以放入 `decide.items`：

  | plan | label |
  |---|---|
  | biz.type | 生意類型 |
  | canvas.customer | 客戶 |
  | canvas.problem | 對方的問題 |
  | canvas.alternatives | 現有替代方案 |
  | canvas.value | 價值 |
  | canvas.channel | 渠道 |
  | canvas.relationship | 客戶關係 |
  | canvas.revenue | 收入 |
  | canvas.resources | 關鍵資源 |
  | canvas.activities | 關鍵活動 |
  | canvas.partners | 關鍵伙伴 |
  | canvas.cost | 成本 |

  第一項用 `kind: "choice"`，`options` 依次係 `{"text":"服務"}`、`{"text":"實體貨品"}`、`{"text":"軟件、網上服務或內容"}`、`{"text":"平台或配對"}`、`{"text":"非牟利或社企"}`、`{"text":"其他"}`，AI 判斷嗰項加 `rec: true`；`value` 必須係其中一個 label，`origin: "ai"`，`why: "只影響問題及例子的用字，可以更改。"`。類別只可以喺呢一項出現，其他地方唔寫；其餘格嘅 label 保持上表原文，值按既有用字規則寫。

  其餘項目：創辦人答案或者文件寫明嘅用 `origin: "doc"` 並按現有來源規則附 `src`；AI 推斷用 `origin: "ai"`；不適用寫「不適用」；唔知而且推斷唔到嘅用 `origin: "missing"`、`value: "待你補充"`，並喺 `detail.missing` 說明。呢區嘅數字、人名、金額只可以來自答案或者文件，唔可以虛構。現有替代方案可以按行業常識或者公開資料估計，標 `origin: "ai"`；用到外部事實要按現有規則列標題、網址、查閱日期，只有摘要就寫明。

- **G1–G10 每項都要有值**；冇數字、冇金額、冇日期都要填：寫「對方書面答覆是否合作」一類不需數字的事件，或者「由對方提出」，或者 AI 建議值（加 `tentative`）。
  - `glance.rows` 要有以下可改項目，各帶 `plan`（括號係核對訊息用嘅名）：`G1` 目前目標（期限放 `due`）、`G2`「短期目標」＝下一個檢查期（要帶 `due`：`plan: "G2.endsOn"`、`kind: "date"`；日期預設＝G1 期限與 `preparedAt` 加 28 日中較早的一個，不可遲於 G1 期限）、`G3`「怎樣才算有進展」（付款、簽名、使用紀錄、文件、對方書面答覆一類，唔可以係活動次數）、`G5`「下一個對外動作」、`G6`「負責人」＝已有人負責的事（每項寫「我自己／具名的人／未有」；決策者名單有團隊成員時，G6 的值寫「依團隊名單」，具名的人寫進 `detail.actors.items`，G6 之後由團隊名單自動整理，不再另寫）、`G9`「產品或服務的要求與特色」。G1、G2 的 `value` 不寫日期，期限只放 `due`；`glance.rows` 任何一項的 `value` 都不要以日期開頭（例如「至 12 月 4 日：」）。其他項目內容中間的事實日期（例如「2026 年 11 月 6 日已答應加入」）可以寫。
  - `G4` 就係 `glance.status.items`（目前去到哪裏）。只有某一項本身就是某個里程碑的 `event` 或 `deliveryCondition`，才加 `"milestone": "里程碑 id"`；通往該站的前置步驟（例如「表示有興趣」）不可加。已實際發生並達「實際行動」或以上，而且文件寫明的項目，成頁確認後該站才當已完成。
  - `detail.rules` 要有 `plan: "G7"`「Zero 可自行處理的事」（三格權限，連 `boxes`）、`plan: "G8"`「經營節奏」（文件冇寫就 `origin: "default"`，值寫「用預設：每日晚上 9 時工作一次；逢星期一了解近況」）、`plan: "G10"`「業務線數目」（預設「一條業務線」）。
- **暫定值一定要寫來源同限期**：`tentative: {"by": "ai"|"actor"|"founder", "until": "YYYY-MM-DD", "test": "最低成本的驗證方法"}`；`ai`＝AI 建議、`actor`＝由對方提出、`founder`＝創辦人暫定；限期最遲四星期，且不可遲於 G1 嘅期限。文件冇寫、由你建議嘅 G 欄值一律暫定。
- **每個里程碑四格都要填**：`event`「里程碑事件」（公司以外真係發生嘅事）、`actor`「決策者」（邊個外部角色要點頭）、`witness`「見證人」（邊個見證，唔可以係 AI 或者創辦人本人）、`proof`「證明方式」（用乜證明：文件、紀錄或收據一類）。文件冇寫就寫建議值、`origin: "ai"`。
- **每個里程碑五條為甚麼（`depth`）都要有答案**：文件冇寫就寫 AI 推斷（`origin: "ai"`，加 `test` 最低成本嘅驗證方法）；唔好留空。創辦人會逐條確認或者改寫。
- **每個里程碑加 `kind`**：`"real"`（真事：公司以外有人做咗某件事）或者 `"task"`（工作：我方自己做嘅事，例如寫好一份文件）；可加 `kindWhy` 一句理由。創辦人會逐站判斷。
- **缺少嘅細節係 AI 嘅首批工作**：`detail.missing` 每項寫清楚搵乜同點樣搵（問邊個、睇邊份文件）；唔好寫「等每週了解近況時補答」。確認後外殼會逐項開工作。
