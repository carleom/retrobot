/**
 * Milestone 2 Acceptance Test: Scene Detector
 *
 * Usage:
 *   yarn ts-node src/scenes/__tests__/emerald.test.ts
 *
 * This test verifies the EmeraldSceneDetector correctly classifies
 * known WRAM snapshots into the proper Scene enum values.
 *
 * Since we don't have live ROM snapshots in CI, the primary tests use
 * synthetic WRAM buffers constructed to match known good memory states.
 * A live-ROM test path is also provided.
 */

import * as fs from "fs";
import {
  Scene,
  EWRAM_BASE,
  readU8,
  readU16,
  readU32,
  BattleCommState,
  ChosenAction,
  BattleTypeFlag,
} from "../../scenes";
import { EmeraldSceneDetector } from "../emerald";

// ── Constants ────────────────────────────────────────────────────────────────

const WRAM_SIZE = 0x40000; // 256 KB EWRAM
const ADDR = {
  gBattleTypeFlags: 0x02022fec,
  gActiveBattler: 0x02024064,
  gChosenActionByBattler: 0x0202421c,
  gBattleCommunication: 0x02024332,
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create an empty WRAM buffer (all zeros). */
function createWram(): Uint8Array {
  return new Uint8Array(WRAM_SIZE);
}

function offset(addr: number): number {
  return addr - EWRAM_BASE;
}

function writeU8(wram: Uint8Array, addr: number, value: number): void {
  wram[offset(addr)] = value & 0xff;
}

function writeU32(wram: Uint8Array, addr: number, value: number): void {
  const off = offset(addr);
  wram[off] = value & 0xff;
  wram[off + 1] = (value >> 8) & 0xff;
  wram[off + 2] = (value >> 16) & 0xff;
  wram[off + 3] = (value >> 24) & 0xff;
}

/** Set up a basic battle state: active battler = 0, wild single battle.
 *  Uses BATTLE_TYPE_IS_MASTER (1<<2=4) which is always set in non-link battles. */
function setupBattleState(wram: Uint8Array): void {
  writeU32(wram, ADDR.gBattleTypeFlags, 4); // BATTLE_TYPE_IS_MASTER, no double/trainer bits
  writeU8(wram, ADDR.gActiveBattler, 0); // player is active battler
}

// ── Synthetic Memory Snapshot Tests ──────────────────────────────────────────

const detector = new EmeraldSceneDetector();
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

function assertSceneEquals(actual: Scene, expected: Scene): void {
  assert(actual === expected, `Expected ${expected}, got ${actual}`);
}

// ── Test Suite ───────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════");
console.log("  SYNTHETIC WRAM TESTS");
console.log("═══════════════════════════════════════════\n");

// ── Overworld ────────────────────────────────────────────────────────────────

test("gBattleTypeFlags == 0 → OVERWORLD", () => {
  const wram = createWram();
  // All zeros — no battle active
  assertSceneEquals(detector.detect(wram), Scene.OVERWORLD);
});

test("gBattleTypeFlags == 0 (non-zero elsewhere) → OVERWORLD", () => {
  const wram = createWram();
  // Write some random data elsewhere, but keep battle flags at 0
  writeU8(wram, ADDR.gBattleCommunication, 5);
  writeU8(wram, ADDR.gChosenActionByBattler, 1);
  assertSceneEquals(detector.detect(wram), Scene.OVERWORLD);
});

// ── BATTLE_FIGHT (main menu) ─────────────────────────────────────────────────

test("STATE_BEFORE_ACTION_CHOSEN + B_ACTION_NONE → BATTLE_FIGHT", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_BEFORE_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_NONE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_FIGHT);
});

test("STATE_BEFORE_ACTION_CHOSEN + USE_MOVE (returning from sub) → BATTLE_FIGHT", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_BEFORE_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_FIGHT);
});

test("STATE_WAIT_ACTION_CONFIRMED → resolves via chosenAction (B_ACTION_USE_MOVE → BATTLE_MOVE_SELECT)", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CONFIRMED,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

test("STATE_WAIT_ACTION_CONFIRMED_STANDBY → resolves via chosenAction (B_ACTION_NONE → BATTLE_FIGHT)", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CONFIRMED_STANDBY,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_NONE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_FIGHT);
});

// ── BATTLE_YESNO ─────────────────────────────────────────────────────────────

test("BEFORE_ACTION_CHOSEN + YESNOBOX → BATTLE_YESNO", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_BEFORE_ACTION_CHOSEN,
  );
  writeU8(wram, 0x02023064, 0x05); // CONTROLLER_YESNOBOX in gBattleBufferA[0][0]
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_YESNO);
});

test("BEFORE_ACTION_CHOSEN without YESNOBOX → BATTLE_FIGHT (not yesno)", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_BEFORE_ACTION_CHOSEN,
  );
  // gBattleBufferA[0][0] is 0 (default) — not CONTROLLER_YESNOBOX
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_NONE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_FIGHT);
});

// ── BATTLE_PKMN_SWITCH (party screen via CONTROLLER_CHOOSEPOKEMON) ──────────

test("CONTROLLER_CHOOSEPOKEMON → BATTLE_PKMN_SWITCH (voluntary switch, comm=1)", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_SWITCH);
  // Party screen is open — buffer command takes priority
  writeU8(wram, 0x02023064, 0x08); // CONTROLLER_CHOOSEPOKEMON
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_PKMN_SWITCH);
});

test("CONTROLLER_CHOOSEPOKEMON → BATTLE_PKMN_SWITCH (faint replacement, comm=confirmed)", () => {
  const wram = createWram();
  setupBattleState(wram);
  // After a faint, commState might be CONFIRMED (the previous action finished)
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CONFIRMED,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  // Party screen is open for forced replacement
  writeU8(wram, 0x02023064, 0x08); // CONTROLLER_CHOOSEPOKEMON
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_PKMN_SWITCH);
});

// ── Old-Style YesNo Box (Cmd_yesnobox, gBattleCommunication hijacked) ───────

test("Old yesnobox: comm[0]=1, comm[1]=0, activeBattler=2, bufCmd=0x10 → BATTLE_YESNO", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4); // BATTLE_TYPE_IS_MASTER
  writeU8(wram, ADDR.gActiveBattler, 2); // non-player battler active
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CHOSEN); // index 0 = 1
  writeU8(wram, ADDR.gBattleCommunication + 1, 0); // cursor at top
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  writeU8(wram, 0x02023064, 0x10); // bufCmd[0] = leftover CONTROLLER_HEALTHBARUPDATE
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_YESNO);
});

test("Old yesnobox: comm[1]=1 (cursor at bottom) → BATTLE_YESNO", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 2);
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CHOSEN);
  writeU8(wram, ADDR.gBattleCommunication + 1, 1); // cursor at bottom
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  writeU8(wram, 0x02023064, 0x10);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_YESNO);
});

test("Old yesnobox NOT fired: activeBattler=0 (normal sub-menu)", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 0); // player battler — not old yesnobox
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CHOSEN);
  writeU8(wram, ADDR.gBattleCommunication + 1, 0);
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  writeU8(wram, 0x02023064, 0x10);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

test("Old yesnobox NOT fired: bufferCmd[0]=0x04 (CHOOSEACTION sub-menu)", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 2);
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CHOSEN);
  writeU8(wram, ADDR.gBattleCommunication + 1, 0);
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  writeU8(wram, 0x02023064, 0x04); // CONTROLLER_CHOOSEACTION — real sub-menu
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

test("Old yesnobox NOT fired: bufferCmd[0]=0 (stale buffer, excluded)", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 2);
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CHOSEN);
  writeU8(wram, ADDR.gBattleCommunication + 1, 0);
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  // bufferCmd = 0 (zero-initialized) — excluded from old yesnobox check
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

test("Old yesnobox NOT fired: comm[1]=2 (not a valid cursor position)", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 2);
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CHOSEN);
  writeU8(wram, ADDR.gBattleCommunication + 1, 2); // not 0 or 1
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  writeU8(wram, 0x02023064, 0x10);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

// ── Buffer per Active Battler ───────────────────────────────────────────────

test("CHOOSEPOKEMON at battler 2 index → BATTLE_PKMN_SWITCH", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 2);
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_WAIT_ACTION_CONFIRMED);
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  // gBattleBufferA[2][0] = 0x08 (stride 0x200, so +0x400 from base)
  writeU8(wram, 0x02023064 + 2 * 0x200, 0x08); // CONTROLLER_CHOOSEPOKEMON at battler 2
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_PKMN_SWITCH);
});

test("YESNOBOX at battler 1 index → BATTLE_YESNO", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4);
  writeU8(wram, ADDR.gActiveBattler, 1);
  writeU8(wram, ADDR.gBattleCommunication, BattleCommState.STATE_BEFORE_ACTION_CHOSEN);
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_NONE);
  writeU8(wram, 0x02023064 + 1 * 0x200, 0x05); // CONTROLLER_YESNOBOX at battler 1
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_YESNO);
});

// ── BATTLE_MOVE_SELECT ───────────────────────────────────────────────────────

test("STATE_WAIT_ACTION_CHOSEN + USE_MOVE → BATTLE_MOVE_SELECT", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

test("STATE_WAIT_ACTION_CASE_CHOSEN + USE_MOVE → BATTLE_MOVE_SELECT", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

// ── BATTLE_BAG_POCKET ────────────────────────────────────────────────────────

test("STATE_WAIT_ACTION_CHOSEN + USE_ITEM → BATTLE_BAG_POCKET", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_ITEM);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_BAG_POCKET);
});

test("STATE_WAIT_ACTION_CASE_CHOSEN + USE_ITEM → BATTLE_BAG_POCKET", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_ITEM);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_BAG_POCKET);
});

// ── BATTLE_PKMN_SWITCH ───────────────────────────────────────────────────────

test("STATE_WAIT_ACTION_CHOSEN + SWITCH → BATTLE_PKMN_SWITCH", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_SWITCH);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_PKMN_SWITCH);
});

test("STATE_WAIT_ACTION_CASE_CHOSEN + SWITCH → BATTLE_PKMN_SWITCH", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CASE_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_SWITCH);
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_PKMN_SWITCH);
});

// ── RUN → BATTLE_FIGHT (no sub-menu) ─────────────────────────────────────────

test("STATE_WAIT_ACTION_CHOSEN + RUN → BATTLE_FIGHT (no sub-menu)", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_RUN);
  // RUN has no sub-menu, so we fall back to BATTLE_FIGHT
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_FIGHT);
});

// ── UNKNOWN state ────────────────────────────────────────────────────────────

test("Unexpected comm state → UNKNOWN", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(wram, ADDR.gBattleCommunication, 0xfe); // invalid state
  assertSceneEquals(detector.detect(wram), Scene.UNKNOWN);
});

test("Unexpected action value → UNKNOWN", () => {
  const wram = createWram();
  setupBattleState(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, 0xfe); // invalid action
  assertSceneEquals(detector.detect(wram), Scene.UNKNOWN);
});

// ── Different active battler ─────────────────────────────────────────────────

test("Always reads battler 0 regardless of gActiveBattler", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 1);
  writeU8(wram, ADDR.gActiveBattler, 2); // irrelevant — always use battler 0
  // Set battler 0's state
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(
    wram,
    ADDR.gChosenActionByBattler,
    ChosenAction.B_ACTION_USE_MOVE,
  );
  // Put noise in battler 2's slots to confirm we ignore them
  writeU8(wram, ADDR.gBattleCommunication + 2, 0xff);
  writeU8(wram, ADDR.gChosenActionByBattler + 2, 0xff);
  // bufferCmd is 0 but activeBattler=2 so old yesnobox check doesn't fire
  assertSceneEquals(detector.detect(wram), Scene.BATTLE_MOVE_SELECT);
});

// ── Battle type helpers ──────────────────────────────────────────────────────

test("isTrainerBattle: wild battle → false", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4); // BATTLE_TYPE_IS_MASTER only
  assert(!detector.isTrainerBattle(wram), "wild battle should not be trainer");
});

test("isTrainerBattle: trainer battle → true", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4 | BattleTypeFlag.BATTLE_TYPE_TRAINER); // IS_MASTER + TRAINER
  assert(
    detector.isTrainerBattle(wram),
    "trainer bit set should be trainer battle",
  );
});

test("isDoubleBattle: single → false", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4); // BATTLE_TYPE_IS_MASTER only
  assert(!detector.isDoubleBattle(wram), "no double bit should be single battle");
});

test("isDoubleBattle: double flag → true", () => {
  const wram = createWram();
  writeU32(wram, ADDR.gBattleTypeFlags, 4 | BattleTypeFlag.BATTLE_TYPE_DOUBLE); // IS_MASTER + DOUBLE
  assert(
    detector.isDoubleBattle(wram),
    "double bit set should be double battle",
  );
});

// ── WRAM read helpers ────────────────────────────────────────────────────────

test("readU8 returns correct value", () => {
  const wram = createWram();
  const addr = 0x02000100;
  wram[addr - EWRAM_BASE] = 0xab;
  assert(readU8(wram, addr) === 0xab, "readU8 should return 0xAB");
});

test("readU16 returns correct little-endian value", () => {
  const wram = createWram();
  const addr = 0x02000100;
  wram[addr - EWRAM_BASE] = 0x34;
  wram[addr - EWRAM_BASE + 1] = 0x12;
  assert(readU16(wram, addr) === 0x1234, "readU16 should return 0x1234");
});

test("readU32 returns correct little-endian value", () => {
  const wram = createWram();
  const addr = 0x02000100;
  wram[addr - EWRAM_BASE] = 0x78;
  wram[addr - EWRAM_BASE + 1] = 0x56;
  wram[addr - EWRAM_BASE + 2] = 0x34;
  wram[addr - EWRAM_BASE + 3] = 0x12;
  assert(
    readU32(wram, addr) === 0x12345678,
    "readU32 should return 0x12345678",
  );
});

test("readU8 throws on out-of-bounds address", () => {
  const wram = createWram();
  try {
    readU8(wram, 0x02040000); // beyond 256KB EWRAM
    assert(false, "should have thrown");
  } catch (e: any) {
    assert(
      e.message.includes("out of WRAM bounds"),
      "should mention out of bounds",
    );
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════`);

// ── Live ROM Test (optional — run when ROM is available) ─────────────────────

const romPath = process.argv[2] || process.env.ROM_PATH;
if (romPath) {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  LIVE ROM TEST`);
  console.log(`═══════════════════════════════════════════\n`);

  (async () => {
    if (!fs.existsSync(romPath)) {
      console.log(`  ⚠️  ROM not found: ${romPath}. Skipping live test.`);
      process.exit(failed > 0 ? 1 : 0);
    }

    const romBuffer = fs.readFileSync(romPath);

    // Dynamic import of the WASM core
    const GbCore = require("../../../cores/mgba_libretro");
    const rawCore = await GbCore();
    let core = rawCore;
    if (core.then && !core._malloc) {
      core = await core;
    }

    // Environment setup
    core.retro_set_environment((cmd: number, data: number) => {
      if (cmd === 3) {
        core.HEAPU8[data] = 1;
        return true;
      }
      if (cmd === 10) return true;
      if (cmd === (51 | 0x10000)) return true;
      return false;
    });

    core.retro_set_video_refresh(() => {});
    core.retro_set_input_state(() => 0);

    // Load ROM
    {
      const pointer = core._malloc(romBuffer.byteLength);
      const heap = new Uint8Array(
        core.HEAPU8.buffer,
        pointer,
        romBuffer.byteLength,
      );
      heap.set(new Uint8Array(romBuffer));
      if (
        !core.retro_load_game({ data: pointer, size: romBuffer.byteLength })
      ) {
        console.log("  ❌ Failed to load ROM.");
        process.exit(1);
      }
    }

    // Boot: run frames to reach title screen
    console.log("  Running 600 boot frames...");
    for (let i = 0; i < 600; i++) core.retro_run();

    // Read WRAM
    const RETRO_MEMORY_SYSTEM_RAM = 2;
    const wramPtr = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
    const wramSize = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
    const wram = new Uint8Array(
      core.HEAPU8.buffer.slice(wramPtr, wramPtr + wramSize),
    );

    const scene = detector.detect(wram);
    const battleType = readU32(wram, ADDR.gBattleTypeFlags);
    const activeBattler = readU8(wram, ADDR.gActiveBattler);
    const commState = readU8(wram, ADDR.gBattleCommunication + activeBattler);
    const action = readU8(wram, ADDR.gChosenActionByBattler + activeBattler);

    console.log(
      `  gBattleTypeFlags   : 0x${battleType.toString(16).padStart(8, "0")}`,
    );
    console.log(`  gActiveBattler     : ${activeBattler}`);
    console.log(`  gBattleComm[0]     : ${commState}`);
    console.log(`  gChosenAction[0]   : ${action}`);
    console.log(`  Detected scene     : ${scene}`);

    // On title screen with no battle active, we expect OVERWORLD
    if (battleType === 0) {
      console.log(`  ✅ Not in battle at title screen — expected.`);
    }

    console.log(`\n  Live ROM test completed.`);

    process.exit(failed > 0 ? 1 : 0);
  })();
} else {
  console.log(
    `\n  (No ROM provided — skipping live test. Pass a ROM path to run live test.)`,
  );
  process.exit(failed > 0 ? 1 : 0);
}
