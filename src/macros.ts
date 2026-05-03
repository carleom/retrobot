/**
 * Macro Engine — executes sequences of timed button inputs through the emulator.
 *
 * ⚠️  WARNING: Blind frame-count timing is unreliable for menu navigation.
 *     Always pair macros with scene-polling in the caller (see index.ts item handler).
 *     Macros that depend on idle(N) waits for menu transitions will break.
 *
 * A macro is an array of {input, duration} steps. The engine runs each step
 * sequentially through the worker pool, accumulating frames. Intermediate steps
 * with `updateButtons` can trigger in-place Discord message updates (handled
 * by the caller in M5). Only one GIF is generated at the end.
 */

import Piscina from "piscina";

import { InputState } from "./util";
import { CoreType } from "./emulate";
import { emulateParallel } from "./workerInterface";
import { Frame } from "./worker";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MacroStep {
  /** Button mask for this step. */
  input: InputState;
  /** How many frames to hold this input (1 frame ≈ 1/60s). */
  duration: number;
  /** If true, the caller (M5) should update Discord buttons after this step without generating a GIF. */
  updateButtons?: boolean;
}

/** An ordered sequence of MacroSteps. */
export type Macro = MacroStep[];

/** The accumulated emulation context passed between macro steps. */
export interface MacroContext {
  coreType: CoreType;
  game: Uint8Array;
  state: Uint8Array;
  gameHash?: string;
  stateHash?: string;
  frames: Frame[];
  wram: Uint8Array;
  av_info: any;
}

// ── Executor ─────────────────────────────────────────────────────────────────

/**
 * Execute a macro through the emulation pipeline.
 *
 * Runs each step sequentially via the worker pool, accumulating frames
 * and state. Does NOT generate any GIFs — the caller is responsible for
 * encoding the accumulated frames into a single GIF after execution.
 *
 * @param pool - Piscina worker pool for emulation.
 * @param ctx  - Initial emulation context (game ROM, save state, etc.).
 * @param macro - The macro steps to execute.
 * @returns The final context with all accumulated frames and final state.
 */
export async function executeMacro(
  pool: Piscina,
  ctx: MacroContext,
  macro: Macro,
): Promise<MacroContext> {
  console.log("[macro] executing " + macro.length + " steps");
  let current = ctx;

  for (let i = 0; i < macro.length; i++) {
    const step = macro[i];
    const inputKeys =
      Object.keys(step.input)
        .filter((k) => step.input[k as keyof InputState])
        .join(",") || "none";
    console.log(
      "[macro] step " +
        i +
        "/" +
        macro.length +
        " input=" +
        inputKeys +
        " duration=" +
        step.duration,
    );
    current = await emulateParallel(pool, current, {
      input: step.input,
      duration: step.duration,
    });
  }

  return current;
}

/**
 * Extract just the step indices that should trigger a button update.
 * Useful for the M5 caller to know when to update Discord components in-place.
 */
export function getUpdateButtonIndices(macro: Macro): number[] {
  return macro.reduce<number[]>((acc, step, i) => {
    if (step.updateButtons) acc.push(i);
    return acc;
  }, []);
}
