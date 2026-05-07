import * as fs from "fs";
import * as path from "path";
import Piscina from "piscina";
import { Message } from "discord.js";

import { CoreType, emulate } from "../emulate";
import { GameInfo, InputAssist, InputAssistSpeed } from "../gameInfo";
import { generateLayout, readBagPocket, itemName } from "../layouts";
import { MacroContext } from "../macros";
import { emulateParallel } from "../workerInterface";
import { readCurrentState } from "./readCurrentState";
import { buildMultiplierRows } from "./components";
import { Scene } from "../scenes";

/**
 * Use an item from the overworld bag on a party Pokémon.
 *
 * Flow:
 *   1. Open START menu → navigate to BAG (position 2)
 *   2. Wait 300f for bag, read items, find target item
 *   3. Navigate cursor to item, select → USE → party screen
 *   4. Navigate to target party slot, select + confirm
 *   5. Advance "Restored HP!" text, B-press out of menus
 *   6. Run autoplay to finish
 */
export async function handleOverworldBagUse(
  pool: Piscina,
  id: string,
  info: GameInfo,
  player: { nickname?: string; displayName: string },
  message: Message,
  slot: number,
  itemId: number,
): Promise<void> {
  await message.channel.sendTyping();

  const { stateBytes, gameBytes } = await readCurrentState(pool, id, info);
  let ctx: MacroContext = {
    coreType: info.coreType,
    game: gameBytes,
    state: stateBytes,
    frames: [],
    wram: new Uint8Array(0),
    av_info: {},
  };

  // 1. Read sStartMenuCursorPos before opening menu
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 1 });
  const cursorPos = ctx.wram[0x0203760e - 0x02000000];
  const upPresses = Number.isFinite(cursorPos) ? cursorPos : 0;
  const downToBag = 2; // BAG is position 2: POKéDEX=0, POKéMON=1, BAG=2

  // Open start menu
  ctx = await emulateParallel(pool, ctx, { input: { START: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 20 });

  // Navigate to BAG
  for (let i = 0; i < upPresses; i++) {
    ctx = await emulateParallel(pool, ctx, { input: { UP: true }, duration: 2 });
    ctx = await emulateParallel(pool, ctx, { input: {}, duration: 2 });
  }
  for (let i = 0; i < downToBag; i++) {
    ctx = await emulateParallel(pool, ctx, { input: { DOWN: true }, duration: 2 });
    ctx = await emulateParallel(pool, ctx, { input: {}, duration: 2 });
  }
  // Open bag — generous wait (same 300f as battle item handler)
  ctx = await emulateParallel(pool, ctx, { input: { A: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 300 });

  // Verify bag opened by reading current pocket
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 1 });
  const currPocket = ctx.wram[0x0203ce5d - 0x02000000];
  console.log("[ow-bag] bag open, pocket=" + currPocket);

  // 2. Read items, find the target item's display position
  const items = readBagPocket(ctx.wram, 0);
  const sorted = [...items].sort((a, b) => a.slotIndex - b.slotIndex);
  const displayPos = sorted.findIndex((it) => it.itemId === itemId);
  const cursorAddr = 0x0203ce60; // gBagPosition.cursorPosition[0]
  const currCursor = ctx.wram[cursorAddr - 0x02000000] | (ctx.wram[cursorAddr + 1 - 0x02000000] << 8);

  // Navigate to target item
  if (currCursor > displayPos) {
    for (let i = 0; i < currCursor - displayPos; i++) {
      ctx = await emulateParallel(pool, ctx, { input: { UP: true }, duration: 4 });
      ctx = await emulateParallel(pool, ctx, { input: {}, duration: 4 });
    }
  } else if (displayPos > currCursor) {
    for (let i = 0; i < displayPos - currCursor; i++) {
      ctx = await emulateParallel(pool, ctx, { input: { DOWN: true }, duration: 4 });
      ctx = await emulateParallel(pool, ctx, { input: {}, duration: 4 });
    }
  }

  // Select item → opens USE/CANCEL submenu
  ctx = await emulateParallel(pool, ctx, { input: { A: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 60 });
  // Select USE → opens party screen
  ctx = await emulateParallel(pool, ctx, { input: { A: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 120 });

  // 3. Party screen is open — navigate to target slot
  for (let i = 0; i < slot; i++) {
    ctx = await emulateParallel(pool, ctx, { input: { DOWN: true }, duration: 4 });
    ctx = await emulateParallel(pool, ctx, { input: {}, duration: 6 });
  }
  // Select and confirm — generous wait for item use animation + text
  ctx = await emulateParallel(pool, ctx, { input: { A: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 120 });

  // Advance through "Restored HP!" text
  ctx = await emulateParallel(pool, ctx, { input: { A: true }, duration: 4 });
  ctx = await emulateParallel(pool, ctx, { input: {}, duration: 60 });

  // B to exit menus: bag pocket → bag main → start menu → overworld
  for (let i = 0; i < 5; i++) {
    ctx = await emulateParallel(pool, ctx, { input: { B: true }, duration: 4 });
    ctx = await emulateParallel(pool, ctx, { input: {}, duration: 20 });
  }

  fs.writeFileSync(path.resolve("data", id, "state.sav"), ctx.state);
  const {
    recording,
    recordingName,
    state: finalState,
    wram: finalWram,
  } = await emulate(
    pool,
    info.coreType,
    new Uint8Array(fs.readFileSync(path.resolve("data", id, info.game))),
    ctx.state,
    { ...info, inputAssist: InputAssist.Autoplay, inputAssistSpeed: InputAssistSpeed.Normal },
    [],
  );
  fs.writeFileSync(path.resolve("data", id, "state.sav"), finalState);
  const { rows: bagResultRows, scene: bagResultScene } = generateLayout(finalWram, id, 1);
  const bagComponents = bagResultScene === Scene.OVERWORLD
    ? [...bagResultRows, ...buildMultiplierRows(id, 1, info.multipliers, true)]
    : bagResultRows;
  await message.channel.send({
    content: (player.nickname || player.displayName) + ": Used " + itemName(itemId),
    files: [{ attachment: recording, name: recordingName }],
    components: bagComponents as any,
  });
}
