/**
 * Emerald-Specific Macros
 *
 * Pre-built macro sequences for common battle actions in Pokémon Emerald (USA).
 * Every macro that starts from the battle menu first calls resetToFight()
 * to guarantee the cursor is at FIGHT regardless of previous state.
 *
 * Battle menu layout (2x2 grid):
 *   FIGHT    BAG
 *   PKMN     RUN
 *
 * Move menu layout (2x2 grid):
 *   MOVE1    MOVE2
 *   MOVE3    MOVE4
 *
 * Bag: vertical scrolling list, cursor defaults to first item.
 * Party: vertical list, 6 slots, cursor defaults to the active Pokemon.
 */

import { Macro, MacroStep } from "../macros";

// ── Helpers ──────────────────────────────────────────────────────────────────

const A: MacroStep = { input: { A: true }, duration: 4 };
const B: MacroStep = { input: { B: true }, duration: 4 };
const DOWN: MacroStep = { input: { DOWN: true }, duration: 4 };
const UP: MacroStep = { input: { UP: true }, duration: 4 };
const RIGHT: MacroStep = { input: { RIGHT: true }, duration: 4 };
const LEFT: MacroStep = { input: { LEFT: true }, duration: 4 };

function idle(frames: number): MacroStep {
  return { input: {}, duration: frames };
}

/**
 * Reset cursor to FIGHT on the 2x2 battle menu.
 * Presses UP×2 + LEFT×2 to guarantee FIGHT from any cursor position.
 * Only takes ~24 frames total. Safe to call even if already at FIGHT.
 */
function resetToFight(): MacroStep[] {
  return [
    { ...UP },
    { ...idle(4) },
    { ...UP },
    { ...idle(4) },
    { ...LEFT },
    { ...idle(4) },
    { ...LEFT },
    { ...idle(4) },
  ];
}

// ── Select Move Macro ────────────────────────────────────────────────────────

export function selectMoveMacro(slotIndex: number): Macro {
  if (slotIndex < 0 || slotIndex > 3) {
    throw new Error(`Invalid move slot index: ${slotIndex}. Must be 0-3.`);
  }

  const steps: MacroStep[] = [
    ...resetToFight(),
    { ...A }, // Select FIGHT
    { ...idle(40) }, // Wait for move menu
    { ...LEFT },
    { ...idle(4) },
    { ...LEFT },
    { ...idle(4) },
    { ...UP },
    { ...idle(4) },
    { ...UP },
    { ...idle(4) },
  ];

  if (slotIndex === 1 || slotIndex === 3) {
    steps.push({ ...RIGHT }, { ...idle(4) });
  }
  if (slotIndex === 2 || slotIndex === 3) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push({ ...A, updateButtons: true }, { ...idle(30) });
  return steps;
}

// ── Use Item Macro ───────────────────────────────────────────────────────────

export function useItemMacro(slotIndex: number = 0): Macro {
  if (slotIndex < 0) {
    throw new Error(`Invalid item slot index: ${slotIndex}. Must be >= 0.`);
  }

  const steps: MacroStep[] = [
    ...resetToFight(),
    { ...RIGHT },
    { ...idle(6) },
    { ...A },
    { ...idle(20) },
  ];

  for (let i = 0; i < slotIndex; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push(
    { ...A, updateButtons: true },
    { ...idle(4) },
    { ...A },
    { ...idle(20) },
    { ...idle(60) },
  );
  return steps;
}

// ── Switch Pokémon Macro (from FIGHT menu) ───────────────────────────────────

export function switchPokemonMacro(partySlot: number): Macro {
  if (partySlot < 0 || partySlot > 5) {
    throw new Error(`Invalid party slot: ${partySlot}. Must be 0-5.`);
  }

  const steps: MacroStep[] = [
    ...resetToFight(),
    { ...DOWN },
    { ...idle(6) },
    { ...A },
    { ...idle(20) },
  ];

  for (let i = 0; i < partySlot; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push(
    { ...A, updateButtons: true },
    { ...idle(4) },
    { ...A },
    { ...idle(30) },
  );
  return steps;
}

// ── Switch Pokémon Macro (from party screen, already open) ───────────────────

export function switchFromPartyMacro(partySlot: number): Macro {
  if (partySlot < 0 || partySlot > 5) {
    throw new Error(`Invalid party slot: ${partySlot}. Must be 0-5.`);
  }

  const steps: MacroStep[] = [];

  for (let i = 0; i < partySlot; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push(
    { ...A, updateButtons: true },
    { ...idle(4) },
    { ...A },
    { ...idle(30) },
  );
  return steps;
}

// ── Run Macro ────────────────────────────────────────────────────────────────

export function runMacro(): Macro {
  return [
    ...resetToFight(),
    { ...DOWN },
    { ...idle(6) },
    { ...RIGHT },
    { ...idle(6) },
    { ...A },
    { ...idle(30) },
  ];
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function openBagMacro(): Macro {
  return [
    ...resetToFight(),
    { ...RIGHT },
    { ...idle(6) },
    { ...A },
    { ...idle(20) },
  ];
}

export function backMacro(): Macro {
  return [{ ...B }, { ...idle(12) }];
}
