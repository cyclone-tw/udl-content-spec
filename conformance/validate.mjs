#!/usr/bin/env node
// 驗證一個內容包目錄：schema、引用、檔案 hash。
// 用法：node conformance/validate.mjs <pack-dir> [--json] [--strict]
//   --strict：警告也算失敗（例如語音槽為 null）。
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(here, "..", "schema");
const SCHEMAS = ["common", "pack", "unit", "material", "item", "pool", "scope"];

export async function loadValidators() {
  // strictRequired 關閉：item schema 的 if/then 刻意引用根層定義的欄位。
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  for (const name of SCHEMAS) {
    const schema = JSON.parse(await readFile(path.join(schemaDir, `${name}.schema.json`), "utf8"));
    ajv.addSchema(schema);
  }
  const get = (name) => ajv.getSchema(`urn:udl-content-spec:v1:${name}`);
  return { ajv, pack: get("pack"), unit: get("unit"), material: get("material"), item: get("item"), pool: get("pool"), scope: get("scope") };
}

function formatAjvErrors(file, errors) {
  return (errors ?? []).map((e) => {
    const where = e.instancePath || "/";
    const prop = e.params?.additionalProperty ?? e.params?.unevaluatedProperty;
    const extra = prop ? ` (${prop})` : e.params?.allowedValues ? ` [${e.params.allowedValues.join("、")}]` : "";
    return `${file}${where}: ${e.message}${extra}`;
  });
}

async function readJson(dir, rel, errors) {
  try {
    return JSON.parse(await readFile(path.join(dir, rel), "utf8"));
  } catch (err) {
    errors.push(`${rel}: 無法讀取或不是合法 JSON（${err.message}）`);
    return null;
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// 找出 spoken_text 物件並檢查語音槽；順便收集 【詞|key】 標記。
// 每個檔案只發一條「尚未預錄」警告（含數量），避免淹沒其他訊息。
function walkSpoken(node, file, jsonPath, warnings, vocabKeys) {
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

export async function validatePack(dir, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const v = await loadValidators();

  const pack = await readJson(dir, "pack.json", errors);
  if (!pack) return { ok: false, errors, warnings };
  if (!v.pack(pack)) errors.push(...formatAjvErrors("pack.json", v.pack.errors));

  // 檔案清單與 hash
  const listed = new Map();
  for (const f of pack.files ?? []) {
    listed.set(f.path, f.sha256);
    try {
      const buf = await readFile(path.join(dir, f.path));
      const actual = sha256(buf);
      if (actual !== f.sha256) errors.push(`pack.json files ${f.path}: sha256 不符（實際 ${actual.slice(0, 12)}…）`);
    } catch {
      errors.push(`pack.json files ${f.path}: 檔案不存在`);
    }
  }
  const requireListed = (rel, from) => {
    if (!listed.has(rel)) errors.push(`${from}: 引用的檔案 ${rel} 不在 pack.json files 清單`);
  };

  const seenIds = { units: new Set(), materials: new Set(), items: new Set(), pools: new Set() };
  const unitRecords = [];
  for (const unitId of pack.units ?? []) {
    const rel = `units/${unitId}.json`;
    requireListed(rel, "pack.json units");
    const unit = await readJson(dir, rel, errors);
    if (!unit) continue;
    if (!v.unit(unit)) errors.push(...formatAjvErrors(rel, v.unit.errors));
    if (unit.id !== unitId) errors.push(`${rel}: id ${unit.id} 與檔名不符`);
    if (unit.subject !== pack.subject) warnings.push(`${rel}: subject ${unit.subject} 與 pack 的 ${pack.subject} 不同（跨科包允許，請確認）`);
    seenIds.units.add(unitId);
    unitRecords.push({ rel, unit });
  }

  const items = new Map();
  const pools = new Map();
  const materials = new Map();
  for (const { rel: unitRel, unit } of unitRecords) {
    for (const poolId of unit.pools ?? []) {
      const rel = `pools/${poolId}.json`;
      requireListed(rel, unitRel);
      const pool = await readJson(dir, rel, errors);
      if (!pool) continue;
      if (!v.pool(pool)) errors.push(...formatAjvErrors(rel, v.pool.errors));
      if (pool.id !== poolId) errors.push(`${rel}: id ${pool.id} 與檔名不符`);
      pools.set(poolId, pool);
      walkSpoken(pool, rel, "", warnings, null);
    }
    for (const itemId of unit.items ?? []) {
      const rel = `items/${itemId}.json`;
      requireListed(rel, unitRel);
      const item = await readJson(dir, rel, errors);
      if (!item) continue;
      if (!v.item(item)) errors.push(...formatAjvErrors(rel, v.item.errors));
      if (item.id !== itemId) errors.push(`${rel}: id ${item.id} 與檔名不符`);
      if (item.unit !== unit.id) errors.push(`${rel}: unit ${item.unit} 不是所屬單元 ${unit.id}`);
      if (item.kind === "fixed" && item.type === "choice" && Array.isArray(item.options)) {
        const ids = new Set(item.options.map((o) => o.id));
        if (ids.size !== item.options.length) errors.push(`${rel}: options id 重複`);
        if (!ids.has(item.answer)) errors.push(`${rel}: answer ${item.answer} 不在 options`);
      }
      if (item.kind === "fixed" && item.type === "match" && Array.isArray(item.pairs)) {
        const ids = new Set(item.pairs.map((p) => p.id));
        if (ids.size !== item.pairs.length) errors.push(`${rel}: pairs id 重複`);
      }
      if (item.distractor_pool) {
        const poolId = item.distractor_pool.pool;
        if (!(unit.pools ?? []).includes(poolId)) errors.push(`${rel}: distractor_pool ${poolId} 未列在單元 pools`);
      }
      if (item.stem?.image) requireListed(item.stem.image, rel);
      for (const o of item.options ?? []) if (o.image) requireListed(o.image, rel);
      if (!item.ladder_ids?.length && !item.curriculum_codes?.length) warnings.push(`${rel}: 沒有 ladder_ids 或 curriculum_codes，kit 無法對回目標`);
      items.set(itemId, item);
      walkSpoken(item, rel, "", warnings, null);
    }
    for (const materialId of unit.materials ?? []) {
      const rel = `materials/${materialId}.json`;
      requireListed(rel, unitRel);
      const material = await readJson(dir, rel, errors);
      if (!material) continue;
      if (!v.material(material)) errors.push(...formatAjvErrors(rel, v.material.errors));
      if (material.id !== materialId) errors.push(`${rel}: id ${material.id} 與檔名不符`);
      if (material.unit !== unit.id) errors.push(`${rel}: unit ${material.unit} 不是所屬單元 ${unit.id}`);
      const vocabKeys = new Set();
      walkSpoken(material, rel, "", warnings, vocabKeys);
      for (const key of vocabKeys) if (!material.vocab?.[key]) errors.push(`${rel}: 文中標記的詞語 key「${key}」不在 vocab`);
      for (const [i, b] of (material.blocks ?? []).entries()) {
        if (b.type === "check" && !(unit.items ?? []).includes(b.item)) errors.push(`${rel}/blocks/${i}: check 引用的 item ${b.item} 不在單元 items`);
        if ((b.type === "image" || b.type === "audio") && b.src) requireListed(b.src, `${rel}/blocks/${i}`);
        if (b.type === "math-demo") for (const s of b.steps ?? []) if (s.image) requireListed(s.image, `${rel}/blocks/${i}`);
      }
      materials.set(materialId, material);
    }
  }

  // 語音槽路徑是否存在於清單
  const checkAudioPaths = (obj, file) => {
    const stack = [[obj, ""]];
    while (stack.length) {
      const [node, p] = stack.pop();
      if (Array.isArray(node)) node.forEach((x, i) => stack.push([x, `${p}/${i}`]));
      else if (node && typeof node === "object") {
        if (typeof node.text === "string" && typeof node.audio === "string") requireListed(node.audio, `${file}${p}`);
        for (const [k, x] of Object.entries(node)) stack.push([x, `${p}/${k}`]);
      }
    }
  };
  for (const [id, m] of materials) checkAudioPaths(m, `materials/${id}.json`);
  for (const [id, it] of items) checkAudioPaths(it, `items/${id}.json`);
  for (const [id, pl] of pools) checkAudioPaths(pl, `pools/${id}.json`);

  // 清單裡有但沒被引用、也不是已知目錄的檔案：警告
  for (const p of listed.keys()) {
    const known = /^(units|materials|items|pools)\/[a-z0-9-]+\.json$/.test(p) || /^(audio|images)\//.test(p);
    if (!known) warnings.push(`pack.json files ${p}: 不在慣例目錄（units/materials/items/pools/audio/images）`);
  }

  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, counts: { units: seenIds.units.size, materials: materials.size, items: items.size, pools: pools.size } };
}

export async function validateScopeFile(file) {
  const v = await loadValidators();
  const scope = JSON.parse(await readFile(file, "utf8"));
  const ok = v.scope(scope);
  return { ok, errors: ok ? [] : formatAjvErrors(path.basename(file), v.scope.errors) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  const json = args.includes("--json");
  const strict = args.includes("--strict");
  if (!dir) {
    console.error("用法：node conformance/validate.mjs <pack-dir> [--json] [--strict]");
    process.exit(2);
  }
  const st = await stat(dir).catch(() => null);
  if (!st?.isDirectory()) {
    console.error(`${dir} 不是目錄`);
    process.exit(2);
  }
  const result = await validatePack(dir, { strict });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const e of result.errors) console.log(`錯誤  ${e}`);
    for (const w of result.warnings) console.log(`警告  ${w}`);
    console.log(`${result.ok ? "通過" : "未通過"}：${result.counts ? `${result.counts.units} 單元、${result.counts.materials} 教材、${result.counts.items} 題、${result.counts.pools} 池；` : ""}${result.errors.length} 錯誤、${result.warnings.length} 警告`);
  }
  process.exit(result.ok ? 0 : 1);
}
