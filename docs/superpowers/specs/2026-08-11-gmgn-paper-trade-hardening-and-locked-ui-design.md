# GMGN Paper Trading Hardening, Locked Giant Quick-Buy, and Chart Marker Design

**Date:** 2026-08-11
**Status:** Approved
**Scope:** GMGN trench quick-buy presentation and activation, chart marker projection, CSV export safety, and bounded `storage.local` persistence

## Goal

Make the GMGN paper-trading integration predictable and fail-closed:

- every trench replacement quick-buy uses one Tango-owned Giant presentation and never follows GMGN's button-size or presentation settings;
- the existing paper quote, order, position, and marker behavior remains intact for genuine user actions;
- GMGN page scripts cannot manufacture paper-account mutations by replaying public DOM identifiers, `postMessage`, or synthetic DOM events;
- BUY and SELL chart lines use the current chart's actual axis and are rendered only while their factual coordinate is inside the current visible plot;
- CSV export cannot create spreadsheet formulas from imported or page-derived strings;
- persisted state stays safely below Chrome's normal `storage.local` quota without requesting `unlimitedStorage`.

## Non-Negotiable Boundaries

- Never activate, reveal, or forward an event to a GMGN native trading control.
- Do not add wallet, signature, approval, swap, RPC, real-funds, network, or host-permission capabilities.
- Keep chain/token identity validation and iframe READY correlation fail-closed.
- Keep quote selection, paper Engine accounting, balances, positions, order semantics, marker economics, and the two-line quick-buy content unchanged except where this design explicitly tightens an authorization or coordinate boundary.
- A permitted quick-buy activation produces exactly one paper callback and zero native callbacks.
- A page-authored `Event`, `.click()`, public action ID, DOM dataset value, or same-window message is not proof of user intent.
- A chart line is never clamped to the top or bottom. If its factual price or market cap is outside the current visible plot, it is hidden until the value enters that plot.
- If a current trustworthy value-to-pixel mapping is unavailable, hide the line and retry; never invent a coordinate or reuse a known-stale scale.
- Preserve unrelated user files and worktree changes.

## Evidence and Confirmed Causes

### Live GMGN trench DOM

The 2026-08-11 live Solana trench page contained 24 `trench-token-card` roots. A representative card was:

```text
[data-testid="trench-token-card"]
[data-sentry-element="SimulateLinkByConfig"]
[data-sentry-source-file="TokenItem.tsx"]
`-- hover operation host: absolute ... group-hover/a:flex ... pointer-events-none
    `-- [data-sentry-component="BuyButtons"]
        |-- .BuyButton-continer
        |   `-- overflow wrapper
        |       `-- [class~="group/btn"]
        |           `-- [data-testid="quickbuy"]
        `-- a second compatible .BuyButton-continer on most cards
```

The observed native quick-buy leaf was a `div`, not necessarily a semantic `button`. Its computed presentation was 24 px high, 12 px text, 42 px minimum width, 6 px radius, dark background, and green text. It used GMGN `--customize-button*` variables.

The existing TokenItem/card/slot discovery remains compatible with this structure. Live verification did not click any native or paper trading control.

### Quick-buy presentation drift

The adapter currently models Small, Large, Extra large, and Giant profiles and observes connected native class, style, and size changes. It also copies filtered native color, border, radius, outline, shadow, fill, stroke, and a GMGN custom color variable into the Tango replacement. CSS gives the replacement `height: 100%` and `min-height: 0`, so its geometry is still owned by the native slot.

Consequently, the current control is not a locked Tango Giant control. It can change after a GMGN setting mutation, and a 36 px inner profile can still be constrained by a shorter native host.

### Page-authored mutation authority

The GMGN adapter currently treats a same-window message carrying public `actionId` and `bindingNonce` values as authorization to invoke a paper action. Those values are present in the page-readable DOM and are correlation identifiers, not secrets. A GMGN script can replay them.

The main shell uses an open Shadow DOM and its mutation handlers do not consistently require `event.isTrusted`. A page script can therefore obtain exposed controls and invoke synthetic clicks. Main-world quote messages can also flow into later persistent calibration or metadata updates.

### Chart mode and coordinate ambiguity

The live detail page used:

```text
iframe[title="Financial Chart"]
data-widget-options.symbol = sol/<token>/USD/MCAP
data-widget-options.workers.enabled = true
```

The renderer currently learns right-axis anchors by observing Window-realm `CanvasRenderingContext2D.fillText`, `strokeText`, and `clearRect`, then compares both PRICE and MARKET_CAP candidates. It does not consume the explicit `/MCAP` frame metadata. An otherwise similar PRICE and scaled MARKET_CAP candidate can therefore select the wrong economic dimension.

Current code already contains important lifecycle and accuracy protections that this design retains:

- per-iframe-document READY probing and payload replay after a same-node iframe reload;
- factual price, coherent price/market-cap ratio, and trusted execution-supply coordinate recovery;
- protection against parsing `Total Supply` as market cap;
- invalidation after a narrow right-axis clear;
- separation of real economic-coordinate changes from visual jitter suppression;
- token-scoped payload validation and disconnected-canvas rejection.

`workers.enabled: true` is configuration evidence, not proof that price-axis glyphs are drawn in a Dedicated Worker. If they are worker-drawn, a Window prototype hook cannot observe them. This design therefore does not claim that iframe metadata alone supplies a Y coordinate and does not wrap arbitrary third-party Workers. Metadata supplies an axis-type hint only; numeric anchors or a supported coordinate API remain mandatory.

### CSV formulas

CSV quoting and doubled quotes do not prevent Excel or Google Sheets from evaluating a string beginning, after whitespace/control characters, with `=`, `+`, `-`, or `@`.

### Storage quota

Trades and calibrations are independently capped at 10,000 entries, while the entire state is written under one local-storage key without a total byte budget. A representative 10,000-trade plus 10,000-calibration state is approximately 14.17 MB, above Chrome's normal 10 MiB quota.

## Selected Design

### 1. Keep the live slot contract, replace presentation ownership

Discovery continues to require the verified trench route, TokenItem/card identity, token link, and `.BuyButton-continer` slot. The replacement remains at the native leaf's exact position. When no leaf exists, it mounts inside the slot-local `group/btn` host, then falls back to the slot.

The adapter continues to remove and restore native controls through its existing lifecycle and continues to use the existing amount input, quote, action, pending-promotion, and teardown paths.

The replacement presentation becomes entirely Tango-owned:

- one profile only: `giant`, with an exact canonical 36 px replacement height;
- existing Giant two-line typography: 14 px amount and 10 px Paper hint;
- one fixed Tango accent token, translucent surface, radius, focus ring, hover, active, pending, and in-flight styling;
- a minimum 36 px height on the bound slot and slot-local action host so the surface is not clipped;
- exact `height`, `min-height`, and `max-height` of 36 px on the replacement, centered inside a taller host rather than stretched by it;
- full slot width and the existing single paper click owner;
- pointer-inert inner label/amount content;
- unchanged 16% normal and 24% hover surface-opacity policy.

Creation, reconciliation, new cards, leafless cards, restored cards, pending, ready, and in-flight states all write the same Giant dataset and exact 36 px replacement geometry. A native host smaller than 36 px expands enough to contain it; a native host taller than 36 px does not stretch it.

The following native presentation paths are removed or bypassed for Tango controls:

- Small/Large/Extra large/Giant inference;
- per-chain and per-column size-profile promotion;
- native class/style presentation copying and propagation;
- class/style/ResizeObserver reactions whose only purpose is native presentation sync;
- health-probe comparisons between a connected native profile and the Tango profile.

Mutation observation remains for structural discovery, native reinsertion removal, host replacement, token/card lifecycle, and repair. GMGN may change its own classes, inline styles, variables, or size setting without changing Tango presentation or action identity.

This selected design supersedes the presentation-ownership and live-size-sync requirements in these documents:

- `2026-08-04-gmgn-quick-buy-live-size-sync-design.md`;
- `2026-08-04-gmgn-quick-buy-maximum-safe-typography-design.md` where it assigns outer geometry to GMGN;
- `2026-08-04-gmgn-quick-buy-two-line-typography-design.md` where it assigns outer geometry to GMGN.

The current translucent-surface behavior remains authoritative; this work does not revive older 38%/50% paint values.

### 2. Move paper-action authority into the isolated-world guard

GMGN page code, MAIN-world code, DOM attributes, and same-window messages are untrusted inputs.

The document-start isolated-world guard owns opaque action callbacks in a `WeakMap` keyed by the registered replacement/slot identity. Public action IDs and nonces may remain as diagnostics or correlation values during migration, but they never grant authority.

An action may run only when all of these conditions hold:

1. the isolated guard receives a browser-trusted activation (`event.isTrusted === true`);
2. the composed path contains the currently connected registered replacement;
3. the replacement, slot, binding generation, and token identity still match the guard's opaque registration;
4. the action has not already been consumed for that activation sequence;
5. the native sentinel remains blocked.

A trusted `click` covers pointer and browser-generated keyboard activation. Pointer/key bookkeeping may be used for deduplication and target continuity, but must not remove keyboard or assistive activation that the browser exposes as a trusted click.

The MAIN-world safety code may still suppress GMGN native listeners and publish non-authoritative observations, but it no longer emits or consumes a message capable of invoking a paper action. The adapter's mutation-capable same-window listener is removed.

The shell adds a capture-phase trusted-activation gate plus handler-local fail-closed checks for BUY, SELL, position sell, breakeven, close-all, confirmation, preset keyboard actions, and every other user-initiated `storage.local` or `storage.session` mutation. This includes settings, saved presets, layout state, confirmation suppression, and equivalent session flags whose later value can change trading semantics. Programmatic extension-internal initialization and repair call explicit internal functions rather than manufacturing DOM events.

Page-derived quote messages may update an ephemeral display/decision cache, but cannot independently authorize a trade or cause delayed persistent calibration. Persistent automatic quote/calibration updates must come from the existing extension/background channel. A genuine trusted paper action may commit the click-time quote as part of that action's atomic transaction.

### 3. Make chart axis type frame-specific and scale data generation-specific

The canonical marker payload remains token-scoped economic data and does not contain frame-derived presentation state.

Immediately before delivery to one correlated chart frame, the parent reads only that frame's `data-widget-options`, parses it with `URLSearchParams`, applies a strict length limit, and derives one sanitized enum:

```text
MARKET_CAP | PRICE | UNKNOWN
```

An explicit symbol suffix such as `/USD/MCAP` yields `MARKET_CAP`. Unrecognized, malformed, oversized, detached, stale-route, or ambiguous metadata yields `UNKNOWN`; no raw widget configuration crosses the bridge. The hint is bound to the frame load epoch and READY probe and is re-read on delivery/repair.

The hint constrains candidate selection:

- `MARKET_CAP` excludes PRICE candidates;
- `PRICE` excludes MARKET_CAP candidates;
- `UNKNOWN` retains the current scored fallback;
- the hint never changes a marker's factual price, market cap, supply, token, or chain.

Value-to-Y mapping still requires a current authoritative coordinate source. Provider priority is:

1. at least three fresh, unique, monotonic Window Canvas axis anchors passing the existing robust-fit quality checks;
2. a guarded, supported chart coordinate API, but only after its presence and lifecycle are verified on the live GMGN frame without private-object traversal;
3. a route-, frame-generation-, viewport-, and token-bound numeric axis snapshot, but only after a trustworthy live producer is verified;
4. otherwise no scale.

Static iframe bounds or `/MCAP` metadata alone are never treated as numeric anchors. The implementation must not wrap arbitrary Worker constructors, rewrite blob workers, OCR chart pixels, or infer a range from the current token value.

No supported coordinate API or authoritative axis-snapshot producer has yet been confirmed on the live GMGN blob frame. Therefore the committed implementation scope is the verified Window Canvas provider plus explicit axis-type hints, stronger generation invalidation, current plot-bound checks, and bounded diagnostics. A genuinely worker-only price-axis path is a known limitation: without a later verified coordinate source it remains hidden. This is an explicit accuracy tradeoff, not a claimed fallback implementation.

Each accepted scale records:

- axis type and display factor;
- linear/log mode;
- source canvas/API identity;
- frame/load generation and READY correlation;
- viewport dimensions and current plot bounds;
- observation time and numeric anchors;
- fit error and tick spacing.

The scale is invalidated on token change, frame load, axis-hint change, viewport resize, source disconnect, full-canvas clear, qualifying narrow right-axis clear, or a newer incompatible axis generation. A stale scale cannot survive a worker or canvas handoff merely because the DOM canvas node is still connected.

Window Canvas instrumentation also records enough bounded diagnostics to distinguish these fail-closed reasons in tests: no text calls, no numeric labels, too few unique anchors, stale generation, rejected fit, rejected mode, or out of plot. Diagnostics do not contain token history or raw page payloads and are not persisted.

### 4. Render only factual in-plot coordinates

For the selected scale, the renderer chooses the marker's factual coordinate in the selected economic dimension:

- MARKET_CAP uses the factual marker market cap and selected display factor;
- PRICE uses factual execution price, then only the already-validated coherent conversion fallback;
- zero, missing, stale, or dimensionally incoherent values do not render.

The target Y is computed from the current scale. A line is rendered only if the projected point falls within that scale's current plot bounds. It is not clamped and receives no top/bottom substitute indicator. When panning, zooming, autoscaling, resizing, or changing axis mode makes the value enter the plot, the normal 400 ms repair loop renders it; leaving the plot removes it.

The overlay line and label use client coordinates derived from the same current source rectangle. The existing less-than-3-pixel visual deadband applies only when marker economic value, scale type, factor, generation, viewport, and plot bounds are unchanged.

If a worker-only drawing path is dynamically confirmed and no supported coordinate API or trustworthy numeric snapshot exists, the correct behavior is to remain hidden rather than display a wrong line. Worker enablement alone is not treated as confirmation.

### 5. Encode spreadsheet-dangerous strings at the CSV boundary

CSV export adds one type-aware encoder step before the existing quote escaping:

- numbers remain numbers, including negative PnL and quantities;
- strings whose first non-whitespace/control character is `=`, `+`, `-`, or `@` receive one leading ASCII apostrophe;
- the resulting value then receives the existing doubled-quote and enclosing-quote escaping;
- JSON export, values from an accepted import, and Dashboard display remain unchanged; the only import behavior change is the explicit lossless rejection of an oversized state defined below.

This applies to every string column, including symbol and source URL, rather than to a hand-maintained subset.

### 6. Enforce a byte budget at the atomic state coordinator

The existing 10,000-entry limits remain logical upper bounds. A second bound limits the serialized state payload to 8 MiB measured with UTF-8 bytes, leaving headroom under Chrome's 10 MiB total quota for key names, settings, migration overhead, and implementation differences.

Initialization, migration, normal commit, reset-with-balance, and reset-chain use one pure compaction function before persistence. Import uses the same byte measurement and dependency validation but is lossless: if the normalized import is over budget, it fails atomically with a typed `importTooLarge` result and reports its measured/budget bytes. A future explicitly confirmed lossy-import UI is outside this design.

Compaction rules are deterministic:

1. normalize without mutating the caller's arrays;
2. identify essential state: accounts, positions, daily realized values, settings-bearing state, the current mutation, and the transitive canonical fallback-origin closure required by every retained durable trade, including history for closed positions;
3. retain newest history and remove the oldest removable trade/calibration records across both collections until the UTF-8 budget is met;
4. return the exact compacted state that was persisted so in-memory and storage state cannot diverge;
5. if essential state alone exceeds the budget, return a typed `storageFull` failure and perform no storage write or in-memory revision advance.

Fallback provenance is closed after every removal. If a retained record directly or transitively references a canonical origin, that origin is retained. If an origin must be removed, every retained dependent record is removed in the same candidate unit; an orphaned suffix is never persisted. This rule applies to open and closed tokens and to export/re-import validation.

Removal order uses a stable key: normalized timestamp ascending, collection priority (`calibration` before `trade` at the same timestamp), stable record ID, then original array index. Protected/current records are excluded before sorting. Equal timestamps therefore produce the same compacted result on every run.

The current transaction is never silently discarded. A native quota error is normalized to the same typed failure without retrying a partial or differently compacted mutation. Oversized import is rejected rather than silently compacted. The extension does not request `unlimitedStorage`.

## Error Handling and Recovery

- A rejected synthetic activation is a no-op: no cash, position, trade, marker, calibration, pending intent, revision, setting, preset, layout, confirmation, or session-state changes.
- If a quick-buy binding becomes structurally invalid, restore or rediscover through the existing lifecycle; do not fall back to native trading.
- Invalid chart metadata becomes `UNKNOWN`; invalid numeric anchors clear the overlay for that generation.
- Chart recovery is event-driven on load/clear/resize plus the existing bounded repair tick.
- CSV encoding cannot mutate source objects.
- Storage compaction is pure and deterministic. Irreducible runtime overflow is reported as `storageFull`; oversized import is reported as `importTooLarge`. Both leave the prior state intact.

## Test-Driven Regression Matrix

Production code changes begin only after focused tests reproduce each failure.

### Locked Giant quick-buy

- Small, Large, Extra large, Giant, hostile, missing-leaf, new-card, and mutated-host fixtures all produce the same `giant` control, exact 36 px replacement height, and 36 px host/slot minimum height.
- Host fixtures below, equal to, and above 36 px prove that the replacement remains exactly 36 px and is centered rather than stretched.
- Native classes, inline styles, radius, color variables, and size changes never enter or alter the Tango replacement.
- The replacement, binding, handler, generation, action identity, pending state, and paper callback remain identical across native mutations.
- Two verified slots on one card remain separately bound without duplicate callbacks.
- Native reinsertion is removed immediately; one trusted activation produces one paper callback and zero native callbacks.

### Trusted activation boundary

- Page code can read every public dataset value and send the previous valid message shape without producing any mutation.
- Synthetic/missing-trust click, pointer, Enter, and Space events cannot invoke quick-buy or shell mutation handlers.
- Synthetic events cannot persist settings, presets, layout, confirmation suppression, or session flags.
- A genuine trusted pointer or keyboard activation still invokes exactly one paper action.
- A forged resolving intent cannot become a delayed trade when a token link appears later.
- Main-world quote messages cannot persist calibration on a later tick; the background quote path still can.

### Chart markers

- A frame whose `contentDocument` getter throws still receives a sanitized `MARKET_CAP` hint derived from its own widget metadata.
- Malformed, oversized, detached, reused-frame, wrong-route, and stale-generation metadata yields `UNKNOWN` and cannot alter the canonical payload.
- `MARKET_CAP` resolves an exact PRICE/MCAP candidate tie in favor of market cap; `PRICE` performs the inverse.
- Frame reload, READY loss/recovery, narrow axis clear, canvas disconnect, token change, viewport change, and axis-hint change invalidate the appropriate generation and replay only the latest token payload.
- With fresh anchors, factual values project to the expected client Y after transform, scale, and resize.
- The same marker ID with a changed economic value moves immediately; unchanged economics retain the jitter deadband.
- A marker outside current plot bounds creates no node. It appears after a later current scale puts it inside, and disappears when it leaves.
- A mode hint with zero numeric anchors creates no line. Static iframe dimensions never authorize interpolation.
- A worker-only mode hint without numeric anchors remains hidden and is reported by bounded diagnostics; the test must not authorize an invented coordinate.
- Tests for an authoritative coordinate API or axis snapshot are added only if a trustworthy live producer is separately confirmed.

### CSV

- `=HYPERLINK(...)`, `+SUM(...)`, `-1+1`, `@SUM(...)`, and whitespace/control-prefixed variants export with a leading apostrophe.
- Negative numeric PnL such as `-42` remains numeric text without an apostrophe.
- commas, quotes, newlines, normal URLs, JSON export, and Dashboard display preserve their prior behavior.

### Storage

- A quota-enforcing fake rejects the current representative 10k+10k runtime state before the fix and accepts compacted state below the configured budget afterward.
- A normalized oversized import fails atomically with `importTooLarge`, measured/budget byte details, no truncation, and no state change.
- A near-budget BUY retains the new trade, advances revision once, and removes only the oldest unprotected history.
- Open and closed multi-token fallback histories retain the transitive origin closure; removing an origin removes its complete dependent unit, and compacted JSON export passes strict re-import.
- Equal-timestamp trade/calibration fixtures produce the specified stable removal order.
- Input arrays and objects are not mutated.
- Essential-state overflow returns `storageFull` with no partial write or in-memory divergence.

### Full regression and package parity

- Adapter, guard, page-main, content-runtime, marker, state, coordinator, Dashboard, validator, and structure suites pass.
- The full project check and build pass.
- Source and packaged `dist` copies of changed runtime assets are identical.

## Acceptance Criteria

1. Every verified GMGN trench slot displays the same unclipped, exact-36-px Tango Giant control, independent of all GMGN button settings, smaller/taller hosts, and later native mutations.
2. Genuine paper-trading behavior is unchanged, while page-authored messages and synthetic events cannot mutate paper state.
3. On an explicit MCAP chart, marker selection cannot accidentally use a PRICE scale; equivalent behavior holds for an explicit PRICE chart.
4. A BUY or SELL line with a trustworthy current mapping is at the correct Y and exists only while its factual value is inside the current plot.
5. Missing/stale axis data never produces a guessed or stale-position line, and the renderer retries when a new valid generation arrives. Worker-only axes without a verified numeric coordinate source remain an explicit fail-closed limitation.
6. CSV exports are spreadsheet-safe without changing numeric values or JSON data.
7. Runtime states fit the configured byte budget or fail atomically with `storageFull`; oversized imports fail losslessly with `importTooLarge`; no `unlimitedStorage` permission is added.
8. No real GMGN trade path or new privileged capability is reachable.
