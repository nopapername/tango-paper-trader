## 中文

[官方网站](https://tango-paper-lab.quirkylily.chatgpt.site/) · [详细使用教程](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/)

### 0.3.47 更新

- 底部盈亏框和详情快捷交易面板可拖动边框、四角，按 **75%–150%** 等比例缩放，字号和按钮同步变化。
- 两个面板分别记住尺寸，刷新后保留；点击 **↺** 恢复默认大小。原有拖动位置与收起功能保留。
- 修复长代币名与大金额的布局溢出；限制窗口边界，小窗口保留滚动访问。
- 防止缩放松手时误触交易按钮；兼容行情刷新、切页、总开关关闭及扩展连接失效的中断。
- 本次仅为 UI 和布局偏好更新，不修改报价、成交、盈亏计算、余额或持仓；今日盈亏与日历历史继续保留。
- 更新中英文文档、商店资料、ZIP 及校验文件。

### 验证与安装

**1,332 项本地测试通过**；独立本地 Chrome 布局测试覆盖两种窗口、三档缩放、长名称、大金额和完整按钮。用户已在 GMGN 手动确认缩放、尺寸记忆和恢复默认正常。本次未新增交易或重置账户。

下载下方 `tango-paper-trader-0.3.47.zip`，解压后选择直接包含 `manifest.json` 的目录安装。已有用户请在原目录替换文件、重新加载 Tango，并刷新所有 GMGN 页面；不要删除重装，以免丢失浏览器本地数据。更新前建议导出 JSON 备份。

商店资料随仓库更新；现有截图仍注明原拍摄版本，不冒充本次新截图。本次未向 Google 提交审核。

## English

[Official website](https://tango-paper-lab.quirkylily.chatgpt.site/) · [Detailed tutorial (Chinese)](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/)

### Changes

- Resize the bottom PnL bar and detail trading panel by dragging any edge or corner, with **75%–150% proportional scaling** of text, spacing and controls.
- Each surface remembers its size across refreshes. Click **↺** to restore its default size; existing movement and collapse controls remain available.
- Improve long-symbol and large-amount wrapping and keep surfaces within the viewport, with scrolling for constrained windows.
- Guard resize-release clicks against accidental trading and cancel gestures cleanly on navigation, disablement or invalidated extension contexts.
- This is a UI/layout-preferences update. Quotes, execution, PnL calculations, balances, positions, Today PnL and calendar history retain their existing behavior.

Validation: **1,332 local tests passed**. Isolated local Chrome fixtures covered two viewport sizes and three scales; the publisher manually confirmed the live GMGN resize/persistence/reset controls. No test trades, imports or account resets were performed for this update.

### Install / update

Use the plugin ZIP asset below, rather than GitHub's auto-generated source archive. Extract it and load the folder containing `manifest.json`. Existing users should update the same directory, reload the extension and refresh all GMGN tabs; do not uninstall/reinstall. Export a JSON backup before updating.

The ZIP has 43 runtime files at its root and excludes store materials. Store screenshots retain their historical capture-version disclosure. No Chrome Web Store submission is performed by this release.

### SHA-256

`df0896b066ed30d1e7e4dd2c9f2ee790e2eb3ac1c942decee3948c82aa2829ac`  `tango-paper-trader-0.3.47.zip`
