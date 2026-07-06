"""Emit per-submap content packs + token manifest for the OBR importer.
Room data hand-curated from the module text (paraphrased, functional notes)."""
import json

anchors = json.load(open('packs/anchors_curated.json'))
DIMS = {'A': (70, 64), 'B': (65, 50), 'C': (63, 68),
        'D': (63, 62), 'E': (73, 58), 'F': (70, 51)}

M = lambda name, count=1, note=None: {k: v for k, v in
    [('name', name), ('count', count), ('note', note)] if v is not None}

ROOMS = {
 '1':  {'name': 'Entrywell', 'monsters': [],
        'note': 'Rope drop from the Yawning Portal. A bandit watches through a secret spy-hole and retreats to warn area 6 when intruders arrive.',
        'teleport': {'kind': 'surface', 'label': 'Up to the Yawning Portal'}},
 '2a': {'name': 'Demon Reliefs', 'monsters': [],
        'note': 'Thirteen demon bas-reliefs. Kenku skeleton points at the nalfeshnee (secret door to 3). Dretch relief hides a second secret door to 4 with spy-hole eyes.'},
 '2b': {'name': 'Pillar Forest', 'monsters': [M('Bugbear', 2, 'each hosts an intellect devourer; cannot be surprised; flee south to warn area 23')],
        'note': 'Bugbears hide behind pillars and withdraw to alert Worg\u2019s Eye. Harmless snake skeleton on north pillar; looted secret compartment in south pillar.'},
 '3':  {'name': 'Slanted Room', 'monsters': [M('Gray Ooze', 1, 'psychic variant; invisible underwater north of the statue')],
        'note': 'Flooded, tilted sewer room. Sahuagin statue\u2019s screw-off head hides a wand of secrets clue; ooze psychic-crushes anyone approaching.'},
 '4':  {'name': 'With Sword in Hand', 'monsters': [],
        'note': 'Cursed glowing longsword in a stand (wielder cannot drop it). Ceiling vents carry distorted Waterdeep voices; Tiny creatures could escape through them.'},
 '5':  {'name': 'Grell Hideout', 'monsters': [M('Grell', 2, 'hidden in north and east alcoves; pursue fleeing prey')],
        'note': 'Black bone pillars give the grells cover. No treasure.'},
 '6a': {'name': 'Hall of Three Lords', 'monsters': [],
        'note': 'Rally point: if alerted, all Undertakers (captain, six bandits, two doppelgangers) gather here to extort a toll. Broken white staff wails "Thief!" when mended and held.'},
 '6b': {'name': 'Rigged Secret Door', 'monsters': [],
        'note': 'Stacked plates crash when the door opens, alerting bandits in 6a, 6c, 6d.'},
 '6c': {'name': "Uktarl's Room", 'monsters': [M('Bandit Captain', 1, 'Uktarl; cowardly, retreats to 7'), M('Bandit', 2), M('Doppelganger', 1)],
        'note': 'Card game with marked deck. Dwarf-mountain fresco hides a stone key (DC 13 Perception) that opens the box in 14b. Coins on the table.'},
 '6d': {'name': 'Sleeping Quarters', 'monsters': [M('Bandit', 4, 'asleep'), M('Doppelganger', 1, 'keeping watch')],
        'note': 'Eight bedrolls, two lanterns.'},
 '7a': {'name': 'Hall of Retreat', 'monsters': [],
        'note': 'Undertakers\u2019 fallback: Uktarl and Harria make a final stand here if routed. Companion: they yield rather than die; will trade dungeon info for their lives.'},
 '7b': {'name': 'Crypt', 'monsters': [],
        'note': 'Old vampire lair, long vacant. Coffin with mist-hole holds only a vial of holy water.'},
 '8a': {'name': 'Hall of the Bone Throne', 'monsters': [],
        'note': 'Wyvern remains and shattered crystal prison. Throne\u2019s serpent armrests animate and bite (poison, DC 13 Con) when someone sits or lifts the seat; hidden compartment is empty.'},
 '8b': {'name': "Harria's Room", 'monsters': [M('Bandit Captain', 1, 'Harria; sleeps unless disturbed, flees to 7'), M('Flesh Golem', 1, 'her guard; she cannot control it if berserk')],
        'note': 'Clown-painted trunk holds a disguise kit and costumes.'},
 '8c': {'name': 'Masters of Disguise', 'monsters': [M('Bandit', 5, 'disguised as vampires'), M('Doppelganger', 1)],
        'note': 'Vampire-posing extortionists; flee to 6 when outmatched. Disguise kits and rations on the table.'},
 '9a': {'name': 'Pillared Way', 'monsters': [],
        'note': 'Gem sockets looted; rusted animated-armor remains in the alcove.'},
 '9b': {'name': 'Rotted Corpse', 'monsters': [],
        'note': 'Dead Undertaker (spider venom). Intact scimitar and light crossbow; empty pouch.'},
 '10': {'name': 'Cubicle of Skulls', 'monsters': [],
        'note': 'Thousands of harmless skulls avalanche out when the door opens.'},
 '11': {'name': 'Room of Secrets', 'monsters': [],
        'note': 'Wear the copper helm while sitting on the copper throne: a wand of secrets drops from the ceiling.'},
 '12': {'name': 'Hall of Heroes', 'monsters': [],
        'note': 'Thirty-eight defaced statues; webbed ceiling; three dead giant spiders. Elder rune trap on the east double doors to 16.'},
 '13': {'name': 'Empty Room', 'monsters': [],
        'note': 'Empty; a good spot for a regional effect of Halaster\u2019s lair.'},
 '14a': {'name': 'Sloping Tunnel', 'monsters': [],
        'note': 'Empty; north tunnel slopes 20 ft down to 14b.'},
 '14b': {'name': 'Heart in a Box', 'monsters': [M('Sahuagin Baron', 1, 'petrified statue; animates only if the box is pried from its grasp (DC 20 Athletics)')],
        'note': 'Floating acid dome falls (2d10/turn, floods 5 ft) if the box opens without the key from 6c. Lead-lined box holds the withered tiefling heart (swaps with the attuner\u2019s heart \u2014 instant death).'},
 '14c': {'name': 'Secret Room', 'monsters': [], 'note': 'Empty 10-ft room.'},
 '15': {'name': 'Armory', 'monsters': [],
        'note': 'Collapsed weapon racks; ordinary handaxe in the south door; seized sharpening wheel in the south room.'},
 '16': {'name': 'Manticore Den', 'monsters': [M('Manticore', 3, 'attack all but Halaster and the charmed troll')],
        'note': 'Companion: the manticores speak Common \u2014 have them mock and goad, and remember they fly. Nest treasure includes a 250 gp bloodstone necklace. Scrying eye appears if the party returns later.'},
 '17a': {'name': 'Foyer', 'monsters': [M('Giant Centipede', 2, 'inside the basilisk corpse; emerge if disturbed')],
        'note': 'Dead basilisk on its back clutches a driftglobe (pry the claw open).'},
 '17b': {'name': 'Desecrated Temple', 'monsters': [M('Black Pudding', 1, '120 hp; in stasis coating the Gond statue until touched or harmed')],
        'note': 'Eleven petrified adventurers and monsters clustered at the south end. Copper crown (75 gp) on the carrion crawler\u2019s tentacle.'},
 '18': {'name': "Troll's Den", 'monsters': [M('Troll', 1, 'charmed by Halaster: fetches meat daily from 19a for the manticores in 16')],
        'note': 'Putrid stench forewarns. Dispel magic (DC 15) ends the charm, not the temper.'},
 '19a': {'name': "Servants' Feast Hall", 'monsters': [],
        'note': 'Conjured rotting meat appears on the tables at dawn; the troll from 18 feeds here daily.'},
 '19b': {'name': "Guards' Feast Hall", 'monsters': [],
        'note': 'Copper tankard (25 gp) under a table.'},
 '19c': {'name': "Nobles' Feast Hall", 'monsters': [],
        'note': 'Door blocked by a dead dwarf burglar; her nearly complete burglar\u2019s pack lies on a bench.'},
 '20': {'name': 'Beyond the Green Door', 'monsters': [],
        'note': 'Harmless green door with iron face. Empty room \u2014 or your hook into an expanded dungeon.'},
 '21': {'name': 'Hall of Mirrors', 'monsters': [M('Shadow', 2, 'construct duplicates; spawn when someone passes the two westernmost mirrors; vanish after 1 minute')],
        'note': 'Sixteen niche mirrors, five magical. Three illusory mirrors hide shelves; one holds the bronze Halaster mask (50 gp) \u2014 the key to area 27.'},
 '22': {'name': 'Empty Room', 'monsters': [],
        'note': 'Torch stubs and empty potion bottles; adventurers rest here.'},
 '23a': {'name': "Nimraith's Fate", 'monsters': [M('Goblin', 6, 'bored, playing games')],
        'note': 'Part of Worg\u2019s Eye watch post (2 bugbears + 15 goblins total; none can be surprised if warned).'},
 '23b': {'name': 'Shattered Statue', 'monsters': [M('Bugbear', 2, 'each hosts an intellect devourer; cannot be surprised')],
        'note': 'Bugbears reassemble a statue of three warriors (17 pieces). Devourers teleport out when a host drops.'},
 '23c': {'name': 'Goblin Den', 'monsters': [M('Goblin', 9, 'asleep unless the post is alerted')],
        'note': 'If the bugbears die, these goblins flee to 28 via 24 and 25.'},
 '24a': {'name': 'Old Gate', 'monsters': [],
        'note': 'West tunnel exits to the expanded dungeon (or uncharted depths).'},
 '24b': {'name': 'Dead Mage', 'monsters': [],
        'note': 'Remains of the tiefling wizard whose withered heart waits in 14b.'},
 '25a': {'name': 'Dead Goblin', 'monsters': [],
        'note': 'Excavation site. Goblin corpse.'},
 '25b': {'name': 'Headless Statue', 'monsters': [],
        'note': 'Excavation site. Decapitated statue.'},
 '26a': {'name': 'Hall of Many Candles', 'monsters': [],
        'note': 'Fifty ever-burning floating candles in 25 niches; conspicuously clean (the cube\u2019s work). Dispel magic breaks them all.'},
 '26b': {'name': 'Empty Closet', 'monsters': [], 'note': 'Empty 10-ft room.'},
 '26c': {'name': 'Ooze Your Janitor?', 'monsters': [M('Gelatinous Cube', 1, 'just around the corner; surprises anyone with passive Perception below 15')],
        'note': 'The cube keeps the Clean Tunnels clean.'},
 '26d': {'name': 'Mirror Gate to Level 10', 'monsters': [],
        'note': 'Gate of the Elder Wand: touch the mirror with a charged magic wand to open for 1 minute; 11th level required; first passage triggers an elder rune. Exits at level 10 area 8.',
        'teleport': {'kind': 'gate', 'label': 'Mirror Gate \u2192 Level 10, area 8'}},
 '27': {'name': 'Hidden Demiplane', 'monsters': [],
        'note': None},  # handled per variant below
 '28a': {'name': 'West Chamber', 'monsters': [M('Bugbear', 2, 'standing guard')],
        'note': 'Part of Grick Snack watch post (2 bugbears + 6 goblins total).'},
 '28b': {'name': 'Obelisk of the Eye', 'monsters': [],
        'note': 'Goblin bunkroom around a 14-ft obelisk. First bare-handed touch: Halaster\u2019s telepathic riddle pointing to 38/39a and the stairs to level 2.'},
 '28c': {'name': 'East Chamber', 'monsters': [M('Goblin', 6, 'jittery, bows trained on the east tunnel; ordered to kill gricks')],
        'note': 'Dead goblins and a dead grick on the floor. Secret door north (defenders unaware).'},
 '28d': {'name': 'Concealed Spiked Pit', 'monsters': [],
        'note': 'Floor lid over a 30-ft spiked pit (3d6 + 2d10; DC 15 Perception to spot). Dead goblin below has a lucky dwarf-thumb charm.'},
 '29': {'name': 'Eye See You!', 'monsters': [],
        'note': 'Sixteen heraldic shields. One of Halaster\u2019s scrying eyes studies the party, then vanishes.'},
 '30a': {'name': 'Zigzagging Hall', 'monsters': [],
        'note': 'Anti-archer hall. The berserk air elemental charges any opened door.'},
 '30b': {'name': 'Guard Room', 'monsters': [M('Air Elemental', 1, 'berserk and trapped; howls constantly; rushes any opened door')],
        'note': 'Wrecked gear on the floor. Secret door west to a tunnel connecting to 31.'},
 '31': {'name': "Delvers' Hall", 'monsters': [M('Wererat', 1, 'Sylvia Featherstone in giant rat form; Xanathar spy hunting secret doors; flees to 35')],
        'note': 'Dwarf statues in alcoves; one pushed aside reveals the secret tunnel to 30b.'},
 '32a': {'name': 'Empty Bedchamber', 'monsters': [],
        'note': 'Cave-fresco walls; empty.'},
 '32b': {'name': 'Bathroom', 'monsters': [],
        'note': 'The spigot still works: hot, clean water.'},
 '33': {'name': 'North Dormitory', 'monsters': [],
        'note': 'Eleven stone shelf-beds.'},
 '34': {'name': 'South Dormitory', 'monsters': [],
        'note': 'Like 33, plus an elf skeleton with serviceable hide armor and quarterstaff.'},
 '35': {'name': 'Hall of Rats', 'monsters': [M('Giant Rat', 10), M('Wererat', 1, 'Flyndol Greeth, sleeping as an obese giant rat on the throne; surrenders if cornered')],
        'note': 'Two dry dwarf-face fountains in the south wall. Flyndol awaits Sylvia (31).'},
 '36a': {'name': 'Cricks!', 'monsters': [M('Grick', 2, 'attack all who enter')],
        'note': 'Partially collapsed hall strewn with skull-crushing debris.'},
 '36b': {'name': 'Trapped Fellow', 'monsters': [M('Grick', 5, 'in the diagonal hall south'), M('Spy', 1, 'Kelim the Weasel, sealed in the west closet; weeping; treacherous if rescued')],
        'note': 'Kelim trades a stolen spellbook (11 spells incl. lightning bolt) for rescue. Companion: he will betray anyone to save himself.'},
 '36c': {'name': 'Upside-Down Throne', 'monsters': [M('Grick Alpha', 1, 'gorged and sleeping; ignores anyone staying 10 ft away')],
        'note': 'Permanent reverse gravity above 10 ft (dispel DC 18). Mummified minotaur on a ceiling throne has gem eyes (10 gp agate, 50 gp zircon).'},
 '37': {'name': 'Map Room', 'monsters': [M('Revenant', 1, 'Halleth Garke, trapped in the pit; seeks his three murderers (level 2); ally material')],
        'note': 'Wall carving of all 23 levels with three voice-buttons (Skullport / Stardock / Halaster\u2019s Tower gate access). Companion: Halleth is a self-expiring ally \u2014 use him. Secret door south to 38.'},
 '38': {'name': 'Secret Tunnel', 'monsters': [],
        'note': 'Hidden curved corridor linking 37 and 39; heavy foot traffic in the dust.'},
 '39a': {'name': 'Hall of the Two-Headed King', 'monsters': [],
        'note': 'Stairs descend 200 ft to level 2. Rotating the statue\u2019s warhammer (DC 15 Perception to notice) reveals a circlet of blasting.',
        'teleport': {'kind': 'stairs', 'label': 'Stairs down \u2192 Level 2'}},
 '39b': {'name': 'Bugbear Den', 'monsters': [M('Bugbear', 3, 'one hosts an intellect devourer; cannot be surprised')],
        'note': 'Part of Big Ears watch post (3 bugbears, 19 goblins, 2 ettins; a shrieker warns them).'},
 '39c': {'name': 'Goblin Hall', 'monsters': [M('Goblin', 19, 'starving and bickering')],
        'note': 'A twentieth goblin lies dead \u2014 an argument gone badly.'},
 '39d': {'name': 'Old Forge', 'monsters': [M('Ettin', 2, 'Krung-Jung and Bokk-Nokkin, Xanathar-branded')],
        'note': 'Dead forge hides sacks: 1,400 cp, 350 sp, and 120 iron ingots. Seven-thousand-pound rune-carved hammer hangs over the anvil.'},
 '40': {'name': 'Fearful Mimicry', 'monsters': [M('Mimic', 1, 'Large, 75 hp; poses as the south-alcove statue with a fake gold spear')],
        'note': 'Two genuine elf-warrior statues north; rubble of the original statue behind the mimic.'},
 '41': {'name': 'Cracked Ceiling', 'monsters': [M('Stirge', 20, 'roost in the ceiling fissure; descend on noise or uplifted light')],
        'note': 'Mining tools in wheelbarrows. Bugbears hunt stirges here for food.'},
}

VARIANT_27 = {
 'alcove': {'name': 'Hidden Demiplane (Alcove)',
   'note': 'Bas-relief harpist with inscription. Stepping in while wearing the bronze mask from 21 transports you to the demiplane; anchoring objects are sheared off.',
   'teleport': {'kind': 'demiplane', 'label': 'Mask-gate \u2192 Demiplane', 'pair': '27-demiplane'}},
 'demiplane': {'name': 'Hidden Demiplane (Interior)',
   'monsters': [M('Halaster Simulacrum', 1, 'answers three questions: first a lie, then two truths; melts afterward')],
   'note': 'Thirty-ft stone room: misty portal back, upside-down Halaster portrait. Companion: steering the party here is the level\u2019s main goal \u2014 Halaster facetime. Tossing the mask back through lets others enter.',
   'teleport': {'kind': 'demiplane', 'label': 'Misty portal \u2192 Alcove', 'pair': '27-alcove'}},
}

packs = {}
for L, data in anchors.items():
    gw, gh = DIMS[L]
    rooms_out = []
    for r in data['rooms']:
        label = r['label']
        if label == '27':
            src = dict(VARIANT_27[r['variant']])
            rid = f"27-{r['variant']}"
        else:
            src = dict(ROOMS[label])
            rid = label
        room = {'id': rid, 'label': label, 'name': src['name'], 'grid': r['grid'],
                'monsters': src.get('monsters', []), 'gm_note': src.get('note')}
        if 'teleport' in src:
            room['teleport'] = src['teleport']
        rooms_out.append(room)
    packs[L] = {
        'schema': 'dotmm-obr-pack/1', 'level': 1, 'map': L,
        'grid': {'w': gw, 'h': gh, 'pixels_per_grid': 100},
        'dd2vtt_file': f'Level1_{L}_BG_{gw}x{gh}_FVTT.dd2vtt',
        'rooms': rooms_out,
        'secret_doors': data['secret_doors'],
        'connectors': data['connectors'],
    }
    json.dump(packs[L], open(f'packs/content_{L}.json', 'w'), indent=1)

# Token manifest: unique monsters -> expected filenames in the user's pack
seen = {}
for L, p in packs.items():
    for room in p['rooms']:
        for m in room['monsters']:
            key = m['name']
            seen.setdefault(key, {'name': key, 'total': 0, 'rooms': []})
            seen[key]['total'] += m.get('count', 1)
            seen[key]['rooms'].append(f"{L}:{room['id']}")
manifest = {
    'note': 'Provide one image per monster name. Accepted filename forms (case-insensitive): exact name with spaces, hyphens, or underscores, e.g. "Bandit Captain.png", "bandit-captain.webp", "bandit_captain.jpg".',
    'monsters': sorted(seen.values(), key=lambda x: x['name'])}
json.dump(manifest, open('packs/token_manifest.json', 'w'), indent=1)

for L in packs:
    n_mon = sum(m.get('count', 1) for r in packs[L]['rooms'] for m in r['monsters'])
    print(f"map {L}: {len(packs[L]['rooms'])} rooms, {n_mon} monsters, "
          f"{len(packs[L]['secret_doors'])} secret doors, {len(packs[L]['connectors'])} connectors")
print(f"token manifest: {len(seen)} unique monsters, "
      f"{sum(v['total'] for v in seen.values())} placements")
