# choice — 選擇題（單選）v1

## 題目欄位（來自 `schema/item.schema.json`）

- `options[]`：2 到 6 個，每個 `{ id, text: spoken_text, image? }`。
- `answer`：正解的 option id。
- `shuffle`：是否洗牌；`distractor_pool`：從池抽干擾項（抽完後的實例仍是同形的 `options[]`）。

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

`detail`：`{ chosen, answer }`。

## renderer 注意

- 每個選項一個 ≥ 48px 的觸控目標；選項文字旁可放「聽」。
- `shuffle: true` 用 `ctx.seed` 洗牌；`answer` 不參與畫面。
- v1 單選；複選另開型別或升版，不在 `choice` 內偷加陣列。
