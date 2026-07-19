# Tango Paper Trader

Tango Paper Trader is a bilingual, local-first Chrome extension for paper trading tokens directly on GMGN across Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer.

## Features

- GMGN token-detail trading overlay for all six registered chains
- An independent native-asset paper account for each chain: SOL on Solana, ETH on Ethereum, ETH on Base, BNB on BNB Chain, ETH on Robinhood Chain, and OKB on X Layer
- Each new chain account is initialized exactly once with 10 units of that chain's native asset; migrations preserve the existing Solana account and initialize only previously absent chain accounts
- First-run setup selects the language; each chain starts with 10 native units, and principal can be changed later through a selected-chain reset
- Master enable/disable switch that removes all GMGN overlays and quick-buy replacements
- Trading and chain-scoped portfolio operations are current-chain-only: balance, PnL, positions, history, calendar, CSV export, and close actions stay on the selected chain
- JSON import and export form a full six-chain backup
- The all-chain reset is explicit and permanent, while the selected-chain reset preserves every other chain
- Buy presets, network fee, and reset principal are per-chain
- Sell presets, slippage, platform fee, confirmation, fast mode, sound, language, theme, enabled state, and selected chain are global
- A read-only all-chain USD asset and paper-PnL summary in the Popup and Dashboard; it reports incomplete native-price coverage rather than enabling cross-chain actions
- Always-visible current-chain paper balance and PnL bar
- Quick buy presets and percentage sells
- Independent Tango overlay buttons in compatible GMGN trench quick-buy slots (no buttons in token headers, monitoring feeds, favorites, or alert tips)
- Market-cap-first trench execution with GMGN page-response price reuse and a DEX Screener fallback only when the chain registry has an explicit mapping
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

Every trade is simulated. The extension never requests seed phrases or private keys and never submits blockchain transactions.
