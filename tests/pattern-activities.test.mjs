// 句型：選連接詞（pattern-connective）、接句子（pattern-join）（#90，udl-learning#712）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, planSteps, toItemShape, correctResponse, generateByKeys } from "../activities/index.mjs";
import { loadValidators, checkCard } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";

const sp = (text) => ({ text, audio: null });
const ex = (chunks, sentence, connectives) => ({ chunks: chunks.map(sp), sentence: sp(sentence), ...(connectives ? { connectives } : {}) });
const pattern = (id, title, tags, examples) => ({ format_version: 1, id, kind: "pattern", key: title, title: sp(title), tags, examples });
const YIN = pattern("pt-yin", "因為……所以……", ["因果複句"], [ex(["因為", "下大雨", "所以", "比賽延期了"], "因為下大雨，所以比賽延期了。", [0, 2])]);
const SUI = pattern("pt-sui", "雖然……卻……", ["轉折複句"], [ex(["弟弟", "雖然", "個子小", "卻", "跑得很快"], "弟弟雖然個子小，卻跑得很快。", [1, 3])]);
const SUI2 = pattern("pt-sui2", "雖然……但……", ["轉折複句"], [ex(["雖然", "很累", "但", "他還是寫完了"], "雖然很累，但他還是寫完了。", [0, 2])]);
const JI = pattern("pt-ji", "既然……就……", ["因果複句"], [ex(["既然", "答應了", "就", "要做到"], "既然答應了，就要做到。", [0, 2])]);
const RU = pattern("pt-ru", "如果……", ["假設複句"], [ex(["如果", "明天放晴", "我們去爬山"], "如果明天放晴，我們去爬山。", [0])]);
const WEI = pattern("pt-wei", "為了……", ["目的複句"], [ex(["為了", "趕上公車", "哥哥跑得滿頭大汗"], "為了趕上公車，哥哥跑得滿頭大汗。", [0])]);
const KAI = pattern("pt-kai", "……開滿了……", [], [ex(["大樹下", "開滿了", "小花"], "大樹下開滿了小花。")]);
const unit = { id: "u-p", subject: "chinese", grade: 4, ladder_ids: ["4-Ⅱ-1#c@4"] };
const cardsOf = (...patterns) => ({ chars: [], words: [], patterns, skills: [] });
const optionText = (q, id) => q.options.find((o) => o.id === id).text.text;

test("選連接詞：連接詞挖成＿＿，正解是一組連接詞；干擾項只用別張、連接詞不共用、複句類型不同的卡", async () => {
  const v = await loadValidators();
  const cards = cardsOf(YIN, SUI, SUI2, JI, RU, WEI, KAI);
  const list = generate("pattern-connective", { unit, cards, seed: "c", count: 8 });
  assert.ok(list.length === 8);
  for (const q of list) {
    assert.ok(v.item(toItemShape(q)), JSON.stringify(v.item.errors));
    assert.equal(score(q, correctResponse(q)).outcome, "correct");
    assert.match(q.practice_key, /^pattern-connective\|pt-[a-z0-9]+\|0$/);
    const answer = optionText(q, q.answer);
    const others = q.options.filter((o) => o.id !== q.answer).map((o) => o.text.text);
    assert.ok(others.length >= 1);
    if (q.cards[0] === "pt-yin") {
      assert.equal(q.stem.text.text, "選出可以填進空格的連接詞：＿＿下大雨，＿＿比賽延期了。");
      assert.equal(answer, "因為……所以……");
      assert.ok(!others.includes("既然……就……"), "同是因果複句，可能也說得通");
    }
    if (q.cards[0] === "pt-sui") {
      assert.equal(q.stem.text.text, "選出可以填進空格的連接詞：弟弟＿＿個子小，＿＿跑得很快。");
      assert.ok(!others.includes("雖然……但……"), "共用「雖然」，也說得通");
    }
    if (q.cards[0] === "pt-ru") assert.ok(others.every((o) => o.split("……").length === 2), "一個連接詞只和一個連接詞比");
    assert.notEqual(q.cards[0], "pt-kai", "沒標 connectives 的例句不出題");
  }
  assert.deepEqual(generate("pattern-connective", { unit, cards, seed: "c", count: 8 }), list, "同種子結果相同");
});

test("接句子：照原文切在最後一個連接詞前；只有開頭一個連接詞時切在第二個詞塊後", async () => {
  const v = await loadValidators();
  const cards = cardsOf(YIN, SUI, RU, WEI);
  const list = generate("pattern-join", { unit, cards, seed: "j", count: 8 });
  const seen = {};
  for (const q of list) {
    assert.ok(v.item(toItemShape(q)), JSON.stringify(v.item.errors));
    assert.equal(score(q, correctResponse(q)).outcome, "correct");
    seen[q.cards[0]] = [q.stem.text.text, optionText(q, q.answer), q.options.map((o) => o.text.text)];
  }
  assert.deepEqual(seen["pt-yin"].slice(0, 2), ["接句子：「因為下大雨，」後面接哪一句最通順？", "所以比賽延期了。"]);
  assert.deepEqual(seen["pt-sui"].slice(0, 2), ["接句子：「弟弟雖然個子小，」後面接哪一句最通順？", "卻跑得很快。"]);
  assert.deepEqual(seen["pt-ru"].slice(0, 2), ["接句子：「如果明天放晴，」後面接哪一句最通順？", "我們去爬山。"]);
  for (const [, , opts] of Object.values(seen)) assert.equal(new Set(opts).size, opts.length, "選項不重複");
});

test("條件不足：只有一張標了連接詞的卡、或其他卡都同一種複句時略過並說明", () => {
  const plan = planSteps({ unit: { ...unit, activities: [{ activity: "pattern-connective", label: "選" }, { activity: "pattern-join", label: "接" }] }, cards: cardsOf(YIN, JI, KAI), materials: [] });
  assert.deepEqual(plan.steps.map((s) => s.activity), []);
  assert.ok(plan.skipped.some((s) => s.activity === "pattern-connective" && /connectives/.test(s.reason)));
  assert.ok(plan.skipped.some((s) => s.activity === "pattern-join" && /connectives/.test(s.reason)));
  assert.throws(() => generate("pattern-join", { unit, cards: cardsOf(YIN), seed: "x" }), /connectives/);
});

test("年級設定：中高年級的語詞練習混合來源有選連接詞、接句子；沒有句型卡時照常略過", () => {
  const cards = { chars: [], words: [{ id: "w-a", kind: "word", word: "公園", zhuyin: "ㄍㄨㄥ ㄩㄢˊ", meaning: sp("大家休息玩耍的地方。"), example: sp("我們去公園玩。") }, { id: "w-b", kind: "word", word: "大樹", zhuyin: "ㄉㄚˋ ㄕㄨˋ", meaning: sp("很高大的樹。"), example: sp("大樹下很涼快。") }], patterns: [YIN, SUI], skills: [] };
  const plan = planSteps({ unit, cards, materials: [] });
  const mix = plan.steps.find((s) => s.activity === "mix" && s.sources?.includes("pattern-join"));
  assert.ok(mix && mix.sources.includes("pattern-connective"), JSON.stringify(plan.steps.map((s) => [s.activity, s.sources])));
  const none = planSteps({ unit, cards: { ...cards, patterns: [] }, materials: [] });
  const mix2 = none.steps.find((s) => s.activity === "mix" && s.group === "word");
  assert.ok(!mix2 || !mix2.sources.includes("pattern-join"));
});

test("錯題重練：依 practice_key 重產同一題", () => {
  const cards = cardsOf(YIN, SUI, RU, WEI);
  const keys = [...new Set(["pattern-connective", "pattern-join"].flatMap((a) => generate(a, { unit, cards, seed: "k", count: 4 }).map((q) => q.practice_key)))];
  const r = generateByKeys(keys, { unit, cards, seed: "k2" });
  assert.deepEqual(r.instances.map((q) => q.practice_key), keys);
  assert.deepEqual(r.missing, []);
});

test("驗證器：connectives 超出詞塊範圍、詞塊沒有依序出現在 sentence 裡都報錯", () => {
  assert.deepEqual(checkCard(YIN), []);
  const bad = structuredClone(YIN);
  bad.examples[0].connectives = [0, 4];
  assert.ok(checkCard(bad).some((e) => /超出詞塊範圍/.test(e)));
  const order = structuredClone(YIN);
  order.examples[0].sentence = sp("所以比賽延期了，因為下大雨。");
  assert.ok(checkCard(order).some((e) => /沒有依序出現/.test(e)));
});

test("follow-up：接句子不用共用連接詞的卡當干擾項；最後一層提示不唸出句型名稱", () => {
  const QUE = pattern("pt-que", "……卻……", ["轉折複句2"], [ex(["他很累", "卻", "還是笑著"], "他很累，卻還是笑著。", [1])]);
  const cards = cardsOf({ ...SUI, explain: sp("先說一件事，再說出和想的不一樣的結果。") }, QUE, YIN, RU);
  const joins = generate("pattern-join", { unit, cards, seed: "f", count: 12 });
  assert.ok(joins.some((q) => q.cards[0] === "pt-sui") && joins.some((q) => q.cards[0] === "pt-que"), "兩張都要真的出到題");
  for (const q of joins) {
    const opts = q.options.map((o) => o.text.text);
    if (q.cards[0] === "pt-sui") assert.ok(!opts.includes("卻還是笑著。"), "共用「卻」的後半句也接得上，不能當干擾項");
    if (q.cards[0] === "pt-que") assert.ok(!opts.includes("卻跑得很快。"));
  }
  for (const q of generate("pattern-connective", { unit, cards, seed: "f", count: 12 })) {
    const last = q.hints.at(-1).text;
    assert.ok(!last.includes(optionText(q, q.answer)), `${q.cards[0]}：${last}`);
  }
  const [s] = generate("pattern-connective", { unit, cards, seed: "f", count: 12 }).filter((q) => q.cards[0] === "pt-sui");
  assert.equal(s.hints.at(-1).text, "這個句型：先說一件事，再說出和想的不一樣的結果。");
});

test("follow-up：整句和詞塊對不上時，選連接詞改用詞塊接起來挖空，接句子略過那句", () => {
  const odd = pattern("pt-odd", "因為……所以……", ["因果複句"], [ex(["因為", "下大雨", "所以", "比賽延期了"], "比賽延期了，因為下大雨。", [0, 2])]);
  const cards = cardsOf(odd, SUI, RU, WEI);
  const q = generate("pattern-connective", { unit, cards, seed: "o", count: 4 }).find((x) => x.cards[0] === "pt-odd");
  assert.equal(q.stem.text.text, "選出可以填進空格的連接詞：＿＿下大雨＿＿比賽延期了");
  const joins = generate("pattern-join", { unit, cards, seed: "o", count: 6 });
  assert.ok(joins.length && joins.some((x) => x.cards[0] === "pt-sui"), "其他句子照常出題（對照組）");
  assert.ok(joins.every((x) => x.cards[0] !== "pt-odd"));
});

test("follow-up：一個連接詞的句型只和一個連接詞的組比；沒有同個數的組就不出題", () => {
  const cards = cardsOf(RU, YIN, SUI);
  assert.ok(generate("pattern-connective", { unit, cards, seed: "s", count: 6 }).every((q) => q.cards[0] !== "pt-ru"));
  const withWei = cardsOf(RU, WEI, YIN);
  const ru = generate("pattern-connective", { unit, cards: withWei, seed: "s", count: 6 }).filter((q) => q.cards[0] === "pt-ru");
  assert.ok(ru.length);
  for (const q of ru) assert.deepEqual(q.options.map((o) => o.text.text).sort(), ["如果……", "為了……"]);
});

test("follow-up 2：連接詞個數照空格數算（「一邊……一邊……」是兩格）；explain 說出連接詞時不當提示", () => {
  const BIAN = pattern("pt-bian", "一邊……一邊……", ["並列複句"], [ex(["爺爺", "一邊", "澆花", "一邊", "哼歌"], "爺爺一邊澆花，一邊哼歌。", [1, 3])]);
  const YIN2 = { ...YIN, explain: sp("用「因為」說原因，用「所以」說結果。") };
  const cards = cardsOf(BIAN, YIN2, RU, WEI);
  const qs = generate("pattern-connective", { unit, cards, seed: "b", count: 8 });
  const bian = qs.filter((q) => q.cards[0] === "pt-bian");
  assert.ok(bian.length);
  for (const q of bian) assert.deepEqual(q.options.map((o) => o.text.text).sort(), ["一邊……一邊……", "因為……所以……"], "兩格只和兩格比，不放「如果……」");
  const yin = qs.filter((q) => q.cards[0] === "pt-yin");
  assert.ok(yin.length);
  for (const q of yin) assert.equal(q.hints.at(-1).text, "試著把每個選項放回句子裡讀讀看。");
});
