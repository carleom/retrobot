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
const speciesNames: Record<string, string> = lookups.species; // "1": "Bulbasaur", etc.

/** All species names for autocomplete (lowercase for matching). */
const allSpecies = Object.values(speciesNames) as string[];

/** Match species names by partial string (case-insensitive). Returns up to 25. */
export function searchSpecies(query: string): string[] {
  const q = query.toLowerCase();
  return allSpecies
    .filter((name) => name.toLowerCase().includes(q))
    .slice(0, 25);
}

// ── PokéAPI Types ────────────────────────────────────────────────────────────

interface PokeAPIPokemon {
  id: number;
  name: string;
  types: { type: { name: string } }[];
  evolution_chain: { url: string };
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

const POKEAPI = "https://pokeapi.co/api/v2";

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PokéAPI ${res.status}: ${url}`);
  return res.json();
}

// ── Type Emojis ──────────────────────────────────────────────────────────────

const TYPE_EMOJI: Record<string, string> = {
  normal: "⬜",
  fighting: "🥊",
  flying: "🕊️",
  poison: "☠️",
  ground: "🟫",
  rock: "🪨",
  bug: "🐛",
  ghost: "👻",
  steel: "🔩",
  fire: "🔥",
  water: "💧",
  grass: "🌿",
  electric: "⚡",
  psychic: "🔮",
  ice: "❄️",
  dragon: "🐉",
  dark: "🌑",
  fairy: "✨",
};

function formatTypes(types: { type: { name: string } }[]): string {
  return types
    .map((t) => TYPE_EMOJI[t.type.name] || t.type.name)
    .join(" ");
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
      if (details.min_level) method = `Lv ${details.min_level}`;
      else if (details.trigger.name === "use-item") method = details.item?.name || "Item";
      else if (details.trigger.name === "trade") method = "Trade";
      else if (details.trigger.name === "shed") method = "Shed";
      else method = details.trigger.name;

      if (method) method = ` (${method})`;
    }

    stages.push(name + method);
    current = current.evolves_to[0] || null;
  }

  return stages.join(" → ");
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
        ? `${e.name} (Lv ${e.level})`
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
  moves?: Record<string, string[]>;
}

export async function getDexEntry(
  name: string,
): Promise<DexEntry> {
  const poke = (await fetchJSON(
    `${POKEAPI}/pokemon/${name.toLowerCase()}`,
  )) as PokeAPIPokemon;

  const evo = (await fetchJSON(
    poke.evolution_chain.url,
  )) as PokeAPIEvolutionChain;

  return {
    name: poke.name.charAt(0).toUpperCase() + poke.name.slice(1),
    id: poke.id,
    types: formatTypes(poke.types),
    evolution: formatEvolution(evo.chain),
  };
}

export async function getDexMoves(
  name: string,
  versionGroup = "emerald",
): Promise<string> {
  const poke = await fetchJSON(
    `${POKEAPI}/pokemon/${name.toLowerCase()}`,
  );
  const byMethod = formatMoves(poke.moves, versionGroup);

  const sections: string[] = [];
  for (const [method, entries] of Object.entries(byMethod)) {
    sections.push(`**${method}:** ${entries.join(", ")}`);
  }

  return sections.join("\n");

