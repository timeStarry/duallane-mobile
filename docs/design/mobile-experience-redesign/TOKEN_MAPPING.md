# Android Token 映射

来源：主仓 [`tokens.ts`](https://github.com/timeStarry/duallane/blob/9b5956a7c48d19897615e81df7f76f3cca3527de/apps/web/src/ui/theme/tokens.ts) 的 `original` 家族，以及 [`appearance.ts`](https://github.com/timeStarry/duallane/blob/9b5956a7c48d19897615e81df7f76f3cca3527de/apps/web/src/ui/theme/appearance.ts) 的几何变量。运行时实现：[`src/ui/tokens.ts`](../../../src/ui/tokens.ts)。

第一版只交付 **原色** 的浅色／深色／跟随系统。主题家族是独立维度，R1 不提供苔原／暮色／米色／极简选项。

## 1. 语义色

RN 使用 camelCase。`direct*` 写入映射表但不进入 Workspace 组件 props，避免共享空间被铜橙通道色污染。

| Web token | RN token | light | dark | RN 用途 | 平台差异 |
| --- | --- | --- | --- | --- | --- |
| `bg` | `bg` | `#f5f7f8` | `#151b20` | 页面背景 | 状态栏图标随解析后的模式切换 |
| `surface` | `surface` | `#ffffff` | `#20292f` | 列表行、气泡他人、导航栏 | 不用 CSS 阴影冒充 elevation |
| `soft` | `soft` | `#eef2f4` | `#2a363e` | 次要按钮、弱表面 | |
| `elevated` | `elevated` | `#ffffff` | `#29353d` | 浮层、Dialog | 深色比 surface 略亮；浅色与 surface 同值 |
| `text` | `text` | `#202c32` | `#eaf1f5` | 主文字 | 系统字体 + 中文 fallback |
| `muted` | `muted` | `#586a74` | `#a8bbc6` | 辅助文字、时间 | 不只靠降低透明度 |
| `line` | `line` | `#e0e7ea` | `#35464f` | 细分隔 | `StyleSheet.hairlineWidth` |
| `control` | `control` | `#81919a` | `#8198a5` | 未选中控件、图标默认 | |
| `focus` | `focus` | `#286b9d` | `#9bcbf5` | 焦点环 | RN 用 `borderColor`，无 CSS outline |
| `shared` | `shared` | `#256b78` | `#9bd4df` | 主按钮、未读、本人强调 | Workspace 唯一强调色 |
| `shared-soft` | `sharedSoft` | `#e7f2f4` | `#25414c` | 本人气泡、选中弱底 | |
| `on-shared` | `onShared` | `#ffffff` | `#142c33` | 主按钮文字 | |
| `success` | `success` | `#24714a` | `#9cddb5` | 已保存、传输完成 | 基线 APK 未接入 |
| `success-soft` | `successSoft` | `#e8f5ed` | `#203e2f` | 成功弱底 | |
| `warning` | `warning` | `#825500` | `#efcd87` | 可恢复警告 | |
| `warning-soft` | `warningSoft` | `#fff5df` | `#423822` | 警告弱底 | |
| `danger` | `danger` | `#b52e49` | `#ffb0c0` | 危险文字 | 退出／撤回不用主按钮样式 |
| `danger-soft` | `dangerSoft` | `#ffedf1` | `#4b2b37` | 危险按钮底 | |
| `avatar-a` / `avatar-b` | `avatarA` / `avatarB` | `#e5ebf5` / `#eee8f1` | `#324457` / `#463c50` | 稳定占位 | 由对象 id 散列，禁止随机色 |
| `direct*` | （保留，不导出到 Workspace Theme） | `#a7482c` 等 | `#f3ad8f` 等 | P2P 通道语义 | 移动端不做 P2P，组件不得使用 |

Pressed 透明度 0.72，disabled 0.4。Selected 列表行混合 `shared` 约 18% 到 `surface`，在代码里用 `sharedSoft` 近似，避免运行时解析 CSS `color-mix`。

## 2. 几何与类型

| 角色 | Web | Android | 理由 |
| --- | --- | --- | --- |
| 间距 | 4/8/12/16/24/32px | 同值 dp | 设计系统共用尺度 |
| 圆角 tag / control / composer / dialog / entity | 6 / 10 / 16 / 20 / 11 | 同值 dp | 角色圆角，不用一个半径打天下 |
| 触控 | 44px | **48dp** | 高于既有 44dp 下限，满足 Android 主要动作 |
| 消息正文 | 15px / 行高约 1.6 | 16sp / 行高 24 | 手机阅读距离；中文行高取 1.5 |
| 控件 | 14–15px | 15sp | |
| 页面标题 | 18–24px | 20–22sp | 紧凑头部按控件尺度，不使用封面字号 |
| 辅助 / 时间 | 12–13 / 11 | 12 / 11sp | 时间不承担唯一操作说明 |

阴影、模糊、玻璃：Android 默认不使用。浮层用 `elevated` 实色 + 细边。减少动态时动画时长为 0。

## 3. 组件 token

| 组件 | 使用的语义 | 几何 |
| --- | --- | --- |
| 主按钮 | `shared` / `onShared` | 高 ≥48，圆角 10 |
| 次要按钮 | `soft` / `text` | 同命中区 |
| 危险按钮 | `dangerSoft` / `danger` | 同命中区，不使用 `shared` |
| 输入 | `surface` + `line`，聚焦 `focus` | 圆角 16，正文 16sp |
| 本人消息 | `sharedSoft` | 气泡圆角 `bubble.outer` 16，组内邻边 `bubble.inner` 0，最大宽度约 80% |
| 他人消息 | `surface` | 同左对齐 messenger 气泡 |
| 列表行 | `bg` 上直接排行，底部分隔 `line` | 最小高度 `list.rowMin` 72，左右 16，头像 48 |
| AppHeader | `surface`，底边 `line` | 标题 20sp，含状态栏 inset |
| Dialog | `elevated`，遮罩 40% `text` | 圆角 20，左右边距 24 |
