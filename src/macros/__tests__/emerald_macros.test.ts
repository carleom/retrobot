/**
 * Milestone 4 Acceptance Test: Macro Engine
 *
 * Usage:
 *   yarn test:macros                        (synthetic tests only)
 *   yarn test:macros <path-to-rom.gba>      (synthetic + live ROM test)
 */

import * as fs from "fs";
import Piscina from "piscina";
import { InputState } from "../../util";
import { CoreType } from "../../emulate";
import { Macro, MacroStep, executeMacro, getUpdateButtonIndices, MacroContext } from "../../macros";
import {
  selectMoveMacro,
  useItemMacro,
  switchPokemonMacro,
  runMacro,
  openBagMacro,
  backMacro,
} from "../emerald";

// ── Test Framework ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Macro Structure Tests ────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════");
console.log("  MACRO STRUCTURE TESTS");
console.log("═══════════════════════════════════════════\n");

// ── selectMoveMacro ──────────────────────────────────────────────────────────

test("selectMoveMacro(0) starts with A, ends with idle", () => {
  const macro = selectMoveMacro(0);
  assert(macro.length > 0, "macro should not be empty");

  // First step: A to select FIGHT
  assert(macro[0].input.A === true, "first step should press A");
  assert(macro[0].duration === 4, "first step duration should be 4");

  // Should have an updateButtons step for the move selection
  const updateIndices = getUpdateButtonIndices(macro);
  assert(updateIndices.length === 1, "should have exactly 1 updateButtons step");
});

test("selectMoveMacro(1) includes RIGHT navigation", () => {
  const macro = selectMoveMacro(1);
  const hasRight = macro.some(
    (s) => s.input.RIGHT && !s.input.DOWN,
  );
  assert(hasRight, "slot 1 macro should include RIGHT press");
});

test("selectMoveMacro(2) includes DOWN navigation", () => {
  const macro = selectMoveMacro(2);
  const hasDown = macro.some(
    (s) => s.input.DOWN && !s.input.RIGHT,
  );
  assert(hasDown, "slot 2 macro should include DOWN press");
});

test("selectMoveMacro(3) includes DOWN and RIGHT", () => {
  const macro = selectMoveMacro(3);
  const hasDown = macro.some((s) => s.input.DOWN === true);
  const hasRight = macro.some((s) => s.input.RIGHT === true);
  assert(hasDown && hasRight, "slot 3 macro should include both DOWN and RIGHT");
});

test("selectMoveMacro throws on invalid slot", () => {
  try {
    selectMoveMacro(-1);
    assert(false, "should throw for slot -1");
  } catch (e: any) {
    assert(e.message.includes("Invalid"), "should mention invalid");
  }
  try {
    selectMoveMacro(4);
    assert(false, "should throw for slot 4");
  } catch (e: any) {
    assert(e.message.includes("Invalid"), "should mention invalid");
  }
});

// ── useItemMacro ─────────────────────────────────────────────────────────────

test("useItemMacro(0) navigates RIGHT to BAG", () => {
  const macro = useItemMacro(0);
  const firstInput = macro[0].input;
  assert(firstInput.RIGHT === true, "first step should press RIGHT to navigate to BAG");
});

test("useItemMacro(0) has updateButton step", () => {
  const macro = useItemMacro(0);
  const updateIndices = getUpdateButtonIndices(macro);
  assert(updateIndices.length === 1, "should have 1 updateButtons step");
});

test("useItemMacro(3) includes 3 DOWN presses", () => {
  const macro = useItemMacro(3);
  const downCount = macro.filter((s) => s.input.DOWN && !s.input.RIGHT && !s.input.UP).length;
  assert(downCount === 3, `should have 3 DOWN presses for slot 3, got ${downCount}`);
});

test("useItemMacro throws on negative slot", () => {
  try {
    useItemMacro(-1);
    assert(false, "should throw");
  } catch (e: any) {
    assert(e.message.includes("Invalid"), "should mention invalid");
  }
});

// ── switchPokemonMacro ───────────────────────────────────────────────────────

test("switchPokemonMacro(0) navigates DOWN to PKMN", () => {
  const macro = switchPokemonMacro(0);
  assert(macro[0].input.DOWN === true, "first step should press DOWN to navigate to PKMN");
});

test("switchPokemonMacro(3) includes DOWN presses for navigation", () => {
  const macro = switchPokemonMacro(3);
  // Should have initial DOWN (to PKMN) + 3 more DOWNs (to navigate party)
  const downCount = macro.filter((s) => s.input.DOWN === true).length;
  assert(downCount >= 1, `should have at least 1 DOWN press, got ${downCount}`);
});

test("switchPokemonMacro has updateButton step", () => {
  const macro = switchPokemonMacro(1);
  const updateIndices = getUpdateButtonIndices(macro);
  assert(updateIndices.length === 1, "should have 1 updateButtons step");
});

// ── runMacro ─────────────────────────────────────────────────────────────────

test("runMacro navigates DOWN + RIGHT to RUN", () => {
  const macro = runMacro();
  const hasDown = macro.some((s) => s.input.DOWN === true);
  const hasRight = macro.some((s) => s.input.RIGHT === true);
  const hasA = macro.some((s) => s.input.A === true);
  assert(hasDown, "should have DOWN");
  assert(hasRight, "should have RIGHT");
  assert(hasA, "should have A to confirm");
});

test("runMacro has no updateButtons", () => {
  const macro = runMacro();
  const updateIndices = getUpdateButtonIndices(macro);
  assert(updateIndices.length === 0, "run macro should have no intermediate updates");
});

// ── backMacro ────────────────────────────────────────────────────────────────

test("backMacro presses B", () => {
  const macro = backMacro();
  assert(macro[0].input.B === true, "should press B");
});

// ── Macro step totals ────────────────────────────────────────────────────────

test("all macros have reasonable step counts", () => {
  // Each macro should be between 2 and 30 steps
  const macros: [string, Macro][] = [
    ["selectMoveMacro(0)", selectMoveMacro(0)],
    ["selectMoveMacro(3)", selectMoveMacro(3)],
    ["useItemMacro(0)", useItemMacro(0)],
    ["useItemMacro(3)", useItemMacro(3)],
    ["switchPokemonMacro(0)", switchPokemonMacro(0)],
    ["switchPokemonMacro(5)", switchPokemonMacro(5)],
    ["runMacro", runMacro()],
  ];

  for (const [name, macro] of macros) {
    assert(
      macro.length >= 2 && macro.length <= 30,
      `${name}: ${macro.length} steps (expected 2-30)`,
    );
  }
});

// ── All steps have positive duration ─────────────────────────────────────────

test("all macro steps have positive duration", () => {
  const allMacros = [
    ...selectMoveMacro(0),
    ...useItemMacro(0),
    ...switchPokemonMacro(0),
    ...runMacro(),
  ];

  for (const step of allMacros) {
    assert(step.duration > 0, `step with input ${JSON.stringify(step.input)} has duration ${step.duration}`);
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════`);

// ── Live ROM Test ────────────────────────────────────────────────────────────

const romPath = process.argv[2] || process.env.ROM_PATH;
if (romPath) {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  LIVE ROM MACRO TEST`);
  console.log(`═══════════════════════════════════════════\n`);

  (async () => {
    if (!fs.existsSync(romPath)) {
      console.log(`  ⚠️  ROM not found: ${romPath}. Skipping.`);
      process.exit(failed > 0 ? 1 : 0);
    }

    console.log("  Loading ROM...");
    const romBuffer = fs.readFileSync(romPath);

    const GbCore = require("../../../cores/mgba_libretro");
    const rawCore = await GbCore();
    let core = rawCore;
    if (core.then && !core._malloc) {
      core = await core;
    }

    core.retro_set_environment((cmd: number, data: number) => {
      if (cmd === 3) { core.HEAPU8[data] = 1; return true; }
      if (cmd === 10) return true;
      if (cmd === (51 | 0x10000)) return true;
      return false;
    });
    core.retro_set_video_refresh(() => {});
    core.retro_set_input_state(() => 0);

    // Load ROM
    {
      const pointer = core._malloc(romBuffer.byteLength);
      const heap = new Uint8Array(core.HEAPU8.buffer, pointer, romBuffer.byteLength);
      heap.set(new Uint8Array(romBuffer));
      if (!core.retro_load_game({ data: pointer, size: romBuffer.byteLength })) {
        console.log("  ❌ Failed to load ROM.");
        process.exit(1);
      }
    }

    // Boot to title screen
    console.log("  Booting to title screen (600 frames)...");
    for (let i = 0; i < 600; i++) core.retro_run();

    // Capture initial WRAM for comparison
    const RETRO_MEMORY_SYSTEM_RAM = 2;
    const getWram = () => {
      const ptr = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
      const sz = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
      return new Uint8Array(core.HEAPU8.buffer.slice(ptr, ptr + sz));
    };

    const wramBefore = getWram();

    // Press A to advance past title screen
    console.log("  Pressing A to advance title screen...");
    core.retro_set_input_state((_port: number, _device: number, _index: number, id: number) => {
      if (id === 256) {
        // JOYPAD_MASK — A button
        return 1 << 8; // RETRO_DEVICE_ID_JOYPAD_A
      }
      return 0;
    });
    for (let i = 0; i < 4; i++) core.retro_run();

    // Release A
    core.retro_set_input_state(() => 0);
    for (let i = 0; i < 120; i++) core.retro_run(); // wait for transition

    const wramAfter = getWram();

    // Verify WRAM changed (something happened)
    let changed = false;
    for (let i = 0; i < Math.min(wramBefore.length, wramAfter.length); i++) {
      if (wramBefore[i] !== wramAfter[i]) {
        changed = true;
        break;
      }
    }

    if (changed) {
      console.log("  ✅ WRAM changed after A press (game advanced).");
    } else {
      console.log("  ❌ WRAM did not change after A press.");
      failed++;
    }

    console.log(`\n  Live ROM macro test completed.`);
    process.exit(failed > 0 ? 1 : 0);
  })();
} else {
  console.log(`\n  (No ROM provided — skipping live test.)`);
  process.exit(failed > 0 ? 1 : 0);
}
