import * as fs from "fs";
import * as path from "path";
import Piscina from "piscina";
import { Message } from "discord.js";

import { CoreType, emulate } from "../emulate";
import { GameInfo, InputAssist, InputAssistSpeed } from "../gameInfo";
import { generateLayout, readBagPocket, itemName } from "../layouts";
import { MacroContext, MacroStep, executeMacro } from "../macros";
import { useItemMacro } from "../macros/emerald";
import { emulateParallel } from "../workerInterface";
import { readCurrentState } from "./readCurrentState";

/**
 * Use an item from the bag during battle.
 *
 * Phases:
 *   1. Open the bag (resetToFight + RIGHT + A + wait 300f)
 *   2. Read current pocket from RAM
 *   3. Navigate to target pocket (LEFT presses)
 *   4. Read items, find target item, navigate cursor, select + USE
 *   5. Run autoplay to advance through animations/effects
 */
export async function handleBattleItem(
  pool: Piscina,
  id: string,
  info: GameInfo,
  player: { nickname?: string; displayName: string },
  message: Message,
  itemPocket: number,
  itemId: number,
): Promise<void> {
  await message.channel.sendTyping();

  // Phase 1: Open the bag (batched)
  const openSteps: MacroStep[] = [
    ...useItemMacro(0).slice(0, 12), // resetToFight + RIGHT + A + idle(300)
  ];
  const { stateBytes, gameBytes } = await readCurrentState(pool, id, info);
  let bagCtx: MacroContext = {
    coreType: info.coreType,
    game: gameBytes,
    state: stateBytes,
    frames: [],
    wram: new Uint8Array(0),
    av_info: {},
  };
  bagCtx = await executeMacro(pool, bagCtx, openSteps);

  // Phase 2: Read current pocket from RAM
  bagCtx = await emulateParallel(pool, bagCtx, { input: {}, duration: 1 });
  const currPocket = bagCtx.wram[0x0203ce5d - 0x02000000];
  console.log(
    "[item] bag open, current pocket=" +
      currPocket +
      " target pocket=" +
      itemPocket,
  );

  // Phase 3: Navigate to the correct pocket (LEFT to go to previous pocket)
  const leftPresses = (currPocket - itemPocket + 5) % 5;
  const pocketSteps: MacroStep[] = [];
  for (let i = 0; i < leftPresses; i++) {
    pocketSteps.push({ input: { LEFT: true }, duration: 4 });
    pocketSteps.push({ input: {}, duration: 6 });
  }
  if (pocketSteps.length > 0) {
    bagCtx = await executeMacro(pool, bagCtx, pocketSteps);
    bagCtx = await emulateParallel(pool, bagCtx, { input: {}, duration: 1 });
    console.log(
      "[item] after pocket nav, pocket=" +
        bagCtx.wram[0x0203ce5d - 0x02000000],
    );
  }

  // Phase 4: Read items, find display position, navigate DOWN
  const items = readBagPocket(bagCtx.wram, itemPocket);
  console.log(
    "[item] raw items: " +
      items.map((it) => it.slotIndex + ":" + it.itemId).join(", "),
  );
  const sorted = [...items].sort((a, b) => a.slotIndex - b.slotIndex);
  console.log(
    "[item] sorted: " +
      sorted
        .map(
          (it, i) => i + ":" + it.itemId + "(slot" + it.slotIndex + ")",
        )
        .join(", "),
  );
  const found = items.find((it) => it.itemId === itemId);
  let displayPos = 0;
  if (found) {
    displayPos = sorted.findIndex((it) => it.itemId === itemId);
  }
  // Read current bag cursor position (gBagPosition.cursorPosition[pocket])
  const cursorAddr = 0x0203ce60 + itemPocket * 2;
  const cursorPos =
    bagCtx.wram[cursorAddr - 0x02000000] |
    (bagCtx.wram[cursorAddr + 1 - 0x02000000] << 8);
  console.log(
    "[item] itemId=" +
      itemId +
      " displayPos=" +
      displayPos +
      " itemCount=" +
      items.length +
      " cursorAt=" +
      cursorPos,
  );

  const navSteps: MacroStep[] = [];
  // Navigate from current cursor to target (no wrapping in bag)
  if (cursorPos > displayPos) {
    const deltaUp = cursorPos - displayPos;
    console.log(
      "[item] cursor " + cursorPos + " → " + displayPos + " UP×" + deltaUp,
    );
    for (let i = 0; i < deltaUp; i++) {
      navSteps.push({ input: { UP: true }, duration: 4 });
      navSteps.push({ input: {}, duration: 4 });
    }
  } else if (displayPos > cursorPos) {
    const deltaDown = displayPos - cursorPos;
    console.log(
      "[item] cursor " + cursorPos + " → " + displayPos + " DOWN×" + deltaDown,
    );
    for (let i = 0; i < deltaDown; i++) {
      navSteps.push({ input: { DOWN: true }, duration: 4 });
      navSteps.push({ input: {}, duration: 4 });
    }
  } else {
    console.log("[item] cursor already at target " + cursorPos);
  }
  // A: select item from bag list → opens USE/CANCEL submenu
  navSteps.push({ input: { A: true }, duration: 4 });
  navSteps.push({ input: {}, duration: 60 });
  // A: select USE → uses item or throws ball
  navSteps.push({ input: { A: true }, duration: 4 });
  // Healing items (pocket 0) need party screen; balls (pocket 1) don't
  if (itemPocket === 0) {
    navSteps.push({ input: {}, duration: 120 }); // wait for party screen
    navSteps.push({ input: { A: true }, duration: 4 }); // select slot 0
  }
  navSteps.push({ input: {}, duration: 60 });
  navSteps.push({ input: {}, duration: 60 });

  if (navSteps.length > 0) {
    bagCtx = await executeMacro(pool, bagCtx, navSteps);
  }

  // Save state and run autoplay
  fs.writeFileSync(path.resolve("data", id, "state.sav"), bagCtx.state);
  const {
    recording,
    recordingName,
    state: finalState,
    wram: finalWram,
  } = await emulate(
    pool,
    info.coreType,
    new Uint8Array(fs.readFileSync(path.resolve("data", id, info.game))),
    bagCtx.state,
    {
      ...info,
      inputAssist: InputAssist.Autoplay,
      inputAssistSpeed: InputAssistSpeed.Normal,
    },
    [],
  );
  fs.writeFileSync(path.resolve("data", id, "state.sav"), finalState);
  const { rows: itemRows } = generateLayout(finalWram, id, 1);
  await message.channel.send({
    content:
      (player.nickname || player.displayName) + ": Used " + itemName(itemId),
    files: [{ attachment: recording, name: recordingName }],
    components: itemRows as any,
  });
}
