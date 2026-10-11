# blanks — 多格填空 v1

一題有 1–12 格，每格可為數字或文字。單格填字也是本題型。題幹 `stem.text.text` 使用 `[[slot-id]]`；格 id 不得重複，每格必須恰有一個佔位符，且不能有未知佔位符。驗證器檢查這個對應關係。

## 題目欄位

`blanks[]` 每格必填 `id`、`kind`、`answer`：

- `numeric`：有限數字答案，可帶 `tolerance`、`input`、`unit_label`，定義與 [numeric](../numeric/README.md) 相同。
- `text`：非空字串答案，可帶 `accept[]` 同義答案、`case_sensitive`（預設 false）、`max_length`（正整數）。不自動做簡繁轉換；異體字要明列在 `accept[]`。

`input`、`max_length` 是 renderer 提示，不參與計分。固定題禁止頂層 `answer`、`options`、`pairs`、`tolerance`、`input`、`unit_label`、`shuffle`、`distractor_pool`。generated 模板不能帶 `blanks` 實例。

## 作答與計分

```json
{ "blanks": { "s1": 42, "s2": "絡繹不絕" } }
```

數字格直接重用 `withinTolerance()`。文字格對作答與所有候選答案依序做 NFKC、trim、內部連續空白縮成一個；不區分大小寫時再轉小寫。任一候選相符即對。

每格獨立判定，全對 `correct`、全錯 `incorrect`，其餘 `partial`；分數為對的格數／總格數。未提供的格算錯，`chosen` 為 null；空字串是文字作答，依同樣規則比對。

缺少作答物件或 `blanks` 物件回 `invalid`（`missing-field`）；未知 id 為 `unknown-blank`；數字格非有限數字為 `not-number`；文字格非字串為 `not-string`。invalid 不計入作答次數，由殼提示重新輸入。題目必要欄位不合法則先丟 `TypeError`，即使作答也不合法。

`detail`：`{ blanks: [{ id, kind, chosen, correct }], correct_count, total }`。格順序固定依題目，不依作答物件順序。計分純函式不修改輸入。

## renderer 注意

- 依佔位符位置放置輸入框，以題幹的 `spoken_text` 語音槽朗讀；不要把答案當標籤。
- 空白數字輸入省略該 id，不能將空白轉成 0；有填的數字轉成 number。
- 單位顯示在數字框旁；文字格依 `max_length` 提示長度。
- 每個輸入框提供可辨識標籤，觸控目標至少 48px；尊重 `prefers-reduced-motion`，使用原生 Web 技術。
- `showResult()` 可依 `detail.blanks` 標示逐格回饋；是否重答或給獎勵由宿主決定。
