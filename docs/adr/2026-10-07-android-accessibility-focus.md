# Android 弹窗辅助焦点恢复

## 问题与证据

正式 code23 在头像确认框显示之后启用 TalkBack，再以真实硬件导航取消，绿色焦点
仍在“返回”。只观察的原生 trace 确认 Dialog 窗口已移除、Activity 已重新获得窗口
焦点之后，Fabric → Surface → View 的事件 8 才送达；这个样本可以排除未发送和
关闭前发送，不能证明全部内部调用或 TalkBack 收件。

RN 0.83.10 的 `AccessibilityInfo.setAccessibilityFocus` 经 Fabric 发送
`TYPE_VIEW_FOCUSED`，不等于执行 Android 的辅助焦点动作。在相同正式包、进程和
同一事件 8 实际到达的 View 上，诊断仅显式调用一次公开的
[View.performAccessibilityAction](https://developer.android.com/reference/android/view/View#performAccessibilityAction(int,%20android.os.Bundle))，
使用 [ACTION_ACCESSIBILITY_FOCUS](https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo#ACTION_ACCESSIBILITY_FOCUS)。
返回值和目标辅助焦点状态均为 true；操作前绿色框在“返回”，操作后及约四分钟稳定
帧均在“恢复 GitHub 头像”。这次动作晚于事件约 15.9 秒，属于阳性诊断，不能证明
立即自动恢复的生产时序已经通过。录音转写没有确认目标播报，语音结果单独保留。

## 决定与边界

新增 `DualLaneAccessibilityFocus` 薄原生模块。共享 Dialog 的原生 onShow 后，在
UI 线程通过 RN 公开 UIManager resolveView 捕获触发控件的准确实例；只保留弱引用、
原 Activity、tag 和内存单调票据。捕获不要求读屏开启，支持显示弹窗之后开启读屏。
关闭仍等待本周期真实 Activity 窗口回焦和当前读屏状态；JS 的账号、API、路由及
ref 身份守卫均保留。原生恢复再次检查当前宿主、前台、代次、Activity/decor 身份、
同一个 resolveView 实例、挂载、可见、实际正尺寸及非空全局可见矩形和窗口焦点，以及辅助服务和触摸探索。
通过后只执行一次公开的辅助焦点动作，不再发送 RN 事件 8 代替它。

单槽票据在取消、消费、暂停和模块销毁时清理。旧捕获不能覆盖新请求，取消前排队
的捕获、旧代次恢复、重复消费及回收 tag 都失效。系统选择器或同一可见弹窗从后台
返回时创建新周期、重新捕获；隐藏周期不复活。没有轮询、固定延时、重复抢焦点、
反射、树遍历、控件文本读取或诊断工具留在应用中。桥缺失或失败时不回退到旧事件。

资料页失焦清理可能只更新 ref 代次而不产生新的 React commit。两个头像 Dialog
各自注册内存取消引用，失焦、账号／API失效和新选择在增代前同步撤销排队票据；
不等待下一次渲染。正常取消弹窗仍允许回到原入口，组件清理只移除自己的取消引用。

新增能力使用 `android-4`，protocol major 仍为 1，必须重新安装 APK/AAB；不能向
android-3 下发此 JS。没有新依赖、权限、持久化、日志、账号数据或服务端更改，OTA
仍默认关闭。生产默认服务继续由构建环境注入。回滚用同正式证书、更高 versionCode
重新构建已验证源码，保留用户数据。

## 正式 code24 的守卫修正

正式 code24 的无诊断真机用例仍复现晚开启读屏后取消落在“返回”。随后仅观察的
原生 trace 显示：捕获成功，开启读屏引起的暂停／恢复后重新捕获成功，关闭窗口后
恢复请求确实到达。同控件／Activity／decor、前台、挂载、显示、窗口焦点和读屏
条件全部为 true，但 `View.isLaidOut` 为 false；因此恢复返回 false，没有调用
辅助焦点动作。控件同时在实际原图上有正常可见边界。不能从这个样本推断全部
Fabric View 的内部原因，也不能由诊断工具覆盖正式包的失败结果。

追加只读观察在捕获时确认该弱引用目标的宽高及全局可见矩形为正。这次收集在结束
窗口前清理了诊断服务，保留为不完整观察；不能冒称关闭后的几何或回焦验收通过。

恢复使用公开的实际尺寸及 [getGlobalVisibleRect](https://developer.android.com/reference/android/view/View#getGlobalVisibleRect(android.graphics.Rect)) 非空检查，拒绝零尺寸或完全裁出
窗口的目标；不依赖这个样本中与可见几何不一致的布局标志。原票据、身份、生命周期、
窗口、读屏和取消守卫保持，仍只执行一次公开动作。没有延时、轮询或重复抢焦点。
这是既有 `android-4` 原生能力内部修正，需要新 APK，正式包无 hook 的即时／稳定
焦点与播报仍须另行验证。

## 正式 code25 的恢复捕获竞态

正式 code25 的无诊断晚开启读屏用例仍失败：取消后绿色焦点在“返回”。完整
90 秒的纯观察样本中，首次捕获成功；读屏启用引起暂停后，新的捕获先于本模块
的恢复通知进入，前台票据门槛仍为 false，因此捕获返回 false、票据关闭。随后
窗口移除及 Activity 回焦均发生，但没有原生恢复调用或辅助焦点动作。这个样本
支持捕获入口的生命周期竞态，不能归因于动作成功后被读屏覆盖。

RN 在恢复宿主时先更新权威生命周期为 RESUMED，再依次通知各模块。AppState
模块可能先发出 active，使 JS 新周期的捕获早于焦点模块的恢复通知。仅对有效
新票据，在同一同步锁内采样当前原生宿主生命周期、React 实例和模块状态，再
协调前台门槛并保留票据；已取消或关闭的旧票据仍不复活。真正暂停仍增加代次、
撤销排队工作；UI 线程的身份、可见边界、窗口及读屏检查全部保留。没有等待
时长、轮询、重试或额外焦点动作。这个既有 android-4 能力的修正需新 APK；
正式包无诊断的像素及播报结果仍待实测。

## 验证与未完成项

组件回归覆盖实际窗口顺序、读屏后开启、捕获迟到、后台／新弹窗／卸载／scope
失效、Strict Mode、失败和重复消费。Kotlin fixture 必须执行真实票据控制器和
适配守卫；插件注册幂等及未知模板拒绝、实际应用 Kotlin 编译另行检查。
这些结果不能替代新正式包上的读屏测试。新包需在不加载诊断工具的条件下检查正常
开启与晚开启、直接取消、系统返回、SAF 返回、Home 恢复、稳定焦点和播报，另行
复验普通弹窗、字体、短窗口及聊天／文件／通知。
