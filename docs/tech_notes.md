# Technical Notes: Pokémon Emerald Memory Map & Bot Integration

Investigation date: 2025-04-30
Sources: [pret/pokeemerald](https://github.com/pret/pokeemerald) decompilation (cloned at `decompiled/pokeemerald/`)

---

## 1. Memory Layout

GBA memory regions (from `ld_script.ld`):

| Region | Address | Size | Access via libretro |
|---|---|---|---|
| EWRAM | `0x02000000` – `0x0203FFFF` | 256KB | `retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)` → `id=2` |
| IWRAM | `0x03000000` – `0x03007FFF` | 32KB | May need `RETRO_ENVIRONMENT_SET_MEMORY_MAPS` or custom id |
| ROM | `0x08000000` – `0x09FFFFFF` | 32MB | N/A (not needed) |

**Key finding:** Most battle state is in EWRAM_DATA (accessible). `gBattleMainFunc` and `gTextFlags` are COMMON_DATA (IWRAM), which may require a different memory access path. But we have workarounds.

---

## 2. Scene Detection (EWRAM symbols)

All of these are `EWRAM_DATA` and accessible via `retro_get_memory_data(2)`:

| Symbol | Type | Defined | What it tells us |
|---|---|---|---|
| `gBattleTypeFlags` | `u32` | `src/battle_main.c:146` | Non-zero = in battle. `BATTLE_TYPE_TRAINER (1<<3)` = trainer; if that bit absent = wild. Also `BATTLE_TYPE_DOUBLE (1<<0)`, `BATTLE_TYPE_SAFARI (1<<7)`, etc. |
| `gActiveBattler` | `u8` | `src/battle_main.c:155` | Which battler (0–3) is currently acting. Use as index into arrays below. |
| `gBattleCommunication[8]` | `u8[]` | `src/battle_main.c:209` | Per-battler action selection state machine state |
| `gChosenActionByBattler[4]` | `u8[]` | `src/battle_main.c:186` | What action each battler chose |

**Battle detection (is a battle active?):**
```
gBattleTypeFlags != 0  →  in battle
```

**Battle type (wild vs trainer):**
```
gBattleTypeFlags & (1 << 3)  →  trainer battle
otherwise                     →  wild encounter (or safari, etc.)
gBattleTypeFlags & (1 << 0)  →  double battle
```

**Which menu is the player on?** — via `gBattleCommunication[gActiveBattler]`:

| Value | Constant | Meaning |
|---|---|---|
| 0 | `STATE_BEFORE_ACTION_CHOSEN` | Player needs to choose: FIGHT / BAG / PKMN / RUN. **This is the FIGHT menu.** |
| 1 | `STATE_WAIT_ACTION_CHOSEN` | Action chose, processing sub-action (e.g., picking a move) |
| 2 | `STATE_WAIT_ACTION_CASE_CHOSEN` | Sub-action picked (e.g., specific move selected) |
| 3 | `STATE_WAIT_ACTION_CONFIRMED_STANDBY` | Action confirmed, waiting |
| 4 | `STATE_WAIT_ACTION_CONFIRMED` | All battlers confirmed, waiting for turn to execute |

**Which high-level action was chosen?** — via `gChosenActionByBattler[gActiveBattler]`:

| Value | Constant | Meaning |
|---|---|---|
| 0 | `B_ACTION_USE_MOVE` | FIGHT was selected |
| 1 | `B_ACTION_USE_ITEM` | BAG was selected |
| 2 | `B_ACTION_SWITCH` | PKMN was selected |
| 3 | `B_ACTION_RUN` | RUN was selected |
| 0xFF | `B_ACTION_NONE` | No action chosen yet |

**Putting it together — scene detection logic:**
```typescript
if (gBattleTypeFlags == 0) {
  // Overworld. Check for text box (need IWRAM access or alternative).
  // Fallback: if gBattleTypeFlags == 0 → assume OVERWORLD.
  // Text box detection TBD.
} else {
  // In battle
  const state = gBattleCommunication[gActiveBattler];
  
  if (state == STATE_BEFORE_ACTION_CHOSEN || state == STATE_WAIT_ACTION_CONFIRMED) {
    // Player is on the main action menu
    // Distinguish what was previously chosen:
    const action = gChosenActionByBattler[gActiveBattler];
    // B_ACTION_USE_MOVE → was on FIGHT
    // B_ACTION_USE_ITEM → was on BAG
    // B_ACTION_SWITCH → was on PKMN
    // B_ACTION_RUN → was on RUN
    // B_ACTION_NONE (0xFF) → fresh menu, no action yet → BATTLE_FIGHT
    
    scene = BATTLE_FIGHT;  // Main menu screen
  } else if (state == STATE_WAIT_ACTION_CHOSEN) {
    // Sub-action being chosen. Check what high-level action:
    const action = gChosenActionByBattler[gActiveBattler];
    if (action == B_ACTION_USE_MOVE) scene = BATTLE_MOVE_SELECT;
    else if (action == B_ACTION_USE_ITEM) scene = BATTLE_BAG_POCKET;
    else if (action == B_ACTION_SWITCH) scene = BATTLE_PKMN_SWITCH;
  }
}
```

## 3. Party Data (Pokémon struct)

`gPlayerParty[6]` is `EWRAM_DATA` at `src/pokemon.c:78`.

**Pokémon struct layout** (`include/pokemon.h:219`):
```
Offset  Size  Field
------  ----  -----
0x00    0x50  box (BoxPokemon substructs)
  0x00    u16   species
  0x02    u16   heldItem
  0x04    u32   experience
  0x08    u8    ppBonuses
  0x09    u8    friendship
  0x0C    4×u16 moves[4]       // move IDs
  0x14    4×u8  pp[4]          // current PP for each move
  0x18    12B   EVs
  0x24    0x2C  personality/IVs/ribbons
0x50    u32   status            // status conditions (PSN, SLP, etc.)
0x54    u8    level
0x55    u8    mail
0x56    u16   hp                // current HP
0x58    u16   maxHP
0x5A    u16   attack
0x5C    u16   defense
0x5E    u16   speed
0x60    u16   spAttack
0x62    u16   spDefense
```
**Total size:** 0x64 (100 bytes) per Pokémon.

To read party member `i` (0–5):
```
base = gPlayerParty + (i * 0x64)
species   = read_u16(base + 0x00)
moves[0]  = read_u16(base + 0x0C)
moves[1]  = read_u16(base + 0x0E)
moves[2]  = read_u16(base + 0x10)
moves[3]  = read_u16(base + 0x12)
pp[0]     = read_u8(base + 0x14)
pp[1]     = read_u8(base + 0x15)
pp[2]     = read_u8(base + 0x16)
pp[3]     = read_u8(base + 0x17)
level     = read_u8(base + 0x54)
currentHp = read_u16(base + 0x56)
maxHp     = read_u16(base + 0x58)
```

Empty slot: species == 0 (SPECIES_NONE). Fainted: currentHp == 0. Move slot empty: move ID == 0 (MOVE_NONE).

## 4. Bag Data

`BagPocket` struct (`include/item.h:28`):
```c
struct BagPocket {
    struct ItemSlot *itemSlots;  // pointer to array
    u8 capacity;
};
```

`ItemSlot` (`include/global.h:590`):
```c
struct ItemSlot {
    u16 itemId;
    u16 quantity;
};
```

Pocket types (`include/constants/item.h`):
| ID | Pocket | Contains |
|---|---|---|
| 1 | POCKET_ITEMS | Potions, status heals, etc. |
| 2 | POCKET_POKE_BALLS | Poké Balls |
| 3 | POCKET_TM_HM | TMs and HMs |
| 4 | POCKET_BERRIES | Berries |
| 5 | POCKET_KEY_ITEMS | Key items |

**Reading bag items:** `gBagPockets` is an extern variable. The itemSlots pointer inside each pocket points to an array of `ItemSlot` (itemId + quantity pairs). The actual items are stored in the SaveBlock struct (see `global.h:1006-1010`).

## 5. Text Box Detection

`gTextFlags` is `COMMON_DATA` (IWRAM, `src/text.c:49`). We may not have direct access.

**Alternative approaches for text detection:**
1. **Frame diffing**: If the last ~4 frames are identical, a text box is likely waiting for input
2. **IWRAM access**: mGBA may expose IWRAM via a custom memory ID or `SET_MEMORY_MAPS`
3. **Walk the pointer**: `gTextFlags` is in IWRAM which starts at `0x03000000`. mGBA exposes WRAM but we'd need to check if IWRAM is accessible

**Pragmatic approach:** Most overworld text boxes need an A press to advance. We can just always show the text box layout (A to advance, B to cancel) alongside D-pad controls in the overworld, and let the user decide. Or we distinguish based on whether gBattleTypeFlags == 0 (overworld) and handle text boxes as a future refinement.

## 6. Symbol Memory Addresses

The exact EWRAM addresses are NOT encoded in the source files — they're resolved at link time
and stored in the generated `pokeemerald.map` file (not present in the repo without a build).

**How to get exact addresses:**
1. Build pokeemerald: `make` in `decompiled/pokeemerald/` → generates `pokeemerald.map`
2. Runtime introspection: read EWRAM, search for known patterns (species names, move names, etc.) to build an address map dynamically
3. Use documented addresses from the pokeemerald community

For Milestone 1, we built the decomp to get exact addresses:
1. Cloned `pret/pokeemerald` into `decompiled/pokeemerald/`
2. Installed devkitPro ARM toolchain (`gba-dev` group via `dkp-pacman`)
3. Built agbcc (`tools/agbcc/build.sh && ./install.sh ../..`)
4. Ran `make` → generated `pokeemerald.map` with all symbol addresses

### Resolved Scene Detection Addresses (Pokémon Emerald USA)

All symbols are in EWRAM, accessible via `retro_get_memory_data(2)`:

| Symbol | Address | Type | Used For |
|---|---|---|---|
| `gBattleTypeFlags` | `0x02022fec` | `u32` | Non-zero = in battle |
| `gActiveBattler` | `0x02024064` | `u8` | Which battler (0-3) is acting |
| `gChosenActionByBattler` | `0x0202421c` | `u8[4]` | Action each battler chose |
| `gBattleCommunication` | `0x02024332` | `u8[8]` | Per-battler action state machine |

Addresses confirmed via `yarn test:memory` reading live WRAM from a running Emerald ROM.

## 7. Retrobot Worker Pipeline Integration

**Final worker output** (`src/worker.ts:267-295`):
```typescript
const wramPtr = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
const wramSize = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
const wram = wramSize > 0
    ? new Uint8Array(core.HEAPU8.buffer.slice(wramPtr, wramPtr + wramSize))
    : new Uint8Array(0);

const output = {
    av_info,
    frames,
    state: newState,
    wram,
    gameHash: incomingGameHash,
    stateHash: newStateHash,
    get [Piscina.transferableSymbol]() {
        return [
            newState.buffer,
            wram.buffer,
            ...frames.map(frame => frame.buffer.buffer)
        ];
    },
    get [Piscina.valueSymbol]() {
        return {
            av_info, frames, state: newState, wram,
            gameHash: incomingGameHash, stateHash: newStateHash
        };
    }
};
```

Then add `wram.buffer` to the transfer list and `wram` to the value object.

**WorkerInterface** (`src/workerInterface.ts`): Already passes everything through. `wram` would just be another field on the return object, accessible from `emulate.ts`.

## 8. Button Interaction Routing

**Current custom ID format** (`src/index.ts:230`):
```
id-button-multiplier
```

Examples:
- `abc12-a-5` → game `abc12`, button `a`, multiplier `5`
- `abc12-up-1` → game `abc12`, button `up`, multiplier `1`
- `settings-abc12-multiplier-3` → settings flow

**Button types detected by `isNumeric()`:**
- Numeric `button` field → multiplier change (no emulation)
- Non-numeric `button` field → actual game input → `parseInput(button)` → `emulate()`

**Proposed macro button ID format:**
```
id-macro-action-param
```

Examples:
- `abc12-macro-move-1` → execute move in slot 1
- `abc12-macro-item-3` → use item in slot 3
- `abc12-macro-switch` → open switch sub-layout
- `abc12-macro-run` → execute run macro
- `abc12-macro-manual` → toggle to raw controls

The `interaction.isButton()` handler already parses `[id, button, multiplier]` from the custom ID. We'd check `button === 'macro'` to route to the macro engine instead of `parseInput()`.

**In-place button updates:** The settings flow already uses `interaction.update()` to swap components on the same message without a GIF. We follow the same pattern for intermediate macro steps.

## 9. WASM Core Rebuild Notes

**Makefile targets** (`Makefile`):
```
make all  →  mgba_libretro.js, quicknes_libretro.js, snes9x2010_libretro.js
```

Each target compiles `src/bindings.cxx` + the core's `.bc` bitcode with `em++` into `cores/`.

**Changes needed in bindings.cxx:**
Add to `EMSCRIPTEN_BINDINGS`:
```cpp
emscripten::function("retro_get_memory_data", &retro_get_memory_data);
emscripten::function("retro_get_memory_size", &retro_get_memory_size);
```

These are already declared in `libretro.h` and implemented by the mGBA core — we just need to expose them through the bindings.

## 10. Open Items

1. **Exact EWRAM addresses** — build the decomp or use runtime address resolution to get precise offsets for `gBattleTypeFlags`, `gPlayerParty`, etc.
2. **IWRAM access** — verify if mGBA exposes IWRAM via RETRO_MEMORY_SYSTEM_RAM (id=2) or if we need `SET_MEMORY_MAPS` for `gTextFlags` / `gBattleMainFunc` access
3. **Move/Item name lookup tables** — need to generate `emerald_lookups.json` from the decomp's data files:
   - Move names: `data/text/move_names.h` or `src/data/move_names.h`
   - Item names: similar pattern
   - Species names: `data/text/species_names.h` or equivalent
4. **Bag pocket pointer traversal** — the `itemSlots` pointer in `BagPocket` points to dynamically allocated memory. Need to verify how to follow this from EWRAM at runtime
