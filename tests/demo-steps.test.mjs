// 講解動畫（#80）：math-demo 的步驟帶圖形狀態、疊圖工具、強調元素與先想一想的提問。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validatePack, loadValidators, checkDemoStep, checkDemoAsk } from "../conformance/validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, "..", "examples", "math-angle");
const demo = async () => JSON.parse(await readFile(path.join(EXAMPLE, "materials", "m-angle-demo.json"), "utf8"));

test("範例的示範教材通過 material schema，三步都有圖", async () => {
  const v = await loadValidators();
  const m = await demo();
  assert.ok(v.material(m), JSON.stringify(v.material.errors));
  const steps = m.blocks[0].steps;
  assert.equal(steps.length, 3);
  assert.ok(steps.every((s) => s.figure));
  for (const s of steps) assert.deepEqual(checkDemoStep(s), []);
});

test("相鄰兩步畫布與頂點一樣，動畫只有點在動", async () => {
  const steps = (await demo()).blocks[0].steps;
  for (let i = 1; i < steps.length; i++) {
    const [p, q] = [steps[i - 1].figure, steps[i].figure];
    assert.deepEqual([p.width, p.height, p.points.v], [q.width, q.height, q.points.v]);
    assert.deepEqual(Object.keys(p.points).sort(), Object.keys(q.points).sort());
  }
});

test("提問不含答案（比直角大／小）", async () => {
  for (const s of (await demo()).blocks[0].steps.filter((s) => s.ask)) {
    assert.doesNotMatch(s.ask.text, /比直角(大|小)/);
    assert.match(s.text.text, /比直角大/);
  }
});

test("只有文字與算式的舊示範照樣通過", async () => {
  const v = await loadValidators();
  const old = { format_version: 1, id: "m-x", unit: "u-x", kind: "demo", title: { text: "示範" }, blocks: [{ type: "math-demo", steps: [{ text: { text: "先算個位。" }, expression: "23 + 19 = 42" }] }] };
  assert.ok(v.material(old), JSON.stringify(v.material.errors));
  assert.deepEqual(checkDemoStep(old.blocks[0].steps[0]), []);
});

test("schema 擋掉壞圖形與不認得的工具", async () => {
  const v = await loadValidators();
  const m = await demo();
  const bad = structuredClone(m);
  delete bad.blocks[0].steps[0].figure.alt;
  assert.equal(v.material(bad), false);
  const bad2 = structuredClone(m);
  bad2.blocks[0].steps[2].tools = ["ruler"];
  assert.equal(v.material(bad2), false);
});

test("checkDemoStep：工具、強調元素要對得到這一步的圖；提問要有東西看", async () => {
  const m = await demo();
  const [s0, , s2] = m.blocks[0].steps;
  assert.match(checkDemoStep({ ...s2, tools: ["protractor"] }).join(), /protractor 不在這一步的 figure.tools/);
  assert.match(checkDemoStep({ ...s0, focus: ["ray-c"] }).join(), /focus 的 ray-c 不在/);
  assert.deepEqual(checkDemoStep({ ...s0, focus: ["v", "l-vertex", "angle"] }), []);
  assert.match(checkDemoStep({ text: { text: "x" }, ask: { text: "想一想？" } }).join(), /ask 的步驟要有 figure 或 expression/);
  assert.match(checkDemoStep({ text: { text: "x" }, focus: ["v"] }).join(), /有 tools 或 focus 卻沒有 figure/);
});

test("checkDemoAsk：提問只用在圖形講解（同一份示範至少一步帶 figure），否則答案會直接顯示（#77）", async () => {
  const m = await demo();
  assert.deepEqual(checkDemoAsk(m), []);
  const exprOnly = { blocks: [{ type: "math-demo", steps: [{ text: { text: "答案是 5" }, expression: "2+3", ask: { text: "2+3 是多少？" } }] }] };
  assert.match(checkDemoAsk(exprOnly).join(), /沒有任何一步帶 figure/);
  assert.deepEqual(checkDemoAsk({ blocks: [{ type: "math-demo", steps: [{ text: { text: "x" }, expression: "1+1" }] }] }), [], "沒有提問就不檢查");
});

test("驗證器在整包層級回報步驟錯誤", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-demo-"));
  try {
    await cp(EXAMPLE, dir, { recursive: true });
    const rel = path.join(dir, "materials", "m-angle-demo.json");
    const m = JSON.parse(await readFile(rel, "utf8"));
    m.blocks[0].steps[1].focus = ["nope"];
    await writeFile(rel, JSON.stringify(m));
    const pk = JSON.parse(await readFile(path.join(dir, "pack.json"), "utf8"));
    for (const f of pk.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
    await writeFile(path.join(dir, "pack.json"), JSON.stringify(pk));
    const r = await validatePack(dir);
    assert.ok(r.errors.some((e) => e.includes("materials/m-angle-demo.json/blocks/0/steps/1") && e.includes("focus 的 nope")), r.errors.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
