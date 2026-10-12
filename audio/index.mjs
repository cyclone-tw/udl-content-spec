// 音檔包契約 v1 的常數與鍵規則：單音（注音音節）、語詞（詞＋注音）、整課。
// 產出端（udl-learning 的建置工具）與取用端（平台、教材 repo）都用這裡算鍵與檔名，不各自實作。
import { createHash } from "node:crypto";

export const FORMATS = Object.freeze({
  syllables: "udl-audio-syllables",
  words: "udl-audio-words",
  lesson: "udl-audio-lesson",
});
export const FORMAT_VERSION = 1;
export const AUDIO_EXTS = Object.freeze([".m4a", ".mp3", ".ogg", ".opus", ".wav"]);

const INITIALS = {
  "ㄅ": "b", "ㄆ": "p", "ㄇ": "m", "ㄈ": "f", "ㄉ": "d", "ㄊ": "t", "ㄋ": "n", "ㄌ": "l",
  "ㄍ": "g", "ㄎ": "k", "ㄏ": "h", "ㄐ": "j", "ㄑ": "q", "ㄒ": "x",
  "ㄓ": "zh", "ㄔ": "ch", "ㄕ": "sh", "ㄖ": "r", "ㄗ": "z", "ㄘ": "c", "ㄙ": "s",
};
// 韻母（不含介音）→ 拼音；ㄝ 單獨成音節時寫 eh（拼音的 ê 不是 ASCII）。
const FINALS = {
  "": "", "ㄚ": "a", "ㄛ": "o", "ㄜ": "e", "ㄝ": "eh", "ㄞ": "ai", "ㄟ": "ei", "ㄠ": "ao", "ㄡ": "ou",
  "ㄢ": "an", "ㄣ": "en", "ㄤ": "ang", "ㄥ": "eng", "ㄦ": "er",
};
// 介音＋韻母 → 拼音（有聲母時）；[有聲母, 無聲母]
const MEDIAL_I = {
  "": ["i", "yi"], "ㄚ": ["ia", "ya"], "ㄛ": ["io", "yo"], "ㄝ": ["ie", "ye"], "ㄞ": ["iai", "yai"],
  "ㄠ": ["iao", "yao"], "ㄡ": ["iu", "you"], "ㄢ": ["ian", "yan"], "ㄣ": ["in", "yin"],
  "ㄤ": ["iang", "yang"], "ㄥ": ["ing", "ying"],
};
const MEDIAL_U = {
  "": ["u", "wu"], "ㄚ": ["ua", "wa"], "ㄛ": ["uo", "wo"], "ㄞ": ["uai", "wai"], "ㄟ": ["ui", "wei"],
  "ㄢ": ["uan", "wan"], "ㄣ": ["un", "wen"], "ㄤ": ["uang", "wang"], "ㄥ": ["ong", "weng"],
};
// ㄩ：接 ㄋ ㄌ 寫 v（ü），接 ㄐ ㄑ ㄒ 寫 u，無聲母寫 yu。
const MEDIAL_V = {
  "": ["v", "u", "yu"], "ㄝ": ["ve", "ue", "yue"], "ㄢ": [null, "uan", "yuan"],
  "ㄣ": [null, "un", "yun"], "ㄥ": [null, "iong", "yong"],
};
const TONES = { "": 1, "ˊ": 2, "ˇ": 3, "ˋ": 4, "˙": 5 };
const RETROFLEX_SIBILANT = new Set(["ㄓ", "ㄔ", "ㄕ", "ㄖ", "ㄗ", "ㄘ", "ㄙ"]);
const LABIAL = new Set(["ㄅ", "ㄆ", "ㄇ", "ㄈ"]);
const PALATAL = new Set(["ㄐ", "ㄑ", "ㄒ"]);
const SYLLABLE_RE = /^([ㄅ-ㄙ]?)([ㄧㄨㄩ]?)([ㄚ-ㄦ]?)$/u;

/** 一個音節的注音正規化：去空白，輕聲點 ˙ 一律放最前面（與 udl-learning reading-engine 一致）。 */
export function normalizeSyllable(z) {
  const s = String(z ?? "").replace(/\s+/g, "");
  if (!s.includes("˙")) return s;
  return `˙${s.replace(/˙/g, "")}`;
}

/** 多音節注音（語詞）正規化：每個音節正規化，以單一半形空白分隔。 */
export function normalizeZhuyin(z) {
  return String(z ?? "").trim().split(/\s+/).filter(Boolean).map(normalizeSyllable).join(" ");
}

/**
 * 解析一個注音音節。回傳 { initial, medial, final, tone }，不是合法音節回傳 null。
 * 聲調：一聲無符號＝1、ˊ＝2、ˇ＝3、ˋ＝4、˙（輕聲）＝5。
 */
export function parseSyllable(z) {
  const s = normalizeSyllable(z);
  if (!s) return null;
  let body = s;
  let mark = "";
  if (body.startsWith("˙")) { mark = "˙"; body = body.slice(1); }
  const last = body.slice(-1);
  if ("ˊˇˋ".includes(last)) { if (mark) return null; mark = last; body = body.slice(0, -1); }
  if (!body || /[˙ˊˇˋ]/u.test(body)) return null;
  const m = SYLLABLE_RE.exec(body);
  if (!m) return null;
  const [, initial, medial, final] = m;
  if (!initial && !medial && !final) return null;
  return { initial, medial, final, tone: TONES[mark] };
}

// 只擋會讓拼音寫法出錯的組合（例如 ㄐㄚ、ㄓㄧ、ㄉㄩ），不是完整的音韻表：
// 鍵規則要的是「同一個合法音節永遠得到同一個鍵」。
function rhyme(initial, medial, final) {
  if (PALATAL.has(initial) && medial !== "ㄧ" && medial !== "ㄩ") return null;
  if (!medial) {
    if (!final) return RETROFLEX_SIBILANT.has(initial) ? "i" : null;
    if (initial && (final === "ㄝ" || final === "ㄦ")) return null;
    if (initial && final === "ㄛ" && !LABIAL.has(initial)) return null;
    return FINALS[final];
  }
  if (medial === "ㄧ") {
    if (RETROFLEX_SIBILANT.has(initial)) return null;
    const r = MEDIAL_I[final];
    return r ? r[initial ? 0 : 1] : null;
  }
  if (medial === "ㄨ") {
    if (LABIAL.has(initial) && final) return null;
    const r = MEDIAL_U[final];
    return r ? r[initial ? 0 : 1] : null;
  }
  // ㄩ
  if (initial && !PALATAL.has(initial) && initial !== "ㄋ" && initial !== "ㄌ") return null;
  const r = MEDIAL_V[final];
  if (!r) return null;
  if (!initial) return r[2];
  return PALATAL.has(initial) ? r[1] : r[0];
}

/**
 * 注音音節 → 單音包的 ASCII 鍵：漢語拼音（ü 寫 v、ê 寫 eh）加聲調數字 1–5。
 * 例：ㄒㄧㄥˊ → xing2、ㄌㄩˋ → lv4、ㄓ → zhi1、˙ㄉㄜ → de5。不是合法音節回傳 null。
 */
export function syllableKey(z) {
  const p = parseSyllable(z);
  if (!p) return null;
  const r = rhyme(p.initial, p.medial, p.final);
  if (r == null) return null;
  return `${INITIALS[p.initial] ?? ""}${r}${p.tone}`;
}

const HAN_RE = /^\p{Script=Han}+$/u;

/** 語詞鍵：`詞|注音`（注音每音節一段、半形空白分隔）。字數與音節數不同或注音不合法時拋錯。 */
export function wordKey(word, zhuyin) {
  const w = String(word ?? "");
  if (!HAN_RE.test(w)) throw new Error(`語詞只能是漢字：${w}`);
  const z = normalizeZhuyin(zhuyin);
  const syl = z.split(" ");
  if ([...w].length !== syl.length) throw new Error(`「${w}」有 ${[...w].length} 字，注音卻有 ${syl.length} 個音節`);
  for (const s of syl) if (!syllableKey(s)) throw new Error(`「${w}」的注音 ${s} 不是合法音節`);
  return `${w}|${z}`;
}

/** 語詞音檔的檔名主幹：`w-` 加鍵的 sha256 前 16 碼。ASCII、可重現、與課次無關。 */
export function wordFileStem(word, zhuyin) {
  const key = wordKey(word, zhuyin);
  return `w-${createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16)}`;
}

/**
 * 整課版本碼：以各軌朗讀文字的 sha256 與讀音資料的 sha256 算出（前 12 碼）。
 * 出版社改了一個字或讀音改了，版本碼就不同，不會誤用舊音檔；學年度不參與。
 * @param {string[]} trackTextSha256 各軌 text_sha256（順序不影響結果）
 * @param {string} readingsSha256
 */
export function lessonVersionId(trackTextSha256, readingsSha256) {
  const parts = [...trackTextSha256].sort();
  return createHash("sha256").update(`${parts.join(",")}:${readingsSha256}`, "utf8").digest("hex").slice(0, 12);
}

/** 包內相對路徑檢查：不得是絕對路徑、完整網址、反斜線，也不得有 `.`、`..` 或空的路徑段。 */
export function isPackRelativePath(src) {
  return typeof src === "string" && src.length > 0 && !src.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(src)
    && !src.includes("\\") && src.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
