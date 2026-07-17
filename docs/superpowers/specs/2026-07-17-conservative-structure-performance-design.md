# Conservative Structure and Performance Optimization Design

## Goal

Improve maintainability and remove deterministic wasted work without changing any user-visible behavior, trading result, persisted data, message contract, request fallback, or GMGN integration timing.

## Baseline

- `npm test`: 38 tests pass.
- `npm run check`: manifest version `0.2.17` is valid and all 13 referenced files exist.
- `npm run build`: produces the unpacked extension successfully.
- The worktree was clean before this design document was added.

The strongest existing regression protection covers the trading engine, storage notifications, and GMGN token identity parsing. Browser-side content orchestration, chart messaging, and background request concurrency have little or no automated coverage, so the first implementation must add characterization tests before changing those paths.

## Scope

The first optimization pass changes only four areas:

1. Extract chart-marker construction from `src/content/content.js` into a small, dependency-free content helper.
2. Skip chart payload construction when no target chart iframe exists and reuse already-computed portfolio data during rendering.
3. Coalesce identical in-flight background quote requests and remove only already-expired token cache entries.
4. Strengthen development validation for version consistency, content-script dependency order, and JavaScript syntax.

The implementation will not change:

- GMGN token identity detection, detail-scope verification, quick-buy injection, or original-button restoration.
- MutationObserver behavior, route polling, timer frequencies, chart scale fitting, or marker placement.
- Trading formulas, quote freshness windows, cache freshness windows, quote-source priority, fallbacks, storage schema, or import/export formats.
- HTML, CSS, translations, visible copy, message names, message payloads, permissions, or supported routes.
- The dependency-free build model.

## Architecture

### Chart marker helper

Create `src/content/markers.js` as an IIFE that attaches `Tango.Markers` and also exports the same API through CommonJS for Node tests. It will contain a pure `buildPayload` function.

`buildPayload` receives the current token/quote, current position, trade list, and already-translated labels. It returns the existing payload shape:

```js
{
  tokenAddress,
  currentPrice,
  currentMarketCap,
  markers
}
```

The function will preserve these rules exactly:

- A trade matches only when both chain and lower-cased token address match and `marketCapUsd > 0`.
- The position's `averageEntryMarketCap` takes precedence over the first matching BUY trade.
- At most the first four matching SELL trades are emitted, in current trade-array order.
- Recorded prices take precedence; otherwise price is derived from the current price/market-cap ratio.
- Marker IDs, sides, market caps, prices, and translated labels remain byte-for-byte equivalent for the same inputs.

`manifest.json` will load `src/content/markers.js` immediately before `src/content/content.js` in the existing isolated-world content-script list.

### Content orchestration

`syncChartMarkers()` will query chart frames before constructing a payload. When the query returns no frames it will return immediately. The existing one-second timer, mutation-triggered synchronization, READY handling, JSON signature comparison, WeakMap cache, and `postMessage` payload remain unchanged.

`render()` will compute `Tango.Engine.portfolioSummary(runtime.state)` once and pass it into `renderDrawer(summary)`. The generated markup will remain unchanged.

No other content-script responsibilities will be split in this pass. In particular, quote coordination, confirmation flow, trading commands, drag handling, and lifecycle timers remain in `content.js` to avoid changing closure state or asynchronous ordering.

### Background request coalescing

`src/background.js` will add:

- One in-flight Promise slot for the SOL price request.
- An in-flight Promise map keyed by lower-cased token address.
- Lazy deletion of token cache entries whose existing 15-second freshness period has expired.

Fresh cache checks still happen first. When a fresh cache value is absent, concurrent callers for the same resource receive the same Promise. The in-flight entry is removed in `finally`, for both success and failure, so later calls can retry exactly as they can today.

CoinGecko, Wrapped SOL fallback, DEX Screener filtering, highest-liquidity pair selection, response shapes, and thrown errors remain unchanged. Expired entries are currently unusable; removing only those entries changes memory retention, not returned values.

### Validation

Refactor `scripts/validate-extension.js` into callable validation functions while preserving its CLI output and exit behavior. Validation will additionally assert:

- `package.json`, `manifest.json`, and `Tango.VERSION` contain the same version.
- The isolated-world content scripts retain the required dependency order, including `markers.js` before `content.js`.
- Every source, test, and script JavaScript file parses successfully under the current Node runtime.

Validation remains a development-time check and does not run in the extension.

## Error Handling and Compatibility

- All concurrent callers observe the same background request success or failure.
- Failed in-flight requests are never cached as successful values and never leave a permanent lock.
- Existing message listeners continue returning the same `{ ok, ... }` or `{ ok: false, error }` shapes.
- Chart synchronization silently does nothing when no matching iframe exists, as it effectively does today after constructing an unused payload.
- The helper keeps the project's IIFE/global namespace convention and CommonJS test convention; no ES module or bundler migration is introduced.

## Test Strategy

Implementation follows test-first red/green/refactor cycles.

### Marker characterization tests

Add `tests/markers.test.js` before extracting production code. Tests will lock down:

- Empty/current-token-missing payload behavior.
- Chain and case-insensitive address filtering.
- Position entry precedence over BUY history.
- First matching BUY fallback when there is no position entry market cap.
- At most four SELL markers in existing order.
- Recorded-price precedence and ratio-derived price fallback.
- Exact marker IDs and translated labels.

The tests will initially fail because `src/content/markers.js` does not exist, then pass after the extraction.

### Background concurrency tests

Add `tests/background.test.js` using `vm` with mocked `chrome` and `fetch`. Tests will lock down:

- Concurrent SOL requests perform one CoinGecko fetch.
- Concurrent identical token requests perform one DEX Screener fetch.
- Different token addresses remain independent.
- A rejected request clears its in-flight entry and the next request retries.
- Existing 30-second SOL and 15-second token cache windows remain intact.
- Expired token entries can be removed without changing fresh-cache results.
- Wrapped SOL fallback and highest-liquidity matching-pair selection remain unchanged.

### Validation tests

Add focused tests for the exported validation functions:

- The current repository passes.
- Version mismatch is reported.
- Incorrect content-script ordering is reported.
- Invalid JavaScript is reported.

### Existing regression suite

After each task and at completion, run:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git status --short
```

The full suite must pass, the build must complete, and no tracked build artifact may change.

## Performance Acceptance

The implementation must demonstrate deterministic reductions without relying on timing-sensitive microbenchmarks:

- With zero target chart frames, chart payload construction and trade iteration occur zero times.
- N simultaneous identical SOL requests cause one external fetch.
- N simultaneous requests for the same token address cause one external fetch.
- A render with an open drawer invokes `portfolioSummary` once rather than twice.
- Expired token cache entries do not accumulate across subsequent token requests.

No claim will be made about MutationObserver, chart scale-fitting, or end-to-end browser frame-rate improvements because those paths are intentionally outside this pass.

## Risks and Mitigations

- **Marker ordering drift:** protect the exact payload with golden characterization assertions before extraction.
- **Script-order regression:** add explicit manifest-order validation and build verification.
- **Promise lock after failure:** use `finally` and test a fail-then-retry sequence.
- **Accidental cache-semantics change:** keep existing freshness constants and delete only entries that the current code would already reject.
- **Scope expansion into fragile GMGN logic:** do not edit `src/adapters/gmgn.js`, quick-buy code, identity code, MutationObserver routing, or route timers in this pass.

## Completion Criteria

The pass is complete only when all planned characterization tests, the existing 38 tests, extension validation, and the unpacked build pass; the generated runtime behavior and public contracts remain unchanged; and a final code review finds no unaddressed critical or important issue.
