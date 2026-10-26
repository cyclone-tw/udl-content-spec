// 幾何產生器共用：建三角形、旋轉、把點搬進畫布（mm、y 向下），以及標示文字的位置。
// 純函式；角度用「數學上的逆時針度數」，換到畫面座標時 y 取負。

export const round1 = (x) => Math.round(x * 10) / 10;
const rad = (deg) => (deg * Math.PI) / 180;

/** 畫面方向（y 向下）的單位向量。 */
export const dir = (deg) => [Math.cos(rad(deg)), -Math.sin(rad(deg))];
export const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
export const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
export const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/** 繞原點轉 deg 度（數學逆時針）。 */
export function rotate(p, deg) {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  // 畫面座標：數學上的 (x, -y)
  const x = p[0], y = -p[1];
  return [x * c - y * s, -(x * s + y * c)];
}

/** 鏡射（左右翻面）。 */
export const mirror = (p) => [-p[0], p[1]];

/**
 * 三邊長 a=BC、b=CA、c=AB（mm）建三角形，A 在原點、B 在右邊，C 在上方（畫面上 y 為負）。
 * 回傳 { A, B, C }，頂點依逆時針排列（數學方向）。
 */
export function triangleFromSides(a, b, c) {
  if (!(a + b > c && b + c > a && c + a > b)) throw new RangeError(`三邊 ${a}、${b}、${c} 圍不成三角形`);
  const x = (b * b + c * c - a * a) / (2 * c);
  const y = Math.sqrt(Math.max(0, b * b - x * x));
  return { A: [0, 0], B: [c, 0], C: [x, -y] };
}

/** 三個內角（度，和為 180）建三角形，最長邊為 longest mm。頂點依逆時針排列。 */
export function triangleFromAngles(A, B, C, longest) {
  if (Math.abs(A + B + C - 180) > 1e-9) throw new RangeError(`三個角 ${A}、${B}、${C} 加起來不是 180`);
  const s = [Math.sin(rad(A)), Math.sin(rad(B)), Math.sin(rad(C))];
  const k = longest / Math.max(...s);
  // 邊 a 對角 A
  return triangleFromSides(s[0] * k, s[1] * k, s[2] * k);
}

/** 三角形的三個內角（度）：A、B、C 依頂點。 */
export function anglesOf({ A, B, C }) {
  const ang = (p, q, r) => {
    const u = sub(q, p), v = sub(r, p);
    return (Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
  };
  return { A: ang(A, B, C), B: ang(B, C, A), C: ang(C, A, B) };
}

/** 標示放在邊的中點，往三角形外面推 offset mm。 */
export function outsideLabelAt(p, q, centroid, offset = 5) {
  const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const d = sub(q, p);
  let n = [-d[1], d[0]];
  const l = Math.hypot(...n) || 1;
  n = [n[0] / l, n[1] / l];
  const toC = sub(centroid, m);
  if (n[0] * toC[0] + n[1] * toC[1] > 0) n = [-n[0], -n[1]];
  return add(m, n, offset);
}

/** 頂點標示：從重心往頂點方向推出去 offset mm。 */
export function vertexLabelAt(p, centroid, offset = 4.5) {
  const d = sub(p, centroid);
  const l = Math.hypot(...d) || 1;
  return add(p, [d[0] / l, d[1] / l], offset);
}

/** 標示文字大約佔的半寬、半高（mm）：外殼與作業單的標示字級是 4 mm；全形字約 4 mm 寬、數字約 2.3、度數符號約 1.6。 */
export function labelBox(text) {
  const w = [...text].reduce((sum, ch) => sum + (/[0-9]/.test(ch) ? 2.3 : ch === "°" ? 1.6 : 4), 0);
  return { hw: w / 2, hh: 2.2 };
}

/** 點到以 at 為中心、半寬 hw、半高 hh 的方框的距離（在框內是 0）。 */
export function boxGap(p, at, { hw, hh }) {
  return Math.hypot(Math.max(Math.abs(p[0] - at[0]) - hw, 0), Math.max(Math.abs(p[1] - at[1]) - hh, 0));
}

export const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];

/**
 * 把一組點（含標示位置與只用來撐畫布的點）平移到畫布裡，留 margin；回傳 { shift(p), width, height }。
 * extent：決定畫布範圍的所有點（圖形、標示、疊圖工具會到的地方）。
 */
export function fit(extent, margin = 4) {
  const minX = Math.min(...extent.map((p) => p[0]));
  const minY = Math.min(...extent.map((p) => p[1]));
  const maxX = Math.max(...extent.map((p) => p[0]));
  const maxY = Math.max(...extent.map((p) => p[1]));
  return {
    shift: (p) => [round1(p[0] - minX + margin), round1(p[1] - minY + margin)],
    width: round1(maxX - minX + 2 * margin),
    height: round1(maxY - minY + 2 * margin),
  };
}

/** 依權重按比例分配題數（最大餘數法）；餘數相同時照 tiers 順序。 */
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

export function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 在 [min, max] 之間抽 step 的倍數。 */
export function pickStep(rng, min, max, step) {
  const lo = Math.ceil(min / step), hi = Math.floor(max / step);
  if (hi < lo) throw new RangeError(`${min}–${max} 之間沒有 ${step} 的倍數`);
  return rng.int(lo, hi) * step;
}
