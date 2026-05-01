/**
 * Scene detection system for context-aware smart controls.
 *
 * Reads a WRAM snapshot (Uint8Array of EWRAM, base address 0x02000000)
 * and determines which game scene is currently active.
 */

// ── Scene Enum ───────────────────────────────────────────────────────────────

export enum Scene {
  /** Overworld — player is walking around, no text box, no battle. */
  OVERWORLD = "OVERWORLD",

  /** A text box is open (dialog, sign, menu prompt, etc.). */
  TEXTBOX = "TEXTBOX",

  /** Battle: main action menu (FIGHT / BAG / PKMN / RUN). */
  BATTLE_FIGHT = "BATTLE_FIGHT",

  /** Battle: move select sub-menu (picking a move). */
  BATTLE_MOVE_SELECT = "BATTLE_MOVE_SELECT",

  /** Battle: bag pocket sub-menu (picking an item). */
  BATTLE_BAG_POCKET = "BATTLE_BAG_POCKET",

  /** Battle: Pokémon switch sub-menu (picking a party member). */
  BATTLE_PKMN_SWITCH = "BATTLE_PKMN_SWITCH",

  /** Could not determine the scene. Fall back to raw controls. */
  UNKNOWN = "UNKNOWN",
}

// ── SceneDetector Interface ──────────────────────────────────────────────────

export interface SceneDetector {
  /**
   * Analyze a WRAM snapshot and return the current Scene.
   *
   * @param wram - EWRAM buffer (Uint8Array starting at GBA address 0x02000000).
   *               Must be at least 256KB (0x40000 bytes).
   * @returns The detected Scene.
   */
  detect(wram: Uint8Array): Scene;
}

// ── WRAM Read Helpers ────────────────────────────────────────────────────────

/** GBA EWRAM base address. Subtract this from absolute addresses to get buffer offsets. */
export const EWRAM_BASE = 0x02000000;

/**
 * Read a u8 value from the WRAM buffer at the given absolute GBA address.
 * @param wram - EWRAM buffer (starts at 0x02000000).
 * @param absoluteAddress - GBA bus address (e.g., 0x02022fec).
 */
export function readU8(wram: Uint8Array, absoluteAddress: number): number {
  const offset = absoluteAddress - EWRAM_BASE;
  if (offset < 0 || offset >= wram.length) {
    throw new Error(
      `Address 0x${absoluteAddress.toString(16).toUpperCase()} is out of WRAM bounds (offset ${offset}, size ${wram.length})`,
    );
  }
  return wram[offset];
}

/**
 * Read a little-endian u16 value from the WRAM buffer at the given absolute GBA address.
 */
export function readU16(wram: Uint8Array, absoluteAddress: number): number {
  const offset = absoluteAddress - EWRAM_BASE;
  if (offset < 0 || offset + 1 >= wram.length) {
    throw new Error(
      `Address 0x${absoluteAddress.toString(16).toUpperCase()} is out of WRAM bounds for u16 read`,
    );
  }
  return wram[offset] | (wram[offset + 1] << 8);
}

/**
 * Read a little-endian u32 value from the WRAM buffer at the given absolute GBA address.
 */
export function readU32(wram: Uint8Array, absoluteAddress: number): number {
  const offset = absoluteAddress - EWRAM_BASE;
  if (offset < 0 || offset + 3 >= wram.length) {
    throw new Error(
      `Address 0x${absoluteAddress.toString(16).toUpperCase()} is out of WRAM bounds for u32 read`,
    );
  }
  return (
    wram[offset] |
    (wram[offset + 1] << 8) |
    (wram[offset + 2] << 16) |
    (wram[offset + 3] << 24)
  );
}

// ── Battle State Constants ───────────────────────────────────────────────────

/** gBattleCommunication state values (per-battler action selection FSM). */
export const BattleCommState = {
  STATE_BEFORE_ACTION_CHOSEN: 0,
  STATE_WAIT_ACTION_CHOSEN: 1,
  STATE_WAIT_ACTION_CASE_CHOSEN: 2,
  STATE_WAIT_ACTION_CONFIRMED_STANDBY: 3,
  STATE_WAIT_ACTION_CONFIRMED: 4,
} as const;

/** gChosenActionByBattler action values. */
export const ChosenAction = {
  B_ACTION_USE_MOVE: 0,
  B_ACTION_USE_ITEM: 1,
  B_ACTION_SWITCH: 2,
  B_ACTION_RUN: 3,
  B_ACTION_NONE: 0xff,
} as const;

/** gBattleTypeFlags bitmasks. */
export const BattleTypeFlag = {
  BATTLE_TYPE_DOUBLE: 1 << 0,
  BATTLE_TYPE_TRAINER: 1 << 3,
  BATTLE_TYPE_SAFARI: 1 << 7,
} as const;
