import OBR, {
  buildWall,
  buildLight,
} from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm";
import { PLUGIN, K, MAP_PIXELS, ORIGINS, fmtError } from "./common.js";

// ------------------------------------------------------------------
// The importer persists fog data (walls + lights from the dd2vtt) as
// chunked JSON in hidden controller items, and doors as marker items
// carrying segment metadata. WALL and LIGHT items are local-only in
// OBR, so this background script materializes them for every client
// whenever an imported scene is open, and keeps them in sync as doors
// open/close and vision toggles change.
//
// RECONCILIATION: upload-time dpi hints are not reliably honored, so
// on first open this script measures every map image item as actually
// rendered, rescales/repositions it onto the scene grid (1 map cell =
// 1 grid cell, origin at its global-frame offset), then snaps every
// item carrying cell metadata onto cell * sceneDpi. After that pass,
// cell * sceneDpi is the single source of truth for all geometry.
// ------------------------------------------------------------------

const state = {
  active: false,      // current scene is a DotMM import
  fog: null,          // {w: [[x0,y0,...]...], l: [{x,y,r,c,i}...]}
  doorItems: [],      // synced door marker items
  visionItems: [],    // synced character items with vision metadata
  rebuildQueued: false,
  lastSignatures: {}, // per-group change detectors: skip rebuilds of unchanged groups
  dpi: 150,           // live scene grid dpi; fog metadata is stored in cells
};

// Local items are rebuilt per GROUP (the K.localTag value), each with its
// own signature, so toggling a door only touches the door-wall group -
// base walls and lights stay put and players never see a fog blackout.
const GROUPS = ["wall", "door-wall", "light", "vision"];

function computeSignatures() {
  const on = state.active && state.fog;
  const base = `${state.dpi}`;
  const doors = state.doorItems
    .map((it) => {
      const d = it.metadata[K.door];
      return d ? `${d.a.x},${d.a.y},${d.b.x},${d.b.y},${d.open ? 1 : 0}` : "";
    })
    .sort()
    .join("|");
  const vision = state.visionItems
    .map((it) => `${it.id}:${it.metadata[K.vision]?.cells ?? 0}`)
    .sort()
    .join("|");
  return {
    wall: on ? `${base};${state.fog.w.length}` : "off",
    "door-wall": on ? `${base};${doors}` : "off",
    light: on ? `${base};${state.fog.l.length}` : "off",
    vision: on ? `${base};${vision}` : "off",
  };
}

// ---------- fog data assembly ----------
async function readFogData() {
  const chunkItems = await OBR.scene.items.getItems(
    (it) => it.metadata && it.metadata[K.fogChunk] !== undefined
  );
  if (chunkItems.length === 0) return null;
  const chunks = chunkItems
    .map((it) => it.metadata[K.fogChunk])
    .sort((a, b) => a.i - b.i);
  const n = chunks[0].n;
  if (chunks.length !== n) return null; // incomplete
  try {
    return JSON.parse(chunks.map((c) => c.data).join(""));
  } catch {
    return null;
  }
}

// ---------- local item construction ----------
function wallFromFlat(flat, dpi) {
  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    points.push({ x: flat[i] * dpi, y: flat[i + 1] * dpi });
  }
  const item = buildWall()
    .points(points)
    .doubleSided(true)
    .blocking(true)
    .build();
  item.metadata[K.localTag] = "wall";
  return item;
}

function wallFromDoor(door, dpi) {
  const item = buildWall()
    .points([
      { x: door.a.x * dpi, y: door.a.y * dpi },
      { x: door.b.x * dpi, y: door.b.y * dpi },
    ])
    .doubleSided(true)
    .blocking(true)
    .build();
  item.metadata[K.localTag] = "door-wall";
  return item;
}

function lightFromEntry(entry, dpi) {
  const item = buildLight()
    .position({ x: entry.x * dpi, y: entry.y * dpi })
    .attenuationRadius(entry.r * dpi)
    .sourceRadius(0)
    .falloff(0.35)
    .lightType("SECONDARY")
    .build();
  item.metadata[K.localTag] = "light";
  return item;
}

function visionLight(charItem, radiusCells, dpi) {
  const item = buildLight()
    .position(charItem.position)
    .attenuationRadius(radiusCells * dpi)
    .sourceRadius(0)
    .falloff(0.25)
    .lightType("PRIMARY")
    .attachedTo(charItem.id)
    .disableAttachmentBehavior(["SCALE", "ROTATION"])
    .build();
  item.metadata[K.localTag] = "vision";
  return item;
}

// ---------- rebuild the local scene ----------
let rebuildRunning = false;
let rebuildPending = false;
async function rebuildLocal() {
  if (state.rebuildQueued) return;
  state.rebuildQueued = true;
  // Coalesce bursts of change events into one rebuild per tick.
  await new Promise((r) => setTimeout(r, 30));
  state.rebuildQueued = false;
  // Serialize passes: overlapping add-before-delete runs would duplicate items.
  if (rebuildRunning) {
    rebuildPending = true;
    return;
  }
  rebuildRunning = true;
  try {
    await rebuildPass();
  } finally {
    rebuildRunning = false;
    if (rebuildPending) {
      rebuildPending = false;
      rebuildLocal();
    }
  }
}

async function rebuildPass() {
  // Local-scene APIs reject with MissingDataError when no scene is open;
  // local items are scoped to the scene anyway, so there is nothing to clean.
  const ready = await OBR.scene.isReady().catch(() => false);
  if (!ready) return;

  const signatures = computeSignatures();
  const changed = GROUPS.filter((g) => signatures[g] !== state.lastSignatures[g]);
  if (changed.length === 0) return;

  const existing = await OBR.scene.local.getItems(
    (it) => it.metadata && changed.includes(it.metadata[K.localTag])
  );
  const removeIds = existing.map((it) => it.id);

  const dpi = state.dpi;
  const items = [];
  if (state.active && state.fog) {
    if (changed.includes("wall")) {
      state.fog.w.forEach((flat) => items.push(wallFromFlat(flat, dpi)));
    }
    if (changed.includes("door-wall")) {
      state.doorItems.forEach((marker) => {
        const door = marker.metadata[K.door];
        if (door && !door.open) {
          items.push(wallFromDoor(door, dpi));
        }
      });
    }
    if (changed.includes("light")) {
      state.fog.l.forEach((entry) => items.push(lightFromEntry(entry, dpi)));
    }
    if (changed.includes("vision")) {
      state.visionItems.forEach((ch) => {
        const v = ch.metadata[K.vision];
        if (v && v.cells > 0) {
          items.push(visionLight(ch, v.cells, dpi));
        }
      });
    }
  }

  // Add the fresh items BEFORE deleting the stale ones: a brief overlap of
  // duplicates is invisible, whereas a delete-first gap blacks out every
  // player's fog for the round trip (the "door toggle blink").
  if (items.length) await OBR.scene.local.addItems(items);
  if (removeIds.length) await OBR.scene.local.deleteItems(removeIds);
  for (const g of changed) state.lastSignatures[g] = signatures[g];
}

// ---------- reconciliation ----------
function identifyMapItem(item) {
  // Prefer explicit metadata (extra maps in combined scenes).
  const meta = item.metadata && item.metadata[K.mapImage];
  if (meta) return meta;
  // The baseMap-created item carries no metadata: identify by pixel size.
  const w = item.image?.width, h = item.image?.height;
  for (const [letter, [pw, ph]] of Object.entries(MAP_PIXELS)) {
    if (w === pw && h === ph) {
      return { letter, cells: [pw / 100, ph / 100], origin: ORIGINS[letter] };
    }
  }
  return null;
}

// One alignment pass: measure every map as rendered and write ABSOLUTE
// scale/position values. Absolute writes are idempotent - OBR can replay
// item updates around WebSocket reconnects at scene open (observed in the
// field: a relative `position += delta` applied twice, displacing a map
// by exactly its correction delta), and a replayed absolute write is a
// no-op.
async function alignMaps(dpi) {
  const mapItems = await OBR.scene.items.getItems(
    (it) => it.layer === "MAP" && it.type === "IMAGE"
  );
  for (const it of mapItems) {
    const info = identifyMapItem(it);
    if (!info) continue;
    const targetW = info.cells[0] * dpi;
    const target = { x: info.origin[0] * dpi, y: info.origin[1] * dpi };
    // Measure the item's world-space footprint as ACTUALLY rendered - no
    // assumptions about how OBR interprets image dpi on this build.
    let factor = 1;
    let delta = { x: 0, y: 0 };
    let measured = null;
    try {
      measured = await OBR.scene.items.getItemBounds([it.id]);
    } catch (err) {
      measured = null;
    }
    if (measured && measured.width > 0) {
      factor = targetW / measured.width;
      // Scaling happens about the item's position anchor.
      const newMin = {
        x: it.position.x + (measured.min.x - it.position.x) * factor,
        y: it.position.y + (measured.min.y - it.position.y) * factor,
      };
      delta = { x: target.x - newMin.x, y: target.y - newMin.y };
    } else {
      // Fallback (getItemBounds unavailable): observed behavior renders
      // images at native pixels x scale, anchored at grid.offset.
      const worldW = it.image.width * it.scale.x;
      factor = targetW / worldW;
      const off = it.grid?.offset || { x: 0, y: 0 };
      const anchor = {
        x: off.x * it.scale.x * factor,
        y: off.y * it.scale.y * factor,
      };
      delta = {
        x: target.x + anchor.x - it.position.x,
        y: target.y + anchor.y - it.position.y,
      };
    }
    const newScale = { x: it.scale.x * factor, y: it.scale.y * factor };
    const newPosition = { x: it.position.x + delta.x, y: it.position.y + delta.y };
    await OBR.scene.items.updateItems([it.id], (drafts) => {
      for (const item of drafts) {
        item.scale = newScale;
        item.position = newPosition;
        item.locked = true;
      }
    });
    console.log(`[DotMM] map ${info.letter}: scale x${factor.toFixed(4)}, moved (${delta.x.toFixed(0)}, ${delta.y.toFixed(0)})`);
  }
}

// Snap every cell-tagged item onto the lattice (already absolute writes).
async function snapCellItems(dpi) {
  const cellItems = await OBR.scene.items.getItems(
    (it) => it.metadata && it.metadata[K.cell] !== undefined
  );
  if (cellItems.length > 0) {
    await OBR.scene.items.updateItems(
      cellItems.map((it) => it.id),
      (drafts) => {
        for (const item of drafts) {
          const cell = item.metadata[K.cell];
          if (!Array.isArray(cell)) continue;
          item.position = { x: cell[0] * dpi, y: cell[1] * dpi };
        }
      }
    );
  }
}

// Re-measure every map, log residuals vs target, return the worst |value|.
async function verifyMaps(dpi) {
  let worst = 0;
  for (const it of await OBR.scene.items.getItems(
    (x) => x.layer === "MAP" && x.type === "IMAGE"
  )) {
    const info = identifyMapItem(it);
    if (!info) continue;
    try {
      const b = await OBR.scene.items.getItemBounds([it.id]);
      const rx = b.min.x - info.origin[0] * dpi;
      const ry = b.min.y - info.origin[1] * dpi;
      const rw = b.width - info.cells[0] * dpi;
      worst = Math.max(worst, Math.abs(rx), Math.abs(ry), Math.abs(rw));
      console.log(`[DotMM] verify map ${info.letter}: residual pos (${rx.toFixed(1)}, ${ry.toFixed(1)}) px, width ${rw.toFixed(1)} px`);
    } catch (err) {
      console.log(`[DotMM] verify map ${info.letter}: bounds unavailable`);
    }
  }
  return worst;
}

// Serialized + self-verifying reconcile. The mutex matters: a re-align
// clears reconciledDpi on the controller, and every item-change event
// until it is set again would otherwise spawn another concurrent
// reconcile (reconcile's own updates fire such events - observed as
// dozens of racing passes double-moving maps). The verify/retry loop
// re-runs the measurement pass when a map ends up off target (e.g. an
// update lost to scene-open connection churn), which is what the manual
// Re-align button did by hand.
let reconcileRunning = false;
async function reconcile() {
  if (reconcileRunning) return;
  reconcileRunning = true;
  try {
    const dpi = state.dpi;
    let residual = Infinity;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await alignMaps(dpi);
      await snapCellItems(dpi);
      residual = await verifyMaps(dpi);
      if (residual <= 2) break;
      console.warn(`[DotMM] reconcile attempt ${attempt}: worst residual ${residual.toFixed(1)} px - retrying`);
      await new Promise((r) => setTimeout(r, 400));
    }
    // Mark done on the controller so this runs once per scene.
    const controllers = await OBR.scene.items.getItems(
      (it) => it.metadata && it.metadata[K.controller] !== undefined
    );
    if (controllers.length > 0) {
      await OBR.scene.items.updateItems(
        controllers.map((it) => it.id),
        (drafts) => {
          for (const item of drafts) {
            const ctrl = item.metadata[K.controller];
            ctrl.reconciledDpi = dpi;
            item.metadata[K.controller] = ctrl;
          }
        }
      );
    }
    console.log("[DotMM] reconciled scene geometry at dpi", dpi);
  } finally {
    reconcileRunning = false;
  }
}

// ---------- scene sync ----------
async function syncFromScene() {
  const ready = await OBR.scene.isReady().catch(() => false);
  if (!ready) {
    state.active = false;
    state.fog = null;
    await rebuildLocal();
    return;
  }
  const controllers = await OBR.scene.items.getItems(
    (it) => it.metadata && it.metadata[K.controller] !== undefined
  );
  state.active = controllers.length > 0;
  state.fog = state.active ? await readFogData() : null;
  if (state.active) {
    state.dpi = await OBR.scene.grid.getDpi().catch(() => 150);
    const ctrl = controllers[0].metadata[K.controller];
    if (ctrl.reconciledDpi !== state.dpi) {
      try {
        await reconcile();
      } catch (err) {
        console.error("[DotMM] reconcile failed:", fmtError(err), err);
      }
    }
  }
  if (state.active) {
    // Migration: pre-1.3.0 imports created room labels locked, which makes
    // them unselectable and blocks the Room Details context menu.
    try {
      const lockedLabels = await OBR.scene.items.getItems(
        (it) => it.metadata && it.metadata[K.room] !== undefined && it.locked
      );
      if (lockedLabels.length > 0) {
        await OBR.scene.items.updateItems(
          lockedLabels.map((it) => it.id),
          (drafts) => { for (const item of drafts) item.locked = false; }
        );
      }
    } catch (err) {
      console.error("[DotMM] room label unlock failed:", err);
    }
  }
  state.doorItems = state.active
    ? await OBR.scene.items.getItems((it) => it.metadata && it.metadata[K.door] !== undefined)
    : [];
  state.visionItems = state.active
    ? await OBR.scene.items.getItems((it) => it.metadata && it.metadata[K.vision] !== undefined)
    : [];
  await rebuildLocal();
}

// ---------- context menus ----------
function registerContextMenus() {
  // Door toggle - appears on door markers (GM sees the hidden markers).
  OBR.contextMenu.create({
    id: `${PLUGIN}/toggle-door`,
    icons: [
      {
        icon: new URL("door.svg", import.meta.url).href,
        label: "Open / Close Door",
        filter: {
          every: [{ key: ["metadata", K.door], operator: "!=", value: undefined }],
        },
      },
    ],
    async onClick(context) {
      const ids = context.items.map((it) => it.id);
      await OBR.scene.items.updateItems(ids, (items) => {
        for (const item of items) {
          const door = item.metadata[K.door];
          if (!door) continue;
          door.open = !door.open;
          item.metadata[K.door] = door;
          // Visual affordance on the marker itself.
          if (item.style && item.style.fillColor !== undefined) {
            item.style.fillColor = door.open ? "#5fd39a" : (door.secret ? "#7c5cff" : "#f07a7a");
          }
        }
      });
    },
  });

  // Room details - on room label badges; deep-links into the importer
  // panel's room browser via player metadata (the popover may not even be
  // open yet, so a broadcast would be lost - metadata persists until the
  // panel reads and clears it).
  OBR.contextMenu.create({
    id: `${PLUGIN}/room-details`,
    icons: [
      {
        icon: new URL("icon.svg", import.meta.url).href,
        label: "Room Details",
        filter: {
          every: [{ key: ["metadata", K.room], operator: "!=", value: undefined }],
        },
      },
    ],
    async onClick(context) {
      const item = context.items.find((it) => it.metadata && it.metadata[K.room]);
      if (!item) return;
      const room = item.metadata[K.room];
      await OBR.player.setMetadata({ [K.showRoom]: { id: room.id } });
      await OBR.action.open();
    },
  });

  // Vision toggle on character images (default 60 ft = 12 cells).
  OBR.contextMenu.create({
    id: `${PLUGIN}/toggle-vision`,
    icons: [
      {
        icon: new URL("eye.svg", import.meta.url).href,
        label: "DotMM: Toggle Vision (60 ft)",
        filter: {
          every: [
            { key: "layer", value: "CHARACTER" },
            { key: "type", value: "IMAGE" },
          ],
        },
      },
    ],
    async onClick(context) {
      const ids = context.items.map((it) => it.id);
      await OBR.scene.items.updateItems(ids, (items) => {
        for (const item of items) {
          if (item.metadata[K.vision]) {
            delete item.metadata[K.vision];
          } else {
            item.metadata[K.vision] = { cells: 12 };
          }
        }
      });
    },
  });
}

// ---------- boot ----------
async function safeSync(label) {
  try {
    await syncFromScene();
  } catch (err) {
    console.error(`[DotMM] ${label} failed:`, err);
  }
}

OBR.onReady(() => {
  try {
    registerContextMenus();
  } catch (err) {
    console.error("[DotMM] context menu registration failed:", err);
  }
  safeSync("initial sync");
  OBR.scene.onReadyChange(() => safeSync("scene-change sync"));
  OBR.scene.items.onChange(async (items) => {
    try {
      const hasController = items.some(
        (it) => it.metadata && it.metadata[K.controller] !== undefined
      );
      if (!state.active && !hasController) return;
      state.doorItems = items.filter((it) => it.metadata && it.metadata[K.door] !== undefined);
      state.visionItems = items.filter((it) => it.metadata && it.metadata[K.vision] !== undefined);
      if (hasController && !state.fog) {
        state.active = true;
        state.fog = await readFogData();
      }
      // Manual re-align: the importer panel clears reconciledDpi on the
      // controller; a full sync re-runs calibration.
      const realignRequested = items.some(
        (it) => it.metadata?.[K.controller] &&
                it.metadata[K.controller].reconciledDpi === null
      );
      if (realignRequested) {
        await safeSync("manual re-align");
        return;
      }
      await rebuildLocal();
    } catch (err) {
      console.error("[DotMM] item-change handler failed:", err);
    }
  });
});
