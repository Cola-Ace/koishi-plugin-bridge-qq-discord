### ✨ Features
- None

### 🐞 Bug Fixes
- [QQ -> Discord] 根据合并转发消息 ID 获取完整内容，并统一解析 CQ 码字符串和消息段数组，修复合并转发消息解析失败的问题
- [QQ -> Discord] 合并转发中的消息命中黑名单时跳过整条消息，避免继续转发
- [QQ -> Discord] 合并转发不再将桥接机器人发送的首张图片误用为头像，并禁用自动解析提及，避免意外触发 @ 通知
- [QQ -> Discord] 同一组合并转发复用 Webhook，并在处理结束或异常时清理临时创建的 Webhook

### 🔧 Maintenance
- 改为推送版本标签触发发布，校验标签与包版本一致；串行执行发布任务，跳过已发布的 npm 版本并允许更新 GitHub Release
