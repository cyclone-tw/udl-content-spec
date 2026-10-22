// math.angle-vs-right 的條件檔規則：檔位是角度範圍，預設與五種課程調整只動檔位、題數、選項樣式、疊圖時機與隨機變化。
// profiles/index.mjs 依 profile.generator 分派到這裡；純函式，不讀外部狀態。

const ADJUSTMENTS = ["simplify", "reduce", "decompose", "substitute", "not_applicable"];
const MODES = ["assess", "practice"];
export const CHOICES = Object.freeze(["three", "is-right"]);
export const OVERLAYS = Object.freeze(["button", "hint", "always"]);
const KNOWN = new Set(["tiers", "weights", "choices", "overlay", "rotate", "vary_rays", "distinct"]);
const SETTING_KEYS = ["tiers", "weights", "count", "choices", "rotate", "vary_rays", "distinct"];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 檢查 params 是否在條件檔範圍內；回傳錯誤字串陣列（空＝合格）。 */
export function checkParams(profile, params) {
  const errors = [];
  if (!isPlainObject(params)) return ["params 必須是物件"];
  for (const k of Object.keys(params)) if (!KNOWN.has(k)) errors.push(`未知參數 ${JSON.stringify(k)}`);
  const tiers = params.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) errors.push("tiers 必須是至少一個檔位 id 的陣列");
  else {
    for (const t of tiers) if (!Object.hasOwn(profile.tiers, t)) errors.push(`檔位 ${JSON.stringify(t)} 不在條件檔 ${profile.ladder_id}（可用：${Object.keys(profile.tiers).join("、")}）`);
    if (new Set(tiers).size !== tiers.length) errors.push("tiers 不可重複");
  }
  if (params.weights !== undefined) {
    if (!isPlainObject(params.weights)) errors.push("weights 必須是物件");
    else {
      for (const [k, w] of Object.entries(params.weights)) {
        if (!Array.isArray(tiers) || !tiers.includes(k)) errors.push(`weights 的 ${k} 不在 tiers`);
        if (typeof w !== "number" || !(w > 0)) errors.push(`weights 的 ${k} 必須是正數`);
      }
    }
  }
  if (!CHOICES.includes(params.choices)) errors.push(`choices 必須是 ${CHOICES.join("／")}`);
  if (!OVERLAYS.includes(params.overlay)) errors.push(`overlay 必須是 ${OVERLAYS.join("／")}`);
  for (const k of ["rotate", "vary_rays", "distinct"]) if (typeof params[k] !== "boolean") errors.push(`${k} 必須是布林`);
  return errors;
}

function merge(base, patch) {
  const out = { ...base };
  for (const k of SETTING_KEYS) if (patch[k] !== undefined) out[k] = structuredClone(patch[k]);
  if (patch.overlay !== undefined) {
    if (!isPlainObject(patch.overlay)) throw new TypeError(`overlay 覆寫必須是 { assess, practice } 物件（例如 { practice: "always" }），不是 ${JSON.stringify(patch.overlay)}`);
    out.overlay = { ...base.overlay, ...patch.overlay };
  }
  return out;
}

/**
 * 從條件檔推出 params 與 count。adjustment 是五種調整之一（或省略），overrides 是老師的覆寫，mode 決定疊圖時機取 assess 還是 practice。
 * 回傳 { skip: true } 表示不適用。覆寫超出條件檔丟 TypeError。
 */
export function resolveParams(profile, { adjustment, overrides = {}, mode = "assess" } = {}) {
  if (!MODES.includes(mode)) throw new TypeError(`resolveParams: mode 必須是 ${MODES.join("／")}`);
  let settings = structuredClone(profile.defaults);
  if (adjustment !== undefined) {
    if (!ADJUSTMENTS.includes(adjustment)) throw new TypeError(`resolveParams: 未知調整 ${JSON.stringify(adjustment)}（可用：${ADJUSTMENTS.join("、")}）`);
    const adj = profile.adjustments[adjustment];
    if (adj.skip) return { skip: true, adjustment, label: adj.label };
    settings = merge(settings, adj);
  }
  if (!isPlainObject(overrides)) throw new TypeError("resolveParams: overrides 必須是物件");
  settings = merge(settings, overrides);
  const weights = Object.fromEntries(settings.tiers.map((t) => [t, settings.weights?.[t] ?? 1]));
  const params = {
    tiers: settings.tiers,
    weights,
    choices: settings.choices,
    overlay: settings.overlay[mode],
    rotate: settings.rotate,
    vary_rays: settings.vary_rays,
    distinct: settings.distinct,
  };
  const errors = checkParams(profile, params);
  if (errors.length) throw new TypeError(`resolveParams(${profile.ladder_id}): ${errors.join("；")}`);
  return { params, count: settings.count, adjustment: adjustment ?? null, mode };
}
