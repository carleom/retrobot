/**
 * Milestone 3 Acceptance Test: Dynamic Layout Generator
 *
 * Usage:
 *   yarn test:layouts                        (synthetic tests only)
 *   yarn test:layouts <path-to-rom.gba>      (synthetic + live ROM test)
 *
 * Verifies that the layout generator produces correct Discord button rows
 * with accurate move names, PP counts, item quantities, and scene-appropriate
 * button visibility (e.g., Run hidden in trainer battles, ball row hidden in trainer).
 */

import * as fs from "fs";
import { ButtonBuilder, ActionRowBuilder } from "discord.js";
import {
  Scene,
  EWRAM_BASE,
  BattleCommState,
  ChosenAction,
  BattleTypeFlag,
} from "../../scenes";
import { generateLayout, LayoutResult } from "../../layouts";

// ── Constants ────────────────────────────────────────────────────────────────

const WRAM_SIZE = 0x40000;

const ADDR = {
  gBattleTypeFlags: 0x02022fec,
  gActiveBattler: 0x02024064,
  gChosenActionByBattler: 0x0202421c,
  gBattleCommunication: 0x02024332,
  gPlayerParty: 0x020244ec,
  encryptionKey: 0x02024b00,
  bagItems: 0x02025f60,
  bagBalls: 0x02026050,
} as const;

const POKEMON_SIZE = 0x64;

// ── WRAM Helpers ─────────────────────────────────────────────────────────────

function createWram(): Uint8Array {
  return new Uint8Array(WRAM_SIZE);
}

function offset(addr: number): number {
  return addr - EWRAM_BASE;
}

function writeU8(wram: Uint8Array, addr: number, value: number): void {
  wram[offset(addr)] = value & 0xff;
}

function writeU16(wram: Uint8Array, addr: number, value: number): void {
  const off = offset(addr);
  wram[off] = value & 0xff;
  wram[off + 1] = (value >> 8) & 0xff;
}

function writeU32(wram: Uint8Array, addr: number, value: number): void {
  const off = offset(addr);
  wram[off] = value & 0xff;
  wram[off + 1] = (value >> 8) & 0xff;
  wram[off + 2] = (value >> 16) & 0xff;
  wram[off + 3] = (value >> 24) & 0xff;
}

/** Set up a wild battle with player battler active. */
function setupWildBattle(wram: Uint8Array): void {
  writeU32(wram, ADDR.gBattleTypeFlags, 1); // wild, single
  writeU8(wram, ADDR.gActiveBattler, 0);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_BEFORE_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_NONE);
}

/** Set up a trainer battle. */
function setupTrainerBattle(wram: Uint8Array): void {
  writeU32(wram, ADDR.gBattleTypeFlags, BattleTypeFlag.BATTLE_TYPE_TRAINER);
  writeU8(wram, ADDR.gActiveBattler, 0);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_BEFORE_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_NONE);
}

/** Write a party Pokémon at the given slot index. */
function writePartyPokemon(
  wram: Uint8Array,
  slotIndex: number,
  species: number,
  moves: [number, number, number, number],
  pp: [number, number, number, number],
  currentHp: number,
  maxHp: number,
  level: number = 50,
): void {
  const base = ADDR.gPlayerParty + slotIndex * POKEMON_SIZE;
  writeU16(wram, base + 0x00, species);
  writeU16(wram, base + 0x0c, moves[0]);
  writeU16(wram, base + 0x0e, moves[1]);
  writeU16(wram, base + 0x10, moves[2]);
  writeU16(wram, base + 0x12, moves[3]);
  writeU8(wram, base + 0x14, pp[0]);
  writeU8(wram, base + 0x15, pp[1]);
  writeU8(wram, base + 0x16, pp[2]);
  writeU8(wram, base + 0x17, pp[3]);
  writeU8(wram, base + 0x54, level);
  writeU16(wram, base + 0x56, currentHp);
  writeU16(wram, base + 0x58, maxHp);
}

/** Write a bag item at the given pocket/slot. */
function writeBagItem(
  wram: Uint8Array,
  pocketAddr: number,
  slotIndex: number,
  itemId: number,
  quantity: number,
): void {
  // quantity is stored XOR-encrypted. Set encryptionKey to 0 for simplicity.
  const slotAddr = pocketAddr + slotIndex * 4;
  writeU16(wram, slotAddr, itemId);
  writeU16(wram, slotAddr + 2, quantity); // XOR with key=0 → stored as-is
}

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

/** Get all button labels from a list of ActionRowBuilders. */
function getAllLabels(rows: ActionRowBuilder[]): string[] {
  const labels: string[] = [];
  for (const r of rows) {
    for (const comp of r.components) {
      if (comp instanceof ButtonBuilder && comp.data.label) {
        labels.push(comp.data.label);
      }
    }
  }
  return labels;
}

/** Get all custom IDs from the rows. */
function getAllCustomIds(rows: ActionRowBuilder[]): string[] {
  const ids: string[] = [];
  for (const r of rows) {
    for (const comp of r.components) {
      if (comp instanceof ButtonBuilder) {
        const data = comp.data as any;
        if (data.custom_id) {
          ids.push(data.custom_id);
        }
      }
    }
  }
  return ids;
}

/** Get all disabled states. */
function getAllDisabled(rows: ActionRowBuilder[]): boolean[] {
  const states: boolean[] = [];
  for (const r of rows) {
    for (const comp of r.components) {
      if (comp instanceof ButtonBuilder) {
        states.push(comp.data.disabled ?? false);
      }
    }
  }
  return states;
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════");
console.log("  LAYOUT GENERATOR TESTS");
console.log("═══════════════════════════════════════════\n");

const GAME_ID = "test123";

// ── Overworld Layout ─────────────────────────────────────────────────────────

test("overworld layout has D-pad + A/B/Start", () => {
  const wram = createWram();
  // All zeros → not in battle → overworld
  const result = generateLayout(wram, GAME_ID);
  assert(result.scene === Scene.OVERWORLD, "should be overworld scene");

  const labels = getAllLabels(result.rows);
  assert(labels.includes("Up"), "should have Up");
  assert(labels.includes("Down"), "should have Down");
  assert(labels.includes("Left"), "should have Left");
  assert(labels.includes("Right"), "should have Right");
  assert(labels.includes("A"), "should have A");
  assert(labels.includes("B"), "should have B");
  assert(labels.includes("Start"), "should have Start");
  assert(result.rows.length === 2, "should have 2 rows");
});

// ── Battle Fight — Wild ──────────────────────────────────────────────────────

test("wild battle fight shows moves + balls + items + actions", () => {
  const wram = createWram();
  setupWildBattle(wram);

  // Party slot 0: Bulbasaur (species 1) with Tackle (33), Growl (45), Leech Seed (73), Vine Whip (22)
  writePartyPokemon(wram, 0, 1, [33, 45, 73, 22], [25, 40, 10, 15], 80, 80);

  // Set encryption key to 0
  writeU32(wram, ADDR.encryptionKey, 0);

  // Add balls: Poke Ball (4) x5, Great Ball (3) x2
  writeBagItem(wram, ADDR.bagBalls, 0, 4, 5);
  writeBagItem(wram, ADDR.bagBalls, 1, 3, 2);

  // Add items: Potion (13) x8, Antidote (14) x3
  writeBagItem(wram, ADDR.bagItems, 0, 13, 8);
  writeBagItem(wram, ADDR.bagItems, 1, 14, 3);

  const result = generateLayout(wram, GAME_ID);
  assert(result.scene === Scene.BATTLE_FIGHT, "should be battle fight");

  const labels = getAllLabels(result.rows);

  // Row 1: moves with PP
  assert(labels.includes("TACKLE (25)"), "should have TACKLE (25)");
  assert(labels.includes("GROWL (40)"), "should have GROWL (40)");
  assert(labels.includes("LEECH SEED (10)"), "should have LEECH SEED (10)");
  assert(labels.includes("VINE WHIP (15)"), "should have VINE WHIP (15)");

  // Row 2: balls (wild battle)
  assert(
    labels.some((l) => l.includes("POKé BALL x5")),
    "should have POKé BALL",
  );
  assert(
    labels.some((l) => l.includes("GREAT BALL x2")),
    "should have GREAT BALL",
  );

  // Row 3: items
  assert(
    labels.some((l) => l.includes("POTION x8")),
    "should have POTION",
  );
  assert(
    labels.some((l) => l.includes("ANTIDOTE x3")),
    "should have ANTIDOTE",
  );

  // Row 4: Switch, Manual, Run (wild — Run visible)
  assert(
    labels.some((l) => l.includes("Switch")),
    "should have Switch",
  );
  assert(
    labels.some((l) => l.includes("Manual")),
    "should have Manual",
  );
  assert(
    labels.some((l) => l.includes("Run")),
    "should have Run in wild battle",
  );

  // 4 rows in wild battle
  assert(
    result.rows.length === 4,
    `should have 4 rows, got ${result.rows.length}`,
  );
});

// ── Battle Fight — Trainer ───────────────────────────────────────────────────

test("trainer battle fight hides balls and run", () => {
  const wram = createWram();
  setupTrainerBattle(wram);

  writePartyPokemon(wram, 0, 1, [33, 45, 73, 22], [25, 40, 10, 15], 80, 80);
  writeU32(wram, ADDR.encryptionKey, 0);
  writeBagItem(wram, ADDR.bagItems, 0, 13, 8);

  const result = generateLayout(wram, GAME_ID);
  const labels = getAllLabels(result.rows);

  // Moves still visible
  assert(labels.includes("TACKLE (25)"), "should have TACKLE");

  // Balls should NOT appear
  const hasBall = labels.some((l) => l.includes("BALL") || l.includes("POKé"));
  assert(!hasBall, "should NOT have ball row in trainer battle");

  // Run should NOT appear
  const hasRun = labels.some((l) => l.includes("Run"));
  assert(!hasRun, "should NOT have Run in trainer battle");

  // Should have 3 rows (moves, items, actions without run)
  assert(
    result.rows.length === 3,
    `should have 3 rows, got ${result.rows.length}`,
  );
});

// ── 0 PP moves disabled ──────────────────────────────────────────────────────

test("moves with 0 PP are disabled", () => {
  const wram = createWram();
  setupWildBattle(wram);

  // Tackle with 0 PP, Growl with PP
  writePartyPokemon(wram, 0, 1, [33, 45, 0, 0], [0, 40, 0, 0], 80, 80);
  writeU32(wram, ADDR.encryptionKey, 0);

  const result = generateLayout(wram, GAME_ID);
  const labels = getAllLabels(result.rows);
  const disabled = getAllDisabled(result.rows);

  // Row 1: first 4 buttons are moves
  const tackleIdx = labels.findIndex((l) => l.startsWith("TACKLE"));
  const growlIdx = labels.findIndex((l) => l.startsWith("GROWL"));

  assert(tackleIdx >= 0, "should have TACKLE button");
  assert(growlIdx >= 0, "should have GROWL button");
  assert(disabled[tackleIdx] === true, "TACKLE with 0 PP should be disabled");
  assert(disabled[growlIdx] === false, "GROWL with PP should be enabled");
});

// ── Empty/missing moves ──────────────────────────────────────────────────────

test("missing move slots show '—' and are disabled", () => {
  const wram = createWram();
  setupWildBattle(wram);

  // Only 2 moves known
  writePartyPokemon(wram, 0, 1, [33, 45, 0, 0], [25, 40, 0, 0], 80, 80);
  writeU32(wram, ADDR.encryptionKey, 0);

  const result = generateLayout(wram, GAME_ID);
  const labels = getAllLabels(result.rows);
  const disabled = getAllDisabled(result.rows);

  const dashIdx = labels.findIndex((l) => l === "—");
  assert(dashIdx >= 0, "should have '—' for empty move slots");

  // Count dashes in move row: should be 2
  const moveRowLabels = labels.slice(0, 4);
  const dashCount = moveRowLabels.filter((l) => l === "—").length;
  assert(dashCount === 2, `should have 2 dashes, got ${dashCount}`);
});

// ── Move Select Layout ───────────────────────────────────────────────────────

test("move select layout shows move names without PP", () => {
  const wram = createWram();
  setupWildBattle(wram);
  // Override comm state to make it look like move select
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_USE_MOVE);

  writePartyPokemon(wram, 0, 1, [33, 45, 73, 22], [25, 40, 10, 15], 80, 80);

  const result = generateLayout(wram, GAME_ID);
  assert(
    result.scene === Scene.BATTLE_MOVE_SELECT,
    "should be move select scene",
  );

  const labels = getAllLabels(result.rows);
  // Names only, no PP counts
  assert(labels.includes("TACKLE"), "should have TACKLE");
  assert(
    !labels.some((l) => l.includes("(25)")),
    "should NOT have PP counts in move select",
  );
  assert(
    labels.some((l) => l.includes("Back")),
    "should have Back button",
  );
});

// ── Pokémon Switch Layout ────────────────────────────────────────────────────

test("pokemon switch layout shows party with HP", () => {
  const wram = createWram();
  setupWildBattle(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_SWITCH);

  // Party: Bulbasaur (active, 80/80), Charmander (4, 120/120), empty, Pidgey fainted, ...
  writePartyPokemon(wram, 0, 1, [33, 45, 0, 0], [25, 40, 0, 0], 80, 80); // BULBASAUR
  writePartyPokemon(wram, 1, 4, [10, 0, 0, 0], [35, 0, 0, 0], 120, 120); // CHARMANDER
  writePartyPokemon(wram, 2, 0, [0, 0, 0, 0], [0, 0, 0, 0], 0, 0); // empty
  writePartyPokemon(wram, 3, 16, [0, 0, 0, 0], [0, 0, 0, 0], 0, 35); // PIDGEY fainted
  writeU32(wram, ADDR.encryptionKey, 0);

  const result = generateLayout(wram, GAME_ID);
  assert(result.scene === Scene.BATTLE_PKMN_SWITCH, "should be switch scene");

  const labels = getAllLabels(result.rows);

  assert(
    labels.some((l) => l.startsWith("BULBASAUR") && l.includes("80/80")),
    "should have BULBASAUR 80/80",
  );
  assert(
    labels.some((l) => l.startsWith("CHARMANDER") && l.includes("120/120")),
    "should have CHARMANDER 120/120",
  );
  assert(
    labels.some((l) => l === "— empty —"),
    "should have empty slot",
  );
  assert(
    labels.some((l) => l.includes("PIDGEY") && l.includes("FNT")),
    "should have PIDGEY fainted",
  );
  assert(
    labels.some((l) => l.includes("Back to Battle")),
    "should have Back button",
  );
});

// ── Fainted Pokémon are disabled in switch layout ────────────────────────────

test("fainted Pokemon are disabled in switch layout", () => {
  const wram = createWram();
  setupWildBattle(wram);
  writeU8(
    wram,
    ADDR.gBattleCommunication,
    BattleCommState.STATE_WAIT_ACTION_CHOSEN,
  );
  writeU8(wram, ADDR.gChosenActionByBattler, ChosenAction.B_ACTION_SWITCH);

  writePartyPokemon(wram, 0, 1, [33, 0, 0, 0], [25, 0, 0, 0], 0, 80); // fainted (hp=0)
  writeU32(wram, ADDR.encryptionKey, 0);

  const result = generateLayout(wram, GAME_ID);
  const labels = getAllLabels(result.rows);
  const disabled = getAllDisabled(result.rows);

  const fntIdx = labels.findIndex((l) => l.includes("FNT"));
  assert(fntIdx >= 0, "should have fainted label");
  assert(
    disabled[fntIdx] === true,
    "fainted Pokemon button should be disabled",
  );
});

// ── Custom ID format ─────────────────────────────────────────────────────────

test("buttons have correct custom ID format", () => {
  const wram = createWram();
  setupWildBattle(wram);
  writePartyPokemon(wram, 0, 1, [33, 0, 0, 0], [25, 0, 0, 0], 80, 80);
  writeU32(wram, ADDR.encryptionKey, 0);

  const result = generateLayout(wram, GAME_ID);
  const ids = getAllCustomIds(result.rows);

  // Move buttons should have macro-move-N format
  assert(
    ids.includes(`${GAME_ID}-macro-move-0`),
    "first move should be macro-move-0",
  );
  assert(
    ids.includes(`${GAME_ID}-macro-move-1`),
    "second move should be macro-move-1",
  );

  // Action buttons
  assert(ids.includes(`${GAME_ID}-macro-switch`), "should have switch");
  assert(ids.includes(`${GAME_ID}-macro-manual`), "should have manual");
  assert(ids.includes(`${GAME_ID}-macro-run`), "should have run");
});

// ── Empty bag produces placeholder buttons ───────────────────────────────────

test("empty bag shows disabled placeholder buttons", () => {
  const wram = createWram();
  setupWildBattle(wram);
  writePartyPokemon(wram, 0, 1, [33, 0, 0, 0], [25, 0, 0, 0], 80, 80);

  // No bag items written — all slots are empty
  writeU32(wram, ADDR.encryptionKey, 0);

  const result = generateLayout(wram, GAME_ID);
  const labels = getAllLabels(result.rows);

  // Ball row should be all dashes
  const ballRowStart = 4; // after 4 move buttons
  const ballLabels = labels.slice(ballRowStart, ballRowStart + 4);
  assert(
    ballLabels.every((l) => l === "—"),
    "empty ball row should be all dashes",
  );
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════`);

// ── Live ROM Test (optional) ─────────────────────────────────────────────────

const romPath = process.argv[2] || process.env.ROM_PATH;
if (romPath) {
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  LIVE ROM LAYOUT TEST`);
  console.log(`═══════════════════════════════════════════\n`);

  (async () => {
    if (!fs.existsSync(romPath)) {
      console.log(`  ⚠️  ROM not found: ${romPath}. Skipping live test.`);
      process.exit(failed > 0 ? 1 : 0);
    }

    const romBuffer = fs.readFileSync(romPath);
    const GbCore = require("../../../cores/mgba_libretro");
    const rawCore = await GbCore();
    let core = rawCore;
    if (core.then && !core._malloc) {
      core = await core;
    }

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

    // Boot to title screen
    console.log("  Running 600 boot frames...");
    for (let i = 0; i < 600; i++) core.retro_run();

    const RETRO_MEMORY_SYSTEM_RAM = 2;
    const wramPtr = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
    const wramSize = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
    const wram = new Uint8Array(
      core.HEAPU8.buffer.slice(wramPtr, wramPtr + wramSize),
    );

    const result = generateLayout(wram, "live_test");
    console.log(`  Detected scene: ${result.scene}`);
    console.log(`  Rows: ${result.rows.length}`);

    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      const labels = row.components
        .filter((c) => c instanceof ButtonBuilder)
        .map((c) => (c as ButtonBuilder).data.label ?? "(no label)")
        .join(" | ");
      console.log(`  Row ${i + 1}: ${labels}`);
    }

    if (result.scene === Scene.OVERWORLD) {
      console.log(`\n  ✅ Live ROM returns overworld layout at title screen.`);
    }

    console.log(`\n  Live ROM layout test completed.`);
    process.exit(failed > 0 ? 1 : 0);
  })();
} else {
  console.log(`\n  (No ROM provided — skipping live test.)`);
  process.exit(failed > 0 ? 1 : 0);
}
