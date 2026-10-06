# 移动端架构规范

## 技术基线

- React Native + TypeScript，使用 Expo Prebuild/EAS 管理 Android 原生工程。
  当前稳定配套为 Expo 55.0.31、React Native 0.83.10、React 19.2.0，原生运行时
  `android-3`；SDK 升级见 [运行时 ADR](../adr/2026-10-06-android-font-layout-runtime.md)，
  前台字体配置事件与共享倍率见 [字体通知 ADR](../adr/2026-10-06-android-font-metrics.md)。
- React Navigation Native Stack + Bottom Tabs；不使用 WebView 套壳或 Web 路由兼容层。
- Zustand + domain reducer/selectors；服务端对象 normalized，transport event 不直接进 UI。
- Zod（或等价运行时校验）解析 HTTP、WebSocket、消息内容和 release policy。
- `fetch` 封装 HTTP；Android 用嵌入式 Cronet（含 QUIC/HTTP2）承接 OkHttp，避免部分公网路径对
  非浏览器 TLS Client Hello 直接 RST。不依赖 Google Play 服务。原生 WebSocket 处理 Workspace
  realtime；本地通知负责 Android 通知。
- SQLite/受保护 KV 保存可丢失缓存、草稿和游标；Android Keystore 保存 refresh token。
- Android APK/AAB 是唯一交付产物；iOS 不在当前架构范围。

## 模块边界

```text
app/                 启动、导航、更新门禁
domain/              Workspace 类型、消息协议、权限投影、状态机
data/http/           API client、token refresh、错误映射
data/realtime/       hello/ready/event/replay、游标和重连
data/cache/          SQLite/KV、草稿、最近消息
features/chat/       会话／话题列表、聊天、消息、附件、对象动作
features/files/      文件库与传输任务
features/members/    可见联系人
features/account/    个人目录、资料、外观、聊天偏好、通知、只读空间信息、关于
features/workbench/  仅开发构建：正式组件工作台
fixtures/            合成夹具，供工作台和测试
platform/android/    OAuth callback、Keystore、本地通知、前台可恢复上传、Deep Link
ui/                  token 映射、primitive、chrome、fallback、update dialog
```

设备会话在确认服务端列表／撤销契约前不进入 `features/account`。工作台必须 import `ui/` 正式组件，不得另维护一套 Demo 视觉。

空间管理页面、P2P 模块和 ntfy client 不得出现在上述模块中。服务端 capability 只在
feature 层用于隐藏会话级动作；不得据此生成邀请、角色、容量或保留设置页面。

## 数据流与依赖规则

启动顺序为 release policy、凭证恢复、bootstrap、会话列表、WebSocket。HTTP 响应先校验
再写入 domain store；事件按 event ID 去重、按 seq 检查缺口，缺口触发受控 refetch。
平台模块通过接口注入 domain，不让业务组件直接调用 Keystore、本地通知或原生文件 API。

个人头像复用 Workspace 已有的 `PUT/DELETE /api/workspace/me/avatar`：`data/avatar.ts`
负责系统图片选择、受限缓存副本和字节上限，Runtime 发送 raw image 并校验 canonical
用户响应。只更新本人 `avatarUrl`，不把头像回执覆盖为整份资料或权限快照。头像完成前
启动的 bootstrap 仍须落实撤权，只保留已完成的头像字段；之后启动的 bootstrap
继续接受 Web 的新头像。头像与显示名／查找可见性各自明确保存，不引入新的原生权限。
预览文件仅放在头像专属临时目录，账号目录使用 SHA-256，文件名使用 UUID；不保存
URI registry。头像没有进程恢复需求，启动清理无活跃归属的旧副本，退出清理该账号
的旧头像副本；不得清理其他附件、媒体预览或整个应用缓存。专属目录枚举／删除失败
只影响这次缓存回收，不能阻断凭证恢复；后续启动可重试。

新增依赖必须说明维护、包体、安全、许可证和 Android 兼容成本。不得引入第二套 UI Kit、
第二个全局状态库或通用离线同步框架来掩盖领域边界。

## 架构决策记录

涉及新原生模块、公共 API、协议 major、持久化 schema、通知投递、OTA 或构建发布拓扑时，
新增 `docs/adr/YYYY-MM-DD-topic.md`，记录背景、选项、决定、迁移、观测和回滚。
