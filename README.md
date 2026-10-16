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

The extension popup also shows the browser's dashboard-opening failure reason. If the same package opens consistently in Chrome but the embedded browser reports `Owl extension-created tab was blocked before presentation`, the request reached the browser and the embedded browser rejected presenting the extension tab. Reinstalling Tango does not address that rejection and can lose local paper data. Keep the existing installation and export a JSON backup before changing browsers or installation paths. No alternate tab-opening route is attempted after a browser rejection.

Chart lines require trustworthy visible chart coordinates. Synthetic fallback market caps do not produce chart coordinates; independently observed prices or market caps remain eligible. Current GMGN compatibility still depends on the site's current layout and data availability.

## Safety

Every trade is simulated. The extension has no wallet connection, signature, approval, swap, transaction broadcast, RPC broadcast, or real funds capability. It never requests seed phrases or private keys, and it does not submit blockchain transactions.

For manual checks, click only controls labeled **Tango** and **Paper**. Never click GMGN's real buy, sell, wallet, approval, or signing UI.

## Trade replay (0.3.15)

The Popup, Dashboard, GMGN overlay, and share cards use Tango's dark/green visual theme while retaining light/system themes. Trading semantics, fee calculations, shortcuts, and existing entry/exit horizontal lines are unchanged.

History has a **View trades / 查看买卖记录** action on both BUY and SELL rows. Token-detail paper panels have **View trades · chart / 查看买卖记录 · 走势图**, including after a position is closed. Each opens a read-only replay for that exact chain and token from retained fills. Select a B/S marker or a row to inspect time, quantity, amount and realized sell PnL. Details are paginated (50 per page); charts plot at most the latest 500 fills.

The replay passively reuses explicit-USD GMGN market-cap candle responses on compatible routes and samples verified current-token USD quotes no more than once per 30 seconds. It does not request additional market-data endpoints. Historical candles require a known token identity and explicit USD unit. When candles are unavailable, recorded quote intervals form a line chart; gaps greater than two minutes remain disconnected. Price markers show recorded execution prices (including slippage); market-cap markers show the observed market cap at execution. Fills missing trustworthy coordinates remain in the ledger with an explicit chart notice. Without candles, a dashed fill-to-fill line connects recorded values by execution time and is explicitly labeled as non-market data. This line is not a candlestick history or an estimate of the intervening market. Switch between recorded USD market cap and execution price; disagreement with recorded supply is flagged without altering account PnL.

Market history is a separate bounded, disposable browser-local cache (at most 8 series, 600 points per series, under 450,000 JSON characters), never an input to order execution or account valuation. It is not part of account JSON backups; restored account fills remain viewable even without the market cache. Candles that were not observed or were evicted cannot be recovered offline. The module does not alter balances, positions, trades, fees or ledger statistics.

When an embedded browser silently suppresses the page recovery JSON download, the recovery dialog also displays a read-only canonical JSON backup for manual copying. Exporting does not import or reset the account.

## Quote consistency (0.3.16)

Paper order preparation and final execution reject a fresh factual price/market-cap pair when it disagrees with the highest-trust exact token supply by more than 2% (rounding tolerance). A position’s existing exact supply remains authoritative when a new quote omits supply. Stale optional market cap does not invalidate a fresh price-only quote. Existing account records are not rewritten; replay flags historical disagreements.


## Quick trading quote synchronization (0.3.17)

- Distinct quick-buy clicks after settlement are accepted immediately; in-flight duplicate activation remains blocked.
- Switching to another held token no longer inherits the previous token's quote-persistence throttle.
- Sell execution resolves the latest accepted same-token observation rather than pinning the preview price.
- A verified current detail quote that fails consistency validation blocks execution; it cannot silently execute an older preview instead.
- Existing trades and holdings are not rewritten. Paper-only controls, provisional quote behavior and confirmation settings remain available.


## Trench click follow-up (0.3.18)

- Remove the remaining adapter-level 900 ms post-settlement cooldown; in-flight operations and trusted-event deduplication remain enforced.
- Record a read-only DOM diagnostic for trusted paper-button activation: Guard dispatched the callback or blocked an invalid binding. The diagnostic never authorizes execution.
- Cover detail-to-trench same-card rebinding and single-click address-resolution regression cases.


## Route and quote follow-up (0.3.19)

- Keep same-token GMGN card links stable when Pump.fun icons arrive late; a changed binding is renewed and old callbacks stay invalid.
- Retry the detail header read when its native identity/price section arrives, rather than waiting for the three-second periodic tick. Verified detail pages retain their existing polling cadence.
- Normal and breakeven sell previews consult the verified current header before rejecting cached quotes. Entry placeholders use the adapter's bounded local DOM read, with route checks before updating or executing.
- Fresh contradictory observations still block execution; no historical fills, holdings or balances are automatically rewritten.

## Live detail mark follow-up (0.3.20)

- Coalesced detail-header mutations refresh verified price and market cap without waiting for the three-second metadata probe or rescanning cards.
- Startup and missing-chart quotes retain the held position mark instead of displaying a fresh synthetic estimate or zero market cap.
- No chart is required for verified GMGN DOM/network pricing. Trade-time identity, freshness and price/supply coherence checks remain in force.

## Detail network replay quote protection (0.3.21)

- Prefer the independently verified live detail header over delayed network replay prices for the active token. During a header replacement, retain only the existing fresh DOM observation without renewing its timestamp; stale or missing DOM quotes still permit network fallback.
- Reject a contradictory price/cap pair from the same observation when its launchpad supply is already verified, while preserving the existing handling of independently timed fields. Historical fills and balances are not rewritten.

## Trench card valuations and position badges (0.3.22)

- Verified launchpad cards use their own fresh market cap and known supply for quick buys, rather than combining that cap with a cached network price. Conflicting exact supply evidence retains the previous safety rules.
- Held cards show their current paper position value in the chain native asset beside the token name, with a more precise hover value. Labels update after account changes and held-card market-cap changes, disappear after closing/disable/navigation, and do not write to account state or participate in trade controls.
- Badge refreshes inspect tracked cards, skip unheld quote parsing, and coalesce held-card quote mutations without rebuilding quick-buy controls.
