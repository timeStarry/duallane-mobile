# DualLane Mobile (`v1.1.0`)

**DualLane 净室重构轻量原生移动端（Android）** —— 与 DualLane PC `v1.0.4` 共享统一视觉语言（`04 · 叠境双晶` 品牌体系、5 套主色、浅色/深色/跟随系统、毛玻璃/纯色质感）与完整双通道能力，采用 **纯原生 Kotlin 系统宿主 + 本地预置高性能移动交互层** 构建，摒弃旧版臃肿跨端运行时，安装包体积由 `~128 MB` 精简至 **`~2.5 MB`** 级别。

## 核心架构

- **原生宿主层 (`android/app/src/main/java/com/timestarry/duallane/`)**
  - `MainActivity.kt`：沉浸式 Edge-to-Edge 窗口、键盘 `WindowInsetsAnimationCompat` 丝滑跟手内边距同步、系统级返回手势栈、Android Photo Picker / SAF 文档选择器、OAuth / 房间邀请 Deep Link 路由。
  - `TokenVault.kt`：基于 `AndroidKeyStore` (`AES-256-GCM`) 硬件加密保管 `accessToken` 与 `refreshToken`。
  - `NetworkGateway.kt`：统一 `OkHttp` 连接池 + 64 MB 磁盘缓存、单飞互斥锁 (`refreshLock`) 无感刷新轮换单次 `refreshToken`、GitHub PKCE + Custom Tabs 原生授权、流式分片 (`SHA-256` 校验) 大文件上传。
  - `RealtimeManager.kt`：原生保活 WebSocket 网关，后台自动投递 Android 系统通知并支持点击直达对应会话。
  - `NativeBridge.kt`：零反射开销类型安全双向桥接与原生触感反馈 (`Haptics`)、系统分享面板。
- **移动交互层 (`src/`)**
  - 对标 Telegram 与飞书移动端的底部四栏架构（**消息 / 直连 / 通讯录 / 我**）及手势交互（左滑引用回复、长按底部操作抽屉 + 快捷表情回应、双击点赞、全屏手势灯箱）。
  - **共享空间 (`Workspace`)**：分类胶囊（`全部 / 未读 / @我 / 群聊 / 机器人`）、置顶会话、`我的收藏`、精准单双勾已读回执（`✓ / ✓✓`）、`正在输入… / 正在思考…`、群聊 `@提及` 候选与姓名旁 `@TA` 胶囊、单图与贴纸无气泡边框独立渲染、Telegram 风格贴纸工作台（偷表情入收藏、自建表情包、分享导入、底栏 Tab 拖拽/上下调序）、话题回复、合并转发、CardKit v1 交互卡片、机器人斜杠指令（仅机器人会话展示）与凭证解绑管理。
  - **一对一直连 (`Private Direct / P2P`)**：零登录内存态 `AES-256-GCM` 端到端加密临时房间，与 PC 端 `p2p-lane` 100% 协议互通。
  - *注：空间管理后台按移动端精简定位不在移动端内置，保持纯粹的沟通与协作体验。*

## 本地开发与构建

```bash
# 安装依赖
pnpm install

# 运行类型检查、ESLint 与单元测试
pnpm check

# 启动本地移动端调试视图
pnpm dev

# 构建并同步 Android 预置静态资源与自适应图标
pnpm sync:android
pnpm build:icons

# 构建 Android 安装包 (需 JDK 17 + Android SDK 36)
cd android && ./gradlew assembleDebug assembleRelease bundleRelease
```


## 1.1 更新与交付

本版补齐新版助手权限、接入指引、群审批、服务端交互卡片、未读回看与键盘提及。
原生安装包版本与界面热更版本独立比较；最低可用原生版本与热更兼容下限分别设置。
详细验收、旧壳限制和分阶段发布顺序见 [发布说明](docs/releases/1.1.0.md)。
