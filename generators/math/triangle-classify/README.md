# math.triangle-classify v1 — 三角形分類（圖形選擇題）

看邊或看角，選出是哪一種三角形。條件檔 `s-II-3#b@4`（S-4-7）。udl-math#8、udl-content-spec#70。

## 參數

`tiers`、`weights`（題數依權重按比例分配）、`overlay`（看角的虛擬直角板什麼時候出現：button／hint／always）、`rotate`（15 度一格隨機旋轉）、`distinct`。通常用 `resolveParams` 取得（規則在 `profiles/triangle-classify.mjs`）。

## 檔位（條件檔 `tiers` 的 `kind`／`show`）

| 檔位 | 圖 | 選項 |
| --- | --- | --- |
| `kind: sides, show: marks` | 邊上畫等長記號（同數目短線＝一樣長；3 邊都不一樣長時畫 1、2、3 條） | 正三角形／等腰三角形／3 個邊都不一樣長 |
| `kind: sides, show: lengths` | 邊外標整數公分（`cm` 範圍），**1 公分畫 10 mm**，列印可以拿尺量 | 同上 |
| `kind: angles` | 三個角都畫角弧，**不畫直角記號**；直角板放在最大的角（`tools["set-square"]`） | 銳角三角形／直角三角形／鈍角三角形 |

- 檔位內三種答案輪流（從隨機一個開始），整批洗牌。
- 等腰只出「恰好 2 邊等長」，頂角避開 50–70 度（看起來像正三角形）；3 邊都不一樣長時相鄰邊長至少差 15%。
- 看角：直角三角形另兩角 25–65 度；鈍角在 `obtuse` 範圍；銳角三角形最大角不超過 `acute_max`；最大角的位置隨機。
- 錯誤類型：`triangle-equal-sides-miscount`、`triangle-orientation`（等腰轉了方向說 3 邊都不一樣長）、`triangle-side-lengths-misread`、`angle-right-by-eye`、`triangle-largest-angle-misjudged`。

## 變數

`tier kind answer_key rotation reason sides_mm angles sides_cm`（`sides_*` 依 AB、BC、CA）。
