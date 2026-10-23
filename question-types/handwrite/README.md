# handwrite — 手寫字 v1

描一描、寫一寫共用的題型（#78）：學生用手指在格子裡寫字，外殼判筆，`score()` 只看外殼回報的每個字結果。筆順資料、判筆、畫範字都是 renderer（外殼）的事，不進規格。

## 題目欄位（來自 `schema/item.schema.json`）

- `target`：要寫的字，1 到 8 個漢字（字串）。多字題逐字計分。
- `mode`：
  - `trace` 描一描：看筆順 → 照淡色範字描 → 不看範字自己寫一次；計分看「自己寫」那一次。
  - `write` 寫一寫：看注音寫國字，不顯示範字。
- `context`（可選）：給外殼畫題目用。
  - `word`：語詞，例如「公園」。
  - `zhuyin`：`word` 的注音（音節以半形空白分隔）；沒有 `word` 時是 `target` 的注音。
  - `positions`：`word` 裡要學生寫的位置（從 0 起算），依序對應 `target` 的每個字；外殼把這幾格挖空，其餘照常顯示。同一個字在語詞裡出現幾次就挖空幾格，不然看得到答案。
- `max_mistakes`（可選，預設 3）：每個字最多寫錯幾筆還算對。
- `stem`、`hints`、`feedback`：同其他題型。`stem.text` 不寫出 `write` 模式的答案字（用「○」代替）。

驗證器檢查：`target` 都是漢字；有 `positions` 就要有 `word`，`positions` 和 `target` 一樣長、不超出語詞、對到的字就是 `target` 的字；`zhuyin` 的音節數和 `word` 字數相同。

## 作答格式

```json
{ "chars": [{ "char": "園", "completed": true, "mistakes": 1, "helped": false }] }
```

依 `target` 的順序一字一筆：

- `completed`：有沒有把整個字寫完。
- `mistakes`：寫錯的筆數（外殼判筆的結果）。
- `helped`：自己寫的時候有沒有偷看範字或看筆順（`trace` 前兩步的「看筆順」「描」不算）。

## 計分

每個字 `completed && !helped && mistakes <= max_mistakes` 才算對；全對 `correct`、全錯 `incorrect`，其餘 `partial`，分數＝對的字數／總字數。

| 情況 | outcome | `detail.reason` |
| --- | --- | --- |
| 缺 `chars` 或不是陣列 | invalid | `missing-field` |
| 字數和 `target` 不同 | invalid | `wrong-count` |
| 某一筆缺欄位或型別不對（`mistakes` 不是 ≥ 0 的整數） | invalid | `bad-char` |
| 某一筆的 `char` 不是 `target` 對應位置的字 | invalid | `char-mismatch` |

`detail`：`{ chars: [{ char, completed, mistakes, helped, correct }], correct_count, total, max_mistakes }`。題目欄位不合法（`target` 不是漢字、`mode` 不對、`max_mistakes` 不是 ≥ 0 的整數）丟 `TypeError`。

## renderer 注意

- 判筆與筆順動畫用外殼自己的筆順資料；**沒有這個字的筆順資料時不能自動判**，外殼略過這題並記錄，不要讓學生寫了卻判錯。
- 寫字格是觸控目標，邊長 ≥ 48px（實際會大很多）；尊重 `prefers-reduced-motion`：筆順動畫改成一筆一筆直接顯示。
- `trace`：三步（看筆順 → 描 → 自己寫）都要讓學生能回上一步；只有「自己寫」那一次送 `score()`。偷看範字或回去看筆順就把那個字的 `helped` 設成 true。
- `write`：顯示 `context.word`（`positions` 挖空）與 `context.zhuyin`；報讀可以唸語詞（不洩漏字形）。
- 手寫題不進外殼的草原遭遇與小測驗（活動 `char-trace`、`char-write` 標 `encounter: false`，見 `activities/README.md`）。
