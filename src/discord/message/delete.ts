import { Context } from "koishi";
import type { Session } from "koishi";
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
}
