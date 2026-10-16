// 課文資料生題與混合練習（#51）：段落大意、段落排序、心智圖挖空與排序；三類混合練習步驟；#56 的藍圖與重複題修正。
// 課文與心智圖都是原創的合成資料，不含任何教科書課文。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planSteps, generate, profiles, toItemShape, correctResponse, misconceptions } from "../activities/index.mjs";
import { validatePack, loadValidators } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(here, "..", "examples", "cards-demo");
const spoken = (text) => ({ text, audio: null });

const PARAS = [
  ["小芽在窗邊找到一個空花盆，想種一顆向日葵種子。", "小芽想種向日葵"],
  ["她先把【土|tu】倒進花盆，再用手指挖一個小洞。", "小芽準備土和小洞"],
  ["種子放進洞裡以後，她輕輕蓋上土，再慢慢澆水。", "小芽種下種子並澆水"],
  ["過了一星期，土裡冒出兩片小小的綠葉。", "種子發芽了"],
];
const lesson = (paras = PARAS) => ({ format_version: 1, id: "m-seed-lesson", unit: "u-seed", kind: "lesson", title: spoken("小芽的種子"), vocab: { tu: { word: "土", meaning: spoken("泥土") } }, blocks: paras.map(([t, g]) => ({ type: "text", content: spoken(t), ...(g ? { gist: spoken(g) } : {}) })) });
const node = (text, children, extra = {}) => ({ text: spoken(text), ...(children ? { children } : {}), ...extra });
const mindmap = () => ({
  format_version: 1, id: "m-seed-map", unit: "u-seed", kind: "mindmap", title: spoken("小芽的種子"),
  blocks: [{ type: "mindmap", root: node("小芽的種子", [
    { label: "準備", ...node("要用的東西", [node("花盆"), node("土"), node("種子")]) },
    { label: "步驟", ...node("種的方法", [node("挖小洞"), node("放種子"), node("蓋上土"), node("澆水")], { ordered: true }) },
    { label: "結果", ...node("後來", [node("冒出綠葉"), node("小芽很開心")]) },
  ]) }],
});
const unit = { id: "u-seed", subject: "chinese", grade: 6, ladder_ids: ["5-Ⅲ-3#a@6"] };
const noCards = { chars: [], words: [], patterns: [], skills: [] };
const materials = [lesson(), mindmap()];

test("段落大意：一段一題，題幹帶段落（去掉語詞標記），錯的選項是別段大意、含最近的一段", () => {
  const list = generate("para-gist", { unit, cards: noCards, seed: "g", count: "all", materials });
  assert.equal(list.length, 4);
  for (const q of list) {
    const n = Number(q.anchor.slice(1));
    assert.ok(q.stem.text.text.includes(`第 ${n} 段`));
    assert.ok(!q.stem.text.text.includes("【"), q.stem.text.text);
    assert.equal(q.options.find((o) => o.id === q.answer).text.text, PARAS[n - 1][1]);
    const wrong = q.options.filter((o) => o.id !== q.answer);
    assert.ok(wrong.every((o) => o.misconception === "wrong-paragraph" && o.feedback.text.includes("段的重點")));
    const near = PARAS[n === 1 ? 1 : n - 2][1];
    assert.ok(wrong.some((o) => o.text.text === near), `第 ${n} 段的錯誤選項要有最近一段：${optionTexts(q)}`);
    assert.equal(q.source, "materials");
    assert.equal(q.material, "m-seed-lesson");
  }
  assert.ok(Object.hasOwn(misconceptions, "wrong-paragraph"));
});
const optionTexts = (q) => q.options.map((o) => o.text.text).join("／");

test("段落排序：照課文順序；超過 8 段時切成幾組連續段落，每組 3 到 8 段", () => {
  const [q] = generate("para-order", { unit, cards: noCards, seed: "o", count: "all", materials });
  assert.deepEqual(q.sequence.map((s) => s.text.text), PARAS.map((p) => p[1]));
  const ten = Array.from({ length: 10 }, (_, i) => [`第${i + 1}段的內容。`, `大意${i + 1}`]);
  const chunks = generate("para-order", { unit, cards: noCards, seed: "o", count: "all", materials: [lesson(ten)] });
  assert.deepEqual(chunks.map((c) => c.sequence.length).sort(), [4, 6]);
  assert.ok(chunks.every((c) => c.stem.text.text.includes("到第")));
});

test("心智圖挖空：少了哪一個；錯的選項來自別的分支、不會是同一支已有的內容", () => {
  const list = generate("mindmap-pick", { unit, cards: noCards, seed: "m", count: "all", materials });
  assert.equal(list.length, 12, "第一層 3 個分支＋三個分支下的 9 個子節點");
  const root = mindmap().blocks[0].root;
  for (const q of list) {
    const answer = q.options.find((o) => o.id === q.answer).text.text;
    const branch = root.children.some((b) => b.text.text === answer) ? { label: root.text.text, children: root.children } : root.children.find((b) => b.children.some((c) => c.text.text === answer));
    const siblings = branch.children.map((c) => c.text.text);
    for (const o of q.options.filter((x) => x.id !== q.answer)) {
      assert.ok(!siblings.includes(o.text.text), `${o.text.text} 是同一支的`);
      assert.equal(o.misconception, "wrong-branch");
    }
    assert.ok(q.stem.text.text.includes(`「${branch.label}」`));
  }
});

test("心智圖排序：標了 ordered 的節點才出，照子節點順序", () => {
  const list = generate("mindmap-order", { unit, cards: noCards, seed: "s", count: "all", materials });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].sequence.map((s) => s.text.text), ["挖小洞", "放種子", "蓋上土", "澆水"]);
  assert.ok(list[0].stem.text.text.includes("步驟"));
});

test("高年級設定：識字、語詞、課文三個混合練習步驟；課文練習混合段落、心智圖與手寫題", () => {
  const plan = planSteps({ unit, cards: noCards, materials, items: [] });
  const reading = plan.steps.find((s) => s.activity === "mix" && s.group === "reading");
  assert.deepEqual(reading.sources, ["para-gist", "para-order", "mindmap-pick", "mindmap-order"]);
  assert.ok(reading.sources_skipped.some((x) => x.activity === "reading-items"));
  assert.ok(profiles["zh-high"].steps.length <= 12);
  assert.deepEqual(profiles["zh-high"].steps.filter((s) => s.activity === "mix").map((s) => s.label), ["識字練習", "語詞練習", "課文練習"]);
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  assert.deepEqual(quiz.blueprint.map((b) => b.group), ["reading"]);
  assert.deepEqual(quiz.blueprint[0].sources, reading.sources);
});

test("混合練習：count all＝各來源題庫加總，依來源順序成段，每題不重複；題目帶 mix_source 與各自的能力階梯", async () => {
  const plan = planSteps({ unit, cards: noCards, materials });
  const step = plan.steps.find((s) => s.activity === "mix" && s.group === "reading");
  const list = generate("mix", { unit, cards: noCards, seed: "x", count: step.count, sources: step.sources, materials, ladders: plan.ladders });
  assert.equal(list.length, 4 + 1 + 12 + 1);
  const order = list.map((q) => q.mix_source).filter((s, i, a) => a.indexOf(s) === i);
  assert.deepEqual(order, step.sources);
  assert.equal(new Set(list.map((q) => JSON.stringify(q.stem) + JSON.stringify(q.options ?? q.sequence))).size, list.length);
  assert.deepEqual(list.find((q) => q.mix_source === "para-gist").ladder_ids, ["5-Ⅲ-6#a"]);
  assert.deepEqual(list.find((q) => q.mix_source === "mindmap-pick").ladder_ids, ["5-Ⅲ-6#b"]);
  const v = await loadValidators();
  for (const q of list) {
    const shape = toItemShape(q);
    for (const k of ["material", "anchor", "mix_source"]) assert.equal(shape[k], undefined, k);
    assert.ok(v.item(shape), `${q.id}: ${JSON.stringify(v.item.errors)}`);
    assert.equal(score(q, correctResponse(q)).outcome, "correct");
  }
  assert.deepEqual(generate("mix", { unit, cards: noCards, seed: "x", count: "all", sources: step.sources, materials }), generate("mix", { unit, cards: noCards, seed: "x", count: "all", sources: step.sources, materials }));
  const three = generate("mix", { unit, cards: noCards, seed: "x", count: 3, sources: step.sources, materials });
  assert.equal(three.length, 3);
});

test("混合練習與藍圖：設定寫錯是錯誤、條件不足只略過（#51、#56）", () => {
  const steps = (list) => planSteps({ unit: { ...unit, activities: list }, cards: noCards, materials });
  const mixed = steps([{ activity: "mix", label: "亂混", sources: ["para-gist", "listen-char"] }]);
  assert.ok(mixed.skipped.some((s) => s.config && s.reason.includes("同一分類")));
  const bad = steps([{ activity: "mix", label: "錯", sources: ["quiz"] }]);
  assert.ok(bad.skipped.some((s) => s.config));
  const bp = steps([{ activity: "para-gist", label: "段落", blueprint: [{ group: "reading", count: 1 }] }]);
  assert.ok(bp.skipped.some((s) => s.config && s.reason.includes("blueprint")));
  const math = planSteps({ unit: { id: "u-m", subject: "math", grade: 2, activities: [{ activity: "skill-practice", label: "計算", count: "all" }] }, cards: { ...noCards, skills: [{ id: "sk" }] } });
  assert.ok(math.skipped.some((s) => s.config && s.reason.includes("all")));
  // 沒有題庫的活動（技能練習）不當藍圖來源：略過，不會讓 generate 丟錯（#56）
  const skillQuiz = planSteps({ unit: { id: "u-m", subject: "math", grade: 2, activities: [{ activity: "skill-practice", label: "計算" }, { activity: "quiz", label: "測驗", blueprint: [{ group: "skill", count: 2 }] }] }, cards: { ...noCards, skills: [{ id: "sk" }] } });
  assert.ok(skillQuiz.skipped.some((s) => s.activity === "quiz" && s.reason.includes("藍圖")));
  assert.throws(() => generate("mix", { unit, cards: noCards, seed: 1, materials }), /需要 sources/);
  assert.throws(() => generate("mix", { unit, cards: noCards, seed: 1, materials, sources: ["para-gist", "word-meaning"] }), /word-meaning|同一分類/);
});

test("schema：段落 gist、心智圖 ordered、mix 的 sources", async () => {
  const v = await loadValidators();
  for (const m of materials) assert.ok(v.material(m), JSON.stringify(v.material.errors));
  const badGist = lesson();
  badGist.blocks[0].gist = "不是 spoken_text";
  assert.equal(v.material(badGist), false);
  const p = { ...profiles["zh-high"] };
  assert.ok(v.activityProfile(p), JSON.stringify(v.activityProfile.errors));
  assert.equal(v.activityProfile({ ...p, steps: [{ activity: "mix", label: "混", sources: [] }] }), false);
  assert.equal(v.activityProfile({ ...p, steps: [{ activity: "mix", label: "混", sources: ["nope"] }] }), false);
});

async function demoGrade6(dir, { mutateLesson, mutateUnit } = {}) {
  await cp(DEMO, dir, { recursive: true });
  const rel = (r) => path.join(dir, r);
  const u = JSON.parse(await readFile(rel("units/u-rain-park.json"), "utf8"));
  u.grade = 6;
  mutateUnit?.(u);
  await writeFile(rel("units/u-rain-park.json"), JSON.stringify(u, null, 2));
  const l = JSON.parse(await readFile(rel("materials/m-rain-park-lesson.json"), "utf8"));
  l.blocks.forEach((b, i) => { b.gist = spoken(`示範段落大意${i + 1}`); });
  mutateLesson?.(l);
  await writeFile(rel("materials/m-rain-park-lesson.json"), JSON.stringify(l, null, 2));
  const pack = JSON.parse(await readFile(rel("pack.json"), "utf8"));
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(rel(f.path))).digest("hex");
  await writeFile(rel("pack.json"), JSON.stringify(pack, null, 2));
}

test("驗證器：六年級單元有段落大意與心智圖，照三個混合練習與藍圖生題，0 錯誤", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-reading-"));
  try {
    await demoGrade6(dir);
    const r = await validatePack(dir);
    assert.deepEqual(r.errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("驗證器：同一張句型卡的兩個例句在同一次測驗不算重複（#56）；設定錯誤報錯", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-reading-"));
  try {
    await demoGrade6(dir, { mutateUnit: (u) => { u.activities = [{ activity: "sentence-order", label: "句型", count: "all" }, { activity: "quiz", label: "測驗", blueprint: [{ group: "word", count: 2 }] }]; } });
    const r = await validatePack(dir);
    assert.deepEqual(r.errors, []);
    await demoGrade6(dir, { mutateUnit: (u) => { u.activities = [{ activity: "mix", label: "亂混", sources: ["para-gist", "listen-char"] }]; } });
    assert.ok((await validatePack(dir)).errors.some((e) => e.includes("設定錯誤") && e.includes("同一分類")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- #60：意義段（gist_span）與前言（preface） ----------
const LONG = "小芽每天放學都去看花盆，".repeat(12);
const spanLesson = () => ({
  format_version: 1, id: "m-span-lesson", unit: "u-seed", kind: "lesson", title: spoken("小芽的花"),
  blocks: [
    { type: "text", content: spoken("前言：小芽是三年級的學生。"), preface: true },
    { type: "text", content: spoken("小芽想種花。"), gist: spoken("小芽想種花") },
    { type: "text", content: spoken("她找來花盆。"), gist: spoken("小芽準備材料並種下種子"), gist_span: 3 },
    { type: "image", src: "images/pot.png", alt: "花盆" },
    { type: "text", content: spoken("她倒進泥土。") },
    { type: "text", content: spoken("她放進種子。") },
    { type: "text", content: spoken(LONG), gist: spoken("小芽每天照顧花") },
  ],
});

test("意義段：一句大意涵蓋好幾段，前言不編段號、插圖不影響段號；太長的段落只引開頭（#60）", () => {
  const ms = [spanLesson()];
  const list = generate("para-gist", { unit, cards: noCards, seed: "s", count: "all", materials: ms });
  assert.equal(list.length, 3);
  const byAnchor = Object.fromEntries(list.map((q) => [q.anchor, q]));
  assert.deepEqual(Object.keys(byAnchor).sort(), ["p1", "p2-p4", "p5"]);
  assert.match(byAnchor["p2-p4"].stem.text.text, /^第 2 到 4 段：「她找來花盆。她倒進泥土。她放進種子。」這幾段主要在說什麼？$/);
  assert.match(byAnchor.p5.stem.text.text, /^回到課文讀第 5 段（從「小芽每天放學都去看花盆，/);
  assert.ok(list.every((q) => !q.stem.text.text.includes("前言")));
  const wrong = byAnchor.p1.options.find((o) => o.id !== byAnchor.p1.answer && o.text.text === "小芽準備材料並種下種子");
  assert.match(wrong.feedback.text, /第 2 到 4 段的重點/);
  const [order] = generate("para-order", { unit, cards: noCards, seed: "s", count: "all", materials: ms });
  assert.deepEqual(order.sequence.map((x) => x.text.text), ["小芽想種花", "小芽準備材料並種下種子", "小芽每天照顧花"]);
});

test("驗證器：gist_span 超出課文、意義段重疊、前言帶大意都報錯（#60）", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-span-"));
  try {
    const set = (mutate) => demoGrade6(dir, { mutateLesson: (l) => { l.blocks.forEach((b) => { delete b.gist; }); mutate(l); } });
    await set((l) => { l.blocks[0].gist = spoken("一"); l.blocks[0].gist_span = 9; });
    assert.ok((await validatePack(dir)).errors.some((e) => e.includes("gist_span 9 超出課文")));
    await set((l) => { l.blocks[0].gist = spoken("一"); l.blocks[0].gist_span = 2; l.blocks[1].gist = spoken("二"); });
    assert.ok((await validatePack(dir)).errors.some((e) => e.includes("已經在前一個意義段")));
    await set((l) => { l.blocks[0].preface = true; l.blocks[0].gist = spoken("一"); });
    assert.ok((await validatePack(dir)).errors.some((e) => e.includes("前言（preface）")));
    await set((l) => { l.blocks[0].gist = spoken("一"); l.blocks[0].gist_span = 2; l.blocks[2].gist = spoken("三"); l.blocks[2].gist_span = 2; });
    assert.deepEqual((await validatePack(dir)).errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
