# Double Battle Checkpoint

Known-working double-battle baseline.

**Commit:** `deea0bf` — "Double battle: choose target from default cursor"

## What Works
- Battle move layout shows correctly for both battler 0 and battler 2 (reads `gBattleMons`).
- Moves select correctly (cursor lands on the right move).
- Target buttons appear after move selection for both battler 0 and battler 2.
- Default target cursor logic: battler 1 (opponent-left) = press A, other = LEFT then A.
- Layout fallback: `UNKNOWN` scene with active battle flags shows move buttons instead of overworld.
- Bot restart restores smart layout from WRAM instead of raw controller buttons.
- Discord interaction flow doesn't double-defer (`InteractionAlreadyReplied` fixed).

## Known Issues / Remaining Work
- **Target buttons:** always show both enemy mons, even when one is fainted or absent.
- **Target by position:** current layout hardcodes enemy order `[3, 1]` and default target as battler `1`. Should read `gBattlerPositions` to map positions to battlers, and check `gAbsentBattlerFlags`/HP to disable fainted targets.
- **Item/potion targeting for battler 2:** `src/handlers/battleItem.ts` always selects party slot 0 after using a healing item. In doubles with battler 2 active, should navigate to `gBattlerPartyIndexes[2]`'s display position via `gBattlePartyCurrentOrder`.
- **Switch handler for battler 2:** battle switch path (`index.ts` ~line 907) uses `navigateToPartyMacro` and assumes battler 0 context. Needs to account for battler 2's action menu and party order.
- **Single-target detection still brittle in transitional states:** `buf[0]=18` PRINTSTRING / `actionFunc=11` states cause `UNKNOWN` scene. Scene detection could be improved by reading `gBattleBufferA` controller commands and `gBattlerControllerFuncs` if/when IWRAM becomes accessible.
- **Back (B) handling:** canceling target selection, returning from move list, etc. may not be battler-aware in doubles.
- **Internal `doubleBattle.ts` state tracker:** may be partially superseded by RAM-based fixes. Consider removing or consolidating.

## Reference Addresses
| Symbol | Address | Notes |
|---|---|---|
| `gBattleTypeFlags` | `0x02022fec` | Non-zero = in battle |
| `gBattleBufferA` | `0x02023064` | Controller commands (stride 0x200 per battler) |
| `gBattlerPositions` | `0x02024076` | Position enum per battler (0=player-left, 1=opp-left, 2=player-right, 3=opp-right) |
| `gBattlerSpriteIds` | `0x020241e4` | Sprite ID per battler |
| `gSprites` | `0x02020630` | Sprite array (0x44 bytes each, callback at offset 0x1c) |
| `gBattleMons` | `0x02024084` | BattlePokemon structs (0x58 bytes each) |
| `gAbsentBattlerFlags` | `0x02024210` | Bitmask of absent/fainted battlers |
| `gChosenActionByBattler` | `0x0202421c` | Action each battler chose |
| `gBattlerPartyIndexes` | `0x0202406e` | Party slot per battler |
| `gBattleCommunication` | `0x02024332` | Per-battler action state machine |
| `gBattleOutcome` | `0x0202433a` | Non-zero when battle ended |
| `gBattlePartyCurrentOrder` | `0x0203cf00` | 3 bytes, nibble-packed party display order |
| `gPlayerParty` | `0x020244ec` | Party Pokémon data (0x64 bytes each) |
| `SpriteCB_ShowAsMoveTarget` | `0x08039ad8` | Sprite callback for target cursor (Thumb, bit 0 may be set) |
