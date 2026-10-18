# Tango Paper Trader 商店提交材料 / Store submission materials

版本 / Version: 0.3.57

- [插件 ZIP](tango-paper-trader-0.3.57.zip) / [SHA-256](tango-paper-trader-0.3.57.zip.sha256)
- [中文文案](LISTING.zh-CN.md) / [English copy](LISTING.en.md)
- [中英文详细介绍](DESCRIPTION.bilingual.txt)
- [后台逐项填写教程](SUBMISSION-GUIDE.zh-CN.md)
- [审核技术说明](STORE-LISTING.md)
- [验收记录](VERIFICATION.md) / [逐文件校验](PACKAGE-SHA256.json)
- [隐私政策](../PRIVACY.md)
- [GitHub Release](https://github.com/nopapername/tango-paper-trader/releases/tag/v0.3.57)

ZIP 根目录直接包含 manifest.json，共45个插件文件；不包含本资料目录、用户备份或测试日志。默认简体中文，保留英文。此更新不代表已提交或通过 Chrome Web Store 审核。

## 商店图像 / Store images

现有5张 JPEG 均为1280×800，真实拍摄于0.3.38，保留其拍摄版本，不标注为0.3.57新截图：

1. [SOL 战壕](screenshot-05-trenches-sol.jpg)
2. [BSC 战壕](screenshot-04-trenches-bsc.jpg)
3. [交易面板](screenshot-01-trading.jpg)
4. [买卖复盘](screenshot-02-replay.jpg)
5. [刷新补画](screenshot-03-chart-refresh.jpg)

[440×280推广图](promo-440x280.png)。这些旧截图未展示组合链、今日盈亏标签或后续缩放UI。提交时请按真实功能选择图像。

Existing screenshots are real 0.3.38 captures, not new 0.3.57 screenshots. They do not demonstrate combined trenches or later UI changes.

扩展弹窗提供插件详细使用教程，并在隐私入口旁显示作者 @oooooyoung 的 X 主页链接；仅在点击后打开外部页面。

The popup includes the detailed plugin guide and author @oooooyoung X profile next to Privacy. External pages open only when clicked.

## 0.3.57 更新

代币复盘：在详情交易面板的买入余额上方点击带笔记图标的“代币复盘”，用一个输入框记录买前想法、认错提醒或交易总结。每条链、每个合约、浏览器本地日期各保存一份；未交易和已清仓代币也可记录。盈亏日历中的“每日复盘”按日期及链回看和编辑。笔记只在当前浏览器本地保存，不自动上传；每份最多4,000字符，独立空间1 MiB。JSON备份包含笔记；导入不含笔记的旧备份会保留现有笔记。

详情页内嵌战壕同样支持模拟快买。战壕模拟买入后可跟随已读取的GMGN“买后代币详情”设置：新标签打开、当前页跳转或不打开；单链及组合页首次使用时请打开一次GMGN自定义弹窗同步该选择，未读取时保留不打开行为。

[中英文发布说明](RELEASE-NOTES.md)；完整回归1,378项通过。最终在线验收范围及限制见 VERIFICATION.md。现有截图仍为真实0.3.38旧版截图，未展示代币笔记或当前紧凑入口；请勿将其标注为0.3.57截图。
