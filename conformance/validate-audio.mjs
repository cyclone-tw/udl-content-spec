#!/usr/bin/env node
// 驗證音檔包清單（udl-audio-syllables／udl-audio-words／udl-audio-lesson v1）：schema、鍵與注音一致、
// 檔名照規則、相對路徑、無重複；給 --previous 時檢查同一版只新增、不改動既有項目。
// 用法：node conformance/validate-audio.mjs <manifest.json>... [--previous <舊清單>] [--json]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  FORMATS, AUDIO_EXTS, normalizeSyllable, parseSyllable, syllableKey, wordKey, wordFileStem,
  lessonVersionId, isPackRelativePath,
} from "../audio/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = path.join(here, "..", "audio", "schema");
const KIND_BY_FORMAT = Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [f, k]));

let validators = null;
async function loadValidators() {
  if (validators) return validators;
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const f of ["common", "syllables", "words", "lesson"]) {
    ajv.addSchema(JSON.parse(await readFile(path.join(SCHEMA_DIR, `${f}.schema.json`), "utf8")));
  }
  validators = Object.fromEntries(["syllables", "words", "lesson"].map((k) => [k, ajv.getSchema(`urn:udl-content-spec:v1:audio/${k}`)]));
  return validators;
}

function checkSrc(src, where, errors) {
  if (!isPackRelativePath(src)) errors.push(`${where}: src「${src}」必須是包內相對路徑（不得是絕對路徑、網址、含 .. 或反斜線）`);
}

function srcMatches(src, stem) {
  return AUDIO_EXTS.some((ext) => src === `${stem}${ext}`);
}

function checkSyllables(m, errors, warnings) {
  const seenSrc = new Map();
  for (const [z, e] of Object.entries(m.syllables)) {
    const where = `syllables["${z}"]`;
    if (normalizeSyllable(z) !== z) errors.push(`${where}: 注音沒有正規化（應為「${normalizeSyllable(z)}」）`);
    const p = parseSyllable(z);
    const key = syllableKey(z);
    if (!p || !key) { errors.push(`${where}: 不是支援的注音音節`); continue; }
    if (p.tone === 5) errors.push(`${where}: 單音包不收輕聲（輕聲沒有單獨的唸法，走助詞庫）`);
    if (e.key !== key) errors.push(`${where}: key 應為 ${key}，清單寫 ${e.key}`);
    checkSrc(e.src, where, errors);
    if (!srcMatches(e.src, key)) errors.push(`${where}: src 應為 ${key} 加副檔名（${AUDIO_EXTS.join("、")}），清單寫 ${e.src}`);
    if (seenSrc.has(e.src)) errors.push(`${where}: src ${e.src} 與 ${seenSrc.get(e.src)} 重複`);
    else seenSrc.set(e.src, where);
    if (e.check.method === "two-reference") {
      const refs = e.check.references ?? [];
      if (refs.length < 2) errors.push(`${where}: two-reference 至少要兩個代表字`);
      if (e.source_text && !refs.includes(e.source_text)) errors.push(`${where}: source_text「${e.source_text}」不在 references 裡`);
    }
    if (m.voice.engine !== "human" && !e.source_text) errors.push(`${where}: 合成音檔要記 source_text（送去合成的代表字）`);
    if (e.check.status === "review") warnings.push(`${where}: 還要人聽（status=review）`);
  }
  for (const u of m.unresolved ?? []) {
    if (Object.hasOwn(m.syllables, normalizeSyllable(u.zhuyin))) errors.push(`unresolved「${u.zhuyin}」同時出現在 syllables`);
  }
}

function checkWords(m, errors) {
  const seenSrc = new Map();
  for (const [k, e] of Object.entries(m.words)) {
    const where = `words["${k}"]`;
    const parts = k.split("|");
    if (parts.length !== 2) { errors.push(`${where}: 鍵必須是「詞|注音」`); continue; }
    let canonical;
    try { canonical = wordKey(parts[0], parts[1]); } catch (err) { errors.push(`${where}: ${err.message}`); continue; }
    if (canonical !== k) errors.push(`${where}: 鍵沒有正規化（應為「${canonical}」）`);
    checkSrc(e.src, where, errors);
    const stem = wordFileStem(parts[0], parts[1]);
    if (!srcMatches(e.src, stem)) errors.push(`${where}: src 應為 ${stem} 加副檔名，清單寫 ${e.src}`);
    if (seenSrc.has(e.src)) errors.push(`${where}: src ${e.src} 與 ${seenSrc.get(e.src)} 重複`);
    else seenSrc.set(e.src, where);
  }
}

function checkLesson(m, errors) {
  const expected = lessonVersionId(m.tracks.map((t) => t.text_sha256), m.readings_sha256);
  if (m.version_id !== expected) errors.push(`version_id 應為 ${expected}（由各軌 text_sha256 與 readings_sha256 算出），清單寫 ${m.version_id}`);
  const names = new Set();
  const srcs = new Set();
  m.tracks.forEach((t, i) => {
    const where = `tracks[${i}]`;
    if (names.has(t.track)) errors.push(`${where}: 軌名 ${t.track} 重複`);
    names.add(t.track);
    for (const part of ["audio", "timeline"]) {
      checkSrc(t[part].src, `${where}.${part}`, errors);
      if (srcs.has(t[part].src)) errors.push(`${where}.${part}: src ${t[part].src} 重複`);
      srcs.add(t[part].src);
    }
  });
}

// 同一包同一版只能新增：舊清單裡的每一項，新清單都要原樣保留（src 與 sha256 相同）。
function checkAppendOnly(kind, m, prev, errors) {
  if (prev.format !== m.format) { errors.push(`--previous 的格式是 ${prev.format}，與本清單 ${m.format} 不同`); return; }
  if (kind === "lesson") {
    const same = ["publisher", "grade", "semester", "lesson_no"].every((f) => prev.lesson?.[f] === m.lesson[f]);
    if (!same || prev.version_id !== m.version_id) return; // 不同課或不同版本：不受限
    for (const pt of prev.tracks ?? []) {
      const t = m.tracks.find((x) => x.track === pt.track);
      if (!t) errors.push(`同一版本（${m.version_id}）移除了軌 ${pt.track}；要改請產新版本`);
      else if (t.audio.sha256 !== pt.audio.sha256 || t.timeline.sha256 !== pt.timeline.sha256 || t.audio.src !== pt.audio.src || t.timeline.src !== pt.timeline.src) {
        errors.push(`同一版本（${m.version_id}）改動了軌 ${pt.track}；要改請產新版本`);
      }
    }
    return;
  }
  if (prev.pack?.id !== m.pack.id || prev.pack?.version !== m.pack.version) return; // 開了新版本：不受限
  const field = kind === "syllables" ? "syllables" : "words";
  for (const [k, pe] of Object.entries(prev[field] ?? {})) {
    const e = m[field][k];
    if (!e) errors.push(`${m.pack.id}@${m.pack.version} 移除了 ${k}；同一版只能新增，要移除請開新版本`);
    else if (e.src !== pe.src || e.sha256 !== pe.sha256) errors.push(`${m.pack.id}@${m.pack.version} 改動了 ${k}（src 或 sha256 不同）；同一版只能新增，要換請開新版本`);
  }
}

/**
 * 驗證已解析的音檔包清單。回傳 { ok, kind, errors, warnings }。
 * @param {object} manifest
 * @param {{previous?: object|null}} opts
 */
export async function validateAudioManifest(manifest, { previous = null } = {}) {
  const errors = [];
  const warnings = [];
  const kind = KIND_BY_FORMAT[manifest?.format];
  if (!kind) return { ok: false, kind: null, errors: [`format 必須是 ${Object.values(FORMATS).join("、")} 之一`], warnings };
  const v = (await loadValidators())[kind];
  if (!v(manifest)) {
    for (const e of v.errors ?? []) errors.push(`${e.instancePath || "/"} ${e.message}`);
    return { ok: false, kind, errors, warnings };
  }
  if (kind === "syllables") checkSyllables(manifest, errors, warnings);
  else if (kind === "words") checkWords(manifest, errors);
  else checkLesson(manifest, errors);
  if (manifest.voice.engine === "human" && manifest.synthetic) errors.push("voice.engine 是 human，synthetic 卻是 true");
  if (manifest.voice.engine !== "human" && !manifest.synthetic) errors.push(`voice.engine 是 ${manifest.voice.engine}，synthetic 必須是 true（播放端要據此揭露合成語音）`);
  if (previous) checkAppendOnly(kind, manifest, previous, errors);
  return { ok: errors.length === 0, kind, errors, warnings };
}

export async function validateAudioFile(file, opts = {}) {
  return validateAudioManifest(JSON.parse(await readFile(file, "utf8")), opts);
}

async function main(argv) {
  const files = [];
  let previousFile = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") continue; // pnpm 11 會把 `--` 原樣傳進來
    if (argv[i] === "--json") json = true;
    else if (argv[i] === "--previous") {
      previousFile = argv[++i];
      if (!previousFile || previousFile.startsWith("--")) {
        console.error("--previous 後面要接舊清單的路徑");
        return 2;
      }
    } else files.push(argv[i]);
  }
  if (!files.length) {
    console.error("用法：node conformance/validate-audio.mjs <manifest.json>... [--previous <舊清單>] [--json]");
    return 2;
  }
  if (previousFile && files.length !== 1) {
    console.error("--previous 只能搭配一個清單");
    return 2;
  }
  let previous = null;
  if (previousFile) {
    try {
      previous = JSON.parse(await readFile(previousFile, "utf8"));
    } catch (err) {
      console.error(`讀不到舊清單或不是 JSON：${previousFile}（${err.message}）`);
      return 2;
    }
  }
  let bad = 0;
  const out = [];
  for (const f of files) {
    let r;
    try { r = await validateAudioFile(f, { previous }); } catch (err) { r = { ok: false, kind: null, errors: [`讀不到或不是 JSON：${err.message}`], warnings: [] }; }
    out.push({ file: f, ...r });
    if (!r.ok) bad++;
  }
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    for (const r of out) {
      console.log(`${r.ok ? "OK  " : "FAIL"} ${r.file}${r.kind ? `（${r.kind}）` : ""}`);
      for (const e of r.errors) console.log(`  錯誤：${e}`);
      for (const w of r.warnings) console.log(`  提醒：${w}`);
    }
  }
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
