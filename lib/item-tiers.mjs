// Optional item metadata, independent of generator tier and hint_tier (#96).
export const READING_LEVELS = Object.freeze(["retrieve", "infer", "interpret"]);
export const ITEM_TIERS = Object.freeze(["regular", "advanced"]);
export const ITEM_TIER_SCOPES = Object.freeze([...ITEM_TIERS, "all"]);

export function itemTierScope(value = "regular") {
  if (!ITEM_TIER_SCOPES.includes(value)) throw new TypeError("item_tier 必須是 regular、advanced 或 all");
  return value;
}

const valid = (q) => q && typeof q === "object" && !Array.isArray(q) && (q.level === undefined || READING_LEVELS.includes(q.level))
  && (q.item_tier === undefined || ITEM_TIERS.includes(q.item_tier))
  && (q.item_tier !== "advanced" || ["infer", "interpret"].includes(q.level));

export function itemTierEligible(question, scope = "regular") {
  itemTierScope(scope);
  return Boolean(valid(question) && (scope === "all" || (question.item_tier ?? "regular") === scope));
}

export function itemClassification(question) {
  if (!valid(question)) throw new TypeError("level／item_tier 不合法，advanced 必須是 infer 或 interpret");
  return Object.fromEntries(["level", "item_tier"].filter((k) => question[k] !== undefined).map((k) => [k, question[k]]));
}
