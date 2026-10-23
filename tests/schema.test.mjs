import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, validateScopeFile, loadValidators, resolveInside } from "../conformance/validate.mjs";

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
// 改過檔案後重算 pack.json files 的 sha256（與 update-files 同邏輯，只重算已列的路徑）。
async function rehash(dir) {
  const { createHash } = await import("node:crypto");
  const p = path.join(dir, "pack.json");
  const pack = JSON.parse(await readFile(p, "utf8"));
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
  await writeFile(p, JSON.stringify(pack, null, 2));
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

test("resolveInside 只接受 pack 目錄內的合法相對路徑", () => {
  const root = path.resolve("/tmp/pack-root");
  assert.equal(resolveInside(root, "items/a.json"), path.join(root, "items", "a.json"));
  assert.equal(resolveInside(root, "../x.json"), null);
  assert.equal(resolveInside(root, "items/../../x.json"), null);
  assert.equal(resolveInside(root, "/etc/passwd"), null);
  assert.equal(resolveInside(root, "."), null);
  assert.equal(resolveInside(root, ""), null);
  assert.equal(resolveInside(root, "items\\a.json"), null);
  assert.equal(resolveInside(root, 42), null);
});

test("最小範例通過（只有語音槽與跨科警告）", async () => {
  const r = await validatePack(EXAMPLE);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.counts.units, 2);
  assert.equal(r.counts.items, 12);
  assert.equal(r.counts.pools, 5);
  assert.ok(r.warnings.every((w) => w.includes("語音槽") || w.includes("subject")), r.warnings.join("\n"));
});

test("--strict 時語音槽 null 算失敗", async () => {
  const r = await validatePack(EXAMPLE, { strict: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, []);
});

test("同一個池可被兩個單元共用", () =>
  withCopy(async (dir) => {
    await editJson(dir, "units/u02-add-2digit.json", (o) => { o.pools.push("p-semantic-01"); });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.deepEqual(r.errors, []);
    assert.equal(r.counts.pools, 5);
  }));

test("單元或題目引用不在 pack.pools 的池會報錯", () =>
  withCopy(async (dir) => {
    await editJson(dir, "pack.json", (o) => { o.pools = []; });
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "units/u01-stream-bridge.json", "p-semantic-01 不在 pack.json pools"), r.errors.join("\n"));
    assert.ok(has(r.errors, "items/i-choice-01.json", "distractor_pool p-semantic-01 不在 pack.json pools"), r.errors.join("\n"));
  }));

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

test("generated 題不得帶 stem；fixed 題不得帶 generator", () =>
  withCopy(async (dir) => {
    await editJson(dir, "items/i-gen-add-sub-a2.json", (o) => { o.stem = { text: { text: "x", audio: null } }; });
    await editJson(dir, "items/i-numeric-01.json", (o) => { o.generator = "math.x"; });
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.startsWith("items/i-gen-add-sub-a2.json/stem")), r.errors.join("\n"));
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
    assert.deepEqual(r.counts, { units: 0, materials: 0, items: 0, pools: 0, cards: 0 });
  }));

test("pack.json 是 false／0 之類的非物件時要有錯誤訊息，不能靜默失敗", () =>
  withCopy(async (dir) => {
    await writeFile(path.join(dir, "pack.json"), "false");
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0 && r.errors[0].startsWith("pack.json"), r.errors.join("\n"));
  }));

test("單元或教材 schema 不合格時不拋例外，也不做該檔的後續檢查", () =>
  withCopy(async (dir) => {
    await editJson(dir, "units/u01-stream-bridge.json", (o) => { o.pools = {}; o.items = "i-choice-01"; });
    await editJson(dir, "materials/m-add-demo.json", (o) => { o.blocks = "abc"; });
    await editJson(dir, "items/i-choice-01.json", (o) => { o.options = "nope"; });
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.startsWith("units/u01-stream-bridge.json/pools")), r.errors.join("\n"));
    assert.ok(r.errors.some((e) => e.startsWith("materials/m-add-demo.json/blocks")), r.errors.join("\n"));
    assert.ok(!r.errors.some((e) => e.includes("TypeError")), r.errors.join("\n"));
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

test("blanks schema：數字、文字、混合格與 1–12 格", async () => {
  const v = await loadValidators();
  const original = JSON.parse(await readFile(path.join(EXAMPLE, "items/i-blanks-math-01.json"), "utf8"));
  const numeric = { id: "n", kind: "numeric", answer: 42, tolerance: { type: "nominal", value: 0 }, input: { min: 0, max: 99, decimals: 0 }, unit_label: "顆" };
  const text = { id: "t", kind: "text", answer: "字", accept: ["詞"], case_sensitive: false, max_length: 20 };
  for (const blanks of [[numeric], [text], [numeric, text], Array.from({ length: 12 }, (_, i) => ({ ...text, id: `s${i}` }))]) {
    assert.ok(v.item({ ...original, blanks }), JSON.stringify(v.item.errors));
  }
  for (const blanks of [undefined, [], Array(13).fill(text), [{ ...numeric, kind: "other" }], [{ ...numeric, answer: "42" }],
    [{ ...text, answer: 42 }], [{ ...text, answer: "" }], [{ ...text, accept: [1] }], [{ ...text, case_sensitive: 0 }],
    [{ ...text, max_length: 0 }], [{ ...text, max_length: 1.5 }], [{ ...text, tolerance: { type: "nominal", value: 0 } }],
    [{ ...numeric, accept: ["42"] }], [{ ...numeric, tolerance: { type: "bad", value: 0 } }], [{ ...numeric, id: "Bad" }],
  ]) assert.equal(v.item({ ...original, blanks }), false, JSON.stringify(blanks));
  for (const key of ["options", "pairs", "answer", "tolerance", "input", "unit_label", "shuffle", "distractor_pool"]) {
    assert.equal(v.item({ ...original, [key]: key === "answer" ? 42 : {} }), false, key);
  }
  for (const name of ["i-numeric-01", "i-choice-01", "i-tf-01", "i-match-01", "i-gen-add-sub-a2"]) {
    const item = JSON.parse(await readFile(path.join(EXAMPLE, `items/${name}.json`), "utf8"));
    assert.equal(v.item({ ...item, blanks: [numeric] }), false, name);
  }
});

for (const [name, mutate, message] of [
  ["缺少", (o) => { o.stem.text.text = "[[tens]]"; }, "ones 必須恰有一個佔位符"],
  ["重複", (o) => { o.stem.text.text += "[[ones]]"; }, "ones 必須恰有一個佔位符"],
  ["未知", (o) => { o.stem.text.text += "[[extra]]"; }, "佔位符 extra 不在 blanks"],
  ["空白 id", (o) => { o.stem.text.text += "[[ ]]"; }, "不在 blanks"],
  ["格 id 重複", (o) => { o.blanks[1].id = "tens"; }, "blanks id 重複"],
]) test(`blanks 語意檢查：${name}`, () => withCopy(async (dir) => {
  await editJson(dir, "items/i-blanks-math-01.json", mutate);
  await rehash(dir);
  const r = await validatePack(dir);
  assert.equal(r.ok, false);
  assert.ok(has(r.errors, "i-blanks-math-01", message), r.errors.join("\n"));
  assert.ok(!has(r.errors, "sha256"));
}));

for (const type of ["ordering", "classify"]) test(`${type} schema：數量邊界、必要欄位、圖片與題型隔離`, async () => {
  const v = await loadValidators();
  const q = JSON.parse(await readFile(path.join(EXAMPLE, `items/i-${type}-01.json`), "utf8"));
  const fields = type === "ordering" ? { sequence: 8 } : { bins: 6, objects: 12 };
  for (const [field, max] of Object.entries(fields)) {
    for (const n of [2, max]) {
      const parts = Array.from({ length: n }, (_, i) => ({ ...q[field][0], id: `s${i}` }));
      const candidate = { ...q, [field]: parts };
      if (field === "bins") candidate.objects = q.objects.map((o) => ({ ...o, bin: "s0" }));
      assert.ok(v.item(candidate), JSON.stringify(v.item.errors));
    }
    for (const parts of [undefined, [], [q[field][0]], Array(max + 1).fill(q[field][0]), [null, null]]) {
      assert.equal(v.item({ ...q, [field]: parts }), false);
    }
    for (const key of Object.keys(q[field][0])) {
      const candidate = structuredClone(q); delete candidate[field][0][key];
      assert.equal(v.item(candidate), false, `${field}.${key} 必填`);
    }
    const badId = structuredClone(q); badId[field][0].id = "Bad";
    assert.equal(v.item(badId), false);
  }
  const cardField = type === "ordering" ? "sequence" : "objects";
  const image = structuredClone(q); image[cardField][0].image = "images/card.png";
  assert.ok(v.item(image));
  image[cardField][0].image = "../bad.png"; assert.equal(v.item(image), false);
  for (const key of ["options", "pairs", "answer", "blanks", "tolerance", "input", "unit_label", "shuffle", "distractor_pool", ...(type === "ordering" ? ["bins", "objects"] : ["sequence"])]) {
    assert.equal(v.item({ ...q, [key]: {} }), false, key);
  }
  for (const name of ["i-numeric-01", "i-choice-01", "i-tf-01", "i-match-01", "i-blanks-math-01", "i-gen-add-sub-a2"]) {
    const other = JSON.parse(await readFile(path.join(EXAMPLE, `items/${name}.json`), "utf8"));
    for (const field of Object.keys(fields)) assert.equal(v.item({ ...other, [field]: q[field] }), false, `${name}: ${field}`);
  }
});

for (const [type, mutate, message] of [
  ["ordering", (q) => { q.sequence[1].id = q.sequence[0].id; }, "sequence id 重複"],
  ["classify", (q) => { q.bins[1].id = q.bins[0].id; }, "bins id 重複"],
  ["classify", (q) => { q.objects[1].id = q.objects[0].id; }, "objects id 重複"],
  ["classify", (q) => { q.objects[0].bin = "missing"; }, "不在 bins"],
  ["ordering", (q) => { q.sequence[0].image = "images/missing.png"; }, "不在 pack.json files"],
  ["classify", (q) => { q.objects[0].image = "images/missing.png"; }, "不在 pack.json files"],
]) test(`${type} 語意驗證：${message}`, () => withCopy(async (dir) => {
  await editJson(dir, `items/i-${type}-01.json`, mutate);
  await rehash(dir);
  const r = await validatePack(dir);
  assert.equal(r.ok, false);
  assert.ok(has(r.errors, `i-${type}-01`, message), r.errors.join("\n"));
  assert.ok(!has(r.errors, "sha256"));
}));
