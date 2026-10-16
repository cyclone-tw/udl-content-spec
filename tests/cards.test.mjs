import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, loadValidators, checkCard } from "../conformance/validate.mjs";
import { profiles, activityIds, generatingActivities, profileFor, resolveBindings, planSteps, generate, toItemShape, toInstanceShape, correctResponse } from "../activities/index.mjs";
import { score } from "../question-types/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, "..", "examples", "cards-demo");
const rd = async (rel) => JSON.parse(await readFile(path.join(EXAMPLE, rel), "utf8"));
const has = (list, ...needles) => list.some((e) => needles.every((n) => e.includes(n)));

async function loadUnit(unitId) {
  const unit = await rd(`units/${unitId}.json`);
  const pack = await rd("pack.json");
  const all = new Map();
  for (const id of pack.cards) all.set(id, await rd(`cards/${id}.json`));
  const { cards, errors } = resolveBindings(unit, (ref) => all.get(ref) ?? null);
  assert.deepEqual(errors, []);
  const materials = await Promise.all(unit.materials.map((m) => rd(`materials/${m}.json`)));
  return { unit, cards, materials, all };
}

async function withCopy(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-cards-"));
  await cp(EXAMPLE, dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function editJson(dir, rel, mutate) {
  const p = path.join(dir, rel);
  const obj = JSON.parse(await readFile(p, "utf8"));
  mutate(obj);
  await writeFile(p, JSON.stringify(obj, null, 2));
}
async function rehash(dir) {
  const { createHash } = await import("node:crypto");
  const p = path.join(dir, "pack.json");
  const pack = JSON.parse(await readFile(p, "utf8"));
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
  await writeFile(p, JSON.stringify(pack, null, 2));
}

test("年級活動設定：四份內建設定都通過 schema，活動 id 都已登錄", async () => {
  const v = await loadValidators();
  assert.deepEqual(Object.keys(profiles).sort(), ["math-elementary", "zh-high", "zh-low", "zh-mid"]);
  for (const p of Object.values(profiles)) {
    assert.ok(v.activityProfile(p), `${p.id}: ${JSON.stringify(v.activityProfile.errors)}`);
    for (const s of p.steps) assert.ok(activityIds.includes(s.activity), `${p.id}: ${s.activity}`);
  }
  assert.equal(profileFor("chinese", 4).id, "zh-mid");
  assert.equal(profileFor("chinese", 6).id, "zh-high");
  assert.equal(profileFor("math", 2).id, "math-elementary");
  assert.equal(profileFor("chinese", 9), null);
});

test("範例卡片包：驗證通過、9 張卡、0 錯誤", async () => {
  const r = await validatePack(EXAMPLE);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.counts.cards, 9);
  assert.equal(r.counts.units, 2);
});

test("planSteps：同一課依年級設定排出不同關卡；心智圖只在高年級設定出現", async () => {
  const { unit, cards, materials } = await loadUnit("u-rain-park");
  const mid = planSteps({ unit, cards, materials });
  assert.equal(mid.profile, "zh-mid");
  assert.deepEqual(mid.steps.map((s) => s.label), ["讀課文", "生字", "語詞配對", "句型排序", "小測驗"]);
  assert.deepEqual(mid.steps.map((s) => s.phase), ["learn", "practice", "practice", "practice", "battle"]);
  const high = planSteps({ unit, cards, materials, profile: profiles["zh-high"] });
  assert.ok(high.steps.some((s) => s.activity === "mindmap"));
  const low = planSteps({ unit, cards, materials, profile: profiles["zh-low"] });
  assert.deepEqual(low.steps.map((s) => s.label), ["聽故事", "認字", "配對", "小測驗"]);
});

test("planSteps：條件不足的步驟略過並說明理由，不丟錯", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  const noMindmap = planSteps({ unit, cards, materials: [{ kind: "lesson" }], profile: profiles["zh-high"] });
  assert.ok(!noMindmap.steps.some((s) => s.activity === "mindmap"));
  assert.ok(noMindmap.skipped.some((s) => s.activity === "mindmap" && s.reason.includes("心智圖")));
  const noPattern = planSteps({ unit, cards: { ...cards, patterns: [] }, materials: [{ kind: "lesson" }] });
  assert.ok(noPattern.skipped.some((s) => s.activity === "sentence-order"));
  const custom = planSteps({ unit: { ...unit, activities: [{ activity: "read", label: "讀一讀" }, { activity: "quiz", label: "考考你", count: 3 }] }, cards, materials: [{ kind: "lesson" }] });
  assert.equal(custom.profile, null);
  assert.deepEqual(custom.steps.map((s) => [s.label, s.count]), [["讀一讀", undefined], ["考考你", 3]]);
});

test("數學單元：示範、操作、計算練習、小測驗", async () => {
  const { unit, cards, materials } = await loadUnit("u-add-skill");
  const plan = planSteps({ unit, cards, materials });
  assert.equal(plan.profile, "math-elementary");
  assert.deepEqual(plan.steps.map((s) => s.activity), ["demo", "manipulate", "skill-practice", "quiz"]);
});

test("生題：每個生題活動都產出合格題目，正解拿滿分", async () => {
  const v = await loadValidators();
  const zh = await loadUnit("u-rain-park");
  const math = await loadUnit("u-add-skill");
  for (const activity of generatingActivities) {
    // 課文類不從卡片生，混合練習要 sources：見 tests/blueprint.test.mjs、tests/reading-data.test.mjs
    if (["reading-items", "para-gist", "para-order", "mindmap-pick", "mindmap-order", "rhetoric-pick", "rhetoric-sort", "mix"].includes(activity)) continue;
    const ctx = activity === "skill-practice" ? math : activity === "quiz" ? zh : zh;
    const list = generate(activity, { unit: ctx.unit, cards: ctx.cards, seed: "t1" });
    assert.ok(list.length > 0, activity);
    for (const q of list) {
      const ok = q.generator ? v.instance(toInstanceShape(q)) : v.item(toItemShape(q));
      assert.ok(ok, `${activity} ${q.id}: ${JSON.stringify(q.generator ? v.instance.errors : v.item.errors)}`);
      assert.equal(score(q, correctResponse(q)).outcome, "correct", `${activity} ${q.id}`);
      assert.equal(q.activity, activity);
    }
  }
  const mathQuiz = generate("quiz", { unit: math.unit, cards: math.cards, seed: "t1", count: 3 });
  assert.equal(mathQuiz.length, 3);
  assert.ok(mathQuiz.every((q) => q.generator === "math.add-sub"));
});

test("生題：同一單元＋同一種子結果相同；換種子會變", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  for (const activity of ["char-pick", "word-cloze", "quiz"]) {
    const a = generate(activity, { unit, cards, seed: "same" });
    const b = generate(activity, { unit, cards, seed: "same" });
    assert.deepEqual(a, b, activity);
  }
  const x = JSON.stringify(generate("quiz", { unit, cards, seed: "s1" }));
  const y = JSON.stringify(generate("quiz", { unit, cards, seed: "s2" }));
  assert.notEqual(x, y);
});

test("選字題：干擾項優先用卡片的易混淆字，選項不重複且含正解", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  for (const q of generate("char-pick", { unit, cards, seed: "c", count: 6 })) {
    const texts = q.options.map((o) => o.text.text);
    assert.equal(new Set(texts).size, texts.length);
    const card = cards.chars.find((c) => c.id === q.cards[0]);
    assert.ok(texts.includes(card.char));
    assert.ok(texts.some((t) => card.confusables.some((c) => c.char === t)), `${card.char}: ${texts}`);
  }
});

test("語詞填空：題幹挖掉語詞、選項有正解", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  for (const q of generate("word-cloze", { unit, cards, seed: "w" })) {
    const card = cards.words.find((c) => c.id === q.cards[0]);
    assert.ok(!q.stem.text.text.includes(card.word));
    assert.equal(q.options.find((o) => o.id === q.answer).text.text, card.word);
  }
});

test("generate：沒有種子、不是生題活動、卡不夠，都丟出可讀的錯", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  assert.throws(() => generate("quiz", { unit, cards }), /seed/);
  assert.throws(() => generate("read", { unit, cards, seed: 1 }), /不是會生題/);
  assert.throws(() => generate("skill-practice", { unit, cards, seed: 1 }), /技能卡/);
});

test("checkCard：鍵、注音音節數、例句、易混淆字", () => {
  const sp = (text) => ({ text, audio: null });
  assert.deepEqual(checkCard({ kind: "char", key: "彩|ㄘㄞˇ", char: "彩", zhuyin: "ㄘㄞˇ", meaning: sp("x") }), []);
  assert.ok(has(checkCard({ kind: "char", key: "彩", char: "彩", zhuyin: "ㄘㄞˇ", meaning: sp("x") }), "key"));
  assert.ok(has(checkCard({ kind: "word", key: "彩虹|ㄘㄞˇ", word: "彩虹", zhuyin: "ㄘㄞˇ", meaning: sp("x") }), "音節"));
  assert.ok(has(checkCard({ kind: "word", key: "彩虹|ㄘㄞˇ ㄏㄨㄥˊ", word: "彩虹", zhuyin: "ㄘㄞˇ ㄏㄨㄥˊ", meaning: sp("x"), example: sp("天上有雲。") }), "例句"));
  assert.ok(has(checkCard({ kind: "char", key: "彩|ㄘㄞˇ", char: "彩", zhuyin: "ㄘㄞˇ", meaning: sp("x"), confusables: [{ char: "彩" }] }), "confusables"));
});

test("驗證器：綁到不存在的卡、綁錯種類、鍵重複、例詞不含該字，都報錯", async () => {
  await withCopy(async (dir) => {
    await editJson(dir, "units/u-rain-park.json", (u) => {
      u.bindings.chars.push("c-missing");
      u.bindings.words.push("c-cai3");
    });
    await editJson(dir, "cards/w-dashu.json", (c) => {
      c.key = "彩虹|ㄘㄞˇ ㄏㄨㄥˊ";
    });
    await editJson(dir, "cards/c-ting2.json", (c) => {
      c.words = ["w-dashu"];
    });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(has(r.errors, "u-rain-park", "c-missing"));
    assert.ok(has(r.errors, "u-rain-park", "c-cai3", "不是 word"));
    assert.ok(has(r.errors, "w-dashu", "key"));
    assert.ok(has(r.errors, "c-ting2", "不含「停」"));
  });
});

test("驗證器：技能卡參數超出能力指標條件檔範圍會報錯", async () => {
  await withCopy(async (dir) => {
    await editJson(dir, "cards/sk-add-sub-2digit.json", (c) => {
      c.params.tiers = ["no-such-tier"];
      delete c.params.weights;
    });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.equal(r.ok, false);
    assert.ok(has(r.errors, "sk-add-sub-2digit"));
  });
});

test("驗證器：卡片庫包（沒有單元）可以通過；沒有單元也沒有卡就報錯", async () => {
  await withCopy(async (dir) => {
    await editJson(dir, "pack.json", (p) => {
      p.units = [];
    });
    const r = await validatePack(dir);
    assert.deepEqual(r.errors, []);
    await editJson(dir, "pack.json", (p) => {
      p.cards = [];
    });
    const r2 = await validatePack(dir);
    assert.ok(has(r2.errors, "cards 至少"));
  });
});

test("驗證器：跨包綁卡沒給 --cards-from 只警告；給了就解析", async () => {
  await withCopy(async (lib) => {
    await withCopy(async (dir) => {
      await editJson(dir, "units/u-rain-park.json", (u) => {
        u.bindings.words = ["sample-cards@0.1.0#w-caihong", "sample-cards@latest#w-gongyuan"];
        u.core = ["c-cai3", "sample-cards@0.1.0#w-caihong"];
      });
      await rehash(dir);
      const warned = await validatePack(dir);
      assert.deepEqual(warned.errors, []);
      assert.ok(has(warned.warnings, "跨包卡片", "--cards-from"));
      const resolved = await validatePack(dir, { cardsFrom: [lib] });
      assert.deepEqual(resolved.errors, []);
      assert.ok(!has(resolved.warnings, "跨包卡片"));
    });
  });
});

// ---------- #33：活動 × 年級能力階梯、核心卡、報讀範圍、任務對話 ----------

test("能力階梯：卡片生的題優先用年級設定的 ladders，單元可覆寫，沒有就退回單元", async () => {
  const { unit, cards, materials } = await loadUnit("u-rain-park");
  const plan = planSteps({ unit, cards, materials });
  assert.deepEqual(plan.ladders["char-pick"], ["4-Ⅱ-1#c@4", "4-Ⅱ-4#a"]);
  assert.equal(plan.ladder_status, "draft");
  const pick = generate("char-pick", { unit, cards, seed: "l", ladders: plan.ladders });
  assert.ok(pick.every((q) => q.ladder_ids.join() === "4-Ⅱ-1#c@4,4-Ⅱ-4#a"));
  const quiz = generate("quiz", { unit, cards, seed: "l", ladders: plan.ladders });
  for (const q of quiz) assert.deepEqual(q.ladder_ids, plan.ladders[q.quiz_source] ?? unit.ladder_ids, q.quiz_source);
  const grade3 = planSteps({ unit: { ...unit, grade: 3 }, cards, materials });
  assert.deepEqual(grade3.ladders["char-pick"], ["4-Ⅱ-1#a@3", "4-Ⅱ-4#a"]);
  const overridden = planSteps({ unit: { ...unit, ladders: { "char-pick": ["4-Ⅱ-4#a"] } }, cards, materials });
  assert.deepEqual(overridden.ladders["char-pick"], ["4-Ⅱ-4#a"]);
  const noMap = generate("sentence-order", { unit, cards, seed: "l", ladders: plan.ladders });
  assert.ok(noMap.every((q) => q.ladder_ids.join() === unit.ladder_ids.join()));
});

test("驗證器：卡片生的題沒有任何能力階梯來源就報錯", async () => {
  await withCopy(async (dir) => {
    await editJson(dir, "units/u-rain-park.json", (u) => {
      delete u.ladder_ids;
      u.activities = [{ activity: "sentence-order", label: "句型" }];
    });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "u-rain-park", "sentence-order", "ladder_ids"), r.errors.join("\n"));
  });
});

test("報讀範圍：識字類只唸題幹，句型排序可全唸；步驟可覆寫；數學產生題也帶", async () => {
  const { unit, cards, materials } = await loadUnit("u-rain-park");
  assert.ok(generate("char-pick", { unit, cards, seed: "r" }).every((q) => q.read_aloud_scope === "stem"));
  assert.ok(generate("sentence-order", { unit, cards, seed: "r" }).every((q) => q.read_aloud_scope === "all"));
  assert.ok(generate("char-pick", { unit, cards, seed: "r", readAloud: "none" }).every((q) => q.read_aloud_scope === "none"));
  const plan = planSteps({ unit, cards, materials });
  assert.equal(plan.steps.find((s) => s.activity === "sentence-order").read_aloud_scope, "all");
  const math = await loadUnit("u-add-skill");
  assert.ok(generate("skill-practice", { unit: math.unit, cards: math.cards, seed: "r" }).every((q) => q.read_aloud_scope === "stem"));
});

test("核心卡：coreOnly 只用標了 core 的卡；沒標 core 時丟錯", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  const core = new Set(unit.core);
  for (const q of generate("quiz", { unit, cards, seed: "c", coreOnly: true, count: 8 })) {
    for (const id of q.cards) assert.ok(core.has(id), `${id} 不是核心卡`);
  }
  assert.throws(() => generate("quiz", { unit: { ...unit, core: undefined }, cards, seed: "c", coreOnly: true }), /core/);
});

test("驗證器：core 不在 bindings、quest 指到不存在或非 dialogue 的教材都報錯", async () => {
  await withCopy(async (dir) => {
    await editJson(dir, "units/u-rain-park.json", (u) => {
      u.core.push("w-not-bound");
      u.quest = { intro: "m-rain-park-lesson", outro: "m-missing" };
    });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, "core 的 w-not-bound"));
    assert.ok(has(r.errors, "quest.intro", "dialogue"));
    assert.ok(has(r.errors, "quest.outro", "m-missing"));
  });
});

test("選字題 needs：只有一張生字卡且沒有易混淆字時不排這一步，也不出測驗", async () => {
  const { unit, cards } = await loadUnit("u-rain-park");
  const lone = { chars: [{ ...cards.chars[0], confusables: [] }], words: [], patterns: [], skills: [] };
  const plan = planSteps({ unit: { ...unit, activities: [{ activity: "char-pick", label: "選字" }, { activity: "quiz", label: "測驗" }] }, cards: lone, materials: [] });
  assert.deepEqual(plan.steps, []);
  assert.ok(plan.skipped.some((s) => s.activity === "char-pick" && s.reason.includes("湊不出選項")));
  const withConfusable = { ...lone, chars: [cards.chars[0]] };
  assert.ok(generate("char-pick", { unit, cards: withConfusable, seed: 1 }).every((q) => q.options.length >= 2));
});

test("checkCard：例句重複出現語詞、易混淆字重複都報錯", () => {
  const sp = (text) => ({ text, audio: null });
  assert.ok(has(checkCard({ kind: "word", key: "彩虹|ㄘㄞˇ ㄏㄨㄥˊ", word: "彩虹", zhuyin: "ㄘㄞˇ ㄏㄨㄥˊ", meaning: sp("x"), example: sp("彩虹出現了，彩虹很美。") }), "不只一次"));
  assert.ok(has(checkCard({ kind: "char", key: "彩|ㄘㄞˇ", char: "彩", zhuyin: "ㄘㄞˇ", meaning: sp("x"), confusables: [{ char: "採" }, { char: "採" }] }), "重複"));
});
