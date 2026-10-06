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

本节记录首次 WebSocket 修正；下文的请求体 follow-up 是当前完整分流规则。

在既有全局 application interceptor 加一层最小分流：同时具有
`Upgrade: websocket` 与 `Connection: upgrade` token 的请求调用 `chain.proceed`，
其他请求继续调用同一 Cronet delegate。识别多字段、逗号列表、空白和大小写。
这与 OkHttp 的公开 WebSocket 握手一致，无反射、私有字段、第二套凭证或新依赖。

不重建请求，不修改 Authorization、cookies、URL 或 body；TLS 证书和 hostname
验证保持。HTTP 的 QUIC、HTTP2、Brotli 及原有初始化顺序保持。不得用关闭 TLS、
全局禁用 Cronet、持续 HTTP 轮询或吞异常代替实时连接修复。通知仍受既有后台状态、
权限、账号、访问能力、重复与 replay 规则限制；不新增远程推送或保活服务。

## 已采纳的请求体分流 follow-up

code 18 真机首次 JPEG raw PUT 失败，对应匿名诊断为 `net.unknown`、HTTP status 0；
同次原生日志包含内存上传 provider 的 rewind 错误。第二次成功不构成首次通过。
精确 Maven `com.google.net.cronet:cronet-okhttp:0.1.1` AAR 字节码与
[上传 provider 源码](https://github.com/google/cronet-transport-for-okhttp/blob/v0.1.1/java/com/google/net/cronet/okhttptransport/RequestBodyConverterImpl.java)
一致：内存和流式实现均调用 `UploadDataSink.onRewindError(new UnsupportedOperationException(...))`，
并非在该方法中直接抛出异常。触发这次重绕的网络条件仍未知。
[转换器接口](https://github.com/google/cronet-transport-for-okhttp/blob/v0.1.1/java/com/google/net/cronet/okhttptransport/RequestBodyConverter.java)
为包私有，[公开 builder](https://github.com/google/cronet-transport-for-okhttp/blob/v0.1.1/java/com/google/net/cronet/okhttptransport/RequestResponseConverterBasedBuilder.java)
不提供替换上传 provider 的接口；本次不引入反射或依赖补丁。

当前 interceptor 对完整 WebSocket upgrade **或** `request.body != null` 调用
`chain.proceed(request)`；其他请求继续使用同一 Cronet delegate。按请求体是否存在
分流，不按 Content-Type、长度或固定写方法名单猜测；空 body 也走 OkHttp，无 body
的 DELETE 等仍走 Cronet。分流不查询长度、不预读或复制 body、不重建 request，
原有 URL、header、凭证、TLS 校验和一次性请求体语义保持。

头像的字节数组和 JSON 交给标准 OkHttp 请求体处理；合成 JVM 回归验证原请求和
header/body 身份保留，字节请求体连续两次 `writeTo` 得到相同字节。该证据不能推导
任意一次性流都可重放。分流层不新增应用自动重试，不在未知提交结果的失败后自动
切换到另一传输；OkHttp 自身的标准网络恢复语义保持，不承诺网络 exactly-once。
日志仍限匿名 route 族、错误 code、状态、耗时和版本，不加入 body、URI 或凭证。

无请求体 HTTP 保留原 Cronet 网络兼容路径；有 body HTTP 不再使用 Cronet TLS/QUIC，
历史公网 TLS RST 风险因此仍存在。code 19 正式包须验证 JPEG／PNG／WebP 首次上传、
JSON 写入、真实失败后的明确手动重试，以及现有登录／token 流程和标准 WebSocket。
无需为此强制已登录用户退出。实际原生编译和分支回归已通过，尚不能代替这些真机验收；
一次 WebSocket 连通也不能证明上传或 token POST 可用。

## 验证与回滚

生成模板和 checked-in Kotlin 必须一致，重复 prebuild 保持幂等。插件回归先在旧
实现失败再通过，实际 JVM 分支测试涵盖标准／多 token 握手和非 WebSocket 请求。
Android 原生编译及正式同签名包构建必须完成。
实际 JVM fixture 与可重复命令见 [测试与发布](../development/TESTING_AND_RELEASE.md)。

真机覆盖升级后确认登录／草稿保留、实际实时连接、跨端消息和同卡状态刷新，后台
真实机器人消息仅产生一次内容隐藏的本地通知，点击进入授权会话；断网恢复和 replay
不应重复消息或通知。公开登录页模拟器不能代替已认证 WebSocket 验收。
结果记入 [R5](../design/mobile-experience-redesign/R5.md)，未通过前不交付候选。

回滚使用已验证源码与正式证书构建更高 versionCode，不卸载用户应用或回退服务端数据。
