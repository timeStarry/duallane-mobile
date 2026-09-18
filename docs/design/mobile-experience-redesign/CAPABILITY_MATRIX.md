# 能力与接口对照

对照移动端基线 `b53bc219` 与主仓 `9b5956a7` 的现行 Go 路由。Web 列只标明已有产品表面，不把 Web 截图当成 Android 已完成。

图例：已接 = 当前 APK 已调用；缺口 = 服务端已有、客户端未接；R1 = 本轮壳层／组件；R2 = 聊天与内容阶段；范围外 = 移动端不做。

## 1. 认证、壳层、设置

| 能力 | Go / 契约 | 当前移动端 | 本轮 |
| --- | --- | --- | --- |
| GitHub PKCE 登录、邀请、会话恢复 | `/api/auth/mobile/github/*`、refresh、logout | 已接 | 保留；R1 只改登录层次 |
| 默认服务注入 | 构建 `EXPO_PUBLIC_API_ORIGIN` | 已接 | 保留 |
| Bootstrap | `GET /api/workspace/bootstrap` | 已接，字段偏最小 | R2 按需扩展投影 |
| 更新门禁 | `GET /api/mobile/release-policy` | 已接 | 保留；网络失败不得伪装强更 |
| 本机外观 | 无服务端契约 | 已接 `system/light/dark` | R1 迁入外观页；不宣称跨端同步 |
| 个人资料 | `PATCH /api/workspace/me/profile`、头像路由 | 显示名保存／取消；查找可见性；自定义头像按授权地址加载；头像上传未接 | R1 已接线资料保存；头像上传仍待独立接口 |
| 成员备注 | `PUT/DELETE /members/{id}/remark` | 未接 | R2 |
| 聊天偏好／自动折叠 | `GET/PUT /me/emote-settings` | 已接自动保存；表情包管理未接 | R1 设置页；折叠生效属 R2 消息渲染 |
| Android 通知权限 | 系统权限 + 本地通知 | 已接开启／系统设置 | R1 独立通知页，权限与偏好分开 |
| 会话提醒 `all/mentions/muted` | `PATCH .../notification` | 已接（详情页） | 保留语义 |
| 邮件／ntfy 渠道 | `/me/notifications`、email 路由 | 未接；移动端不改 ntfy | 范围外渠道管理；R1 不做邮件设置页 |
| 设备会话列表／撤销 | 需确认当前契约 | 方案有目标，页面无入口 | 阻塞，见开放依赖 |
| 表情库管理 | `/me/emotes*` | 未接 | R2 选择器先于管理工具 |
| Bot 凭证与管理 | `/bots*` | 未接 | 范围外 |
| 空间管理 | 角色、邀请、容量、保留 | 未接 | 范围外 |

## 2. 消息与对象动作

| 编号 | 能力 | Go | 当前移动端 | 本轮 |
| --- | --- | --- | --- | --- |
| MSG-01 | 结构化 blocks（text／mention／link／emoji／attachment） | 消息 DTO `content` | 按 block 渲染；未知仍 fallback；catalog 小表情 token 按 Web `emote-packs.json` 的 src 渲染 | R2 已接 |
| MSG-02 | Markdown 安全子集 | Web `WorkspaceMarkdown` | 无 WebView；表格／HTML 纯文；Markdown 文本中的 `[bili:melon]` 等 token 仍拆成图片 | R2 已接 |
| MSG-03 | 回复 | 创建消息 `replyToMessageId` | 引用预览／取消／定位 | R2 已接 |
| MSG-04 | @ 成员 | mention block | 候选与结构化 mention | R2 已接 |
| MSG-05 | 表情与反应 | emote 路由；`POST/DELETE .../reactions` | 选择器插入 catalog token（不包 `:`）；反应显示 catalog 图／unicode | R2 已接 |
| MSG-06 | 复制／撤回／隐藏／常驻 | recall、hidden、pins | 长按与更多；三者分开 | R2 已接 |
| MSG-07 | 历史、已读、未读分界 | messages + read | 分页、未读分界、引用定位 | R2 已接 |
| MSG-08 | 草稿、失败重试、clientMessageId | 创建消息幂等 | 草稿含引用／附件／提及 | R2 已接 |
| MSG-09 | 文件选择预览后发送 | 分片上传 | 选择≠发送；确认后上传 | R2 已接 |
| MSG-10 | 话题 | `topic_routes.go` 全套 | 列表、加入／退出、独立聊天 | R2 已接；不做关闭／归档管理 |
| MSG-11 | 已注册卡片 | `/cards/{id}`、actions | 话题卡原生；未知不执行 | R2 已接 |
| MSG-12 | 未读／通知一致 | 会话投影 + WS | 通知可带 topicId | R2 已接 |

`close`／`archive` 话题管理 API 存在，不等于移动端提供管理页。移动端只消费加入、退出、阅读、发送和状态展示。

## 3. 当前解析缺口

[`parseMessage`](../../../src/domain/contracts.ts) 已纳入 `topicId`、`replyToMessageId`、`reactions`、`pin`、作者扩展字段，以及 `card`／`emote_collection`／`topic_reference` 已知 block。未知 block／kind 仍安全 fallback 到 `plainText`，不执行 payload。正文里的 catalog 小表情与 Web 相同：token 如 `[bili:melon]`、`[wechat:微笑]` 对照主仓 `apps/web/shared/emote-packs.json` 快照解析为 `/emotes/...` 同源静态图，不按 id 猜 `.png` 文件名。未知 token 保持原文。表情包管理工具仍未接。
