import * as fs from "fs";
import * as path from "path";

// ── Species Name Lookup (from emerald_lookups.json) ──────────────────────────

const lookupsPath = path.join(
  __dirname,
  "..",
  "config",
  "emerald_lookups.json",
);
const lookups = JSON.parse(fs.readFileSync(lookupsPath, "utf-8"));
const speciesNames: Record<string, string> = lookups.species;

const allSpecies = Object.values(speciesNames) as string[];

export function searchSpecies(query: string): string[] {
  const q = query.toLowerCase();
  return allSpecies
    .filter((name) => name.toLowerCase().includes(q))
    .slice(0, 25);
}

// ── Encounter Data (generated from decompiled wild_encounters.json) ──────────

const encountersPath = path.join(__dirname, "..", "config", "encounters.json");
let encounters: Record<string, Record<string, string[]>> = {};
try {
  encounters = JSON.parse(fs.readFileSync(encountersPath, "utf-8"));
} catch (_) {}

function formatEncounters(name: string): string {
  const locs =
    encounters[name] ||
    encounters[name.toUpperCase()] ||
    encounters[name.toLowerCase()];
  if (!locs) return "";
  const lines = Object.entries(locs).map(
    ([loc, methods]) => "\u2022 " + loc + " (" + methods.join(", ") + ")",
  );
  return "\n**Found at:**\n" + lines.join("\n");
}

// ── PokéAPI Types ────────────────────────────────────────────────────────────

const POKEAPI = "https://pokeapi.co/api/v2";

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PokeAPI ${res.status}: ${url}`);
  return res.json();
}

interface PokeAPIPokemon {
  id: number;
  name: string;
  types: { type: { name: string } }[];
  species: { url: string };
  stats: { base_stat: number; stat: { name: string } }[];
  abilities: {
    ability: { name: string; url: string };
    is_hidden: boolean;
  }[];
}

interface PokeAPIEvolutionChain {
  chain: PokeAPIChainLink;
}

interface PokeAPIChainLink {
  species: { name: string };
  evolution_details: {
    min_level: number | null;
    trigger: { name: string };
    item: { name: string } | null;
    held_item: { name: string } | null;
    trade_species: { name: string } | null;
  }[];
  evolves_to: PokeAPIChainLink[];
}

function formatTypes(types: { type: { name: string } }[]): string {
  return types
    .map((t) => t.type.name.charAt(0).toUpperCase() + t.type.name.slice(1))
    .join(" / ");
}

// ── Stats ────────────────────────────────────────────────────────────────────

const STAT_LABELS: Record<string, string> = {
  hp: "HP",
  attack: "ATK",
  defense: "DEF",
  "special-attack": "SPA",
  "special-defense": "SPD",
  speed: "SPE",
};

function formatStats(
  stats: { base_stat: number; stat: { name: string } }[],
): string {
  const parts: string[] = [];
  let total = 0;
  for (const s of stats) {
    const label =
      STAT_LABELS[s.stat.name] || s.stat.name.slice(0, 3).toUpperCase();
    const val = String(s.base_stat).padStart(3);
    parts.push(`${label} ${val}`);
    total += s.base_stat;
  }
  parts.push(`TOT ${total}`);
  return parts.join(" / ");
}

// ── Abilities ────────────────────────────────────────────────────────────────

interface PokeAPIAbility {
  effect_entries: {
    effect: string;
    short_effect: string;
    language: { name: string };
  }[];
}

async function formatAbilities(
  abilities: { ability: { name: string; url: string }; is_hidden: boolean }[],
): Promise<string> {
  const lines: string[] = [];
  for (const a of abilities) {
    const name = a.ability.name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    try {
      const data = (await fetchJSON(a.ability.url)) as PokeAPIAbility;
      const en = data.effect_entries.find((e) => e.language.name === "en");
      const desc = en?.short_effect || en?.effect || "";
      const suffix = a.is_hidden ? " (Hidden)" : "";
      lines.push(`**${name}**${suffix}: ${desc}`);
    } catch {
      lines.push(`**${name}**${a.is_hidden ? " (Hidden)" : ""}`);
    }
  }
  return lines.join("\n");
}

// ── Evolution Chain ──────────────────────────────────────────────────────────

function formatEvolution(chain: PokeAPIChainLink): string {
  const stages: string[] = [];
  let current: PokeAPIChainLink | null = chain;

  while (current) {
    const name =
      current.species.name.charAt(0).toUpperCase() +
      current.species.name.slice(1);
    const details = current.evolution_details[0];
    let method = "";

    if (details) {
      if (details.min_level) method = "Lv " + details.min_level;
      else if (details.trigger.name === "use-item")
        method = details.item?.name || "Item";
      else if (details.trigger.name === "trade") method = "Trade";
      else if (details.trigger.name === "shed") method = "Shed";
      else method = details.trigger.name;

      if (method) method = " (" + method + ")";
    }

    stages.push(name + method);
    current = current.evolves_to[0] || null;
  }

  return stages.join(" \u2192 ");
}

// ── Moves ────────────────────────────────────────────────────────────────────

interface PokeAPIMoveDetail {
  move: { name: string };
  version_group_details: {
    level_learned_at: number;
    move_learn_method: { name: string };
    version_group: { name: string };
  }[];
}

function formatMoves(
  moves: PokeAPIMoveDetail[],
  versionGroup: string,
): Record<string, string[]> {
  const byMethod: Record<string, { name: string; level: number }[]> = {};

  for (const m of moves) {
    const details = m.version_group_details.filter(
      (d) => d.version_group.name === versionGroup,
    );
    for (const d of details) {
      const method = d.move_learn_method.name;
      const name = m.move.name.replace(/-/g, " ");
      if (!byMethod[method]) byMethod[method] = [];
      byMethod[method].push({ name, level: d.level_learned_at });
    }
  }

  const methodLabels: Record<string, string> = {
    "level-up": "Level-up",
    machine: "TM/HM",
    tutor: "Tutor",
    egg: "Egg",
  };

  const result: Record<string, string[]> = {};
  for (const [method, entries] of Object.entries(byMethod)) {
    const label = methodLabels[method] || method;
    entries.sort((a, b) => a.level - b.level);
    result[label] = entries.map((e) =>
      method === "level-up" && e.level > 0
        ? e.name + " (Lv " + e.level + ")"
        : e.name,
    );
  }

  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface DexEntry {
  name: string;
  id: number;
  types: string;
  evolution: string;
  locations?: string;
  stats?: string;
  abilities?: string;
  moves?: Record<string, string[]>;
}

export async function getDexEntry(name: string): Promise<DexEntry> {
  const poke = (await fetchJSON(
    POKEAPI + "/pokemon/" + name.toLowerCase(),
  )) as PokeAPIPokemon;

  const species = (await fetchJSON(poke.species.url)) as {
    evolution_chain: { url: string };
  };

  const evo = (await fetchJSON(
    species.evolution_chain.url,
  )) as PokeAPIEvolutionChain;

  return {
    name: poke.name.charAt(0).toUpperCase() + poke.name.slice(1),
    id: poke.id,
    types: formatTypes(poke.types),
    evolution: formatEvolution(evo.chain),
    locations: formatEncounters(poke.name),
    stats: formatStats(poke.stats),
    abilities: await formatAbilities(poke.abilities),
  };
}

export async function getDexMoves(
  name: string,
  versionGroup = "emerald",
): Promise<string> {
  const poke = await fetchJSON(POKEAPI + "/pokemon/" + name.toLowerCase());
  const byMethod = formatMoves(poke.moves, versionGroup);

  const sections: string[] = [];
  for (const [method, entries] of Object.entries(byMethod)) {
    sections.push("**" + method + ":** " + entries.join(", "));
  }

  return sections.join("\n");
}
