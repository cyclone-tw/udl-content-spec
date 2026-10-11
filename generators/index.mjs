// 產生器登錄表。內容包的 generated 題只帶 generator id 與參數；這裡依種子產出題目實例。
import * as addCarry from "./math/add-2digit-carry/generate.mjs";
import * as addNoCarry from "./math/add-2digit-no-carry/generate.mjs";

const entry = (mod) => Object.freeze({
  id: mod.id,
  version: mod.version,
  generate: mod.generate,
  paramsSchemaPath: mod.paramsSchemaPath,
});

/** 已登錄的產生器。 */
export const generators = Object.freeze({
  [addCarry.id]: entry(addCarry),
  [addNoCarry.id]: entry(addNoCarry),
});

export const INSTANCE_SCHEMA_PATH = "generators/instance.schema.json";

/** 取得產生器；未登錄回傳 null。 */
export function getGenerator(id) {
  return Object.hasOwn(generators, id) ? generators[id] : null;
}

// 從 item 原樣帶到每個實例的共用欄位（面向報表與 kit 對接）。
const COPIED_FIELDS = ["unit", "skill", "difficulty", "ladder_ids", "curriculum_codes", "strategy", "meta"];
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 把 {a}、{sum} 這類佔位符換成變數值；沒有對應變數的原樣保留。 */
export function substitute(text, variables) {
  return text.replace(/\{([a-z_][a-z0-9_]*)\}/g, (m, name) => (Object.hasOwn(variables, name) ? String(variables[name]) : m));
}
const substituteSpoken = (spoken, variables) =>
  isPlainObject(spoken) && typeof spoken.text === "string" ? { ...spoken, text: substitute(spoken.text, variables) } : spoken;

/**
 * 把一道 generated 題目展開成 item.count 個題目實例。
 * 同一個 item、同一個 seed 永遠得到同樣的實例；事件只要記 seed 就能重現。
 * @param {object} item  kind: "generated" 的題目（已通過 schema 驗證）。
 * @param {{ seed: string|number }} options
 */
export function instantiate(item, { seed } = {}) {
  if (!isPlainObject(item)) throw new TypeError("instantiate: item 必須是物件");
  if (item.kind !== "generated") throw new TypeError(`instantiate: item.kind 是 ${JSON.stringify(item.kind)}，只有 generated 題需要展開`);
  if (seed === undefined || seed === null || seed === "") throw new TypeError("instantiate: 需要 seed（字串或數字），事件才能重現這批題目");
  const gen = getGenerator(item.generator);
  if (!gen) throw new TypeError(`instantiate: 未登錄的產生器 ${JSON.stringify(item.generator)}`);
  if (item.generator_version !== gen.version) {
    throw new TypeError(
      `instantiate: ${gen.id} 目前是 version ${gen.version}，題目 ${item.id} 要求 version ${item.generator_version}；請更新題目或固定使用舊版規格`,
    );
  }
  if (!Number.isInteger(item.count) || item.count < 1) throw new TypeError("instantiate: item.count 必須是 ≥ 1 的整數");

  const seedText = String(seed);
  const parts = gen.generate({ params: item.params, seed: seedText, count: item.count });
  return parts.map((part, index) => {
    const instance = {
      kind: "instance",
      id: `${item.id}#${index}`,
      source_item: item.id,
      type: part.type,
      generator: gen.id,
      generator_version: gen.version,
      seed: seedText,
      index,
      variables: part.variables,
    };
    for (const f of COPIED_FIELDS) if (item[f] !== undefined) instance[f] = structuredClone(item[f]);
    for (const [k, v] of Object.entries(part)) if (k !== "type" && k !== "variables") instance[k] = v;
    if (Array.isArray(item.hints)) instance.hints = item.hints.map((h) => substituteSpoken(h, part.variables));
    if (isPlainObject(item.feedback)) {
      instance.feedback = Object.fromEntries(Object.entries(item.feedback).map(([k, v]) => [k, substituteSpoken(v, part.variables)]));
    }
    return instance;
  });
}
