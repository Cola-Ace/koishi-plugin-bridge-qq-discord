# koishi-plugin-bridge-qq-discord
[![npm](https://img.shields.io/npm/v/koishi-plugin-bridge-qq-discord)](https://www.npmjs.com/package/koishi-plugin-bridge-qq-discord)
[![LICENSE](https://img.shields.io/github/license/Cola-Ace/koishi-plugin-bridge-qq-discord)](https://github.com/Cola-Ace/koishi-plugin-bridge-qq-discord/blob/main/LICENSE)
![NPM Downloads](https://img.shields.io/npm/d18m/koishi-plugin-bridge-qq-discord)
![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/Cola-Ace/koishi-plugin-bridge-discord-qq/publish.yml)



让 Discord 和 QQ 的消息互通

目前为自用插件，现有功能应该能正常使用，如果你需要进一步了解使用这个插件的方法可以联系我

# 注意事项
1. 该程序在 Discord 上使用 Webhook 发送消息以营造尽可能沉浸的对话，根据 2024.8.20 的 Discord 官方回复，目前 Webhook 存在如下限制：

 - 每个 Webhook 最多可以每 2 秒发送 5 个请求
 - 每 2 秒最多创建或删除 5 次 Webhook
 - 每个频道每分钟最多发送 30 次请求

    如果你的消息量超过了官方的限制，那么你很有可能会触发 `rate limit` 限制，从而导致无法正常发送消息

    以下为官方回复原文：

    > I just heard back from the team and the rate limit on webhooks is 5 requests every two seconds per webhook ID. This limit is also applied to webhook creation and deletion. Moreover, there is a limit of 30 requests per minute per channel.

2. 本插件目前只适配了 Onebot 和 Discord 适配器, 不保证其他适配器能正常使用
3. 确保你的 OneBot 协议端能最大程度地支持 [go-cqhttp API](https://docs.go-cqhttp.org/api) 的扩展 API
4. 本插件基于 [NapCat](https://github.com/NapNeko/NapCatQQ) 提供的 [OneBot v11](https://github.com/botuniverse/onebot-11) 和 [go-cqhttp API](https://docs.go-cqhttp.org/api) 协议开发

# 使用方法
1. constant 添加项目后，在 from 和 to 中分别添加一个项目
2. 在 from 和 to 中，platform 填入 discord 或者 onebot，频道 ID 根据不同的平台而定，自身 ID 则是 bot 的 ID，频道 ID 和自身 ID 建议使用 Koishi 自带的 inspect 插件查看
3. words_blacklist 为黑名单，黑名单内的词出现在即将发送的消息中时消息将不会被发送

# 待办事项
- 优化代码

# 功能列表
1. QQ
    - [x] 消息同步
    - [x] 回复消息同步
    - [x] @ 消息同步
    - [x] 图片，gif 同步
    - [x] 表情同步
    - [x] 文件同步
    - [x] 视频同步
    - [x] 合并转发消息同步
2. Discord
    - [x] 消息同步
    - [x] 回复消息同步
    - [x] 图片，gif 同步
    - [x] 表情同步
    - [x] 文件同步
    - [x] 视频同步
