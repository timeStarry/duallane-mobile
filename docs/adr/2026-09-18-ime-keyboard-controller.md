# ADR 2026-09-18：Chat 独占 IME inset

## 背景

redesign 树使用 Manifest `adjustPan` 且无 `KeyboardAvoidingView`（相对 PR #8 的 resize+KAV 双重偏移）。飞书式表情/附件面板需要与键盘等高替换。`adjustPan` 平移窗口，不缩小窗口；在平移时再写 JS `imeBottom` 会再垫一个键盘高度。

## 决定

- 进程默认保持 `adjustPan` / `softwareKeyboardLayoutMode: 'pan'`。
- App 根一层 `KeyboardProvider enabled={false}`。
- 仅 Chat/Topic focus：`useKeyboardController().setEnabled(true)` + `SOFT_INPUT_ADJUST_NOTHING`；离开时 `setEnabled(false)` + `setDefaultMode()`。
- Dock：键盘可见 `imeBottom`；面板 `lastImeHeight`；空闲 `navBarInset`；永不叠加。
- 禁止 `KeyboardAvoidingView`、禁止 Chat `ADJUST_RESIZE`、禁止静态 `KeyboardController.setEnabled`。
- 引入 `react-native-keyboard-controller` 与 Reanimated 4 以读取 IME inset。`react-native-worklets` 钉在 Expo 54 的 `0.5.1`（须为直接依赖，pnpm 才能被 Gradle `require.resolve` 找到）。本 ADR 不追求减包；体积变化记入后续 APK 对照。

## 回滚

Chat cleanup 关闭模块即可回到 Manifest pan。卸依赖需新 APK。
