/**
 * Emerald-Specific Macros
 *
 * Pre-built macro sequences for common battle actions in Pokémon Emerald (USA).
 * All macros assume the cursor starts at FIGHT in the BATTLE_FIGHT scene.
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

/** Idle for N frames. */
function idle(frames: number): MacroStep {
  return { input: {}, duration: frames };
}

/** Idle with an intermediate button update (no GIF). */
function idleUpdate(frames: number): MacroStep {
  return { input: {}, duration: frames, updateButtons: true };
}

// ── Select Move Macro ────────────────────────────────────────────────────────

/**
 * Select a move by its slot index (0-3) on the move selection screen.
 *
 * Move grid layout:
 *   [0] [1]
 *   [2] [3]
 *
 * Assumes cursor starts at FIGHT in the battle menu.
 */
export function selectMoveMacro(slotIndex: number): Macro {
  if (slotIndex < 0 || slotIndex > 3) {
    throw new Error(`Invalid move slot index: ${slotIndex}. Must be 0-3.`);
  }

  const steps: MacroStep[] = [
    // Select FIGHT (cursor defaults there)
    { ...A },
    { ...idle(20) }, // Wait for move menu to open
  ];

  // Navigate to the desired move slot
  switch (slotIndex) {
    case 0: /* already on slot 0 */ break;
    case 1: steps.push({ ...RIGHT }, { ...idle(6) }); break;
    case 2: steps.push({ ...DOWN }, { ...idle(6) }); break;
    case 3:
      steps.push({ ...DOWN }, { ...idle(6) });
      steps.push({ ...RIGHT }, { ...idle(6) });
      break;
  }

  steps.push(
    { ...A, updateButtons: true }, // Select the move (update buttons to move select view)
    { ...idle(180) },              // Wait for full attack animation
  );

  return steps;
}

// ── Use Item Macro ───────────────────────────────────────────────────────────

/**
 * Use an item from the bag during battle.
 *
 * Assumes cursor starts at FIGHT. Navigates RIGHT to BAG, opens it,
 * scrolls to the desired item slot, and confirms use.
 *
 * @param slotIndex - Which item slot to use (0 = first item in pocket).
 *                    Only items in the currently open pocket (default: ITEMS).
 */
export function useItemMacro(slotIndex: number = 0): Macro {
  if (slotIndex < 0) {
    throw new Error(`Invalid item slot index: ${slotIndex}. Must be >= 0.`);
  }

  const steps: MacroStep[] = [
    // Navigate to BAG: RIGHT from FIGHT
    { ...RIGHT },
    { ...idle(6) },
    { ...A },          // Select BAG
    { ...idle(20) },   // Wait for bag to open
  ];

  // Navigate down to the desired item slot
  for (let i = 0; i < slotIndex; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push(
    { ...A, updateButtons: true }, // Select item (update buttons to show bag contents)
    { ...idle(4) },
    { ...A },          // Confirm use on active Pokemon
    { ...idle(20) },   // Wait for use animation
    { ...idle(60) },   // HP bar animation / text
  );

  return steps;
}

// ── Switch Pokémon Macro ─────────────────────────────────────────────────────

/**
 * Switch the active Pokemon to a different party member.
 *
 * Navigates from FIGHT → DOWN → PKMN, opens the party screen,
 * scrolls to the desired party slot, and confirms the switch.
 *
 * @param partySlot - Which party slot to switch to (0-5).
 *                    Slot 0 is the lead (currently active) Pokemon.
 *                    Switching to the active Pokemon is a no-op at the game level.
 */
export function switchPokemonMacro(partySlot: number): Macro {
  if (partySlot < 0 || partySlot > 5) {
    throw new Error(`Invalid party slot: ${partySlot}. Must be 0-5.`);
  }

  const steps: MacroStep[] = [
    // Navigate to PKMN: DOWN from FIGHT
    { ...DOWN },
    { ...idle(6) },
    { ...A },          // Select PKMN
    { ...idle(20) },   // Wait for party screen to open
  ];

  // Navigate to the desired party slot (scroll down from position 0)
  for (let i = 0; i < partySlot; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push(
    { ...A, updateButtons: true }, // Select party member (update buttons)
    { ...idle(4) },
    { ...A },          // Confirm switch (the game prompts "Will you switch?")
    { ...idle(120) },  // Wait for switch animation + return to battle
  );

  return steps;
}

// ── Run Macro ────────────────────────────────────────────────────────────────

/**
 * Attempt to flee from a wild battle.
 *
 * Navigates from FIGHT → DOWN (to PKMN) → RIGHT (to RUN) → A.
 * Only works in wild battles; in trainer battles the game blocks fleeing.
 */
export function runMacro(): Macro {
  return [
    // Navigate to RUN: DOWN (to PKMN), then RIGHT (to RUN)
    { ...DOWN },
    { ...idle(6) },
    { ...RIGHT },
    { ...idle(6) },
    { ...A },          // Select RUN
    { ...idle(120) },  // Wait for flee animation + text
  ];
}

// ── Utility: Open Bag (navigate to BAG pocket) ───────────────────────────────

/**
 * Open the bag from the battle menu (navigates to BAG and opens it).
 * Useful as a prefix for custom bag navigation not covered by useItemMacro.
 */
export function openBagMacro(): Macro {
  return [
    { ...RIGHT },
    { ...idle(6) },
    { ...A },
    { ...idle(20) },
  ];
}

// ── Utility: Back out of current menu with B ─────────────────────────────────

/** Press B to go back one menu level. */
export function backMacro(): Macro {
  return [
    { ...B },
    { ...idle(12) },
  ];
}
