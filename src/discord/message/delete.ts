// @ts-nocheck
import { Context } from "koishi";
import type { Session } from "koishi";
import { findDiscordToQQBot } from "../../bridge";
import { Config } from "../../config";

export default async function onDiscordMessageDeleted(ctx: Context, config: Config, session: Session) {
  if (!config.sync_edit_delete) return;

  const channelId = session.channel_id as unknown as string;
  // const guildId = session.guild_id as unknown as string;
  const messageId = session.id as unknown as string;

  // try to find the corresponding message in the database
  const bridgeMessage = await ctx.database.get("bridge_message", {
    from_channel_id: channelId,
    from_message_id: messageId,
  });

  // If not found, maybe it's a message that was sent before the bot was added to the channel,
  // or the message was not bridged for some reason (for example have words in the blacklist). In this case, we can just ignore the deletion.
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
}
