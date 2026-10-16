import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  profiles, getProfile, profilesFor, resolveParams, checkParams, PROFILE_SCHEMA_PATH, INSTANCE_SCHEMA_PATH,
  generators, instantiate, profileForItem,
} from "../generators/index.mjs";
import { analyze, hintVariants, pickHints } from "../generators/math/add-sub/generate.mjs";
import { score } from "../question-types/index.mjs";
import { validatePack, checkGeneratedItem, loadValidators } from "../conformance/validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const EXAMPLE = path.join(ROOT, "examples", "minimal");
const readJson = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
const A2 = "n-I-2#a@2";

async function loadAjv() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(await readJson("schema/common.schema.json"));
  return {
    validateProfile: ajv.compile(await readJson(PROFILE_SCHEMA_PATH)),
    validateInstance: ajv.compile(await readJson(INSTANCE_SCHEMA_PATH)),
    validateParams: ajv.compile(await readJson(generators["math.add-sub"].paramsSchemaPath)),
  };
}
const ajvPromise = loadAjv();
const examplePromise = readJson("examples/minimal/items/i-gen-add-sub-a2.json");
const poolsPromise = (async () => {
  const pack = await readJson("examples/minimal/pack.json");
  const map = new Map();
  for (const id of pack.pools) map.set(id, await readJson(`examples/minimal/pools/${id}.json`));
  return map;
})();

const profile = getProfile(A2);
const item = (params, overrides = {}) => ({
  format_version: 1, id: "i-gen-test", unit: "u02-add-2digit", type: "blanks", kind: "generated",
  skill: "計算", difficulty: 2, ladder_ids: [A2], curriculum_codes: ["N-2-2"],
  generator: "math.add-sub", generator_version: 1, params, count: 10, ...overrides,
});
const example_hints = () => [{ text: "一", audio: null }, { text: "二", audio: null }, { text: "三", audio: null }];
const example_feedback = () => ({ correct: { text: "好", audio: null }, retry: { text: "再", audio: null } });
const canonical = (q) => (q.type === "blanks" ? { blanks: Object.fromEntries(q.blanks.map((b) => [b.id, b.answer])) } : { value: q.answer });

test("登錄表：條件檔通過 schema，每個檔位都有三句提示，預設檔位與權重都在 tiers 內", async () => {
  const { validateProfile } = await ajvPromise;
  assert.deepEqual(Object.keys(profiles), [A2]);
  assert.equal(profilesFor([A2, "c-x"]).length, 1);
  assert.equal(getProfile("nope"), null);
  for (const p of Object.values(profiles)) {
    assert.ok(validateProfile(p), JSON.stringify(validateProfile.errors));
    assert.deepEqual(Object.keys(p.hints).sort(), Object.keys(p.tiers).sort(), "每個檔位都要有提示範本");
    for (const h of Object.values(p.hints)) assert.equal(pickHints(h, []).hints.length, 3, "default 一定三句");
    assert.equal(pickHints(p.hints["add-one-carry"], ["ones-carry"]).key, "default", "沒登錄的候選退回 default，key 也要說 default");
    assert.equal(pickHints(p.hints["add-one-carry"], ["ones-carry", "one-digit"]).key, "one-digit");
    assert.equal(pickHints(p.hints["add-one-carry"], ["tens-carry"]).key, "tens-carry");
    const count = (text, id) => (text.match(new RegExp(`\\[\\[${id}\\]\\]`, "g")) ?? []).length;
    const others = (text) => [...text.matchAll(/\[\[([^\]]*)\]\]/g)].map((m) => m[1]).filter((x) => !["ones", "tens", "hundreds"].includes(x));
    assert.equal(count(p.stems.vertical.places_2, "ones"), 1); assert.equal(count(p.stems.vertical.places_2, "tens"), 1); assert.equal(count(p.stems.vertical.places_2, "hundreds"), 0);
    for (const id of ["ones", "tens", "hundreds"]) assert.equal(count(p.stems.vertical.places_3, id), 1);
    assert.deepEqual(others(p.stems.vertical.places_2), []); assert.deepEqual(others(p.stems.vertical.places_3), []);
    for (const t of p.defaults.tiers) assert.ok(p.tiers[t], `預設檔位 ${t} 不存在`);
    for (const t of Object.keys(p.defaults.weights)) assert.ok(p.defaults.tiers.includes(t), `權重 ${t} 不在預設檔位`);
    for (const s of p.shapes.default) assert.ok(p.shapes.allowed.some((a) => a[0] === s[0] && a[1] === s[1]));
    assert.ok(generators[p.generator], `產生器 ${p.generator} 未登錄`);
    assert.equal(generators[p.generator].version, p.generator_version);
    assert.equal(checkParams(p, resolveParams(p).params).length, 0);
  }
});

test("resolveParams：預設、五種調整、覆寫只能收窄、mode 決定鷹架", async () => {
  const { validateParams } = await ajvPromise;
  const base = resolveParams(profile);
  assert.ok(validateParams(base.params), JSON.stringify(validateParams.errors));
  assert.deepEqual(base.params.tiers, ["add-no-carry", "add-one-carry", "sub-no-borrow", "sub-one-borrow"]);
  assert.equal(base.count, 10);
  assert.equal(base.params.scaffold, "none");
  assert.equal(resolveParams(profile, { mode: "practice" }).params.scaffold, "full");
  assert.equal(base.params.presentation, "vertical-blanks");

  const simp = resolveParams(profile, { adjustment: "simplify" });
  assert.deepEqual(simp.params.tiers, ["add-no-carry", "sub-no-borrow"]);
  assert.deepEqual(simp.params.weights, { "add-no-carry": 1, "sub-no-borrow": 1 }, "收窄後只保留還在的檔位，缺的權重 1");
  assert.equal(simp.params.scaffold, "full", "簡化：檢測也給完整鷹架");
  assert.equal(resolveParams(profile, { adjustment: "reduce" }).count, 5);
  assert.equal(resolveParams(profile, { adjustment: "decompose" }).params.scaffold, "full");
  assert.equal(resolveParams(profile, { adjustment: "substitute" }).params.presentation, "horizontal-numeric");
  assert.deepEqual(resolveParams(profile, { adjustment: "not_applicable" }), { skip: true, adjustment: "not_applicable", label: "不適用" });

  const addOnly = resolveParams(profile, { overrides: { tiers: ["add-one-carry"] } });
  assert.deepEqual(addOnly.params.operations, ["add"], "只開加法檔時 operations 跟著收窄");
  assert.equal(resolveParams(profile, { overrides: { count: 3, shapes: [[2, 1]] } }).count, 3);
  // 條件檔是上限，不是預設：老師可以打開預設關的檔位與形狀（#18 決定），也可以加題數
  const opened = resolveParams(profile, { overrides: { tiers: ["add-two-carries", "sub-borrow-from-zero"], shapes: [[2, 2], [2, 1]], count: 20 } });
  assert.deepEqual(opened.params.tiers, ["add-two-carries", "sub-borrow-from-zero"]);
  assert.equal(opened.count, 20);
  const afterAdjust = resolveParams(profile, { adjustment: "simplify", overrides: { tiers: ["add-one-carry"] } });
  assert.deepEqual(afterAdjust.params.tiers, ["add-one-carry"], "調整只是預設方案，覆寫仍以條件檔為上限");
  assert.throws(() => resolveParams(profile, { overrides: { tiers: ["add-three-carries"] } }), /檔位 "add-three-carries" 不在條件檔/);
  assert.throws(() => resolveParams(profile, { overrides: { shapes: [[3, 3]] } }), /形狀 \[3,3\] 不在/);
  assert.throws(() => resolveParams(profile, { adjustment: "harder" }), /未知調整/);
  assert.throws(() => resolveParams(profile, { mode: "exam" }), /mode/);
  assert.throws(() => resolveParams(profile, { overrides: { scaffold: "full" } }), /scaffold 覆寫必須是 \{ assess, practice \} 物件/);
  assert.equal(resolveParams(profile, { overrides: { scaffold: { assess: "partial" } } }).params.scaffold, "partial");
  assert.throws(() => resolveParams(profile, { overrides: { tiers: ["add-one-carry"], operations: ["sub"] } }), /operations 沒有 add/);
});

test("checkParams：每一種越界都有可讀訊息", () => {
  const ok = resolveParams(profile).params;
  assert.deepEqual(checkParams(profile, ok), []);
  const bad = (patch, re) => assert.match(checkParams(profile, { ...ok, ...patch }).join("；"), re);
  bad({ tiers: [] }, /tiers 必須/);
  bad({ tiers: ["add-no-carry", "add-no-carry"] }, /不可重複/);
  bad({ weights: { "add-two-carries": 1 } }, /weights 的 add-two-carries 不在 tiers/);
  bad({ weights: { "add-no-carry": 0 } }, /必須是正數/);
  bad({ operations: ["mul"] }, /operations 必須/);
  bad({ presentation: "grid" }, /presentation/);
  bad({ scaffold: "lots" }, /scaffold/);
  bad({ context: "yes" }, /context 必須是布林/);
  bad({ distinct: 1 }, /distinct/);
  bad({ context_pools: { people: "p" } }, /未知鍵/);
  bad({ context_pools: { subjects: "" } }, /必須是池 id/);
  bad({ extra: 1 }, /未知參數/);
  assert.deepEqual(checkParams(profile, null), ["params 必須是物件"]);
});

test("六個檔位各抽 200 題：條件全滿足、數字形狀正確、不重複、a ≠ b、減法 a > b", () => {
  for (const [tierId, def] of Object.entries(profile.tiers)) {
    for (const shape of profile.shapes.allowed) {
      const params = resolveParams(profile, { overrides: { tiers: [tierId], shapes: [shape], context: false, distinct: false } }).params;
      const batch = instantiate(item(params, { count: 200 }), { seed: `t-${tierId}` });
      assert.equal(batch.length, 200);
      for (const q of batch) {
        const { a, b } = q.variables;
        const info = analyze(def.operation, a, b);
        assert.equal(q.tier, tierId);
        assert.ok(a !== b, `${a} = ${b}`);
        assert.equal(String(a).length, shape[0], `${a} 不是 ${shape[0]} 位數`);
        assert.equal(String(b).length, shape[1], `${b} 不是 ${shape[1]} 位數`);
        if (def.operation === "sub") assert.ok(a > b, `${a} − ${b}`);
        if (def.carries !== undefined) assert.equal(info.carries, def.carries, `${a}+${b} 進位 ${info.carries} 次`);
        if (def.borrows !== undefined) assert.equal(info.borrows, def.borrows, `${a}−${b} 退位 ${info.borrows} 次`);
        if (def.minuend_ones_zero !== undefined) assert.equal(a % 10 === 0, def.minuend_ones_zero, `${a} 個位`);
        if (tierId === "add-two-carries") assert.ok(info.result >= 100);
        if (tierId === "add-one-carry") assert.ok(info.result >= 10);
      }
    }
  }
  // 不重複：二位數不進位加法的不重複組合夠多，60 題必須全部不同
  const distinct = instantiate(item(resolveParams(profile, { overrides: { tiers: ["add-no-carry"], context: false } }).params, { count: 60 }), { seed: "d" });
  const keys = distinct.map(({ variables: { a, b } }) => (a <= b ? `${a}+${b}` : `${b}+${a}`));
  assert.equal(new Set(keys).size, 60);
});

test("權重配比：7：3 的大樣本落在合理區間；只開一檔就全是那一檔", () => {
  const params = resolveParams(profile, { overrides: { tiers: ["add-no-carry", "add-one-carry"], context: false, distinct: false } }).params;
  const batch = instantiate(item(params, { count: 1000 }), { seed: "w" });
  const share = batch.filter((q) => q.tier === "add-one-carry").length / 1000;
  assert.ok(share > 0.62 && share < 0.78, `進位檔占比 ${share}`);
  const only = instantiate(item(resolveParams(profile, { overrides: { tiers: ["sub-borrow-from-zero"], context: false, distinct: false } }).params, { count: 50 }), { seed: "o" });
  assert.ok(only.every((q) => q.tier === "sub-borrow-from-zero" && q.variables.a % 10 === 0));
});

test("決定性：同 item 同 seed 深相等，不同 seed 不同；不改動 item", async () => {
  const pools = await poolsPromise;
  const example = structuredClone(await examplePromise);
  const frozen = structuredClone(example);
  const x1 = instantiate(example, { seed: "s1", pools });
  const x2 = instantiate(example, { seed: "s1", pools });
  const y = instantiate(example, { seed: "s2", pools });
  assert.deepEqual(x1, x2);
  assert.notDeepEqual(x1, y);
  assert.deepEqual(example, frozen);
});

test("直式實例：通過 instance schema、每位一格、和 ≥ 100 才有百位、標準答案 correct、錯一格 partial", async () => {
  const { validateInstance } = await ajvPromise;
  const pools = await poolsPromise;
  const example = await examplePromise;
  const batch = instantiate(example, { seed: "demo", pools });
  assert.equal(batch.length, 10);
  for (const q of batch) {
    assert.ok(validateInstance(q), JSON.stringify(validateInstance.errors));
    assert.equal(q.type, "blanks");
    assert.deepEqual(q.ladder_ids, [A2]);
    const places = q.variables.result >= 100 ? ["ones", "tens", "hundreds"] : ["ones", "tens"];
    assert.deepEqual(q.blanks.map((b) => b.id), places);
    assert.deepEqual(q.display.places, places);
    assert.equal(q.display.scaffold, "none");
    assert.equal(q.display.carry_marks, true);
    for (const p of places) assert.match(q.stem.text.text, new RegExp(`\\[\\[${p}\\]\\]`));
    const digits = places.map((p) => q.blanks.find((b) => b.id === p).answer);
    assert.equal(digits.reduce((n, d, i) => n + d * 10 ** i, 0), q.variables.result, "各位數字拼回結果");
    assert.equal(score(q, canonical(q)).outcome, "correct");
    const wrong = canonical(q); wrong.blanks.ones = (wrong.blanks.ones + 1) % 10;
    assert.equal(score(q, wrong).outcome, places.length > 1 ? "partial" : "incorrect");
  }
  const two = instantiate(item(resolveParams(profile, { overrides: { tiers: ["add-two-carries"], context: false } }).params, { count: 5 }), { seed: "h" });
  for (const q of two) assert.deepEqual(q.blanks.map((b) => b.id), ["ones", "tens", "hundreds"]);
});

test("橫式實例：numeric、answer 正確、display 帶 operation 與 scaffold", async () => {
  const { validateInstance } = await ajvPromise;
  const params = resolveParams(profile, { adjustment: "substitute", mode: "practice" }).params;
  const batch = instantiate(item(params, { type: "numeric", count: 6 }), { seed: "n" });
  for (const q of batch) {
    assert.ok(validateInstance(q), JSON.stringify(validateInstance.errors));
    assert.equal(q.type, "numeric");
    assert.equal(q.answer, q.variables.result);
    assert.equal(q.display.layout, "horizontal");
    assert.deepEqual(q.input, { min: 0, max: 999, decimals: 0 });
    assert.equal(q.display.scaffold, "full");
    assert.ok(["add", "sub"].includes(q.display.operation));
    assert.equal(score(q, { value: q.answer }).outcome, "correct");
    assert.equal(q.stem.text.text, `${q.variables.a} ${q.variables.op} ${q.variables.b} = ？`);
  }
});

test("提示與回饋：用條件檔範本代入變數；題目自己寫就覆寫；減法範本用退位變數", async () => {
  const params = resolveParams(profile, { overrides: { tiers: ["add-one-carry"], context: false } }).params;
  // 挑一個「個位進位」的實例（十位進位的子情形在變體測試另測）
  const q = instantiate(item(params, { count: 20, distinct: false }), { seed: "h1" }).find((x) => x.variables.carry === 1);
  const { a_ones, b_ones, ones_sum, ones, a, b, sum } = q.variables;
  assert.equal(q.hints[0].text, `先算個位：${a_ones} 加 ${b_ones}，有沒有滿 10？`);
  assert.equal(q.hints[1].text, `${a_ones} 加 ${b_ones} 是 ${ones_sum}，滿 10 了，要進位：10 個一換成 1 個十，個位寫 ${ones}，在十位上面寫小小的 1。`);
  assert.equal(q.feedback.correct.text, `答對了！${a} ＋ ${b} 等於 ${sum}。`);
  assert.equal(q.feedback.retry.text, "再檢查一次個位：有沒有要進位？");
  assert.ok(q.hints.every((h) => !h.text.includes("{")), "範本變數都要被代入");

  const subParams = resolveParams(profile, { overrides: { tiers: ["sub-one-borrow"], context: false } }).params;
  const [s] = instantiate(item(subParams, { count: 1 }), { seed: "h2" });
  const sv = s.variables;
  assert.equal(s.hints[1].text, `${sv.a_ones} 比 ${sv.b_ones} 小，不夠減，要退位：從十位退 1 個十，換成 10 個一，個位變成 ${sv.a_ones + 10}；${sv.a_ones + 10} 減 ${sv.b_ones} 是 ${sv.ones}，個位寫 ${sv.ones}。`);
  assert.equal(s.hints[2].text, `十位退了 1 個十，剩 ${sv.a_tens - 1}；${sv.a_tens - 1} 減 ${sv.b_tens} 是 ${sv.tens}，十位寫 ${sv.tens}，答案是 ${sv.diff}。`);
  assert.ok(!s.hints.some((h) => h.text.includes("借")), "課程手冊用「退位」，提示不說「借」");
  assert.equal(s.feedback.retry.text, "再檢查一次個位：有沒有要退位？");

  const own = instantiate(item(params, {
    count: 1,
    hints: [{ text: "自己寫的 {a}", audio: null }, { text: "二", audio: null }, { text: "三", audio: null }],
    feedback: { correct: { text: "好", audio: null }, retry: { text: "再來 {b}", audio: null } },
  }), { seed: "h1" })[0];
  assert.equal(own.hints[0].text, `自己寫的 ${own.variables.a}`);
  assert.equal(own.feedback.retry.text, `再來 ${own.variables.b}`);
});

test("情境：有池就用情境句並附算式，池缺某欄就只用不需要那欄的範本，沒池就退回算式", async () => {
  const pools = await poolsPromise;
  const example = await examplePromise;
  const withPools = instantiate(example, { seed: "ctx", pools });
  for (const q of withPools) {
    const { a, b, op } = q.variables;
    assert.match(q.stem.text.text, new RegExp(`算式：${a} ${op} ${b}`));
    assert.ok(q.variables.item && q.variables.unit, "情境變數要記進 variables");
    assert.ok(!q.stem.text.text.includes("{"), q.stem.text.text);
  }
  const noPools = instantiate(example, { seed: "ctx" });
  for (const q of noPools) assert.match(q.stem.text.text, /^\d+ [＋－] \d+，/);
  // 只給物品池：角色與動作的範本不可用，只能用「盒子裡有」範本
  const onlyItems = new Map([["p-math-items", pools.get("p-math-items")]]);
  const partial = instantiate({ ...example, params: { ...example.params, context_pools: { items: "p-math-items" } } }, { seed: "ctx", pools: onlyItems });
  for (const q of partial) assert.match(q.stem.text.text, /^盒子裡有/);
  // 池條目沒有 unit 時用「個」
  const noUnit = new Map([["p-math-items", { entries: [{ text: { text: "球", audio: null } }] }]]);
  const generic = instantiate({ ...example, params: { ...example.params, context_pools: { items: "p-math-items" } } }, { seed: "ctx", pools: noUnit });
  assert.match(generic[0].stem.text.text, /個球/);
});

test("守門：沒有條件檔、兩份條件檔、產生器不符、參數越界、不可能的檔位", () => {
  const params = resolveParams(profile, { overrides: { context: false } }).params;
  assert.throws(() => instantiate(item(params, { ladder_ids: ["c-x"] }), { seed: "s" }), /需要條件檔/);
  assert.throws(() => instantiate(item(params, { generator: "math.add-2digit-carry" }), { seed: "s" }), /條件檔 n-I-2#a@2 指定產生器 math.add-sub/);
  assert.throws(() => instantiate(item({ ...params, tiers: ["nope"] }), { seed: "s" }), /檔位 "nope" 不在條件檔/);
  assert.throws(() => instantiate(item({ ...params, shapes: [[3, 3]] }), { seed: "s" }), /形狀/);
  assert.equal(profileForItem(item(params)), profile);
  assert.throws(() => instantiate(item(params, { generator_version: 2 }), { seed: "s" }), /version 1.*要求 version 2/);
  assert.equal(profileForItem(item(params, { ladder_ids: ["c-x"] })), null);
  // 二位減一位且被減數個位為 0、退位一次：可行（例 40−7）；但要求退位 0 次且被減數個位為 0 又 a>b 的一位減數：a1=0 < b1 恆退位 → 抽不到
  const impossible = { ...profile, tiers: { ...profile.tiers, "sub-zero-no-borrow": { label: "測試用", operation: "sub", borrows: 0, minuend_ones_zero: true } } };
  const gen = generators["math.add-sub"];
  assert.throws(() => gen.generate({ params: { ...params, tiers: ["sub-zero-no-borrow"], weights: {}, shapes: [[2, 1]] }, seed: "x", count: 1, profile: impossible }), /抽不到符合檔位「測試用」/);
});

test("驗證器：範例包通過；參數超出條件檔、沒有條件檔的產生題、缺 ladder_ids、產生器不符都被擋下並給可讀訊息", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-profiles-"));
  await cp(EXAMPLE, dir, { recursive: true });
  const itemPath = path.join(dir, "items/i-gen-add-sub-a2.json");
  const original = JSON.parse(await readFile(itemPath, "utf8"));
  const rehash = async () => {
    const { createHash } = await import("node:crypto");
    const p = path.join(dir, "pack.json");
    const pack = JSON.parse(await readFile(p, "utf8"));
    for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
    await writeFile(p, JSON.stringify(pack, null, 2));
  };
  const run = async (mutate) => {
    const o = structuredClone(original); mutate(o);
    await writeFile(itemPath, JSON.stringify(o, null, 2));
    await rehash();
    return validatePack(dir);
  };
  try {
    const ok = await validatePack(dir);
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.ok, true);
    const r1 = await run((o) => { o.params.tiers.push("add-three-carries"); });
    assert.ok(r1.errors.some((e) => /i-gen-add-sub-a2.*params: 檔位 "add-three-carries" 不在條件檔/.test(e)), r1.errors.join("\n"));
    const r2 = await run((o) => { o.ladder_ids = ["n-I-2#b@2"]; });
    assert.ok(r2.errors.some((e) => /沒有任何一條有條件檔/.test(e)), r2.errors.join("\n"));
    const r3 = await run((o) => { delete o.ladder_ids; });
    assert.ok(r3.errors.some((e) => /i-gen-add-sub-a2.*ladder_ids/.test(e)), r3.errors.join("\n"));
    const r4 = await run((o) => { o.generator = "math.add-2digit-carry"; });
    assert.ok(r4.errors.some((e) => /generator math.add-2digit-carry 與條件檔 n-I-2#a@2 指定的 math.add-sub 不符/.test(e)), r4.errors.join("\n"));
    const r5 = await run((o) => { o.params.context_pools.items = "p-nope"; });
    assert.ok(r5.errors.some((e) => /context_pools.items 引用的池 p-nope 不在/.test(e)), r5.errors.join("\n"));
    const r6 = await run((o) => { o.params.scaffold = "lots"; });
    assert.ok(r6.errors.some((e) => /params\/scaffold/.test(e)), r6.errors.join("\n"));
    // 固定題也必須有 ladder_ids
    const tfPath = path.join(dir, "items/i-tf-01.json");
    const tf = JSON.parse(await readFile(tfPath, "utf8")); delete tf.ladder_ids;
    await writeFile(tfPath, JSON.stringify(tf, null, 2)); await rehash();
    const r7 = await validatePack(dir);
    assert.ok(r7.errors.some((e) => e.startsWith("items/i-tf-01.json") && /ladder_ids/.test(e)), r7.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkGeneratedItem 是純函式：給驗證器與平台共用", async () => {
  const v = await loadValidators();
  const example = await examplePromise;
  const pools = await poolsPromise;
  assert.deepEqual(checkGeneratedItem(example, { validateParams: v.params[example.generator], pools }), { errors: [], warnings: [] });
  const two = { ...example, ladder_ids: [A2, A2] };
  assert.match(checkGeneratedItem(two, { validateParams: v.params[example.generator], pools }).errors.join(), /對到 2 份條件檔/);
  const unknown = { ...example, ladder_ids: ["n-II-2#b@1"], generator: "math.nope" };
  assert.match(checkGeneratedItem(unknown, { validateParams: undefined, pools }).errors.join(), /generator math.nope 未登錄/);
  const badVersion = { ...example, generator_version: 2 };
  assert.match(checkGeneratedItem(badVersion, { validateParams: v.params[example.generator], pools }).errors.join(), /generator_version 2/);
  // legacy 產生器：沒有條件檔只警告，params 仍過形狀 schema
  const legacy = { ...example, type: "numeric", ladder_ids: ["n-II-2#b@1"], generator: "math.add-2digit-carry", params: { min: 10, max: 99, require_carry: true }, hints: example_hints(), feedback: example_feedback() };
  const l = checkGeneratedItem(legacy, { validateParams: v.params[legacy.generator], pools });
  assert.deepEqual(l.errors, []);
  assert.match(l.warnings.join(), /legacy/);
  const noHints = { ...legacy }; delete noHints.hints;
  assert.match(checkGeneratedItem(noHints, { validateParams: v.params[legacy.generator], pools }).errors.join(), /必須自己寫 hints 與 feedback/);
  const legacyBad = { ...legacy, params: { min: "10" } };
  assert.match(checkGeneratedItem(legacyBad, { validateParams: v.params[legacy.generator], pools }).errors.join(), /params\/min/);
  assert.equal(generators["math.add-2digit-carry"].legacy, true);
  assert.equal(generators["math.add-sub"].legacy, false);
  // instantiate 對 legacy 題照常展開
  assert.equal(instantiate({ ...legacy, count: 2 }, { seed: "l" }).length, 2);
});

test("--ladder-dir：有 kit checkout 時範例的 ladder_ids 全部存在；假目錄的 id 會被擋", async () => {
  const kitDir = path.join(ROOT, "..", "sped-student-kit", "data", "ladder");
  const dir = await mkdtemp(path.join(tmpdir(), "udl-ladder-"));
  try {
    await writeFile(path.join(dir, "fake.json"), JSON.stringify([{ id: "n-I-2#a@2" }]));
    const r = await validatePack(EXAMPLE, { ladderDir: dir });
    assert.ok(r.errors.some((e) => /ladder_id 5-Ⅲ-3#a@6 不在 kit 階梯資料/.test(e)), r.errors.join("\n"));
    assert.ok(!r.errors.some((e) => /ladder_id n-I-2#a@2/.test(e)));
    let hasKit = false;
    try { await readFile(path.join(kitDir, "math-number.json")); hasKit = true; } catch { /* 沒有 kit checkout 就略過 */ }
    if (hasKit) {
      const real = await validatePack(EXAMPLE, { ladderDir: kitDir });
      assert.deepEqual(real.errors, []);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("提示變體：十位進位的 add-one-carry 不再說個位進 1；一位數形狀不說「加 0」；變體記在 variables", () => {
  assert.deepEqual(hintVariants(analyze("add", 80, 25), [2, 2]), ["tens-carry"]);
  assert.deepEqual(hintVariants(analyze("add", 38, 47), [2, 2]), ["ones-carry"]);
  assert.deepEqual(hintVariants(analyze("add", 38, 7), [2, 1]), ["ones-carry", "one-digit"]);
  assert.deepEqual(hintVariants(analyze("sub", 45, 8), [2, 1]), ["one-digit"]);
  assert.deepEqual(hintVariants(analyze("add", 57, 65), [2, 2]), []);
  assert.equal(analyze("add", 80, 25).tens_sum, 10);
  assert.equal(analyze("add", 38, 47).tens_sum, 8, "十位和含個位進位");
  assert.equal(analyze("sub", 45, 2).a_ones_borrowed, undefined, "沒退位就沒有借位變數");
  assert.equal(analyze("sub", 45, 8).a_ones_borrowed, 15);

  const params = resolveParams(profile, { overrides: { tiers: ["add-one-carry"], context: false, distinct: false } }).params;
  const batch = instantiate(item(params, { count: 300 }), { seed: "variants" });
  let tensCarry = 0;
  for (const q of batch) {
    const v = q.variables;
    if (v.carry_tens === 1) {
      tensCarry += 1;
      assert.equal(v.hint_variant, "tens-carry");
      assert.equal(q.hints[0].text, `先算個位：${v.a_ones} 加 ${v.b_ones} 是 ${v.ones}，沒有滿 10，不用進位，個位寫 ${v.ones}。`);
      assert.equal(q.hints[1].text, `再算十位：${v.a_tens} 加 ${v.b_tens} 是 ${v.tens_sum}，滿 10 了，要進位：10 個十換成 1 個百。`);
      assert.ok(v.tens_sum >= 10 && v.tens_sum <= 18);
      assert.equal(q.hints[2].text, `十位寫 ${v.tens}，百位寫 1，答案是 ${v.sum}。`);
      assert.ok(v.sum >= 100);
    } else {
      assert.equal(v.hint_variant, "default", "個位進位沒有專屬變體，實際用的是 default，事件要記 default 而不是候選");
      assert.ok(q.hints[1].text.startsWith(`${v.a_ones} 加 ${v.b_ones} 是 ${v.ones_sum}，滿 10 了，要進位`), q.hints[1].text);
      assert.ok(!q.hints[2].text.includes("百位"));
    }
    assert.ok(q.hints.every((h) => !h.text.includes("滿 10 了") || v.carry === 1 || v.carry_tens === 1));
  }
  assert.ok(tensCarry > 30, `十位進位子情形太少（${tensCarry}）`);

  // 所有檔位 × [2,1]：每一句提示都不能出現「加 0」「減 0」（含「加 0 再加 1」這種中間位置），也不能剩下未代入的變數
  const one = resolveParams(profile, { overrides: { tiers: Object.keys(profile.tiers), shapes: [[2, 1]], context: false, distinct: false } }).params;
  const oneBatch = instantiate(item(one, { count: 240 }), { seed: "one" });
  for (const q of oneBatch) {
    assert.equal(q.variables.hint_variant, "one-digit", "每個檔位都有 one-digit 變體，[2,1] 一律用它");
    for (const h of q.hints) {
      assert.ok(!/[加減] 0(?![0-9])/.test(h.text), h.text);
      assert.ok(!h.text.includes("{"), h.text);
    }
  }
  assert.ok(oneBatch.some((q) => q.tier === "add-two-carries"), "[2,1] 也要抽到進兩次的題");
  // 「滿 10」措辭對 tens_sum 恰為 10 也成立；「超過 10」只用在個位（ones_sum ≥ 10 時必 > 9，但要確認沒有 = 10 被說成超過）
  for (const q of instantiate(item(resolveParams(profile, { overrides: { tiers: ["add-two-carries"], context: false, distinct: false } }).params, { count: 100 }), { seed: "two" })) {
    assert.match(q.hints[1].text, /是 \d+，又滿 10 了/);
    assert.match(q.hints[0].text, /是 \d+，滿 10 了，個位寫 \d，進 1 到十位/);
    assert.ok(q.variables.tens_sum >= 10);
  }
});

test("--ladder-dir=<dir> 寫法與壞 JSON 的錯誤訊息", async () => {
  const { spawnSync } = await import("node:child_process");
  const dir = await mkdtemp(path.join(tmpdir(), "udl-ladder-eq-"));
  try {
    await writeFile(path.join(dir, "fake.json"), JSON.stringify([{ id: "n-I-2#a@2" }, { id: "5-Ⅲ-3#a@6" }, { id: "4-Ⅲ-1#c@6" }, { id: "6-Ⅲ-6#a" }]));
    const run = (args) => spawnSync(process.execPath, [path.join(ROOT, "conformance/validate.mjs"), ...args], { encoding: "utf8" });
    const eq = run([EXAMPLE, `--ladder-dir=${dir}`]);
    assert.equal(eq.status, 0, eq.stdout + eq.stderr);
    const flagFirst = run(["--ladder-dir", dir, EXAMPLE]);
    assert.equal(flagFirst.status, 0, flagFirst.stdout + flagFirst.stderr);
    const missingValue = run([EXAMPLE, "--ladder-dir"]);
    assert.equal(missingValue.status, 2);
    await writeFile(path.join(dir, "broken.json"), "{not json");
    await assert.rejects(validatePack(EXAMPLE, { ladderDir: dir }), /broken\.json.*不是合法 JSON/);
    const cli = run([EXAMPLE, "--ladder-dir", dir]);
    assert.equal(cli.status, 2);
    assert.match(cli.stderr, /無法讀取階梯資料.*broken\.json/);
    assert.ok(!cli.stderr.includes("    at "), "CLI 不該噴 stack");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
