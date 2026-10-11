// 條件檔登錄表：每條 kit 能力階梯一份，決定產生題能用哪些檔位與預設怎麼出。
// 三層分工：這裡是「條件檔」（通用）；「處方」（學生 × 指標用哪種調整）在平台名冊；「尺」（達到門檻）在 kit／IEP。
import nI2a2 from "./n-i-2-a-2.json" with { type: "json" };

export const PROFILE_SCHEMA_PATH = "generators/profiles/profile.schema.json";

/** 已登錄的條件檔，以 ladder id 為 key。 */
export const profiles = Object.freeze({
  [nI2a2.ladder_id]: nI2a2,
});

/** 五種課程調整的固定鍵（對應 C06／C08 表件的簡化、減量、分解、替代；不適用＝不出題）。 */
export const ADJUSTMENTS = Object.freeze(["simplify", "reduce", "decompose", "substitute", "not_applicable"]);
export const MODES = Object.freeze(["assess", "practice"]);
export const PRESENTATIONS = Object.freeze(["vertical-blanks", "horizontal-numeric"]);
export const SCAFFOLDS = Object.freeze(["none", "partial", "full"]);
const OPERATIONS = Object.freeze(["add", "sub"]);
const CONTEXT_POOL_KEYS = Object.freeze(["subjects", "items", "actions_add", "actions_sub"]);

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameShape = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === 2 && x[0] === y[0] && x[1] === y[1];
const hasShape = (list, s) => list.some((t) => sameShape(t, s));

/** 取得條件檔；沒有回傳 null。 */
export function getProfile(ladderId) {
  return Object.hasOwn(profiles, ladderId) ? profiles[ladderId] : null;
}

/** 題目的 ladder_ids 之中有條件檔的那些（驗證器要求恰有一條）。 */
export function profilesFor(ladderIds) {
  return (Array.isArray(ladderIds) ? ladderIds : []).map(getProfile).filter(Boolean);
}

/**
 * 檢查一組 params 是否落在條件檔允許的範圍內；回傳可讀的錯誤清單（空陣列＝合格）。
 * 純函式；驗證器與產生器都用它，所以「內容包能過驗證」與「產生器願意出題」永遠一致。
 */
export function checkParams(profile, params) {
  const errors = [];
  if (!isPlainObject(params)) return ["params 必須是物件"];
  const known = new Set(["tiers", "weights", "operations", "shapes", "presentation", "scaffold", "context", "distinct", "context_pools"]);
  for (const k of Object.keys(params)) if (!known.has(k)) errors.push(`未知參數 ${JSON.stringify(k)}`);

  const tiers = params.tiers;
  if (!Array.isArray(tiers) || tiers.length === 0) errors.push("tiers 必須是至少一個檔位 id 的陣列");
  else {
    for (const t of tiers) if (!Object.hasOwn(profile.tiers, t)) errors.push(`檔位 ${JSON.stringify(t)} 不在條件檔 ${profile.ladder_id}（可用：${Object.keys(profile.tiers).join("、")}）`);
    if (new Set(tiers).size !== tiers.length) errors.push("tiers 不可重複");
  }
  const operations = params.operations;
  if (!Array.isArray(operations) || operations.length === 0 || !operations.every((o) => OPERATIONS.includes(o))) {
    errors.push("operations 必須是 add／sub 的非空陣列");
  } else if (Array.isArray(tiers)) {
    for (const t of tiers) {
      const def = profile.tiers[t];
      if (def && !operations.includes(def.operation)) errors.push(`檔位 ${t} 是 ${def.operation}，但 operations 沒有 ${def.operation}`);
    }
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
  const shapes = params.shapes;
  if (!Array.isArray(shapes) || shapes.length === 0) errors.push("shapes 必須是至少一個 [位數, 位數] 的陣列");
  else for (const s of shapes) if (!hasShape(profile.shapes.allowed, s)) errors.push(`形狀 ${JSON.stringify(s)} 不在條件檔允許的 ${JSON.stringify(profile.shapes.allowed)}`);
  if (!PRESENTATIONS.includes(params.presentation)) errors.push(`presentation 必須是 ${PRESENTATIONS.join("／")}`);
  if (!SCAFFOLDS.includes(params.scaffold)) errors.push(`scaffold 必須是 ${SCAFFOLDS.join("／")}`);
  if (typeof params.context !== "boolean") errors.push("context 必須是布林");
  if (typeof params.distinct !== "boolean") errors.push("distinct 必須是布林");
  if (params.context_pools !== undefined) {
    if (!isPlainObject(params.context_pools)) errors.push("context_pools 必須是物件");
    else {
      for (const [k, v] of Object.entries(params.context_pools)) {
        if (!CONTEXT_POOL_KEYS.includes(k)) errors.push(`context_pools 未知鍵 ${JSON.stringify(k)}（可用：${CONTEXT_POOL_KEYS.join("、")}）`);
        if (typeof v !== "string" || v.length === 0) errors.push(`context_pools.${k} 必須是池 id`);
      }
    }
  }
  return errors;
}

function mergeSettings(base, patch) {
  const out = { ...base };
  for (const k of ["tiers", "weights", "operations", "shapes", "count", "presentation", "context", "distinct"]) {
    if (patch[k] !== undefined) out[k] = structuredClone(patch[k]);
  }
  if (patch.scaffold !== undefined) {
    if (!isPlainObject(patch.scaffold)) throw new TypeError(`scaffold 覆寫必須是 { assess, practice } 物件（例如 { assess: "full" }），不是 ${JSON.stringify(patch.scaffold)}`);
    out.scaffold = { ...base.scaffold, ...patch.scaffold };
  }
  return out;
}

/**
 * 從條件檔推出一組完整 params（給 item.params）與 count（給 item.count）。
 * 處方層呼叫：adjustment 是五種調整之一（或省略＝不調整），overrides 是老師對預設的覆寫，mode 決定鷹架取 assess 還是 practice。
 * 回傳 { skip: true } 表示不適用，不出題。覆寫超出條件檔會丟 TypeError（內容錯誤）。
 */
export function resolveParams(profile, { adjustment, overrides = {}, mode = "assess", context_pools } = {}) {
  if (!isPlainObject(profile) || !isPlainObject(profile.defaults)) throw new TypeError("resolveParams: profile 不合法");
  if (!MODES.includes(mode)) throw new TypeError(`resolveParams: mode 必須是 ${MODES.join("／")}`);
  let settings = structuredClone(profile.defaults);
  if (adjustment !== undefined) {
    if (!ADJUSTMENTS.includes(adjustment)) throw new TypeError(`resolveParams: 未知調整 ${JSON.stringify(adjustment)}（可用：${ADJUSTMENTS.join("、")}）`);
    const adj = profile.adjustments[adjustment];
    if (adj.skip) return { skip: true, adjustment, label: adj.label };
    settings = mergeSettings(settings, adj);
  }
  if (!isPlainObject(overrides)) throw new TypeError("resolveParams: overrides 必須是物件");
  settings = mergeSettings(settings, overrides);
  // 調整或覆寫把 tiers 收窄後，權重只保留還在的檔位；缺的檔位權重 1。
  const weights = Object.fromEntries(settings.tiers.map((t) => [t, settings.weights?.[t] ?? 1]));
  // operations 若沒被覆寫，就跟著剩下的檔位走，避免「只開加法檔卻宣告加減」。
  const operations = overrides.operations ?? (adjustment && profile.adjustments[adjustment].operations) ?? [...new Set(settings.tiers.map((t) => profile.tiers[t]?.operation).filter(Boolean))];
  const params = {
    tiers: settings.tiers,
    weights,
    operations,
    shapes: settings.shapes,
    presentation: settings.presentation,
    scaffold: settings.scaffold[mode],
    context: settings.context,
    distinct: settings.distinct,
  };
  if (context_pools) params.context_pools = context_pools;
  const errors = checkParams(profile, params);
  if (errors.length) throw new TypeError(`resolveParams(${profile.ladder_id}): ${errors.join("；")}`);
  return { params, count: settings.count, adjustment: adjustment ?? null, mode };
}
