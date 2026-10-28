// 字卡、語詞卡的新練習（udl-learning#481）：部首分類 radical-sort、配對題共用產生器（字↔語詞、語詞↔注音、語詞↔解釋）、
// generate 的 focus（只出某幾張卡的題）。範例字詞全是合成的常用字詞，不含課文原句。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, generateByKeys, planSteps, activityMeta, profiles, toItemShape, correctResponse } from "../activities/index.mjs";
import { loadValidators } from "../conformance/validate.mjs";
import { validateEvents } from "../conformance/validate-events.mjs";
import { createEventsFile, pushEvent, answeredFields } from "../events/index.mjs";
import { score } from "../question-types/index.mjs";

const spoken = (text) => ({ text, audio: null });
let n = 0;
const char = (c, z, radical, extra = {}) => ({ format_version: 1, id: `c-${++n}`, kind: "char", key: `${c}|${z}`, char: c, zhuyin: z, radical, meaning: spoken(`${c} 的意思`), ...extra });
const word = (w, z, extra = {}) => ({ format_version: 1, id: `w-${++n}`, kind: "word", key: `${w}|${z}`, word: w, zhuyin: z, meaning: spoken(`${w} 的意思`), ...extra });
const cardsOf = (chars = [], words = []) => ({ chars, words, patterns: [], skills: [] });
const unit = { id: "u-cards", subject: "chinese", grade: 5, ladder_ids: ["4-Ⅲ-1#a@5"] };

// 手部 4 個字、水部 3 個、木部 2 個、口部 1 個；「打」有兩張卡（不同讀音只算一次）。
const daqiu = word("打球", "ㄉㄚˇ ㄑㄧㄡˊ");
const paiqiu = word("拍球", "ㄆㄞ ㄑㄧㄡˊ");
const tuiche = word("推車", "ㄊㄨㄟ ㄔㄜ");
const lamen = word("拉門", "ㄌㄚ ㄇㄣˊ");
const heshui = word("河水", "ㄏㄜˊ ㄕㄨㄟˇ");
const haibian = word("海邊", "ㄏㄞˇ ㄅㄧㄢ");
const humian = word("湖面", "ㄏㄨˊ ㄇㄧㄢˋ");
const senlin = word("森林", "ㄙㄣ ㄌㄧㄣˊ");
const cunzhuang = word("村莊", "ㄘㄨㄣ ㄓㄨㄤ");
const chifan = word("吃飯", "ㄔ ㄈㄢˋ");
const da = char("打", "ㄉㄚˇ", "手", { words: [daqiu.id] });
const da2 = char("打", "ㄉㄚ", "手");
const pai = char("拍", "ㄆㄞ", "手", { words: [paiqiu.id] });
const tui = char("推", "ㄊㄨㄟ", "手", { words: [tuiche.id] });
const la = char("拉", "ㄌㄚ", "手", { words: [lamen.id] });
const he = char("河", "ㄏㄜˊ", "水", { words: [heshui.id] });
const hai = char("海", "ㄏㄞˇ", "水", { words: [haibian.id] });
const hu = char("湖", "ㄏㄨˊ", "水", { words: [humian.id] });
const lin = char("林", "ㄌㄧㄣˊ", "木", { words: [senlin.id] });
const cun = char("村", "ㄘㄨㄣ", "木", { words: [cunzhuang.id] });
const chi = char("吃", "ㄔ", "口", { words: [chifan.id] });
const chars = [da, da2, pai, tui, la, he, hai, hu, lin, cun, chi];
const words = [daqiu, paiqiu, tuiche, lamen, heshui, haibian, humian, senlin, cunzhuang, chifan];
const cards = cardsOf(chars, words);
const charOf = (text) => text.text;

test("部首分類：組別和種子無關、組與組不重複；同一個字只算一次，剩 4 個以內全放", async () => {
  const v = await loadValidators();
  const a = generate("radical-sort", { unit, cards, seed: "a", count: "all" });
  const b = generate("radical-sort", { unit, cards, seed: "b", count: "all" });
  assert.equal(a.length, 1, "手、水、木一組；口只有 1 個字不成框");
  assert.deepEqual(a.map((q) => q.practice_key).sort(), b.map((q) => q.practice_key).sort(), "題目身分不隨種子變");
  const [q] = a;
  assert.equal(q.type, "classify");
  assert.deepEqual(q.bins.map((x) => x.label.text), ["手部", "水部", "木部"]);
  assert.equal(q.objects.length, 9, "手部 4 個字全放，不留 1 個落單");
  assert.equal(new Set(q.objects.map((o) => charOf(o.text))).size, 9, "「打」兩張卡只出現一次");
  const binOf = Object.fromEntries(q.bins.map((x) => [x.id, x.label.text[0]]));
  for (const o of q.objects) assert.equal(binOf[o.bin], chars.find((c) => c.char === charOf(o.text)).radical, charOf(o.text));
  assert.equal(q.hints.length, 3);
  assert.equal(q.hints[1].text, "部首在字裡常換個樣子：手部常寫成「扌」，水部常寫成「氵」。");
  assert.equal(q.sound, false);
  assert.ok(v.item(toItemShape(q)), JSON.stringify(v.item.errors));
  assert.equal(score(q, correctResponse(q)).outcome, "correct");
  assert.deepEqual(q.ladder_ids, unit.ladder_ids, "沒給年級對照就用單元的");
});

test("部首分類：湊不出 2 個各有 2 個字的部首就略過並寫理由；字多時分成幾組", () => {
  const few = cardsOf([pai, tui, he, chi], words);
  assert.throws(() => generate("radical-sort", { unit, cards: few, seed: "a" }), /部首/);
  const plan = planSteps({ unit, cards: few, profile: profiles["zh-high"] });
  const mix = plan.steps.find((s) => s.label === "識字練習");
  assert.ok(mix.sources_skipped.some((x) => x.activity === "radical-sort" && x.reason.includes("radical")));
  // 每個部首 6 個字：第一組各取 3 個，第二組再各取 3 個（剩 4 個以內才全放）。
  const many = [...[..."抓抱抬投抖折"].map((c) => char(c, "ㄓㄨㄚ", "手")), ...[..."江池沙汁泳油"].map((c) => char(c, "ㄐㄧㄤ", "水"))];
  const sets = generate("radical-sort", { unit, cards: cardsOf(many, []), seed: "s", count: "all" });
  assert.equal(sets.length, 2);
  assert.ok(sets.every((q) => q.objects.length === 6));
  assert.equal(new Set(sets.flatMap((q) => q.cards)).size, 12, "兩組不重複");
});

test("配對題共用一套產生器：活動屬性帶 pair；三種配對左右兩邊照 pair 取欄位", () => {
  assert.deepEqual(activityMeta["word-match"].pair, ["word", "meaning"]);
  assert.deepEqual(activityMeta["word-zhuyin-match"].pair, ["word", "zhuyin"]);
  assert.deepEqual(activityMeta["char-word-match"].pair, ["char", "word"]);
  assert.equal(activityMeta["radical-sort"].pair, undefined);
  for (const a of ["word-match", "word-zhuyin-match", "char-word-match", "radical-sort"]) assert.equal(activityMeta[a].encounter, true, a);

  const meaning = generate("word-match", { unit, cards, seed: "m", count: 3 });
  for (const q of meaning) {
    for (const p of q.pairs) assert.equal(p.right.text, `${p.left.text} 的意思`);
    assert.equal(q.hide_zhuyin, undefined, "語詞↔解釋不必藏注音");
  }
  const zhuyin = generate("word-zhuyin-match", { unit, cards, seed: "z", count: 3 });
  for (const q of zhuyin) {
    for (const p of q.pairs) assert.equal(p.right.text, words.find((w) => w.word === p.left.text).zhuyin);
    assert.equal(q.hide_zhuyin, true, "語詞那一側不能帶注音");
    assert.equal(q.sound, true);
    assert.equal(q.read_aloud_scope, "stem", "考讀音：配對卡不唸");
  }
  const cw = generate("char-word-match", { unit, cards, seed: "c", count: 3 });
  for (const q of cw) {
    for (const p of q.pairs) {
      assert.equal([...p.left.text].length, 1);
      assert.ok(p.right.text.includes("○") && !p.right.text.includes(p.left.text), p.right.text);
      assert.ok(words.some((w) => w.word === p.right.text.replaceAll("○", p.left.text)), "填回去就是這課的語詞");
    }
  }
});

test("配對題不放兩個解：同音語詞不並列；字↔語詞挖空一樣或填得進別組的不並列", () => {
  const gongshi = word("公式", "ㄍㄨㄥ ㄕˋ");
  const gongshi2 = word("攻勢", "ㄍㄨㄥ ㄕˋ");
  const same = cardsOf([], [gongshi, gongshi2, senlin, haibian]);
  for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    for (const q of generate("word-zhuyin-match", { unit, cards: same, seed, count: 2 })) {
      const rights = q.pairs.map((p) => p.right.text);
      assert.equal(new Set(rights).size, rights.length, "注音不重複");
    }
  }
  // 打球、拍球挖空後都是「○球」：打和拍不能同題。
  for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    for (const q of generate("char-word-match", { unit, cards, seed, count: 3 })) {
      const lefts = q.pairs.map((p) => p.left.text);
      assert.ok(!(lefts.includes("打") && lefts.includes("拍")), lefts.join());
    }
  }
  assert.throws(() => generate("word-zhuyin-match", { unit, cards: cardsOf([], [gongshi, gongshi2]), seed: "a" }), /不同音/);
  assert.throws(() => generate("char-word-match", { unit, cards: cardsOf([da, pai], [daqiu, paiqiu]), seed: "a" }), /語詞/);
});

test("配對題的 practice_key：活動 id 分得開、卡片 id 排序；generateByKeys 重產同一組卡", () => {
  for (const a of ["word-match", "word-zhuyin-match", "char-word-match"]) {
    const list = generate(a, { unit, cards, seed: "k", count: 3 });
    for (const q of list) assert.equal(q.practice_key, `${a}|${[...q.cards].sort().join(",")}`);
    const keys = list.map((q) => q.practice_key);
    const shuffled = keys.map((k) => { const [x, ids] = k.split("|"); return `${x}|${ids.split(",").reverse().join(",")}`; });
    const r = generateByKeys(shuffled, { unit, cards, seed: "again" });
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.instances.map((q) => q.practice_key), [...new Set(keys)]);
    for (const q of r.instances) assert.equal(score(q, correctResponse(q)).outcome, "correct");
  }
  const rs = generate("radical-sort", { unit, cards, seed: "k", count: 1 });
  assert.deepEqual(generateByKeys(rs.map((q) => q.practice_key), { unit, cards, seed: "z" }).instances.map((q) => q.practice_key), rs.map((q) => q.practice_key));
});

test("focus：只出以指定卡為目標的題，干擾項照舊；配對題每題放一張指定的卡；對不到題回空陣列", () => {
  for (const a of ["char-pick", "char-trace", "radical-sort", "char-word-match"]) {
    const list = generate(a, { unit, cards, seed: "f", focus: [hai.id] });
    assert.ok(list.length > 0, a);
    for (const q of list) assert.ok(q.cards.includes(hai.id), a);
  }
  const pick = generate("char-pick", { unit, cards, seed: "f", focus: [hai.id] });
  assert.equal(pick.length, 1, "count 不給＝這張卡的每一種題各一題");
  assert.ok(pick[0].options.length >= 2, "干擾項照舊從同課取");
  assert.equal(generate("char-pick", { unit, cards, seed: "f", focus: [hai.id], count: 3 }).length, 3);
  const all = new Set(generate("char-pick", { unit, cards, seed: "f", count: "all" }).map((q) => q.practice_key));
  assert.ok(pick.every((q) => all.has(q.practice_key)), "practice_key 和一般出題同一套");
  const matched = generate("word-match", { unit, cards, seed: "f", focus: [senlin.id], count: 2 });
  assert.equal(matched.length, 2);
  assert.ok(matched.every((q) => q.cards.includes(senlin.id) && q.cards.length === 4));
  assert.deepEqual(generate("char-pick", { unit, cards, seed: "f", focus: ["c-gone"] }), []);
  assert.deepEqual(generate("word-zhuyin-match", { unit, cards, seed: "f", focus: [hai.id] }), [], "生字卡不在語詞配對裡");
  assert.deepEqual(generate("radical-sort", { unit, cards, seed: "f", focus: [chi.id] }), [], "口部只有 1 個字，不在任何一組");
  assert.throws(() => generate("mix", { unit, cards, seed: "f", sources: ["char-pick"], focus: [hai.id] }), /focus/);
  assert.throws(() => generate("quiz", { unit, cards, seed: "f", focus: [hai.id] }), /focus/);
  assert.throws(() => generate("char-pick", { unit, cards, seed: "f", focus: [] }), /focus/);
  assert.throws(() => generate("char-pick", { unit, cards, seed: "f", focus: hai.id }), /focus/);
  assert.throws(() => generate("char-pick", { unit, cards, seed: "f", focus: [hai.id], count: "all" }), /count/);
  assert.deepEqual(generate("char-pick", { unit, cards, seed: "f", focus: [hai.id] }), pick, "同種子結果相同");
});

test("年級設定：識字練習多部首分類、字↔語詞配對，語詞練習多語詞↔注音；三種都很重，不進測驗藍圖", () => {
  for (const id of ["zh-low", "zh-mid", "zh-high"]) {
    const p = profiles[id];
    const sources = (label) => p.steps.find((s) => s.label === label).sources;
    assert.ok(sources("識字練習").includes("char-word-match") && sources("識字練習").includes("radical-sort"), id);
    const wordMix = p.steps.find((s) => s.activity === "mix" && s.sources.includes("word-match")).sources;
    assert.ok(wordMix.includes("word-zhuyin-match"), id);
    for (const a of ["char-word-match", "radical-sort", "word-zhuyin-match"]) assert.ok(Object.keys(p.ladders).includes(a), `${id} ${a}`);
  }
  const plan = planSteps({ unit, cards, profile: profiles["zh-high"] });
  const char = plan.steps.find((s) => s.label === "識字練習");
  assert.ok(char.sources.includes("radical-sort") && char.sources.includes("char-word-match"));
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  for (const b of quiz.blueprint) for (const a of ["radical-sort", "char-word-match", "word-zhuyin-match"]) assert.ok(!b.sources.includes(a), `${b.group} ${a}`);
  assert.deepEqual(plan.ladders["radical-sort"], ["4-Ⅲ-2#a"]);
  const q = generate("radical-sort", { unit, cards, seed: "l", ladders: plan.ladders })[0];
  assert.deepEqual(q.ladder_ids, ["4-Ⅲ-2#a"]);
  const mixed = generate("mix", { unit, cards, seed: "m", count: "all", sources: char.sources, ladders: plan.ladders });
  assert.ok(mixed.some((x) => x.mix_source === "radical-sort" && x.type === "classify"));
  assert.ok(mixed.some((x) => x.mix_source === "char-word-match" && x.type === "match"));
});

test("作答事件：部首分類與語詞↔注音配對的 answered 帶 practice_key，符合 v1 schema", async () => {
  const file = createEventsFile({ producer: { shell: "test", shell_version: "0", granularity: "item" }, actor: { role: "student", student_code: "S03" }, context: { session_id: "s1", mode: "practice", pack: { id: "sample-cards", version: "0.1.0" } } });
  pushEvent(file, "session-started");
  for (const a of ["radical-sort", "word-zhuyin-match"]) {
    const [q] = generate(a, { unit, cards, seed: "e", count: 1 });
    const fields = answeredFields({ ...q, id: `q-${a}-1` }, score(q, correctResponse(q)), { attempt_no: 1, response_ms: 3000 });
    assert.equal(fields.practice_key, q.practice_key);
    pushEvent(file, "answered", { ...fields, item_id: `q-${a}-1` });
  }
  const r = await validateEvents(file);
  assert.deepEqual(r.errors, []);
  assert.ok(file.events.filter((e) => e.type === "answered").every((e) => e.practice_key));
});
