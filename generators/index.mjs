// 產生器登錄表。內容包的 generated 題只帶 generator id 與參數；這裡依種子產出題目實例。
// 數學題的「出什麼」由能力指標條件檔決定（generators/profiles/），產生器只在條件檔允許的範圍內抽數字。
import * as addCarry from "./math/add-2digit-carry/generate.mjs";
import * as addNoCarry from "./math/add-2digit-no-carry/generate.mjs";
import * as addSub from "./math/add-sub/generate.mjs";
import { profilesFor } from "./profiles/index.mjs";
import { substitute, substituteSpoken } from "./_template.mjs";

export { substitute } from "./_template.mjs";
export { profiles, getProfile, profilesFor, resolveParams, checkParams, PROFILE_SCHEMA_PATH } from "./profiles/index.mjs";

const entry = (mod) => Object.freeze({
  id: mod.id,
  version: mod.version,
  generate: mod.generate,
  paramsSchemaPath: mod.paramsSchemaPath,
});

/** 已登錄的產生器。add-2digit-carry／no-carry 已被 add-sub 涵蓋，保留到 v2。 */
export const generators = Object.freeze({
  [addCarry.id]: entry(addCarry),
  [addNoCarry.id]: entry(addNoCarry),
  [addSub.id]: entry(addSub),
});

export const INSTANCE_SCHEMA_PATH = "generators/instance.schema.json";

/** 取得產生器；未登錄回傳 null。 */
export function getGenerator(id) {
  return Object.hasOwn(generators, id) ? generators[id] : null;
}

// 從 item 原樣帶到每個實例的共用欄位（面向報表與 kit 對接）。
const COPIED_FIELDS = ["unit", "skill", "difficulty", "ladder_ids", "curriculum_codes", "strategy", "meta"];
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * 找出題目對應的條件檔：ladder_ids 之中恰有一條有條件檔才回傳；兩條以上是內容錯誤；一條都沒有回 null（舊產生器不需要）。
 */
export function profileForItem(item) {
  const found = profilesFor(item.ladder_ids);
  if (found.length > 1) {
    throw new TypeError(`題目 ${item.id} 的 ladder_ids 對到 ${found.length} 份條件檔（${found.map((p) => p.ladder_id).join("、")}）；產生題只能檢測一條有條件檔的指標`);
  }
  return found[0] ?? null;
}

/**
 * 把一道 generated 題目展開成 item.count 個題目實例。
 * 同一個 item、同一個 seed 永遠得到同樣的實例；事件只要記 seed 就能重現。
 * @param {object} item  kind: "generated" 的題目（已通過 schema 驗證）。
 * @param {{ seed: string|number, pools?: Map|object }} options  pools：內容包的池（id → pool），情境範本用。
 */
export function instantiate(item, { seed, pools } = {}) {
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
  const profile = profileForItem(item);
  if (profile && profile.generator !== gen.id) {
    throw new TypeError(`instantiate: 條件檔 ${profile.ladder_id} 指定產生器 ${profile.generator}，題目 ${item.id} 卻用 ${gen.id}`);
  }

  const seedText = String(seed);
  const parts = gen.generate({ params: item.params, seed: seedText, count: item.count, profile, pools });
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
    // 題目檔自己寫的提示／回饋優先；沒寫就用產生器（條件檔範本）給的。
    if (Array.isArray(item.hints)) instance.hints = item.hints.map((h) => substituteSpoken(h, part.variables));
    if (isPlainObject(item.feedback)) {
      instance.feedback = Object.fromEntries(Object.entries(item.feedback).map(([k, v]) => [k, substituteSpoken(v, part.variables)]));
    }
    if (!Array.isArray(instance.hints) || !isPlainObject(instance.feedback)) {
      throw new TypeError(`instantiate: 題目 ${item.id} 沒有 hints／feedback，產生器 ${gen.id} 也沒有提供（舊產生器的題目必須自己寫）`);
    }
    return instance;
  });
}
