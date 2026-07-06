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
  showRoom: `${PLUGIN}/show-room`,      // on PLAYER metadata; value: {id} - deep link into the room browser
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
  // Graded score with a length-proximity tiebreak so "Bandits" beats
  // "Bandit Captain" for the monster "Bandit": closest name wins.
  const lenDiff = Math.abs(t.length - m.length);
  if (t === m) return 3000;
  if (t.includes(m)) return 2000 - lenDiff;
  if (m.includes(t)) return 1000 - lenDiff;
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

// Snap a token to the grid lattice. size-1 tokens center on cell centers
// (n + 0.5), size-2 tokens on cell corners (integer) so a 2x2 footprint
// covers whole cells. `occupied` is a Set of "x,y" cell keys shared across
// the whole import so stacked tokens spread to the nearest free cells,
// searched outward ring by ring from the desired spot.
function footprintCells(x, y, size) {
  const half = size / 2;
  const cells = [];
  for (let ix = Math.round(x - half); ix < Math.round(x + half); ix++) {
    for (let iy = Math.round(y - half); iy < Math.round(y + half); iy++) {
      cells.push(`${ix},${iy}`);
    }
  }
  return cells;
}
export function snapTokenCell(cx, cy, size, occupied) {
  const parity = size % 2 === 0 ? 0 : 0.5;
  const bx = Math.round(cx - parity) + parity;
  const by = Math.round(cy - parity) + parity;
  for (let r = 0; r <= 6; r++) {
    const ring = [];
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        ring.push([bx + dx, by + dy]);
      }
    }
    ring.sort((p, q) =>
      Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy));
    for (const [x, y] of ring) {
      const cells = footprintCells(x, y, size);
      if (cells.every((c) => !occupied.has(c))) {
        cells.forEach((c) => occupied.add(c));
        return [x, y];
      }
    }
  }
  return [bx, by];
}

// Align a secret door onto the nearest wall. Overlay-glyph anchors sit
// BESIDE the wall they mark, and the dd2vtt walls run straight through
// secret doorways (no gap - the exporter draws them as solid wall), so a
// door segment placed at the anchor can neither match the wall's
// orientation nor actually open anything. This finds the closest point on
// any wall polyline, cuts a door-sized gap out of that wall (mutating
// `walls` in place), and returns the removed span as the door segment:
// the closed door is then the only thing blocking the gap.
export function alignDoorToWall(walls, x, y, len = 1.0, maxDist = 2.5) {
  let best = null;
  walls.forEach((flat, wi) => {
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], ay = flat[i + 1];
      const dx = flat[i + 2] - ax, dy = flat[i + 3] - ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (!best || d < best.d) best = { d, wi, seg: i / 2, t };
    }
  });
  if (!best || best.d > maxDist) return null;
  // Arc-length parametrization of the chosen polyline so the gap can span
  // vertices (walls near doors are usually straight, but not guaranteed).
  const flat = walls[best.wi];
  const pts = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const segLen = cum[best.seg + 1] - cum[best.seg];
  const sMid = cum[best.seg] + best.t * segLen;
  const s0 = Math.max(0, sMid - len / 2);
  const s1 = Math.min(total, sMid + len / 2);
  const pointAt = (s) => {
    let i = 0;
    while (i + 1 < cum.length - 1 && cum[i + 1] < s) i++;
    const span = cum[i + 1] - cum[i] || 1;
    const t = (s - cum[i]) / span;
    return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t,
             y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
  };
  const a = pointAt(s0), b = pointAt(s1);
  const before = pts.filter((_, i) => cum[i] < s0 - 1e-6).concat([a]);
  const after = [b].concat(pts.filter((_, i) => cum[i] > s1 + 1e-6));
  const pieces = [before, after]
    .filter((p) => p.length >= 2)
    .map((p) => p.flatMap((q) => [R2(q.x), R2(q.y)]));
  walls.splice(best.wi, 1, ...pieces);
  return {
    a: { x: R2(a.x), y: R2(a.y) },
    b: { x: R2(b.x), y: R2(b.y) },
    center: { x: R2((a.x + b.x) / 2), y: R2((a.y + b.y) / 2) },
  };
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
