// 可種子化的亂數：同一個種子字串永遠得到同一串數字，所以亂數題可以重現。
// 不用 Math.random（不可種子化）。瀏覽器、Worker、Node 都能跑，沒有相依。
// 演算法：FNV-1a 把字串壓成 32 位元整數當起點，再用 mulberry32 這個小型 32 位元產生器往下走。

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @param {string|number} seed 種子；數字會轉成字串。
 * @returns {{ next(): number, int(min: number, max: number): number }}
 *   next() 回傳 [0, 1) 的浮點數；int(min, max) 回傳 min..max（含兩端）的整數。
 */
export function createRng(seed) {
  if (typeof seed !== "string" && typeof seed !== "number") throw new TypeError("seed 必須是字串或數字");
  let state = hash32(String(seed)) || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError(`int(${min}, ${max}) 範圍不合法`);
    return min + Math.floor(next() * (max - min + 1));
  };
  return { next, int };
}
