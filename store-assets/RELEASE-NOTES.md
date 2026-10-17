## 中文

[官方网站](https://tango-paper-lab.quirkylily.chatgpt.site/) · [详细教程](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/) · [Chrome 商店](https://chromewebstore.google.com/detail/geajcgajdpbiaenjjneccjddbbmipdae)

### 0.3.49 更新

- 兼容 GMGN 新版组合战壕：按每张卡片所属链复用独立模拟账户，按钮明确显示 SOL、BNB、ETH 或 OKB。
- 组合模式主按钮使用该链 Tango 第一个买入预设，2号按钮使用第二个预设；GMGN 组合栏金额不会跨链换算或改写模拟订单。
- 修复刷新组合页后控件延迟挂载、URL不变时快买点击无响应的问题；稳定页面不会反复清理当前操作。
- 组合页余额、今日盈亏、持仓抽屉和日历保留最近查看的单链账户并标注链；买其他链卡片不会混合余额。
- 单链继续跟随 GMGN 的明确列金额与2号原生预设。留空保留正数模拟兜底，明确0或无效值禁用。
- 保留面板缩放、历史日历、买卖复盘、横线、音效与导出。核心记账、权限、隐私政策和邀请码不变。

### 验证与更新

1,348项完整测试通过，35项金额/预设/组合链定向测试通过，独立复核通过。六链随机账本复算覆盖150次事件及最终平仓；本轮在线验收累计12笔买入、14笔卖出，测试余仓已清理，原有仓位未操作。修复后已验证组合页冷启动快买、各链金额、估值/盈亏、复盘、日历日报、PNG及横线刷新补画/隐藏。扩展内部数据面板与实际扬声器声音不属于本轮自动通过范围。

下载下面的 `tango-paper-trader-0.3.49.zip`，解压后加载直接包含 `manifest.json` 的目录。已有用户在原目录替换文件、重新加载扩展并刷新GMGN；不要删除重装。ZIP只包含43个安装文件，不含商店资料、日志或账户备份。建议更新前导出JSON备份。

中英文上架资料已更新。商店截图仍保留0.3.38真实拍摄版本说明，不标为0.3.49截图；本次没有向Chrome Web Store上传或提交审核。

## English

[Official website](https://tango-paper-lab.quirkylily.chatgpt.site/) · [Detailed tutorial (Chinese)](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/) · [Chrome Web Store](https://chromewebstore.google.com/detail/geajcgajdpbiaenjjneccjddbbmipdae)

### Changes

- Support GMGN combined trenches with each card bound to its own supported chain, account and native denomination.
- Combined primary/secondary paper buttons use that chain's Tango buy presets 1/2. Mixed-column GMGN amounts are not converted into paper-order amounts.
- Fix unresponsive quick buys when combined controls mount after a reload without changing the URL. Stable routes do not repeatedly invalidate actions.
- Balance, Today PnL, calendar and positions windows retain the most recently viewed single-chain account and label it. Other-chain card buys never merge balances.
- Preserve single-chain explicit GMGN amounts and native secondary presets. Empty values retain a positive paper fallback; explicit zero or invalid values disable the affected action.
- Preserve resizing, history, replay, chart lines, sounds and exports. Core accounting, permissions, privacy policy and existing invitation code are unchanged.

Validation: 1,348 full regression tests and 35 targeted amount/preset/combined tests passed; independent code review completed. A separate six-chain oracle covers 150 seeded random events and final exits. The live audit confirmed 12 paper buys and 14 sells, closed its test positions and did not operate pre-existing holdings. Live checks include post-reload combined quick buys, chain-specific amounts, valuation/PnL, replay, daily-report PNG, and chart-line refresh/hide. Extension-internal dashboard pages and audible speaker output were not automatically revalidated this round.

Use the plugin ZIP below, not GitHub's source archive. Extract and load the directory containing manifest.json. Existing users should replace files in the same location, reload Tango and refresh GMGN; do not uninstall/reinstall. The package contains 43 runtime files and excludes store materials and user data. Export a JSON backup before updating.

Bilingual store materials are updated. Existing screenshots retain their actual 0.3.38 capture-version disclosure. This release does not upload or submit an update to the Chrome Web Store.

### SHA-256

`d55e21549d064d7509fcd9b92e98878782b318f61092d5b3856e1d21ae41470e`  `tango-paper-trader-0.3.49.zip`
