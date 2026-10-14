// 活動登錄表：依單元綁定的卡片（cards）與教材，排出一課的步驟（planSteps），並為練習／測驗生題。
// 生題是純函式：同一單元、同一組卡、同一個種子，永遠得到同樣的題目；題目實例形狀與固定題相同，
// 所以可以直接丟給 question-types 的 score()。實例不是內容檔，不存進內容包。
import { createRng } from "../generators/_prng.mjs";
import { instantiate } from "../generators/index.mjs";
import zhLow from "./profiles/zh-low.json" with { type: "json" };
import zhMid from "./profiles/zh-mid.json" with { type: "json" };
import zhHigh from "./profiles/zh-high.json" with { type: "json" };
import mathElementary from "./profiles/math-elementary.json" with { type: "json" };

export const PROFILE_SCHEMA_PATH = "schema/activity-profile.schema.json";
export const ACTIVITIES_VERSION = 1;

/** 內建的年級活動設定。 */
export const profiles = Object.freeze(Object.fromEntries([zhLow, zhMid, zhHigh, mathElementary].map((p) => [p.id, p])));

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const spoken = (text) => ({ text, audio: null });
const KINDS = Object.freeze({ chars: "char", words: "word", patterns: "pattern", skills: "skill" });

/**
 * 解析單元的 bindings：把 card_ref 換成卡片物件。
 * @param {object} unit
 * @param {(ref: string) => object|null} lookup 回傳卡片或 null（同包 id 與跨包 pack@version#id 都交給呼叫端解析）。
 * @returns {{ cards: { chars: object[], words: object[], patterns: object[], skills: object[] }, errors: string[] }}
 */
export function resolveBindings(unit, lookup) {
  const cards = { chars: [], words: [], patterns: [], skills: [] };
  const errors = [];
  const b = isPlainObject(unit?.bindings) ? unit.bindings : {};
  for (const [group, kind] of Object.entries(KINDS)) {
    for (const ref of Array.isArray(b[group]) ? b[group] : []) {
      const card = lookup(ref);
      if (!card) errors.push(`bindings.${group}: 找不到卡片 ${ref}`);
      else if (card.kind !== kind) errors.push(`bindings.${group}: ${ref} 是 ${card.kind} 卡，不是 ${kind}`);
      else cards[group].push(card);
    }
  }
  return { cards, errors };
}

const hasMaterial = (materials, kind) => materials.some((m) => m.kind === kind);
const wordsWithExample = (cards) => cards.words.filter((w) => w.example && w.example.text.includes(w.word));

// 每個活動：預設段落、是否生題、在什麼條件下才出現（needs 回傳 null 表示可以，字串是不能的理由）。
const REGISTRY = {
  read: { phase: "learn", needs: (c, m) => (hasMaterial(m, "lesson") || hasMaterial(m, "simplified") ? null : "沒有課文教材（lesson／simplified）") },
  mindmap: { phase: "learn", needs: (c, m) => (hasMaterial(m, "mindmap") ? null : "沒有心智圖教材（mindmap）") },
  demo: { phase: "learn", needs: (c, m) => (hasMaterial(m, "demo") ? null : "沒有示範教材（demo）") },
  "char-cards": { phase: "practice", needs: (c) => (c.chars.length ? null : "沒有綁生字卡") },
  "word-cards": { phase: "practice", needs: (c) => (c.words.length ? null : "沒有綁語詞卡") },
  manipulate: { phase: "practice", needs: (c) => (c.skills.some((s) => s.manipulative) ? null : "綁的技能卡沒有教具設定") },
  "char-pick": { phase: "practice", count: 4, generate: genCharPick, needs: (c) => (c.chars.length ? null : "沒有綁生字卡") },
  "word-match": { phase: "practice", count: 1, generate: genWordMatch, needs: (c) => (c.words.length >= 2 ? null : "綁的語詞卡少於 2 張") },
  "word-cloze": { phase: "practice", count: 4, generate: genWordCloze, needs: (c) => (wordsWithExample(c).length && c.words.length >= 2 ? null : "沒有含例句的語詞卡，或語詞卡少於 2 張") },
  "sentence-order": { phase: "practice", count: 2, generate: genSentenceOrder, needs: (c) => (c.patterns.length ? null : "沒有綁句型卡") },
  "skill-practice": { phase: "practice", count: 5, generate: genSkillPractice, needs: (c) => (c.skills.length ? null : "沒有綁技能卡") },
  quiz: { phase: "battle", count: 5, generate: genQuiz, needs: (c) => (c.chars.length || c.words.length >= 2 || c.patterns.length || c.skills.length ? null : "沒有可出題的卡") },
};

/** 已登錄的活動 id。 */
export const activityIds = Object.freeze(Object.keys(REGISTRY));
/** 會生題的活動 id。 */
export const generatingActivities = Object.freeze(Object.keys(REGISTRY).filter((k) => REGISTRY[k].generate));

/** 依科目與年級找內建的年級活動設定；找不到回 null。 */
export function profileFor(subject, grade) {
  return Object.values(profiles).find((p) => p.subject === subject && p.grades.includes(grade)) ?? null;
}

/**
 * 排出一課的步驟：年級設定（或單元自己的 activities）× 綁定的卡 × 有的教材。
 * 條件不足的步驟略過並說明理由（skipped），不丟錯：同一份年級設定要能套在內容多寡不同的課。
 * @returns {{ profile: string|null, steps: object[], skipped: { activity: string, reason: string }[] }}
 */
export function planSteps({ unit, cards, materials = [], profile = null }) {
  const chosen = Array.isArray(unit.activities) ? null : profile ?? (unit.activity_profile ? profiles[unit.activity_profile] : profileFor(unit.subject, unit.grade));
  const source = Array.isArray(unit.activities) ? unit.activities : chosen?.steps ?? [];
  const steps = [];
  const skipped = [];
  for (const step of source) {
    const def = REGISTRY[step.activity];
    if (!def) {
      skipped.push({ activity: step.activity, reason: "未登錄的活動" });
      continue;
    }
    const reason = def.needs(cards, materials);
    if (reason) {
      skipped.push({ activity: step.activity, reason });
      continue;
    }
    steps.push({
      index: steps.length,
      activity: step.activity,
      label: step.label,
      short: step.short ?? step.label,
      phase: step.phase ?? def.phase,
      generates: Boolean(def.generate),
      ...(def.generate ? { count: step.count ?? def.count } : {}),
      ...(step.optional ? { optional: true } : {}),
    });
  }
  return { profile: Array.isArray(unit.activities) ? null : chosen?.id ?? null, steps, skipped };
}

/**
 * 為一個步驟生題。
 * @param {string} activity 活動 id（要會生題）。
 * @param {{ unit: object, cards: object, seed: string|number, count?: number, pools?: Map }} ctx
 * @returns {object[]} 題目實例（kind: "instance"）。
 */
export function generate(activity, { unit, cards, seed, count, pools } = {}) {
  const def = REGISTRY[activity];
  if (!def?.generate) throw new TypeError(`generate: ${JSON.stringify(activity)} 不是會生題的活動`);
  if (seed === undefined || seed === null || seed === "") throw new TypeError("generate: 需要 seed，作答事件才能重現這批題目");
  const reason = def.needs(cards, []);
  if (reason) throw new TypeError(`generate(${activity}): ${reason}`);
  const n = count ?? def.count;
  if (!Number.isInteger(n) || n < 1) throw new TypeError("generate: count 必須是 ≥ 1 的整數");
  const rng = createRng(`${unit.id}|${activity}|${seed}`);
  const parts = def.generate({ unit, cards, rng, count: n, seed: String(seed), pools });
  return parts.map((part, index) => finish(part, { unit, activity, seed: String(seed), index }));
}

function finish(part, { unit, activity, seed, index }) {
  if (part.kind === "instance" && part.generator) {
    // 技能練習沿用數學產生器的實例，只補活動追溯欄位。
    return { ...part, activity, activity_version: ACTIVITIES_VERSION, unit: unit.id };
  }
  const { cards: used, ladder_ids, ...rest } = part;
  return {
    kind: "instance",
    id: `${unit.id}-${activity}#${index}`,
    source: "cards",
    activity,
    activity_version: ACTIVITIES_VERSION,
    seed,
    index,
    unit: unit.id,
    cards: used,
    ...(ladder_ids?.length ? { ladder_ids } : unit.ladder_ids?.length ? { ladder_ids: [...unit.ladder_ids] } : {}),
    ...(unit.curriculum_codes?.length ? { curriculum_codes: [...unit.curriculum_codes] } : {}),
    ...rest,
  };
}

/**
 * 把卡片生出的題目實例轉成固定題形狀（給 item schema 驗證）。只拿掉追溯欄位，題目內容不變。
 */
export function toItemShape(instance, { id = "x-check" } = {}) {
  if (instance.generator) throw new TypeError("toItemShape: 數學產生器的實例請用 generators/instance.schema.json 驗證");
  const { kind, id: _id, source, activity, activity_version, seed, index, cards, unit, quiz_source, ...rest } = instance;
  return { format_version: 1, id, unit: unit ?? "x-unit", kind: "fixed", ...rest };
}

/** 數學產生器實例去掉活動追溯欄位，回到 generators/instance.schema.json 的形狀。 */
export function toInstanceShape(instance) {
  const { cards, activity, activity_version, quiz_source, ...rest } = instance;
  return rest;
}

/** 產生「正確作答」：給驗證器與測試確認正解拿滿分。 */
export function correctResponse(instance) {
  switch (instance.type) {
    case "choice":
      return { option: instance.answer };
    case "match":
      return { pairs: Object.fromEntries(instance.pairs.map((p) => [p.id, p.id])) };
    case "ordering":
      return { order: instance.sequence.map((s) => s.id) };
    case "numeric":
      return { value: instance.answer };
    case "blanks":
      return { blanks: Object.fromEntries(instance.blanks.map((b) => [b.id, b.answer])) };
    default:
      throw new TypeError(`correctResponse: 不支援的題型 ${instance.type}`);
  }
}

// ---------- 小工具 ----------
function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const take = (list, n, rng) => shuffle(list, rng).slice(0, n);
// 依序循環取 n 個（卡比題數少時重複使用，但每輪重新洗牌）。
function cycle(list, n, rng) {
  const out = [];
  while (out.length < n) out.push(...shuffle(list, rng));
  return out.slice(0, n);
}
const ladderOf = (...cards) => [...new Set(cards.flatMap((c) => c.ladder_ids ?? []))];
const OPTION_IDS = ["a", "b", "c", "d"];
function choiceOptions(correctText, distractorTexts, rng) {
  const texts = shuffle([correctText, ...distractorTexts], rng);
  const options = texts.map((t, i) => ({ id: OPTION_IDS[i], text: spoken(t) }));
  return { options, answer: OPTION_IDS[texts.indexOf(correctText)] };
}

// ---------- 生題 ----------
function genCharPick({ cards, rng, count }) {
  const words = new Map(cards.words.map((w) => [w.id, w]));
  return cycle(cards.chars, count, rng).map((ch) => {
    const fromCard = (ch.confusables ?? []).map((c) => c.char).filter((c) => c !== ch.char);
    const fromLesson = cards.chars.map((c) => c.char).filter((c) => c !== ch.char && !fromCard.includes(c));
    const distractors = [...take(fromCard, 2, rng), ...take(fromLesson, 2, rng)].slice(0, 2);
    const example = (ch.words ?? []).map((ref) => words.get(ref)).find((w) => w && w.word.includes(ch.char));
    const prompt = example ? `「${example.word.replaceAll(ch.char, "○")}」的○，注音是「${ch.zhuyin}」，是哪一個字？` : `注音「${ch.zhuyin}」，意思是「${ch.meaning.text}」，是哪一個字？`;
    return {
      type: "choice",
      cards: [ch.id],
      ladder_ids: ladderOf(ch),
      skill: "識字",
      difficulty: 1,
      stem: { text: spoken(prompt) },
      ...choiceOptions(ch.char, distractors, rng),
      shuffle: false,
      hints: [spoken("先聽一次注音，再看看每個字。"), spoken(`想一想「${ch.meaning.text}」。`), spoken(`這個字的部首是「${ch.radical ?? "？"}」。`)],
      feedback: { correct: spoken(`對了，是「${ch.char}」。`), retry: spoken("再看一次每個字長得哪裡不一樣。") },
    };
  }).filter((q) => q.options.length >= 2);
}

function genWordMatch({ cards, rng, count }) {
  const out = [];
  for (let n = 0; n < count; n++) {
    const picked = take(cards.words, Math.min(4, cards.words.length), rng);
    out.push({
      type: "match",
      cards: picked.map((w) => w.id),
      ladder_ids: ladderOf(...picked),
      skill: "詞語理解",
      difficulty: 1,
      stem: { text: spoken("點一個語詞，再點它的意思。") },
      pairs: picked.map((w, i) => ({ id: `p${i + 1}`, left: spoken(w.word), right: structuredClone(w.meaning) })),
      shuffle: true,
      hints: [spoken("先找你最有把握的一組。"), spoken("可以按「聽」聽語詞和意思。"), spoken(`「${picked[0].word}」的意思是「${picked[0].meaning.text}」。`)],
      feedback: { correct: spoken("全部配對完成！"), retry: spoken("有一組還沒對，再試一次。") },
    });
  }
  return out;
}

function genWordCloze({ cards, rng, count }) {
  const pool = wordsWithExample(cards);
  return cycle(pool, count, rng).map((w) => {
    const others = cards.words.filter((x) => x.id !== w.id).map((x) => x.word);
    const distractors = take(others, 2, rng);
    const blank = "＿".repeat(Math.max(2, [...w.word].length));
    return {
      type: "choice",
      cards: [w.id],
      ladder_ids: ladderOf(w),
      skill: "詞語運用",
      difficulty: 2,
      stem: { text: spoken(`選出適合的語詞：${w.example.text.replace(w.word, blank)}`) },
      ...choiceOptions(w.word, distractors, rng),
      shuffle: false,
      hints: [spoken("先把句子讀一遍，空格的地方想一想。"), spoken(`意思是「${w.meaning.text}」的語詞。`), spoken(`第一個字是「${[...w.word][0]}」。`)],
      feedback: { correct: spoken(`對了：${w.example.text}`), retry: spoken("把每個語詞放進句子讀讀看。") },
    };
  });
}

function genSentenceOrder({ cards, rng, count }) {
  const examples = cards.patterns.flatMap((p) => p.examples.map((ex) => ({ p, ex })));
  return cycle(examples, count, rng).map(({ p, ex }) => ({
    type: "ordering",
    cards: [p.id],
    ladder_ids: ladderOf(p),
    skill: "句型",
    difficulty: 2,
    stem: { text: spoken(`把詞卡排成一句話（句型：${p.title.text}）。`) },
    sequence: ex.chunks.map((c, i) => ({ id: `s${i + 1}`, text: structuredClone(c) })),
    hints: [spoken("先找誰或什麼開頭。"), spoken(`想想句型「${p.title.text}」。`), spoken(`第一張是「${ex.chunks[0].text}」。`)],
    feedback: { correct: spoken(`排對了：${ex.sentence?.text ?? ex.chunks.map((c) => c.text).join("")}`), retry: spoken("排好後讀一遍，聽聽看順不順。") },
  }));
}

function genSkillPractice({ unit, cards, rng, count, seed, pools }) {
  const out = [];
  const perSkill = Math.ceil(count / cards.skills.length);
  for (const skill of shuffle(cards.skills, rng)) {
    const item = {
      format_version: 1,
      id: `${skill.id}`.slice(0, 64),
      unit: unit.id,
      type: skill.params?.presentation === "horizontal-numeric" ? "numeric" : "blanks",
      kind: "generated",
      skill: skill.title.text,
      ladder_ids: skill.ladder_ids,
      ...(skill.curriculum_codes ? { curriculum_codes: skill.curriculum_codes } : {}),
      generator: skill.generator,
      generator_version: skill.generator_version,
      params: skill.params,
      count: perSkill,
    };
    out.push(...instantiate(item, { seed: `${seed}|${skill.id}`, pools }).map((inst) => ({ ...inst, cards: [skill.id] })));
  }
  return out.slice(0, count);
}

// 綜合小測驗：在可用的生題活動之間輪流抽，一題一個來源，順序再洗牌。
function genQuiz({ unit, cards, rng, count, seed, pools }) {
  const sources = [];
  if (cards.chars.length) sources.push("char-pick");
  if (wordsWithExample(cards).length && cards.words.length >= 2) sources.push("word-cloze");
  if (cards.patterns.length) sources.push("sentence-order");
  if (cards.skills.length) sources.push("skill-practice");
  if (!sources.length && cards.words.length >= 2) sources.push("word-match");
  const plan = cycle(sources, count, rng);
  const tally = Object.fromEntries(sources.map((s) => [s, plan.filter((p) => p === s).length]));
  const made = [];
  for (const s of sources) {
    const def = REGISTRY[s];
    const sub = def.generate({ unit, cards, rng: createRng(`${unit.id}|quiz|${s}|${seed}`), count: tally[s], seed: `${seed}|quiz`, pools });
    made.push(...sub.slice(0, tally[s]).map((q) => ({ ...q, ...(q.generator ? {} : { quiz_source: s }) })));
  }
  return shuffle(made, rng).slice(0, count);
}
