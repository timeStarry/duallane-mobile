# Android 前台字体配置通知

## 证据与问题

正式 code16 在同一群聊前台把系统字号从 1× 改到 2×，10／15 秒标题仍为 71px，
大字形被旧高度裁切。保持同进程、会话与草稿，切到后台再恢复后标题变为 139px。
这个对照只用于诊断，不属于连续热字号验收通过。

[RN 0.83.10 DeviceInfoModule](https://github.com/react/react-native/blob/v0.83.10/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/modules/deviceinfo/DeviceInfoModule.kt)
仅在 `onHostResume` 刷新缓存的 fontScale，尺寸事件仍使用该缓存。源码与真机对照
支持前台通知缺口；本轮未直接采集运行中的 JS 倍率值，不声称捕获了内部每个断点。
仅用 `useWindowDimensions().fontScale` 给 Text 换 key 因而不足以解决当前场景。

## 决定与边界

新增 `DualLaneFontScale` 原生模块，通过 Android 公开
[ComponentCallbacks](https://developer.android.com/reference/android/content/ComponentCallbacks)
监听配置；只传递系统 `Configuration.fontScale` 和单调 revision。主线程串行处理
注册、快照及事件，销毁时撤销 callback，倍率未变的方向／密度更新不发布字体事件。
JS 共享一条订阅，先监听再取当前快照，以 revision 与订阅世代拒绝迟到结果。
缺模块的开发环境保留 Dimensions fallback；正式包必须核对实际模块与 package 注册。

Text、Composer 和 IME 最小输入行使用同一倍率。仍仅重建原生 Text 叶节点，保留
导航、列表和 TextInput；不修改上游缓存、不写 Dimensions、不伪造 host resume、
不 ReactHost reload，不缩小系统字体。文字选区与 TalkBack 焦点须单独实测。

新增原生能力使用 `android-3` runtime，protocol major 仍为 1。没有新依赖、权限、
存储、日志或服务端变更；事件不携带账号、消息、对象引用或凭证，OTA 仍默认关闭。
回滚须使用同证书、更高 versionCode 重建已验证源码，不卸载或清除用户数据。

## 验证

聚焦回归覆盖 Dimensions 仍为 1 时原生 2→1 事件、共享订阅、迟到快照、卸载世代、
非法 payload 和路由／草稿保持；插件需验证幂等与未知模板拒绝，实际 Kotlin 必须编译。
这些检查不证明字形正确。下一正式包仍须在同一路由保持焦点、IME 与草稿，连续三轮
1×↔2×，人工检查全部 10／15 秒截图及全文可达，并覆盖旋转、短窗口与读屏。
