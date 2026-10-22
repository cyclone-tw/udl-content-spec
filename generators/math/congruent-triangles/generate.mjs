// 全等與對應（四年級 S-4-6）：
// - s-II-2#a@4 找全等：一張圖放「甲」與 ①–④，只有一個和甲全等（轉過，或翻面再轉過）；其他是放大縮小、改了一個邊、改了一個角。
// - s-II-2#b@4 找對應：甲（ㄅㄆㄇ）和乙（ㄉㄊㄋ）全等，乙轉過（或翻面），問某條邊或某個角對應到乙的哪一個。
// 選項是文字（①–④、ㄉㄊ、∠ㄉ），外殼不必畫選項圖。S-4-6 備註：平移、旋轉、翻轉是描述操作，不做名詞教學；題目與提示只說「轉一轉、翻過來」。
import { createRng } from "../../_prng.mjs";
import { checkParams } from "../../profiles/index.mjs";
import { substitute } from "../../_template.mjs";
import { allocate, shuffle, rotate, mirror, triangleFromSides, centroid, vertexLabelAt, dist, add, fit } from "../_geometry.mjs";

export const id = "math.congruent-triangles";
export const version = 1;
export const paramsSchemaPath = "generators/math/congruent-triangles/params.schema.json";
export const MAX_ATTEMPTS_PER_ITEM = 1000;
export const itemType = () => "choice";

const CELL = 44;
const MARKS = ["①", "②", "③", "④"];
const NAMES_A = ["ㄅ", "ㄆ", "ㄇ"];
const NAMES_B = ["ㄉ", "ㄊ", "ㄋ"];

const between = (rng, lo, hi) => lo + rng.next() * (hi - lo);

/** 一個看得出三邊不同長的三角形（mm）：最長邊約 longest。 */
function scalene(rng, longest) {
  for (;;) {
    const s = [between(rng, 0.55, 0.95) * longest, between(rng, 0.55, 0.95) * longest, longest];
    const sorted = [...s].sort((x, y) => x - y);
    if (sorted[1] / sorted[0] < 1.15 || sorted[2] / sorted[1] < 1.12 || sorted[0] + sorted[1] < sorted[2] * 1.15) continue;
    const t = triangleFromSides(s[0], s[1], s[2]);
    return [t.A, t.B, t.C];
  }
}

/** 三個點以重心為中心轉 deg 度，必要時先左右翻面。 */
function place(pts, deg, flip) {
  const g = centroid(pts);
  return pts.map((p) => { const q = [p[0] - g[0], p[1] - g[1]]; return rotate(flip ? mirror(q) : q, deg); });
}

const sideLens = (pts) => [dist(pts[0], pts[1]), dist(pts[1], pts[2]), dist(pts[2], pts[0])].sort((x, y) => x - y);
/** 兩個三角形形狀或大小是否明顯不同（排序後的邊長差超過 12%）。 */
const clearlyDifferent = (p, q) => sideLens(p).some((l, i) => Math.abs(l - sideLens(q)[i]) / l > 0.12);

/** 干擾項：放大或縮小、改一個邊、改一個角。 */
function distractor(rng, kind, base) {
  if (kind === "scaled") { const k = rng.next() < 0.5 ? 1.3 : 0.75; return base.map((p) => [p[0] * k, p[1] * k]); }
  if (kind === "side") { const out = base.map((p) => [...p]); const k = rng.next() < 0.5 ? 1.3 : 0.75; out[1] = [out[0][0] + (out[1][0] - out[0][0]) * k, out[0][1] + (out[1][1] - out[0][1]) * k]; return out; }
  const out = base.map((p) => [...p]);
  out[2] = add(out[2], [between(rng, 5, 8) * (rng.next() < 0.5 ? -1 : 1), between(rng, 3, 6)]);
  return out;
}

/** 多個三角形放進一張圖：cells 是 [{ key, pts, at: [col,row], name, vertexNames? }]。 */
function multiFigure(cells, { alt }) {
  const points = {};
  const segments = [];
  const labels = [];
  const extent = [];
  for (const c of cells) {
    const cx = c.at[0] * CELL + CELL / 2, cy = c.at[1] * CELL + CELL / 2;
    const pts = c.pts.map((p) => [p[0] + cx, p[1] + cy]);
    const g = centroid(pts);
    pts.forEach((p, i) => { points[`${c.key}${i}`] = p; extent.push(p); });
    [[0, 1], [1, 2], [2, 0]].forEach(([i, j]) => segments.push({ id: `${c.key}-s${i}${j}`, from: `${c.key}${i}`, to: `${c.key}${j}`, kind: "side" }));
    const tag = [c.at[0] * CELL + 5, c.at[1] * CELL + 5];
    labels.push({ id: `${c.key}-name`, at: tag, text: c.name, say: c.say ?? c.name });
    extent.push(add(tag, [-3, -3]), add(tag, [3, 3]));
    (c.vertexNames ?? []).forEach((n, i) => {
      const at = vertexLabelAt(pts[i], g, 4.5);
      labels.push({ id: `${c.key}-v${i}`, at, text: n });
      extent.push(add(at, [-3, -3]), add(at, [3, 3]));
    });
  }
  const box = fit(extent, 3);
  return {
    version: 1, unit: "mm", width: box.width, height: box.height,
    points: Object.fromEntries(Object.entries(points).map(([k, p]) => [k, box.shift(p)])),
    segments,
    labels: labels.map((l) => ({ ...l, at: box.shift(l.at) })),
    alt,
  };
}

function findQuestion(rng, def, profile, rotateOn) {
  const base = scalene(rng, 30);
  const spin = () => (rotateOn ? rng.int(1, 23) * 15 : 0);
  const kinds = shuffle(["scaled", "side", "angle"], rng);
  const wrongs = [];
  for (const kind of kinds) {
    let d;
    for (let k = 0; k < 50; k++) { d = distractor(rng, kind, base); if (clearlyDifferent(d, base) && wrongs.every((w) => clearlyDifferent(w.pts, d))) break; }
    wrongs.push({ kind, pts: place(d, spin(), rng.next() < 0.5) });
  }
  const right = { kind: "congruent", pts: place(base, spin() || 90, def.flip) };
  const order = shuffle([right, ...wrongs], rng);
  const answerIndex = order.indexOf(right);
  const cells = [
    // 甲在左邊中間，①–④ 在右邊排兩列：圖不會太寬，平板上字也看得清楚
    { key: "t", pts: place(base, 0, false), at: [0, 0.5], name: "甲" },
    ...order.map((o, i) => ({ key: `c${i}`, pts: o.pts, at: [1 + (i % 2), Math.floor(i / 2)], name: MARKS[i], say: `第 ${i + 1} 個` })),
  ];
  const options = order.map((o, i) => ({
    id: `c${i + 1}`,
    text: { text: MARKS[i], audio: null },
    ...(o.kind === "scaled" ? { misconception: "congruent-size-ignored" } : o.kind !== "congruent" ? { misconception: "congruent-shape-by-eye" } : {}),
  }));
  return {
    figure: multiFigure(cells, { alt: profile.alt.find }),
    options, answer: `c${answerIndex + 1}`,
    vars: { answer_label: MARKS[answerIndex], flip: def.flip, distractors: order.map((o) => o.kind).join(",") },
    stem: profile.stems.find,
  };
}

function correspondQuestion(rng, def, profile, rotateOn) {
  const base = scalene(rng, 34);
  const flip = rng.next() < 0.5;
  const deg = rotateOn ? rng.int(2, 22) * 15 : 180;
  // 乙的第 i 個頂點對應甲的第 perm[i] 個：頂點名字照乙自己的順序標，所以和甲的位置對不起來。
  const moved = place(base, deg, flip);
  const perm = shuffle([0, 1, 2], rng);
  const bPts = perm.map((k) => moved[k]);
  const nameOfB = Object.fromEntries(perm.map((k, i) => [k, NAMES_B[i]])); // 甲的第 k 個頂點 → 乙的名字
  const cells = [
    { key: "a", pts: place(base, 0, false), at: [0, 0], name: "甲", vertexNames: NAMES_A },
    { key: "b", pts: bPts, at: [1.25, 0], name: "乙", vertexNames: NAMES_B },
  ];
  let options, answer, asked, answerText;
  if (def.ask === "side") {
    const [i, j] = [[0, 1], [1, 2], [2, 0]][rng.int(0, 2)];
    asked = `${NAMES_A[i]}${NAMES_A[j]}`;
    const target = new Set([nameOfB[i], nameOfB[j]]);
    const sides = [["ㄉ", "ㄊ"], ["ㄊ", "ㄋ"], ["ㄋ", "ㄉ"]];
    options = sides.map(([p, q], n) => ({ id: `s${n + 1}`, text: { text: `${p}${q}`, audio: null } }));
    const hit = sides.findIndex(([p, q]) => target.has(p) && target.has(q));
    answer = `s${hit + 1}`;
    answerText = `${sides[hit][0]}${sides[hit][1]}`;
  } else {
    const i = rng.int(0, 2);
    asked = `∠${NAMES_A[i]}`;
    options = NAMES_B.map((n, k) => ({ id: `v${k + 1}`, text: { text: `∠${n}`, audio: null } }));
    answer = `v${NAMES_B.indexOf(nameOfB[i]) + 1}`;
    answerText = `∠${nameOfB[i]}`;
  }
  // 照擺放位置對（同一個位置的名字）就是沒有轉一轉
  options = options.map((o) => (o.id === answer ? o : { ...o, misconception: "correspondence-by-position" }));
  return {
    figure: multiFigure(cells, { alt: profile.alt.correspond }),
    options, answer,
    vars: { asked, asked_say: asked.replace("∠", "角"), answer_text: answerText, flip, rotation: deg },
    stem: profile.stems[def.ask],
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
  const out = [];
  for (const tier of shuffle(plan, rng)) {
    const def = profile.tiers[tier];
    const q = def.kind === "find" ? findQuestion(rng, def, profile, params.rotate) : correspondQuestion(rng, def, profile, params.rotate);
    const vars = { tier, ...q.vars };
    out.push({
      type: "choice",
      tier,
      variables: vars,
      stem: { text: { text: substitute(q.stem, vars), audio: null } },
      options: q.options,
      answer: q.answer,
      shuffle: false,
      hints: profile.hints[tier].map((t) => ({ text: substitute(t, vars), audio: null })),
      feedback: {
        correct: { text: substitute(profile.feedback[def.kind].correct, vars), audio: null },
        retry: { text: substitute(profile.feedback[def.kind].retry, vars), audio: null },
      },
      display: { figure: q.figure },
    });
  }
  return out;
}
