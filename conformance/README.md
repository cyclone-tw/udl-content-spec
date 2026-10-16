# conformance

```sh
pnpm install
pnpm run validate examples/minimal            # schema＋引用＋hash；警告不阻擋
pnpm run validate examples/minimal -- --strict  # 警告也算失敗（例如語音槽未預錄）
pnpm run validate examples/minimal -- --ladder-dir ../sped-student-kit/data/ladder  # 另檢查 ladder_ids 存在於 kit 階梯資料
pnpm run validate path/to/lesson-pack -- --cards-from path/to/card-library  # 跨包綁卡時指定卡片庫包（可給多次）
pnpm run update-files examples/minimal        # 重新產生 pack.json 的 files 清單與 sha256
pnpm run validate:events events/examples/runner-session.json -- --ladder-dir ../sped-student-kit/data/ladder  # 作答事件檔
pnpm run validate:audio audio/examples/words.json -- --previous old/words.json  # 音檔包清單；--previous 檢查同一版只新增
pnpm test
```

`validate.mjs` 檢查：每個檔案符合 schema；id 與檔名一致；item／material 的 `unit` 正確；選擇題正解在選項內、id 不重複；池在 pack.pools 載入一次、`distractor_pool` 與單元 pools 只能引用它；教材文中 `【詞|key】` 的 key 在 `vocab`；每題 `ladder_ids` 至少一條；產生題的 `ladder_ids` 之中恰一條有條件檔（`generators/profiles/`）、`generator`／`generator_version` 與條件檔一致、`params` 通過產生器 `params.schema.json` 與條件檔 `checkParams`、`context_pools` 的池存在；`check` 引用的題目在單元；圖片、音檔、語音槽路徑都列在 `files` 且 hash 相符；同一個包內 id 唯一；磁碟上未列在 `files` 的檔案警告。所有讀檔前先確認路徑在 pack 目錄內；`pack.json` 或單一檔案 schema 不合格就跳過該檔的後續檢查，不會拋例外。可從其他程式 `import { validatePack }` 取得 `{ ok, errors, warnings, counts }`。

卡片與活動（#31）：卡片符合 `card.schema.json`、id 與檔名一致、包內 `key` 不重複；生字卡 `key` 是「字|注音」、語詞卡 `key` 是「詞|注音」且注音音節數等於字數、例句含該語詞；生字卡的例詞引用存在、是語詞卡且含該字；技能卡的產生器參數照產生題同一套規則檢查。單元的 `bindings` 都要解析得到且種類正確（跨包 `pack@version#id` 沒給 `--cards-from` 只警告）；接著依年級活動設定排步驟，對每個生題步驟用固定種子實際生一批題：題目要通過題型 schema，正解要拿滿分。只有卡片、沒有單元的卡片庫包合法（`units` 空陣列時 `cards` 至少一張）。#33 起另外檢查：例句裡語詞只出現一次、易混淆字不重複；`core` 都在 `bindings`；`quest` 指向本單元的 dialogue 教材；單元 `ladders` 的 id 也核對 `--ladder-dir`；卡片生的每題都有 `ladder_ids`；有 `core` 時用核心卡再生一次（湊不出只警告）；年級設定的能力階梯對照是草稿時提醒。

聽音題（#36）：有 `stem.listen` 的題，`listen.audio` 必須列在 `files` 且 hash 相符；`listen.word` 必須是正規化的語詞鍵（`wordKey`，#49）。**同音字檢查**：播單音時，正解以外的選項（含 `distractor_pool` 會抽進來的池項目）不得和播放的音同音；選項是注音時不得就是播放的音。這項檢查只在拿得到讀音時做，拿不到就略過、不報錯也不警告：
- 播放的音：`listen.syllable`（#49），或 `listen.audio` 的檔名是單音包的音節鍵（例如 `audio/xing2.m4a`，見 `audio/README.md`）才認得；語詞音檔（`w-…`）或其他檔名一律當成「不是單音」，不檢查（播語詞本來就可以有同音字選項，題幹要寫清楚選哪個字）。
- 選項的讀音：選項是單一個字時，從本包與 `--cards-from` 卡片庫的生字卡（`字|注音`）與語詞卡（逐字注音）查；破音字任何一個讀音同音就擋。查不到卡的字略過，所以要完整檢查請帶卡片庫。
- 只檢查 `choice`；`match` 帶 `listen` 時不做同音字檢查。
- 卡片生的聽音題（`listen-char`，#49）也照這條檢查，讀音表同樣含 `--cards-from` 卡片庫；生題本身已經避開同音字，這裡是第二道防線。
- 讀音表也收生字卡易混淆字的 `zhuyin`（#49）。卡片檢查：易混淆字的 `zhuyin` 要是一個合法音節，而且和 `why` 一致（`音同` 要同音，其他標示不得同音）。
- 音檔來源驗證器管不到：照 udl-learning `docs/reading-audio-production.md`，只用總目錄已登記、人耳確認過的單音或語詞音檔；輕聲與助詞只能用共用助詞庫，不得單獨合成。

錯誤類型（#43）：選擇題選項的 `misconception` 必須列在 `pack.json` 的 `misconceptions`，或是 `activities/` 的內建錯誤類型（#49；卡片生的題只能用內建代碼）；正解選項帶 `misconception` 報錯。逐選項 `feedback` 是一般 `spoken_text`，語音槽照既有規則檢查（路徑要在 `files`、`null` 警告）。

`validate-events.mjs` 驗證作答事件檔（`udl-attempt-events/v1`）：schema、seq、outcome 與 score 一致、角色與代號、`--ladder-dir`、隱私掃描；細節見 `events/README.md`。`validate-audio.mjs` 驗證音檔包清單（單音、語詞、整課）：schema、鍵與注音一致、檔名規則、相對路徑、重複、合成標示、同一版只新增；細節見 `audio/README.md`。內容 lint 待後續 issue。所有檢查在本機跑，不靠 GitHub Actions。
