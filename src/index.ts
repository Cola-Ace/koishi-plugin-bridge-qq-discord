// @ts-nocheck
import { Context, h, Session } from "koishi";
import { } from "koishi-plugin-adapter-onebot";
import { Config, BasicType } from "./config";

export * from "./config";
import { MessageBody } from "./types";
import { createBridgeMessageRecord, createDiscordAvatarElement, findBridgeRoutes, getDiscordAvatarUrl, sendQQMessageWithRetry } from "./bridge";
import { convertMsTimestampToISO8601, logger, BlacklistDetector, generateMessageBody } from "./utils";
import ProcessorQQ from "./qq";
import { getWebhook } from "./discord/webhook";
import ProcessorDiscord from "./discord";
import onDiscordMessageDeleted from "./discord/message/delete";
import onDiscordMessageUpdated from "./discord/message/update";

export const name = "bridge-qq-discord";

export const inject = ["database"];

function getInitialNickname(session: Session, sender) {
  if (sender.isBot) return sender.name;

  return "member" in session.event ? session.event.member.nick : sender.name;
}

function shouldIgnoreMessage(session: Session, sender) {
  if (!sender) return true;
  if (sender.id === session.bot.selfId) return true;

  const pattern = /\[QQ:\d+\]/;
  return pattern.test(sender.name ?? "[QQ:10000]");
}

async function appendQQQuoteEmbed(
  ctx: Context,
  dcBot,
  messageBody: MessageBody,
  messageData,
  elements: h[],
  channelId: string,
  selfId: string,
  blacklist: BlacklistDetector,
) {
  if (!("quote" in messageData)) return true;

  // 不同平台之间回复 & 同平台之间回复
  const diffPlatformQuoteMessage = await ctx.database.get("bridge_message", {
    to_message_id: messageData.quote.id,
    to_channel_id: channelId,
  });
  const samePlatformQuoteMessage = await ctx.database.get("bridge_message", {
    from_message_id: messageData.quote.id,
    from_channel_id: channelId,
  });

  const quoteMessage = {
    type: diffPlatformQuoteMessage.length !== 0 ? "diff" : "same",
    data: diffPlatformQuoteMessage.length !== 0 ? diffPlatformQuoteMessage : samePlatformQuoteMessage,
  };

  if (quoteMessage.data.length === 0) return true;

  let message = "";
  let image = {};
  let source = "";

  switch (quoteMessage.type) {
    case "same": {
      source = "to";
      break;
    }
    case "diff": {
      source = "from";
      // 删除 QQ 回复时自动带上的 @
      if (elements[0]?.type === "at" && elements[0].attrs.id === selfId) {
        elements.shift();
      }
      break;
    }
    default: {
      break;
    }
  }
  if (source === "") return false;

  const dcMessage = await dcBot.getMessage(quoteMessage.data[0][`${source}_channel_id`], quoteMessage.data[0][`${source}_message_id`]);
  if (source === "from") {
    messageBody.text += `<@${dcMessage.user.id}>`;
    messageBody.validElement = true;
  }

  for (const element of dcMessage.elements) {
    switch (element.type) {
      case "text": {
        message += element.attrs.content;
        break;
      }
      case "img": {
        image = {
          url: element.attrs.src,
        };
        break;
      }
      case "face": {
        message += h.image(element.children[0].attrs.src);
        break;
      }
      default: {
        break;
      }
    }
  }
  if (blacklist.check(message)) return false;

  messageBody.embed = [{
    author: {
      name: dcMessage.user.nick === null ? dcMessage.user.name : dcMessage.user.nick,
      icon_url: dcMessage.user.avatar,
    },
    timestamp: convertMsTimestampToISO8601(Number(quoteMessage.data[0].timestamp)),
    description: `${message}\n\n[[ ↑ ]](https://discord.com/channels/${quoteMessage.data[0][`${source}_guild_id`]}/${quoteMessage.data[0][`${source}_channel_id`]}/${dcMessage.id})`,
    color: 2605017,
    image,
  }];

  return true;
}

async function handleQQToDiscord(
  ctx: Context,
  config: Config,
  session: Session,
  from: BasicType,
  to: BasicType,
  messageData,
  elements: h[],
  sender,
  nickname: string,
  platform: string,
  channelId: string,
  selfId: string,
  blacklist: BlacklistDetector,
) {
  if (nickname === null) nickname = sender.name;

  const dcBot = ctx.bots[`discord:${to.self_id}`];
  const messageBody = generateMessageBody();
  const quoteReady = await appendQQQuoteEmbed(ctx, dcBot, messageBody, messageData, elements, channelId, selfId, blacklist);
  if (!quoteReady) return false;

  const [stop] = await ProcessorQQ.process(elements, session, config, [from, to], ctx, messageBody, blacklist);
  if (stop || !messageBody.validElement) return false;

  if (nickname === null || nickname === "") nickname = sender.name;

  const [webhookUrl, webhookId, hasWebhook] = await getWebhook(dcBot, to.self_id, to.channel_id);
  const payloadJson = JSON.stringify({
    content: messageBody.text,
    username: `[QQ:${sender.id}] ${nickname}`,
    avatar_url: sender.avatar,
    embeds: messageBody.embed,
    // https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/8
    allowed_mentions: {
      parse: messageBody.mentionEveryone ? ["everyone"] : [],
    },
  });
  messageBody.form.append("payload_json", payloadJson);

  try {
    const res = await ctx.http.post(`${webhookUrl}?wait=true`, messageBody.form);

    // 消息发送成功后才记录
    await createBridgeMessageRecord(ctx, {
      fromMessageId: messageData.id,
      fromPlatform: platform,
      fromChannelId: channelId,
      fromSenderId: sender.id,
      fromSenderName: nickname,
      toMessageId: res.id,
      toPlatform: "discord",
      toChannelId: to.channel_id,
      onebotRealMessageId: messageData.id,
    });
  } catch (error) {
    logger.error(error);

    // 确保文件传输失败时能发送通知
    if (messageBody.hasFile) {
      for (let i = 0; i < messageBody.n; i++) {
        messageBody.form.delete(`files[${i}]`);
      }

      await ctx.http.post(`${webhookUrl}?wait=true`, messageBody.form);
    }
  }

  if (!hasWebhook) {
    await dcBot.internal.deleteWebhook(webhookId);
  }

  return true;
}

async function resolveDiscordQuotePrefix(ctx: Context, config: Config, dcBot, messageData, elements: h[], channelId: string) {
  let message = "";
  let quotedMessageId = null;

  if ("quote" in messageData && messageData.content === "") {
    // 处理转发消息事件和标注消息事件
    const data = await dcBot.internal.getChannelMessage(channelId, messageData.id);

    if (data.type === 6) return null;

    const guildId = await dcBot.internal.getChannel(messageData.quote.channel.id);
    const quotedNick = messageData.quote.user.nick === null ? messageData.quote.user.name : messageData.quote.user.nick;

    message += `===== 转发消息 =====\nhttps://discord.com/channels/${guildId.guild_id}/${messageData.quote.channel.id}/${messageData.quote.id}\n===== 以下为转发内容 =====\n${config.show_discord_avatar ? h.image(`${messageData.quote.user.avatar}?size=64`) : ""}${quotedNick.indexOf("[QQ:") !== -1 ? "" : "[Discord] "}${quotedNick}:\n`;
  }

  if ("quote" in messageData && elements.length !== 0) {
    // 不同平台之间回复 & 同平台之间回复
    const diffPlatformQuoteMessage = await ctx.database.get("bridge_message", {
      to_message_id: messageData.quote.id,
      to_channel_id: messageData.quote.channel.id,
    });
    const samePlatformQuoteMessage = await ctx.database.get("bridge_message", {
      from_message_id: messageData.quote.id,
      from_channel_id: messageData.quote.channel.id,
    });

    const quoteMessage = diffPlatformQuoteMessage.length !== 0 ? diffPlatformQuoteMessage : samePlatformQuoteMessage;

    if (quoteMessage.length !== 0) {
      quotedMessageId = quoteMessage[0].onebot_real_message_id;
    }
  }

  return { message, quotedMessageId };
}

async function handleDiscordToQQ(
  ctx: Context,
  config: Config,
  session: Session,
  from: BasicType,
  to: BasicType,
  messageData,
  elements: h[],
  sender,
  nickname: string,
  platform: string,
  channelId: string,
  blacklist: BlacklistDetector,
) {
  const qqbot = ctx.bots[`${to.platform}:${to.self_id}`];
  const dcBot = ctx.bots[`discord:${from.self_id}`];
  const quotePrefix = await resolveDiscordQuotePrefix(ctx, config, dcBot, messageData, elements, channelId);
  if (quotePrefix === null) return false;

  let { message, quotedMessageId } = quotePrefix;

  // 处理消息元素
  message = await ProcessorDiscord.process(elements, config, [from, to], ctx, message, messageData, dcBot, qqbot, blacklist);

  // https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/6
  if (!sender.isBot) {
    const member = await dcBot.internal.getGuildMember(session.guildId, sender.id);
    nickname = member.nick === null ? member.user.global_name : member.nick;
  }

  const avatar = getDiscordAvatarUrl(config, sender.avatar, `${sender.avatar}?size=64`);
  const avatarElement = await createDiscordAvatarElement(ctx, config, avatar);
  if (avatarElement === null) return false;

  let channelInfo = null;
  if (config.show_discord_channel_name) {
    try {
      channelInfo = await dcBot.internal.getChannel(channelId);
    } catch (e) {
      logger.error(`Failed to get channel info: ${e}`);
    }
  }

  let prefix = "[Discord]";
  if (config.show_discord_channel_name && channelInfo !== null) {
    prefix = `[Discord from ${channelInfo.name ?? ""}]`;
  }

  const messageContent = `${quotedMessageId === null ? "" : h.quote(quotedMessageId)}${avatarElement}${prefix} ${nickname}:\n${message}`;
  const messageId = await sendQQMessageWithRetry(qqbot, to.channel_id, messageContent);
  if (messageId === null) return true;

  // Record the message mapping in the database after the message is sent successfully
  try {
    await createBridgeMessageRecord(ctx, {
      fromMessageId: messageData.id,
      fromPlatform: platform,
      fromChannelId: channelId,
      fromSenderId: sender.id,
      fromSenderName: nickname,
      toMessageId: messageId[0],
      toPlatform: "onebot",
      toChannelId: to.channel_id,
      onebotRealMessageId: messageId[0],
    });
  } catch (error) {
    logger.error(error);
  }

  return true;
}

const main = async (ctx: Context, config: Config, session: Session) => {
  const sender = session.event.user;
  if (shouldIgnoreMessage(session, sender)) return;

  const platform = session.event.platform;
  const selfId = session.event.selfId;
  const channelId = session.event.channel.id;
  const messageData = session.event.message;
  const blacklist = new BlacklistDetector(config.words_blacklist);

  // 测试用
  if (config.debug) {
    logger.info("-------Message-------");
    logger.info(messageData);
    logger.info("-------Sender-------");
    logger.info(sender);
    logger.info("-------End--------");
  }

  // 如果 message_data 不包含 id 字段，则代表该消息为 QQ 文件的占位符消息，直接跳过
  if (!(messageData && "id" in messageData)) return;

  let nickname = getInitialNickname(session, sender);
  const elements = messageData.elements ?? [];

  if (elements.length <= 0 && !Object.keys(messageData).includes("quote")) return;

  for (const { from, to } of findBridgeRoutes(config, platform, selfId, channelId)) {
    try {
      const shouldContinue = to.platform === "discord"
        ? await handleQQToDiscord(ctx, config, session, from, to, messageData, elements, sender, nickname, platform, channelId, selfId, blacklist)
        : await handleDiscordToQQ(ctx, config, session, from, to, messageData, elements, sender, nickname, platform, channelId, blacklist);

      if (!shouldContinue) return;
    } catch (error) {
      logger.error(error);
    }
  }
};

export function apply(ctx: Context, config: Config) {
  ctx.model.extend("bridge_message", {
    id: "unsigned",
    timestamp: "bigint",
    from_message_id: "string",
    from_platform: "string",
    from_channel_id: "string",
    from_guild_id: "string",
    from_sender_id: "string",
    from_sender_name: "string",
    to_message_id: "string",
    to_platform: "string",
    to_channel_id: "string",
    to_guild_id: "string",
    onebot_real_message_id: "string",
  }, {
    primary: "id",
    autoInc: true,
  });

  ctx.on("message", async session => await main(ctx, config, session));

  // for Discord
  ctx.on("discord/message-update", async session => await onDiscordMessageUpdated(ctx, config, session));
  ctx.on("discord/message-delete", async session => await onDiscordMessageDeleted(ctx, config, session));
}
