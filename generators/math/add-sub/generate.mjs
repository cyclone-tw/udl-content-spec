// 加減法產生器：吃「條件檔」的檔位出題。一條能力指標一份條件檔，params 只能在條件檔允許的範圍內挑。
// 每一題：依權重抽檔位 → 抽數字形狀 → 抽數字，不符檔位條件就重抽；輸出直式多格填空或橫式單值。
import { createRng } from "../../_prng.mjs";
import { checkParams } from "../../profiles/index.mjs";
import { substitute, placeholders } from "../../_template.mjs";

export const id = "math.add-sub";
export const version = 1;
export const paramsSchemaPath = "generators/math/add-sub/params.schema.json";
export const MAX_ATTEMPTS_PER_ITEM = 1000;

const OP_SYMBOL = { add: "＋", sub: "－" };
const OP_WORD = { add: "加", sub: "減" };
const DIGIT_RANGE = { 1: [1, 9], 2: [10, 99], 3: [100, 999], 4: [1000, 9999] };
const CONTEXT_PLACEHOLDERS = new Set(["subject", "action", "item", "unit"]);

const digits = (n) => [n % 10, Math.floor(n / 10) % 10, Math.floor(n / 100) % 10, Math.floor(n / 1000) % 10];

/** 逐位分析：進位／退位次數、各位結果。a、b 皆為正整數；減法要求 a > b。 */
export function analyze(operation, a, b) {
  const [a1, a10] = digits(a);
  const [b1, b10] = digits(b);
  if (operation === "add") {
    const sum = a + b;
    const carry = a1 + b1 >= 10 ? 1 : 0;
    const tensSum = a10 + b10 + carry;
    const carry10 = tensSum >= 10 ? 1 : 0;
    const [ones, tens, hundreds] = digits(sum);
    return {
      result: sum, carries: carry + carry10, borrows: 0, carry, carry_tens: carry10, borrow: 0,
      ones, tens, hundreds, ones_sum: a1 + b1, tens_sum: tensSum,
      a_ones: a1, a_tens: a10, b_ones: b1, b_tens: b10,
    };
  }
  const diff = a - b;
  const borrow = a1 < b1 ? 1 : 0;
  const [ones, tens, hundreds] = digits(diff);
  return {
    result: diff, carries: 0, borrows: borrow, carry: 0, borrow,
    ones, tens, hundreds, ones_sum: a1 + b1,
    a_ones: a1, a_tens: a10, b_ones: b1, b_tens: b10,
    // 借位變數只在真的退位時才有，免得事件裡出現誤導的「借位後個位」
    ...(borrow ? { a_ones_borrowed: a1 + 10, a_tens_after: a10 - 1 } : {}),
  };
}

function matchesTier(def, operation, a, info) {
  if (def.operation !== operation) return false;
  if (def.carries !== undefined && info.carries !== def.carries) return false;
  if (def.borrows !== undefined && info.borrows !== def.borrows) return false;
  if (def.minuend_ones_zero !== undefined && (a % 10 === 0) !== def.minuend_ones_zero) return false;
  // sum_max／sum_min 作用在「結果」：加法的和、減法的差（schema 說明同此）。
  if (def.sum_max !== undefined && info.result > def.sum_max) return false;
  if (def.sum_min !== undefined && info.result < def.sum_min) return false;
  return true;
}

/**
 * 這題的提示變體候選，優先序由前到後：解法子情形（加法恰一次進位發生在十位 → tens-carry，在個位 → ones-carry）、
 * 數字形狀（第二個數是一位數 → one-digit）。條件檔有哪個就用哪個，都沒有用 default。
 */
export function hintVariants(info, shape) {
  const out = [];
  if (info.carries === 1) out.push(info.carry_tens === 1 ? "tens-carry" : "ones-carry");
  if (shape[1] === 1) out.push("one-digit");
  return out;
}

/** 依候選 key 依序找變體；回傳用到的三句與實際用的 key（候選都沒有就是 default）。 */
export function pickHints(hintsForTier, candidates) {
  if (Array.isArray(hintsForTier)) return { hints: hintsForTier, key: "default" };
  for (const key of candidates) if (hintsForTier.variants && Object.hasOwn(hintsForTier.variants, key)) return { hints: hintsForTier.variants[key], key };
  return { hints: hintsForTier.default, key: "default" };
}

const pickWeighted = (rng, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = rng.next() * total;
  for (const [key, w] of entries) {
    x -= w;
    if (x < 0) return key;
  }
  return entries[entries.length - 1][0];
};

const poolEntries = (pools, poolId) => {
  if (!poolId || !pools) return null;
  const pool = pools instanceof Map ? pools.get(poolId) : pools[poolId];
  return Array.isArray(pool?.entries) && pool.entries.length ? pool.entries : null;
};

/** 挑一個情境範本並填入角色／動作／物品／單位；沒有可用的池就回 null（退回算式）。 */
function contextSentence(rng, profile, params, pools, operation, vars) {
  const templates = profile.stems.context?.[operation];
  if (!params.context || !Array.isArray(templates) || !templates.length) return null;
  const ids = params.context_pools ?? {};
  const subjects = poolEntries(pools, ids.subjects);
  const actions = poolEntries(pools, ids[`actions_${operation}`]);
  const items = poolEntries(pools, ids.items);
  const available = new Set([...(subjects ? ["subject"] : []), ...(actions ? ["action"] : []), ...(items ? ["item", "unit"] : [])]);
  const usable = templates.filter((t) => placeholders(t).filter((p) => CONTEXT_PLACEHOLDERS.has(p)).every((p) => available.has(p)));
  if (!usable.length) return null;
  const template = usable[rng.int(0, usable.length - 1)];
  const need = new Set(placeholders(template));
  const picked = {};
  if (need.has("subject")) picked.subject = subjects[rng.int(0, subjects.length - 1)].text.text;
  if (need.has("action")) picked.action = actions[rng.int(0, actions.length - 1)].text.text;
  if (need.has("item") || need.has("unit")) {
    const entry = items[rng.int(0, items.length - 1)];
    picked.item = entry.text.text;
    picked.unit = entry.unit ?? "個";
  }
  Object.assign(vars, picked);
  return substitute(template, vars);
}

/**
 * @param {object} o
 * @param {object} o.params   已通過 checkParams 的參數（tiers、weights、operations、shapes、presentation、scaffold、context、distinct、context_pools）
 * @param {string} o.seed
 * @param {number} o.count
 * @param {object} o.profile  條件檔（由 instantiate 依 item.ladder_ids 找到後傳入）
 * @param {Map|object} [o.pools]  內容包的池（id → pool），情境範本用；沒有就退回算式題幹
 */
export function generate({ params, seed, count, profile, pools }) {
  if (!profile || typeof profile !== "object") throw new TypeError(`${id}: 需要條件檔；item.ladder_ids 必須含一條已登錄條件檔的能力指標`);
  if (profile.generator !== id) throw new TypeError(`${id}: 條件檔 ${profile.ladder_id} 指定的產生器是 ${profile.generator}`);
  const errors = checkParams(profile, params);
  if (errors.length) throw new TypeError(`${id}: ${errors.join("；")}`);
  if (!Number.isInteger(count) || count < 1) throw new TypeError(`${id}: count 必須是 ≥ 1 的整數`);

  const rng = createRng(`${id}|${String(seed)}`);
  // 橫式輸入框上限：最大位數再多一位（二位數相加最多三位）。
  const inputMax = 10 ** (Math.max(...params.shapes.map((s) => s[0])) + 1) - 1;
  const weighted = params.tiers.map((t) => [t, params.weights?.[t] ?? 1]);
  const seen = new Set();
  const out = [];

  for (let i = 0; i < count; i++) {
    const tierId = pickWeighted(rng, weighted);
    const def = profile.tiers[tierId];
    const operation = def.operation;
    const shape = params.shapes[rng.int(0, params.shapes.length - 1)];
    const [aMin, aMax] = DIGIT_RANGE[shape[0]];
    const [bMin, bMax] = DIGIT_RANGE[shape[1]];
    let found = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_ITEM && !found; attempt++) {
      const a = rng.int(aMin, aMax);
      const b = rng.int(bMin, bMax);
      if (a === b) continue;
      if (operation === "sub" && a < b) continue;
      const info = analyze(operation, a, b);
      if (!matchesTier(def, operation, a, info)) continue;
      const key = operation === "add" ? (a <= b ? `${a}+${b}` : `${b}+${a}`) : `${a}-${b}`;
      if (params.distinct && seen.has(key)) continue;
      seen.add(key);
      found = { a, b, info };
    }
    if (!found) {
      throw new RangeError(
        `${id}: 第 ${i + 1} 題在 ${MAX_ATTEMPTS_PER_ITEM} 次內抽不到符合檔位「${def.label}」（${tierId}）、形狀 ${JSON.stringify(shape)}` +
          (params.distinct ? "、不重複" : "") + " 的數字；請放寬檔位、形狀或減少 count",
      );
    }
    const { a, b, info } = found;
    const vars = {
      a, b, op: OP_SYMBOL[operation], op_word: OP_WORD[operation], operation,
      ...(operation === "add" ? { sum: info.result } : { diff: info.result }),
      ...info,
      carry_or_borrow: operation === "add" ? "進位" : "退位",
      tier: tierId,
    };
    const context = contextSentence(rng, profile, params, pools, operation, vars);
    const places = info.result >= 100 ? ["ones", "tens", "hundreds"] : ["ones", "tens"];
    const picked = pickHints(profile.hints[tierId], hintVariants(info, shape));
    const hints = picked.hints.map((t) => ({ text: substitute(t, vars), audio: null }));
    vars.hint_variant = picked.key; // 實際用到的變體（事件要記），不是候選
    const feedback = {
      correct: { text: substitute(profile.feedback.correct, vars), audio: null },
      retry: { text: substitute(profile.feedback.retry, vars), audio: null },
    };
    const base = { tier: tierId, hints, feedback, variables: vars };

    if (params.presentation === "vertical-blanks") {
      const tail = substitute(places.length === 3 ? profile.stems.vertical.places_3 : profile.stems.vertical.places_2, vars);
      const text = context ? `${context}。${tail}` : `${a} ${OP_SYMBOL[operation]} ${b}，${tail}`;
      out.push({
        ...base,
        type: "blanks",
        stem: { text: { text, audio: null } },
        blanks: places.map((p) => ({ id: p, kind: "numeric", answer: info[p], input: { min: 0, max: 9, decimals: 0 } })),
        display: { layout: "vertical", operation, operands: [a, b], places, carry_marks: true, scaffold: params.scaffold },
      });
    } else {
      const text = context ?? substitute(profile.stems.equation, vars);
      out.push({
        ...base,
        type: "numeric",
        stem: { text: { text, audio: null } },
        answer: info.result,
        tolerance: { type: "nominal", value: 0 },
        input: { min: 0, max: inputMax, decimals: 0 },
        display: { layout: "horizontal", operation, operands: [a, b], scaffold: params.scaffold },
      });
    }
  }
  return out;
}
