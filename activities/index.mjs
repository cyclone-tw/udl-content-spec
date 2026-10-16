// 活動登錄表：依單元綁定的卡片（cards）與教材，排出一課的步驟（planSteps），並為練習／測驗生題。
// 生題是純函式：同一單元、同一組卡、同一個種子，永遠得到同樣的題目；題目實例形狀與固定題相同，
// 所以可以直接丟給 question-types 的 score()。實例不是內容檔，不存進內容包。
import { createRng } from "../generators/_prng.mjs";
import { instantiate } from "../generators/index.mjs";
import { normalizeZhuyin, syllableKey, wordKey } from "../audio/index.mjs";
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
      else cards[group].push(ref === card.id ? card : { ...card, __ref: ref });
    }
  }
  return { cards, errors };
}

const hasMaterial = (materials, kind) => materials.some((m) => m.kind === kind);
const wordsWithExample = (cards) => cards.words.filter((w) => w.example && w.example.text.includes(w.word));
const confusableChars = (ch) => [...new Set((ch.confusables ?? []).map((c) => c.char))].filter((c) => c !== ch.char);
// 選字題至少要湊得出兩個選項：卡上有易混淆字，或這課有兩個以上的生字。
const charPickable = (c) => c.chars.length >= 2 || c.chars.some((ch) => confusableChars(ch).length > 0);

/**
 * 字 → 讀音（單音鍵）集合：取自生字卡、語詞卡（逐字拆注音）與生字卡上填了 zhuyin 的易混淆字。
 * 聽音選字用它避開同音字；驗證器也用它做 #36 的同音字檢查。
 * @param {Iterable<object>} cards 卡片物件（任何種類，不認得的略過）
 * @returns {Map<string, Set<string>>}
 */
export function readingsFromCards(cards) {
  const map = new Map();
  const add = (ch, z) => {
    const key = syllableKey(z);
    if (!key) return;
    if (!map.has(ch)) map.set(ch, new Set());
    map.get(ch).add(key);
  };
  for (const c of cards) {
    if (c?.kind === "char") {
      add(c.char, c.zhuyin);
      for (const x of c.confusables ?? []) if (x?.zhuyin) add(x.char, x.zhuyin);
    }
    if (c?.kind === "word") {
      const chars = [...c.word];
      const syl = normalizeZhuyin(c.zhuyin).split(" ");
      if (chars.length === syl.length) chars.forEach((ch, i) => add(ch, syl[i]));
    }
  }
  return map;
}

const allBound = (c) => [...c.chars, ...c.words];
function mergeReadings(base, extra) {
  if (!extra) return base;
  const out = new Map([...base].map(([k, v]) => [k, new Set(v)]));
  for (const [k, v] of extra) {
    if (!out.has(k)) out.set(k, new Set());
    for (const key of v) out.get(k).add(key);
  }
  return out;
}
// 聽音選字的干擾字：讀音已知、而且沒有任何一個讀音和播放的音相同。先用卡上的易混淆字，再用同課其他生字。
const WHY_TAG = { 形近: "form-alike", 音近: "sound-alike" };
function listenCharDistractors(ch, cards, readings) {
  const key = syllableKey(ch.zhuyin);
  const usable = (t) => t !== ch.char && readings.get(t)?.size > 0 && !readings.get(t).has(key);
  const fromCard = (ch.confusables ?? []).filter((x) => usable(x.char)).map((x) => ({ text: x.char, misconception: WHY_TAG[x.why] }));
  const seen = new Set(fromCard.map((d) => d.text));
  const fromLesson = [...new Set(cards.chars.map((c) => c.char))].filter((t) => usable(t) && !seen.has(t)).map((text) => ({ text }));
  return { key, fromCard, fromLesson };
}
// 單音包不收輕聲，所以輕聲字不出聽音選字。
const listenable = (key) => /^[a-z]+[1-4]$/.test(key ?? "");
function listenCharReady(ch, cards, readings) {
  const { key, fromCard, fromLesson } = listenCharDistractors(ch, cards, readings);
  return listenable(key) && fromCard.length + fromLesson.length > 0;
}
const sameSound = (a, b) => normalizeZhuyin(a.zhuyin) === normalizeZhuyin(b.zhuyin);
const listenWordReady = (c) => c.words.some((w) => c.words.some((x) => x.id !== w.id && x.word !== w.word && !sameSound(w, x)));
const wordMeaningReady = (c) => c.words.some((w) => c.words.some((x) => x.id !== w.id && x.meaning.text !== w.meaning.text));

// 各活動的題庫：count: "all" 與測驗藍圖都照這裡算有幾筆（#50）。
function listenCharPool(c, ctx) {
  const readings = mergeReadings(readingsFromCards(allBound(c)), ctx?.readings);
  const have = asSet(ctx?.audio?.syllables);
  return c.chars.filter((ch) => listenCharReady(ch, c, readings) && (!have || have.has(syllableKey(ch.zhuyin))));
}
const listenWordOthers = (c, w) => c.words.filter((x) => x.id !== w.id && x.word !== w.word && !sameSound(w, x));
function listenWordPool(c, ctx) {
  const have = asSet(ctx?.audio?.words);
  return c.words.filter((w) => listenWordOthers(c, w).length && (!have || have.has(wordKey(w.word, w.zhuyin))));
}
const wordMeaningOthers = (c, w) => c.words.filter((x) => x.id !== w.id && x.meaning.text !== w.meaning.text);
const wordMeaningPool = (c) => c.words.filter((w) => wordMeaningOthers(c, w).length);
// 課文題：單元手寫的固定題（generate／planSteps 的 items），一律歸「課文」分類。
const readingItems = (ctx) => (Array.isArray(ctx?.items) ? ctx.items : []).filter((i) => i && i.kind === "fixed");

/**
 * 卡片生題用的內建錯誤類型（#49）：代碼 → 給老師看的中文名，形狀同 pack.json 的 misconceptions。
 * 自動題的錯誤選項依干擾項來源標這些代碼；手寫題的代碼仍列在各包的 pack.json misconceptions。
 */
export const misconceptions = Object.freeze({
  "form-alike": Object.freeze({ label: "形近混淆", note: "選了長得像、讀音不同的字" }),
  "sound-alike": Object.freeze({ label: "音近混淆", note: "選了讀音接近的字或語詞" }),
  "shared-char": Object.freeze({ label: "相同字的語詞混淆", note: "語詞裡有一樣的字，就以為意思一樣" }),
});

// 每個活動：預設段落、是否生題、在什麼條件下才出現（needs 回傳 null 表示可以，字串是不能的理由）。
const REGISTRY = {
  read: { phase: "learn", needs: (c, m) => (hasMaterial(m, "lesson") || hasMaterial(m, "simplified") ? null : "沒有課文教材（lesson／simplified）") },
  mindmap: { phase: "learn", needs: (c, m) => (hasMaterial(m, "mindmap") ? null : "沒有心智圖教材（mindmap）") },
  demo: { phase: "learn", needs: (c, m) => (hasMaterial(m, "demo") ? null : "沒有示範教材（demo）") },
  "char-cards": { phase: "practice", group: "char", needs: (c) => (c.chars.length ? null : "沒有綁生字卡") },
  "word-cards": { phase: "practice", group: "word", needs: (c) => (c.words.length ? null : "沒有綁語詞卡") },
  manipulate: { phase: "practice", group: "skill", needs: (c) => (c.skills.some((s) => s.manipulative) ? null : "綁的技能卡沒有教具設定") },
  "char-pick": { phase: "practice", group: "char", count: 4, readAloud: "stem", pool: (c) => c.chars.length, generate: genCharPick, needs: (c) => (charPickable(c) ? null : "生字卡少於 2 張，而且卡上沒有易混淆字，湊不出選項") },
  "word-match": { phase: "practice", group: "word", count: 1, readAloud: "stem", pool: (c) => Math.ceil(c.words.length / 4), generate: genWordMatch, needs: (c) => (c.words.length >= 2 ? null : "綁的語詞卡少於 2 張") },
  "word-cloze": { phase: "practice", group: "word", count: 4, readAloud: "stem", pool: (c) => wordsWithExample(c).length, generate: genWordCloze, needs: (c) => (wordsWithExample(c).length && c.words.length >= 2 ? null : "沒有含例句的語詞卡，或語詞卡少於 2 張") },
  "listen-char": { phase: "practice", group: "char", count: 4, readAloud: "stem", pool: (c, ctx) => listenCharPool(c, ctx).length, generate: genListenChar, needs: (c, m, ctx) => (c.chars.some((ch) => listenCharReady(ch, c, mergeReadings(readingsFromCards(allBound(c)), ctx?.readings))) ? null : "湊不出和生字不同音的干擾字（易混淆字要填 zhuyin，或多綁幾張生字卡）") },
  "listen-word": { phase: "practice", group: "word", count: 4, readAloud: "stem", pool: (c, ctx) => listenWordPool(c, ctx).length, generate: genListenWord, needs: (c) => (listenWordReady(c) ? null : "綁的語詞卡少於 2 張，或語詞全都同音") },
  "word-meaning": { phase: "practice", group: "word", count: 4, readAloud: "all", pool: (c) => wordMeaningPool(c).length, generate: genWordMeaning, needs: (c) => (wordMeaningReady(c) ? null : "綁的語詞卡少於 2 張，或解釋全都相同") },
  "sentence-order": { phase: "practice", group: "word", count: 2, readAloud: "all", pool: (c) => c.patterns.reduce((n, p) => n + p.examples.length, 0), generate: genSentenceOrder, needs: (c) => (c.patterns.length ? null : "沒有綁句型卡") },
  "skill-practice": { phase: "practice", group: "skill", count: 5, readAloud: "stem", generate: genSkillPractice, needs: (c) => (c.skills.length ? null : "沒有綁技能卡") },
  "reading-items": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => readingItems(ctx).length, generate: genReadingItems, needs: (c, m, ctx) => (readingItems(ctx).length ? null : "單元沒有手寫的課文題（items 裡的固定題）") },
  quiz: { phase: "battle", count: 5, generate: genQuiz, needs: (c) => (quizSources(c).length ? null : "沒有可出題的卡") },
};

// 綜合小測驗可以抽的來源：每種卡各一個活動；語詞配對只在沒有其他來源時才用（配對一題就是一整組，放進測驗太重）。
function quizSources(c) {
  const sources = [];
  if (charPickable(c)) sources.push("char-pick");
  if (wordsWithExample(c).length && c.words.length >= 2) sources.push("word-cloze");
  if (c.patterns.length) sources.push("sentence-order");
  if (c.skills.length) sources.push("skill-practice");
  if (!sources.length && c.words.length >= 2) sources.push("word-match");
  return sources;
}

/** 已登錄的活動 id。 */
export const activityIds = Object.freeze(Object.keys(REGISTRY));
/** 會生題的活動 id。 */
export const generatingActivities = Object.freeze(Object.keys(REGISTRY).filter((k) => REGISTRY[k].generate));

/**
 * 活動 × 年級 → 能力階梯：年級設定的 ladders（該年級，沒有就用 "*"），再被單元的 ladders 覆寫。
 * @returns {Record<string, string[]>}
 */
export function resolveLadders({ unit, profile = null }) {
  const out = {};
  const grade = String(unit.grade);
  for (const [activity, byGrade] of Object.entries(profile?.ladders ?? {})) {
    const ids = byGrade[grade] ?? byGrade["*"];
    if (ids?.length) out[activity] = [...ids];
  }
  for (const [activity, ids] of Object.entries(isPlainObject(unit.ladders) ? unit.ladders : {})) out[activity] = [...ids];
  return out;
}

/** 單元的核心卡（bindings 的子集）；沒標就回 null。 */
export function coreCards(unit, cards) {
  const core = new Set(Array.isArray(unit.core) ? unit.core : []);
  if (!core.size) return null;
  const refOf = (card) => card.__ref ?? card.id;
  return Object.fromEntries(Object.entries(cards).map(([g, list]) => [g, list.filter((c) => core.has(refOf(c)))]));
}

/** 依科目與年級找內建的年級活動設定；找不到回 null。 */
export function profileFor(subject, grade) {
  return Object.values(profiles).find((p) => p.subject === subject && p.grades.includes(grade)) ?? null;
}

/**
 * 排出一課的步驟：年級設定（或單元自己的 activities）× 綁定的卡 × 有的教材。
 * 條件不足的步驟略過並說明理由（skipped），不丟錯：同一份年級設定要能套在內容多寡不同的課。
 * @returns {{ profile: string|null, steps: object[], skipped: { activity: string, reason: string }[] }}
 */
export function planSteps({ unit, cards, materials = [], profile = null, items, readings, groups } = {}) {
  const chosen = Array.isArray(unit.activities) ? null : profile ?? (unit.activity_profile ? profiles[unit.activity_profile] : profileFor(unit.subject, unit.grade));
  // 單元自己寫 activities 時，能力階梯對照仍用該科該年級的年級設定（再被單元 ladders 覆寫）。
  const ladderProfile = chosen ?? (unit.activity_profile ? profiles[unit.activity_profile] : profileFor(unit.subject, unit.grade));
  const ladders = resolveLadders({ unit, profile: ladderProfile });
  const source = Array.isArray(unit.activities) ? unit.activities : chosen?.steps ?? [];
  const ctx = { items, readings };
  // groups：老師只指派某幾類練習時，其他分類的步驟拿掉，測驗藍圖也只留這幾類（#50）。
  const wanted = Array.isArray(groups) ? new Set(groups) : null;
  const steps = [];
  const skipped = [];
  for (const step of source) {
    const def = REGISTRY[step.activity];
    if (!def) {
      skipped.push({ activity: step.activity, reason: "未登錄的活動" });
      continue;
    }
    if (wanted && def.group && !wanted.has(def.group)) {
      skipped.push({ activity: step.activity, reason: `這次沒有指派「${def.group}」分類` });
      continue;
    }
    let blueprint;
    let blueprintSkipped = [];
    if (step.activity === "quiz" && step.blueprint) {
      // 測驗題只從本課前面的練習步驟抽：同分類、會生題的活動（#50）。
      ({ blueprint, skipped: blueprintSkipped } = resolveBlueprint(step.blueprint, steps, wanted));
      if (!blueprint.length) {
        skipped.push({ activity: step.activity, reason: "測驗藍圖的分類都沒有對應的練習步驟" });
        continue;
      }
    } else {
      const reason = def.needs(cards, materials, ctx);
      if (reason) {
        skipped.push({ activity: step.activity, reason });
        continue;
      }
    }
    const count = blueprint ? blueprint.reduce((n, b) => n + b.count, 0) : step.count ?? def.count;
    steps.push({
      index: steps.length,
      activity: step.activity,
      label: step.label,
      short: step.short ?? step.label,
      phase: step.phase ?? def.phase,
      ...(def.group ? { group: def.group } : {}),
      generates: Boolean(def.generate),
      ...(def.generate ? { count } : {}),
      ...(blueprint ? { blueprint } : {}),
      ...(blueprintSkipped.length ? { blueprint_skipped: blueprintSkipped } : {}),
      ...(def.generate && (step.read_aloud_scope ?? def.readAloud) ? { read_aloud_scope: step.read_aloud_scope ?? def.readAloud } : {}),
      ...(ladders[step.activity] ? { ladder_ids: ladders[step.activity] } : {}),
      ...(step.optional ? { optional: true } : {}),
    });
  }
  return { profile: Array.isArray(unit.activities) ? null : chosen?.id ?? null, ladder_status: ladderProfile?.ladder_status ?? null, ladders, steps, skipped };
}

// 藍圖的每個分類 → 前面練習步驟裡同分類、會生題的活動；沒有來源的分類略過並說明。
function resolveBlueprint(entries, steps, wanted) {
  const blueprint = [];
  const skipped = [];
  for (const { group, count } of entries) {
    if (wanted && !wanted.has(group)) continue;
    const sources = [...new Set(steps.filter((x) => x.generates && x.group === group && x.activity !== "quiz").map((x) => x.activity))];
    if (sources.length) blueprint.push({ group, count, sources });
    else skipped.push({ group, reason: `前面沒有「${group}」分類的練習步驟，這部分不出題` });
  }
  return { blueprint, skipped };
}

/**
 * 為一個步驟生題。
 * @param {string} activity 活動 id（要會生題）。
 * @param {{ unit: object, cards: object, seed: string|number, count?: number, pools?: Map,
 *   ladders?: Record<string,string[]>, readAloud?: "all"|"stem"|"none", coreOnly?: boolean,
 *   readings?: Map<string, Set<string>>, audio?: { syllables?: Iterable<string>, words?: Iterable<string> } }} ctx
 *   ladders：活動 → 能力階梯（planSteps 回傳的 ladders）；readAloud：覆寫報讀範圍；coreOnly：只用單元標的核心卡。
 *   readings：額外的讀音表（例如整個卡片庫的 readingsFromCards），聽音選字用來多避開同音字、多認得干擾字的讀音。
 *   audio：有預錄音檔的單音鍵、語詞鍵；給了就只對有音檔的卡出聽音題，不給視為都有。
 * @returns {object[]} 題目實例（kind: "instance"）。
 */
export function generate(activity, { unit, cards: allCards, seed, count, pools, ladders = {}, readAloud, coreOnly = false, readings, audio, items, blueprint } = {}) {
  const def = REGISTRY[activity];
  if (!def?.generate) throw new TypeError(`generate: ${JSON.stringify(activity)} 不是會生題的活動`);
  if (seed === undefined || seed === null || seed === "") throw new TypeError("generate: 需要 seed，作答事件才能重現這批題目");
  let cards = allCards;
  if (coreOnly) {
    cards = coreCards(unit, allCards);
    if (!cards) throw new TypeError(`generate(${activity}): 單元 ${unit.id} 沒有標核心卡（core）`);
  }
  const ctx = { readings, audio, items };
  if (blueprint !== undefined && activity !== "quiz") throw new TypeError(`generate(${activity}): 只有 quiz 收 blueprint`);
  if (blueprint !== undefined) checkBlueprint(blueprint);
  else {
    const reason = def.needs(cards, [], ctx);
    if (reason) throw new TypeError(`generate(${activity}): ${reason}`);
  }
  let n = blueprint ? blueprint.reduce((t, b) => t + b.count, 0) : count ?? def.count;
  if (n === "all") {
    if (!def.pool) throw new TypeError(`generate(${activity}): 不支援 count "all"`);
    n = def.pool(cards, ctx);
  }
  if (!Number.isInteger(n) || n < 1) throw new TypeError("generate: count 必須是 ≥ 1 的整數或 \"all\"");
  const rng = createRng(`${unit.id}|${activity}|${seed}`);
  const parts = def.generate({ unit, cards, rng, count: n, seed: String(seed), pools, readings, audio, items, blueprint });
  return parts.map((part, index) => finish(part, { unit, activity, seed: String(seed), index, ladders, readAloud }));
}

function checkBlueprint(blueprint) {
  if (!Array.isArray(blueprint) || !blueprint.length) throw new TypeError("generate(quiz): blueprint 要是非空陣列（planSteps 回傳的 step.blueprint）");
  for (const b of blueprint) {
    if (!Number.isInteger(b?.count) || b.count < 1) throw new TypeError("generate(quiz): blueprint 每一項的 count 要是 ≥ 1 的整數");
    if (!Array.isArray(b.sources) || !b.sources.length) throw new TypeError(`generate(quiz): blueprint「${b.group}」沒有 sources`);
    for (const s of b.sources) if (!REGISTRY[s]?.pool || REGISTRY[s].group !== b.group) throw new TypeError(`generate(quiz): ${s} 不是「${b.group}」分類、可以算題庫的活動`);
  }
}

function finish(part, { unit, activity, seed, index, ladders, readAloud }) {
  const source = part.quiz_source ?? activity;
  const scope = readAloud ?? REGISTRY[source]?.readAloud ?? "all";
  if (part.kind === "instance" && part.generator) {
    // 技能練習沿用數學產生器的實例（能力階梯由技能卡與條件檔決定），只補活動追溯欄位與報讀範圍。
    return { ...part, activity, activity_version: ACTIVITIES_VERSION, unit: unit.id, read_aloud_scope: scope };
  }
  if (part.kind === "fixed") {
    // 課文題（#50）：題目照抄手寫題，id 不變（報表照題目統計）；報讀範圍以題目自己標的為先。
    const { kind, ...item } = part;
    return { ...item, kind: "instance", source: "items", item: item.id, activity, activity_version: ACTIVITIES_VERSION, seed, index, unit: unit.id, read_aloud_scope: readAloud ?? item.read_aloud_scope ?? scope };
  }
  // 能力階梯優先序：活動 × 年級對照 → 卡片自己標的 → 單元的。
  const { cards: used, ladder_ids: cardLadders, ...rest } = part;
  const ladder_ids = ladders[source]?.length ? ladders[source] : cardLadders;
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
    read_aloud_scope: scope,
    ...rest,
  };
}

/**
 * 把卡片生出的題目實例轉成固定題形狀（給 item schema 驗證）。只拿掉追溯欄位，題目內容不變。
 */
export function toItemShape(instance, { id = "x-check" } = {}) {
  if (instance.generator) throw new TypeError("toItemShape: 數學產生器的實例請用 generators/instance.schema.json 驗證");
  const { kind, id: _id, source, activity, activity_version, seed, index, cards, unit, quiz_source, quiz_group, item, ...rest } = instance;
  return { format_version: 1, id, unit: unit ?? "x-unit", kind: "fixed", ...rest };
}

/** 數學產生器實例去掉活動追溯欄位，回到 generators/instance.schema.json 的形狀。 */
export function toInstanceShape(instance) {
  const { cards, activity, activity_version, quiz_source, quiz_group, ...rest } = instance;
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
    case "true-false":
      return { value: instance.answer };
    case "classify":
      return { bins: Object.fromEntries(instance.bins.map((b) => [b.id, instance.objects.filter((o) => o.bin === b.id).map((o) => o.id)])) };
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
// 帶錯誤類型與逐選項回饋的選項（#43）：correct／distractors 是 { text: spoken_text, misconception?, feedback? }。
function taggedOptions(correct, distractors, rng) {
  const all = shuffle([{ ...correct, right: true }, ...distractors], rng);
  const options = all.map((d, i) => ({
    id: OPTION_IDS[i],
    text: d.text,
    ...(d.misconception ? { misconception: d.misconception } : {}),
    ...(d.feedback ? { feedback: spoken(d.feedback) } : {}),
  }));
  return { options, answer: OPTION_IDS[all.findIndex((d) => d.right)] };
}
const asSet = (v) => (v === undefined || v === null ? null : new Set(v));

// ---------- 生題 ----------
function genCharPick({ cards, rng, count }) {
  const words = new Map(cards.words.map((w) => [w.id, w]));
  return cycle(cards.chars, count, rng).map((ch) => {
    const fromCard = confusableChars(ch);
    const fromLesson = [...new Set(cards.chars.map((c) => c.char))].filter((c) => c !== ch.char && !fromCard.includes(c));
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

// 聽音選字：播生字的單音（共用單音包），選出那個字；選項一律避開同音字，讀音不明的字不用。
function genListenChar({ cards, rng, count, readings: extra, audio }) {
  const readings = mergeReadings(readingsFromCards(allBound(cards)), extra);
  const ready = listenCharPool(cards, { readings: extra, audio });
  if (!ready.length) throw new TypeError("generate(listen-char): 沒有預錄單音、又湊得出不同音干擾字的生字");
  const FEEDBACK = { "form-alike": (t) => `「${t}」和答案的字長得很像，但讀音不一樣。再聽一次。`, "sound-alike": (t) => `「${t}」的讀音很接近，再聽一次，注意每個音和聲調。` };
  return cycle(ready, count, rng).map((ch) => {
    const { key, fromCard, fromLesson } = listenCharDistractors(ch, cards, readings);
    const distractors = [...take(fromCard, 2, rng), ...take(fromLesson, 2, rng)].slice(0, 2).map((d) => ({
      text: spoken(d.text),
      ...(d.misconception ? { misconception: d.misconception, feedback: FEEDBACK[d.misconception](d.text) } : {}),
    }));
    return {
      type: "choice",
      cards: [ch.id],
      ladder_ids: ladderOf(ch),
      skill: "識字",
      difficulty: 1,
      stem: { text: spoken("聽一聽，選出你聽到的字。"), listen: { syllable: key } },
      ...taggedOptions({ text: spoken(ch.char) }, distractors, rng),
      shuffle: false,
      hints: [spoken("再聽一次，仔細聽聲調。"), spoken("想一想，這個音可以組成什麼語詞？"), spoken(`注音是「${ch.zhuyin}」。`)],
      feedback: { correct: spoken(`對了，你聽到的是「${ch.char}」。`), retry: spoken("再聽一次，想想這個音是哪一個字。") },
    };
  });
}

// 聽音選語詞：播語詞音檔（共用語詞庫），選出那個語詞；讀音完全相同的語詞不當選項。
function genListenWord({ cards, rng, count, audio }) {
  const others = (w) => listenWordOthers(cards, w);
  const ready = listenWordPool(cards, { audio });
  if (!ready.length) throw new TypeError("generate(listen-word): 沒有預錄音檔、又湊得出不同音選項的語詞");
  const syl = (w) => normalizeZhuyin(w.zhuyin).split(" ");
  return cycle(ready, count, rng).map((w) => {
    const mine = new Set(syl(w));
    const tagged = others(w).map((x) => (syl(x).some((s) => mine.has(s)) ? { text: spoken(x.word), misconception: "sound-alike", feedback: `「${x.word}」有一個字的音一樣，再聽一次每個字。` } : { text: spoken(x.word) }));
    const alike = tagged.filter((d) => d.misconception);
    const rest = tagged.filter((d) => !d.misconception);
    // 先放一個音近的（最有鑑別力），其餘從不音近的補，不夠再用音近的。
    const first = take(alike, 1, rng);
    const distractors = [...first, ...shuffle(rest, rng), ...shuffle(alike.filter((d) => !first.includes(d)), rng)].slice(0, 2);
    return {
      type: "choice",
      cards: [w.id],
      ladder_ids: ladderOf(w),
      skill: "詞語理解",
      difficulty: 1,
      stem: { text: spoken("聽一聽，選出你聽到的語詞。"), listen: { word: wordKey(w.word, w.zhuyin) } },
      ...taggedOptions({ text: spoken(w.word) }, distractors, rng),
      shuffle: false,
      hints: [spoken("再聽一次，一個字一個字聽。"), spoken(`這個語詞有 ${[...w.word].length} 個字，每個字都要對。`), spoken(`第一個字的注音是「${syl(w)[0]}」，意思是「${w.meaning.text}」。`)],
      feedback: { correct: spoken(`對了，是「${w.word}」。`), retry: spoken("再聽一次，每個字都要聽清楚。") },
    };
  });
}

// 語詞解釋：看語詞（有例句就帶例句）選意思；錯的選項用同課其他語詞的解釋，優先放一個有相同字的語詞。
function genWordMeaning({ cards, rng, count }) {
  const others = (w) => wordMeaningOthers(cards, w);
  const ready = wordMeaningPool(cards);
  return cycle(ready, count, rng).map((w) => {
    const mine = new Set([...w.word]);
    const pool = others(w).filter((x, i, a) => a.findIndex((y) => y.meaning.text === x.meaning.text) === i);
    const shared = pool.filter((x) => [...x.word].some((t) => mine.has(t)));
    const picked = [...take(shared, 1, rng)];
    picked.push(...take(pool.filter((x) => !picked.includes(x)), 2 - picked.length, rng));
    const distractors = picked.map((x) =>
      shared.includes(x)
        ? { text: structuredClone(x.meaning), misconception: "shared-char", feedback: `這是「${x.word}」的意思。「${x.word}」和「${w.word}」有一樣的字，但意思不同。` }
        : { text: structuredClone(x.meaning), feedback: `這是「${x.word}」的意思。` },
    );
    const prompt = w.example ? `「${w.example.text}」這句話裡的「${w.word}」是什麼意思？` : `「${w.word}」是什麼意思？`;
    return {
      type: "choice",
      cards: [w.id],
      ladder_ids: ladderOf(w),
      skill: "詞語理解",
      difficulty: 2,
      stem: { text: spoken(prompt) },
      ...taggedOptions({ text: structuredClone(w.meaning) }, distractors, rng),
      shuffle: false,
      hints: [spoken("把每個意思放進句子裡讀讀看。"), spoken(`想一想，在哪裡看過「${w.word}」？`), spoken(w.example ? `把「${w.word}」換成你選的意思，句子還通順嗎？` : `「${w.word}」的第一個字是「${[...w.word][0]}」，想想它的意思。`)],
      feedback: { correct: spoken(`對了，「${w.word}」是「${w.meaning.text}」的意思。`), retry: spoken("再把每個意思放進句子讀讀看。") },
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

// 課文練習：單元手寫的固定題，依序循環（每輪重新洗牌）；題目內容不變，只加追溯欄位。
function genReadingItems({ rng, count, items }) {
  return cycle(readingItems({ items }), count, rng).map((i) => structuredClone(i));
}

// 測驗藍圖（#50）：各分類的題數輪流分給該分類的來源活動，每個來源不超過它的題庫筆數（同一次測驗不重複）。
function allocate(sources, count, cap, rng) {
  const order = shuffle(sources, rng);
  const tally = Object.fromEntries(sources.map((s) => [s, 0]));
  let left = count;
  for (let moved = true; left > 0 && moved; ) {
    moved = false;
    for (const s of order) {
      if (left > 0 && tally[s] < cap[s]) {
        tally[s]++;
        left--;
        moved = true;
      }
    }
  }
  return tally;
}

function genBlueprintQuiz({ unit, cards, rng, seed, pools, blueprint, items, readings, audio }) {
  const ctx = { items, readings, audio };
  const made = [];
  for (const { group, count, sources } of blueprint) {
    const cap = Object.fromEntries(sources.map((s) => [s, REGISTRY[s].pool(cards, ctx)]));
    const tally = allocate(sources, count, cap, rng);
    for (const s of sources) {
      if (!tally[s]) continue;
      const sub = REGISTRY[s].generate({ unit, cards, rng: createRng(`${unit.id}|quiz|${group}|${s}|${seed}`), count: tally[s], seed: `${seed}|quiz`, pools, items, readings, audio });
      made.push(...sub.slice(0, tally[s]).map((q) => ({ ...q, quiz_source: s, quiz_group: group })));
    }
  }
  return shuffle(made, rng);
}

// 綜合小測驗：在可用的生題活動之間輪流抽，一題一個來源，順序再洗牌。
function genQuiz({ unit, cards, rng, count, seed, pools, blueprint, items, readings, audio }) {
  if (blueprint) return genBlueprintQuiz({ unit, cards, rng, seed, pools, blueprint, items, readings, audio });
  const sources = quizSources(cards);
  const plan = cycle(sources, count, rng);
  const tally = Object.fromEntries(sources.map((s) => [s, plan.filter((p) => p === s).length]));
  const made = [];
  for (const s of sources) {
    const def = REGISTRY[s];
    const sub = def.generate({ unit, cards, rng: createRng(`${unit.id}|quiz|${s}|${seed}`), count: tally[s], seed: `${seed}|quiz`, pools });
    made.push(...sub.slice(0, tally[s]).map((q) => ({ ...q, quiz_source: s })));
  }
  return shuffle(made, rng).slice(0, count);
}
