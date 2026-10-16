# Tango Paper Trader Chrome Web Store submission draft

Version: 0.3.39. Submission materials; Google review has not been performed.

## 中文商店文案

名称：Tango Paper Trader

简短说明：在 GMGN 练习六链 Meme 模拟交易，查看仓位、盈亏、买卖复盘与日报。无需连接钱包。

详细说明：

Tango 是完全免费的 Meme 模拟交易练习工具，独立于 GMGN。使用模拟资金练习入场、加仓、减仓和回本，不签名、不广播真实交易。

支持 Solana、BSC、Ethereum、Base、Robinhood Chain、X Layer，各链独立余额和仓位。可使用战壕模拟快买、详情页交易面板、按比例卖出和回本工具；卡片显示持仓原生币估值，面板显示当前市值及盈亏。

历史记录与详情页提供买卖点复盘；没有完整行情时，成交点虚线连线明确标注为非真实走势。兼容图表可显示虚拟买卖横线。支持盈亏日历、日报 PNG、成交图片、CSV 与全部账户 JSON 备份恢复。界面支持中文和英文、深浅主题。


模拟数据存储在当前浏览器。插件读取 GMGN 公开行情，并可能向 CoinGecko、DEX Screener 查询参考行情。模拟交易不等同真实市场成交，不保证收益。网站改版和行情缺失可能影响兼容性。

## English store copy

Name: Tango Paper Trader

Short description: Practice six-chain Meme paper trading on GMGN with positions, PnL, trade replay and daily reports. No wallet needed.

Detailed description:

Tango is a completely free Meme paper-trading practice tool independent of GMGN. Practice entries, scaling, percentage exits and recovering principal using simulated funds. It does not connect wallets, sign transactions or broadcast real trades.

Use independent accounts on Solana, BSC, Ethereum, Base, Robinhood Chain and X Layer. Compatible trench cards offer labeled paper quick buys and native-asset holding-value badges. Token-detail panels show quotes, market caps and PnL, with percentage sells and a recover-principal action.

Review recorded buy/sell points from History or token detail pages. A dashed fill-to-fill path is explicitly labeled as non-market history when complete market data is unavailable. Compatible charts support virtual entry/exit lines. Use PnL calendars, daily-report PNGs, trade-result images, CSV exports and full-account JSON backups. English/Chinese and light/dark themes are supported.


Paper data stays in the current browser. Tango reads public GMGN market observations and may request reference quotes from CoinGecko and DEX Screener. Simulated results do not guarantee live performance. Site changes and missing quotes can limit compatibility.

## Privacy and permission fields

Single purpose / 单一用途：Provide local simulated Meme-token trading practice and review on supported GMGN pages. / 在受支持的 GMGN 页面提供本地 Meme 模拟交易练习和复盘。

- storage: store paper accounts, settings, retained fills, daily aggregates and bounded replay cache locally; session storage holds confirmation suppression.
- https://gmgn.ai/*: identify current-chain/token public observations, display clearly labeled paper controls and overlay compatible chart markers. MAIN-world scripts passively observe market responses and chart axes.
- https://api.coingecko.com/*: obtain native-asset/USD public reference prices.
- https://api.dexscreener.com/*: obtain fallback public token quotes only on explicitly supported chains.
- No tabs/history/wallet/debugger/userScripts/all-sites permission is requested. Creating a tab does not itself require the tabs permission.

Privacy URL after publishing and verifying the updated policy: https://github.com/nopapername/tango-paper-trader/blob/main/PRIVACY.md . The same policy is included in privacy.html and linked inside the extension. Verify the published main-branch policy before entering that URL in a submission.

Support: https://github.com/nopapername/tango-paper-trader/issues
Homepage: https://github.com/nopapername/tango-paper-trader

Data-use answers must describe actual behavior, not assume that local-first means no data handling. The extension handles paper activity/settings locally and reads GMGN website content. External quote requests contain public asset identifiers/token contracts and expose ordinary network metadata to providers. No paper-account server upload, advertising analytics, wallet credentials, authentication collection or real financial transactions are implemented. Review the current dashboard's field definitions before selecting categories; do not claim browser-wide history collection or upload of paper balances.

Limited Use: certify only the practices described in the included privacy policy. No sale of user data, personalized-ad use, creditworthiness/lending use, or unrelated tracking.

## Remote code and chart recovery reviewer notes

All extension application logic is packaged locally. No eval, new Function, remotely imported application module or remotely interpreted command is used. Market endpoints provide JSON data. Buy/sell audio is requested from GMGN Handgun.mp3 / Kaching.mp3 at runtime, with locally synthesized fallback cues; no remote JavaScript is loaded for audio playback.

The extension also operates on a third-party website that has its own remote TradingView code. src/content/page-main.js runs only in GMGN's MAIN world. For a persistently empty, identified native chart iframe, recovery captures only the site's original HTML blob, verifies its same-origin GMGN TradingView base and script paths, and reuses that unchanged document as the native iframe's srcdoc once. It does not run that HTML in popup/dashboard/extension-origin pages, grant the site's JavaScript extension API access, or load third-party code as extension application logic. The isolated content script uses narrowly handled DOM/market messages, not arbitrary site commands. Navigating to another chart removes obsolete recovery content.

This behavior is disclosed for review under the MV3 exception for code in contexts isolated from extension APIs. It is not a claim that every iframe automatically qualifies, nor a request to bypass review. Policy: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements

Regression coverage: healthy/disabled/unrelated frame preservation; one recovery only; asynchronous navigation; stale-srcdoc removal; wrong external script/base rejection; no chart-recovery imports in extension pages. No production chart-recovery behavior was removed for this store preparation.

## Reviewer test instructions

1. Install the unpacked package or uploaded ZIP in standard Chrome. No Tango account, key or real wallet is required. GMGN availability may depend on region/site access.
2. Open first-run setup, select language and capital. Use “Save setup only (no referral)” to avoid referral navigation, then manually visit https://gmgn.ai/?chain=sol .
3. Confirm the Tango master switch, paper balance and clearly marked paper controls. Never click GMGN's real trading controls.
4. Select a token with available public quotes; paper-buy a small amount, then use 25% and 100% paper-sell. Confirm fills and sounds; no real funds move. A pending operation must settle before the next independent action.
5. Repeat on BSC; switching chains keeps separate accounts. Existing data must not be reset for ordinary testing.
6. Open View trades after closing; inspect points/ledger and explanatory labels. Missing chart/candle data can legitimately limit plotted points.
7. Open the dashboard in standard Chrome. Check tabs, search, calendar daily reports, PNG/CSV/JSON export. Do not import/reset a user's account.
8. Review the labeled optional referral action and the ordinary link, packaged privacy page and support URL. No background referral-code replacement occurs.
9. Toggle sounds and the master switch. Verify visual confirmations still work when browser audio is blocked.

Embedded Codex/Owl can block extension-created internal tabs; that is a browser restriction and standard Chrome should be used for store review. No automated test proves Google policy approval.

## Assets and publisher tasks

- Packaged icons: assets/icons/icon-16.png, icon-32.png, icon-48.png, icon-128.png.
- Audio: GMGN Handgun / Kaching requested at runtime; synthesized local fallback. The publisher states there is no authorization issue; no independent license verification is claimed. See assets/NOTICE.txt and privacy policy.
- Store promo: promo-440x280.png in this directory (outside the uploaded extension ZIP).
- Actual feature screenshots: screenshot-01 through screenshot-05 in this directory, JPEG 1280x800; captured from GMGN with Tango 0.3.38. Trading and replay interfaces are unchanged in 0.3.39. Original captures are retained separately; only empty browser-output margins were removed and dimensions normalized.
- ZIP must contain manifest.json directly at root, not an extra wrapper directory.
- Register/verify publisher account and contact information; select distribution and accurate content rating; accept applicable agreements personally.
- User/developer must submit for review. This preparation does not submit, register, pay a fee or accept agreements.