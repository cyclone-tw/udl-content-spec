# generators — 數學參數化產生器

內容包裡的亂數題（`kind: "generated"`）不寫死題目，只帶四樣東西：`generator`（產生器 id）、`generator_version`、`params`（參數範圍）、`count`（一次出幾題）。產生器登錄在這裡；殼或執行器拿到一個**種子**，就把題目展開成 `count` 個**題目實例**，實例形狀與固定題相同，直接丟給 `question-types/` 的 `score()` 判定。同一個 item、同一個種子，永遠展開成同樣的題目，所以事件只要記種子就能重現學生當時看到的題。

## 登錄表

| id | 中文 | 版本 | 條件 | 參數 | 產出題型 | 狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| `math.add-2digit-carry` | 二位數進位加法 | 1 | 個位相加 ≥ 10 | `min`、`max`（10–99）、`max_sum`、`distinct`、`layout` | `numeric` | v1 |
| `math.add-2digit-no-carry` | 二位數不進位加法 | 1 | 個位相加 < 10 | 同上 | `numeric` | v1 |

每個產生器資料夾固定三樣東西：`README.md`、`params.schema.json`（參數格式，`$id` 為 `urn:udl-content-spec:v1:generators/<path>/params`）、`generate.mjs`（`export const id`、`version`、`paramsSchemaPath`、`generate({ params, seed, count })`）。

## 使用

```js
import { instantiate } from "udl-content-spec/generators/index.mjs";
import { score } from "udl-content-spec/question-types/index.mjs";

const instances = instantiate(item, { seed: "attempt-01HZX…" });  // item 是 kind: generated 的題目
const result = score(instances[0], { value: 42 });
```

`index.mjs` 匯出 `generators`（登錄表）、`getGenerator(id)`、`instantiate(item, { seed })`、`substitute(text, variables)`、`INSTANCE_SCHEMA_PATH`。

## 契約

- **純函式**：`generate()` 與 `instantiate()` 只看輸入，不讀時間、不連網、不用 `Math.random`。亂數來自 `_prng.mjs`：種子字串經 FNV-1a 壓成 32 位元起點，再用 mulberry32 往下走（這裡自己實作的標準小型演算法，不引入任何前例專案的程式）。
- **種子**：字串或數字；`instantiate` 一律轉成字串記在實例的 `seed`。產生器內部用 `"<generator id>|<seed>"` 當亂數起點，所以不同產生器拿同一個種子也不會出同一串數。
- **條件不符就重抽**：抽到不合條件（例如要進位卻沒進位、和超過 `max_sum`、重複的組合）就丟掉重抽；每題最多 1000 次，抽不到就丟 `RangeError` 並說明是哪個條件抽不到。這代表「參數讓條件不可能」會在內容測試時就被發現，不會到學生面前才出不了題。
- **參數錯是內容錯**：越界、型別錯、未知參數都丟 `TypeError`；驗證器之後會用 `params.schema.json` 在發佈前擋下（併 conformance PR）。
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
- `hints`、`feedback` 從 item 複製，文字裡的 `{a}`、`{b}`、`{sum}`、`{a_ones}`… 會換成變數值，所以第三層提示可以寫「個位：{a_ones} 加 {b_ones}」。沒有對應變數的佔位符原樣保留。
- `stem.text.audio` 永遠是 `null`：亂數題的題幹無法預錄，由殼的 TTS 讀。
- `display.layout` 給 renderer 決定橫式或直式，不影響答案。

## 路線圖

後續產生器清單在內容規格階段定；候選：二位數減法（借位／不借位）、三位數加減、乘法（九九、二位乘一位）、除法（整除／有餘數）、分數比較、長度與時間單位換算。每一個都走同樣的三樣東西＋測試（種子重現、條件全滿足、不可能條件有可讀錯誤）。

## 前例對照

Numbas 的變數＋條件（不符重抽）與 Moodle calculated 的數值容差只借設計邏輯；程式全部自己寫。
