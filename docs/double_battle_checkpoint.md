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
- Target layout now uses `gBattlerPositions`/`gAbsentBattlerFlags` and disables fainted or absent opponents.
- Healing items target the currently controlled battler's party entry in doubles.
- Battle switch uses the current party cursor and works from battler 2's party screen context.

## Known Issues / Remaining Work
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
