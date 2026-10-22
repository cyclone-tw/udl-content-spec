// math.angle-measure 的條件檔規則（_family.mjs 工廠）：檔位、權重、題數、量角器疊圖時機、不重複。
import { makeFamily } from "./_family.mjs";

export const { checkParams, resolveParams } = makeFamily({
  booleans: ["distinct"],
  perMode: { overlay: ["button", "hint", "always"] },
});
