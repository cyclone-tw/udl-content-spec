# numeric — 計算題（直接輸入數字）v1

學生不看選項，直接在答案框或數字鍵盤輸入數字。固定題與產生器產出的實例都用這個題型；二位數進位加法等亂數題由 `generators/` 產出實例後，一樣走這裡計分。

## 題目欄位

- `answer`：數字。
- `tolerance`（可選）：`{ type: "nominal" | "relative" | "geometric", value ≥ 0 }`；省略等於 `nominal 0`（精確）。
- `input`（可選）：`{ min, max, decimals }`，給 renderer 決定鍵盤範圍與小數位數；**不參與計分**。
- `unit_label`（可選）：答案旁顯示的單位（例如「顆」）。

## 作答格式

```json
{ "value": 42 }
```

`value` 必須是 JavaScript number；renderer 負責把輸入字串轉成數字。

## 計分

| tolerance | 判對條件 |
| --- | --- |
| nominal | \|value − answer\| ≤ v |
| relative | \|value − answer\| ≤ v × \|answer\|；answer 為 0 時退化為精確比對 |
| geometric | answer ÷ (1 + v) ≤ value ≤ answer × (1 + v)（answer 為負時區間翻轉）；answer 為 0 時退化為精確比對 |

所有比較都加一個相對於數量級的極小緩衝（1e-9 × max(1, |answer|, |value|)，上限 1e-6），避免 0.1 + 0.2 這類浮點誤差把對的答案判錯。

| 情況 | outcome | score |
| --- | --- | --- |
| 在容差內 | correct | 1 |
| 在容差外 | incorrect | 0 |
| 缺 `value`、字串、NaN、Infinity | invalid（`missing-field`／`not-number`） | 0 |

`detail`：`{ value, answer, tolerance, difference }`。極端有限值相減若溢位，省略 `difference`，保持 JSON 可序列化。

## renderer 注意

- 依 `input.decimals` 決定要不要給小數點鍵；依 `min`／`max` 擋明顯打錯的值（例如負數）。
- `unit_label` 顯示在輸入框右側，不要求學生自己打單位。
- 空白輸入時 `getResponse()` 回傳 `null`，殼不啟用送出鈕。
