import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { getProfile, resolveParams, checkParams, instantiate, generators, INSTANCE_SCHEMA_PATH } from "../generators/index.mjs";
import { allocate, angleFigure, misconceptionFor, DEFAULT_ALT } from "../generators/math/angle-vs-right/generate.mjs";
import { generate, misconceptions, toInstanceShape } from "../activities/index.mjs";
import { score } from "../question-types/index.mjs";
import { checkCard } from "../conformance/validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = async (rel) => JSON.parse(await readFile(path.join(here, "..", rel), "utf8"));
const LADDER = "n-II-9#b@3";
const GEN = "math.angle-vs-right";
const profile = getProfile(LADDER);

const ajvPromise = (async () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(await readJson("schema/common.schema.json"));
  ajv.addSchema(await readJson("schema/figure.schema.json"));
  return {
    validateInstance: ajv.compile(await readJson(INSTANCE_SCHEMA_PATH)),
    validateParams: ajv.compile(await readJson(generators[GEN].paramsSchemaPath)),
  };
})();

const item = (params, count = 12) => ({
  format_version: 1, id: "i-angle", unit: "u-angle", type: "choice", kind: "generated", skill: "和直角比", difficulty: 1,
  ladder_ids: [LADDER], curriculum_codes: ["S-3-1"], generator: GEN, generator_version: 1, params, count,
});
const defaults = (mode = "practice") => resolveParams(profile, { mode });

test("條件檔：Cyclone 確認的預設（三檔 12 題、明顯 6／直角 3／接近 3），三檔提示相同不洩漏檔位", () => {
  assert.equal(profile.generator, GEN);
  assert.deepEqual(profile.defaults.tiers, ["clear", "right", "near"]);
  assert.deepEqual(profile.defaults.weights, { clear: 6, right: 3, near: 3 });
  assert.equal(profile.defaults.count, 12);
  assert.deepEqual(Object.keys(profile.hints).sort(), Object.keys(profile.tiers).sort());
  for (const h of Object.values(profile.hints)) assert.deepEqual(h, profile.hints.clear);
  for (const [t, def] of Object.entries(profile.tiers)) {
    for (const [lo, hi] of def.ranges) {
      assert.ok(lo <= hi, t);
      assert.ok(hi < 90 || lo > 90 || (lo === 90 && hi === 90), `${t} 的範圍 ${lo}–${hi} 不可跨過 90`);
      assert.ok(hi < 180, "三年級不出 180 度以上");
    }
  }
  assert.equal(checkParams(profile, defaults().params).length, 0);
});

test("resolveParams：五種調整與 mode", async () => {
  const { validateParams } = await ajvPromise;
  const base = defaults("assess");
  assert.ok(validateParams(base.params), JSON.stringify(validateParams.errors));
  assert.equal(base.count, 12);
  assert.equal(base.params.overlay, "button");
  assert.equal(defaults("practice").params.overlay, "hint");
  assert.deepEqual(resolveParams(profile, { adjustment: "simplify" }).params.tiers, ["clear", "right"]);
  assert.deepEqual(Object.keys(resolveParams(profile, { adjustment: "simplify" }).params.weights), ["clear", "right"]);
  assert.equal(resolveParams(profile, { adjustment: "reduce" }).count, 6);
  assert.equal(resolveParams(profile, { adjustment: "decompose", mode: "assess" }).params.overlay, "always");
  assert.equal(resolveParams(profile, { adjustment: "substitute" }).params.choices, "is-right");
  assert.equal(resolveParams(profile, { adjustment: "not_applicable" }).skip, true);
  assert.equal(resolveParams(profile, { overrides: { count: 8, overlay: { practice: "always" } }, mode: "practice" }).params.overlay, "always");
  assert.throws(() => resolveParams(profile, { overrides: { tiers: ["obtuse-only"] } }), /不在條件檔/);
  assert.throws(() => resolveParams(profile, { overrides: { overlay: "always" } }), /overlay 覆寫/);
  assert.match(checkParams(profile, { ...base.params, operations: ["add"] }).join(), /未知參數/);
  assert.match(checkParams(profile, { ...base.params, choices: "four" }).join(), /choices/);
});

test("allocate：權重按比例分題（最大餘數法）", () => {
  const w = { clear: 6, right: 3, near: 3 };
  assert.deepEqual(allocate(["clear", "right", "near"], w, 12).map((x) => x.n), [6, 3, 3]);
  assert.deepEqual(allocate(["clear", "right", "near"], w, 5).map((x) => x.n), [3, 1, 1]);
  assert.deepEqual(allocate(["clear", "right", "near"], w, 6).map((x) => x.n), [3, 2, 1]);
  assert.deepEqual(allocate(["clear", "right"], {}, 3).map((x) => x.n), [2, 1]);
  for (let n = 1; n <= 30; n++) assert.equal(allocate(["clear", "right", "near"], w, n).reduce((s, x) => s + x.n, 0), n);
});

test("出題：12 題的檔位、角度、答案、選項與回饋都對，同種子重現、不同種子不同", async () => {
  const { validateInstance } = await ajvPromise;
  const { params } = defaults();
  const qs = instantiate(item(params), { seed: "s-angle-1" });
  assert.equal(qs.length, 12);
  assert.deepEqual(instantiate(item(params), { seed: "s-angle-1" }), qs);
  assert.notDeepEqual(instantiate(item(params), { seed: "s-angle-2" }).map((q) => q.variables.angle), qs.map((q) => q.variables.angle));
  const tally = { clear: 0, right: 0, near: 0 };
  for (const q of qs) {
    assert.ok(validateInstance(q), JSON.stringify(validateInstance.errors));
    tally[q.tier]++;
    const { angle } = q.variables;
    assert.ok(profile.tiers[q.tier].ranges.some(([lo, hi]) => angle >= lo && angle <= hi), `${angle} 不在 ${q.tier}`);
    assert.equal(q.answer, angle < 90 ? "smaller" : angle > 90 ? "larger" : "same");
    assert.deepEqual(q.options.map((o) => o.id), ["smaller", "same", "larger"]);
    assert.deepEqual(q.options.map((o) => o.text.text), ["比直角小", "一樣大", "比直角大"]);
    assert.equal(q.shuffle, false);
    assert.equal(q.stem.text.text, "這個角和直角比，怎麼樣？");
    assert.equal(q.hints.length, 3);
    assert.ok(!q.options.find((o) => o.id === q.answer).misconception, "正解不帶錯誤類型");
    for (const o of q.options) if (o.id !== q.answer) assert.ok(misconceptions[o.misconception], `${o.misconception} 沒在內建錯誤類型表`);
    assert.match(q.feedback.correct.text, /^答對了！這個角(比直角小|和直角一樣大|比直角大)。/);
    assert.match(q.feedback.correct.text, q.answer === "smaller" ? /銳角/ : q.answer === "larger" ? /鈍角/ : /就是直角/);
    assert.equal(score(q, { option: q.answer }).score, 1);
    assert.equal(score(q, { option: q.options.find((o) => o.id !== q.answer).id }).score, 0);
    assert.equal(q.display.overlay, "hint");
  }
  assert.deepEqual(tally, { clear: 6, right: 3, near: 3 });
});

test("圖形：不標度數、直角不畫直角記號、alt 每題相同、畫布包得住角與直角板", () => {
  const { params } = defaults();
  const qs = instantiate(item(params, 30), { seed: "s-fig" });
  const alts = new Set();
  for (const q of qs) {
    const f = q.display.figure;
    alts.add(f.alt);
    assert.equal(f.unit, "mm");
    assert.ok(!JSON.stringify(f).includes("度"), "三年級圖上不出現度");
    assert.equal(f.labels, undefined);
    assert.equal(f.angles[0].mark, "arc", "直角也只畫角弧，記號不洩漏答案");
    for (const [x, y] of Object.values(f.points)) assert.ok(x >= 0 && y >= 0 && x <= f.width && y <= f.height);
    const { v, a, b } = f.points;
    const ang = (p) => Math.atan2(-(p[1] - v[1]), p[0] - v[0]);
    let d = ((ang(b) - ang(a)) * 180) / Math.PI;
    d = ((d % 360) + 360) % 360;
    assert.ok(Math.abs(d - q.variables.angle) < 0.5, `畫出的角 ${d.toFixed(1)} 和 ${q.variables.angle} 不符`);
    assert.deepEqual(f.tools["set-square"], { vertex: "v", along: "a", toward: "b", size: 30 });
  }
  assert.deepEqual([...alts], [DEFAULT_ALT === profile.alt ? DEFAULT_ALT : profile.alt]);
  assert.ok(!/小|大|直角[^板]/.test(profile.alt.replace("直角板", "")), "alt 不洩漏答案");
  assert.ok(new Set(qs.map((q) => q.variables.rotation)).size > 4, "方向要有變化");
  assert.ok(qs.some((q) => q.variables.misleading), "要有故意誤導邊長的題目");
  assert.ok(new Set(qs.map((q) => q.variables.ray_a)).size > 4, "邊長要有變化");
  // 疊圖範圍算進畫布：直角板的兩個角落都在畫布內
  const f = angleFigure({ angle: 150, rotation: 270, rayA: 22, rayB: 22, arc: 6 });
  assert.ok(f.width >= 30 && f.height >= 30);
});

test("錯誤類型對應", () => {
  assert.equal(misconceptionFor("smaller", "larger", { misleading: true, rotated: false }), "angle-by-ray-length");
  assert.equal(misconceptionFor("smaller", "larger", { misleading: false, rotated: false }), "angle-compare-reversed");
  assert.equal(misconceptionFor("larger", "same", { misleading: false, rotated: true }), "angle-right-by-eye");
  assert.equal(misconceptionFor("same", "smaller", { misleading: false, rotated: true }), "angle-right-orientation");
  assert.equal(misconceptionFor("same", "larger", { misleading: false, rotated: false }), "angle-right-by-eye");
  assert.equal(misconceptionFor("yes", "no", { misleading: false, rotated: true }), "angle-right-orientation");
  assert.equal(misconceptionFor("no", "yes", { misleading: false, rotated: false }), "angle-right-by-eye");
  assert.equal(misconceptionFor("same", "same", {}), undefined);
});

test("替代（是不是直角）、分解（一開始疊上直角板）", async () => {
  const { validateInstance } = await ajvPromise;
  const sub = resolveParams(profile, { adjustment: "substitute", mode: "practice" });
  const qs = instantiate(item(sub.params, sub.count), { seed: "s-sub" });
  for (const q of qs) {
    assert.ok(validateInstance(q), JSON.stringify(validateInstance.errors));
    assert.deepEqual(q.options.map((o) => o.id), ["yes", "no"]);
    assert.equal(q.answer, q.variables.angle === 90 ? "yes" : "no");
    assert.equal(q.stem.text.text, "這個角是不是直角？");
  }
  const dec = resolveParams(profile, { adjustment: "decompose", mode: "assess" });
  assert.ok(instantiate(item(dec.params, 3), { seed: "s-dec" }).every((q) => q.display.overlay === "always"));
});

test("不可能的條件有可讀錯誤；參數錯是內容錯", () => {
  const { params } = defaults();
  assert.throws(() => instantiate(item({ ...params, tiers: ["right"], weights: { right: 1 }, rotate: false }, 2), { seed: 1 }), /抽不到不重複的角.*沒有旋轉/);
  assert.throws(() => instantiate(item({ ...params, overlay: "sometimes" }), { seed: 1 }), /overlay/);
});

test("技能卡接進活動：技能練習出選擇題，形狀過實例 schema，卡片檢查通過", async () => {
  const { validateInstance, validateParams } = await ajvPromise;
  const skill = {
    format_version: 1, id: "sk-angle-right", kind: "skill", key: "math.angle-vs-right:3", ladder_ids: [LADDER], curriculum_codes: ["S-3-1"],
    title: { text: "和直角比", audio: null }, generator: GEN, generator_version: 1, params: defaults().params,
  };
  assert.deepEqual(checkCard(skill, { validateParams }), []);
  const unit = { id: "u-angle", subject: "math", grade: 3 };
  const cards = { chars: [], words: [], patterns: [], skills: [skill] };
  const qs = generate("skill-practice", { unit, cards, seed: "r", count: 12 });
  assert.equal(qs.length, 12);
  for (const q of qs) {
    assert.equal(q.type, "choice");
    assert.ok(validateInstance(toInstanceShape(q)), JSON.stringify(validateInstance.errors));
  }
  const quiz = generate("quiz", { unit, cards, seed: "q", count: 5 });
  assert.equal(quiz.length, 5);
  assert.ok(quiz.every((q) => q.type === "choice" && q.display.figure));
});
