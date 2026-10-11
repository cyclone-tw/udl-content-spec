import { assertQuestion, invalid, isId, isPlainObject, result } from "../_shared.mjs";

export const type = "classify";
export const version = 1;

export function score(question, response) {
  assertQuestion(question, type);
  if (!Array.isArray(question.bins) || question.bins.length < 2 || question.bins.length > 6 ||
      !Array.isArray(question.objects) || question.objects.length < 2 || question.objects.length > 12) {
    throw new TypeError("score(classify): 需要 2–6 個 bins 與 2–12 個 objects");
  }
  const bins = new Set();
  for (const bin of question.bins) {
    if (!isPlainObject(bin) || !isId(bin.id) || bins.has(bin.id)) throw new TypeError("score(classify): bins id 不合法或重複");
    bins.add(bin.id);
  }
  const ids = new Set();
  for (const object of question.objects) {
    if (!isPlainObject(object) || !isId(object.id) || ids.has(object.id) || !isId(object.bin) || !bins.has(object.bin)) {
      throw new TypeError("score(classify): objects id 不合法、重複或 bin 不存在");
    }
    ids.add(object.id);
  }
  if (!isPlainObject(response) || !isPlainObject(response.bins)) return invalid(type, version, "missing-field", { field: "bins" });
  const chosen = new Map();
  for (const [bin, objects] of Object.entries(response.bins)) {
    if (!bins.has(bin)) return invalid(type, version, "unknown-bin", { id: bin });
    if (!Array.isArray(objects)) return invalid(type, version, "missing-field", { field: bin });
    for (const id of objects) {
      if (!isId(id) || !ids.has(id)) return invalid(type, version, "unknown-object");
      if (chosen.has(id)) return invalid(type, version, "duplicate-object", { id });
      chosen.set(id, bin);
    }
  }
  const objects = question.objects.map(({ id, bin }) => ({
    id, expected_bin: bin, chosen_bin: chosen.get(id) ?? null, correct: chosen.get(id) === bin,
  }));
  const correctCount = objects.filter((o) => o.correct).length;
  const total = objects.length;
  const outcome = correctCount === total ? "correct" : correctCount === 0 ? "incorrect" : "partial";
  return result(type, version, outcome, correctCount / total, { objects, correct_count: correctCount, total });
}
