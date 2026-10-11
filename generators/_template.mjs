// 範本置換：把 {a}、{sum}、{subject} 這類佔位符換成變數值。產生器與 instantiate 共用。
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** 沒有對應變數的佔位符原樣保留；只認小寫識別字。 */
export function substitute(text, variables) {
  const vars = isPlainObject(variables) ? variables : {};
  return text.replace(/\{([a-z_][a-z0-9_]*)\}/g, (m, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : m));
}

export const substituteSpoken = (spoken, variables) =>
  isPlainObject(spoken) && typeof spoken.text === "string" ? { ...spoken, text: substitute(spoken.text, variables) } : spoken;

/** 範本裡用到的佔位符名稱（去重）。 */
export function placeholders(text) {
  return [...new Set([...text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map((m) => m[1]))];
}
