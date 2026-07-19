# Multichain GMGN Smoke Test

Date: 2026-07-19 (Asia/Shanghai)

Build under test: `dist/tango-paper-trader`, version `0.3.0`.

## Environment

The available Browser surface selected Chrome. Loading `chrome://extensions/` was rejected by the browser security policy, so the unpacked build could not be installed in that browser session. Public GMGN pages remained reachable. The five accessible detail pages had token-specific titles, while the X Layer trench page exposed no X Layer token-detail link during the observation.

No extension-dependent result below is inferred from static tests. A blocked result means the Tango overlay, account header, drawer, and marker behavior could not be exercised in the live page because the build was not loaded.

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
