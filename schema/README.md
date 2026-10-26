# schema

內容包的 JSON Schema（draft 2020-12）。所有 `$id` 為 `urn:udl-content-spec:v1:<name>`，彼此以 `$ref` 引用 `common`。

| 檔案 | 定義 |
| --- | --- |
| `common.schema.json` | 共用型別：`id`（kebab-case）、`semver`、`ref`（`pack@version#id`）、`relative_path`、**`spoken_text`**（`text`＋語音槽 `audio`）、`ladder_id`／`curriculum_code`、三層 `hints`、`feedback`、`difficulty`、`subject` |
| `pack.schema.json` | `pack.json`：`format_version`、`id`、`version`、`title`、`subject`、`language`、`license`、`source`、`audio.default_voice`、`units`、`pools`（包層級，可跨單元共用）、`misconceptions`（錯誤類型代碼 → 給老師看的中文名，#43）、`files`（路徑＋sha256） |
| `unit.schema.json` | 單元：對齊資訊、`ladder_ids`／`curriculum_codes`、`materials`／`items` 引用、`pools`（本單元用到的池，須在 pack.pools）；`bindings` 綁卡、`activity_profile`／`activities` 選步驟（#31）；`core` 核心卡、`ladders` 覆寫活動能力階梯、`quest` 任務開場與回報對話（#33） |
| `material.schema.json` | 教材：`kind`（lesson／simplified／demo／dialogue／mindmap／rhetoric）、`zhuyin_map`、`vocab`（`【詞|key】` 標記的 key）、`blocks`（text／image／audio／dialogue／math-demo／check／mindmap 節點樹）；text 區塊可選 `gist` 段落大意（`gist_span` 涵蓋幾個自然段，`preface` 前言不編段號，#60）、心智圖節點可選 `ordered`；`rhetoric` 區塊是修辭例句：`text`、`devices`（修辭類型代碼，第一個是主要的）、`note`（#51）；`math-demo` 區塊可選 `title`，每一步可帶 `figure`（圖形描述）、`tools`（疊上的虛擬工具）、`focus`（強調的元素 id）、`ask`（先想一想的提問，按「看答案」才顯示 `text`），外殼依相同的點 id 在相鄰兩步之間補間成講解動畫（#80） |
| `item.schema.json` | 題目：共用欄位＋`kind`（fixed／generated）＋`type`（choice／true-false／match／numeric／blanks／ordering／classify／handwrite）的條件欄位；手寫題 `target`、`mode`、`context`、`max_mistakes`（#78）；選用 `sound`（考讀音或字形，#66）與 `stem.say_text`（報讀用題幹）；generated 只帶 `generator`、`generator_version`、`params`、`count`；選用 `read_aloud_scope`（all／stem／none，#33）；`stem.listen`（聽音題：音源 `audio`／`syllable`／`word` 三選一、`repeat_max` 可選，#36、#49）；選擇題 `options[]` 可選 `misconception`（錯誤類型代碼）與 `feedback`（逐選項回饋，#43） |
| `pool.schema.json` | 干擾項池 |
| `figure.schema.json` | 幾何圖形描述（#69）：mm、y 向下；有名字的點、線段（邊或射線、等長記號）、角記號（角弧、直角記號）、標示文字（邊長、度數、甲乙丙、ㄅㄆㄇ，renderer 畫成可報讀的文字層，不燒進圖檔）、疊圖工具（直角板；量角器可帶 `toward`，半圓開在角那一側，底線可以沿一個沒畫出來的點）、必填 `alt`（不洩漏答案）；每個元素有 id；`steps` 欄位不使用，講解動畫的逐步狀態寫在示範教材 math-demo 的 steps（每一步一張 figure，#80）。產生器實例放在 `display.figure` |
| `scope.schema.json` | 範圍選擇器：`include`／`exclude` 的 pack＋version＋units／materials／items／標籤 |
| `card.schema.json` | 卡片（#31）：`char` 生字（鍵 `字|注音`；易混淆字 `confusables[]` 可填 `zhuyin`，聽音選字才能避開同音字，#49）、`word` 語詞（鍵 `詞|注音`，與音檔語詞庫同鍵）、`pattern` 句型（例句切詞塊）、`skill` 數學技能（引用產生器與參數）；同一個字或詞只有一張卡 |
| `activity-profile.schema.json` | 年級活動設定（#31）：某科某些年級一課預設有哪些步驟、屬讀委託／修練／討伐哪一段、報讀範圍；`ladders` 活動 × 年級 → 能力階梯（#33）；步驟 `count` 可寫 `"all"`（題庫有幾筆出幾題）、`quiz` 的 `blueprint` 測驗藍圖（各練習分類抽幾題，#50）、`mix` 的 `sources` 混合練習（#51）；內建設定在 `activities/profiles/` |

## 約定

- 欄位 snake_case；id kebab-case；選項與配對用穩定 `id`，正解另欄。
- 面向學生的每段文字都是 `spoken_text`；`audio: null` 代表尚未預錄，驗證器只警告。
- 題型專屬欄位在此只有最小定義；計分函式與 renderer 契約在 `question-types/`。
- 內容包目錄慣例：`pack.json`、`units/<id>.json`、`materials/<id>.json`、`items/<id>.json`、`pools/<id>.json`、`cards/<id>.json`、`audio/`、`images/`。
- 卡片庫包：`units` 可以是空陣列，此時 `cards` 至少一張；課包用 `pack@version#id` 跨包綁卡，驗證時用 `--cards-from <卡片庫包目錄>` 解析。
- 課文插圖：lesson 教材的 `image` 區塊可以插在任何段落之間；先不放圖的課，之後補圖只要加 `image` 區塊，段落順序（第幾段）只算 `text` 區塊，不受影響。
- 破壞相容升 `format_version` 並附轉換程式。
