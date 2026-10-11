# true-false — 是非題 v1

## 題目欄位

- `stem`：陳述句。
- `answer`：布林；`true` 表示陳述正確。

## 作答格式

```json
{ "value": true }
```

## 計分

| 情況 | outcome | score |
| --- | --- | --- |
| `value` 等於 `answer` | correct | 1 |
| `value` 相反 | incorrect | 0 |
| 缺 `value`、不是布林（例如字串 `"true"`） | invalid（`missing-field`／`not-boolean`） | 0 |

`detail`：`{ chosen, answer }`。

## renderer 注意

- 兩個大按鈕（是／非）各 ≥ 48px；標籤文字由殼的語系決定，作答只送布林。
- 不洗牌。
