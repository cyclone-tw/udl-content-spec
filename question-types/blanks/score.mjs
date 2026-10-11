import { assertQuestion, invalid, isId, isFiniteNumber, isPlainObject, result } from "../_shared.mjs";
import { withinTolerance, score as numericScore } from "../numeric/score.mjs";

export const type = "blanks";
export const version = 1;

const normalize = (value, sensitive) => {
  const text = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return sensitive ? text : text.toLowerCase();
};

export function score(question, response) {
  assertQuestion(question, type);
  if (!Array.isArray(question.blanks) || question.blanks.length < 1 || question.blanks.length > 12) {
    throw new TypeError("score(blanks): blanks 必須有 1–12 格");
  }
  const ids = new Set();
  // 先驗證全部題目欄位，再檢查作答，保持題目錯誤的優先順序。
  for (const slot of question.blanks) {
    if (!isPlainObject(slot) || !isId(slot.id) || ids.has(slot.id)) throw new TypeError("score(blanks): 格 id 不合法或重複");
    ids.add(slot.id);
    if (slot.kind === "numeric") {
      numericScore({ ...slot, type: "numeric" }, undefined);
    } else if (slot.kind === "text") {
      if (typeof slot.answer !== "string" || slot.answer.length === 0 ||
          (slot.accept !== undefined && (!Array.isArray(slot.accept) || !slot.accept.every((s) => typeof s === "string" && s.length > 0))) ||
          (slot.case_sensitive !== undefined && typeof slot.case_sensitive !== "boolean") ||
          (slot.max_length !== undefined && (!Number.isInteger(slot.max_length) || slot.max_length < 1))) {
        throw new TypeError("score(blanks): 文字格欄位不合法");
      }
    } else {
      throw new TypeError("score(blanks): 未知格 kind");
    }
  }
  if (!isPlainObject(response) || !isPlainObject(response.blanks)) return invalid(type, version, "missing-field", { field: "blanks" });
  for (const id of Object.keys(response.blanks)) {
    if (!ids.has(id)) return invalid(type, version, "unknown-blank", { id });
  }
  for (const slot of question.blanks) {
    if (!Object.hasOwn(response.blanks, slot.id)) continue;
    const chosen = response.blanks[slot.id];
    if (slot.kind === "numeric" && !isFiniteNumber(chosen)) return invalid(type, version, "not-number", { id: slot.id });
    if (slot.kind === "text" && typeof chosen !== "string") return invalid(type, version, "not-string", { id: slot.id });
  }
  const blanks = question.blanks.map((slot) => {
    const present = Object.hasOwn(response.blanks, slot.id);
    const chosen = present ? response.blanks[slot.id] : null;
    const correct = present && (slot.kind === "numeric"
      ? withinTolerance(slot.answer, chosen, slot.tolerance)
      : [slot.answer, ...(slot.accept ?? [])].some((answer) => normalize(answer, slot.case_sensitive) === normalize(chosen, slot.case_sensitive)));
    return { id: slot.id, kind: slot.kind, chosen, correct };
  });
  const correctCount = blanks.filter((b) => b.correct).length;
  const total = blanks.length;
  const outcome = correctCount === total ? "correct" : correctCount === 0 ? "incorrect" : "partial";
  return result(type, version, outcome, correctCount / total, { blanks, correct_count: correctCount, total });
}
