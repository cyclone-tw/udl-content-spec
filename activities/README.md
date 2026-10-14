# activities

「積木＋清單」的活動層（#31）：單元用 `bindings` 綁卡，這裡依綁定的卡與教材排出一課的步驟，並為練習與測驗生題。決策來源：udl-learning#137（學生端版面規劃 §6.4、§6.6、§6.9）。

## 三件事

| 函式 | 做什麼 |
| --- | --- |
| `resolveBindings(unit, lookup)` | 把 `bindings` 的卡片引用換成卡片物件；同包 id 或跨包 `pack@version#id` 都交給 `lookup` |
| `planSteps({ unit, cards, materials, profile? })` | 年級活動設定（或單元自己的 `activities`）× 綁定的卡 × 有的教材 → 步驟清單（進度條的關卡）；條件不足的步驟放進 `skipped` 並寫理由 |
| `generate(activity, { unit, cards, seed, count?, pools? })` | 生題；同一單元＋同一組卡＋同一個種子，結果永遠相同 |

`toItemShape()`、`toInstanceShape()` 把實例轉回固定題／產生器實例形狀給 schema 驗證；`correctResponse()` 產生正解作答（驗證器確認正解拿滿分）。

## 活動登錄表

| 活動 | 段落 | 生題 | 需要 | 產出題型 |
| --- | --- | --- | --- | --- |
| `read` | 讀委託 | 否 | lesson 或 simplified 教材 | — |
| `mindmap` | 讀委託 | 否 | mindmap 教材 | — |
| `demo` | 讀委託 | 否 | demo 教材 | — |
| `char-cards` | 修練 | 否 | 生字卡 | —（renderer 逐張翻卡） |
| `word-cards` | 修練 | 否 | 語詞卡 | — |
| `manipulate` | 修練 | 否 | 有 `manipulative` 的技能卡 | — |
| `char-pick` | 修練 | 是 | 生字卡 ≥ 2 張，或卡上有易混淆字 | choice：看注音與例詞選字，干擾項優先用卡上的易混淆字 |
| `word-match` | 修練 | 是 | 語詞卡 ≥ 2 | match：語詞 ↔ 意思（最多 4 組） |
| `word-cloze` | 修練 | 是 | 有例句的語詞卡，語詞卡 ≥ 2 | choice：例句挖空選語詞 |
| `sentence-order` | 修練 | 是 | 句型卡 | ordering：例句詞塊排序 |
| `skill-practice` | 修練 | 是 | 技能卡 | 數學產生器實例（numeric／blanks），參數照能力指標條件檔 |
| `quiz` | 討伐 | 是 | 以上任一種可出題的卡 | 在選字、語詞填空、句型排序、技能練習之間輪流抽；語詞配對只在沒有其他來源時才用（一題就是一整組，放進測驗太重） |

練習與測驗用同一批卡、同一套生題；差別只在平台的流程設定（提示、揭答、重試），題目不變。只有離不開課文的題（閱讀理解）才在單元 `items` 逐課手寫。

## 年級活動設定（`profiles/`）

| id | 年級 | 步驟 |
| --- | --- | --- |
| `zh-low` | 國語一、二 | 聽故事 → 認字 → 配對 → 小測驗 |
| `zh-mid` | 國語三、四 | 讀課文 → 生字 → 語詞配對 → 句型排序 → 小測驗 |
| `zh-high` | 國語五、六 | 讀課文 → 心智圖 → 生字 → 語詞 → 句型 → 小測驗 |
| `math-elementary` | 數學一到六 | 看示範 → 操作練習 → 計算練習 → 小測驗 |

形狀見 `schema/activity-profile.schema.json`。單元可用 `activity_profile` 指定別份，或用 `activities` 整份取代；老師之後在指派時隱藏或調整（平台流程設定，不在規格）。

## 能力階梯、報讀範圍、核心卡、任務對話（#33）

- **能力階梯掛在「活動 × 年級」**：年級設定的 `ladders` 寫「活動 → 年級 → ladder_ids」（`"*"` 是其他年級），單元的 `ladders` 可覆寫。卡片生的題優先序：活動 × 年級 → 卡片自己標的 → 單元的；驗證器要求每題至少有一條。同一張卡拿去做選字與做填空練的是不同能力，所以不要把階梯只標在卡片上。內建對照目前是草稿（`ladder_status: "draft"`），驗證器會提醒待 Cyclone 審。
- **報讀範圍** `read_aloud_scope`：`all`／`stem`／`none`。識字類（選字、配對、填空）預設 `stem`：只唸題幹、不唸選項，否則變成聽音選字；句型排序 `all`；技能練習 `stem`。年級設定的步驟可覆寫；題目實例帶這個欄位，外殼照做、事件照記 `read_aloud`。
- **核心卡** `unit.core`：bindings 之中這課最重要的卡，標在每課清單、不放卡片。`generate(..., { coreOnly: true })` 只用核心卡（減量、簡化時用）；驗證器另外用核心卡跑一次，湊不出某種題只警告。
- **任務對話** `unit.quest`：`intro`／`outro` 指向同單元的 `dialogue` 教材；RPG 殼接成任務開場與回報，獨立殼可忽略。

## 題目實例的追溯欄位

卡片生的題：`kind: "instance"`、`source: "cards"`、`activity`、`activity_version`、`seed`、`index`、`unit`、`cards`（用到的卡 id）、`quiz_source`（小測驗裡這題來自哪個活動）；其餘欄位與固定題相同，可直接丟給 `score()`。技能練習沿用數學產生器的實例，另加 `activity`、`activity_version`、`cards`。作答事件記 `activity`＋`seed` 就能重現整批題目。
