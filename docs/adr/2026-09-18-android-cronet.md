# ADR 2026-09-18：Android HTTP 使用嵌入式 Cronet

## 背景

生产 Caddy（`duallane.tsio.top` → `100.99.0.5:8787`）对 localhost 与 Tailscale 的 TLS 正常。
从家庭网访问公网 `39.102.215.160:443` 时，OkHttp / 系统 curl / Firefox / Android WebView
在 Client Hello 后被 RST；同一手机上的小米浏览器可以打开 `/api/health`。应用诊断码为
`net.reset`，`status=0`。

## 选项

1. 只改服务端 WAF / 抗指纹规则。
2. 应用改走嵌入式 Cronet（Chrome 网络栈，含 QUIC），不依赖 GMS。
3. 继续使用 OkHttp，要求用户换网络。

## 决定

选 2。HTTP 仍只访问已配置的 HTTPS origin；Cronet 只替换传输栈。Play Services Cronet
在国内小米机上经常不可用，因此嵌入 `cronet-embedded`。版本用当前 Chrome 主线（143），
避免 119 那种偏短的 Client Hello 被路径上的 RST 注入打掉。

## 观测

冷启动 logcat 应出现 `cronet_installed`；更新检查与 GitHub start 不再报 `net.reset`。
安装失败则记 `cronet_failed` 并回退默认 OkHttp。

## 回滚

去掉 `android-cronet` 插件与 `CronetNetworking.install`，重建 Android 包。

## 2026-10-06 已采纳的后续修正

上述决定记录首次引入 Cronet 的原因。后续先修正标准 WebSocket 握手，使其走
OkHttp 原生双向 streams；code 18 真机又出现 JPEG 上传 rewind 失败，因此当前分流为：
完整 WebSocket upgrade 或 `request.body != null` 使用原请求的 `chain.proceed`，
其余无请求体 HTTP 保留嵌入式 Cronet、QUIC、HTTP2 和 Brotli。

精确 `cronet-okhttp:0.1.1` 的内存和流式上传 provider 均通过 `onRewindError`
报告 `UnsupportedOperationException`，不支持重绕；当前规则避免请求体进入该适配器。
不新增应用层自动重发或请求失败后的跨传输 fallback，不修改 TLS 校验、凭证或生产地址。
这里的失败处理与上文首次安装 Cronet 失败时使用默认 OkHttp 是不同阶段。

带请求体请求重新使用 OkHttp，最初记录的公网 TLS RST 风险仍须在 code 19 正式包
复验；本次 rewind 的具体网络触发条件未知，第二次上传成功不能抹去首次失败。
精确源码依据、兼容边界和验证要求见
[WebSocket 传输 ADR](2026-10-06-android-websocket-transport.md)。
