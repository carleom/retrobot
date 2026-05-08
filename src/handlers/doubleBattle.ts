/**
 * Double battle state tracker — internal phase tracking per player battler.
 *
 * In doubles, comm states are ambiguous (comm=2 means move select, target select,
 * or waiting for partner). Instead of deducing from RAM, we track the phase
 * internally based on what actions the user has taken.
 *
 * State machine:
 *   FIGHT_0 → user clicks move → MOVE_0 → user clicks move → TARGET_0
 *   TARGET_0 → user clicks target → FIGHT_2 → user clicks move → MOVE_2
 *   MOVE_2 → user clicks move → TARGET_2 → user clicks target → RESET (re-read RAM)
 *
 * Backward (B press):
 *   MOVE_X → FIGHT_X,  TARGET_X → MOVE_X,  FIGHT_2 → TARGET_0
 *
 * The state is re-initialized from RAM whenever there's no active state.
 */

import { Scene } from "../scenes";

// ── Types ────────────────────────────────────────────────────────────────────

export type DoublePhase = "fight" | "move" | "target";

export interface DoubleBattleState {
  battler: 0 | 2;
  phase: DoublePhase;
}

// ── State storage ────────────────────────────────────────────────────────────

const states = new Map<string, DoubleBattleState>();

// ── RAM helpers ──────────────────────────────────────────────────────────────

function readComm(wram: Uint8Array, battler: number): number {
  return wram[0x02024332 + battler - 0x02000000];
}

function isDoubleBattle(wram: Uint8Array): boolean {
  return (wram[0x02022fec - 0x02000000] & 1) !== 0;
}

// ── Core API ─────────────────────────────────────────────────────────────────

/** Initialize or return the current double battle state for a game.
 *  Re-initializes from RAM if no state exists or if the current state
 *  seems stale (e.g. moves have executed). */
export function getDoubleState(
  gameId: string,
  wram: Uint8Array,
): DoubleBattleState | null {
  if (!isDoubleBattle(wram)) {
    clearDoubleState(gameId);
    return null;
  }

  const existing = states.get(gameId);
  if (existing) return existing;

  // Initialize from RAM
  const comm0 = readComm(wram, 0);
  const comm2 = readComm(wram, 2);
  const act0 = wram[0x0202421c - 0x02000000];
  const act2 = wram[0x0202421c + 2 - 0x02000000];

  // Determine active battler
  let battler: 0 | 2 = 0;
  if (comm0 <= 1) {
    battler = 0;
  } else if (comm0 >= 3) {
    battler = 2;
  }
  // else comm0 == 2: battler 0 is at CASE_CHOSEN, target selection

  // Determine phase
  let phase: DoublePhase = "fight";
  const comm = battler === 0 ? comm0 : comm2;
  const act = battler === 0 ? act0 : act2;

  // Both at CASE_CHOSEN → target selection for current battler
  if (comm0 >= 2 && comm2 >= 2) {
    phase = "target";
  } else if (comm >= 2 && act === 0) {
    // Current battler chose FIGHT (act=0=USE_MOVE), move list showing
    phase = "move";
  }

  const state: DoubleBattleState = { battler, phase };
  states.set(gameId, state);
  return state;
}

// ── State transitions ────────────────────────────────────────────────────────

/** Advance one step forward. Called after a macro completes successfully. */
export function advanceDoubleState(gameId: string): void {
  const state = states.get(gameId);
  if (!state) return;

  switch (state.phase) {
    case "fight":
      state.phase = "move";
      break;
    case "move":
      state.phase = "target";
      break;
    case "target":
      if (state.battler === 0) {
        state.battler = 2;
        state.phase = "fight";
      } else {
        // Both battlers done — clear state, will re-init from RAM next time
        states.delete(gameId);
      }
      break;
  }
}

/** Go back one step (B button pressed from Discord). */
export function reverseDoubleState(gameId: string): void {
  const state = states.get(gameId);
  if (!state) return;

  switch (state.phase) {
    case "target":
      state.phase = "move";
      break;
    case "move":
      state.phase = "fight";
      break;
    case "fight":
      if (state.battler === 2) {
        state.battler = 0;
        state.phase = "target";
      }
      // battler 0 at fight with nothing to go back to — keep state
      break;
  }
}

// ── Scene mapping ────────────────────────────────────────────────────────────

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

// ── Cleanup ──────────────────────────────────────────────────────────────────

export function clearDoubleState(gameId: string): void {
  states.delete(gameId);
}

export function hasDoubleState(gameId: string): boolean {
  return states.has(gameId);
}
