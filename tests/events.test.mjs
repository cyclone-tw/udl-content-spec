import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvents, validateEventsFile } from "../conformance/validate-events.mjs";
import { createEventsFile, pushEvent, answeredFields, EVENT_TYPES } from "../events/index.mjs";
import { convertLessonAttempt } from "../events/adapters/udl-lesson-attempt-v1.mjs";
import { score } from "../question-types/index.mjs";
import { instantiate } from "../generators/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const EX = path.join(root, "events", "examples");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const has = (list, ...needles) => list.some((e) => needles.every((n) => e.includes(n)));

test("兩個合成範例通過驗證", async () => {
  for (const f of ["runner-session.json", "lesson-attempt-converted.json"]) {
    const r = await validateEventsFile(path.join(EX, f));
    assert.deepEqual(r.errors, [], f);
    assert.ok(r.ok, f);
  }
});

test("schema：缺必填、未知事件種類、actor 多欄位都擋", async () => {
  const base = await readJson(path.join(EX, "runner-session.json"));
  let f = clone(base);
  delete f.events[3].ladder_ids;
  let r = await validateEvents(f);
  assert.ok(has(r.errors, "ladder_ids"));

  f = clone(base);
  f.events[1].type = "page-turned";
  r = await validateEvents(f);
  assert.ok(!r.ok);

  f = clone(base);
  f.actor.name = "王小明";
  r = await validateEvents(f);
  assert.ok(has(r.errors, "/actor"), "actor 不得有姓名欄位");

  f = clone(base);
  f.events[3].extra = 1;
  r = await validateEvents(f);
  assert.ok(!r.ok, "answered 不得有未定義欄位");
});

test("角色與代號：student 必帶代號，teacher／guest 不得帶", async () => {
  const base = await readJson(path.join(EX, "runner-session.json"));
  let f = clone(base);
  delete f.actor.student_code;
  assert.ok(!(await validateEvents(f)).ok);
  f = clone(base);
  f.actor = { role: "teacher", student_code: "fox-07" };
  assert.ok(!(await validateEvents(f)).ok);
  f = clone(base);
  f.actor = { role: "teacher" };
  const r = await validateEvents(f);
  assert.ok(r.ok);
  assert.ok(has(r.warnings, "不匯出給 kit"));
});

test("一致性：outcome 與 score、seq 遞增、attempt_no 順序", async () => {
  const base = await readJson(path.join(EX, "runner-session.json"));
  let f = clone(base);
  f.events[3].score = 0.5;
  let r = await validateEvents(f);
  assert.ok(has(r.errors, "correct", "score"));

  f = clone(base);
  f.events[6].outcome = "partial";
  f.events[6].score = 1;
  r = await validateEvents(f);
  assert.ok(has(r.errors, "partial"));

  f = clone(base);
  f.events[2].seq = 7;
  r = await validateEvents(f);
  assert.ok(has(r.errors, "seq"));

  f = clone(base);
  f.events[6].attempt_no = 5;
  r = await validateEvents(f);
  assert.ok(has(r.warnings, "attempt_no"));
});

test("ladder_ids 用 --ladder-dir 核對 kit 階梯資料", async () => {
  const base = await readJson(path.join(EX, "runner-session.json"));
  const ladderIds = new Set(["n-I-2#a@2"]);
  const r = await validateEvents(base, { ladderIds });
  assert.ok(has(r.errors, "5-Ⅲ-3#a@6", "不在 kit"));
  const r2 = await validateEvents(base, { ladderIds: new Set(["n-I-2#a@2", "5-Ⅲ-3#a@6"]) });
  assert.ok(r2.ok);
});

test("隱私掃描：像身分證、手機、長數字或姓名鍵都擋", async () => {
  const base = await readJson(path.join(EX, "runner-session.json"));
  let f = clone(base);
  f.events[3].detail.note = "A123456789";
  assert.ok(has((await validateEvents(f)).errors, "身分證"));
  f = clone(base);
  f.events[3].response = { chosen: "0912345678" };
  assert.ok(has((await validateEvents(f)).errors, "手機"));
  f = clone(base);
  f.context.assignment_id = "20261012123456";
  assert.ok(has((await validateEvents(f)).errors, "10 碼"));
  f = clone(base);
  f.events[3].detail.student_name = "x";
  assert.ok(has((await validateEvents(f)).errors, "姓名"));
});

test("建構器：createEventsFile 擋多餘 actor 欄位；answeredFields 接 score() 與產生器實例產出合法事件", async () => {
  assert.throws(() => createEventsFile({ producer: { shell: "udl-runner", shell_version: "0", granularity: "item" }, actor: { role: "student", student_code: "a1", name: "x" }, context: {} }), /只能有 role 與 student_code/);
  assert.throws(() => createEventsFile({ producer: { shell: "udl-runner", shell_version: "0", granularity: "item" }, actor: { role: "guest", student_code: "a1" }, context: {} }), /不得帶/);

  const packDir = path.join(root, "examples", "minimal");
  const item = await readJson(path.join(packDir, "items", "i-gen-add-sub-a2.json"));
  const pools = {};
  for (const id of Object.values(item.params.context_pools)) pools[id] = await readJson(path.join(packDir, "pools", `${id}.json`));
  const [inst] = instantiate(item, { seed: "events-test", pools });
  const resp = { blanks: Object.fromEntries(inst.blanks.map((b) => [b.id, b.answer])) };
  const result = score(inst, resp);
  assert.equal(result.outcome, "correct");

  const choice = await readJson(path.join(packDir, "items", "i-choice-01.json"));
  const wrong = choice.options.find((o) => o.id !== choice.answer).id;
  const choiceResult = score(choice, { option: wrong });
  assert.equal(choiceResult.outcome, "incorrect");

  const file = createEventsFile({
    producer: { shell: "udl-runner", shell_version: "0.1.0", granularity: "item" },
    actor: { role: "student", student_code: "fox-07" },
    context: { session_id: "t-1", mode: "practice", pack: { id: "sample-willow", version: "0.1.0" } },
  });
  pushEvent(file, "session-started");
  const a1 = pushEvent(file, "answered", answeredFields(inst, result, { attempt_no: 1, response_ms: 1200, read_aloud: false, response: resp }));
  pushEvent(file, "hint-used", { item_id: choice.id, hint_tier: 1 });
  pushEvent(file, "answered", answeredFields(choice, choiceResult, { attempt_no: 1, response_ms: 800, hint_tier: 1, read_aloud: true, response: { option: wrong } }));
  pushEvent(file, "session-completed", { summary: { answered: 2, correct: 1 } });

  assert.equal(a1.item_id, "i-gen-add-sub-a2");
  assert.deepEqual(a1.ladder_ids, ["n-I-2#a@2"]);
  assert.equal(a1.generated.seed, "events-test");
  assert.equal(a1.generated.tier, inst.tier);
  assert.equal(a1.question_type, "blanks");
  const r = await validateEvents(file);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(file.events.length, 5);
  assert.throws(() => pushEvent(file, "nope"), /未知事件種類/);
  assert.ok(EVENT_TYPES.includes("answered"));
});

test("轉接器：朗讀器 udl-lesson-attempt/v1 → 粒度 unit 的事件檔", async () => {
  const src = await readJson(path.join(EX, "lesson-attempt-source.json"));
  const mapping = await readJson(path.join(EX, "lesson-attempt-mapping.json"));
  const out = convertLessonAttempt(src, { mapping, actor: { role: "student", student_code: "fox-07" }, shell_version: "v1" });
  assert.equal(out.producer.shell, "udl-lesson-reader");
  assert.equal(out.producer.granularity, "unit");
  assert.equal(out.context.mode, "test", "quiz 討伐對到 test");
  assert.equal(out.context.unit_id, "u01-stream-bridge");
  const answered = out.events.filter((e) => e.type === "answered");
  assert.equal(answered.length, 4);
  assert.deepEqual(answered[0].ladder_ids, ["5-Ⅲ-3#a@6"]);
  assert.equal(answered[1].outcome, "incorrect");
  assert.equal(answered[1].score, 0);
  assert.equal(answered[0].read_aloud, null, "朗讀器不知道有沒有報讀，填 null 不猜");
  assert.equal(out.events[0].type, "session-started");
  assert.equal(out.events.at(-1).type, "session-completed");
  assert.deepEqual(out.events.at(-1).summary, { answered: 4, correct: 3, duration_ms: 34000 });
  const r = await validateEvents(out);
  assert.deepEqual(r.errors, []);
  assert.ok(has(r.warnings, "粒度 unit"));

  // literacy（修練）對到 practice；可被 mode 覆寫
  const lit = convertLessonAttempt({ ...src, activity: "literacy" }, { mapping, actor: { role: "guest" } });
  assert.equal(lit.context.mode, "practice");
  assert.equal(convertLessonAttempt(src, { mapping, actor: { role: "guest" }, mode: "practice" }).context.mode, "practice");

  // 錯誤：schema 不對、課次不在對照表、對照表缺 ladder_ids
  assert.throws(() => convertLessonAttempt({ ...src, schema: "other" }, { mapping, actor: { role: "guest" } }), /schema/);
  assert.throws(() => convertLessonAttempt({ ...src, lessonId: "nope" }, { mapping, actor: { role: "guest" } }), /對照表沒有課次/);
  const bad = clone(mapping);
  bad.lessons["demo-stream-bridge"].ladder_ids = [];
  assert.throws(() => convertLessonAttempt(src, { mapping: bad, actor: { role: "guest" } }), /缺 ladder_ids/);
  // 轉出的檔與 examples 裡的一致（除了 generated_at）
  const expected = await readJson(path.join(EX, "lesson-attempt-converted.json"));
  const got = convertLessonAttempt(src, { mapping, actor: { role: "student", student_code: "fox-07" }, shell_version: "v1", prescription: { zhuyin: true, read_aloud: "student-choice" } });
  got.generated_at = expected.generated_at;
  assert.deepEqual(got, expected);
});
