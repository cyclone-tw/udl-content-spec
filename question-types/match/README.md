# match — 配對題 v1

## 題目欄位

- `pairs[]`：2 到 6 組，每組 `{ id, left: spoken_text, right: spoken_text }`。正解就是「同一組的左右相連」，不另寫 `answer`。
- `shuffle`：是否打亂右側順序。

## 作答格式

左側每個 pair id 對應學生連到的右側 pair id：

```json
{ "pairs": { "p1": "p1", "p2": "p3", "p3": "p2" } }
```

學生沒連的左側可以省略。

## 計分

| 情況 | outcome | score |
| --- | --- | --- |
| 每一組 `pairs[left] === left` | correct | 1 |
| 對 k 組，0 < k < n | partial | k／n |
| 一組都沒對（含全部沒連） | incorrect | 0 |
| 缺 `pairs`、出現不存在的 id | invalid（`missing-field`／`unknown-pair`） | 0 |

`detail`：`{ pairs: [{ id, chosen, correct }], correct_count, total }`，殼可用來標出哪一組連錯。

同一個右側被連兩次（有些 UI 允許）不算 invalid：各組獨立判定。

`partial` 之後要不要給獎勵、算不算過關，由宿主的流程政策決定（見 `../README.md`）。

## renderer 注意

- 左側固定順序、右側依 `ctx.seed` 洗牌。
- 連線或拖拉皆可，但觸控目標 ≥ 48px，且要有「取消這一組」的手勢。
- `showResult(result)` 可依 `detail.pairs[].correct` 標色，但不能在送出前透露對應關係。
