# Android 热字体布局与运行时升级

## 观察与原因

2026-10-06 正式候选在 RN 0.81.5 上运行中改变系统字号后，文字保留旧布局。
冷启动才能正确重排。JS multiplier 原型无效，已撤回；后续公开 ReactHost reload
方案虽能重排，在 API 35/36 展开输入框时出现真实白屏，不能交付。

原生日志确认 `TextLayoutManager.getOrCreateSpannableForText` 缓存缺失触发
`Required value was null`，随后 React 销毁根页面；进程存活不代表界面可用。
该版本的 ReactEditText finalizer 按 tag 删除进程级缓存，JS reload 后复用 tag。
旧实例跨代清理新缓存是代码支持的竞态推断，未记录实际删除瞬间，不能当作已捕获事实。
API 33 真机及 API 26 通过而 API 35/36 失败，仍按阻断处理。

## 决策与兼容性

采用稳定 Expo SDK 55 与其官方 bundled React Native / React / 原生模块版本，
锁定精确依赖；移除应用字体变更时的 ReactHost reload，由上游原生布局更新处理。
RN 0.81.6 仍未默认启用字体更新，升级到它不足以解决现有路径。RN 0.83 默认启用
布局更新；不得在新版本保留旧 reload，也不得通过吞异常、延时或切换全部实验标志掩盖。

依据：[上游字体布局默认修复](https://github.com/react/react-native/commit/686d14f1d16c2f02720104ddd395f7d27c908350)、
[Expo SDK 55 配套与升级说明](https://expo.dev/changelog/sdk-55)。

Activity 继续处理 fontScale，原有键盘、主题、导航配置和 Expo 生命周期保持。
Cronet、文件另存、正式签名配置及 SDK 26 最低版本需要显式核对生成模板的差异。
不启用 Hermes V1、远程 OTA 或新权限。新原生 ABI 使用独立 runtimeVersion，
Workspace protocol major 仍为 1，服务端权限、存储、配额及审计没有变化。
既有 SQLite 缓存、凭证和草稿必须通过同签名覆盖升级验证。

## 验证与回滚

升级先完成类型、lint、完整 Jest、原生插件、Android 导出、debug/release 构建。
正式证书、包名、默认服务、versionCode、runtimeVersion 与实际包一致。
API 26/35/36 公开页重新做尺寸／主题／字体与输入检查；真机登录聊天至少连续三轮
100%↔200% 变化，包含中文 IME，不应重置会话／输入状态，不使用立即冷启掩盖白屏。
每次在 10 秒与 15 秒检查真实截图和主要控件，日志同时检查 HostFunction、
TextLayoutManager、初始化错误及 Java fatal；匹配行数不当作独立错误次数。

新包仍需实测实时消息、卡片、通知、文件及已有账号／草稿。完整读屏和权限矩阵
不足时明确留作未验证。逐轮证据记入 [R5](../design/mobile-experience-redesign/R5.md)。
回滚使用已验证源码、相同证书与更高 versionCode 重建 APK；不卸载清除用户数据。
