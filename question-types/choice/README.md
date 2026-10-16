# choice — 選擇題（單選）v1

## 題目欄位（來自 `schema/item.schema.json`）

- `options[]`：2 到 6 個，每個 `{ id, text: spoken_text, image?, misconception?, feedback? }`。
  - `misconception`（可選，#43）：錯誤類型代碼（kebab-case），代表選這個選項是哪一種錯誤想法；代碼必須列在 `pack.json` 的 `misconceptions`（代碼 → 給老師看的中文名），或是 `activities/` 的內建錯誤類型（#49）。正解選項不得帶。
  - `feedback`（可選，#43）：逐選項回饋（`spoken_text`）。殼的顯示規則見 `../README.md` renderer 契約第 7 條。
- `answer`：正解的 option id。
- `shuffle`：是否洗牌；`distractor_pool`：從池抽干擾項（抽完後的實例仍是同形的 `options[]`）。
- `stem.listen`（可選，#36）：聽音選字、選語詞、選注音；只播聲音、不顯示答案字。音源是包內 `audio`、共用單音包 `syllable` 或共用語詞庫 `word` 三選一（#49）。殼的行為見 `../README.md` renderer 契約第 6 條；計分不變。播單音時選項不得有同音字（驗證器拿得到讀音時檢查，見 `conformance/README.md`）。

## 作答格式

```json
{ "option": "a" }
```

## 計分

| 情況 | outcome | score |
| --- | --- | --- |
| `option` 等於 `answer` | correct | 1 |
| `option` 是其他選項 | incorrect | 0 |
| 缺 `option`、不是 id 格式、不在 `options[]` 內 | invalid（`detail.reason`：`missing-field`／`bad-id`／`unknown-option`） | 0 |

`detail`：`{ chosen, answer, misconception? }`。答錯且選到的選項帶 `misconception` 時，照抄該代碼（可選欄位，#43）；答對或選項沒標就不出現。事件的 `answered.detail` 照抄 `detail`，kit 與教師報表就能統計「這個學生常犯哪一類錯」。

## renderer 注意

- 每個選項一個 ≥ 48px 的觸控目標；選項文字旁可放「聽」。
- `shuffle: true` 用 `ctx.seed` 洗牌；`answer` 不參與畫面。
- v1 單選；複選另開型別或升版，不在 `choice` 內偷加陣列。
