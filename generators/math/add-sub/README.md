# math.add-sub v1 — 依能力指標條件檔出加減法題

這個產生器不自己決定「出什麼」：它讀題目 `ladder_ids` 對應的[條件檔](../../profiles/README.md)，只在條件檔允許的檔位、數字形狀、呈現方式之中出題。第一份條件檔是 `n-I-2#a@2`（二位數加減，一次進退位）。

## 參數

通常不手寫，呼叫 `resolveParams(profile, { adjustment, overrides, mode })` 取得（見 `generators/profiles/index.mjs`）。欄位：

| 欄位 | 意思 |
| --- | --- |
| `tiers` | 要出的檔位 id（條件檔列的子集） |
| `weights` | 檔位相對權重，未列為 1 |
| `operations` | `add`／`sub`；每個檔位的運算都要在裡面 |
| `shapes` | `[被加數位數, 加數位數]` 清單，條件檔 `shapes.allowed` 的子集 |
| `presentation` | `vertical-blanks` 直式多格填空（每位一格）或 `horizontal-numeric` 橫式單值 |
| `scaffold` | `none`／`partial`／`full`，寫進實例 `display.scaffold`，由 renderer 解讀 |
| `context` | 是否用情境句；需要 `context_pools`，沒有可用的池就退回算式 |
| `distinct` | 同一批不重複（`a+b` 與 `b+a` 視為同一題） |
| `context_pools` | `{ subjects, items, actions_add, actions_sub }` → 內容包池 id；池條目可帶 `unit`（量詞） |

## 出題規則

1. 依權重抽檔位 → 均勻抽形狀 → 抽數字，不符檔位條件就重抽，每題最多 1000 次，抽不到丟 `RangeError` 並寫出是哪個檔位與形狀。
2. 一律 `a ≠ b`；減法 `a > b`。
3. 檔位條件：`carries`（加法進位次數，恰好）、`borrows`（退位次數）、`minuend_ones_zero`（被減數個位是否為 0）、`sum_max`／`sum_min`。
4. 直式：`blanks` 為 `ones`、`tens`，結果 ≥ 100 再加 `hundreds`；每格 `input 0–9`。`display.carry_marks: true` 表示 renderer 可畫進退位記號格，記號不計分。
5. 提示與回饋用條件檔該檔位的範本代入變數；題目檔自己寫了 `hints`／`feedback` 就覆寫（`instantiate` 處理）。

## 變數

`a b op op_word operation sum|diff result a_ones a_tens b_ones b_tens ones tens hundreds ones_sum carry carries borrow borrows carry_or_borrow tier`；減法另有 `a_ones_borrowed`（借位後的個位）、`a_tens_after`（借走後的十位）；用了情境時另有 `subject action item unit`。

## 與舊產生器的關係

`math.add-2digit-carry`／`math.add-2digit-no-carry` 是沒有條件檔時代的產物，功能被本產生器涵蓋；保留到 v2 以免既有內容包壞掉，新內容請用本產生器。
