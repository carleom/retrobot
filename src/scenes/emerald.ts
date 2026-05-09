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
 *   gBattlersCount        0x0202406c  (u8)
 *   gBattlerSpriteIds     0x020241e4  (u8[MAX_BATTLERS])
 *   gChosenActionByBattler 0x0202421c (u8[4])
 *   gBattleCommunication  0x02024332  (u8[8])
 *   gSprites              0x02020630  (struct Sprite[MAX_SPRITES + 1])
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
  gSprites: 0x02020630,
  gBattleTypeFlags: 0x02022fec,
  gBattleBufferA: 0x02023064, // u8[MAX_BATTLERS][0x200], stride 0x200 per battler
  gActiveBattler: 0x02024064,
  gBattlersCount: 0x0202406c,
  gBattlerSpriteIds: 0x020241e4,
  gChosenActionByBattler: 0x0202421c,
  gBattleCommunication: 0x02024332,
} as const;

/** Battle controller command: choose FIGHT / BAG / PKMN / RUN. */
const CONTROLLER_CHOOSEACTION = 0x04;
/** Battle controller command: Yes/No box (switch prompt, learn move, etc.). */
const CONTROLLER_YESNOBOX = 0x05;
/** Battle controller command: choose a move. */
const CONTROLLER_CHOOSEMOVE = 0x06;
/** Battle controller command: Choose a Pokémon (voluntary switch or faint replacement). */
const CONTROLLER_CHOOSEPOKEMON = 0x08;

const MAX_BATTLERS_COUNT = 4;
const MAX_SPRITES = 128;
const SPRITE_SIZE = 0x44;
const SPRITE_CALLBACK_OFFSET = 0x1c;
const SPRITECB_SHOW_AS_MOVE_TARGET = 0x08039ad8;

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
      // Switch to battler 2 as soon as battler 0 has chosen (comm >= 2) and
      // battler 2 still needs to choose (comm <= 1). Battler 0's move list is
      // still open, but the game is showing battler 2's FIGHT screen next.
      if (comm0 >= BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN
          && comm2 <= BattleCommState.STATE_WAIT_ACTION_CHOSEN) {
        playerBattler = 2;
      }
    }
    const commState = readU8(wram, ADDR.gBattleCommunication + playerBattler);
    const chosenAction = readU8(wram, ADDR.gChosenActionByBattler + playerBattler);

    // Buffer command at the active battler's index
    const bufferCmd = readU8(wram, ADDR.gBattleBufferA + activeBattler * 0x200);
    const bufferCmdPlayerBattler = readU8(wram, ADDR.gBattleBufferA + playerBattler * 0x200);
    // Buffer command at battler 0 (player's sub-menu commands always here)
    const bufferCmdPlayer = readU8(wram, ADDR.gBattleBufferA);

    // ── Phase 2: Controller-driven UI states ──────────────────────────────
    // These surface via buffer commands and are reliable regardless of commState.

    if (bufferCmdPlayer === CONTROLLER_CHOOSEACTION) {
      return Scene.BATTLE_FIGHT;
    }
    if (bufferCmd === CONTROLLER_YESNOBOX) {
      return Scene.BATTLE_YESNO;
    }
    if (bufferCmd === CONTROLLER_CHOOSEPOKEMON) {
      return Scene.BATTLE_PKMN_SWITCH;
    }

    // In double battles, target selection is represented by the move controller
    // changing a battler sprite callback to SpriteCB_ShowAsMoveTarget. This is
    // EWRAM-visible and disambiguates comm=2 without internal bot state.
    if (this.isDoubleBattle(wram)) {
      if (this.hasMoveTargetCursor(wram)) {
        return Scene.BATTLE_MOVE_TARGET;
      }

      if (bufferCmdPlayerBattler === CONTROLLER_CHOOSEACTION) {
        return Scene.BATTLE_FIGHT;
      }

      if (bufferCmdPlayerBattler === CONTROLLER_CHOOSEMOVE) {
        return Scene.BATTLE_MOVE_SELECT;
      }
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
        // Only fire when both player battlers (0 and 2) have chosen their moves
        // (comm >= CASE_CHOSEN). If battler 2 is still at WAIT_ACTION_CHOSEN,
        // the game is showing battler 2's FIGHT screen, not the target prompt.
        if (this.isDoubleBattle(wram)
            && chosenAction === ChosenAction.B_ACTION_USE_MOVE
            && readU8(wram, ADDR.gBattleCommunication + 2) >= BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN) {
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
        return Scene.BATTLE_FIGHT;
      case ChosenAction.B_ACTION_SWITCH:
        return Scene.BATTLE_FIGHT;
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

  /**
   * Detect whether the double-battle move target cursor is active.
   *
   * gMultiUsePlayerCursor is in IWRAM, but target mode also marks the selected
   * battler's sprite with SpriteCB_ShowAsMoveTarget, and sprite data is EWRAM.
   */
  hasMoveTargetCursor(wram: Uint8Array): boolean {
    const battlersCount = Math.min(
      readU8(wram, ADDR.gBattlersCount) || MAX_BATTLERS_COUNT,
      MAX_BATTLERS_COUNT,
    );

    for (let battler = 0; battler < battlersCount; battler++) {
      const spriteId = readU8(wram, ADDR.gBattlerSpriteIds + battler);
      if (spriteId > MAX_SPRITES) continue;

      const callback = readU32(
        wram,
        ADDR.gSprites + spriteId * SPRITE_SIZE + SPRITE_CALLBACK_OFFSET,
      );

      // Thumb function pointers usually have bit 0 set; accept either form.
      if ((callback & ~1) === SPRITECB_SHOW_AS_MOVE_TARGET) {
        return true;
      }
    }

    return false;
  }
}

/** Singleton instance for convenience. */
export const emeraldSceneDetector = new EmeraldSceneDetector();
