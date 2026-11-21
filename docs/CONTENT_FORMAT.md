# Writing a room file

A **room file** tells the importer what's in each room of your map: its name,
which monsters are there, and your notes. Drop it into the importer together
with your map files (`.dd2vtt`). You get:

- a numbered label on the map for each room that has a position,
- monster tokens in those rooms (matched to your own token art by name),
- a searchable **room browser** with names, monsters and notes,
- a **Place** button for rooms that don't have a position yet.

You can write the file by hand, or have an LLM write it from your adventure
text — see [Using an LLM](#using-an-llm) below.

DotMM levels (`Level2_A_…` files) already come with their rooms; you only
need a room file for other maps, or to replace a DotMM level's rooms.

---

## The short version

```
# The Sunken Crypt

maps: Upper at 0, 0; Lower at 40, 0

## 1. Entry Hall
map: Upper   at: 12, 8
- 3 Skeleton — shamble toward noise
- Ghoul
notes: A cold draft comes up the stairs.

## 2. Shrine
- Specter — only appears at night
teleport: Mirror to room 5
```

Save it as a plain text file ending in `.md` (for example `crypt.md`).

---

## Rooms

Every room starts with a heading line: two `#` signs, the room's number,
then its name.

```
## 7. Guard Room
## 12b. Collapsed Stair
## Kitchen
```

- The **number** (`7`, `12b`) is what the map label shows. A period after it
  is optional.
- A room **without a number** is fine — its whole heading is used as the
  label.
- Everything below a heading belongs to that room, until the next heading.

## Monsters

One line per kind of monster, starting with `-`:

```
- 3 Skeleton
- Goblin Boss — Yek the Tall, wears a magic circlet
- Owlbear (Large)
```

- **Count** first. Leave it out for one monster. `Ghoul x2` and `Ghoul (2)`
  also work.
- **Name** next. This is what the importer matches against your token art:
  a monster called `Giant Rat` uses an image named `Giant Rat.png`,
  `giant-rat.webp` and so on.
- **Note** last, after a dash (`—`, `–` or ` - `) or a colon. It shows up in
  the room browser.
- **Size** (optional): `(Large)`, `(Huge)` or `(Gargantuan)` makes the token
  2×2, 3×3 or 4×4 cells. Medium and smaller are 1 cell.

## Notes

```
notes: The altar grants a blessing if cleaned.
```

Any other text you write inside a room also becomes part of its notes, so you
can just write sentences:

```
## 4. Library
- Mimic (Large) — disguised as a lectern
Most books are rotten. One shelf hides a lever.
Treasure: 50 gp in a hollow book.
```

## Where a room goes on the map

```
at: 12, 8
```

`at:` is the room's position in **grid cells** — count squares across from
the left edge (x) and down from the top edge (y) of the map. Decimals are
fine (`12.5, 8`).

**Positions are optional.** A room without `at:` still appears in the room
browser with its monsters and notes; you place it later by clicking the map
(see below). This means a room file written from adventure text alone, with
no positions at all, is already useful.

### With several maps

If you import more than one map file at once, say which map a position is on:

```
map: Upper   at: 12, 8
```

`map:` is the map file's name without `.dd2vtt` (`Upper` for
`Upper.dd2vtt`), or its letter as shown in the importer (`Map A`, `Map B`, …).
For DotMM levels use the sub-map letter (`map: C`).

An `at:` with no `map:` line is measured across the whole combined scene
instead of from one map's corner.

## Arranging several maps

When you import several map files at once they're combined into one scene.
Say where each map's top-left corner goes, in grid cells, on a `maps:` line
near the top of the file:

```
maps: Upper at 0, 0; Lower at 40, 0
```

Leave it out and the maps are placed side by side in a row; you can then move
each one on the importer's **Align** tab (arrows move a map one cell at a
time, together with its walls, doors, lights, labels and tokens).

## Teleports and gates

```
teleport: Arch gate to Level 4 (8th level+)
```

Adds a marker under the room label. Two optional extra lines can follow it —
a kind, and the room at the other end:

```
teleport: Mirror to the vault
teleport kind: mirror
teleport pair: 12
```

## Anything else

- `# Title` on the first line names the scene.
- `id: 27-alcove` — only needed when two rooms share a number; gives one of
  them a different internal name. (If you forget, the importer renames the
  second one and tells you.)
- Lines in `<!-- like this -->` are comments and are ignored.
- Blank lines and `---` dividers are ignored.

---

## After importing: placing rooms by clicking

Rooms without a position are marked **unplaced** in the importer's **Rooms**
tab.

1. Open a room and choose **Place on map…**, or use **Place N unplaced
   rooms…** to go through all of them in order.
2. The importer panel closes. Click the map where the room goes — its label
   and monster tokens appear there.
3. When placing several, a message tells you which room is next. Switch to any
   other tool to stop; the rest stay unplaced.

Then use **Export room file** on the Rooms tab. It saves your room file with
the positions you clicked and your current map arrangement filled in, so the
next import puts everything in place straight away.

---

## Using an LLM

Paste the prompt from [LLM_PROMPT.md](LLM_PROMPT.md) into a chat with any
capable LLM, followed by your adventure's room descriptions. Save its answer
as a `.md` file and drop it into the importer.

- An LLM working from **text only** can fill in names, monsters and notes,
  but not positions — leave those for click-to-place.
- An LLM that can **see images** can also estimate positions if you give it
  the map with room numbers on it. Check a few after importing; fix any that
  are off by placing them again and re-exporting.

## When the importer finds a problem

After you drop a room file, the importer shows how many rooms it found and
lists anything it couldn't use — for example a monster line with no name, or
a position it couldn't read. Problems are reported, never silently dropped.
A file that can't be used at all (no rooms found) blocks the import until you
fix it or click **Clear**.

## JSON instead of Markdown

Tools that produce structured data can write the same content as JSON — see
[content.schema.json](content.schema.json):

```json
{
  "title": "The Sunken Crypt",
  "maps": { "Upper": [0, 0], "Lower": [40, 0] },
  "rooms": [
    { "id": "1", "name": "Entry Hall", "map": "Upper", "at": [12, 8],
      "monsters": ["3 Skeleton", { "name": "Ghoul", "count": 1 }],
      "notes": "A cold draft comes up the stairs." }
  ]
}
```
