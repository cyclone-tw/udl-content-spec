// 練習分類與測驗藍圖（#50）：步驟分類、count "all"、課文題進題庫、測驗照分類從練習題庫抽、老師只指派某幾類。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planSteps, generate, profiles, toItemShape, correctResponse } from "../activities/index.mjs";
import { validatePack, loadValidators } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MINIMAL = path.join(here, "..", "examples", "minimal");
const DEMO = path.join(here, "..", "examples", "cards-demo");
const rd = async (dir, rel) => JSON.parse(await readFile(path.join(dir, rel), "utf8"));

const spoken = (text) => ({ text, audio: null });
const char = (c, z, confusables = []) => ({ format_version: 1, id: `c-${c.codePointAt(0).toString(16)}`, kind: "char", key: `${c}|${z}`, char: c, zhuyin: z, meaning: spoken(`${c} 的意思`), confusables });
const word = (w, z, meaning) => ({ format_version: 1, id: `w-${createHash("sha256").update(w).digest("hex").slice(0, 8)}`, kind: "word", key: `${w}|${z}`, word: w, zhuyin: z, meaning: spoken(meaning) });
const cards = {
  chars: [char("擇", "ㄗㄜˊ"), char("抉", "ㄐㄩㄝˊ"), char("勞", "ㄌㄠˊ")],
  words: [word("抉擇", "ㄐㄩㄝˊ ㄗㄜˊ", "從幾個裡面選出一個"), word("衡量", "ㄏㄥˊ ㄌㄧㄤˊ", "想清楚、比一比"), word("犧牲", "ㄒㄧ ㄕㄥ", "放棄一部分"), word("維持", "ㄨㄟˊ ㄔˊ", "保持原來的樣子")],
  patterns: [],
  skills: [],
};
const unit = { id: "u-g6", subject: "chinese", grade: 6, ladder_ids: ["5-Ⅲ-3#a@6"] };
let handItems;
async function loadHandItems() {
  handItems ??= await Promise.all(["i-choice-01", "i-tf-01", "i-ordering-01", "i-classify-01", "i-rhetoric-01", "i-match-01"].map((id) => rd(MINIMAL, `items/${id}.json`)));
  return handItems;
}

test("planSteps：高年級設定的練習步驟帶分類；測驗藍圖只接前面的練習步驟，題數＝藍圖加總", async () => {
  const items = await loadHandItems();
  const plan = planSteps({ unit, cards, items });
  const mix = (g) => plan.steps.find((s) => s.activity === "mix" && s.group === g);
  assert.deepEqual(mix("char").sources, ["listen-char", "char-pick"]);
  assert.ok(mix("word").sources.includes("word-meaning"));
  assert.deepEqual(mix("reading").sources, ["reading-items"], "沒有課文資料時只剩手寫題");
  assert.ok(mix("reading").sources_skipped.some((x) => x.activity === "para-gist"));
  assert.equal(mix("char").count, "all");
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  assert.equal(quiz.count, 10);
  assert.deepEqual(quiz.blueprint.map((b) => [b.group, b.count]), [["char", 2], ["word", 3], ["reading", 5]]);
  assert.deepEqual(quiz.blueprint.find((b) => b.group === "char").sources.sort(), ["char-pick", "listen-char"]);
  assert.ok(quiz.blueprint.find((b) => b.group === "word").sources.includes("word-meaning"));
  assert.deepEqual(quiz.blueprint.find((b) => b.group === "reading").sources, ["reading-items"]);
  for (const b of quiz.blueprint) for (const s of b.sources) assert.ok(plan.steps.some((x) => (x.activity === s || x.sources?.includes(s)) && x.index < quiz.index), `${s} 要在測驗前的練習裡`);
});

test("測驗：照藍圖各分類抽題，題目都來自練習活動，同一次不重複；同種子相同、換種子會變", async () => {
  const items = await loadHandItems();
  const plan = planSteps({ unit, cards, items });
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  const make = (seed) => generate("quiz", { unit, cards, seed, items, blueprint: quiz.blueprint, ladders: plan.ladders });
  const list = make("q1");
  assert.equal(list.length, 10);
  const count = (g) => list.filter((q) => q.quiz_group === g).length;
  assert.deepEqual([count("char"), count("word"), count("reading")], [2, 3, 5]);
  const practice = new Set(plan.steps.filter((s) => s.phase === "practice").flatMap((s) => s.sources ?? [s.activity]));
  assert.ok(list.every((q) => practice.has(q.quiz_source)));
  const keys = list.map((q) => (q.source === "items" ? q.id : `${q.quiz_source}:${q.cards.join()}`));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(make("q1"), list);
  assert.notDeepEqual(make("q2").map((q) => q.id), list.map((q) => q.id));
  const v = await loadValidators();
  for (const q of list) {
    assert.ok(v.item(toItemShape(q)), `${q.id}: ${JSON.stringify(v.item.errors)}`);
    assert.equal(score(q, correctResponse(q)).outcome, "correct", q.id);
  }
});

test("課文練習：手寫題照抄、id 不變、標 source items；count all 每題輪到一次", async () => {
  const items = await loadHandItems();
  const list = generate("reading-items", { unit, cards, seed: "r", items });
  assert.equal(list.length, items.length);
  assert.deepEqual(list.map((q) => q.id).sort(), items.map((i) => i.id).sort());
  for (const q of list) {
    assert.equal(q.source, "items");
    assert.equal(q.item, q.id);
    const orig = items.find((i) => i.id === q.id);
    assert.deepEqual(q.stem, orig.stem);
    assert.equal(q.read_aloud_scope, orig.read_aloud_scope ?? "all");
  }
  const generatedTemplate = { ...items[0], id: "i-gen", kind: "generated" };
  assert.equal(generate("reading-items", { unit, cards, seed: "r", items: [...items, generatedTemplate] }).length, items.length, "產生器模板不是課文題");
});

test("count all：卡片活動出題數＝題庫筆數，每張卡輪到一次", () => {
  const list = generate("listen-char", { unit, cards, seed: "a", count: "all" });
  assert.equal(list.length, cards.chars.length);
  assert.equal(new Set(list.map((q) => q.cards[0])).size, cards.chars.length);
  assert.equal(generate("word-meaning", { unit, cards, seed: "a", count: "all" }).length, cards.words.length);
  assert.throws(() => generate("skill-practice", { unit: { id: "u-m", subject: "math", grade: 2 }, cards: { chars: [], words: [], patterns: [], skills: [{ id: "sk" }] }, seed: 1, count: "all" }), /不支援 count "all"/);
});

test("老師調整：單元自己的藍圖題數；只指派某幾類時其他分類拿掉，測驗也只考這幾類", async () => {
  const items = await loadHandItems();
  const custom = { ...unit, activities: [...profiles["zh-high"].steps.filter((s) => s.activity !== "quiz"), { activity: "quiz", label: "小測驗", blueprint: [{ group: "char", count: 1 }, { group: "reading", count: 2 }] }] };
  const quiz = planSteps({ unit: custom, cards, items }).steps.find((s) => s.activity === "quiz");
  assert.equal(quiz.count, 3);
  const onlyChar = planSteps({ unit, cards, items, materials: [{ kind: "lesson" }], groups: ["char"] });
  assert.ok(onlyChar.steps.every((s) => !s.group || s.group === "char"));
  assert.ok(onlyChar.steps.some((s) => s.activity === "read"), "教學步驟不受分類影響");
  const q = onlyChar.steps.find((s) => s.activity === "quiz");
  assert.deepEqual(q.blueprint.map((b) => b.group), ["char"]);
  assert.equal(q.count, 2);
  assert.ok(onlyChar.skipped.some((s) => s.activity === "mix" && s.reason.includes("reading")));
});

test("題庫不夠：課文題少於藍圖時只出得了幾題就幾題，不重複；沒有來源的分類記在 blueprint_skipped", async () => {
  const items = (await loadHandItems()).slice(0, 3);
  const plan = planSteps({ unit, cards, items });
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  const list = generate("quiz", { unit, cards, seed: "few", items, blueprint: quiz.blueprint });
  assert.equal(list.filter((q) => q.quiz_group === "reading").length, 3);
  assert.equal(new Set(list.filter((q) => q.source === "items").map((q) => q.id)).size, 3);
  const noItems = planSteps({ unit, cards }).steps.find((s) => s.activity === "quiz");
  assert.deepEqual(noItems.blueprint.map((b) => b.group), ["char", "word"]);
  assert.equal(noItems.blueprint_skipped[0].group, "reading");
  const none = planSteps({ unit, cards: { chars: [], words: [], patterns: [], skills: [] } });
  assert.ok(none.skipped.some((s) => s.activity === "quiz" && s.reason.includes("藍圖")));
});

test("generate：blueprint 只給 quiz，形狀不對丟可讀的錯", () => {
  assert.throws(() => generate("listen-char", { unit, cards, seed: 1, blueprint: [] }), /只有 quiz/);
  assert.throws(() => generate("quiz", { unit, cards, seed: 1, blueprint: [] }), /非空陣列/);
  assert.throws(() => generate("quiz", { unit, cards, seed: 1, blueprint: [{ group: "char", count: 1, sources: ["word-meaning"] }] }), /不是「char」分類/);
  assert.equal(generate("quiz", { unit: { ...unit, grade: 4 }, cards, seed: 1 }).length, 5, "沒有藍圖時照舊");
});

test("聽音選語詞：第二層提示不透露讀音（#53）", () => {
  for (const q of generate("listen-word", { unit, cards, seed: "h", count: "all" })) {
    assert.ok(!/[ㄅ-ㄩ]/u.test(q.hints[1].text), q.hints[1].text);
    assert.match(q.hints[2].text, /注音/);
  }
});

test("schema：count 可為 all；藍圖分類與題數；未知分類不收", async () => {
  const v = await loadValidators();
  assert.equal(v.activityProfile(profiles["zh-high"]), true, JSON.stringify(v.activityProfile.errors));
  const with_ = (step) => ({ ...profiles["zh-high"], steps: [step] });
  assert.equal(v.activityProfile(with_({ activity: "listen-char", label: "聽", count: "all" })), true);
  for (const bad of [{ activity: "listen-char", label: "聽", count: "some" }, { activity: "quiz", label: "測", blueprint: [] }, { activity: "quiz", label: "測", blueprint: [{ group: "math", count: 1 }] }, { activity: "quiz", label: "測", blueprint: [{ group: "char", count: 0 }] }]) {
    assert.equal(v.activityProfile(with_(bad)), false, JSON.stringify(bad));
  }
});

test("驗證器：六年級單元綁卡＋手寫題，照高年級設定生題與藍圖測驗，0 錯誤", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-blueprint-"));
  try {
    await cp(DEMO, dir, { recursive: true });
    await mkdir(path.join(dir, "items"));
    await mkdir(path.join(dir, "pools"));
    const unitRel = "units/u-rain-park.json";
    const u = await rd(dir, unitRel);
    u.grade = 6;
    u.items = ["i-tf-01", "i-classify-01", "i-choice-01"];
    await writeFile(path.join(dir, unitRel), JSON.stringify(u, null, 2));
    const pack = await rd(dir, "pack.json");
    for (const id of u.items) {
      const it = await rd(MINIMAL, `items/${id}.json`);
      it.unit = u.id;
      await writeFile(path.join(dir, `items/${id}.json`), JSON.stringify(it, null, 2));
      pack.files.push({ path: `items/${id}.json`, sha256: "" });
    }
    if (!pack.pools?.length) {
      // i-choice-01 用了干擾項池：一併帶過來
      const choice = await rd(MINIMAL, "items/i-choice-01.json");
      if (choice.distractor_pool) {
        const pool = await rd(MINIMAL, `pools/${choice.distractor_pool.pool}.json`);
        await writeFile(path.join(dir, `pools/${pool.id}.json`), JSON.stringify(pool, null, 2));
        pack.pools = [pool.id];
        pack.files.push({ path: `pools/${pool.id}.json`, sha256: "" });
      }
    }
    for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
    await writeFile(path.join(dir, "pack.json"), JSON.stringify(pack, null, 2));
    const r = await validatePack(dir);
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => w.includes("藍圖「reading」要 5 題，題庫只出得了 3 題")), r.warnings.join("\n"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
