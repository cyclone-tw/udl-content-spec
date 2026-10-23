// 題型登錄表。殼、獨立執行器、平台都從這裡拿 score()，不自己判答案。
import * as choice from "./choice/score.mjs";
import * as trueFalse from "./true-false/score.mjs";
import * as match from "./match/score.mjs";
import * as numeric from "./numeric/score.mjs";
import * as blanks from "./blanks/score.mjs";
import * as ordering from "./ordering/score.mjs";
import * as classify from "./classify/score.mjs";
import * as handwrite from "./handwrite/score.mjs";

const entry = (mod) => Object.freeze({
  type: mod.type,
  version: mod.version,
  score: mod.score,
  responseSchemaPath: `question-types/${mod.type}/response.schema.json`,
});

/** v1 已實作的題型。 */
export const types = Object.freeze({
  [choice.type]: entry(choice),
  [trueFalse.type]: entry(trueFalse),
  [match.type]: entry(match),
  [numeric.type]: entry(numeric),
  [blanks.type]: entry(blanks),
  [ordering.type]: entry(ordering),
  [classify.type]: entry(classify),
  [handwrite.type]: entry(handwrite),
});

/** v2 候選：已排進路線圖、尚未實作（見 README 路線圖）。 */
export const planned = Object.freeze([]);

/** v3 保留：先占名稱與結果形狀（pending-review），實作待定（見 README）。 */
export const reserved = Object.freeze(["drawing", "speaking"]);

export const RESULT_SCHEMA_PATH = "question-types/result.schema.json";

/** 取得題型；未登錄回傳 null，不丟錯，讓呼叫端給可讀訊息。 */
export function getType(type) {
  return Object.hasOwn(types, type) ? types[type] : null;
}

/** 依題目實例的 type 分派計分。未登錄的 type 丟 TypeError（內容或程式錯誤，驗證器應早已擋下）。 */
export function score(question, response) {
  const t = question && getType(question.type);
  if (!t) {
    const hint = planned.includes(question?.type) ? "（v2 候選，尚未實作）" : reserved.includes(question?.type) ? "（v3 保留名稱，尚未實作）" : "";
    throw new TypeError(`未登錄的題型 ${JSON.stringify(question?.type)}${hint}`);
  }
  return t.score(question, response);
}
