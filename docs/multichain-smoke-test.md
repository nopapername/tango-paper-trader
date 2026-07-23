# Multichain GMGN Smoke Test

Date: 2026-07-19 (Asia/Shanghai)

Build under test: `dist/tango-paper-trader`, version `0.3.0`.

## Environment

The available Browser surface selected Chrome. Loading `chrome://extensions/` was rejected by the browser security policy, so the unpacked build could not be installed in that browser session. Public GMGN pages remained reachable. The five accessible detail pages had token-specific titles, while the X Layer trench page exposed no X Layer token-detail link during the observation.

No extension-dependent result below is inferred from static tests. A blocked result means the Tango overlay, account header, drawer, and marker behavior could not be exercised in the live page because the build was not loaded.

## Paper-only manual release checklist

Load unpacked from `dist/tango-paper-trader` in `chrome://extensions`. On a first install, confirm that onboarding opens once, lets the user choose language and one common paper-capital amount, and defaults that amount to 10; on an extension update, confirm that onboarding does not reopen. Complete a separate first-install check with a non-default common capital of 12.5 and confirm all six chains receive 12.5 in their own native asset. Confirm balances, positions, history, and the header asset remain active-chain-only.

On compatible GMGN trench views, confirm that the four GMGN sizes in each of the two trench columns are replaced only by Tango Paper controls. Scroll a virtual-scroll trench list away and back: virtual-scroll preserves one correctly sized Tango control with its current amount on the current live card, without stale controls or duplicated actions. A Tango quick buy must work without a chart or detail page; it uses the click-time card data, and when no market data is available it uses the documented large fallback quantity rather than waiting for a quote.

Use a Tango Paper detail control to buy, then sell 25% or 50%; confirm that a 100% sell closes the exact remaining quantity, including fractional quantities. Confirm that GMGN live data has precedence over a K-line or market-cap-derived value; a provisional fallback can be replaced by a live mark upgrade without changing the historical fill. For a quote-less fallback, verify the initial market cap is $3,200 with a provisional 1B divisor.

Confirm that a committed paper buy or sell sends an immediately visible marker to a compatible chart. A delayed or replaced chart iframe must replay the latest markers after it becomes ready. Disable Tango and confirm it clears markers and paper controls; a delayed or replaced iframe while disabled must receive only an empty marker payload. Confirmed common-capital reset atomically clears every chain's balances, positions, trades, PnL/analytics, and calibrations while preserving other settings.

Safety boundary: click only controls labeled Tango and Paper. Do not click GMGN's real buy, real sell, wallet, approval, or signing UI. Do not connect a wallet, approve a token, sign anything, submit a swap, broadcast a transaction or RPC request, or use real funds.

## GMGN UI resilience and shortcut checks

On one supported trench page, switch GMGN custom button size through small, large, extra-large, and giant. At each size, confirm every visible existing and newly arriving Meme card has exactly one Tango Paper quick-buy control whose outer geometry matches the adjacent GMGN control. Repeat during a page/column switch and after scrolling a virtual list away and back. The intermediate compact and expanded DOM phases must not leave a missing, duplicated, or displaced paper control.

With only test paper balance at risk, activate a Tango control by pointer and keyboard. Confirm one local paper order appears and no GMGN native order, wallet, signature, approval, Swap, or transaction UI opens. Disable all features and confirm native GMGN controls are restored while Tango controls, panels, header assets, and chart lines disappear.

On first-install onboarding, enter `10`, then `12.5`; confirm the allocation note changes immediately and lists the six independent native balances (SOL, ETH, BNB, ETH, ETH, OKB). Complete setup and confirm the verified reset opens `https://gmgn.ai/r/X9cuc5jd?chain=bsc` before the onboarding tab closes. Invalid or failed persistence must not open GMGN.

Press `Alt+Shift+P` with the popup open. Confirm the popup master switch and the current GMGN page turn OFF without refresh; press it again and confirm both turn ON and current-route controls reconstruct without refresh.

On a chart whose right axis is actively redrawing, place a paper marker around `$6.028K` while the visible tick is around `$6.02K`. Confirm the line tracks the current tick scale, stale labels from the previous token/scale are ignored within 1.5 seconds, and the line hides temporarily when fewer than three trustworthy current labels exist.

## Results

| Chain | Detail context | Buy | Partial sell | Close all isolation | Header asset | Drawer isolation | Trench | Chart | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Solana | Pass | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading |
| Ethereum | Pass | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading |
| BNB Chain | Pass | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading |
| Base | Pass | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading |
| Robinhood Chain | Pass | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading | Blocked: browser security policy prevents unpacked extension loading |
| X Layer | Unavailable: GMGN component absent | Unavailable: GMGN component absent | Unavailable: GMGN component absent | Unavailable: GMGN component absent | Unavailable: GMGN component absent | Unavailable: GMGN component absent | Blocked: browser security policy prevents unpacked extension loading | Unavailable: GMGN component absent | Blocked: browser security policy prevents unpacked extension loading |

## Detail-page evidence

- Solana: `https://gmgn.ai/sol/token/CFUMyqfnHXLgLmaBi5NjK5vPc2KES6v3tBVDDgPWpump` — title observed: `Stickbug $2.12K | GMGN.AI | The Fastest Multi-Chain Meme Trading Terminal`.
- Ethereum: `https://gmgn.ai/eth/token/0xab7f6eaafff791c3ef699a3df271fd4d90389044` — title observed: `CELL $14.98K | GMGN.AI | The Fastest Multi-Chain Meme Trading Terminal`.
- BNB Chain: `https://gmgn.ai/bsc/token/0xd96e0f4fcc1662a3739af30614946c09b0cf4444` — title observed: `HAALAND $7.34K | GMGN.AI | The Fastest Multi-Chain Meme Trading Terminal`.
- Base: `https://gmgn.ai/base/token/0x22222bd682745cf032006394750739684e45a5f8` — title observed: `POLLUK $18.70K | GMGN.AI | The Fastest Multi-Chain Meme Trading Terminal`.
- Robinhood Chain: `https://gmgn.ai/robinhood/token/0x0d5285841c1aa81d34ca58771676f549dd48ab26` — title observed: `LMEOW $57.22K | GMGN.AI | The Fastest Multi-Chain Meme Trading Terminal`.
- X Layer: `https://gmgn.ai/?chain=xlayer` loaded with title `XLAYER 战壕 - GMGN.AI | The Fastest Multi-Chain Meme Trading Terminal`, but the rendered page exposed no `gmgn.ai/xlayer/token/0x…` link; no detail URL was invented.

The accessible detail pages each reported zero `.tango-panel` and zero `.tango-bar` elements, consistent with the unpacked extension not being installed. Canvas or iframe presence on the host page was not treated as proof that Tango chart-marker integration passed.
