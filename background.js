import OBR, {
  buildWall,
  buildLight,
} from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm";
import { PLUGIN, K } from "./common.js";

// ------------------------------------------------------------------
// The importer persists fog data (walls + lights from the dd2vtt) as
// chunked JSON in hidden controller items, and doors as marker items
// carrying segment metadata. WALL and LIGHT items are local-only in
// OBR, so this background script materializes them for every client
// whenever an imported scene is open, and keeps them in sync as doors
// open/close and vision toggles change.
// ------------------------------------------------------------------

const state = {
  active: false,      // current scene is a DotMM import
  fog: null,          // {w: [[x0,y0,...]...], l: [{x,y,r,c,i}...]}
  doorItems: [],      // synced door marker items
  visionItems: [],    // synced character items with vision metadata
  rebuildQueued: false,
  lastSignature: "",  // cheap change detector: skip rebuilds when inputs are unchanged
  dpi: 150,           // live scene grid dpi; fog metadata is stored in cells
};

function computeSignature() {
  const doors = state.doorItems
    .map((it) => `${it.id}:${it.metadata[K.door]?.open ? 1 : 0}`)
    .sort()
    .join("|");
  const vision = state.visionItems
    .map((it) => `${it.id}:${it.metadata[K.vision]?.cells ?? 0}`)
    .sort()
    .join("|");
  return `${state.active ? 1 : 0};${state.fog ? state.fog.w.length : -1};${doors};${vision}`;
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
async function rebuildLocal() {
  if (state.rebuildQueued) return;
  state.rebuildQueued = true;
  // Coalesce bursts of change events into one rebuild per tick.
  await new Promise((r) => setTimeout(r, 30));
  state.rebuildQueued = false;

  const signature = computeSignature();
  if (signature === state.lastSignature) return;
  state.lastSignature = signature;

  const existing = await OBR.scene.local.getItems(
    (it) => it.metadata && it.metadata[K.localTag] !== undefined
  );
  const removeIds = existing.map((it) => it.id);

  if (!state.active || !state.fog) {
    if (removeIds.length) await OBR.scene.local.deleteItems(removeIds);
    return;
  }

  const dpi = state.dpi;
  const items = [];
  state.fog.w.forEach((flat) => items.push(wallFromFlat(flat, dpi)));
  state.doorItems.forEach((marker) => {
    const door = marker.metadata[K.door];
    if (door && !door.open) {
      items.push(wallFromDoor(door, dpi));
    }
  });
  state.fog.l.forEach((entry) => items.push(lightFromEntry(entry, dpi)));
  state.visionItems.forEach((ch) => {
    const v = ch.metadata[K.vision];
    if (v && v.cells > 0) {
      items.push(visionLight(ch, v.cells, dpi));
    }
  });

  // Replace wholesale: delete ours, add fresh. Simple and correct; item
  // counts here (hundreds) are well within local-scene budgets.
  if (removeIds.length) await OBR.scene.local.deleteItems(removeIds);
  if (items.length) await OBR.scene.local.addItems(items);
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
OBR.onReady(async () => {
  registerContextMenus();
  await syncFromScene();
  OBR.scene.onReadyChange(() => syncFromScene());
  OBR.scene.items.onChange(async (items) => {
    if (!state.active) {
      // A controller might have just been added (first open after import).
      const hasController = items.some(
        (it) => it.metadata && it.metadata[K.controller] !== undefined
      );
      if (!hasController) return;
    }
    state.doorItems = items.filter((it) => it.metadata && it.metadata[K.door] !== undefined);
    state.visionItems = items.filter((it) => it.metadata && it.metadata[K.vision] !== undefined);
    const hasController = items.some(
      (it) => it.metadata && it.metadata[K.controller] !== undefined
    );
    if (hasController && !state.fog) {
      state.active = true;
      state.fog = await readFogData();
    }
    await rebuildLocal();
  });
});
