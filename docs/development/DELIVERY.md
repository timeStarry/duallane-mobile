# 交付记录

截至 2026-09-16，移动端已完成 M0-M2 的代码骨架和主要 Workspace 流程，M3 文件流程与 M4 更新入口已接入。

已执行并通过：

```text
pnpm check
pnpm export:android
```

2026-09-16 PR 审查补充的回归覆盖：

- 登录/刷新并发、Strict Mode 重入、退出后的迟到响应和 Keystore 写入顺序。
- 按服务地址隔离更新策略；重新连接后刷新已打开消息；离线只恢复当前账号可见缓存。
- 权限撤销后清除会话缓存；服务器消息覆盖乐观状态，失败回调不能覆盖成功消息。
- Go 分片字段兼容、重复预留额度、空文件、完成响应丢失后的恢复、下载大小和停滞边界。
- 退出时删除上传副本、部分下载及系统通知；未知消息安全降级，撤回附件不提供下载入口。
- Android 签名插件重复运行、Windows prebuild、正式 tag 校验及测试包 CI。
- APK 截图复核发现并修复浅色模式下状态栏图标对比不足；原生 smoke 保留浅色冷启动、浅色重启和深色启动截图，交付前人工复核系统栏与页面内容。

文件完成恢复依赖主仓 PR16 的 `GET /api/workspace/files/uploads/{uploadId}` 扩展；
只查询原上传状态，不增加配额或重复提交。服务端仍检查上传人及当前资源可见性。

主仓认证修复已在 Go 1.26.8 / PostgreSQL 17.11 执行并通过：

```text
go test -count=1 ./...
go test -count=1 -race -tags postgres_integration ./internal/workspace/auth ./internal/platform/config
go vet ./internal/workspace/auth ./internal/platform/config
```

完整 Android APK/AAB 和模拟器验收由 PR 的 `android-test` workflow 记录；必须检查目标
提交的 job 结果与 artifact，不能把已启动的构建当作通过。正式发布签名、真实账号 OAuth、
真机后台通知和 OTA 服务验收未由单元测试或启动 smoke 覆盖。

本次不部署生产。主仓 migration035 需要先发布声明兼容该 schema 的 bridge，
再按主仓部署流程迁移/激活；不能直接越过现有生产升级守卫。

2026-09-17 体验改造：R0 设计确认文档与 R1 视觉／壳层代码已在
`codex/mobile-dl-redesign-requirements` 开工。这不是 MSG 能力完成，也不是验收账本通过。
真机、TalkBack、签名发布包和跨端对照仍标记为未验证。
