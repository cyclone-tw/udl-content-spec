import { assertQuestion, invalid, isPlainObject, result } from "../_shared.mjs";

export const type = "true-false";
export const version = 1;

/**
 * 是非題計分。
 * @param {object} question 題目實例，answer 為布林。
 * @param {unknown} response 學生作答 { value: true|false }。
 */
export function score(question, response) {
  assertQuestion(question, type);
  if (typeof question.answer !== "boolean") throw new TypeError("score(true-false): question.answer 必須是布林");
  if (!isPlainObject(response) || !("value" in response)) return invalid(type, version, "missing-field", { field: "value" });
  if (typeof response.value !== "boolean") return invalid(type, version, "not-boolean", { field: "value" });

  const correct = response.value === question.answer;
  return result(type, version, correct ? "correct" : "incorrect", correct ? 1 : 0, {
    chosen: response.value,
    answer: question.answer,
  });
}
