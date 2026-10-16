// 卡片生的聽音選字、聽音選語詞、語詞解釋（#49）：同音字一律避開、讀音不明不用、錯誤類型與回饋、音檔可用性、驗證器。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, planSteps, readingsFromCards, misconceptions, toItemShape, correctResponse } from "../activities/index.mjs";
import { validatePack, loadValidators, checkCard, checkListenItem } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";
import { syllableKey } from "../audio/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(here, "..", "examples", "cards-demo");

const spoken = (text) => ({ text, audio: null });
const char = (c, z, confusables = []) => ({ format_version: 1, id: `c-${syllableKey(z)}-${c.codePointAt(0).toString(16)}`, kind: "char", key: `${c}|${z}`, char: c, zhuyin: z, meaning: spoken(`${c} 的意思`), confusables, ladder_ids: ["4-Ⅲ-1#c@6"] });
const word = (w, z, meaning, example) => ({ format_version: 1, id: `w-${createHash("sha256").update(w).digest("hex").slice(0, 8)}`, kind: "word", key: `${w}|${z}`, word: w, zhuyin: z, meaning: spoken(meaning), ...(example ? { example: spoken(example) } : {}), ladder_ids: ["5-Ⅱ-8#b"] });
const unit = { id: "u-test", subject: "chinese", grade: 6, ladder_ids: ["4-Ⅲ-1#c@6"] };
const cardsOf = (chars = [], words = []) => ({ chars, words, patterns: [], skills: [] });
const optionTexts = (q) => q.options.map((o) => o.text.text);

// 擇 ㄗㄜˊ：譯（形近、有讀音）可用；澤（音同）與釋（沒填讀音）都不能用；同課的「則」也讀 ㄗㄜˊ，不能用。
const ze = char("擇", "ㄗㄜˊ", [{ char: "譯", why: "形近", zhuyin: "ㄧˋ" }, { char: "澤", why: "音同", zhuyin: "ㄗㄜˊ" }, { char: "釋", why: "形近" }]);
const ze2 = char("則", "ㄗㄜˊ");
const jue = char("抉", "ㄐㄩㄝˊ", [{ char: "決", why: "音同", zhuyin: "ㄐㄩㄝˊ" }, { char: "快", why: "形近", zhuyin: "ㄎㄨㄞˋ" }]);
const lao = char("勞", "ㄌㄠˊ");

test("聽音選字：播單音鍵，選項不會出現同音字，也不用讀音不明的易混淆字", () => {
  const cards = cardsOf([ze, ze2, jue, lao]);
  const readings = readingsFromCards([ze, ze2, jue, lao]);
  for (const seed of ["a", "b", "c", "d", "e"]) {
    for (const q of generate("listen-char", { unit, cards, seed, count: 8 })) {
      const key = q.stem.listen.syllable;
      assert.ok(/^[a-z]+[1-4]$/.test(key));
      assert.equal(q.stem.listen.audio, undefined);
      const answer = q.options.find((o) => o.id === q.answer).text.text;
      for (const t of optionTexts(q).filter((t) => t !== answer)) {
        assert.ok(readings.get(t)?.size, `${t} 讀音不明卻當選項`);
        assert.ok(!readings.get(t).has(key), `${t} 和播放的 ${key} 同音`);
      }
      assert.ok(!optionTexts(q).some((t) => ["澤", "釋", "決"].includes(t)), optionTexts(q).join());
      assert.equal(q.read_aloud_scope, "stem");
      assert.equal(q.skill, "識字");
      assert.deepEqual(checkListenItem(q, { readings }), []);
    }
  }
});

test("聽音選字：易混淆字依 why 標錯誤類型並帶回饋；同課生字當干擾項不標", () => {
  const cards = cardsOf([ze, lao]);
  const list = generate("listen-char", { unit, cards, seed: "tag", count: 4 });
  const q = list.find((x) => x.cards[0] === ze.id);
  const yi = q.options.find((o) => o.text.text === "譯");
  assert.equal(yi.misconception, "form-alike");
  assert.match(yi.feedback.text, /長得很像/);
  const other = q.options.find((o) => o.text.text === "勞");
  assert.equal(other.misconception, undefined);
  assert.deepEqual(score(q, { option: yi.id }).detail, { chosen: yi.id, answer: q.answer, misconception: "form-alike" });
  assert.ok(Object.hasOwn(misconceptions, "form-alike"));
});

test("聽音選字：額外讀音表（卡片庫）可以補認得干擾字，也可以多擋掉同音的多音字", () => {
  const shi = char("擇", "ㄗㄜˊ", [{ char: "釋", why: "形近" }]);
  const cards = cardsOf([shi]);
  assert.throws(() => generate("listen-char", { unit, cards, seed: 1 }), /湊不出/);
  const library = readingsFromCards([char("釋", "ㄕˋ")]);
  const q = generate("listen-char", { unit, cards, seed: 1, count: 1, readings: library })[0];
  assert.deepEqual(optionTexts(q).sort(), ["擇", "釋"].sort());
  const poly = new Map([["釋", new Set(["shi4", "ze2"])]]);
  assert.throws(() => generate("listen-char", { unit, cards, seed: 1, readings: poly }), /湊不出/);
});

test("聽音選字：給了可用單音，就只對有音檔的字出題；全都沒有就丟錯", () => {
  const cards = cardsOf([ze, jue, lao]);
  const list = generate("listen-char", { unit, cards, seed: "au", count: 6, audio: { syllables: ["jue2"] } });
  assert.ok(list.every((q) => q.stem.listen.syllable === "jue2"));
  assert.throws(() => generate("listen-char", { unit, cards, seed: "au", audio: { syllables: [] } }), /沒有預錄單音/);
});

test("聽音選語詞：播語詞鍵；同音語詞不當選項；有同音字的干擾項標音近", () => {
  const words = [
    word("抉擇", "ㄐㄩㄝˊ ㄗㄜˊ", "從幾個裡面選出一個"),
    word("決擇", "ㄐㄩㄝˊ ㄗㄜˊ", "同音的另一個寫法"),
    word("選擇", "ㄒㄩㄢˇ ㄗㄜˊ", "挑出想要的"),
    word("衡量", "ㄏㄥˊ ㄌㄧㄤˊ", "想清楚、比一比"),
    word("犧牲", "ㄒㄧ ㄕㄥ", "放棄一部分"),
  ];
  const cards = cardsOf([], words);
  for (const seed of ["1", "2", "3"]) {
    for (const q of generate("listen-word", { unit, cards, seed, count: 5 })) {
      const answer = q.options.find((o) => o.id === q.answer).text.text;
      const w = words.find((x) => x.word === answer);
      assert.equal(q.stem.listen.word, `${w.word}|${w.zhuyin}`);
      assert.equal(q.options.length, 3);
      if (["抉擇", "決擇"].includes(answer)) assert.ok(!optionTexts(q).includes(answer === "抉擇" ? "決擇" : "抉擇"), optionTexts(q).join());
      const sel = q.options.find((o) => o.text.text === "選擇");
      if (sel && answer !== "選擇" && ["抉擇", "決擇"].includes(answer)) assert.equal(sel.misconception, "sound-alike");
      assert.deepEqual(checkListenItem(q), []);
    }
  }
  const only = generate("listen-word", { unit, cards, seed: "au", count: 3, audio: { words: ["衡量|ㄏㄥˊ ㄌㄧㄤˊ"] } });
  assert.ok(only.every((q) => q.stem.listen.word === "衡量|ㄏㄥˊ ㄌㄧㄤˊ"));
});

test("語詞解釋：選項是解釋，正解是這個語詞的解釋；有相同字的語詞優先當干擾項並標錯誤類型", () => {
  const words = [
    word("抉擇", "ㄐㄩㄝˊ ㄗㄜˊ", "從幾個裡面選出一個", "他在兩條路之間做出抉擇。"),
    word("選擇", "ㄒㄩㄢˇ ㄗㄜˊ", "挑出想要的"),
    word("衡量", "ㄏㄥˊ ㄌㄧㄤˊ", "想清楚、比一比"),
    word("犧牲", "ㄒㄧ ㄕㄥ", "放棄一部分"),
  ];
  const cards = cardsOf([], words);
  const list = generate("word-meaning", { unit, cards, seed: "m", count: 4 });
  assert.equal(new Set(list.map((q) => q.cards[0])).size, 4, "四張卡各輪到一次");
  for (const q of list) {
    const w = words.find((x) => x.id === q.cards[0]);
    assert.equal(q.options.find((o) => o.id === q.answer).text.text, w.meaning.text);
    assert.equal(new Set(optionTexts(q)).size, optionTexts(q).length);
    assert.equal(q.read_aloud_scope, "all");
    if (w.word === "抉擇") {
      assert.match(q.stem.text.text, /這句話裡的「抉擇」/);
      const sel = q.options.find((o) => o.text.text === "挑出想要的");
      assert.equal(sel.misconception, "shared-char");
      assert.match(sel.feedback.text, /「選擇」/);
    }
  }
});

test("三個新活動：同一種子結果相同；正解拿滿分；題目通過 item schema", async () => {
  const v = await loadValidators();
  const cards = cardsOf([ze, jue, lao], [word("抉擇", "ㄐㄩㄝˊ ㄗㄜˊ", "從幾個裡面選出一個"), word("衡量", "ㄏㄥˊ ㄌㄧㄤˊ", "想清楚、比一比"), word("犧牲", "ㄒㄧ ㄕㄥ", "放棄一部分")]);
  for (const activity of ["listen-char", "listen-word", "word-meaning"]) {
    const a = generate(activity, { unit, cards, seed: "same" });
    assert.deepEqual(a, generate(activity, { unit, cards, seed: "same" }), activity);
    for (const q of a) {
      assert.ok(v.item(toItemShape(q)), `${activity}: ${JSON.stringify(v.item.errors)}`);
      assert.equal(score(q, correctResponse(q)).outcome, "correct");
    }
  }
});

test("needs：條件不足時 planSteps 略過並說明理由", () => {
  const plan = planSteps({
    unit: { ...unit, activities: [{ activity: "listen-char", label: "聽音選字" }, { activity: "listen-word", label: "聽音選語詞" }, { activity: "word-meaning", label: "語詞解釋" }] },
    cards: cardsOf([char("擇", "ㄗㄜˊ", [{ char: "釋", why: "形近" }])], [word("抉擇", "ㄐㄩㄝˊ ㄗㄜˊ", "從幾個裡面選出一個")]),
  });
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.skipped.map((s) => s.activity), ["listen-char", "listen-word", "word-meaning"]);
  assert.match(plan.skipped[0].reason, /zhuyin/);
});

test("schema：stem.listen 的音源三選一；單音鍵不收輕聲", async () => {
  const v = await loadValidators();
  const base = JSON.parse(await readFile(path.join(here, "..", "examples", "minimal", "items", "i-listen-01.json"), "utf8"));
  const withListen = (listen) => ({ ...base, stem: { ...base.stem, listen } });
  assert.equal(v.item(withListen({ syllable: "ze2" })), true);
  assert.equal(v.item(withListen({ word: "抉擇|ㄐㄩㄝˊ ㄗㄜˊ", repeat_max: 2 })), true);
  for (const bad of [{}, { audio: "audio/xing2.m4a", syllable: "xing2" }, { syllable: "de5" }, { syllable: "Ze2" }, { word: "jueze" }]) {
    assert.equal(v.item(withListen(bad)), false, JSON.stringify(bad));
  }
});

test("checkListenItem：listen.syllable 也做同音字檢查；listen.word 要是正規化的語詞鍵", () => {
  const readings = readingsFromCards([ze, ze2]);
  const item = { type: "choice", answer: "a", stem: { text: spoken("聽"), listen: { syllable: "ze2" } }, options: [{ id: "a", text: spoken("擇") }, { id: "b", text: spoken("則") }] };
  assert.ok(checkListenItem(item, { readings }).some((e) => e.includes("則") && e.includes("同音")));
  const w = { type: "choice", answer: "a", stem: { text: spoken("聽"), listen: { word: "抉擇|ㄐㄩㄝˊㄗㄜˊ" } }, options: [] };
  assert.ok(checkListenItem(w).some((e) => e.includes("不是合法的語詞鍵")));
  w.stem.listen.word = "抉擇|ㄐㄩㄝˊ  ㄗㄜˊ";
  assert.ok(checkListenItem(w).some((e) => e.includes("正規化")));
});

test("checkCard：易混淆字的 zhuyin 要合法，而且和 why 一致", () => {
  const errs = (confusables) => checkCard(char("擇", "ㄗㄜˊ", confusables));
  assert.deepEqual(errs([{ char: "譯", why: "形近", zhuyin: "ㄧˋ" }, { char: "澤", why: "音同", zhuyin: "ㄗㄜˊ" }]), []);
  assert.ok(errs([{ char: "譯", zhuyin: "ㄧㄚㄨ" }]).some((e) => e.includes("不是一個合法音節")));
  assert.ok(errs([{ char: "澤", why: "音同", zhuyin: "ㄗㄜˇ" }]).some((e) => e.includes("標音同")));
  assert.ok(errs([{ char: "則", why: "形近", zhuyin: "ㄗㄜˊ" }]).some((e) => e.includes("應標音同")));
});

async function withDemo(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-listen-act-"));
  await cp(DEMO, dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function edit(dir, rel, mutate) {
  const p = path.join(dir, rel);
  const obj = JSON.parse(await readFile(p, "utf8"));
  mutate(obj);
  await writeFile(p, JSON.stringify(obj, null, 2));
  const pp = path.join(dir, "pack.json");
  const pack = JSON.parse(await readFile(pp, "utf8"));
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
  await writeFile(pp, JSON.stringify(pack, null, 2));
}

test("驗證器：單元選用三個新活動時照常生題檢查，0 錯誤", () =>
  withDemo(async (dir) => {
    await edit(dir, "units/u-rain-park.json", (u) => {
      u.activities = [{ activity: "listen-char", label: "聽音選字" }, { activity: "listen-word", label: "聽音選語詞" }, { activity: "word-meaning", label: "語詞解釋" }];
    });
    const r = await validatePack(dir);
    assert.deepEqual(r.errors, []);
  }));

test("驗證器：手寫題可以直接用內建錯誤類型代碼，不必列在 pack.json", () =>
  withDemo(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "udl-listen-min-"));
    try {
      await cp(path.join(here, "..", "examples", "minimal"), dir, { recursive: true });
      await edit(dir, "items/i-rhetoric-01.json", (o) => { o.options[1].misconception = "sound-alike"; });
      assert.deepEqual((await validatePack(dir)).errors, []);
      await edit(dir, "items/i-rhetoric-01.json", (o) => { o.options[1].misconception = "not-builtin"; });
      assert.ok((await validatePack(dir)).errors.some((e) => e.includes("not-builtin") && e.includes("也不是內建錯誤類型")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }));

test("活動 id：schema 的 activity_id enum 與登錄表一致", async () => {
  const { activityIds } = await import("../activities/index.mjs");
  const schema = JSON.parse(await readFile(path.join(here, "..", "schema", "activity-profile.schema.json"), "utf8"));
  assert.deepEqual([...schema.$defs.activity_id.enum].sort(), [...activityIds].sort());
});
