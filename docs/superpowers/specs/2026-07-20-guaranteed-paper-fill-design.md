# Guaranteed Multichain Paper Fill Design

## Goal

Make every paper-trading entry point behave consistently on all registered GMGN chains. A temporary market-data outage must not be reported as a failed paper buy or sell. Only invalid chain/address/amount, insufficient paper balance, or a missing position may reject an order.

The extension remains paper-only. This design does not add wallet discovery, wallet connection, signatures, approvals, swaps, RPC transaction submission, or any real-funds operation.

## Quote and Fill Policy

All quick buys, detail-panel buys and sells, position-drawer sells, breakeven sells, and close-all orders use one resolver.

The resolver tries, in order:

1. A fresh, exact `chain:normalized-address` GMGN network observation captured from the current page.
2. A short GMGN quote-cache replay wait.
3. A verified DEX Screener quote for chains that have a registry mapping.
4. The latest exact-address GMGN or DEX observation already held in memory.
5. For an existing position, its last exact-address token price and native-asset price.

Fresh observations remain preferred. A last-known observation may be used for paper execution because no real asset is exchanged. Such an execution is revalidated against the exact chain and address, records its original observation time/source, and receives a current paper-execution timestamp so the engine cannot reject it merely for age.

If no positive token price or native-asset price has ever been observed, the click becomes a route-bound pending paper intent. The UI reports that the simulated order is waiting for a quote and retries while the user remains on the same GMGN route. It does not report a failed trade or require another click. Navigation invalidates the pending intent so a delayed response cannot trade a different token or chain. When confirmation is enabled, a resolved pending intent opens the normal confirmation instead of bypassing it.

## GMGN Observation Cache

Both the MAIN-world response tap and the isolated content runtime store observations under an exact `chain:normalized-address` key.

Successive response fragments merge monotonically:

- A positive newer price, market cap, or liquidity may replace the corresponding previous value.
- An absent or zero field never erases a previous positive value.
- A non-empty symbol, name, or logo may replace the corresponding previous metadata.
- An empty metadata field never erases trusted metadata.
- Data from another chain or address can never participate in the merge.

GMGN network metadata is preferred over trench DOM metadata when it is bound to the exact chain and address. Position metadata updates accept only verified, exact-address GMGN observations. This prevents a recycled card DOM node or an incomplete payload from assigning another token's name or image.

## Native-Asset Price Handling

Each chain keeps both a fresh native/USD observation and its latest positive observation. Execution first refreshes a stale value through the background provider. If refresh fails, a last-known exact-chain value may be used for a paper fill and is marked as a paper fallback.

This removes the current detail-panel failure where a valid token quote exists but the native/USD cache is just over the freshness threshold. It also keeps balances and valuations chain-local.

## Dashboard Navigation

The inline PnL calendar adds a current-chain trade-history button. It opens:

`dashboard.html?chain=<registered-chain>#history`

The background validates both the tab and chain before constructing the extension URL. Dashboard startup honors the explicit chain before rendering and persists the selection through the existing settings coordinator. History remains filtered to that chain and starts without an unintended date filter.

The existing calendar button also carries the current chain.

## Error and Safety Boundaries

Paper execution may reject only:

- Unsupported chain or invalid chain-specific address.
- Invalid amount or percentage.
- Insufficient paper balance.
- Missing position for a sell.
- Invalid local state/settings.

Network unavailability, stale observations, and temporary native-price failures produce either a last-known paper fill or a pending paper intent, not a failed trade message.

No code path may call a GMGN swap endpoint, connect a wallet, request a signature, request token approval, or submit an on-chain transaction.

## Verification

Tests cover:

- Cache fragments preserving price and metadata for the same exact identity.
- Same-address observations remaining independent across EVM chains.
- Quick buy using GMGN replay before DEX and using a last-known paper fallback when refresh fails.
- Detail buy/sell and drawer sell sharing the resolver.
- Position fallback fills for stale token and native prices.
- Pending intents never crossing a route change.
- Close-all resolving every current-chain position independently without touching another chain.
- Network metadata correcting a position only at the exact chain/address.
- Calendar history links carrying a validated current chain into Dashboard.
- Static checks proving that no wallet, signing, approval, swap, or transaction-submission capability was introduced.
