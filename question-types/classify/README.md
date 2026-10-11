# classify — 拖拉分類 v1

`bins[]` 有 2–6 個桶，每個必填 `id`、`label: spoken_text`。`objects[]` 有 2–12 個物件，每個必填 `id`、`text: spoken_text`、`bin`（正確桶 id），可帶 `image` 相對路徑。桶 id 與物件 id 各自不重複，物件的 bin 必須存在。允許沒有物件的干擾桶。

固定題禁止 `options`、`pairs`、`answer`、`blanks`、`sequence`、`tolerance`、`input`、`unit_label`、`shuffle`、`distractor_pool`。generated 模板不能帶 `bins`／`objects`。

## 作答與計分

作答為 `{ "bins": { "fruit": ["apple"], "vegetable": [] } }`。可省略桶或物件；未分類物件算錯。每個物件獨立判定，放對的數 k／n 為分數；全對 `correct`、全錯 `incorrect`、其餘 `partial`。桶內順序不影響分數。

缺少或非物件的 `bins`、桶內容非陣列為 `invalid`（`missing-field`）；未知桶為 `unknown-bin`；未知或非字串物件 id 為 `unknown-object`；同一物件重複出現（同桶或跨桶）為 `duplicate-object`。invalid 不計作答次數。題目缺計分欄位、數量不符、id 不合法／重複或 object.bin 不存在，先丟 `TypeError`，即使作答也不合法。文字與圖片格式由內容 schema 驗證。

`detail` 為 `{ objects: [{ id, expected_bin, chosen_bin, correct }], correct_count, total }`，依題目物件順序列出；未分類的 `chosen_bin` 為 null。計分純函式不修改輸入。

## renderer 注意

- 物件以 `ctx.seed` 可重現地洗牌；桶照題目書寫順序。
- 物件可拖回「未分類區」；提供鍵盤可用的選桶操作，不只依賴拖拉或顏色。
- 桶標籤與物件文字由 `ctx.speech` 提供朗讀；每個桶、物件及控制項 ≥ 48px，尊重 `prefers-reduced-motion`，只用原生 Web 技術。
- `showResult()` 依 `detail.objects` 顯示回饋；獎勵與重答由宿主決定。
