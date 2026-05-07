/**
 * EmeraldSceneDetector — Pokémon Emerald (USA) scene detection.
 *
 * Uses known EWRAM addresses (resolved from pokeemerald.map) to read
 * battle state machine variables and determine the current game scene.
 *
 * Address reference (absolute GBA bus addresses):
 *   gBattleTypeFlags      0x02022fec  (u32)
 *   gActiveBattler        0x02024064  (u8)
 *   gChosenActionByBattler 0x0202421c (u8[4])
 *   gBattleCommunication  0x02024332  (u8[8])
 */

import {
  Scene,
  SceneDetector,
  readU8,
  readU32,
  BattleCommState,
  ChosenAction,
} from "../scenes";

// ── Emerald Memory Addresses ─────────────────────────────────────────────────

/** Absolute GBA addresses for scene detection symbols in Pokémon Emerald (USA). */
const ADDR = {
  gBattleTypeFlags: 0x02022fec,
  gBattleBufferA: 0x02023064, // u8[MAX_BATTLERS][0x200], [0][0] = command byte
  gActiveBattler: 0x02024064,
  gChosenActionByBattler: 0x0202421c,
  gBattleCommunication: 0x02024332,
} as const;

/** Battle controller command: Yes/No box (switch prompt, learn move, etc.). */
const CONTROLLER_YESNOBOX = 0x05;
/** Battle controller command: Choose a Pokémon (voluntary switch or faint replacement). */
const CONTROLLER_CHOOSEPOKEMON = 0x08;

// ── Detector Implementation ──────────────────────────────────────────────────

export class EmeraldSceneDetector implements SceneDetector {
  /**
   * Detect the current scene from a WRAM snapshot.
   *
   * Logic (from tech_notes.md §2):
   * 1. If gBattleTypeFlags == 0 → overworld (or text box; TEXTBOX detection
   *    requires IWRAM access which is not yet available, so both map to OVERWORLD).
   * 2. If gBattleTypeFlags != 0 → in battle. Read the state machine:
   *    a. If state == STATE_BEFORE_ACTION_CHOSEN → player is on the main
   *       FIGHT / BAG / PKMN / RUN menu.
   *       - If gChosenActionByBattler == B_ACTION_NONE (0xFF), it's a fresh
   *         menu → BATTLE_FIGHT.
   *       - Otherwise the state signals we're returning to the menu after a
   *         sub-action → BATTLE_FIGHT.
   *    b. If state == STATE_WAIT_ACTION_CHOSEN → player is in a sub-menu.
   *       Check gChosenActionByBattler:
   *         B_ACTION_USE_MOVE → BATTLE_MOVE_SELECT
   *         B_ACTION_USE_ITEM → BATTLE_BAG_POCKET
   *         B_ACTION_SWITCH   → BATTLE_PKMN_SWITCH
   *    c. If state >= STATE_WAIT_ACTION_CASE_CHOSEN → turn is executing
   *       (animations playing). Map to BATTLE_FIGHT as the closest
   *       actionable state.
   * 3. Any unexpected state → UNKNOWN.
   */
  detect(wram: Uint8Array): Scene {
    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);

    // Not in battle → overworld (text box detection not yet implemented)
    if (battleTypeFlags === 0) {
      return Scene.OVERWORLD;
    }

    // In battle — read the action selection state machine
    // Always use battler 0 for the player's commState. gActiveBattler can be
    // non-zero during opponent turn / switch-in, but the player's scene is
    // determined by battler 0's state.
    const activeBattler = readU8(wram, ADDR.gActiveBattler);
    const commState = readU8(wram, ADDR.gBattleCommunication); // index 0
    const chosenAction = readU8(wram, ADDR.gChosenActionByBattler); // index 0

    // Check for controller-driven UI states (reliable regardless of commState).
    // These cover both voluntary and forced scenarios (e.g. faint replacement).
    // Buffer commands are written to gBattleBufferA[gActiveBattler].
    const bufferCmd = readU8(wram, ADDR.gBattleBufferA + activeBattler * 0x200);
    // Also check player's buffer (index 0) — the sub-menu controller commands
    // (CHOOSEACTION, CHOOSEMOVE) are always emitted for the player battler.
    const bufferCmdPlayer = readU8(wram, ADDR.gBattleBufferA);
    if (bufferCmd === CONTROLLER_YESNOBOX) {
      console.log("[detect] YESNOBOX via bufferCmd[active=" + activeBattler + "]=0x05");
      return Scene.BATTLE_YESNO;
    }
    if (bufferCmd === CONTROLLER_CHOOSEPOKEMON) {
      console.log("[detect] CHOOSEPOKEMON via bufferCmd[active=" + activeBattler + "]=0x08");
      return Scene.BATTLE_PKMN_SWITCH;
    }

    // Debug: trace detector state
    console.log(
      "[detect] activeBattler=" + activeBattler +
      " comm[0]=" + commState +
      " chosenAction[0]=" + chosenAction +
      " bufCmd[0]=0x" + bufferCmdPlayer.toString(16) +
      " bufCmd[active]=0x" + bufferCmd.toString(16) +
      " comm[1]=" + readU8(wram, ADDR.gBattleCommunication + 1),
    );

    // Check if the old-style yesnobox (Cmd_yesnobox in battle script) has
    // overwritten gBattleCommunication[0] = 1. This looks like
    // STATE_WAIT_ACTION_CHOSEN but the sub-menu determined by chosenAction
    // isn't actually active (buffer doesn't have the expected controller cmd).
    if (commState === BattleCommState.STATE_WAIT_ACTION_CHOSEN
        && chosenAction === ChosenAction.B_ACTION_USE_MOVE
        && activeBattler !== 0
        && bufferCmdPlayer !== 0
        && bufferCmdPlayer !== 0x04 // CONTROLLER_CHOOSEACTION
        && bufferCmdPlayer !== 0x06) { // CONTROLLER_CHOOSEMOVE
      // gBattleCommunication[1] is used as cursor position (0=top, 1=bottom)
      const comm1 = readU8(wram, ADDR.gBattleCommunication + 1);
      if (comm1 === 0 || comm1 === 1) {
        console.log("[detect] old yesnobox → BATTLE_YESNO");
        return Scene.BATTLE_YESNO;
      }
    }

    switch (commState) {
      case BattleCommState.STATE_BEFORE_ACTION_CHOSEN:
        // Player is on the main action menu (FIGHT / BAG / PKMN / RUN).
        return Scene.BATTLE_FIGHT;

      case BattleCommState.STATE_WAIT_ACTION_CHOSEN:
        // Player is in a sub-menu. Which one depends on the high-level action.
        return this._resolveSubMenu(chosenAction);

      case BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN:
        // Sub-action picked (e.g., specific move/item selected). Still in the
        // sub-menu context — resolve by chosen action.
        // In double battles, after a move is picked, the game asks for a target.
        if (
          this.isDoubleBattle(wram) &&
          chosenAction === ChosenAction.B_ACTION_USE_MOVE
        ) {
          return Scene.BATTLE_MOVE_TARGET;
        }
        return this._resolveSubMenu(chosenAction);

      case BattleCommState.STATE_WAIT_ACTION_CONFIRMED_STANDBY:
      case BattleCommState.STATE_WAIT_ACTION_CONFIRMED:
        // Action confirmed and executing — stay in sub-menu context
        // (e.g. bag loading, move animating). Resolve by chosen action.
        return this._resolveSubMenu(chosenAction);

      default:
        return Scene.UNKNOWN;
    }
  }

  /**
   * Map a chosen action to the corresponding sub-menu scene.
   */
  private _resolveSubMenu(chosenAction: number): Scene {
    switch (chosenAction) {
      case ChosenAction.B_ACTION_USE_MOVE:
        return Scene.BATTLE_MOVE_SELECT;
      case ChosenAction.B_ACTION_USE_ITEM:
        return Scene.BATTLE_BAG_POCKET;
      case ChosenAction.B_ACTION_SWITCH:
        return Scene.BATTLE_PKMN_SWITCH;
      case ChosenAction.B_ACTION_RUN:
        // RUN doesn't have a sub-menu — it's a confirmation or instant action.
        // If we're in STATE_WAIT_ACTION_CHOSEN with RUN, something is off.
        // Fall back to BATTLE_FIGHT.
        return Scene.BATTLE_FIGHT;
      case ChosenAction.B_ACTION_NONE:
        // No action chosen yet but state machine says we're in a sub-menu.
        // This shouldn't happen normally; fall back.
        return Scene.BATTLE_FIGHT;
      default:
        return Scene.UNKNOWN;
    }
  }

  /**
   * Check whether the battle menu is actually showing (not animating).
   * Returns true only at the FIGHT/BAG/PKMN/RUN menu or overworld.
   */
  isBattleMenuReady(wram: Uint8Array): boolean {
    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);
    if (battleTypeFlags === 0) return true;
    // Check player battler (0), not active battler (may be enemy during turn)
    const comm = readU8(wram, ADDR.gBattleCommunication);
    // Stale flags: if comm state is invalid but we're on a real map
    if (comm > 4) {
      const mapNum = readU8(wram, 0x02025a05);
      if (mapNum !== 0 && mapNum !== 0xff) return true;
    }
    return comm === BattleCommState.STATE_BEFORE_ACTION_CHOSEN;
  }

  /**
   * Check whether the current battle is a trainer battle.
   * Useful for hiding/disabling the Run button in trainer battles.
   */
  isTrainerBattle(wram: Uint8Array): boolean {
    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);
    return (battleTypeFlags & (1 << 3)) !== 0; // BATTLE_TYPE_TRAINER
  }

  /**
   * Check whether the current battle is a double battle.
   */
  isDoubleBattle(wram: Uint8Array): boolean {
    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);
    return (battleTypeFlags & 1) !== 0; // BATTLE_TYPE_DOUBLE
  }
}

/** Singleton instance for convenience. */
export const emeraldSceneDetector = new EmeraldSceneDetector();
