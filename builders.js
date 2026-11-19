// Scene item builders shared by import.js (initial import) and background.js
// (click-to-place of rooms that had no position). Positions are computed at
// the given dpi, and every item records its intended grid-cell position in
// metadata so the background runtime can self-calibrate against the
// rendered map.
import {
  buildText,
  buildLabel,
  buildImage,
  buildShape,
} from "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm";
import { PLUGIN, K, MONSTER_SIZE, ringOffsets, snapTokenCell } from "./common.js";

export { buildText };

export function withCell(item, cellX, cellY, dpi) {
  item.metadata[K.cell] = [
    Math.round(cellX * 100) / 100,
    Math.round(cellY * 100) / 100,
  ];
  item.position = { x: cellX * dpi, y: cellY * dpi };
  return item;
}

// origin: added to every pack-local grid position (global frame offset).
// occupied: Set of "x,y" token-occupied cells, shared across one import.
// tokenImage(name): ImageContent for a matched token image, or null for a
// labelled placeholder.
export function makeBuilders(dpi, origin, occupied, tokenImage) {
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
      .name(`Room ${room.label}${room.name ? ` · ${room.name}` : ""}`)
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
    const lvl = /^level(\d+)$/.exec(conn.to);
    const target = conn.to === "expanded" ? "Expanded dungeon"
      : lvl ? `Stairs to Level ${lvl[1]}`
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

  // GM-only trap marker (the overlay 'T' glyphs; Level 2+).
  function trapMarker(grid, index) {
    const [cx, cy] = gc(grid);
    const item = buildShape()
      .shapeType("TRIANGLE")
      .width(dpi * 0.6)
      .height(dpi * 0.6)
      .fillColor("#f0b35f")
      .fillOpacity(0.4)
      .strokeColor("#f0b35f")
      .strokeWidth(3)
      .layer("PROP")
      .visible(false)
      .locked(true)
      .name(`Trap ${index + 1}`)
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
      const size = mon.size || MONSTER_SIZE[mon.name] || 1;
      // Snap the ring formation onto the grid lattice; occupancy tracking
      // spreads colliding tokens to the nearest free cells.
      const [cx, cy] = snapTokenCell(
        bx + offsets[i][0] * 1.2, by + offsets[i][1] * 1.2, size, occupied);
      const image = tokenImage(mon.name);
      const label = tokens.length > 1 ? `${mon.name} ${i + 1}` : mon.name;
      let item;
      if (image) {
        const grid = {
          dpi: Math.max(image.width, image.height) / size,
          offset: { x: image.width / 2, y: image.height / 2 },
        };
        item = buildImage(image, grid)
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

  return { roomLabel, doorMarker, teleportMarker, connectorMarker, trapMarker, monsterItems };
}
