# math.add-2digit-carry — 二位數進位加法 v1

兩個二位數相加，**個位相加 ≥ 10**（要進位）。例：27 + 15、58 + 46。

## 參數（`params.schema.json`）

| 參數 | 預設 | 說明 |
| --- | --- | --- |
| `min`／`max` | 10／99 | 兩個加數的範圍（含），必須是二位數 |
| `max_sum` | 不限 | 和的上限（含）；要避免超過 100 可設 99 |
| `distinct` | true | 同一批不重複的加數組合（27+15 與 15+27 視為同一組） |
| `layout` | horizontal | 給 renderer：橫式或直式 |
| `require_carry` | — | 可省略；寫出來只能是 `true` |

## 產出

`type: "numeric"` 實例；題幹 `"27 + 15 = ？"`，`answer` 為和，容差 0，`input { 0–999, 整數 }`；`variables` 含 `a`、`b`、`sum`、`a_ones`、`a_tens`、`b_ones`、`b_tens`、`carry: 1`。

## 抽不到的情況

`min = max = 10` 之類讓個位永遠不夠進位，或 `distinct` 加上太小的範圍讓組合不夠 `count` 個，會丟 `RangeError` 並說明條件。
