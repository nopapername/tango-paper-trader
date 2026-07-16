# Tango Paper Trader

Tango Paper Trader is a bilingual, local-first Chrome extension for paper trading Solana meme tokens directly on GMGN.

## Features

- GMGN token-page trading overlay
- Always-visible paper balance and PnL bar
- Quick buy presets and percentage sells
- Weighted cost basis, realized/unrealized PnL and entry/exit market cap
- Cross-page position drawer
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
