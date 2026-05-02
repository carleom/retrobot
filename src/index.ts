import "dotenv/config";
import * as fs from "fs";
import Piscina from "piscina";
import * as path from "path";
import glob from "fast-glob";
import { request } from "undici";
import { v4 as uuid } from "uuid";
import * as shelljs from "shelljs";
import decompress from "decompress";
//import decompressTarxz from 'decompress-tarxz';
import decompressBzip2 from "decompress-bzip2";
import decompressTargz from "decompress-targz";
import decompressTarbz2 from "decompress-tarbz2";
import {
  toLower,
  endsWith,
  range,
  uniq,
  split,
  first,
  reduce,
  last,
} from "lodash";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  CacheType,
  Client,
  StringSelectMenuBuilder,
  ComponentType,
  MessageActionRowComponentBuilder,
  GatewayIntentBits,
  Interaction,
  Message,
  PermissionsBitField,
  TextChannel,
  BaseMessageOptions,
  SlashCommandBuilder,
} from "discord.js";

import { InputState } from "./util";
import { CoreType, emulate } from "./emulate";
import {
  setGameInfo,
  isGameId,
  getGameInfo,
  GameInfo,
  InputAssist,
  InputAssistSpeed,
  DirectionPress,
} from "./gameInfo";
import { MAX_WORKERS, RECORDING_FRAMERATE } from "./config";
import { generateLayout } from "./layouts";
import { executeMacro, MacroContext, Macro } from "./macros";
import {
  selectMoveMacro,
  useItemMacro,
  switchPokemonMacro,
  runMacro,
} from "./macros/emerald";
import { emulateParallel } from "./workerInterface";
import { Frame } from "./worker";
import encode from "image-encode";
import { arraysEqual, rgb565toRaw } from "./util";
import * as tmp from "tmp";
import ffmpeg from "fluent-ffmpeg";

const NES = ["nes"];
const SNES = ["sfc", "smc"];
const GB = ["gb", "gbc"];
const GBA = ["gba"];
const COMPRESSED = ["zip", "tar.gz", "tar.bz2", "tar.xz", "bz2"];

const ALL = [...NES, ...SNES, ...GB, ...GBA, ...COMPRESSED];

const pool = new Piscina({
  filename: path.resolve(__dirname, path.resolve(__dirname, "worker.ts")),
  name: "default",
  execArgv: ["-r", "ts-node/register"],
  ...(MAX_WORKERS == -1 ? {} : { maxThreads: MAX_WORKERS }),
});

/**
 * Encode frames from a macro execution into a GIF/MP4.
 * Simplified version of emulate.ts's encoding logic.
 */
const encodeMacroRecording = async (
  frames: Frame[],
  coreType: CoreType,
): Promise<{ recording: Buffer; recordingName: string }> => {
  const importantFrames: (Frame & { renderTime: number })[] = [];
  let lastFrame: Frame | undefined;
  let durationSinceFrame = 0;

  for (let i = 0; i < frames.length; i++) {
    if (i === 0 || durationSinceFrame >= 60 / RECORDING_FRAMERATE) {
      const currentFrame = frames[i];
      if (!arraysEqual(currentFrame.buffer, lastFrame?.buffer)) {
        importantFrames.push({ ...currentFrame, renderTime: i });
        lastFrame = currentFrame;
        durationSinceFrame = 0;
      }
    } else {
      durationSinceFrame++;
    }
  }

  if (lastFrame && !arraysEqual(last(frames)?.buffer, lastFrame?.buffer)) {
    importantFrames.push({ ...last(frames)!, renderTime: frames.length });
  }

  if (importantFrames.length === 0) {
    throw new Error("No frames to encode");
  }

  const tmpFrameDir = tmp.dirSync({ unsafeCleanup: true });
  const { width, height } = last(importantFrames)!;

  const images = await Promise.all(
    importantFrames.map((frame) => {
      const file = path.join(tmpFrameDir.name, `frame-${frame.renderTime}.bmp`);
      return new Promise<{ file: string; frameNumber: number }>((res, rej) =>
        fs.writeFile(
          file,
          Buffer.from(encode(rgb565toRaw(frame), [width, height], "bmp")),
          (err) => {
            if (err) rej(err);
            else res({ file, frameNumber: frame.renderTime });
          },
        ),
      );
    }),
  );

  let framesTxt = "";
  for (let i = 0; i < images.length; i++) {
    const current = images[i];
    framesTxt += `file '${current.file}'\n`;
    const next = images[i + 1];
    if (next) {
      framesTxt += `duration ${(next.frameNumber - current.frameNumber) / 60}\n`;
    }
  }
  framesTxt += `duration ${1 / 60}\n`;
  framesTxt += `file '${last(images)!.file}'\n`;
  framesTxt += `duration 5\n`;
  framesTxt += `file '${last(images)!.file}'\n`;

  const tmpFramesList = tmp.fileSync({ discardDescriptor: true });
  fs.writeFileSync(tmpFramesList.name, framesTxt);

  const { name: outputName } = tmp.fileSync();
  const gifOutput = `${outputName}.gif`;
  const mp4Output = `${outputName}.mp4`;
  let output = gifOutput;

  await new Promise<void>((res, rej) =>
    ffmpeg()
      .input(tmpFramesList.name)
      .addInputOption("-safe", "0")
      .inputFormat("concat")
      .addOption(
        "-filter_complex",
        `scale=2*iw:2*ih:flags=neighbor,split=2 [a][b]; [a] palettegen=${coreType === CoreType.SNES ? "stats_mode=diff" : ""} [pal]; [b] fifo [b]; [b] [pal] paletteuse=dither=bayer:bayer_scale=5`,
      )
      .output(gifOutput)
      .on("error", (err, stdout, stderr) => {
        console.error(stderr);
        rej(err);
      })
      .on("end", res)
      .run(),
  );

  if (fs.statSync(gifOutput).size > 8 * 1024 * 1024) {
    output = mp4Output;
    await new Promise<void>((res, rej) =>
      ffmpeg()
        .input(gifOutput)
        .output(mp4Output)
        .on("error", (err, stdout, stderr) => {
          console.error(stderr);
          rej(err);
        })
        .on("end", res)
        .run(),
    );
  }

  const recordingBuffer = fs.readFileSync(output);
  shelljs.rm("-rf", gifOutput);
  shelljs.rm("-rf", mp4Output);
  tmpFrameDir.removeCallback();
  tmpFramesList.removeCallback();

  return { recording: recordingBuffer, recordingName: path.basename(output) };
};

/** Build multiplier button rows for appending to generated layouts. */
const buildMultiplierRows = (
  id: string,
  multiplier: number,
  enabledMultipliers: number[],
  enabled: boolean,
): any[] => {
  const rows: any[] = [];
  const m = [...enabledMultipliers];
  if (m.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        m.splice(0, 5).map((n) => multiplierButton(id, n, multiplier, enabled)),
      ),
    );
  }
  if (m.length > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        m.map((n) => multiplierButton(id, n, multiplier, enabled)),
      ),
    );
  }
  return rows;
};

const main = async () => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await client.login(process.env.DISCORD_TOKEN);
  console.log("online");

  const command = new SlashCommandBuilder()
    .setName("settings")
    .setDescription(
      "Configure settings for the most recent game in the channel",
    );

  client.application.commands.set([command]);

  await unlockGames(client);

  client.on("messageCreate", async (message: Message) => {
    try {
      const attachment = message.attachments.find(
        (att) => !!ALL.find((ext) => endsWith(toLower(att.name), ext)),
      );
      if (
        !attachment ||
        !message.member.permissions.has(PermissionsBitField.Flags.Administrator)
      ) {
        return;
      }

      let game: string;
      let buffer: Buffer;
      let coreType: CoreType;

      if (COMPRESSED.find((ext) => endsWith(toLower(attachment.name), ext))) {
        const { body } = await request(attachment.url);

        const files = await decompress(
          Buffer.from(await body.arrayBuffer()),
          null,
          {
            plugins: [
              decompressTargz(),
              decompressTarbz2(),
              /* decompressTarxz(), */ decompressBzip2(),
            ],
          },
        );

        const entry = files.find((file) => detectCore(file.path));

        if (entry) {
          buffer = entry.data;
          coreType = detectCore(entry.path);
          game = path.parse(entry.path).base.replace(/[^0-9a-zA-Z_ \.]/gi, "");
        } else {
          return;
        }
      } else {
        coreType = detectCore(attachment.name);
        if (!coreType) {
          return;
        }

        const { body } = await request(attachment.url);
        buffer = Buffer.from(await body.arrayBuffer());
        game = attachment.name;
      }

      message.channel.sendTyping();

      const id = uuid().slice(0, 5);

      const data = path.resolve("data", id);
      shelljs.mkdir("-p", data);

      const gameFile = path.join(data, game);
      fs.writeFileSync(gameFile, buffer);

      const info: GameInfo = {
        game,
        coreType,
        guild: message.guildId,
        channelId: message.channelId,
        inputAssist: InputAssist.Autoplay,
        inputAssistSpeed: InputAssistSpeed.Normal,
        directionPress: DirectionPress.Release,
        multipliers: [3, 5, 10],
      };

      setGameInfo(id, info);

      const { recording, recordingName, state } = await emulate(
        pool,
        coreType,
        buffer,
        null,
        info,
        [],
      );

      const stateFile = path.join(data, "state.sav");
      fs.writeFileSync(stateFile, state);

      await message.channel.send({
        files: [
          {
            attachment: recording,
            name: recordingName,
          },
        ],
        components: buttons(coreType, id, 1, true, info.multipliers),
      });
    } catch (err) {
      console.error(err);
    }
  });

  client.on(
    "interactionCreate",
    async (interaction: Interaction<CacheType>) => {
      const isAdmin = interaction.memberPermissions.has(
        PermissionsBitField.Flags.Administrator,
      );

      try {
        if (interaction.isCommand() && isAdmin) {
          if (interaction.commandName == "settings") {
            const result = await findMostRecentGame(
              client,
              interaction.channelId,
            );

            if (result) {
              const { id } = result;
              const info = getGameInfo(id);

              await interaction.reply(`Settings for ${info.game}`);

              for (const setting of settingsForm(result.id, info)) {
                await interaction.channel.send(setting);
              }
            } else {
              await interaction.reply("Could not find game");
            }
          }
        }

        if (interaction.isStringSelectMenu() && isAdmin) {
          const [name, id, setting] = interaction.customId.split("-");

          if (name == "settings" && isGameId(id)) {
            const info = getGameInfo(id);

            if (setting == "input_assist") {
              const [value] = interaction.values;
              switch (value) {
                case InputAssist.Wait:
                  info.inputAssist = InputAssist.Wait;
                  break;

                case InputAssist.Off:
                  info.inputAssist = InputAssist.Off;
                  break;

                default:
                case InputAssist.Autoplay:
                  info.inputAssist = InputAssist.Autoplay;
                  break;
              }

              setGameInfo(id, info);
              interaction.update(inputAssistSetting(id, info));
            } else if (setting == "input_assist_speed") {
              const [value] = interaction.values;
              switch (value) {
                case InputAssistSpeed.Fast:
                  info.inputAssistSpeed = InputAssistSpeed.Fast;
                  break;

                case InputAssistSpeed.Slow:
                  info.inputAssistSpeed = InputAssistSpeed.Slow;
                  break;

                default:
                case InputAssistSpeed.Normal:
                  info.inputAssistSpeed = InputAssistSpeed.Normal;
                  break;
              }

              setGameInfo(id, info);
              interaction.update(inputAssistSpeedSetting(id, info));
            } else if (setting == "direction_press") {
              const [value] = interaction.values;
              switch (value) {
                case DirectionPress.Hold:
                  info.directionPress = DirectionPress.Hold;
                  break;

                default:
                case DirectionPress.Release:
                  info.directionPress = DirectionPress.Release;
                  break;
              }

              setGameInfo(id, info);
              interaction.update(directionPressSetting(id, info));
            }
          }
        }

        if (interaction.isButton()) {
          const player = client.guilds.cache
            .get(interaction.guildId)
            .members.cache.get(interaction.user.id);
          const message = interaction.message;

          const [id, button, multiplier] = interaction.customId.split("-");
          if (id == "settings") {
            const [_, id, setting, button] = interaction.customId.split("-");
            if (setting == "multiplier") {
              const info = getGameInfo(id);
              const num = parseInt(button);
              if (info.multipliers.includes(num)) {
                info.multipliers.splice(info.multipliers.indexOf(num), 1);
              } else {
                info.multipliers.push(num);
                info.multipliers.sort((a, b) => a - b);
              }
              setGameInfo(id, info);
              interaction.update(multiplierSetting(id, info));
            }
            return;
          }
          if (isGameId(id)) {
            const info = getGameInfo(id);

            // Parse customId — handle both old format (id-btn-mult) and macro format (id-macro-action-...)
            const parts = interaction.customId.split("-");
            const isMacro = parts[1] === "macro";
            const btn = isMacro ? parts.slice(1).join("-") : parts[1];
            const mult = isMacro ? "1" : parts[2];

            // Multiplier change (numeric button): update buttons with generateLayout
            if (isNumeric(btn)) {
              (async () => {
                try {
                  const state = fs.readFileSync(
                    path.resolve("data", id, "state.sav"),
                  );
                  const game = fs.readFileSync(
                    path.resolve("data", id, info.game),
                  );

                  const { wram } = await emulateParallel(
                    pool,
                    {
                      coreType: info.coreType,
                      game: new Uint8Array(game),
                      state: new Uint8Array(state),
                      frames: [],
                      gameHash: undefined,
                      stateHash: undefined,
                    },
                    { input: {}, duration: 1 },
                  );

                  const { rows } = generateLayout(wram, id, parseInt(btn));
                  const multiplierRows = buildMultiplierRows(
                    id,
                    parseInt(btn),
                    info.multipliers,
                    true,
                  );
                  await message.edit({
                    components: [...rows, ...multiplierRows],
                  });
                  await interaction.update({});
                } catch (err) {
                  console.error(err);
                }
              })();
              return;
            }

            // Macro button handling
            if (isMacro) {
              (async () => {
                try {
                  // macro-none: no-op placeholder
                  if (btn === "macro-none") {
                    await interaction.update({});
                    return;
                  }

                  // macro-manual: show raw controls (regenerate context-aware layout)
                  if (btn === "macro-manual") {
                    const state = fs.readFileSync(
                      path.resolve("data", id, "state.sav"),
                    );
                    const game = fs.readFileSync(
                      path.resolve("data", id, info.game),
                    );

                    const { wram } = await emulateParallel(
                      pool,
                      {
                        coreType: info.coreType,
                        game: new Uint8Array(game),
                        state: new Uint8Array(state),
                        frames: [],
                        gameHash: undefined,
                        stateHash: undefined,
                      },
                      { input: {}, duration: 1 },
                    );

                    const { rows } = generateLayout(wram, id, parseInt(mult));
                    const multiplierRows = buildMultiplierRows(
                      id,
                      parseInt(mult),
                      info.multipliers,
                      true,
                    );
                    await message.edit({
                      components: [...rows, ...multiplierRows],
                    });
                    await interaction.update({});
                    return;
                  }

                  // macro-switch: navigate to switch screen and show party layout
                  if (btn === "macro-switch") {
                    const stateBytes = fs.readFileSync(
                      path.resolve("data", id, "state.sav"),
                    );
                    const gameBytes = fs.readFileSync(
                      path.resolve("data", id, info.game),
                    );

                    // Navigate to the PKMN switch screen (first steps without selecting)
                    const navCtx: MacroContext = {
                      coreType: info.coreType,
                      game: new Uint8Array(gameBytes),
                      state: new Uint8Array(stateBytes),
                      frames: [],
                      wram: new Uint8Array(0),
                      av_info: {},
                    };
                    const navResult = await executeMacro(pool, navCtx, [
                      { input: { DOWN: true }, duration: 4 },
                      { input: {}, duration: 6 },
                      { input: { A: true }, duration: 4 },
                      { input: {}, duration: 20 },
                    ]);
                    fs.writeFileSync(
                      path.resolve("data", id, "state.sav"),
                      navResult.state,
                    );

                    const { rows } = generateLayout(navResult.wram, id, 1);
                    const multiplierRows = buildMultiplierRows(
                      id,
                      1,
                      info.multipliers,
                      true,
                    );
                    await message.edit({
                      components: [...rows, ...multiplierRows],
                    });
                    await interaction.update({});
                    return;
                  }

                  // Build the macro
                  let macro: Macro;
                  let macroLabel: string;

                  if (btn.startsWith("macro-move-")) {
                    const n = parseInt(btn.split("-")[2]);
                    macro = selectMoveMacro(n);
                    macroLabel = `Move ${n + 1}`;
                  } else if (btn.startsWith("macro-item-")) {
                    const n = parseInt(btn.split("-")[3]);
                    macro = useItemMacro(n);
                    macroLabel = `Item slot ${n}`;
                  } else if (btn.startsWith("macro-switch-")) {
                    const n = parseInt(btn.split("-")[2]);
                    macro = switchPokemonMacro(n);
                    macroLabel = `Switch to slot ${n}`;
                  } else if (btn === "macro-run") {
                    macro = runMacro();
                    macroLabel = "Run";
                  } else {
                    return;
                  }

                  // Execute macro
                  message.channel.sendTyping();

                  const gameBytes = fs.readFileSync(
                    path.resolve("data", id, info.game),
                  );
                  const stateBytes = fs.readFileSync(
                    path.resolve("data", id, "state.sav"),
                  );

                  const ctx: MacroContext = {
                    coreType: info.coreType,
                    game: new Uint8Array(gameBytes),
                    state: new Uint8Array(stateBytes),
                    frames: [],
                    wram: new Uint8Array(0),
                    av_info: {},
                  };

                  const result = await executeMacro(pool, ctx, macro);
                  const { recording, recordingName } =
                    await encodeMacroRecording(result.frames, info.coreType);

                  fs.writeFileSync(
                    path.resolve("data", id, "state.sav"),
                    result.state,
                  );

                  const { rows } = generateLayout(result.wram, id, 1);
                  const multiplierRows = buildMultiplierRows(
                    id,
                    1,
                    info.multipliers,
                    true,
                  );

                  await message.channel.send({
                    content: `${player.nickname || player.displayName}: ${macroLabel}`,
                    files: [
                      {
                        attachment: recording,
                        name: recordingName,
                      },
                    ],
                    components: [...rows, ...multiplierRows],
                  });
                } catch (err) {
                  console.error(err);
                }
              })();
              return;
            }

            // Raw input handling (existing flow, enhanced with generateLayout)
            (async () => {
              try {
                const playerInputs = range(0, parseInt(mult)).map(() =>
                  parseInput(btn),
                );

                if (playerInputs.length > 0) {
                  message.channel.sendTyping();

                  const game = fs.readFileSync(
                    path.resolve("data", id, info.game),
                  );
                  const oldState = fs.readFileSync(
                    path.resolve("data", id, "state.sav"),
                  );

                  const {
                    recording,
                    recordingName,
                    state: newState,
                    wram,
                  } = await emulate(
                    pool,
                    info.coreType,
                    game,
                    oldState,
                    info,
                    playerInputs,
                  );

                  fs.writeFileSync(
                    path.resolve("data", id, "state.sav"),
                    newState,
                  );

                  const { rows } = generateLayout(wram, id, 1);
                  const multiplierRows = buildMultiplierRows(
                    id,
                    1,
                    info.multipliers,
                    true,
                  );

                  await message.channel.send({
                    content: `${player.nickname || player.displayName} pressed ${joyToWord(first(playerInputs))}${parseInt(mult) > 1 ? " x" + mult : ""}...`,
                    files: [
                      {
                        attachment: recording,
                        name: recordingName,
                      },
                    ],
                    components: [...rows, ...multiplierRows],
                  });
                }
              } catch (err) {
                console.error(err);
              }
            })();
          } else {
            await interaction.update({
              content: "Cannot find save for this game",
            });
          }
        }
      } catch (err) {
        console.error(err);
      }
    },
  );
};

const parseInput = (input: string) => {
  switch (toLower(input)) {
    case "a":
      return { A: true };
    case "b":
      return { B: true };
    case "x":
      return { X: true };
    case "y":
      return { Y: true };
    case "l":
      return { L: true };
    case "r":
      return { R: true };
    case "up":
      return { UP: true };
    case "down":
      return { DOWN: true };
    case "left":
      return { LEFT: true };
    case "right":
      return { RIGHT: true };
    case "select":
      return { SELECT: true };
    case "start":
      return { START: true };
  }
};

const isNumeric = (value) => {
  return /^\d+$/.test(value);
};

const multiplierButton = (
  id: string,
  multiplier: number,
  messageMultiplier: number,
  enabled: boolean,
) => {
  return new ButtonBuilder()
    .setCustomId(id + "-" + multiplier.toString() + "-" + messageMultiplier)
    .setEmoji(multiplier == 10 ? "🔟" : multiplier.toString() + "\u20E3") // Combining Enclosing Keycap, turns a digit into an emoji
    .setDisabled(!enabled)
    .setStyle(
      messageMultiplier == multiplier
        ? ButtonStyle.Primary
        : ButtonStyle.Secondary,
    );
};

const buttons = (
  coreType: CoreType,
  id: string,
  multiplier: number = 1,
  enabled: boolean = true,
  enabledMultipliers: Array<number>,
  highlight?: string,
) => {
  const a = new ButtonBuilder()
    .setCustomId(id + "-" + "a" + "-" + multiplier)
    .setEmoji("🇦")
    .setDisabled(!enabled)
    .setStyle(highlight == "a" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const b = new ButtonBuilder()
    .setCustomId(id + "-" + "b" + "-" + multiplier)
    .setEmoji("🇧")
    .setDisabled(!enabled)
    .setStyle(highlight == "b" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const x = new ButtonBuilder()
    .setCustomId(id + "-" + "x" + "-" + multiplier)
    .setEmoji("🇽")
    .setDisabled(!enabled)
    .setStyle(highlight == "x" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const y = new ButtonBuilder()
    .setCustomId(id + "-" + "y" + "-" + multiplier)
    .setEmoji("🇾")
    .setDisabled(!enabled)
    .setStyle(highlight == "y" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const l = new ButtonBuilder()
    .setCustomId(id + "-" + "l" + "-" + multiplier)
    .setEmoji("🇱")
    .setDisabled(!enabled)
    .setStyle(highlight == "l" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const r = new ButtonBuilder()
    .setCustomId(id + "-" + "r" + "-" + multiplier)
    .setEmoji("🇷")
    .setDisabled(!enabled)
    .setStyle(highlight == "r" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const up = new ButtonBuilder()
    .setCustomId(id + "-" + "up" + "-" + multiplier)
    .setEmoji("⬆️")
    .setDisabled(!enabled)
    .setStyle(highlight == "up" ? ButtonStyle.Success : ButtonStyle.Secondary);

  const down = new ButtonBuilder()
    .setCustomId(id + "-" + "down" + "-" + multiplier)
    .setEmoji("⬇️")
    .setDisabled(!enabled)
    .setStyle(
      highlight == "down" ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const left = new ButtonBuilder()
    .setCustomId(id + "-" + "left" + "-" + multiplier)
    .setEmoji("⬅️")
    .setDisabled(!enabled)
    .setStyle(
      highlight == "left" ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const right = new ButtonBuilder()
    .setCustomId(id + "-" + "right" + "-" + multiplier)
    .setEmoji("➡️")
    .setDisabled(!enabled)
    .setStyle(
      highlight == "right" ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const select = new ButtonBuilder()
    .setCustomId(id + "-" + "select" + "-" + multiplier)
    .setEmoji("⏺️")
    .setDisabled(!enabled)
    .setStyle(
      highlight == "select" ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const start = new ButtonBuilder()
    .setCustomId(id + "-" + "start" + "-" + multiplier)
    .setEmoji("▶️")
    .setDisabled(!enabled)
    .setStyle(
      highlight == "start" ? ButtonStyle.Success : ButtonStyle.Secondary,
    );

  const multiplierRows = [];

  enabledMultipliers = [...enabledMultipliers];

  if (enabledMultipliers.length > 0) {
    multiplierRows.push(
      new ActionRowBuilder().addComponents(
        enabledMultipliers
          .splice(0, 5)
          .map((n) => multiplierButton(id, n, multiplier, enabled)),
      ),
    );
  }

  if (enabledMultipliers.length > 0) {
    multiplierRows.push(
      new ActionRowBuilder().addComponents(
        enabledMultipliers.map((n) =>
          multiplierButton(id, n, multiplier, enabled),
        ),
      ),
    );
  }

  switch (coreType) {
    case CoreType.GB:
      return [
        new ActionRowBuilder().addComponents(a, b, select, start),
        new ActionRowBuilder().addComponents(up, down, left, right),
        ...multiplierRows,
      ] as any[];

    case CoreType.GBA:
      return [
        new ActionRowBuilder().addComponents(a, b),
        new ActionRowBuilder().addComponents(up, down, left, right),
        new ActionRowBuilder().addComponents(select, start, l, r),
        ...multiplierRows,
      ] as any[];

    case CoreType.NES:
      return [
        new ActionRowBuilder().addComponents(a, b, select, start),
        new ActionRowBuilder().addComponents(up, down, left, right),
        ...multiplierRows,
      ] as any[];

    case CoreType.SNES:
      return [
        new ActionRowBuilder().addComponents(a, b, x, y),
        new ActionRowBuilder().addComponents(up, down, left, right),
        new ActionRowBuilder().addComponents(select, start, l, r),
        ...multiplierRows,
      ] as any[];
  }

  return [];
};

const inputAssistSetting = (id, info: GameInfo) => ({
  content: "Input Assist",
  components: [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`settings-${id}-input_assist`)
        .setOptions(
          {
            label: "Autoplay",
            value: InputAssist.Autoplay,
            default: info.inputAssist == InputAssist.Autoplay,
          },
          {
            label: "Wait",
            value: InputAssist.Wait,
            default: info.inputAssist == InputAssist.Wait,
          },
          {
            label: "Off",
            value: InputAssist.Off,
            default: info.inputAssist == InputAssist.Off,
          },
        ),
    ),
  ],
});

const inputAssistSpeedSetting = (id, info: GameInfo) => ({
  content: "Input Assist Speed",
  components: [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`settings-${id}-input_assist_speed`)
        .setOptions(
          {
            label: "Fast",
            value: InputAssistSpeed.Fast,
            default: info.inputAssistSpeed == InputAssistSpeed.Fast,
          },
          {
            label: "Normal",
            value: InputAssistSpeed.Normal,
            default: info.inputAssistSpeed == InputAssistSpeed.Normal,
          },
          {
            label: "Slow",
            value: InputAssistSpeed.Slow,
            default: info.inputAssistSpeed == InputAssistSpeed.Slow,
          },
        ),
    ),
  ],
});

const directionPressSetting = (id, info: GameInfo) => ({
  content: "Directional Press",
  components: [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`settings-${id}-direction_press`)
        .setOptions(
          {
            label: "Release",
            value: DirectionPress.Release,
            default: info.directionPress == DirectionPress.Release,
          },
          {
            label: "Hold",
            value: DirectionPress.Hold,
            default: info.directionPress == DirectionPress.Hold,
          },
        ),
    ),
  ],
});

const multiplierSetting = (id, info: GameInfo) => ({
  content: "Enabled Multipliers",
  components: [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      multiplierButton(`settings-${id}-multiplier`, 1, 0, true).setStyle(
        info.multipliers.includes(1)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 2, 0, true).setStyle(
        info.multipliers.includes(2)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 3, 0, true).setStyle(
        info.multipliers.includes(3)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 4, 0, true).setStyle(
        info.multipliers.includes(4)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 5, 0, true).setStyle(
        info.multipliers.includes(5)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      multiplierButton(`settings-${id}-multiplier`, 6, 0, true).setStyle(
        info.multipliers.includes(6)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 7, 0, true).setStyle(
        info.multipliers.includes(7)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 8, 0, true).setStyle(
        info.multipliers.includes(8)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 9, 0, true).setStyle(
        info.multipliers.includes(9)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
      multiplierButton(`settings-${id}-multiplier`, 10, 0, true).setStyle(
        info.multipliers.includes(10)
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      ),
    ),
  ],
});

const settingsForm = (id: string, info: GameInfo): BaseMessageOptions[] => [
  inputAssistSetting(id, info),
  inputAssistSpeedSetting(id, info),
  directionPressSetting(id, info),
  multiplierSetting(id, info),
];

const joyToWord = (input: InputState) => {
  if (input.A) return "A";
  if (input.B) return "B";
  if (input.X) return "X";
  if (input.Y) return "Y";
  if (input.L) return "L";
  if (input.R) return "R";
  if (input.UP) return "Up";
  if (input.DOWN) return "Down";
  if (input.LEFT) return "Left";
  if (input.RIGHT) return "Right";
  if (input.START) return "Start";
  if (input.SELECT) return "Select";
};

const findMostRecentGame = async (
  client: Client,
  channelId: string,
): Promise<{ id: string; message: Message; channel: TextChannel }> => {
  const channel = (await client.channels.fetch(channelId)) as TextChannel;
  const messages = await channel.messages.fetch({ limit: 100 });

  for (const message of messages.values()) {
    if (message.author.id == client.user.id) {
      const button = message.components
        .find((component) => component.type == ComponentType.ActionRow)
        ?.components?.find(
          (component) => component.type == ComponentType.Button,
        );

      if (button) {
        const id = first(split(button?.customId, "-"));

        if (isGameId(id)) {
          return { id, message, channel };
        }
      }
    }
  }

  return null;
};

const unlockGames = async (client: Client) => {
  const infoIds = (await glob("data/*/info.json")).map((dir) =>
    dir.split(/[\\\/]/).at(-2),
  );
  const infos = reduce(
    infoIds,
    (acc, id) => ({
      ...acc,
      [id]: getGameInfo(id),
    }),
    {} as { [id: string]: GameInfo },
  );

  const channelIds: string[] = uniq(
    reduce(infos, (acc, info) => [...acc, info.channelId], []),
  );

  for (const channelId of channelIds) {
    try {
      const result = await findMostRecentGame(client, channelId);
      if (result) {
        const { id, message, channel } = result;
        const info = infos[id];

        if (info) {
          console.log(`unlocking ${info.game} in ${channel.name}`);
          await message.edit({
            components: buttons(info.coreType, id, 1, true, info.multipliers),
          });
        }
      }
    } catch (err) {
      console.log(err);
    }
  }
};

const detectCore = (filename: string): CoreType => {
  if (NES.find((ext) => endsWith(toLower(filename), ext))) return CoreType.NES;

  if (SNES.find((ext) => endsWith(toLower(filename), ext)))
    return CoreType.SNES;

  if (GB.find((ext) => endsWith(toLower(filename), ext))) return CoreType.GB;

  if (GBA.find((ext) => endsWith(toLower(filename), ext))) return CoreType.GBA;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
