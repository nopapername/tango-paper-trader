# GMGN Route, Supply, and Detail Resilience Design

## Scope

This change fixes three related runtime gaps in the multichain paper-trading content script:

1. A chain selected inside GMGN must become the extension's global selected chain.
2. A quick-buy position must show its latest quantity immediately on the token detail page, including an immediate neutral correction when a stronger exact supply arrives.
3. A valid GMGN token detail route must keep the Tango paper panel visible even when the token has no chart, price, market cap, or complete metadata yet.

The extension remains paper-only. No implementation may connect a wallet, request a signature or approval, construct a swap, invoke a GMGN execution endpoint, submit an RPC transaction, or broadcast anything on-chain.

## Approved Chain Authority

While a supported GMGN page is open, its active route chain is authoritative. On startup and every supported SPA route change, the content script compares that route chain with `settings.selectedChain`. If they differ, it patches only `{ selectedChain: routeChain }` through the existing queued settings coordinator.

The content view continues to render directly from the route chain, so account balances and positions switch without waiting for settings persistence. The persisted selection synchronizes the popup and dashboard. Stale settings writes from a previous route may not overwrite the newest route selection.

The URL remains the primary chain signal because GMGN's visible chain selector was verified to update `?chain=` or the first route segment. Existing request-chain binding remains a secondary safety check for quote observations. No DOM label is accepted as a chain identity when the route provides a valid chain.

## Immediate Detail Context

A valid route of the form `/{registered-chain}/token/{valid-address}` is sufficient to create a route-bound placeholder token context. The placeholder contains only the normalized chain/address and a bounded address-derived label. It has no claim of verified metadata or live market data.

The placeholder is created synchronously on startup and after a detail SPA route change, before the asynchronous DOM and quote readers finish. GMGN DOM/network observations may enrich the placeholder only when their normalized chain/address matches. A stale reader result from an earlier route is discarded by the existing route epoch.

The Tango panel therefore renders without a chart. Paper buys remain immediately executable through the existing provisional 1 USD policy, and sells may use the bound position observation. The UI must not label provisional values as live market data.

## Supply and Quantity Policy

Supply resolution keeps the already-approved priority:

1. Exact GMGN `total_supply`/detail total supply for the exact chain/address.
2. A same-observation `marketCapUsd / priceUsd` ratio.
3. A verified chain + launchpad + launch-mode rule.
4. No factual supply; use provisional paper pricing instead of guessing.

The verified fallback registry remains unchanged unless exact evidence contradicts it:

- Solana Pump.fun standard: 1 billion.
- Solana Pump.fun Mayhem: 2 billion.
- Base/Robinhood Bankr and Clanker: 100 billion.
- BNB Chain Four.meme and Flap: 1 billion.
- Base Zora/Zora Coins: 1 billion.
- X Layer DYOR and Bow/Bow.fun: 1 billion.

Unknown launchpads receive no invented supply. Exact GMGN data always wins over the registry.

After quick buy, the locally committed position is rendered immediately. When a stronger exact supply or otherwise calibration-relevant observation arrives for that position, the content script bypasses the ordinary ten-second mark-write throttle and calls the existing engine calibration immediately. Ordinary same-quality price marks remain throttled to avoid unnecessary storage writes.

The bypass is identity-bound and strength-aware: it applies only to the current chain/address and only when the observation can improve calibration or supply provenance. It may change remaining quantity and unit basis, but must preserve cash, cost basis, realized PnL, trade count, and position equity at the correction boundary.

## Error and Race Handling

- A failed `selectedChain` persistence does not hide or roll back the already-correct route-chain UI. A later route observation retries synchronization.
- A delayed settings write or token read must re-check the route epoch and active chain before mutating runtime state.
- A quote from another chain/address cannot create, enrich, or calibrate the current detail context.
- A trench route never creates a placeholder token context.
- An invalid token address never creates a panel.
- Background market-data failures do not block or undo a paper fill.

## Verification

Tests must prove:

- Startup and SPA chain changes patch only the newest route chain into `selectedChain` while rendering that chain immediately.
- A stale chain-sync completion cannot restore an earlier selected chain.
- Every registered chain creates a placeholder detail context without DOM, price, market cap, or K line.
- Cross-chain observations and trench routes do not create a detail context.
- Exact supply arrival immediately calls position calibration even inside the normal ten-second quote-write window.
- Same-quality ordinary quote ticks remain throttled.
- Current supply rules and exact/ratio/rule priority remain unchanged.
- All immediate paper entry points remain network-independent and no real-funds capability is introduced.

