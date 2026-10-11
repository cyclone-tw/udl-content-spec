// 四種題型共用的小工具。全部是純函式，不碰 DOM、不讀外部狀態。

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isId = (v) => typeof v === "string" && ID_RE.test(v);
export const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

// 題目實例不合格是內容或程式錯誤（驗證器應該早就擋下），所以直接丟錯；作答不合格則回傳 invalid。
export function assertQuestion(question, type) {
  if (!isPlainObject(question)) throw new TypeError(`score(${type}): question 必須是物件`);
  if (question.type !== type) throw new TypeError(`score(${type}): question.type 是 ${JSON.stringify(question.type)}`);
  if (question.kind === "generated") {
    throw new TypeError(`score(${type}): 不能直接對 generated 題目模板計分，請先用產生器產出題目實例`);
  }
}

export function result(type, type_version, outcome, score, detail) {
  return { type, type_version, outcome, score, detail };
}

export const invalid = (type, type_version, reason, extra = {}) =>
  result(type, type_version, "invalid", 0, { reason, ...extra });
