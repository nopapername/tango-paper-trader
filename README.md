# Tango Paper Trader

**p小将的虚拟打狗工具 · 完全免费 · 用模拟资金练习 Meme 交易**

**Free Meme trading practice for everyday traders — simulated funds, real market context.**

在 GMGN 页面直接模拟买卖，练习入场、加仓、减仓、回本与复盘。无需连接钱包，不涉及真实资金。

Practice entries, scaling, exits and trade reviews directly on GMGN. No wallet connection or real funds required.

**当前版本 / Current version: 0.3.45**

[中文使用指南](#中文使用指南) · [English guide](#english-guide) · [Privacy](PRIVACY.md) · [Security](SECURITY.md)

## 中文使用指南

[官方网站](https://tango-paper-lab.quirkylily.chatgpt.site/) · [详细使用教程](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/)

### 能做什么

- **模拟买卖**：战壕卡片快捷买入、详情页金额预设、按比例卖出、一键回本，以及持仓抽屉中的卖出操作。
- **实时查看仓位**：当前链余额与盈亏浮条；卡片名称旁显示“持仓 … SOL / BNB / ETH / OKB”估值标签，清仓后移除。
- **独立的六链账户**：每条链独立记账，切链不合并本金、仓位或交易记录。
- **买卖复盘**：详情页及 History 的“查看买卖记录”展示成交点、时间、数量、金额和已实现盈亏，平仓后仍可查看。
- **图表辅助**：兼容的 GMGN K 线上显示虚拟买入/卖出横线，可隐藏；可用性取决于图表坐标和行情是否可信。
- **数据面板**：Overview、Positions、History、Calendar，支持搜索、筛选、日期查看和六链美元汇总。
- **日报与导出**：点日历日期生成简洁盈亏日报，可切原生币/USD、下载 PNG 或复制图片；支持成交结果 PNG、CSV 导出和 JSON 备份恢复。
- **个性化设置**：中文/English、深色/浅色/跟随系统、买卖预设、费用、滑点、确认模式、快速模式及成交音效。

### 支持的链

| 网络 | 模拟账户原生币 |
| --- | --- |
| Solana | SOL |
| BNB Chain（BSC） | BNB |
| Ethereum | ETH |
| Base | ETH |
| Robinhood Chain | ETH |
| X Layer | OKB |

同为 ETH 的账户也彼此独立。例如初始本金设为 10，会分别获得 10 SOL、10 BNB、各链的 10 ETH 和 10 OKB，**不是等值美元，也不是共享余额**。

### 安装与更新

此仓库就是可直接加载的插件安装包，**无需 Node.js、npm 或构建步骤**。

1. 在 GitHub 下载仓库 ZIP 并解压，或克隆仓库。
2. 在 Chrome 地址栏打开 `chrome://extensions`，开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择**直接包含 `manifest.json` 的文件夹**。
4. 打开 [GMGN](https://gmgn.ai/)，或刷新所有已打开的 GMGN 标签页。
5. 首次使用按引导选择语言和模拟本金，再开始练习。

目录结构应为 `tango-paper-trader/manifest.json`；没有 `dist` 或内层同名安装包目录。项目维护者当前的本地安装路径为 `D:\web3\code_project\tango-paper-trader`，其他用户可使用自己的解压路径。

**更新已有安装：**先导出 JSON 备份，再把新版文件更新到原安装目录，在扩展管理页点击“重新加载”，并刷新全部 GMGN 标签页。仅刷新网页不会加载新版扩展脚本。通常无需删除或重新安装插件。

改变安装目录可能产生不同的扩展身份与存储；不同浏览器或配置文件的数据也彼此独立。迁移前备份，需要时在新安装中手动导入。

### 从第一笔交易开始

1. 在扩展弹窗确认 Tango 总开关已开启，并选择要练习的链。
2. 在 GMGN 战壕卡片上点击带有 **“模拟盘 / Paper”** 标记的 Tango 快买按钮，或进入代币详情页使用 Tango 浮动交易面板。
3. 选择金额，核对确认窗中的代币、报价、滑点和费用后确认。快速模式或本次会话免确认会跳过确认步骤，请先熟悉普通模式。
4. 买入后查看卡片持仓估值、详情页当前市值、总利润及持仓抽屉。
5. 卖出按钮按**当前剩余数量**计算：例如先卖出 25%，再卖出 50%，最终剩余最初数量的 37.5%。100% 卖出用于平仓。
6. 在“查看买卖记录”中检查成交点和明细，或在数据面板 History 查看、筛选和导出记录。

GMGN 的自定义按钮尺寸在兼容卡片上会同步到 Tango 快买按钮；双按钮金额分别读取。明确为 0 或无效的金额不会继续沿用旧金额执行。

**快捷键：**`Alt+Shift+Y` 切换模拟交易总开关。若被浏览器或系统占用，可在 Chrome 的 `chrome://extensions/shortcuts` 检查分配；也可直接使用扩展弹窗的总开关。

### 怎样理解盈亏与一键回本

- **买入成本**按投入的原生币累计；滑点及配置的费用会影响实际获得的代币数量。
- **已实现盈亏** = 本次卖出净回款 − 本次卖出数量分摊的剩余成本。卖出净回款已扣除相关模拟费用。
- **未实现盈亏** = 剩余仓位当前估值 − 剩余成本，不等同于最终卖出可得金额；卖出还需考虑费用与滑点。
- **详情页总利润**综合该代币的累计净卖出回款、剩余估值与累计买入投入；部分卖出后，它与剩余仓位的浮动盈亏可能不同。
- **一键回本**以“累计买入本金 − 此前净卖出回款”为目标，并考虑当前卖出费用。例如投入 1 SOL、此前净回收 0.6 SOL，目标是再净回收约 0.4 SOL。已回本时禁用；仓位不足以回收目标本金时可能不可用。
- 美元金额依赖有效的原生币/USD 参考价。缺价或过期时会提示不完整，部分页面会退回带单位的原生币显示；不应把缺失值当成零盈亏。

金额存在显示精度与舍入差异。日历/日报以当日已实现盈亏为核心，不能与包含未实现仓位的总盈亏直接比较。

### 报价、无 K 线与复盘边界

Tango 优先复用可验证的 GMGN 页面及网络行情；在支持的链上，数据不足时可使用 DEX Screener 备用报价。报价会检查链、代币身份、时间及价格/市值/供应量的一致性。详情页买入预览读取当前已校验报价，确认成交时再次校验；行情变化时最终成交可能与预览不同。

**没有 K 线也可以模拟卖出**，无需等待蜡烛图出现；但仍需通过现有报价或持仓估值校验。缺少真实行情时，部分场景会使用明确标注的临时模拟估值，后续验证行情到达后可能进行中性校准。临时估值不是可成交的真实市场价格；报价无法安全使用时操作会被拒绝。

复盘图优先利用已采集且身份、单位明确的行情。没有真实蜡烛数据时，可以显示已记录报价，或以虚线连接实际成交点，**这不是完整 K 线，也不代表两笔成交之间的真实走势**。价格点含成交滑点；市值点对应记录中的当时报价市值。没有可信坐标的成交仍保留在明细中，并提示未绘点。

复盘行情缓存有容量限制，与账户数据分开存储，**不包含在 JSON 账户备份中**。导入备份后仍能查看成交明细，但未采集或已淘汰的历史行情不会自动恢复。复盘不会改写交易、余额或盈亏。

### 数据、备份与常见问题

- **CSV**导出当前链保留的成交明细；**JSON**备份包含全部六链账户、仓位、历史及设置，导入会替换整份模拟账户数据，需要确认。
- 修改共同初始本金并确认重置，会清除六链的余额、仓位、成交及盈亏统计；先备份。不要为了更新版本而重置账户。
- 买入预设与网络费按链配置；卖出预设、平台费、滑点、确认/快速模式、音效、语言、主题等为全局设置。
- 历史记录有保留上限。部分日期总计会持续保存，但笔数、胜率和最佳/最差成交等明细统计基于保留记录；日报会提示统计范围。
- 六链美元汇总为只读汇总，不提供跨链交易。报价缺失时可点击“刷新美元报价”，等待刷新完成。
- GMGN 页面改版或原生图表空白可能影响按钮识别、横线或行情采集；请记录链、合约、时间、版本和具体提示后反馈。
- 内置浏览器若提示 `Owl extension-created tab was blocked before presentation`，表示浏览器阻止展示扩展数据面板。可使用普通 Chrome；若错误窗提供 JSON 导出或只读备份文本，可先保存备份。重装不能解除浏览器拦截，还可能丢失本地数据。

### 使用范围与隐私

Tango **完全免费，仅用于模拟交易与练习**。不连接钱包，不请求助记词/私钥，不签名、授权或广播链上交易。只点击明确标注 Tango/模拟盘的控件；GMGN 原生买卖按钮属于 GMGN 自身功能。

模拟余额、仓位、设置及历史保存在当前浏览器本地。公开行情请求可能携带链标识或公开代币合约地址；核心模拟账户数据不会上传到 Tango。详情见 [隐私说明](PRIVACY.md) 与 [安全说明](SECURITY.md)。

模拟结果不保证真实交易表现，也不能反映全部流动性、税费、MEV、成交失败或市场冲击。

## English guide

[Official website](https://tango-paper-lab.quirkylily.chatgpt.site/) · [Detailed tutorial (Chinese)](https://tango-paper-lab.quirkylily.chatgpt.site/tutorial/)

### What you can do

- **Practice trades:** trench quick buys, token-detail buy presets, percentage sells, recover-principal actions and position-drawer exits.
- **Track positions:** current-chain balance/PnL bar and a native-asset holding-value badge beside held tokens on compatible cards.
- **Use six independent accounts:** switching chains does not merge balances, positions or trade history.
- **Review trades:** open **View trades** from History or a token-detail panel, including after closing a position. Inspect B/S markers, timestamps, quantities, amounts and realized PnL.
- **Use chart aids:** virtual entry/exit horizontal lines on compatible GMGN charts, with hide controls. Lines require trustworthy chart coordinates and observations.
- **Analyze results:** Overview, Positions, History and Calendar; search/filter records and view a read-only all-chain USD summary.
- **Share and back up:** click a calendar date for a daily realized-PnL report, switch native/USD units, download PNG or copy the image. Export trade-result PNGs, current-chain CSVs and full-account JSON backups.
- **Customize:** English/Simplified Chinese, dark/light/system themes, trade presets, fees, slippage, confirmation/fast mode and fill sounds.

### Supported chains

| Network | Paper-account native asset |
| --- | --- |
| Solana | SOL |
| BNB Chain (BSC) | BNB |
| Ethereum | ETH |
| Base | ETH |
| Robinhood Chain | ETH |
| X Layer | OKB |

Even ETH accounts are separate. Initial capital of 10 gives each chain 10 units of its own native asset. These are **not USD-equivalent allocations or a shared balance**.

### Install and update

This repository is the ready-to-load extension package. **No Node.js, npm or build step is required.**

1. Download and extract the repository ZIP, or clone it.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the folder that directly contains `manifest.json`.
4. Open [GMGN](https://gmgn.ai/) or refresh every existing GMGN tab.
5. Complete first-run language and paper-capital setup.

The layout is `tango-paper-trader/manifest.json`, without a `dist` wrapper or nested package folder. The maintainer's local path is `D:\web3\code_project\tango-paper-trader`; you can use your own extraction path.

**Updating:** export a JSON backup, replace files in the existing installation folder, click **Reload** in the extension manager, then refresh all GMGN tabs. Refreshing GMGN alone does not load updated extension scripts. Removing/reinstalling is normally unnecessary.

Changing the unpacked-extension path may create a different extension identity/storage area. Browsers and profiles also have separate data. Back up before migrating and manually import into the new installation if needed.

### Make your first paper trade

1. Enable Tango in its popup and select the chain you want to practice on.
2. Click a Tango button labeled **Paper / 模拟盘** on a trench card, or use the Tango floating panel on a token-detail page.
3. Choose an amount and review the token, quote, slippage and fees before confirming. Fast mode or session-level confirmation suppression skips this step; start with confirmation enabled.
4. Check the card holding-value badge, current market cap, total PnL and position drawer.
5. Sell percentages apply to the **remaining quantity**: selling 25%, then 50%, leaves 37.5% of the original amount. Use 100% to close the position.
6. Open **View trades** to inspect fills, or use History to search, filter and export them.

On compatible cards, Tango follows GMGN's configured button sizes and reads dual-button amounts independently. Explicit zero/invalid amounts do not execute using an older amount.

**Shortcut:** `Alt+Shift+Y` toggles paper trading. Check `chrome://extensions/shortcuts` if another browser/system action occupies it, or use the popup master switch.

### PnL and recovering principal

- **Buy cost** accumulates the invested native asset. Configured fees and slippage affect the quantity received.
- **Realized PnL** = net sell proceeds − the proportional remaining cost basis assigned to that sale. Net proceeds include applicable simulated fee deductions.
- **Unrealized PnL** = current remaining-position value − remaining cost basis. It is not the final amount obtainable after sell fees and slippage.
- **Token total PnL** combines cumulative net sell proceeds, remaining value and cumulative buy investment. After partial exits, it can differ from the remaining position's unrealized PnL.
- **Recover principal** targets cumulative buy investment minus previous net sell proceeds, accounting for current exit fees. After investing 1 SOL and recovering 0.6 SOL, it targets roughly another 0.4 SOL net. It is disabled when principal is already recovered and may be unavailable when the holding cannot cover the target.
- USD values require a valid native-asset/USD reference. Missing/stale rates are marked incomplete; some views fall back to labeled native amounts. Missing data is not zero PnL.

Displayed amounts are rounded. Calendar/daily reports focus on realized results for the selected day and should not be compared directly with totals that include open positions.

### Quotes, missing charts and replay limits

Tango prioritizes verifiable GMGN page/network observations and can use DEX Screener fallback quotes on explicitly supported chains. Quotes are checked for chain/token identity, freshness and price/market-cap/supply consistency. Detail buy confirmation uses the current verified observation and checks again at execution; changing markets can produce a different final fill.

**A visible K-line chart is not required to paper-sell.** Available quotes or held-position valuations must still pass validation. Some missing-data cases use an explicitly labeled provisional paper valuation, which may be neutrally calibrated when verified data arrives. A provisional estimate is not a real executable market price. Unsafe/unusable quotes can block an action.

Replay reuses captured market data with known token identity and units. Without candles, it may show sampled quotes or a dashed connection between recorded fills. **The dashed path is not a candlestick history or the actual intervening market.** Price markers include execution slippage; market-cap markers use the recorded observation. Fills without trustworthy coordinates remain in the ledger with a chart notice.

Replay market data uses a bounded, separate local cache and **is not included in account JSON backups**. Restored fills remain viewable, but unobserved/evicted market history cannot automatically be recovered. Replay does not change fills, balances or PnL.

### Data, backups and troubleshooting

- **CSV** exports retained trades for the selected chain. **JSON** covers all six-chain accounts, positions, history and settings; import replaces the full paper-account dataset after confirmation.
- Confirming a common-capital reset clears balances, positions, trades and PnL statistics across all six chains. Back up first; updating the extension does not require an account reset.
- Buy presets and network fees are per-chain. Sell presets, platform fees, slippage, confirmation/fast mode, sound, language and theme are global.
- Trade history has a retention limit. Persistent daily totals can outlive individual records; counts, win rates and best/worst fills use retained history. Daily reports disclose their statistics scope.
- All-chain USD totals are read-only, not cross-chain trading controls. Use **Refresh USD prices** when reference prices are missing and allow the refresh to finish.
- GMGN layout changes or blank native charts can affect button detection, lines and quote collection. Include the chain, contract, time, extension version and exact error when reporting a problem.
- `Owl extension-created tab was blocked before presentation` means the embedded browser blocked presenting the extension dashboard. Use ordinary Chrome where available. If offered, save JSON using the error dialog's export or read-only backup text. Reinstalling does not remove the browser restriction and may lose local data.

### Scope and privacy

Tango is **completely free and intended for paper trading/practice only**. It does not connect wallets, request seed phrases/private keys, sign approvals or broadcast blockchain transactions. Use clearly labeled Tango/Paper controls; GMGN's native trading controls belong to GMGN.

Paper balances, positions, settings and history stay in the current browser's local storage. Public market-data requests may include chain identifiers or public token contracts; core paper-account data is not uploaded to Tango. Read [Privacy](PRIVACY.md) and [Security](SECURITY.md).

Simulated results do not guarantee live performance or model every liquidity constraint, token tax, MEV effect, failed transaction or market impact.
## Store edition / 商店准备版

买卖音效使用 GMGN Handgun / Kaching，播放失败时使用本地合成提示音；图标为 Tango 独立设计。隐私政策可在插件内打开，也可阅读 [中英文政策](PRIVACY.md)。



### Account and valuation details

- Trading and chain-scoped portfolio operations are current-chain-only. Only the active chain supplies the balance, positions, history, and header asset. JSON import and export form a full six-chain backup.
- Changing common capital requires explicit confirmation and atomically resets every chain: balances, positions, trades, PnL/analytics, and calibrations, while preserving other settings.
- Buy presets and network fee are per-chain; common capital is shared across all six independent chain accounts numerically, not converted. Sell presets, slippage, platform fee, confirmation, fast mode, sound, language, theme, enabled state, and selected chain are global.
- First-run onboarding lets the user choose language and one common paper-capital amount, defaulting to 10. All six independent chain accounts receive that chosen numeric amount in their own native asset. First install opens the onboarding dashboard once; extension updates do not reopen onboarding.
- GMGN live data takes precedence over K-line or synthetic market-cap estimates where applicable to the verified quote route. With no usable observation, the canonical deterministic fallback opens at $3,200 market cap with a provisional 1B supply divisor; it is explicitly simulated.
- There is no wallet connection, signature, approval, swap, transaction broadcast, RPC broadcast, or real funds capability.
