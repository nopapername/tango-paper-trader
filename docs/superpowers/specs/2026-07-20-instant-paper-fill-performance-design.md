# Instant Multichain Paper Fill and Performance Design

## Status and Scope

This design supersedes the pending-intent behavior in `2026-07-20-guaranteed-paper-fill-design.md`. Every registered GMGN chain keeps the same independent paper-trading feature set, but quote absence can no longer put an order into a waiting state. Quick buys, detail-panel buys and sells, position-drawer sells, breakeven sells, and close-all position sells must either commit immediately from local paper data or reject for a genuine local validation error.

The extension remains paper-only. It must not discover or connect a wallet, request a signature or approval, construct a swap, call a trade-execution endpoint, submit an RPC transaction, or broadcast anything on-chain.

## Product Invariants

- The GMGN route selects one active chain. Cash, positions, history, PnL, the position drawer, and the upper-right account summary show only that chain.
- `chain:normalized-address` is the identity key for quotes, metadata, positions, requests, and corrections.
- A paper order never waits for a network response, retry timer, or quote poll after the user confirms it.
- Missing or stale market data cannot by itself make a valid paper order fail.
- A quote or metadata fragment from another chain or address can never participate in a fill or position update.
- A provisional quote or supply correction cannot create artificial profit or loss.

## Approved Architecture

### Instant execution layer

All paper-trading entry points call one synchronous local quote resolver and one engine execution contract. The click path may read in-memory observations, calculate the order, mutate the local state draft, persist it, and render the result. It may not await GMGN, DEX Screener, CoinGecko, a polling loop, or an intentional delay.

The current route-bound pending-paper-intent queue and its three-second retry path are removed from order execution. Background refresh may still run, but it cannot own, postpone, repeat, or cancel an already committed paper order.

### Unified observation store

The observation store merges price, market cap, total supply, native-asset price, symbol, name, logo, launchpad, source, and timestamps under exact identities. Empty or zero fragments never erase a positive trusted field. Older responses cannot overwrite newer observations.

Each field carries provenance rather than assigning one source to the entire token object. This permits a GMGN WebSocket-backed DOM price, a REST-supplied total supply, and a GMGN metadata logo to coexist without lowering the quality of the stronger fields.

### Supply resolver

The supply resolver has one responsibility: return a positive supply with a confidence/source classification, or return no supply. Its priority is:

1. Exact `totalSupply` from the current GMGN token object or detail surface.
2. `marketCapUsd / priceUsd` from the same observation window, after consistency checks.
3. A verified chain + launchpad + launch mode registry rule.
4. No supply result; the order uses the provisional quote policy instead of inventing a supply.

Known registry rules include Pump.fun standard at 1 billion, Pump.fun Mayhem at 2 billion, Four.meme at 1 billion, Flap at 1 billion, Zora Coins at 1 billion, DYOR at 1 billion, and Bankr/Clanker at 100 billion. These are fallbacks, not overrides. Exact GMGN data always wins, and launchpad-specific modes must not be collapsed into one address-suffix rule.

### Background market-data layer

GMGN observations refresh asynchronously when a route appears, a trench card enters or changes, or a paper order completes. Requests are deduplicated by identity, older route epochs are cancelled, and an observation update redraws only affected UI.

DEX Screener remains an optional registered fallback. It does not delay a click and it cannot override a newer, exact-address GMGN observation.

### Neutral calibration layer

A position created from a provisional price, provisional native price, or fallback supply is marked as requiring calibration. The first stronger observation changes its valuation basis without changing its economic result at the correction boundary.

For a remaining position, calibration preserves:

- cost basis in the chain's native asset;
- realized PnL;
- cash balance;
- the number and side of user trades;
- current native-denominated position equity immediately before/at the correction boundary.

Quantity and unit entry price may change. In the general case, the calibrated quantity is chosen so the new trustworthy price produces the preserved native equity. A supply-only correction is equivalent to scaling quantity by the new-to-old supply ratio while keeping cost basis unchanged. After calibration, subsequent market movement produces normal unrealized PnL.

If a user partially sells before calibration, only the remaining quantity and unit basis are calibrated. The completed sell and its realized PnL stay unchanged. A fully closed position is never reopened or retroactively changed.

Calibration is an audit event, not a user trade, and does not increment trade count.

## GMGN Frontend Data Investigation

The investigation was performed read-only against the live GMGN trench and an Ethereum token-detail page on 2026-07-20. No GMGN trade control or wallet action was used.

The live frontend exposed the following useful same-origin data sources:

- `GET /api/v1/major_coin_prices` for native-asset USD prices.
- `/mrwapi/v1/multi_token_full_info` and `/mrwapi/v1/multi_token_info` for batched token observations.
- `GET /api/v1/token_stat/{chain}/{address}` for address-bound token statistics.
- `GET /api/v1/token_mcap_candles/{chain}/{address}` with a one-second resolution option for recent market-cap history.
- `/api/v1/mutil_window_token_info` for window/token context.

The detail DOM exposed the current token price, market cap, pool value, volume, and total supply together. In the observed sample, the displayed market cap and price reconciled with the displayed 100 billion total supply, demonstrating that the detail surface can provide a high-quality same-observation supply fallback.

GMGN also initialized `QuotationSocketMgr`, logged a successful WebSocket open, and maintained an online heartbeat. This confirms that GMGN feeds live quotations through a WebSocket-managed frontend path. The endpoint and wire schema are private and encapsulated by GMGN's worker/runtime, so the extension must not create a duplicate private WebSocket connection as a fill dependency.

The integration policy is therefore:

1. Prefer exact observations already captured from GMGN's same-origin REST responses.
2. Treat the current GMGN DOM as a live local observation surface; GMGN's own WebSocket updates it without the extension coupling to the private protocol.
3. Capture WebSocket messages passively only if a stable, non-invasive page bridge can prove the chain, address, schema, and lifecycle in fixtures. Failure of this optional bridge must be invisible to trading.
4. Never call GMGN wallet, strategy-order, trade-config, quote-for-swap, or execution endpoints.

This policy reuses the freshest available GMGN data while keeping immediate paper execution independent of undocumented transport details.

## Quote and Fill Policy

The local resolver selects token data in this order:

1. Fresh exact-address GMGN observation in memory, including DOM values updated by GMGN's live stream.
2. Same-observation market cap divided by a trusted total supply.
3. Latest positive exact-address GMGN or verified DEX observation.
4. A historical position observation for sells.
5. A nominal `1 USD` provisional token quote.

The native-asset resolver selects:

1. Fresh current-chain value from GMGN `major_coin_prices` or the existing registered provider.
2. Latest positive cached value for the exact native asset/chain configuration.
3. A nominal `1 USD` provisional native quote.

The two nominal values exist only to make paper arithmetic total and are always marked `synthetic` and `provisional`. They must not be labelled as live market prices in the UI. A valid paper order may still be rejected for an unsupported chain, invalid address, invalid amount/percentage, insufficient paper cash, a missing sell position, or a local storage/state failure.

Quote provenance stored with each trade includes the original token and native price, source type, observation timestamp, market cap, supply, supply source, launchpad, and provisional flags. Later calibration is recorded separately, so history remains auditable.

## Click and Refresh Data Flow

1. Page load or chain change immediately restores the selected chain's local account, positions, observations, and settings.
2. GMGN cards, detail headers, and captured same-origin response fragments continuously merge into the local observation store.
3. A click reads one immutable local snapshot and validates the current route, chain, address, and amount.
4. The resolver returns a real, derived, cached, position, or provisional quote without asynchronous work.
5. The engine commits the paper trade and the UI refreshes the affected account, position, history, PnL, and notification.
6. GMGN/DEX/native refreshes continue in the background. They may update marks or produce one neutral calibration, but cannot undo or duplicate the paper trade.
7. Route epochs and observation timestamps prevent late data from a prior chain/token from updating the new route.

## Metadata Integrity

Name, symbol, logo, launchpad, price, market cap, and supply are bound to the same chain/address identity. Exact-address GMGN network metadata is preferred over card text. Empty fragments do not erase trusted metadata, and a recycled trench DOM node cannot update a position until its address binding is reverified.

When a stronger exact-address observation corrects metadata, the active position may update its name or logo. Historical trades retain their execution-time metadata and provenance.

## Performance Design

- The normal target from click/confirmation to visible success is at most about 100 ms on a responsive Chrome session.
- No execution handler contains quote waits, network fetches, polling, or retry timers.
- GMGN REST requests are deduplicated by chain/address; chains sharing a native asset may coalesce native-price work without sharing account state.
- Mutation observers process added/changed card roots in small batches and do not repeatedly rescan the entire document.
- DOM writes are batched and limited to affected components. Route changes invalidate obsolete work.
- Quote parsing and supply inference are pure, bounded operations suitable for unit tests.
- Caches have bounded retention and never use a global EVM-address key without chain identity.

## Error Handling

- Malformed GMGN fields are ignored individually; one bad fragment does not discard the rest of a valid exact-address observation.
- A GMGN layout/API/WebSocket change degrades to the current DOM, cache, historical position data, or the provisional quote.
- Background failures release in-flight locks and may retry later without changing order state.
- A local persistence failure reports an explicit paper-state error and must not show a false success.
- Close-all resolves and commits each current-chain position independently, never touches another chain, and reports genuine local validation failures per position.
- A stale or absent market price is not an error condition for paper execution.

## Safety Boundary

Allowed operations are limited to reading public GMGN/registered market data and writing the extension's local paper ledger and UI. Static and runtime tests must prove the implementation does not add wallet connection, wallet discovery, signature, token approval, swap, transaction construction, RPC submission, or broadcast capabilities.

The integration must not dispatch events to GMGN's real buy/sell controls or reuse GMGN execution handlers. It must not read private keys, seed phrases, or wallet authorization state. GMGN wallet and trading APIs observed during research are explicitly out of scope.

## Verification and Acceptance

Implementation follows test-first red/green/refactor cycles and covers:

- Every registered chain and all paper entry points sharing the same immediate resolver contract.
- Price-only, market-cap-only, cached, position-only, and completely absent market-data cases filling without a waiting message.
- Missing native prices using a provisional fill and calibrating neutrally when a real price arrives.
- Exact GMGN supply, inferred supply, launchpad fallback supplies of 1 billion/2 billion/100 billion, and later exact-supply correction.
- Partial-sell and full-close behavior before calibration.
- Metadata never crossing a chain/address identity.
- GMGN REST response parsing for price, market cap, total supply, launchpad, name, symbol, and logo.
- Optional WebSocket bridge failure having no effect on execution; DOM live observations remaining usable.
- Rapid route/chain changes discarding late observations.
- Current-chain-only positions, account summary, history, calendar, and dashboard navigation.
- Click-path tests proving no network request, quote wait, polling loop, or pending-intent timer executes before commit.
- A measured normal UI feedback target of about 100 ms.
- Static and runtime safety assertions forbidding real-funds capabilities.

Completion verification runs the full test suite, static checks, and production build, then rebuilds the unpacked Chrome extension directory and verifies its files against the build output. Manual smoke tests cover trench quick buy and detail buy/sell on every currently accessible registered chain without clicking any GMGN real-trade control.

## Out of Scope

- Depending on undocumented GMGN WebSocket URLs or message schemas for order execution.
- Reverse-engineering or invoking GMGN trade execution, wallet, copy-trade, or strategy-order APIs.
- Adding any real transaction capability.
- Guessing supplies for unknown launchpads and presenting them as facts.
- Cross-chain combined position lists or cross-chain trading actions.
- Unrelated framework migration or broad UI redesign.
