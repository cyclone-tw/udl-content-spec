# AGENTS.md — udl-content-spec

所有 coding agent 進本 repo 先讀這份。全域規則（cyclone-agent-config）照常適用；此處只列本 repo 特有規則。

<!-- udl-family-block v1 -->
> **UDL 教學家族**：本 repo 是家族共用的內容規格（公開）：內容包格式、題型與計分、數學產生器、作答事件、音檔清單格式、驗證器；不含任何教材正本或學生資料。
> 上游：`udl-learning` 總規劃（決策正本）、`sped-student-kit`（能力階梯，驗證時用 `--ladder-dir`）；下游：`udl-learning`（平台與教材工廠）、各科教材 repo（如 `udl-math`），都以 git tag 版本相依本 repo。
> 家族地圖正本：`cyclone-tw/udl-learning` 的 `docs/family-map.md`（私人 repo）。要改本 repo 的角色或串接方式，先改地圖。
<!-- /udl-family-block -->

## 這個 repo 是什麼

UDL 教學家族共用的內容規格（schema、題型與計分、參數化產生器、事件契約、獨立執行器、一致性測試）。正本決策在 udl-learning 總規劃 v1.1；本 repo 不複製決策文字，只連結。

## 硬紅線

1. **不含學生資料**：`examples/` 只放合成課文與題目；代號只用示意（例如 `S03`）；不貼真名、真學號、班級名單。
2. **不引入前例程式碼或素材**：H5P、Perseus、Oppia、Numbas、Moodle、CASE、ink 等只借設計邏輯；任何複製貼上的程式或圖都不得進 repo。
3. Secrets／token／`.env` 不進 git。
4. 授權：程式 MIT；`examples/` CC-BY 4.0。新增第三方相依前先確認授權相容（MIT／Apache-2.0／BSD 可；GPL／NC 不可）。

## 開發流程

- Issue-first：每個規格部分（schema、題型、產生器、事件、執行器、conformance、範例）各開 issue，掛 udl-learning#67 的 ledger。
- branch → PR → 受管跨 agent review（`openab-review`）→ approved 或 nits-only 就 merge；Coder ≠ Reviewer。
- 共用 checkout 不切分支；在 `~/Cyclone-System/worktrees/udl-content-spec-<issue>-<slug>` 開自己的 worktree。
- 測試與 conformance 在本機跑並附證據；不設計 GitHub Actions 跑重測試。

## 規格紀律

- 題型、產生器、事件各自有版本號；破壞相容升主版本並附轉換程式與測試。
- `score()` 是純函式：只看題目實例與作答，不讀外部狀態、不碰 DOM。
- 參數化題記種子與產生器版本，必須可重現。
- 欄位名以總規劃與 kit 決議為準（`ladder_ids`／`curriculum_codes`、`mode`、`assignmentId`…）；課綱碼模型照 CASE 欄位名。
- 面向學生的文字一律白話、正向、不羞辱；每段文字保留語音槽。

## 技術約定

- JavaScript／TypeScript 一律 pnpm；不用 npm／npx。
- 執行器只用原生 Web 技術（無框架），iPad Safari 為第一目標；觸控 ≥ 48px；支援 `prefers-reduced-motion`。
