# DotMM Level 1 — All-in-One Owlbear Rodeo Importer

One import per sub-map gives you: the map, dynamic fog (walls + doors + lights
from the dd2vtt), GM-only room labels with names, monster tokens placed per the
book, GM notes, secret-door markers, teleport/gate markers, and map-to-map
connector labels. Fog rendering is native (OBR Warp Core wall/light primitives)
— no other extension is required.

## Hosting (one-time, ~5 minutes)

The extension is static files; any static host works. GitHub Pages:

1. Create a public repo (e.g. `dotmm-obr`), put the contents of this folder at
   the repo root.
2. Settings → Pages → deploy from branch `main`, root.
3. Your manifest URL is `https://<user>.github.io/dotmm-obr/manifest.json`.

## Installing in Owlbear Rodeo

1. In your OBR profile page, choose **Add Extension → Install from URL**.
2. Paste the manifest URL. The "DotMM Importer" action appears in the room's
   top-left extension row.

## Token pack (one-time)

1. In OBR, upload your monster token images to the asset library as
   **Character** images. Name each file after the monster —
   `Bandit Captain.png`, `giant-rat.webp`, `intellect_devourer.jpg` all match
   (case, spaces, hyphens and underscores are ignored).
2. `token_manifest.json` lists the 26 monster names the packs use.

## Importing a map

1. Open the DotMM Importer action.
2. Drop one of the `Level1_<A-F>_BG_*.dd2vtt` files — the sub-map is
   auto-detected from the filename or grid size.
3. (Optional) **Match tokens from my OBR library** — pick your token images;
   the chips show what matched. Unmatched monsters get named placeholder pills
   you can swap later.
4. **Import scene**. The scene appears in your Atlas
   (`DotMM L1 · Map A` etc.). Repeat per sub-map.

## Running the game

- **Open the scene**; the background runtime detects it and materializes
  walls, doors and lights automatically for every connected client.
- **Everything GM-facing is imported hidden** (`visible: false`): room labels,
  monsters, door markers, teleport markers. Reveal monsters by selecting and
  toggling visibility as the party encounters them.
- **Doors**: right-click a door marker → *Open / Close Door*. Closed = red,
  open = green, secret doors = purple. Closed doors block sight and movement.
- **Player vision**: right-click a character token → *DotMM: Toggle Vision
  (60 ft)*. Map lights (candles, braziers from the dd2vtt) are secondary
  lights — they only appear once a token with vision has line of sight,
  so the dungeon starts fully dark.
- **Rooms tab**: with an imported scene open, browse/search all rooms, see
  monster rosters and GM notes, and *Jump to room* to pan the view.
- **Teleports**: area 27's alcove/demiplane pair, the 26d mirror gate
  (→ level 10), the 39a stairs (→ level 2) and the Entrywell all carry ⇋
  markers plus notes in the room browser. Cross-map connectors are labelled
  at the map edges (`→ To map D`, etc.).

## Data provenance and accuracy

- Room anchor positions come from the official GM overlay images, cross-
  registered against the printed book map (median fit residual < 3 cells).
- Area 27 appears twice on map D by design: the material-plane alcove and the
  floating demiplane room both carry the label, wired as a teleport pair.
- Monster rosters and GM notes are condensed from the module text (plus a few
  DotMM Companion tips). Token placement is at room anchors with automatic
  spread — right room, sensible spot; nudge to taste.

## Known limitations

- The imported scene's fog/doors/lights need this extension active in the
  room (it does the materializing). The static map, labels and tokens survive
  without it.
- dd2vtt map images are ~7-9 MB PNGs — within the free-tier 25 MB limit, so
  no compression is applied.
- Vision radius is fixed at 60 ft in v1; edit `background.js` (`12 * DPI`)
  to change it.
