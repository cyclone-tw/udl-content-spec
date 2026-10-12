import { generateAddition } from "../_add-2digit.mjs";

export const id = "math.add-2digit-carry";
export const version = 1;
/** 沒有條件檔時代的產生器：已被 math.add-sub 涵蓋，保留到 v2；驗證器對它的題目只警告「沒有條件檔」，不擋。 */
export const legacy = true;
export const paramsSchemaPath = "generators/math/add-2digit-carry/params.schema.json";

/** 二位數進位加法：個位相加 ≥ 10。 */
export function generate({ params, seed, count }) {
  return generateAddition({ params, seed, count, requireCarry: true, generatorId: id });
}
