# audio：音檔包格式 v1

朗讀音檔分三層存放，每層各有一種清單格式。產出端（udl-learning 的建置工具）和取用端（平台、教材 repo）都依這裡的規則算鍵與檔名，所以同一個音節或語詞在任何 repo 都對到同一個檔案。

正本決策：udl-learning `docs/reading-audio-production.md` §8、總規劃 §6.5／§12（udl-learning#102）。本 repo 只定格式，不放音檔與課文。

| 層 | 清單格式 | 單位與鍵 | 檔名 | 用在 |
| --- | --- | --- | --- | --- |
| 單音 | `udl-audio-syllables` v1 | 一個注音音節（不含輕聲） | ASCII 鍵＋副檔名，例如 `xing2.m4a` | 點單字；同音字共用 |
| 語詞 | `udl-audio-words` v1 | `詞\|注音` | `w-`＋鍵的 sha256 前 16 碼＋副檔名 | 點語詞、生字卡、單音包沒有的讀音 |
| 整課 | `udl-audio-lesson` v1 | 一課；每軌一條連續音軌＋時間表 | 包內自訂（清單記相對路徑） | 整課、段落、單句 |

## 鍵規則（`audio/index.mjs`）

- **注音正規化**：去掉空白，輕聲點 `˙` 放最前面（`˙ㄉㄜ`），與 udl-learning reading-engine 一致。多音節的注音每個音節一段，用一個半形空白分隔。
- **單音鍵** `syllableKey(注音)`：漢語拼音＋聲調數字。
  - 一聲 1、ˊ 2、ˇ 3、ˋ 4、輕聲 5。
  - ü 寫 `v`（`ㄌㄩˋ` → `lv4`），ㄐㄑㄒ 後面寫 `u`（`ㄐㄩˋ` → `ju4`）。
  - 單獨的 ㄝ 寫 `eh`。
  - 例：`ㄒㄧㄥˊ` → `xing2`、`ㄓ` → `zhi1`。
  - 不是合法音節就回 `null`。這不是完整的音韻表，只擋會讓拼音寫錯的組合。
  - 測試以 pypinyin 字典的 1,533 個音節比對（`tests/fixtures/zhuyin-pinyin.json`）。嘆詞 ㄋㄍ、ㄏㄇ 這類不支援。
- **語詞鍵** `wordKey(詞, 注音)`：`銀行|ㄧㄣˊ ㄏㄤˊ`。只收漢字，字數必須等於音節數。不帶課次、出版社、學年度，所以跨課、跨版本、跨學期都能共用。
- **語詞檔名** `wordFileStem(詞, 注音)`：`w-` 加鍵的 sha256 前 16 碼。用 ASCII，可以重現，也不受注音空白寫法影響。
- **整課版本碼** `lessonVersionId(各軌 text_sha256, readings_sha256)`：取雜湊的前 12 碼。
  - 出版社改了一個字，或讀音覆寫改了，版本碼就不同，不會誤用舊音檔。
  - 學年度不參與計算，換學年度課文相同就直接沿用。
  - `text_sha256` 是這一軌實際朗讀的文字（各行以 `\n` 連接）的 sha256。`readings_sha256` 由產出端對讀音資料（含人工覆寫）算出。

## 路徑規則

- 清單裡只寫**包內相對路徑**：不寫絕對路徑、完整網址、`..` 或反斜線。取用端自己把「網址前綴＋包代號＋版本＋相對路徑」組成網址。網址前綴要不要登入，由平台決定。
- 單音、語詞的包代號（`pack.id`）帶聲音名稱，版本另記在 `pack.version`，例如 `syllables/zh-TW-HsiaoChenNeural` 的 `v1`。建議網址路徑是 `<pack.id>/<pack.version>/<src>`。換聲音就是另一個包，不會混在一起。
- 整課建議放在 `lessons/<publisher>/g<grade>s<semester>/<lesson_no 兩位數>/<version_id>/`。清單的 `lesson` 欄位就是這幾段資料，`additionalProperties: false`，不收學年度。

## 不可變規則

- 同一個包、同一個版本**只能新增**。改動 `src` 或 `sha256`、或移除既有項目，都要開下一版（`v2`）。CDN 才能長期快取，舊課包也不會壞。
- 整課的同一個 `version_id` 不得改內容。內容不同，`version_id` 自然不同。
- 驗證器加上 `--previous <舊清單>` 會檢查這條規則。

## 單音包的品質欄位

- 每個音節記 `source_text`（實際送去合成的代表字）與 `check`：
  - `two-reference`：用兩個不同的代表字合成後比對，結果一致。
  - `listened`：人耳試聽過。
  - `status: review`：還要人聽。
- 不可靠的音節**不放進清單**，改列 `unresolved`，播放端點到就發 missing，不拿別的讀音頂替。
- **輕聲不收**：輕聲沒有單獨的唸法，由 udl-learning 的共用助詞庫處理。

## 產音來源與揭露

- `voice.engine` 記產音來源：`edge-tts`、`azure-speech`、`human`、`other`。`synthetic` 標示是否為合成語音，驗證器會檢查兩者一致。播放端依 `synthetic` 標示「AI 合成語音」。
- edge-tts 的輸出能不能公開散布有條款疑慮，見 udl-learning#102。這只影響「放在哪裡」，不影響格式。
- 整課音檔與課文有版權，不放公開網址（udl-learning `docs/reading-audio-production.md` §8）。

## 驗證

```sh
pnpm run validate:audio audio/examples/syllables.json audio/examples/words.json audio/examples/lesson.json
pnpm run validate:audio new/words.json --previous old/words.json   # 檢查同一版只新增
```

範例在 `audio/examples/`，都是合成資料，sha256 是示意值。
