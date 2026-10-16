// 聽音題 stem.listen（#36）：schema、files 清單、同音字檢查。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePack, checkListenItem, listenSyllableKey, readingsFromCards } from "../conformance/validate.mjs";
import { score } from "../question-types/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(here, "..", "examples", "minimal");
const ITEM = "items/i-listen-01.json";

async function editJson(dir, rel, mutate) {
  const p = path.join(dir, rel);
  const obj = JSON.parse(await readFile(p, "utf8"));
  mutate(obj);
  await writeFile(p, JSON.stringify(obj, null, 2));
}
// 改過檔案後重算 pack.json files 的 sha256；extra 是要新增進清單的路徑。
async function rehash(dir, extra = []) {
  const p = path.join(dir, "pack.json");
  const pack = JSON.parse(await readFile(p, "utf8"));
  for (const rel of extra) pack.files.push({ path: rel, sha256: "0".repeat(64) });
  for (const f of pack.files) f.sha256 = createHash("sha256").update(await readFile(path.join(dir, f.path))).digest("hex");
  await writeFile(p, JSON.stringify(pack, null, 2));
}
async function withCopy(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "udl-listen-"));
  await cp(EXAMPLE, dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const has = (list, ...needles) => list.some((e) => needles.every((n) => e.includes(n)));
const charCard = (id, char, zhuyin) => ({ format_version: 1, id, kind: "char", key: `${char}|${zhuyin}`, char, zhuyin, meaning: { text: "示意", audio: null } });
async function addCard(dir, card) {
  await writeFile(path.join(dir, "cards", `${card.id}.json`), JSON.stringify(card, null, 2));
  await editJson(dir, "pack.json", (o) => { o.cards.push(card.id); });
  await rehash(dir, [`cards/${card.id}.json`]);
}

const listenItem = (options, audio = "audio/xing2.m4a") => ({
  type: "choice", kind: "fixed", answer: "a",
  stem: { text: { text: "聽一聽，選出你聽到的字。", audio: null }, listen: { audio } },
  options: options.map((t, i) => ({ id: "abcdef"[i], text: { text: t, audio: null } })),
});

test("listenSyllableKey：只認單音包的音節檔名", () => {
  assert.equal(listenSyllableKey("audio/xing2.m4a"), "xing2");
  assert.equal(listenSyllableKey("audio/syllables/lv4.mp3"), "lv4");
  assert.equal(listenSyllableKey("audio/w-0123456789abcdef.m4a"), null); // 語詞檔
  assert.equal(listenSyllableKey("audio/words/xing2-zou3.m4a"), null);
  assert.equal(listenSyllableKey("audio/xing2.txt"), null);
  assert.equal(listenSyllableKey(undefined), null);
});

test("readingsFromCards：生字卡與語詞卡的每個字都收進讀音表", () => {
  const r = readingsFromCards([
    charCard("c-a", "行", "ㄒㄧㄥˊ"),
    { kind: "word", word: "銀行", zhuyin: "ㄧㄣˊ ㄏㄤˊ" },
    { kind: "pattern" },
  ]);
  assert.deepEqual([...r.get("行")].sort(), ["hang2", "xing2"]);
  assert.deepEqual([...r.get("銀")], ["yin2"]);
});

test("checkListenItem：播單音時干擾項不得同音；聲調不同可以", () => {
  const readings = readingsFromCards([charCard("c-1", "行", "ㄒㄧㄥˊ"), charCard("c-2", "形", "ㄒㄧㄥˊ"), charCard("c-3", "星", "ㄒㄧㄥ")]);
  assert.deepEqual(checkListenItem(listenItem(["行", "星", "走"]), { readings }), []);
  const errs = checkListenItem(listenItem(["行", "形", "走"]), { readings });
  assert.equal(errs.length, 1);
  assert.ok(has(errs, "選項 b", "形", "xing2", "同音"), errs.join("\n"));
});

test("checkListenItem：破音字只要有一個讀音同音就擋", () => {
  const readings = readingsFromCards([{ kind: "word", word: "銀行", zhuyin: "ㄧㄣˊ ㄏㄤˊ" }]);
  const errs = checkListenItem(listenItem(["航", "行"], "audio/hang2.m4a"), { readings });
  assert.ok(has(errs, "選項 b", "行", "hang2"), errs.join("\n"));
});

test("checkListenItem：注音選項和播放的音相同就擋（聽音選注音）", () => {
  const errs = checkListenItem(listenItem(["ㄒㄧㄥˊ", "ㄒㄧㄥ", "ㄒㄧㄥˊ"]), {});
  assert.equal(errs.length, 1);
  assert.ok(has(errs, "選項 c", "ㄒㄧㄥˊ"), errs.join("\n"));
});

test("checkListenItem：拿不到讀音就略過（語詞音檔、選項沒有卡、不是選擇題）", () => {
  const readings = readingsFromCards([charCard("c-2", "形", "ㄒㄧㄥˊ")]);
  assert.deepEqual(checkListenItem(listenItem(["行", "形"], "audio/w-0123456789abcdef.m4a"), { readings }), []);
  assert.deepEqual(checkListenItem(listenItem(["行", "形"]), {}), []);
  assert.deepEqual(checkListenItem({ ...listenItem(["行", "形"]), type: "match" }, { readings }), []);
});

test("checkListenItem：干擾項池抽進來的項目也檢查", () => {
  const readings = readingsFromCards([charCard("c-2", "形", "ㄒㄧㄥˊ")]);
  const pools = new Map([["p-x", { id: "p-x", entries: [{ text: { text: "走", audio: null } }, { text: { text: "形", audio: null } }] }]]);
  const errs = checkListenItem({ ...listenItem(["行", "星"]), distractor_pool: { pool: "p-x", pick: 1 } }, { readings, pools });
  assert.ok(has(errs, "干擾項池 p-x 第 2 項", "形"), errs.join("\n"));
});

test("範例聽音題通過驗證，判分照舊用 choice 的 score()", async () => {
  const r = await validatePack(EXAMPLE);
  assert.deepEqual(r.errors, []);
  const item = JSON.parse(await readFile(path.join(EXAMPLE, ITEM), "utf8"));
  assert.equal(score(item, { option: "a" }).outcome, "correct");
  assert.equal(score(item, { option: "b" }).outcome, "incorrect");
});

test("選項換成同音字：有卡時報錯，沒有卡時略過", () =>
  withCopy(async (dir) => {
    await editJson(dir, ITEM, (o) => { o.options[1].text.text = "形"; });
    await rehash(dir);
    const skipped = await validatePack(dir);
    assert.deepEqual(skipped.errors, []);
    await addCard(dir, charCard("c-xing2-form", "形", "ㄒㄧㄥˊ"));
    const r = await validatePack(dir);
    assert.ok(has(r.errors, ITEM, "選項 b", "形", "同音"), r.errors.join("\n"));
  }));

test("跨包卡片庫（--cards-from）的讀音也拿來檢查", () =>
  withCopy(async (dir) => {
    const lib = await mkdtemp(path.join(tmpdir(), "udl-listen-lib-"));
    try {
      const card = charCard("c-xing2-form", "形", "ㄒㄧㄥˊ");
      await writeFile(path.join(dir, ITEM), JSON.stringify({ ...JSON.parse(await readFile(path.join(dir, ITEM), "utf8")), options: listenItem(["行", "形"]).options }, null, 2));
      await rehash(dir);
      await cp(path.join(dir, "cards"), path.join(lib, "cards"), { recursive: true });
      await writeFile(path.join(lib, "cards", `${card.id}.json`), JSON.stringify(card, null, 2));
      const libPack = { format_version: 1, id: "lib-zh", version: "0.1.0", title: "卡片庫", subject: "chinese", language: "zh-TW", license: "CC-BY-4.0", source: { generated_by: "test", date: "2026-10-16" }, units: [], cards: [card.id], files: [] };
      await writeFile(path.join(lib, "pack.json"), JSON.stringify(libPack));
      const r = await validatePack(dir, { cardsFrom: [lib] });
      assert.ok(has(r.errors, ITEM, "選項 b", "形"), r.errors.join("\n"));
    } finally {
      await rm(lib, { recursive: true, force: true });
    }
  }));

test("listen.audio 必須列在 pack.json files", () =>
  withCopy(async (dir) => {
    await editJson(dir, ITEM, (o) => { o.stem.listen.audio = "audio/hang2.m4a"; });
    await rehash(dir);
    const r = await validatePack(dir);
    assert.ok(has(r.errors, `${ITEM}/stem/listen`, "audio/hang2.m4a", "不在 pack.json files"), r.errors.join("\n"));
  }));

test("listen 的 schema：audio 必填、只收相對路徑、repeat_max 不可為負、不收其他欄位", () =>
  withCopy(async (dir) => {
    const cases = [
      [(l) => { delete l.audio; }, "audio"],
      [(l) => { l.audio = "/abs/xing2.m4a"; }, "/stem/listen/audio"],
      [(l) => { l.repeat_max = -1; }, "/stem/listen/repeat_max"],
      [(l) => { l.text = "行"; }, "text"],
    ];
    for (const [mutate, needle] of cases) {
      await cp(path.join(EXAMPLE, ITEM), path.join(dir, ITEM));
      await editJson(dir, ITEM, (o) => mutate(o.stem.listen));
      await rehash(dir);
      const r = await validatePack(dir);
      assert.ok(has(r.errors, ITEM, needle), `${needle}\n${r.errors.join("\n")}`);
    }
  }));
