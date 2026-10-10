# conformance

```sh
pnpm install
pnpm run validate examples/minimal            # schema＋引用＋hash；警告不阻擋
pnpm run validate examples/minimal -- --strict  # 警告也算失敗（例如語音槽未預錄）
pnpm run update-files examples/minimal        # 重新產生 pack.json 的 files 清單與 sha256
pnpm test
```

`validate.mjs` 檢查：每個檔案符合 schema；id 與檔名一致；item／material 的 `unit` 正確；選擇題正解在選項內、id 不重複；`distractor_pool` 在單元 pools；教材文中 `【詞|key】` 的 key 在 `vocab`；`check` 引用的題目在單元；圖片、音檔、語音槽路徑都列在 `files` 且 hash 相符。可從其他程式 `import { validatePack }` 取得 `{ ok, errors, warnings, counts }`。

lint 與隱私掃描待後續 issue。所有檢查在本機跑，不靠 GitHub Actions。
