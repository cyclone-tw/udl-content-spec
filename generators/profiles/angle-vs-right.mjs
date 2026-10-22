// math.angle-vs-right 的條件檔規則：檔位是角度範圍，預設與五種課程調整只動檔位、題數、選項樣式、疊圖時機與隨機變化。
// profiles/index.mjs 依 profile.generator 分派到這裡；規則由 _family.mjs 的工廠產生（幾何產生器共用）。
import { makeFamily } from "./_family.mjs";

export const CHOICES = Object.freeze(["three", "is-right"]);
export const OVERLAYS = Object.freeze(["button", "hint", "always"]);

export const { checkParams, resolveParams } = makeFamily({
  enums: { choices: CHOICES },
  booleans: ["rotate", "vary_rays", "distinct"],
  perMode: { overlay: OVERLAYS },
});
