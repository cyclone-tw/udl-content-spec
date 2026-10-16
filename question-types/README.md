# question-types — 題型登錄表

一道題有兩半：**給眼睛看的**（怎麼畫）和**給機器算的**（怎麼判）。`schema/item.schema.json` 只規定題目卡長什麼樣；這裡補齊「怎麼畫」與「怎麼算」，而且每種題型一個資料夾。城鎮戰鬥、朗讀器、獨立執行器、平台伺服器四邊都從 `index.mjs` 拿同一個 `score()`，所以不會出現「城鎮說對、伺服器說錯」。

## 登錄表

| type | 中文 | 版本 | 作答格式 | 可能的 outcome | 狀態 |
| --- | --- | --- | --- | --- | --- |
| `choice` | 選擇題（單選） | 1 | `{ "option": "<id>" }` | correct／incorrect／invalid | v1 |
| `true-false` | 是非題 | 1 | `{ "value": true\|false }` | correct／incorrect／invalid | v1 |
| `match` | 配對題 | 1 | `{ "pairs": { "<左 id>": "<右 id>" } }` | correct／partial／incorrect／invalid | v1 |
| `numeric` | 計算題（直接輸入數字，不呈現選項） | 1 | `{ "value": <number> }` | correct／incorrect／invalid | v1 |
| `blanks` | 多格填空（含單格填字） | 1 | `{ "blanks": { "<slot id>": <number\|string> } }` | correct／partial／incorrect／invalid | v1 |
| `ordering` | 排序 | 1 | `{ "order": ["<id>", …] }` | correct／partial／incorrect／invalid | v1 |
| `classify` | 拖拉分類 | 1 | `{ "bins": { "<bin id>": ["<object id>", …] } }` | correct／partial／incorrect／invalid | v1 |
| `drawing` | 畫圖 | — | 草案見路線圖 | pending-review | v3 保留 |
| `speaking` | 口說 | — | 草案見路線圖 | pending-review | v3 保留 |

每個已實作題型的資料夾固定四樣東西：

| 檔案 | 內容 |
| --- | --- |
| `README.md` | 題型說明：欄位、作答格式、計分規則、renderer 注意事項 |
| `response.schema.json` | 作答格式（JSON Schema 2020-12，`$id` 為 `urn:udl-content-spec:v1:question-types/<type>/response`） |
| `score.mjs` | `export const type`、`export const version`、`export function score(question, response)` |
| `migrate/`（升版時才有） | 破壞相容時的轉換程式與測試 |

`index.mjs` 匯出 `types`（已實作）、`planned`（v2 候選）、`reserved`（v3 保留）、`getType(type)`、`score(question, response)`（依 `question.type` 分派）。

## `score()` 契約

```js
import { score } from "udl-content-spec/question-types/index.mjs";
const result = score(question, response);
// → { type, type_version, outcome, score, detail }
```

- **純函式**：只看 `question`（題目實例）與 `response`（作答），不連網、不讀時間、不看是誰、不碰 DOM。同樣輸入永遠得到同樣輸出；不改動輸入。
- **`question` 是題目實例**：`kind: "fixed"` 的 item 本身，或產生器（`generators/`）產出的同形實例。把 `kind: "generated"` 的模板直接丟進來會丟 `TypeError`，因為模板沒有答案。
- **題目壞掉丟錯、作答壞掉回傳 invalid**：題目實例缺欄位是內容或程式錯誤（驗證器應早已擋下），丟 `TypeError` 讓問題浮出來；作答格式不對（缺欄位、未知 id、不是數字）回傳 `outcome: "invalid"`，不算答錯、不計入次數，殼應提示重新作答。
- **回傳格式**見 `result.schema.json`：
  - `outcome`：`correct`、`incorrect`、`partial`（多部件題型才會出現）、`invalid`、`pending-review`（v3 保留，v1 不會回傳）。
  - `score`：0 到 1。`partial` 時是比例（例如配對對 2／3 組就是 0.667）。
  - `detail`：逐部件對錯與正解，給殼畫「哪一組連錯」與給報表；欄位由各題型 README 定義。
- **`partial` 之後怎麼辦不在這裡決定**：給不給金幣、算不算過關、要不要教師複批，是宿主的流程政策（總規劃 §3 Flow policy）；題型只負責報告事實。

## renderer 契約（v1 只定文件，實作在各殼）

殼（城鎮對話框、朗讀器、獨立執行器）負責：載入題目、送出鈕、提示三層、回饋、語音開關、計時、事件。題型 renderer 只負責**畫題目**與**收集作答**，介面如下：

```ts
type Renderer = (container: HTMLElement, question: Question, ctx: RenderContext) => RendererHandle;

interface RenderContext {
  mode: "practice" | "test";          // 殼的模式；renderer 不據此改題，只影響是否顯示即時標記
  seed: string;                        // 洗牌用，同一 seed 同一順序，事件可重現畫面
  speech: { enabled: boolean; speak(text: SpokenText): void };  // 每段 spoken_text 旁放一個「聽」鈕時用
  onChange?(response: unknown | null): void;  // 作答有變就通知殼（啟用送出鈕用）
  disabled?: boolean;                  // 初始是否唯讀（測驗結束回看）
}

interface RendererHandle {
  getResponse(): unknown | null;       // 目前作答，格式見該題型 response.schema.json；尚未作答回傳 null
  setDisabled(disabled: boolean): void;
  showResult?(result: ScoreResult): void;  // 可選：依 detail 標示逐部件對錯；殼在 practice 模式會呼叫
  destroy(): void;
}
```

規則：

1. renderer **不判答案**，也不讀 `question.answer`／`pairs` 的對應關係來改畫面；判定只在 `score()`；ordering 僅為避免初始畫面已是正解而檢查洗牌結果。
2. `shuffle: true` 時用 `ctx.seed` 做可重現洗牌（選項、配對右側）。事件記 seed，就能重建學生看到的順序。
3. 面向學生的文字一律是 `spoken_text`；`ctx.speech.enabled` 時每段文字旁提供「聽」的觸發。
4. 觸控目標 ≥ 48px；尊重 `prefers-reduced-motion`；只用原生 Web 技術（AGENTS 技術約定）。
5. 作答一律送 `response.schema.json` 定義的形狀；數字輸入由 renderer 轉成 `number`，不送字串。
6. **聽音題（`stem.listen`，#36）由殼負責**，renderer 照常畫選項：
   - 殼放一顆「再聽一次」按鈕（觸控目標 ≥ 48px），按了就播聽音檔；不顯示任何代替聲音的文字（沒有字幕、不顯示檔名、不顯示鍵）。
   - 音源三選一（#49）：`audio` 是包內檔案；`syllable` 是共用單音包的音節鍵；`word` 是共用語詞庫的語詞鍵，檔名用 `audio/` 的 `wordFileStem` 算。共用包用哪一版、網址怎麼組，由殼決定（`audio/README.md` 路徑規則）。找不到音檔時這題不能作答：殼略過這題並記錄，不改用裝置語音、不顯示文字代替。
   - 第一次播放可以在題目出現時自動播（瀏覽器允許時），也可以等學生按。`repeat_max` 是第一次之後還能再播幾次；用完就停用按鈕並用白話告訴學生（例如「已經聽完了，選選看」），不藏起來；不填不限。
   - `listen` 是題目本身，不受 `read_aloud_scope` 與 `ctx.speech.enabled` 影響，一律可以播；`read_aloud_scope` 仍只管題幹說明（`stem.text`）與選項，識字類用 `stem`，選項不唸。
   - 每次播放記一筆 `audio-played`，`target: "listen"`；`answered` 不加欄位。
   - 判分不變：仍是該題型的 `score()`。
7. **逐選項回饋（`options[].feedback`，#43）由殼負責**：
   - 練習模式答錯時，殼優先顯示學生選到的那個選項的 `feedback`；那個選項沒有才用題目的 `feedback.retry`。答對照舊用 `feedback.correct`。
   - 測驗模式不即時顯示任何回饋（總規劃 §6.1）；測驗結束、整批回看時可以顯示逐選項回饋。
   - 逐選項回饋是面向學生的文字，照規則 3 提供「聽」；`misconception` 代碼與中文名是給老師看的，不顯示給學生。

## 版本規則

- 每題型獨立 `version`（整數），寫在 `score.mjs` 並隨結果帶出 `type_version`。
- 加可選欄位、放寬作答格式：**不升版**。
- 改作答格式、改計分語意、刪欄位：**升主版本**，並在該題型資料夾加 `migrate/v<舊>-to-v<新>.mjs`（轉換舊題目實例與舊作答）與測試；舊版 `score()` 保留一個主版本的相容期。
- 事件契約（`events/`，後續 issue）記 `type` 與 `type_version`；學生進行中的任務鎖舊版，新任務用新版。
- 題目檔的 `format_version`（schema 層）與題型版本是兩件事：前者管檔案形狀，後者管計分語意。

## 路線圖

### v2 候選（`planned`）

目前沒有候選；ordering 與 classify 已納入 v1。

單格填字（原本想另開 `text-input`）併入 `blanks` 的「一格」情況，不另開型別。

### v3 保留（`reserved`）

| type | 中文 | 作答格式（草案） | 計分 | 注意 |
| --- | --- | --- | --- | --- |
| `drawing` | 畫圖 | `{ "asset": { "kind": "image", "mime": "image/png", "sha256": "…", "ref": "<宿主決定的位置>" } }` | `pending-review`，`score: 0`；教師依 rubric 批閱後由宿主改寫結果；可附自動檢查（有無作畫、筆畫數）進 `detail` | 圖內可能寫名字；作品檔不自動進雲端 DB，先留教師裝置或本機 |
| `speaking` | 口說 | `{ "asset": { "kind": "audio", "mime": "audio/webm", "sha256": "…", "ref": "…", "duration_ms": 0 } }` | `pending-review`；可接 ASR 給建議分放 `detail`，不自動定案 | **錄音是學生可識別資料**：只能留本機或教師裝置；雲端 DB 只存評分結果與時長，不存音檔（AGENTS 硬紅線 1） |

保留型別不在 v1 的 `item.schema.json` `type` enum 內。現在先占名稱、先把 `pending-review` 放進 `result.schema.json`，是為了讓事件契約與報表現在就留位，之後加題型不必改結果格式。

## 前例對照

- Perseus：widget 各自帶版本與 `scorer`，`itemDataVersion` 鎖版本 → 這裡的 `version`／`type_version`。
- Oppia：interaction 拆成 customization、答案 schema、rule、顯示四塊 → 這裡的 item schema、`response.schema.json`、`score.mjs`、renderer 契約。
- Numbas／Moodle calculated：數值容差三種型 → `numeric` 的 `tolerance`。
- QTI 3.0：`partial` 與 pending 的結果狀態概念；欄位名不照抄。

只借設計邏輯，不引入前例程式碼（AGENTS 硬紅線 2）。
