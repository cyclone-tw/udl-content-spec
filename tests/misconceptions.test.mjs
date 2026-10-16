// 選擇題逐選項錯誤類型與回饋（#43）：schema、代碼表引用、正解不得帶、score() detail。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, loadValidators } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";
import { answeredFields, pushEvent } from "../events/index.mjs";
import { validateEvents } from "../conformance/validate-events.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, "..", "examples", "minimal");
const ITEM = "items/i-rhetoric-01.json";

async function editJson(dir, rel, mutate) {
  const p = path.join(dir, rel);
  const obj = JSON.parse(await readFile(p, "utf8"));
  mutate(obj);
  await writeFile(p, JSON.stringify(obj, null, 2));
}
async function rehash(dir) {
  const p = path.join(dir, "pack.json");
  const pack = JSON.parse(await readFile(p, "utf8"));
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
  await writeFile(p, JSON.stringify(pack, null, 2));
}
async function withCopy(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-misc-"));
  await cp(EXAMPLE, dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const has = (list, ...needles) => list.some((e) => needles.every((n) => e.includes(n)));
const readItem = async () => JSON.parse(await readFile(path.join(EXAMPLE, ITEM), "utf8"));

test("範例修辭題通過驗證", async () => {
  const r = await validatePack(EXAMPLE);
  assert.deepEqual(r.errors, []);
  const item = await readItem();
  assert.ok(item.options.filter((o) => o.id !== item.answer).every((o) => o.misconception && o.feedback));
});

test("score()：選到帶錯誤類型的選項，detail 帶 misconception；答對與沒標的選項不帶", async () => {
  const item = await readItem();
  assert.deepEqual(score(item, { option: "b" }).detail, { chosen: "b", answer: "a", misconception: "personification-verb" });
  assert.deepEqual(score(item, { option: "a" }).detail, { chosen: "a", answer: "a" });
  const plain = { ...item, options: item.options.map(({ misconception, feedback, ...o }) => o) };
  assert.deepEqual(score(plain, { option: "c" }).detail, { chosen: "c", answer: "a" });
  assert.equal(score(item, { option: "c" }).outcome, "incorrect");
});

test("answered 事件的 detail 照抄 score() 的 misconception，事件檔仍通過驗證", async () => {
  const item = await readItem();
  const result = score(item, { option: "c" });
  const fields = answeredFields(item, result, { attempt_no: 1, response_ms: 1000, response: { option: "c" } });
  assert.equal(fields.detail.misconception, "beauty-as-exaggeration");
  const file = JSON.parse(await readFile(path.join(here, "..", "events", "examples", "runner-session.json"), "utf8"));
  const last = file.events.at(-1);
  file.events.pop();
  pushEvent(file, "answered", fields, last.time);
  file.events.push({ ...last, seq: file.events.length + 1 });
  const r = await validateEvents(file);
  assert.deepEqual(r.errors, []);
});

test("正解選項帶 misconception 會報錯", () =>
  withCopy(async (dir) => {
    await editJson(dir, ITEM, (o) => { o.options[0].misconception = "personification-verb"; });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, ITEM, "正解選項 a", "misconception"), r.errors.join("\n"));
  }));

test("misconception 代碼不在 pack.json misconceptions 會報錯", () =>
  withCopy(async (dir) => {
    await editJson(dir, ITEM, (o) => { o.options[1].misconception = "not-listed"; });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, ITEM, "選項 b", "not-listed", "不在 pack.json misconceptions"), r.errors.join("\n"));
    await editJson(dir, "pack.json", (o) => { delete o.misconceptions; });
    const none = await validatePack(dir);
    assert.ok(has(none.errors, ITEM, "選項 c", "beauty-as-exaggeration", "不在 pack.json misconceptions"), none.errors.join("\n"));
  }));

test("代碼表的 schema：代碼要是 kebab-case、label 必填、不收其他欄位", async () => {
  const v = await loadValidators();
  const pack = JSON.parse(await readFile(path.join(EXAMPLE, "pack.json"), "utf8"));
  for (const bad of [{ "Bad Code": { label: "x" } }, { "ok-code": {} }, { "ok-code": { label: "x", extra: 1 } }, { "ok-code": { label: "" } }]) {
    assert.equal(v.pack({ ...pack, misconceptions: bad }), false, JSON.stringify(bad));
  }
  assert.equal(v.pack({ ...pack, misconceptions: {} }), true);
});

test("選項的 misconception 要是 kebab-case、feedback 要是 spoken_text", () =>
  withCopy(async (dir) => {
    await editJson(dir, ITEM, (o) => { o.options[1].misconception = "Personification"; o.options[2].feedback = "再想想"; });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, ITEM, "/options/1/misconception"), r.errors.join("\n"));
    assert.ok(has(r.errors, ITEM, "/options/2/feedback"), r.errors.join("\n"));
  }));

test("逐選項回饋的語音槽照一般 spoken_text 檢查（路徑要在 files）", () =>
  withCopy(async (dir) => {
    await editJson(dir, ITEM, (o) => { o.options[1].feedback.audio = "audio/fb-b.m4a"; });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, ITEM, "audio/fb-b.m4a", "不在 pack.json files"), r.errors.join("\n"));
  }));
