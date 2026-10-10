# schema

內容包的 JSON Schema（draft 2020-12）。所有 `$id` 為 `urn:udl-content-spec:v1:<name>`，彼此以 `$ref` 引用 `common`。

| 檔案 | 定義 |
| --- | --- |
| `common.schema.json` | 共用型別：`id`（kebab-case）、`semver`、`ref`（`pack@version#id`）、`relative_path`、**`spoken_text`**（`text`＋語音槽 `audio`）、`ladder_id`／`curriculum_code`、三層 `hints`、`feedback`、`difficulty`、`subject` |
| `pack.schema.json` | `pack.json`：`format_version`、`id`、`version`、`title`、`subject`、`language`、`license`、`source`、`audio.default_voice`、`units`、`pools`（包層級，可跨單元共用）、`files`（路徑＋sha256） |
| `unit.schema.json` | 單元：對齊資訊、`ladder_ids`／`curriculum_codes`、`materials`／`items` 引用、`pools`（本單元用到的池，須在 pack.pools） |
| `material.schema.json` | 教材：`kind`（lesson／simplified／demo／dialogue）、`zhuyin_map`、`vocab`（`【詞|key】` 標記的 key）、`blocks`（text／image／audio／dialogue／math-demo／check） |
| `item.schema.json` | 題目：共用欄位＋`kind`（fixed／generated）＋`type`（choice／true-false／match／numeric）的條件欄位；generated 只帶 `generator`、`generator_version`、`params`、`count` |
| `pool.schema.json` | 干擾項池 |
| `scope.schema.json` | 範圍選擇器：`include`／`exclude` 的 pack＋version＋units／materials／items／標籤 |

## 約定

- 欄位 snake_case；id kebab-case；選項與配對用穩定 `id`，正解另欄。
- 面向學生的每段文字都是 `spoken_text`；`audio: null` 代表尚未預錄，驗證器只警告。
- 題型專屬欄位在此只有最小定義；計分函式與 renderer 契約在 `question-types/`。
- 內容包目錄慣例：`pack.json`、`units/<id>.json`、`materials/<id>.json`、`items/<id>.json`、`pools/<id>.json`、`audio/`、`images/`。
- 破壞相容升 `format_version` 並附轉換程式。
