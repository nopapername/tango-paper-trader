# Tango Paper Trader

Tango Paper Trader is a bilingual, local-first Chrome extension for paper trading tokens directly on GMGN across Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer.

## Features

- GMGN token-detail trading overlay for all six registered chains
- An independent native-asset paper account for each chain: SOL on Solana, ETH on Ethereum, ETH on Base, BNB on BNB Chain, ETH on Robinhood Chain, and OKB on X Layer
- First-run onboarding lets the user choose language and one common paper-capital amount, defaulting to 10
- All six independent chain accounts receive that chosen numeric amount in their own native asset; the amount is shared numerically, not converted into a shared USD balance
- First install opens the onboarding dashboard once; extension updates do not reopen onboarding
- Master enable/disable switch that removes all GMGN overlays and quick-buy replacements
- Alt+Shift+Y toggles paper trading; GMGN pages include a trusted-key fallback for embedded browsers. The previous Alt+Shift+P binding is retired.
- Trading and chain-scoped portfolio operations are current-chain-only: balance, PnL, positions, history, calendar, CSV export, and close actions stay on the selected chain
- Only the active chain supplies the balance, positions, history, and header asset; chain changes do not merge portfolios or show another chain's native asset as the active balance
- JSON import and export form a full six-chain backup
- Changing common capital requires explicit confirmation and atomically resets every chain: balances, positions, trades, PnL/analytics, and calibrations are cleared while preserving other settings
- Buy presets and network fee are per-chain; common capital is shared across all six independent chain accounts
- Sell presets, slippage, platform fee, confirmation, fast mode, sound, language, theme, enabled state, and selected chain are global
- A read-only all-chain USD asset and paper-PnL summary in the Popup and Dashboard; it reports incomplete native-price coverage rather than enabling cross-chain actions
- Always-visible current-chain paper balance and PnL bar
- Quick buy presets and percentage sells
- Independent Tango overlay buttons in compatible GMGN trench quick-buy slots (no buttons in token headers, monitoring feeds, favorites, or alert tips)
- Market-cap-first trench execution with GMGN page-response price reuse and a DEX Screener fallback only when the chain registry has an explicit mapping
- GMGN live data takes precedence over K-line and market-cap-derived values. If no usable quote exists, the deterministic fallback opens at $3,200 market cap with a provisional 1B supply divisor; a later verified live mark upgrades valuation without rewriting the recorded paper fill
- TradingView entry/exit lines synchronized to the visible price or market-cap Y axis where GMGN exposes a compatible chart
- Optional buy/sell confirmation sounds and prominent fill notifications
- Weighted cost basis, realized/unrealized PnL and entry/exit market cap
- Cross-page position drawer and enlarged draggable PnL bar
- Dashboard, trade history and monthly PnL calendar
- CSV/JSON export, JSON restore and PNG result cards
- History pagination covers all retained trades; CSV exports all retained trades on the selected chain with 29 execution/provenance columns
- Monthly PnL uses persistent daily totals; trade counts, win rates and best/worst results describe retained history
- USD summaries refresh each chain independently every 30 seconds and exclude prices older than 60 seconds; manual refresh is available
- Dark, light and system themes apply to the Popup, Dashboard and GMGN overlay
- English and Simplified Chinese
- No wallet, activation code, account or real transactions

## Installation

This repository contains the ready-to-load extension package. No Node.js installation or build step is required.

1. Download and extract the repository ZIP, or clone this repository.
2. Open the browser's extensions manager and enable **Developer mode**.
3. Choose **Load unpacked** and select the repository root folder containing `manifest.json` directly.
4. Open GMGN, or refresh an existing GMGN tab.

There is no `dist` or nested package wrapper. The local installation folder is `D:\web3\code_project\tango-paper-trader`, with `manifest.json` directly inside it.

Before changing an existing extension's installation path, export its JSON backup from the data dashboard. A different unpacked-extension path may use a separate extension identity and storage; import the backup into the newly loaded extension when needed.

## GMGN compatibility

Paper quick-buy buttons follow GMGN's configured button size. On dual-button cards, the secondary amount stays independent of the primary column input. Explicit zero or invalid amounts disable the corresponding paper action.

The current chart quote selector is respected when switching USD and the chain native asset. Native-denominated header prices are never treated as USD execution prices; verified USD market cap and supply may supply the USD valuation instead.

If an embedded browser blocks the data dashboard tab, the error dialog shows the browser reason and provides local JSON export and import. Import previews the selected file and requires confirmation before replacing all six-chain paper data and settings. Export a backup before restoring.

Chart lines require trustworthy visible chart coordinates. Synthetic fallback market caps do not produce chart coordinates; independently observed prices or market caps remain eligible. Current GMGN compatibility still depends on the site's current layout and data availability.

## Safety

Every trade is simulated. The extension has no wallet connection, signature, approval, swap, transaction broadcast, RPC broadcast, or real funds capability. It never requests seed phrases or private keys, and it does not submit blockchain transactions.

For manual checks, click only controls labeled **Tango** and **Paper**. Never click GMGN's real buy, sell, wallet, approval, or signing UI.
