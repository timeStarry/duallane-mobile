# Android Workspace 整体评估与下一轮迭代计划

评估日期：2026-09-19 至 2026-09-20（任务跨午夜）。结论：**推进方向基本合理，已有成果值得保留；当前仍属于功能覆盖较广、业务闭环和原生交互尚未稳定的内部测试版，不能认定 Workspace 聊天全功能已完成。**

下一轮的首要任务是补齐权限／数据边界、真实 Go 契约和跨端事件链，其次把编辑器、对象操作、阅读与媒体做成完整的手机任务流程，再落实视觉和动效。现阶段不需要更换 RN 技术栈或重做整套服务端。

## 1. 评估对象与证据边界

| 对象 | 基线与实际检查 |
| --- | --- |
| 移动主线 | `199d055`，包含上一轮 R0–R3 接入及后续登录／网络／图片／表情修复 |
| 本轮推进成果 | [PR #11](https://github.com/timeStarry/duallane-mobile/pull/11)，`feat/android-ux-iteration`，[`7803e5fa`](https://github.com/timeStarry/duallane-mobile/tree/7803e5fa22ed3ab03b130bad0d72dd6711c027e6)，工作树 `D:/Project/duallane-mobile-redesign` |
| 主仓对照 | `duallane@9b5956a7` 的现行设计规范、Web 实现与 Go 路由／响应／事件；未把旧路线图当作当前接口事实 |
| 本机检查 | 在 `7803e5fa` 执行 `corepack pnpm check`：24 suites / 127 tests 通过；TypeScript 通过，lint 0 error / 1 warning（MessageContent effect 缺少 file 依赖）；18 份文档检查通过 |
| CI | PR #11 当前 package-smoke、mobile-check 成功；[包检查运行](https://github.com/timeStarry/duallane-mobile/actions/runs/35433081470)只提供既定构建／启动范围的证据 |
| 真实测试机 | M2007J3SC，Android 13 / API 33，物理分辨率 1096×2560，density 420；已安装 `0.1.0 / versionCode 1`，APK SHA-256 `80906566410f3e0431bcde0f7ebe00fa739a348e18dc1e96a23fffa26758c5ab` |
| 真机实际观察 | 用户解锁并手动进入测试会话、展开键盘；已观察会话列表、连接状态、聊天长链接、头部及 IME 停靠。系统仍拒绝 ADB 输入，本轮未声称完成自动点击、消息发送、长按、TalkBack 或多步手势测试 |
| 合成实验 | 在内存中运行真实 Runtime 源码，使用按 Go 实现构造的响应确认撤回方法、隐藏／反应／已读响应、附件失败恢复；无真实业务写入。它证明客户端逻辑问题，不代替真服务端双向联调 |

本轮没有修改应用实现、生产数据或测试机安装。真机原始截图留在本机私有测试目录，不随报告发布；本文只描述与评估有关的界面现象，不包含真实消息、成员或文件内容。

CI 产物下载本轮未完成，已停止该下载；已安装 APK 与 PR head 的二进制一致性尚未核对。因此真机观察严格对应上表 APK hash，源码结论对应 `7803e5fa`，不能把两类证据合并成“当前提交所有功能已在真机验证”。

## 2. 已有推进中合理的部分

| 方向 | 评价 | 应保留的基础 |
| --- | --- | --- |
| DL 语义与原生布局分离 | 合理 | 原色 token、单层对象头部、四根导航、聊天内会话／话题切换、左右气泡、完整详情页；不压缩 Web 三栏 |
| 共享组件与功能拆分 | 合理 | 已从单一 screens 骨架拆出 chat／account／members／files 与 ui 组件；同一 ChatScreen 承接普通会话与话题 |
| 内容和对象模型扩展 | 明显进展 | 结构化 blocks、回复、@、表情、反应、撤回、隐藏、常驻、话题和卡片均已有不同程度实现，不能再按旧版“只有纯文本”评价 |
| 聊天输入与键盘所有权 | 原则合理、实现未闭环 | Chat 独占 inset 的 ADR 能避免系统 pan 与 JS 偏移叠加；真机当前键盘展开时输入和发送区可见，值得继续完善 |
| 日期、连续消息、未读和隐藏分组 | 有效推进 | 使用明确的领域规则而非逐条堆卡片；仍需真实列表与状态切换验收 |
| HTTP 回退与状态表达 | 回退有价值 | 网络受限时仍能读取；页面没有伪称 WebSocket 已连接。但 8 秒轮询不能成为完整即时聊天的完成标准 |
| 测试与验收记录 | 有基础，界限较诚实 | `R3.md` 保留真机／跨端“未运行”，没有用单测代替设备验收；应继续扩充真实契约与状态测试 |

借鉴飞书的手机信息架构可以成立，但应把可取之处写成 DL 自己的任务规范：单手可达、清晰对象、键盘与面板协作、稳定阅读位置、可取消且可发现的操作。品牌、业务对象和权限后果仍以 DL 为准，不能用“像飞书”代替验收标准。

现有迭代文档的“缺口主要在体验，而不是协议”“MSG-01～12 已接线”等表述需要降为“有模型与入口，闭环待验证”。下面的问题说明一些按钮尚不能正确完成真实业务。

## 3. 已确认的高优先级问题

以下 P1 表示应优先修复并阻断扩大交付；P2 表示需要在本次完整体验验收前修复。风险结论来自源码／真实契约或合成实验；没有据此宣称已发生真实数据泄露。

### 3.1 权限、缓存与发送完整性

| ID | 问题与证据 | 用户后果 | 修复验收 |
| --- | --- | --- | --- |
| F01 / P1 | 话题附件选择未传 conversationId，[Chat:405](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/features/chat/screens.tsx#L405) → [Transfers:121](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/transfers.ts#L121) 明确选择 `visibility: space`，而非 `private_staging` | 话题尚未发出或发送失败时，附件可能先成为空间文件，扩大可见范围 | 以不在话题内的成员核对上传中、完成未发、取消、失败、成功五种状态；都不能提前通过文件库获取私有附件 |
| F02 / P1 | [media:45](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/media.ts#L45) 预览磁盘缓存只按 file.id 命中直接返回；[退出清理](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/runtime.ts#L255)只管理传输副本，未清这类预览 | 撤权、退出或换账号后仍可能残留、复用私有图片；权限变化未贯穿媒体层 | 建立账号／服务／空间缓存作用域、撤销与在途响应隔离；旧账号图片不可在切换后恢复，清理可验证 |
| F03 / P1 | [Runtime.send:135](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/runtime.ts#L135) 上传后的 file.id 只加入临时 blocks；失败恢复上传前消息，草稿已释放 | 上传成功但消息响应丢失后，失败行丢附件，重试可能只发文字、无法发送或发生幂等冲突；合成实验已复现 | 待发送命令保存完整目标、引用、文件 ID／任务及逻辑 ID；上传完成、消息成功和消息回执丢失分别恢复，跨页重试不改内容 |
| F04 / P1 | [Store:55](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/domain/store.ts#L55) 保留所有 topic 缓存；topic 从列表消失不重验／清理消息，Chat 在对象缺失时仍进入消息列表分支 | 退出话题、移出父群或失权后，超出当前合法范围的旧正文／草稿可能继续停留 | 明确撤权或目标重验确认无权后关闭页面、清理受限缓存与任务并拒绝迟到响应；列表缺项先重验，保留仍合法的未加入摘要访问，不把缺项直接等同失权 |

### 3.2 HTTP 与实时契约

| ID | 当前偏差 | 证据与通过标准 |
| --- | --- | --- |
| F05 / P1 | 撤回调用不带 body／method，`ApiClient.json` 默认发 GET；Go 只接受 POST | [Runtime:198](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/runtime.ts#L198)；[Go 路由:115](https://github.com/timeStarry/duallane/blob/9b5956a7c48d19897615e81df7f76f3cca3527de/apps/backend/internal/workspace/httpapi/core_routes.go#L115)。合成实验确认 GET。须覆盖请求方法、确认、真实成功响应、跨端回显与失败重试 |
| F06 / P2 | 隐藏返回 `{messageId,hidden,changed}`、反应返回 `{messageId,reactions}`；客户端尝试按完整 message 处理，响应未正确更新状态 | [Runtime:199](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/runtime.ts#L199)、[Go:424](https://github.com/timeStarry/duallane/blob/9b5956a7c48d19897615e81df7f76f3cca3527de/apps/backend/internal/workspace/httpapi/core_routes.go#L424)。离线合成实验确认状态不更新；不能依赖下一次轮询掩盖成功响应被丢弃 |
| F07 / P2 | 话题已读响应实际为 `{read:{...}}`，聊天 Runtime 按顶层解析，抛 ZodError 后被页面吞掉 | [Runtime:151](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/runtime.ts#L151)、[Go:223](https://github.com/timeStarry/duallane/blob/9b5956a7c48d19897615e81df7f76f3cca3527de/apps/backend/internal/workspace/httpapi/topic_routes.go#L223)。复用已存在的 `inbox-read.ts` 正确 schema，验证两端读游标 |
| F08 / P1 | Go 的 `topic.message.created` 携带消息引用；客户端只刷新话题列表，未补取当前话题消息，通知分支只认普通 `message.created` | [Runtime:226](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/data/runtime.ts#L226)。WS 健康时也有话题消息／通知缺口；必须分别跑健康 WS 和 HTTP 回退，不能只在回退模式测通 |
| F09 / P2 | 卡片“加入话题”未传卡片 revision，Go 要求 expectedRevision ≥1 | [cards:92](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/ui/cards.tsx#L92)。传正确 revision，冲突时刷新卡片；同一动作重试复用标识，未加入／已加入／过期各有结果 |
| F10 / P1 | 聊天已读只判断前台与近底，未要求导航聚焦 | [Chat:214](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/features/chat/screens.tsx#L214)。详情／媒体盖在聊天上时不得误标新消息已读；以屏幕真正可见范围推进游标 |

这些已有 Go 能力优先修客户端适配，不需要为匹配错误客户端另加一套返回格式。接口测试应由真实 Go 响应 fixture 驱动，涵盖 method、body、返回 envelope、失败码和对应事件。

## 4. UI、手机任务与动效评估

### 4.1 真机已观察到的现象

1. 列表有头像、最近摘要、时间、底部导航与会话／话题切换，聊天有单层对象头部；已经超出首包的通用表单骨架。
2. 当前输入框和发送区停在系统键盘上方，没有在这一屏观察到双重键盘空白或发送区被遮挡。这只证明当时的机型／IME／状态，不证明表情切换、旋转和其他机型已通过。
3. 同一 URL 在气泡内出现黑色原文和追加的蓝色 URL，增加大段重复内容；这是渲染重复，不是重复发送。源码 [MessageContent:148](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/ui/MessageContent.tsx#L148) 与观察一致。
4. 列表和聊天均出现黄色“HTTP 同步／重新连接”状态。诚实说明连接质量是正确的，但技术术语与常驻大条占据了内容空间；应修复实时链路，并把恢复中的用户提示做成稳定、紧凑的状态，技术诊断放到按需展开的详情。

### 4.2 源码确认、待设备验证的问题

| ID | 具体不足 | 下一轮要求 |
| --- | --- | --- |
| U01 / P1 | [useChatIme:34](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/ui/useChatIme.ts#L34) 有 @ 候选就强制打开 mention 并关键盘；返回关闭后 effect 又重开，也会覆盖附件／表情面板 | 用输入中、候选、表情、附件、已关闭查询的明确状态机；@ 候选应允许继续输入筛选；返回／取消不能被 effect 撤销 |
| U02 / P2 | @ 候选 host 固定高度、overflow hidden，最多 8 行直接 map，默认高度装不下全部项 | 候选可滚动，有头像与可达的关闭／返回；窄屏和大字都能选到最后一项 |
| U03 / P1 | [ConversationRow](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/ui/chrome.tsx#L165) 的 onPress 依赖 onPressIn 设置 ID；无障碍激活可直接触发 onPress | 非触摸激活也必须进入会话／话题；分别测试 TalkBack 双击与触摸中列表重排保护 |
| U04 / P1–P2 | 动作簇插入消息行改变行高，各行独立开关，缺唯一浮层／外点／滚动／返回取消；更多只在长按后出现，反应与读屏动作未完整复用能力表 | 一个对象动作注册表驱动可见入口、长按、读屏；锚定浮层不改变时间线高度；同一时刻仅一个菜单，取消无副作用 |
| U05 / P1 | “撤回”从 Sheet 直接调用 API，danger 仅改颜色，无确认 | 明确目标与后果的确认，取消零请求，提交失败有恢复。修 F05 同时修交互，不能只把错误 GET 改成真实撤回后保留误触风险 |
| U06 / P2 | [MediaViewer:22](https://github.com/timeStarry/duallane-mobile/blob/7803e5fa22ed3ab03b130bad0d72dd6711c027e6/src/ui/MediaViewer.tsx#L22) 吞异常后永远加载；默认 cover 裁切长图／宽图；下载错误被吞 | 图片完整可见、正确宽高比，加载／失败／重试／终态分开；下载与分享结果可理解；底部操作避开系统栏 |
| U07 / P2 | Sheet／Dialog 缺受限高度、内部滚动与完整安全区；固定单选偏好统一使用 tab 语义 | 横屏、200% 字体、三键导航下取消与主要动作可达；偏好用单选语义，导航用 Tab 语义 |
| U08 / P2 | 120／180／200／160ms 主要只是 token；实际 Modal 只依据其是否为零决定 fade／slide；按压瞬时 opacity，导航和滚动未全面遵循 reduceMotion | 把时长接入实际过渡，系统减少动态贯穿导航、列表、滚动、菜单与键盘面板；先稳定布局，再做克制的连续反馈 |
| U09 / P2 | 气泡分组中段只有一侧直角，另一侧仍逐条圆角，与本轮自己的 middle 全直角规则不一致 | 固定组首／组中／组尾／打断的四角与间距，按实际短句、引用、未读和日期边界评审 |

目前不能用“引入了 Reanimated／手势库”证明有完整动效系统，也不能用“有 48dp token”证明所有无障碍任务可完成。

## 5. 离 Workspace 日常聊天完整体验还缺什么

这里的完整范围是移动端已批准的 Workspace 日常聊天，不扩展到 P2P、空间管理后台、Bot 凭证管理、FCM／保活、跨设备草稿或未定义的全文检索／通用编辑。

| 能力 | 当前准确判定 | 下一步完整标准 |
| --- | --- | --- |
| 普通消息、回复、反应、撤回、隐藏、常驻 | 入口和模型已有，部分命令／响应有缺陷 | 各动作在 Web↔Android 双向往返，一次提交、正确权限、失败恢复与状态收敛 |
| 正文／Markdown | 部分子集；存在重复链接，标题／列表／引用／围栏代码等未达到 Web 同等语义 | 采用共同的内容 fixture 与安全子集，原位链接、长内容和代码可读；未知才 fallback |
| 回复定位与历史 | 只在已加载列表找原消息 | 跨页补取、锚点定位与返回原阅读位置；失权／保留清理有准确占位 |
| 话题 | 页面和参与流程已有，实时、已读、附件范围尚有缺口 | 普通聊天与话题共用完整管线；话题成员候选使用合法范围；本群话题列表就近可达 |
| 图片与文件 | 分片、选择后发送、预览与分享已有，缓存／重试／终态不完整 | 文件上传→消息关联→预览→下载→分享全生命周期，明确内容、可见范围、费用及结果 |
| 卡片与表情合集 | 话题卡与 Echo release 有原生展示；其他卡片／合集能力仍有限 | 先完成日常已注册卡片和动作版本；合集不能长期只剩标签，按批准范围补查看／使用／导入 |
| 未读与本地通知 | 基础设施已有，话题及回退链路未闭环 | 正确前台可见已读；真实 WS、回退、后台恢复和重复事件分别验收，不承诺进程死亡即时推送 |
| 原生人体工学 | 头部／键盘基础改善，复杂手势和取消路径不足 | 单手主要动作、IME 交互、返回、菜单、长图、窄屏／大字、辅助技术能连续完成任务 |

## 6. 下一步迭代计划

采用能独立验证的 PR 单元；每个单元同时包含功能／交互、失败状态和证据。按依赖推进，不按“组件代码写了多少”判断完成，也不预估没有基线支撑的固定工期。

### I0：修复交付阻断项，建立可靠契约基线

| 单元 | 负责范围 | 内容 | 完成门槛 |
| --- | --- | --- | --- |
| I0-A 权限与缓存 | transfers、media、store、runtime | F01/F02/F04：private_staging、账号隔离、撤权清理、迟到响应保护 | 非参与成员附件不可见；退出／失权／换账号不恢复旧图或正文；回归覆盖上传未发与取消 |
| I0-B 命令与响应 | Runtime + domain schema + 共享动作确认 | F03/F05/F06/F07/F09/U05：正确方法／响应、完整待发送命令、卡片 revision、撤回确认 | 用 Go fixture 做请求／响应契约测试；文字＋附件响应丢失可原样重试；正常与失败路径均通过 |
| I0-C 实时与已读 | realtime projection、read、notification | F08/F10：话题引用事件补取、聚焦＋实际可见已读、通知入口；单独排查真机 WS 未连接的传输原因 | WS 正常和回退分开跑双端话题；详情／媒体覆盖期间不误读；重放去重、失权和游标缺口通过 |

I0 是后续稳定设备包的前置条件。UI／交互方案可以并行设计，但不能把以上风险留到最后的美术验收。

### I1：把聊天变成完整的手机任务

| 单元 | 负责范围 | 内容 | 完成门槛 |
| --- | --- | --- | --- |
| I1-A 编辑器与 IME | useChatIme、composerDock、Composer、Chat | U01/U02：显式状态机，@ 继续输入与可滚动候选，表情／附件替换，返回／取消，草稿与当前目标 | 中文 IME 输入→提及→改字→表情→附件→取消→返回能循环；无面板重开、跳动、错目标或草稿丢失 |
| I1-B 消息动作与可访问性 | MessageRow、action registry、popover/sheet、列表行 | U03/U04/U05/U07：唯一菜单、稳定锚点、可见／读屏入口、一致 capability、危险确认 | 触摸／长按／TalkBack 均可操作；滚动和外点取消；读屏能打开第一条从未触摸过的会话 |
| I1-C 正文与阅读 | MessageContent、Markdown、历史定位、MediaViewer | 重复 URL、安全 Markdown 子集、跨页引用、完整长图／宽图、失败重试、受控列表锚点 | 一组 Web 与 Android 共用 fixture 语义一致；看历史收新消息不跳；图片失败不永久加载 |

I1 结束必须在本机测试机完成一条真实连续任务：进入群→引用旧消息→@→附图→确认发送→另一端查看→回复→打开图→返回原阅读位置。使用明确授权的合成会话，不能仅靠页面截图。

### I2：完成 DL 视觉、动效与辅助技术的一致性

1. 把短句分组、卡片、系统消息、消息状态、连接提示、面板和设置的层次统一到当前 DL token；修 U09，并减少正文中的重复信息和常驻技术噪声。
2. 为按压反馈、发送入队、菜单开启／关闭、详情进入／退出、媒体预览、Tab 和键盘面板定义实际过渡与取消行为。参考现有 120／180／200／160ms，按真实设备协调，不为追求数值让布局延迟。
3. 减少动态贯穿 native stack、滚动和浮层；状态即使无动画仍清楚。对系统字号、对比、TalkBack 焦点恢复、48dp 热区做真实任务验证。
4. 小屏、横屏、长内容／加载／失败不能各自出现另一套组件。工作台持续使用正式组件，截图包含合成数据及状态，不维护演示副本。

I2 的交付证据是前后同场景短录像、输入／滚动的性能记录与辅助技术任务结果，不是依赖安装记录或 token 常量测试。

### I3：补齐日常能力并收口发布

- 逐项闭合话题、本群话题发现、合法成员范围、已注册卡片、表情合集和共享个人聊天偏好；列表筛选、文件搜索与检索范围文案真实一致。
- 在 I0–I2 过程中持续跑现有 A01–A33／V01–V08；最后只补空白证据，不把所有设备工作推迟到末尾。阻断项与原账本 ID 建立映射。
- 至少覆盖当前 API 33 真机、API 26 最低支持安装、目标 API 36；320dp／常见手机／平板宽度、200% 字号、中文 IME、手势／三键、后台恢复和 TalkBack。报告模拟器与真机各自范围。
- 建立包的 commit／versionCode／SHA／runtime 对照。CI 测试包可与正式版本不同，但不能只凭界面 `0.1.0 / 1` 判断用户测的是哪次改动。新增原生依赖后，在未来启用 OTA 前更新 runtime 兼容边界；当前 OTA 保持禁用，不存在本轮已验证 OTA 的结论。
- 以同签名升级保留登录和合法本机状态验证安装路径，明确测试签名的限制。正式检查不靠卸载清数据规避迁移或状态问题。

## 7. 本轮评估之后的最低验证增量

| 层次 | 优先新增的证据 |
| --- | --- |
| 请求／响应契约 | F05–F09 对应真实 Go envelope、method、revision、错误码；不能只断言按钮存在或任意 mock 返回完整 message |
| 状态与失败恢复 | 话题撤权、媒体账号切换、附件上传后消息响应丢失、背景栈误已读、WS topic 引用事件 |
| 组件／交互 | 无 pressIn 的 onPress、@ 关闭后保持关闭、菜单一次一个／取消、实际可达的最后候选、危险动作确认 |
| 原生设备 | 键盘动画／返回、菜单滚动取消、减少动态、图片比例与错误、200% 字体、TalkBack 完整路径 |
| 跨端业务 | 两个被授权合成成员，分别在 Web 与 Android 创建／回复／反应／撤回／隐藏／话题附件，校验同一 canonical 结果 |

当前 Jest 把 KeyboardController 固定为键盘隐藏／高度 0，GestureDetector 与 LongPress 为无行为 mock；这些测试不能证明原生输入与手势正确。`runtime.test.ts` 还 mock 了 connect。127 个通过是有用的局部证据，不能排除本文已复现的契约和状态缺陷。

## 8. 结论与本轮交付范围

保留现有技术栈、组件基础、对象模型、单窗格导航和 Chat IME 所有权设计。下一版应以“完整、可恢复、权限正确的跨端聊天任务”为中心组织工作：**I0 正确性与实时 → I1 手机交互闭环 → I2 视觉动效与辅助技术 → I3 能力补齐与发布证据**。

本报告是评估与后续计划，不是实现修复或合并 PR #11 的证明。与其把当前版本重新标成 R3 完成，应维护每项“模型／入口已接、真实契约通过、设备任务通过、已发布”的独立状态，并用同一组任务不断验证推进是否有效。
