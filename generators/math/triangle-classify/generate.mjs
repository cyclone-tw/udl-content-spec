// 三角形分類（四年級 s-II-3#b@4，S-4-7）：看邊（等長記號或公分數）或看角，選出是哪一種三角形。
// 每一題：依權重按比例分配檔位 → 檔位內三種答案輪流 → 建三角形、隨機旋轉 → 輸出選擇題＋圖形描述。
// 不洩漏答案：按角分類不畫直角記號（用虛擬直角板比最大的角）；等腰只出「恰好 2 邊等長」，不考正三角形算不算等腰（課程手冊 S-4-7 說明）。
import { createRng } from "../../_prng.mjs";
import { checkParams } from "../../profiles/index.mjs";
import { substitute } from "../../_template.mjs";
import {
  allocate, shuffle, rotate, fit, triangleFromSides, triangleFromAngles, anglesOf, centroid, outsideLabelAt, dist, sub, add, round1,
} from "../_geometry.mjs";

export const id = "math.triangle-classify";
export const version = 1;
export const paramsSchemaPath = "generators/math/triangle-classify/params.schema.json";
export const MAX_ATTEMPTS_PER_ITEM = 1000;
export const itemType = () => "choice";

const ANSWERS = { sides: ["equilateral", "isosceles", "scalene"], angles: ["acute", "right", "obtuse"] };
const ROTATION_STEP = 15;
const SET_SQUARE_MM = 24;
const TICKS = { equilateral: [1, 1, 1], isosceles: [1, 0, 1], scalene: [1, 2, 3] };

const between = (rng, lo, hi) => lo + rng.next() * (hi - lo);
/** 有上限的重抽：try 回傳 null 就再抽，超過次數丟可讀的 RangeError（不會卡住）。 */
function retry(what, fn) {
  for (let i = 0; i < MAX_ATTEMPTS_PER_ITEM; i++) { const r = fn(); if (r) return r; }
  throw new RangeError(`${id}: ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到${what}；請放寬條件檔的範圍`);
}

/** 依答案建一個三角形（mm，頂點逆時針 A→B→C）；看邊的檔位回傳三邊長（AB、BC、CA），看角的回傳三個角。 */
function buildShape(rng, def, answer) {
  if (def.kind === "angles") {
    let A, B, C;
    if (answer === "right") { C = 90; A = rng.int(25, 65); B = 90 - A; }
    else if (answer === "obtuse") { C = rng.int(def.obtuse[0], def.obtuse[1]); A = rng.int(12, 180 - C - 12); B = 180 - C - A; }
    else [A, B, C] = retry("銳角三角形的三個角", () => { const a = rng.int(40, def.acute_max), b = rng.int(40, def.acute_max), c = 180 - a - b; return c >= 30 && c <= def.acute_max ? [a, b, c] : null; });
    // 最大的角不一定在 C：隨機換位置
    const order = shuffle([A, B, C], rng);
    const t = triangleFromAngles(order[0], order[1], order[2], 60);
    return { tri: t, label: order.join(",") };
  }
  if (def.show === "lengths") {
    const [lo, hi] = def.cm;
    const s = retry(`「${def.label}」的${answer}邊長`, () => {
      let t;
      if (answer === "equilateral") { const a = rng.int(lo, hi); t = [a, a, a]; }
      else if (answer === "isosceles") { const leg = rng.int(lo, hi), base = rng.int(lo, hi); if (base === leg) return null; t = [leg, base, leg]; }
      else { t = [rng.int(lo, hi), rng.int(lo, hi), rng.int(lo, hi)]; if (new Set(t).size < 3) return null; }
      const [a, b, c] = [...t].sort((x, y) => x - y);
      return a + b > c + 0.5 ? t : null; // 太扁的三角形不出
    });
    // 1 公分畫 10 mm：列印照實際尺寸，學生可以拿尺量
    return { tri: triangleFromSides(s[1] * 10, s[2] * 10, s[0] * 10), cm: s, label: s.join(",") };
  }
  const s = retry(`「${def.label}」的${answer}`, () => {
    let t;
    if (answer === "equilateral") { const a = between(rng, 36, 56); t = [a, a, a]; }
    else if (answer === "isosceles") {
      const leg = between(rng, 36, 56);
      const apex = rng.next() < 0.5 ? rng.int(30, 48) : rng.int(72, 110); // 避開看起來像正三角形的 50–70 度
      t = [leg, 2 * leg * Math.sin((apex * Math.PI) / 360), leg];
    } else {
      t = [between(rng, 30, 60), between(rng, 30, 60), between(rng, 30, 60)];
      const sorted = [...t].sort((x, y) => x - y);
      if (sorted[1] / sorted[0] < 1.15 || sorted[2] / sorted[1] < 1.15) return null; // 不等長要看得出來
    }
    const [a, b, c] = [...t].sort((x, y) => x - y);
    return a + b > c * 1.08 ? t : null;
  });
  return { tri: triangleFromSides(s[1], s[2], s[0]), label: s.map((x) => round1(x)).join(",") };
}

/**
 * 三角形的圖形描述。sides：AB、BC、CA 的等長記號；cm：在邊外標公分數；angles：三個角都畫角弧，最大的角放直角板。
 */
export function triangleFigure({ tri, rotation, ticks = null, cm = null, arcs = false, alt }) {
  const raw = { a: rotate(tri.A, rotation), b: rotate(tri.B, rotation), c: rotate(tri.C, rotation) };
  const g = centroid(Object.values(raw));
  const sides = [["ab", "a", "b"], ["bc", "b", "c"], ["ca", "c", "a"]];
  const labels = cm ? sides.map(([sid, p, q], i) => ({ id: `l-${sid}`, at: outsideLabelAt(raw[p], raw[q], g, 5), text: `${cm[i]} 公分`, say: `${cm[i]} 公分` })) : [];
  const extent = [...Object.values(raw), ...labels.flatMap((l) => [add(l.at, [-8, -3]), add(l.at, [8, 3])])];
  let setSquare = null;
  if (arcs) {
    const ang = anglesOf({ A: raw.a, B: raw.b, C: raw.c });
    const [vertex, from, to] = [["a", "b", "c"], ["b", "c", "a"], ["c", "a", "b"]][[ang.A, ang.B, ang.C].indexOf(Math.max(ang.A, ang.B, ang.C))];
    setSquare = { vertex, along: from, toward: to, size: SET_SQUARE_MM };
    const v = raw[vertex], u = sub(raw[from], v), l = Math.hypot(...u);
    const ua = [u[0] / l, u[1] / l];
    const t = sub(raw[to], v);
    const ccw = [ua[1], -ua[0]];
    const up = ccw[0] * t[0] + ccw[1] * t[1] >= 0 ? ccw : [-ccw[0], -ccw[1]];
    extent.push(add(v, ua, SET_SQUARE_MM), add(v, up, SET_SQUARE_MM));
  }
  const box = fit(extent, 4);
  const points = Object.fromEntries(Object.entries(raw).map(([k, p]) => [k, box.shift(p)]));
  return {
    version: 1,
    unit: "mm",
    width: box.width,
    height: box.height,
    points,
    segments: sides.map(([sid, p, q], i) => ({ id: sid, from: p, to: q, kind: "side", ...(ticks?.[i] ? { ticks: ticks[i] } : {}) })),
    ...(arcs ? { angles: [["at-a", "a", "b", "c"], ["at-b", "b", "c", "a"], ["at-c", "c", "a", "b"]].map(([aid, v, f, t]) => ({ id: aid, vertex: v, from: f, to: t, mark: "arc", radius: 5 })) } : {}),
    ...(labels.length ? { labels: labels.map((l) => ({ ...l, at: box.shift(l.at) })) } : {}),
    ...(setSquare ? { tools: { "set-square": setSquare } } : {}),
    alt,
  };
}

/** 錯誤選項的錯誤類型代碼（activities 內建表）。 */
export function misconceptionFor(kind, show, answer, chosen, { rotated }) {
  if (chosen === answer) return undefined;
  if (kind === "angles") return answer === "right" || chosen === "right" ? "angle-right-by-eye" : "triangle-largest-angle-misjudged";
  if (show === "lengths") return "triangle-side-lengths-misread";
  if (answer === "isosceles" && rotated && chosen === "scalene") return "triangle-orientation";
  return "triangle-equal-sides-miscount";
}

/**
 * @param {object} o
 * @param {object} o.params  已通過 checkParams 的參數（tiers、weights、overlay、rotate、distinct）
 */
export function generate({ params, seed, count, profile }) {
  if (!profile || typeof profile !== "object") throw new TypeError(`${id}: 需要條件檔；item.ladder_ids 必須含一條已登錄條件檔的能力指標`);
  if (profile.generator !== id) throw new TypeError(`${id}: 條件檔 ${profile.ladder_id} 指定的產生器是 ${profile.generator}`);
  const errors = checkParams(profile, params);
  if (errors.length) throw new TypeError(`${id}: ${errors.join("；")}`);
  if (!Number.isInteger(count) || count < 1) throw new TypeError(`${id}: count 必須是 ≥ 1 的整數`);

  const rng = createRng(`${id}|${String(seed)}`);
  const plan = [];
  for (const { tier, n } of allocate(params.tiers, params.weights, count)) {
    const answers = ANSWERS[profile.tiers[tier].kind];
    const start = rng.int(0, answers.length - 1);
    for (let k = 0; k < n; k++) plan.push({ tier, answer: answers[(start + k) % answers.length] });
  }
  const seen = new Set();
  const out = [];
  for (const { tier, answer } of shuffle(plan, rng)) {
    const def = profile.tiers[tier];
    let found = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ITEM && !found; attempt++) {
      const shape = buildShape(rng, def, answer);
      const rotation = params.rotate ? rng.int(0, 360 / ROTATION_STEP - 1) * ROTATION_STEP : 0;
      const key = `${tier}|${shape.label}|${rotation}`;
      if (params.distinct && seen.has(key)) continue;
      seen.add(key);
      found = { ...shape, rotation };
    }
    if (!found) throw new RangeError(`${id}: 第 ${out.length + 1} 題在 ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到不重複的三角形（檔位「${def.label}」）；請放寬檔位、打開旋轉或減少 count`);
    const { tri, cm, rotation } = found;
    const rotated = rotation % 360 !== 0;
    const figure = triangleFigure({
      tri, rotation,
      ticks: def.kind === "sides" && def.show === "marks" ? TICKS[answer] : null,
      cm: def.kind === "sides" && def.show === "lengths" ? cm : null,
      arcs: def.kind === "angles",
      alt: profile.alt[def.kind === "angles" ? "angles" : def.show],
    });
    const lens = [dist(tri.A, tri.B), dist(tri.B, tri.C), dist(tri.C, tri.A)].map(round1);
    const ang = anglesOf(tri);
    const vars = {
      tier, kind: def.kind, answer_key: answer, rotation, reason: profile.reasons[answer],
      sides_mm: lens.join(","), angles: [ang.A, ang.B, ang.C].map((x) => Math.round(x)).join(","), ...(cm ? { sides_cm: cm.join(",") } : {}),
    };
    const options = ANSWERS[def.kind].map((oid) => {
      const code = misconceptionFor(def.kind, def.show, answer, oid, { rotated });
      return { id: oid, text: { text: profile.option_text[oid], audio: null }, ...(code ? { misconception: code } : {}) };
    });
    out.push({
      type: "choice",
      tier,
      variables: vars,
      stem: { text: { text: profile.stems[def.kind], audio: null } },
      options,
      answer,
      shuffle: false,
      hints: profile.hints[tier].map((t) => ({ text: substitute(t, vars), audio: null })),
      feedback: {
        correct: { text: substitute(profile.feedback.correct, vars), audio: null },
        retry: { text: substitute(def.retry, vars), audio: null },
      },
      display: { figure, ...(figure.tools ? { overlay: params.overlay } : {}) },
    });
  }
  return out;
}
