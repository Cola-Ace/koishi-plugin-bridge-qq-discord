import { Bot, Context, h } from "koishi";
import sharp from "sharp";
import { BasicType, Config } from "./config";
import { getBinary, logger, toDataUrl } from "./utils";

export interface BridgeRoute {
  from: BasicType;
  to: BasicType;
}

export interface BridgeMessageRecord {
  fromMessageId: string;
  fromPlatform: string;
  fromChannelId: string;
  fromSenderId: string;
  fromSenderName: string;
  toMessageId: string;
  toPlatform: string;
  toChannelId: string;
  onebotRealMessageId: string;
}

export function findBridgeRoutes(config: Config, platform: string, selfId: string, channelId: string): BridgeRoute[] {
  const routes: BridgeRoute[] = [];

  for (const constant of config.constant ?? []) {
    if (!constant.enable) continue;

    for (const from of constant.from) {
      if (from.platform !== platform || from.self_id !== selfId || from.channel_id !== channelId) continue;

      for (const to of constant.to) {
        routes.push({ from, to });
      }
    }
  }

  return routes;
}

export async function createBridgeMessageRecord(ctx: Context, record: BridgeMessageRecord) {
  const fromGuild = await ctx.database.get("channel", {
    id: record.fromChannelId,
  });
  const toGuild = await ctx.database.get("channel", {
    id: record.toChannelId,
  });

  const fromGuildId = fromGuild[0]?.guildId ?? "";
  const toGuildId = toGuild[0]?.guildId ?? "";
  if (!fromGuild[0]) logger.warn(`Failed to find guild for channel ${record.fromChannelId}`);
  if (!toGuild[0]) logger.warn(`Failed to find guild for channel ${record.toChannelId}`);

  await ctx.database.create("bridge_message", {
    timestamp: BigInt(Date.now()),
    from_message_id: record.fromMessageId,
    from_platform: record.fromPlatform,
    from_channel_id: record.fromChannelId,
    from_guild_id: fromGuildId,
    from_sender_id: record.fromSenderId,
    from_sender_name: record.fromSenderName,
    to_message_id: record.toMessageId,
    to_platform: record.toPlatform,
    to_channel_id: record.toChannelId,
    to_guild_id: toGuildId,
    onebot_real_message_id: record.onebotRealMessageId,
  });
}

export async function sendQQMessageWithRetry(qqbot: Bot, channelId: string, message: string, maxAttempts = 3): Promise<string[] | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await qqbot.sendMessage(channelId, message);
    } catch (error) {
      if (attempt >= maxAttempts) {
        logger.error(error);
        return null;
      }

      logger.info(`发送消息失败，正在重试... (${attempt}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return null;
}

export function getDiscordAvatarUrl(config: Config, avatarUrl: string | null, fallbackUrl: string): string {
  if (avatarUrl !== null) return fallbackUrl;

  let avatarColor = config.discord_default_avatar_color.toString();
  if (config.discord_default_avatar_color === 99) {
    avatarColor = Math.floor(Math.random() * 5).toString();
  }

  return `https://cdn.discordapp.com/embed/avatars/${avatarColor}.png`;
}

export async function createDiscordAvatarElement(ctx: Context, config: Config, avatar: string): Promise<any> {
  if (!config.show_discord_avatar) return "";
  if (config.file_processor !== "Koishi") return h.image(avatar);

  const [avatarBlob, avatarType, avatarError] = await getBinary(avatar, ctx.http);
  if (avatarError) {
    logger.error(avatarError);
    return null;
  }

  const avatarArrayBuffer = await avatarBlob.arrayBuffer();
  const resizedAvatar = await sharp(avatarArrayBuffer).resize(64, 64).toBuffer();

  return h.image(toDataUrl(resizedAvatar, avatarType));
}

export function findDiscordToQQBot(ctx: Context, config: Config, fromChannelId: string, toChannelId: string): Bot | null {
  for (const constant of config.constant ?? []) {
    if (!constant.enable) continue;

    for (const from of constant.from) {
      if (from.platform !== "discord" || from.channel_id !== fromChannelId) continue;

      for (const to of constant.to) {
        if (to.platform === "onebot" && to.channel_id === toChannelId) {
          return ctx.bots[`${to.platform}:${to.self_id}`];
        }
      }
    }
  }

  return null;
}
