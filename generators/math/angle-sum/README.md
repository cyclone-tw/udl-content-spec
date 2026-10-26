# math.angle-sum v1 — 平角、周角與角的合成分解（數值題）

圖上標已知角的度數、要求的角標「？」，用數字鍵填。條件檔 `s-II-4#b@4`（S-4-2，結果不超過 360 度）。udl-math#8、udl-content-spec#72。

## 參數

`tiers`、`weights`、`rotate`（整張圖 15 度一格隨機旋轉）、`distinct`。

## 檔位（條件檔 `tiers` 的 `kind`）

| kind | 題 | 答案 |
| --- | --- | --- |
| `straight-minus` | 一直線上的兩個角 | 180 − x |
| `full-minus` | 轉一整圈的兩個角 | 360 − x |
| `add` | 兩個小角合成一個大角（和不超過 `total_max`） | x + y |
| `sub` | 大角裡分成兩個角（分出的角至少 `part_min`） | z − x |

- 包住別的角的大角畫外圈、其他畫內圈；標示放在自己的角裡：離頂點由近到遠、同一個距離先放角的正中間再往兩側，找第一個和所有邊、角弧、別的標示都隔開 1.5 mm 的位置（字級 4 mm 估方框，#77）。標示的 `say` 唸「75 度」「問號」。

## 變數

`tier kind x y z answer rotation`。
