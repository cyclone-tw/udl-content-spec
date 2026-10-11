import { assertQuestion, invalid, isId, isPlainObject, result } from "../_shared.mjs";

export const type = "match";
export const version = 1;

/**
 * 配對題計分。
 * @param {object} question 題目實例，pairs[] 每組有 id／left／right；正解就是「同一組的左右相連」。
 * @param {unknown} response 學生作答 { pairs: { "<左側 pair id>": "<右側 pair id>" } }。
 *
 * 全部連對 → correct；對 k／n 組 → partial，score = k／n；一組都沒對 → incorrect。
 * 沒連的左側算錯。出現不存在的 id → invalid（那是 UI 錯誤，不是學生答錯）。
 */
export function score(question, response) {
  assertQuestion(question, type);
  if (!Array.isArray(question.pairs) || question.pairs.length === 0 || !question.pairs.every((p) => p && isId(p.id))) {
    throw new TypeError("score(match): question.pairs 必須是非空陣列且每組有 id");
  }
  if (!isPlainObject(response) || !isPlainObject(response.pairs)) return invalid(type, version, "missing-field", { field: "pairs" });

  const ids = new Set(question.pairs.map((p) => p.id));
  for (const [left, right] of Object.entries(response.pairs)) {
    if (!ids.has(left)) return invalid(type, version, "unknown-pair", { side: "left", id: left });
    if (!isId(right) || !ids.has(right)) return invalid(type, version, "unknown-pair", { side: "right", id: right });
  }

  const pairs = question.pairs.map((p) => {
    const chosen = Object.hasOwn(response.pairs, p.id) ? response.pairs[p.id] : null;
    return { id: p.id, chosen, correct: chosen === p.id };
  });
  const correctCount = pairs.filter((p) => p.correct).length;
  const total = pairs.length;
  const outcome = correctCount === total ? "correct" : correctCount === 0 ? "incorrect" : "partial";
  return result(type, version, outcome, correctCount / total, { pairs, correct_count: correctCount, total });
}
