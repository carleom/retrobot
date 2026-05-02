/**
 * Setup a local dev game instance with an existing ROM + save state.
 *
 * Usage:
 *   yarn setup:dev <guild-id> <channel-id>
 *
 * Example:
 *   yarn setup:dev 123456789 987654321
 *
 * This creates data/devgame/ with the Emerald ROM, your save state, and
 * an info.json so the bot picks it up on restart.
 */

import * as fs from "fs";
import * as path from "path";
import * as shelljs from "shelljs";

const guildId = process.argv[2];
const channelId = process.argv[3];

if (!guildId || !channelId) {
  console.error("Usage: yarn setup:dev <guild-id> <channel-id>");
  console.error("  guild-id   — your test Discord server ID (enable Developer Mode in Discord, right-click server → Copy ID)");
  console.error("  channel-id — the channel ID where the bot should post");
  process.exit(1);
}

const GAME_ID = "devgame";
const ROM = "roms/Pokemon - Emerald Version (USA, Europe).gba";
const SAVE = "saves/battle_save.sav";

if (!fs.existsSync(ROM)) {
  console.error(`ROM not found: ${ROM}`);
  process.exit(1);
}

if (!fs.existsSync(SAVE)) {
  console.error(`Save state not found: ${SAVE}`);
  console.error("Copy your save state to saves/battle_save.sav first.");
  process.exit(1);
}

const gameDir = path.resolve("data", GAME_ID);
shelljs.mkdir("-p", gameDir);

// Copy ROM
const romName = path.basename(ROM);
fs.copyFileSync(ROM, path.join(gameDir, romName));
console.log(`Copied ROM → data/${GAME_ID}/${romName}`);

// Copy save state
fs.copyFileSync(SAVE, path.join(gameDir, "state.sav"));
console.log(`Copied save → data/${GAME_ID}/state.sav`);

// Write game info
const info = {
  game: romName,
  coreType: "gba",
  guild: guildId,
  channelId: channelId,
  inputAssist: "autoplay",
  inputAssistSpeed: "normal",
  directionPress: "release",
  multipliers: [3, 5, 10],
};

fs.writeFileSync(path.join(gameDir, "info.json"), JSON.stringify(info, null, 4));
console.log(`Wrote info → data/${GAME_ID}/info.json`);

console.log("\n✅ Dev game setup complete. Start the bot with: yarn start");
console.log(`   Game ID: ${GAME_ID}`);
console.log(`   To update the save state later: cp saves/battle_save.sav data/${GAME_ID}/state.sav`);
