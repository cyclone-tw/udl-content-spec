// 用量角器量角（四年級 n-II-9#b@4，S-4-1／N-4-10）：圖上疊虛擬量角器，用數字鍵填度數，容許誤差 ±2 度。
// 檔位決定 0 度線在哪：右邊（從右邊的 0 往上數）、左邊（從左邊的 0 往上數，課程手冊要求左右兩側都要量）、
// 兩邊都不在 0 刻度（讀兩邊的刻度再相減）。角度是 5 的倍數。
import { createRng } from "../../_prng.mjs";
import { checkParams } from "../../profiles/index.mjs";
import { substitute } from "../../_template.mjs";
import { allocate, shuffle, dir, fit, pickStep, add } from "../_geometry.mjs";

export const id = "math.angle-measure";
export const version = 1;
export const paramsSchemaPath = "generators/math/angle-measure/params.schema.json";
export const MAX_ATTEMPTS_PER_ITEM = 1000;
export const itemType = () => "numeric";

const RAY_MM = 46;
const PROTRACTOR_MM = 38;
const TILTS = [-15, -10, -5, 0, 5, 10, 15];

/**
 * 量角的圖形描述。base：底線方向（數學角度）；start／end：兩邊相對底線的度數（往 toward 那側數）；clockwise：角開在順時針那側（0 度線在左邊）。
 * 兩邊都不在 0 刻度時 start > 0，底線點 z 不畫，只給量角器對齊。
 */
export function measureFigure({ base, start, end, clockwise, alt }) {
  const sign = clockwise ? -1 : 1;
  const raw = { v: [0, 0], a: dir(base + sign * start).map((x) => x * RAY_MM), b: dir(base + sign * end).map((x) => x * RAY_MM) };
  if (start > 0) raw.z = dir(base).map((x) => x * RAY_MM);
  // 量角器半圓會到的範圍（往 toward 那側的半圓）
  const extent = [...Object.values(raw)];
  for (let d = 0; d <= 180; d += 15) extent.push(dir(base + sign * d).map((x) => x * (PROTRACTOR_MM + 1)));
  extent.push(add([0, 0], dir(base + 180), PROTRACTOR_MM + 1));
  const box = fit(extent, 4);
  const points = Object.fromEntries(Object.entries(raw).map(([k, p]) => [k, box.shift(p)]));
  // 角的方向：逆時針從 from 到 to
  const [from, to] = clockwise ? ["b", "a"] : ["a", "b"];
  return {
    version: 1,
    unit: "mm",
    width: box.width,
    height: box.height,
    points,
    segments: [{ id: "ray-a", from: "v", to: "a", kind: "ray" }, { id: "ray-b", from: "v", to: "b", kind: "ray" }],
    angles: [{ id: "angle", vertex: "v", from, to, mark: "arc", radius: 7 }],
    tools: { protractor: { vertex: "v", along: start > 0 ? "z" : "a", toward: "b", radius: PROTRACTOR_MM } },
    alt,
  };
}

/**
 * @param {object} o
 * @param {object} o.params  已通過 checkParams 的參數（tiers、weights、overlay、distinct）
 */
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
      const angle = pickStep(rng, def.min, def.max, def.step);
      const start = def.zero === "off" ? pickStep(rng, def.offset[0], Math.min(def.offset[1], 180 - angle - def.step), def.step) : 0;
      if (start + angle > 180 - (def.zero === "off" ? def.step : 0)) continue;
      const tilt = TILTS[rng.int(0, TILTS.length - 1)];
      const key = `${angle}|${start}|${def.zero}`;
      if (params.distinct && seen.has(key)) continue;
      seen.add(key);
      found = { angle, start, tilt };
    }
    if (!found) throw new RangeError(`${id}: 第 ${out.length + 1} 題在 ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到不重複的角（檔位「${def.label}」）；請放寬範圍或減少 count`);
    const { angle, start, tilt } = found;
    const clockwise = def.zero === "left";
    const base = (clockwise ? 180 : 0) + tilt;
    const vars = { tier, angle, start, end: start + angle, zero: def.zero, side: clockwise ? "左" : "右", tilt, wrong_scale: 180 - angle };
    out.push({
      type: "numeric",
      tier,
      variables: vars,
      stem: { text: { text: substitute(profile.stems[def.zero], vars), audio: null } },
      answer: angle,
      tolerance: { type: "nominal", value: profile.tolerance },
      input: { min: 0, max: 180, decimals: 0 },
      unit_label: "度",
      hints: profile.hints[tier].map((t) => ({ text: substitute(t, vars), audio: null })),
      feedback: {
        correct: { text: substitute(profile.feedback.correct, vars), audio: null },
        retry: { text: substitute(profile.feedback.retry, vars), audio: null },
      },
      display: { figure: measureFigure({ base, start, end: start + angle, clockwise, alt: profile.alt }), overlay: params.overlay },
    });
  }
  return out;
}
