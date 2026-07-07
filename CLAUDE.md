# DotMM Level 1 → Owlbear Rodeo Importer

Custom Owlbear Rodeo (OBR) extension that imports Dungeon of the Mad Mage
Level 1 into OBR in one action per scene: map images, dynamic fog
(walls/doors/lights from dd2vtt files), GM-only room labels with names,
monster tokens placed per the module, GM notes, secret-door markers,
teleport/gate markers, and a room browser with jump-to-room.

Current version: **1.4.0**. Live at `https://cmykompany.github.io/dotmm-obr/manifest.json`.

## Collaboration preferences (apply to all responses)

- No emotional expressions, praise, or thanks.
- Never claim to understand the user's mental state.
- Say plainly when information is missing or a task is infeasible — before proceeding.
- Think structurally/systemically; avoid one-off patches when a root-cause fix exists.
- Apply design best practices in UI work (hierarchy, contrast, hover states, transitions).
- After writing large code blocks, review for syntax errors and incomplete methods.

## Repo layout

The deployable extension files live at the REPO ROOT — GitHub Pages serves
the repo root and the manifest URLs assume it. There is no `extension/`
subfolder.

```
manifest.json     OBR manifest — ABSOLUTE URLs required (see quirks); version
                  bump forces OBR to refresh; SHORT description required
import.html       Importer panel UI (popover action)
import.js         Import flow: dd2vtt parse, token matching, scene build+upload,
                  room browser, re-align button
background.js     Runtime: reconciliation (self-calibration), local Wall/Light
                  materialization, door toggle + vision context menus
common.js         Shared constants (PLUGIN id, metadata keys K, ORIGINS,
                  MAP_PIXELS, MONSTER_SIZE), fog extraction, token scoring
content.js        GENERATED — embedded content packs + token manifest.
                  Regenerate via pipeline; do not hand-edit.
packs/            Pipeline outputs (content_A..F.json, anchors, token manifest)
pipeline/         Python scripts that produced the data (reference; they read
                  source maps/overlays not included in this repo)
docs/HANDOFF.md   Full narrative: architecture decisions, debugging history,
                  open issues, data provenance
```

## Deploy / test loop

1. Edit the extension files at the repo root, push to the default branch.
2. Bump `manifest.json` version; in OBR remove + re-add the extension
   (OBR caches manifests aggressively).
3. Test in an OBR room. All diagnostics log to the browser console with a
   `[DotMM]` prefix. The Rooms tab has a **Re-align scene** button that
   re-runs calibration and emits `[DotMM] verify map X: residual …` lines.
4. No automated tests exist; OBR cannot be driven headlessly here.

## Architecture (key decisions)

- **One scene per import.** Single dd2vtt → single-map scene; multiple
  dd2vtt files dropped together → ONE combined scene with all sub-maps
  placed at global-frame origins (`ORIGINS` in common.js, in grid cells).
- **A SceneUpload carries exactly one image file** (the baseMap). Extra
  maps in combined scenes are uploaded to the user's OBR library
  (`uploadImages`), picked back (`downloadImages`) for URLs, and placed as
  MAP-layer image items with `K.mapImage` metadata `{letter, cells, origin}`.
- **Fog data persists as metadata, renders as local items.** OBR Wall/Light
  items are LOCAL-ONLY (per client, per session). The importer stores
  walls+lights (grid-cell units, dpi-agnostic) as chunked JSON (≤8KB/chunk,
  item metadata limit ~16KB) on hidden controller text items
  (`K.controller`, `K.fogChunk`). background.js materializes local Wall and
  Light items whenever an imported scene is open.
- **Doors** are PROP-layer circle markers with `K.door` metadata
  `{a, b, open, secret}` (cells). Closed doors contribute wall segments.
  Right-click context menu toggles open/closed (green/red, purple=secret).
  Secret doors come from overlay glyphs, not dd2vtt portals: at import,
  `alignDoorToWall()` snaps each onto the nearest wall and CUTS a matching
  gap out of that wall, so the closed-door segment is the gap's only
  blocker (dd2vtt draws secret doorways as solid wall — without the cut,
  opening them does nothing). Every door circle carries `K.door`; there
  are no decorative door markers.
- **Local fog items rebuild per group** (wall / door-wall / light /
  vision), each with its own signature, and new items are added BEFORE
  stale ones are deleted. Toggling a door touches only the door-wall
  group; a wholesale delete-then-add rebuild blacks out every player's
  fog for the round trip.
- **Vision**: context menu on CHARACTER images writes `K.vision {cells: 12}`;
  background attaches a local PRIMARY light. dd2vtt lights are SECONDARY,
  so rooms illuminate only when a sighted token has line of sight.
- **Self-calibration (reconcile)**: upload-time dpi hints are NOT reliably
  honored by OBR, so every positioned item carries `K.cell` = intended
  position in grid cells. On scene open (or Re-align), background.js
  measures each map image's rendered bounds via
  `OBR.scene.items.getItemBounds`, rescales/moves it so 1 map cell =
  1 grid cell at `origin × sceneDpi`, then snaps every K.cell item to
  `cell × sceneDpi`. Never assume a dpi formula — measure. Reconcile is
  MUTEX-SERIALIZED (its own updates fire item-change events which would
  otherwise spawn concurrent passes during a re-align), writes ABSOLUTE
  scale/position values (OBR can replay updates around scene-open
  WebSocket churn; a relative `+= delta` then applies twice), and loops
  measure→snap→verify up to 3× until worst residual ≤ 2 px.

## OBR platform quirks (hard-won; do not re-learn)

1. Manifest paths must be fully-qualified URLs; relative paths get naively
   concatenated (DNS error like `host.tldimport.html`).
2. Long manifest descriptions break installation. Keep it short.
3. `uploadScenes` rejects with non-Error values — `err.message` may be
   undefined. Use `fmtError()` (common.js) everywhere.
4. Image-dpi handling on upload is inconsistent between imports; the
   empirical bounds-based reconcile is the countermeasure.
5. `OBR.scene.local.*` and most scene APIs reject with
   `MissingDataError: No scene found` when no scene is open. Guard every
   entry point; one unhandled rejection kills the background runtime.
6. The SDK is imported from CDN as ESM:
   `https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3/+esm` (no build step).

## Data provenance

- 65 room anchors from official GM overlay PNGs, OCR + manual curation,
  validated against the printed book map (fit residuals < 3 cells).
- Area 27 appears twice on map D by design: material-plane alcove +
  floating demiplane room, wired as a teleport pair.
- `ORIGINS` are integers, rounded from connector-label seam estimates.
  Wall-vector cross-validation was attempted and is impossible (tiles do
  not share wall geometry in overlaps). Residual risk: any seam ±1 cell;
  map D's y-origin was ambiguous between 54 and 55 (54 chosen).
- Monster rosters (26 unique, 127 placements) and short paraphrased GM
  notes are condensed from the module text. Do not embed verbatim book
  text in the repo.
- Regenerating content: `pipeline/build_content.py` reads
  `packs/anchors_curated.json` and writes `packs/content_*.json`; then
  bundle into `content.js` (see HANDOFF for the exact snippet).

## Open issues (state as of v1.3.0)

1. **RESOLVED (v1.1.2/v1.2.0): misalignment + door correctness.**
   User-confirmed 2026-07-06: verify residuals all (0.0, 0.0); v1.2.0
   fixes (token snap, wall-aligned secret doors with cut gaps, single
   functional door markers, group-wise local rebuild, number badges) all
   confirmed working in the field.
2. v1.3.0 UX pass: Import auto-uploads missing extra map images (step 2b
   is now optional, for re-using earlier uploads); room browser sorted by
   room number; "Room Details" context menu on room label badges
   deep-links into the room browser via `K.showRoom` player metadata.
   Room labels import unlocked (and background unlocks old locked ones)
   so they can be right-clicked.
3. Token matching happens at import time only; changing matches requires
   re-import (or manual image swap in-scene).
4. Seam errors (ORIGINS off by 1–3 cells for some maps): fixed IN-SCENE
   via the Rooms-tab **Map offsets** nudge UI (≥1.4.0 imports only). A
   nudge writes `ctrl.originOverrides[letter]` (cells) and re-aligns, so
   the map image, tokens, labels, doors, WALLS and lights move as one
   unit. NEVER fix seams by dragging a map — content and walls will not
   follow. Once the user settles on offsets, bake them into `ORIGINS` and
   drop the overrides. Every per-map item carries `K.map`; fog payload
   entries carry `m` (letter); pre-1.4.0 scenes lack both, so the nudge
   UI hides itself there.
5. Only Level 1 is covered. Extending to other levels requires rerunning
   the pipeline against that level's overlays/dd2vtt/text.
6. If a secret door logs "no wall within 2.5 cells" at import, its overlay
   anchor is too far from the wall it marks — fix the anchor in
   `packs/anchors_curated.json` / regenerate, or accept the unaligned
   fallback (horizontal 1-cell segment at the anchor).
