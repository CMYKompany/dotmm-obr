import OBR, {
  buildImageUpload,
  buildSceneUpload,
  buildImage,
} from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm";
import { TOKEN_MANIFEST } from "./content.js";
import {
  PLUGIN, K, DPI, PLACE_TOOL,
  normalizeName, tokenMatchScore, chunkString, extractFog,
  base64ToFile, fmtError, alignDoorToWall,
} from "./common.js";
import { buildText, withCell, makeBuilders } from "./builders.js";
import { parseContentFile, docToMarkdown } from "./contentfile.js";

// ---------- state ----------
// A scene comes from ONE source, decided by the first map file recognized:
//  - "dotmm": Level<N>_<letter>_*.dd2vtt files; content + origins come from
//    the bundled packs/level<N>.json (a dropped content file overrides the
//    rooms and/or origins);
//  - "custom": any other dd2vtt files; maps get letters A, B, ... in the
//    order they arrive, and rooms/origins come only from a content file.
const state = {
  source: null,        // {kind: "dotmm", level: "2"} | {kind: "custom"}
  loaded: new Map(),   // letter -> {vtt, pack, file}
  content: null,       // {filename, doc, warnings, errors} from a dropped content file
  tokenMap: new Map(), // normalized monster name -> {dl, score}
  mapImages: new Map(),// letter -> ImageContent picked from the library (combined mode)
  uploadedLetters: new Set(), // letters already sent through uploadImages this session - don't re-upload on retry
  prefix: null,        // library name prefix, fixed at first use so upload and pick agree
  importing: false,
};

const isDotmm = () => state.source?.kind === "dotmm";

// Per-level content ({name, origins, packs}) is fetched from packs/level<N>.json
// on demand as files are recognized, instead of one bundle covering every
// level - keeps the payload proportional to how many levels you've actually
// played, not how many the module has (23 + Yawning Portal/Skullport).
const levelCache = {}; // level string -> {name, origins, packs}
const levelData = () => (isDotmm() ? levelCache[state.source.level] || null : null);
async function fetchLevel(n) {
  if (levelCache[n]) return levelCache[n];
  try {
    const res = await fetch(new URL(`packs/level${n}.json`, import.meta.url));
    if (!res.ok) return null;
    const json = await res.json();
    levelCache[n] = json;
    return json;
  } catch (err) {
    console.error("[DotMM] level pack fetch failed:", n, err);
    return null;
  }
}

const stem = (filename) => filename.replace(/\.[^.]+$/, "");
const slug = (s) => (s || "").replace(/[^A-Za-z0-9]+/g, "").slice(0, 24) || "Custom";
// Library names for uploaded map images: "DotMM-L2-B", "DotMM-Cellar-B".
function assetPrefix() {
  if (!state.prefix) {
    state.prefix = isDotmm()
      ? `DotMM-L${state.source.level}`
      : `DotMM-${slug(state.content?.doc?.title || stem(state.loaded.get("A")?.file.name || ""))}`;
  }
  return state.prefix;
}
const assetName = (L) => `${assetPrefix()}-${L}`;
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// dd2vtt image dpi (px per cell) - read per file, not assumed
const vttDpi = (vtt) => vtt?.resolution?.pixels_per_grid || DPI;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- tiny DOM helpers ----------
const $ = (id) => document.getElementById(id);
const setStatus = (msg, cls = "") => {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${cls}`;
};
const setProgress = (pct) => { $("bar").style.width = `${pct}%`; };

// ---------- tabs ----------
function activateTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  for (const s of ["import", "rooms", "align"]) {
    $(`tab-${s}`).classList.toggle("hidden", name !== s);
  }
}
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    activateTab(tab.dataset.tab);
    if (tab.dataset.tab !== "import") refreshRooms();
  });
}
$("formatGuide").href = new URL("docs/guide.html", import.meta.url).href;

// ---------- file selection (multi) ----------
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragging"); });
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  if (e.dataTransfer.files) loadFiles([...e.dataTransfer.files]);
});
$("file").addEventListener("change", (e) => {
  if (e.target.files) loadFiles([...e.target.files]);
  e.target.value = ""; // allow re-selecting the same file after Clear
});
$("clearFiles").addEventListener("click", (e) => {
  e.preventDefault();
  state.source = null;
  state.loaded.clear();
  state.content = null;
  state.mapImages.clear();
  state.uploadedLetters.clear();
  state.prefix = null;
  setStatus("");
  renderImportPanel();
});

// DotMM map: Level<N>_<letter>_... (Level02_A_ also accepted). Fetches that
// level's bundled pack on demand. The grid-size fallback (renamed files)
// only applies once a DotMM level is already loaded, so arbitrary maps are
// never mistaken for a DotMM sub-map that happens to share a size.
async function detectDotmmPack(filename, vtt) {
  const m = /Level\s*0*(\d+)[_ -]([A-Z])_/i.exec(filename);
  if (m) {
    const data = await fetchLevel(m[1]);
    const pack = data?.packs[m[2].toUpperCase()];
    if (pack) return { level: m[1], pack };
  }
  if (isDotmm()) {
    const sz = vtt?.resolution?.map_size;
    const data = levelCache[state.source.level];
    for (const pack of Object.values(data?.packs || {})) {
      if (sz && pack.grid.w === sz.x && pack.grid.h === sz.y) return { level: state.source.level, pack };
    }
  }
  return null;
}

function customPack(letter, vtt) {
  return {
    map: letter,
    grid: { w: vtt.resolution.map_size.x, h: vtt.resolution.map_size.y, pixels_per_grid: vttDpi(vtt) },
    rooms: [], secret_doors: [], connectors: [], traps: [],
  };
}

const isContentName = (n) => /\.(md|markdown|txt)$/i.test(n);

async function loadFiles(files) {
  const notes = [];
  // Sort so a multi-file drop of custom maps gets letters in name order.
  files.sort((a, b) => a.name.localeCompare(b.name));
  for (const file of files) {
    try {
      const text = await file.text();
      let json = null;
      if (!isContentName(file.name)) {
        try { json = JSON.parse(text); } catch { json = null; }
      }
      const isMap = json && json.resolution && json.image;
      if (!isMap) {
        if (!isContentName(file.name) && !/\.json$/i.test(file.name)) {
          notes.push(`${file.name}: not a map (.dd2vtt) or content file (.md/.json) - ignored.`);
          continue;
        }
        state.content = { filename: file.name, ...parseContentFile(text, file.name) };
        continue;
      }
      const hit = await detectDotmmPack(file.name, json);
      if (hit) {
        if (state.source && !(isDotmm() && state.source.level === hit.level)) {
          notes.push(`${file.name}: ignored - one source per scene (already loaded: ${isDotmm() ? `Level ${state.source.level}` : "custom maps"}).`);
          continue;
        }
        state.source = { kind: "dotmm", level: hit.level };
        state.loaded.set(hit.pack.map, { vtt: json, pack: hit.pack, file });
      } else {
        if (isDotmm()) {
          notes.push(`${file.name}: ignored - not a Level ${state.source.level} map, and a scene can't mix DotMM and custom maps.`);
          continue;
        }
        if ([...state.loaded.values()].some((e) => e.file.name === file.name)) continue;
        const letter = String.fromCharCode(65 + state.loaded.size);
        if (state.loaded.size >= 26) { notes.push(`${file.name}: ignored - 26 maps per scene at most.`); continue; }
        state.source = { kind: "custom" };
        state.loaded.set(letter, { vtt: json, pack: customPack(letter, json), file });
      }
    } catch (err) {
      console.error("[DotMM] file read failed:", file.name, err);
      notes.push(`${file.name}: couldn't be read (${fmtError(err)}).`);
    }
  }
  setStatus(notes.join(" "), notes.length ? "err" : "");
  renderImportPanel();
}

// ---------- the scene plan ----------
// Everything an import needs, derived from loaded maps + optional content
// file: per-map origins, which rooms land on which map, which are unplaced.
function resolveMapKey(key, letters) {
  const k = String(key).trim().toLowerCase();
  for (const L of letters) {
    if (L.toLowerCase() === k) return L;
    const f = state.loaded.get(L).file.name.toLowerCase();
    if (f === k || stem(f) === k) return L;
  }
  return null;
}

function buildPlan() {
  const letters = [...state.loaded.keys()].sort();
  const warnings = [];
  const content = state.content && state.content.errors.length === 0 ? state.content.doc : null;
  const lvl = levelData();
  // A DotMM content file may describe sub-maps you didn't drop this time.
  const knownElsewhere = (key) => !!(lvl && /^[A-Z]$/i.test(key) && lvl.packs[key.toUpperCase()]);

  const origins = {};
  if (lvl) for (const L of letters) origins[L] = lvl.origins[L];
  if (content) {
    for (const [key, p] of Object.entries(content.origins)) {
      const L = resolveMapKey(key, letters);
      if (L) origins[L] = p;
      else if (!knownElsewhere(key)) warnings.push(`maps: "${key}" doesn't match any loaded map file - ignored.`);
    }
  }
  const unset = letters.filter((L) => !origins[L]);
  if (unset.length) {
    // No origin given: lay these maps out left to right after the others.
    let x = 0;
    for (const L of letters) {
      if (origins[L]) x = Math.max(x, origins[L][0] + state.loaded.get(L).pack.grid.w + 2);
    }
    for (const L of unset) {
      origins[L] = [x, 0];
      x += state.loaded.get(L).pack.grid.w + 2;
    }
    if (letters.length > 1) {
      warnings.push(`No origin for map${unset.length > 1 ? "s" : ""} ${unset.join(", ")} - placed side by side; adjust on the Align tab or add a "maps:" line.`);
    }
  }

  const placed = [];   // {L|null, room} - room.grid relative to origins[L] (or global when L is null)
  const unplaced = []; // {L|null, room}
  let skipped = 0;
  if (content) {
    const inMap = (g, L) => {
      const [ox, oy] = origins[L];
      const { w, h } = state.loaded.get(L).pack.grid;
      return g[0] >= ox && g[1] >= oy && g[0] <= ox + w && g[1] <= oy + h;
    };
    for (const room of content.rooms) {
      let L = room.map ? resolveMapKey(room.map, letters) : null;
      let grid = room.grid;
      if (room.map && !L) {
        if (knownElsewhere(room.map)) { skipped++; continue; }
        warnings.push(`Room ${room.label}: map "${room.map}" doesn't match any loaded map - imported without a position.`);
        grid = null;
      }
      if (!room.map && letters.length === 1) L = letters[0];
      else if (!room.map && grid) {
        // "at:" without "map:" in a multi-map scene = whole-scene coordinates.
        L = letters.find((x) => inMap(grid, x)) || null;
        if (L) grid = [grid[0] - origins[L][0], grid[1] - origins[L][1]];
      }
      // Same record shape as a bundled pack room (the file's own "map" key
      // is resolved into L, not carried along).
      const { map: _key, ...rest } = room;
      const r = { ...rest, grid };
      (grid ? placed : unplaced).push({ L, room: r });
    }
  } else if (lvl) {
    for (const L of letters) {
      for (const room of state.loaded.get(L).pack.rooms) placed.push({ L, room });
    }
  }
  return { letters, origins, placed, unplaced, warnings, skipped };
}

// ---------- import panel rendering ----------
function renderImportPanel() {
  const letters = [...state.loaded.keys()].sort();
  const lvl = levelData();
  // Map chips: a DotMM level shows all its sub-maps (loaded ones lit);
  // custom maps show their letter and file.
  const chipLetters = lvl ? Object.keys(lvl.packs) : letters;
  $("mapchips").innerHTML = chipLetters
    .map((L) => {
      const ok = state.loaded.has(L);
      const label = !lvl && ok ? `Map ${L} · ${esc(stem(state.loaded.get(L).file.name))}` : `Map ${L}`;
      return `<span class="mapchip ${ok ? "ok" : ""}"><span class="dot"></span>${label}</span>`;
    })
    .join("");

  if (letters.length === 0) {
    $("dropTitle").textContent = state.content ? "Now drop the map files (.dd2vtt)" : "Drop map files (.dd2vtt) here";
    $("dropSub").textContent = "plus an optional room file (.md or .json) · several maps = one combined scene";
  } else {
    const what = lvl ? `Level ${state.source.level} · ${lvl.name}` : "Custom maps";
    $("dropTitle").textContent = `${what} — ${letters.map((l) => `Map ${l}`).join(", ")}`;
    $("dropSub").textContent = letters.length === 1
      ? "One map — imports as a single scene. Drop more files to build a combined scene."
      : `${letters.length} maps — imports as ONE combined scene.`;
  }
  $("clearFiles").classList.toggle("hidden", letters.length === 0 && !state.content);
  renderContentInfo();
  renderTokenRow();
  const blocked = state.content && state.content.errors.length > 0;
  $("importBtn").disabled = letters.length === 0 || blocked || state.importing;
  $("importBtn").textContent = letters.length > 1 ? `Import combined scene (${letters.length} maps)` : "Import scene";
}

function renderContentInfo() {
  const box = $("contentInfo");
  const c = state.content;
  if (!c) { box.innerHTML = ""; return; }
  if (c.errors.length) {
    box.innerHTML = `<div class="contentbox err"><b>${esc(c.filename)}</b> can't be used:
      <ul>${c.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
      Fix the file and drop it again, or Clear.</div>`;
    return;
  }
  const plan = state.loaded.size ? buildPlan() : null;
  const rooms = c.doc.rooms.length;
  const counts = plan
    ? `${plan.placed.length} placed on the map, ${plan.unplaced.length} without a position${plan.skipped ? `, ${plan.skipped} on maps not loaded` : ""}`
    : `${rooms} room${rooms === 1 ? "" : "s"} — drop the map files next`;
  const warnings = [...c.warnings, ...(plan ? plan.warnings : [])];
  box.innerHTML = `<div class="contentbox">
    <div><b>${esc(c.filename)}</b>${c.doc.title ? ` · ${esc(c.doc.title)}` : ""}</div>
    <div class="hint" style="margin-top:2px">${counts}</div>
    ${warnings.length ? `<details><summary>${warnings.length} note${warnings.length === 1 ? "" : "s"} about this file</summary>
      <ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}
  </div>`;
}

// ---------- token matching ----------
function neededMonsters() {
  if (state.loaded.size === 0 && !state.content) return TOKEN_MANIFEST.monsters.map((m) => m.name);
  const names = new Set();
  if (state.loaded.size) {
    const plan = buildPlan();
    for (const { room } of [...plan.placed, ...plan.unplaced]) {
      for (const mon of room.monsters) names.add(mon.name);
    }
  } else if (state.content?.doc) {
    for (const room of state.content.doc.rooms) for (const mon of room.monsters) names.add(mon.name);
  }
  return [...names].sort();
}

function renderTokenRow() {
  $("tokrow").innerHTML = neededMonsters()
    .map((name) => {
      const hit = state.tokenMap.get(normalizeName(name));
      const title = hit ? `matched: ${hit.dl.name}` : "no image matched - placeholder will be used";
      return `<span class="tok ${hit ? "matched" : "missing"}" title="${esc(title)}">${esc(name)}</span>`;
    })
    .join("");
}

$("pickTokens").addEventListener("click", async () => {
  try {
    const downloads = await OBR.assets.downloadImages(true);
    for (const name of neededMonsters()) {
      const key = normalizeName(name);
      let best = state.tokenMap.get(key) || null;
      for (const dl of downloads) {
        const score = tokenMatchScore(dl.name, name);
        if (score > 0 && (!best || score > best.score)) best = { dl, score };
      }
      if (best) state.tokenMap.set(key, best);
    }
    renderTokenRow();
    const matched = neededMonsters().filter((n) => state.tokenMap.has(normalizeName(n))).length;
    setStatus(`${matched}/${neededMonsters().length} monsters matched (${downloads.length} images scanned).`, matched ? "ok" : "err");
  } catch (err) {
    setStatus(`Token picking failed: ${fmtError(err)}`, "err");
  }
});

// ---------- combined-scene map images ----------
// A SceneUpload carries exactly one file (the baseMap). Additional map images
// must reference URLs from the OBR library: they are uploaded, then picked
// back to obtain URLs. NOTE: uploadImages resolves with nothing - OBR never
// hands back asset URLs from an upload; the picker (downloadImages) is the
// only URL source. Letters already uploaded this session are skipped: a
// retry would otherwise create duplicate library copies each attempt.
async function uploadExtraMapImages(letters) {
  const fresh = letters.filter((L) => !state.uploadedLetters.has(L));
  if (fresh.length === 0) return;
  const uploads = [];
  for (const L of fresh) {
    const { vtt } = state.loaded.get(L);
    const file = base64ToFile(vtt.image, assetName(L));
    uploads.push(buildImageUpload(file).dpi(vttDpi(vtt)).name(assetName(L)).build());
  }
  await OBR.assets.uploadImages(uploads, "MAP");
  fresh.forEach((L) => state.uploadedLetters.add(L));
}

// Open the OBR image picker (pre-searched to the importer's names) and
// record the URLs of any matching images the user selects. Uploads can take
// a while to become searchable after uploadImages resolves, so a picker
// opened right after upload may not show them yet - this surfaces the gap
// and leaves re-opening the picker to the user (never auto-reopen: tried in
// v1.6.2, rejected as UX and it didn't outlast the lag).
async function pickExtraMapImages() {
  const prefix = assetPrefix();
  const downloads = await OBR.assets.downloadImages(true, prefix, "MAP");
  const rx = new RegExp(`${escapeRx(prefix)}-([A-Z])\\b`);
  for (const dl of downloads || []) {
    const m = rx.exec(dl.name);
    if (m) state.mapImages.set(m[1], dl.image);
  }
}

$("uploadMaps").addEventListener("click", async () => {
  const extras = [...state.loaded.keys()].sort().slice(1);
  if (extras.length === 0) {
    setStatus("Load two or more maps first — a single map does not need this step.", "err");
    return;
  }
  try {
    setStatus("Confirm the upload dialog in Owlbear Rodeo…");
    await uploadExtraMapImages(extras);
    setStatus(`Uploaded. If they don't show up yet in "Pick uploaded maps", your library may still be indexing them — wait a moment and click Pick again.`, "ok");
  } catch (err) {
    setStatus(`Map upload failed: ${fmtError(err)}`, "err");
  }
});

$("pickMaps").addEventListener("click", async () => {
  try {
    await pickExtraMapImages();
    const extras = [...state.loaded.keys()].sort().slice(1);
    const have = extras.filter((L) => state.mapImages.has(L));
    setStatus(
      extras.length === 0
        ? "Single-map import does not need library images."
        : `Map images matched: ${have.join(", ") || "none"} (need ${extras.join(", ")}).`,
      have.length === extras.length ? "ok" : "err"
    );
  } catch (err) {
    setStatus(`Map picking failed: ${fmtError(err)}`, "err");
  }
});

// ---------- scene items ----------
const tokenImageFromMatches = (name) => state.tokenMap.get(normalizeName(name))?.dl.image || null;

function extraMapImageItem(letter, imageContent, pack, origin, dpi) {
  const [ox, oy] = origin;
  const item = buildImage(imageContent, { dpi: pack.grid.pixels_per_grid || DPI, offset: { x: 0, y: 0 } })
    .layer("MAP")
    .locked(true)
    .name(assetName(letter))
    .metadata({
      [K.mapImage]: { letter, cells: [pack.grid.w, pack.grid.h], origin: [ox, oy] },
    })
    .build();
  item.position = { x: ox * dpi, y: oy * dpi };
  return item;
}

function controllerItems(plan, mergedRooms, fog, mapsInfo, dpi) {
  const { letters, origins } = plan;
  const payload = JSON.stringify({ w: fog.walls, l: fog.lights });
  const chunks = chunkString(payload, 8000);
  const items = [];
  // Park the hidden data items just outside this scene's bounding box.
  const parkX = Math.min(...letters.map((L) => origins[L][0])) - 3;
  const parkY = Math.min(...letters.map((L) => origins[L][1])) - 3;
  // Token images for rooms placed later (click-to-place runs in the
  // background script, which never saw this panel's token matches).
  const tokenImages = {};
  for (const { room } of plan.unplaced) {
    for (const mon of room.monsters) {
      const img = tokenImageFromMatches(mon.name);
      if (img) tokenImages[normalizeName(mon.name)] = img;
    }
  }
  const tag = isDotmm() ? `L${state.source.level}` : "custom";
  const meta = {
    map: letters.join("+"),
    level: isDotmm() ? Number(state.source.level) : null,
    source: isDotmm() ? "dotmm" : "custom",
    title: isDotmm() ? levelData().name : (state.content?.doc?.title || null),
    contentFile: state.content?.filename || null,
    chunks: chunks.length,
    rooms: mergedRooms,
    originOverrides: {},
    // Self-describing scene: the background runtime identifies and places
    // map images from this, with no level tables of its own.
    mapsInfo,
    tokenImages,
  };
  const size = JSON.stringify(meta).length;
  if (size > 64000) console.warn(`[DotMM] controller metadata is large (${size} bytes) - very long room notes may hit OBR limits`);
  const controller = buildText()
    .plainText(`DotMM controller · ${tag} maps ${letters.join("")} — do not delete`)
    .fontSize(14)
    .fillColor("#665f80")
    .layer("TEXT")
    .visible(false)
    .locked(true)
    .name(`DotMM controller ${tag} ${letters.join("")}`)
    .metadata({ [K.controller]: meta })
    .build();
  controller.text.width = 400;
  controller.text.height = 24;
  items.push(withCell(controller, parkX, parkY, dpi));
  chunks.forEach((data, i) => {
    const chunkItem = buildText()
      .plainText(`DotMM fog data ${i + 1}/${chunks.length}`)
      .fontSize(10)
      .fillColor("#665f80")
      .layer("TEXT")
      .visible(false)
      .locked(true)
      .name(`DotMM fog chunk ${i + 1}`)
      .metadata({ [K.fogChunk]: { i, n: chunks.length, data } })
      .build();
    chunkItem.text.width = 300;
    chunkItem.text.height = 18;
    items.push(withCell(chunkItem, parkX, parkY - 0.4 * (i + 1), dpi));
  });
  return items;
}

// Merge all loaded maps' fog + content into the global frame (cell units).
function buildMerged(plan, dpi) {
  const { letters, origins } = plan;
  const fog = { walls: [], lights: [] };
  const items = [];
  const mergedRooms = [];
  const occupied = new Set(); // token-occupied cells, shared across all maps
  const doorCenters = [];     // global-frame door centers, for seam dedupe
  const mapsInfo = {};
  const placeRoom = (B, room) => {
    items.push(B.roomLabel(room));
    items.push(...B.monsterItems(room));
    if (room.teleport) items.push(B.teleportMarker(room));
  };
  for (const L of letters) {
    const { vtt, pack, file } = state.loaded.get(L);
    const origin = origins[L];
    const B = makeBuilders(dpi, origin, occupied, tokenImageFromMatches);
    const mapFog = extractFog(vtt);
    const itemsBefore = items.length;
    mapsInfo[L] = {
      cells: [pack.grid.w, pack.grid.h],
      origin,
      px: [pack.grid.w * vttDpi(vtt), pack.grid.h * vttDpi(vtt)],
      // Content-file map key: letter for DotMM, file name for custom maps
      // (stable across imports, unlike arrival-order letters).
      key: isDotmm() ? L : stem(file.name),
    };
    // Secret doors are overlay-glyph anchors, not dd2vtt portals: snap each
    // onto the nearest wall and cut a door-sized gap out of it (mutates
    // mapFog.walls, so this must run BEFORE the walls are merged below).
    // The closed-door segment then becomes the gap's only blocker, so
    // opening a secret door actually opens the passage.
    for (const grid of pack.secret_doors) {
      const hit = alignDoorToWall(mapFog.walls, grid[0], grid[1], 1.0, 2.5);
      if (!hit) console.warn(`[DotMM] secret door at (${grid[0]}, ${grid[1]}) on map ${L}: no wall within 2.5 cells; placed unaligned`);
      mapFog.doors.push(hit
        ? { ...hit, open: false, secret: true }
        : {
            a: { x: grid[0] - 0.5, y: grid[1] },
            b: { x: grid[0] + 0.5, y: grid[1] },
            open: false, secret: true,
            center: { x: grid[0], y: grid[1] },
          });
    }
    // Walls and lights carry their map letter (m) so per-map origin nudges
    // can shift them together with the map image at materialization time.
    for (const flat of mapFog.walls) {
      fog.walls.push({
        m: L,
        p: flat.map((v, idx) => Math.round((v + origin[idx % 2]) * 100) / 100),
      });
    }
    for (const l of mapFog.lights) {
      fog.lights.push({ ...l, m: L, x: l.x + origin[0], y: l.y + origin[1] });
    }
    for (const { L: RL, room } of plan.placed) {
      if (RL !== L) continue;
      placeRoom(B, room);
      mergedRooms.push({ ...room, map: L, grid: [room.grid[0] + origin[0], room.grid[1] + origin[1]] });
    }
    for (const conn of pack.connectors) {
      if (letters.includes(conn.to)) continue; // seams between present maps are noise
      items.push(B.connectorMarker(conn));
    }
    (pack.traps || []).forEach((grid, i) => items.push(B.trapMarker(grid, i)));
    mapFog.doors.forEach((door, i) => {
      // Seam overlap regions exist in BOTH maps' dd2vtt files, each with
      // its own copy of the connecting door - keep only the first.
      const c = { x: door.center.x + origin[0], y: door.center.y + origin[1] };
      if (doorCenters.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 0.75)) return;
      doorCenters.push(c);
      items.push(B.doorMarker(door, i));
    });
    // Tag everything this map contributed with its letter so per-map
    // origin nudges can move the map and its content as one unit.
    for (let i = itemsBefore; i < items.length; i++) {
      items[i].metadata[K.map] = L;
    }
  }
  // Rooms positioned in whole-scene coordinates outside every map: placed,
  // but tied to no map, so map nudges don't move them.
  const free = makeBuilders(dpi, [0, 0], occupied, tokenImageFromMatches);
  for (const { L, room } of plan.placed) {
    if (L) continue;
    placeRoom(free, room);
    mergedRooms.push({ ...room, map: null });
  }
  for (const { L, room } of plan.unplaced) mergedRooms.push({ ...room, map: L, grid: null });
  return { fog, items, mergedRooms, mapsInfo };
}

// ---------- import ----------
$("importBtn").addEventListener("click", async () => {
  if (state.importing || state.loaded.size === 0) return;
  const letters = [...state.loaded.keys()].sort();
  const extras = letters.slice(1);
  state.importing = true;
  $("importBtn").disabled = true;
  let stage = "start";
  try {
    // Extra maps must be placed from library URLs (a scene upload carries
    // exactly one image file), and OBR only reveals URLs through the
    // picker. Chain upload → pick here so the whole thing is two dialogs
    // inside one Import click; step 2b remains only for reusing
    // already-uploaded copies ahead of time.
    let missing = extras.filter((L) => !state.mapImages.has(L));
    if (missing.length > 0) {
      stage = "uploading extra maps";
      setStatus(`Uploading maps ${missing.join(", ")} to your library — confirm the dialog…`);
      setProgress(5);
      await uploadExtraMapImages(missing);
      stage = "picking extra maps";
      setProgress(10);
      setStatus(`Now select the ${assetPrefix()}-* images for maps ${missing.join(", ")} in the picker…`);
      await pickExtraMapImages();
      missing = extras.filter((L) => !state.mapImages.has(L));
      if (missing.length > 0) {
        setStatus(`Maps ${missing.join(", ")} aren't showing up in the picker yet — your library may still be indexing the upload. Click “Pick uploaded maps” (step 2b) once they appear, then Import again.`, "err");
        setProgress(0);
        return;
      }
    }

    stage = "merging maps";
    setStatus("Merging maps into the global frame…");
    setProgress(15);
    const plan = buildPlan();
    const { fog, items, mergedRooms, mapsInfo } = buildMerged(plan, DPI);

    stage = "decoding base map";
    setStatus("Decoding base map image…");
    setProgress(35);
    const baseLetter = letters[0];
    const baseVtt = state.loaded.get(baseLetter).vtt;
    const baseFile = base64ToFile(baseVtt.image, assetName(baseLetter));
    const baseMap = buildImageUpload(baseFile)
      .dpi(vttDpi(baseVtt))
      .name(assetName(baseLetter))
      .build();

    stage = "building scene items";
    setProgress(55);
    for (const L of extras) {
      items.push(extraMapImageItem(L, state.mapImages.get(L), state.loaded.get(L).pack, plan.origins[L], DPI));
    }
    items.push(...controllerItems(plan, mergedRooms, fog, mapsInfo, DPI));

    stage = "uploading scene";
    setStatus("Uploading scene to your library…");
    setProgress(75);
    const title = isDotmm() ? `DotMM L${state.source.level}` : (state.content?.doc?.title || "Custom maps");
    const scene = buildSceneUpload()
      .name(letters.length > 1 ? `${title} · Combined ${letters.join("")}` : `${title} · Map ${baseLetter}`)
      .baseMap(baseMap)
      .items(items)
      .build();
    scene.fog = { filled: true, style: { color: "#222222", strokeWidth: 5 } };
    await OBR.assets.uploadScenes([scene]);

    setProgress(100);
    const unplacedNote = plan.unplaced.length
      ? ` ${plan.unplaced.length} room${plan.unplaced.length === 1 ? " has" : "s have"} no position yet — place ${plan.unplaced.length === 1 ? "it" : "them"} from the Rooms tab.`
      : "";
    setStatus(`Imported. Open the scene from your Atlas — map, tokens, walls and lights align themselves on first open.${unplacedNote}`, "ok");
  } catch (err) {
    console.error("[DotMM] import failed:", err);
    setStatus(`Import failed at ${stage}: ${fmtError(err)}`, "err");
    setProgress(0);
  } finally {
    state.importing = false;
    renderImportPanel();
  }
});

// ---------- room browser ----------
let currentCtrl = null;
let currentRooms = [];
let currentOverrides = {};
let nudgeCapable = false; // scene items carry K.map tags (imported ≥1.4.0)

// Per-map origin nudge: adjusts ctrl.originOverrides (cells) and clears
// reconciledDpi, so the background re-align moves the map image AND all
// its content - tokens, labels, doors, walls, lights - as one unit.
async function nudgeMap(L, dx, dy) {
  try {
    const controllers = await OBR.scene.items.getItems(
      (it) => it.metadata && it.metadata[K.controller] !== undefined
    );
    if (controllers.length === 0) return;
    const ctrl0 = controllers[0].metadata[K.controller];
    const overrides = { ...(ctrl0.originOverrides || {}) };
    const cur = overrides[L] || [0, 0];
    overrides[L] = [cur[0] + dx, cur[1] + dy];
    // Absolute values in the draft: OBR can replay update callbacks, and
    // a relative "+= dx" inside one would then apply twice.
    await OBR.scene.items.updateItems(
      controllers.map((it) => it.id),
      (drafts) => {
        for (const item of drafts) {
          const ctrl = item.metadata[K.controller];
          ctrl.originOverrides = overrides;
          ctrl.reconciledDpi = null;
          item.metadata[K.controller] = ctrl;
        }
      }
    );
    currentOverrides = overrides;
    renderMapNudge();
  } catch (err) {
    console.error("[DotMM] nudge failed:", err);
  }
}

function renderMapNudge() {
  const host = $("mapnudge");
  const letters = currentCtrl?.mapsInfo
    ? Object.keys(currentCtrl.mapsInfo).sort()
    : [...new Set(currentRooms.map((r) => r.map).filter(Boolean))].sort();
  // Pre-1.4.0 scenes lack K.map tags on items and letters in the fog
  // payload - a nudge there would move only the map image, recreating the
  // exact desync this feature exists to prevent.
  if (!nudgeCapable || letters.length < 2) { host.innerHTML = ""; return; }
  host.innerHTML = letters
    .map((L) => {
      const [ox, oy] = currentOverrides[L] || [0, 0];
      const off = ox || oy ? `(${ox > 0 ? "+" : ""}${ox}, ${oy > 0 ? "+" : ""}${oy})` : "±0";
      const key = currentCtrl?.mapsInfo?.[L]?.key;
      const name = key && key !== L ? ` <span style="color:var(--muted);font-weight:400">${esc(key)}</span>` : "";
      return `<div class="nudgerow" data-l="${L}">
        <span class="nudgemap">Map ${L}${name}</span>
        <span class="nudgeoff">${off}</span>
        <button class="nudgebtn" data-d="-1,0" title="1 cell left">◀</button>
        <button class="nudgebtn" data-d="0,-1" title="1 cell up">▲</button>
        <button class="nudgebtn" data-d="0,1" title="1 cell down">▼</button>
        <button class="nudgebtn" data-d="1,0" title="1 cell right">▶</button>
      </div>`;
    })
    .join("");
  for (const btn of host.querySelectorAll(".nudgebtn")) {
    btn.addEventListener("click", () => {
      const L = btn.closest(".nudgerow").dataset.l;
      const [dx, dy] = btn.dataset.d.split(",").map(Number);
      nudgeMap(L, dx, dy);
    });
  }
}

// Order rooms by number, then letter suffix: 1, 2a, 2b, 3, … Labels that
// don't parse sort after the numbered ones, alphabetically.
function roomSortKey(room) {
  const m = /^(\d+)([a-z]*)$/i.exec(String(room.label).trim());
  return m
    ? [Number(m[1]), m[2].toLowerCase()]
    : [Number.MAX_SAFE_INTEGER, String(room.label).toLowerCase()];
}
function sortRooms(rooms) {
  return rooms.slice().sort((a, b) => {
    const ka = roomSortKey(a), kb = roomSortKey(b);
    return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0);
  });
}

async function refreshRooms() {
  const list = $("roomlist");
  const sceneReady = await OBR.scene.isReady().catch(() => false);
  currentCtrl = null;
  if (!sceneReady) {
    $("roomsScene").textContent = "— open an imported scene first";
    list.innerHTML = "";
    $("roomdetail").innerHTML = "";
    $("roomtools").classList.add("hidden");
    return;
  }
  const items = await OBR.scene.items.getItems(
    (it) => it.metadata && it.metadata[K.controller] !== undefined
  );
  if (items.length === 0) {
    $("roomsScene").textContent = "— current scene was not imported by DotMM";
    list.innerHTML = "";
    $("roomtools").classList.add("hidden");
    return;
  }
  const ctrl = items[0].metadata[K.controller];
  currentCtrl = ctrl;
  $("roomsScene").textContent = ctrl.title ? `— ${ctrl.title} · maps ${ctrl.map}` : `— map ${ctrl.map}`;
  currentRooms = sortRooms(ctrl.rooms || []);
  currentOverrides = ctrl.originOverrides || {};
  nudgeCapable = ctrl.originOverrides !== undefined;
  renderRoomList();
  renderRoomTools();
  renderMapNudge();
  $("realign").classList.remove("hidden");
}

function renderRoomTools() {
  const unplaced = currentRooms.filter((r) => !r.grid);
  $("roomtools").classList.remove("hidden");
  $("placeAll").classList.toggle("hidden", unplaced.length === 0);
  $("placeAll").textContent = `Place ${unplaced.length} unplaced room${unplaced.length === 1 ? "" : "s"}…`;
}

// Deep link from the scene: the "Room Details" context menu on a room
// label writes {id} to player metadata and opens this panel; show that
// room's entry and clear the request.
async function handleShowRoomRequest(meta) {
  const req = meta && meta[K.showRoom];
  if (!req) return;
  try {
    await OBR.player.setMetadata({ [K.showRoom]: undefined });
  } catch (err) {
    console.error("[DotMM] show-room metadata clear failed:", err);
  }
  activateTab("rooms");
  await refreshRooms();
  const i = currentRooms.findIndex((r) => r.id === req.id);
  if (i >= 0) showRoom(i);
}

$("realign").addEventListener("click", async () => {
  try {
    const controllers = await OBR.scene.items.getItems(
      (it) => it.metadata && it.metadata[K.controller] !== undefined
    );
    if (controllers.length === 0) return;
    await OBR.scene.items.updateItems(
      controllers.map((it) => it.id),
      (drafts) => {
        for (const item of drafts) {
          const ctrl = item.metadata[K.controller];
          ctrl.reconciledDpi = null;
          item.metadata[K.controller] = ctrl;
        }
      }
    );
    $("roomsScene").textContent = "— re-aligning… check the console for [DotMM] verify lines";
  } catch (err) {
    console.error("[DotMM] re-align request failed:", err);
  }
});

function renderRoomList() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("roomlist");
  const rooms = currentRooms.filter((r) => {
    if (!q) return true;
    const hay = `${r.label} ${r.name} ${r.monsters.map((m) => m.name).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
  list.innerHTML = rooms
    .map((r) => {
      const monCount = r.monsters.reduce((s, m) => s + (m.count || 1), 0);
      const mapTag = r.map ? `<span style="color:var(--muted);font-size:10px">${esc(r.map)}</span>` : "";
      return `<div class="room ${r.grid ? "" : "unplaced"}" data-i="${currentRooms.indexOf(r)}">
        <span class="num">${esc(r.label)}</span>
        <span class="nm">${esc(r.name)}</span>
        ${r.grid ? mapTag : `<span class="unplacedtag" title="No position yet — open it to place it on the map">unplaced</span>`}
        ${monCount ? `<span class="mon">⚔ ${monCount}</span>` : ""}
        ${r.teleport ? `<span class="tp" title="${esc(r.teleport.label)}">⇋</span>` : ""}
      </div>`;
    })
    .join("");
  for (const el of list.querySelectorAll(".room")) {
    el.addEventListener("click", () => showRoom(Number(el.dataset.i)));
  }
}

async function showRoom(i) {
  const room = currentRooms[i];
  if (!room) return;
  const det = $("roomdetail");
  const monsters = room.monsters
    .map((m) => `<div class="monline">⚔ ${m.count || 1} × ${esc(m.name)}${m.note ? ` — <span style="color:var(--muted)">${esc(m.note)}</span>` : ""}</div>`)
    .join("");
  det.innerHTML = `<div class="roomdetail">
    <h3>${esc(room.label)}${room.name && room.name !== room.label ? ` · ${esc(room.name)}` : ""}</h3>
    ${monsters || `<div class="monline" style="color:var(--muted)">No monsters</div>`}
    ${room.gm_note ? `<div class="note">${esc(room.gm_note)}</div>` : ""}
    ${room.teleport ? `<div class="note">⇋ ${esc(room.teleport.label)}</div>` : ""}
    ${room.grid
      ? `<span class="jump">Jump to room</span>`
      : `<span class="jump place">Place on map…</span>`}
    <span class="status" id="jumpStatus" style="display:block"></span>
  </div>`;
  const js = det.querySelector("#jumpStatus");
  if (!room.grid) {
    det.querySelector(".jump").addEventListener("click", () => startPlacing([room.id], js));
    return;
  }
  det.querySelector(".jump").addEventListener("click", async () => {
    try {
      const dpi = await OBR.scene.grid.getDpi();
      const [ox, oy] = currentOverrides[room.map] || [0, 0];
      const cx = (room.grid[0] + ox) * dpi;
      const cy = (room.grid[1] + oy) * dpi;
      const span = 14 * dpi;
      await OBR.viewport.animateToBounds({
        min: { x: cx - span / 2, y: cy - span / 2 },
        max: { x: cx + span / 2, y: cy + span / 2 },
        center: { x: cx, y: cy },
        width: span,
        height: span,
      });
      js.textContent = "";
    } catch (err) {
      console.error("[DotMM] jump failed:", err);
      js.textContent = `Jump failed: ${fmtError(err)}`;
      js.className = "status err";
    }
  });
}

// ---------- click-to-place ----------
// The panel only queues room ids (player metadata, so it survives the panel
// closing) and switches to the placement tool; the background script owns
// the tool and handles each map click: label + monster tokens at the click,
// controller updated, next room in the queue.
async function startPlacing(ids, statusEl = $("placeStatus")) {
  try {
    await OBR.player.setMetadata({ [K.placeQueue]: ids });
    await OBR.tool.activateTool(PLACE_TOOL);
    const first = currentRooms.find((r) => r.id === ids[0]);
    await OBR.notification.show(
      `Click the map where room ${first ? first.label : ids[0]} goes${ids.length > 1 ? ` (1 of ${ids.length})` : ""}. Switch tools to stop.`,
      "INFO"
    );
    await OBR.action.close();
  } catch (err) {
    console.error("[DotMM] start placing failed:", err);
    statusEl.textContent = `Couldn't start placing: ${fmtError(err)}`;
    statusEl.className = "status err";
  }
}

$("placeAll").addEventListener("click", () => {
  const ids = currentRooms.filter((r) => !r.grid).map((r) => r.id);
  if (ids.length) startPlacing(ids);
});

// ---------- export ----------
// The scene's rooms (including ones placed by clicking, and the current map
// offsets) as a content file, so the next import lands everything directly.
function sceneToDoc(ctrl) {
  const info = ctrl.mapsInfo || {};
  const ov = ctrl.originOverrides || {};
  const keyOf = (L) => info[L]?.key || L;
  const origins = {};
  for (const [L, m] of Object.entries(info)) {
    const [dx, dy] = ov[L] || [0, 0];
    origins[keyOf(L)] = [m.origin[0] + dx, m.origin[1] + dy];
  }
  const rooms = sortRooms(ctrl.rooms || []).map((r) => {
    const base = r.map && info[r.map] ? info[r.map].origin : [0, 0];
    const room = {
      id: r.id, label: r.label, name: r.name || "",
      map: r.map ? keyOf(r.map) : null,
      grid: r.grid ? [r.grid[0] - base[0], r.grid[1] - base[1]] : null,
      monsters: r.monsters || [], gm_note: r.gm_note || "",
    };
    if (r.teleport) room.teleport = r.teleport;
    return room;
  });
  return { title: ctrl.title || null, origins, rooms };
}

$("exportContent").addEventListener("click", () => {
  if (!currentCtrl) return;
  const md = docToMarkdown(sceneToDoc(currentCtrl));
  const name = `${slug(currentCtrl.title || "scene")}.md`;
  try {
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.warn("[DotMM] download failed, showing text instead:", err);
  }
  // Downloads can be blocked inside the OBR panel - always offer the text.
  $("exportBox").classList.remove("hidden");
  $("exportText").value = md;
  $("exportText").select();
});

$("copyExport").addEventListener("click", async () => {
  const ta = $("exportText");
  ta.select();
  try {
    await navigator.clipboard.writeText(ta.value);
    $("copyExport").textContent = "Copied";
  } catch {
    document.execCommand("copy");
    $("copyExport").textContent = "Copied (select-all fallback)";
  }
  setTimeout(() => { $("copyExport").textContent = "Copy"; }, 2000);
});

$("search").addEventListener("input", renderRoomList);

// ---------- boot ----------
renderImportPanel();
OBR.onReady(() => {
  refreshRooms();
  OBR.scene.onReadyChange(() => refreshRooms());
  // Pick up a pending Room Details request (set before the panel opened)
  // and any that arrive while it is open.
  OBR.player.getMetadata()
    .then(handleShowRoomRequest)
    .catch((err) => console.error("[DotMM] show-room boot check failed:", err));
  OBR.player.onChange((player) => handleShowRoomRequest(player.metadata));
});
