# ordering — 排序 v1

`sequence[]` 有 2–8 張卡片，依正確順序書寫。每張必填 `id`、`text: spoken_text`，可帶 `image` 相對路徑。id 不重複，不另寫 `answer`。

固定題禁止 `options`、`pairs`、`answer`、`blanks`、`bins`、`objects`、`tolerance`、`input`、`unit_label`、`shuffle`、`distractor_pool`。generated 模板不能帶 `sequence`。

## 作答與計分

作答為 `{ "order": ["a", "b", "c"] }`，必須是全部卡片 id 的排列。位置正確數 k／n 為分數；全對 `correct`、全錯 `incorrect`、其餘 `partial`。v1 不使用最長共同子序列。

缺少或非陣列的 `order` 為 `invalid`（`missing-field`）；未知或非字串 id 為 `unknown-id`；重複為 `duplicate-id`；缺卡為 `incomplete-order`。依此順序檢查，invalid 不計作答次數。題目缺少計分欄位、數量不符或 id 不合法／重複，先丟 `TypeError`，即使作答也不合法。文字與圖片格式由內容 schema 驗證。

`detail` 為 `{ positions: [{ id, expected_index, chosen_index, correct }], correct_count, total }`。依題目順序列出，index 從 0 起算。計分純函式不修改輸入。

## renderer 注意

- 必須用 `ctx.seed` 可重現地洗牌；若恰好洗成正確順序，繼續使用同一亂數流重洗，不能每次重設 seed。
- 拖拉之外提供「上移／下移」按鈕，鍵盤與觸控都能操作；卡片提供可辨識標籤與順序資訊。
- 每段文字保留語音槽，由 `ctx.speech` 提供朗讀；觸控目標 ≥ 48px，尊重 `prefers-reduced-motion`，只用原生 Web 技術。
- `showResult()` 依 `detail.positions` 顯示回饋；獎勵與重答由宿主決定。
