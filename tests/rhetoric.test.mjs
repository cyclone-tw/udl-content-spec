// 修辭例句池（#51）與 #57 review 後續（#58）。例句全是原創，不含教科書課文。
import { test } from "node:test";
import assert from "node:assert/strict";
import { planSteps, generate, rhetoricDevices, misconceptions, toItemShape, correctResponse } from "../activities/index.mjs";
import { loadValidators } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";

const spoken = (text) => ({ text, audio: null });
const EXAMPLES = [
  ["月亮像一艘小船，掛在天上。", ["simile"], "把月亮比成小船，用了「像」。"],
  ["小草伸伸懶腰，跟太陽說早安。", ["personification"], "小草會伸懶腰、會說話，像人一樣。"],
  ["他的笑聲大得連屋頂都要掀開了。", ["hyperbole"], "笑聲不可能掀開屋頂，是故意說得很誇張。"],
  ["好香好香的麵包，終於出爐了。", ["repetition"], "「好香」重複了兩次。"],
  ["為什麼天空是藍色的呢？原來是陽光被空氣散開了。", ["rhetorical-question"], "先提出問題，再回答。"],
  ["俗話說：「一分耕耘，一分收穫。」", ["quotation"], "借用了俗話。"],
  ["風輕輕唱著歌，像媽媽在哄我睡覺。", ["personification", "simile"], "風會唱歌是擬人，也用「像」來比方。"],
];
const rhetoricMaterial = (list = EXAMPLES) => ({ format_version: 1, id: "m-demo-rhetoric", unit: "u-r", kind: "rhetoric", title: spoken("修辭例句"), blocks: list.map(([t, d, n]) => ({ type: "rhetoric", text: spoken(t), devices: d, note: spoken(n) })) });
const unit = { id: "u-r", subject: "chinese", grade: 6, ladder_ids: ["6-Ⅲ-6#a"] };
const noCards = { chars: [], words: [], patterns: [], skills: [] };
const materials = [rhetoricMaterial()];
const label = (d) => rhetoricDevices[d].label;

test("修辭選擇：一句一題，正解是主要修辭；錯的選項不會是這句用到的修辭，常混淆的優先", () => {
  const list = generate("rhetoric-pick", { unit, cards: noCards, seed: "r", count: "all", materials });
  assert.equal(list.length, EXAMPLES.length);
  for (const q of list) {
    const ex = EXAMPLES.find(([t]) => q.stem.text.text.includes(t));
    const answer = q.options.find((o) => o.id === q.answer).text.text;
    assert.equal(answer, label(ex[1][0]));
    const wrong = q.options.filter((o) => o.id !== q.answer);
    for (const o of wrong) {
      assert.ok(!ex[1].map(label).includes(o.text.text), `${ex[0]}：${o.text.text} 是這句用到的修辭`);
      assert.equal(o.misconception, "rhetoric-mixup");
      assert.ok(!o.feedback.text.includes(`「${answer}」`), "逐選項回饋不直接說出答案");
    }
    if (ex[1][0] === "simile" && ex[1].length === 1) assert.ok(wrong.some((o) => o.text.text === label("personification")), "譬喻題要放擬人當干擾項");
    if (ex[1][0] === "repetition") assert.ok(wrong.some((o) => o.text.text === label("parallelism")), "類疊題要放排比當干擾項");
    assert.equal(q.skill, "修辭");
    assert.match(q.feedback.correct.text, new RegExp(answer));
  }
  assert.ok(Object.hasOwn(misconceptions, "rhetoric-mixup"));
});

test("修辭分類：2 到 3 種修辭、最多 6 句、只用一句一種修辭的例句，正解拿滿分", async () => {
  const v = await loadValidators();
  for (const seed of ["a", "b", "c"]) {
    const [q] = generate("rhetoric-sort", { unit, cards: noCards, seed, count: 1, materials });
    assert.ok(q.bins.length >= 2 && q.bins.length <= 3);
    assert.ok(q.objects.length >= 2 && q.objects.length <= 6);
    assert.ok(!q.objects.some((o) => o.text.text.includes("風輕輕唱著歌")), "兩種修辭的句子不放進分類題");
    for (const o of q.objects) {
      const ex = EXAMPLES.find(([t]) => t === o.text.text);
      assert.equal(o.bin, ex[1][0]);
    }
    assert.ok(v.item(toItemShape(q)), JSON.stringify(v.item.errors));
    assert.equal(score(q, correctResponse(q)).outcome, "correct");
  }
});

test("needs：沒有修辭例句就略過；一句一種的例句不到 4 句不出分類題", () => {
  const steps = (m) => planSteps({ unit: { ...unit, activities: [{ activity: "mix", label: "課文練習", sources: ["rhetoric-pick", "rhetoric-sort"] }] }, cards: noCards, materials: m });
  assert.ok(steps([]).skipped.some((s) => s.reason.includes("修辭例句")));
  const few = steps([rhetoricMaterial(EXAMPLES.slice(0, 3))]);
  assert.deepEqual(few.steps[0].sources, ["rhetoric-pick"]);
  assert.ok(few.steps[0].sources_skipped.some((x) => x.activity === "rhetoric-sort"));
});

test("高年級設定：課文練習混合修辭選擇與修辭分類，能力階梯 6-Ⅲ-6#a", () => {
  const plan = planSteps({ unit, cards: noCards, materials });
  const reading = plan.steps.find((s) => s.activity === "mix" && s.group === "reading");
  assert.deepEqual(reading.sources, ["rhetoric-pick", "rhetoric-sort"]);
  const list = generate("mix", { unit, cards: noCards, seed: "m", count: "all", sources: reading.sources, materials, ladders: plan.ladders });
  assert.ok(list.every((q) => q.ladder_ids.includes("6-Ⅲ-6#a")));
});

test("schema：修辭區塊與 rhetoric 教材；未知修辭不收", async () => {
  const v = await loadValidators();
  assert.ok(v.material(rhetoricMaterial()), JSON.stringify(v.material.errors));
  const bad = rhetoricMaterial([["句子。", ["metaphor-x"], "說明"]]);
  assert.equal(v.material(bad), false);
  const none = rhetoricMaterial([["句子。", [], "說明"]]);
  assert.equal(v.material(none), false);
});

// ---------- #58 ----------
const char = (c, z, confusables = []) => ({ format_version: 1, id: `c-${c.codePointAt(0).toString(16)}`, kind: "char", key: `${c}|${z}`, char: c, zhuyin: z, meaning: spoken(`${c} 的意思`), confusables });
const word = (w, z, meaning) => ({ format_version: 1, id: `w-${[...w].map((x) => x.codePointAt(0).toString(16)).join("")}`, kind: "word", key: `${w}|${z}`, word: w, zhuyin: z, meaning: spoken(meaning) });

test("混合練習：條件不足的來源略過、其他照出；全部都不行才丟錯（#58）", () => {
  // 只有一張生字卡、易混淆字沒填讀音：看注音選字出得了，聽音選字湊不出不同音的干擾字
  const cards = { ...noCards, chars: [char("擇", "ㄗㄜˊ", [{ char: "釋", why: "形近" }])] };
  const list = generate("mix", { unit, cards, seed: 1, count: "all", sources: ["listen-char", "char-pick"] });
  assert.ok(list.length > 0 && list.every((q) => q.mix_source === "char-pick"));
  assert.throws(() => generate("mix", { unit, cards: noCards, seed: 1, sources: ["listen-char", "char-pick"] }), /來源都湊不出題/);
});

test("測驗藍圖：語詞配對太重，同分類有別的來源就不用；只有它時才用（#58）", () => {
  const cards = { ...noCards, words: [word("抉擇", "ㄐㄩㄝˊ ㄗㄜˊ", "從幾個裡面選出一個"), word("衡量", "ㄏㄥˊ ㄌㄧㄤˊ", "想清楚、比一比"), word("犧牲", "ㄒㄧ ㄕㄥ", "放棄一部分")] };
  const plan = planSteps({ unit, cards });
  const wordBp = plan.steps.find((s) => s.activity === "quiz").blueprint.find((b) => b.group === "word");
  assert.ok(!wordBp.sources.includes("word-match"), wordBp.sources.join());
  const only = planSteps({ unit: { ...unit, activities: [{ activity: "word-match", label: "配對" }, { activity: "quiz", label: "測驗", blueprint: [{ group: "word", count: 1 }] }] }, cards });
  assert.deepEqual(only.steps.find((s) => s.activity === "quiz").blueprint[0].sources, ["word-match"]);
});

test("測驗藍圖：來源題庫都是 0（漏傳 materials）時丟錯，不默默少出（#58）", () => {
  const plan = planSteps({ unit, cards: noCards, materials });
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  assert.equal(generate("quiz", { unit, cards: noCards, seed: 1, blueprint: quiz.blueprint, materials }).length, 5);
  assert.throws(() => generate("quiz", { unit, cards: noCards, seed: 1, blueprint: quiz.blueprint }), /漏傳 materials/);
});
