import OBR, {
  buildImageUpload,
  buildSceneUpload,
  buildText,
  buildLabel,
  buildImage,
  buildShape,
} from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm";
import { DOTMM_PACKS, TOKEN_MANIFEST } from "./content.js";
import {
  PLUGIN, K, DPI, ORIGINS, MONSTER_SIZE,
  normalizeName, tokenMatchScore, ringOffsets, chunkString, extractFog,
  base64ToFile, fmtError, snapTokenCell, alignDoorToWall,
} from "./common.js";

// ---------- state ----------
const state = {
  loaded: new Map(),   // letter -> {vtt, pack, file}
  tokenMap: new Map(), // normalized monster name -> {dl, score}
  mapImages: new Map(),// letter -> ImageContent picked from the library (combined mode)
  importing: false,
};

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
  $("tab-import").classList.toggle("hidden", name !== "import");
  $("tab-rooms").classList.toggle("hidden", name !== "rooms");
}
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    activateTab(tab.dataset.tab);
    if (tab.dataset.tab === "rooms") refreshRooms();
  });
}

// ---------- map chips ----------
function renderChips() {
  $("mapchips").innerHTML = Object.keys(DOTMM_PACKS)
    .map((L) => {
      const ok = state.loaded.has(L);
      return `<span class="mapchip ${ok ? "ok" : ""}"><span class="dot"></span>Map ${L}</span>`;
    })
    .join("");
}
renderChips();

// ---------- file selection (multi) ----------
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragging"); });
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  if (e.dataTransfer.files) loadVttFiles([...e.dataTransfer.files]);
});
$("file").addEventListener("change", (e) => {
  if (e.target.files) loadVttFiles([...e.target.files]);
});

function detectPack(filename, vtt) {
  const m = /Level1?_([A-F])_/i.exec(filename);
  if (m) return DOTMM_PACKS[m[1].toUpperCase()] || null;
  const sz = vtt?.resolution?.map_size;
  if (sz) {
    for (const pack of Object.values(DOTMM_PACKS)) {
      if (pack.grid.w === sz.x && pack.grid.h === sz.y) return pack;
    }
  }
  return null;
}

async function loadVttFiles(files) {
  let added = 0;
  for (const file of files) {
    try {
      const vtt = JSON.parse(await file.text());
      if (!vtt.resolution || !vtt.image) continue;
      const pack = detectPack(file.name, vtt);
      if (pack) {
        state.loaded.set(pack.map, { vtt, pack, file });
        added += 1;
      }
    } catch (err) {
      console.error("[DotMM] file parse failed:", file.name, err);
    }
  }
  const letters = [...state.loaded.keys()].sort();
  if (letters.length === 0) {
    $("dropTitle").textContent = "No Level 1 sub-maps recognized";
    $("dropSub").textContent = "Drop Level1_<A-F>_*.dd2vtt files (multiple allowed).";
    $("importBtn").disabled = true;
  } else {
    $("dropTitle").textContent = `Loaded: ${letters.map((l) => `Map ${l}`).join(", ")}`;
    $("dropSub").textContent = letters.length === 1
      ? "One sub-map — imports as a single scene. Drop more files to build a combined scene."
      : `${letters.length} sub-maps — imports as ONE combined scene in the global Level 1 frame.`;
    $("importBtn").disabled = false;
    if (added === 0) setStatus("No new maps in that drop.", "err");
    else setStatus("");
  }
  renderChips();
  renderTokenRow();
  updateImportLabel();
}

function updateImportLabel() {
  const n = state.loaded.size;
  $("importBtn").textContent = n > 1 ? `Import combined scene (${n} maps)` : "Import scene";
}

// ---------- token matching ----------
function neededMonsters() {
  if (state.loaded.size === 0) return TOKEN_MANIFEST.monsters.map((m) => m.name);
  const names = new Set();
  for (const { pack } of state.loaded.values()) {
    for (const room of pack.rooms) {
      for (const mon of room.monsters) names.add(mon.name);
    }
  }
  return [...names].sort();
}

function renderTokenRow() {
  $("tokrow").innerHTML = neededMonsters()
    .map((name) => {
      const hit = state.tokenMap.get(normalizeName(name));
      const title = hit ? `matched: ${hit.dl.name}` : "no image matched - placeholder will be used";
      return `<span class="tok ${hit ? "matched" : "missing"}" title="${title}">${name}</span>`;
    })
    .join("");
}
renderTokenRow();

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
// must reference URLs from the OBR library: step 2b uploads the decoded PNGs,
// then picks them back to obtain URLs (skipped automatically when
// uploadImages returns usable asset info).
// Upload the given letters' embedded PNGs to the user's library. NOTE:
// uploadImages resolves with nothing - OBR never hands back asset URLs
// from an upload. The only way to obtain URLs is the picker
// (downloadImages), so callers must follow up with pickExtraMapImages().
async function uploadExtraMapImages(letters) {
  const uploads = [];
  for (const L of letters) {
    const { vtt } = state.loaded.get(L);
    const file = base64ToFile(vtt.image, `DotMM-L1-${L}`);
    uploads.push(buildImageUpload(file).dpi(DPI).name(`DotMM-L1-${L}`).build());
  }
  await OBR.assets.uploadImages(uploads, "MAP");
}

// Open the OBR image picker (pre-searched to the importer's names) and
// record the URLs of any DotMM-L1-* images the user selects.
async function pickExtraMapImages() {
  const downloads = await OBR.assets.downloadImages(true, "DotMM-L1", "MAP");
  for (const dl of downloads || []) {
    const m = /DotMM-L1-([A-F])/.exec(dl.name);
    if (m) state.mapImages.set(m[1], dl.image);
  }
}

$("uploadMaps").addEventListener("click", async () => {
  const extras = [...state.loaded.keys()].sort().slice(1);
  if (extras.length === 0) {
    setStatus("Load two or more sub-maps first — a single map does not need this step.", "err");
    return;
  }
  try {
    setStatus("Confirm the upload dialog in Owlbear Rodeo…");
    await uploadExtraMapImages(extras);
    if (extras.every((L) => state.mapImages.has(L))) {
      setStatus(`Map images ready (${extras.join(", ")}). Import when ready.`, "ok");
    } else {
      setStatus("Uploaded. Now click “Pick uploaded maps” and select the DotMM-L1-* images.", "ok");
    }
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

// ------------------------------------------------------------------
// Item construction. Positions are computed at import dpi, and every
// item records its intended grid-cell position in metadata so the
// background runtime can self-calibrate against the rendered map.
// ------------------------------------------------------------------
function withCell(item, cellX, cellY, dpi) {
  item.metadata[K.cell] = [
    Math.round(cellX * 100) / 100,
    Math.round(cellY * 100) / 100,
  ];
  item.position = { x: cellX * dpi, y: cellY * dpi };
  return item;
}

function makeBuilders(dpi, origin, occupied) {
  const ox = origin[0], oy = origin[1];
  const gc = (g) => [g[0] + ox, g[1] + oy]; // pack-local cells -> global cells

  // GM-only room number badge, centered on the room anchor. Labels render
  // as solid badges (unlike free Text items) so they read reliably at any
  // zoom; the full name lives in the item name and the room browser.
  // Unlocked so the GM can right-click one for the Room Details menu.
  function roomLabel(room) {
    const [cx, cy] = gc(room.grid);
    const item = buildLabel()
      .plainText(String(room.label))
      .pointerHeight(0)
      .backgroundColor("#1a1408")
      .backgroundOpacity(0.8)
      .layer("TEXT")
      .visible(false)
      .locked(false)
      .name(`Room ${room.label} · ${room.name}`)
      .metadata({ [K.room]: room })
      .build();
    item.text.style.fillColor = "#ffd66b";
    item.text.style.fontSize = 26;
    item.text.style.fontWeight = 700;
    return withCell(item, cx, cy, dpi);
  }

  function doorMarker(door, index) {
    const [cx, cy] = gc([door.center.x, door.center.y]);
    const a = gc([door.a.x, door.a.y]);
    const b = gc([door.b.x, door.b.y]);
    const item = buildShape()
      .shapeType("CIRCLE")
      .width(dpi * 0.5)
      .height(dpi * 0.5)
      .fillColor(door.secret ? "#7c5cff" : "#f07a7a")
      .fillOpacity(0.55)
      .strokeColor("#ffffff")
      .strokeWidth(2)
      .layer("PROP")
      .visible(false)
      .locked(false)
      .name(door.secret ? `Secret door ${index + 1}` : `Door ${index + 1}`)
      .metadata({
        [K.door]: {
          a: { x: a[0], y: a[1] },
          b: { x: b[0], y: b[1] },
          open: door.open,
          secret: door.secret,
        },
      })
      .build();
    if (door.secret) item.style.strokeDash = [8, 6];
    return withCell(item, cx, cy, dpi);
  }

  function teleportMarker(room) {
    const [cx, cy] = gc(room.grid);
    const item = buildLabel()
      .plainText(`⇋ ${room.teleport.label}`)
      .pointerHeight(0)
      .backgroundColor("#12324a")
      .backgroundOpacity(0.9)
      .layer("TEXT")
      .visible(false)
      .locked(true)
      .name(`Teleport ${room.id}`)
      .build();
    return withCell(item, cx, cy + 0.8, dpi);
  }

  function connectorMarker(conn) {
    const [cx, cy] = gc(conn.grid);
    const target = conn.to === "expanded" ? "Expanded dungeon"
      : conn.to === "level2" ? "Stairs to Level 2"
      : `To map ${conn.to}`;
    const item = buildLabel()
      .plainText(`→ ${target}`)
      .pointerHeight(0)
      .backgroundColor("#233123")
      .backgroundOpacity(0.9)
      .layer("TEXT")
      .visible(false)
      .locked(true)
      .name(`Connector ${target}`)
      .build();
    return withCell(item, cx, cy, dpi);
  }

  function monsterItems(room) {
    const items = [];
    const tokens = [];
    for (const mon of room.monsters) {
      const count = mon.count || 1;
      for (let i = 0; i < count; i++) tokens.push(mon);
    }
    const offsets = ringOffsets(tokens.length);
    const [bx, by] = gc(room.grid);
    tokens.forEach((mon, i) => {
      const size = MONSTER_SIZE[mon.name] || 1;
      // Snap the ring formation onto the grid lattice; occupancy tracking
      // spreads colliding tokens to the nearest free cells.
      const [cx, cy] = snapTokenCell(
        bx + offsets[i][0] * 1.2, by + offsets[i][1] * 1.2, size, occupied);
      const hit = state.tokenMap.get(normalizeName(mon.name));
      const label = tokens.length > 1 ? `${mon.name} ${i + 1}` : mon.name;
      let item;
      if (hit) {
        const grid = {
          dpi: Math.max(hit.dl.image.width, hit.dl.image.height) / size,
          offset: { x: hit.dl.image.width / 2, y: hit.dl.image.height / 2 },
        };
        item = buildImage(hit.dl.image, grid)
          .layer("CHARACTER")
          .visible(false)
          .plainText(label)
          .textItemType("LABEL")
          .name(label)
          .build();
      } else {
        item = buildLabel()
          .plainText(label)
          .pointerHeight(0)
          .backgroundColor("#5a1f1f")
          .backgroundOpacity(0.95)
          .layer("CHARACTER")
          .visible(false)
          .name(label)
          .build();
      }
      if (mon.note) item.metadata[`${PLUGIN}/monster-note`] = mon.note;
      items.push(withCell(item, cx, cy, dpi));
    });
    return items;
  }

  return { roomLabel, doorMarker, teleportMarker, connectorMarker, monsterItems };
}

function extraMapImageItem(letter, imageContent, pack, dpi) {
  const [ox, oy] = ORIGINS[letter];
  const item = buildImage(imageContent, { dpi: DPI, offset: { x: 0, y: 0 } })
    .layer("MAP")
    .locked(true)
    .name(`DotMM-L1-${letter}`)
    .metadata({
      [K.mapImage]: { letter, cells: [pack.grid.w, pack.grid.h], origin: [ox, oy] },
    })
    .build();
  item.position = { x: ox * dpi, y: oy * dpi };
  return item;
}

function controllerItems(letters, mergedRooms, fog, dpi) {
  const payload = JSON.stringify({ w: fog.walls, l: fog.lights });
  const chunks = chunkString(payload, 8000);
  const items = [];
  const controller = buildText()
    .plainText(`DotMM controller · maps ${letters.join("")} — do not delete`)
    .fontSize(14)
    .fillColor("#665f80")
    .layer("TEXT")
    .visible(false)
    .locked(true)
    .name(`DotMM controller ${letters.join("")}`)
    .metadata({
      [K.controller]: {
        map: letters.join("+"),
        level: 1,
        chunks: chunks.length,
        rooms: mergedRooms,
        originOverrides: {},
      },
    })
    .build();
  controller.text.width = 400;
  controller.text.height = 24;
  items.push(withCell(controller, -3, -48, dpi));
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
    items.push(withCell(chunkItem, -3, -48 - 0.4 * (i + 1), dpi));
  });
  return items;
}

// Merge all loaded maps' fog + content into the global frame (cell units).
function buildMerged(letters, dpi) {
  const fog = { walls: [], lights: [] };
  const items = [];
  const mergedRooms = [];
  const occupied = new Set(); // token-occupied cells, shared across all maps
  const doorCenters = [];     // global-frame door centers, for seam dedupe
  for (const L of letters) {
    const { vtt, pack } = state.loaded.get(L);
    const origin = ORIGINS[L];
    const B = makeBuilders(dpi, origin, occupied);
    const mapFog = extractFog(vtt);
    const itemsBefore = items.length;
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
    for (const room of pack.rooms) {
      items.push(B.roomLabel(room));
      items.push(...B.monsterItems(room));
      if (room.teleport) items.push(B.teleportMarker(room));
      mergedRooms.push({
        ...room,
        map: L,
        grid: [room.grid[0] + origin[0], room.grid[1] + origin[1]],
      });
    }
    for (const conn of pack.connectors) {
      if (letters.includes(conn.to)) continue; // seams between present maps are noise
      items.push(B.connectorMarker(conn));
    }
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
  return { fog, items, mergedRooms };
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
      setStatus(`Now select the DotMM-L1-* images for maps ${missing.join(", ")} in the picker…`);
      await pickExtraMapImages();
      missing = extras.filter((L) => !state.mapImages.has(L));
      if (missing.length > 0) {
        setStatus(`Still missing maps ${missing.join(", ")} — select their DotMM-L1-* images via “Pick uploaded maps” (step 2b), then Import again.`, "err");
        setProgress(0);
        return;
      }
    }

    stage = "merging maps";
    setStatus("Merging maps into the global frame…");
    setProgress(15);
    const { fog, items, mergedRooms } = buildMerged(letters, DPI);

    stage = "decoding base map";
    setStatus("Decoding base map image…");
    setProgress(35);
    const baseLetter = letters[0];
    const baseFile = base64ToFile(state.loaded.get(baseLetter).vtt.image, `DotMM-L1-${baseLetter}`);
    const baseMap = buildImageUpload(baseFile)
      .dpi(DPI)
      .name(`DotMM-L1-${baseLetter}`)
      .build();

    stage = "building scene items";
    setProgress(55);
    for (const L of extras) {
      items.push(extraMapImageItem(L, state.mapImages.get(L), state.loaded.get(L).pack, DPI));
    }
    items.push(...controllerItems(letters, mergedRooms, fog, DPI));

    stage = "uploading scene";
    setStatus("Uploading scene to your library…");
    setProgress(75);
    const scene = buildSceneUpload()
      .name(letters.length > 1 ? `DotMM L1 · Combined ${letters.join("")}` : `DotMM L1 · Map ${baseLetter}`)
      .baseMap(baseMap)
      .items(items)
      .build();
    scene.fog = { filled: true, style: { color: "#222222", strokeWidth: 5 } };
    await OBR.assets.uploadScenes([scene]);

    setProgress(100);
    setStatus("Imported. Open the scene from your Atlas — map, tokens, walls and lights align themselves on first open.", "ok");
  } catch (err) {
    console.error("[DotMM] import failed:", err);
    setStatus(`Import failed at ${stage}: ${fmtError(err)}`, "err");
    setProgress(0);
  } finally {
    state.importing = false;
    $("importBtn").disabled = false;
    updateImportLabel();
  }
});

// ---------- room browser ----------
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
  const letters = Object.keys(DOTMM_PACKS).filter((L) =>
    currentRooms.some((r) => r.map === L));
  // Pre-1.4.0 scenes lack K.map tags on items and letters in the fog
  // payload - a nudge there would move only the map image, recreating the
  // exact desync this feature exists to prevent.
  if (!nudgeCapable || letters.length < 2) { host.innerHTML = ""; return; }
  host.innerHTML = letters
    .map((L) => {
      const [ox, oy] = currentOverrides[L] || [0, 0];
      const off = ox || oy ? `(${ox > 0 ? "+" : ""}${ox}, ${oy > 0 ? "+" : ""}${oy})` : "±0";
      return `<div class="nudgerow" data-l="${L}">
        <span class="nudgemap">Map ${L}</span>
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
  if (!sceneReady) {
    $("roomsScene").textContent = "— open an imported scene first";
    list.innerHTML = "";
    $("roomdetail").innerHTML = "";
    return;
  }
  const items = await OBR.scene.items.getItems(
    (it) => it.metadata && it.metadata[K.controller] !== undefined
  );
  if (items.length === 0) {
    $("roomsScene").textContent = "— current scene was not imported by DotMM";
    list.innerHTML = "";
    return;
  }
  const ctrl = items[0].metadata[K.controller];
  $("roomsScene").textContent = `— map ${ctrl.map}`;
  currentRooms = sortRooms(ctrl.rooms || []);
  currentOverrides = ctrl.originOverrides || {};
  nudgeCapable = ctrl.originOverrides !== undefined;
  renderRoomList();
  renderMapNudge();
  $("realign").classList.remove("hidden");
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
      const mapTag = r.map ? `<span style="color:var(--muted);font-size:10px">${r.map}</span>` : "";
      return `<div class="room" data-i="${currentRooms.indexOf(r)}">
        <span class="num">${r.label}</span>
        <span class="nm">${r.name}</span>
        ${mapTag}
        ${monCount ? `<span class="mon">⚔ ${monCount}</span>` : ""}
        ${r.teleport ? `<span class="tp" title="${r.teleport.label}">⇋</span>` : ""}
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
    .map((m) => `<div class="monline">⚔ ${m.count || 1} × ${m.name}${m.note ? ` — <span style="color:var(--muted)">${m.note}</span>` : ""}</div>`)
    .join("");
  det.innerHTML = `<div class="roomdetail">
    <h3>${room.label} · ${room.name}</h3>
    ${monsters || `<div class="monline" style="color:var(--muted)">No monsters</div>`}
    ${room.gm_note ? `<div class="note">${room.gm_note}</div>` : ""}
    ${room.teleport ? `<div class="note">⇋ ${room.teleport.label}</div>` : ""}
    <span class="jump" data-i="${i}">Jump to room</span>
    <span class="status" id="jumpStatus" style="display:block"></span>
  </div>`;
  det.querySelector(".jump").addEventListener("click", async () => {
    const js = det.querySelector("#jumpStatus");
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

$("search").addEventListener("input", renderRoomList);

// ---------- boot ----------
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
