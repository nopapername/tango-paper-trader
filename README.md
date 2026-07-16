# Tango Paper Trader

Tango Paper Trader is a bilingual, local-first Chrome extension for paper trading Solana meme tokens directly on GMGN.

## Features

- GMGN token-page trading overlay
- First-run language and paper balance setup inside the extension popup
- Master enable/disable switch that removes all GMGN overlays and quick-buy replacements
- Always-visible paper balance and PnL bar
- Quick buy presets and percentage sells
- Independent Tango overlay buttons in GMGN Solana trench quick-buy slots (no buttons in token headers, monitoring feeds, favorites, or alert tips)
- Market-cap-first trench execution with GMGN page-response price reuse and DEX Screener fallback
- TradingView entry/exit lines synchronized to the visible price or market-cap Y axis
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
