# math.congruent-triangles v1 — 全等與對應（圖形選擇題）

S-4-6，兩份條件檔：`s-II-2#a@4`（判斷全等）、`s-II-2#b@4`（對應邊、對應角）。udl-math#8、udl-content-spec#74。選項都是文字（①–④、ㄉㄊ、∠ㄉ），所有三角形畫在同一張圖，外殼不必畫選項圖。

## 參數

`tiers`、`weights`、`rotate`（關掉時找全等的那一個固定轉 90 度、對應的乙固定轉 180 度）。

## 檔位（條件檔 `tiers` 的 `kind`）

- `find`：甲在左邊中間，①–④ 在右邊排兩列；只有一個和甲全等（`flip: true` 時是翻過來再轉）。干擾項是放大或縮小（錯誤類型 `congruent-size-ignored`）、改一個邊、改一個角（`congruent-shape-by-eye`），彼此和甲的邊長差都超過 12%。
- `correspond`：甲（頂點ㄅㄆㄇ）和乙（ㄉㄊㄋ）全等，乙轉過（一半機會翻面），頂點名字照乙自己的順序標；`ask: side` 問對應邊、`ask: angle` 問對應角。錯誤選項標 `correspondence-by-position`。
- 三角形都是三邊明顯不等長，對應只有一種。
- S-4-6 備註：平移、旋轉、翻轉不做名詞教學；題目與提示只說「轉一轉、翻過來」（測試檢查）。

## 變數

找全等：`tier answer_label flip distractors`；對應：`tier asked asked_say answer_text flip rotation`。
