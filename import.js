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
  PLUGIN, K, DPI, MONSTER_SIZE,
  normalizeName, ringOffsets, chunkString, extractFog, base64ToFile, fmtError,
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
    setStatus(`Could not read file: ${fmtError(err)}`, "err");
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
    setStatus(`Token picking failed: ${fmtError(err)}`, "err");
  }
});

// ------------------------------------------------------------------
// Item construction. Every position derives from grid cells via a
// dpi parameter so the same builders serve both the preferred
// 100-dpi grid and the 150-dpi default-grid fallback.
// ------------------------------------------------------------------
function makeBuilders(dpi) {
  const cw = (g) => ({ x: g[0] * dpi, y: g[1] * dpi });

  function roomLabel(room) {
    const pos = cw(room.grid);
    const item = buildText()
      .position({ x: pos.x - 90, y: pos.y - 18 })
      .plainText(`${room.label} · ${room.name}`)
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
    item.text.width = 180;
    item.text.height = 36;
    return item;
  }

  function secretDoorMarker(grid) {
    return buildShape()
      .shapeType("CIRCLE")
      .position(cw(grid))
      .width(dpi * 0.6)
      .height(dpi * 0.6)
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

  function doorMarker(door, index) {
    return buildShape()
      .shapeType("CIRCLE")
      .position(cw([door.center.x, door.center.y]))
      .width(dpi * 0.5)
      .height(dpi * 0.5)
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
  }

  function teleportMarker(room) {
    const pos = cw(room.grid);
    return buildLabel()
      .position({ x: pos.x, y: pos.y + dpi * 0.8 })
      .plainText(`⇋ ${room.teleport.label}`)
      .pointerHeight(0)
      .backgroundColor("#12324a")
      .backgroundOpacity(0.9)
      .layer("TEXT")
      .visible(false)
      .locked(true)
      .name(`Teleport ${room.id}`)
      .build();
  }

  function connectorMarker(conn) {
    const target = conn.to === "expanded" ? "Expanded dungeon"
      : conn.to === "level2" ? "Stairs to Level 2"
      : `To map ${conn.to}`;
    return buildLabel()
      .position(cw(conn.grid))
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

  function monsterItems(room) {
    const items = [];
    const tokens = [];
    for (const mon of room.monsters) {
      const count = mon.count || 1;
      for (let i = 0; i < count; i++) tokens.push(mon);
    }
    const offsets = ringOffsets(tokens.length);
    tokens.forEach((mon, i) => {
      const size = MONSTER_SIZE[mon.name] || 1;
      const base = cw(room.grid);
      const pos = {
        x: base.x + offsets[i][0] * dpi * 1.2,
        y: base.y + offsets[i][1] * dpi * 1.2,
      };
      const dl = state.tokenMap.get(normalizeName(mon.name));
      const label = tokens.length > 1 ? `${mon.name} ${i + 1}` : mon.name;
      let item;
      if (dl) {
        const grid = {
          dpi: Math.max(dl.image.width, dl.image.height) / size,
          offset: { x: dl.image.width / 2, y: dl.image.height / 2 },
        };
        item = buildImage(dl.image, grid)
          .position(pos)
          .layer("CHARACTER")
          .visible(false)
          .plainText(label)
          .textItemType("LABEL")
          .name(label)
          .build();
      } else {
        item = buildLabel()
          .position(pos)
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
      items.push(item);
    });
    return items;
  }

  function controllerItems(pack, fog) {
    const payload = JSON.stringify({ w: fog.walls, l: fog.lights });
    const chunks = chunkString(payload, 8000);
    const items = [];
    const controller = buildText()
      .position({ x: -3 * dpi, y: -3 * dpi })
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
        .position({ x: -3 * dpi, y: (-3 - 0.4 * (i + 1)) * dpi })
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

  return { roomLabel, secretDoorMarker, doorMarker, teleportMarker, connectorMarker, monsterItems, controllerItems };
}

function buildAllItems(pack, fog, dpi) {
  const B = makeBuilders(dpi);
  const items = [];
  for (const room of pack.rooms) {
    items.push(B.roomLabel(room));
    items.push(...B.monsterItems(room));
    if (room.teleport) items.push(B.teleportMarker(room));
  }
  for (const conn of pack.connectors) items.push(B.connectorMarker(conn));
  fog.doors.forEach((door, i) => items.push(B.doorMarker(door, i)));
  for (const grid of pack.secret_doors) items.push(B.secretDoorMarker(grid));
  items.push(...B.controllerItems(pack, fog));
  return items;
}

// ---------- import ----------
$("importBtn").addEventListener("click", async () => {
  if (state.importing || !state.vtt || !state.pack) return;
  state.importing = true;
  $("importBtn").disabled = true;
  let stage = "start";
  try {
    const pack = state.pack;
    const vtt = state.vtt;

    stage = "extracting walls/doors/lights";
    setStatus("Extracting walls, doors and lights…");
    setProgress(10);
    const fog = extractFog(vtt);
    for (const grid of pack.secret_doors) {
      fog.doors.push({
        a: { x: grid[0] - 0.5, y: grid[1] },
        b: { x: grid[0] + 0.5, y: grid[1] },
        open: false,
        secret: true,
        center: { x: grid[0], y: grid[1] },
      });
    }

    stage = "decoding map image";
    setStatus("Decoding map image…");
    setProgress(25);
    const mapFile = base64ToFile(vtt.image, `DotMM-L1-${pack.map}`);

    stage = "building scene items";
    setStatus("Building rooms, labels and monsters…");
    setProgress(45);

    // Attempt 1: preferred 100-dpi grid (positions match the dd2vtt exactly).
    // Attempt 2: OBR default grid (150 dpi) with every position rebuilt for it.
    // The background runtime reads the live grid dpi, so fog works either way.
    const attempts = [
      {
        label: "custom 100-dpi grid",
        dpi: DPI,
        grid: {
          dpi: DPI,
          type: "SQUARE",
          measurement: "CHEBYSHEV",
          scale: "5ft",
          style: { lineType: "SOLID", lineColor: "#000000", lineOpacity: 0, lineWidth: 1 },
        },
        fogSetting: { filled: true, style: { color: "#222222", strokeWidth: 5 } },
      },
      {
        label: "default grid (150 dpi)",
        dpi: 150,
        grid: null,
        fogSetting: null,
      },
    ];

    let lastErr = null;
    let succeeded = null;
    for (const attempt of attempts) {
      stage = `uploading scene (${attempt.label})`;
      setStatus(`Uploading scene — ${attempt.label}…`);
      setProgress(70);
      try {
        const baseMap = buildImageUpload(mapFile)
          .dpi(DPI)
          .name(`DotMM Level 1 — Map ${pack.map}`)
          .build();
        const items = buildAllItems(pack, fog, attempt.dpi);
        const scene = buildSceneUpload()
          .name(`DotMM L1 · Map ${pack.map}`)
          .baseMap(baseMap)
          .items(items)
          .build();
        if (attempt.grid) scene.grid = attempt.grid;
        if (attempt.fogSetting) scene.fog = attempt.fogSetting;
        await OBR.assets.uploadScenes([scene]);
        succeeded = attempt;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[DotMM] upload attempt failed (${attempt.label}):`, err);
      }
    }

    if (!succeeded) {
      throw lastErr ?? new Error("all upload attempts failed");
    }

    setProgress(100);
    const suffix = succeeded === attempts[0]
      ? ""
      : " (used OBR's default grid — custom grid was rejected; please report this)";
    setStatus(`Map ${pack.map} imported${suffix}. Open it from your Atlas — fog, doors and lights activate automatically.`, "ok");
  } catch (err) {
    console.error("[DotMM] import failed:", err);
    setStatus(`Import failed at ${stage}: ${fmtError(err)}`, "err");
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
    .map((r) => {
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
    try {
      const dpi = await OBR.scene.grid.getDpi();
      const c = { x: room.grid[0] * dpi, y: room.grid[1] * dpi };
      const span = 12 * dpi;
      await OBR.viewport.animateToBounds({
        min: { x: c.x - span / 2, y: c.y - span / 2 },
        max: { x: c.x + span / 2, y: c.y + span / 2 },
      });
    } catch (err) {
      console.error("[DotMM] jump failed:", err);
    }
  });
}

$("search").addEventListener("input", renderRoomList);

// ---------- boot ----------
OBR.onReady(() => {
  refreshRooms();
  OBR.scene.onReadyChange(() => refreshRooms());
});
