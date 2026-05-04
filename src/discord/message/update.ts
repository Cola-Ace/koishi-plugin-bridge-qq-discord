import { Context, h } from "koishi";
import type { Session } from "koishi";
import { getBinary, logger, BlacklistDetector } from "../../utils";
import { Config } from "../../config";
import sharp from "sharp";

export default async function onDiscordMessageUpdated(ctx: Context, config: Config, session: Session) {
	if (!config.sync_edit_delete) return;

	// TODO: parse new format message
	const content = session.content;
	if (!content) return;

	// Check blacklist
	const blacklistDetector = new BlacklistDetector(config.words_blacklist);
	if (blacklistDetector.check(content)) return;

	// const guildId = session.guild_id as unknown as string;
	const channelId = session.channel_id as unknown as string;
	const messageId = session.id as unknown as string;

	// try to find the corresponding message in the database
	const bridgeMessage = await ctx.database.get("bridge_message", {
		from_channel_id: channelId,
		from_message_id: messageId,
	});

	// If not found, maybe it's a message that was sent before the bot was added to the channel,
	// or the message was not bridged for some reason (for example have words in the blacklist). In this case, we can just ignore the update.
	if (!bridgeMessage) return;

	let qqbot = null;
	for (const constant of config.constant || []) {
		if (
			constant.enable &&
			constant.from[0].platform === "discord" &&
			constant.from[0].channel_id === channelId &&
			constant.to[0].platform === "onebot" &&
			constant.to[0].channel_id === bridgeMessage[0].to_channel_id
		) {
			qqbot = ctx.bots[`${constant.to[0].platform}:${constant.to[0].self_id}`];
			break;
		}
	}

	if (!qqbot) return;

	// Delete message
	try {
		await qqbot.deleteMessage(bridgeMessage[0].to_channel_id, bridgeMessage[0].to_message_id);
	} catch (error) {
		// maybe the bot is not an administrator and doesn't have permission to delete messages, or the message was sent after 2 minutes (for QQ)
		// so we can just ignore the error and not retry
		// logger.error(`Failed to delete message in QQ: ${error}`);
	}

	// Init nickname
	const nickname = session.member.nick === null ? session.author.global_name : session.member.nick;

	// Process Discord default avatar
	let avatar_color = "";
	let avatar = `https://cdn.discordapp.com/avatars/${session.author.id}/${session.author.avatar ?? ""}.png?size=64`;
	if (session.author.avatar === null) {
		avatar_color = config.discord_default_avatar_color.toString();
		if (config.discord_default_avatar_color === 99) {
			avatar_color = Math.floor(Math.random() * 5).toString();
		}
		avatar = `https://cdn.discordapp.com/embed/avatars/${avatar_color}.png`;
	}

	let message_content = `${config.show_discord_avatar ? h.image(avatar) : ""}[Discord] ${nickname}:\n===== 该条消息为 Discord 编辑后消息 =====\n${content}`;
	if (config.file_processor === "Koishi") {
		const [avatar_blob, avatar_type, avatar_error] = await getBinary(avatar, ctx.http);
		if (avatar_error) {
			logger.error(avatar_error);
			return;
		}
		const avatar_arrayBuffer = await avatar_blob.arrayBuffer();
		const avatar_resize_arrayBuffer = await sharp(avatar_arrayBuffer).resize(64, 64).toBuffer();
		message_content = `${config.show_discord_avatar ? h.image(avatar_resize_arrayBuffer, avatar_type) : ""}[Discord] ${nickname}:\n===== 该条消息为 Discord 编辑后消息 =====\n${content}`;
	}

	// Send Message
	let retry_count = 0;
	while (retry_count <= 3) {
		try {
			const newMessageId = await qqbot.sendMessage(bridgeMessage[0].to_channel_id, message_content);
			// Record the message mapping in the database after the message is sent successfully
			try {
				await ctx.database.set("bridge_message", {
          from_message_id: bridgeMessage[0].from_message_id,
        }, {
          to_message_id: newMessageId[0],
          onebot_real_message_id: newMessageId[0],
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
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
}
