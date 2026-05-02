/**
 * Dynamic Layout Generator — context-aware Discord button rows.
 *
 * Takes a Scene + WRAM snapshot → returns ActionRowBuilder[] for Discord.
 * Uses emerald_lookups.json to resolve move/item/species IDs to names.
 */

import * as fs from "fs";
import * as path from "path";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { Scene } from "./scenes";
import { EmeraldSceneDetector } from "./scenes/emerald";
import { readU8, readU16, readU32 } from "./scenes";

// ── Lookup Tables ────────────────────────────────────────────────────────────

interface Lookups {
  moves: Record<string, string>;
  items: Record<string, string>;
  species: Record<string, string>;
}

const lookupsPath = path.join(
  __dirname,
  "..",
  "config",
  "emerald_lookups.json",
);
const lookups: Lookups = JSON.parse(fs.readFileSync(lookupsPath, "utf-8"));

// Load custom emoji IDs (set by /upload_emojis command)
const emojiIdsPath = path.join(__dirname, "..", "config", "emoji_ids.json");
let emojiIds: Record<string, string> = {};
try {
  emojiIds = JSON.parse(fs.readFileSync(emojiIdsPath, "utf-8"));
} catch (_) {}

// Load button layout config
const layoutConfig = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "config", "layouts.json"),
    "utf-8",
  ),
);
const buttonStyles: Record<string, { emoji: string; style: string }> =
  layoutConfig.buttonStyles;

function styleFrom(s: string): ButtonStyle {
  return s === "primary"
    ? ButtonStyle.Primary
    : s === "danger"
      ? ButtonStyle.Danger
      : s === "success"
        ? ButtonStyle.Success
        : ButtonStyle.Secondary;
}

const moveEmojis: Record<string, string> = {};
for (const entry of Object.entries((lookups as any).moveEmojis || {})) {
  moveEmojis[entry[0]] = entry[1] as string;
}

function moveName(id: number): string {
  return lookups.moves[String(id)] ?? `MOVE_${id}`;
}

function itemName(id: number): string {
  return lookups.items[String(id)] ?? `ITEM_${id}`;
}

function speciesName(id: number): string {
  return lookups.species[String(id)] ?? `PKMN_${id}`;
}

// ── Memory Addresses ─────────────────────────────────────────────────────────

const ADDR = {
  gPlayerParty: 0x020244ec,
  gActiveBattler: 0x02024064,
  encryptionKey: 0x02024b00,
  // SaveBlock1 pocket item slot arrays (direct addresses — no pointer chasing needed)
  bagItems: 0x02025f60, // 30 slots
  bagKeyItems: 0x02025fd8, // 30 slots
  bagBalls: 0x02026050, // 16 slots
  bagTmsHms: 0x02026090, // 64 slots
  bagBerries: 0x02026190, // 46 slots
} as const;

const POKEMON_SIZE = 0x64; // bytes per party Pokemon

/** Pocket capacities. */
const POCKET_CAPS: Record<number, number> = {
  0: 30, // Items
  1: 16, // Balls
  2: 64, // TMs/HMs
  3: 46, // Berries
  4: 30, // Key Items
};

/** Pocket start addresses. */
const POCKET_ADDRS: Record<number, number> = {
  0: ADDR.bagItems,
  1: ADDR.bagBalls,
  2: ADDR.bagTmsHms,
  3: ADDR.bagBerries,
  4: ADDR.bagKeyItems,
};

// ── Pokémon Data Reader ──────────────────────────────────────────────────────

interface PartyPokemon {
  species: number;
  moves: number[];
  pp: number[];
  level: number;
  currentHp: number;
  maxHp: number;
  /** The party slot index (0-5). */
  slotIndex: number;
}

/**
 * Substuct ordering table (personality % 24).
 * G=Growth(species/heldItem/exp), A=Attacks(moves/PP), E=EVs, M=Misc.
 * Source: Bulbapedia Gen III Pokemon data substructures.
 */
const SUBSTRUCT_ORDER = [
  "GAEM",
  "GAME",
  "GEAM",
  "GEMA",
  "GMAE",
  "GMEA",
  "AGEM",
  "AGME",
  "AEGM",
  "AEMG",
  "AMGE",
  "AMEG",
  "EGAM",
  "EGMA",
  "EAGM",
  "EAMG",
  "EMGA",
  "EMAG",
  "MGAE",
  "MGEA",
  "MAGE",
  "MAEG",
  "MEGA",
  "MEAG",
];

/** Read party Pokemon at a given slot index (0-5). */
function readPartyPokemon(wram: Uint8Array, slotIndex: number): PartyPokemon {
  const base = ADDR.gPlayerParty + slotIndex * POKEMON_SIZE;

  // Read unencrypted metadata for the XOR key
  const personality = readU32(wram, base + 0x00) >>> 0;
  const otId = readU32(wram, base + 0x04) >>> 0;
  const key = (personality ^ otId) >>> 0;

  // Decrypt all 12 u32s in the secure region (0x20-0x4F)
  const d: number[] = [];
  for (let o = 0x20; o < 0x50; o += 4) {
    d.push(((readU32(wram, base + o) >>> 0) ^ key) >>> 0);
  }

  // Determine substruct ordering
  const order = SUBSTRUCT_ORDER[personality % 24];
  const gIdx = order.indexOf("G") * 3; // Growth = species substruct (3 u32s per slot)
  const aIdx = order.indexOf("A") * 3; // Attacks = moves substruct (3 u32s per slot)

  // Growth substruct: u32[0]=species|heldItem, u32[1]=experience, u32[2]=ppBonuses|friendship
  const species = d[gIdx] & 0xffff;

  // Attacks substruct: u32[0]=move0|move1, u32[1]=move2|move3, u32[2]=pp0|pp1|pp2|pp3
  const move0 = d[aIdx] & 0xffff;
  const move1 = (d[aIdx] >> 16) & 0xffff;
  const move2 = d[aIdx + 1] & 0xffff;
  const move3 = (d[aIdx + 1] >> 16) & 0xffff;
  const pp0 = d[aIdx + 2] & 0xff;
  const pp1 = (d[aIdx + 2] >> 8) & 0xff;
  const pp2 = (d[aIdx + 2] >> 16) & 0xff;
  const pp3 = (d[aIdx + 2] >> 24) & 0xff;

  return {
    species,
    moves: [move0, move1, move2, move3],
    pp: [pp0, pp1, pp2, pp3],
    level: readU8(wram, base + 0x54),
    currentHp: readU16(wram, base + 0x56),
    maxHp: readU16(wram, base + 0x58),
    slotIndex,
  };
}

/** Get the player's active party Pokemon (first non-egg battler). */
function getActivePokemon(wram: Uint8Array): PartyPokemon {
  // For now, use party slot 0 (the lead). In double battles, the player's
  // second active battler would be in a different slot, but mapping battler
  // IDs to party slots requires more complex logic deferred to M6.
  return readPartyPokemon(wram, 0);
}

// ── Bag Data Reader ──────────────────────────────────────────────────────────

interface BagItem {
  itemId: number;
  quantity: number;
  slotIndex: number;
}

/** Find quantity of a specific item ID in a bag pocket. Returns 0 if not found. */
function findBagItem(
  wram: Uint8Array,
  pocketIndex: number,
  itemId: number,
): number {
  const items = readBagPocket(wram, pocketIndex);
  const found = items.find((i) => i.itemId === itemId);
  return found ? found.quantity : 0;
}

/** Read all items from a bag pocket. Returns non-empty slots only. */
function readBagPocket(wram: Uint8Array, pocketIndex: number): BagItem[] {
  const startAddr = POCKET_ADDRS[pocketIndex];
  const capacity = POCKET_CAPS[pocketIndex];
  if (!startAddr || !capacity) return [];

  const encryptionKey = readU32(wram, ADDR.encryptionKey);
  const items: BagItem[] = [];

  for (let i = 0; i < capacity; i++) {
    const slotAddr = startAddr + i * 4;
    const itemId = readU16(wram, slotAddr);
    const encryptedQty = readU16(wram, slotAddr + 2);
    const quantity = encryptedQty ^ (encryptionKey & 0xffff);

    // Empty slot: itemId == 0 or quantity == 0 (after XOR in compacted bags)
    if (itemId !== 0 && quantity !== 0) {
      items.push({ itemId, quantity, slotIndex: i });
    }
  }

  return items;
}

// ── Button Builders ──────────────────────────────────────────────────────────

type ButtonOrRow = ButtonBuilder | ActionRowBuilder;

function btn(
  customId: string,
  label: string,
  style: ButtonStyle = ButtonStyle.Secondary,
  disabled = false,
  emoji?: string,
): ButtonBuilder {
  const b = new ButtonBuilder()
    .setCustomId(customId)
    .setStyle(style)
    .setDisabled(disabled);
  if (label) b.setLabel(label);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function row(...buttons: ButtonBuilder[]): ActionRowBuilder {
  return new ActionRowBuilder().addComponents(...buttons);
}

// ── Layout Generator ─────────────────────────────────────────────────────────

export interface LayoutResult {
  rows: ActionRowBuilder[];
  scene: Scene;
}

const sceneDetector = new EmeraldSceneDetector();

/** Counter for unique placeholder button IDs (Discord requires unique custom IDs). */
let _noneCounter = 0;
function noneId(gameId: string): string {
  return _noneCounter++ + "-" + gameId + "-macro-none";
}

/**
 * Generate Discord button rows for the current game state.
 *
 * @param wram - EWRAM buffer from the emulator.
 * @param gameId - Unique game instance ID (used in button custom IDs).
 * @param multiplier - Current input multiplier.
 * @returns LayoutResult with rows and the detected scene.
 */
export function generateLayout(
  wram: Uint8Array,
  gameId: string,
  multiplier: number = 1,
): LayoutResult {
  _noneCounter = 0;
  let scene = sceneDetector.detect(wram);

  // If battle has ended (gBattleOutcome != 0), force overworld
  if (scene !== Scene.OVERWORLD) {
    const outcome = readU8(wram, 0x0202433a);
    if (outcome !== 0) {
      scene = Scene.OVERWORLD;
    }
  }

  switch (scene) {
    case Scene.BATTLE_FIGHT:
      return { rows: buildBattleFight(wram, gameId, multiplier), scene };
    case Scene.BATTLE_MOVE_SELECT:
      return { rows: buildMoveSelect(wram, gameId), scene };
    case Scene.BATTLE_BAG_POCKET:
      return { rows: buildBagPocket(wram, gameId), scene };
    case Scene.BATTLE_PKMN_SWITCH:
      return { rows: buildPkmnSwitch(wram, gameId), scene };
    case Scene.OVERWORLD:
    case Scene.TEXTBOX:
    case Scene.UNKNOWN:
    default:
      return { rows: buildOverworld(gameId, multiplier), scene };
  }
}

// ── Overworld Layout ─────────────────────────────────────────────────────────

export function buildOverworld(
  gameId: string,
  multiplier: number,
): ActionRowBuilder[] {
  const m = multiplier;
  return [
    row(
      btn(`${gameId}-up-${m}`, "", ButtonStyle.Secondary, false, "⬆️"),
      btn(`${gameId}-down-${m}`, "", ButtonStyle.Secondary, false, "⬇️"),
      btn(`${gameId}-left-${m}`, "", ButtonStyle.Secondary, false, "⬅️"),
      btn(`${gameId}-right-${m}`, "", ButtonStyle.Secondary, false, "➡️"),
    ),
    row(
      btn(`${gameId}-a-${m}`, "", ButtonStyle.Success, false, "🅰️"),
      btn(`${gameId}-b-${m}`, "", ButtonStyle.Danger, false, "🅱️"),
      btn(`${gameId}-start-${m}`, "", ButtonStyle.Secondary, false, "▶️"),
    ),
  ];
}

// ── Battle Fight Layout (main menu: FIGHT / BAG / PKMN / RUN) ────────────────

function buildBattleFight(
  wram: Uint8Array,
  gameId: string,
  multiplier: number,
): ActionRowBuilder[] {
  const isTrainer = sceneDetector.isTrainerBattle(wram);
  const activePkmn = getActivePokemon(wram);
  const rows: ActionRowBuilder[] = [];

  // Row 1: Moves (max 4, with PP)
  const moveButtons: ButtonBuilder[] = [];
  for (let i = 0; i < 4; i++) {
    const moveId = activePkmn.moves[i];
    const pp = activePkmn.pp[i];
    const name = moveName(moveId);
    const hasMove = moveId !== 0;
    const hasPp = pp > 0;

    const emoji = moveEmojis[String(moveId)] || "";
    const label = hasMove ? `${emoji} ${name} (${pp})` : "—";
    const disabled = !hasMove || !hasPp;

    moveButtons.push(
      btn(
        `${gameId}-macro-move-${i}`,
        label,
        disabled ? ButtonStyle.Secondary : ButtonStyle.Primary,
        disabled,
      ),
    );
  }
  rows.push(row(...moveButtons));

  // Row 2: Poké Balls (wild only — hidden in trainer battles)
  if (!isTrainer) {
    const ballIds = [4, 3, 2]; // Poké Ball, Great Ball, Ultra Ball
    const ballButtons = ballIds.map((id) => {
      const qty = findBagItem(wram, 1, id);
      const name = itemName(id);
      const ballEmoji =
        emojiIds[name.toLowerCase().replace(/[^a-z]/g, "")] || undefined;
      return btn(
        `${gameId}-macro-item-1-${id}`,
        name,
        ButtonStyle.Secondary,
        qty === 0,
        ballEmoji,
      );
    });
    rows.push(row(...ballButtons));
  }

  // Row 3 (or 2 in trainer): Healing items
  const healIds = [13, 22, 21, 20, 19]; // Potion, Super Potion, Hyper Potion, Max Potion, Full Restore
  const itemButtons = healIds.map((id) => {
    const qty = findBagItem(wram, 0, id);
    const name = itemName(id);
    const healEmoji =
      emojiIds[name.toLowerCase().replace(/[^a-z]/g, "")] || undefined;
    return btn(
      `${gameId}-macro-item-0-${id}`,
      name,
      ButtonStyle.Secondary,
      qty === 0,
      healEmoji,
    );
  });
  rows.push(row(...itemButtons));

  // Row 4 (or 3 in trainer): Switch, Manual, Run
  const actionButtons: ButtonBuilder[] = [
    btn(`${gameId}-macro-switch`, "🔄 Switch", ButtonStyle.Secondary),
    btn(`${gameId}-macro-manual`, "🎮 Manual", ButtonStyle.Secondary),
  ];

  // Run only available in wild battles
  if (!isTrainer) {
    actionButtons.push(
      btn(`${gameId}-macro-run`, "🏃 Run", ButtonStyle.Danger),
    );
  }

  rows.push(row(...actionButtons));

  return rows;
}

// ── Move Select Layout ───────────────────────────────────────────────────────

function buildMoveSelect(wram: Uint8Array, gameId: string): ActionRowBuilder[] {
  const rows: ActionRowBuilder[] = [];

  // Row 1: 4 move buttons (name only, no PP — the game shows PP on-screen)
  const moveButtons: ButtonBuilder[] = [];
  for (let i = 0; i < 4; i++) {
    const moveId = activePkmn.moves[i];
    const pp = activePkmn.pp[i];
    const name = moveName(moveId);
    const hasMove = moveId !== 0;
    const hasPp = pp > 0;

    moveButtons.push(
      btn(
        `${gameId}-macro-move-${i}`,
        hasMove ? `${moveEmojis[String(moveId)] || ""} ${name}` : "—",
        hasMove && hasPp ? ButtonStyle.Primary : ButtonStyle.Secondary,
        !hasMove || !hasPp,
      ),
    );
  }
  rows.push(row(...moveButtons));

  // Row 2: Back to Fight Menu
  rows.push(row(btn(`${gameId}-b-1`, "⬅️ Back", ButtonStyle.Secondary)));

  return rows;
}

// ── Bag Pocket Layout ────────────────────────────────────────────────────────

function buildBagPocket(wram: Uint8Array, gameId: string): ActionRowBuilder[] {
  // Determine which pocket we're in from gChosenActionByBattler context.
  // For now, default to ITEMS_POCKET (0). The actual pocket context needs
  // additional memory reads or state tracking — deferred to M5 wiring.
  const items = readBagPocket(wram, 0).slice(0, 4);

  const rows: ActionRowBuilder[] = [];

  // Row 1: Up to 4 items
  const itemButtons = items.map((item) => {
    const name = itemName(item.itemId);
    return btn(
      `${gameId}-macro-item-0-${item.slotIndex}`,
      `${name} x${item.quantity}`,
      ButtonStyle.Primary,
      false,
    );
  });
  while (itemButtons.length < 4) {
    itemButtons.push(btn(noneId(gameId), "—", ButtonStyle.Secondary, true));
  }
  rows.push(row(...itemButtons));

  // Row 2: Back, Use
  rows.push(row(btn(`${gameId}-b-1`, "⬅️ Back", ButtonStyle.Secondary)));

  return rows;
}

// ── Pokémon Switch Layout ────────────────────────────────────────────────────

export function buildPkmnSwitch(wram: Uint8Array, gameId: string): ActionRowBuilder[] {
  const rows: ActionRowBuilder[] = [];

  // Show up to 6 party Pokemon, 3 per row
  for (let rowIdx = 0; rowIdx < 2; rowIdx++) {
    const buttons: ButtonBuilder[] = [];
    for (let col = 0; col < 3; col++) {
      const slotIdx = rowIdx * 3 + col;
      const pkmn = readPartyPokemon(wram, slotIdx);
      if (pkmn.species === 0) {
        // Empty slot
        buttons.push(
          btn(noneId(gameId), "— empty —", ButtonStyle.Secondary, true),
        );
      } else if (pkmn.currentHp === 0) {
        // Fainted — can't switch to it
        const name = speciesName(pkmn.species);
        buttons.push(
          btn(
            `${gameId}-macro-switch-${slotIdx}`,
            `${name} (FNT)`,
            ButtonStyle.Secondary,
            true,
          ),
        );
      } else {
        const name = speciesName(pkmn.species);
        buttons.push(
          btn(
            `${gameId}-macro-switch-${slotIdx}`,
            `${name} ${pkmn.currentHp}/${pkmn.maxHp}`,
            ButtonStyle.Primary,
            false,
          ),
        );
      }
    }
    rows.push(row(...buttons));
  }

  // Back button
  rows.push(
    row(btn(`${gameId}-b-1`, "⬅️ Back to Battle", ButtonStyle.Secondary)),
  );

  return rows;
}

// ── Re-export for convenience ────────────────────────────────────────────────

export { moveName, itemName, speciesName, readPartyPokemon, readBagPocket };
export type { PartyPokemon, BagItem };
