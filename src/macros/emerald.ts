/**
 * Emerald-Specific Macros
 *
 * ⚠️  CRITICAL: NEVER use blind frame-count timing (idle(N)) to wait for menus.
 *     It does not work reliably. Always use step-by-step polling via
 *     emulateParallel + scene detection instead.
 *
 *     Correct pattern (see item handler in index.ts):
 *       1. Press the button
 *       2. Run emulateParallel with {input:{}, duration:2} in a loop
 *       3. Call detector.detect(wram) each iteration
 *       4. Break when the expected scene is detected
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
const START: MacroStep = { input: { START: true }, duration: 4 };
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

// ── Select Target Macro (double battles) ─────────────────────────────────────

/** Confirm the current target selection (press A). */
export function confirmTargetMacro(): Macro {
  return [{ ...A, updateButtons: true }, { ...idle(30) }];
}

/** Navigate to previous target (LEFT or UP in target select). */
export function prevTargetMacro(): Macro {
  return [{ ...LEFT }, { ...idle(6) }];
}

/** Navigate to next target (RIGHT or DOWN in target select). */
export function nextTargetMacro(): Macro {
  return [{ ...RIGHT }, { ...idle(6) }];
}

/** Cancel target selection and return to move select (B). */
export function cancelTargetMacro(): Macro {
  return [{ ...B }, { ...idle(12) }];
}

// ── Use Item Macro ───────────────────────────────────────────────────────────

export function useItemMacro(slotIndex: number = 0): Macro {
  if (slotIndex < 0) {
    throw new Error(`Invalid item slot index: ${slotIndex}. Must be >= 0.`);
  }

  const steps: MacroStep[] = [
    ...resetToFight(),
    { ...RIGHT },
    { ...idle(12) },
    { input: { A: true }, duration: 6 },
    { ...idle(180) }, // Wait for bag to animate open
  ];

  for (let i = 0; i < slotIndex; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  steps.push(
    { ...A, updateButtons: true },
    { ...idle(4) },
    { ...A },
    { ...idle(60) },
    { ...idle(60) },
  );
  return steps;
}

// ── Switch Pokémon Macro (from FIGHT menu) ───────────────────────────────────

/** Navigate to party screen (FIGHT→PKMN) and stop. Caller should poll for ready. */
export function navigateToPartyMacro(): Macro {
  return [
    ...resetToFight(),
    { ...DOWN },
    { ...idle(6) },
    { ...A },
    // No fixed wait — caller will poll for gPartyMenu.menuType == 1
  ];
}

/** Select and confirm a party slot (assumes party screen is already open). */
export function selectPartySlotMacro(partySlot: number): Macro {
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
    { ...idle(12) },
    { input: { A: true }, duration: 6 },
    { ...idle(180) },
  ];
}

export function backMacro(): Macro {
  return [{ ...B }, { ...idle(12) }];
}

// ── Overworld Switch Macro ──────────────────────────────────────────────────

/**
 * Swap the Pokémon at partySlot with slot 0 from the overworld.
 *
 * Reliable approach (backed by pokeemerald decomp):
 * - The start menu cursor persists across opens (sStartMenuCursorPos),
 *   but UP from the top position does NOT wrap (Menu_MoveCursor clamps).
 *   So we press UP 7x to guarantee we're at POKéDEX, then DOWN 1x to POKéMON.
 * - The party screen cursor always defaults to slot 0 when opened from the
 *   overworld start menu (InitPartyMenu with keepCursorPos=FALSE).
 */
export function overworldSwitchMacro(partySlot: number): Macro {
  if (partySlot < 0 || partySlot > 5) {
    throw new Error("Invalid party slot: " + partySlot + ". Must be 0-5.");
  }
  if (partySlot === 0) return [];

  const steps: MacroStep[] = [
    // Open start menu
    { ...START },
    { ...idle(20) },
  ];

  // Reset cursor to top (UP 7x — 7 is enough for any position in an 8-item menu
  // since the cursor clamps at the top and does not wrap).
  for (let i = 0; i < 7; i++) {
    steps.push({ ...UP }, { ...idle(2) });
  }

  // Navigate to POKéMON (1 DOWN from POKéDEX) and open party screen
  steps.push({ ...DOWN }, { ...idle(6) }, { ...A }, { ...idle(90) });

  // Navigate down to the target party slot (cursor starts at slot 0)
  for (let i = 0; i < partySlot; i++) {
    steps.push({ ...DOWN }, { ...idle(4) });
  }

  // Select the Pokémon → opens submenu (Summary / Switch / Item / Cancel)
  steps.push(
    { ...A },
    { ...idle(40) },
    // Move cursor down to "Switch" (second option below "Summary")
    { ...DOWN },
    { ...idle(6) },
    { ...A },
    { ...idle(40) },
  );

  // Move the cursor back up to slot 0 for the swap destination
  for (let i = 0; i < partySlot; i++) {
    steps.push({ ...UP }, { ...idle(4) });
  }

  // Confirm placement at slot 0, then back out of all menus
  steps.push(
    { ...A },
    { ...idle(30) },
    { ...B },
    { ...idle(12) },
    { ...B },
    { ...idle(12) },
    { ...B },
    { ...idle(12) },
  );

  return steps;
}
