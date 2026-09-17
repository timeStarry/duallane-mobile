# 移动端 UI/UX 规范

下一轮体验改造以 [DL Android 体验改造要求](../design/mobile-experience-redesign/README.md)
及其 [验收账本](../design/mobile-experience-redesign/ACCEPTANCE.md) 为目标规格。
下文保留原始移动基线；其中最小页面、组件和聊天覆盖不再代表本次改造完成标准。
跨端统一对象、动作、状态与品牌语言，导航、手势、键盘和系统文件操作按 Android 适配。

## 视觉与布局

- 复用主仓“清晰双轨”的语义 token：`bg/surface/soft/elevated`、`text/muted/line/focus`、
  `shared/shared-soft/on-shared`、`success/warning/danger`。Android 取值与平台差异见
  [Token 映射](../design/mobile-experience-redesign/TOKEN_MAPPING.md)。
- 首期一个默认主题（原色），支持系统浅色/深色；不复制主仓 Web CSS，不引入大面积玻璃或渐变。
  Workspace 组件不使用 `direct` 铜橙色。
- 状态栏图标随应用实际主题切换：浅色背景使用深色图标，深色背景使用浅色图标；系统跟随和手动主题都保持可读。
- 系统字体和中文 fallback；正文 15–16sp，标题 20–24sp，辅助文字不低于 12sp。
- 间距使用 4/8/12/16/24/32；常规控件 10–12dp 圆角，输入区 16dp，Dialog 20dp。
- 主要控件和列表行触控区至少 48×48dp（改造要求；旧基线 44dp 不再作为完成标准）；安全区、键盘和 Android 返回键必须真实验收。

## 导航与页面

底部导航为“聊天、文件、成员、我的”。登录成功直接到会话列表；聊天页返回列表，详情
使用全屏 Sheet。`我的` 只含个人设置、通知、设备会话、只读空间信息和退出，不含空间管理。
列表、聊天、详情一次只显示一个主任务；空态、加载、错误、离线和成功状态均需定义。

## 消息与通知表面

消息正文是视觉主角，不逐条堆卡片。本人消息使用 `shared-soft`，他人消息使用 `surface`；
失败、发送中、未知 block 和强更状态同时使用文字、图标和颜色。未知消息使用统一
`MessageFallback`，不可执行 payload。本地通知 通知点击后进入 Chat，通知内容不得成为授权凭证。

## 无障碍

按钮有可访问名称，图标不单独传达语义；TalkBack 可读消息作者、时间、状态和
fallback。Dialog 焦点锁定并把焦点返回触发控件；系统字体放大、对比度、减少动画和横竖屏
需要在 320dp、375×667、390×844 和平板宽度验证。
