import * as fs from "fs";
import * as path from "path";
import Piscina from "piscina";
import { ButtonBuilder, ActionRowBuilder } from "discord.js";

import { CoreType } from "../emulate";
import { generateLayout } from "../layouts";
import { executeMacro, Macro, MacroContext } from "../macros";
import { confirmTargetMacro, nextTargetMacro, prevTargetMacro, runMacro, selectMoveFromListMacro, selectMoveMacro, switchFromPartyMacro, useItemMacro } from "../macros/emerald";
import { MAX_WORKERS } from "../config";
import { emeraldSceneDetector } from "../scenes/emerald";
import { InputAssist, InputAssistSpeed, DirectionPress, GameInfo } from "../gameInfo";
import { emulateParallel } from "../workerInterface";
import { InputState } from "../util";
import { EmeraldFixtureAssertion, EmeraldFixtureCase, EmeraldFixtureManifest, EmeraldFixtureStep, loadEmeraldFixtureManifest, resolveFixturePath } from "./emerald";

const fixturesDir = process.argv[2] || path.resolve("fixtures", "emerald");

const pool = new Piscina({
  filename: path.resolve(__dirname, path.resolve(__dirname, "..", "worker.ts")),
  name: "default",
  execArgv: ["-r", "ts-node/register"],
  ...(MAX_WORKERS == -1 ? {} : { maxThreads: MAX_WORKERS }),
});

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function getLabels(rows: ActionRowBuilder[]): string[] {
  const labels: string[] = [];
  for (const row of rows) {
    for (const comp of row.components) {
      if (comp instanceof ButtonBuilder) {
        if (comp.data.label) labels.push(comp.data.label);
        if (comp.data.emoji) labels.push(comp.data.emoji.name ?? "");
      }
    }
  }
  return labels;
}

function getIds(rows: ActionRowBuilder[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    for (const comp of row.components) {
      if (comp instanceof ButtonBuilder) {
        const data = comp.data as any;
        if (data.custom_id) ids.push(data.custom_id);
      }
    }
  }
  return ids;
}

function getDisabledMap(rows: ActionRowBuilder[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const row of rows) {
    for (const comp of row.components) {
      if (comp instanceof ButtonBuilder) {
        const data = comp.data as any;
        if (data.custom_id) result.set(data.custom_id, comp.data.disabled ?? false);
      }
    }
  }
  return result;
}

function defaultGameInfo(romName: string): GameInfo {
  return {
    game: romName,
    coreType: CoreType.GBA,
    guild: "fixture",
    channelId: "fixture",
    inputAssist: InputAssist.Off,
    inputAssistSpeed: InputAssistSpeed.Normal,
    directionPress: DirectionPress.Release,
    multipliers: [3, 5, 10],
  };
}

function buildMacro(name: string): Macro {
  const [kind, value] = name.split(":");
  switch (kind) {
    case "move":
      return selectMoveMacro(parseInt(value, 10));
    case "move-list":
      return selectMoveFromListMacro(parseInt(value, 10));
    case "target-confirm":
      return confirmTargetMacro();
    case "target-left":
      return prevTargetMacro();
    case "target-right":
      return nextTargetMacro();
    case "item":
      return useItemMacro(parseInt(value, 10));
    case "switch":
      return switchFromPartyMacro(parseInt(value, 10));
    case "run":
      return runMacro();
    default:
      throw new Error(`Unknown fixture macro: ${name}`);
  }
}

function assertFixture(assertion: EmeraldFixtureAssertion | undefined, scene: string, layoutScene: string, rows: ActionRowBuilder[]): void {
  if (!assertion) return;
  const labels = getLabels(rows);
  const ids = getIds(rows);
  const disabled = getDisabledMap(rows);

  if (assertion.scene) assert(scene === assertion.scene, `expected scene ${assertion.scene}, got ${scene}`);
  if (assertion.layoutScene) assert(layoutScene === assertion.layoutScene, `expected layoutScene ${assertion.layoutScene}, got ${layoutScene}`);
  for (const value of assertion.labelsInclude || []) assert(labels.some((label) => label.includes(value)), `missing label containing ${value}`);
  for (const value of assertion.labelsExclude || []) assert(!labels.some((label) => label.includes(value)), `unexpected label containing ${value}`);
  for (const value of assertion.customIdsInclude || []) assert(ids.some((id) => id.includes(value)), `missing custom id containing ${value}`);
  for (const value of assertion.customIdsExclude || []) assert(!ids.some((id) => id.includes(value)), `unexpected custom id containing ${value}`);
  for (const value of assertion.disabledIds || []) assert(disabled.get(value) === true, `expected disabled id ${value}`);
  for (const value of assertion.enabledIds || []) assert(disabled.get(value) === false, `expected enabled id ${value}`);
}

async function loadCaseContext(manifest: EmeraldFixtureManifest, testCase: EmeraldFixtureCase): Promise<MacroContext> {
  const romPath = resolveFixturePath(fixturesDir, manifest.rom);
  const statePath = resolveFixturePath(fixturesDir, testCase.state);
  const game = new Uint8Array(fs.readFileSync(romPath));
  const state = new Uint8Array(fs.readFileSync(statePath));
  const ctx = await emulateParallel(pool, { coreType: CoreType.GBA, game, state, frames: [], gameHash: undefined, stateHash: undefined }, { input: {}, duration: 1 });
  return { ...ctx, av_info: ctx.av_info };
}

async function runStep(ctx: MacroContext, step: EmeraldFixtureStep): Promise<MacroContext> {
  let next = ctx;
  if (step.input) {
    next = await emulateParallel(pool, next, { input: step.input, duration: step.duration ?? 4 });
  }
  return next;
}

async function runCase(manifest: EmeraldFixtureManifest, testCase: EmeraldFixtureCase): Promise<void> {
  let ctx = await loadCaseContext(manifest, testCase);
  const gameId = `fixture-${testCase.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

  let detectorScene = emeraldSceneDetector.detect(ctx.wram);
  let layout = generateLayout(ctx.wram, gameId, testCase.multiplier ?? 1);
  assertFixture(testCase.assert, detectorScene, layout.scene, layout.rows);

  for (const step of testCase.steps || []) {
    if (step.input) {
      ctx = await runStep(ctx, step);
    } else if ((step as any).macro) {
      ctx = await executeMacro(pool, ctx, buildMacro((step as any).macro));
    } else {
      throw new Error(`Step ${step.name} must provide input or macro`);
    }

    if ((step as any).idleFrames) {
      ctx = await emulateParallel(pool, ctx, { input: {}, duration: (step as any).idleFrames });
    }

    detectorScene = emeraldSceneDetector.detect(ctx.wram);
    layout = generateLayout(ctx.wram, gameId, testCase.multiplier ?? 1);
    assertFixture(step.assert, detectorScene, layout.scene, layout.rows);
  }
}

async function main(): Promise<void> {
  const manifest = loadEmeraldFixtureManifest(fixturesDir);
  let passed = 0;
  let failed = 0;

  console.log("\n═══════════════════════════════════════════");
  console.log("  EMERALD FIXTURE TESTS");
  console.log("═══════════════════════════════════════════\n");

  for (const testCase of manifest.cases) {
    try {
      await runCase(manifest, testCase);
      console.log(`  ✅ ${testCase.name}`);
      passed++;
    } catch (err: any) {
      console.log(`  ❌ ${testCase.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
