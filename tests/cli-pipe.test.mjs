// 命令列經管線（pipe）輸出不能被截斷（udl-content-spec#88）。
// 驗證器印完就呼叫 process.exit() 時，stdout 若是 pipe，還沒寫進 pipe 的部分會被丟掉，只剩前 64 KB；
// udl-learning 的 assemble_lesson.py 讀到不完整的 JSON，所有組課都會失敗。
// 這裡讓輸出超過 64 KB，讀的那一端先停一下才開始讀（pipe 塞滿），結束後檢查 JSON 完整、結束碼正確。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const EXAMPLE = path.join(ROOT, "examples", "cards-demo");
const PIPE = 64 * 1024;

// 跑一支命令列工具，stdout 是 pipe；先暫停讀取 delayMs，讓 pipe 塞滿後才開始讀。
function runPiped(script, args, delayMs = 400) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, script), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out = [], err = [];
    child.stdout.pause();
    child.stdout.on("data", (b) => out.push(b));
    child.stderr.on("data", (b) => err.push(b));
    setTimeout(() => child.stdout.resume(), delayMs);
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
}

// 範例卡片包複製一份，單元綁上 n 張不存在的卡：每張一句錯誤，輸出就會超過 64 KB。
async function bigFailingPack(n) {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-pipe-"));
  await cp(EXAMPLE, dir, { recursive: true });
  const unitPath = path.join(dir, "units", "u-rain-park.json");
  const unit = JSON.parse(await readFile(unitPath, "utf8"));
  for (let i = 0; i < n; i++) unit.bindings.chars.push(`c-missing-${String(i).padStart(5, "0")}`);
  await writeFile(unitPath, JSON.stringify(unit, null, 2));
  const packPath = path.join(dir, "pack.json");
  const pack = JSON.parse(await readFile(packPath, "utf8"));
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
  await writeFile(packPath, JSON.stringify(pack, null, 2));
  return dir;
}

test("validate.mjs --json 經 pipe：超過 64 KB 也完整，結束碼照結果", async () => {
  const dir = await bigFailingPack(3000);
  try {
    const r = await runPiped("conformance/validate.mjs", [dir, "--json"]);
    assert.ok(Buffer.byteLength(r.stdout) > 2 * PIPE, `輸出應超過 128 KB，實際 ${Buffer.byteLength(r.stdout)} bytes`);
    const result = JSON.parse(r.stdout); // 截斷時這裡會丟 SyntaxError
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("c-missing-02999")), "最後一張的錯誤也要在");
    assert.equal(r.code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate.mjs 文字輸出經 pipe：超過 64 KB 也完整，最後一行是摘要", async () => {
  const dir = await bigFailingPack(3000);
  try {
    const r = await runPiped("conformance/validate.mjs", [dir]);
    assert.ok(Buffer.byteLength(r.stdout) > 2 * PIPE);
    const lines = r.stdout.trimEnd().split("\n");
    assert.match(lines.at(-1), /^未通過：/);
    assert.equal(r.code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate-events.mjs --json 經 pipe：多個檔案輸出超過 64 KB 也完整", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-pipe-ev-"));
  try {
    // 不合法的事件檔（不是 JSON）：每個檔一筆錯誤；檔名拉長讓輸出超過 64 KB。
    const files = [];
    for (let i = 0; i < 900; i++) {
      const f = path.join(dir, `bad-events-${"x".repeat(120)}-${i}.json`);
      await writeFile(f, "not json");
      files.push(f);
    }
    const r = await runPiped("conformance/validate-events.mjs", [...files, "--json"]);
    assert.ok(Buffer.byteLength(r.stdout) > 2 * PIPE, `輸出應超過 128 KB，實際 ${Buffer.byteLength(r.stdout)} bytes`);
    const result = JSON.parse(r.stdout);
    assert.equal(Object.keys(result).length, files.length);
    assert.equal(r.code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("用法錯誤照樣回結束碼 2", async () => {
  const r = await runPiped("conformance/validate.mjs", [], 0);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /用法/);
  const e = await runPiped("conformance/validate-events.mjs", [], 0);
  assert.equal(e.code, 2);
});
