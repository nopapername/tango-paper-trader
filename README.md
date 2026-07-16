# GMGN Paper Trader

一个不连接钱包、不发送真实交易的 Chrome Manifest V3 模拟交易扩展。所有设置、虚拟余额、持仓和交易记录都保存在浏览器本地。

## 功能

- 在 GMGN 的 Solana / BSC 代币页面显示虚拟交易面板
- 虚拟买入、按比例卖出、平均成本和已实现/未实现 PnL
- 自定义初始 SOL / BNB、手续费和滑点
- 持仓与最近 1000 条交易记录
- JSON 数据导出和账户重置
- 自动读取页面价格，读取失败时可手动输入 USD 价格
- 无账号、无激活码、无分析埋点、无远程服务器
- 仅申请本地 `storage` 权限；页面代码只匹配 `https://gmgn.ai/*`
- 不发起 Fetch/XHR/WebSocket 请求，不加载远程代码

## 安装

1. 在 Chrome 地址栏打开 `chrome://extensions/`。
2. 打开右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录 `gmgn-paper-trader`。
5. 打开一个形如 `https://gmgn.ai/sol/token/...` 或 `https://gmgn.ai/bsc/token/...` 的页面。

## 安全边界

扩展只申请 `storage` 权限。内容脚本只匹配 `https://gmgn.ai/*`，这是在 GMGN 页面显示面板所必需的站点访问范围；它不会在其他网站运行，也不会读取助记词、请求钱包签名或发送链上交易。详细说明见 `PRIVACY.md` 和 `SECURITY.md`。

## 价格说明

插件从 GMGN 页面可见元素读取价格。GMGN 改版后自动识别可能失效，此时可在交易面板中手动输入当前 USD 价格。虚拟盈亏以最近识别或手动设置的价格计算。
