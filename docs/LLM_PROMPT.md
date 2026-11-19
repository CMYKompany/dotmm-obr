# LLM prompt for writing a room file

Copy everything inside the box below into a chat with an LLM, then paste your
adventure's room descriptions after it. Save the reply as a `.md` file and
drop it into the importer with your map files. The format itself is explained
in [CONTENT_FORMAT.md](CONTENT_FORMAT.md).

If the LLM can see images, also attach the map with the room numbers on it
and keep the line about positions; otherwise delete that line.

````
Convert the adventure text I give you into a "room file" for a map importer.
Output ONLY the room file, in a single Markdown code block, with no commentary
before or after it.

Format rules — follow exactly:

1. First line: "# " followed by the adventure or level name.
2. One section per keyed room or area, in the order they appear in the text.
   Each section starts with a heading line:
     ## <room number>. <room name>
   e.g. "## 7. Guard Room" or "## 12b. Collapsed Stair". Keep the adventure's
   own numbering. Every lettered sub-area (12a, 12b…) is its own section.
3. Under the heading, one line per kind of creature present when the
   characters arrive:
     - <count> <creature name> — <short note>
   - Leave the count out when there is exactly one.
   - Use the creature's standard game name in singular form ("Goblin", not
     "goblins" or "goblin warriors"), because it is matched to token art by
     name. Put names of individual characters in the note instead:
     "- Goblin Boss — Yek the Tall; bargains before fighting".
   - Add "(Large)", "(Huge)" or "(Gargantuan)" after the name for creatures
     of that size. Say nothing for Medium or smaller.
   - Creatures that are dead, imprisoned harmlessly, or only mentioned are
     not listed as creature lines; mention them in the notes.
   - Petrified or statue creatures may be listed, with "petrified" in the note.
4. Then one line starting "notes:" with a short GM summary in your own words
   (one to three sentences): hazards, traps, treasure, secret doors, and what
   the creatures do. Do not copy the original text verbatim.
5. If the room contains a portal, gate, stairs or teleport to another place,
   add a line "teleport: <short description>", e.g.
   "teleport: Arch gate to Level 4 (8th level+)".
6. POSITIONS (only if you were given a map image with room numbers): add a
   line "at: <x>, <y>" giving the room number's location on that map in grid
   squares, counting from the map's top-left corner. If you are unsure of a
   position, leave the "at:" line out entirely rather than guessing.
7. Do not invent rooms, creatures or numbers that are not in the text. Do not
   use any other line types than the ones above.

Example of the expected output:

```
# The Sunken Crypt

## 1. Entry Hall
- 3 Skeleton — shamble toward any noise
- Ghoul — hides behind the coffins, attacks the last in line
notes: Cold draft from the stairs to area 2. Loose flagstone hides 40 gp.

## 2. Shrine
- Specter — appears only after dark
notes: Defiled altar; cleaning it reveals the secret door north.
teleport: Mirror portal to area 5
```

Here is the adventure text:
````
