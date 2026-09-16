# DualLane 移动端 Workspace 客户端方案

状态：开发基线。固定 Android 包名 `com.timestarry.duallane`，API 26+，内部 APK/AAB。
本地通知、普通后台允许延迟，不接远程推送。实现状态和验证命令见 [交付记录](development/DELIVERY.md)。

本文基于同级主仓 [`../duallane`](../../duallane) 的现行约束编写。主仓的
`AGENTS.md`、`DESIGN.md`、Workspace 设计索引、API 契约、消息协议、实时事件、
客户端视图模型、移动可访问性和发布规范优先于本文；本文只补充移动端边界、
原生运行时和版本更新所需的决策。

## 1. 目标与边界

移动端只接入 Workspace 共享空间。Workspace 是登录、邀请制、服务端留存、
配额、权限和审计的通道；客户端文案必须明确“聊天和文件会保存到共享空间”，
不能把它描述成 P2P 或端到端私密会话。

首期目标：

- GitHub 登录、邀请链接承接和会话恢复。
- 会话列表、私聊/群聊消息读取与发送。
- Workspace WebSocket 实时事件、断线重连、游标恢复和必要时全量同步。
- 文件上传/下载及上传进度，沿用主仓的预留配额、分片、哈希和幂等规则。
- 消息协议的版本检查、未知内容降级和低版本样式。
- 热更兼容检查、弱更新提醒、强更新提醒和强制更新 Dialog。
- 手机端的无障碍、软键盘、安全区域、系统返回和深链行为。

明确不做：

- P2P 私密直连、房间、`#k=` 密钥、WebRTC、P2P 文件传输、本机 P2P 存档。
- 移动端多空间切换；首期只消费服务端返回的当前空间。
- Web 端的空间管理能力：邀请创建/撤销、成员角色与移除、成员可见性、容量策略、
  消息保留策略、空间资料编辑、操作记录查看和其他 owner/admin 设置。
- 把 operation record、transfer ledger、请求 ID、OAuth 原始 payload、存储 key
  或实时序号展示给普通成员。
- 在客户端自行放宽后端权限、配额、保留期或文件可见性。
- 用 OTA 绕过发布审核、原生能力变更或服务端最低版本门槛。

## 2. 主仓约束映射

| 主仓约束 | 移动端落地 |
| --- | --- |
| `WORKSPACE_ENABLED=true` 才开放 Workspace | 启动 bootstrap 返回 disabled 时显示“共享空间暂未开放”，不缓存或渲染空间数据 |
| OAuth 后按邀请/成员资格授权 | 原生只保存短期 access token 和受保护 refresh token；每次资源访问仍由后端授权 |
| `/api/workspace/bootstrap` 是 ready shell 的最小入口 | 登录后先 bootstrap，再进入会话列表；不并发发散成多个首屏请求 |
| 消息 envelope `version: 1`，内容 `duallane.message+json;v=1` | 解析器严格校验，发送只产生服务端支持的最低版本 |
| 未知 block 必须用 `plainText` fallback | 未知 block 不执行、不当作 HTML；显示低版本样式并保留安全纯文本 |
| `/ws/workspace` 使用 hello/ready/event/replay | 客户端保存游标，事件按 ID 幂等处理；`sync.required` 触发受控 refetch |
| 服务端是作者、时间、权限、配额和 canonical content 的真相 | 客户端 optimistic 状态只存在本地命令层，收到 canonical message 后按 `clientMessageId` 对账 |
| P2P 内容不得进 Workspace 存储 | 移动端工程依赖、路由、埋点和缓存均不包含 P2P 内容路径 |
| 发布版本与 `/api/health` 的 `appVersion` | 版本比较仍使用 SemVer；更新策略另由移动 release policy 返回，避免把 health 当完整更新协议 |

主仓当前已经有 Web 端的版本比较和弱提示，但那只能作为语义参考。移动端必须
增加原生安装包、OTA runtime、构建号和最低支持版本的完整模型。

## 3. 技术形态

推荐使用 **React Native + TypeScript + Expo Prebuild/EAS**，代码和主仓已有
TypeScript/React 经验复用，但把原生能力封装在移动端模块中。采用 Prebuild 而不是
纯 Expo Go，原因是 OAuth 回调、Keystore、Android 本地通知、可恢复分片上传和 OTA
运行时都需要稳定的原生配置。首期只构建 Android APK/AAB，不为 iOS 保留实现、证书和验收工作。

建议依赖边界：

- 导航：React Navigation，使用原生 stack 与 bottom tab；不引入 Web 路由兼容层。
- 网络：标准 `fetch` 封装 HTTP；WebSocket 使用原生实现；所有请求统一注入
  `X-DualLane-Client`、`X-DualLane-Client-Version`、`X-DualLane-Protocol-Version`。
- 服务端状态：轻量 normalized store（例如 Zustand + 自定义 domain reducer）；不把
  transport event 直接作为 UI state。
- 本地存储：Keystore 保存 token；SQLite 或受保护的 KV 只保存会话列表、
  最近消息、草稿和游标。缓存可丢失，不能成为 Workspace 数据的唯一副本。
- 更新：EAS Update 或同等自托管签名 OTA 服务；原生包只由 内部 APK 渠道交付。
- 文件：先复用主仓 HTTP 分片接口；由应用运行期间的任务封装暂停、恢复和网络变化处理。

选择这个形态的前提是移动端拥有独立的 release pipeline。若后续决定不采用 Expo
生态，React Native CLI 也可以实现同一领域边界，但必须保留本文的版本、签名和
后端契约，不应把架构退化为 WebView 套壳。

## 4. UI 规范与设计思路

### 4.1 设计判断

我把移动端理解为“可信小组的日常聊天工具”，而不是把 Web 工作台缩小到手机上。
因此设计优先级是：

1. **先到达内容**：登录成功后直接进入会话列表；不经过通道选择页，不展示管理后台。
2. **一次只处理一件事**：列表、聊天、详情、文件和成员使用单层导航，避免三栏压缩。
3. **内容优先于装饰**：消息、文件名、发送状态和未读是视觉主角，列表不逐条堆叠卡片。
4. **权限不制造第二套界面**：普通成员和管理员使用同一套组件；移动端直接不实现空间管理入口，
   服务端返回的管理 capability 不映射为按钮。
5. **状态必须可理解**：连接、发送、上传、版本更新和权限错误都用文字、图标和布局共同表达，
   不依赖颜色或动画单独传达含义。

这套取舍会让客户端少一层设置导航、少一组高风险管理表单，也减少手机端需要维护的权限分支。
空间管理仍由 Web/服务端管理面承担，移动端只提供个人会话退出、只读空间信息和日常协作能力。

### 4.2 移动端信息架构

根导航固定为四项：

| 导航 | 内容 | 说明 |
| --- | --- | --- |
| 聊天 | 会话列表和聊天页 | 登录后的默认落点；聊天页通过系统返回回到列表 |
| 文件 | 当前成员可见的文件库 | 上传、下载和配额提示；不提供容量策略编辑 |
| 成员 | 当前可见成员 | 搜索、查看资料、发起私聊；不提供角色或可见性管理 |
| 我的 | 个人身份、通知、主题、设备会话、只读空间信息、退出 | 不显示邀请、角色、保留和操作记录 |

会话详情从聊天页以全屏 Sheet 打开，包含概览、成员和会话文件。群成员增删、群重命名、
邀请管理等空间管理动作不在移动端出现；如果服务端因旧深链返回这些 capability，客户端仍只
渲染只读内容或安全的“不支持此操作”状态。

### 4.3 视觉 Token 与平台映射

主仓 Web 的 `清晰双轨` 是语义参考，不复制 Web CSS。移动端建立同名语义 token，再映射到
React Native StyleSheet 和 Android 原生控件：

| Token 类别 | 移动端规则 |
| --- | --- |
| `bg / surface / soft / elevated` | 中性背景和层次；消息列表以留白、分隔和轻微表面变化分组，不给每行加阴影 |
| `text / muted / line / focus` | 正文优先，辅助信息保持可读对比；焦点环和键盘导航使用独立 `focus` 语义 |
| `shared / shared-soft / on-shared` | Workspace 身份色，用于空间标识、当前会话选中和主要操作 |
| `success / warning / danger` | 发送成功、配额不足、失败和强制更新等状态；同时提供文字和图标 |
| `direct` | 移动端不启用 P2P，但保留 token 名称以防共享组件误用；不得渲染 P2P 入口 |

首期只发布一个默认主题，支持系统浅色/深色；主题结构保留 `ThemeDefinition -> semantic tokens -> component tokens`
的扩展点，后续若需要再加入主仓的其他主题家族。这样可以复用主仓的语义命名，又避免移动端同时
验收五套配色、原生控件和 OTA 兼容矩阵。

### 4.4 排版、几何与触控

- 使用系统字体栈和中文 fallback，不引入远程字体；消息正文 15–16sp，行高约 1.5–1.6。
- 页面标题 20–24sp，控件正文 14–16sp，辅助文字不低于 12sp；支持系统字体放大和 200% 内容缩放。
- 采用 4/8/12/16/24/32 的间距阶梯；常规控件圆角 10–12dp，输入区 16dp，Dialog 20dp。
- 所有主要按钮、列表行和图标按钮的触控命中区至少 44×44dp；图标不能依靠文字基线“看起来居中”。
- 消息气泡不使用强阴影；本人消息用 `shared-soft`，他人消息用 `surface`，身份、时间和状态始终有文字信息。
- 文件行固定预留下载/状态区域；长文件名最多两行，超出使用可访问的省略文本和详情页。
- 安全区域由 Safe Area Context 统一处理；底部导航和编辑器不能被刘海、手势条或键盘遮挡。
- Android 返回键、通知点击和通知权限请求遵循 Android 平台行为；不实现 iOS 专属导航或推送文案。

### 4.5 组件分层

```text
Platform primitives
  ├─ Button / IconButton / TextInput / Switch
  ├─ NativeStack / BottomTabs / Sheet / Dialog
  └─ SafeArea / KeyboardAvoiding / VirtualizedList
Mobile design primitives
  ├─ AppBar / TabBar / ListRow / Avatar / StatusBadge
  ├─ MessageBubble / MessageFallback / Composer / AttachmentRow
  └─ EmptyState / InlineError / UpdateBanner / ForcedUpdateDialog
Workspace features
  ├─ ConversationList / ChatScreen / ConversationDetails
  ├─ FileLibrary / MemberDirectory / AccountScreen
  └─ OAuthFlow / RealtimeClient / UploadTask / UpdateCoordinator
```

底层组件只负责几何、状态和可访问性，不读取 Workspace 权限；feature 层把服务端 capability
转换成可用操作。`MessageFallback`、`UpdateBanner` 和 `ForcedUpdateDialog` 是跨页面的稳定组件，
应通过 fixture 和状态矩阵测试，而不是在每个页面复制一份条件渲染。

### 4.6 关键页面状态

每个页面都必须定义 loading、empty、error、offline 和 success：

| 页面 | 默认状态 | 空态/错误处理 |
| --- | --- | --- |
| 会话列表 | skeleton 后显示最近会话 | 无会话时提供“从成员列表发起私聊”；缓存可读时显示离线条 |
| 聊天 | 保留消息滚动位置 | 空聊天仍保留编辑器；发送失败显示行内重试，不重复消息 |
| 文件 | 行列表和配额提示 | 无文件给上传入口（有权限时）；配额拒绝显示原因和重试 |
| 成员 | 可搜索列表 | 无结果说明当前范围；不能暗示不可见成员存在 |
| 我的 | 个人身份和只读空间摘要 | session 失效提供重新登录；不显示空间管理表单 |

页面切换使用短淡入或原生导航过渡，遵守 reduced motion；实时新消息不强制滚到底部。
移动端不使用持续脉冲、玻璃拟态大面积铺底或装饰性渐变，确保弱网、低端设备和高对比度模式下仍可读。

### 4.7 技术栈落地

| 层 | 选择 | 设计理由 |
| --- | --- | --- |
| App shell | React Native + TypeScript + Expo Prebuild/EAS | Android-only 交付，能配置 OAuth、Keystore、本地通知 和后台任务 |
| Navigation | React Navigation Native Stack + Bottom Tabs | 原生返回栈、深链和无障碍语义成熟；不引入 Web 路由兼容层 |
| UI primitives | React Native 内建组件 + 少量自有 primitives | Workspace 不是 Material/Fluent 管理后台；自有语义 token 能直接对应主仓设计系统 |
| State | Zustand store + domain reducer/selectors | normalized 数据、实时事件和 optimistic command 分离；避免把 Web 页面状态整块移植 |
| Validation | Zod（或等价 schema validator） | HTTP、WebSocket、release policy 和消息 fallback 共用运行时校验 |
| Network | fetch wrapper + 原生 WebSocket | 统一 token 刷新、超时、错误 code、重连和客户端版本 headers |
| Local data | SQLite/受保护 KV + Android Keystore | 缓存、草稿和游标可恢复；凭证与普通缓存分离 |
| Upload | 应用运行期间的任务封装主仓分片 API | 支持暂停/恢复、网络变化和 token 过期；不改变服务端配额语义 |
| OTA | EAS Update 或自托管签名 manifest | 只更新同 `runtimeVersion` 的 JS/资源，原生变化走商店包 |
| Notifications | Android 本地通知 + WebSocket | 原生通知替代 ntfy；按会话偏好投递，不携带消息正文、文件链接或 secret |
| Observability | 仅记录匿名诊断事件 | 不记录消息正文、文件名、token、邀请 secret、URL query 或实时序号 |

不建议引入整套跨平台 UI Kit、WebView、Redux Saga 或通用离线同步框架。它们会增加主题覆盖、
原生行为偏差和升级成本，而本项目的核心复杂度在协议兼容、权限边界、实时恢复和版本策略。

## 5. 启动与导航

### 5.1 冷启动状态机

```text
boot
  -> load local client metadata
  -> check release policy
  -> restore token
       -> no token / expired token -> Login
       -> token present -> Bootstrap
             -> disabled -> Disabled
             -> needs_login -> Login
             -> not_invited -> NotInvited
             -> ready -> ConversationList
             -> network failure + usable cache -> CachedConversationList + OfflineBanner
             -> protocol incompatibility -> UpdateRequired
```

版本策略检查可以与 token 恢复并行，但不能在强制更新状态下渲染聊天内容。更新策略
响应失败时，若已有可用安装包和有效 session，允许进入缓存页面并显示“无法检查更新”；
当服务端明确返回 `minSupportedVersion` 高于当前版本时必须阻断 Workspace 数据访问。

### 5.2 页面结构

手机一次只显示一个主窗格：

1. **Login**：只有“使用 GitHub 登录”和邀请上下文说明。
2. **ConversationList**：默认登录后的首页；显示当前空间、会话、未读、连接状态和
   新建私聊/群聊入口（权限允许时）。
3. **Chat**：返回会话列表、标题、成员/详情入口、消息流和底部编辑器。
4. **DetailsSheet**：会话概览、成员、文件和会话级操作；手机为全屏 sheet。
5. **Files**：文件列表、筛选、配额提示、下载和上传。
6. **Members**：成员搜索、成员详情和发起私聊。
7. **SpaceInfo**：只读空间名称、当前身份、成员数、配额和保留说明；不提供管理入口。

不提供 P2P 入口、不提供通道选择页、不提供“进入 Workspace”二次确认。邀请链接只用于
承接登录和入场，不在客户端创建或管理邀请。深链只承接邀请、会话和文件详情；深链目标
无权访问时显示安全错误，不通过导航泄露资源存在。

### 5.3 移动交互要求

- `<=760px` 采用 list → main → details 的单窗格流；详情返回不清空草稿或阅读位置。
- 编辑器避开安全区，软键盘出现时输入框和发送按钮仍可见；多行高度有上限。
- 系统返回优先关闭详情/弹层，再返回聊天，再返回列表；不能直接退出登录。
- 触控目标、焦点顺序、读屏 label、减少动画和错误 live region 遵循主仓移动可访问性设计。
- 新消息到达而用户正在看历史时不强制滚底；提供“回到最新”。主动发送成功后回到目标会话最新位置。

## 6. 客户端领域模型

```ts
type MobileClientState = {
  session: {
    status: "anonymous" | "authenticating" | "authenticated" | "expired";
    accessTokenExpiresAt: number | null;
  };
  workspace: WorkspaceBootstrap | null;
  membersById: Record<string, MemberView>;
  conversationsById: Record<string, ConversationView>;
  conversationOrder: string[];
  messagesByConversationId: Record<string, MessageListView>;
  attachmentsById: Record<string, AttachmentView>;
  draftsByConversationId: Record<string, Draft>;
  localCommands: Record<string, LocalCommandView>;
  realtime: { state: RealtimeState; lastSeq: number; seenEventIds: string[] };
  update: UpdateState;
};
```

本地 optimistic message 必须有 `clientMessageId` 和 `status: sending|failed`，服务端
返回后按 `(conversationId, clientMessageId)` 对账；重试不得生成新的逻辑消息。事件处理
按 event ID 去重，按 seq 检测缺口；不能把 seq 展示给用户。

客户端只保留主仓规定的产品视图字段：成员、会话、消息、附件、配额、能力和安全错误。
`capabilities` 在移动端只用于隐藏不适用的会话动作；空间管理 capability 即使服务端返回，
也不映射为移动端页面或入口。
原始事件、operation record、数据库行、存储 locator 和 OAuth provider 数据不得进入
普通 UI store。

## 7. 消息协议与低版本兼容

### 7.1 解析分层

所有服务端消息先通过三层解析器：

1. **Envelope validator**：检查 JSON 对象、`version`、`type`、ID、时间和 payload 基础类型。
2. **Content validator**：检查 `content.format` 和 blocks 的有限字段；文本按纯文本处理，
   不执行 HTML、脚本、远程组件或未经授权的链接预览。
3. **Renderer registry**：按已知 block/message kind 选择渲染器；未知项交给 fallback。

解析器永不因为一条消息失败而中断 WebSocket。失败消息转换为本地安全对象：

```ts
type FallbackMessage = {
  id: string;
  kind: "fallback";
  authorLabel: string;
  createdAt: string | null;
  plainText: string;
  reason: "unknown_version" | "unknown_block" | "malformed" | "unsupported_kind";
  canRetryAfterUpdate: boolean;
};
```

### 7.2 三种兼容结果

| 输入 | 移动端行为 | 用户看到的样式 |
| --- | --- | --- |
| 已知 envelope + 已知 blocks | 正常渲染 | 正式消息气泡、附件、回复等 |
| 已知 envelope + 未知 block | 丢弃未知 block，使用服务端 `plainText` | 低版本消息气泡，附“部分内容暂不支持” |
| 未知 major version、格式错误或未知 kind | 不执行 payload；只读 `plainText` | 灰色低版本卡片，显示“此消息需要更新应用后查看”与“检查更新” |

如果没有安全的 `plainText`，显示固定文案“此消息暂不支持，请更新应用后查看”，不得把
原始 JSON、base64、链接或错误栈展示出来。fallback 仍保留作者和时间（字段有效时），
不显示未知附件操作、不自动下载、不触发 Bot/深链。

### 7.3 协议升级规则

- 客户端声明支持的 `messageEnvelopeMajor` 和 `contentFormats`；服务端不得向不支持的
  客户端发送不可回退的内容。
- 新字段优先 additive；破坏性变更升 major，并同时发布低版本 `plainText`。
- 客户端发送前只生成 `duallane.message+json;v=1`，直到后端明确发布新格式和兼容窗口。
- 协议不兼容属于强更新候选；仅有未知 block 属于弱提示/可继续使用。
- 每个新 block、kind、event payload 都要有旧客户端 fixture，验证 fallback 结果。

## 8. 版本与更新体系

### 8.1 版本字段

移动端同时维护以下字段：

| 字段 | 示例 | 用途 |
| --- | --- | --- |
| `appVersion` | `0.1.0` | 用户可见 SemVer；与发布说明对应 |
| `versionCode` | `1` | Android 单调构建号 |
| `runtimeVersion` | `android-1` | OTA 原生运行时兼容组 |
| `protocolMajor` | `1` | 消息/实时 envelope 主版本 |
| `clientChannel` | `internal` | 当前只发布内部 APK/AAB，参与灰度策略 |
| `gitCommit` | 仅诊断 | 不进入普通 UI，不上传消息内容 |

SemVer 比较规则与主仓一致：只比较 `major.minor.patch`，无法解析的版本不判定为更新成功；
服务端版本不得通过降级覆盖本地高版本。构建号用于商店比较，不能取代 SemVer 的协议判断。

### 8.2 Release policy 响应

建议后端新增同源、可匿名读取的：

```text
GET /api/mobile/release-policy?platform=android&channel=internal&appVersion=0.1.0&versionCode=1&runtimeVersion=android-1
```

响应示例：

```json
{
  "schemaVersion": 1,
  "serverTime": "2026-09-16T03:00:00.000Z",
  "platform": "android",
  "channel": "internal",
  "latest": {
    "appVersion": "0.2.0",
    "versionCode": 2,
    "runtimeVersion": "android-1",
    "releaseId": "android-0.2.0-2",
    "releaseNotes": ["消息列表性能优化"]
  },
  "minimum": {
    "appVersion": "0.1.0",
    "versionCode": 1,
    "reason": "security_or_protocol"
  },
  "recommendation": "soft",
  "ota": {
    "available": true,
    "runtimeVersion": "android-1",
    "manifestUrl": "https://updates.example.invalid/manifest.json",
    "sha256": "...",
    "expiresAt": "2026-10-01T00:00:00.000Z"
  },
  "apkUrl": "https://downloads.example.invalid/duallane-0.2.0.apk"
}
```

服务端不应只返回一个 `latestVersion` 字符串。`minimum` 是安全/协议硬门槛，
`recommendation` 是产品提醒，`ota.runtimeVersion` 决定能否热更，APK URL 是内部包更新入口。
响应本身应由服务端签名或通过受信任的同源 HTTPS 提供；manifest、bundle 和 hash 必须校验。

### 8.3 热更（OTA）

允许热更的内容：JS bundle、静态资源、消息渲染器文案和兼容性 bug 修复。

热更前置条件：

- `runtimeVersion` 完全匹配；原生模块、权限、数据库 schema、OAuth 回调和协议 major 不变。
- manifest、bundle、资源 hash 和签名校验通过。
- 不低于服务端 `minimum`，不覆盖正在使用的稳定 bundle。
- 下载后在后台准备，下一次安全启动切换；切换失败自动回滚上一个 bundle。
- OTA 失败、过期、签名不合法或运行时崩溃不得阻断已有可用版本，除非 `minimum` 已要求强更。

热更不修改服务器协议、不改变后端权限、不绕过 Android APK/AAB 的原生更新规则。

### 8.4 弱更新提醒

触发：当前版本低于 `latest`，但不低于 `minimum`，且没有安全强更原因。

- 首次进入会话列表显示顶部可关闭 banner：“发现新版本，建议更新”。
- 点击查看更新说明；“稍后”按 `releaseId` 记录本地，默认 24 小时后再提醒。
- 若存在兼容 OTA，优先后台下载，完成后提示“下次启动生效”；用户可继续聊天。
- 低版本 fallback 消息出现时，弱提醒升级为当前上下文中的提示，但不打断发送/阅读。

### 8.5 强更新提醒

触发：版本低于 `latest` 且服务端 recommendation 为 `strong`，但当前版本仍可安全运行。

- 登录后或回到前台显示不可忽略的 update sheet；允许“立即更新”和“稍后”。
- “稍后”只允许延迟一个服务端配置的时间窗（建议 24 小时），不能永久关闭。
- 若是 OTA，下载完成后要求重启；若是APK/AAB 原生包，打开 APK 下载入口。
- 聊天页面保持当前草稿；更新流程不自动发送草稿。

### 8.6 强制更新 Dialog

触发：当前 `appVersion/buildNumber` 低于 `minimum`，或者协议/安全版本不兼容。

- 启动阶段阻断 Workspace 数据请求，显示不可关闭 Dialog：原因、当前版本、最低版本、
  “立即更新”按钮和无法打开下载链接时的复制链接/重试。
- 不提供“跳过”；返回键、遮罩和系统返回都不能关闭。
- 只有 release policy 明确 `minimum` 已低于当前版本，或更新成功后重新检查，Dialog 才关闭。
- 更新端点、APK 下载地址和 policy 解析失败时不能把用户误判成强更；网络恢复后重试，并显示
  “暂时无法检查更新”。服务端已经明确强更后，短时离线只能显示强更 Dialog，不进入在线聊天。

更新状态机：

```text
unknown -> checking -> up_to_date
                    -> soft_available -> dismissed|downloaded
                    -> strong_available -> deferred|updating
                    -> forced -> blocked_until_updated
checking/network_error -> cached_decision|retry
```

## 9. 认证、会话与安全存储

主仓浏览器使用 session cookie；原生端不应把 cookie 方案当作唯一依赖。建议后端补充
OAuth PKCE 原生流程：

1. 移动端请求一次性 `state`、PKCE challenge 和短期授权上下文。
2. Android 使用 Custom Tabs；不在 WebView 中收集 GitHub 密码。Android OAuth 适配使用 Custom Tabs。
3. 回调到 App Link，携带一次性 code，不携带 access/refresh token。
4. 移动端用 code + verifier 调用 exchange，获得短期 access token、轮换 refresh token 和过期时间。
5. access token 只放内存；refresh token 放 Keystore，退出登录时撤销并删除。

建议新增：

```text
GET  /api/auth/mobile/github/start
POST /api/auth/mobile/github/exchange
POST /api/auth/mobile/logout
POST /api/auth/mobile/refresh
```

refresh 必须轮换并检测重放；token 不进 URL、日志、埋点或消息。所有 API 仍在服务端
重新检查 membership、conversation、file 和 capability。

WebSocket 建议使用短期一次性 ticket：

```text
POST /api/auth/mobile/ws-ticket
GET  /ws/workspace?ticket=<one-time-ticket>&lastSeq=42
```

ticket 只允许一次握手、短过期、绑定 user/device/session；服务端继续按会话成员关系过滤事件。
移动端使用 Authorization Bearer 握手，服务端日志必须完成 token 脱敏。

## 10. Android 本地通知

采用 WebSocket → 事件校验和状态应用 → 后台状态/会话提醒偏好判断 → 去重 → 本地通知。
不接远程推送、厂商推送、推送 token API 或通知队列；不配置 Firebase，不做前台服务或保活。
Android 13+ 登录后由用户开启通知权限，拒绝不影响聊天。使用一个消息 channel；
前台不提醒，后台仅显示他人消息，遵守 all/mentions/muted。历史 replay、重复事件和本人消息
不通知。内容固定为“有新消息”，点击后重新登录/授权再进入会话，退出清除本账号通知。
普通后台允许延迟；Doze、进程回收或强行停止时不承诺即时提醒，恢复应用后同步。
ntfy 本轮不删除、不迁移，待实际使用验证后另行决定。

## 11. 后端需要新增或确认的能力

以下项目是移动端进入开发前的后端依赖；其中带“必须”的项目不应靠客户端 workaround。

| 优先级 | 后端能力 | 具体要求 | 影响范围 |
| --- | --- | --- | --- |
| 必须 | 原生 OAuth/会话 | PKCE、一次性 code、token 轮换、撤销、设备绑定/会话列表 | auth、数据库、审计 |
| 必须 | Release policy | 平台/渠道/版本/build/runtime 的 latest、minimum、recommendation、OTA 与APK URL | 新 API、发布后台或静态清单 |
| 必须 | 签名更新清单 | manifest/bundle/resource hash、签名、过期和回滚元数据 | CDN/对象存储、发布流水线 |
| 必须 | 客户端协议协商 | bootstrap 或独立 endpoint 返回支持的 message/event major、capability 和兼容窗口 | Workspace API、消息服务 |
| 必须 | 原生 WebSocket 认证 | ticket 或标准 bearer 握手，不依赖浏览器 cookie | auth、realtime、日志脱敏 |
| 必须 | 安全错误与版本字段 | 保持稳定 error code；明确 `protocol_unsupported`、`client_update_required` 等分支 | API 契约、测试 fixture |
| 必须 | 文件移动端续传 | 分片状态查询、幂等、超时释放配额；确认后台任务的 token 和过期策略 | 文件上传服务、配额 |
| 建议 | 设备会话管理 | 用户查看/撤销设备，refresh 重放自动撤销对应会话；移动端只做个人会话管理，不做空间管理 | auth、个人设置 |
| 建议 | 更新灰度 | channel、rollout、region/设备过滤和 kill switch | release service |
| 可后置 | 远程配置 | 只下发非安全 UI 配置，带 schema/version/默认值 | config service |

移动端不要求后端为它开放空间管理 API。邀请、角色、容量、保留、成员可见性等能力继续由
主仓或 Web 管理端承担；移动端只消费服务端已经授权的结果，并将空间信息呈现为只读。

主仓已有 `/api/health` 和 Workspace bootstrap 的 `appVersion`/事件游标语义。建议保留旧
字段兼容，不把 release policy 塞进 health；health 用于存活与简单版本观测，release policy
用于更新决策。

## 12. 离线、重连与数据策略

- 有效缓存时允许浏览最近会话和最近消息；发送、上传、下载在无连接时显示明确失败/待重试状态。
- 草稿持久化到本地，按 conversation ID 隔离；退出登录清理 token 和私有缓存。
- WebSocket 状态使用 `connecting/ready/reconnecting/sync_required/offline`；HTTP 仍可用时不阻断整个 shell。
- 收到 `sync.required` 或游标缺口时，先保留当前视图，再 refetch bootstrap、会话列表和当前消息窗口。
- session 过期只清理认证数据并回到 Login；不能把失效 token 写入下一次请求。
- 本地缓存不承诺跨设备同步，不作为审计或永久备份；Workspace 的 canonical 数据仍由服务端提供。

## 13. 测试与验收

### 13.1 协议与状态测试

- `version: 1` 正常消息、未知 block、未知 kind、未知 major、缺失 plainText、错误类型和恶意 HTML fixture。
- 同一 event 重放、乱序、seq 缺口、`sync.required`、重复 `clientMessageId` 和服务端 canonical reconcile。
- 每个错误 code 映射到安全中文文案，不渲染 request ID、token、URL secret 或内部路径。

### 13.2 更新矩阵

| 当前安装 | policy | 预期 |
| --- | --- | --- |
| `< minimum` | forced | 启动阻断，Dialog 不可关闭 |
| `>= minimum < latest` | soft | 可聊天，banner 可关闭并按 releaseId 延迟 |
| `>= minimum < latest` | strong | update sheet，有限期延迟 |
| runtime 匹配且有签名 OTA | ota | 后台下载，下次启动切换，失败自动回滚 |
| runtime 不匹配 | store | 打开 APK 下载入口，不尝试 OTA |
| policy 网络失败 | unknown | 已有可用版本继续；显示可重试的检查失败状态 |
| 当前版本高于服务端 latest | stale policy | 不降级、不提示错误，记录诊断 |

### 13.3 设备验收

- Android 真机：登录、App Link、系统返回、软键盘、安全区域、后台恢复。
- 375×667、390×844、768×1024 以及横竖屏切换；聊天列表、详情、文件和强更 Dialog 无溢出。
- 弱网、断网、进程杀死、token 过期、可恢复上传、重复通知和 OTA 下载中断。
- TalkBack：按钮名称、消息 fallback、错误 live region、Dialog 焦点陷阱和返回焦点。
- 安全：token 不出日志/URL，fallback 不执行未知内容，OTA 签名/hash 错误拒绝安装。

### 13.4 发布门槛

- 主仓 Workspace API/实时/消息/文件契约测试通过。
- 移动端单元、组件、契约、真机 smoke 和关键 Playwright/服务端集成路径通过。
- `minimum/latest/runtime/protocol` 与Android 包、OTA manifest、release notes 一致。
- 至少完成一次 OTA 失败回滚和一次强制更新回退演练。
- 发布前确认 Workspace disabled、未登录、未邀请、权限拒绝和配额拒绝均为安全状态。

## 14. 分阶段交付

### M0：基础壳与契约冻结

初始化 React Native 工程、CI、签名存储、环境分层、版本字段、release policy fixture、
消息解析器和 fallback renderer；此阶段不接 P2P 依赖。

### M1：Workspace 核心可用

完成 PKCE 登录、bootstrap、会话列表、聊天、消息发送/重连、草稿、基础文件上传下载、
弱更新 banner 和强制更新 Dialog。

### M2：生产移动能力

完成本地通知、可恢复上传、设备会话、OTA 签名/回滚、强更新 sheet、灰度发布和真实设备验收。

### M3：协议演进

在有实际产品需求时加入新 block、回复/表情/卡片；每次变更先更新主仓协议、fallback fixture、
后端 capability 与 release policy，再更新移动 renderer。P2P 仍不进入移动端范围。

## 15. 关键决策结论

1. 移动端是 Workspace 专用客户端，冷启动只在 Login 与 ConversationList 之间分流；空间管理留在 Web/服务端管理面。
2. 兼容性以“安全纯文本 fallback + 低版本样式”为底线；未知消息不能阻断实时连接，也不能执行未知内容。
3. 热更只覆盖同一 `runtimeVersion` 的 JS/资源；原生、协议 major 和最低安全版本变化必须走商店/企业包更新。
4. 弱更新允许继续使用，强更新允许有限延迟，最低版本以下必须用不可关闭 Dialog 阻断 Workspace。
5. 原生 OAuth token、WebSocket 认证、release policy、签名 manifest、移动端续传和推送是后端必须协作的能力；空间管理 API 不属于移动端依赖。
6. 客户端隐藏能力只改善体验，后端仍是权限、配额、保留、审计和可见性的唯一权威。
