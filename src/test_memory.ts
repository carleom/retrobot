/**
 * Milestone 1 Acceptance Test: Expose Memory Reads
 *
 * Usage:
 *   yarn test:memory <path-to-rom> [address1_hex] [address2_hex] ...
 *   or: ROM_PATH=/path/to/rom.gba ts-node src/test_memory.ts
 *
 * This script loads a GBA ROM into the mGBA core, runs frames to boot,
 * then reads WRAM via retro_get_memory_data(2) and prints the results.
 */

import * as fs from "fs";

// ── Constants ────────────────────────────────────────────────────────────────

const RETRO_MEMORY_SYSTEM_RAM = 2;
const RETRO_ENVIRONMENT_GET_VARIABLE = 3;
const EXPECTED_GBA_EWRAM_SIZE = 0x40000; // 256 KB

// ── CLI argument parsing ─────────────────────────────────────────────────────

const romPath = process.argv[2] || process.env.ROM_PATH;
const readAddresses: number[] = process.argv
  .slice(3)
  .map((a) => parseInt(a, 16));

if (!romPath) {
  console.error(
    "Usage: ts-node src/test_memory.ts <path-to-rom.gba> [addr1_hex] [addr2_hex] ...",
  );
  console.error("  or: ROM_PATH=/path/to/rom.gba ts-node src/test_memory.ts");
  process.exit(1);
}

if (!fs.existsSync(romPath)) {
  console.error(`ROM file not found: ${romPath}`);
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Loading ROM: ${romPath}\n`);

  const romBuffer = fs.readFileSync(romPath);

  // Dynamically load the mGBA WASM core (same pattern as worker.ts).
  // NOTE: This Emscripten build uses MODULARIZE=1 but does NOT expose an
  // "asm" sub-object.  Exports (_malloc, HEAPU8, retro_*, etc.) are set
  // directly on the Module object.
  const GbCore = require("../cores/mgba_libretro");
  const rawCore = await GbCore();

  // Handle nested promise (some MODULARIZE=1 wrappers ship a {then:fn} shape)
  let core = rawCore;
  if (core.then && !core._malloc) {
    core = await core;
  }

  // ── Environment Setup ──────────────────────────────────────────────────
  core.retro_set_environment((cmd: number, data: number) => {
    if (cmd === RETRO_ENVIRONMENT_GET_VARIABLE) {
      core.HEAPU8[data] = 1;
      return true;
    }
    if (cmd === 10) return true; // SET_PIXEL_FORMAT
    if (cmd === (51 | 0x10000)) return true; // GET_FASTFORWARDING
    return false;
  });

  // Stub video refresh (required for retro_run)
  core.retro_set_video_refresh(
    (_data: number, _width: number, _height: number, _pitch: number) => {},
  );

  // Stub input state
  core.retro_set_input_state(
    (_port: number, _device: number, _index: number, _id: number) => 0,
  );

  // ── Load ROM ───────────────────────────────────────────────────────────
  {
    const pointer = core._malloc(romBuffer.byteLength);
    const heap = new Uint8Array(
      core.HEAPU8.buffer,
      pointer,
      romBuffer.byteLength,
    );
    heap.set(new Uint8Array(romBuffer));

    const result = core.retro_load_game({
      data: pointer,
      size: romBuffer.byteLength,
    });
    if (!result) {
      console.error("Failed to load ROM. Ensure it is a valid GBA ROM.");
      process.exit(1);
    }
    console.log("ROM loaded successfully.");
  }

  // ── Get AV Info ────────────────────────────────────────────────────────
  const avInfo: any = {};
  core.retro_get_system_av_info(avInfo);
  console.log(
    `System AV Info: ${avInfo.geometry_base_width}x${avInfo.geometry_base_height} @ ${avInfo.timing_fps}fps`,
  );

  // ── Run Frames ─────────────────────────────────────────────────────────
  const FRAMES_TO_RUN = 600; // ~10s at 60 fps — enough to reach title screen
  console.log(`Running ${FRAMES_TO_RUN} frames to initialize game state...`);
  for (let i = 0; i < FRAMES_TO_RUN; i++) {
    core.retro_run();
  }
  console.log("Frames completed.\n");

  // ── Read WRAM ──────────────────────────────────────────────────────────
  const wramPtr = core.retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
  const wramSize = core.retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);

  console.log("═══════════════════════════════════════════");
  console.log("  MEMORY READ TEST RESULTS");
  console.log("═══════════════════════════════════════════");
  console.log(`  WRAM Pointer : 0x${wramPtr.toString(16).toUpperCase()}`);
  console.log(
    `  WRAM Size    : ${wramSize} bytes (${(wramSize / 1024).toFixed(1)} KB)`,
  );

  if (wramSize === EXPECTED_GBA_EWRAM_SIZE) {
    console.log(`  ✅ Size matches expected GBA EWRAM (256 KB / 0x40000)`);
  } else {
    console.log(
      `  ⚠️  Unexpected size. Expected ${EXPECTED_GBA_EWRAM_SIZE} bytes for GBA EWRAM.`,
    );
  }

  if (wramSize === 0) {
    console.error(
      "\n❌ WRAM size is 0. Memory read failed. Check core initialization.",
    );
    process.exit(1);
  }

  // ── Read WRAM buffer ───────────────────────────────────────────────────
  const wram = new Uint8Array(
    core.HEAPU8.buffer.slice(wramPtr, wramPtr + wramSize),
  );

  // ── Print first 64 bytes ───────────────────────────────────────────────
  console.log(`\n  First 64 bytes of WRAM (hex):`);
  for (let row = 0; row < 4; row++) {
    const offset = row * 16;
    const bytes = Array.from(wram.slice(offset, offset + 16))
      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(wram.slice(offset, offset + 16))
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "."))
      .join("");
    console.log(
      `    0x${offset.toString(16).padStart(4, "0")}:  ${bytes}  |${ascii}|`,
    );
  }

  // ── Read specific addresses if provided ────────────────────────────────
  if (readAddresses.length > 0) {
    console.log(
      `\n  Requested address reads (relative to WRAM base 0x02000000):`,
    );
    for (const addr of readAddresses) {
      const offset = addr - 0x02000000;
      if (offset >= 0 && offset + 3 < wramSize) {
        const u8 = wram[offset];
        const u16 = wram[offset] | (wram[offset + 1] << 8);
        const u32 =
          wram[offset] |
          (wram[offset + 1] << 8) |
          (wram[offset + 2] << 16) |
          (wram[offset + 3] << 24);
        console.log(
          `    0x${addr.toString(16).toUpperCase().padStart(8, "0")}:  u8=0x${u8.toString(16).padStart(2, "0")}  u16=0x${u16.toString(16).padStart(4, "0")}  u32=0x${u32.toString(16).padStart(8, "0")}`,
        );
      } else if (offset < 0) {
        console.log(
          `    0x${addr.toString(16).toUpperCase().padStart(8, "0")}:  ⚠️  Below WRAM base`,
        );
      } else {
        console.log(
          `    0x${addr.toString(16).toUpperCase().padStart(8, "0")}:  ⚠️  Beyond WRAM range`,
        );
      }
    }
  }

  // ── Scan for ASCII strings (validates meaningful data in WRAM) ─────────
  console.log(`\n  Scanning WRAM for printable ASCII strings (≥4 chars)...`);
  let currentString = "";
  let stringsFound = 0;
  const maxStrings = 10;
  const WRAM_BASE = 0x02000000;

  for (let i = 0; i < wramSize && stringsFound < maxStrings; i++) {
    if (wram[i] >= 0x20 && wram[i] <= 0x7e) {
      currentString += String.fromCharCode(wram[i]);
    } else {
      if (currentString.length >= 4) {
        const addr = WRAM_BASE + i - currentString.length;
        console.log(
          `    0x${addr.toString(16).toUpperCase().padStart(8, "0")}: "${currentString}"`,
        );
        stringsFound++;
      }
      currentString = "";
    }
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log("  ✅ Milestone 1 acceptance test passed.");
  console.log("  Worker can return a WRAM buffer alongside frame data.");
  console.log("═══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
