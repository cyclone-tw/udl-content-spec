// 把朗讀器（udl-learning prototypes/lesson-reader，FROZEN）下載的 `udl-lesson-attempt/v1` 作答 JSON
// 轉成 udl-attempt-events/v1。朗讀器的題目是組裝時從生字語詞現場生的、沒有穩定題號，
// 所以粒度是 unit：item_id 用「課次-活動-序號」合成，ladder_ids 由對照表補上。
import { createEventsFile, pushEvent } from "../index.mjs";

export const SOURCE_SCHEMA = "udl-lesson-attempt/v1";
export const SHELL_ID = "udl-lesson-reader";

// 朗讀器的活動 → 事件 mode。討伐（quiz）是小測驗；修練（literacy）是練習。
const ACTIVITY_MODE = Object.freeze({ quiz: "test", literacy: "practice" });
// 朗讀器的題型（全句選圖、圖選句子、句子配圖、注音配對…）都是單選，對到規格的 choice v1。
const QUESTION_TYPE = "choice";
const TYPE_VERSION = 1;

const idSafe = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";

/**
 * @param {object} attempt  朗讀器的作答 JSON（schema 必須是 udl-lesson-attempt/v1）
 * @param {object} opts
 * @param {object} opts.mapping  對照表：{ lessons: { [lessonId]: { pack: {id, version}, unit_id, ladder_ids, curriculum_codes? } } }
 * @param {object} opts.actor    { role, student_code? }
 * @param {string} [opts.shell_version]  朗讀器版本字串（例如 v1）
 * @param {string} [opts.mode]   覆寫活動對應的 mode
 * @param {object} [opts.prescription]  這次用的處方（朗讀器用網址參數帶，由呼叫者轉成處方欄位）
 */
export function convertLessonAttempt(attempt, { mapping, actor, shell_version = "unknown", mode, prescription } = {}) {
  if (!attempt || attempt.schema !== SOURCE_SCHEMA) throw new Error(`來源 schema 必須是 ${SOURCE_SCHEMA}`);
  if (!attempt.lessonId) throw new Error("來源缺 lessonId");
  const lesson = mapping?.lessons?.[attempt.lessonId];
  if (!lesson) throw new Error(`對照表沒有課次 ${attempt.lessonId}`);
  if (!Array.isArray(lesson.ladder_ids) || lesson.ladder_ids.length === 0) throw new Error(`對照表課次 ${attempt.lessonId} 缺 ladder_ids`);
  const activity = attempt.activity || "quiz";
  const resolvedMode = mode ?? ACTIVITY_MODE[activity];
  if (!resolvedMode) throw new Error(`不認識的活動 ${activity}，請用 mode 指定`);
  const startedAt = attempt.startedAt || attempt.endedAt || new Date().toISOString();
  const endedAt = attempt.endedAt || startedAt;
  const lessonSlug = idSafe(attempt.lessonId);
  const context = {
    session_id: `${lessonSlug}-${idSafe(activity)}-${startedAt.replace(/[^0-9TZ]/g, "")}`,
    mode: resolvedMode,
    pack: { id: lesson.pack?.id ?? lessonSlug, version: lesson.pack?.version ?? "unversioned" },
    unit_id: lesson.unit_id ?? lessonSlug,
  };
  if (prescription) context.prescription = prescription;
  const file = createEventsFile({
    producer: { shell: SHELL_ID, shell_version, granularity: "unit" },
    actor,
    context,
    generated_at: new Date().toISOString(),
  });
  pushEvent(file, "session-started", {}, startedAt);
  const guess = attempt.guessFlag === "possible-guessing" ? "possible-guessing" : "none";
  const events = Array.isArray(attempt.events) ? attempt.events : [];
  events.forEach((e, i) => {
    const ok = !!e.ok;
    const fields = {
      item_id: `${lessonSlug}-${idSafe(activity)}-${i + 1}`,
      ladder_ids: [...lesson.ladder_ids],
      question_type: QUESTION_TYPE,
      type_version: TYPE_VERSION,
      outcome: ok ? "correct" : "incorrect",
      score: ok ? 1 : 0,
      attempt_no: 1,
      response_ms: Math.max(0, Math.round(Number(e.ms) || 0)),
      hint_tier: 0,
      read_aloud: null,
      guess_flag: guess,
      response: { chosen: e.chosen ?? "" },
      detail: { kind: e.kind ?? "", prompt: e.prompt ?? "", correct: e.correct ?? "", key: e.key ?? "" },
    };
    if (lesson.curriculum_codes?.length) fields.curriculum_codes = [...lesson.curriculum_codes];
    pushEvent(file, "answered", fields, e.at || endedAt);
  });
  pushEvent(file, "session-completed", {
    summary: {
      answered: Number(attempt.total) || events.length,
      correct: Number(attempt.correct) || events.filter((e) => e.ok).length,
      duration_ms: Math.max(0, Math.round(Number(attempt.durationMs) || 0)),
    },
  }, endedAt);
  return file;
}
