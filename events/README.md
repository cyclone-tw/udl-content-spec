# events：作答事件契約 `udl-attempt-events/v1`

學生作答之後要寫出什麼，只有這一種格式。獨立執行器下載的檔、平台（Workers＋D1）每日匯出到 Drive `UDL-Attempts/` 的檔、朗讀器轉接出來的檔，都是同一個形狀；kit 用一種讀法就能算「指標 X：n 題對 k、用到第幾層提示、調整了什麼」。送去哪裡（下載、D1、Drive）由殼決定，格式不變（README 原則 3）。

正本決策：udl-learning 總規劃 v1.1 §6.4（獨立輸出數據）、§6.7（亂答）、§7.2（kit 要的欄位）；kit 側需求在 sped-student-kit#19。

## 檔案形狀

```
{
  format_version: 1, format: "udl-attempt-events", generated_at,
  producer: { shell, shell_version, granularity: "item" | "unit" },
  actor:    { role: "student" | "teacher" | "guest", student_code? },   // 只有 student 帶代號；沒有別的欄位
  context:  { session_id, mode: "learn" | "practice" | "test", assignment_id?, pack: {id, version}, unit_id?, prescription? },
  events:   [ { seq, type, time, ...依種類 } ]
}
```

| 事件種類 | 必帶 | 用途 |
| --- | --- | --- |
| `session-started` | — | 一次活動開始 |
| `material-viewed` | `material_id`、`page?` | 看了教材哪一頁（學習模式的紀錄） |
| `audio-played` | `target` | 播了哪段語音（報讀使用證據）；聽音題的「再聽一次」每播一次記一筆，`target: "listen"`（#36） |
| `hint-used` | `item_id`、`hint_tier` 1–3 | 開了第幾層提示 |
| `answered` | 見下 | 一次作答與判定 |
| `session-completed` | `summary?` | 結束與彙總 |

`answered` 必帶：`item_id`、`ladder_ids`（至少一條）、`question_type`／`type_version`、`outcome`／`score`（照 `question-types/result.schema.json`）、`attempt_no`、`response_ms`、`hint_tier`（0–3，送出前用到的最高層）、`read_aloud`（true／false；殼不知道就 `null`，不要猜）、`guess_flag`（`none`／`possible-guessing`／`flagged`）。可帶：`curriculum_codes`、`response`（原始作答）、`detail`（score 的 detail；選擇題答錯且選項有標錯誤類型時含 `misconception`，#43）、`generated`（產生題追溯：`generator`、`generator_version`、`seed`、`index`、`tier`、`hint_variant`、`variables`，有這些就能重現同一題）。

`context.prescription` 記這次實際套用的調整：`font_scale`、`zhuyin`、`read_aloud`（off／on／student-choice）、`option_count`、`untimed`、`motion`、`scaffold`（none／partial／full）、`adjustment`（simplify／reduce／decompose／substitute／not_applicable，與條件檔同名）。缺的欄位表示用殼預設。

完整定義：[`schema/attempt-events.schema.json`](schema/attempt-events.schema.json)。範例：[`examples/runner-session.json`](examples/runner-session.json)（獨立執行器，粒度 item，含產生題與部分正確）。

## 紅線（schema 與驗證器都擋）

- `actor` 只能有 `role` 與 `student_code`，`additionalProperties: false`；教師試玩與訪客不得帶代號（總規劃 §5.3：他們的紀錄不匯出）。
- 驗證器掃全檔字串：像身分證字號、手機、連續 10 碼以上數字，或鍵名是 `name`／`student_name`／`姓名`／`email`／`phone`，一律報錯。
- 代號是 roster 的字串，udl 不解讀；不得是真學號。

## 怎麼用

```js
import { createEventsFile, pushEvent, answeredFields } from "udl-content-spec/events/index.mjs";
import { score } from "udl-content-spec/question-types/index.mjs";

const file = createEventsFile({ producer: { shell: "udl-runner", shell_version: "0.1.0", granularity: "item" },
                                actor: { role: "student", student_code: code },
                                context: { session_id, mode: "test", pack: { id, version }, prescription } });
pushEvent(file, "session-started");
const result = score(question, response);                      // 殼不自己判答案
pushEvent(file, "answered", answeredFields(question, result, { attempt_no: 1, response_ms, hint_tier, read_aloud, response }));
pushEvent(file, "session-completed", { summary: { answered, correct } });
```

`answeredFields` 會從題目（固定題或 `instantiate()` 的實例）抄 `item_id`、`ladder_ids`、`curriculum_codes`、題型版本，產生題再抄 `generated`；殼只補它才知道的事（第幾次、幾毫秒、提示層、報讀）。

驗證：

```sh
pnpm run validate:events events/examples/runner-session.json
pnpm run validate:events <file>... -- --ladder-dir ../sped-student-kit/data/ladder   # 另核對 ladder_ids 存在
pnpm run validate:events <file> -- --strict                                           # 警告也算失敗
```

`validate-events.mjs` 檢查：schema；`seq` 從 1 嚴格遞增；`outcome` 與 `score` 一致（correct＝1、incorrect／invalid／pending-review＝0、partial 在 0 與 1 之間）；同一題 `attempt_no` 依出現順序（不符只警告）；student 以外角色警告「不匯出」；粒度 `unit` 警告「不能逐題歸因」；測驗模式 `read_aloud` 為 null 警告；隱私掃描。可 `import { validateEvents, validateEventsFile }`。

## 轉接器：朗讀器 `udl-lesson-attempt/v1`

udl-learning `prototypes/lesson-reader`（FROZEN）下載的作答 JSON 形狀是 `udl-lesson-attempt/v1`：課次 id、活動（`quiz` 討伐／`literacy` 修練）、每題 `ok`／`ms`／`chosen`、總對錯、`guessFlag`。它的題目是組裝時從生字語詞現場生的，沒有穩定題號，也不帶 ladder id。

[`adapters/udl-lesson-attempt-v1.mjs`](adapters/udl-lesson-attempt-v1.mjs) 把它轉成本契約，粒度 `unit`：

- `item_id` 合成為「課次-活動-序號」；`ladder_ids`／`curriculum_codes`／`unit_id`／`pack` 由**對照表**補上。
- 對照表格式見 [`examples/lesson-attempt-mapping.json`](examples/lesson-attempt-mapping.json)：`lessons[課次 id] = { pack, unit_id, ladder_ids, curriculum_codes? }`。正本之後由 sped-student-kit#39「教科書對碼」產生；這裡只定格式。
- `quiz` → `mode: test`，`literacy` → `mode: practice`，可用 `mode` 覆寫。
- `read_aloud` 一律 `null`（朗讀器沒記），`hint_tier` 0，`attempt_no` 1；`guessFlag` 直接對到 `guess_flag`。

```js
import { convertLessonAttempt } from "udl-content-spec/events/adapters/udl-lesson-attempt-v1.mjs";
const file = convertLessonAttempt(attemptJson, { mapping, actor: { role: "student", student_code }, shell_version: "v1" });
```

範例：[`examples/lesson-attempt-source.json`](examples/lesson-attempt-source.json) → [`examples/lesson-attempt-converted.json`](examples/lesson-attempt-converted.json)。限制：只到單元層級，kit 只能算「這課小測驗 n 題對 k」，不能逐題歸到不同指標；要逐題歸因得等朗讀器改讀內容包（udl-learning#82 階段 4）。

## 支持代碼與評量方式對照（草案，**待 Cyclone 確認**，不進 schema）

kit 的 IEP 評量要記支持代碼（I 獨立、V 口語提示、G 手勢提示、A 協助、P 圖片提示、AT 輔具、T 示範）與評量方式（A 書面、B 口語、C 操作、D 觀察、E 其他；代碼名稱依縣府表件，以 kit 為準）。事件只記事實，對照由 kit 讀檔時套用；下面是建議起點，每格都要 Cyclone 定：

| 事件裡的事實 | 建議對到 | 疑問 |
| --- | --- | --- |
| `hint_tier` 0 且 `read_aloud` false | I | — |
| `hint_tier` 1（輕推，文字） | V | 文字提示算口語提示還是另一類？ |
| `hint_tier` 2（縮範圍） | P 或 V | 縮範圍常是「去掉選項」，像 P |
| `hint_tier` 3（近答案） | A | — |
| `read_aloud` true | V 或 AT | 報讀是口語提示還是輔具？ |
| `prescription.scaffold` partial／full（直式位值格、進位小 1） | P | — |
| `prescription.adjustment` simplify／reduce | 不是支持代碼，是調整紀錄 | kit 的「調整方式」欄位怎麼接？ |
| 題型 choice／true-false／match／classify／ordering／blanks／numeric（點選或鍵盤） | A（書面）？ | 平板點選算書面嗎？ |
| v3 speaking | B | — |
| v3 drawing | C 或 A | — |

對照表定了之後，放 kit 側（讀檔程式），本 repo 只在這裡留連結。

## 版本

破壞相容（改必填欄位、改 enum 意義）升 `udl-attempt-events/v2` 並附轉換程式；加可選欄位不升版。D1 事件表的欄位（總規劃 §7.3）照本契約的 `answered` 正規化，P3 開票時引用這裡。
