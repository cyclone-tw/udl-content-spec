import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAudioManifest, validateAudioFile } from "../conformance/validate-audio.mjs";
import {
  normalizeSyllable, normalizeZhuyin, parseSyllable, syllableKey, wordKey, wordFileStem, lessonVersionId, isPackRelativePath,
} from "../audio/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const EX = path.join(root, "audio", "examples");
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const has = (list, ...needles) => list.some((e) => needles.every((n) => e.includes(n)));
const SHA = "a".repeat(64);

test("鍵規則：pypinyin 字典裡 1533 個音節全部對上，不支援的回 null", async () => {
  const fx = await readJson(path.join(here, "fixtures", "zhuyin-pinyin.json"));
  const entries = Object.entries(fx.expected);
  assert.ok(entries.length > 1500);
  const wrong = entries.filter(([z, k]) => syllableKey(z) !== k);
  assert.deepEqual(wrong, []);
  for (const z of fx.unsupported) assert.equal(syllableKey(z), null, z);
});

test("鍵規則：常見例子、ü 寫 v、ê 寫 eh、輕聲 5、聲調位置", () => {
  assert.equal(syllableKey("ㄒㄧㄥˊ"), "xing2");
  assert.equal(syllableKey("ㄏㄤˊ"), "hang2");
  assert.equal(syllableKey("ㄌㄩˋ"), "lv4");
  assert.equal(syllableKey("ㄐㄩˋ"), "ju4");
  assert.equal(syllableKey("ㄩㄝˋ"), "yue4");
  assert.equal(syllableKey("ㄝˋ"), "eh4");
  assert.equal(syllableKey("ㄓ"), "zhi1");
  assert.equal(syllableKey("˙ㄉㄜ"), "de5");
  assert.equal(syllableKey("ㄉㄜ˙"), "de5");
  for (const z of ["", "ㄐㄚ", "ㄓㄧ", "ㄉㄩ", "ㄉㄦ", "ㄐ", "ˊ", "ㄒㄧㄥˊˇ", "˙ㄉㄜˋ", "xing2", "ㄒ ㄧㄥ ˊ x"]) {
    assert.equal(syllableKey(z), null, JSON.stringify(z));
  }
  assert.equal(normalizeSyllable("ㄉㄜ˙"), "˙ㄉㄜ");
  assert.equal(normalizeZhuyin("  ㄧㄣˊ   ㄏㄤˊ "), "ㄧㄣˊ ㄏㄤˊ");
  assert.equal(parseSyllable("ㄒㄧㄥˊ").tone, 2);
});

test("語詞鍵與檔名：可重現、與空白寫法無關、字數要等於音節數", () => {
  assert.equal(wordKey("銀行", "ㄧㄣˊ  ㄏㄤˊ"), "銀行|ㄧㄣˊ ㄏㄤˊ");
  assert.equal(wordFileStem("銀行", "ㄧㄣˊ ㄏㄤˊ"), wordFileStem("銀行", " ㄧㄣˊ   ㄏㄤˊ"));
  assert.notEqual(wordFileStem("銀行", "ㄧㄣˊ ㄏㄤˊ"), wordFileStem("行走", "ㄒㄧㄥˊ ㄗㄡˇ"));
  assert.match(wordFileStem("銀行", "ㄧㄣˊ ㄏㄤˊ"), /^w-[0-9a-f]{16}$/);
  assert.throws(() => wordKey("銀行", "ㄧㄣˊ"), /2 字/);
  assert.throws(() => wordKey("abc", "ㄚ ㄅ ㄘ"), /漢字/);
  assert.throws(() => wordKey("銀行", "ㄧㄣˊ ㄐㄚ"), /不是合法音節/);
});

test("整課版本碼：與軌順序無關，課文或讀音一改就不同", () => {
  const a = "1".repeat(64), b = "2".repeat(64), r = "3".repeat(64);
  assert.equal(lessonVersionId([a, b], r), lessonVersionId([b, a], r));
  assert.notEqual(lessonVersionId([a, b], r), lessonVersionId([a, b], "4".repeat(64)));
  assert.notEqual(lessonVersionId([a, b], r), lessonVersionId([a, "5".repeat(64)], r));
  assert.match(lessonVersionId([a], r), /^[0-9a-f]{12}$/);
});

test("相對路徑：擋絕對路徑、網址、..、反斜線", () => {
  assert.ok(isPackRelativePath("xing2.m4a"));
  assert.ok(isPackRelativePath("sub/xing2.m4a"));
  for (const p of ["/abs/x.m4a", "https://cdn.example/x.m4a", "../x.m4a", "a/../x.m4a", "./x.m4a", "a//x.m4a", "a/", "a\\x.m4a", ""]) {
    assert.equal(isPackRelativePath(p), false, p);
  }
});

test("三個合成範例通過驗證", async () => {
  for (const f of ["syllables.json", "words.json", "lesson.json"]) {
    const r = await validateAudioFile(path.join(EX, f));
    assert.deepEqual(r.errors, [], f);
    assert.ok(r.ok, f);
  }
});

test("單音包：輕聲、錯鍵、錯檔名、重複、網址、代表字不足都擋", async () => {
  const base = await readJson(path.join(EX, "syllables.json"));
  let m = clone(base);
  m.syllables["˙ㄉㄜ"] = { key: "de5", src: "de5.m4a", sha256: SHA, source_text: "的", check: { method: "none", status: "pass" } };
  let r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "/syllables/˙ㄉㄜ/key"), r.errors.join("\n")); // schema 的 key pattern 只收 1–4 聲

  m = clone(base);
  m.syllables["˙ㄉㄜ"] = { key: "de1", src: "de1.m4a", sha256: SHA, source_text: "的", check: { method: "none", status: "pass" } };
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "˙ㄉㄜ", "不收輕聲"));

  m = clone(base);
  m.syllables["ㄒㄧㄥˊ"].key = "sing2";
  m.syllables["ㄒㄧㄥˊ"].src = "sing2.m4a";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "key 應為 xing2"));

  m = clone(base);
  m.syllables["ㄒㄧㄥˊ"].src = "hang2.m4a";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "src 應為 xing2"));
  assert.ok(has(r.errors, "重複"));

  m = clone(base);
  m.syllables["ㄒㄧㄥˊ"].src = "https://cdn.example/xing2.m4a";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "/syllables/ㄒㄧㄥˊ/src"), r.errors.join("\n"));

  for (const bad of ["../xing2.m4a", "a/../xing2.m4a", "./xing2.m4a"]) {
    m = clone(base);
    m.syllables["ㄒㄧㄥˊ"].src = bad;
    r = await validateAudioManifest(m);
    assert.ok(has(r.errors, "/syllables/ㄒㄧㄥˊ/src"), `${bad}: ${r.errors.join("\n")}`); // schema 本身就擋，不靠 JS 工具
  }

  m = clone(base);
  m.syllables["ㄒㄧㄥˊ"].check.references = ["形"];
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "至少要兩個代表字"));

  m = clone(base);
  m.syllables["ㄒㄧㄥˊ"].source_text = "行";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "不在 references"));

  m = clone(base);
  delete m.syllables["ㄒㄧㄥˊ"].source_text;
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "source_text"));

  m = clone(base);
  m.syllables["ㄒㄧㄥˊ"].check.status = "fail";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "/check/status"), r.errors.join("\n"));

  m = clone(base);
  m.syllables = {};
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "/syllables", "fewer than 1"), r.errors.join("\n"));

  m = clone(base);
  m.unresolved.push({ zhuyin: "ㄒㄧㄥˊ", reason: "x" });
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "同時出現"));

  m = clone(base);
  m.syllables["ㄒㄧㄥ ˊ"] = clone(m.syllables["ㄒㄧㄥˊ"]);
  delete m.syllables["ㄒㄧㄥˊ"];
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "沒有正規化"));
});

test("合成與否要和產音來源一致（播放端靠它揭露）", async () => {
  const base = await readJson(path.join(EX, "syllables.json"));
  let m = clone(base);
  m.synthetic = false;
  let r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "synthetic 必須是 true"));

  m = clone(base);
  m.voice.engine = "human";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "human", "synthetic"));
});

test("語詞包：錯檔名、未正規化、字數不符、重複都擋", async () => {
  const base = await readJson(path.join(EX, "words.json"));
  const k = "銀行|ㄧㄣˊ ㄏㄤˊ";
  let m = clone(base);
  m.words[k].src = "yinhang.m4a";
  let r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "src 應為 w-"));

  m = clone(base);
  m.words["銀行|ㄧㄣˊ  ㄏㄤˊ"] = clone(m.words[k]);
  delete m.words[k];
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "沒有正規化"));

  m = clone(base);
  m.words["銀行|ㄧㄣˊ"] = { src: "w-0000000000000000.m4a", sha256: SHA };
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "音節"));

  m = clone(base);
  m.words["銀行"] = { src: "w-0000000000000000.m4a", sha256: SHA };
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "詞|注音"));

  m = clone(base);
  m.words = {};
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "/words", "fewer than 1"), r.errors.join("\n"));

  m = clone(base);
  m.unresolved = [{ key: "銀行|ㄧㄣˊ ㄏㄤˊ", reason: "x" }, { key: "行|ㄒㄧㄥˊ ㄏㄤˊ", reason: "x" }, { key: "大家|ㄉㄚˋ  ㄐㄧㄚ", reason: "x" }, { key: "沒有直線", reason: "x" }];
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "unresolved[0]", "同時出現"));
  assert.ok(has(r.errors, "unresolved[1]", "音節"));
  assert.ok(has(r.errors, "unresolved[2]", "沒有正規化"));
  assert.ok(has(r.errors, "unresolved[3]", "詞|注音"));

  m = clone(base);
  const other = "行走|ㄒㄧㄥˊ ㄗㄡˇ";
  m.words[other].src = m.words[k].src;
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "重複"));
});

test("整課：version_id 要對得上、軌名與路徑不得重複", async () => {
  const base = await readJson(path.join(EX, "lesson.json"));
  let m = clone(base);
  m.readings_sha256 = "f".repeat(64);
  let r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "version_id 應為"));

  m = clone(base);
  m.tracks[1].track = "faithful";
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "軌名"));

  m = clone(base);
  m.tracks[1].audio.src = m.tracks[0].audio.src;
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "重複"));

  m = clone(base);
  m.lesson.school_year = 115;
  r = await validateAudioManifest(m);
  assert.ok(has(r.errors, "/lesson", "additional properties"), r.errors.join("\n")); // 不帶學年度
});

test("同一版只能新增：移除或改動既有項目要開新版本", async () => {
  const prev = await readJson(path.join(EX, "words.json"));
  const k = "銀行|ㄧㄣˊ ㄏㄤˊ";

  let m = clone(prev);
  m.words["大家|ㄉㄚˋ ㄐㄧㄚ"] = { src: `${wordFileStem("大家", "ㄉㄚˋ ㄐㄧㄚ")}.m4a`, sha256: SHA };
  let r = await validateAudioManifest(m, { previous: prev });
  assert.deepEqual(r.errors, []);

  m = clone(prev);
  delete m.words[k];
  r = await validateAudioManifest(m, { previous: prev });
  assert.ok(has(r.errors, "移除了", k));

  m = clone(prev);
  m.words[k].sha256 = SHA;
  r = await validateAudioManifest(m, { previous: prev });
  assert.ok(has(r.errors, "改動了", k));

  m.pack.version = "v2";
  r = await validateAudioManifest(m, { previous: prev });
  assert.deepEqual(r.errors, []);

  const sprev = await readJson(path.join(EX, "syllables.json"));
  const s = clone(sprev);
  s.syllables["ㄒㄧㄥˊ"].sha256 = SHA;
  r = await validateAudioManifest(s, { previous: sprev });
  assert.ok(has(r.errors, "改動了", "ㄒㄧㄥˊ"));

  r = await validateAudioManifest(s, { previous: prev });
  assert.ok(has(r.errors, "格式"));
});

test("整課同一版本不得改內容；課文改了就是新版本", async () => {
  const prev = await readJson(path.join(EX, "lesson.json"));
  let m = clone(prev);
  m.tracks[0].audio.sha256 = SHA;
  let r = await validateAudioManifest(m, { previous: prev });
  assert.ok(has(r.errors, "改動了軌 faithful"));

  m = clone(prev);
  m.tracks.pop();
  m.version_id = lessonVersionId(m.tracks.map((t) => t.text_sha256), m.readings_sha256);
  r = await validateAudioManifest(m, { previous: prev });
  assert.deepEqual(r.errors, []);

  m = clone(prev);
  m.tracks.pop();
  r = await validateAudioManifest(m, { previous: prev });
  assert.ok(has(r.errors, "version_id 應為"));
});

test("指令列：吃得下 pnpm 傳來的 --、--previous 缺值或讀不到時報錯", async () => {
  const { spawnSync } = await import("node:child_process");
  const cli = path.join(root, "conformance", "validate-audio.mjs");
  const words = path.join(EX, "words.json");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  let r = run(words, "--", "--previous", words);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  r = run(words, "--previous");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /後面要接/);
  r = run(words, "--previous", path.join(EX, "nope.json"));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /讀不到舊清單/);
  r = run(path.join(EX, "nope.json"));
  assert.equal(r.status, 1);
});

test("--previous：舊清單不合格、別的包、版本倒退都報錯，不默默略過", async () => {
  const prev = await readJson(path.join(EX, "words.json"));
  const m = clone(prev);
  delete m.words["銀行|ㄧㄣˊ ㄏㄤˊ"];
  let r = await validateAudioManifest(m, { previous: {} });
  assert.ok(has(r.errors, "舊清單本身不合格"), r.errors.join("\n"));
  r = await validateAudioManifest(m, { previous: { format: "udl-audio-words" } });
  assert.ok(has(r.errors, "舊清單本身不合格"));

  const otherPack = clone(prev);
  otherPack.pack.id = "words/other-voice";
  r = await validateAudioManifest(m, { previous: otherPack });
  assert.ok(has(r.errors, "另一個包"));

  const newer = clone(prev);
  newer.pack.version = "v3";
  const older = clone(prev);
  older.pack.version = "v2";
  r = await validateAudioManifest(older, { previous: newer });
  assert.ok(has(r.errors, "比舊清單的 v3 舊"));

  const lesson = await readJson(path.join(EX, "lesson.json"));
  const broken = clone(lesson);
  broken.tracks = [{}];
  r = await validateAudioManifest(lesson, { previous: broken }); // 不得拋例外
  assert.ok(has(r.errors, "舊清單本身不合格"));

  const otherLesson = clone(lesson);
  otherLesson.lesson.lesson_no = 4;
  r = await validateAudioManifest(lesson, { previous: otherLesson });
  assert.ok(has(r.errors, "另一課"));
});

test("整課 revision：同內容重新產出要遞增，不得倒退", async () => {
  const prev = await readJson(path.join(EX, "lesson.json"));
  let m = clone(prev);
  m.tracks[0].audio.sha256 = SHA;
  m.revision = 2;
  let r = await validateAudioManifest(m, { previous: prev });
  assert.deepEqual(r.errors, []);

  const p2 = clone(m);
  m = clone(prev);
  r = await validateAudioManifest(m, { previous: p2 });
  assert.ok(has(r.errors, "revision 1 比舊清單的 2 小"));

  m = clone(p2);
  m.tracks[1].audio.sha256 = SHA;
  r = await validateAudioManifest(m, { previous: p2 });
  assert.ok(has(r.errors, "r2", "改動了軌 simplified"));
});
