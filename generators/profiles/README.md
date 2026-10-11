# profiles — 能力指標出題條件檔

每一道數學產生題都必須回答「這題在檢測哪條能力指標」，而且**指標決定題目長相**：先有指標，再從指標的條件檔決定位數、進退位次數、題型、題數、鷹架；參數不能超出條件檔允許的範圍；單元只能再收窄，不能放寬。驗證器擋下沒有指標、指標沒有條件檔、或參數超出條件檔的產生題。

## 三層分工

| 層 | 放哪 | 內容 | 誰改 |
| --- | --- | --- | --- |
| **條件檔**（通用） | 本資料夾，一條 kit 階梯行為一份 | 全部檔位與條件、數字形狀、預設（題數、呈現、鷹架、情境、不重複）、每種課程調整的預設方案、每檔三層提示範本、回饋與題幹範本 | 規格 repo PR |
| 處方（個別） | kit 給平台的名冊 → 平台 DB | 學生 × 指標：用哪種調整、是否改預設、或不適用。不產出綁個別學生的內容檔 | 教師在平台 |
| 尺（判級） | kit／IEP | 調整後的及格基準（縣府特教教材教法及評量實施計畫第八條要求載明 IEP） | kit |

udl 只報事實：「指標 X：n 題對 k、調整方式、鷹架檔、提示用到第幾層」。「達到」兩個字只有 kit 會說，所以 kit 改標準時 udl 不會判錯。

## 登錄表

| ladder id | 檔案 | kit 原文 | 產生器 | 狀態 |
| --- | --- | --- | --- | --- |
| `n-I-2#a@2` | `n-i-2-a-2.json` | 能用直式計算二位數加減（含一次進位或退位），10 題正確率約八成 | `math.add-sub` v1 | v1（#18） |

檔名：ladder id 轉小寫，`#` 與 `@` 換成 `-`。正本永遠是 kit `data/ladder/*.json`；`ladder_ref` 只是快照，commit 與原文供人工對照。

## 檔位（`tiers`）

檔位是老師看得懂的條件組，例如「加法：恰一次進位」。條件欄位由產生器解讀：`operation`、`carries`（進位次數，恰好）、`borrows`（退位次數）、`minuend_ones_zero`（被減數個位是否為 0）、`sum_max`／`sum_min`。`n-I-2#a@2` 的六檔：

| 檔位 | 條件 | 預設 |
| --- | --- | --- |
| `add-no-carry` | 加法、0 次進位 | 開，權重 3 |
| `add-one-carry` | 加法、恰 1 次進位（個位進十位且和 < 100，或十位進百位且個位不進） | 開，權重 7 |
| `add-two-carries` | 加法、2 次進位（和 ≥ 100） | 關 |
| `sub-no-borrow` | 減法、0 次退位 | 開，權重 3 |
| `sub-one-borrow` | 減法、1 次退位、被減數個位 ≠ 0 | 開，權重 7 |
| `sub-borrow-from-zero` | 減法、1 次退位、被減數個位 = 0 | 關 |

## 預設與調整

`defaults` 是「老師什麼都沒選」時的出法；`adjustments` 是五種課程調整各自對 `defaults` 的覆寫（鍵固定：`simplify` 簡化、`reduce` 減量、`decompose` 分解、`substitute` 替代、`not_applicable` 不適用＝`skip`）。處方層呼叫：

```js
import { getProfile, resolveParams } from "udl-content-spec/generators/index.mjs";

const profile = getProfile("n-I-2#a@2");
const { params, count } = resolveParams(profile, { adjustment: "simplify", overrides: { count: 8 }, mode: "assess" });
// params → item.params；count → item.count；mode 決定鷹架取 scaffold.assess 還是 scaffold.practice
```

`resolveParams` 會用 `checkParams` 檢查結果仍在條件檔範圍內，超出就丟 `TypeError`。老師的覆寫只能收窄（少開檔位、少題、換呈現、換鷹架），不能開條件檔沒有的檔位。

## 提示與回饋

每個檔位三句範本（輕推 → 縮範圍 → 近答案），可用產生器變數（見 `math/add-sub/README.md`）。題目檔沒寫 `hints`／`feedback` 就用範本；寫了就覆寫。逐位狀態提示（看學生做到哪一位再給）是 renderer「完整鷹架」的加值功能，不取代三層。

## 新增一條指標

1. 從 kit `data/ladder/*.json` 抄 `id`、`behavior`、`content_codes` 與 kit commit 進 `ladder_ref`。
2. 把行為句翻成檔位：每個條件組一檔，給老師看的 `label`。
3. 定 `defaults`（哪幾檔預設開、權重、題數、呈現、鷹架、情境）與五種調整的預設方案；這些是教學決定，要 Cyclone 確認。
4. 每檔三句提示範本、回饋、題幹範本。
5. 加進 `index.mjs` 登錄表；`pnpm test` 會檢查 schema、檔位條件、提示齊全、`resolveParams` 五種調整。
6. 需要新的條件欄位或新運算就升產生器版本或開新產生器。

## 驗證器怎麼用它

`conformance/validate.mjs` 對每道產生題：`ladder_ids` 之中恰有一條有條件檔；`generator`／`generator_version` 等於條件檔所列；`params` 通過產生器的 `params.schema.json`（形狀）與 `checkParams`（範圍）；`context_pools` 引用的池存在。加 `--ladder-dir <kit data/ladder>` 時所有題目與單元的 `ladder_ids` 都必須存在於 kit 階梯資料。

## 決策來源

Cyclone 2026-10-11 逐題確認，紀錄在 cyclone-tw/udl-content-spec#18。參考既有實作 `block-borrow-adventure`（關卡＝條件檔、老師可調題數與範圍、情境範本＋池、提示依狀態）。
