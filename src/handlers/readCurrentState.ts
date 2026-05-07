import * as fs from "fs";
import * as path from "path";
import Piscina from "piscina";
import { GameInfo } from "../gameInfo";
import { emulateParallel } from "../workerInterface";

/** Load current game state + WRAM in a single call. Used by all macro/layout handlers. */
export async function readCurrentState(
  pool: Piscina,
  id: string,
  info: GameInfo,
): Promise<{
  stateBytes: Uint8Array;
  gameBytes: Uint8Array;
  wram: Uint8Array;
}> {
  const gameBytes = new Uint8Array(
    fs.readFileSync(path.resolve("data", id, info.game)),
  );
  const stateBytes = new Uint8Array(
    fs.readFileSync(path.resolve("data", id, "state.sav")),
  );
  const { wram } = await emulateParallel(
    pool,
    {
      coreType: info.coreType,
      game: gameBytes,
      state: stateBytes,
      frames: [],
      gameHash: undefined,
      stateHash: undefined,
    },
    { input: {}, duration: 1 },
  );
  return { stateBytes, gameBytes, wram };
}
