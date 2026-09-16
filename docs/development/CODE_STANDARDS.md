# 移动端代码规范

- 使用 strict TypeScript 和 discriminated union；禁止 `any`、`@ts-ignore` 和未校验的 JSON cast。
- 所有外部 JSON 先经过 schema parser；未知消息进入 fallback，不抛出到 WebSocket 生命周期。
- 组件接收语义 props，不暴露 store setter；权限判断在 feature/controller，基础组件不读权限。
- 异步请求绑定 user、conversation、route 和 invocation ID；切换账号或页面后迟到响应不得回写。
- optimistic message 必须带 `clientMessageId`，失败可重试，重试不能生成重复逻辑消息。
- Effect 必须可取消、可重入并兼容 Strict Mode；WebSocket、FCM listener、后台任务必须清理。
- 不在日志中输出 token、FCM token、消息正文、文件名、邀请 secret、URL query、内部路径或 seq。
- 日期、字节、超时、版本和平台字段使用明确名称；不把 build number 当作 protocol version。
- UI 文案使用稳定错误 code 映射；不把 SQL、stack、provider 错误或 request ID显示给用户。
- 测试优先验证状态和契约：协议 fallback、重连、幂等、权限拒绝、通知去重和更新门禁。
