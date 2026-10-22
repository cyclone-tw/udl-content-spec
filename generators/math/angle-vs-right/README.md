# math.angle-vs-right v1 — 和直角比（圖形選擇題）

畫一個角，問「比直角小、一樣大，還是比直角大」。第一份條件檔是 `n-II-9#b@3`（三年級：能用直角板判斷一個角是直角、比直角大或比直角小；S-3-1／N-3-13）。udl-math#8、udl-content-spec#69。

## 參數

通常不手寫，呼叫 `resolveParams(profile, { adjustment, overrides, mode })` 取得（規則在 `generators/profiles/angle-vs-right.mjs`）。

| 欄位 | 意思 |
| --- | --- |
| `tiers` | 要出的檔位 id（條件檔列的子集）；檔位是角度範圍，例如明顯、直角、接近直角 |
| `weights` | 檔位相對權重，未列為 1；**題數依權重按比例分配**（最大餘數法），12 題、權重 6／3／3 就是 6、3、3 題 |
| `choices` | `three`：比直角小／一樣大／比直角大；`is-right`：是直角／不是直角（課程調整：替代） |
| `overlay` | 寫進實例 `display.overlay`：`button` 只給「放上直角板」切換鈕；`hint` 另外在用到第 2 層提示時自動疊上；`always` 一開始就疊上（課程調整：分解） |
| `rotate` | 整個角隨機旋轉（15 度一格），抓「斜放就認不得直角」 |
| `vary_rays` | 兩邊長短與角弧大小隨機；約三分之一的銳角與鈍角題故意誤導（小角配長邊大弧、大角配短邊小弧），抓「看邊長判斷角的大小」 |
| `distinct` | 同一批不出度數與方向都一樣的角 |

## 出題規則

1. 依權重把題數分給檔位；檔位有兩個範圍（銳、鈍）時輪流，從隨機一個開始；整批洗牌。
2. 在範圍內抽整數度；`distinct` 時度數＋方向重複就重抽，每題最多 1000 次，抽不到丟 `RangeError` 並說明檔位與範圍。
3. 輸出 `type: "choice"`，選項固定順序（`shuffle: false`，有大小順序）；錯誤選項帶錯誤類型代碼（activities 內建表）：
   - `angle-by-ray-length`：這題故意誤導邊長，卻選了反方向；
   - `angle-compare-reversed`：沒有誤導也選了反方向；
   - `angle-right-by-eye`：不是直角卻選一樣大，或正放的直角說不一樣；
   - `angle-right-orientation`：斜放（不是 90 度倍數方向）的直角說不一樣。
4. 圖形描述放在 `display.figure`（`schema/figure.schema.json`）：頂點 `v`、起邊上的點 `a`、終邊上的點 `b`，從 `a` 逆時針轉 `angle` 度到 `b`；角弧半徑隨題變化；附 `tools["set-square"]`（直角板，直角邊 30 mm）。畫布已包含直角板疊上去的範圍。
5. **不洩漏答案**：圖上不標度數（三年級不談度）；直角也只畫角弧、不畫直角記號；`alt` 每題相同；三個檔位的提示句相同（條件檔測試檢查）。
6. 回饋用條件檔範本：`{relation}`（和直角的關係）、`{name_sentence}`（帶出銳角、直角、鈍角的名稱，初步認識）。

## 變數

`angle rotation ray_a ray_b arc misleading answer_key relation name_sentence tier choices`（長度單位 mm）。
