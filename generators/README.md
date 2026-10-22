# generators — 數學參數化產生器

內容包裡的亂數題（`kind: "generated"`）不寫死題目，只帶四樣東西：`generator`（產生器 id）、`generator_version`、`params`（參數範圍）、`count`（一次出幾題）。產生器登錄在這裡；殼或執行器拿到一個**種子**，就把題目展開成 `count` 個**題目實例**，實例形狀與固定題相同，直接丟給 `question-types/` 的 `score()` 判定。同一個 item、同一個種子，永遠展開成同樣的題目，所以事件只要記種子就能重現學生當時看到的題。

## 登錄表

| id | 中文 | 版本 | 條件 | 參數 | 產出題型 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| `math.add-sub` | 加減法（依能力指標條件檔） | 1 | 由 `profiles/` 的檔位決定：進位次數、退位次數、被減數個位是否為 0、和的範圍 | `tiers`、`weights`、`operations`、`shapes`、`presentation`、`scaffold`、`context`、`distinct`、`context_pools`（用 `resolveParams` 產生） | `blanks`（直式）或 `numeric` | v1（#18） |
| `math.angle-vs-right` | 和直角比（圖形選擇題） | 1 | 由 `profiles/` 的檔位決定角度範圍；題數依權重按比例分配 | `tiers`、`weights`、`choices`、`overlay`、`rotate`、`vary_rays`、`distinct` | `choice`（`display.figure` 幾何圖形） | v1（#69） |
| `math.triangle-classify` | 三角形分類（看等長記號、看公分、看角） | 1 | 檔位的 `kind`／`show`；題數依權重按比例分配 | `tiers`、`weights`、`overlay`、`rotate`、`distinct` | `choice`（`display.figure`） | v1（#70） |
| `math.angle-measure` | 用量角器量角 | 1 | 檔位的 `zero`（0 度線在右、左、不在 0 刻度）與角度範圍 | `tiers`、`weights`、`overlay`、`distinct` | `numeric`（容差在條件檔，`display.figure` 附量角器） | v1（#71） |
| `math.angle-sum` | 平角、周角與角的合成分解 | 1 | 檔位的 `kind`（180 減、360 減、相加、相減）與角度範圍 | `tiers`、`weights`、`rotate`、`distinct` | `numeric`（`display.figure` 標已知角與「？」） | v1（#72） |
| `math.congruent-triangles` | 全等與對應 | 1 | 檔位的 `kind`（找全等、找對應邊或角） | `tiers`、`weights`、`rotate` | `choice`（甲與 ①–④ 或甲乙畫在同一張圖） | v1（#74） |
| `math.add-2digit-carry` | 二位數進位加法 | 1 | 個位相加 ≥ 10 | `min`、`max`（10–99）、`max_sum`、`distinct`、`layout` | `numeric` | legacy：已被 `math.add-sub` 涵蓋，保留到 v2；驗證器對它的題目只警告「沒有條件檔」（`ladder_ids` 仍必填） |
| `math.add-2digit-no-carry` | 二位數不進位加法 | 1 | 個位相加 < 10 | 同上 | `numeric` | 同上 |

## 能力指標條件檔（`profiles/`）

數學產生題「出什麼」不由作者手填：每道產生題的 `ladder_ids` 之中恰一條要有[條件檔](profiles/README.md)，條件檔列出這條 kit 能力階梯允許的檔位、數字形狀、預設、課程調整預設與提示範本；`params` 只能在裡面挑，驗證器用同一個 `checkParams` 把關。`instantiate` 會依 `ladder_ids` 找到條件檔傳給產生器。

每個產生器資料夾固定三樣東西：`README.md`、`params.schema.json`（參數格式，`$id` 為 `urn:udl-content-spec:v1:generators/<path>/params`）、`generate.mjs`（`export const id`、`version`、`paramsSchemaPath`、`generate({ params, seed, count, profile, pools })`；不需要條件檔或池的產生器忽略後兩個）。

## 使用

```js
import { instantiate } from "udl-content-spec/generators/index.mjs";
import { score } from "udl-content-spec/question-types/index.mjs";

const instances = instantiate(item, { seed: "attempt-01HZX…", pools });  // item 是 kind: generated 的題目；pools（id → 池）給情境範本，可省略
const result = score(instances[0], { value: 42 });
```

`index.mjs` 匯出 `generators`（登錄表）、`getGenerator(id)`、`instantiate(item, { seed, pools })`、`profileForItem(item)`、`substitute(text, variables)`、`INSTANCE_SCHEMA_PATH`，並轉出 `profiles/index.mjs` 的 `profiles`、`getProfile`、`profilesFor`、`resolveParams`、`checkParams`、`PROFILE_SCHEMA_PATH`、`PROFILE_FAMILY_SCHEMA_PATHS`。產生器模組可另外匯出 `itemType(params)`（出的題型），活動的技能練習照它建題目；沒有就照 `presentation` 判斷數值題或直式。

## 契約

- **純函式**：`generate()` 與 `instantiate()` 只看輸入，不讀時間、不連網、不用 `Math.random`。亂數來自 `_prng.mjs`：種子字串經 FNV-1a 壓成 32 位元起點，再用 mulberry32 往下走（這裡自己實作的標準小型演算法，不引入任何前例專案的程式）。
- **種子**：字串或數字；`instantiate` 一律轉成字串記在實例的 `seed`。產生器內部用 `"<generator id>|<seed>"` 當亂數起點，所以不同產生器拿同一個種子也不會出同一串數。
- **條件不符就重抽**：抽到不合條件（例如要進位卻沒進位、和超過 `max_sum`、重複的組合）就丟掉重抽；每題最多 1000 次，抽不到就丟 `RangeError` 並說明是哪個條件抽不到。這代表「參數讓條件不可能」會在內容測試時就被發現，不會到學生面前才出不了題。
- **參數錯是內容錯**：越界、型別錯、未知參數都丟 `TypeError`；驗證器在發佈前用 `params.schema.json`（形狀）與條件檔 `checkParams`（範圍）擋下。
- **版本**：每個產生器獨立 `version`；題目的 `generator_version` 必須相符，否則 `instantiate` 丟錯並說明目前版本。改變抽題分布、變數名稱或實例欄位就升版；舊版保留一個主版本的相容期。

## 題目實例（`instance.schema.json`）

```json
{
  "kind": "instance",
  "id": "i-gen-add-carry#0",
  "source_item": "i-gen-add-carry",
  "type": "numeric",
  "generator": "math.add-2digit-carry",
  "generator_version": 1,
  "seed": "attempt-01HZX",
  "index": 0,
  "variables": { "a": 27, "b": 15, "sum": 42, "a_ones": 7, "a_tens": 2, "b_ones": 5, "b_tens": 1, "carry": 1 },
  "stem": { "text": { "text": "27 + 15 = ？", "audio": null } },
  "answer": 42,
  "tolerance": { "type": "nominal", "value": 0 },
  "input": { "min": 0, "max": 999, "decimals": 0 },
  "display": { "layout": "horizontal" },
  "hints": [ { "text": "先算個位：7 加 5。", "audio": null }, "…" ],
  "feedback": { "correct": { "text": "答對了！", "audio": null }, "retry": { "text": "再檢查一次有沒有進位。", "audio": null } },
  "unit": "u02-add-2digit", "skill": "計算", "difficulty": 2, "ladder_ids": ["…"], "curriculum_codes": ["…"]
}
```

- `kind: "instance"` 讓 `score()` 接受（它只拒絕 `generated` 模板）。實例不是內容檔，不存進內容包；事件記 `source_item`＋`seed`＋`index` 即可重現。
- `hints`、`feedback`：題目檔有寫就從 item 複製並置換 `{a}`、`{b}`、`{sum}`、`{a_ones}`… 變數；沒寫就用條件檔該檔位的三句範本（`math.add-sub`）。沒有對應變數的佔位符原樣保留。
- `tier` 是這題抽到的檔位；`display.scaffold` 是鷹架檔（`none`／`partial`／`full`），事件都要記。直式實例是 `type: "blanks"`，`blanks` 每位一格，`display.places` 說明畫哪幾位、`carry_marks` 可畫進退位記號格（不計分）。
- `stem.text.audio` 永遠是 `null`：亂數題的題幹無法預錄，由殼的 TTS 讀。
- `display.layout` 給 renderer 決定橫式或直式，不影響答案。
- 幾何產生器共用 `math/_geometry.mjs`（建三角形、旋轉、權重分題、算畫布、標示位置）。
- 幾何題是 `type: "choice"` 或 `type: "numeric"`：`options`（可帶 `misconception`）、`answer`（選項 id）、`shuffle`；`display.figure` 是圖形描述（`schema/figure.schema.json`，mm、y 向下，標示畫成可報讀的文字層），`display.overlay` 說虛擬工具什麼時候疊上。

## 路線圖

下一步是照 `profiles/README.md` 的格式補其他能力指標的條件檔：`n-I-2#b@2`（三位數加減）、`n-I-2#c@2`（說出進位的 1 代表什麼）、`n-I-3#a@2`（加減應用題）、`n-I-3#b@2`（估算選項題），各開小票；三位數要先把 `math.add-sub` 的 `analyze()` 擴到百位進退位（目前只算個位、十位的進位與個位的退位），再開形狀 `[3,3]`／`[3,2]` 與檔位。再往後：乘法（九九、二位乘一位）、除法（整除／有餘數）、分數比較、長度與時間單位換算，各自新產生器。每一個都走同樣的三樣東西＋測試（種子重現、條件全滿足、不可能條件有可讀錯誤）。

## 前例對照

Numbas 的變數＋條件（不符重抽）與 Moodle calculated 的數值容差只借設計邏輯；程式全部自己寫。
