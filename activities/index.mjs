// 活動登錄表：依單元綁定的卡片（cards）與教材，排出一課的步驟（planSteps），並為練習／測驗生題。
// 生題是純函式：同一單元、同一組卡、同一個種子，永遠得到同樣的題目；題目實例形狀與固定題相同，
// 所以可以直接丟給 question-types 的 score()。實例不是內容檔，不存進內容包。
import { createRng } from "../generators/_prng.mjs";
import { instantiate, getGenerator } from "../generators/index.mjs";
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

// 認一認（#78）：聲調陷阱＝把一個非輕聲音節換成另一個聲調；不等於正解，也不等於同一個語詞其他卡上的讀音（破音詞）。
const TONE_MARKS = ["", "ˊ", "ˇ", "ˋ"];
function toneTraps(w, c) {
  const syl = normalizeZhuyin(w.zhuyin).split(" ");
  if (syl.length !== [...w.word].length) return [];
  const known = new Set(c.words.filter((x) => x.word === w.word).map((x) => normalizeZhuyin(x.zhuyin)));
  const out = [];
  syl.forEach((s, k) => {
    if (s.startsWith("˙")) return;
    const mark = "ˊˇˋ".includes(s.slice(-1)) ? s.slice(-1) : "";
    const body = mark ? s.slice(0, -1) : s;
    for (const t of TONE_MARKS) {
      if (t === mark) continue;
      const z = syl.map((x, i) => (i === k ? body + t : x)).join(" ");
      if (!known.has(z)) out.push({ zhuyin: z, at: k });
    }
  });
  return out;
}
const tonePickPool = (c) => c.words.filter((w) => toneTraps(w, c).length);

// 找一找（#78）：形近字取自生字卡 why: 形近 的易混淆字，再加 pack pools/ 裡 kind「形近字」、含這個字的池。
function lookalikeChars(ch, ctx) {
  const fromCard = (ch.confusables ?? []).filter((x) => x.why === "形近").map((x) => x.char);
  const fromPools = [...(ctx?.pools?.values?.() ?? [])].filter((p) => p?.kind === "形近字").map((p) => (p.entries ?? []).map((e) => e?.text?.text).filter((t) => typeof t === "string" && [...t].length === 1)).filter((list) => list.includes(ch.char)).flat();
  return [...new Set([...fromCard, ...fromPools])].filter((t) => t !== ch.char);
}
// 含這個字的語詞：先用生字卡 words 連到的，再用這課其他語詞；有例句的優先。
function wordsWithChar(ch, c) {
  const byId = new Map(c.words.map((w) => [w.id, w]));
  const linked = (ch.words ?? []).map((ref) => byId.get(ref)).filter((w) => w && w.word.includes(ch.char));
  const list = [...linked, ...c.words.filter((w) => w.word.includes(ch.char) && !linked.includes(w))];
  return [...list.filter((w) => w.example?.text.includes(w.word)), ...list.filter((w) => !w.example?.text.includes(w.word))];
}
const lookalikePool = (c, ctx) => c.chars.filter((ch) => lookalikeChars(ch, ctx).length >= 2 && wordsWithChar(ch, c).length);

// 寫一寫（#78）：每個「語詞＋其中一個生字」一題；同一個字在語詞裡出現幾次就挖空幾格（不然看得到答案）。
function writePairs(c) {
  const out = [];
  for (const w of c.words) {
    for (const ch of c.chars) {
      const at = [...w.word].flatMap((t, i) => (t === ch.char ? [i] : []));
      if (at.length && !out.some((p) => p.w === w && p.ch.char === ch.char)) out.push({ w, ch, at });
    }
  }
  return out;
}
// 課文資料（#51）：lesson 教材的段落（text 區塊依序是第 1、2…段）與段落大意 gist；心智圖節點。
const plainText = (t) => String(t ?? "").replace(/【([^|】]+)\|[^】]*】/g, "$1");
const materialsOf = (ctx) => (Array.isArray(ctx?.materials) ? ctx.materials : []);
// 自然段：text 區塊依序編號，前言（preface）不編號（#60）。
function paragraphs(ctx) {
  const lesson = materialsOf(ctx).find((m) => m.kind === "lesson");
  if (!lesson) return [];
  return (Array.isArray(lesson.blocks) ? lesson.blocks : []).filter((b) => b?.type === "text" && b.content && !b.preface).map((b, i) => ({ material: lesson.id, n: i + 1, text: plainText(b.content.text), gist: b.gist, span: Number.isInteger(b.gist_span) && b.gist_span > 1 ? b.gist_span : 1 }));
}
// 意義段：一句段落大意涵蓋 gist_span 個自然段（#60）；last 是最後一段的編號，text 是這幾段接起來。
function gistedParagraphs(ctx) {
  const list = paragraphs(ctx);
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p.gist?.text || seen.has(p.gist.text)) continue;
    seen.add(p.gist.text);
    const covered = list.filter((x) => x.n >= p.n && x.n < p.n + p.span);
    out.push({ material: p.material, n: p.n, last: covered.at(-1).n, text: covered.map((x) => x.text).join(""), gist: p.gist });
  }
  return out;
}
const paraRange = (u) => (u.n === u.last ? `第 ${u.n} 段` : `第 ${u.n} 到 ${u.last} 段`);
// 題幹引段落原文；太長（超過 120 字）就只引開頭一句，請學生回課文讀。
const PARA_QUOTE_MAX = 120;
function paraQuote(u) {
  if ([...u.text].length <= PARA_QUOTE_MAX) return `${paraRange(u)}：「${u.text}」`;
  const head = [...u.text.split(/(?<=[。！？])/u)[0]].slice(0, 30).join("");
  return `回到課文讀${paraRange(u)}（從「${head}」開始）。`;
}
const PARA_ORDER_MAX = 6;
function paraOrderChunks(ctx) {
  const list = gistedParagraphs(ctx);
  if (list.length < 3) return [];
  if (list.length <= 8) return [list];
  const chunks = [];
  for (let i = 0; i < list.length; i += PARA_ORDER_MAX) chunks.push(list.slice(i, i + PARA_ORDER_MAX));
  if (chunks.length > 1 && chunks.at(-1).length < 3) chunks.at(-2).push(...chunks.pop());
  return chunks.filter((c) => c.length >= 3 && c.length <= 8);
}
// 心智圖：攤平成 { node, parent, depth, path }；path 是從根算起的子節點索引，給追溯用。
function mindmapNodes(ctx) {
  const out = [];
  for (const m of materialsOf(ctx).filter((x) => x.kind === "mindmap")) {
    for (const [bi, b] of (Array.isArray(m.blocks) ? m.blocks : []).entries()) {
      if (b?.type !== "mindmap" || !b.root) continue;
      const walk = (node, parent, depth, path) => {
        out.push({ material: m.id, node, parent, depth, path });
        (node.children ?? []).forEach((c, i) => walk(c, node, depth + 1, [...path, i]));
      };
      walk(b.root, null, 0, [bi]);
    }
  }
  return out;
}
const nodeText = (n) => plainText(n.text.text);
const branchName = (n) => n.label ?? nodeText(n);
function mindmapPickTargets(ctx) {
  const all = mindmapNodes(ctx);
  return all.filter((x) => x.parent && (x.parent.children ?? []).length >= 2 && mindmapPickDistractors(x, all).length > 0);
}
function mindmapPickDistractors(target, all) {
  const siblings = new Set((target.parent.children ?? []).map(nodeText));
  const pool = all.filter((x) => x.parent && x.parent !== target.parent && !siblings.has(nodeText(x.node)) && x.node !== target.parent);
  const sameDepth = pool.filter((x) => x.depth === target.depth);
  return (sameDepth.length ? sameDepth : pool).filter((x, i, a) => a.findIndex((y) => nodeText(y.node) === nodeText(x.node)) === i);
}
const mindmapOrderTargets = (ctx) => mindmapNodes(ctx).filter((x) => x.node.ordered && (x.node.children ?? []).length >= 3 && x.node.children.length <= 8);

// 修辭例句（#51）：任何教材裡的 rhetoric 區塊。
/** 修辭類型：代碼 → 中文名與給學生的白話說明（schema 的 rhetoric_device）。 */
export const rhetoricDevices = Object.freeze({
  simile: Object.freeze({ label: "譬喻", definition: "用另一個相像的東西來比方，常會用到「像、好像、彷彿、是」" }),
  personification: Object.freeze({ label: "擬人", definition: "把東西當成人來寫，讓它有人的動作、說話或感情" }),
  hyperbole: Object.freeze({ label: "誇飾", definition: "故意說得比實際更大、更多或更誇張" }),
  repetition: Object.freeze({ label: "類疊", definition: "同一個字或語詞重複出現" }),
  parallelism: Object.freeze({ label: "排比", definition: "三句以上句型相似的句子，一句接一句排下來" }),
  "rhetorical-question": Object.freeze({ label: "設問", definition: "用問句來引起注意或讓人思考" }),
  quotation: Object.freeze({ label: "引用", definition: "借用別人說過的話、俗語或名言" }),
  sensory: Object.freeze({ label: "摹寫", definition: "把看到、聽到、聞到、嘗到或摸到的感覺寫出來" }),
  contrast: Object.freeze({ label: "映襯", definition: "把相反的兩件事放在一起比較" }),
  antithesis: Object.freeze({ label: "對偶", definition: "上下兩句字數相同、意思相對" }),
  climax: Object.freeze({ label: "層遞", definition: "一層一層往上或往下推進" }),
  anadiplosis: Object.freeze({ label: "頂真", definition: "前一句的結尾當下一句的開頭" }),
  exclamation: Object.freeze({ label: "感嘆", definition: "用感嘆的語氣表達強烈的感情" }),
});
// 常被混在一起的修辭：當錯的選項時優先放（最有鑑別力）。
const RHETORIC_CONFUSIONS = [["simile", "personification"], ["simile", "hyperbole"], ["repetition", "parallelism"], ["parallelism", "antithesis"], ["parallelism", "climax"], ["rhetorical-question", "exclamation"], ["sensory", "hyperbole"]];
function rhetoricExamples(ctx) {
  const out = [];
  for (const m of materialsOf(ctx)) {
    for (const [i, b] of (Array.isArray(m.blocks) ? m.blocks : []).entries()) {
      if (b?.type === "rhetoric" && b.text?.text && Array.isArray(b.devices) && b.devices.length && b.devices.every((d) => rhetoricDevices[d])) out.push({ material: m.id, index: i, text: b.text, devices: b.devices, note: b.note });
    }
  }
  return out;
}
const rhetoricLabel = (d) => rhetoricDevices[d].label;
function rhetoricDistractors(ex, pool, rng) {
  const own = new Set(ex.devices);
  const confused = RHETORIC_CONFUSIONS.filter((pair) => pair.includes(ex.devices[0])).map((pair) => pair.find((d) => d !== ex.devices[0])).filter((d) => !own.has(d));
  const learned = [...new Set(pool.flatMap((x) => x.devices))].filter((d) => !own.has(d) && !confused.includes(d));
  const others = Object.keys(rhetoricDevices).filter((d) => !own.has(d) && !confused.includes(d) && !learned.includes(d));
  return [...take(confused, 1, rng), ...shuffle(learned, rng), ...shuffle(confused, rng), ...shuffle(others, rng)].filter((d, i, a) => a.indexOf(d) === i).slice(0, 2);
}
// 分類題：只用一句一種修辭的例句。題庫是事先分好的幾組（每組 4 到 6 句、2 到 4 種修辭、組與組不重複），
// 和種子無關，所以題庫筆數固定，同一次測驗不會抽到同一組；種子只決定出題順序與句子排列。
function rhetoricSortSets(ctx) {
  const single = rhetoricExamples(ctx).filter((x) => x.devices.length === 1);
  const order = Object.keys(rhetoricDevices);
  const left = new Map();
  for (const x of single) left.set(x.devices[0], [...(left.get(x.devices[0]) ?? []), x]);
  const sets = [];
  for (;;) {
    const avail = [...left].filter(([, l]) => l.length).sort((a, b) => b[1].length - a[1].length || order.indexOf(a[0]) - order.indexOf(b[0])).map(([d]) => d);
    if (avail.length < 2) break;
    const first = avail[0];
    const partner = RHETORIC_CONFUSIONS.filter((p) => p.includes(first)).map((p) => p.find((d) => d !== first)).find((d) => avail.includes(d)) ?? avail.find((d) => d !== first);
    const chosen = [first, partner];
    const picked = new Map(chosen.map((d) => [d, []]));
    const total = () => [...picked.values()].reduce((n, l) => n + l.length, 0);
    const grab = (d, upto) => { while (picked.get(d).length < upto && left.get(d).length && total() < 6) picked.get(d).push(left.get(d).shift()); };
    for (const d of chosen) grab(d, 2);
    for (const d of chosen) if (total() < 4) grab(d, 3);
    // 每種修辭只有一兩句時再加一種，最多 4 種，湊到 4 句。
    while (total() < 4 && chosen.length < 4) {
      const more = avail.find((d) => !chosen.includes(d));
      if (!more) break;
      chosen.push(more);
      picked.set(more, []);
      grab(more, 3);
    }
    if (total() < 4) {
      for (const d of chosen) left.set(d, [...picked.get(d), ...left.get(d)]);
      break;
    }
    sets.push(chosen.map((d) => ({ device: d, examples: picked.get(d) })));
  }
  return sets;
}

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
  "wrong-paragraph": Object.freeze({ label: "段落重點張冠李戴", note: "把別段的重點當成這一段的" }),
  "wrong-branch": Object.freeze({ label: "心智圖分支放錯", note: "把別的分支的內容放到這一支" }),
  "rhetoric-mixup": Object.freeze({ label: "修辭類型混淆", note: "把這句的修辭認成另一種（看 detail 的 chosen 與 answer 是哪兩種）" }),
  "tone-mixup": Object.freeze({ label: "聲調混淆", note: "選了只差一個字聲調的讀音" }),
  "angle-by-ray-length": Object.freeze({ label: "看邊長判斷角的大小", note: "邊畫得長就以為角大、邊短就以為角小（題目故意讓小角配長邊、大角配短邊）" }),
  "angle-compare-reversed": Object.freeze({ label: "和直角比反了", note: "比直角小說成比直角大，或反過來" }),
  "angle-right-by-eye": Object.freeze({ label: "用眼睛估直角", note: "接近直角就說一樣大，或直角說成不一樣（沒有用直角板比）" }),
  "angle-right-orientation": Object.freeze({ label: "斜放就認不得直角", note: "直角轉了方向就說不是直角" }),
  "congruent-size-ignored": Object.freeze({ label: "只看形狀沒看大小", note: "選了形狀一樣但放大或縮小的三角形" }),
  "congruent-shape-by-eye": Object.freeze({ label: "形狀看起來像就以為全等", note: "選了改了一個邊或一個角的三角形" }),
  "correspondence-by-position": Object.freeze({ label: "照擺放位置找對應", note: "沒有把乙轉一轉，就照同一個位置找對應的邊或角" }),
  "triangle-equal-sides-miscount": Object.freeze({ label: "數錯一樣長的邊", note: "看等長記號數錯幾個邊一樣長（正三角形、等腰三角形、3 邊都不一樣長混淆）" }),
  "triangle-orientation": Object.freeze({ label: "轉了方向就認不得等腰三角形", note: "等腰三角形斜放或倒放就說 3 邊都不一樣長" }),
  "triangle-side-lengths-misread": Object.freeze({ label: "看錯邊長", note: "比較 3 個邊的公分數時看錯或數錯" }),
  "triangle-largest-angle-misjudged": Object.freeze({ label: "最大的角判斷錯", note: "銳角三角形與鈍角三角形混淆（沒有用直角板比最大的角）" }),
});

// 每個活動：預設段落、是否生題、在什麼條件下才出現（needs 回傳 null 表示可以，字串是不能的理由）。
// sound：考讀音或字形，報讀唸出來就洩漏答案（#66）；encounter: false：不進外殼的草原遭遇與小測驗（手寫題，#78）。
const REGISTRY = {
  read: { phase: "learn", needs: (c, m) => (hasMaterial(m, "lesson") || hasMaterial(m, "simplified") ? null : "沒有課文教材（lesson／simplified）") },
  mindmap: { phase: "learn", needs: (c, m) => (hasMaterial(m, "mindmap") ? null : "沒有心智圖教材（mindmap）") },
  demo: { phase: "learn", needs: (c, m) => (hasMaterial(m, "demo") ? null : "沒有示範教材（demo）") },
  "char-cards": { phase: "practice", group: "char", needs: (c) => (c.chars.length ? null : "沒有綁生字卡") },
  "word-cards": { phase: "practice", group: "word", needs: (c) => (c.words.length ? null : "沒有綁語詞卡") },
  manipulate: { phase: "practice", group: "skill", needs: (c) => (c.skills.some((s) => s.manipulative) ? null : "綁的技能卡沒有教具設定") },
  "char-pick": { phase: "practice", group: "char", count: 4, readAloud: "stem", sound: true, pool: (c) => c.chars.length, generate: genCharPick, needs: (c) => (charPickable(c) ? null : "生字卡少於 2 張，而且卡上沒有易混淆字，湊不出選項") },
  "word-match": { phase: "practice", group: "word", heavy: true, count: 1, readAloud: "stem", pool: (c) => Math.ceil(c.words.length / 4), generate: genWordMatch, needs: (c) => (c.words.length >= 2 ? null : "綁的語詞卡少於 2 張") },
  "word-cloze": { phase: "practice", group: "word", count: 4, readAloud: "stem", pool: (c) => wordsWithExample(c).length, generate: genWordCloze, needs: (c) => (wordsWithExample(c).length && c.words.length >= 2 ? null : "沒有含例句的語詞卡，或語詞卡少於 2 張") },
  "listen-char": { phase: "practice", group: "char", count: 4, readAloud: "stem", sound: true, pool: (c, ctx) => listenCharPool(c, ctx).length, generate: genListenChar, needs: (c, m, ctx) => (c.chars.some((ch) => listenCharReady(ch, c, mergeReadings(readingsFromCards(allBound(c)), ctx?.readings))) ? null : "湊不出和生字不同音的干擾字（易混淆字要填 zhuyin，或多綁幾張生字卡）") },
  "listen-word": { phase: "practice", group: "word", count: 4, readAloud: "stem", sound: true, pool: (c, ctx) => listenWordPool(c, ctx).length, generate: genListenWord, needs: (c) => (listenWordReady(c) ? null : "綁的語詞卡少於 2 張，或語詞全都同音") },
  "tone-pick": { phase: "practice", group: "char", count: 4, readAloud: "stem", sound: true, pool: (c) => tonePickPool(c).length, generate: genTonePick, needs: (c) => (!c.words.length ? "沒有綁語詞卡" : tonePickPool(c).length ? null : "語詞卡的注音和字數對不上，或全是輕聲，做不出聲調陷阱（回語詞卡補正 zhuyin）") },
  "char-lookalike": { phase: "practice", group: "char", count: 4, readAloud: "stem", sound: true, pool: (c, ctx) => lookalikePool(c, ctx).length, generate: genCharLookalike, needs: (c, m, ctx) => (lookalikePool(c, ctx).length ? null : "沒有生字湊得出 2 個形近字，或這課沒有含這個字的語詞卡（回生字卡 confusables 補 why: 形近 的字，或在 pack pools/ 加 kind「形近字」的池；語詞卡補 example）") },
  "char-trace": { phase: "practice", group: "char", count: "all", readAloud: "all", encounter: false, pool: (c) => c.chars.length, generate: genCharTrace, needs: (c) => (c.chars.length ? null : "沒有綁生字卡") },
  "char-write": { phase: "practice", group: "char", count: "all", readAloud: "all", encounter: false, pool: (c) => writePairs(c).length, generate: genCharWrite, needs: (c) => (writePairs(c).length ? null : "語詞卡裡沒有這課的生字（回單元 bindings 綁含生字的語詞卡）") },
  "word-meaning": { phase: "practice", group: "word", count: 4, readAloud: "all", pool: (c) => wordMeaningPool(c).length, generate: genWordMeaning, needs: (c) => (wordMeaningReady(c) ? null : "綁的語詞卡少於 2 張，或解釋全都相同") },
  "sentence-order": { phase: "practice", group: "word", count: 2, readAloud: "all", pool: (c) => c.patterns.reduce((n, p) => n + p.examples.length, 0), generate: genSentenceOrder, needs: (c) => (c.patterns.length ? null : "沒有綁句型卡") },
  "skill-practice": { phase: "practice", group: "skill", count: 5, readAloud: "stem", generate: genSkillPractice, needs: (c) => (c.skills.length ? null : "沒有綁技能卡") },
  "para-gist": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => gistedParagraphs(ctx).length, generate: genParaGist, needs: (c, m, ctx) => (gistedParagraphs({ ...ctx, materials: ctx?.materials ?? m }).length >= 2 ? null : "課文教材（lesson）填了段落大意 gist 的段落少於 2 段") },
  "para-order": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => paraOrderChunks(ctx).length, generate: genParaOrder, needs: (c, m, ctx) => (paraOrderChunks({ ...ctx, materials: ctx?.materials ?? m }).length ? null : "課文教材（lesson）填了段落大意 gist 的段落少於 3 段") },
  "mindmap-pick": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => mindmapPickTargets(ctx).length, generate: genMindmapPick, needs: (c, m, ctx) => (mindmapPickTargets({ ...ctx, materials: ctx?.materials ?? m }).length ? null : "心智圖教材沒有兩個以上分支可以出題") },
  "mindmap-order": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => mindmapOrderTargets(ctx).length, generate: genMindmapOrder, needs: (c, m, ctx) => (mindmapOrderTargets({ ...ctx, materials: ctx?.materials ?? m }).length ? null : "心智圖沒有標 ordered、子節點 3 到 8 個的節點") },
  "rhetoric-pick": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => rhetoricExamples(ctx).length, generate: genRhetoricPick, needs: (c, m, ctx) => (rhetoricExamples({ ...ctx, materials: ctx?.materials ?? m }).length ? null : "教材裡沒有修辭例句（rhetoric 區塊）") },
  "rhetoric-sort": { phase: "practice", group: "reading", count: "all", readAloud: "all", pool: (c, ctx) => rhetoricSortSets(ctx).length, generate: genRhetoricSort, needs: (c, m, ctx) => (rhetoricSortSets({ ...ctx, materials: ctx?.materials ?? m }).length ? null : "一句一種修辭的例句湊不出一組（至少 4 句、2 種修辭）") },
  mix: { phase: "practice", count: "all", generate: genMix, needs: () => null },
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
 * 活動的屬性，給殼直接查（不必自己認活動名稱）：phase、group、generates、read_aloud_scope（預設報讀範圍）、
 * sound（考讀音或字形，#66）、encounter（false＝不進草原遭遇與小測驗，#78）。
 */
export const activityMeta = Object.freeze(Object.fromEntries(Object.entries(REGISTRY).map(([id, d]) => [id, Object.freeze({
  phase: d.phase,
  ...(d.group ? { group: d.group } : {}),
  generates: Boolean(d.generate),
  ...(d.readAloud ? { read_aloud_scope: d.readAloud } : {}),
  sound: Boolean(d.sound),
  encounter: d.encounter !== false,
})])));

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
export function planSteps({ unit, cards, materials = [], profile = null, items, readings, groups, pools } = {}) {
  const chosen = Array.isArray(unit.activities) ? null : profile ?? (unit.activity_profile ? profiles[unit.activity_profile] : profileFor(unit.subject, unit.grade));
  // 單元自己寫 activities 時，能力階梯對照仍用該科該年級的年級設定（再被單元 ladders 覆寫）。
  const ladderProfile = chosen ?? (unit.activity_profile ? profiles[unit.activity_profile] : profileFor(unit.subject, unit.grade));
  const ladders = resolveLadders({ unit, profile: ladderProfile });
  const source = Array.isArray(unit.activities) ? unit.activities : chosen?.steps ?? [];
  const ctx = { items, readings, materials, pools };
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
    if (step.blueprint && step.activity !== "quiz") {
      skipped.push({ activity: step.activity, reason: "只有 quiz 可以寫 blueprint", config: true });
      continue;
    }
    if (step.count === "all" && !def.pool && step.activity !== "mix") {
      skipped.push({ activity: step.activity, reason: "這個活動不支援 count \"all\"", config: true });
      continue;
    }
    let group = def.group;
    let sources;
    let sourcesSkipped = [];
    if (step.activity === "mix") {
      // 混合練習（#51）：sources 要是同一分類、會算題庫的活動；條件不足的來源略過並記下理由。
      ({ group, sources, skipped: sourcesSkipped } = resolveMix(step, cards, materials, ctx));
      if (!sources.length) {
        skipped.push({ activity: step.activity, reason: sourcesSkipped.map((x) => `${x.activity}：${x.reason}`).join("；") || "沒有可以混合的活動", ...(sourcesSkipped.some((x) => x.config) ? { config: true } : {}) });
        continue;
      }
    }
    if (wanted && group && !wanted.has(group)) {
      skipped.push({ activity: step.activity, reason: `這次沒有指派「${group}」分類` });
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
    } else if (step.activity !== "mix") {
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
      ...(group ? { group } : {}),
      generates: Boolean(def.generate),
      ...(sources ? { sources } : {}),
      ...(sourcesSkipped.length ? { sources_skipped: sourcesSkipped } : {}),
      ...(def.generate ? { count } : {}),
      ...(blueprint ? { blueprint } : {}),
      ...(blueprintSkipped.length ? { blueprint_skipped: blueprintSkipped } : {}),
      ...(def.generate && (step.read_aloud_scope ?? def.readAloud) ? { read_aloud_scope: step.read_aloud_scope ?? def.readAloud } : {}),
      ...(ladders[step.activity] ? { ladder_ids: ladders[step.activity] } : {}),
      // 不進草原遭遇（手寫題，#78）：混合練習的來源全是這種時，整步標 false。
      ...((sources ? sources.every((s) => REGISTRY[s].encounter === false) : def.encounter === false) ? { encounter: false } : {}),
      ...(step.optional ? { optional: true } : {}),
    });
  }
  return { profile: Array.isArray(unit.activities) ? null : chosen?.id ?? null, ladder_status: ladderProfile?.ladder_status ?? null, ladders, steps, skipped };
}

function resolveMix(step, cards, materials, ctx) {
  const sources = [];
  const skipped = [];
  const groups = new Set();
  for (const s of step.sources ?? []) {
    const d = REGISTRY[s];
    if (!d?.pool || s === "mix" || s === "quiz") {
      skipped.push({ activity: s, reason: "不能放進混合練習（要是會算題庫的練習活動）", config: true });
      continue;
    }
    groups.add(d.group);
    const reason = d.needs(cards, materials, ctx);
    if (reason) skipped.push({ activity: s, reason });
    else sources.push(s);
  }
  if (groups.size > 1) return { group: null, sources: [], skipped: [{ activity: "mix", reason: `sources 要是同一分類，這裡混了 ${[...groups].join("、")}`, config: true }] };
  return { group: [...groups][0] ?? null, sources, skipped };
}

// 藍圖的每個分類 → 前面練習步驟裡同分類、會算題庫的活動（混合練習展開成它的來源）；沒有來源的分類略過並說明。
function resolveBlueprint(entries, steps, wanted) {
  const blueprint = [];
  const skipped = [];
  for (const { group, count } of entries) {
    if (wanted && !wanted.has(group)) continue;
    // 手寫題（encounter: false）不進測驗（#78）。
    const all = [...new Set(steps.filter((x) => x.generates && x.group === group && x.activity !== "quiz").flatMap((x) => (x.activity === "mix" ? x.sources : [x.activity])).filter((a) => REGISTRY[a]?.pool && REGISTRY[a].encounter !== false))];
    // 一題就是一整組的活動（語詞配對）放進測驗太重：同分類有別的來源就不用它（#58）。
    const light = all.filter((a) => !REGISTRY[a].heavy);
    const sources = light.length ? light : all;
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
 *   items：單元的手寫題（課文練習）；materials：單元的教材（段落大意、心智圖、修辭例句）。
 *   blueprint：quiz 用，照 planSteps 的 step.blueprint；sources：mix 用，照 planSteps 的 step.sources。
 *   重現一批題目要同樣的 unit、cards、seed、count，以及 blueprint／sources／items／materials（#58）。
 * @returns {object[]} 題目實例（kind: "instance"）。
 */
export function generate(activity, { unit, cards: allCards, seed, count, pools, ladders = {}, readAloud, coreOnly = false, readings, audio, items, blueprint, materials, sources } = {}) {
  const def = REGISTRY[activity];
  if (!def?.generate) throw new TypeError(`generate: ${JSON.stringify(activity)} 不是會生題的活動`);
  if (seed === undefined || seed === null || seed === "") throw new TypeError("generate: 需要 seed，作答事件才能重現這批題目");
  let cards = allCards;
  if (coreOnly) {
    cards = coreCards(unit, allCards);
    if (!cards) throw new TypeError(`generate(${activity}): 單元 ${unit.id} 沒有標核心卡（core）`);
  }
  const ctx = { readings, audio, items, materials, pools };
  if (blueprint !== undefined && activity !== "quiz") throw new TypeError(`generate(${activity}): 只有 quiz 收 blueprint`);
  if (blueprint !== undefined) checkBlueprint(blueprint);
  else if (activity === "mix") sources = usableMixSources(sources, cards, ctx);
  else {
    const reason = def.needs(cards, [], ctx);
    if (reason) throw new TypeError(`generate(${activity}): ${reason}`);
  }
  let n = blueprint ? blueprint.reduce((t, b) => t + b.count, 0) : count ?? def.count;
  if (n === "all") {
    if (activity === "mix") n = sources.reduce((t, s) => t + REGISTRY[s].pool(cards, ctx), 0);
    else if (!def.pool) throw new TypeError(`generate(${activity}): 不支援 count "all"`);
    else n = def.pool(cards, ctx);
  }
  if (!Number.isInteger(n) || n < 1) throw new TypeError("generate: count 必須是 ≥ 1 的整數或 \"all\"");
  const rng = createRng(`${unit.id}|${activity}|${seed}`);
  const parts = def.generate({ unit, cards, rng, count: n, seed: String(seed), pools, readings, audio, items, blueprint, materials, sources });
  return parts.map((part, index) => finish(part, { unit, activity, seed: String(seed), index, ladders, readAloud }));
}

/**
 * 依 practice_key 清單重產題目（#78，練習場「只練錯題」用）：每個 key 重產它那一題，順序照清單，重複的 key 只出一次。
 * 選項與干擾項照這次的 seed 重新抽，題目身分（同一個語詞、同一個生字、同一段課文）不變；技能練習是同一張技能卡的新題。
 * 卡片或教材已不在這個單元、條件不足出不了題的 key 放進 missing 並寫理由，不丟錯。
 * @param {string[]} keys 題目實例的 practice_key。
 * @param {object} ctx 同 generate()：unit、cards、seed（必填），以及 pools、ladders、readAloud、readings、audio、items、materials。
 * @returns {{ instances: object[], missing: { key: string, reason: string }[] }}
 */
export function generateByKeys(keys, { unit, cards, seed, pools, ladders = {}, readAloud, readings, audio, items, materials } = {}) {
  if (!Array.isArray(keys)) throw new TypeError("generateByKeys: keys 要是 practice_key 陣列");
  if (seed === undefined || seed === null || seed === "") throw new TypeError("generateByKeys: 需要 seed，作答事件才能重現這批題目");
  const ctx = { readings, audio, items, materials, pools };
  const args = { unit, cards, seed: String(seed), pools, readings, audio, items, materials };
  const built = new Map();
  // 一個活動整個題庫生一次（count = 題庫筆數，每筆剛好一題），再依 key 取。
  const all = (activity) => {
    if (!built.has(activity)) {
      const def = REGISTRY[activity];
      let parts = [];
      const n = def.needs(cards, materials ?? [], ctx) ? 0 : def.pool(cards, ctx);
      if (n > 0) parts = def.generate({ ...args, rng: createRng(`${unit.id}|${activity}|${seed}`), count: n });
      built.set(activity, new Map(parts.map((p) => [practiceKey(p, activity), p])));
    }
    return built.get(activity);
  };
  const instances = [];
  const missing = [];
  // 語詞配對的卡片 id 不論順序（產生的 key 一律排序過）。
  const canonical = (k) => (String(k).startsWith("word-match|") ? `word-match|${String(k).slice(11).split(",").sort().join(",")}` : String(k));
  for (const key of [...new Set(keys.map(canonical))]) {
    const [activity, ids = ""] = key.split("|");
    const def = REGISTRY[activity];
    let part;
    if (!def?.generate || activity === "mix" || activity === "quiz") {
      missing.push({ key, reason: `${activity} 不是可以重產單題的活動` });
      continue;
    }
    if (activity === "word-match" || activity === "skill-practice") {
      // 這兩種沒有逐筆的題庫：用 key 裡的卡直接出一題。
      const group = activity === "word-match" ? "words" : "skills";
      const picked = ids.split(",").map((id) => cards[group].find((c) => c.id === id));
      if (picked.every(Boolean) && picked.length >= (activity === "word-match" ? 2 : 1) && picked.length <= 4) {
        part = def.generate({ ...args, cards: { ...cards, [group]: picked }, rng: createRng(`${unit.id}|${key}|${seed}`), count: 1 })[0];
      }
    } else {
      part = all(activity).get(key);
    }
    if (part && practiceKey(part, activity) === key) instances.push(finish(part, { unit, activity, seed: String(seed), index: instances.length, ladders, readAloud }));
    else missing.push({ key, reason: "這一題出不來：卡片或教材已不在這個單元，或條件不足" });
  }
  return { instances, missing };
}

// 混合練習的來源：設定錯誤丟錯；條件不足的來源略過（例如只用核心卡時湊不出選字題，#58），全部都不行才丟錯。
function usableMixSources(sources, cards, ctx) {
  if (!Array.isArray(sources) || !sources.length) throw new TypeError("generate(mix): 需要 sources（planSteps 回傳的 step.sources）");
  const groups = new Set();
  const usable = [];
  const reasons = [];
  for (const s of sources) {
    if (!REGISTRY[s]?.pool || s === "mix" || s === "quiz") throw new TypeError(`generate(mix): ${s} 不能放進混合練習`);
    groups.add(REGISTRY[s].group);
    const reason = REGISTRY[s].needs(cards, ctx.materials ?? [], ctx);
    if (reason) reasons.push(`${s}：${reason}`);
    else usable.push(s);
  }
  if (groups.size > 1) throw new TypeError("generate(mix): sources 要是同一分類");
  if (!usable.length) throw new TypeError(`generate(mix): 來源都湊不出題（${reasons.join("；")}）`);
  return usable;
}

function checkBlueprint(blueprint) {
  if (!Array.isArray(blueprint) || !blueprint.length) throw new TypeError("generate(quiz): blueprint 要是非空陣列（planSteps 回傳的 step.blueprint）");
  for (const b of blueprint) {
    if (!Number.isInteger(b?.count) || b.count < 1) throw new TypeError("generate(quiz): blueprint 每一項的 count 要是 ≥ 1 的整數");
    if (!Array.isArray(b.sources) || !b.sources.length) throw new TypeError(`generate(quiz): blueprint「${b.group}」沒有 sources`);
    for (const s of b.sources) if (!REGISTRY[s]?.pool || REGISTRY[s].group !== b.group || REGISTRY[s].encounter === false) throw new TypeError(`generate(quiz): ${s} 不是「${b.group}」分類、可以算題庫、可以進測驗的活動`);
  }
}

/**
 * 題目的穩定身分（#78）：`<活動>|<來源 id>|<變體>`，不隨種子變；平台用它組錯題本，再用 generateByKeys 重產同一題。
 * 來源 id：卡片 id（多張用逗號接）、課文題的教材 id、手寫課文題的題目 id；變體只在同一組來源出得了不同題時才有。
 */
function practiceKey(part, source) {
  if (part.kind === "fixed") return `${source}|${part.id}`;
  if (part.material) return `${source}|${part.material}|${part.anchor}`;
  // 語詞配對每次抽的幾張卡不同，排序後才穩定。
  const ids = source === "word-match" ? [...part.cards].sort() : part.cards;
  return [source, ids.join(","), ...(part.__variant !== undefined ? [part.__variant] : [])].join("|");
}

function finish(part, { unit, activity, seed, index, ladders, readAloud }) {
  const source = part.mix_source ?? part.quiz_source ?? activity;
  const scope = readAloud ?? REGISTRY[source]?.readAloud ?? "all";
  const sound = Boolean(REGISTRY[source]?.sound);
  const practice_key = practiceKey(part, source);
  if (part.kind === "instance" && part.generator) {
    // 技能練習沿用數學產生器的實例（能力階梯由技能卡與條件檔決定），只補活動追溯欄位與報讀範圍。
    return { ...part, activity, activity_version: ACTIVITIES_VERSION, unit: unit.id, practice_key, read_aloud_scope: scope, sound };
  }
  if (part.kind === "fixed") {
    // 課文題（#50）：題目照抄手寫題，id 不變（報表照題目統計）；報讀範圍與讀音標記以題目自己標的為先。
    const { kind, ...item } = part;
    return { ...item, kind: "instance", source: "items", item: item.id, activity, activity_version: ACTIVITIES_VERSION, seed, index, unit: unit.id, practice_key, read_aloud_scope: readAloud ?? item.read_aloud_scope ?? scope, sound: item.sound === true };
  }
  // 能力階梯優先序：活動 × 年級對照 → 卡片自己標的 → 單元的。
  const { cards: used, ladder_ids: cardLadders, __variant, ...rest } = part;
  const ladder_ids = ladders[source]?.length ? ladders[source] : cardLadders;
  return {
    kind: "instance",
    id: `${unit.id}-${activity}#${index}`,
    source: part.material ? "materials" : "cards",
    activity,
    activity_version: ACTIVITIES_VERSION,
    seed,
    index,
    unit: unit.id,
    cards: used,
    practice_key,
    ...(ladder_ids?.length ? { ladder_ids } : unit.ladder_ids?.length ? { ladder_ids: [...unit.ladder_ids] } : {}),
    ...(unit.curriculum_codes?.length ? { curriculum_codes: [...unit.curriculum_codes] } : {}),
    read_aloud_scope: scope,
    sound,
    ...rest,
  };
}

/**
 * 把卡片生出的題目實例轉成固定題形狀（給 item schema 驗證）。只拿掉追溯欄位，題目內容不變。
 */
export function toItemShape(instance, { id = "x-check" } = {}) {
  if (instance.generator) throw new TypeError("toItemShape: 數學產生器的實例請用 generators/instance.schema.json 驗證");
  const { kind, id: _id, source, activity, activity_version, seed, index, cards, unit, quiz_source, quiz_group, mix_source, item, material, anchor, practice_key, ...rest } = instance;
  return { format_version: 1, id, unit: unit ?? "x-unit", kind: "fixed", ...rest };
}

/** 數學產生器實例去掉活動追溯欄位，回到 generators/instance.schema.json 的形狀。 */
export function toInstanceShape(instance) {
  const { cards, activity, activity_version, quiz_source, quiz_group, mix_source, practice_key, sound, ...rest } = instance;
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
    case "handwrite":
      return { chars: [...instance.target].map((char) => ({ char, completed: true, mistakes: 0, helped: false })) };
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

// ---------- 課文資料生題（#51） ----------
// 段落大意：第 N 段在說什麼；錯的選項用別段的大意，一個取最近的段（最容易混），一個隨機。
function genParaGist({ rng, count, materials }) {
  const list = gistedParagraphs({ materials });
  return cycle(list, count, rng).map((p) => {
    const others = list.filter((x) => x.n !== p.n);
    const near = [...others].sort((a, b) => Math.abs(a.n - p.n) - Math.abs(b.n - p.n) || a.n - b.n)[0];
    const rest = shuffle(others.filter((x) => x !== near), rng);
    const many = p.n !== p.last;
    const distractors = [near, ...rest].slice(0, 2).map((x) => ({ text: structuredClone(x.gist), misconception: "wrong-paragraph", feedback: `這是${paraRange(x)}的重點。再讀一次${paraRange(p)}。` }));
    return {
      type: "choice",
      cards: [],
      material: p.material,
      anchor: many ? `p${p.n}-p${p.last}` : `p${p.n}`,
      skill: "段落大意",
      difficulty: 2,
      stem: { text: spoken(`${paraQuote(p)}${many ? "這幾段" : "這一段"}主要在說什麼？`) },
      ...taggedOptions({ text: structuredClone(p.gist) }, distractors, rng),
      shuffle: false,
      hints: [spoken(`先找${many ? "這幾段" : "這一段"}一直提到的人、事、物。`), spoken(`想一想：${many ? "這幾段" : "這一段"}發生了什麼事，或作者說了什麼想法？`), spoken(`正確的選項開頭是「${[...p.gist.text].slice(0, 4).join("")}」。`)],
      feedback: { correct: spoken(`對了，${paraRange(p)}主要在說：${p.gist.text}`), retry: spoken(`再讀一次${paraRange(p)}，找出最重要的那件事。`) },
    };
  });
}

// 段落排序：把段落大意照課文順序排好（超過 8 段時切成幾組連續的段落）。
function genParaOrder({ rng, count, materials }) {
  return cycle(paraOrderChunks({ materials }), count, rng).map((chunk) => ({
    type: "ordering",
    cards: [],
    material: chunk[0].material,
    anchor: `p${chunk[0].n}-p${chunk.at(-1).last}`,
    skill: "文章結構",
    difficulty: 2,
    stem: { text: spoken(chunk[0].n === 1 && chunk.length === gistedParagraphs({ materials }).length ? "把段落大意照課文的順序排好。" : `把第 ${chunk[0].n} 到第 ${chunk.at(-1).last} 段的大意照順序排好。`) },
    sequence: chunk.map((x, i) => ({ id: `s${i + 1}`, text: structuredClone(x.gist) })),
    hints: [spoken("先想課文一開始在說什麼。"), spoken("想一想事情發生的先後，或作者先說什麼、再說什麼。"), spoken(`第一個是「${chunk[0].gist.text}」。`)],
    feedback: { correct: spoken("排對了！課文就是照這個順序寫的。"), retry: spoken("回到課文，一段一段對對看。") },
  }));
}

// 心智圖挖空：這一支除了已經有的，還少了哪一個；錯的選項用別的分支（同一層優先）的內容。
function genMindmapPick({ rng, count, materials }) {
  const all = mindmapNodes({ materials });
  return cycle(mindmapPickTargets({ materials }), count, rng).map((t) => {
    const shown = t.parent.children.filter((c) => c !== t.node).map(nodeText);
    const distractors = take(mindmapPickDistractors(t, all), 2, rng).map((x) => ({ text: structuredClone(x.node.text), misconception: "wrong-branch", feedback: `「${nodeText(x.node)}」是「${branchName(x.parent)}」那一支的內容。` }));
    return {
      type: "choice",
      cards: [],
      material: t.material,
      anchor: `n${t.path.join(".")}`,
      skill: "內容結構",
      difficulty: 2,
      stem: { text: spoken(t.depth === 1 ? `心智圖「${branchName(t.parent)}」的主要分支有：${shown.join("、")}。還少了哪一支？` : `心智圖「${branchName(t.parent)}」這一支有：${shown.join("、")}。還少了哪一個？`) },
      ...taggedOptions({ text: structuredClone(t.node.text) }, distractors, rng),
      shuffle: false,
      hints: [spoken("先想一想「" + branchName(t.parent) + "」這一支在說什麼。"), spoken("哪一個選項和這一支已經有的內容是同一類？"), spoken(`答案和「${shown[0]}」放在同一支。`)],
      feedback: { correct: spoken(`對了，「${nodeText(t.node)}」屬於「${branchName(t.parent)}」。`), retry: spoken("回到心智圖，看看每一支在說什麼。") },
    };
  });
}

// 心智圖排序：標了 ordered 的節點，把它的子節點照順序排好（例如做事的步驟）。
function genMindmapOrder({ rng, count, materials }) {
  return cycle(mindmapOrderTargets({ materials }), count, rng).map((t) => ({
    type: "ordering",
    cards: [],
    material: t.material,
    anchor: `n${t.path.join(".")}`,
    skill: "內容結構",
    difficulty: 2,
    stem: { text: spoken(`「${branchName(t.node)}」照先後順序排好。`) },
    sequence: t.node.children.map((c, i) => ({ id: `s${i + 1}`, text: structuredClone(c.text) })),
    hints: [spoken("先找最早發生的那一個。"), spoken("想一想：哪一步要先做完，下一步才能做？"), spoken(`第一個是「${nodeText(t.node.children[0])}」。`)],
    feedback: { correct: spoken("排對了！"), retry: spoken("回到課文或心智圖，照發生的先後再排一次。") },
  }));
}

// 修辭選擇：這句用了哪一種修辭；錯的選項先放一個常混淆的，再用這課學過的修辭。
function genRhetoricPick({ rng, count, materials }) {
  const pool = rhetoricExamples({ materials });
  return cycle(pool, count, rng).map((ex) => {
    const answer = ex.devices[0];
    const distractors = rhetoricDistractors(ex, pool, rng).map((d) => ({ text: spoken(rhetoricLabel(d)), misconception: "rhetoric-mixup", feedback: `「${rhetoricLabel(d)}」是${rhetoricDevices[d].definition}。再讀一次這句，看看有沒有這樣寫？` }));
    return {
      type: "choice",
      cards: [],
      material: ex.material,
      anchor: `b${ex.index}`,
      skill: "修辭",
      difficulty: 2,
      stem: { text: spoken(`「${plainText(ex.text.text)}」這句用了哪一種修辭？`) },
      ...taggedOptions({ text: spoken(rhetoricLabel(answer)) }, distractors, rng),
      shuffle: false,
      hints: [spoken("先想一想：這句是在比方、在問問題、在重複，還是把東西當成人來寫？"), spoken("把每個選項的意思想一遍，再對照這句話。"), spoken(ex.note?.text ? `提示：${ex.note.text}` : `這種修辭是：${rhetoricDevices[answer].definition}。`)],
      feedback: { correct: spoken(`對了，是「${rhetoricLabel(answer)}」。${ex.note?.text ?? rhetoricDevices[answer].definition}`), retry: spoken("再讀一次這句，想想它是怎麼寫的。") },
    };
  });
}

// 修辭分類：把一組 4 到 6 句分到 2 到 4 種修辭（組別見 rhetoricSortSets，常混淆的優先放在同一組）。
function genRhetoricSort({ rng, count, materials }) {
  return cycle(rhetoricSortSets({ materials }), count, rng).map((set) => {
    const picked = set.flatMap(({ device, examples }) => examples.map((x) => ({ ...x, device })));
    return {
      type: "classify",
      cards: [],
      material: picked[0].material,
      anchor: picked.map((x) => `${x.material}#b${x.index}`).join(","),
      skill: "修辭",
      difficulty: 2,
      stem: { text: spoken("把每一句放到它用的修辭。") },
      bins: set.map(({ device }) => ({ id: device, label: spoken(rhetoricLabel(device)) })),
      objects: shuffle(picked, rng).map((x, i) => ({ id: `o${i + 1}`, text: spoken(plainText(x.text.text)), bin: x.device })),
      hints: [spoken("一句一句讀，先放你最有把握的。"), spoken(set.map(({ device }) => `${rhetoricLabel(device)}：${rhetoricDevices[device].definition}`).join("；")), spoken(`「${plainText(picked[0].text.text)}」是${rhetoricLabel(picked[0].device)}。`)],
      feedback: { correct: spoken("全部分對了！"), retry: spoken("有一句放錯了，再對照每種修辭的意思。") },
    };
  });
}

// 混合練習（#51）：一步裡混合同分類的幾個活動，依 sources 的順序一段一段出（同一種題型放在一起）；
// count "all" 是各來源題庫加總，每筆輪到一次；給數字時輪流分給各來源，不超過各自的題庫。
function genMix({ unit, cards, rng, count, seed, pools, sources, items, readings, audio, materials }) {
  const ctx = { items, readings, audio, materials, pools };
  const cap = Object.fromEntries(sources.map((s) => [s, REGISTRY[s].pool(cards, ctx)]));
  const tally = allocate(sources, count, cap, rng);
  const made = [];
  for (const s of sources) {
    if (!tally[s]) continue;
    const sub = REGISTRY[s].generate({ unit, cards, rng: createRng(`${unit.id}|mix|${s}|${seed}`), count: tally[s], seed: `${seed}|mix`, pools, items, readings, audio, materials });
    made.push(...sub.slice(0, tally[s]).map((q) => ({ ...q, mix_source: s })));
  }
  return made;
}

// ---------- 生題 ----------
function genCharPick({ cards, rng, count }) {
  const words = new Map(cards.words.map((w) => [w.id, w]));
  return cycle(cards.chars, count, rng).map((ch) => {
    const fromCard = confusableChars(ch);
    const fromLesson = [...new Set(cards.chars.map((c) => c.char))].filter((c) => c !== ch.char && !fromCard.includes(c));
    const distractors = [...take(fromCard, 2, rng), ...take(fromLesson, 2, rng)].slice(0, 2);
    const example = (ch.words ?? []).map((ref) => words.get(ref)).find((w) => w && w.word.includes(ch.char));
    const prompt = example ? `「${example.word.replaceAll(ch.char, "○")}」的○，注音是「${ch.zhuyin}」，是哪一個字？` : `注音「${ch.zhuyin}」，意思是「${ch.meaning.text}」，是哪一個字？`;
    // 報讀用題幹（#66）：不唸注音與例詞，免得變成聽音選字。
    const say = example ? "看注音和語詞，選出空格裡的字。" : `看注音，選出意思是「${ch.meaning.text}」的字。`;
    return {
      type: "choice",
      cards: [ch.id],
      ladder_ids: ladderOf(ch),
      skill: "識字",
      difficulty: 1,
      stem: { text: spoken(prompt), say_text: spoken(say) },
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

// 認一認（#78）：看語詞（不帶注音）選注音。錯的選項先放一個聲調陷阱，再放一個同課其他語詞的注音（同字數優先），
// 沒有別的語詞時放第二個聲調陷阱。考讀音：報讀只唸 say_text，不唸目標語詞與選項，殼也不在題幹加注音。
function genTonePick({ cards, rng, count }) {
  return cycle(tonePickPool(cards), count, rng).map((w) => {
    const answer = normalizeZhuyin(w.zhuyin);
    const syl = answer.split(" ");
    const traps = shuffle(toneTraps(w, cards), rng);
    const len = [...w.word].length;
    const others = [...shuffle(cards.words.filter((x) => x.word !== w.word && [...x.word].length === len), rng), ...shuffle(cards.words.filter((x) => x.word !== w.word && [...x.word].length !== len), rng)]
      .map((x) => ({ x, zhuyin: normalizeZhuyin(x.zhuyin) }))
      .filter((o, i, a) => o.zhuyin !== answer && o.zhuyin !== traps[0].zhuyin && a.findIndex((y) => y.zhuyin === o.zhuyin) === i);
    const trap = (t) => ({ text: spoken(t.zhuyin), misconception: "tone-mixup", feedback: "這個讀音有一個字的聲調不對。一個字一個字再唸一次。" });
    const distractors = [trap(traps[0]), others.length ? { text: spoken(others[0].zhuyin), feedback: `這是「${others[0].x.word}」的注音。` } : traps[1] && trap(traps[1])].filter(Boolean);
    const k = traps[0].at;
    return {
      type: "choice",
      cards: [w.id],
      ladder_ids: ladderOf(w),
      skill: "讀音",
      difficulty: 2,
      stem: { text: spoken(`「${w.word}」怎麼唸？選出正確的注音，要看清楚聲調。`), say_text: spoken("這個語詞怎麼唸？選出正確的注音，要看清楚聲調。") },
      ...taggedOptions({ text: spoken(answer) }, distractors, rng),
      shuffle: false,
      hints: [spoken("先小聲唸一次這個語詞，再看每個選項。"), spoken("選項只差一點點，一個字一個字對聲調。"), spoken(`「${[...w.word][k]}」唸「${syl[k]}」。`)],
      feedback: { correct: spoken(`對了，「${w.word}」唸「${answer}」。`), retry: spoken("再唸一次，注意每個字的聲調。") },
    };
  });
}

// 找一找（#78）：含目標字的句子（語詞卡例句，沒有例句用語詞），目標字換成「○」；選項是目標字和 2 個形近字，不給注音。
function genCharLookalike({ cards, rng, count, pools }) {
  return cycle(lookalikePool(cards, { pools }), count, rng).map((ch) => {
    const w = wordsWithChar(ch, cards)[0];
    const sentence = w.example?.text.includes(w.word) ? w.example.text.replaceAll(ch.char, "○") : `「${w.word.replaceAll(ch.char, "○")}」`;
    const distractors = take(lookalikeChars(ch, { pools }), 2, rng).map((t) => ({ text: spoken(t), misconception: "form-alike", feedback: `「${t}」和答案長得很像。放進句子讀讀看，意思通嗎？` }));
    return {
      type: "choice",
      cards: [ch.id, w.id],
      ladder_ids: ladderOf(ch),
      skill: "字形",
      difficulty: 2,
      stem: { text: spoken(`選出正確的字，放進○：${sentence}`), say_text: spoken("選出正確的字，放進句子的空格。") },
      ...taggedOptions({ text: spoken(ch.char) }, distractors, rng),
      shuffle: false,
      hints: [spoken("先把句子讀一遍，想想空格要放什麼意思的字。"), spoken("這幾個字長得很像，看看每個字哪裡不一樣。"), spoken(`這個字的意思是「${ch.meaning.text}」${ch.radical ? `，部首是「${ch.radical}」` : ""}。`)],
      feedback: { correct: spoken(`對了，是「${ch.char}」：${w.example?.text.includes(w.word) ? w.example.text : w.word}`), retry: spoken("再看一次每個字長得哪裡不一樣，放進句子讀讀看。") },
    };
  });
}

// 描一描（#78）：每張生字卡一題，手寫題 trace（看筆順 → 描 → 自己寫）。筆順資料與判筆是外殼的事。
function genCharTrace({ cards, rng, count }) {
  return cycle(cards.chars, count, rng).map((ch) => {
    const w = wordsWithChar(ch, cards)[0];
    return {
      type: "handwrite",
      cards: [ch.id],
      ladder_ids: ladderOf(ch),
      skill: "寫字",
      difficulty: 1,
      stem: { text: spoken(`描一描「${ch.char}」：先看筆順，再描字，最後自己寫一次。`) },
      mode: "trace",
      target: ch.char,
      context: w ? { word: w.word, zhuyin: normalizeZhuyin(w.zhuyin) } : { zhuyin: normalizeZhuyin(ch.zhuyin) },
      max_mistakes: 3,
      hints: [spoken("先看一次筆順。"), spoken("照著淡色的字，一筆一筆描。"), spoken("寫不出來時可以看範字，看完再寫一次。")],
      feedback: { correct: spoken(`寫對了！「${ch.char}」寫得很好。`), retry: spoken(`「${ch.char}」再多練幾次，會越寫越順。`) },
    };
  });
}

// 寫一寫（#78）：每個「語詞＋其中一個生字」一題，手寫題 write（看注音寫國字）；語詞裡這個字的位置都挖空。
function genCharWrite({ cards, rng, count }) {
  return cycle(writePairs(cards), count, rng).map(({ w, ch, at }) => ({
    type: "handwrite",
    cards: [w.id, ch.id],
    ladder_ids: ladderOf(ch),
    skill: "寫字",
    difficulty: 2,
    stem: { text: spoken(`看注音，寫出「${[...w.word].map((t, i) => (at.includes(i) ? "○" : t)).join("")}」空格裡的字。`), say_text: spoken(`看注音，寫出「${w.word}」空格裡的字。`) },
    mode: "write",
    target: ch.char.repeat(at.length),
    context: { word: w.word, zhuyin: normalizeZhuyin(w.zhuyin), positions: at },
    max_mistakes: 3,
    hints: [spoken("先唸一次語詞，想想在哪裡看過這個字。"), spoken(ch.radical ? `這個字的部首是「${ch.radical}」。` : `這個字的意思是「${ch.meaning.text}」。`), spoken("可以按「看筆順」看一次，再自己寫。")],
    feedback: { correct: spoken(`寫對了，「${w.word}」的「${ch.char}」。`), retry: spoken(`「${ch.char}」再多寫幾次，會越寫越順。`) },
  }));
}

function genSentenceOrder({ cards, rng, count }) {
  const examples = cards.patterns.flatMap((p) => p.examples.map((ex, i) => ({ p, ex, i })));
  return cycle(examples, count, rng).map(({ p, ex, i }) => ({
    type: "ordering",
    cards: [p.id],
    __variant: String(i),
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
      type: getGenerator(skill.generator)?.itemType?.(skill.params) ?? (skill.params?.presentation === "horizontal-numeric" ? "numeric" : "blanks"),
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

function genBlueprintQuiz({ unit, cards, rng, seed, pools, blueprint, items, readings, audio, materials }) {
  const ctx = { items, readings, audio, materials, pools };
  const made = [];
  for (const { group, count, sources } of blueprint) {
    // 條件不足的來源（例如只用核心卡時語詞只剩一張，湊不出語詞填空）題庫算 0。
    const cap = Object.fromEntries(sources.map((s) => [s, REGISTRY[s].needs(cards, materials ?? [], ctx) ? 0 : REGISTRY[s].pool(cards, ctx)]));
    if (Object.values(cap).every((n) => n === 0)) {
      const reasons = sources.map((s) => [s, REGISTRY[s].needs(cards, materials ?? [], ctx)]).filter(([, r]) => r);
      throw new TypeError(`generate(quiz): 藍圖「${group}」的來源題庫都是 0（${reasons.map(([s, r]) => `${s}：${r}；`).join("")}是不是漏傳 materials 或 items？）`);
    }
    const tally = allocate(sources, count, cap, rng);
    for (const s of sources) {
      if (!tally[s]) continue;
      const sub = REGISTRY[s].generate({ unit, cards, rng: createRng(`${unit.id}|quiz|${group}|${s}|${seed}`), count: tally[s], seed: `${seed}|quiz`, pools, items, readings, audio, materials });
      made.push(...sub.slice(0, tally[s]).map((q) => ({ ...q, quiz_source: s, quiz_group: group })));
    }
  }
  return shuffle(made, rng);
}

// 綜合小測驗：在可用的生題活動之間輪流抽，一題一個來源，順序再洗牌。
function genQuiz({ unit, cards, rng, count, seed, pools, blueprint, items, readings, audio, materials }) {
  if (blueprint) return genBlueprintQuiz({ unit, cards, rng, seed, pools, blueprint, items, readings, audio, materials });
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
