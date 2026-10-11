import { assertQuestion, invalid, isId, isPlainObject, result } from "../_shared.mjs";

export const type = "ordering";
export const version = 1;

export function score(question, response) {
  assertQuestion(question, type);
  if (!Array.isArray(question.sequence) || question.sequence.length < 2 || question.sequence.length > 8) {
    throw new TypeError("score(ordering): sequence 必須有 2–8 張卡片");
  }
  const ids = new Set();
  for (const card of question.sequence) {
    if (!isPlainObject(card) || !isId(card.id) || ids.has(card.id)) throw new TypeError("score(ordering): sequence id 不合法或重複");
    ids.add(card.id);
  }
  if (!isPlainObject(response) || !Array.isArray(response.order)) return invalid(type, version, "missing-field", { field: "order" });
  const chosen = new Map();
  for (const [index, id] of response.order.entries()) {
    if (!isId(id) || !ids.has(id)) return invalid(type, version, "unknown-id");
    if (chosen.has(id)) return invalid(type, version, "duplicate-id", { id });
    chosen.set(id, index);
  }
  if (chosen.size !== ids.size) return invalid(type, version, "incomplete-order");
  const positions = question.sequence.map(({ id }, expected_index) => ({
    id, expected_index, chosen_index: chosen.get(id), correct: chosen.get(id) === expected_index,
  }));
  const correctCount = positions.filter((p) => p.correct).length;
  const total = positions.length;
  const outcome = correctCount === total ? "correct" : correctCount === 0 ? "incorrect" : "partial";
  return result(type, version, outcome, correctCount / total, { positions, correct_count: correctCount, total });
}
