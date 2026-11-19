// Content files: room/monster data a person or an LLM writes, in Markdown
// (docs/CONTENT_FORMAT.md) or JSON. Pure module - no OBR SDK - so the
// importer, the round-trip test and the example exporter share one parser.
//
// Every source normalizes to one shape (a "doc"):
//   { title: string|null,
//     origins: { <mapKey>: [x, y] },          // keys as written: letters or file names
//     rooms: [ { id, label, name,
//                map: <mapKey>|null,           // which map the position is relative to
//                grid: [x, y]|null,            // null = unplaced (room browser only)
//                monsters: [{name, count, note?, size?}],
//                gm_note: string,
//                teleport?: {kind, label, pair?} } ] }
// Parsing never throws: problems come back as `warnings` (something was
// dropped or guessed) or `errors` (the file can't be used at all).

const SIZES = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const NUM = "-?\\d+(?:\\.\\d+)?";

function num(v) {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

// "33, 39" | "(33,39)" | "x=33 y=39" | [33, 39] | {x, y} -> [x, y] or null
export function parsePoint(v) {
  if (Array.isArray(v) && v.length >= 2) {
    const x = num(v[0]), y = num(v[1]);
    return x === null || y === null ? null : [x, y];
  }
  if (v && typeof v === "object") {
    const x = num(v.x), y = num(v.y);
    return x === null || y === null ? null : [x, y];
  }
  if (typeof v !== "string") return null;
  const s = v.replace(/[xy]\s*[=:]/gi, " ");
  const m = new RegExp(`^\\s*\\(?\\s*(${NUM})\\s*[,\\s]\\s*(${NUM})\\s*\\)?\\s*$`).exec(s);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// "7 Goblin — building a stage" | "Goblin x7: note" | "Owlbear (Large)" | {..}
export function parseMonster(input) {
  if (input && typeof input === "object") {
    const name = String(input.name ?? "").trim();
    if (!name) return { error: "monster entry has no name" };
    const count = num(input.count ?? 1);
    const m = { name, count: count && count > 0 ? Math.round(count) : 1 };
    if (input.note) m.note = String(input.note).trim();
    const size = typeof input.size === "string" ? SIZES[input.size.toLowerCase()] : num(input.size);
    if (size && size > 1) m.size = size;
    return { monster: m };
  }
  let s = String(input ?? "").trim();
  let note = null;
  const sep = /\s*[—–]\s*|\s+--?\s+|:\s+/.exec(s);
  if (sep) {
    note = s.slice(sep.index + sep[0].length).trim() || null;
    s = s.slice(0, sep.index).trim();
  }
  let size = null;
  s = s.replace(/\s*\((tiny|small|medium|large|huge|gargantuan)\)\s*/i, (_, w) => {
    size = SIZES[w.toLowerCase()];
    return " ";
  }).trim();
  let count = 1;
  let m;
  if ((m = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(s))) { count = Number(m[1]); s = m[2]; }
  else if ((m = /^(.+?)\s*[x×]\s*(\d+)$/i.exec(s))) { count = Number(m[2]); s = m[1]; }
  else if ((m = /^(.+?)\s*\((\d+)\)$/.exec(s))) { count = Number(m[2]); s = m[1]; }
  const name = s.replace(/[.,;]+$/, "").trim();
  if (!name) return { error: "monster line has no name" };
  const out = { name, count: count > 0 ? count : 1 };
  if (note) out.note = note;
  if (size && size > 1) out.size = size;
  return { monster: out };
}

function teleportFrom(v) {
  if (!v) return null;
  if (typeof v === "string") return { kind: "link", label: v.trim() };
  if (typeof v === "object" && v.label) {
    const t = { kind: String(v.kind || "link"), label: String(v.label) };
    if (v.pair) t.pair = String(v.pair);
    return t;
  }
  return null;
}

// Canonical room object (fixed key order, optional keys only when set).
function makeRoom(r) {
  const room = {
    id: r.id, label: r.label, name: r.name ?? "", map: r.map ?? null,
    grid: r.grid ?? null, monsters: r.monsters ?? [], gm_note: r.gm_note ?? "",
  };
  if (r.teleport) room.teleport = r.teleport;
  return room;
}

// Rooms must have unique ids (scene metadata and the room browser key on
// them); rename later duplicates rather than silently merging rooms.
function dedupeIds(rooms, warnings) {
  const seen = new Set();
  for (const r of rooms) {
    if (!seen.has(r.id)) { seen.add(r.id); continue; }
    let n = 2;
    while (seen.has(`${r.id}-${n}`)) n++;
    warnings.push(`Room id "${r.id}" is used twice - the second one was renamed "${r.id}-${n}". Add an "id:" line to choose the name yourself.`);
    r.id = `${r.id}-${n}`;
    seen.add(r.id);
  }
}

function splitHeading(text) {
  let t = text.replace(/\s*\*\([^)]*\)\*\s*$/, "").trim(); // tolerate "*(Merged)*" style suffixes
  t = t.replace(/^(?:room|area)\s+/i, "");
  const m = /^(\S*\d\S*?)[.:)]?(?:\s+(.*))?$/.exec(t);
  if (m) return { label: m[1].replace(/[.:)]+$/, ""), name: (m[2] || "").trim() };
  return { label: t, name: t };
}

const ROOM_KEYS = {
  map: "map", at: "at", position: "at", pos: "at",
  notes: "notes", note: "notes", "gm note": "notes", "gm notes": "notes", description: "notes",
  teleport: "teleport", "teleport kind": "tkind", "teleport pair": "tpair",
  id: "id", name: "name", label: "label", maps: "maps",
};

export function parseMarkdown(text) {
  const doc = { title: null, origins: {}, rooms: [] };
  const warnings = [];
  const errors = [];
  let room = null;
  let inComment = false;

  const addMaps = (value, lineNo) => {
    for (const part of value.split(";")) {
      const p = part.trim();
      if (!p) continue;
      const m = new RegExp(`^(.+?)\\s*(?:\\bat\\b|=|:)\\s*\\(?\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\)?$`, "i").exec(p);
      if (!m) { warnings.push(`Line ${lineNo}: couldn't read map origin "${p}" - expected e.g. "B at 65, 0".`); continue; }
      doc.origins[m[1].replace(/\s*\(.*\)\s*$/, "").trim()] = [Number(m[2]), Number(m[3])];
    }
  };
  const addNote = (s) => { room.gm_note = room.gm_note ? `${room.gm_note} ${s}` : s; };

  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    let line = raw;
    // HTML comments, single- or multi-line, are ignored entirely.
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) return;
      line = line.slice(end + 3);
      inComment = false;
    }
    line = line.replace(/<!--.*?-->/g, "");
    const open = line.indexOf("<!--");
    if (open >= 0) { line = line.slice(0, open); inComment = true; }
    const s = line.trim();
    if (!s) return;

    const h = /^(#{1,6})\s+(.*)$/.exec(s);
    if (h) {
      if (h[1].length === 1 && doc.title === null && doc.rooms.length === 0) {
        doc.title = h[2].trim();
        return;
      }
      const { label, name } = splitHeading(h[2]);
      room = makeRoom({ id: label, label, name });
      doc.rooms.push(room);
      return;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(s)) return; // Markdown horizontal rule

    const bullet = /^[-*+](?:\s+(.*))?$/.exec(s);
    if (bullet) {
      if (!room) { warnings.push(`Line ${lineNo}: monster line before any room heading was ignored: "${s}"`); return; }
      const r = parseMonster(bullet[1] || "");
      if (r.error) warnings.push(`Line ${lineNo} (room ${room.label}): ${r.error} - ignored.`);
      else room.monsters.push(r.monster);
      return;
    }

    const kv = /^([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.*)$/.exec(s);
    const key = kv ? ROOM_KEYS[kv[1].trim().toLowerCase()] : null;
    if (key === "maps") { addMaps(kv[2], lineNo); return; }
    if (!room) {
      if (kv && kv[1].trim().toLowerCase() === "title") { doc.title = kv[2].trim(); return; }
      warnings.push(`Line ${lineNo}: text before the first room heading was ignored: "${s.slice(0, 60)}"`);
      return;
    }
    const value = kv ? kv[2].trim() : "";
    switch (key) {
      case "map": {
        const both = /^(.*?)\s+at\s*:?\s*(.+)$/i.exec(value);
        room.map = (both ? both[1] : value).trim() || null;
        if (both) {
          const p = parsePoint(both[2]);
          if (p) room.grid = p;
          else warnings.push(`Line ${lineNo} (room ${room.label}): couldn't read position "${both[2]}" - room left unplaced.`);
        }
        return;
      }
      case "at": {
        const p = parsePoint(value);
        if (p) room.grid = p;
        else warnings.push(`Line ${lineNo} (room ${room.label}): couldn't read position "${value}" - room left unplaced.`);
        return;
      }
      case "notes": if (value) addNote(value); return;
      case "teleport": room.teleport = { kind: room.teleport?.kind || "link", label: value, ...(room.teleport?.pair ? { pair: room.teleport.pair } : {}) }; return;
      case "tkind": room.teleport = { ...(room.teleport || { label: "" }), kind: value }; return;
      case "tpair": room.teleport = { ...(room.teleport || { kind: "link", label: "" }), pair: value }; return;
      case "id": if (value) room.id = value; return;
      case "label": if (value) room.label = value; return;
      case "name": room.name = value; return;
      default:
        // Anything else inside a room - prose, "Treasure: 50 gp" - is part
        // of the room's notes (documented), so it's kept, not reported.
        addNote(s);
    }
  });

  if (inComment) warnings.push("A comment (<!--) is never closed - everything after it was ignored.");
  for (const r of doc.rooms) {
    if (r.teleport && !r.teleport.label) {
      warnings.push(`Room ${r.label}: "teleport kind/pair" without a "teleport:" label - teleport ignored.`);
      delete r.teleport;
    }
  }
  dedupeIds(doc.rooms, warnings);
  if (doc.rooms.length === 0 && Object.keys(doc.origins).length === 0) {
    errors.push('No rooms found. Rooms start with a heading like "## 7. Guard Room".');
  }
  return { doc, warnings, errors };
}

export function parseJsonContent(text) {
  const warnings = [];
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    return { doc: null, warnings, errors: [`Not valid JSON: ${err.message}`] };
  }
  const doc = { title: null, origins: {}, rooms: [] };
  let rawRooms = [];
  if (obj && obj.packs && typeof obj.packs === "object") {
    // A bundled level file (packs/level<N>.json).
    doc.title = obj.name ?? null;
    doc.origins = { ...(obj.origins || {}) };
    for (const [L, pack] of Object.entries(obj.packs)) {
      for (const r of pack.rooms || []) rawRooms.push({ ...r, map: L });
    }
  } else if (Array.isArray(obj)) {
    rawRooms = obj;
  } else if (obj && typeof obj === "object") {
    doc.title = obj.title ?? obj.name ?? null;
    const maps = obj.maps ?? obj.origins ?? {};
    if (Array.isArray(maps)) {
      for (const m of maps) {
        const p = parsePoint(m?.at ?? m?.origin);
        if (m?.map && p) doc.origins[m.map] = p;
        else warnings.push(`Couldn't read map origin entry ${JSON.stringify(m)}.`);
      }
    } else {
      for (const [k, v] of Object.entries(maps)) {
        const p = parsePoint(v);
        if (p) doc.origins[k] = p;
        else warnings.push(`Couldn't read origin for map "${k}".`);
      }
    }
    rawRooms = Array.isArray(obj.rooms) ? obj.rooms : [];
  } else {
    return { doc: null, warnings, errors: ["JSON content must be an object with a \"rooms\" list."] };
  }

  rawRooms.forEach((r, i) => {
    if (!r || typeof r !== "object") { warnings.push(`Room #${i + 1} is not an object - ignored.`); return; }
    const label = String(r.label ?? r.id ?? r.number ?? `#${i + 1}`);
    const monsters = [];
    for (const m of Array.isArray(r.monsters) ? r.monsters : []) {
      const res = parseMonster(m);
      if (res.error) warnings.push(`Room ${label}: ${res.error} - ignored.`);
      else monsters.push(res.monster);
    }
    const rawPos = r.at ?? r.grid ?? r.position ?? null;
    const grid = rawPos == null ? null : parsePoint(rawPos);
    if (rawPos != null && !grid) warnings.push(`Room ${label}: couldn't read position ${JSON.stringify(rawPos)} - room left unplaced.`);
    doc.rooms.push(makeRoom({
      id: String(r.id ?? label), label, name: String(r.name ?? ""),
      map: r.map ?? null, grid, monsters,
      gm_note: String(r.gm_note ?? r.notes ?? r.note ?? r.description ?? ""),
      teleport: teleportFrom(r.teleport),
    }));
  });
  dedupeIds(doc.rooms, warnings);
  if (doc.rooms.length === 0 && Object.keys(doc.origins).length === 0) {
    return { doc, warnings, errors: ["No rooms found in the JSON content."] };
  }
  return { doc, warnings, errors: [] };
}

// Entry point: decides Markdown vs JSON from the text itself.
export function parseContentFile(text, filename = "") {
  const t = String(text ?? "").replace(/^﻿/, "");
  if (/^\s*[[{]/.test(t) || /\.json$/i.test(filename)) return parseJsonContent(t);
  return parseMarkdown(t);
}

// A bundled level (packs/level<N>.json) as a doc - used to export the DotMM
// levels as Markdown examples and by the round-trip test.
export function levelToDoc(level) {
  return parseJsonContent(JSON.stringify(level)).doc;
}

const fmt = (n) => String(Math.round(n * 100) / 100);

export function docToMarkdown(doc) {
  const out = [];
  if (doc.title) out.push(`# ${doc.title}`, "");
  const origins = Object.entries(doc.origins || {});
  if (origins.length) {
    out.push(`maps: ${origins.map(([k, [x, y]]) => `${k} at ${fmt(x)}, ${fmt(y)}`).join("; ")}`, "");
  }
  for (const r of doc.rooms) {
    const numbered = /\d/.test(r.label);
    out.push(numbered ? `## ${r.label}.${r.name ? ` ${r.name}` : ""}` : `## ${r.label}`);
    if (r.id !== r.label) out.push(`id: ${r.id}`);
    if (!numbered && r.name !== r.label) out.push(`name: ${r.name}`);
    const pos = r.grid ? `at: ${fmt(r.grid[0])}, ${fmt(r.grid[1])}` : "";
    if (r.map && pos) out.push(`map: ${r.map}   ${pos}`);
    else if (r.map) out.push(`map: ${r.map}`);
    else if (pos) out.push(pos);
    for (const m of r.monsters) {
      const word = Object.keys(SIZES).find((k) => SIZES[k] === m.size);
      const size = m.size > 1 && word ? ` (${word[0].toUpperCase()}${word.slice(1)})` : "";
      out.push(`- ${m.count > 1 ? `${m.count} ` : ""}${m.name}${size}${m.note ? ` — ${m.note}` : ""}`);
    }
    if (r.gm_note) out.push(`notes: ${r.gm_note.replace(/\s*\n\s*/g, " ")}`);
    if (r.teleport) {
      out.push(`teleport: ${r.teleport.label}`);
      if (r.teleport.kind && r.teleport.kind !== "link") out.push(`teleport kind: ${r.teleport.kind}`);
      if (r.teleport.pair) out.push(`teleport pair: ${r.teleport.pair}`);
    }
    out.push("");
  }
  return out.join("\n");
}
