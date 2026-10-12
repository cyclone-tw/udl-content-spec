// 作答事件契約 udl-attempt-events/v1 的常數與最小建構器。
// 殼（獨立執行器、朗讀器轉接、RPG、平台）用這裡組事件檔，不各自手寫欄位名。
export const FORMAT = "udl-attempt-events";
export const FORMAT_VERSION = 1;
export const SCHEMA_PATH = "events/schema/attempt-events.schema.json";
export const EVENT_TYPES = Object.freeze(["session-started", "material-viewed", "audio-played", "hint-used", "answered", "session-completed"]);
export const MODES = Object.freeze(["learn", "practice", "test"]);
export const ROLES = Object.freeze(["student", "teacher", "guest"]);
export const GRANULARITIES = Object.freeze(["item", "unit"]);
export const GUESS_FLAGS = Object.freeze(["none", "possible-guessing", "flagged"]);

/**
 * 開一個新的事件檔。actor 只能有 role 與 student_code；多的欄位直接丟掉並拋錯，避免真名混進來。
 * @param {{producer:{shell:string,shell_version:string,granularity:"item"|"unit"}, actor:{role:string,student_code?:string}, context:object, generated_at?:string}} init
 */
export function createEventsFile({ producer, actor, context, generated_at = new Date().toISOString() }) {
  const extra = Object.keys(actor).filter((k) => k !== "role" && k !== "student_code");
  if (extra.length) throw new Error(`actor 只能有 role 與 student_code，多出：${extra.join("、")}`);
  if (actor.role === "student" && !actor.student_code) throw new Error("role=student 必須帶 student_code");
  if (actor.role !== "student" && actor.student_code) throw new Error(`role=${actor.role} 不得帶 student_code`);
  return {
    format_version: FORMAT_VERSION,
    format: FORMAT,
    generated_at,
    producer: { ...producer },
    actor: actor.role === "student" ? { role: "student", student_code: actor.student_code } : { role: actor.role },
    context: { ...context },
    events: [],
  };
}

/** 追加一個事件；seq 自動遞增，time 預設現在。回傳該事件。 */
export function pushEvent(file, type, fields = {}, time = new Date().toISOString()) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`未知事件種類 ${type}`);
  const ev = { seq: file.events.length + 1, type, time, ...fields };
  file.events.push(ev);
  return ev;
}

/**
 * 從題目（固定題或產生題實例）與 score() 結果組一個 answered 事件的欄位。
 * 殼只要補 attempt_no、response_ms、hint_tier、read_aloud、guess_flag 這些它才知道的事。
 */
export function answeredFields(question, result, { attempt_no, response_ms, hint_tier = 0, read_aloud = null, guess_flag = "none", response } = {}) {
  const isInstance = question.kind === "instance";
  const fields = {
    item_id: isInstance ? question.source_item : question.id,
    ladder_ids: [...(question.ladder_ids ?? [])],
    question_type: result.type,
    type_version: result.type_version,
    outcome: result.outcome,
    score: result.score,
    attempt_no,
    response_ms,
    hint_tier,
    read_aloud,
    guess_flag,
  };
  if (question.curriculum_codes?.length) fields.curriculum_codes = [...question.curriculum_codes];
  if (response !== undefined) fields.response = response;
  if (result.detail) fields.detail = result.detail;
  if (isInstance) {
    fields.generated = {
      generator: question.generator,
      generator_version: question.generator_version,
      seed: question.seed,
      index: question.index,
    };
    if (question.tier) fields.generated.tier = question.tier;
    if (question.hint_variant) fields.generated.hint_variant = question.hint_variant;
    if (question.variables) fields.generated.variables = { ...question.variables };
  }
  return fields;
}
