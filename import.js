import OBR, {
  buildImageUpload,
  buildSceneUpload,
  buildText,
  buildLabel,
  buildImage,
  buildShape,
  buildCurve,
} from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm";
import { DOTMM_PACKS, TOKEN_MANIFEST } from "./content.js";
import {
  PLUGIN, K, DPI, MONSTER_SIZE,
  normalizeName, ringOffsets, chunkString, extractFog, base64ToFile,
} from "./common.js";

// ---------- state ----------
const state = {
  vtt: null,          // parsed dd2vtt JSON
  pack: null,         // matched content pack (A-F)
  tokenMap: new Map(),// normalized monster name -> ImageDownload
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
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    $("tab-import").classList.toggle("hidden", tab.dataset.tab !== "import");
    $("tab-rooms").classList.toggle("hidden", tab.dataset.tab !== "rooms");
    if (tab.dataset.tab === "rooms") refreshRooms();
  });
}

// ---------- map chips ----------
function renderChips() {
  $("mapchips").innerHTML = Object.keys(DOTMM_PACKS)
    .map((L) => {
      const ok = state.pack && state.pack.map === L;
      return `<span class="mapchip ${ok ? "ok" : ""}"><span class="dot"></span>Map ${L}</span>`;
    })
    .join("");
}
renderChips();

// ---------- file selection ----------
const drop = $("drop");
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragging"); });
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) loadVtt(f);
});
$("file").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) loadVtt(f);
});

function detectPack(filename, vtt) {
  // filename like Level1_A_BG_70x64_FVTT.dd2vtt
  const m = /Level1?_([A-F])_/i.exec(filename);
  if (m) return DOTMM_PACKS[m[1].toUpperCase()] || null;
  // fallback: match by grid size
  const sz = vtt?.resolution?.map_size;
  if (sz) {
    for (const pack of Object.values(DOTMM_PACKS)) {
      if (pack.grid.w === sz.x && pack.grid.h === sz.y) return pack;
    }
  }
  return null;
}

async function loadVtt(file) {
  try {
    const text = await file.text();
    const vtt = JSON.parse(text);
    if (!vtt.resolution || !vtt.image) {
      throw new Error("Not a dd2vtt file with an embedded image.");
    }
    state.vtt = vtt;
    state.pack = detectPack(file.name, vtt);
    $("dropTitle").textContent = file.name;
    if (state.pack) {
      $("dropSub").textContent =
        `Matched sub-map ${state.pack.map} — ${state.pack.rooms.length} rooms, ` +
        `${vtt.portals?.length ?? 0} doors, ${vtt.lights?.length ?? 0} lights`;
      $("importBtn").disabled = false;
      setStatus("");
    } else {
      $("dropSub").textContent = "File loaded, but it does not match any Level 1 sub-map (A-F).";
      $("importBtn").disabled = true;
    }
    renderChips();
    renderTokenRow();
  } catch (err) {
    setStatus(`Could not read file: ${err.message}`, "err");
  }
}

// ---------- token matching ----------
function neededMonsters() {
  if (!state.pack) return TOKEN_MANIFEST.monsters.map((m) => m.name);
  const names = new Set();
  for (const room of state.pack.rooms) {
    for (const mon of room.monsters) names.add(mon.name);
  }
  return [...names].sort();
}

function renderTokenRow() {
  const row = $("tokrow");
  row.innerHTML = neededMonsters()
    .map((name) => {
      const matched = state.tokenMap.has(normalizeName(name));
      return `<span class="tok ${matched ? "matched" : "missing"}" title="${matched ? "matched" : "no image matched - placeholder will be used"}">${name}</span>`;
    })
    .join("");
}
renderTokenRow();

$("pickTokens").addEventListener("click", async () => {
  try {
    const downloads = await OBR.assets.downloadImages(true, "", "CHARACTER");
    for (const dl of downloads) {
      state.tokenMap.set(normalizeName(dl.name), dl);
    }
    renderTokenRow();
    const matched = neededMonsters().filter((n) => state.tokenMap.has(normalizeName(n))).length;
    setStatus(`${matched}/${neededMonsters().length} monsters matched to token images.`, "ok");
  } catch (err) {
    setStatus(`Token picking failed: ${err.message}`, "err");
  }
});

// ---------- item construction ----------
function cellToWorld(g) {
  return { x: g[0] * DPI, y: g[1] * DPI };
}

function buildRoomLabel(room) {
  const pos = cellToWorld(room.grid);
  const title = `${room.label} · ${room.name}`;
  const item = buildText()
    .position(pos)
    .plainText(title)
    .fontSize(30)
    .fontWeight(700)
    .fillColor("#ffd66b")
    .strokeColor("#1a1408")
    .strokeWidth(2)
    .textAlign("CENTER")
    .layer("TEXT")
    .visible(false)
    .locked(true)
    .name(`Room ${room.label}`)
    .metadata({ [K.room]: room })
    .build();
  // Text items anchor at top-left; nudge so the label centers on the anchor.
  item.position = { x: pos.x - 90, y: pos.y - 18 };
  item.text.width = 180;
  item.text.height = 36;
  return item;
}

function buildSecretDoorMarker(grid) {
  return buildShape()
    .shapeType("CIRCLE")
    .position(cellToWorld(grid))
    .width(DPI * 0.6)
    .height(DPI * 0.6)
    .fillColor("#7c5cff")
    .fillOpacity(0.25)
    .strokeColor("#b48cff")
    .strokeWidth(3)
    .strokeDash([8, 6])
    .layer("PROP")
    .visible(false)
    .locked(true)
    .name("Secret door")
    .build();
}

function buildDoorMarker(door, index) {
  const item = buildShape()
    .shapeType("CIRCLE")
    .position(door.center)
    .width(DPI * 0.5)
    .height(DPI * 0.5)
    .fillColor(door.secret ? "#7c5cff" : "#f07a7a")
    .fillOpacity(0.55)
    .strokeColor("#ffffff")
    .strokeWidth(2)
    .layer("PROP")
    .visible(false)
    .locked(false)
    .name(`Door ${index + 1}`)
    .metadata({ [K.door]: { a: door.a, b: door.b, open: door.open, secret: door.secret } })
    .build();
  return item;
}

function buildTeleportMarker(room) {
  const pos = cellToWorld(room.grid);
  const item = buildLabel()
    .position({ x: pos.x, y: pos.y + DPI * 0.8 })
    .plainText(`⇋ ${room.teleport.label}`)
    .pointerHeight(0)
    .backgroundColor("#12324a")
    .backgroundOpacity(0.9)
    .layer("TEXT")
    .visible(false)
    .locked(true)
    .name(`Teleport ${room.id}`)
    .build();
  return item;
}

function buildConnectorMarker(conn) {
  const pos = cellToWorld(conn.grid);
  const target = conn.to === "expanded" ? "Expanded dungeon"
    : conn.to === "level2" ? "Stairs to Level 2"
    : `To map ${conn.to}`;
  return buildLabel()
    .position(pos)
    .plainText(`→ ${target}`)
    .pointerHeight(0)
    .backgroundColor("#233123")
    .backgroundOpacity(0.9)
    .layer("TEXT")
    .visible(false)
    .locked(true)
    .name(`Connector ${target}`)
    .build();
}

function buildMonsterItems(room) {
  const items = [];
  const tokens = [];
  for (const mon of room.monsters) {
    const count = mon.count || 1;
    for (let i = 0; i < count; i++) tokens.push(mon);
  }
  const offsets = ringOffsets(tokens.length);
  tokens.forEach((mon, i) => {
    const size = MONSTER_SIZE[mon.name] || 1;
    const base = cellToWorld(room.grid);
    const pos = {
      x: base.x + offsets[i][0] * DPI * 1.2,
      y: base.y + offsets[i][1] * DPI * 1.2,
    };
    const dl = state.tokenMap.get(normalizeName(mon.name));
    const label = tokens.length > 1 ? `${mon.name} ${i + 1}` : mon.name;
    if (dl) {
      const grid = {
        dpi: Math.max(dl.image.width, dl.image.height) / size,
        offset: { x: dl.image.width / 2, y: dl.image.height / 2 },
      };
      const item = buildImage(dl.image, grid)
        .position(pos)
        .layer("CHARACTER")
        .visible(false)
        .plainText(label)
        .textItemType("LABEL")
        .name(label)
        .build();
      if (mon.note) item.metadata[`${PLUGIN}/monster-note`] = mon.note;
      items.push(item);
    } else {
      // Placeholder: labelled pill on the character layer.
      const item = buildLabel()
        .position(pos)
        .plainText(label)
        .pointerHeight(0)
        .backgroundColor("#5a1f1f")
        .backgroundOpacity(0.95)
        .layer("CHARACTER")
        .visible(false)
        .name(label)
        .build();
      if (mon.note) item.metadata[`${PLUGIN}/monster-note`] = mon.note;
      items.push(item);
    }
  });
  return items;
}

function buildControllerItems(pack, fog) {
  // Hidden controller carrying chunked fog JSON + pack summary for the background runtime.
  const payload = JSON.stringify({ w: fog.walls, l: fog.lights });
  const chunks = chunkString(payload, 8000);
  const items = [];
  const controller = buildText()
    .position({ x: -3 * DPI, y: -3 * DPI })
    .plainText(`DotMM controller · map ${pack.map} — do not delete`)
    .fontSize(14)
    .fillColor("#665f80")
    .layer("TEXT")
    .visible(false)
    .locked(true)
    .name(`DotMM controller ${pack.map}`)
    .metadata({
      [K.controller]: {
        map: pack.map,
        level: pack.level,
        chunks: chunks.length,
        rooms: pack.rooms,
      },
    })
    .build();
  controller.text.width = 400;
  controller.text.height = 24;
  items.push(controller);
  chunks.forEach((data, i) => {
    const chunkItem = buildText()
      .position({ x: -3 * DPI, y: (-3 - 0.4 * (i + 1)) * DPI })
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
    items.push(chunkItem);
  });
  return items;
}

// ---------- import ----------
$("importBtn").addEventListener("click", async () => {
  if (state.importing || !state.vtt || !state.pack) return;
  state.importing = true;
  $("importBtn").disabled = true;
  try {
    const pack = state.pack;
    const vtt = state.vtt;

    setStatus("Extracting walls, doors and lights…");
    setProgress(10);
    const fog = extractFog(vtt);
    // Overlay-derived secret doors become extra door segments (short walls until opened).
    for (const grid of pack.secret_doors) {
      const c = cellToWorld(grid);
      fog.doors.push({
        a: { x: c.x - DPI * 0.5, y: c.y },
        b: { x: c.x + DPI * 0.5, y: c.y },
        open: false,
        secret: true,
        center: c,
      });
    }

    setStatus("Decoding map image…");
    setProgress(25);
    const mapFile = base64ToFile(vtt.image, `DotMM-L1-${pack.map}`);
    const baseMap = buildImageUpload(mapFile)
      .dpi(DPI)
      .name(`DotMM Level 1 — Map ${pack.map}`)
      .build();

    setStatus("Building rooms, labels and monsters…");
    setProgress(45);
    const items = [];
    for (const room of pack.rooms) {
      items.push(buildRoomLabel(room));
      items.push(...buildMonsterItems(room));
      if (room.teleport) items.push(buildTeleportMarker(room));
    }
    for (const conn of pack.connectors) items.push(buildConnectorMarker(conn));
    fog.doors.forEach((door, i) => items.push(buildDoorMarker(door, i)));
    for (const grid of pack.secret_doors) items.push(buildSecretDoorMarker(grid));
    items.push(...buildControllerItems(pack, fog));

    setStatus("Uploading scene to your library…");
    setProgress(70);
    const scene = buildSceneUpload()
      .name(`DotMM L1 · Map ${pack.map}`)
      .baseMap(baseMap)
      .items(items)
      .build();
    // Set grid/fog as plain properties: keeps world units at 100 px/cell so
    // every item position computed from the dd2vtt lands exactly on the map,
    // and starts the scene fully fogged.
    scene.grid = { dpi: DPI, type: "SQUARE", measurement: "CHEBYSHEV", scale: "5ft" };
    scene.fog = { filled: true, style: { color: "#000000", strokeWidth: 5 } };
    await OBR.assets.uploadScenes([scene]);

    setProgress(100);
    setStatus(`Map ${pack.map} imported. Open it from your scene Atlas — fog, doors and lights activate automatically.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(`Import failed: ${err.message}`, "err");
    setProgress(0);
  } finally {
    state.importing = false;
    $("importBtn").disabled = false;
  }
});

// ---------- room browser ----------
let currentRooms = [];

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
  currentRooms = ctrl.rooms || [];
  renderRoomList();
}

function renderRoomList() {
  const q = $("search").value.trim().toLowerCase();
  const list = $("roomlist");
  const rooms = currentRooms.filter((r) => {
    if (!q) return true;
    const hay = `${r.label} ${r.name} ${r.monsters.map((m) => m.name).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
  list.innerHTML = rooms
    .map((r, i) => {
      const monCount = r.monsters.reduce((s, m) => s + (m.count || 1), 0);
      return `<div class="room" data-i="${currentRooms.indexOf(r)}">
        <span class="num">${r.label}</span>
        <span class="nm">${r.name}</span>
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
  </div>`;
  det.querySelector(".jump").addEventListener("click", async () => {
    const c = cellToWorld(room.grid);
    const span = 12 * DPI;
    await OBR.viewport.animateToBounds({
      min: { x: c.x - span / 2, y: c.y - span / 2 },
      max: { x: c.x + span / 2, y: c.y + span / 2 },
    });
  });
}

$("search").addEventListener("input", renderRoomList);

// ---------- boot ----------
OBR.onReady(() => {
  refreshRooms();
  OBR.scene.onReadyChange(() => refreshRooms());
});
