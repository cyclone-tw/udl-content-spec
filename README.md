# udl-content-spec

UDL 教學家族（udl-learning、udl-classroom、各教材 repo）共用的**內容規格**：內容包格式、題型與計分、數學參數化出題、課綱碼標籤、作答事件契約、獨立執行器、一致性測試。教材 repo 與平台都以 git tag 版本相依這個 repo；規格本身不含任何教材正本、不含學生資料。

正本決策在 [udl-learning 總規劃 v1.1](https://github.com/cyclone-tw/udl-learning/blob/main/docs/plans/2026-10-10-material-factory-master-plan.md)（§3 概念模型、§4.4 多教材 repo、§6 呈現契約、§7 kit 接口）；前例研究在 [content-spec prior-art](https://github.com/cyclone-tw/udl-learning/blob/main/docs/research/2026-10-10-content-spec-prior-art.md)。工程 ledger：[udl-learning#67](https://github.com/cyclone-tw/udl-learning/issues/67)。

## 授權

- 程式、schema、測試：**MIT**（見 `LICENSE`）。
- `examples/` 的合成課文與題目：**CC-BY 4.0**（見 `LICENSE-CONTENT.md`），引用時標「udl-content-spec examples, cyclone-tw, CC BY 4.0」。
- 本 repo 只借用前例（H5P、Perseus、Oppia、Numbas、Moodle、CASE、ink）的設計邏輯，不引入它們的程式碼或素材。

## 預定結構（v1）

| 目錄 | 內容 | 狀態 |
| --- | --- | --- |
| `schema/` | `pack.json`、Unit／Material／Item／Pool／Scope 的 JSON Schema | v1（#3） |
| `question-types/` | 題型登錄表：每題型一個資料夾（作答 schema、`score()` 純函式、renderer 契約、版本與升版轉換）；v1：choice、true-false、match、numeric、blanks、ordering、classify；路線圖：drawing、speaking（v3 保留） | v1（#6、#10、#15） |
| `generators/` | 數學參數化產生器（種子可重現、條件不符重抽、`{變數}` 提示置換）；內容包只帶參數；`profiles/` 能力指標條件檔決定產生題能出什麼（第一條 `n-I-2#a@2`）；v1：`math.add-sub`（依條件檔；直式多格填空或橫式）、`math.add-2digit-carry`／`no-carry`（保留） | v1（#9、#18） |
| `events/` | 作答事件契約 `udl-attempt-events/v1`（檔案形狀、六種事件、處方欄位、隱私紅線）、建構器、`udl-lesson-attempt/v1` 轉接器、支持代碼對照草案 | v1（#21） |
| `runner/` | 獨立執行器：載入內容包、出題、判定、提示、下載事件檔；無登入、無後端 | 待做 |
| `audio/` | 音檔包格式：單音（注音音節，ASCII 鍵）、語詞（`詞\|注音`）、整課（連續音軌＋時間表、版本碼）三種清單 schema、鍵規則函式、只新增規則；決策正本在 udl-learning#102 | v1（#25） |
| `conformance/` | 驗證器（schema＋引用＋hash＋產生題參數落在能力指標條件檔內，`--ladder-dir` 可對 kit 階梯資料）；事件檔驗證器（`validate:events`，含隱私掃描）；音檔包清單驗證器（`validate:audio`）；內容 lint 待補；本機執行 | 驗證器 v1（#3、#18、#21） |
| `examples/` | 合成範例：國語一課、數學一小單元（最小版） | 最小版（#3） |
| `docs/` | 本 repo 的設計決定索引（連回正本，不複製） | 本 PR |

## 原則

1. 內容不含學生：任何學生差異由平台的開放／指派／處方處理。
2. 殼不判答案：判定只在題型的 `score()` 純函式，平台與獨立執行器用同一個函式。
3. 事件只有一種格式：送去哪裡（D1、下載檔、Drive）由宿主決定。
4. 破壞相容要升主版本並附轉換程式；內容包記格式版本，可鎖舊版。
5. 發佈與重測試在本機跑並附證據，不靠 GitHub Actions。

## 使用方式（預定）

```sh
pnpm add -D github:cyclone-tw/udl-content-spec#v1.0.0   # 教材 repo 或平台相依規格（tag 建立後）
pnpm exec udl-validate path/to/pack                     # 預定：套件化後的驗證指令
```

目前尚無 v1.0.0 tag；在本 repo 內用 `pnpm run validate <pack-dir>`（見 `conformance/README.md`）。判答案一律 `import { score } from "./question-types/index.mjs"`（見 `question-types/README.md`），殼與伺服器不自己比對答案。
