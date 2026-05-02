# PRD: Context-Aware Smart Controls for Pokémon Emerald

**Status:** Draft
**Target Game:** Pokémon Emerald (GBA)
**Target Core:** mGBA (libretro)

---

## 1. Problem Statement

In the current Retrobot, all games are controlled via raw button presses (A, B, D-pad, etc.). For
Pokémon games, this creates poor UX — navigating battle menus requires many precise button
presses from the chat, making battles slow and error-prone. Players need to understand the game's
menu structure and execute correct sequences of D-pad + A presses just to use a move or item.

## 2. Proposed Solution

Use the **GBA memory map** (exposed by the pokeemerald decompilation project) to read live game
state directly from the emulator's RAM. From that state, detect the current "scene" and display
**context-sensitive buttons** with human-readable labels. Each high-level button maps to a
**macro** — a sequence of raw button presses — that the bot executes automatically.

When a macro runs, intermediate menu navigation steps update the Discord message buttons
**in-place** (no new GIF). Only the final step — when the action resolves — generates and posts a
new GIF. Macros are "fire and forget" with generous timing — since we read RAM to detect the
scene at the end, exact frame counts don't matter.

## 3. Goals

### 3.1 Primary Goals

| Goal | Description |
|---|---|
| **Scene detection via memory map** | Read GBA WRAM to determine exactly which game scene is active (battle, overworld, text box, etc.) with zero ambiguity. Pixel/OCR approaches are explicitly not used. |
| **Battle context overlay** | When in battle, show semantic buttons instead of raw controls: 4 moves (row 1), 4 pokéball types (row 2), 4 potion types (row 3), manual controls + run (row 4) |
| **Dynamic button labels** | Read move IDs, PP counts, item IDs, and quantities from RAM. Resolve human-readable names via hardcoded lookup tables keyed by ID. Labels reflect actual game state. |
| **Multi-step macros** | High-level actions execute as a series of raw button presses. Intermediate steps update buttons in-place without generating new GIFs. One GIF at the end. |
| **Manual controls fallback** | Players can toggle back to raw D-pad + A/B controls for any single action; smart controls resume on the next interaction |
| **Overworld smart controls** | When not in battle, show simplified controls (D-pad directions + A + B + Start) instead of the full gamepad |

### 3.2 Non-Goals

- Support for Gen 1–3 games other than Emerald (architecture should be extensible, but Emerald is the only target for now)
- AI/LLM-based decision making at runtime — all logic is deterministic memory reads
- OCR or pixel-based scene detection (memory map makes these obsolete)
- Touchscreen emulation (Emerald does not use touch)
- Link cable / multiplayer features
- Multi-user preference settings — smart controls toggle is per-game (single server, single game deployment)

## 4. Architecture

### 4.1 System Overview

```
┌──────────────────────────────────────────────────────────────┐
│  src/index.ts (Discord Bot)                                   │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ 1. User clicks button                                     ││
│  │ 2. If raw button: pass through to existing emulate()      ││
│  │ 3. If macro action: macroEngine.execute(macro, state)     ││
│  │    └─ intermediate steps: interaction.update(buttons)     ││
│  │       (no GIF — just swap buttons in place)                ││
│  │ 4. Final step: emulate() → GIF + memory snapshot          ││
│  │ 5. sceneDetector.detect(memory) → scene enum              ││
│  │ 6. layoutGenerator.build(scene, memory) → button rows     ││
│  │ 7. Post GIF + updated buttons                             ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  src/worker.ts (WASM Emulator Worker)                         │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ + retro_get_memory_data(id) → pointer                     ││
│  │ + retro_get_memory_size(id) → size                        ││
│  │ Returns WRAM snapshot (0x02000000–0x0203FFFF) alongside   ││
│  │ frames and state in each worker result                    ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│  cores/mgba_libretro.wasm (mGBA Core via bindings.cxx)       │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ + retro_get_memory_data / retro_get_memory_size bindings  ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

### 4.2 New Modules

| File | Purpose |
|---|---|
| `src/scenes.ts` | Scene detector — reads a memory snapshot and returns a Scene enum |
| `src/scenes/emerald.ts` | Emerald-specific memory addresses and scene detection logic |
| `src/macros.ts` | Macro engine — executes sequences of `{input, duration}` steps |
| `src/macros/emerald.ts` | Emerald-specific macros (move selection, bag navigation, etc.) |
| `src/layouts.ts` | Dynamic button layout generator — builds Discord component rows from scene + memory |
| `config/emerald_memory_map.json` | Memory addresses for Emerald (derived from pokeemerald decomp) |
| `config/emerald_lookups.json` | Lookup tables: move IDs → names, item IDs → names |

### 4.3 Modified Files

| File | Changes |
|---|---|
| `src/bindings.cxx` | Add `retro_get_memory_data` and `retro_get_memory_size` to Emscripten bindings |
| `src/worker.ts` | Expose memory read functions; snapshot and return WRAM with each result |
| `src/workerInterface.ts` | Pass memory data through the Piscina transfer pipeline |
| `src/index.ts` | Wire scene detection into interaction handler; route context-sensitive vs raw buttons |
| `src/emulate.ts` | Support returning memory snapshot alongside frames/state |
| `Makefile` | Rebuild all three WASM cores with updated bindings |

## 5. Memory Map Approach

### 5.1 Why Memory Map?

The [pokeemerald decompilation](https://github.com/pret/pokeemerald) reverse-engineers the entire
game into readable C. Every game variable has a known symbol and a known memory address. We can
read these addresses directly at runtime through `retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM)`.

Advantages over alternatives:
- **Zero ambiguity** — a battle state byte definitively says "in battle"
- **Sub-millisecond** — reading a few bytes from a typed array
- **Deterministic** — same state always produces same scene output
- **No pixel/OCR fragility** — menus can look different frame-to-frame; memory doesn't lie

### 5.2 GBA Memory Regions

| Region | Address Range | Size | Contents |
|---|---|---|---|
| EWRAM | `0x02000000` – `0x0203FFFF` | 256 KB | Main game state (battle structs, party data, bag, map, text) |
| IWRAM | `0x03000000` – `0x03007FFF` | 32 KB | Stack, DMA buffers, some game state |

We primarily read EWRAM. The mGBA core exposes this via `retro_get_memory_data(2)` (where `2` =
`RETRO_MEMORY_SYSTEM_RAM`).

### 5.3 Key Memory Addresses (Emerald, US v1.0)

Note: Exact addresses depend on the ROM build. These are representative from the pokeemerald
decomp. Addresses will be stored in `config/emerald_memory_map.json` for easy adjustment.

| Symbol | Address (approx.) | Type | What It Tells Us |
|---|---|---|---|
| `gBattleTypeFlags` | `0x02022FEC` | `u8` | Non-zero = in battle; bit flags for wild/trainer/double/safari |
| `gBattleMainFunc` | `0x02023D6E` | `void*` | Current battle state function (FIGHT menu, BAG menu, PKMN menu, move select, etc.) — compare against known function pointers |
| `gBattleMoveSelection` | `0x02023D74` | `bool8` | Whether the move selection menu is active |
| `gActiveBattler` | `0x02023D6C` | `u8` | Which battler is currently acting (0–3) |
| `gPlayerParty` | `0x02024284` | `struct Pokemon[6]` | All 6 party Pokémon — species, moves, PP, HP, status, level, stats |
| `gBagPockets` | varies | `struct BagPocket[]` | Items, Pokéballs, TMs, Berries, Key Items — item IDs + quantities |
| `gTextFlags` | varies | various | Whether a text box is active, whether it's awaiting an A press |

### 5.4 Scene Detection Logic

```
                              ┌──────────────┐
                              │  Read WRAM   │
                              └──────┬───────┘
                                     │
                              ┌──────▼───────┐
                              │ gBattleType  │
                              │ != 0 ?       │
                              └──┬───────┬───┘
                                 │YES    │NO
                                 ▼       ▼
                    ┌────────────────┐  ┌────────────────┐
                    │ Battle Scene   │  │ Overworld Scene │
                    │                │  │                │
                    │ Read           │  │ Read:          │
                    │ gBattleMainFunc│  │ gTextFlags     │
                    │                │  │                │
                    │ → BATTLE_FIGHT │  │ text active?   │
                    │ → BATTLE_BAG   │  │ → TEXTBOX      │
                    │ → BATTLE_PKMN  │  │ → OVERWORLD    │
                    │ → BATTLE_RUN   │  │                │
                    │ → MOVE_SELECT  │  │                │
                    │ → BAG_POCKET   │  │                │
                    └────────────────┘  └────────────────┘
```

### 5.5 Scene Enum (Initial)

```typescript
enum Scene {
  // Overworld
  OVERWORLD = 'overworld',
  TEXTBOX = 'textbox',

  // Battle — top level
  BATTLE_FIGHT = 'battle_fight',
  BATTLE_BAG = 'battle_bag',
  BATTLE_PKMN = 'battle_pkmn',
  BATTLE_RUN = 'battle_run',

  // Battle — sub-menus
  BATTLE_MOVE_SELECT = 'battle_move_select',
  BATTLE_BAG_POCKET = 'battle_bag_pocket',
  BATTLE_PKMN_SWITCH = 'battle_pkmn_switch',

  // Fallback
  UNKNOWN = 'unknown',
}
```

### 5.6 When Scene Detection Runs

Scene detection only happens at two points — both from the RAM snapshot, never from pixels:

1. **Before showing buttons** — after a GIF is generated and we're about to present the next
   interaction, we read the RAM snapshot to determine which layout to render.
2. **After a macro completes** — to confirm the new scene and render the appropriate buttons.

This means macros are **fire and forget**. We know the starting state from RAM, we know the
button sequence is deterministic, so we just use generously long durations for animations and
confirm the result at the end via RAM. No mid-macro scene re-detection needed.

## 6. Lookup Tables

Move names and item names are resolved via hardcoded lookup tables stored in
`config/emerald_lookups.json`. The flow:

```
RAM: move ID = 33 (0x21)
  → lookup table: 33 → "Tackle"
  → button label: "Tackle"

RAM: item ID = 13 (0x0D)
  → lookup table: 13 → "Potion"
  → button label: "Potion"

RAM: PP = 12, total PP = 25
  → button label: "Tackle (12/25)"
```

- ~355 moves for Gen 3, ~400 items — the lookup JSON will be ~25KB total
- Generated once from pokeemerald source data, committed to the repo
- No runtime file I/O beyond loading the JSON at startup

## 7. Dynamic Button Layouts

### 7.1 Battle Layout (BATTLE_FIGHT scene, wild encounter)

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF of battle]                                             │
│                                                              │
│  Row 1: [TACKLE (25/25)] [GROWL (40/40)] [LEER (30/30)] [ ] │  ← 4 moves
│  Row 2: [Poké Ball x12]  [Great Ball x5] [Ultra Ball x2] [ ]│  ← 4 ball types
│  Row 3: [Potion x8]   [Super Potion x3] [Hyper Potion x1] [FULL RESTORE x2] ]
│  Row 4: [🔄 Switch]    [🎮 Manual]         [🏃 Run]          │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Battle Layout (BATTLE_FIGHT scene, trainer battle)

The pokéball row is **hidden** because the game blocks ball usage in trainer battles.
Run is also unavailable in trainer battles.

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF of battle]                                             │
│                                                              │
│  Row 1: [TACKLE (25/25)] [GROWL (40/40)] [LEER (30/30)] [ ] │  ← 4 moves
│  Row 2: [Potion x8]   [Super Potion x3] [Hyper Potion x1] [FULL RESTORE x2] ]
│  Row 3: [🔄 Switch]    [🎮 Manual]                           │
└─────────────────────────────────────────────────────────────┘
```

Battle type is determined by reading `gBattleTypeFlags`:
- `BATTLE_TYPE_TRAINER` bit set → trainer battle → **hide ball row, hide Run button, 3 rows total**
- `BATTLE_TYPE_WILD` bit set → wild encounter → show ball row and Run button, 4 rows total

- **Move labels** — read move IDs from `gPlayerParty[activeBattler].moves[i]`, resolve names via
  lookup table, read `pp` / `totalPp` for the counts
- **Disabled moves** — if `pp == 0` or move ID is `MOVE_NONE`, style the button as disabled
- **Ball labels** — read from balls pocket in `gBagPockets`, first 4 entries, with quantities.
  Row is only rendered for wild encounters.
- **Potion labels** — read from items pocket in `gBagPockets`, first 4 healing items.
  In wild encounters this is row 3; in trainer battles it shifts up to row 2.
- **Switch** — opens the battle switch Pokémon sub-layout (see 7.3). Executes a macro to
  navigate the party menu and swap in the selected Pokémon.
- **Manual** — toggles to raw D-pad + A/B for one interaction, then re-detects scene
- **Run** — only shown for wild encounters. Executes a macro to attempt fleeing.

### 7.3 Battle Switch Pokémon Sub-Layout

Opened when the player clicks "🔄 Switch" from the battle layout.
Shows all 6 party slots with Pokémon name and current/max HP.

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF — party screen / waiting]                              │
│                                                              │
│  Row 1: [Charmander 32/45] [Pikachu 78/78] [Pidgey 12/35]   │
│  Row 2: [Rattata 18/18]    [— empty —]     [— empty —]      │
│  Row 3: [⬅️ Back to Battle]                                  │
└─────────────────────────────────────────────────────────────┘
```

- **Pokémon labels** — read species name from `gPlayerParty[i].species` via lookup table,
  read `currentHp` / `maxHp` for the health display
- **Disabled slots** — if `currentHp == 0` (fainted), style as disabled (can't switch to a
  fainted Pokémon); if species is `SPECIES_NONE` (empty slot), show "— empty —" and disable
- **Click behavior** — clicking a valid Pokémon executes the switch macro: navigates the
  in-game party menu to that slot and confirms the switch. One GIF at the end showing the
  battle menu with the new Pokémon active.

### 7.4 Overworld Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF of overworld]                                          │
│                                                              │
│  Row 1: [⬆️ Up]    [⬇️ Down]    [⬅️ Left]    [➡️ Right]      │  ← D-pad
│  Row 2: [🅰️ A]     [🅱️ B]       [▶️ Start]                  │
│  Row 3: [🔄 Reorder Party]                                   │  ← custom actions
│  Row 4: (reserved for future: Fly, etc.)                     │
└─────────────────────────────────────────────────────────────┘
```

- **Row 1** — directional D-pad. Uses existing direction press logic (hold vs release)
  configured via `/settings`.
- **Row 2** — A, B, and Start buttons. Start opens the in-game menu.
- **Row 3** — opens the party reorder sub-layout (see 7.5).
- **Row 4** — reserved for future custom actions (e.g., Fly → city picker, Surf, Cut).
  Rendered as an empty or placeholder row until actions are wired up.

### 7.5 Overworld Party Reorder Sub-Layout

Opened when the player clicks "🔄 Reorder Party" from the overworld layout.
Two-step interaction: pick the first slot, then pick the second slot to swap with.

**Step 1 — pick first Pokémon:**

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF — party overview]                                      │
│                                                              │
│  Row 1: [① Pikachu]     [② Bulbasaur]    [③ Pidgey]         │
│  Row 2: [④ Rattata]     [⑤ — empty —]    [⑥ — empty —]      │
│  Row 3: [⬅️ Cancel]                                          │
└─────────────────────────────────────────────────────────────┘
```

**Step 2 — pick second Pokémon, then confirm:**

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF — same party overview]                                 │
│                                                              │
│  Row 1: [① Pikachu ✓]   [② Bulbasaur]    [③ Pidgey]         │
│  Row 2: [④ Rattata]     [⑤ — empty —]    [⑥ — empty —]      │
│  Row 3: [✅ Swap Pikachu ↔ Rattata]   [⬅️ Cancel]            │
└─────────────────────────────────────────────────────────────┘
```

- **Step 1** — user clicks a Pokémon slot (e.g., "④ Rattata"). That slot is marked as
  selected (highlighted). Buttons update in-place via `interaction.update()`, no GIF.
- **Step 2** — user clicks a second slot (e.g., "① Pikachu ✓"). A confirm button appears:
  "✅ Swap Pikachu ↔ Rattata". If user clicks confirm, the bot executes a macro to navigate
  the in-game party menu and swap the two slots. One GIF at the end showing the updated
  party order. If user clicks Cancel, return to overworld layout.
- **Ordering** — slots are numbered 1–6 matching the in-game party order (slot 1 is the
  lead Pokémon). This number is separate from the button custom ID.
- **Empty slots** — show "— empty —" and are disabled. Can't be selected for swapping.

### 7.6 Text Box Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF of text box]                                           │
│                                                              │
│  Row 1: [🅰️ Advance Text]    [🅱️ Cancel]                     │
└─────────────────────────────────────────────────────────────┘
```

### 7.7 Move Select Layout (BATTLE_MOVE_SELECT)

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF — move selection active]                               │
│                                                              │
│  Row 1: [TACKLE] [GROWL] [LEER] [SCRATCH]                    │
│  Row 2: [⬅️ Back to Fight Menu]                              │
└─────────────────────────────────────────────────────────────┘
```

### 7.8 Bag Pocket Layout (BATTLE_BAG_POCKET)

Shown when the player clicks a pokéball or potion button from the BATTLE_FIGHT screen. The bot
navigates into the bag and shows the items available in that pocket:

```
┌─────────────────────────────────────────────────────────────┐
│  [GIF — bag pocket open]                                     │
│                                                              │
│  Row 1: [Poké Ball x12] [Great Ball x5] [Ultra Ball x2] [ ]  │
│  Row 2: [⬅️ Back]  [🅰️ Use]                                  │
└─────────────────────────────────────────────────────────────┘
```

## 8. Macro System

### 8.1 Macro Definition

A macro is an array of `{input, duration}` pairs where each pair represents one emulation step:

```typescript
interface MacroStep {
  input: InputState;   // Button mask for this step
  duration: number;    // How many frames to hold (1 frame ≈ 1/60s)
  updateButtons?: boolean;  // If true, update message buttons after this step (no GIF)
}

type Macro = MacroStep[];
```

### 8.2 Fire-and-Forget Execution Model

Macros do not re-detect scenes mid-execution. The logic is:

1. Read RAM before starting → confirm expected scene (e.g., BATTLE_FIGHT)
2. Execute each `MacroStep` sequentially — emulating frames with the given input
3. Intermediate `updateButtons` steps swap button labels in-place (no GIF)
4. After final step → generate one GIF, read RAM snapshot, detect scene, render buttons

Durations are intentionally generous (e.g., 180 frames for an attack animation that typically
takes 120). Extra idle frames at the end are harmless — the player just sees the final frame of
the GIF for a moment longer. The RAM-based scene detection at the end confirms everything worked.

### 8.3 Example: TACKLE Macro

```typescript
const tackleMacro: Macro = [
  // The cursor defaults to "FIGHT" in the battle menu.
  // Press A to select FIGHT → opens move selection.
  { input: { A: true },  duration: 4 },
  { input: {},           duration: 20 },       // Wait for menu transition
  {
    input: { A: true },
    duration: 4,                               // Select first move (cursor defaults to slot 1)
    updateButtons: true,                       // Show move list (no GIF)
  },
  { input: {},           duration: 180 },      // Wait for full attack animation + text box
  // Scene re-detection at end → BATTLE_FIGHT (or overworld if battle ended)
];
```

### 8.4 Example: Use Potion Macro

```typescript
const usePotionMacro: Macro = [
  // From BATTLE_FIGHT: D-pad right → BAG, then A to select
  { input: { RIGHT: true }, duration: 4 },
  { input: {},              duration: 8 },
  { input: { A: true },     duration: 4 },
  { input: {},              duration: 20 },    // Wait for bag to open
  {
    input: { A: true },
    duration: 4,                               // Select first item in pocket
    updateButtons: true,                       // Show bag pocket (no GIF)
  },
  { input: { A: true },     duration: 4 },     // Confirm use on active Pokémon
  { input: {},              duration: 20 },    // Wait for use animation
  { input: {},              duration: 60 },    // HP bar animation
  // Scene re-detection at end → BATTLE_FIGHT
];
```

### 8.5 Example: Run Macro

```typescript
const runMacro: Macro = [
  // From BATTLE_FIGHT: D-pad down twice → RUN, then A
  { input: { DOWN: true },  duration: 4 },
  { input: {},              duration: 6 },
  { input: { DOWN: true },  duration: 4 },
  { input: {},              duration: 6 },
  { input: { A: true },     duration: 4 },
  { input: {},              duration: 120 },   // Wait for flee animation + text
  // Scene re-detection at end → OVERWORLD (or BATTLE_FIGHT if flee failed)
];
```

### 8.6 Macro Execution Flow

```
User clicks "Potion"
       │
       ▼
┌─────────────────────────────────────────────┐
│  Read RAM: confirm we're in BATTLE_FIGHT    │
│                                             │
│  For each step in macro:                    │
│    if step.updateButtons:                   │
│      emulate step → no GIF                  │
│      interaction.update({ new buttons })    │  ← intermediate step
│    else:                                    │
│      emulate step → accumulate frames       │
│                                             │
│  After final step:                          │
│    read memory snapshot from worker result  │
│    scene = sceneDetector.detect(memory)     │
│    GIF = encode(accumulatedFrames)          │  ← one GIF at the end
│    buttons = layoutGenerator.build(scene,   │
│                                    memory)  │
│    post message with GIF + buttons          │
└─────────────────────────────────────────────┘
```

## 9. Implementation Plan

### Milestone 1: Expose Memory Reads (bindings + worker)

**Files:** `src/bindings.cxx`, `src/worker.ts`, `Makefile`

- Add `retro_get_memory_data` and `retro_get_memory_size` to `EMSCRIPTEN_BINDINGS` in
  `bindings.cxx`
- Expose wrappers on the core object in `worker.ts`
- Return a WRAM `Uint8Array` snapshotted from the last frame of emulation alongside frames/state
- Rebuild WASM cores with `make all`

**Acceptance:** Worker can return a 256KB WRAM buffer alongside frame data. A test script reads
a known address and prints the value.

**✅ COMPLETED (2025-05-01)**

Implementation summary:
- `bindings.cxx`: Added `simple_retro_get_memory_data` / `simple_retro_get_memory_size` wrappers
  in the `EMSCRIPTEN_BINDINGS` block (L131-132). These delegate to the libretro C API.
- `worker.ts`: Exposed `RETRO_MEMORY_SYSTEM_RAM = 2` constant. After frame execution, calls
  `core.retro_get_memory_data(2)` and `core.retro_get_memory_size(2)`, slices the heap buffer to
  create a WRAM `Uint8Array`, and includes it in the output alongside `av_info`, `frames`, and `state`.
  The WRAM buffer is registered for Piscina zero-copy transfer via `transferableSymbol`.
- `workerInterface.ts`: Passes `wram` through from worker results to callers.
- `emulate.ts`: Propagates `wram` through the emulation pipeline; returned alongside state and
  recording in the final result.
- `Makefile`: Each core target links `bindings.cxx` with the core's `.a` archive. All three cores
  (mgba, quicknes, snes9x2010) rebuilt via `make all`.
- `src/test_memory.ts`: Standalone acceptance test. Loads a GBA ROM into the mGBA core, runs 600
  frames to reach title screen, calls `retro_get_memory_data(2)` / `retro_get_memory_size(2)`,
  validates WRAM size == 262144 bytes (256KB), prints a hex dump of the first 64 bytes, scans
  for printable ASCII strings, and optionally reads user-specified addresses as u8/u16/u32.
  Run via `yarn test:memory <path-to-rom> [addr1_hex] ...`.

Key implementation note: This Emscripten build (MODULARIZE=1) exposes `_malloc` directly on the
Module object rather than under an `asm` sub-object. Code that uses `core.asm.malloc` (e.g.
`util.ts`'s `loadRom`) may need to be updated to `core._malloc`.

### Milestone 2: Scene Detector + Memory Map Config

**Files:** `src/scenes.ts`, `src/scenes/emerald.ts`, `config/emerald_memory_map.json`

- Build the `Scene` enum and `SceneDetector` interface
- Implement `EmeraldSceneDetector` with addresses from the pokeemerald decomp
- Detect: OVERWORLD, TEXTBOX, BATTLE_FIGHT, BATTLE_MOVE_SELECT, BATTLE_BAG_POCKET,
  BATTLE_PKMN_SWITCH, UNKNOWN
- Unit tests with known memory snapshots

**Acceptance:** Given a memory buffer from a known scene, `detect()` returns the correct Scene
enum. All battle sub-states distinguishable.

### Milestone 3: Lookup Tables + Dynamic Layout Generator

**Files:** `config/emerald_lookups.json`, `src/layouts.ts`

- Generate `emerald_lookups.json` with move IDs → names and item IDs → names from pokeemerald data
- Build `DynamicLayoutGenerator` that takes a `Scene` + memory snapshot → Discord component rows
- Read move IDs and PP from party data in memory, resolve via lookup
- Read item IDs and quantities from bag pocket data in memory, resolve via lookup
- Handle edge cases: dead Pokémon, empty bag, 0 PP moves, fewer than 4 moves
- Implement text label buttons (`.setLabel()`) alongside existing emoji buttons

**Acceptance:** For a known memory snapshot of a battle, produces correct button rows with
accurate move names "(25/25)" format, and item quantities.

### Milestone 4: Macro Engine

**Files:** `src/macros.ts`, `src/macros/emerald.ts`

- Build the `MacroExecutor` that runs a `MacroStep[]` through the emulation pipeline
- Implement Emerald-specific macros:
  - Select move (by slot index 1–4)
  - Use item from bag (by pocket + slot index)
  - Switch Pokémon (by party slot 1–6)
  - Attempt to run
- Handle intermediate step button updates (no GIF, just swap components)
- Handle final step GIF generation + scene re-detection

**Acceptance:** Clicking "TACKLE" executes the full move macro and returns a single GIF of the
result with the battle menu buttons refreshed. No intermediate GIFs leak.

### Milestone 5: Wire Into Discord Bot

**Files:** `src/index.ts`

- Add `channel.sendTyping()` only before steps that will produce a GIF
- Route button presses: if button ID corresponds to a macro action, execute macro; else pass
  through as raw input
- Manual controls toggle button — swap back to raw D-pad + A/B for one interaction, then
  re-detect scene on the next interaction
- Scene re-detection on every interaction result — if the scene changes unexpectedly (e.g., wild
  encounter interrupts overworld), handle gracefully
- Fallback: if scene is UNKNOWN, fall back to raw D-pad + A/B controls
- Bag pocket context tracking (deferred from M3): determine which pocket player is in
- Overworld party reorder sub-layout (deferred from M3): multi-step slot swap flow

**Acceptance:** Full playable flow — boot Emerald, walk around with D-pad, encounter a wild
Pokémon, battle overlay appears with moves/items, use Tackle, see the GIF result, battle
continues.

### Milestone 6: Polish + Edge Cases

- PP depletion mid-battle — re-read after each macro and disable move button if PP hits 0
- Pokémon faints — detect via party HP and auto-switch or show appropriate state
- Trainer battles — detect `gBattleTypeFlags` trainer bit and hide/disable Run button
- Macro failure handling — if scene at end doesn't match expected, fall back to raw controls
- Save/load state compatibility — ensure memory map works correctly after save state restore

## 10. Technical Considerations

### 10.1 ROM Build Compatibility

The pokeemerald decomp addresses are specific to the US v1.0 build of Emerald. Other builds
(European, v1.1, ROM hacks) will have different addresses. We'll:

- Store addresses in `config/emerald_memory_map.json` (easy to swap per build)
- Use ROM hash (CRC32) at game load time to auto-select the correct memory map
- Ship only the v1.0 map initially

### 10.2 State Hash Caching

The worker currently caches game/state by hash to avoid re-initialization. Memory reads via
`retro_get_memory_data` return a live pointer into the WASM heap — this data is only valid until
the next call to the same core instance. We'll snapshot WRAM into a detached `Uint8Array` after
each emulation block, before returning from the worker.

### 10.3 Performance

- Memory reads: sub-millisecond (reading 256KB from typed array)
- Scene detection: sub-millisecond (a few integer comparisons)
- Layout generation: low single-digit ms (string lookups from preloaded JSON)
- Macro execution overhead: zero (same emulation pipeline, just called more times)

Total added latency per interaction (excluding GIF encode): well under 10ms.

### 10.4 Piscina Transfer

Memory snapshots will be transferred from workers via `Piscina.move()` just like frames and
states are today. The transfer list already includes frame buffers; we'll add the WRAM snapshot.

### 10.5 Rebuilding WASM Cores

Adding `retro_get_memory_data` and `retro_get_memory_size` to `bindings.cxx` means all three
WASM cores must be rebuilt with `make all`. This requires the `em++` (Emscripten) toolchain.
The rebuild compiles `bindings.cxx` + each `.bc` bitcode file into the corresponding `.js` +
`.wasm` in `cores/`.

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Memory addresses differ from documented pokeemerald decomp | ROM hash detection to select correct map; manual verification of top-10 addresses against a running emerald instance |
| Macro timing differs between emulator instances (frame timing) | Use generous durations; rely on RAM-based scene detection after each macro, not exact frame counts |
| mGBA core does not expose `retro_get_memory_data` for SYSTEM_RAM | mGBA is known to expose all memory types; if not, use `RETRO_ENVIRONMENT_SET_MEMORY_MAPS` as fallback |
| Discord rate limits on rapid button updates (intermediate steps) | Intermediate steps are minimal (1–2 per macro); well within rate limits |
| Save states break across memory map changes | Core API is backwards-compatible — `retro_serialize` / `retro_unserialize` are independent of memory reads |
| Players get confused by changing button layouts | Manual controls toggle always available as a fallback |

## 12. Resolved Questions

1. **Move/item name lookup** — hardcoded JSON lookup tables, generated from pokeemerald source
   data. Simple, fast, ~25KB.

2. **Macro timing precision** — not critical. Macros use generous durations and RAM-based scene
   detection confirms the result at the end. Fire and forget.

3. **Mid-macro scene re-detection** — not needed. Scene detection only runs before showing
   buttons and after macro completion. Macros are deterministic given the starting state.

4. **Smart controls toggle scope** — per-game. Single server, single game deployment for now.

5. **Multi-battles / double battles** — deferred to v2. Battle state detection infrastructure
   supports it; just need different layouts.
