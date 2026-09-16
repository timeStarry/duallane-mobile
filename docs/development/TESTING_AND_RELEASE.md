# Android 测试与发布规范

## 必过检查

- TypeScript、lint、unit/component/contract tests 和 `git diff --check`。
- Android debug/release 构建，签名配置检查，APK/AAB 安装与启动 smoke。
- `version: 1` 消息、未知 block/kind/major、plainText 缺失、恶意 HTML 的 fallback fixture。
- WebSocket 重连、replay、seq 缺口、`sync.required`、重复 event 和 clientMessageId 幂等。
- FCM 前台/后台/进程杀死、权限拒绝、token 刷新/失效、通知去重、点击深链和会话撤权。
- OTA 签名/hash/runtime 不匹配、下载中断、启动崩溃自动回滚；商店强更 Dialog 不可关闭。

## 版本与发布

使用 `appVersion` SemVer、Android `versionCode`、`runtimeVersion` 和 `protocolMajor` 四个独立字段。
发布前检查 release policy 的 latest/minimum/recommendation、商店链接、OTA manifest、hash、签名、
release notes 与 APK/AAB 一致。原生模块、权限、协议 major 或 runtime 变化必须走新的 Android 包。

## 灰度与回滚

先 internal，再 beta，最后 production；灰度可按 channel、版本和 rollout 百分比控制。FCM 和
OTA 均有 kill switch。回滚优先恢复上一版签名 APK/AAB 或同 runtime 的上一 bundle；消息数据、
Workspace 权限和服务端 schema 不随客户端回滚。未运行真机、FCM、Play Console 或 OTA 的检查不得标记为通过。
