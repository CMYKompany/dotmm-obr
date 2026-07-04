// Shared constants + helpers for the DotMM importer.
export const PLUGIN = "com.dotmm.importer";
export const K = {
  controller: `${PLUGIN}/controller`,   // marks the hidden controller item; value: {map, level, chunks}
  fogChunk: `${PLUGIN}/fog-chunk`,      // value: {i, n, data} - chunked JSON of {w: walls, l: lights}
  door: `${PLUGIN}/door`,               // on door markers; value: {a:{x,y}, b:{x,y}, open, secret}
  room: `${PLUGIN}/room`,               // on room label items; value: room record from the content pack
  vision: `${PLUGIN}/vision`,           // on character images; value: {cells}
  localTag: `${PLUGIN}/local`,          // on local items we own; value: "wall" | "light" | "vision" | "door-wall"
  cell: `${PLUGIN}/cell`,               // on every positioned item; value: [x, y] intended position in grid cells
  mapImage: `${PLUGIN}/map-image`,      // on map image items; value: {letter, cells: [w,h], origin: [x,y]}
};

export const DPI = 100; // dd2vtt pixels_per_grid for all six maps

// Sub-map origins in the global Level 1 frame (grid cells), derived from the
// "to map X" connector seams and validated against the printed book map.
export const ORIGINS = {
  A: [0, 0],
  B: [1, -45],
  C: [62, -44],
  D: [0, 54],
  E: [54, 25],
  F: [41, 74],
};

// Map letter -> native embedded image pixel dimensions (100 px/cell), used to
// identify map items that carry no metadata (the baseMap-created item).
export const MAP_PIXELS = {
  A: [7000, 6400], B: [6500, 5000], C: [6300, 6800],
  D: [6300, 6200], E: [7300, 5800], F: [7000, 5100],
};

// Monster base sizes in grid cells (default 1). Large creatures of Level 1.
export const MONSTER_SIZE = {
  "Manticore": 2, "Troll": 2, "Ettin": 2, "Gelatinous Cube": 2,
  "Black Pudding": 2, "Air Elemental": 2, "Grick Alpha": 2,
  "Sahuagin Baron": 2, "Mimic": 2,
};

// Normalize a filename or monster name for matching: lowercase alphanumerics only.
export function normalizeName(s) {
  return s.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]/g, "");
}

// Bidirectional substring token matching: "Goblin Token.png" matches "Goblin";
// "Grick" matches "Grick Alpha" only when no closer candidate exists, so we
// score matches and let the caller keep the best one per monster.
export function tokenMatchScore(tokenName, monsterName) {
  const t = normalizeName(tokenName);
  const m = normalizeName(monsterName);
  if (!t || !m) return 0;
  if (t === m) return 3;
  if (t.includes(m)) return 2;
  if (m.includes(t)) return 1;
  return 0;
}

// Deterministic ring offsets (in cells) to spread N tokens around a room anchor.
export function ringOffsets(n) {
  if (n === 1) return [[0, 0]];
  const out = [];
  let placed = 0, ring = 0;
  while (placed < n) {
    ring += 1;
    const cap = ring * 6;
    const take = Math.min(cap, n - placed);
    for (let i = 0; i < take; i++) {
      const a = (2 * Math.PI * i) / take + (ring % 2 ? 0 : Math.PI / take);
      out.push([Math.cos(a) * ring, Math.sin(a) * ring]);
      placed += 1;
    }
  }
  return out;
}

// Split a string into chunks of at most `size` characters.
export function chunkString(s, size) {
  const chunks = [];
  for (let i = 0; i < s.length; i += size) chunks.push(s.slice(i, i + size));
  return chunks;
}

// Parse a dd2vtt JSON object into the compact fog payload used in metadata.
// ALL coordinates are in GRID CELLS (dpi-agnostic): consumers multiply by the
// live scene dpi at materialization time, so any grid dpi renders correctly.
const R2 = (v) => Math.round(v * 100) / 100;
export function extractFog(vtt) {
  const walls = [];
  const polys = [...(vtt.line_of_sight || []), ...(vtt.objects_line_of_sight || [])];
  for (const poly of polys) {
    if (!poly || poly.length < 2) continue;
    const flat = [];
    for (const p of poly) flat.push(R2(p.x), R2(p.y));
    walls.push(flat);
  }
  const lights = (vtt.lights || []).map((l) => ({
    x: R2(l.position.x),
    y: R2(l.position.y),
    r: R2(l.range || 2),
    c: `#${String(l.color || "ffdd99").slice(-6)}`,
    i: l.intensity ?? 1,
  }));
  const doors = (vtt.portals || []).map((p) => ({
    a: { x: R2(p.bounds[0].x), y: R2(p.bounds[0].y) },
    b: { x: R2(p.bounds[1].x), y: R2(p.bounds[1].y) },
    open: false,
    secret: false,
    center: { x: R2(p.position.x), y: R2(p.position.y) },
  }));
  return { walls, lights, doors };
}

// Extract a human-readable message from any rejection shape the OBR SDK or
// browser can produce: Error, string, {error:{message}}, {message}, other.
export function fmtError(err) {
  if (err == null) return "unknown error (rejection carried no value)";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || String(err);
  if (typeof err.message === "string") return err.message;
  if (err.error && typeof err.error.message === "string") return err.error.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// Decode a base64 string into a File, sniffing PNG vs WebP.
export function base64ToFile(b64, name) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const mime = isPng ? "image/png" : "image/webp";
  const ext = isPng ? "png" : "webp";
  return new File([bytes], `${name}.${ext}`, { type: mime });
}
