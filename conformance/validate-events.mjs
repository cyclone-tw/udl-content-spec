#!/usr/bin/env node
// 驗證一個或多個作答事件檔（udl-attempt-events/v1）：schema、seq 遞增、outcome 與 score 一致、
// 角色與代號、ladder_ids 存在於 kit 階梯資料。
// 用法：node conformance/validate-events.mjs <file.json>... [--json] [--strict] [--ladder-dir <kit data/ladder>]
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadLadderIds } from "./validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root_ = path.join(here, "..");
const SCHEMA_FILE = path.join(root_, "events", "schema", "attempt-events.schema.json");

let compiled = null;
export async function loadEventsValidator() {
  if (compiled) return compiled;
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, allowUnionTypes: true });
  addFormats(ajv);
  compiled = ajv.compile(JSON.parse(await readFile(SCHEMA_FILE, "utf8")));
  return compiled;
}

/**
 * 驗證已解析的事件檔物件。回傳 { ok, errors, warnings, counts }。
 * @param {object} file
 * @param {{ladderIds?: Set<string>|null, strict?: boolean}} opts
 */
export async function validateEvents(file, { ladderIds = null, strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const validate = await loadEventsValidator();
  if (!validate(file)) {
    for (const e of validate.errors ?? []) errors.push(`${e.instancePath || "/"} ${e.message}`);
    return { ok: false, errors, warnings, counts: { events: 0, answered: 0 } };
  }
  const events = file.events;
  let answered = 0;
  let lastSeq = 0;
  let lastTime = null;
  const attempts = new Map();
  events.forEach((ev, i) => {
    const where = `events[${i}]`;
    if (ev.seq !== lastSeq + 1) errors.push(`${where}: seq 必須從 1 嚴格遞增（看到 ${ev.seq}，上一個 ${lastSeq}）`);
    lastSeq = ev.seq;
    const t = Date.parse(ev.time);
    if (lastTime != null && t < lastTime) warnings.push(`${where}: time 比前一個事件早`);
    lastTime = t;
    if (ev.type === "answered") {
      answered += 1;
      const { outcome, score } = ev;
      if (outcome === "correct" && score !== 1) errors.push(`${where}: outcome correct 但 score 不是 1`);
      if ((outcome === "incorrect" || outcome === "invalid" || outcome === "pending-review") && score !== 0) errors.push(`${where}: outcome ${outcome} 但 score 不是 0`);
      if (outcome === "partial" && !(score > 0 && score < 1)) errors.push(`${where}: outcome partial 的 score 必須在 0 與 1 之間（不含）`);
      const n = (attempts.get(ev.item_id) ?? 0) + 1;
      attempts.set(ev.item_id, n);
      if (ev.attempt_no !== n) warnings.push(`${where}: ${ev.item_id} 的 attempt_no 是 ${ev.attempt_no}，依出現順序應為 ${n}`);
      if (ladderIds) for (const id of ev.ladder_ids) if (!ladderIds.has(id)) errors.push(`${where}: ladder_id ${id} 不在 kit 階梯資料`);
      if (file.context.mode === "test" && ev.read_aloud === null) warnings.push(`${where}: 測驗模式的 read_aloud 是 null，kit 無法歸類支持代碼`);
    }
  });
  if (events[0].type !== "session-started") warnings.push("第一個事件不是 session-started");
  if (events[events.length - 1].type !== "session-completed") warnings.push("最後一個事件不是 session-completed");
  if (file.producer.granularity === "unit") warnings.push("粒度 unit：answered 只能對到單元層級的 ladder_ids，不能逐題歸因");
  if (file.actor.role !== "student") warnings.push(`actor.role=${file.actor.role}：教師試玩與訪客的紀錄不匯出給 kit（總規劃 §5.3）`);
  const ok = errors.length === 0 && (!strict || warnings.length === 0);
  return { ok, errors, warnings, counts: { events: events.length, answered } };
}

/** 讀檔並驗證。 */
export async function validateEventsFile(filePath, { ladderDir = null, strict = false } = {}) {
  let file;
  try {
    file = JSON.parse(await readFile(filePath, "utf8"));
  } catch (e) {
    return { ok: false, errors: [`讀不到或不是 JSON：${e.message}`], warnings: [], counts: { events: 0, answered: 0 } };
  }
  const ladderIds = ladderDir ? await loadLadderIds(ladderDir) : null;
  return validateEvents(file, { ladderIds, strict });
}

function parseArgs(argv) {
  const files = [];
  const opts = { json: false, strict: false, ladderDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--strict") opts.strict = true;
    else if (a === "--ladder-dir") opts.ladderDir = argv[++i];
    else if (a.startsWith("--ladder-dir=")) opts.ladderDir = a.slice("--ladder-dir=".length);
    else files.push(a);
  }
  return { files, opts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { files, opts } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error("用法：node conformance/validate-events.mjs <file.json>... [--json] [--strict] [--ladder-dir <dir>]");
    process.exit(2);
  }
  let allOk = true;
  const results = {};
  for (const f of files) {
    const r = await validateEventsFile(f, opts);
    results[f] = r;
    allOk &&= r.ok;
    if (!opts.json) {
      console.log(`${r.ok ? "OK " : "FAIL"} ${f}  events=${r.counts.events} answered=${r.counts.answered}`);
      for (const e of r.errors) console.log(`  error: ${e}`);
      for (const w of r.warnings) console.log(`  warn: ${w}`);
    }
  }
  if (opts.json) console.log(JSON.stringify(results, null, 2));
  process.exit(allOk ? 0 : 1);
}
