# GMGN Route, Supply, and Detail Resilience Implementation Plan

> Implement test-first in the existing `codex/instant-paper-fill-performance` worktree. Preserve the paper-only safety boundary.

## Task 1: Route-chain synchronization tests

1. Extend the content runtime harness so settings patches and delayed patch completions are observable.
2. Add a failing startup test asserting a supported GMGN route patches only `{ selectedChain }` when it differs.
3. Add a failing SPA test asserting the new route renders immediately and persists the newest chain.
4. Add a failing race test asserting an earlier persistence completion cannot overwrite the current route chain in runtime settings.
5. Run the focused content runtime tests and confirm the new assertions fail for the expected missing synchronization behavior.

## Task 2: Route-chain synchronization implementation

1. Add a route-epoch-bound `syncSelectedChainFromRoute` helper in `src/content/content.js`.
2. Invoke it after initial settings load and on supported route changes without delaying rendering, quote replay, or quick-buy synchronization.
3. Patch only `selectedChain`; preserve other concurrent settings fields returned by the coordinator.
4. Ignore stale completions and retry after a later route/refresh if persistence fails.
5. Run the focused tests until green.

## Task 3: No-chart detail context tests

1. Add failing runtime tests for every registered chain where the detail URL is valid but `readCurrentToken()` and GMGN quotes return nothing.
2. Assert the placeholder uses the normalized route identity, remains unverified, and renders the paper panel.
3. Assert a trench URL, invalid address, and cross-chain quote cannot create the placeholder.
4. Assert a later exact-address DOM/network observation enriches rather than replaces the route identity.
5. Run the focused tests and confirm expected failures.

## Task 4: Immediate detail context implementation

1. Add a pure route-placeholder builder using `detailRouteToken()`.
2. Establish the placeholder synchronously at startup and after a detail route transition.
3. Preserve it through null DOM reads with the adapter's current-token resolver while keeping route-epoch checks.
4. Merge later exact-address metadata and quotes through the existing identity-bound paths.
5. Run adapter/content focused tests until green.

## Task 5: Immediate exact-supply calibration tests

1. Extend the content harness to record `updatePositionQuote` calls and returned state.
2. Add a failing test for a provisional quick-buy position receiving a stronger exact GMGN supply inside the ten-second ordinary write window.
3. Assert one immediate calibration write occurs and the rendered position quantity uses the returned state.
4. Add a control test proving same-quality price-only marks remain throttled.
5. Re-run supply and engine tests to lock the existing 1B/2B/100B registry and exact > ratio > rule priority.

## Task 6: Calibration scheduling implementation

1. Add a bounded comparison helper that detects a current position's calibration-relevant upgrade.
2. Let exact supply or another stronger calibration observation bypass the ordinary mark throttle for that exact position.
3. Keep ordinary mark writes throttled and route-epoch-bound.
4. Ensure the returned calibrated state is assigned before rendering.
5. Run focused content, engine, state, and supply tests until green.

## Task 7: Full verification and extension build

1. Run `npm test`.
2. Run `npm run check`.
3. Run `npm run build`.
4. Compare the unpacked Chrome extension directory against the production build using the repository's existing validation/hash workflow.
5. Perform read-only/manual smoke checks on supported GMGN routes without clicking any GMGN real-trade or wallet control.
6. Review the final diff for unrelated files and confirm no wallet/signature/swap/RPC/broadcast capability was added.

