// 二位數加法的共用核心：進位與不進位兩個產生器都用這裡，只差 requireCarry。
import { createRng } from "../_prng.mjs";

export const PARAM_DEFAULTS = Object.freeze({ min: 10, max: 99, distinct: true, layout: "horizontal" });
const LAYOUTS = ["horizontal", "vertical"];
const KNOWN_PARAMS = new Set(["min", "max", "max_sum", "distinct", "layout", "require_carry"]);
// 每一題最多重抽幾次；超過就視為條件抽不到（例如參數讓條件不可能成立）。
export const MAX_ATTEMPTS_PER_ITEM = 1000;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 檢查並補齊參數；錯的參數是內容錯誤，直接丟 TypeError。 */
export function normalizeParams(params, { requireCarry, generatorId }) {
  const p = params === undefined ? {} : params;
  if (!isPlainObject(p)) throw new TypeError(`${generatorId}: params 必須是物件`);
  for (const k of Object.keys(p)) {
    if (!KNOWN_PARAMS.has(k)) throw new TypeError(`${generatorId}: 未知參數 ${JSON.stringify(k)}`);
  }
  const min = p.min ?? PARAM_DEFAULTS.min;
  const max = p.max ?? PARAM_DEFAULTS.max;
  for (const [name, v] of [["min", min], ["max", max]]) {
    if (!Number.isInteger(v) || v < 10 || v > 99) throw new TypeError(`${generatorId}: ${name} 必須是 10 到 99 的整數（二位數）`);
  }
  if (min > max) throw new TypeError(`${generatorId}: min 不能大於 max`);
  if (p.max_sum !== undefined && (!Number.isInteger(p.max_sum) || p.max_sum < 20)) {
    throw new TypeError(`${generatorId}: max_sum 必須是 ≥ 20 的整數`);
  }
  const distinct = p.distinct ?? PARAM_DEFAULTS.distinct;
  if (typeof distinct !== "boolean") throw new TypeError(`${generatorId}: distinct 必須是布林`);
  const layout = p.layout ?? PARAM_DEFAULTS.layout;
  if (!LAYOUTS.includes(layout)) throw new TypeError(`${generatorId}: layout 必須是 ${LAYOUTS.join(" 或 ")}`);
  if (p.require_carry !== undefined && p.require_carry !== requireCarry) {
    throw new TypeError(`${generatorId}: require_carry 必須是 ${requireCarry}（由產生器決定，參數只能重申）`);
  }
  return { min, max, max_sum: p.max_sum, distinct, layout };
}

const hasCarry = (a, b) => (a % 10) + (b % 10) >= 10;

/**
 * 產出 count 題二位數加法。回傳的每一筆是「題目實例的題型部分」：type、stem、answer、tolerance、input、display、variables；
 * 共用欄位（hints、feedback、ladder_ids…）由 generators/index.mjs 從 item 併進來。
 */
export function generateAddition({ params, seed, count, requireCarry, generatorId }) {
  const p = normalizeParams(params, { requireCarry, generatorId });
  if (!Number.isInteger(count) || count < 1) throw new TypeError(`${generatorId}: count 必須是 ≥ 1 的整數`);
  const rng = createRng(`${generatorId}|${String(seed)}`);
  const seen = new Set();
  const out = [];
  for (let i = 0; i < count; i++) {
    let found = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ITEM && !found; attempt++) {
      const a = rng.int(p.min, p.max);
      const b = rng.int(p.min, p.max);
      if (hasCarry(a, b) !== requireCarry) continue;
      if (p.max_sum !== undefined && a + b > p.max_sum) continue;
      const key = a <= b ? `${a}+${b}` : `${b}+${a}`;
      if (p.distinct && seen.has(key)) continue;
      seen.add(key);
      found = { a, b };
    }
    if (!found) {
      throw new RangeError(
        `${generatorId}: 第 ${i + 1} 題在 ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到符合條件的加數（` +
          `${requireCarry ? "需進位" : "不進位"}、範圍 ${p.min}–${p.max}` +
          (p.max_sum !== undefined ? `、和 ≤ ${p.max_sum}` : "") +
          (p.distinct ? "、不重複" : "") +
          `）；請放寬參數或減少 count`,
      );
    }
    const { a, b } = found;
    const sum = a + b;
    out.push({
      type: "numeric",
      stem: { text: { text: `${a} + ${b} = ？`, audio: null } },
      answer: sum,
      tolerance: { type: "nominal", value: 0 },
      input: { min: 0, max: 999, decimals: 0 },
      display: { layout: p.layout },
      variables: {
        a,
        b,
        sum,
        a_ones: a % 10,
        a_tens: Math.floor(a / 10),
        b_ones: b % 10,
        b_tens: Math.floor(b / 10),
        carry: hasCarry(a, b) ? 1 : 0,
      },
    });
  }
  return out;
}
