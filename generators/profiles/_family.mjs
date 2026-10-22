// 幾何產生器的條件檔規則工廠：檔位＋權重＋題數，再加上每個產生器自己的列舉、布林與「依 mode 取值」的設定。
// 加減法有自己的規則（index.mjs），不走這裡。純函式。

const ADJUSTMENTS = ["simplify", "reduce", "decompose", "substitute", "not_applicable"];
const MODES = ["assess", "practice"];
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @param {object} spec
 * @param {Record<string, string[]>} [spec.enums]    params 的列舉欄位 → 可用值（例如 choices）
 * @param {string[]} [spec.booleans]                 params 的布林欄位
 * @param {Record<string, string[]>} [spec.perMode]  條件檔裡寫成 { assess, practice }、params 取當下 mode 的欄位 → 可用值（例如 overlay）
 */
export function makeFamily({ enums = {}, booleans = [], perMode = {} } = {}) {
  const known = new Set(["tiers", "weights", ...Object.keys(enums), ...booleans, ...Object.keys(perMode)]);
  const settingKeys = ["tiers", "weights", "count", ...Object.keys(enums), ...booleans];

  function checkParams(profile, params) {
    const errors = [];
    if (!isPlainObject(params)) return ["params 必須是物件"];
    for (const k of Object.keys(params)) if (!known.has(k)) errors.push(`未知參數 ${JSON.stringify(k)}`);
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
    for (const [k, values] of Object.entries({ ...enums, ...perMode })) if (!values.includes(params[k])) errors.push(`${k} 必須是 ${values.join("／")}`);
    for (const k of booleans) if (typeof params[k] !== "boolean") errors.push(`${k} 必須是布林`);
    return errors;
  }

  function merge(base, patch) {
    const out = { ...base };
    for (const k of settingKeys) if (patch[k] !== undefined) out[k] = structuredClone(patch[k]);
    for (const k of Object.keys(perMode)) {
      if (patch[k] === undefined) continue;
      if (!isPlainObject(patch[k])) throw new TypeError(`${k} 覆寫必須是 { assess, practice } 物件，不是 ${JSON.stringify(patch[k])}`);
      out[k] = { ...base[k], ...patch[k] };
    }
    return out;
  }

  /** 從條件檔推出 params 與 count；{ skip: true } 表示不適用。覆寫超出條件檔丟 TypeError。 */
  function resolveParams(profile, { adjustment, overrides = {}, mode = "assess" } = {}) {
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
    const params = { tiers: settings.tiers, weights: Object.fromEntries(settings.tiers.map((t) => [t, settings.weights?.[t] ?? 1])) };
    for (const k of [...Object.keys(enums), ...booleans]) params[k] = settings[k];
    for (const k of Object.keys(perMode)) params[k] = settings[k][mode];
    const errors = checkParams(profile, params);
    if (errors.length) throw new TypeError(`resolveParams(${profile.ladder_id}): ${errors.join("；")}`);
    return { params, count: settings.count, adjustment: adjustment ?? null, mode };
  }

  return { checkParams, resolveParams };
}
