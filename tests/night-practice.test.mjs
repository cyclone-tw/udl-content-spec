// 進修部練習（#78）：認一認（聲調陷阱）、找一找（形近字）、手寫題 handwrite 與描一描／寫一寫、practice_key 與重產、
// 讀音標記（#66）、年級設定。範例字詞全是原創或常用語詞，不含課文原句。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, generateByKeys, generatingActivities, planSteps, resolveBindings, activityMeta, profiles, misconceptions, toItemShape, correctResponse } from "../activities/index.mjs";
import { loadValidators, checkSoundItem, checkHandwriteItem } from "../conformance/validate.mjs";
import { validateEvents } from "../conformance/validate-events.mjs";
import { createEventsFile, pushEvent, answeredFields } from "../events/index.mjs";
import { score, types } from "../question-types/index.mjs";
import { normalizeZhuyin } from "../audio/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(here, "..", "examples", "cards-demo");

const spoken = (text) => ({ text, audio: null });
let n = 0;
const char = (c, z, extra = {}) => ({ format_version: 1, id: `c-${++n}`, kind: "char", key: `${c}|${z}`, char: c, zhuyin: z, meaning: spoken(`${c} 的意思`), ladder_ids: ["4-Ⅱ-1#a@3"], ...extra });
const word = (w, z, extra = {}) => ({ format_version: 1, id: `w-${++n}`, kind: "word", key: `${w}|${z}`, word: w, zhuyin: z, meaning: spoken(`${w} 的意思`), ladder_ids: ["4-Ⅱ-1#a@3"], ...extra });
const cardsOf = (chars = [], words = []) => ({ chars, words, patterns: [], skills: [] });
const unit = { id: "u-night", subject: "chinese", grade: 3, ladder_ids: ["4-Ⅱ-1#a@3"] };
const text = (o) => o.text.text;
const answerText = (q) => text(q.options.find((o) => o.id === q.answer));
const ZHUYIN = /[㄀-ㄯ]/u;

async function loadDemo() {
  const rd = async (p) => JSON.parse(await readFile(path.join(DEMO, p), "utf8"));
  const u = await rd("units/u-rain-park.json");
  const lib = new Map();
  for (const id of (await rd("pack.json")).cards) lib.set(id, await rd(`cards/${id}.json`));
  const { cards } = resolveBindings(u, (r) => lib.get(r));
  const materials = await Promise.all(u.materials.map((id) => rd(`materials/${id}.json`)));
  return { unit: u, cards, materials };
}

// ---------- 認一認 tone-pick ----------
// 好吃（ㄏㄠˇ ㄔ）另一張卡讀 ㄏㄠˋ ㄔ（喜歡吃）：陷阱不能是它；桌子的「子」是輕聲，不能改。
const haochi = word("好吃", "ㄏㄠˇ ㄔ");
const haochi2 = word("好吃", "ㄏㄠˋ ㄔ");
const zhuozi = word("桌子", "ㄓㄨㄛ ˙ㄗ");
const huayuan = word("花園", "ㄏㄨㄚ ㄩㄢˊ");
const shu = word("樹", "ㄕㄨˋ");

test("認一認：選項是正解＋聲調陷阱＋其他語詞注音；陷阱只改一個非輕聲字的聲調，不等於同一語詞的其他讀音", () => {
  const cards = cardsOf([], [haochi, haochi2, zhuozi, huayuan, shu]);
  for (const seed of ["a", "b", "c", "d", "e", "f"]) {
    for (const q of generate("tone-pick", { unit, cards, seed, count: 10 })) {
      const w = cards.words.find((x) => x.id === q.cards[0]);
      const answer = normalizeZhuyin(w.zhuyin);
      assert.equal(answerText(q), answer);
      const texts = q.options.map(text);
      assert.equal(new Set(texts).size, texts.length, "選項不重複");
      assert.ok(texts.length >= 2 && texts.length <= 3);
      const traps = q.options.filter((o) => o.misconception === "tone-mixup");
      assert.ok(traps.length >= 1, "至少一個聲調陷阱");
      for (const t of traps) {
        const a = answer.split(" ");
        const b = text(t).split(" ");
        assert.equal(b.length, a.length);
        const diff = a.map((s, i) => (s === b[i] ? null : i)).filter((i) => i !== null);
        assert.equal(diff.length, 1, `${text(t)} 只能差一個字`);
        assert.ok(!a[diff[0]].startsWith("˙"), "輕聲字不改");
        assert.equal(a[diff[0]].replace(/[ˊˇˋ]$/u, ""), b[diff[0]].replace(/[ˊˇˋ]$/u, ""), "只改聲調");
        assert.ok(t.feedback?.text);
      }
      if (w.word === "好吃") assert.ok(!texts.includes(normalizeZhuyin(w.id === haochi.id ? haochi2.zhuyin : haochi.zhuyin)), "不可等於同一語詞的另一個讀音");
      assert.ok(!ZHUYIN.test(q.stem.text.text), "題幹不顯示注音");
      assert.ok(!q.stem.say_text.text.includes(w.word), "報讀不唸目標語詞");
      assert.equal(q.sound, true);
      assert.equal(q.read_aloud_scope, "stem");
      assert.equal(q.hints.length, 3);
      assert.ok(q.feedback.correct.text && q.feedback.retry.text);
    }
  }
});

test("認一認：沒有別的語詞時放第二個聲調陷阱；同字數的語詞優先當干擾項", () => {
  const solo = generate("tone-pick", { unit, cards: cardsOf([], [huayuan]), seed: "s", count: 1 })[0];
  assert.equal(solo.options.length, 3);
  assert.equal(solo.options.filter((o) => o.misconception === "tone-mixup").length, 2);
  const mixed = generate("tone-pick", { unit, cards: cardsOf([], [huayuan, shu, zhuozi]), seed: "s", count: 6 });
  for (const q of mixed.filter((x) => x.cards[0] === huayuan.id)) {
    const other = q.options.find((o) => o.id !== q.answer && !o.misconception);
    assert.equal(text(other), normalizeZhuyin(zhuozi.zhuyin), "兩個字的語詞先選兩個字的");
  }
});

test("認一認：條件不足的理由寫到回哪裡補", () => {
  const plan = planSteps({ unit: { ...unit, activities: [{ activity: "tone-pick", label: "認一認" }] }, cards: cardsOf([], [word("花", "ㄏㄨㄚ ㄩㄢˊ")]) });
  assert.match(plan.skipped[0].reason, /回語詞卡/);
  assert.throws(() => generate("tone-pick", { unit, cards: cardsOf(), seed: "x" }), /沒有綁語詞卡/);
});

// ---------- 找一找 char-lookalike ----------
const qing = char("晴", "ㄑㄧㄥˊ", { confusables: [{ char: "請", why: "形近" }, { char: "清", why: "形近" }, { char: "情", why: "音近" }], words: [] });
const qingtian = word("晴天", "ㄑㄧㄥˊ ㄊㄧㄢ", { example: spoken("今天是晴天，我們去河邊看晴朗的天空。") });
qing.words = [qingtian.id];
const wang = char("網", "ㄨㄤˇ", { confusables: [{ char: "綱", why: "形近" }] });
const yuwang = word("魚網", "ㄩˊ ㄨㄤˇ");

test("找一找：句子裡的目標字都換成○，不給注音；選項是目標字＋2 個形近字", () => {
  const cards = cardsOf([qing, wang], [qingtian, yuwang]);
  const list = generate("char-lookalike", { unit, cards, seed: "s", count: 3 });
  assert.equal(list.length, 3);
  for (const q of list) {
    assert.deepEqual(q.cards, [qing.id, qingtian.id], "只有晴湊得出 2 個形近字");
    assert.ok(q.stem.text.text.includes("○"));
    assert.ok(!q.stem.text.text.includes("晴"), "句子裡的目標字全部挖掉");
    assert.ok(!ZHUYIN.test(q.stem.text.text));
    assert.ok(!q.stem.say_text.text.includes("晴"));
    assert.equal(answerText(q), "晴");
    assert.deepEqual(q.options.filter((o) => o.id !== q.answer).map(text).sort(), ["清", "請"]);
    for (const o of q.options.filter((x) => x.id !== q.answer)) assert.equal(o.misconception, "form-alike");
    assert.equal(q.sound, true);
    assert.equal(q.read_aloud_scope, "stem");
  }
});

test("找一找：pack pools/ 的形近字池可以補不足的形近字；沒有例句就用語詞", () => {
  const cards = cardsOf([wang], [yuwang]);
  assert.throws(() => generate("char-lookalike", { unit, cards, seed: "s" }), /回生字卡 confusables/);
  const pools = new Map([["p-wang", { id: "p-wang", kind: "形近字", entries: [{ text: spoken("網") }, { text: spoken("綱") }, { text: spoken("綢") }] }]]);
  const plan = planSteps({ unit: { ...unit, activities: [{ activity: "char-lookalike", label: "找一找" }] }, cards, pools });
  assert.equal(plan.steps.length, 1, "planSteps 也認得形近字池");
  const [q] = generate("char-lookalike", { unit, cards, seed: "s", count: 1, pools });
  assert.equal(q.stem.text.text, "選出正確的字，放進○：「魚○」");
  assert.deepEqual(q.options.map(text).sort(), ["綢", "綱", "網"]);
});

// ---------- 手寫題 handwrite ----------
const hw = (extra = {}) => ({ type: "handwrite", kind: "fixed", id: "i-hw", mode: "write", target: "星星", ...extra });
const ch = (char, extra = {}) => ({ char, completed: true, mistakes: 0, helped: false, ...extra });

test("handwrite：每字完成、沒偷看、錯筆 ≤ max_mistakes 才算對；多字題給 partial", () => {
  assert.equal(types.handwrite.version, 1);
  let r = score(hw(), { chars: [ch("星"), ch("星", { mistakes: 3 })] });
  assert.equal(r.outcome, "correct");
  assert.equal(r.score, 1);
  assert.equal(r.detail.max_mistakes, 3, "預設 3");
  r = score(hw(), { chars: [ch("星"), ch("星", { mistakes: 4 })] });
  assert.equal(r.outcome, "partial");
  assert.equal(r.score, 0.5);
  assert.deepEqual(r.detail.chars.map((c) => c.correct), [true, false]);
  r = score(hw(), { chars: [ch("星", { helped: true }), ch("星", { completed: false })] });
  assert.equal(r.outcome, "incorrect");
  assert.equal(score(hw({ max_mistakes: 0 }), { chars: [ch("星", { mistakes: 1 }), ch("星")] }).outcome, "partial");
  assert.equal(score(hw({ mode: "trace", target: "園" }), { chars: [ch("園")] }).outcome, "correct");
});

test("handwrite：作答壞掉回 invalid，題目壞掉丟錯", () => {
  const reason = (resp) => score(hw(), resp).detail.reason;
  assert.equal(reason(undefined), "missing-field");
  assert.equal(reason({ chars: [ch("星")] }), "wrong-count");
  assert.equal(reason({ chars: [ch("星"), ch("晴")] }), "char-mismatch");
  assert.equal(reason({ chars: [ch("星"), { char: "星", completed: true, mistakes: -1, helped: false }] }), "bad-char");
  assert.equal(reason({ chars: [ch("星"), { char: "星", completed: "yes", mistakes: 0, helped: false }] }), "bad-char");
  assert.throws(() => score(hw({ target: "" }), { chars: [] }), /target/);
  assert.throws(() => score(hw({ target: "AB" }), { chars: [] }), /target/);
  assert.throws(() => score(hw({ mode: "copy" }), { chars: [] }), /mode/);
  assert.throws(() => score(hw({ max_mistakes: -1 }), { chars: [ch("星"), ch("星")] }), /max_mistakes/);
});

test("描一描、寫一寫：count all 每張生字卡／每個語詞＋生字一題；語詞裡同一個字全部挖空", async () => {
  const v = await loadValidators();
  const xing = char("星", "ㄒㄧㄥ");
  const xingxing = word("星星", "ㄒㄧㄥ ㄒㄧㄥ");
  const mingxing = word("明星", "ㄇㄧㄥˊ ㄒㄧㄥ");
  const cards = cardsOf([xing, qing], [xingxing, mingxing, qingtian]);
  const trace = generate("char-trace", { unit, cards, seed: "s", count: "all" });
  assert.equal(trace.length, 2);
  const write = generate("char-write", { unit, cards, seed: "s", count: "all" });
  assert.equal(write.length, 3);
  const twice = write.find((q) => q.cards[0] === xingxing.id);
  assert.equal(twice.target, "星星");
  assert.deepEqual(twice.context.positions, [0, 1]);
  assert.ok(!twice.stem.text.text.includes("星"), "寫一寫的題幹不寫出答案字");
  for (const q of [...trace, ...write]) {
    assert.equal(q.type, "handwrite");
    assert.ok(v.item(toItemShape(q)), JSON.stringify(v.item.errors));
    assert.deepEqual(checkHandwriteItem(q), []);
    assert.equal(score(q, correctResponse(q)).outcome, "correct");
    assert.equal(q.sound, false);
    assert.equal(q.max_mistakes, 3);
  }
  assert.ok(trace.every((q) => q.mode === "trace") && write.every((q) => q.mode === "write"));
});

test("checkHandwriteItem：positions 要對到 target、注音音節數要對", () => {
  assert.deepEqual(checkHandwriteItem(hw({ context: { word: "星星", zhuyin: "ㄒㄧㄥ ㄒㄧㄥ", positions: [0, 1] } })), []);
  assert.match(checkHandwriteItem(hw({ context: { positions: [0, 1] } }))[0], /context.word/);
  assert.match(checkHandwriteItem(hw({ context: { word: "明星", positions: [0, 1] } }))[0], /不是 target/);
  assert.match(checkHandwriteItem(hw({ context: { word: "星星", positions: [0] } }))[0], /一樣多/);
  assert.match(checkHandwriteItem(hw({ context: { word: "星星", positions: [0, 5] } }))[0], /超出/);
  assert.match(checkHandwriteItem(hw({ context: { word: "星星", zhuyin: "ㄒㄧㄥ" } }))[0], /音節/);
});

// ---------- 活動屬性、年級設定、測驗 ----------
test("activityMeta：讀音題與不進遭遇的活動", () => {
  for (const a of ["char-pick", "listen-char", "listen-word", "tone-pick", "char-lookalike"]) assert.equal(activityMeta[a].sound, true, a);
  for (const a of ["word-match", "word-cloze", "word-meaning", "para-gist", "char-trace", "char-write"]) assert.equal(activityMeta[a].sound, false, a);
  assert.equal(activityMeta["char-trace"].encounter, false);
  assert.equal(activityMeta["char-write"].encounter, false);
  assert.equal(activityMeta["tone-pick"].encounter, true);
  assert.equal(activityMeta["tone-pick"].group, "char");
  assert.ok(misconceptions["tone-mixup"].label);
});

test("年級設定：關卡順序固定（寫字練習在語詞練習後，udl-learning#555）；識字練習加認一認、找一找；低年級不放修辭", () => {
  for (const id of ["zh-low", "zh-mid", "zh-high"]) {
    const steps = profiles[id].steps;
    const at = (label) => steps.findIndex((s) => s.label === label);
    const order = ["讀課文", "心智圖", "生字卡", "語詞卡", "識字練習", "語詞練習", "寫字練習"];
    assert.deepEqual(order.map(at), order.map((_, i) => i), id);
    assert.ok(at("課文練習") > at("寫字練習") && steps.at(-1).activity === "quiz", id);
    assert.deepEqual(steps[at("寫字練習")].sources, ["char-trace", "char-write"]);
    for (const a of ["tone-pick", "char-lookalike"]) assert.ok(steps[at("識字練習")].sources.includes(a), `${id} ${a}`);
    for (const a of ["listen-word", "word-cloze"]) assert.ok(steps[at("語詞練習")].sources.includes(a), `${id} ${a}`);
    assert.equal(profiles[id].ladder_status, "draft");
  }
  const low = profiles["zh-low"];
  assert.deepEqual(low.steps.map((s) => s.label), ["讀課文", "心智圖", "生字卡", "語詞卡", "識字練習", "語詞練習", "寫字練習", "課文練習", "小測驗"]);
  assert.deepEqual(low.steps.find((s) => s.label === "課文練習").sources, ["para-gist", "para-order", "mindmap-pick", "reading-items"]);
  assert.deepEqual(low.steps.find((s) => s.activity === "quiz").blueprint, [{ group: "char", count: 2 }, { group: "word", count: 2 }, { group: "reading", count: 1 }]);
});

test("測驗藍圖不抽手寫題；直接傳手寫活動當藍圖來源會丟錯", async () => {
  const { unit: u, cards, materials } = await loadDemo();
  const plan = planSteps({ unit: u, cards, materials, profile: profiles["zh-high"] });
  const quiz = plan.steps.find((s) => s.activity === "quiz");
  for (const b of quiz.blueprint) for (const s of b.sources) assert.equal(activityMeta[s].encounter, true, s);
  const list = generate("quiz", { unit: u, cards, seed: "q", blueprint: quiz.blueprint, materials, ladders: plan.ladders });
  assert.ok(list.every((q) => q.type !== "handwrite"));
  assert.throws(() => generate("quiz", { unit: u, cards, seed: "q", blueprint: [{ group: "char", count: 1, sources: ["char-trace"] }] }), /可以進測驗/);
});

// ---------- practice_key 與重產 ----------
test("practice_key：不隨種子變；混合練習與測驗的題用來源活動的 key", async () => {
  const { unit: u, cards, materials } = await loadDemo();
  const keys = (seed) => generate("tone-pick", { unit: u, cards, seed, count: "all" }).map((q) => q.practice_key).sort();
  assert.deepEqual(keys("a"), keys("b"));
  assert.deepEqual(keys("a"), cards.words.map((w) => `tone-pick|${w.id}`).sort());
  const mix = generate("mix", { unit: u, cards, seed: "m", count: "all", sources: ["char-trace", "char-write"] });
  assert.ok(mix.every((q) => q.practice_key.startsWith(`${q.mix_source}|`)));
  assert.ok(mix.some((q) => q.practice_key === "char-write|w-gongyuan,c-yuan2"));
  const plan = planSteps({ unit: u, cards, materials, profile: profiles["zh-high"] });
  const quiz = generate("quiz", { unit: u, cards, seed: "q", blueprint: plan.steps.find((s) => s.activity === "quiz").blueprint, materials });
  assert.ok(quiz.every((q) => q.practice_key.startsWith(`${q.quiz_source}|`)));
  const match = generate("word-match", { unit: u, cards, seed: "m", count: 3 });
  for (const q of match) assert.equal(q.practice_key, `word-match|${[...q.cards].sort().join(",")}`);
});

test("generateByKeys：每個會生題的練習活動都能依 key 重產同一題，順序照清單；出不來的寫進 missing", async () => {
  const v = await loadValidators();
  const { unit: u, cards, materials } = await loadDemo();
  const skip = new Set(["mix", "quiz", "skill-practice", "reading-items", "para-gist", "para-order", "mindmap-pick", "mindmap-order", "rhetoric-pick", "rhetoric-sort", "radical-sort"]);
  const wanted = [];
  for (const a of generatingActivities.filter((x) => !skip.has(x))) wanted.push(...generate(a, { unit: u, cards, seed: "first", count: 2, materials }).map((q) => q.practice_key));
  const keys = [...new Set(wanted)].reverse();
  const r = generateByKeys([...keys, keys[0], "char-pick|c-gone", "quiz|x", "nope|x"], { unit: u, cards, seed: "again", materials });
  assert.deepEqual(r.instances.map((q) => q.practice_key), keys);
  assert.deepEqual(r.missing.map((m) => m.key), ["char-pick|c-gone", "quiz|x", "nope|x"]);
  for (const q of r.instances) {
    assert.ok(q.generator ? true : v.item(toItemShape(q)), `${q.practice_key}: ${JSON.stringify(v.item.errors)}`);
    assert.equal(score(q, correctResponse(q)).outcome, "correct", q.practice_key);
  }
  assert.deepEqual(generateByKeys(keys, { unit: u, cards, seed: "again", materials }).instances, r.instances, "同種子結果相同");
  assert.throws(() => generateByKeys(keys, { unit: u, cards }), /seed/);
});

test("answered 事件可帶 practice_key（選填），仍符合 v1 schema", async () => {
  const { unit: u, cards } = await loadDemo();
  const [q] = generate("tone-pick", { unit: u, cards, seed: "e", count: 1 });
  const file = createEventsFile({ producer: { shell: "test", shell_version: "0", granularity: "item" }, actor: { role: "student", student_code: "S03" }, context: { session_id: "s1", mode: "practice", pack: { id: "sample-cards", version: "0.1.0" } } });
  pushEvent(file, "session-started");
  const fields = answeredFields({ ...q, id: "q-tone-1" }, score(q, correctResponse(q)), { attempt_no: 1, response_ms: 1200 });
  assert.equal(fields.practice_key, q.practice_key);
  assert.equal(fields.generated, undefined, "活動生的題不是產生器實例，不帶 generated");
  pushEvent(file, "answered", { ...fields, item_id: "q-tone-1" });
  const r = await validateEvents(file);
  assert.deepEqual(r.errors, []);
});

// ---------- 讀音標記（#66） ----------
test("checkSoundItem：sound 的題 read_aloud_scope 不能是 all；沒標但像讀音題要提醒", () => {
  const base = { type: "choice", kind: "fixed", stem: { text: spoken("「花園」怎麼唸？") }, options: [{ id: "a", text: spoken("ㄏㄨㄚ ㄩㄢˊ") }, { id: "b", text: spoken("ㄏㄨㄚ ㄩㄢˇ") }], answer: "a" };
  assert.match(checkSoundItem({ ...base, sound: true }).errors[0], /省略就是 all/);
  assert.match(checkSoundItem({ ...base, sound: true, read_aloud_scope: "all" }).errors[0], /不能是 all/);
  assert.deepEqual(checkSoundItem({ ...base, sound: true, read_aloud_scope: "stem" }), { errors: [], warnings: [] });
  assert.match(checkSoundItem({ ...base, read_aloud_scope: "stem" }).warnings[0], /選項有注音/);
  assert.match(checkSoundItem({ ...base, sound: true, read_aloud_scope: "stem", stem: { text: spoken("這個語詞怎麼唸？") } }).warnings[0], /「」/);
  assert.deepEqual(checkSoundItem({ ...base, read_aloud_scope: "all", sound: true }, { handwritten: false }).warnings, []);
});
