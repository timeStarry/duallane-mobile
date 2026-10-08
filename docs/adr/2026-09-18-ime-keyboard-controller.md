# ADR 2026-09-18：聊天与搜索按焦点独占 IME inset

## 背景

redesign 树使用 Manifest `adjustPan` 且无 `KeyboardAvoidingView`（相对 PR #8 的 resize+KAV 双重偏移）。飞书式表情/附件面板需要与键盘等高替换。`adjustPan` 平移窗口，不缩小窗口；在平移时再写 JS `imeBottom` 会再垫一个键盘高度。

## 决定

- 进程默认保持 `adjustPan` / `softwareKeyboardLayoutMode: 'pan'`。
- App 根一层 `KeyboardProvider enabled={false}`。
- Chat/Topic 与独立 Search 仅在各自 focus 时：`useKeyboardController().setEnabled(true)` + `SOFT_INPUT_ADJUST_NOTHING`；离开时 `setEnabled(false)` + `setDefaultMode()`。
- Dock：键盘可见 `imeBottom`；面板 `lastImeHeight`；空闲 `navBarInset`；永不叠加。
- 禁止 `KeyboardAvoidingView`、禁止 Chat `ADJUST_RESIZE`、禁止静态 `KeyboardController.setEnabled`。
- 引入 `react-native-keyboard-controller` 与 Reanimated 4 以读取 IME inset。`react-native-worklets` 钉在 Expo 54 的 `0.5.1`（须为直接依赖，pnpm 才能被 Gradle `require.resolve` 找到）。本 ADR 不追求减包；体积变化记入后续 APK 对照。

2026-10-06 配套版本后续升级为 SDK 55 的 KeyboardController 1.20.7、Reanimated 4.2.1
与直接依赖 worklets 0.7.4；以上 IME 所有权不变。原因与原生验证见
[热字体运行时 ADR](2026-10-06-android-font-layout-runtime.md)，包体证据见 R5。

2026-10-07 独立搜索页沿用焦点生命周期，使用一个 `KeyboardAwareScrollView` 作为
FlatList 的滚动承载。标题、输入、提交、提示和历史同处可滚动区，避免横屏或放大
字号时固定表单耗尽结果高度；滚动承载负责聚焦输入的可见性和唯一 IME 占位。
页面不再另垫键盘高度，键盘可见时不叠加导航栏 inset，保持输入 host 稳定并禁止
横屏 IME 全屏提取。原生像素验证单独记录在 R6，结构回归不代替实际可达性检查。

## 回滚

焦点页面 cleanup 关闭模块即可回到 Manifest pan。卸依赖需新 APK。
