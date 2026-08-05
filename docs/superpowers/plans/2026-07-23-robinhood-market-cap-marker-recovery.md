# Robinhood Market-Cap Integrity and Delayed-Chart Marker Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Robinhood total-supply values from becoming paper-trade market caps, preserve immediate `$3,200` fallback fills when factual GMGN data is incomplete, and show the committed buy/sell marker as soon as a delayed K-line becomes usable.

**Architecture:** The GMGN adapter will only accept market-cap values with explicit USD semantics and a field-local association, while retaining exact total supply as a separate datum. The chart bridge will distinguish an unidentified clear payload from a real token-to-token transition so axis labels drawn before the first identified marker remain eligible. Existing contaminated paper history will not be silently repriced because its factual historical execution price is unavailable.

**Tech Stack:** Manifest V3 Chrome extension, dependency-free browser JavaScript, Node.js built-in test runner, custom extension validator/build scripts.

## Global Constraints

- Never invoke a GMGN native trade listener, wallet, signature, approval, swap, RPC broadcast, or any real-money path.
- Apply quote integrity rules consistently to Solana, Ethereum, BNB Chain, Base, Robinhood Chain, and X Layer.
- A missing or semantically ambiguous market cap must remain zero so the existing paper-only `$3,200` initial-market-cap fallback executes immediately.
- Exact total supply such as Robinhood `100B` remains valid supply data but must never become `marketCapUsd` without explicit USD evidence.
- Do not silently reset, delete, reprice, or mutate existing user paper-trade history.
- Use test-driven development and observe every regression test fail for the expected reason before changing production code.

---

### Task 1: Field-local GMGN market-cap parsing

**Files:**
- Modify: `tests/gmgn-adapter.test.js`
- Modify: `src/adapters/gmgn.js`

**Interfaces:**
- Preserves: `_cardMarketCap(text): number`, `readCurrentToken(): Promise<TokenContext|null>`, and `discoverTokenCards(...)`.
- Produces: market-cap parsing that requires `$`/`US$` evidence and keeps `Total Supply` independent.

- [ ] **Step 1: Add failing card parser tests**

Add assertions that `_cardMarketCap('MC\n100B\nTotal Supply\n100B')` returns `0`, `_cardMarketCap('MC\n$12.15K\nTotal Supply\n100B')` returns `12_150`, and an unrelated currency value after another field cannot be paired with `MC`.

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `node --test --test-name-pattern="market cap|supply" tests/gmgn-adapter.test.js`

Expected: FAIL because the current optional-dollar regular expression parses bare `100B` as `$100B`.

- [ ] **Step 3: Add failing structured-detail tests**

Extend the detail fixture to represent explicit `MC`, legacy unlabeled market-cap, and temporarily unlabeled supply items. Assert that an explicit `MC $12.15K` wins over `Total Supply 100B`, an unlabeled `100B` is not a market cap, a legacy unlabeled `$12.15K` remains accepted, and exact `100B` supply remains available.

- [ ] **Step 4: Run the detail tests and verify RED**

Run: `node --test --test-name-pattern="detail.*market cap|unlabeled.*supply" tests/gmgn-adapter.test.js`

Expected: FAIL because `detailQuote` currently treats the first titleless `InfoItem` as market cap regardless of currency semantics.

- [ ] **Step 5: Implement field-local parsing**

Require explicit USD evidence for card market cap. In structured detail data, read a same-item `MC`, `MCap`, or `Market Cap` value first; permit the legacy titleless market-cap slot only when its value contains `$`/`US$`; do not scan unrelated structured siblings as a fallback. Parse `Total Supply` only from its own labeled item.

- [ ] **Step 6: Add price/supply consistency protection**

When factual price and exact supply are both positive, compute `price × supply`; discard a candidate market cap that is materially above that fully diluted value while retaining factual price and supply. Do not reject an otherwise valid paper order; ambiguous market cap remains zero and enters the existing fallback path.

- [ ] **Step 7: Run focused adapter tests**

Run: `node --test tests/gmgn-adapter.test.js`

Expected: PASS.

### Task 2: First-marker recovery after a delayed K-line

**Files:**
- Modify: `tests/markers.test.js`
- Modify: `src/content/chart-main.js`
- Test: `tests/content-runtime.test.js`

**Interfaces:**
- Preserves: `CHART_MARKERS` payload and token A-to-token B scale invalidation.
- Produces: unidentified empty payload -> existing current-axis labels -> first identified token marker renders immediately.
- Aligns: the iframe-side chart bridge accepts the same Financial Chart/TradingView chart identities already selected by the parent page, while continuing to reject unrelated titled frames.

- [ ] **Step 1: Add a failing chart-order test**

Send `{ markers: [] }`, draw three valid current-axis labels, then send the first payload containing `chain`, `tokenAddress`, and a marker. Assert the marker overlay is populated without waiting for another GMGN axis redraw.

- [ ] **Step 2: Run marker tests and verify RED**

Run: `node --test tests/markers.test.js`

Expected: FAIL because the first identified payload raises `markerAxisSequenceFloor` past already-current labels.

- [ ] **Step 3: Implement identity-aware invalidation**

Treat a real identified token A-to-token B change as a scale boundary, but do not raise the floor when the previous state was a bare unidentified clear payload. Continue clearing scale and overlay for explicit empty payloads, route changes, resize, and untrustworthy scales.

- [ ] **Step 4: Verify delayed-frame replay**

Run the existing content-runtime cases for quick-buy completion before detail navigation, iframe creation after the committed buy, and iframe `READY` arriving before route discovery. Add only the smallest missing test if an order is not represented.

Run: `node --test --test-name-pattern="quick buy|marker|iframe|READY" tests/content-runtime.test.js tests/markers.test.js`

Expected: PASS.

- [ ] **Step 5: Align alternate chart-frame identity**

Add a harness case whose frame title is `TradingView` and assert the chart bridge initializes, plus an unrelated titled-frame case that remains inert. Update the bridge title gate to match the parent page's supported chart-frame identities.

Run: `node --test tests/markers.test.js`

Expected: PASS.

### Task 3: Release verification and Chrome package synchronization

**Files:**
- Generate: `dist/tango-paper-trader/**`

**Interfaces:**
- Verifies: no real-money capability, all unit/integration regressions, and source/build hash equality.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/gmgn-adapter.test.js tests/markers.test.js tests/content-runtime.test.js`

Expected: PASS.

- [ ] **Step 2: Run the full validation gate**

Run: `npm.cmd test`

Expected: all tests PASS.

Run: `npm.cmd run check`

Expected: static extension validation PASS with no wallet/signature/approval/swap/broadcast capability.

- [ ] **Step 3: Build and compare**

Run: `npm.cmd run build`

Expected: `dist/tango-paper-trader` regenerates successfully.

Compare every generated source file with its `src` counterpart by SHA-256 and require zero mismatches.

- [ ] **Step 4: Keep history repair explicit**

Report that the approximately six-million-ETH balance is stored paper history, not a display-only value. Offer a targeted reversal/quarantine of fingerprint-matched invalid Robinhood trades or the existing Robinhood-chain reset, but perform neither without explicit user choice.
