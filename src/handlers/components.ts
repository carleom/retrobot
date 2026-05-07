import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

function multiplierButton(
  id: string,
  multiplier: number,
  messageMultiplier: number,
  enabled: boolean,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(id + "-" + multiplier.toString() + "-" + messageMultiplier)
    .setEmoji(multiplier == 10 ? "🔟" : multiplier.toString() + "\u20E3")
    .setDisabled(!enabled)
    .setStyle(
      messageMultiplier == multiplier
        ? ButtonStyle.Primary
        : ButtonStyle.Secondary,
    );
}

export function buildMultiplierRows(
  id: string,
  multiplier: number,
  enabledMultipliers: number[],
  enabled: boolean,
): ActionRowBuilder[] {
  const rows: ActionRowBuilder[] = [];
  const m = [...enabledMultipliers];
  if (m.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        m.splice(0, 5).map((n: number) => multiplierButton(id, n, multiplier, enabled)),
      ),
    );
  }
  if (m.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        m.map((n: number) => multiplierButton(id, n, multiplier, enabled)),
      ),
    );
  }
  return rows;
}
