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
