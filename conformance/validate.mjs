#!/usr/bin/env node
// 驗證一個內容包目錄：schema、引用、檔案 hash、產生題參數是否落在能力指標條件檔內。
// 用法：node conformance/validate.mjs <pack-dir> [--json] [--strict] [--ladder-dir <kit data/ladder>] [--cards-from <卡片庫包目錄>]…
//   --strict：警告也算失敗（例如語音槽為 null）。
//   --ladder-dir：kit 的 data/ladder 目錄；給了就檢查所有 ladder_ids 存在於 kit 階梯資料。
//   --cards-from：跨包綁卡（pack@version#id）要解析的卡片庫包目錄，可給多次；沒給的跨包引用只警告。
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generators, profilesFor, checkParams, INSTANCE_SCHEMA_PATH } from "../generators/index.mjs";
import { resolveBindings, planSteps, generate, readingsFromCards, misconceptions as builtinMisconceptions, toItemShape, toInstanceShape, correctResponse, coreCards, profiles as activityProfiles } from "../activities/index.mjs";
import { score } from "../question-types/index.mjs";
import { AUDIO_EXTS, syllableKey, wordKey } from "../audio/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root_ = path.join(here, "..");
const schemaDir = path.join(root_, "schema");
const SCHEMAS = ["common", "pack", "unit", "material", "item", "pool", "scope", "card", "activity-profile"];
// 與 schema/common.schema.json 的 relative_path 同一條規則；讀檔前先用它過濾。
export const RELATIVE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const CONTENT_DIRS = ["units", "materials", "items", "pools", "cards"];
const MEDIA_DIRS = ["audio", "images"];

export async function loadValidators() {
  // strictRequired 關閉：item schema 的 if/then 刻意引用根層定義的欄位。
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const name of SCHEMAS) {
    const schema = JSON.parse(await readFile(path.join(schemaDir, `${name}.schema.json`), "utf8"));
    ajv.addSchema(schema);
  }
  const get = (name) => ajv.getSchema(`urn:udl-content-spec:v1:${name}`);
  // 每個產生器的 params schema（形狀）；值是否在條件檔範圍內另由 checkParams 檢查。
  const params = {};
  for (const g of Object.values(generators)) {
    params[g.id] = ajv.compile(JSON.parse(await readFile(path.join(root_, g.paramsSchemaPath), "utf8")));
  }
  const instance = ajv.compile(JSON.parse(await readFile(path.join(root_, INSTANCE_SCHEMA_PATH), "utf8")));
  return {
    ajv, pack: get("pack"), unit: get("unit"), material: get("material"), item: get("item"), pool: get("pool"), scope: get("scope"),
    card: get("card"), activityProfile: get("activity-profile"), instance, params,
  };
}

/** 讀 kit 的 data/ladder/*.json，回傳所有階梯行為 id 的集合；目錄讀不到就丟錯（參數是人給的）。 */
export async function loadLadderIds(dir) {
  const ids = new Set();
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    let data;
    try {
      data = JSON.parse(await readFile(path.join(dir, e.name), "utf8"));
    } catch (err) {
      throw new Error(`${path.join(dir, e.name)}: 不是合法 JSON（${err.message}）`);
    }
    for (const row of Array.isArray(data) ? data : []) if (typeof row?.id === "string") ids.add(row.id);
  }
  if (!ids.size) throw new Error(`${dir}: 沒有讀到任何階梯行為 id`);
  return ids;
}

/**
 * 產生題的指標與參數檢查（純函式，給驗證器與測試用），回傳 { errors, warnings }：
 * ladder_ids 之中恰一條有條件檔；generator／version 與條件檔一致；params 通過形狀 schema 與條件檔範圍；情境池存在。
 * 例外：legacy 產生器（add-2digit-carry／no-carry，沒有條件檔時代的產物，保留到 v2）的題目沒有條件檔只警告，params 仍過形狀 schema。
 */
export function checkGeneratedItem(item, { validateParams, pools }) {
  const errors = [];
  const warnings = [];
  const gen = generators[item.generator];
  if (!gen) return { errors: [`generator ${item.generator} 未登錄（generators/index.mjs）`], warnings };
  const paramsShape = () => {
    if (validateParams && !validateParams(item.params)) {
      errors.push(...(validateParams.errors ?? []).map((e) => `params${e.instancePath || "/"}: ${e.message}`));
      return false;
    }
    return true;
  };
  const found = profilesFor(item.ladder_ids);
  if (found.length === 0) {
    if (gen?.legacy) {
      warnings.push(`產生器 ${item.generator} 是 legacy（沒有條件檔），v2 移除；請改用 math.add-sub 並標有條件檔的能力指標`);
      // legacy 產生器不提供提示範本：題目自己沒寫就會在 instantiate 時失敗，提早在這裡擋。
      if (!Array.isArray(item.hints) || !item.feedback) errors.push(`legacy 產生器 ${item.generator} 的題目必須自己寫 hints 與 feedback（沒有條件檔範本可用）`);
      paramsShape();
    } else {
      errors.push(`ladder_ids ${JSON.stringify(item.ladder_ids)} 沒有任何一條有條件檔（generators/profiles/）；產生題必須對應有條件檔的能力指標`);
    }
    return { errors, warnings };
  }
  if (found.length > 1) {
    errors.push(`ladder_ids 對到 ${found.length} 份條件檔（${found.map((p) => p.ladder_id).join("、")}）；產生題只能檢測一條有條件檔的指標`);
    return { errors, warnings };
  }
  const profile = found[0];
  if (item.generator !== profile.generator) errors.push(`generator ${item.generator} 與條件檔 ${profile.ladder_id} 指定的 ${profile.generator} 不符`);
  if (item.generator_version !== profile.generator_version) errors.push(`generator_version ${item.generator_version} 與條件檔指定的 ${profile.generator_version} 不符`);
  if (errors.length || !paramsShape()) return { errors, warnings };
  errors.push(...checkParams(profile, item.params).map((m) => `params: ${m}`));
  for (const [key, poolId] of Object.entries(item.params.context_pools ?? {})) {
    if (pools && !pools.has(poolId)) errors.push(`params.context_pools.${key} 引用的池 ${poolId} 不在 pack.json pools`);
  }
  return { errors, warnings };
}

/**
 * 卡片自身的一致性（schema 之外）：鍵與內容相符、語詞注音數與字數相同、技能卡的產生器參數合法。純函式，回傳錯誤字串。
 */
export function checkCard(card, { validateParams } = {}) {
  const errors = [];
  if (card.kind === "char" && card.key !== `${card.char}|${card.zhuyin}`) errors.push(`key 必須是「${card.char}|${card.zhuyin}」`);
  if (card.kind === "word") {
    if (card.key !== `${card.word}|${card.zhuyin}`) errors.push(`key 必須是「${card.word}|${card.zhuyin}」（與語詞音檔同鍵）`);
    const syllables = card.zhuyin.trim().split(/\s+/).length;
    if (syllables !== [...card.word].length) errors.push(`zhuyin 有 ${syllables} 個音節，語詞有 ${[...card.word].length} 個字`);
    if (card.example && !card.example.text.includes(card.word)) errors.push("example 例句裡沒有這個語詞（語詞填空會挖不到空）");
    else if (card.example && card.example.text.indexOf(card.word) !== card.example.text.lastIndexOf(card.word)) errors.push("example 例句裡這個語詞出現不只一次（語詞填空只挖一個空，題幹會漏答案）");
  }
  if (card.kind === "char" && (card.confusables ?? []).some((c) => c.char === card.char)) errors.push("confusables 不可包含字本身");
  if (card.kind === "char" && new Set((card.confusables ?? []).map((c) => c.char)).size !== (card.confusables ?? []).length) errors.push("confusables 有重複的字");
  // 易混淆字的讀音（#49）：要是一個合法音節，而且和 why 的標示一致（音同就要同音，其他標示不得同音）。
  if (card.kind === "char") for (const c of card.confusables ?? []) {
    if (c.zhuyin === undefined) continue;
    const key = syllableKey(c.zhuyin);
    if (!key) {
      errors.push(`confusables「${c.char}」的 zhuyin ${c.zhuyin} 不是一個合法音節`);
      continue;
    }
    const same = key === syllableKey(card.zhuyin);
    if (c.why === "音同" && !same) errors.push(`confusables「${c.char}」標音同，但讀音 ${c.zhuyin} 和「${card.char}」${card.zhuyin} 不同`);
    if (c.why && c.why !== "音同" && same) errors.push(`confusables「${c.char}」讀音和「${card.char}」相同（${c.zhuyin}），why 應標音同`);
  }
  if (card.kind === "skill") {
    const item = { id: card.id, ladder_ids: card.ladder_ids, generator: card.generator, generator_version: card.generator_version, params: card.params };
    errors.push(...checkGeneratedItem(item, { validateParams }).errors);
  }
  return errors;
}

/** 聽音題同音字檢查用的讀音表（實作在 activities/，聽音選字生題也用同一份）。 */
export { readingsFromCards };

/** 聽音檔是單音包的音節檔（檔名就是音節鍵，例如 audio/xing2.m4a）時回傳音節鍵，否則回 null（語詞或無法判斷）。 */
export function listenSyllableKey(audio) {
  const base = String(audio ?? "").split("/").pop();
  const ext = AUDIO_EXTS.find((e) => base.endsWith(e));
  if (!ext) return null;
  const stem = base.slice(0, -ext.length);
  return /^[a-z]+[1-5]$/.test(stem) ? stem : null;
}

/**
 * 聽音題的同音字檢查（純函式，回傳錯誤字串）：播單音時，正解以外的選項（含干擾項池會抽進來的項目）不得和播放的音同音。
 * 只在拿得到讀音時檢查：聽音檔是音節檔、選項是單一個字且讀音表裡有它（或選項本身就是注音）；拿不到就略過。
 */
export function checkListenItem(item, { readings = new Map(), pools = new Map() } = {}) {
  const errors = [];
  const listen = item.stem?.listen;
  if (typeof listen?.word === "string") {
    const [w, z] = listen.word.split("|");
    try {
      if (wordKey(w, z) !== listen.word) errors.push(`stem.listen.word「${listen.word}」要寫成正規化的語詞鍵「${wordKey(w, z)}」（注音每音節一個半形空白）`);
    } catch (err) {
      errors.push(`stem.listen.word「${listen.word}」不是合法的語詞鍵：${err.message}`);
    }
  }
  const key = typeof listen?.syllable === "string" ? listen.syllable : listenSyllableKey(listen?.audio);
  if (!key || item.type !== "choice") return errors;
  const check = (text, where) => {
    const t = String(text ?? "").trim();
    const chars = [...t];
    if (chars.length === 1 && readings.get(t)?.has(key)) {
      errors.push(`${where}「${t}」也讀 ${key}，和播放的單音同音；播單音時選項不得有同音字，要分辨同音字請改播語詞，並在題幹說明寫清楚要選哪個字`);
    } else if (/^[\u3100-\u312f˙ˊˇˋ]+$/u.test(t) && syllableKey(t) === key) {
      errors.push(`${where}「${t}」就是播放的音 ${key}；正解以外的選項不得和播放的音相同`);
    }
  };
  for (const o of asArray(item.options)) if (o?.id !== item.answer) check(o?.text?.text, `選項 ${o?.id}`);
  const pool = item.distractor_pool && pools.get(item.distractor_pool.pool);
  if (pool) for (const [i, e] of asArray(pool.entries).entries()) check(e?.text?.text, `干擾項池 ${pool.id} 第 ${i + 1} 項`);
  return errors;
}

/**
 * 同一次測驗的重複題判斷用的 key（#56、#58）：選擇題看題幹＋正解（干擾項與順序是亂數抽的，不算）；
 * 其他題型看題幹與內容、不看順序。
 */
export function quizRepeatKey(q) {
  const texts = (list) => (list ?? []).map((x) => JSON.stringify([x.text?.text ?? x.left?.text, x.right?.text, x.bin])).sort();
  return JSON.stringify([q.quiz_source, q.stem?.text?.text, q.stem?.listen, q.type === "choice" ? q.options.find((o) => o.id === q.answer)?.text?.text : null, texts(q.pairs), texts(q.sequence), texts(q.objects)]);
}

/**
 * 依單元綁的卡與教材排步驟，並對每個生題步驟實際生一批題：題目要通過題型 schema，正解要拿滿分。
 */
export function checkUnitActivities({ unit, cards, materials, pools, validators, readings, items = [], seed = "validate" }) {
  const errors = [];
  const warnings = [];
  const plan = planSteps({ unit, cards, materials, items, readings });
  if (plan.ladder_status === "draft" && plan.steps.some((x) => x.generates && x.ladder_ids)) warnings.push(`年級活動設定的能力階梯對照還是草稿（ladder_status: draft），待 Cyclone 審`);
  const runs = [{ label: "", coreOnly: false }];
  if (coreCards(unit, cards)) runs.push({ label: "（只用核心卡）", coreOnly: true });
  if (!Array.isArray(unit.activities) && !plan.profile) errors.push(`找不到 ${unit.subject} ${unit.grade} 年級的年級活動設定（activities/profiles/），也沒有寫 activities`);
  if (unit.activity_profile && !activityProfiles[unit.activity_profile]) errors.push(`activity_profile ${unit.activity_profile} 不存在`);
  // 設定寫錯（不是條件不足）：非 quiz 寫 blueprint、不支援的 count "all"、混合練習的來源不合法（#56、#51）。
  for (const x of plan.skipped.filter((k) => k.config)) errors.push(`活動 ${x.activity} 設定錯誤：${x.reason}`);
  for (const step of plan.steps) for (const x of step.sources_skipped ?? []) (x.config ? errors : warnings).push(`活動 ${step.activity}（${step.label}）略過 ${x.activity}：${x.reason}`);
  for (const run of runs) for (const step of plan.steps.filter((x) => x.generates)) {
    const where = `活動 ${step.activity}${run.label}`;
    let list;
    try {
      list = generate(step.activity, { unit, cards, seed, count: step.blueprint ? undefined : step.count, pools, ladders: plan.ladders, readAloud: step.read_aloud_scope, coreOnly: run.coreOnly, readings, items, blueprint: step.blueprint, materials, sources: step.sources });
    } catch (err) {
      // 核心卡太少湊不出某種題，只提醒：老師開「只用核心卡」時這一步會略過。
      (run.coreOnly ? warnings : errors).push(`${where} 生題失敗：${err.message}`);
      continue;
    }
    if (!list.length) errors.push(`${where} 沒有生出任何題目`);
    if (step.blueprint) {
      // 測驗藍圖（#50）：題庫不夠時題數會少於藍圖，提醒老師；同一次測驗同一題不重複。
      for (const b of step.blueprint) {
        const got = list.filter((q) => q.quiz_group === b.group).length;
        if (got < b.count) warnings.push(`${where} 藍圖「${b.group}」要 ${b.count} 題，題庫只出得了 ${got} 題`);
      }
      for (const b of step.blueprint_skipped ?? []) warnings.push(`${where} 藍圖「${b.group}」：${b.reason}`);
      // 用題目內容判斷重複（#56、#58）：選擇題看題幹＋正解（干擾項與順序是亂數抽的，不算）；其他題型看內容、不看順序。
      const keys = list.map(quizRepeatKey);
      if (new Set(keys).size !== keys.length) errors.push(`${where} 同一次測驗出現重複的題目`);
    }
    for (const q of list) {
      const shapeOk = q.generator ? validators.instance(toInstanceShape(q)) : validators.item(toItemShape(q));
      if (!shapeOk) {
        const errs = q.generator ? validators.instance.errors : validators.item.errors;
        errors.push(...formatAjvErrors(`${where} 題目 ${q.id}`, errs));
        continue;
      }
      if (!q.ladder_ids?.length) errors.push(`${where} 題目 ${q.id} 沒有 ladder_ids（年級設定 ladders、卡片或單元至少要有一處標能力階梯）`);
      const r = score(q, correctResponse(q));
      if (r.outcome !== "correct") errors.push(`${where} 題目 ${q.id}：正解沒有拿到滿分（${r.outcome}）`);
      // 卡片生的聽音題也做同音字檢查（#36），讀音表含卡片庫；錯誤類型只能用內建代碼（#49）。
      if (q.stem?.listen) errors.push(...checkListenItem(q, { readings: readings ?? readingsFromCards(Object.values(cards).flat()), pools }).map((m) => `${where} 題目 ${q.id}: ${m}`));
      for (const o of asArray(q.options)) if (o.misconception !== undefined && !Object.hasOwn(builtinMisconceptions, o.misconception)) errors.push(`${where} 題目 ${q.id}: 選項 ${o.id} 的 misconception ${o.misconception} 不是內建錯誤類型`);
    }
  }
  return { errors, warnings, plan };
}

function formatAjvErrors(file, errors) {
  return (errors ?? []).map((e) => {
    const where = e.instancePath || "/";
    const prop = e.params?.additionalProperty ?? e.params?.unevaluatedProperty;
    const extra = prop ? ` (${prop})` : e.params?.allowedValues ? ` [${e.params.allowedValues.join("、")}]` : "";
    return `${file}${where}: ${e.message}${extra}`;
  });
}

// 只接受合法相對路徑，且解析後仍在 pack 目錄內；否則回 null（呼叫端不讀檔）。
// 符號連結不在本函式的範圍：呼叫端不應對不受信任的目錄啟用。
export function resolveInside(root, rel) {
  if (typeof rel !== "string" || !RELATIVE_PATH.test(rel)) return null;
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

// 讀 JSON；失敗時記錄錯誤並回 undefined（JSON 內容可能是 null／false，所以不用 null 當失敗值）。
async function readJson(root, rel, errors) {
  const abs = resolveInside(root, rel);
  if (!abs) {
    errors.push(`${JSON.stringify(rel)}: 路徑不安全或不合法，略過`);
    return undefined;
  }
  try {
    return JSON.parse(await readFile(abs, "utf8"));
  } catch (err) {
    errors.push(`${rel}: 無法讀取或不是合法 JSON（${err.message}）`);
    return undefined;
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// 找出 spoken_text 物件並檢查語音槽；順便收集 【詞|key】 標記。
// 每個檔案只發一條「尚未預錄」警告（含數量），避免淹沒其他訊息。
function walkSpoken(node, file, warnings, vocabKeys) {
  const missing = countMissingAudio(node, vocabKeys);
  if (missing > 0) warnings.push(`${file}: ${missing} 個語音槽 audio 為 null，尚未預錄`);
}
function countMissingAudio(node, vocabKeys) {
  if (Array.isArray(node)) return node.reduce((n, v) => n + countMissingAudio(v, vocabKeys), 0);
  if (!node || typeof node !== "object") return 0;
  let n = 0;
  if (typeof node.text === "string") {
    if ("audio" in node && node.audio === null) n += 1;
    if (vocabKeys) for (const m of node.text.matchAll(/【[^|】]+\|([^】]+)】/g)) vocabKeys.add(m[1]);
  }
  for (const v of Object.values(node)) n += countMissingAudio(v, vocabKeys);
  return n;
}

// 語音槽路徑：每個 spoken_text.audio 字串都必須列在 files。
function collectAudioPaths(node, file, requireListed, jsonPath = "") {
  if (Array.isArray(node)) {
    node.forEach((x, i) => collectAudioPaths(x, file, requireListed, `${jsonPath}/${i}`));
    return;
  }
  if (!node || typeof node !== "object") return;
  if (typeof node.text === "string" && typeof node.audio === "string") requireListed(node.audio, `${file}${jsonPath}`);
  for (const [k, x] of Object.entries(node)) collectAudioPaths(x, file, requireListed, `${jsonPath}/${k}`);
}

// 列出子目錄內的檔案（不限副檔名；漂移偵測用）。
async function listFilesIn(root, sub) {
  try {
    const entries = await readdir(path.join(root, sub), { withFileTypes: true });
    return entries.filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => `${sub}/${e.name}`);
  } catch {
    return [];
  }
}

/** 讀卡片庫包（--cards-from）：回傳 Map，鍵為 pack@version#id 與 pack@latest#id。只做 schema 檢查，完整驗證請對該包另跑。 */
export async function loadCardLibrary(dir, v) {
  const map = new Map();
  const errors = [];
  const root = path.resolve(dir);
  const pack = await readJson(root, "pack.json", errors);
  if (!pack || !v.pack(pack)) throw new Error(`${dir}: 不是合法的內容包（pack.json）`);
  for (const id of asArray(pack.cards)) {
    const card = await readJson(root, `cards/${id}.json`, errors);
    if (card && v.card(card)) {
      map.set(`${pack.id}@${pack.version}#${id}`, card);
      map.set(`${pack.id}@latest#${id}`, card);
    }
  }
  if (errors.length) throw new Error(`${dir}: ${errors.join("；")}`);
  return map;
}

export async function validatePack(dir, { strict = false, ladderDir = null, cardsFrom = [] } = {}) {
  const errors = [];
  const warnings = [];
  const empty = { units: 0, materials: 0, items: 0, pools: 0, cards: 0 };
  const root = path.resolve(dir);
  const v = await loadValidators();
  const ladderIds = ladderDir ? await loadLadderIds(ladderDir) : null;
  const library = new Map();
  for (const libDir of cardsFrom) for (const [k, c] of await loadCardLibrary(libDir, v)) library.set(k, c);
  const checkLadder = (ids, rel) => {
    if (!ladderIds) return;
    for (const id of asArray(ids)) if (!ladderIds.has(id)) errors.push(`${rel}: ladder_id ${id} 不在 kit 階梯資料（${ladderDir}）`);
  };

  const pack = await readJson(root, "pack.json", errors);
  if (pack === undefined) return { ok: false, errors, warnings, counts: empty };
  if (!v.pack(pack)) {
    // pack.json 不合格就不往下做引用與 hash 檢查：後面的欄位形狀沒有保證。
    errors.push(...formatAjvErrors("pack.json", v.pack.errors));
    return { ok: false, errors, warnings, counts: empty };
  }

  // 檔案清單與 hash；路徑先過 resolveInside，不安全的一律不讀。
  const listed = new Map();
  for (const [i, f] of pack.files.entries()) {
    const abs = resolveInside(root, f.path);
    if (!abs) {
      errors.push(`pack.json/files/${i}: 路徑 ${JSON.stringify(f.path)} 不安全或不合法，略過`);
      continue;
    }
    if (listed.has(f.path)) errors.push(`pack.json/files/${i}: 路徑 ${f.path} 重複列出`);
    listed.set(f.path, f.sha256);
    try {
      const actual = sha256(await readFile(abs));
      if (actual !== f.sha256) errors.push(`pack.json files ${f.path}: sha256 不符（實際 ${actual.slice(0, 12)}…）`);
    } catch {
      errors.push(`pack.json files ${f.path}: 檔案不存在`);
    }
  }
  const requireListed = (rel, from) => {
    if (!listed.has(rel)) errors.push(`${from}: 引用的檔案 ${rel} 不在 pack.json files 清單`);
  };

  // 同一個包內 id 唯一（跨單元也不可重複）；池是包層級資源，只在 pack.pools 認領一次。
  const owner = new Map();
  const claimId = (kind, id, rel) => {
    const key = `${kind}:${id}`;
    if (owner.has(key)) {
      errors.push(`${rel}: ${kind} id ${id} 重複（已在 ${owner.get(key)}）`);
      return false;
    }
    owner.set(key, rel);
    return true;
  };

  // 池：包層級載入一次；單元與題目只能引用這裡有的池。
  const pools = new Map();
  for (const poolId of asArray(pack.pools)) {
    const rel = `pools/${poolId}.json`;
    if (!claimId("pool", poolId, "pack.json pools")) continue;
    requireListed(rel, "pack.json pools");
    const pool = await readJson(root, rel, errors);
    if (pool === undefined) continue;
    if (!v.pool(pool)) {
      errors.push(...formatAjvErrors(rel, v.pool.errors));
      continue;
    }
    if (pool.id !== poolId) errors.push(`${rel}: id ${pool.id} 與檔名不符`);
    pools.set(poolId, pool);
    walkSpoken(pool, rel, warnings, null);
  }

  if (!pack.units.length && !asArray(pack.cards).length) errors.push("pack.json: units 是空的時候，cards 至少要有一張（卡片庫包）");

  // 卡片：包層級；鍵在包內唯一。
  const cards = new Map();
  const cardKeys = new Map();
  for (const cardId of asArray(pack.cards)) {
    const rel = `cards/${cardId}.json`;
    if (!claimId("card", cardId, "pack.json cards")) continue;
    requireListed(rel, "pack.json cards");
    const card = await readJson(root, rel, errors);
    if (card === undefined) continue;
    if (!v.card(card)) {
      errors.push(...formatAjvErrors(rel, v.card.errors));
      continue;
    }
    if (card.id !== cardId) errors.push(`${rel}: id ${card.id} 與檔名不符`);
    if (cardKeys.has(card.key)) errors.push(`${rel}: key ${card.key} 與 ${cardKeys.get(card.key)} 重複（同一個字或詞只能有一張卡）`);
    else cardKeys.set(card.key, rel);
    errors.push(...checkCard(card, { validateParams: v.params[card.generator] }).map((m) => `${rel}: ${m}`));
    if (typeof card.image === "string") requireListed(card.image, rel);
    checkLadder(card.ladder_ids, rel);
    walkSpoken(card, rel, warnings, null);
    cards.set(cardId, card);
  }
  const readings = readingsFromCards([...cards.values(), ...library.values()]);
  const lookupCard = (ref) => {
    if (!ref.includes("#")) return cards.get(ref) ?? null;
    return library.get(ref) ?? null;
  };
  const unresolvedCrossRef = (ref, where) => {
    if (ref.includes("#") && !library.has(ref)) {
      warnings.push(`${where}: 跨包卡片 ${ref} 沒有驗證（用 --cards-from 指定卡片庫包）`);
      return true;
    }
    return false;
  };
  for (const [cardId, card] of cards) {
    const rel = `cards/${cardId}.json`;
    for (const ref of asArray(card.words)) {
      if (unresolvedCrossRef(ref, rel)) continue;
      const w = lookupCard(ref);
      if (!w) errors.push(`${rel}: words 引用的 ${ref} 不存在`);
      else if (w.kind !== "word") errors.push(`${rel}: words 引用的 ${ref} 不是語詞卡`);
      else if (!w.word.includes(card.char)) errors.push(`${rel}: 例詞 ${w.word} 不含「${card.char}」`);
    }
  }

  // 單元：schema 不合格就不做後續引用檢查（欄位形狀沒有保證）。
  const unitRecords = [];
  const seenUnits = new Set();
  for (const unitId of pack.units) {
    const rel = `units/${unitId}.json`;
    requireListed(rel, "pack.json units");
    const unit = await readJson(root, rel, errors);
    if (unit === undefined) continue;
    if (!v.unit(unit)) {
      errors.push(...formatAjvErrors(rel, v.unit.errors));
      continue;
    }
    if (unit.id !== unitId) errors.push(`${rel}: id ${unit.id} 與檔名不符`);
    if (unit.subject !== pack.subject) warnings.push(`${rel}: subject ${unit.subject} 與 pack 的 ${pack.subject} 不同（跨科包允許，請確認）`);
    for (const poolId of asArray(unit.pools)) if (!pools.has(poolId)) errors.push(`${rel}: pools 引用的 ${poolId} 不在 pack.json pools`);
    checkLadder(unit.ladder_ids, rel);
    seenUnits.add(unitId);
    unitRecords.push({ rel, unit });
  }

  const items = new Map();
  const materials = new Map();
  for (const { rel: unitRel, unit } of unitRecords) {
    for (const itemId of asArray(unit.items)) {
      const rel = `items/${itemId}.json`;
      if (!claimId("item", itemId, unitRel)) continue;
      requireListed(rel, unitRel);
      const item = await readJson(root, rel, errors);
      if (item === undefined) continue;
      if (!v.item(item)) {
        errors.push(...formatAjvErrors(rel, v.item.errors));
        continue;
      }
      if (item.id !== itemId) errors.push(`${rel}: id ${item.id} 與檔名不符`);
      if (item.unit !== unit.id) errors.push(`${rel}: unit ${item.unit} 不是所屬單元 ${unit.id}`);
      if (item.kind === "fixed" && item.type === "choice") {
        const ids = new Set(item.options.map((o) => o.id));
        if (ids.size !== item.options.length) errors.push(`${rel}: options id 重複`);
        if (!ids.has(item.answer)) errors.push(`${rel}: answer ${item.answer} 不在 options`);
        for (const o of item.options) {
          if (o.misconception === undefined) continue;
          if (o.id === item.answer) errors.push(`${rel}: 正解選項 ${o.id} 不得帶 misconception（錯誤類型只標在錯誤選項）`);
          if (!Object.hasOwn(pack.misconceptions ?? {}, o.misconception) && !Object.hasOwn(builtinMisconceptions, o.misconception)) errors.push(`${rel}: 選項 ${o.id} 的 misconception ${o.misconception} 不在 pack.json misconceptions，也不是內建錯誤類型（activities/ 的 misconceptions）`);
        }
      }
      if (item.kind === "fixed" && item.type === "match") {
        const ids = new Set(item.pairs.map((p) => p.id));
        if (ids.size !== item.pairs.length) errors.push(`${rel}: pairs id 重複`);
      }
      if (item.kind === "fixed" && item.type === "blanks") {
        const ids = new Set(item.blanks.map((b) => b.id));
        if (ids.size !== item.blanks.length) errors.push(`${rel}: blanks id 重複`);
        const placeholders = [...item.stem.text.text.matchAll(/\[\[([^\[\]]*)\]\]/g)].map((m) => m[1]);
        for (const id of ids) {
          if (placeholders.filter((p) => p === id).length !== 1) errors.push(`${rel}: blanks ${id} 必須恰有一個佔位符`);
        }
        for (const id of new Set(placeholders)) {
          if (!ids.has(id)) errors.push(`${rel}: 佔位符 ${id} 不在 blanks`);
        }
      }
      if (item.kind === "fixed" && item.type === "ordering") {
        if (new Set(item.sequence.map((o) => o.id)).size !== item.sequence.length) errors.push(`${rel}: sequence id 重複`);
      }
      if (item.kind === "fixed" && item.type === "classify") {
        const bins = new Set(item.bins.map((b) => b.id));
        if (bins.size !== item.bins.length) errors.push(`${rel}: bins id 重複`);
        if (new Set(item.objects.map((o) => o.id)).size !== item.objects.length) errors.push(`${rel}: objects id 重複`);
        for (const o of item.objects) if (!bins.has(o.bin)) errors.push(`${rel}: object ${o.id} 的 bin ${o.bin} 不在 bins`);
      }
      if (item.distractor_pool && !pools.has(item.distractor_pool.pool)) {
        errors.push(`${rel}: distractor_pool ${item.distractor_pool.pool} 不在 pack.json pools`);
      }
      if (item.kind === "generated") {
        // 指標決定題目長相：產生題的參數必須落在其能力指標條件檔允許的範圍內。
        const g = checkGeneratedItem(item, { validateParams: v.params[item.generator], pools });
        errors.push(...g.errors.map((m) => `${rel}: ${m}`));
        warnings.push(...g.warnings.map((m) => `${rel}: ${m}`));
      }
      if (typeof item.stem?.image === "string") requireListed(item.stem.image, rel);
      if (item.stem?.listen) {
        if (item.stem.listen.audio !== undefined) requireListed(item.stem.listen.audio, `${rel}/stem/listen`);
        errors.push(...checkListenItem(item, { readings, pools }).map((m) => `${rel}: ${m}`));
      }
      for (const o of [...asArray(item.options), ...asArray(item.sequence), ...asArray(item.objects)]) if (typeof o.image === "string") requireListed(o.image, rel);
      checkLadder(item.ladder_ids, rel);
      items.set(itemId, item);
      walkSpoken(item, rel, warnings, null);
    }
    for (const materialId of asArray(unit.materials)) {
      const rel = `materials/${materialId}.json`;
      if (!claimId("material", materialId, unitRel)) continue;
      requireListed(rel, unitRel);
      const material = await readJson(root, rel, errors);
      if (material === undefined) continue;
      if (!v.material(material)) {
        errors.push(...formatAjvErrors(rel, v.material.errors));
        continue;
      }
      if (material.id !== materialId) errors.push(`${rel}: id ${material.id} 與檔名不符`);
      if (material.unit !== unit.id) errors.push(`${rel}: unit ${material.unit} 不是所屬單元 ${unit.id}`);
      const vocabKeys = new Set();
      walkSpoken(material, rel, warnings, vocabKeys);
      const vocab = isObject(material.vocab) ? material.vocab : {};
      for (const key of vocabKeys) if (!vocab[key]) errors.push(`${rel}: 文中標記的詞語 key「${key}」不在 vocab`);
      for (const [i, b] of material.blocks.entries()) {
        if (b.type === "check" && !asArray(unit.items).includes(b.item)) errors.push(`${rel}/blocks/${i}: check 引用的 item ${b.item} 不在單元 items`);
        if ((b.type === "image" || b.type === "audio") && typeof b.src === "string") requireListed(b.src, `${rel}/blocks/${i}`);
        if (b.type === "math-demo") for (const s of b.steps) if (typeof s.image === "string") requireListed(s.image, `${rel}/blocks/${i}`);
      }
      materials.set(materialId, material);
    }
  }

  // 綁卡與活動：每個單元依年級設定排步驟，對生題步驟實際生一批題目檢查。
  for (const { rel, unit } of unitRecords) {
    for (const [slot, id] of Object.entries(unit.quest ?? {})) {
      const m = materials.get(id);
      if (!asArray(unit.materials).includes(id) || !m) errors.push(`${rel}: quest.${slot} 的 ${id} 不在本單元教材`);
      else if (m.kind !== "dialogue") errors.push(`${rel}: quest.${slot} 的 ${id} 是 ${m.kind}，要用 dialogue 教材`);
    }
    const refs = Object.values(unit.bindings ?? {}).flat();
    const skippedCross = new Set(refs.filter((ref) => unresolvedCrossRef(ref, rel)));
    const { cards: bound, errors: bindErrors } = resolveBindings(unit, (ref) => (skippedCross.has(ref) ? { kind: "__skip__" } : lookupCard(ref)));
    errors.push(...bindErrors.filter((m) => !m.includes("__skip__")).map((m) => `${rel}: ${m}`));
    if (skippedCross.size || bindErrors.length) continue;
    if (!refs.length && !Array.isArray(unit.activities)) continue;
    const unitMaterials = [...materials.values()].filter((m) => m.unit === unit.id);
    const skillDemo = bound.skills.map((s) => s.demo).filter(Boolean);
    for (const demo of skillDemo) if (!materials.has(demo)) errors.push(`${rel}: 技能卡的示範教材 ${demo} 不在本包教材`);
    const boundRefs = new Set(refs);
    for (const ref of asArray(unit.core)) if (!boundRefs.has(ref)) errors.push(`${rel}: core 的 ${ref} 不在 bindings`);
    for (const ladderIds of Object.values(unit.ladders ?? {})) checkLadder(ladderIds, rel);
    const { errors: actErrors, warnings: actWarnings } = checkUnitActivities({ unit, cards: bound, materials: unitMaterials, pools, validators: v, readings, items: asArray(unit.items).map((id) => items.get(id)).filter(Boolean) });
    errors.push(...actErrors.map((m) => `${rel}: ${m}`));
    warnings.push(...actWarnings.map((m) => `${rel}: ${m}`));
  }

  for (const [id, m] of materials) collectAudioPaths(m, `materials/${id}.json`, requireListed);
  for (const [id, c] of cards) collectAudioPaths(c, `cards/${id}.json`, requireListed);
  for (const [id, it] of items) collectAudioPaths(it, `items/${id}.json`, requireListed);
  for (const [id, pl] of pools) collectAudioPaths(pl, `pools/${id}.json`, requireListed);

  // 清單裡有但不在慣例目錄：警告。磁碟上有但未列在清單：警告（manifest 漂移）。
  for (const p of listed.keys()) {
    const known = /^(units|materials|items|pools|cards)\/[a-z0-9-]+\.json$/.test(p) || /^(audio|images)\//.test(p);
    if (!known) warnings.push(`pack.json files ${p}: 不在慣例目錄（units/materials/items/pools/cards/audio/images）`);
  }
  for (const sub of [...CONTENT_DIRS, ...MEDIA_DIRS]) {
    for (const rel of await listFilesIn(root, sub)) {
      if (rel.endsWith("README.md")) continue;
      if (!listed.has(rel)) warnings.push(`${rel}: 檔案存在但未列在 pack.json files（manifest 漂移，執行 update-files）`);
    }
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, counts: { units: seenUnits.size, materials: materials.size, items: items.size, pools: pools.size, cards: cards.size } };
}

export async function validateScopeFile(file) {
  const v = await loadValidators();
  let scope;
  try {
    scope = JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    return { ok: false, errors: [`${path.basename(file)}: 無法讀取或不是合法 JSON（${err.message}）`] };
  }
  const ok = v.scope(scope);
  return { ok, errors: ok ? [] : formatAjvErrors(path.basename(file), v.scope.errors) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // 接受 --ladder-dir <dir> 與 --ladder-dir=<dir> 兩種寫法。
  const args = process.argv.slice(2).flatMap((a) => {
    for (const flag of ["--ladder-dir", "--cards-from"]) if (a.startsWith(`${flag}=`)) return [flag, a.slice(flag.length + 1)];
    return [a];
  });
  const ladderIdx = args.indexOf("--ladder-dir");
  const ladderDir = ladderIdx >= 0 ? args[ladderIdx + 1] : null;
  const valueIdx = new Set();
  const cardsFrom = [];
  args.forEach((a, i) => {
    if (a === "--ladder-dir" || a === "--cards-from") valueIdx.add(i + 1);
    if (a === "--cards-from" && args[i + 1]) cardsFrom.push(args[i + 1]);
  });
  const positional = args.filter((a, i) => !a.startsWith("--") && !valueIdx.has(i));
  const dir = positional[0];
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  if (!dir || (ladderIdx >= 0 && !ladderDir)) {
    console.error("用法：node conformance/validate.mjs <pack-dir> [--json] [--strict] [--ladder-dir <kit data/ladder>] [--cards-from <卡片庫包目錄>]…");
    process.exit(2);
  }
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) {
    console.error(`${dir} 不是目錄`);
    process.exit(2);
  }
  if (ladderDir && !(await stat(ladderDir).catch(() => null))?.isDirectory()) {
    console.error(`${ladderDir} 不是目錄`);
    process.exit(2);
  }
  let result;
  try {
    result = await validatePack(dir, { strict, ladderDir, cardsFrom });
  } catch (err) {
    // 只有 --ladder-dir 或 --cards-from 的資料讀不到或壞掉會走到這裡；內容包本身的問題都已是 result.errors。
    console.error(`無法讀取階梯資料或卡片庫：${err.message}`);
    process.exit(2);
  }
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const e of result.errors) console.log(`錯誤  ${e}`);
    for (const w of result.warnings) console.log(`警告  ${w}`);
    const c = result.counts;
    console.log(`${result.ok ? "通過" : "未通過"}：${c.units} 單元、${c.materials} 教材、${c.items} 題、${c.pools} 池、${c.cards} 卡；${result.errors.length} 錯誤、${result.warnings.length} 警告`);
  }
  process.exit(result.ok ? 0 : 1);
}
