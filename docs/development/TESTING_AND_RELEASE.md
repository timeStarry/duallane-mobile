# Android 测试与发布规范

## 必过检查

真机聊天 IME 回归：在已授权测试会话打开键盘，以竖屏和横屏分别运行
`node scripts/check-android-chat-ime.mjs --serial DEVICE`，并核对截图。
该只读检查要求输入焦点、非全屏提取模式和 48dp 动作位于键盘可见区域之上；
无障碍树中的底层按钮不能单独证明未被 IME 覆盖。检查不发送消息或记录正文。

键盘上方空间不足时，Chat 会改用紧凑输入行并保留返回、会话身份、详情与发送。
窄窗口的添加／表情／回复和附件取消从「输入选项」进入，需实测打开和取消流程；
若连完整输入行都放不下，收起键盘并提示转为竖屏，不缩小系统字体或触控目标。
历史阅读恢复须比较同一消息的实际屏幕位置，单测中的列表属性／无滚动命令不是
原生锚点保持证据。卡片重新校验仍立即隐藏正文及旧动作，仅暂保同身份实测高度。

Android 热字号回归必须在同一路由保持焦点和草稿，连续三轮 1×↔2×，在 10／15 秒
检查标题、消息及卡片的实际字形和全文可达。48dp 控件、进程存活及 UIA 文本存在
不能证明没有裁字；不得重进页面或冷启动后冒称热更新通过。共享 Text 使用原生
配置通知的倍率变化重建文字节点，输入框、列表和导航应保持；不能假设前台的
Dimensions 字体缓存已更新。见 [字体通知 ADR](../adr/2026-10-06-android-font-metrics.md)。
文字选区／TalkBack 焦点单独记录。

头像回归须在正式包使用合成 JPEG／PNG／WebP：系统选择取消、预览取消、明确上传、
恢复 GitHub 头像分别检查；选择不得自行发请求。空图片、超过 5 MiB、损坏图片应保留
原头像并给出可重试反馈。头像保存期间保留未提交的显示名／查找可见性，再从 Web
确认 canonical 图像；恢复测试后还原原自定义图像。源码中的迟到回调和撤权回归不
代替真实系统选择器、裁剪像素、放大字体及读屏路径验收。

头像预览必须由原生图片解码成功后才允许确认。损坏图片应在预览阶段给出明确反馈，
清理副本并保留原头像；旧图片的加载、失败或关闭回调不得影响新选择或正在上传的副本。
确认与取消位于限高预览滚动区之外，弹窗按可用窗口约束总高度；需以 2× 字体、
横屏、短窗口及读屏实测实际可见文字和至少 48dp 热区，不以 UIA 节点存在代替可达。
全局错误提示应避开状态栏，显示、更新或清除时不能重建聊天路由、输入框或草稿；
嵌套安全区的初始值与旋转后的真实布局须在正式包另行核对。

- TypeScript、lint、unit/component/contract tests 和 `git diff --check`。
- Android debug/release 构建，签名配置检查，APK/AAB 安装与启动 smoke。
- `version: 1` 消息、未知 block/kind/major、plainText 缺失、恶意 HTML 的 fallback fixture。
- WebSocket 重连、replay、seq 缺口、`sync.required`、重复 event 和 clientMessageId 幂等。
- 本地通知前台抑制/后台显示、权限拒绝、去重、replay 抑制、点击授权；进程结束后重新打开应用同步。
- OTA 签名/hash/runtime 不匹配、下载中断、启动崩溃自动回滚；APK 强更 Dialog 不可关闭。

Cronet/WebSocket 修复的实际 Kotlin 分支回归在 `tests/native/CronetRoutingTest.kt`。
从 `android` 目录显式运行：

```bash
./gradlew :app:testReleaseUnitTest --rerun --tests com.timestarry.duallane.CronetRoutingTest --init-script ../scripts/test-cronet-routing.gradle
```

Windows 使用 `gradlew.bat` 和 Java 17。该 init 仅为这次测试添加固定 JUnit 4.13.2
与合成 fixture，不改变生产依赖；13 项检查复用实际应用 Kotlin，确认完整握手和有
请求体的 HTTP 走原生 chain，无请求体的 HTTP 保留 Cronet，原请求和异常保持。
包括 JSON／空请求体、raw image 两次读取字节一致、未知长度 one-shot 不预读，以及
失败不增加应用重试或 Cronet fallback。无网络，不替代真机认证通道验收。
有请求体请求重新使用系统 OkHttp，须在正式包检查旧公网 TLS RST 风险：PNG／JPEG／WebP
首次上传、JSON 写入、明确失败后手动重试和现有凭证流程分别验证，WS 连通不能替代。
客户端自身请求期限触发取消时应显示 `net.timeout`，即使原生取消错误没有超时字样。
下载失败日志仅区分 `file_download_reserve` 与 `file_download_content`，不记录文件、
对象、下载预留 ID 或 query；断网后热恢复与冷启动后成功必须分别记录。

HTTP headers 返回不代表正文传输结束。JSON／媒体／文件正文读取需受账号、API 和
权限失效取消，期限后也应结束等待并取消原生请求；不能仅调用 reader.cancel 后
无限等待它的 Promise。相关回归包含 headers 后失效、正文悬挂、正常 token 轮换、
媒体摘要等待后失效与部分文件清理。实际热恢复下载仍须在正式包单独验证。

聊天读取失败提示仅由同 scope、同范围且实际应用的 HTTP 成功清理；空的有效页面
也算成功。WS／缓存／乐观更新、连接成功或其它 cursor 成功不能清除该读取失败，
也不能一并清除发送、配额、定位等动作错误。成功回执只存内存，随消息桶授权清理。

## 版本与发布

首页搜索／图片快捷发送的新原生模块使用 `android-5`，见 [ADR](../adr/2026-10-07-search-and-photo-send.md)。
新包需检查首页独立搜索栈、返回保留词、历史提交／复用／删除／清空；在系统图片选择器
验证取消、单选和多选确认后直接发送，原文字／回复／文件草稿保持，图片失败可逐条重试。
合并 Manifest 不得申请相机、麦克风或媒体库广泛读取；API 26 回退和实际平台差异单列证据。

Dialog 辅助焦点原生能力使用 `android-4`，见 [辅助焦点 ADR](../adr/2026-10-07-android-accessibility-focus.md)。
新包必须分别实测先开读屏和弹窗显示后开读屏的取消、系统返回、选择器返回及同窗
Home 恢复；记录触发控件、关闭即刻和稳定帧的实际绿色焦点与播报。窗口事件、
原生动作返回值、UIA 节点存在或先前版本的成功结果均不能代替此检查。读屏开启时
不得运行会停用服务的 UIAutomator dump，使用真实硬件导航和像素／音频证据。

使用 `appVersion` SemVer、Android `versionCode`、`runtimeVersion` 和 `protocolMajor` 四个独立字段。
发布前检查 release policy 的 latest/minimum/recommendation、APK 地址、OTA manifest、hash、签名、
release notes 与 APK/AAB 一致。原生模块、权限、协议 major 或 runtime 变化必须走新的 Android 包。

## 灰度与回滚

首发只做 internal APK/AAB；未来若增加 beta/production，再按 channel、版本和 rollout 百分比控制。本地通知可关闭；
OTA 有发布回退。回滚优先恢复上一版签名 APK/AAB 或同 runtime 的上一 bundle；消息数据、
Workspace 权限和服务端 schema 不随客户端回滚。未运行真机、本地通知、Play Console 或 OTA 的检查不得标记为通过。

## GitHub Actions Android 发布

`.github/workflows/android-release.yml` 支持 `vMAJOR.MINOR.PATCH` tag 或手动触发。流程使用
GitHub 托管的 Java 17 和 Android SDK，执行 `pnpm check`、`assembleRelease`、`bundleRelease`，
并上传签名 APK/AAB artifact；tag 构建还会创建 GitHub Release。正式构建必须配置仓库变量
`DUALLANE_API_ORIGIN`，以及 secrets `DUALLANE_ANDROID_KEYSTORE_BASE64`、
`DUALLANE_ANDROID_STORE_PASSWORD`、`DUALLANE_ANDROID_KEY_ALIAS`、
`DUALLANE_ANDROID_KEY_PASSWORD`。keystore 只在 runner 临时目录解码，不提交到仓库。

手动构建必须填写 `app_version`（严格 `MAJOR.MINOR.PATCH`），可指定大于已安装包的
`version_code`；未指定时使用 workflow run number。候选分支使用同一正式签名输出
APK/AAB artifact，便于保留登录状态做覆盖升级；手动构建不创建 GitHub Release。
tag 构建的版本以 tag 为准，versionCode 继续使用 workflow run number。

`DUALLANE_API_ORIGIN` 是发布包及 PR 测试包共同使用的默认服务配置；当前维护者配置为
`https://duallane.tsio.top`，通过构建环境注入，不写死在客户端源码。已配置的包不显示服务器
输入，已有账号可直接使用 GitHub 登录；邀请入口默认降为「还没有账号？」，点开后的链接必须属于同一服务。无登录会话时，
版本检查在后台进行，不阻塞登录入口。更新检查或 GitHub 登录失败时，界面会附带稳定诊断
code（如 `net.failed`、`net.tls`、`http.404`、`body.schema`），logcat 中对应
`src=duallane event=api_error` 记录；不得把这些 code 当成服务端已拒绝登录。

## PR 测试包

`.github/workflows/android-test.yml` 在 PR 上独立构建 debug APK 和测试签名 release
APK/AAB，校验包名、签名和 manifest，再在 Android 15 模拟器中安装自带 JS bundle 的
release APK，检查登录页冷启动、停止后重新启动与崩溃日志。测试 key 由 runner 临时生成，
不读取正式 secrets，也不创建 GitHub Release；不同运行的测试包需要先卸载再安装。

该 smoke 只证明原生打包、安装与启动。真实账号 OAuth、真机后台通知、通知拒绝、
完整聊天/文件联调及签名 OTA 升级/回滚需要另行记录。未配置 OTA 服务时 OTA 默认禁用。
`node --test plugins/*.test.cjs` 检查重复 prebuild 的签名幂等、debug/release 隔离、
服务地址校验及 Linux 上的 release tag 解析。
