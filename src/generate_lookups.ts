import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DECOMP_DIR = path.join(PROJECT_ROOT, "decompiled", "pokeemerald", "src", "data");
const CONFIG_DIR = path.join(PROJECT_ROOT, "config");
const OUTPUT_PATH = path.join(CONFIG_DIR, "emerald_lookups.json");

const MOVE_NAMES_PATH = path.join(DECOMP_DIR, "text", "move_names.h");
const ITEMS_PATH = path.join(DECOMP_DIR, "items.h");
const SPECIES_NAMES_PATH = path.join(DECOMP_DIR, "text", "species_names.h");

interface LookupMap {
  [id: string]: string;
}

interface Lookups {
  moves: LookupMap;
  items: LookupMap;
  species: LookupMap;
}

function extractMoves(content: string): LookupMap {
  const regex = /\[.*?\]\s*=\s*_\("([^"]*)"\)/g;
  const result: LookupMap = {};
  let match: RegExpExecArray | null;
  let id = 0;
  while ((match = regex.exec(content)) !== null) {
    result[String(id)] = match[1];
    id++;
  }
  return result;
}

function extractItems(content: string): LookupMap {
  const regex = /\.name\s*=\s*_\("([^"]*)"\)/g;
  const result: LookupMap = {};
  let match: RegExpExecArray | null;
  let id = 0;
  while ((match = regex.exec(content)) !== null) {
    result[String(id)] = match[1];
    id++;
  }
  return result;
}

function extractSpecies(content: string): LookupMap {
  const regex = /\[.*?\]\s*=\s*_\("([^"]*)"\)/g;
  const result: LookupMap = {};
  let match: RegExpExecArray | null;
  let id = 0;
  while ((match = regex.exec(content)) !== null) {
    result[String(id)] = match[1];
    id++;
  }
  return result;
}

function printExamples(label: string, lookup: LookupMap, ids: number[]): void {
  const entries = ids.map((id) => `  ${id}: "${lookup[String(id)]}"`).join("\n");
  console.log(`${label} examples:`);
  console.log(entries);
}

function main(): void {
  // Read source files
  console.log("Reading source files...");
  const moveNamesContent = fs.readFileSync(MOVE_NAMES_PATH, "utf-8");
  const itemsContent = fs.readFileSync(ITEMS_PATH, "utf-8");
  const speciesNamesContent = fs.readFileSync(SPECIES_NAMES_PATH, "utf-8");

  // Extract names
  console.log("Extracting moves...");
  const moves = extractMoves(moveNamesContent);
  console.log("Extracting items...");
  const items = extractItems(itemsContent);
  console.log("Extracting species...");
  const species = extractSpecies(speciesNamesContent);

  // Build output
  const lookups: Lookups = { moves, items, species };

  // Ensure config directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Write JSON
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(lookups, null, 2), "utf-8");
  console.log(`\nWrote ${OUTPUT_PATH}`);

  // Print summary
  console.log(`\n=== Summary ===`);
  console.log(`Moves:   ${Object.keys(moves).length}`);
  console.log(`Items:   ${Object.keys(items).length}`);
  console.log(`Species: ${Object.keys(species).length}`);

  console.log();
  printExamples("Moves", moves, [0, 1, 33, 100, 354]);
  console.log();
  printExamples("Items", items, [0, 1, 2, 3, 4]);
  console.log();
  printExamples("Species", species, [0, 1, 2, 150, 411]);
}

main();
