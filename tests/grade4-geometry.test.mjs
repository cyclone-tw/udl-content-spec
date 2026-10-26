// 四年級幾何產生器（udl-math#8 切片 S2–S5、S8）：每一題都從圖上的點重新量一次，確認答案和圖一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getProfile, resolveParams, instantiate, INSTANCE_SCHEMA_PATH } from "../generators/index.mjs";
import { generate, misconceptions, toInstanceShape } from "../activities/index.mjs";
import { score } from "../question-types/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(path.join(here, "..", rel), "utf8"));
const validateInstance = (async () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(await readJson("schema/common.schema.json"));
  ajv.addSchema(await readJson("schema/figure.schema.json"));
  return ajv.compile(await readJson(INSTANCE_SCHEMA_PATH));
})();

const run = (ladder, seed, opts = {}) => {
  const profile = getProfile(ladder);
  const { params, count } = resolveParams(profile, { mode: "practice", ...opts });
  const item = { format_version: 1, id: "i-g4", unit: "u-g4", type: "choice", kind: "generated", skill: "x", difficulty: 2, ladder_ids: [ladder], generator: profile.generator, generator_version: 1, params, count };
  return { profile, qs: instantiate(item, { seed }), again: () => instantiate(item, { seed }) };
};
const pt = (q, id) => q.display.figure.points[id];
const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
/** 從 from 逆時針轉到 to 的角度（畫面 y 向下）。 */
const ccw = (v, from, to) => {
  const h = (p) => Math.atan2(-(p[1] - v[1]), p[0] - v[0]);
  const d = ((h(to) - h(from)) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
};
const interior = (v, p, q) => Math.min(ccw(v, p, q), ccw(v, q, p));
const tally = (qs) => qs.reduce((t, q) => ({ ...t, [q.tier]: (t[q.tier] ?? 0) + 1 }), {});

async function common(qs, again) {
  const validate = await validateInstance;
  assert.deepEqual(again(), qs, "同種子要重現");
  for (const q of qs) {
    assert.ok(validate(q), JSON.stringify(validate.errors));
    const right = q.type === "choice" ? { option: q.answer } : { value: q.answer };
    assert.equal(score(q, right).score, 1);
    assert.equal(q.hints.length, 3);
    for (const o of q.options ?? []) if (o.misconception) assert.ok(misconceptions[o.misconception], `${o.misconception} 沒在內建表`);
    const f = q.display.figure;
    for (const [x, y] of Object.values(f.points)) assert.ok(x >= 0 && y >= 0 && x <= f.width && y <= f.height, "點要在畫布內");
    for (const l of f.labels ?? []) assert.ok(l.at[0] >= 0 && l.at[1] >= 0 && l.at[0] <= f.width && l.at[1] <= f.height, "標示要在畫布內");
    assert.ok(!/\{[a-z_]+\}/.test(JSON.stringify([q.stem, q.hints, q.feedback])), "範本變數都要置換");
  }
}

test("三角形分類：三檔 12 題（4／4／4），答案和圖上量到的邊與角一致", async () => {
  for (const seed of ["t1", "t2", "t3"]) {
    const { qs, again } = run("s-II-3#b@4", seed);
    await common(qs, again);
    assert.deepEqual(tally(qs), { "sides-marks": 4, "sides-lengths": 4, angles: 4 });
    for (const q of qs) {
      const [a, b, c] = ["a", "b", "c"].map((k) => pt(q, k));
      const sides = [len(a, b), len(b, c), len(c, a)];
      const f = q.display.figure;
      if (q.tier === "angles") {
        const angs = [interior(a, b, c), interior(b, c, a), interior(c, a, b)];
        const max = Math.max(...angs);
        const expect = q.answer === "right" ? [89.5, 90.5] : q.answer === "obtuse" ? [99.5, 150.5] : [0, 80.5];
        assert.ok(max >= expect[0] && max <= expect[1], `${q.answer} 的最大角 ${max.toFixed(1)}`);
        assert.ok(f.angles.every((x) => x.mark === "arc"), "按角分類不畫直角記號");
        const vtx = f.tools["set-square"].vertex;
        assert.ok(Math.abs(angs["abc".indexOf(vtx)] - max) < 0.5, "直角板放在最大的角");
        assert.ok(Math.abs(Math.round(angs.reduce((s, x) => s + x, 0)) - 180) <= 1);
      } else {
        const eq = (x, y) => Math.abs(x - y) < 0.6;
        const pairs = [eq(sides[0], sides[1]), eq(sides[1], sides[2]), eq(sides[2], sides[0])].filter(Boolean).length;
        assert.equal(pairs, { equilateral: 3, isosceles: 1, scalene: 0 }[q.answer], `${q.answer} 的邊 ${sides.map((x) => x.toFixed(1))}`);
        assert.equal(f.tools, undefined, "看邊不給直角板");
        if (q.tier === "sides-lengths") {
          const cm = f.labels.map((l) => Number.parseInt(l.text, 10));
          sides.forEach((s, i) => assert.ok(Math.abs(s - cm[i] * 10) < 0.3, "1 公分畫 10 mm，標示和實際長度一致"));
        } else assert.ok(f.segments.some((s) => s.ticks), "看記號要有等長記號");
      }
    }
  }
});

test("量角：三檔 10 題（右 4、左 4、不在 0 刻度 2），畫出的角等於答案，量角器開在角那一側，±2 度", async () => {
  for (const seed of ["m1", "m2", "m3"]) {
    const { qs, again } = run("n-II-9#b@4", seed);
    await common(qs, again);
    assert.deepEqual(tally(qs), { "zero-right": 4, "zero-left": 4, "off-zero": 2 });
    for (const q of qs) {
      const v = pt(q, "v");
      const drawn = interior(v, pt(q, "a"), pt(q, "b"));
      assert.ok(Math.abs(drawn - q.answer) < 0.5, `畫出 ${drawn.toFixed(1)}，答案 ${q.answer}`);
      assert.equal(q.answer % 5, 0);
      const pr = q.display.figure.tools.protractor;
      assert.equal(pr.toward, "b");
      const base = pt(q, pr.along);
      if (q.tier === "off-zero") assert.ok(Math.abs(interior(v, base, pt(q, "a")) - q.variables.start) < 0.5 && q.variables.start >= 10);
      else assert.equal(pr.along, "a");
      // 0 度線在左邊：底邊朝左
      if (q.tier === "zero-left") assert.ok(pt(q, "a")[0] < v[0]);
      if (q.tier === "zero-right") assert.ok(pt(q, "a")[0] > v[0]);
      assert.equal(score(q, { value: q.answer + 2 }).score, 1);
      assert.equal(score(q, { value: q.answer - 3 }).score, 0);
      assert.equal(q.variables.wrong_scale, q.tier === "off-zero" ? undefined : 180 - q.answer);
      assert.equal(q.display.overlay, "always");
    }
  }
});

test("平角、周角、角的合成分解：四檔 10 題（3／2／3／2），標示的度數和圖一致，答案不超過 360", async () => {
  for (const seed of ["s1", "s2", "s3"]) {
    const { qs, again } = run("s-II-4#b@4", seed);
    await common(qs, again);
    assert.deepEqual(tally(qs), { "straight-minus": 3, "full-minus": 2, add: 3, sub: 2 });
    for (const q of qs) {
      const f = q.display.figure;
      const v = pt(q, "v");
      const asks = f.labels.filter((l) => l.text === "？");
      assert.equal(asks.length, 1, "只有一個「？」");
      f.angles.forEach((ang, i) => {
        const span = ccw(v, pt(q, ang.from), pt(q, ang.to)) || 360;
        const label = f.labels[i].text;
        if (label === "？") assert.ok(Math.abs(span - q.answer) < 0.5, `「？」的角 ${span.toFixed(1)}，答案 ${q.answer}`);
        else assert.ok(Math.abs(span - Number.parseInt(label, 10)) < 0.5, `標 ${label}，畫出 ${span.toFixed(1)}`);
      });
      const { x, y, z } = q.variables;
      assert.equal(q.answer, { "straight-minus": 180 - x, "full-minus": 360 - x, add: x + y, sub: z - x }[q.tier]);
      assert.ok(q.answer > 0 && q.answer <= 360);
    }
  }
});

test("全等：一張圖裡只有一個和甲全等；翻面檔的那一個是翻過來的", async () => {
  const orient = (p) => Math.sign((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]));
  const sorted = (p) => [len(p[0], p[1]), len(p[1], p[2]), len(p[2], p[0])].sort((m, n) => m - n);
  for (const seed of ["c1", "c2", "c3"]) {
    const { qs, again } = run("s-II-2#a@4", seed);
    await common(qs, again);
    assert.deepEqual(tally(qs), { "find-turn": 3, "find-flip": 3 });
    for (const q of qs) {
      const tri = (k) => [0, 1, 2].map((i) => pt(q, `${k}${i}`));
      const ref = sorted(tri("t"));
      const same = [0, 1, 2, 3].filter((i) => sorted(tri(`c${i}`)).every((l, j) => Math.abs(l - ref[j]) < 0.3));
      assert.deepEqual(same.map((i) => `c${i + 1}`), [q.answer], "恰好一個全等，就是答案");
      const k = Number(q.answer.slice(1)) - 1;
      assert.equal(orient(tri(`c${k}`)) === orient(tri("t")), q.tier === "find-turn", "翻面檔的方向相反、轉的檔方向相同");
      assert.ok(q.options.filter((o) => o.id !== q.answer).every((o) => o.misconception));
      assert.ok(!/平移|旋轉|翻轉/.test(JSON.stringify([q.stem, q.hints, q.feedback])), "S-4-6：不出現操作名詞");
      // 相鄰的三角形不重疊：每個三角形的外接方框彼此不相交
      const boxes = ["t", "c0", "c1", "c2", "c3"].map((key) => { const ps = tri(key); return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))]; });
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        assert.ok(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1], `第 ${i} 和第 ${j} 個三角形重疊`);
      }
    }
  }
});

test("對應：答案的邊一樣長、角一樣大，其他選項不一樣", async () => {
  for (const seed of ["d1", "d2", "d3", "d4"]) {
    const { qs, again } = run("s-II-2#b@4", seed);
    await common(qs, again);
    assert.deepEqual(tally(qs), { side: 3, angle: 3 });
    for (const q of qs) {
      const f = q.display.figure;
      const name = (key, n) => f.labels.find((l) => l.id.startsWith(`${key}-v`) && l.text === n).id.slice(-1);
      const P = (key, n) => pt(q, `${key}${name(key, n)}`);
      const A = ["ㄅ", "ㄆ", "ㄇ"], B = ["ㄉ", "ㄊ", "ㄋ"];
      const others = (n, arr) => arr.filter((x) => x !== n);
      const angleAt = (key, n, arr) => { const [p, r] = others(n, arr); return interior(P(key, n), P(key, p), P(key, r)); };
      const measure = (text) => (text.startsWith("∠") ? angleAt("b", text[1], B) : len(P("b", text[0]), P("b", text[1])));
      const asked = q.variables.asked;
      const target = asked.startsWith("∠") ? angleAt("a", asked[1], A) : len(P("a", asked[0]), P("a", asked[1]));
      for (const o of q.options) {
        const m = measure(o.text.text);
        if (o.id === q.answer) assert.ok(Math.abs(m - target) < 0.5, `${asked} 對到 ${o.text.text}：${m.toFixed(1)} vs ${target.toFixed(1)}`);
        else assert.ok(Math.abs(m - target) > 1, `${o.text.text} 不該和 ${asked} 一樣`);
      }
    }
  }
});

// #77：標示的方框（字級 4 mm；全形字約 4 mm 寬、數字約 2.3、度數符號約 1.6）。
const labelBox = (l) => ({ hw: [...l.text].reduce((w, c) => w + (/[0-9]/.test(c) ? 2.3 : c === "°" ? 1.6 : 4), 0) / 2, hh: 2.2 });
const gapToBox = (p, l) => { const { hw, hh } = labelBox(l); return Math.hypot(Math.max(Math.abs(p[0] - l.at[0]) - hw, 0), Math.max(Math.abs(p[1] - l.at[1]) - hh, 0)); };
const along = (a, b, step = 0.25) => { const n = Math.ceil(len(a, b) / step); return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); };

test("平角、周角：度數標示不壓到任何邊與角弧、彼此不重疊，而且在自己的角裡（#77）", () => {
  for (let i = 0; i < 60; i++) {
    for (const q of run("s-II-4#b@4", `lab${i}`).qs) {
      const f = q.display.figure;
      const v = pt(q, "v");
      const ink = f.segments.flatMap((sg) => along(v, pt(q, sg.to)));
      for (const ang of f.angles) {
        const from = ccw(v, [v[0] + 1, v[1]], pt(q, ang.from));
        const span = ccw(v, pt(q, ang.from), pt(q, ang.to)) || 360;
        for (let t = 0; t <= span; t += 0.5) { const d = ((from + t) * Math.PI) / 180; ink.push([v[0] + Math.cos(d) * ang.radius, v[1] - Math.sin(d) * ang.radius]); }
      }
      f.labels.forEach((l, k) => {
        const gap = Math.min(...ink.map((p) => gapToBox(p, l)));
        assert.ok(gap >= 1, `${q.tier} 標示 ${l.text} 離邊或弧只有 ${gap.toFixed(2)} mm`);
        const ang = f.angles[k];
        const inside = ccw(v, pt(q, ang.from), l.at), span = ccw(v, pt(q, ang.from), pt(q, ang.to)) || 360;
        assert.ok(inside > 0 && inside < span, `標示 ${l.text} 不在自己的角裡`);
        for (const o of f.labels.slice(k + 1)) {
          const [a, b] = [labelBox(l), labelBox(o)];
          assert.ok(Math.abs(l.at[0] - o.at[0]) >= a.hw + b.hw || Math.abs(l.at[1] - o.at[1]) >= a.hh + b.hh, `標示 ${l.text} 和 ${o.text} 重疊`);
        }
      });
    }
  }
});

test("找全等：整張圖縮小，編號在平板上夠大，也不壓到三角形（#77）", () => {
  for (let i = 0; i < 40; i++) {
    for (const q of run("s-II-2#a@4", `size${i}`).qs) {
      const f = q.display.figure;
      // 外殼的圖最寬 460 px：圖寬 ≤ 115 mm 時 4 mm 的編號至少約 16 px（原本約 150 mm、12 px）
      assert.ok(f.width <= 115 && f.height <= 80, `圖 ${f.width} × ${f.height} mm`);
      const ink = f.segments.flatMap((sg) => along(f.points[sg.from], f.points[sg.to]));
      for (const l of f.labels) assert.ok(Math.min(...ink.map((p) => gapToBox(p, l))) >= 1.5, `編號 ${l.text} 太靠近三角形的邊`);
    }
  }
});

test("找對應：correspondence-by-position 只標在和問的角（邊）擺在同一方位的那個錯誤選項；分不出同一方位時不標（#77）", () => {
  let tagged = 0;
  for (let i = 0; i < 60; i++) {
    for (const q of run("s-II-2#b@4", `pos${i}`).qs) {
      const f = q.display.figure;
      const named = (key, n) => pt(q, `${key}${f.labels.find((l) => l.id.startsWith(`${key}-v`) && l.text === n).id.slice(-1)}`);
      const center = (key) => { const ps = [0, 1, 2].map((k) => pt(q, `${key}${k}`)); return [(ps[0][0] + ps[1][0] + ps[2][0]) / 3, (ps[0][1] + ps[1][1] + ps[2][1]) / 3]; };
      const spot = (key, names) => { const ps = [...names].map((n) => named(key, n)); return [ps.reduce((x, p) => x + p[0], 0) / ps.length, ps.reduce((y, p) => y + p[1], 0) / ps.length]; };
      const heading = (key, names) => { const g = center(key), p = spot(key, names); return Math.atan2(p[1] - g[1], p[0] - g[0]); };
      const turn = (x, y) => { const d = Math.abs(x - y) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
      const asked = q.variables.asked.replace("∠", "");
      const want = heading("a", asked);
      const gaps = q.options.map((o) => (turn(heading("b", o.text.text.replace("∠", "")), want) * 180) / Math.PI);
      const closest = gaps.indexOf(Math.min(...gaps));
      const margin = Math.min(...gaps.filter((_, n) => n !== closest)) - gaps[closest];
      const marks = q.options.filter((o) => o.misconception === "correspondence-by-position");
      assert.ok(marks.length <= 1, "最多標一個");
      assert.ok(!marks.some((o) => o.id === q.answer), "答案不標");
      // 門檻 20 度；圖上座標四捨五入到 0.1 mm，所以只檢查明顯的兩邊
      if (margin >= 25) {
        const expect = q.options[closest].id === q.answer ? [] : [q.options[closest].id];
        assert.deepEqual(marks.map((o) => o.id), expect, `${q.variables.asked}：該標 ${expect}`);
      } else if (margin < 15) assert.deepEqual(marks, [], `${q.variables.asked}：方位只差 ${margin.toFixed(1)} 度，分不出來就不標`);
      tagged += marks.length;
    }
  }
  assert.ok(tagged > 0, "抽樣裡至少有標到的題目");
});

test("範圍不可能時丟可讀的 RangeError，不會卡住", () => {
  const profile = structuredClone(getProfile("s-II-3#b@4"));
  profile.tiers["sides-lengths"].cm = [3, 4];
  const { params } = resolveParams(profile, { overrides: { tiers: ["sides-lengths"] } });
  return import("../generators/math/triangle-classify/generate.mjs").then((m) => {
    assert.throws(() => m.generate({ params, seed: "x", count: 3, profile }), /抽不到/);
  });
});

test("五種課程調整都解析得到，不適用就不出題；技能卡接進活動出題", async () => {
  const validate = await validateInstance;
  for (const ladder of ["s-II-3#b@4", "n-II-9#b@4", "s-II-4#b@4", "s-II-2#a@4", "s-II-2#b@4"]) {
    const profile = getProfile(ladder);
    for (const adj of ["simplify", "reduce", "decompose", "substitute"]) {
      const r = resolveParams(profile, { adjustment: adj });
      assert.ok(r.params.tiers.length >= 1 && r.count >= 1, `${ladder} ${adj}`);
      run(ladder, `adj-${adj}`, { adjustment: adj });
    }
    assert.equal(resolveParams(profile, { adjustment: "not_applicable" }).skip, true);
    const { params } = resolveParams(profile, { mode: "practice" });
    const skill = { format_version: 1, id: "sk-g4", kind: "skill", key: `x:${ladder}`, ladder_ids: [ladder], title: { text: "x", audio: null }, generator: profile.generator, generator_version: 1, params };
    const qs = generate("skill-practice", { unit: { id: "u-g4", subject: "math", grade: 4 }, cards: { chars: [], words: [], patterns: [], skills: [skill] }, seed: "act", count: 6 });
    assert.equal(qs.length, 6);
    for (const q of qs) assert.ok(validate(toInstanceShape(q)), JSON.stringify(validate.errors));
  }
});
