# GMGN Click-Time Detail Quote Design

## Goal

Make a paper buy or sell submitted from a GMGN token-detail page use the freshest trustworthy quote already visible in the verified detail DOM, while preserving immediate paper execution, no-K-line fallback fills, quick-buy behavior, chain isolation, and the paper-only safety boundary.

## Confirmed Defect

GMGN can update a one-second chart faster than Tango's three-second detail quote poll. The detail trade handlers currently resolve the cached `runtime.current.quote` and only start a background refresh after the order quote has been selected. A quote that is one to three seconds behind the chart is still accepted by the existing fifteen-second freshness policy. Consequently, a sell clicked while the chart shows a higher market cap can execute and plot its SELL marker at the older cached market cap.

The engine's fee, slippage, PnL, and marker calculations are not changed by this design.

## Considered Approaches

### 1. Increase global polling frequency

Reducing the three-second interval could make the cached quote newer, but it repeatedly scans GMGN's changing DOM on every detail page and still leaves a race between the last tick and the click. This risks reintroducing page stalls and does not guarantee click-time correctness.

### 2. Await a GMGN or third-party network quote before every order

This can provide another observation but makes execution depend on network latency and availability. It conflicts with the established behavior that a valid paper order commits immediately and that a no-K-line token remains tradable.

### 3. Read a previously verified detail DOM snapshot at final commit

This is the approved approach. The GMGN adapter exposes a synchronous, read-only snapshot method that succeeds only when the current route, requested token, previously verified DOM-node binding, current detail fingerprint, and trusted chart binding all refer to the same normalized chain and address. It reuses the existing detail quote parser and never dispatches an event to a GMGN control.

If any identity or trust check fails, or the DOM contains no trustworthy positive quote, the method returns no snapshot. The order then follows the existing exact-address cache, position, launchpad, and deterministic fallback policy without waiting.

## Architecture

### Verified snapshot boundary

`src/adapters/gmgn.js` owns the DOM and chart-trust checks. A new synchronous reader accepts an expected token identity and returns a cloned `{ token, quote }` observation only when all of the following hold:

- The page is a GMGN token-detail route.
- The URL chain and normalized address equal the expected token.
- The adapter has previously completed its existing 48 ms double-read verification for that exact route and recorded the verified header, identity, binding, and quote-scope node references.
- The current detail lookup is strongly chain-bound and returns those same connected DOM nodes, not merely the same symbol, name, or logo text.
- The current detail scope still has the same verified identity fingerprint and route key.
- The quote parser can bind its price or market-cap data to the trusted current-route chart.
- The returned observation carries a positive factual price or market cap with GMGN provenance.

The synchronous reader performs no timer, network request, storage write, click, or event dispatch. The existing asynchronous `readCurrentToken()` keeps its double-read behavior and continues to establish the short-lived verified DOM binding during normal polling. Replacing any bound React detail node invalidates the fast path and safely falls back until normal polling verifies the new nodes.

### Final-submit quote selection

`src/content/content.js` adds a small detail-only selector used immediately before `commitBuy` and `commitSell` create the executable order. It:

1. Verifies the captured route epoch is still current.
2. Requests the adapter's synchronous verified snapshot for the order token.
3. Rejects a returned snapshot whose chain or normalized address differs from the order.
4. Gives a valid click-time DOM observation precedence over older in-memory fields for this order only.
5. Uses the existing `resolvePaperTradeQuote` path to supply native price, supply, launchpad, and deterministic fallback fields.
6. Falls back to the order's already captured quote when no verified DOM observation is available.

The selector does not mutate the global polling interval or wait for background quote work. The existing post-selection background refresh remains asynchronous.

### Entry-point behavior

- Detail-panel buy and sell refresh at the final commit, including after a confirmation dialog.
- A confirmation therefore executes at the verified quote visible when the user confirms, not the earlier preview quote.
- Trench quick buy keeps its immutable card click snapshot. Because it is not on a matching token-detail route, it never invokes or depends on the detail snapshot.
- Position-drawer or close-all actions for tokens other than the current detail route retain their existing cached/position behavior.
- A current-token drawer or breakeven sell may benefit from the same final-commit selector only if it reaches the existing `commitSell` path and passes every route identity check.

## Failure and Concurrency Handling

- DOM absence, a missing K-line, an untrusted chart, or an incomplete render is a soft miss. The order immediately uses the existing local resolver and remains tradable.
- A route epoch change before commit aborts through the existing route guard; it must not fall back and execute against a different page.
- A chain/address mismatch from the adapter is ignored as an invalid snapshot and cannot override the captured order identity.
- Existing `tradePending`, confirmation, balance, position, and percentage validation remain authoritative.
- No new observer, polling loop, timeout, request, WebSocket, or cache lifetime is introduced.

## Safety Boundary

The change may only read public text already rendered by GMGN and update Tango's local paper ledger. It must not call, focus, click, clone an event handler from, or dispatch an event to a GMGN native buy/sell control. It must not discover a wallet, connect a wallet, request a signature or approval, construct a swap, call a trade-execution endpoint, or submit an RPC transaction.

## Verification

Test-first coverage must prove:

- A detail sell with a cached `$3.75K` quote and a verified DOM `$4.30K` quote commits and stores `$4.30K`.
- A detail buy follows the same final-submit policy.
- A verified DOM miss commits immediately from the existing cached/fallback quote without awaiting network work.
- A same-chain address change and a cross-chain route change cannot apply a previous page's DOM observation.
- A newer-looking cache timestamp cannot override the verified click-time DOM observation for that one order.
- Confirmation reads the verified quote at confirmation time.
- Trench quick buy never invokes the detail reader and preserves its card click snapshot.
- No-K-line deterministic fallback buys and sells still succeed.
- Existing engine, marker, chain-isolation, quick-buy safety, extension validation, and paper-only static tests remain green.
- The production build regenerates the unpacked Chrome extension directory from the verified source.

## Out of Scope

- Changing fee, slippage, network-fee, PnL, or marker semantics.
- Changing the three-second background quote interval.
- Parsing private GMGN WebSocket messages or depending on undocumented endpoints.
- Reworking trench quick-buy pricing, supply inference, metadata, or button UI.
- Redrawing historical trades from later prices.
- Adding any real-funds capability.
