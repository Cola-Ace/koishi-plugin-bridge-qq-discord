// @ts-nocheck
import { Context, h, Session } from 'koishi';
import { } from 'koishi-plugin-adapter-onebot';
import { Config } from './config';
import sharp from 'sharp';

export * from "./config";
import { MessageBody } from './types';
import { convertMsTimestampToISO8601, logger, BlacklistDetector, getBinary, generateMessageBody } from './utils';
import ProcessorQQ from './qq';
import { getWebhook } from "./discord/webhook";
import ProcessorDiscord from './discord';
import onDiscordMessageDeleted from './discord/message/delete';
import onDiscordMessageUpdated from './discord/message/update';

export const name = 'bridge-qq-discord';

export const inject = ["database"]

const main = async (ctx: Context, config: Config, session: Session) => {
  const sender = session.event.user;
  if (!sender) return; // 避免 sender 为空导致的错误

  if (sender.id === session.bot.selfId) return; // 避免回环

  const pattern = /\[QQ:\d+\]/;
  if (pattern.test(sender.name ?? "[QQ:10000]")) return; // 不转发自己消息

  const platform = session.event.platform;
  const self_id = session.event.selfId;
  const channel_id = session.event.channel.id;
  const message_data = session.event.message;

  const Blacklist = new BlacklistDetector(config.words_blacklist);

  // 测试用
  if (config.debug) {
    logger.info("-------Message-------");
    logger.info(message_data);
    logger.info("-------Sender-------");
    logger.info(sender);
    logger.info("-------End--------");
  }

  // 如果 message_data 不包含 id 字段，则代表该消息为 QQ 文件的占位符消息，直接跳过
  if (!(message_data && "id" in message_data)) return;

  let nickname = sender.isBot ? sender.name : ("member" in session.event ? session.event.member.nick : sender.name); // 判断是否为 bot

  // const elements = message_data.elements.filter(element => element.type !== "at"); // 确保没有@格式
  const elements = message_data.elements ?? [];

  if (elements.length <= 0 && !Object.keys(message_data).includes("quote")) return;

  for (const constant of config.constant) {
    if (!constant.enable) continue;

    for (const from of constant.from) {
      if (from.platform === platform && from.self_id === self_id && from.channel_id === channel_id) {
        for (const to of constant.to) {
          try {
            if (to.platform === "discord") {
              // QQ -> Discord
              if (nickname === null) nickname = sender.name; // 如果群昵称为空则使用用户名

              const dc_bot = ctx.bots[`discord:${to.self_id}`];

              const message_body: MessageBody = generateMessageBody();

              if ("quote" in message_data) {
                // 不同平台之间回复 & 同平台之间回复
                const diff_platform_quote_message = await ctx.database.get("bridge_message", {
                  to_message_id: message_data.quote.id,
                  to_channel_id: channel_id
                })
                const same_platform_quote_message = await ctx.database.get("bridge_message", {
                  from_message_id: message_data.quote.id,
                  from_channel_id: channel_id
                });

                const quote_message = { type: diff_platform_quote_message.length !== 0 ? "diff" : "same", data: diff_platform_quote_message.length !== 0 ? diff_platform_quote_message : same_platform_quote_message };

                if (quote_message.data.length !== 0) {
                  let message = "";
                  let image = {};
                  let source = "";

                  switch (quote_message["type"]) {
                    case "same": { // 同平台之间回复
                      source = "to";
                      break;
                    }
                    case "diff": { // 不同平台之间回复
                      source = "from"
                      // 删除 QQ 回复时自动带上的 @
                      if (elements[0].type === "at" && elements[0].attrs.id === self_id) {
                        elements.shift();
                      }
                      break;
                    }
                    default: {
                      break;
                    }
                  }
                  if (source === "") return;

                  const dc_message = await dc_bot.getMessage(quote_message["data"][0][`${source}_channel_id`], quote_message["data"][0][`${source}_message_id`]);
                  if (source === "from"){
                    message_body.text += `<@${dc_message.user.id}>`;
                    message_body.validElement = true;
                  }

                  for (const element of dc_message.elements) {
                    switch (element.type) {
                      case "text": {
                        message += element.attrs.content;
                        break;
                      }
                      case "img": {
                        image = {
                          url: element.attrs.src
                        }
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
                  if (Blacklist.check(message)) return; // 黑名单检测
                  message_body.embed = [{
                    author: {
                      name: (dc_message["user"]["nick"] === null ? dc_message["user"]["name"] : dc_message["user"]["nick"]),
                      icon_url: dc_message["user"]["avatar"]
                    },
                    timestamp: convertMsTimestampToISO8601(Number(quote_message["data"][0]["timestamp"])),
                    description: `${message}\n\n[[ ↑ ]](https://discord.com/channels/${quote_message["data"][0][`${source}_guild_id`]}/${quote_message["data"][0][`${source}_channel_id`]}/${dc_message.id})`,
                    color: 2605017,
                    image
                  }]
                }
              }

              const [stop, _] = await ProcessorQQ.process(elements, session, config, [from, to], ctx, message_body, Blacklist);
              if (stop || !message_body.validElement) return;

              // 实现发送消息功能
              if (nickname === null || nickname === "") nickname = sender.name;

              const [webhook_url, webhook_id, hasWebhook] = await getWebhook(dc_bot, to.self_id, to.channel_id);

              const payload_json = JSON.stringify({
                content: message_body.text,
                username: `[QQ:${sender.id}] ${nickname}`,
                avatar_url: sender.avatar,
                embeds: message_body.embed,
                // https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/8
                allowed_mentions: {
                  parse: (message_body.mentionEveryone ? ["everyone"] : []),
                },
              });
              message_body.form.append("payload_json", payload_json);

              try {
                const res = await ctx.http.post(`${webhook_url}?wait=true`, message_body.form);
                const from_guild_id = await ctx.database.get("channel", {
                  id: channel_id
                });
                const to_guild_id = await ctx.database.get("channel", {
                  id: to.channel_id
                });

                // 消息发送成功后才记录
                await ctx.database.create("bridge_message", {
                  timestamp: BigInt(Date.now()),
                  from_message_id: message_data.id,
                  from_platform: platform,
                  from_channel_id: channel_id,
                  from_guild_id: from_guild_id[0]["guildId"],
                  from_sender_id: sender.id,
                  from_sender_name: nickname,
                  to_message_id: res.id,
                  to_platform: "discord",
                  to_channel_id: to.channel_id,
                  to_guild_id: to_guild_id[0]["guildId"],
                  onebot_real_message_id: message_data.id
                })
              } catch (error) {
                logger.error(error);

                // 确保文件传输失败时能发送通知
                if (message_body.hasFile) {
                  for (let i = 0; i < message_body.n; i++) {
                    message_body.form.delete(`files[${i}]`);
                  }

                  await ctx.http.post(`${webhook_url}?wait=true`, message_body.form);
                }
              }

              if (!hasWebhook) {
                await dc_bot.internal.deleteWebhook(webhook_id);
              }

              continue;
            }

            // Discord -> QQ
            const qqbot = ctx.bots[`${to.platform}:${to.self_id}`];
            const dc_bot = ctx.bots[`discord:${from.self_id}`];

            let message = "";
            let quoted_message_id = null;

            if ("quote" in message_data && message_data.content === "") { // 处理转发消息事件和标注消息事件
              const data = await dc_bot.internal.getChannelMessage(channel_id, message_data.id);

              if (data.type === 6) return; // Discord 标注消息事件

              const guild_id = await dc_bot.internal.getChannel(message_data.quote.channel.id);
              const quoted_nick = message_data.quote.user.nick === null ? message_data.quote.user.name : message_data.quote.user.nick;

              message += `===== 转发消息 =====\nhttps://discord.com/channels/${guild_id["guild_id"]}/${message_data.quote.channel.id}/${message_data.quote.id}\n===== 以下为转发内容 =====\n${config.show_discord_avatar ? h.image(`${message_data.quote.user.avatar}?size=64`) : ""}${quoted_nick.indexOf("[QQ:") !== -1 ? "" : "[Discord] "}${quoted_nick}:\n`;
            }

            if ("quote" in message_data && elements.length !== 0) {
              // 不同平台之间回复 & 同平台之间回复
              const diff_platform_quote_message = await ctx.database.get("bridge_message", {
                to_message_id: message_data.quote.id,
                to_channel_id: message_data.quote.channel.id
              })
              const same_platform_quote_message = await ctx.database.get("bridge_message", {
                from_message_id: message_data.quote.id,
                from_channel_id: message_data.quote.channel.id
              });

              const quote_message = diff_platform_quote_message.length !== 0 ? diff_platform_quote_message : same_platform_quote_message;

              if (quote_message.length !== 0) {
                quoted_message_id = quote_message[0]["onebot_real_message_id"];
              }
            }

            // 处理消息元素
            message = await ProcessorDiscord.process(elements, config, [from, to], ctx, message, message_data, dc_bot, qqbot, Blacklist);

            // https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/6
            if (!sender.isBot) {
              const member = await dc_bot.internal.getGuildMember(session.guildId, sender.id);
              // nickname = sender.nick === null ? sender.name : sender.nick;
              nickname = member.nick === null ? member.user.global_name : member.nick;
            }

            // Process Discord default avatar
            let avatar_color = "";
            let avatar = `${sender.avatar}?size=64`;
            if (sender.avatar === null) {
              avatar_color = config.discord_default_avatar_color.toString();
              if (config.discord_default_avatar_color === 99){
                avatar_color = Math.floor(Math.random() * 5).toString();
              }
              avatar = `https://cdn.discordapp.com/embed/avatars/${avatar_color}.png`;
            }

            // https://github.com/Cola-Ace/koishi-plugin-bridge-discord-qq/issues/7
            // const avatar = sender.avatar === null ? "https://cdn.discordapp.com/embed/avatars/0.png" : `${sender.avatar}?size=64`;

            let message_content = `${quoted_message_id === null ? "" : h.quote(quoted_message_id)}${config.show_discord_avatar ? h.image(avatar) : ""}[Discord] ${nickname}:\n${message}`;
            if (config.file_processor === "Koishi") {
              const [avatar_blob, avatar_type, avatar_error] = await getBinary(avatar, ctx.http);
              if (avatar_error) {
                logger.error(avatar_error);
                return;
              }
              const avatar_arrayBuffer = await avatar_blob.arrayBuffer();
              const avatar_resize_arrayBuffer = await sharp(avatar_arrayBuffer).resize(64, 64).toBuffer();
              message_content = `${quoted_message_id === null ? "" : h.quote(quoted_message_id)}${config.show_discord_avatar ? h.image(avatar_resize_arrayBuffer, avatar_type) : ""}[Discord] ${nickname}:\n${message}`;
            }

            let retry_count = 0;
            while (retry_count <= 3){
              try {
                const message_id = await qqbot.sendMessage(to.channel_id, message_content);
                const from_guild_id = await ctx.database.get("channel", {
                  id: channel_id
                });
                const to_guild_id = await ctx.database.get("channel", {
                  id: to.channel_id
                });
                // Record the message mapping in the database after the message is sent successfully
                try {
                  await ctx.database.create("bridge_message", {
                    timestamp: BigInt(Date.now()),
                    from_message_id: message_data.id,
                    from_platform: platform,
                    from_channel_id: channel_id,
                    from_guild_id: from_guild_id[0]["guildId"],
                    from_sender_id: sender.id,
                    from_sender_name: nickname,
                    to_message_id: message_id[0],
                    to_platform: "onebot",
                    to_channel_id: to.channel_id,
                    to_guild_id: to_guild_id[0]["guildId"],
                    onebot_real_message_id: message_id[0]
                  })
                } catch (error) {
                  logger.error(error);
                }

                break;
              } catch (error) {
                retry_count++;
                if (retry_count >= 3) {
                  logger.error(error);
                  break;
                }

                logger.info(`发送消息失败，正在重试... (${retry_count}/3)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          } catch (error) {
            logger.error(error);
          }
        }
      }
    }
  }
}

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
    onebot_real_message_id: "string"
  }, {
    primary: "id",
    autoInc: true
  })

  ctx.on("message", async (session) => await main(ctx, config, session));

  // for Discord
  ctx.on("discord/message-update", async (session) => await onDiscordMessageUpdated(ctx, config, session));
  ctx.on("discord/message-delete", async (session) => await onDiscordMessageDeleted(ctx, config, session));
}
