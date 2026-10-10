# examples

合成範例內容包（CC-BY 4.0，見 `../LICENSE-CONTENT.md`）。不含課文原句、不含學生資料；文本原創，只對齊教科書進度。

- `minimal/`：一個國語單元（原創短文、對話、選擇／是非／配對各一題、一個語意混淆池）＋一個數學小單元（情境示範、固定計算題、參數化題「二位數進位加法」）。語音槽皆為 `null`，驗證時會警告。
- `scopes/first-lesson-test.json`：Scope 範例「只從第一課出題」。

改動範例後執行 `pnpm run update-files examples/minimal` 更新 hash。
