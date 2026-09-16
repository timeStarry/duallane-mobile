# 移动端开发文档索引

本目录采用主仓的渐进式披露结构：根目录 `AGENTS.md` 只保留边界和路由，稳定规则放在
专题文档，产品和协议细节集中在 [Workspace 移动端方案](../WORKSPACE_MOBILE_CLIENT_DESIGN.md)。

| 文档 | 用途 |
| --- | --- |
| [架构规范](ARCHITECTURE.md) | Android-only 技术栈、模块边界、数据流、依赖和 ADR |
| [代码规范](CODE_STANDARDS.md) | TypeScript、React Native、异步、协议解析、错误处理 |
| [UI/UX 规范](UI_UX_STANDARDS.md) | 视觉 token、导航、组件、触控、无障碍和页面状态 |
| [安全与数据](SECURITY_AND_DATA.md) | Workspace 信任边界、凭证、缓存、FCM、日志和隐私 |
| [测试与发布](TESTING_AND_RELEASE.md) | Android 构建、版本、OTA、FCM 验收、灰度、回滚 |

新增规则只写入一个权威文档，其他文档通过链接引用。引入新依赖、原生模块、API、协议
版本或持久化数据前，先更新架构或对应契约。
