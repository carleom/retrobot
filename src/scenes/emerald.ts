/**
 * EmeraldSceneDetector — Pokémon Emerald (USA) scene detection.
 *
 * Uses known EWRAM addresses (resolved from pokeemerald.map) to read
 * battle state machine variables and determine the current game scene.
 *
 * Address reference (absolute GBA bus addresses):
 *   gBattleTypeFlags      0x02022fec  (u32)
 *   gBattleBufferA        0x02023064  (u8[MAX_BATTLERS][0x200])
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
  gBattleBufferA: 0x02023064, // u8[MAX_BATTLERS][0x200], stride 0x200 per battler
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
   * Detection phases, in priority order:
   *   Phase 1 — Early exit: not in battle → OVERWORLD
   *   Phase 2 — Controller commands: buffer-based UI (Yes/No, party screen)
   *   Phase 3 — Old yesnobox: Cmd_yesnobox hijacking gBattleCommunication[0]
   *   Phase 4 — CommState switch: main state machine → sub-menu resolution
   *
   * NOTE: Double battles always read battler 0's state.
   * Battler 2 (player's second mon) is not yet handled separately.
   * This is a known gap — fixing it requires per-battler scene tracking.
   */
  detect(wram: Uint8Array): Scene {
    // ── Phase 1: Early exit ───────────────────────────────────────────────

    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);
    if (battleTypeFlags === 0) {
      return Scene.OVERWORLD;
    }

    // ── Read player battler state ─────────────────────────────────────────
    // Single battles: player is battler 0.
    // Double battles: player has battlers 0 and 2. Determine which one is
    // currently selecting an action by checking their comm states.
    const activeBattler = readU8(wram, ADDR.gActiveBattler);
    let playerBattler = 0;
    if ((battleTypeFlags & 1) !== 0) { // BATTLE_TYPE_DOUBLE
      const comm0 = readU8(wram, ADDR.gBattleCommunication);
      const comm2 = readU8(wram, ADDR.gBattleCommunication + 2);
      // Battler 0 is done choosing (CASE_CHOSEN or higher) and battler 2 is
      // still choosing (BEFORE_ACTION_CHOSEN or WAIT_ACTION_CHOSEN) → use 2.
      if (comm0 >= BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN
          && comm2 <= BattleCommState.STATE_WAIT_ACTION_CHOSEN) {
        playerBattler = 2;
      }
    }
    const commState = readU8(wram, ADDR.gBattleCommunication + playerBattler);
    const chosenAction = readU8(wram, ADDR.gChosenActionByBattler + playerBattler);

    // Buffer command at the active battler's index
    const bufferCmd = readU8(wram, ADDR.gBattleBufferA + activeBattler * 0x200);
    // Buffer command at battler 0 (player's sub-menu commands always here)
    const bufferCmdPlayer = readU8(wram, ADDR.gBattleBufferA);

    // ── Double-battle trace logging ────────────────────────────────────────
    const isDouble = (battleTypeFlags & 1) !== 0;
    if (isDouble) {
      console.log(
        "[dbg] double playerBattler=" + playerBattler +
        " active=" + activeBattler +
        " battlersCount=" + readU8(wram, 0x0202406c) +
        " actionFunc=" + readU8(wram, 0x02024083) +
        " comm=[" + readU8(wram, ADDR.gBattleCommunication) +
        "," + readU8(wram, ADDR.gBattleCommunication + 1) +
        "," + readU8(wram, ADDR.gBattleCommunication + 2) +
        "," + readU8(wram, ADDR.gBattleCommunication + 3) + "]" +
        " act=[" + readU8(wram, ADDR.gChosenActionByBattler) +
        "," + readU8(wram, ADDR.gChosenActionByBattler + 1) +
        "," + readU8(wram, ADDR.gChosenActionByBattler + 2) +
        "," + readU8(wram, ADDR.gChosenActionByBattler + 3) + "]" +
        " execFlags=0x" + readU8(wram, 0x02024068).toString(16) +
        " bufCmd[0]=0x" + bufferCmdPlayer.toString(16) +
        " bufCmd[" + activeBattler + "]=0x" + bufferCmd.toString(16),
      );
    }

    // ── Phase 2: Controller-driven UI states ──────────────────────────────
    // These surface via buffer commands and are reliable regardless of commState.

    if (bufferCmd === CONTROLLER_YESNOBOX) {
      if (isDouble) console.log("[dbg] → " + Scene.BATTLE_YESNO + " (bufferCmd)");
      return Scene.BATTLE_YESNO;
    }
    if (bufferCmd === CONTROLLER_CHOOSEPOKEMON) {
      if (isDouble) console.log("[dbg] → " + Scene.BATTLE_PKMN_SWITCH + " (bufferCmd)");
      return Scene.BATTLE_PKMN_SWITCH;
    }

    // ── Phase 3: Old-style yesnobox (Cmd_yesnobox in battle script) ───────
    // The old mechanism overwrites gBattleCommunication[0] = 1, which looks
    // like STATE_WAIT_ACTION_CHOSEN. Distinguish by checking that the
    // player's buffer does NOT have a real sub-menu controller command.
    // Uses hardcoded index 0 — Cmd_yesnobox always writes to [0] and [1].

    if (readU8(wram, ADDR.gBattleCommunication) === BattleCommState.STATE_WAIT_ACTION_CHOSEN
        && readU8(wram, ADDR.gChosenActionByBattler) === ChosenAction.B_ACTION_USE_MOVE
        && activeBattler !== 0
        && bufferCmdPlayer !== 0
        && bufferCmdPlayer !== 0x04 // CONTROLLER_CHOOSEACTION
        && bufferCmdPlayer !== 0x06) { // CONTROLLER_CHOOSEMOVE
      // gBattleCommunication[1] is used as cursor position (0=top, 1=bottom)
      const comm1 = readU8(wram, ADDR.gBattleCommunication + 1);
      if (comm1 === 0 || comm1 === 1) {
        if (isDouble) console.log("[dbg] → " + Scene.BATTLE_YESNO + " (old yesnobox)");
        return Scene.BATTLE_YESNO;
      }
    }

    // ── Phase 4: CommState switch ─────────────────────────────────────────

    let result: Scene;
    switch (commState) {
      case BattleCommState.STATE_BEFORE_ACTION_CHOSEN:
        result = Scene.BATTLE_FIGHT;
        break;

      case BattleCommState.STATE_WAIT_ACTION_CHOSEN:
        result = this._resolveSubMenu(chosenAction);
        break;

      case BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN:
        // In double battles, after a move is picked, the game asks for a target.
        if (this.isDoubleBattle(wram) && chosenAction === ChosenAction.B_ACTION_USE_MOVE) {
          result = Scene.BATTLE_MOVE_TARGET;
        } else {
          result = this._resolveSubMenu(chosenAction);
        }
        break;

      case BattleCommState.STATE_WAIT_ACTION_CONFIRMED_STANDBY:
      case BattleCommState.STATE_WAIT_ACTION_CONFIRMED:
        result = this._resolveSubMenu(chosenAction);
        break;

      default:
        result = Scene.UNKNOWN;
        break;
    }
    if (isDouble) console.log("[dbg] → " + result + " (commState switch)");
    return result;
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
      case ChosenAction.B_ACTION_NONE:
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
    const comm = readU8(wram, ADDR.gBattleCommunication);
    if (comm > 4) {
      const mapNum = readU8(wram, 0x02025a05);
      if (mapNum !== 0 && mapNum !== 0xff) return true;
    }
    return comm === BattleCommState.STATE_BEFORE_ACTION_CHOSEN;
  }

  /**
   * Check whether the current battle is a trainer battle.
   */
  isTrainerBattle(wram: Uint8Array): boolean {
    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);
    return (battleTypeFlags & (1 << 3)) !== 0;
  }

  /**
   * Check whether the current battle is a double battle.
   */
  isDoubleBattle(wram: Uint8Array): boolean {
    const battleTypeFlags = readU32(wram, ADDR.gBattleTypeFlags);
    return (battleTypeFlags & 1) !== 0;
  }
}

/** Singleton instance for convenience. */
export const emeraldSceneDetector = new EmeraldSceneDetector();
