import { Schema } from 'koishi';

export interface Constant {
  enable: boolean,
  note: string,
  from: Array<BasicType>,
  to: Array<BasicType>
}

export interface BasicType {
  platform: string,
  channel_id: string,
  self_id: string
}

export interface Config {
  words_blacklist: Array<string>,
  debug: boolean,
  file_processor: "Koishi" | "QQBot",
  show_discord_avatar: boolean,
  sync_edit_delete: boolean,
  discord_default_avatar_color: 99 | 0 | 1 | 2 | 3 | 4,
  download_threads: number,
  qq_file_limit: number,
  discord_file_limit: number,
  constant?: Array<Constant>
};

declare module "koishi" {
  interface Tables {
    bridge_message: BridgeMessage
  }
}

export interface BridgeMessage {
  id: number,
  timestamp: bigint,
  from_message_id: string,
  from_platform: string,
  from_channel_id: string,
  from_guild_id: string,
  from_sender_id: string,
  from_sender_name: string,
  to_message_id: string,
  to_platform: string,
  to_channel_id: string,
  to_guild_id: string,
  onebot_real_message_id: string
}

export const Config: Schema<Config> = Schema.object({
  words_blacklist: Schema.array(String).description("屏蔽词"),
  debug: Schema.boolean().description("开启 Debug 模式").default(false),

  file_processor: Schema.union([
    Schema.const("Koishi"),
    Schema.const("QQBot")
  ]).default("Koishi").description("将由哪个平台处理文件（对于 Discord -> QQ 来说，建议使用可以访问 Discord 的平台处理，通常为 Koishi）"),

  show_discord_avatar: Schema.boolean().description("显示 Discord 头像").default(true),
  sync_edit_delete: Schema.boolean().description("同步消息的编辑和删除").default(false),

  discord_default_avatar_color: Schema.union([
    Schema.const(99).description("随机颜色"),
    Schema.const(0).description("蓝色"),
    Schema.const(1).description("灰色"),
    Schema.const(2).description("绿色"),
    Schema.const(3).description("橙色"),
    Schema.const(4).description("红色"),
  ]).default(0).description("Discord 默认头像颜色"),

  download_threads: Schema.number().description("下载文件时的默认线程数").default(4),
  qq_file_limit: Schema.number().description("QQ 文件上传大小上限，单位为字节").default(20971520),
  discord_file_limit: Schema.number().description("Discord 文件上传大小上限，单位为字节（该选项不宜设置太高，避免超过 Discord 本身的限制）").default(10485760),

  constant: Schema.array(Schema.object({
    enable: Schema.boolean().description("启用").default(true),
    note: Schema.string().description("备注"),
    from: Schema.array(Schema.object({
      platform: Schema.string().description("来源平台"),
      channel_id: Schema.string().description("频道ID"),
      self_id: Schema.string().description("自身ID")
    })),
    to: Schema.array(Schema.object({
      platform: Schema.string().description("目标平台"),
      channel_id: Schema.string().description("频道ID"),
      self_id: Schema.string().description("自身ID")
    }))
  }))
});
