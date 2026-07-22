# Tango Paper Trader

Tango Paper Trader is a bilingual, local-first Chrome extension for paper trading tokens directly on GMGN across Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer.

## Features

- GMGN token-detail trading overlay for all six registered chains
- An independent native-asset paper account for each chain: SOL on Solana, ETH on Ethereum, ETH on Base, BNB on BNB Chain, ETH on Robinhood Chain, and OKB on X Layer
- Each new chain account is initialized exactly once with 10 units of that chain's native asset; migrations preserve the existing Solana account and initialize only previously absent chain accounts
- First-run setup selects the language; each chain starts with 10 native units, and principal can be changed later through a selected-chain reset
- First install opens the onboarding dashboard once; extension updates do not reopen onboarding
- Each account begins with the same numeric native capital: 10 native units on each of the six independent chains (the units are native assets, not a shared USD balance)
- Master enable/disable switch that removes all GMGN overlays and quick-buy replacements
- Trading and chain-scoped portfolio operations are current-chain-only: balance, PnL, positions, history, calendar, CSV export, and close actions stay on the selected chain
- Only the active chain supplies the balance, positions, history, and header asset; chain changes do not merge portfolios or show another chain's native asset as the active balance
- JSON import and export form a full six-chain backup
- The all-chain reset is explicit and permanent, while the selected-chain reset preserves every other chain
- The all-chain reset requires confirmation and resets every chain; use the selected-chain reset when only one paper account should be reinitialized
- Buy presets, network fee, and reset principal are per-chain
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
- English and Simplified Chinese
- No wallet, activation code, account or real transactions

## Development

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
```

Load `dist/tango-paper-trader` from `chrome://extensions` using **Load unpacked**.

## Safety

Every trade is simulated. The extension has no wallet connection, signature, approval, swap, transaction broadcast, RPC broadcast, or real funds capability. It never requests seed phrases or private keys, and it does not submit blockchain transactions.

For manual checks, click only controls labeled **Tango** and **Paper**. Never click GMGN's real buy, sell, wallet, approval, or signing UI.
