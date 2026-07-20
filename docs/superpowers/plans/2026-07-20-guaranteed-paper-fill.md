# Guaranteed Multichain Paper Fill Implementation Plan

**Goal:** Make all simulated trade entry points use one resilient exact-identity quote resolver, correct GMGN metadata caching, and open current-chain Dashboard history from the PnL calendar.

**Architecture:** Keep the trading engine strict and create paper-fill fallback snapshots only in the GMGN content integration. Merge GMGN observations in the shared quote adapter, reuse that merge in both page worlds, and keep route captures around every asynchronous order. Pass Dashboard tab/chain intent through a validated extension URL.

**Safety:** The work is local paper trading only. Do not add wallet APIs, signing, approvals, swaps, RPC submission, or real transaction calls.

---

### Task 1: Monotonic exact-identity GMGN observations

**Files:**
- Modify: `src/adapters/gmgn-quotes.js`
- Modify: `src/content/page-main.js`
- Modify: `src/content/content.js`
- Test: `tests/gmgn-quotes.test.js`
- Test: `tests/page-main.test.js`
- Test: `tests/content-runtime.test.js`

1. Add failing tests for price-only and metadata-only fragments arriving in both orders.
2. Add a shared merge helper that refuses chain/address mismatches and preserves non-empty fields.
3. Use the helper in MAIN-world and content-world caches.
4. Add exact-address GMGN network metadata updates and prove another chain/address cannot update a position.

### Task 2: Unified guaranteed paper quote resolver

**Files:**
- Modify: `src/content/content.js`
- Modify: `src/shared/i18n.js`
- Test: `tests/content-runtime.test.js`
- Test: `tests/content-structure.test.js`

1. Add failing tests for stale quick buy, detail buy/sell, drawer sell, breakeven, and close-all.
2. Implement a resolver that prefers fresh GMGN, waits for replay, requests DEX/native refresh, then creates an exact-identity last-known paper snapshot.
3. Keep strict fresh-quote helpers for read-only freshness and position quote persistence.
4. Route all trade entry points through the resolver.
5. Queue a route-bound retry rather than showing a failure when no historical price exists.
6. Ensure confirmation callbacks also refresh/rebase their paper quote safely.

### Task 3: Current-chain history navigation

**Files:**
- Modify: `src/content/content.js`
- Modify: `src/content/content.css`
- Modify: `src/background.js`
- Modify: `src/dashboard/dashboard.js`
- Modify: `src/shared/i18n.js`
- Test: `tests/content-runtime.test.js`
- Test: `tests/background.test.js`
- Test: `tests/dashboard-runtime.test.js`

1. Add a calendar history button and send `tab: history` with the active chain.
2. Validate tab and chain in the background and construct `dashboard.html?chain=...#history`.
3. Honor and persist the explicit startup chain in Dashboard.
4. Prove history begins on the requested chain without a date filter.

### Task 4: Regression and safety audit

**Files:**
- Modify as required by discovered regressions.
- Test: relevant `tests/*.test.js`

1. Audit every simulated buy/sell entry point and current-chain view.
2. Run targeted tests after each red/green cycle.
3. Run the full test suite, `npm run check`, and `npm run build`.
4. Compare source and packaged `dist` hashes.
5. Search the final diff for wallet/signature/approval/swap/transaction submission additions.
