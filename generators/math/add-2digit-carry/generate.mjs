import { generateAddition } from "../_add-2digit.mjs";

export const id = "math.add-2digit-carry";
export const version = 1;
export const paramsSchemaPath = "generators/math/add-2digit-carry/params.schema.json";

/** 二位數進位加法：個位相加 ≥ 10。 */
export function generate({ params, seed, count }) {
  return generateAddition({ params, seed, count, requireCarry: true, generatorId: id });
}
