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
配置回调先通过公开 ReactHost 配置路径刷新度量，显式请求当前 React 根布局，等待
真实 measure／pre-draw 完成且应用、Activity、ReactContext 倍率一致后才发布。
系统选择器返回时重新同步布局，同倍率不重挂 Text；后台、迟到代次、根分离和销毁
撤销旧屏障，不能以固定延时、手工 Dimensions 或 ReactHost reload 代替布局完成。
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

code19 另有实际失败：头像 Modal 内 2×→1× 后，再从图片选择器返回，部分正文、
按钮和 Tab 仍占用近 2× 高度，而输入框和标题保持 1×；原图与 XML 留存。
冷启在系统倍率仍为 1× 时恢复正常。这证明布局异常，未采集运行中原生缓存命中轨迹，
不能把上游测量缓存污染或某个回调顺序当成已经追踪到的唯一根因。
RN 公开根 measure 会把 Activity 倍率同步到 Fabric；同步屏障防止在旧上下文中提前
重挂文字，不清上游 C++ 测量缓存，也不保证能清除已存在的错误条目。
需在新正式包的干净进程中复验 Modal 字号变化、选择器取消／选择返回及热恢复；
源码状态机与 Kotlin 编译不能替代这一真实路径。

## 输入框完整行预算

正式 code26 在同一群聊、同一进程及原草稿下连续三轮 1×↔2×，六张 2× 的
10／15 秒原图均显示输入首行上缘被裁切。节点存在、48dp 操作区和几何检查通过
不能覆盖这个像素失败。普通 Composer 的旧 maxHeight 为 144dp；三行 2× 文字
已占 144dp，再加实际上下 padding 16dp 与边框 2dp，缺少 18dp。未采集原生
scrollY 或 selection，不能把光标自动滚动的推断写成直接观察。

普通输入框继续使用有界的 144dp 文字预算，按当前倍率向下取整为完整行，至少
一行，再加实际 padding 和边框；2× 三行的最大 border-box 为 162dp。最小高度
也容纳完整一行与上述边距。紧凑行仍沿用其原有高度预算。此修改只更新样式，
不重建 TextInput、不强写 selection、不关闭字体缩放，也不改变发送、草稿或
IME 语义；没有原生模块、权限、协议或 runtime 变化。

旧计算的实际回归先失败，修后高度预算与连续字体事件的同一 TextInput／草稿
回归通过。正式 code27 仍须重新检查三轮 10／15 秒像素、长稿全文滚动、实际
光标／选区、横屏和短窗口 IME；源码公式及旧包结果不能代替这些真机检查。
