/**
 * Double battle state tracker.
 *
 * In doubles, comm states are ambiguous (comm=2 means three different screens).
 * Instead of deducing from RAM, we track state transitions internally based on
 * what actions the user has taken.
 *
 * States: FIGHT → MOVE → TARGET → (next battler or executing)
 */

import { Scene } from "../scenes";

export type DoublePhase = "fight" | "move" | "target";

export interface DoubleBattleState {
  /** Which player battler is active (0 or 2). Read from RAM on initial detect. */
  battler: 0 | 2;
  /** Current phase based on what action was last completed. */
  phase: DoublePhase;
}

const states = new Map<string, DoubleBattleState>();

/** Initialize or get the double battle state for a game. */
export function getDoubleState(
  gameId: string,
  wram: Uint8Array,
): DoubleBattleState {
  const existing = states.get(gameId);
  if (existing) return existing;

  const comm0 = wram[0x02024332 - 0x02000000];
  const comm2 = wram[0x02024332 + 2 - 0x02000000];

  // Determine initial battler
  let battler: 0 | 2 = 0;
  if (comm0 <= 1) {
    battler = 0;
  } else if (comm0 >= 3) {
    battler = 2;
  }

  // Determine initial phase
  let phase: DoublePhase = "fight";
  const comm = battler === 0 ? comm0 : comm2;
  if (comm >= 2) {
    // If both are at CASE_CHOSEN, it's target phase
    if (comm0 >= 2 && comm2 >= 2) {
      phase = "target";
    } else if (battler === 0 && comm0 >= 2) {
      // Battler 0 already chose fight — move list showing
      phase = "move";
    }
  }

  const state: DoubleBattleState = { battler, phase };
  states.set(gameId, state);
  return state;
}

/** Advance state after a macro completes. */
export function advanceDoubleState(gameId: string): DoubleBattleState | null {
  const state = states.get(gameId);
  if (!state) return null;

  switch (state.phase) {
    case "fight":
      state.phase = "move";
      break;
    case "move":
      state.phase = "target";
      break;
    case "target":
      // Move to next battler or reset
      if (state.battler === 0) {
        state.battler = 2;
        state.phase = "fight";
      } else {
        states.delete(gameId);
        return null;
      }
      break;
  }

  return state;
}

/** Get the scene for the current double battle state. */
export function getDoubleScene(state: DoubleBattleState): Scene {
  switch (state.phase) {
    case "fight":
      return Scene.BATTLE_FIGHT;
    case "move":
      return Scene.BATTLE_MOVE_SELECT;
    case "target":
      return Scene.BATTLE_MOVE_TARGET;
  }
}

/** Reset state (battle ended or no longer in doubles). */
export function clearDoubleState(gameId: string): void {
  states.delete(gameId);
}

/** Check if we're in an active double battle state. */
export function hasDoubleState(gameId: string): boolean {
  return states.has(gameId);
}
