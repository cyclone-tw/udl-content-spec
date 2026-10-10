#!/usr/bin/env node
// 重新產生 pack.json 的 files 清單（路徑＋sha256）。
// 用法：node conformance/update-files.mjs <pack-dir>
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

async function listFiles(root, rel = "") {
  const out = [];
  const entries = await readdir(path.join(root, rel), { withFileTypes: true });
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...(await listFiles(root, r)));
    else if (r !== "pack.json" && r !== "README.md") out.push(r);
  }
  return out;
}

const dir = process.argv[2];
if (!dir) {
  console.error("用法：node conformance/update-files.mjs <pack-dir>");
  process.exit(2);
}
const packPath = path.join(dir, "pack.json");
const pack = JSON.parse(await readFile(packPath, "utf8"));
const files = [];
for (const rel of await listFiles(dir)) {
  const buf = await readFile(path.join(dir, rel));
  files.push({ path: rel, sha256: createHash("sha256").update(buf).digest("hex") });
}
pack.files = files;
await writeFile(packPath, JSON.stringify(pack, null, 2) + "\n");
console.log(`${packPath}: ${files.length} 個檔案已更新 hash`);
