import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { types, planned, reserved, getType, score, RESULT_SCHEMA_PATH } from "../question-types/index.mjs";
import { withinTolerance } from "../question-types/numeric/score.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const readJson = async (rel) => JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));

// 與 conformance/validate.mjs 同樣的 ajv 設定，確保 response／result schema 在 strict 模式可編譯。
async function loadAjv() {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(await readJson("schema/common.schema.json"));
  const validateResult = ajv.compile(await readJson(RESULT_SCHEMA_PATH));
  const validateResponse = {};
  for (const t of Object.values(types)) validateResponse[t.type] = ajv.compile(await readJson(t.responseSchemaPath));
  return { validateResult, validateResponse };
}
const ajvPromise = loadAjv();

// 每個結果都要通過 result.schema.json；順手把輸入凍結，確保 score() 不改輸入。
async function run(question, response) {
  const { validateResult } = await ajvPromise;
  const q = deepFreeze(structuredClone(question));
  const r = response === undefined ? undefined : deepFreeze(structuredClone(response));
  const out = score(q, r);
  assert.ok(validateResult(out), `結果不符 result.schema.json：${JSON.stringify(validateResult.errors)}`);
  assert.deepEqual(score(q, r), out, "同樣輸入兩次結果不同");
  return out;
}
function deepFreeze(v) {
  if (v && typeof v === "object") {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

const choiceQ = {
  type: "choice", kind: "fixed", id: "i-c",
  options: [{ id: "a", text: { text: "甲", audio: null } }, { id: "b", text: { text: "乙", audio: null } }, { id: "c", text: { text: "丙", audio: null } }],
  answer: "b",
};
const tfQ = { type: "true-false", kind: "fixed", id: "i-tf", answer: false };
const matchQ = {
  type: "match", kind: "fixed", id: "i-m",
  pairs: [
    { id: "p1", left: { text: "一", audio: null }, right: { text: "1", audio: null } },
    { id: "p2", left: { text: "二", audio: null }, right: { text: "2", audio: null } },
    { id: "p3", left: { text: "三", audio: null }, right: { text: "3", audio: null } },
  ],
};
const numQ = (extra = {}) => ({ type: "numeric", kind: "fixed", id: "i-n", answer: 42, ...extra });

test("登錄表：四種 v1 題型、v2 候選、v3 保留", () => {
  assert.deepEqual(Object.keys(types).sort(), ["choice", "match", "numeric", "true-false"]);
  for (const t of Object.values(types)) {
    assert.equal(t.version, 1);
    assert.equal(typeof t.score, "function");
  }
  assert.deepEqual([...planned], ["blanks", "ordering", "classify"]);
  assert.deepEqual([...reserved], ["drawing", "speaking"]);
  assert.equal(getType("choice").type, "choice");
  assert.equal(getType("blanks"), null);
  assert.throws(() => score({ type: "blanks" }, {}), /v2 候選/);
  assert.throws(() => score({ type: "speaking" }, {}), /v3 保留/);
  assert.throws(() => score({ type: "essay" }, {}), /未登錄/);
});

test("response 與 result schema 在 ajv strict 可編譯，且作答範例通過", async () => {
  const { validateResponse } = await ajvPromise;
  assert.ok(validateResponse.choice({ option: "a" }));
  assert.ok(!validateResponse.choice({ option: "A" }), "大寫不是合法 id");
  assert.ok(!validateResponse.choice({}));
  assert.ok(validateResponse["true-false"]({ value: false }));
  assert.ok(!validateResponse["true-false"]({ value: "true" }));
  assert.ok(validateResponse.match({ pairs: { p1: "p2" } }));
  assert.ok(!validateResponse.match({ pairs: { p1: 1 } }));
  assert.ok(validateResponse.numeric({ value: 3.5 }));
  assert.ok(!validateResponse.numeric({ value: "42" }));
  assert.ok(!validateResponse.numeric({ value: 1, extra: true }), "多餘欄位不放行");
});

test("generated 模板不能直接計分；型別不符丟錯", () => {
  assert.throws(() => score({ type: "numeric", kind: "generated", generator: "x" }, { value: 1 }), /產生器/);
  assert.throws(() => types.choice.score(tfQ, { option: "a" }), /question\.type/);
  assert.throws(() => types.choice.score({ type: "choice", kind: "fixed" }, { option: "a" }), /options/);
  assert.throws(() => types.numeric.score({ type: "numeric", kind: "fixed", answer: "42" }, { value: 42 }), /answer/);
  assert.throws(() => types.match.score({ type: "match", kind: "fixed", pairs: [] }, { pairs: {} }), /pairs/);
});

test("choice：對、錯、invalid", async () => {
  let r = await run(choiceQ, { option: "b" });
  assert.equal(r.outcome, "correct");
  assert.equal(r.score, 1);
  assert.deepEqual(r.detail, { chosen: "b", answer: "b" });
  r = await run(choiceQ, { option: "a" });
  assert.equal(r.outcome, "incorrect");
  assert.equal(r.score, 0);
  assert.equal((await run(choiceQ, { option: "z" })).detail.reason, "unknown-option");
  assert.equal((await run(choiceQ, {})).detail.reason, "missing-field");
  assert.equal((await run(choiceQ, { option: 1 })).detail.reason, "bad-id");
  assert.equal((await run(choiceQ, null)).outcome, "invalid");
  assert.equal((await run(choiceQ, undefined)).outcome, "invalid");
  assert.equal((await run(choiceQ, "b")).outcome, "invalid");
});

test("true-false：對、錯、invalid", async () => {
  assert.equal((await run(tfQ, { value: false })).outcome, "correct");
  assert.equal((await run(tfQ, { value: true })).outcome, "incorrect");
  assert.equal((await run(tfQ, { value: "false" })).detail.reason, "not-boolean");
  assert.equal((await run(tfQ, { value: 0 })).detail.reason, "not-boolean");
  assert.equal((await run(tfQ, {})).detail.reason, "missing-field");
});

test("match：全對、部分、全錯、沒連算錯、未知 id 為 invalid", async () => {
  let r = await run(matchQ, { pairs: { p1: "p1", p2: "p2", p3: "p3" } });
  assert.equal(r.outcome, "correct");
  assert.equal(r.score, 1);
  assert.equal(r.detail.correct_count, 3);

  r = await run(matchQ, { pairs: { p1: "p1", p2: "p3", p3: "p2" } });
  assert.equal(r.outcome, "partial");
  assert.ok(Math.abs(r.score - 1 / 3) < 1e-12);
  assert.deepEqual(r.detail.pairs.map((p) => p.correct), [true, false, false]);

  r = await run(matchQ, { pairs: { p1: "p1", p2: "p2" } });
  assert.equal(r.outcome, "partial", "沒連的一組算錯");
  assert.deepEqual(r.detail.pairs[2], { id: "p3", chosen: null, correct: false });

  r = await run(matchQ, { pairs: { p1: "p2", p2: "p3", p3: "p1" } });
  assert.equal(r.outcome, "incorrect");
  assert.equal(r.score, 0);
  assert.equal((await run(matchQ, { pairs: {} })).outcome, "incorrect");

  r = await run(matchQ, { pairs: { p1: "p1", p2: "p1", p3: "p3" } });
  assert.equal(r.outcome, "partial", "同一右側連兩次各組獨立判定");
  assert.equal(r.detail.correct_count, 2);

  assert.deepEqual((await run(matchQ, { pairs: { p1: "p9" } })).detail, { reason: "unknown-pair", side: "right", id: "p9" });
  assert.deepEqual((await run(matchQ, { pairs: { p9: "p1" } })).detail, { reason: "unknown-pair", side: "left", id: "p9" });
  assert.equal((await run(matchQ, { pairs: { p1: 1 } })).detail.reason, "unknown-pair");
  assert.equal((await run(matchQ, { pairs: [] })).detail.reason, "missing-field");
  assert.equal((await run(matchQ, {})).detail.reason, "missing-field");
});

test("numeric：精確、三種容差、invalid", async () => {
  let r = await run(numQ(), { value: 42 });
  assert.equal(r.outcome, "correct");
  assert.deepEqual(r.detail.tolerance, { type: "nominal", value: 0 });
  assert.equal(r.detail.difference, 0);
  assert.equal((await run(numQ(), { value: 41 })).outcome, "incorrect");
  assert.equal((await run(numQ(), { value: 42.0000001 })).outcome, "incorrect", "精確比對不放水");

  const nominal = numQ({ tolerance: { type: "nominal", value: 1 } });
  assert.equal((await run(nominal, { value: 43 })).outcome, "correct");
  assert.equal((await run(nominal, { value: 41 })).outcome, "correct");
  assert.equal((await run(nominal, { value: 44 })).outcome, "incorrect");

  const relative = numQ({ answer: 200, tolerance: { type: "relative", value: 0.05 } });
  assert.equal((await run(relative, { value: 210 })).outcome, "correct");
  assert.equal((await run(relative, { value: 190 })).outcome, "correct");
  assert.equal((await run(relative, { value: 211 })).outcome, "incorrect");

  const geometric = numQ({ answer: 100, tolerance: { type: "geometric", value: 0.1 } });
  assert.equal((await run(geometric, { value: 110 })).outcome, "correct");
  assert.equal((await run(geometric, { value: 91 })).outcome, "correct", "下界是 100／1.1 ≈ 90.9");
  assert.equal((await run(geometric, { value: 90 })).outcome, "incorrect");
  assert.equal((await run(geometric, { value: 111 })).outcome, "incorrect");
  const negGeo = numQ({ answer: -100, tolerance: { type: "geometric", value: 0.1 } });
  assert.equal((await run(negGeo, { value: -95 })).outcome, "correct", "負數區間翻轉");
  assert.equal((await run(negGeo, { value: -115 })).outcome, "incorrect");

  // 答案為 0 時 relative／geometric 退化為精確
  assert.equal((await run(numQ({ answer: 0, tolerance: { type: "relative", value: 0.5 } }), { value: 0 })).outcome, "correct");
  assert.equal((await run(numQ({ answer: 0, tolerance: { type: "relative", value: 0.5 } }), { value: 0.1 })).outcome, "incorrect");
  assert.equal((await run(numQ({ answer: 0, tolerance: { type: "geometric", value: 0.5 } }), { value: 0 })).outcome, "correct");

  // 浮點緩衝
  assert.equal((await run(numQ({ answer: 0.3 }), { value: 0.1 + 0.2 })).outcome, "correct");
  assert.ok(withinTolerance(1.1 + 2.2, 3.3, undefined));

  assert.equal((await run(numQ(), { value: "42" })).detail.reason, "not-number");
  assert.equal((await run(numQ(), { value: NaN })).detail.reason, "not-number");
  assert.equal((await run(numQ(), { value: Infinity })).detail.reason, "not-number");
  assert.equal((await run(numQ(), {})).detail.reason, "missing-field");
  assert.equal((await run(numQ(), null)).outcome, "invalid");

  assert.throws(() => types.numeric.score(numQ({ tolerance: { type: "nominal", value: -1 } }), { value: 42 }), /tolerance/);
  assert.throws(() => types.numeric.score(numQ({ tolerance: { type: "weird", value: 1 } }), { value: 42 }), /tolerance\.type/);
});

// 用範例包裡每一道固定題自檢：標準答案一定判 correct，隨便一個錯答案不會判 correct。
test("examples/minimal 每道固定題：標準答案判對、錯答案不判對", async () => {
  const dir = path.join(ROOT, "examples", "minimal", "items");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 4);
  let checked = 0;
  for (const f of files) {
    const item = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    if (item.kind !== "fixed") continue;
    const { right, wrong } = canonical(item);
    const ok = await run(item, right);
    assert.equal(ok.outcome, "correct", `${f} 標準答案沒判對：${JSON.stringify(ok)}`);
    assert.equal(ok.type, item.type);
    const bad = await run(item, wrong);
    assert.notEqual(bad.outcome, "correct", `${f} 錯答案被判對`);
    checked++;
  }
  assert.ok(checked >= 4, "範例至少四種固定題");
});

function canonical(item) {
  switch (item.type) {
    case "choice": {
      const other = item.options.find((o) => o.id !== item.answer).id;
      return { right: { option: item.answer }, wrong: { option: other } };
    }
    case "true-false":
      return { right: { value: item.answer }, wrong: { value: !item.answer } };
    case "match": {
      const ids = item.pairs.map((p) => p.id);
      const right = Object.fromEntries(ids.map((id) => [id, id]));
      const rotated = Object.fromEntries(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
      return { right: { pairs: right }, wrong: { pairs: rotated } };
    }
    case "numeric":
      return { right: { value: item.answer }, wrong: { value: item.answer + 1000 } };
    default:
      throw new Error(`測試未涵蓋題型 ${item.type}`);
  }
}
