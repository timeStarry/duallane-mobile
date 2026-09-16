# Android 测试与发布规范

## 必过检查

- TypeScript、lint、unit/component/contract tests 和 `git diff --check`。
- Android debug/release 构建，签名配置检查，APK/AAB 安装与启动 smoke。
- `version: 1` 消息、未知 block/kind/major、plainText 缺失、恶意 HTML 的 fallback fixture。
- WebSocket 重连、replay、seq 缺口、`sync.required`、重复 event 和 clientMessageId 幂等。
- 本地通知前台抑制/后台显示、权限拒绝、去重、replay 抑制、点击授权；进程结束后重新打开应用同步。
- OTA 签名/hash/runtime 不匹配、下载中断、启动崩溃自动回滚；APK 强更 Dialog 不可关闭。

## 版本与发布

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

`DUALLANE_API_ORIGIN` 是发布包及 PR 测试包共同使用的默认服务配置；当前维护者配置为
`https://duallane.tsio.top`，通过构建环境注入，不写死在客户端源码。已配置的包不显示服务器
输入，已有账号可直接使用 GitHub 登录；可选邀请链接必须属于同一服务。无登录会话时，
版本检查在后台进行，不阻塞登录入口。

## PR 测试包

`.github/workflows/android-test.yml` 在 PR 上独立构建 debug APK 和测试签名 release
APK/AAB，校验包名、签名和 manifest，再在 Android 15 模拟器中安装自带 JS bundle 的
release APK，检查登录页冷启动、停止后重新启动与崩溃日志。测试 key 由 runner 临时生成，
不读取正式 secrets，也不创建 GitHub Release；不同运行的测试包需要先卸载再安装。

该 smoke 只证明原生打包、安装与启动。真实账号 OAuth、真机后台通知、通知拒绝、
完整聊天/文件联调及签名 OTA 升级/回滚需要另行记录。未配置 OTA 服务时 OTA 默认禁用。
`node --test plugins/*.test.cjs` 检查重复 prebuild 的签名幂等、debug/release 隔离、
服务地址校验及 Linux 上的 release tag 解析。
