// Content-file tests. Run: node tests/content.test.mjs
// 1. Round trip: every bundled level -> Markdown -> parse must reproduce the
//    level's rooms and origins exactly (proves the format can express all of
//    Levels 1-2, and that the Markdown examples are faithful).
// 2. Parser behavior on hand-written / LLM-style input.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseContentFile, levelToDoc, docToMarkdown } from "../contentfile.js";

const root = fileURLToPath(new URL("..", import.meta.url));
let failures = 0;
const check = (cond, msg) => {
  if (!cond) { failures++; console.error(`FAIL: ${msg}`); }
};
const canon = (v) => JSON.stringify(v, (_, x) =>
  x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
    : x);

// ---- 1. round trip of the bundled levels ----
for (const n of [1, 2]) {
  const level = JSON.parse(readFileSync(`${root}packs/level${n}.json`, "utf8"));
  const doc = levelToDoc(level);
  const md = docToMarkdown(doc);
  const back = parseContentFile(md, `level${n}.md`);
  check(back.errors.length === 0, `L${n} md parses without errors: ${back.errors}`);
  check(back.warnings.length === 0, `L${n} md parses without warnings: ${back.warnings.join(" | ")}`);
  check(canon(back.doc.origins) === canon(doc.origins), `L${n} origins round-trip`);
  check(back.doc.title === doc.title, `L${n} title round-trip`);
  check(back.doc.rooms.length === doc.rooms.length, `L${n} room count ${back.doc.rooms.length} vs ${doc.rooms.length}`);
  doc.rooms.forEach((r, i) => {
    check(canon(back.doc.rooms[i]) === canon(r), `L${n} room ${r.id} round-trip\n  want ${canon(r)}\n  got  ${canon(back.doc.rooms[i])}`);
  });
  // The doc must also equal the shipped pack rooms (what the importer used
  // before content files existed), apart from the added "map" key.
  const packRooms = Object.entries(level.packs).flatMap(([L, p]) => p.rooms.map((r) => ({ ...r, map: L })));
  check(canon(packRooms) === canon(doc.rooms), `L${n} levelToDoc matches pack rooms`);
  console.log(`level ${n}: ${doc.rooms.length} rooms round-tripped`);
}

// ---- 2. parser behavior ----
const md = `
# The Sunken Crypt
maps: Upper at 0, 0; Lower = 40,0

Some intro prose the parser should report, not use.

## 1. Entry Hall
map: Upper   at: 12, 8
- 3 Skeleton — shamble toward noise
- Ghoul x2: hide behind the coffins
- Owlbear (Large) - chained up
- Wight (2)
notes: Cold draft from the stairs.
Treasure: 40 gp in a niche.

## 2a Shrine
at: 55.5, 10
- 1 Specter

## Kitchen
- Giant Rat
teleport: Trapdoor to 2a
teleport kind: trapdoor

## 2a. Duplicate
<!-- a comment
spanning lines -->
-
`;
const r = parseContentFile(md, "crypt.md");
check(r.errors.length === 0, "sample parses");
check(r.doc.title === "The Sunken Crypt", "title");
check(canon(r.doc.origins) === canon({ Upper: [0, 0], Lower: [40, 0] }), `origins ${canon(r.doc.origins)}`);
const [a, b, k, d] = r.doc.rooms;
check(a.label === "1" && a.name === "Entry Hall" && a.map === "Upper" && canon(a.grid) === "[12,8]", "room 1 header/map/at");
check(canon(a.monsters) === canon([
  { name: "Skeleton", count: 3, note: "shamble toward noise" },
  { name: "Ghoul", count: 2, note: "hide behind the coffins" },
  { name: "Owlbear", count: 1, note: "chained up", size: 2 },
  { name: "Wight", count: 2 },
]), `room 1 monsters ${canon(a.monsters)}`);
check(a.gm_note === "Cold draft from the stairs. Treasure: 40 gp in a niche.", `room 1 notes "${a.gm_note}"`);
check(b.label === "2a" && b.name === "Shrine" && b.map === null && canon(b.grid) === "[55.5,10]", "room 2a global position");
check(k.label === "Kitchen" && k.name === "Kitchen" && k.grid === null, "unnumbered unplaced room");
check(canon(k.teleport) === canon({ kind: "trapdoor", label: "Trapdoor to 2a" }), "teleport + kind");
check(d.id === "2a-2", `duplicate id renamed (${d.id})`);
check(r.warnings.some((w) => /before the first room/.test(w)), "intro prose reported");
check(r.warnings.some((w) => /used twice/.test(w)), "duplicate id reported");
check(r.warnings.some((w) => /no name/.test(w)), "empty monster line reported");

const j = parseContentFile(JSON.stringify({
  title: "J", maps: { A: [0, 0] },
  rooms: [{ id: "5", name: "Vault", at: { x: 3, y: 4 }, monsters: ["2 Mimic", { name: "Golem", count: "1", size: "huge" }], notes: "Locked." }],
}), "x.json");
check(j.errors.length === 0, "json parses");
check(canon(j.doc.rooms[0].monsters) === canon([{ name: "Mimic", count: 2 }, { name: "Golem", count: 1, size: 3 }]), "json monsters");
check(canon(j.doc.rooms[0].grid) === "[3,4]" && j.doc.rooms[0].gm_note === "Locked.", "json grid/notes");
check(parseContentFile("{ nope", "bad.json").errors.length === 1, "bad json is an error");
check(parseContentFile("just prose\nno rooms", "empty.md").errors.length === 1, "no rooms is an error");

// ---- 3. the examples in the docs must parse cleanly ----
const blocks = (file) => [...readFileSync(`${root}docs/${file}`, "utf8").matchAll(/^```\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
const guideExamples = blocks("CONTENT_FORMAT.md");
const promptExamples = blocks("LLM_PROMPT.md");
check(guideExamples.length >= 5 && promptExamples.length >= 1, `found doc examples (${guideExamples.length}, ${promptExamples.length})`);
for (const [i, ex] of [...guideExamples, ...promptExamples].entries()) {
  // Fragments (a lone monster or notes line) get a room heading so they parse.
  const text = /^#{1,2} /m.test(ex) ? ex : `## 1. Example\n${ex}`;
  const res = parseContentFile(text, "example.md");
  check(res.errors.length === 0 && res.warnings.length === 0,
    `doc example #${i + 1} parses cleanly: ${[...res.errors, ...res.warnings].join(" | ")}\n${ex}`);
}
const fullExample = parseContentFile(guideExamples[0], "x.md").doc;
check(fullExample.rooms.length === 2 && fullExample.rooms[0].monsters[0].count === 3, "guide's short version reads as 2 rooms");

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("all content tests passed");
