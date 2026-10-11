# math.add-2digit-no-carry — 二位數不進位加法 v1

兩個二位數相加，**個位相加 < 10**（不用進位）。例：23 + 45、61 + 17。

## 參數（`params.schema.json`）

與 `math.add-2digit-carry` 相同：`min`／`max`（10–99）、`max_sum`、`distinct`、`layout`；`require_carry` 可省略，寫出來只能是 `false`。

## 產出

`type: "numeric"` 實例；`variables.carry` 永遠是 `0`。其餘欄位同進位版。

## 抽不到的情況

`min = max = 19` 之類讓個位相加一定 ≥ 10，會丟 `RangeError` 並說明條件。
