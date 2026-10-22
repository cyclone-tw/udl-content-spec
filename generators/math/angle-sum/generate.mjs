// 平角、周角與角的合成分解（四年級 s-II-4#b@4，S-4-2）：圖上標已知角的度數，求「？」的角，用數字鍵填。
// 檔位：一直線上的兩個角（180 減）、轉一整圈（360 減）、兩個角合起來（相加）、大角分成兩個角（相減）。
// 結果不超過 360 度（S-4-2 備註）；角度是 step 的倍數。
import { createRng } from "../../_prng.mjs";
import { checkParams } from "../../profiles/index.mjs";
import { substitute } from "../../_template.mjs";
import { allocate, shuffle, dir, fit, pickStep, add } from "../_geometry.mjs";

export const id = "math.angle-sum";
export const version = 1;
export const paramsSchemaPath = "generators/math/angle-sum/params.schema.json";
export const MAX_ATTEMPTS_PER_ITEM = 1000;
export const itemType = () => "numeric";

const RAY_MM = 40;
const SMALL_R = 8;
const BIG_R = 16;
const LABEL_HALF = 4.5; // 標示大約半寬（mm），用來推開小角的標示，不壓到邊
const ROTATION_STEP = 15;

/** 抽這一題的角：回傳 { x, y?, z?, answer, rays: 相對底邊的方向（度）, angles: [{from, to, ask}] }。 */
function draw(rng, def) {
  const s = def.step;
  if (def.kind === "straight-minus") {
    const x = pickStep(rng, def.min, def.max, s);
    return { x, answer: 180 - x, rays: { a: 0, b: x, c: 180 }, angles: [["a", "b", false], ["b", "c", true]] };
  }
  if (def.kind === "full-minus") {
    const x = pickStep(rng, def.min, def.max, s);
    return { x, answer: 360 - x, rays: { a: 0, b: x }, angles: [["a", "b", false], ["b", "a", true]] };
  }
  if (def.kind === "add") {
    const x = pickStep(rng, def.min, def.max, s);
    const y = pickStep(rng, def.min, Math.min(def.max, def.total_max - x), s);
    return { x, y, answer: x + y, rays: { a: 0, b: x, c: x + y }, angles: [["a", "b", false], ["b", "c", false], ["a", "c", true]] };
  }
  const z = pickStep(rng, def.min, def.max, s);
  const x = pickStep(rng, Math.max(def.part_min, s), z - def.part_min, s);
  return { x, z, answer: z - x, rays: { a: 0, b: x, c: z }, angles: [["a", "c", false], ["a", "b", false], ["b", "c", true]] };
}

/** 圖形描述：從頂點畫出各條邊，已知角標度數、要求的角標「？」（半徑大一點，分得出來）。 */
export function sumFigure({ rays, angles, values, base, alt }) {
  const raw = { v: [0, 0] };
  for (const [k, deg] of Object.entries(rays)) raw[k] = dir(base + deg).map((x) => x * RAY_MM);
  const labels = [];
  const marks = angles.map(([from, to, ask], i) => {
    let span = rays[to] - rays[from];
    span = ((span % 360) + 360) % 360 || 360;
    // 包住別的角的大角（相加的「？」、相減的已知大角）畫在外圈，其他畫內圈；小角的標示往外推，不壓到邊。
    const outer = angles.length === 3 && from === "a" && to === "c";
    const r = outer ? BIG_R : SMALL_R;
    const mid = base + rays[from] + span / 2;
    const clear = LABEL_HALF / Math.sin((Math.min(span, 180) * Math.PI) / 360);
    const at = add([0, 0], dir(mid), Math.max(r + 5, clear));
    labels.push({ id: `l-${from}${to}`, at, text: ask ? "？" : `${values[i]}°`, say: ask ? "問號" : `${values[i]} 度` });
    return { id: `ang-${from}${to}`, vertex: "v", from, to, mark: "arc", radius: r };
  });
  const extent = [...Object.values(raw), ...labels.flatMap((l) => [add(l.at, [-5, -3]), add(l.at, [5, 3])])];
  const box = fit(extent, 4);
  return {
    version: 1,
    unit: "mm",
    width: box.width,
    height: box.height,
    points: Object.fromEntries(Object.entries(raw).map(([k, p]) => [k, box.shift(p)])),
    segments: Object.keys(rays).map((k) => ({ id: `ray-${k}`, from: "v", to: k, kind: "ray" })),
    angles: marks,
    labels: labels.map((l) => ({ ...l, at: box.shift(l.at) })),
    alt,
  };
}

export function generate({ params, seed, count, profile }) {
  if (!profile || typeof profile !== "object") throw new TypeError(`${id}: 需要條件檔；item.ladder_ids 必須含一條已登錄條件檔的能力指標`);
  if (profile.generator !== id) throw new TypeError(`${id}: 條件檔 ${profile.ladder_id} 指定的產生器是 ${profile.generator}`);
  const errors = checkParams(profile, params);
  if (errors.length) throw new TypeError(`${id}: ${errors.join("；")}`);
  if (!Number.isInteger(count) || count < 1) throw new TypeError(`${id}: count 必須是 ≥ 1 的整數`);

  const rng = createRng(`${id}|${String(seed)}`);
  const plan = allocate(params.tiers, params.weights, count).flatMap(({ tier, n }) => Array(n).fill(tier));
  const seen = new Set();
  const out = [];
  for (const tier of shuffle(plan, rng)) {
    const def = profile.tiers[tier];
    let found = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ITEM && !found; attempt++) {
      const d = draw(rng, def);
      const key = `${tier}|${d.x}|${d.y ?? ""}|${d.z ?? ""}`;
      if (params.distinct && seen.has(key)) continue;
      seen.add(key);
      found = d;
    }
    if (!found) throw new RangeError(`${id}: 第 ${out.length + 1} 題在 ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到不重複的角（檔位「${def.label}」）；請放寬範圍或減少 count`);
    const d = found;
    const base = params.rotate ? rng.int(0, 360 / ROTATION_STEP - 1) * ROTATION_STEP : 0;
    const known = def.kind === "add" ? [d.x, d.y] : def.kind === "sub" ? [d.z, d.x] : [d.x];
    const values = d.angles.map(([, , ask], i) => (ask ? null : known[i]));
    const vars = { tier, kind: def.kind, x: d.x, ...(d.y !== undefined ? { y: d.y } : {}), ...(d.z !== undefined ? { z: d.z } : {}), answer: d.answer, rotation: base };
    out.push({
      type: "numeric",
      tier,
      variables: vars,
      stem: { text: { text: substitute(profile.stems[def.kind], vars), audio: null } },
      answer: d.answer,
      tolerance: { type: "nominal", value: 0 },
      input: { min: 0, max: 360, decimals: 0 },
      unit_label: "度",
      hints: profile.hints[tier].map((t) => ({ text: substitute(t, vars), audio: null })),
      feedback: {
        correct: { text: substitute(profile.feedback.correct, vars), audio: null },
        retry: { text: substitute(profile.feedback.retry, vars), audio: null },
      },
      display: { figure: sumFigure({ rays: d.rays, angles: d.angles, values, base, alt: profile.alt[def.kind] }) },
    });
  }
  return out;
}
