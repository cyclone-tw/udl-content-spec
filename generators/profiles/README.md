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
| `n-II-9#b@3` | `n-ii-9-b-3.json` | 能用直角板判斷一個角是直角、比直角大或比直角小 | `math.angle-vs-right` v1 | v1（#69，Cyclone 2026-10-22 確認預設） |
| `s-II-3#b@4` | `s-ii-3-b-4.json` | 能依邊與角的特徵分辨正三角形、等腰三角形、直角三角形、銳角三角形與鈍角三角形 | `math.triangle-classify` v1 | v1（#70，Cyclone 2026-10-22 確認：三檔 12 題 4／4／4、課程調整已確認） |
| `n-II-9#b@4` | `n-ii-9-b-4.json` | 能用量角器量出角度，包括兩邊不在刻度 0 上的角 | `math.angle-measure` v1 | v1（#71，Cyclone 2026-10-22 確認：三檔 10 題 4／4／2、±2 度、課程調整已確認） |
| `s-II-4#b@4` | `s-ii-4-b-4.json` | 能說出平角是 180 度、周角是 360 度，並算出兩個旋轉角的和或差，結果不超過 360 度 | `math.angle-sum` v1 | v1（#72，Cyclone 2026-10-22 確認：四檔 10 題 3／2／3／2、有圖、課程調整已確認） |
| `s-II-2#a@4` | `s-ii-2-a-4.json` | 能把兩個圖形描下剪開，經滑動、轉動或翻面疊合，判斷形狀大小是否一樣（全等） | `math.congruent-triangles` v1 | v1（#74，Cyclone 2026-10-22 確認：各 6 題） |
| `s-II-2#b@4` | `s-ii-2-b-4.json` | 能在兩個全等圖形中指出對應邊與對應角，並說出對應邊等長、對應角相等 | `math.congruent-triangles` v1 | v1（#74，Cyclone 2026-10-22 確認：各 6 題） |

條件檔的形狀依產生器分家：`profile.schema.json` 依 `generator` 分派到 `profile.<產生器>.schema.json`（`$ref` 用 `$id`），**編譯 `profile.schema.json` 之前要先把 `PROFILE_FAMILY_SCHEMA_PATHS` 列的每一份加進 Ajv**，否則 `$ref` 解不開（測試與驗證器都這樣做）。`checkParams`／`resolveParams` 也依 `generator` 分派：加減法規則在 `index.mjs`，幾何產生器用 `_family.mjs` 的工廠（檔位＋權重＋題數，再加各自的列舉、布林與依 mode 取值的設定）。三層分工、五種課程調整的鍵、`resolveParams` 的用法各產生器相同。

`n-II-9#b@3` 的檔位：`clear` 明顯（銳角 20–60 度、鈍角 120–160 度，權重 6）、`right` 直角（90 度，權重 3）、`near` 接近直角（銳角 65–75 度、鈍角 105–115 度，權重 3），預設 12 題；簡化＝只出明顯與直角、減量＝6 題、分解＝一開始就疊上虛擬直角板、替代＝兩選一「是不是直角」、不適用＝不出題。練習模式第 2 層提示自動疊上直角板，評量模式只給切換鈕。

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

`resolveParams` 會用 `checkParams` 檢查結果仍在條件檔範圍內，超出就丟 `TypeError`。**條件檔是上限**：老師的覆寫可以在條件檔列的檔位與形狀之內任意選（包括打開預設關的檔位，例如 `add-two-carries` 或 `[2,1]`，這是 #18 的決定），也可以改題數、呈現、鷹架；不能開條件檔沒有的檔位或形狀。`adjustments` 只是五種調整的預設方案，不是另一道上限。

## 提示與回饋

每個檔位三句範本（輕推 → 縮範圍 → 近答案），可用產生器變數（見 `math/add-sub/README.md`）。同一檔位有不同解法子情形時寫成 `{ default, variants }`：`add-one-carry` 的進位可能發生在個位（`ones-carry`）或十位（`tens-carry`，例 80＋25），第二個數是一位數時用 `one-digit`；產生器依實例算出變體 key，依序找第一個有的，都沒有就用 `default`。題目檔沒寫 `hints`／`feedback` 就用範本；寫了就覆寫。逐位狀態提示（看學生做到哪一位再給）是 renderer「完整鷹架」的加值功能，不取代三層。

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

Cyclone 2026-10-11 逐題確認，紀錄在 cyclone-tw/udl-content-spec#18。參考既有實作：`udl-math` 的 `brick-kingdom`（原 repo 名 `cyclone-math-lab`，本機資料夾舊名 `block-borrow-adventure`；關卡＝條件檔、老師可調題數與範圍、情境範本＋池、提示依狀態）。
