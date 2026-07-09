// @ts-nocheck
import { Context } from "koishi";
import type { Session } from "koishi";
import { createDiscordAvatarElement, findDiscordToQQBot, getDiscordAvatarUrl, sendQQMessageWithRetry } from "../../bridge";
import { logger, BlacklistDetector } from "../../utils";
import { Config } from "../../config";

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
	if (bridgeMessage.length === 0) return;

	const qqbot = await findDiscordToQQBot(ctx, config, channelId, bridgeMessage[0].to_channel_id);
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

	const avatar = getDiscordAvatarUrl(
		config,
		session.author.avatar,
		`https://cdn.discordapp.com/avatars/${session.author.id}/${session.author.avatar ?? ""}.png?size=64`,
	);
	const avatarElement = await createDiscordAvatarElement(ctx, config, avatar);
	if (avatarElement === null) return;

	// Send Message
	const messageContent = `${avatarElement}[Discord] ${nickname}:\n===== 该条消息为 Discord 编辑后消息 =====\n${content}`;
	const newMessageId = await sendQQMessageWithRetry(qqbot, bridgeMessage[0].to_channel_id, messageContent);
	if (newMessageId === null) return;

	// Record the message mapping in the database after the message is sent successfully
	try {
		await ctx.database.set("bridge_message", {
			from_message_id: bridgeMessage[0].from_message_id,
		}, {
			to_message_id: newMessageId[0],
			onebot_real_message_id: newMessageId[0],
		});
	} catch (error) {
		logger.error(error);
	}
}
