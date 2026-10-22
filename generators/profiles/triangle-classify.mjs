// math.triangle-classify 的條件檔規則（_family.mjs 工廠）：檔位、權重、題數、直角板疊圖時機、旋轉、不重複。
import { makeFamily } from "./_family.mjs";

export const { checkParams, resolveParams } = makeFamily({
  booleans: ["rotate", "distinct"],
  perMode: { overlay: ["button", "hint", "always"] },
});
