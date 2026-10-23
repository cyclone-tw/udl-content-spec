import { assertQuestion, invalid, isPlainObject, result } from "../_shared.mjs";

export const type = "handwrite";
export const version = 1;

export const MODES = Object.freeze(["trace", "write"]);
export const DEFAULT_MAX_MISTAKES = 3;
const HAN = /^\p{Script=Han}$/u;

/**
 * 手寫字計分（#78）。判筆（哪一筆對、錯幾次）是外殼的事，這裡只看外殼回報的每個字結果。
 * @param {object} question 題目實例：target（要寫的字）、mode、max_mistakes?。
 * @param {unknown} response { chars: [{ char, completed, mistakes, helped }] }，依 target 的順序一字一筆。
 */
export function score(question, response) {
  assertQuestion(question, type);
  const target = typeof question.target === "string" ? [...question.target] : [];
  if (!target.length || !target.every((t) => HAN.test(t)) || !MODES.includes(question.mode)) {
    throw new TypeError("score(handwrite): question 需要 target（1 個以上的漢字）與 mode（trace／write）");
  }
  const max = question.max_mistakes ?? DEFAULT_MAX_MISTAKES;
  if (!Number.isInteger(max) || max < 0) throw new TypeError("score(handwrite): max_mistakes 要是 ≥ 0 的整數");
  if (!isPlainObject(response) || !Array.isArray(response.chars)) return invalid(type, version, "missing-field", { field: "chars" });
  if (response.chars.length !== target.length) return invalid(type, version, "wrong-count", { expected: target.length, got: response.chars.length });
  for (const [i, c] of response.chars.entries()) {
    if (!isPlainObject(c) || typeof c.char !== "string" || typeof c.completed !== "boolean" || typeof c.helped !== "boolean" || !Number.isInteger(c.mistakes) || c.mistakes < 0) {
      return invalid(type, version, "bad-char", { index: i });
    }
    if (c.char !== target[i]) return invalid(type, version, "char-mismatch", { index: i, expected: target[i], got: c.char });
  }
  const chars = response.chars.map((c) => ({ char: c.char, completed: c.completed, mistakes: c.mistakes, helped: c.helped, correct: c.completed && !c.helped && c.mistakes <= max }));
  const correctCount = chars.filter((c) => c.correct).length;
  const total = chars.length;
  const outcome = correctCount === total ? "correct" : correctCount === 0 ? "incorrect" : "partial";
  return result(type, version, outcome, correctCount / total, { chars, correct_count: correctCount, total, max_mistakes: max });
}
