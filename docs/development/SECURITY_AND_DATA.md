# 移动端安全与数据规范

## 信任边界

移动端只访问 Workspace server-retained lane。后端负责登录、membership、权限、配额、
保留、审计和通知收件人；客户端隐藏按钮不构成授权。P2P 内容、`#k=`、WebRTC 和 ntfy
topic 不进入移动端存储、日志、遥测或通知。

## 凭证与缓存

- GitHub 使用 PKCE + 系统 Custom Tabs/ASWebAuthenticationSession 等价 Android 流程；不使用 WebView 收集密码。
- access token 只放内存；refresh token 放 Android Keystore，轮换、重放检测、退出撤销并删除。
- FCM token 加密或哈希保存并绑定 user/device；重装、注销、失效响应都能撤销。
- SQLite/KV 只存可丢失的会话、最近消息、草稿和游标；退出登录清理账号隔离数据。
- 深链和通知只带不可授权的资源引用，打开后重新做服务端授权。

## 日志、通知和内容

日志只记录匿名诊断、错误 code、耗时和版本；不记录 token、消息正文、文件名、FCM token、
邀请链接、URL query、对象 key 或实时 seq。FCM 通知默认只显示“有新消息”，遵守会话
`all/mentions/muted` 偏好；通知点击不绕过登录、成员或文件授权。未知消息不执行 HTML、脚本、
远程组件、自动下载或 Bot action。
