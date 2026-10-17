## 中文

[官方网站](https://tango-paper-lab.quirkylily.chatgpt.site/) · [详细使用教程](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/)

### 0.3.46 更新

- 战壕页底部改为“今日盈亏”：按浏览器本地日期，统计当前链今日卖出的已实现净盈亏，跨天自动从新一天开始。
- 未平仓浮盈浮亏不计入底部今日金额；其他总盈亏视图保持原统计口径。
- 不重置余额、持仓或日历历史，不改变买卖、报价和结算逻辑。
- 更新中英文说明、商店资料、安装 ZIP 与逐文件 SHA-256 清单。

### 安装与更新

解压下方 `tango-paper-trader-0.3.46.zip`，在 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，选中直接包含 `manifest.json` 的目录。已有用户请替换原目录文件后重新加载扩展，并刷新全部 GMGN 标签页；不要删除重装，以免丢失本地数据。更新前建议导出 JSON 备份。

本地1,319项测试通过；发布者已手动确认今日金额、余额、持仓、日历历史正常。跨天行为通过可控时间回归验证。只用于模拟练习，不涉及真实资金。旧版商店截图保留，未标为本版本新截图。

## English

[Official website](https://tango-paper-lab.quirkylily.chatgpt.site/) · [Detailed tutorial (Chinese)](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/)

### Changes

- The bottom bar now shows current-chain **Today PnL**, using realized net PnL from sells on the browser's local date. A new date starts a new total automatically.
- Unrealized PnL is excluded from that daily bar; other cumulative PnL views retain their existing basis.
- Balances, positions and historical calendar records are preserved. Trading, quoting, settlement and permissions are unchanged.
- Bilingual documentation, store materials, the extension ZIP and per-file SHA-256 manifest are updated.

### Install / update

Extract the plugin ZIP below and load the folder containing `manifest.json` through Chrome's developer mode. Existing users should replace files in the same folder, reload Tango, then refresh every GMGN tab. Do not uninstall/reinstall; export a JSON backup before updating.

Validation: 1,319 local tests passed. The publisher manually confirmed today's amount and preservation of balances, positions and calendar history; rollover was verified with controlled-clock tests. Existing store screenshots are historical captures, not newly captured for this version.

### SHA-256

`c02dfd6e75a07de5e54ff562df451b7eec8e779bd3671201c312142b680c5c0a`  `tango-paper-trader-0.3.46.zip`

Use the plugin ZIP asset below, rather than GitHub's auto-generated source archive. The ZIP contains 43 install files with `manifest.json` directly at the root; store materials are excluded.
