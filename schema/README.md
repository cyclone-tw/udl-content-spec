# schema

內容包的 JSON Schema（draft 2020-12）。所有 `$id` 為 `urn:udl-content-spec:v1:<name>`，彼此以 `$ref` 引用 `common`。

| 檔案 | 定義 |
| --- | --- |
| `common.schema.json` | 共用型別：`id`（kebab-case）、`semver`、`ref`（`pack@version#id`）、`relative_path`、**`spoken_text`**（`text`＋語音槽 `audio`）、`ladder_id`／`curriculum_code`、三層 `hints`、`feedback`、`difficulty`、`subject` |
| `pack.schema.json` | `pack.json`：`format_version`、`id`、`version`、`title`、`subject`、`language`、`license`、`source`、`audio.default_voice`、`units`、`pools`（包層級，可跨單元共用）、`files`（路徑＋sha256） |
| `unit.schema.json` | 單元：對齊資訊、`ladder_ids`／`curriculum_codes`、`materials`／`items` 引用、`pools`（本單元用到的池，須在 pack.pools）；`bindings` 綁卡、`activity_profile`／`activities` 選步驟（#31）；`core` 核心卡、`ladders` 覆寫活動能力階梯、`quest` 任務開場與回報對話（#33） |
| `material.schema.json` | 教材：`kind`（lesson／simplified／demo／dialogue／mindmap）、`zhuyin_map`、`vocab`（`【詞|key】` 標記的 key）、`blocks`（text／image／audio／dialogue／math-demo／check／mindmap 節點樹） |
| `item.schema.json` | 題目：共用欄位＋`kind`（fixed／generated）＋`type`（choice／true-false／match／numeric）的條件欄位；generated 只帶 `generator`、`generator_version`、`params`、`count`；選用 `read_aloud_scope`（all／stem／none，#33） |
| `pool.schema.json` | 干擾項池 |
| `scope.schema.json` | 範圍選擇器：`include`／`exclude` 的 pack＋version＋units／materials／items／標籤 |
| `card.schema.json` | 卡片（#31）：`char` 生字（鍵 `字|注音`）、`word` 語詞（鍵 `詞|注音`，與音檔語詞庫同鍵）、`pattern` 句型（例句切詞塊）、`skill` 數學技能（引用產生器與參數）；同一個字或詞只有一張卡 |
| `activity-profile.schema.json` | 年級活動設定（#31）：某科某些年級一課預設有哪些步驟、屬讀委託／修練／討伐哪一段、報讀範圍；`ladders` 活動 × 年級 → 能力階梯（#33）；內建設定在 `activities/profiles/` |

## 約定

- 欄位 snake_case；id kebab-case；選項與配對用穩定 `id`，正解另欄。
- 面向學生的每段文字都是 `spoken_text`；`audio: null` 代表尚未預錄，驗證器只警告。
- 題型專屬欄位在此只有最小定義；計分函式與 renderer 契約在 `question-types/`。
- 內容包目錄慣例：`pack.json`、`units/<id>.json`、`materials/<id>.json`、`items/<id>.json`、`pools/<id>.json`、`cards/<id>.json`、`audio/`、`images/`。
- 卡片庫包：`units` 可以是空陣列，此時 `cards` 至少一張；課包用 `pack@version#id` 跨包綁卡，驗證時用 `--cards-from <卡片庫包目錄>` 解析。
- 破壞相容升 `format_version` 並附轉換程式。
