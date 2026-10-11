import { assertQuestion, invalid, isFiniteNumber, isPlainObject, result } from "../_shared.mjs";

export const type = "numeric";
export const version = 1;

// 浮點誤差緩衝：0.1 + 0.2 這類運算不該讓學生被判錯。相對於數量級取一個很小的量。
const EPS = 1e-9;
const slack = (...xs) => EPS * Math.max(1, ...xs.map((x) => Math.abs(x)));

/**
 * 依 tolerance 判定 value 是否可接受。省略 tolerance 等於 nominal 0（精確）。
 * nominal：|dx| ≤ v。
 * relative：|dx| ≤ v·|answer|；answer 為 0 時退化為精確比對。
 * geometric：answer／(1+v) ≤ value ≤ answer·(1+v)（負數時區間自動翻轉）；answer 為 0 時退化為精確比對。
 */
export function withinTolerance(answer, value, tolerance) {
  const t = tolerance ?? { type: "nominal", value: 0 };
  const dx = value - answer;
  switch (t.type) {
    case "nominal":
      return Math.abs(dx) <= t.value + slack(answer, value);
    case "relative":
      if (answer === 0) return Math.abs(dx) <= slack(value);
      return Math.abs(dx) <= t.value * Math.abs(answer) + slack(answer, value);
    case "geometric": {
      if (answer === 0) return Math.abs(dx) <= slack(value);
      const a = answer / (1 + t.value);
      const b = answer * (1 + t.value);
      const s = slack(answer, value);
      return Math.min(a, b) - s <= value && value <= Math.max(a, b) + s;
    }
    default:
      throw new TypeError(`score(numeric): 未知 tolerance.type ${JSON.stringify(t.type)}`);
  }
}

/**
 * 計算題計分。
 * @param {object} question 題目實例，answer 為數字；可選 tolerance、input、unit_label。
 * @param {unknown} response 學生作答 { value: <number> }。
 */
export function score(question, response) {
  assertQuestion(question, type);
  if (!isFiniteNumber(question.answer)) throw new TypeError("score(numeric): question.answer 必須是有限數字");
  const tolerance = question.tolerance ?? { type: "nominal", value: 0 };
  if (!isPlainObject(tolerance) || !isFiniteNumber(tolerance.value) || tolerance.value < 0) {
    throw new TypeError("score(numeric): tolerance 需要 type 與非負 value");
  }
  if (!isPlainObject(response) || !("value" in response)) return invalid(type, version, "missing-field", { field: "value" });
  if (!isFiniteNumber(response.value)) return invalid(type, version, "not-number", { field: "value" });

  const correct = withinTolerance(question.answer, response.value, tolerance);
  return result(type, version, correct ? "correct" : "incorrect", correct ? 1 : 0, {
    value: response.value,
    answer: question.answer,
    tolerance,
    difference: response.value - question.answer,
  });
}
