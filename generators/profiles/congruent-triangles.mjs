// math.congruent-triangles 的條件檔規則（_family.mjs 工廠）：檔位、權重、題數、旋轉。
import { makeFamily } from "./_family.mjs";

export const { checkParams, resolveParams } = makeFamily({ booleans: ["rotate"] });
