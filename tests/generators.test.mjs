import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generators, getGenerator, instantiate, substitute, INSTANCE_SCHEMA_PATH } from "../generators/index.mjs";
import { createRng } from "../generators/_prng.mjs";
import { score } from "../question-types/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const readJson = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));

async function loadAjv() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(await readJson("schema/common.schema.json"));
  ajv.addSchema(await readJson("schema/figure.schema.json"));
  const validateInstance = ajv.compile(await readJson(INSTANCE_SCHEMA_PATH));
  const validateParams = {};
  for (const g of Object.values(generators)) validateParams[g.id] = ajv.compile(await readJson(g.paramsSchemaPath));
  return { validateInstance, validateParams };
}
const ajvPromise = loadAjv();


const CARRY = "math.add-2digit-carry";
const NO_CARRY = "math.add-2digit-no-carry";
const hasCarry = (a, b) => (a % 10) + (b % 10) >= 10;

const genItem = (overrides = {}) => ({
  format_version: 1,
  id: "i-gen-test",
  unit: "u02-add-2digit",
  type: "numeric",
  kind: "generated",
  skill: "計算",
  difficulty: 2,
  ladder_ids: ["n-II-2#b@1"],
  curriculum_codes: ["N-2-2"],
  generator: CARRY,
  generator_version: 1,
  params: { min: 10, max: 99 },
  count: 5,
  hints: [
    { text: "先算個位。", audio: null },
    { text: "個位：{a_ones} 加 {b_ones}。", audio: null },
    { text: "{a} 加 {b} 等於 {sum}。", audio: null },
  ],
  feedback: { correct: { text: "答對了！{a} 加 {b} 是 {sum}。", audio: null }, retry: { text: "再檢查一次。", audio: null } },
  ...overrides,
});

test("登錄表：四個產生器、版本 1、params schema 可編譯", async () => {
  assert.deepEqual(Object.keys(generators).sort(), [CARRY, NO_CARRY, "math.add-sub", "math.angle-vs-right"]);
  for (const g of Object.values(generators)) {
    assert.equal(g.version, 1);
    assert.equal(typeof g.generate, "function");
  }
  assert.equal(getGenerator(CARRY).id, CARRY);
  assert.equal(getGenerator("math.nope"), null);
  const { validateParams } = await ajvPromise;
  assert.ok(validateParams[CARRY]({ min: 10, max: 99, require_carry: true, max_sum: 99, distinct: true, layout: "vertical" }));
  assert.ok(!validateParams[CARRY]({ require_carry: false }), "進位產生器的 require_carry 不能是 false");
  assert.ok(!validateParams[NO_CARRY]({ require_carry: true }));
  assert.ok(!validateParams[CARRY]({ min: 5 }));
  assert.ok(!validateParams[CARRY]({ foo: 1 }));
});

test("PRNG：同種子同序列、不同種子不同序列、int 在範圍內", () => {
  const a = createRng("seed-a");
  const b = createRng("seed-a");
  const c = createRng("seed-b");
  const sa = Array.from({ length: 20 }, () => a.next());
  const sb = Array.from({ length: 20 }, () => b.next());
  const sc = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const x of sa) assert.ok(x >= 0 && x < 1);
  const r = createRng(42);
  for (let i = 0; i < 500; i++) {
    const v = r.int(3, 7);
    assert.ok(Number.isInteger(v) && v >= 3 && v <= 7);
  }
  assert.throws(() => createRng(null), /seed/);
  assert.throws(() => createRng("x").int(5, 3), /範圍/);
});

test("同一個 item、同一個 seed 展開結果完全相同；不同 seed 不同", () => {
  const item = genItem({ count: 8 });
  const first = instantiate(item, { seed: "attempt-1" });
  const again = instantiate(item, { seed: "attempt-1" });
  assert.deepEqual(first, again);
  const other = instantiate(item, { seed: "attempt-2" });
  assert.notDeepEqual(first.map((i) => i.answer), other.map((i) => i.answer));
  // 數字種子等同其字串
  assert.deepEqual(instantiate(item, { seed: 7 }), instantiate(item, { seed: "7" }));
});

test("進位批每題都進位、不進位批每題都不進位；加數在範圍內；答案正確", () => {
  const carry = instantiate(genItem({ count: 60 }), { seed: "c" });
  assert.equal(carry.length, 60);
  for (const inst of carry) {
    const { a, b, sum, carry: flag } = inst.variables;
    assert.ok(a >= 10 && a <= 99 && b >= 10 && b <= 99);
    assert.ok(hasCarry(a, b), `${a}+${b} 沒進位`);
    assert.equal(flag, 1);
    assert.equal(inst.answer, a + b);
    assert.equal(sum, a + b);
    assert.equal(inst.stem.text.text, `${a} + ${b} = ？`);
  }
  const noCarry = instantiate(genItem({ generator: NO_CARRY, count: 60, params: { min: 20, max: 59 } }), { seed: "n" });
  for (const inst of noCarry) {
    const { a, b } = inst.variables;
    assert.ok(a >= 20 && a <= 59 && b >= 20 && b <= 59);
    assert.ok(!hasCarry(a, b), `${a}+${b} 進位了`);
    assert.equal(inst.variables.carry, 0);
  }
});

test("distinct 不重複、max_sum 生效、distinct: false 允許重複", () => {
  // 10–19 之間個位相加 ≥ 10 的不重複組合恰好 25 組：抽 25 題要全部不同，抽 26 題一定抽不到
  const batch = instantiate(genItem({ count: 25, params: { min: 10, max: 19 } }), { seed: "d" });
  const keys = batch.map(({ variables: { a, b } }) => (a <= b ? `${a}+${b}` : `${b}+${a}`));
  assert.equal(new Set(keys).size, 25, "有重複的加數組合");
  assert.throws(() => instantiate(genItem({ count: 26, params: { min: 10, max: 19 } }), { seed: "d" }), /不重複/);

  const capped = instantiate(genItem({ count: 30, params: { min: 10, max: 99, max_sum: 99 } }), { seed: "m" });
  for (const inst of capped) assert.ok(inst.answer <= 99, `${inst.answer} 超過 max_sum`);

  // 範圍只有 19+19 一組可進位；distinct 時第二題抽不到，關掉 distinct 就可以
  assert.throws(() => instantiate(genItem({ count: 2, params: { min: 19, max: 19 } }), { seed: "x" }), RangeError);
  const dup = instantiate(genItem({ count: 2, params: { min: 19, max: 19, distinct: false } }), { seed: "x" });
  assert.deepEqual(dup.map((i) => i.answer), [38, 38]);
});

test("不可能的條件丟 RangeError 並說明", () => {
  assert.throws(() => instantiate(genItem({ count: 1, params: { min: 10, max: 10 } }), { seed: "x" }), /需進位.*10–10/);
  assert.throws(() => instantiate(genItem({ generator: NO_CARRY, count: 1, params: { min: 19, max: 19 } }), { seed: "x" }), /不進位/);
  assert.throws(() => instantiate(genItem({ count: 1, params: { min: 90, max: 99, max_sum: 100 } }), { seed: "x" }), /和 ≤ 100/);
});

test("參數錯誤是內容錯誤：TypeError", () => {
  const bad = (params, re) => assert.throws(() => instantiate(genItem({ params }), { seed: "s" }), re);
  bad({ min: 5 }, /min 必須是 10 到 99/);
  bad({ max: 100 }, /max 必須是 10 到 99/);
  bad({ min: 50, max: 20 }, /min 不能大於 max/);
  bad({ max_sum: 5 }, /max_sum/);
  bad({ distinct: "yes" }, /distinct/);
  bad({ layout: "diagonal" }, /layout/);
  bad({ require_carry: false }, /require_carry 必須是 true/);
  bad({ foo: 1 }, /未知參數/);
  bad([], /params 必須是物件/);
  assert.throws(() => instantiate(genItem({ generator: NO_CARRY, params: { require_carry: true } }), { seed: "s" }), /require_carry 必須是 false/);
});

test("instantiate 的守門：kind、產生器、版本、count、seed", () => {
  assert.throws(() => instantiate(genItem({ kind: "fixed" }), { seed: "s" }), /只有 generated/);
  assert.throws(() => instantiate(genItem({ generator: "math.nope" }), { seed: "s" }), /未登錄的產生器/);
  assert.throws(() => instantiate(genItem({ generator_version: 2 }), { seed: "s" }), /version 1.*要求 version 2/);
  assert.throws(() => instantiate(genItem({ count: 0 }), { seed: "s" }), /count/);
  assert.throws(() => instantiate(genItem({ count: 2.5 }), { seed: "s" }), /count/);
  assert.throws(() => instantiate(genItem()), /seed/);
  assert.throws(() => instantiate(genItem(), { seed: "" }), /seed/);
  assert.throws(() => instantiate(null, { seed: "s" }), /item/);
});

test("實例通過 instance.schema.json，且 score() 用 answer 判對、錯答判錯", async () => {
  const { validateInstance } = await ajvPromise;
  const item = genItem({ count: 10, params: { min: 10, max: 99, layout: "vertical" } });
  const batch = instantiate(item, { seed: "score" });
  for (const inst of batch) {
    assert.ok(validateInstance(inst), `實例不符 schema：${JSON.stringify(validateInstance.errors)}`);
    assert.equal(inst.kind, "instance");
    assert.equal(inst.display.layout, "vertical");
    assert.deepEqual(inst.ladder_ids, item.ladder_ids);
    assert.equal(inst.unit, item.unit);
    const ok = score(inst, { value: inst.answer });
    assert.equal(ok.outcome, "correct", JSON.stringify(ok));
    assert.equal(ok.type, "numeric");
    assert.equal(score(inst, { value: inst.answer + 10 }).outcome, "incorrect");
    assert.equal(score(inst, { value: "42" }).outcome, "invalid");
  }
  // 模板本身仍不能計分
  assert.throws(() => score(item, { value: 1 }), /產生器/);
});

test("提示與回饋的 {變數} 置換；沒有的變數原樣保留；不改動原 item", () => {
  const item = genItem({ count: 1, hints: [
    { text: "先算個位。", audio: null },
    { text: "個位：{a_ones} 加 {b_ones}。", audio: null },
    { text: "{a} 加 {b} 等於 {sum}；{nope} 不變。", audio: null },
  ] });
  const frozen = structuredClone(item);
  const [inst] = instantiate(item, { seed: "h" });
  const { a, b, sum, a_ones, b_ones } = inst.variables;
  assert.equal(inst.hints[0].text, "先算個位。");
  assert.equal(inst.hints[1].text, `個位：${a_ones} 加 ${b_ones}。`);
  assert.equal(inst.hints[2].text, `${a} 加 ${b} 等於 ${sum}；{nope} 不變。`);
  assert.equal(inst.feedback.correct.text, `答對了！${a} 加 ${b} 是 ${sum}。`);
  assert.equal(inst.feedback.retry.text, "再檢查一次。");
  assert.deepEqual(item, frozen, "instantiate 改動了 item");
  assert.equal(substitute("{a}+{b}", { a: 1, b: 2 }), "1+2");
  assert.equal(substitute("{A}", { A: 1 }), "{A}", "佔位符只接受小寫變數名");
});
