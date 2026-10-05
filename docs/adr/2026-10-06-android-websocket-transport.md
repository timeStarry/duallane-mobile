# Android WebSocket 与 HTTP 传输分流

## 背景与证据

正式 code 8 真机可读取 HTTP 会话和文件，实时连接却持续重试并退回 HTTP 同步。
RN WebSocketModule 从全局 OkHttpClientProvider 复制 client，继承 Cronet application
interceptor。Cronet 0.1.1 直接生成 HTTP Response，不调用 OkHttp 原生网络 chain；
OkHttp WebSocket 则必须从 Response 的 exchange 创建双向 streams，因此此组合无法
完成 WebSocket。此处是依赖源码证据，未声称从真机捕获具体 exception 文本。

依据：[Google Cronet interceptor 源码](https://github.com/google/cronet-transport-for-okhttp/blob/v0.1.1/java/com/google/net/cronet/okhttptransport/CronetInterceptor.java)、
[OkHttp WebSocket 实现](https://github.com/square/okhttp/blob/parent-4.9.2/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt)。

## 决定与边界

在既有全局 application interceptor 加一层最小分流：同时具有
`Upgrade: websocket` 与 `Connection: upgrade` token 的请求调用 `chain.proceed`，
其他请求继续调用同一 Cronet delegate。识别多字段、逗号列表、空白和大小写。
这与 OkHttp 的公开 WebSocket 握手一致，无反射、私有字段、第二套凭证或新依赖。

不重建请求，不修改 Authorization、cookies、URL 或 body；TLS 证书和 hostname
验证保持。HTTP 的 QUIC、HTTP2、Brotli 及原有初始化顺序保持。不得用关闭 TLS、
全局禁用 Cronet、持续 HTTP 轮询或吞异常代替实时连接修复。通知仍受既有后台状态、
权限、账号、访问能力、重复与 replay 规则限制；不新增远程推送或保活服务。

## 验证与回滚

生成模板和 checked-in Kotlin 必须一致，重复 prebuild 保持幂等。插件回归先在旧
实现失败再通过，实际 JVM 分支测试涵盖标准／多 token 握手和非 WebSocket 请求。
Android 原生编译及正式同签名包构建必须完成。

真机覆盖升级后确认登录／草稿保留、实际实时连接、跨端消息和同卡状态刷新，后台
真实机器人消息仅产生一次内容隐藏的本地通知，点击进入授权会话；断网恢复和 replay
不应重复消息或通知。公开登录页模拟器不能代替已认证 WebSocket 验收。
结果记入 [R5](../design/mobile-experience-redesign/R5.md)，未通过前不交付候选。

回滚使用已验证源码与正式证书构建更高 versionCode，不卸载用户应用或回退服务端数据。
