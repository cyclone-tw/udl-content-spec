# activities

「積木＋清單」的活動層（#31）：單元用 `bindings` 綁卡，這裡依綁定的卡與教材排出一課的步驟，並為練習與測驗生題。決策來源：udl-learning#137（學生端版面規劃 §6.4、§6.6、§6.9）。

## 三件事

| 函式 | 做什麼 |
| --- | --- |
| `resolveBindings(unit, lookup)` | 把 `bindings` 的卡片引用換成卡片物件；同包 id 或跨包 `pack@version#id` 都交給 `lookup` |
| `planSteps({ unit, cards, materials, profile?, items?, readings?, groups? })` | 年級活動設定（或單元自己的 `activities`）× 綁定的卡 × 有的教材與手寫題 → 步驟清單（進度條的關卡）；條件不足的步驟放進 `skipped` 並寫理由。`groups` 只留這幾類練習（#50） |
| `generate(activity, { unit, cards, seed, count?, pools?, items?, blueprint?, readings?, audio? })` | 生題；同一單元＋同一組卡（與手寫題）＋同一個種子，結果永遠相同 |

`toItemShape()`、`toInstanceShape()` 把實例轉回固定題／產生器實例形狀給 schema 驗證；`correctResponse()` 產生正解作答（驗證器確認正解拿滿分）。

## 活動登錄表

| 活動 | 段落 | 分類 | 生題 | 需要 | 產出題型 |
| --- | --- | --- | --- | --- | --- |
| `read` | 讀委託 | — | 否 | lesson 或 simplified 教材 | — |
| `mindmap` | 讀委託 | — | 否 | mindmap 教材 | — |
| `demo` | 讀委託 | — | 否 | demo 教材 | — |
| `char-cards` | 修練 | 識字 | 否 | 生字卡 | —（renderer 逐張翻卡） |
| `word-cards` | 修練 | 語詞 | 否 | 語詞卡 | — |
| `manipulate` | 修練 | 技能 | 否 | 有 `manipulative` 的技能卡 | — |
| `char-pick` | 修練 | 識字 | 是 | 生字卡 ≥ 2 張，或卡上有易混淆字 | choice：看注音與例詞選字，干擾項優先用卡上的易混淆字 |
| `word-match` | 修練 | 語詞 | 是 | 語詞卡 ≥ 2 | match：語詞 ↔ 意思（最多 4 組） |
| `word-cloze` | 修練 | 語詞 | 是 | 有例句的語詞卡，語詞卡 ≥ 2 | choice：例句挖空選語詞 |
| `listen-char` | 修練 | 識字 | 是 | 至少一張生字卡湊得出「讀音已知、不同音」的干擾字 | choice＋`stem.listen.syllable`：播單音選字（#49）。干擾項先用卡上填了 `zhuyin` 的易混淆字，再用同課生字；同音字一律不用，讀音不明的字不用 |
| `listen-word` | 修練 | 語詞 | 是 | 語詞卡 ≥ 2，且不全同音 | choice＋`stem.listen.word`：播語詞選語詞（#49）。干擾項是同課其他語詞，同音語詞不用；有同音字的優先放一個 |
| `word-meaning` | 修練 | 語詞 | 是 | 語詞卡 ≥ 2，且解釋不全相同 | choice：看語詞（有例句就帶例句）選解釋（#49）。干擾項是同課其他語詞的解釋，有相同字的語詞優先放一個 |
| `sentence-order` | 修練 | 語詞 | 是 | 句型卡 | ordering：例句詞塊排序 |
| `skill-practice` | 修練 | 技能 | 是 | 技能卡 | 數學產生器實例（numeric／blanks），參數照能力指標條件檔 |
| `para-gist` | 修練 | 課文 | 是 | lesson 教材至少 2 段填了 `gist` | choice：第 N 段在說什麼（題幹帶段落原文）；錯的選項用別段大意，一個取最近的段（#51） |
| `para-order` | 修練 | 課文 | 是 | lesson 教材至少 3 段填了 `gist` | ordering：段落大意照課文順序排；超過 8 段切成幾組連續段落（#51） |
| `mindmap-pick` | 修練 | 課文 | 是 | 心智圖有兩個以上分支 | choice：這一支（或主要分支）還少了哪一個；錯的選項用別的分支、同一層優先（#51） |
| `mindmap-order` | 修練 | 課文 | 是 | 心智圖有標 `ordered`、子節點 3 到 8 個的節點 | ordering：子節點照先後排（例如步驟、經過，#51） |
| `rhetoric-pick` | 修練 | 課文 | 是 | 教材裡有修辭例句（`rhetoric` 區塊） | choice：這句用了哪一種修辭；錯的選項先放一個常混淆的（例如譬喻↔擬人、類疊↔排比），再用這課學過的修辭，不會是這句用到的修辭（#51） |
| `rhetoric-sort` | 修練 | 課文 | 是 | 一句一種修辭的例句至少 4 句、2 種以上修辭 | classify：把 4 到 6 句分到 2 到 3 種修辭，常混淆的優先放在一起（#51） |
| `mix` | 修練 | 依來源 | 是 | `sources` 至少一個條件足夠 | 混合練習：一步裡混合同分類的幾個活動，依 `sources` 順序一段一段出（#51） |
| `reading-items` | 修練 | 課文 | 是 | 單元 `items` 裡有手寫的固定題 | 手寫題照抄（題型不限），預設 `count: "all"`：每題輪到一次（#50） |
| `quiz` | 討伐 | — | 是 | 有藍圖：前面有對應分類的練習步驟；沒有藍圖：以上任一種可出題的卡 | 有藍圖時照分類從練習題庫抽（見下）；沒有藍圖時在選字、語詞填空、句型排序、技能練習之間輪流抽；語詞配對只在沒有其他來源時才用（一題就是一整組，放進測驗太重） |

卡片生的選擇題最多三個選項（正解＋兩個干擾項，湊不到兩個就少一個）；卡比題數少時循環使用，每輪重新洗牌，所以題數不少於卡數時每張卡都會輪到。

練習與測驗用同一批卡、同一套生題；差別只在平台的流程設定（提示、揭答、重試），題目不變。只有離不開課文的題（閱讀理解）才在單元 `items` 逐課手寫，由 `reading-items` 放進練習與測驗。

## 練習分類與測驗藍圖（#50）

Cyclone 2026-10-16（udl-learning#189）：練習要能分類，老師可以只指派其中一類；測驗題從練習題庫抽，不另外出題。

- **分類**：每個練習活動屬一類，`char` 識字、`word` 語詞、`reading` 課文、`skill` 數學技能（上表「分類」欄）。`planSteps` 回傳的步驟帶 `group`；`planSteps({ groups: ["char"] })` 只留這幾類的練習，教學步驟不受影響，測驗也只考這幾類。
- **題庫與 `count: "all"`**：每個生題活動知道自己的題庫有幾筆（例如聽音選字＝湊得出題的生字數、課文練習＝手寫題數）。步驟的 `count` 寫 `"all"` 時，有幾筆就出幾題，每筆輪到一次。技能練習的題目由產生器無限生，不支援 `"all"`。
- **測驗藍圖** `blueprint`：只給 `quiz`，例如 `[{ "group": "char", "count": 2 }, …]`。`planSteps` 把每一類接到**本課測驗之前、同分類、會生題的練習步驟**，回傳 `step.blueprint`（含 `sources`）與加總後的 `count`；呼叫端把 `step.blueprint` 原樣傳給 `generate("quiz", { blueprint, items })`。
  - 每一類的題數輪流分給該類的來源活動，每個來源不超過它的題庫筆數，所以同一次測驗不會重複出同一題；題庫不夠時就少出幾題，驗證器會提醒。
  - 某一類前面沒有練習步驟：這一類略過，記在 `step.blueprint_skipped`；全部都略過時這一步放進 `skipped`。
  - 題目實例帶 `quiz_source`（來自哪個活動）與 `quiz_group`（哪一類）；同一個種子抽到同一批，換種子就換一批。
  - 老師改題數：單元的 `activities` 可寫自己的藍圖；平台指派時也可以直接改 `blueprint` 各類的 `count` 再呼叫 `generate`（平台流程設定）。
  - 沒有 `blueprint` 的 `quiz` 照舊（中、低年級與數學）。
- **混合練習** `mix`（#51）：Cyclone 要的是「識字、語詞、課文」三類練習，所以高年級設定一類一步，用 `sources` 列出這一步混合哪些同分類活動（`planSteps` 回傳的 `step.sources` 只留條件足夠的，略過的記在 `step.sources_skipped`）；呼叫端把 `step.sources` 原樣傳給 `generate("mix", { sources, … })`。`count: "all"` 是各來源題庫加總、每筆輪到一次；給數字時輪流分給各來源、不超過各自的題庫。題目依 `sources` 順序成段出（同一種題型放在一起，減少切換），各帶 `mix_source`，能力階梯與報讀範圍照來源活動。測驗藍圖會把混合練習展開成它的來源。
- **混合練習的來源條件不足時略過**：例如「只用核心卡」時湊不出選字題，就只出聽音選字；全部來源都湊不出題才丟錯（#58）。
- **太重的來源不進測驗**：語詞配對一題就是一整組，同分類有別的來源時，測驗藍圖不用它；只有它時才用（#58）。
- **藍圖來源題庫都是 0 時丟錯**：多半是呼叫端漏傳 `materials` 或 `items`，不默默少出（#58）。
- **重現一批題目**：要同樣的 `unit`、`cards`、`seed`、`count`，以及 `blueprint`／`sources`／`items`／`materials`；平台記事件時要一起留著這次用的步驟設定（#58）。
- **設定錯誤 vs 條件不足**：非 `quiz` 寫 `blueprint`、不支援 `count: "all"` 的活動寫了 `"all"`、混合練習的來源不是練習活動或混了不同分類，`planSteps` 都放進 `skipped` 並標 `config: true`，驗證器報錯；其他（例如這課沒有心智圖）只是條件不足，略過不報錯（#56）。
- **藍圖的來源**只算會算題庫（`pool`）的活動；技能練習沒有題庫，不當藍圖來源（#56）。
- `groups` 篩選對沒有藍圖的 `quiz` 不起作用：舊式小測驗照舊從所有卡抽（#56）。
- **課文題** `reading-items`：單元 `items` 裡的固定題一律歸「課文」；產生器模板（`kind: "generated"`）不算。實例照抄題目內容，`id` 不變（報表照題目統計），`source: "items"`、`item` 記原題 id；報讀範圍以題目自己標的 `read_aloud_scope` 為先，沒標用 `all`。

## 年級活動設定（`profiles/`）

| id | 年級 | 步驟 |
| --- | --- | --- |
| `zh-low` | 國語一、二 | 聽故事 → 認字 → 配對 → 小測驗 |
| `zh-mid` | 國語三、四 | 讀課文 → 生字 → 語詞配對 → 句型排序 → 小測驗 |
| `zh-high` | 國語五、六 | 讀課文 → 心智圖 → 生字卡 → **識字練習**（聽音選字、看音選字）→ 語詞卡 → **語詞練習**（聽音選詞、語詞解釋、語詞配對、語詞填空）→ 句型（可關）→ **課文練習**（段落大意、段落排序、心智圖挖空與排序、修辭選擇與分類、手寫課文題）→ 小測驗（藍圖：識字 2、語詞 3、課文 5；#50、#51） |
| `math-elementary` | 數學一到六 | 看示範 → 操作練習 → 計算練習 → 小測驗 |

形狀見 `schema/activity-profile.schema.json`。單元可用 `activity_profile` 指定別份，或用 `activities` 整份取代；老師之後在指派時隱藏或調整（平台流程設定，不在規格）。

## 能力階梯、報讀範圍、核心卡、任務對話（#33）

- **能力階梯掛在「活動 × 年級」**：年級設定的 `ladders` 寫「活動 → 年級 → ladder_ids」（`"*"` 是其他年級），單元的 `ladders` 可覆寫。卡片生的題優先序：活動 × 年級 → 卡片自己標的 → 單元的；驗證器要求每題至少有一條。同一張卡拿去做選字與做填空練的是不同能力，所以不要把階梯只標在卡片上。內建對照目前是草稿（`ladder_status: "draft"`），驗證器會提醒待 Cyclone 審。
- **報讀範圍** `read_aloud_scope`：`all`／`stem`／`none`。識字類（選字、配對、填空）預設 `stem`：只唸題幹、不唸選項，否則變成聽音選字；句型排序 `all`；技能練習 `stem`。年級設定的步驟可覆寫；題目實例帶這個欄位，外殼照做、事件照記 `read_aloud`。
- **核心卡** `unit.core`：bindings 之中這課最重要的卡，標在每課清單、不放卡片。`generate(..., { coreOnly: true })` 只用核心卡（減量、簡化時用）；驗證器另外用核心卡跑一次，湊不出某種題只警告。
- **任務對話** `unit.quest`：`intro`／`outro` 指向同單元的 `dialogue` 教材；RPG 殼接成任務開場與回報，獨立殼可忽略。

## 聽音題、內建錯誤類型（#49）

- **音源**：聽音選字播共用單音包的音節（`stem.listen.syllable`，例如 `ze2`），聽音選語詞播共用語詞庫的語詞（`stem.listen.word`，例如 `抉擇|ㄐㄩㄝˊ ㄗㄜˊ`）；音檔不必放進內容包，殼照 `audio/` 的鍵規則找檔。輕聲字不出聽音選字（單音包不收輕聲）。
- **避開同音字**：讀音表 `readingsFromCards(cards)` 收生字卡、語詞卡（逐字拆注音）與易混淆字的 `zhuyin`。`generate()` 可以多傳 `readings`（例如整個卡片庫的讀音表），認得的字更多、擋得也更多。干擾字只要有任何一個已知讀音和播放的音相同就不用；完全查不到讀音的字也不用。
- **只出有音檔的題**：`generate()` 傳 `audio: { syllables, words }`（單音鍵、語詞鍵的清單，取自音檔總目錄）時，只對有預錄音檔的卡出聽音題；不傳視為都有。驗證器不知道總目錄，所以不傳。
- **內建錯誤類型** `misconceptions`（`activities/index.mjs` 匯出，形狀同 `pack.json` 的 `misconceptions`）：

  | 代碼 | 中文名 | 誰會標 |
  | --- | --- | --- |
  | `form-alike` | 形近混淆 | 聽音選字：易混淆字 `why: 形近` |
  | `sound-alike` | 音近混淆 | 聽音選字：易混淆字 `why: 音近`；聽音選語詞：有同音字的語詞 |
  | `shared-char` | 相同字的語詞混淆 | 語詞解釋：干擾項的語詞和題目語詞有相同字 |
  | `wrong-paragraph` | 段落重點張冠李戴 | 段落大意：選了別段的大意（#51） |
  | `wrong-branch` | 心智圖分支放錯 | 心智圖挖空：選了別的分支的內容（#51） |
  | `rhetoric-mixup` | 修辭類型混淆 | 修辭選擇：選了另一種修辭；是哪兩種看 `detail` 的 `chosen` 與 `answer`（#51） |

  標了錯誤類型的選項都帶套句型的逐選項回饋；同課其他生字或語詞當干擾項時不標。`score()` 的 `detail.misconception` 與 `answered` 事件照 #43 帶出。手寫題也可以直接用這些代碼，不必在 `pack.json` 重列。

## 修辭例句（#51）

教材的 `rhetoric` 區塊是一句例句、用了哪些修辭（`devices`，第一個是主要的）、給學生的說明 `note`。修辭類型代碼與中文名、白話說明由 `activities/` 匯出 `rhetoricDevices`：

| 代碼 | 中文 | 代碼 | 中文 |
| --- | --- | --- | --- |
| `simile` | 譬喻 | `quotation` | 引用 |
| `personification` | 擬人 | `sensory` | 摹寫 |
| `hyperbole` | 誇飾 | `contrast` | 映襯 |
| `repetition` | 類疊 | `antithesis` | 對偶 |
| `parallelism` | 排比 | `climax` | 層遞 |
| `rhetorical-question` | 設問 | `anadiplosis` | 頂真 |
| `exclamation` | 感嘆 | | |

- 修辭選擇的逐選項回饋說明「選到的那種修辭是什麼」，不直接說出答案；答對後才顯示這句的 `note`。
- 一句用了兩種修辭時，正解是第一個，另一個不會出現在錯的選項裡；這種句子不放進分類題。
- 例句來自課文時，內容包只放在私人教材 repo（國語是 `udl-chinese`）；本 repo 的範例與測試一律原創。

## 題目實例的追溯欄位

課文資料生的題（#51）：`source: "materials"`、`material`（教材 id）、`anchor`（`p3` 第 3 段、`p1-p6` 段落範圍、`n0.1.2` 心智圖節點路徑）、`cards: []`；混合練習出的題另帶 `mix_source`。

課文題（#50）：`kind: "instance"`、`source: "items"`、`item`（原題 id，`id` 不變）、`activity`、`activity_version`、`seed`、`index`、`unit`；其餘欄位照抄手寫題。測驗藍圖抽出的題另帶 `quiz_group`。

卡片生的題：`kind: "instance"`、`source: "cards"`、`activity`、`activity_version`、`seed`、`index`、`unit`、`cards`（用到的卡 id）、`quiz_source`（小測驗裡這題來自哪個活動）；其餘欄位與固定題相同，可直接丟給 `score()`。技能練習沿用數學產生器的實例，另加 `activity`、`activity_version`、`cards`。作答事件記 `activity`＋`seed` 就能重現整批題目。
