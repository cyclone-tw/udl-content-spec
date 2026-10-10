import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, validateScopeFile, loadValidators } from "../conformance/validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, "..", "examples", "minimal");

async function copyExample() {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-pack-"));
  await cp(EXAMPLE, dir, { recursive: true });
  return dir;
}
async function editJson(dir, rel, mutate) {
  const p = path.join(dir, rel);
  const obj = JSON.parse(await readFile(p, "utf8"));
  mutate(obj);
  await writeFile(p, JSON.stringify(obj, null, 2));
}

test("所有 schema 可在 ajv strict 模式編譯", async () => {
  const v = await loadValidators();
  for (const name of ["pack", "unit", "material", "item", "pool", "scope"]) assert.ok(v[name], `${name} 未編譯`);
});

test("最小範例通過（只有語音槽警告）", async () => {
  const r = await validatePack(EXAMPLE);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.counts.units, 2);
  assert.equal(r.counts.items, 5);
  assert.ok(r.warnings.every((w) => w.includes("語音槽") || w.includes("subject")), r.warnings.join("\n"));
});

test("--strict 時語音槽 null 算失敗", async () => {
  const r = await validatePack(EXAMPLE, { strict: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, []);
});

test("hash 不符會報錯並指出檔案", async () => {
  const dir = await copyExample();
  try {
    await writeFile(path.join(dir, "pools", "p-semantic-01.json"), (await readFile(path.join(dir, "pools", "p-semantic-01.json"), "utf8")) + "\n");
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.includes("pools/p-semantic-01.json") && e.includes("sha256")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("提示不是三層會被 schema 擋下", async () => {
  const dir = await copyExample();
  try {
    await editJson(dir, "items/i-tf-01.json", (o) => o.hints.pop());
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.startsWith("items/i-tf-01.json/hints")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("選擇題正解不在選項裡", async () => {
  const dir = await copyExample();
  try {
    await editJson(dir, "items/i-choice-01.json", (o) => { o.answer = "zz"; });
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.includes("answer zz 不在 options")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated 題不得帶 stem；fixed 題不得帶 generator", async () => {
  const dir = await copyExample();
  try {
    await editJson(dir, "items/i-gen-add-carry.json", (o) => { o.stem = { text: { text: "x", audio: null } }; });
    await editJson(dir, "items/i-numeric-01.json", (o) => { o.generator = "math.x"; });
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.startsWith("items/i-gen-add-carry.json/stem")), r.errors.join("\n"));
    assert.ok(r.errors.some((e) => e.startsWith("items/i-numeric-01.json/generator")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("教材文中的詞語標記必須在 vocab；check 引用的題目必須在單元", async () => {
  const dir = await copyExample();
  try {
    await editJson(dir, "materials/m-stream-bridge-lesson.json", (o) => {
      o.blocks[0].content.text += "【石橋|shiqiao】";
      o.blocks[2].item = "i-nope";
    });
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.includes("shiqiao")), r.errors.join("\n"));
    assert.ok(r.errors.some((e) => e.includes("i-nope")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("未知欄位會被擋（unevaluatedProperties）", async () => {
  const dir = await copyExample();
  try {
    await editJson(dir, "items/i-match-01.json", (o) => { o.answer_index = 0; });
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.includes("items/i-match-01.json") && e.includes("answer_index")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Scope 範例合法；version 不合法會被擋", async () => {
  const ok = await validateScopeFile(path.join(here, "..", "examples", "scopes", "first-lesson-test.json"));
  assert.ok(ok.ok, ok.errors.join("\n"));
  const dir = await mkdtemp(path.join(tmpdir(), "udl-scope-"));
  try {
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ format_version: 1, include: [{ pack: "sample-willow", version: "newest" }] }));
    const r = await validateScopeFile(bad);
    assert.equal(r.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
