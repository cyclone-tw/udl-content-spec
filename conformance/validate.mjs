#!/usr/bin/env node
// 驗證一個內容包目錄：schema、引用、檔案 hash、產生題參數是否落在能力指標條件檔內。
// 用法：node conformance/validate.mjs <pack-dir> [--json] [--strict] [--ladder-dir <kit data/ladder>]
//   --strict：警告也算失敗（例如語音槽為 null）。
//   --ladder-dir：kit 的 data/ladder 目錄；給了就檢查所有 ladder_ids 存在於 kit 階梯資料。
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { generators, profilesFor, checkParams } from "../generators/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root_ = path.join(here, "..");
const schemaDir = path.join(root_, "schema");
const SCHEMAS = ["common", "pack", "unit", "material", "item", "pool", "scope"];
// 與 schema/common.schema.json 的 relative_path 同一條規則；讀檔前先用它過濾。
export const RELATIVE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const CONTENT_DIRS = ["units", "materials", "items", "pools"];
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
  return { ajv, pack: get("pack"), unit: get("unit"), material: get("material"), item: get("item"), pool: get("pool"), scope: get("scope"), params };
}

/** 讀 kit 的 data/ladder/*.json，回傳所有階梯行為 id 的集合；目錄讀不到就丟錯（參數是人給的）。 */
export async function loadLadderIds(dir) {
  const ids = new Set();
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    const data = JSON.parse(await readFile(path.join(dir, e.name), "utf8"));
    for (const row of Array.isArray(data) ? data : []) if (typeof row?.id === "string") ids.add(row.id);
  }
  if (!ids.size) throw new Error(`${dir}: 沒有讀到任何階梯行為 id`);
  return ids;
}

/**
 * 產生題的指標與參數檢查（純函式，給驗證器與測試用）：
 * ladder_ids 之中恰一條有條件檔；generator／version 與條件檔一致；params 通過形狀 schema 與條件檔範圍；情境池存在。
 */
export function checkGeneratedItem(item, { validateParams, pools }) {
  const errors = [];
  const found = profilesFor(item.ladder_ids);
  if (found.length === 0) {
    errors.push(`ladder_ids ${JSON.stringify(item.ladder_ids)} 沒有任何一條有條件檔（generators/profiles/）；產生題必須對應有條件檔的能力指標`);
    return errors;
  }
  if (found.length > 1) {
    errors.push(`ladder_ids 對到 ${found.length} 份條件檔（${found.map((p) => p.ladder_id).join("、")}）；產生題只能檢測一條有條件檔的指標`);
    return errors;
  }
  const profile = found[0];
  if (item.generator !== profile.generator) errors.push(`generator ${item.generator} 與條件檔 ${profile.ladder_id} 指定的 ${profile.generator} 不符`);
  if (item.generator_version !== profile.generator_version) errors.push(`generator_version ${item.generator_version} 與條件檔指定的 ${profile.generator_version} 不符`);
  if (errors.length) return errors;
  if (validateParams && !validateParams(item.params)) {
    errors.push(...(validateParams.errors ?? []).map((e) => `params${e.instancePath || "/"}: ${e.message}`));
    return errors;
  }
  errors.push(...checkParams(profile, item.params).map((m) => `params: ${m}`));
  for (const [key, poolId] of Object.entries(item.params.context_pools ?? {})) {
    if (pools && !pools.has(poolId)) errors.push(`params.context_pools.${key} 引用的池 ${poolId} 不在 pack.json pools`);
  }
  return errors;
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

export async function validatePack(dir, { strict = false, ladderDir = null } = {}) {
  const errors = [];
  const warnings = [];
  const empty = { units: 0, materials: 0, items: 0, pools: 0 };
  const root = path.resolve(dir);
  const v = await loadValidators();
  const ladderIds = ladderDir ? await loadLadderIds(ladderDir) : null;
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
        errors.push(...checkGeneratedItem(item, { validateParams: v.params[item.generator], pools }).map((m) => `${rel}: ${m}`));
      }
      if (typeof item.stem?.image === "string") requireListed(item.stem.image, rel);
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

  for (const [id, m] of materials) collectAudioPaths(m, `materials/${id}.json`, requireListed);
  for (const [id, it] of items) collectAudioPaths(it, `items/${id}.json`, requireListed);
  for (const [id, pl] of pools) collectAudioPaths(pl, `pools/${id}.json`, requireListed);

  // 清單裡有但不在慣例目錄：警告。磁碟上有但未列在清單：警告（manifest 漂移）。
  for (const p of listed.keys()) {
    const known = /^(units|materials|items|pools)\/[a-z0-9-]+\.json$/.test(p) || /^(audio|images)\//.test(p);
    if (!known) warnings.push(`pack.json files ${p}: 不在慣例目錄（units/materials/items/pools/audio/images）`);
  }
  for (const sub of [...CONTENT_DIRS, ...MEDIA_DIRS]) {
    for (const rel of await listFilesIn(root, sub)) {
      if (rel.endsWith("README.md")) continue;
      if (!listed.has(rel)) warnings.push(`${rel}: 檔案存在但未列在 pack.json files（manifest 漂移，執行 update-files）`);
    }
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, counts: { units: seenUnits.size, materials: materials.size, items: items.size, pools: pools.size } };
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
  const args = process.argv.slice(2);
  const ladderIdx = args.indexOf("--ladder-dir");
  const ladderDir = ladderIdx >= 0 ? args[ladderIdx + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith("--") && (ladderIdx < 0 || i !== ladderIdx + 1));
  const dir = positional[0];
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  if (!dir || (ladderIdx >= 0 && !ladderDir)) {
    console.error("用法：node conformance/validate.mjs <pack-dir> [--json] [--strict] [--ladder-dir <kit data/ladder>]");
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
  const result = await validatePack(dir, { strict, ladderDir });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const e of result.errors) console.log(`錯誤  ${e}`);
    for (const w of result.warnings) console.log(`警告  ${w}`);
    const c = result.counts;
    console.log(`${result.ok ? "通過" : "未通過"}：${c.units} 單元、${c.materials} 教材、${c.items} 題、${c.pools} 池；${result.errors.length} 錯誤、${result.warnings.length} 警告`);
  }
  process.exit(result.ok ? 0 : 1);
}
