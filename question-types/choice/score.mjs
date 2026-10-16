import { assertQuestion, invalid, isId, isPlainObject, result } from "../_shared.mjs";

export const type = "choice";
export const version = 1;

/**
 * 選擇題計分。
 * @param {object} question 題目實例（fixed item，或產生器產出的同形實例），需有 options[] 與 answer（正解 option id）。
 * @param {unknown} response 學生作答 { option: "<id>" }。
 */
export function score(question, response) {
  assertQuestion(question, type);
  if (!Array.isArray(question.options) || !isId(question.answer) || !question.options.some((o) => o && o.id === question.answer)) {
    throw new TypeError("score(choice): question 需要 options[] 與 answer（option id）");
  }
  if (!isPlainObject(response) || !("option" in response)) return invalid(type, version, "missing-field", { field: "option" });
  const chosen = response.option;
  if (!isId(chosen)) return invalid(type, version, "bad-id", { field: "option" });
  if (!question.options.some((o) => o && o.id === chosen)) return invalid(type, version, "unknown-option", { option: chosen });

  const correct = chosen === question.answer;
  const detail = { chosen, answer: question.answer };
  // 錯誤類型（#43）：選到帶 misconception 的錯誤選項時照抄代碼，給事件與教師報表統計。
  const misconception = question.options.find((o) => o && o.id === chosen).misconception;
  if (!correct && isId(misconception)) detail.misconception = misconception;
  return result(type, version, correct ? "correct" : "incorrect", correct ? 1 : 0, detail);
}
