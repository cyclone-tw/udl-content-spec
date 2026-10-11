# conformance

```sh
pnpm install
pnpm run validate examples/minimal            # schema＋引用＋hash；警告不阻擋
pnpm run validate examples/minimal -- --strict  # 警告也算失敗（例如語音槽未預錄）
pnpm run validate examples/minimal -- --ladder-dir ../sped-student-kit/data/ladder  # 另檢查 ladder_ids 存在於 kit 階梯資料
pnpm run update-files examples/minimal        # 重新產生 pack.json 的 files 清單與 sha256
pnpm test
```

`validate.mjs` 檢查：每個檔案符合 schema；id 與檔名一致；item／material 的 `unit` 正確；選擇題正解在選項內、id 不重複；池在 pack.pools 載入一次、`distractor_pool` 與單元 pools 只能引用它；教材文中 `【詞|key】` 的 key 在 `vocab`；每題 `ladder_ids` 至少一條；產生題的 `ladder_ids` 之中恰一條有條件檔（`generators/profiles/`）、`generator`／`generator_version` 與條件檔一致、`params` 通過產生器 `params.schema.json` 與條件檔 `checkParams`、`context_pools` 的池存在；`check` 引用的題目在單元；圖片、音檔、語音槽路徑都列在 `files` 且 hash 相符；同一個包內 id 唯一；磁碟上未列在 `files` 的檔案警告。所有讀檔前先確認路徑在 pack 目錄內；`pack.json` 或單一檔案 schema 不合格就跳過該檔的後續檢查，不會拋例外。可從其他程式 `import { validatePack }` 取得 `{ ok, errors, warnings, counts }`。

lint 與隱私掃描待後續 issue。所有檢查在本機跑，不靠 GitHub Actions。
