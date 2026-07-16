# 安全设计

## 最小权限

- `storage`：保存虚拟余额、持仓、交易历史和设置。
- `content_scripts.matches: https://gmgn.ai/*`：仅用于在 GMGN 页面显示模拟交易界面并读取页面上已经可见的代币价格。

插件没有 `activeTab`、`tabs`、`cookies`、`history`、`webRequest`、`downloads`、`clipboardRead`、`management`、`nativeMessaging` 或 `<all_urls>` 权限。

## 网络与执行边界

- 源码中没有 `fetch`、XHR 或 WebSocket，不向任何服务器发送数据。
- 扩展页面 CSP 只允许加载扩展包内的脚本，并禁用对象资源和 `base` 重定向。
- 不使用 `eval`、`new Function`、远程脚本或动态代码下载。
- 不注入主页面 JavaScript 环境，不包装 GMGN 的网络请求，也不读取认证信息。

## 发布建议

发布前应从版本控制中的源码重新构建 ZIP，并复查权限与文件哈希。任何新增权限、网络请求、远程资源或混淆代码都应作为安全敏感变更单独审查。

无法承诺任何软件绝对零风险。降低扩展供应链风险的最佳做法是保持源码公开、权限稳定、版本可复现，并避免把商店发布账号交给第三方。
