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
| 个人资料 | `PATCH /api/workspace/me/profile`、头像路由 | 显示名保存／取消；查找可见性；头像上传未接 | R1 已接线资料保存；头像仍待独立上传 |
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
| MSG-01 | 结构化 blocks（text／mention／link／emoji／attachment） | 消息 DTO `content` | 解析认识 blocks，UI 只渲染 `plainText` | R1 组件位；R2 正式渲染 |
| MSG-02 | Markdown 安全子集 | Web `WorkspaceMarkdown` | 未接 | R2；不引入 WebView |
| MSG-03 | 回复 | 创建消息 `replyToMessageId` | 发送固定 `null`；DTO 未投影 | R2，需扩展 `parseMessage` |
| MSG-04 | @ 成员 | mention block | 解析有、编辑器无 | R2 |
| MSG-05 | 表情与反应 | emote 路由；`POST/DELETE .../reactions` | DTO 有 `reactions`，客户端丢弃 | R2 |
| MSG-06 | 复制／撤回／隐藏／常驻 | recall、hidden、pins | 未接动作面板 | R2；R1 交付 `ObjectActionSheet` 壳 |
| MSG-07 | 历史、已读、未读分界 | messages + read | 有分页和 markRead，缺引用定位与可见已读 | R2 补阅读流程 |
| MSG-08 | 草稿、失败重试、clientMessageId | 创建消息幂等 | 已接文本草稿 | R1 保留；R2 扩附件／引用草稿 |
| MSG-09 | 文件选择预览后发送 | 分片上传 | 选择即上传并发消息 | R2 改为选→预览→发送 |
| MSG-10 | 话题 | `topic_routes.go` 全套 | 未接 | R1 列表分段入口；R2 接线 |
| MSG-11 | 已注册卡片 | `/cards/{id}`、actions | 未接 | R2 |
| MSG-12 | 未读／通知一致 | 会话投影 + WS | 基础已接 | R2 补话题目标与点击深链 |

`close`／`archive` 话题管理 API 存在，不等于移动端提供管理页。移动端只消费加入、退出、阅读、发送和状态展示。

## 3. 当前解析缺口

[`parseMessage`](../../../src/domain/contracts.ts) 未纳入主仓 DTO 已有字段：`topicId`、`replyToMessageId`、`reactions`、`pin`、`authorAvatarUrl`、`authorKind`、`authorRemark`。R1 不改协议行为；R2 必须扩展 schema 并保留未知 major／block 的安全 fallback。
