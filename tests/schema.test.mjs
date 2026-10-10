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
// 在暫存副本上做一次驗證，結束後清掉。
async function withCopy(fn) {
  const dir = await copyExample();
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const has = (list, ...needles) => list.some((e) => needles.every((n) => e.includes(n)));

test("所有 schema 可在 ajv strict 模式編譯", async () => {
  const v = await loadValidators();
  for (const name of ["pack", "unit", "material", "item", "pool", "scope"]) assert.ok(v[name], `${name} 未編譯`);
});

test("最小範例通過（只有語音槽與跨科警告）", async () => {
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

test("hash 不符會報錯並指出檔案", () =>
  withCopy(async (dir) => {
    const p = path.join(dir, "pools", "p-semantic-01.json");
    await writeFile(p, (await readFile(p, "utf8")) + "\n");
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "pools/p-semantic-01.json", "sha256"), r.errors.join("\n"));
  }));

test("提示不是三層會被 schema 擋下", () =>
  withCopy(async (dir) => {
    await editJson(dir, "items/i-tf-01.json", (o) => o.hints.pop());
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.startsWith("items/i-tf-01.json/hints")), r.errors.join("\n"));
  }));

test("選擇題正解不在選項裡；選項 id 重複", () =>
  withCopy(async (dir) => {
    await editJson(dir, "items/i-choice-01.json", (o) => { o.answer = "zz"; o.options[1].id = "a"; });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "answer zz 不在 options"), r.errors.join("\n"));
    assert.ok(has(r.errors, "i-choice-01", "options id 重複"), r.errors.join("\n"));
  }));

test("distractor_pool 不在單元 pools", () =>
  withCopy(async (dir) => {
    await editJson(dir, "units/u01-stream-bridge.json", (o) => { o.pools = []; });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "distractor_pool p-semantic-01 未列在單元 pools"), r.errors.join("\n"));
  }));

test("generated 題不得帶 stem；fixed 題不得帶 generator", () =>
  withCopy(async (dir) => {
    await editJson(dir, "items/i-gen-add-carry.json", (o) => { o.stem = { text: { text: "x", audio: null } }; });
    await editJson(dir, "items/i-numeric-01.json", (o) => { o.generator = "math.x"; });
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.startsWith("items/i-gen-add-carry.json/stem")), r.errors.join("\n"));
    assert.ok(r.errors.some((e) => e.startsWith("items/i-numeric-01.json/generator")), r.errors.join("\n"));
  }));

test("教材文中的詞語標記必須在 vocab；check 引用的題目必須在單元", () =>
  withCopy(async (dir) => {
    await editJson(dir, "materials/m-stream-bridge-lesson.json", (o) => {
      o.blocks[0].content.text += "【石橋|shiqiao】";
      o.blocks[2].item = "i-nope";
    });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "shiqiao"), r.errors.join("\n"));
    assert.ok(has(r.errors, "i-nope"), r.errors.join("\n"));
  }));

test("未知欄位會被擋（unevaluatedProperties）並指出欄位名", () =>
  withCopy(async (dir) => {
    await editJson(dir, "items/i-match-01.json", (o) => { o.answer_index = 0; });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "items/i-match-01.json", "answer_index"), r.errors.join("\n"));
  }));

test("引用的圖片未列在 files 清單", () =>
  withCopy(async (dir) => {
    await editJson(dir, "items/i-tf-01.json", (o) => { o.stem.image = "images/bridge.png"; });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "items/i-tf-01.json", "images/bridge.png", "不在 pack.json files"), r.errors.join("\n"));
  }));

test("pack.json 不合格時回傳錯誤物件、不拋例外、不做後續檢查", () =>
  withCopy(async (dir) => {
    await editJson(dir, "pack.json", (o) => { o.files = [{}]; delete o.title; });
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("pack.json")), r.errors.join("\n"));
    assert.ok(!r.errors.some((e) => e.includes("檔案不存在")), "pack 不合格時不應做 hash 檢查");
    assert.deepEqual(r.counts, { units: 0, materials: 0, items: 0, pools: 0 });
  }));

test("files 路徑跳出 pack 目錄：schema 擋下，且不讀檔", () =>
  withCopy(async (dir) => {
    await editJson(dir, "pack.json", (o) => { o.files.push({ path: "../../etc/passwd", sha256: "0".repeat(64) }); });
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("pack.json/files/")), r.errors.join("\n"));
    assert.ok(!r.errors.some((e) => e.includes("passwd") && (e.includes("sha256 不符") || e.includes("檔案不存在"))), "不得對不安全路徑讀檔或回報存在性");
  }));

test("units 的 id 跳出目錄時不讀檔", () =>
  withCopy(async (dir) => {
    // units 的 id 受 schema pattern 限制，但驗證器仍要自己把關。
    const p = path.join(dir, "pack.json");
    const o = JSON.parse(await readFile(p, "utf8"));
    o.units.push("../pack");
    await writeFile(p, JSON.stringify(o));
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("pack.json/units")), r.errors.join("\n"));
    assert.ok(!r.errors.some((e) => e.includes("../pack") && e.includes("無法讀取")), "pack 不合格時不應嘗試讀取 unit 檔");
  }));

test("同一個包內 item id 跨單元重複會報錯", () =>
  withCopy(async (dir) => {
    await editJson(dir, "units/u02-add-2digit.json", (o) => { o.items.push("i-tf-01"); });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "item id i-tf-01 重複"), r.errors.join("\n"));
  }));

test("磁碟上多出未列在 files 的檔案會警告（manifest 漂移）", () =>
  withCopy(async (dir) => {
    await writeFile(path.join(dir, "items", "i-extra.json"), "{}");
    const r = await validatePack(dir);
    assert.ok(r.warnings.some((w) => w.includes("items/i-extra.json") && w.includes("漂移")), r.warnings.join("\n"));
  }));

test("Scope 範例合法；version 不合法或 JSON 壞掉都回傳錯誤", async () => {
  const ok = await validateScopeFile(path.join(here, "..", "examples", "scopes", "first-lesson-test.json"));
  assert.ok(ok.ok, ok.errors.join("\n"));
  const dir = await mkdtemp(path.join(tmpdir(), "udl-scope-"));
  try {
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ format_version: 1, include: [{ pack: "sample-willow", version: "newest" }] }));
    assert.equal((await validateScopeFile(bad)).ok, false);
    const broken = path.join(dir, "broken.json");
    await writeFile(broken, "{ not json");
    const r = await validateScopeFile(broken);
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes("合法 JSON"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
