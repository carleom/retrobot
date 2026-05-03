# RAM-Based Macros: Reading Game State Instead of Blind Input Sequences

## Why

A blind macro is a fixed sequence of button presses (e.g., "press START, wait, press DOWN, press A"). These break whenever the game state differs from what the macro assumes — the cursor is at a different position, a menu wraps, a submenu layout changes based on context, or the game is in a transitional state.

The fix: **read the actual game state from RAM before acting**. The decompiled game source tells us what each RAM address means. The map file gives us exact addresses. We compute the exact inputs needed for the current state, then execute them step-by-step.

This is the difference between:
- ❌ "Press DOWN once and hope the cursor was at POKéDEX"
- ✅ "Read `sStartMenuCursorPos` from `0x0203760e`. It's at 5 (SAVE). With wrapping, we need 4 DOWN presses to reach POKéMON (position 1)."

## The Pattern

Every RAM-based macro follows the same three-stage process:

### Stage 1: Research (in the decompiled source)

1. **Find the relevant C source** in `/decompiled/pokeemerald/src/` for the game system you're interacting with (start menu, party menu, bag, battle, etc.)
2. **Identify the EWRAM variables** that track the state you need — look for `EWRAM_DATA` declarations
3. **Understand the data structures** — struct layouts, enums, constants. The `.h` files in `include/` define these
4. **Trace the logic** — how does the game react to inputs? What state transitions happen?

### Stage 2: Resolve addresses (from the map file)

The decompiled C source doesn't contain memory addresses — they're assigned at link time. The map file at `/decompiled/pokeemerald/pokeemerald.map` maps every symbol to its address:

```
grep "symbol_name" /decompiled/pokeemerald/pokeemerald.map
```

Example output:
```
0x0203760e                sStartMenuCursorPos
0x020244e9                gPlayerPartyCount
0x020244ec                gPlayerParty
```

For struct fields, the address is the symbol's base address plus the field offset from the struct definition.

### Stage 3: Implement (step-by-step emulation with RAM reads)

```typescript
// 1. Read current state from WRAM
const cursorPos = ctxWram[SYMBOL_ADDRESS - 0x02000000];

// 2. Compute the exact inputs needed
const downPresses = ((targetPos - cursorPos) % menuSize + menuSize) % menuSize;

// 3. Execute step-by-step with emulateParallel
let ctx = initialCtx;
for (let i = 0; i < downPresses; i++) {
  ctx = await emulateParallel(pool, ctx, { input: { DOWN: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 6 });
}
ctx = await emulateParallel(pool, ctx, { input: { A: true }, duration: 4 });
```

**Key principles:**
- Use `ctxWram` (captured from an initial 1-frame emulation of the save state) for all RAM reads — it's a snapshot of the full EWRAM buffer before any inputs are sent
- Use `>>> 0` on all 32-bit reads to avoid JavaScript signed integer issues
- Add generous waits between inputs — menus have animations, fades, and load times
- Verify the final state before saving (e.g., check `gBattleTypeFlags === 0` to confirm we're back in the overworld)

## Real Examples

### Overworld Party Switch

**Research:** `/decompiled/pokeemerald/src/start_menu.c`, `party_menu.c`, `pokemon.c`

**Addresses needed:**

| Symbol | Address | What it tells us |
|---|---|---|
| `sStartMenuCursorPos` | `0x0203760e` | Current cursor position in the start menu (0=POKéDEX, 1=POKéMON, ...) |
| `gPlayerParty` | `0x020244ec` | Base address of player's party (6 Pokémon × 100 bytes each) |
| `gBattleTypeFlags` | `0x02022fec` | Non-zero if in battle (used to route to battle switch vs overworld switch) |
| `gBattleOutcome` | `0x0202433a` | Non-zero if a battle just ended (catches stale `gBattleTypeFlags`) |

**Computed navigation:**
- Start menu: `((1 - cursorPos) % 8 + 8) % 8` DOWN presses to reach POKéMON from any position (menu wraps)
- Party screen: `slot` DOWN presses from slot 0 (cursor always starts at 0 in SINGLE layout)
- Submenu: `1 + fieldMoveCount` DOWN presses to reach SWITCH past any field moves like Teleport, Cut, Surf

### Bag Item Reading

**Research:** `/decompiled/pokeemerald/include/item.h`, `global.h`

**Addresses needed:**

| Symbol | Address | What it tells us |
|---|---|---|
| `gBagItems` | `0x02025f60` | Items pocket (30 slots) |
| `gBagBalls` | `0x02026050` | Poké Balls pocket (16 slots) |
| `encryptionKey` | `0x02024b00` | XOR key for encrypted bag quantities |

**Data structure:** Each slot is 4 bytes — 2 bytes item ID, 2 bytes encrypted quantity (XOR with low 16 bits of encryption key).

## Finding New Addresses

1. **Search the map file:** `grep "VariableName" /decompiled/pokeemerald/pokeemerald.map`
2. **For struct fields:** Find the base symbol address, then add the struct field offset from the `.h` file
3. **For EWRAM_DATA statics:** These are in the EWRAM BSS section. The map file shows the section start for each `.o` file: `ewram_data 0x0203760c 0x17 src/start_menu.o`
4. **Verify at runtime:** Use the existing test infrastructure (`emulateParallel` with `duration: 1`) to read the address and check it contains plausible values

## Adding a New RAM-Based Macro

Checklist for implementing a new macro that reads game state:

1. [ ] Read the relevant C source files from `/decompiled/pokeemerald/src/`
2. [ ] Identify all EWRAM variables you need (look for `EWRAM_DATA` declarations)
3. [ ] Resolve exact addresses from `pokeemerald.map`
4. [ ] Understand any data structures (struct layouts in `include/*.h`)
5. [ ] Handle encryption if present (e.g., party Pokémon data uses `personality ^ otId`)
6. [ ] Use `ctxWram` for reads (pre-navigation snapshot, not intermediate `ovCtx.wram`)
7. [ ] Add `>>> 0` on all 32-bit reads
8. [ ] Add generous waits (menu animations, fades, load times)
9. [ ] Verify the final game state before saving
10. [ ] Test with edge cases (different cursor positions, party configurations, field moves, etc.)
