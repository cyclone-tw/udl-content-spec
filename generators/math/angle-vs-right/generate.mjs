// 和直角比：畫一個角，問比直角小、一樣大還是比直角大（三年級 n-II-9#b@3）。
// 每一題：依權重按比例分配檔位 → 在檔位的角度範圍之間輪流抽度數 → 隨機旋轉、兩邊長短、角弧大小 → 輸出選擇題＋圖形描述。
// 圖上不標度數（三年級不談度），所有角都畫角弧，直角也不畫直角記號，免得記號洩漏答案。
import { createRng } from "../../_prng.mjs";
import { checkParams } from "../../profiles/index.mjs";
import { substitute } from "../../_template.mjs";

export const id = "math.angle-vs-right";
export const version = 1;
export const paramsSchemaPath = "generators/math/angle-vs-right/params.schema.json";
export const MAX_ATTEMPTS_PER_ITEM = 1000;

/** 這個產生器出的題型（activities 的技能練習照它建題目）。 */
export const itemType = () => "choice";

export const DEFAULT_ALT = "一個角：兩條邊從同一個頂點出發。可以放上直角板比一比。";
const SET_SQUARE_MM = 30;
const MARGIN_MM = 4;
const ROTATION_STEP = 15;

const round1 = (x) => Math.round(x * 10) / 10;
const answerKey = (angle) => (angle < 90 ? "smaller" : angle > 90 ? "larger" : "same");

/** 題數依權重按比例分配（最大餘數法）；餘數相同時照 tiers 順序。回傳 [{ tier, n }]。 */
export function allocate(tiers, weights, count) {
  const w = tiers.map((t) => weights?.[t] ?? 1);
  const total = w.reduce((s, x) => s + x, 0);
  const quota = w.map((x) => (x / total) * count);
  const base = quota.map(Math.floor);
  let left = count - base.reduce((s, x) => s + x, 0);
  const order = quota.map((q, i) => [q - Math.floor(q), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    base[i]++;
    left--;
  }
  return tiers.map((tier, i) => ({ tier, n: base[i] }));
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 畫面方向（y 向下）的單位向量；deg 是數學角度（逆時針）。 */
const dir = (deg) => [Math.cos((deg * Math.PI) / 180), -Math.sin((deg * Math.PI) / 180)];

/**
 * 角的圖形描述（schema/figure.schema.json）。頂點 v、邊上的點 a（起邊）與 b（終邊），從 a 逆時針轉 angle 度到 b。
 * 畫布已包含直角板疊上去的範圍，疊圖開關不會讓圖跳動。
 */
export function angleFigure({ angle, rotation, rayA, rayB, arc, alt = DEFAULT_ALT }) {
  const ua = dir(rotation);
  const ub = dir(rotation + angle);
  const up = dir(rotation + 90); // 直角板另一條直角邊：往終邊那一側
  const raw = {
    v: [0, 0],
    a: [ua[0] * rayA, ua[1] * rayA],
    b: [ub[0] * rayB, ub[1] * rayB],
  };
  const extent = [...Object.values(raw), [ua[0] * SET_SQUARE_MM, ua[1] * SET_SQUARE_MM], [up[0] * SET_SQUARE_MM, up[1] * SET_SQUARE_MM]];
  const minX = Math.min(...extent.map((p) => p[0]));
  const minY = Math.min(...extent.map((p) => p[1]));
  const maxX = Math.max(...extent.map((p) => p[0]));
  const maxY = Math.max(...extent.map((p) => p[1]));
  const points = Object.fromEntries(Object.entries(raw).map(([k, [x, y]]) => [k, [round1(x - minX + MARGIN_MM), round1(y - minY + MARGIN_MM)]]));
  return {
    version: 1,
    unit: "mm",
    width: round1(maxX - minX + 2 * MARGIN_MM),
    height: round1(maxY - minY + 2 * MARGIN_MM),
    points,
    segments: [
      { id: "ray-a", from: "v", to: "a", kind: "ray" },
      { id: "ray-b", from: "v", to: "b", kind: "ray" },
    ],
    angles: [{ id: "angle", vertex: "v", from: "a", to: "b", mark: "arc", radius: arc }],
    tools: { "set-square": { vertex: "v", along: "a", toward: "b", size: SET_SQUARE_MM } },
    alt,
  };
}

/** 錯誤選項的錯誤類型代碼（activities 內建表）。 */
export function misconceptionFor(answer, chosen, { misleading, rotated }) {
  if (chosen === answer) return undefined;
  if (answer === "same" || answer === "yes") return rotated ? "angle-right-orientation" : "angle-right-by-eye";
  if (chosen === "same" || chosen === "yes") return "angle-right-by-eye";
  return misleading ? "angle-by-ray-length" : "angle-compare-reversed";
}

/** 兩邊長與角弧：vary_rays 時三分之一的題目故意誤導（小角配長邊與大弧、大角配短邊與小弧）。 */
function raysFor(rng, key, vary) {
  if (!vary) return { rayA: 34, rayB: 34, arc: 8, misleading: false };
  const misleading = key !== "same" && rng.int(0, 2) === 0;
  if (misleading && key === "smaller") return { rayA: rng.int(38, 45), rayB: rng.int(38, 45), arc: rng.int(10, 12), misleading };
  if (misleading && key === "larger") return { rayA: rng.int(22, 27), rayB: rng.int(22, 27), arc: rng.int(6, 7), misleading };
  return { rayA: rng.int(24, 44), rayB: rng.int(24, 44), arc: rng.int(6, 12), misleading: false };
}

/**
 * @param {object} o
 * @param {object} o.params   已通過 checkParams 的參數（tiers、weights、choices、overlay、rotate、vary_rays、distinct）
 * @param {string} o.seed
 * @param {number} o.count
 * @param {object} o.profile  條件檔（由 instantiate 依 item.ladder_ids 找到後傳入）
 */
export function generate({ params, seed, count, profile }) {
  if (!profile || typeof profile !== "object") throw new TypeError(`${id}: 需要條件檔；item.ladder_ids 必須含一條已登錄條件檔的能力指標`);
  if (profile.generator !== id) throw new TypeError(`${id}: 條件檔 ${profile.ladder_id} 指定的產生器是 ${profile.generator}`);
  const errors = checkParams(profile, params);
  if (errors.length) throw new TypeError(`${id}: ${errors.join("；")}`);
  if (!Number.isInteger(count) || count < 1) throw new TypeError(`${id}: count 必須是 ≥ 1 的整數`);

  const rng = createRng(`${id}|${String(seed)}`);
  // 每個檔位的題數照權重分好，檔位內的範圍輪流（從隨機一個開始），最後整批洗牌。
  const plan = [];
  for (const { tier, n } of allocate(params.tiers, params.weights, count)) {
    const ranges = profile.tiers[tier].ranges;
    const start = rng.int(0, ranges.length - 1);
    for (let k = 0; k < n; k++) plan.push({ tier, range: ranges[(start + k) % ranges.length] });
  }
  const seen = new Set();
  const out = [];
  for (const { tier, range } of shuffle(plan, rng)) {
    let found = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ITEM && !found; attempt++) {
      const angle = rng.int(range[0], range[1]);
      const rotation = params.rotate ? rng.int(0, 360 / ROTATION_STEP - 1) * ROTATION_STEP : 0;
      const key = `${angle}|${rotation}`;
      if (params.distinct && seen.has(key)) continue;
      seen.add(key);
      found = { angle, rotation };
    }
    if (!found) {
      throw new RangeError(
        `${id}: 第 ${out.length + 1} 題在 ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到不重複的角（檔位「${profile.tiers[tier].label}」，範圍 ${range.join("–")} 度` +
          (params.rotate ? "" : "，沒有旋轉") + "）；請放寬檔位、打開旋轉、關掉 distinct 或減少 count",
      );
    }
    const { angle, rotation } = found;
    const answer = answerKey(angle);
    const shape = raysFor(rng, answer, params.vary_rays);
    const rotated = rotation % 90 !== 0;
    const vars = {
      angle, rotation, ray_a: shape.rayA, ray_b: shape.rayB, arc: shape.arc, misleading: shape.misleading,
      answer_key: answer, relation: profile.relation[answer], name_sentence: profile.names[answer], tier, choices: params.choices,
    };
    const optionIds = params.choices === "three" ? ["smaller", "same", "larger"] : ["yes", "no"];
    const correct = params.choices === "three" ? answer : answer === "same" ? "yes" : "no";
    const options = optionIds.map((oid) => {
      const code = misconceptionFor(correct, oid, { misleading: shape.misleading, rotated });
      return { id: oid, text: { text: profile.option_text[oid], audio: null }, ...(code ? { misconception: code } : {}) };
    });
    out.push({
      type: "choice",
      tier,
      variables: vars,
      stem: { text: { text: profile.stems[params.choices], audio: null } },
      options,
      answer: correct,
      shuffle: false,
      hints: profile.hints[tier].map((t) => ({ text: substitute(t, vars), audio: null })),
      feedback: {
        correct: { text: substitute(profile.feedback.correct, vars), audio: null },
        retry: { text: substitute(profile.feedback.retry, vars), audio: null },
      },
      display: { figure: angleFigure({ angle, rotation, ...shape, alt: profile.alt ?? DEFAULT_ALT }), overlay: params.overlay },
    });
  }
  return out;
}
