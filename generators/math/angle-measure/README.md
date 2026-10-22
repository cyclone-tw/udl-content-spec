# math.angle-measure v1 — 用量角器量角（數值題）

圖上疊虛擬量角器，用數字鍵填度數，容許誤差在條件檔 `tolerance`（`n-II-9#b@4` 是 ±2 度）。條件檔 `n-II-9#b@4`（N-4-10／S-4-1）。udl-math#8、udl-content-spec#71。

## 參數

`tiers`、`weights`、`overlay`（量角器什麼時候出現，量角通常 always）、`distinct`。

## 檔位（條件檔 `tiers` 的 `zero`）

| zero | 圖 |
| --- | --- |
| `right` | 底邊朝右（微傾 ±15 度），角往逆時針開；量角器底線沿底邊 |
| `left` | 底邊朝左，角往順時針開（課程手冊 N-4-10：量角器要從左右兩側量） |
| `off` | 兩邊都不在 0 刻度：量角器底線沿一個沒畫出來的點 `z`，起點邊離 0 度 `offset` 度；讀兩邊的刻度再相減 |

- 角度取 `step` 的倍數，在 `min`–`max` 之間。量角器 `tools.protractor` 帶 `toward: "b"`，半圓開在角那一側；外圈從底線那頭的 0 往角那側數，內圈反過來。
- 讀錯內外圈（180 減答案）記在 `variables.wrong_scale`，報表可以分類。

## 變數

`tier angle start end zero side tilt wrong_scale`。
