import * as fs from "fs";
import * as path from "path";

import { Scene } from "../scenes";
import { InputState } from "../util";

export interface EmeraldFixtureAssertion {
  scene?: Scene;
  layoutScene?: Scene;
  labelsInclude?: string[];
  labelsExclude?: string[];
  customIdsInclude?: string[];
  customIdsExclude?: string[];
  disabledIds?: string[];
  enabledIds?: string[];
}

export interface EmeraldFixtureStep {
  name: string;
  input?: InputState;
  duration?: number;
  assert?: EmeraldFixtureAssertion;
}

export interface EmeraldFixtureCase {
  name: string;
  state: string;
  multiplier?: number;
  assert?: EmeraldFixtureAssertion;
  steps?: EmeraldFixtureStep[];
}

export interface EmeraldFixtureManifest {
  rom: string;
  cases: EmeraldFixtureCase[];
}

export function loadEmeraldFixtureManifest(fixturesDir: string): EmeraldFixtureManifest {
  const manifestPath = path.join(fixturesDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Fixture manifest not found: ${manifestPath}`);
  }

  return JSON.parse(fs.readFileSync(manifestPath, "utf8")) as EmeraldFixtureManifest;
}

export function resolveFixturePath(fixturesDir: string, relativePath: string): string {
  return path.resolve(fixturesDir, relativePath);
}
