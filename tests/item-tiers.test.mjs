// MAPS metadata and sampling use synthetic questions only (#96, udl-learning#794).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as spec from "../activities/index.mjs";
import { loadValidators } from "../conformance/validate.mjs";
import { validateEvents } from "../conformance/validate-events.mjs";
import { answeredFields, createEventsFile, pushEvent } from "../events/index.mjs";
import { instantiate } from "../generators/index.mjs";
import { score } from "../question-types/index.mjs";

const spoken = (text) => ({ text, audio: null });
const unit = { id: "u-garden", subject: "chinese", grade: 4, ladder_ids: ["5-Ⅱ-6#b"] };
const cards = { chars: [], words: [], patterns: [], skills: [] };
const item = (id, extra = {}) => ({ format_version: 1, id, unit: unit.id, type: "choice", kind: "fixed",
  skill: "課文理解", difficulty: 2, ladder_ids: unit.ladder_ids, stem: { text: spoken(`花園裡的${id}在哪裡？`) },
  options: [{ id: "a", text: spoken("窗邊") }, { id: "b", text: spoken("門外") }], answer: "a",
  hints: [spoken("找位置。"), spoken("看窗戶。"), spoken("就在窗邊。")],
  feedback: { correct: spoken("你找到線索了。"), retry: spoken("再看看位置。") }, ...extra });
const items = [item("i-old"), item("i-retrieve", { level: "retrieve", item_tier: "regular" }),
  item("i-infer", { level: "infer", item_tier: "advanced" }), item("i-interpret", { level: "interpret", item_tier: "advanced" })];
const materials = [{ format_version: 1, id: "m-garden", unit: unit.id, kind: "lesson", title: spoken("花園"),
  blocks: ["花開了", "鳥來了"].map((s) => ({ type: "text", content: spoken(s), gist: spoken(s) })) }];
const context = { unit, cards, items, materials, seed: "tiers", count: "all" };
const ids = (qs) => qs.map((q) => q.item ?? q.id).sort();

test("item schema accepts optional level/item_tier, preserves old items, and rejects malformed advanced metadata", async () => {
  const v = await loadValidators();
  for (const q of items) assert.equal(v.item(q), true, JSON.stringify(v.item.errors));
  for (const extra of [{ level: "other" }, { item_tier: "all" }, { level: null }, { item_tier: "advanced" },
    { level: "retrieve", item_tier: "advanced" }]) {
    assert.equal(v.item(item("i-bad", extra)), false, JSON.stringify(extra));
  }
});

test("default sampling removes advanced candidates before count/all/cycling, without mutating inputs", () => {
  const before = structuredClone(context);
  for (let seed = 0; seed < 40; seed++) {
    assert.deepEqual(ids(spec.generate("reading-items", { ...context, seed })), ["i-old", "i-retrieve"]);
    const repeated = spec.generate("reading-items", { ...context, seed, count: 7 });
    assert.equal(repeated.length, 7);
    assert.ok(repeated.every((q) => q.item_tier !== "advanced"));
  }
  assert.deepEqual(context, before);
});

test("advanced/all scopes select exactly their candidates and remain deterministic", () => {
  assert.deepEqual(ids(spec.generate("reading-items", { ...context, item_tier: "advanced" })), ["i-infer", "i-interpret"]);
  assert.deepEqual(ids(spec.generate("reading-items", { ...context, item_tier: "all" })), items.map((i) => i.id).sort());
  const ctx = { ...context, item_tier: "advanced", count: 1 };
  assert.deepEqual(spec.generate("reading-items", ctx), spec.generate("reading-items", ctx));
});

test("mix and blueprint quiz do not fill advanced requests with ordinary material-generated questions", () => {
  const sources = ["para-gist", "reading-items"];
  for (const item_tier of ["regular", "advanced", "all"]) {
    const mix = spec.generate("mix", { ...context, sources, item_tier });
    const quiz = spec.generate("quiz", { ...context, item_tier, count: undefined, blueprint: [{ group: "reading", count: 8, sources }] });
    for (const qs of [mix, quiz]) {
      assert.ok(qs.length);
      assert.ok(qs.every((q) => item_tier === "all" || (q.item_tier ?? "regular") === item_tier));
      if (item_tier === "advanced") assert.deepEqual(ids(qs), ["i-infer", "i-interpret"]);
    }
  }
});

test("advanced quiz without blueprint uses its fixed question pool and never falls back to ordinary cards", () => {
  const qs = spec.generate("quiz", { ...context, item_tier: "advanced", count: 2 });
  assert.deepEqual(ids(qs), ["i-infer", "i-interpret"]);
  assert.equal(spec.generate("quiz", { ...context, item_tier: "advanced", count: 20 }).length, 2);
});

test("key reconstruction applies the same default and explicit tier policies", () => {
  const keys = items.map((i) => `reading-items|${i.id}`);
  const regular = spec.generateByKeys(keys, context);
  assert.deepEqual(ids(regular.instances), ["i-old", "i-retrieve"]);
  assert.equal(regular.missing.length, 2);
  const advanced = spec.generateByKeys(keys, { ...context, item_tier: "advanced" });
  assert.deepEqual(ids(advanced.instances), ["i-infer", "i-interpret"]);
  assert.equal(advanced.missing.length, 2);
  assert.equal(spec.generateByKeys(keys, { ...context, item_tier: "all" }).instances.length, 4);
});

test("empty scopes yield no questions, invalid scope/configuration fails closed", () => {
  assert.deepEqual(spec.generate("reading-items", { ...context, items: items.slice(0, 2), item_tier: "advanced" }), []);
  assert.deepEqual(spec.generate("reading-items", { ...context, items: items.slice(2) }), []);
  assert.deepEqual(spec.generate("para-gist", { ...context, item_tier: "advanced" }), []);
  assert.throws(() => spec.generate("reading-items", { ...context, item_tier: "typo" }), /item_tier/);
  assert.throws(() => spec.generateByKeys([], { ...context, item_tier: null }), /item_tier/);
  assert.throws(() => spec.generate("reading-items", { ...context, item_tier: "advanced", count: 0 }), /count/);
  assert.throws(() => spec.generate("mix", { ...context, item_tier: "advanced", sources: ["not-an-activity"] }), /不能|sources/);
});

test("shared eligibility is explicit, treats legacy as regular, and never reuses generator tier", () => {
  assert.equal(typeof spec.itemTierEligible, "function");
  assert.equal(spec.itemTierEligible({ tier: "hard" }), true);
  assert.equal(spec.itemTierEligible(items[2]), false);
  assert.equal(spec.itemTierEligible(items[2], "advanced"), true);
  assert.equal(spec.itemTierEligible({ item_tier: "advanced", level: "retrieve" }, "all"), false);
});

test("tagged fixed instances round-trip through item shape and answered events", async () => {
  const q = spec.generate("reading-items", { ...context, item_tier: "advanced", count: 1 })[0];
  const shape = spec.toItemShape(q);
  assert.equal(shape.level, q.level);
  assert.equal(shape.item_tier, "advanced");
  // Shell sessions normalize non-generator activity instances into fixed items.
  const event = answeredFields({ ...q, kind: "fixed" }, score(q, { option: q.answer }), { attempt_no: 1, response_ms: 100 });
  assert.equal(event.level, q.level);
  assert.equal(event.item_tier, "advanced");
  const file = createEventsFile({ producer: { shell: "test", shell_version: "1", granularity: "item" },
    actor: { role: "student", student_code: "S03" }, context: { session_id: "hunt-tiers", mode: "practice", pack: { id: "garden", version: "1" } } });
  pushEvent(file, "session-started"); pushEvent(file, "answered", event);
  const result = await validateEvents(file);
  assert.deepEqual(result.errors, []);
  file.events[1].level = "retrieve";
  assert.equal((await validateEvents(file)).ok, false, "advanced event cannot be relabelled retrieve");
});

test("numeric generator instances preserve item classification separately from their existing generator tier", async () => {
  const q = JSON.parse(await readFile(new URL("../examples/minimal/items/i-gen-add-sub-a2.json", import.meta.url), "utf8"));
  const pools = {};
  for (const id of Object.values(q.params.context_pools)) pools[id] = JSON.parse(await readFile(new URL(`../examples/minimal/pools/${id}.json`, import.meta.url), "utf8"));
  q.level = "infer"; q.item_tier = "advanced";
  const [inst] = instantiate(q, { seed: "tier-trace", pools });
  assert.equal(inst.level, "infer"); assert.equal(inst.item_tier, "advanced");
  const v = await loadValidators();
  assert.equal(v.instance(inst), true, JSON.stringify(v.instance.errors));
  const response = { blanks: Object.fromEntries(inst.blanks.map((b) => [b.id, b.answer])) };
  const ev = answeredFields(inst, score(inst, response), { attempt_no: 1, response_ms: 100 });
  assert.equal(ev.level, "infer"); assert.equal(ev.item_tier, "advanced");
  assert.equal(ev.generated.tier, inst.tier);
});
