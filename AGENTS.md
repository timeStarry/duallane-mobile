# DualLane Mobile Agent Guide

本文件是移动端仓库的强制入口。移动端只实现 Android Workspace 客户端，不实现
P2P 私密通道和空间管理后台。主仓 `/home/timestarry/projects/duallane` 的领域、协议、
安全和发布约束优先于本仓实现。

## 开始任务

1. 阅读本文件和 [开发索引](docs/development/README.md)。
2. 按任务读取 [架构](docs/development/ARCHITECTURE.md)、[代码规范](docs/development/CODE_STANDARDS.md)、
   [UI 规范](docs/development/UI_UX_STANDARDS.md)、[安全与数据](docs/development/SECURITY_AND_DATA.md)、
   [测试与发布](docs/development/TESTING_AND_RELEASE.md)。
3. 涉及 Workspace 行为时，读取主仓对应契约，并检查 `git status`。
4. 先写清用户行为、数据影响、权限边界、兼容性和验证命令，再修改代码。

## 不可违反的边界

- 只接入 Workspace；不得加入 WebRTC、P2P 房间、`#k=` 密钥或 P2P 文件存储。
- 不做空间管理：邀请、角色、成员可见性、容量、保留和 operation record UI 留在 Web/服务端。
- 服务端是身份、权限、配额、消息 canonical content、保留和通知投递的唯一权威。
- 消息和实时协议必须版本化；未知内容只能安全降级到 `plainText`，不得执行未知 payload。
- token、邀请 secret、消息正文和文件内容不得写入日志、埋点或源码。
- Android 是当前唯一交付平台；iOS 代码、证书和验收不纳入本仓目标。
- 原生通知复用 WebSocket 和 Android 本地通知；普通后台允许延迟，无保活或远程推送。ntfy 保持现状。

## 文档路由

| 任务 | 必读文档 |
| --- | --- |
| 产品边界、页面、协议、版本更新、通知 | [移动端 Workspace 方案](docs/WORKSPACE_MOBILE_CLIENT_DESIGN.md) |
| 模块、依赖、运行时和 ADR | [架构规范](docs/development/ARCHITECTURE.md) |
| TypeScript、React Native、异步和测试代码 | [代码规范](docs/development/CODE_STANDARDS.md) |
| 组件、布局、无障碍和状态 | [UI 规范](docs/development/UI_UX_STANDARDS.md) |
| OAuth、token、缓存、本地通知和隐私 | [安全与数据](docs/development/SECURITY_AND_DATA.md) |
| Android 构建、OTA、商店发布和回滚 | [测试与发布](docs/development/TESTING_AND_RELEASE.md) |

## 完成标准

提交前必须完成相关单测/契约测试、Android 构建、协议 fallback 测试、通知场景验收，
并更新受影响文档。不得声称未运行的真机、本地通知、商店或 OTA 检查已经通过。
